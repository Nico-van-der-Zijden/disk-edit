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

function openIde64AsTab(buffer, fileName) {
  if (!buffer) return;
  var info = readIde64Partitions(buffer);
  saveActiveTab();
  clearCmdContainerState(); // also clears HDD globals — see cbm-editor.js

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
  // Re-sync hddBuffer from currentBuffer in case popUndo (or another
  // buffer-rewriting path) handed us a fresh reference. The partition
  // table and dir reads below all read through hddBuffer.
  if (currentBuffer && hddBuffer !== currentBuffer) {
    hddBuffer = currentBuffer;
    if (typeof readIde64Partitions === 'function') {
      var info = readIde64Partitions(hddBuffer);
      if (info) {
        hddBootInfo = info;
        hddPartitions = info.partitions;
      }
    }
  }
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
  // Import row (Phase 4b — single-sector files only)
  html +=
    '<div class="dir-entry dir-parent-row" data-cfs-import="1">' +
      '<span class="dir-grip"></span>' +
      '<span class="dir-blocks"></span>' +
      '<span class="dir-name">+ Import file&hellip; (≤ 512 B)</span>' +
      '<span class="dir-type"></span>' +
      '<span class="dir-cfs-mtime"></span>' +
      '<span class="dir-cfs-attrs"></span>' +
      '<span class="dir-icons"></span>' +
    '</div>';

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
  // Import file row
  content.querySelectorAll('.dir-entry[data-cfs-import]').forEach(function(row) {
    row.addEventListener('click', function() { showCfsImportPicker(); });
    row.addEventListener('dblclick', function() { showCfsImportPicker(); });
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

// Read a CFS LNK's target path. Content is a null-padded byte string.
function _cfsReadLinkTarget(entry) {
  if (!entry || !entry.dataTreePtr || !entry.dataTreePtr.lba) return '';
  var res = readCfsFileData(hddBuffer, entry.dataTreePtr.addr, entry.size || 256);
  if (res.error) return '';
  var target = '';
  for (var i = 0; i < res.data.length; i++) {
    var c = res.data[i];
    if (c === 0 || c === 0xA0) break;
    target += String.fromCharCode(c);
  }
  return target.trim();
}

// Follow a CFS symbolic link. The link's content is its target path.
// Resolution order: absolute path (leading "/" → from partition root),
// relative-with-slash (walk from current dir), flat name (lookup in
// current dir). Cycle-detected when target itself is another LNK.
function showCfsLinkTarget(entry) {
  if (!entry || !entry.dataTreePtr || !entry.dataTreePtr.lba) {
    showModal('CFS link', ['"' + entry.name + '" has no target pointer.']);
    return;
  }
  if (!hddPartitions || cfsPartitionIdx < 0) return;
  var partition = hddPartitions[cfsPartitionIdx];
  if (!partition || !partition.cfsRootDir || !partition.cfsRootDir.lba) return;

  var visited = {};
  var current = entry;
  var maxHops = 16;
  while (current && current.ftype === CFS_FTYPE.LNK && maxHops-- > 0) {
    var key = current.dirLba + ':' + current.index;
    if (visited[key]) {
      showModal('CFS link', ['Link cycle detected — bailing.']);
      return;
    }
    visited[key] = true;
    var target = _cfsReadLinkTarget(current);
    if (!target) {
      showModal('CFS link', ['"' + current.name + '" → (empty target)']);
      return;
    }
    var startLba = target.charAt(0) === '/' ? partition.cfsRootDir.addr : cfsDirLba;
    current = cfsResolvePath(hddBuffer, startLba, target);
    if (!current) {
      showModal('CFS link', [
        '"' + entry.name + '" → ' + target,
        'Target not found in this partition.',
      ]);
      return;
    }
  }
  if (!current) return;

  // Resolved to a non-LNK entry: act on it.
  if (current.ftype === CFS_FTYPE.DIR) {
    enterCfsSubdir(current);
  } else if (current.ftype === CFS_FTYPE.DEL) {
    showModal('CFS link', ['"' + entry.name + '" resolves to a deleted entry.']);
  } else {
    showCfsFileHexViewer(current);
  }
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

  // Footer: View as / Rename / Attrs / Download / Close
  var footer = document.querySelector('#modal-overlay .modal-footer');
  footer.innerHTML =
    '<button id="cfs-view-petscii">PETSCII</button> ' +
    '<button id="cfs-view-basic">BASIC</button> ' +
    '<button id="cfs-rename">Rename&hellip;</button> ' +
    '<button id="cfs-attrs">Attributes&hellip;</button> ' +
    '<button id="cfs-dl">Download</button> ' +
    '<button id="cfs-delete">Delete</button> ' +
    '<button id="modal-close">Close</button>';

  // PETSCII view — opens a second modal via the shared viewer with our bytes.
  document.getElementById('cfs-view-petscii').addEventListener('click', function() {
    showFilePetsciiViewer(0, { data: payload, name: entry.name });
  });
  // BASIC view — only meaningful for PRG-ish content but show it anyway;
  // the viewer surfaces "not a valid BASIC program" on its own.
  document.getElementById('cfs-view-basic').addEventListener('click', function() {
    showFileBasicViewer(0, { data: payload, name: entry.name });
  });
  document.getElementById('cfs-rename').addEventListener('click', function() {
    showCfsRenameDialog(entry);
  });
  document.getElementById('cfs-attrs').addEventListener('click', function() {
    showCfsAttrsDialog(entry);
  });
  document.getElementById('cfs-delete').addEventListener('click', function() {
    showCfsDeleteConfirm(entry);
  });
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

// ── CFS rename dialog (Phase 4a) ──────────────────────────────────────
// Plain text input. CFS names are 16 bytes, space-padded; the field
// accepts any printable ASCII. The PETSCII editor used by CBM-DOS isn't
// quite right here — CFS stores names verbatim (ASCII for the reference
// images I've seen), not as PETSCII.
function showCfsRenameDialog(entry) {
  if (!entry || entry.dirLba == null) return;
  var titleEl = document.getElementById('modal-title');
  var body = document.getElementById('modal-body');
  var footer = document.querySelector('#modal-overlay .modal-footer');
  titleEl.textContent = 'Rename — ' + entry.name;
  body.innerHTML =
    '<div class="text-md mb-md">New name (up to 16 characters):</div>' +
    '<input type="text" id="cfs-rename-input" maxlength="16" style="width:100%;font-family:monospace;font-size:14px;padding:6px" />';
  var input = document.getElementById('cfs-rename-input');
  input.value = entry.name;
  setTimeout(function() { input.focus(); input.select(); }, 0);
  footer.innerHTML = '<button id="cfs-rename-ok">OK</button> <button id="cfs-rename-cancel">Cancel</button>';
  function commit() {
    var newName = input.value;
    if (newName === entry.name) {
      document.getElementById('modal-overlay').classList.remove('open');
      return;
    }
    pushUndo();
    if (cfsWriteDirEntryName(hddBuffer, entry.dirLba, entry.index, newName)) {
      document.getElementById('modal-overlay').classList.remove('open');
      refreshIde64View();
    } else {
      showModal('Rename failed', ['Could not write the new name.']);
    }
  }
  document.getElementById('cfs-rename-ok').addEventListener('click', commit);
  document.getElementById('cfs-rename-cancel').addEventListener('click', function() {
    document.getElementById('modal-overlay').classList.remove('open');
  });
  input.addEventListener('keydown', function(e) {
    if (e.key === 'Enter') commit();
    else if (e.key === 'Escape') document.getElementById('modal-overlay').classList.remove('open');
  });
}

// ── CFS import single-sector file (Phase 4b) ──────────────────────────
// Pops a native file picker. On selection: if the file is ≤ 512 bytes,
// allocates a tree + data sector and creates a dir entry. Larger files
// are refused with a "Phase 5" placeholder.
function showCfsImportPicker() {
  if (cfsPartitionIdx < 0 || !hddPartitions) return;
  var part = hddPartitions[cfsPartitionIdx];
  if (!part) return;
  var input = document.createElement('input');
  input.type = 'file';
  input.style.display = 'none';
  document.body.appendChild(input);
  input.addEventListener('change', function() {
    var file = input.files && input.files[0];
    document.body.removeChild(input);
    if (!file) return;
    if (file.size > 512) {
      showModal('Import not supported', [
        '"' + file.name + '" is ' + file.size + ' bytes.',
        'Single-sector import (≤ 512 B) is the Phase 4b scope; multi-sector imports come in Phase 5.',
      ]);
      return;
    }
    file.arrayBuffer().then(function(buf) {
      var payload = new Uint8Array(buf);
      // Build a name from the source filename: drop extension, uppercase,
      // truncate to 16 chars, sanitize non-alphanumerics to underscores.
      var baseName = file.name.replace(/\.[^.]+$/, '').toUpperCase().replace(/[^A-Z0-9_-]/g, '_').slice(0, 16);
      if (!baseName) baseName = 'IMPORTED';
      // Type suffix from extension (if present and 1-3 chars)
      var ext = (file.name.match(/\.([^.]+)$/) || [])[1] || 'PRG';
      ext = ext.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 3) || 'PRG';

      pushUndo();
      var res = cfsImportSingleSectorFile(hddBuffer, part.startLba, part.endLba, cfsDirLba, baseName, payload, {
        ftype: CFS_FTYPE.NORMAL,
        typeSuffix: ext,
      });
      if (!res.ok) {
        showModal('Import failed', [res.error || 'Unknown error.']);
        // Undo to roll back any partial allocation
        if (typeof popUndo === 'function') popUndo();
        return;
      }
      refreshIde64View();
    });
  });
  input.click();
}

// ── CFS delete (Phase 4b) ─────────────────────────────────────────────
// Frees the file's data + tree sectors in the bitmap and marks the dir
// entry as deleted. Confirmation modal before mutation.
function showCfsDeleteConfirm(entry) {
  if (!entry || cfsPartitionIdx < 0 || !hddPartitions) return;
  var part = hddPartitions[cfsPartitionIdx];
  if (!part) return;
  var titleEl = document.getElementById('modal-title');
  var body = document.getElementById('modal-body');
  var footer = document.querySelector('#modal-overlay .modal-footer');
  titleEl.textContent = 'Delete file';
  body.innerHTML =
    '<div class="text-md mb-md">Delete <b>' + escHtml(entry.name) + '</b> (' + entry.size + ' bytes)?</div>' +
    '<div class="text-sm text-muted">Data sectors are returned to the partition\'s free-block pool. The directory entry is marked deleted with the original tree pointer preserved (recovery context).</div>';
  footer.innerHTML = '<button id="cfs-del-ok">Delete</button> <button id="cfs-del-cancel">Cancel</button>';
  document.getElementById('cfs-del-ok').addEventListener('click', function() {
    pushUndo();
    var res = cfsDeleteFile(hddBuffer, part.startLba, part.endLba, entry);
    if (!res.ok) {
      showModal('Delete failed', [res.error || 'Unknown error.']);
      return;
    }
    document.getElementById('modal-overlay').classList.remove('open');
    refreshIde64View();
  });
  document.getElementById('cfs-del-cancel').addEventListener('click', function() {
    document.getElementById('modal-overlay').classList.remove('open');
  });
}

// ── CFS attribute editor (Phase 4a) ───────────────────────────────────
// Edits bits 7..3 of the attribute byte at dir-entry +$18 (Closed +
// Deleteable + Readable + Writeable + Executable). Bits 2..0 are the
// file type and are preserved as-is — type changes are a separate flow.
function showCfsAttrsDialog(entry) {
  if (!entry || entry.dirLba == null) return;
  var titleEl = document.getElementById('modal-title');
  var body = document.getElementById('modal-body');
  var footer = document.querySelector('#modal-overlay .modal-footer');
  titleEl.textContent = 'Attributes — ' + entry.name;
  var attr = entry.attrByte;
  body.innerHTML =
    '<div class="text-md mb-md">File: <b>' + escHtml(entry.name) + '</b></div>' +
    '<label style="display:block;margin:6px 0"><input type="checkbox" id="cfs-attr-c"' +
      ((attr & 0x80) ? ' checked' : '') + ' /> Closed (active file, not deleted)</label>' +
    '<label style="display:block;margin:6px 0"><input type="checkbox" id="cfs-attr-d"' +
      ((attr & 0x40) ? ' checked' : '') + ' /> Deleteable</label>' +
    '<label style="display:block;margin:6px 0"><input type="checkbox" id="cfs-attr-r"' +
      ((attr & 0x20) ? ' checked' : '') + ' /> Readable</label>' +
    '<label style="display:block;margin:6px 0"><input type="checkbox" id="cfs-attr-w"' +
      ((attr & 0x10) ? ' checked' : '') + ' /> Writeable</label>' +
    '<label style="display:block;margin:6px 0"><input type="checkbox" id="cfs-attr-x"' +
      ((attr & 0x08) ? ' checked' : '') + ' /> Executable</label>' +
    '<div class="text-sm text-muted" style="margin-top:8px">File type (' +
      escHtml(_cfsFtypeLabel(entry.ftype)) + ') is preserved.</div>';
  footer.innerHTML = '<button id="cfs-attrs-ok">OK</button> <button id="cfs-attrs-cancel">Cancel</button>';
  document.getElementById('cfs-attrs-ok').addEventListener('click', function() {
    var newAttr = entry.attrByte & 0x07; // keep file type
    if (document.getElementById('cfs-attr-c').checked) newAttr |= 0x80;
    if (document.getElementById('cfs-attr-d').checked) newAttr |= 0x40;
    if (document.getElementById('cfs-attr-r').checked) newAttr |= 0x20;
    if (document.getElementById('cfs-attr-w').checked) newAttr |= 0x10;
    if (document.getElementById('cfs-attr-x').checked) newAttr |= 0x08;
    if (newAttr === entry.attrByte) {
      document.getElementById('modal-overlay').classList.remove('open');
      return;
    }
    pushUndo();
    if (cfsWriteDirEntryAttrByte(hddBuffer, entry.dirLba, entry.index, newAttr)) {
      document.getElementById('modal-overlay').classList.remove('open');
      refreshIde64View();
    } else {
      showModal('Attribute change failed', ['Could not write the attribute byte.']);
    }
  });
  document.getElementById('cfs-attrs-cancel').addEventListener('click', function() {
    document.getElementById('modal-overlay').classList.remove('open');
  });
}
