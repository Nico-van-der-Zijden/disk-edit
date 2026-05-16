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

// True iff `entry` is the system-managed "<<DELETED FILES>>" placeholder
// that lives in every CFS partition's root dir. Canonical detection:
// its data-tree pointer points at the partition's deldir LBA (recorded
// in the partition entry's $18..$1B field). Name spelling and slot
// position aren't checked because IDEDOS could in theory write either
// differently. Used to refuse rename / scratch / case-flip on this
// entry — analogous to DHD's SYSTEM-partition protection.
function _cfsEntryIsDeldirRef(entry) {
  if (!entry || cfsPartitionIdx < 0 || !hddPartitions) return false;
  var part = hddPartitions[cfsPartitionIdx];
  if (!part || !part.cfsDeletedDir || !part.cfsDeletedDir.lba) return false;
  if (!entry.dataTreePtr || !entry.dataTreePtr.lba) return false;
  return entry.dataTreePtr.addr === part.cfsDeletedDir.addr;
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
  // Preserve scroll across the rebuild — partition-list edits (rename,
  // attrs, default flag, delete, restore) shouldn't fling the list back
  // to the top. The scrollable slot is .dir-listing inside #content (see
  // renderCfsDirectoryView for the same pattern).
  var prevListing = content ? content.querySelector('.dir-listing') : null;
  var prevScrollTop = prevListing ? prevListing.scrollTop : 0;
  var prevScrollLeft = prevListing ? prevListing.scrollLeft : 0;
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
      '<span class="dir-hdd-default"></span>' +
      '<span class="dir-type">Type</span>' +
      '<span class="dir-slot">#</span>' +
      '<span class="dir-hdd-start">Start LBA</span>' +
      '<span class="dir-hdd-flags">Flags</span>' +
      '<span class="dir-icons"></span>' +
    '</div>' +
    '<div class="dir-listing">';

  // Render only populated slots — matches the CMD container view, which
  // doesn't list empty entries. Empty slots are reachable via the File →
  // New Partition menu item. Soft-deleted slots (V=0 with metadata still
  // intact) only render when Show Deleted is on, mirroring the File menu
  // toggle behaviour for scratched files.
  var openCount = 0;
  for (var i = 0; i < hddPartitions.length; i++) {
    var p = hddPartitions[i];
    if (p.empty) continue;
    if (p.deleted && !showDeleted) continue;
    var enterable = p.type === 0x01 && !p.deleted; // CFS — other types stay informational; deleted not enterable
    openCount++;

    var sizeBlocks = '';
    var sizeLabel = '';
    if (p.sizeSectors !== null) {
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
    if (p.hidden) flagBits.push('H');
    if (p.writeable) flagBits.push('W');
    if (p.lba) flagBits.push('L');
    var flagStr = flagBits.join('');
    var defaultMark = (i === defaultPart) ? '*' : ' ';

    var nameDisplay = p.name || ('Partition ' + i);
    var extraCls = enterable ? '' : ' disabled-row';
    if (p.deleted) extraCls += ' deleted';
    // Read-only marker — convention: trailing "<" after the type
    // string, mirroring how CBM-DOS marks locked files (e.g. PRG<).
    // Rendered as a child span so .dir-type .hdd-readonly's margin-left
    // can space it from the type letters.
    var typeHtml = escHtml(p.typeName) + (p.writeable ? '' : '<span class="hdd-readonly">&lt;</span>');
    var nameCls = 'dir-name' + (p.hidden ? ' hdd-hidden' : '');
    var rowTitle = p.typeName + (sizeLabel ? ' — ' + sizeLabel : '') +
                   (i === defaultPart ? ' — default partition' : '') +
                   (p.hidden ? ' — hidden' : '') +
                   (!p.writeable ? ' — read-only' : '') +
                   (enterable ? '' : ' — entering this partition type is not yet supported');

    html +=
      '<div class="dir-entry' + extraCls + '" data-hdd-part="' + i + '" title="' + escHtml(rowTitle) + '">' +
        '<span class="dir-grip"></span>' +
        '<span class="dir-blocks">' + sizeBlocks + '</span>' +
        '<span class="' + nameCls + '">"' + escHtml(nameDisplay) + '"</span>' +
        '<span class="dir-hdd-default">' + defaultMark + '</span>' +
        '<span class="dir-type">' + typeHtml + '</span>' +
        '<span class="dir-slot">' + p.index + '</span>' +
        '<span class="dir-hdd-start">' + startHex + '</span>' +
        '<span class="dir-hdd-flags">' + escHtml(flagStr) + '</span>' +
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
  var newListing = content.querySelector('.dir-listing');
  if (newListing) {
    newListing.scrollTop = prevScrollTop;
    newListing.scrollLeft = prevScrollLeft;
  }

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
      if (p.deleted) {
        showModal('Deleted partition', [
          '"' + (petsciiToReadable(p.name) || ('Partition ' + idx)) + '" is soft-deleted.',
          'Use File → Restore Partition to flip the VALID bit back on before entering it.',
        ]);
        return;
      }
      if (p.type === 0x01) {
        enterIde64Partition(idx);
      } else {
        showModal(p.typeName + ' partition', [
          '"' + (petsciiToReadable(p.name) || ('Partition ' + idx)) + '" is a ' + p.typeName + ' partition.',
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
    showModal('CFS partition', ['Partition "' + (petsciiToReadable(p.name) || ('#' + idx)) + '" has no valid root directory pointer.']);
    return;
  }
  var entries = readCfsDirectory(hddBuffer, p.cfsRootDir.addr);
  if (!entries) {
    showModal('CFS partition', ['Could not read the root directory for partition "' + (petsciiToReadable(p.name) || ('#' + idx)) + '".']);
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
    showModal('CFS subdirectory', ['"' + petsciiToReadable(entry.name) + '" has no valid directory sector pointer.']);
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
  // Preserve scroll across the innerHTML rebuild so edits (rename, remove,
  // scratch, restore, attribute toggles, ...) don't bounce the list back
  // to the top. The scrollable element is .dir-listing (overflow-y:auto)
  // inside #content — #content itself doesn't scroll. We capture from the
  // *old* .dir-listing before innerHTML wipes it, then write back to the
  // *new* one after.
  var prevListing = content ? content.querySelector('.dir-listing') : null;
  var prevScrollTop = prevListing ? prevListing.scrollTop : 0;
  var prevScrollLeft = prevListing ? prevListing.scrollLeft : 0;
  // Match DHD/D64/DNP convention: header shows only the *current* dir's
  // name (whether that's the partition root or a subdir). cfsDirStack
  // is still used for ".." navigation but isn't part of the header text.
  var titleName = _cfsCurrentDirDisplayName();

  // Wrap the title in a .font-c64 span so the PUA-PETSCII codepoints
  // in the name actually render via the C64 font. The bare .disk-name
  // wrapper styles in directory.css apply the font only to its inner
  // .editable / .font-c64 children, not to direct text.
  var html = '<div class="disk-panel">' +
    '<div class="disk-header">' +
      '<div class="disk-header-spacer"><i class="fa-solid fa-folder-open" title="CFS directory"></i></div>' +
      '<div class="disk-name"><span class="font-c64">' + escHtml(titleName) + '</span></div>' +
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
    // Single ".." parent row — same shape as the CBM-DOS / DHD parent
    // row in ui-render.js. Goes up one level: subdir → parent, or
    // (at partition root) → the HDD partition list.
    (function() {
      var backTo;
      if (cfsDirStack.length > 0) {
        backTo = petsciiToReadable(cfsDirStack[cfsDirStack.length - 1].name || '..');
      } else {
        backTo = 'partition list';
      }
      return '<div class="dir-entry dir-parent-row" id="dir-parent" data-cfs-back="1" title="' + escHtml('Back to ' + backTo) + '">' +
        '<span class="dir-grip"></span>' +
        '<span class="dir-blocks"><i class="fa-solid fa-arrow-left" style="font-size:11px"></i></span>' +
        '<span class="dir-name"><i class="fa-solid fa-folder-open" style="font-size:11px;margin-right:4px"></i>..</span>' +
        '<span class="dir-type"></span>' +
        '<span class="dir-cfs-mtime"></span>' +
        '<span class="dir-cfs-attrs"></span>' +
        '<span class="dir-icons"></span>' +
      '</div>';
    })();
  // Import row stays in-list (no menu equivalent yet). New subdir is
  // reachable through File → Add Directory (same as DNP/DHD).
  html +=
    '<div class="dir-entry dir-parent-row" data-cfs-import="1">' +
      '<span class="dir-grip"></span>' +
      '<span class="dir-blocks"></span>' +
      '<span class="dir-name">+ Import file&hellip;</span>' +
      '<span class="dir-type"></span>' +
      '<span class="dir-cfs-mtime"></span>' +
      '<span class="dir-cfs-attrs"></span>' +
      '<span class="dir-icons"></span>' +
    '</div>';

  var fileCount = 0;
  var disk = new Uint8Array(hddBuffer);
  for (var i = 0; i < cfsDirEntries.length; i++) {
    var e = cfsDirEntries[i];
    if (e.empty) continue;
    if (e.isSelfRef) continue; // entry 0 of first sector = directory's own name, hide it
    if (e.ftype === CFS_FTYPE.DEL && !showDeleted) continue; // Show Deleted toggle (File menu)

    var absIdx = i; // unique across all chained sectors
    var typeStr = e.typeSuffix || _cfsFtypeLabel(e.ftype);
    // Hide size for directories / links — and also for deleted-directory
    // entries, which keep typeSuffix "DIR" but have ftype=0 (DEL). Without
    // this, a scratched subdir shows "0" in the size column where a live
    // subdir shows nothing.
    var isDirLike = (e.typeSuffix === 'DIR' || e.typeSuffix === 'LNK' ||
                     e.ftype === CFS_FTYPE.DIR || e.ftype === CFS_FTYPE.LNK);
    var sizeStr;
    if (isDirLike) {
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
    // Tooltip renders in the browser's default font, not the C64 PUA
    // font — strip PETSCII codepoints back to plain ASCII so it doesn't
    // come out as ??? / boxes.
    var rowTitle = petsciiToReadable(e.name) + ' — ' + (e.size + ' bytes');

    // Build nameHtml the same way CBM-DOS rows do: read raw bytes via
    // readPetsciiRich so reversed-PETSCII glyphs ($00-$1F, $80-$9F)
    // render with the .petscii-rev wrapper, then pad to 18 chars total
    // (quote + 16 name chars + quote) so column alignment matches DHD.
    //
    // Stop at $A0 or $00 (the byte-level terminators) but NOT at $20 —
    // trailing spaces are meaningful for File → Align (right/center/
    // expand) and we'd otherwise display an aligned name visually
    // indistinguishable from a left-aligned one.
    var entryByteOff = e.dirLba * 512 + e.index * 32;
    var nlen = 16;
    for (var nb = 0; nb < 16; nb++) {
      if (disk[entryByteOff + nb] === 0xA0 || disk[entryByteOff + nb] === 0x00) { nlen = nb; break; }
    }
    var richName = readPetsciiRich(disk, entryByteOff, nlen);
    var nameStr = richName.map(function(c) {
      return c.reversed
        ? '<span class="petscii-rev">' + escHtml(c.char) + '</span>'
        : escHtml(c.char);
    }).join('');
    var nameHtml = '"' + nameStr + '"' + ' '.repeat(Math.max(0, 16 - richName.length));

    html +=
      '<div class="dir-entry' + deletedCls + '" data-cfs-entry="' + absIdx + '" title="' + escHtml(rowTitle) + '">' +
        '<span class="dir-grip"><i class="fa-solid fa-grip-vertical"></i></span>' +
        '<span class="dir-blocks">' + sizeStr + '</span>' +
        '<span class="dir-name">' + nameHtml + '</span>' +
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
  // Restore scroll on the *new* .dir-listing — different DOM node than
  // the one we read from, but same CSS slot. Browsers clamp scrollTop
  // to the new scrollHeight, so removing the last visible row keeps the
  // list anchored at the new bottom instead of jumping.
  var newListing = content.querySelector('.dir-listing');
  if (newListing) {
    newListing.scrollTop = prevScrollTop;
    newListing.scrollLeft = prevScrollLeft;
  }

  // ".." parent row — pops one level. Same handler as DHD's parent row.
  content.querySelectorAll('.dir-entry[data-cfs-back]').forEach(function(row) {
    function goBack() {
      if (cfsDirStack.length > 0) leaveCfsSubdir();
      else leaveCfsPartition();
    }
    row.addEventListener('click', goBack);
    row.addEventListener('dblclick', goBack);
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
    row.addEventListener('dblclick', function(ev) {
      // Dblclick UX mirrors CBM-DOS (ui-render.js): column-aware on file
      // rows, navigation on partitions/dirs. Blocks column → inline
      // block-size edit. DIR entries → enter the directory regardless
      // of where the click landed (same as a CBM partition row). LNK
      // entries → follow the link. DEL → not actionable. Anything else
      // on a regular file → inline rename (matches CBM-DOS's
      // dblclick-on-name → startRenameEntry default).
      if (ev.target && ev.target.classList && ev.target.classList.contains('dir-blocks')) {
        startInlineEditCfsBlockSize(row);
        return;
      }
      if (entry.ftype === CFS_FTYPE.DIR) {
        enterCfsSubdir(entry);
        return;
      }
      if (entry.ftype === CFS_FTYPE.LNK) {
        showCfsLinkTarget(entry);
        return;
      }
      if (entry.ftype === CFS_FTYPE.DEL) {
        showModal('Deleted file', ['Entry is marked deleted; use Restore to bring it back.']);
        return;
      }
      // Regular file (NORMAL / REL): dblclick renames. Hex / PETSCII
      // / BASIC viewers stay reachable from the right-click menu.
      startInlineRenameCfsEntry(row);
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
    showModal('CFS link', ['"' + petsciiToReadable(entry.name) + '" has no target pointer.']);
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
      showModal('CFS link', ['"' + petsciiToReadable(current.name) + '" → (empty target)']);
      return;
    }
    var startLba = target.charAt(0) === '/' ? partition.cfsRootDir.addr : cfsDirLba;
    current = cfsResolvePath(hddBuffer, startLba, target);
    if (!current) {
      showModal('CFS link', [
        '"' + petsciiToReadable(entry.name) + '" → ' + target,
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
    showModal('CFS link', ['"' + petsciiToReadable(entry.name) + '" resolves to a deleted entry.']);
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
    showModal('CFS file', ['"' + petsciiToReadable(entry.name) + '" has no data tree pointer.']);
    return;
  }
  var rootLba = entry.dataTreePtr.addr;
  var res = readCfsFileData(hddBuffer, rootLba, entry.size);
  if (res.error) {
    showModal('CFS file', ['Error reading "' + petsciiToReadable(entry.name) + '": ' + res.error]);
    return;
  }
  var payload = res.data;
  var totalBytes = payload.length;
  // Download filename — plain ASCII so OS file pickers accept it cleanly.
  var readableName = petsciiToReadable(entry.name);
  var suggestedName = readableName + (entry.typeSuffix ? '.' + entry.typeSuffix.toLowerCase() : '');

  var html = '<div class="text-md text-muted mb-md">' +
    escHtml(readableName) + (entry.typeSuffix ? ' (' + escHtml(entry.typeSuffix) + ')' : '') +
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

  var body = showViewerModal('Hex — ' + readableName, html, 'large');

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
    showFilePetsciiViewer(0, { data: payload, name: readableName });
  });
  // BASIC view — only meaningful for PRG-ish content but show it anyway;
  // the viewer surfaces "not a valid BASIC program" on its own.
  document.getElementById('cfs-view-basic').addEventListener('click', function() {
    showFileBasicViewer(0, { data: payload, name: readableName });
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
  var readableName = petsciiToReadable(entry.name);
  titleEl.textContent = 'Rename — ' + readableName;
  body.innerHTML =
    '<div class="text-md mb-md">New name (up to 16 characters):</div>' +
    '<input type="text" id="cfs-rename-input" maxlength="16" style="width:100%;font-family:monospace;font-size:14px;padding:6px" />';
  var input = document.getElementById('cfs-rename-input');
  input.value = readableName;
  setTimeout(function() { input.focus(); input.select(); }, 0);
  footer.innerHTML = '<button id="cfs-rename-ok">OK</button> <button id="cfs-rename-cancel">Cancel</button>';
  function commit() {
    var newName = _sanitiseCfsName(input.value, 'Rename');
    if (newName == null) return;
    if (newName === readableName) {
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

// Validate a CFS partition / dir / file name. Returns the sanitised
// name on success or null with an error message via showModal.
// Disallows `/` since CFS uses it as the path separator in cfsResolvePath
// (and the IDEDOS firmware treats slashes the same way).
function _sanitiseCfsName(input, title) {
  var trimmed = (input || '').trim();
  if (!trimmed) return null;
  if (trimmed.indexOf('/') >= 0) {
    showModal(title || 'Invalid name', [
      'The name can\'t contain a "/" — it\'s the path separator on CFS.',
    ]);
    return null;
  }
  return trimmed.slice(0, 16);
}

// Inline rename for a CFS directory entry (file or subdir). Mirrors
// startInlineRenameHddPartition but writes to the entry's $00..$0F
// (CFS-DOS layout) inside hddBuffer. Selected via data-cfs-entry, which
// stores the absolute index into cfsDirEntries (across all dir-chain
// sectors); each entry has dirLba + index fields that pin the byte
// offset within hddBuffer.
function startInlineRenameCfsEntry(entryEl) {
  if (!hddBuffer || !entryEl || !cfsDirEntries) return;
  var absIdx = parseInt(entryEl.dataset.cfsEntry, 10);
  if (isNaN(absIdx)) return;
  var entry = cfsDirEntries[absIdx];
  if (!entry || entry.empty) return;
  // Block the system-managed "<<DELETED FILES>>" entry — same canonical
  // detection as the menu state uses (tree-ptr === partition's deldir
  // pointer). Defensive: menu state already disables Rename here, but
  // this protects dblclick / context-menu / future entry points too.
  if (_cfsEntryIsDeldirRef(entry)) {
    if (typeof showModal === 'function') {
      showModal('Protected entry', ['The <<DELETED FILES>> entry is system-managed and can\'t be renamed.']);
    }
    return;
  }
  var nameSpan = entryEl.querySelector('.dir-name');
  if (!nameSpan || nameSpan.querySelector('.petscii-editor')) return;
  if (typeof cancelActiveEdits === 'function') cancelActiveEdits();

  var disk = new Uint8Array(hddBuffer);
  var entryOff = entry.dirLba * 512 + entry.index * 32;
  var origBytes = new Uint8Array(16);
  var origLen = 16;
  for (var i = 0; i < 16; i++) {
    origBytes[i] = disk[entryOff + i];
    if ((origBytes[i] === 0xA0 || origBytes[i] === 0x00) && origLen === 16) origLen = i;
  }
  while (origLen > 0 && origBytes[origLen - 1] === 0x20) origLen--;

  var editor = createPetsciiEditor({
    maxLen: 16,
    initialBytes: origBytes,
    initialLen: origLen,
    className: 'name-input'
  });

  nameSpan.textContent = '';
  nameSpan.appendChild(editor);
  nameSpan.classList.add('editing');
  var wasDraggable = entryEl.draggable;
  entryEl.draggable = false;
  editor.focus();
  editor._setCaret(origLen);
  setTimeout(function() {
    if (document.activeElement !== editor) {
      editor.focus();
      editor._setCaret(editor._lastCursorPos);
    }
  }, 0);
  showPetsciiPicker(editor, 16);

  var reverted = false;
  var finished = false;
  function cleanup() {
    nameSpan.classList.remove('editing');
    entryEl.draggable = wasDraggable;
    hidePetsciiPicker();
    if (typeof activeEditEl !== 'undefined') {
      activeEditEl = null;
      activeEditCleanup = null;
    }
  }
  function commit() {
    if (reverted || finished) return;
    finished = true;
    var newBytes = editor.getBytes(16, 0xA0);
    // Reject names containing "/" — CFS path separator.
    var hasSlash = false;
    for (var bi = 0; bi < 16; bi++) {
      if (newBytes[bi] === 0xA0) break;
      if (newBytes[bi] === 0x2F) { hasSlash = true; break; }
    }
    if (hasSlash) {
      showModal('Rename', ['The name can\'t contain a "/" — it\'s the path separator on CFS.']);
      cleanup();
      refreshIde64View();
      return;
    }
    var differs = false;
    for (var di = 0; di < 16; di++) {
      if (newBytes[di] !== disk[entryOff + di]) { differs = true; break; }
    }
    if (differs) {
      pushUndo();
      var data = new Uint8Array(hddBuffer);
      for (var wi = 0; wi < 16; wi++) data[entryOff + wi] = newBytes[wi];
      cfsTouchEntryMtime(hddBuffer, entry.dirLba, entry.index);
    }
    cleanup();
    refreshIde64View();
  }
  function revert() {
    if (finished) return;
    finished = true;
    reverted = true;
    cleanup();
    refreshIde64View();
  }
  editor.addEventListener('blur', function() {
    if (petsciiPicker && petsciiPicker.clicking) {
      editor.focus();
      editor._setCaret(editor._lastCursorPos || 0);
      return;
    }
    commit();
  });
  editor.addEventListener('keydown', function(ev) {
    if (ev.key === 'Enter') { ev.preventDefault(); ev.stopPropagation(); commit(); }
    else if (ev.key === 'Escape') { ev.preventDefault(); ev.stopPropagation(); revert(); }
  });
  if (typeof registerActiveEdit === 'function') registerActiveEdit(nameSpan, revert);
}

// Inline block-size edit for a CFS directory entry. Mirrors the
// CBM-DOS startEditBlockSize UX exactly — dblclick the blocks column,
// type a new block count, enter to commit. CFS stores the file's byte
// count at $10..$13 of the dir entry; the displayed "blocks" value is
// ceil(size / 254). We commit by multiplying the entered block count
// by 254. This loses fine byte-level resolution (1..253 bytes within
// the last block all map to the same displayed block count), which
// matches CBM-DOS's own limitation. Skipped for DIR / LNK / DEL.
function startInlineEditCfsBlockSize(entryEl) {
  if (!hddBuffer || !entryEl || !cfsDirEntries) return;
  var absIdx = parseInt(entryEl.dataset.cfsEntry, 10);
  if (isNaN(absIdx)) return;
  var entry = cfsDirEntries[absIdx];
  if (!entry || entry.empty) return;
  if (entry.ftype === CFS_FTYPE.DIR || entry.ftype === CFS_FTYPE.LNK || entry.ftype === CFS_FTYPE.DEL) return;
  var blocksSpan = entryEl.querySelector('.dir-blocks');
  if (!blocksSpan || blocksSpan.querySelector('input')) return;
  if (typeof cancelActiveEdits === 'function') cancelActiveEdits();

  var currentBlocks = Math.ceil(entry.size / 254);
  var input = document.createElement('input');
  input.type = 'number';
  input.min = '0';
  // Same cap as CBM-DOS — VICE's directory listing truncates anything
  // above 65024, so block-count edits stop there even though the CFS
  // size field is 32 bits wide. Users who need finer / larger sizes can
  // use Set Actual File Size or edit the underlying bytes another way.
  input.max = String(MAX_BLOCKS);
  input.value = String(currentBlocks);
  input.className = 'blocks-input';

  blocksSpan.textContent = '';
  blocksSpan.appendChild(input);
  blocksSpan.classList.add('editing');
  input.focus();
  input.select();

  // `finished` guards against re-entrancy: commit() → refreshIde64View()
  // → innerHTML reset → input loses focus → blur fires → commit() again,
  // which then tries to set innerHTML mid-removal and explodes with
  // "node to be removed is no longer a child". One-shot flag, set at the
  // top of commit/revert, makes the blur a no-op.
  var reverted = false;
  var finished = false;
  function cleanup() {
    blocksSpan.classList.remove('editing');
    if (typeof activeEditEl !== 'undefined') {
      activeEditEl = null;
      activeEditCleanup = null;
    }
  }
  function commit() {
    if (reverted || finished) return;
    var parsed = parseInt(input.value, 10);
    // Validate before setting `finished` — if we bail to revert, revert
    // needs to do its own work and can't short-circuit on `finished`.
    if (!isFinite(parsed) || parsed < 0) { revert(); return; }
    // `input.max` only constrains the spinner buttons — typed values
    // aren't auto-clamped. Clamp here so the stored size matches what
    // VICE will actually display (cap = MAX_BLOCKS = 65024 blocks).
    if (parsed > MAX_BLOCKS) parsed = MAX_BLOCKS;
    finished = true;
    cleanup();
    if (parsed !== currentBlocks) {
      pushUndo();
      cfsWriteFileSize(hddBuffer, entry.dirLba, entry.index, parsed * 254, entry.ftype);
    }
    refreshIde64View();
  }
  function revert() {
    if (finished) return;
    finished = true;
    reverted = true;
    cleanup();
    blocksSpan.textContent = String(currentBlocks);
  }
  input.addEventListener('blur', commit);
  input.addEventListener('keydown', function(ev) {
    if (ev.key === 'Enter') { ev.preventDefault(); ev.stopPropagation(); commit(); }
    else if (ev.key === 'Escape') { ev.preventDefault(); ev.stopPropagation(); revert(); }
  });
  if (typeof registerActiveEdit === 'function') registerActiveEdit(blocksSpan, revert);
}

// Inline rename for an HDD partition row. Mirrors the DHD/RAMLink/FD
// pattern (startRenameEntry from ui-directory.js): drop in a PETSCII
// editor + the on-screen PETSCII keyboard. Writes 16 bytes at the
// partition entry's $00..$0F (different from CBM-DOS's +$05 layout)
// and pads short names with $A0 like CBM convention.
function startInlineRenameHddPartition(entryEl) {
  if (!hddBuffer || !entryEl) return;
  var slotIdx = parseInt(entryEl.dataset.hddPart, 10);
  if (isNaN(slotIdx) || slotIdx < 0) return;
  var p = hddPartitions && hddPartitions[slotIdx];
  if (!p || p.empty || p.deleted) return;
  var nameSpan = entryEl.querySelector('.dir-name');
  if (!nameSpan || nameSpan.querySelector('.petscii-editor')) return;
  if (typeof cancelActiveEdits === 'function') cancelActiveEdits();

  // Read the 16 raw name bytes from the partition table entry. Mark
  // the editor's initial length at the first $A0 (CBM padding) or $00.
  var disk = new Uint8Array(hddBuffer);
  var entryOff = 1 * 512 + slotIdx * 32; // partition table at LBA 1
  var origBytes = new Uint8Array(16);
  var origLen = 16;
  for (var i = 0; i < 16; i++) {
    origBytes[i] = disk[entryOff + i];
    if ((origBytes[i] === 0xA0 || origBytes[i] === 0x00) && origLen === 16) origLen = i;
  }
  // Also trim trailing spaces from the display length so the editor's
  // caret sits right after the visible text on space-padded names.
  while (origLen > 0 && origBytes[origLen - 1] === 0x20) origLen--;

  var editor = createPetsciiEditor({
    maxLen: 16,
    initialBytes: origBytes,
    initialLen: origLen,
    className: 'name-input'
  });

  nameSpan.textContent = '';
  nameSpan.appendChild(editor);
  nameSpan.classList.add('editing');
  var wasDraggable = entryEl.draggable;
  entryEl.draggable = false;
  editor.focus();
  editor._setCaret(origLen);
  setTimeout(function() {
    if (document.activeElement !== editor) {
      editor.focus();
      editor._setCaret(editor._lastCursorPos);
    }
  }, 0);
  showPetsciiPicker(editor, 16);

  var reverted = false;
  var finished = false;

  function cleanup() {
    nameSpan.classList.remove('editing');
    entryEl.draggable = wasDraggable;
    hidePetsciiPicker();
    if (typeof activeEditEl !== 'undefined') {
      activeEditEl = null;
      activeEditCleanup = null;
    }
  }

  function commit() {
    if (reverted || finished) return;
    finished = true;
    var newBytes = editor.getBytes(16, 0xA0);
    // Reject names containing a "/" — CFS uses it as path separator.
    var hasSlash = false;
    for (var bi = 0; bi < 16; bi++) {
      if (newBytes[bi] === 0xA0) break;
      if (newBytes[bi] === 0x2F) { hasSlash = true; break; }
    }
    if (hasSlash) {
      showModal('Rename Partition', ['The name can\'t contain a "/" — it\'s the path separator on CFS.']);
      // Revert UI but keep the buffer untouched.
      cleanup();
      refreshIde64View();
      return;
    }
    var differs = false;
    for (var di = 0; di < 16; di++) {
      if (newBytes[di] !== disk[entryOff + di]) { differs = true; break; }
    }
    if (differs) {
      pushUndo();
      var data = new Uint8Array(hddBuffer);
      for (var wi = 0; wi < 16; wi++) data[entryOff + wi] = newBytes[wi];
    }
    cleanup();
    var info = readIde64Partitions(hddBuffer);
    if (info) {
      hddBootInfo = info;
      hddPartitions = info.partitions;
    }
    refreshIde64View();
  }
  function revert() {
    if (finished) return;
    finished = true;
    reverted = true;
    cleanup();
    refreshIde64View();
  }

  editor.addEventListener('blur', function() {
    if (petsciiPicker && petsciiPicker.clicking) {
      editor.focus();
      editor._setCaret(editor._lastCursorPos || 0);
      return;
    }
    commit();
  });
  editor.addEventListener('keydown', function(ev) {
    if (ev.key === 'Enter') { ev.preventDefault(); ev.stopPropagation(); commit(); }
    else if (ev.key === 'Escape') { ev.preventDefault(); ev.stopPropagation(); revert(); }
  });
  if (typeof registerActiveEdit === 'function') registerActiveEdit(nameSpan, revert);
}

// ── HDD partition editor (Phase 6 cosmetics) ──────────────────────────
// New-partition dialog: slot picker, name, start LBA, size in MiB.
// Rename is now inline (startInlineRenameHddPartition) — this function
// only handles New from now on, even though it accepts the same -1
// sentinel the dispatch uses.
function showHddPartitionEditor(idx) {
  if (!hddBuffer || !hddPartitions) return;
  // Rename is handled by the inline editor (startInlineRenameHddPartition)
  // — this function only covers New now.
  if (idx != null && idx >= 0) return;
  var totalLbas = hddBuffer.byteLength / 512;

  // Compute the next free LBA past every *live* partition. Deleted
  // partitions still carry an end LBA but their range is up for grabs —
  // creating a new partition that overlaps a deleted one wipes the
  // deleted slot's entry in the commit step below (the data is already
  // considered lost by the user).
  var defaultStart = 2;
  for (var pi = 0; pi < hddPartitions.length; pi++) {
    var p = hddPartitions[pi];
    if (p.empty || p.deleted) continue;
    if (p.endLba != null && p.endLba + 1 > defaultStart) defaultStart = p.endLba + 1;
  }
  var maxLbas = totalLbas - defaultStart;
  if (maxLbas < 8) {
    showModal('New partition', ['Not enough free space left in this .hdd image.']);
    return;
  }
  var maxMib = Math.max(1, Math.floor(maxLbas * 512 / (1024 * 1024)));
  var defaultMib = Math.min(maxMib, 4);

  // Empty + deleted slots are both available for reuse. Deleted slots
  // are labelled so the user knows they're overwriting a recoverable
  // entry; commit() will zero any deleted slot that overlaps the new
  // partition's LBA range.
  var reusable = function(pp) { return pp.empty || pp.deleted; };
  var firstReusable = hddPartitions.findIndex(reusable);
  var slotOpts = '';
  for (var si = 0; si < hddPartitions.length; si++) {
    if (!reusable(hddPartitions[si])) continue;
    var label = 'Slot ' + si + (hddPartitions[si].deleted ? ' (deleted)' : '');
    slotOpts += '<option value="' + si + '"' + (si === firstReusable ? ' selected' : '') + '>' + label + '</option>';
  }

  var titleEl = document.getElementById('modal-title');
  var body = document.getElementById('modal-body');
  var footer = document.querySelector('#modal-overlay .modal-footer');
  titleEl.textContent = 'New CFS partition';

  body.innerHTML =
    '<div style="display:grid;grid-template-columns:auto 1fr;gap:8px 12px;align-items:center;font-family:inherit">' +
      '<label for="hdd-pe-slot">Slot:</label>' +
      '<select id="hdd-pe-slot" style="font-family:monospace;font-size:14px;padding:4px">' + slotOpts + '</select>' +
      '<label for="hdd-pe-name">Name:</label>' +
      '<input type="text" id="hdd-pe-name" maxlength="16" value="PARTITION" style="font-family:monospace;font-size:14px;padding:6px" />' +
      '<label for="hdd-pe-start">Start LBA:</label>' +
      '<input type="number" id="hdd-pe-start" min="2" max="' + (totalLbas - 8) + '" value="' + defaultStart + '" style="width:160px;font-family:monospace;font-size:14px;padding:6px" />' +
      '<label for="hdd-pe-size">Size (MiB):</label>' +
      '<input type="number" id="hdd-pe-size" min="1" max="' + maxMib + '" value="' + defaultMib + '" style="width:160px;font-family:monospace;font-size:14px;padding:6px" />' +
    '</div>';

  footer.innerHTML = '<button id="hdd-pe-ok">Create</button> <button id="hdd-pe-cancel">Cancel</button>';

  function commit() {
    var partitionName = _sanitiseCfsName(document.getElementById('hdd-pe-name').value, 'New partition');
    if (partitionName == null) return;
    var slot = parseInt(document.getElementById('hdd-pe-slot').value, 10);
    var startLba = parseInt(document.getElementById('hdd-pe-start').value, 10);
    var mib = parseInt(document.getElementById('hdd-pe-size').value, 10);
    if (!startLba || startLba < 2 || !mib || mib < 1) return;
    var endLba = Math.min(totalLbas - 1, startLba + Math.floor(mib * 1024 * 1024 / 512) - 1);
    pushUndo();
    // Any deleted partition whose LBA range overlaps the new partition's
    // range becomes unrestorable — its data sectors will be reinitialised
    // by cfsInitPartitionStorage. Zero those stale slot entries first so
    // the partition list doesn't show a deleted entry pointing into a
    // freshly-allocated partition.
    for (var oi = 0; oi < hddPartitions.length; oi++) {
      var op = hddPartitions[oi];
      if (oi === slot || !op.deleted) continue;
      if (op.startLba == null || op.endLba == null) continue;
      if (op.endLba >= startLba && op.startLba <= endLba) {
        cfsRemovePartitionEntry(hddBuffer, oi);
      }
    }
    var init = cfsInitPartitionStorage(hddBuffer, startLba, endLba, partitionName);
    if (!init.ok) {
      showModal('New partition failed', [init.error || 'Could not initialise partition storage.']);
      if (typeof popUndo === 'function') popUndo();
      return;
    }
    var add = cfsAddPartitionToTable(hddBuffer, slot, partitionName, startLba, endLba, init.rootDirLba, init.deletedDirLba, 0x01);
    if (!add.ok) {
      showModal('New partition failed', [add.error || 'Could not write the partition entry.']);
      if (typeof popUndo === 'function') popUndo();
      return;
    }
    // First partition into an otherwise-empty image becomes default.
    // Counts include the slot we just wrote; everything else must be
    // empty for the populated total to land at 1.
    var populated = 0;
    for (var pi = 0; pi < hddPartitions.length; pi++) {
      if (pi === slot) { populated++; continue; }
      if (!hddPartitions[pi].empty && !hddPartitions[pi].deleted) populated++;
    }
    if (populated === 1) cfsSetDefaultPartition(hddBuffer, slot);
    var info = readIde64Partitions(hddBuffer);
    if (info) {
      hddBootInfo = info;
      hddPartitions = info.partitions;
    }
    document.getElementById('modal-overlay').classList.remove('open');
    refreshIde64View();
  }
  document.getElementById('hdd-pe-ok').addEventListener('click', commit);
  document.getElementById('hdd-pe-cancel').addEventListener('click', function() {
    document.getElementById('modal-overlay').classList.remove('open');
  });
  document.getElementById('modal-overlay').classList.add('open');
}

// ── HDD partition attributes dialog ───────────────────────────────────
// Hidden / Writeable are the two user-editable flag bits in the start-
// pointer byte ($10) of a partition entry. VALID and LBA aren't user-
// editable here — flipping them off would unmount the partition and
// LBA-vs-CHS addressing isn't a thing we want users toggling per slot.
function showHddPartitionAttrsDialog(idx) {
  if (!hddBuffer || !hddPartitions) return;
  var p = hddPartitions[idx];
  if (!p || p.empty || p.deleted) return;
  var isDefault = hddBootInfo && hddBootInfo.defaultPart === idx;
  // Count live partitions — when there's only one, the default checkbox
  // can't be unchecked (CFS always has exactly one default, and
  // unchecking would leave no valid choice). Deleted slots don't count.
  var populatedCount = 0;
  for (var pi = 0; pi < hddPartitions.length; pi++) {
    if (!hddPartitions[pi].empty && !hddPartitions[pi].deleted) populatedCount++;
  }
  var defaultLocked = isDefault && populatedCount <= 1;
  var titleEl = document.getElementById('modal-title');
  var body = document.getElementById('modal-body');
  var footer = document.querySelector('#modal-overlay .modal-footer');
  var partLabel = petsciiToReadable(p.name) || ('slot ' + idx);
  titleEl.textContent = 'Partition Attributes — ' + partLabel;
  body.innerHTML =
    '<div class="text-md mb-md">Partition: <b>' + escHtml(partLabel) + '</b></div>' +
    '<label style="display:block;margin:6px 0"><input type="checkbox" id="hdd-attr-hidden"' +
      (p.hidden ? ' checked' : '') + ' /> Hidden</label>' +
    '<label style="display:block;margin:6px 0"><input type="checkbox" id="hdd-attr-writeable"' +
      (p.writeable ? ' checked' : '') + ' /> Writeable</label>' +
    '<label style="display:block;margin:6px 0"><input type="checkbox" id="hdd-attr-default"' +
      (isDefault ? ' checked' : '') + (defaultLocked ? ' disabled' : '') + ' /> Default partition' +
      (defaultLocked ? ' <span class="text-sm text-muted">(only partition — must remain default)</span>' : '') +
      '</label>';
  footer.innerHTML = '<button id="hdd-attr-ok">OK</button> <button id="hdd-attr-cancel">Cancel</button>';
  document.getElementById('hdd-attr-ok').addEventListener('click', function() {
    var newHidden = document.getElementById('hdd-attr-hidden').checked;
    var newWriteable = document.getElementById('hdd-attr-writeable').checked;
    var newDefault = document.getElementById('hdd-attr-default').checked;
    var flagsChanged = (newHidden !== p.hidden) || (newWriteable !== p.writeable);
    var defaultChanged = (newDefault !== isDefault);
    if (!flagsChanged && !defaultChanged) {
      document.getElementById('modal-overlay').classList.remove('open');
      return;
    }
    pushUndo();
    if (flagsChanged) {
      var res = cfsWritePartitionFlags(hddBuffer, idx, newHidden, newWriteable);
      if (!res.ok) {
        showModal('Partition Attributes failed', [res.error || 'Unknown error.']);
        if (typeof popUndo === 'function') popUndo();
        return;
      }
    }
    if (defaultChanged) {
      // Toggling off the default partition reverts to slot 0 — there's
      // always exactly one default in the boot sector.
      var dres = cfsSetDefaultPartition(hddBuffer, newDefault ? idx : 0);
      if (!dres.ok) {
        showModal('Partition Attributes failed', [dres.error || 'Unknown error.']);
        if (typeof popUndo === 'function') popUndo();
        return;
      }
    }
    var info = readIde64Partitions(hddBuffer);
    if (info) {
      hddBootInfo = info;
      hddPartitions = info.partitions;
    }
    document.getElementById('modal-overlay').classList.remove('open');
    refreshIde64View();
  });
  document.getElementById('hdd-attr-cancel').addEventListener('click', function() {
    document.getElementById('modal-overlay').classList.remove('open');
  });
  document.getElementById('modal-overlay').classList.add('open');
}

// Delete confirmation for a partition slot. Matches the DHD/RAMLink/FD
// delete dialog shape (showChoiceModal with the same "Delete partition
// "<name>" (<type>, <blocks>)" wording) for cross-container consistency.
// CFS partition names are ASCII so no PETSCII conversion is needed.
async function confirmHddPartitionDelete(idx) {
  if (!hddBuffer || !hddPartitions) return;
  var p = hddPartitions[idx];
  if (!p || p.empty || p.deleted) return;
  var blocks = p.sizeSectors !== null ? (p.sizeSectors * 2) : '?';
  // p.name may carry PUA-PETSCII codepoints — petsciiToReadable strips
  // them down to plain ASCII for the modal text.
  var nameForModal = petsciiToReadable(p.name || '') || ('slot ' + idx);
  var choice = await showChoiceModal(
    'Delete Partition',
    'Delete partition "' + nameForModal + '" (' + p.typeName + ', ' + blocks + ' blocks)? It will be recoverable via Restore Partition until the slot is reused.',
    [
      { label: 'Cancel', value: false, secondary: true },
      { label: 'Delete', value: true }
    ]
  );
  if (!choice) return;
  pushUndo();
  // Soft delete — clears the VALID bit, preserves all metadata, mirrors
  // to the backup partition directory + bumps the boot-sector generation
  // counter. Matches IDEDOS scratch byte-for-byte.
  var res = cfsSoftDeletePartition(hddBuffer, idx);
  if (!res.ok) {
    showModal('Delete partition failed', [res.error || 'Unknown error.']);
    if (typeof popUndo === 'function') popUndo();
    return;
  }
  // If we just dropped the default, point it at the first remaining
  // live partition (skip deleted slots too — they can't be the default).
  if (hddBootInfo && hddBootInfo.defaultPart === idx) {
    var newDefault = 0;
    for (var pi = 0; pi < hddPartitions.length; pi++) {
      if (pi !== idx && !hddPartitions[pi].empty && !hddPartitions[pi].deleted) { newDefault = pi; break; }
    }
    cfsSetDefaultPartition(hddBuffer, newDefault);
  }
  var info = readIde64Partitions(hddBuffer);
  if (info) {
    hddBootInfo = info;
    hddPartitions = info.partitions;
  }
  refreshIde64View();
}

// Restore a soft-deleted partition slot. Flips VALID back on, mirrors to
// the backup partition dir, bumps the generation counter. The partition's
// internal storage (bitmap, root dir, files) is untouched by the delete,
// so a restore immediately brings everything back as long as nothing was
// allocated over the slot's LBA range in the meantime. UI gate: only
// callable from a row where p.deleted === true.
async function confirmHddPartitionRestore(idx) {
  if (!hddBuffer || !hddPartitions) return;
  var p = hddPartitions[idx];
  if (!p || !p.deleted) return;
  pushUndo();
  var res = cfsRestorePartition(hddBuffer, idx);
  if (!res.ok) {
    showModal('Restore partition failed', [res.error || 'Unknown error.']);
    if (typeof popUndo === 'function') popUndo();
    return;
  }
  var info = readIde64Partitions(hddBuffer);
  if (info) {
    hddBootInfo = info;
    hddPartitions = info.partitions;
  }
  refreshIde64View();
}

// ── CFS new subdirectory ──────────────────────────────────────────────
// Same modal + uppercase-then-truncate that DHD's Add Directory uses
// (showInputModal + .toUpperCase().substring(0, 16)) — so the name is
// stored as proper PETSCII uppercase letter bytes ($41-$5A), which
// render correctly in either uppercase or lowercase charset mode.
async function showCfsNewSubdirDialog() {
  if (cfsPartitionIdx < 0 || !hddPartitions) return;
  var part = hddPartitions[cfsPartitionIdx];
  if (!part) return;
  var name = await showInputModal('Directory Name', 'SUBDIR');
  if (!name) return;
  name = name.toUpperCase().substring(0, 16);
  if (_sanitiseCfsName(name, 'New subdirectory') == null) return;
  pushUndo();
  var res = cfsCreateSubdir(hddBuffer, part.startLba, part.endLba, cfsDirLba, name);
  if (!res.ok) {
    showModal('Create subdirectory failed', [res.error || 'Unknown error.']);
    if (typeof popUndo === 'function') popUndo();
    return;
  }
  refreshIde64View();
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
    var importCap = 4 * 1024 * 1024;
    if (file.size > importCap) {
      showModal('Import not supported', [
        '"' + file.name + '" is ' + file.size + ' bytes.',
        'The UI caps imports at 4 MiB. Larger files would need depth-3+ trees; the format handles them but the partition would have to be huge.',
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
      var res = cfsImportFile(hddBuffer, part.startLba, part.endLba, cfsDirLba, baseName, payload, {
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
    '<div class="text-md mb-md">Delete <b>' + escHtml(petsciiToReadable(entry.name)) + '</b> (' + entry.size + ' bytes)?</div>' +
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
  var readableAttrName = petsciiToReadable(entry.name);
  titleEl.textContent = 'Attributes — ' + readableAttrName;
  var attr = entry.attrByte;
  body.innerHTML =
    '<div class="text-md mb-md">File: <b>' + escHtml(readableAttrName) + '</b></div>' +
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
