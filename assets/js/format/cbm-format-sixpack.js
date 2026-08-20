// ── SixPack ZipCode (6-file: 1!!NAME .. 6!!NAME) ─────────────────────
// Spec: disks/FORMATS/ZIP_SIX.TXT rev 1.4. Unlike DiskPacked this stores
// raw GCR with no compression, which is how it carries error-protected
// disks. Per file: signature $FF $03 + $24 (35 tracks) or $29 (40), then
// per track a 256-byte descriptor (21 GCR sector headers, sector count at
// $FF, $00 = whole track unreadable) followed by sectors of 326 GCR bytes.

var SIXPACK_RANGES_35 = [[1, 6], [7, 12], [13, 18], [19, 25], [26, 32], [33, 35]];
var SIXPACK_RANGES_40 = [[1, 6], [7, 12], [13, 18], [19, 25], [26, 32], [33, 40]];

var SIXPACK_INTERLEAVE = [
  { upTo: 17, order: [0, 8, 16, 3, 11, 19, 6, 14, 1, 9, 17, 4, 12, 20, 7, 15, 2, 10, 18, 5, 13] },
  { upTo: 24, order: [0, 8, 16, 5, 13, 2, 10, 18, 7, 15, 4, 12, 1, 9, 17, 6, 14, 3, 11] },
  { upTo: 30, order: [0, 8, 16, 6, 14, 4, 12, 2, 10, 1, 9, 17, 7, 15, 5, 13, 3, 11] },
  { upTo: 40, order: [0, 8, 16, 7, 15, 6, 14, 5, 13, 4, 12, 3, 11, 2, 10, 1, 9] },
];

var SIXPACK_SECTOR_GCR = 326;      // stored size of one GCR sector block
var SIXPACK_DESCRIPTOR = 256;

// CBM DOS error codes this format can express (ZIP_SIX.TXT "error codes").
var SIXPACK_ERR_OK = 1;
var SIXPACK_ERR_NO_SYNC = 21;      // whole track unreadable
var SIXPACK_ERR_NO_HEADER = 20;    // header descriptor $08 missing
var SIXPACK_ERR_HEADER_CSUM = 27;
var SIXPACK_ERR_ID_MISMATCH = 29;
var SIXPACK_ERR_NO_DATA = 22;      // data descriptor $07 missing
var SIXPACK_ERR_DATA_CSUM = 23;

/** @param {number} track @returns {number[]} interleave order for that track */
function _sixpackInterleave(track) {
  for (var i = 0; i < SIXPACK_INTERLEAVE.length; i++) {
    if (track <= SIXPACK_INTERLEAVE[i].upTo) return SIXPACK_INTERLEAVE[i].order;
  }
  return SIXPACK_INTERLEAVE[SIXPACK_INTERLEAVE.length - 1].order;
}

// Mirrors findZipCodeSets; a set needs all six of 1!!..6!!.
function findSixPackSets(items) {
  var sets = {};
  for (var i = 0; i < items.length; i++) {
    var name = (items[i].name || '').trim();
    if (name.length < 4) continue;                    // "N!!" + at least one char
    var digit = name.charAt(0);
    if (name.charAt(1) !== '!' || name.charAt(2) !== '!') continue;
    if (digit < '1' || digit > '6') continue;
    var base = name.substring(3);
    if (!sets[base]) sets[base] = {};
    if (!(digit in sets[base])) sets[base][digit] = items[i].ref;
  }

  var complete = [], partial = [];
  Object.keys(sets).forEach(function(base) {
    var got = sets[base];
    var all = true;
    for (var d = 1; d <= 6; d++) if (!(String(d) in got)) all = false;
    if (all) {
      complete.push({
        name: base,
        refs: ['1', '2', '3', '4', '5', '6'].map(function(d) { return got[d]; }),
      });
    } else {
      partial.push({ name: base, found: Object.keys(got).sort() });
    }
  });
  return { complete: complete, partial: partial };
}

