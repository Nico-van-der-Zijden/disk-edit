// ── IDE64 .hdd partition list (Phase 1, read-only) ────────────────────
//
// Mirrors the CMD container UI in ui-cmd.js: opening a .hdd creates a tab
// showing the disk label + 16 partition slots. Double-click currently
// shows a "not yet supported" modal — entering CFS partitions is Phase 2.
//
// State globals (hddBuffer, hddPartitions, hddBootInfo) are persisted on
// the active tab so switching tabs and coming back keeps the view.

function isIde64ContainerView() {
  return !!hddBuffer && !!hddPartitions;
}

// True when we're inside a CFS partition (Phase 2+ view). Distinguished
// from the partition-list view by cfsPartitionIdx >= 0.
function isCfsPartitionView() {
  return !!hddBuffer && cfsPartitionIdx >= 0;
}

function clearIde64State() {
  hddBuffer = null;
  hddFileName = null;
  hddBootInfo = null;
  hddPartitions = null;
  cfsPartitionIdx = -1;
  cfsDirLba = 0;
  cfsDirEntries = null;
  cfsDirStack = [];
}

function openIde64AsTab(buffer, fileName) {
  if (!buffer) return;
  var info = readIde64Partitions(buffer);
  saveActiveTab();
  clearCmdContainerState();
  clearIde64State();

  if (!info) {
    showModal('IDE64 HDD', [
      'Could not parse the partition table in ' + fileName + '.',
      'The boot-sector magic is present but the partition directory pointer is missing or invalid.',
    ]);
    return;
  }

  hddBuffer = buffer;
  hddFileName = fileName;
  hddBootInfo = info;
  hddPartitions = info.partitions;
  currentBuffer = buffer;
  currentFileName = fileName;
  currentFormat = DISK_FORMATS.hdd;
  currentTracks = 0;
  currentPartition = null;
  selectedEntryIndex = -1;

  var tab = createTab(fileName, buffer, fileName);
  activeTabId = tab.id;
  tabDirty = false;
  clearUndo();
  addRecentDisk(fileName, buffer);

  refreshIde64View();
}

function refreshIde64View() {
  if (cfsPartitionIdx >= 0) {
    renderCfsDirectoryView();
  } else {
    renderIde64PartitionList();
  }
  renderTabs();
  updateMenuState();
  updateEntryMenuState();
}

