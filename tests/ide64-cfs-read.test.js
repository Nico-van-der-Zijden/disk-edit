// CFS B-tree file reader tests.
// Phase 3: readCfsFileData walks the data tree and returns file bytes.

const { describe, it } = require('node:test');
const assert = require('node:assert');
require('./test-helper');

// Encode a data-sector pointer (4 bytes) at the given byte offset.
// VALID + LBA + 28-bit LBA. Leaves bits 5..4 zero — those are the
// slice bits reserved for treelink encoding.
function writeDataPointer(d, off, lba) {
  d[off + 0] = 0x40 | ((lba >>> 24) & 0x0F);
  d[off + 1] = (lba >>> 16) & 0xFF;
  d[off + 2] = (lba >>> 8) & 0xFF;
  d[off + 3] = lba & 0xFF;
}

// Encode a treelink (next-level tree pointer) into a 64-byte sub-region
// of a tree sector by stuffing bits 5..4 of byte 0 of 16 4-byte slots.
// Inverse of _cfsReadTreeLink, faithful to fusecfs set_treelink().
function writeTreeLink(d, base, addr) {
  var bytes = [
    0x40 | ((addr >>> 24) & 0x0F),
    (addr >>> 16) & 0xFF,
    (addr >>> 8) & 0xFF,
    addr & 0xFF,
  ];
  for (var i = 0; i < 4; i++) {
    var bj = bytes[i];
    var entryBase = base + (3 - i) * 16;
    d[entryBase + 0]  = (d[entryBase + 0]  & ~0x30) | ((bj >>> 2) & 0x30);
    d[entryBase + 4]  = (d[entryBase + 4]  & ~0x30) | (bj & 0x30);
    d[entryBase + 8]  = (d[entryBase + 8]  & ~0x30) | ((bj << 2) & 0x30);
    d[entryBase + 12] = (d[entryBase + 12] & ~0x30) | ((bj << 4) & 0x30);
  }
}

