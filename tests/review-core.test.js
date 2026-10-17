// Regression tests for the core-format review fixes (chain bounds on FD
// images, Optimize Disk, D81 sub-partition BAM, D71 T53, tree paste,
// T64 / X64 detection, PETSCII helpers).
const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { resetGlobals } = require('./test-helper');

function nb(s) {
  var out = new Uint8Array(16);
  for (var i = 0; i < 16; i++) out[i] = i < s.length ? s.charCodeAt(i) : 0xA0;
  return out;
}

function useDisk(buf, key, tracks) {
  global.currentBuffer = buf;
  global.currentFormat = DISK_FORMATS[key];
  global.currentTracks = tracks;
  global.currentPartition = null;
  return getCurrentCtx();
}

function fileEntryOff(buffer, name) {
  var info = parseCurrentDir(buffer);
  var e = info.entries.find(function(x) { return petsciiToReadable(x.name) === name; });
  return e ? e.entryOff : -1;
}

function payload(n, seed) {
  var p = new Uint8Array(n);
  for (var i = 0; i < n; i++) p[i] = (i * 7 + seed) & 0xFF;
  return p;
}

describe('FD (D1M/D2M/D4M) logical chain links', () => {
  beforeEach(() => { resetGlobals(); });

  it('reads a file whose chain uses sectors past the physical SPT', () => {
    var ctx = useDisk(createEmptyDisk('d2m', 81), 'd2m', 81);
    var data = new Uint8Array(currentBuffer);
    var dirOff = sectorOffset(1, 34, ctx);
    data[dirOff + 2] = 0x82;
    data[dirOff + 3] = 2; data[dirOff + 4] = 200;   // T2/S200: S >= 80 physical SPT
    for (var i = 0; i < 4; i++) data[dirOff + 5 + i] = 0x41 + i;
    for (i = 4; i < 16; i++) data[dirOff + 5 + i] = 0xA0;
    data[dirOff + 30] = 2;
    var s1 = sectorOffset(2, 200, ctx);
    data[s1] = 3; data[s1 + 1] = 250;
    var s2 = sectorOffset(3, 250, ctx);
    data[s2] = 0; data[s2 + 1] = 5;
    data[s2 + 2] = 0xAB;
    var rd = readFileData(currentBuffer, dirOff, ctx);
    assert.strictEqual(rd.error, null);
    assert.strictEqual(rd.data.length, 254 + 4);
    var log = validateDisk(currentBuffer.slice(0), ctx);
    assert.ok(!log.some(function(l) { return /illegal/.test(l); }), log.join('\n'));
  });

  ['d2m', 'd4m'].forEach(function(key) {
    var file = path.join(__dirname, '..', 'disks', 'fd', 'game(' + key + ').' + key);
    it('reads every file of the real ' + key.toUpperCase() + ' Native partition', { skip: !fs.existsSync(file) }, () => {
      var buf = new Uint8Array(fs.readFileSync(file)).buffer;
      var native = readCmdContainerPartitions(buf, key).partitions.filter(function(p) { return p.type === 1; })[0];
      var slice = extractCmdContainerPartition(buf, native);
      global.currentBuffer = slice;
      global.currentPartition = null;
      var info = parseDisk(slice, key);
      var ctx = getCurrentCtx();
      var live = info.entries.filter(function(e) { return !e.deleted; });
      assert.ok(live.length >= 4);
      live.forEach(function(e) {
        var rd = readFileData(slice, e.entryOff, ctx);
        assert.strictEqual(rd.error, null, petsciiToReadable(e.name));
        assert.ok(rd.data.length > 0);
      });
      var log = validateDisk(slice.slice(0), ctx);
      assert.ok(!log.some(function(l) { return /ERROR/.test(l); }), log.join('\n'));
    });
  });

  it('chain bounds come from the logical size, capped by the image', () => {
    var ctx = useDisk(new ArrayBuffer(819200), 'd2m', 81); // 3200-sector Native slice
    assert.strictEqual(chainTrackCount(ctx), 13);
    assert.strictEqual(chainSectorsPerTrack(12, ctx), 256);
    assert.strictEqual(chainSectorsPerTrack(13, ctx), 128);
    assert.strictEqual(isValidChainLink(13, 128, ctx), false);
  });
});

