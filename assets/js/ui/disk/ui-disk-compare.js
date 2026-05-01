// ── Disk menu: Compare with... ──────────────────────────────────────
var compareInput = document.createElement('input');
compareInput.type = 'file';
compareInput.accept = '.d64,.d71,.d81,.d80,.d82';
compareInput.style.display = 'none';
document.body.appendChild(compareInput);

document.getElementById('opt-compare').addEventListener('click', function(e) {
  e.stopPropagation();
  if (!currentBuffer) return;
  closeMenus();
  showCompareSourcePicker();
});

compareInput.addEventListener('change', function() {
  var file = compareInput.files[0];
  if (!file) return;
  compareInput.value = '';
  var reader = new FileReader();
  reader.onload = function() {
    runCompareWith(reader.result, file.name);
  };
  reader.readAsArrayBuffer(file);
});

// Step 1: pick a source for the comparison — another open tab or a file.
function showCompareSourcePicker() {
  var otherTabs = tabs.filter(function(t) { return t.id !== activeTabId; });

  document.getElementById('modal-title').textContent = 'Compare With...';
  var body = document.getElementById('modal-body');
  var html = '';

  if (otherTabs.length === 0) {
    html += '<div class="text-base text-muted">No other tabs open &mdash; use "From file&hellip;" to load a disk image.</div>';
  } else {
    html += '<div class="text-base text-muted mb-md">Pick another open tab to compare against:</div>';
    html += '<div class="cmp-tab-list" style="display:flex;flex-direction:column;gap:4px">';
    otherTabs.forEach(function(t) {
      html += '<button class="cmp-pick-tab" data-tab-id="' + t.id + '" ' +
        'style="text-align:left;padding:8px 12px;background:var(--hover);border:1px solid var(--border);border-radius:4px;cursor:pointer;color:var(--text);font-size:13px">' +
        '<b>' + escHtml(t.name) + '</b></button>';
    });
    html += '</div>';
  }

  setModalSize('md');
  body.innerHTML = html;

  var footer = document.querySelector('#modal-overlay .modal-footer');
  footer.innerHTML =
    '<button class="modal-btn-secondary" id="cmp-cancel">Cancel</button>' +
    '<button id="cmp-from-file">From file&hellip;</button>';
  document.getElementById('cmp-cancel').addEventListener('click', function() {
    document.getElementById('modal-overlay').classList.remove('open');
  });
  document.getElementById('cmp-from-file').addEventListener('click', function() {
    document.getElementById('modal-overlay').classList.remove('open');
    compareInput.click();
  });

  body.querySelectorAll('.cmp-pick-tab').forEach(function(btn) {
    btn.addEventListener('click', function() {
      var tid = parseInt(btn.getAttribute('data-tab-id'), 10);
      var t = tabs.find(function(x) { return x.id === tid; });
      if (!t) return;
      runCompareWith(t.buffer, t.fileName || t.name, t.name);
    });
  });

  document.getElementById('modal-overlay').classList.add('open');
}