// Decode one 326-byte stored block into { data(256), err }.
function _sixpackDecodeSector(block) {
  // Undo the overflow-buffer ordering: stored = [last 70][first 256].
  var gcr = new Uint8Array(SIXPACK_SECTOR_GCR);
  gcr.set(block.subarray(70, SIXPACK_SECTOR_GCR), 0);
  gcr.set(block.subarray(0, 70), SIXPACK_SECTOR_GCR - 70);

  // 325 bytes decode cleanly (65 groups of 5 -> 260 bytes); the 326th is
  // padding the format never uses.
  var out = new Uint8Array(260);
  var o = 0;
  for (var p = 0; p + 4 < 325; p += 5) {
    var q = decodeGCR5(gcr, p);
    if (!q) return { err: SIXPACK_ERR_NO_DATA };
    out[o++] = q[0]; out[o++] = q[1]; out[o++] = q[2]; out[o++] = q[3];
  }

  if (out[0] !== 0x07) return { err: SIXPACK_ERR_NO_DATA };
  var data = out.subarray(1, 257);
  var csum = 0;
  for (var i = 0; i < 256; i++) csum ^= data[i];
  if (csum !== out[257]) return { data: data, err: SIXPACK_ERR_DATA_CSUM };
  return { data: data, err: SIXPACK_ERR_OK };
}

// Decode the 10-byte GCR sector header at group `idx` of a descriptor.
function _sixpackDecodeHeader(desc, idx) {
  var off = idx * 10;
  var a = decodeGCR5(desc, off);
  var b = decodeGCR5(desc, off + 5);
  if (!a || !b) return null;
  return {
    sig: a[0], chk: a[1], sector: a[2], track: a[3], id2: b[0], id1: b[1],
  };
}

// Walk the file holding track 18 and decode its first sector header, which
// carries the disk ID every other track is checked against.
function _sixpackMasterId(files, ranges, spt) {
  for (var fi = 0; fi < ranges.length; fi++) {
    if (18 < ranges[fi][0] || 18 > ranges[fi][1]) continue;
    var data = files[fi];
    var pos = 3;
    for (var t = ranges[fi][0]; t <= ranges[fi][1]; t++) {
      if (pos + SIXPACK_DESCRIPTOR > data.length) return null;
      var desc = data.subarray(pos, pos + SIXPACK_DESCRIPTOR);
      var count = desc[0xFF];
      if (t === 18) {
        if (count === 0) return null;
        var h = _sixpackDecodeHeader(desc, 0);
        return h ? { id1: h.id1, id2: h.id2 } : null;
      }
      pos += SIXPACK_DESCRIPTOR + Math.min(count, spt(t)) * SIXPACK_SECTOR_GCR;
    }
  }
  return null;
}

// `files` is six Uint8Arrays in 1!!..6!! order. Returns { buffer, tracks,
// errors, errorCount, missing } or { error }; `errors` is one CBM error
// code per sector (1 = OK), for writing a "+Errors" D64.
// Validate the six parts and read the track count. Shared by the D64 and G64
// paths so they can't disagree on what a valid set looks like.
function _sixpackHeader(files) {
  if (!files || files.length !== 6) {
    return { error: 'A SixPack set needs all six files (1!! through 6!!).' };
  }
  for (var f = 0; f < 6; f++) {
    if (!files[f] || files[f].length < 4) {
      return { error: (f + 1) + '!! is too small to be a SixPack file.' };
    }
    if (files[f][0] !== 0xFF || files[f][1] !== 0x03) {
      return { error: (f + 1) + '!! does not start with the SixPack signature $FF $03.' };
    }
  }
  var sizeByte = files[0][2];
  if (sizeByte === 0x24) return { tracks: 35 };
  if (sizeByte === 0x29) return { tracks: 40 };
  return { error: '1!! has track-count byte $' + hex8(sizeByte) + ' (expected $24 or $29).' };
}

