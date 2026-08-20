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

// ── Encoding ─────────────────────────────────────────────────────────

function _filePackRle(sec) {
  var used = new Uint8Array(256);
  for (var i = 0; i < sec.length; i++) used[sec[i]] = 1;
  var rep = -1;
  for (var c = 0; c < 256; c++) if (!used[c]) { rep = c; break; }
  if (rep < 0) return null;
  var p = [];
  for (var j = 0; j < FILEPACK_SECTOR_DATA;) {
    var run = 1;
    while (j + run < FILEPACK_SECTOR_DATA && sec[j + run] === sec[j] && run < 255) run++;
    if (run >= 4) { p.push(rep, run, sec[j]); j += run; }
    else { for (var k = 0; k < run; k++) p.push(sec[j]); j += run; }
  }
  return p.length > 255 ? null : { rep: rep, payload: p };
}

// One sector entry. `track`/`sector` are the original disk position, which is
// informational except for the TRACK $00 marker on a file's last block.
function _filePackEntry(out, track, sector, sec) {
  var uniform = true;
  for (var u = 1; u < FILEPACK_SECTOR_DATA && uniform; u++) if (sec[u] !== sec[0]) uniform = false;
  if (uniform) { out.push((1 << 6) | track, sector, sec[0]); return; }

  var rle = _filePackRle(sec);
  if (rle && rle.payload.length + 2 < FILEPACK_SECTOR_DATA) {
    out.push((2 << 6) | track, sector, rle.payload.length, rle.rep);
    for (var r = 0; r < rle.payload.length; r++) out.push(rle.payload[r]);
  } else {
    out.push((0 << 6) | track, sector);
    for (var b = 0; b < FILEPACK_SECTOR_DATA; b++) out.push(sec[b]);
  }
}

// Encode files into a FilePacked set. `files` is
// [{ nameBytes(16), typeChar('P'|'S'|'U'), data }]. Returns { parts, dir } —
// parts are the a!/b!/... data files and dir is the x! file — or { error }.
//
// The x! BASIC lister area is left zeroed: any decoder ignores it (ours reads
// from $01FF on), but the archive won't self-list on a real C64.
function compressFilePack(files, baseName) {
  if (!files || files.length === 0) return { error: 'No files to pack.' };
  var base = String(baseName || 'DISK').trim().toUpperCase().slice(0, 14);
  if (!base) return { error: 'Give the set a name.' };

  // Flatten every file into sector entries, marking each file's last block.
  var entries = [];
  var meta = [];
  for (var f = 0; f < files.length; f++) {
    var d = files[f].data;
    var blocks = Math.max(1, Math.ceil(d.length / FILEPACK_SECTOR_DATA));
    for (var b = 0; b < blocks; b++) {
      var sec = new Uint8Array(FILEPACK_SECTOR_DATA);
      sec.set(d.subarray(b * FILEPACK_SECTOR_DATA,
        Math.min(d.length, (b + 1) * FILEPACK_SECTOR_DATA)), 0);
      var last = b === blocks - 1;
      var used = last ? (d.length - b * FILEPACK_SECTOR_DATA) : FILEPACK_SECTOR_DATA;
      entries.push({
        track: last ? 0 : (1 + (b % 35)),
        sector: last ? (used & 0xFF) : (b % 17),
        data: sec,
      });
    }
    meta.push({ nameBytes: files[f].nameBytes, typeChar: files[f].typeChar || 'P', blocks: blocks });
  }

  // 166 sectors per data file is the format's maximum.
  var parts = [];
  for (var i = 0; i < entries.length; i += 166) {
    var slice = entries.slice(i, i + 166);
    var out = [0xFF, 0x03, slice.length];
    for (var s = 0; s < slice.length; s++) {
      _filePackEntry(out, slice[s].track, slice[s].sector, slice[s].data);
    }
    parts.push({
      prefix: FILEPACK_LETTERS.charAt(parts.length) + '!',
      name: FILEPACK_LETTERS.charAt(parts.length) + '!' + base,
      data: Uint8Array.from(out),
    });
    if (parts.length >= FILEPACK_LETTERS.length) return { error: 'Too many files for one set.' };
  }

  var dir = new Uint8Array(FILEPACK_DIR_START + files.length * FILEPACK_DIR_ENTRY);
  // $0801 load address, then the lister. It has to end before $01FF, which
  // is the data-file count.
  dir[0] = 0x01;
  dir[1] = 0x08;
  var lister = buildBasicProgram(FILEPACK_LISTER, 0x0801);
  if (lister && 2 + lister.length <= 0x1FF) dir.set(lister, 2);

  dir[0x1FF] = parts.length;
  dir[0x200] = files.length;
  for (var m = 0; m < meta.length; m++) {
    var o = FILEPACK_DIR_START + m * FILEPACK_DIR_ENTRY;
    dir.set(meta[m].nameBytes.subarray(0, 16), o);
    dir[o + 0x10] = meta[m].typeChar.charCodeAt(0) | 0x80;
    dir[o + 0x11] = meta[m].blocks & 0xFF;
    dir[o + 0x12] = (meta[m].blocks >> 8) & 0xFF;
    dir[o + 0x13] = 17;
    dir[o + 0x14] = 0;
  }

  return { parts: parts, dir: { prefix: 'x!', name: 'x!' + base, data: dir } };
}