// Build a {buffer, format, tracks, ...} snapshot of arbitrary disk image
// data without using global state. Walks directory + file chains in
// a self-contained way by temporarily swapping the relevant globals
// (currentBuffer / currentFormat / currentTracks / parsedT64Entries /
// parsedTAPEntries / parsedTapeDir / currentPartition) around the
// existing parseDisk + readFileData calls. Restores everything on exit.
function readDiskForCompare(buffer) {
  var savedBuffer = currentBuffer;
  var savedFormat = currentFormat;
  var savedTracks = currentTracks;
  var savedPartition = currentPartition;
  var savedT64 = (typeof parsedT64Entries !== 'undefined') ? parsedT64Entries : null;
  var savedTAP = (typeof parsedTAPEntries !== 'undefined') ? parsedTAPEntries : null;
  var savedTapeDir = (typeof parsedTapeDir !== 'undefined') ? parsedTapeDir : null;
  try {
    currentBuffer = buffer;
    currentPartition = null;
    var info = parseDisk(buffer);
    var data = new Uint8Array(buffer);
    var files = [];
    if (info && info.entries) {
      info.entries.forEach(function(e) {
        if (e.deleted) return;
        var r = readFileData(buffer, e.entryOff);
        // Rich PETSCII for proper rendering of reversed bytes; the
        // PUA-mapped chars need the C64 Pro Mono font to display as
        // anything other than boxes.
        var richName = readPetsciiRich(data, e.entryOff + 5, 16);
        files.push({
          name: (e.name || '').replace(/\xa0+$/, '').trim(),
          richName: richName,
          type: (e.type || '').trim(),
          blocks: e.blocks || 0,
          entryOff: e.entryOff,
          data: r.data || new Uint8Array(0),
          error: r.error || null,
        });
      });
    }
    // Read the disk header bytes so the result modal can render the
    // disk name + ID with the proper C64 font + reversed-byte handling.
    var richDiskName = null, richDiskId = null;
    if (currentFormat && typeof getHeaderOffset === 'function' && info) {
      try {
        var hdrOff = getHeaderOffset();
        var nameLen = currentFormat.nameLength || 16;
        var idLen = currentFormat.idLength || 5;
        richDiskName = readPetsciiRich(data, hdrOff + currentFormat.nameOffset, nameLen);
        richDiskId = readPetsciiRich(data, hdrOff + currentFormat.idOffset, idLen);
      } catch (_) { /* leave null, fall back to plain string */ }
    }
    return {
      diskName: info ? info.diskName : '',
      diskId: info ? info.diskId : '',
      richDiskName: richDiskName,
      richDiskId: richDiskId,
      freeBlocks: info ? info.freeBlocks : 0,
      formatName: info ? info.format : '',
      formatRef: currentFormat,
      tracks: currentTracks,
      buffer: buffer,
      files: files,
      sizeBytes: buffer.byteLength,
    };
  } finally {
    currentBuffer = savedBuffer;
    currentFormat = savedFormat;
    currentTracks = savedTracks;
    currentPartition = savedPartition;
    if (typeof parsedT64Entries !== 'undefined') parsedT64Entries = savedT64;
    if (typeof parsedTAPEntries !== 'undefined') parsedTAPEntries = savedTAP;
    if (typeof parsedTapeDir !== 'undefined') parsedTapeDir = savedTapeDir;
  }
}

