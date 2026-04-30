// ── CMD container UI (RAMLink, FD2000/FD4000, future…) ────────────────
//
// CMD-style container files (.rml/.rl/.d1m/.d2m/.d4m) hold a partition
// table plus N sub-partitions (Native/DNP, 1541, 1571, 1581) each
// formatted as a standalone CBM filesystem. The format-layer helpers
// in cbm-format.js (readCmdContainerPartitions, …) abstract over the
// per-type quirks via CMD_CONTAINERS; everything in this file is the
// user-facing wiring:
//
//   * openCmdContainerAsTab        — entry point from drop / file-input /
//                                    recent / "New container" handlers.
//   * renderCmdContainerPartitionList — drawn instead of a directory when
//                                       cmdcPartitionIdx === -1.
//   * enterCmdContainerPartition   — slice the chosen partition into
//                                    currentBuffer and re-parse as DNP /
//                                    D64 / D71 / D81.
//   * leaveCmdContainerPartition   — splice edits back into the container
//                                    and return to the partition list.
//   * addCmdContainerPartition / deleteCmdContainerPartition — partition-
//     table management from the File menu.
//
// State globals (cmdcBuffer, cmdcPartitions, cmdcPartitionIdx,
// cmdcContainerKey) live in cbm-editor.js so per-tab serialization is
// handled there.

// Map a file extension (lowercased, without dot) to a container key in
// CMD_CONTAINERS. Returns null when the extension isn't a recognised
// container type.
function cmdContainerKeyForExt(ext) {
  if (ext === 'rml' || ext === 'rl') return 'ramlink';
  if (ext === 'd1m' || ext === 'd2m' || ext === 'd4m') return ext;
  return null;
}

// Splice the (possibly edited) partition slice back into cmdcBuffer.
// Used both when leaving the partition view and when saving — the latter
// keeps changes inside the container without forcing the user to navigate
// out first.
function spliceCmdContainerPartitionBack() {
  if (!cmdcBuffer || cmdcPartitionIdx < 0 || !cmdcPartitions) return;
  var part = cmdcPartitions[cmdcPartitionIdx];
  if (!part || !currentBuffer || currentBuffer === cmdcBuffer) return;
  var src = new Uint8Array(currentBuffer);
  var lim = Math.min(src.length, part.sizeBytes);
  new Uint8Array(cmdcBuffer).set(src.subarray(0, lim), part.startByte);
}

function refreshCmdContainerView() {
  renderDisk(parseCurrentDir(currentBuffer));
  renderTabs();
  updateMenuState();
  updateEntryMenuState();
}

// ── Open a container file as a tab ────────────────────────────────────
// Two flavours: a real container (signature present) opens to the
// partition-list view; a flat image without a partition table falls
// back to opening as a single filesystem of the matching format so
// save-as keeps the original extension.
async function openCmdContainerAsTab(buffer, fileName, containerKey) {
  containerKey = containerKey || cmdContainerKeyForExt((fileName || '').toLowerCase().replace(/.*\./, ''));
  if (!containerKey || !CMD_CONTAINERS[containerKey]) return;

  var info = readCmdContainerPartitions(buffer, containerKey);
  saveActiveTab();

  if (!info) {
    clearCmdContainerState();
    currentBuffer = buffer;
    currentFileName = fileName;
    currentPartition = null;
    selectedEntryIndex = -1;
    parseDisk(currentBuffer);
    var fbTab = createTab(fileName, currentBuffer, fileName);
    activeTabId = fbTab.id;
    tabDirty = false;
    clearUndo();
    addRecentDisk(fileName, buffer);
    renderDisk(parseCurrentDir(currentBuffer));
    renderTabs();
    updateMenuState();
    return;
  }

  // currentFormat is set to the container alias so save-as picks the
  // right extension; the tab body shows the partition list instead of
  // a directory while cmdcPartitionIdx === -1.
  cmdcBuffer = buffer;
  cmdcFileName = fileName;
  cmdcPartitions = info.partitions;
  cmdcPartitionIdx = -1;
  cmdcContainerKey = containerKey;
  currentBuffer = buffer;
  currentFileName = fileName;
  currentFormat = DISK_FORMATS[CMD_CONTAINERS[containerKey].formatKey];
  currentTracks = 1; // unused on the list view
  currentPartition = null;
  selectedEntryIndex = -1;

  var tab = createTab(fileName, buffer, fileName);
  activeTabId = tab.id;
  tabDirty = false;
  clearUndo();
  addRecentDisk(fileName, buffer);

  refreshCmdContainerView();
}

