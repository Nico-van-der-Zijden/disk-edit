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
    assert.strictEqual(entries[1].name, 'NEWFILE');

    // Type and attribute byte untouched
    assert.strictEqual(entries[1].typeSuffix, 'PRG');
    assert.strictEqual(entries[1].ftype, 1);
  });

  it('truncates names > 16 chars and space-pads short ones', function() {
    var buf = new ArrayBuffer(64 * 1024);
    var d = new Uint8Array(buf);
    writeCfsEntry(d, 10, 1, { name: 'A', ftype: 1 });

    cfsWriteDirEntryName(buf, 10, 1, 'A NAME TOO LONG FOR SIXTEEN');
    var off = 10 * 512 + 32;
    // First 16 bytes = truncated input
    var got = '';
    for (var i = 0; i < 16; i++) got += String.fromCharCode(d[off + i]);
    assert.strictEqual(got, 'A NAME TOO LONG ');

    cfsWriteDirEntryName(buf, 10, 1, 'SHORT');
    got = '';
    for (var j = 0; j < 16; j++) got += String.fromCharCode(d[off + j]);
    assert.strictEqual(got, 'SHORT           ');
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
    assert.strictEqual(e.name, 'HELLO');
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
    assert.strictEqual(gamesInParent.name, 'GAMES');
    assert.strictEqual(gamesInParent.ftype, CFS_FTYPE.DIR);
    assert.strictEqual(gamesInParent.typeSuffix, 'DIR');
    assert.strictEqual(gamesInParent.dataTreePtr.addr, res.newDirLba);

    // Walking into the new dir gives a self-reference at slot 0
    var subEntries = readCfsDirectorySector(buf, res.newDirLba);
    assert.strictEqual(subEntries[0].name, 'GAMES');
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
    assert.strictEqual(p0.name, 'MAIN');
    assert.strictEqual(p0.startLba, 2);
    assert.strictEqual(p0.endLba, 4 * 1024 * 1024 / 512 - 1);

    // Root directory: self-ref + %DELETED FILES% + empty slots
    var entries = readCfsDirectory(buf, p0.cfsRootDir.addr);
    assert.strictEqual(entries[0].name, 'MAIN');
    assert.strictEqual(entries[0].ftype, CFS_FTYPE.DIR);
    assert.strictEqual(entries[0].isSelfRef, true);
    assert.strictEqual(entries[1].name, '%DELETED  FILES%');
    for (var i = 2; i < 16; i++) assert.strictEqual(entries[i].empty, true);

    // Importing a file works on the fresh image
    var payload = new Uint8Array(200);
    for (var pp = 0; pp < 200; pp++) payload[pp] = (pp ^ 0x55) & 0xFF;
    var imp = cfsImportFile(buf, p0.startLba, p0.endLba, p0.cfsRootDir.addr, 'HELLO', payload);
    assert.ok(imp.ok, imp.error || '');
    var after = readCfsDirectory(buf, p0.cfsRootDir.addr);
    assert.ok(after.some(function(e) { return e.name === 'HELLO' && e.size === 200; }));
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
    assert.strictEqual(active[1].name, 'SECOND');
    assert.strictEqual(active[1].startLba, p2Start);

    // Drilling into the new partition works
    var p2Entries = readCfsDirectory(buf, active[1].cfsRootDir.addr);
    assert.strictEqual(p2Entries[0].name, 'SECOND');
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
    assert.strictEqual(resolved.name, 'INNER');
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
