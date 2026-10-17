// Disk-tools review fixes: Fill Free inside a D81 partition, BAM viewer
// geometry, and Compare pairing with duplicate filenames.
const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { resetGlobals } = require('./test-helper');

function loadScript(relPath) {
  var src = fs.readFileSync(path.join(__dirname, '..', relPath), 'utf8')
    .replace(/^const /gm, 'var ')
    .replace(/^let /gm, 'var ');
  vm.runInThisContext(src, { filename: relPath });
}
loadScript('assets/js/ui/disk/ui-disk-tools.js');
loadScript('assets/js/ui/disk/ui-disk-bam.js');
loadScript('assets/js/ui/disk/ui-disk-compare.js');

function freshD81() {
  var buf = createEmptyDisk('d81', 80);
  global.currentBuffer = buf;
  global.currentFormat = DISK_FORMATS.d81;
  global.currentTracks = 80;
  global.currentPartition = null;
  return buf;
}

function sectorBytes(buf, t, s, ctx) {
  var off = sectorOffset(t, s, ctx);
  return Array.from(new Uint8Array(buf, off, 256));
}

describe('fillFreeSectors', () => {
  beforeEach(() => resetGlobals());

  it('inside a D81 partition only fills the partition\'s free sectors', () => {
    var buf = freshD81();
    var rootCtx = getCurrentCtx();
    var res = _cbmCreateD81Partition(rootCtx, 'PART', 120);
    assert.strictEqual(res.ok, true);
    var st = res.partition.startTrack;
    var before = new Uint8Array(buf.slice(0));

    global.currentPartition = { startTrack: st, partSize: 120, name: 'PART' };
    var partCtx = getCurrentCtx();
    var filled = fillFreeSectors(buf, [0xAA], partCtx);
    assert.strictEqual(filled, 120 - 4, 'header + 2 BAM + first dir sector stay');

    var after = new Uint8Array(buf);
    var partStart = sectorOffset(st, 0, rootCtx);
    var partEnd = sectorOffset(st + 2, 39, rootCtx) + 256;
    for (var i = 0; i < after.length; i++) {
      if (i >= partStart && i < partEnd) continue;
      if (after[i] !== before[i]) assert.fail('byte $' + i.toString(16) + ' outside the partition changed');
    }
    for (var s = 0; s < 4; s++) {
      assert.deepStrictEqual(sectorBytes(buf, st, s, rootCtx), Array.from(before.subarray(partStart + s * 256, partStart + s * 256 + 256)),
        'system sector ' + s + ' untouched');
    }
    var data = sectorBytes(buf, st + 1, 7, rootCtx);
    assert.strictEqual(data[0], 0);
    assert.strictEqual(data[1], 0);
    assert.strictEqual(data[2], 0xAA);
    assert.strictEqual(data[255], 0xAA);
  });

  it('refuses a partition context without a usable track range', () => {
    var buf = freshD81();
    global.currentPartition = { startTrack: 0, partSize: 0, name: 'BAD' };
    var before = new Uint8Array(buf.slice(0));
    assert.strictEqual(fillFreeSectors(buf, [0x55], getCurrentCtx()), -1);
    assert.deepStrictEqual(new Uint8Array(buf), before);
  });

  it('at the root leaves the BAM and directory alone', () => {
    var buf = createEmptyDisk('d64', 35);
    global.currentBuffer = buf;
    global.currentFormat = DISK_FORMATS.d64;
    global.currentTracks = 35;
    var ctx = getCurrentCtx();
    var bam = sectorBytes(buf, 18, 0, ctx), dir = sectorBytes(buf, 18, 1, ctx);
    var filled = fillFreeSectors(buf, [0x12, 0x34], ctx);
    assert.ok(filled > 600);
    assert.deepStrictEqual(sectorBytes(buf, 18, 0, ctx), bam);
    assert.deepStrictEqual(sectorBytes(buf, 18, 1, ctx), dir);
    var s = sectorBytes(buf, 1, 0, ctx);
    assert.deepStrictEqual(s.slice(0, 5), [0x00, 0x00, 0x12, 0x34, 0x12]);
  });
});

