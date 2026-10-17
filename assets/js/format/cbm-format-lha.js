// ── LHA / LZH archive reader ──────────────────────────────────────────
// Spec: disks/FORMATS/LHA.TXT rev 1.3. Handles -lh0- (stored), -lh5-
// (LZSS + static Huffman, 8 KB dictionary) and -lhd- (directory); other
// methods and header levels 2+ are reported rather than guessed at.
// Header: $00 size, $02 method id, $07 packed, $0B original, $14 level,
// $15 name length, then name and a CRC-16 of the original data.

var LHA_DICT_BITS = 13;                 // -lh5- : 8192-byte dictionary
var LHA_NC = 510;                       // literal/length alphabet
var LHA_NP = LHA_DICT_BITS + 1;         // position alphabet (14)
var LHA_NT = 19;                        // code-length alphabet
var LHA_CBIT = 9;
var LHA_PBIT = 4;
var LHA_TBIT = 5;
var LHA_THRESHOLD = 3;                  // shortest encoded match

// ── bit reader (MSB first) ───────────────────────────────────────────
function _lhaBitReader(data, start, end) {
  return {
    data: data, pos: start, end: end, bit: 0,
    /** Next single bit; reads 0 past the end so a truncated member just
     *  stops producing useful data instead of throwing. */
    readBit: function() {
      if (this.pos >= this.end) return 0;
      var b = (this.data[this.pos] >> (7 - this.bit)) & 1;
      if (++this.bit === 8) { this.bit = 0; this.pos++; }
      return b;
    },
    readBits: function(n) {
      var v = 0;
      for (var i = 0; i < n; i++) v = (v << 1) | this.readBit();
      return v;
    },
    exhausted: function() { return this.pos >= this.end; },
  };
}

// ── canonical Huffman ────────────────────────────────────────────────
// Bit-at-a-time decoding, far simpler than LHA's make_table()/left/right
// machinery and fast enough here. `constant` is LHA's degenerate table:
// one symbol, consuming no input bits.
function _lhaBuildHuffman(lens, n) {
  var blCount = new Array(17).fill(0);
  var i;
  for (i = 0; i < n; i++) if (lens[i] > 0) blCount[lens[i]]++;
  var nextCode = new Array(17).fill(0), code = 0;
  for (var len = 1; len <= 16; len++) {
    code = (code + blCount[len - 1]) << 1;
    nextCode[len] = code;
  }
  var table = {};
  for (i = 0; i < n; i++) {
    if (lens[i] > 0) table[(lens[i] << 16) | nextCode[lens[i]]++] = i;
  }
  return { table: table, constant: -1 };
}

function _lhaConstantHuffman(sym) {
  return { table: {}, constant: sym };
}

function _lhaDecodeSym(br, huff) {
  if (huff.constant >= 0) return huff.constant;
  var code = 0;
  for (var len = 1; len <= 16; len++) {
    code = (code << 1) | br.readBit();
    var s = huff.table[(len << 16) | code];
    if (s !== undefined) return s;
  }
  return -1;                            // corrupt stream
}

// ── -lh5- table readers ──────────────────────────────────────────────
// Code lengths are themselves compressed: 3 bits, extended by a run of
// 1-bits when it reads 7. After `iSpecial`, 2 bits give a count of zeros.
function _lhaReadPtLen(br, nn, nbit, iSpecial) {
  var lens = new Array(nn).fill(0);
  var n = br.readBits(nbit);
  if (n === 0) return { huff: _lhaConstantHuffman(br.readBits(nbit)), lens: lens };
  var i = 0;
  while (i < n && i < nn) {
    var c = br.readBits(3);
    if (c === 7) while (br.readBit() === 1) c++;
    lens[i++] = c;
    if (i === iSpecial) {
      var zeros = br.readBits(2);
      while (zeros-- > 0 && i < nn) lens[i++] = 0;
    }
  }
  return { huff: _lhaBuildHuffman(lens, nn), lens: lens };
}

