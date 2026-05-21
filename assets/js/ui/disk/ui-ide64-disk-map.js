// ── IDE64 .hdd BAM modal ──────────────────────────────────────────────
// Tabbed modal opened from View → BAM whenever an .hdd image is the
// active tab:
//   * Partitions tab — horizontal disk map (MBR, partition table,
//     partitions, gaps, backup mirror)
//   * <partition-name> tab — 64×64 CFS bitmap heat map, only shown
//     when the user is currently inside a CFS partition
// The partition tab is the default when one's active; otherwise the
// Partitions tab is the default. Switching tabs swaps the body content
// and the footer (heat-map gets a Density/Ownership toggle).

(function() {
  var bamEl = document.getElementById('opt-view-bam');
  if (!bamEl) return;
  bamEl.addEventListener('click', function(ev) {
    if (typeof hddBuffer === 'undefined' || !hddBuffer) return;
    if (typeof hddPartitions === 'undefined' || !hddPartitions) return;
    ev.stopImmediatePropagation();
    if (typeof closeMenus === 'function') closeMenus();
    showIde64BamModal();
  }, true);
})();

function showIde64BamModal() {
  if (typeof showViewerModal !== 'function') return;
  var boot = parseIde64BootSector(hddBuffer);
  if (!boot) return;
  var info = readIde64Partitions(hddBuffer);
  if (!info) return;

  var inPartition = (typeof cfsPartitionIdx !== 'undefined') && cfsPartitionIdx >= 0;
  var partition = inPartition ? (hddPartitions && hddPartitions[cfsPartitionIdx]) : null;
  if (inPartition && !partition) inPartition = false;
  var partName = inPartition ? (petsciiToReadable(partition.name || '').trim() || 'partition') : null;

  // Default to the partition tab when inside a partition; the disk-map
  // tab otherwise. Either tab is reachable from the other via the tab
  // bar at the top of the modal.
  var activeTab = inPartition ? 'partition' : 'disk';

  var diskCtx = _buildIde64DiskMapContext(boot, info, hddBuffer);
  // partCtx is mutable: starts null on the partition-list view, gets
  // populated lazily when the user double-clicks a partition in the
  // disk-map strip, replaced when they double-click a different one.
  var partCtx = inPartition ? _buildCfsBamContext(hddBuffer, partition) : null;
  var partTabName = partName;

  // Both tab buttons + panels are always in the DOM; the partition
  // button just gets display:none until a partition is loaded.
  var tabsHtml = '<div class="bam-tabs">' +
    '<span class="bam-tab' + (activeTab === 'disk' ? ' active' : '') + '" data-tab="disk">Partitions</span>' +
    '<span class="bam-tab' + (activeTab === 'partition' ? ' active' : '') + '" data-tab="partition"' +
      (inPartition ? '' : ' style="display:none"') + '>' +
      (inPartition ? escHtml(partTabName) : '') +
    '</span>' +
    '</div>';

  var bodyHtml =
    '<div class="bam-layout">' +
      tabsHtml +
      '<div class="bam-tab-scroll">' +
        '<div class="bam-view-content" data-tab="disk"' + (activeTab !== 'disk' ? ' style="display:none"' : '') + '>' +
          _renderDiskMapHtml(diskCtx) +
        '</div>' +
        '<div class="bam-view-content" data-tab="partition"' + (activeTab !== 'partition' ? ' style="display:none"' : '') + '>' +
          (inPartition ? _renderCfsBamHtml(partCtx) : '') +
        '</div>' +
      '</div>' +
    '</div>';

  var title = 'Disk Map — ' + (boot.label || 'IDE64 .hdd');
  // 'lg' (720px fixed) — modal frame stays the same width across tab switches.
  var body = showViewerModal(title, bodyHtml, 'lg');

  function activateTab(name) {
    body.querySelectorAll('.bam-tab').forEach(function(t) {
      t.classList.toggle('active', t.getAttribute('data-tab') === name);
    });
    body.querySelectorAll('.bam-view-content').forEach(function(c) {
      c.style.display = c.getAttribute('data-tab') === name ? '' : 'none';
    });
    setFooter(name);
  }

  // Called when the user double-clicks a partition region in the disk
  // map. Builds (or rebuilds) the heat-map context for that slot, swaps
  // the partition tab content, updates the tab label, and activates it.
  // Keeps the underlying disk view unchanged — we only switch tabs
  // within this modal.
  function loadPartitionIntoTab(slot) {
    if (!hddPartitions || !hddPartitions[slot]) return;
    var p = hddPartitions[slot];
    if (p.type !== 0x01) return;
    partCtx = _buildCfsBamContext(hddBuffer, p);
    partTabName = petsciiToReadable(p.name || '').trim() || 'partition';
    var partTabBtn = body.querySelector('.bam-tab[data-tab="partition"]');
    if (partTabBtn) {
      partTabBtn.style.display = '';
      partTabBtn.textContent = partTabName;
    }
    var partPanel = body.querySelector('.bam-view-content[data-tab="partition"]');
    if (partPanel) {
      partPanel.innerHTML = _renderCfsBamHtml(partCtx);
      _wireCfsBamHandlers(body, partCtx);
    }
    activateTab('partition');
  }

  _wireDiskMapHandlers(body, diskCtx, loadPartitionIntoTab);
  if (inPartition) _wireCfsBamHandlers(body, partCtx);

  function setFooter(tab) {
    var footer = document.querySelector('#modal-overlay .modal-footer');
    if (!footer) return;
    if (tab === 'partition' && partCtx) {
      footer.innerHTML =
        '<button id="cfs-bam-toggle" class="modal-btn-secondary">' +
          (partCtx.mode === 'density' ? 'Color by file ownership' : 'Color by density') +
        '</button>' +
        '<button id="ide64-bam-close">Close</button>';
      document.getElementById('cfs-bam-toggle').addEventListener('click', function() {
        partCtx.mode = (partCtx.mode === 'density') ? 'ownership' : 'density';
        var hostEl = body.querySelector('.bam-view-content[data-tab="partition"]');
        if (hostEl) {
          hostEl.innerHTML = _renderCfsBamHtml(partCtx);
          _wireCfsBamHandlers(body, partCtx);
        }
        this.textContent = partCtx.mode === 'density' ? 'Color by file ownership' : 'Color by density';
      });
    } else {
      footer.innerHTML = '<button id="ide64-bam-close">Close</button>';
    }
    document.getElementById('ide64-bam-close').addEventListener('click', function() {
      document.getElementById('modal-overlay').classList.remove('open');
    });
  }

  body.querySelectorAll('.bam-tab').forEach(function(tab) {
    tab.addEventListener('click', function() {
      if (tab.getAttribute('data-tab') === 'partition' && !partCtx) return; // not loaded yet
      activateTab(tab.getAttribute('data-tab'));
    });
  });
  setFooter(activeTab);
}

