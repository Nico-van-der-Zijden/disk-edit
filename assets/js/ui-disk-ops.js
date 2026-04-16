// ── Disk menu: Scan for Lost Files ───────────────────────────────────
document.getElementById('opt-scan-orphans').addEventListener('click', async function(e) {
  e.stopPropagation();
  if (!currentBuffer) return;
  closeMenus();

  var results = scanOrphanedChains(currentBuffer);

  if (results.length === 0) {
    showModal('Scan for Lost Files', ['No lost files found.']);
    return;
  }

  // Build modal content
  document.getElementById('modal-title').textContent = 'Scan for Lost Files';
  var body = document.getElementById('modal-body');
  body.innerHTML = '';

  var summary = document.createElement('div');
  summary.textContent = 'Found ' + results.length + ' lost file(s):';
  summary.style.marginBottom = '12px';
  body.appendChild(summary);

  var list = document.createElement('div');

  for (var ri = 0; ri < results.length; ri++) {
    (function(r, idx) {
      var card = document.createElement('div');
      card.className = 'modal-info-card';

      var typeStr = r.suggestedType;
      if (r.suggestedType === 'PRG' && r.loadAddress !== null) {
        typeStr += ' ($' + r.loadAddress.toString(16).toUpperCase().padStart(4, '0') + ')';
      }

      var integrityIcon = '';
      if (r.integrity === 'ok') integrityIcon = '<span style="color:#4c4">&#10003;</span> ';
      else if (r.integrity === 'broken') integrityIcon = '<span style="color:#ca4">&#9888;</span> ';
      else integrityIcon = '<span style="color:#c44">&#9888;</span> ';

      card.innerHTML =
        '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">' +
          '<strong>#' + (idx + 1) + '</strong>' +
          '<span style="font-size:12px;color:var(--text-muted)">' + integrityIcon + r.integrity + '</span>' +
        '</div>' +
        '<div style="font-size:12px;margin-bottom:6px">' +
          'Start: T:$' + r.startTrack.toString(16).toUpperCase().padStart(2, '0') +
          ' S:$' + r.startSector.toString(16).toUpperCase().padStart(2, '0') +
          ' &mdash; ' + r.sectors.length + ' block(s), ' + r.dataSize + ' bytes' +
          ' &mdash; ' + typeStr +
        '</div>' +
        '<div style="display:flex;gap:6px"></div>';

      var btnRow = card.lastElementChild;

      var exportBtn = document.createElement('button');
      exportBtn.textContent = 'Export';
      exportBtn.className = 'btn-small';
      exportBtn.addEventListener('click', function() {
        var ext = r.suggestedType === 'PRG' ? '.prg' : r.suggestedType === 'SEQ' ? '.seq' : '.bin';
        var blob = new Blob([r.data], { type: 'application/octet-stream' });
        var a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = 'recovered_' + String(idx + 1).padStart(3, '0') + ext;
        a.click();
        URL.revokeObjectURL(a.href);
      });
      btnRow.appendChild(exportBtn);

      var restoreBtn = document.createElement('button');
      restoreBtn.textContent = 'Restore';
      restoreBtn.className = 'btn-small';
      restoreBtn.addEventListener('click', async function() {
        document.getElementById('modal-overlay').classList.remove('open');
        var name = await showInputModal('Filename for Recovered File', 'RECOVERED');
        if (!name) return;
        name = name.toUpperCase().substring(0, 16);

        var typeIdx = r.suggestedType === 'PRG' ? 2 : r.suggestedType === 'SEQ' ? 1 : 3;

        var snapshot = currentBuffer.slice(0);
        var entryOff = findFreeDirEntry(currentBuffer);
        if (entryOff < 0) {
          currentBuffer = snapshot;
          showModal('Restore Error', ['No free directory entry available.']);
          return;
        }

        var wd = new Uint8Array(currentBuffer);
        // File type: closed
        wd[entryOff + 2] = 0x80 | typeIdx;
        // First track/sector
        wd[entryOff + 3] = r.startTrack;
        wd[entryOff + 4] = r.startSector;
        // Filename
        for (var ni = 0; ni < 16; ni++) {
          if (ni < name.length) {
            var ch = name.charCodeAt(ni);
            if (ch >= 0x41 && ch <= 0x5A) wd[entryOff + 5 + ni] = ch;
            else if (ch >= 0x30 && ch <= 0x39) wd[entryOff + 5 + ni] = ch;
            else if (ch === 0x20) wd[entryOff + 5 + ni] = 0x20;
            else wd[entryOff + 5 + ni] = 0x20;
          } else {
            wd[entryOff + 5 + ni] = 0xA0;
          }
        }
        // Clear unused
        for (var ui = 21; ui < 30; ui++) wd[entryOff + ui] = 0x00;
        // Block count
        wd[entryOff + 30] = r.sectors.length & 0xFF;
        wd[entryOff + 31] = (r.sectors.length >> 8) & 0xFF;

        // Mark chain sectors as allocated in BAM
        var ctx = getDirContext();
        var bamOff = ctx.bamOff;
        for (var si = 0; si < r.sectors.length; si++) {
          bamMarkSectorUsed(wd, r.sectors[si].t, r.sectors[si].s, bamOff);
        }

        selectedEntryIndex = entryOff;
        var info = parseCurrentDir(currentBuffer);
        renderDisk(info);
        updateMenuState();
        showModal('File Restored', ['"' + name + '" restored with ' + r.sectors.length + ' block(s).']);
      });
      btnRow.appendChild(restoreBtn);

      list.appendChild(card);
    })(results[ri], ri);
  }

  body.appendChild(list);

  // Set footer to just OK
  var footer = document.querySelector('#modal-overlay .modal-footer');
  footer.innerHTML = '<button id="modal-close">OK</button>';
  document.getElementById('modal-close').addEventListener('click', function() {
    document.getElementById('modal-overlay').classList.remove('open');
  });
  document.getElementById('modal-overlay').classList.add('open');
});

document.querySelectorAll('#opt-sort .submenu .option').forEach(el => {
  el.addEventListener('click', (e) => {
    e.stopPropagation();
    if (!currentBuffer) return;
    closeMenus();
    sortDirectory(currentBuffer, el.dataset.sort);
    const info = parseCurrentDir(currentBuffer);
    renderDisk(info);
  });
});

// ── View menu ─────────────────────────────────────────────────────────
document.getElementById('opt-charset-mode').addEventListener('click', (e) => {
  e.stopPropagation();
  closeMenus();
  var newMode = charsetMode === 'uppercase' ? 'lowercase' : 'uppercase';
  setCharsetMode(newMode);
  document.getElementById('opt-charset-mode').textContent = newMode === 'lowercase' ? 'Switch to Uppercase' : 'Switch to Lowercase';
  buildSepSubmenu();
  if (currentBuffer) {
    var info = parseCurrentDir(currentBuffer);
    renderDisk(info);
  }
  if (pickerTarget) renderPicker();
});

document.getElementById('opt-show-addr').addEventListener('click', (e) => {
  e.stopPropagation();
  closeMenus();
  showAddresses = !showAddresses;
  localStorage.setItem('cbm-showAddresses', showAddresses);
  document.getElementById('check-addr').innerHTML = showAddresses ? '<i class="fa-solid fa-check"></i>' : '';
  if (currentBuffer) {
    const info = parseCurrentDir(currentBuffer);
    renderDisk(info);
  }
});

document.getElementById('opt-show-ts').addEventListener('click', (e) => {
  e.stopPropagation();
  closeMenus();
  showTrackSector = !showTrackSector;
  localStorage.setItem('cbm-showTrackSector', showTrackSector);
  document.getElementById('check-ts').innerHTML = showTrackSector ? '<i class="fa-solid fa-check"></i>' : '';
  if (currentBuffer) {
    const info = parseCurrentDir(currentBuffer);
    renderDisk(info);
  }
});

