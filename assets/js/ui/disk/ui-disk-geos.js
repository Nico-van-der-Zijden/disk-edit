// ── GEOS File Info ────────────────────────────────────────────────────
document.getElementById('opt-view-geos').addEventListener('click', function(e) {
  e.stopPropagation();
  if (!currentBuffer || selectedEntryIndex < 0) return;
  closeMenus();

  var geos = readGeosInfo(currentBuffer, selectedEntryIndex);
  if (!geos.isGeos) {
    showModal('GEOS Info', ['This file is not a GEOS file.']);
    return;
  }

  var data = new Uint8Array(currentBuffer);
  var readableName = decodeGeosString(data, selectedEntryIndex + 5, 16);

  var lines = [];
  lines.push('File: ' + readableName);
  lines.push('GEOS Type: ' + geos.fileTypeName);
  lines.push('Structure: ' + geos.structureName);
  if (geos.date) lines.push('Date: ' + geos.date);

  // Try to read the info block
  if (geos.infoTrack > 0) {
    var infoBlock = readGeosInfoBlock(currentBuffer, geos.infoTrack, geos.infoSector);
    if (infoBlock) {
      if (infoBlock.className) lines.push('Class: ' + infoBlock.className);
      lines.push('Load: $' + hex16(infoBlock.loadAddr) +
        ' End: $' + hex16(infoBlock.endAddr) +
        ' Init: $' + hex16(infoBlock.initAddr));
      if (infoBlock.description) lines.push('Description: ' + infoBlock.description);
    }
    lines.push('Info Block: T:$' + hex8(geos.infoTrack) + ' S:$' + hex8(geos.infoSector));
  }

  // Build HTML
  var html = '';

  // Render GEOS icon if available
  var iconCanvas = null;
  if (infoBlock && infoBlock.iconData && infoBlock.iconW > 0 && infoBlock.iconH > 0) {
    iconCanvas = document.createElement('canvas');
    iconCanvas.width = infoBlock.iconW;
    iconCanvas.height = infoBlock.iconH;
    var ictx = iconCanvas.getContext('2d');
    var img = ictx.createImageData(infoBlock.iconW, infoBlock.iconH);
    var px = img.data;
    var bytesPerRow = infoBlock.iconW / 8;
    for (var iy = 0; iy < infoBlock.iconH; iy++) {
      for (var bx = 0; bx < bytesPerRow; bx++) {
        var byt = infoBlock.iconData[iy * bytesPerRow + bx];
        for (var bit = 7; bit >= 0; bit--) {
          var ix = bx * 8 + (7 - bit);
          var off = (iy * infoBlock.iconW + ix) * 4;
          var on = byt & (1 << bit);
          px[off] = on ? 0 : 255;
          px[off + 1] = on ? 0 : 255;
          px[off + 2] = on ? 0 : 255;
          px[off + 3] = 255;
        }
      }
    }
    ictx.putImageData(img, 0, 0);
  }

  html += '<table class="geos-info-table">';
  for (var i = 0; i < lines.length; i++) {
    var parts = lines[i].split(': ');
    if (i === 0 && iconCanvas) {
      // First row: icon + file name
      var label = parts[0];
      var value = parts.slice(1).join(': ');
      html += '<tr><td class="geos-info-label">' + escHtml(label) +
        '</td><td class="geos-info-value"><span class="geos-info-name-row" id="geos-icon-row">' +
        escHtml(value) + '</span></td></tr>';
    } else if (parts.length >= 2) {
      var label2 = parts[0];
      var value2 = parts.slice(1).join(': ');
      html += '<tr><td class="geos-info-label">' +
        escHtml(label2) + '</td><td class="geos-info-value">' + escHtml(value2) + '</td></tr>';
    } else {
      html += '<tr><td colspan="2" class="geos-info-value">' + escHtml(lines[i]) + '</td></tr>';
    }
  }
  html += '</table>';

  showModal('GEOS File Info', []);
  var body = document.getElementById('modal-body');
  body.innerHTML = html;

  // Insert icon canvas into the name row
  if (iconCanvas) {
    var nameRow = document.getElementById('geos-icon-row');
    if (nameRow) {
      iconCanvas.className = 'geos-icon';
      nameRow.insertBefore(iconCanvas, nameRow.firstChild);
    }
  }
});

// ── Convert to GEOS ──────────────────────────────────────────────────
document.getElementById('opt-convert-geos').addEventListener('click', function(e) {
  e.stopPropagation();
  if (!currentBuffer || hasGeosSignature(currentBuffer)) return;
  closeMenus();
  pushUndo();
  writeGeosSignature(currentBuffer);
  updateMenuState();
  showModal('Convert to GEOS', ['Disk has been marked as GEOS format.']);
});

