// ── G64 GCR decoder + encoder ────────────────────────────────────────
// GCR 5-bit pattern → nybble; -1 marks patterns no nybble encodes to.
var GCR_DECODE = [
  -1,-1,-1,-1,-1,-1,-1,-1,-1, 8, 0, 1,-1,12, 4, 5,
  -1,-1, 2, 3,-1,15, 6, 7,-1, 9,10,11,-1,13,14,-1
];
// Nybble → 5-bit GCR pattern.
var GCR_ENCODE = [10, 11, 18, 19, 14, 15, 22, 23, 9, 25, 26, 27, 13, 29, 30, 21];

var GCR_HEADER_BYTES = 10;   // $08 header block: 8 plain bytes
var GCR_DATA_PLAIN = 260;    // $07 marker + 256 data + checksum + 2 pad
var GCR_DATA_GROUPS = 65;    // GCR_DATA_PLAIN / 4
var GCR_DATA_BYTES = 325;    // GCR_DATA_GROUPS * 5
var GCR_SYNC_SCAN = 500;     // how far past a header to look for its data sync
// Nominal bytes per revolution, indexed by speed zone (s2g.c / d64tog64.c).
var GCR_ZONE_CAPACITY = [6250, 6666, 7142, 7692];

/** 1541 speed zone for a track: 3 = outermost (tracks 1-17) .. 0 = 31+. */
function gcrSpeedZone(track) {
  if (track <= 17) return 3;
  if (track <= 24) return 2;
  if (track <= 30) return 1;
  return 0;
}

// Returns { d64: ArrayBuffer, layout: Track[] }; the layout keeps each
// track's raw GCR and physical sector order for the layout viewer and save.
function decodeG64toD64(g64) {
  var numHalfTracks = g64[9];
  var maxHalfTracks = Math.min(numHalfTracks, 84);
  var spt = DISK_FORMATS.d64.sectorsPerTrack;

  // Half-tracks have no D64 mapping; they are kept as raw GCR only, which is
  // what lets save round-trip protections that live there.
  var perHt = [];
  for (var ht = 0; ht < maxHalfTracks; ht++) {
    var trackNum = Math.floor(ht / 2) + 1;
    var isHalf = (ht & 1) === 1;
    var offTablePos = 12 + ht * 4;
    var trackOffset = g64[offTablePos] | (g64[offTablePos + 1] << 8) |
      (g64[offTablePos + 2] << 16) | (g64[offTablePos + 3] << 24);
    if (trackOffset === 0 || trackOffset >= g64.length) continue;
    var trackSize = g64[trackOffset] | (g64[trackOffset + 1] << 8);
    if (trackSize === 0 || trackOffset + 2 + trackSize > g64.length) continue;
    var trackData = g64.subarray(trackOffset + 2, trackOffset + 2 + trackSize);
    perHt.push({
      track: trackNum,
      halfTrack: isHalf,
      walk: (!isHalf && trackNum <= 42) ? walkGCRTrack(trackData, trackNum, spt(trackNum)) : null,
      expectedSpt: isHalf ? 0 : spt(trackNum),
      rawGCR: new Uint8Array(trackData)     // detached from the source buffer
    });
  }
  return _gcrBuildImage(perHt, false);
}