function renderIde64PartitionList() {
  if (!hddPartitions || !hddBootInfo) return;

  var content = document.getElementById('content');
  var label = hddBootInfo.label || 'IDE64';
  var defaultPart = hddBootInfo.defaultPart;

  var html = '<div class="disk-panel">' +
    '<div class="disk-header">' +
      '<div class="disk-header-spacer"><i class="fa-solid fa-hard-drive" title="IDE64 hard-disk image"></i></div>' +
      '<div class="disk-name">' + escHtml(hddFileName || label) + '</div>' +
      '<div class="disk-id">IDE64</div>' +
    '</div>' +
    '<div class="dir-entry dir-header-row">' +
      '<span class="dir-grip"></span>' +
      '<span class="dir-blocks">Size</span>' +
      '<span class="dir-name">Partition</span>' +
      '<span class="dir-type">Type</span>' +
      '<span class="dir-slot">#</span>' +
      '<span class="dir-ts">Start LBA</span>' +
      '<span class="dir-addr">Flags</span>' +
      '<span class="dir-icons"></span>' +
    '</div>' +
    '<div class="dir-listing">';

  var openCount = 0;
  for (var i = 0; i < hddPartitions.length; i++) {
    var p = hddPartitions[i];
    var enterable = p.type === 0x01; // CFS — others not supported yet
    if (!p.empty) openCount++;

    var sizeBlocks = '';
    var sizeLabel = '';
    if (p.sizeSectors !== null && !p.empty) {
      // Each CFS sector = 512 B = 2 CBM blocks; show CBM-block count to
      // match the convention used elsewhere in the editor.
      sizeBlocks = (p.sizeSectors * 2).toString();
      var mib = p.sizeBytes / (1024 * 1024);
      sizeLabel = mib >= 1
        ? mib.toFixed(mib < 10 ? 2 : 1) + ' MiB'
        : (p.sizeBytes / 1024).toFixed(1) + ' KiB';
    }

    var startHex = p.startLba !== null
      ? '$' + p.startLba.toString(16).toUpperCase().padStart(8, '0')
      : '(CHS)';

    var flagBits = [];
    if (!p.empty) {
      if (p.hidden) flagBits.push('H');
      if (p.writeable) flagBits.push('W');
      if (p.lba) flagBits.push('L');
      if (i === defaultPart) flagBits.push('*');
    }
    var flagStr = flagBits.join('');

    var nameDisplay = p.empty
      ? '(empty)'
      : (p.name || ('Partition ' + i));

    var extraCls = p.empty ? ' deleted' : (enterable ? '' : ' disabled-row');
    var rowTitle = p.empty
      ? 'Slot ' + i + ' — empty'
      : (p.typeName + (sizeLabel ? ' — ' + sizeLabel : '') +
         (i === defaultPart ? ' — default partition' : '') +
         (enterable ? '' : ' — entering this partition type is not yet supported'));

    html +=
      '<div class="dir-entry' + extraCls + '" data-hdd-part="' + i + '" title="' + escHtml(rowTitle) + '">' +
        '<span class="dir-grip"></span>' +
        '<span class="dir-blocks">' + sizeBlocks + '</span>' +
        '<span class="dir-name">"' + escHtml(nameDisplay) + '"</span>' +
        '<span class="dir-type">' + escHtml(p.typeName) + '</span>' +
        '<span class="dir-slot">' + p.index + '</span>' +
        '<span class="dir-ts">' + startHex + '</span>' +
        '<span class="dir-addr">' + escHtml(flagStr) + '</span>' +
        '<span class="dir-icons"></span>' +
      '</div>';
  }

  html += '</div>' +
    '<div class="dir-footer"><div class="dir-footer-row">' +
      '<span class="dir-footer-blocks">' + openCount + '</span>' +
      '<span class="dir-footer-label">partition(s).</span>' +
      '<span class="dir-footer-tracks">IDE64 container</span>' +
    '</div></div>' +
  '</div>';
  content.innerHTML = html;

  content.querySelectorAll('.dir-entry[data-hdd-part]').forEach(function(row) {
    var idx = parseInt(row.dataset.hddPart, 10);
    row.addEventListener('click', function() {
      content.querySelectorAll('.dir-entry.selected').forEach(function(el) { el.classList.remove('selected'); });
      row.classList.add('selected');
      updateEntryMenuState();
    });
    row.addEventListener('dblclick', function() {
      var p = hddPartitions[idx];
      if (!p || p.empty) return;
      if (p.type === 0x01) {
        enterIde64Partition(idx);
      } else {
        showModal(p.typeName + ' partition', [
          '"' + (p.name || ('Partition ' + idx)) + '" is a ' + p.typeName + ' partition.',
          'Only CFS partitions are planned for the editor; other types stay informational.',
        ]);
      }
    });
  });

  selectedEntryIndex = -1;
  selectedEntries = [];
  updateEntryMenuState();
}

// ── Enter a CFS partition (Phase 2 view) ──────────────────────────────
// Switch from the HDD partition-list to a CFS directory listing.
// Phase 2 is read-only: parse the partition's root dir, display the
// entries; clicking a file selects, clicking a subdir opens it (Phase 3+).
function enterIde64Partition(idx) {
  if (!hddPartitions) return;
  var p = hddPartitions[idx];
  if (!p || p.type !== 0x01) return;
  if (!p.cfsRootDir || !p.cfsRootDir.lba) {
    showModal('CFS partition', ['Partition "' + (p.name || ('#' + idx)) + '" has no valid root directory pointer.']);
    return;
  }
  var entries = readCfsDirectory(hddBuffer, p.cfsRootDir.addr);
  if (!entries) {
    showModal('CFS partition', ['Could not read the root directory for partition "' + (p.name || ('#' + idx)) + '".']);
    return;
  }
  cfsPartitionIdx = idx;
  cfsDirLba = p.cfsRootDir.addr;
  cfsDirEntries = entries;
  cfsDirStack = [];
  // Swap the descriptor so renderer / menu-state code that branches on
  // currentFormat.filesystem picks the CFS path. currentBuffer stays on
  // the whole .hdd buffer — Phase 2 doesn't slice the partition out.
  currentFormat = DISK_FORMATS.cfs;
  currentTracks = 0;
  selectedEntryIndex = -1;
  refreshIde64View();
}

// Leave the CFS partition view, return to the HDD partition list.
function leaveCfsPartition() {
  cfsPartitionIdx = -1;
  cfsDirLba = 0;
  cfsDirEntries = null;
  cfsDirStack = [];
  currentFormat = DISK_FORMATS.hdd;
  selectedEntryIndex = -1;
  refreshIde64View();
}

