// CFS 0.11 directory-sector reader tests.
// Phase 2: parse a directory sector (16 entries × 32 B), pull out name,
// type, size, mtime, attrs. No file content / B-tree walk yet.

const { describe, it } = require('node:test');
const assert = require('node:assert');
require('./test-helper');

// Pack a CFS mtime into 4 bytes. Inverse of decodeCfsTimestamp; used by
// tests to round-trip a known timestamp.
function packCfsTimestamp(year, month, day, hour, min, sec) {
  var yearOffset = year - 1980;
  var b0 = (sec & 0x3F) | (((month >>> 2) & 0x03) << 6);
  var b1 = (min & 0x3F) | ((month & 0x03) << 6);
  var b2 = (yearOffset & 0x3F) | (((hour >>> 3) & 0x03) << 6);
  var b3 = (day & 0x1F) | ((hour & 0x07) << 5);
  return [b0, b1, b2, b3];
}

// Build a single 512-B CFS dir sector with the given entries at the
// given LBA inside a 1 MiB scratch buffer. Returns the buffer.
// entrySpecs: array of { name, ftype, typeSuffix, size, attrByte, mtime }
// where mtime is [b0,b1,b2,b3] (use packCfsTimestamp).
function makeDirSector(entrySpecs, dirLba) {
  dirLba = dirLba || 1;
  var buf = new ArrayBuffer(1024 * 1024);
  var d = new Uint8Array(buf);
  var base = dirLba * 512;
  for (var i = 0; i < entrySpecs.length && i < 16; i++) {
    var spec = entrySpecs[i];
    if (!spec) continue;
    var eo = base + i * 32;
    for (var n = 0; n < 16; n++) {
      d[eo + n] = n < spec.name.length ? spec.name.charCodeAt(n) : 0x20;
    }
    // size at $10..$13 LE
    var sz = spec.size || 0;
    d[eo + 0x10] = sz & 0xFF;
    d[eo + 0x11] = (sz >>> 8) & 0xFF;
    d[eo + 0x12] = (sz >>> 16) & 0xFF;
    d[eo + 0x13] = (sz >>> 24) & 0xFF;
    // data-tree pointer at $14..$17 (LBA + LBA flag + VALID)
    var treeLba = spec.dataLba || 0;
    d[eo + 0x14] = 0xC0 | ((treeLba >>> 24) & 0x0F);
    d[eo + 0x15] = (treeLba >>> 16) & 0xFF;
    d[eo + 0x16] = (treeLba >>> 8) & 0xFF;
    d[eo + 0x17] = treeLba & 0xFF;
    // attribute byte
    d[eo + 0x18] = spec.attrByte != null ? spec.attrByte : (0x80 | spec.ftype);
    // type suffix
    var suf = spec.typeSuffix || '';
    for (var s = 0; s < 3; s++) {
      d[eo + 0x19 + s] = s < suf.length ? suf.charCodeAt(s) : 0x20;
    }
    // mtime
    var mt = spec.mtime || [0, 0, 0, 0];
    d[eo + 0x1C] = mt[0]; d[eo + 0x1D] = mt[1]; d[eo + 0x1E] = mt[2]; d[eo + 0x1F] = mt[3];
  }
  return buf;
}

