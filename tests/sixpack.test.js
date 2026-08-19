// Tests for SixPack ZipCode (6-file GCR format).
// Spec: disks/FORMATS/ZIP_SIX.TXT rev 1.4
//
// No SixPack sample exists to test against, so this synthesizes archives with
// a spec-conformant encoder. The encoder's GCR layer is pinned to the spec's
// own worked example, and the sector-header decode is pinned to the spec's
// hex dump, so the round-trips below rest on verified foundations.
const { describe, it } = require('node:test');
const assert = require('node:assert');
require('./test-helper');

var SPT = DISK_FORMATS.d64.sectorsPerTrack;
var RANGES_35 = [[1, 6], [7, 12], [13, 18], [19, 25], [26, 32], [33, 35]];
var RANGES_40 = [[1, 6], [7, 12], [13, 18], [19, 25], [26, 32], [33, 40]];

function d64Size(tracks) {
  var n = 0;
  for (var t = 1; t <= tracks; t++) n += SPT(t) * 256;
  return n;
}

function makeDisk(tracks, seed) {
  var buf = new Uint8Array(d64Size(tracks));
  var s = seed || 1;
  for (var i = 0; i < buf.length; i++) {
    s = (s * 1103515245 + 12345) & 0x7FFFFFFF;
    buf[i] = (s >> 8) & 0xFF;
  }
  return buf;
}

// ── spec-conformant encoder (test side) ──────────────────────────────
// 4 plain bytes -> 5 GCR bytes, the inverse of decodeGCR5.
function enc4(b0, b1, b2, b3) {
  var n = [(b0 >> 4) & 15, b0 & 15, (b1 >> 4) & 15, b1 & 15,
           (b2 >> 4) & 15, b2 & 15, (b3 >> 4) & 15, b3 & 15]
    .map(function(x) { return GCR_ENCODE[x]; });
  return [
    (n[0] << 3) | (n[1] >> 2),
    ((n[1] & 3) << 6) | (n[2] << 1) | (n[3] >> 4),
    ((n[3] & 15) << 4) | (n[4] >> 1),
    ((n[4] & 1) << 7) | (n[5] << 2) | (n[6] >> 3),
    ((n[6] & 7) << 5) | n[7],
  ];
}

function interleaveFor(track) {
  if (track <= 17) return [0, 8, 16, 3, 11, 19, 6, 14, 1, 9, 17, 4, 12, 20, 7, 15, 2, 10, 18, 5, 13];
  if (track <= 24) return [0, 8, 16, 5, 13, 2, 10, 18, 7, 15, 4, 12, 1, 9, 17, 6, 14, 3, 11];
  if (track <= 30) return [0, 8, 16, 6, 14, 4, 12, 2, 10, 1, 9, 17, 7, 15, 5, 13, 3, 11];
  return [0, 8, 16, 7, 15, 6, 14, 5, 13, 4, 12, 3, 11, 2, 10, 1, 9];
}

function sectorOff(track, sector) {
  var n = 0;
  for (var t = 1; t < track; t++) n += SPT(t);
  return (n + sector) * 256;
}