// Shared tail of the G64 and NIB readers: size the D64 by the highest whole
// track that yielded a sector, snapped to 35/40/42, and fill it. NIB filler
// tracks past that size are dropped from the layout (`dropBeyond`).
function _gcrBuildImage(perTrack, dropBeyond) {
  var spt = DISK_FORMATS.d64.sectorsPerTrack;
  var realTracks = 0;
  for (var i = 0; i < perTrack.length; i++) {
    var p = perTrack[i];
    if (!p.halfTrack && p.walk && p.walk.sectorOrder.length > 0) realTracks = p.track;
  }
  var numTracks = realTracks <= 35 ? 35 : realTracks <= 40 ? 40 : 42;

  var totalSectors = 0;
  for (var t = 1; t <= numTracks; t++) totalSectors += spt(t);
  var d64 = new Uint8Array(totalSectors * 256);
  var layout = [];

  for (var pi = 0; pi < perTrack.length; pi++) {
    var pt = perTrack[pi];
    var w = pt.walk;
    if (dropBeyond && pt.track > numTracks) continue;
    if (!pt.halfTrack && w && pt.track <= numTracks) {
      for (var s = 0; s < pt.expectedSpt; s++) {
        // A bad-checksum sector still lands in the D64, as a drive's buffer would.
        if (w.allPayloads[s]) d64.set(w.allPayloads[s], calcD64Offset(pt.track, s, spt));
      }
    }
    layout.push({
      track: pt.track,
      halfTrack: !!pt.halfTrack,
      sectorOrder: w ? w.sectorOrder : [],
      rawTrackBytes: pt.rawGCR.length,
      expectedSpt: pt.expectedSpt,
      unreadableSectors: w ? w.unreadable : [],
      badChecksumSectors: w ? w.badChecksum : [],
      rawGCR: pt.rawGCR,
      sectorDataStart: w ? w.sectorDataStart : {},
      // What each sector decoded to, so save re-encodes only edited sectors.
      sectorPayloads: w ? w.allPayloads : {}
    });
  }
  return { d64: d64.buffer, layout: layout };
}

// Scan one revolution of trackData for sector headers, in physical order.
// Returns { sectorOrder, sectorPayloads (checksum-good only), allPayloads
// (good + bad checksum), sectorDataStart (sector → offset of its 325 GCR
// data bytes), unreadable (no good payload), badChecksum }.
// The doubled buffer lets a header or data block straddle the track join.
function walkGCRTrack(trackData, track, expectedSpt) {
  var trackLen = trackData.length;
  var wrapped = new Uint8Array(trackLen * 2);
  wrapped.set(trackData);
  wrapped.set(trackData, trackLen);

  var sectorOrder = [];
  var sectorPayloads = {};
  var allPayloads = {};
  var sectorDataStart = {};
  var seenHeaderAt = {};
  var pos = 0;

  while (pos < trackLen) {
    if (wrapped[pos] !== 0xFF) { pos++; continue; }
    while (pos < wrapped.length && wrapped[pos] === 0xFF) pos++;
    if (pos + GCR_HEADER_BYTES > wrapped.length) break;

    var hdr = decodeGCR5(wrapped, pos);
    var hdr2 = decodeGCR5(wrapped, pos + 5);
    if (!hdr || !hdr2 || hdr[0] !== 0x08) { pos++; continue; }

    var hdrSector = hdr[2];
    // A sync spanning the join is seen at both ends of the doubled buffer.
    if (hdr[3] !== track || hdrSector >= expectedSpt || seenHeaderAt[pos % trackLen] ||
        sectorPayloads[hdrSector] !== undefined) {
      pos++;
      continue;
    }
    seenHeaderAt[pos % trackLen] = true;
    if (sectorOrder.indexOf(hdrSector) < 0) sectorOrder.push(hdrSector);

    var syncStart = -1, dataPos = -1;
    var scanEnd = Math.min(pos + GCR_HEADER_BYTES + GCR_SYNC_SCAN, wrapped.length);
    for (var sp = pos + GCR_HEADER_BYTES; sp < scanEnd; sp++) {
      if (wrapped[sp] === 0xFF) {
        syncStart = sp;
        while (sp < wrapped.length && wrapped[sp] === 0xFF) sp++;
        dataPos = sp;
        break;
      }
    }
    if (dataPos < 0) { pos += GCR_HEADER_BYTES; continue; }

    // The next sync may belong to the next header when this sector has no
    // data block; leave that header for the main loop.
    var first = decodeGCR5(wrapped, dataPos);
    if (first && first[0] === 0x08) { pos = syncStart; continue; }

    if (dataPos + GCR_DATA_BYTES <= wrapped.length) {
      // Recorded even when undecodable, so the raw block can be lifted out.
      sectorDataStart[hdrSector] = dataPos % trackLen;
      var block = _gcrDecodeDataBlock(wrapped, dataPos);
      if (block) {
        allPayloads[hdrSector] = block.data;
        if (block.ok) sectorPayloads[hdrSector] = block.data;
      }
    }
    pos = (first && first[0] === 0x07) ? dataPos + GCR_DATA_BYTES : syncStart + 1;
  }

  var unreadable = [], badChecksum = [];
  for (var s = 0; s < expectedSpt; s++) {
    if (sectorPayloads[s] !== undefined) continue;
    unreadable.push(s);
    if (allPayloads[s] !== undefined) badChecksum.push(s);
  }

  return {
    sectorOrder: sectorOrder,
    sectorPayloads: sectorPayloads,
    allPayloads: allPayloads,
    sectorDataStart: sectorDataStart,
    unreadable: unreadable,
    badChecksum: badChecksum
  };
}

