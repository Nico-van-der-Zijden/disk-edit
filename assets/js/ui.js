// ── Modal ─────────────────────────────────────────────────────────────
function showModal(title, lines) {
  document.getElementById('modal-title').textContent = title;
  // Always restore the standard OK footer
  var footer = document.querySelector('#modal-overlay .modal-footer');
  footer.innerHTML = '<button id="modal-close">OK</button>';
  document.getElementById('modal-close').addEventListener('click', function() {
    document.getElementById('modal-overlay').classList.remove('open');
  });
  const body = document.getElementById('modal-body');
  body.innerHTML = '';
  const isSummary = l => l.startsWith('Validation complete') || l.startsWith('Disk is valid');
  const details = lines.filter(l => !isSummary(l));
  const summary = lines.filter(l => isSummary(l));

  if (details.length) {
    const ul = document.createElement('ul');
    for (const line of details) {
      const li = document.createElement('li');
      li.textContent = line.replace(/^\s+/, '');
      if (line.includes('ERROR') || line.includes('corrected') || line.startsWith('Removed')) li.className = 'log-error';
      else if (line.includes('Warning')) li.className = 'log-warning';
      ul.appendChild(li);
    }
    body.appendChild(ul);
  }

  for (const line of summary) {
    const div = document.createElement('div');
    div.textContent = line;
    div.style.marginTop = '12px';
    body.appendChild(div);
  }
  document.getElementById('modal-overlay').classList.add('open');
}

document.getElementById('modal-close').addEventListener('click', () => {
  document.getElementById('modal-overlay').classList.remove('open');
});

// Show a modal with custom buttons, returns a promise resolving to the button value
// Optional items array shows a list below the message
function showChoiceModal(title, message, buttons, items) {
  return new Promise(function(resolve) {
    document.getElementById('modal-title').textContent = title;
    var body = document.getElementById('modal-body');
    body.innerHTML = '';
    var p = document.createElement('div');
    p.textContent = message;
    body.appendChild(p);

    if (items && items.length) {
      var ul = document.createElement('ul');
      ul.style.maxHeight = '150px';
      ul.style.overflowY = 'auto';
      ul.style.margin = '8px 0';
      for (var ii = 0; ii < items.length; ii++) {
        var li = document.createElement('li');
        li.textContent = items[ii];
        ul.appendChild(li);
      }
      body.appendChild(ul);
    }

    var footer = document.querySelector('#modal-overlay .modal-footer');
    footer.innerHTML = '';
    buttons.forEach(function(btn) {
      var el = document.createElement('button');
      el.textContent = btn.label;
      if (btn.secondary) el.className = 'modal-btn-secondary';
      el.addEventListener('click', function() {
        document.getElementById('modal-overlay').classList.remove('open');
        resolve(btn.value);
      });
      footer.appendChild(el);
    });
    document.getElementById('modal-overlay').classList.add('open');
  });
}

document.getElementById('modal-overlay').addEventListener('click', (e) => {
  if (e.target === e.currentTarget) {
    document.getElementById('modal-overlay').classList.remove('open');
  }
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && document.getElementById('modal-overlay').classList.contains('open')) {
    document.getElementById('modal-overlay').classList.remove('open');
  }
});

// ── Input Modal ───────────────────────────────────────────────────────
let inputModalResolve = null;

function showInputModal(title, defaultValue) {
  return new Promise((resolve) => {
    inputModalResolve = resolve;
    document.getElementById('input-modal-title').textContent = title;
    const field = document.getElementById('input-modal-field');
    field.value = defaultValue || '';
    document.getElementById('input-modal-overlay').classList.add('open');
    field.focus();
    field.select();
  });
}

function closeInputModal(value) {
  document.getElementById('input-modal-overlay').classList.remove('open');
  if (inputModalResolve) {
    inputModalResolve(value);
    inputModalResolve = null;
  }
}

document.getElementById('input-modal-ok').addEventListener('click', () => {
  closeInputModal(document.getElementById('input-modal-field').value);
});

document.getElementById('input-modal-cancel').addEventListener('click', () => {
  closeInputModal(null);
});

document.getElementById('input-modal-overlay').addEventListener('click', (e) => {
  if (e.target === e.currentTarget) closeInputModal(null);
});

document.getElementById('input-modal-field').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    closeInputModal(document.getElementById('input-modal-field').value);
  } else if (e.key === 'Escape') {
    e.preventDefault();
    closeInputModal(null);
  }
});

// ── Disable Edge/browser mini menu and context menu ───────────────────
document.addEventListener('contextmenu', e => e.preventDefault());
document.addEventListener('selectstart', e => {
  const el = e.target.nodeType === 3 ? e.target.parentElement : e.target;
  if (el && !el.isContentEditable && !el.closest('.editing') && el.tagName !== 'INPUT' && el.tagName !== 'TEXTAREA') e.preventDefault();
});
if (navigator.userAgent.includes('Edg')) {
  document.addEventListener('pointerup', e => {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
    const sel = window.getSelection();
    if (sel && !e.target.isContentEditable && !e.target.closest('.editing')) sel.removeAllRanges();
  });
}

// ── Render ────────────────────────────────────────────────────────────
function renderDisk(info) {
  const prevSelected = selectedEntryIndex;
  selectedEntryIndex = -1;
  const content = document.getElementById('content');

  // Save scroll position
  const dirListing = content.querySelector('.dir-listing');
  const prevScroll = dirListing ? dirListing.scrollTop : 0;

  let html = `
    <div class="disk-panel${showAddresses ? ' show-addresses' : ''}${showTrackSector ? ' show-tracksector' : ''}">
      <div class="disk-header">
        <div class="disk-header-spacer">0</div>
        <div class="disk-name"><span class="editable" id="edit-name" data-field="name" data-max="${currentFormat.nameLength}">"${escHtml(info.diskName.padEnd(currentFormat.nameLength))}"</span></div>
        <div class="disk-id"><span class="editable" id="edit-id" data-field="id" data-max="${currentFormat.idLength}">${escHtml(info.diskId)}</span></div>
      </div>
      <div class="dir-listing">
        <div class="dir-entry dir-header-row">
          <span class="dir-grip"></span>
          <span class="dir-blocks">Size</span>
          <span class="dir-name">Filename</span>
          <span class="dir-type">Type</span>
          <span class="dir-ts">T/S</span>
          <span class="dir-addr">Address</span>
          <span class="dir-icons"></span>
        </div>`;

  // Show parent directory link when inside a partition
  if (currentPartition) {
    html += `
        <div class="dir-entry dir-parent-row" id="dir-parent">
          <span class="dir-grip"></span>
          <span class="dir-blocks"><i class="fa-solid fa-arrow-left" style="font-size:11px"></i></span>
          <span class="dir-name"><i class="fa-solid fa-folder-open" style="font-size:11px;margin-right:4px"></i>..</span>
          <span class="dir-type"></span>
          <span class="dir-ts"></span>
          <span class="dir-addr"></span>
          <span class="dir-icons"></span>
        </div>`;
  }

  let entries = info.entries.filter(e => !e.deleted || showDeleted);

  for (const e of entries) {
    // Render filename with reversed character support
    const richName = currentBuffer ? readPetsciiRich(new Uint8Array(currentBuffer), e.entryOff + 5, 16) : null;
    let nameHtml;
    if (richName) {
      const nameStr = richName.map(c =>
        c.reversed ? '<span class="petscii-rev">' + escHtml(c.char) + '</span>' : escHtml(c.char)
      ).join('');
      // Closing quote after content, then pad to fill 18 chars total (quote + 16 + quote)
      const pad = Math.max(0, 16 - richName.length);
      nameHtml = '"' + nameStr + '"' + ' '.repeat(pad);
    } else {
      const pad = Math.max(0, 16 - e.name.length);
      nameHtml = '"' + escHtml(e.name) + '"' + ' '.repeat(pad);
    }

    // Get file addresses if showing
    let addrHtml = '';
    if (showAddresses && currentBuffer) {
      const addr = getFileAddresses(currentBuffer, e.entryOff);
      if (addr) {
        const s = '$' + addr.start.toString(16).toUpperCase().padStart(4, '0');
        const en = '$' + addr.end.toString(16).toUpperCase().padStart(4, '0');
        addrHtml = s + '-' + en;
      }
    }

    html += `
        <div class="dir-entry${e.deleted ? ' deleted' : ''}" data-offset="${e.entryOff}" draggable="true">
          <span class="dir-grip"><i class="fa-solid fa-grip-vertical"></i></span>
          <span class="dir-blocks">${e.blocks}</span>
          <span class="dir-name">${nameHtml}</span>
          <span class="dir-type">${escHtml(e.type)}</span>
          <span class="dir-ts">${currentBuffer ? ('$' + new Uint8Array(currentBuffer)[e.entryOff + 3].toString(16).toUpperCase().padStart(2, '0') + ' $' + new Uint8Array(currentBuffer)[e.entryOff + 4].toString(16).toUpperCase().padStart(2, '0')) : ''}</span>
          <span class="dir-addr">${addrHtml}</span>
          <span class="dir-icons">${(function() {
            var icons = '';
            if (!currentBuffer || e.deleted) return icons;
            var d = new Uint8Array(currentBuffer);
            var ft = d[e.entryOff + 2] & 0x07;
            // CBM partition/directory icon
            if (ft === 5) icons += '<span class="dir-icon-partition" data-offset="' + e.entryOff + '" title="Partition — double-click to open"><i class="fa-solid fa-folder"></i></span>';
            // Info icon for files with data
            if (ft >= 1 && ft <= 4 && d[e.entryOff + 3] > 0) icons += '<span class="dir-icon-info" data-offset="' + e.entryOff + '" title="File info"><i class="fa-solid fa-circle-info"></i></span>';
            // GEOS icon
            if (d[e.entryOff + 0x18] > 0) icons += '<span class="dir-icon-geos" data-offset="' + e.entryOff + '" title="GEOS file — click for info"><i class="fa-solid fa-globe"></i></span>';
            return icons;
          })()}</span>
        </div>`;
  }

  html += `
      </div>
      <div class="dir-footer">
        <div class="dir-footer-row">
          <span class="dir-footer-blocks">${info.freeBlocks}</span>
          <span class="dir-footer-label">blocks free.</span>
          <span class="dir-footer-ts" id="footer-ts"></span>
          <span class="dir-footer-tracks">${currentFormat.name} ${currentTracks} tracks</span>
        </div>
      </div>
    </div>`;

  content.innerHTML = html;
  bindEditableFields();
  bindDirSelection();

  // Double-click on blocks free to edit
  const footerBlocks = document.querySelector('.dir-footer-blocks');
  if (footerBlocks) {
    footerBlocks.style.cursor = 'pointer';
    footerBlocks.addEventListener('dblclick', () => {
      startEditFreeBlocks(footerBlocks);
    });
  }

  // Restore scroll position
  const newDirListing = content.querySelector('.dir-listing');
  if (newDirListing) newDirListing.scrollTop = prevScroll;

  // Restore selection
  if (prevSelected >= 0) {
    const el = document.querySelector(`.dir-entry[data-offset="${prevSelected}"]`);
    if (el) {
      el.classList.add('selected');
      selectedEntryIndex = prevSelected;
    }
  }
  updateEntryMenuState();
}

let activeEditEl = null;
let activeEditCleanup = null;

function registerActiveEdit(el, cleanup) {
  activeEditEl = el;
  activeEditCleanup = cleanup;
}

function cancelActiveEdits() {
  if (activeEditEl && activeEditCleanup) {
    activeEditCleanup();
  }
  activeEditEl = null;
  activeEditCleanup = null;
}

function bindDirSelection() {
  const entries = document.querySelectorAll('.dir-entry:not(.dir-header-row)');
  let dragSrcOffset = null;

  entries.forEach(el => {
    // Click to select/deselect
    el.addEventListener('click', (e) => {
      if (e.target.tagName === 'INPUT' || e.target.classList.contains('editing') || e.target.closest('.editing')) return;
      // Partition icon click — navigate into partition
      var partIcon = e.target.closest('.dir-icon-partition');
      if (partIcon) {
        var pOff = parseInt(partIcon.getAttribute('data-offset'), 10);
        enterPartition(pOff);
        return;
      }
      // Info icon click
      var infoIcon = e.target.closest('.dir-icon-info');
      if (infoIcon) {
        var infoOff = parseInt(infoIcon.getAttribute('data-offset'), 10);
        selectedEntryIndex = infoOff;
        entries.forEach(ent => ent.classList.remove('selected'));
        el.classList.add('selected');
        updateEntryMenuState();
        showFileInfo(infoOff);
        return;
      }
      // GEOS icon click
      var geosIcon = e.target.closest('.dir-icon-geos');
      if (geosIcon) {
        var geosOff = parseInt(geosIcon.getAttribute('data-offset'), 10);
        selectedEntryIndex = geosOff;
        entries.forEach(ent => ent.classList.remove('selected'));
        el.classList.add('selected');
        updateEntryMenuState();
        document.getElementById('opt-view-geos').click();
        return;
      }
      cancelActiveEdits();
      const wasSelected = el.classList.contains('selected');
      entries.forEach(e => e.classList.remove('selected'));
      if (wasSelected) {
        selectedEntryIndex = -1;
      } else {
        el.classList.add('selected');
        selectedEntryIndex = parseInt(el.dataset.offset, 10);
      }
      updateEntryMenuState();
    });

    // Double-click to edit (or navigate into partition)
    el.addEventListener('dblclick', (e) => {
      // Check if this is a CBM partition — navigate into it
      var entryOff = parseInt(el.dataset.offset, 10);
      if (currentBuffer && !currentPartition) {
        var d = new Uint8Array(currentBuffer);
        var tb = d[entryOff + 2];
        if ((tb & 0x87) === 0x85) { // closed CBM type
          enterPartition(entryOff);
          return;
        }
      }
      if (e.target.classList.contains('dir-type')) {
        showTypeDropdown(e.target, entryOff);
      } else if (e.target.classList.contains('dir-blocks')) {
        startEditBlockSize(el);
      } else if (e.target.classList.contains('dir-ts')) {
        startEditTrackSector(el);
      } else {
        startRenameEntry(el);
      }
    });

    // Drag and drop
    el.addEventListener('dragstart', (e) => {
      dragSrcOffset = parseInt(el.dataset.offset, 10);
      el.classList.add('dragging');
      e.dataTransfer.effectAllowed = 'move';
    });

    el.addEventListener('dragend', () => {
      el.classList.remove('dragging');
      entries.forEach(e => { e.classList.remove('drag-over-top', 'drag-over-bottom'); });
      dragSrcOffset = null;
    });

    el.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      entries.forEach(e => { e.classList.remove('drag-over-top', 'drag-over-bottom'); });
      const rect = el.getBoundingClientRect();
      const midY = rect.top + rect.height / 2;
      if (e.clientY < midY) {
        el.classList.add('drag-over-top');
      } else {
        el.classList.add('drag-over-bottom');
      }
    });

    el.addEventListener('dragleave', () => {
      el.classList.remove('drag-over-top', 'drag-over-bottom');
    });

    el.addEventListener('drop', (e) => {
      e.preventDefault();
      entries.forEach(e => { e.classList.remove('drag-over-top', 'drag-over-bottom'); });
      if (dragSrcOffset === null || !currentBuffer) return;

      const targetOffset = parseInt(el.dataset.offset, 10);
      if (dragSrcOffset === targetOffset) return;

      const slots = getDirSlotOffsets(currentBuffer);
      const srcIdx = slots.indexOf(dragSrcOffset);
      let targetIdx = slots.indexOf(targetOffset);
      if (srcIdx < 0 || targetIdx < 0) return;

      // Determine if dropping above or below
      const rect = el.getBoundingClientRect();
      const midY = rect.top + rect.height / 2;
      if (e.clientY >= midY && targetIdx < srcIdx) targetIdx++;
      else if (e.clientY < midY && targetIdx > srcIdx) targetIdx--;

      // Move by repeatedly swapping adjacent entries
      const dir = targetIdx > srcIdx ? 1 : -1;
      let cur = srcIdx;
      while (cur !== targetIdx) {
        swapDirEntries(currentBuffer, slots[cur], slots[cur + dir]);
        cur += dir;
      }

      selectedEntryIndex = slots[targetIdx];
      const info = parseCurrentDir(currentBuffer);
      renderDisk(info);
    });
  });

  // Parent directory row — click to go back to root
  var parentRow = document.getElementById('dir-parent');
  if (parentRow) {
    parentRow.addEventListener('click', () => leavePartition());
    parentRow.addEventListener('dblclick', () => leavePartition());
  }
}

// ── Partition navigation ──────────────────────────────────────────────
function enterPartition(entryOff) {
  if (!currentBuffer) return;
  var data = new Uint8Array(currentBuffer);
  var startTrack = data[entryOff + 3];
  var startSector = data[entryOff + 4];
  var partSize = data[entryOff + 30] | (data[entryOff + 31] << 8);
  var name = petsciiToReadable(readPetsciiString(data, entryOff + 5, 16)).trim();

  // Validate: partition must start at sector 0 and be a valid size
  if (startSector !== 0) {
    showModal('Partition Error', ['Partition does not start at sector 0 (not a subdirectory).']);
    return;
  }
  if (partSize < 120 || partSize % 40 !== 0) {
    showModal('Partition Error', ['Invalid partition size (' + partSize + ' sectors). Must be at least 120 and a multiple of 40.']);
    return;
  }

  // Check that the partition header looks formatted
  var headerOff = sectorOffset(startTrack, 0);
  if (headerOff < 0) {
    showModal('Partition Error', ['Invalid partition start track ' + startTrack + '.']);
    return;
  }

  currentPartition = { entryOff: entryOff, startTrack: startTrack, partSize: partSize, name: name };
  selectedEntryIndex = -1;

  var info = parsePartition(currentBuffer, startTrack, partSize);
  if (!info) {
    currentPartition = null;
    showModal('Partition Error', ['Failed to parse partition directory.']);
    return;
  }
  renderDisk(info);
}

function leavePartition() {
  currentPartition = null;
  selectedEntryIndex = -1;
  var info = parseDisk(currentBuffer);
  renderDisk(info);
}

// ── Context menu on directory entries ─────────────────────────────────
var contextMenu = document.getElementById('context-menu');

function closeContextMenu() {
  contextMenu.style.display = 'none';
  contextMenu.innerHTML = '';
}

function showContextMenu(x, y) {
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

// Right-click on dir entries
document.getElementById('content').addEventListener('contextmenu', function(e) {
  // Only show context menu when a disk is loaded
  if (!currentBuffer) return;

  var entry = e.target.closest('.dir-entry:not(.dir-header-row):not(.dir-parent-row)');
  var dirListing = e.target.closest('.dir-listing');
  if (!entry && !dirListing) return;
  e.preventDefault();

  if (entry && entry.dataset.offset) {
    // Right-click on a file entry — select it
    var offset = parseInt(entry.dataset.offset, 10);
    if (selectedEntryIndex !== offset) {
      document.querySelectorAll('.dir-entry.selected').forEach(el => el.classList.remove('selected'));
      entry.classList.add('selected');
      selectedEntryIndex = offset;
      updateEntryMenuState();
    }
  } else {
    // Right-click on empty area — deselect
    document.querySelectorAll('.dir-entry.selected').forEach(el => el.classList.remove('selected'));
    selectedEntryIndex = -1;
    updateEntryMenuState();
  }

  showContextMenu(e.clientX, e.clientY);
});

// Click outside dir entries deselects (registered once)
document.addEventListener('click', (e) => {
  if (!e.target.closest('.dir-entry') && !e.target.closest('.menu-item') && !e.target.closest('.petscii-picker') && !e.target.closest('.type-dropdown') && !e.target.closest('#context-menu')) {
    document.querySelectorAll('.dir-entry.selected').forEach(el => el.classList.remove('selected'));
    selectedEntryIndex = -1;
    updateEntryMenuState();
  }
});

// Keyboard: Arrow Up/Down to select, Ctrl+Arrow to move entry
// Registered once outside bindDirSelection to avoid stacking listeners
document.addEventListener('keydown', (e) => {
  if (!currentBuffer) return;
  if (document.activeElement && (document.activeElement.tagName === 'INPUT' || document.activeElement.isContentEditable)) return;

  // Enter: edit selected filename
  if (e.key === 'Enter' && selectedEntryIndex >= 0) {
    e.preventDefault();
    const selected = document.querySelector('.dir-entry.selected');
    if (selected) startRenameEntry(selected);
    return;
  }

  // Delete: remove selected entry
  if (e.key === 'Delete' && selectedEntryIndex >= 0 && currentBuffer) {
    e.preventDefault();
    const slots = getDirSlotOffsets(currentBuffer);
    const idx = slots.indexOf(selectedEntryIndex);
    removeFileEntry(currentBuffer, selectedEntryIndex);
    const info = parseCurrentDir(currentBuffer);
    // Select next entry, or previous if at end
    const visibleEntries = info.entries.filter(en => !en.deleted || showDeleted);
    if (visibleEntries.length > 0) {
      const newIdx = Math.min(idx, visibleEntries.length - 1);
      selectedEntryIndex = visibleEntries[newIdx].entryOff;
    } else {
      selectedEntryIndex = -1;
    }
    renderDisk(info);
    return;
  }

  // Ctrl+C: copy file
  if (e.ctrlKey && e.key === 'c' && selectedEntryIndex >= 0 && currentBuffer) {
    e.preventDefault();
    document.getElementById('opt-copy').click();
    return;
  }

  // Ctrl+V: paste file
  if (e.ctrlKey && e.key === 'v' && clipboard && currentBuffer) {
    e.preventDefault();
    document.getElementById('opt-paste').click();
    return;
  }

  if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
  e.preventDefault();

  const dir = e.key === 'ArrowUp' ? -1 : 1;

  if (e.ctrlKey && selectedEntryIndex >= 0) {
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
        allEntries[newIdx].scrollIntoView({ block: 'nearest' });
      }
    }
    updateEntryMenuState();
  }
});

function updateEntryMenuState() {
  const hasSelection = selectedEntryIndex >= 0 && currentBuffer;
  const inPartition = currentPartition !== null;
  // Most editing is disabled inside a partition (read-only view)
  document.getElementById('opt-rename').classList.toggle('disabled', !hasSelection);
  document.getElementById('opt-insert').classList.toggle('disabled', !currentBuffer || !canInsertFile());
  document.getElementById('opt-insert-sep').classList.toggle('disabled', !currentBuffer || !canInsertFile());
  document.getElementById('opt-remove').classList.toggle('disabled', !hasSelection);
  document.getElementById('opt-align').classList.toggle('disabled', !hasSelection);
  document.getElementById('opt-block-size').classList.toggle('disabled', !hasSelection);
  document.getElementById('opt-recalc-size').classList.toggle('disabled', !hasSelection);
  document.getElementById('opt-lock').classList.toggle('disabled', !hasSelection);
  document.getElementById('opt-splat').classList.toggle('disabled', !hasSelection);
  document.getElementById('opt-change-type').classList.toggle('disabled', !hasSelection);
  // Disable file types not supported by the current format
  var supportedTypes = currentFormat.fileTypes || [0, 1, 2, 3, 4];
  for (var ti = 0; ti <= 5; ti++) {
    var typeEl = document.querySelector('[data-typeidx="' + ti + '"]');
    if (typeEl) typeEl.classList.toggle('disabled', supportedTypes.indexOf(ti) < 0);
  }
  document.getElementById('opt-view-as').classList.toggle('disabled', !hasSelection);
  // Copy: enabled for closed file types 1-4 (same as export)
  // Paste: enabled when clipboard has data and disk has room
  var exportEnabled = false;
  var copyEnabled = false;
  var basicEnabled = false;
  var gfxEnabled = false;
  if (hasSelection) {
    var edata = new Uint8Array(currentBuffer);
    var eType = edata[selectedEntryIndex + 2];
    var eClosed = (eType & 0x80) !== 0;
    var eIdx = eType & 0x07;
    exportEnabled = eClosed && eIdx >= 1 && eIdx <= 4;
    copyEnabled = exportEnabled;
    // Graphics: enabled for closed PRG files with data
    gfxEnabled = eClosed && eIdx === 2 && edata[selectedEntryIndex + 3] > 0;
    // BASIC: PRG file — check first 2 bytes (load address) from first data sector
    if (eClosed && eIdx === 2) {
      var ft = edata[selectedEntryIndex + 3];
      var fs = edata[selectedEntryIndex + 4];
      if (ft > 0) {
        var foff = sectorOffset(ft, fs);
        if (foff >= 0) {
          var addr = edata[foff + 2] | (edata[foff + 3] << 8); // first 2 data bytes
          basicEnabled = BASIC_LOAD_ADDRS[addr] !== undefined;
        }
      }
    }
  }
  document.getElementById('opt-export').classList.toggle('disabled', !exportEnabled);
  document.getElementById('opt-copy').classList.toggle('disabled', !copyEnabled);
  document.getElementById('opt-paste').classList.toggle('disabled', !clipboard || !currentBuffer || !canInsertFile());
  document.getElementById('opt-view-basic').classList.toggle('disabled', !basicEnabled);
  document.getElementById('opt-view-gfx').classList.toggle('disabled', !gfxEnabled);
  document.getElementById('opt-import').classList.toggle('disabled', !currentBuffer || !canInsertFile());
  document.getElementById('opt-add-partition').classList.toggle('disabled', inPartition || !currentBuffer || currentFormat !== DISK_FORMATS.d81 || !canInsertFile());
  document.getElementById('opt-edit-sector').classList.toggle('disabled', !hasSelection);
  document.getElementById('opt-edit-file-sector').classList.toggle('disabled', !hasSelection);

  // GEOS info — enabled when selected entry has GEOS file type
  var geosEnabled = false;
  if (hasSelection) {
    var gdata = new Uint8Array(currentBuffer);
    geosEnabled = gdata[selectedEntryIndex + 0x18] > 0;
  }
  document.getElementById('opt-view-geos').classList.toggle('disabled', !geosEnabled);
  const lockEl = document.getElementById('opt-lock');
  const splatEl = document.getElementById('opt-splat');
  if (hasSelection) {
    const data = new Uint8Array(currentBuffer);
    const typeByte = data[selectedEntryIndex + 2];
    const closed = (typeByte & 0x80) !== 0;
    const locked = (typeByte & 0x40) !== 0;
    const currentTypeIdx = typeByte & 0x07;
    lockEl.textContent = locked ? 'Unlock File' : 'Lock File';
    splatEl.textContent = closed ? 'Scratch File' : 'Unscratch File';
    for (let i = 0; i < 6; i++) {
      document.getElementById('check-type-' + i).innerHTML = i === currentTypeIdx ? '<i class="fa-solid fa-check"></i>' : '';
    }
  } else {
    lockEl.textContent = 'Lock File';
    splatEl.textContent = 'Scratch File';
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

// ── Inline editing ────────────────────────────────────────────────────
function bindEditableFields() {
  document.querySelectorAll('.editable').forEach(el => {
    el.addEventListener('dblclick', () => startEditing(el));
  });
}

function startEditing(el) {
  if (el.classList.contains('editing')) return;
  if (el.querySelector('input')) return;
  cancelActiveEdits();
  const field = el.dataset.field;
  const maxLen = parseInt(el.dataset.max, 10);
  // Read actual content from buffer (stops at 0xA0 padding)
  let currentValue = '';
  if (currentBuffer) {
    const data = new Uint8Array(currentBuffer);
    var headerOff = getHeaderOffset();
    if (field === 'name') currentValue = readPetsciiString(data, headerOff + currentFormat.nameOffset, currentFormat.nameLength);
    else if (field === 'id') currentValue = readPetsciiString(data, headerOff + currentFormat.idOffset, currentFormat.idLength, false);
  } else {
    const isEmpty = el.classList.contains('empty');
    currentValue = isEmpty ? '' : el.textContent;
  }

  const input = document.createElement('input');
  input.type = 'text';
  input.maxLength = maxLen;
  input.value = currentValue;
  input.className = 'header-input';
  input.style.width = (maxLen + 1) + 'ch';

  el.textContent = '';
  el.appendChild(input);
  el.classList.add('editing');
  el.classList.remove('empty');
  trackCursorPos(input);
  input.focus();
  input.selectionStart = input.selectionEnd = currentValue.length;

  showPetsciiPicker(input, maxLen);

  function setDisplay(value) {
    el.classList.remove('empty');
    if (field === 'name') {
      el.textContent = '"' + value.padEnd(16) + '"';
    } else {
      el.textContent = value;
    }
  }

  let reverted = false;

  function cleanup() {
    el.classList.remove('editing');
    hidePetsciiPicker();
  }

  function commitEdit() {
    if (reverted) return;
    let value = filterC64Input(input.value, maxLen);
    if (currentBuffer) {
      if (field === 'name') writeDiskName(currentBuffer, value, input._petsciiOverrides);
      else if (field === 'id') writeDiskId(currentBuffer, value, input._petsciiOverrides);
    }
    cleanup();
    setDisplay(value);
  }

  function revert() {
    reverted = true;
    cleanup();
    setDisplay(currentValue);
  }

  input.addEventListener('blur', () => {
    if (pickerClicking) { input.focus(); input.selectionStart = input.selectionEnd = input._lastCursorPos || 0; return; }
    commitEdit();
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); commitEdit(); }
    else if (e.key === 'Escape') { e.preventDefault(); revert(); }
  });
}