function bytesEqual(a, b) {
  if (!a || !b) return a === b;
  if (a.length !== b.length) return false;
  for (var i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

// Match files by trimmed name; classify each pair into identical /
// differs / only in A / only in B. Same-name-different-type is treated
// as "differs" (rare but possible).
function computeCompareDiff(diskA, diskB) {
  var byName = {};
  diskA.files.forEach(function(f) { byName[f.name] = { a: f, b: null }; });
  diskB.files.forEach(function(f) {
    if (byName[f.name]) byName[f.name].b = f;
    else byName[f.name] = { a: null, b: f };
  });
  var identical = [], differ = [], onlyA = [], onlyB = [];
  Object.keys(byName).forEach(function(n) {
    var p = byName[n];
    if (p.a && p.b) {
      if (p.a.type === p.b.type && bytesEqual(p.a.data, p.b.data)) identical.push(p);
      else differ.push(p);
    } else if (p.a) onlyA.push(p);
    else onlyB.push(p);
  });
  return {
    identical: identical,
    differ: differ,
    onlyA: onlyA,
    onlyB: onlyB,
  };
}

function runCompareWith(otherBuffer, otherFileName, otherTabName) {
  document.getElementById('modal-overlay').classList.remove('open');
  // Defer so the modal close paints before we do the (potentially slow) parse.
  setTimeout(function() {
    var diskA, diskB;
    try {
      diskA = readDiskForCompare(currentBuffer);
      diskB = readDiskForCompare(otherBuffer);
    } catch (err) {
      showModal('Compare Error', ['Failed to parse one of the disks: ' + (err && err.message ? err.message : err)]);
      return;
    }
    var diff = computeCompareDiff(diskA, diskB);
    showCompareResultModal(diskA, diskB, diff, currentFileName || 'unnamed',
      otherTabName || otherFileName || 'compared');
  }, 0);
}

// Sector-map canvas: draws every sector in track-row × sector-column
// layout. Identical sectors get a faint fill, differing ones use the
// warn color. Hover shows T:S + diff byte count; click drills down to
// the hex side-by-side panel below.
function setupSectorMapCanvas(body, diskA, diskB, sd) {
  var canvas = body.querySelector('#cmp-sector-canvas');
  if (!canvas) return;
  var ctx = canvas.getContext('2d');
  var cs = getComputedStyle(document.documentElement);
  var labelColor = cs.getPropertyValue('--text-muted').trim();
  var bgColor = cs.getPropertyValue('--bg').trim();
  var idColor = cs.getPropertyValue('--border').trim() || 'rgba(150,150,150,0.25)';
  var diffColor = cs.getPropertyValue('--color-warn').trim();

  var cellW = 12, cellH = 8, gap = 2;
  var stepX = cellW + gap, stepY = cellH + gap;
  var labelW = 32;
  var radius = 2;

  ctx.fillStyle = bgColor;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.font = '10px monospace';
  ctx.textBaseline = 'middle';

  var diffMap = {};
  sd.diffs.forEach(function(d) { diffMap[d.track + ':' + d.sector] = d.byteCount; });

  for (var t = 1; t <= sd.tracks; t++) {
    var spt = diskA.formatRef.sectorsPerTrack(t);
    var y = (t - 1) * stepY + gap;
    ctx.fillStyle = labelColor;
    ctx.fillText('$' + t.toString(16).toUpperCase().padStart(2, '0'), 2, y + cellH / 2);
    for (var s = 0; s < spt; s++) {
      var x = labelW + s * stepX + gap;
      ctx.fillStyle = diffMap[t + ':' + s] ? diffColor : idColor;
      ctx.beginPath();
      ctx.roundRect(x, y, cellW, cellH, radius);
      ctx.fill();
    }
  }

  function coordsFromEvent(e) {
    var rect = canvas.getBoundingClientRect();
    var x = e.clientX - rect.left - labelW;
    var y = e.clientY - rect.top;
    return {
      sector: Math.floor((x - gap * 0.5) / stepX),
      track: Math.floor((y - gap * 0.5) / stepY) + 1,
    };
  }

  canvas.addEventListener('mousemove', function(e) {
    var p = coordsFromEvent(e);
    if (p.track < 1 || p.track > sd.tracks) { canvas.title = ''; return; }
    var spt = diskA.formatRef.sectorsPerTrack(p.track);
    if (p.sector < 0 || p.sector >= spt) { canvas.title = ''; return; }
    var n = diffMap[p.track + ':' + p.sector] || 0;
    canvas.title = 'T:$' + p.track.toString(16).toUpperCase().padStart(2, '0') +
      ' S:$' + p.sector.toString(16).toUpperCase().padStart(2, '0') +
      (n ? ' — ' + n + ' bytes differ' : ' (identical)');
  });

  canvas.addEventListener('click', function(e) {
    var p = coordsFromEvent(e);
    if (p.track < 1 || p.track > sd.tracks) return;
    var spt = diskA.formatRef.sectorsPerTrack(p.track);
    if (p.sector < 0 || p.sector >= spt) return;
    showSectorHexDiff(body, diskA, diskB, p.track, p.sector, sd);
  });
}

// Hex side-by-side: render both A's and B's bytes for a sector with
// differing bytes highlighted. Computes the sector offset using diskA's
// format (formats match — checked before this is reachable).
function showSectorHexDiff(body, diskA, diskB, track, sector, sd) {
  var hexPanel = body.querySelector('#cmp-sector-hex');
  if (!hexPanel) return;

  var savedFormat = currentFormat, savedTracks = currentTracks, savedBuffer = currentBuffer;
  var off;
  try {
    currentFormat = diskA.formatRef;
    currentTracks = diskA.tracks;
    currentBuffer = diskA.buffer;
    off = sectorOffset(track, sector);
  } finally {
    currentFormat = savedFormat;
    currentTracks = savedTracks;
    currentBuffer = savedBuffer;
  }
  if (off < 0) return;

  var dataA = new Uint8Array(diskA.buffer);
  var dataB = new Uint8Array(diskB.buffer);
  var diffN = 0;
  for (var i = 0; i < 256; i++) if (dataA[off + i] !== dataB[off + i]) diffN++;

  // Find this sector's index in the diff list so prev/next can step
  // through every differing sector without going back to the canvas.
  var diffs = (sd && sd.diffs) || [];
  var curIdx = -1;
  for (var di = 0; di < diffs.length; di++) {
    if (diffs[di].track === track && diffs[di].sector === sector) { curIdx = di; break; }
  }
  var hasPrev = curIdx > 0;
  var hasNext = curIdx >= 0 && curIdx < diffs.length - 1;
  var posLabel = curIdx >= 0
    ? '<span class="text-muted cmp-hex-pos">' + (curIdx + 1) + ' / ' + diffs.length + '</span>'
    : '';

  var html =
    '<div class="cmp-sector-hex-header">' +
      '<button class="cmp-hex-nav" id="cmp-hex-prev" ' + (hasPrev ? '' : 'disabled') +
        ' title="Previous differing sector"><i class="fa-solid fa-chevron-left"></i></button>' +
      '<button class="cmp-hex-nav" id="cmp-hex-next" ' + (hasNext ? '' : 'disabled') +
        ' title="Next differing sector"><i class="fa-solid fa-chevron-right"></i></button>' +
      'T:$' + track.toString(16).toUpperCase().padStart(2, '0') +
      ' S:$' + sector.toString(16).toUpperCase().padStart(2, '0') +
      ' <span class="text-muted">(byte $' + off.toString(16).toUpperCase().padStart(6, '0') +
      ', ' + diffN + ' bytes differ)</span>' +
      posLabel +
    '</div>';

  // Reuse the standard hex-viewer layout (.hex-editor / .hex-row /
  // .hex-offset / .hex-bytes / .hex-byte / .hex-separator / .hex-ascii)
  // so the look matches the file Hex View. Each row of 8 bytes is shown
  // twice — once for A, once for B — with differing bytes highlighted
  // via .cmp-hex-diff on the byte cell and the matching ASCII char.
  html += '<div class="hex-editor cmp-hex-editor">';
  for (var row = 0; row < 32; row++) {
    var rowOff = row * 8;
    var diffBits = [];
    for (var col = 0; col < 8; col++) {
      diffBits.push(dataA[off + rowOff + col] !== dataB[off + rowOff + col]);
    }
    html += renderHexRow('A', dataA, off, rowOff, diffBits);
    html += renderHexRow('B', dataB, off, rowOff, diffBits);
  }
  html += '</div>';

  hexPanel.innerHTML = html;
  hexPanel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });

  if (hasPrev) {
    hexPanel.querySelector('#cmp-hex-prev').addEventListener('click', function() {
      var p = diffs[curIdx - 1];
      showSectorHexDiff(body, diskA, diskB, p.track, p.sector, sd);
    });
  }
  if (hasNext) {
    hexPanel.querySelector('#cmp-hex-next').addEventListener('click', function() {
      var p = diffs[curIdx + 1];
      showSectorHexDiff(body, diskA, diskB, p.track, p.sector, sd);
    });
  }
}