describe('CFS directory parser', function() {
  it('decodeCfsTimestamp returns null for all-zero bytes (unset mtime)', function() {
    assert.strictEqual(decodeCfsTimestamp(0, 0, 0, 0), null);
  });

  it('decodeCfsTimestamp round-trips packed bytes back to YYYY-MM-DD HH:MM:SS', function() {
    // 2026-05-15 14:30:45
    var packed = packCfsTimestamp(2026, 5, 15, 14, 30, 45);
    var ts = decodeCfsTimestamp(packed[0], packed[1], packed[2], packed[3]);
    assert.strictEqual(ts.year, 2026);
    assert.strictEqual(ts.month, 5);
    assert.strictEqual(ts.day, 15);
    assert.strictEqual(ts.hour, 14);
    assert.strictEqual(ts.min, 30);
    assert.strictEqual(ts.sec, 45);
  });

  it('formatCfsTimestamp produces YYYY-MM-DD HH:MM:SS with zero padding', function() {
    var ts = decodeCfsTimestamp.apply(null, packCfsTimestamp(2001, 1, 2, 3, 4, 5));
    assert.strictEqual(formatCfsTimestamp(ts), '2001-01-02 03:04:05');
    assert.strictEqual(formatCfsTimestamp(null), '');
  });

  it('readCfsDirectorySector parses 16 slots with empty flag for zero slots', function() {
    var buf = makeDirSector([
      { name: 'SELF',  ftype: CFS_FTYPE.DIR,    typeSuffix: 'DIR', attrByte: 0x3B },
      { name: 'README', ftype: CFS_FTYPE.NORMAL, typeSuffix: 'SEQ', size: 1234, attrByte: 0x80 | CFS_FTYPE.NORMAL },
      { name: 'HELLO',  ftype: CFS_FTYPE.NORMAL, typeSuffix: 'PRG', size: 4096, attrByte: 0x80 | CFS_FTYPE.NORMAL,
        mtime: packCfsTimestamp(2026, 5, 15, 14, 30, 45) },
      { name: 'GAMES',  ftype: CFS_FTYPE.DIR,    typeSuffix: 'DIR', attrByte: 0x80 | CFS_FTYPE.DIR },
    ]);
    var entries = readCfsDirectorySector(buf, 1);
    assert.ok(entries);
    assert.strictEqual(entries.length, 16);

    // Entry 0: dir self-reference
    assert.strictEqual(entries[0].empty, false);
    assert.strictEqual(entries[0].isSelfRef, true);
    assert.strictEqual(petsciiToReadable(entries[0].name), 'SELF');
    assert.strictEqual(entries[0].ftype, CFS_FTYPE.DIR);

    // Entry 1: SEQ file
    assert.strictEqual(petsciiToReadable(entries[1].name), 'README');
    assert.strictEqual(entries[1].typeSuffix, 'SEQ');
    assert.strictEqual(entries[1].ftype, CFS_FTYPE.NORMAL);
    assert.strictEqual(entries[1].size, 1234);
    assert.strictEqual(entries[1].closed, true);

    // Entry 2: PRG with mtime
    assert.strictEqual(petsciiToReadable(entries[2].name), 'HELLO');
    assert.strictEqual(entries[2].typeSuffix, 'PRG');
    assert.strictEqual(entries[2].size, 4096);
    assert.ok(entries[2].mtime);
    assert.strictEqual(entries[2].mtime.year, 2026);
    assert.strictEqual(entries[2].mtime.month, 5);

    // Entry 3: subdir
    assert.strictEqual(petsciiToReadable(entries[3].name), 'GAMES');
    assert.strictEqual(entries[3].ftype, CFS_FTYPE.DIR);

    // Slots 4..15: empty
    for (var i = 4; i < 16; i++) {
      assert.strictEqual(entries[i].empty, true);
    }
  });

  it('readCfsDirectorySector returns null when dirLba is out of buffer range', function() {
    var buf = new ArrayBuffer(1024); // 2 sectors
    assert.strictEqual(readCfsDirectorySector(buf, 100), null);
  });

  it('parses size > 16 MiB (uses high byte at $13)', function() {
    var big = 30 * 1024 * 1024; // 30 MiB
    var buf = makeDirSector([
      null, // skip slot 0
      { name: 'BIG', ftype: CFS_FTYPE.NORMAL, typeSuffix: 'USR', size: big, attrByte: 0x80 | CFS_FTYPE.NORMAL },
    ]);
    var entries = readCfsDirectorySector(buf, 1);
    assert.strictEqual(entries[1].size, big);
  });

  it('reads from real reference image: VICE PARTITION 1 has self-ref + %DELETED FILES%', function() {
    var fs = require('fs');
    var path = require('path');
    var refPath = path.join(__dirname, 'fixtures', 'ide-reference.hdd');
    if (!fs.existsSync(refPath)) {
      // Reference image not present locally — skip rather than fail.
      return;
    }
    var buf = fs.readFileSync(refPath).buffer;
    var info = readIde64Partitions(buf);
    var p0 = info.partitions[0];
    assert.strictEqual(p0.type, 0x01);
    var entries = readCfsDirectorySector(buf, p0.cfsRootDir.addr);
    assert.ok(entries);
    assert.strictEqual(entries[0].isSelfRef, true);
    assert.strictEqual(petsciiToReadable(entries[0].name), 'VICE PARTITION 1');
    assert.strictEqual(entries[0].ftype, CFS_FTYPE.DIR);
    assert.strictEqual(petsciiToReadable(entries[1].name), '%DELETED  FILES%');
    assert.strictEqual(entries[1].ftype, CFS_FTYPE.DIR);
    // All other slots empty on this fresh image
    for (var i = 2; i < 16; i++) {
      assert.strictEqual(entries[i].empty, true);
    }
  });
});