// ── BAM Viewer ───────────────────────────────────────────────────────
document.getElementById('opt-view-bam').addEventListener('click', function(e) {
  e.stopPropagation();
  if (!currentBuffer) return;
  closeMenus();

  var data = new Uint8Array(currentBuffer);
  var fmt = currentFormat;
  var bamOff = sectorOffset(fmt.bamTrack, fmt.bamSector);
  var bamTracks = fmt.bamTracksRange(currentTracks);

  // Use shared BAM integrity check
  var bamCheck = checkBAMIntegrity(currentBuffer);
  var sectorOwner = bamCheck.sectorOwner;

  var bamWarnings = '';
  if (bamCheck.bamErrors.length > 0 || bamCheck.allocMismatch > 0 || bamCheck.orphanCount > 0) {
    bamWarnings += '<ul class="bam-warnings">';
    if (bamCheck.bamErrors.length > 0) {
      bamWarnings += '<li><i class="fa-solid fa-triangle-exclamation"></i> ' +
        bamCheck.bamErrors.length + ' track(s) with wrong free count</li>';
    }
    if (bamCheck.allocMismatch > 0) {
      bamWarnings += '<li><i class="fa-solid fa-triangle-exclamation"></i> ' +
        bamCheck.allocMismatch + ' sector(s) marked free but used by files</li>';
    }
    if (bamCheck.orphanCount > 0) {
      bamWarnings += '<li><i class="fa-solid fa-circle-question"></i> ' +
        bamCheck.orphanCount + ' sector(s) marked used but not owned by any file</li>';
    }
    bamWarnings += '</ul>';
  }

  // Find max sectors for header
  var maxSpt = 0;
  for (var t = 1; t <= bamTracks; t++) {
    var spt = fmt.sectorsPerTrack(t);
    if (spt > maxSpt) maxSpt = spt;
  }

  // Build both views: sector detail and summary
  var hasErrors = bamCheck.allocMismatch > 0;
  var hasOrphans = bamCheck.orphanCount > 0;
  var forceCompact = maxSpt > 40; // DNP/D2M/D4M: too many sectors for detail view

  // Collect per-track stats for both views
  var trackStats = []; // [{free, used, spt}] indexed by track (1-based)
  var totalFree = 0, totalUsed = 0;
  for (t = 1; t <= bamTracks; t++) {
    spt = fmt.sectorsPerTrack(t);
    var tFree = 0, tUsed = 0;
    for (var cs = 0; cs < spt; cs++) {
      if (checkSectorFree(data, bamOff, t, cs)) tFree++; else tUsed++;
    }
    totalFree += tFree;
    totalUsed += tUsed;
    trackStats[t] = { free: tFree, used: tUsed, spt: spt };
  }

  // ── Build Summary view (compact bars) ──
  var summaryLegend = '<div class="bam-legend">' +
    '<span class="bam-legend-item"><span class="bam-legend-box" style="background:#6c9bd2"></span> 0-50%</span>' +
    '<span class="bam-legend-item"><span class="bam-legend-box" style="background:#4a7ab5"></span> 50-70%</span>' +
    '<span class="bam-legend-item"><span class="bam-legend-box" style="background:#2d5a8e"></span> 70-90%</span>' +
    '<span class="bam-legend-item"><span class="bam-legend-box" style="background:#1a3a5c"></span> 90-100%</span>' +
    '</div>';
  var summaryHtml = summaryLegend + '<div class="bam-viewer">';
  for (t = 1; t <= bamTracks; t++) {
    var ts = trackStats[t];
    var pct = ts.spt > 0 ? Math.round(ts.used / ts.spt * 100) : 0;
    var barColor = pct > 90 ? '#1a3a5c' : pct > 70 ? '#2d5a8e' : pct > 50 ? '#4a7ab5' : '#6c9bd2';
    summaryHtml += '<div class="bam-track">';
    summaryHtml += '<span class="bam-track-num' + (bamCheck.errorTracks[t] ? ' error' : '') + '">$' + t.toString(16).toUpperCase().padStart(2, '0') + '</span>';
    summaryHtml += '<span class="bam-compact-bar" title="T:$' + t.toString(16).toUpperCase().padStart(2, '0') +
      ' \u2014 ' + ts.free + ' free, ' + ts.used + ' used (' + pct + '%)">' +
      '<span class="bam-compact-fill" style="width:' + pct + '%;background:' + barColor + '"></span></span>';
    summaryHtml += '<span class="bam-compact-info">' + ts.free + '/' + ts.spt + '</span>';
    summaryHtml += '</div>';
  }
  summaryHtml += '</div>';

  // ── Build Sectors view (individual blocks) — skip if forced compact ──
  var sectorsHtml = '';
  if (!forceCompact) {
    var sectorLegend = '<div class="bam-legend">' +
      '<span class="bam-legend-item"><span class="bam-legend-box" style="background:var(--accent)"></span> Used</span>' +
      '<span class="bam-legend-item"><span class="bam-legend-box" style="background:var(--accent);opacity:0.25"></span> Free</span>' +
      '<span class="bam-legend-item"><span class="bam-legend-box bam-sector dir-used"></span> Dir Used</span>' +
      '<span class="bam-legend-item"><span class="bam-legend-box bam-sector dir-free"></span> Dir Free</span>' +
      (hasErrors ? '<span class="bam-legend-item"><span class="bam-legend-box bam-sector bam-legend-error"></span> BAM Error</span>' : '') +
      (hasOrphans ? '<span class="bam-legend-item"><span class="bam-legend-box bam-sector bam-legend-orphan"></span> Orphan</span>' : '') +
      '</div>';

    sectorsHtml = sectorLegend;
    sectorsHtml += '<div class="bam-header">';
    sectorsHtml += '<span class="bam-header-spacer"></span>';
    sectorsHtml += '<span class="bam-header-sectors">';
    for (var h = 0; h < maxSpt; h++) {
      sectorsHtml += '<span class="bam-header-num">' + h.toString(16).toUpperCase().padStart(2, '0') + '</span>';
    }
    sectorsHtml += '</span></div>';

    sectorsHtml += '<div class="bam-viewer">';
    for (t = 1; t <= bamTracks; t++) {
      spt = fmt.sectorsPerTrack(t);
      var isDirTrack = (t === fmt.dirTrack);
      sectorsHtml += '<div class="bam-track">';
      sectorsHtml += '<span class="bam-track-num' + (bamCheck.errorTracks[t] ? ' error' : '') + '">$' + t.toString(16).toUpperCase().padStart(2, '0') + '</span>';
      sectorsHtml += '<span class="bam-sectors">';

      for (var s = 0; s < spt; s++) {
        var isFree = checkSectorFree(data, bamOff, t, s);
        var sKey = t + ':' + s;
        var isError = bamCheck.errorSectors[sKey];
        var isOrphan = bamCheck.orphanSectors[sKey];
        var owner = sectorOwner[sKey];
        var cls = 'bam-sector';
        if (isDirTrack) {
          cls += isFree ? ' dir-free' : ' dir-used';
        } else if (isError) {
          cls += ' error';
        } else if (isOrphan) {
          cls += ' orphan';
        } else {
          cls += isFree ? ' free' : ' used';
        }

        var tooltip = 'T:$' + t.toString(16).toUpperCase().padStart(2, '0') +
          ' S:$' + s.toString(16).toUpperCase().padStart(2, '0');
        if (isError) {
          tooltip += ' \u26a0 BAM says free, used by: ' + petsciiToReadable(owner);
        } else if (isOrphan) {
          tooltip += ' (orphan \u2014 used in BAM but no file)';
        } else if (isFree) {
          tooltip += ' (free)';
        } else if (isDirTrack) {
          tooltip += ' (directory)';
        } else if (owner) {
          tooltip += ' (' + petsciiToReadable(owner) + ')';
        } else {
          tooltip += ' (used)';
        }

        sectorsHtml += '<span class="' + cls + '" data-t="' + t + '" data-s="' + s + '" title="' + escHtml(tooltip) + '"></span>';
      }

      sectorsHtml += '</span></div>';
    }
    sectorsHtml += '</div>';
  }

  // ── Build optional Partitions panel (D1M/D2M/D4M only) ──
  var partsTabHtml = '', partsPanelHtml = '';
  var fmtKey = (fmt.name || '').toLowerCase();
  if (fmtKey === 'd1m' || fmtKey === 'd2m' || fmtKey === 'd4m') {
    partsTabHtml = '<span class="bam-tab" data-bam-view="partitions">Partitions</span>';
    var parts = readCmdFdSysPartitions(currentBuffer, fmtKey, currentTracks);
    var panel;
    if (!parts) {
      panel = '<div class="bam-partitions-empty" style="padding:12px;color:var(--text-muted)">' +
        'No CMD FD system partition on this disk (magic "CMD FD SERIES" not found on track ' +
        currentTracks + ' sector 5).</div>';
    } else {
      panel = '<table class="bam-partitions" style="width:100%;border-collapse:collapse">' +
        '<thead><tr>' +
        '<th style="text-align:left;padding:4px 8px;border-bottom:1px solid var(--border)">Type</th>' +
        '<th style="text-align:left;padding:4px 8px;border-bottom:1px solid var(--border)">Name</th>' +
        '<th style="text-align:right;padding:4px 8px;border-bottom:1px solid var(--border)">Start block</th>' +
        '<th style="text-align:right;padding:4px 8px;border-bottom:1px solid var(--border)">Size (blocks)</th>' +
        '</tr></thead><tbody>';
      for (var pi = 0; pi < parts.length; pi++) {
        var p = parts[pi];
        panel += '<tr>' +
          '<td style="padding:4px 8px">' + escHtml(p.typeName) + '</td>' +
          '<td style="padding:4px 8px"><b>' + escHtml(p.name) + '</b></td>' +
          '<td style="padding:4px 8px;text-align:right;font-family:monospace">' + p.startBlock + '</td>' +
          '<td style="padding:4px 8px;text-align:right;font-family:monospace">' + p.sizeBlocks + '</td>' +
          '</tr>';
      }
      panel += '</tbody></table>';
    }
    partsPanelHtml = '<div class="bam-view-content" data-bam-view="partitions" style="display:none">' +
      panel + '</div>';
  }

  // ── Compose final HTML with tabs ──
  var title = 'BAM \u2014 ' + totalFree + ' free, ' + totalUsed + ' used of ' +
    (totalFree + totalUsed) + ' sectors';
  var html = bamWarnings;

  if (forceCompact) {
    // High-SPT: Map + Summary (+ Partitions for CMD FD) tabs
    html += '<div class="bam-tabs">' +
      '<span class="bam-tab active" data-bam-view="map">Map</span>' +
      '<span class="bam-tab" data-bam-view="summary">Summary</span>' +
      partsTabHtml +
      '</div>';
    // Canvas map placeholder — drawn after modal opens
    var cellW = 12, cellH = 8;  // match HTML bam-sector proportions (18x12 scaled down)
    var gap = 2;
    var stepX = cellW + gap, stepY = cellH + gap;
    var labelW = 32; // left margin for track numbers
    var canvasW = labelW + maxSpt * stepX + gap;
    var canvasH = bamTracks * stepY + gap;
    var mapLegend = '<div class="bam-legend">' +
      '<span class="bam-legend-item"><span class="bam-legend-box" style="background:var(--accent)"></span> Used</span>' +
      '<span class="bam-legend-item"><span class="bam-legend-box" style="background:var(--accent);opacity:0.25"></span> Free</span>' +
      '<span class="bam-legend-item"><span class="bam-legend-box bam-sector dir-used"></span> Dir Used</span>' +
      '<span class="bam-legend-item"><span class="bam-legend-box bam-sector dir-free"></span> Dir Free</span>' +
      (hasErrors ? '<span class="bam-legend-item"><span class="bam-legend-box bam-sector bam-legend-error"></span> BAM Error</span>' : '') +
      (hasOrphans ? '<span class="bam-legend-item"><span class="bam-legend-box bam-sector bam-legend-orphan"></span> Orphan</span>' : '') +
      '</div>';
    html += '<div class="bam-view-content" data-bam-view="map">' + mapLegend +
      '<div class="bam-map-scroll"><canvas id="bam-map-canvas" width="' + canvasW + '" height="' + canvasH + '" style="cursor:crosshair;display:block"></canvas></div></div>';
    html += '<div class="bam-view-content" data-bam-view="summary" style="display:none">' + summaryHtml + '</div>';
    html += partsPanelHtml;
  } else {
    // Tab switcher — Sectors + Summary (+ Partitions for D1M)
    html += '<div class="bam-tabs">' +
      '<span class="bam-tab active" data-bam-view="sectors">Sectors</span>' +
      '<span class="bam-tab" data-bam-view="summary">Summary</span>' +
      partsTabHtml +
      '</div>';
    html += '<div class="bam-view-content" data-bam-view="sectors">' + sectorsHtml + '</div>';
    html += '<div class="bam-view-content" data-bam-view="summary" style="display:none">' + summaryHtml + '</div>';
    html += partsPanelHtml;
  }

  showModal(title, []);
  var bamBody = document.getElementById('modal-body');
  bamBody.innerHTML = html;

  // Tab switching
  bamBody.querySelectorAll('.bam-tab').forEach(function(tab) {
    tab.addEventListener('click', function() {
      bamBody.querySelectorAll('.bam-tab').forEach(function(t) { t.classList.remove('active'); });
      tab.classList.add('active');
      var view = tab.getAttribute('data-bam-view');
      bamBody.querySelectorAll('.bam-view-content').forEach(function(c) {
        c.style.display = c.getAttribute('data-bam-view') === view ? '' : 'none';
      });
    });
  });

  // Draw canvas map for high-SPT formats
  var bamCanvas = document.getElementById('bam-map-canvas');
  if (bamCanvas) {
    var ctx2d = bamCanvas.getContext('2d');
    // Read colors from CSS via computed styles on temporary elements
    var cs = getComputedStyle(document.documentElement);
    var accent = cs.getPropertyValue('--accent').trim();
    var bgColor = cs.getPropertyValue('--bg').trim();

    // Create temporary elements to read BAM sector colors from CSS classes
    function getCssColor(cls, opacity) {
      var el = document.createElement('span');
      el.className = 'bam-sector ' + cls;
      el.style.display = 'none';
      document.body.appendChild(el);
      var style = getComputedStyle(el);
      var bg = style.backgroundColor;
      var op = parseFloat(style.opacity);
      document.body.removeChild(el);
      if (op < 1) {
        // Apply opacity to the color
        var m = bg.match(/\d+/g);
        if (m) return 'rgba(' + m[0] + ',' + m[1] + ',' + m[2] + ',' + op + ')';
      }
      return bg;
    }
    var colUsed = getCssColor('used', 1);
    var colFree = getCssColor('free', 1);
    var colDirUsed = getCssColor('dir-used', 1);
    var colDirFree = getCssColor('dir-free', 1);
    var colError = getCssColor('error', 1);
    var colOrphan = getCssColor('orphan', 1);

    ctx2d.fillStyle = bgColor;
    ctx2d.fillRect(0, 0, bamCanvas.width, bamCanvas.height);

    // Draw track labels and sector blocks
    var colLabel = cs.getPropertyValue('--text-muted').trim();
    ctx2d.font = '10px monospace';
    ctx2d.textBaseline = 'middle';
    var radius = 2; // rounded corner radius matching CSS bam-sector

    for (var mt = 1; mt <= bamTracks; mt++) {
      var mSpt = fmt.sectorsPerTrack(mt);
      var mIsDirTrack = (mt === fmt.dirTrack);
      var my = (mt - 1) * stepY + gap;

      // Track number label
      ctx2d.fillStyle = bamCheck.errorTracks[mt] ? colError : colLabel;
      ctx2d.fillText('$' + mt.toString(16).toUpperCase().padStart(2, '0'), 2, my + cellH / 2);

      for (var ms = 0; ms < mSpt; ms++) {
        var mx = labelW + ms * stepX + gap;
        var mFree = checkSectorFree(data, bamOff, mt, ms);
        var mKey = mt + ':' + ms;
        var mError = bamCheck.errorSectors[mKey];
        var mOrphan = bamCheck.orphanSectors[mKey];
        if (mIsDirTrack) {
          ctx2d.fillStyle = mFree ? colDirFree : colDirUsed;
        } else if (mError) {
          ctx2d.fillStyle = colError;
        } else if (mOrphan) {
          ctx2d.fillStyle = colOrphan;
        } else {
          ctx2d.fillStyle = mFree ? colFree : colUsed;
        }
        ctx2d.beginPath();
        ctx2d.roundRect(mx, my, cellW, cellH, radius);
        ctx2d.fill();
      }
    }

    var mapContainer = bamCanvas.parentNode;
    var lastTitle = '';

    function mapCoordsFromEvent(e) {
      var rect = bamCanvas.getBoundingClientRect();
      var x = e.clientX - rect.left - labelW;
      var y = e.clientY - rect.top;
      return {
        sector: Math.floor((x - gap * 0.5) / stepX),
        track: Math.floor((y - gap * 0.5) / stepY) + 1
      };
    }

    bamCanvas.addEventListener('mousemove', function(e) {
      var pos = mapCoordsFromEvent(e);
      if (pos.track < 1 || pos.track > bamTracks || pos.sector < 0 || pos.sector >= fmt.sectorsPerTrack(pos.track)) {
        if (lastTitle) { bamCanvas.title = ''; lastTitle = ''; }
        return;
      }
      var ttKey = pos.track + ':' + pos.sector;
      var ttOwner = sectorOwner[ttKey];
      var ttFree = checkSectorFree(data, bamOff, pos.track, pos.sector);
      var tt = 'T:$' + pos.track.toString(16).toUpperCase().padStart(2, '0') +
        ' S:$' + pos.sector.toString(16).toUpperCase().padStart(2, '0');
      if (bamCheck.errorSectors[ttKey]) tt += ' \u26a0 BAM error';
      else if (bamCheck.orphanSectors[ttKey]) tt += ' (orphan)';
      else if (ttFree) tt += ' (free)';
      else if (ttOwner) tt += ' (' + petsciiToReadable(ttOwner) + ')';
      else tt += ' (used)';
      if (tt !== lastTitle) { bamCanvas.title = tt; lastTitle = tt; }
    });

    // Click to open sector editor
    bamCanvas.addEventListener('click', function(e) {
      var pos = mapCoordsFromEvent(e);
      var mt3 = pos.track, ms3 = pos.sector;
      if (mt3 < 1 || mt3 > bamTracks || ms3 < 0 || ms3 >= fmt.sectorsPerTrack(mt3)) return;
      document.getElementById('modal-overlay').classList.remove('open');
      showSectorHexEditor(mt3, ms3);
    });

    // Right-click to toggle free/used
    bamCanvas.addEventListener('contextmenu', function(e) {
      e.preventDefault();
      var pos = mapCoordsFromEvent(e);
      var mt4 = pos.track, ms4 = pos.sector;
      if (mt4 < 1 || mt4 > bamTracks || ms4 < 0 || ms4 >= fmt.sectorsPerTrack(mt4)) return;
      pushUndo();
      var d = new Uint8Array(currentBuffer);
      var bOff = sectorOffset(fmt.bamTrack, fmt.bamSector);
      var base2 = (fmt.isSectorFree) ? fmt._bamBase(mt4) : getBamBitmapBase(mt4, bOff);
      d[base2 + (ms4 >> 3)] ^= fmt.bamBitMask(ms4);
      if (typeof fmt.writeTrackFree === 'function' && !fmt.isSectorFree) bamRecalcFree(d, mt4, bOff);
      document.getElementById('modal-overlay').classList.remove('open');
      document.getElementById('opt-view-bam').click();
    });
  }

  // Click on a sector block to open sector editor
  bamBody.addEventListener('click', function(e) {
    var block = e.target.closest('.bam-sector');
    if (!block) return;
    var bt = parseInt(block.getAttribute('data-t'), 10);
    var bs = parseInt(block.getAttribute('data-s'), 10);
    if (isNaN(bt) || isNaN(bs)) return;
    // Close BAM modal and open sector editor
    document.getElementById('modal-overlay').classList.remove('open');
    showSectorHexEditor(bt, bs);
  });

  // Right-click on a sector block to toggle free/used
  bamBody.addEventListener('contextmenu', function(e) {
    var block = e.target.closest('.bam-sector');
    if (!block) return;
    e.preventDefault();
    var bt = parseInt(block.getAttribute('data-t'), 10);
    var bs = parseInt(block.getAttribute('data-s'), 10);
    if (isNaN(bt) || isNaN(bs)) return;

    pushUndo();
    var d = new Uint8Array(currentBuffer);
    var bOff = sectorOffset(fmt.bamTrack, fmt.bamSector);
    var base = (fmt._bamBase) ? fmt._bamBase(bt) : getBamBitmapBase(bt, bOff);
    var byteIdx = bs >> 3;
    var bitMask = fmt.bamBitMask(bs);
    d[base + byteIdx] ^= bitMask;
    if (typeof fmt.writeTrackFree === 'function' && !fmt._bamBase) bamRecalcFree(d, bt, bOff);

    // Refresh BAM view
    document.getElementById('modal-overlay').classList.remove('open');
    document.getElementById('opt-view-bam').click();
  });
});

