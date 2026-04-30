// ── LNX (Lynx) archive parser ─────────────────────────────────────────
// LNX wraps multiple individual C64 files (PRG/SEQ/USR/REL) in a single
// uncompressed container: ASCII header + CR-delimited directory + sector-
// aligned concatenated file bytes. No disk geometry.
//
// Header layout (Ultra Lynx / UNLYNX compatible):
//   [optional 2-byte $01 $08 PRG load address + self-extracting BASIC stub]
//   <headerBlocks decimal> <whitespace/*> "LYNX" <space + comment> <CR>
//   <fileCount decimal> <CR>
//   repeat for each file:
//     <16-byte filename or CR-terminated ASCII> <CR>
//     <block-count decimal>                     <CR>
//     <type letter / word: P|S|U|R|DEL|...>     <CR>
//     <last-sector-bytes decimal, 1..255>       <CR>   // CBM convention: value = bytes_in_last_sector + 1
//   <padding to next 254-byte block>
//   <file 1 data> <file 2 data> ...
//
// dataStart = headerBlocks * 254 (absolute, header area absorbs any PRG prefix).
//
// Returns { files: [{ name, typeIdx, data }], comment } on success or
// { error } on failure. `name` is a Uint8Array of up to 16 PETSCII bytes.
function parseLnxArchive(buffer) {
  var data = new Uint8Array(buffer);
  if (data.length < 32) return { error: 'File is too small to be a LYNX archive.' };

  // Find "LYNX" magic. Self-extracting archives embed a BASIC stub that says
  // "USE LYNX TO DISSOLVE THIS FILE", so the first occurrence isn't always the
  // real header. For each candidate, look backward on the same line for the
  // leading integer (headerBlocks), then forward past the comment's CR to
  // read another integer (fileCount). Only commit when both parse cleanly.
  var magicOff = -1;
  var headerBlocks = 0;
  var fileCount = -1;
  var commentStart = 0, commentEnd = 0;
  var searchStart = 0;
  var searchLimit = Math.min(4096, data.length - 4);
  while (searchStart < searchLimit && magicOff < 0) {
    var candidate = -1;
    for (var i = searchStart; i < searchLimit; i++) {
      if (data[i] === 0x4C && data[i+1] === 0x59 && data[i+2] === 0x4E && data[i+3] === 0x58) {
        candidate = i;
        break;
      }
    }
    if (candidate < 0) break;

    // Walk backward from the candidate to find the CR (or buffer start) that
    // begins this line. Bytes between line-start and the candidate carry the
    // leading integer (headerBlocks). Cap backward scan at 64 bytes.
    var lineStart = candidate - 1;
    var lineMin = Math.max(0, candidate - 64);
    while (lineStart >= lineMin && data[lineStart] !== 0x0D) lineStart--;
    lineStart++; // first byte of the line

    var leading = '';
    for (var li = lineStart; li < candidate; li++) {
      if (data[li] >= 0x20 && data[li] <= 0x7E) leading += String.fromCharCode(data[li]);
    }
    var m = leading.match(/(\d+)/);
    if (!m) { searchStart = candidate + 4; continue; }
    var hb = parseInt(m[1], 10);
    if (!(hb >= 1 && hb <= 255)) { searchStart = candidate + 4; continue; }

    // Forward: skip comment to its CR, then read fileCount token.
    var pProbe = candidate + 4;
    var commentBegin = pProbe;
    while (pProbe < data.length && data[pProbe] !== 0x0D && (pProbe - commentBegin) < 128) pProbe++;
    if (pProbe >= data.length || data[pProbe] !== 0x0D) { searchStart = candidate + 4; continue; }
    var commentFinish = pProbe;
    pProbe++; // skip CR
    var fcStart = pProbe;
    while (pProbe < data.length && data[pProbe] !== 0x0D && (pProbe - fcStart) < 16) pProbe++;
    if (pProbe >= data.length || data[pProbe] !== 0x0D) { searchStart = candidate + 4; continue; }
    var fcStr = '';
    for (var fcI = fcStart; fcI < pProbe; fcI++) {
      if (data[fcI] >= 0x20 && data[fcI] <= 0x7E) fcStr += String.fromCharCode(data[fcI]);
    }
    fcStr = fcStr.trim();
    if (!/^\d+$/.test(fcStr)) { searchStart = candidate + 4; continue; }
    var fc = parseInt(fcStr, 10);
    if (!(fc >= 0 && fc <= 4096)) { searchStart = candidate + 4; continue; }

    magicOff = candidate;
    headerBlocks = hb;
    fileCount = fc;
    commentStart = commentBegin;
    commentEnd = commentFinish;
  }
  if (magicOff < 0) return { error: 'Not a LYNX archive (no LYNX signature found).' };

  var comment = '';
  for (var cIdx = commentStart; cIdx < commentEnd; cIdx++) {
    if (data[cIdx] >= 0x20 && data[cIdx] <= 0x7E) comment += String.fromCharCode(data[cIdx]);
  }
  comment = comment.trim();

  // Re-derive `p` — the inner-loop variables are scoped to the iteration.
  // Walk past: LYNX (4) + comment to CR + fileCount token to CR.
  var p = magicOff + 4;
  while (p < data.length && data[p] !== 0x0D) p++; p++; // past comment CR
  while (p < data.length && data[p] !== 0x0D) p++; p++; // past fileCount CR

  // Read the next CR-terminated token as a trimmed ASCII string.
  function readToken(maxLen) {
    maxLen = maxLen || 64;
    var start = p;
    while (p < data.length && data[p] !== 0x0D && (p - start) < maxLen) p++;
    if (p >= data.length) return null;
    var s = '';
    for (var k = start; k < p; k++) {
      if (data[k] >= 0x20 && data[k] <= 0x7E) s += String.fromCharCode(data[k]);
    }
    p++; // skip CR
    return s.trim();
  }

  // Read a filename. Handles both common conventions:
  //   (a) fixed 16 bytes, possibly followed by a CR (older LNX).
  //   (b) variable-length, CR-terminated (LYNX XV and later).
  // Detected by scanning forward for a CR within the first 17 bytes.
  // Returns a 16-byte Uint8Array padded with $A0.
  function readFilenameBytes() {
    var crIdx = -1;
    for (var k = p; k < Math.min(p + 17, data.length); k++) {
      if (data[k] === 0x0D) { crIdx = k; break; }
    }
    if (crIdx < 0) return null;
    var nameLen = crIdx - p;
    if (nameLen > 16) nameLen = 16;
    var name = new Uint8Array(16);
    for (var j = 0; j < 16; j++) name[j] = j < nameLen ? data[p + j] : 0xA0;
    p = crIdx + 1;
    return name;
  }

  // Header area = headerBlocks * 254 bytes, and absorbs any PRG prefix
  // that precedes the LYNX text.
  var dataStart = headerBlocks * 254;
  if (dataStart > data.length) return { error: 'LYNX header claims more blocks than the file contains.' };

  // First pass: parse the whole directory so we can pick padded vs compact
  // storage layout by seeing which one lines up best with the actual buffer
  // size. Some writers pad each file to a 254-byte block boundary; others
  // store files back-to-back at their exact data size.
  var entries = [];
  var idx = 0;
  while (true) {
    if (fileCount >= 0 && idx >= fileCount) break;
    if (p >= dataStart) break;
    if (p >= data.length) break;
    if (data[p] === 0x00) break; // header tail is zero-padded

    var nameBytes = readFilenameBytes();
    if (!nameBytes) break;
    var blocksTok = readToken();
    var typeTok = readToken();
    var lastBytesTok = readToken();
    if (blocksTok === null || typeTok === null || lastBytesTok === null) {
      if (fileCount >= 0) return { error: 'Malformed LYNX directory at entry ' + (idx + 1) + '.' };
      break;
    }
    var blocks = parseInt(blocksTok, 10);
    var lastBytes = parseInt(lastBytesTok, 10);
    if (!isFinite(blocks) || blocks < 1 || !isFinite(lastBytes) || lastBytes < 1 || lastBytes > 255) {
      if (fileCount >= 0) {
        return { error: 'Malformed LYNX entry at #' + (idx + 1) + '.' };
      }
      break;
    }

    // Type letter: first non-space ASCII alpha. Accepts P, S, U, R, D.
    var typeIdx = -1;
    for (var ti = 0; ti < typeTok.length; ti++) {
      var ch = typeTok.charCodeAt(ti);
      if (ch === 0x20) continue;
      if (ch === 0x50 || ch === 0x70) { typeIdx = FILE_TYPE.PRG; break; }
      if (ch === 0x53 || ch === 0x73) { typeIdx = FILE_TYPE.SEQ; break; }
      if (ch === 0x55 || ch === 0x75) { typeIdx = FILE_TYPE.USR; break; }
      if (ch === 0x52 || ch === 0x72) { typeIdx = FILE_TYPE.REL; break; }
      if (ch === 0x44 || ch === 0x64) { typeIdx = FILE_TYPE.DEL; break; }
      break;
    }
    entries.push({ name: nameBytes, typeIdx: typeIdx, blocks: blocks, lastBytes: lastBytes });
    idx++;
  }

  if (entries.length === 0) return { error: 'LYNX archive contains no file entries.' };

  // Decide padded vs compact storage: pick whichever predicted end-of-file
  // lines up better with the actual buffer size. `lastBytes` follows the CBM
  // disk convention (value = real bytes in last sector + 1), so the file
  // size is (blocks-1)*254 + (lastBytes-1).
  var paddedTotal = dataStart;
  var compactTotal = dataStart;
  for (var ei = 0; ei < entries.length; ei++) {
    paddedTotal += entries[ei].blocks * 254;
    compactTotal += (entries[ei].blocks - 1) * 254 + (entries[ei].lastBytes - 1);
  }
  var usePadded = Math.abs(paddedTotal - data.length) <= Math.abs(compactTotal - data.length);

  // Second pass: slice each file's data, advancing by padded or compact step.
  // Last file is truncated gracefully if the archive is shorter than declared.
  var files = [];
  var dataOff = dataStart;
  for (var fi = 0; fi < entries.length; fi++) {
    var e = entries[fi];
    var realSize = (e.blocks - 1) * 254 + (e.lastBytes - 1);
    var avail = data.length - dataOff;
    if (avail <= 0) {
      // Can't fit any data — skip the rest.
      break;
    }
    var take = Math.min(realSize, avail);
    var fileData = data.subarray(dataOff, dataOff + take);
    dataOff += usePadded ? (e.blocks * 254) : take;
    if (dataOff > data.length) dataOff = data.length;
    files.push({ name: e.name, typeIdx: e.typeIdx, blocks: e.blocks, data: fileData });
  }

  return { files: files, comment: comment };
}

/** @param {ArrayBuffer} buffer @returns {DiskInfo} */