describe('optimizeDisk', () => {
  beforeEach(() => { resetGlobals(); });

  it('DNP: rebuilds the BAM MSB-first and keeps the system sectors allocated', () => {
    var ctx = useDisk(createEmptyDisk('dnp', 4), 'dnp', 4);
    assert.ok(writeFileToDisk(2, nb('A'), payload(1000, 1), null, true, ctx));
    assert.ok(writeFileToDisk(2, nb('B'), payload(600, 2), null, true, ctx));
    var res = optimizeDisk(currentBuffer, 1, true, ctx);
    assert.ok(!res.error, res.log.join('\n'));
    var data = new Uint8Array(currentBuffer);
    var bamOff = sectorOffset(1, 1, ctx);
    for (var s = 0; s <= 33; s++) assert.strictEqual(checkSectorFree(data, bamOff, 1, s, ctx), false, '1:' + s);
    assert.deepStrictEqual(Array.from(readFileData(currentBuffer, fileEntryOff(currentBuffer, 'A'), ctx).data), Array.from(payload(1000, 1)));
    var integ = checkBAMIntegrity(currentBuffer, ctx);
    assert.strictEqual(integ.allocMismatch, 0);
    assert.strictEqual(integ.orphanCount, 0);
  });

  it('DNP: leaves subdirectory trees in place', () => {
    var ctx = useDisk(createEmptyDisk('dnp', 4), 'dnp', 4);
    var sub = _cbmCreateDnpSubdir(ctx, 'SUB');
    assert.ok(sub.ok);
    var subCtx = Object.assign({}, ctx, { partition: sub.partition });
    assert.ok(writeFileToDisk(2, nb('INNER'), payload(700, 3), null, true, subCtx));
    assert.ok(writeFileToDisk(2, nb('OUTER'), payload(300, 4), null, true, ctx));
    var res = optimizeDisk(currentBuffer, 1, true, getCurrentCtx());
    assert.ok(!res.error, res.log.join('\n'));
    assert.ok(res.log.some(function(l) { return /Skipped directory/.test(l); }));
    var tree = cbmCollectDirTree(getCurrentCtx()).tree;
    var inner = tree.subdirs[0].files[0];
    assert.deepStrictEqual(Array.from(inner.payload), Array.from(payload(700, 3)));
    var integ = checkBAMIntegrity(currentBuffer, getCurrentCtx());
    assert.strictEqual(integ.allocMismatch, 0);
    assert.strictEqual(integ.orphanCount, 0);
  });

  it('refuses inside a partition', () => {
    var ctx = useDisk(createEmptyDisk('d81', 80), 'd81', 80);
    var p = _cbmCreateD81Partition(ctx, 'P', 120);
    var res = optimizeDisk(currentBuffer, 1, false, Object.assign({}, ctx, { partition: p.partition }));
    assert.ok(res.error);
    assert.strictEqual(res.filesOptimized, 0);
  });

  it('keeps a C128 boot sector and the GEOS border sector allocated', () => {
    var ctx = useDisk(createEmptyDisk('d64', 35), 'd64', 35);
    var data = new Uint8Array(currentBuffer);
    var bamOff = sectorOffset(18, 0, ctx);
    var boot = sectorOffset(1, 0, ctx);
    data[boot] = 0x43; data[boot + 1] = 0x42; data[boot + 2] = 0x4D;
    bamMarkSectorUsed(data, 1, 0, bamOff, ctx);
    writeGeosSignature(currentBuffer, ctx);
    data[bamOff + 0xAB] = 19; data[bamOff + 0xAC] = 0;
    bamMarkSectorUsed(data, 19, 0, bamOff, ctx);
    assert.ok(writeFileToDisk(2, nb('F'), payload(500, 5), null, true, ctx));
    var res = optimizeDisk(currentBuffer, 10, true, ctx);
    assert.ok(!res.error, res.log.join('\n'));
    assert.strictEqual(checkSectorFree(data, bamOff, 1, 0, ctx), false);
    assert.strictEqual(checkSectorFree(data, bamOff, 19, 0, ctx), false);
    assert.strictEqual(data[boot], 0x43);
  });

  it('D81 root: partition tracks stay allocated', () => {
    var ctx = useDisk(createEmptyDisk('d81', 80), 'd81', 80);
    var p = _cbmCreateD81Partition(ctx, 'P', 120);
    assert.ok(writeFileToDisk(2, nb('F'), payload(3000, 6), null, true, ctx));
    optimizeDisk(currentBuffer, 1, true, ctx);
    var data = new Uint8Array(currentBuffer);
    var bamOff = sectorOffset(40, 1, ctx);
    for (var t = p.partition.startTrack; t < p.partition.startTrack + 3; t++) {
      assert.strictEqual(DISK_FORMATS.d81.readTrackFree(data, bamOff, t), 0, 'track ' + t);
    }
  });
});