function decompressSixPack(files) {
  var head = _sixpackHeader(files);
  if (head.error) return { error: head.error };
  var tracks = head.tracks;

  var spt = DISK_FORMATS.d64.sectorsPerTrack;
  var ranges = tracks === 40 ? SIXPACK_RANGES_40 : SIXPACK_RANGES_35;

  var totalSectors = 0;
  for (var t = 1; t <= tracks; t++) totalSectors += spt(t);
  var d64 = new Uint8Array(totalSectors * 256);
  var errors = new Uint8Array(totalSectors).fill(SIXPACK_ERR_OK);
  var seen = new Uint8Array(totalSectors);

  // The master ID lives on track 18, which sits in the third file — so find
  // it before decoding. Discovering it mid-stream would leave tracks 1-17
  // unable to report a mismatch, since they are decoded first.
  var master = _sixpackMasterId(files, ranges, spt);
  var masterId1 = master ? master.id1 : -1;
  var masterId2 = master ? master.id2 : -1;

  for (var fi = 0; fi < 6; fi++) {
    var data = files[fi];
    var pos = 3;                                   // past the signature
    var lo = ranges[fi][0], hi = ranges[fi][1];

    for (var track = lo; track <= hi; track++) {
      if (pos + SIXPACK_DESCRIPTOR > data.length) {
        return { error: (fi + 1) + '!! ends before the descriptor for track ' + track + '.' };
      }
      var desc = data.subarray(pos, pos + SIXPACK_DESCRIPTOR);
      pos += SIXPACK_DESCRIPTOR;

      var count = desc[0xFF];
      var trackSectors = spt(track);

      if (count === 0) {
        // Unreadable track: no sector data stored, whole track is error 21.
        for (var s0 = 0; s0 < trackSectors; s0++) {
          errors[_sixpackSectorIndex(track, s0, spt)] = SIXPACK_ERR_NO_SYNC;
        }
        continue;
      }
      if (count > trackSectors) count = trackSectors;   // ignore stale groups

      // Data blocks are stored by header-group position, not sector number.
      var headers = [];
      for (var g = 0; g < count; g++) headers.push(_sixpackDecodeHeader(desc, g));

      var order = _sixpackInterleave(track);
      for (var k = 0; k < count; k++) {
        if (pos + SIXPACK_SECTOR_GCR > data.length) {
          return { error: (fi + 1) + '!! ends mid-sector on track ' + track + '.' };
        }
        var block = data.subarray(pos, pos + SIXPACK_SECTOR_GCR);
        pos += SIXPACK_SECTOR_GCR;

        var group = order[k];
        if (group >= count) continue;               // interleave slot unused here
        var h = headers[group];
        if (!h) continue;

        var sector = h.sector;
        if (h.track !== track || sector >= trackSectors) continue;   // bogus header

        var idx = _sixpackSectorIndex(track, sector, spt);
        var err = SIXPACK_ERR_OK;
        if (h.sig !== 0x08) err = SIXPACK_ERR_NO_HEADER;
        else if ((h.sector ^ h.track ^ h.id2 ^ h.id1) !== h.chk) err = SIXPACK_ERR_HEADER_CSUM;
        else if (masterId1 >= 0 && (h.id1 !== masterId1 || h.id2 !== masterId2)) {
          err = SIXPACK_ERR_ID_MISMATCH;
        }

        var dec = _sixpackDecodeSector(block);
        if (dec.data) d64.set(dec.data, idx * 256);
        // A data-side error outranks a header-side one.
        if (dec.err !== SIXPACK_ERR_OK) err = dec.err;
        errors[idx] = err;
        seen[idx] = 1;
      }
    }
  }

  var missing = 0, errorCount = 0;
  for (var i = 0; i < totalSectors; i++) {
    if (!seen[i] && errors[i] === SIXPACK_ERR_OK) missing++;
    if (errors[i] !== SIXPACK_ERR_OK) errorCount++;
  }

  return {
    buffer: d64.buffer, tracks: tracks, errors: errors,
    errorCount: errorCount, missing: missing,
  };
}

/** Linear sector index (also the offset/256 into a D64). */
function _sixpackSectorIndex(track, sector, spt) {
  var n = 0;
  for (var t = 1; t < track; t++) n += spt(t);
  return n + sector;
}

// Build the image to hand to the editor: a plain D64 when the set is clean,
// or a D64 with the error-byte table appended when it isn't (174848+683 /
// 196608+768), which is how CBM tools carry per-sector error codes.
function sixPackToImage(res) {
  if (!res || !res.buffer) return null;
  if (res.errorCount === 0) return res.buffer;
  var d64 = new Uint8Array(res.buffer);
  var out = new Uint8Array(d64.length + res.errors.length);
  out.set(d64, 0);
  out.set(res.errors, d64.length);
  return out.buffer;
}

// ── Encoding ─────────────────────────────────────────────────────────

// 4 plain bytes -> 5 GCR bytes, the inverse of decodeGCR5.
function _sixpackEnc4(b0, b1, b2, b3) {
  var n = [(b0 >> 4) & 15, b0 & 15, (b1 >> 4) & 15, b1 & 15,
           (b2 >> 4) & 15, b2 & 15, (b3 >> 4) & 15, b3 & 15];
  for (var i = 0; i < 8; i++) n[i] = GCR_ENCODE[n[i]];
  return [
    (n[0] << 3) | (n[1] >> 2),
    ((n[1] & 3) << 6) | (n[2] << 1) | (n[3] >> 4),
    ((n[3] & 15) << 4) | (n[4] >> 1),
    ((n[4] & 1) << 7) | (n[5] << 2) | (n[6] >> 3),
    ((n[6] & 7) << 5) | n[7],
  ];
}

