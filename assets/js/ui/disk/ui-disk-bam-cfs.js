// ── CFS Bitmap Viewer ─────────────────────────────────────────────────
//
// A heat-map / file-ownership visualizer for a CFS partition's
// allocation bitmap. Two modes (toggle in the modal footer):
//
//   Density    (default): each cell colored by the fraction of its
//              LBA range that's marked USED. System LBAs (bitmap chain,
//              deldir, root + dir chain) drawn brown; lost sectors red.
//   Ownership: each cell colored by the file (if any) that owns the
//              majority of its LBA range. System sectors stay brown;
//              palette cycles per-file so neighbours stand out.
//
// Cell count is fixed at 4096 (a 64x64 grid). Cell size = ceil(totalLBAs
// / 4096) — for 128 MiB that's 64 LBAs per cell, for 8 MiB it's 4. Click
// a cell to see its LBA range + owning file list + USED count in the
// detail panel under the grid.

(function() {
  function clickHandler() {
    if (typeof cfsPartitionIdx === 'undefined' || cfsPartitionIdx < 0) return false;
    if (!cfsDirEntries || !hddBuffer || !hddPartitions) return false;
    var partition = hddPartitions[cfsPartitionIdx];
    if (!partition) return false;
    showCfsBamViewer(partition);
    return true;
  }

  // Patch the existing opt-view-bam click handler: try CFS first, fall
  // back to the CBM-DOS handler (already registered on the same node).
  var bamEl = document.getElementById('opt-view-bam');
  if (!bamEl) return;
  bamEl.addEventListener('click', function(ev) {
    if (clickHandler()) {
      ev.stopImmediatePropagation();
      if (typeof closeMenus === 'function') closeMenus();
    }
  }, true); // capture so we run before the CBM-DOS handler
})();

// Walk every dir entry's B-tree (recursive for subdirs) and build a
// per-LBA owner map. Each LBA gets the offset of the dir entry that
// claims it (encoded as "dirLba:slotIndex"), or 'system' for the
// bitmap chain / deldir / dir-chain sectors. LBAs not touched by any
// of those are absent from the map (they're either free or lost).
function _cfsBuildLbaOwnership(buffer, partition) {
  var data = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  var partStart = partition.startLba;
  var partEnd = partition.endLba;
  var owners = {}; // lba → ownerKey
  var fileList = []; // [{ key, name, color }]
  var fileKeyByLba = {}; // lba → fileList index
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
  // System: bitmap chain.
  for (var bm = 0; partStart + bm <= partEnd; bm += 4096) markSystem(partStart + bm);
  markSystem(partStart + 1);
  if (partition.cfsDeletedDir && partition.cfsDeletedDir.lba) markSystem(partition.cfsDeletedDir.addr);
  // Walk dir + subdir chains; mark dir sectors as system.
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

  // Bitmap state per LBA (true = used).
  var used = {};
  var usedCount = 0, freeCount = 0;
  for (var lba = partStart; lba <= partEnd; lba++) {
    var isUsed = !cfsIsSectorFree(data, partStart, lba);
    if (isUsed) { used[lba] = true; usedCount++; } else freeCount++;
  }
  // Lost = used but no owner (= no system / no file claim).
  var lostCount = 0;
  for (var lba2 = partStart; lba2 <= partEnd; lba2++) {
    if (used[lba2] && owners[lba2] === undefined) lostCount++;
  }
  return {
    owners: owners,
    used: used,
    fileList: fileList,
    usedCount: usedCount,
    freeCount: freeCount,
    lostCount: lostCount,
  };
}

