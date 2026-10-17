// Regression tests for the cross-file review follow-ups.
const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { resetGlobals } = require('./test-helper');

function loadNative(key) {
  var file = path.join(__dirname, '..', 'disks', 'fd', 'game(' + key + ').' + key);
  var buf = new Uint8Array(fs.readFileSync(file)).buffer;
  var native = readCmdContainerPartitions(buf, key).partitions.filter(function(p) { return p.type === 1; })[0];
  var slice = extractCmdContainerPartition(buf, native);
  global.currentBuffer = slice;
  global.currentPartition = null;
  parseDisk(slice, key);
  return getCurrentCtx();
}

// parseCurrentDir would sniff an 800K slice as D81, so pass the key.
function liveEntries(key) {
  return parseDisk(currentBuffer, key).entries.filter(function(e) { return !e.deleted; });
}

describe('FD Native partition sector walking', () => {
  beforeEach(() => { resetGlobals(); });

  it('forEachFileSector follows links past the physical SPT', () => {
    global.currentBuffer = createEmptyDisk('d2m', 81);
    global.currentFormat = DISK_FORMATS.d2m;
    global.currentTracks = 81;
    global.currentPartition = null;
    var ctx = getCurrentCtx();
    var data = new Uint8Array(currentBuffer);
    var dirOff = sectorOffset(1, 34, ctx);
    data[dirOff + 2] = 0x82;
    data[dirOff + 3] = 2; data[dirOff + 4] = 200;
    var s1 = sectorOffset(2, 200, ctx);
    data[s1] = 3; data[s1 + 1] = 250;
    var s2 = sectorOffset(3, 250, ctx);
    data[s2] = 0; data[s2 + 1] = 5;
    var seen = [];
    forEachFileSector(data, dirOff, function(t, s) { seen.push(t + ':' + s); }, ctx);
    assert.deepStrictEqual(seen, ['2:200', '3:250']);
  });

  ['d2m', 'd4m'].forEach(function(key) {
    var file = path.join(__dirname, '..', 'disks', 'fd', 'game(' + key + ').' + key);
    it(key.toUpperCase() + ': BAM integrity sees every file sector', { skip: !fs.existsSync(file) }, () => {
      var ctx = loadNative(key);
      var integ = checkBAMIntegrity(currentBuffer, ctx);
      assert.strictEqual(integ.orphanCount, 0);
      assert.strictEqual(integ.allocMismatch, 0);
    });

    it(key.toUpperCase() + ': Optimize Disk succeeds and keeps file contents', { skip: !fs.existsSync(file) }, () => {
      var ctx = loadNative(key);
      var live = liveEntries(key);
      var before = live.map(function(e) { return Array.from(readFileData(currentBuffer, e.entryOff, ctx).data); });
      var res = optimizeDisk(currentBuffer, 1, true, ctx);
      assert.ok(!res.error, res.log.join('\n'));
      ctx = getCurrentCtx();
      var after = liveEntries(key);
      after.forEach(function(e, i) {
        assert.deepStrictEqual(Array.from(readFileData(currentBuffer, e.entryOff, ctx).data), before[i]);
      });
      assert.strictEqual(checkBAMIntegrity(currentBuffer, ctx).orphanCount, 0);
    });
  });
});

describe('format-layer helpers', () => {
  it('CMD partition type helpers live in cbm-format-cmd.js', () => {
    assert.strictEqual(isCmdSystemPartition({ type: CMD_PART_TYPE_SYSTEM }), true);
    assert.strictEqual(isCmdSystemPartition({ type: CMD_PART_TYPE_NATIVE }), false);
    assert.strictEqual(isCmdExportablePartition({ type: 0x04 }), true);
    assert.strictEqual(isCmdExportablePartition({ type: 0x06 }), false);
  });

  it('allocateSectorsFromTrackOrder uses logical 256-sector tracks on D2M', () => {
    resetGlobals();
    global.currentBuffer = createEmptyDisk('d2m', 81);
    global.currentFormat = DISK_FORMATS.d2m;
    global.currentTracks = 81;
    var list = allocateSectorsFromTrackOrder({}, 200, [2], 1, getCurrentCtx());
    assert.strictEqual(list.length, 200);
    assert.ok(list.some(function(x) { return x.sector >= 80; }));
  });
});