// ── Error Byte Viewer ─────────────────────────────────────────────────
document.getElementById('opt-view-errors').addEventListener('click', function(e) {
  e.stopPropagation();
  if (!currentBuffer || !hasErrorBytes(currentBuffer)) return;
  closeMenus();

  var data = new Uint8Array(currentBuffer);
  var fmt = currentFormat;
  var errOff = getErrorBytesOffset(fmt, currentTracks);

  // Find max sectors for header
  var maxSpt = 0;
  for (var t = 1; t <= currentTracks; t++) {
    var spt = fmt.sectorsPerTrack(t);
    if (spt > maxSpt) maxSpt = spt;
  }

  // Count errors
  var totalErrors = 0;
  var totalSect = 0;
  for (t = 1; t <= currentTracks; t++) totalSect += fmt.sectorsPerTrack(t);

  var html = '';

  // Sector number header
  html += '<div class="bam-header">';
  html += '<span class="bam-header-spacer"></span>';
  html += '<span class="bam-header-sectors">';
  for (var h = 0; h < maxSpt; h++) {
    html += '<span class="bam-header-num">' + h.toString(16).toUpperCase().padStart(2, '0') + '</span>';
  }
  html += '</span></div>';

  html += '<div class="bam-viewer">';

  var errIdx = 0;
  for (t = 1; t <= currentTracks; t++) {
    spt = fmt.sectorsPerTrack(t);
    html += '<div class="bam-track">';
    html += '<span class="bam-track-num">$' + t.toString(16).toUpperCase().padStart(2, '0') + '</span>';
    html += '<span class="bam-sectors">';

    for (var s = 0; s < spt; s++) {
      var errByte = data[errOff + errIdx];
      var isOk = (errByte === 0x01 || errByte === 0x00);
      var desc = ERROR_CODES[errByte] || ('Unknown ($' + errByte.toString(16).toUpperCase().padStart(2, '0') + ')');
      var cls = 'error-sector ' + (isOk ? 'ok' : 'err');
      if (!isOk) totalErrors++;

      var tooltip = 'T:$' + t.toString(16).toUpperCase().padStart(2, '0') +
        ' S:$' + s.toString(16).toUpperCase().padStart(2, '0') +
        ' Error: $' + errByte.toString(16).toUpperCase().padStart(2, '0') +
        ' - ' + desc;

      html += '<span class="' + cls + '" data-t="' + t + '" data-s="' + s +
        '" title="' + escHtml(tooltip) + '">' +
        (isOk ? '' : errByte.toString(16).toUpperCase().padStart(2, '0')) + '</span>';
      errIdx++;
    }

    html += '</span></div>';
  }

  html += '</div>';

  // Legend
  html += '<div class="bam-legend" style="padding-top:8px">';
  html += '<span class="bam-legend-item"><span class="bam-legend-box error-sector ok"></span> OK ($01)</span>';
  html += '<span class="bam-legend-item"><span class="bam-legend-box error-sector err"></span> Error</span>';
  html += '</div>';

  var title = 'Error Bytes \u2014 ' + (totalErrors > 0 ? totalErrors + ' error(s)' : 'No errors') +
    ' in ' + totalSect + ' sectors';

  showModal(title, []);
  var errBody = document.getElementById('modal-body');
  errBody.innerHTML = html;

  // Click to open sector editor
  errBody.addEventListener('click', function(ev) {
    var block = ev.target.closest('.error-sector');
    if (!block) return;
    var bt = parseInt(block.getAttribute('data-t'), 10);
    var bs = parseInt(block.getAttribute('data-s'), 10);
    if (isNaN(bt) || isNaN(bs)) return;
    document.getElementById('modal-overlay').classList.remove('open');
    showSectorHexEditor(bt, bs);
  });
});

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

