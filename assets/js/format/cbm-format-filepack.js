// ── FilePacked ZipCode (a!NAME, b!NAME, ... + x!NAME) ────────────────
// Spec: disks/FORMATS/ZIP_FILE.TXT rev 1.4. Packs individual files, not a
// disk. Entries are [(method<<6)|TRACK][SECTOR][payload] over 254-byte
// sectors; TRACK $00 marks a file's last block with SECTOR = bytes used.
// Those markers set the file boundaries — x!'s sector counts are advisory.

var FILEPACK_SECTOR_DATA = 254;      // payload per sector, link bytes excluded
var FILEPACK_DIR_ENTRY = 21;
var FILEPACK_DIR_START = 0x201;
var FILEPACK_LETTERS = 'abcdefghijklmnopqrstuvw';   // x! is the directory

var FILEPACK_NAME_RE = /^[a-w]![^!]/i;
var FILEPACK_DIR_RE = /^x![^!]/i;

/** @param {string} name @returns {boolean} a!NAME .. w!NAME (a data part) */
function isFilePackFileName(name) {
  return FILEPACK_NAME_RE.test(String(name || '').trim());
}

/** @param {string} name @returns {boolean} x!NAME (the directory part) */
function isFilePackDirName(name) {
  return FILEPACK_DIR_RE.test(String(name || '').trim());
}

// A set needs x! plus an unbroken run of data parts from a!.
// Returns { complete: [{name, refs, dirRef}], partial }.
function findFilePackSets(items) {
  var sets = {};
  for (var i = 0; i < items.length; i++) {
    var name = (items[i].name || '').trim();
    if (name.length < 3 || name.charAt(1) !== '!') continue;
    var letter = name.charAt(0).toLowerCase();
    if (name.charAt(2) === '!') continue;                 // "a!!" is not ours
    var isDir = letter === 'x';
    if (!isDir && FILEPACK_LETTERS.indexOf(letter) < 0) continue;
    var base = name.substring(2);
    if (!sets[base]) sets[base] = { parts: {}, dir: null };
    if (isDir) { if (!sets[base].dir) sets[base].dir = items[i].ref; }
    else if (!(letter in sets[base].parts)) sets[base].parts[letter] = items[i].ref;
  }

  var complete = [], partial = [];
  Object.keys(sets).forEach(function(base) {
    var s = sets[base];
    // Collect the unbroken run a!, b!, c!, ... — a gap ends the set.
    var refs = [];
    for (var k = 0; k < FILEPACK_LETTERS.length; k++) {
      var L = FILEPACK_LETTERS.charAt(k);
      if (!(L in s.parts)) break;
      refs.push(s.parts[L]);
    }
    var have = Object.keys(s.parts).length;
    if (s.dir && refs.length > 0 && refs.length === have) {
      complete.push({ name: base, refs: refs, dirRef: s.dir });
    } else {
      var found = Object.keys(s.parts).sort();
      if (s.dir) found.push('x');
      partial.push({ name: base, found: found, hasDir: !!s.dir });
    }
  });
  return { complete: complete, partial: partial };
}

// Returns { dataFileCount, files } or { error }.
function parseFilePackDirectory(x) {
  if (!x || x.length < FILEPACK_DIR_START) {
    return { error: 'x! directory file is too small.' };
  }
  var dataFileCount = x[0x1FF];
  var count = x[0x200];
  if (count === 0) return { error: 'x! directory lists no files.' };

  var files = [];
  for (var i = 0; i < count; i++) {
    var o = FILEPACK_DIR_START + i * FILEPACK_DIR_ENTRY;
    if (o + FILEPACK_DIR_ENTRY > x.length) {
      return { error: 'x! directory ends after ' + i + ' of ' + count + ' entries.' };
    }
    var nameBytes = x.slice(o, o + 16);
    var type = x[o + 0x10];
    files.push({
      nameBytes: nameBytes,
      name: readPetsciiString(x, o, 16),
      type: type,
      // Type is the letter OR'd with $80.
      typeChar: String.fromCharCode(type & 0x7F),
      sectors: x[o + 0x11] | (x[o + 0x12] << 8),
      track: x[o + 0x13],
      sector: x[o + 0x14],
    });
  }
  return { dataFileCount: dataFileCount, files: files };
}