// escHtml is defined in cbm-format.js

// ── Save helpers ──────────────────────────────────────────────────────
function downloadD64(buffer, fileName) {
  const blob = new Blob([buffer], { type: 'application/octet-stream' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = fileName;
  a.click();
  URL.revokeObjectURL(a.href);
}

function updateMenuState() {
  const hasDisk = currentBuffer !== null;
  document.getElementById('opt-close').classList.toggle('disabled', !hasDisk);
  document.getElementById('opt-save').classList.toggle('disabled', !hasDisk || !currentFileName);
  document.getElementById('opt-save-as').classList.toggle('disabled', !hasDisk);
  document.getElementById('opt-validate').classList.toggle('disabled', !hasDisk);
  document.getElementById('opt-show-deleted').classList.toggle('disabled', !hasDisk);
  document.getElementById('opt-sort').classList.toggle('disabled', !hasDisk);
  document.getElementById('opt-edit-free').classList.toggle('disabled', !hasDisk);
  document.getElementById('opt-recalc-free').classList.toggle('disabled', !hasDisk);
  document.getElementById('opt-view-bam').classList.toggle('disabled', !hasDisk);
  document.getElementById('opt-view-errors').classList.toggle('disabled', !hasDisk || !hasErrorBytes(currentBuffer));
  document.getElementById('opt-convert-geos').classList.toggle('disabled', !hasDisk || hasGeosSignature(currentBuffer));
  document.getElementById('opt-scan-orphans').classList.toggle('disabled', !hasDisk);
  document.getElementById('opt-fill-free').classList.toggle('disabled', !hasDisk);
}

// ── Menu logic ────────────────────────────────────────────────────────
const fileInput = document.getElementById('file-input');
let openMenu = null;

function closeMenus() {
  document.querySelectorAll('.menu-item').forEach(m => m.classList.remove('open'));
  document.querySelector('.menubar').classList.remove('menu-active');
  openMenu = null;
}

document.querySelectorAll('.menu-item').forEach(menu => {
  menu.addEventListener('click', (e) => {
    e.stopPropagation();
    if (openMenu === menu) {
      closeMenus();
    } else {
      closeMenus();
      menu.classList.add('open');
      document.querySelector('.menubar').classList.add('menu-active');
      openMenu = menu;
    }
  });
  menu.addEventListener('mouseenter', () => {
    if (openMenu && openMenu !== menu) {
      openMenu.classList.remove('open');
      menu.classList.add('open');
      openMenu = menu;
    }
  });
});

document.addEventListener('click', () => {
  closeMenus();
});

// ── Tab bar rendering ────────────────────────────────────────────────
function renderTabs() {
  var bar = document.getElementById('tab-bar');
  var html = '';
  for (var i = 0; i < tabs.length; i++) {
    var t = tabs[i];
    html += '<div class="tab' + (t.id === activeTabId ? ' active' : '') + '" data-tab-id="' + t.id + '">' +
      '<span class="tab-name" title="' + escHtml(t.name) + '">' + escHtml(t.name) + '</span>' +
      '<span class="tab-close" data-tab-close="' + t.id + '"><i class="fa-solid fa-xmark"></i></span>' +
    '</div>';
  }
  bar.innerHTML = html;

  // Tab click handlers
  bar.querySelectorAll('.tab').forEach(function(el) {
    el.addEventListener('click', function(e) {
      if (e.target.closest('.tab-close')) return;
      switchToTab(parseInt(el.dataset.tabId, 10));
    });
  });
  bar.querySelectorAll('.tab-close').forEach(function(el) {
    el.addEventListener('click', function(e) {
      e.stopPropagation();
      closeTab(parseInt(el.dataset.tabClose, 10));
    });
  });
}

document.querySelectorAll('#opt-new .submenu .option').forEach(el => {
  el.addEventListener('click', (e) => {
    e.stopPropagation();
    closeMenus();
    saveActiveTab();
    const tracks = parseInt(el.dataset.tracks, 10);
    const formatKey = el.dataset.format || 'd64';
    const buf = createEmptyDisk(formatKey, tracks);
    currentBuffer = buf;
    currentFileName = null;
    currentPartition = null;
    selectedEntryIndex = -1;
    newDiskCount++;
    var tab = createTab('New Disk ' + newDiskCount, buf, null);
    activeTabId = tab.id;
    const info = parseDisk(buf);
    renderDisk(info);
    renderTabs();
    updateMenuState();
  });
});

document.getElementById('opt-open').addEventListener('click', (e) => {
  e.stopPropagation();
  closeMenus();
  fileInput.click();
});

document.getElementById('opt-close').addEventListener('click', (e) => {
  e.stopPropagation();
  if (!currentBuffer) return;
  closeMenus();
  if (activeTabId !== null) {
    closeTab(activeTabId);
  }
});

document.getElementById('opt-save').addEventListener('click', (e) => {
  e.stopPropagation();
  if (!currentBuffer || !currentFileName) return;
  closeMenus();
  downloadD64(currentBuffer, currentFileName);
});

document.getElementById('opt-save-as').addEventListener('click', async (e) => {
  e.stopPropagation();
  if (!currentBuffer) return;
  closeMenus();
  const ext = currentFormat.ext || '.d64';
  const defaultName = currentFileName || ('disk' + ext);
  const fileName = await showInputModal('Save As', defaultName);
  if (!fileName) return;
  currentFileName = fileName.endsWith(ext) ? fileName : fileName + ext;
  downloadD64(currentBuffer, currentFileName);
  updateTabName();
  updateMenuState();
});

document.getElementById('opt-validate').addEventListener('click', (e) => {
  e.stopPropagation();
  if (!currentBuffer) return;
  closeMenus();
  var log;
  if (currentPartition) {
    log = validatePartition(currentBuffer, currentPartition.startTrack, currentPartition.partSize);
  } else {
    log = validateD64(currentBuffer);
  }
  const info = parseCurrentDir(currentBuffer);
  renderDisk(info);
  showModal('Validate', log);
});

document.getElementById('opt-show-deleted').addEventListener('click', (e) => {
  e.stopPropagation();
  if (!currentBuffer) return;
  closeMenus();
  showDeleted = !showDeleted;
  localStorage.setItem('d64-showDeleted', showDeleted);
  document.getElementById('check-deleted').innerHTML = showDeleted ? '<i class="fa-solid fa-check"></i>' : '';
  const info = parseCurrentDir(currentBuffer);
  renderDisk(info);
});

// ── Disk menu: Scan for Lost Files ───────────────────────────────────
document.getElementById('opt-scan-orphans').addEventListener('click', async function(e) {
  e.stopPropagation();
  if (!currentBuffer) return;
  closeMenus();

  var results = scanOrphanedChains(currentBuffer);

  if (results.length === 0) {
    showModal('Scan for Lost Files', ['No lost files found.']);
    return;
  }

  // Build modal content
  document.getElementById('modal-title').textContent = 'Scan for Lost Files';
  var body = document.getElementById('modal-body');
  body.innerHTML = '';

  var summary = document.createElement('div');
  summary.textContent = 'Found ' + results.length + ' lost file(s):';
  summary.style.marginBottom = '12px';
  body.appendChild(summary);

  var list = document.createElement('div');

  for (var ri = 0; ri < results.length; ri++) {
    (function(r, idx) {
      var card = document.createElement('div');
      card.style.cssText = 'border:1px solid var(--border);border-radius:4px;padding:10px;margin-bottom:8px;';

      var typeStr = r.suggestedType;
      if (r.suggestedType === 'PRG' && r.loadAddress !== null) {
        typeStr += ' ($' + r.loadAddress.toString(16).toUpperCase().padStart(4, '0') + ')';
      }

      var integrityIcon = '';
      if (r.integrity === 'ok') integrityIcon = '<span style="color:#4c4">&#10003;</span> ';
      else if (r.integrity === 'broken') integrityIcon = '<span style="color:#ca4">&#9888;</span> ';
      else integrityIcon = '<span style="color:#c44">&#9888;</span> ';

      card.innerHTML =
        '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">' +
          '<strong>#' + (idx + 1) + '</strong>' +
          '<span style="font-size:12px;color:var(--text-muted)">' + integrityIcon + r.integrity + '</span>' +
        '</div>' +
        '<div style="font-size:12px;margin-bottom:6px">' +
          'Start: T:$' + r.startTrack.toString(16).toUpperCase().padStart(2, '0') +
          ' S:$' + r.startSector.toString(16).toUpperCase().padStart(2, '0') +
          ' &mdash; ' + r.sectors.length + ' block(s), ' + r.dataSize + ' bytes' +
          ' &mdash; ' + typeStr +
        '</div>' +
        '<div style="display:flex;gap:6px"></div>';

      var btnRow = card.lastElementChild;

      var exportBtn = document.createElement('button');
      exportBtn.textContent = 'Export';
      exportBtn.style.cssText = 'font-size:12px;padding:3px 12px;cursor:pointer;border:1px solid var(--border);border-radius:3px;background:var(--hover);color:var(--text);';
      exportBtn.addEventListener('click', function() {
        var ext = r.suggestedType === 'PRG' ? '.prg' : r.suggestedType === 'SEQ' ? '.seq' : '.bin';
        var blob = new Blob([r.data], { type: 'application/octet-stream' });
        var a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = 'recovered_' + String(idx + 1).padStart(3, '0') + ext;
        a.click();
        URL.revokeObjectURL(a.href);
      });
      btnRow.appendChild(exportBtn);

      var restoreBtn = document.createElement('button');
      restoreBtn.textContent = 'Restore';
      restoreBtn.style.cssText = 'font-size:12px;padding:3px 12px;cursor:pointer;border:1px solid var(--border);border-radius:3px;background:var(--hover);color:var(--text);';
      restoreBtn.addEventListener('click', async function() {
        document.getElementById('modal-overlay').classList.remove('open');
        var name = await showInputModal('Filename for Recovered File', 'RECOVERED');
        if (!name) return;
        name = name.toUpperCase().substring(0, 16);

        var typeIdx = r.suggestedType === 'PRG' ? 2 : r.suggestedType === 'SEQ' ? 1 : 3;

        var snapshot = currentBuffer.slice(0);
        var entryOff = findFreeDirEntry(currentBuffer);
        if (entryOff < 0) {
          currentBuffer = snapshot;
          showModal('Restore Error', ['No free directory entry available.']);
          return;
        }

        var wd = new Uint8Array(currentBuffer);
        // File type: closed
        wd[entryOff + 2] = 0x80 | typeIdx;
        // First track/sector
        wd[entryOff + 3] = r.startTrack;
        wd[entryOff + 4] = r.startSector;
        // Filename
        for (var ni = 0; ni < 16; ni++) {
          if (ni < name.length) {
            var ch = name.charCodeAt(ni);
            if (ch >= 0x41 && ch <= 0x5A) wd[entryOff + 5 + ni] = ch;
            else if (ch >= 0x30 && ch <= 0x39) wd[entryOff + 5 + ni] = ch;
            else if (ch === 0x20) wd[entryOff + 5 + ni] = 0x20;
            else wd[entryOff + 5 + ni] = 0x20;
          } else {
            wd[entryOff + 5 + ni] = 0xA0;
          }
        }
        // Clear unused
        for (var ui = 21; ui < 30; ui++) wd[entryOff + ui] = 0x00;
        // Block count
        wd[entryOff + 30] = r.sectors.length & 0xFF;
        wd[entryOff + 31] = (r.sectors.length >> 8) & 0xFF;

        // Mark chain sectors as allocated in BAM
        var ctx = getDirContext();
        var bamOff = ctx.bamOff;
        for (var si = 0; si < r.sectors.length; si++) {
          bamMarkSectorUsed(wd, r.sectors[si].t, r.sectors[si].s, bamOff);
        }

        selectedEntryIndex = entryOff;
        var info = parseCurrentDir(currentBuffer);
        renderDisk(info);
        updateMenuState();
        showModal('File Restored', ['"' + name + '" restored with ' + r.sectors.length + ' block(s).']);
      });
      btnRow.appendChild(restoreBtn);

      list.appendChild(card);
    })(results[ri], ri);
  }

  body.appendChild(list);

  // Set footer to just OK
  var footer = document.querySelector('#modal-overlay .modal-footer');
  footer.innerHTML = '<button id="modal-close">OK</button>';
  document.getElementById('modal-close').addEventListener('click', function() {
    document.getElementById('modal-overlay').classList.remove('open');
  });
  document.getElementById('modal-overlay').classList.add('open');
});

document.querySelectorAll('#opt-sort .submenu .option').forEach(el => {
  el.addEventListener('click', (e) => {
    e.stopPropagation();
    if (!currentBuffer) return;
    closeMenus();
    sortDirectory(currentBuffer, el.dataset.sort);
    const info = parseCurrentDir(currentBuffer);
    renderDisk(info);
  });
});

// ── View menu ─────────────────────────────────────────────────────────
document.getElementById('opt-charset-mode').addEventListener('click', (e) => {
  e.stopPropagation();
  closeMenus();
  var newMode = charsetMode === 'uppercase' ? 'lowercase' : 'uppercase';
  setCharsetMode(newMode);
  document.getElementById('opt-charset-mode').textContent = newMode === 'lowercase' ? 'Switch to Uppercase' : 'Switch to Lowercase';
  buildSepSubmenu();
  if (currentBuffer) {
    var info = parseCurrentDir(currentBuffer);
    renderDisk(info);
  }
  if (pickerTarget) renderPicker();
});

document.getElementById('opt-show-addr').addEventListener('click', (e) => {
  e.stopPropagation();
  closeMenus();
  showAddresses = !showAddresses;
  localStorage.setItem('d64-showAddresses', showAddresses);
  document.getElementById('check-addr').innerHTML = showAddresses ? '<i class="fa-solid fa-check"></i>' : '';
  if (currentBuffer) {
    const info = parseCurrentDir(currentBuffer);
    renderDisk(info);
  }
});

document.getElementById('opt-show-ts').addEventListener('click', (e) => {
  e.stopPropagation();
  closeMenus();
  showTrackSector = !showTrackSector;
  localStorage.setItem('d64-showTrackSector', showTrackSector);
  document.getElementById('check-ts').innerHTML = showTrackSector ? '<i class="fa-solid fa-check"></i>' : '';
  if (currentBuffer) {
    const info = parseCurrentDir(currentBuffer);
    renderDisk(info);
  }
});

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
  if (bamCheck.bamErrors.length > 0 || bamCheck.allocMismatch > 0) {
    bamWarnings += '<ul style="color:#f38ba8;margin:0 0 8px;padding-left:20px;font-size:12px;list-style:none">';
    if (bamCheck.bamErrors.length > 0) {
      bamWarnings += '<li><i class="fa-solid fa-triangle-exclamation"></i> ' +
        bamCheck.bamErrors.length + ' track(s) with wrong free count</li>';
    }
    if (bamCheck.allocMismatch > 0) {
      bamWarnings += '<li><i class="fa-solid fa-triangle-exclamation"></i> ' +
        bamCheck.allocMismatch + ' sector(s) marked free but used by files</li>';
    }
    bamWarnings += '</ul>';
  }

  // Find max sectors for header
  var maxSpt = 0;
  for (var t = 1; t <= bamTracks; t++) {
    var spt = fmt.sectorsPerTrack(t);
    if (spt > maxSpt) maxSpt = spt;
  }

  // Build the BAM visualization
  var html = '<div class="bam-legend">' +
    '<span class="bam-legend-item"><span class="bam-legend-box" style="background:var(--accent)"></span> Used</span>' +
    '<span class="bam-legend-item"><span class="bam-legend-box" style="background:var(--accent);opacity:0.25"></span> Free</span>' +
    '<span class="bam-legend-item"><span class="bam-legend-box bam-sector dir-used"></span> Dir Used</span>' +
    '<span class="bam-legend-item"><span class="bam-legend-box bam-sector dir-free"></span> Dir Free</span>' +
    '</div>';

  // Sector number header
  html += '<div class="bam-header">';
  html += '<span class="bam-header-spacer"></span>';
  html += '<span class="bam-header-sectors">';
  for (var h = 0; h < maxSpt; h++) {
    html += '<span class="bam-header-num">' + h.toString(16).toUpperCase().padStart(2, '0') + '</span>';
  }
  html += '</span></div>';

  html += '<div class="bam-viewer">';

  var totalFree = 0;
  var totalUsed = 0;

  for (t = 1; t <= bamTracks; t++) {
    spt = fmt.sectorsPerTrack(t);
    var free = fmt.readTrackFree(data, bamOff, t);
    var bm = fmt.readTrackBitmap(data, bamOff, t);
    var isDirTrack = (t === fmt.dirTrack);

    html += '<div class="bam-track">';
    html += '<span class="bam-track-num' + (bamCheck.errorTracks[t] ? ' error' : '') + '">$' + t.toString(16).toUpperCase().padStart(2, '0') + '</span>';
    html += '<span class="bam-sectors">';

    for (var s = 0; s < spt; s++) {
      var isFree = (bm & (1 << s)) !== 0;
      var cls = 'bam-sector';
      if (isDirTrack) {
        cls += isFree ? ' dir-free' : ' dir-used';
      } else {
        cls += isFree ? ' free' : ' used';
      }
      if (isFree) totalFree++; else totalUsed++;

      var tooltip = 'T:$' + t.toString(16).toUpperCase().padStart(2, '0') +
        ' S:$' + s.toString(16).toUpperCase().padStart(2, '0');
      if (isFree) {
        tooltip += ' (free)';
      } else if (isDirTrack) {
        tooltip += ' (directory)';
      } else {
        var owner = sectorOwner[t + ':' + s];
        if (owner) {
          tooltip += ' (' + petsciiToReadable(owner) + ')';
        } else {
          tooltip += ' (used)';
        }
      }

      if (bamCheck.errorSectors[t + ':' + s]) cls += ' error';
      html += '<span class="' + cls + '" data-t="' + t + '" data-s="' + s + '" title="' + escHtml(tooltip) + '"></span>';
    }

    html += '</span>';
    html += '</div>';
  }

  html += '</div>';

  var title = 'BAM \u2014 ' + totalFree + ' free, ' + totalUsed + ' used of ' +
    (totalFree + totalUsed) + ' sectors';
  html = bamWarnings + html;
  showModal(title, []);
  var bamBody = document.getElementById('modal-body');
  bamBody.innerHTML = html;

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

// ── GEOS File Info ────────────────────────────────────────────────────
document.getElementById('opt-view-geos').addEventListener('click', function(e) {
  e.stopPropagation();
  if (!currentBuffer || selectedEntryIndex < 0) return;
  closeMenus();

  var geos = readGeosInfo(currentBuffer, selectedEntryIndex);
  if (!geos.isGeos) {
    showModal('GEOS Info', ['This file is not a GEOS file.']);
    return;
  }

  var data = new Uint8Array(currentBuffer);
  var name = readPetsciiString(data, selectedEntryIndex + 5, 16);
  var readableName = petsciiToReadable(name);

  var lines = [];
  lines.push('File: ' + readableName);
  lines.push('GEOS Type: ' + geos.fileTypeName);
  lines.push('Structure: ' + geos.structureName);
  if (geos.date) lines.push('Date: ' + geos.date);

  // Try to read the info block
  if (geos.infoTrack > 0) {
    var infoBlock = readGeosInfoBlock(currentBuffer, geos.infoTrack, geos.infoSector);
    if (infoBlock) {
      if (infoBlock.className) lines.push('Class: ' + infoBlock.className);
      lines.push('Load: $' + infoBlock.loadAddr.toString(16).toUpperCase().padStart(4, '0') +
        ' End: $' + infoBlock.endAddr.toString(16).toUpperCase().padStart(4, '0') +
        ' Init: $' + infoBlock.initAddr.toString(16).toUpperCase().padStart(4, '0'));
      if (infoBlock.description) lines.push('Description: ' + infoBlock.description);
    }
    lines.push('Info Block: T:$' + geos.infoTrack.toString(16).toUpperCase().padStart(2, '0') +
      ' S:$' + geos.infoSector.toString(16).toUpperCase().padStart(2, '0'));
  }

  // Build HTML
  var html = '<table style="font-size:13px;border-collapse:collapse;width:100%">';
  for (var i = 0; i < lines.length; i++) {
    var parts = lines[i].split(': ');
    if (parts.length >= 2) {
      var label = parts[0];
      var value = parts.slice(1).join(': ');
      html += '<tr><td style="color:var(--text-muted);padding:3px 12px 3px 0;white-space:nowrap;vertical-align:top">' +
        escHtml(label) + '</td><td style="padding:3px 0;white-space:pre-wrap">' + escHtml(value) + '</td></tr>';
    } else {
      html += '<tr><td colspan="2" style="padding:3px 0">' + escHtml(lines[i]) + '</td></tr>';
    }
  }
  html += '</table>';

  showModal('GEOS File Info', []);
  document.getElementById('modal-body').innerHTML = html;
});

// ── Convert to GEOS ──────────────────────────────────────────────────
document.getElementById('opt-convert-geos').addEventListener('click', function(e) {
  e.stopPropagation();
  if (!currentBuffer || hasGeosSignature(currentBuffer)) return;
  closeMenus();
  writeGeosSignature(currentBuffer);
  updateMenuState();
  showModal('Convert to GEOS', ['Disk has been marked as GEOS format.']);
});

// ── Disk menu: Fill Free Sectors ─────────────────────────────────────
document.getElementById('opt-fill-free').addEventListener('click', function(e) {
  e.stopPropagation();
  if (!currentBuffer) return;
  closeMenus();

  document.getElementById('modal-title').textContent = 'Fill Free Sectors';
  var body = document.getElementById('modal-body');
  body.innerHTML = '';

  var hint = document.createElement('div');
  hint.style.cssText = 'font-size:12px;color:var(--text-muted);margin-bottom:10px';
  hint.textContent = 'Enter hex bytes (00-FF). Up to 8 bytes, pattern repeats across each sector.';
  body.appendChild(hint);

  var row = document.createElement('div');
  row.style.cssText = 'display:flex;gap:6px;align-items:center;flex-wrap:wrap;margin-bottom:12px';
  body.appendChild(row);

  var preview = document.createElement('div');
  preview.style.cssText = 'font-size:12px;color:var(--text-muted);font-family:monospace';
  body.appendChild(preview);

  function updatePreview() {
    if (fillBytes.length === 0) {
      preview.textContent = '';
      return;
    }
    preview.textContent = 'Pattern: ' + fillBytes.map(function(b) {
      return '$' + b.toString(16).toUpperCase().padStart(2, '0');
    }).join(' ');
  }

  var inputStyle = 'width:32px;padding:4px 6px;font-family:monospace;font-size:14px;text-align:center;text-transform:uppercase;border:1px solid var(--border);border-radius:3px;background:var(--bg);color:var(--text)';

  function readAllBytes(includePending) {
    var bytes = [];
    var inputs = row.querySelectorAll('input');
    for (var i = 0; i < inputs.length; i++) {
      var v = inputs[i].value.replace(/[^0-9a-fA-F]/g, '');
      if (v.length === 2) {
        var val = parseInt(v, 16);
        if (!isNaN(val) && val >= 0 && val <= 255) bytes.push(val);
      } else if (v.length === 1 && includePending) {
        var val2 = parseInt('0' + v, 16);
        if (!isNaN(val2)) bytes.push(val2);
      }
    }
    return bytes;
  }

  var fillBtn; // declared here so refreshPreview can access it

  function refreshPreview() {
    var confirmed = readAllBytes(false);
    var withPending = readAllBytes(true);
    if (fillBtn) fillBtn.disabled = confirmed.length === 0;
    if (withPending.length === 0) { preview.textContent = ''; return; }
    preview.textContent = 'Pattern: ' + withPending.map(function(b) {
      return '$' + b.toString(16).toUpperCase().padStart(2, '0');
    }).join(' ');
  }

  function ensureEmptyInput() {
    // Make sure there's exactly one empty input at the end (if under 8 total)
    var inputs = row.querySelectorAll('input');
    var last = inputs.length > 0 ? inputs[inputs.length - 1] : null;
    var filledCount = 0;
    for (var i = 0; i < inputs.length; i++) {
      if (inputs[i].value.replace(/[^0-9a-fA-F]/g, '').length === 2) filledCount++;
    }
    if (last && last.value === '' && filledCount < 8) return; // already have one
    if (filledCount >= 8) return;
    addByteInput('', false);
  }

  function addByteInput(value, doFocus) {
    var inp = document.createElement('input');
    inp.type = 'text';
    inp.maxLength = 2;
    inp.style.cssText = inputStyle;
    inp.value = value || '';
    row.appendChild(inp);

    inp.addEventListener('keydown', function(ev) {
      if (ev.key === 'Backspace' && inp.value === '') {
        // Focus previous input, but don't remove this one yet
        var prev = inp.previousElementSibling;
        if (prev) {
          ev.preventDefault();
          ev.stopPropagation();
          prev.focus();
          var len = prev.value.length;
          prev.setSelectionRange(len, len);
          return;
        }
      }
      if (ev.key === 'Tab' && !ev.shiftKey) {
        var v = inp.value.replace(/[^0-9a-fA-F]/g, '');
        if (v.length > 0 && v.length < 2) inp.value = '0' + v.toUpperCase();
        if (inp.value.length === 2 && row.querySelectorAll('input').length < 8) {
          ev.preventDefault();
          ev.stopPropagation();
          ensureEmptyInput();
          var next = inp.nextElementSibling;
          if (next) next.focus();
          refreshPreview();
          return;
        }
      }
      if (ev.key !== 'Escape') ev.stopPropagation();
    });

    inp.addEventListener('input', function() {
      inp.value = inp.value.replace(/[^0-9a-fA-F]/g, '').substring(0, 2);
      // If this input now has <2 chars, remove any trailing empty inputs
      if (inp.value.length < 2) {
        var next = inp.nextElementSibling;
        while (next && next.value === '') {
          var toRemove = next;
          next = next.nextElementSibling;
          row.removeChild(toRemove);
        }
      }
      refreshPreview();
      if (inp.value.length === 2) {
        // Auto-advance: ensure there's a next input and focus it
        ensureEmptyInput();
        var next = inp.nextElementSibling;
        if (next) setTimeout(function() { next.focus(); }, 0);
      }
    });

    inp.addEventListener('focus', function() {
      inp.select();
    });

    inp.addEventListener('blur', function() {
      var v = inp.value.replace(/[^0-9a-fA-F]/g, '');
      if (v.length === 0) {
        // Empty input: remove it (unless it's the only one)
        if (row.querySelectorAll('input').length > 1) {
          row.removeChild(inp);
          refreshPreview();
          ensureEmptyInput();
        }
      } else if (v.length === 1) {
        // Single digit: pad with leading zero
        inp.value = '0' + v.toUpperCase();
        refreshPreview();
        ensureEmptyInput();
      }
    });

    if (doFocus) setTimeout(function() { inp.focus(); inp.select(); }, 50);
  }

  addByteInput('00', true);
  refreshPreview();

  var footer = document.querySelector('#modal-overlay .modal-footer');
  footer.innerHTML = '';

  var cancelBtn = document.createElement('button');
  cancelBtn.textContent = 'Cancel';
  cancelBtn.className = 'modal-btn-secondary';
  cancelBtn.addEventListener('click', function() {
    document.getElementById('modal-overlay').classList.remove('open');
  });
  footer.appendChild(cancelBtn);

  fillBtn = document.createElement('button');
  fillBtn.textContent = 'Fill';
  fillBtn.addEventListener('click', function() {
    document.getElementById('modal-overlay').classList.remove('open');

    // Read all valid bytes from inputs (ignore empty ones)
    var fillBytes = readAllBytes();
    if (fillBytes.length === 0) return;

    // Build true allocation map (don't trust BAM)
    var allocated = buildTrueAllocationMap(currentBuffer);
    var data = new Uint8Array(currentBuffer);
    var fmt = currentFormat;
    var filled = 0;

    for (var t = 1; t <= currentTracks; t++) {
      var spt = fmt.sectorsPerTrack(t);
      for (var s = 0; s < spt; s++) {
        if (allocated[t + ':' + s]) continue;
        var off = sectorOffset(t, s);
        if (off < 0) continue;

        // Set track/sector link to 00 00 (no chain)
        data[off] = 0x00;
        data[off + 1] = 0x00;

        // Fill bytes 2-255 with the repeating pattern
        var pi = 0;
        for (var b = 2; b < 256; b++) {
          data[off + b] = fillBytes[pi];
          pi = (pi + 1) % fillBytes.length;
        }
        filled++;
      }
    }

    var info = parseCurrentDir(currentBuffer);
    renderDisk(info);
    updateMenuState();
    showModal('Fill Free Sectors', [
      filled + ' sector(s) filled with pattern: ' + fillBytes.map(function(b) { return '$' + b.toString(16).toUpperCase().padStart(2, '0'); }).join(' ')
    ]);
  });
  footer.appendChild(fillBtn);

  document.getElementById('modal-overlay').classList.add('open');
});

// ── Disk menu: Add Directory (D81 partition) ─────────────────────────
document.getElementById('opt-add-partition').addEventListener('click', async function(e) {
  e.stopPropagation();
  if (!currentBuffer || currentFormat !== DISK_FORMATS.d81 || currentPartition) return;
  closeMenus();

  // Ask for partition name
  var name = await showInputModal('Directory Name', 'SUBDIR');
  if (!name) return;
  name = name.toUpperCase().substring(0, 16);

  // Ask for desired blocks free (minimum 80 = 2 data tracks + 1 system track)
  var blocksStr = await showInputModal('Blocks Free (min 80, multiples of 40)', '80');
  if (!blocksStr) return;
  var desiredBlocks = parseInt(blocksStr, 10);
  if (isNaN(desiredBlocks) || desiredBlocks < 80) {
    showModal('Add Directory Error', ['Minimum is 80 blocks (2 data tracks).']);
    return;
  }
  // Round up to next multiple of 40
  var dataTracks = Math.ceil(desiredBlocks / 40);
  var numTracks = dataTracks + 1; // +1 for system track (header, BAM, dir)
  var partSectors = numTracks * 40;
  var actualBlocks = dataTracks * 40;

  // Build true allocation map to find contiguous free tracks
  var allocated = buildTrueAllocationMap(currentBuffer);
  var fmt = currentFormat;

  // Find contiguous free tracks (must not include track 40, must start at sector 0)
  // Search for a contiguous run of numTracks tracks that are completely free
  var startTrack = -1;
  for (var t = 1; t <= currentTracks - numTracks + 1; t++) {
    // Skip ranges that include track 40 (system track)
    var endTrack = t + numTracks - 1;
    if (t <= fmt.dirTrack && endTrack >= fmt.dirTrack) continue;

    var allFree = true;
    for (var ct = t; ct <= endTrack; ct++) {
      var spt = fmt.sectorsPerTrack(ct);
      for (var cs = 0; cs < spt; cs++) {
        if (allocated[ct + ':' + cs]) { allFree = false; break; }
      }
      if (!allFree) break;
    }
    if (allFree) { startTrack = t; break; }
  }

  if (startTrack < 0) {
    showModal('Add Directory Error', ['Not enough contiguous free space. Need ' + numTracks + ' tracks (' + actualBlocks + ' blocks + 1 system track).']);
    return;
  }

  // Check we have a free directory entry
  if (!canInsertFile()) {
    showModal('Add Directory Error', ['No free directory entry available.']);
    return;
  }

  // Take snapshot for rollback
  var snapshot = currentBuffer.slice(0);
  var data = new Uint8Array(currentBuffer);

  // Create directory entry for the partition
  var entryOff = findFreeDirEntry(currentBuffer);
  if (entryOff < 0) {
    currentBuffer = snapshot;
    showModal('Add Directory Error', ['Failed to allocate directory entry.']);
    return;
  }

  // Type: CBM ($85), closed
  data[entryOff + 2] = 0x85;
  // Start track/sector (sector must be 0)
  data[entryOff + 3] = startTrack;
  data[entryOff + 4] = 0;
  // Name
  for (var ni = 0; ni < 16; ni++) {
    if (ni < name.length) {
      var ch = name.charCodeAt(ni);
      if (ch >= 0x41 && ch <= 0x5A) data[entryOff + 5 + ni] = ch;
      else if (ch >= 0x30 && ch <= 0x39) data[entryOff + 5 + ni] = ch;
      else if (ch === 0x20) data[entryOff + 5 + ni] = 0x20;
      else data[entryOff + 5 + ni] = 0x20;
    } else {
      data[entryOff + 5 + ni] = 0xA0;
    }
  }
  // Clear unused bytes
  for (var ui = 21; ui < 30; ui++) data[entryOff + ui] = 0x00;
  // Partition size in sectors
  data[entryOff + 30] = partSectors & 0xFF;
  data[entryOff + 31] = (partSectors >> 8) & 0xFF;

  // Format the partition: header (sector 0), BAM (sectors 1-2), directory (sector 3)
  var headerOff = sectorOffset(startTrack, 0);

  // Header sector — mirrors D81 root header layout
  data[headerOff + 0x00] = startTrack; // dir track (self-referencing)
  data[headerOff + 0x01] = 3;          // dir sector
  data[headerOff + 0x02] = 0x44;       // DOS version 'D'
  data[headerOff + 0x03] = 0xBB;
  // Disk name at offset 0x04
  for (var hi = 0; hi < 16; hi++) data[headerOff + 0x04 + hi] = data[entryOff + 5 + hi];
  data[headerOff + 0x14] = 0xA0;
  data[headerOff + 0x15] = 0xA0;
  // Disk ID
  data[headerOff + 0x16] = 0x31; // '1'
  data[headerOff + 0x17] = 0x41; // 'A'
  data[headerOff + 0x18] = 0xA0;
  // DOS type
  data[headerOff + 0x19] = 0x33; // '3'
  data[headerOff + 0x1A] = 0x44; // 'D'
  for (var fi = 0x1B; fi < 0x100; fi++) data[headerOff + fi] = 0x00;

  // BAM sector 1 (startTrack, 1) — covers tracks 1..40 of the partition
  var bam1Off = sectorOffset(startTrack, 1);
  data[bam1Off + 0x00] = startTrack;
  data[bam1Off + 0x01] = 2;        // link to BAM sector 2
  data[bam1Off + 0x02] = 0x44;     // DOS version
  data[bam1Off + 0x03] = 0xBB;
  data[bam1Off + 0x04] = 0x31;     // ID copy
  data[bam1Off + 0x05] = 0x41;
  for (var b1 = 0x06; b1 < 0x10; b1++) data[bam1Off + b1] = 0x00;

  // BAM sector 2 (startTrack, 2) — covers tracks 41..80 of the partition
  var bam2Off = sectorOffset(startTrack, 2);
  data[bam2Off + 0x00] = 0x00;     // end of chain
  data[bam2Off + 0x01] = 0xFF;
  data[bam2Off + 0x02] = 0x44;
  data[bam2Off + 0x03] = 0xBB;
  data[bam2Off + 0x04] = 0x31;
  data[bam2Off + 0x05] = 0x41;
  for (var b2 = 0x06; b2 < 0x10; b2++) data[bam2Off + b2] = 0x00;

  // Initialize BAM entries for each track in the partition
  for (var pt = 1; pt <= numTracks; pt++) {
    var base;
    if (pt <= 40) {
      base = bam1Off + 0x10 + (pt - 1) * 6;
    } else {
      base = bam2Off + 0x10 + (pt - 41) * 6;
    }

    if (pt === 1) {
      // First track: sectors 0-3 used (header, BAM1, BAM2, first dir sector)
      data[base] = 40 - 4; // 36 free
      for (var bb = 0; bb < 5; bb++) data[base + 1 + bb] = 0xFF;
      data[base + 1] &= ~(1 << 0); // sector 0
      data[base + 1] &= ~(1 << 1); // sector 1
      data[base + 1] &= ~(1 << 2); // sector 2
      data[base + 1] &= ~(1 << 3); // sector 3
    } else {
      // Other tracks: all 40 sectors free
      data[base] = 40;
      for (var bb2 = 0; bb2 < 5; bb2++) data[base + 1 + bb2] = 0xFF;
    }
  }

  // Initialize first directory sector (startTrack, 3)
  var dirOff = sectorOffset(startTrack, 3);
  data[dirOff + 0] = 0x00; // end of chain
  data[dirOff + 1] = 0xFF;
  for (var di = 2; di < 256; di++) data[dirOff + di] = 0x00;

  // Mark all partition sectors as allocated in the root BAM
  var rootBamOff = sectorOffset(fmt.bamTrack, fmt.bamSector);
  for (var rt = startTrack; rt < startTrack + numTracks; rt++) {
    var spt = fmt.sectorsPerTrack(rt);
    // Clear all bits (mark all sectors as used)
    var rbase;
    if (rt <= 40) {
      rbase = rootBamOff + 0x10 + (rt - 1) * 6;
    } else {
      rbase = rootBamOff + 256 + 0x10 + (rt - 41) * 6;
    }
    data[rbase] = 0; // 0 free
    for (var rb = 0; rb < 5; rb++) data[rbase + 1 + rb] = 0x00; // all bits clear = all used
  }

  // Success
  selectedEntryIndex = entryOff;
  var info = parseDisk(currentBuffer);
  renderDisk(info);
  updateMenuState();
  showModal('Directory Created', [
    'Directory "' + name + '" created.',
    numTracks + ' tracks (' + startTrack + '-' + (startTrack + numTracks - 1) + '), ' + actualBlocks + ' blocks free.',
    'Double-click to enter the directory.'
  ]);
});

// ── File Content Viewer ───────────────────────────────────────────────

// ── Options menu ──────────────────────────────────────────────────────
document.getElementById('opt-unsafe-chars').addEventListener('click', (e) => {
  e.stopPropagation();
  closeMenus();
  allowUnsafeChars = !allowUnsafeChars;
  localStorage.setItem('d64-allowUnsafe', allowUnsafeChars);
  document.getElementById('check-unsafe').innerHTML = allowUnsafeChars ? '<i class="fa-solid fa-check"></i>' : '';
  if (pickerTarget) renderPicker();
});

document.getElementById('opt-picker-all').addEventListener('click', (e) => {
  e.stopPropagation();
  closeMenus();
  pickerDefaultAll = !pickerDefaultAll;
  localStorage.setItem('d64-pickerAll', pickerDefaultAll);
  document.getElementById('check-picker-all').innerHTML = pickerDefaultAll ? '<i class="fa-solid fa-check"></i>' : '';
});

document.getElementById('opt-picker-stick').addEventListener('click', (e) => {
  e.stopPropagation();
  closeMenus();
  pickerStick = !pickerStick;
  localStorage.setItem('d64-pickerStick', pickerStick);
  document.getElementById('check-picker-stick').innerHTML = pickerStick ? '<i class="fa-solid fa-check"></i>' : '';
});

// ── File Info viewer ──────────────────────────────────────────────────
// Detect common C64 packers by examining the decruncher code
function detectPacker(fileData) {
  if (fileData.length < 20) return null;
  var d = fileData;

  // Check for BASIC SYS line first
  var loadAddr = d[0] | (d[1] << 8);
  if (loadAddr !== 0x0801) return null;

  // Parse SYS address from BASIC line
  // Format: [next_ptr_lo] [next_ptr_hi] [line_lo] [line_hi] [token...] [0x00]
  // SYS token = 0x9E, followed by address digits
  var sysAddr = 0;
  var pos = 2; // skip load address
  // Skip next-line pointer (2 bytes) and line number (2 bytes)
  pos += 4;
  // Find SYS token (0x9E)
  var foundSys = false;
  while (pos < Math.min(d.length, 40)) {
    if (d[pos] === 0x9E) { foundSys = true; pos++; break; }
    if (d[pos] === 0x00) break;
    pos++;
  }
  if (foundSys) {
    // Skip spaces
    while (pos < d.length && d[pos] === 0x20) pos++;
    // Parse decimal digits
    var digits = '';
    while (pos < d.length && d[pos] >= 0x30 && d[pos] <= 0x39) {
      digits += String.fromCharCode(d[pos]);
      pos++;
    }
    sysAddr = parseInt(digits, 10) || 0;
  }
  if (!sysAddr) return { sysAddr: 0, packer: null };

  // Try restore64 scanner database (377 packers) first
  if (typeof detectPackerRestore64 === 'function') {
    var r64 = detectPackerRestore64(d);
    if (r64 && r64.name) {
      var versionStr = r64.name + (r64.version ? ' ' + r64.version : '');
      return { sysAddr: sysAddr, packer: versionStr };
    }
  }

  // Fallback: our own signature detection
  // Calculate offset of SYS target within file data
  var sysOff = sysAddr - loadAddr + 2; // +2 for the load address bytes in data

  // Search for packer signatures in the code area
  function findString(str, start, end) {
    start = start || 0;
    end = Math.min(end || d.length, d.length);
    for (var i = start; i <= end - str.length; i++) {
      var match = true;
      for (var j = 0; j < str.length; j++) {
        if (d[i + j] !== str.charCodeAt(j)) { match = false; break; }
      }
      if (match) return i;
    }
    return -1;
  }

  function findBytes(pattern, start, end) {
    start = start || 0;
    end = Math.min(end || d.length, d.length);
    for (var i = start; i <= end - pattern.length; i++) {
      var match = true;
      for (var j = 0; j < pattern.length; j++) {
        if (pattern[j] !== null && d[i + j] !== pattern[j]) { match = false; break; }
      }
      if (match) return i;
    }
    return -1;
  }

  var packer = null;
  var searchEnd = Math.min(d.length, 1024);

  // Exact byte signatures (highest confidence, checked first)

  // Exomizer v1: SYS2059, specific stub bytes
  if (!packer && sysAddr === 2059 && findBytes([0xA0, 0x00, 0x78, 0xE6, 0x01, 0xBA, 0xBD], 13, 22) >= 0) packer = 'Exomizer v1';

  // ByteBoozer 2: SEI + LDA #$34 + STA $01 + LDX #$B7 at offset 12
  if (!packer && findBytes([0x78, 0xA9, 0x34, 0x85, 0x01, 0xA2, 0xB7], 12, 22) >= 0) packer = 'ByteBoozer 2';

  // PuCrunch: BASIC line number 239 ($EF $00) at offset 4-5
  if (!packer && d.length > 16 && d[4] === 0xEF && d[5] === 0x00 && findBytes([0x78, 0xA9, 0x38, 0x85, 0x01], 14, 22) >= 0) packer = 'PuCrunch';

  // Dali: BASIC line number 1602 ($42 $06) at offset 4-5
  if (!packer && d.length > 16 && d[4] === 0x42 && d[5] === 0x06) packer = 'Dali';

  // Exomizer v2/v3: decrunch table at $0334, memory restore A9 37 85 01
  if (!packer && findBytes([0xA9, 0x37, 0x85, 0x01], sysOff, searchEnd) >= 0) {
    // Check for $0334 table reference
    if (findBytes([0x34, 0x03], sysOff, searchEnd) >= 0) packer = 'Exomizer v2/v3';
  }

  // ByteBoozer 1: BB string + SEI + LDX #0
  if (!packer && findString('BB', 2, searchEnd) >= 0 && findBytes([0xA2, 0x00, 0x78], sysOff, searchEnd) >= 0) packer = 'ByteBoozer v1';

  // TSCrunch: uses ZP $F8, first decrunch reads LDA ($F8),Y
  if (!packer && findBytes([0xB1, 0xF8], sysOff, sysOff + 64) >= 0) packer = 'TSCrunch';

  // String-based signatures
  if (!packer && (findString('exo', 2, searchEnd) >= 0 || findString('Exo', 2, searchEnd) >= 0)) packer = 'Exomizer';
  if (!packer && findString('PuCr', 2, searchEnd) >= 0) packer = 'PuCrunch';
  if (!packer && findString('IRC', 2, searchEnd) >= 0) packer = 'IRCrunch';
  if (!packer && findString('Sub', 2, searchEnd) >= 0 && findBytes([0x4C], sysOff, sysOff + 3) >= 0) packer = 'Subsizer';
  if (!packer && findString('LC', 2, searchEnd) >= 0 && findBytes([0xA9, null, 0x85], sysOff, searchEnd) >= 0) packer = 'Level Crusher';
  if (!packer && findString('AB', 2, searchEnd) >= 0 && sysAddr >= 0x080D && sysAddr <= 0x0830) packer = 'Cruncher AB';

  // Code pattern signatures
  // MegaLZ / Doynax / Doynamite
  if (!packer && findBytes([0xA2, 0x00, 0xA0, 0x00, 0xB1], sysOff, searchEnd) >= 0) packer = 'MegaLZ/Doynax';

  // Common decruncher init: SEI + memory config change
  if (!packer && sysOff > 0 && sysOff < d.length) {
    var initByte = d[sysOff];
    if (initByte === 0x78) { // SEI
      // Check memory config: LDA #$34 (all RAM)
      if (findBytes([0xA9, 0x34, 0x85, 0x01], sysOff, sysOff + 16) >= 0) packer = 'Unknown packer (all-RAM)';
      // LDA #$35 (I/O + RAM)
      else if (findBytes([0xA9, 0x35, 0x85, 0x01], sysOff, sysOff + 16) >= 0) packer = 'Unknown packer';
    }
  }

  // Generic heuristic: SYS points past standard BASIC stub
  if (!packer && sysAddr > 0x080D) {
    // Check for common decruncher patterns near SYS target
    if (sysOff > 0 && sysOff < d.length && (d[sysOff] === 0x78 || d[sysOff] === 0x4C || d[sysOff] === 0xA9)) {
      packer = 'Packed (unknown)';
    }
  }

  return { sysAddr: sysAddr, packer: packer };
}

function showFileInfo(entryOff) {
  if (!currentBuffer) return;
  var data = new Uint8Array(currentBuffer);
  var typeByte = data[entryOff + 2];
  var typeIdx = typeByte & 0x07;
  var closed = (typeByte & 0x80) !== 0;
  var locked = (typeByte & 0x40) !== 0;
  var typeName = FILE_TYPES[typeIdx] || '???';
  var name = petsciiToReadable(readPetsciiString(data, entryOff + 5, 16)).trim();
  var blocks = data[entryOff + 30] | (data[entryOff + 31] << 8);
  var startTrack = data[entryOff + 3];
  var startSector = data[entryOff + 4];

  var addr = getFileAddresses(currentBuffer, entryOff);
  var result = readFileData(currentBuffer, entryOff);
  var fileData = result.data;

  var lines = [];
  lines.push('Type: ' + typeName + (closed ? '' : ' (scratched)') + (locked ? ' (locked)' : ''));
  lines.push('Blocks: ' + blocks);
  lines.push('Size: ' + fileData.length + ' bytes');
  lines.push('Start T:$' + startTrack.toString(16).toUpperCase().padStart(2, '0') +
    ' S:$' + startSector.toString(16).toUpperCase().padStart(2, '0'));

  if (addr) {
    lines.push('Load: $' + addr.start.toString(16).toUpperCase().padStart(4, '0'));
    lines.push('End:  $' + addr.end.toString(16).toUpperCase().padStart(4, '0'));
  }

  // PRG-specific: SYS line and packer detection
  if (typeIdx === 2 && fileData.length >= 10) {
    var loadAddr = fileData[0] | (fileData[1] << 8);
    if (loadAddr === 0x0801) {
      var packerInfo = detectPacker(fileData);
      if (packerInfo) {
        if (packerInfo.sysAddr) {
          lines.push('SYS: ' + packerInfo.sysAddr + ' ($' + packerInfo.sysAddr.toString(16).toUpperCase().padStart(4, '0') + ')');
        }
        if (packerInfo.packer) {
          lines.push('Packer: ' + packerInfo.packer);
        }
      }
    }

    // Check for BASIC program
    if (isBasicProgram(fileData)) {
      var basic = detokenizeBasic(fileData);
      if (basic && basic.lines.length > 0) {
        lines.push('BASIC: ' + basic.lines.length + ' line(s), ' + basic.version);
      }
    }
  }

  // Graphics format detection
  var gfxMatches = detectGfxFormats(fileData);
  if (gfxMatches.length > 0) {
    var exact = gfxMatches.filter(function(m) {
      for (var i = 0; i < GFX_FORMATS.length; i++) {
        if (GFX_FORMATS[i].name === m.name) return true;
      }
      return false;
    });
    if (exact.length > 0) {
      lines.push('Graphics: ' + exact.map(function(m) { return m.name; }).join(', '));
    }
  }

  showModal('File Info \u2014 "' + name + '"', lines);
}

// ── C64 color palette ─────────────────────────────────────────────────
// Pepto's VIC-II palette (https://www.pepto.de/projects/colorvic/2001/)
var C64_COLORS = [
  '#000000', '#FFFFFF', '#683726', '#70A4B2', '#6F3D86', '#588D43',
  '#352879', '#B8C76F', '#6F4F25', '#433900', '#9A6759', '#444444',
  '#6C6C6C', '#9AD284', '#6C5EB5', '#959595'
];

// ── C64 Graphics format viewer ────────────────────────────────────────

// Known formats: exact match by load address + file size
var GFX_FORMATS = [
  // Multicolor — Koala-style layout (bm+scr+col+bg) at specific addresses
  { name: 'Koala Painter', addr: 0x6000, size: 10003, mode: 'mc', layout: 'koala' },
  { name: 'Gun Paint', addr: 0x4000, size: 10003, mode: 'mc', layout: 'koala' },
  { name: 'Zoomatic', addr: 0x5800, size: 10003, mode: 'mc', layout: 'koala' },
  { name: 'Micro Illustrator', addr: 0x1800, size: 10003, mode: 'mc', layout: 'koala' },
  { name: 'Amica Paint', addr: 0x4000, size: 10018, mode: 'mc', layout: 'koala' },
  // Multicolor — other layouts
  { name: 'Drazpaint', addr: 0x5800, size: 10051, mode: 'mc', layout: 'drp' },
  { name: 'Vidcom 64', addr: 0x5800, size: 10050, mode: 'mc', layout: 'vidcom' },
  // Hires — bitmap+screen layout
  { name: 'Art Studio', addr: 0x2000, size: 9009, mode: 'hires', layout: 'bmscr' },
  { name: 'Hires Manager', addr: 0x4000, size: 9002, mode: 'hires', layout: 'bmscr' },
  { name: 'Blazing Paddles', addr: 0xA000, size: 10242, mode: 'hires', layout: 'bmscr' },
  { name: 'Face Painter', addr: 0x6000, size: 9332, mode: 'hires', layout: 'bmscr' },
  // Hires — screen+bitmap layout (Doodle-style)
  { name: 'Doodle', addr: 0x5C00, size: 9218, mode: 'hires', layout: 'scrbm' },
  { name: 'Artist 64', addr: 0x2000, size: 9218, mode: 'hires', layout: 'scrbm' },
  // FLI
  { name: 'FLI (Blackmail)', addr: 0x3C00, size: 17409, mode: 'fli', layout: 'fli' },
  { name: 'FLI Graph 2.2', addr: 0x3C00, size: 17474, mode: 'fli', layout: 'fli' },
  { name: 'AFLI', addr: 0x4000, size: 16386, mode: 'afli', layout: 'afli' },
  // Interlaced
  { name: 'Drazlace', addr: 0x5800, size: 18242, mode: 'mc', layout: 'drazlace' },
  { name: 'ECI', addr: 0x4000, size: 32770, mode: 'fli', layout: 'eci' },
];

// Layout parsers — reusable for both exact and generic detection
var GFX_PARSERS = {
  koala: function(d) { return { bm: d.subarray(2, 8002), scr: d.subarray(8002, 9002), col: d.subarray(9002, Math.min(d.length, 10002)), bg: d.length > 10002 ? d[10002] & 0x0F : 0 }; },
  drp: function(d) { return { col: d.subarray(2, 1002), bg: d[1002], bm: d.subarray(1026, 9026), scr: d.subarray(9026, 10026), rowBg: d.subarray(10026, 10051) }; },
  vidcom: function(d) { return { scr: d.subarray(2, 1002), bm: d.subarray(1026, 9026), col: d.subarray(9026, 10026), bg: d[10050] }; },
  bmscr: function(d) { return { bm: d.subarray(2, 8002), scr: d.subarray(8002, 9002) }; },
  bmonly: function(d) {
    var scr = new Uint8Array(1000);
    for (var i = 0; i < 1000; i++) scr[i] = 0x10; // white on black
    return { bm: d.subarray(2, 8002), scr: scr };
  },
  scrbm: function(d) { return { scr: d.subarray(2, 1026), bm: d.subarray(1026, 9218) }; },
  fli: function(d) {
    // Color RAM (1024), Screen banks (8×1024=8192), Bitmap (8000-8192), optional bg
    var bmStart = 2 + 1024 + 8192; // = 9218
    var bmEnd = Math.min(bmStart + 8192, d.length);
    return { col: d.subarray(2, 1026), scrBanks: d.subarray(1026, 9218), bm: d.subarray(bmStart, bmEnd), bg: d.length > bmEnd ? d[bmEnd] & 0x0F : 0 };
  },
  afli: function(d) { return { scrBanks: d.subarray(2, 8194), bm: d.subarray(8194, 16386) }; },
  drazlace: function(d) { return { col: d.subarray(2, 1002), bg: d[1002], bm: d.subarray(1026, 9026), scr: d.subarray(9026, 10026), rowBg: d.subarray(10026, 10051) }; },
  eci: function(d) { return { col: d.subarray(2, 1026), scrBanks: d.subarray(1026, 9218), bm: d.subarray(9218, 17410), bg: 0 }; },
  printshop: function(d) {
    var bmData = d.subarray(2);
    var bpr = 11;
    var h = Math.floor(bmData.length / bpr);
    return { bm: bmData, width: 88, height: h, bytesPerRow: bpr };
  },
  sprites: function(d) {
    var bmData = d.subarray(2);
    var count = Math.floor(bmData.length / 64);
    return { bm: bmData, count: count };
  },
  charset: function(d) {
    var bmData = d.subarray(2);
    var count = Math.floor(bmData.length / 8);
    return { bm: bmData, count: count };
  },
};

// Detect all plausible formats for a file (returns array of { name, mode, layout })
function detectGfxFormats(fileData) {
  if (!fileData || fileData.length < 4) return [];
  var addr = fileData[0] | (fileData[1] << 8);
  var size = fileData.length;
  var dataBytes = size - 2;
  var matches = [];
  var added = {};

  function add(name, mode, layout) {
    var key = mode + ':' + layout;
    if (added[key]) return;
    added[key] = true;
    matches.push({ name: name, addr: addr, size: size, mode: mode, layout: layout });
  }

  // 1. Exact matches (address + size)
  for (var i = 0; i < GFX_FORMATS.length; i++) {
    if (GFX_FORMATS[i].addr === addr && GFX_FORMATS[i].size === size) {
      add(GFX_FORMATS[i].name, GFX_FORMATS[i].mode, GFX_FORMATS[i].layout);
    }
  }

  // 2. Generic bitmap formats by data size (any load address)
  if (dataBytes >= 8000 && dataBytes <= 8192) add('Hires (bitmap only)', 'hires', 'bmonly');
  if (dataBytes >= 9000 && dataBytes <= 9216) {
    add('Hires (bitmap+screen)', 'hires', 'bmscr');
    add('Hires (screen+bitmap)', 'hires', 'scrbm');
  }
  if (dataBytes >= 10000 && dataBytes <= 10050) add('Multicolor (Koala-style)', 'mc', 'koala');
  if (dataBytes >= 17200 && dataBytes <= 17472) add('Multicolor FLI', 'fli', 'fli');
  if (dataBytes >= 16384 && dataBytes <= 16384) add('Hires FLI (AFLI)', 'afli', 'afli');
  if (dataBytes >= 18200 && dataBytes <= 18250) add('Multicolor Interlace', 'mc', 'drazlace');
  if (dataBytes >= 32760 && dataBytes <= 32780) add('Multicolor IFLI', 'fli', 'eci');

  // 3. Sprites: data bytes divisible by 64
  if (dataBytes >= 64 && dataBytes <= 16384 && dataBytes % 64 === 0) {
    var numSprites = dataBytes / 64;
    add('Sprites (' + numSprites + ')', 'sprites', 'sprites');
    add('Sprites MC (' + numSprites + ')', 'sprites-mc', 'sprites');
  }

  // 4. Charset/tile: data divisible by 8
  if (dataBytes >= 8 && dataBytes % 8 === 0) {
    var numChars = dataBytes / 8;
    add('Charset 1\u00D71 (' + numChars + ')', 'charset', 'charset');
    add('Charset MC 1\u00D71 (' + numChars + ')', 'charset-mc', 'charset');
    if (numChars >= 2 && numChars % 2 === 0) {
      add('Charset 1\u00D72', 'charset-1x2', 'charset');
      add('Charset MC 1\u00D72', 'charset-mc-1x2', 'charset');
      add('Charset 2\u00D71', 'charset-2x1', 'charset');
      add('Charset MC 2\u00D71', 'charset-mc-2x1', 'charset');
    }
    if (numChars >= 4 && numChars % 4 === 0) {
      add('Charset 2\u00D72', 'charset-2x2', 'charset');
      add('Charset MC 2\u00D72', 'charset-mc-2x2', 'charset');
    }
    if (numChars >= 16 && numChars % 16 === 0) {
      add('Charset 4\u00D74', 'charset-4x4', 'charset');
      add('Charset MC 4\u00D74', 'charset-mc-4x4', 'charset');
    }
  }

  // 5. Print Shop: small monochrome bitmap
  if (dataBytes >= 11 && dataBytes <= 1500) {
    add('Print Shop', 'printshop', 'printshop');
  }

  return matches;
}

// Parse C64_COLORS hex to [r,g,b] arrays for canvas
var C64_RGB = C64_COLORS.map(function(hex) {
  return [parseInt(hex.substr(1,2),16), parseInt(hex.substr(3,2),16), parseInt(hex.substr(5,2),16)];
});

function renderC64Multicolor(ctx, gfx) {
  ctx.canvas.width = 320; ctx.canvas.height = 200;
  var img = ctx.createImageData(320, 200);
  var px = img.data;
  var bg = C64_RGB[gfx.bg & 0x0F];

  for (var cellRow = 0; cellRow < 25; cellRow++) {
    for (var cellCol = 0; cellCol < 40; cellCol++) {
      var cellIdx = cellRow * 40 + cellCol;
      var scrHi = (gfx.scr[cellIdx] >> 4) & 0x0F;
      var scrLo = gfx.scr[cellIdx] & 0x0F;
      var colLo = gfx.col[cellIdx] & 0x0F;
      var colors = [bg, C64_RGB[scrHi], C64_RGB[scrLo], C64_RGB[colLo]];

      for (var line = 0; line < 8; line++) {
        var byt = gfx.bm[cellIdx * 8 + line];
        var y = cellRow * 8 + line;
        for (var px2 = 0; px2 < 4; px2++) {
          var bits = (byt >> (6 - px2 * 2)) & 3;
          var rgb = colors[bits];
          var x = cellCol * 8 + px2 * 2;
          var off = (y * 320 + x) * 4;
          px[off] = rgb[0]; px[off+1] = rgb[1]; px[off+2] = rgb[2]; px[off+3] = 255;
          px[off+4] = rgb[0]; px[off+5] = rgb[1]; px[off+6] = rgb[2]; px[off+7] = 255;
        }
      }
    }
  }
  ctx.putImageData(img, 0, 0);
}

function renderC64MulticolorDrp(ctx, gfx) {
  ctx.canvas.width = 320; ctx.canvas.height = 200;
  var img = ctx.createImageData(320, 200);
  var px = img.data;

  for (var cellRow = 0; cellRow < 25; cellRow++) {
    var rowBg = gfx.rowBg ? C64_RGB[gfx.rowBg[cellRow] & 0x0F] : C64_RGB[gfx.bg & 0x0F];
    for (var cellCol = 0; cellCol < 40; cellCol++) {
      var cellIdx = cellRow * 40 + cellCol;
      var scrHi = (gfx.scr[cellIdx] >> 4) & 0x0F;
      var scrLo = gfx.scr[cellIdx] & 0x0F;
      var colLo = gfx.col[cellIdx] & 0x0F;
      var colors = [rowBg, C64_RGB[scrHi], C64_RGB[scrLo], C64_RGB[colLo]];

      for (var line = 0; line < 8; line++) {
        var byt = gfx.bm[cellIdx * 8 + line];
        var y = cellRow * 8 + line;
        for (var px2 = 0; px2 < 4; px2++) {
          var bits = (byt >> (6 - px2 * 2)) & 3;
          var rgb = colors[bits];
          var x = cellCol * 8 + px2 * 2;
          var off = (y * 320 + x) * 4;
          px[off] = rgb[0]; px[off+1] = rgb[1]; px[off+2] = rgb[2]; px[off+3] = 255;
          px[off+4] = rgb[0]; px[off+5] = rgb[1]; px[off+6] = rgb[2]; px[off+7] = 255;
        }
      }
    }
  }
  ctx.putImageData(img, 0, 0);
}

function renderC64Hires(ctx, gfx) {
  ctx.canvas.width = 320; ctx.canvas.height = 200;
  var img = ctx.createImageData(320, 200);
  var px = img.data;

  for (var cellRow = 0; cellRow < 25; cellRow++) {
    for (var cellCol = 0; cellCol < 40; cellCol++) {
      var cellIdx = cellRow * 40 + cellCol;
      var fgColor = C64_RGB[(gfx.scr[cellIdx] >> 4) & 0x0F];
      var bgColor = C64_RGB[gfx.scr[cellIdx] & 0x0F];

      for (var line = 0; line < 8; line++) {
        var byt = gfx.bm[cellIdx * 8 + line];
        var y = cellRow * 8 + line;
        for (var bit = 7; bit >= 0; bit--) {
          var rgb = (byt & (1 << bit)) ? fgColor : bgColor;
          var x = cellCol * 8 + (7 - bit);
          var off = (y * 320 + x) * 4;
          px[off] = rgb[0]; px[off+1] = rgb[1]; px[off+2] = rgb[2]; px[off+3] = 255;
        }
      }
    }
  }
  ctx.putImageData(img, 0, 0);
}

function renderC64FLI(ctx, gfx) {
  ctx.canvas.width = 320; ctx.canvas.height = 200;
  var img = ctx.createImageData(320, 200);
  var px = img.data;
  var bg = C64_RGB[(gfx.bg || 0) & 0x0F];

  for (var cellRow = 0; cellRow < 25; cellRow++) {
    for (var cellCol = 0; cellCol < 40; cellCol++) {
      var cellIdx = cellRow * 40 + cellCol;
      var colLo = gfx.col[cellIdx] & 0x0F;

      for (var line = 0; line < 8; line++) {
        var scrByte = gfx.scrBanks[line * 1024 + cellIdx];
        var scrHi = (scrByte >> 4) & 0x0F;
        var scrLo = scrByte & 0x0F;
        var colors = [bg, C64_RGB[scrHi], C64_RGB[scrLo], C64_RGB[colLo]];

        // FLI bug: first 3 columns show background
        if (cellCol < 3) colors = [bg, bg, bg, bg];

        var byt = gfx.bm[cellIdx * 8 + line];
        var y = cellRow * 8 + line;
        for (var px2 = 0; px2 < 4; px2++) {
          var bits = (byt >> (6 - px2 * 2)) & 3;
          var rgb = colors[bits];
          var x = cellCol * 8 + px2 * 2;
          var off = (y * 320 + x) * 4;
          px[off] = rgb[0]; px[off+1] = rgb[1]; px[off+2] = rgb[2]; px[off+3] = 255;
          px[off+4] = rgb[0]; px[off+5] = rgb[1]; px[off+6] = rgb[2]; px[off+7] = 255;
        }
      }
    }
  }
  ctx.putImageData(img, 0, 0);
}

function renderC64AFLI(ctx, gfx) {
  ctx.canvas.width = 320; ctx.canvas.height = 200;
  var img = ctx.createImageData(320, 200);
  var px = img.data;

  for (var cellRow = 0; cellRow < 25; cellRow++) {
    for (var cellCol = 0; cellCol < 40; cellCol++) {
      var cellIdx = cellRow * 40 + cellCol;

      for (var line = 0; line < 8; line++) {
        var scrByte = gfx.scrBanks[line * 1024 + cellIdx];
        var fgColor = C64_RGB[(scrByte >> 4) & 0x0F];
        var bgColor = C64_RGB[scrByte & 0x0F];

        if (cellCol < 3) { fgColor = C64_RGB[0]; bgColor = C64_RGB[0]; }

        var byt = gfx.bm[cellIdx * 8 + line];
        var y = cellRow * 8 + line;
        for (var bit = 7; bit >= 0; bit--) {
          var rgb = (byt & (1 << bit)) ? fgColor : bgColor;
          var x = cellCol * 8 + (7 - bit);
          var off = (y * 320 + x) * 4;
          px[off] = rgb[0]; px[off+1] = rgb[1]; px[off+2] = rgb[2]; px[off+3] = 255;
        }
      }
    }
  }
  ctx.putImageData(img, 0, 0);
}

// colors = { bg, fg, mc1, mc2 } — color indices 0-15
function renderC64Sprites(ctx, gfx, multicolor, colors) {
  var count = gfx.count;
  var cols = Math.min(count, 8);
  var rows = Math.ceil(count / cols);
  var sprW = multicolor ? 12 : 24;
  var w = cols * (sprW + 1) - 1;
  var h = rows * 22 - 1;
  ctx.canvas.width = w;
  ctx.canvas.height = h;
  var img = ctx.createImageData(w, h);
  var px = img.data;
  for (var fi = 3; fi < px.length; fi += 4) px[fi] = 255;
  var bgRgb = C64_RGB[colors.bg];
  var fgRgb = C64_RGB[colors.fg];
  var mc1Rgb = C64_RGB[colors.mc1];
  var mc2Rgb = C64_RGB[colors.mc2];

  for (var si = 0; si < count; si++) {
    var col = si % cols;
    var row = Math.floor(si / cols);
    var xOff = col * (sprW + 1);
    var yOff = row * 22;
    var base = si * 64;
    for (var line = 0; line < 21; line++) {
      for (var byteIdx = 0; byteIdx < 3; byteIdx++) {
        var byt = gfx.bm[base + line * 3 + byteIdx];
        if (multicolor) {
          for (var px2 = 0; px2 < 4; px2++) {
            var bits = (byt >> (6 - px2 * 2)) & 3;
            var rgb = bits === 0 ? bgRgb : bits === 1 ? mc1Rgb : bits === 2 ? fgRgb : mc2Rgb;
            var x = xOff + byteIdx * 4 + px2;
            var y = yOff + line;
            if (x < w && y < h) {
              var off = (y * w + x) * 4;
              px[off] = rgb[0]; px[off+1] = rgb[1]; px[off+2] = rgb[2];
            }
          }
        } else {
          for (var bit = 7; bit >= 0; bit--) {
            var rgb2 = (byt & (1 << bit)) ? fgRgb : bgRgb;
            var x2 = xOff + byteIdx * 8 + (7 - bit);
            var y2 = yOff + line;
            if (x2 < w && y2 < h) {
              var off2 = (y2 * w + x2) * 4;
              px[off2] = rgb2[0]; px[off2+1] = rgb2[1]; px[off2+2] = rgb2[2];
            }
          }
        }
      }
    }
  }
  ctx.putImageData(img, 0, 0);
}

// colors = { bg, fg, mc1, mc2 }, multicolor flag
function renderC64Charset(ctx, gfx, tileW, tileH, colors, multicolor) {
  tileW = tileW || 1;
  tileH = tileH || 1;
  var charsPerTile = tileW * tileH;
  var numChars = gfx.count;
  var numTiles = Math.floor(numChars / charsPerTile);
  var charPxW = multicolor ? 4 : 8;
  var tilePxW = tileW * charPxW;
  var tilePxH = tileH * 8;
  var gap = 1;
  var gridCols = Math.min(numTiles, Math.max(1, Math.floor(320 / (tilePxW + gap))));
  var gridRows = Math.ceil(numTiles / gridCols);
  var w = gridCols * (tilePxW + gap) - gap;
  var h = gridRows * (tilePxH + gap) - gap;
  if (w < 1 || h < 1) return;
  ctx.canvas.width = w;
  ctx.canvas.height = h;
  var img = ctx.createImageData(w, h);
  var px = img.data;
  for (var fi = 3; fi < px.length; fi += 4) px[fi] = 255;
  var bgRgb = C64_RGB[colors.bg];
  var fgRgb = C64_RGB[colors.fg];
  var mc1Rgb = C64_RGB[colors.mc1];
  var mc2Rgb = C64_RGB[colors.mc2];

  for (var ti = 0; ti < numTiles; ti++) {
    var gridCol = ti % gridCols;
    var gridRow = Math.floor(ti / gridCols);
    var tileXOff = gridCol * (tilePxW + gap);
    var tileYOff = gridRow * (tilePxH + gap);

    for (var cy = 0; cy < tileH; cy++) {
      for (var cx = 0; cx < tileW; cx++) {
        var charIdx = ti * charsPerTile + cy * tileW + cx;
        if (charIdx >= numChars) continue;
        var base = charIdx * 8;

        for (var line = 0; line < 8; line++) {
          var byt = gfx.bm[base + line];
          if (multicolor) {
            for (var px2 = 0; px2 < 4; px2++) {
              var bits = (byt >> (6 - px2 * 2)) & 3;
              var rgb = bits === 0 ? bgRgb : bits === 1 ? mc1Rgb : bits === 2 ? fgRgb : mc2Rgb;
              var x = tileXOff + cx * charPxW + px2;
              var y = tileYOff + cy * 8 + line;
              if (x < w && y < h) {
                var off = (y * w + x) * 4;
                px[off] = rgb[0]; px[off+1] = rgb[1]; px[off+2] = rgb[2];
              }
            }
          } else {
            for (var bit = 7; bit >= 0; bit--) {
              var rgb2 = (byt & (1 << bit)) ? fgRgb : bgRgb;
              var x2 = tileXOff + cx * 8 + (7 - bit);
              var y2 = tileYOff + cy * 8 + line;
              if (x2 < w && y2 < h) {
                var off2 = (y2 * w + x2) * 4;
                px[off2] = rgb2[0]; px[off2+1] = rgb2[1]; px[off2+2] = rgb2[2];
              }
            }
          }
        }
      }
    }
  }
  ctx.putImageData(img, 0, 0);
}

function renderC64PrintShop(ctx, gfx) {
  var w = gfx.width || 88;
  var h = gfx.height || 52;
  var bpr = gfx.bytesPerRow || 11;
  ctx.canvas.width = w;
  ctx.canvas.height = h;
  var img = ctx.createImageData(w, h);
  var px = img.data;
  var fg = C64_RGB[0]; // black
  var bg = C64_RGB[1]; // white

  for (var y = 0; y < h && y * bpr < gfx.bm.length; y++) {
    for (var x = 0; x < w; x++) {
      var byteIdx = y * bpr + Math.floor(x / 8);
      var bitIdx = 7 - (x % 8);
      var set = byteIdx < gfx.bm.length && (gfx.bm[byteIdx] & (1 << bitIdx));
      var rgb = set ? fg : bg;
      var off = (y * w + x) * 4;
      px[off] = rgb[0]; px[off+1] = rgb[1]; px[off+2] = rgb[2]; px[off+3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
}

function renderGfxToCanvas(ctx, fmt, fileData, colors) {
  var parser = GFX_PARSERS[fmt.layout];
  if (!parser) return;
  var gfx = parser(fileData);

  // Apply background color override for bitmap modes
  if (colors && colors.bg !== undefined && (fmt.mode === 'mc' || fmt.layout === 'drp' || fmt.layout === 'drazlace')) {
    gfx.bg = colors.bg;
    if (gfx.rowBg) {
      gfx.rowBg = new Uint8Array(gfx.rowBg.length);
      for (var ri = 0; ri < gfx.rowBg.length; ri++) gfx.rowBg[ri] = colors.bg;
    }
  }

  var mode = fmt.mode;
  // Parse tile dimensions and MC flag from mode string
  var isMC = mode.indexOf('-mc') >= 0 || mode === 'sprites-mc';
  var tileMatch = mode.match(/(\d+)x(\d+)/);
  var tileW = tileMatch ? parseInt(tileMatch[1]) : 1;
  var tileH = tileMatch ? parseInt(tileMatch[2]) : 1;

  if (mode === 'sprites' || mode === 'sprites-mc') {
    renderC64Sprites(ctx, gfx, mode === 'sprites-mc', colors);
  } else if (mode.indexOf('charset') === 0) {
    renderC64Charset(ctx, gfx, tileW, tileH, colors, isMC);
  } else if (fmt.mode === 'printshop') {
    renderC64PrintShop(ctx, gfx);
  } else if (fmt.layout === 'drp' || fmt.layout === 'drazlace') {
    renderC64MulticolorDrp(ctx, gfx);
  } else if (fmt.mode === 'mc') {
    renderC64Multicolor(ctx, gfx);
  } else if (fmt.mode === 'hires') {
    renderC64Hires(ctx, gfx);
  } else if (fmt.mode === 'fli') {
    renderC64FLI(ctx, gfx);
  } else if (fmt.mode === 'afli') {
    renderC64AFLI(ctx, gfx);
  }
}

function showFileGfxViewer(entryOff) {
  if (!currentBuffer) return;
  var data = new Uint8Array(currentBuffer);
  var result = readFileData(currentBuffer, entryOff);
  var fileData = result.data;
  var name = petsciiToReadable(readPetsciiString(data, entryOff + 5, 16)).trim();

  var matches = detectGfxFormats(fileData);
  if (matches.length === 0) {
    showModal('Graphics View', ['Unrecognized graphics format (' + fileData.length + ' bytes).']);
    return;
  }

  var activeFmt = matches[0];
  // Color state for sprites/charset/bitmap
  var gfxColors = { bg: 0, fg: 1, mc1: 2, mc2: 3 };

  // For multicolor bitmaps, try to read bg from file
  var needsColorPicker = false;
  var colorLabels = null;

  function updateColorContext() {
    var mode = activeFmt.mode;
    if (mode === 'mc' || activeFmt.layout === 'drp' || activeFmt.layout === 'drazlace') {
      needsColorPicker = true;
      colorLabels = [{ key: 'bg', label: 'Background' }];
      var parser = GFX_PARSERS[activeFmt.layout];
      if (parser) {
        var gfx = parser(fileData);
        if (gfx.bg !== undefined) gfxColors.bg = gfx.bg & 0x0F;
      }
    } else if (mode.indexOf('sprite') >= 0 || mode.indexOf('charset') >= 0) {
      needsColorPicker = true;
      var isMC = mode.indexOf('-mc') >= 0;
      colorLabels = [{ key: 'bg', label: 'BG' }, { key: 'fg', label: 'FG' }];
      if (isMC) {
        colorLabels.push({ key: 'mc1', label: 'MC1' });
        colorLabels.push({ key: 'mc2', label: 'MC2' });
      }
    } else {
      needsColorPicker = false;
      colorLabels = null;
    }
  }

  updateColorContext();

  function buildColorPicker(body) {
    if (!needsColorPicker || !colorLabels) return;
    var row = document.createElement('div');
    row.style.cssText = 'margin-top:8px;display:flex;gap:12px;align-items:center;flex-wrap:wrap';

    for (var li = 0; li < colorLabels.length; li++) {
      (function(lbl) {
        var group = document.createElement('div');
        group.style.cssText = 'display:flex;gap:2px;align-items:center';
        var label = document.createElement('span');
        label.textContent = lbl.label + ':';
        label.style.cssText = 'font-size:11px;color:var(--text-muted);margin-right:2px';
        group.appendChild(label);

        for (var ci = 0; ci < 16; ci++) {
          (function(colorIdx) {
            var swatch = document.createElement('div');
            var isActive = gfxColors[lbl.key] === colorIdx;
            swatch.style.cssText = 'width:14px;height:14px;cursor:pointer;border:2px solid ' +
              (isActive ? 'var(--text)' : 'transparent') +
              ';border-radius:2px;background:' + C64_COLORS[colorIdx];
            swatch.title = lbl.label + ': ' + colorIdx;
            swatch.addEventListener('click', function() {
              gfxColors[lbl.key] = colorIdx;
              render();
            });
            group.appendChild(swatch);
          })(ci);
        }
        row.appendChild(group);
      })(colorLabels[li]);
    }
    body.appendChild(row);
  }

  function render() {
    document.getElementById('modal-title').textContent = activeFmt.name + ' \u2014 "' + name + '" (' + (fileData.length - 2) + ' bytes)';
    var body = document.getElementById('modal-body');
    body.innerHTML = '';

    // Format selector if multiple matches
    if (matches.length > 1) {
      var sel = document.createElement('div');
      sel.style.cssText = 'margin-bottom:8px;display:flex;gap:4px;flex-wrap:wrap';
      for (var mi = 0; mi < matches.length; mi++) {
        (function(m) {
          var btn = document.createElement('button');
          btn.textContent = m.name;
          btn.style.cssText = 'font-size:11px;padding:2px 8px;cursor:pointer;border:1px solid var(--border);border-radius:3px;background:' +
            (m === activeFmt ? 'var(--accent);color:var(--bg)' : 'var(--hover);color:var(--text)');
          btn.addEventListener('click', function() {
            activeFmt = m;
            updateColorContext();
            render();
          });
          sel.appendChild(btn);
        })(matches[mi]);
      }
      body.appendChild(sel);
    }

    var canvas = document.createElement('canvas');
    canvas.className = 'gfx-canvas';
    renderGfxToCanvas(canvas.getContext('2d'), activeFmt, fileData, gfxColors);

    var scale;
    if (activeFmt.mode === 'printshop') {
      scale = 4;
    } else if (activeFmt.mode.indexOf('sprite') >= 0 || activeFmt.mode.indexOf('charset') >= 0) {
      scale = Math.max(2, Math.min(4, Math.floor(600 / (canvas.width || 1))));
    } else {
      scale = 2;
    }
    canvas.style.width = (canvas.width * scale) + 'px';
    canvas.style.height = (canvas.height * scale) + 'px';
    body.appendChild(canvas);

    buildColorPicker(body);
  }

  render();

  var footer = document.querySelector('#modal-overlay .modal-footer');
  footer.innerHTML = '<button id="modal-close">OK</button>';
  document.getElementById('modal-close').addEventListener('click', function() {
    document.getElementById('modal-overlay').classList.remove('open');
  });
  document.getElementById('modal-overlay').classList.add('open');
}

// ── BASIC detokenizer ─────────────────────────────────────────────────
// BASIC V2 tokens ($80-$CB) — C64, VIC-20, C128 (shared base)
var BASIC_V2_TOKENS = [
  'END','FOR','NEXT','DATA','INPUT#','INPUT','DIM','READ',       // $80-$87
  'LET','GOTO','RUN','IF','RESTORE','GOSUB','RETURN','REM',      // $88-$8F
  'STOP','ON','WAIT','LOAD','SAVE','VERIFY','DEF','POKE',        // $90-$97
  'PRINT#','PRINT','CONT','LIST','CLR','CMD','SYS','OPEN',       // $98-$9F
  'CLOSE','GET','NEW','TAB(','TO','FN','SPC(','THEN',             // $A0-$A7
  'NOT','STEP','+','-','*','/','^','AND',                         // $A8-$AF
  'OR','>','=','<','SGN','INT','ABS','USR',                       // $B0-$B7
  'FRE','POS','SQR','RND','LOG','EXP','COS','SIN',               // $B8-$BF
  'TAN','ATN','PEEK','LEN','STR$','VAL','ASC','CHR$',            // $C0-$C7
  'LEFT$','RIGHT$','MID$','GO'                                    // $C8-$CB
];

// BASIC V7 extended single-byte tokens ($CC-$FD) — C128
var BASIC_V7_TOKENS = [
  'RGR','RCLR',                                                   // $CC-$CD
  null,                                                            // $CE = prefix
  'JOY','RDOT','DEC','HEX$','ERR$','INSTR',                      // $CF-$D4
  'ELSE','RESUME','TRAP','TRON','TROFF','SOUND',                  // $D5-$DA
  'VOL','AUTO','PUDEF','GRAPHIC','PAINT','CHAR',                  // $DB-$E0
  'BOX','CIRCLE','GSHAPE','SSHAPE','DRAW','LOCATE',              // $E1-$E6
  'COLOR','SCNCLR','SCALE','HELP','DO','LOOP',                   // $E7-$EC
  'EXIT','DIRECTORY','DSAVE','DLOAD','HEADER','SCRATCH',          // $ED-$F2
  'COLLECT','COPY','RENAME','BACKUP','DELETE','RENUMBER',         // $F3-$F8
  'KEY','MONITOR','USING','UNTIL','WHILE',                        // $F9-$FD
  null                                                             // $FE = prefix
];

// BASIC V7 $CE prefix tokens (functions)
var BASIC_V7_CE_TOKENS = {
  0x02: 'POT', 0x03: 'BUMP', 0x04: 'PEN', 0x05: 'RSPPOS',
  0x06: 'RSPRITE', 0x07: 'RCOLOR', 0x08: 'XOR', 0x09: 'RWINDOW',
  0x0A: 'POINTER'
};

// BASIC V7 $FE prefix tokens (commands)
var BASIC_V7_FE_TOKENS = {
  0x02: 'BANK', 0x03: 'FILTER', 0x04: 'PLAY', 0x05: 'TEMPO',
  0x06: 'MOVSPR', 0x07: 'SPRITE', 0x08: 'SPRCOLOR', 0x09: 'RREG',
  0x0A: 'ENVELOPE', 0x0B: 'SLEEP', 0x0C: 'CATALOG', 0x0D: 'DOPEN',
  0x0E: 'APPEND', 0x0F: 'DCLOSE', 0x10: 'BSAVE', 0x11: 'BLOAD',
  0x12: 'RECORD', 0x13: 'CONCAT', 0x14: 'DVERIFY', 0x15: 'DCLEAR',
  0x16: 'SPRSAV', 0x17: 'COLLISION', 0x18: 'BEGIN', 0x19: 'BEND',
  0x1A: 'WINDOW', 0x1B: 'BOOT', 0x1C: 'WIDTH', 0x1D: 'SPRDEF',
  0x1E: 'QUIT', 0x1F: 'STASH', 0x21: 'FETCH', 0x23: 'SWAP',
  0x24: 'OFF', 0x25: 'FAST', 0x26: 'SLOW'
};

// Known BASIC load addresses → version
var BASIC_LOAD_ADDRS = {
  0x0401: 'V2',   // VIC-20 unexpanded
  0x0801: 'V2',   // C64
  0x1001: 'V2',   // VIC-20 +8K, C16/Plus4
  0x1201: 'V2',   // VIC-20 +16K
  0x1C01: 'V7'    // C128
};

// Control code names for display in strings/REM
var PETSCII_CTRL_NAMES = {
  0x03: 'stop', 0x05: 'wht', 0x07: 'bell', 0x0A: 'lf', 0x0D: 'cr',
  0x0E: 'lower', 0x11: 'down', 0x12: 'rvon', 0x13: 'home',
  0x14: 'del', 0x1C: 'red', 0x1D: 'right', 0x1E: 'grn', 0x1F: 'blu',
  0x81: 'orng', 0x8E: 'upper', 0x90: 'blk', 0x91: 'up',
  0x92: 'rvof', 0x93: 'clr', 0x95: 'brn', 0x96: 'lred',
  0x97: 'dgry', 0x98: 'mgry', 0x99: 'lgrn', 0x9A: 'lblu',
  0x9B: 'lgry', 0x9C: 'pur', 0x9D: 'left', 0x9E: 'yel', 0x9F: 'cyn'
};

// Check if file data looks like a BASIC program
function isBasicProgram(fileData) {
  if (!fileData || fileData.length < 6) return false;
  var addr = fileData[0] | (fileData[1] << 8);
  return BASIC_LOAD_ADDRS[addr] !== undefined;
}

function emitLiteral(parts, b, type) {
  if (b >= 0x20 && b <= 0x7E) {
    parts.push({ type: type, text: String.fromCharCode(b) });
  } else if (PETSCII_CTRL_NAMES[b]) {
    parts.push({ type: 'ctrl', text: '{' + PETSCII_CTRL_NAMES[b] + '}' });
  } else if (b >= 0xA0 || (b >= 0x01 && b <= 0x1F)) {
    parts.push({ type: type, text: PETSCII_MAP[b] || '?' });
  } else {
    parts.push({ type: 'ctrl', text: '{$' + b.toString(16).toUpperCase().padStart(2, '0') + '}' });
  }
}

function detokenizeBasic(fileData) {
  if (fileData.length < 4) return null;

  var loadAddr = fileData[0] | (fileData[1] << 8);
  var version = BASIC_LOAD_ADDRS[loadAddr] || 'V2';
  var isV7 = version === 'V7';
  var lines = [];
  var pos = 2;

  while (pos < fileData.length - 1) {
    var nextPtr = fileData[pos] | (fileData[pos + 1] << 8);
    if (nextPtr === 0) break;

    var lineNum = fileData[pos + 2] | (fileData[pos + 3] << 8);
    pos += 4;

    var parts = [];
    var inQuotes = false;
    var inRem = false;
    var inData = false;

    while (pos < fileData.length && fileData[pos] !== 0x00) {
      var b = fileData[pos];

      // Inside REM: everything is literal
      if (inRem) {
        emitLiteral(parts, b, 'rem');
        pos++;
        continue;
      }

      // Quote toggle
      if (b === 0x22) {
        inQuotes = !inQuotes;
        parts.push({ type: 'string', text: '"' });
        pos++;
        continue;
      }

      // Inside quotes or DATA: literal characters
      if (inQuotes) {
        emitLiteral(parts, b, 'string');
        pos++;
        continue;
      }

      // Colon ends DATA mode
      if (inData && b === 0x3A) inData = false;

      // Inside DATA values: treat as literal (no token expansion)
      if (inData) {
        emitLiteral(parts, b, 'text');
        pos++;
        continue;
      }

      // V7 prefix tokens
      if (isV7 && b === 0xCE && pos + 1 < fileData.length) {
        var ceToken = BASIC_V7_CE_TOKENS[fileData[pos + 1]];
        if (ceToken) {
          parts.push({ type: 'keyword', text: ceToken });
          pos += 2;
          continue;
        }
      }
      if (isV7 && b === 0xFE && pos + 1 < fileData.length) {
        var feToken = BASIC_V7_FE_TOKENS[fileData[pos + 1]];
        if (feToken) {
          parts.push({ type: 'keyword', text: feToken });
          pos += 2;
          continue;
        }
      }

      // V7 single-byte extended tokens ($CC-$FD)
      if (isV7 && b >= 0xCC && b <= 0xFD) {
        var v7kw = BASIC_V7_TOKENS[b - 0xCC];
        if (v7kw) {
          parts.push({ type: 'keyword', text: v7kw });
          pos++;
          continue;
        }
      }

      // V2 tokens ($80-$CB)
      if (b >= 0x80 && b <= 0xCB) {
        var keyword = BASIC_V2_TOKENS[b - 0x80];
        parts.push({ type: 'keyword', text: keyword });
        if (keyword === 'REM') inRem = true;
        if (keyword === 'DATA') inData = true;
        pos++;
        continue;
      }

      // Literal character
      if (b >= 0x20 && b <= 0x7E) {
        parts.push({ type: 'text', text: String.fromCharCode(b) });
      } else {
        parts.push({ type: 'ctrl', text: '{$' + b.toString(16).toUpperCase().padStart(2, '0') + '}' });
      }
      pos++;
    }

    if (pos < fileData.length) pos++;
    lines.push({ lineNum: lineNum, parts: parts });
  }

  return { loadAddr: loadAddr, version: version, lines: lines };
}

function showFileBasicViewer(entryOff) {
  if (!currentBuffer) return;
  var data = new Uint8Array(currentBuffer);
  var result = readFileData(currentBuffer, entryOff);
  var fileData = result.data;
  var name = petsciiToReadable(readPetsciiString(data, entryOff + 5, 16)).trim();

  var basic = detokenizeBasic(fileData);
  if (!basic || basic.lines.length === 0) {
    showModal('BASIC View', ['Not a valid BASIC program or empty file.']);
    return;
  }

  var html = '<div class="basic-listing">';
  for (var li = 0; li < basic.lines.length; li++) {
    var line = basic.lines[li];
    html += '<div class="basic-line">';
    html += '<span class="basic-linenum">' + line.lineNum + ' </span>';
    for (var pi = 0; pi < line.parts.length; pi++) {
      var part = line.parts[pi];
      switch (part.type) {
        case 'keyword':
          html += '<span class="basic-keyword">' + escHtml(part.text) + '</span>';
          break;
        case 'string':
          html += '<span class="basic-string">' + escHtml(part.text) + '</span>';
          break;
        case 'rem':
          html += '<span class="basic-rem">' + escHtml(part.text) + '</span>';
          break;
        case 'ctrl':
          html += '<span class="basic-ctrl">' + escHtml(part.text) + '</span>';
          break;
        default:
          html += escHtml(part.text);
          break;
      }
    }
    html += '</div>';
  }
  html += '</div>';

  var versionLabel = basic.version === 'V7' ? 'BASIC V7 (C128)' : 'BASIC V2';
  var titleText = versionLabel + ' \u2014 "' + name + '" (load: $' +
    basic.loadAddr.toString(16).toUpperCase().padStart(4, '0') + ')';
  if (result.error) titleText += ' \u2014 ' + result.error;

  document.getElementById('modal-title').textContent = titleText;
  var body = document.getElementById('modal-body');
  body.innerHTML = html;

  var footer = document.querySelector('#modal-overlay .modal-footer');
  footer.innerHTML = '<button id="modal-close">OK</button>';
  document.getElementById('modal-close').addEventListener('click', function() {
    document.getElementById('modal-overlay').classList.remove('open');
  });
  document.getElementById('modal-overlay').classList.add('open');
}

// ── C64 screen renderer (CHROUT $FFD2 simulation) ────────────────────

// Map PETSCII control codes to color indices
var PETSCII_COLOR_MAP = {
  0x05: 1,  // white
  0x1C: 2,  // red
  0x1E: 5,  // green
  0x1F: 6,  // blue
  0x81: 8,  // orange
  0x90: 0,  // black
  0x95: 9,  // brown
  0x96: 10, // light red
  0x97: 11, // dark grey
  0x98: 12, // medium grey
  0x99: 13, // light green
  0x9A: 14, // light blue
  0x9B: 15, // light grey
  0x9C: 4,  // purple
  0x9E: 7,  // yellow
  0x9F: 3   // cyan
};

function showFilePetsciiViewer(entryOff) {
  if (!currentBuffer) return;
  var data = new Uint8Array(currentBuffer);
  var result = readFileData(currentBuffer, entryOff);
  var fileData = result.data;
  var name = petsciiToReadable(readPetsciiString(data, entryOff + 5, 16)).trim();

  // Virtual 40x25 screen
  var W = 40, H = 25;
  var screen = [];
  for (var i = 0; i < W * H; i++) {
    screen[i] = { ch: 0x20, color: 14, reverse: false }; // light blue on blue, like C64 default
  }

  var curX = 0, curY = 0, curColor = 14, reverseOn = false;
  var lowercase = false;

  function putChar(petscii) {
    if (curY >= H) return; // off screen
    var idx = curY * W + curX;
    screen[idx] = { ch: petscii, color: curColor, reverse: reverseOn };
    curX++;
    if (curX >= W) {
      curX = 0;
      curY++;
    }
  }

  // Process each byte through CHROUT
  for (var bi = 0; bi < fileData.length; bi++) {
    var b = fileData[bi];

    // Color control codes
    if (PETSCII_COLOR_MAP[b] !== undefined) {
      curColor = PETSCII_COLOR_MAP[b];
      continue;
    }

    switch (b) {
      case 0x00: break; // null — ignored
      case 0x0D: // carriage return
        curX = 0;
        curY++;
        break;
      case 0x0E: // switch to lowercase
        lowercase = true;
        break;
      case 0x11: // cursor down
        curY++;
        break;
      case 0x12: // reverse on
        reverseOn = true;
        break;
      case 0x13: // home
        curX = 0;
        curY = 0;
        break;
      case 0x14: // delete (backspace)
        if (curX > 0) curX--;
        else if (curY > 0) { curY--; curX = W - 1; }
        screen[curY * W + curX] = { ch: 0x20, color: curColor, reverse: false };
        break;
      case 0x8E: // switch to uppercase
        lowercase = false;
        break;
      case 0x91: // cursor up
        if (curY > 0) curY--;
        break;
      case 0x92: // reverse off
        reverseOn = false;
        break;
      case 0x93: // clear screen
        for (var ci = 0; ci < W * H; ci++) {
          screen[ci] = { ch: 0x20, color: curColor, reverse: false };
        }
        curX = 0;
        curY = 0;
        break;
      case 0x1D: // cursor right
        curX++;
        if (curX >= W) { curX = 0; curY++; }
        break;
      case 0x9D: // cursor left
        if (curX > 0) curX--;
        else if (curY > 0) { curY--; curX = W - 1; }
        break;
      default:
        // Printable character ranges
        if ((b >= 0x20 && b <= 0x7F) || (b >= 0xA0 && b <= 0xFF)) {
          putChar(b);
        }
        // Other control codes (F-keys, etc.) — ignored
        break;
    }

    // Scroll if cursor past bottom
    if (curY >= H) {
      // Scroll screen up
      for (var si = 0; si < W * (H - 1); si++) {
        screen[si] = screen[si + W];
      }
      for (var si2 = W * (H - 1); si2 < W * H; si2++) {
        screen[si2] = { ch: 0x20, color: curColor, reverse: false };
      }
      curY = H - 1;
    }
  }

  // Render screen to HTML
  // Use uppercase or lowercase PETSCII map based on charset mode
  var html = '<div class="c64-screen">';
  for (var row = 0; row < H; row++) {
    html += '<div class="c64-screen-row">';
    for (var col = 0; col < W; col++) {
      var cell = screen[row * W + col];
      var fg = C64_COLORS[cell.color];
      var bg = 'transparent';
      if (cell.reverse) {
        bg = fg;
        fg = '#352879'; // screen background color (C64 blue)
      }
      // Use the appropriate PETSCII map character
      var displayChar;
      if (lowercase && cell.ch >= 0x41 && cell.ch <= 0x5A) {
        // Uppercase PETSCII → lowercase display (E1xx range)
        displayChar = String.fromCharCode(0xE100 + cell.ch);
      } else if (lowercase && cell.ch >= 0xC1 && cell.ch <= 0xDA) {
        // Shifted uppercase in lowercase mode → uppercase display (E0xx range)
        displayChar = String.fromCharCode(0xE000 + cell.ch);
      } else {
        displayChar = PETSCII_MAP[cell.ch] || ' ';
      }
      html += '<span class="c64-screen-char" style="color:' + fg +
        (bg !== 'transparent' ? ';background:' + bg : '') +
        '">' + escHtml(displayChar) + '</span>';
    }
    html += '</div>';
  }
  html += '</div>';

  var titleText = 'PETSCII View \u2014 "' + name + '"';
  if (result.error) titleText += ' \u2014 ' + result.error;

  document.getElementById('modal-title').textContent = titleText;
  var body = document.getElementById('modal-body');
  body.innerHTML = html;

  var footer = document.querySelector('#modal-overlay .modal-footer');
  footer.innerHTML = '<button id="modal-close">OK</button>';
  document.getElementById('modal-close').addEventListener('click', function() {
    document.getElementById('modal-overlay').classList.remove('open');
  });
  document.getElementById('modal-overlay').classList.add('open');
}

// ── File hex viewer (read-only) ───────────────────────────────────────
function showFileHexViewer(entryOff) {
  if (!currentBuffer) return;
  var data = new Uint8Array(currentBuffer);
  var result = readFileData(currentBuffer, entryOff);
  var fileData = result.data;
  var name = petsciiToReadable(readPetsciiString(data, entryOff + 5, 16)).trim();

  var html = '<div class="hex-editor">';
  var totalBytes = fileData.length;
  var rows = Math.ceil(totalBytes / 8) || 1;

  for (var row = 0; row < rows; row++) {
    var rowOff = row * 8;
    html += '<div class="hex-row">';
    html += '<span class="hex-offset">' + rowOff.toString(16).toUpperCase().padStart(4, '0') + '</span>';
    html += '<span class="hex-bytes">';
    for (var col = 0; col < 8; col++) {
      var idx = rowOff + col;
      if (idx < totalBytes) {
        html += '<span class="hex-byte">' + fileData[idx].toString(16).toUpperCase().padStart(2, '0') + '</span>';
      } else {
        html += '<span class="hex-byte" style="opacity:0.2">--</span>';
      }
    }
    html += '</span>';
    html += '<span class="hex-separator"></span>';
    html += '<span class="hex-ascii">';
    for (var col2 = 0; col2 < 8; col2++) {
      var idx2 = rowOff + col2;
      if (idx2 < totalBytes) {
        html += '<span class="hex-char">' + escHtml(PETSCII_MAP[fileData[idx2]]) + '</span>';
      } else {
        html += '<span class="hex-char" style="opacity:0.2">.</span>';
      }
    }
    html += '</span>';
    html += '</div>';
  }
  html += '</div>';

  var titleText = 'Hex View \u2014 "' + name + '" (' + totalBytes + ' bytes)';
  if (result.error) titleText += ' \u2014 ' + result.error;

  document.getElementById('modal-title').textContent = titleText;
  var body = document.getElementById('modal-body');
  body.innerHTML = html;

  var footer = document.querySelector('#modal-overlay .modal-footer');
  footer.innerHTML = '<button id="modal-close">OK</button>';
  document.getElementById('modal-close').addEventListener('click', function() {
    document.getElementById('modal-overlay').classList.remove('open');
  });
  document.getElementById('modal-overlay').classList.add('open');
}

// ── Hex sector editor ─────────────────────────────────────────────────
function showSectorHexEditor(track, sector) {
  if (!currentBuffer) return;
  var off = sectorOffset(track, sector);
  if (off < 0) return;
  var data = new Uint8Array(currentBuffer);

  // Copy original sector data for comparison
  var original = new Uint8Array(256);
  for (var i = 0; i < 256; i++) original[i] = data[off + i];

  // Working copy
  var working = new Uint8Array(256);
  for (i = 0; i < 256; i++) working[i] = original[i];

  var html = '<div class="hex-editor">';
  for (var row = 0; row < 32; row++) {
    var rowOff = row * 8;
    html += '<div class="hex-row">';
    html += '<span class="hex-offset">' + rowOff.toString(16).toUpperCase().padStart(2, '0') + '</span>';
    html += '<span class="hex-bytes">';
    for (var col = 0; col < 8; col++) {
      var idx = rowOff + col;
      var b = working[idx];
      html += '<span class="hex-byte" data-idx="' + idx + '" data-row="' + row + '">' +
        b.toString(16).toUpperCase().padStart(2, '0') + '</span>';
    }
    html += '</span>';
    html += '<span class="hex-separator"></span>';
    html += '<span class="hex-ascii">';
    for (var col2 = 0; col2 < 8; col2++) {
      var idx2 = rowOff + col2;
      html += '<span class="hex-char" data-idx="' + idx2 + '">' + escHtml(PETSCII_MAP[working[idx2]]) + '</span>';
    }
    html += '</span>';
    html += '</div>';
  }
  html += '</div>';

  // Show modal with editable T/S in title and custom footer
  var titleEl = document.getElementById('modal-title');
  titleEl.innerHTML = 'Sector Editor \u2014 T:$' +
    '<span class="hex-nav-group">' +
      '<span id="hex-nav-track" class="hex-nav-field">' + track.toString(16).toUpperCase().padStart(2, '0') + '</span>' +
      '<span class="hex-nav-arrows">' +
        '<span class="hex-nav-btn" id="hex-track-up"><i class="fa-solid fa-chevron-up"></i></span>' +
        '<span class="hex-nav-btn" id="hex-track-down"><i class="fa-solid fa-chevron-down"></i></span>' +
      '</span>' +
    '</span>' +
    ' S:$' +
    '<span class="hex-nav-group">' +
      '<span id="hex-nav-sector" class="hex-nav-field">' + sector.toString(16).toUpperCase().padStart(2, '0') + '</span>' +
      '<span class="hex-nav-arrows">' +
        '<span class="hex-nav-btn" id="hex-sector-up"><i class="fa-solid fa-chevron-up"></i></span>' +
        '<span class="hex-nav-btn" id="hex-sector-down"><i class="fa-solid fa-chevron-down"></i></span>' +
      '</span>' +
    '</span>';

  var body = document.getElementById('modal-body');
  body.innerHTML = html;
  var footer = document.querySelector('#modal-overlay .modal-footer');
  var origFooter = footer.innerHTML;
  footer.innerHTML = '<button id="hex-cancel" class="modal-btn-secondary">Cancel</button><button id="hex-save">Save</button>';
  document.getElementById('modal-overlay').classList.add('open');

  var navTrack = track;
  var navSector = sector;

  function saveCurrentAndNavigate(newTrack, newSector) {
    // Save current edits if modified
    var hasChanges = false;
    for (var c = 0; c < 256; c++) { if (working[c] !== original[c]) { hasChanges = true; break; } }
    if (hasChanges) {
      for (var c2 = 0; c2 < 256; c2++) data[off + c2] = working[c2];
    }
    document.removeEventListener('keydown', onKeyDown);
    document.getElementById('modal-overlay').classList.remove('open');
    footer.innerHTML = origFooter;
    document.getElementById('modal-close').addEventListener('click', function() {
      document.getElementById('modal-overlay').classList.remove('open');
    });
    showSectorHexEditor(newTrack, newSector);
  }

  // Click track/sector field to edit inline
  function setupNavClick(spanId, getValue, validateFn, onCommit) {
    var span = document.getElementById(spanId);
    if (!span) return;
    span.addEventListener('click', function() {
      if (span.querySelector('input')) return;
      var curVal = getValue();
      var input = createHexInput({ value: curVal, maxBytes: 1, validate: validateFn });
      span.textContent = '';
      span.appendChild(input);
      input.focus();
      input.select();
      function commit() {
        if (input.isValid()) {
          onCommit(input.getValue());
        } else {
          span.textContent = getValue().toString(16).toUpperCase().padStart(2, '0');
        }
      }
      input.addEventListener('keydown', function(e) {
        if (e.key === 'Enter') { e.preventDefault(); commit(); }
        else if (e.key === 'Escape') { e.preventDefault(); span.textContent = getValue().toString(16).toUpperCase().padStart(2, '0'); }
        else if (e.key === 'Tab') { e.preventDefault(); commit(); }
      });
      input.addEventListener('blur', function() {
        setTimeout(function() { if (span.querySelector('input')) commit(); }, 150);
      });
    });
  }

  setupNavClick('hex-nav-track',
    function() { return navTrack; },
    function(val) { return val >= 1 && val <= currentTracks; },
    function(newTrack) {
      navTrack = newTrack;
      // Only reset sector if current sector is invalid for the new track
      if (navSector >= sectorsPerTrack(navTrack)) navSector = 0;
      document.getElementById('hex-nav-track').textContent = newTrack.toString(16).toUpperCase().padStart(2, '0');
      // Auto-focus sector
      var secSpan = document.getElementById('hex-nav-sector');
      secSpan.textContent = navSector.toString(16).toUpperCase().padStart(2, '0');
      setTimeout(function() { secSpan.click(); }, 50);
    }
  );

  setupNavClick('hex-nav-sector',
    function() { return navSector; },
    function(val) { return val >= 0 && val < sectorsPerTrack(navTrack); },
    function(newSector) {
      navSector = newSector;
      saveCurrentAndNavigate(navTrack, navSector);
    }
  );

  // Arrow buttons
  document.getElementById('hex-track-up').addEventListener('click', function() {
    if (navTrack < currentTracks) {
      navTrack++;
      if (navSector >= sectorsPerTrack(navTrack)) navSector = 0;
      saveCurrentAndNavigate(navTrack, navSector);
    }
  });
  document.getElementById('hex-track-down').addEventListener('click', function() {
    if (navTrack > 1) {
      navTrack--;
      if (navSector >= sectorsPerTrack(navTrack)) navSector = 0;
      saveCurrentAndNavigate(navTrack, navSector);
    }
  });
  document.getElementById('hex-sector-up').addEventListener('click', function() {
    if (navSector < sectorsPerTrack(navTrack) - 1) {
      navSector++;
    } else if (navTrack < currentTracks) {
      navTrack++;
      navSector = 0;
    } else {
      return;
    }
    saveCurrentAndNavigate(navTrack, navSector);
  });
  document.getElementById('hex-sector-down').addEventListener('click', function() {
    if (navSector > 0) {
      navSector--;
    } else if (navTrack > 1) {
      navTrack--;
      navSector = sectorsPerTrack(navTrack) - 1;
    } else {
      return;
    }
    saveCurrentAndNavigate(navTrack, navSector);
  });

  var editingByte = null;
  var editBuffer = '';

  function updateByte(idx, val) {
    working[idx] = val;
    var byteEl = body.querySelector('.hex-byte[data-idx="' + idx + '"]');
    var charEl = body.querySelector('.hex-char[data-idx="' + idx + '"]');
    if (byteEl) {
      byteEl.textContent = val.toString(16).toUpperCase().padStart(2, '0');
      byteEl.classList.toggle('modified', val !== original[idx]);
    }
    if (charEl) charEl.innerHTML = escHtml(PETSCII_MAP[val]);
  }

  function startEdit(idx) {
    stopEdit();
    editingByte = idx;
    editBuffer = '';
    var el = body.querySelector('.hex-byte[data-idx="' + idx + '"]');
    if (el) el.classList.add('editing');
  }

  function stopEdit() {
    if (editingByte !== null) {
      var el = body.querySelector('.hex-byte[data-idx="' + editingByte + '"]');
      if (el) el.classList.remove('editing');
      if (editBuffer.length === 1) {
        // Partial input — apply as high nibble with 0 low nibble
        updateByte(editingByte, parseInt(editBuffer + '0', 16));
      }
    }
    editingByte = null;
    editBuffer = '';
  }

  // Click to start editing a byte
  body.addEventListener('click', function(e) {
    var byteEl = e.target.closest('.hex-byte');
    if (byteEl) {
      var idx = parseInt(byteEl.getAttribute('data-idx'), 10);
      startEdit(idx);
    }
  });

  // Keyboard input for hex editing
  function onKeyDown(e) {
    if (editingByte === null) return;
    var hexChar = e.key.toUpperCase();

    if (/^[0-9A-F]$/.test(hexChar)) {
      e.preventDefault();
      editBuffer += hexChar;
      // Show partial input
      var el = body.querySelector('.hex-byte[data-idx="' + editingByte + '"]');
      if (el) el.textContent = editBuffer.padEnd(2, '_');

      if (editBuffer.length === 2) {
        var val = parseInt(editBuffer, 16);
        updateByte(editingByte, val);
        var curRow = Math.floor(editingByte / 8);
        var curCol = editingByte % 8;
        el.classList.remove('editing');
        if (curCol < 7) {
          // Move to next byte on same row
          startEdit(editingByte + 1);
        } else {
          // Last byte on row — stop editing
          stopEdit();
        }
      }
    } else if (e.key === 'Escape') {
      e.preventDefault();
      // Revert current byte to working value
      var el2 = body.querySelector('.hex-byte[data-idx="' + editingByte + '"]');
      if (el2) {
        el2.textContent = working[editingByte].toString(16).toUpperCase().padStart(2, '0');
        el2.classList.remove('editing');
      }
      editingByte = null;
      editBuffer = '';
    } else if (e.key === 'Tab') {
      e.preventDefault();
      var cur = editingByte;
      stopEdit();
      var next = e.shiftKey ? cur - 1 : cur + 1;
      if (next >= 0 && next < 256) startEdit(next);
    } else if (e.key === 'ArrowRight' && editBuffer.length === 0) {
      e.preventDefault();
      var cur2 = editingByte;
      stopEdit();
      if (cur2 < 255) startEdit(cur2 + 1);
    } else if (e.key === 'ArrowLeft' && editBuffer.length === 0) {
      e.preventDefault();
      var cur3 = editingByte;
      stopEdit();
      if (cur3 > 0) startEdit(cur3 - 1);
    }
  }

  document.addEventListener('keydown', onKeyDown);

  // Highlight on hover
  body.addEventListener('mouseover', function(e) {
    var t = e.target.closest('[data-idx]');
    if (!t) return;
    var idx = t.getAttribute('data-idx');
    body.querySelectorAll('.highlight').forEach(function(el) { el.classList.remove('highlight'); });
    body.querySelectorAll('[data-idx="' + idx + '"]').forEach(function(el) { el.classList.add('highlight'); });
  });
  body.addEventListener('mouseout', function(e) {
    var t = e.target.closest('[data-idx]');
    if (t) body.querySelectorAll('.highlight').forEach(function(el) { el.classList.remove('highlight'); });
  });

  // Close handlers
  function closeEditor(save) {
    document.removeEventListener('keydown', onKeyDown);
    if (save) {
      // Write working copy back to disk buffer
      for (var i = 0; i < 256; i++) data[off + i] = working[i];
      // Re-render disk view
      var info = parseCurrentDir(currentBuffer);
      renderDisk(info);
    }
    document.getElementById('modal-overlay').classList.remove('open');
    footer.innerHTML = origFooter;
    // Re-attach the OK button handler
    document.getElementById('modal-close').addEventListener('click', function() {
      document.getElementById('modal-overlay').classList.remove('open');
    });
  }

  document.getElementById('hex-save').addEventListener('click', function() { closeEditor(true); });
  document.getElementById('hex-cancel').addEventListener('click', function() { closeEditor(false); });
}

document.getElementById('opt-edit-sector').addEventListener('click', function(e) {
  e.stopPropagation();
  if (!currentBuffer || selectedEntryIndex < 0) return;
  closeMenus();

  // Find which directory sector this entry is in
  var slots = getDirSlotOffsets(currentBuffer);
  var slotIdx = slots.indexOf(selectedEntryIndex);
  var dirSectorIdx = Math.floor(slotIdx / currentFormat.entriesPerSector);
  var data = new Uint8Array(currentBuffer);
  var dt = currentFormat.dirTrack, ds = currentFormat.dirSector;
  var visited = new Set();
  for (var i = 0; i < dirSectorIdx && dt !== 0; i++) {
    var key = dt + ':' + ds;
    if (visited.has(key)) break;
    visited.add(key);
    var doff = sectorOffset(dt, ds);
    dt = data[doff]; ds = data[doff + 1];
  }

  showSectorHexEditor(dt, ds);
});

document.getElementById('opt-edit-file-sector').addEventListener('click', function(e) {
  e.stopPropagation();
  if (!currentBuffer || selectedEntryIndex < 0) return;
  closeMenus();

  // Get the file's starting track/sector from the directory entry
  var data = new Uint8Array(currentBuffer);
  var ft = data[selectedEntryIndex + 3];
  var fs = data[selectedEntryIndex + 4];
  if (ft === 0) return; // no file data

  showSectorHexEditor(ft, fs);
});

document.getElementById('opt-view-hex').addEventListener('click', function(e) {
  e.stopPropagation();
  if (!currentBuffer || selectedEntryIndex < 0) return;
  closeMenus();
  showFileHexViewer(selectedEntryIndex);
});

document.getElementById('opt-view-petscii').addEventListener('click', function(e) {
  e.stopPropagation();
  if (!currentBuffer || selectedEntryIndex < 0) return;
  closeMenus();
  showFilePetsciiViewer(selectedEntryIndex);
});

document.getElementById('opt-view-basic').addEventListener('click', function(e) {
  e.stopPropagation();
  if (!currentBuffer || selectedEntryIndex < 0) return;
  closeMenus();
  showFileBasicViewer(selectedEntryIndex);
});

document.getElementById('opt-view-gfx').addEventListener('click', function(e) {
  e.stopPropagation();
  if (!currentBuffer || selectedEntryIndex < 0) return;
  closeMenus();
  showFileGfxViewer(selectedEntryIndex);
});

document.getElementById('opt-edit-free').addEventListener('click', (e) => {
  e.stopPropagation();
  if (!currentBuffer) return;
  closeMenus();
  const footerBlocks = document.querySelector('.dir-footer-blocks');
  if (footerBlocks) startEditFreeBlocks(footerBlocks);
});



document.getElementById('opt-recalc-free').addEventListener('click', (e) => {
  e.stopPropagation();
  if (!currentBuffer) return;
  closeMenus();

  // Recalculate by following all file sector chains to find used sectors,
  // then rebuild the BAM free counts from scratch. Don't trust the existing BAM.
  const data = new Uint8Array(currentBuffer);
  const bamOff = sectorOffset(currentFormat.bamTrack, currentFormat.bamSector);

  // Build allocation map for all tracks
  const used = {};
  for (let t = 1; t <= currentTracks; t++) {
    used[t] = new Uint8Array(sectorsPerTrack(t));
  }

  // Track 18 sector 0 (BAM) is always used
  used[currentFormat.bamTrack][currentFormat.bamSector] = 1;

  // Mark directory chain sectors as used
  let dirT = currentFormat.dirTrack, dirS = currentFormat.dirSector;
  const dirVisited = new Set();
  while (dirT !== 0) {
    const key = `${dirT}:${dirS}`;
    if (dirVisited.has(key)) break;
    dirVisited.add(key);
    if (dirT < 1 || dirT > currentTracks || dirS < 0 || dirS >= sectorsPerTrack(dirT)) break;
    used[dirT][dirS] = 1;
    const off = sectorOffset(dirT, dirS);
    dirT = data[off];
    dirS = data[off + 1];
  }

  // Follow each closed file's sector chain
  const info = parseCurrentDir(currentBuffer);
  for (const entry of info.entries) {
    if (entry.deleted) continue;
    let ft = data[entry.entryOff + 3];
    let fs = data[entry.entryOff + 4];
    const visited = new Set();
    while (ft !== 0) {
      if (ft < 1 || ft > currentTracks) break;
      if (fs < 0 || fs >= sectorsPerTrack(ft)) break;
      const key = `${ft}:${fs}`;
      if (visited.has(key)) break;
      visited.add(key);
      used[ft][fs] = 1;
      const off = sectorOffset(ft, fs);
      ft = data[off];
      fs = data[off + 1];
    }
  }

  // Read old total
  const oldInfo = parseCurrentDir(currentBuffer);
  const oldFree = oldInfo.freeBlocks;

  // Update only the free block counts per track, leave BAM bitmaps untouched
  // BAM only covers tracks 1-35
  for (let t = 1; t <= currentFormat.bamTracksRange(currentTracks); t++) {
    if (t === currentFormat.dirTrack) continue;
    const spt = sectorsPerTrack(t);
    let free = 0;
    for (let s = 0; s < spt; s++) {
      if (!used[t][s]) free++;
    }
    currentFormat.writeTrackFree(data, bamOff, t, free);
  }

  const updatedInfo = parseCurrentDir(currentBuffer);
  renderDisk(updatedInfo);

  const newFree = updatedInfo.freeBlocks;
  if (oldFree === newFree) {
    showModal('Recalculate Blocks Free', ['Blocks free is correct: ' + newFree + '.']);
  } else {
    showModal('Recalculate Blocks Free', ['Changed from ' + oldFree + ' to ' + newFree + ' blocks free.']);
  }
});

// ── Move directory entry ──────────────────────────────────────────────
// Get ordered list of directory entry offsets from the chain
// ── Partition-aware parse helper ──────────────────────────────────────
function parseCurrentDir(buffer) {
  if (currentPartition) {
    return parsePartition(buffer, currentPartition.startTrack, currentPartition.partSize);
  }
  return parseDisk(buffer);
}

// ── Partition-aware directory helpers ──────────────────────────────────
// Returns { dirTrack, dirSector, dirTrackNum, bamOff, maxDirSectors }
// for the current context (root or partition)
function getDirContext() {
  if (currentPartition) {
    var st = currentPartition.startTrack;
    return {
      dirTrack: st, dirSector: 3, dirTrackNum: st,
      bamOff: sectorOffset(st, 1),
      maxDirSectors: 37 // same as D81 root (sectors 3-39 on the partition's first track)
    };
  }
  return {
    dirTrack: currentFormat.dirTrack, dirSector: currentFormat.dirSector,
    dirTrackNum: currentFormat.dirTrack,
    bamOff: sectorOffset(currentFormat.bamTrack, currentFormat.bamSector),
    maxDirSectors: currentFormat.maxDirSectors
  };
}

function getDirSlotOffsets(buffer) {
  const data = new Uint8Array(buffer);
  const offsets = [];
  var ctx = getDirContext();
  let t = ctx.dirTrack, s = ctx.dirSector;
  const visited = new Set();
  while (t !== 0) {
    const key = `${t}:${s}`;
    if (visited.has(key)) break;
    visited.add(key);
    const off = sectorOffset(t, s);
    if (off < 0) break;
    for (let i = 0; i < currentFormat.entriesPerSector; i++) offsets.push(off + i * currentFormat.entrySize);
    t = data[off];
    s = data[off + 1];
  }
  return offsets;
}

function swapDirEntries(buffer, offA, offB) {
  if (offA === offB) return;
  const data = new Uint8Array(buffer);
  // Swap bytes 2-31 (entry data, skip 0-1 which are chain links for entry 0)
  for (let j = 2; j < 32; j++) {
    const tmp = data[offA + j];
    data[offA + j] = data[offB + j];
    data[offB + j] = tmp;
  }
}

function moveEntry(direction) {
  if (!currentBuffer || selectedEntryIndex < 0) return;
  const slots = getDirSlotOffsets(currentBuffer);
  const currentIdx = slots.indexOf(selectedEntryIndex);
  if (currentIdx < 0) return;

  const targetIdx = currentIdx + direction;
  if (targetIdx < 0 || targetIdx >= slots.length) return;

  swapDirEntries(currentBuffer, slots[currentIdx], slots[targetIdx]);
  // Update selection to follow the moved entry
  selectedEntryIndex = slots[targetIdx];
  const info = parseCurrentDir(currentBuffer);
  renderDisk(info);
}

// ── Sort directory ────────────────────────────────────────────────────
function sortDirectory(buffer, sortType) {
  const data = new Uint8Array(buffer);

  // Collect all directory entry slots (raw 32-byte blocks) from the chain
  const slots = []; // { off, bytes, isEmpty, name, blocks }
  let t = currentFormat.dirTrack, s = currentFormat.dirSector;
  const visited = new Set();
  const sectorOffsets = [];

  while (t !== 0) {
    const key = `${t}:${s}`;
    if (visited.has(key)) break;
    visited.add(key);
    const off = sectorOffset(t, s);
    if (off < 0) break;
    sectorOffsets.push(off);

    for (let i = 0; i < 8; i++) {
      const eo = off + i * 32;
      const raw = data.slice(eo, eo + 32);
      const typeByte = raw[2];

      // Check if slot is empty
      let isEmpty = true;
      for (let j = 2; j < 32; j++) {
        if (raw[j] !== 0x00) { isEmpty = false; break; }
      }

      const name = readPetsciiString(data, eo + 5, 16);
      const blocks = raw[30] | (raw[31] << 8);

      slots.push({ off: eo, bytes: new Uint8Array(raw), isEmpty, name, blocks, typeByte });
    }

    t = data[off];
    s = data[off + 1];
  }

  // Separate non-empty and empty slots
  const entries = slots.filter(s => !s.isEmpty);
  const empties = slots.filter(s => s.isEmpty);

  // Sort non-empty entries
  if (sortType === 'name-asc') entries.sort((a, b) => a.name.localeCompare(b.name));
  else if (sortType === 'name-desc') entries.sort((a, b) => b.name.localeCompare(a.name));
  else if (sortType === 'blocks-asc') entries.sort((a, b) => a.blocks - b.blocks);
  else if (sortType === 'blocks-desc') entries.sort((a, b) => b.blocks - a.blocks);

  // Recombine: entries first, empties at end
  const sorted = [...entries, ...empties];

  // Write back to the directory sectors in order
  // Note: bytes 0-1 of each entry slot are NOT part of the entry data for entries 1-7.
  // Only entry 0 of each sector uses bytes 0-1 as the chain link (next T/S).
  // For entries 1-7, bytes 0-1 in their 32-byte slot are part of the entry but
  // conventionally unused (the real chain link is only in entry 0).
  for (let i = 0; i < sorted.length && i < slots.length; i++) {
    const targetOff = slots[i].off;
    const srcBytes = sorted[i].bytes;
    // Write bytes 2-31 (skip 0-1 which are chain link for entry 0 or unused)
    for (let j = 2; j < 32; j++) {
      data[targetOff + j] = srcBytes[j];
    }
  }
}

// ── Align filename ────────────────────────────────────────────────────
function getFilenameContent(data, entryOff) {
  // Find content: everything before the first 0xA0 padding byte
  const nameOff = entryOff + 5;
  let contentLen = 16;
  for (let i = 0; i < 16; i++) {
    if (data[nameOff + i] === 0xA0) { contentLen = i; break; }
  }
  const content = [];
  for (let i = 0; i < contentLen; i++) content.push(data[nameOff + i]);
  return content;
}

function writeFilenameAligned(data, entryOff, content) {
  const nameOff = entryOff + 5;
  for (let i = 0; i < 16; i++) {
    data[nameOff + i] = i < content.length ? content[i] : 0xA0;
  }
}

function alignFilename(buffer, entryOff, alignment) {
  const data = new Uint8Array(buffer);
  const content = getFilenameContent(data, entryOff);

  // Strip trailing 0x20 spaces and 0xA0 padding
  while (content.length > 0 && (content[content.length - 1] === 0x20 || content[content.length - 1] === 0xA0)) content.pop();
  // Strip leading 0x20 spaces
  while (content.length > 0 && content[0] === 0x20) content.shift();
  if (content.length >= 16) return;
  if (content.length === 0 && alignment !== 'expand') return;

  const result = new Uint8Array(16).fill(0x20); // fill with real spaces
  const padCount = 16 - content.length;

  if (alignment === 'left') {
    for (let i = 0; i < content.length; i++) result[i] = content[i];

  } else if (alignment === 'right') {
    for (let i = 0; i < content.length; i++) result[padCount + i] = content[i];

  } else if (alignment === 'center') {
    const leftPad = Math.floor(padCount / 2);
    for (let i = 0; i < content.length; i++) result[leftPad + i] = content[i];

  } else if (alignment === 'justify') {
    // Split into words (by 0x20 space)
    const words = [];
    let word = [];
    for (const b of content) {
      if (b === 0x20) {
        if (word.length) { words.push(word); word = []; }
      } else {
        word.push(b);
      }
    }
    if (word.length) words.push(word);

    if (words.length <= 1) {
      // Single word — left align
      for (let i = 0; i < content.length; i++) result[i] = content[i];
    } else {
      const totalChars = words.reduce((sum, w) => sum + w.length, 0);
      const totalGaps = words.length - 1;
      const totalSpaces = 16 - totalChars;
      if (totalSpaces < totalGaps) {
        // Not enough room — just left align
        for (let i = 0; i < content.length; i++) result[i] = content[i];
      } else {
        const baseSpaces = Math.floor(totalSpaces / totalGaps);
        let extraSpaces = totalSpaces % totalGaps;
        let pos = 0;
        for (let w = 0; w < words.length; w++) {
          for (const b of words[w]) result[pos++] = b;
          if (w < words.length - 1) {
            let spaces = baseSpaces + (extraSpaces > 0 ? 1 : 0);
            if (extraSpaces > 0) extraSpaces--;
            for (let s = 0; s < spaces; s++) result[pos++] = 0x20;
          }
        }
      }
    }

  } else if (alignment === 'expand') {
    // Pad filename with 0x20 spaces to fill all 16 bytes
    for (let i = 0; i < content.length; i++) result[i] = content[i];
    for (let i = content.length; i < 16; i++) result[i] = 0x20;
  }

  writeFilenameAligned(data, entryOff, result);
}

// ── Remove directory entry ────────────────────────────────────────────
function removeFileEntry(buffer, entryOff) {
  const data = new Uint8Array(buffer);
  const slots = getDirSlotOffsets(buffer);
  const idx = slots.indexOf(entryOff);
  if (idx < 0) return;

  // If removing a CBM partition, free its tracks in the root BAM
  var typeByte = data[entryOff + 2];
  if ((typeByte & 0x07) === 5 && currentFormat === DISK_FORMATS.d81) {
    var partStart = data[entryOff + 3];
    var partSize = data[entryOff + 30] | (data[entryOff + 31] << 8);
    var partTracks = Math.floor(partSize / 40);
    var fmt = currentFormat;
    var bamOff = sectorOffset(fmt.bamTrack, fmt.bamSector);

    for (var pt = partStart; pt < partStart + partTracks; pt++) {
      var spt = fmt.sectorsPerTrack(pt);
      var rbase;
      if (pt <= 40) {
        rbase = bamOff + 0x10 + (pt - 1) * 6;
      } else {
        rbase = bamOff + 256 + 0x10 + (pt - 41) * 6;
      }
      // Mark all sectors as free
      data[rbase] = spt; // free count = all sectors
      for (var rb = 0; rb < 5; rb++) data[rbase + 1 + rb] = 0xFF;
    }
  }

  // Shift all entries after the removed one up by one slot
  for (let i = idx; i < slots.length - 1; i++) {
    const src = slots[i + 1];
    const dst = slots[i];
    // Copy bytes 2-31 (entry data, preserve chain links)
    for (let j = 2; j < 32; j++) {
      data[dst + j] = data[src + j];
    }
  }

  // Zero out the last slot (now a duplicate or was already empty)
  const lastSlot = slots[slots.length - 1];
  for (let j = 2; j < 32; j++) {
    data[lastSlot + j] = 0x00;
  }
}

// ── Insert file entry ─────────────────────────────────────────────────
function getMaxDirEntries() {
  var ctx = getDirContext();
  return ctx.maxDirSectors * currentFormat.entriesPerSector;
}

function countDirEntries() {
  if (!currentBuffer) return 0;
  const data = new Uint8Array(currentBuffer);
  var ctx = getDirContext();
  let count = 0;
  let t = ctx.dirTrack, s = ctx.dirSector;
  const visited = new Set();
  while (t !== 0) {
    const key = `${t}:${s}`;
    if (visited.has(key)) break;
    visited.add(key);
    const off = sectorOffset(t, s);
    if (off < 0) break;
    for (let i = 0; i < 8; i++) {
      const eo = off + i * 32;
      const typeByte = data[eo + 2];
      if (typeByte !== 0x00) { count++; continue; }
      let hasData = false;
      for (let j = 3; j < 32; j++) {
        if (data[eo + j] !== 0x00) { hasData = true; break; }
      }
      if (hasData) count++;
    }
    t = data[off];
    s = data[off + 1];
  }
  return count;
}

function canInsertFile() {
  if (!currentBuffer) return false;
  return countDirEntries() < getMaxDirEntries();
}

function insertFileEntry() {
  if (!currentBuffer) return -1;
  const data = new Uint8Array(currentBuffer);
  var ctx = getDirContext();
  const bamOff = ctx.bamOff;

  // Walk directory chain, find first empty slot
  let t = ctx.dirTrack, s = ctx.dirSector;
  const visited = new Set();
  let lastOff = -1;

  while (t !== 0) {
    const key = `${t}:${s}`;
    if (visited.has(key)) break;
    visited.add(key);
    const off = sectorOffset(t, s);
    if (off < 0) break;
    lastOff = off;

    for (let i = 0; i < 8; i++) {
      const eo = off + i * 32;
      let isEmpty = true;
      for (let j = 2; j < 32; j++) {
        if (data[eo + j] !== 0x00) { isEmpty = false; break; }
      }
      if (isEmpty) {
        writeNewEntry(data, eo);
        return eo;
      }
    }

    t = data[off];
    s = data[off + 1];
  }

  // No empty slots — allocate a new directory sector on the directory track
  const dirTrk = ctx.dirTrackNum;
  const spt = sectorsPerTrack(dirTrk);
  let newSector = -1;
  for (let cs = 1; cs < spt; cs++) {
    if (visited.has(`${dirTrk}:${cs}`)) continue;
    newSector = cs;
    break;
  }

  if (newSector === -1) return -1;

  if (lastOff >= 0) {
    data[lastOff] = dirTrk;
    data[lastOff + 1] = newSector;
  }

  const newOff = sectorOffset(dirTrk, newSector);
  data[newOff] = 0x00;
  data[newOff + 1] = 0xFF;
  for (let i = 2; i < 256; i++) data[newOff + i] = 0x00;

  writeNewEntry(data, newOff);

  // Mark sector as used in BAM
  bamMarkSectorUsed(data, dirTrk, newSector, bamOff);

  return newOff;
}

function writeNewEntry(data, entryOff) {
  // Type: PRG, closed
  data[entryOff + 2] = 0x82;
  // File start: directory track, sector 0 (placeholder)
  data[entryOff + 3] = currentFormat.dirTrack;
  data[entryOff + 4] = 0;
  // Filename: filled with 0xA0 (empty name)
  for (let i = 0; i < 16; i++) data[entryOff + 5 + i] = 0xA0;
  // Unused bytes
  for (let i = 21; i < 30; i++) data[entryOff + i] = 0x00;
  // Block size: 0
  data[entryOff + 30] = 0;
  data[entryOff + 31] = 0;
}

// ── File menu: Rename ─────────────────────────────────────────────────
function writeFileName(buffer, entryOff, name, overrides) {
  writePetsciiString(buffer, entryOff + 5, name, 16, overrides);
}

// ── Change file type ──────────────────────────────────────────────────
function changeFileType(entryOff, newTypeIdx) {
  if (!currentBuffer) return;
  const data = new Uint8Array(currentBuffer);
  // Preserve closed (bit 7) and locked (bit 6), replace type bits (0-2)
  data[entryOff + 2] = (data[entryOff + 2] & 0xC0) | (newTypeIdx & 0x07);
  const info = parseCurrentDir(currentBuffer);
  renderDisk(info);
}

function showTypeDropdown(typeSpan, entryOff) {
  cancelActiveEdits();
  // Remove any existing dropdown
  const existing = document.querySelector('.type-dropdown');
  if (existing) existing.remove();

  const data = new Uint8Array(currentBuffer);
  const currentTypeIdx = data[entryOff + 2] & 0x07;

  const dropdown = document.createElement('div');
  dropdown.className = 'type-dropdown';

  FILE_TYPES.forEach((typeName, idx) => {
    const opt = document.createElement('div');
    opt.className = 'type-option';
    const check = document.createElement('span');
    check.className = 'check';
    check.innerHTML = idx === currentTypeIdx ? '<i class="fa-solid fa-check"></i>' : '';
    opt.appendChild(check);
    opt.appendChild(document.createTextNode(typeName));
    opt.addEventListener('click', (e) => {
      e.stopPropagation();
      dropdown.remove();
      changeFileType(entryOff, idx);
    });
    dropdown.appendChild(opt);
  });

  document.body.appendChild(dropdown);

  // Position above the type span
  const rect = typeSpan.getBoundingClientRect();
  dropdown.style.left = rect.left + 'px';
  // Place above; if not enough room, place below
  const dropH = dropdown.offsetHeight;
  if (rect.top - dropH > 0) {
    dropdown.style.top = (rect.top - dropH) + 'px';
  } else {
    dropdown.style.top = rect.bottom + 'px';
  }

  // Close on outside click
  function closeDropdown(e) {
    if (!dropdown.contains(e.target)) {
      dropdown.remove();
      document.removeEventListener('click', closeDropdown);
    }
  }
  setTimeout(() => document.addEventListener('click', closeDropdown), 0);
}

// ── Edit block size ───────────────────────────────────────────────────
// Max value for block size field: 16-bit unsigned (2 bytes in directory entry)
const MAX_BLOCKS = 65535;

function getFileAddresses(buffer, entryOff) {
  const data = new Uint8Array(buffer);
  const typeByte = data[entryOff + 2];
  const fileType = typeByte & 0x07;

  let t = data[entryOff + 3];
  let s = data[entryOff + 4];
  if (t === 0) return null;

  // Read first sector to get load address (first 2 data bytes for PRG)
  const firstOff = sectorOffset(t, s);
  if (firstOff < 0) return null;

  // For PRG files, bytes 2-3 of first sector are the load address
  // For other types, there's no standard load address
  const startAddr = data[firstOff + 2] | (data[firstOff + 3] << 8);

  // Follow chain to find total data size
  const visited = new Set();
  let totalBytes = 0;
  let lastUsed = 0;
  while (t !== 0) {
    if (t < 1 || t > currentTracks) break;
    if (s < 0 || s >= sectorsPerTrack(t)) break;
    const key = `${t}:${s}`;
    if (visited.has(key)) break;
    visited.add(key);

    const off = sectorOffset(t, s);
    const nextT = data[off];
    const nextS = data[off + 1];

    if (nextT === 0) {
      // Last sector: nextS = number of bytes used in this sector (1-based)
      lastUsed = nextS;
      totalBytes += Math.max(0, nextS - 1); // -1 because byte count includes the pointer byte
    } else {
      totalBytes += 254; // 256 - 2 byte pointer
    }

    t = nextT;
    s = nextS;
  }

  // For PRG: subtract 2 for the load address bytes stored in the data
  // End address = start + data size - 1
  if (fileType === 2) { // PRG
    const dataSize = Math.max(0, totalBytes - 2);
    const endAddr = (startAddr + dataSize) & 0xFFFF;
    return { start: startAddr, end: endAddr };
  }

  // For other types, show start address and data extent
  const endAddr = (startAddr + Math.max(0, totalBytes - 1)) & 0xFFFF;
  return { start: startAddr, end: endAddr };
}

function countActualBlocks(buffer, entryOff) {
  const data = new Uint8Array(buffer);
  let t = data[entryOff + 3];
  let s = data[entryOff + 4];
  if (t === 0) return 0;

  const visited = new Set();
  let blocks = 0;
  while (t !== 0) {
    if (t < 1 || t > currentTracks) break;
    if (s < 0 || s >= sectorsPerTrack(t)) break;
    const key = `${t}:${s}`;
    if (visited.has(key)) break;
    visited.add(key);
    blocks++;
    const off = sectorOffset(t, s);
    t = data[off + 0];
    s = data[off + 1];
  }
  return blocks;
}

// ── Free blocks editing ───────────────────────────────────────────────
// Free block count per track is a single byte (0-255), stored in BAM.
// BAM only covers tracks 1-35. Data tracks = tracks 1-35 minus track 18.
// 34 data tracks × 255 = 8670 max.
function getMaxFreeBlocks() {
  // Max = (number of BAM tracks - 1 for dir track) × 255 per track byte
  var bamTracks = currentFormat.bamTracksRange(currentTracks);
  return (bamTracks - 1) * 255;
}

function writeFreeBlocks(buffer, freeBlocks) {
  const data = new Uint8Array(buffer);
  const bamOff = sectorOffset(currentFormat.bamTrack, currentFormat.bamSector);

  // BAM only covers tracks 1-35
  const bamTracks = currentFormat.bamTracksRange(currentTracks);

  // Read current per-track free counts and their max
  const tracks = [];
  let currentTotal = 0;
  for (let t = 1; t <= bamTracks; t++) {
    if (t === currentFormat.dirTrack) continue;
    const free = currentFormat.readTrackFree(data, bamOff, t);
    const spt = sectorsPerTrack(t);
    tracks.push({ t, free, spt });
    currentTotal += free;
  }

  const desired = Math.max(0, freeBlocks);
  const diff = desired - currentTotal;

  if (diff === 0) return;

  if (diff > 0) {
    // Need more free blocks — increase tracks that aren't at max yet
    let remaining = diff;
    for (const tr of tracks) {
      if (remaining <= 0) break;
      const canAdd = Math.min(255, tr.spt) - tr.free;
      if (canAdd > 0) {
        const add = Math.min(remaining, canAdd);
        tr.free += add;
        remaining -= add;
      }
    }
    // If still remaining (exceeding real max), overflow into first tracks
    for (const tr of tracks) {
      if (remaining <= 0) break;
      const canAdd = 255 - tr.free;
      if (canAdd > 0) {
        const add = Math.min(remaining, canAdd);
        tr.free += add;
        remaining -= add;
      }
    }
  } else {
    // Need fewer free blocks — decrease tracks that have free sectors
    let remaining = -diff;
    for (let i = tracks.length - 1; i >= 0; i--) {
      if (remaining <= 0) break;
      const tr = tracks[i];
      const canRemove = tr.free;
      if (canRemove > 0) {
        const remove = Math.min(remaining, canRemove);
        tr.free -= remove;
        remaining -= remove;
      }
    }
  }

  // Write back only the count bytes, leave bitmaps untouched
  for (const tr of tracks) {
    currentFormat.writeTrackFree(data, bamOff, tr.t, tr.free);
  }
}

function countActualFreeBlocks(buffer) {
  const data = new Uint8Array(buffer);
  const bamOff = sectorOffset(currentFormat.bamTrack, currentFormat.bamSector);
  let free = 0;
  const bamTracks = currentFormat.bamTracksRange(currentTracks);
  for (let t = 1; t <= bamTracks; t++) {
    if (t === currentFormat.dirTrack) continue;
    free += currentFormat.readTrackFree(data, bamOff, t);
  }
  return free;
}

function startEditFreeBlocks(blocksSpan) {
  if (!currentBuffer || !blocksSpan) return;
  if (blocksSpan.querySelector('input')) return;

  cancelActiveEdits();
  const currentValue = blocksSpan.textContent.trim();

  const input = document.createElement('input');
  input.type = 'number';
  input.min = '0';
  input.max = String(getMaxFreeBlocks());
  input.value = currentValue;
  input.className = 'blocks-input';

  blocksSpan.textContent = '';
  blocksSpan.appendChild(input);
  blocksSpan.classList.add('editing');
  input.focus();
  input.select();

  let reverted = false;

  function cleanup() {
    blocksSpan.classList.remove('editing');
    activeEditEl = null;
    activeEditCleanup = null;
  }

  function commitEdit() {
    if (reverted) return;
    let value = parseInt(input.value, 10);
    if (isNaN(value) || value < 0) value = 0;
    if (value > getMaxFreeBlocks()) value = getMaxFreeBlocks();
    writeFreeBlocks(currentBuffer, value);
    cleanup();
    blocksSpan.textContent = value;
  }

  function revert() {
    reverted = true;
    cleanup();
    blocksSpan.textContent = currentValue;
  }

  input.addEventListener('blur', () => {
    if (pickerClicking) { input.focus(); input.selectionStart = input.selectionEnd = input._lastCursorPos || 0; return; }
    commitEdit();
  });
  input.addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter') { ev.preventDefault(); commitEdit(); }
    else if (ev.key === 'Escape') { ev.preventDefault(); revert(); }
  });

  registerActiveEdit(blocksSpan, revert);
}

function writeBlockSize(buffer, entryOff, blocks) {
  const data = new Uint8Array(buffer);
  data[entryOff + 30] = blocks & 0xFF;
  data[entryOff + 31] = (blocks >> 8) & 0xFF;
}

// ── Reusable hex input ────────────────────────────────────────────────
// Creates a hex input element with validation.
// Options: { value, maxBytes (1 or 2), validate(val) → bool }
function createHexInput(options) {
  const maxChars = (options.maxBytes || 1) * 2;
  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'hex-input';
  input.maxLength = maxChars;
  input.value = (options.value || 0).toString(16).toUpperCase().padStart(maxChars, '0');
  input.style.width = (maxChars + 1) + 'ch';

  const validateAndMark = () => {
    const val = parseInt(input.value, 16);
    const valid = !isNaN(val) && input.value.length > 0 &&
      /^[0-9A-Fa-f]*$/.test(input.value) &&
      (!options.validate || options.validate(val));
    input.classList.toggle('invalid', !valid);
    return valid;
  };

  input.addEventListener('input', () => {
    // Strip non-hex chars
    input.value = input.value.replace(/[^0-9A-Fa-f]/g, '').toUpperCase().slice(0, maxChars);
    validateAndMark();
  });

  input.addEventListener('keydown', (e) => {
    // Allow: backspace, delete, tab, arrow keys, home, end, select all
    if (['Backspace','Delete','Tab','ArrowLeft','ArrowRight','Home','End'].includes(e.key)) return;
    if (e.ctrlKey && e.key === 'a') return;
    // Allow hex chars
    if (/^[0-9A-Fa-f]$/.test(e.key)) return;
    e.preventDefault();
  });

  input.getValue = () => parseInt(input.value, 16) || 0;
  input.isValid = validateAndMark;
  validateAndMark();

  return input;
}

// ── Track/Sector editor ──────────────────────────────────────────────
function startEditTrackSector(entryEl) {
  if (!currentBuffer || !entryEl) return;
  const entryOff = parseInt(entryEl.dataset.offset, 10);
  const tsSpan = entryEl.querySelector('.dir-ts');
  if (!tsSpan || tsSpan.querySelector('.hex-input-group')) return;

  cancelActiveEdits();
  const data = new Uint8Array(currentBuffer);
  const curTrack = data[entryOff + 3];
  const curSector = data[entryOff + 4];

  const group = document.createElement('span');
  group.className = 'hex-input-group';

  const trackInput = createHexInput({
    value: curTrack,
    maxBytes: 1,
    validate: (val) => val >= 0 && val <= currentTracks
  });

  const sep = document.createElement('span');
  sep.className = 'hex-input-sep';
  sep.textContent = '/';

  const sectorInput = createHexInput({
    value: curSector,
    maxBytes: 1,
    validate: (val) => {
      const t = trackInput.getValue();
      if (t < 1 || t > currentTracks) return false;
      return val >= 0 && val < sectorsPerTrack(t);
    }
  });

  // Re-validate sector when track changes
  trackInput.addEventListener('input', () => sectorInput.isValid());

  group.appendChild(trackInput);
  group.appendChild(sep);
  group.appendChild(sectorInput);

  tsSpan.textContent = '';
  tsSpan.appendChild(group);
  tsSpan.classList.add('editing');

  trackInput.focus();
  trackInput.select();

  let reverted = false;

  function cleanup() {
    tsSpan.classList.remove('editing');
    activeEditEl = null;
    activeEditCleanup = null;
  }

  function commitEdit() {
    if (reverted) return;
    if (!trackInput.isValid() || !sectorInput.isValid()) {
      revert();
      return;
    }
    const newTrack = trackInput.getValue();
    const newSector = sectorInput.getValue();
    data[entryOff + 3] = newTrack;
    data[entryOff + 4] = newSector;
    cleanup();
    // Re-render to update address column
    const info = parseCurrentDir(currentBuffer);
    renderDisk(info);
  }

  function revert() {
    reverted = true;
    cleanup();
    tsSpan.textContent = '$' + curTrack.toString(16).toUpperCase().padStart(2, '0') +
      ' $' + curSector.toString(16).toUpperCase().padStart(2, '0');
  }

  function onBlur(e) {
    // Don't commit if focus moved to the other input in the group
    if (pickerClicking) return;
    setTimeout(() => {
      if (reverted) return;
      if (!group.contains(document.activeElement)) {
        commitEdit();
      }
    }, 10);
  }

  function onKeyDown(e) {
    if (e.key === 'Enter') { e.preventDefault(); commitEdit(); }
    else if (e.key === 'Escape') { e.preventDefault(); revert(); }
    else if (e.key === 'Tab') {
      e.preventDefault();
      if (e.target === trackInput) {
        sectorInput.focus();
        sectorInput.select();
      } else {
        trackInput.focus();
        trackInput.select();
      }
    }
  }

  trackInput.addEventListener('blur', onBlur);
  sectorInput.addEventListener('blur', onBlur);
  trackInput.addEventListener('keydown', onKeyDown);
  sectorInput.addEventListener('keydown', onKeyDown);

  registerActiveEdit(tsSpan, revert);
}

function startEditBlockSize(entryEl) {
  if (!currentBuffer || !entryEl) return;
  const entryOff = parseInt(entryEl.dataset.offset, 10);
  const blocksSpan = entryEl.querySelector('.dir-blocks');
  if (blocksSpan.querySelector('input')) return;

  cancelActiveEdits();
  const currentValue = blocksSpan.textContent.trim();

  const input = document.createElement('input');
  input.type = 'number';
  input.min = '0';
  input.max = String(MAX_BLOCKS);
  input.value = currentValue;
  input.className = 'blocks-input';

  blocksSpan.textContent = '';
  blocksSpan.appendChild(input);
  blocksSpan.classList.add('editing');
  input.focus();
  input.select();

  let reverted = false;

  function cleanup() {
    blocksSpan.classList.remove('editing');
    activeEditEl = null;
    activeEditCleanup = null;
  }

  function commitEdit() {
    if (reverted) return;
    let value = parseInt(input.value, 10);
    if (isNaN(value) || value < 0) value = 0;
    if (value > MAX_BLOCKS) value = MAX_BLOCKS;
    writeBlockSize(currentBuffer, entryOff, value);
    cleanup();
    blocksSpan.textContent = value;
  }

  function revert() {
    reverted = true;
    cleanup();
    blocksSpan.textContent = currentValue;
  }

  input.addEventListener('blur', () => {
    if (pickerClicking) { input.focus(); input.selectionStart = input.selectionEnd = input._lastCursorPos || 0; return; }
    commitEdit();
  });
  input.addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter') { ev.preventDefault(); commitEdit(); }
    else if (ev.key === 'Escape') { ev.preventDefault(); revert(); }
  });

  registerActiveEdit(blocksSpan, revert);
}

function startRenameEntry(entryEl) {
  if (!currentBuffer || !entryEl) return;
  const entryOff = parseInt(entryEl.dataset.offset, 10);
  const nameSpan = entryEl.querySelector('.dir-name');
  if (nameSpan.querySelector('input')) return;

  cancelActiveEdits();
  // Read actual content from buffer (stops at 0xA0 padding)
  const currentValue = readPetsciiString(new Uint8Array(currentBuffer), entryOff + 5, 16);

  const input = document.createElement('input');
  input.type = 'text';
  input.maxLength = 16;
  input.value = currentValue;
  input.className = 'name-input';

  nameSpan.textContent = '';
  nameSpan.appendChild(input);
  nameSpan.classList.add('editing');
  trackCursorPos(input);
  input.focus();
  input.selectionStart = input.selectionEnd = currentValue.length;

  showPetsciiPicker(input, 16);

  let reverted = false;

  function cleanup() {
    nameSpan.classList.remove('editing');
    hidePetsciiPicker();
    activeEditEl = null;
    activeEditCleanup = null;
  }

  function commitRename() {
    if (reverted) return;
    let value = filterC64Input(input.value, 16);
    if (currentBuffer) {
      writeFileName(currentBuffer, entryOff, value, input._petsciiOverrides);
    }
    cleanup();
    // Re-render to show reversed chars properly
    const info = parseCurrentDir(currentBuffer);
    renderDisk(info);
  }

  function revert() {
    reverted = true;
    cleanup();
    nameSpan.textContent = '"' + currentValue.padEnd(16) + '"';
  }

  input.addEventListener('blur', () => {
    if (pickerClicking) { input.focus(); input.selectionStart = input.selectionEnd = input._lastCursorPos || 0; return; }
    commitRename();
  });
  input.addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter') { ev.preventDefault(); commitRename(); }
    else if (ev.key === 'Escape') { ev.preventDefault(); revert(); }
  });

  registerActiveEdit(nameSpan, revert);
}

