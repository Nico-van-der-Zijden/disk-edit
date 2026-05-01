// ── G64 GCR decoder ──────────────────────────────────────────────────
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
      rawGCR: pt.rawGCR || new Uint8Array(0)
    });
  }

  return { d64: d64.buffer, layout: layout };
}

// Single-pass GCR track scanner: walk one revolution of trackData and
// record every sector header in the order it appears, plus its 256-byte
// payload when the data block decodes cleanly. Returns:
//   { sectorOrder, sectorPayloads (sector → Uint8Array), unreadable }
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

  return { sectorOrder: sectorOrder, sectorPayloads: sectorPayloads, unreadable: unreadable };
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