// Build the 326 stored bytes for one sector. Because we control the GCR, the
// data-side error codes are expressible: 22 by spoiling the $07 marker, 23 by
// writing a checksum that doesn't match.
function _sixpackEncodeSector(payload, err) {
  var raw = new Uint8Array(260);
  raw[0] = err === SIXPACK_ERR_NO_DATA ? 0x00 : 0x07;
  raw.set(payload, 1);
  var csum = 0;
  for (var i = 0; i < 256; i++) csum ^= payload[i];
  raw[257] = err === SIXPACK_ERR_DATA_CSUM ? (csum ^ 0xFF) : csum;

  var gcr = new Uint8Array(SIXPACK_SECTOR_GCR);
  for (var g = 0; g < 65; g++) {
    var q = _sixpackEnc4(raw[g * 4], raw[g * 4 + 1], raw[g * 4 + 2], raw[g * 4 + 3]);
    for (var k = 0; k < 5; k++) gcr[g * 5 + k] = q[k];
  }
  gcr[325] = 0x55;                       // the byte the reader drops

  // Stored form: final 70 GCR bytes first, then the leading 256.
  var out = new Uint8Array(SIXPACK_SECTOR_GCR);
  out.set(gcr.subarray(256, SIXPACK_SECTOR_GCR), 0);
  out.set(gcr.subarray(0, 256), 70);
  return out;
}

// Read `n` bytes from a raw GCR track, wrapping at the end — a track is a
// closed loop, so a sector's data block can straddle the join.
function _sixpackReadCircular(raw, pos, n) {
  var out = new Uint8Array(n);
  for (var i = 0; i < n; i++) out[i] = raw[(pos + i) % raw.length];
  return out;
}

// Natural GCR order -> SixPack's stored order: [last 70][first 256].
function _sixpackStoreOrder(natural) {
  var out = new Uint8Array(SIXPACK_SECTOR_GCR);
  out.set(natural.subarray(256, SIXPACK_SECTOR_GCR), 0);
  out.set(natural.subarray(0, 256), 70);
  return out;
}

// Index a G64/NIB layout by whole track, so the encoder can pull original GCR
// back out for sectors that never decoded.
function _sixpackLayoutByTrack(layout) {
  if (!layout || !layout.length) return null;
  var byTrack = {};
  for (var i = 0; i < layout.length; i++) {
    if (!layout[i].halfTrack) byTrack[layout[i].track] = layout[i];
  }
  return byTrack;
}

