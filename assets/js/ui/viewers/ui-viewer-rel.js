// ── REL file viewer ──────────────────────────────────────────────────
function showRelViewer(entryOff) {
  if (!currentBuffer) return;
  var data = new Uint8Array(currentBuffer);
  var name = petsciiToReadable(readPetsciiString(data, entryOff + 5, 16)).trim();
  var recordLen = data[entryOff + 0x1C]; // record length from dir entry
  if (recordLen === 0) recordLen = 254;

  // Read file data (follows the data chain)
  var result = readFileData(currentBuffer, entryOff);
  var fileData = result.data;
  if (fileData.length === 0) {
    showModal('REL View', ['No data found or empty file.']);
    return;
  }

  // Split into records
  var numRecords = Math.ceil(fileData.length / recordLen);
  var html = '<div style="overflow-y:auto">';

  for (var ri = 0; ri < numRecords; ri++) {
    var recStart = ri * recordLen;
    var recEnd = Math.min(recStart + recordLen, fileData.length);
    if (recStart >= fileData.length) break;

    html += '<div class="rel-record">';
    html += '<span class="rel-record-num">#' + (ri + 1) + '</span>';

    // Hex bytes
    var hexStr = '';
    var asciiStr = '';
    for (var bi = recStart; bi < recEnd; bi++) {
      var b = fileData[bi];
      hexStr += b.toString(16).toUpperCase().padStart(2, '0') + ' ';
      asciiStr += (b >= 0x20 && b <= 0x7E) ? String.fromCharCode(b) :
        (b >= 0xC1 && b <= 0xDA) ? String.fromCharCode(b - 0x80) : '\u00B7';
    }

    html += '<span class="rel-record-hex">' + escHtml(hexStr.trim()) + '</span>';
    html += '<span class="rel-record-ascii">' + escHtml(asciiStr) + '</span>';
    html += '</div>';
  }
  html += '</div>';

  showViewerModal(
    'REL Records \u2014 "' + name + '" (record length: ' + recordLen + ', ' + numRecords + ' records)',
    html
  );
}

