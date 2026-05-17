// CFS write helpers (Phase 4a) — in-place edits of a directory entry's
// static fields: filename and attribute byte.

const { describe, it } = require('node:test');
const assert = require('node:assert');
require('./test-helper');

// Tiny synth-helpers copied so the test file is self-contained.
function writeCfsEntry(d, dirLba, slotIndex, opts) {
  var eo = dirLba * 512 + slotIndex * 32;
  var name = opts.name || '';
  for (var n = 0; n < 16; n++) {
    d[eo + n] = n < name.length ? name.charCodeAt(n) : 0x20;
  }
  d[eo + 0x10] = (opts.size || 0) & 0xFF;
  d[eo + 0x11] = ((opts.size || 0) >>> 8) & 0xFF;
  d[eo + 0x12] = ((opts.size || 0) >>> 16) & 0xFF;
  d[eo + 0x13] = ((opts.size || 0) >>> 24) & 0xFF;
  d[eo + 0x14] = 0xC0;
  d[eo + 0x18] = (opts.attrByte != null) ? opts.attrByte : (0x80 | (opts.ftype || 0));
  var suf = opts.typeSuffix || '';
  for (var s = 0; s < 3; s++) {
    d[eo + 0x19 + s] = s < suf.length ? suf.charCodeAt(s) : 0x20;
  }
}

describe('CFS write — rename', function() {
  it('cfsWriteDirEntryName overwrites the 16-byte name field, space-padded', function() {
    var buf = new ArrayBuffer(64 * 1024);
    var d = new Uint8Array(buf);
    writeCfsEntry(d, 10, 1, { name: 'OLDNAME', ftype: 1, typeSuffix: 'PRG' });

    assert.strictEqual(cfsWriteDirEntryName(buf, 10, 1, 'NEWFILE'), true);
    var entries = readCfsDirectorySector(buf, 10);
    assert.strictEqual(petsciiToReadable(entries[1].name), 'NEWFILE');

    // Type and attribute byte untouched
    assert.strictEqual(entries[1].typeSuffix, 'PRG');
    assert.strictEqual(entries[1].ftype, 1);
  });

  it('truncates names > 16 chars and pads short ones with $A0', function() {
    var buf = new ArrayBuffer(64 * 1024);
    var d = new Uint8Array(buf);
    writeCfsEntry(d, 10, 1, { name: 'A', ftype: 1 });

    cfsWriteDirEntryName(buf, 10, 1, 'A NAME TOO LONG FOR SIXTEEN');
    var off = 10 * 512 + 32;
    var got = [];
    for (var i = 0; i < 16; i++) got.push(d[off + i]);
    // 16-byte truncation, no padding needed
    assert.deepStrictEqual(got, [0x41,0x20,0x4E,0x41,0x4D,0x45,0x20,0x54,0x4F,0x4F,0x20,0x4C,0x4F,0x4E,0x47,0x20]);

    cfsWriteDirEntryName(buf, 10, 1, 'SHORT');
    got = [];
    for (var j = 0; j < 16; j++) got.push(d[off + j]);
    // 'SHORT' + 11 × $00 padding (IDE64-native / cfsfdisk convention)
    var expected = [0x53,0x48,0x4F,0x52,0x54];
    for (var k = 0; k < 11; k++) expected.push(0x00);
    assert.deepStrictEqual(got, expected);
  });

  it('returns false on out-of-range slot or undersized buffer', function() {
    var buf = new ArrayBuffer(1024);
    assert.strictEqual(cfsWriteDirEntryName(buf, 10, 1, 'X'), false); // off the end
    assert.strictEqual(cfsWriteDirEntryName(buf, 0, -1, 'X'), false);
    assert.strictEqual(cfsWriteDirEntryName(buf, 0, 16, 'X'), false);
  });
});

describe('CFS bitmap helpers (Phase 4b)', function() {
  it('cfsBamLocation: chunk 0 sector 0 → bitmap_lba=partStart, byte 0 bit 7', function() {
    var loc = cfsBamLocation(2, 2);
    assert.strictEqual(loc.bitmapLba, 2);
    assert.strictEqual(loc.byteIdx, 0);
    assert.strictEqual(loc.bitMask, 0x80);
  });

  it('cfsBamLocation: chunk 1 first sector → bitmap_lba=partStart+4096, byte 0 bit 7', function() {
    var loc = cfsBamLocation(2, 2 + 4096);
    assert.strictEqual(loc.bitmapLba, 2 + 4096);
    assert.strictEqual(loc.byteIdx, 0);
    assert.strictEqual(loc.bitMask, 0x80);
  });

  it('cfsBamLocation: 8 sectors past chunk start → byte 1 bit 7', function() {
    var loc = cfsBamLocation(2, 10);
    assert.strictEqual(loc.bitmapLba, 2);
    assert.strictEqual(loc.byteIdx, 1);
    assert.strictEqual(loc.bitMask, 0x80);
  });

  it('cfsAllocSector + cfsMarkSectorFree round-trip', function() {
    var buf = new ArrayBuffer(64 * 1024 * 4); // enough for chunk 0
    var d = new Uint8Array(buf);
    // Initialize bitmap at LBA 2 with all 0xFF (all free)
    for (var i = 0; i < 512; i++) d[2 * 512 + i] = 0xFF;
    // Mark the bitmap's own sector used (real disks do this)
    cfsMarkSectorUsed(buf, 2, 2);

    var lba1 = cfsAllocSector(buf, 2, 100, 3);
    assert.strictEqual(lba1, 3); // first free after bitmap
    var lba2 = cfsAllocSector(buf, 2, 100, 3);
    assert.strictEqual(lba2, 4);

    // Free the first one and re-alloc
    cfsMarkSectorFree(buf, 2, 3);
    var lba3 = cfsAllocSector(buf, 2, 100, 2);
    assert.strictEqual(lba3, 3);
  });

  it('matches the ide.hdd reference bitmap (when present)', function() {
    var fs = require('fs');
    var path = require('path');
    var p = path.join(__dirname, '..', 'disks', 'ide.hdd');
    if (!fs.existsSync(p)) return;
    var buf = fs.readFileSync(p).buffer;
    var info = readIde64Partitions(buf);
    var part0 = info.partitions[0];
    // Known-used sectors on this disk
    assert.strictEqual(cfsIsSectorFree(buf, part0.startLba, 4), false); // deleted-dir
    assert.strictEqual(cfsIsSectorFree(buf, part0.startLba, 5), false); // root-dir
    assert.strictEqual(cfsIsSectorFree(buf, part0.startLba, 6), false); // PROFIRE dir
    assert.strictEqual(cfsIsSectorFree(buf, part0.startLba, 2),    false); // bitmap itself
    assert.strictEqual(cfsIsSectorFree(buf, part0.startLba, 4098), false); // bitmap_1
    assert.strictEqual(cfsIsSectorFree(buf, part0.startLba, 8194), false); // bitmap_2
    // Far past any allocations — should be free
    assert.strictEqual(cfsIsSectorFree(buf, part0.startLba, 8200), true);
  });
});