document.getElementById('opt-rename').addEventListener('click', (e) => {
  e.stopPropagation();
  if (!currentBuffer || selectedEntryIndex < 0) return;
  closeMenus();
  const selected = document.querySelector('.dir-entry.selected');
  startRenameEntry(selected);
});

// Insert a new entry and position it after the selected entry (or at end)
function insertAndPosition() {
  if (!currentBuffer || !canInsertFile()) return -1;
  var newOff = insertFileEntry();
  if (newOff < 0) return -1;

  if (selectedEntryIndex >= 0 && selectedEntryIndex !== newOff) {
    var slots = getDirSlotOffsets(currentBuffer);
    var selIdx = slots.indexOf(selectedEntryIndex);
    var newIdx = slots.indexOf(newOff);
    if (selIdx >= 0 && newIdx >= 0 && newIdx > selIdx + 1) {
      var cur = newIdx;
      var target = selIdx + 1;
      while (cur !== target) {
        swapDirEntries(currentBuffer, slots[cur], slots[cur - 1]);
        cur--;
      }
      newOff = slots[target];
    }
  }
  return newOff;
}

document.getElementById('opt-insert').addEventListener('click', (e) => {
  e.stopPropagation();
  if (!currentBuffer || !canInsertFile()) return;
  closeMenus();
  var newOff = insertAndPosition();
  if (newOff < 0) return;
  selectedEntryIndex = newOff;
  var info = parseCurrentDir(currentBuffer);
  renderDisk(info);
});