// Build one row in the standard hex-viewer layout (offset, 8 hex bytes,
// separator, 8 PETSCII chars), prefixed with a small A/B side label.
// Diff cells are flagged via .cmp-hex-diff.
function renderHexRow(side, data, sectorOff, rowOff, diffBits) {
  var bytesHtml = '', asciiHtml = '';
  for (var col = 0; col < 8; col++) {
    var idx = sectorOff + rowOff + col;
    var b = data[idx];
    var diff = diffBits[col];
    var sc = SCREENCODE_MAP[b];
    var byteCls = 'hex-byte' + (diff ? ' cmp-hex-diff' : '');
    var charCls = 'hex-char' + (sc.reversed ? ' petscii-rev' : '') + (diff ? ' cmp-hex-diff' : '');
    bytesHtml += '<span class="' + byteCls + '">' + b.toString(16).toUpperCase().padStart(2, '0') + '</span>';
    asciiHtml += '<span class="' + charCls + '">' + escHtml(sc.char) + '</span>';
  }
  return '<div class="hex-row cmp-hex-row">' +
    '<span class="cmp-hex-side">' + side + '</span>' +
    '<span class="hex-offset">' + rowOff.toString(16).toUpperCase().padStart(4, '0') + '</span>' +
    '<span class="hex-bytes">' + bytesHtml + '</span>' +
    '<span class="hex-separator"></span>' +
    '<span class="hex-ascii">' + asciiHtml + '</span>' +
    '</div>';
}

// Sector-level diff: walk every sector of both disks, count differing
// bytes per sector. Same-format only — D64-vs-D81 is meaningless at the
// sector layer because the geometries differ.
function computeSectorDiff(diskA, diskB) {
  if (!diskA.formatRef || diskA.formatRef !== diskB.formatRef) {
    return { compatible: false };
  }
  var savedBuffer = currentBuffer;
  var savedFormat = currentFormat;
  var savedTracks = currentTracks;
  try {
    currentBuffer = diskA.buffer;
    currentFormat = diskA.formatRef;
    currentTracks = Math.min(diskA.tracks, diskB.tracks);
    var dataA = new Uint8Array(diskA.buffer);
    var dataB = new Uint8Array(diskB.buffer);
    var diffs = [];
    var perTrack = {};
    var totalSectors = 0;
    var maxSpt = 0;
    for (var t = 1; t <= currentTracks; t++) {
      var spt = currentFormat.sectorsPerTrack(t);
      if (spt > maxSpt) maxSpt = spt;
      for (var s = 0; s < spt; s++) {
        totalSectors++;
        var off = sectorOffset(t, s);
        if (off < 0 || off + 256 > dataA.length || off + 256 > dataB.length) continue;
        var n = 0;
        for (var i = 0; i < 256; i++) if (dataA[off + i] !== dataB[off + i]) n++;
        if (n > 0) {
          diffs.push({ track: t, sector: s, byteCount: n, offset: off });
          perTrack[t] = (perTrack[t] || 0) + 1;
        }
      }
    }
    var totalBytes = 0;
    diffs.forEach(function(d) { totalBytes += d.byteCount; });
    return {
      compatible: true,
      tracks: currentTracks,
      maxSpt: maxSpt,
      totalSectors: totalSectors,
      diffs: diffs,
      perTrack: perTrack,
      totalBytes: totalBytes,
    };
  } finally {
    currentBuffer = savedBuffer;
    currentFormat = savedFormat;
    currentTracks = savedTracks;
  }
}