function showCfsBamViewer(partition) {
  if (typeof showViewerModal !== 'function') return;
  var partStart = partition.startLba;
  var partEnd = partition.endLba;
  var totalLbas = partEnd - partStart + 1;
  var info = _cfsBuildLbaOwnership(hddBuffer, partition);
  var partName = partition.name ? petsciiToReadable(partition.name).trim() : 'partition';

  // Grid dimensions: 64x64 = 4096 cells. Cell covers ceil(totalLbas/4096) LBAs.
  var GRID_COLS = 64;
  var GRID_ROWS = 64;
  var totalCells = GRID_COLS * GRID_ROWS;
  var lbasPerCell = Math.max(1, Math.ceil(totalLbas / totalCells));
  var actualCells = Math.ceil(totalLbas / lbasPerCell);

  // Build per-cell stats once. Each cell: { startLba, endLba, used,
  // hasSystem, hasLost, ownerCounts (map fileKey→count) }
  var cells = [];
  for (var ci = 0; ci < actualCells; ci++) {
    var sLba = partStart + ci * lbasPerCell;
    var eLba = Math.min(partEnd, sLba + lbasPerCell - 1);
    var u = 0, hSys = false, hLost = false;
    var ownerCounts = {};
    for (var lba = sLba; lba <= eLba; lba++) {
      if (info.used[lba]) u++;
      var owner = info.owners[lba];
      if (owner === 'system') hSys = true;
      else if (owner === undefined && info.used[lba]) hLost = true;
      else if (owner !== undefined) ownerCounts[owner] = (ownerCounts[owner] || 0) + 1;
    }
    cells.push({
      startLba: sLba, endLba: eLba,
      used: u, total: eLba - sLba + 1,
      hasSystem: hSys, hasLost: hLost,
      ownerCounts: ownerCounts,
    });
  }

  // Mode state (closed over by buildHtml + handlers).
  var mode = 'density'; // 'density' | 'ownership'

  function cellColor(cell) {
    if (cell.hasLost) return '#c44';
    if (mode === 'ownership') {
      // Pick the file with the highest LBA count in this cell.
      var bestKey = null, bestCnt = 0;
      for (var k in cell.ownerCounts) {
        if (cell.ownerCounts[k] > bestCnt) { bestCnt = cell.ownerCounts[k]; bestKey = k; }
      }
      if (bestKey) {
        var f = info.fileList.find(function(fl) { return fl.key === bestKey; });
        if (f) return f.color;
      }
      if (cell.hasSystem) return '#7a5c2e';
      // No owner + no system + (some used or all free)
      if (cell.used === 0) return '#1c2030';
      return '#2a3550';
    }
    // density mode
    if (cell.hasSystem && cell.used === cell.total && Object.keys(cell.ownerCounts).length === 0) return '#7a5c2e';
    if (cell.used === 0) return '#1c2030';
    var pct = cell.used / cell.total;
    if (pct < 0.34) return '#2a4a7c';
    if (pct < 0.67) return '#3b6db8';
    if (pct < 1.0)  return '#5089d4';
    return '#7aacef';
  }

  function buildHtml() {
    var html = '<div class="cfs-bam-wrap">';
    html += '<div class="cfs-bam-stats">' +
      '<span><b>' + totalLbas.toLocaleString() + '</b> sector' + (totalLbas !== 1 ? 's' : '') + '</span> ' +
      '<span><b>' + info.usedCount.toLocaleString() + '</b> used</span> ' +
      '<span><b>' + info.freeCount.toLocaleString() + '</b> free</span>';
    if (info.lostCount > 0) {
      html += ' <span style="color:#c44"><b>' + info.lostCount + '</b> lost</span>';
    }
    html += ' <span style="color:var(--text-muted);font-size:11px">— ' + lbasPerCell + ' LBA' + (lbasPerCell !== 1 ? 's' : '') + ' per cell</span>';
    html += '</div>';
    html += '<div class="cfs-bam-grid" id="cfs-bam-grid">';
    for (var ci = 0; ci < cells.length; ci++) {
      var c = cells[ci];
      html += '<span class="cfs-bam-cell" data-ci="' + ci + '" style="background:' + cellColor(c) + '"></span>';
    }
    html += '</div>';
    html += '<div class="cfs-bam-legend">';
    if (mode === 'density') {
      html += '<span><span class="cfs-bam-swatch" style="background:#1c2030"></span>free</span>' +
              '<span><span class="cfs-bam-swatch" style="background:#3b6db8"></span>partial</span>' +
              '<span><span class="cfs-bam-swatch" style="background:#7aacef"></span>full</span>' +
              '<span><span class="cfs-bam-swatch" style="background:#7a5c2e"></span>system</span>' +
              '<span><span class="cfs-bam-swatch" style="background:#c44"></span>lost</span>';
    } else {
      html += '<span><span class="cfs-bam-swatch" style="background:#1c2030"></span>free</span>' +
              '<span><span class="cfs-bam-swatch" style="background:#7a5c2e"></span>system</span>' +
              '<span><span class="cfs-bam-swatch" style="background:#c44"></span>lost</span>' +
              '<span style="color:var(--text-muted);font-size:11px">+ ' + info.fileList.length + ' file colour' + (info.fileList.length !== 1 ? 's' : '') + '</span>';
    }
    html += '</div>';
    html += '<div class="cfs-bam-detail" id="cfs-bam-detail">Click a cell to see what\'s in its LBA range.</div>';
    html += '</div>';
    return html;
  }

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
        var f = info.fileList.find(function(fl) { return fl.key === key; });
        if (!f) continue;
        var cnt = cell.ownerCounts[key];
        lines.push('<li><span style="display:inline-block;width:10px;height:10px;background:' + f.color + ';margin-right:6px;border-radius:2px"></span>' +
          escHtml(f.name) + ' &lt;' + escHtml(f.type) + '&gt; &mdash; ' + cnt + ' sector' + (cnt !== 1 ? 's' : '') + '</li>');
      }
      lines.push('</ul>');
    }
    return lines.join('');
  }

  var body = showViewerModal('Bitmap — ' + partName, buildHtml(), 'large');
  bindCellHandlers(body);

  // Footer with Density/Ownership toggle + Close.
  var footer = document.querySelector('#modal-overlay .modal-footer');
  footer.innerHTML =
    '<button id="cfs-bam-toggle" class="modal-btn-secondary">Color by file ownership</button>' +
    '<button id="cfs-bam-close">Close</button>';

  document.getElementById('cfs-bam-toggle').addEventListener('click', function() {
    mode = (mode === 'density') ? 'ownership' : 'density';
    body.innerHTML = buildHtml();
    bindCellHandlers(body);
    document.getElementById('cfs-bam-toggle').textContent = (mode === 'density') ? 'Color by file ownership' : 'Color by density';
  });
  document.getElementById('cfs-bam-close').addEventListener('click', function() {
    document.getElementById('modal-overlay').classList.remove('open');
  });

  function bindCellHandlers(root) {
    var grid = root.querySelector('#cfs-bam-grid');
    var detail = root.querySelector('#cfs-bam-detail');
    if (!grid || !detail) return;
    grid.addEventListener('click', function(e) {
      var el = e.target.closest('.cfs-bam-cell');
      if (!el) return;
      var ci = parseInt(el.getAttribute('data-ci'), 10);
      var cell = cells[ci];
      if (!cell) return;
      grid.querySelectorAll('.cfs-bam-cell.selected').forEach(function(s) { s.classList.remove('selected'); });
      el.classList.add('selected');
      detail.innerHTML = describeCell(cell);
    });
    grid.addEventListener('mouseover', function(e) {
      var el = e.target.closest('.cfs-bam-cell');
      if (!el) return;
      var ci = parseInt(el.getAttribute('data-ci'), 10);
      var cell = cells[ci];
      if (!cell) return;
      var rangeStr = '$' + cell.startLba.toString(16).toUpperCase() +
        (cell.total > 1 ? '..$' + cell.endLba.toString(16).toUpperCase() : '');
      el.title = rangeStr + ' — ' + cell.used + '/' + cell.total + ' used';
    });
  }
}