// ── Partition list view ──────────────────────────────────────────────
// Drawn in place of a regular directory when cmdcPartitionIdx === -1.
// Each partition is a row with click-to-select / dblclick-to-enter
// (mirrors how subdirectories work elsewhere).
function renderCmdContainerPartitionList() {
  // Re-parse on every render — partition-table edits (rename, new,
  // delete) mutate cmdcBuffer directly; this picks up the change
  // without a separate refresh hook.
  if (cmdcBuffer && cmdcContainerKey) {
    var fresh = readCmdContainerPartitions(cmdcBuffer, cmdcContainerKey);
    if (fresh) cmdcPartitions = fresh.partitions;
  }
  // Absolute byte offset of slot N's entry; rows expose this as
  // `data-offset` so the existing startRenameEntry helper can
  // read/write the 16-byte name field at +5..+20 unchanged.
  var ct = cmdcContainerKey ? CMD_CONTAINERS[cmdcContainerKey] : null;
  var layout = (ct && cmdcBuffer) ? ct.getTableLayout(cmdcBuffer) : null;
  function entryAbsForSlot(slotIdx) {
    if (!layout) return 0;
    var cumulative = 0;
    for (var li = 0; li < layout.length; li++) {
      var sec = layout[li];
      if (slotIdx < cumulative + sec.slots) return sec.off + (slotIdx - cumulative) * 32;
      cumulative += sec.slots;
    }
    return 0;
  }

  var containerLabel = ct ? ct.name : 'Container';
  var diskIdLabel = ct && ct.diskIdLabel ? ct.diskIdLabel : containerLabel;

  var content = document.getElementById('content');
  var html = '<div class="disk-panel">' +
    '<div class="disk-header">' +
      '<div class="disk-header-spacer"><i class="fa-solid fa-cube" title="' + containerLabel + ' container"></i></div>' +
      '<div class="disk-name">' + escHtml(cmdcFileName || containerLabel) + '</div>' +
      '<div class="disk-id">' + escHtml(diskIdLabel) + '</div>' +
    '</div>' +
    '<div class="dir-entry dir-header-row">' +
      '<span class="dir-grip"></span>' +
      '<span class="dir-blocks">Size</span>' +
      '<span class="dir-name">Partition</span>' +
      '<span class="dir-type">Type</span>' +
      '<span class="dir-slot">#</span>' +
      '<span class="dir-ts">Start</span>' +
      '<span class="dir-addr"></span>' +
      '<span class="dir-icons"></span>' +
    '</div>' +
    '<div class="dir-listing">';

  var openCount = 0;
  for (var i = 0; i < cmdcPartitions.length; i++) {
    var p = cmdcPartitions[i];
    var canOpen = p.type !== 0xFF; // SYSTEM is shown but not enterable
    if (canOpen) openCount++;
    var startHex = '$' + p.startByte.toString(16).toUpperCase().padStart(8, '0');
    var entryAbs = entryAbsForSlot(p.index);
    html +=
      '<div class="dir-entry' + (canOpen ? '' : ' deleted') + '" data-cmdc-part="' + i + '" data-offset="' + entryAbs + '">' +
        '<span class="dir-grip"></span>' +
        '<span class="dir-blocks">' + p.sizeBlocks + '</span>' +
        '<span class="dir-name">"' + escHtml(p.name) + '"</span>' +
        '<span class="dir-type">' + escHtml(p.typeName) + '</span>' +
        '<span class="dir-slot">' + p.index + '</span>' +
        '<span class="dir-ts">' + startHex + '</span>' +
        '<span class="dir-addr"></span>' +
        '<span class="dir-icons"></span>' +
      '</div>';
  }

  html += '</div>' +
    '<div class="dir-footer"><div class="dir-footer-row">' +
      '<span class="dir-footer-blocks">' + openCount + '</span>' +
      '<span class="dir-footer-label">partition(s).</span>' +
      '<span class="dir-footer-tracks">' + escHtml(containerLabel) + ' container</span>' +
    '</div></div>' +
  '</div>';
  content.innerHTML = html;

  content.querySelectorAll('.dir-entry[data-cmdc-part]').forEach(function(row) {
    var idx = parseInt(row.dataset.cmdcPart, 10);
    var part = cmdcPartitions[idx];
    var canOpen = part.type !== 0xFF;
    row.addEventListener('click', function() {
      // Click selects (so Delete Partition can target it), dblclick
      // enters. updateEntryMenuState picks up the new selection right
      // away.
      content.querySelectorAll('.dir-entry.selected').forEach(function(el) { el.classList.remove('selected'); });
      row.classList.add('selected');
      updateEntryMenuState();
    });
    row.addEventListener('dblclick', function() {
      if (canOpen) enterCmdContainerPartition(idx);
    });
  });

  selectedEntryIndex = -1;
  selectedEntries = [];
  updateEntryMenuState();
}