describe('DNP subdir creation', () => {
  beforeEach(() => { resetGlobals(); });

  it('does not reuse the new header / dir sector when the parent dir must grow', () => {
    var ctx = useDisk(createEmptyDisk('dnp', 4), 'dnp', 4);
    var a = _cbmCreateDnpSubdir(ctx, 'A');
    var aCtx = Object.assign({}, ctx, { partition: a.partition });
    for (var i = 0; i < 8; i++) assert.ok(writeFileToDisk(2, nb('F' + i), payload(10, i), null, true, aCtx));
    var b = _cbmCreateDnpSubdir(aCtx, 'B');
    assert.ok(b.ok, b.error);
    var data = new Uint8Array(currentBuffer);
    var firstDir = sectorOffset(a.partition.dnpDirT, a.partition.dnpDirS, ctx);
    var ext = data[firstDir] + ':' + data[firstDir + 1];
    assert.notStrictEqual(data[firstDir], 0, 'parent dir grew a second sector');
    assert.notStrictEqual(ext, b.partition.dnpHeaderT + ':' + b.partition.dnpHeaderS);
    assert.notStrictEqual(ext, b.partition.dnpDirT + ':' + b.partition.dnpDirS);
    var integ = checkBAMIntegrity(currentBuffer, ctx);
    assert.strictEqual(integ.allocMismatch, 0);
  });

  it('header +$26 is the offset of the parent entry type byte', () => {
    var ctx = useDisk(createEmptyDisk('dnp', 4), 'dnp', 4);
    var a = _cbmCreateDnpSubdir(ctx, 'A');
    var b = _cbmCreateDnpSubdir(ctx, 'B');
    var data = new Uint8Array(currentBuffer);
    var ha = sectorOffset(a.partition.dnpHeaderT, a.partition.dnpHeaderS, ctx);
    var hb = sectorOffset(b.partition.dnpHeaderT, b.partition.dnpHeaderS, ctx);
    assert.deepStrictEqual([data[ha + 0x24], data[ha + 0x25], data[ha + 0x26]], [1, 34, 0x02]);
    assert.strictEqual(data[hb + 0x26], 0x22);
  });
});