// Decoded through the T table just read: symbols 0-2 are runs of zero
// lengths, anything else is a length of (sym - 2).
function _lhaReadCLen(br, tHuff) {
  var lens = new Array(LHA_NC).fill(0);
  var n = br.readBits(LHA_CBIT);
  if (n === 0) return _lhaConstantHuffman(br.readBits(LHA_CBIT));
  var i = 0;
  while (i < n && i < LHA_NC) {
    var c = _lhaDecodeSym(br, tHuff);
    if (c < 0) return null;
    if (c <= 2) {
      var run;
      if (c === 0) run = 1;
      else if (c === 1) run = br.readBits(4) + 3;
      else run = br.readBits(LHA_CBIT) + 20;
      while (run-- > 0 && i < LHA_NC) lens[i++] = 0;
    } else {
      lens[i++] = c - 2;
    }
  }
  return _lhaBuildHuffman(lens, LHA_NC);
}

// Largest member we will allocate for. The size field is untrusted; anything
// bigger than the largest CMD HD image is a corrupt header, not a real file.
var LHA_MAX_MEMBER = 256 * 1024 * 1024;

// Decode one -lh5- member into `origSize` bytes.
function _lhaDecodeLh5(data, start, end, origSize) {
  var out;
  try { out = new Uint8Array(origSize); } catch (e) { return { error: 'declared size too large' }; }
  var br = _lhaBitReader(data, start, end);
  var outPos = 0, blockSize = 0;
  var cHuff = null, pHuff = null;

  while (outPos < origSize) {
    if (blockSize === 0) {
      if (br.exhausted()) break;
      blockSize = br.readBits(16);
      if (blockSize === 0) break;
      var t = _lhaReadPtLen(br, LHA_NT, LHA_TBIT, 3);
      cHuff = _lhaReadCLen(br, t.huff);
      if (!cHuff) return { error: 'corrupt literal table' };
      pHuff = _lhaReadPtLen(br, LHA_NP, LHA_PBIT, -1).huff;
    }
    blockSize--;

    var c = _lhaDecodeSym(br, cHuff);
    if (c < 0) return { error: 'corrupt literal code' };

    if (c < 256) {
      out[outPos++] = c;
    } else {
      var len = c - 256 + LHA_THRESHOLD;
      var p = _lhaDecodeSym(br, pHuff);
      if (p < 0) return { error: 'corrupt position code' };
      if (p !== 0) p = (1 << (p - 1)) + br.readBits(p - 1);
      var from = outPos - p - 1;
      if (from < 0) return { error: 'match before start of data' };
      for (var k = 0; k < len && outPos < origSize; k++) out[outPos++] = out[from++];
    }
  }

  var consumed = (br.pos - start) + (br.bit > 0 ? 1 : 0);
  return {
    data: out,
    consumed: consumed,
    short: outPos < origSize ? origSize - outPos : 0,
  };
}

// ── header walking ───────────────────────────────────────────────────
// CRC-16 (poly $A001) of the original data, stored in each header. It is
// what turns a mis-decode into a reported error rather than a bad file.
function _lhaCrc16(data) {
  var crc = 0;
  for (var i = 0; i < data.length; i++) {
    crc ^= data[i];
    for (var b = 0; b < 8; b++) {
      crc = (crc & 1) ? ((crc >>> 1) ^ 0xA001) : (crc >>> 1);
    }
  }
  return crc & 0xFFFF;
}

function _lhaName(data, off, len) {
  var s = '';
  for (var i = 0; i < len; i++) s += String.fromCharCode(data[off + i]);
  // LHA stores paths with $FF (or backslash) separators; keep the basename.
  return s.replace(/^.*[\xFF\\\/]/, '');
}

// True when `p` is a plausible place for the next header: end of data, the
// zero terminator, or a method id two bytes in.
function _lhaHeaderAt(data, p) {
  if (p >= data.length || data[p] === 0) return true;
  if (p + 7 > data.length) return false;
  var m = '';
  for (var i = 0; i < 5; i++) m += String.fromCharCode(data[p + 2 + i]);
  return /^-l[hz][0-9d]-$/.test(m);
}

