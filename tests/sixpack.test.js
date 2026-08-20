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

  // Only `count` blocks are stored — the count byte is what sets the stride to
  // the next track, so writing more would desync a reader.
  var order = interleaveFor(track);
  for (var k = 0; k < desc[0xFF]; k++) {
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

describe('compressSixPack (creating a set)', () => {
  it('round-trips a 35-track disk', () => {
    const disk = makeDisk(35, 41);
    const enc = compressSixPack(disk.buffer, 'OUT');
    assert.ok(!enc.error, enc.error);
    assert.strictEqual(enc.parts.length, 6);
    assert.strictEqual(enc.tracks, 35);
    const back = decompressSixPack(enc.parts.map(p => p.data));
    assert.ok(!back.error, back.error);
    assert.strictEqual(back.missing, 0);
    assert.strictEqual(back.errorCount, 0);
    assert.ok(Buffer.from(new Uint8Array(back.buffer)).equals(Buffer.from(disk)));
  });

  it('round-trips a 40-track disk', () => {
    const disk = makeDisk(40, 43);
    const enc = compressSixPack(disk.buffer, 'BIG');
    const back = decompressSixPack(enc.parts.map(p => p.data));
    assert.strictEqual(back.tracks, 40);
    assert.ok(Buffer.from(new Uint8Array(back.buffer)).equals(Buffer.from(disk)));
  });

  it('names parts 1!!NAME .. 6!!NAME, capped at 13 characters', () => {
    const enc = compressSixPack(makeDisk(35, 3).buffer, 'a-really-long-name');
    assert.deepStrictEqual(enc.parts.map(p => p.name),
      ['1!!A-REALLY-LONG', '2!!A-REALLY-LONG', '3!!A-REALLY-LONG',
       '4!!A-REALLY-LONG', '5!!A-REALLY-LONG', '6!!A-REALLY-LONG']);
    assert.ok(enc.parts.every(p => p.name.length <= 16));
  });

  it('writes the signature and track-count byte', () => {
    const a = compressSixPack(makeDisk(35, 5).buffer, 'A');
    assert.deepStrictEqual(Array.from(a.parts[0].data.subarray(0, 3)), [0xFF, 0x03, 0x24]);
    const b = compressSixPack(makeDisk(40, 5).buffer, 'B');
    assert.deepStrictEqual(Array.from(b.parts[0].data.subarray(0, 3)), [0xFF, 0x03, 0x29]);
  });

  it('preserves every error code it can express', () => {
    const disk = makeDisk(35, 47);
    const spt = DISK_FORMATS.d64.sectorsPerTrack;
    let total = 0;
    for (let t = 1; t <= 35; t++) total += spt(t);
    const errors = new Uint8Array(total).fill(1);
    const idx = (t, s) => { let n = 0; for (let k = 1; k < t; k++) n += spt(k); return n + s; };

    errors[idx(2, 0)] = 20;                       // header descriptor missing
    errors[idx(3, 1)] = 27;                       // header checksum
    errors[idx(4, 2)] = 22;                       // data descriptor missing
    errors[idx(5, 3)] = 23;                       // data checksum
    errors[idx(6, 4)] = 29;                       // disk ID mismatch
    for (let s = 0; s < spt(9); s++) errors[idx(9, s)] = 21;   // whole track unreadable

    const enc = compressSixPack(disk.buffer, 'ERRS', errors);
    const back = decompressSixPack(enc.parts.map(p => p.data));
    assert.ok(!back.error, back.error);
    assert.strictEqual(back.errors[idx(2, 0)], 20);
    assert.strictEqual(back.errors[idx(3, 1)], 27);
    assert.strictEqual(back.errors[idx(4, 2)], 22);
    assert.strictEqual(back.errors[idx(5, 3)], 23);
    assert.strictEqual(back.errors[idx(6, 4)], 29);
    for (let s = 0; s < spt(9); s++) assert.strictEqual(back.errors[idx(9, s)], 21, 'track 9 sector ' + s);
  });

  it('reads the error table out of a +Errors image automatically', () => {
    const spt = DISK_FORMATS.d64.sectorsPerTrack;
    let total = 0;
    for (let t = 1; t <= 35; t++) total += spt(t);
    const img = new Uint8Array(174848 + total);
    img.fill(1, 174848);                          // all sectors OK
    img[174848 + total - 1] = 23;                 // last sector: data checksum
    const enc = compressSixPack(img.buffer, 'AUTO');
    const back = decompressSixPack(enc.parts.map(p => p.data));
    assert.strictEqual(back.errors[total - 1], 23);
    assert.strictEqual(back.errorCount, 1);
  });

  it('an unreadable track stores no sector data, shrinking the part', () => {
    const disk = makeDisk(35, 51);
    const spt = DISK_FORMATS.d64.sectorsPerTrack;
    let total = 0;
    for (let t = 1; t <= 35; t++) total += spt(t);
    const errors = new Uint8Array(total).fill(1);
    for (let s = 0; s < spt(1); s++) errors[s] = 21;          // track 1 dead
    const plain = compressSixPack(disk.buffer, 'A');
    const dead = compressSixPack(disk.buffer, 'A', errors);
    assert.ok(dead.parts[0].data.length < plain.parts[0].data.length,
      'part 1 should shrink by a track of sectors');
    assert.strictEqual(plain.parts[0].data.length - dead.parts[0].data.length, spt(1) * 326);
  });

  it('refuses a disk that is not a 35/40-track D64', () => {
    assert.ok(compressSixPack(new Uint8Array(819200).buffer, 'X').error);
  });
});

describe('sixPackToG64', () => {
  const eq = (a, b) => Buffer.from(a).equals(Buffer.from(b));

  it('round-trips through our own G64 reader', () => {
    const disk = makeDisk(35, 61);
    const g = sixPackToG64(buildSixPack(disk, 35));
    assert.ok(!g.error, g.error);
    const back = decodeG64toD64(new Uint8Array(g.buffer));
    assert.ok(eq(new Uint8Array(back.d64), disk), 'recovered disk matches');
  });

  it('round-trips a 40-track set', () => {
    const disk = makeDisk(40, 63);
    const g = sixPackToG64(buildSixPack(disk, 40));
    assert.strictEqual(g.tracks, 40);
    const back = decodeG64toD64(new Uint8Array(g.buffer));
    assert.ok(eq(new Uint8Array(back.d64).subarray(0, disk.length), disk));
  });

  it('writes a valid G64 header', () => {
    const g = sixPackToG64(buildSixPack(makeDisk(35, 3), 35));
    const b = new Uint8Array(g.buffer);
    assert.strictEqual(String.fromCharCode.apply(null, Array.from(b.subarray(0, 8))), 'GCR-1541');
    assert.strictEqual(b[8], 0, 'version');
    assert.strictEqual(b[9], 84, 'half-track count');
  });

  it('gives each density zone its nominal track length', () => {
    const g = sixPackToG64(buildSixPack(makeDisk(40, 5), 40));
    const dv = new DataView(g.buffer);
    const lenOf = t => {
      const off = dv.getUint32(12 + (t - 1) * 2 * 4, true);
      return off ? dv.getUint16(off, true) : 0;
    };
    assert.strictEqual(lenOf(1), 7692, 'track 1, density 3');
    assert.strictEqual(lenOf(20), 7142, 'track 20, density 2');
    assert.strictEqual(lenOf(27), 6666, 'track 27, density 1');
    assert.strictEqual(lenOf(35), 6250, 'track 35, density 0');
  });

  it('leaves an unreadable track out rather than faking sectors', () => {
    // Sector count 0 means the drive found no SYNC at all.
    const g = sixPackToG64(buildSixPack(makeDisk(35, 7), 35, { 5: { count: 0 } }));
    assert.strictEqual(g.deadTracks, 1);
    const dv = new DataView(g.buffer);
    assert.strictEqual(dv.getUint32(12 + (5 - 1) * 2 * 4, true), 0, 'track 5 absent');
    assert.notStrictEqual(dv.getUint32(12 + (4 - 1) * 2 * 4, true), 0, 'track 4 present');
  });

  it('passes the raw GCR through instead of re-encoding it', () => {
    const files = buildSixPack(makeDisk(35, 11), 35);
    const g = sixPackToG64(files);
    const dv = new DataView(g.buffer);
    const off = dv.getUint32(12, true);
    const track = new Uint8Array(g.buffer, off + 2, dv.getUint16(off, true));

    const desc = files[0].subarray(3, 3 + 256);
    const block0 = files[0].subarray(3 + 256, 3 + 256 + 326);

    // Sector 0: 5 sync, 10 header, 9 gap, 5 sync, 326 data, 5 gap.
    assert.ok(Array.from(track.subarray(0, 5)).every(b => b === 0xFF), 'sync');
    assert.ok(eq(track.subarray(5, 15), desc.subarray(0, 10)), 'header GCR verbatim');
    assert.ok(Array.from(track.subarray(15, 24)).every(b => b === 0x55), 'header gap');
    assert.ok(Array.from(track.subarray(24, 29)).every(b => b === 0xFF), 'second sync');
    // Stored as [last 70][first 256]; the G64 holds it in disk order.
    const want = new Uint8Array(326);
    want.set(block0.subarray(70), 0);
    want.set(block0.subarray(0, 70), 256);
    assert.ok(eq(track.subarray(29, 29 + 326), want), 'data GCR verbatim');
    assert.ok(Array.from(track.subarray(355, 360)).every(b => b === 0x55), 'tail gap');
  });

  // The whole reason this path exists: GCR that doesn't decode has no bytes to
  // put in a D64, but survives intact in a G64.
  it('preserves a sector whose GCR cannot be decoded', () => {
    const files = buildSixPack(makeDisk(35, 13), 35);
    // Zero the stored block for track 1 slot 0. $00 is not a legal GCR
    // 5-bit group, so it cannot decode.
    const blockAt = 3 + 256;
    const corrupt = new Uint8Array(326);
    files[0].set(corrupt, blockAt);

    const d = decompressSixPack(files);
    assert.ok(!d.error, d.error);
    const bad = Array.from(d.errors).filter(e => e === SIXPACK_ERR_NO_DATA).length;
    assert.strictEqual(bad, 1, 'one sector reports "no data"');
    // Its D64 sector is blank — the bytes are gone.
    const order = SIXPACK_INTERLEAVE.find(x => x.order.length === 21).order;
    const sector = order[0];
    const off = sector * 256;
    assert.ok(new Uint8Array(d.buffer).subarray(off, off + 256).every(b => b === 0),
      'D64 loses it');

    // The G64 keeps the actual bytes.
    const g = sixPackToG64(files);
    assert.ok(!g.error, g.error);
    const dv = new DataView(g.buffer);
    const toff = dv.getUint32(12, true);
    const track = new Uint8Array(g.buffer, toff + 2, dv.getUint16(toff, true));
    const p = sector * 360 + 29;
    assert.ok(Array.from(track.subarray(p, p + 326)).every(b => b === 0),
      'G64 carries the undecodable GCR verbatim');
  });

  it('omits sectors the set never stored, without disturbing the rest', () => {
    // A short count means the track holds fewer sectors than the geometry
    // allows. Those slots get no sync and no header, and every other track
    // must still decode — the count byte also sets the stride to the next
    // track, so an off-by-one here would corrupt everything after it.
    const disk = makeDisk(35, 17);
    const g = sixPackToG64(buildSixPack(disk, 35, { 1: { count: 5 } }));
    assert.ok(!g.error, g.error);
    assert.ok(g.missingSectors > 0, 'reports the gap');
    assert.strictEqual(g.deadTracks, 0, 'the track still exists');

    const back = decodeG64toD64(new Uint8Array(g.buffer));
    const got = new Uint8Array(back.d64);
    // Track 2 onward is untouched, which only holds if the walk stayed in step.
    const from = 21 * 256;
    assert.ok(Buffer.from(got.subarray(from, disk.length)).equals(
      Buffer.from(disk.subarray(from))), 'tracks 2+ recovered intact');
  });

  it('rejects the same bad input the decoder rejects', () => {
    assert.ok(sixPackToG64([]).error);
    const files = buildSixPack(makeDisk(35, 3), 35);
    files[0][0] = 0x00;
    assert.ok(sixPackToG64(files).error);
  });
});

describe('non-standard GCR survives the whole loop', () => {
  // Import a SixPack whose GCR won't decode, then write it back out. The raw
  // bytes live only in the G64 layout, so both save paths have to consult it.
  const MARK = (() => {
    const m = new Uint8Array(326);
    for (let i = 0; i < 326; i++) m[i] = (i % 2) ? 0x00 : 0x01;   // illegal GCR
    return m;
  })();
  const has = buf => {
    const b = new Uint8Array(buf);
    outer: for (let i = 0; i + 326 <= b.length; i++) {
      for (let k = 0; k < 326; k++) if (b[i + k] !== MARK[k]) continue outer;
      return true;
    }
    return false;
  };
  const build = () => {
    const files = buildSixPack(makeDisk(35, 77), 35);
    files[0].set(MARK, 3 + 256);            // track 1, storage slot 0
    return files;
  };

  it('the decoder reports it and the D64 loses it', () => {
    const d = decompressSixPack(build());
    assert.strictEqual(Array.from(d.errors).filter(e => e === SIXPACK_ERR_NO_DATA).length, 1);
  });

  it('the G64 carries it, and our reader flags the sector unreadable', () => {
    const g = sixPackToG64(build());
    assert.ok(has(g.buffer), 'G64 holds the GCR');
    const opened = decodeG64toD64(new Uint8Array(g.buffer));
    const t1 = opened.layout.find(t => t.track === 1);
    const victim = SIXPACK_INTERLEAVE.find(x => x.order.length === 21).order[0];
    assert.ok(t1.unreadableSectors.indexOf(victim) >= 0, 'sector flagged');
    // Its position must be recorded even though it never decoded, or the
    // bytes can't be lifted back out.
    assert.strictEqual(typeof t1.sectorDataStart[victim], 'number');
  });

  it('survives Save as .g64', () => {
    const opened = decodeG64toD64(new Uint8Array(sixPackToG64(build()).buffer));
    assert.ok(has(buildG64ForSave(opened.d64, opened.layout)));
  });

  it('survives re-export as SixPack, given the layout', () => {
    const opened = decodeG64toD64(new Uint8Array(sixPackToG64(build()).buffer));
    const re = compressSixPack(opened.d64, 'X', null, opened.layout);
    assert.ok(!re.error, re.error);
    assert.strictEqual(re.rawKept, 1, 'one block copied through');
    assert.ok(re.parts.some(p => has(p.data)), 'GCR present in the new set');
    // And it is still undecodable, so the flaw stays visible.
    const again = decompressSixPack(re.parts.map(p => p.data));
    assert.strictEqual(
      Array.from(again.errors).filter(e => e === SIXPACK_ERR_NO_DATA).length, 1);
  });

  it('is lost without the layout — which is why the pane passes it', () => {
    const opened = decodeG64toD64(new Uint8Array(sixPackToG64(build()).buffer));
    const re = compressSixPack(opened.d64, 'X');
    assert.ok(!re.parts.some(p => has(p.data)));
    assert.strictEqual(re.rawKept, 0);
  });
});