// ── Disk-map tab ─────────────────────────────────────────────────────

function _buildIde64DiskMapContext(boot, info, buffer) {
  var lastLba = (boot.lastSector && boot.lastSector.lba) ? boot.lastSector.addr : 0;
  if (!lastLba) lastLba = Math.floor(buffer.byteLength / IDE64_SECTOR_SIZE) - 1;
  var totalLbas = lastLba + 1;
  var partDirLba = (boot.partDir && boot.partDir.lba) ? boot.partDir.addr : 1;
  var backupLba = (boot.partDirBackup && boot.partDirBackup.lba) ? boot.partDirBackup.addr : lastLba;

  var regions = [];
  regions.push({ startLba: 0, endLba: 0, kind: 'mbr', label: 'MBR + boot sector' });
  if (partDirLba !== 0) regions.push({ startLba: partDirLba, endLba: partDirLba, kind: 'parttab', label: 'Partition table' });
  if (backupLba !== partDirLba && backupLba <= lastLba) {
    regions.push({ startLba: backupLba, endLba: backupLba, kind: 'parttab-backup', label: 'Partition-table backup' });
  }
  for (var i = 0; i < info.partitions.length; i++) {
    var p = info.partitions[i];
    if (p.empty) continue;
    if (p.startLba == null || p.endLba == null) continue;
    if (p.endLba < p.startLba) continue;
    regions.push({
      startLba: p.startLba,
      endLba: p.endLba,
      kind: p.deleted ? 'partition-deleted' : 'partition',
      slot: i,
      name: petsciiToReadable(p.name || '').trim() || '(unnamed)',
      type: p.typeName,
      typeCode: p.type,
      writeable: !!p.writeable,
      hidden: !!p.hidden,
      isDefault: (boot.defaultPart === i),
    });
  }
  regions.sort(function(a, b) { return a.startLba - b.startLba; });

  var withGaps = [];
  var cursor = 0;
  for (var ri = 0; ri < regions.length; ri++) {
    var r = regions[ri];
    if (r.startLba > cursor) withGaps.push({ startLba: cursor, endLba: r.startLba - 1, kind: 'gap' });
    withGaps.push(r);
    cursor = Math.max(cursor, r.endLba + 1);
  }
  if (cursor <= lastLba) withGaps.push({ startLba: cursor, endLba: lastLba, kind: 'gap' });

  return { boot: boot, lastLba: lastLba, totalLbas: totalLbas, withGaps: withGaps };
}

