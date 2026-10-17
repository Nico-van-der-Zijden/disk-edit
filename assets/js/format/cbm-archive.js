// ── Archive readers (gzip + zip + nibtools-LZ) ───────────────────────
// Browser-native gzip via DecompressionStream; minimal hand-rolled ZIP
// reader (central directory + STORED + DEFLATE) so we don't take on a
// library dependency. ZIP64 is not supported.
//
// `decompressNbz` is a JS port of `LZ_Uncompress` from nibtools' lz.c
// (Marcus Geelnard, 2003-2006, BSD 3-clause). NBZ files are NIBs run
// through that exact LZ77 variant, so we ship the decoder ourselves.

async function decompressGzip(arrayBuffer) {
  if (typeof DecompressionStream === 'undefined') {
    throw new Error('DecompressionStream not supported by this browser');
  }
  var blob = new Blob([arrayBuffer]);
  var stream = blob.stream().pipeThrough(new DecompressionStream('gzip'));
  return await new Response(stream).arrayBuffer();
}

// LZ77 stream format (per nibtools' lz.c):
//   byte 0           = marker symbol (chosen at compress time as a
//                       byte that's rare in the input)
//   byte sequence    = literal symbols, OR
//                      [marker, 0]                 — escaped literal marker
//                      [marker, len-varint, off-varint] — back-reference
//   varint           = big-endian, 7 bits per byte, MSB=1 means "another
//                       byte follows", MSB=0 marks the last byte
function decompressNbz(arrayBuffer) {
  var input = new Uint8Array(arrayBuffer);
  if (input.length < 1) return new Uint8Array(0).buffer;

  var marker = input[0];
  var inpos = 1;
  // NIB output sizes top out around 256 + 84*8192 = 688 KB.
  var MAX_OUT = 2 * 1024 * 1024;
  var out = new Uint8Array(MAX_OUT);
  var outpos = 0;

  function readVarSize() {
    var y = 0, b;
    do {
      if (inpos >= input.length) throw new Error('NBZ stream truncated mid-varint');
      b = input[inpos++];
      y = (y << 7) | (b & 0x7F);
    } while (b & 0x80);
    return y;
  }

  while (inpos < input.length) {
    var symbol = input[inpos++];
    if (symbol === marker) {
      if (inpos >= input.length) throw new Error('NBZ stream truncated after marker');
      if (input[inpos] === 0) {
        // Literal occurrence of the marker byte.
        if (outpos >= MAX_OUT) throw new Error('NBZ output exceeds 2 MB cap');
        out[outpos++] = marker;
        inpos++;
      } else {
        var length = readVarSize();
        var offset = readVarSize();
        if (offset > outpos) throw new Error('NBZ back-reference offset before start of output');
        if (outpos + length > MAX_OUT) throw new Error('NBZ output exceeds 2 MB cap');
        // Byte-by-byte so overlapping copies (length > offset) repeat.
        for (var i = 0; i < length; i++) {
          out[outpos] = out[outpos - offset];
          outpos++;
        }
      }
    } else {
      if (outpos >= MAX_OUT) throw new Error('NBZ output exceeds 2 MB cap');
      out[outpos++] = symbol;
    }
  }

  return out.slice(0, outpos).buffer;
}

// ── CRC-32 (IEEE, reflected, poly $EDB88320) ─────────────────────────
var _crc32Table = null;

