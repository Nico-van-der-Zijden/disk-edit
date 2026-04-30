// ── Context menu on directory entries ─────────────────────────────────
var contextMenu = document.getElementById('context-menu');

function closeContextMenu() {
  contextMenu.style.display = 'none';
  contextMenu.innerHTML = '';
}

function showContextMenu(x, y) {
  // Close top menubar if open
  closeMenus();

  // Clone the File menu options into the context menu
  var source = document.querySelector('#menu-entry > .menu-dropdown');
  contextMenu.innerHTML = source.innerHTML;

  // Refresh enable/disable state
  updateEntryMenuState();

  // Replace IDs with data-ctx-for (avoid duplicates) and mirror state from originals
  contextMenu.querySelectorAll('[id]').forEach(function(el) {
    var origId = el.id;
    el.removeAttribute('id');
    el.setAttribute('data-ctx-for', origId);
    var orig = document.getElementById(origId);
    if (orig) {
      if (orig.classList.contains('disabled')) el.classList.add('disabled');
      else el.classList.remove('disabled');
      // Copy dynamic text (Lock/Unlock, Scratch/Unscratch) for simple menu items only
      if (!el.classList.contains('has-submenu') && !el.classList.contains('submenu')) {
        el.textContent = orig.textContent;
      }
      // Copy check marks for file type submenu
      var origChecks = orig.querySelectorAll('.check');
      var cloneChecks = el.querySelectorAll('.check');
      for (var ci = 0; ci < origChecks.length && ci < cloneChecks.length; ci++) {
        cloneChecks[ci].innerHTML = origChecks[ci].innerHTML;
      }
    }
  });

  // Bind submenu open/close via mouseenter/mouseleave (more reliable than
  // CSS :hover). Plus a click handler so taps work on touch devices —
  // mouseenter doesn't fire reliably on touch and the bare tap would
  // otherwise bubble out and close the context menu before the submenu
  // appears.
  function openContextSubmenu(item) {
    contextMenu.querySelectorAll('.has-submenu.submenu-open').forEach(function(el) {
      if (el !== item) el.classList.remove('submenu-open');
    });
    if (!item.classList.contains('disabled')) {
      item.classList.add('submenu-open');
      var sub = item.querySelector('.submenu');
      if (sub) adjustSubmenu(sub);
    }
  }
  contextMenu.querySelectorAll('.has-submenu').forEach(function(item) {
    item.addEventListener('mouseenter', function() {
      openContextSubmenu(item);
    });
    item.addEventListener('mouseleave', function() {
      item.classList.remove('submenu-open');
    });
    item.addEventListener('click', function(e) {
      if (item.classList.contains('disabled')) return;
      // Don't swallow clicks that originate inside the .submenu — they
      // need to bubble up to the delegated #context-menu handler so the
      // original action fires. Only the header itself toggles the submenu.
      if (e.target.closest('.submenu')) return;
      e.stopPropagation();
      openContextSubmenu(item);
    });
  });

  // Position and show
  contextMenu.style.display = 'block';
  contextMenu.style.left = x + 'px';
  contextMenu.style.top = y + 'px';

  // Adjust if off-screen, clamp to viewport
  var rect = contextMenu.getBoundingClientRect();
  var newX = x, newY = y;
  if (rect.right > window.innerWidth) newX = Math.max(0, x - rect.width);
  if (rect.bottom > window.innerHeight) newY = Math.max(0, y - rect.height);
  if (newX < 0) newX = 0;
  if (newY < 0) newY = 0;
  contextMenu.style.left = newX + 'px';
  contextMenu.style.top = newY + 'px';
}

// Delegate clicks from context menu to the real menu items
contextMenu.addEventListener('click', function(e) {
  // Handle submenu items first (they're nested inside data-ctx-for elements)
  var subOption = e.target.closest('[data-align], [data-typeidx], [data-sep-idx]');
  if (subOption && !subOption.classList.contains('disabled')) {
    closeContextMenu();
    if (subOption.dataset.sepIdx !== undefined) {
      // Separator submenu uses delegation — call insertSeparator directly
      var idx = parseInt(subOption.dataset.sepIdx, 10);
      var all = getAllSeparators();
      if (!isNaN(idx) && idx >= 0 && idx < all.length) insertSeparator(all[idx]);
    } else {
      // Align and file type have per-element listeners — click the original
      var selector = '';
      if (subOption.dataset.align) selector = '#menu-entry [data-align="' + subOption.dataset.align + '"]';
      else if (subOption.dataset.typeidx !== undefined) selector = '#menu-entry [data-typeidx="' + subOption.dataset.typeidx + '"]';
      if (selector) {
        var origSub = document.querySelector(selector);
        if (origSub) origSub.click();
      }
    }
    return;
  }
  // Handle top-level menu items via data-ctx-for (skip submenu containers)
  var option = e.target.closest('[data-ctx-for]');
  if (option && !option.classList.contains('disabled') && !option.classList.contains('has-submenu')) {
    var origId = option.getAttribute('data-ctx-for');
    var orig = document.getElementById(origId);
    if (orig) {
      closeContextMenu();
      orig.click();
      return;
    }
  }
});