function enterCmdContainerPartition(idx) {
  if (!cmdcBuffer || !cmdcPartitions) return;
  var part = cmdcPartitions[idx];
  if (!part || part.type === 0xFF) return;

  var slice = extractCmdContainerPartition(cmdcBuffer, part);
  if (!slice) {
    showModal('Container', ['Failed to extract partition "' + part.name + '"']);
    return;
  }

  cmdcPartitionIdx = idx;
  currentBuffer = slice;
  currentPartition = null;
  selectedEntryIndex = -1;
  // parseDisk needs a format hint when the slice size doesn't match a
  // standard disk size (FD Native partitions). Native uses the
  // container's nativeFormatKey (DNP for RAMLink, parent FD format
  // otherwise); 1541/1571/1581 use the shared type→format table.
  var ct = CMD_CONTAINERS[cmdcContainerKey];
  var hint = part.type === 0x01 ? (ct && ct.nativeFormatKey) : CMD_PART_TYPE_FORMAT[part.type];
  parseDisk(currentBuffer, hint || null);
  // Reset undo so the partition's edit history is local to that view.
  clearUndo();
  refreshCmdContainerView();
}

function leaveCmdContainerPartition() {
  if (!cmdcBuffer || cmdcPartitionIdx < 0 || !cmdcPartitions) return;
  spliceCmdContainerPartitionBack();
  cmdcPartitionIdx = -1;
  currentBuffer = cmdcBuffer;
  if (cmdcContainerKey) {
    currentFormat = DISK_FORMATS[CMD_CONTAINERS[cmdcContainerKey].formatKey];
  }
  currentTracks = 1;
  currentPartition = null;
  selectedEntryIndex = -1;
  clearUndo();
  refreshCmdContainerView();
}

// ── New / Delete partition (File menu) ────────────────────────────────
// Only meaningful on the partition-list view. New allocates a 32-byte
// slot, finds free byte space, writes an empty filesystem of the chosen
// type into that range. Delete just zeros the slot — it does NOT zero
// the partition data, so an "undelete" is just re-adding an entry with
// the same start/size if you remember them.
function canAddCmdContainerPartition() {
  if (!isCmdContainerListView()) return false;
  return findCmdContainerEmptySlot(cmdcBuffer, cmdcContainerKey) >= 0;
}