// Drill into a CFS subdirectory. Pushes the current dir onto the
// breadcrumb stack, then switches the view to the subdir's first
// directory sector. The subdir entry stores its first dir sector LBA
// in the data-tree-pointer field at $14.
function enterCfsSubdir(entry) {
  if (!entry || entry.ftype !== CFS_FTYPE.DIR) return;
  if (!entry.dataTreePtr || !entry.dataTreePtr.lba) {
    showModal('CFS subdirectory', ['"' + entry.name + '" has no valid directory sector pointer.']);
    return;
  }
  cfsDirStack.push({ dirLba: cfsDirLba, name: _cfsCurrentDirDisplayName() });
  cfsDirLba = entry.dataTreePtr.addr;
  cfsDirEntries = null;
  selectedEntryIndex = -1;
  refreshIde64View();
}

// Pop one level off the breadcrumb. Called from the "↑ up to ..." row.
function leaveCfsSubdir() {
  if (cfsDirStack.length === 0) return;
  var parent = cfsDirStack.pop();
  cfsDirLba = parent.dirLba;
  cfsDirEntries = null;
  selectedEntryIndex = -1;
  refreshIde64View();
}

// Display name for the currently-viewed directory: prefer the entry-0
// self-reference's name (every CFS dir's first slot carries its own
// name); fall back to the partition name if that's missing.
function _cfsCurrentDirDisplayName() {
  if (cfsDirEntries && cfsDirEntries.length > 0 && cfsDirEntries[0].name) {
    return cfsDirEntries[0].name;
  }
  if (cfsPartitionIdx >= 0 && hddPartitions) {
    var p = hddPartitions[cfsPartitionIdx];
    if (p) return p.name || ('Partition ' + cfsPartitionIdx);
  }
  return 'CFS';
}

