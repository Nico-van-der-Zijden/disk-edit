// ── Archive readers (gzip + zip + nibtools-LZ) ───────────────────────
// Browser-native gzip via DecompressionStream; minimal hand-rolled ZIP
// reader (central directory + STORED + DEFLATE) so we don't take on a
// library dependency. ZIP64 is not supported — the file inputs we care
// about (collections of disk images, the occasional bundle of PRGs)
// always fit in classic ZIP.
//
// `decompressNbz` is a JS port of `LZ_Uncompress` from nibtools' lz.c
// (Marcus Geelnard, 2003-2006, BSD 3-clause). NBZ files in the C64
// scene are NIBs run through that exact LZ77 variant — not gzip, not
// LZMA — so we have to ship the decoder ourselves.

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
  // NIB output sizes top out around 256 + 84*8192 = 688 KB. Allocate 2MB
  // headroom — fail loudly if a pathological NBZ blows past that.
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
        // The C reference uses a per-byte loop; we keep that to handle
        // overlapping copies (length > offset) where each emitted byte
        // becomes part of the source for later iterations of the same
        // reference (RLE-style behaviour the LZ77 spec requires).
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

// Reads a classic ZIP (PKZIP, no ZIP64) and returns an array of
// { name, data } for every regular-file entry. Directory entries
// (paths ending in '/') are skipped. DEFLATE-compressed entries are
// inflated via DecompressionStream('deflate-raw'); stored entries
// pass through unchanged.
async function parseZip(arrayBuffer) {
  var data = new Uint8Array(arrayBuffer);
  var dv = new DataView(arrayBuffer);

  // Locate End of Central Directory Record. Comment field can be up to
  // 65535 bytes, so scan back from the end looking for the EOCD signature.
  var eocdSig = 0x06054b50;
  var eocdOff = -1;
  for (var i = data.length - 22; i >= Math.max(0, data.length - 65557); i--) {
    if (dv.getUint32(i, true) === eocdSig) { eocdOff = i; break; }
  }
  if (eocdOff < 0) throw new Error('Not a valid ZIP archive (no EOCD record)');

  var totalEntries = dv.getUint16(eocdOff + 10, true);
  var cdSize = dv.getUint32(eocdOff + 12, true);
  var cdOffset = dv.getUint32(eocdOff + 16, true);
  if (cdSize === 0xFFFFFFFF || cdOffset === 0xFFFFFFFF || totalEntries === 0xFFFF) {
    throw new Error('ZIP64 archives are not supported');
  }

  var entries = [];
  var p = cdOffset;
  var cdSig = 0x02014b50;
  for (var n = 0; n < totalEntries; n++) {
    if (p + 46 > data.length) throw new Error('ZIP central directory truncated');
    if (dv.getUint32(p, true) !== cdSig) throw new Error('ZIP central directory entry signature mismatch');

    var method = dv.getUint16(p + 10, true);
    var compSize = dv.getUint32(p + 20, true);
    var uncompSize = dv.getUint32(p + 24, true);
    var nameLen = dv.getUint16(p + 28, true);
    var extraLen = dv.getUint16(p + 30, true);
    var commentLen = dv.getUint16(p + 32, true);
    var localOff = dv.getUint32(p + 42, true);
    var nameBytes = data.subarray(p + 46, p + 46 + nameLen);
    var name = new TextDecoder('utf-8', { fatal: false }).decode(nameBytes);
    p += 46 + nameLen + extraLen + commentLen;

    // Directory entry — skip
    if (name.length === 0 || name.charCodeAt(name.length - 1) === 0x2F) continue;

    if (compSize === 0xFFFFFFFF || uncompSize === 0xFFFFFFFF) {
      throw new Error('ZIP64 entry "' + name + '" not supported');
    }

    // Read the local file header to find the actual data offset — local
    // and central name lengths can differ if extra fields are inserted.
    if (localOff + 30 > data.length) throw new Error('ZIP local header out of range');
    if (dv.getUint32(localOff, true) !== 0x04034b50) {
      throw new Error('ZIP local header signature mismatch for "' + name + '"');
    }
    var lhNameLen = dv.getUint16(localOff + 26, true);
    var lhExtraLen = dv.getUint16(localOff + 28, true);
    var dataStart = localOff + 30 + lhNameLen + lhExtraLen;
    var dataEnd = dataStart + compSize;
    if (dataEnd > data.length) throw new Error('ZIP entry "' + name + '" data out of range');

    var raw = data.subarray(dataStart, dataEnd);
    var out;
    if (method === 0) {
      out = raw.slice().buffer;
    } else if (method === 8) {
      if (typeof DecompressionStream === 'undefined') {
        throw new Error('DecompressionStream not supported (needed to inflate "' + name + '")');
      }
      var blob = new Blob([raw]);
      var stream = blob.stream().pipeThrough(new DecompressionStream('deflate-raw'));
      out = await new Response(stream).arrayBuffer();
    } else {
      throw new Error('Unsupported ZIP compression method (' + method + ') for "' + name + '"');
    }
    // Strip any path component — the picker shows the basename anyway,
    // and the rest of the editor doesn't care about archive paths.
    var basename = name.replace(/^.*\//, '');
    entries.push({ name: basename, data: out });
  }
  return entries;
}