// ── Disk menu: Fill Free Sectors ─────────────────────────────────────
document.getElementById('opt-fill-free').addEventListener('click', function(e) {
  e.stopPropagation();
  if (!currentBuffer) return;
  closeMenus();

  document.getElementById('modal-title').textContent = 'Fill Free Sectors';
  var body = document.getElementById('modal-body');
  body.innerHTML = '';

  var hint = document.createElement('div');
  hint.className = 'text-md text-muted mb-md';
  hint.textContent = 'Enter hex bytes (00-FF). Up to 8 bytes, pattern repeats across each sector.';
  body.appendChild(hint);

  var row = document.createElement('div');
  row.className = 'flex-row-wrap gap-md mb-lg';
  body.appendChild(row);

  var preview = document.createElement('div');
  preview.className = 'text-md text-muted font-mono';
  body.appendChild(preview);

  function updatePreview() {
    if (fillBytes.length === 0) {
      preview.textContent = '';
      return;
    }
    preview.textContent = 'Pattern: ' + fillBytes.map(function(b) {
      return '$' + b.toString(16).toUpperCase().padStart(2, '0');
    }).join(' ');
  }


  function readAllBytes(includePending) {
    var bytes = [];
    var inputs = row.querySelectorAll('input');
    for (var i = 0; i < inputs.length; i++) {
      var v = inputs[i].value.replace(/[^0-9a-fA-F]/g, '');
      if (v.length === 2) {
        var val = parseInt(v, 16);
        if (!isNaN(val) && val >= 0 && val <= 255) bytes.push(val);
      } else if (v.length === 1 && includePending) {
        var val2 = parseInt('0' + v, 16);
        if (!isNaN(val2)) bytes.push(val2);
      }
    }
    return bytes;
  }

  var fillBtn; // declared here so refreshPreview can access it

  function refreshPreview() {
    var confirmed = readAllBytes(false);
    var withPending = readAllBytes(true);
    if (fillBtn) fillBtn.disabled = confirmed.length === 0;
    if (withPending.length === 0) { preview.textContent = ''; return; }
    preview.textContent = 'Pattern: ' + withPending.map(function(b) {
      return '$' + b.toString(16).toUpperCase().padStart(2, '0');
    }).join(' ');
  }

  function ensureEmptyInput() {
    // Make sure there's exactly one empty input at the end (if under 8 total)
    var inputs = row.querySelectorAll('input');
    var last = inputs.length > 0 ? inputs[inputs.length - 1] : null;
    var filledCount = 0;
    for (var i = 0; i < inputs.length; i++) {
      if (inputs[i].value.replace(/[^0-9a-fA-F]/g, '').length === 2) filledCount++;
    }
    if (last && last.value === '' && filledCount < 8) return; // already have one
    if (filledCount >= 8) return;
    addByteInput('', false);
  }

  function addByteInput(value, doFocus) {
    var inp = document.createElement('input');
    inp.type = 'text';
    inp.maxLength = 2;
    inp.className = 'fill-byte-input';
    inp.value = value || '';
    row.appendChild(inp);

    inp.addEventListener('keydown', function(ev) {
      if (ev.key === 'Backspace' && inp.value === '') {
        // Focus previous input, but don't remove this one yet
        var prev = inp.previousElementSibling;
        if (prev) {
          ev.preventDefault();
          ev.stopPropagation();
          prev.focus();
          var len = prev.value.length;
          prev.setSelectionRange(len, len);
          return;
        }
      }
      if (ev.key === 'Tab' && !ev.shiftKey) {
        var v = inp.value.replace(/[^0-9a-fA-F]/g, '');
        if (v.length > 0 && v.length < 2) inp.value = '0' + v.toUpperCase();
        if (inp.value.length === 2 && row.querySelectorAll('input').length < 8) {
          ev.preventDefault();
          ev.stopPropagation();
          ensureEmptyInput();
          var next = inp.nextElementSibling;
          if (next) next.focus();
          refreshPreview();
          return;
        }
      }
      if (ev.key !== 'Escape') ev.stopPropagation();
    });

    inp.addEventListener('input', function() {
      inp.value = inp.value.replace(/[^0-9a-fA-F]/g, '').substring(0, 2);
      // If this input now has <2 chars, remove any trailing empty inputs
      if (inp.value.length < 2) {
        var next = inp.nextElementSibling;
        while (next && next.value === '') {
          var toRemove = next;
          next = next.nextElementSibling;
          row.removeChild(toRemove);
        }
      }
      refreshPreview();
      if (inp.value.length === 2) {
        // Auto-advance: ensure there's a next input and focus it
        ensureEmptyInput();
        var next = inp.nextElementSibling;
        if (next) setTimeout(function() { next.focus(); }, 0);
      }
    });

    inp.addEventListener('focus', function() {
      inp.select();
    });

    inp.addEventListener('blur', function() {
      var v = inp.value.replace(/[^0-9a-fA-F]/g, '');
      if (v.length === 0) {
        // Empty input: remove it (unless it's the only one)
        if (row.querySelectorAll('input').length > 1) {
          row.removeChild(inp);
          refreshPreview();
          ensureEmptyInput();
        }
      } else if (v.length === 1) {
        // Single digit: pad with leading zero
        inp.value = '0' + v.toUpperCase();
        refreshPreview();
        ensureEmptyInput();
      }
    });

    if (doFocus) setTimeout(function() { inp.focus(); inp.select(); }, 50);
  }

  addByteInput('00', true);
  refreshPreview();

  var footer = document.querySelector('#modal-overlay .modal-footer');
  footer.innerHTML = '';

  var cancelBtn = document.createElement('button');
  cancelBtn.textContent = 'Cancel';
  cancelBtn.className = 'modal-btn-secondary';
  cancelBtn.addEventListener('click', function() {
    document.getElementById('modal-overlay').classList.remove('open');
  });
  footer.appendChild(cancelBtn);

  fillBtn = document.createElement('button');
  fillBtn.textContent = 'Fill';
  fillBtn.addEventListener('click', function() {
    document.getElementById('modal-overlay').classList.remove('open');

    // Read all valid bytes from inputs (ignore empty ones)
    var fillBytes = readAllBytes();
    if (fillBytes.length === 0) return;
    pushUndo();

    // Build true allocation map (don't trust BAM)
    var allocated = buildTrueAllocationMap(currentBuffer);
    var data = new Uint8Array(currentBuffer);
    var fmt = currentFormat;
    var filled = 0;

    for (var t = 1; t <= currentTracks; t++) {
      var spt = fmt.sectorsPerTrack(t);
      for (var s = 0; s < spt; s++) {
        if (allocated[t + ':' + s]) continue;
        var off = sectorOffset(t, s);
        if (off < 0) continue;

        // Set track/sector link to 00 00 (no chain)
        data[off] = 0x00;
        data[off + 1] = 0x00;

        // Fill bytes 2-255 with the repeating pattern
        var pi = 0;
        for (var b = 2; b < 256; b++) {
          data[off + b] = fillBytes[pi];
          pi = (pi + 1) % fillBytes.length;
        }
        filled++;
      }
    }

    var info = parseCurrentDir(currentBuffer);
    renderDisk(info);
    updateMenuState();
    showModal('Fill Free Sectors', [
      filled + ' sector(s) filled with pattern: ' + fillBytes.map(function(b) { return '$' + b.toString(16).toUpperCase().padStart(2, '0'); }).join(' ')
    ]);
  });
  footer.appendChild(fillBtn);

  document.getElementById('modal-overlay').classList.add('open');
});

