// ── G64 GCR decoder + encoder ────────────────────────────────────────
// GCR 5-bit to 4-bit decode table. Each 5-bit GCR pattern maps to a
// 4-bit nybble; entries marked -1 are illegal patterns (no nybble has
// that encoding) and should fail the decode. The standard C64/1541
// table is small enough to enumerate by encoded value:
//   01010 (10) → 0    01011 (11) → 1    10010 (18) → 2    10011 (19) → 3
//   01110 (14) → 4    01111 (15) → 5    10110 (22) → 6    10111 (23) → 7
//   01001 ( 9) → 8    11001 (25) → 9    11010 (26) → A    11011 (27) → B
//   01101 (13) → C    11101 (29) → D    11110 (30) → E    10101 (21) → F
var GCR_DECODE = [
  -1,-1,-1,-1,-1,-1,-1,-1,-1, 8, 0, 1,-1,12, 4, 5,
  -1,-1, 2, 3,-1,15, 6, 7,-1, 9,10,11,-1,13,14,-1
];
// Reverse table: nybble (0..15) → 5-bit GCR pattern, used by the
// encoder when writing modified sectors back to a .g64 on save.
var GCR_ENCODE = [10, 11, 18, 19, 14, 15, 22, 23, 9, 25, 26, 27, 13, 29, 30, 21];

// Returns { d64: ArrayBuffer, layout: Track[] } where each Track records the
// physical on-disk sector order so the G64 layout viewer can show real
// interleave (not just logical sector content). Pre-existing callers that
// only want the D64 buffer should read result.d64.
function decodeG64toD64(g64) {
  var numHalfTracks = g64[9];
  // Header-declared upper bound; real tooling almost always writes 84
  // half-tracks (i.e. 42 whole) regardless of the disk's actual extent.
  var maxTracks = Math.min(Math.floor(numHalfTracks / 2), 42);

  // Standard D64 sector counts per track
  var spt = function(t) {
    if (t <= 17) return 21;
    if (t <= 24) return 19;
    if (t <= 30) return 18;
    return 17;
  };

  // First pass: walk every populated track and capture its sector layout.
  // Most G64s declare 42 tracks even on a 35-track disk; tracks past the
  // real extent contain unformatted filler GCR (no decodable sector
  // headers). We use "track returned at least one sector" as the signal
  // for "this is a real track on the disk."
  var perTrack = [];
  for (var track = 1; track <= maxTracks; track++) {
    var halfTrackIdx = (track - 1) * 2;
    var offTablePos = 12 + halfTrackIdx * 4;
    var trackOffset = g64[offTablePos] | (g64[offTablePos + 1] << 8) |
      (g64[offTablePos + 2] << 16) | (g64[offTablePos + 3] << 24);
    var expectedSpt = spt(track);
    if (trackOffset === 0 || trackOffset >= g64.length) {
      perTrack.push({ track: track, walk: null, trackSize: 0, expectedSpt: expectedSpt });
      continue;
    }
    var trackSize = g64[trackOffset] | (g64[trackOffset + 1] << 8);
    if (trackSize === 0 || trackOffset + 2 + trackSize > g64.length) {
      perTrack.push({ track: track, walk: null, trackSize: 0, expectedSpt: expectedSpt });
      continue;
    }
    var trackData = g64.subarray(trackOffset + 2, trackOffset + 2 + trackSize);
    perTrack.push({
      track: track,
      walk: walkGCRTrack(trackData, track, expectedSpt),
      trackSize: trackSize,
      expectedSpt: expectedSpt,
      // Detached copy so the raw GCR survives after the original .g64
      // ArrayBuffer is dropped. Used by the Raw Tracks visualization.
      rawGCR: new Uint8Array(trackData)
    });
  }

  // Highest track index where the walker returned at least one sector.
  // Snap up to the nearest known D64 size class (35 / 40 / 42) so
  // detectFormat picks the right size label downstream.
  var realTracks = 0;
  for (var i = 0; i < perTrack.length; i++) {
    if (perTrack[i].walk && perTrack[i].walk.sectorOrder.length > 0) {
      realTracks = perTrack[i].track;
    }
  }
  if (realTracks === 0) realTracks = maxTracks;
  var numTracks;
  if (realTracks <= 35)      numTracks = 35;
  else if (realTracks <= 40) numTracks = 40;
  else                       numTracks = 42;

  // Allocate the D64 buffer at the right size and copy payloads in.
  var totalSectors = 0;
  for (var t = 1; t <= numTracks; t++) totalSectors += spt(t);
  var d64 = new Uint8Array(totalSectors * 256);
  var layout = [];

  for (var pi = 0; pi < perTrack.length && perTrack[pi].track <= numTracks; pi++) {
    var pt = perTrack[pi];
    var w = pt.walk;
    if (w) {
      for (var s = 0; s < pt.expectedSpt; s++) {
        var payload = w.sectorPayloads[s];
        if (payload) {
          var d64Off = calcD64Offset(pt.track, s, spt);
          for (var bi = 0; bi < 256; bi++) d64[d64Off + bi] = payload[bi];
        }
      }
    }
    layout.push({
      track: pt.track,
      sectorOrder: w ? w.sectorOrder : [],
      rawTrackBytes: pt.trackSize,
      expectedSpt: pt.expectedSpt,
      unreadableSectors: w ? w.unreadable : [],
      rawGCR: pt.rawGCR || new Uint8Array(0),
      sectorDataStart: w ? w.sectorDataStart : {}
    });
  }

  return { d64: d64.buffer, layout: layout };
}

