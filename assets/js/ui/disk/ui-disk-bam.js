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