// ── Disk menu: Optimize Disk ─────────────────────────────────────────
document.getElementById('opt-optimize').addEventListener('click', function(e) {
  e.stopPropagation();
  if (!currentBuffer || isTapeFormat()) return;
  closeMenus();

  var fmt = currentFormat;

  // Presets from format definition
  var presets = fmt.interleavePresets || [{ value: fmt.defaultInterleave, label: 'Default', desc: 'Default interleave for this format' }];
  var defaultPreset = fmt.interleaveDefault || 0;

  document.getElementById('modal-title').textContent = 'Optimize Disk';
  var body = document.getElementById('modal-body');
  var html =
    '<div class="text-md text-muted mb-lg">Rearrange sectors on disk to reduce loading time on real hardware.</div>' +
    '<div class="opt-presets">';
  for (var pi = 0; pi < presets.length; pi++) {
    html += '<label class="opt-preset' + (pi === defaultPreset ? ' selected' : '') + '">' +
      '<input type="radio" name="opt-preset" value="' + presets[pi].value + '"' + (pi === defaultPreset ? ' checked' : '') + '>' +
      '<span class="opt-preset-content">' +
        '<span class="opt-preset-label">' + presets[pi].label + '</span>' +
        '<span class="opt-preset-desc">' + presets[pi].desc + '</span>' +
      '</span>' +
    '</label>';
  }
  html += '<label class="opt-preset">' +
    '<input type="radio" name="opt-preset" value="custom">' +
    '<span class="opt-preset-content">' +
      '<span class="opt-preset-label">Custom</span>' +
      '<span class="opt-preset-desc">Interleave: <input type="text" id="opt-il-custom" maxlength="2" value="' + fmt.defaultInterleave.toString(16).toUpperCase() + '" class="hex-input" placeholder="' + fmt.defaultInterleave.toString(16).toUpperCase() + '"></span>' +
    '</span>' +
  '</label>';
  html += '</div>';
  html += '<div class="opt-defrag-row">' +
    '<label class="opt-check-label">' +
      '<input type="checkbox" id="opt-defrag">' +
      '<span class="opt-defrag-content">' +
        '<span class="opt-preset-label">Defragment</span>' +
        '<span class="opt-preset-desc">Move files closer together, reduces head movement between tracks</span>' +
      '</span>' +
    '</label>' +
  '</div>';
  body.innerHTML = html;

  // Wire up preset selection highlighting
  var presetLabels = body.querySelectorAll('.opt-preset');
  var customInput = document.getElementById('opt-il-custom');
  presetLabels.forEach(function(label) {
    var radio = label.querySelector('input[type="radio"]');
    radio.addEventListener('change', function() {
      presetLabels.forEach(function(l) { l.classList.remove('selected'); });
      label.classList.add('selected');
      if (radio.value === 'custom') customInput.focus();
    });
  });
  // Clicking custom input auto-selects the custom radio
  customInput.addEventListener('focus', function() {
    var customRadio = body.querySelector('input[value="custom"]');
    customRadio.checked = true;
    customRadio.dispatchEvent(new Event('change'));
  });

  var footer = document.querySelector('#modal-overlay .modal-footer');
  footer.innerHTML = '';

  var cancelBtn = document.createElement('button');
  cancelBtn.textContent = 'Cancel';
  cancelBtn.className = 'modal-btn-secondary';
  cancelBtn.addEventListener('click', function() {
    document.getElementById('modal-overlay').classList.remove('open');
  });
  footer.appendChild(cancelBtn);

  var okBtn = document.createElement('button');
  okBtn.textContent = 'Optimize';
  okBtn.addEventListener('click', function() {
    var selected = body.querySelector('input[name="opt-preset"]:checked');
    var ilVal;
    if (selected.value === 'custom') {
      var cStr = customInput.value.trim();
      ilVal = parseInt(cStr, 16);
      if (isNaN(ilVal) || ilVal < 1 || ilVal > 20) {
        customInput.focus();
        return;
      }
    } else {
      ilVal = parseInt(selected.value, 10);
    }
    var defrag = document.getElementById('opt-defrag').checked;
    document.getElementById('modal-overlay').classList.remove('open');

    pushUndo();
    var result = optimizeDisk(currentBuffer, ilVal, defrag);

    // Update global interleave so new files use the same setting
    fileInterleave = ilVal;

    var info = parseCurrentDir(currentBuffer);
    renderDisk(info);
    updateMenuState();
    showModal('Optimize Disk', result.log);
  });
  footer.appendChild(okBtn);

  // Stop propagation on inputs
  body.querySelectorAll('input').forEach(function(inp) {
    inp.addEventListener('keydown', function(ev) { ev.stopPropagation(); });
  });

  document.getElementById('modal-overlay').classList.add('open');
});