// opts per track: { count, startSector, badChecksum, idOverride, noSig }
function buildTrack(track, d64, diskId, opts) {
  opts = opts || {};
  var n = SPT(track);
  var desc = new Uint8Array(256);
  var start = opts.startSector || 0;
  var sectorAt = function(g) { return (start + g) % n; };
  var id = opts.idOverride || diskId;      // [id1, id2]

  for (var g = 0; g < n; g++) {
    var sec = sectorAt(g);
    var chk = sec ^ track ^ id[1] ^ id[0];
    var sig = opts.noSig ? 0x00 : 0x08;
    var a = enc4(sig, chk, sec, track);
    var b = enc4(id[1], id[0], 0x0F, 0x0F);
    desc.set(a.concat(b), g * 10);
  }
  // The spec notes real files carry a garbage string here; harmless filler.
  var junk = 'AME: 1234';
  for (var j = 0; j < junk.length; j++) desc[0xF6 + j] = junk.charCodeAt(j);
  desc[0xFF] = opts.count !== undefined ? opts.count : n;

  var parts = [desc];
  if (desc[0xFF] === 0) return desc;        // unreadable track: no data follows

  var order = interleaveFor(track);
  for (var k = 0; k < n; k++) {
    var sec2 = sectorAt(order[k]);
    var payload = d64.subarray(sectorOff(track, sec2), sectorOff(track, sec2) + 256);
    var gcr;
    if (opts.badChecksum && sec2 === opts.badChecksum.sector) {
      // Build the 260-byte block by hand with a deliberately wrong checksum,
      // then GCR-encode it. Corrupting the GCR bytes instead would make the
      // group undecodable, which is a different failure (error 22).
      var raw = new Uint8Array(260);
      raw[0] = 0x07;
      raw.set(payload, 1);
      var csum = 0;
      for (var c = 0; c < 256; c++) csum ^= payload[c];
      raw[257] = csum ^ 0xFF;               // wrong on purpose
      gcr = new Uint8Array(325);
      for (var g2 = 0; g2 < 65; g2++) {
        gcr.set(enc4(raw[g2 * 4], raw[g2 * 4 + 1], raw[g2 * 4 + 2], raw[g2 * 4 + 3]), g2 * 5);
      }
    } else {
      gcr = encodeGCRSector(payload);       // 325 bytes: $07 + data + csum + pad
    }
    var natural = new Uint8Array(326);
    natural.set(gcr, 0);
    natural[325] = 0x55;                    // the byte the decoder drops
    // Stored form: final 70 GCR bytes first, then the leading 256.
    var stored = new Uint8Array(326);
    stored.set(natural.subarray(256, 326), 0);
    stored.set(natural.subarray(0, 256), 70);
    parts.push(stored);
  }
  var total = 0;
  for (var p = 0; p < parts.length; p++) total += parts[p].length;
  var out = new Uint8Array(total);
  var o = 0;
  for (var q = 0; q < parts.length; q++) { out.set(parts[q], o); o += parts[q].length; }
  return out;
}

// trackOpts: { [track]: opts }
function buildSixPack(d64, tracks, trackOpts, sigOverride) {
  trackOpts = trackOpts || {};
  var diskId = [0x32, 0x31];                // [id1, id2] -> "12"
  var ranges = tracks === 40 ? RANGES_40 : RANGES_35;
  return ranges.map(function(r) {
    var chunks = [Uint8Array.from(sigOverride || [0xFF, 0x03, tracks === 40 ? 0x29 : 0x24])];
    for (var t = r[0]; t <= r[1]; t++) chunks.push(buildTrack(t, d64, diskId, trackOpts[t]));
    var total = 0;
    for (var i = 0; i < chunks.length; i++) total += chunks[i].length;
    var out = new Uint8Array(total);
    var o = 0;
    for (var j = 0; j < chunks.length; j++) { out.set(chunks[j], o); o += chunks[j].length; }
    return out;
  });
}