// "New Partition" picker — table-style form (Slot / Type / Size / Name).
// Both RAMLink and FD2000/FD4000 support the same four CMD partition
// types per the BASIC tools (FD-Tools v1.05 / RAM-Tools v1.02 line 52-53).
// Size auto-fills the standard CBM block count for non-Native types
// and locks the field; Native is freely sizable.
var CMDC_TYPE_PRESETS = [
  { value: 'nat',  label: 'Native (DNP)', size: 256,  fixed: false },
  { value: '1541', label: '1541',         size: 683,  fixed: true },
  { value: '1571', label: '1571',         size: 1366, fixed: true },
  { value: '1581', label: '1581',         size: 3200, fixed: true },
];
function showNewPartitionPicker() {
  return new Promise(function(resolve) {
    setModalSize(null);
    var ct = cmdcContainerKey ? CMD_CONTAINERS[cmdcContainerKey] : null;
    document.getElementById('modal-title').textContent = 'New ' + (ct ? ct.name : '') + ' Partition';
    var body = document.getElementById('modal-body');
    body.innerHTML = '';

    var table = document.createElement('table');
    table.style.width = '100%';
    table.style.borderCollapse = 'collapse';

    function row(labelText, content) {
      var tr = document.createElement('tr');
      var th = document.createElement('th');
      th.textContent = labelText;
      th.style.textAlign = 'left';
      th.style.padding = '6px 12px 6px 0';
      th.style.verticalAlign = 'middle';
      th.style.width = '60px';
      th.style.fontWeight = 'normal';
      th.style.opacity = '0.7';
      tr.appendChild(th);
      var td = document.createElement('td');
      td.style.padding = '6px 0';
      td.appendChild(content);
      tr.appendChild(td);
      table.appendChild(tr);
    }

    // Slot — dropdown of free slot numbers only
    var occupied = {};
    for (var pi = 0; pi < cmdcPartitions.length; pi++) {
      occupied[cmdcPartitions[pi].index] = cmdcPartitions[pi];
    }
    var slotSelect = document.createElement('select');
    slotSelect.className = 'modal-input';
    for (var s = 1; s <= 31; s++) {
      if (occupied[s]) continue;
      var opt = document.createElement('option');
      opt.value = String(s);
      opt.textContent = String(s);
      slotSelect.appendChild(opt);
    }
    row('Slot', slotSelect);

    // Type — radio group inline; changes update Size enabled state + value
    var typeWrap = document.createElement('div');
    var radios = [];
    CMDC_TYPE_PRESETS.forEach(function(t, i) {
      var lbl = document.createElement('label');
      lbl.style.marginRight = '14px';
      lbl.style.cursor = 'pointer';
      var radio = document.createElement('input');
      radio.type = 'radio';
      radio.name = 'cmdc-new-type';
      radio.value = t.value;
      radio.style.marginRight = '4px';
      if (i === 0) radio.checked = true;
      radio.addEventListener('change', applyType);
      radios.push(radio);
      lbl.appendChild(radio);
      lbl.appendChild(document.createTextNode(t.label));
      typeWrap.appendChild(lbl);
    });
    row('Type', typeWrap);

    // Size — input, default Native (256), disabled when type is fixed
    var sizeInput = document.createElement('input');
    sizeInput.type = 'text';
    sizeInput.className = 'modal-input';
    sizeInput.value = '256';
    row('Size', sizeInput);

    // Name — defaults to the type label so a fresh CBM-style name is
    // pre-filled (NATIVE / 1541 / 1571 / 1581)
    var nameInput = document.createElement('input');
    nameInput.type = 'text';
    nameInput.className = 'modal-input';
    nameInput.maxLength = 16;
    nameInput.value = 'NATIVE';
    row('Name', nameInput);

    body.appendChild(table);

    function currentType() {
      for (var i = 0; i < radios.length; i++) if (radios[i].checked) return CMDC_TYPE_PRESETS[i];
      return CMDC_TYPE_PRESETS[0];
    }
    function applyType() {
      var t = currentType();
      sizeInput.value = String(t.size);
      sizeInput.disabled = t.fixed;
      sizeInput.style.opacity = t.fixed ? '0.5' : '';
      // Only refresh the name field if the user hasn't customised it from
      // the previously-selected default.
      var prevDefaults = CMDC_TYPE_PRESETS.map(function(p) {
        return p.value === 'nat' ? 'NATIVE' : p.value;
      });
      if (prevDefaults.indexOf(nameInput.value) >= 0) {
        nameInput.value = (t.value === 'nat') ? 'NATIVE' : t.value;
      }
    }

    var footer = document.querySelector('#modal-overlay .modal-footer');
    footer.innerHTML = '';
    var done = false;
    function ok() {
      if (done) return;
      var t = currentType();
      // Clamp + round size silently. The 256-multiple rule only applies
      // to Native (DNP allocates whole tracks of 256 sectors) — 1541 /
      // 1571 / 1581 use fixed CBM block counts (683 / 1366 / 3200) that
      // aren't multiples of 256, so we trust the preset there.
      var size = parseInt(sizeInput.value, 10);
      if (t.fixed) {
        size = t.size;
      } else {
        if (isNaN(size) || size < 256) size = 256;
        if (size % 256 !== 0) size = Math.floor(size / 256) * 256;
      }
      var name = (nameInput.value || '').trim().slice(0, 16) || 'PARTITION';
      done = true;
      document.getElementById('modal-overlay').classList.remove('open');
      resolve({ slot: parseInt(slotSelect.value, 10), type: t.value, size: size, name: name });
    }
    function cancel() {
      if (done) return;
      done = true;
      document.getElementById('modal-overlay').classList.remove('open');
      resolve(null);
    }
    var cancelBtn = document.createElement('button');
    cancelBtn.textContent = 'Cancel';
    cancelBtn.className = 'modal-btn-secondary';
    cancelBtn.addEventListener('click', cancel);
    footer.appendChild(cancelBtn);
    var okBtn = document.createElement('button');
    okBtn.textContent = 'OK';
    okBtn.addEventListener('click', ok);
    footer.appendChild(okBtn);

    document.getElementById('modal-overlay').classList.add('open');
    slotSelect.focus();
  });
}