// Decode a data block at `pos`. Returns { data (256 bytes), ok } where ok
// means the XOR checksum matched, or null when the block isn't a $07 block.
function _gcrDecodeDataBlock(gcr, pos) {
  var plain = new Uint8Array(GCR_DATA_PLAIN);
  var got = 0;
  for (var gi = 0; gi < GCR_DATA_GROUPS; gi++) {
    var group = decodeGCR5(gcr, pos + gi * 5);
    if (!group) break;
    plain.set(group, gi * 4);
    got += 4;
  }
  if (got === 0 || plain[0] !== 0x07) return null;

  var checksum;
  if (got >= 258) {
    checksum = plain[257];
  } else if (got === 256) {
    // Some dumpers drop the two $00 pad bytes, spoiling the last group;
    // data byte 255 and the checksum can still be read from its front.
    var tail = decodeGCR5Partial(gcr, pos + 64 * 5);
    if (tail.length < 1) return null;
    plain[256] = tail[0];
    checksum = tail.length >= 2 ? tail[1] : -1;
  } else {
    return null;
  }

  var data = plain.slice(1, 257);
  var x = 0;
  for (var i = 0; i < 256; i++) x ^= data[i];
  // An unreadable checksum can't be held against the sector.
  return { data: data, ok: checksum < 0 || x === checksum };
}

/** 4 plain bytes → 5 GCR bytes, the inverse of decodeGCR5. */
function encodeGCR4(b0, b1, b2, b3) {
  var n = [(b0 >> 4) & 15, b0 & 15, (b1 >> 4) & 15, b1 & 15,
           (b2 >> 4) & 15, b2 & 15, (b3 >> 4) & 15, b3 & 15];
  for (var k = 0; k < 8; k++) n[k] = GCR_ENCODE[n[k]];
  return [
    (n[0] << 3) | (n[1] >> 2),
    ((n[1] & 0x03) << 6) | (n[2] << 1) | (n[3] >> 4),
    ((n[3] & 0x0F) << 4) | (n[4] >> 1),
    ((n[4] & 0x01) << 7) | (n[5] << 2) | (n[6] >> 3),
    ((n[6] & 0x07) << 5) | n[7]
  ];
}

/** 260 plain bytes → the 325 GCR bytes of a data block. */
function encodeGCRDataBlock(plain) {
  var out = new Uint8Array(GCR_DATA_BYTES);
  for (var g = 0; g < GCR_DATA_GROUPS; g++) {
    out.set(encodeGCR4(plain[g * 4], plain[g * 4 + 1], plain[g * 4 + 2], plain[g * 4 + 3]), g * 5);
  }
  return out;
}