// Single-pass GCR track scanner: walk one revolution of trackData and
// record every sector header in the order it appears, plus its 256-byte
// payload when the data block decodes cleanly. Returns:
//   { sectorOrder, sectorPayloads (sector → Uint8Array),
//     sectorDataStart (sector → byte position of data block in trackData
//                       — the start of the 325 GCR bytes after the data
//                       sync; used by the encoder when splicing modified
//                       sectors back on save), unreadable }
//
// Backed by a doubled buffer so headers/payloads that wrap past the end
// of the track decode correctly. Each sector is recorded at most once;
// duplicate headers (rare physical anomaly) are ignored after the first.
function walkGCRTrack(trackData, track, expectedSpt) {
  var trackLen = trackData.length;
  var wrapped = new Uint8Array(trackLen * 2);
  wrapped.set(trackData);
  wrapped.set(trackData, trackLen);

  var sectorOrder = [];
  var sectorPayloads = {};
  var sectorDataStart = {};
  var pos = 0;
  // One revolution — anything past the original track length would be a
  // duplicate of what we've already seen via the wrap copy.
  var stopBefore = trackLen;

  while (pos < stopBefore - 10) {
    if (wrapped[pos] !== 0xFF) { pos++; continue; }
    while (pos < wrapped.length && wrapped[pos] === 0xFF) pos++;
    if (pos >= wrapped.length - 10) break;

    var hdr = decodeGCR5(wrapped, pos);
    var hdr2 = decodeGCR5(wrapped, pos + 5);
    if (!hdr || !hdr2 || hdr[0] !== 0x08) { pos++; continue; }

    var hdrTrack = hdr[3];
    var hdrSector = hdr[2];
    if (hdrTrack !== track || hdrSector < 0 || hdrSector >= expectedSpt) {
      pos++;
      continue;
    }
    if (sectorPayloads[hdrSector] !== undefined) { pos++; continue; }

    // Find data sync after the header. The header is followed by a small
    // gap, then a $FF sync run, then the data block.
    var dataPos = pos + 10;
    var foundData = false;
    var scanEnd = Math.min(dataPos + 500, wrapped.length);
    for (var sp = dataPos; sp < scanEnd; sp++) {
      if (wrapped[sp] === 0xFF) {
        while (sp < wrapped.length && wrapped[sp] === 0xFF) sp++;
        dataPos = sp;
        foundData = true;
        break;
      }
    }

    var payload = null;
    if (foundData && dataPos + 325 <= wrapped.length) {
      var decoded = [];
      var ok = true;
      for (var gi = 0; gi < 65; gi++) {
        var group = decodeGCR5(wrapped, dataPos + gi * 5);
        if (!group) { ok = false; break; }
        decoded.push(group[0], group[1], group[2], group[3]);
      }
      if (ok && decoded.length >= 260 && decoded[0] === 0x07) {
        payload = new Uint8Array(decoded.slice(1, 257));
        // Record data block start within the original (un-doubled)
        // track buffer. dataPos is into the wrapped buffer; if it
        // exceeded trackLen we wrapped — fold back.
        sectorDataStart[hdrSector] = dataPos % trackLen;
      }
    }

    sectorOrder.push(hdrSector);
    if (payload) sectorPayloads[hdrSector] = payload;
    pos = (foundData ? dataPos + 325 : pos + 10);
  }

  var unreadable = [];
  for (var s = 0; s < expectedSpt; s++) {
    if (sectorPayloads[s] === undefined) unreadable.push(s);
  }

  return {
    sectorOrder: sectorOrder,
    sectorPayloads: sectorPayloads,
    sectorDataStart: sectorDataStart,
    unreadable: unreadable
  };
}