// ── Disk menu: Export as Text ────────────────────────────────────────
document.getElementById('opt-export-txt').addEventListener('click', function(e) {
  e.stopPropagation();
  if (!currentBuffer) return;
  closeMenus();
  var info = parseCurrentDir(currentBuffer);
  var lines = [];
  lines.push('0 "' + petsciiToReadable(info.diskName).replace(/"/g, '') + '" ' + petsciiToReadable(info.diskId));
  for (var i = 0; i < info.entries.length; i++) {
    var en = info.entries[i];
    if (en.deleted && !showDeleted) continue;
    var nameR = petsciiToReadable(en.name);
    lines.push(String(en.blocks).padStart(5) + ' "' + nameR + '"' + ' '.repeat(Math.max(0, 16 - nameR.length)) + ' ' + en.type.trim());
  }
  lines.push(info.freeBlocks + ' BLOCKS FREE.');
  var txt = lines.join('\n') + '\n';
  var blob = new Blob([txt], { type: 'text/plain' });
  var a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = (currentFileName || 'disk') + '.txt';
  a.click();
  URL.revokeObjectURL(a.href);
});

// ── Disk menu: MD5 Hash ──────────────────────────────────────────────
document.getElementById('opt-md5').addEventListener('click', async function(e) {
  e.stopPropagation();
  if (!currentBuffer) return;
  closeMenus();
  // Use Web Crypto API for SHA-256 (MD5 not available, but SHA-256 is better)
  // Also compute a simple checksum for quick comparison
  var data = new Uint8Array(currentBuffer);
  try {
    var hashBuffer = await crypto.subtle.digest('SHA-256', data);
    var hashArray = new Uint8Array(hashBuffer);
    var sha256 = Array.from(hashArray).map(function(b) { return b.toString(16).padStart(2, '0'); }).join('');
    // Simple MD5-like CRC32 for quick checks
    var crc = 0xFFFFFFFF;
    for (var i = 0; i < data.length; i++) {
      crc ^= data[i];
      for (var j = 0; j < 8; j++) crc = (crc >>> 1) ^ (crc & 1 ? 0xEDB88320 : 0);
    }
    crc = (crc ^ 0xFFFFFFFF) >>> 0;
    var crc32 = crc.toString(16).toUpperCase().padStart(8, '0');

    document.getElementById('modal-title').textContent = 'Disk Hash';
    var body = document.getElementById('modal-body');
    body.innerHTML =
      '<div style="font-size:13px;line-height:2">' +
        '<b>File:</b> ' + escHtml(currentFileName || 'unnamed') + '<br>' +
        '<b>Size:</b> ' + data.length + ' bytes<br>' +
        '<b>CRC32:</b> <code class="code-tag;user-select:text">' + crc32 + '</code><br>' +
        '<b>SHA-256:</b> <code class="code-tag" style="font-size:11px;user-select:text;word-break:break-all">' + sha256 + '</code>' +
      '</div>';
    var footer = document.querySelector('#modal-overlay .modal-footer');
    footer.innerHTML = '<button id="modal-close">OK</button>';
    document.getElementById('modal-close').addEventListener('click', function() {
      document.getElementById('modal-overlay').classList.remove('open');
    });
    document.getElementById('modal-overlay').classList.add('open');
  } catch(err) {
    showModal('Hash Error', ['Failed to compute hash: ' + err.message]);
  }
});

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
  compareInput.click();
});

compareInput.addEventListener('change', function() {
  var file = compareInput.files[0];
  if (!file) return;
  compareInput.value = '';
  var reader = new FileReader();
  reader.onload = function() {
    var otherBuf = new Uint8Array(reader.result);
    var thisBuf = new Uint8Array(currentBuffer);
    var maxLen = Math.max(thisBuf.length, otherBuf.length);
    var diffs = [];
    var diffSectors = {};

    for (var i = 0; i < maxLen; i++) {
      var a = i < thisBuf.length ? thisBuf[i] : -1;
      var b = i < otherBuf.length ? otherBuf[i] : -1;
      if (a !== b) {
        var sectorNum = Math.floor(i / 256);
        if (!diffSectors[sectorNum]) diffSectors[sectorNum] = 0;
        diffSectors[sectorNum]++;
      }
    }

    var sectorKeys = Object.keys(diffSectors).sort(function(a, b) { return parseInt(a) - parseInt(b); });
    var totalDiffBytes = 0;
    for (var k in diffSectors) totalDiffBytes += diffSectors[k];

    document.getElementById('modal-title').textContent = 'Disk Comparison';
    var body = document.getElementById('modal-body');
    var html = '<div class="text-base line-tall">' +
      '<b>Current:</b> ' + escHtml(currentFileName || 'unnamed') + ' (' + thisBuf.length + ' bytes)<br>' +
      '<b>Compare:</b> ' + escHtml(file.name) + ' (' + otherBuf.length + ' bytes)<br><br>';

    if (sectorKeys.length === 0) {
      html += '<div style="color:#588D43;font-weight:bold">Disks are identical!</div>';
    } else {
      html += '<b>' + totalDiffBytes + ' byte(s) differ</b> in ' + sectorKeys.length + ' sector(s):<br><br>';
      html += '<table style="width:100%;border-collapse:collapse;font-size:12px">';
      html += '<tr style="color:var(--text-muted)"><td style="padding:2px 8px"><b>Sector</b></td><td><b>Offset</b></td><td><b>Differences</b></td></tr>';
      for (var si = 0; si < Math.min(sectorKeys.length, 100); si++) {
        var sn = parseInt(sectorKeys[si]);
        html += '<tr><td style="padding:2px 8px">' + sn + '</td><td>$' + (sn * 256).toString(16).toUpperCase().padStart(6, '0') + '</td><td>' + diffSectors[sn] + ' byte(s)</td></tr>';
      }
      if (sectorKeys.length > 100) html += '<tr><td colspan="3" style="padding:2px 8px;color:var(--text-muted)">...and ' + (sectorKeys.length - 100) + ' more sectors</td></tr>';
      html += '</table>';
    }
    html += '</div>';
    body.innerHTML = html;

    var footer = document.querySelector('#modal-overlay .modal-footer');
    footer.innerHTML = '<button id="modal-close">OK</button>';
    document.getElementById('modal-close').addEventListener('click', function() {
      document.getElementById('modal-overlay').classList.remove('open');
    });
    document.getElementById('modal-overlay').classList.add('open');
  };
  reader.readAsArrayBuffer(file);
});