describe('SixPack encoder conformance (pins the test encoder to the spec)', () => {
  it('GCR-encodes the spec worked example', () => {
    // ZIP_SIX.TXT: 0D F5 E4 37 -> 57 6A FF 3A 77
    assert.deepStrictEqual(enc4(0x0D, 0xF5, 0xE4, 0x37), [0x57, 0x6A, 0xFF, 0x3A, 0x77]);
  });

  it('round-trips through the shipped decoder', () => {
    const gcr = Uint8Array.from(enc4(0x0D, 0xF5, 0xE4, 0x37));
    assert.deepStrictEqual(decodeGCR5(gcr, 0), [0x0D, 0xF5, 0xE4, 0x37]);
  });

  it('decodes the spec sector-header dump', () => {
    // GCR 52 55 25 29 4B 9A E7 25 55 55 -> 08 02 00 01 31 32 0F 0F
    const hdr = Uint8Array.from([0x52, 0x55, 0x25, 0x29, 0x4B, 0x9A, 0xE7, 0x25, 0x55, 0x55]);
    assert.deepStrictEqual(decodeGCR5(hdr, 0), [0x08, 0x02, 0x00, 0x01]);
    assert.deepStrictEqual(decodeGCR5(hdr, 5), [0x31, 0x32, 0x0F, 0x0F]);
  });

  it('matches the spec track sizes (256 + sectors * 326)', () => {
    assert.strictEqual(256 + 21 * 326, 0x1BC1 - 3);   // track 1 -> track 2 offset
    assert.strictEqual(256 + 19 * 326, 0x1935 - 3);   // track 19 -> track 20
    assert.strictEqual(256 + 18 * 326, 0x17EF - 3);   // track 26 -> track 27
    assert.strictEqual(256 + 17 * 326, 0x16A9 - 3);   // track 33 -> track 34
  });
});

describe('decompressSixPack round-trips', () => {
  it('rebuilds a 35-track disk byte-for-byte', () => {
    const disk = makeDisk(35, 5);
    const res = decompressSixPack(buildSixPack(disk, 35));
    assert.ok(!res.error, res.error);
    assert.strictEqual(res.tracks, 35);
    assert.strictEqual(res.missing, 0);
    assert.strictEqual(res.errorCount, 0);
    assert.ok(Buffer.from(new Uint8Array(res.buffer)).equals(Buffer.from(disk)));
  });

  it('rebuilds a 40-track disk byte-for-byte', () => {
    const disk = makeDisk(40, 9);
    const res = decompressSixPack(buildSixPack(disk, 40));
    assert.ok(!res.error, res.error);
    assert.strictEqual(res.tracks, 40);
    assert.strictEqual(res.missing, 0);
    assert.strictEqual(res.buffer.byteLength, 196608);
    assert.ok(Buffer.from(new Uint8Array(res.buffer)).equals(Buffer.from(disk)));
  });

  it('handles headers that do not start at sector 0', () => {
    // The spec calls out tracks running e.g. 4,5,...,20,0,1,2,3.
    const disk = makeDisk(35, 11);
    const res = decompressSixPack(buildSixPack(disk, 35, { 1: { startSector: 4 }, 18: { startSector: 7 } }));
    assert.ok(!res.error, res.error);
    assert.strictEqual(res.missing, 0);
    assert.strictEqual(res.errorCount, 0);
    assert.ok(Buffer.from(new Uint8Array(res.buffer)).equals(Buffer.from(disk)));
  });

  it('produces a plain D64 when the set is clean', () => {
    const res = decompressSixPack(buildSixPack(makeDisk(35, 3), 35));
    assert.strictEqual(sixPackToImage(res).byteLength, 174848);
  });
});

describe('decompressSixPack preserves errors', () => {
  it('marks a whole track error 21 when the sector count is zero', () => {
    const disk = makeDisk(35, 13);
    const res = decompressSixPack(buildSixPack(disk, 35, { 5: { count: 0 } }));
    assert.ok(!res.error, res.error);
    // Track 5 has 21 sectors, all unreadable.
    assert.strictEqual(res.errorCount, 21);
    let base = 0;
    for (let t = 1; t < 5; t++) base += SPT(t);
    for (let s = 0; s < 21; s++) assert.strictEqual(res.errors[base + s], 21);
    // Other tracks are untouched and still correct.
    assert.strictEqual(res.errors[0], 1);
  });

  it('flags a data checksum failure as error 23', () => {
    const disk = makeDisk(35, 17);
    const res = decompressSixPack(buildSixPack(disk, 35, { 3: { badChecksum: { sector: 0 } } }));
    assert.ok(!res.error, res.error);
    let base = 0;
    for (let t = 1; t < 3; t++) base += SPT(t);
    assert.strictEqual(res.errors[base], 23);
    assert.strictEqual(res.errorCount, 1);
  });

  it('flags a disk ID mismatch as error 29', () => {
    // Master ID is taken from track 18; track 19 onward is decoded after it.
    const disk = makeDisk(35, 19);
    const res = decompressSixPack(buildSixPack(disk, 35, { 19: { idOverride: [0x41, 0x42] } }));
    assert.ok(!res.error, res.error);
    let base = 0;
    for (let t = 1; t < 19; t++) base += SPT(t);
    assert.strictEqual(res.errors[base], 29);
  });

  it('flags a missing header descriptor as error 20', () => {
    const disk = makeDisk(35, 23);
    const res = decompressSixPack(buildSixPack(disk, 35, { 2: { noSig: true } }));
    assert.ok(!res.error, res.error);
    let base = SPT(1);
    assert.strictEqual(res.errors[base], 20);
  });

  it('appends the error table when the set has errors', () => {
    const res = decompressSixPack(buildSixPack(makeDisk(35, 29), 35, { 5: { count: 0 } }));
    // 174848 + 683 error bytes = the standard "+Errors" D64 size.
    assert.strictEqual(sixPackToImage(res).byteLength, 175531);
  });
});

