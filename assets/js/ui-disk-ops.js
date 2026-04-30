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

  // ── Build Track Usage view (compact bars per track) ──
  var trackUsageLegend = '<div class="bam-legend">' +
    '<span class="bam-legend-item"><span class="bam-legend-box" style="background:#6c9bd2"></span> 0-50%</span>' +
    '<span class="bam-legend-item"><span class="bam-legend-box" style="background:#4a7ab5"></span> 50-70%</span>' +
    '<span class="bam-legend-item"><span class="bam-legend-box" style="background:#2d5a8e"></span> 70-90%</span>' +
    '<span class="bam-legend-item"><span class="bam-legend-box" style="background:#1a3a5c"></span> 90-100%</span>' +
    '</div>';
  var trackUsageHtml = trackUsageLegend + '<div class="bam-viewer">';
  for (t = 1; t <= bamTracks; t++) {
    var ts = trackStats[t];
    var pct = ts.spt > 0 ? Math.round(ts.used / ts.spt * 100) : 0;
    var barColor = pct > 90 ? '#1a3a5c' : pct > 70 ? '#2d5a8e' : pct > 50 ? '#4a7ab5' : '#6c9bd2';
    trackUsageHtml += '<div class="bam-track">';
    trackUsageHtml += '<span class="bam-track-num' + (bamCheck.errorTracks[t] ? ' error' : '') + '">$' + t.toString(16).toUpperCase().padStart(2, '0') + '</span>';
    trackUsageHtml += '<span class="bam-compact-bar" title="T:$' + t.toString(16).toUpperCase().padStart(2, '0') +
      ' \u2014 ' + ts.free + ' free, ' + ts.used + ' used (' + pct + '%)">' +
      '<span class="bam-compact-fill" style="width:' + pct + '%;background:' + barColor + '"></span></span>';
    trackUsageHtml += '<span class="bam-compact-info">' + ts.free + '/' + ts.spt + '</span>';
    trackUsageHtml += '</div>';
  }
  trackUsageHtml += '</div>';

  // ── Build File Usage view (per-file fragmentation) ──
  var dirInfo = parseCurrentDir(currentBuffer);
  var fragFiles = [];
  for (var fi = 0; fi < dirInfo.entries.length; fi++) {
    var fe = dirInfo.entries[fi];
    if (fe.deleted) continue;
    var ftb = data[fe.entryOff + 2];
    if (!(ftb & 0x80)) continue;
    var fti = ftb & 0x07;
    if (fti === 0) continue;
    var sectors = [];
    forEachFileSector(data, fe.entryOff, function(ft2, fs2) {
      sectors.push({ t: ft2, s: fs2 });
    });
    if (sectors.length < 2) continue;
    // Count non-adjacent transitions (different track or non-sequential sector with interleave)
    var jumps = 0;
    for (var si2 = 1; si2 < sectors.length; si2++) {
      if (sectors[si2].t !== sectors[si2 - 1].t) jumps++;
      // Same track but not the expected next sector — count as fragmented
      else if (Math.abs(sectors[si2].s - sectors[si2 - 1].s) > fmt.sectorsPerTrack(sectors[si2].t) / 2) jumps++;
    }
    var fragPct = Math.round(jumps / (sectors.length - 1) * 100);
    var fname = petsciiToReadable(fe.name || '').trim() || '?';
    fragFiles.push({ name: fname, blocks: sectors.length, jumps: jumps, pct: fragPct });
  }
  fragFiles.sort(function(a, b) { return b.pct - a.pct; });
  var diskFragPct = 0;
  if (fragFiles.length > 0) {
    var totalJumps = 0, totalTrans = 0;
    for (var ff = 0; ff < fragFiles.length; ff++) {
      totalJumps += fragFiles[ff].jumps;
      totalTrans += fragFiles[ff].blocks - 1;
    }
    diskFragPct = totalTrans > 0 ? Math.round(totalJumps / totalTrans * 100) : 0;
  }
  var fileUsageHtml = '<div style="font-size:12px;font-weight:bold;color:var(--text-muted)">Fragmentation: ' + diskFragPct + '%</div>';
  if (fragFiles.length === 0) {
    fileUsageHtml += '<div style="margin-top:8px;color:var(--text-muted)">No multi-block files on this disk.</div>';
  } else {
    fileUsageHtml += '<table style="width:100%;border-collapse:collapse;margin-top:4px;font-size:11px">';
    fileUsageHtml += '<tr style="color:var(--text-muted);border-bottom:1px solid var(--border)">' +
      '<td style="padding:2px 8px 2px 0">File</td>' +
      '<td style="padding:2px 8px;text-align:right">Blocks</td>' +
      '<td style="padding:2px 8px;text-align:right">Frag</td>' +
      '<td style="padding:2px 0;width:80px"></td></tr>';
    for (var ffi = 0; ffi < fragFiles.length; ffi++) {
      var f = fragFiles[ffi];
      var barCol = f.pct === 0 ? 'var(--accent)' : f.pct <= 30 ? '#6c9bd2' : f.pct <= 60 ? 'var(--color-warn)' : 'var(--color-error)';
      fileUsageHtml += '<tr>' +
        '<td style="padding:2px 8px 2px 0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:200px">' + escHtml(f.name) + '</td>' +
        '<td style="padding:2px 8px;text-align:right">' + f.blocks + '</td>' +
        '<td style="padding:2px 8px;text-align:right">' + f.pct + '%</td>' +
        '<td style="padding:2px 0"><div style="background:var(--hover);border-radius:2px;height:8px;overflow:hidden">' +
          '<div style="width:' + Math.max(f.pct > 0 ? 3 : 0, f.pct) + '%;height:100%;background:' + barCol + '"></div>' +
        '</div></td></tr>';
    }
    fileUsageHtml += '</table>';
  }

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

  // ── Compose final HTML with tabs ──
  // Optional Partitions panel for D1M/D2M/D4M \u2014 read-only view of the
  // CMD FD system partition table on the last track. The disk itself
  // opens as a flat filesystem; this surfaces the table for inspection.
  var partsTabHtml = '', partsPanelHtml = '';
  var fmtKey = (fmt.name || '').toLowerCase();
  if (fmtKey === 'd1m' || fmtKey === 'd2m' || fmtKey === 'd4m') {
    partsTabHtml = '<span class="bam-tab" data-bam-view="partitions">Partitions</span>';
    var pInfo = readCmdContainerPartitions(currentBuffer, fmtKey);
    var panel;
    if (!pInfo) {
      panel = '<div class="bam-partitions-empty" style="padding:12px;color:var(--text-muted)">' +
        'No CMD FD system partition on this disk (magic "CMD FD SERIES" not found on track ' +
        currentTracks + ' sector 5).</div>';
    } else {
      panel = '<table class="bam-partitions" style="width:100%;border-collapse:collapse">' +
        '<thead><tr>' +
        '<th style="text-align:left;padding:4px 8px;border-bottom:1px solid var(--border)">Slot</th>' +
        '<th style="text-align:left;padding:4px 8px;border-bottom:1px solid var(--border)">Type</th>' +
        '<th style="text-align:left;padding:4px 8px;border-bottom:1px solid var(--border)">Name</th>' +
        '<th style="text-align:right;padding:4px 8px;border-bottom:1px solid var(--border)">Size</th>' +
        '</tr></thead><tbody>';
      for (var pi = 0; pi < pInfo.partitions.length; pi++) {
        var p = pInfo.partitions[pi];
        panel += '<tr>' +
          '<td style="padding:4px 8px;font-family:monospace">' + p.index + '</td>' +
          '<td style="padding:4px 8px">' + escHtml(p.typeName) + '</td>' +
          '<td style="padding:4px 8px"><b>' + escHtml(p.name) + '</b></td>' +
          '<td style="padding:4px 8px;text-align:right;font-family:monospace">' + p.sizeBlocks + '</td>' +
          '</tr>';
      }
      panel += '</tbody></table>';
    }
    partsPanelHtml = '<div class="bam-view-content" data-bam-view="partitions" style="display:none">' +
      panel + '</div>';
  }

  var title = 'BAM \u2014 ' + totalFree + ' free, ' + totalUsed + ' used of ' +
    (totalFree + totalUsed) + ' sectors';
  // Wrap in .bam-layout so the tab bar stays pinned and only the active
  // tab's content scrolls vertically (see .modal-body:has(.bam-layout)).
  var html = '<div class="bam-layout">' + bamWarnings;

  // Disk Map tab content (radial visualization)
  var diskMapHtml = '<div class="disk-map-wrap">' +
    '<canvas class="disk-map-canvas" id="disk-map-canvas"></canvas>' +
    '</div>';

  if (forceCompact) {
    // High-SPT: BAM + Track Usage + File Usage + Disk Map tabs
    html += '<div class="bam-tabs">' +
      '<span class="bam-tab active" data-bam-view="map">BAM</span>' +
      '<span class="bam-tab" data-bam-view="trackusage">Track Usage</span>' +
      '<span class="bam-tab" data-bam-view="fileusage">File Fragmentation</span>' +
      '<span class="bam-tab" data-bam-view="diskmap">Disk Map</span>' +
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
    html += '<div class="bam-tab-scroll">';
    html += '<div class="bam-view-content" data-bam-view="map">' + mapLegend +
      '<div class="bam-map-scroll"><canvas id="bam-map-canvas" width="' + canvasW + '" height="' + canvasH + '" style="cursor:crosshair;display:block"></canvas></div></div>';
    html += '<div class="bam-view-content" data-bam-view="trackusage" style="display:none">' + trackUsageHtml + '</div>';
    html += '<div class="bam-view-content" data-bam-view="fileusage" style="display:none">' + fileUsageHtml + '</div>';
    html += '<div class="bam-view-content" data-bam-view="diskmap" style="display:none">' + diskMapHtml + '</div>';
    html += partsPanelHtml;
    html += '</div>';
  } else {
    // Tab switcher — BAM + Track Usage + File Usage + Disk Map
    html += '<div class="bam-tabs">' +
      '<span class="bam-tab active" data-bam-view="sectors">BAM</span>' +
      '<span class="bam-tab" data-bam-view="trackusage">Track Usage</span>' +
      '<span class="bam-tab" data-bam-view="fileusage">File Fragmentation</span>' +
      '<span class="bam-tab" data-bam-view="diskmap">Disk Map</span>' +
      partsTabHtml +
      '</div>';
    html += '<div class="bam-tab-scroll">';
    html += '<div class="bam-view-content" data-bam-view="sectors">' + sectorsHtml + '</div>';
    html += '<div class="bam-view-content" data-bam-view="trackusage" style="display:none">' + trackUsageHtml + '</div>';
    html += '<div class="bam-view-content" data-bam-view="fileusage" style="display:none">' + fileUsageHtml + '</div>';
    html += '<div class="bam-view-content" data-bam-view="diskmap" style="display:none">' + diskMapHtml + '</div>';
    html += partsPanelHtml;
    html += '</div>';
  }
  html += '</div>';

  showModal(title, []);
  setModalSize('md');
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
      var scroller = bamBody.querySelector('.bam-tab-scroll');
      if (scroller) scroller.scrollTop = 0;
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

  // ── Disk Map (radial/spiral) canvas ──────────────────────────────────
  var diskMapCanvas = document.getElementById('disk-map-canvas');
  if (diskMapCanvas) {
    var dmCtx = diskMapCanvas.getContext('2d');
    var dmCs = getComputedStyle(document.documentElement);
    var dmBg = dmCs.getPropertyValue('--bg').trim();
    var dmAccent = dmCs.getPropertyValue('--accent').trim();
    var dmMuted = dmCs.getPropertyValue('--text-muted').trim();
    var dmText = dmCs.getPropertyValue('--text').trim();

    // Reuse getCssColor if it exists, or define locally
    function dmGetColor(cls) {
      var el = document.createElement('span');
      el.className = 'bam-sector ' + cls;
      el.style.display = 'none';
      document.body.appendChild(el);
      var style = getComputedStyle(el);
      var bg = style.backgroundColor;
      var op = parseFloat(style.opacity);
      document.body.removeChild(el);
      if (op < 1) {
        var m = bg.match(/\d+/g);
        if (m) return 'rgba(' + m[0] + ',' + m[1] + ',' + m[2] + ',' + op + ')';
      }
      return bg;
    }
    var dmColUsed = dmGetColor('used');
    var dmColFree = dmGetColor('free');
    var dmColDirUsed = dmGetColor('dir-used');
    var dmColDirFree = dmGetColor('dir-free');
    var dmColError = dmGetColor('error');
    var dmColOrphan = dmGetColor('orphan');

    var dmSize = Math.min(520, window.innerWidth - 80, window.innerHeight - 260);
    diskMapCanvas.width = dmSize;
    diskMapCanvas.height = dmSize;
    var dmCx = dmSize / 2, dmCy = dmSize / 2;
    var dmOuterR = dmSize / 2 - 10;
    var dmInnerR = dmSize * 0.08; // spindle hole
    var dmHitMap = []; // { track, sector, path }

    function dmSectorColor(t, s) {
      var key = t + ':' + s;
      var isDirTrack = (t === fmt.dirTrack);
      var isFree = checkSectorFree(data, bamOff, t, s);
      if (isDirTrack) return isFree ? dmColDirFree : dmColDirUsed;
      if (bamCheck.errorSectors[key]) return dmColError;
      if (bamCheck.orphanSectors[key]) return dmColOrphan;
      return isFree ? dmColFree : dmColUsed;
    }

    function dmTooltip(t, s) {
      var key = t + ':' + s;
      var tt = 'T:$' + t.toString(16).toUpperCase().padStart(2, '0') +
        ' S:$' + s.toString(16).toUpperCase().padStart(2, '0');
      if (bamCheck.errorSectors[key]) tt += ' \u26a0 BAM error';
      else if (bamCheck.orphanSectors[key]) tt += ' (orphan)';
      else if (checkSectorFree(data, bamOff, t, s)) tt += ' (free)';
      else if (sectorOwner[key]) tt += ' (' + petsciiToReadable(sectorOwner[key]) + ')';
      else tt += ' (used)';
      return tt;
    }

    function drawRings() {
      dmHitMap = [];
      dmCtx.fillStyle = dmBg;
      dmCtx.fillRect(0, 0, dmSize, dmSize);
      var ringWidth = (dmOuterR - dmInnerR) / bamTracks;
      var sectorGap = 0.008; // radians between sectors
      var trackGap = 1; // pixels between tracks

      for (var t = 1; t <= bamTracks; t++) {
        var spt = fmt.sectorsPerTrack(t);
        var outerR = dmOuterR - (t - 1) * ringWidth;
        var innerR = outerR - ringWidth + trackGap;
        for (var s = 0; s < spt; s++) {
          var startA = (s / spt) * Math.PI * 2 - Math.PI / 2 + sectorGap / 2;
          var endA = ((s + 1) / spt) * Math.PI * 2 - Math.PI / 2 - sectorGap / 2;
          var path = new Path2D();
          path.arc(dmCx, dmCy, outerR, startA, endA);
          path.arc(dmCx, dmCy, innerR, endA, startA, true);
          path.closePath();
          dmCtx.fillStyle = dmSectorColor(t, s);
          dmCtx.fill(path);
          dmHitMap.push({ track: t, sector: s, path: path });
        }
      }
      // Spindle hole
      dmCtx.beginPath();
      dmCtx.arc(dmCx, dmCy, dmInnerR, 0, Math.PI * 2);
      dmCtx.fillStyle = dmBg;
      dmCtx.fill();
      // Disk name in center
      var diskInfo = parseCurrentDir(currentBuffer);
      if (diskInfo && diskInfo.diskName) {
        dmCtx.fillStyle = dmMuted;
        dmCtx.font = '10px monospace';
        dmCtx.textAlign = 'center';
        dmCtx.textBaseline = 'middle';
        var dName = petsciiToReadable(diskInfo.diskName).trim();
        dmCtx.fillText(dName, dmCx, dmCy);
      }
    }

    drawRings();

    // Hover tooltip
    var dmLastTitle = '';
    diskMapCanvas.addEventListener('mousemove', function(e) {
      var rect = diskMapCanvas.getBoundingClientRect();
      var mx = e.clientX - rect.left, my = e.clientY - rect.top;
      for (var hi = dmHitMap.length - 1; hi >= 0; hi--) {
        if (dmCtx.isPointInPath(dmHitMap[hi].path, mx, my)) {
          var tt = dmTooltip(dmHitMap[hi].track, dmHitMap[hi].sector);
          if (tt !== dmLastTitle) { diskMapCanvas.title = tt; dmLastTitle = tt; }
          return;
        }
      }
      if (dmLastTitle) { diskMapCanvas.title = ''; dmLastTitle = ''; }
    });

    // Click to open sector editor
    diskMapCanvas.addEventListener('click', function(e) {
      var rect = diskMapCanvas.getBoundingClientRect();
      var mx = e.clientX - rect.left, my = e.clientY - rect.top;
      for (var hi = dmHitMap.length - 1; hi >= 0; hi--) {
        if (dmCtx.isPointInPath(dmHitMap[hi].path, mx, my)) {
          document.getElementById('modal-overlay').classList.remove('open');
          showSectorHexEditor(dmHitMap[hi].track, dmHitMap[hi].sector);
          return;
        }
      }
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

  // Validate custom interleave and update button/input state
  function validateCustomInput() {
    var selected = body.querySelector('input[name="opt-preset"]:checked');
    if (!selected || selected.value !== 'custom') {
      customInput.classList.remove('invalid');
      okBtn.disabled = false;
      return;
    }
    var cStr = customInput.value.trim();
    if (cStr === '') {
      customInput.classList.remove('invalid');
      okBtn.disabled = false;
      return;
    }
    var val = parseInt(cStr, 16);
    var valid = !isNaN(val) && val >= 1 && val <= 20;
    customInput.classList.toggle('invalid', !valid);
    okBtn.disabled = !valid;
  }
  customInput.addEventListener('input', validateCustomInput);
  presetLabels.forEach(function(label) {
    label.querySelector('input[type="radio"]').addEventListener('change', validateCustomInput);
  });

  okBtn.addEventListener('click', function() {
    var selected = body.querySelector('input[name="opt-preset"]:checked');
    var ilVal;
    if (selected.value === 'custom') {
      var cStr = customInput.value.trim();
      if (cStr === '') {
        ilVal = fmt.defaultInterleave;
      } else {
        ilVal = parseInt(cStr, 16);
        if (isNaN(ilVal) || ilVal < 1 || ilVal > 20) return;
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

// ── Disk menu: Resize DNP Image ──────────────────────────────────────
document.getElementById('opt-resize-dnp').addEventListener('click', async function(e) {
  e.stopPropagation();
  var optEl = document.getElementById('opt-resize-dnp');
  if (optEl.classList.contains('disabled')) return;
  closeMenus();

  var oldTracks = currentTracks;
  var oldKB = Math.round(oldTracks * 65536 / 1024);
  var input = await showInputModal(
    'Resize DNP (current: ' + oldTracks + ' tracks, ' + oldKB + ' KB)',
    String(oldTracks)
  );
  if (input === null) return;
  var newTracks = parseInt(input, 10);
  if (isNaN(newTracks) || newTracks < 2 || newTracks > 255) {
    showModal('Resize', ['Track count must be between 2 and 255.']);
    return;
  }
  if (newTracks === oldTracks) return;

  // Work on a scratch buffer so a failure leaves the real image untouched.
  var scratch = currentBuffer.slice(0);
  var attempt = resizeDnpImage(scratch, newTracks);

  // Shrink blocked? Auto-compact and retry. optimizeDisk reads currentBuffer/
  // currentTracks indirectly via parseDisk, so point it at the scratch copy
  // for the compaction pass.
  if (attempt.error === 'blocked' && newTracks < oldTracks) {
    var savedBuf = currentBuffer;
    currentBuffer = scratch;
    try {
      optimizeDisk(scratch, currentFormat.defaultInterleave, true);
    } finally {
      currentBuffer = savedBuf;
      currentTracks = oldTracks;
    }
    attempt = resizeDnpImage(scratch, newTracks);
  }

  if (attempt.error === 'blocked') {
    var list = attempt.owners.slice(0, 20).map(function(o) {
      return o.owner + ' @ ' + o.track + ':' + o.sector;
    });
    if (attempt.owners.length > 20) list.push('\u2026 and ' + (attempt.owners.length - 20) + ' more');
    showModal('Cannot Shrink', [
      'After auto-compact, ' + attempt.owners.length + ' sector(s) still live on tracks ' + (newTracks + 1) + '\u2013' + oldTracks + ':',
      ''
    ].concat(list).concat([
      '',
      'Remove the offending files or choose a larger track count.'
    ]));
    return;
  }
  if (attempt.error) {
    showModal('Resize Error', [attempt.error]);
    return;
  }

  pushUndo();
  currentBuffer = attempt.buffer;
  var tab = getActiveTab();
  if (tab) tab.buffer = currentBuffer;
  var info = parseCurrentDir(currentBuffer);
  // parseDisk (inside parseCurrentDir) updates currentTracks from the new buffer size.
  if (tab) tab.tracks = currentTracks;
  renderDisk(info);
  updateMenuState();
  var newKB = Math.round(newTracks * 65536 / 1024);
  showModal('Resize', [
    'DNP image resized from ' + oldTracks + ' tracks (' + oldKB + ' KB) to ' + newTracks + ' tracks (' + newKB + ' KB).'
  ]);
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
    showSectorHexDiff(body, diskA, diskB, p.track, p.sector);
  });
}

// Hex side-by-side: render both A's and B's bytes for a sector with
// differing bytes highlighted. Computes the sector offset using diskA's
// format (formats match — checked before this is reachable).
function showSectorHexDiff(body, diskA, diskB, track, sector) {
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

  var html =
    '<div class="cmp-sector-hex-header">' +
      'T:$' + track.toString(16).toUpperCase().padStart(2, '0') +
      ' S:$' + sector.toString(16).toUpperCase().padStart(2, '0') +
      ' <span class="text-muted">(byte $' + off.toString(16).toUpperCase().padStart(6, '0') +
      ', ' + diffN + ' bytes differ)</span>' +
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

  function fileRow(p, marker, markerClass) {
    var nameA = p.a ? renderRichName(p.a.richName) : '<span class="text-muted">&mdash;</span>';
    var typeA = p.a ? escHtml(p.a.type) : '';
    var blocksA = p.a ? p.a.blocks : '';
    var nameB = p.b ? renderRichName(p.b.richName) : '<span class="text-muted">&mdash;</span>';
    var typeB = p.b ? escHtml(p.b.type) : '';
    var blocksB = p.b ? p.b.blocks : '';
    var sizeA = p.a ? p.a.data.length : 0;
    var sizeB = p.b ? p.b.data.length : 0;
    return '<tr>' +
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

  // Single table with all sections so columns line up across groups.
  // Section labels become full-width header rows inside the same table.
  function sectionRows(title, count, rows, marker, markerClass) {
    if (count === 0) return '';
    var html = '<tr class="cmp-section-row"><td colspan="8">' +
      title + '<span class="cmp-section-count">(' + count + ')</span></td></tr>';
    rows.forEach(function(p) { html += fileRow(p, marker, markerClass); });
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
      '</tr></thead><tbody>' +
        sectionRows('Differ',    nDiff, diff.differ,    ICON_NE,    'cmp-marker-ne') +
        sectionRows('Only in A', nA,    diff.onlyA,     ICON_ONLYA, 'cmp-marker-only-a') +
        sectionRows('Only in B', nB,    diff.onlyB,     ICON_ONLYB, 'cmp-marker-only-b') +
        sectionRows('Identical', nEq,   diff.identical, ICON_EQ,    'cmp-marker-eq') +
      '</tbody>' +
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