// Encode a D64 into SixPack parts. `errors` is an optional per-sector CBM
// error table (as decompressSixPack returns); every code it can express is
// written back, so a set round-trips its errors.
// Returns { parts, tracks } or { error }.
function compressSixPack(buffer, baseName, errors, layout) {
  var all = new Uint8Array(buffer);
  var tracks = 0;
  if (all.length === 174848 || all.length === 175531) tracks = 35;
  else if (all.length === 196608 || all.length === 197376) tracks = 40;
  else return { error: 'SixPack needs a 35- or 40-track D64.' };

  // A +Errors image carries its table after the sector data.
  var spt = DISK_FORMATS.d64.sectorsPerTrack;
  var totalSectors = 0;
  for (var t0 = 1; t0 <= tracks; t0++) totalSectors += spt(t0);
  if (!errors && all.length > totalSectors * 256) {
    errors = all.subarray(totalSectors * 256, totalSectors * 256 + totalSectors);
  }

  var base = String(baseName || 'DISK').trim().toUpperCase().slice(0, 13);
  if (!base) return { error: 'Give the set a name.' };

  var hdr = calcD64Offset(18, 0, spt);
  var id1 = all[hdr + 0xA2], id2 = all[hdr + 0xA3];
  var ranges = tracks === 40 ? SIXPACK_RANGES_40 : SIXPACK_RANGES_35;
  var errAt = function(track, sector) {
    return errors ? (errors[_sixpackSectorIndex(track, sector, spt)] || SIXPACK_ERR_OK) : SIXPACK_ERR_OK;
  };

  // A tab opened from a G64 or NIB still holds the raw GCR. Use it: a sector
  // whose GCR never decoded has no bytes in the D64, so re-encoding from the
  // D64 alone would quietly replace it with zeros.
  var byTrack = _sixpackLayoutByTrack(layout);
  var rawKept = 0, rawLost = 0;

  var parts = [];
  for (var fi = 0; fi < 6; fi++) {
    var chunks = [Uint8Array.from([0xFF, 0x03, tracks === 40 ? 0x29 : 0x24])];

    for (var track = ranges[fi][0]; track <= ranges[fi][1]; track++) {
      var n = spt(track);

      // A track whose sectors are all "no sync" is stored as count 0 with no
      // sector data at all — that is how the format says error 21. A track the
      // G64 left out says the same thing, so honour that too.
      var lt = byTrack ? byTrack[track] : null;
      var allNoSync = !!(byTrack && !lt);
      for (var s0 = 0; s0 < n && !allNoSync; s0++) {
        if (errAt(track, s0) !== SIXPACK_ERR_NO_SYNC) break;
        if (s0 === n - 1) allNoSync = true;
      }

      var desc = new Uint8Array(256);
      if (allNoSync) { chunks.push(desc); continue; }   // count byte stays 0

      for (var g = 0; g < n; g++) {
        var e = errAt(track, g);
        var hId1 = e === SIXPACK_ERR_ID_MISMATCH ? (id1 ^ 0xFF) : id1;
        var hId2 = e === SIXPACK_ERR_ID_MISMATCH ? (id2 ^ 0xFF) : id2;
        var chk = g ^ track ^ hId2 ^ hId1;
        if (e === SIXPACK_ERR_HEADER_CSUM) chk ^= 0xFF;
        var a = _sixpackEnc4(e === SIXPACK_ERR_NO_HEADER ? 0x00 : 0x08, chk, g, track);
        var b = _sixpackEnc4(hId2, hId1, 0x0F, 0x0F);
        desc.set(a.concat(b), g * 10);
      }
      desc[0xFF] = n;
      chunks.push(desc);

      var order = _sixpackInterleave(track);
      for (var k = 0; k < n; k++) {
        var sec = order[k];

        // Sector the G64 could not decode: its bytes exist only in the raw
        // GCR, so copy that block through rather than encoding the blank D64
        // payload over the top of it.
        var kept = null;
        if (lt && lt.unreadableSectors && lt.unreadableSectors.indexOf(sec) >= 0) {
          var dp = lt.sectorDataStart ? lt.sectorDataStart[sec] : undefined;
          if (typeof dp === 'number' && lt.rawGCR && lt.rawGCR.length) {
            kept = _sixpackStoreOrder(
              _sixpackReadCircular(lt.rawGCR, dp, SIXPACK_SECTOR_GCR));
            rawKept++;
          } else {
            rawLost++;      // header never decoded either, so it can't be found
          }
        }
        if (kept) { chunks.push(kept); continue; }

        var off = calcD64Offset(track, sec, spt);
        chunks.push(_sixpackEncodeSector(all.subarray(off, off + 256), errAt(track, sec)));
      }
    }

    var total = 0;
    for (var c = 0; c < chunks.length; c++) total += chunks[c].length;
    var out = new Uint8Array(total);
    var o = 0;
    for (var d = 0; d < chunks.length; d++) { out.set(chunks[d], o); o += chunks[d].length; }
    parts.push({ prefix: (fi + 1) + '!!', name: (fi + 1) + '!!' + base, data: out });
  }
  return { parts: parts, tracks: tracks, rawKept: rawKept, rawLost: rawLost };
}

// ── G64 output ───────────────────────────────────────────────────────
// SixPack holds GCR, so a G64 can carry it through untouched — the only way a
// sector with non-standard encoding (Vorpal, Warp25) survives at all. What
// SixPack does *not* store is the framing: sync marks, gaps, track lengths.
// Those are synthesised, so the result is faithful sector data inside
// plausible framing, not a capture of the original surface.
//
// Framing constants follow s2g.c 0.14 by Markus Brenner (GPL), itself based
// on d64tog64.c by Andreas Boose.

var SIXPACK_G64_SYNC = 0xFF;
var SIXPACK_G64_GAP = 0x55;
var SIXPACK_G64_STRIDE = 360;                            // 5+10+9+5+326+5
var SIXPACK_G64_TRACK_LEN = [6250, 6666, 7142, 7692];    // by density zone

function _sixpackDensity(track) {
  if (track <= 17) return 3;
  if (track <= 24) return 2;
  if (track <= 30) return 1;
  return 0;
}