function showCompareResultModal(diskA, diskB, diff, labelA, labelB) {
  document.getElementById('modal-title').textContent = 'Disk Comparison';

  var nA = diff.onlyA.length, nB = diff.onlyB.length;
  var nDiff = diff.differ.length, nEq = diff.identical.length;

  var headerHtml =
    '<div class="text-base mb-md">' +
      '<div><b>A:</b> ' + escHtml(labelA) + ' (' + diskA.formatName + ', ' +
        diskA.sizeBytes + ' bytes, ' + diskA.freeBlocks + ' blocks free)</div>' +
      '<div><b>B:</b> ' + escHtml(labelB) + ' (' + diskB.formatName + ', ' +
        diskB.sizeBytes + ' bytes, ' + diskB.freeBlocks + ' blocks free)</div>' +
    '</div>';

  // Summary cards
  var summaryHtml = '<div class="cmp-summary">' +
    '<div class="cmp-summary-card cmp-c-identical"><div class="cmp-summary-num">' + nEq + '</div><div class="cmp-summary-label">Identical</div></div>' +
    '<div class="cmp-summary-card cmp-c-differ"><div class="cmp-summary-num">' + nDiff + '</div><div class="cmp-summary-label">Differ</div></div>' +
    '<div class="cmp-summary-card cmp-c-only-a"><div class="cmp-summary-num">' + nA + '</div><div class="cmp-summary-label">Only in A</div></div>' +
    '<div class="cmp-summary-card cmp-c-only-b"><div class="cmp-summary-num">' + nB + '</div><div class="cmp-summary-label">Only in B</div></div>' +
    '</div>';

  // Render a filename as PETSCII glyphs. Reversed bytes ($00-$1F /
  // $80-$9F) wrap in .petscii-rev so they render as inverse video, same
  // as the main directory listing.
  function renderRichName(rich) {
    if (!rich || rich.length === 0) return '';
    return rich.map(function(c) {
      var ch = escHtml(c.char);
      return c.reversed ? '<span class="petscii-rev">' + ch + '</span>' : ch;
    }).join('');
  }

  // Build a flat search-key out of both filenames so the filter box
  // matches whichever side has a label (file may be only in A or only in B).
  function fileSearchKey(p) {
    var a = p.a ? p.a.name : '';
    var b = p.b ? p.b.name : '';
    return (a + ' ' + b).toLowerCase();
  }

  function fileRow(p, marker, markerClass) {
    var nameA = p.a ? renderRichName(p.a.richName) : '<span class="text-muted">&mdash;</span>';
    var typeA = p.a ? escHtml(p.a.type) : '';
    var blocksA = p.a ? p.a.blocks : '';
    var nameB = p.b ? renderRichName(p.b.richName) : '<span class="text-muted">&mdash;</span>';
    var typeB = p.b ? escHtml(p.b.type) : '';
    var blocksB = p.b ? p.b.blocks : '';
    var sizeA = p.a ? p.a.data.length : 0;
    var sizeB = p.b ? p.b.data.length : 0;
    return '<tr class="cmp-file-row" data-search="' + escHtml(fileSearchKey(p)) + '">' +
      '<td class="cmp-marker ' + markerClass + '">' + marker + '</td>' +
      '<td class="cmp-fname">' + nameA + '</td>' +
      '<td>' + typeA + '</td>' +
      '<td style="text-align:right">' + blocksA + '</td>' +
      '<td class="cmp-fname">' + nameB + '</td>' +
      '<td>' + typeB + '</td>' +
      '<td style="text-align:right">' + blocksB + '</td>' +
      '<td style="text-align:right">' + (p.a && p.b && sizeA !== sizeB ? Math.abs(sizeA - sizeB) + ' B' : '') + '</td>' +
      '</tr>';
  }

  // Each section is its own <tbody> so we can toggle a `collapsed` class
  // to hide its file rows while keeping the section header visible.
  // The Identical group is collapsed by default — usually the biggest
  // pile and the least interesting after a glance at the count.
  function sectionTbody(key, title, count, rows, marker, markerClass, collapsedByDefault) {
    if (count === 0) return '';
    var collapsed = collapsedByDefault ? ' collapsed' : '';
    var html = '<tbody class="cmp-section-tbody' + collapsed + '" data-section="' + key + '">' +
      '<tr class="cmp-section-row" data-section="' + key + '"><td colspan="8">' +
        '<i class="fa-solid fa-chevron-down cmp-section-chevron"></i>' +
        title + '<span class="cmp-section-count">(' + count + ')</span>' +
      '</td></tr>';
    rows.forEach(function(p) { html += fileRow(p, marker, markerClass); });
    html += '</tbody>';
    return html;
  }

  // FontAwesome icons for the diff markers (same metaphor as git/diff:
  // equal / not-equal / minus / plus). Colors carry the meaning; the
  // legend strip above the table spells it out.
  var ICON_EQ    = '<i class="fa-solid fa-equals"></i>';
  var ICON_NE    = '<i class="fa-solid fa-not-equal"></i>';
  var ICON_ONLYA = '<i class="fa-solid fa-minus"></i>';
  var ICON_ONLYB = '<i class="fa-solid fa-plus"></i>';

  var legendHtml = '<div class="cmp-legend">' +
    '<span class="cmp-legend-item"><span class="cmp-marker cmp-marker-eq">' + ICON_EQ + '</span> identical</span>' +
    '<span class="cmp-legend-item"><span class="cmp-marker cmp-marker-ne">' + ICON_NE + '</span> differs</span>' +
    '<span class="cmp-legend-item"><span class="cmp-marker cmp-marker-only-a">' + ICON_ONLYA + '</span> only in A</span>' +
    '<span class="cmp-legend-item"><span class="cmp-marker cmp-marker-only-b">' + ICON_ONLYB + '</span> only in B</span>' +
    '</div>';

  var allFilesEmpty = (nDiff === 0 && nA === 0 && nB === 0);
  var filesTabHtml = headerHtml + summaryHtml;
  if (allFilesEmpty) {
    filesTabHtml += '<div class="cmp-section-title" style="color:var(--color-recover)">All files identical.</div>';
  }
  filesTabHtml += legendHtml +
    '<div class="cmp-filter-row">' +
      '<i class="fa-solid fa-magnifying-glass cmp-filter-icon"></i>' +
      '<input type="text" class="cmp-filter-input" id="cmp-files-filter" ' +
        'placeholder="Filter by filename…" autocomplete="off">' +
      '<span class="cmp-filter-empty" id="cmp-files-filter-empty" style="display:none">no matches</span>' +
    '</div>' +
    '<table class="cmp-table cmp-table-files">' +
      '<colgroup>' +
        '<col style="width:36px">' +     // marker
        '<col>' +                         // name A
        '<col style="width:48px">' +     // type A
        '<col style="width:56px">' +     // blocks A
        '<col>' +                         // name B
        '<col style="width:48px">' +     // type B
        '<col style="width:56px">' +     // blocks B
        '<col style="width:64px">' +     // delta size
      '</colgroup>' +
      '<thead><tr>' +
        '<th></th><th>Name (A)</th><th>Type</th><th style="text-align:right">Blocks</th>' +
        '<th>Name (B)</th><th>Type</th><th style="text-align:right">Blocks</th>' +
        '<th style="text-align:right">&Delta; size</th>' +
      '</tr></thead>' +
      sectionTbody('differ',    'Differ',    nDiff, diff.differ,    ICON_NE,    'cmp-marker-ne',    false) +
      sectionTbody('only-a',    'Only in A', nA,    diff.onlyA,     ICON_ONLYA, 'cmp-marker-only-a', false) +
      sectionTbody('only-b',    'Only in B', nB,    diff.onlyB,     ICON_ONLYB, 'cmp-marker-only-b', false) +
      sectionTbody('identical', 'Identical', nEq,   diff.identical, ICON_EQ,    'cmp-marker-eq',     true) +
    '</table>';

  // Directory tab — side-by-side listing.
  // Build a merged ordered list: walk diskA in order, for each file also
  // emit its B counterpart (or empty if missing); then append B-only.
  var dirRows = [];
  var seenB = {};
  diskA.files.forEach(function(fa) {
    var fb = diskB.files.find(function(f) { return f.name === fa.name; });
    var status;
    if (!fb) status = 'only-a';
    else {
      seenB[fb.name] = true;
      if (fa.type === fb.type && bytesEqual(fa.data, fb.data)) status = 'eq';
      else status = 'ne';
    }
    dirRows.push({ a: fa, b: fb || null, status: status });
  });
  diskB.files.forEach(function(fb) {
    if (!seenB[fb.name]) dirRows.push({ a: null, b: fb, status: 'only-b' });
  });

  var dirTabHtml = '<div class="cmp-side-by-side">';
  dirTabHtml += '<div class="cmp-side-col"><div class="cmp-side-header">' + escHtml(labelA) + '</div></div>';
  dirTabHtml += '<div></div>';
  dirTabHtml += '<div class="cmp-side-col"><div class="cmp-side-header">' + escHtml(labelB) + '</div></div>';

  dirRows.forEach(function(r) {
    var rowClass = 'cmp-side-row cmp-r-' + r.status;
    var emptyClass = 'cmp-side-row cmp-r-empty';
    var aHtml = r.a
      ? '<div class="' + rowClass + '"><span class="cmp-side-blocks">' + r.a.blocks + '</span>' +
        '<span class="cmp-side-name">' + renderRichName(r.a.richName) + '</span>' +
        '<span class="cmp-side-type">' + escHtml(r.a.type) + '</span></div>'
      : '<div class="' + emptyClass + '">&nbsp;</div>';
    var bHtml = r.b
      ? '<div class="' + rowClass + '"><span class="cmp-side-blocks">' + r.b.blocks + '</span>' +
        '<span class="cmp-side-name">' + renderRichName(r.b.richName) + '</span>' +
        '<span class="cmp-side-type">' + escHtml(r.b.type) + '</span></div>'
      : '<div class="' + emptyClass + '">&nbsp;</div>';
    var midSym = r.status === 'eq' ? ICON_EQ :
                 r.status === 'ne' ? ICON_NE :
                 r.status === 'only-a' ? ICON_ONLYA : ICON_ONLYB;
    var midClass = r.status === 'eq' ? 'cmp-marker-eq' :
                   r.status === 'ne' ? 'cmp-marker-ne' :
                   r.status === 'only-a' ? 'cmp-marker-only-a' : 'cmp-marker-only-b';
    dirTabHtml += aHtml;
    dirTabHtml += '<div class="cmp-side-mid ' + midClass + '">' + midSym + '</div>';
    dirTabHtml += bHtml;
  });
  dirTabHtml += '</div>';

  // Sectors tab — visual map + click-to-drill hex side-by-side.
  var sectorDiff = computeSectorDiff(diskA, diskB);
  var sectorTabHtml;
  if (!sectorDiff.compatible) {
    sectorTabHtml =
      '<div class="text-base text-muted">' +
        'Sector-level comparison requires both disks to be the same format. ' +
        'A is ' + escHtml(diskA.formatName) + '; B is ' + escHtml(diskB.formatName) + '.' +
      '</div>';
  } else if (sectorDiff.diffs.length === 0) {
    sectorTabHtml =
      '<div class="text-base" style="color:var(--color-recover)">All ' +
        sectorDiff.totalSectors + ' sectors are byte-for-byte identical.</div>';
  } else {
    var trackCount = Object.keys(sectorDiff.perTrack).length;
    var cellW = 12, cellH = 8, gap = 2;
    var stepX = cellW + gap, stepY = cellH + gap;
    var labelW = 32;
    var canvasW = labelW + sectorDiff.maxSpt * stepX + gap;
    var canvasH = sectorDiff.tracks * stepY + gap;
    sectorTabHtml =
      '<div class="text-base mb-md">' +
        '<b>' + sectorDiff.diffs.length + '</b> of ' + sectorDiff.totalSectors +
        ' sectors differ (' + sectorDiff.totalBytes + ' bytes) across ' + trackCount + ' track' +
        (trackCount === 1 ? '' : 's') + '. Click a sector for the byte-level diff.' +
      '</div>' +
      '<div class="cmp-sector-legend">' +
        '<span class="cmp-legend-item"><span class="cmp-legend-box cmp-sec-eq"></span> identical</span>' +
        '<span class="cmp-legend-item"><span class="cmp-legend-box cmp-sec-ne"></span> differs</span>' +
      '</div>' +
      '<div class="cmp-sector-map">' +
        '<canvas id="cmp-sector-canvas" width="' + canvasW + '" height="' + canvasH +
        '" style="cursor:crosshair;display:block"></canvas>' +
      '</div>' +
      '<div id="cmp-sector-hex" class="cmp-sector-hex"></div>';
  }

  var html =
    '<div class="cmp-layout">' +
      '<div class="cmp-tabs">' +
        '<span class="cmp-tab active" data-cmp-view="files">Files</span>' +
        '<span class="cmp-tab" data-cmp-view="dir">Directory</span>' +
        '<span class="cmp-tab" data-cmp-view="sectors">Sectors</span>' +
      '</div>' +
      '<div class="cmp-tab-scroll">' +
        '<div class="cmp-view-content" data-cmp-view="files">' + filesTabHtml + '</div>' +
        '<div class="cmp-view-content" data-cmp-view="dir" style="display:none">' + dirTabHtml + '</div>' +
        '<div class="cmp-view-content" data-cmp-view="sectors" style="display:none">' + sectorTabHtml + '</div>' +
      '</div>' +
    '</div>';

  showModal('Disk Comparison', []);
  setModalSize('xl');
  var body = document.getElementById('modal-body');
  body.innerHTML = html;

  body.querySelectorAll('.cmp-tab').forEach(function(tab) {
    tab.addEventListener('click', function() {
      body.querySelectorAll('.cmp-tab').forEach(function(t) { t.classList.remove('active'); });
      tab.classList.add('active');
      var view = tab.getAttribute('data-cmp-view');
      body.querySelectorAll('.cmp-view-content').forEach(function(c) {
        c.style.display = c.getAttribute('data-cmp-view') === view ? '' : 'none';
      });
      var scroller = body.querySelector('.cmp-tab-scroll');
      if (scroller) scroller.scrollTop = 0;
    });
  });

  // Section collapse/expand: clicking the header row toggles its tbody.
  body.querySelectorAll('.cmp-section-row').forEach(function(row) {
    row.addEventListener('click', function() {
      var tbody = row.parentElement;
      if (tbody) tbody.classList.toggle('collapsed');
    });
  });

  // Summary card → jump to the matching section + force-expand it.
  var summaryToSection = {
    'cmp-c-identical': 'identical',
    'cmp-c-differ':    'differ',
    'cmp-c-only-a':    'only-a',
    'cmp-c-only-b':    'only-b'
  };
  body.querySelectorAll('.cmp-summary-card').forEach(function(card) {
    var match = (card.className.match(/cmp-c-[a-z-]+/) || [])[0];
    var key = match && summaryToSection[match];
    if (!key) return;
    card.style.cursor = 'pointer';
    card.addEventListener('click', function() {
      var tbody = body.querySelector('.cmp-section-tbody[data-section="' + key + '"]');
      if (!tbody) return;
      tbody.classList.remove('collapsed');
      var header = tbody.querySelector('.cmp-section-row');
      if (header) header.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  });

  // Filter box: hides any file row whose data-search doesn't contain the
  // typed substring. A section whose visible rows all get filtered out
  // shows a "(no matches)" muted line in place of its file rows so the
  // user can see the section still exists.
  var filterInput = body.querySelector('#cmp-files-filter');
  var filterEmpty = body.querySelector('#cmp-files-filter-empty');
  if (filterInput) {
    filterInput.addEventListener('input', function() {
      var q = filterInput.value.trim().toLowerCase();
      var anyVisible = false;
      body.querySelectorAll('.cmp-section-tbody').forEach(function(tbody) {
        var rows = tbody.querySelectorAll('.cmp-file-row');
        var sectionHasMatch = false;
        rows.forEach(function(r) {
          var key = r.getAttribute('data-search') || '';
          var match = !q || key.indexOf(q) !== -1;
          r.style.display = match ? '' : 'none';
          if (match) { sectionHasMatch = true; anyVisible = true; }
        });
        // While filtering, keep the matching tbody expanded so results are
        // visible immediately; collapsed sections would hide their hits.
        if (q) tbody.classList.toggle('collapsed', !sectionHasMatch);
      });
      filterEmpty.style.display = (q && !anyVisible) ? '' : 'none';
    });
  }

  // Render the sector map canvas + wire hover/click.
  if (sectorDiff.compatible && sectorDiff.diffs.length > 0) {
    setupSectorMapCanvas(body, diskA, diskB, sectorDiff);
  }

  var footer = document.querySelector('#modal-overlay .modal-footer');
  footer.innerHTML = '<button id="modal-close">OK</button>';
  document.getElementById('modal-close').addEventListener('click', function() {
    document.getElementById('modal-overlay').classList.remove('open');
  });
  document.getElementById('modal-overlay').classList.add('open');
}

