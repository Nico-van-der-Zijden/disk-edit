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
  if (el && !el.isContentEditable && !el.closest('.editing')) e.preventDefault();
});
if (navigator.userAgent.includes('Edg')) {
  document.addEventListener('pointerup', e => {
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
        </div>`;

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
        </div>`;
  }

  html += `
      </div>
      <div class="dir-footer">
        <span class="dir-footer-blocks">${info.freeBlocks}</span>
        <span class="dir-footer-label">blocks free.</span>
        <span class="dir-footer-tracks"><span id="footer-ts"></span>${currentFormat.name} ${currentTracks} tracks</span>
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

    // Double-click to edit
    el.addEventListener('dblclick', (e) => {
      if (e.target.classList.contains('dir-type')) {
        const entryOff = parseInt(el.dataset.offset, 10);
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
      const info = parseD64(currentBuffer);
      renderDisk(info);
    });
  });

}

// Click outside dir entries deselects (registered once)
document.addEventListener('click', (e) => {
  if (!e.target.closest('.dir-entry') && !e.target.closest('.menu-item') && !e.target.closest('.petscii-picker') && !e.target.closest('.type-dropdown')) {
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
    const info = parseD64(currentBuffer);
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
  document.getElementById('opt-rename').classList.toggle('disabled', !hasSelection);
  document.getElementById('opt-insert').classList.toggle('disabled', !currentBuffer || !canInsertFile());
  document.getElementById('opt-remove').classList.toggle('disabled', !hasSelection);
  document.getElementById('opt-align').classList.toggle('disabled', !hasSelection);
  document.getElementById('opt-block-size').classList.toggle('disabled', !hasSelection);
  document.getElementById('opt-recalc-size').classList.toggle('disabled', !hasSelection);
  document.getElementById('opt-lock').classList.toggle('disabled', !hasSelection);
  document.getElementById('opt-splat').classList.toggle('disabled', !hasSelection);
  document.getElementById('opt-change-type').classList.toggle('disabled', !hasSelection);
  document.getElementById('opt-edit-sector').classList.toggle('disabled', !hasSelection);
  document.getElementById('opt-edit-file-sector').classList.toggle('disabled', !hasSelection);
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
    for (let i = 0; i < 5; i++) {
      document.getElementById('check-type-' + i).innerHTML = i === currentTypeIdx ? '<i class="fa-solid fa-check"></i>' : '';
    }
  } else {
    lockEl.textContent = 'Lock File';
    splatEl.textContent = 'Scratch File';
    for (let i = 0; i < 5; i++) {
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
      var dt = currentFormat.dirTrack, ds = currentFormat.dirSector;
      var dVisited = new Set();
      for (var di = 0; di < dirSectorIdx && dt !== 0; di++) {
        var dk = dt + ':' + ds;
        if (dVisited.has(dk)) break;
        dVisited.add(dk);
        var doff = sectorOffset(dt, ds);
        dt = data2[doff]; ds = data2[doff + 1];
      }
      footerTs.textContent = 'T:$' + dt.toString(16).toUpperCase().padStart(2, '0') +
        ' S:$' + ds.toString(16).toUpperCase().padStart(2, '0') +
        ' E:' + entryInSector + ' | ';
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

document.querySelectorAll('#opt-new .submenu .option').forEach(el => {
  el.addEventListener('click', (e) => {
    e.stopPropagation();
    closeMenus();
    const tracks = parseInt(el.dataset.tracks, 10);
    const formatKey = el.dataset.format || 'd64';
    const buf = createEmptyDisk(formatKey, tracks);
    currentBuffer = buf;
    currentFileName = null;
    const info = parseDisk(buf);
    renderDisk(info);
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
  currentBuffer = null;
  currentFileName = null;
  selectedEntryIndex = -1;
  document.getElementById('content').innerHTML = `
    <div class="empty-state">
      No disk loaded.<br>
      Use Disk &gt; New to create an empty disk,<br>
      or Disk &gt; Open to load a disk image.
    </div>`;
  updateMenuState();
  updateEntryMenuState();
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
  updateMenuState();
});

document.getElementById('opt-validate').addEventListener('click', (e) => {
  e.stopPropagation();
  if (!currentBuffer) return;
  closeMenus();
  const log = validateD64(currentBuffer);
  const info = parseD64(currentBuffer);
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
  const info = parseD64(currentBuffer);
  renderDisk(info);
});

document.querySelectorAll('#opt-sort .submenu .option').forEach(el => {
  el.addEventListener('click', (e) => {
    e.stopPropagation();
    if (!currentBuffer) return;
    closeMenus();
    sortDirectory(currentBuffer, el.dataset.sort);
    const info = parseD64(currentBuffer);
    renderDisk(info);
  });
});

// ── View menu ─────────────────────────────────────────────────────────
document.getElementById('opt-show-addr').addEventListener('click', (e) => {
  e.stopPropagation();
  closeMenus();
  showAddresses = !showAddresses;
  localStorage.setItem('d64-showAddresses', showAddresses);
  document.getElementById('check-addr').innerHTML = showAddresses ? '<i class="fa-solid fa-check"></i>' : '';
  if (currentBuffer) {
    const info = parseD64(currentBuffer);
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
    const info = parseD64(currentBuffer);
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

// ── Options menu ──────────────────────────────────────────────────────
document.getElementById('opt-unsafe-chars').addEventListener('click', (e) => {
  e.stopPropagation();
  closeMenus();
  allowUnsafeChars = !allowUnsafeChars;
  localStorage.setItem('d64-allowUnsafe', allowUnsafeChars);
  document.getElementById('check-unsafe').innerHTML = allowUnsafeChars ? '<i class="fa-solid fa-check"></i>' : '';
  // Re-render picker if open
  if (pickerTarget) renderPicker();
});

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
      var info = parseD64(currentBuffer);
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
  const info = parseD64(currentBuffer);
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
  const oldInfo = parseD64(currentBuffer);
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

  const updatedInfo = parseD64(currentBuffer);
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
function getDirSlotOffsets(buffer) {
  const data = new Uint8Array(buffer);
  const offsets = [];
  let t = currentFormat.dirTrack, s = currentFormat.dirSector;
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
  const info = parseD64(currentBuffer);
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
  if (content.length === 0 || content.length >= 16) return;

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
  return currentFormat.maxDirSectors * currentFormat.entriesPerSector;
}

function countDirEntries() {
  if (!currentBuffer) return 0;
  const data = new Uint8Array(currentBuffer);
  let count = 0;
  let t = currentFormat.dirTrack, s = currentFormat.dirSector;
  const visited = new Set();
  while (t !== 0) {
    const key = `${t}:${s}`;
    if (visited.has(key)) break;
    visited.add(key);
    const off = sectorOffset(t, s);
    if (off < 0) break;
    for (let i = 0; i < 8; i++) {
      const eo = off + i * 32;
      // Count non-empty slots (any slot that isn't fully zeroed)
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
  const bamOff = sectorOffset(currentFormat.bamTrack, currentFormat.bamSector);

  // Walk directory chain, find first empty slot
  let t = currentFormat.dirTrack, s = currentFormat.dirSector;
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
      // Check if slot is fully zeroed (unused)
      let isEmpty = true;
      for (let j = 2; j < 32; j++) {
        if (data[eo + j] !== 0x00) { isEmpty = false; break; }
      }
      if (isEmpty) {
        // Found empty slot — write new entry
        writeNewEntry(data, eo);
        return eo;
      }
    }

    t = data[off];
    s = data[off + 1];
  }

  // No empty slots in existing chain — allocate a new directory sector
  const dirTrk = currentFormat.dirTrack;
  const spt = sectorsPerTrack(dirTrk);
  let newSector = -1;
  for (let cs = 1; cs < spt; cs++) {
    if (visited.has(`${dirTrk}:${cs}`)) continue;
    newSector = cs;
    break;
  }

  if (newSector === -1) return -1; // directory track full

  // Link the new sector from the last sector in the chain
  if (lastOff >= 0) {
    data[lastOff] = dirTrk;
    data[lastOff + 1] = newSector;
  }

  // Initialize new directory sector
  const newOff = sectorOffset(dirTrk, newSector);
  data[newOff] = 0x00; // end of chain
  data[newOff + 1] = 0xFF;
  // Zero out all 8 entries
  for (let i = 2; i < 256; i++) data[newOff + i] = 0x00;

  // Write new entry in first slot
  writeNewEntry(data, newOff);

  // Mark sector as used in BAM
  const fmt = currentFormat;
  const bm = fmt.readTrackBitmap(data, bamOff, dirTrk);
  const newBm = bm & ~(1 << newSector);
  fmt.writeTrackBitmap(data, bamOff, dirTrk, newBm);
  let free = 0;
  for (let cs = 0; cs < spt; cs++) {
    if (newBm & (1 << cs)) free++;
  }
  fmt.writeTrackFree(data, bamOff, dirTrk, free);

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
  const info = parseD64(currentBuffer);
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
    const info = parseD64(currentBuffer);
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
    const info = parseD64(currentBuffer);
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

document.getElementById('opt-insert').addEventListener('click', (e) => {
  e.stopPropagation();
  if (!currentBuffer || !canInsertFile()) return;
  closeMenus();
  const newOff = insertFileEntry();
  if (newOff >= 0) {
    selectedEntryIndex = newOff;
    const info = parseD64(currentBuffer);
    renderDisk(info);
  }
});

document.getElementById('opt-remove').addEventListener('click', (e) => {
  e.stopPropagation();
  if (!currentBuffer || selectedEntryIndex < 0) return;
  closeMenus();
  const slots = getDirSlotOffsets(currentBuffer);
  const idx = slots.indexOf(selectedEntryIndex);
  removeFileEntry(currentBuffer, selectedEntryIndex);
  const info = parseD64(currentBuffer);
  const visibleEntries = info.entries.filter(en => !en.deleted || showDeleted);
  if (visibleEntries.length > 0) {
    const newIdx = Math.min(idx, visibleEntries.length - 1);
    selectedEntryIndex = visibleEntries[newIdx].entryOff;
  } else {
    selectedEntryIndex = -1;
  }
  renderDisk(info);
});

document.querySelectorAll('#opt-align .submenu .option').forEach(el => {
  el.addEventListener('click', (e) => {
    e.stopPropagation();
    if (!currentBuffer || selectedEntryIndex < 0) return;
    closeMenus();
    alignFilename(currentBuffer, selectedEntryIndex, el.dataset.align);
    const info = parseD64(currentBuffer);
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
  const info = parseD64(currentBuffer);
  renderDisk(info);
});

document.getElementById('opt-lock').addEventListener('click', (e) => {
  e.stopPropagation();
  if (!currentBuffer || selectedEntryIndex < 0) return;
  closeMenus();
  const data = new Uint8Array(currentBuffer);
  data[selectedEntryIndex + 2] ^= 0x40; // toggle lock bit
  const info = parseD64(currentBuffer);
  renderDisk(info);
});

document.getElementById('opt-splat').addEventListener('click', (e) => {
  e.stopPropagation();
  if (!currentBuffer || selectedEntryIndex < 0) return;
  closeMenus();
  const data = new Uint8Array(currentBuffer);
  data[selectedEntryIndex + 2] ^= 0x80; // toggle closed bit
  const info = parseD64(currentBuffer);
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
  const file = fileInput.files[0];
  if (!file) return;
  currentFileName = file.name;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      currentBuffer = reader.result;
      const info = parseD64(currentBuffer);
      renderDisk(info);
      updateMenuState();
    } catch (err) {
      showModal('Error', ['Error reading disk image: ' + err.message]);
    }
  };
  reader.onerror = () => {
    showModal('Error', ['Failed to read file: ' + (reader.error ? reader.error.message : 'Unknown error')]);
  };
  reader.readAsArrayBuffer(file);
  fileInput.value = '';
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
document.getElementById('check-unsafe').innerHTML = allowUnsafeChars ? '<i class="fa-solid fa-check"></i>' : '';

themeToggle.addEventListener('click', () => {
  const current = document.documentElement.getAttribute('data-theme');
  const next = current === 'dark' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', next);
  localStorage.setItem('d64-theme', next);
  updateThemeIcon();
});
