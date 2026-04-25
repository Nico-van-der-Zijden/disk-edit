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
function buildEntryIconsHtml(e, data, dirTrack) {
  if (!data) return '';
  if (e.deleted) {
    const dt = data[e.entryOff + 3];
    // Skip separators: T/S points to directory track or is 0
    if (dt === 0 || dt === dirTrack) return '';
    const recov = checkScratchedRecoverable(currentBuffer, e.entryOff);
    if (recov === 'yes') return '<span class="dir-icon-recover" title="Recoverable \u2014 sector chain intact"><i class="fa-solid fa-heart-pulse"></i></span>';
    if (recov === 'partial') return '<span class="dir-icon-recover-partial" title="Partially recoverable \u2014 some sectors reused"><i class="fa-solid fa-heart-crack"></i></span>';
    return '<span class="dir-icon-recover-no" title="Not recoverable \u2014 sectors reused"><i class="fa-solid fa-skull"></i></span>';
  }
  let icons = '';
  const ft = data[e.entryOff + 2] & 0x07;
  if (ft === 5 || ft === 6) icons += '<span class="dir-icon-partition" data-offset="' + e.entryOff + '" title="Directory \u2014 double-click to open"><i class="fa-solid fa-folder"></i></span>';
  if (ft >= 1 && ft <= 4 && data[e.entryOff + 3] > 0) icons += '<span class="dir-icon-info" data-offset="' + e.entryOff + '" title="File info"><i class="fa-solid fa-circle-info"></i></span>';
  if (data[e.entryOff + 0x18] > 0) icons += '<span class="dir-icon-geos" data-offset="' + e.entryOff + '" title="GEOS file \u2014 click for info"><i class="fa-solid fa-globe"></i></span>';
  return icons;
}

