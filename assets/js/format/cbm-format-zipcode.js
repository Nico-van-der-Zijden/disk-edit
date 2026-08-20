// ── DiskPacked ZipCode (4/5-file: 1!NAME .. 5!NAME) ──────────────────
// Spec: disks/FORMATS/ZIP_DISK.TXT rev 1.3. Compressed sector copy of a
// whole disk; no error-byte provision, so output is always a plain D64.
// Entry = [(method<<6)|TRACK][SECTOR][payload]. Note the TRACK rides in
// the top byte and SECTOR is explicit — sectors are stored in the packer's
// read interleave, so the stored T/S must be honoured, not inferred.

// Sector totals per the spec: 168/168/172/175/85.
var ZIPCODE_RANGES_35 = [[1, 8], [9, 16], [17, 25], [26, 35]];
var ZIPCODE_RANGES_40 = [[1, 8], [9, 16], [17, 25], [26, 35], [36, 40]];

// `items` is [{ name, ref }]; ref is whatever the caller needs to fetch the
// data later. Returns { complete: [{name, tracks, refs}], partial }.
function findZipCodeSets(items) {
  var sets = {};
  for (var i = 0; i < items.length; i++) {
    var name = (items[i].name || '').trim();
    if (name.length < 3) continue;
    var digit = name.charAt(0);
    if (name.charAt(1) !== '!' || digit < '1' || digit > '5') continue;
    if (name.charAt(2) === '!') continue;          // "1!!NAME" is SixPack
    var base = name.substring(2);
    if (!sets[base]) sets[base] = {};
    // First occurrence wins; a duplicate prefix means a malformed disk.
    if (!(digit in sets[base])) sets[base][digit] = items[i].ref;
  }

  var complete = [], partial = [];
  Object.keys(sets).forEach(function(base) {
    var got = sets[base];
    var has = function(d) { return d in got; };
    var tracks = 0;
    if (has('1') && has('2') && has('3') && has('4')) tracks = has('5') ? 40 : 35;
    if (tracks) {
      var refs = ['1', '2', '3', '4'];
      if (tracks === 40) refs.push('5');
      complete.push({
        name: base,
        tracks: tracks,
        refs: refs.map(function(d) { return got[d]; }),
      });
    } else {
      partial.push({ name: base, found: Object.keys(got).sort() });
    }
  });
  return { complete: complete, partial: partial };
}