describe('D81 sub-partition BAM (absolute track layout)', () => {
  beforeEach(() => { resetGlobals(); });

  function makePartition() {
    var ctx = useDisk(createEmptyDisk('d81', 80), 'd81', 80);
    var data = new Uint8Array(currentBuffer);
    var hdr = sectorOffset(40, 0, ctx);
    data[hdr + 0x16] = 0x58; data[hdr + 0x17] = 0x59; // root ID "XY"
    var p = _cbmCreateD81Partition(ctx, 'PART', 200);
    assert.ok(p.ok);
    return { ctx: ctx, part: p.partition, pctx: Object.assign({}, ctx, { partition: p.partition }) };
  }

  it('marks everything outside the partition allocated, as the 1581 does', () => {
    var m = makePartition();
    var data = new Uint8Array(currentBuffer);
    var st = m.part.startTrack;
    var pbam = sectorOffset(st, 1, m.ctx);
    assert.strictEqual(data[d81BamEntryBase(pbam, st)], 36);
    assert.strictEqual(data[d81BamEntryBase(pbam, st + 1)], 40);
    assert.strictEqual(data[d81BamEntryBase(pbam, st + m.part.partSize / 40)], 0);
    assert.strictEqual(data[d81BamEntryBase(pbam, 40)], 0);
    assert.strictEqual(data[d81BamEntryBase(pbam, 80)], 0);
    var hdr = sectorOffset(st, 0, m.ctx);
    assert.deepStrictEqual([data[hdr + 0x16], data[hdr + 0x17]], [0x58, 0x59]);
    assert.deepStrictEqual([data[pbam + 4], data[pbam + 5], data[pbam + 6]], [0x58, 0x59, 0xC0]);
  });

  it('free count, integrity check and validate agree inside the partition', () => {
    var m = makePartition();
    assert.ok(writeFileToDisk(2, nb('IN'), payload(2000, 7), null, true, m.pctx));
    var parsed = parsePartition(currentBuffer, m.part.startTrack, m.part.partSize, m.ctx);
    assert.strictEqual(parsed.freeBlocks, cbmCountFreeSectors(m.pctx));
    assert.strictEqual(parsed.freeBlocks, 200 - 40 - 8);
    var integ = checkBAMIntegrity(currentBuffer, m.pctx);
    assert.deepStrictEqual([integ.bamErrors.length, integ.allocMismatch, integ.orphanCount], [0, 0, 0]);
    var log = validatePartition(currentBuffer, m.part.startTrack, m.part.partSize, m.ctx);
    assert.strictEqual(log[log.length - 1], 'Partition is valid. No errors found.', log.join('\n'));
  });

  it('growing keeps the partition BAM absolute', () => {
    var m = makePartition();
    var g = _cbmGrowD81Partition(m.pctx, 40);
    assert.ok(g.ok, g.error);
    var data = new Uint8Array(currentBuffer);
    var pbam = sectorOffset(m.part.startTrack, 1, m.ctx);
    var newTrack = m.part.startTrack + m.part.partSize / 40;
    assert.strictEqual(data[d81BamEntryBase(pbam, newTrack)], 40);
    assert.strictEqual(DISK_FORMATS.d81.readTrackFree(data, sectorOffset(40, 1, m.ctx), newTrack), 0);
  });
});

describe('fresh images match the drive formats', () => {
  beforeEach(() => { resetGlobals(); });

  it('D71: track 53 fully allocated, 1328 blocks free, no orphans', () => {
    var buf = createEmptyDisk('d71', 70);
    var ctx = useDisk(buf, 'd71', 70);
    assert.strictEqual(parseDisk(buf).freeBlocks, 1328);
    var integ = checkBAMIntegrity(buf, ctx);
    assert.deepStrictEqual([integ.bamErrors.length, integ.allocMismatch, integ.orphanCount], [0, 0, 0]);
    var log = validateDisk(buf.slice(0), ctx);
    assert.strictEqual(log[0], 'Disk is valid. No errors found.');
  });

  it('D81 header and BAM fill bytes', () => {
    var buf = createEmptyDisk('d81', 80);
    var d = new Uint8Array(buf);
    var hdr = 39 * 40 * 256;
    assert.deepStrictEqual([d[hdr + 3], d[hdr + 0x1B], d[hdr + 0x1C]], [0x00, 0xA0, 0xA0]);
    assert.deepStrictEqual([d[hdr + 256 + 3], d[hdr + 256 + 6], d[hdr + 512 + 6]], [0xBB, 0xC0, 0xC0]);
  });

  it('D80 / D82 header $1D-$20 are $A0', () => {
    ['d80', 'd82'].forEach(function(key) {
      var fmt = DISK_FORMATS[key];
      var buf = createEmptyDisk(key, fmt.sizes[0].tracks);
      var ctx = useDisk(buf, key, fmt.sizes[0].tracks);
      var hdr = sectorOffset(39, 0, ctx);
      var d = new Uint8Array(buf);
      for (var i = 0x1D; i <= 0x20; i++) assert.strictEqual(d[hdr + i], 0xA0, key + ' +' + i.toString(16));
    });
  });
});