// ── x! BASIC lister ──────────────────────────────────────────────────
// The x! file opens with a BASIC program that lists the archive on a real
// C64. This one is written fresh rather than lifted from the original
// packer, whose machine-language routine is someone else's code.
//
// Pure BASIC is enough because of where the data lands: the file loads at
// $0801, so file offset $01FF..$0201 becomes $09FE..$0A00, and LOAD leaves
// VARTAB above the whole file — variables never reach the directory, so the
// program can just PEEK it. (The original's ML confirms the mapping: it
// compares a counter against $09FF, the file count.)
var FILEPACK_LISTER = [
  [0, 'PRINT"\x93ZIPCODE ARCHIVE"'],
  [1, 'F=PEEK(2559):D=PEEK(2558)'],
  [2, 'PRINTF;"FILE(S) IN";D;"PART(S)"'],
  [3, 'PRINT'],
  [4, 'FORI=0TOF-1'],
  [5, 'A=2560+I*21:N$=""'],
  [6, 'FORJ=0TO15:C=PEEK(A+J)'],
  [7, 'IFC<>160THENN$=N$+CHR$(C)'],
  [8, 'NEXTJ'],
  [9, 'PRINTN$;TAB(18);PEEK(A+17)+PEEK(A+18)*256;CHR$(PEEK(A+16)AND127)'],
  [10, 'NEXTI'],
];

// Keyword list built from the viewer's own token table, so the encoder and
// the detokenizer can never disagree. Longest first for correct matching
// ("PRINT#" before "PRINT", "TAB(" before "TO").
function _basicKeywords() {
  if (typeof BASIC_V2_TOKENS === 'undefined') return null;
  var kws = [];
  for (var i = 0; i < BASIC_V2_TOKENS.length; i++) {
    kws.push([BASIC_V2_TOKENS[i], 0x80 + i]);
  }
  kws.sort(function(a, b) { return b[0].length - a[0].length; });
  return kws;
}

function _basicTokenizeLine(text, kws) {
  var out = [];
  var quoted = false;
  var i = 0;
  while (i < text.length) {
    if (text.charAt(i) === '"') { quoted = !quoted; out.push(0x22); i++; continue; }
    if (quoted) { out.push(text.charCodeAt(i) & 0xFF); i++; continue; }
    var hit = null;
    for (var k = 0; k < kws.length; k++) {
      if (text.substr(i, kws[k][0].length) === kws[k][0]) { hit = kws[k]; break; }
    }
    if (hit) { out.push(hit[1]); i += hit[0].length; continue; }
    out.push(text.charCodeAt(i) & 0xFF);
    i++;
  }
  return out;
}

// Tokenize `lines` into a runnable BASIC program at `startAddr`, including
// the per-line link pointers and the trailing end-of-program marker.
function buildBasicProgram(lines, startAddr) {
  var kws = _basicKeywords();
  if (!kws) return null;

  var enc = lines.map(function(l) {
    return { num: l[0], toks: _basicTokenizeLine(l[1], kws) };
  });
  var addr = startAddr;
  for (var i = 0; i < enc.length; i++) {
    addr += 4 + enc[i].toks.length + 1;
    enc[i].next = addr;
  }
  var out = [];
  for (var j = 0; j < enc.length; j++) {
    out.push(enc[j].next & 0xFF, (enc[j].next >> 8) & 0xFF);
    out.push(enc[j].num & 0xFF, (enc[j].num >> 8) & 0xFF);
    for (var t = 0; t < enc[j].toks.length; t++) out.push(enc[j].toks[t]);
    out.push(0x00);
  }
  out.push(0x00, 0x00);
  return Uint8Array.from(out);
}