// Returns { entries, skipped } or { error }; entries match the
// { name, data } shape of parseZip/parseTar.
function parseLha(arrayBuffer) {
  var data = new Uint8Array(arrayBuffer);
  var entries = [], skipped = [];
  var pos = 0, sawHeader = false;

  while (pos + 21 < data.length) {
    var headerSize = data[pos];
    if (headerSize === 0) break;                    // end of archive

    var method = '';
    for (var m = 0; m < 5; m++) method += String.fromCharCode(data[pos + 2 + m]);
    if (!/^-l[hz][0-9d]-$/.test(method)) {
      if (!sawHeader) return { error: 'Not an LHA archive (no method id at offset ' + pos + ').' };
      break;
    }

    var dv = new DataView(arrayBuffer);
    var packedSize = dv.getUint32(pos + 7, true);
    var origSize = dv.getUint32(pos + 11, true);
    var level = data[pos + 20];
    var name, dataStart, nextPos, skipFallback = -1;

    var headerCrc = -1;
    if (level === 0) {
      var nameLen = data[pos + 21];
      name = _lhaName(data, pos + 22, nameLen);
      if (pos + 22 + nameLen + 1 < data.length) {
        headerCrc = dv.getUint16(pos + 22 + nameLen, true);
      }
      dataStart = pos + 2 + headerSize;
      nextPos = dataStart + packedSize;
    } else if (level === 1) {
      var nameLen1 = data[pos + 21];
      name = _lhaName(data, pos + 22, nameLen1);
      if (pos + 22 + nameLen1 + 1 < data.length) {
        headerCrc = dv.getUint16(pos + 22 + nameLen1, true);
      }
      // The base header size at $00 *includes* the first extended header's
      // size field, so the chain starts at $19+nameLen — not 2+headerSize,
      // which is already 2 bytes past it. A zero size ends the chain.
      var cur = pos + 25 + nameLen1;
      while (cur + 1 < data.length) {
        var extSize = dv.getUint16(cur, true);
        if (extSize === 0) { cur += 2; break; }
        cur += extSize;
      }
      dataStart = cur;
      // Producers disagree on whether "skip size" covers the extended
      // headers, so decode to the end and advance by what was consumed;
      // when nothing is consumed, take whichever reading lands on a header.
      var spec = pos + 2 + headerSize + packedSize;
      var plain = dataStart + packedSize;
      if (_lhaHeaderAt(data, spec)) skipFallback = spec;
      else if (_lhaHeaderAt(data, plain)) skipFallback = plain;
      packedSize = data.length - dataStart;
      nextPos = -1;
    } else {
      skipped.push({ name: '(header level ' + level + ')', reason: 'unsupported header level' });
      break;                                        // can't find the next header safely
    }
    sawHeader = true;

    if (nextPos > data.length || packedSize < 0) {
      skipped.push({ name: name || '(unnamed)', reason: 'truncated' });
      break;
    }

    var out = null;
    if (method === '-lhd-') {
      // Directory entry, no payload.
      if (nextPos < 0) nextPos = dataStart;
    } else if (origSize > LHA_MAX_MEMBER) {
      skipped.push({ name: name || '(unnamed)', reason: 'declared size too large' });
    } else if (method === '-lh0-') {
      // Stored: packed length is the original length by definition, which is
      // also the level-1 answer without trusting its size fields.
      if (dataStart + origSize > data.length) {
        skipped.push({ name: name || '(unnamed)', reason: 'truncated' });
        break;
      }
      out = data.slice(dataStart, dataStart + origSize);
      if (nextPos < 0) nextPos = dataStart + origSize;
    } else if (method === '-lh5-') {
      var res = _lhaDecodeLh5(data, dataStart, dataStart + packedSize, origSize);
      if (res.error) {
        skipped.push({ name: name || '(unnamed)', reason: res.error });
      } else if (res.short) {
        skipped.push({ name: name || '(unnamed)', reason: res.short + ' bytes short of the declared size' });
      } else {
        out = res.data;
        if (nextPos < 0) nextPos = dataStart + res.consumed;
      }
    } else {
      skipped.push({ name: name || '(unnamed)', reason: 'method ' + method + ' not supported' });
    }

    if (out) {
      if (headerCrc >= 0 && _lhaCrc16(out) !== headerCrc) {
        skipped.push({ name: name || '(unnamed)', reason: 'CRC mismatch — decoded data is wrong' });
      } else {
        entries.push({ name: name, data: out.buffer });
      }
    }

    if (nextPos < 0) nextPos = skipFallback;
    // Never move backwards or stand still — a level-1 member we couldn't
    // size means we can't safely find the next header, so stop cleanly.
    if (nextPos <= pos) break;
    pos = nextPos;
  }

  if (entries.length === 0 && skipped.length === 0) {
    return { error: 'No files found in the LHA archive.' };
  }
  return { entries: entries, skipped: skipped };
}