/** 256-byte payload → standard 1541 data block ($07, data, checksum, $00 $00). */
function encodeGCRSector(payload) {
  var raw = new Uint8Array(GCR_DATA_PLAIN);
  raw[0] = 0x07;
  raw.set(payload, 1);
  var checksum = 0;
  for (var i = 0; i < 256; i++) checksum ^= payload[i];
  raw[257] = checksum;
  return encodeGCRDataBlock(raw);
}

// Write an encoded payload over the data block at `dataStart`, wrapping at
// the end of the track.
function spliceGCRSector(rawGCR, dataStart, payload) {
  var encoded = encodeGCRSector(payload);
  var len = rawGCR.length;
  for (var i = 0; i < GCR_DATA_BYTES; i++) {
    rawGCR[(dataStart + i) % len] = encoded[i];
  }
}

// Emit a standard 84-half-track G64 from a layout's rawGCR. Each entry lands
// at its own half-track slot; missing ones get offset 0.
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

  // "GCR-1541", version 0, half-track count, max track size.
  out[0] = 0x47; out[1] = 0x43; out[2] = 0x52; out[3] = 0x2D;
  out[4] = 0x31; out[5] = 0x35; out[6] = 0x34; out[7] = 0x31;
  out[8] = 0;
  out[9] = numHalfTracks;
  v.setUint16(10, maxTrackSize, true);

  var htToIdx = {};
  layout.forEach(function(t, idx) {
    var ht = (t.track - 1) * 2 + (t.halfTrack ? 1 : 0);
    if (ht < numHalfTracks) htToIdx[ht] = idx;
  });

  for (var ht = 0; ht < numHalfTracks; ht++) {
    var idx = htToIdx[ht];
    var offsetVal = (idx !== undefined) ? dataStart + idx * trackEntrySize : 0;
    v.setUint32(headerSize + ht * 4, offsetVal, true);
    v.setUint32(headerSize + tableSize + ht * 4, gcrSpeedZone(Math.floor(ht / 2) + 1), true);
  }

  layout.forEach(function(t, idx) {
    var off = dataStart + idx * trackEntrySize;
    var size = t.rawGCR ? t.rawGCR.length : 0;
    v.setUint16(off, size, true);
    if (t.rawGCR && size > 0) out.set(t.rawGCR, off + 2);
  });

  return out.buffer;
}

// Build a .g64 from the D64 buffer and the layout it was opened with. Only
// sectors whose D64 bytes differ from what they decoded to are re-encoded;
// everything else — including bad-checksum and undecodable sectors — keeps
// its original GCR. Mutates the layout so later saves compare against it.
function buildG64ForSave(d64Buffer, layout) {
  var d64 = new Uint8Array(d64Buffer);
  var spt = DISK_FORMATS.d64.sectorsPerTrack;
  layout.forEach(function(t) {
    if (t.halfTrack || !t.sectorPayloads) return;
    for (var s = 0; s < t.expectedSpt; s++) {
      var orig = t.sectorPayloads[s];
      var dataPos = t.sectorDataStart && t.sectorDataStart[s];
      if (!orig || typeof dataPos !== 'number') continue;
      var d64Off = calcD64Offset(t.track, s, spt);
      if (d64Off + 256 > d64.length) continue;
      var payload = d64.subarray(d64Off, d64Off + 256);
      var same = true;
      for (var i = 0; i < 256 && same; i++) same = payload[i] === orig[i];
      if (same) continue;
      spliceGCRSector(t.rawGCR, dataPos, payload);
      t.sectorPayloads[s] = payload.slice();
      // Re-encoded with a correct checksum, so it reads cleanly now.
      t.unreadableSectors = t.unreadableSectors.filter(function(x) { return x !== s; });
      if (t.badChecksumSectors) {
        t.badChecksumSectors = t.badChecksumSectors.filter(function(x) { return x !== s; });
      }
    }
  });
  return encodeG64FromLayout(layout);
}