describe('scanOrphanedChains', () => {
  beforeEach(() => { resetGlobals(); });

  it('includes the last data byte of the final sector', () => {
    var ctx = useDisk(createEmptyDisk('d64', 35), 'd64', 35);
    var d = new Uint8Array(currentBuffer);
    var off = sectorOffset(17, 0, ctx);
    d[off] = 0; d[off + 1] = 5;
    d[off + 2] = 0x01; d[off + 3] = 0x08; d[off + 4] = 0xAA; d[off + 5] = 0xBB;
    var res = scanOrphanedChains(currentBuffer, ctx);
    assert.strictEqual(res.length, 1);
    assert.deepStrictEqual(Array.from(res[0].data), [0x01, 0x08, 0xAA, 0xBB]);
  });
});

describe('cbmPasteDirTree overwrite', () => {
  beforeEach(() => { resetGlobals(); });

  it('frees the replaced file\'s sectors', () => {
    var ctx = useDisk(createEmptyDisk('dnp', 4), 'dnp', 4);
    assert.ok(writeFileToDisk(2, nb('X'), payload(2000, 8), null, true, ctx));
    var res = cbmPasteDirTree(ctx, { nameBytes: null, files: [{ nameBytes: nb('X'), cbmTypeIdx: 2, payload: payload(10, 9), size: 10 }], subdirs: [], skippedLnks: [] },
      { onConflict: 'overwrite', flat: true });
    assert.ok(res.ok, res.error);
    var integ = checkBAMIntegrity(currentBuffer, ctx);
    assert.strictEqual(integ.orphanCount, 0);
    assert.strictEqual(integ.allocMismatch, 0);
  });

  it('refuses to replace a directory with a file, and a file with a directory', () => {
    var ctx = useDisk(createEmptyDisk('dnp', 4), 'dnp', 4);
    _cbmCreateDnpSubdir(ctx, 'X');
    assert.ok(writeFileToDisk(2, nb('Y'), payload(10, 1), null, true, ctx));
    var before = new Uint8Array(currentBuffer).slice();
    var r1 = cbmPasteDirTree(ctx, { nameBytes: null, files: [{ nameBytes: nb('X'), cbmTypeIdx: 2, payload: payload(10, 2), size: 10 }], subdirs: [], skippedLnks: [] },
      { onConflict: 'overwrite', flat: true });
    assert.strictEqual(r1.ok, false);
    assert.deepStrictEqual(new Uint8Array(currentBuffer), before);
    var r2 = cbmPasteDirTree(ctx, { nameBytes: null, files: [], subdirs: [{ nameBytes: nb('Y'), files: [], subdirs: [], skippedLnks: [] }], skippedLnks: [] },
      { onConflict: 'overwrite', flat: true });
    assert.strictEqual(r2.ok, false);
  });
});