describe('CFS delete + import (Phase 4b)', function() {
  it('cfsImportSingleSectorFile + cfsDeleteFile round-trip on a synthetic partition', function() {
    var buf = new ArrayBuffer(64 * 1024 * 2);
    var d = new Uint8Array(buf);
    var partStart = 2;
    var partEnd = 200;
    // Initialize bitmap at LBA 2 with all 0xFF
    for (var i = 0; i < 512; i++) d[2 * 512 + i] = 0xFF;
    // Mark system sectors used: bitmap itself + dir sector 5
    cfsMarkSectorUsed(buf, partStart, 2);
    cfsMarkSectorUsed(buf, partStart, 5);
    // Self-ref entry in dir sector 5
    writeCfsEntry(d, 5, 0, { name: 'TESTDIR', ftype: 3, typeSuffix: 'DIR', attrByte: 0x83 });

    // Import a 100-byte payload
    var payload = new Uint8Array(100);
    for (var p = 0; p < 100; p++) payload[p] = (p & 0xFF);
    var res = cfsImportSingleSectorFile(buf, partStart, partEnd, 5, 'HELLO', payload, { ftype: 1, typeSuffix: 'PRG' });
    assert.ok(res.ok, res.error || '');
    assert.ok(res.treeLba > 5);
    assert.strictEqual(res.dataLbas.length, 1);
    assert.ok(res.dataLbas[0] > res.treeLba);

    // Read the entry back
    var entries = readCfsDirectorySector(buf, res.dirLba);
    var e = entries[res.slotIndex];
    assert.strictEqual(petsciiToReadable(e.name), 'HELLO');
    assert.strictEqual(e.size, 100);
    assert.strictEqual(e.typeSuffix, 'PRG');
    assert.strictEqual(e.ftype, 1);

    // Walk the file content via the B-tree reader and verify bytes
    var read = readCfsFileData(buf, e.dataTreePtr.addr, e.size);
    assert.strictEqual(read.error, null);
    assert.strictEqual(read.data.length, 100);
    for (var k = 0; k < 100; k++) assert.strictEqual(read.data[k], k & 0xFF);

    // Verify bitmap state — both sectors marked used
    assert.strictEqual(cfsIsSectorFree(buf, partStart, res.treeLba), false);
    assert.strictEqual(cfsIsSectorFree(buf, partStart, res.dataLbas[0]), false);

    // Now delete
    var delRes = cfsDeleteFile(buf, partStart, partEnd, {
      dirLba: res.dirLba,
      index: res.slotIndex,
      size: 100,
      dataTreePtr: { lba: true, addr: res.treeLba },
    });
    assert.ok(delRes.ok, delRes.error || '');

    // Bitmap: tree + data freed
    assert.strictEqual(cfsIsSectorFree(buf, partStart, res.treeLba), true);
    assert.strictEqual(cfsIsSectorFree(buf, partStart, res.dataLbas[0]), true);

    // Dir entry: ftype now 0 (DEL), Closed bit cleared
    var after = readCfsDirectorySector(buf, res.dirLba);
    assert.strictEqual(after[res.slotIndex].ftype, 0);
    assert.strictEqual((after[res.slotIndex].attrByte & 0x80) !== 0, false);
  });

  it('multi-sector import round-trip (5 KiB)', function() {
    var buf = new ArrayBuffer(2 * 1024 * 1024);
    var d = new Uint8Array(buf);
    var partStart = 2, partEnd = 1000;
    for (var i = 0; i < 512; i++) d[2 * 512 + i] = 0xFF;
    cfsMarkSectorUsed(buf, partStart, 2);
    cfsMarkSectorUsed(buf, partStart, 5);
    writeCfsEntry(d, 5, 0, { name: 'TESTDIR', ftype: 3, typeSuffix: 'DIR', attrByte: 0x83 });

    var size = 5 * 1024;
    var payload = new Uint8Array(size);
    for (var p = 0; p < size; p++) payload[p] = (p & 0xFF);

    var res = cfsImportFile(buf, partStart, partEnd, 5, 'BIGGER', payload, { ftype: 1, typeSuffix: 'PRG' });
    assert.ok(res.ok, res.error || '');
    assert.strictEqual(res.dataLbas.length, Math.ceil(size / 512));

    var entries = readCfsDirectorySector(buf, res.dirLba);
    var e = entries[res.slotIndex];
    assert.strictEqual(e.size, size);

    var read = readCfsFileData(buf, e.dataTreePtr.addr, e.size);
    assert.strictEqual(read.error, null);
    assert.strictEqual(read.data.length, size);
    for (var k = 0; k < size; k++) {
      assert.strictEqual(read.data[k], k & 0xFF, 'byte ' + k);
    }
  });

  it('multi-sector import + delete frees every allocated sector', function() {
    var buf = new ArrayBuffer(2 * 1024 * 1024);
    var d = new Uint8Array(buf);
    var partStart = 2, partEnd = 1000;
    for (var i = 0; i < 512; i++) d[2 * 512 + i] = 0xFF;
    cfsMarkSectorUsed(buf, partStart, 2);
    cfsMarkSectorUsed(buf, partStart, 5);
    writeCfsEntry(d, 5, 0, { name: 'TESTDIR', ftype: 3, typeSuffix: 'DIR', attrByte: 0x83 });

    var size = 3 * 512 + 100; // 4 sectors, last one partial
    var payload = new Uint8Array(size);
    for (var pi = 0; pi < size; pi++) payload[pi] = 0xCC;

    var res = cfsImportFile(buf, partStart, partEnd, 5, 'X', payload);
    assert.ok(res.ok);
    var allocated = [res.treeLba].concat(res.dataLbas);

    // All 5 sectors marked used
    for (var ai = 0; ai < allocated.length; ai++) {
      assert.strictEqual(cfsIsSectorFree(buf, partStart, allocated[ai]), false, 'pre-delete LBA ' + allocated[ai]);
    }

    var delRes = cfsDeleteFile(buf, partStart, partEnd, {
      dirLba: res.dirLba,
      index: res.slotIndex,
      size: size,
      dataTreePtr: { lba: true, addr: res.treeLba },
    });
    assert.ok(delRes.ok);

    // Every previously-used sector is now free
    for (var ai2 = 0; ai2 < allocated.length; ai2++) {
      assert.strictEqual(cfsIsSectorFree(buf, partStart, allocated[ai2]), true, 'post-delete LBA ' + allocated[ai2]);
    }
  });

  it('import exactly 64 KiB (boundary — fills all 128 tree pointers)', function() {
    var buf = new ArrayBuffer(2 * 1024 * 1024);
    var d = new Uint8Array(buf);
    var partStart = 2, partEnd = 1000;
    for (var i = 0; i < 512; i++) d[2 * 512 + i] = 0xFF;
    cfsMarkSectorUsed(buf, partStart, 2);
    cfsMarkSectorUsed(buf, partStart, 5);
    writeCfsEntry(d, 5, 0, { name: 'D', ftype: 3, typeSuffix: 'DIR', attrByte: 0x83 });

    var size = 65536;
    var payload = new Uint8Array(size);
    for (var pi = 0; pi < size; pi++) payload[pi] = (pi & 0xFF);

    var res = cfsImportFile(buf, partStart, partEnd, 5, 'MAX', payload);
    assert.ok(res.ok, res.error || '');
    assert.strictEqual(res.dataLbas.length, 128);

    var read = readCfsFileData(buf, res.treeLba, size);
    assert.strictEqual(read.error, null);
    assert.strictEqual(read.data.length, size);
    for (var k = 0; k < size; k += 1023) { // spot-check
      assert.strictEqual(read.data[k], k & 0xFF, 'byte ' + k);
    }
  });

  it('multi-level tree: import 100 KiB (depth-1), readback matches', function() {
    var buf = new ArrayBuffer(4 * 1024 * 1024);
    var d = new Uint8Array(buf);
    var partStart = 2, partEnd = (4 * 1024 * 1024 / 512) - 1;
    for (var bm = partStart; bm <= partEnd; bm += 4096) {
      for (var i = 0; i < 512; i++) d[bm * 512 + i] = 0xFF;
      cfsMarkSectorUsed(buf, partStart, bm);
    }
    cfsMarkSectorUsed(buf, partStart, 5);
    writeCfsEntry(d, 5, 0, { name: 'D', ftype: 3, typeSuffix: 'DIR', attrByte: 0x83 });

    var size = 100 * 1024;
    var payload = new Uint8Array(size);
    for (var p = 0; p < size; p++) payload[p] = (p * 31) & 0xFF; // some pattern

    var res = cfsImportFile(buf, partStart, partEnd, 5, 'BIG100', payload);
    assert.ok(res.ok, res.error || '');
    assert.strictEqual(res.depth, 1);

    var entries = readCfsDirectorySector(buf, res.dirLba);
    var e = entries[res.slotIndex];
    var read = readCfsFileData(buf, e.dataTreePtr.addr, e.size);
    assert.strictEqual(read.error, null);
    assert.strictEqual(read.data.length, size);
    for (var k = 0; k < size; k += 257) {
      assert.strictEqual(read.data[k], (k * 31) & 0xFF, 'byte ' + k);
    }
  });

  it('multi-level tree: import 500 KiB (depth-1, near the 576 KiB limit)', function() {
    var buf = new ArrayBuffer(8 * 1024 * 1024);
    var d = new Uint8Array(buf);
    var partStart = 2, partEnd = (8 * 1024 * 1024 / 512) - 1;
    for (var bm = partStart; bm <= partEnd; bm += 4096) {
      for (var i = 0; i < 512; i++) d[bm * 512 + i] = 0xFF;
      cfsMarkSectorUsed(buf, partStart, bm);
    }
    cfsMarkSectorUsed(buf, partStart, 5);
    writeCfsEntry(d, 5, 0, { name: 'D', ftype: 3, typeSuffix: 'DIR', attrByte: 0x83 });

    var size = 500 * 1024;
    var payload = new Uint8Array(size);
    for (var p = 0; p < size; p++) payload[p] = (p ^ 0xA5) & 0xFF;

    var res = cfsImportFile(buf, partStart, partEnd, 5, 'BIG500', payload);
    assert.ok(res.ok, res.error || '');
    assert.strictEqual(res.depth, 1);

    var read = readCfsFileData(buf, res.treeLba, size);
    assert.strictEqual(read.error, null);
    for (var k = 0; k < size; k += 1031) {
      assert.strictEqual(read.data[k], (k ^ 0xA5) & 0xFF, 'byte ' + k);
    }
  });

  it('multi-level tree: import 700 KiB (depth-2)', function() {
    var buf = new ArrayBuffer(8 * 1024 * 1024);
    var d = new Uint8Array(buf);
    var partStart = 2, partEnd = (8 * 1024 * 1024 / 512) - 1;
    for (var bm = partStart; bm <= partEnd; bm += 4096) {
      for (var i = 0; i < 512; i++) d[bm * 512 + i] = 0xFF;
      cfsMarkSectorUsed(buf, partStart, bm);
    }
    cfsMarkSectorUsed(buf, partStart, 5);
    writeCfsEntry(d, 5, 0, { name: 'D', ftype: 3, typeSuffix: 'DIR', attrByte: 0x83 });

    var size = 700 * 1024;
    var payload = new Uint8Array(size);
    for (var p = 0; p < size; p++) payload[p] = (p * 7 + 3) & 0xFF;

    var res = cfsImportFile(buf, partStart, partEnd, 5, 'BIG700', payload);
    assert.ok(res.ok, res.error || '');
    assert.strictEqual(res.depth, 2);

    var read = readCfsFileData(buf, res.treeLba, size);
    assert.strictEqual(read.error, null);
    for (var k = 0; k < size; k += 1543) {
      assert.strictEqual(read.data[k], (k * 7 + 3) & 0xFF, 'byte ' + k);
    }
  });

  it('multi-level delete: import 200 KiB then delete returns every sector', function() {
    var buf = new ArrayBuffer(8 * 1024 * 1024);
    var d = new Uint8Array(buf);
    var partStart = 2, partEnd = (8 * 1024 * 1024 / 512) - 1;
    for (var bm = partStart; bm <= partEnd; bm += 4096) {
      for (var i = 0; i < 512; i++) d[bm * 512 + i] = 0xFF;
      cfsMarkSectorUsed(buf, partStart, bm);
    }
    cfsMarkSectorUsed(buf, partStart, 5);
    writeCfsEntry(d, 5, 0, { name: 'D', ftype: 3, typeSuffix: 'DIR', attrByte: 0x83 });

    var size = 200 * 1024;
    var payload = new Uint8Array(size);
    for (var p = 0; p < size; p++) payload[p] = p & 0xFF;
    var res = cfsImportFile(buf, partStart, partEnd, 5, 'BIG200', payload);
    assert.ok(res.ok);

    // Snapshot free-count, then delete, then count again
    function countFree() {
      var free = 0;
      for (var lba = partStart; lba <= partEnd; lba++) {
        if (cfsIsSectorFree(buf, partStart, lba)) free++;
      }
      return free;
    }
    var freeBefore = countFree();

    var delRes = cfsDeleteFile(buf, partStart, partEnd, {
      dirLba: res.dirLba,
      index: res.slotIndex,
      size: size,
      dataTreePtr: { lba: true, addr: res.treeLba },
    });
    assert.ok(delRes.ok, delRes.error || '');

    var freeAfter = countFree();
    var totalDataSectors = Math.ceil(size / 512);
    // Released: all data sectors + the tree root + any intermediate
    // nodes the importer allocated. For depth=1 with N data sectors,
    // tree nodes = 1 (root, which is also leaf 0) + ceil((N-128)/128)
    // for additional leaves.
    var leavesNeeded = Math.ceil(totalDataSectors / 128);
    var expectedFreed = totalDataSectors + leavesNeeded; // root counts as one leaf
    assert.strictEqual(freeAfter - freeBefore, expectedFreed);
  });

  it('_cfsComputeTreeDepth: boundaries', function() {
    assert.strictEqual(_cfsComputeTreeDepth(0), 0);
    assert.strictEqual(_cfsComputeTreeDepth(1), 0);
    assert.strictEqual(_cfsComputeTreeDepth(65536), 0);    // exactly 1 leaf
    assert.strictEqual(_cfsComputeTreeDepth(65537), 1);    // spills into 2nd leaf
    assert.strictEqual(_cfsComputeTreeDepth(9 * 65536), 1); // last block of depth 1
    assert.strictEqual(_cfsComputeTreeDepth(9 * 65536 + 1), 2);
  });

  it('cfsCreateSubdir: parent gets DIR entry, child sector has self-ref + parent ptr', function() {
    var buf = new ArrayBuffer(1024 * 1024);
    var d = new Uint8Array(buf);
    var partStart = 2, partEnd = 100;
    for (var i = 0; i < 512; i++) d[2 * 512 + i] = 0xFF;
    cfsMarkSectorUsed(buf, partStart, 2);
    cfsMarkSectorUsed(buf, partStart, 5);
    writeCfsEntry(d, 5, 0, { name: 'ROOT', ftype: 3, typeSuffix: 'DIR', attrByte: 0x7B });

    var res = cfsCreateSubdir(buf, partStart, partEnd, 5, 'GAMES');
    assert.ok(res.ok, res.error || '');
    assert.strictEqual(res.dirLba, 5);
    assert.ok(res.slotIndex >= 1);
    assert.ok(res.newDirLba > 5);

    // Parent dir now has the outgoing GAMES entry
    var parentEntries = readCfsDirectorySector(buf, 5);
    var gamesInParent = parentEntries[res.slotIndex];
    assert.strictEqual(petsciiToReadable(gamesInParent.name), 'GAMES');
    assert.strictEqual(gamesInParent.ftype, CFS_FTYPE.DIR);
    assert.strictEqual(gamesInParent.typeSuffix, 'DIR');
    assert.strictEqual(gamesInParent.dataTreePtr.addr, res.newDirLba);

    // Walking into the new dir gives a self-reference at slot 0
    var subEntries = readCfsDirectorySector(buf, res.newDirLba);
    assert.strictEqual(petsciiToReadable(subEntries[0].name), 'GAMES');
    assert.strictEqual(subEntries[0].ftype, CFS_FTYPE.DIR);
    assert.strictEqual(subEntries[0].isSelfRef, true);
    assert.strictEqual(subEntries[0].dataTreePtr.addr, 5); // parent ptr at \$14..\$17

    // New dir sector is bitmap-used
    assert.strictEqual(cfsIsSectorFree(buf, partStart, res.newDirLba), false);

    // Slots 1..15 of new dir are empty
    for (var s = 1; s < 16; s++) {
      assert.strictEqual(subEntries[s].empty, true);
    }
  });

  it('createEmptyHdd produces a valid .hdd that round-trips through the reader', function() {
    var buf = createEmptyHdd(4, { label: 'TEST 4MIB', partitionName: 'MAIN' });
    assert.ok(buf);
    assert.strictEqual(buf.byteLength, 4 * 1024 * 1024);

    // Detection
    assert.strictEqual(isIde64Hdd(buf), true);
    var detect = detectFormat(buf.byteLength, buf);
    assert.strictEqual(detect.format, DISK_FORMATS.hdd);

    // Boot sector
    var boot = parseIde64BootSector(buf);
    assert.strictEqual(boot.label, 'TEST 4MIB');
    assert.strictEqual(boot.defaultPart, 0);
    assert.strictEqual(boot.partDir.addr, 1);

    // One CFS partition, the rest empty
    var info = readIde64Partitions(buf);
    assert.strictEqual(info.partitions.filter(function(p) { return !p.empty; }).length, 1);
    var p0 = info.partitions[0];
    assert.strictEqual(p0.empty, false);
    assert.strictEqual(p0.type, 0x01);
    assert.strictEqual(p0.typeName, 'CFS');
    assert.strictEqual(petsciiToReadable(p0.name), 'MAIN');
    assert.strictEqual(p0.startLba, 2);
    assert.strictEqual(p0.endLba, 4 * 1024 * 1024 / 512 - 1);

    // Root directory: self-ref + %DELETED FILES% + empty slots
    var entries = readCfsDirectory(buf, p0.cfsRootDir.addr);
    assert.strictEqual(petsciiToReadable(entries[0].name), 'MAIN');
    assert.strictEqual(entries[0].ftype, CFS_FTYPE.DIR);
    assert.strictEqual(entries[0].isSelfRef, true);
    assert.strictEqual(petsciiToReadable(entries[1].name), '%DELETED  FILES%');
    for (var i = 2; i < 16; i++) assert.strictEqual(entries[i].empty, true);

    // Importing a file works on the fresh image
    var payload = new Uint8Array(200);
    for (var pp = 0; pp < 200; pp++) payload[pp] = (pp ^ 0x55) & 0xFF;
    var imp = cfsImportFile(buf, p0.startLba, p0.endLba, p0.cfsRootDir.addr, 'HELLO', payload);
    assert.ok(imp.ok, imp.error || '');
    var after = readCfsDirectory(buf, p0.cfsRootDir.addr);
    assert.ok(after.some(function(e) { return petsciiToReadable(e.name) === 'HELLO' && e.size === 200; }));
  });

  it('cfsAddPartitionToTable + cfsInitPartitionStorage build a working second partition', function() {
    var buf = createEmptyHdd(8); // 8 MiB; default first partition covers it all
    // Replace by shrinking the first partition and creating a second.
    // Trim partition 0 to end at LBA 4096; create partition 1 covering 4097..end.
    var d = new Uint8Array(buf);
    var totalLbas = 8 * 1024 * 1024 / 512;

    // Manually trim partition 0's end LBA to 4096
    var pte = 1 * 512; // slot 0
    var newEnd0 = 4096;
    d[pte + 0x14] = 0x50 | ((newEnd0 >>> 24) & 0x0F);
    d[pte + 0x15] = (newEnd0 >>> 16) & 0xFF;
    d[pte + 0x16] = (newEnd0 >>> 8) & 0xFF;
    d[pte + 0x17] = newEnd0 & 0xFF;

    // Init storage for the new partition in LBAs 4097..(totalLbas-1)
    var p2Start = 4097;
    var p2End = totalLbas - 1;
    var init = cfsInitPartitionStorage(buf, p2Start, p2End, 'SECOND');
    assert.ok(init.ok, init.error || '');
    var add = cfsAddPartitionToTable(buf, 1, 'SECOND', p2Start, p2End, init.rootDirLba, init.deletedDirLba);
    assert.ok(add.ok, add.error || '');

    // Now readIde64Partitions reports both
    var info = readIde64Partitions(buf);
    var active = info.partitions.filter(function(p) { return !p.empty; });
    assert.strictEqual(active.length, 2);
    assert.strictEqual(petsciiToReadable(active[1].name), 'SECOND');
    assert.strictEqual(active[1].startLba, p2Start);

    // Drilling into the new partition works
    var p2Entries = readCfsDirectory(buf, active[1].cfsRootDir.addr);
    assert.strictEqual(petsciiToReadable(p2Entries[0].name), 'SECOND');
    assert.strictEqual(p2Entries[0].isSelfRef, true);
  });

  it('cfsCreateSubdir is reachable by cfsResolvePath after creation', function() {
    var buf = new ArrayBuffer(1024 * 1024);
    var d = new Uint8Array(buf);
    var partStart = 2, partEnd = 100;
    for (var i = 0; i < 512; i++) d[2 * 512 + i] = 0xFF;
    cfsMarkSectorUsed(buf, partStart, 2);
    cfsMarkSectorUsed(buf, partStart, 5);
    writeCfsEntry(d, 5, 0, { name: 'ROOT', ftype: 3, typeSuffix: 'DIR', attrByte: 0x7B });

    cfsCreateSubdir(buf, partStart, partEnd, 5, 'INNER');
    var resolved = cfsResolvePath(buf, 5, 'INNER');
    assert.ok(resolved);
    assert.strictEqual(petsciiToReadable(resolved.name), 'INNER');
    assert.strictEqual(resolved.ftype, CFS_FTYPE.DIR);
  });

  it('cfsImportFile rolls back partial allocations on bitmap exhaustion', function() {
    var buf = new ArrayBuffer(2 * 1024 * 1024);
    var d = new Uint8Array(buf);
    var partStart = 2, partEnd = 10; // tiny partition
    for (var i = 0; i < 512; i++) d[2 * 512 + i] = 0xFF;
    cfsMarkSectorUsed(buf, partStart, 2);
    cfsMarkSectorUsed(buf, partStart, 5);
    writeCfsEntry(d, 5, 0, { name: 'D', ftype: 3, typeSuffix: 'DIR', attrByte: 0x83 });

    // Want 10 sectors of data — partition only has ~3 free LBAs (3, 4, 6..10)
    var size = 10 * 512;
    var payload = new Uint8Array(size);
    var res = cfsImportFile(buf, partStart, partEnd, 5, 'X', payload);
    assert.strictEqual(res.ok, false);

    // None of the few free LBAs should be left marked used
    for (var lba = 3; lba <= partEnd; lba++) {
      if (lba === 5) continue; // dir sector — was used before
      assert.strictEqual(cfsIsSectorFree(buf, partStart, lba), true, 'LBA ' + lba + ' should be free after rollback');
    }
  });
});