// ── Insert Separator ──────────────────────────────────────────────────
// Separator patterns — each is a 16-byte array or a single byte (repeated 16x)
// PETSCII codes for box drawing: $C0=─, $DD=│, $B0=┌, $AE=┐, $AD=└, $BD=┘, $AB=├, $B3=┤, $B1=┴, $B2=┬
// PETSCII box drawing: $C0=─, $DD=│, $B0=┌, $AE=┐, $AD=└, $BD=┘, $AB=├, $B3=┤, $B1=┴, $B2=┬
// Rounded corners: $D5=╭, $C9=╮, $CA=╰, $CB=╯
// Diagonals: $CD=╱, $CC=╲
var _h14 = [0xC0,0xC0,0xC0,0xC0,0xC0,0xC0,0xC0,0xC0,0xC0,0xC0,0xC0,0xC0,0xC0,0xC0];
var _s14 = [0x20,0x20,0x20,0x20,0x20,0x20,0x20,0x20,0x20,0x20,0x20,0x20,0x20,0x20];
var DEFAULT_SEPARATORS = [
  { name: 'Horizontal line', bytes: [0xC0,0xC0,0xC0,0xC0,0xC0,0xC0,0xC0,0xC0,0xC0,0xC0,0xC0,0xC0,0xC0,0xC0,0xC0,0xC0] },
  { name: 'Wavy line',       bytes: [0x66,0x72,0xAF,0x72,0x66,0xC0,0x64,0x65,0x65,0x64,0x60,0x66,0x72,0xAF,0x72,0x66] },
  { name: 'Top sharp',       bytes: [0xB0].concat(_h14,[0xAE]) },
  { name: 'Bottom sharp',    bytes: [0xAD].concat(_h14,[0xBD]) },
  { name: 'T-junction',      bytes: [0xAB].concat(_h14,[0xB3]) },
  { name: 'Sides',           bytes: [0xDD].concat(_s14,[0xDD]) },
  { name: 'Top rounded',     bytes: [0xD5].concat(_h14,[0xC9]) },
  { name: 'Bottom rounded',  bytes: [0xCA].concat(_h14,[0xCB]) },
];

