// ── TAR archive reader ────────────────────────────────────────────────
// USTAR / GNU. Tar has no compression, so this is pure header walking;
// .tar.gz / .tgz are gunzipped by the caller first. 512-byte header, then
// file data padded to the next 512 boundary. Field offsets used below:
// $07C size (octal), $09C type flag, $101 magic, $159 USTAR name prefix.

var TAR_BLOCK = 512;

/** Read a NUL/space-terminated ASCII field. */
function _tarStr(data, off, len) {
  var end = off;
  var limit = off + len;
  while (end < limit && data[end] !== 0x00) end++;
  var s = '';
  for (var i = off; i < end; i++) s += String.fromCharCode(data[i]);
  return s.replace(/[\s\0]+$/, '');
}

/** Parse an octal numeric field. GNU base-256 (high bit set) is rejected. */
function _tarOctal(data, off, len) {
  if (data[off] & 0x80) return -1;            // base-256 encoding, unsupported
  var s = _tarStr(data, off, len).trim();
  if (s === '') return 0;
  var n = parseInt(s, 8);
  return isNaN(n) ? -1 : n;
}

/** True when a whole 512-byte block is zero (end-of-archive marker). */
function _tarBlockIsZero(data, off) {
  for (var i = 0; i < TAR_BLOCK; i++) if (data[off + i] !== 0) return false;
  return true;
}

// Returns { entries, skipped } or { error }. Entries are
// { name, data: ArrayBuffer } — the same shape parseZip produces, so the
// archive picker can treat every container type identically.
function parseTar(arrayBuffer) {
  var data = new Uint8Array(arrayBuffer);
  if (data.length < TAR_BLOCK) return { error: 'Too small to be a tar archive.' };

  var entries = [], skipped = [];
  var pos = 0;
  var longName = null;                          // pending GNU 'L' long name
  var sawHeader = false;

  while (pos + TAR_BLOCK <= data.length) {
    if (_tarBlockIsZero(data, pos)) break;      // end of archive

    var name = _tarStr(data, pos, 100);
    var size = _tarOctal(data, pos + 0x7C, 12);
    var type = data[pos + 0x9C];
    var magic = _tarStr(data, pos + 0x101, 6);
    var prefix = _tarStr(data, pos + 0x159, 155);

    // Ancient tars carry no magic at all, so accept an empty one.
    var looksTar = magic === 'ustar' || magic === 'ustar  ' || magic === '';
    if (size < 0 || !looksTar) {
      if (!sawHeader) return { error: 'Not a tar archive (bad header at offset ' + pos + ').' };
      break;                                    // trailing junk after real members
    }
    sawHeader = true;
    pos += TAR_BLOCK;

    var dataEnd = pos + size;
    if (dataEnd > data.length) {
      skipped.push({ name: name || '(unnamed)', reason: 'truncated' });
      break;
    }

    var typeChar = type === 0 ? '0' : String.fromCharCode(type);
    if (typeChar === 'L') {
      // GNU long name: this member's data is the next member's name.
      longName = _tarStr(data, pos, size);
    } else if (typeChar === '0' || typeChar === '7') {   // regular / contiguous
      var full = longName || (prefix ? prefix + '/' + name : name);
      longName = null;
      var base = full.replace(/^.*[\/\\]/, '');
      if (base === '') {
        skipped.push({ name: full, reason: 'no file name' });
      } else {
        entries.push({ name: base, data: data.slice(pos, dataEnd).buffer });
      }
    } else if (typeChar === '5') {
      longName = null;                          // directory, nothing to extract
    } else {
      longName = null;
      skipped.push({ name: name || '(unnamed)', reason: 'member type "' + typeChar + '"' });
    }

    pos = dataEnd + ((TAR_BLOCK - (size % TAR_BLOCK)) % TAR_BLOCK);
  }

  if (entries.length === 0 && skipped.length === 0) {
    return { error: 'No files found in the tar archive.' };
  }
  return { entries: entries, skipped: skipped };
}
