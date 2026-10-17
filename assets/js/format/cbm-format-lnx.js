// ── LNX (Lynx) archive parser ─────────────────────────────────────────
// Spec: disks/FORMATS/LNX.TXT. Layout:
//   [optional $01 $08 load address + self-extracting BASIC stub]
//   <headerBlocks> "LYNX" <comment> CR  <fileCount> CR
//   per file: <name> CR <blocks> CR <type> CR [<record size> CR, REL only]
//             <LSU = bytes in last block + 1> CR
//   file data from headerBlocks * 254, each file padded to 254-byte blocks.
//
// Returns { files: [{ name, typeIdx, blocks, data, recordSize? }], comment }
// or { error }. `name` is 16 PETSCII bytes, $A0-padded.
function parseLnxArchive(buffer) {
  var data = new Uint8Array(buffer);
  if (data.length < 32) return { error: 'File is too small to be a LYNX archive.' };

  // The BASIC stub says "USE LYNX TO DISSOLVE THIS FILE", so take the first
  // "LYNX" with a headerBlocks number before it and a fileCount line after.
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

  // Skip past the comment line and the fileCount line.
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

  // Names are either 16 bytes + CR or shorter and CR-terminated.
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

  var dataStart = headerBlocks * 254;
  if (dataStart > data.length) return { error: 'LYNX header claims more blocks than the file contains.' };

  // First pass: the whole directory. Some writers pad files to 254-byte
  // blocks, others store them back to back; the total size tells which.
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
    var typeIdx = typeTok === null ? -1 : _lnxTypeIdx(typeTok);
    // REL entries carry the record size before the last-block size.
    var recordTok = typeIdx === FILE_TYPE.REL ? readToken() : '';
    var lastBytesTok = readToken();
    if (blocksTok === null || typeTok === null || recordTok === null || lastBytesTok === null) {
      if (fileCount >= 0) return { error: 'Malformed LYNX directory at entry ' + (idx + 1) + '.' };
      break;
    }
    var blocks = parseInt(blocksTok, 10);
    var lastBytes = parseInt(lastBytesTok, 10);
    // Zero-block entries are legal (directory art); their LSU means nothing.
    if (!isFinite(blocks) || blocks < 0 ||
        (blocks > 0 && (!isFinite(lastBytes) || lastBytes < 1 || lastBytes > 255))) {
      if (fileCount >= 0) {
        return { error: 'Malformed LYNX entry at #' + (idx + 1) + '.' };
      }
      break;
    }
    var entry = { name: nameBytes, typeIdx: typeIdx, blocks: blocks, lastBytes: lastBytes };
    if (typeIdx === FILE_TYPE.REL) entry.recordSize = parseInt(recordTok, 10) || 0;
    entries.push(entry);
    idx++;
  }

  if (entries.length === 0) return { error: 'LYNX archive contains no file entries.' };

  var paddedTotal = dataStart;
  var compactTotal = dataStart;
  for (var ei = 0; ei < entries.length; ei++) {
    paddedTotal += entries[ei].blocks * 254;
    compactTotal += _lnxRealSize(entries[ei]);
  }
  var usePadded = Math.abs(paddedTotal - data.length) <= Math.abs(compactTotal - data.length);

  // Second pass: slice each file's data. A short archive truncates the tail.
  var files = [];
  var dataOff = dataStart;
  for (var fi = 0; fi < entries.length; fi++) {
    var e = entries[fi];
    var realSize = _lnxRealSize(e);
    var avail = data.length - dataOff;
    if (avail <= 0 && realSize > 0) break;
    var take = Math.min(realSize, Math.max(0, avail));
    var fileData = data.subarray(dataOff, dataOff + take);
    dataOff += usePadded ? (e.blocks * 254) : take;
    if (dataOff > data.length) dataOff = data.length;
    var file = { name: e.name, typeIdx: e.typeIdx, blocks: e.blocks, data: fileData };
    // REL data still starts with its side-sector blocks, as LNX stores them.
    if (e.recordSize !== undefined) file.recordSize = e.recordSize;
    files.push(file);
  }

  return { files: files, comment: comment };
}

// The LSU follows the CBM convention: bytes used in the last block + 1.
function _lnxRealSize(e) {
  return e.blocks === 0 ? 0 : (e.blocks - 1) * 254 + (e.lastBytes - 1);
}

// Type token -> FILE_TYPE index (first letter of P/S/U/R/D), or -1.
function _lnxTypeIdx(tok) {
  var c = tok.replace(/^\s+/, '').charAt(0).toUpperCase();
  if (c === 'P') return FILE_TYPE.PRG;
  if (c === 'S') return FILE_TYPE.SEQ;
  if (c === 'U') return FILE_TYPE.USR;
  if (c === 'R') return FILE_TYPE.REL;
  if (c === 'D') return FILE_TYPE.DEL;
  return -1;
}

/** @param {ArrayBuffer} buffer @returns {DiskInfo} */
