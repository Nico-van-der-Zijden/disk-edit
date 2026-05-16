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
    assert.ok(res.dataLba > res.treeLba);

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
    assert.strictEqual(cfsIsSectorFree(buf, partStart, res.dataLba), false);

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
    assert.strictEqual(cfsIsSectorFree(buf, partStart, res.dataLba), true);

    // Dir entry: ftype now 0 (DEL), Closed bit cleared
    var after = readCfsDirectorySector(buf, res.dirLba);
    assert.strictEqual(after[res.slotIndex].ftype, 0);
    assert.strictEqual((after[res.slotIndex].attrByte & 0x80) !== 0, false);
  });

  it('cfsDeleteFile refuses files > 64 KiB', function() {
    var buf = new ArrayBuffer(4096);
    var res = cfsDeleteFile(buf, 0, 100, {
      dirLba: 0,
      index: 0,
      size: 65537,
      dataTreePtr: { lba: true, addr: 10 },
    });
    assert.strictEqual(res.ok, false);
    assert.ok(res.error.indexOf('> 64 KiB') >= 0);
  });

  it('cfsImportSingleSectorFile refuses files > 512 B', function() {
    var buf = new ArrayBuffer(64 * 1024);
    var big = new Uint8Array(600);
    var res = cfsImportSingleSectorFile(buf, 2, 100, 5, 'X', big);
    assert.strictEqual(res.ok, false);
    assert.ok(res.error.indexOf('multi-sector') >= 0);
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