/** @param {Uint8Array} data @returns {number} unsigned CRC-32 */
function crc32(data) {
  if (!_crc32Table) {
    _crc32Table = new Uint32Array(256);
    for (var n = 0; n < 256; n++) {
      var c = n;
      for (var k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      _crc32Table[n] = c >>> 0;
    }
  }
  var crc = 0xFFFFFFFF;
  for (var i = 0; i < data.length; i++) crc = _crc32Table[(crc ^ data[i]) & 0xFF] ^ (crc >>> 8);
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

// Largest member we will inflate. The size fields are untrusted.
var ZIP_MAX_MEMBER = 256 * 1024 * 1024;

// Inflate a raw DEFLATE stream, giving up once it passes `limit` bytes.
// Returns a Uint8Array, or null when the stream outgrows the limit.
async function _zipInflate(raw, limit) {
  var reader = new Blob([raw]).stream()
    .pipeThrough(new DecompressionStream('deflate-raw')).getReader();
  var chunks = [], total = 0;
  for (;;) {
    var r = await reader.read();
    if (r.done) break;
    total += r.value.length;
    if (total > limit) {
      try { await reader.cancel(); } catch (e) { /* already failed */ }
      return null;
    }
    chunks.push(r.value);
  }
  var out = new Uint8Array(total);
  var o = 0;
  for (var i = 0; i < chunks.length; i++) { out.set(chunks[i], o); o += chunks[i].length; }
  return out;
}

// Reads a classic ZIP (PKZIP, no ZIP64). Returns { entries, skipped } or
// { error }, the same shape as parseTar/parseLha: entries are
// { name, data: ArrayBuffer } (basename only, directories dropped) and a
// damaged member lands in `skipped` with a reason instead of failing the
// whole archive.
async function parseZip(arrayBuffer) {
  var data = new Uint8Array(arrayBuffer);
  var dv = new DataView(arrayBuffer);

  // The EOCD sits before a comment of up to 65535 bytes, so scan back.
  var eocdOff = -1;
  for (var i = data.length - 22; i >= Math.max(0, data.length - 65557); i--) {
    if (dv.getUint32(i, true) === 0x06054b50) { eocdOff = i; break; }
  }
  if (eocdOff < 0) return { error: 'Not a valid ZIP archive (no EOCD record)' };

  var totalEntries = dv.getUint16(eocdOff + 10, true);
  var cdSize = dv.getUint32(eocdOff + 12, true);
  var cdOffset = dv.getUint32(eocdOff + 16, true);
  if (cdSize === 0xFFFFFFFF || cdOffset === 0xFFFFFFFF || totalEntries === 0xFFFF) {
    return { error: 'ZIP64 archives are not supported' };
  }

  var entries = [], skipped = [];
  var p = cdOffset;
  for (var n = 0; n < totalEntries; n++) {
    if (p + 46 > data.length || dv.getUint32(p, true) !== 0x02014b50) {
      skipped.push({ name: '(central directory)', reason: 'damaged after ' + n + ' entries' });
      break;
    }

    var method = dv.getUint16(p + 10, true);
    var crc = dv.getUint32(p + 16, true);
    var compSize = dv.getUint32(p + 20, true);
    var uncompSize = dv.getUint32(p + 24, true);
    var nameLen = dv.getUint16(p + 28, true);
    var extraLen = dv.getUint16(p + 30, true);
    var commentLen = dv.getUint16(p + 32, true);
    var localOff = dv.getUint32(p + 42, true);
    var name = new TextDecoder('utf-8', { fatal: false })
      .decode(data.subarray(p + 46, Math.min(data.length, p + 46 + nameLen)));
    p += 46 + nameLen + extraLen + commentLen;

    var last = name.charCodeAt(name.length - 1);
    if (name.length === 0 || last === 0x2F || last === 0x5C) continue;   // directory
    var basename = name.replace(/^.*[\/\\]/, '');
    var skip = function(reason) { skipped.push({ name: basename, reason: reason }); };

    if (compSize === 0xFFFFFFFF || uncompSize === 0xFFFFFFFF) { skip('ZIP64 entry'); continue; }
    if (uncompSize > ZIP_MAX_MEMBER) { skip('declared size too large'); continue; }

    // Local and central name/extra lengths can differ, so read the local header.
    if (localOff + 30 > data.length || dv.getUint32(localOff, true) !== 0x04034b50) {
      skip('local header missing'); continue;
    }
    var dataStart = localOff + 30 + dv.getUint16(localOff + 26, true) + dv.getUint16(localOff + 28, true);
    var dataEnd = dataStart + compSize;
    if (dataEnd > data.length) { skip('truncated'); continue; }

    var raw = data.subarray(dataStart, dataEnd);
    var out;
    if (method === 0) {
      out = raw.slice();
    } else if (method === 8) {
      if (typeof DecompressionStream === 'undefined') {
        return { error: 'DecompressionStream not supported (needed to inflate "' + name + '")' };
      }
      try {
        out = await _zipInflate(raw, uncompSize);
      } catch (e) {
        skip('corrupt DEFLATE data'); continue;
      }
      if (!out) { skip('inflates past its declared size'); continue; }
    } else {
      skip('compression method ' + method + ' not supported'); continue;
    }

    if (out.length !== uncompSize || crc32(out) !== crc) {
      skip('CRC mismatch — decoded data is wrong'); continue;
    }
    entries.push({ name: basename, data: out.buffer });
  }

  if (entries.length === 0 && skipped.length === 0) {
    return { error: 'No files found in the ZIP archive.' };
  }
  return { entries: entries, skipped: skipped };
}

// Minimal ZIP builder (store-only, no compression)
function buildZip(files) {
  var localHeaders = [], centralHeaders = [], offset = 0;
  for (var i = 0; i < files.length; i++) {
    var f = files[i];
    var nameBytes = new TextEncoder().encode(f.name);
    var crc = crc32(f.data);
    // Local file header (30 + name + data)
    var lh = new Uint8Array(30 + nameBytes.length + f.data.length);
    var v = new DataView(lh.buffer);
    v.setUint32(0, 0x04034b50, true); // signature
    v.setUint16(4, 20, true); // version needed
    v.setUint16(8, 0, true); // method: store
    v.setUint32(14, crc, true);
    v.setUint32(18, f.data.length, true); // compressed size
    v.setUint32(22, f.data.length, true); // uncompressed size
    v.setUint16(26, nameBytes.length, true); // name length
    lh.set(nameBytes, 30);
    lh.set(f.data, 30 + nameBytes.length);
    localHeaders.push(lh);
    // Central directory header (46 + name)
    var ch = new Uint8Array(46 + nameBytes.length);
    var cv = new DataView(ch.buffer);
    cv.setUint32(0, 0x02014b50, true); // signature
    cv.setUint16(4, 20, true); // version made by
    cv.setUint16(6, 20, true); // version needed
    cv.setUint16(10, 0, true); // method: store
    cv.setUint32(16, crc, true);
    cv.setUint32(20, f.data.length, true); // compressed
    cv.setUint32(24, f.data.length, true); // uncompressed
    cv.setUint16(28, nameBytes.length, true); // name length
    cv.setUint32(42, offset, true); // local header offset
    ch.set(nameBytes, 46);
    centralHeaders.push(ch);
    offset += lh.length;
  }
  var centralStart = offset;
  var centralSize = 0;
  for (var ci = 0; ci < centralHeaders.length; ci++) centralSize += centralHeaders[ci].length;
  // End of central directory (22 bytes)
  var eocd = new Uint8Array(22);
  var ev = new DataView(eocd.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, files.length, true); // entries on disk
  ev.setUint16(10, files.length, true); // total entries
  ev.setUint32(12, centralSize, true);
  ev.setUint32(16, centralStart, true);
  // Combine
  var total = offset + centralSize + 22;
  var zip = new Uint8Array(total);
  var pos = 0;
  for (var li = 0; li < localHeaders.length; li++) { zip.set(localHeaders[li], pos); pos += localHeaders[li].length; }
  for (var di = 0; di < centralHeaders.length; di++) { zip.set(centralHeaders[di], pos); pos += centralHeaders[di].length; }
  zip.set(eocd, pos);
  return zip;
}