// `files` is 4 or 5 Uint8Arrays in 1!..5! order. Returns
// { buffer, tracks, missing } or { error }; `missing` counts sectors no
// entry ever wrote (0 for a clean set).
function decompressZipCode(files) {
  if (!files || (files.length !== 4 && files.length !== 5)) {
    return { error: 'A ZipCode set needs 4 files (35 tracks) or 5 (40 tracks).' };
  }
  var tracks = files.length === 5 ? 40 : 35;
  var spt = DISK_FORMATS.d64.sectorsPerTrack;
  var ranges = tracks === 40 ? ZIPCODE_RANGES_40 : ZIPCODE_RANGES_35;

  var total = 0;
  for (var t = 1; t <= tracks; t++) total += spt(t) * 256;
  var d64 = new Uint8Array(total);
  // One flag per sector so truncated or overlapping sets are detectable.
  var seen = new Uint8Array(total / 256);

  for (var fi = 0; fi < files.length; fi++) {
    var f = files[fi];
    var label = (fi + 1) + '!';
    if (!f || f.length < 3) return { error: label + ' is too small to be a ZipCode file.' };

    // $03FE carries a 2-byte disk ID, $0400 does not.
    var load = f[0] | (f[1] << 8);
    var pos;
    if (load === 0x03FE) pos = 4;
    else if (load === 0x0400) pos = 2;
    else return { error: label + ' has load address $' + hex16(load) + ' (expected $03FE or $0400).' };

    var lo = ranges[fi][0], hi = ranges[fi][1];
    while (pos < f.length) {
      if (pos + 1 >= f.length) return { error: label + ' ends mid-entry.' };
      var tb = f[pos++];
      var method = (tb >> 6) & 0x03;
      var track = tb & 0x3F;
      var sector = f[pos++];

      if (track < lo || track > hi) {
        return { error: label + ' holds track ' + track + ', outside its range ' + lo + '-' + hi + '.' };
      }
      if (sector >= spt(track)) {
        return { error: label + ': track ' + track + ' has no sector ' + sector + '.' };
      }
      var off = calcD64Offset(track, sector, spt);

      if (method === 0) {
        if (pos + 256 > f.length) return { error: label + ' truncated in a stored sector.' };
        d64.set(f.subarray(pos, pos + 256), off);
        pos += 256;

      } else if (method === 1) {
        if (pos >= f.length) return { error: label + ' truncated in a fill sector.' };
        d64.fill(f[pos++], off, off + 256);

      } else if (method === 2) {
        // RLE: length, REP, then `length` bytes where REP starts a run.
        if (pos + 1 >= f.length) return { error: label + ' truncated in an RLE header.' };
        var len = f[pos++];
        var rep = f[pos++];
        var end = pos + len;
        if (end > f.length) return { error: label + ' truncated in an RLE sector.' };
        var n = 0;
        while (pos < end) {
          var b = f[pos++];
          if (b === rep) {
            if (pos + 2 > end) return { error: label + ' truncated in an RLE run.' };
            var count = f[pos++];
            var val = f[pos++];
            // Count 0 never occurs in practice; treat it as 256.
            if (count === 0) count = 256;
            for (var ri = 0; ri < count && n < 256; ri++) d64[off + n++] = val;
          } else {
            if (n < 256) d64[off + n++] = b;
          }
        }
        if (n !== 256) {
          return { error: label + ': RLE sector ' + track + '/' + sector + ' decoded to ' + n + ' bytes, expected 256.' };
        }
        pos = end;

      } else {
        return { error: label + ' uses compression method 11 at track ' + track + ', sector ' + sector + '.' };
      }

      seen[off / 256] = 1;
    }
  }

  var missing = 0;
  for (var si = 0; si < seen.length; si++) if (!seen[si]) missing++;
  return { buffer: d64.buffer, tracks: tracks, missing: missing };
}

// ZipCode files carry no extension (the name *is* "1!NAME"), so routing has
// to match on the name. One bang is DiskPacked, two is SixPack; FilePacked
// uses letters (a!/b!/x!) and is matched in cbm-format-filepack.js.
var ZIPCODE_NAME_RE = /^[1-5]![^!]/;
var SIXPACK_NAME_RE = /^[1-6]!!/;

/** @param {string} name @returns {boolean} */
function isZipCodeFileName(name) {
  return ZIPCODE_NAME_RE.test(String(name || '').trim());
}

/** @param {string} name @returns {boolean} */
function isSixPackFileName(name) {
  return SIXPACK_NAME_RE.test(String(name || '').trim());
}

// ── Encoding ─────────────────────────────────────────────────────────

// RLE one sector, or null when it can't help. REP must be a byte value the
// sector doesn't use; runs shorter than 4 aren't worth the 3-byte triple.
function _zipCodeRle(sec) {
  var used = new Uint8Array(256);
  for (var i = 0; i < 256; i++) used[sec[i]] = 1;
  var rep = -1;
  for (var c = 0; c < 256; c++) if (!used[c]) { rep = c; break; }
  if (rep < 0) return null;

  var p = [];
  for (var j = 0; j < 256;) {
    var run = 1;
    while (j + run < 256 && sec[j + run] === sec[j] && run < 255) run++;
    if (run >= 4) { p.push(rep, run, sec[j]); j += run; }
    else { for (var k = 0; k < run; k++) p.push(sec[j]); j += run; }
  }
  return p.length > 255 ? null : { rep: rep, payload: p };
}