describe('CFS write — attribute byte', function() {
  it('cfsWriteDirEntryAttrByte updates byte $18 directly', function() {
    var buf = new ArrayBuffer(64 * 1024);
    var d = new Uint8Array(buf);
    writeCfsEntry(d, 10, 1, { name: 'X', ftype: 1, attrByte: 0x80 | 1 });

    // Toggle on Writeable (0x10) and Readable (0x20)
    var oldAttr = d[10 * 512 + 32 + 0x18];
    var newAttr = oldAttr | 0x10 | 0x20;
    assert.strictEqual(cfsWriteDirEntryAttrByte(buf, 10, 1, newAttr), true);

    var entries = readCfsDirectorySector(buf, 10);
    assert.strictEqual(entries[1].attrByte, newAttr);
    assert.strictEqual(entries[1].ftype, 1); // file type preserved
  });

  it('rejects out-of-range slots / buffers', function() {
    var buf = new ArrayBuffer(1024);
    assert.strictEqual(cfsWriteDirEntryAttrByte(buf, 10, 1, 0x80), false);
    assert.strictEqual(cfsWriteDirEntryAttrByte(buf, 0, -1, 0x80), false);
    assert.strictEqual(cfsWriteDirEntryAttrByte(buf, 0, 16, 0x80), false);
  });
});

// Helper: write a self-ref entry pointing at the next-dir-sector via the
// bit-sliced encoding _cfsReadDirNext expects. Without this, dir-chain
// walks stop at sector 0 instead of following the chain.
function writeDirSelfRef(d, dirLba, parentLba, nextLba, name, suffix) {
  var eo = dirLba * 512;
  for (var n = 0; n < 16; n++) d[eo + n] = n < name.length ? name.charCodeAt(n) : 0x20;
  d[eo + 0x10] = parentLba & 0xFF;
  d[eo + 0x11] = (parentLba >>> 8) & 0xFF;
  d[eo + 0x12] = (parentLba >>> 16) & 0xFF;
  d[eo + 0x13] = 0xC0 | ((parentLba >>> 24) & 0x0F); // VALID + LBA
  d[eo + 0x14] = 0xC0 | ((nextLba >>> 24) & 0x0F);
  d[eo + 0x15] = (nextLba >>> 16) & 0xFF;
  d[eo + 0x16] = (nextLba >>> 8) & 0xFF;
  d[eo + 0x17] = nextLba & 0xFF;
  d[eo + 0x18] = 0x80 | (3 & 0x07); // DIR + Closed
  for (var s = 0; s < 3; s++) d[eo + 0x19 + s] = s < suffix.length ? suffix.charCodeAt(s) : 0x20;
}

describe('CFS delete — directory recursion (Phase A\')', function() {
  it('deleting a non-empty subdir marks each child slot DEL and frees every sector', function() {
    var buf = new ArrayBuffer(2 * 1024 * 1024);
    var d = new Uint8Array(buf);
    var partStart = 2, partEnd = 1000;
    for (var i = 0; i < 512; i++) d[partStart * 512 + i] = 0xFF;
    cfsMarkSectorUsed(buf, partStart, partStart);
    cfsMarkSectorUsed(buf, partStart, 5); // root dir

    // Root dir at LBA 5 — self-ref + one subdir entry pointing at LBA 10
    writeDirSelfRef(d, 5, 5, 0, 'ROOT', 'DIR');
    cfsMarkSectorUsed(buf, partStart, 10);
    writeCfsEntry(d, 5, 1, { name: 'SUBDIR', ftype: 3, typeSuffix: 'DIR', attrByte: 0xFB });
    // Patch its data-tree pointer to LBA 10
    d[5 * 512 + 32 + 0x14] = 0xC0;
    d[5 * 512 + 32 + 0x15] = 0;
    d[5 * 512 + 32 + 0x16] = 0;
    d[5 * 512 + 32 + 0x17] = 10;

    // SUBDIR at LBA 10 — self-ref + two files (HELLO, WORLD)
    writeDirSelfRef(d, 10, 5, 0, 'SUBDIR', 'DIR');
    var r1 = cfsImportSingleSectorFile(buf, partStart, partEnd, 10, 'HELLO', new Uint8Array([1, 2, 3]), { ftype: 1, typeSuffix: 'PRG' });
    assert.ok(r1.ok);
    var r2 = cfsImportSingleSectorFile(buf, partStart, partEnd, 10, 'WORLD', new Uint8Array([4, 5, 6]), { ftype: 1, typeSuffix: 'PRG' });
    assert.ok(r2.ok);

    // Sanity: those sectors are now allocated
    assert.strictEqual(cfsIsSectorFree(buf, partStart, 10), false);
    assert.strictEqual(cfsIsSectorFree(buf, partStart, r1.treeLba), false);
    assert.strictEqual(cfsIsSectorFree(buf, partStart, r1.dataLbas[0]), false);
    assert.strictEqual(cfsIsSectorFree(buf, partStart, r2.treeLba), false);
    assert.strictEqual(cfsIsSectorFree(buf, partStart, r2.dataLbas[0]), false);

    // Delete the subdir entry from root
    var rootEntries = readCfsDirectorySector(buf, 5);
    var subdirEntry = rootEntries[1];
    subdirEntry.dirLba = 5;
    var delRes = cfsDeleteFile(buf, partStart, partEnd, subdirEntry);
    assert.ok(delRes.ok, delRes.error || '');

    // Parent's slot in root → DEL
    var after = readCfsDirectorySector(buf, 5);
    assert.strictEqual(after[1].ftype, 0);
    assert.strictEqual((after[1].attrByte & 0x80) !== 0, false);
    assert.strictEqual(after[1].typeSuffix, 'DIR'); // preserved

    // Child entries inside the now-freed dir sector: bytes still readable
    // — IDEDOS marks each entry DEL before freeing the sector, so the
    // attr bytes show 0x78 even though the sector is unallocated.
    var helloAttr = d[10 * 512 + r1.slotIndex * 32 + 0x18];
    var worldAttr = d[10 * 512 + r2.slotIndex * 32 + 0x18];
    assert.strictEqual(helloAttr & 0x07, 0); // ftype DEL
    assert.strictEqual(helloAttr & 0x80, 0); // Closed cleared
    assert.strictEqual(worldAttr & 0x07, 0);
    assert.strictEqual(worldAttr & 0x80, 0);

    // Bitmap: every sector that belonged to the subdir or its children is now free
    assert.strictEqual(cfsIsSectorFree(buf, partStart, 10), true); // dir sector
    assert.strictEqual(cfsIsSectorFree(buf, partStart, r1.treeLba), true);
    assert.strictEqual(cfsIsSectorFree(buf, partStart, r1.dataLbas[0]), true);
    assert.strictEqual(cfsIsSectorFree(buf, partStart, r2.treeLba), true);
    assert.strictEqual(cfsIsSectorFree(buf, partStart, r2.dataLbas[0]), true);
  });

  it('refuses to re-scratch an already-deleted entry', function() {
    var buf = new ArrayBuffer(64 * 1024);
    var d = new Uint8Array(buf);
    var partStart = 2, partEnd = 100;
    for (var i = 0; i < 512; i++) d[partStart * 512 + i] = 0xFF;
    cfsMarkSectorUsed(buf, partStart, partStart);
    cfsMarkSectorUsed(buf, partStart, 5);
    writeCfsEntry(d, 5, 0, { name: 'D', ftype: 3, typeSuffix: 'DIR', attrByte: 0x83 });
    writeCfsEntry(d, 5, 1, { name: 'GONE', ftype: 0, typeSuffix: 'PRG', attrByte: 0x78 });
    var entries = readCfsDirectorySector(buf, 5);
    entries[1].dirLba = 5;
    var res = cfsDeleteFile(buf, partStart, partEnd, entries[1]);
    assert.strictEqual(res.ok, false);
    assert.match(res.error, /already deleted/);
  });
});

