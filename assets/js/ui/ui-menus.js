// ── Context menu on directory entries ─────────────────────────────────
var contextMenu = document.getElementById('context-menu');

// Offset of the row the user was on when Shift+Arrow started extending
// the selection. Stays put across consecutive Shift+Arrow presses so the
// range can grow or shrink relative to that anchor; resets on plain
// Arrow / click / Escape.
var shiftSelectAnchor = -1;
// Anchor *element* for the partition-list views (CMD container + .hdd).
// These views don't use selectedEntryIndex — selection is class-only —
// so the anchor is tracked by DOM reference instead of by id.
var shiftSelectAnchorRow = null;

// Arrow-key handler shared by the CMD container partition list and the
// .hdd partition list. Both use class-only selection (no
// selectedEntryIndex). Shift+Arrow extends a range from the anchor;
// plain Arrow replaces the selection.
function _arrowOnPartitionList(rowsNodeList, dir, isShift) {
  const rows = Array.prototype.slice.call(rowsNodeList);
  if (rows.length === 0) return;
  // Current cursor row: last (in DOM order, in the direction of travel)
  // currently-selected row, so consecutive Shift+Arrow presses advance
  // monotonically through the list.
  const selRows = rows.filter(r => r.classList.contains('selected'));
  let curRow = null;
  if (selRows.length > 0) {
    curRow = dir === 1 ? selRows[selRows.length - 1] : selRows[0];
  }
  const curIdx = curRow ? rows.indexOf(curRow) : -1;
  let newIdx;
  if (curIdx < 0) newIdx = dir === 1 ? 0 : rows.length - 1;
  else newIdx = Math.max(0, Math.min(rows.length - 1, curIdx + dir));
  if (isShift) {
    if (!shiftSelectAnchorRow || rows.indexOf(shiftSelectAnchorRow) < 0) {
      shiftSelectAnchorRow = curRow || rows[newIdx];
    }
    const anchorIdx = rows.indexOf(shiftSelectAnchorRow);
    const lo = Math.min(anchorIdx, newIdx);
    const hi = Math.max(anchorIdx, newIdx);
    rows.forEach(r => r.classList.remove('selected'));
    for (let i = lo; i <= hi; i++) rows[i].classList.add('selected');
  } else {
    shiftSelectAnchorRow = null;
    rows.forEach(r => r.classList.remove('selected'));
    rows[newIdx].classList.add('selected');
  }
  rows[newIdx].scrollIntoView({ block: 'nearest' });
  updateEntryMenuState();
}

function closeContextMenu() {
  contextMenu.style.display = 'none';
  contextMenu.innerHTML = '';
}

