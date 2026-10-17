// ── Context menu on directory entries ─────────────────────────────────
var contextMenu = document.getElementById('context-menu');

// Shift+Arrow range anchor: the entry offset / slot where extending began.
// Resets on plain Arrow / click / Escape.
var shiftSelectAnchor = -1;
// Same for the partition-list views, whose selection is class-only, so the
// anchor is a row element.
var shiftSelectAnchorRow = null;

// Arrow keys on the CMD container / .hdd partition lists.
function _arrowOnPartitionList(rowsNodeList, dir, isShift) {
  const rows = Array.prototype.slice.call(rowsNodeList);
  if (rows.length === 0) return;
  // Cursor = the selected row furthest in the direction of travel.
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

  // Refresh state first so the clone carries current labels, check marks and
  // disabled/hidden state; ids become data-ctx-for to avoid duplicates.
  updateEntryMenuState();
  var source = document.querySelector('#menu-entry > .menu-dropdown');
  contextMenu.innerHTML = source.innerHTML;
  contextMenu.querySelectorAll('[id]').forEach(function(el) {
    el.setAttribute('data-ctx-for', el.id);
    el.removeAttribute('id');
  });

  // Hide disabled clones: a popup menu only shows what can be actioned right
  // now. The persistent menubar still grays disabled items for discovery.
  hideDisabledContextItems();

  // Submenus open on mouseenter, and on click for touch (where mouseenter
  // is unreliable).
  function openContextSubmenu(item) {
    // Close siblings only, so ancestors of a nested submenu stay open.
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
      // Clicks inside this item's own submenu bubble on to the action
      // handler; only a click on the header toggles.
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
  if (e.key !== 'Escape' || contextMenu.style.display !== 'block') return;
  e.preventDefault(); // keeps the detail pane open
  closeContextMenu();
});

// Right-click on dir entries — and the equivalent long-press on touch.
// Both routes select the targeted entry (or deselect on empty area) and
// then open the context menu at the pointer position.
function tryShowEntryContextMenu(target, x, y) {
  if (!currentBuffer) return false;
  var entry = target.closest('.dir-entry:not(.dir-header-row):not(.dir-parent-row)');
  var dirListing = target.closest('.dir-listing');
  if (!entry && !dirListing) return false;

  // Partition-list rows (CMD / .hdd) use class-only selection. File rows
  // (CFS slot or CBM-DOS offset) keep a multi-selection the click falls
  // inside, otherwise retarget to the clicked row. showContextMenu
  // refreshes the menu state.
  if (entry && (entry.dataset.cmdcPart !== undefined || entry.dataset.hddPart !== undefined)) {
    document.querySelectorAll('.dir-entry.selected').forEach(el => el.classList.remove('selected'));
    entry.classList.add('selected');
  } else if (entry && (entry.dataset.cfsEntry !== undefined || entry.dataset.offset)) {
    var rowIdx = parseInt(entry.dataset.cfsEntry !== undefined ? entry.dataset.cfsEntry : entry.dataset.offset, 10);
    if (selectedEntries.indexOf(rowIdx) < 0) {
      document.querySelectorAll('.dir-entry.selected').forEach(el => el.classList.remove('selected'));
      entry.classList.add('selected');
      selectedEntryIndex = rowIdx;
      selectedEntries = [rowIdx];
    }
  } else {
    document.querySelectorAll('.dir-entry.selected').forEach(el => el.classList.remove('selected'));
    selectedEntryIndex = -1;
    selectedEntries = [];
  }
  showContextMenu(x, y);
  return true;
}

document.getElementById('content').addEventListener('contextmenu', function(e) {
  if (tryShowEntryContextMenu(e.target, e.clientX, e.clientY)) e.preventDefault();
});

