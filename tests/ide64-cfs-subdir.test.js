// CFS multi-sector directories + subdirectory walking tests.
// Phase 3b — readCfsDirectory walks the dir chain via _cfsReadDirNext.

const { describe, it } = require('node:test');
const assert = require('node:assert');
require('./test-helper');

// Write a 4-byte LBA pointer at byte offset `off` in `d`.
function writeDataPointer(d, off, lba) {
  d[off + 0] = 0x40 | ((lba >>> 24) & 0x0F);
  d[off + 1] = (lba >>> 16) & 0xFF;
  d[off + 2] = (lba >>> 8) & 0xFF;
  d[off + 3] = lba & 0xFF;
}

// Encode a "next directory sector" LBA into a 512-B dir sector via the
// bit-sliced scheme — bits 5..4 of byte 0 of every entry's data-tree-
// pointer field ($14 within the 32-B entry). Inverse of _cfsReadDirNext.
function writeDirNext(d, sectorBase, lba) {
  var bytes = [
    0x40 | ((lba >>> 24) & 0x0F),
    (lba >>> 16) & 0xFF,
    (lba >>> 8) & 0xFF,
    lba & 0xFF,
  ];
  for (var i = 0; i < 4; i++) {
    var bj = bytes[i];
    var entryBase = sectorBase + 0x180 - i * 0x80;
    d[entryBase + 0x14] = (d[entryBase + 0x14] & ~0x30) | ((bj >>> 2) & 0x30);
    d[entryBase + 0x34] = (d[entryBase + 0x34] & ~0x30) | (bj & 0x30);
    d[entryBase + 0x54] = (d[entryBase + 0x54] & ~0x30) | ((bj << 2) & 0x30);
    d[entryBase + 0x74] = (d[entryBase + 0x74] & ~0x30) | ((bj << 4) & 0x30);
  }
}

// Place a CFS directory entry. slotIndex 0..15 within the sector at
// dirLba. Sets name, ftype, type suffix, attributes (closed PRG by default),
// and a tree pointer at $14.
function writeCfsEntry(d, dirLba, slotIndex, opts) {
  var eo = dirLba * 512 + slotIndex * 32;
  var name = opts.name || '';
  for (var n = 0; n < 16; n++) {
    d[eo + n] = n < name.length ? name.charCodeAt(n) : 0x20;
  }
  // size at $10..$13
  var sz = opts.size || 0;
  d[eo + 0x10] = sz & 0xFF;
  d[eo + 0x11] = (sz >>> 8) & 0xFF;
  d[eo + 0x12] = (sz >>> 16) & 0xFF;
  d[eo + 0x13] = (sz >>> 24) & 0xFF;
  // data-tree pointer at $14..$17 (preserve any treelink bits if already set)
  var tree = opts.tree || 0;
  d[eo + 0x14] = (d[eo + 0x14] & 0x30) | 0xC0 | ((tree >>> 24) & 0x0F);
  d[eo + 0x15] = (tree >>> 16) & 0xFF;
  d[eo + 0x16] = (tree >>> 8) & 0xFF;
  d[eo + 0x17] = tree & 0xFF;
  // attr byte
  d[eo + 0x18] = (opts.attrByte != null) ? opts.attrByte : (0x80 | (opts.ftype || 0));
  // type suffix
  var suf = opts.typeSuffix || '';
  for (var s = 0; s < 3; s++) {
    d[eo + 0x19 + s] = s < suf.length ? suf.charCodeAt(s) : 0x20;
  }
}

describe('CFS multi-sector directories', function() {
  it('readCfsDirectory walks a 2-sector chain via _cfsReadDirNext', function() {
    var buf = new ArrayBuffer(2 * 1024 * 1024);
    var d = new Uint8Array(buf);

    // Sector A at LBA 10: self-ref + 15 PRG entries
    writeCfsEntry(d, 10, 0, { name: 'DIR', ftype: 3, typeSuffix: 'DIR', attrByte: 0x83 });
    for (var i = 1; i < 16; i++) {
      writeCfsEntry(d, 10, i, { name: 'F' + i, ftype: 1, typeSuffix: 'PRG', size: 100 + i, attrByte: 0x81 });
    }
    // Sector B at LBA 11: 3 more PRG entries
    for (var j = 0; j < 3; j++) {
      writeCfsEntry(d, 11, j, { name: 'G' + j, ftype: 1, typeSuffix: 'PRG', size: 200 + j, attrByte: 0x81 });
    }
    // Link sector A → sector B
    writeDirNext(d, 10 * 512, 11);

    var entries = readCfsDirectory(buf, 10);
    assert.ok(entries);
    // 32 slots total (2 sectors × 16); 16 used (1 self-ref + 15 from A + 3 from B... wait the rest of B is empty)
    // Total entries returned = 32 (all 16 slots from each sector)
    assert.strictEqual(entries.length, 32);
    // Sector A entries
    assert.strictEqual(entries[0].name, 'DIR');
    assert.strictEqual(entries[0].isSelfRef, true);
    assert.strictEqual(entries[1].name, 'F1');
    assert.strictEqual(entries[15].name, 'F15');
    // Sector B entries — entry 0 of sector B should NOT be flagged as
    // self-ref (only the very first sector's slot 0 is the true self-ref)
    assert.strictEqual(entries[16].name, 'G0');
    assert.strictEqual(entries[16].isSelfRef, false);
    assert.strictEqual(entries[17].name, 'G1');
    assert.strictEqual(entries[18].name, 'G2');
    // Remaining slots in sector B are empty
    for (var k = 19; k < 32; k++) {
      assert.strictEqual(entries[k].empty, true);
    }
  });

  it('readCfsDirectory caps at 64 sectors and stops on cycle', function() {
    var buf = new ArrayBuffer(64 * 1024);
    var d = new Uint8Array(buf);
    writeCfsEntry(d, 10, 0, { name: 'DIR', ftype: 3, typeSuffix: 'DIR' });
    // Self-loop: sector A points back to itself
    writeDirNext(d, 10 * 512, 10);
    var entries = readCfsDirectory(buf, 10);
    // Should return just one sector's worth, not loop forever
    assert.strictEqual(entries.length, 16);
  });

  it('readCfsDirectory returns null on null buffer / zero LBA', function() {
    assert.strictEqual(readCfsDirectory(null, 1), null);
    assert.strictEqual(readCfsDirectory(new ArrayBuffer(1024), 0), null);
  });
});