// ── Render the CFS directory listing ──────────────────────────────────
function renderCfsDirectoryView() {
  if (!hddPartitions || cfsPartitionIdx < 0) return;
  var part = hddPartitions[cfsPartitionIdx];
  if (!part) return;
  // Re-parse every render — matches the CMD container pattern; edits in
  // future phases mutate hddBuffer directly and this picks them up without
  // a separate refresh hook.
  cfsDirEntries = readCfsDirectory(hddBuffer, cfsDirLba) || [];

  var content = document.getElementById('content');
  var partName = part.name || ('Partition ' + part.index);
  var crumbs = [partName];
  for (var ci = 0; ci < cfsDirStack.length; ci++) {
    crumbs.push(cfsDirStack[ci].name || '?');
  }
  var thisDirName = _cfsCurrentDirDisplayName();
  if (cfsDirStack.length > 0) crumbs.push(thisDirName);
  var titleName = crumbs.join(' / ');

  var html = '<div class="disk-panel">' +
    '<div class="disk-header">' +
      '<div class="disk-header-spacer"><i class="fa-solid fa-folder-open" title="CFS directory"></i></div>' +
      '<div class="disk-name">' + escHtml(titleName) + '</div>' +
      '<div class="disk-id">CFS</div>' +
    '</div>' +
    '<div class="dir-entry dir-header-row">' +
      '<span class="dir-grip"></span>' +
      '<span class="dir-blocks">Size</span>' +
      '<span class="dir-name">Name</span>' +
      '<span class="dir-type">Type</span>' +
      '<span class="dir-cfs-mtime">Modified</span>' +
      '<span class="dir-cfs-attrs">Attrs</span>' +
      '<span class="dir-icons"></span>' +
    '</div>' +
    '<div class="dir-listing">' +
    '<div class="dir-entry dir-parent-row" data-cfs-leave="1">' +
      '<span class="dir-grip"></span>' +
      '<span class="dir-blocks"></span>' +
      '<span class="dir-name">&laquo; back to partition list</span>' +
      '<span class="dir-type"></span>' +
      '<span class="dir-cfs-mtime"></span>' +
      '<span class="dir-cfs-attrs"></span>' +
      '<span class="dir-icons"></span>' +
    '</div>';
  if (cfsDirStack.length > 0) {
    var parentName = cfsDirStack[cfsDirStack.length - 1].name || '..';
    html +=
      '<div class="dir-entry dir-parent-row" data-cfs-up="1">' +
        '<span class="dir-grip"></span>' +
        '<span class="dir-blocks"></span>' +
        '<span class="dir-name">&uarr; up to ' + escHtml(parentName) + '</span>' +
        '<span class="dir-type"></span>' +
        '<span class="dir-cfs-mtime"></span>' +
        '<span class="dir-cfs-attrs"></span>' +
        '<span class="dir-icons"></span>' +
      '</div>';
  }

  var fileCount = 0;
  for (var i = 0; i < cfsDirEntries.length; i++) {
    var e = cfsDirEntries[i];
    if (e.empty) continue;
    if (e.isSelfRef) continue; // entry 0 of first sector = directory's own name, hide it

    var absIdx = i; // unique across all chained sectors
    var typeStr = e.typeSuffix || _cfsFtypeLabel(e.ftype);
    var sizeStr;
    if (e.ftype === CFS_FTYPE.DIR || e.ftype === CFS_FTYPE.LNK) {
      sizeStr = '';
    } else {
      // Show CBM-style blocks count (rounded up, 254 data bytes per block
      // — same as the existing disk views) plus the raw byte count via tooltip.
      sizeStr = Math.ceil(e.size / 254).toString();
    }
    var mtimeStr = formatCfsTimestamp(e.mtime);
    var attrs = '';
    if (e.closed) attrs += 'C';
    if (e.attrByte & 0x40) attrs += 'D';
    if (e.attrByte & 0x20) attrs += 'R';
    if (e.attrByte & 0x10) attrs += 'W';
    if (e.attrByte & 0x08) attrs += 'X';

    var deletedCls = (e.ftype === CFS_FTYPE.DEL) ? ' deleted' : '';
    var enterableSubdir = (e.ftype === CFS_FTYPE.DIR);
    var rowTitle = e.name + ' — ' + (e.size + ' bytes');

    html +=
      '<div class="dir-entry' + deletedCls + '" data-cfs-entry="' + absIdx + '" title="' + escHtml(rowTitle) + '">' +
        '<span class="dir-grip"></span>' +
        '<span class="dir-blocks">' + sizeStr + '</span>' +
        '<span class="dir-name">"' + escHtml(e.name) + '"</span>' +
        '<span class="dir-type">' + escHtml(typeStr) + '</span>' +
        '<span class="dir-cfs-mtime">' + escHtml(mtimeStr) + '</span>' +
        '<span class="dir-cfs-attrs">' + escHtml(attrs) + '</span>' +
        '<span class="dir-icons"></span>' +
      '</div>';
    fileCount++;
  }

  var partSizeLabel = part.sizeBytes !== null
    ? (part.sizeBytes / (1024 * 1024)).toFixed(part.sizeBytes < 10 * 1024 * 1024 ? 2 : 1) + ' MiB'
    : '';
  html += '</div>' +
    '<div class="dir-footer"><div class="dir-footer-row">' +
      '<span class="dir-footer-blocks">' + fileCount + '</span>' +
      '<span class="dir-footer-label">file(s).</span>' +
      '<span class="dir-footer-tracks">' + escHtml(partSizeLabel) + ' CFS partition</span>' +
    '</div></div>' +
  '</div>';
  content.innerHTML = html;

  // Back-to-partition-list row
  content.querySelectorAll('.dir-entry[data-cfs-leave]').forEach(function(row) {
    row.addEventListener('click', function() { leaveCfsPartition(); });
    row.addEventListener('dblclick', function() { leaveCfsPartition(); });
  });
  // Up-to-parent row (only present in subdirs)
  content.querySelectorAll('.dir-entry[data-cfs-up]').forEach(function(row) {
    row.addEventListener('click', function() { leaveCfsSubdir(); });
    row.addEventListener('dblclick', function() { leaveCfsSubdir(); });
  });

  // File rows: click selects; dblclick on DIR is reserved for Phase 3
  content.querySelectorAll('.dir-entry[data-cfs-entry]').forEach(function(row) {
    var idx = parseInt(row.dataset.cfsEntry, 10);
    var entry = cfsDirEntries[idx];
    row.addEventListener('click', function() {
      content.querySelectorAll('.dir-entry.selected').forEach(function(el) { el.classList.remove('selected'); });
      row.classList.add('selected');
      selectedEntryIndex = idx;
      updateEntryMenuState();
    });
    row.addEventListener('dblclick', function() {
      if (entry.ftype === CFS_FTYPE.DIR) {
        enterCfsSubdir(entry);
      } else if (entry.ftype === CFS_FTYPE.LNK) {
        showCfsLinkTarget(entry);
      } else if (entry.ftype === CFS_FTYPE.DEL) {
        showModal('Deleted file', ['Entry is marked deleted; nothing to view.']);
      } else {
        showCfsFileHexViewer(entry);
      }
    });
  });

  selectedEntryIndex = -1;
  selectedEntries = [];
  updateEntryMenuState();
}

function _cfsFtypeLabel(ft) {
  switch (ft) {
    case CFS_FTYPE.DEL: return 'DEL';
    case CFS_FTYPE.NORMAL: return 'PRG';
    case CFS_FTYPE.REL: return 'REL';
    case CFS_FTYPE.DIR: return 'DIR';
    case CFS_FTYPE.LNK: return 'LNK';
    default: return 'T' + ft;
  }
}