// createEmptyDisk side-effects currentFormat/currentTracks. We restore
// them after building the filesystem so the container view's labels stay
// correct.
function buildPartitionFilesystem(typeChoice, sizeBlocks, name) {
  var savedFmt = currentFormat, savedTracks = currentTracks;
  var initBuf;
  var typeCode;
  // Disk-header offset (within partition) where the 16-byte name lives,
  // plus every offset where a 2-byte ID lives. createEmptyDisk leaves
  // both name and ID as 0xA0 padding — VICE/CMD ROM read these when
  // mounting, and an empty name/ID makes the partition look unformatted.
  var nameOff;
  var idOffs;
  if (typeChoice === '1541')      {
    initBuf = createEmptyDisk('d64', 35); typeCode = 0x02;
    nameOff = 0x16500 + 0x90;
    idOffs = [0x16500 + 0xA2];
  }
  else if (typeChoice === '1571') {
    initBuf = createEmptyDisk('d71', 70); typeCode = 0x03;
    nameOff = 0x16500 + 0x90;
    idOffs = [0x16500 + 0xA2];
  }
  else if (typeChoice === '1581') {
    initBuf = createEmptyDisk('d81', 80); typeCode = 0x04;
    nameOff = 0x61800 + 0x04;
    idOffs = [0x61800 + 0x16, 0x61900 + 0x04, 0x61A00 + 0x04]; // T40/S0 + BAM1 + BAM2
    // Real RAMLink writes 0x00 at T40/S0 +0x03 instead of the standard
    // 0xBB inverted-DOS marker that createEmptyDisk produces. Functionally
    // inert, but matches a VICE-/RAMLink-formatted partition byte-for-byte.
    new Uint8Array(initBuf)[0x61803] = 0x00;
  }
  else {
    initBuf = createEmptyDisk('dnp', sizeBlocks / 256); typeCode = 0x01;
    nameOff = 0x100 + 0x04;
    idOffs = [0x100 + 0x16, 0x200 + 0x04]; // T1/S1 header + T1/S2 BAM
  }
  currentFormat = savedFmt;
  currentTracks = savedTracks;

  // Stamp the user-supplied name (uppercased, 0xA0-padded to 16 bytes)
  // into the partition's filesystem header, then write "RL" at every ID
  // location. Mirrors how CMD HD ROM names a freshly-formatted partition
  // during "Make Partition".
  var view = new Uint8Array(initBuf);
  var upper = (name || '').toUpperCase();
  for (var n = 0; n < 16; n++) {
    view[nameOff + n] = n < upper.length ? upper.charCodeAt(n) : 0xA0;
  }
  for (var ii = 0; ii < idOffs.length; ii++) {
    view[idOffs[ii] + 0] = 0x52; // 'R'
    view[idOffs[ii] + 1] = 0x4C; // 'L'
  }
  return { buffer: initBuf, typeCode: typeCode };
}