function renderDisk(info) {
  const prevSelected = selectedEntryIndex;
  selectedEntryIndex = -1;
  const content = document.getElementById('content');

  // Save scroll position
  const dirListing = content.querySelector('.dir-listing');
  const prevScroll = dirListing ? dirListing.scrollTop : 0;

  // Wrap the buffer once; the entry loop below reads bytes per row and used
  // to rewrap 4x per entry (nameHtml, tsHtml, icons-deleted, icons-regular).
  const isTape = isTapeFormat();
  const data = (currentBuffer && !isTape) ? new Uint8Array(currentBuffer) : null;
  const bufByteLen = data ? data.byteLength : 0;
  const dirTrack = currentFormat.dirTrack;

  // Rich HTML for disk name / id so reversed bytes ($00-$1F / $80-$9F)
  // render as reversed glyphs, matching how filenames in the listing render.
  const richSpans = (bytes, len) => {
    let s = '';
    for (let i = 0; i < len; i++) {
      const b = bytes[i];
      const rev = (b <= 0x1F) || (b >= 0x80 && b <= 0x9F);
      const ch = escHtml(petsciiToAscii(b));
      s += rev ? '<span class="petscii-rev">' + ch + '</span>' : ch;
    }
    return s;
  };
  let nameHtml, idHtml;
  if (data) {
    const headerOff = getHeaderOffset();
    const nameStart = headerOff + currentFormat.nameOffset;
    const idStart = headerOff + currentFormat.idOffset;
    // Name stops at $A0 padding; pad to full width with regular spaces.
    let nameLen = currentFormat.nameLength;
    for (let i = 0; i < currentFormat.nameLength; i++) {
      if (data[nameStart + i] === 0xA0) { nameLen = i; break; }
    }
    nameHtml = '"' + richSpans(data.subarray(nameStart, nameStart + nameLen), nameLen) +
               '"' + ' '.repeat(Math.max(0, currentFormat.nameLength - nameLen));
    idHtml = richSpans(data.subarray(idStart, idStart + currentFormat.idLength), currentFormat.idLength);
  } else {
    nameHtml = '"' + escHtml(info.diskName.padEnd(currentFormat.nameLength)) + '"';
    idHtml = escHtml(info.diskId);
  }

  let html = `
    <div class="disk-panel${showAddresses ? ' show-addresses' : ''}${showTrackSector ? ' show-tracksector' : ''}">
      <div class="disk-header">
        <div class="disk-header-spacer">0</div>
        <div class="disk-name"><span class="editable" id="edit-name" data-field="name" data-max="${currentFormat.nameLength}">${nameHtml}</span></div>
        <div class="disk-id"><span class="editable" id="edit-id" data-field="id" data-max="${currentFormat.idLength}">${idHtml}</span></div>
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
    const richName = data ? readPetsciiRich(data, e.entryOff + 5, 16) : null;
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
    if (showAddresses && data) {
      const addr = getFileAddresses(currentBuffer, e.entryOff);
      if (addr) {
        addrHtml = '$' + hex16(addr.start) + '-$' + hex16(addr.end);
      }
    }

    const tsHtml = (data && e.entryOff + 4 < bufByteLen)
      ? '$' + hex8(data[e.entryOff + 3]) + ' $' + hex8(data[e.entryOff + 4])
      : '';

    html += `
        <div class="dir-entry${e.deleted ? ' deleted' : ''}" data-offset="${e.entryOff}" draggable="true">
          <span class="dir-grip"><i class="fa-solid fa-grip-vertical"></i></span>
          <span class="dir-blocks">${e.blocks}</span>
          <span class="dir-name">${nameHtml}</span>
          <span class="dir-type">${escHtml(e.type)}</span>
          <span class="dir-ts">${tsHtml}</span>
          <span class="dir-addr">${addrHtml}</span>
          <span class="dir-icons">${buildEntryIconsHtml(e, data, dirTrack)}</span>
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
          <span class="dir-footer-tracks">${(function() {
            return currentFormat.name + ' ' + currentTracks + ' tracks';
          })()}</span>
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

  // Restore selection after re-render. Build an offset -> element map once
  // instead of doing one querySelector per selected entry (O(n) on multi-select
  // of n rows used to do n full document scans).
  if (prevSelected >= 0) {
    const entryByOffset = {};
    content.querySelectorAll('.dir-entry[data-offset]').forEach(function(el) {
      entryByOffset[el.dataset.offset] = el;
    });
    const selEl = entryByOffset[prevSelected];
    if (selEl) {
      selEl.classList.add('selected');
      selectedEntryIndex = prevSelected;
      if (selectedEntries.indexOf(prevSelected) < 0) selectedEntries = [prevSelected];
      for (let sei = 0; sei < selectedEntries.length; sei++) {
        if (selectedEntries[sei] === prevSelected) continue;
        const multiEl = entryByOffset[selectedEntries[sei]];
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
    healthEl.classList.remove('health-ok', 'health-warn', 'health-error');
    if (bamIssues) {
      healthEl.textContent = '\u25CF';
      healthEl.classList.add('health-error');
      healthEl.title = 'BAM issues detected — click to view BAM';
      healthEl.onclick = function() { document.getElementById('opt-view-bam').click(); };
    } else if (diskErrors) {
      healthEl.textContent = '\u25CF';
      healthEl.classList.add('health-warn');
      healthEl.title = 'Disk has error bytes — click to view';
      healthEl.onclick = function() { document.getElementById('opt-view-errors').click(); };
    } else {
      healthEl.textContent = '\u25CF';
      healthEl.classList.add('health-ok');
      var extBam = detectExtendedBAM(currentBuffer);
      healthEl.title = 'Disk OK' + (extBam ? ' (' + extBam + ' extended BAM)' : '') + ' — click to view BAM';
      healthEl.onclick = function() { document.getElementById('opt-view-bam').click(); };
    }
  } else if (healthEl) {
    healthEl.textContent = '';
    healthEl.classList.remove('health-ok', 'health-warn', 'health-error');
    healthEl.onclick = null;
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
  const entries = document.querySelectorAll('.dir-entry:not(.dir-header-row):not(.dir-parent-row)');
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
      if (currentBuffer) {
        var d = new Uint8Array(currentBuffer);
        var tb = d[entryOff + 2];
        if (currentFormat.supportsSubdirs && (tb & 0x07) === currentFormat.subdirType && (tb & 0x80)) { // closed subdir type
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
  var typeIdx = data[entryOff + 2] & 0x07;
  var startTrack = data[entryOff + 3];
  var startSector = data[entryOff + 4];
  var partSize = data[entryOff + 30] | (data[entryOff + 31] << 8);
  var name = petsciiToReadable(readPetsciiString(data, entryOff + 5, 16)).trim();

  // Linked directory (e.g. DNP): header + dir chain
  if (currentFormat.subdirLinked && typeIdx === currentFormat.subdirType) {
    var hdrOff = sectorOffset(startTrack, startSector);
    if (hdrOff < 0) {
      showModal('Directory Error', ['Invalid header sector.']);
      return;
    }
    var dirT = data[hdrOff + 0x00];
    var dirS = data[hdrOff + 0x01];
    if (dirT === 0) {
      showModal('Directory Error', ['Directory has no entries.']);
      return;
    }

    currentPartition = {
      entryOff: entryOff, name: name,
      dnpDir: true,
      dnpHeaderT: startTrack, dnpHeaderS: startSector,
      dnpDirT: dirT, dnpDirS: dirS
    };
    selectedEntryIndex = -1;

    var info = parseDnpDirectory(currentBuffer, dirT, dirS, name, startTrack, startSector);
    if (!info) {
      currentPartition = null;
      showModal('Directory Error', ['Failed to parse directory.']);
      return;
    }
    renderDisk(info);
    return;
  }

  // D81 CBM partition (type $05): contiguous track range
  if (startSector !== 0) {
    showModal('Partition Error', ['Partition does not start at sector 0.']);
    return;
  }
  if (partSize < 120 || partSize % currentFormat.partitionSpt !== 0) {
    showModal('Partition Error', ['Invalid partition size (' + partSize + ' sectors).']);
    return;
  }

  var headerOff = sectorOffset(startTrack, 0);
  if (headerOff < 0) {
    showModal('Partition Error', ['Invalid partition start track ' + startTrack + '.']);
    return;
  }

  currentPartition = { entryOff: entryOff, startTrack: startTrack, partSize: partSize, name: name };
  selectedEntryIndex = -1;

  var info2 = parsePartition(currentBuffer, startTrack, partSize);
  if (!info2) {
    currentPartition = null;
    showModal('Partition Error', ['Failed to parse partition directory.']);
    return;
  }
  renderDisk(info2);
}

function leavePartition() {
  if (currentPartition && currentPartition.dnpDir) {
    // DNP directory: go to parent using header's parent reference
    var data = new Uint8Array(currentBuffer);
    var hdrOff = sectorOffset(currentPartition.dnpHeaderT, currentPartition.dnpHeaderS);
    var parentHeaderT = data[hdrOff + currentFormat.subdirParentRef];
    var parentHeaderS = data[hdrOff + currentFormat.subdirParentRef + 1];

    // If parent is the root header (T1/S1), go to root
    if (parentHeaderT === currentFormat.headerTrack && parentHeaderS === currentFormat.headerSector) {
      currentPartition = null;
      selectedEntryIndex = -1;
      var info = parseDisk(currentBuffer);
      renderDisk(info);
      return;
    }

    // Otherwise navigate to parent directory
    var parentHdrOff = sectorOffset(parentHeaderT, parentHeaderS);
    if (parentHdrOff >= 0) {
      var pDirT = data[parentHdrOff + 0x00];
      var pDirS = data[parentHdrOff + 0x01];
      var pName = readPetsciiString(data, parentHdrOff + 0x04, 16);
      currentPartition = {
        dnpDir: true,
        dnpHeaderT: parentHeaderT, dnpHeaderS: parentHeaderS,
        dnpDirT: pDirT, dnpDirS: pDirS,
        name: petsciiToReadable(pName).trim()
      };
      selectedEntryIndex = -1;
      var info2 = parseDnpDirectory(currentBuffer, pDirT, pDirS, currentPartition.name, parentHeaderT, parentHeaderS);
      renderDisk(info2);
      return;
    }
  }

  currentPartition = null;
  selectedEntryIndex = -1;
  var info3 = parseDisk(currentBuffer);
  renderDisk(info3);
}

// Parse a DNP directory chain (type $06 DIR)
function parseDnpDirectory(buffer, dirTrack, dirSector, dirName, headerT, headerS) {
  var data = new Uint8Array(buffer);
  var fmt = currentFormat;
  var entries = [];
  var t = dirTrack, s = dirSector;
  var visited = {};

  while (t !== 0) {
    var key = t + ':' + s;
    if (visited[key]) break;
    visited[key] = true;
    var off = sectorOffset(t, s);
    if (off < 0) break;

    for (var i = 0; i < fmt.entriesPerSector; i++) {
      var entryOff = off + i * fmt.entrySize;
      var typeByte = data[entryOff + 2];
      if (typeByte === 0x00) continue;

      var closed = (typeByte & 0x80) !== 0;
      var locked = (typeByte & 0x40) !== 0;
      var typeIdx = typeByte & 0x07;
      var name = readPetsciiString(data, entryOff + 5, 16);
      var blocks = data[entryOff + 30] | (data[entryOff + 31] << 8);

      if (!closed) {
        var tName = FILE_TYPES[typeIdx] || 'DEL';
        entries.push({ name: name, type: '*' + tName + (locked ? '<' : ' '), blocks: blocks, deleted: true, entryOff: entryOff });
      } else {
        entries.push({ name: name, type: fileTypeName(typeByte), blocks: blocks, deleted: false, entryOff: entryOff });
      }
    }

    t = data[off]; s = data[off + 1];
  }

  // Count free blocks from main BAM (skip track 1)
  var bamOffset = sectorOffset(fmt.bamTrack, fmt.bamSector);
  var freeBlocks = 0;
  for (var ft = 2; ft <= currentTracks; ft++) {
    freeBlocks += fmt.readTrackFree(data, bamOffset, ft);
  }

  return {
    diskName: dirName,
    diskId: '',
    freeBlocks: freeBlocks,
    entries: entries,
    format: 'DNP',
    tracks: currentTracks,
    isPartition: true
  };
}

// ── Linked subdirectory helpers ──────────────────────────────────────
// Count linked subdirectories (recursively) by walking the root directory
function countLinkedSubdirs(buffer) {
  var data = new Uint8Array(buffer);
  var fmt = currentFormat;
  var count = 0;

  function walkDir(dirT, dirS) {
    var visited = {};
    while (dirT !== 0) {
      var key = dirT + ':' + dirS;
      if (visited[key]) break;
      visited[key] = true;
      var off = sectorOffset(dirT, dirS);
      if (off < 0) break;
      for (var i = 0; i < fmt.entriesPerSector; i++) {
        var entOff = off + i * fmt.entrySize;
        var tb = data[entOff + 2];
        if ((tb & 0x07) === fmt.subdirType && (tb & 0x80)) {
          count++;
          var ht = data[entOff + 3], hs = data[entOff + 4];
          var hOff = sectorOffset(ht, hs);
          if (hOff >= 0) walkDir(data[hOff], data[hOff + 1]);
        }
      }
      dirT = data[off]; dirS = data[off + 1];
    }
  }

  walkDir(fmt.dirTrack, fmt.dirSector);
  return count;
}

// Update the ID region in all linked subdirectory headers to match the root header
function updateLinkedSubdirIds(buffer) {
  var data = new Uint8Array(buffer);
  var fmt = currentFormat;
  var rootHdrOff = sectorOffset(fmt.headerTrack, fmt.headerSector);

  function walkDir(dirT, dirS) {
    var visited = {};
    while (dirT !== 0) {
      var key = dirT + ':' + dirS;
      if (visited[key]) break;
      visited[key] = true;
      var off = sectorOffset(dirT, dirS);
      if (off < 0) break;
      for (var i = 0; i < fmt.entriesPerSector; i++) {
        var entOff = off + i * fmt.entrySize;
        var tb = data[entOff + 2];
        if ((tb & 0x07) === fmt.subdirType && (tb & 0x80)) {
          var ht = data[entOff + 3], hs = data[entOff + 4];
          var hOff = sectorOffset(ht, hs);
          if (hOff >= 0) {
            // Copy ID region from root header
            for (var idi = 0; idi < fmt.idLength; idi++) {
              data[hOff + fmt.idOffset + idi] = data[rootHdrOff + fmt.idOffset + idi];
            }
            walkDir(data[hOff], data[hOff + 1]);
          }
        }
      }
      dirT = data[off]; dirS = data[off + 1];
    }
  }

  walkDir(fmt.dirTrack, fmt.dirSector);
}