// Show a CFS symbolic link's target. The link's content is the target
// path (PETSCII / ASCII). Phase 3b just surfaces what it points at —
// actually following the link to navigate to its target is Phase 3c
// territory (needs a path resolver that walks dir-by-dir within the
// partition).
function showCfsLinkTarget(entry) {
  if (!entry || !entry.dataTreePtr || !entry.dataTreePtr.lba) {
    showModal('CFS link', ['"' + entry.name + '" has no target pointer.']);
    return;
  }
  var res = readCfsFileData(hddBuffer, entry.dataTreePtr.addr, entry.size || 256);
  if (res.error) {
    showModal('CFS link', ['Could not read target of "' + entry.name + '": ' + res.error]);
    return;
  }
  var target = '';
  for (var i = 0; i < res.data.length; i++) {
    var c = res.data[i];
    if (c === 0 || c === 0xA0) break;
    target += String.fromCharCode(c);
  }
  showModal('Symbolic link: ' + entry.name, [
    'Target: ' + (target || '(empty)'),
    'Following links to navigate is not yet implemented.',
  ]);
}

// ── CFS file content viewer (Phase 3a, hex + download) ────────────────
// Reads the file via the B-tree walker, opens a hex modal with a
// Download button. PETSCII / BASIC viewers are deferred to Phase 3b —
// the existing implementations are deeply tied to currentBuffer + a
// CBM directory entry offset, so reusing them requires more plumbing.
function showCfsFileHexViewer(entry) {
  if (!entry || !entry.dataTreePtr || !entry.dataTreePtr.lba) {
    showModal('CFS file', ['"' + entry.name + '" has no data tree pointer.']);
    return;
  }
  var rootLba = entry.dataTreePtr.addr;
  var res = readCfsFileData(hddBuffer, rootLba, entry.size);
  if (res.error) {
    showModal('CFS file', ['Error reading "' + entry.name + '": ' + res.error]);
    return;
  }
  var payload = res.data;
  var totalBytes = payload.length;
  var suggestedName = entry.name + (entry.typeSuffix ? '.' + entry.typeSuffix.toLowerCase() : '');

  var html = '<div class="text-md text-muted mb-md">' +
    escHtml(entry.name) + (entry.typeSuffix ? ' (' + escHtml(entry.typeSuffix) + ')' : '') +
    ' — ' + totalBytes + ' bytes' +
    '</div>' +
    '<div class="hex-editor">';
  // Cap the rendered hex view at 16 KiB to keep the DOM responsive;
  // Download stays available for the full file.
  var renderLimit = Math.min(totalBytes, 16384);
  var rows = Math.ceil(renderLimit / 16) || 1;
  for (var row = 0; row < rows; row++) {
    var rowOff = row * 16;
    html += '<div class="hex-row"><span class="hex-offset">' +
      rowOff.toString(16).toUpperCase().padStart(6, '0') + '</span><span class="hex-bytes">';
    var ascii = '';
    for (var col = 0; col < 16; col++) {
      var idx = rowOff + col;
      if (idx < renderLimit) {
        var b = payload[idx];
        html += '<span class="hex-byte">' + b.toString(16).toUpperCase().padStart(2, '0') + '</span>';
        ascii += (b >= 0x20 && b < 0x7F) ? String.fromCharCode(b) : '.';
      } else {
        html += '<span class="hex-byte" style="opacity:0.2">--</span>';
        ascii += ' ';
      }
    }
    html += '</span><span class="hex-ascii">' + escHtml(ascii) + '</span></div>';
  }
  if (totalBytes > renderLimit) {
    html += '<div class="text-sm text-muted" style="padding:8px 0">' +
      '… ' + (totalBytes - renderLimit) + ' more bytes (use Download to get the whole file).</div>';
  }
  html += '</div>';

  var body = showViewerModal('Hex — ' + entry.name, html, 'large');

  // Replace the OK button with Download + Close
  var footer = document.querySelector('#modal-overlay .modal-footer');
  footer.innerHTML = '<button id="cfs-dl">Download</button> <button id="modal-close">Close</button>';
  document.getElementById('cfs-dl').addEventListener('click', function() {
    var blob = new Blob([payload], { type: 'application/octet-stream' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = suggestedName;
    a.click();
    URL.revokeObjectURL(a.href);
  });
  document.getElementById('modal-close').addEventListener('click', function() {
    document.getElementById('modal-overlay').classList.remove('open');
  });
}