describe('T64 faulty end address', () => {
  beforeEach(() => { resetGlobals(); });

  it('sizes $C3C6 entries from the next data offset / EOF', () => {
    var d = new Uint8Array(0x40 + 2 * 32 + 300);
    'C64S tape image file'.split('').forEach(function(c, i) { d[i] = c.charCodeAt(0); });
    d[0x22] = 2; d[0x24] = 2;
    function entry(i, off) {
      var e = 0x40 + i * 32;
      d[e] = 1; d[e + 1] = 0x82;
      d[e + 2] = 0x01; d[e + 3] = 0x08;          // $0801
      d[e + 4] = 0xC6; d[e + 5] = 0xC3;          // bogus $C3C6
      d[e + 8] = off & 0xFF; d[e + 9] = off >> 8;
      for (var n = 0; n < 16; n++) d[e + 16 + n] = 0x20;
    }
    entry(0, 0x80); entry(1, 0x80 + 100);
    global.currentFormat = DISK_FORMATS.t64;
    var info = parseT64(d.buffer);
    var ctx = Object.assign(getCurrentCtx(), { format: DISK_FORMATS.t64 });
    var a = readFileData(d.buffer, info.entries[0].entryOff, ctx);
    var b = readFileData(d.buffer, info.entries[1].entryOff, ctx);
    assert.strictEqual(a.error, null);
    assert.strictEqual(a.data.length, 100 + 2);
    assert.strictEqual(b.data.length, d.length - 0x80 - 100 + 2);
  });
});

describe('X64 / G64 sniffing in parseDisk', () => {
  beforeEach(() => { resetGlobals(); global.currentG64Layout = null; });

  it('strips a real X64 header', () => {
    var d = new Uint8Array(174848 + 64);
    d[0] = 0x43; d[1] = 0x15; d[2] = 0x41; d[3] = 0x64;
    global.currentBuffer = d.buffer;
    parseDisk(d.buffer);
    assert.strictEqual(currentBuffer.byteLength, 174848);
    assert.strictEqual(currentFormat, DISK_FORMATS.d64);
  });

  it('renames an X64 tab to .d64, since the header is not saved back', () => {
    var d = new Uint8Array(174848 + 64);
    d[0] = 0x43; d[1] = 0x15; d[2] = 0x41; d[3] = 0x64;
    global.currentBuffer = d.buffer;
    global.currentFileName = 'game.X64';
    parseDisk(d.buffer);
    assert.strictEqual(currentFileName, 'game.d64');
  });

  it('leaves a D64 alone whose first bytes look like a container magic', () => {
    [[0x43, 0x15, 0x41, 0x64], [0x43, 0x31, 0x35, 0x34, 0x31], [0x47, 0x43, 0x52, 0x2D]].forEach(function(magic) {
      var buf = createEmptyDisk('d64', 35);
      var d = new Uint8Array(buf);
      magic.forEach(function(b, i) { d[i] = b; });
      global.currentBuffer = buf;
      parseDisk(buf);
      assert.strictEqual(currentBuffer, buf);
      assert.strictEqual(currentG64Layout, null);
    });
  });
});

describe('PETSCII helpers', () => {
  it('pi ($FF) prints as screen code $5E', () => {
    assert.strictEqual(petsciiToScreencode(0xFF), 0x5E);
    assert.strictEqual(petsciiToScreencode(0xDE), 0x5E);
  });

  it('readPetsciiRich stops on $00 padding like readPetsciiString', () => {
    var d = new Uint8Array([0x41, 0x12, 0x00, 0x00]);
    var rich = readPetsciiRich(d, 0, 4);
    assert.strictEqual(rich.length, 2);
    assert.strictEqual(rich[1].reversed, true);
    assert.strictEqual(readPetsciiString(d, 0, 4).length, 2);
  });
});

describe('closing the last tab', () => {
  it('drops the G64 layout and the undo history', () => {
    global.currentG64Layout = { tracks: [] };
    pushUndo(new ArrayBuffer(4));
    resetNoTabState();
    assert.strictEqual(currentG64Layout, null);
    assert.strictEqual(undoStack.length, 0);
    assert.strictEqual(currentBuffer, null);
  });
});