// Custom separators stored in localStorage
var customSeparators = JSON.parse(localStorage.getItem('d64-customSeparators') || '[]');

function saveCustomSeparators() {
  localStorage.setItem('d64-customSeparators', JSON.stringify(customSeparators));
}

function getAllSeparators() {
  return DEFAULT_SEPARATORS.concat(customSeparators);
}

function sepBytesToPreview(bytes) {
  var preview = '';
  for (var j = 0; j < 16; j++) preview += escHtml(PETSCII_MAP[bytes[j] || 0xA0]);
  return preview;
}

// Build the separator submenu
function buildSepSubmenu() {
  var submenu = document.getElementById('sep-submenu');
  if (!submenu) return;
  var all = getAllSeparators();
  var html = '';
  for (var i = 0; i < all.length; i++) {
    if (i === DEFAULT_SEPARATORS.length && customSeparators.length > 0) {
      html += '<div class="separator"></div>';
    }
    html += '<div class="option" data-sep-idx="' + i + '" title="' + escHtml(all[i].name) + '">' +
      '<span style="font-family:\'C64 Pro Mono\',monospace;font-size:12px">' + sepBytesToPreview(all[i].bytes) + '</span></div>';
  }
  submenu.innerHTML = html;
}

// Separator editor modal
function showSeparatorEditor() {
  var editIdx = -1; // -1 = not editing, >= 0 = editing custom separator at this index

  function render() {
    var html = '<div class="sep-editor-list">';
    // Default separators (read-only)
    for (var i = 0; i < DEFAULT_SEPARATORS.length; i++) {
      html += '<div class="sep-editor-item">';
      html += '<span class="sep-editor-preview">' + sepBytesToPreview(DEFAULT_SEPARATORS[i].bytes) + '</span>';
      html += '<span style="font-size:11px;color:var(--text-muted)">' + escHtml(DEFAULT_SEPARATORS[i].name) + '</span>';
      html += '</div>';
    }
    // Custom separators
    for (var j = 0; j < customSeparators.length; j++) {
      html += '<div class="sep-editor-item">';
      html += '<span class="sep-editor-preview">' + sepBytesToPreview(customSeparators[j].bytes) + '</span>';
      html += '<button class="sep-editor-btn" data-action="edit" data-cidx="' + j + '"><i class="fa-solid fa-pen"></i></button>';
      html += '<button class="sep-editor-btn danger" data-action="delete" data-cidx="' + j + '"><i class="fa-solid fa-trash"></i></button>';
      html += '</div>';
    }
    html += '</div>';

    // Add/Edit form
    html += '<div style="display:flex;gap:8px;align-items:center;margin-bottom:8px">';
    html += '<input type="text" id="sep-edit-input" class="sep-editor-input" maxlength="16" value="">';
    html += '<button class="sep-editor-btn" id="sep-edit-save">' + (editIdx >= 0 ? 'Update' : 'Add') + '</button>';
    if (editIdx >= 0) html += '<button class="sep-editor-btn" id="sep-edit-cancel">Cancel</button>';
    html += '</div>';

    // Inline PETSCII 16x16 grid
    html += '<table style="border-collapse:collapse;margin-top:8px" id="sep-char-grid"><tr><td></td>';
    for (var col = 0; col < 16; col++) {
      html += '<td style="text-align:center;font-size:9px;color:var(--text-muted);padding:0 1px;font-family:monospace">' + col.toString(16).toUpperCase() + '</td>';
    }
    html += '</tr>';
    for (var row = 0; row < 16; row++) {
      html += '<tr><td style="text-align:right;font-size:9px;color:var(--text-muted);padding-right:4px;font-family:monospace">' + row.toString(16).toUpperCase() + 'x</td>';
      for (var col2 = 0; col2 < 16; col2++) {
        var p = row * 16 + col2;
        var isSafe = SAFE_PETSCII.has(p);
        var disabled = !isSafe && !allowUnsafeChars;
        var isRev = (p <= 0x1F) || (p >= 0x80 && p <= 0x9F);
        html += '<td data-insert-code="' + p + '" title="$' + p.toString(16).toUpperCase().padStart(2, '0') + '"' +
          ' style="width:22px;height:20px;text-align:center;cursor:pointer;font-family:\'C64 Pro Mono\',monospace;font-size:12px;' +
          'border:1px solid var(--border);border-radius:1px;' +
          (isRev ? 'background:var(--text);color:var(--bg);' : '') +
          (disabled ? 'opacity:0.5;cursor:not-allowed;' : '') +
          '">' + escHtml(PETSCII_MAP[p]) + '</td>';
      }
      html += '</tr>';
    }
    html += '</table>';

    return html;
  }

  showModal('Edit Separators', []);
  var body = document.getElementById('modal-body');
  body.innerHTML = render();

  function attachEvents() {
    var input = document.getElementById('sep-edit-input');
    if (input) {
      setTimeout(function() { input.focus(); }, 50);
    }

    // Prevent grid clicks from stealing focus from input
    var grid = document.getElementById('sep-char-grid');
    if (grid) {
      grid.addEventListener('mousedown', function(e) { e.preventDefault(); });
    }

    body.addEventListener('click', function handler(e) {
      // Don't interfere with input clicks
      if (e.target.tagName === 'INPUT') return;
      // Inline PETSCII grid click
      var charKey = e.target.closest('[data-insert-code]');
      if (charKey) {
        var code = parseInt(charKey.getAttribute('data-insert-code'), 10);
        var inp = document.getElementById('sep-edit-input');
        if (inp && inp.value.length < 16) {
          inp.value += PETSCII_MAP[code];
          inp.focus();
        }
        return;
      }
      var btn = e.target.closest('[data-action]');
      if (!btn) {
        // Save/Cancel buttons
        if (e.target.closest('#sep-edit-save')) {
          var inp = document.getElementById('sep-edit-input');
          if (!inp || inp.value.length === 0) return;
          // Convert input value to PETSCII bytes (no padding)
          var bytes = [];
          for (var k = 0; k < inp.value.length; k++) {
            bytes.push(unicodeToPetscii(inp.value[k]));
          }
          if (editIdx >= 0) {
            customSeparators[editIdx].bytes = bytes;
          } else {
            customSeparators.push({ name: 'Custom', bytes: bytes });
          }
          saveCustomSeparators();
          buildSepSubmenu();
          editIdx = -1;
          body.removeEventListener('click', handler);
          body.innerHTML = render();
          attachEvents();
          return;
        }
        if (e.target.closest('#sep-edit-cancel')) {
          editIdx = -1;
          body.removeEventListener('click', handler);
          body.innerHTML = render();
          attachEvents();
          return;
        }
        return;
      }

      var action = btn.getAttribute('data-action');
      var cidx = parseInt(btn.getAttribute('data-cidx'), 10);

      if (action === 'delete') {
        customSeparators.splice(cidx, 1);
        saveCustomSeparators();
        buildSepSubmenu();
        editIdx = -1;
        body.removeEventListener('click', handler);
        body.innerHTML = render();
        attachEvents();
      } else if (action === 'edit') {
        editIdx = cidx;
        body.removeEventListener('click', handler);
        body.innerHTML = render();
        // Pre-fill input with existing bytes
        var inp2 = document.getElementById('sep-edit-input');
        if (inp2) {
          var val = '';
          for (var m = 0; m < 16; m++) val += PETSCII_MAP[customSeparators[cidx].bytes[m]];
          inp2.value = val;
        }
        attachEvents();
      }
    });
  }

  attachEvents();
}

