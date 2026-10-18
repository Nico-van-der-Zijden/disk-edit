// ── IDE64 .hdd: partition list + CFS directory views ─────────────────
// State globals (hddBuffer, hddPartitions, hddBootInfo, cfs*) live in
// cbm-editor.js and are saved per tab.

function isIde64ContainerView() {
  return !!hddBuffer && !!hddPartitions;
}

// Active drag source for CFS row reordering. Set by per-row dragstart in
// renderCfsDirectoryView, cleared on drop / dragend. Module-level so all
// row handlers in the current dir share it (mirrors dragSrcOffset in
// ui-render.js for CBM-DOS rows).
var _dragSrcCfsIdx = null;

// True inside a CFS partition (vs. the partition list).
function isCfsPartitionView() {
  return !!hddBuffer && cfsPartitionIdx >= 0;
}

// True for the root dir's system-managed <<DELETED FILES>> entry: its
// pointer is the partition's deldir LBA (name and slot aren't reliable).
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

// Roll back a failed edit: drop its pushUndo snapshot (no redo step) and
// re-read the partition table from the restored buffer.
function _hddDiscardEdit() {
  if (!discardUndo()) return;
  var info = readIde64Partitions(hddBuffer);
  if (info) {
    hddBootInfo = info;
    hddPartitions = info.partitions;
  }
}

