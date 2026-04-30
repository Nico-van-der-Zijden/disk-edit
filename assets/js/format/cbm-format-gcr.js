// ── G64 GCR decoder ──────────────────────────────────────────────────
// GCR 5-bit to 4-bit decode table
var GCR_DECODE = [
  -1,-1,-1,-1,-1,-1,-1,-1,-1, 8,-1, 1,-1,12, 4, 5,
  -1,-1, 2, 3,-1,15, 6, 7,-1, 9,10,11,-1,13,14,-1
];

function decodeG64toD64(g64) {
  var numHalfTracks = g64[9];
  var numTracks = Math.min(Math.floor(numHalfTracks / 2), 42);

  // Standard D64 sector counts per track
  var spt = function(t) {
    if (t <= 17) return 21;
    if (t <= 24) return 19;
    if (t <= 30) return 18;
    return 17;
  };

  // Calculate D64 size
  var totalSectors = 0;
  for (var t = 1; t <= numTracks; t++) totalSectors += spt(t);
  var d64 = new Uint8Array(totalSectors * 256);

  // Read track offset table (starts at byte 12, 4 bytes per half-track)
  for (var track = 1; track <= numTracks; track++) {
    var halfTrackIdx = (track - 1) * 2; // whole tracks only
    var offTablePos = 12 + halfTrackIdx * 4;
    var trackOffset = g64[offTablePos] | (g64[offTablePos + 1] << 8) |
      (g64[offTablePos + 2] << 16) | (g64[offTablePos + 3] << 24);
    if (trackOffset === 0 || trackOffset >= g64.length) continue;

    var trackSize = g64[trackOffset] | (g64[trackOffset + 1] << 8);
    if (trackSize === 0 || trackOffset + 2 + trackSize > g64.length) continue;
    var trackData = g64.subarray(trackOffset + 2, trackOffset + 2 + trackSize);

    // Extract sectors from GCR track data
    var sectors = spt(track);
    for (var sec = 0; sec < sectors; sec++) {
      var sectorData = extractGCRSector(trackData, trackSize, track, sec);
      if (sectorData) {
        var d64Off = calcD64Offset(track, sec, spt);
        for (var bi = 0; bi < 256; bi++) d64[d64Off + bi] = sectorData[bi];
      }
    }
  }

  return d64.buffer;
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

function extractGCRSector(trackData, trackSize, track, sector) {
  // Scan for sync marks and sector headers
  var len = trackSize;

  for (var pos = 0; pos < len - 10; pos++) {
    // Find sync: consecutive $FF bytes
    if (trackData[pos] !== 0xFF) continue;
    while (pos < len && trackData[pos] === 0xFF) pos++;
    if (pos >= len - 10) break;

    // Decode header (10 GCR bytes = 8 data bytes)
    var hdr = decodeGCR5(trackData, pos);
    if (!hdr) continue;
    var hdr2 = decodeGCR5(trackData, pos + 5);
    if (!hdr2) continue;

    // Header: byte 0 = $08 (header ID), byte 2 = sector, byte 3 = track
    if (hdr[0] !== 0x08) continue;
    if (hdr[2] !== sector || hdr[3] !== track) continue;

    // Found matching header — now find data sync
    var dataPos = pos + 10;
    var found = false;
    for (var sp = dataPos; sp < Math.min(dataPos + 500, len); sp++) {
      if (trackData[sp] === 0xFF) {
        while (sp < len && trackData[sp] === 0xFF) sp++;
        dataPos = sp;
        found = true;
        break;
      }
    }
    if (!found || dataPos + 325 > len) {
      // Try wrapping around track
      continue;
    }

    // Decode data block (325 GCR bytes = 260 data bytes)
    var decoded = [];
    var ok = true;
    for (var gi = 0; gi < 65; gi++) {
      var group = decodeGCR5(trackData, dataPos + gi * 5);
      if (!group) { ok = false; break; }
      decoded.push(group[0], group[1], group[2], group[3]);
    }
    if (!ok || decoded.length < 260) continue;

    // Data block: byte 0 = $07, bytes 1-256 = sector data
    if (decoded[0] !== 0x07) continue;

    return new Uint8Array(decoded.slice(1, 257));
  }

  // Sector not found — try wrapping (track is circular)
  // Create wrapped copy and try again
  if (trackSize > 0) {
    var wrapped = new Uint8Array(trackSize * 2);
    wrapped.set(trackData);
    wrapped.set(trackData, trackSize);
    for (var pos2 = trackSize - 20; pos2 < trackSize + 10; pos2++) {
      if (wrapped[pos2] !== 0xFF) continue;
      while (pos2 < wrapped.length && wrapped[pos2] === 0xFF) pos2++;
      if (pos2 >= wrapped.length - 10) break;

      var hdr3 = decodeGCR5(wrapped, pos2);
      if (!hdr3) continue;
      if (hdr3[0] !== 0x08) continue;
      var hdr4 = decodeGCR5(wrapped, pos2 + 5);
      if (!hdr4) continue;
      if (hdr3[2] !== sector || hdr3[3] !== track) continue;

      var dp2 = pos2 + 10;
      for (var sp2 = dp2; sp2 < Math.min(dp2 + 500, wrapped.length); sp2++) {
        if (wrapped[sp2] === 0xFF) {
          while (sp2 < wrapped.length && wrapped[sp2] === 0xFF) sp2++;
          dp2 = sp2;
          break;
        }
      }
      if (dp2 + 325 > wrapped.length) continue;

      var dec2 = [];
      var ok2 = true;
      for (var gi2 = 0; gi2 < 65; gi2++) {
        var grp = decodeGCR5(wrapped, dp2 + gi2 * 5);
        if (!grp) { ok2 = false; break; }
        dec2.push(grp[0], grp[1], grp[2], grp[3]);
      }
      if (!ok2 || dec2.length < 260 || dec2[0] !== 0x07) continue;
      return new Uint8Array(dec2.slice(1, 257));
    }
  }

  return null; // sector not found
}