describe('CFS unscratch (Phase C)', function() {
  it('round-trips: import → scratch → unscratch reclaims every sector and restores ftype', function() {
    var buf = new ArrayBuffer(2 * 1024 * 1024);
    var d = new Uint8Array(buf);
    var partStart = 2, partEnd = 1000;
    for (var i = 0; i < 512; i++) d[partStart * 512 + i] = 0xFF;
    cfsMarkSectorUsed(buf, partStart, partStart);
    cfsMarkSectorUsed(buf, partStart, 5);
    writeCfsEntry(d, 5, 0, { name: 'D', ftype: 3, typeSuffix: 'DIR', attrByte: 0x83 });

    var size = 3 * 512 + 100;
    var payload = new Uint8Array(size);
    for (var pi = 0; pi < size; pi++) payload[pi] = pi & 0xFF;
    var imp = cfsImportFile(buf, partStart, partEnd, 5, 'FILE', payload, { ftype: 1, typeSuffix: 'PRG' });
    assert.ok(imp.ok);
    var allocated = [imp.treeLba].concat(imp.dataLbas);

    var beforeEntries = readCfsDirectorySector(buf, 5);
    beforeEntries[imp.slotIndex].dirLba = 5;
    cfsDeleteFile(buf, partStart, partEnd, beforeEntries[imp.slotIndex]);

    // Sectors all free post-delete
    for (var ai = 0; ai < allocated.length; ai++) {
      assert.strictEqual(cfsIsSectorFree(buf, partStart, allocated[ai]), true, 'post-delete LBA ' + allocated[ai]);
    }

    // Unscratch
    var afterDel = readCfsDirectorySector(buf, 5);
    afterDel[imp.slotIndex].dirLba = 5;
    assert.strictEqual(afterDel[imp.slotIndex].ftype, 0);
    var un = cfsUnscratchEntry(buf, partStart, partEnd, afterDel[imp.slotIndex]);
    assert.ok(un.ok, un.error || '');
    assert.strictEqual(un.restoredFtype, 1); // NORMAL (PRG)
    assert.strictEqual(un.sectorsReclaimed, allocated.length);

    // Sectors are all used again, ftype back to NORMAL + Closed set
    for (var ai2 = 0; ai2 < allocated.length; ai2++) {
      assert.strictEqual(cfsIsSectorFree(buf, partStart, allocated[ai2]), false, 'post-unscratch LBA ' + allocated[ai2]);
    }
    var restored = readCfsDirectorySector(buf, 5);
    assert.strictEqual(restored[imp.slotIndex].ftype, 1);
    assert.strictEqual(restored[imp.slotIndex].closed, true);
    assert.strictEqual(restored[imp.slotIndex].typeSuffix, 'PRG');
    assert.strictEqual(restored[imp.slotIndex].size, size);
  });

  it('refuses when a tree/data sector has been reallocated', function() {
    var buf = new ArrayBuffer(2 * 1024 * 1024);
    var d = new Uint8Array(buf);
    var partStart = 2, partEnd = 1000;
    for (var i = 0; i < 512; i++) d[partStart * 512 + i] = 0xFF;
    cfsMarkSectorUsed(buf, partStart, partStart);
    cfsMarkSectorUsed(buf, partStart, 5);
    writeCfsEntry(d, 5, 0, { name: 'D', ftype: 3, typeSuffix: 'DIR', attrByte: 0x83 });
    var imp = cfsImportSingleSectorFile(buf, partStart, partEnd, 5, 'F', new Uint8Array([1, 2, 3]), { ftype: 1, typeSuffix: 'PRG' });
    var beforeEntries = readCfsDirectorySector(buf, 5);
    beforeEntries[imp.slotIndex].dirLba = 5;
    cfsDeleteFile(buf, partStart, partEnd, beforeEntries[imp.slotIndex]);

    // Someone else allocates the (now-free) data sector
    cfsMarkSectorUsed(buf, partStart, imp.dataLbas[0]);

    var afterDel = readCfsDirectorySector(buf, 5);
    afterDel[imp.slotIndex].dirLba = 5;
    var un = cfsUnscratchEntry(buf, partStart, partEnd, afterDel[imp.slotIndex]);
    assert.strictEqual(un.ok, false);
    assert.match(un.error, /allocated to another file/);
  });

  it('recursive: restoring a deleted dir also restores every DEL child + grandchild', function() {
    var buf = new ArrayBuffer(2 * 1024 * 1024);
    var d = new Uint8Array(buf);
    var partStart = 2, partEnd = 1000;
    for (var i = 0; i < 512; i++) d[partStart * 512 + i] = 0xFF;
    cfsMarkSectorUsed(buf, partStart, partStart);
    cfsMarkSectorUsed(buf, partStart, 5);
    writeDirSelfRef(d, 5, 5, 0, 'ROOT', 'DIR');

    // Build root → SUBDIR → (HELLO file, NESTED dir → INNER file)
    writeCfsEntry(d, 5, 1, { name: 'SUBDIR', ftype: 3, typeSuffix: 'DIR', attrByte: 0xFB });
    cfsMarkSectorUsed(buf, partStart, 10);
    d[5 * 512 + 32 + 0x14] = 0xC0; d[5 * 512 + 32 + 0x17] = 10;
    writeDirSelfRef(d, 10, 5, 0, 'SUBDIR', 'DIR');
    var helloRes = cfsImportSingleSectorFile(buf, partStart, partEnd, 10, 'HELLO', new Uint8Array([1, 2, 3]), { ftype: 1, typeSuffix: 'PRG' });
    var nestedDirLba = cfsAllocSector(buf, partStart, partEnd, 10);
    writeCfsEntry(d, 10, 2, { name: 'NESTED', ftype: 3, typeSuffix: 'DIR', attrByte: 0xFB });
    d[10 * 512 + 64 + 0x14] = 0xC0 | ((nestedDirLba >>> 24) & 0x0F);
    d[10 * 512 + 64 + 0x15] = (nestedDirLba >>> 16) & 0xFF;
    d[10 * 512 + 64 + 0x16] = (nestedDirLba >>> 8) & 0xFF;
    d[10 * 512 + 64 + 0x17] = nestedDirLba & 0xFF;
    writeDirSelfRef(d, nestedDirLba, 10, 0, 'NESTED', 'DIR');
    var innerRes = cfsImportSingleSectorFile(buf, partStart, partEnd, nestedDirLba, 'INNER', new Uint8Array([7, 8, 9]), { ftype: 1, typeSuffix: 'PRG' });

    // Delete SUBDIR — recursive scratch frees everything.
    var rootEntries = readCfsDirectorySector(buf, 5);
    rootEntries[1].dirLba = 5;
    cfsDeleteFile(buf, partStart, partEnd, rootEntries[1]);
    assert.strictEqual(cfsIsSectorFree(buf, partStart, 10), true);
    assert.strictEqual(cfsIsSectorFree(buf, partStart, nestedDirLba), true);
    assert.strictEqual(cfsIsSectorFree(buf, partStart, helloRes.dataLbas[0]), true);
    assert.strictEqual(cfsIsSectorFree(buf, partStart, innerRes.dataLbas[0]), true);

    // Restore SUBDIR — should bring back the entire tree.
    var afterDel = readCfsDirectorySector(buf, 5);
    afterDel[1].dirLba = 5;
    var un = cfsUnscratchEntry(buf, partStart, partEnd, afterDel[1]);
    assert.ok(un.ok, un.error || '');
    assert.strictEqual(un.restoredFtype, 3);
    assert.ok(un.childrenRestored >= 3, 'expected ≥3 children restored, got ' + un.childrenRestored);
    assert.strictEqual(un.childrenFailed, 0);

    // SUBDIR + every leaf entry is live again
    var subdirEntries = readCfsDirectorySector(buf, 10);
    var helloEntry = subdirEntries[helloRes.slotIndex];
    var nestedEntry = subdirEntries[2];
    assert.strictEqual(helloEntry.ftype, 1);
    assert.strictEqual(helloEntry.closed, true);
    assert.strictEqual(nestedEntry.ftype, 3);
    var innerEntries = readCfsDirectorySector(buf, nestedDirLba);
    var innerEntry = innerEntries[innerRes.slotIndex];
    assert.strictEqual(innerEntry.ftype, 1);
    assert.strictEqual(innerEntry.closed, true);

    // Bitmap: every previously-freed sector is allocated again
    assert.strictEqual(cfsIsSectorFree(buf, partStart, 10), false);
    assert.strictEqual(cfsIsSectorFree(buf, partStart, nestedDirLba), false);
    assert.strictEqual(cfsIsSectorFree(buf, partStart, helloRes.dataLbas[0]), false);
    assert.strictEqual(cfsIsSectorFree(buf, partStart, innerRes.dataLbas[0]), false);
  });

  it('recursive: childrenFailed counts children whose sectors got reallocated', function() {
    var buf = new ArrayBuffer(2 * 1024 * 1024);
    var d = new Uint8Array(buf);
    var partStart = 2, partEnd = 1000;
    for (var i = 0; i < 512; i++) d[partStart * 512 + i] = 0xFF;
    cfsMarkSectorUsed(buf, partStart, partStart);
    cfsMarkSectorUsed(buf, partStart, 5);
    writeDirSelfRef(d, 5, 5, 0, 'ROOT', 'DIR');
    writeCfsEntry(d, 5, 1, { name: 'SUBDIR', ftype: 3, typeSuffix: 'DIR', attrByte: 0xFB });
    cfsMarkSectorUsed(buf, partStart, 10);
    d[5 * 512 + 32 + 0x14] = 0xC0; d[5 * 512 + 32 + 0x17] = 10;
    writeDirSelfRef(d, 10, 5, 0, 'SUBDIR', 'DIR');
    var r1 = cfsImportSingleSectorFile(buf, partStart, partEnd, 10, 'KEEP', new Uint8Array([1]), { ftype: 1, typeSuffix: 'PRG' });
    var r2 = cfsImportSingleSectorFile(buf, partStart, partEnd, 10, 'LOST', new Uint8Array([2]), { ftype: 1, typeSuffix: 'PRG' });

    var rootEntries = readCfsDirectorySector(buf, 5);
    rootEntries[1].dirLba = 5;
    cfsDeleteFile(buf, partStart, partEnd, rootEntries[1]);

    // Someone reallocates r2's data sector before we restore
    cfsMarkSectorUsed(buf, partStart, r2.dataLbas[0]);

    var afterDel = readCfsDirectorySector(buf, 5);
    afterDel[1].dirLba = 5;
    var un = cfsUnscratchEntry(buf, partStart, partEnd, afterDel[1]);
    assert.ok(un.ok);
    assert.strictEqual(un.childrenRestored, 1); // KEEP
    assert.strictEqual(un.childrenFailed, 1);   // LOST
    var entries = readCfsDirectorySector(buf, 10);
    assert.strictEqual(entries[r1.slotIndex].ftype, 1); // KEEP is live
    assert.strictEqual(entries[r2.slotIndex].ftype, 0); // LOST stays DEL
  });

  it('unscratches a deleted directory entry (DIR ftype)', function() {
    var buf = new ArrayBuffer(2 * 1024 * 1024);
    var d = new Uint8Array(buf);
    var partStart = 2, partEnd = 1000;
    for (var i = 0; i < 512; i++) d[partStart * 512 + i] = 0xFF;
    cfsMarkSectorUsed(buf, partStart, partStart);
    cfsMarkSectorUsed(buf, partStart, 5);

    // Parent dir entry pointing to subdir at LBA 10
    writeDirSelfRef(d, 5, 5, 0, 'ROOT', 'DIR');
    writeCfsEntry(d, 5, 1, { name: 'EMPTYDIR', ftype: 3, typeSuffix: 'DIR', attrByte: 0xFB });
    d[5 * 512 + 32 + 0x14] = 0xC0;
    d[5 * 512 + 32 + 0x17] = 10;
    cfsMarkSectorUsed(buf, partStart, 10);
    writeDirSelfRef(d, 10, 5, 0, 'EMPTYDIR', 'DIR');

    var rootEntries = readCfsDirectorySector(buf, 5);
    rootEntries[1].dirLba = 5;
    cfsDeleteFile(buf, partStart, partEnd, rootEntries[1]);
    assert.strictEqual(cfsIsSectorFree(buf, partStart, 10), true);

    var afterDel = readCfsDirectorySector(buf, 5);
    afterDel[1].dirLba = 5;
    var un = cfsUnscratchEntry(buf, partStart, partEnd, afterDel[1]);
    assert.ok(un.ok, un.error || '');
    assert.strictEqual(un.restoredFtype, 3); // DIR

    var restored = readCfsDirectorySector(buf, 5);
    assert.strictEqual(restored[1].ftype, 3);
    assert.strictEqual(restored[1].closed, true);
    assert.strictEqual(cfsIsSectorFree(buf, partStart, 10), false);
  });
});