describe('decompressSixPack rejects bad input', () => {
  it('needs exactly six files', () => {
    assert.ok(decompressSixPack([]).error);
    assert.ok(decompressSixPack(buildSixPack(makeDisk(35, 3), 35).slice(0, 5)).error);
  });

  it('rejects a missing $FF $03 signature', () => {
    const files = buildSixPack(makeDisk(35, 3), 35);
    files[0][0] = 0x00;
    const res = decompressSixPack(files);
    assert.ok(res.error && /signature/.test(res.error), res.error);
  });

  it('rejects an unknown track-count byte', () => {
    const files = buildSixPack(makeDisk(35, 3), 35);
    files[0][2] = 0x99;
    const res = decompressSixPack(files);
    assert.ok(res.error && /track-count/.test(res.error), res.error);
  });

  it('rejects a truncated file', () => {
    const files = buildSixPack(makeDisk(35, 3), 35);
    files[2] = files[2].subarray(0, 400);
    assert.ok(decompressSixPack(files).error);
  });
});

describe('findSixPackSets', () => {
  const mk = names => names.map((n, i) => ({ name: n, ref: 100 + i }));

  it('finds a complete six-file set', () => {
    const r = findSixPackSets(mk(['1!!GAME', '2!!GAME', '3!!GAME', '4!!GAME', '5!!GAME', '6!!GAME']));
    assert.strictEqual(r.complete.length, 1);
    assert.strictEqual(r.complete[0].name, 'GAME');
    assert.deepStrictEqual(r.complete[0].refs, [100, 101, 102, 103, 104, 105]);
  });

  it('orders refs 1!!..6!! regardless of input order', () => {
    const r = findSixPackSets(mk(['6!!G', '1!!G', '4!!G', '2!!G', '5!!G', '3!!G']));
    assert.deepStrictEqual(r.complete[0].refs, [101, 103, 105, 102, 104, 100]);
  });

  it('reports a five-of-six set as partial', () => {
    const r = findSixPackSets(mk(['1!!G', '2!!G', '3!!G', '4!!G', '5!!G']));
    assert.strictEqual(r.complete.length, 0);
    assert.deepStrictEqual(r.partial[0].found, ['1', '2', '3', '4', '5']);
  });

  it('ignores single-bang (DiskPacked) names', () => {
    const r = findSixPackSets(mk(['1!G', '2!G', '3!G', '4!G']));
    assert.strictEqual(r.complete.length, 0);
    assert.strictEqual(r.partial.length, 0);
  });

  it('separates two sets', () => {
    const r = findSixPackSets(mk([
      '1!!A', '2!!A', '3!!A', '4!!A', '5!!A', '6!!A',
      '1!!B', '2!!B', '3!!B', '4!!B', '5!!B', '6!!B',
    ]));
    assert.strictEqual(r.complete.length, 2);
  });
});