// Returns { data, bytesUsed, last, next } or { error }. `data` is always a
// full sector; bytesUsed is smaller only on a file's last block.
function _filePackSector(f, pos, label) {
  if (pos + 1 >= f.length) return { error: label + ' ends mid-entry.' };
  var tb = f[pos];
  var method = (tb >> 6) & 0x03;
  var track = tb & 0x3F;
  var sector = f[pos + 1];
  var p = pos + 2;
  var data = new Uint8Array(FILEPACK_SECTOR_DATA);

  if (method === 0) {
    if (p + FILEPACK_SECTOR_DATA > f.length) return { error: label + ' truncated in a stored sector.' };
    data.set(f.subarray(p, p + FILEPACK_SECTOR_DATA), 0);
    p += FILEPACK_SECTOR_DATA;

  } else if (method === 1) {
    if (p >= f.length) return { error: label + ' truncated in a fill sector.' };
    data.fill(f[p++]);

  } else if (method === 2) {
    if (p + 1 >= f.length) return { error: label + ' truncated in an RLE header.' };
    var len = f[p++];
    var rep = f[p++];
    var end = p + len;
    if (end > f.length) return { error: label + ' truncated in an RLE sector.' };
    var n = 0;
    while (p < end) {
      var b = f[p++];
      if (b === rep) {
        if (p + 2 > end) return { error: label + ' truncated in an RLE run.' };
        var cnt = f[p++];
        var val = f[p++];
        if (cnt === 0) cnt = 256;
        for (var r = 0; r < cnt && n < FILEPACK_SECTOR_DATA; r++) data[n++] = val;
      } else if (n < FILEPACK_SECTOR_DATA) {
        data[n++] = b;
      }
    }
    if (n !== FILEPACK_SECTOR_DATA) {
      return { error: label + ': RLE sector decoded to ' + n + ' bytes, expected ' + FILEPACK_SECTOR_DATA + '.' };
    }
    p = end;

  } else {
    return { error: label + ' uses compression method 11.' };
  }

  var last = track === 0;
  return {
    data: data,
    bytesUsed: last ? sector : FILEPACK_SECTOR_DATA,
    last: last,
    next: p,
  };
}

// `dataFiles` is [a!, b!, ...] in letter order, `x` the directory file.
// Returns { files, skipped } or { error }.
function decompressFilePack(dataFiles, x) {
  if (!dataFiles || dataFiles.length === 0) return { error: 'No a!/b!/... data files in the set.' };
  var dir = parseFilePackDirectory(x);
  if (dir.error) return { error: dir.error };

  if (dir.dataFileCount && dir.dataFileCount !== dataFiles.length) {
    return {
      error: 'x! expects ' + dir.dataFileCount + ' data file(s) but ' +
        dataFiles.length + ' were supplied.',
    };
  }

  // Walk the sector stream across every data file in order, cutting a new
  // file at each TRACK==$00 marker.
  var out = [], skipped = [];
  var cur = [], curBytes = 0;
  var fileIdx = 0;

  for (var fi = 0; fi < dataFiles.length; fi++) {
    var f = dataFiles[fi];
    var label = FILEPACK_LETTERS.charAt(fi) + '!';
    if (!f || f.length < 4) return { error: label + ' is too small to be a FilePacked file.' };
    var load = f[0] | (f[1] << 8);
    if (load !== 0x03FF) {
      return { error: label + ' has load address $' + hex16(load) + ' (expected $03FF).' };
    }
    var declared = f[2];
    var pos = 3;

    for (var s = 0; s < declared; s++) {
      var res = _filePackSector(f, pos, label);
      if (res.error) return { error: res.error };
      pos = res.next;

      cur.push(res.data.subarray(0, res.bytesUsed));
      curBytes += res.bytesUsed;

      if (res.last) {
        var meta = dir.files[fileIdx];
        var blob = new Uint8Array(curBytes);
        var o = 0;
        for (var c = 0; c < cur.length; c++) { blob.set(cur[c], o); o += cur[c].length; }
        if (meta) {
          out.push({
            nameBytes: meta.nameBytes,
            name: meta.name,
            typeChar: meta.typeChar,
            sectors: meta.sectors,
            data: blob,
          });
        } else {
          // More files in the stream than the directory accounts for.
          skipped.push({ name: 'file ' + (fileIdx + 1), reason: 'no directory entry' });
        }
        fileIdx++;
        cur = []; curBytes = 0;
      }
    }
  }

  if (cur.length > 0) {
    skipped.push({
      name: dir.files[fileIdx] ? readPetsciiString(dir.files[fileIdx].nameBytes, 0, 16) : 'file ' + (fileIdx + 1),
      reason: 'stream ended without a last-block marker',
    });
  }
  for (var m = fileIdx; m < dir.files.length; m++) {
    skipped.push({ name: dir.files[m].name, reason: 'listed in x! but not present in the data files' });
  }

  if (out.length === 0) return { error: 'No complete files found in the set.' };
  return { files: out, skipped: skipped };
}