describe('cfsTouchEntryMtime / encodeCfsTimestamp', function() {
  it('encodeCfsTimestamp round-trips through decodeCfsTimestamp', function() {
    var date = new Date(2026, 4, 16, 14, 27, 53); // May 16 2026 14:27:53
    var bytes = encodeCfsTimestamp(date);
    var ts = decodeCfsTimestamp(bytes[0], bytes[1], bytes[2], bytes[3]);
    assert.strictEqual(ts.year, 2026);
    assert.strictEqual(ts.month, 5);
    assert.strictEqual(ts.day, 16);
    assert.strictEqual(ts.hour, 14);
    assert.strictEqual(ts.min, 27);
    assert.strictEqual(ts.sec, 53);
  });

  it('clamps year to 1980..2043 (6-bit field)', function() {
    var early = encodeCfsTimestamp(new Date(1970, 0, 1));
    var late = encodeCfsTimestamp(new Date(2099, 11, 31));
    assert.strictEqual(decodeCfsTimestamp(early[0], early[1], early[2], early[3]).year, 1980);
    assert.strictEqual(decodeCfsTimestamp(late[0], late[1], late[2], late[3]).year, 2043);
  });

  it('cfsTouchEntryMtime writes a non-zero timestamp at $1C..$1F', function() {
    var buf = new ArrayBuffer(64 * 1024);
    var d = new Uint8Array(buf);
    writeCfsEntry(d, 5, 1, { name: 'X', ftype: 1, typeSuffix: 'PRG' });
    var fixed = new Date(2026, 0, 15, 10, 30, 0);
    assert.strictEqual(cfsTouchEntryMtime(buf, 5, 1, fixed), true);
    var entries = readCfsDirectorySector(buf, 5);
    assert.ok(entries[1].mtime, 'mtime should not be null');
    assert.strictEqual(entries[1].mtime.year, 2026);
    assert.strictEqual(entries[1].mtime.month, 1);
    assert.strictEqual(entries[1].mtime.day, 15);
  });

  it('cfsImportFile, cfsInsertPlaceholderEntry, cfsWriteDirEntryName, cfsWriteDirEntryAttrByte, cfsWriteFileSize each stamp mtime', function() {
    var buf = new ArrayBuffer(2 * 1024 * 1024);
    var d = new Uint8Array(buf);
    var partStart = 2, partEnd = 1000;
    for (var i = 0; i < 512; i++) d[partStart * 512 + i] = 0xFF;
    cfsMarkSectorUsed(buf, partStart, partStart);
    cfsMarkSectorUsed(buf, partStart, 5);
    writeCfsEntry(d, 5, 0, { name: 'D', ftype: 3, typeSuffix: 'DIR', attrByte: 0x83 });

    // Import — mtime should be set
    var imp = cfsImportSingleSectorFile(buf, partStart, partEnd, 5, 'F', new Uint8Array([1]), { ftype: 1, typeSuffix: 'PRG' });
    var afterImport = readCfsDirectorySector(buf, 5)[imp.slotIndex].mtime;
    assert.ok(afterImport, 'mtime set on import');

    // Zero the mtime, then rename — mtime should be re-stamped
    var slotOff = 5 * 512 + imp.slotIndex * 32;
    d[slotOff + 0x1C] = 0; d[slotOff + 0x1D] = 0; d[slotOff + 0x1E] = 0; d[slotOff + 0x1F] = 0;
    cfsWriteDirEntryName(buf, 5, imp.slotIndex, 'F2');
    assert.ok(readCfsDirectorySector(buf, 5)[imp.slotIndex].mtime, 'mtime set on rename');

    // Zero again, attr toggle — mtime should be set
    d[slotOff + 0x1C] = 0; d[slotOff + 0x1D] = 0; d[slotOff + 0x1E] = 0; d[slotOff + 0x1F] = 0;
    cfsWriteDirEntryAttrByte(buf, 5, imp.slotIndex, 0xF9);
    assert.ok(readCfsDirectorySector(buf, 5)[imp.slotIndex].mtime, 'mtime set on attr edit');

    // Zero again, size edit — mtime should be set
    d[slotOff + 0x1C] = 0; d[slotOff + 0x1D] = 0; d[slotOff + 0x1E] = 0; d[slotOff + 0x1F] = 0;
    cfsWriteFileSize(buf, 5, imp.slotIndex, 1234, CFS_FTYPE.NORMAL);
    assert.ok(readCfsDirectorySector(buf, 5)[imp.slotIndex].mtime, 'mtime set on size edit');

    // Placeholder insert — mtime set
    var ph = cfsInsertPlaceholderEntry(buf, 5, 'PLACE', { ftype: CFS_FTYPE.NORMAL, typeSuffix: 'PRG' });
    assert.ok(readCfsDirectorySector(buf, 5)[ph.slotIndex].mtime, 'mtime set on placeholder');
  });

  it('cfsDeleteFile + cfsUnscratchEntry preserve original mtime', function() {
    var buf = new ArrayBuffer(2 * 1024 * 1024);
    var d = new Uint8Array(buf);
    var partStart = 2, partEnd = 1000;
    for (var i = 0; i < 512; i++) d[partStart * 512 + i] = 0xFF;
    cfsMarkSectorUsed(buf, partStart, partStart);
    cfsMarkSectorUsed(buf, partStart, 5);
    writeCfsEntry(d, 5, 0, { name: 'D', ftype: 3, typeSuffix: 'DIR', attrByte: 0x83 });
    var imp = cfsImportSingleSectorFile(buf, partStart, partEnd, 5, 'F', new Uint8Array([1]), { ftype: 1, typeSuffix: 'PRG' });
    var origMtime = readCfsDirectorySector(buf, 5)[imp.slotIndex].mtime;

    var entry = readCfsDirectorySector(buf, 5)[imp.slotIndex];
    entry.dirLba = 5;
    cfsDeleteFile(buf, partStart, partEnd, entry);
    // After scratch — mtime still equal to original
    var afterScratch = readCfsDirectorySector(buf, 5)[imp.slotIndex].mtime;
    assert.deepStrictEqual(afterScratch.raw, origMtime.raw, 'scratch preserves mtime');

    var del = readCfsDirectorySector(buf, 5)[imp.slotIndex];
    del.dirLba = 5;
    cfsUnscratchEntry(buf, partStart, partEnd, del);
    var afterRestore = readCfsDirectorySector(buf, 5)[imp.slotIndex].mtime;
    assert.deepStrictEqual(afterRestore.raw, origMtime.raw, 'unscratch preserves mtime');
  });
});

describe('cfsSwapDirSlots / cfsCollectDirSlots', function() {
  it('swaps slot contents but preserves bits 5..4 of byte $14 in each slot', function() {
    var buf = new ArrayBuffer(64 * 1024);
    var d = new Uint8Array(buf);
    writeCfsEntry(d, 5, 0, { name: 'D', ftype: 3, typeSuffix: 'DIR', attrByte: 0x83 });
    writeCfsEntry(d, 5, 1, { name: 'A', ftype: 1, typeSuffix: 'PRG', attrByte: 0xF9 });
    writeCfsEntry(d, 5, 2, { name: 'B', ftype: 1, typeSuffix: 'PRG', attrByte: 0xF9 });
    // Stash distinguishable dir-next bits in each slot's byte $14 bits 5..4
    d[5 * 512 + 1 * 32 + 0x14] |= 0x10; // slot 1 → bit 4
    d[5 * 512 + 2 * 32 + 0x14] |= 0x20; // slot 2 → bit 5
    var aBitsBefore = d[5 * 512 + 1 * 32 + 0x14] & 0x30;
    var bBitsBefore = d[5 * 512 + 2 * 32 + 0x14] & 0x30;
    assert.strictEqual(aBitsBefore, 0x10);
    assert.strictEqual(bBitsBefore, 0x20);

    cfsSwapDirSlots(buf, { dirLba: 5, slotIndex: 1 }, { dirLba: 5, slotIndex: 2 });

    var entries = readCfsDirectorySector(buf, 5);
    // Names swapped
    assert.strictEqual(petsciiToReadable(entries[1].name), 'B');
    assert.strictEqual(petsciiToReadable(entries[2].name), 'A');
    // Dir-next bits stayed put with each slot
    assert.strictEqual(d[5 * 512 + 1 * 32 + 0x14] & 0x30, 0x10);
    assert.strictEqual(d[5 * 512 + 2 * 32 + 0x14] & 0x30, 0x20);
  });

  it('cfsCollectDirSlots skips slot 0 of the first sector (self-ref)', function() {
    var buf = new ArrayBuffer(64 * 1024);
    var d = new Uint8Array(buf);
    writeCfsEntry(d, 5, 0, { name: 'D', ftype: 3, typeSuffix: 'DIR', attrByte: 0x83 });
    var slots = cfsCollectDirSlots(buf, 5);
    assert.strictEqual(slots.length, 15);
    assert.strictEqual(slots[0].slotIndex, 1, 'first listed slot is index 1, not 0');
    assert.strictEqual(slots[14].slotIndex, 15);
  });
});

describe('cfsCountUsedBlocks', function() {
  it('counts allocated sectors via popcount on the partition bitmap', function() {
    var buf = new ArrayBuffer(2 * 1024 * 1024);
    var d = new Uint8Array(buf);
    var partStart = 2, partEnd = 1000; // 999 sectors total
    // Empty bitmap (all 0xFF = all free) → 0 used
    for (var i = 0; i < 512; i++) d[partStart * 512 + i] = 0xFF;
    assert.strictEqual(cfsCountUsedBlocks(buf, partStart, partEnd), 0);

    // Mark the bitmap, root dir, and a file's tree + data → 4 used
    cfsMarkSectorUsed(buf, partStart, partStart);
    cfsMarkSectorUsed(buf, partStart, 5);
    cfsMarkSectorUsed(buf, partStart, 7);
    cfsMarkSectorUsed(buf, partStart, 8);
    assert.strictEqual(cfsCountUsedBlocks(buf, partStart, partEnd), 4);
  });

  it('matches a known-good count after Import → Scratch round-trip', function() {
    var buf = new ArrayBuffer(2 * 1024 * 1024);
    var d = new Uint8Array(buf);
    var partStart = 2, partEnd = 1000;
    for (var i = 0; i < 512; i++) d[partStart * 512 + i] = 0xFF;
    cfsMarkSectorUsed(buf, partStart, partStart);
    cfsMarkSectorUsed(buf, partStart, 5);
    writeCfsEntry(d, 5, 0, { name: 'D', ftype: 3, typeSuffix: 'DIR', attrByte: 0x83 });
    var beforeImport = cfsCountUsedBlocks(buf, partStart, partEnd);
    var imp = cfsImportFile(buf, partStart, partEnd, 5, 'F', new Uint8Array(2000), { ftype: 1, typeSuffix: 'PRG' });
    assert.ok(imp.ok);
    // Import adds tree + ceil(2000/512) = 4 data sectors = 5 sectors
    assert.strictEqual(cfsCountUsedBlocks(buf, partStart, partEnd), beforeImport + 5);
    // Scratch frees them all
    var entry = readCfsDirectorySector(buf, 5)[imp.slotIndex];
    entry.dirLba = 5;
    cfsDeleteFile(buf, partStart, partEnd, entry);
    assert.strictEqual(cfsCountUsedBlocks(buf, partStart, partEnd), beforeImport);
  });
});

describe('Lock / Splat attr-byte toggles (via cfsWriteDirEntryAttrByte)', function() {
  it('XOR 0x10 on attr byte toggles the W (writeable) bit — CFS lock', function() {
    var buf = new ArrayBuffer(64 * 1024);
    var d = new Uint8Array(buf);
    writeCfsEntry(d, 5, 1, { name: 'X', ftype: 1, typeSuffix: 'PRG', attrByte: 0xF9 });
    var before = readCfsDirectorySector(buf, 5)[1];
    assert.strictEqual((before.attrByte & 0x10) !== 0, true, 'starts writeable');
    cfsWriteDirEntryAttrByte(buf, 5, 1, before.attrByte ^ 0x10);
    var after = readCfsDirectorySector(buf, 5)[1];
    assert.strictEqual((after.attrByte & 0x10) !== 0, false, 'now locked');
    // Lock again → re-toggle restores
    cfsWriteDirEntryAttrByte(buf, 5, 1, after.attrByte ^ 0x10);
    var again = readCfsDirectorySector(buf, 5)[1];
    assert.strictEqual((again.attrByte & 0x10) !== 0, true, 'unlocked again');
  });

  it('XOR 0x80 on attr byte toggles the Closed bit — CFS splat', function() {
    var buf = new ArrayBuffer(64 * 1024);
    var d = new Uint8Array(buf);
    writeCfsEntry(d, 5, 1, { name: 'X', ftype: 1, typeSuffix: 'PRG', attrByte: 0xF9 });
    var before = readCfsDirectorySector(buf, 5)[1];
    assert.strictEqual(before.closed, true);
    cfsWriteDirEntryAttrByte(buf, 5, 1, before.attrByte ^ 0x80);
    assert.strictEqual(readCfsDirectorySector(buf, 5)[1].closed, false, 'splatted');
    cfsWriteDirEntryAttrByte(buf, 5, 1, readCfsDirectorySector(buf, 5)[1].attrByte ^ 0x80);
    assert.strictEqual(readCfsDirectorySector(buf, 5)[1].closed, true, 'unsplatted');
  });
});

