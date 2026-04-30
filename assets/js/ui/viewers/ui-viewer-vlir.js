// ── VLIR Layout inspector ────────────────────────────────────────────
// Structural diagnostic view of a GEOS VLIR file: summary + icon + a
// per-slot record table (127 index entries), with empty runs collapsed.
function showVlirInspector(entryOff) {
  if (!currentBuffer) return;
  var data = new Uint8Array(currentBuffer);
  if (!isVlirFile(data, entryOff)) {
    showModal('VLIR Layout', ['This file is not a GEOS VLIR file.']);
    return;
  }

  var fmt = currentFormat;
  var name = petsciiToReadable(readPetsciiString(data, entryOff + 5, 16)).trim() || '<unnamed>';
  var geos = readGeosInfo(currentBuffer, entryOff);
  var infoBlock = (geos.infoTrack > 0) ? readGeosInfoBlock(currentBuffer, geos.infoTrack, geos.infoSector) : null;

  var indexT = data[entryOff + 3];
  var indexS = data[entryOff + 4];
  var idxOff = sectorOffset(indexT, indexS);
  if (idxOff < 0) {
    showModal('VLIR Layout', ['Index sector T/S ' + indexT + '/' + indexS + ' is out of range.']);
    return;
  }

  // Walk each of the 127 index slots. A slot is:
  //   00/00 = end marker (and all slots after it are unused)
  //   00/FF = empty slot
  //   t/s   = populated; follow the sector chain
  var slots = [];
  var endMarkerSlot = -1;
  var totalRecordBlocks = 0;
  var totalRecordBytes = 0;
  var chainIssues = 0;

  for (var si = 0; si < 127; si++) {
    var recT = data[idxOff + 2 + si * 2];
    var recS = data[idxOff + 2 + si * 2 + 1];
    var entry = { slot: si, t: recT, s: recS, chain: [], blocks: 0, bytes: 0, status: 'empty', issue: null };

    if (endMarkerSlot >= 0) {
      entry.status = 'past-end';
      slots.push(entry);
      continue;
    }
    if (recT === 0 && recS === 0) {
      entry.status = 'end';
      endMarkerSlot = si;
      slots.push(entry);
      continue;
    }
    if (recT === 0 && recS === 0xFF) {
      entry.status = 'empty';
      slots.push(entry);
      continue;
    }
    if (recT < 1 || recT > currentTracks || recS >= fmt.sectorsPerTrack(recT)) {
      entry.status = 'bad-start';
      entry.issue = 'Start T/S out of range';
      chainIssues++;
      slots.push(entry);
      continue;
    }

    entry.status = 'used';
    var visited = Object.create(null);
    var walkT = recT, walkS = recS;
    var bytes = 0;
    var safety = 0;
    while (walkT !== 0) {
      if (walkT < 1 || walkT > currentTracks || walkS >= fmt.sectorsPerTrack(walkT)) {
        entry.issue = 'Chain leaves valid range at $' + hex8(walkT) + '/$' + hex8(walkS);
        chainIssues++;
        break;
      }
      var key = walkT + ':' + walkS;
      if (visited[key]) {
        entry.issue = 'Chain loops back to $' + hex8(walkT) + '/$' + hex8(walkS);
        chainIssues++;
        break;
      }
      visited[key] = true;
      entry.chain.push({ t: walkT, s: walkS });
      var off = sectorOffset(walkT, walkS);
      if (off < 0) {
        entry.issue = 'Sector $' + hex8(walkT) + '/$' + hex8(walkS) + ' is unmapped';
        chainIssues++;
        break;
      }
      var nextT = data[off], nextS = data[off + 1];
      if (nextT === 0) {
        bytes += Math.max(0, nextS - 1);
      } else {
        bytes += 254;
      }
      walkT = nextT;
      walkS = nextS;
      if (++safety > 2000) {
        entry.issue = 'Chain exceeds 2000 sectors (aborted)';
        chainIssues++;
        break;
      }
    }
    entry.blocks = entry.chain.length;
    entry.bytes = bytes;
    totalRecordBlocks += entry.blocks;
    totalRecordBytes += bytes;
    slots.push(entry);
  }

  // Build summary table
  var summary = [];
  summary.push(['File', name]);
  summary.push(['GEOS Type', geos.fileTypeName]);
  summary.push(['Structure', geos.structureName]);
  if (geos.date) summary.push(['Date', geos.date]);
  if (infoBlock) {
    if (infoBlock.className) summary.push(['Class', infoBlock.className]);
    summary.push(['Load / End / Init',
      '$' + hex16(infoBlock.loadAddr) + ' / $' + hex16(infoBlock.endAddr) + ' / $' + hex16(infoBlock.initAddr)]);
    if (infoBlock.description) summary.push(['Description', infoBlock.description]);
  }
  summary.push(['Info Block', '$' + hex8(geos.infoTrack) + '/$' + hex8(geos.infoSector)]);
  summary.push(['Index Sector', '$' + hex8(indexT) + '/$' + hex8(indexS)]);
  var populated = slots.filter(function(e) { return e.status === 'used'; }).length;
  var emptySlots = slots.filter(function(e) { return e.status === 'empty'; }).length;
  var endLabel = (endMarkerSlot >= 0) ? ('slot ' + endMarkerSlot) : 'none';
  summary.push(['Records', populated + ' used, ' + emptySlots + ' empty, end marker ' + endLabel]);
  summary.push(['Total size', totalRecordBlocks + ' blocks (' + totalRecordBytes.toLocaleString() + ' bytes)']);
  if (chainIssues > 0) summary.push(['Integrity', chainIssues + ' chain issue(s) — see flagged rows below']);

  // Icon canvas (same rendering as GEOS File Info)
  var iconCanvas = null;
  if (infoBlock && infoBlock.iconData && infoBlock.iconW > 0 && infoBlock.iconH > 0) {
    iconCanvas = document.createElement('canvas');
    iconCanvas.width = infoBlock.iconW;
    iconCanvas.height = infoBlock.iconH;
    iconCanvas.className = 'geos-icon';
    var ictx = iconCanvas.getContext('2d');
    var img = ictx.createImageData(infoBlock.iconW, infoBlock.iconH);
    var px = img.data;
    var bytesPerRow = infoBlock.iconW / 8;
    for (var iy = 0; iy < infoBlock.iconH; iy++) {
      for (var bx = 0; bx < bytesPerRow; bx++) {
        var byt = infoBlock.iconData[iy * bytesPerRow + bx];
        for (var bit = 7; bit >= 0; bit--) {
          var ix = bx * 8 + (7 - bit);
          var off2 = (iy * infoBlock.iconW + ix) * 4;
          var on = byt & (1 << bit);
          px[off2] = on ? 0 : 255;
          px[off2 + 1] = on ? 0 : 255;
          px[off2 + 2] = on ? 0 : 255;
          px[off2 + 3] = 255;
        }
      }
    }
    ictx.putImageData(img, 0, 0);
  }

  // Build the record table, compressing runs of empty/past-end slots.
  function statusCell(e) {
    if (e.status === 'used') return '<span class="vlir-st-used">used</span>';
    if (e.status === 'empty') return '<span class="vlir-st-empty">empty</span>';
    if (e.status === 'end') return '<span class="vlir-st-end">end marker</span>';
    if (e.status === 'past-end') return '<span class="vlir-st-past">unused</span>';
    if (e.status === 'bad-start') return '<span class="vlir-st-bad">bad start</span>';
    return e.status;
  }

  function tsCell(t, s) {
    return '<span class="vlir-ts">$' + hex8(t) + '/$' + hex8(s) + '</span>';
  }

  var rowsHtml = '';
  var i = 0;
  while (i < slots.length) {
    var e = slots[i];
    if (e.status === 'empty' || e.status === 'past-end') {
      var runStart = i;
      var kind = e.status;
      while (i < slots.length && slots[i].status === kind) i++;
      var runEnd = i - 1;
      var slotLabel = (runStart === runEnd) ? String(runStart) : (runStart + '\u2013' + runEnd);
      var statusLabel = (runStart === runEnd)
        ? statusCell(slots[runStart])
        : statusCell(slots[runStart]) + ' \u00d7 ' + (runEnd - runStart + 1);
      rowsHtml += '<tr class="vlir-row-muted">' +
        '<td>' + slotLabel + '</td>' +
        '<td colspan="4">' + statusLabel + '</td></tr>';
      continue;
    }

    var rowClass = (e.status === 'used') ? 'vlir-row' : 'vlir-row vlir-row-warn';
    if (e.issue) rowClass += ' vlir-row-warn';
    var startTs = (e.status === 'end') ? '\u2014' : tsCell(e.t, e.s);
    var blocksCell = (e.status === 'used') ? String(e.blocks) : '\u2014';
    var sizeCell = (e.status === 'used') ? e.bytes.toLocaleString() : '\u2014';

    rowsHtml += '<tr class="' + rowClass + '" data-slot="' + e.slot + '">' +
      '<td>' + e.slot + '</td>' +
      '<td>' + statusCell(e) + (e.issue ? ' <span class="vlir-issue">(' + escHtml(e.issue) + ')</span>' : '') + '</td>' +
      '<td>' + startTs + '</td>' +
      '<td>' + blocksCell + '</td>' +
      '<td>' + sizeCell + '</td></tr>';

    if (e.status === 'used' && e.chain.length > 0) {
      var chainList = e.chain.map(function(c) {
        return '$' + hex8(c.t) + '/$' + hex8(c.s);
      }).join(', ');
      rowsHtml += '<tr class="vlir-chain" data-parent="' + e.slot + '" style="display:none">' +
        '<td></td><td colspan="4"><span class="vlir-chain-label">chain:</span> <span class="vlir-ts">' + chainList + '</span></td></tr>';
    }

    i++;
  }

  var html = '<div class="vlir-wrap">';
  html += '<div class="vlir-summary">';
  html += '<table class="geos-info-table">';
  for (var rs = 0; rs < summary.length; rs++) {
    var label = summary[rs][0];
    var value = summary[rs][1];
    if (rs === 0 && iconCanvas) {
      html += '<tr><td class="geos-info-label">' + escHtml(label) + '</td>' +
        '<td class="geos-info-value"><span class="geos-info-name-row" id="vlir-icon-row">' +
        escHtml(value) + '</span></td></tr>';
    } else {
      html += '<tr><td class="geos-info-label">' + escHtml(label) + '</td>' +
        '<td class="geos-info-value">' + escHtml(value) + '</td></tr>';
    }
  }
  html += '</table></div>';

  html += '<div class="vlir-hint text-md text-muted">A VLIR file has up to 127 record slots, each pointing to its own sector chain. Click a row to expand its chain. T/S values are shown in hex.</div>';
  html += '<table class="vlir-table">';
  html += '<thead><tr><th>#</th><th>Status</th><th>T/S</th><th>Blocks</th><th>Bytes</th></tr></thead>';
  html += '<tbody>' + rowsHtml + '</tbody></table>';
  html += '</div>';

  var body = showViewerModal('VLIR Layout \u2014 "' + name + '"', html, 'lg');

  if (iconCanvas) {
    var iconRow = document.getElementById('vlir-icon-row');
    if (iconRow) iconRow.insertBefore(iconCanvas, iconRow.firstChild);
  }

  // Toggle chain rows on click
  var tbody = body.querySelector('.vlir-table tbody');
  if (tbody) {
    tbody.addEventListener('click', function(ev) {
      var tr = ev.target.closest('tr.vlir-row');
      if (!tr || !tr.dataset.slot) return;
      var chainRow = tbody.querySelector('tr.vlir-chain[data-parent="' + tr.dataset.slot + '"]');
      if (!chainRow) return;
      chainRow.style.display = (chainRow.style.display === 'none') ? '' : 'none';
      tr.classList.toggle('vlir-row-open');
    });
  }
}