function _renderDiskMapHtml(ctx) {
  function regionColor(r) {
    if (r.kind === 'mbr')               return '#b88a3e';
    if (r.kind === 'parttab')           return '#d49a48';
    if (r.kind === 'parttab-backup')    return '#d49a48';
    if (r.kind === 'gap')               return '#1c2030';
    if (r.kind === 'partition-deleted') return '#5a4040';
    if (r.typeCode === 0x02)            return '#9a8030';
    if (r.typeCode === 0x01) {
      if (r.hidden) return '#3a4855';
      if (!r.writeable) return '#3a5a7a';
      return '#4a8fbd';
    }
    return '#666';
  }
  function isSystem(r) {
    return r.kind === 'mbr' || r.kind === 'parttab' || r.kind === 'parttab-backup';
  }
  function systemLabel(r) {
    if (r.kind === 'mbr') return 'MBR';
    if (r.kind === 'parttab') return 'PT';
    if (r.kind === 'parttab-backup') return 'PT⁺';
    return '';
  }
  function fmtSize(sectors) {
    var bytes = sectors * 512;
    if (bytes >= 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(bytes >= 100 * 1024 * 1024 ? 0 : 1) + ' MiB';
    if (bytes >= 1024) return (bytes / 1024).toFixed(0) + ' KiB';
    return bytes + ' B';
  }
  function fmtLba(lba) { return '$' + lba.toString(16).toUpperCase().padStart(6, '0'); }

  var boot = ctx.boot;
  var totalLbas = ctx.totalLbas, lastLba = ctx.lastLba, withGaps = ctx.withGaps;
  var lines = [];
  lines.push('<div class="hdd-map-wrap">');

  lines.push('<div class="hdd-map-stats">' +
    '<span><b>' + (boot.label || '(no label)') + '</b></span> ' +
    '<span>' + totalLbas.toLocaleString() + ' sectors</span> ' +
    '<span>' + fmtSize(totalLbas) + '</span> ' +
    '<span style="color:var(--text-muted)">default partition: slot ' + boot.defaultPart + '</span>' +
    '</div>');

  // Strip layout — flexbox. System regions (MBR / partition table / backup)
  // are 1 LBA each, which is <0.01% of the disk on any realistic image, so
  // they get a fixed pixel width and a label. Partitions + gaps share the
  // remaining width proportionally to their sector counts, so a 4 MiB
  // partition is still ~2× as wide as a 2 MiB partition.
  lines.push('<div class="hdd-map-strip" data-strip="disk">');
  for (var ri = 0; ri < withGaps.length; ri++) {
    var r = withGaps[ri];
    var span = r.endLba - r.startLba + 1;
    var cls = 'hdd-map-region hdd-map-' + r.kind;
    var style = 'background:' + regionColor(r);
    var inner = '';
    if (isSystem(r)) {
      cls += ' hdd-map-system';
      inner = '<span class="hdd-map-region-label">' + systemLabel(r) + '</span>';
    } else {
      style += ';flex-grow:' + span;
    }
    lines.push('<span class="' + cls + '" data-ri="' + ri + '" style="' + style + '">' + inner + '</span>');
  }
  lines.push('</div>');

  lines.push('<div class="hdd-map-axis">' +
    '<span>' + fmtLba(0) + '</span>' +
    '<span style="text-align:right">' + fmtLba(lastLba) + '</span>' +
    '</div>');

  lines.push('<div class="hdd-map-legend">' +
    '<span><span class="cfs-bam-swatch" style="background:#4a8fbd"></span>CFS</span>' +
    '<span><span class="cfs-bam-swatch" style="background:#3a5a7a"></span>CFS (read-only)</span>' +
    '<span><span class="cfs-bam-swatch" style="background:#3a4855"></span>Hidden</span>' +
    '<span><span class="cfs-bam-swatch" style="background:#9a8030"></span>GEOS</span>' +
    '<span><span class="cfs-bam-swatch" style="background:#5a4040"></span>Deleted (recoverable)</span>' +
    '<span><span class="cfs-bam-swatch" style="background:#d49a48"></span>Partition table</span>' +
    '<span><span class="cfs-bam-swatch" style="background:#b88a3e"></span>MBR</span>' +
    '<span><span class="cfs-bam-swatch" style="background:#1c2030"></span>Unallocated</span>' +
    '</div>');

  lines.push('<div class="hdd-map-detail" data-detail="disk">Click a region for details. Double-click a CFS partition to load its heat map in the next tab.</div>');

  lines.push('</div>');
  return lines.join('');
}

function _wireDiskMapHandlers(body, ctx, onPartitionDblClick) {
  function fmtSize(sectors) {
    var bytes = sectors * 512;
    if (bytes >= 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(bytes >= 100 * 1024 * 1024 ? 0 : 1) + ' MiB';
    if (bytes >= 1024) return (bytes / 1024).toFixed(0) + ' KiB';
    return bytes + ' B';
  }
  function fmtLba(lba) { return '$' + lba.toString(16).toUpperCase().padStart(6, '0'); }
  function describeRegion(r) {
    var rangeStr = (r.startLba === r.endLba)
      ? 'LBA ' + fmtLba(r.startLba)
      : 'LBA ' + fmtLba(r.startLba) + ' .. ' + fmtLba(r.endLba);
    var span = r.endLba - r.startLba + 1;
    var sizeStr = (span > 1) ? ' &mdash; ' + span.toLocaleString() + ' sectors (' + fmtSize(span) + ')' : '';
    var out = '<div><b>' + rangeStr + '</b>' + sizeStr + '</div>';
    if (r.kind === 'mbr') {
      out += '<div>The .hdd boot sector at LBA 0. Holds the CFS magic, the pointer to the partition table, the default-partition flag, the label, and a PC-style MBR entry so cfsfdisk recognises the image.</div>';
    } else if (r.kind === 'parttab') {
      out += '<div>Holds the 16-slot partition table this view is built from. Every slot is 32 bytes — name, type, start LBA, end LBA, plus CFS-specific root-dir + deleted-dir pointers.</div>';
    } else if (r.kind === 'parttab-backup') {
      out += '<div>Mirror of the partition table at the last LBA. IDEDOS writes here on every partition-table edit and reads from it if the primary is unreadable.</div>';
    } else if (r.kind === 'gap') {
      out += '<div>Unallocated. No partition claims this range — a new partition could be created here.</div>';
    } else {
      out += '<div>Slot #' + r.slot + ' &mdash; <b>' + escHtml(r.name) + '</b> &lt;' + escHtml(r.type || '?') + '&gt;';
      if (r.isDefault) out += ' <span style="color:var(--accent)">[default]</span>';
      out += '</div>';
      var flags = [];
      if (r.kind === 'partition-deleted') flags.push('deleted (recoverable)');
      if (r.hidden) flags.push('hidden');
      flags.push(r.writeable ? 'writeable' : 'read-only');
      out += '<div style="color:var(--text-muted)">' + flags.join(' &middot; ') + '</div>';
      if ((r.kind === 'partition' || r.kind === 'partition-deleted') && r.typeCode === 0x01) {
        out += '<div style="margin-top:6px">Double-click to load this partition\'s bitmap heat map into the next tab.</div>';
      }
    }
    return out;
  }

  var strip = body.querySelector('[data-strip="disk"]');
  var detail = body.querySelector('[data-detail="disk"]');
  if (!strip || !detail) return;
  strip.addEventListener('click', function(e) {
    var el = e.target.closest('.hdd-map-region');
    if (!el) return;
    var ri = parseInt(el.getAttribute('data-ri'), 10);
    var r = ctx.withGaps[ri];
    if (!r) return;
    strip.querySelectorAll('.hdd-map-region.selected').forEach(function(s) { s.classList.remove('selected'); });
    el.classList.add('selected');
    detail.innerHTML = describeRegion(r);
  });
  strip.addEventListener('mouseover', function(e) {
    var el = e.target.closest('.hdd-map-region');
    if (!el) return;
    var ri = parseInt(el.getAttribute('data-ri'), 10);
    var r = ctx.withGaps[ri];
    if (!r) return;
    var label = (r.kind === 'partition' || r.kind === 'partition-deleted')
      ? r.name + ' (slot ' + r.slot + ')'
      : (r.label || r.kind);
    var rangeStr = (r.startLba === r.endLba) ? fmtLba(r.startLba) : fmtLba(r.startLba) + '..' + fmtLba(r.endLba);
    el.title = label + ' — ' + rangeStr;
  });
  strip.addEventListener('dblclick', function(e) {
    var el = e.target.closest('.hdd-map-region');
    if (!el) return;
    var ri = parseInt(el.getAttribute('data-ri'), 10);
    var r = ctx.withGaps[ri];
    if (!r) return;
    // Allow live AND soft-deleted CFS partitions — both still have a
    // bitmap chain + dir pointers the heat-map walker can read.
    if ((r.kind !== 'partition' && r.kind !== 'partition-deleted') || r.typeCode !== 0x01) return;
    if (typeof onPartitionDblClick === 'function') onPartitionDblClick(r.slot);
  });
}

// ── Partition heat-map tab (CFS bitmap) ──────────────────────────────

function _cfsBuildLbaOwnership(buffer, partition) {
  var data = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  var partStart = partition.startLba;
  var partEnd = partition.endLba;
  var owners = {};
  var fileList = [];
  var colorPalette = [
    '#3a83b8', '#48a04c', '#c89642', '#a35aa3',
    '#5b8f8f', '#b87a3c', '#7964c4', '#6f9c2a',
    '#a85060', '#3897c0', '#9a8030', '#4a7050',
    '#8c5f9a', '#c87878', '#5078a8', '#d09030'
  ];
  function markSystem(lba) {
    if (lba < partStart || lba > partEnd) return;
    if (owners[lba] === undefined) owners[lba] = 'system';
  }
  function markFile(lba, key) {
    if (lba < partStart || lba > partEnd) return;
    if (owners[lba] === undefined) owners[lba] = key;
  }
  // System sectors at the start of each 4096-LBA bitmap chunk: the bitmap
  // itself (offset 0) plus the reserved companion sector right after it
  // (offset 1). cfsfdisk leaves the companion zero-filled but bitmap-used
  // on every chunk, not just the first — so on a multi-MiB partition we'd
  // flag dozens of false LOST sectors if we only marked partStart+1.
  for (var bm = 0; partStart + bm <= partEnd; bm += 4096) {
    markSystem(partStart + bm);
    markSystem(partStart + bm + 1);
  }
  // cfsfdisk reserves the partition's last LBA in the bitmap. When the
  // partition spans the .hdd's backup partition-table LBA this is what
  // protects the backup; either way the bitmap reports it used, so the
  // ownership map must call it system or it gets flagged as LOST.
  markSystem(partEnd);
  if (partition.cfsDeletedDir && partition.cfsDeletedDir.lba) markSystem(partition.cfsDeletedDir.addr);
  var dirVisited = {};
  function walkTree(treeRoot, fileSize, key) {
    if (!treeRoot || treeRoot < partStart || treeRoot > partEnd) return;
    var depth = _cfsComputeTreeDepth(fileSize);
    var seen = {};
    function w(nodeLba, level) {
      if (!nodeLba || nodeLba < partStart || nodeLba > partEnd) return;
      if (seen[nodeLba]) return;
      seen[nodeLba] = true;
      markFile(nodeLba, key);
      var nodeBase = nodeLba * IDE64_SECTOR_SIZE;
      if (nodeBase + IDE64_SECTOR_SIZE > data.length) return;
      for (var pi = 0; pi < 128; pi++) {
        var dp = _readIde64Pointer(data, nodeBase + pi * 4);
        if (dp.lba && dp.addr > 0) markFile(dp.addr, key);
      }
      if (level < depth) {
        for (var s = 0; s < 8; s++) {
          var link = _cfsReadTreeLink(data, nodeBase + s * 64);
          if (link.lba && link.addr > 0) w(link.addr, level + 1);
        }
      }
    }
    w(treeRoot, 0);
  }
  function walkDirChain(firstDirLba) {
    var lba = firstDirLba;
    while (lba && !dirVisited[lba]) {
      if (lba < partStart || lba > partEnd) return;
      dirVisited[lba] = true;
      markSystem(lba);
      var entries = readCfsDirectorySector(data, lba);
      if (!entries) break;
      for (var i = 0; i < entries.length; i++) {
        var en = entries[i];
        if (en.empty) continue;
        if (en.ftype === CFS_FTYPE.DEL) continue;
        if (!en.dataTreePtr || !en.dataTreePtr.lba) continue;
        var addr = en.dataTreePtr.addr;
        if (en.ftype === CFS_FTYPE.DIR) {
          walkDirChain(addr);
        } else {
          var fileKey = 'f' + fileList.length;
          fileList.push({
            key: fileKey,
            name: petsciiToReadable(en.name).trim(),
            type: en.typeSuffix || (en.ftype === CFS_FTYPE.LNK ? 'LNK' : 'PRG'),
            color: colorPalette[fileList.length % colorPalette.length],
          });
          walkTree(addr, en.size || 0, fileKey);
        }
      }
      var nextPtr = _cfsReadDirNext(data, lba * IDE64_SECTOR_SIZE);
      lba = (nextPtr.lba && nextPtr.addr > 0) ? nextPtr.addr : 0;
    }
  }
  if (partition.cfsRootDir && partition.cfsRootDir.lba) walkDirChain(partition.cfsRootDir.addr);

  var used = {};
  var usedCount = 0, freeCount = 0;
  for (var lba = partStart; lba <= partEnd; lba++) {
    var isUsed = !cfsIsSectorFree(data, partStart, lba);
    if (isUsed) { used[lba] = true; usedCount++; } else freeCount++;
  }
  var lostCount = 0;
  for (var lba2 = partStart; lba2 <= partEnd; lba2++) {
    if (used[lba2] && owners[lba2] === undefined) lostCount++;
  }
  return { owners: owners, used: used, fileList: fileList, usedCount: usedCount, freeCount: freeCount, lostCount: lostCount };
}

function _buildCfsBamContext(buffer, partition) {
  var partStart = partition.startLba;
  var partEnd = partition.endLba;
  var totalLbas = partEnd - partStart + 1;
  var ownership = _cfsBuildLbaOwnership(buffer, partition);
  var GRID = 64 * 64;
  var lbasPerCell = Math.max(1, Math.ceil(totalLbas / GRID));
  var actualCells = Math.ceil(totalLbas / lbasPerCell);
  var cells = [];
  for (var ci = 0; ci < actualCells; ci++) {
    var sLba = partStart + ci * lbasPerCell;
    var eLba = Math.min(partEnd, sLba + lbasPerCell - 1);
    var u = 0, hSys = false, hLost = false;
    var ownerCounts = {};
    for (var lba = sLba; lba <= eLba; lba++) {
      if (ownership.used[lba]) u++;
      var owner = ownership.owners[lba];
      if (owner === 'system') hSys = true;
      else if (owner === undefined && ownership.used[lba]) hLost = true;
      else if (owner !== undefined) ownerCounts[owner] = (ownerCounts[owner] || 0) + 1;
    }
    cells.push({
      startLba: sLba, endLba: eLba,
      used: u, total: eLba - sLba + 1,
      hasSystem: hSys, hasLost: hLost,
      ownerCounts: ownerCounts,
    });
  }
  return {
    partition: partition,
    totalLbas: totalLbas,
    lbasPerCell: lbasPerCell,
    cells: cells,
    info: ownership,
    mode: 'density',
  };
}

function _renderCfsBamHtml(ctx) {
  function cellColor(cell) {
    if (cell.hasLost) return '#c44';
    if (ctx.mode === 'ownership') {
      var bestKey = null, bestCnt = 0;
      for (var k in cell.ownerCounts) {
        if (cell.ownerCounts[k] > bestCnt) { bestCnt = cell.ownerCounts[k]; bestKey = k; }
      }
      if (bestKey) {
        var f = ctx.info.fileList.find(function(fl) { return fl.key === bestKey; });
        if (f) return f.color;
      }
      if (cell.hasSystem) return '#7a5c2e';
      if (cell.used === 0) return '#1c2030';
      return '#2a3550';
    }
    if (cell.hasSystem && cell.used === cell.total && Object.keys(cell.ownerCounts).length === 0) return '#7a5c2e';
    if (cell.used === 0) return '#1c2030';
    var pct = cell.used / cell.total;
    if (pct < 0.34) return '#2a4a7c';
    if (pct < 0.67) return '#3b6db8';
    if (pct < 1.0)  return '#5089d4';
    return '#7aacef';
  }
  var html = '<div class="cfs-bam-wrap">';
  html += '<div class="cfs-bam-stats">' +
    '<span><b>' + ctx.totalLbas.toLocaleString() + '</b> sector' + (ctx.totalLbas !== 1 ? 's' : '') + '</span> ' +
    '<span><b>' + ctx.info.usedCount.toLocaleString() + '</b> used</span> ' +
    '<span><b>' + ctx.info.freeCount.toLocaleString() + '</b> free</span>';
  if (ctx.info.lostCount > 0) {
    html += ' <span style="color:#c44"><b>' + ctx.info.lostCount + '</b> lost</span>';
  }
  html += ' <span style="color:var(--text-muted);font-size:11px">— ' + ctx.lbasPerCell + ' LBA' + (ctx.lbasPerCell !== 1 ? 's' : '') + ' per cell</span>';
  html += '</div>';
  html += '<div class="cfs-bam-grid" data-grid="cfs">';
  for (var ci = 0; ci < ctx.cells.length; ci++) {
    var c = ctx.cells[ci];
    html += '<span class="cfs-bam-cell" data-ci="' + ci + '" style="background:' + cellColor(c) + '"></span>';
  }
  html += '</div>';
  html += '<div class="cfs-bam-legend">';
  if (ctx.mode === 'density') {
    html += '<span><span class="cfs-bam-swatch" style="background:#1c2030"></span>free</span>' +
            '<span><span class="cfs-bam-swatch" style="background:#3b6db8"></span>partial</span>' +
            '<span><span class="cfs-bam-swatch" style="background:#7aacef"></span>full</span>' +
            '<span><span class="cfs-bam-swatch" style="background:#7a5c2e"></span>system</span>' +
            '<span><span class="cfs-bam-swatch" style="background:#c44"></span>lost</span>';
  } else {
    html += '<span><span class="cfs-bam-swatch" style="background:#1c2030"></span>free</span>' +
            '<span><span class="cfs-bam-swatch" style="background:#7a5c2e"></span>system</span>' +
            '<span><span class="cfs-bam-swatch" style="background:#c44"></span>lost</span>' +
            '<span style="color:var(--text-muted);font-size:11px">+ ' + ctx.info.fileList.length + ' file colour' + (ctx.info.fileList.length !== 1 ? 's' : '') + '</span>';
  }
  html += '</div>';
  html += '<div class="cfs-bam-detail" data-detail="cfs">Click a cell to see what\'s in its LBA range.</div>';
  html += '</div>';
  return html;
}

function _wireCfsBamHandlers(body, ctx) {
  function describeCell(cell) {
    var lines = [];
    var rangeStr = 'LBA $' + cell.startLba.toString(16).toUpperCase() +
      (cell.total > 1 ? '..$' + cell.endLba.toString(16).toUpperCase() : '');
    lines.push('<div><b>' + rangeStr + '</b> &mdash; ' + cell.used + '/' + cell.total + ' used</div>');
    if (cell.hasSystem) lines.push('<div style="color:#b48050">Contains system sectors (bitmap / deldir / dir chain)</div>');
    if (cell.hasLost) lines.push('<div style="color:#c44">Contains lost sectors (marked used, no owner)</div>');
    var ownerKeys = Object.keys(cell.ownerCounts).sort(function(a, b) {
      return cell.ownerCounts[b] - cell.ownerCounts[a];
    });
    if (ownerKeys.length === 0) {
      if (!cell.hasSystem && !cell.hasLost && cell.used === 0) lines.push('<div>All free.</div>');
    } else {
      lines.push('<div style="margin-top:6px"><b>Files in this range:</b></div><ul style="margin:4px 0 0 16px;padding:0">');
      for (var oi = 0; oi < ownerKeys.length; oi++) {
        var key = ownerKeys[oi];
        var f = ctx.info.fileList.find(function(fl) { return fl.key === key; });
        if (!f) continue;
        var cnt = cell.ownerCounts[key];
        lines.push('<li><span style="display:inline-block;width:10px;height:10px;background:' + f.color + ';margin-right:6px;border-radius:2px"></span>' +
          escHtml(f.name) + ' &lt;' + escHtml(f.type) + '&gt; &mdash; ' + cnt + ' sector' + (cnt !== 1 ? 's' : '') + '</li>');
      }
      lines.push('</ul>');
    }
    return lines.join('');
  }
  var grid = body.querySelector('[data-grid="cfs"]');
  var detail = body.querySelector('[data-detail="cfs"]');
  if (!grid || !detail) return;
  grid.addEventListener('click', function(e) {
    var el = e.target.closest('.cfs-bam-cell');
    if (!el) return;
    var ci = parseInt(el.getAttribute('data-ci'), 10);
    var cell = ctx.cells[ci];
    if (!cell) return;
    grid.querySelectorAll('.cfs-bam-cell.selected').forEach(function(s) { s.classList.remove('selected'); });
    el.classList.add('selected');
    detail.innerHTML = describeCell(cell);
  });
  grid.addEventListener('mouseover', function(e) {
    var el = e.target.closest('.cfs-bam-cell');
    if (!el) return;
    var ci = parseInt(el.getAttribute('data-ci'), 10);
    var cell = ctx.cells[ci];
    if (!cell) return;
    var rangeStr = '$' + cell.startLba.toString(16).toUpperCase() +
      (cell.total > 1 ? '..$' + cell.endLba.toString(16).toUpperCase() : '');
    el.title = rangeStr + ' — ' + cell.used + '/' + cell.total + ' used';
  });
}