// Close context menu on outside click or Escape
document.addEventListener('click', (e) => {
  if (!e.target.closest('#context-menu')) closeContextMenu();
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') closeContextMenu();
});

// Right-click on dir entries — and the equivalent long-press on touch.
// Both routes select the targeted entry (or deselect on empty area) and
// then open the context menu at the pointer position.
function tryShowEntryContextMenu(target, x, y) {
  if (!currentBuffer) return false;
  var entry = target.closest('.dir-entry:not(.dir-header-row):not(.dir-parent-row)');
  var dirListing = target.closest('.dir-listing');
  if (!entry && !dirListing) return false;

  if (entry && entry.dataset.ramlinkPart !== undefined) {
    // RAMLink partition row — select via data-ramlink-part. Mustn't
    // clear .selected on the wrong path: the cloned context menu mirrors
    // the live disabled state, so the row's `.selected` class is what
    // turns Delete RAMLink Partition on.
    document.querySelectorAll('.dir-entry.selected').forEach(el => el.classList.remove('selected'));
    entry.classList.add('selected');
    updateEntryMenuState();
  } else if (entry && entry.dataset.offset) {
    var offset = parseInt(entry.dataset.offset, 10);
    if (selectedEntryIndex !== offset) {
      document.querySelectorAll('.dir-entry.selected').forEach(el => el.classList.remove('selected'));
      entry.classList.add('selected');
      selectedEntryIndex = offset;
      updateEntryMenuState();
    }
  } else {
    document.querySelectorAll('.dir-entry.selected').forEach(el => el.classList.remove('selected'));
    selectedEntryIndex = -1;
    updateEntryMenuState();
  }
  showContextMenu(x, y);
  return true;
}

document.getElementById('content').addEventListener('contextmenu', function(e) {
  if (tryShowEntryContextMenu(e.target, e.clientX, e.clientY)) e.preventDefault();
});

// Long-press on touch → same context menu. iOS Safari doesn't reliably
// fire `contextmenu` on long-press (and runs its own callout), so we use
// an explicit timer. Cancel on touchmove > 10px so vertical scrolling of
// the file listing still works.
(function bindEntryLongPress() {
  var content = document.getElementById('content');
  if (!content) return;
  var lpTimer = null, lpStart = null, lpFired = false, lpTarget = null;
  function clearLP() {
    if (lpTimer) { clearTimeout(lpTimer); lpTimer = null; }
    lpStart = null;
    lpTarget = null;
  }
  content.addEventListener('touchstart', function(e) {
    if (e.touches.length !== 1) { clearLP(); return; }
    if (!currentBuffer) return;
    // Only arm if the touch starts on something that could open a menu;
    // avoids firing inside modals, viewers, etc.
    var t = e.touches[0];
    var hit = e.target.closest('.dir-entry:not(.dir-header-row):not(.dir-parent-row), .dir-listing');
    if (!hit) return;
    lpFired = false;
    lpStart = { x: t.clientX, y: t.clientY };
    lpTarget = e.target;
    lpTimer = setTimeout(function() {
      lpFired = true;
      lpTimer = null;
      tryShowEntryContextMenu(lpTarget, lpStart.x, lpStart.y);
    }, 500);
  }, { passive: true });
  content.addEventListener('touchmove', function(e) {
    if (!lpStart) return;
    var t = e.touches[0];
    var dx = t.clientX - lpStart.x, dy = t.clientY - lpStart.y;
    if (dx * dx + dy * dy > 100) clearLP();
  }, { passive: true });
  content.addEventListener('touchend', function(e) {
    var fired = lpFired;
    clearLP();
    // Swallow the synthesized click that follows a long-press so the
    // entry doesn't also get activated (e.g. open a viewer).
    if (fired) {
      e.preventDefault();
      // Some browsers still dispatch the click after touchend; block one.
      var blocker = function(ev) {
        ev.stopPropagation();
        ev.preventDefault();
        content.removeEventListener('click', blocker, true);
      };
      content.addEventListener('click', blocker, true);
      setTimeout(function() { content.removeEventListener('click', blocker, true); }, 600);
    }
  });
  content.addEventListener('touchcancel', clearLP, { passive: true });
})();