// Encode a 256-byte sector payload as the 325 GCR bytes that make up a
// 1541 data block: $07 marker, 256 payload bytes, XOR checksum, two
// $00 pad bytes, encoded in 65 groups of 4 → 5 GCR bytes each.
function encodeGCRSector(payload) {
  // Build the 260-byte plaintext data block.
  var raw = new Uint8Array(260);
  raw[0] = 0x07;
  raw.set(payload, 1);
  var checksum = 0;
  for (var i = 0; i < 256; i++) checksum ^= payload[i];
  raw[257] = checksum;
  raw[258] = 0;
  raw[259] = 0;

  // 65 × 4 plaintext → 65 × 5 GCR bytes
  var out = new Uint8Array(325);
  for (var g = 0; g < 65; g++) {
    var b0 = raw[g * 4];
    var b1 = raw[g * 4 + 1];
    var b2 = raw[g * 4 + 2];
    var b3 = raw[g * 4 + 3];
    var n = [
      (b0 >> 4) & 0xF, b0 & 0xF,
      (b1 >> 4) & 0xF, b1 & 0xF,
      (b2 >> 4) & 0xF, b2 & 0xF,
      (b3 >> 4) & 0xF, b3 & 0xF
    ];
    for (var k = 0; k < 8; k++) n[k] = GCR_ENCODE[n[k]];
    var o = g * 5;
    out[o]     = (n[0] << 3) | (n[1] >> 2);
    out[o + 1] = ((n[1] & 0x03) << 6) | (n[2] << 1) | (n[3] >> 4);
    out[o + 2] = ((n[3] & 0x0F) << 4) | (n[4] >> 1);
    out[o + 3] = ((n[4] & 0x01) << 7) | (n[5] << 2) | (n[6] >> 3);
    out[o + 4] = ((n[6] & 0x07) << 5) | n[7];
  }
  return out;
}

// Splice a 256-byte sector payload back into a track's raw GCR buffer
// at the position the original data block occupied. Handles wrap-around
// (when the data block straddles the track's circular boundary) by
// writing the tail bytes at the start of the track. Mutates rawGCR in
// place; caller is responsible for ensuring the layout reflects the
// sector being saved (i.e. don't call for sectors in unreadableSectors).
function spliceGCRSector(rawGCR, dataStart, payload) {
  var encoded = encodeGCRSector(payload);
  var len = rawGCR.length;
  for (var i = 0; i < 325; i++) {
    rawGCR[(dataStart + i) % len] = encoded[i];
  }
}

