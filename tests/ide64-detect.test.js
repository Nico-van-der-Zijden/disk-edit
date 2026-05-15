// IDE64 .hdd / CFS 0.11 partition-table reader smoke tests.
// Phase 1 is read-only: detect the format, read the 16 partition slots.
//
// Layout follows fusecfs 2.0.4 (Soci/Singular) — name 16 B at $00, start
// at $10, end at $14 (with 3-bit TYPE in byte 0 bits 7/5/4), deldir at
// $18, rootdir at $1C.

const { describe, it } = require('node:test');
const assert = require('node:assert');
require('./test-helper');

var MAGIC = 'C64 CFS V 0.11B ';

// Encode TYPE (0..7) into end-pointer byte 0 bits 7, 5, 4.
function _encTypeBits(t) {
  return ((t & 0x01) ? 0x10 : 0) | ((t & 0x02) ? 0x20 : 0) | ((t & 0x04) ? 0x80 : 0);
}

// Build a small synthetic .hdd. partitionSpecs is an array of
// { name, type, startLba, sizeSectors, hidden?, writeable? } — order
// fills slots 0..N-1; remaining slots stay zeroed (empty).
function makeSyntheticHdd(partitionSpecs, opts) {
  opts = opts || {};
  var label = opts.label || 'TEST';
  var partDirLba = opts.partDirLba || 1;
  var defaultPart = opts.defaultPart || 0;

  var buf = new ArrayBuffer(1024 * 1024);
  var d = new Uint8Array(buf);

  // Boot sector
  d[0x01] = defaultPart;
  for (var i = 0; i < MAGIC.length; i++) d[0x08 + i] = MAGIC.charCodeAt(i);
  // Partition-directory pointer at $18: LBA flag + LBA addr
  d[0x18] = 0x40 | ((partDirLba >>> 24) & 0x0F);
  d[0x19] = (partDirLba >>> 16) & 0xFF;
  d[0x1A] = (partDirLba >>> 8) & 0xFF;
  d[0x1B] = partDirLba & 0xFF;
  // Disk label (16 B, space-padded)
  for (var li = 0; li < 16; li++) {
    d[0x20 + li] = li < label.length ? label.charCodeAt(li) : 0x20;
  }

  var dirOff = partDirLba * 512;
  for (var si = 0; si < partitionSpecs.length; si++) {
    var p = partitionSpecs[si];
    var eo = dirOff + si * 32;
    // 16-byte name, 0xA0-padded
    for (var ni = 0; ni < 16; ni++) {
      d[eo + ni] = ni < p.name.length ? p.name.charCodeAt(ni) : 0xA0;
    }
    var hiddenBit = p.hidden ? 0x20 : 0x00;
    var writeableBit = p.writeable !== false ? 0x10 : 0x00; // default writable
    // Start pointer at $10: VALID|LBA|HIDDEN?|WRITEABLE? + LBA addr
    d[eo + 0x10] = 0x80 | 0x40 | hiddenBit | writeableBit | ((p.startLba >>> 24) & 0x0F);
    d[eo + 0x11] = (p.startLba >>> 16) & 0xFF;
    d[eo + 0x12] = (p.startLba >>> 8) & 0xFF;
    d[eo + 0x13] = p.startLba & 0xFF;
    // End pointer at $14: LBA flag + TYPE bits (bits 7/5/4) + LBA addr (bytes 1..3)
    var endLba = p.startLba + p.sizeSectors - 1;
    if (endLba > 0x00FFFFFF) throw new Error('test LBA exceeds 24 bits');
    d[eo + 0x14] = 0x40 | _encTypeBits(p.type);
    d[eo + 0x15] = (endLba >>> 16) & 0xFF;
    d[eo + 0x16] = (endLba >>> 8) & 0xFF;
    d[eo + 0x17] = endLba & 0xFF;
  }

  return buf;
}