// ── NIB (raw nibble dump from a 1541) reader ─────────────────────────
// nibtools format: "MNIB-1541-RAW" magic, a halftrack table at $10 of
// {halftrack, density} pairs ended by a zero halftrack, then 0x2000 bytes
// of raw GCR per table entry from $100. Only whole tracks are used.
var NIB_TRACK_LENGTH = 0x2000;

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
  var DATA_OFFSET = 0x100;
  var HEADER_TABLE = 0x10;
  var spt = DISK_FORMATS.d64.sectorsPerTrack;

  var byHalftrack = {};
  for (var i = 0; i < (DATA_OFFSET - HEADER_TABLE) / 2; i++) {
    var off = HEADER_TABLE + i * 2;
    var halftrack = data[off];
    if (halftrack === 0) break;
    var trackOff = DATA_OFFSET + i * NIB_TRACK_LENGTH;
    if (trackOff + NIB_TRACK_LENGTH > data.length) continue;
    byHalftrack[halftrack] = data.subarray(trackOff, trackOff + NIB_TRACK_LENGTH);
  }

  // nibtools lists 1..42 even for a 35-track disk, so the extent comes from
  // which tracks decode (in _gcrBuildImage), not which are present.
  var perTrack = [];
  for (var track = 1; track <= 42; track++) {
    var nt = byHalftrack[track * 2];
    var raw = nt ? nibTrimToRevolution(nt) : new Uint8Array(0);
    perTrack.push({
      track: track,
      walk: raw.length ? walkGCRTrack(raw, track, spt(track)) : null,
      expectedSpt: spt(track),
      rawGCR: raw
    });
  }
  return _gcrBuildImage(perTrack, true);
}

// A nibtools capture can hold more than one revolution. Find the period by a
// sector header's next occurrence (byte-aligned, since the drive re-syncs on
// every sync mark) and return one revolution starting at that header's sync.
function nibTrimToRevolution(gcr) {
  var len = gcr.length;
  var MIN_REV = 5000;            // well under the slowest zone's capacity
  var KEY = 256;                 // header, gap and most of the data block
  var tries = 4;                 // headers to try before giving up

  for (var p = 1; p + MIN_REV + KEY <= len && tries > 0; p++) {
    if (gcr[p - 1] !== 0xFF || gcr[p] === 0xFF) continue;
    var h = decodeGCR5(gcr, p);
    if (!h || h[0] !== 0x08) continue;
    tries--;
    for (var q = p + MIN_REV; q + KEY <= len; q++) {
      var k = 0;
      while (k < KEY && gcr[p + k] === gcr[q + k]) k++;
      if (k < KEY) continue;
      var syncStart = p - 1;
      while (syncStart > 0 && gcr[syncStart - 1] === 0xFF) syncStart--;
      return new Uint8Array(gcr.subarray(syncStart, syncStart + (q - p)));
    }
  }
  // No repeat: the capture is about one revolution already.
  return new Uint8Array(gcr);
}

/** Track count of a D64 image of `len` bytes (+Errors sizes included), or 0. */
function d64TracksForSize(len) {
  var sizes = DISK_FORMATS.d64.sizes;
  for (var i = 0; i < sizes.length; i++) if (sizes[i].bytes === len) return sizes[i].tracks;
  return 0;
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

// Lenient decode of one GCR group: the leading plain bytes whose nybbles are
// valid, stopping at the first bad one (so 0-4 bytes).
function decodeGCR5Partial(gcr, pos) {
  var bits = 0, nbits = 0, nyb = [], out = [];
  for (var i = 0; i < 5 && pos + i < gcr.length; i++) {
    bits = (bits << 8) | gcr[pos + i];
    nbits += 8;
    while (nbits >= 5) {
      nbits -= 5;
      var v = GCR_DECODE[(bits >> nbits) & 0x1F];
      if (v < 0) return out;
      nyb.push(v);
      if (nyb.length % 2 === 0) out.push((nyb[nyb.length - 2] << 4) | v);
    }
    bits &= (1 << nbits) - 1;
  }
  return out;
}
