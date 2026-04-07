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
    hidePetsciiPicker();
    document.getElementById('modal-overlay').classList.remove('open');
  }
});

// Ctrl+Shift toggles charset (like Commodore+Shift on C64)
// Fires on keyup only if no other key was pressed while both modifiers were held,
// so Ctrl+Shift+< and Ctrl+Shift+* shortcuts work without triggering the toggle.
var ctrlShiftClean = false;
document.addEventListener('keydown', (e) => {
  if ((e.ctrlKey && e.key === 'Shift') || (e.shiftKey && e.key === 'Control')) {
    ctrlShiftClean = true;
  } else if (e.ctrlKey && e.shiftKey) {
    ctrlShiftClean = false;
  }
  if (e.key === 'Escape' && document.getElementById('modal-overlay').classList.contains('open')) {
    hidePetsciiPicker();
    document.getElementById('modal-overlay').classList.remove('open');
  }
  // Ctrl+Alt+G: view as graphics
  if (e.ctrlKey && e.altKey && e.code === 'KeyG') {
    e.preventDefault();
    if (currentBuffer && selectedEntryIndex >= 0) {
      closeMenus();
      showFileGfxViewer(selectedEntryIndex);
    }
  }
  // Ctrl+F: find in current tab
  if (e.ctrlKey && !e.altKey && !e.shiftKey && e.code === 'KeyF') {
    e.preventDefault();
    if (currentBuffer) showSearchModal('Find', false);
  }
  // Ctrl+Shift+F: find in all tabs
  if (e.ctrlKey && e.shiftKey && !e.altKey && e.code === 'KeyF') {
    e.preventDefault();
    if (tabs.length > 0) showSearchModal('Find in All Tabs', true);
  }
  // Ctrl+G: go to track/sector
  if (e.ctrlKey && !e.altKey && !e.shiftKey && e.code === 'KeyG') {
    e.preventDefault();
    if (currentBuffer && !isTapeFormat()) showGoToSector();
  }
  // Ctrl+W: close current tab
  if (e.ctrlKey && !e.altKey && !e.shiftKey && e.code === 'KeyW') {
    e.preventDefault();
    var closeEl = document.getElementById('opt-close');
    if (!closeEl.classList.contains('disabled')) closeEl.click();
  }
  // Ctrl+Shift+W: close all tabs
  if (e.ctrlKey && e.shiftKey && !e.altKey && e.code === 'KeyW') {
    e.preventDefault();
    var closeAllEl = document.getElementById('opt-close-all');
    if (!closeAllEl.classList.contains('disabled')) closeAllEl.click();
  }
  // Ctrl+Alt+H: view as hex
  if (e.ctrlKey && e.altKey && e.code === 'KeyH') {
    e.preventDefault();
    if (currentBuffer && selectedEntryIndex >= 0) {
      closeMenus();
      showFileHexViewer(selectedEntryIndex);
    }
  }
  // Ctrl+Alt+B: view as BASIC
  if (e.ctrlKey && e.altKey && e.code === 'KeyB') {
    e.preventDefault();
    if (currentBuffer && selectedEntryIndex >= 0) {
      closeMenus();
      showFileBasicViewer(selectedEntryIndex);
    }
  }
  // Ctrl+Alt+P: view as PETSCII
  if (e.ctrlKey && e.altKey && e.code === 'KeyP') {
    e.preventDefault();
    if (currentBuffer && selectedEntryIndex >= 0) {
      closeMenus();
      showFilePetsciiViewer(selectedEntryIndex);
    }
  }
  // Ctrl+Alt+D: view as disassembly
  if (e.ctrlKey && e.altKey && e.code === 'KeyD') {
    e.preventDefault();
    if (currentBuffer && selectedEntryIndex >= 0) {
      closeMenus();
      showFileDisasmViewer(selectedEntryIndex);
    }
  }
  // Ctrl+Alt+V: validate disk
  if (e.ctrlKey && e.altKey && e.code === 'KeyV') {
    e.preventDefault();
    var valEl = document.getElementById('opt-validate');
    if (!valEl.classList.contains('disabled')) valEl.click();
  }
  // Ctrl+Shift+S: save as
  if (e.ctrlKey && e.shiftKey && !e.altKey && e.code === 'KeyS') {
    e.preventDefault();
    var saveAsEl = document.getElementById('opt-save-as');
    if (!saveAsEl.classList.contains('disabled')) saveAsEl.click();
  }
  // Ctrl+Alt+O: open disk
  if (e.ctrlKey && e.altKey && e.code === 'KeyO') {
    e.preventDefault();
    document.getElementById('opt-open').click();
  }
  // Ctrl+Alt+S: save disk
  if (e.ctrlKey && e.altKey && e.code === 'KeyS') {
    e.preventDefault();
    if (currentBuffer && currentFileName && !isTapeFormat()) {
      document.getElementById('opt-save').click();
    } else if (currentBuffer && !isTapeFormat()) {
      document.getElementById('opt-save-as').click();
    }
  }
  // Ctrl+Alt+N: new disk (open Disk > New submenu with first option focused)
  if (e.ctrlKey && e.altKey && e.code === 'KeyN') {
    e.preventDefault();
    var diskMenu = document.querySelector('.menu-item');
    closeMenus();
    diskMenu.classList.add('open');
    menubarEl.classList.add('menu-active');
    openMenu = diskMenu;
    var newItem = document.getElementById('opt-new');
    var submenu = newItem.querySelector('.submenu');
    submenu.style.display = 'block';
    menuSubmenu = submenu;
    adjustSubmenu(submenu);
    var firstOpt = submenu.querySelector('.option');
    setMenuFocus(firstOpt);
  }
});