// Reconstruct a .g64 file (ArrayBuffer) from a layout. The layout's
// rawGCR per track is what gets written back, so the caller is expected
// to have already spliced any modified sectors into rawGCR.
//
// We always emit a standard 84-half-track G64 with whole-track data
// only — half-track entries get offset 0. The speed table follows the
// 1541 zone convention: tracks 1-17 zone 3, 18-24 zone 2, 25-30 zone 1,
// 31-42 zone 0. Track data is laid out consecutively after the offset
// + speed tables, each track preceded by its 2-byte LE size.
function encodeG64FromLayout(layout) {
  var numHalfTracks = 84; // standard for VICE / DirMaster output
  var maxTrackSize = 0;
  layout.forEach(function(t) {
    if (t.rawGCR && t.rawGCR.length > maxTrackSize) maxTrackSize = t.rawGCR.length;
  });
  if (maxTrackSize === 0) maxTrackSize = 7928; // 1541 outer-zone capacity

  var headerSize = 12;
  var tableSize = numHalfTracks * 4;
  var dataStart = headerSize + tableSize * 2; // offset + speed tables
  var trackEntrySize = 2 + maxTrackSize;

  var totalSize = dataStart + layout.length * trackEntrySize;
  var out = new Uint8Array(totalSize);
  var v = new DataView(out.buffer);

  // GCR-1541 magic + version + track count + max track size.
  out[0] = 0x47; out[1] = 0x43; out[2] = 0x52; out[3] = 0x2D;
  out[4] = 0x31; out[5] = 0x35; out[6] = 0x34; out[7] = 0x31;
  out[8] = 0;
  out[9] = numHalfTracks;
  v.setUint16(10, maxTrackSize, true);

  function speedFor(trackNum) {
    if (trackNum <= 17) return 3;
    if (trackNum <= 24) return 2;
    if (trackNum <= 30) return 1;
    return 0;
  }

  // Offset table + speed table. Whole tracks within layout get a real
  // offset; half-tracks (and tracks past layout.length) get offset 0.
  for (var ht = 0; ht < numHalfTracks; ht++) {
    var trackNum = Math.floor(ht / 2) + 1;
    var isWhole = (ht % 2) === 0;
    var offsetVal = 0;
    if (isWhole && trackNum <= layout.length) {
      offsetVal = dataStart + (trackNum - 1) * trackEntrySize;
    }
    v.setUint32(headerSize + ht * 4, offsetVal, true);
    v.setUint32(headerSize + tableSize + ht * 4, speedFor(trackNum), true);
  }

  // Track data: 2-byte size + rawGCR padded to maxTrackSize.
  layout.forEach(function(t, idx) {
    var off = dataStart + idx * trackEntrySize;
    var size = t.rawGCR ? t.rawGCR.length : 0;
    v.setUint16(off, size, true);
    if (t.rawGCR && size > 0) {
      out.set(t.rawGCR, off + 2);
    }
  });

  return out.buffer;
}

// Build a fresh .g64 ArrayBuffer that captures the current contents of
// the in-memory D64 buffer for every readable sector. Sectors flagged
// unreadable on open are left as the original raw GCR (preserves the
// custom encoding copy-protection schemes rely on). Mutates the layout
// in place — modified sectors get their rawGCR rewritten before the
// container is emitted, so subsequent saves see the new state.
function buildG64ForSave(d64Buffer, layout) {
  var d64 = new Uint8Array(d64Buffer);
  layout.forEach(function(t) {
    var spt = t.expectedSpt;
    var unreadSet = {};
    t.unreadableSectors.forEach(function(s) { unreadSet[s] = true; });
    for (var s = 0; s < spt; s++) {
      if (unreadSet[s]) continue;
      var dataPos = t.sectorDataStart && t.sectorDataStart[s];
      if (typeof dataPos !== 'number') continue;
      var d64Off = _g64SectorOffset(t.track, s);
      if (d64Off + 256 > d64.length) continue;
      var payload = d64.subarray(d64Off, d64Off + 256);
      spliceGCRSector(t.rawGCR, dataPos, payload);
    }
  });
  return encodeG64FromLayout(layout);
}