describe('CFS B-tree file reader', function() {
  it('readCfsFileData returns empty for zero-size or null root', function() {
    var buf = new ArrayBuffer(4096);
    assert.deepStrictEqual(readCfsFileData(buf, 1, 0).data.length, 0);
    assert.deepStrictEqual(readCfsFileData(buf, null, 100).data.length, 0);
    assert.deepStrictEqual(readCfsFileData(buf, 0, 100).data.length, 0);
  });

  it('reads a tiny file (≤512 B) via single tree node + one data sector', function() {
    var buf = new ArrayBuffer(64 * 1024);
    var d = new Uint8Array(buf);

    var treeLba = 10;
    var dataLba = 11;
    // Tree sector: write data pointer 0 → dataLba
    writeDataPointer(d, treeLba * 512 + 0, dataLba);
    // Data sector: 'HELLO, CFS!' byte-sliced per CFS spec — file byte N
    // lives at sector offset (N & 0x7F) * 4 + (N >> 7).
    var payload = 'HELLO, CFS!';
    for (var i = 0; i < payload.length; i++) {
      var sliceOff = (i & 0x7F) * 4 + (i >>> 7);
      d[dataLba * 512 + sliceOff] = payload.charCodeAt(i);
    }

    var res = readCfsFileData(buf, treeLba, payload.length);
    assert.strictEqual(res.error, null);
    assert.strictEqual(Buffer.from(res.data).toString('utf8'), payload);
  });

  it('reads a multi-sector file in one leaf (≤64 KiB) via 128 data pointers', function() {
    var buf = new ArrayBuffer(128 * 1024);
    var d = new Uint8Array(buf);
    var treeLba = 10;
    var fileSize = 3 * 512 + 100; // 3 full sectors + partial 4th

    // Tree sector at LBA 10, data sectors at 20, 21, 22, 23
    for (var s = 0; s < 4; s++) {
      writeDataPointer(d, treeLba * 512 + s * 4, 20 + s);
      // Each data sector filled with sector index byte
      for (var b = 0; b < 512; b++) {
        d[(20 + s) * 512 + b] = (s + 1) & 0xFF;
      }
    }

    var res = readCfsFileData(buf, treeLba, fileSize);
    assert.strictEqual(res.error, null);
    assert.strictEqual(res.data.length, fileSize);
    // Verify first sector = 0x01
    for (var i = 0; i < 512; i++) assert.strictEqual(res.data[i], 1);
    // Second sector = 0x02
    for (var j = 512; j < 1024; j++) assert.strictEqual(res.data[j], 2);
    // Third sector = 0x03
    for (var k = 1024; k < 1536; k++) assert.strictEqual(res.data[k], 3);
    // Fourth partial = 0x04
    for (var m = 1536; m < 1536 + 100; m++) assert.strictEqual(res.data[m], 4);
  });

  it('sparse holes read as zeros (missing data-pointer in tree)', function() {
    var buf = new ArrayBuffer(64 * 1024);
    var d = new Uint8Array(buf);
    var treeLba = 10;
    // Leave data pointer 0 unset (zero bytes), set pointer 1
    writeDataPointer(d, treeLba * 512 + 4, 20);
    for (var b = 0; b < 512; b++) d[20 * 512 + b] = 0xAA;

    var res = readCfsFileData(buf, treeLba, 1024);
    assert.strictEqual(res.error, null);
    // First sector: hole → all zero
    for (var i = 0; i < 512; i++) assert.strictEqual(res.data[i], 0);
    // Second sector: 0xAA
    for (var j = 512; j < 1024; j++) assert.strictEqual(res.data[j], 0xAA);
  });

  it('walks multi-level tree (>64 KiB file via tree-link slicing)', function() {
    // The CFS slicing scheme overlays data pointers and treelinks in
    // the same bytes — the root sector is BOTH a leaf (offsets 0..64K
    // via data pointers at bytes 0..511) AND a level-1 internal node
    // (offsets ≥64K via treelinks scattered across bits 5..4 of those
    // same data pointers). The two encodings don't collide because
    // data pointers ignore bits 5..4 and treelinks only use those bits.
    var buf = new ArrayBuffer(2 * 1024 * 1024);
    var d = new Uint8Array(buf);

    var rootLba = 100;
    var leaf1Lba = 300; // tree-link target for offsets 65536..131071

    // Root, used as level-0 leaf: data pointer 0 → sector 200 full of 0x11
    writeDataPointer(d, rootLba * 512 + 0, 200);
    for (var b = 0; b < 512; b++) d[200 * 512 + b] = 0x11;

    // Root, used as level-1 internal: treelink region 0 → leaf1Lba.
    // Sub-region 0 spans bytes 0..63 — overlaps with data pointers 0..15
    // but only writes bits 5..4 of byte 0 of each of those 16 pointers,
    // leaving the LBA bits alone.
    writeTreeLink(d, rootLba * 512 + 0, leaf1Lba);

    // Leaf1 (level-0): data pointer 0 → sector 400 full of 0x22
    writeDataPointer(d, leaf1Lba * 512 + 0, 400);
    for (var b2 = 0; b2 < 512; b2++) d[400 * 512 + b2] = 0x22;

    var res = readCfsFileData(buf, rootLba, 65536 + 256);
    assert.strictEqual(res.error, null);
    // First 512 bytes (offsets 0..511): root as level-0 leaf → sector 200 → 0x11
    for (var i = 0; i < 512; i++) assert.strictEqual(res.data[i], 0x11, 'leaf0 byte ' + i);
    // Bytes 512..65535 are sparse holes (root has no further data pointers)
    for (var h = 512; h < 65536; h++) assert.strictEqual(res.data[h], 0x00, 'hole byte ' + h);
    // Bytes 65536..65791: walk root → treelink region 0 → leaf1 → sector 400 → 0x22
    for (var j = 65536; j < 65536 + 256; j++) assert.strictEqual(res.data[j], 0x22, 'leaf1 byte ' + j);
  });

  it('treelink encoder/decoder round-trip via _cfsReadTreeLink', function() {
    // White-box-ish: confirm the bit-slicing encoder matches the decoder.
    var d = new Uint8Array(512);
    writeTreeLink(d, 0, 0x1234567);
    // _cfsReadTreeLink is not exported in production code but lives in the
    // same vm context as the test (via test-helper.loadScript). Sanity-
    // check it pulls back the same LBA.
    var link = _cfsReadTreeLink(d, 0);
    assert.strictEqual(link.lba, true);
    assert.strictEqual(link.addr, 0x1234567);
  });
});