async function addCmdContainerPartition() {
  if (!isCmdContainerListView()) return;
  if (findCmdContainerEmptySlot(cmdcBuffer, cmdcContainerKey) < 0) {
    showModal('Container', ['No free partition slot — all 31 are allocated.']);
    return;
  }

  var picked = await showNewPartitionPicker();
  if (!picked) return;

  var sizeBytes = picked.size * 256;
  var free = findCmdContainerFreeSpace(cmdcBuffer, cmdcContainerKey, cmdcPartitions);
  if (sizeBytes > free.size) {
    showModal('New Partition', [
      'Not enough free space in the container.',
      'Requested: ' + Math.round(sizeBytes / 1024) + ' KiB.',
      'Available: ' + Math.round(free.size / 1024) + ' KiB.'
    ]);
    return;
  }

  var built = buildPartitionFilesystem(picked.type, picked.size, picked.name);

  pushUndo();
  // Splice the freshly-initialised filesystem into the container at the
  // chosen offset; zero any trailing bytes if the FS is shorter than
  // the requested size (defensive — shouldn't happen with current
  // createEmptyDisk).
  var dst = new Uint8Array(cmdcBuffer);
  var src = new Uint8Array(built.buffer);
  var lim = Math.min(src.length, sizeBytes);
  dst.set(src.subarray(0, lim), free.start);
  if (lim < sizeBytes) dst.fill(0, free.start + lim, free.start + sizeBytes);

  writeCmdContainerPartitionEntry(cmdcBuffer, cmdcContainerKey, picked.slot, built.typeCode, picked.name, free.start, picked.size);
  cmdcPartitions = readCmdContainerPartitions(cmdcBuffer, cmdcContainerKey).partitions;
  refreshCmdContainerView();
}

// Menu entry just hands off to startRenameEntry on the selected row —
// the inline PETSCII editor is the same one regular file rename uses,
// and the partition row's data-offset points at the entry so the
// 16-byte name field round-trips through cmdcBuffer correctly.
function renameCmdContainerPartition() {
  if (!isCmdContainerListView()) return;
  var listSelEl = document.querySelector('.dir-entry.selected[data-cmdc-part]');
  if (!listSelEl) {
    showModal('Container', ['Select a partition first.']);
    return;
  }
  var idx = parseInt(listSelEl.dataset.cmdcPart, 10);
  var part = cmdcPartitions[idx];
  if (!part || part.type === 0xFF) {
    showModal('Container', ['The SYSTEM partition can\'t be renamed.']);
    return;
  }
  startRenameEntry(listSelEl);
}

async function deleteCmdContainerPartition() {
  if (!isCmdContainerListView()) return;
  var listSelEl = document.querySelector('.dir-entry.selected[data-cmdc-part]');
  if (!listSelEl) {
    showModal('Container', ['Select a partition first.']);
    return;
  }
  var idx = parseInt(listSelEl.dataset.cmdcPart, 10);
  var part = cmdcPartitions[idx];
  if (!part || part.type === 0xFF) {
    showModal('Container', ['The SYSTEM partition can\'t be deleted.']);
    return;
  }
  var choice = await showChoiceModal(
    'Delete Partition',
    'Delete partition "' + part.name + '" (' + part.typeName + ', ' + part.sizeBlocks + ' blocks)?',
    [
      { label: 'Cancel', value: false, secondary: true },
      { label: 'Delete', value: true }
    ]
  );
  if (!choice) return;

  pushUndo();
  clearCmdContainerPartitionEntry(cmdcBuffer, cmdcContainerKey, part.index);
  cmdcPartitions = readCmdContainerPartitions(cmdcBuffer, cmdcContainerKey).partitions;
  refreshCmdContainerView();
}

document.getElementById('opt-cmdc-new-partition').addEventListener('click', function(e) {
  e.stopPropagation();
  closeMenus();
  if (this.classList.contains('disabled')) return;
  addCmdContainerPartition();
});

document.getElementById('opt-cmdc-rename-partition').addEventListener('click', function(e) {
  e.stopPropagation();
  closeMenus();
  if (this.classList.contains('disabled')) return;
  renameCmdContainerPartition();
});

document.getElementById('opt-cmdc-delete-partition').addEventListener('click', function(e) {
  e.stopPropagation();
  closeMenus();
  if (this.classList.contains('disabled')) return;
  deleteCmdContainerPartition();
});