describe('CFS copy/paste round-trip via cfsImportFile', function() {
  it('imported file read-back matches the original payload', function() {
    var buf = new ArrayBuffer(2 * 1024 * 1024);
    var d = new Uint8Array(buf);
    var partStart = 2, partEnd = 1000;
    for (var i = 0; i < 512; i++) d[partStart * 512 + i] = 0xFF;
    cfsMarkSectorUsed(buf, partStart, partStart);
    cfsMarkSectorUsed(buf, partStart, 5);
    writeCfsEntry(d, 5, 0, { name: 'D', ftype: 3, typeSuffix: 'DIR', attrByte: 0x83 });
    // Original file
    var payload = new Uint8Array(2500);
    for (var p = 0; p < 2500; p++) payload[p] = (p * 37 + 13) & 0xFF;
    var srcRes = cfsImportFile(buf, partStart, partEnd, 5, 'ORIG', payload, { ftype: 1, typeSuffix: 'PRG' });
    assert.ok(srcRes.ok);
    var src = readCfsDirectorySector(buf, 5)[srcRes.slotIndex];

    // Simulate the copy step: read the file's data + 16 name bytes
    var srcData = readCfsFileData(buf, src.dataTreePtr.addr, src.size).data;
    var nameBytes = new Uint8Array(16);
    var srcOff = 5 * 512 + srcRes.slotIndex * 32;
    for (var nb = 0; nb < 16; nb++) nameBytes[nb] = d[srcOff + nb];

    // Simulate the paste step: build name string from nameBytes
    var pName = '';
    for (var ni = 0; ni < 16; ni++) {
      var nbv = nameBytes[ni];
      if (nbv === 0xA0 || nbv === 0x00) break;
      pName += String.fromCharCode(nbv);
    }
    var dstRes = cfsImportFile(buf, partStart, partEnd, 5, pName, srcData, { ftype: 1, typeSuffix: 'PRG' });
    assert.ok(dstRes.ok);
    assert.notStrictEqual(dstRes.slotIndex, srcRes.slotIndex); // different slot
    var dst = readCfsDirectorySector(buf, 5)[dstRes.slotIndex];

    // Names match byte-for-byte
    var dstOff = 5 * 512 + dstRes.slotIndex * 32;
    for (var di = 0; di < 16; di++) assert.strictEqual(d[dstOff + di], d[srcOff + di], 'name byte ' + di);
    // typeSuffix matches
    assert.strictEqual(dst.typeSuffix, src.typeSuffix);
    // Payload reads back identical
    var dstData = readCfsFileData(buf, dst.dataTreePtr.addr, dst.size).data;
    assert.strictEqual(dstData.length, srcData.length);
    for (var bi = 0; bi < srcData.length; bi++) assert.strictEqual(dstData[bi], srcData[bi], 'byte ' + bi);
  });
});

describe('cfsInsertSeparator', function() {
  it('writes a Closed-DEL entry with attr byte 0xF8 and the pattern in the name field', function() {
    var buf = new ArrayBuffer(64 * 1024);
    var d = new Uint8Array(buf);
    writeCfsEntry(d, 5, 0, { name: 'D', ftype: 3, typeSuffix: 'DIR', attrByte: 0x83 });
    var pattern = [0x2D, 0x2D, 0x2D, 0x2D, 0x2D, 0x2D, 0x2D, 0x2D]; // 8 dashes
    var res = cfsInsertSeparator(buf, 5, pattern);
    assert.ok(res.ok, res.error || '');
    var slotOff = 5 * 512 + res.slotIndex * 32;
    // Pattern bytes 0..7, then $00 padding 8..15 (IDE64-native)
    for (var i = 0; i < 8; i++) assert.strictEqual(d[slotOff + i], 0x2D);
    for (var j = 8; j < 16; j++) assert.strictEqual(d[slotOff + j], 0x00);
    // attr byte: 0xF8 = Closed + D + R + W + X + ftype DEL. Without
    // the W bit set, VICE's CFS listing flags the row as read-only
    // ("<" marker), so all four permission bits go in.
    assert.strictEqual(d[slotOff + 0x18], 0xF8);
    // Reader sees ftype DEL + closed + all permission bits + "DEL" suffix
    var entries = readCfsDirectorySector(buf, 5);
    assert.strictEqual(entries[res.slotIndex].ftype, CFS_FTYPE.DEL);
    assert.strictEqual(entries[res.slotIndex].closed, true);
    assert.strictEqual(entries[res.slotIndex].attrByte & 0x78, 0x78);
    assert.strictEqual(entries[res.slotIndex].typeSuffix, 'DEL');
  });

  it('refuses when the dir is full', function() {
    var buf = new ArrayBuffer(64 * 1024);
    var d = new Uint8Array(buf);
    writeCfsEntry(d, 5, 0, { name: 'D', ftype: 3, typeSuffix: 'DIR', attrByte: 0x83 });
    for (var i = 1; i < 16; i++) {
      writeCfsEntry(d, 5, i, { name: 'F' + i, ftype: 1, typeSuffix: 'PRG', attrByte: 0xF9 });
    }
    var res = cfsInsertSeparator(buf, 5, [0x2D]);
    assert.strictEqual(res.ok, false);
  });

  it('Remove Entry zeros a separator slot cleanly (no orphaned bitmap)', function() {
    var buf = new ArrayBuffer(2 * 1024 * 1024);
    var d = new Uint8Array(buf);
    var partStart = 2, partEnd = 1000;
    for (var i = 0; i < 512; i++) d[2 * 512 + i] = 0xFF;
    cfsMarkSectorUsed(buf, partStart, 2);
    cfsMarkSectorUsed(buf, partStart, 5);
    writeCfsEntry(d, 5, 0, { name: 'D', ftype: 3, typeSuffix: 'DIR', attrByte: 0x83 });
    var res = cfsInsertSeparator(buf, 5, [0x2D, 0x2D, 0x2D]);
    assert.ok(res.ok);

    var entries = readCfsDirectorySector(buf, 5);
    var sep = entries[res.slotIndex];
    sep.dirLba = 5;
    // Separator is ftype DEL — cfsRemoveDirEntry's DEL branch handles it
    // (just zero the slot, no bitmap free).
    var rem = cfsRemoveDirEntry(buf, partStart, partEnd, sep, 5);
    assert.ok(rem.ok, rem.error || '');
    var slotOff = 5 * 512 + res.slotIndex * 32;
    for (var z = 0; z < 32; z++) {
      var expected = (z === 0x14) ? (d[slotOff + z] & 0x30) : 0;
      assert.strictEqual(d[slotOff + z], expected);
    }
  });
});

describe('cfsInsertPlaceholderEntry', function() {
  it('creates a zero-size, null-tree entry that the reader sees correctly', function() {
    var buf = new ArrayBuffer(64 * 1024);
    var d = new Uint8Array(buf);
    writeCfsEntry(d, 5, 0, { name: 'D', ftype: 3, typeSuffix: 'DIR', attrByte: 0x83 });
    var res = cfsInsertPlaceholderEntry(buf, 5, 'PLACEHOLDER', { ftype: CFS_FTYPE.NORMAL, typeSuffix: 'PRG' });
    assert.ok(res.ok, res.error || '');
    assert.strictEqual(res.dirLba, 5);
    assert.strictEqual(res.slotIndex, 1);
    var entries = readCfsDirectorySector(buf, 5);
    var e = entries[1];
    assert.strictEqual(petsciiToReadable(e.name), 'PLACEHOLDER');
    assert.strictEqual(e.ftype, CFS_FTYPE.NORMAL);
    assert.strictEqual(e.size, 0);
    assert.strictEqual(e.closed, true);
    assert.strictEqual(e.typeSuffix, 'PRG');
    assert.strictEqual(e.dataTreePtr.lba, false, 'tree pointer should not have LBA flag');
  });

  it('scratch + remove work on a placeholder (no tree → just mark/zero)', function() {
    var buf = new ArrayBuffer(2 * 1024 * 1024);
    var d = new Uint8Array(buf);
    var partStart = 2, partEnd = 1000;
    for (var i = 0; i < 512; i++) d[2 * 512 + i] = 0xFF;
    cfsMarkSectorUsed(buf, partStart, 2);
    cfsMarkSectorUsed(buf, partStart, 5);
    writeCfsEntry(d, 5, 0, { name: 'D', ftype: 3, typeSuffix: 'DIR', attrByte: 0x83 });
    var res = cfsInsertPlaceholderEntry(buf, 5, 'STUB', { ftype: CFS_FTYPE.NORMAL, typeSuffix: 'PRG' });
    assert.ok(res.ok);
    var entry = readCfsDirectorySector(buf, 5)[res.slotIndex];
    entry.dirLba = 5;
    // Scratch — no tree to free, but attr should flip to DEL.
    var del = cfsDeleteFile(buf, partStart, partEnd, entry);
    assert.ok(del.ok, del.error || '');
    var afterScratch = readCfsDirectorySector(buf, 5)[res.slotIndex];
    assert.strictEqual(afterScratch.ftype, CFS_FTYPE.DEL);
    // Remove — zero the slot (sectors already nothing).
    afterScratch.dirLba = 5;
    var rem = cfsRemoveDirEntry(buf, partStart, partEnd, afterScratch, 5);
    assert.ok(rem.ok, rem.error || '');
    var slotOff = 5 * 512 + res.slotIndex * 32;
    for (var z = 0; z < 32; z++) {
      var expected = (z === 0x14) ? (d[slotOff + z] & 0x30) : 0;
      assert.strictEqual(d[slotOff + z], expected);
    }
  });

  it('refuses when the dir has no free slot', function() {
    var buf = new ArrayBuffer(64 * 1024);
    var d = new Uint8Array(buf);
    writeCfsEntry(d, 5, 0, { name: 'D', ftype: 3, typeSuffix: 'DIR', attrByte: 0x83 });
    for (var i = 1; i < 16; i++) {
      writeCfsEntry(d, 5, i, { name: 'F' + i, ftype: 1, typeSuffix: 'PRG', attrByte: 0xF9 });
    }
    var res = cfsInsertPlaceholderEntry(buf, 5, 'X');
    assert.strictEqual(res.ok, false);
    assert.match(res.error, /no empty/);
  });
});