// Long-press on touch opens the same menu (iOS Safari doesn't fire
// contextmenu reliably). Moving > 10px cancels, so scrolling still works.
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
    // Swallow the click some browsers still synthesize after a long-press.
    if (fired) {
      e.preventDefault();
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

// Directory-list keyboard shortcuts. Registered once, outside
// bindDirSelection, so re-renders don't stack listeners.
document.addEventListener('keydown', (e) => {
  if (!currentBuffer) return;
  if (openMenu) return; // menu keyboard navigation handles arrow keys
  var ae = document.activeElement;
  if (ae && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA' || ae.tagName === 'SELECT' || ae.isContentEditable)) return;
  var modalOpen = document.getElementById('modal-overlay');
  if (modalOpen && modalOpen.classList.contains('open')) return;
  // AltGr arrives as Ctrl+Alt; it types characters, never a shortcut.
  if (e.ctrlKey && e.altKey && e.getModifierState && e.getModifierState('AltGraph')) return;

  // Enter / F2 renames (double-click opens), on every list view.
  if ((e.key === 'Enter' || e.key === 'F2') && isCmdContainerListView()) {
    var cSelRow = document.querySelector('.dir-entry.selected[data-cmdc-part]');
    if (cSelRow) {
      e.preventDefault();
      var cIdx = parseInt(cSelRow.dataset.cmdcPart, 10);
      var cPart = cmdcPartitions && cmdcPartitions[cIdx];
      if (cPart && !isCmdSystemPartition(cPart)) startRenameEntry(cSelRow);
      return;
    }
  }

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

  // Delete on a partition list goes through the confirming delete helpers.
  if (e.key === 'Delete' && isCmdContainerListView()) {
    var cDel = document.querySelector('.dir-entry.selected[data-cmdc-part]');
    if (cDel) {
      e.preventDefault();
      deleteCmdContainerPartition();
      return;
    }
  }

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

  // Delete = Remove Entry (handles multi-select, partition prompts and undo).
  if (e.key === 'Delete' && selectedEntryIndex >= 0) {
    var rmEl = document.getElementById('opt-remove');
    if (rmEl.classList.contains('disabled')) return;
    e.preventDefault();
    rmEl.click();
    return;
  }

  // Ctrl+Shift+Z: redo. Tested before Ctrl+Z so the shift modifier
  // doesn't fall through to the undo branch.
  if (e.ctrlKey && e.shiftKey && (e.key === 'Z' || e.key === 'z') && currentBuffer) {
    e.preventDefault();
    applyUndoRedo(true);
    return;
  }

  // Ctrl+Z: undo.
  if (e.ctrlKey && !e.shiftKey && e.key === 'z' && currentBuffer) {
    e.preventDefault();
    applyUndoRedo(false);
    return;
  }

  // Ctrl+Y: redo (Windows convention).
  if (e.ctrlKey && !e.shiftKey && e.key === 'y' && currentBuffer) {
    e.preventDefault();
    applyUndoRedo(true);
    return;
  }

  // Ctrl+V: paste file
  if (e.ctrlKey && e.key === 'v') {
    e.preventDefault();
    var pasteEl = document.getElementById('opt-paste');
    if (!pasteEl.classList.contains('disabled')) pasteEl.click();
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
  if (e.ctrlKey && !e.shiftKey && e.key === 'c' && selectedEntryIndex >= 0) {
    e.preventDefault();
    var copyEl = document.getElementById('opt-copy');
    if (!copyEl.classList.contains('disabled')) copyEl.click();
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

  // Ctrl+Alt+E: export (Ctrl+E conflicts with browser search bar).
  // On a CMD container partition list it routes to Export Partition so
  // the same key serves "export the selected thing" everywhere it's
  // available.
  if (e.ctrlKey && e.altKey && e.code === 'KeyE') {
    if (isCmdContainerListView()) {
      e.preventDefault();
      var expPartEl = document.getElementById('opt-cmdc-export-partition');
      if (!expPartEl.classList.contains('disabled')) expPartEl.click();
      return;
    }
    if (selectedEntryIndex >= 0) {
      e.preventDefault();
      var exportEl = document.getElementById('opt-export');
      if (!exportEl.classList.contains('disabled')) exportEl.click();
      return;
    }
  }

  // Ctrl+Shift+L / U / T: name to lower / upper / toggled case (the Ctrl-only
  // keys belong to the browser). Gated on Name Case: tape entries aren't
  // CBM-DOS dir entries, and rewriting their bytes corrupts the directory.
  var caseIds = { KeyL: 'opt-case-lower', KeyU: 'opt-case-upper', KeyT: 'opt-case-toggle' };
  if (e.ctrlKey && e.shiftKey && !e.altKey && caseIds[e.code] && selectedEntryIndex >= 0) {
    e.preventDefault();
    if (!document.getElementById('opt-case').classList.contains('disabled')) {
      document.getElementById(caseIds[e.code]).click();
    }
    return;
  }
  // Ctrl+Shift+D: add directory inside a dir view; new partition on a
  // partition list view. Same key serves "add a new container at this
  // level" in both contexts. (Ctrl+D conflicts with browser bookmark.)
  if (e.ctrlKey && e.shiftKey && !e.altKey && e.code === 'KeyD') {
    var partListView = isCmdContainerListView() ||
      (typeof isIde64ContainerView === 'function' && isIde64ContainerView() && cfsPartitionIdx < 0);
    if (partListView) {
      e.preventDefault();
      var newPartEl = document.getElementById('opt-cmdc-new-partition');
      if (!newPartEl.classList.contains('disabled')) newPartEl.click();
      return;
    }
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
    const allEntriesS = document.querySelectorAll('.dir-entry:not(.dir-header-row):not(.dir-parent-row)');
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
    const allEntries = document.querySelectorAll('.dir-entry:not(.dir-header-row):not(.dir-parent-row)');
    if (allEntries.length === 0) return;

    if (selectedEntryIndex < 0) {
      // Nothing selected — select first or last
      const target = dir === 1 ? allEntries[0] : allEntries[allEntries.length - 1];
      allEntries.forEach(el => el.classList.remove('selected'));
      target.classList.add('selected');
      selectedEntryIndex = parseInt(target.dataset.offset, 10);
      // Action handlers read selectedEntries first, so keep it in sync.
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
  }
});

function updateEntryMenuState() {
  const hasSelection = selectedEntryIndex >= 0 && currentBuffer;
  const multiSelect = selectedEntries.length > 1;
  const inPartition = currentPartition !== null;
  const tape = isTapeFormat(getCurrentCtx());
  // The CMD container partition list isn't a filesystem: no file-level edits.
  const containerList = isCmdContainerListView();
  const noEdit = tape || containerList;
  // Un-hide what the CFS branch below hides, so leaving a CFS view doesn't
  // leave them stuck on display:none.
  ['opt-change-ts', 'opt-scratch', 'opt-unscratch'].forEach(function(id) {
    document.getElementById(id).style.display = '';
  });
  document.getElementById('opt-change-ts').textContent = 'Edit Track/Sector';
  document.getElementById('opt-scratch').textContent = 'Scratch File';
  document.getElementById('opt-unscratch').textContent = 'Unscratch File';
  // Single-select only operations (all disabled for tape / container list)
  document.getElementById('opt-rename').classList.toggle('disabled', !hasSelection || multiSelect || noEdit);
  document.getElementById('opt-insert').classList.toggle('disabled', multiSelect || !currentBuffer || !canInsertFile() || noEdit);
  document.getElementById('opt-insert-sep').classList.toggle('disabled', multiSelect || !currentBuffer || !canInsertFile() || noEdit);
  document.getElementById('opt-block-size').classList.toggle('disabled', !hasSelection || multiSelect || noEdit);
  document.getElementById('opt-change-ts').classList.toggle('disabled', !hasSelection || multiSelect || noEdit);
  document.getElementById('opt-view-as').classList.toggle('disabled', !hasSelection || multiSelect || containerList);
  // Set explicitly here so the CFS branch's overrides don't stick.
  document.getElementById('opt-view-hex').classList.toggle('disabled', !hasSelection || containerList);
  document.getElementById('opt-view-disasm').classList.toggle('disabled', !hasSelection || containerList);
  document.getElementById('opt-view-petscii').classList.toggle('disabled', !hasSelection || containerList);
  var noNesting = inPartition && !currentFormat.subdirLinked; // D81: no nesting; DNP: nesting allowed
  document.getElementById('opt-add-partition').classList.toggle('disabled', multiSelect || noNesting || !currentBuffer || !currentFormat.supportsSubdirs || !canInsertFile() || noEdit);

  // Partition management: shown only on a CMD or IDE64 partition list; the
  // click handlers dispatch per family (ui-cmd.js / ui-ide64.js).
  var cNewBtn = document.getElementById('opt-cmdc-new-partition');
  var cRenBtn = document.getElementById('opt-cmdc-rename-partition');
  var cDelBtn = document.getElementById('opt-cmdc-delete-partition');
  var cAttrBtn = document.getElementById('opt-hdd-partition-attrs');
  var cRestoreBtn = document.getElementById('opt-hdd-partition-restore');
  var cImpBtn = document.getElementById('opt-cmdc-import-partition');
  var cExpBtn = document.getElementById('opt-cmdc-export-partition');
  var cSep1 = document.getElementById('sep-cmdc-partitions');
  var cSep2 = document.getElementById('sep-cmdc-partition-io');
  var hddListView = !containerList && (typeof isIde64ContainerView === 'function') && isIde64ContainerView() && cfsPartitionIdx < 0;
  var partDisplay = (containerList || hddListView) ? '' : 'none';
  cNewBtn.style.display = partDisplay;
  cRenBtn.style.display = partDisplay;
  cDelBtn.style.display = partDisplay;
  // Attributes (HIDDEN / WRITEABLE bits) and Restore are IDE64-only;
  // Import/Export are CMD-only.
  cAttrBtn.style.display = hddListView ? '' : 'none';
  cRestoreBtn.style.display = hddListView ? '' : 'none';
  var ioDisplay = containerList ? '' : 'none';
  cImpBtn.style.display = ioDisplay;
  cExpBtn.style.display = ioDisplay;
  if (cSep1) cSep1.style.display = partDisplay;
  if (cSep2) cSep2.style.display = ioDisplay;
  // Hidden items are disabled too, for the mobile menu and shortcuts.
  [cNewBtn, cRenBtn, cDelBtn, cAttrBtn, cRestoreBtn, cImpBtn, cExpBtn].forEach(function(el) {
    if (el.style.display === 'none') el.classList.add('disabled');
  });
  if (containerList) {
    var listSelEl = document.querySelector('.dir-entry.selected[data-cmdc-part]');
    var selPartIdx = listSelEl ? parseInt(listSelEl.dataset.cmdcPart, 10) : -1;
    var selPart = (selPartIdx >= 0 && cmdcPartitions) ? cmdcPartitions[selPartIdx] : null;
    cNewBtn.classList.toggle('disabled', !canAddCmdContainerPartition());
    var canModify = !!selPart && !isCmdSystemPartition(selPart);
    cRenBtn.classList.toggle('disabled', !canModify);
    cDelBtn.classList.toggle('disabled', !canModify);
    cImpBtn.classList.toggle('disabled', !canAddCmdContainerPartition());
    cExpBtn.classList.toggle('disabled', !selPart || !isCmdExportablePartition(selPart));
  } else if (hddListView) {
    var hddSelEl = document.querySelector('.dir-entry.selected[data-hdd-part]');
    var selHddIdx = hddSelEl ? parseInt(hddSelEl.dataset.hddPart, 10) : -1;
    var selHddPart = (selHddIdx >= 0 && hddPartitions) ? hddPartitions[selHddIdx] : null;
    // Empty and soft-deleted slots are both reusable for a new partition.
    var hasFreeSlot = hddPartitions && hddPartitions.some(function(p) { return p.empty || p.deleted; });
    cNewBtn.classList.toggle('disabled', !hasFreeSlot);
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
    isCbmPartition = currentFormat.supportsSubdirs && pTypeIdx === currentFormat.subdirType;
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
    // DNP subdirs share the image's tracks, so only the root dir track is excluded there.
    var uDirTrack = currentPartition && !currentPartition.dnpDir ? getDirContext().dirTrackNum : currentFormat.dirTrack;
    if (!uClosed && uData[selectedEntryIndex + 3] !== 0 && uData[selectedEntryIndex + 3] !== uDirTrack) {
      var uRecov = checkScratchedRecoverable(currentBuffer, selectedEntryIndex);
      canUnscratch = (uRecov === 'yes' || uRecov === 'partial');
    }
  }
  var scratchEl = document.getElementById('opt-scratch');
  var unscratchEl = document.getElementById('opt-unscratch');
  scratchEl.style.display = canScratch ? '' : 'none';
  scratchEl.classList.toggle('disabled', !canScratch || canScratch === 'locked');
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
    // Copy: regular files, or a subdir/partition (copied as a whole tree).
    var isCopyableSubdir = eClosed && currentFormat && eIdx === currentFormat.subdirType;
    copyEnabled = exportEnabled || isCopyableSubdir;
    prgSelected = eClosed && eIdx === 2;
    var geosTypeName = GEOS_FILE_TYPES[edata[selectedEntryIndex + 0x18]];
    var geosIsVlir = edata[selectedEntryIndex + 0x17] === 0x01;
    var geosIsDocument = geosIsVlir &&
      (geosTypeName === 'Application data' || geosTypeName === 'Write image');
    var isGeosGfx = geosIsDocument ||
      ['Paint image', 'Photo scrap', 'Font file', 'Photo album'].indexOf(geosTypeName) >= 0;
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
    // A geoWrite document is a VLIR document whose class is "Write Image".
    if (eClosed && geosIsDocument) {
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
  // Sector editing and GEOS info are T/S based; an .hdd (CFS, 512-byte
  // LBAs) has neither.
  var hddContext = (typeof isIde64ContainerView === 'function') && isIde64ContainerView();
  document.getElementById('opt-edit-sector').classList.toggle('disabled', !hasSelection || multiSelect || noEdit || hddContext);
  document.getElementById('opt-edit-file-sector').classList.toggle('disabled', !hasSelection || noEdit || hddContext);
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
  // CFS view: selectedEntryIndex is a slot in cfsDirEntries, not a byte
  // offset, so the CBM-DOS checks above misfire and are redone here.
  if (cfsPartitionIdx >= 0 && cfsDirEntries) updateCfsEntryMenuState(multiSelect);
  if (typeof refreshToolbarState === 'function') refreshToolbarState();
}

function updateCfsEntryMenuState(multiSelect) {
  var cfsEntrySel = (selectedEntryIndex >= 0 && selectedEntryIndex < cfsDirEntries.length)
    ? cfsDirEntries[selectedEntryIndex] : null;
  var cfsHasEntry = !!cfsEntrySel && !cfsEntrySel.empty;
  var cfsIsDeleted = cfsHasEntry && cfsEntrySel.ftype === CFS_FTYPE.DEL;
  // The system "<<DELETED FILES>>" entry is protected like DHD's SYSTEM
  // partition.
  var cfsIsDeldirRef = cfsHasEntry && typeof _cfsEntryIsDeldirRef === 'function' && _cfsEntryIsDeldirRef(cfsEntrySel);
  var cfsEditableEntry = cfsHasEntry && !cfsIsDeleted && !cfsIsDeldirRef;
  var cfsExportable = cfsHasEntry && !cfsIsDeleted &&
    (cfsEntrySel.ftype === CFS_FTYPE.NORMAL || cfsEntrySel.ftype === CFS_FTYPE.REL);
  document.getElementById('opt-rename').classList.toggle('disabled', !cfsEditableEntry || multiSelect);
  document.getElementById('opt-add-partition').classList.toggle('disabled', false);
  // DIR deletes cascade to every child, hence the different label.
  var cfsScratchEl = document.getElementById('opt-scratch');
  cfsScratchEl.style.display = cfsEditableEntry ? '' : 'none';
  cfsScratchEl.classList.toggle('disabled', !cfsEditableEntry);
  if (cfsHasEntry && cfsEntrySel.ftype === CFS_FTYPE.DIR) {
    cfsScratchEl.textContent = 'Delete Directory';
  } else {
    cfsScratchEl.textContent = 'Scratch File';
  }
  // Unscratch checks the bitmap itself at click time; a DEL DIR restore
  // is recursive, hence its own label.
  var cfsUnscratchEl = document.getElementById('opt-unscratch');
  cfsUnscratchEl.style.display = cfsIsDeleted ? '' : 'none';
  cfsUnscratchEl.classList.toggle('disabled', !cfsIsDeleted);
  if (cfsIsDeleted && cfsEntrySel && cfsEntrySel.typeSuffix === 'DIR') {
    cfsUnscratchEl.textContent = 'Restore Directory';
  } else {
    cfsUnscratchEl.textContent = 'Unscratch File';
  }
  // DIR / LNK entries have no editable size.
  var cfsSizeEditable = cfsEditableEntry &&
    cfsEntrySel.ftype !== CFS_FTYPE.DIR &&
    cfsEntrySel.ftype !== CFS_FTYPE.LNK;
  document.getElementById('opt-block-size').classList.toggle('disabled', !cfsSizeEditable || multiSelect);
  document.getElementById('opt-recalc-size').classList.toggle('disabled', !cfsSizeEditable);
  document.getElementById('opt-case').classList.toggle('disabled', !cfsEditableEntry);
  // Attr bits: $10 = writeable (so set means unlocked), $80 = closed.
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
  // DEL/SEQ/PRG/USR/REL are valid CFS targets, CBM isn't. A DIR / LNK
  // can't change type (a DIR would orphan its children).
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
  // CFS has no T/S; View As → Hex covers looking at the bytes.
  var cfsTsEl = document.getElementById('opt-change-ts');
  cfsTsEl.style.display = 'none';
  cfsTsEl.classList.add('disabled');
  // Move Up/Down stay between the protected leading slots and the last
  // used slot.
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
  // Generic viewers take preloaded CFS file data; BASIC also needs a known
  // load address.
  document.getElementById('opt-view-as').classList.toggle('disabled', !cfsExportable);
  document.getElementById('opt-view-hex').classList.toggle('disabled', !cfsExportable);
  document.getElementById('opt-view-disasm').classList.toggle('disabled', !cfsExportable);
  document.getElementById('opt-view-petscii').classList.toggle('disabled', !cfsExportable);
  var cfsBasicEnabled = false;
  if (cfsExportable && cfsEntrySel && cfsEntrySel.dataTreePtr && cfsEntrySel.dataTreePtr.lba) {
    // Byte-sliced storage: file bytes 0 and 1 sit at sector offsets 0 and 4.
    var firstLba = cfsEntrySel.dataTreePtr.addr;
    var firstPtr = _readIde64Pointer(new Uint8Array(hddBuffer), firstLba * IDE64_SECTOR_SIZE);
    if (firstPtr && firstPtr.lba && firstPtr.addr > 0) {
      var dBase = firstPtr.addr * IDE64_SECTOR_SIZE;
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
  // GEOS / VLIR / REL viewers and exports read CBM-DOS-only fields.
  ['opt-view-geowrite', 'opt-view-vlir', 'opt-view-rel',
   'opt-export-cvt', 'opt-export-rtf', 'opt-export-pdf', 'opt-export-txt-gw'].forEach(function(id) {
    document.getElementById(id).classList.add('disabled');
  });
  // Remove frees the sectors and zeroes the slot (no unscratch after).
  document.getElementById('opt-remove').classList.toggle('disabled', !cfsEditableEntry && !cfsIsDeleted);
  // canInsertFile() is CBM-DOS-shaped; use the CFS free-slot probe.
  var cfsHasFreeSlot = !!cfsFindEmptyDirSlot(hddBuffer, cfsDirLba);
  document.getElementById('opt-insert').classList.toggle('disabled', !cfsHasFreeSlot || multiSelect);
  document.getElementById('opt-insert-sep').classList.toggle('disabled', !cfsHasFreeSlot || multiSelect);
  document.getElementById('opt-import').classList.toggle('disabled', !cfsHasFreeSlot);
  document.getElementById('opt-export').classList.toggle('disabled', !cfsExportable);
  document.getElementById('opt-export-menu').classList.toggle('disabled', !cfsExportable);
  // Copy: files, or a DIR as a recursive tree.
  var cfsCopyableDir = cfsHasEntry && !cfsIsDeleted && cfsEntrySel.ftype === CFS_FTYPE.DIR && !_cfsEntryIsDeldirRef(cfsEntrySel);
  document.getElementById('opt-copy').classList.toggle('disabled', !(cfsExportable || cfsCopyableDir));
  document.getElementById('opt-paste').classList.toggle('disabled', clipboard.length === 0 || !cfsHasFreeSlot);
  document.getElementById('opt-align').classList.toggle('disabled', !cfsEditableEntry);
  document.getElementById('opt-show-deleted').classList.toggle('disabled', false);
  var cfsIsPrg = cfsHasEntry && cfsEntrySel.ftype === CFS_FTYPE.NORMAL &&
                 cfsEntrySel.typeSuffix === 'PRG';
  document.getElementById('opt-run-in-emulator').classList.toggle('disabled', !cfsIsPrg || multiSelect);
  document.getElementById('opt-save-sep').classList.toggle('disabled', !cfsEditableEntry);
}


// ── Menu ARIA ─────────────────────────────────────────────────────────
// Roles on the static menu markup; aria-disabled follows the .disabled
// class wherever the menu code toggles it (menubar and context menu).
(function initMenuAria() {
  var bar = document.querySelector('.menubar-items');
  if (!bar) return;
  bar.setAttribute('role', 'menubar');
  bar.querySelectorAll('.menu-item').forEach(function(el) { el.setAttribute('role', 'menuitem'); });
  document.querySelectorAll('.menu-dropdown, .submenu').forEach(function(el) { el.setAttribute('role', 'menu'); });
  document.querySelectorAll('.menu-dropdown .option').forEach(function(el) {
    el.setAttribute('role', 'menuitem');
    el.setAttribute('aria-disabled', el.classList.contains('disabled') ? 'true' : 'false');
  });
  var observer = new MutationObserver(function(mutations) {
    mutations.forEach(function(m) {
      var el = m.target;
      if (el.classList && el.classList.contains('option')) {
        el.setAttribute('aria-disabled', el.classList.contains('disabled') ? 'true' : 'false');
      }
    });
  });
  observer.observe(bar, { attributes: true, attributeFilter: ['class'], subtree: true });
  observer.observe(contextMenu, { attributes: true, attributeFilter: ['class'], subtree: true });
})();