// Same sector-offset math as decodeG64toD64 — kept private to this file
// because cbm-format.js's sectorOffset() depends on currentFormat being
// set to a 1541 D64, which is true here but not worth coupling to.
function _g64SectorOffset(track, sector) {
  var spt = function(t) {
    if (t <= 17) return 21;
    if (t <= 24) return 19;
    if (t <= 30) return 18;
    return 17;
  };
  var off = 0;
  for (var t = 1; t < track; t++) off += spt(t) * 256;
  return off + sector * 256;
}

// ── NIB (raw nibble dump from a 1541) reader ─────────────────────────
// Reads files produced by nibtools (markusC64/nibtools): "MNIB-1541-RAW"
// magic, a halftrack table at byte 0x10 (pairs of {halftrack, density}
// terminated by a zero halftrack), then NIB_TRACK_LENGTH (0x2000) bytes
// of raw GCR per declared track at offset 0x100. We only support whole
// tracks — the half-track entries (odd halftrack values) are ignored,
// since G64 (our internal representation) is whole-track-only too.
//
// Returns { d64, layout } in the same shape as decodeG64toD64 so the
// rest of the editor (sector views, layout modal, save-as-G64) doesn't
// need to know about NIB at all once the buffer has been parsed.
function isNibBuffer(data) {
  if (data.length < 16) return false;
  // ASCII for "MNIB-1541-RAW"
  return data[0] === 0x4D && data[1] === 0x4E && data[2] === 0x49 &&
         data[3] === 0x42 && data[4] === 0x2D && data[5] === 0x31 &&
         data[6] === 0x35 && data[7] === 0x34 && data[8] === 0x31 &&
         data[9] === 0x2D && data[10] === 0x52 && data[11] === 0x41 &&
         data[12] === 0x57;
}