document.addEventListener('keyup', (e) => {
  if ((e.key === 'Shift' || e.key === 'Control') && ctrlShiftClean) {
    ctrlShiftClean = false;
    document.getElementById('opt-charset-mode').click();
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
      <div class="dir-entry dir-header-row">
        <span class="dir-grip"></span>
        <span class="dir-blocks">Size</span>
        <span class="dir-name">Filename</span>
        <span class="dir-type">Type</span>
        <span class="dir-ts">T/S</span>
        <span class="dir-addr">Address</span>
        <span class="dir-icons"></span>
      </div>
      <div class="dir-listing">`;

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
    // Render filename with reversed character support (skip for tape — no raw dir entries)
    const richName = (currentBuffer && !isTapeFormat()) ? readPetsciiRich(new Uint8Array(currentBuffer), e.entryOff + 5, 16) : null;
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
    if (showAddresses && currentBuffer && !isTapeFormat()) {
      const addr = getFileAddresses(currentBuffer, e.entryOff);
      if (addr) {
        addrHtml = '$' + hex16(addr.start) + '-$' + hex16(addr.end);
      }
    }

    html += `
        <div class="dir-entry${e.deleted ? ' deleted' : ''}" data-offset="${e.entryOff}" draggable="true">
          <span class="dir-grip"><i class="fa-solid fa-grip-vertical"></i></span>
          <span class="dir-blocks">${e.blocks}</span>
          <span class="dir-name">${nameHtml}</span>
          <span class="dir-type">${escHtml(e.type)}</span>
          <span class="dir-ts">${(currentBuffer && !isTapeFormat()) ? ('$' + hex8(new Uint8Array(currentBuffer)[e.entryOff + 3]) + ' $' + hex8(new Uint8Array(currentBuffer)[e.entryOff + 4])) : ''}</span>
          <span class="dir-addr">${addrHtml}</span>
          <span class="dir-icons">${(function() {
            var icons = '';
            if (!currentBuffer || e.deleted || isTapeFormat()) return icons;
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
        ${info.turboWarning ? '<div class="dir-footer-row tape-warning"><i class="fa-solid fa-triangle-exclamation"></i> ' + escHtml(info.turboWarning) + '</div>' : ''}
        <div class="dir-footer-row">
          <span class="dir-footer-blocks">${info.freeBlocks}</span>
          <span class="dir-footer-label">blocks free.</span>
          <span class="dir-footer-ts" id="footer-ts"></span>
          <span class="dir-footer-tracks">${currentFormat.name} ${currentTracks} tracks</span>
          <span class="dir-footer-health" id="footer-health" title="Disk health"></span>
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

  // Restore selection after re-render
  if (prevSelected >= 0) {
    var selEl = document.querySelector('.dir-entry[data-offset="' + prevSelected + '"]');
    if (selEl) {
      selEl.classList.add('selected');
      selectedEntryIndex = prevSelected;
      if (selectedEntries.indexOf(prevSelected) < 0) selectedEntries = [prevSelected];
      // Also restore other multi-selected entries
      for (var sei = 0; sei < selectedEntries.length; sei++) {
        if (selectedEntries[sei] === prevSelected) continue;
        var multiEl = document.querySelector('.dir-entry[data-offset="' + selectedEntries[sei] + '"]');
        if (multiEl) multiEl.classList.add('selected');
      }
    } else {
      selectedEntries = [];
    }
  } else {
    selectedEntries = [];
  }
  updateEntryMenuState();

  // Filesystem health indicator
  var healthEl = document.getElementById('footer-health');
  if (healthEl && currentBuffer && !currentPartition) {
    var integrity = checkBAMIntegrity(currentBuffer);
    var bamIssues = integrity.bamErrors.length > 0 || integrity.allocMismatch > 0;
    var diskErrors = hasErrorBytes(currentBuffer);
    if (bamIssues) {
      healthEl.textContent = '\u25CF';
      healthEl.style.color = '#9A6759'; // red — BAM problems
      healthEl.title = 'BAM issues detected';
    } else if (diskErrors) {
      healthEl.textContent = '\u25CF';
      healthEl.style.color = '#B8C76F'; // yellow — has error bytes
      healthEl.title = 'Disk has error bytes';
    } else {
      healthEl.textContent = '\u25CF';
      healthEl.style.color = '#588D43'; // green — all OK
      var extBam = detectExtendedBAM(currentBuffer);
      healthEl.title = 'Disk OK' + (extBam ? ' (' + extBam + ' extended BAM)' : '');
    }
  } else if (healthEl) {
    healthEl.textContent = '';
  }
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
      var offset = parseInt(el.dataset.offset, 10);

      if (e.ctrlKey) {
        // Ctrl+click: toggle this entry in multi-select
        if (el.classList.contains('selected')) {
          el.classList.remove('selected');
          selectedEntries = selectedEntries.filter(function(o) { return o !== offset; });
          selectedEntryIndex = selectedEntries.length > 0 ? selectedEntries[selectedEntries.length - 1] : -1;
        } else {
          el.classList.add('selected');
          selectedEntries.push(offset);
          selectedEntryIndex = offset;
        }
      } else if (e.shiftKey && selectedEntryIndex >= 0) {
        // Shift+click: range select from last selected to this
        var allOffsets = [];
        entries.forEach(function(ent) { allOffsets.push(parseInt(ent.dataset.offset, 10)); });
        var startIdx = allOffsets.indexOf(selectedEntryIndex);
        var endIdx = allOffsets.indexOf(offset);
        if (startIdx > endIdx) { var tmp = startIdx; startIdx = endIdx; endIdx = tmp; }
        entries.forEach(function(ent) { ent.classList.remove('selected'); });
        selectedEntries = [];
        for (var si = startIdx; si <= endIdx; si++) {
          entries[si].classList.add('selected');
          selectedEntries.push(allOffsets[si]);
        }
        selectedEntryIndex = offset;
      } else {
        // Normal click: always select this entry (click same row keeps it selected)
        entries.forEach(function(ent) { ent.classList.remove('selected'); });
        el.classList.add('selected');
        selectedEntryIndex = offset;
        selectedEntries = [offset];
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
      if (isTapeFormat()) return;
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

      pushUndo();
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

  // Bind submenu open/close via mouseenter/mouseleave (more reliable than CSS :hover)
  contextMenu.querySelectorAll('.has-submenu').forEach(function(item) {
    item.addEventListener('mouseenter', function() {
      contextMenu.querySelectorAll('.has-submenu.submenu-open').forEach(function(el) {
        el.classList.remove('submenu-open');
      });
      if (!item.classList.contains('disabled')) {
        item.classList.add('submenu-open');
        var sub = item.querySelector('.submenu');
        if (sub) adjustSubmenu(sub);
      }
    });
    item.addEventListener('mouseleave', function() {
      item.classList.remove('submenu-open');
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

// Click outside dir entries — do NOT deselect (selection persists until another file is clicked)

// Keyboard: Arrow Up/Down to select, Ctrl+Arrow to move entry
// Registered once outside bindDirSelection to avoid stacking listeners
document.addEventListener('keydown', (e) => {
  if (!currentBuffer) return;
  if (openMenu) return; // menu keyboard navigation handles arrow keys
  if (document.activeElement && (document.activeElement.tagName === 'INPUT' || document.activeElement.isContentEditable)) return;

  // Enter: edit selected filename
  if (e.key === 'Enter' && selectedEntryIndex >= 0) {
    e.preventDefault();
    const selected = document.querySelector('.dir-entry.selected');
    if (selected) startRenameEntry(selected);
    return;
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

  // Ctrl+I: insert file
  if (e.ctrlKey && e.key === 'i') {
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

  // Ctrl+E: export
  if (e.ctrlKey && e.key === 'e' && selectedEntryIndex >= 0) {
    e.preventDefault();
    var exportEl = document.getElementById('opt-export');
    if (!exportEl.classList.contains('disabled')) exportEl.click();
    return;
  }

  // Ctrl+L: name to lowercase
  if (e.ctrlKey && !e.altKey && !e.shiftKey && e.key === 'l' && selectedEntryIndex >= 0 && currentBuffer) {
    e.preventDefault();
    document.getElementById('opt-case-lower').click();
    return;
  }
  // Ctrl+U: name to uppercase
  if (e.ctrlKey && !e.altKey && !e.shiftKey && e.key === 'u' && selectedEntryIndex >= 0 && currentBuffer) {
    e.preventDefault();
    document.getElementById('opt-case-upper').click();
    return;
  }
  // Ctrl+T: toggle name case
  if (e.ctrlKey && !e.altKey && !e.shiftKey && e.key === 't' && selectedEntryIndex >= 0 && currentBuffer) {
    e.preventDefault();
    document.getElementById('opt-case-toggle').click();
    return;
  }
  // Ctrl+D: add directory (D81 only, not Ctrl+Alt+D which is View as Disassembly)
  if (e.ctrlKey && !e.altKey && e.key === 'd') {
    e.preventDefault();
    var addDirEl = document.getElementById('opt-add-partition');
    if (!addDirEl.classList.contains('disabled')) addDirEl.click();
    return;
  }

  // Ctrl+B: view BAM (not Ctrl+Alt+B which is View as BASIC)
  if (e.ctrlKey && !e.altKey && e.key === 'b') {
    e.preventDefault();
    var bamEl = document.getElementById('opt-view-bam');
    if (!bamEl.classList.contains('disabled')) bamEl.click();
    return;
  }

  // Ctrl+H: edit disk name (header)
  if (e.ctrlKey && !e.altKey && e.key === 'h') {
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
  const multiSelect = selectedEntries.length > 1;
  const inPartition = currentPartition !== null;
  const tape = isTapeFormat();
  // Single-select only operations (all disabled for tape)
  document.getElementById('opt-rename').classList.toggle('disabled', !hasSelection || multiSelect || tape);
  document.getElementById('opt-insert').classList.toggle('disabled', multiSelect || !currentBuffer || !canInsertFile() || tape);
  document.getElementById('opt-insert-sep').classList.toggle('disabled', multiSelect || !currentBuffer || !canInsertFile() || tape);
  document.getElementById('opt-block-size').classList.toggle('disabled', !hasSelection || multiSelect || tape);
  document.getElementById('opt-view-as').classList.toggle('disabled', !hasSelection || multiSelect);
  document.getElementById('opt-add-partition').classList.toggle('disabled', multiSelect || inPartition || !currentBuffer || currentFormat !== DISK_FORMATS.d81 || !canInsertFile() || tape);
  // Multi-select compatible operations (all disabled for tape except copy/export)
  document.getElementById('opt-remove').classList.toggle('disabled', !hasSelection || tape);
  document.getElementById('opt-align').classList.toggle('disabled', !hasSelection || tape);
  document.getElementById('opt-recalc-size').classList.toggle('disabled', !hasSelection || tape);
  document.getElementById('opt-lock').classList.toggle('disabled', !hasSelection || tape);
  document.getElementById('opt-splat').classList.toggle('disabled', !hasSelection || tape);
  document.getElementById('opt-change-type').classList.toggle('disabled', !hasSelection || tape);
  document.getElementById('opt-case').classList.toggle('disabled', !hasSelection || tape);
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
  document.getElementById('opt-export').classList.toggle('disabled', !exportEnabled);
  document.getElementById('opt-export-cvt').classList.toggle('disabled', !geosEnabled || !exportEnabled);
  document.getElementById('opt-export-rtf').classList.toggle('disabled', !geoWriteEnabled);
  document.getElementById('opt-export-pdf').classList.toggle('disabled', !geoWriteEnabled);
  document.getElementById('opt-export-txt-gw').classList.toggle('disabled', !geoWriteEnabled);
  document.getElementById('opt-copy').classList.toggle('disabled', !copyEnabled);
  document.getElementById('opt-paste').classList.toggle('disabled', clipboard.length === 0 || !currentBuffer || !canInsertFile() || tape);
  document.getElementById('opt-view-basic').classList.toggle('disabled', !basicEnabled);
  document.getElementById('opt-view-gfx').classList.toggle('disabled', !gfxEnabled);
  document.getElementById('opt-view-geowrite').classList.toggle('disabled', !geoWriteEnabled);
  document.getElementById('opt-view-tass').classList.add('disabled');
  document.getElementById('opt-import').classList.toggle('disabled', multiSelect || !currentBuffer || !canInsertFile() || tape);
  document.getElementById('opt-edit-sector').classList.toggle('disabled', !hasSelection || multiSelect || tape);
  document.getElementById('opt-edit-file-sector').classList.toggle('disabled', !hasSelection || tape);
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
  if (isTapeFormat()) return;
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
      pushUndo();
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
    if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); commitEdit(); }
    else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); revert(); }
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
  const tape = isTapeFormat();
  document.getElementById('opt-close').classList.toggle('disabled', !hasDisk);
  document.getElementById('opt-close-all').classList.toggle('disabled', tabs.length === 0);
  document.getElementById('opt-save').classList.toggle('disabled', !hasDisk || !currentFileName || tape);
  document.getElementById('opt-save-as').classList.toggle('disabled', !hasDisk || tape);
  document.getElementById('opt-validate').classList.toggle('disabled', !hasDisk || tape);
  document.getElementById('opt-show-deleted').classList.toggle('disabled', !hasDisk || tape);
  document.getElementById('opt-sort').classList.toggle('disabled', !hasDisk || tape);
  document.getElementById('opt-edit-free').classList.toggle('disabled', !hasDisk || tape);
  document.getElementById('opt-recalc-free').classList.toggle('disabled', !hasDisk || tape);
  document.getElementById('opt-view-bam').classList.toggle('disabled', !hasDisk || tape);
  document.getElementById('opt-view-errors').classList.toggle('disabled', !hasDisk || tape || !hasErrorBytes(currentBuffer));
  document.getElementById('opt-convert-geos').classList.toggle('disabled', !hasDisk || tape || hasGeosSignature(currentBuffer));
  document.getElementById('opt-scan-orphans').classList.toggle('disabled', !hasDisk || tape);
  document.getElementById('opt-compact-dir').classList.toggle('disabled', !hasDisk || tape);
  document.getElementById('opt-undo').classList.toggle('disabled', undoStack.length === 0 || tape);
  document.getElementById('opt-fill-free').classList.toggle('disabled', !hasDisk || tape);
  document.getElementById('opt-optimize').classList.toggle('disabled', !hasDisk || tape);
  document.getElementById('opt-export-txt').classList.toggle('disabled', !hasDisk);
  document.getElementById('opt-export-csv').classList.toggle('disabled', !hasDisk);
  document.getElementById('opt-export-png-dir').classList.toggle('disabled', !hasDisk);
  document.getElementById('opt-md5').classList.toggle('disabled', !hasDisk);
  document.getElementById('opt-compare').classList.toggle('disabled', !hasDisk || tape);
  document.getElementById('opt-find').classList.toggle('disabled', !hasDisk);
  document.getElementById('opt-find-tabs').classList.toggle('disabled', tabs.length === 0);
  document.getElementById('opt-goto-sector').classList.toggle('disabled', !hasDisk || tape);
}

// ── Menu logic ────────────────────────────────────────────────────────
const fileInput = document.getElementById('file-input');
const menubarEl = document.querySelector('.menubar');
const menuItems = Array.from(document.querySelectorAll('.menu-item'));
const optAlign = document.getElementById('opt-align');
let openMenu = null;

var menuFocused = null;   // currently focused .option element
var menuSubmenu = null;   // currently open submenu forced by keyboard
var menuKeyNav = false;   // true once keyboard navigation takes over

function clearMenuFocus() {
  if (menuFocused) menuFocused.classList.remove('menu-focused');
  menuFocused = null;
}

function closeSubmenu() {
  if (menuSubmenu) menuSubmenu.style.display = '';
  menuSubmenu = null;
}

function setMenuFocus(opt) {
  if (menuFocused) menuFocused.classList.remove('menu-focused');
  if (!opt) { menuFocused = null; return; }
  menuFocused = opt;
  opt.classList.add('menu-focused');
  opt.scrollIntoView({ block: 'nearest' });
}

function getVisibleOptions(container) {
  if (!container) return [];
  return Array.from(container.querySelectorAll(':scope > .option:not(.disabled)'));
}

function openTopMenu(menu) {
  clearMenuFocus();
  closeSubmenu();
  if (openMenu) openMenu.classList.remove('open');
  menu.classList.add('open');
  menubarEl.classList.add('menu-active');
  openMenu = menu;
  // When keyboard-driven, disable hover so mouse position doesn't interfere
  if (menuKeyNav) {
    menubarEl.classList.add('menu-keynav');
  }
}

function closeMenus() {
  clearMenuFocus();
  closeSubmenu();
  menuItems.forEach(m => m.classList.remove('open'));
  menubarEl.classList.remove('menu-active', 'menu-keynav');
  openMenu = null;
  menuKeyNav = false;
}

menuItems.forEach(menu => {
  menu.addEventListener('click', (e) => {
    e.stopPropagation();
    closeContextMenu();
    if (openMenu === menu) {
      closeMenus();
    } else {
      menuKeyNav = false;
      openTopMenu(menu);
    }
  });
  menu.addEventListener('mouseenter', () => {
    if (openMenu && openMenu !== menu && !menuKeyNav) {
      openTopMenu(menu);
    }
  });
});

// Clear keyboard focus when mouse moves over options (only in mouse mode)
document.querySelectorAll('.menu-dropdown .option').forEach(opt => {
  opt.addEventListener('mouseenter', () => {
    if (!menuKeyNav) clearMenuFocus();
  });
});

// Flip submenus that overflow the viewport
function adjustSubmenu(sub) {
  sub.classList.remove('flip-left', 'flip-up');
  requestAnimationFrame(function() {
    var rect = sub.getBoundingClientRect();
    if (rect.right > window.innerWidth) sub.classList.add('flip-left');
    if (rect.bottom > window.innerHeight) sub.classList.add('flip-up');
  });
}

// Adjust submenus in menubar and context menu (use delegation for cloned context menu)
document.querySelectorAll('.has-submenu').forEach(function(item) {
  item.addEventListener('mouseenter', function() {
    var sub = item.querySelector('.submenu');
    if (sub) adjustSubmenu(sub);
  });
});


document.addEventListener('click', () => {
  closeMenus();
});

// Mouse movement exits keynav mode so hover works naturally again
menubarEl.addEventListener('mousemove', () => {
  if (menuKeyNav) {
    menuKeyNav = false;
    menubarEl.classList.remove('menu-keynav');
  }
});

// Keyboard navigation for menus
document.addEventListener('keydown', (e) => {
  if (!openMenu) return;
  if (['ArrowDown','ArrowUp','ArrowLeft','ArrowRight','Enter','Escape'].indexOf(e.key) < 0) return;

  e.preventDefault();
  menuKeyNav = true;
  menubarEl.classList.add('menu-keynav');

  var inSubmenu = menuSubmenu && menuSubmenu.style.display === 'block';
  var container = inSubmenu ? menuSubmenu : openMenu.querySelector('.menu-dropdown');
  var opts = getVisibleOptions(container);
  var idx = menuFocused ? opts.indexOf(menuFocused) : -1;

  if (e.key === 'ArrowDown') {
    if (opts.length === 0) return;
    setMenuFocus(opts[idx + 1 < opts.length ? idx + 1 : 0]);

  } else if (e.key === 'ArrowUp') {
    if (opts.length === 0) return;
    setMenuFocus(opts[idx - 1 >= 0 ? idx - 1 : opts.length - 1]);

  } else if (e.key === 'ArrowRight') {
    // If focused item has a submenu, enter it
    if (menuFocused && menuFocused.classList.contains('has-submenu') && !menuFocused.classList.contains('disabled')) {
      var sub = menuFocused.querySelector('.submenu');
      if (sub) {
        var subOpts = getVisibleOptions(sub);
        if (subOpts.length > 0) {
          closeSubmenu();
          sub.style.display = 'block';
          menuSubmenu = sub;
          adjustSubmenu(sub);
          setMenuFocus(subOpts[0]);
          return;
        }
      }
    }
    // Otherwise switch to next top-level menu
    var menus = menuItems;
    var mi = menus.indexOf(openMenu);
    openTopMenu(menus[(mi + 1) % menus.length]);

  } else if (e.key === 'ArrowLeft') {
    if (inSubmenu) {
      // Close submenu, re-focus parent item
      var savedContainer = container;
      closeSubmenu();
      var parentOpts = getVisibleOptions(openMenu.querySelector('.menu-dropdown'));
      var parentItem = parentOpts.find(function(o) {
        return o.classList.contains('has-submenu') && o.contains(savedContainer);
      });
      if (parentItem) setMenuFocus(parentItem);
    } else {
      // Switch to previous top-level menu
      var menus2 = menuItems;
      var mi2 = menus2.indexOf(openMenu);
      openTopMenu(menus2[(mi2 - 1 + menus2.length) % menus2.length]);
    }

  } else if (e.key === 'Enter') {
    if (!menuFocused) return;
    if (menuFocused.classList.contains('has-submenu') && !menuFocused.classList.contains('disabled')) {
      var sub2 = menuFocused.querySelector('.submenu');
      if (sub2) {
        var subOpts2 = getVisibleOptions(sub2);
        if (subOpts2.length > 0) {
          closeSubmenu();
          sub2.style.display = 'block';
          menuSubmenu = sub2;
          adjustSubmenu(sub2);
          setMenuFocus(subOpts2[0]);
        }
      }
    } else {
      menuFocused.click();
    }

  } else if (e.key === 'Escape') {
    if (inSubmenu) {
      var savedContainer2 = container;
      closeSubmenu();
      var parentOpts2 = getVisibleOptions(openMenu.querySelector('.menu-dropdown'));
      var parentItem2 = parentOpts2.find(function(o) {
        return o.classList.contains('has-submenu') && o.contains(savedContainer2);
      });
      if (parentItem2) setMenuFocus(parentItem2);
    } else {
      closeMenus();
    }
  }
});

// ── Tab bar rendering ────────────────────────────────────────────────
function renderTabs() {
  // Sync active tab's dirty state before rendering
  if (activeTabId !== null) {
    var activeTab = tabs.find(function(t) { return t.id === activeTabId; });
    if (activeTab) activeTab.dirty = tabDirty;
  }
  var bar = document.getElementById('tab-bar');
  var html = '';
  for (var i = 0; i < tabs.length; i++) {
    var t = tabs[i];
    var cls = 'tab';
    if (t.id === activeTabId) cls += ' active';
    var isTape = t.format === DISK_FORMATS.t64 || t.format === DISK_FORMATS.tap;
    if (isTape) cls += ' tab-tape';
    if (t.dirty) cls += ' tab-dirty';
    var label = (t.dirty ? '* ' : '') + (isTape ? '<span class="tab-tape-badge">TAPE</span> ' : '') + escHtml(t.name);
    html += '<div class="' + cls + '" data-tab-id="' + t.id + '">' +
      '<span class="tab-name" title="' + escHtml(t.name) + '">' + label + '</span>' +
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

// Empty state: shown when no disk is open
function showEmptyState() {
  var content = document.getElementById('content');
  content.innerHTML =
    '<div class="empty-state"><div class="empty-drop-zone">' +
      '<div style="margin-bottom:12px"><i class="fa-solid fa-file-arrow-down" style="font-size:28px;color:var(--border)"></i></div>' +
      '<div style="margin-bottom:16px">No disk loaded.</div>' +
      'Create a <a href="#" id="empty-new">new</a> disk or <a href="#" id="empty-open">open</a> a disk image.<br>' +
      'Drop disk images anywhere on this page.' +
    '</div></div>';
  document.getElementById('empty-new').addEventListener('click', function(e) {
    e.preventDefault();
    e.stopPropagation();
    // Open the Disk menu with New submenu visible and first option focused
    var diskMenu = document.querySelector('.menu-item');
    closeMenus();
    diskMenu.classList.add('open');
    menubarEl.classList.add('menu-active');
    openMenu = diskMenu;
    var newItem = document.getElementById('opt-new');
    var submenu = newItem.querySelector('.submenu');
    submenu.style.display = 'block';
    menuSubmenu = submenu;
    adjustSubmenu(submenu);
    var firstOpt = submenu.querySelector('.option');
    setMenuFocus(firstOpt);
  });
  document.getElementById('empty-open').addEventListener('click', function(e) {
    e.preventDefault();
    fileInput.click();
  });
}

showEmptyState();

document.getElementById('opt-close').addEventListener('click', (e) => {
  e.stopPropagation();
  if (!currentBuffer) return;
  closeMenus();
  if (activeTabId !== null) {
    closeTab(activeTabId);
  }
});

document.getElementById('opt-close-all').addEventListener('click', (e) => {
  e.stopPropagation();
  if (tabs.length === 0) return;
  closeMenus();
  while (tabs.length > 0) {
    tabs.pop();
  }
  activeTabId = null;
  currentBuffer = null;
  currentFileName = null;
  selectedEntryIndex = -1;
  currentPartition = null;
  showEmptyState();
  renderTabs();
  updateMenuState();
  updateEntryMenuState();
});

document.getElementById('opt-save').addEventListener('click', (e) => {
  e.stopPropagation();
  if (!currentBuffer || !currentFileName) return;
  closeMenus();
  downloadD64(currentBuffer, currentFileName);
  tabDirty = false;
  renderTabs();
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
  tabDirty = false;
  updateTabName();
  updateMenuState();
});

document.getElementById('opt-validate').addEventListener('click', (e) => {
  e.stopPropagation();
  if (!currentBuffer) return;
  closeMenus();
  pushUndo();
  var log;
  if (currentPartition) {
    log = validatePartition(currentBuffer, currentPartition.startTrack, currentPartition.partSize);
  } else {
    log = validateDisk(currentBuffer);
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
      card.className = 'modal-info-card';

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
      exportBtn.className = 'btn-small';
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
      restoreBtn.className = 'btn-small';
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
  if (bamCheck.bamErrors.length > 0 || bamCheck.allocMismatch > 0 || bamCheck.orphanCount > 0) {
    bamWarnings += '<ul class="bam-warnings">';
    if (bamCheck.bamErrors.length > 0) {
      bamWarnings += '<li><i class="fa-solid fa-triangle-exclamation"></i> ' +
        bamCheck.bamErrors.length + ' track(s) with wrong free count</li>';
    }
    if (bamCheck.allocMismatch > 0) {
      bamWarnings += '<li><i class="fa-solid fa-triangle-exclamation"></i> ' +
        bamCheck.allocMismatch + ' sector(s) marked free but used by files</li>';
    }
    if (bamCheck.orphanCount > 0) {
      bamWarnings += '<li><i class="fa-solid fa-circle-question"></i> ' +
        bamCheck.orphanCount + ' sector(s) marked used but not owned by any file</li>';
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
  var hasErrors = bamCheck.allocMismatch > 0;
  var hasOrphans = bamCheck.orphanCount > 0;
  var html = '<div class="bam-legend">' +
    '<span class="bam-legend-item"><span class="bam-legend-box" style="background:var(--accent)"></span> Used</span>' +
    '<span class="bam-legend-item"><span class="bam-legend-box" style="background:var(--accent);opacity:0.25"></span> Free</span>' +
    '<span class="bam-legend-item"><span class="bam-legend-box bam-sector dir-used"></span> Dir Used</span>' +
    '<span class="bam-legend-item"><span class="bam-legend-box bam-sector dir-free"></span> Dir Free</span>' +
    (hasErrors ? '<span class="bam-legend-item"><span class="bam-legend-box bam-sector bam-legend-error"></span> BAM Error</span>' : '') +
    (hasOrphans ? '<span class="bam-legend-item"><span class="bam-legend-box bam-sector bam-legend-orphan"></span> Orphan</span>' : '') +
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
      var sKey = t + ':' + s;
      var isError = bamCheck.errorSectors[sKey];
      var isOrphan = bamCheck.orphanSectors[sKey];
      var owner = sectorOwner[sKey];
      var cls = 'bam-sector';
      if (isDirTrack) {
        cls += isFree ? ' dir-free' : ' dir-used';
      } else if (isError) {
        cls += ' error';
      } else if (isOrphan) {
        cls += ' orphan';
      } else {
        cls += isFree ? ' free' : ' used';
      }
      if (isFree) totalFree++; else totalUsed++;

      var tooltip = 'T:$' + t.toString(16).toUpperCase().padStart(2, '0') +
        ' S:$' + s.toString(16).toUpperCase().padStart(2, '0');
      if (isError) {
        tooltip += ' \u26a0 BAM says free, used by: ' + petsciiToReadable(owner);
      } else if (isOrphan) {
        tooltip += ' (orphan \u2014 used in BAM but no file)';
      } else if (isFree) {
        tooltip += ' (free)';
      } else if (isDirTrack) {
        tooltip += ' (directory)';
      } else if (owner) {
        tooltip += ' (' + petsciiToReadable(owner) + ')';
      } else {
        tooltip += ' (used)';
      }

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
  var readableName = decodeGeosString(data, selectedEntryIndex + 5, 16);

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
      lines.push('Load: $' + hex16(infoBlock.loadAddr) +
        ' End: $' + hex16(infoBlock.endAddr) +
        ' Init: $' + hex16(infoBlock.initAddr));
      if (infoBlock.description) lines.push('Description: ' + infoBlock.description);
    }
    lines.push('Info Block: T:$' + hex8(geos.infoTrack) + ' S:$' + hex8(geos.infoSector));
  }

  // Build HTML
  var html = '';

  // Render GEOS icon if available
  var iconCanvas = null;
  if (infoBlock && infoBlock.iconData && infoBlock.iconW > 0 && infoBlock.iconH > 0) {
    iconCanvas = document.createElement('canvas');
    iconCanvas.width = infoBlock.iconW;
    iconCanvas.height = infoBlock.iconH;
    var ictx = iconCanvas.getContext('2d');
    var img = ictx.createImageData(infoBlock.iconW, infoBlock.iconH);
    var px = img.data;
    var bytesPerRow = infoBlock.iconW / 8;
    for (var iy = 0; iy < infoBlock.iconH; iy++) {
      for (var bx = 0; bx < bytesPerRow; bx++) {
        var byt = infoBlock.iconData[iy * bytesPerRow + bx];
        for (var bit = 7; bit >= 0; bit--) {
          var ix = bx * 8 + (7 - bit);
          var off = (iy * infoBlock.iconW + ix) * 4;
          var on = byt & (1 << bit);
          px[off] = on ? 0 : 255;
          px[off + 1] = on ? 0 : 255;
          px[off + 2] = on ? 0 : 255;
          px[off + 3] = 255;
        }
      }
    }
    ictx.putImageData(img, 0, 0);
  }

  html += '<table class="geos-info-table">';
  for (var i = 0; i < lines.length; i++) {
    var parts = lines[i].split(': ');
    if (i === 0 && iconCanvas) {
      // First row: icon + file name
      var label = parts[0];
      var value = parts.slice(1).join(': ');
      html += '<tr><td class="geos-info-label">' + escHtml(label) +
        '</td><td class="geos-info-value"><span class="geos-info-name-row" id="geos-icon-row">' +
        escHtml(value) + '</span></td></tr>';
    } else if (parts.length >= 2) {
      var label2 = parts[0];
      var value2 = parts.slice(1).join(': ');
      html += '<tr><td class="geos-info-label">' +
        escHtml(label2) + '</td><td class="geos-info-value">' + escHtml(value2) + '</td></tr>';
    } else {
      html += '<tr><td colspan="2" class="geos-info-value">' + escHtml(lines[i]) + '</td></tr>';
    }
  }
  html += '</table>';

  showModal('GEOS File Info', []);
  var body = document.getElementById('modal-body');
  body.innerHTML = html;

  // Insert icon canvas into the name row
  if (iconCanvas) {
    var nameRow = document.getElementById('geos-icon-row');
    if (nameRow) {
      iconCanvas.className = 'geos-icon';
      nameRow.insertBefore(iconCanvas, nameRow.firstChild);
    }
  }
});

// ── Convert to GEOS ──────────────────────────────────────────────────
document.getElementById('opt-convert-geos').addEventListener('click', function(e) {
  e.stopPropagation();
  if (!currentBuffer || hasGeosSignature(currentBuffer)) return;
  closeMenus();
  pushUndo();
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
  hint.className = 'text-md text-muted mb-md';
  hint.textContent = 'Enter hex bytes (00-FF). Up to 8 bytes, pattern repeats across each sector.';
  body.appendChild(hint);

  var row = document.createElement('div');
  row.className = 'flex-row-wrap gap-md mb-lg';
  body.appendChild(row);

  var preview = document.createElement('div');
  preview.className = 'text-md text-muted font-mono';
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
    inp.className = 'fill-byte-input';
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
    pushUndo();

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

// ── Disk menu: Optimize Disk ─────────────────────────────────────────
document.getElementById('opt-optimize').addEventListener('click', function(e) {
  e.stopPropagation();
  if (!currentBuffer || isTapeFormat()) return;
  closeMenus();

  var fmt = currentFormat;

  // Presets per drive type: value, label, description, default flag
  var presets, defaultPreset;
  if (fmt === DISK_FORMATS.d81) {
    presets = [
      { value: 1, label: '1581 Standard', desc: 'Interleave 1 \u2014 stock 1581 burst mode, maximum speed' },
      { value: 2, label: '1581 Compatible', desc: 'Interleave 2 \u2014 safer for slower interfaces or emulators' },
    ];
    defaultPreset = 0;
  } else if (fmt === DISK_FORMATS.d71) {
    presets = [
      { value: 6, label: '1571 Standard', desc: 'Interleave 6 \u2014 stock 1571 DOS, native double-sided mode' },
      { value: 5, label: '1571 Optimized', desc: 'Interleave 5 \u2014 slightly faster with burst transfer' },
      { value: 10, label: '1541 Compatible', desc: 'Interleave 10 \u2014 safe for 1541 mode on a 1571' },
      { value: 4, label: 'Fast Loader', desc: 'Interleave 4 \u2014 for SpeedDOS, JiffyDOS and similar' },
    ];
    defaultPreset = 0;
  } else if (fmt === DISK_FORMATS.d80 || fmt === DISK_FORMATS.d82) {
    presets = [
      { value: 6, label: '8050/8250 Standard', desc: 'Interleave 6 \u2014 stock CBM DOS for IEEE-488 drives' },
      { value: 5, label: '8050/8250 Optimized', desc: 'Interleave 5 \u2014 tighter timing, faster loading' },
    ];
    defaultPreset = 0;
  } else {
    // D64
    presets = [
      { value: 10, label: '1541 Standard', desc: 'Interleave 10 \u2014 stock CBM DOS, compatible with everything' },
      { value: 6, label: '1541 Optimized', desc: 'Interleave 6 \u2014 faster on stock hardware, no fast loader needed' },
      { value: 4, label: 'Fast Loader', desc: 'Interleave 4 \u2014 for SpeedDOS, DolphinDOS, JiffyDOS and similar' },
    ];
    defaultPreset = 1;
  }

  document.getElementById('modal-title').textContent = 'Optimize Disk';
  var body = document.getElementById('modal-body');
  var html =
    '<div class="text-md text-muted mb-lg">Rearrange sectors on disk to reduce loading time on real hardware.</div>' +
    '<div class="opt-presets">';
  for (var pi = 0; pi < presets.length; pi++) {
    html += '<label class="opt-preset' + (pi === defaultPreset ? ' selected' : '') + '">' +
      '<input type="radio" name="opt-preset" value="' + presets[pi].value + '"' + (pi === defaultPreset ? ' checked' : '') + '>' +
      '<span class="opt-preset-content">' +
        '<span class="opt-preset-label">' + presets[pi].label + '</span>' +
        '<span class="opt-preset-desc">' + presets[pi].desc + '</span>' +
      '</span>' +
    '</label>';
  }
  html += '<label class="opt-preset">' +
    '<input type="radio" name="opt-preset" value="custom">' +
    '<span class="opt-preset-content">' +
      '<span class="opt-preset-label">Custom</span>' +
      '<span class="opt-preset-desc">Interleave: <input type="text" id="opt-il-custom" maxlength="2" value="" class="hex-input" placeholder="06"></span>' +
    '</span>' +
  '</label>';
  html += '</div>';
  html += '<div class="opt-defrag-row">' +
    '<label class="opt-check-label">' +
      '<input type="checkbox" id="opt-defrag">' +
      '<span class="opt-defrag-content">' +
        '<span class="opt-preset-label">Defragment</span>' +
        '<span class="opt-preset-desc">Move files closer together, reduces head movement between tracks</span>' +
      '</span>' +
    '</label>' +
  '</div>';
  body.innerHTML = html;

  // Wire up preset selection highlighting
  var presetLabels = body.querySelectorAll('.opt-preset');
  var customInput = document.getElementById('opt-il-custom');
  presetLabels.forEach(function(label) {
    var radio = label.querySelector('input[type="radio"]');
    radio.addEventListener('change', function() {
      presetLabels.forEach(function(l) { l.classList.remove('selected'); });
      label.classList.add('selected');
      if (radio.value === 'custom') customInput.focus();
    });
  });
  // Clicking custom input auto-selects the custom radio
  customInput.addEventListener('focus', function() {
    var customRadio = body.querySelector('input[value="custom"]');
    customRadio.checked = true;
    customRadio.dispatchEvent(new Event('change'));
  });

  var footer = document.querySelector('#modal-overlay .modal-footer');
  footer.innerHTML = '';

  var cancelBtn = document.createElement('button');
  cancelBtn.textContent = 'Cancel';
  cancelBtn.className = 'modal-btn-secondary';
  cancelBtn.addEventListener('click', function() {
    document.getElementById('modal-overlay').classList.remove('open');
  });
  footer.appendChild(cancelBtn);

  var okBtn = document.createElement('button');
  okBtn.textContent = 'Optimize';
  okBtn.addEventListener('click', function() {
    var selected = body.querySelector('input[name="opt-preset"]:checked');
    var ilVal;
    if (selected.value === 'custom') {
      var cStr = customInput.value.trim();
      ilVal = parseInt(cStr, 16);
      if (isNaN(ilVal) || ilVal < 1 || ilVal > 20) {
        customInput.focus();
        return;
      }
    } else {
      ilVal = parseInt(selected.value, 10);
    }
    var defrag = document.getElementById('opt-defrag').checked;
    document.getElementById('modal-overlay').classList.remove('open');

    pushUndo();
    var result = optimizeDisk(currentBuffer, ilVal, defrag);

    // Update global interleave so new files use the same setting
    fileInterleave = ilVal;

    var info = parseCurrentDir(currentBuffer);
    renderDisk(info);
    updateMenuState();
    showModal('Optimize Disk', result.log);
  });
  footer.appendChild(okBtn);

  // Stop propagation on inputs
  body.querySelectorAll('input').forEach(function(inp) {
    inp.addEventListener('keydown', function(ev) { ev.stopPropagation(); });
  });

  document.getElementById('modal-overlay').classList.add('open');
});

// ── Disk menu: Export as Text ────────────────────────────────────────
document.getElementById('opt-export-txt').addEventListener('click', function(e) {
  e.stopPropagation();
  if (!currentBuffer) return;
  closeMenus();
  var info = parseCurrentDir(currentBuffer);
  var lines = [];
  lines.push('0 "' + petsciiToReadable(info.diskName).replace(/"/g, '') + '" ' + petsciiToReadable(info.diskId));
  for (var i = 0; i < info.entries.length; i++) {
    var en = info.entries[i];
    if (en.deleted && !showDeleted) continue;
    var nameR = petsciiToReadable(en.name);
    lines.push(String(en.blocks).padStart(5) + ' "' + nameR + '"' + ' '.repeat(Math.max(0, 16 - nameR.length)) + ' ' + en.type.trim());
  }
  lines.push(info.freeBlocks + ' BLOCKS FREE.');
  var txt = lines.join('\n') + '\n';
  var blob = new Blob([txt], { type: 'text/plain' });
  var a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = (currentFileName || 'disk') + '.txt';
  a.click();
  URL.revokeObjectURL(a.href);
});

// ── Disk menu: MD5 Hash ──────────────────────────────────────────────
document.getElementById('opt-md5').addEventListener('click', async function(e) {
  e.stopPropagation();
  if (!currentBuffer) return;
  closeMenus();
  // Use Web Crypto API for SHA-256 (MD5 not available, but SHA-256 is better)
  // Also compute a simple checksum for quick comparison
  var data = new Uint8Array(currentBuffer);
  try {
    var hashBuffer = await crypto.subtle.digest('SHA-256', data);
    var hashArray = new Uint8Array(hashBuffer);
    var sha256 = Array.from(hashArray).map(function(b) { return b.toString(16).padStart(2, '0'); }).join('');
    // Simple MD5-like CRC32 for quick checks
    var crc = 0xFFFFFFFF;
    for (var i = 0; i < data.length; i++) {
      crc ^= data[i];
      for (var j = 0; j < 8; j++) crc = (crc >>> 1) ^ (crc & 1 ? 0xEDB88320 : 0);
    }
    crc = (crc ^ 0xFFFFFFFF) >>> 0;
    var crc32 = crc.toString(16).toUpperCase().padStart(8, '0');

    document.getElementById('modal-title').textContent = 'Disk Hash';
    var body = document.getElementById('modal-body');
    body.innerHTML =
      '<div style="font-size:13px;line-height:2">' +
        '<b>File:</b> ' + escHtml(currentFileName || 'unnamed') + '<br>' +
        '<b>Size:</b> ' + data.length + ' bytes<br>' +
        '<b>CRC32:</b> <code class="code-tag;user-select:text">' + crc32 + '</code><br>' +
        '<b>SHA-256:</b> <code class="code-tag" style="font-size:11px;user-select:text;word-break:break-all">' + sha256 + '</code>' +
      '</div>';
    var footer = document.querySelector('#modal-overlay .modal-footer');
    footer.innerHTML = '<button id="modal-close">OK</button>';
    document.getElementById('modal-close').addEventListener('click', function() {
      document.getElementById('modal-overlay').classList.remove('open');
    });
    document.getElementById('modal-overlay').classList.add('open');
  } catch(err) {
    showModal('Hash Error', ['Failed to compute hash: ' + err.message]);
  }
});

// ── Disk menu: Compare with... ──────────────────────────────────────
var compareInput = document.createElement('input');
compareInput.type = 'file';
compareInput.accept = '.d64,.d71,.d81,.d80,.d82';
compareInput.style.display = 'none';
document.body.appendChild(compareInput);

document.getElementById('opt-compare').addEventListener('click', function(e) {
  e.stopPropagation();
  if (!currentBuffer) return;
  closeMenus();
  compareInput.click();
});

compareInput.addEventListener('change', function() {
  var file = compareInput.files[0];
  if (!file) return;
  compareInput.value = '';
  var reader = new FileReader();
  reader.onload = function() {
    var otherBuf = new Uint8Array(reader.result);
    var thisBuf = new Uint8Array(currentBuffer);
    var maxLen = Math.max(thisBuf.length, otherBuf.length);
    var diffs = [];
    var diffSectors = {};

    for (var i = 0; i < maxLen; i++) {
      var a = i < thisBuf.length ? thisBuf[i] : -1;
      var b = i < otherBuf.length ? otherBuf[i] : -1;
      if (a !== b) {
        var sectorNum = Math.floor(i / 256);
        if (!diffSectors[sectorNum]) diffSectors[sectorNum] = 0;
        diffSectors[sectorNum]++;
      }
    }

    var sectorKeys = Object.keys(diffSectors).sort(function(a, b) { return parseInt(a) - parseInt(b); });
    var totalDiffBytes = 0;
    for (var k in diffSectors) totalDiffBytes += diffSectors[k];

    document.getElementById('modal-title').textContent = 'Disk Comparison';
    var body = document.getElementById('modal-body');
    var html = '<div class="text-base line-tall">' +
      '<b>Current:</b> ' + escHtml(currentFileName || 'unnamed') + ' (' + thisBuf.length + ' bytes)<br>' +
      '<b>Compare:</b> ' + escHtml(file.name) + ' (' + otherBuf.length + ' bytes)<br><br>';

    if (sectorKeys.length === 0) {
      html += '<div style="color:#588D43;font-weight:bold">Disks are identical!</div>';
    } else {
      html += '<b>' + totalDiffBytes + ' byte(s) differ</b> in ' + sectorKeys.length + ' sector(s):<br><br>';
      html += '<table style="width:100%;border-collapse:collapse;font-size:12px">';
      html += '<tr style="color:var(--text-muted)"><td style="padding:2px 8px"><b>Sector</b></td><td><b>Offset</b></td><td><b>Differences</b></td></tr>';
      for (var si = 0; si < Math.min(sectorKeys.length, 100); si++) {
        var sn = parseInt(sectorKeys[si]);
        html += '<tr><td style="padding:2px 8px">' + sn + '</td><td>$' + (sn * 256).toString(16).toUpperCase().padStart(6, '0') + '</td><td>' + diffSectors[sn] + ' byte(s)</td></tr>';
      }
      if (sectorKeys.length > 100) html += '<tr><td colspan="3" style="padding:2px 8px;color:var(--text-muted)">...and ' + (sectorKeys.length - 100) + ' more sectors</td></tr>';
      html += '</table>';
    }
    html += '</div>';
    body.innerHTML = html;

    var footer = document.querySelector('#modal-overlay .modal-footer');
    footer.innerHTML = '<button id="modal-close">OK</button>';
    document.getElementById('modal-close').addEventListener('click', function() {
      document.getElementById('modal-overlay').classList.remove('open');
    });
    document.getElementById('modal-overlay').classList.add('open');
  };
  reader.readAsArrayBuffer(file);
});

// ── Disk menu: Set Interleave ────────────────────────────────────────
document.getElementById('opt-interleave').addEventListener('click', function(e) {
  e.stopPropagation();
  closeMenus();

  document.getElementById('modal-title').textContent = 'Set Interleave';
  var body = document.getElementById('modal-body');
  body.innerHTML =
    '<div class="text-md text-muted mb-lg">Sector interleave used when writing new files and directory sectors.</div>' +
    '<div class="form-row">' +
      '<label class="form-label">Directory:</label>' +
      '<input type="text" id="il-dir" maxlength="2" value="' + dirInterleave.toString(16).toUpperCase().padStart(2, '0') + '" class="hex-input wide">' +
    '</div>' +
    '<div class="form-row">' +
      '<label class="form-label">File data:</label>' +
      '<input type="text" id="il-file" maxlength="2" value="' + fileInterleave.toString(16).toUpperCase().padStart(2, '0') + '" class="hex-input wide">' +
    '</div>';

  var footer = document.querySelector('#modal-overlay .modal-footer');
  footer.innerHTML = '<button class="modal-btn-secondary" id="il-cancel">Cancel</button><button id="il-ok">OK</button>';
  document.getElementById('il-cancel').addEventListener('click', function() {
    document.getElementById('modal-overlay').classList.remove('open');
  });
  document.getElementById('il-ok').addEventListener('click', function() {
    var dStr = document.getElementById('il-dir').value.trim();
    var fStr = document.getElementById('il-file').value.trim();
    var dVal = parseInt(dStr, 16);
    var fVal = parseInt(fStr, 16);
    if (!isNaN(dVal) && dVal >= 1 && dVal <= 0x14) dirInterleave = dVal;
    if (!isNaN(fVal) && fVal >= 1 && fVal <= 0x14) fileInterleave = fVal;
    document.getElementById('modal-overlay').classList.remove('open');
  });
  // Stop propagation on inputs so keydown handlers don't interfere
  body.querySelectorAll('input').forEach(function(inp) {
    inp.addEventListener('keydown', function(ev) { ev.stopPropagation(); });
  });
  document.getElementById('modal-overlay').classList.add('open');
  document.getElementById('il-dir').focus();
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

  pushUndo();
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
  lines.push('Start T:$' + hex8(startTrack) + ' S:$' + hex8(startSector));

  if (addr) {
    lines.push('Load: $' + hex16(addr.start) + ' - $' + hex16(addr.end));
  }

  // PRG-specific: SYS line and packer detection
  if (typeIdx === 2 && fileData.length >= 10) {
    var loadAddr = fileData[0] | (fileData[1] << 8);
    if (loadAddr === 0x0801) {
      var packerInfo = detectPacker(fileData);
      if (packerInfo) {
        if (packerInfo.sysAddr) {
          lines.push('SYS: ' + packerInfo.sysAddr + ' ($' + hex16(packerInfo.sysAddr) + ')');
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
    // Multi-char tile modes use C64 bank stride of 64
    // WxH needs W*H banks: 1x2/2x1 = 2 banks (128 chars), 2x2 = 4 banks (256 chars)
    if (numChars >= 128) {
      add('Charset 1\u00D72', 'charset-1x2', 'charset');
      add('Charset MC 1\u00D72', 'charset-mc-1x2', 'charset');
      add('Charset 2\u00D71', 'charset-2x1', 'charset');
      add('Charset MC 2\u00D71', 'charset-mc-2x1', 'charset');
    }
    if (numChars >= 256) {
      add('Charset 2\u00D72', 'charset-2x2', 'charset');
      add('Charset MC 2\u00D72', 'charset-mc-2x2', 'charset');
    }
  }

  // 5. Print Shop: small monochrome bitmap
  if (dataBytes >= 11 && dataBytes <= 1500) {
    add('Print Shop', 'printshop', 'printshop');
  }

  return matches;
}

// Detect GEOS graphics formats from directory entry metadata and info block
function detectGeosGfxFormats(entryOff) {
  if (!currentBuffer || isTapeFormat()) return [];
  var geos = readGeosInfo(currentBuffer, entryOff);
  if (!geos.isGeos || geos.structure !== 1) return []; // must be VLIR
  var matches = [];

  // Check file type and class name for geoPaint documents
  var isPaint = (geos.fileType === 0x14);
  if (!isPaint && geos.infoTrack > 0) {
    var infoBlock = readGeosInfoBlock(currentBuffer, geos.infoTrack, geos.infoSector);
    if (infoBlock && infoBlock.className && infoBlock.className.toLowerCase().indexOf('paint') === 0) {
      isPaint = true;
    }
  }
  if (isPaint) {
    matches.push({ name: 'geoPaint', mode: 'geopaint', layout: 'geopaint', geosEntry: entryOff });
  }
  if (geos.fileType === 0x15) {
    matches.push({ name: 'Photo Scrap', mode: 'geoscrap', layout: 'geoscrap', geosEntry: entryOff });
  }
  if (geos.fileType === 0x18) {
    matches.push({ name: 'Photo Album', mode: 'geosalbum', layout: 'geosalbum', geosEntry: entryOff });
  }
  // Check class name for photo album (stored as application data $07)
  if (!isPaint && geos.fileType === 0x07 && geos.infoTrack > 0) {
    var infoBlock2 = readGeosInfoBlock(currentBuffer, geos.infoTrack, geos.infoSector);
    if (infoBlock2 && infoBlock2.className && infoBlock2.className.toLowerCase().indexOf('photo album') === 0) {
      matches.push({ name: 'Photo Album', mode: 'geosalbum', layout: 'geosalbum', geosEntry: entryOff });
    }
  }
  if (geos.fileType === 0x08) {
    matches.push({ name: 'GEOS Font', mode: 'geosfont', layout: 'geosfont', geosEntry: entryOff });
  }
  // geoWrite documents (type $07 or $13, class "Write Image") — embedded images in records 64-126
  if (geos.fileType === 0x07 || geos.fileType === 0x13) {
    var infoBlk = readGeosInfoBlock(currentBuffer, geos.infoTrack, geos.infoSector);
    if (infoBlk && infoBlk.className && infoBlk.className.toLowerCase().indexOf('write image') === 0) {
      matches.push({ name: 'geoWrite Images', mode: 'geoswrite', layout: 'geoswrite', geosEntry: entryOff });
    }
  }
  return matches;
}

// Render a geoPaint image (640×720, VLIR records with GEOS compression).
// Each record = 2 card rows decompressed to 1448 bytes:
//   0-639: bitmap row 0 (80 cards × 8 bytes, column-major)
//   640-1279: bitmap row 1
//   1280-1287: padding
//   1288-1367: color row 0 (80 bytes, high nybble=fg, low=bg)
//   1368-1447: color row 1
function renderGeoPaint(ctx, entryOff) {
  var records = readVLIRRecords(currentBuffer, entryOff);
  if (records.length === 0) return false;

  var w = 640, h = records.length * 16;
  ctx.canvas.width = w;
  ctx.canvas.height = h;
  var img = ctx.createImageData(w, h);
  var px = img.data;
  for (var fi = 3; fi < px.length; fi += 4) px[fi] = 255;

  for (var ri = 0; ri < records.length; ri++) {
    if (!records[ri] || records[ri].length === 0) continue;
    var dec = decompressGeosBitmap(records[ri]);
    if (dec.length < 1288) continue;

    for (var cardRow = 0; cardRow < 2; cardRow++) {
      var bmOff = cardRow * 640;
      var colOff = 1288 + cardRow * 80;

      for (var card = 0; card < 80; card++) {
        var colorByte = colOff + card < dec.length ? dec[colOff + card] : 0;
        var fgRgb = C64_RGB[(colorByte >> 4) & 0x0F];
        var bgRgb = C64_RGB[colorByte & 0x0F];

        for (var line = 0; line < 8; line++) {
          var byt = dec[bmOff + card * 8 + line] || 0;
          var y = ri * 16 + cardRow * 8 + line;
          for (var bit = 7; bit >= 0; bit--) {
            var x = card * 8 + (7 - bit);
            if (x < w && y < h) {
              var rgb = (byt & (1 << bit)) ? fgRgb : bgRgb;
              var off = (y * w + x) * 4;
              px[off] = rgb[0]; px[off + 1] = rgb[1]; px[off + 2] = rgb[2];
            }
          }
        }
      }
    }
  }
  ctx.putImageData(img, 0, 0);
  return true;
}

// Render a single photo scrap from raw data (3-byte header + compressed bitmap).
// Header: byte 0 = width in cards, bytes 1-2 = height in pixels (LE).
// Uses scrap compression (different from geoPaint).
function renderScrapData(ctx, scrapBytes, yOffset) {
  if (scrapBytes.length < 4) return 0;
  var wCards = scrapBytes[0];
  var h = scrapBytes[1] | (scrapBytes[2] << 8);
  if (wCards === 0 || h === 0 || h > 4096) return 0;
  var w = wCards * 8;
  var dec = decompressGeosScrap(scrapBytes.subarray(3));
  if (dec.length < wCards * h) return 0;

  // Ensure canvas is wide enough
  if (w > ctx.canvas.width) ctx.canvas.width = w;

  var img = ctx.getImageData(0, yOffset, w, h);
  var px = img.data;
  for (var fi = 0; fi < px.length; fi++) px[fi] = 255;
  for (var fi2 = 3; fi2 < px.length; fi2 += 4) px[fi2] = 255;

  for (var y = 0; y < h; y++) {
    for (var bx = 0; bx < wCards; bx++) {
      var byt = dec[y * wCards + bx];
      for (var bit = 7; bit >= 0; bit--) {
        var x = bx * 8 + (7 - bit);
        var off = (y * w + x) * 4;
        var on = byt & (1 << bit);
        px[off] = on ? 0 : 255;
        px[off + 1] = on ? 0 : 255;
        px[off + 2] = on ? 0 : 255;
      }
    }
  }
  ctx.putImageData(img, 0, yOffset);
  return h;
}

// Render GEOS Photo Scrap (sequential file, single image)
function renderGeoScrap(ctx, entryOff) {
  var result = readFileData(currentBuffer, entryOff);
  if (result.error || result.data.length < 4) return false;
  var scrapData = result.data;
  var wCards = scrapData[0];
  var h = scrapData[1] | (scrapData[2] << 8);
  if (wCards === 0 || h === 0) return false;
  ctx.canvas.width = wCards * 8;
  ctx.canvas.height = h;
  return renderScrapData(ctx, scrapData, 0) > 0;
}

// Render GEOS Photo Album (VLIR, each record is a photo scrap)
function renderGeoAlbum(ctx, entryOff) {
  var records = readVLIRRecords(currentBuffer, entryOff);
  if (records.length === 0) return false;

  // First pass: measure total height and max width
  var totalH = 0, maxW = 0, gap = 4;
  var scraps = [];
  for (var ri = 0; ri < records.length; ri++) {
    if (!records[ri] || records[ri].length < 4) continue;
    var wCards = records[ri][0];
    var h = records[ri][1] | (records[ri][2] << 8);
    if (wCards === 0 || h === 0 || h > 4096) continue;
    var w = wCards * 8;
    if (w > maxW) maxW = w;
    scraps.push({ data: records[ri], h: h });
    totalH += h + gap;
  }
  if (scraps.length === 0) return false;
  totalH -= gap;

  ctx.canvas.width = maxW;
  ctx.canvas.height = totalH;
  // Fill white
  var bgImg = ctx.createImageData(maxW, totalH);
  for (var fi = 0; fi < bgImg.data.length; fi++) bgImg.data[fi] = 255;
  ctx.putImageData(bgImg, 0, 0);

  var yPos = 0;
  for (var si = 0; si < scraps.length; si++) {
    renderScrapData(ctx, scraps[si].data, yPos);
    yPos += scraps[si].h + gap;
  }
  return true;
}

// Render geoWrite embedded images (VLIR records 64-126, each in Photo Scrap format)
function renderGeoWrite(ctx, entryOff) {
  var records = readVLIRRecords(currentBuffer, entryOff);
  if (records.length <= 64) return false;

  // Collect valid image records (indices 64-126)
  var totalH = 0, maxW = 0, gap = 4;
  var scraps = [];
  for (var ri = 64; ri < records.length && ri <= 126; ri++) {
    if (!records[ri] || records[ri].length < 4) continue;
    var wCards = records[ri][0];
    var h = records[ri][1] | (records[ri][2] << 8);
    if (wCards === 0 || h === 0 || h > 4096) continue;
    var w = wCards * 8;
    if (w > maxW) maxW = w;
    scraps.push({ data: records[ri], h: h });
    totalH += h + gap;
  }
  if (scraps.length === 0) return false;
  totalH -= gap;

  ctx.canvas.width = maxW;
  ctx.canvas.height = totalH;
  var bgImg = ctx.createImageData(maxW, totalH);
  for (var fi = 0; fi < bgImg.data.length; fi++) bgImg.data[fi] = 255;
  ctx.putImageData(bgImg, 0, 0);

  var yPos = 0;
  for (var si = 0; si < scraps.length; si++) {
    renderScrapData(ctx, scraps[si].data, yPos);
    yPos += scraps[si].h + gap;
  }
  return true;
}

// Render GEOS font: show all glyphs from each available point size.
// Font VLIR records are NOT compressed. Record N = N-point font.
// Header (8 bytes): ascent, rowLength(16), height, xTabOffset(16), bmOffset(16)
// X-table: 97 entries × 2 bytes (character boundaries for $20-$7F + total width)
// Bitmap: height rows × rowLength bytes (all glyphs concatenated horizontally)
function renderGeosFont(ctx, entryOff) {
  var records = readVLIRRecords(currentBuffer, entryOff);
  if (records.length === 0) return false;

  // Parse valid font sizes
  var fonts = [];
  for (var ri = 0; ri < records.length; ri++) {
    if (!records[ri] || records[ri].length < 8) continue;
    var rec = records[ri];
    var ascent = rec[0];
    var rowLen = rec[1] | (rec[2] << 8);
    var height = rec[3];
    var xTabOff = rec[4] | (rec[5] << 8);
    var bmOff = rec[6] | (rec[7] << 8);
    // Sanity checks
    if (height < 1 || height > 63) continue;
    if (rowLen < 1 || rowLen > 500) continue;
    if (bmOff + height * rowLen > rec.length) continue;
    if (xTabOff + 194 > rec.length) continue;
    fonts.push({ pt: ri, rec: rec, ascent: ascent, rowLen: rowLen, height: height, xTabOff: xTabOff, bmOff: bmOff });
  }

  if (fonts.length === 0) return false;

  // Render each point size as a labeled strip
  var gap = 8;
  var totalH = 0;
  var maxW = 0;
  for (var fi2 = 0; fi2 < fonts.length; fi2++) {
    var bmW = fonts[fi2].rowLen * 8;
    if (bmW > maxW) maxW = bmW;
    totalH += fonts[fi2].height + gap;
  }
  totalH -= gap;
  if (maxW > 4096) maxW = 4096;

  ctx.canvas.width = maxW;
  ctx.canvas.height = totalH;
  var img = ctx.createImageData(maxW, totalH);
  var px = img.data;
  for (var fi3 = 0; fi3 < px.length; fi3++) px[fi3] = 255;
  for (var fi4 = 3; fi4 < px.length; fi4 += 4) px[fi4] = 255;

  var yPos = 0;
  for (var fi5 = 0; fi5 < fonts.length; fi5++) {
    var f = fonts[fi5];
    for (var row = 0; row < f.height; row++) {
      for (var bx = 0; bx < f.rowLen; bx++) {
        var byt = f.rec[f.bmOff + row * f.rowLen + bx];
        for (var bit = 7; bit >= 0; bit--) {
          var x = bx * 8 + (7 - bit);
          var y = yPos + row;
          if (x < maxW && y < totalH && (byt & (1 << bit))) {
            var off = (y * maxW + x) * 4;
            px[off] = 0; px[off + 1] = 0; px[off + 2] = 0;
          }
        }
      }
    }
    yPos += f.height + gap;
  }
  ctx.putImageData(img, 0, 0);
  return true;
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
  var sprW = 24; // always 24px wide — MC uses double-wide pixels
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
            var y = yOff + line;
            for (var dx = 0; dx < 2; dx++) {
              var x = xOff + byteIdx * 8 + px2 * 2 + dx;
              if (x < w && y < h) {
                var off = (y * w + x) * 4;
                px[off] = rgb[0]; px[off+1] = rgb[1]; px[off+2] = rgb[2];
              }
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
  var numChars = gfx.count;
  // C64 charset tile convention: 256-char set = 4 banks of 64 ($00-$3F, $40-$7F, $80-$BF, $C0-$FF).
  // Tiles use banks linearly: 1x2 'A' = $01 top, $41 bottom; 2x1 'A' = $01 $41;
  // 2x2 'A' = $01 $41 top, $81 $C1 bottom.
  // For larger charsets, tiles repeat across bank sets (e.g. 1x2 with 256 chars = 128 tiles).
  var banksPerTile = tileW * tileH;
  var numTiles;
  if (tileW <= 1 && tileH <= 1) {
    numTiles = numChars;
  } else {
    numTiles = Math.floor(numChars / (banksPerTile * 64)) * 64;
  }
  var tilePxW = tileW * 8; // always 8 pixels wide per char — MC uses double-wide pixels
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
        // C64 convention: 64 tiles per bank set, larger charsets use additional sets
        var setIdx = Math.floor(ti / 64);
        var localTi = ti % 64;
        var charIdx = localTi + setIdx * banksPerTile * 64 + (cy * tileW + cx) * 64;
        if (charIdx >= numChars) continue;
        var base = charIdx * 8;

        for (var line = 0; line < 8; line++) {
          var byt = gfx.bm[base + line];
          if (multicolor) {
            for (var px2 = 0; px2 < 4; px2++) {
              var bits = (byt >> (6 - px2 * 2)) & 3;
              var rgb = bits === 0 ? bgRgb : bits === 1 ? mc1Rgb : bits === 2 ? fgRgb : mc2Rgb;
              var y = tileYOff + cy * 8 + line;
              for (var dx = 0; dx < 2; dx++) {
                var x = tileXOff + cx * 8 + px2 * 2 + dx;
                if (x < w && y < h) {
                  var off = (y * w + x) * 4;
                  px[off] = rgb[0]; px[off+1] = rgb[1]; px[off+2] = rgb[2];
                }
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
  // GEOS formats use VLIR, handled separately
  if (fmt.mode === 'geopaint') { renderGeoPaint(ctx, fmt.geosEntry); return; }
  if (fmt.mode === 'geoscrap') { renderGeoScrap(ctx, fmt.geosEntry); return; }
  if (fmt.mode === 'geosalbum') { renderGeoAlbum(ctx, fmt.geosEntry); return; }
  if (fmt.mode === 'geoswrite') { renderGeoWrite(ctx, fmt.geosEntry); return; }
  if (fmt.mode === 'geosfont') { renderGeosFont(ctx, fmt.geosEntry); return; }

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

  // Check for GEOS graphics first, then standard formats
  var geosMatches = detectGeosGfxFormats(entryOff);
  var matches = geosMatches.concat(detectGfxFormats(fileData));
  if (matches.length === 0) {
    showModal('Graphics View', ['Unrecognized graphics format (' + fileData.length + ' bytes).']);
    return;
  }

  // Separate MC variants from base formats — MC becomes a toggle for sprites/charsets
  var mcToggleModes = {}; // base mode → mc mode
  var baseMatches = [];
  for (var mi2 = 0; mi2 < matches.length; mi2++) {
    var m = matches[mi2];
    // Sprite/charset MC variants become toggles, bitmap 'mc' stays as separate format
    if (m.mode !== 'mc' && (m.mode.indexOf('charset-mc') === 0 || m.mode === 'sprites-mc')) {
      var baseMode = m.mode.replace('-mc', '');
      mcToggleModes[baseMode] = m.mode;
    } else {
      baseMatches.push(m);
    }
  }
  var displayMatches = baseMatches;
  var hasMcToggle = false;
  for (var mi3 = 0; mi3 < displayMatches.length; mi3++) {
    if (mcToggleModes[displayMatches[mi3].mode]) { hasMcToggle = true; break; }
  }

  var activeFmt = displayMatches[0] || matches[0];
  var mcEnabled = false;
  var currentZoom = 0; // 0 = auto-detect on first render
  // Color state for sprites/charset/bitmap
  var gfxColors = { bg: 0, fg: 1, mc1: 2, mc2: 3 };

  function getEffectiveFmt() {
    if (mcEnabled && mcToggleModes[activeFmt.mode]) {
      // Find the MC match object
      for (var ei = 0; ei < matches.length; ei++) {
        if (matches[ei].mode === mcToggleModes[activeFmt.mode] && matches[ei].layout === activeFmt.layout) return matches[ei];
      }
    }
    return activeFmt;
  }

  // For multicolor bitmaps, try to read bg from file
  var needsColorPicker = false;
  var colorLabels = null;

  function updateColorContext() {
    var eff = getEffectiveFmt();
    var mode = eff.mode;
    if (mode === 'mc' || eff.layout === 'drp' || eff.layout === 'drazlace') {
      needsColorPicker = true;
      colorLabels = [{ key: 'bg', label: 'Background' }];
      var parser = GFX_PARSERS[eff.layout];
      if (parser) {
        var gfx = parser(fileData);
        if (gfx.bg !== undefined) gfxColors.bg = gfx.bg & 0x0F;
      }
    } else if (mode.indexOf('sprite') >= 0 || mode.indexOf('charset') >= 0) {
      needsColorPicker = true;
      var isMC = mode.indexOf('-mc') >= 0 || mode === 'sprites-mc';
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

  var C64_COLOR_NAMES = [
    'Black', 'White', 'Red', 'Cyan', 'Purple', 'Green',
    'Blue', 'Yellow', 'Orange', 'Brown', 'Light Red', 'Dark Grey',
    'Grey', 'Light Green', 'Light Blue', 'Light Grey'
  ];

  function buildColorPicker(body) {
    if (!needsColorPicker || !colorLabels) return;
    var row = document.createElement('div');
    row.className = 'color-picker-row';

    for (var li = 0; li < colorLabels.length; li++) {
      (function(lbl) {
        var group = document.createElement('div');
        group.className = 'color-picker-group';
        var label = document.createElement('span');
        label.textContent = lbl.label + ':';
        label.className = 'color-picker-label';
        group.appendChild(label);

        var btn = document.createElement('button');
        btn.className = 'color-dropdown-btn';
        var curColor = gfxColors[lbl.key];
        btn.innerHTML = '<span class="color-dropdown-swatch" style="background:' + C64_COLORS[curColor] + '"></span>' +
          '<span class="color-dropdown-name">' + C64_COLOR_NAMES[curColor] + '</span>';
        group.appendChild(btn);

        var popup = document.createElement('div');
        popup.className = 'color-dropdown-popup';
        for (var ci = 0; ci < 16; ci++) {
          (function(colorIdx) {
            var opt = document.createElement('div');
            opt.className = 'color-dropdown-opt' + (colorIdx === curColor ? ' active' : '');
            opt.innerHTML = '<span class="color-dropdown-swatch" style="background:' + C64_COLORS[colorIdx] + '"></span>' +
              '<span class="color-dropdown-name">' + C64_COLOR_NAMES[colorIdx] + '</span>';
            opt.addEventListener('click', function(ev) {
              ev.stopPropagation();
              gfxColors[lbl.key] = colorIdx;
              render();
            });
            popup.appendChild(opt);
          })(ci);
        }
        group.appendChild(popup);

        btn.addEventListener('click', function(ev) {
          ev.stopPropagation();
          var wasOpen = popup.classList.contains('open');
          // Close all other popups
          body.querySelectorAll('.color-dropdown-popup.open').forEach(function(p) { p.classList.remove('open'); });
          if (!wasOpen) popup.classList.add('open');
        });

        row.appendChild(group);
      })(colorLabels[li]);
    }
    body.appendChild(row);

    // Close popups when clicking elsewhere in the modal
    body.addEventListener('click', function() {
      body.querySelectorAll('.color-dropdown-popup.open').forEach(function(p) { p.classList.remove('open'); });
    });
  }

  function render() {
    var eff = getEffectiveFmt();
    document.getElementById('modal-title').textContent = eff.name + ' \u2014 "' + name + '" (' + (fileData.length - 2) + ' bytes)';
    var body = document.getElementById('modal-body');
    body.innerHTML = '';

    // Format selector + MC toggle
    var showSelector = displayMatches.length > 1 || hasMcToggle;
    if (showSelector) {
      var sel = document.createElement('div');
      sel.className = 'flex-row-wrap mb-md';

      if (displayMatches.length > 1) {
        for (var mi = 0; mi < displayMatches.length; mi++) {
          (function(m) {
            var btn = document.createElement('button');
            btn.textContent = m.name;
            btn.className = 'btn-small' + (m === activeFmt ? ' active' : '');
            btn.addEventListener('click', function() {
              activeFmt = m;
              updateColorContext();
              render();
            });
            sel.appendChild(btn);
          })(displayMatches[mi]);
        }
      }

      // MC toggle for sprite/charset modes
      if (hasMcToggle && mcToggleModes[activeFmt.mode]) {
        var mcBtn = document.createElement('button');
        mcBtn.textContent = 'Multicolor';
        mcBtn.className = 'btn-small' + (mcEnabled ? ' active' : '');
        mcBtn.addEventListener('click', function() {
          mcEnabled = !mcEnabled;
          updateColorContext();
          render();
        });
        sel.appendChild(mcBtn);
      }

      body.appendChild(sel);
    }

    var canvas = document.createElement('canvas');
    canvas.className = 'gfx-canvas';
    renderGfxToCanvas(canvas.getContext('2d'), eff, fileData, gfxColors);

    // Auto scale based on format
    if (!currentZoom) {
      if (eff.mode === 'geopaint') {
        currentZoom = 1;
      } else if (eff.mode === 'printshop') {
        currentZoom = 4;
      } else if (eff.mode.indexOf('sprite') >= 0 || eff.mode.indexOf('charset') >= 0) {
        currentZoom = Math.max(2, Math.min(5, Math.floor(600 / (canvas.width || 1))));
      } else {
        currentZoom = 2;
      }
    }
    canvas.style.width = (canvas.width * currentZoom) + 'px';
    canvas.style.height = (canvas.height * currentZoom) + 'px';
    body.appendChild(canvas);

    // Zoom dropdown
    var zoomRow = document.createElement('div');
    zoomRow.className = 'gfx-zoom-row';
    var zoomLabel = document.createElement('span');
    zoomLabel.className = 'color-picker-label';
    zoomLabel.textContent = 'Zoom:';
    zoomRow.appendChild(zoomLabel);

    var zoomGroup = document.createElement('div');
    zoomGroup.className = 'color-picker-group';
    var zoomBtn = document.createElement('button');
    zoomBtn.className = 'color-dropdown-btn';
    zoomBtn.textContent = currentZoom + 'x';
    zoomGroup.appendChild(zoomBtn);

    var zoomPopup = document.createElement('div');
    zoomPopup.className = 'color-dropdown-popup';
    for (var zi = 1; zi <= 5; zi++) {
      (function(z) {
        var opt = document.createElement('div');
        opt.className = 'color-dropdown-opt' + (z === currentZoom ? ' active' : '');
        opt.textContent = z + 'x';
        opt.addEventListener('click', function(ev) {
          ev.stopPropagation();
          currentZoom = z;
          canvas.style.width = (canvas.width * z) + 'px';
          canvas.style.height = (canvas.height * z) + 'px';
          zoomBtn.textContent = z + 'x';
          zoomPopup.classList.remove('open');
        });
        zoomPopup.appendChild(opt);
      })(zi);
    }
    zoomGroup.appendChild(zoomPopup);

    zoomBtn.addEventListener('click', function(ev) {
      ev.stopPropagation();
      var wasOpen = zoomPopup.classList.contains('open');
      body.querySelectorAll('.color-dropdown-popup.open').forEach(function(p) { p.classList.remove('open'); });
      if (!wasOpen) zoomPopup.classList.add('open');
    });

    zoomRow.appendChild(zoomGroup);
    body.appendChild(zoomRow);

    buildColorPicker(body);
  }

  render();

  var footer = document.querySelector('#modal-overlay .modal-footer');
  footer.innerHTML = '<button class="modal-btn-secondary" id="gfx-save-png">Save as PNG</button><button id="modal-close">OK</button>';
  document.getElementById('gfx-save-png').addEventListener('click', function() {
    var canvas = document.querySelector('#modal-body .gfx-canvas');
    if (!canvas) return;
    var a = document.createElement('a');
    a.href = canvas.toDataURL('image/png');
    var safeName = name.replace(/[<>:"/\\|?*\x00-\x1F]/g, '_') || 'image';
    a.download = safeName + '.png';
    a.click();
  });
  document.getElementById('modal-close').addEventListener('click', function() {
    document.getElementById('modal-overlay').classList.remove('open');
  });
  document.getElementById('modal-overlay').classList.add('open');
}

// ── Turbo Assembler viewer ────────────────────────────────────────────
// 6502 mnemonics in alphabetical order (TASS token $30-$67)
var TASS_MNEMONICS = [
  'ADC','AND','ASL','BCC','BCS','BEQ','BIT','BMI','BNE','BPL', // $30-$39
  'BRK','BVC','BVS','CLC','CLD','CLI','CLV','CMP','CPX','CPY', // $3A-$43
  'DEC','DEX','DEY','EOR','INC','INX','INY','JMP','JSR','LDA', // $44-$4D
  'LDX','LDY','LSR','NOP','ORA','PHA','PHP','PLA','PLP','ROL', // $4E-$57
  'ROR','RTI','RTS','SBC','SEC','SED','SEI','STA','STX','STY', // $58-$61
  'TAX','TAY','TSX','TXA','TXS','TYA'                          // $62-$67
];

// Detect TASS source file: not BASIC, has TASS-like header with line padding pattern
function isTassSource(fileData) {
  if (!fileData || fileData.length < 100) return false;
  var addr = fileData[0] | (fileData[1] << 8);
  // TASS files don't load at standard BASIC addresses
  if (addr === 0x0801) return false;
  // Look for the .TEXT/.BYTE signatures that TASS embeds
  for (var i = 0x50; i < Math.min(fileData.length, 0x80); i++) {
    if (fileData[i] === 0x2E && i + 4 < fileData.length) {
      var str = String.fromCharCode(fileData[i+1], fileData[i+2], fileData[i+3], fileData[i+4]);
      if (str === 'TEXT' || str === 'BYTE') return true;
    }
  }
  // Check for $C0 padding pattern (line fill bytes)
  var c0Count = 0;
  for (var j = 0x100; j < Math.min(fileData.length, 0x300); j++) {
    if (fileData[j] === 0xC0) c0Count++;
  }
  if (c0Count > 50) return true;
  return false;
}

function showFileTassViewer(entryOff) {
  if (!currentBuffer) return;
  var data = new Uint8Array(currentBuffer);
  var result = readFileData(currentBuffer, entryOff);
  var fileData = result.data;
  var name = petsciiToReadable(readPetsciiString(data, entryOff + 5, 16)).trim();

  // TASS source: lines separated by $80, padded with $C0
  // Scan for line boundaries
  var lines = [];
  var lineStart = -1;

  // Find where source data begins (skip header, ~$100 area)
  var srcStart = 0x100;
  // Scan back from srcStart to find actual beginning
  for (var si = 0x5A; si < Math.min(fileData.length, 0x200); si++) {
    if (fileData[si] === 0x80 || (fileData[si] >= 0x30 && fileData[si] <= 0x67)) {
      srcStart = si;
      break;
    }
  }

  var currentLine = [];
  for (var pos = srcStart; pos < fileData.length; pos++) {
    var b = fileData[pos];

    if (b === 0x80) {
      // Line separator — flush current line
      if (currentLine.length > 0) lines.push(currentLine);
      currentLine = [];
      // Skip $C0 padding
      while (pos + 1 < fileData.length && fileData[pos + 1] === 0xC0) pos++;
      continue;
    }

    if (b === 0xC0) continue; // padding within line

    if (b === 0x00) {
      // End of meaningful data in this region
      if (currentLine.length > 0) lines.push(currentLine);
      currentLine = [];
      // Skip zero block
      while (pos + 1 < fileData.length && fileData[pos + 1] === 0x00) pos++;
      continue;
    }

    currentLine.push(b);
  }
  if (currentLine.length > 0) lines.push(currentLine);

  // Render lines
  var html = '<div class="basic-listing">';

  if (lines.length === 0) {
    html += '<div class="basic-line">No source lines found.</div>';
  }

  for (var li = 0; li < lines.length; li++) {
    var line = lines[li];
    html += '<div class="basic-line">';

    var lineText = '';
    for (var bi = 0; bi < line.length; bi++) {
      var byte = line[bi];

      // TASS mnemonic token ($30-$67)
      if (byte >= 0x30 && byte <= 0x67) {
        var mnem = TASS_MNEMONICS[byte - 0x30];
        if (mnem) {
          lineText += '<span class="basic-keyword">' + mnem + '</span>';
          continue;
        }
      }

      // $28 = operand byte follows
      if (byte === 0x28 && bi + 1 < line.length) {
        var operand = line[bi + 1];
        lineText += '<span class="text-muted">$' + operand.toString(16).toUpperCase().padStart(2, '0') + '</span>';
        bi++; // skip the operand byte
        continue;
      }

      // Directives as ASCII (.TEXT, .BYTE etc.)
      if (byte === 0x2E && bi + 1 < line.length) {
        var dir = '.';
        bi++;
        while (bi < line.length && line[bi] >= 0x41 && line[bi] <= 0x5A) {
          dir += String.fromCharCode(line[bi]);
          bi++;
        }
        bi--; // back up one since the loop will advance
        lineText += '<span class="basic-keyword">' + escHtml(dir) + '</span>';
        continue;
      }

      // Printable ASCII
      if (byte >= 0x20 && byte <= 0x7E) {
        lineText += escHtml(String.fromCharCode(byte));
        continue;
      }

      // Other bytes as hex
      lineText += '<span class="text-muted">[' + byte.toString(16).toUpperCase().padStart(2, '0') + ']</span>';
    }

    html += lineText + '</div>';
  }
  html += '</div>';

  var titleText = 'Turbo Assembler \u2014 "' + name + '" (' + lines.length + ' lines)';
  if (result.error) titleText += ' \u2014 ' + result.error;
  document.getElementById('modal-title').textContent = titleText;
  document.getElementById('modal-body').innerHTML = html;
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
    // C64 LIST checks only the high byte of the link pointer for end-of-program
    if (fileData[pos + 1] === 0x00) break;

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

    if (pos < fileData.length) pos++; // skip the 0x00 terminator
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
  var titleText = versionLabel + ' \u2014 "' + name + '" (load: $' + hex16(basic.loadAddr) + ')';
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

// ── geoWrite Document Viewer ─────────────────────────────────────────
// Known GEOS font IDs
// Map GEOS font IDs to CSS font stacks that match their style
var GEOS_FONT_CSS = {
  0:  '"Courier New",Courier,monospace',                         // BSW (system mono)
  1:  'Helvetica,Arial,sans-serif',                              // University (sans)
  2:  'Helvetica,Arial,sans-serif',                              // California (sans)
  3:  '"Times New Roman",Times,Georgia,serif',                   // Roma (serif)
  4:  '"Times New Roman",Times,Georgia,serif',                   // Dwinelle (serif)
  5:  'Helvetica,Arial,sans-serif',                              // Cory (sans)
  6:  '"C64 Pro Mono",monospace',                                // Commodore
  7:  '"Palatino Linotype",Palatino,"Book Antiqua",serif',       // Monterey (serif)
  8:  '"Times New Roman",Times,Georgia,serif',                   // LW Roma
  9:  'Helvetica,Arial,sans-serif',                              // LW Cal
  10: 'Symbol,serif',                                            // LW Greek
  11: '"Times New Roman",Times,Georgia,serif'                    // LW Barrows
};

function showGeoWriteViewer(entryOff) {
  if (!currentBuffer) return;
  var data = new Uint8Array(currentBuffer);
  var name = petsciiToReadable(readPetsciiString(data, entryOff + 5, 16)).trim();
  var records = readVLIRRecords(currentBuffer, entryOff);
  if (records.length === 0) {
    showModal('geoWrite', ['No data found in this document.']);
    return;
  }

  // Render inline images to data URLs for embedding in HTML
  var imageCache = {};
  for (var ri = 64; ri < records.length && ri <= 126; ri++) {
    if (!records[ri] || records[ri].length < 4) continue;
    var wCards = records[ri][0];
    var imgH = records[ri][1] | (records[ri][2] << 8);
    if (wCards === 0 || imgH === 0 || imgH > 4096) continue;
    var imgW = wCards * 8;
    var tmpCanvas = document.createElement('canvas');
    tmpCanvas.width = imgW;
    tmpCanvas.height = imgH;
    var tmpCtx = tmpCanvas.getContext('2d');
    renderScrapData(tmpCtx, records[ri], 0);
    imageCache[ri] = { url: tmpCanvas.toDataURL(), w: imgW, h: imgH };
  }

  var html = '<div class="geowrite-doc">';
  var pageCount = 0;

  // Parse text pages (records 0-60)
  for (var pi = 0; pi <= 60 && pi < records.length; pi++) {
    var rec = records[pi];
    if (!rec || rec.length === 0) continue;

    pageCount++;
    html += '<div class="geowrite-page">';
    html += parseGeoWritePage(rec, imageCache);
    html += '</div>';
  }

  if (pageCount === 0) {
    showModal('geoWrite', ['No text pages found in this document.']);
    return;
  }

  html += '</div>';

  document.getElementById('modal-title').textContent =
    'geoWrite \u2014 "' + name + '" (' + pageCount + ' page' + (pageCount > 1 ? 's' : '') + ')';
  var body = document.getElementById('modal-body');
  body.innerHTML = html;

  var footer = document.querySelector('#modal-overlay .modal-footer');
  footer.innerHTML = '<button id="modal-close">OK</button>';
  document.getElementById('modal-close').addEventListener('click', function() {
    document.getElementById('modal-overlay').classList.remove('open');
  });
  document.getElementById('modal-overlay').classList.add('open');
}

function parseGeoWritePage(rec, imageCache) {
  var html = '';
  var pos = 0;
  var len = rec.length;

  // Current style state
  var bold = false, italic = false, underline = false, outline = false;
  var superscript = false, subscript = false;
  var fontSize = 12;
  var fontId = 0;
  var align = 'left';
  var lineSpacing = 1;

  // Start a paragraph
  var paraOpen = false;

  function openPara() {
    if (paraOpen) return;
    var style = 'text-align:' + align;
    if (lineSpacing > 1) style += ';line-height:' + lineSpacing;
    html += '<div class="geowrite-para" style="' + style + '">';
    paraOpen = true;
  }

  function closePara() {
    if (!paraOpen) return;
    html += '</div>';
    paraOpen = false;
  }

  function openSpan() {
    var styles = [];
    var fontCSS = GEOS_FONT_CSS[fontId] || '"Times New Roman",Times,Georgia,serif';
    styles.push('font-family:' + fontCSS);

    // GEOS sizes are in points; convert to px (1pt = 1.333px) and ensure readability
    var pxSize = Math.round(Math.max(10, fontSize * 1.333));
    if (superscript || subscript) pxSize = Math.round(pxSize * 0.7);
    styles.push('font-size:' + pxSize + 'px');

    if (bold) styles.push('font-weight:bold');
    if (italic) styles.push('font-style:italic');
    if (underline) styles.push('text-decoration:underline');
    if (outline) styles.push('-webkit-text-stroke:0.5px;color:transparent');
    if (superscript) styles.push('vertical-align:super');
    if (subscript) styles.push('vertical-align:sub');

    return '<span style="' + styles.join(';') + '">';
  }

  var spanOpen = false;
  function flushSpan() {
    if (spanOpen) { html += '</span>'; spanOpen = false; }
  }
  function ensureSpan() {
    if (!spanOpen) {
      openPara();
      html += openSpan();
      spanOpen = true;
    }
  }

  while (pos < len) {
    var b = rec[pos];

    if (b === 0x00) {
      // End of record
      break;
    } else if (b === 0x11) {
      // ESC_RULER: 1 + 26 bytes
      if (pos + 27 > len) break;
      flushSpan();
      closePara();

      // Parse ruler data (offsets after the $11 byte)
      var justByte = rec[pos + 23];
      var alignVal = justByte & 0x03;
      var spacingVal = (justByte >> 2) & 0x03;

      if (alignVal === 0) align = 'left';
      else if (alignVal === 1) align = 'center';
      else if (alignVal === 2) align = 'right';
      else align = 'justify';

      if (spacingVal === 0) lineSpacing = 1;
      else if (spacingVal === 1) lineSpacing = 1.5;
      else lineSpacing = 2;

      pos += 27;
    } else if (b === 0x17) {
      // NEWCARDSET: 1 + 3 bytes (font descriptor word + style byte)
      if (pos + 4 > len) break;
      flushSpan();

      var fontWord = rec[pos + 1] | (rec[pos + 2] << 8);
      var styleByte = rec[pos + 3];

      fontId = fontWord >> 5;
      fontSize = fontWord & 0x1F;
      if (fontSize === 0) fontSize = 12;

      underline = (styleByte & 0x80) !== 0;
      bold = (styleByte & 0x40) !== 0;
      italic = (styleByte & 0x10) !== 0;
      outline = (styleByte & 0x08) !== 0;
      superscript = (styleByte & 0x04) !== 0;
      subscript = (styleByte & 0x02) !== 0;

      pos += 4;
    } else if (b === 0x10) {
      // ESC_GRAPHICS: 1 + 4 bytes (inline image reference)
      if (pos + 5 > len) break;
      flushSpan();
      openPara();

      var imgWCards = rec[pos + 1];
      var imgHeight = rec[pos + 2] | (rec[pos + 3] << 8);
      var imgRecord = rec[pos + 4];

      if (imageCache[imgRecord]) {
        var img = imageCache[imgRecord];
        html += '<img class="geowrite-img" src="' + img.url +
          '" width="' + img.w + '" height="' + img.h + '">';
      } else {
        html += '<span style="color:#6C6C6C">[Image: record ' + imgRecord +
          ', ' + (imgWCards * 8) + 'x' + imgHeight + ']</span>';
      }

      pos += 5;
    } else if (b === 0x0D) {
      // Carriage return — end line
      flushSpan();
      if (!paraOpen) openPara();
      closePara();
      pos++;
    } else if (b === 0x09) {
      // Tab
      ensureSpan();
      html += '<span class="geowrite-tab">\t</span>';
      pos++;
    } else if (b === 0x0C) {
      // Page break
      flushSpan();
      closePara();
      html += '<div class="geowrite-pagebreak">\u2500\u2500\u2500 page break \u2500\u2500\u2500</div>';
      pos++;
    } else if (b >= 0x20 && b <= 0x7E) {
      // Printable ASCII
      ensureSpan();
      if (b === 0x26) html += '&amp;';
      else if (b === 0x3C) html += '&lt;';
      else if (b === 0x3E) html += '&gt;';
      else if (b === 0x22) html += '&quot;';
      else html += String.fromCharCode(b);
      pos++;
    } else if (b === 0x08 || b === 0x18) {
      // V1.x compat: skip 19 extra bytes
      pos += 20;
    } else if (b === 0xF5) {
      // V1.x compat: skip 10 extra bytes
      pos += 11;
    } else {
      // Unknown control code, skip
      pos++;
    }
  }

  flushSpan();
  closePara();

  // If empty page, show placeholder
  if (html === '') html = '<div class="geowrite-para" style="color:#6C6C6C">(empty page)</div>';

  return html;
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
  var totalBytes = fileData.length;

  var html = '<div class="hex-editor">';
  var rows = Math.ceil(totalBytes / 8) || 1;
  for (var row = 0; row < rows; row++) {
    var rowOff = row * 8;
    html += '<div class="hex-row"><span class="hex-offset">' + rowOff.toString(16).toUpperCase().padStart(4, '0') + '</span><span class="hex-bytes">';
    for (var col = 0; col < 8; col++) {
      var idx = rowOff + col;
      html += idx < totalBytes ? '<span class="hex-byte">' + fileData[idx].toString(16).toUpperCase().padStart(2, '0') + '</span>' : '<span class="hex-byte" style="opacity:0.2">--</span>';
    }
    html += '</span><span class="hex-separator"></span><span class="hex-ascii">';
    for (var col2 = 0; col2 < 8; col2++) {
      var idx2 = rowOff + col2;
      html += idx2 < totalBytes ? '<span class="hex-char">' + escHtml(PETSCII_MAP[fileData[idx2]]) + '</span>' : '<span class="hex-char" style="opacity:0.2">.</span>';
    }
    html += '</span></div>';
  }
  html += '</div>';

  var titleText = 'Hex View \u2014 "' + name + '" (' + totalBytes + ' bytes)';
  if (result.error) titleText += ' \u2014 ' + result.error;
  document.getElementById('modal-title').textContent = titleText;
  document.getElementById('modal-body').innerHTML = html;
  var footer = document.querySelector('#modal-overlay .modal-footer');
  footer.innerHTML = '<button id="modal-close">OK</button>';
  document.getElementById('modal-close').addEventListener('click', function() {
    document.getElementById('modal-overlay').classList.remove('open');
  });
  document.getElementById('modal-overlay').classList.add('open');
}

function showFileDisasmViewer(entryOff) {
  if (!currentBuffer) return;
  var data = new Uint8Array(currentBuffer);
  var result = readFileData(currentBuffer, entryOff);
  var fileData = result.data;
  var name = petsciiToReadable(readPetsciiString(data, entryOff + 5, 16)).trim();

  var loadAddr = fileData.length >= 2 ? (fileData[0] | (fileData[1] << 8)) : 0;
  var codeData = fileData.subarray(2);
  var lines = disassemble6502(codeData, loadAddr, 5000);

  // Detect SYS address for auto-scroll
  var sysTarget = null;
  var packerInfo = detectPacker(fileData);
  if (packerInfo && packerInfo.sysAddr > loadAddr) {
    sysTarget = '$' + hex16(packerInfo.sysAddr);
  }

  var html = '<div class="hex-editor">';
  for (var di = 0; di < lines.length; di++) {
    var l = lines[di];
    var instrClass = l.type === 2 ? 'dasm-unsafe' : l.type === 1 ? 'dasm-illegal' : 'dasm-instr';
    var isSysEntry = (sysTarget && l.addr === sysTarget);
    html += '<div class="hex-row' + (isSysEntry ? ' dasm-sys-entry' : '') + '"' +
      (isSysEntry ? ' id="dasm-sys-target"' : '') +
      '><span class="dasm-offset">' + l.addr + '</span><span class="dasm-bytes">' + escHtml(l.bytes) + '</span><span class="' + instrClass + '">' + escHtml(l.text) + '</span></div>';
  }
  html += '</div>';

  var titleText = 'Disassembly \u2014 "' + name + '" (load: $' + hex16(loadAddr) + ', ' + codeData.length + ' bytes)';
  if (sysTarget) titleText += ', SYS ' + sysTarget;
  if (result.error) titleText += ' \u2014 ' + result.error;
  document.getElementById('modal-title').textContent = titleText;
  document.getElementById('modal-body').innerHTML = html;
  var footer = document.querySelector('#modal-overlay .modal-footer');
  footer.innerHTML = '<button id="modal-close">OK</button>';
  document.getElementById('modal-close').addEventListener('click', function() {
    document.getElementById('modal-overlay').classList.remove('open');
  });
  document.getElementById('modal-overlay').classList.add('open');

  // Scroll to SYS entry point
  var sysEl = document.getElementById('dasm-sys-target');
  if (sysEl) sysEl.scrollIntoView({ block: 'start' });
}

// ── Hex sector editor ─────────────────────────────────────────────────
// ── 6502 Disassembler ─────────────────────────────────────────────────
// 6502 opcode table: [mnemonic, addressing mode, type]
// type: 0=legal, 1=illegal (stable), 2=illegal (unstable)
// Addressing modes: 0=impl, 1=imm, 2=zp, 3=zpx, 4=zpy, 5=abs, 6=absx, 7=absy, 8=indx, 9=indy, 10=rel, 11=ind
// Mnemonics follow oxyron.de naming convention
var OPS_6502 = [
  ['BRK',0,0],['ORA',8,0],['KIL',0,2],['SLO',8,1],['NOP',2,1],['ORA',2,0],['ASL',2,0],['SLO',2,1],['PHP',0,0],['ORA',1,0],['ASL',0,0],['ANC',1,1],['NOP',5,1],['ORA',5,0],['ASL',5,0],['SLO',5,1],
  ['BPL',10,0],['ORA',9,0],['KIL',0,2],['SLO',9,1],['NOP',3,1],['ORA',3,0],['ASL',3,0],['SLO',3,1],['CLC',0,0],['ORA',7,0],['NOP',0,1],['SLO',7,1],['NOP',6,1],['ORA',6,0],['ASL',6,0],['SLO',6,1],
  ['JSR',5,0],['AND',8,0],['KIL',0,2],['RLA',8,1],['BIT',2,0],['AND',2,0],['ROL',2,0],['RLA',2,1],['PLP',0,0],['AND',1,0],['ROL',0,0],['ANC',1,1],['BIT',5,0],['AND',5,0],['ROL',5,0],['RLA',5,1],
  ['BMI',10,0],['AND',9,0],['KIL',0,2],['RLA',9,1],['NOP',3,1],['AND',3,0],['ROL',3,0],['RLA',3,1],['SEC',0,0],['AND',7,0],['NOP',0,1],['RLA',7,1],['NOP',6,1],['AND',6,0],['ROL',6,0],['RLA',6,1],
  ['RTI',0,0],['EOR',8,0],['KIL',0,2],['SRE',8,1],['NOP',2,1],['EOR',2,0],['LSR',2,0],['SRE',2,1],['PHA',0,0],['EOR',1,0],['LSR',0,0],['ALR',1,1],['JMP',5,0],['EOR',5,0],['LSR',5,0],['SRE',5,1],
  ['BVC',10,0],['EOR',9,0],['KIL',0,2],['SRE',9,1],['NOP',3,1],['EOR',3,0],['LSR',3,0],['SRE',3,1],['CLI',0,0],['EOR',7,0],['NOP',0,1],['SRE',7,1],['NOP',6,1],['EOR',6,0],['LSR',6,0],['SRE',6,1],
  ['RTS',0,0],['ADC',8,0],['KIL',0,2],['RRA',8,1],['NOP',2,1],['ADC',2,0],['ROR',2,0],['RRA',2,1],['PLA',0,0],['ADC',1,0],['ROR',0,0],['ARR',1,1],['JMP',11,0],['ADC',5,0],['ROR',5,0],['RRA',5,1],
  ['BVS',10,0],['ADC',9,0],['KIL',0,2],['RRA',9,1],['NOP',3,1],['ADC',3,0],['ROR',3,0],['RRA',3,1],['SEI',0,0],['ADC',7,0],['NOP',0,1],['RRA',7,1],['NOP',6,1],['ADC',6,0],['ROR',6,0],['RRA',6,1],
  ['NOP',1,1],['STA',8,0],['NOP',1,1],['SAX',8,1],['STY',2,0],['STA',2,0],['STX',2,0],['SAX',2,1],['DEY',0,0],['NOP',1,1],['TXA',0,0],['XAA',1,2],['STY',5,0],['STA',5,0],['STX',5,0],['SAX',5,1],
  ['BCC',10,0],['STA',9,0],['KIL',0,2],['AHX',9,2],['STY',3,0],['STA',3,0],['STX',4,0],['SAX',4,1],['TYA',0,0],['STA',7,0],['TXS',0,0],['TAS',7,2],['SHY',6,2],['STA',6,0],['SHX',7,2],['AHX',7,2],
  ['LDY',1,0],['LDA',8,0],['LDX',1,0],['LAX',8,1],['LDY',2,0],['LDA',2,0],['LDX',2,0],['LAX',2,1],['TAY',0,0],['LDA',1,0],['TAX',0,0],['LAX',1,2],['LDY',5,0],['LDA',5,0],['LDX',5,0],['LAX',5,1],
  ['BCS',10,0],['LDA',9,0],['KIL',0,2],['LAX',9,1],['LDY',3,0],['LDA',3,0],['LDX',4,0],['LAX',4,1],['CLV',0,0],['LDA',7,0],['TSX',0,0],['LAS',7,2],['LDY',6,0],['LDA',6,0],['LDX',7,0],['LAX',7,1],
  ['CPY',1,0],['CMP',8,0],['NOP',1,1],['DCP',8,1],['CPY',2,0],['CMP',2,0],['DEC',2,0],['DCP',2,1],['INY',0,0],['CMP',1,0],['DEX',0,0],['AXS',1,1],['CPY',5,0],['CMP',5,0],['DEC',5,0],['DCP',5,1],
  ['BNE',10,0],['CMP',9,0],['KIL',0,2],['DCP',9,1],['NOP',3,1],['CMP',3,0],['DEC',3,0],['DCP',3,1],['CLD',0,0],['CMP',7,0],['NOP',0,1],['DCP',7,1],['NOP',6,1],['CMP',6,0],['DEC',6,0],['DCP',6,1],
  ['CPX',1,0],['SBC',8,0],['NOP',1,1],['ISC',8,1],['CPX',2,0],['SBC',2,0],['INC',2,0],['ISC',2,1],['INX',0,0],['SBC',1,0],['NOP',0,0],['SBC',1,1],['CPX',5,0],['SBC',5,0],['INC',5,0],['ISC',5,1],
  ['BEQ',10,0],['SBC',9,0],['KIL',0,2],['ISC',9,1],['NOP',3,1],['SBC',3,0],['INC',3,0],['ISC',3,1],['SED',0,0],['SBC',7,0],['NOP',0,1],['ISC',7,1],['NOP',6,1],['SBC',6,0],['INC',6,0],['ISC',6,1]
];
var MODE_SIZE = [1,2,2,2,2,3,3,3,2,2,2,3];

function disassemble6502(data, startAddr, maxLines) {
  var lines = [];
  var pos = 0;
  for (var li = 0; li < maxLines && pos < data.length; li++) {
    var opcode = data[pos];
    var op = OPS_6502[opcode];
    var mnemonic = op[0];
    var mode = op[1];
    var type = op[2]; // 0=legal, 1=illegal stable, 2=illegal unsafe
    var size = MODE_SIZE[mode];
    var addr = startAddr + pos;
    var bytes = '';
    for (var b = 0; b < size && pos + b < data.length; b++) {
      bytes += hex8(data[pos + b]) + ' ';
    }
    var operand = '';
    if (size === 2 && pos + 1 < data.length) {
      var val = data[pos + 1];
      var h8 = hex8(val);
      if (mode === 10) { // relative
        var target = addr + 2 + (val > 127 ? val - 256 : val);
        operand = '$' + hex16(target & 0xFFFF);
      } else if (mode === 1) operand = '#$' + h8;
      else if (mode === 8) operand = '($' + h8 + ',X)';
      else if (mode === 9) operand = '($' + h8 + '),Y';
      else if (mode === 3) operand = '$' + h8 + ',X';
      else if (mode === 4) operand = '$' + h8 + ',Y';
      else operand = '$' + h8;
    } else if (size === 3 && pos + 2 < data.length) {
      var val16 = data[pos + 1] | (data[pos + 2] << 8);
      var h16 = hex16(val16);
      if (mode === 11) operand = '($' + h16 + ')';
      else if (mode === 6) operand = '$' + h16 + ',X';
      else if (mode === 7) operand = '$' + h16 + ',Y';
      else operand = '$' + h16;
    }
    lines.push({
      addr: '$' + hex16(addr),
      bytes: bytes.padEnd(9),
      text: mnemonic + (operand ? ' ' + operand : ''),
      type: type
    });
    pos += size;
  }
  return lines;
}

function showSectorHexEditor(track, sector, highlightOff, highlightLen) {
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

  // Build highlight set: find ALL occurrences of the search term in this sector
  var hlSet = {};
  if (highlightOff !== undefined && highlightLen !== undefined && highlightLen > 0) {
    // Extract the search term bytes from the clicked match
    var termBytes = [];
    for (var tb = 0; tb < highlightLen && highlightOff + tb < 256; tb++) {
      termBytes.push(working[highlightOff + tb]);
    }
    // Find all matches in the sector
    for (var sp = 0; sp <= 256 - termBytes.length; sp++) {
      var match = true;
      for (var sb = 0; sb < termBytes.length; sb++) {
        if (working[sp + sb] !== termBytes[sb]) { match = false; break; }
      }
      if (match) {
        for (var hb = 0; hb < termBytes.length; hb++) hlSet[sp + hb] = true;
      }
    }
  }

  var html = '<div class="hex-editor">';
  for (var row = 0; row < 32; row++) {
    var rowOff = row * 8;
    html += '<div class="hex-row">';
    html += '<span class="hex-offset">' + rowOff.toString(16).toUpperCase().padStart(2, '0') + '</span>';
    html += '<span class="hex-bytes">';
    for (var col = 0; col < 8; col++) {
      var idx = rowOff + col;
      var b = working[idx];
      var hl = hlSet[idx] ? ' hex-highlight' : '';
      html += '<span class="hex-byte' + hl + '" data-idx="' + idx + '" data-row="' + row + '">' +
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
  var nextT = working[0], nextS = working[1];
  var hasChain = nextT > 0 && nextT <= currentTracks;
  footer.innerHTML = '<button id="hex-follow" class="modal-btn-secondary"' + (hasChain ? '' : ' disabled') +
    ' title="Follow sector chain (J)">Follow Chain \u2192</button>' +
    '<button id="hex-cancel" class="modal-btn-secondary">Cancel</button><button id="hex-save">Save</button>';
  document.getElementById('modal-overlay').classList.add('open');

  var navTrack = track;
  var navSector = sector;

  function saveCurrentAndNavigate(newTrack, newSector) {
    // Save current edits if modified
    var hasChanges = false;
    for (var c = 0; c < 256; c++) { if (working[c] !== original[c]) { hasChanges = true; break; } }
    if (hasChanges) {
      pushUndo();
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
        if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); commit(); }
        else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); span.textContent = getValue().toString(16).toUpperCase().padStart(2, '0'); }
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
    // J key: follow chain when not editing
    if (editingByte === null && (e.key === 'j' || e.key === 'J')) {
      e.preventDefault();
      followChain();
      return;
    }
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

  // Follow chain: jump to sector pointed to by bytes 0-1
  function followChain() {
    var nt = working[0], ns = working[1];
    if (nt === 0 || nt > currentTracks) return;
    if (ns >= currentFormat.sectorsPerTrack(nt)) return;
    saveCurrentAndNavigate(nt, ns);
  }
  document.getElementById('hex-follow').addEventListener('click', followChain);

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

// ── Search ────────────────────────────────────────────────────────────
// Parse hex string like "$A0 FF", "A0FF", "$A0$FF" into byte array, or null if not hex
function parseHexSearch(term) {
  var cleaned = term.replace(/[\s\$,]/g, '');
  if (cleaned.length === 0 || cleaned.length % 2 !== 0) return null;
  if (!/^[0-9A-Fa-f]+$/.test(cleaned)) return null;
  // Only treat as hex if it looks intentional: has $ prefix, spaces between pairs, or all hex with even length
  var looksHex = term.indexOf('$') >= 0 || /^[0-9A-Fa-f]{2}(\s+[0-9A-Fa-f]{2})+$/.test(term.trim()) ||
    (cleaned.length >= 2 && cleaned.length <= 512 && /^[0-9A-Fa-f]+$/.test(cleaned) && !/^[A-Za-z]+$/.test(cleaned));
  if (!looksHex) return null;
  var bytes = [];
  for (var i = 0; i < cleaned.length; i += 2) {
    bytes.push(parseInt(cleaned.substring(i, i + 2), 16));
  }
  return bytes;
}

function searchDisk(buffer, format, numTracks, term, scope) {
  var data = new Uint8Array(buffer);
  var results = [];
  if (!term || term.length === 0) return results;

  // Try hex pattern first
  var hexBytes = parseHexSearch(term);
  var isHex = hexBytes !== null;

  var termBytes, termPetscii;
  if (isHex) {
    termBytes = hexBytes;
    termPetscii = hexBytes; // exact byte match for hex
  } else {
    // Convert search term to byte array (try PETSCII and ASCII)
    var termUpper = term.toUpperCase();
    termBytes = [];
    for (var ti = 0; ti < term.length; ti++) termBytes.push(term.charCodeAt(ti));
    termPetscii = [];
    for (var tp = 0; tp < termUpper.length; tp++) {
      var ch = termUpper.charCodeAt(tp);
      if (ch >= 0x41 && ch <= 0x5A) termPetscii.push(ch);
      else if (ch >= 0x20 && ch <= 0x3F) termPetscii.push(ch);
      else termPetscii.push(ch);
    }
  }

  // Determine which sectors to search based on scope
  var dirTrack = format.dirTrack || format.bamTrack;

  for (var t = 1; t <= numTracks; t++) {
    var spt = format.sectorsPerTrack(t);
    for (var s = 0; s < spt; s++) {
      var off = getTrackOffsets(format, numTracks)[t] + s * 256;
      if (off < 0 || off + 256 > data.length) continue;

      if (scope === 'filename') {
        if (t !== dirTrack) continue;
        for (var ei = 0; ei < format.entriesPerSector; ei++) {
          var eo = off + ei * format.entrySize;
          var nameOff = eo + 5;
          var mPos = matchBytesAt(data, nameOff, 16, termBytes, termPetscii);
          if (mPos >= 0) {
            var cp = buildContextParts(data, nameOff, 16, nameOff + mPos, termBytes.length);
            results.push({ track: t, sector: s, offset: nameOff - off + mPos, petParts: cp.petParts });
          }
        }
      } else if (scope === 'header') {
        if (t !== format.bamTrack) continue;
        var hOff = off + format.nameOffset;
        var mPos2 = matchBytesAt(data, hOff, format.nameLength, termBytes, termPetscii);
        if (mPos2 >= 0) {
          var cp2 = buildContextParts(data, hOff, format.nameLength, hOff + mPos2, termBytes.length);
          results.push({ track: t, sector: s, offset: format.nameOffset + mPos2, petParts: cp2.petParts });
        }
      } else if (scope === 'id') {
        if (t !== format.bamTrack) continue;
        var idOff = off + format.idOffset;
        var mPos3 = matchBytesAt(data, idOff, format.idLength, termBytes, termPetscii);
        if (mPos3 >= 0) {
          var cp3 = buildContextParts(data, idOff, format.idLength, idOff + mPos3, termBytes.length);
          results.push({ track: t, sector: s, offset: format.idOffset + mPos3, petParts: cp3.petParts });
        }
      } else {
        // Search all bytes in sector
        var matches = findAllInSector(data, off, 256, termBytes, termPetscii);
        for (var mi = 0; mi < matches.length; mi++) {
          results.push({ track: t, sector: s, offset: matches[mi].offset, context: matches[mi].context });
        }
      }
    }
  }
  return results;
}

function matchBytesAt(data, offset, len, termAscii, termPetscii) {
  if (offset + termAscii.length > data.length) return -1;
  if (termAscii.length > len) return -1;
  for (var pos = 0; pos <= len - termAscii.length; pos++) {
    var matchA = true, matchP = true;
    for (var i = 0; i < termAscii.length; i++) {
      var b = data[offset + pos + i];
      if (b !== termAscii[i]) matchA = false;
      if (b !== termPetscii[i]) matchP = false;
      if (!matchA && !matchP) break;
    }
    if (matchA || matchP) return pos;
  }
  return -1;
}


function findAllInSector(data, sectorOff, len, termAscii, termPetscii) {
  var results = [];
  for (var pos = 0; pos <= len - termAscii.length; pos++) {
    var matchA = true, matchP = true;
    for (var i = 0; i < termAscii.length; i++) {
      var b = data[sectorOff + pos + i];
      if (b !== termAscii[i]) matchA = false;
      if (b !== termPetscii[i]) matchP = false;
      if (!matchA && !matchP) break;
    }
    if (matchA || matchP) {
      var ctxStart = Math.max(0, pos - 4);
      var ctxEnd = Math.min(len, pos + termAscii.length + 4);
      var petParts = [];
      for (var ci = ctxStart; ci < ctxEnd; ci++) {
        var cb = data[sectorOff + ci];
        var isMatch = (ci >= pos && ci < pos + termAscii.length);
        petParts.push({ ch: byteToDisplayChar(cb), match: isMatch });
      }
      results.push({ offset: pos, petParts: petParts });
      pos += termAscii.length - 1; // skip past match
    }
  }
  return results;
}

// Convert byte to a displayable character (ASCII-safe, no PUA/C64 glyphs)
function byteToDisplayChar(b) {
  if (b >= 0x20 && b <= 0x7E) return String.fromCharCode(b); // printable ASCII
  if (b >= 0x41 && b <= 0x5A) return String.fromCharCode(b); // A-Z
  if (b >= 0xC1 && b <= 0xDA) return String.fromCharCode(b - 0x80); // PETSCII uppercase → A-Z
  if (b >= 0x61 && b <= 0x7A) return String.fromCharCode(b - 0x20); // PETSCII shifted lowercase → A-Z
  return '\u00B7'; // middle dot for non-printable
}

function buildContextParts(data, startOff, len, matchOff, matchLen) {
  var petParts = [];
  for (var i = 0; i < len; i++) {
    var b = data[startOff + i];
    if (b === 0xA0) continue; // skip PETSCII padding
    var isMatch = (startOff + i >= matchOff && startOff + i < matchOff + matchLen);
    petParts.push({ ch: byteToDisplayChar(b), match: isMatch });
  }
  return { petParts: petParts };
}

function showSearchModal(title, allTabs) {
  closeMenus();
  document.getElementById('modal-title').textContent = title;
  var body = document.getElementById('modal-body');
  body.innerHTML = '';

  // Search form
  var form = document.createElement('div');
  form.className = 'search-form';

  var row = document.createElement('div');
  row.className = 'search-row';

  var input = document.createElement('input');
  input.type = 'text';
  input.placeholder = 'Text or hex ($A0 FF)...';
  input.id = 'search-input';
  row.appendChild(input);

  var searchBtn = document.createElement('button');
  searchBtn.textContent = 'Search';
  searchBtn.id = 'search-go';
  row.appendChild(searchBtn);

  form.appendChild(row);

  var scopeRow = document.createElement('div');
  scopeRow.className = 'search-scopes';
  var scopes = [['all', 'All sectors'], ['filename', 'Filenames'], ['header', 'Disk name'], ['id', 'Disk ID']];
  for (var si = 0; si < scopes.length; si++) {
    var label = document.createElement('label');
    var radio = document.createElement('input');
    radio.type = 'radio';
    radio.name = 'search-scope';
    radio.value = scopes[si][0];
    if (si === 0) radio.checked = true;
    label.appendChild(radio);
    label.appendChild(document.createTextNode(scopes[si][1]));
    scopeRow.appendChild(label);
  }
  form.appendChild(scopeRow);

  var layout = document.createElement('div');
  layout.className = 'search-layout';
  layout.appendChild(form);

  var resultsDiv = document.createElement('div');
  resultsDiv.className = 'search-results';
  resultsDiv.id = 'search-results';
  layout.appendChild(resultsDiv);

  body.appendChild(layout);

  function doSearch() {
    var term = input.value;
    var scopeRadio = form.querySelector('input[name="search-scope"]:checked');
    var scope = scopeRadio ? scopeRadio.value : 'all';
    resultsDiv.innerHTML = '';

    if (!term) return;

    // Show spinner while searching
    resultsDiv.innerHTML = '<div class="search-spinner"><i class="fa-solid fa-spinner fa-spin"></i> Searching...</div>';
    searchBtn.disabled = true;

    // Determine byte length of search term for highlighting
    var hexParsed = parseHexSearch(term);
    var searchByteLen = hexParsed ? hexParsed.length : term.length;

    // Defer to let spinner render
    setTimeout(function() {
      resultsDiv.innerHTML = '';

      if (allTabs) {
        saveActiveTab();
        var totalResults = 0;
        for (var ti = 0; ti < tabs.length; ti++) {
          var tab = tabs[ti];
          var prevBuffer = currentBuffer;
          var prevFormat = currentFormat;
          var prevTracks = currentTracks;
          currentBuffer = tab.buffer;
          currentFormat = tab.format;
          currentTracks = tab.tracks;

          var results = searchDisk(tab.buffer, tab.format, tab.tracks, term, scope);

          currentBuffer = prevBuffer;
          currentFormat = prevFormat;
          currentTracks = prevTracks;

          if (results.length > 0) {
            var header = document.createElement('div');
            header.className = 'search-tab-header';
            header.textContent = tab.name + ' (' + results.length + ' result' + (results.length > 1 ? 's' : '') + ')';
            resultsDiv.appendChild(header);

            renderResults(resultsDiv, results, tab, searchByteLen);
            totalResults += results.length;
          }
        }
        if (totalResults === 0) {
          resultsDiv.innerHTML = '<div class="search-no-results">No results found.</div>';
        }
      } else {
        var results2 = searchDisk(currentBuffer, currentFormat, currentTracks, term, scope);
        if (results2.length === 0) {
          resultsDiv.innerHTML = '<div class="search-no-results">No results found.</div>';
        } else {
          var summary = document.createElement('div');
          summary.className = 'search-tab-header';
          summary.textContent = results2.length + ' result' + (results2.length > 1 ? 's' : '') + ' found';
          resultsDiv.appendChild(summary);
          renderResults(resultsDiv, results2, null, searchByteLen);
        }
      }
      searchBtn.disabled = false;
    }, 20);
  }

  function renderResults(container, results, targetTab, termLen) {
    // Count matches per sector for display
    var sectorCounts = {};
    for (var ci = 0; ci < results.length; ci++) {
      var key = results[ci].track + ':' + results[ci].sector;
      sectorCounts[key] = (sectorCounts[key] || 0) + 1;
    }

    for (var ri = 0; ri < results.length; ri++) {
      (function(r, tab) {
        var row = document.createElement('div');
        row.className = 'search-result';

        var sKey = r.track + ':' + r.sector;
        var tHex = r.track.toString(16).toUpperCase().padStart(2, '0');
        var sHex = r.sector.toString(16).toUpperCase().padStart(2, '0');

        var html = '<span class="search-result-ts">T:$' + tHex + ' S:$' + sHex + '</span> ';
        if (r.petParts) {
          html += '<span class="search-result-pet">';
          for (var pi = 0; pi < r.petParts.length; pi++) {
            html += escHtml(r.petParts[pi].ch);
          }
          html += '</span>';
        }
        var cnt = sectorCounts[sKey];
        html += ' <span class="search-result-pet">(' + cnt + ' occurrence' + (cnt > 1 ? 's' : '') + ')</span>';
        row.innerHTML = html;

        row.title = 'Open sector editor at T:$' + tHex + ' S:$' + sHex;
        row.addEventListener('click', function() {
          hidePetsciiPicker();
          document.getElementById('modal-overlay').classList.remove('open');
          if (tab) {
            // Switch to the target tab first
            saveActiveTab();
            loadTab(tab);
            activeTabId = tab.id;
            var info = parseCurrentDir(currentBuffer);
            renderDisk(info);
            renderTabs();
            updateMenuState();
          }
          showSectorHexEditor(r.track, r.sector, r.offset, termLen);
        });
        container.appendChild(row);
      })(results[ri], targetTab);
    }
  }

  searchBtn.addEventListener('click', function() { hidePetsciiPicker(); doSearch(); });
  input.addEventListener('keydown', function(e) {
    if (e.key === 'Enter') { e.preventDefault(); hidePetsciiPicker(); doSearch(); }
  });

  // Track cursor for PETSCII picker insertion (without intercepting keyboard)
  var updateCursor = function() { input._lastCursorPos = input.selectionStart; };
  input.addEventListener('keyup', updateCursor);
  input.addEventListener('mouseup', updateCursor);
  input.addEventListener('input', updateCursor);

  // Show picker only when search input has focus
  input.addEventListener('focus', function() {
    showPetsciiPicker(input, 255);
  });
  input.addEventListener('blur', function() {
    if (!pickerClicking) hidePetsciiPicker();
  });

  var footer = document.querySelector('#modal-overlay .modal-footer');
  footer.innerHTML = '<button id="modal-close">OK</button>';
  document.getElementById('modal-close').addEventListener('click', function() {
    hidePetsciiPicker();
    document.getElementById('modal-overlay').classList.remove('open');
  });
  document.getElementById('modal-overlay').classList.add('open');
  input.focus();
}

document.getElementById('opt-find').addEventListener('click', function(e) {
  e.stopPropagation();
  if (!currentBuffer) return;
  showSearchModal('Find', false);
});

document.getElementById('opt-find-tabs').addEventListener('click', function(e) {
  e.stopPropagation();
  if (tabs.length === 0) return;
  showSearchModal('Find in All Tabs', true);
});

// ── Go to Sector (Ctrl+G) ────────────────────────────────────────────
function showGoToSector() {
  closeMenus();
  document.getElementById('modal-title').textContent = 'Go to Sector';
  var body = document.getElementById('modal-body');
  body.innerHTML = '';

  var row = document.createElement('div');
  row.className = 'flex-row';

  var tLabel = document.createElement('span');
  tLabel.textContent = 'Track: $';
  row.appendChild(tLabel);

  var trackInput = createHexInput({
    value: currentFormat.bamTrack || 18,
    maxBytes: 1,
    validate: function(v) { return v >= 1 && v <= currentTracks; }
  });
  row.appendChild(trackInput);

  var sLabel = document.createElement('span');
  sLabel.textContent = 'Sector: $';
  row.appendChild(sLabel);

  var sectorInput = createHexInput({
    value: 0,
    maxBytes: 1,
    validate: function(v) {
      var t = trackInput.getValue();
      if (t < 1 || t > currentTracks) return false;
      return v >= 0 && v < currentFormat.sectorsPerTrack(t);
    }
  });
  row.appendChild(sectorInput);

  body.appendChild(row);

  // Revalidate sector when track changes
  trackInput.addEventListener('input', function() { sectorInput.isValid(); });

  var footer = document.querySelector('#modal-overlay .modal-footer');
  footer.innerHTML =
    '<button class="modal-btn-secondary" id="goto-cancel">Cancel</button>' +
    '<button id="goto-ok">Go</button>';

  function doGo() {
    if (!trackInput.isValid() || !sectorInput.isValid()) return;
    var t = trackInput.getValue();
    var s = sectorInput.getValue();
    document.getElementById('modal-overlay').classList.remove('open');
    showSectorHexEditor(t, s);
  }

  document.getElementById('goto-ok').addEventListener('click', doGo);
  document.getElementById('goto-cancel').addEventListener('click', function() {
    document.getElementById('modal-overlay').classList.remove('open');
  });

  // Enter to confirm
  trackInput.addEventListener('keydown', function(e) { if (e.key === 'Enter') doGo(); });
  sectorInput.addEventListener('keydown', function(e) { if (e.key === 'Enter') doGo(); });

  document.getElementById('modal-overlay').classList.add('open');
  trackInput.focus();
  trackInput.select();
}

document.getElementById('opt-goto-sector').addEventListener('click', function(e) {
  e.stopPropagation();
  if (!currentBuffer || isTapeFormat()) return;
  showGoToSector();
});

document.getElementById('opt-view-hex').addEventListener('click', function(e) {
  e.stopPropagation();
  if (!currentBuffer || selectedEntryIndex < 0) return;
  closeMenus();
  showFileHexViewer(selectedEntryIndex);
});

document.getElementById('opt-view-disasm').addEventListener('click', function(e) {
  e.stopPropagation();
  if (!currentBuffer || selectedEntryIndex < 0) return;
  closeMenus();
  showFileDisasmViewer(selectedEntryIndex);
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

document.getElementById('opt-view-tass').addEventListener('click', function(e) {
  e.stopPropagation();
  if (!currentBuffer || selectedEntryIndex < 0) return;
  closeMenus();
  showFileTassViewer(selectedEntryIndex);
});

document.getElementById('opt-view-geowrite').addEventListener('click', function(e) {
  e.stopPropagation();
  if (!currentBuffer || selectedEntryIndex < 0) return;
  closeMenus();
  showGeoWriteViewer(selectedEntryIndex);
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
  pushUndo();

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
  var slots = getDirSlotOffsets(currentBuffer);
  var entries = selectedEntries.length > 1 ? selectedEntries.slice() : [selectedEntryIndex];

  // Get sorted slot indices for the selected entries
  var indices = [];
  for (var i = 0; i < entries.length; i++) {
    var idx = slots.indexOf(entries[i]);
    if (idx >= 0) indices.push(idx);
  }
  indices.sort(function(a, b) { return a - b; });
  if (indices.length === 0) return;

  // Find last non-empty slot for lower bound
  var data = new Uint8Array(currentBuffer);
  var lastUsed = -1;
  for (var li = slots.length - 1; li >= 0; li--) {
    var empty = true;
    for (var bi = 2; bi < 32; bi++) {
      if (data[slots[li] + bi] !== 0x00) { empty = false; break; }
    }
    if (!empty) { lastUsed = li; break; }
  }

  // Check bounds
  if (direction < 0 && indices[0] <= 0) return;
  if (direction > 0 && indices[indices.length - 1] >= lastUsed) return;

  pushUndo();

  if (direction < 0) {
    // Moving up: swap each entry with the one above, top to bottom
    for (var u = 0; u < indices.length; u++) {
      swapDirEntries(currentBuffer, slots[indices[u]], slots[indices[u] - 1]);
      indices[u]--;
    }
  } else {
    // Moving down: swap each entry with the one below, bottom to top
    for (var d = indices.length - 1; d >= 0; d--) {
      swapDirEntries(currentBuffer, slots[indices[d]], slots[indices[d] + 1]);
      indices[d]++;
    }
  }

  // Update selection to follow moved entries
  selectedEntries = [];
  for (var j = 0; j < indices.length; j++) {
    selectedEntries.push(slots[indices[j]]);
  }
  selectedEntryIndex = selectedEntries[0];

  var info = parseCurrentDir(currentBuffer);
  renderDisk(info);
}

// ── Sort directory ────────────────────────────────────────────────────
function sortDirectory(buffer, sortType) {
  pushUndo();
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
  pushUndo();
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
  pushUndo();
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
  if (!currentBuffer || !blocksSpan || isTapeFormat()) return;
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
    pushUndo();
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
    if (ev.key === 'Enter') { ev.preventDefault(); ev.stopPropagation(); commitEdit(); }
    else if (ev.key === 'Escape') { ev.preventDefault(); ev.stopPropagation(); revert(); }
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
    pushUndo();
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
    if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); commitEdit(); }
    else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); revert(); }
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
    pushUndo();
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
    if (ev.key === 'Enter') { ev.preventDefault(); ev.stopPropagation(); commitEdit(); }
    else if (ev.key === 'Escape') { ev.preventDefault(); ev.stopPropagation(); revert(); }
  });

  registerActiveEdit(blocksSpan, revert);
}

function startRenameEntry(entryEl) {
  if (!currentBuffer || !entryEl || isTapeFormat()) return;
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
      pushUndo();
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
    if (ev.key === 'Enter') { ev.preventDefault(); ev.stopPropagation(); commitRename(); }
    else if (ev.key === 'Escape') { ev.preventDefault(); ev.stopPropagation(); revert(); }
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

document.getElementById('opt-undo').addEventListener('click', function(e) {
  e.stopPropagation();
  closeMenus();
  if (popUndo()) {
    var info = parseCurrentDir(currentBuffer);
    renderDisk(info);
    updateMenuState();
    updateEntryMenuState();
  }
});

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
    selectedEntries = [selectedEntryIndex];
  } else {
    selectedEntryIndex = -1;
    selectedEntries = [];
  }
  renderDisk(info);
  updateMenuState();
});

document.querySelectorAll('#opt-align .submenu .option').forEach(el => {
  el.addEventListener('click', (e) => {
    e.stopPropagation();
    if (!currentBuffer || selectedEntryIndex < 0) return;
    closeMenus();
    var entries = selectedEntries.length > 0 ? selectedEntries : [selectedEntryIndex];
    for (var ai = 0; ai < entries.length; ai++) alignFilename(currentBuffer, entries[ai], el.dataset.align);
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
  pushUndo();
  var entries = selectedEntries.length > 0 ? selectedEntries : [selectedEntryIndex];
  for (var ri = 0; ri < entries.length; ri++) {
    var actual = countActualBlocks(currentBuffer, entries[ri]);
    writeBlockSize(currentBuffer, entries[ri], actual);
  }
  const info = parseCurrentDir(currentBuffer);
  renderDisk(info);
});

// ── File menu: Export File ─────────────────────────────────────────────
document.getElementById('opt-export').addEventListener('click', (e) => {
  e.stopPropagation();
  if (!currentBuffer || selectedEntryIndex < 0) return;
  closeMenus();
  var entries = selectedEntries.length > 0 ? selectedEntries : [selectedEntryIndex];
  var data = new Uint8Array(currentBuffer);
  var extMap = { 1: '.seq', 2: '.prg', 3: '.usr', 4: '.rel' };

  for (var ei = 0; ei < entries.length; ei++) {
    var entOff = entries[ei];
    var ext, name;

    if (isTapeFormat()) {
      var tapeEntry = getTapeEntry(entOff);
      if (!tapeEntry) continue;
      ext = tapeEntry.type.trim() === 'SEQ' ? '.seq' : '.prg';
      name = petsciiToReadable(tapeEntry.name).trim();
    } else {
      var typeByte = data[entOff + 2];
      var typeIdx = typeByte & 0x07;
      if (typeIdx < 1 || typeIdx > 4) continue;
      ext = extMap[typeIdx];
      name = petsciiToReadable(readPetsciiString(data, entOff + 5, 16)).trim();
    }

    var result = readFileData(currentBuffer, entOff);
    if (result.error || result.data.length === 0) continue;

    name = name.replace(/[<>:"/\\|?*\x00-\x1F]/g, '_');
    if (!name) name = 'export';

    var blob = new Blob([result.data], { type: 'application/octet-stream' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name + ext;
    a.click();
    URL.revokeObjectURL(a.href);
  }
});

// ── Export as CVT (GEOS ConVerT format) ──────────────────────────────
function buildCvtFile(entryOff) {
  var data = new Uint8Array(currentBuffer);
  var geos = readGeosInfo(currentBuffer, entryOff);

  // Block 1: directory entry bytes 2-31 + signature + zero padding
  var block1 = new Uint8Array(254);
  for (var i = 0; i < 30; i++) block1[i] = data[entryOff + 2 + i];
  var isVlir = geos.structure === 1;
  var sig = isVlir ? 'PRG formatted GEOS file V1.0' : 'SEQ formatted GEOS file V1.0';
  for (var si = 0; si < sig.length; si++) block1[30 + si] = sig.charCodeAt(si);

  // Block 2: info block (254 bytes = sector bytes 2-255)
  var block2 = new Uint8Array(254);
  if (geos.infoTrack > 0) {
    var infoOff = sectorOffset(geos.infoTrack, geos.infoSector);
    if (infoOff >= 0) {
      for (var j = 0; j < 254; j++) block2[j] = data[infoOff + 2 + j];
    }
  }

  if (isVlir) {
    var records = readVLIRRecords(currentBuffer, entryOff);

    // Read VLIR index sector to distinguish 00/00 vs 00/FF
    var vlirT = data[entryOff + 3], vlirS = data[entryOff + 4];
    var vlirOff = sectorOffset(vlirT, vlirS);
    var vlirRaw = (vlirOff >= 0) ? data.subarray(vlirOff, vlirOff + 256) : null;

    // Block 3: record index
    var block3 = new Uint8Array(254);
    var recordChunks = [];

    for (var ri = 0; ri < 127; ri++) {
      var rec = ri < records.length ? records[ri] : null;
      if (rec && rec.length > 0) {
        var numBlocks = Math.ceil(rec.length / 254);
        var remainder = rec.length % 254;
        var lastByte = (remainder === 0) ? 0xFF : (remainder + 1);
        block3[ri * 2] = numBlocks;
        block3[ri * 2 + 1] = lastByte;
        // Pad data to full blocks
        var padded = new Uint8Array(numBlocks * 254);
        padded.set(rec);
        recordChunks.push(padded);
      } else if (vlirRaw && ri < 127) {
        // Preserve original empty marker (00/FF = empty, 00/00 = end)
        block3[ri * 2] = vlirRaw[2 + ri * 2];
        block3[ri * 2 + 1] = vlirRaw[2 + ri * 2 + 1];
      }
    }

    var totalLen = 254 + 254 + 254;
    for (var ci = 0; ci < recordChunks.length; ci++) totalLen += recordChunks[ci].length;
    var cvt = new Uint8Array(totalLen);
    cvt.set(block1, 0);
    cvt.set(block2, 254);
    cvt.set(block3, 508);
    var pos = 762;
    for (var di = 0; di < recordChunks.length; di++) {
      cvt.set(recordChunks[di], pos);
      pos += recordChunks[di].length;
    }
    return cvt;
  } else {
    // Sequential file
    var result = readFileData(currentBuffer, entryOff);
    var fileBytes = result.data;
    var seqBlocks = Math.max(1, Math.ceil(fileBytes.length / 254));
    var seqPadded = new Uint8Array(seqBlocks * 254);
    seqPadded.set(fileBytes);

    var cvt = new Uint8Array(254 + 254 + seqPadded.length);
    cvt.set(block1, 0);
    cvt.set(block2, 254);
    cvt.set(seqPadded, 508);
    return cvt;
  }
}

document.getElementById('opt-export-cvt').addEventListener('click', function(e) {
  e.stopPropagation();
  if (!currentBuffer || selectedEntryIndex < 0) return;
  closeMenus();

  var data = new Uint8Array(currentBuffer);
  var name = petsciiToReadable(readPetsciiString(data, selectedEntryIndex + 5, 16)).trim();
  name = name.replace(/[<>:"/\\|?*\x00-\x1F]/g, '_');
  if (!name) name = 'export';

  var cvtData = buildCvtFile(selectedEntryIndex);
  var blob = new Blob([cvtData], { type: 'application/octet-stream' });
  var a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name + '.cvt';
  a.click();
  URL.revokeObjectURL(a.href);
});

// ── geoWrite RTF/PDF Export ───────────────────────────────────────────
// Map GEOS font IDs to RTF font names
var GEOS_RTF_FONTS = {
  0:'Courier New', 1:'Helvetica', 2:'Helvetica', 3:'Times New Roman',
  4:'Times New Roman', 5:'Helvetica', 6:'Courier New', 7:'Palatino Linotype',
  8:'Times New Roman', 9:'Helvetica', 10:'Symbol', 11:'Times New Roman'
};

// Parse geoWrite VLIR records into a structured document
function parseGeoWriteDoc(entryOff) {
  var records = readVLIRRecords(currentBuffer, entryOff);
  if (records.length === 0) return null;

  // Pre-render inline images as PNG data URLs
  var images = {};
  for (var ri = 64; ri < records.length && ri <= 126; ri++) {
    if (!records[ri] || records[ri].length < 4) continue;
    var wCards = records[ri][0];
    var imgH = records[ri][1] | (records[ri][2] << 8);
    if (wCards === 0 || imgH === 0 || imgH > 4096) continue;
    var tmpC = document.createElement('canvas');
    tmpC.width = wCards * 8; tmpC.height = imgH;
    renderScrapData(tmpC.getContext('2d'), records[ri], 0);
    // Get raw PNG bytes
    var dataUrl = tmpC.toDataURL('image/png');
    images[ri] = { w: wCards * 8, h: imgH, dataUrl: dataUrl,
      base64: dataUrl.substring(dataUrl.indexOf(',') + 1) };
  }

  // Parse text pages
  var pages = [];
  for (var pi = 0; pi <= 60 && pi < records.length; pi++) {
    var rec = records[pi];
    if (!rec || rec.length === 0) continue;
    pages.push(parseGeoWritePageStructured(rec, images));
  }

  return { pages: pages, images: images };
}

// Parse a single geoWrite page into structured elements
function parseGeoWritePageStructured(rec, images) {
  var elements = []; // array of { type, ... }
  var pos = 0, len = rec.length;

  var fontId = 0, fontSize = 12;
  var bold = false, italic = false, underline = false, outline = false;
  var superscript = false, subscript = false;
  var align = 0, spacing = 0; // 0=left,1=center,2=right,3=justified; 0=single,1=1.5,2=double

  var currentText = '';

  function flushText() {
    if (currentText.length > 0) {
      elements.push({ type: 'text', text: currentText,
        fontId: fontId, fontSize: fontSize,
        bold: bold, italic: italic, underline: underline, outline: outline,
        superscript: superscript, subscript: subscript });
      currentText = '';
    }
  }

  while (pos < len) {
    var b = rec[pos];
    if (b === 0x00) break;
    else if (b === 0x11) { // ruler
      if (pos + 27 > len) break;
      flushText();
      var justByte = rec[pos + 23];
      align = justByte & 0x03;
      spacing = (justByte >> 2) & 0x03;
      elements.push({ type: 'ruler', align: align, spacing: spacing });
      pos += 27;
    } else if (b === 0x17) { // font/style change
      if (pos + 4 > len) break;
      flushText();
      var fontWord = rec[pos + 1] | (rec[pos + 2] << 8);
      var styleByte = rec[pos + 3];
      fontId = fontWord >> 5;
      fontSize = fontWord & 0x1F;
      if (fontSize === 0) fontSize = 12;
      bold = (styleByte & 0x40) !== 0;
      italic = (styleByte & 0x10) !== 0;
      underline = (styleByte & 0x80) !== 0;
      outline = (styleByte & 0x08) !== 0;
      superscript = (styleByte & 0x04) !== 0;
      subscript = (styleByte & 0x02) !== 0;
      pos += 4;
    } else if (b === 0x10) { // inline image
      if (pos + 5 > len) break;
      flushText();
      var imgRec = rec[pos + 4];
      var img = images[imgRec];
      if (img) elements.push({ type: 'image', record: imgRec, w: img.w, h: img.h });
      pos += 5;
    } else if (b === 0x0D) { // CR
      flushText();
      elements.push({ type: 'cr' });
      pos++;
    } else if (b === 0x09) { // tab
      flushText();
      elements.push({ type: 'tab' });
      pos++;
    } else if (b === 0x0C) { // page break
      flushText();
      elements.push({ type: 'pagebreak' });
      pos++;
    } else if (b >= 0x20 && b <= 0x7E) {
      currentText += String.fromCharCode(b);
      pos++;
    } else if (b === 0x08 || b === 0x18) { pos += 20; }
    else if (b === 0xF5) { pos += 11; }
    else pos++;
  }
  flushText();
  return elements;
}

// ── RTF Export ───────────────────────────────────────────────────────
function geoWriteToRtf(entryOff) {
  var doc = parseGeoWriteDoc(entryOff);
  if (!doc || doc.pages.length === 0) return null;

  // Build font table from all used fonts
  var fontSet = {};
  for (var pi = 0; pi < doc.pages.length; pi++) {
    for (var ei = 0; ei < doc.pages[pi].length; ei++) {
      var el = doc.pages[pi][ei];
      if (el.type === 'text') fontSet[el.fontId] = true;
    }
  }
  var fontIds = Object.keys(fontSet).map(Number);
  if (fontIds.length === 0) fontIds = [0];
  var fontMap = {}; // geosId -> rtfIndex
  var fontTable = '{\\fonttbl';
  for (var fi = 0; fi < fontIds.length; fi++) {
    fontMap[fontIds[fi]] = fi;
    var fname = GEOS_RTF_FONTS[fontIds[fi]] || 'Times New Roman';
    var fFamily = (fname === 'Courier New') ? 'fmodern' :
      (fname === 'Helvetica') ? 'fswiss' : 'froman';
    fontTable += '{\\f' + fi + '\\' + fFamily + ' ' + fname + ';}';
  }
  fontTable += '}';

  var rtf = '{\\rtf1\\ansi\\deff0\n' + fontTable + '\n';

  var curAlign = 0;
  var curSpacing = 0;

  function alignCmd(a) {
    if (a === 1) return '\\qc';
    if (a === 2) return '\\qr';
    if (a === 3) return '\\qj';
    return '\\ql';
  }

  function spacingCmd(s) {
    if (s === 1) return '\\sl360\\slmult1'; // 1.5
    if (s === 2) return '\\sl480\\slmult1'; // double
    return '\\sl240\\slmult1'; // single
  }

  function escRtf(text) {
    var out = '';
    for (var i = 0; i < text.length; i++) {
      var c = text.charCodeAt(i);
      if (c === 0x5C) out += '\\\\';
      else if (c === 0x7B) out += '\\{';
      else if (c === 0x7D) out += '\\}';
      else if (c > 127) out += '\\u' + c + '?';
      else out += text[i];
    }
    return out;
  }

  for (var pi2 = 0; pi2 < doc.pages.length; pi2++) {
    var page = doc.pages[pi2];
    if (pi2 > 0) rtf += '\\page\n';

    var paraOpen = false;
    function openPara() {
      if (!paraOpen) {
        rtf += '\\pard ' + alignCmd(curAlign) + ' ' + spacingCmd(curSpacing) + ' ';
        paraOpen = true;
      }
    }
    function closePara() {
      if (paraOpen) { rtf += '\\par\n'; paraOpen = false; }
    }

    for (var ei2 = 0; ei2 < page.length; ei2++) {
      var el2 = page[ei2];

      if (el2.type === 'ruler') {
        closePara();
        curAlign = el2.align;
        curSpacing = el2.spacing;
      } else if (el2.type === 'text') {
        openPara();
        var fIdx = fontMap[el2.fontId] !== undefined ? fontMap[el2.fontId] : 0;
        var ptSize = Math.max(10, el2.fontSize) * 2; // RTF uses half-points
        rtf += '{\\f' + fIdx + '\\fs' + ptSize;
        if (el2.bold) rtf += '\\b';
        if (el2.italic) rtf += '\\i';
        if (el2.underline) rtf += '\\ul';
        if (el2.superscript) rtf += '\\super';
        if (el2.subscript) rtf += '\\sub';
        if (el2.outline) rtf += '\\outl';
        rtf += ' ' + escRtf(el2.text) + '}';
      } else if (el2.type === 'cr') {
        if (!paraOpen) openPara();
        closePara();
      } else if (el2.type === 'tab') {
        openPara();
        rtf += '\\tab ';
      } else if (el2.type === 'pagebreak') {
        closePara();
        rtf += '\\page\n';
      } else if (el2.type === 'image') {
        openPara();
        var img2 = doc.images[el2.record];
        if (img2) {
          // Embed as PNG in RTF using \pngblip
          var hex = atob(img2.base64).split('').map(function(c) {
            return ('0' + c.charCodeAt(0).toString(16)).slice(-2);
          }).join('');
          rtf += '{\\pict\\pngblip\\picw' + (el2.w * 15) +
            '\\pich' + (el2.h * 15) +
            '\\picwgoal' + (el2.w * 15) +
            '\\pichgoal' + (el2.h * 15) + '\n';
          // Line-wrap hex at 80 chars
          for (var hi = 0; hi < hex.length; hi += 80) {
            rtf += hex.substring(hi, hi + 80) + '\n';
          }
          rtf += '}';
        }
      }
    }
    closePara();
  }

  rtf += '}';
  return rtf;
}

document.getElementById('opt-export-rtf').addEventListener('click', function(e) {
  e.stopPropagation();
  if (!currentBuffer || selectedEntryIndex < 0) return;
  closeMenus();

  var data = new Uint8Array(currentBuffer);
  var name = petsciiToReadable(readPetsciiString(data, selectedEntryIndex + 5, 16)).trim();
  name = name.replace(/[<>:"/\\|?*\x00-\x1F]/g, '_') || 'document';

  var rtf = geoWriteToRtf(selectedEntryIndex);
  if (!rtf) { showModal('Export Error', ['No geoWrite data found.']); return; }

  var blob = new Blob([rtf], { type: 'application/rtf' });
  var a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name + '.rtf';
  a.click();
  URL.revokeObjectURL(a.href);
});

// ── PDF Export ───────────────────────────────────────────────────────
// Minimal PDF generator (no external library)
function geoWriteToPdf(entryOff) {
  var doc = parseGeoWriteDoc(entryOff);
  if (!doc || doc.pages.length === 0) return null;

  var data = new Uint8Array(currentBuffer);
  var docName = petsciiToReadable(readPetsciiString(data, entryOff + 5, 16)).trim();

  // PDF coordinate system: 72 units per inch, origin at bottom-left
  var pageW = 595, pageH = 842; // A4
  var marginL = 56, marginR = 56, marginT = 56, marginB = 56;
  var usableW = pageW - marginL - marginR;

  // Collect embedded images and convert to PDF image XObjects
  var imgObjIds = {};

  // We'll build the PDF structure manually
  var objects = [];
  var objOffsets = [];

  function addObj(content) {
    objects.push(content);
    return objects.length; // 1-based ID
  }

  // PDF font mapping: use the 14 standard PDF fonts
  function pdfFontName(geosId) {
    var isSerif = [3, 4, 7, 8, 11].indexOf(geosId) >= 0;
    var isMono = (geosId === 0 || geosId === 6);
    if (isMono) return 'Courier';
    if (isSerif) return 'Times-Roman';
    return 'Helvetica';
  }

  function pdfFontNameStyled(geosId, bold, italic) {
    var base = pdfFontName(geosId);
    if (base === 'Courier') {
      if (bold && italic) return 'Courier-BoldOblique';
      if (bold) return 'Courier-Bold';
      if (italic) return 'Courier-Oblique';
      return 'Courier';
    }
    if (base === 'Helvetica') {
      if (bold && italic) return 'Helvetica-BoldOblique';
      if (bold) return 'Helvetica-Bold';
      if (italic) return 'Helvetica-Oblique';
      return 'Helvetica';
    }
    // Times
    if (bold && italic) return 'Times-BoldItalic';
    if (bold) return 'Times-Bold';
    if (italic) return 'Times-Italic';
    return 'Times-Roman';
  }

  // Collect all font variants used
  var fontVariants = {};
  for (var pi = 0; pi < doc.pages.length; pi++) {
    for (var ei = 0; ei < doc.pages[pi].length; ei++) {
      var el = doc.pages[pi][ei];
      if (el.type === 'text') {
        var fn = pdfFontNameStyled(el.fontId, el.bold, el.italic);
        fontVariants[fn] = true;
      }
    }
  }
  if (Object.keys(fontVariants).length === 0) fontVariants['Helvetica'] = true;

  // Assign font resource names
  var fontResNames = {};
  var fontResIdx = 0;
  for (var fv in fontVariants) {
    fontResNames[fv] = 'F' + fontResIdx;
    fontResIdx++;
  }

  // Create font objects
  var fontObjIds = {};
  for (var fv2 in fontVariants) {
    var fObjId = addObj('<< /Type /Font /Subtype /Type1 /BaseFont /' + fv2 + ' /Encoding /WinAnsiEncoding >>');
    fontObjIds[fv2] = fObjId;
  }

  // Create image XObjects
  for (var imgRec in doc.images) {
    var img = doc.images[imgRec];
    // Decode PNG to raw pixels for PDF (use canvas)
    var tmpC = document.createElement('canvas');
    tmpC.width = img.w; tmpC.height = img.h;
    var tmpCtx = tmpC.getContext('2d');
    var tmpImg = new Image();
    tmpImg.src = img.dataUrl;
    tmpCtx.drawImage(tmpImg, 0, 0);
    var imgData = tmpCtx.getImageData(0, 0, img.w, img.h);

    // Convert to grayscale (GEOS images are monochrome)
    var grayData = new Uint8Array(img.w * img.h);
    for (var px = 0; px < img.w * img.h; px++) {
      grayData[px] = imgData.data[px * 4]; // R channel (mono: 0 or 255)
    }

    var imgHexArr = new Array(grayData.length);
    for (var gi = 0; gi < grayData.length; gi++) {
      imgHexArr[gi] = ('0' + grayData[gi].toString(16)).slice(-2);
    }
    var imgStream = imgHexArr.join('');

    var imgObjId = addObj('<< /Type /XObject /Subtype /Image /Width ' + img.w +
      ' /Height ' + img.h + ' /ColorSpace /DeviceGray /BitsPerComponent 8 ' +
      '/Length ' + imgStream.length + ' /Filter /ASCIIHexDecode >>\nstream\n' +
      imgStream + '>\nendstream');
    imgObjIds[imgRec] = imgObjId;
  }

  // Build page content streams
  var pageObjIds = [];
  var contentObjIds = [];
  var pagesObjId; // will be set after

  // Helper: escape PDF string
  function escPdf(text) {
    return text.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
  }

  // Per-character widths for standard PDF fonts (Adobe widths / 1000)
  // Covers ASCII 32-126; default for unknown chars
  var HELVETICA_W = [
    278,278,355,556,556,889,667,191,333,333,389,584,278,333,278,278, // 32-47 (space ! " # $ % & ' ( ) * + , - . /)
    556,556,556,556,556,556,556,556,556,556,278,278,584,584,584,556, // 48-63 (0-9 : ; < = > ?)
    1015,667,667,722,722,667,611,778,722,278,500,667,556,833,722,778, // 64-79 (@A-O)
    667,778,722,667,611,722,667,944,667,667,611,278,278,278,469,556, // 80-95 (P-Z [ \ ] ^ _)
    333,556,556,500,556,556,278,556,556,222,222,500,222,833,556,556, // 96-111 (` a-o)
    556,556,333,500,278,556,500,722,500,500,500,334,260,334,584       // 112-126 (p-z { | } ~)
  ];
  var TIMES_W = [
    250,333,408,500,500,833,778,180,333,333,500,564,250,333,250,278, // 32-47
    500,500,500,500,500,500,500,500,500,500,278,278,564,564,564,444, // 48-63
    921,722,667,667,722,611,556,722,722,333,389,722,611,889,722,722, // 64-79
    556,722,667,556,611,722,722,944,722,722,611,333,278,333,469,500, // 80-95
    333,444,500,444,500,444,333,500,500,278,278,500,278,778,500,500, // 96-111
    500,500,333,389,278,500,500,722,500,500,444,480,200,480,541       // 112-126
  ];

  function textWidth(fontName, text, fontSize) {
    var isCourier = fontName.indexOf('Courier') === 0;
    var isHelv = fontName.indexOf('Helvetica') === 0;
    var widths = isHelv ? HELVETICA_W : TIMES_W;
    var total = 0;
    for (var i = 0; i < text.length; i++) {
      if (isCourier) { total += 600; continue; }
      var code = text.charCodeAt(i);
      var w = (code >= 32 && code <= 126) ? widths[code - 32] : 500;
      total += w;
    }
    return total * fontSize / 1000;
  }

  for (var pi2 = 0; pi2 < doc.pages.length; pi2++) {
    var page = doc.pages[pi2];
    var stream = '';
    var curY = pageH - marginT;
    var curFontName = 'Helvetica';
    var curFontSize = 12;
    var lineHeight = 14;
    var curAlign = 0;

    stream += 'BT\n';
    stream += '/' + fontResNames[curFontName] + ' ' + curFontSize + ' Tf\n';
    stream += marginL + ' ' + curY + ' Td\n';

    var lineText = '';
    var lineWidth = 0;

    function flushLine() {
      if (lineText.length === 0) return;

      var xOffset = 0;
      if (curAlign === 1) xOffset = (usableW - lineWidth) / 2; // center
      else if (curAlign === 2) xOffset = usableW - lineWidth; // right

      if (xOffset > 0) {
        stream += xOffset.toFixed(1) + ' 0 Td\n';
      }
      stream += '(' + escPdf(lineText) + ') Tj\n';
      if (xOffset > 0) {
        stream += (-xOffset).toFixed(1) + ' 0 Td\n';
      }
      lineText = '';
      lineWidth = 0;
    }

    function newLine() {
      flushLine();
      curY -= lineHeight;
      if (curY < marginB) {
        // Would overflow page — stop (simplified: no auto-pagination within a GEOS page)
        curY = marginB;
      }
      stream += 0 + ' ' + (-lineHeight).toFixed(1) + ' Td\n';
    }

    for (var ei2 = 0; ei2 < page.length; ei2++) {
      var el2 = page[ei2];

      if (el2.type === 'ruler') {
        curAlign = el2.align;
        if (el2.spacing === 1) lineHeight = curFontSize * 1.5;
        else if (el2.spacing === 2) lineHeight = curFontSize * 2;
        else lineHeight = curFontSize * 1.2;
      } else if (el2.type === 'text') {
        var fn2 = pdfFontNameStyled(el2.fontId, el2.bold, el2.italic);
        var sz2 = Math.max(10, el2.fontSize);
        if (fn2 !== curFontName || sz2 !== curFontSize) {
          flushLine();
          curFontName = fn2;
          curFontSize = sz2;
          lineHeight = sz2 * 1.2;
          stream += '/' + fontResNames[curFontName] + ' ' + curFontSize + ' Tf\n';
        }
        lineText += el2.text;
        lineWidth += textWidth(curFontName, el2.text, curFontSize);
      } else if (el2.type === 'cr') {
        newLine();
      } else if (el2.type === 'tab') {
        lineText += '    ';
        lineWidth += textWidth(curFontName, '    ', curFontSize);
      } else if (el2.type === 'pagebreak') {
        flushLine();
        // Simplified: just add extra vertical space
        curY -= lineHeight * 2;
        stream += '0 ' + (-(lineHeight * 2)).toFixed(1) + ' Td\n';
      } else if (el2.type === 'image') {
        flushLine();
        stream += 'ET\n'; // end text to draw image
        var imgObj = imgObjIds[el2.record];
        if (imgObj) {
          var imgDisplayW = Math.min(el2.w, usableW);
          var imgDisplayH = el2.h * (imgDisplayW / el2.w);
          curY -= imgDisplayH + 4;
          stream += 'q ' + imgDisplayW.toFixed(1) + ' 0 0 ' + imgDisplayH.toFixed(1) +
            ' ' + marginL + ' ' + curY.toFixed(1) + ' cm /Im' + el2.record + ' Do Q\n';
          curY -= 4;
        }
        stream += 'BT\n';
        stream += '/' + fontResNames[curFontName] + ' ' + curFontSize + ' Tf\n';
        stream += marginL + ' ' + curY.toFixed(1) + ' Td\n';
      }
    }
    flushLine();
    stream += 'ET\n';

    // Build resource dictionary for this page
    var fontRes = '';
    for (var fr in fontResNames) {
      fontRes += '/' + fontResNames[fr] + ' ' + fontObjIds[fr] + ' 0 R ';
    }
    var imgRes = '';
    for (var ir in imgObjIds) {
      imgRes += '/Im' + ir + ' ' + imgObjIds[ir] + ' 0 R ';
    }

    var contentId = addObj('<< /Length ' + stream.length + ' >>\nstream\n' + stream + 'endstream');
    contentObjIds.push(contentId);

    var resDict = '<< /Font << ' + fontRes + '>> ';
    if (imgRes) resDict += '/XObject << ' + imgRes + '>> ';
    resDict += '>>';

    var pageId = addObj('<< /Type /Page /Parent PAGES_REF /MediaBox [0 0 ' +
      pageW + ' ' + pageH + '] /Contents ' + contentId + ' 0 R /Resources ' + resDict + ' >>');
    pageObjIds.push(pageId);
  }

  // Pages object
  var kidsStr = pageObjIds.map(function(id) { return id + ' 0 R'; }).join(' ');
  pagesObjId = addObj('<< /Type /Pages /Kids [' + kidsStr + '] /Count ' + pageObjIds.length + ' >>');

  // Catalog
  var catalogId = addObj('<< /Type /Catalog /Pages ' + pagesObjId + ' 0 R >>');

  // Info
  var infoId = addObj('<< /Title (' + escPdf(docName) + ') /Producer (CBM Disk Editor) /Creator (geoWrite) >>');

  // Now build the actual PDF bytes
  var pdf = '%PDF-1.4\n';

  // Write objects and track offsets
  for (var oi = 0; oi < objects.length; oi++) {
    objOffsets.push(pdf.length);
    var objContent = objects[oi];
    // Replace PAGES_REF placeholder in page objects
    objContent = objContent.replace('PAGES_REF', pagesObjId + ' 0 R');
    pdf += (oi + 1) + ' 0 obj\n' + objContent + '\nendobj\n';
  }

  // Cross-reference table
  var xrefOff = pdf.length;
  pdf += 'xref\n0 ' + (objects.length + 1) + '\n';
  pdf += '0000000000 65535 f \n';
  for (var xi = 0; xi < objOffsets.length; xi++) {
    pdf += ('0000000000' + objOffsets[xi]).slice(-10) + ' 00000 n \n';
  }

  pdf += 'trailer\n<< /Size ' + (objects.length + 1) +
    ' /Root ' + catalogId + ' 0 R /Info ' + infoId + ' 0 R >>\n';
  pdf += 'startxref\n' + xrefOff + '\n%%EOF\n';

  return pdf;
}

document.getElementById('opt-export-pdf').addEventListener('click', function(e) {
  e.stopPropagation();
  if (!currentBuffer || selectedEntryIndex < 0) return;
  closeMenus();

  var data = new Uint8Array(currentBuffer);
  var name = petsciiToReadable(readPetsciiString(data, selectedEntryIndex + 5, 16)).trim();
  name = name.replace(/[<>:"/\\|?*\x00-\x1F]/g, '_') || 'document';

  var pdf = geoWriteToPdf(selectedEntryIndex);
  if (!pdf) { showModal('Export Error', ['No geoWrite data found.']); return; }

  var blob = new Blob([pdf], { type: 'application/pdf' });
  var a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name + '.pdf';
  a.click();
  URL.revokeObjectURL(a.href);
});

// ── geoWrite Plain Text Export ────────────────────────────────────────
document.getElementById('opt-export-txt-gw').addEventListener('click', function(e) {
  e.stopPropagation();
  if (!currentBuffer || selectedEntryIndex < 0) return;
  closeMenus();

  var doc = parseGeoWriteDoc(selectedEntryIndex);
  if (!doc || doc.pages.length === 0) {
    showModal('Export Error', ['No geoWrite data found.']);
    return;
  }

  var text = '';
  for (var pi = 0; pi < doc.pages.length; pi++) {
    var page = doc.pages[pi];
    for (var ei = 0; ei < page.length; ei++) {
      var el = page[ei];
      if (el.type === 'text') text += el.text;
      else if (el.type === 'cr') text += '\n';
      else if (el.type === 'tab') text += '\t';
      else if (el.type === 'pagebreak') text += '\n--- Page Break ---\n';
      else if (el.type === 'image') text += '[Image]\n';
    }
    if (pi < doc.pages.length - 1) text += '\n';
  }

  var data = new Uint8Array(currentBuffer);
  var name = petsciiToReadable(readPetsciiString(data, selectedEntryIndex + 5, 16)).trim();
  name = name.replace(/[<>:"/\\|?*\x00-\x1F]/g, '_') || 'document';

  var blob = new Blob([text], { type: 'text/plain' });
  var a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name + '.txt';
  a.click();
  URL.revokeObjectURL(a.href);
});

// ── File menu: Copy / Paste ──────────────────────────────────────────
document.getElementById('opt-copy').addEventListener('click', (e) => {
  e.stopPropagation();
  if (!currentBuffer || selectedEntryIndex < 0) return;
  closeMenus();
  var data = new Uint8Array(currentBuffer);
  var entries = selectedEntries.length > 0 ? selectedEntries : [selectedEntryIndex];
  clipboard = [];

  for (var ci = 0; ci < entries.length; ci++) {
    var entOff = entries[ci];
    var typeIdx, nameBytes, geosBytes, geosInfoBlock;

    if (isTapeFormat()) {
      var tapeEntry = getTapeEntry(entOff);
      if (!tapeEntry) continue;
      typeIdx = tapeEntry.type.trim() === 'SEQ' ? 1 : 2; // SEQ=1, PRG=2
      // Convert PUA name back to PETSCII bytes
      nameBytes = new Uint8Array(16);
      for (var ni = 0; ni < 16 && ni < tapeEntry.name.length; ni++) {
        nameBytes[ni] = unicodeToPetscii(tapeEntry.name[ni]);
      }
      for (var pi = tapeEntry.name.length; pi < 16; pi++) nameBytes[pi] = 0xA0;
      geosBytes = new Uint8Array(9);
      geosInfoBlock = null;
    } else {
      var typeByte = data[entOff + 2];
      typeIdx = typeByte & 0x07;
      if (typeIdx < 1 || typeIdx > 4) continue;
      nameBytes = new Uint8Array(16);
      for (var i = 0; i < 16; i++) nameBytes[i] = data[entOff + 5 + i];
      geosBytes = new Uint8Array(9);
      for (var g = 0; g < 9; g++) geosBytes[g] = data[entOff + 21 + g];
      geosInfoBlock = null;
      var infoTrack = data[entOff + 0x15];
      var infoSector = data[entOff + 0x16];
      if (data[entOff + 0x18] > 0 && infoTrack > 0) {
        var infoOff = sectorOffset(infoTrack, infoSector);
        if (infoOff >= 0) {
          geosInfoBlock = new Uint8Array(256);
          for (var ib = 0; ib < 256; ib++) geosInfoBlock[ib] = data[infoOff + ib];
        }
      }
    }

    var result = readFileData(currentBuffer, entOff);
    if (result.error || result.data.length === 0) continue;

    clipboard.push({
      typeIdx: typeIdx,
      nameBytes: nameBytes,
      geosBytes: geosBytes,
      geosInfoBlock: geosInfoBlock,
      data: new Uint8Array(result.data)
    });
  }
  updateEntryMenuState();
});

document.getElementById('opt-paste').addEventListener('click', async (e) => {
  e.stopPropagation();
  if (clipboard.length === 0 || !currentBuffer || !canInsertFile()) return;
  closeMenus();

  // Check if any GEOS files in clipboard and disk is not GEOS
  var hasGeos = clipboard.some(function(c) { return c.geosInfoBlock !== null; });
  if (hasGeos && !hasGeosSignature(currentBuffer)) {
    var choice = await showChoiceModal(
      'GEOS File',
      'Clipboard contains GEOS file(s) but the disk is not in GEOS format. Convert disk to GEOS format?',
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

  var pasted = 0;
  var remaining = clipboard.length;
  for (var pi = 0; pi < clipboard.length; pi++) {
    var item = clipboard[pi];
    var geosData = null;
    if (item.geosBytes || item.geosInfoBlock) {
      geosData = { geosBytes: item.geosBytes, geosInfoBlock: item.geosInfoBlock };
    }
    if (writeFileToDisk(item.typeIdx, item.nameBytes, item.data, geosData)) {
      pasted++;
    } else {
      // writeFileToDisk already showed the error — stop here
      remaining = clipboard.length - pi - 1;
      break;
    }
  }

  if (pasted > 0) {
    var info = parseCurrentDir(currentBuffer);
    renderDisk(info);
    if (pasted === clipboard.length) {
      showModal('Paste Complete', [pasted + ' file(s) pasted successfully.']);
    } else {
      showModal('Paste Incomplete', [pasted + ' of ' + clipboard.length + ' file(s) pasted.', remaining + ' file(s) could not be pasted (disk full or no directory space).']);
    }
  }
  // If pasted === 0, writeFileToDisk already showed the error
});

// ── File menu: Import File ────────────────────────────────────────────
var importFileInput = document.createElement('input');
importFileInput.type = 'file';
importFileInput.accept = '.prg,.seq,.usr,.rel,.p00,.s00,.u00,.r00,.cvt';
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
    // Root: mark all system sectors (BAM + header) as allocated
    for (var bsi = 0; bsi < fmt.bamSectors.length; bsi++) {
      allocated[fmt.bamSectors[bsi][0] + ':' + fmt.bamSectors[bsi][1]] = true;
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
    var skipTracks = {};
    skipTracks[dirTrack] = true;
    if (fmt.bamTrack !== dirTrack) skipTracks[fmt.bamTrack] = true;
    var maxBamTrack = fmt.bamTracksRange(currentTracks);
    for (var t = dirTrack - 1; t >= 1; t--) { if (!skipTracks[t]) trackOrder.push(t); }
    for (var t2 = dirTrack + 1; t2 <= maxBamTrack; t2++) { if (!skipTracks[t2]) trackOrder.push(t2); }
    interleave = (fmt === DISK_FORMATS.d81) ? 1 : fileInterleave;
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
  pushUndo();
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

  // CVT import: GEOS ConVerT format
  if (ext === 'cvt') {
    importCvtFile(fileName, fileData);
    return;
  }

  var typeMap = { prg: 2, seq: 1, usr: 3, rel: 4, p00: 2, s00: 1, u00: 3, r00: 4 };
  var typeIdx = typeMap[ext];
  if (typeIdx === undefined) {
    showModal('Import Error', ['Unsupported file type: .' + ext]);
    return;
  }

  var baseName = dotIdx >= 0 ? fileName.substring(0, dotIdx) : fileName;
  var nameBytes = asciiToNameBytes(baseName);

  // PC64 format (.P00/.S00/etc.): 26-byte header with original filename
  if (ext === 'p00' || ext === 's00' || ext === 'u00' || ext === 'r00') {
    if (fileData.length > 26 && fileData[0] === 0x43 && fileData[1] === 0x36 && fileData[2] === 0x34) {
      // "C64File" magic — extract original name and strip header
      var pc64Name = '';
      for (var pi = 8; pi < 24 && fileData[pi] !== 0x00; pi++) pc64Name += String.fromCharCode(fileData[pi]);
      if (pc64Name) nameBytes = asciiToNameBytes(pc64Name);
      fileData = fileData.subarray(26);
    }
  }

  if (writeFileToDisk(typeIdx, nameBytes, fileData)) {
    var info = parseCurrentDir(currentBuffer);
    renderDisk(info);
    var numSectors = fileData.length === 0 ? 1 : Math.ceil(fileData.length / 254);
    if (fileData.length > 0 && fileData.length % 254 === 0) numSectors++;
    showModal('Import Successful', ['"' + baseName.toUpperCase() + '" imported successfully.', numSectors + ' block(s) written.']);
  }
}

// ── CVT Import ─────────────────────────────────────────────────────
function showConfirmModal(title, message) {
  return new Promise(function(resolve) {
    document.getElementById('modal-title').textContent = title;
    var body = document.getElementById('modal-body');
    body.innerHTML = '<div class="text-base">' + escHtml(message) + '</div>';
    var footer = document.querySelector('#modal-overlay .modal-footer');
    footer.innerHTML = '<button class="modal-btn-secondary" id="confirm-cancel">Cancel</button>' +
      '<button id="confirm-ok">OK</button>';
    document.getElementById('confirm-ok').addEventListener('click', function() {
      document.getElementById('modal-overlay').classList.remove('open');
      resolve(true);
    });
    document.getElementById('confirm-cancel').addEventListener('click', function() {
      document.getElementById('modal-overlay').classList.remove('open');
      resolve(false);
    });
    document.getElementById('modal-overlay').classList.add('open');
  });
}

async function importCvtFile(fileName, cvt) {
  if (cvt.length < 762) {
    showModal('Import Error', ['CVT file too small.']);
    return;
  }

  // Warn if disk will be converted to GEOS format
  if (!hasGeosSignature(currentBuffer)) {
    var ok = await showConfirmModal('Import CVT',
      'This disk does not have a GEOS signature. Importing a CVT file will convert it to a GEOS disk. Continue?');
    if (!ok) return;
  }

  // Block 1 ($000-$0FD): directory entry
  var dirEntry = cvt.subarray(0, 254);

  // Detect variant from signature at offset 30
  var sigBytes = dirEntry.subarray(30, 60);
  var sig = '';
  for (var si = 0; si < 30 && sigBytes[si] !== 0; si++) sig += String.fromCharCode(sigBytes[si]);

  var isV10 = sig.indexOf('V1.0') >= 0;
  var isBroken = !isV10 && sig.indexOf('formatted GEOS file') >= 0;
  if (!isV10 && !isBroken) {
    showModal('Import Error', ['Not a valid CVT file (unknown signature).']);
    return;
  }

  // Extract name (bytes 3-18 of dir entry, $A0 padded)
  var nameBytes = new Uint8Array(16);
  for (var ni = 0; ni < 16; ni++) nameBytes[ni] = dirEntry[3 + ni];

  var typeByte = dirEntry[0]; // CBM file type (e.g. $84 = USR + closed)
  var typeIdx = typeByte & 0x07;
  if (typeIdx < 1) typeIdx = 3; // default to USR

  var geosStructure = dirEntry[0x15]; // CVT offset $15 = dir byte $17 = GEOS structure
  var geosFileType = dirEntry[0x16];  // CVT offset $16 = dir byte $18 = GEOS file type

  // GEOS metadata bytes = dir entry bytes $15-$1D (info T/S, structure, file type, date)
  // CVT block 1 stores dir bytes 2-31 at offsets 0-29, so dir byte $15 = CVT offset $13
  var geosBytes = new Uint8Array(9);
  for (var gi = 0; gi < 9; gi++) geosBytes[gi] = dirEntry[0x13 + gi];

  // Block 2 ($0FE-$1FB): info block (254 bytes, without T/S link)
  var infoBlock = new Uint8Array(256);
  infoBlock[0] = 0x00; infoBlock[1] = 0xFF; // standard info block marker
  for (var ib = 0; ib < 254; ib++) infoBlock[2 + ib] = cvt[254 + ib];

  var isVlir = geosStructure === 1;

  if (!isVlir) {
    // Sequential GEOS file: data starts at offset 508
    var seqData = cvt.subarray(508);
    // Trim trailing zeros from last block
    var geosData = { geosBytes: geosBytes, geosInfoBlock: infoBlock };
    // Set info T/S in geosBytes (will be updated by writeFileToDisk)
    geosBytes[0] = 0; // info track placeholder
    geosBytes[1] = 0; // info sector placeholder

    if (writeFileToDisk(typeIdx | 0x80, nameBytes, seqData, geosData)) {
      var info = parseCurrentDir(currentBuffer);
      renderDisk(info);
      var baseName = petsciiToReadable(readPetsciiString(nameBytes, 0, 16)).trim();
      showModal('CVT Import Successful', ['"' + baseName + '" imported successfully.']);
    }
  } else {
    // VLIR file: block 3 ($1FC-$2F9) = record index, then record data
    var recordIndex = cvt.subarray(508, 762);

    // Parse record sizes and extract record data
    var records = [];
    var dataPos = 762;
    for (var ri = 0; ri < 127; ri++) {
      var b0 = recordIndex[ri * 2];
      var b1 = recordIndex[ri * 2 + 1];
      if (b0 === 0 && b1 === 0) {
        records.push(null); // end marker
        break;
      }
      if (b0 === 0 && b1 === 0xFF) {
        records.push({ data: null }); // empty record
        continue;
      }
      // Populated record
      var grossSize, dataSize;
      if (isV10) {
        grossSize = b0 * 254;
        dataSize = (b0 - 1) * 254 + b1 - 1;
      } else {
        grossSize = b0 * 254 + b1;
        dataSize = grossSize;
      }
      if (dataPos + grossSize > cvt.length) {
        dataSize = Math.min(dataSize, cvt.length - dataPos);
        grossSize = Math.min(grossSize, cvt.length - dataPos);
      }
      records.push({ data: cvt.subarray(dataPos, dataPos + dataSize) });
      dataPos += grossSize;
    }

    // Write VLIR file to disk
    if (writeVlirFileToDisk(typeIdx | 0x80, nameBytes, records, geosBytes, infoBlock)) {
      var info2 = parseCurrentDir(currentBuffer);
      renderDisk(info2);
      var baseName2 = petsciiToReadable(readPetsciiString(nameBytes, 0, 16)).trim();
      showModal('CVT Import Successful', ['"' + baseName2 + '" imported successfully.']);
    }
  }
}

function writeVlirFileToDisk(typeByte, nameBytes, records, geosBytes, infoBlock) {
  pushUndo();
  var snapshot = currentBuffer.slice(0);
  var data = new Uint8Array(currentBuffer);
  var allocated = buildTrueAllocationMap(currentBuffer);

  // Count total sectors needed: 1 info block + 1 VLIR index + data sectors
  var totalSectors = 2; // info + index
  var recordMeta = []; // { startSectorIdx, numBlocks } for each record
  for (var ri = 0; ri < records.length; ri++) {
    var rec = records[ri];
    if (!rec || !rec.data || rec.data.length === 0) {
      recordMeta.push(null);
      continue;
    }
    var numBlocks = Math.max(1, Math.ceil(rec.data.length / 254));
    recordMeta.push({ numBlocks: numBlocks });
    totalSectors += numBlocks;
  }

  var sectorList = allocateSectors(allocated, totalSectors);
  if (sectorList.length < totalSectors) {
    currentBuffer = snapshot;
    showModal('Write Error', ['Not enough free sectors. Need ' + totalSectors + ', have ' + sectorList.length + '.']);
    return false;
  }

  var entryOff = findFreeDirEntry(currentBuffer);
  if (entryOff < 0) {
    currentBuffer = snapshot;
    showModal('Write Error', ['No free directory entry available.']);
    return false;
  }

  var secIdx = 0;

  // Write info block
  var infoSec = sectorList[secIdx++];
  var infoOff = sectorOffset(infoSec.track, infoSec.sector);
  for (var ib2 = 0; ib2 < 256; ib2++) data[infoOff + ib2] = infoBlock[ib2];
  data[infoOff] = 0x00; data[infoOff + 1] = 0xFF;

  // Write VLIR index sector
  var vlirSec = sectorList[secIdx++];
  var vlirOff = sectorOffset(vlirSec.track, vlirSec.sector);
  for (var vi = 0; vi < 256; vi++) data[vlirOff + vi] = 0x00;
  data[vlirOff] = 0x00; data[vlirOff + 1] = 0xFF;

  // Write each record's sector chain and update VLIR index
  for (var ri2 = 0; ri2 < records.length && ri2 < 127; ri2++) {
    var meta = recordMeta[ri2];
    if (!meta) {
      // Empty or null record
      if (records[ri2] === null) {
        // End marker
        data[vlirOff + 2 + ri2 * 2] = 0x00;
        data[vlirOff + 2 + ri2 * 2 + 1] = 0x00;
      } else {
        // Empty record
        data[vlirOff + 2 + ri2 * 2] = 0x00;
        data[vlirOff + 2 + ri2 * 2 + 1] = 0xFF;
      }
      continue;
    }

    var recData = records[ri2].data;
    var recSectors = sectorList.slice(secIdx, secIdx + meta.numBlocks);
    secIdx += meta.numBlocks;

    // Point VLIR index to first sector of this record
    data[vlirOff + 2 + ri2 * 2] = recSectors[0].track;
    data[vlirOff + 2 + ri2 * 2 + 1] = recSectors[0].sector;

    // Write sector chain
    var recPos = 0;
    for (var rsi = 0; rsi < recSectors.length; rsi++) {
      var sec = recSectors[rsi];
      var soff = sectorOffset(sec.track, sec.sector);

      if (rsi < recSectors.length - 1) {
        var nextSec = recSectors[rsi + 1];
        data[soff] = nextSec.track;
        data[soff + 1] = nextSec.sector;
        for (var b = 2; b < 256; b++) {
          data[soff + b] = recPos < recData.length ? recData[recPos++] : 0x00;
        }
      } else {
        data[soff] = 0x00;
        var bytesInLast = recData.length - recPos;
        if (bytesInLast <= 0) bytesInLast = 0;
        data[soff + 1] = bytesInLast + 1;
        for (var b2 = 2; b2 < 256; b2++) {
          data[soff + b2] = recPos < recData.length ? recData[recPos++] : 0x00;
        }
      }
    }
  }
  // Remaining VLIR index entries: 00/00 (end)
  for (var ri3 = records.length; ri3 < 127; ri3++) {
    data[vlirOff + 2 + ri3 * 2] = 0x00;
    data[vlirOff + 2 + ri3 * 2 + 1] = 0x00;
  }

  // Fill directory entry
  data[entryOff + 2] = typeByte;
  data[entryOff + 3] = vlirSec.track; // points to VLIR index, not info block
  data[entryOff + 4] = vlirSec.sector;
  for (var ni2 = 0; ni2 < 16; ni2++) data[entryOff + 5 + ni2] = nameBytes[ni2];

  // GEOS metadata
  for (var gi2 = 0; gi2 < 9; gi2++) data[entryOff + 21 + gi2] = geosBytes[gi2];
  data[entryOff + 0x15] = infoSec.track;
  data[entryOff + 0x16] = infoSec.sector;

  // Block count = all sectors (info + index + data)
  data[entryOff + 30] = totalSectors & 0xFF;
  data[entryOff + 31] = (totalSectors >> 8) & 0xFF;

  // Update BAM
  var ctx = getDirContext();
  var bamOff = ctx.bamOff;
  for (var ai = 0; ai < sectorList.length; ai++) {
    bamMarkSectorUsed(data, sectorList[ai].track, sectorList[ai].sector, bamOff);
  }

  // Ensure GEOS disk signature is present
  if (!hasGeosSignature(currentBuffer)) {
    writeGeosSignature(currentBuffer);
  }

  selectedEntryIndex = entryOff;
  return true;
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
  pushUndo();
  const data = new Uint8Array(currentBuffer);
  var entries = selectedEntries.length > 0 ? selectedEntries : [selectedEntryIndex];
  for (var i = 0; i < entries.length; i++) data[entries[i] + 2] ^= 0x40;
  const info = parseCurrentDir(currentBuffer);
  renderDisk(info);
});

document.getElementById('opt-splat').addEventListener('click', (e) => {
  e.stopPropagation();
  if (!currentBuffer || selectedEntryIndex < 0) return;
  closeMenus();
  pushUndo();
  const data = new Uint8Array(currentBuffer);
  var entries = selectedEntries.length > 0 ? selectedEntries : [selectedEntryIndex];
  for (var i = 0; i < entries.length; i++) data[entries[i] + 2] ^= 0x80;
  const info = parseCurrentDir(currentBuffer);
  renderDisk(info);
});

document.querySelectorAll('#opt-change-type .submenu .option').forEach(el => {
  el.addEventListener('click', (e) => {
    e.stopPropagation();
    if (!currentBuffer || selectedEntryIndex < 0) return;
    closeMenus();
    var typeIdx = parseInt(el.dataset.typeidx, 10);
    var entries = selectedEntries.length > 0 ? selectedEntries : [selectedEntryIndex];
    for (var i = 0; i < entries.length; i++) changeFileType(entries[i], typeIdx);
  });
});

// ── Name Case Operations ──────────────────────────────────────────────
function changeNameCase(entryOff, mode) {
  var data = new Uint8Array(currentBuffer);
  for (var i = 0; i < 16; i++) {
    var b = data[entryOff + 5 + i];
    if (b === 0xA0) break; // end of name
    if (mode === 'upper') {
      // PETSCII lowercase ($41-$5A) → uppercase ($C1-$DA)
      if (b >= 0x41 && b <= 0x5A) data[entryOff + 5 + i] = b + 0x80;
    } else if (mode === 'lower') {
      // PETSCII uppercase ($C1-$DA) → lowercase ($41-$5A)
      if (b >= 0xC1 && b <= 0xDA) data[entryOff + 5 + i] = b - 0x80;
    } else {
      // Toggle
      if (b >= 0x41 && b <= 0x5A) data[entryOff + 5 + i] = b + 0x80;
      else if (b >= 0xC1 && b <= 0xDA) data[entryOff + 5 + i] = b - 0x80;
    }
  }
}

['upper', 'lower', 'toggle'].forEach(function(mode) {
  document.getElementById('opt-case-' + mode).addEventListener('click', function(e) {
    e.stopPropagation();
    if (!currentBuffer || selectedEntryIndex < 0) return;
    closeMenus();
    pushUndo();
    var entries = selectedEntries.length > 0 ? selectedEntries : [selectedEntryIndex];
    for (var i = 0; i < entries.length; i++) changeNameCase(entries[i], mode);
    var info = parseCurrentDir(currentBuffer);
    renderDisk(info);
  });
});

// ── Compact Directory ────────────────────────────────────────────────
document.getElementById('opt-compact-dir').addEventListener('click', function(e) {
  e.stopPropagation();
  if (!currentBuffer) return;
  closeMenus();
  pushUndo();
  var data = new Uint8Array(currentBuffer);
  var fmt = currentFormat;
  var ctx = getDirContext();
  var t = ctx.dirTrack, s = ctx.dirSector;
  var visited = {};
  var allEntries = []; // collect all non-deleted entries

  // Read all directory entries
  while (t !== 0) {
    var key = t + ':' + s;
    if (visited[key]) break;
    visited[key] = true;
    var off = sectorOffset(t, s);
    if (off < 0) break;
    for (var i = 0; i < fmt.entriesPerSector; i++) {
      var eo = off + i * fmt.entrySize;
      var typeByte = data[eo + 2];
      if ((typeByte & 0x07) > 0) {
        // Non-deleted entry - save the 30 bytes (offset 2-31)
        var entry = new Uint8Array(30);
        for (var j = 0; j < 30; j++) entry[j] = data[eo + 2 + j];
        allEntries.push(entry);
      }
    }
    t = data[off]; s = data[off + 1];
  }

  // Rewrite directory with compacted entries
  t = ctx.dirTrack; s = ctx.dirSector;
  visited = {};
  var entryIdx = 0;
  while (t !== 0) {
    var key2 = t + ':' + s;
    if (visited[key2]) break;
    visited[key2] = true;
    var off2 = sectorOffset(t, s);
    if (off2 < 0) break;
    for (var i2 = 0; i2 < fmt.entriesPerSector; i2++) {
      var eo2 = off2 + i2 * fmt.entrySize;
      if (entryIdx < allEntries.length) {
        for (var j2 = 0; j2 < 30; j2++) data[eo2 + 2 + j2] = allEntries[entryIdx][j2];
        entryIdx++;
      } else {
        // Clear remaining entries
        for (var j3 = 2; j3 < 32; j3++) data[eo2 + j3] = 0x00;
      }
    }
    t = data[off2]; s = data[off2 + 1];
  }

  var removed = Object.keys(visited).length * fmt.entriesPerSector - allEntries.length;
  var info = parseCurrentDir(currentBuffer);
  renderDisk(info);
  selectedEntryIndex = -1;
  updateEntryMenuState();
  showModal('Compact Directory', [allEntries.length + ' file(s) kept, ' + removed + ' empty slot(s) removed.']);
});

// ── CSV Export ───────────────────────────────────────────────────────
document.getElementById('opt-export-csv').addEventListener('click', function(e) {
  e.stopPropagation();
  if (!currentBuffer) return;
  closeMenus();
  var info = parseCurrentDir(currentBuffer);
  var lines = ['Filename,Type,Blocks,Locked,Track,Sector'];
  for (var i = 0; i < info.entries.length; i++) {
    var en = info.entries[i];
    if (!en.name && !en.type) continue;
    var name = petsciiToReadable(en.name || '').replace(/"/g, '""').trim();
    var type = (en.type || '').trim();
    var blocks = en.blocks || 0;
    var locked = en.locked ? 'Y' : 'N';
    var ft = en.track || 0;
    var fs = en.sector || 0;
    lines.push('"' + name + '",' + type + ',' + blocks + ',' + locked + ',' + ft + ',' + fs);
  }
  var csv = lines.join('\n');
  var diskName = petsciiToReadable(info.diskName || '').trim().replace(/[<>:"/\\|?*]/g, '_') || 'disk';
  var blob = new Blob([csv], { type: 'text/csv' });
  var a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = diskName + '.csv';
  a.click();
  URL.revokeObjectURL(a.href);
});

// ── Directory Export as PNG ──────────────────────────────────────────
document.getElementById('opt-export-png-dir').addEventListener('click', function(e) {
  e.stopPropagation();
  if (!currentBuffer) return;
  closeMenus();
  var info = parseCurrentDir(currentBuffer);

  // Render directory to a canvas using C64 colors
  var charW = 8, charH = 8, scale = 2;
  var cols = 40, rows = info.entries.length + 3; // header + entries + blocks free
  var canvasW = cols * charW * scale;
  var canvasH = rows * charH * scale;

  var canvas = document.createElement('canvas');
  canvas.width = canvasW;
  canvas.height = canvasH;
  var ctx = canvas.getContext('2d');

  // Background
  ctx.fillStyle = C64_COLORS[6]; // blue
  ctx.fillRect(0, 0, canvasW, canvasH);

  ctx.font = (charH * scale) + 'px "C64 Pro Mono", monospace';
  ctx.textBaseline = 'top';

  var y = 0;
  function drawLine(text, color) {
    ctx.fillStyle = color || C64_COLORS[14]; // light blue
    ctx.fillText(text, 0, y);
    y += charH * scale;
  }

  // Header
  var diskName = petsciiToReadable(info.diskName || '').padEnd(currentFormat.nameLength);
  var diskId = petsciiToReadable(info.diskId || '');
  drawLine('0 "' + diskName + '" ' + diskId, C64_COLORS[14]);
  drawLine('', C64_COLORS[14]); // blank line

  // Entries
  for (var i = 0; i < info.entries.length; i++) {
    var en = info.entries[i];
    if (!en.name && !en.type) continue;
    var blocks = String(en.blocks || 0);
    var name = '"' + petsciiToReadable(en.name || '').padEnd(16) + '"';
    var type = (en.type || 'PRG').trim();
    var line = blocks.padStart(4) + ' ' + name + ' ' + type;
    drawLine(line, C64_COLORS[14]);
  }

  // Blocks free
  drawLine((info.freeBlocks || 0) + ' BLOCKS FREE.', C64_COLORS[14]);

  var diskFileName = petsciiToReadable(info.diskName || '').trim().replace(/[<>:"/\\|?*]/g, '_') || 'directory';
  var a = document.createElement('a');
  a.href = canvas.toDataURL('image/png');
  a.download = diskFileName + '_dir.png';
  a.click();
});

// ── geoWrite to Plain Text ──────────────────────────────────────────
document.getElementById('opt-export-rtf').parentElement.insertAdjacentHTML('beforeend', '');

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

// ── Drag & Drop from OS ──────────────────────────────────────────────
var dragCounter = 0;
document.addEventListener('dragenter', function(e) {
  if (e.dataTransfer.types.indexOf('Files') >= 0) {
    dragCounter++;
    document.body.classList.add('drop-active');
  }
});
document.addEventListener('dragleave', function(e) {
  dragCounter--;
  if (dragCounter <= 0) { dragCounter = 0; document.body.classList.remove('drop-active'); }
});
document.addEventListener('dragover', function(e) {
  e.preventDefault();
  e.dataTransfer.dropEffect = 'copy';
});

document.addEventListener('drop', function(e) {
  e.preventDefault();
  dragCounter = 0;
  document.body.classList.remove('drop-active');
  var files = Array.from(e.dataTransfer.files);
  if (files.length === 0) return;

  var diskExts = ['.d64', '.d71', '.d81', '.d80', '.d82', '.t64', '.tap'];
  var fileExts = ['.prg', '.seq', '.usr', '.rel', '.p00', '.s00', '.u00', '.r00', '.cvt'];
  var diskFiles = [];
  var importFiles = [];

  for (var i = 0; i < files.length; i++) {
    var name = files[i].name.toLowerCase();
    var ext = name.substring(name.lastIndexOf('.'));
    if (diskExts.indexOf(ext) >= 0) diskFiles.push(files[i]);
    else if (fileExts.indexOf(ext) >= 0) importFiles.push(files[i]);
  }

  // Open disk images in new tabs
  if (diskFiles.length > 0) {
    function openDiskFile(file) {
      return new Promise(function(resolve, reject) {
        var reader = new FileReader();
        reader.onload = function() { resolve({ name: file.name, buffer: reader.result }); };
        reader.onerror = function() { reject(file.name); };
        reader.readAsArrayBuffer(file);
      });
    }
    Promise.all(diskFiles.map(openDiskFile)).then(function(results) {
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
    });
  }

  // Import PRG/SEQ/USR/REL/CVT files into current disk
  if (importFiles.length > 0 && currentBuffer) {
    var imported = 0, failed = 0;
    function importNext(idx) {
      if (idx >= importFiles.length) {
        if (imported > 0) {
          var info = parseCurrentDir(currentBuffer);
          renderDisk(info);
          showModal('Import Complete', [imported + ' file(s) imported.' + (failed > 0 ? ' ' + failed + ' failed.' : '')]);
        }
        return;
      }
      var file = importFiles[idx];
      var reader = new FileReader();
      reader.onload = async function() {
        var ext = file.name.substring(file.name.lastIndexOf('.')).toLowerCase();
        if (ext === '.cvt') {
          // CVT import is async (confirmation dialog) and shows its own result
          await importCvtFile(file.name, new Uint8Array(reader.result));
          importNext(idx + 1);
          return;
        }
        importFileToDisk(file.name, new Uint8Array(reader.result));
        imported++;
        importNext(idx + 1);
      };
      reader.onerror = function() { failed++; importNext(idx + 1); };
      reader.readAsArrayBuffer(file);
    }
    importNext(0);
  } else if (importFiles.length > 0 && !currentBuffer) {
    showModal('Drop Error', ['No disk open to import files into. Open or create a disk first.']);
  }
});

// Make dir entries draggable to OS (export on drag)
document.addEventListener('dragstart', function(e) {
  var entry = e.target.closest('.dir-entry:not(.dir-header-row):not(.dir-parent-row)');
  if (!entry || !currentBuffer || !entry.dataset.offset) return;

  var entryOff = parseInt(entry.dataset.offset, 10);
  var data = new Uint8Array(currentBuffer);
  var typeByte = data[entryOff + 2];
  var typeIdx = typeByte & 0x07;
  if (typeIdx < 1 || typeIdx > 4 || !(typeByte & 0x80)) return;

  var result = readFileData(currentBuffer, entryOff);
  if (result.error || result.data.length === 0) return;

  var extMap = { 1: '.seq', 2: '.prg', 3: '.usr', 4: '.rel' };
  var ext = extMap[typeIdx] || '.prg';
  var name = petsciiToReadable(readPetsciiString(data, entryOff + 5, 16)).trim().replace(/[<>:"/\\|?*\x00-\x1F]/g, '_');
  if (!name) name = 'export';

  var blob = new Blob([result.data], { type: 'application/octet-stream' });
  var url = URL.createObjectURL(blob);

  // Set download data for drag to OS
  try {
    e.dataTransfer.setData('DownloadURL', 'application/octet-stream:' + name + ext + ':' + url);
  } catch (err) {
    // DownloadURL not supported in all browsers
  }
  e.dataTransfer.effectAllowed = 'copyMove';
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
    '<div class="text-base line-tall">' +
      '<b>Supported formats:</b> D64 (1541), D71 (1571), D81 (1581), D80 (8050), D82 (8250), T64 (tape), TAP (raw tape), CVT (GEOS)<br>' +
      '<b>Features:</b><br>' +
      '&bull; Directory editing: rename, insert, remove, sort, align, lock, scratch<br>' +
      '&bull; Hex sector editor with track/sector navigation and search highlighting<br>' +
      '&bull; BAM viewer with integrity checking and file ownership display<br>' +
      '&bull; Search: Find/Find in Tabs with text and hex byte pattern matching<br>' +
      '&bull; Go to Sector (Ctrl+G): jump to any track/sector<br>' +
      '&bull; File import/export/copy/paste across disk images<br>' +
      '&bull; View As: Hex, Disassembly, PETSCII (C64 screen), BASIC (V2/V7), Graphics, geoWrite<br>' +
      '&bull; Graphics: 17+ formats (Koala, Art Studio, FLI, sprites, charset, Print Shop) with PNG export<br>' +
      '&bull; GEOS: geoPaint, Photo Scrap, Photo Album, geoWrite, Font viewers<br>' +
      '&bull; geoWrite document viewer with styled text and inline images<br>' +
      '&bull; Export: CVT, RTF, PDF for GEOS/geoWrite files<br>' +
      '&bull; Packer detection: 370+ signatures<br>' +
      '&bull; D81 subdirectories (partitions)<br>' +
      '&bull; Disk optimizer with configurable interleave<br>' +
      '&bull; Lost file recovery (orphaned sector chain scanning)<br>' +
      '&bull; Fill free sectors, validate disk, recalculate BAM<br>' +
      '&bull; Multi-tab interface for working with multiple disks<br>' +
      '&bull; Drag &amp; drop: disk images, PRG/SEQ/USR/REL/CVT files, export by dragging<br>' +
      '&bull; 40+ keyboard shortcuts for all major operations<br>' +
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
    '<div class="text-base line-tall">' +
      '<b>Packer detection:</b><br>' +
      '&bull; <a href="https://restore64.dev/" target="_blank" class="link">Restore64</a> — 370+ packer signatures<br>' +
      '&bull; <a href="https://csdb.dk/release/?id=235681" target="_blank" class="link">UNP64</a> by iAN CooG — signature architecture (GPL)<br>' +
      '<br>' +
      '<b>C64 color palette:</b><br>' +
      '&bull; <a href="https://www.pepto.de/projects/colorvic/2001/" target="_blank" class="link">Pepto\'s VIC-II palette</a> — accurate VIC-II color reproduction<br>' +
      '<br>' +
      '<b>Fonts:</b><br>' +
      '&bull; <a href="https://style64.org/c64-truetype" target="_blank" class="link">C64 Pro Mono</a> by Style64 — TrueType PETSCII font<br>' +
      '<br>' +
      '<b>GEOS format references:</b><br>' +
      '&bull; <a href="https://www.pagetable.com/?p=1471" target="_blank" class="link">Inside geoWrite</a> by Michael Steil — geoWrite file format documentation<br>' +
      '&bull; <a href="https://github.com/mist64/geowrite2rtf" target="_blank" class="link">geowrite2rtf</a> by Michael Steil — CVT/geoWrite parsing reference<br>' +
      '&bull; <a href="https://thornton2.com/programming/geos/compaction-strategy.html" target="_blank" class="link">Thornton2</a> — GEOS bitmap compaction strategy<br>' +
      '<br>' +
      '<b>Technical references:</b><br>' +
      '&bull; <a href="https://vice-emu.sourceforge.io/vice_17.html" target="_blank" class="link">VICE Manual</a> — disk image format documentation<br>' +
      '&bull; <a href="https://www.oxyron.de/html/opcodes02.html" target="_blank" class="link">Oxyron 6502 Opcode Table</a> — illegal opcode reference<br>' +
      '&bull; <a href="https://c64-wiki.com/" target="_blank" class="link">C64-Wiki</a> — Commodore 64 technical reference<br>' +
      '&bull; <a href="https://sta.c64.org/" target="_blank" class="link">STA\'s C64 pages</a> — disk format details<br>' +
      '&bull; <a href="https://csdb.dk/" target="_blank" class="link">CSDb</a> — C64 Scene Database<br>' +
      '&bull; <a href="https://www.zimmers.net/anonftp/pub/cbm/" target="_blank" class="link">Zimmers.net</a> — CBM file archive and GEOS format documentation<br>' +
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
    { title: 'File Operations', shortcuts: [
      ['Ctrl + C', 'Copy selected file(s)'],
      ['Ctrl + V', 'Paste file (works across tabs)'],
      ['Ctrl + I', 'Insert file'],
      ['Ctrl + E', 'Export selected file(s)'],
      ['Ctrl + D', 'Add directory (D81)'],
      ['Ctrl + Z', 'Undo last change'],
      ['Ctrl + Alt + O', 'Open disk'],
      ['Ctrl + Alt + S', 'Save disk'],
      ['Ctrl + Shift + S', 'Save as'],
      ['Ctrl + Alt + N', 'New disk'],
      ['Ctrl + W', 'Close current tab'],
      ['Ctrl + Shift + W', 'Close all tabs'],
      ['Ctrl + B', 'View BAM'],
      ['Ctrl + Alt + V', 'Validate disk'],
      ['Ctrl + H', 'Edit disk name'],
      ['Ctrl + Alt + I', 'Edit disk ID'],
    ]},
    { title: 'Viewers', shortcuts: [
      ['Ctrl + Alt + H', 'View as hex'],
      ['Ctrl + Alt + B', 'View as BASIC'],
      ['Ctrl + Alt + P', 'View as PETSCII'],
      ['Ctrl + Alt + D', 'View as disassembly'],
      ['Ctrl + Alt + G', 'View as graphics'],
    ]},
    { title: 'Search', shortcuts: [
      ['Ctrl + F', 'Find in current disk'],
      ['Ctrl + Shift + F', 'Find in all tabs'],
      ['Ctrl + G', 'Go to sector'],
    ]},
    { title: 'Formatting', shortcuts: [
      ['Ctrl + Alt + L', 'Align left'],
      ['Ctrl + Alt + R', 'Align right'],
      ['Ctrl + Alt + C', 'Center'],
      ['Ctrl + Alt + J', 'Justify'],
      ['Ctrl + <', 'Lock / unlock file'],
      ['Ctrl + *', 'Scratch / unscratch file'],
    ]},
    { title: 'Editing (double-click)', shortcuts: [
      ['Filename', 'Rename file (PETSCII keyboard available)'],
      ['Type column', 'Change file type'],
      ['Blocks column', 'Edit block count'],
      ['T/S column', 'Edit track/sector'],
      ['Disk name / ID', 'Edit disk header'],
      ['Blocks free', 'Edit free block count'],
    ]},
    { title: 'Drag & Drop', shortcuts: [
      ['Drop .d64/.d71/.d81', 'Open disk image(s) in new tab(s)'],
      ['Drop .prg/.seq/.usr/.rel', 'Import file(s) into current disk'],
      ['Drag file entry to OS', 'Export file (Chrome/Edge)'],
    ]},
    { title: 'General', shortcuts: [
      ['Ctrl + Shift', 'Toggle uppercase/lowercase charset'],
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
      html += '<tr><td style="padding:3px 12px 3px 8px;white-space:nowrap;font-size:12px"><code class="code-tag" style="font-size:11px">' +
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

document.getElementById('opt-changelog').addEventListener('click', function(e) {
  e.stopPropagation();
  closeMenus();
  document.getElementById('modal-title').textContent = 'Changelog';
  var body = document.getElementById('modal-body');
  var changes = [
    { ver: '1.3.16', title: 'Name case, compact dir, follow chain, CSV/PNG/text export', items: [
      'Name Case: Ctrl+L lowercase, Ctrl+U uppercase, Ctrl+T toggle (Entry menu)',
      'Compact Directory: remove deleted entries from directory (Disk menu)',
      'Follow Chain: J key or button in sector editor to jump to next linked sector',
      'Export as CSV: directory listing with filename, type, blocks, lock, T/S',
      'Export Directory as PNG: C64-style directory screenshot',
      'Export as Text (geoWrite): plain text extraction from geoWrite documents',
    ]},
    { ver: '1.3.15', title: 'Search UX, keyboard shortcuts, refactoring', items: [
      'Search: PETSCII keyboard attached to search input for special character entry',
      'Search: radio buttons for scope selection, spinner during search',
      'Search: hex byte display and PETSCII chars in results, scrollable results',
      'Go to Sector: proper hex input fields for track and sector with validation',
      'Keyboard shortcuts: Ctrl+W close tab, Ctrl+Shift+W close all, Ctrl+Shift+S save as',
      'Keyboard shortcuts: Ctrl+Alt+H/B/P/D for hex/BASIC/PETSCII/disassembly viewers',
      'Keyboard shortcuts: Ctrl+Alt+V validate disk',
      'Keyboard shortcuts dialog: new Viewers and Search sections',
      'Sector editor: search match highlighting on hex bytes only (removed from PETSCII column)',
      'Refactor: removed dead matchBytes() function, unused pdfImages variable',
      'Refactor: optimized PDF image hex encoding with Array.join()',
      'Fix: PETSCII picker maxLength check for inputs without explicit maxLength',
    ]},
    { ver: '1.3.14', title: 'Search improvements, Go to Sector, PDF font metrics', items: [
      'Search: hex byte pattern search ($A0 FF, A0FF) in addition to text',
      'Search: match count per sector shown in results',
      'Search > Go to Sector (Ctrl+G): jump directly to any T:S in the sector editor',
      'PDF export: proper per-character width tables for Helvetica, Times, Courier',
    ]},
    { ver: '1.3.13', title: 'Search, sector editor highlights', items: [
      'Search > Find (Ctrl+F): search current disk by text with scope filter (All/Filename/Header/ID)',
      'Search > Find in All Tabs (Ctrl+Shift+F): search across all open tabs',
      'Search results: click to open sector editor with all matches highlighted',
      'Sector editor: highlight support for search matches (hex and ASCII columns)',
    ]},
    { ver: '1.3.12', title: 'geoWrite viewer, CVT import/export, graphics PNG save', items: [
      'View As > geoWrite: styled document viewer with fonts, alignment, inline images',
      'View As > Graphics: geoWrite embedded image viewer for VLIR records 64-126',
      'Export as RTF: geoWrite documents with full formatting and embedded PNG images',
      'Export as PDF: geoWrite documents with standard fonts, alignment, images',
      'Export as CVT: GEOS ConVerT format for any GEOS VLIR/SEQ file',
      'Import CVT: restore GEOS files from ConVerT format including VLIR structure',
      'Import CVT: GEOS disk signature conversion warning for non-GEOS disks',
      'Close All: close all open tabs from Disk menu',
      'Save as PNG: export graphics from the graphics viewer',
      'Context menu: fixed submenu hover closing on disabled items',
      'Top menu and context menu now properly close each other',
    ]},
    { ver: '1.3.10', title: 'Disk optimizer, BAM view, charset/sprite viewer improvements', items: [
      'Optimize Disk: rewrite file sector chains with chosen interleave for faster loading',
      'Optimize Disk: preset interleaves per drive type (1541/1571/1581/8050), custom option',
      'Optimize Disk: defragment option packs files onto consecutive tracks',
      'Optimize Disk: updates global interleave setting after optimization',
      'BAM view: error sectors show used color with red outline and owning filename',
      'BAM view: orphan detection \u2014 sectors marked used but not owned by any file',
      'Charset viewer: correct C64 bank-stride tile layout (1\u00D72, 2\u00D71, 2\u00D72)',
      'Charset/sprite viewer: multicolor now draws double-wide pixels like real hardware',
      'Graphics viewer: MC toggle button replaces duplicate format buttons',
      'Graphics viewer: color picker dropdowns replace swatch rows for stable modal width',
      'Disassembly viewer: auto-scrolls to SYS entry point, highlighted with accent border',
      'Directory header row (Size/Filename/Type) stays visible when scrolling',
    ]},
    { ver: '1.3.9', title: 'Tab indicators for tape and unsaved changes', items: [
      'Tape tabs (T64/TAP): left border accent to distinguish from disk tabs',
      'Dirty tabs: bullet prefix and italic name when disk has unsaved changes',
      'Dirty state cleared on Save/Save As, tracked across tab switches',
    ]},
    { ver: '1.3.8', title: 'Tape read-only enforcement', items: [
      'T64/TAP: all editing disabled (rename, insert, remove, sort, align, lock, etc.)',
      'T64/TAP: paste and import disabled (read-only target)',
      'T64/TAP: double-click editing blocked for filenames, types, blocks, T/S',
      'T64/TAP: header/ID/blocks-free editing blocked',
      'T64/TAP: Ctrl+Arrow move, Delete key disabled',
      'T64/TAP: disk operations disabled (save, validate, BAM, fill, scan)',
      'T64/TAP: copy, export, and all viewers remain functional',
    ]},
    { ver: '1.3.7', title: 'Tape file copy/export, T64 file reading', items: [
      'T64/TAP: readFileData now works — enables export, copy, and all viewers',
      'T64/TAP: copy files to clipboard, paste into disk images across tabs',
      'T64/TAP: export files as .prg/.seq with correct filenames',
    ]},
    { ver: '1.3.6', title: 'TAP support, refactoring', items: [
      'TAP tape image support (read-only): decodes standard CBM tape encoding',
      'TAP: detects file headers and data blocks from raw pulse data',
      'Refactor: hex8()/hex16() helpers replace verbose hex formatting',
      'Refactor: cached DOM elements for menubar, menu items, alignment',
      'Refactor: consolidated dasm CSS font declarations',
      'Refactor: alignment shortcuts use data-driven lookup',
      'Refactor: decodeGeosString() shared helper for GEOS text fields',
    ]},
    { ver: '1.3.5', title: 'GEOS class names, file info, menu key fix', items: [
      'GEOS info: fixed class name display (was showing dots for ASCII chars)',
      'GEOS info: corrected description offset to $A1',
      'File info: load address shown as range (Load: $0801 - $08FF)',
      'Ctrl+Alt+N: new disk shortcut',
      'Arrow keys no longer change file selection while menu is open',
    ]},
    { ver: '1.3.4', title: 'Shortcuts, illegal opcodes, menu navigation fixes', items: [
      'Disassembly: full 256-opcode table with illegal opcodes (oxyron.de naming)',
      'Disassembly: illegal stable (amber) and unstable (red) opcodes color-coded',
      'Keyboard shortcuts: Ctrl+I/E/D/B/H, Ctrl+Alt+L/R/C/J/I, Ctrl+</*/Shift',
      'Menu keyboard navigation fixes: proper dropdown switching, submenu flip',
      'Submenus flip left/up when overflowing viewport edge',
      'Move entry: multi-select support, respects last-file boundary',
      'Edit fields: Enter/Escape no longer triggers rename on selected file',
      'Drag & drop: added T64, D80, D82, P00/S00/U00/R00 support',
    ]},
    { ver: '1.3.3', title: 'PETSCII keyboard input, sticky picker fix', items: [
      'PETSCII input: shift+letter produces shifted chars ($C1-$DA), correct per charset mode',
      'Sticky picker: fixed positioning, stays below input field, scrolls into view',
      'Sticky picker: clamps horizontally to prevent overflow off-screen',
    ]},
    { ver: '1.3.2', title: 'Empty state, dark theme, keyboard menu navigation', items: [
      'Empty state: drop zone with links to create new disk or open a disk image',
      'Dark theme: lighter backgrounds, softer text, lavender accent instead of green',
      'Full keyboard menu navigation: arrow keys, Enter, Escape, submenu support',
      'Keyboard/mouse mode switching: hover disabled during keynav, restored on mouse move',
    ]},
    { ver: '1.3.1', title: 'BASIC viewer fix, disassembly layout', items: [
      'BASIC viewer: match C64 ROM LIST end-of-program check (high byte of link pointer)',
      'Disassembly viewer: fix overlapping address/bytes columns with proper CSS classes',
      'TASS viewer: disabled until parser is validated against real source files',
    ]},
    { ver: '1.3.0', title: 'Disassembly viewer, TASS viewer', items: [
      'View As > Disassembly: separate 6502 disassembly viewer with load address',
      'View As > Turbo Assembler: TASS source file viewer with mnemonic decoding',
      'TASS detection: identifies source files by .TEXT/.BYTE signatures and $C0 padding',
      'Hex viewer simplified (disassembly moved to own viewer)',
    ]},
    { ver: '1.2.0', title: 'Hashing, comparison, interleave, extended BAM', items: [
      'Disk hashing: CRC32 and SHA-256 (Show MD5 Hash menu)',
      'Disk comparison: sector-by-sector diff with another image',
      'Configurable interleave: directory (default 3) and file (default 10)',
      'SpeedDOS/DolphinDOS extended BAM detection for 40-track D64',
      'Extended BAM type shown in health indicator tooltip',
    ]},
    { ver: '1.1.1', title: 'Multi-select, P00, export text, fixes', items: [
      'Multi-select: Ctrl+click to toggle, Shift+click for range',
      'PC64 (.P00/.S00/.U00/.R00) import with original filename extraction',
      'Export as Text: directory listing as .txt file',
      'Report 0 Blocks Free: set all track free counts to 0',
      'Undo in Edit menu (not just Ctrl+Z)',
      'Health indicator: green=OK, yellow=error bytes, red=BAM issues',
    ]},
    { ver: '1.1.0', title: 'New formats, undo, disassembler', items: [
      'D80 (8050) and D82 (8250) disk format support',
      'D64 42-track support',
      'T64 tape image support (read-only)',
      'Undo system (Ctrl+Z) with 20-level snapshot history',
      '6502 disassembler in hex viewer (toggle Hex/Disassembly)',
      'Filesystem health indicator in footer (green/red dot)',
    ]},
    { ver: '1.0.1', items: [
      'Drag & drop: disk images and PRG/SEQ/USR/REL from OS, drag entries to export',
      'File info icon: load/end address, SYS line, 370+ packer detection (Restore64/UNP64)',
      'View As Graphics: 17+ C64 formats, sprites, charsets (MC/hires), Print Shop, color pickers',
      'View As BASIC: V2 (C64) and V7 (C128) detokenizer with syntax coloring',
      'View As PETSCII: C64 screen simulation (CHROUT $FFD2) with Pepto palette',
      'View As Hex: full file hex viewer with PETSCII display',
      'Multi-tab interface: multiple disks, copy/paste files across tabs',
      'D81 subdirectories: create, navigate, full editing inside partitions',
      'GEOS copy/paste with info block, auto-convert prompt for non-GEOS disks',
      'Scan for lost files: orphaned sector chain recovery with export/restore',
      'Fill free sectors with custom hex byte pattern',
      'Context menu on directory entries and empty area',
      'C64 scene visual identity with Pepto VIC-II color palette',
      'Help menu: About, Credits & Thanks, Keyboard Shortcuts, Changelog',
    ]},
    { ver: '1.0.0', title: 'Bug fixes & accuracy', items: [
      'Fix readFileData off-by-one (last sector byte count convention)',
      'Fix D71 side 2 BAM layout (free counts at T18/S0 $DD, bitmaps at T53/S0)',
      'Fix D81 32-bit bitmap operations for sectors 32-39',
      'Fix D71 80-track initBAM overflow into directory sector',
      'Fix D81 max directory sectors (37, not 39)',
      'Validate: CBM partition handling, byte-level BAM rebuild for all formats',
      'Refactor: extract BAM helpers, remove dead code, consolidate styles',
    ]},
    { ver: '0.9', title: 'Core editing features', items: [
      'Export/import PRG, SEQ, USR, REL files with sector chain verification',
      'Real drive sector allocation: interleave 10 (1541/1571), interleave 1 (1581)',
      'GEOS support: info viewer, GEOS signature detection',
      'Charset mode toggle (uppercase/lowercase)',
      'PETSCII keyboard: ALL mode, sticky picker, shift/graphics/CBM modifiers',
      'Align filenames: left, right, center, justify, expand',
      'File viewer with text/hex/records tabs',
    ]},
    { ver: '0.8', title: 'Hex editor & BAM', items: [
      'Hex sector editor with track/sector navigation',
      'BAM viewer with integrity checking and color-coded sector map',
      'Error byte viewer for disks with error info',
      'Edit menu: separator editor with custom PETSCII patterns',
      'Recalculate blocks free from actual BAM',
    ]},
    { ver: '0.7', title: 'Multi-format support', items: [
      'D71 (1571) double-sided disk support',
      'D81 (1581) 3.5" disk support',
      'Format auto-detection by file size',
      'C64 Pro Mono TrueType font for authentic PETSCII display',
      'PETSCII character mapping rewrite with PUA glyphs',
    ]},
    { ver: '0.5', title: 'Foundation', items: [
      'D64 (1541) disk image loading and display',
      '35 and 40 track support',
      'Directory listing with file type, blocks, name',
      'Inline editing: rename files, edit disk name/ID',
      'Insert/remove directory entries, sort directory',
      'Create new empty disk images',
      'Save/Save As disk images',
      'Safe/unsafe PETSCII character support',
      'Dark and light themes',
      'Drag & drop reordering of directory entries',
    ]},
  ];
  var html = '';
  for (var ci = 0; ci < changes.length; ci++) {
    html += '<div style="font-weight:bold;font-size:13px;margin-bottom:4px;color:var(--selected-text);font-family:\'C64 Pro Mono\',monospace">v' + escHtml(changes[ci].ver) +
      (changes[ci].title ? ' <span style="font-size:11px;color:var(--text-muted);font-family:inherit">\u2014 ' + escHtml(changes[ci].title) + '</span>' : '') + '</div>';
    html += '<ul style="margin:0 0 16px 20px;font-size:12px;line-height:1.7">';
    for (var ii = 0; ii < changes[ci].items.length; ii++) {
      html += '<li>' + escHtml(changes[ci].items[ii]) + '</li>';
    }
    html += '</ul>';
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