describe('cfsRemoveDirEntry (hard remove)', function() {
  it('on a live file: frees bitmap + zeros the 32-byte slot', function() {
    var buf = new ArrayBuffer(2 * 1024 * 1024);
    var d = new Uint8Array(buf);
    var partStart = 2, partEnd = 1000;
    for (var i = 0; i < 512; i++) d[2 * 512 + i] = 0xFF;
    cfsMarkSectorUsed(buf, partStart, 2);
    cfsMarkSectorUsed(buf, partStart, 5);
    writeCfsEntry(d, 5, 0, { name: 'D', ftype: 3, typeSuffix: 'DIR', attrByte: 0x83 });
    var imp = cfsImportSingleSectorFile(buf, partStart, partEnd, 5, 'HI', new Uint8Array([1, 2, 3]), { ftype: 1, typeSuffix: 'PRG' });
    assert.ok(imp.ok);

    var entries = readCfsDirectorySector(buf, 5);
    var entry = entries[imp.slotIndex];
    entry.dirLba = 5;
    var res = cfsRemoveDirEntry(buf, partStart, partEnd, entry, 5);
    assert.ok(res.ok, res.error || '');

    // Slot is all zeros now
    var slotOff = 5 * 512 + imp.slotIndex * 32;
    for (var z = 0; z < 32; z++) assert.strictEqual(d[slotOff + z], 0, 'byte ' + z);
    // Bitmap: tree + data freed (live → cfsDeleteFile freed them)
    assert.strictEqual(cfsIsSectorFree(buf, partStart, imp.treeLba), true);
    assert.strictEqual(cfsIsSectorFree(buf, partStart, imp.dataLbas[0]), true);
  });

  it('on a DEL entry: just zeros the slot (sectors already free)', function() {
    var buf = new ArrayBuffer(2 * 1024 * 1024);
    var d = new Uint8Array(buf);
    var partStart = 2, partEnd = 1000;
    for (var i = 0; i < 512; i++) d[2 * 512 + i] = 0xFF;
    cfsMarkSectorUsed(buf, partStart, 2);
    cfsMarkSectorUsed(buf, partStart, 5);
    writeCfsEntry(d, 5, 0, { name: 'D', ftype: 3, typeSuffix: 'DIR', attrByte: 0x83 });
    var imp = cfsImportSingleSectorFile(buf, partStart, partEnd, 5, 'X', new Uint8Array([9]), { ftype: 1, typeSuffix: 'PRG' });
    var preEntries = readCfsDirectorySector(buf, 5);
    preEntries[imp.slotIndex].dirLba = 5;
    cfsDeleteFile(buf, partStart, partEnd, preEntries[imp.slotIndex]); // → DEL state, sectors free
    var delEntries = readCfsDirectorySector(buf, 5);
    delEntries[imp.slotIndex].dirLba = 5;

    var res = cfsRemoveDirEntry(buf, partStart, partEnd, delEntries[imp.slotIndex], 5);
    assert.ok(res.ok);
    var slotOff = 5 * 512 + imp.slotIndex * 32;
    for (var z = 0; z < 32; z++) assert.strictEqual(d[slotOff + z], 0);
  });

  it('refuses on the dir self-reference (slot 0 of first sector)', function() {
    var buf = new ArrayBuffer(64 * 1024);
    var d = new Uint8Array(buf);
    writeCfsEntry(d, 5, 0, { name: 'D', ftype: 3, typeSuffix: 'DIR', attrByte: 0x83 });
    var entries = readCfsDirectorySector(buf, 5);
    entries[0].dirLba = 5;
    var res = cfsRemoveDirEntry(buf, 2, 100, entries[0], 5);
    assert.strictEqual(res.ok, false);
    assert.match(res.error, /self-reference/);
  });

  it('preserves dir-next pointer bits when zeroing a slot in a multi-sector dir', function() {
    // Mirrors the ide.hdd bug: bits 5..4 of byte $14 across all 16 slots
    // encode the dir-next pointer. Zeroing slot 3 used to clear its 2-bit
    // contribution, corrupting the parent dir's next-sector pointer and
    // sending later reads into garbage. Set up a multi-sector dir whose
    // next-pointer requires non-zero contribution from slot 3 byte $14.
    var fs = require('fs');
    var path = require('path');
    var refPath = path.join(__dirname, '..', 'disks', 'ide.hdd');
    if (!fs.existsSync(refPath)) return; // user-supplied fixture
    var buf = new Uint8Array(fs.readFileSync(refPath)).buffer;
    var data = new Uint8Array(buf);

    var partInfo = readIde64Partitions(buf);
    var part = partInfo.partitions[0];

    // Read root + capture the pre-zero next pointer
    function readNext(lba) {
      var bytes = [0,0,0,0];
      for (var i = 0; i < 4; i++) {
        var eb = lba * 512 + 0x180 - i * 0x80;
        var c = (data[eb + 0x14] << 2) & 0xC0;
        c |= data[eb + 0x34] & 0x30;
        c |= (data[eb + 0x54] >>> 2) & 0x0C;
        c |= (data[eb + 0x74] >>> 4) & 0x03;
        bytes[i] = c;
      }
      return ((bytes[0] & 0x0F) << 24) | (bytes[1] << 16) | (bytes[2] << 8) | bytes[3];
    }
    var rootLba = part.cfsRootDir.addr;
    var nextBefore = readNext(rootLba);
    assert.ok(nextBefore > 0, 'root must have a chained next-sector to exercise the bug');

    // Find TURBOCHARGE in root (slot 3 on this fixture) and remove it
    var rootEntries = readCfsDirectorySector(buf, rootLba);
    var target = null;
    for (var ri = 0; ri < rootEntries.length; ri++) {
      if (petsciiToReadable(rootEntries[ri].name).indexOf('TURBOCHAR') === 0) {
        target = rootEntries[ri]; break;
      }
    }
    assert.ok(target, 'TURBOCHARGE not found');
    target.dirLba = rootLba;
    var res = cfsRemoveDirEntry(buf, part.startLba, part.endLba, target, rootLba);
    assert.ok(res.ok, res.error || '');

    // Slot bytes are mostly zero, except bits 5..4 of byte $14 preserved
    var off = rootLba * 512 + target.index * 32;
    for (var z = 0; z < 32; z++) {
      var expected = (z === 0x14) ? (data[off + z] & 0x30) : 0;
      assert.strictEqual(data[off + z], expected, 'byte 0x' + z.toString(16));
    }
    // The dir-next pointer reads the same as before — the bit-slice
    // pipeline didn't drop any of the 2 bits that lived in this slot.
    var nextAfter = readNext(rootLba);
    assert.strictEqual(nextAfter, nextBefore, 'dir-next pointer must not change');
  });

  it('on a live directory: cascades like scratch + zeros the parent slot', function() {
    var buf = new ArrayBuffer(2 * 1024 * 1024);
    var d = new Uint8Array(buf);
    var partStart = 2, partEnd = 1000;
    for (var i = 0; i < 512; i++) d[2 * 512 + i] = 0xFF;
    cfsMarkSectorUsed(buf, partStart, partStart);
    cfsMarkSectorUsed(buf, partStart, 5);
    writeDirSelfRef(d, 5, 5, 0, 'ROOT', 'DIR');
    writeCfsEntry(d, 5, 1, { name: 'SUBDIR', ftype: 3, typeSuffix: 'DIR', attrByte: 0xFB });
    cfsMarkSectorUsed(buf, partStart, 10);
    d[5 * 512 + 32 + 0x14] = 0xC0; d[5 * 512 + 32 + 0x17] = 10;
    writeDirSelfRef(d, 10, 5, 0, 'SUBDIR', 'DIR');
    var fileRes = cfsImportSingleSectorFile(buf, partStart, partEnd, 10, 'KID', new Uint8Array([7]), { ftype: 1, typeSuffix: 'PRG' });

    var rootEntries = readCfsDirectorySector(buf, 5);
    rootEntries[1].dirLba = 5;
    var res = cfsRemoveDirEntry(buf, partStart, partEnd, rootEntries[1], 5);
    assert.ok(res.ok, res.error || '');

    // Root slot 1 zeroed
    for (var z = 0; z < 32; z++) assert.strictEqual(d[5 * 512 + 32 + z], 0);
    // Dir sector + child's tree + child's data all freed in bitmap
    assert.strictEqual(cfsIsSectorFree(buf, partStart, 10), true);
    assert.strictEqual(cfsIsSectorFree(buf, partStart, fileRes.treeLba), true);
    assert.strictEqual(cfsIsSectorFree(buf, partStart, fileRes.dataLbas[0]), true);
  });
});

describe('CFS file-size editing (Change / Set Actual)', function() {
  it('cfsWriteFileSize updates byte $10..$13 (32-bit LE) for NORMAL files', function() {
    var buf = new ArrayBuffer(64 * 1024);
    var d = new Uint8Array(buf);
    writeCfsEntry(d, 5, 1, { name: 'X', ftype: 1, typeSuffix: 'PRG', size: 1234 });
    assert.strictEqual(cfsWriteFileSize(buf, 5, 1, 0x12345678, CFS_FTYPE.NORMAL), true);
    var entries = readCfsDirectorySector(buf, 5);
    assert.strictEqual(entries[1].size, 0x12345678);
  });

  it('cfsWriteFileSize preserves byte $13 for REL files (REL meta lives there)', function() {
    var buf = new ArrayBuffer(64 * 1024);
    var d = new Uint8Array(buf);
    writeCfsEntry(d, 5, 1, { name: 'R', ftype: 2, typeSuffix: 'REL', size: 0 });
    d[5 * 512 + 32 + 0x13] = 0xAB; // REL meta byte
    assert.strictEqual(cfsWriteFileSize(buf, 5, 1, 0x123456, CFS_FTYPE.REL), true);
    // Bytes 0..2 updated; byte 3 still 0xAB
    assert.strictEqual(d[5 * 512 + 32 + 0x10], 0x56);
    assert.strictEqual(d[5 * 512 + 32 + 0x11], 0x34);
    assert.strictEqual(d[5 * 512 + 32 + 0x12], 0x12);
    assert.strictEqual(d[5 * 512 + 32 + 0x13], 0xAB);
  });

  it('cfsCountFileDataSectors counts actual data sectors from a B-tree walk', function() {
    var buf = new ArrayBuffer(2 * 1024 * 1024);
    var d = new Uint8Array(buf);
    var partStart = 2, partEnd = 1000;
    for (var i = 0; i < 512; i++) d[2 * 512 + i] = 0xFF;
    cfsMarkSectorUsed(buf, partStart, 2);
    cfsMarkSectorUsed(buf, partStart, 5);
    writeCfsEntry(d, 5, 0, { name: 'D', ftype: 3, typeSuffix: 'DIR', attrByte: 0x83 });

    // Import a 3-sector + 100B file → 4 data sectors expected
    var size = 3 * 512 + 100;
    var payload = new Uint8Array(size);
    var imp = cfsImportFile(buf, partStart, partEnd, 5, 'F', payload);
    assert.ok(imp.ok);

    var entries = readCfsDirectorySector(buf, 5);
    var sectors = cfsCountFileDataSectors(buf, partStart, partEnd, entries[imp.slotIndex]);
    assert.strictEqual(sectors, 4);
    assert.strictEqual(imp.dataLbas.length, 4);
  });

  it('Set Actual round-trip: corrupt size → recalc restores upper-bound sector*512', function() {
    var buf = new ArrayBuffer(2 * 1024 * 1024);
    var d = new Uint8Array(buf);
    var partStart = 2, partEnd = 1000;
    for (var i = 0; i < 512; i++) d[2 * 512 + i] = 0xFF;
    cfsMarkSectorUsed(buf, partStart, 2);
    cfsMarkSectorUsed(buf, partStart, 5);
    writeCfsEntry(d, 5, 0, { name: 'D', ftype: 3, typeSuffix: 'DIR', attrByte: 0x83 });

    var imp = cfsImportFile(buf, partStart, partEnd, 5, 'F', new Uint8Array(1500)); // 3 sectors
    assert.ok(imp.ok);
    // Corrupt: blow the size field to something wrong
    cfsWriteFileSize(buf, 5, imp.slotIndex, 999999, CFS_FTYPE.NORMAL);
    var entries = readCfsDirectorySector(buf, 5);
    assert.strictEqual(entries[imp.slotIndex].size, 999999);

    // Recompute and write
    var sectors = cfsCountFileDataSectors(buf, partStart, partEnd, entries[imp.slotIndex]);
    cfsWriteFileSize(buf, 5, imp.slotIndex, sectors * 512, CFS_FTYPE.NORMAL);
    var fixed = readCfsDirectorySector(buf, 5);
    assert.strictEqual(fixed[imp.slotIndex].size, 3 * 512);
  });
});