function refreshIde64View() {
  // Undo / redo swap currentBuffer; re-read everything from the new one.
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
  var label = hddBootInfo.label || '';
  var defaultPart = hddBootInfo.defaultPart;
  // Show the boot-sector disk label in the header — matches what
  // cfsfdisk's "p" command and IDEDOS's mount listing display. The
  // filename is already visible in the tab title, so duplicating it
  // here just hides the more interesting datum. Fall back to the
  // filename if the label is empty (older / hand-built images).
  var headerName = label || hddFileName || 'IDE64';

  var html = '<div class="disk-panel">' +
    '<div class="disk-header">' +
      '<div class="disk-header-spacer"><i class="fa-solid fa-hard-drive" title="IDE64 hard-disk image"></i></div>' +
      '<div class="disk-name">' + escHtml(headerName) + '</div>' +
      '<div class="disk-id">IDE64</div>' +
    '</div>' +
    '<div class="dir-entry dir-header-row">' +
      '<span class="dir-grip"></span>' +
      '<span class="dir-blocks dir-blocks-container">Size</span>' +
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

    // Size string honours the global Partition Sizes in MiB toggle (Options
    // menu). MiB by default — CBM blocks would be 7+ digits on a 512 MiB
    // CFS partition. Tooltip below still includes the MiB label for clarity.
    var sizeBlocks = p.sizeSectors !== null ? (p.sizeSectors * 2) : null;
    var sizeStr = p.sizeSectors !== null ? formatPartitionSize(p.sizeBytes, sizeBlocks) : '';
    var mibLabel = '';
    if (p.sizeSectors !== null) {
      var mibVal = p.sizeBytes / (1024 * 1024);
      mibLabel = mibVal >= 1
        ? (mibVal < 10 ? mibVal.toFixed(2) : Math.round(mibVal)) + ' MiB'
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
    var rowTitle = p.typeName + (mibLabel ? ' — ' + mibLabel : '') +
                   (i === defaultPart ? ' — default partition' : '') +
                   (p.hidden ? ' — hidden' : '') +
                   (!p.writeable ? ' — read-only' : '') +
                   (enterable ? '' : ' — entering this partition type is not yet supported');

    html +=
      '<div class="dir-entry' + extraCls + '" data-hdd-part="' + i + '" title="' + escHtml(rowTitle) + '">' +
        '<span class="dir-grip"></span>' +
        '<span class="dir-blocks dir-blocks-container">' + sizeStr + '</span>' +
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
    row.addEventListener('click', function(ev) {
      // Click resets the Shift+Arrow extend anchors; ctrl-click toggles
      // individual rows; shift-click selects the range from the last
      // single-selected row to here.
      if (typeof shiftSelectAnchor !== 'undefined') shiftSelectAnchor = -1;
      if (typeof shiftSelectAnchorRow !== 'undefined') shiftSelectAnchorRow = null;
      var allRows = Array.prototype.slice.call(content.querySelectorAll('.dir-entry[data-hdd-part]'));
      if (ev.ctrlKey) {
        row.classList.toggle('selected');
      } else if (ev.shiftKey) {
        var firstSel = content.querySelector('.dir-entry.selected[data-hdd-part]');
        if (firstSel && firstSel !== row) {
          var startIdx = allRows.indexOf(firstSel);
          var endIdx = allRows.indexOf(row);
          if (startIdx > endIdx) { var t = startIdx; startIdx = endIdx; endIdx = t; }
          allRows.forEach(function(r) { r.classList.remove('selected'); });
          for (var si = startIdx; si <= endIdx; si++) allRows[si].classList.add('selected');
        } else {
          content.querySelectorAll('.dir-entry.selected').forEach(function(el) { el.classList.remove('selected'); });
          row.classList.add('selected');
        }
      } else {
        content.querySelectorAll('.dir-entry.selected').forEach(function(el) { el.classList.remove('selected'); });
        row.classList.add('selected');
      }
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

// ── Enter a CFS partition ─────────────────────────────────────────────
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
  cfsEnteredAs = null; // partition root → header uses self-ref/partition name
  // CFS descriptor for renderer / menu state; currentBuffer stays the
  // whole .hdd (partitions are edited in place, not sliced out).
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
  cfsEnteredAs = null;
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
  cfsDirStack.push({ dirLba: cfsDirLba, name: _cfsCurrentDirDisplayName(), enteredAs: cfsEnteredAs });
  cfsEnteredAs = entry.name; // PUA-PETSCII string from readCfsDirectorySector
  cfsDirLba = entry.dataTreePtr.addr;
  cfsDirEntries = null;
  selectedEntryIndex = -1;
  selectedEntries = [];
  refreshIde64View();
}

// Pop one level off the breadcrumb. Called from the "↑ up to ..." row.
function leaveCfsSubdir() {
  if (cfsDirStack.length === 0) return;
  var parent = cfsDirStack.pop();
  cfsDirLba = parent.dirLba;
  cfsEnteredAs = parent.enteredAs != null ? parent.enteredAs : null;
  cfsDirEntries = null;
  selectedEntryIndex = -1;
  selectedEntries = [];
  refreshIde64View();
}

// Display name for the currently-viewed directory. Reads the dir's
// own slot-0 self-reference first — verified against IDEDOS on real
// hardware: with a drifted dir (parent says CREATURES2, self-ref says
// C2), IDEDOS prints the self-ref name when listing the dir's contents
// via LOAD"$",8. We mirror that so what we show matches what a real
// C64 would. Falls back to the parent's outgoing-entry name (cached as
// cfsEnteredAs on enter) if a self-ref is absent, then partition name.
// Rename already syncs both names, so new renames don't introduce drift.
function _cfsCurrentDirDisplayName() {
  return _cfsDirDisplayName(cfsDirEntries, cfsEnteredAs);
}

// Same rule for any dir: its entries (self-ref first) and the parent's name for it.
function _cfsDirDisplayName(entries, enteredAs) {
  if (entries && entries.length > 0 && entries[0].isSelfRef && entries[0].name) {
    return entries[0].name;
  }
  if (enteredAs) return enteredAs;
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
  // Import is now reachable through File → Import File (same as
  // CBM-DOS), so no inline "+ Import file" row in the listing.

  var fileCount = 0;
  var blocksUsed = 0;
  var disk = new Uint8Array(hddBuffer);
  for (var i = 0; i < cfsDirEntries.length; i++) {
    var e = cfsDirEntries[i];
    if (e.empty) continue;
    if (e.isSelfRef) continue; // entry 0 of first sector = directory's own name, hide it
    // DEL filter: scratched entries (DEL + Closed cleared) follow the
    // Show Deleted toggle. Separators (DEL + Closed set — same pattern
    // CBM-DOS uses) always render, since they're intentional content
    // the user placed via Insert Separator.
    if (e.ftype === CFS_FTYPE.DEL && !e.closed && !showDeleted) continue;

    var absIdx = i; // unique across all chained sectors
    // "*" = not Closed (except DEL), "<" = not W; always 5 chars wide.
    var baseType = e.typeSuffix || _cfsFtypeLabel(e.ftype);
    var splatPrefix = (!e.closed && e.ftype !== CFS_FTYPE.DEL) ? '*' : ' ';
    var lockedSuffix = !(e.attrByte & 0x10) ? '<' : ' ';
    var typeStr = splatPrefix + baseType + lockedSuffix;
    // No size for dirs / links, scratched ones included (suffix survives).
    var isDirLike = (e.typeSuffix === 'DIR' || e.typeSuffix === 'LNK' ||
                     e.ftype === CFS_FTYPE.DIR || e.ftype === CFS_FTYPE.LNK);
    var sizeStr;
    if (isDirLike) {
      sizeStr = '';
    } else {
      // 256-byte blocks, as IDEDOS's LOAD"$" shows them.
      var entryBlocks = Math.ceil(e.size / 256);
      sizeStr = entryBlocks.toString();
      if (e.ftype !== CFS_FTYPE.DEL) blocksUsed += entryBlocks;
    }
    var mtimeStr = formatCfsTimestamp(e.mtime);
    var attrs = '';
    if (e.closed) attrs += 'C';
    if (e.attrByte & 0x40) attrs += 'D';
    if (e.attrByte & 0x20) attrs += 'R';
    if (e.attrByte & 0x10) attrs += 'W';
    if (e.attrByte & 0x08) attrs += 'X';

    // Only scratched entries (DEL + Closed cleared) get the dim style.
    // Separators (DEL + Closed) are intentional and render normally.
    var deletedCls = (e.ftype === CFS_FTYPE.DEL && !e.closed) ? ' deleted' : '';
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
    var entryByteOff = e.dirLba * IDE64_SECTOR_SIZE + e.index * CFS_DIR_ENTRY_SIZE;
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
      '<div class="dir-entry' + deletedCls + '" data-cfs-entry="' + absIdx + '" draggable="true" title="' + escHtml(rowTitle) + '">' +
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
  // Footer matches the IDE64 BASIC "LOAD\"$\",8" convention: the sum of
  // per-file block counts visible in the listing (NOT the bitmap-wide
  // allocation — that includes dir/bitmap overhead). File count comes
  // along in brackets so the user still sees the directory size.
  html += '</div>' +
    '<div class="dir-footer"><div class="dir-footer-row">' +
      '<span class="dir-footer-blocks">' + blocksUsed + '</span>' +
      '<span class="dir-footer-label">blocks used (' + fileCount + ' file' + (fileCount === 1 ? '' : 's') + ').</span>' +
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

  // File rows: click / Ctrl / Shift selection as in ui-render.js;
  // selectedEntries holds absolute indices into cfsDirEntries.
  content.querySelectorAll('.dir-entry[data-cfs-entry]').forEach(function(row) {
    var idx = parseInt(row.dataset.cfsEntry, 10);
    var entry = cfsDirEntries[idx];
    row.addEventListener('click', function(ev) {
      // Click resets the Shift+Arrow extend-selection anchor — next
      // Shift+Arrow should anchor at whatever we're clicking now.
      if (typeof shiftSelectAnchor !== 'undefined') shiftSelectAnchor = -1;
      var allRows = Array.prototype.slice.call(content.querySelectorAll('.dir-entry[data-cfs-entry]'));
      if (ev.ctrlKey) {
        if (row.classList.contains('selected')) {
          row.classList.remove('selected');
          selectedEntries = selectedEntries.filter(function(o) { return o !== idx; });
          selectedEntryIndex = selectedEntries.length > 0 ? selectedEntries[selectedEntries.length - 1] : -1;
        } else {
          row.classList.add('selected');
          selectedEntries.push(idx);
          selectedEntryIndex = idx;
        }
      } else if (ev.shiftKey && selectedEntryIndex >= 0) {
        var allIdx = allRows.map(function(r) { return parseInt(r.dataset.cfsEntry, 10); });
        var startIdx = allIdx.indexOf(selectedEntryIndex);
        var endIdx = allIdx.indexOf(idx);
        if (startIdx < 0 || endIdx < 0) {
          allRows.forEach(function(r) { r.classList.remove('selected'); });
          row.classList.add('selected');
          selectedEntryIndex = idx;
          selectedEntries = [idx];
        } else {
          if (startIdx > endIdx) { var tmp = startIdx; startIdx = endIdx; endIdx = tmp; }
          allRows.forEach(function(r) { r.classList.remove('selected'); });
          selectedEntries = [];
          for (var si = startIdx; si <= endIdx; si++) {
            allRows[si].classList.add('selected');
            selectedEntries.push(allIdx[si]);
          }
          selectedEntryIndex = idx;
        }
      } else {
        allRows.forEach(function(r) { r.classList.remove('selected'); });
        row.classList.add('selected');
        selectedEntryIndex = idx;
        selectedEntries = [idx];
      }
      updateEntryMenuState();
    });
    // Drag-to-reorder. The global dragstart still wires DownloadURL for
    // OS export; these handlers add the internal reorder path.
    row.addEventListener('dragstart', function(ev) {
      _dragSrcCfsIdx = idx;
      row.classList.add('dragging');
      ev.dataTransfer.effectAllowed = 'copyMove';
      var ghost = row.cloneNode(true);
      ghost.classList.add('drag-ghost');
      ghost.classList.remove('selected', 'dragging');
      ghost.style.width = row.offsetWidth + 'px';
      document.body.appendChild(ghost);
      ev.dataTransfer.setDragImage(ghost, 20, ghost.offsetHeight / 2);
      setTimeout(function() { ghost.remove(); }, 0);
    });
    row.addEventListener('dragend', function() {
      row.classList.remove('dragging');
      content.querySelectorAll('.dir-entry').forEach(function(r) {
        r.classList.remove('drag-over-top', 'drag-over-bottom');
      });
      _dragSrcCfsIdx = null;
    });
    row.addEventListener('dragover', function(ev) {
      if (_dragSrcCfsIdx === null || _dragSrcCfsIdx === undefined) return;
      ev.preventDefault();
      ev.dataTransfer.dropEffect = 'move';
      content.querySelectorAll('.dir-entry').forEach(function(r) {
        r.classList.remove('drag-over-top', 'drag-over-bottom');
      });
      var rect = row.getBoundingClientRect();
      var midY = rect.top + rect.height / 2;
      if (ev.clientY < midY) row.classList.add('drag-over-top');
      else row.classList.add('drag-over-bottom');
    });
    row.addEventListener('dragleave', function() {
      row.classList.remove('drag-over-top', 'drag-over-bottom');
    });
    row.addEventListener('drop', function(ev) {
      ev.preventDefault();
      content.querySelectorAll('.dir-entry').forEach(function(r) {
        r.classList.remove('drag-over-top', 'drag-over-bottom');
      });
      var src = _dragSrcCfsIdx;
      _dragSrcCfsIdx = null;
      if (src === null || src === undefined) return;
      var target = idx;
      if (src === target) return;
      // System entries (self-ref / deldir-ref) can't move or be moved past.
      var srcEnt = cfsDirEntries[src];
      var tgtEnt = cfsDirEntries[target];
      if (!srcEnt || !tgtEnt) return;
      if (srcEnt.isSelfRef || (typeof _cfsEntryIsDeldirRef === 'function' && _cfsEntryIsDeldirRef(srcEnt))) return;
      if (tgtEnt.isSelfRef || (typeof _cfsEntryIsDeldirRef === 'function' && _cfsEntryIsDeldirRef(tgtEnt))) return;
      // Top-half drop → above, bottom-half → below. Adjacent rows
      // swap directly (skipping the adjustment).
      var rect = row.getBoundingClientRect();
      var midY = rect.top + rect.height / 2;
      if (Math.abs(target - src) !== 1) {
        if (ev.clientY >= midY && target < src) target++;
        else if (ev.clientY < midY && target > src) target--;
      }
      if (src === target) return;
      if (typeof pushUndo === 'function') pushUndo();
      var dir = target > src ? 1 : -1;
      var cur = src;
      while (cur !== target) {
        var a = cfsDirEntries[cur];
        var b = cfsDirEntries[cur + dir];
        if (!a || !b) break;
        cfsSwapDirSlots(hddBuffer, { dirLba: a.dirLba, slotIndex: a.index }, { dirLba: b.dirLba, slotIndex: b.index });
        cur += dir;
      }
      selectedEntries = [target];
      selectedEntryIndex = target;
      refreshIde64View();
    });
    row.addEventListener('dblclick', function(ev) {
      // Dblclick UX mirrors CBM-DOS (ui-render.js): column-aware on file
      // rows, navigation on partitions/dirs. Blocks column → inline
      // block-size edit. Type column → type dropdown (DEL/SEQ/PRG/USR/REL).
      // DIR entries → enter the directory regardless of where the click
      // landed (same as a CBM partition row). LNK entries → follow the
      // link. DEL → not actionable. Anything else on a regular file →
      // inline rename (matches CBM-DOS's dblclick-on-name default).
      if (ev.target && ev.target.classList && ev.target.classList.contains('dir-blocks')) {
        startInlineEditCfsBlockSize(row);
        return;
      }
      if (ev.target && ev.target.classList && ev.target.classList.contains('dir-type')) {
        // Type column dropdown — only for NORMAL/REL/DEL entries.
        // DIR/LNK and the self-ref / deldir-ref are off-limits.
        if (entry.ftype !== CFS_FTYPE.DIR && entry.ftype !== CFS_FTYPE.LNK &&
            !entry.isSelfRef &&
            !(typeof _cfsEntryIsDeldirRef === 'function' && _cfsEntryIsDeldirRef(entry))) {
          showCfsTypeDropdown(ev.target, entry);
          return;
        }
      }
      if (entry.ftype === CFS_FTYPE.DIR) {
        enterCfsSubdir(entry);
        return;
      }
      if (entry.ftype === CFS_FTYPE.LNK) {
        followCfsLink(entry);
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

  // Restore selection that survived the re-render (e.g. after Move
  // Up/Down so the user can chain Ctrl+Arrow presses). Defaults to
  // cleared if no prior selection or the slot indices no longer exist.
  var restoreSel = selectedEntries.slice();
  var restorePrimary = selectedEntryIndex;
  selectedEntryIndex = -1;
  selectedEntries = [];
  if (restoreSel.length > 0) {
    var restoreRows = Array.prototype.slice.call(content.querySelectorAll('.dir-entry[data-cfs-entry]'));
    var byIdx = {};
    restoreRows.forEach(function(r) { byIdx[parseInt(r.dataset.cfsEntry, 10)] = r; });
    for (var rsi = 0; rsi < restoreSel.length; rsi++) {
      var rr = byIdx[restoreSel[rsi]];
      if (rr) {
        rr.classList.add('selected');
        selectedEntries.push(restoreSel[rsi]);
      }
    }
    if (selectedEntries.indexOf(restorePrimary) >= 0) selectedEntryIndex = restorePrimary;
    else if (selectedEntries.length > 0) selectedEntryIndex = selectedEntries[selectedEntries.length - 1];
    var primaryRow = byIdx[selectedEntryIndex];
    if (primaryRow) primaryRow.scrollIntoView({ block: 'nearest' });
  }
  if (selectedEntries.length === 0) selectedEntryIndex = -1;
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

// Follow a CFS symbolic link like a shortcut: a link to a directory
// enters it, a link to a file opens the directory holding it with the
// file selected. The link's content is its target path: "/" starts at
// the partition root, anything else at the directory the link lives in
// (so a chain of links resolves each step from its own directory).
// The breadcrumb is rebuilt along the target's real path.
function followCfsLink(entry) {
  if (!entry || !entry.dataTreePtr || !entry.dataTreePtr.lba) {
    showModal('CFS link', ['"' + petsciiToReadable(entry.name) + '" has no target pointer.']);
    return;
  }
  if (!hddPartitions || cfsPartitionIdx < 0) return;
  var partition = hddPartitions[cfsPartitionIdx];
  if (!partition || !partition.cfsRootDir || !partition.cfsRootDir.lba) return;

  // A location is the chain of dirs from the root: [{ dirLba, enteredAs }].
  var rootFrame = { dirLba: partition.cfsRootDir.addr, enteredAs: null };
  var loc = cfsDirStack.map(function(f) { return { dirLba: f.dirLba, enteredAs: f.enteredAs }; })
    .concat([{ dirLba: cfsDirLba, enteredAs: cfsEnteredAs }]);

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
    var base = target.charAt(0) === '/' ? [rootFrame] : loc;
    var trail = [];
    current = cfsResolvePath(hddBuffer, base[base.length - 1].dirLba, target, trail);
    if (!current) {
      showModal('CFS link', [
        '"' + petsciiToReadable(entry.name) + '" → ' + target,
        'Target not found in this partition.',
      ]);
      return;
    }
    loc = base.concat(trail.map(function(d) { return { dirLba: d.dataTreePtr.addr, enteredAs: d.name }; }));
  }
  if (!current) return;

  if (current.ftype === CFS_FTYPE.DEL) {
    showModal('CFS link', ['"' + petsciiToReadable(entry.name) + '" resolves to a deleted entry.']);
  } else if (current.ftype === CFS_FTYPE.DIR) {
    if (!current.dataTreePtr || !current.dataTreePtr.lba) {
      showModal('CFS subdirectory', ['"' + petsciiToReadable(current.name) + '" has no valid directory sector pointer.']);
      return;
    }
    _cfsGoToLocation(loc.concat([{ dirLba: current.dataTreePtr.addr, enteredAs: current.name }]), null);
  } else {
    _cfsGoToLocation(loc, current);
  }
}

// Show the last dir of loc with the breadcrumb set to the dirs before it,
// selecting selectEntry (an entry of that dir) when given.
function _cfsGoToLocation(loc, selectEntry) {
  cfsDirStack = loc.slice(0, -1).map(function(f) {
    return { dirLba: f.dirLba, enteredAs: f.enteredAs,
             name: _cfsDirDisplayName(readCfsDirectory(hddBuffer, f.dirLba), f.enteredAs) };
  });
  var here = loc[loc.length - 1];
  cfsDirLba = here.dirLba;
  cfsEnteredAs = here.enteredAs;
  cfsDirEntries = null;
  selectedEntryIndex = -1;
  selectedEntries = [];
  if (selectEntry) {
    // The render keeps a selection by row index and scrolls it into view.
    var list = readCfsDirectory(hddBuffer, here.dirLba) || [];
    for (var i = 0; i < list.length; i++) {
      if (list[i].dirLba === selectEntry.dirLba && list[i].index === selectEntry.index) {
        selectedEntries = [i];
        selectedEntryIndex = i;
        break;
      }
    }
  }
  refreshIde64View();
  if (typeof updateEntryMenuState === 'function') updateEntryMenuState();
}


// Move selected CFS entries up (-1) or down (+1) by one slot each.
// Multi-select keeps relative order; system entries (self-ref + deldir-
// ref) stay pinned; selection follows the moved rows.
function moveCfsEntries(direction) {
  if (cfsPartitionIdx < 0 || !cfsDirEntries) return;
  if (selectedEntryIndex < 0) return;
  var picked = selectedEntries.length > 1 ? selectedEntries.slice() : [selectedEntryIndex];
  // Drop any protected slots (self-ref + deldir-ref) — they can't move.
  var indices = [];
  for (var i = 0; i < picked.length; i++) {
    var ent = cfsDirEntries[picked[i]];
    if (!ent || ent.empty) continue;
    if (ent.isSelfRef) continue;
    if (_cfsEntryIsDeldirRef && _cfsEntryIsDeldirRef(ent)) continue;
    indices.push(picked[i]);
  }
  if (indices.length === 0) return;
  indices.sort(function(a, b) { return a - b; });

  // First user slot + last non-empty slot bound the move.
  var firstUserSlot = 0;
  for (var fu = 0; fu < cfsDirEntries.length; fu++) {
    var fuEnt = cfsDirEntries[fu];
    if (!fuEnt) continue;
    if (fuEnt.isSelfRef) continue;
    if (_cfsEntryIsDeldirRef && _cfsEntryIsDeldirRef(fuEnt)) continue;
    firstUserSlot = fu;
    break;
  }
  var lastUsed = -1;
  for (var lu = cfsDirEntries.length - 1; lu >= 0; lu--) {
    var luEnt = cfsDirEntries[lu];
    if (luEnt && !luEnt.empty) { lastUsed = lu; break; }
  }
  if (lastUsed < 0) return;

  if (direction < 0 && indices[0] <= firstUserSlot) return;
  if (direction > 0 && indices[indices.length - 1] >= lastUsed) return;

  if (typeof pushUndo === 'function') pushUndo();

  // Top-down for up, bottom-up for down — keeps adjacent swaps in the
  // same selection from clobbering each other.
  if (direction < 0) {
    for (var u = 0; u < indices.length; u++) {
      var srcU = cfsDirEntries[indices[u]];
      var dstU = cfsDirEntries[indices[u] - 1];
      if (!srcU || !dstU) continue;
      cfsSwapDirSlots(hddBuffer, { dirLba: srcU.dirLba, slotIndex: srcU.index }, { dirLba: dstU.dirLba, slotIndex: dstU.index });
      indices[u]--;
    }
  } else {
    for (var d = indices.length - 1; d >= 0; d--) {
      var srcD = cfsDirEntries[indices[d]];
      var dstD = cfsDirEntries[indices[d] + 1];
      if (!srcD || !dstD) continue;
      cfsSwapDirSlots(hddBuffer, { dirLba: srcD.dirLba, slotIndex: srcD.index }, { dirLba: dstD.dirLba, slotIndex: dstD.index });
      indices[d]++;
    }
  }

  // Selection follows the moved rows.
  selectedEntries = indices.slice();
  selectedEntryIndex = selectedEntries[0];
  refreshIde64View();
}

// Build the { data, name, isPrg, error } shape the shared viewers
// accept so they can drive a CFS entry without going through readFileData.
function cfsLoadFileForViewer(entry) {
  if (!entry || !entry.dataTreePtr || !entry.dataTreePtr.lba) return null;
  var res = readCfsFileData(hddBuffer, entry.dataTreePtr.addr, entry.size);
  var name = petsciiToReadable(entry.name).trim();
  var isPrg = (entry.ftype === CFS_FTYPE.NORMAL) && (entry.typeSuffix === 'PRG');
  return { data: res.data, name: name, isPrg: isPrg, error: res.error };
}

// OS file name → 16-char CFS name for cfsImportFile: asciiToNameBytes as
// on a D64, with "/" (the CFS path separator) turned into a space.
// Prompts when the base name is over 16 chars; null on cancel.
async function _cfsImportNameBytesPrompted(rawName) {
  var dotIdx = rawName.lastIndexOf('.');
  var base = dotIdx >= 0 ? rawName.substring(0, dotIdx) : rawName;
  if (base.length > 16 && typeof promptShortenImportName === 'function') {
    var chosen = await promptShortenImportName(base, rawName);
    if (chosen == null) return null;
    base = chosen;
  }
  var bytes = asciiToNameBytes(base);
  for (var i = 0; i < bytes.length; i++) {
    if (bytes[i] === 0x2F) bytes[i] = 0x20;
  }
  return String.fromCharCode.apply(null, bytes);
}

// Trimmed name (max 16), or null after telling the user. "/" is refused:
// it's the CFS path separator.
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

// Inline PETSCII rename of a CFS entry (the row's data-cfs-entry indexes
// cfsDirEntries).
function startInlineRenameCfsEntry(entryEl) {
  if (!hddBuffer || !entryEl || !cfsDirEntries) return;
  var absIdx = parseInt(entryEl.dataset.cfsEntry, 10);
  if (isNaN(absIdx)) return;
  var entry = cfsDirEntries[absIdx];
  if (!entry || entry.empty) return;
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
  var entryOff = entry.dirLba * IDE64_SECTOR_SIZE + entry.index * CFS_DIR_ENTRY_SIZE;
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
    // CFS names pad with either $00 or $A0 depending on producer (cfsfdisk
    // vs IDEDOS firmware vs our own writers). Treat the two as equivalent
    // pad bytes so a roundtrip with no visible change doesn't mark dirty.
    var differs = false;
    for (var di = 0; di < 16; di++) {
      var a = newBytes[di], b = disk[entryOff + di];
      if (a === b) continue;
      var aIsPad = (a === 0x00 || a === 0xA0);
      var bIsPad = (b === 0x00 || b === 0xA0);
      if (aIsPad && bIsPad) continue;
      differs = true;
      break;
    }
    if (differs) {
      pushUndo();
      var data = new Uint8Array(hddBuffer);
      for (var wi = 0; wi < 16; wi++) data[entryOff + wi] = newBytes[wi];
      cfsTouchEntryMtime(hddBuffer, entry.dirLba, entry.index);
      // A DIR's self-ref is what IDEDOS shows as its header; keep it in sync.
      if (entry.ftype === CFS_FTYPE.DIR && entry.dataTreePtr && entry.dataTreePtr.lba) {
        var childBase = entry.dataTreePtr.addr * IDE64_SECTOR_SIZE;
        for (var sri = 0; sri < 16; sri++) data[childBase + sri] = newBytes[sri];
      }
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
    if (typeof suppressActiveEditCommit !== 'undefined' && suppressActiveEditCommit) return;
    commit();
  });
  editor.addEventListener('keydown', function(ev) {
    if (ev.key === 'Enter') { ev.preventDefault(); ev.stopPropagation(); commit(); }
    else if (ev.key === 'Escape') { ev.preventDefault(); ev.stopPropagation(); revert(); }
  });
  if (typeof registerActiveEdit === 'function') registerActiveEdit(nameSpan, revert);
}

// Type dropdown for a CFS dir entry. Mirrors the CBM-DOS
// showTypeDropdown UX — dblclick the type column, pick a type, commit.
// CFS types offered: DEL / SEQ / PRG / USR / REL (no CBM — CBM partition
// files aren't a CFS concept; no DIR/LNK — switching to those would
// orphan or misinterpret data). Caller is responsible for refusing
// DIR/LNK source entries.
function showCfsTypeDropdown(typeSpan, entry) {
  if (!hddBuffer || !entry) return;
  if (typeof cancelActiveEdits === 'function') cancelActiveEdits();
  var existing = document.querySelector('.type-dropdown');
  if (existing) existing.remove();

  // Map current entry → CBM type idx for the check mark.
  var currentIdx = -1;
  if (entry.ftype === CFS_FTYPE.NORMAL) {
    if (entry.typeSuffix === 'SEQ') currentIdx = 1;
    else if (entry.typeSuffix === 'PRG') currentIdx = 2;
    else if (entry.typeSuffix === 'USR') currentIdx = 3;
  } else if (entry.ftype === CFS_FTYPE.REL) currentIdx = 4;
  else if (entry.ftype === CFS_FTYPE.DEL) currentIdx = 0;

  var dropdown = document.createElement('div');
  dropdown.className = 'type-dropdown';
  var labels = ['DEL', 'SEQ', 'PRG', 'USR', 'REL'];
  labels.forEach(function(label, idx) {
    var opt = document.createElement('div');
    opt.className = 'type-option';
    var check = document.createElement('span');
    check.className = 'check';
    check.innerHTML = (idx === currentIdx) ? '<i class="fa-solid fa-check"></i>' : '';
    opt.appendChild(check);
    opt.appendChild(document.createTextNode(label));
    opt.addEventListener('click', function(e) {
      e.stopPropagation();
      dropdown.remove();
      if (idx === currentIdx) return;
      if (typeof pushUndo === 'function') pushUndo();
      cfsChangeFileType(hddBuffer, entry.dirLba, entry.index, idx);
      refreshIde64View();
    });
    dropdown.appendChild(opt);
  });
  document.body.appendChild(dropdown);

  // Position above the type span; fall back below if no room.
  var rect = typeSpan.getBoundingClientRect();
  dropdown.style.left = rect.left + 'px';
  var dropH = dropdown.offsetHeight;
  if (rect.top - dropH > 0) dropdown.style.top = (rect.top - dropH) + 'px';
  else dropdown.style.top = rect.bottom + 'px';

  function closeDropdown(e) {
    if (!dropdown.contains(e.target)) {
      dropdown.remove();
      document.removeEventListener('click', closeDropdown);
    }
  }
  setTimeout(function() { document.addEventListener('click', closeDropdown); }, 0);
}

// Inline block-count edit (as CBM-DOS's startEditBlockSize). The entry
// stores bytes, so the new size is blocks × 256. Not for DIR / LNK / DEL.
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

  // 256-byte blocks, as IDEDOS lists them (no T/S link bytes).
  var currentBlocks = Math.ceil(entry.size / 256);
  var input = document.createElement('input');
  input.type = 'number';
  input.min = '0';
  input.max = String(MAX_BLOCKS);
  input.value = String(currentBlocks);
  input.className = 'blocks-input';

  blocksSpan.textContent = '';
  blocksSpan.appendChild(input);
  blocksSpan.classList.add('editing');
  input.focus();
  input.select();

  // `finished` stops the blur fired by the re-render from committing twice.
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
    if (!isFinite(parsed) || parsed < 0) { revert(); return; }
    // Typed values ignore input.max; VICE's listing tops out at MAX_BLOCKS.
    if (parsed > MAX_BLOCKS) parsed = MAX_BLOCKS;
    finished = true;
    cleanup();
    if (parsed !== currentBlocks) {
      pushUndo();
      cfsWriteFileSize(hddBuffer, entry.dirLba, entry.index, parsed * 256, entry.ftype);
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
  var entryOff = _cfsPartEntryOffset(disk, slotIdx);
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
    // CFS names pad with either $00 or $A0 depending on producer (cfsfdisk
    // vs IDEDOS firmware vs our own writers). Treat the two as equivalent
    // pad bytes so a roundtrip with no visible change doesn't mark dirty.
    var differs = false;
    for (var di = 0; di < 16; di++) {
      var a = newBytes[di], b = disk[entryOff + di];
      if (a === b) continue;
      var aIsPad = (a === 0x00 || a === 0xA0);
      var bIsPad = (b === 0x00 || b === 0xA0);
      if (aIsPad && bIsPad) continue;
      differs = true;
      break;
    }
    if (differs) {
      pushUndo();
      var res = cfsRenamePartition(hddBuffer, slotIdx, String.fromCharCode.apply(null, newBytes));
      if (!res.ok) {
        _hddDiscardEdit();
        showModal('Rename Partition', [res.error || 'Could not write the new name.']);
      }
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
    if (typeof suppressActiveEditCommit !== 'undefined' && suppressActiveEditCommit) return;
    commit();
  });
  editor.addEventListener('keydown', function(ev) {
    if (ev.key === 'Enter') { ev.preventDefault(); ev.stopPropagation(); commit(); }
    else if (ev.key === 'Escape') { ev.preventDefault(); ev.stopPropagation(); revert(); }
  });
  if (typeof registerActiveEdit === 'function') registerActiveEdit(nameSpan, revert);
}

// Live partition whose LBA range overlaps [startLba, endLba], or null.
function _hddFindLiveOverlap(partitions, startLba, endLba) {
  for (var i = 0; i < partitions.length; i++) {
    var p = partitions[i];
    if (!p || p.empty || p.deleted || p.startLba == null || p.endLba == null) continue;
    if (p.endLba >= startLba && p.startLba <= endLba) return p;
  }
  return null;
}

// ── New CFS partition dialog (idx -1; rename is inline) ───────────────
// Soft-deleted partitions' ranges are free for reuse: commit() wipes any
// deleted slot the new range overlaps. Live ranges are refused.
function showHddPartitionEditor(idx) {
  if (!hddBuffer || !hddPartitions) return;
  if (idx != null && idx >= 0) return;
  var totalLbas = hddBuffer.byteLength / IDE64_SECTOR_SIZE;

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
  var maxMib = Math.max(1, Math.floor(maxLbas * IDE64_SECTOR_SIZE / (1024 * 1024)));
  var defaultMib = Math.min(maxMib, 4);

  // Empty and soft-deleted slots are both reusable.
  var reusable = function(pp) { return pp.empty || pp.deleted; };
  var firstReusable = hddPartitions.findIndex(reusable);
  var slotOpts = '';
  for (var si = 0; si < hddPartitions.length; si++) {
    if (!reusable(hddPartitions[si])) continue;
    slotOpts += '<option value="' + si + '"' + (si === firstReusable ? ' selected' : '') + '>Slot ' + si + '</option>';
  }

  var titleEl = document.getElementById('modal-title');
  var body = document.getElementById('modal-body');
  var footer = document.querySelector('#modal-overlay .modal-footer');
  titleEl.textContent = 'New CFS partition';

  // Name is uppercased: $61-$7A would show as PETSCII graphics.
  body.innerHTML =
    '<table style="width:100%;border-collapse:collapse">' +
      '<tr>' +
        '<th style="text-align:left;padding:6px 12px 6px 0;vertical-align:middle;width:80px;font-weight:normal;opacity:0.7">Slot</th>' +
        '<td style="padding:6px 0"><select id="hdd-pe-slot" class="modal-input">' + slotOpts + '</select></td>' +
      '</tr>' +
      '<tr>' +
        '<th style="text-align:left;padding:6px 12px 6px 0;vertical-align:middle;width:80px;font-weight:normal;opacity:0.7">Name</th>' +
        '<td style="padding:6px 0"><input type="text" id="hdd-pe-name" class="modal-input" maxlength="16" value="PARTITION" style="text-transform:uppercase" /></td>' +
      '</tr>' +
      '<tr>' +
        '<th style="text-align:left;padding:6px 12px 6px 0;vertical-align:middle;width:80px;font-weight:normal;opacity:0.7">Start LBA</th>' +
        '<td style="padding:6px 0"><input type="number" id="hdd-pe-start" class="modal-input" min="2" max="' + (totalLbas - 8) + '" value="' + defaultStart + '" /></td>' +
      '</tr>' +
      '<tr>' +
        '<th style="text-align:left;padding:6px 12px 6px 0;vertical-align:middle;width:80px;font-weight:normal;opacity:0.7">Size (MiB)</th>' +
        '<td style="padding:6px 0"><input type="number" id="hdd-pe-size" class="modal-input" min="1" max="' + maxMib + '" value="' + defaultMib + '" /></td>' +
      '</tr>' +
    '</table>';

  footer.innerHTML =
    '<button id="hdd-pe-cancel" class="modal-btn-secondary">Cancel</button> ' +
    '<button id="hdd-pe-ok">Create</button>';

  function commit() {
    var raw = (document.getElementById('hdd-pe-name').value || '').toUpperCase();
    var partitionName = _sanitiseCfsName(raw, 'New partition');
    if (partitionName == null) return;
    var slot = parseInt(document.getElementById('hdd-pe-slot').value, 10);
    var startLba = parseInt(document.getElementById('hdd-pe-start').value, 10);
    var mib = parseInt(document.getElementById('hdd-pe-size').value, 10);
    if (!startLba || startLba < 2 || !mib || mib < 1) return;
    if (startLba >= totalLbas) {
      showModal('New partition', ['Start LBA is past the end of the image.']);
      return;
    }
    var endLba = Math.min(totalLbas - 1, startLba + Math.floor(mib * 1024 * 1024 / IDE64_SECTOR_SIZE) - 1);
    var clash = _hddFindLiveOverlap(hddPartitions, startLba, endLba);
    if (clash) {
      showModal('New partition', [
        'LBA $' + startLba.toString(16).toUpperCase() + '..$' + endLba.toString(16).toUpperCase() +
          ' overlaps partition "' + (petsciiToReadable(clash.name) || ('slot ' + clash.index)) + '" ($' +
          clash.startLba.toString(16).toUpperCase() + '..$' + clash.endLba.toString(16).toUpperCase() + ').',
        'Pick a start LBA and size outside it.',
      ]);
      return;
    }
    pushUndo();
    // Deleted partitions in the new range can't be restored any more.
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
      _hddDiscardEdit();
      showModal('New partition failed', [init.error || 'Could not initialise partition storage.']);
      return;
    }
    var add = cfsAddPartitionToTable(hddBuffer, slot, partitionName, startLba, endLba, init.rootDirLba, init.deletedDirLba, 0x01);
    if (!add.ok) {
      _hddDiscardEdit();
      showModal('New partition failed', [add.error || 'Could not write the partition entry.']);
      return;
    }
    // The only live partition becomes the default.
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
  footer.innerHTML = '<button class="modal-btn-secondary" id="hdd-attr-cancel">Cancel</button> <button id="hdd-attr-ok">OK</button>';
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
        _hddDiscardEdit();
        return;
      }
    }
    if (defaultChanged) {
      // Toggling off the default partition reverts to slot 0 — there's
      // always exactly one default in the boot sector.
      var dres = cfsSetDefaultPartition(hddBuffer, newDefault ? idx : 0);
      if (!dres.ok) {
        showModal('Partition Attributes failed', [dres.error || 'Unknown error.']);
        _hddDiscardEdit();
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

// Confirm + soft-delete one or more partitions (same dialog as DHD/FD/RAMLink).
async function confirmHddPartitionDelete(idxOrIndices) {
  if (!hddBuffer || !hddPartitions) return;
  var indices = Array.isArray(idxOrIndices) ? idxOrIndices.slice() : [idxOrIndices];
  var targets = [];
  for (var ii = 0; ii < indices.length; ii++) {
    var pi = indices[ii];
    var p0 = hddPartitions[pi];
    if (!p0 || p0.empty || p0.deleted) continue;
    targets.push(pi);
  }
  if (targets.length === 0) return;

  var prompt;
  if (targets.length === 1) {
    var p = hddPartitions[targets[0]];
    var sizeBlocks = p.sizeSectors !== null ? (p.sizeSectors * 2) : null;
    var sizeStr = p.sizeSectors !== null
      ? (partitionSizeInMib ? formatPartitionSize(p.sizeBytes, sizeBlocks) : sizeBlocks + ' blocks')
      : '? blocks';
    var nameForModal = petsciiToReadable(p.name || '') || ('slot ' + targets[0]);
    prompt = 'Delete partition "' + nameForModal + '" (' + p.typeName + ', ' + sizeStr + ')?\nIt will be recoverable via Restore Partition until the slot is reused.';
  } else {
    prompt = 'Delete ' + targets.length + ' partitions?\nThey will be recoverable via Restore Partition until their slots are reused.';
  }
  var choice = await showChoiceModal(
    targets.length === 1 ? 'Delete Partition' : 'Delete Partitions',
    prompt,
    [
      { label: 'Cancel', value: false, secondary: true },
      { label: 'Delete', value: true }
    ]
  );
  if (!choice) return;
  pushUndo();
  var hitErr = null;
  for (var di = 0; di < targets.length; di++) {
    var res = cfsSoftDeletePartition(hddBuffer, targets[di]);
    if (!res.ok) { hitErr = res.error || 'Unknown error.'; break; }
  }
  if (hitErr) {
    showModal('Delete partition failed', [hitErr]);
    _hddDiscardEdit();
    return;
  }
  // A deleted default moves to the first remaining live partition.
  if (hddBootInfo && targets.indexOf(hddBootInfo.defaultPart) >= 0) {
    var newDefault = 0;
    for (var ni = 0; ni < hddPartitions.length; ni++) {
      if (targets.indexOf(ni) < 0 && !hddPartitions[ni].empty && !hddPartitions[ni].deleted) { newDefault = ni; break; }
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

// Restore a soft-deleted partition (its contents were never touched).
async function confirmHddPartitionRestore(idx) {
  if (!hddBuffer || !hddPartitions) return;
  var p = hddPartitions[idx];
  if (!p || !p.deleted) return;
  pushUndo();
  var res = cfsRestorePartition(hddBuffer, idx);
  if (!res.ok) {
    showModal('Restore partition failed', [res.error || 'Unknown error.']);
    _hddDiscardEdit();
    return;
  }
  var info = readIde64Partitions(hddBuffer);
  if (info) {
    hddBootInfo = info;
    hddPartitions = info.partitions;
  }
  refreshIde64View();
}

// ── Rename Disk Label (boot $20..$2F, cfsfdisk's "g") ─────────────────
async function showHddRenameDiskDialog() {
  if (!hddBuffer || !hddBootInfo) return;
  var current = hddBootInfo.label || '';
  var entered = await showInputModal('Disk Label', current);
  if (entered === null || entered === undefined) return;
  entered = entered.substring(0, 16).replace(/ +$/, '');
  if (entered === current) return;
  pushUndo();
  var res = cfsSetHddLabel(hddBuffer, entered);
  if (!res.ok) {
    showModal('Rename disk failed', [res.error || 'Unknown error.']);
    _hddDiscardEdit();
    return;
  }
  var info = readIde64Partitions(hddBuffer);
  if (info) {
    hddBootInfo = info;
    hddPartitions = info.partitions;
  }
  refreshIde64View();
}

// ── Restore Partition Table from Backup (cfsfdisk's "u") ──────────────
// Previews the backup table, then copies it over the primary.
async function confirmHddLoadBackupPartitionTable() {
  if (!hddBuffer || !hddBootInfo) return;
  var backupInfo = readIde64BackupPartitions(hddBuffer);
  if (!backupInfo) {
    showModal('Restore from backup failed', ['No backup partition table is referenced from the boot sector, or the backup LBA is out of range.']);
    return;
  }
  var lines = ['This will replace the primary partition table with the backup copy.'];
  var livePart = backupInfo.partitions.filter(function(p) { return !p.empty && !p.deleted; });
  var deletedPart = backupInfo.partitions.filter(function(p) { return !p.empty && p.deleted; });
  if (livePart.length === 0 && deletedPart.length === 0) {
    lines.push('');
    lines.push('Warning: the backup contains no partitions. Restoring it would leave the disk empty.');
  } else {
    lines.push('');
    lines.push('Backup contains ' + livePart.length + ' live partition' + (livePart.length === 1 ? '' : 's') +
      (deletedPart.length ? ' (+ ' + deletedPart.length + ' soft-deleted)' : '') + ':');
    for (var i = 0; i < backupInfo.partitions.length && i < 16; i++) {
      var p = backupInfo.partitions[i];
      if (p.empty) continue;
      var name = petsciiToReadable(p.name || '').trim() || '(unnamed)';
      var flag = p.deleted ? ' [deleted]' : '';
      lines.push('  slot ' + i + ': ' + name + ' <' + (p.typeName || '?') + '>' + flag);
    }
  }
  lines.push('');
  lines.push('Per-partition data (bitmap, directories, files) is not affected — only the 32-byte slot entries in the partition table change.');
  var confirmed = await showConfirmModal('Restore Partition Table from Backup', lines, { okLabel: 'Restore' });
  if (!confirmed) return;
  pushUndo();
  var res = cfsLoadBackupPartitionTable(hddBuffer);
  if (!res.ok) {
    showModal('Restore from backup failed', [res.error || 'Unknown error.']);
    _hddDiscardEdit();
    return;
  }
  var info = readIde64Partitions(hddBuffer);
  if (info) {
    hddBootInfo = info;
    hddPartitions = info.partitions;
  }
  refreshIde64View();
}

// ── CFS new subdirectory (uppercased like DHD's Add Directory) ────────
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
    _hddDiscardEdit();
    return;
  }
  refreshIde64View();
}

// ── CFS import ────────────────────────────────────────────────────────
// File picker → importFilesToCurrentDisk → importFileToCfs per file.
function showCfsImportPicker() {
  if (cfsPartitionIdx < 0 || !hddPartitions) return;
  if (!hddPartitions[cfsPartitionIdx]) return;
  var input = document.createElement('input');
  input.type = 'file';
  input.multiple = true;
  input.accept = '.prg,.seq,.usr,.rel,.p00,.s00,.u00,.r00,.cvt,.txt';
  input.style.display = 'none';
  document.body.appendChild(input);
  input.addEventListener('change', async function() {
    var entries = await readPickedFiles(input.files);
    document.body.removeChild(input);
    importFilesToCurrentDisk(entries);
  });
  input.click();
}

// Writes one file into the current CFS directory. Plain file write — no
// GEOS .cvt handling. batch: part of a multi-file import, so no per-file
// modal or refresh. Returns { ok }, { error } or { skipped }.
async function importFileToCfs(fileName, payload, part, batch) {
  var importCap = 4 * 1024 * 1024;
  if (payload.length > importCap) {
    if (!batch) {
      showModal('Import not supported', [
        '"' + fileName + '" is ' + payload.length + ' bytes.',
        'The UI caps imports at 4 MiB. Larger files would need depth-3+ trees; the format handles them but the partition would have to be huge.',
      ]);
    }
    return { error: 'Over the 4 MiB import cap.' };
  }
  var baseName = await _cfsImportNameBytesPrompted(fileName);
  if (baseName == null) return { skipped: true }; // user cancelled
  // Type suffix from extension (if present and 1-3 chars)
  var ext = (fileName.match(/\.([^.]+)$/) || [])[1] || 'PRG';
  ext = ext.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 3) || 'PRG';

  pushUndo();
  var res = cfsImportFile(hddBuffer, part.startLba, part.endLba, cfsDirLba, baseName, payload, {
    ftype: CFS_FTYPE.NORMAL,
    typeSuffix: ext,
  });
  if (!res.ok) {
    _hddDiscardEdit();
    if (!batch) showModal('Import failed', [res.error || 'Unknown error.']);
    return { error: res.error || 'Unknown error.' };
  }
  if (!batch) refreshIde64View();
  return { ok: true };
}