// Hide disabled options in the cloned context menu, plus submenu parents
// whose entire submenu is dead, plus any separators that become orphaned
// (leading, trailing, or adjacent) once their neighbours are gone.
function hideDisabledContextItems() {
  contextMenu.querySelectorAll('.option.disabled').forEach(function(el) {
    el.style.display = 'none';
  });
  contextMenu.querySelectorAll('.has-submenu').forEach(function(parent) {
    if (parent.style.display === 'none') return;
    var sub = parent.querySelector(':scope > .submenu');
    if (!sub) return;
    var hasLive = false;
    sub.querySelectorAll(':scope > .option').forEach(function(c) {
      if (c.classList.contains('disabled')) return;
      if (c.style.display === 'none') return;
      hasLive = true;
    });
    if (!hasLive) parent.style.display = 'none';
  });
  var visible = Array.from(contextMenu.children).filter(function(c) {
    return c.style.display !== 'none';
  });
  while (visible.length && visible[0].classList.contains('separator')) {
    visible[0].style.display = 'none';
    visible.shift();
  }
  while (visible.length && visible[visible.length - 1].classList.contains('separator')) {
    visible[visible.length - 1].style.display = 'none';
    visible.pop();
  }
  for (var i = visible.length - 1; i > 0; i--) {
    if (visible[i].classList.contains('separator') &&
        visible[i - 1].classList.contains('separator')) {
      visible[i].style.display = 'none';
    }
  }
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

  // Hide disabled clones: a popup menu only shows what can be actioned right
  // now. The persistent menubar still grays disabled items for discovery.
  hideDisabledContextItems();

  // Bind submenu open/close via mouseenter/mouseleave (more reliable than
  // CSS :hover). Plus a click handler so taps work on touch devices —
  // mouseenter doesn't fire reliably on touch and the bare tap would
  // otherwise bubble out and close the context menu before the submenu
  // appears.
  function openContextSubmenu(item) {
    // Only close direct siblings — closing all open submenus would also
    // close ancestors when the user drills into a nested has-submenu.
    var parent = item.parentElement;
    if (parent) {
      parent.querySelectorAll(':scope > .has-submenu.submenu-open').forEach(function(el) {
        if (el !== item) el.classList.remove('submenu-open');
      });
    }
    if (!item.classList.contains('disabled')) {
      item.classList.add('submenu-open');
      var sub = item.querySelector(':scope > .submenu');
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
      // Clicks inside this item's OWN submenu need to bubble to the
      // delegated handler so the action fires; only the header toggles.
      // (Checking any ancestor .submenu would break nested has-submenu —
      // a click on a nested header is technically inside its parent's
      // submenu, but should still open its own.)
      var ownSub = item.querySelector(':scope > .submenu');
      if (ownSub && ownSub.contains(e.target)) return;
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
      // Separator submenu uses delegation — call the right insert helper
      // for the active view. CFS partitions need insertCfsSeparator;
      // CBM-DOS shapes use insertSeparator.
      var idx = parseInt(subOption.dataset.sepIdx, 10);
      var all = getAllSeparators();
      if (!isNaN(idx) && idx >= 0 && idx < all.length) {
        if (typeof cfsPartitionIdx !== 'undefined' && cfsPartitionIdx >= 0) {
          insertCfsSeparator(all[idx]);
        } else {
          insertSeparator(all[idx]);
        }
      }
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

  if (entry && entry.dataset.cmdcPart !== undefined) {
    // CMD container partition row — select via data-cmdc-part. Mustn't
    // clear .selected on the wrong path: the cloned context menu mirrors
    // the live disabled state, so the row's `.selected` class is what
    // turns Delete Partition on.
    document.querySelectorAll('.dir-entry.selected').forEach(el => el.classList.remove('selected'));
    entry.classList.add('selected');
    updateEntryMenuState();
  } else if (entry && entry.dataset.hddPart !== undefined) {
    // IDE64 .hdd partition row — same idea as the CMD branch above.
    // Without selecting on right-click, Rename / Delete Partition stay
    // disabled and hideDisabledContextItems drops them from the popup.
    document.querySelectorAll('.dir-entry.selected').forEach(el => el.classList.remove('selected'));
    entry.classList.add('selected');
    updateEntryMenuState();
  } else if (entry && entry.dataset.cfsEntry !== undefined) {
    // CFS file / subdir row — select via data-cfs-entry. The index is
    // the absolute slot in cfsDirEntries (across all chained dir
    // sectors), not a byte offset. Mirror the CBM-DOS branch below:
    // right-click *inside* a multi-selection preserves the selection
    // (so batch handlers act on every row); right-click *outside* it
    // retargets to just the clicked row.
    var cfsIdx = parseInt(entry.dataset.cfsEntry, 10);
    if (selectedEntries.indexOf(cfsIdx) < 0) {
      document.querySelectorAll('.dir-entry.selected').forEach(el => el.classList.remove('selected'));
      entry.classList.add('selected');
      selectedEntryIndex = cfsIdx;
      selectedEntries = [cfsIdx];
      updateEntryMenuState();
    }
  } else if (entry && entry.dataset.offset) {
    var offset = parseInt(entry.dataset.offset, 10);
    // Right-click on a file outside the current multi-selection retargets
    // to just that file. Action handlers read `selectedEntries` first, so
    // updating `selectedEntryIndex` alone would leave them aimed at the
    // previously-clicked file.
    if (selectedEntries.indexOf(offset) < 0) {
      document.querySelectorAll('.dir-entry.selected').forEach(el => el.classList.remove('selected'));
      entry.classList.add('selected');
      selectedEntryIndex = offset;
      selectedEntries = [offset];
      updateEntryMenuState();
    }
  } else {
    document.querySelectorAll('.dir-entry.selected').forEach(el => el.classList.remove('selected'));
    selectedEntryIndex = -1;
    selectedEntries = [];
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

  // Enter on the CMD container partition list — start rename on the
  // selected partition, mirroring how Enter renames a selected D81 subdir
  // entry. Double-click is what opens the partition (matching subdir UX).
  if ((e.key === 'Enter' || e.key === 'F2') && isCmdContainerListView()) {
    var cSelRow = document.querySelector('.dir-entry.selected[data-cmdc-part]');
    if (cSelRow) {
      e.preventDefault();
      var cIdx = parseInt(cSelRow.dataset.cmdcPart, 10);
      var cPart = cmdcPartitions && cmdcPartitions[cIdx];
      if (cPart && cPart.type !== 0xFF) startRenameEntry(cSelRow);
      return;
    }
  }

  // Enter / F2 on the .hdd partition list — rename the selected partition.
  // selectedEntryIndex isn't used in this view, so check the row directly.
  if ((e.key === 'Enter' || e.key === 'F2') &&
      typeof isIde64ContainerView === 'function' && isIde64ContainerView() &&
      cfsPartitionIdx < 0 && !isCmdContainerListView()) {
    var hSelRow = document.querySelector('.dir-entry.selected[data-hdd-part]');
    if (hSelRow) {
      e.preventDefault();
      if (typeof startInlineRenameHddPartition === 'function') startInlineRenameHddPartition(hSelRow);
      return;
    }
  }

  // Enter / F2: edit selected filename (CFS branch uses the CFS-aware
  // inline rename helper since startRenameEntry reads data-offset which
  // CFS rows don't have).
  if ((e.key === 'Enter' || e.key === 'F2') && selectedEntryIndex >= 0) {
    e.preventDefault();
    const selected = document.querySelector('.dir-entry.selected');
    if (!selected) return;
    if (cfsPartitionIdx >= 0 && cfsDirEntries && selected.dataset.cfsEntry !== undefined) {
      if (typeof startInlineRenameCfsEntry === 'function') startInlineRenameCfsEntry(selected);
      return;
    }
    startRenameEntry(selected);
    return;
  }

  // Delete on the CMD container partition list — delete the highlighted
  // partition (route through the menu handler so the confirm dialog
  // and SYSTEM check stay in one place).
  if (e.key === 'Delete' && isCmdContainerListView()) {
    var cDel = document.querySelector('.dir-entry.selected[data-cmdc-part]');
    if (cDel) {
      e.preventDefault();
      deleteCmdContainerPartition();
      return;
    }
  }

  // Delete on the .hdd partition list — same routing as CMD list, but
  // through the IDE64 soft-delete path. Multi-select aware.
  if (e.key === 'Delete' &&
      typeof isIde64ContainerView === 'function' && isIde64ContainerView() &&
      cfsPartitionIdx < 0 && !isCmdContainerListView()) {
    var hDelRows = document.querySelectorAll('.dir-entry.selected[data-hdd-part]');
    if (hDelRows.length > 0) {
      e.preventDefault();
      var hDelIdxs = [];
      hDelRows.forEach(function(el) {
        var n = parseInt(el.dataset.hddPart, 10);
        if (!isNaN(n)) hDelIdxs.push(n);
      });
      if (hDelIdxs.length > 0 && typeof confirmHddPartitionDelete === 'function') {
        confirmHddPartitionDelete(hDelIdxs);
      }
      return;
    }
  }

  // Delete: remove selected entry (not for tape formats). CFS branch
  // routes through the opt-remove menu handler so the CFS-aware path
  // (cfsRemoveDirEntry, sector free) runs instead of the CBM-DOS
  // removeFileEntry which would corrupt the buffer.
  if (e.key === 'Delete' && selectedEntryIndex >= 0 && !isTapeFormat(getCurrentCtx())) {
    if (cfsPartitionIdx >= 0 && cfsDirEntries) {
      e.preventDefault();
      var rmEl = document.getElementById('opt-remove');
      if (!rmEl.classList.contains('disabled')) rmEl.click();
      return;
    }
    if (!currentBuffer) return;
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

  // Ctrl+Shift+Z: redo. Tested before Ctrl+Z so the shift modifier
  // doesn't fall through to the undo branch.
  if (e.ctrlKey && e.shiftKey && (e.key === 'Z' || e.key === 'z') && currentBuffer) {
    e.preventDefault();
    if (popRedo()) {
      if (cfsPartitionIdx >= 0 && cfsDirEntries) {
        if (typeof refreshIde64View === 'function') refreshIde64View();
      } else {
        var info = parseCurrentDir(currentBuffer);
        renderDisk(info);
      }
      updateMenuState();
      updateEntryMenuState();
    }
    return;
  }

  // Ctrl+Z: undo. CFS branch re-renders via refreshIde64View since
  // parseCurrentDir is CBM-DOS-only.
  if (e.ctrlKey && !e.shiftKey && e.key === 'z' && currentBuffer) {
    e.preventDefault();
    if (popUndo()) {
      if (cfsPartitionIdx >= 0 && cfsDirEntries) {
        if (typeof refreshIde64View === 'function') refreshIde64View();
      } else {
        var info = parseCurrentDir(currentBuffer);
        renderDisk(info);
      }
      updateMenuState();
      updateEntryMenuState();
    }
    return;
  }

  // Ctrl+Y: redo (Windows convention).
  if (e.ctrlKey && !e.shiftKey && e.key === 'y' && currentBuffer) {
    e.preventDefault();
    if (popRedo()) {
      if (cfsPartitionIdx >= 0 && cfsDirEntries) {
        if (typeof refreshIde64View === 'function') refreshIde64View();
      } else {
        var info = parseCurrentDir(currentBuffer);
        renderDisk(info);
      }
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

  // Ctrl+A: select all files / partitions. Each view has its own row
  // attribute (data-offset for CBM-DOS, data-cfs-entry for CFS,
  // data-cmdc-part for CMD container, data-hdd-part for .hdd).
  if (e.ctrlKey && !e.shiftKey && !e.altKey && e.key === 'a' && currentBuffer) {
    e.preventDefault();
    if (isCmdContainerListView()) {
      document.querySelectorAll('.dir-entry[data-cmdc-part]').forEach(function(el) {
        el.classList.add('selected');
      });
      updateEntryMenuState();
      return;
    }
    if (typeof isIde64ContainerView === 'function' && isIde64ContainerView() && cfsPartitionIdx < 0) {
      document.querySelectorAll('.dir-entry[data-hdd-part]').forEach(function(el) {
        el.classList.add('selected');
      });
      updateEntryMenuState();
      return;
    }
    if (cfsPartitionIdx >= 0 && cfsDirEntries) {
      var cfsRows = document.querySelectorAll('.dir-entry[data-cfs-entry]');
      selectedEntries = [];
      cfsRows.forEach(function(el) {
        el.classList.add('selected');
        var ci = parseInt(el.dataset.cfsEntry, 10);
        if (!isNaN(ci)) selectedEntries.push(ci);
      });
      if (selectedEntries.length > 0) selectedEntryIndex = selectedEntries[0];
      updateEntryMenuState();
      return;
    }
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

  // Plain Arrow (no shift) — reset the shift-extend anchor so the next
  // Shift+Arrow starts from the new cursor position.
  if (!e.shiftKey) shiftSelectAnchor = -1;

  // Shift+Arrow on the CBM-DOS dir view — anchor-based range extend.
  // CFS / CMD list / HDD list have their own shift-extend logic below
  // because their selection state differs.
  if (e.shiftKey && !e.ctrlKey && !e.altKey &&
      !(cfsPartitionIdx >= 0 && cfsDirEntries) &&
      !isCmdContainerListView() &&
      !(typeof isIde64ContainerView === 'function' && isIde64ContainerView() && cfsPartitionIdx < 0) &&
      selectedEntryIndex >= 0) {
    const allEntriesS = document.querySelectorAll('.dir-entry:not(.dir-header-row)');
    if (allEntriesS.length === 0) return;
    const offsetsS = [];
    allEntriesS.forEach(el => offsetsS.push(parseInt(el.dataset.offset, 10)));
    let curIdxS = offsetsS.indexOf(selectedEntryIndex);
    if (curIdxS < 0) return;
    const newIdxS = curIdxS + dir;
    if (newIdxS < 0 || newIdxS >= allEntriesS.length) return;
    if (selectedEntries.length <= 1 || selectedEntries.indexOf(shiftSelectAnchor) < 0) {
      shiftSelectAnchor = selectedEntryIndex;
    }
    const anchorIdx = offsetsS.indexOf(shiftSelectAnchor);
    const lo = Math.min(anchorIdx, newIdxS);
    const hi = Math.max(anchorIdx, newIdxS);
    allEntriesS.forEach(el => el.classList.remove('selected'));
    selectedEntries = [];
    for (let si = lo; si <= hi; si++) {
      allEntriesS[si].classList.add('selected');
      selectedEntries.push(offsetsS[si]);
    }
    selectedEntryIndex = offsetsS[newIdxS];
    updateEntryMenuState();
    allEntriesS[newIdxS].scrollIntoView({ block: 'nearest' });
    return;
  }

  // CFS view: row attr is data-cfs-entry (slot index in cfsDirEntries),
  // not data-offset. Ctrl+Arrow → move via moveCfsEntries; Shift+Arrow
  // → extend the multi-select range; plain Arrow → walk rows and
  // replace the selection.
  if (cfsPartitionIdx >= 0 && cfsDirEntries) {
    if (e.ctrlKey && !e.shiftKey) {
      if (typeof moveCfsEntries === 'function') moveCfsEntries(dir);
      return;
    }
    var cfsRowsArr = Array.prototype.slice.call(document.querySelectorAll('.dir-entry[data-cfs-entry]'));
    if (cfsRowsArr.length === 0) return;
    var cfsIdsArr = cfsRowsArr.map(function(r) { return parseInt(r.dataset.cfsEntry, 10); });
    var curIdx2 = cfsIdsArr.indexOf(selectedEntryIndex);
    var newIdx2;
    if (curIdx2 < 0) newIdx2 = dir === 1 ? 0 : cfsRowsArr.length - 1;
    else newIdx2 = Math.max(0, Math.min(cfsRowsArr.length - 1, curIdx2 + dir));

    if (e.shiftKey && curIdx2 >= 0) {
      if (selectedEntries.length <= 1 || selectedEntries.indexOf(shiftSelectAnchor) < 0) {
        shiftSelectAnchor = selectedEntryIndex;
      }
      var cfsAnchorIdx = cfsIdsArr.indexOf(shiftSelectAnchor);
      var cfsLo = Math.min(cfsAnchorIdx, newIdx2);
      var cfsHi = Math.max(cfsAnchorIdx, newIdx2);
      cfsRowsArr.forEach(function(r) { r.classList.remove('selected'); });
      selectedEntries = [];
      for (var cfsI = cfsLo; cfsI <= cfsHi; cfsI++) {
        cfsRowsArr[cfsI].classList.add('selected');
        selectedEntries.push(cfsIdsArr[cfsI]);
      }
      selectedEntryIndex = cfsIdsArr[newIdx2];
    } else {
      cfsRowsArr.forEach(function(r) { r.classList.remove('selected'); });
      cfsRowsArr[newIdx2].classList.add('selected');
      selectedEntryIndex = cfsIdsArr[newIdx2];
      selectedEntries = [selectedEntryIndex];
    }
    updateEntryMenuState();
    cfsRowsArr[newIdx2].scrollIntoView({ block: 'nearest' });
    return;
  }

  // CMD container partition list: rows aren't regular dir entries
  // (no data-offset, no selectedEntryIndex), so the standard arrow
  // navigation skips them. Walk data-cmdc-part rows here, mirror
  // the click handler's selection model, and refresh the menu state
  // so Delete Partition flips on as soon as a row is picked.
  if (isCmdContainerListView()) {
    _arrowOnPartitionList(document.querySelectorAll('.dir-entry[data-cmdc-part]'), dir, e.shiftKey);
    return;
  }

  // .hdd partition list — same shape as the CMD container branch but
  // rows use data-hdd-part. Selection is class-only (selectedEntryIndex
  // isn't used in this view).
  if (typeof isIde64ContainerView === 'function' && isIde64ContainerView() && cfsPartitionIdx < 0) {
    _arrowOnPartitionList(document.querySelectorAll('.dir-entry[data-hdd-part]'), dir, e.shiftKey);
    return;
  }

  if (e.ctrlKey && selectedEntryIndex >= 0 && !isTapeFormat(getCurrentCtx())) {
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
  const tape = isTapeFormat(getCurrentCtx());
  // The CMD container partition list isn't a filesystem — file-
  // level operations (insert, rename, etc.) make no sense, so we treat
  // it like a tape image for the disabled-state checks.
  const containerList = isCmdContainerListView();
  const noEdit = tape || containerList;
  // Reset any items the CFS override may have hidden last time around.
  // Without this, switching from a CFS partition view back to a D64/etc
  // tab leaves Lock / Splat / Remove Entry / Move Up / Move Down / Align
  // / Edit T-S / View As stuck on display:none from a prior render.
  // Each individual disabled-state check below still runs to set the
  // correct disabled class for the new view.
  var _cfsHiddenIds = ['opt-change-ts',
    'opt-scratch', 'opt-unscratch'];
  for (var _ri = 0; _ri < _cfsHiddenIds.length; _ri++) {
    var _re = document.getElementById(_cfsHiddenIds[_ri]);
    if (_re) _re.style.display = '';
  }
  // Restore opt-change-ts to its CBM-DOS label — the CFS branch below
  // relabels it to "Edit Data LBA…" since CFS has no T/S concept; this
  // line undoes that when switching to a non-CFS view.
  var _tsResetEl = document.getElementById('opt-change-ts');
  if (_tsResetEl) _tsResetEl.textContent = 'Edit Track/Sector';
  // Single-select only operations (all disabled for tape / container list)
  document.getElementById('opt-rename').classList.toggle('disabled', !hasSelection || multiSelect || noEdit);
  document.getElementById('opt-insert').classList.toggle('disabled', multiSelect || !currentBuffer || !canInsertFile() || noEdit);
  document.getElementById('opt-insert-sep').classList.toggle('disabled', multiSelect || !currentBuffer || !canInsertFile() || noEdit);
  document.getElementById('opt-block-size').classList.toggle('disabled', !hasSelection || multiSelect || noEdit);
  document.getElementById('opt-change-ts').classList.toggle('disabled', !hasSelection || multiSelect || noEdit);
  document.getElementById('opt-view-as').classList.toggle('disabled', !hasSelection || multiSelect || containerList);
  // Reset the always-applicable View As children (Hex, Disasm, PETSCII)
  // here so they stay enabled in non-CFS contexts. Without this, entering
  // a CFS partition adds .disabled (the CFS branch below force-disables
  // them since selectedEntryIndex isn't a CBM byte offset there) and the
  // class never gets cleared on the way back out.
  document.getElementById('opt-view-hex').classList.toggle('disabled', !hasSelection || containerList);
  document.getElementById('opt-view-disasm').classList.toggle('disabled', !hasSelection || containerList);
  document.getElementById('opt-view-petscii').classList.toggle('disabled', !hasSelection || containerList);
  var noNesting = inPartition && !currentFormat.subdirLinked; // D81: no nesting; DNP: nesting allowed
  document.getElementById('opt-add-partition').classList.toggle('disabled', multiSelect || noNesting || !currentBuffer || !currentFormat.supportsSubdirs || !canInsertFile() || noEdit);

  // CMD / IDE64 container partition management — only meaningful (and
  // only visible) on a container's partition-list view. Both families
  // share the same File → New / Rename / Delete Partition menu items;
  // dispatch happens in the click handlers (ui-cmd.js for CMD, ui-ide64.js
  // for IDE64).
  var cNewBtn = document.getElementById('opt-cmdc-new-partition');
  var cRenBtn = document.getElementById('opt-cmdc-rename-partition');
  var cDelBtn = document.getElementById('opt-cmdc-delete-partition');
  var cAttrBtn = document.getElementById('opt-hdd-partition-attrs');
  var cRestoreBtn = document.getElementById('opt-hdd-partition-restore');
  var cImpBtn = document.getElementById('opt-cmdc-import-partition');
  var cExpBtn = document.getElementById('opt-cmdc-export-partition');
  var cSep1 = document.getElementById('sep-cmdc-partitions');
  var cSep2 = document.getElementById('sep-cmdc-partition-io');
  // Defensive: prefer CMD when both globals look active (shouldn't
  // happen post-fix, but a stale global is worth guarding against).
  var hddListView = !containerList && (typeof isIde64ContainerView === 'function') && isIde64ContainerView() && cfsPartitionIdx < 0;
  var partDisplay = (containerList || hddListView) ? '' : 'none';
  cNewBtn.style.display = partDisplay;
  cRenBtn.style.display = partDisplay;
  cDelBtn.style.display = partDisplay;
  // Partition Attributes is HDD-only — CMD containers don't carry the
  // HIDDEN / WRITEABLE flag bits this dialog edits.
  cAttrBtn.style.display = hddListView ? '' : 'none';
  cRestoreBtn.style.display = hddListView ? '' : 'none';
  // Import/Export stay CMD-only for now — CFS partition I/O is a
  // separate workflow (no .dnp/.d64-style flat dump).
  var ioDisplay = containerList ? '' : 'none';
  cImpBtn.style.display = ioDisplay;
  cExpBtn.style.display = ioDisplay;
  if (cSep1) cSep1.style.display = partDisplay;
  if (cSep2) cSep2.style.display = ioDisplay;
  if (containerList) {
    var listSelEl = document.querySelector('.dir-entry.selected[data-cmdc-part]');
    var selPartIdx = listSelEl ? parseInt(listSelEl.dataset.cmdcPart, 10) : -1;
    var selPart = (selPartIdx >= 0 && cmdcPartitions) ? cmdcPartitions[selPartIdx] : null;
    cNewBtn.classList.toggle('disabled', !canAddCmdContainerPartition());
    // Rename / Delete need a non-SYSTEM partition selected.
    var canModify = !!selPart && selPart.type !== 0xFF;
    cRenBtn.classList.toggle('disabled', !canModify);
    cDelBtn.classList.toggle('disabled', !canModify);
    // Import: a free slot must exist (same condition as New Partition).
    // Export: requires a non-SYSTEM partition of a supported type
    // (Native / 1541 / 1571 / 1581) — those map to .dnp / .d64 / .d71 / .d81.
    cImpBtn.classList.toggle('disabled', !canAddCmdContainerPartition());
    var canExport = !!selPart && (selPart.type >= 0x01 && selPart.type <= 0x04);
    cExpBtn.classList.toggle('disabled', !canExport);
  } else if (hddListView) {
    var hddSelEl = document.querySelector('.dir-entry.selected[data-hdd-part]');
    var selHddIdx = hddSelEl ? parseInt(hddSelEl.dataset.hddPart, 10) : -1;
    var selHddPart = (selHddIdx >= 0 && hddPartitions) ? hddPartitions[selHddIdx] : null;
    // Empty + soft-deleted slots are both reusable for a new partition.
    var hasFreeSlot = hddPartitions && hddPartitions.some(function(p) { return p.empty || p.deleted; });
    cNewBtn.classList.toggle('disabled', !hasFreeSlot);
    // Rename / Delete / Attrs apply to live partitions only — a deleted
    // slot has no live name to rename, can't be deleted again, and
    // shouldn't appear to have editable attrs. Restore Partition is the
    // mirror action: enabled only when the selected slot is deleted.
    var isLiveHdd = !!selHddPart && !selHddPart.empty && !selHddPart.deleted;
    var isDeletedHdd = !!selHddPart && selHddPart.deleted;
    cRenBtn.classList.toggle('disabled', !isLiveHdd);
    cDelBtn.classList.toggle('disabled', !isLiveHdd);
    cAttrBtn.classList.toggle('disabled', !isLiveHdd);
    cRestoreBtn.classList.toggle('disabled', !isDeletedHdd);
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
  var prgSelected = false;
  if (hasSelection && tape) {
    var tapeEntry = getTapeEntry(selectedEntryIndex);
    if (tapeEntry) {
      exportEnabled = true;
      copyEnabled = true;
      // Check if PRG with BASIC load address
      if (tapeEntry.type.trim() === 'PRG') {
        prgSelected = true;
        var tResult = readFileData(currentBuffer, selectedEntryIndex, getCurrentCtx());
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
    // Copy: regular files (PRG/SEQ/USR/REL) OR a subdir/partition entry
    // for the new cross-family tree copy. cbmCollectDirTree captures the
    // whole subtree into the clipboard, mirroring the CFS Copy path.
    var isCopyableSubdir = eClosed && currentFormat && eIdx === currentFormat.subdirType;
    copyEnabled = exportEnabled || isCopyableSubdir;
    prgSelected = eClosed && eIdx === 2;
    var geosFileType = edata[selectedEntryIndex + 0x18];
    var geosStruct = edata[selectedEntryIndex + 0x17];
    var isGeosGfx = (geosFileType === 0x14 || geosFileType === 0x15 || geosFileType === 0x08 || geosFileType === 0x18) ||
      ((geosFileType === 0x07 || geosFileType === 0x13) && geosStruct === 0x01); // application data or write image + VLIR
    gfxEnabled = eClosed && (eIdx === 2 || isGeosGfx) && edata[selectedEntryIndex + 3] > 0;
    if (eClosed && eIdx === 2) {
      var ft = edata[selectedEntryIndex + 3];
      var fs = edata[selectedEntryIndex + 4];
      if (ft > 0) {
        var foff = sectorOffset(ft, fs, getCurrentCtx());
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
        var gwInfo = readGeosInfoBlock(currentBuffer, gwInfoT, gwInfoS, getCurrentCtx());
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
  document.getElementById('opt-run-in-emulator').classList.toggle('disabled', !prgSelected || multiSelect || containerList);
  document.getElementById('opt-copy').classList.toggle('disabled', !copyEnabled || containerList);
  document.getElementById('opt-paste').classList.toggle('disabled', clipboard.length === 0 || !currentBuffer || !canInsertFile() || noEdit);
  document.getElementById('opt-view-basic').classList.toggle('disabled', !basicEnabled);
  document.getElementById('opt-view-gfx').classList.toggle('disabled', !gfxEnabled);
  document.getElementById('opt-view-geowrite').classList.toggle('disabled', !geoWriteEnabled);
  var isVlir = hasSelection && !tape && edata && isVlirFile(edata, selectedEntryIndex);
  document.getElementById('opt-view-vlir').classList.toggle('disabled', !isVlir);
  var isRel = hasSelection && !tape && edata && (edata[selectedEntryIndex + 2] & 0x07) === 4;
  document.getElementById('opt-view-rel').classList.toggle('disabled', !isRel);
  // TASS magic at sector bytes $10-$11: high byte $FF, low byte < $20.
  // Mirrors `isTassSource` (ui-tass-viewer.js). Skip on tape / non-PRG.
  var isTassCandidate = false;
  if (hasSelection && !tape && edata && (edata[selectedEntryIndex + 2] & 0x87) === 0x82) {
    var tt = edata[selectedEntryIndex + 3];
    var ts = edata[selectedEntryIndex + 4];
    if (tt > 0) {
      var tassFoff = sectorOffset(tt, ts, getCurrentCtx());
      if (tassFoff >= 0 && tassFoff + 0x12 <= edata.length &&
          edata[tassFoff + 0x11] === 0xFF && edata[tassFoff + 0x10] < 0x20) {
        isTassCandidate = true;
      }
    }
  }
  document.getElementById('opt-view-tass').classList.toggle('disabled', !isTassCandidate);
  document.getElementById('opt-import').classList.toggle('disabled', multiSelect || !currentBuffer || !canInsertFile() || noEdit);
  // Edit Current Sector / Edit File Sector are CBM-DOS only — they call
  // getDirSlotOffsets / sectorOffset / dirTrack from the format spec,
  // none of which apply to an IDE64 .hdd partition list view or to a
  // CFS file (sectors are 512 B LBAs, not 256 B T/S). Disable across
  // the entire .hdd context; the toggle runs every updateEntryMenuState
  // call so they re-enable automatically on switch to a D64/etc tab.
  var hddContext = (typeof isIde64ContainerView === 'function') && isIde64ContainerView();
  document.getElementById('opt-edit-sector').classList.toggle('disabled', !hasSelection || multiSelect || noEdit || hddContext);
  document.getElementById('opt-edit-file-sector').classList.toggle('disabled', !hasSelection || noEdit || hddContext);
  // GEOS File Info reads the dir entry's GEOS header T/S — CBM-DOS-only;
  // CFS dir entries don't carry that field. Disable across the .hdd
  // context entirely (re-enables on switch to a D64/etc tab).
  document.getElementById('opt-view-geos').classList.toggle('disabled', !geosEnabled || hddContext);
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
        var doff = sectorOffset(dt, ds, getCurrentCtx());
        dt = data2[doff]; ds = data2[doff + 1];
      }
      footerTs.textContent = 'T:$' + dt.toString(16).toUpperCase().padStart(2, '0') +
        ' S:$' + ds.toString(16).toUpperCase().padStart(2, '0');
    } else {
      footerTs.textContent = '';
    }
  }
  if (typeof refreshToolbarState === 'function') refreshToolbarState();

  // ── CFS dir-view overrides ───────────────────────────────────────
  // The toggles above are CBM-DOS-shaped (selectedEntryIndex = byte
  // offset, file-type bits in `entryOff + 2`, etc). Inside a CFS
  // partition selectedEntryIndex is the absolute slot index in
  // cfsDirEntries — so those checks misfire. Re-evaluate the three
  // entry-level options we route through to CFS handlers.
  if (cfsPartitionIdx >= 0 && cfsDirEntries) {
    var cfsEntrySel = (selectedEntryIndex >= 0 && selectedEntryIndex < cfsDirEntries.length)
      ? cfsDirEntries[selectedEntryIndex] : null;
    var cfsHasEntry = !!cfsEntrySel && !cfsEntrySel.empty;
    var cfsIsDeleted = cfsHasEntry && cfsEntrySel.ftype === CFS_FTYPE.DEL;
    // System-managed "<<DELETED FILES>>" entry sits in every CFS
    // partition root and points at the partition's deldir LBA. Protect
    // it the same way DHD protects its SYSTEM partition. The canonical
    // detector lives in ui-ide64.js as _cfsEntryIsDeldirRef and uses the
    // partition entry's cfsDeletedDir pointer — that signal beats name
    // / slot heuristics since neither is guaranteed stable.
    var cfsIsDeldirRef = cfsHasEntry && typeof _cfsEntryIsDeldirRef === 'function' && _cfsEntryIsDeldirRef(cfsEntrySel);
    var cfsEditableEntry = cfsHasEntry && !cfsIsDeleted && !cfsIsDeldirRef;
    // Live data-bearing entry — file content can be read out. Declared
    // up here because half a dozen toggles below depend on it; the
    // previous late-declaration relied on var hoisting and silently
    // disabled View As / View Hex on every CFS render.
    var cfsExportable = cfsHasEntry && !cfsIsDeleted &&
      (cfsEntrySel.ftype === CFS_FTYPE.NORMAL || cfsEntrySel.ftype === CFS_FTYPE.REL);
    // Rename is single-only — both startInlineRenameCfsEntry and the
    // CBM-DOS analogue refuse with multi-select. Disable in multi too.
    document.getElementById('opt-rename').classList.toggle('disabled', !cfsEditableEntry || multiSelect);
    document.getElementById('opt-add-partition').classList.toggle('disabled', false);
    // Scratch: any non-empty, non-already-deleted, non-system entry.
    // Label flips to "Delete Directory" for DIR entries — directory
    // deletes cascade (every child is scratched too), and the label
    // change gives the user a heads-up before they pick the action.
    var cfsScratchEl = document.getElementById('opt-scratch');
    cfsScratchEl.style.display = cfsEditableEntry ? '' : 'none';
    cfsScratchEl.classList.toggle('disabled', !cfsEditableEntry);
    if (cfsHasEntry && cfsEntrySel.ftype === CFS_FTYPE.DIR) {
      cfsScratchEl.textContent = 'Delete Directory';
    } else {
      cfsScratchEl.textContent = 'Scratch File';
    }
    // Unscratch: only on soft-deleted entries; cfsUnscratchEntry verifies
    // bitmap state at click time and aborts cleanly if the data sectors
    // have been reallocated, so the menu item is enabled whenever the
    // entry is in DEL state. Label tracks the original type — a DEL DIR
    // restore is recursive, so it gets a different label so the user
    // knows it'll bring back the directory's contents too.
    var cfsUnscratchEl = document.getElementById('opt-unscratch');
    cfsUnscratchEl.style.display = cfsIsDeleted ? '' : 'none';
    cfsUnscratchEl.classList.toggle('disabled', !cfsIsDeleted);
    if (cfsIsDeleted && cfsEntrySel && cfsEntrySel.typeSuffix === 'DIR') {
      cfsUnscratchEl.textContent = 'Restore Directory';
    } else {
      cfsUnscratchEl.textContent = 'Unscratch File';
    }
    // Change/Set File Size: only meaningful for NORMAL / REL entries —
    // DIR / LNK / DEL have no editable byte-count field (or restoring
    // size on a DEL would just write garbage relative to a freed tree).
    // Override the CBM-DOS gating that left these enabled in CFS view.
    var cfsSizeEditable = cfsEditableEntry &&
      cfsEntrySel.ftype !== CFS_FTYPE.DIR &&
      cfsEntrySel.ftype !== CFS_FTYPE.LNK;
    // opt-block-size is inline DOM-edit on one row (single-only). Set
    // Actual File Size batches via cfsCountFileDataSectors per entry.
    document.getElementById('opt-block-size').classList.toggle('disabled', !cfsSizeEditable || multiSelect);
    document.getElementById('opt-recalc-size').classList.toggle('disabled', !cfsSizeEditable);
    // Name Case: case-flipping the system "<<DELETED FILES>>" entry
    // would break IDEDOS's name-match recognition. Allow only on
    // editable entries.
    document.getElementById('opt-case').classList.toggle('disabled', !cfsEditableEntry);
    // Lock / Splat: handlers route through CFS-aware attr-byte XOR
    // (writeable bit 0x10 for lock, Closed bit 0x80 for splat). Labels
    // flip based on current state so the user sees Lock vs Unlock /
    // Splat vs Unsplat correctly. Splat is refused on DEL entries —
    // scratched files share the not-Closed state and we don't want
    // toggling them to create a weird mid-recovery state.
    var cfsLockEl = document.getElementById('opt-lock');
    var cfsSplatEl = document.getElementById('opt-splat');
    cfsLockEl.style.display = '';
    cfsSplatEl.style.display = '';
    cfsLockEl.classList.toggle('disabled', !cfsEditableEntry);
    cfsSplatEl.classList.toggle('disabled', !cfsEditableEntry || cfsIsDeleted);
    if (cfsHasEntry) {
      var attrByte = cfsEntrySel.attrByte || 0;
      cfsLockEl.textContent = (attrByte & 0x10) ? 'Lock File' : 'Unlock File';
      cfsSplatEl.textContent = (attrByte & 0x80) ? 'Splat File' : 'Unsplat File';
    } else {
      cfsLockEl.textContent = 'Lock File';
      cfsSplatEl.textContent = 'Splat File';
    }
    // File Type submenu: DEL / NORMAL (SEQ/PRG/USR) / REL are valid CFS
    // ftype targets. CBM (5) is disabled (no CBM partition files in CFS).
    // DIR / LNK entries can't change type at all — switching a DIR to a
    // file would orphan its children. Self-ref / deldir-ref are blocked
    // by cfsEditableEntry already.
    var cfsTypeChangeable = cfsEditableEntry &&
      cfsEntrySel.ftype !== CFS_FTYPE.DIR &&
      cfsEntrySel.ftype !== CFS_FTYPE.LNK;
    var cfsTypeEl = document.getElementById('opt-change-type');
    cfsTypeEl.classList.toggle('disabled', !cfsTypeChangeable);
    for (var ti = 0; ti <= 5; ti++) {
      var cfsTypeOpt = document.querySelector('#opt-change-type [data-typeidx="' + ti + '"]');
      if (!cfsTypeOpt) continue;
      var validForCfs = (ti >= 0 && ti <= 4); // CBM (5) not valid
      cfsTypeOpt.classList.toggle('disabled', !validForCfs || !cfsTypeChangeable);
    }
    // Current-type check mark: map CFS ftype + suffix back to a CBM idx.
    var cfsCheckIdx = -1;
    if (cfsHasEntry) {
      if (cfsEntrySel.ftype === CFS_FTYPE.NORMAL) {
        if (cfsEntrySel.typeSuffix === 'SEQ') cfsCheckIdx = 1;
        else if (cfsEntrySel.typeSuffix === 'PRG') cfsCheckIdx = 2;
        else if (cfsEntrySel.typeSuffix === 'USR') cfsCheckIdx = 3;
      } else if (cfsEntrySel.ftype === CFS_FTYPE.REL) {
        cfsCheckIdx = 4;
      } else if (cfsEntrySel.ftype === CFS_FTYPE.DEL) {
        cfsCheckIdx = 0;
      }
    }
    for (var tci = 0; tci <= 5; tci++) {
      var cm = document.getElementById('check-type-' + tci);
      if (cm) cm.innerHTML = (tci === cfsCheckIdx) ? '<i class="fa-solid fa-check"></i>' : '';
    }
    // Edit Track/Sector stays hidden in CFS — raw sector editing exposes
    // the byte-sliced CFS storage layout which isn't a useful UX for
    // end users. View As → Hex shows the de-interleaved file content
    // for the "I want to look at the bytes" case.
    document.getElementById('opt-change-ts').style.display = 'none';
    // Move Up / Move Down: route to moveCfsEntries which respects the
    // self-ref / deldir-ref protected slots and the last-used bound.
    // Disabled when the (sorted) lowest selected slot is already at the
    // first-user position (up) or the highest is at the last-used slot
    // (down). Multi-select supported, same as CBM-DOS.
    var cfsMoveCandidates = [];
    var cfsPicked = selectedEntries.length > 1 ? selectedEntries : [selectedEntryIndex];
    for (var mci = 0; mci < cfsPicked.length; mci++) {
      var mcEnt = cfsDirEntries[cfsPicked[mci]];
      if (!mcEnt || mcEnt.empty) continue;
      if (mcEnt.isSelfRef) continue;
      if (typeof _cfsEntryIsDeldirRef === 'function' && _cfsEntryIsDeldirRef(mcEnt)) continue;
      cfsMoveCandidates.push(cfsPicked[mci]);
    }
    var cfsFirstUserSlot = 0;
    for (var mfu = 0; mfu < cfsDirEntries.length; mfu++) {
      var mfuEnt = cfsDirEntries[mfu];
      if (!mfuEnt) continue;
      if (mfuEnt.isSelfRef) continue;
      if (typeof _cfsEntryIsDeldirRef === 'function' && _cfsEntryIsDeldirRef(mfuEnt)) continue;
      cfsFirstUserSlot = mfu;
      break;
    }
    var cfsLastUsed = -1;
    for (var mlu = cfsDirEntries.length - 1; mlu >= 0; mlu--) {
      if (cfsDirEntries[mlu] && !cfsDirEntries[mlu].empty) { cfsLastUsed = mlu; break; }
    }
    var cfsMoveSorted = cfsMoveCandidates.slice().sort(function(a, b) { return a - b; });
    var cfsCanMoveUp = cfsMoveSorted.length > 0 && cfsMoveSorted[0] > cfsFirstUserSlot;
    var cfsCanMoveDown = cfsMoveSorted.length > 0 &&
                         cfsLastUsed >= 0 &&
                         cfsMoveSorted[cfsMoveSorted.length - 1] < cfsLastUsed;
    document.getElementById('opt-move-up').classList.toggle('disabled', !cfsCanMoveUp);
    document.getElementById('opt-move-down').classList.toggle('disabled', !cfsCanMoveDown);
    // View As submenu: the universal viewers (Hex / Disasm / PETSCII /
    // BASIC / Graphics / TASS) accept a `preloaded` arg that bypasses
    // readFileData, so they all work in CFS via the cfsLoadFileForViewer
    // adapter. Each is gated on a live file/REL entry that has data.
    // BASIC additionally needs the first 2 bytes to be a known load
    // address; Graphics / TASS sniff their own magic at click time.
    // geoWrite / VLIR / REL stay disabled in CFS — they're CBM-DOS
    // GEOS/REL specific and don't apply to CFS content.
    document.getElementById('opt-view-as').classList.toggle('disabled', !cfsExportable);
    document.getElementById('opt-view-hex').classList.toggle('disabled', !cfsExportable);
    document.getElementById('opt-view-disasm').classList.toggle('disabled', !cfsExportable);
    document.getElementById('opt-view-petscii').classList.toggle('disabled', !cfsExportable);
    var cfsBasicEnabled = false;
    if (cfsExportable && cfsEntrySel && cfsEntrySel.dataTreePtr && cfsEntrySel.dataTreePtr.lba) {
      // Peek at the first data sector's first 2 bytes (byte-sliced
      // accessor: byte 0 lives at offset 0, byte 1 at offset 4) to read
      // the load address without fetching the whole file.
      var firstLba = cfsEntrySel.dataTreePtr.addr;
      var firstPtr = _readIde64Pointer(new Uint8Array(hddBuffer), firstLba * 512);
      if (firstPtr && firstPtr.lba && firstPtr.addr > 0) {
        var dBase = firstPtr.addr * 512;
        var dArr = new Uint8Array(hddBuffer);
        if (dBase + 5 <= dArr.length) {
          var loadAddr = dArr[dBase] | (dArr[dBase + 4] << 8);
          cfsBasicEnabled = (typeof BASIC_LOAD_ADDRS === 'object') &&
                            (BASIC_LOAD_ADDRS[loadAddr] !== undefined);
        }
      }
    }
    document.getElementById('opt-view-basic').classList.toggle('disabled', !cfsBasicEnabled);
    document.getElementById('opt-view-gfx').classList.toggle('disabled', !cfsExportable);
    document.getElementById('opt-view-tass').classList.toggle('disabled', !cfsExportable);
    // GEOS / REL-specific viewers stay disabled in CFS — they read
    // CBM-DOS-only fields (GEOS info-block T/S, REL side-sector chain).
    document.getElementById('opt-view-geowrite').classList.add('disabled');
    document.getElementById('opt-view-vlir').classList.add('disabled');
    document.getElementById('opt-view-rel').classList.add('disabled');
    // Remove Entry: hard delete — frees the data sectors (recursive for
    // dirs) and zeros the 32-byte slot. Loses unscratch for the entry,
    // but keeps the bitmap clean. Enabled on any editable entry (DEL
    // entries just get the zero-slot step since their sectors are
    // already free from the original scratch). The dir self-ref is
    // refused at the format layer.
    document.getElementById('opt-remove').classList.toggle('disabled', !cfsEditableEntry && !cfsIsDeleted);
    // Insert Entry: placeholder entry, no data sectors allocated. Only
    // disabled when the dir chain has no free slot (cfsFindEmptyDirSlot
    // checks both truly-empty and DEL-fallback slots, mirroring import).
    var cfsHasFreeSlot = !!cfsFindEmptyDirSlot(hddBuffer, cfsDirLba);
    // Insert / Insert Separator are single-action; disable on multi.
    document.getElementById('opt-insert').classList.toggle('disabled', !cfsHasFreeSlot || multiSelect);
    document.getElementById('opt-insert-sep').classList.toggle('disabled', !cfsHasFreeSlot || multiSelect);
    // File → Import File: dispatches to showCfsImportPicker in CFS view.
    // Same free-slot gate; the CBM-DOS canInsertFile() check at line
    // ~810 would reject every CFS view since currentFormat shape doesn't
    // match.
    document.getElementById('opt-import').classList.toggle('disabled', !cfsHasFreeSlot);
    // Export: live file entries (NORMAL / REL) only — dirs/links/DEL
    // have no data to dump. opt-export-menu is the parent submenu; the
    // CBM-DOS code keeps it disabled outside CBM contexts so override
    // here so the CFS user can reach Export File. (cfsExportable is
    // declared up top so View As / View Hex gating sees the right value.)
    document.getElementById('opt-export').classList.toggle('disabled', !cfsExportable);
    document.getElementById('opt-export-menu').classList.toggle('disabled', !cfsExportable);
    // Copy: NORMAL/REL files OR a DIR entry (recursive tree copy). LNK
    // and the system <<DELETED FILES>> stay disabled — the handler in
    // ui-fileops.js also defensively re-checks those cases.
    var cfsCopyableDir = cfsHasEntry && !cfsIsDeleted && cfsEntrySel.ftype === CFS_FTYPE.DIR && !_cfsEntryIsDeldirRef(cfsEntrySel);
    document.getElementById('opt-copy').classList.toggle('disabled', !(cfsExportable || cfsCopyableDir));
    // Paste: enabled whenever the clipboard has anything and the dir
    // has room (canInsertFile() reads CBM-DOS shape — bypass it here
    // and check the CFS free-slot probe instead).
    document.getElementById('opt-paste').classList.toggle('disabled', clipboard.length === 0 || !cfsHasFreeSlot);
    // Align: handler routes to alignCfsFilename in CFS view. Gate on
    // the same editable-entry flag we use for Rename / Scratch so the
    // system <<DELETED FILES>> entry stays protected.
    document.getElementById('opt-align').classList.toggle('disabled', !cfsEditableEntry);
    // Show-Deleted toggle works the same way in CFS view — keep it
    // enabled whenever the partition view is open.
    document.getElementById('opt-show-deleted').classList.toggle('disabled', false);
    // Run in Emulator: PRG entries only (NORMAL ftype + "PRG" suffix);
    // single-select. The click handler reads via cfsLoadFileForViewer.
    var cfsIsPrg = cfsHasEntry && cfsEntrySel.ftype === CFS_FTYPE.NORMAL &&
                   cfsEntrySel.typeSuffix === 'PRG';
    document.getElementById('opt-run-in-emulator').classList.toggle('disabled', !cfsIsPrg || multiSelect);
    // Save Current as New Separator: in CFS view, picks up the entry's
    // 16-byte name bytes (cfsEntrySel.nameBytes) instead of reading from
    // currentBuffer at a CBM-DOS byte offset. Enabled on any non-empty
    // editable entry.
    document.getElementById('opt-save-sep').classList.toggle('disabled', !cfsEditableEntry);
  }
}