describe('cfsFindEmptyDirSlot — DEL slot reuse', function() {
  it('prefers truly-empty slots over soft-deleted ones', function() {
    var buf = new ArrayBuffer(64 * 1024);
    var d = new Uint8Array(buf);
    // Self-ref + a DEL slot at index 1 + a truly-empty slot at index 2.
    writeCfsEntry(d, 5, 0, { name: 'D', ftype: 3, typeSuffix: 'DIR', attrByte: 0x83 });
    writeCfsEntry(d, 5, 1, { name: 'GONE', ftype: 0, typeSuffix: 'PRG', attrByte: 0x78 });
    // slot 2 stays all-zero
    var got = cfsFindEmptyDirSlot(buf, 5);
    assert.ok(got);
    assert.strictEqual(got.slotIndex, 2, 'truly-empty slot beats DEL slot');
  });

  it('falls back to a soft-deleted slot when no truly-empty exists', function() {
    var buf = new ArrayBuffer(64 * 1024);
    var d = new Uint8Array(buf);
    writeCfsEntry(d, 5, 0, { name: 'D', ftype: 3, typeSuffix: 'DIR', attrByte: 0x83 });
    // Fill every remaining slot: index 5 is DEL, everything else is live PRG.
    for (var i = 1; i < 16; i++) {
      var attr = (i === 5) ? 0x78 : 0xF9; // DEL vs live PRG
      var ftype = (i === 5) ? 0 : 1;
      writeCfsEntry(d, 5, i, { name: 'F' + i, ftype: ftype, typeSuffix: 'PRG', attrByte: attr });
    }
    var got = cfsFindEmptyDirSlot(buf, 5);
    assert.ok(got, 'should return the DEL slot as fallback');
    assert.strictEqual(got.slotIndex, 5);
  });

  it('returns null when no empty + no DEL slots exist', function() {
    var buf = new ArrayBuffer(64 * 1024);
    var d = new Uint8Array(buf);
    writeCfsEntry(d, 5, 0, { name: 'D', ftype: 3, typeSuffix: 'DIR', attrByte: 0x83 });
    for (var i = 1; i < 16; i++) {
      writeCfsEntry(d, 5, i, { name: 'F' + i, ftype: 1, typeSuffix: 'PRG', attrByte: 0xF9 });
    }
    assert.strictEqual(cfsFindEmptyDirSlot(buf, 5), null);
  });

  it('cfsImportFile reuses a DEL slot when the dir is otherwise full', function() {
    var buf = new ArrayBuffer(2 * 1024 * 1024);
    var d = new Uint8Array(buf);
    var partStart = 2, partEnd = 1000;
    for (var i = 0; i < 512; i++) d[partStart * 512 + i] = 0xFF;
    cfsMarkSectorUsed(buf, partStart, partStart);
    cfsMarkSectorUsed(buf, partStart, 5);
    writeCfsEntry(d, 5, 0, { name: 'D', ftype: 3, typeSuffix: 'DIR', attrByte: 0x83 });
    // Fill slots 1..15; slot 7 is DEL, the rest live.
    for (var k = 1; k < 16; k++) {
      var attr = (k === 7) ? 0x78 : 0xF9;
      var ftype = (k === 7) ? 0 : 1;
      writeCfsEntry(d, 5, k, { name: 'X' + k, ftype: ftype, typeSuffix: 'PRG', attrByte: attr });
    }
    var res = cfsImportSingleSectorFile(buf, partStart, partEnd, 5, 'NEW', new Uint8Array([9]), { ftype: 1, typeSuffix: 'PRG' });
    assert.ok(res.ok, res.error || '');
    assert.strictEqual(res.slotIndex, 7);
    // The new entry overwrites the DEL one cleanly.
    var entries = readCfsDirectorySector(buf, 5);
    assert.strictEqual(petsciiToReadable(entries[7].name), 'NEW');
    assert.strictEqual(entries[7].ftype, 1);
    assert.strictEqual(entries[7].closed, true);
  });
});

describe('CFS partition soft-delete / restore (Phase D)', function() {
  it('cfsSoftDeletePartition clears VALID, mirrors to backup, bumps $03', function() {
    var buf = createEmptyHdd(2);
    var d = new Uint8Array(buf);
    // createEmptyHdd writes one CFS partition into slot 0. Soft-delete it.
    var beforeStart = d[1 * 512 + 0 * 32 + 0x10];
    var backupLba = ((d[0x1C] & 0x0F) << 24) | (d[0x1D] << 16) | (d[0x1E] << 8) | d[0x1F];
    assert.ok(backupLba > 1, 'backup pointer should target a sector other than the primary');
    assert.strictEqual(beforeStart & 0x80, 0x80, 'partition starts VALID');
    var gen0 = d[0x03];

    var res = cfsSoftDeletePartition(buf, 0);
    assert.ok(res.ok, res.error || '');

    var afterStart = d[1 * 512 + 0 * 32 + 0x10];
    assert.strictEqual(afterStart & 0x80, 0, 'VALID bit cleared');
    assert.strictEqual(afterStart, beforeStart & ~0x80, 'only VALID bit changed; other flags preserved');
    // Backup mirror
    var backupStart = d[backupLba * 512 + 0 * 32 + 0x10];
    assert.strictEqual(backupStart, afterStart, 'backup partition table mirrors the change');
    // Generation counter bumped
    assert.strictEqual(d[0x03], (gen0 + 1) & 0xFF);
    // readIde64Partitions should mark it as deleted, not empty
    var info = readIde64Partitions(buf);
    assert.strictEqual(info.partitions[0].deleted, true);
    assert.strictEqual(info.partitions[0].empty, false);
    assert.strictEqual(info.partitions[0].type, 0x01); // CFS preserved
  });

  it('cfsRestorePartition flips VALID back on, mirrors to backup, bumps $03', function() {
    var buf = createEmptyHdd(2);
    var d = new Uint8Array(buf);
    cfsSoftDeletePartition(buf, 0);
    var gen1 = d[0x03];
    var backupLba = ((d[0x1C] & 0x0F) << 24) | (d[0x1D] << 16) | (d[0x1E] << 8) | d[0x1F];

    var res = cfsRestorePartition(buf, 0);
    assert.ok(res.ok, res.error || '');
    var start = d[1 * 512 + 0 * 32 + 0x10];
    assert.strictEqual(start & 0x80, 0x80, 'VALID set');
    var backupStart = d[backupLba * 512 + 0 * 32 + 0x10];
    assert.strictEqual(backupStart, start, 'backup mirrors restore');
    assert.strictEqual(d[0x03], (gen1 + 1) & 0xFF, 'generation bumped on restore too');

    var info = readIde64Partitions(buf);
    assert.strictEqual(info.partitions[0].deleted, false);
    assert.strictEqual(info.partitions[0].empty, false);
  });

  it('rejects double-delete and restore-of-live', function() {
    var buf = createEmptyHdd(2);
    cfsSoftDeletePartition(buf, 0);
    assert.strictEqual(cfsSoftDeletePartition(buf, 0).ok, false);
    cfsRestorePartition(buf, 0);
    assert.strictEqual(cfsRestorePartition(buf, 0).ok, false);
  });

  it('createEmptyHdd writes backup partition directory at the last LBA', function() {
    var buf = createEmptyHdd(4);
    var d = new Uint8Array(buf);
    var totalLbas = buf.byteLength / 512;
    var backupLba = ((d[0x1C] & 0x0F) << 24) | (d[0x1D] << 16) | (d[0x1E] << 8) | d[0x1F];
    assert.strictEqual(backupLba, totalLbas - 1, 'backup points at the last sector');
    assert.strictEqual((d[0x1C] & 0x40) !== 0, true, 'LBA flag set on backup pointer');
    // First 32 bytes of primary == first 32 bytes of backup (the partition
    // entry cfsAddPartitionToTable wrote, mirrored).
    var primary = 1 * 512;
    var backup = backupLba * 512;
    for (var i = 0; i < 32; i++) {
      assert.strictEqual(d[backup + i], d[primary + i], 'byte ' + i + ' of partition entry mirrored');
    }
  });
});

// Byte-exact behavior against the user's IDEDOS test images. Only runs
// when "ide - 1part.hdd" + "ide - 2part.hdd" are present in disks/ —
// user-supplied + gitignored. Filenames in our copy are swapped from the
// state they describe: ide - 1part.hdd is the 2-partition "before" state
// (both slots valid), ide - 2part.hdd is the 1-partition "after delete"
// state (slot 0 has V=0).
describe('CFS partition delete — IDEDOS reference comparison', function() {
  it('matches IDEDOS byte-for-byte when scratching slot 0 of a 2-partition image', function() {
    var fs = require('fs');
    var path = require('path');
    var beforePath = path.join(__dirname, '..', 'disks', 'ide - 1part.hdd'); // 2-partition state
    var afterPath = path.join(__dirname, '..', 'disks', 'ide - 2part.hdd'); // 1-partition state
    if (!fs.existsSync(beforePath) || !fs.existsSync(afterPath)) return;

    var beforeBytes = fs.readFileSync(beforePath);
    var afterBytes = fs.readFileSync(afterPath);

    // Apply our soft-delete to a copy of the before-image, then compare.
    var workBuf = new ArrayBuffer(beforeBytes.length);
    var work = new Uint8Array(workBuf);
    work.set(beforeBytes);

    var res = cfsSoftDeletePartition(workBuf, 0);
    assert.ok(res.ok, res.error || '');

    assert.strictEqual(work.length, afterBytes.length);
    var firstDiff = -1;
    for (var bi = 0; bi < work.length; bi++) {
      if (work[bi] !== afterBytes[bi]) { firstDiff = bi; break; }
    }
    if (firstDiff !== -1) {
      var ctx = [];
      for (var ci = Math.max(0, firstDiff - 4); ci < Math.min(work.length, firstDiff + 8); ci++) {
        ctx.push('  0x' + ci.toString(16) + ': us=0x' + work[ci].toString(16).padStart(2, '0') + ' idedos=0x' + afterBytes[ci].toString(16).padStart(2, '0') + (ci === firstDiff ? ' ←' : ''));
      }
      assert.fail('First byte diff at 0x' + firstDiff.toString(16) + ' (LBA ' + Math.floor(firstDiff / 512) + ' offset 0x' + (firstDiff % 512).toString(16) + '):\n' + ctx.join('\n'));
    }
  });
});

// Byte-exact behavior against the user's IDEDOS test images. Only runs
// when both ide.hdd and "ide - delete.hdd" are present in disks/ — they
// are user-supplied + gitignored. This test is the ground truth: our
// delete must produce the same on-disk state IDEDOS produces.
describe('CFS delete — IDEDOS reference comparison', function() {
  it('matches IDEDOS byte-for-byte when scratching CREATURES (dir) + "-- CREATURES2 --" (file)', function() {
    var fs = require('fs');
    var path = require('path');
    var refPath = path.join(__dirname, '..', 'disks', 'ide.hdd');
    var delPath = path.join(__dirname, '..', 'disks', 'ide - delete.hdd');
    if (!fs.existsSync(refPath) || !fs.existsSync(delPath)) return;

    var ref = fs.readFileSync(refPath).buffer;
    var refData = new Uint8Array(ref);
    var del = fs.readFileSync(delPath);

    // Work on a writable copy of the reference image, apply both deletes,
    // then compare byte-for-byte.
    var workBuf = new ArrayBuffer(refData.length);
    var work = new Uint8Array(workBuf);
    work.set(refData);

    var info = readIde64Partitions(workBuf);
    var part0 = info.partitions[0];
    var partStart = part0.startLba, partEnd = part0.endLba;

    // Find CREATURES in the root dir (LBA 5 = partition root)
    var rootEntries = readCfsDirectory(workBuf, part0.cfsRootDir.addr);
    var creatures = null;
    for (var ri = 0; ri < rootEntries.length; ri++) {
      if (petsciiToReadable(rootEntries[ri].name) === 'CREATURES') {
        creatures = rootEntries[ri];
        break;
      }
    }
    assert.ok(creatures, 'CREATURES dir entry not found in reference image');

    // CREATURES2 lives in a different parent — find it by walking entries
    // labelled DIR until we find one that contains a CREATURES2 entry,
    // then locate "-- CREATURES2 --" inside the CREATURES2 dir.
    function findEntryByName(dirLba, wantName) {
      var ents = readCfsDirectory(workBuf, dirLba);
      for (var i = 0; i < ents.length; i++) {
        if (petsciiToReadable(ents[i].name) === wantName) return ents[i];
      }
      return null;
    }
    var creatures2Parent = null;
    for (var rj = 0; rj < rootEntries.length; rj++) {
      var re = rootEntries[rj];
      if (re.ftype !== CFS_FTYPE.DIR || !re.dataTreePtr || !re.dataTreePtr.lba) continue;
      if (findEntryByName(re.dataTreePtr.addr, 'CREATURES2')) {
        creatures2Parent = findEntryByName(re.dataTreePtr.addr, 'CREATURES2');
        break;
      }
    }
    assert.ok(creatures2Parent, 'CREATURES2 dir not found');
    var creatures2File = findEntryByName(creatures2Parent.dataTreePtr.addr, '-- CREATURES2 --');
    assert.ok(creatures2File, '-- CREATURES2 -- file not found inside CREATURES2');

    // Apply both deletes
    var d1 = cfsDeleteFile(workBuf, partStart, partEnd, creatures);
    assert.ok(d1.ok, d1.error || '');
    var d2 = cfsDeleteFile(workBuf, partStart, partEnd, creatures2File);
    assert.ok(d2.ok, d2.error || '');

    // Byte-for-byte: workBuf should now equal "ide - delete.hdd"
    assert.strictEqual(work.length, del.length);
    var firstDiff = -1;
    for (var bi = 0; bi < work.length; bi++) {
      if (work[bi] !== del[bi]) { firstDiff = bi; break; }
    }
    if (firstDiff !== -1) {
      var ctx = [];
      for (var ci = Math.max(0, firstDiff - 4); ci < Math.min(work.length, firstDiff + 8); ci++) {
        ctx.push('  0x' + ci.toString(16) + ': us=0x' + work[ci].toString(16).padStart(2, '0') + ' idedos=0x' + del[ci].toString(16).padStart(2, '0') + (ci === firstDiff ? ' ←' : ''));
      }
      assert.fail('First byte diff at 0x' + firstDiff.toString(16) + ' (LBA ' + Math.floor(firstDiff / 512) + ' offset 0x' + (firstDiff % 512).toString(16) + '):\n' + ctx.join('\n'));
    }
  });
});