describe('cfsResolvePath', function() {
  it('finds a flat file name in the start dir', function() {
    var buf = new ArrayBuffer(1024 * 1024);
    var d = new Uint8Array(buf);
    writeCfsEntry(d, 10, 0, { name: 'ROOT', ftype: 3, typeSuffix: 'DIR' });
    writeCfsEntry(d, 10, 1, { name: 'HELLO', ftype: 1, typeSuffix: 'PRG', size: 100 });
    var found = cfsResolvePath(buf, 10, 'HELLO');
    assert.ok(found);
    assert.strictEqual(found.name, 'HELLO');
    assert.strictEqual(found.size, 100);
  });

  it('walks a multi-component path through subdirs', function() {
    var buf = new ArrayBuffer(2 * 1024 * 1024);
    var d = new Uint8Array(buf);
    writeCfsEntry(d, 10, 0, { name: 'ROOT', ftype: 3, typeSuffix: 'DIR' });
    writeCfsEntry(d, 10, 1, { name: 'GAMES', ftype: 3, typeSuffix: 'DIR', tree: 20 });
    writeCfsEntry(d, 20, 0, { name: 'GAMES', ftype: 3, typeSuffix: 'DIR' });
    writeCfsEntry(d, 20, 1, { name: 'BOULDER', ftype: 1, typeSuffix: 'PRG', size: 30000 });
    var found = cfsResolvePath(buf, 10, 'GAMES/BOULDER');
    assert.ok(found);
    assert.strictEqual(found.name, 'BOULDER');
    assert.strictEqual(found.size, 30000);
  });

  it('returns null when any component is missing', function() {
    var buf = new ArrayBuffer(1024 * 1024);
    var d = new Uint8Array(buf);
    writeCfsEntry(d, 10, 0, { name: 'ROOT', ftype: 3, typeSuffix: 'DIR' });
    writeCfsEntry(d, 10, 1, { name: 'HELLO', ftype: 1, typeSuffix: 'PRG' });
    assert.strictEqual(cfsResolvePath(buf, 10, 'NOPE'), null);
    assert.strictEqual(cfsResolvePath(buf, 10, 'HELLO/MORE'), null); // can't descend into PRG
  });

  it('handles leading and trailing slashes', function() {
    var buf = new ArrayBuffer(1024 * 1024);
    var d = new Uint8Array(buf);
    writeCfsEntry(d, 10, 0, { name: 'ROOT', ftype: 3, typeSuffix: 'DIR' });
    writeCfsEntry(d, 10, 1, { name: 'HELLO', ftype: 1, typeSuffix: 'PRG' });
    assert.ok(cfsResolvePath(buf, 10, '/HELLO'));
    assert.ok(cfsResolvePath(buf, 10, 'HELLO/'));
    assert.ok(cfsResolvePath(buf, 10, '/HELLO/'));
  });
});

describe('CFS subdirectory entries', function() {
  it('readCfsDirectory finds a subdir entry and its tree pointer leads to its first dir sector', function() {
    var buf = new ArrayBuffer(2 * 1024 * 1024);
    var d = new Uint8Array(buf);

    // Root dir at LBA 10
    writeCfsEntry(d, 10, 0, { name: 'ROOT', ftype: 3, typeSuffix: 'DIR' });
    writeCfsEntry(d, 10, 1, { name: 'GAMES', ftype: 3, typeSuffix: 'DIR', tree: 20 });
    writeCfsEntry(d, 10, 2, { name: 'MAIN', ftype: 1, typeSuffix: 'PRG', size: 1000 });

    // Subdir at LBA 20
    writeCfsEntry(d, 20, 0, { name: 'GAMES', ftype: 3, typeSuffix: 'DIR' });
    writeCfsEntry(d, 20, 1, { name: 'BOULDER', ftype: 1, typeSuffix: 'PRG', size: 30000 });

    // Walk root: should see ROOT (self), GAMES, MAIN
    var root = readCfsDirectory(buf, 10);
    var games = root.find(function(e) { return e.name === 'GAMES'; });
    assert.ok(games);
    assert.strictEqual(games.ftype, 3);
    assert.strictEqual(games.dataTreePtr.lba, true);
    assert.strictEqual(games.dataTreePtr.addr, 20);

    // Walk into the subdir
    var sub = readCfsDirectory(buf, games.dataTreePtr.addr);
    var boulder = sub.find(function(e) { return e.name === 'BOULDER'; });
    assert.ok(boulder);
    assert.strictEqual(boulder.size, 30000);
    assert.strictEqual(boulder.typeSuffix, 'PRG');
  });
});