// Walk the six parts, handing each track's descriptor and raw sector blocks to
// `cb(track, desc, blocks, count)`. Returns an error string or null.
function _sixpackWalkTracks(files, tracks, cb) {
  var spt = DISK_FORMATS.d64.sectorsPerTrack;
  var ranges = tracks === 40 ? SIXPACK_RANGES_40 : SIXPACK_RANGES_35;
  for (var fi = 0; fi < 6; fi++) {
    var data = files[fi];
    var pos = 3;                                   // past the signature
    for (var track = ranges[fi][0]; track <= ranges[fi][1]; track++) {
      if (pos + SIXPACK_DESCRIPTOR > data.length) {
        return (fi + 1) + '!! ends before the descriptor for track ' + track + '.';
      }
      var desc = data.subarray(pos, pos + SIXPACK_DESCRIPTOR);
      pos += SIXPACK_DESCRIPTOR;
      var count = desc[0xFF];
      if (count > spt(track)) count = spt(track);
      var blocks = [];
      for (var k = 0; k < count; k++) {
        if (pos + SIXPACK_SECTOR_GCR > data.length) {
          return (fi + 1) + '!! ends mid-sector on track ' + track + '.';
        }
        blocks.push(data.subarray(pos, pos + SIXPACK_SECTOR_GCR));
        pos += SIXPACK_SECTOR_GCR;
      }
      cb(track, desc, blocks, count);
    }
  }
  return null;
}

// Build a G64 from a SixPack set. Returns
// { buffer, tracks, deadTracks, missingSectors } or { error }.
function sixPackToG64(files) {
  var head = _sixpackHeader(files);
  if (head.error) return { error: head.error };
  var spt = DISK_FORMATS.d64.sectorsPerTrack;

  var layout = [];
  var deadTracks = 0, missingSectors = 0;

  var err = _sixpackWalkTracks(files, head.tracks, function(track, desc, blocks, count) {
    // No sectors stored means the drive found no SYNC. A G64 expresses that by
    // leaving the track out — encodeG64FromLayout writes offset 0 — which is
    // truer than laying empty sectors onto a track that could not be read.
    if (count === 0) { deadTracks++; return; }

    var n = spt(track);
    var order = _sixpackInterleave(track);
    var len = SIXPACK_G64_TRACK_LEN[_sixpackDensity(track)];
    var raw = new Uint8Array(len).fill(SIXPACK_G64_GAP);

    // Headers are linear in the descriptor but need not start at sector 0, so
    // match on the sector each header declares rather than assuming group
    // index == sector number.
    var groupOf = {};
    for (var g = 0; g < count; g++) {
      var h = _sixpackDecodeHeader(desc, g);
      if (h && h.track === track && h.sector < n && !(h.sector in groupOf)) {
        groupOf[h.sector] = g;
      }
    }

    for (var sector = 0; sector < n; sector++) {
      var group = (sector in groupOf) ? groupOf[sector] : -1;
      var slot = group >= 0 ? order.indexOf(group) : -1;
      if (group < 0 || slot < 0 || slot >= blocks.length) {
        missingSectors++;              // slot stays gap: no sync, no header
        continue;
      }
      var block = blocks[slot];
      var p = sector * SIXPACK_G64_STRIDE;
      if (p + SIXPACK_G64_STRIDE > len) break;

      var i;
      for (i = 0; i < 5; i++) raw[p++] = SIXPACK_G64_SYNC;
      for (i = 0; i < 10; i++) raw[p++] = desc[group * 10 + i];
      for (i = 0; i < 9; i++) raw[p++] = SIXPACK_G64_GAP;
      for (i = 0; i < 5; i++) raw[p++] = SIXPACK_G64_SYNC;
      // Stored form is [last 70][first 256]; write it back in disk order.
      for (i = 70; i < SIXPACK_SECTOR_GCR; i++) raw[p++] = block[i];
      for (i = 0; i < 70; i++) raw[p++] = block[i];
      // Tail gap. Brenner flags this as approximated; a SixPack records
      // nothing about the real inter-sector gap length.
      for (i = 0; i < 5; i++) raw[p++] = SIXPACK_G64_GAP;
    }

    layout.push({ track: track, halfTrack: false, rawGCR: raw });
  });
  if (err) return { error: err };

  return {
    buffer: encodeG64FromLayout(layout),
    tracks: head.tracks,
    deadTracks: deadTracks,
    missingSectors: missingSectors,
  };
}