document.getElementById('opt-edit-separators').addEventListener('click', function(e) {
  e.stopPropagation();
  closeMenus();
  showSeparatorEditor();
});

function insertSeparator(pattern) {
  if (!currentBuffer || !canInsertFile()) return;
  var newOff = insertAndPosition();
  if (newOff < 0) return;

  // Convert to a closed DEL with the separator pattern
  var data = new Uint8Array(currentBuffer);
  data[newOff + 2] = 0x80; // DEL, closed (not scratched)
  data[newOff + 3] = 0x12; // track $12
  data[newOff + 4] = 0x00; // sector $00
  var patBytes = pattern.bytes || [];
  var patLen = patBytes.length;
  for (var i = 0; i < 16; i++) {
    if (pattern.byte !== undefined) {
      data[newOff + 5 + i] = pattern.byte;
    } else if (i < patLen) {
      data[newOff + 5 + i] = patBytes[i];
    }
  }
  data[newOff + 30] = 0x00; // 0 blocks
  data[newOff + 31] = 0x00;

  selectedEntryIndex = newOff;
  var info = parseCurrentDir(currentBuffer);
  renderDisk(info);
}

// Build submenu on load and when charset changes
buildSepSubmenu();

document.getElementById('sep-submenu').addEventListener('click', function(e) {
  e.stopPropagation();
  var opt = e.target.closest('[data-sep-idx]');
  if (!opt) return;
  var idx = parseInt(opt.getAttribute('data-sep-idx'), 10);
  var all = getAllSeparators();
  if (isNaN(idx) || idx < 0 || idx >= all.length) return;
  closeMenus();
  insertSeparator(all[idx]);
});