// ── Disk menu: Set Interleave ────────────────────────────────────────
document.getElementById('opt-interleave').addEventListener('click', function(e) {
  e.stopPropagation();
  closeMenus();

  document.getElementById('modal-title').textContent = 'Set Interleave';
  var body = document.getElementById('modal-body');
  body.innerHTML =
    '<div class="text-md text-muted mb-lg">Sector interleave for ' + currentFormat.name + '. Resets to format default when opening a new disk.</div>' +
    '<div class="form-row">' +
      '<label class="form-label">Directory:</label>' +
      '<input type="text" id="il-dir" maxlength="2" value="' + dirInterleave.toString(16).toUpperCase() + '" class="hex-input wide">' +
    '</div>' +
    '<div class="form-row">' +
      '<label class="form-label">File data:</label>' +
      '<input type="text" id="il-file" maxlength="2" value="' + fileInterleave.toString(16).toUpperCase() + '" class="hex-input wide">' +
    '</div>';

  var footer = document.querySelector('#modal-overlay .modal-footer');
  footer.innerHTML = '<button class="modal-btn-secondary" id="il-cancel">Cancel</button><button id="il-ok">OK</button>';
  document.getElementById('il-cancel').addEventListener('click', function() {
    document.getElementById('modal-overlay').classList.remove('open');
  });
  document.getElementById('il-ok').addEventListener('click', function() {
    var dStr = document.getElementById('il-dir').value.trim();
    var fStr = document.getElementById('il-file').value.trim();
    var dVal = parseInt(dStr, 16);
    var fVal = parseInt(fStr, 16);
    if (!isNaN(dVal) && dVal >= 1 && dVal <= 0x14) dirInterleave = dVal;
    if (!isNaN(fVal) && fVal >= 1 && fVal <= 0x14) fileInterleave = fVal;
    document.getElementById('modal-overlay').classList.remove('open');
  });
  // Stop propagation on inputs so keydown handlers don't interfere
  body.querySelectorAll('input').forEach(function(inp) {
    inp.addEventListener('keydown', function(ev) { ev.stopPropagation(); });
  });
  document.getElementById('modal-overlay').classList.add('open');
  document.getElementById('il-dir').focus();
});