function parseNibFile(data) {
  var NIB_TRACK_LENGTH = 0x2000;   // 8192 bytes per track in the .nib payload
  var DATA_OFFSET = 0x100;          // raw track data starts here
  var HEADER_TABLE = 0x10;          // halftrack table starts here

  // Walk the halftrack table: 2-byte entries (halftrack, density+flags)
  // until a zero halftrack terminates. Each entry's index in the table
  // tells us where its track data lives in the payload.
  var entries = [];
  for (var i = 0; i < (DATA_OFFSET - HEADER_TABLE) / 2; i++) {
    var off = HEADER_TABLE + i * 2;
    var halftrack = data[off];
    if (halftrack === 0) break;
    entries.push({ halftrack: halftrack, density: data[off + 1] & 0x03, tIndex: i });
  }

  // Index by halftrack so whole tracks (halftrack = track*2) are easy
  // to look up. Half-tracks (odd halftrack values) are present in the
  // file when the original disk used them, but we currently can't
  // represent them — they get dropped on the way into our G64 layout.
  var byHalftrack = {};
  entries.forEach(function(e) {
    var trackOff = DATA_OFFSET + e.tIndex * NIB_TRACK_LENGTH;
    if (trackOff + NIB_TRACK_LENGTH > data.length) return;
    byHalftrack[e.halftrack] = data.subarray(trackOff, trackOff + NIB_TRACK_LENGTH);
  });

  // 1541 sectors-per-track for each zone.
  var sptFn = function(t) {
    if (t <= 17) return 21;
    if (t <= 24) return 19;
    if (t <= 30) return 18;
    return 17;
  };

  // First pass: walk every populated whole track once. nibtools tends
  // to emit halftrack entries for the full 1..42 range even on a real
  // 35-track disk (extra entries are unformatted filler), so we can't
  // trust "track has GCR" as the disk-extent signal. We need "track
  // had at least one sector decode" — same approach as decodeG64toD64.
  var perTrack = [];
  for (var track = 1; track <= 42; track++) {
    var trackData = byHalftrack[track * 2];
    var expectedSpt = sptFn(track);
    perTrack.push({
      track: track,
      walk: trackData ? walkGCRTrack(trackData, track, expectedSpt) : null,
      trackData: trackData || null,
      expectedSpt: expectedSpt
    });
  }

  var realTracks = 0;
  for (var ri = 0; ri < perTrack.length; ri++) {
    if (perTrack[ri].walk && perTrack[ri].walk.sectorOrder.length > 0) {
      realTracks = perTrack[ri].track;
    }
  }
  if (realTracks === 0) realTracks = 35;
  var numTracks;
  if (realTracks <= 35)      numTracks = 35;
  else if (realTracks <= 40) numTracks = 40;
  else                       numTracks = 42;

  var totalSectors = 0;
  for (var t = 1; t <= numTracks; t++) totalSectors += sptFn(t);
  var d64 = new Uint8Array(totalSectors * 256);
  var layout = [];

  for (var pi = 0; pi < perTrack.length && perTrack[pi].track <= numTracks; pi++) {
    var pt = perTrack[pi];
    var w = pt.walk;
    if (w) {
      for (var s = 0; s < pt.expectedSpt; s++) {
        var payload = w.sectorPayloads[s];
        if (payload) {
          var d64Off = calcD64Offset(pt.track, s, sptFn);
          for (var bi = 0; bi < 256; bi++) d64[d64Off + bi] = payload[bi];
        }
      }
    }
    layout.push({
      track: pt.track,
      sectorOrder: w ? w.sectorOrder : [],
      rawTrackBytes: pt.trackData ? pt.trackData.length : 0,
      expectedSpt: pt.expectedSpt,
      unreadableSectors: w ? w.unreadable : [],
      // Detached copy so the NIB ArrayBuffer can be discarded after
      // open. Same lifecycle as the rawGCR captured by decodeG64toD64.
      rawGCR: pt.trackData ? new Uint8Array(pt.trackData) : new Uint8Array(0),
      sectorDataStart: w ? w.sectorDataStart : {}
    });
  }

  return { d64: d64.buffer, layout: layout };
}

function calcD64Offset(track, sector, sptFn) {
  var off = 0;
  for (var t = 1; t < track; t++) off += sptFn(t) * 256;
  return off + sector * 256;
}

// Decode 5 GCR bytes into 4 data bytes
function decodeGCR5(gcr, pos) {
  if (pos + 4 >= gcr.length) return null;
  var b0 = gcr[pos], b1 = gcr[pos + 1], b2 = gcr[pos + 2], b3 = gcr[pos + 3], b4 = gcr[pos + 4];

  var n0 = GCR_DECODE[b0 >> 3];
  var n1 = GCR_DECODE[((b0 & 7) << 2) | (b1 >> 6)];
  var n2 = GCR_DECODE[(b1 >> 1) & 0x1F];
  var n3 = GCR_DECODE[((b1 & 1) << 4) | (b2 >> 4)];
  var n4 = GCR_DECODE[((b2 & 0xF) << 1) | (b3 >> 7)];
  var n5 = GCR_DECODE[(b3 >> 2) & 0x1F];
  var n6 = GCR_DECODE[((b3 & 3) << 3) | (b4 >> 5)];
  var n7 = GCR_DECODE[b4 & 0x1F];

  if (n0 < 0 || n1 < 0 || n2 < 0 || n3 < 0 || n4 < 0 || n5 < 0 || n6 < 0 || n7 < 0) return null;

  return [(n0 << 4) | n1, (n2 << 4) | n3, (n4 << 4) | n5, (n6 << 4) | n7];
}