document.getElementById('opt-remove').addEventListener('click', async (e) => {
  e.stopPropagation();
  if (!currentBuffer || selectedEntryIndex < 0) return;
  closeMenus();

  var removeEntryOff = selectedEntryIndex;
  var data = new Uint8Array(currentBuffer);
  var typeByte = data[removeEntryOff + 2];
  var isCBM = (typeByte & 0x07) === 5 && currentFormat === DISK_FORMATS.d81;

  // Check if this is a CBM partition with files inside
  if (isCBM) {
    var partStart = data[removeEntryOff + 3];
    var partSize = data[removeEntryOff + 30] | (data[removeEntryOff + 31] << 8);
    var partInfo = parsePartition(currentBuffer, partStart, partSize);
    var fileEntries = partInfo ? partInfo.entries.filter(function(en) { return !en.deleted; }) : [];

    if (fileEntries.length > 0) {
      var choice = await showChoiceModal(
        'Remove Directory',
        'This directory contains ' + fileEntries.length + ' file(s). What would you like to do?',
        [
          { label: 'Cancel', value: 'cancel', secondary: true },
          { label: 'Move to Root', value: 'move' },
          { label: 'Remove All', value: 'remove' }
        ]
      );

      if (choice === 'cancel') return;

      if (choice === 'move') {
        // Take snapshot before any changes
        var snapshot = currentBuffer.slice(0);

        // Count available root directory slots
        var freeSlots = getMaxDirEntries() - countDirEntries();
        // We'll also free one slot by removing the partition entry itself
        freeSlots += 1;

        if (freeSlots < fileEntries.length) {
          // Not enough room — show which files can't be moved
          var canMove = freeSlots;
          var cantMove = fileEntries.slice(canMove);
          var lostNames = cantMove.map(function(en) {
            return '"' + petsciiToReadable(en.name).trim() + '"';
          });
          var msg = 'Only ' + canMove + ' of ' + fileEntries.length +
            ' files can be moved to root. The following ' + cantMove.length +
            ' file(s) will be lost:';
          var choice2 = await showChoiceModal(
            'Not Enough Directory Entries',
            msg,
            [
              { label: 'Revert', value: 'revert', secondary: true },
              { label: 'Continue', value: 'continue' }
            ],
            lostNames
          );

          if (choice2 === 'revert') return;
        }

        // Move files from partition to root directory
        var moveCount = Math.min(fileEntries.length, freeSlots);
        for (var fi = 0; fi < moveCount; fi++) {
          var srcOff = fileEntries[fi].entryOff;
          var dstOff = findFreeDirEntry(currentBuffer);
          if (dstOff < 0) break;
          var moveData = new Uint8Array(currentBuffer);
          for (var j = 2; j < 32; j++) moveData[dstOff + j] = moveData[srcOff + j];
        }
      }
      // For both 'move' and 'remove': proceed to remove the partition entry
    }
  }

  const slots = getDirSlotOffsets(currentBuffer);
  const idx = slots.indexOf(removeEntryOff);
  removeFileEntry(currentBuffer, removeEntryOff);
  const info = parseCurrentDir(currentBuffer);
  const visibleEntries = info.entries.filter(en => !en.deleted || showDeleted);
  if (visibleEntries.length > 0) {
    const newIdx = Math.min(idx, visibleEntries.length - 1);
    selectedEntryIndex = visibleEntries[newIdx].entryOff;
  } else {
    selectedEntryIndex = -1;
  }
  renderDisk(info);
  updateMenuState();
});

document.querySelectorAll('#opt-align .submenu .option').forEach(el => {
  el.addEventListener('click', (e) => {
    e.stopPropagation();
    if (!currentBuffer || selectedEntryIndex < 0) return;
    closeMenus();
    alignFilename(currentBuffer, selectedEntryIndex, el.dataset.align);
    const info = parseCurrentDir(currentBuffer);
    renderDisk(info);
  });
});

document.getElementById('opt-block-size').addEventListener('click', (e) => {
  e.stopPropagation();
  if (!currentBuffer || selectedEntryIndex < 0) return;
  closeMenus();
  const selected = document.querySelector('.dir-entry.selected');
  startEditBlockSize(selected);
});

document.getElementById('opt-recalc-size').addEventListener('click', (e) => {
  e.stopPropagation();
  if (!currentBuffer || selectedEntryIndex < 0) return;
  closeMenus();
  const actual = countActualBlocks(currentBuffer, selectedEntryIndex);
  writeBlockSize(currentBuffer, selectedEntryIndex, actual);
  const info = parseCurrentDir(currentBuffer);
  renderDisk(info);
});