// Click outside dir entries — do NOT deselect (selection persists until another file is clicked)

// Keyboard: Arrow Up/Down to select, Ctrl+Arrow to move entry
// Registered once outside bindDirSelection to avoid stacking listeners
document.addEventListener('keydown', (e) => {
  if (!currentBuffer) return;
  if (openMenu) return; // menu keyboard navigation handles arrow keys
  if (document.activeElement && (document.activeElement.tagName === 'INPUT' || document.activeElement.isContentEditable)) return;
  // A viewer modal is open: arrows / page keys belong to the modal body
  // for scrolling, not to the directory listing.
  var modalOpen = document.getElementById('modal-overlay');
  if (modalOpen && modalOpen.classList.contains('open')) return;

  // Enter on the RAMLink partition list — start rename on the selected
  // partition, mirroring how Enter renames a selected D81 subdir entry.
  // Double-click is what opens the partition (matching subdir UX).
  if (e.key === 'Enter' && isRamlinkListView()) {
    var rlSelRow = document.querySelector('.dir-entry.selected[data-ramlink-part]');
    if (rlSelRow) {
      e.preventDefault();
      var rlIdx = parseInt(rlSelRow.dataset.ramlinkPart, 10);
      var rlPart = ramlinkPartitions && ramlinkPartitions[rlIdx];
      if (rlPart && rlPart.type !== 0xFF) startRenameEntry(rlSelRow);
      return;
    }
  }

  // Enter: edit selected filename
  if (e.key === 'Enter' && selectedEntryIndex >= 0) {
    e.preventDefault();
    const selected = document.querySelector('.dir-entry.selected');
    if (selected) startRenameEntry(selected);
    return;
  }

  // Delete on the RAMLink partition list — delete the highlighted
  // partition (route through the menu handler so the confirm dialog
  // and SYSTEM check stay in one place).
  if (e.key === 'Delete' && isRamlinkListView()) {
    var rlSel = document.querySelector('.dir-entry.selected[data-ramlink-part]');
    if (rlSel) {
      e.preventDefault();
      deleteRamLinkPartition();
      return;
    }
  }

  // Delete: remove selected entry (not for tape formats)
  if (e.key === 'Delete' && selectedEntryIndex >= 0 && currentBuffer && !isTapeFormat()) {
    e.preventDefault();
    pushUndo();
    var toRemove = selectedEntries.length > 0 ? selectedEntries.slice() : [selectedEntryIndex];
    var slots = getDirSlotOffsets(currentBuffer);
    var firstIdx = slots.indexOf(toRemove[0]);
    // Remove in reverse order to keep offsets stable
    for (var di = toRemove.length - 1; di >= 0; di--) removeFileEntry(currentBuffer, toRemove[di]);
    var info = parseCurrentDir(currentBuffer);
    var visibleEntries = info.entries.filter(function(en) { return !en.deleted || showDeleted; });
    if (visibleEntries.length > 0) {
      var newIdx = Math.min(firstIdx, visibleEntries.length - 1);
      selectedEntryIndex = visibleEntries[newIdx].entryOff;
      selectedEntries = [selectedEntryIndex];
    } else {
      selectedEntryIndex = -1;
      selectedEntries = [];
    }
    renderDisk(info);
    return;
  }

  // Ctrl+Z: undo
  if (e.ctrlKey && e.key === 'z' && currentBuffer) {
    e.preventDefault();
    if (popUndo()) {
      var info = parseCurrentDir(currentBuffer);
      renderDisk(info);
      updateMenuState();
      updateEntryMenuState();
    }
    return;
  }

  // Ctrl+V: paste file
  if (e.ctrlKey && e.key === 'v' && clipboard.length > 0 && currentBuffer) {
    e.preventDefault();
    document.getElementById('opt-paste').click();
    return;
  }

  // Ctrl+Shift+I: insert file (Ctrl+I conflicts with browser DevTools)
  if (e.ctrlKey && e.shiftKey && !e.altKey && e.code === 'KeyI') {
    e.preventDefault();
    var insertEl = document.getElementById('opt-insert');
    if (!insertEl.classList.contains('disabled')) insertEl.click();
    return;
  }

  // Ctrl+C: copy file
  if (e.ctrlKey && !e.shiftKey && e.key === 'c' && selectedEntryIndex >= 0 && currentBuffer) {
    e.preventDefault();
    document.getElementById('opt-copy').click();
    return;
  }

  // Ctrl+A: select all files
  if (e.ctrlKey && !e.shiftKey && !e.altKey && e.key === 'a' && currentBuffer) {
    e.preventDefault();
    var entries = document.querySelectorAll('.dir-entry:not(.dir-header-row):not(.dir-parent-row)');
    selectedEntries = [];
    entries.forEach(function(el) {
      el.classList.add('selected');
      var off = parseInt(el.dataset.offset, 10);
      if (!isNaN(off)) selectedEntries.push(off);
    });
    if (selectedEntries.length > 0) selectedEntryIndex = selectedEntries[0];
    updateEntryMenuState();
    return;
  }

  // Ctrl+Alt+L/R/C/J: alignment shortcuts
  var alignKeys = { KeyL: 'left', KeyR: 'right', KeyC: 'center', KeyJ: 'justify' };
  if (e.ctrlKey && e.altKey && alignKeys[e.code] && selectedEntryIndex >= 0) {
    e.preventDefault();
    var alignEl = optAlign.querySelector('.submenu [data-align="' + alignKeys[e.code] + '"]');
    if (alignEl && !optAlign.classList.contains('disabled')) alignEl.click();
    return;
  }

  // Ctrl+<: lock/unlock
  if (e.ctrlKey && e.key === '<' && selectedEntryIndex >= 0) {
    e.preventDefault();
    var lockEl2 = document.getElementById('opt-lock');
    if (!lockEl2.classList.contains('disabled')) lockEl2.click();
    return;
  }

  // Ctrl+*: splat/unsplat
  if (e.ctrlKey && e.key === '*' && selectedEntryIndex >= 0) {
    e.preventDefault();
    var splatEl2 = document.getElementById('opt-splat');
    if (!splatEl2.classList.contains('disabled')) splatEl2.click();
    return;
  }

  // Ctrl+Alt+E: export (Ctrl+E conflicts with browser search bar)
  if (e.ctrlKey && e.altKey && e.code === 'KeyE' && selectedEntryIndex >= 0) {
    e.preventDefault();
    var exportEl = document.getElementById('opt-export');
    if (!exportEl.classList.contains('disabled')) exportEl.click();
    return;
  }

  // Ctrl+Shift+L: name to lowercase (Ctrl+L conflicts with browser address bar)
  if (e.ctrlKey && e.shiftKey && !e.altKey && e.code === 'KeyL' && selectedEntryIndex >= 0 && currentBuffer) {
    e.preventDefault();
    document.getElementById('opt-case-lower').click();
    return;
  }
  // Ctrl+Shift+U: name to uppercase (Ctrl+U conflicts with browser view source)
  if (e.ctrlKey && e.shiftKey && !e.altKey && e.code === 'KeyU' && selectedEntryIndex >= 0 && currentBuffer) {
    e.preventDefault();
    document.getElementById('opt-case-upper').click();
    return;
  }
  // Ctrl+Shift+T: toggle name case (Ctrl+T conflicts with browser new tab)
  if (e.ctrlKey && e.shiftKey && !e.altKey && e.code === 'KeyT' && selectedEntryIndex >= 0 && currentBuffer) {
    e.preventDefault();
    document.getElementById('opt-case-toggle').click();
    return;
  }
  // Ctrl+Shift+D: add directory (Ctrl+D conflicts with browser bookmark)
  if (e.ctrlKey && e.shiftKey && !e.altKey && e.code === 'KeyD') {
    e.preventDefault();
    var addDirEl = document.getElementById('opt-add-partition');
    if (!addDirEl.classList.contains('disabled')) addDirEl.click();
    return;
  }

  // Ctrl+Shift+B: view BAM (Ctrl+B conflicts with browser bookmarks bar)
  if (e.ctrlKey && e.shiftKey && !e.altKey && e.code === 'KeyB') {
    e.preventDefault();
    var bamEl = document.getElementById('opt-view-bam');
    if (!bamEl.classList.contains('disabled')) bamEl.click();
    return;
  }

  // Ctrl+Shift+H: edit disk name/header (Ctrl+H conflicts with browser history)
  if (e.ctrlKey && e.shiftKey && !e.altKey && e.code === 'KeyH') {
    e.preventDefault();
    var editName = document.getElementById('edit-name');
    if (editName) startEditing(editName);
    return;
  }

  // Ctrl+Alt+I: edit disk ID
  if (e.ctrlKey && e.altKey && e.code === 'KeyI') {
    e.preventDefault();
    var editId = document.getElementById('edit-id');
    if (editId) startEditing(editId);
    return;
  }

  if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
  e.preventDefault();

  const dir = e.key === 'ArrowUp' ? -1 : 1;

  // RAMLink container partition list: rows aren't regular dir entries
  // (no data-offset, no selectedEntryIndex), so the standard arrow
  // navigation skips them. Walk data-ramlink-part rows here, mirror
  // the click handler's selection model, and refresh the menu state
  // so Delete RAMLink Partition flips on as soon as a row is picked.
  if (isRamlinkListView()) {
    const rlRows = document.querySelectorAll('.dir-entry[data-ramlink-part]');
    if (rlRows.length === 0) return;
    let curIdx = -1;
    const selRow = document.querySelector('.dir-entry.selected[data-ramlink-part]');
    if (selRow) rlRows.forEach((r, i) => { if (r === selRow) curIdx = i; });
    let newIdx;
    if (curIdx < 0) newIdx = dir === 1 ? 0 : rlRows.length - 1;
    else newIdx = Math.max(0, Math.min(rlRows.length - 1, curIdx + dir));
    rlRows.forEach(r => r.classList.remove('selected'));
    rlRows[newIdx].classList.add('selected');
    rlRows[newIdx].scrollIntoView({ block: 'nearest' });
    updateEntryMenuState();
    return;
  }

  if (e.ctrlKey && selectedEntryIndex >= 0 && !isTapeFormat()) {
    // Ctrl+Arrow: move the selected entry
    moveEntry(dir);
  } else {
    // Arrow: select next/previous entry
    const allEntries = document.querySelectorAll('.dir-entry:not(.dir-header-row)');
    if (allEntries.length === 0) return;

    if (selectedEntryIndex < 0) {
      // Nothing selected — select first or last
      const target = dir === 1 ? allEntries[0] : allEntries[allEntries.length - 1];
      allEntries.forEach(el => el.classList.remove('selected'));
      target.classList.add('selected');
      selectedEntryIndex = parseInt(target.dataset.offset, 10);
      // Keep selectedEntries in sync — handlers like splat / lock /
      // scratch prefer it over selectedEntryIndex, so a stale array
      // would make the first keypress hit the previously-clicked row.
      selectedEntries = [selectedEntryIndex];
      updateEntryMenuState();
      target.scrollIntoView({ block: 'nearest' });
    } else {
      // Find current index in the DOM list
      let currentIdx = -1;
      allEntries.forEach((el, i) => {
        if (parseInt(el.dataset.offset, 10) === selectedEntryIndex) currentIdx = i;
      });
      const newIdx = currentIdx + dir;
      if (newIdx >= 0 && newIdx < allEntries.length) {
        allEntries.forEach(el => el.classList.remove('selected'));
        allEntries[newIdx].classList.add('selected');
        selectedEntryIndex = parseInt(allEntries[newIdx].dataset.offset, 10);
        selectedEntries = [selectedEntryIndex];
        updateEntryMenuState();
        allEntries[newIdx].scrollIntoView({ block: 'nearest' });
      }
    }
    updateEntryMenuState();
  }
});

