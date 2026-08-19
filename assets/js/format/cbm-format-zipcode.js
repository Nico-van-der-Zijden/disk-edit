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