describe('IDE64 / CFS 0.11 detection', function() {
  it('isIde64Hdd recognises a buffer with the boot-sector magic', function() {
    var buf = makeSyntheticHdd([
      { name: 'CFS1', type: 0x01, startLba: 2, sizeSectors: 100 },
    ]);
    assert.strictEqual(isIde64Hdd(buf), true);
  });

  it('isIde64Hdd rejects a buffer without the magic', function() {
    var buf = new ArrayBuffer(1024);
    assert.strictEqual(isIde64Hdd(buf), false);
  });

  it('detectFormat returns DISK_FORMATS.hdd for a CFS image', function() {
    var buf = makeSyntheticHdd([
      { name: 'CFS1', type: 0x01, startLba: 2, sizeSectors: 100 },
    ]);
    var res = detectFormat(buf.byteLength, buf);
    assert.strictEqual(res.format, DISK_FORMATS.hdd);
  });

  it('parseIde64BootSector reads default partition + label + directory pointer', function() {
    var buf = makeSyntheticHdd(
      [{ name: 'X', type: 0x01, startLba: 2, sizeSectors: 10 }],
      { defaultPart: 3, label: 'MYDISK', partDirLba: 1 }
    );
    var boot = parseIde64BootSector(buf);
    assert.ok(boot);
    assert.strictEqual(boot.defaultPart, 3);
    assert.strictEqual(boot.label, 'MYDISK');
    assert.strictEqual(boot.partDir.lba, true);
    assert.strictEqual(boot.partDir.addr, 1);
  });

  it('readIde64Partitions returns 16 entries, populated then empty', function() {
    var buf = makeSyntheticHdd([
      { name: 'BOOT', type: 0x01, startLba: 2,    sizeSectors: 100 },
      { name: 'GAMES', type: 0x02, startLba: 102, sizeSectors: 200, writeable: false },
      { name: 'HIDDEN', type: 0x01, startLba: 302, sizeSectors: 50, hidden: true },
    ]);
    var info = readIde64Partitions(buf);
    assert.ok(info);
    assert.strictEqual(info.partitions.length, 16);

    assert.strictEqual(info.partitions[0].name, 'BOOT');
    assert.strictEqual(info.partitions[0].type, 0x01);
    assert.strictEqual(info.partitions[0].typeName, 'CFS');
    assert.strictEqual(info.partitions[0].startLba, 2);
    assert.strictEqual(info.partitions[0].endLba, 101);
    assert.strictEqual(info.partitions[0].sizeSectors, 100);
    assert.strictEqual(info.partitions[0].sizeBytes, 100 * 512);
    assert.strictEqual(info.partitions[0].hidden, false);
    assert.strictEqual(info.partitions[0].writeable, true);
    assert.strictEqual(info.partitions[0].empty, false);

    assert.strictEqual(info.partitions[1].name, 'GAMES');
    assert.strictEqual(info.partitions[1].type, 0x02);
    assert.strictEqual(info.partitions[1].typeName, 'GEOS');
    assert.strictEqual(info.partitions[1].writeable, false);

    assert.strictEqual(info.partitions[2].name, 'HIDDEN');
    assert.strictEqual(info.partitions[2].hidden, true);

    // Slot 3..15 are empty
    for (var i = 3; i < 16; i++) {
      assert.strictEqual(info.partitions[i].empty, true);
      assert.strictEqual(info.partitions[i].type, 0x00);
    }
  });

  it('readIde64Partitions returns CFS root/deleted-dir pointers for all entries (renderer ignores non-CFS)', function() {
    var buf = makeSyntheticHdd([
      { name: 'CFS', type: 0x01, startLba: 2, sizeSectors: 10 },
    ]);
    var info = readIde64Partitions(buf);
    // cfsRootDir is now read for every entry (the pointer is just bytes;
    // semantic validity is a CFS-vs-other type question).
    assert.ok(info.partitions[0].cfsRootDir);
    assert.ok(info.partitions[1].cfsRootDir);
  });

  it('does not false-positive on a 174848-byte D64 buffer', function() {
    var buf = new ArrayBuffer(174848); // standard D64 size
    var res = detectFormat(buf.byteLength, buf);
    assert.notStrictEqual(res.format, DISK_FORMATS.hdd);
    assert.strictEqual(res.format, DISK_FORMATS.d64);
  });

  it('encodes TYPE in end-pointer bits 7/5/4 — round-trips CFS=1 and GEOS=2', function() {
    var buf = makeSyntheticHdd([
      { name: 'CFS', type: 0x01, startLba: 2, sizeSectors: 10 },
      { name: 'GEOS', type: 0x02, startLba: 12, sizeSectors: 10 },
    ]);
    var d = new Uint8Array(buf);
    var dirOff = 512;
    // CFS partition end-ptr byte 0: 0x40 (LBA flag) | 0x10 (type 1) = 0x50
    assert.strictEqual(d[dirOff + 0 * 32 + 0x14], 0x50);
    // GEOS end-ptr byte 0: 0x40 | 0x20 = 0x60
    assert.strictEqual(d[dirOff + 1 * 32 + 0x14], 0x60);
    var info = readIde64Partitions(buf);
    assert.strictEqual(info.partitions[0].type, 1);
    assert.strictEqual(info.partitions[1].type, 2);
  });
});