// ── File menu: Export File ─────────────────────────────────────────────
document.getElementById('opt-export').addEventListener('click', (e) => {
  e.stopPropagation();
  if (!currentBuffer || selectedEntryIndex < 0) return;
  closeMenus();
  var data = new Uint8Array(currentBuffer);
  var typeByte = data[selectedEntryIndex + 2];
  var typeIdx = typeByte & 0x07;
  if (typeIdx < 1 || typeIdx > 4) return;

  var result = readFileData(currentBuffer, selectedEntryIndex);
  if (result.error) {
    alert('Export error: ' + result.error);
    return;
  }

  var extMap = { 1: '.seq', 2: '.prg', 3: '.usr', 4: '.rel' };
  var ext = extMap[typeIdx];
  var name = petsciiToReadable(readPetsciiString(data, selectedEntryIndex + 5, 16)).trim();
  // Sanitize filename: replace characters not safe for filenames
  name = name.replace(/[<>:"/\\|?*\x00-\x1F]/g, '_');
  if (!name) name = 'export';

  var blob = new Blob([result.data], { type: 'application/octet-stream' });
  var a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name + ext;
  a.click();
  URL.revokeObjectURL(a.href);
});

// ── File menu: Copy / Paste ──────────────────────────────────────────
document.getElementById('opt-copy').addEventListener('click', (e) => {
  e.stopPropagation();
  if (!currentBuffer || selectedEntryIndex < 0) return;
  closeMenus();
  var data = new Uint8Array(currentBuffer);
  var typeByte = data[selectedEntryIndex + 2];
  var typeIdx = typeByte & 0x07;
  if (typeIdx < 1 || typeIdx > 4) return;

  var result = readFileData(currentBuffer, selectedEntryIndex);
  if (result.error) {
    showModal('Copy Error', ['Failed to read file: ' + result.error]);
    return;
  }

  // Copy the 16 PETSCII name bytes and GEOS metadata (bytes 21-29)
  var nameBytes = new Uint8Array(16);
  for (var i = 0; i < 16; i++) nameBytes[i] = data[selectedEntryIndex + 5 + i];
  var geosBytes = new Uint8Array(9); // bytes 21-29 of directory entry
  for (var g = 0; g < 9; g++) geosBytes[g] = data[selectedEntryIndex + 21 + g];

  // Copy GEOS info block if present (byte 24 = GEOS file type, >0 means GEOS)
  var geosInfoBlock = null;
  var infoTrack = data[selectedEntryIndex + 0x15]; // byte 21
  var infoSector = data[selectedEntryIndex + 0x16]; // byte 22
  if (data[selectedEntryIndex + 0x18] > 0 && infoTrack > 0) {
    var infoOff = sectorOffset(infoTrack, infoSector);
    if (infoOff >= 0) {
      geosInfoBlock = new Uint8Array(256);
      for (var ib = 0; ib < 256; ib++) geosInfoBlock[ib] = data[infoOff + ib];
    }
  }

  clipboard = {
    typeIdx: typeIdx,
    nameBytes: nameBytes,
    geosBytes: geosBytes,
    geosInfoBlock: geosInfoBlock,
    data: new Uint8Array(result.data)
  };
  updateEntryMenuState();
});

document.getElementById('opt-paste').addEventListener('click', async (e) => {
  e.stopPropagation();
  if (!clipboard || !currentBuffer || !canInsertFile()) return;
  closeMenus();

  var isGeosFile = clipboard.geosInfoBlock !== null;
  var geosData = null;
  if (clipboard.geosBytes || clipboard.geosInfoBlock) {
    geosData = { geosBytes: clipboard.geosBytes, geosInfoBlock: clipboard.geosInfoBlock };
  }

  // If pasting a GEOS file to a non-GEOS disk, ask to convert
  if (isGeosFile && !hasGeosSignature(currentBuffer)) {
    var choice = await showChoiceModal(
      'GEOS File',
      'This is a GEOS file but the disk is not in GEOS format. Convert disk to GEOS format?',
      [
        { label: 'Cancel', value: 'cancel', secondary: true },
        { label: 'Paste Anyway', value: 'paste' },
        { label: 'Convert & Paste', value: 'convert' }
      ]
    );
    if (choice === 'cancel') return;
    if (choice === 'convert') {
      writeGeosSignature(currentBuffer);
      updateMenuState();
    }
  }

  if (writeFileToDisk(clipboard.typeIdx, clipboard.nameBytes, clipboard.data, geosData)) {
    var info = parseCurrentDir(currentBuffer);
    renderDisk(info);
    var name = petsciiToReadable(readPetsciiString(clipboard.nameBytes, 0, 16)).trim();
    showModal('Paste Successful', ['"' + name + '" pasted successfully.']);
  }
});

// ── File menu: Import File ────────────────────────────────────────────
var importFileInput = document.createElement('input');
importFileInput.type = 'file';
importFileInput.accept = '.prg,.seq,.usr,.rel';
importFileInput.style.display = 'none';
document.body.appendChild(importFileInput);

document.getElementById('opt-import').addEventListener('click', (e) => {
  e.stopPropagation();
  if (!currentBuffer || !canInsertFile()) return;
  closeMenus();
  importFileInput.click();
});

importFileInput.addEventListener('change', () => {
  var file = importFileInput.files[0];
  if (!file) return;
  importFileInput.value = '';
  var reader = new FileReader();
  reader.onload = () => {
    importFileToDisk(file.name, new Uint8Array(reader.result));
  };
  reader.readAsArrayBuffer(file);
});

// Build a true sector allocation map by following all file and directory chains.
// Does NOT trust the BAM — walks every chain on disk.
function buildTrueAllocationMap(buffer) {
  var data = new Uint8Array(buffer);
  var fmt = currentFormat;
  var allocated = {}; // "t:s" -> true

  if (currentPartition) {
    // Inside a partition: mark partition system sectors (header, BAM1, BAM2, dir sectors)
    var st = currentPartition.startTrack;
    allocated[st + ':0'] = true; // header
    allocated[st + ':1'] = true; // BAM1
    allocated[st + ':2'] = true; // BAM2
  } else {
    // Root: mark BAM sector(s) as allocated
    allocated[fmt.bamTrack + ':' + fmt.bamSector] = true;
    if (fmt.bamSector2 !== undefined) allocated[fmt.bamTrack + ':' + fmt.bamSector2] = true;
    if (fmt.bamTrack2) allocated[fmt.bamTrack2 + ':' + (fmt.bamSector2 || 0)] = true;
    if (fmt.headerTrack && fmt.headerSector !== undefined &&
        (fmt.headerTrack !== fmt.bamTrack || fmt.headerSector !== fmt.bamSector)) {
      allocated[fmt.headerTrack + ':' + fmt.headerSector] = true;
    }
  }

  // Follow directory chain
  var ctx = getDirContext();
  var dirT = ctx.dirTrack, dirS = ctx.dirSector;
  var dirVisited = {};
  var dirEntries = [];

  while (dirT !== 0) {
    var key = dirT + ':' + dirS;
    if (dirVisited[key]) break;
    dirVisited[key] = true;
    allocated[key] = true;

    var off = sectorOffset(dirT, dirS);
    if (off < 0) break;

    for (var i = 0; i < fmt.entriesPerSector; i++) {
      dirEntries.push(off + i * fmt.entrySize);
    }

    dirT = data[off]; dirS = data[off + 1];
  }

  // Follow every file's sector chain (including deleted/splat files that have data)
  for (var di = 0; di < dirEntries.length; di++) {
    var entOff = dirEntries[di];
    var typeByte = data[entOff + 2];
    var typeIdx = typeByte & 0x07;
    if (typeIdx === 0 && !(typeByte & 0x80)) continue;

    var ft = data[entOff + 3], fs = data[entOff + 4];
    var fileVisited = {};
    while (ft !== 0) {
      if (ft < 1 || ft > currentTracks) break;
      if (fs >= fmt.sectorsPerTrack(ft)) break;
      var fkey = ft + ':' + fs;
      if (fileVisited[fkey]) break;
      fileVisited[fkey] = true;
      allocated[fkey] = true;
      var foff = sectorOffset(ft, fs);
      if (foff < 0) break;
      ft = data[foff]; fs = data[foff + 1];
    }

    if (typeIdx === 4) {
      var sst = data[entOff + 0x15], sss = data[entOff + 0x16];
      var ssVisited = {};
      while (sst !== 0) {
        var sskey = sst + ':' + sss;
        if (ssVisited[sskey]) break;
        ssVisited[sskey] = true;
        if (sst < 1 || sst > currentTracks) break;
        if (sss >= fmt.sectorsPerTrack(sst)) break;
        allocated[sskey] = true;
        var ssoff = sectorOffset(sst, sss);
        if (ssoff < 0) break;
        sst = data[ssoff]; sss = data[ssoff + 1];
      }
    }
  }

  return allocated;
}

// Allocate sectors using the same strategy as a real CBM drive:
// - 1541/1571: tracks below dir track first (descending), then above (ascending), interleave 10
// - 1581: tracks below dir track first (descending), then above (ascending), interleave 1
function allocateSectors(allocated, numSectors) {
  var fmt = currentFormat;

  var trackOrder = [];
  var interleave;

  if (currentPartition) {
    // Inside a partition: use partition's tracks (skip track 1 = system track)
    var st = currentPartition.startTrack;
    var numPartTracks = Math.floor(currentPartition.partSize / 40);
    // Partition's "directory track" is the start track; data goes on tracks 2+ (absolute: st+1, st+2, ...)
    for (var pt = 2; pt <= numPartTracks; pt++) trackOrder.push(st + pt - 1);
    interleave = 1; // D81 interleave
  } else {
    var dirTrack = fmt.dirTrack;
    // Only include tracks covered by the BAM (e.g. D64 40-track: BAM only covers 1-35)
    var maxBamTrack = fmt.bamTracksRange(currentTracks);
    for (var t = dirTrack - 1; t >= 1; t--) trackOrder.push(t);
    for (var t2 = dirTrack + 1; t2 <= maxBamTrack; t2++) trackOrder.push(t2);
    interleave = (fmt === DISK_FORMATS.d81) ? 1 : 10;
  }
  var sectorList = [];
  var lastSector = 0;

  for (var ti = 0; ti < trackOrder.length && sectorList.length < numSectors; ti++) {
    var track = trackOrder[ti];
    var spt = fmt.sectorsPerTrack(track);

    // On a new track, apply interleave from the last allocated sector
    var startS = (lastSector + interleave) % spt;

    // Find first free sector starting from startS, scanning forward
    var s = startS;
    var foundFirst = false;
    for (var attempt = 0; attempt < spt; attempt++) {
      if (!allocated[track + ':' + s]) {
        sectorList.push({ track: track, sector: s });
        allocated[track + ':' + s] = true;
        lastSector = s;
        foundFirst = true;
        break;
      }
      s = (s + 1) % spt;
    }

    // Continue allocating more sectors on this same track
    if (foundFirst) {
      while (sectorList.length < numSectors) {
        var nextS = (lastSector + interleave) % spt;
        var foundMore = false;
        for (var a2 = 0; a2 < spt; a2++) {
          if (!allocated[track + ':' + nextS]) {
            sectorList.push({ track: track, sector: nextS });
            allocated[track + ':' + nextS] = true;
            lastSector = nextS;
            foundMore = true;
            break;
          }
          nextS = (nextS + 1) % spt;
        }
        if (!foundMore) break; // track full
      }
    }
  }

  return sectorList;
}

// Core write: writes file data to disk with sector chain, directory entry, BAM update, and verification.
// nameBytes = 16-byte Uint8Array of PETSCII filename (already padded with $A0)
// Returns true on success, false on failure (with rollback).
// geosData is optional: { geosBytes: Uint8Array(9), geosInfoBlock: Uint8Array(256)|null }
function writeFileToDisk(typeIdx, nameBytes, fileData, geosData) {
  var snapshot = currentBuffer.slice(0);
  var data = new Uint8Array(currentBuffer);

  // Build true allocation map (don't trust BAM)
  var allocated = buildTrueAllocationMap(currentBuffer);

  // Calculate required sectors for file data
  var dataLen = fileData.length;
  var numSectors = dataLen === 0 ? 1 : Math.ceil(dataLen / 254);
  // No extra sector needed: byte 1 = 255 correctly represents 254 data bytes

  // If GEOS info block present, need one extra sector for it
  var needsInfoBlock = geosData && geosData.geosInfoBlock;
  if (needsInfoBlock) numSectors++;

  // Allocate sectors using real drive algorithm
  var sectorList = allocateSectors(allocated, numSectors);
  if (sectorList.length < numSectors) {
    showModal('Write Error', ['Not enough free sectors. Need ' + numSectors + ', have ' + sectorList.length + '.']);
    return false;
  }

  // Reserve a directory entry before writing any data (fail early)
  var entryOff = findFreeDirEntry(currentBuffer);
  if (entryOff < 0) {
    showModal('Write Error', ['No free directory entry available.']);
    return false;
  }

  // If GEOS, write the info block to the first allocated sector
  var infoSec = null;
  var dataSectorStart = 0;
  if (needsInfoBlock) {
    infoSec = sectorList[0];
    var infoOff = sectorOffset(infoSec.track, infoSec.sector);
    for (var ib = 0; ib < 256; ib++) data[infoOff + ib] = geosData.geosInfoBlock[ib];
    // Info block bytes 0-1 should be 00 FF (standard GEOS info block marker)
    data[infoOff] = 0x00;
    data[infoOff + 1] = 0xFF;
    dataSectorStart = 1; // file data starts from sector index 1
  }

  // Write file data into the sector chain (starting after info block if GEOS)
  var fileSectors = sectorList.slice(dataSectorStart);
  var dataPos = 0;
  for (var si = 0; si < fileSectors.length; si++) {
    var sec = fileSectors[si];
    var soff = sectorOffset(sec.track, sec.sector);

    if (si < fileSectors.length - 1) {
      var nextSec = fileSectors[si + 1];
      data[soff] = nextSec.track;
      data[soff + 1] = nextSec.sector;
      for (var b = 2; b < 256; b++) {
        data[soff + b] = dataPos < dataLen ? fileData[dataPos++] : 0x00;
      }
    } else {
      data[soff] = 0x00;
      var bytesInLast = dataLen - dataPos;
      if (bytesInLast <= 0) bytesInLast = 0;
      data[soff + 1] = bytesInLast + 1;
      for (var b2 = 2; b2 < 256; b2++) {
        data[soff + b2] = dataPos < dataLen ? fileData[dataPos++] : 0x00;
      }
    }
  }

  // Fill directory entry
  data[entryOff + 2] = 0x80 | typeIdx;
  data[entryOff + 3] = fileSectors[0].track;
  data[entryOff + 4] = fileSectors[0].sector;
  for (var ni = 0; ni < 16; ni++) data[entryOff + 5 + ni] = nameBytes[ni];

  // GEOS metadata (bytes 21-29) or zeroed
  if (geosData && geosData.geosBytes) {
    for (var gi = 0; gi < 9; gi++) data[entryOff + 21 + gi] = geosData.geosBytes[gi];
    // Update info block T/S to point to the newly allocated sector
    if (infoSec) {
      data[entryOff + 0x15] = infoSec.track;
      data[entryOff + 0x16] = infoSec.sector;
    }
  } else {
    for (var ui = 21; ui < 30; ui++) data[entryOff + ui] = 0x00;
  }

  data[entryOff + 30] = fileSectors.length & 0xFF;
  data[entryOff + 31] = (fileSectors.length >> 8) & 0xFF;

  // Update BAM for all sectors (file data + info block)
  var ctx = getDirContext();
  var bamOff = ctx.bamOff;
  for (var bi = 0; bi < sectorList.length; bi++) {
    bamMarkSectorUsed(data, sectorList[bi].track, sectorList[bi].sector, bamOff);
  }

  // Verify the write by reading back the file data
  var verify = readFileData(currentBuffer, entryOff);
  if (verify.error || verify.data.length !== fileData.length) {
    currentBuffer = snapshot;
    showModal('Write Error', ['Verification failed: ' + (verify.error || 'size mismatch')]);
    return false;
  }
  for (var vi = 0; vi < fileData.length; vi++) {
    if (verify.data[vi] !== fileData[vi]) {
      currentBuffer = snapshot;
      showModal('Write Error', ['Verification failed: data mismatch at byte ' + vi + '.']);
      return false;
    }
  }

  selectedEntryIndex = entryOff;
  return true;
}

// Convert ASCII filename to 16-byte PETSCII name padded with $A0
function asciiToNameBytes(name) {
  var bytes = new Uint8Array(16);
  name = name.toUpperCase().substring(0, 16);
  for (var i = 0; i < 16; i++) {
    if (i < name.length) {
      var ch = name.charCodeAt(i);
      if (ch >= 0x41 && ch <= 0x5A) bytes[i] = ch;
      else if (ch >= 0x30 && ch <= 0x39) bytes[i] = ch;
      else if (ch === 0x20) bytes[i] = 0x20;
      else if (ch >= 0x21 && ch <= 0x3F) bytes[i] = ch;
      else bytes[i] = 0x20;
    } else {
      bytes[i] = 0xA0;
    }
  }
  return bytes;
}

function importFileToDisk(fileName, fileData) {
  var dotIdx = fileName.lastIndexOf('.');
  var ext = dotIdx >= 0 ? fileName.substring(dotIdx + 1).toLowerCase() : '';
  var typeMap = { prg: 2, seq: 1, usr: 3, rel: 4 };
  var typeIdx = typeMap[ext];
  if (typeIdx === undefined) {
    showModal('Import Error', ['Unsupported file type: .' + ext]);
    return;
  }

  var baseName = dotIdx >= 0 ? fileName.substring(0, dotIdx) : fileName;
  var nameBytes = asciiToNameBytes(baseName);

  if (writeFileToDisk(typeIdx, nameBytes, fileData)) {
    var info = parseCurrentDir(currentBuffer);
    renderDisk(info);
    var numSectors = fileData.length === 0 ? 1 : Math.ceil(fileData.length / 254);
    if (fileData.length > 0 && fileData.length % 254 === 0) numSectors++;
    showModal('Import Successful', ['"' + baseName.toUpperCase() + '" imported successfully.', numSectors + ' block(s) written.']);
  }
}

// Find a free directory entry (typeByte === 0x00 with all entry bytes zeroed)
// Also allocates a new directory sector if needed (like insertFileEntry but without writing an entry)
function findFreeDirEntry(buffer) {
  var data = new Uint8Array(buffer);
  var fmt = currentFormat;
  var ctx = getDirContext();
  var bamOff = ctx.bamOff;
  var t = ctx.dirTrack, s = ctx.dirSector;
  var visited = {};
  var lastOff = -1;

  while (t !== 0) {
    var key = t + ':' + s;
    if (visited[key]) break;
    visited[key] = true;
    var off = sectorOffset(t, s);
    if (off < 0) break;
    lastOff = off;

    for (var i = 0; i < fmt.entriesPerSector; i++) {
      var eo = off + i * fmt.entrySize;
      var isEmpty = true;
      for (var j = 2; j < 32; j++) {
        if (data[eo + j] !== 0x00) { isEmpty = false; break; }
      }
      if (isEmpty) return eo;
    }

    t = data[off]; s = data[off + 1];
  }

  // No empty slot — allocate new directory sector
  var dirTrk = ctx.dirTrackNum;
  var spt = sectorsPerTrack(dirTrk);
  var newSector = -1;
  for (var cs = 1; cs < spt; cs++) {
    if (visited[dirTrk + ':' + cs]) continue;
    newSector = cs;
    break;
  }
  if (newSector === -1) return -1;

  if (lastOff >= 0) {
    data[lastOff] = dirTrk;
    data[lastOff + 1] = newSector;
  }

  var newOff = sectorOffset(dirTrk, newSector);
  data[newOff] = 0x00;
  data[newOff + 1] = 0xFF;
  for (var zi = 2; zi < 256; zi++) data[newOff + zi] = 0x00;

  // Mark sector as used in BAM
  bamMarkSectorUsed(data, dirTrk, newSector, bamOff);

  return newOff;
}

document.getElementById('opt-lock').addEventListener('click', (e) => {
  e.stopPropagation();
  if (!currentBuffer || selectedEntryIndex < 0) return;
  closeMenus();
  const data = new Uint8Array(currentBuffer);
  data[selectedEntryIndex + 2] ^= 0x40; // toggle lock bit
  const info = parseCurrentDir(currentBuffer);
  renderDisk(info);
});

document.getElementById('opt-splat').addEventListener('click', (e) => {
  e.stopPropagation();
  if (!currentBuffer || selectedEntryIndex < 0) return;
  closeMenus();
  const data = new Uint8Array(currentBuffer);
  data[selectedEntryIndex + 2] ^= 0x80; // toggle closed bit
  const info = parseCurrentDir(currentBuffer);
  renderDisk(info);
});

document.querySelectorAll('#opt-change-type .submenu .option').forEach(el => {
  el.addEventListener('click', (e) => {
    e.stopPropagation();
    if (!currentBuffer || selectedEntryIndex < 0) return;
    closeMenus();
    changeFileType(selectedEntryIndex, parseInt(el.dataset.typeidx, 10));
  });
});

fileInput.addEventListener('change', () => {
  var files = Array.from(fileInput.files);
  if (files.length === 0) return;
  fileInput.value = '';

  function openFile(file) {
    return new Promise(function(resolve, reject) {
      var reader = new FileReader();
      reader.onload = function() { resolve({ name: file.name, buffer: reader.result }); };
      reader.onerror = function() { reject(file.name); };
      reader.readAsArrayBuffer(file);
    });
  }

  Promise.all(files.map(openFile)).then(function(results) {
    saveActiveTab();
    for (var i = 0; i < results.length; i++) {
      try {
        currentBuffer = results[i].buffer;
        currentFileName = results[i].name;
        currentPartition = null;
        selectedEntryIndex = -1;
        parseDisk(currentBuffer);
        var tab = createTab(results[i].name, currentBuffer, results[i].name);
        activeTabId = tab.id;
      } catch (err) {
        showModal('Error', ['Error reading ' + results[i].name + ': ' + err.message]);
      }
    }
    var info = parseCurrentDir(currentBuffer);
    renderDisk(info);
    renderTabs();
    updateMenuState();
  }).catch(function(name) {
    showModal('Error', ['Failed to read file: ' + name]);
  });
});

// ── Help menu ────────────────────────────────────────────────────────
document.getElementById('opt-about').addEventListener('click', function(e) {
  e.stopPropagation();
  closeMenus();
  document.getElementById('modal-title').textContent = 'About CBM Disk Editor';
  var body = document.getElementById('modal-body');
  body.innerHTML =
    '<div style="text-align:center;margin-bottom:16px;font-family:\'C64 Pro Mono\',monospace">' +
      '<div style="font-size:20px;color:' + C64_COLORS[14] + ';margin-bottom:8px">CBM DISK EDITOR</div>' +
      '<div style="font-size:12px;color:' + C64_COLORS[15] + '">VERSION ' + APP_VERSION_STRING + '</div>' +
      '<div style="font-size:11px;color:' + C64_COLORS[7] + ';margin-top:12px">CODED BY VAI OF SLASH DESIGN</div>' +
      '<div style="font-size:11px;color:' + C64_COLORS[13] + ';margin-top:4px"><i class="fa-solid fa-cannabis"></i> OOK EEN TREKJE? <i class="fa-solid fa-joint"></i></div>' +
    '</div>' +
    '<div style="font-size:13px;line-height:1.8">' +
      '<b>Supported formats:</b> D64 (1541), D71 (1571), D81 (1581)<br>' +
      '<b>Features:</b><br>' +
      '&bull; Directory editing: rename, insert, remove, sort, align, lock, scratch<br>' +
      '&bull; Hex sector editor with track/sector navigation<br>' +
      '&bull; BAM viewer with integrity checking<br>' +
      '&bull; File import/export/copy/paste across disk images<br>' +
      '&bull; View As: Hex, PETSCII (C64 screen), BASIC (V2/V7), Graphics<br>' +
      '&bull; Graphics: 17+ formats (Koala, Art Studio, FLI, sprites, charset, Print Shop)<br>' +
      '&bull; Packer detection: 370+ signatures<br>' +
      '&bull; D81 subdirectories (partitions)<br>' +
      '&bull; GEOS file support<br>' +
      '&bull; Lost file recovery (orphaned sector chain scanning)<br>' +
      '&bull; Fill free sectors, validate disk, recalculate BAM<br>' +
      '&bull; Multi-tab interface for working with multiple disks<br>' +
      '&bull; Dark and light themes<br>' +
    '</div>';
  var footer = document.querySelector('#modal-overlay .modal-footer');
  footer.innerHTML = '<button id="modal-close">OK</button>';
  document.getElementById('modal-close').addEventListener('click', function() {
    document.getElementById('modal-overlay').classList.remove('open');
  });
  document.getElementById('modal-overlay').classList.add('open');
});

document.getElementById('opt-credits').addEventListener('click', function(e) {
  e.stopPropagation();
  closeMenus();
  document.getElementById('modal-title').textContent = 'Credits & Thanks';
  var body = document.getElementById('modal-body');
  body.innerHTML =
    '<div style="font-size:13px;line-height:1.8">' +
      '<b>Packer detection:</b><br>' +
      '&bull; <a href="https://restore64.dev/" target="_blank" style="color:var(--accent)">Restore64</a> — 370+ packer signatures<br>' +
      '&bull; <a href="https://csdb.dk/release/?id=235681" target="_blank" style="color:var(--accent)">UNP64</a> by iAN CooG — signature architecture (GPL)<br>' +
      '<br>' +
      '<b>C64 color palette:</b><br>' +
      '&bull; <a href="https://www.pepto.de/projects/colorvic/2001/" target="_blank" style="color:var(--accent)">Pepto\'s VIC-II palette</a> — accurate VIC-II color reproduction<br>' +
      '<br>' +
      '<b>Fonts:</b><br>' +
      '&bull; <a href="https://style64.org/c64-truetype" target="_blank" style="color:var(--accent)">C64 Pro Mono</a> by Style64 — TrueType PETSCII font<br>' +
      '<br>' +
      '<b>Technical references:</b><br>' +
      '&bull; <a href="https://vice-emu.sourceforge.io/vice_17.html" target="_blank" style="color:var(--accent)">VICE Manual</a> — disk image format documentation<br>' +
      '&bull; <a href="https://c64-wiki.com/" target="_blank" style="color:var(--accent)">C64-Wiki</a> — Commodore 64 technical reference<br>' +
      '&bull; <a href="https://sta.c64.org/" target="_blank" style="color:var(--accent)">STA\'s C64 pages</a> — disk format details<br>' +
      '&bull; <a href="https://csdb.dk/" target="_blank" style="color:var(--accent)">CSDb</a> — C64 Scene Database<br>' +
    '</div>';
  var footer = document.querySelector('#modal-overlay .modal-footer');
  footer.innerHTML = '<button id="modal-close">OK</button>';
  document.getElementById('modal-close').addEventListener('click', function() {
    document.getElementById('modal-overlay').classList.remove('open');
  });
  document.getElementById('modal-overlay').classList.add('open');
});

document.getElementById('opt-shortcuts').addEventListener('click', function(e) {
  e.stopPropagation();
  closeMenus();
  document.getElementById('modal-title').textContent = 'Keyboard Shortcuts';
  var body = document.getElementById('modal-body');
  var sections = [
    { title: 'File Navigation', shortcuts: [
      ['Arrow Up / Down', 'Select previous/next file'],
      ['Ctrl + Arrow Up / Down', 'Move file up/down in directory'],
      ['Enter', 'Rename selected file'],
      ['Delete', 'Remove selected file'],
    ]},
    { title: 'Clipboard', shortcuts: [
      ['Ctrl + C', 'Copy selected file'],
      ['Ctrl + V', 'Paste file (works across tabs)'],
    ]},
    { title: 'Editing (double-click)', shortcuts: [
      ['Filename', 'Rename file (PETSCII keyboard available)'],
      ['Type column', 'Change file type'],
      ['Blocks column', 'Edit block count'],
      ['T/S column', 'Edit track/sector'],
      ['Disk name / ID', 'Edit disk header'],
      ['Blocks free', 'Edit free block count'],
    ]},
    { title: 'General', shortcuts: [
      ['Right-click', 'Context menu on file entry or empty area'],
      ['Escape', 'Close modal or menu'],
      ['Tab', 'Next input (fill pattern, hex editor)'],
    ]},
  ];
  var html = '';
  for (var si = 0; si < sections.length; si++) {
    html += '<div style="font-weight:bold;font-size:12px;margin:' + (si > 0 ? '12px' : '0') + ' 0 6px;color:var(--text-muted)">' + escHtml(sections[si].title) + '</div>';
    html += '<table style="width:100%;border-collapse:collapse">';
    for (var ki = 0; ki < sections[si].shortcuts.length; ki++) {
      var sc = sections[si].shortcuts[ki];
      html += '<tr><td style="padding:3px 12px 3px 8px;white-space:nowrap;font-size:12px"><code style="background:var(--hover);padding:2px 6px;border-radius:3px;font-size:11px">' +
        escHtml(sc[0]) + '</code></td><td style="padding:3px 0;font-size:12px;color:var(--text-muted)">' +
        escHtml(sc[1]) + '</td></tr>';
    }
    html += '</table>';
  }
  body.innerHTML = html;
  var footer = document.querySelector('#modal-overlay .modal-footer');
  footer.innerHTML = '<button id="modal-close">OK</button>';
  document.getElementById('modal-close').addEventListener('click', function() {
    document.getElementById('modal-overlay').classList.remove('open');
  });
  document.getElementById('modal-overlay').classList.add('open');
});

// ── Theme toggle ─────────────────────────────────────────────────────
const themeToggle = document.getElementById('theme-toggle');
const savedTheme = localStorage.getItem('d64-theme');
if (savedTheme) document.documentElement.setAttribute('data-theme', savedTheme);

function updateThemeIcon() {
  const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
  themeToggle.innerHTML = isDark ? '<i class="fa-solid fa-sun"></i>' : '<i class="fa-solid fa-moon"></i>';
}
updateThemeIcon();
// Restore check marks from saved settings
document.getElementById('check-deleted').innerHTML = showDeleted ? '<i class="fa-solid fa-check"></i>' : '';
document.getElementById('check-addr').innerHTML = showAddresses ? '<i class="fa-solid fa-check"></i>' : '';
document.getElementById('check-ts').innerHTML = showTrackSector ? '<i class="fa-solid fa-check"></i>' : '';
document.getElementById('opt-charset-mode').textContent = charsetMode === 'lowercase' ? 'Switch to Uppercase' : 'Switch to Lowercase';
document.getElementById('check-unsafe').innerHTML = allowUnsafeChars ? '<i class="fa-solid fa-check"></i>' : '';
document.getElementById('check-picker-all').innerHTML = pickerDefaultAll ? '<i class="fa-solid fa-check"></i>' : '';
document.getElementById('check-picker-stick').innerHTML = pickerStick ? '<i class="fa-solid fa-check"></i>' : '';

themeToggle.addEventListener('click', () => {
  const current = document.documentElement.getAttribute('data-theme');
  const next = current === 'dark' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', next);
  localStorage.setItem('d64-theme', next);
  updateThemeIcon();
});