// ── Disk menu: Add Directory (D81 partition) ─────────────────────────
document.getElementById('opt-add-partition').addEventListener('click', async function(e) {
  e.stopPropagation();
  if (!currentBuffer) return;
  closeMenus();

  // Linked directory: header sector + dir chain (e.g. CMD Native DIR type)
  if (currentFormat.subdirLinked) {
    var name = await showInputModal('Directory Name', 'SUBDIR');
    if (!name) return;
    name = name.toUpperCase().substring(0, 16);

    pushUndo();
    var data = new Uint8Array(currentBuffer);
    var fmt = currentFormat;
    var bamOff = sectorOffset(fmt.bamTrack, fmt.bamSector);

    // Allocate 2 sectors: header + first dir sector
    var allocated = buildTrueAllocationMap(currentBuffer);
    var sectorList = allocateSectors(allocated, 2);
    if (sectorList.length < 2) {
      showModal('Add Directory Error', ['Not enough free sectors.']);
      return;
    }

    var hdrSec = sectorList[0];
    var dirSec = sectorList[1];

    // Find parent header T/S for back-navigation
    var parentHeaderT = fmt.headerTrack;
    var parentHeaderS = fmt.headerSector;
    if (currentPartition && currentPartition.dnpHeaderT !== undefined) {
      parentHeaderT = currentPartition.dnpHeaderT;
      parentHeaderS = currentPartition.dnpHeaderS;
    }

    // Write header sector
    var hdrOff = sectorOffset(hdrSec.track, hdrSec.sector);
    for (var hi = 0; hi < 256; hi++) data[hdrOff + hi] = 0x00;
    data[hdrOff + 0x00] = dirSec.track;  // dir chain T/S
    data[hdrOff + 0x01] = dirSec.sector;
    data[hdrOff + 0x02] = fmt.dosVersion;
    // Write name at format's name offset
    for (var ni = 0; ni < fmt.nameLength; ni++) {
      if (ni < name.length) {
        var ch = name.charCodeAt(ni);
        data[hdrOff + fmt.nameOffset + ni] = (ch >= 0x41 && ch <= 0x5A) ? ch : (ch >= 0x30 && ch <= 0x39) ? ch : 0x20;
      } else {
        data[hdrOff + fmt.nameOffset + ni] = 0xA0;
      }
    }
    // Copy disk ID region from root header (includes pad + DOS type)
    var rootHdrOff = sectorOffset(fmt.headerTrack, fmt.headerSector);
    for (var idi = 0; idi < fmt.idLength; idi++) {
      data[hdrOff + fmt.idOffset + idi] = data[rootHdrOff + fmt.idOffset + idi];
    }
    // Self-reference
    data[hdrOff + fmt.subdirSelfRef] = hdrSec.track;
    data[hdrOff + fmt.subdirSelfRef + 1] = hdrSec.sector;
    // Parent header
    data[hdrOff + fmt.subdirParentRef] = parentHeaderT;
    data[hdrOff + fmt.subdirParentRef + 1] = parentHeaderS;

    // Write empty dir sector
    var dirOff = sectorOffset(dirSec.track, dirSec.sector);
    for (var di = 0; di < 256; di++) data[dirOff + di] = 0x00;
    data[dirOff + 0x00] = 0x00;
    data[dirOff + 0x01] = 0xFF;

    // Mark sectors as used in BAM
    bamMarkSectorUsed(data, hdrSec.track, hdrSec.sector, bamOff);
    bamMarkSectorUsed(data, dirSec.track, dirSec.sector, bamOff);

    // Create directory entry
    var entryOff = findFreeDirEntry(currentBuffer);
    if (entryOff < 0) {
      showModal('Add Directory Error', ['No free directory entry.']);
      return;
    }
    data[entryOff + 2] = 0x80 | fmt.subdirType; // subdir type + closed
    data[entryOff + 3] = hdrSec.track;
    data[entryOff + 4] = hdrSec.sector;
    for (var eni = 0; eni < fmt.nameLength; eni++) data[entryOff + 5 + eni] = data[hdrOff + fmt.nameOffset + eni];
    for (var eu = 21; eu < 30; eu++) data[entryOff + eu] = 0x00;
    data[entryOff + 30] = 2; // 2 blocks (header + dir)
    data[entryOff + 31] = 0;

    // Store parent entry reference in header
    data[hdrOff + fmt.subdirParentEntry] = entryOff >> 8;
    data[hdrOff + fmt.subdirParentEntry + 1] = entryOff & 0xFF;

    var info = parseCurrentDir(currentBuffer);
    renderDisk(info);
    updateMenuState();
    return;
  }

  if (currentFormat.subdirLinked || !currentFormat.supportsSubdirs || currentPartition) return;

  // Ask for partition name
  var name = await showInputModal('Directory Name', 'SUBDIR');
  if (!name) return;
  name = name.toUpperCase().substring(0, 16);

  // Ask for desired blocks free (minimum 80 = 2 data tracks + 1 system track)
  var blocksStr = await showInputModal('Blocks Free (min 80, multiples of 40)', '80');
  if (!blocksStr) return;
  var desiredBlocks = parseInt(blocksStr, 10);
  if (isNaN(desiredBlocks) || desiredBlocks < 80) {
    showModal('Add Directory Error', ['Minimum is 80 blocks (2 data tracks).']);
    return;
  }
  // Round up to next multiple of sectors-per-track
  var pSpt = currentFormat.partitionSpt;
  var dataTracks = Math.ceil(desiredBlocks / pSpt);
  var numTracks = dataTracks + 1; // +1 for system track (header, BAM, dir)
  var partSectors = numTracks * pSpt;
  var actualBlocks = dataTracks * pSpt;

  // Build true allocation map to find contiguous free tracks
  var allocated = buildTrueAllocationMap(currentBuffer);
  var fmt = currentFormat;

  // Find contiguous free tracks (must not include track 40, must start at sector 0)
  // Search for a contiguous run of numTracks tracks that are completely free
  var startTrack = -1;
  for (var t = 1; t <= currentTracks - numTracks + 1; t++) {
    // Skip ranges that include track 40 (system track)
    var endTrack = t + numTracks - 1;
    if (t <= fmt.dirTrack && endTrack >= fmt.dirTrack) continue;

    var allFree = true;
    for (var ct = t; ct <= endTrack; ct++) {
      var spt = fmt.sectorsPerTrack(ct);
      for (var cs = 0; cs < spt; cs++) {
        if (allocated[ct + ':' + cs]) { allFree = false; break; }
      }
      if (!allFree) break;
    }
    if (allFree) { startTrack = t; break; }
  }

  if (startTrack < 0) {
    showModal('Add Directory Error', ['Not enough contiguous free space. Need ' + numTracks + ' tracks (' + actualBlocks + ' blocks + 1 system track).']);
    return;
  }

  // Check we have a free directory entry
  if (!canInsertFile()) {
    showModal('Add Directory Error', ['No free directory entry available.']);
    return;
  }

  pushUndo();
  // Take snapshot for rollback
  var snapshot = currentBuffer.slice(0);
  var data = new Uint8Array(currentBuffer);

  // Create directory entry for the partition
  var entryOff = findFreeDirEntry(currentBuffer);
  if (entryOff < 0) {
    currentBuffer = snapshot;
    showModal('Add Directory Error', ['Failed to allocate directory entry.']);
    return;
  }

  // Subdir type + closed
  data[entryOff + 2] = 0x80 | currentFormat.subdirType;
  // Start track/sector (sector must be 0)
  data[entryOff + 3] = startTrack;
  data[entryOff + 4] = 0;
  // Name
  for (var ni = 0; ni < 16; ni++) {
    if (ni < name.length) {
      var ch = name.charCodeAt(ni);
      if (ch >= 0x41 && ch <= 0x5A) data[entryOff + 5 + ni] = ch;
      else if (ch >= 0x30 && ch <= 0x39) data[entryOff + 5 + ni] = ch;
      else if (ch === 0x20) data[entryOff + 5 + ni] = 0x20;
      else data[entryOff + 5 + ni] = 0x20;
    } else {
      data[entryOff + 5 + ni] = 0xA0;
    }
  }
  // Clear unused bytes
  for (var ui = 21; ui < 30; ui++) data[entryOff + ui] = 0x00;
  // Partition size in sectors
  data[entryOff + 30] = partSectors & 0xFF;
  data[entryOff + 31] = (partSectors >> 8) & 0xFF;

  // Format the partition: header (sector 0), BAM (sectors 1-2), directory (sector 3)
  var headerOff = sectorOffset(startTrack, 0);

  // Header sector — mirrors D81 root header layout
  data[headerOff + 0x00] = startTrack; // dir track (self-referencing)
  data[headerOff + 0x01] = 3;          // dir sector
  data[headerOff + 0x02] = 0x44;       // DOS version 'D'
  data[headerOff + 0x03] = 0xBB;
  // Disk name at offset 0x04
  for (var hi = 0; hi < 16; hi++) data[headerOff + 0x04 + hi] = data[entryOff + 5 + hi];
  data[headerOff + 0x14] = 0xA0;
  data[headerOff + 0x15] = 0xA0;
  // Disk ID
  data[headerOff + 0x16] = 0x31; // '1'
  data[headerOff + 0x17] = 0x41; // 'A'
  data[headerOff + 0x18] = 0xA0;
  // DOS type
  data[headerOff + 0x19] = 0x33; // '3'
  data[headerOff + 0x1A] = 0x44; // 'D'
  for (var fi = 0x1B; fi < 0x100; fi++) data[headerOff + fi] = 0x00;

  // BAM sector 1 (startTrack, 1) — covers tracks 1..40 of the partition
  var bam1Off = sectorOffset(startTrack, 1);
  data[bam1Off + 0x00] = startTrack;
  data[bam1Off + 0x01] = 2;        // link to BAM sector 2
  data[bam1Off + 0x02] = 0x44;     // DOS version
  data[bam1Off + 0x03] = 0xBB;
  data[bam1Off + 0x04] = 0x31;     // ID copy
  data[bam1Off + 0x05] = 0x41;
  for (var b1 = 0x06; b1 < 0x10; b1++) data[bam1Off + b1] = 0x00;

  // BAM sector 2 (startTrack, 2) — covers tracks 41..80 of the partition
  var bam2Off = sectorOffset(startTrack, 2);
  data[bam2Off + 0x00] = 0x00;     // end of chain
  data[bam2Off + 0x01] = 0xFF;
  data[bam2Off + 0x02] = 0x44;
  data[bam2Off + 0x03] = 0xBB;
  data[bam2Off + 0x04] = 0x31;
  data[bam2Off + 0x05] = 0x41;
  for (var b2 = 0x06; b2 < 0x10; b2++) data[bam2Off + b2] = 0x00;

  // Initialize BAM entries for each track in the partition
  for (var pt = 1; pt <= numTracks; pt++) {
    var base;
    if (pt <= 40) {
      base = bam1Off + 0x10 + (pt - 1) * 6;
    } else {
      base = bam2Off + 0x10 + (pt - 41) * 6;
    }

    if (pt === 1) {
      // First track: sectors 0-3 used (header, BAM1, BAM2, first dir sector)
      data[base] = 40 - 4; // 36 free
      for (var bb = 0; bb < 5; bb++) data[base + 1 + bb] = 0xFF;
      data[base + 1] &= ~(1 << 0); // sector 0
      data[base + 1] &= ~(1 << 1); // sector 1
      data[base + 1] &= ~(1 << 2); // sector 2
      data[base + 1] &= ~(1 << 3); // sector 3
    } else {
      // Other tracks: all 40 sectors free
      data[base] = 40;
      for (var bb2 = 0; bb2 < 5; bb2++) data[base + 1 + bb2] = 0xFF;
    }
  }

  // Initialize first directory sector (startTrack, 3)
  var dirOff = sectorOffset(startTrack, 3);
  data[dirOff + 0] = 0x00; // end of chain
  data[dirOff + 1] = 0xFF;
  for (var di = 2; di < 256; di++) data[dirOff + di] = 0x00;

  // Mark all partition sectors as allocated in the root BAM
  var rootBamOff = sectorOffset(fmt.bamTrack, fmt.bamSector);
  for (var rt = startTrack; rt < startTrack + numTracks; rt++) {
    var spt = fmt.sectorsPerTrack(rt);
    // Clear all bits (mark all sectors as used)
    var rbase;
    if (rt <= 40) {
      rbase = rootBamOff + 0x10 + (rt - 1) * 6;
    } else {
      rbase = rootBamOff + 256 + 0x10 + (rt - 41) * 6;
    }
    data[rbase] = 0; // 0 free
    for (var rb = 0; rb < 5; rb++) data[rbase + 1 + rb] = 0x00; // all bits clear = all used
  }

  // Success
  selectedEntryIndex = entryOff;
  var info = parseDisk(currentBuffer);
  renderDisk(info);
  updateMenuState();
  showModal('Directory Created', [
    'Directory "' + name + '" created.',
    numTracks + ' tracks (' + startTrack + '-' + (startTrack + numTracks - 1) + '), ' + actualBlocks + ' blocks free.',
    'Double-click to enter the directory.'
  ]);
});