describe('getBamViewGeometry', () => {
  beforeEach(() => resetGlobals());

  it('covers only the partition tracks inside a D81 partition', () => {
    var buf = freshD81();
    var res = _cbmCreateD81Partition(getCurrentCtx(), 'PART', 200);
    var st = res.partition.startTrack;
    global.currentPartition = { startTrack: st, partSize: 200, name: 'PART' };
    var geo = getBamViewGeometry(new Uint8Array(buf), getCurrentCtx());
    assert.strictEqual(geo.first, st);
    assert.strictEqual(geo.last, st + 4);
    assert.strictEqual(geo.dirTrack, st);
    assert.strictEqual(geo.spt(st), 40);
  });

  it('partition integrity check is clean on a fresh partition', () => {
    var buf = freshD81();
    var res = _cbmCreateD81Partition(getCurrentCtx(), 'PART', 120);
    global.currentPartition = { startTrack: res.partition.startTrack, partSize: 120, name: 'PART' };
    var ctx = getCurrentCtx();
    var geo = getBamViewGeometry(new Uint8Array(buf), ctx);
    var chk = checkPartitionBamIntegrity(buf, ctx, geo, getDirContext(ctx).bamOff);
    assert.strictEqual(chk.bamErrors.length, 0, chk.bamErrors.join(', '));
    assert.strictEqual(chk.allocMismatch, 0);
    assert.strictEqual(chk.orphanCount, 0);
  });

  it('uses physical tracks on a plain D64', () => {
    var buf = createEmptyDisk('d64', 35);
    global.currentBuffer = buf;
    global.currentFormat = DISK_FORMATS.d64;
    global.currentTracks = 35;
    var geo = getBamViewGeometry(new Uint8Array(buf), getCurrentCtx());
    assert.strictEqual(geo.first, 1);
    assert.strictEqual(geo.last, 35);
    assert.strictEqual(geo.spt(1), 21);
    assert.strictEqual(geo.dirTrack, 18);
  });
});

describe('Compare pairing', () => {
  function f(name, bytes) {
    return { name: name, type: 'PRG', data: new Uint8Array(bytes || [1]) };
  }

  it('pairs duplicate names by occurrence instead of collapsing them', () => {
    var a = [f('----'), f('GAME', [1, 2]), f('----', [9])];
    var b = [f('----'), f('----', [9]), f('----', [7]), f('INTRO')];
    var pairs = pairCompareFiles(a, b);
    assert.strictEqual(pairs.length, 5);
    assert.strictEqual(pairs[0].a, a[0]); assert.strictEqual(pairs[0].b, b[0]);
    assert.strictEqual(pairs[1].a, a[1]); assert.strictEqual(pairs[1].b, null);
    assert.strictEqual(pairs[2].a, a[2]); assert.strictEqual(pairs[2].b, b[1]);
    assert.strictEqual(pairs[3].a, null); assert.strictEqual(pairs[3].b, b[2]);
    assert.strictEqual(pairs[4].a, null); assert.strictEqual(pairs[4].b, b[3]);

    var diff = computeCompareDiff({ files: a }, { files: b });
    assert.strictEqual(diff.identical.length, 2);
    assert.strictEqual(diff.differ.length, 0);
    assert.strictEqual(diff.onlyA.length, 1);
    assert.strictEqual(diff.onlyB.length, 2);
    assert.strictEqual(diff.pairs.length, 5);
  });

  it('does not treat object-prototype names as matches', () => {
    var pairs = pairCompareFiles([f('constructor')], [f('toString')]);
    assert.strictEqual(pairs.length, 2);
    assert.strictEqual(pairs[0].b, null);
  });
});