function updateEntryMenuState() {
  const hasSelection = selectedEntryIndex >= 0 && currentBuffer;
  const multiSelect = selectedEntries.length > 1;
  const inPartition = currentPartition !== null;
  const tape = isTapeFormat();
  // The RAMLink container partition list isn't a filesystem — file-
  // level operations (insert, rename, etc.) make no sense, so we treat
  // it like a tape image for the disabled-state checks.
  const containerList = isRamlinkListView();
  const noEdit = tape || containerList;
  // Single-select only operations (all disabled for tape / container list)
  document.getElementById('opt-rename').classList.toggle('disabled', !hasSelection || multiSelect || noEdit);
  document.getElementById('opt-insert').classList.toggle('disabled', multiSelect || !currentBuffer || !canInsertFile() || noEdit);
  document.getElementById('opt-insert-sep').classList.toggle('disabled', multiSelect || !currentBuffer || !canInsertFile() || noEdit);
  document.getElementById('opt-block-size').classList.toggle('disabled', !hasSelection || multiSelect || noEdit);
  document.getElementById('opt-change-ts').classList.toggle('disabled', !hasSelection || multiSelect || noEdit);
  document.getElementById('opt-view-as').classList.toggle('disabled', !hasSelection || multiSelect || containerList);
  var noNesting = inPartition && !currentFormat.subdirLinked; // D81: no nesting; DNP: nesting allowed
  document.getElementById('opt-add-partition').classList.toggle('disabled', multiSelect || noNesting || !currentBuffer || !currentFormat.supportsSubdirs || !canInsertFile() || noEdit);

  // RAMLink partition management — only meaningful (and only visible)
  // on the container's partition-list view.
  var rlNewBtn = document.getElementById('opt-rl-new-partition');
  var rlRenBtn = document.getElementById('opt-rl-rename-partition');
  var rlDelBtn = document.getElementById('opt-rl-delete-partition');
  rlNewBtn.style.display = containerList ? '' : 'none';
  rlRenBtn.style.display = containerList ? '' : 'none';
  rlDelBtn.style.display = containerList ? '' : 'none';
  if (containerList) {
    var listSelEl = document.querySelector('.dir-entry.selected[data-ramlink-part]');
    var selPartIdx = listSelEl ? parseInt(listSelEl.dataset.ramlinkPart, 10) : -1;
    var selPart = (selPartIdx >= 0 && ramlinkPartitions) ? ramlinkPartitions[selPartIdx] : null;
    rlNewBtn.classList.toggle('disabled', !canAddRamLinkPartition());
    // Rename / Delete need a non-SYSTEM partition selected.
    var canModify = !!selPart && selPart.type !== 0xFF;
    rlRenBtn.classList.toggle('disabled', !canModify);
    rlDelBtn.classList.toggle('disabled', !canModify);
  }
  // Multi-select compatible operations (all disabled for tape / container list except copy/export)
  document.getElementById('opt-remove').classList.toggle('disabled', !hasSelection || noEdit);
  document.getElementById('opt-move-up').classList.toggle('disabled', !hasSelection || noEdit);
  document.getElementById('opt-move-down').classList.toggle('disabled', !hasSelection || noEdit);
  document.getElementById('opt-align').classList.toggle('disabled', !hasSelection || noEdit);
  document.getElementById('opt-recalc-size').classList.toggle('disabled', !hasSelection || noEdit);
  document.getElementById('opt-lock').classList.toggle('disabled', !hasSelection || noEdit);
  var isCbmPartition = false;
  if (hasSelection && !tape && currentBuffer) {
    var pData = new Uint8Array(currentBuffer);
    var pTypeIdx = pData[selectedEntryIndex + 2] & 0x07;
    isCbmPartition = (pTypeIdx === 5 || pTypeIdx === 6);
  }
  document.getElementById('opt-splat').classList.toggle('disabled', !hasSelection || noEdit || isCbmPartition);
  document.getElementById('opt-change-type').classList.toggle('disabled', !hasSelection || noEdit || isCbmPartition);
  var canScratch = false, canUnscratch = false;
  if (hasSelection && !tape && currentBuffer) {
    var uData = new Uint8Array(currentBuffer);
    var uTypeByte = uData[selectedEntryIndex + 2];
    var uClosed = (uTypeByte & 0x80) !== 0;
    var uTypeIdx = uTypeByte & 0x07;
    var uLocked = (uTypeByte & 0x40) !== 0;
    if (uClosed && uTypeIdx >= 1 && uTypeIdx <= 4 && !isCbmPartition) {
      canScratch = uLocked ? 'locked' : true;
    }
    if (!uClosed && uData[selectedEntryIndex + 3] !== 0 && uData[selectedEntryIndex + 3] !== currentFormat.dirTrack) {
      var uRecov = checkScratchedRecoverable(currentBuffer, selectedEntryIndex);
      canUnscratch = (uRecov === 'yes' || uRecov === 'partial');
    }
  }
  var scratchEl = document.getElementById('opt-scratch');
  var unscratchEl = document.getElementById('opt-unscratch');
  scratchEl.style.display = canScratch ? '' : 'none';
  scratchEl.classList.toggle('disabled', canScratch === 'locked');
  unscratchEl.style.display = canUnscratch ? '' : 'none';
  unscratchEl.classList.toggle('disabled', !canUnscratch);
  document.getElementById('opt-case').classList.toggle('disabled', !hasSelection || noEdit);
  // Disable file types not supported by the current format
  var supportedTypes = currentFormat.fileTypes || [0, 1, 2, 3, 4];
  for (var ti = 0; ti <= 5; ti++) {
    var typeEl = document.querySelector('[data-typeidx="' + ti + '"]');
    if (typeEl) typeEl.classList.toggle('disabled', supportedTypes.indexOf(ti) < 0);
  }
  // Copy/export/view: for tape formats, use parsed entry info
  var exportEnabled = false;
  var copyEnabled = false;
  var basicEnabled = false;
  var gfxEnabled = false;
  var geosEnabled = false;
  var geoWriteEnabled = false;
  if (hasSelection && tape) {
    var tapeEntry = getTapeEntry(selectedEntryIndex);
    if (tapeEntry) {
      exportEnabled = true;
      copyEnabled = true;
      // Check if PRG with BASIC load address
      if (tapeEntry.type.trim() === 'PRG') {
        var tResult = readFileData(currentBuffer, selectedEntryIndex);
        if (tResult.data.length >= 2) {
          var tAddr = tResult.data[0] | (tResult.data[1] << 8);
          basicEnabled = BASIC_LOAD_ADDRS[tAddr] !== undefined;
          gfxEnabled = true;
        }
      }
    }
  } else if (hasSelection) {
    var edata = new Uint8Array(currentBuffer);
    var eType = edata[selectedEntryIndex + 2];
    var eClosed = (eType & 0x80) !== 0;
    var eIdx = eType & 0x07;
    exportEnabled = eClosed && eIdx >= 1 && eIdx <= 4;
    copyEnabled = exportEnabled;
    var geosFileType = edata[selectedEntryIndex + 0x18];
    var geosStruct = edata[selectedEntryIndex + 0x17];
    var isGeosGfx = (geosFileType === 0x14 || geosFileType === 0x15 || geosFileType === 0x08 || geosFileType === 0x18) ||
      ((geosFileType === 0x07 || geosFileType === 0x13) && geosStruct === 0x01); // application data or write image + VLIR
    gfxEnabled = eClosed && (eIdx === 2 || isGeosGfx) && edata[selectedEntryIndex + 3] > 0;
    if (eClosed && eIdx === 2) {
      var ft = edata[selectedEntryIndex + 3];
      var fs = edata[selectedEntryIndex + 4];
      if (ft > 0) {
        var foff = sectorOffset(ft, fs);
        if (foff >= 0) {
          var addr = edata[foff + 2] | (edata[foff + 3] << 8);
          basicEnabled = BASIC_LOAD_ADDRS[addr] !== undefined;
        }
      }
    }
    geosEnabled = edata[selectedEntryIndex + 0x18] > 0;
    // geoWrite document detection: type $07 or $13 with VLIR structure
    if (eClosed && geosStruct === 0x01 && (geosFileType === 0x07 || geosFileType === 0x13)) {
      var gwInfoT = edata[selectedEntryIndex + 0x15];
      var gwInfoS = edata[selectedEntryIndex + 0x16];
      if (gwInfoT > 0) {
        var gwInfo = readGeosInfoBlock(currentBuffer, gwInfoT, gwInfoS);
        if (gwInfo && gwInfo.className && gwInfo.className.toLowerCase().indexOf('write image') === 0) {
          geoWriteEnabled = true;
        }
      }
    }
  }
  document.getElementById('opt-export').classList.toggle('disabled', !exportEnabled || containerList);
  document.getElementById('opt-export-cvt').classList.toggle('disabled', !geosEnabled || !exportEnabled || containerList);
  document.getElementById('opt-export-rtf').classList.toggle('disabled', !geoWriteEnabled || containerList);
  document.getElementById('opt-export-pdf').classList.toggle('disabled', !geoWriteEnabled || containerList);
  document.getElementById('opt-export-txt-gw').classList.toggle('disabled', !geoWriteEnabled || containerList);
  document.getElementById('opt-save-sep').classList.toggle('disabled', !hasSelection || noEdit);
  document.getElementById('opt-export-menu').classList.toggle('disabled', (!exportEnabled && !geoWriteEnabled) || containerList);
  document.getElementById('opt-copy').classList.toggle('disabled', !copyEnabled || containerList);
  document.getElementById('opt-paste').classList.toggle('disabled', clipboard.length === 0 || !currentBuffer || !canInsertFile() || noEdit);
  document.getElementById('opt-view-basic').classList.toggle('disabled', !basicEnabled);
  document.getElementById('opt-view-gfx').classList.toggle('disabled', !gfxEnabled);
  document.getElementById('opt-view-geowrite').classList.toggle('disabled', !geoWriteEnabled);
  var isVlir = hasSelection && !tape && edata && isVlirFile(edata, selectedEntryIndex);
  document.getElementById('opt-view-vlir').classList.toggle('disabled', !isVlir);
  var isRel = hasSelection && !tape && edata && (edata[selectedEntryIndex + 2] & 0x07) === 4;
  document.getElementById('opt-view-rel').classList.toggle('disabled', !isRel);
  // TASS: only enable when the file actually carries the $09 $FF magic at
  // payload offset $0C-$0D (= sector bytes $10-$11 in the first data sector).
  // Skip the check entirely on tape and on non-PRG types.
  var isTassCandidate = false;
  if (hasSelection && !tape && edata && (edata[selectedEntryIndex + 2] & 0x87) === 0x82) {
    var tt = edata[selectedEntryIndex + 3];
    var ts = edata[selectedEntryIndex + 4];
    if (tt > 0) {
      var tassFoff = sectorOffset(tt, ts);
      if (tassFoff >= 0 && tassFoff + 0x12 <= edata.length &&
          edata[tassFoff + 0x10] === 0x09 && edata[tassFoff + 0x11] === 0xFF) {
        isTassCandidate = true;
      }
    }
  }
  document.getElementById('opt-view-tass').classList.toggle('disabled', !isTassCandidate);
  document.getElementById('opt-import').classList.toggle('disabled', multiSelect || !currentBuffer || !canInsertFile() || noEdit);
  document.getElementById('opt-edit-sector').classList.toggle('disabled', !hasSelection || multiSelect || noEdit);
  document.getElementById('opt-edit-file-sector').classList.toggle('disabled', !hasSelection || noEdit);
  document.getElementById('opt-view-geos').classList.toggle('disabled', !geosEnabled);
  const lockEl = document.getElementById('opt-lock');
  const splatEl = document.getElementById('opt-splat');
  if (hasSelection && !tape) {
    const data = new Uint8Array(currentBuffer);
    const typeByte = data[selectedEntryIndex + 2];
    const closed = (typeByte & 0x80) !== 0;
    const locked = (typeByte & 0x40) !== 0;
    const currentTypeIdx = typeByte & 0x07;
    lockEl.textContent = locked ? 'Unlock File' : 'Lock File';
    splatEl.textContent = closed ? 'Splat File' : 'Unsplat File';
    for (let i = 0; i < 6; i++) {
      document.getElementById('check-type-' + i).innerHTML = i === currentTypeIdx ? '<i class="fa-solid fa-check"></i>' : '';
    }
  } else {
    lockEl.textContent = 'Lock File';
    splatEl.textContent = 'Splat File';
    for (let i = 0; i < 6; i++) {
      document.getElementById('check-type-' + i).textContent = '';
    }
  }

  // Update footer T/S display
  var footerTs = document.getElementById('footer-ts');
  if (footerTs) {
    if (hasSelection) {
      // Find which directory sector this entry is in
      var slots = getDirSlotOffsets(currentBuffer);
      var slotIdx = slots.indexOf(selectedEntryIndex);
      var dirSectorIdx = Math.floor(slotIdx / currentFormat.entriesPerSector);
      var entryInSector = slotIdx % currentFormat.entriesPerSector;
      // Walk the directory chain to find the actual T/S
      var data2 = new Uint8Array(currentBuffer);
      var dctx = getDirContext();
      var dt = dctx.dirTrack, ds = dctx.dirSector;
      var dVisited = new Set();
      for (var di = 0; di < dirSectorIdx && dt !== 0; di++) {
        var dk = dt + ':' + ds;
        if (dVisited.has(dk)) break;
        dVisited.add(dk);
        var doff = sectorOffset(dt, ds);
        dt = data2[doff]; ds = data2[doff + 1];
      }
      footerTs.textContent = 'T:$' + dt.toString(16).toUpperCase().padStart(2, '0') +
        ' S:$' + ds.toString(16).toUpperCase().padStart(2, '0');
    } else {
      footerTs.textContent = '';
    }
  }
}

