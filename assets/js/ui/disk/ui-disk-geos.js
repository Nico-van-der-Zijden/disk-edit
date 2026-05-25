// ── GEOS File Info ────────────────────────────────────────────────────
document.getElementById('opt-view-geos').addEventListener('click', function(e) {
  e.stopPropagation();
  if (!currentBuffer || selectedEntryIndex < 0) return;
  closeMenus();

  var geos = readGeosInfo(currentBuffer, selectedEntryIndex, getCurrentCtx());
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
  if (geos.hasInfoBlock) {
    var infoBlock = readGeosInfoBlock(currentBuffer, geos.infoTrack, geos.infoSector, getCurrentCtx());
    if (infoBlock) {
      if (infoBlock.className) lines.push('Class: ' + infoBlock.className);
      if (infoBlock.author) lines.push('Author: ' + infoBlock.author);
      if (infoBlock.createdBy) lines.push('Created by: ' + infoBlock.createdBy);
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
  if (!currentBuffer || hasGeosSignature(currentBuffer, getCurrentCtx())) return;
  closeMenus();
  pushUndo();
  writeGeosSignature(currentBuffer, getCurrentCtx());
  updateMenuState();
  showModal('Convert to GEOS', ['Disk has been marked as GEOS format.']);
});

// ── Restore DOS Version byte ─────────────────────────────────────────
// D64.TXT / D71.TXT / D81.TXT: BAM +$02 != format's dosVersion and != $00
// triggers "soft write protect" (error 73 "DOS Version"). Restoring it
// to the format's expected byte makes the disk writable on a real drive.
// Format expected bytes: D64/D71 = $41 'A', D81 = $44 'D'.
document.getElementById('opt-restore-dos-version').addEventListener('click', function(e) {
  e.stopPropagation();
  if (!currentBuffer) return;
  var current = isSoftWriteProtected(currentBuffer, getCurrentCtx());
  if (current === null) return;
  closeMenus();
  pushUndo();
  var data = new Uint8Array(currentBuffer);
  var bamOff = sectorOffset(currentFormat.bamTrack, currentFormat.bamSector, getCurrentCtx());
  var target = currentFormat.dosVersion;
  data[bamOff + 0x02] = target;
  updateMenuState();
  parseCurrentDir(currentBuffer);
  showModal('Restore DOS Version', [
    'BAM +$02 changed from $' + hex8(current) + ' to $' + hex8(target) +
      ' ("' + String.fromCharCode(target) + '").',
    'The disk is no longer soft write-protected.'
  ]);
});

// ── View GEOS Border Sector ──────────────────────────────────────────
// Per GEOS.TXT rev 1.4 §"Border Sector": BAM header +$AB/$AC points to
// a 1-sector mini-directory (8 entries max) GEOS uses for cross-disk
// drag-and-drop file staging. Most archived disks have the pointer
// zeroed; populated borders are rare but the data exists on real disks.
document.getElementById('opt-view-border').addEventListener('click', function(e) {
  e.stopPropagation();
  if (!currentBuffer || !hasGeosSignature(currentBuffer, getCurrentCtx())) return;
  closeMenus();

  var ref = readGeosBorderRef(currentBuffer, getCurrentCtx());
  if (!ref) {
    showModal('GEOS Border Sector', [
      'This disk has no GEOS border sector allocated (header +$AB/$AC = $00/$00).',
      '',
      'The border sector is used by GEOS for cross-disk drag-and-drop file staging. ' +
      'A freshly-formatted GEOS disk starts with no border allocated.'
    ]);
    return;
  }

  var entries = readGeosBorderEntries(currentBuffer, getCurrentCtx());
  if (entries.length === 0) {
    showModal('GEOS Border Sector', [
      'Border sector at T:$' + hex8(ref.track) + ' S:$' + hex8(ref.sector) + ' is empty.'
    ]);
    return;
  }

  var data = new Uint8Array(currentBuffer);
  var html = '<div class="text-md mb-md">Border sector at T:$' + hex8(ref.track) +
    ' S:$' + hex8(ref.sector) + ' — ' + entries.length + ' entries</div>';
  html += '<table class="geos-info-table">';
  html += '<tr><th>Type</th><th>Name</th><th>T/S</th><th>Blocks</th><th>GEOS class</th></tr>';
  for (var i = 0; i < entries.length; i++) {
    var ent = entries[i];
    var name = petsciiToReadable(readPetsciiString(data, ent.entryOff + 5, 16)).trim() || '<unnamed>';
    var typeStr = FILE_TYPES[ent.typeIdx] || '?';
    if (!ent.closed) typeStr = '*' + typeStr;
    if (ent.locked) typeStr += '<';
    var geos = readGeosInfo(currentBuffer, ent.entryOff, getCurrentCtx());
    var klass = '';
    if (geos.hasInfoBlock) {
      var ib = readGeosInfoBlock(currentBuffer, geos.infoTrack, geos.infoSector, getCurrentCtx());
      if (ib && ib.className) klass = ib.className;
    }
    html += '<tr>' +
      '<td>' + escHtml(typeStr) + '</td>' +
      '<td><b>' + escHtml(name) + '</b></td>' +
      '<td>$' + hex8(ent.track) + '/$' + hex8(ent.sector) + '</td>' +
      '<td>' + ent.blocks + '</td>' +
      '<td>' + escHtml(klass) + '</td>' +
      '</tr>';
  }
  html += '</table>';
  showModal('GEOS Border Sector', []);
  document.getElementById('modal-body').innerHTML = html;
});