// Encode a D64 into DiskPacked parts. Returns { parts, tracks, droppedErrors }
// or { error }. Parts are { name, data } in 1!..N! order; a set from a disk
// carrying error bytes loses them, since DiskPacked has nowhere to put them.
function compressZipCode(buffer, baseName) {
  var all = new Uint8Array(buffer);
  var tracks = 0, droppedErrors = 0;
  if (all.length === 174848) tracks = 35;
  else if (all.length === 175531) { tracks = 35; droppedErrors = 683; }
  else if (all.length === 196608) tracks = 40;
  else if (all.length === 197376) { tracks = 40; droppedErrors = 768; }
  else return { error: 'DiskPacked needs a 35- or 40-track D64.' };

  var base = String(baseName || 'DISK').trim().toUpperCase().slice(0, 14);
  if (!base) return { error: 'Give the set a name.' };

  var spt = DISK_FORMATS.d64.sectorsPerTrack;
  var ranges = tracks === 40 ? ZIPCODE_RANGES_40 : ZIPCODE_RANGES_35;
  var hdr = calcD64Offset(18, 0, spt);
  var id1 = all[hdr + 0xA2], id2 = all[hdr + 0xA3];

  var parts = [];
  for (var fi = 0; fi < ranges.length; fi++) {
    // Only part 1 carries the disk ID, which is what every real set does.
    var out = fi === 0 ? [0xFE, 0x03, id1, id2] : [0x00, 0x04];

    for (var t = ranges[fi][0]; t <= ranges[fi][1]; t++) {
      for (var s = 0; s < spt(t); s++) {
        var off = calcD64Offset(t, s, spt);
        var sec = all.subarray(off, off + 256);

        var uniform = true;
        for (var u = 1; u < 256 && uniform; u++) if (sec[u] !== sec[0]) uniform = false;
        if (uniform) { out.push((1 << 6) | t, s, sec[0]); continue; }

        var rle = _zipCodeRle(sec);
        if (rle && rle.payload.length + 2 < 256) {
          out.push((2 << 6) | t, s, rle.payload.length, rle.rep);
          for (var r = 0; r < rle.payload.length; r++) out.push(rle.payload[r]);
        } else {
          out.push((0 << 6) | t, s);
          for (var b = 0; b < 256; b++) out.push(sec[b]);
        }
      }
    }
    parts.push({ prefix: (fi + 1) + '!', name: (fi + 1) + '!' + base, data: Uint8Array.from(out) });
  }
  return { parts: parts, tracks: tracks, droppedErrors: droppedErrors };
}

// Plan how a set's parts fall across D64 images, without writing anything.
// Greedy fill in part order, which is what the scene did: a 6-part SixPack
// lands 1-3 on the first disk and 4-6 on the second, matching the "-123" /
// "-456" naming convention. Returns [{ parts: [index...], blocks }].
var ZIPCODE_D64_FREE_BLOCKS = 664;

function planZipCodeDisks(parts) {
  var disks = [{ parts: [], blocks: 0 }];
  for (var i = 0; i < parts.length; i++) {
    var need = Math.ceil(parts[i].data.length / 254) || 1;
    var cur = disks[disks.length - 1];
    if (cur.parts.length > 0 && cur.blocks + need > ZIPCODE_D64_FREE_BLOCKS) {
      cur = { parts: [], blocks: 0 };
      disks.push(cur);
    }
    cur.parts.push(i);
    cur.blocks += need;
  }
  return disks;
}

// Suffix naming each image by the parts it carries: "GAME-1234.d64", or
// "GAME-123.d64" / "GAME-456.d64" for a set that needs two disks.
function _zipCodeDiskName(base, disk, single) {
  if (single) return base + '.d64';
  return base + '-' + disk.parts.map(function(i) { return i + 1; }).join('') + '.d64';
}
