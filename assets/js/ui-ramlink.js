// ── CMD RAMLink container UI ──────────────────────────────────────────
//
// A .rml/.rl file is a raw RAMLink RAM dump (1–16 MiB). Internally it
// holds a CMD-style partition table at the end of the buffer plus N
// sub-partitions (Native/DNP, 1541, 1571, 1581) each formatted as a
// standalone CBM filesystem. The format-layer helpers in cbm-format.js
// (readRamLinkPartitions, extractRamLinkPartition, …) handle the byte
// layout; everything in this file is the user-facing wiring:
//
//   * openRamLinkAsTab        — entry point from drop / file-input /
//                               recent / "New RAMLink" handlers.
//   * renderRamLinkPartitionList — drawn instead of a directory when
//                                  ramlinkPartitionIdx === -1.
//   * enterRamLinkPartition   — slice the chosen partition into
//                               currentBuffer and re-parse as DNP /
//                               D64 / D71 / D81.
//   * leaveRamLinkPartition   — splice edits back into the container
//                               and return to the partition list.
//   * addRamLinkPartition / deleteRamLinkPartition — partition-table
//     management from the File menu.
//
// State globals (ramlinkBuffer, ramlinkPartitions, ramlinkPartitionIdx)
// live in cbm-editor.js so per-tab serialization is handled there.

// Splice the (possibly edited) partition slice back into ramlinkBuffer.
// Used both when leaving the partition view and when saving — the latter
// keeps changes inside the .rml without forcing the user to navigate
// out first.
function spliceRamLinkPartitionBack() {
  if (!ramlinkBuffer || ramlinkPartitionIdx < 0 || !ramlinkPartitions) return;
  var part = ramlinkPartitions[ramlinkPartitionIdx];
  if (!part || !currentBuffer || currentBuffer === ramlinkBuffer) return;
  var dst = new Uint8Array(ramlinkBuffer);
  var src = new Uint8Array(currentBuffer);
  var lim = Math.min(src.length, part.sizeBytes);
  for (var i = 0; i < lim; i++) dst[part.startByte + i] = src[i];
}

// Standard end-of-action refresh: re-render the body, tab strip, and
// menu states. Called from every container-level mutation so the UI
// stays in sync.
function refreshRamLinkView() {
  renderDisk(parseCurrentDir(currentBuffer));
  renderTabs();
  updateMenuState();
  updateEntryMenuState();
}

// ── Open a .rml/.rl file as a tab ────────────────────────────────────
// Two flavours: a real RAMLink dump (partition table at the end) opens
// to the partition-list view; a flat DNP someone happened to label .rml
// falls back to opening as a single DNP, labeled RAMLink so save-as
// keeps the .rml extension.
async function openRamLinkAsTab(buffer, fileName) {
  var info = readRamLinkPartitions(buffer);
  saveActiveTab();

  if (!info) {
    clearRamLinkState();
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

  // Container path: tab body shows the partition list; currentFormat
  // is the ramlink alias purely so save-as picks the .rml extension.
  ramlinkBuffer = buffer;
  ramlinkFileName = fileName;
  ramlinkPartitions = info.partitions;
  ramlinkPartitionIdx = -1;
  currentBuffer = buffer;
  currentFileName = fileName;
  currentFormat = DISK_FORMATS.ramlink;
  currentTracks = 1; // unused on the list view
  currentPartition = null;
  selectedEntryIndex = -1;

  var tab = createTab(fileName, buffer, fileName);
  activeTabId = tab.id;
  tabDirty = false;
  clearUndo();
  addRecentDisk(fileName, buffer);

  refreshRamLinkView();
}

// ── Partition list view ──────────────────────────────────────────────
// Drawn in place of a regular directory when ramlinkPartitionIdx === -1.
// Each partition is a row with click-to-select / dblclick-to-enter
// (mirrors how subdirectories work elsewhere).
function renderRamLinkPartitionList() {
  // Re-parse on every render — partition-table edits (rename, new,
  // delete) mutate ramlinkBuffer directly; this picks up the change
  // without a separate refresh hook.
  if (ramlinkBuffer) {
    var fresh = readRamLinkPartitions(ramlinkBuffer);
    if (fresh) ramlinkPartitions = fresh.partitions;
  }
  // Absolute byte offset of slot N's entry in ramlinkBuffer; rows expose
  // this as `data-offset` so the existing startRenameEntry helper can
  // read/write the 16-byte name field at +5..+20 unchanged.
  var tableOff = ramlinkBuffer ? (ramlinkBuffer.byteLength - 2048) : 0;

  var content = document.getElementById('content');
  var html = '<div class="disk-panel">' +
    '<div class="disk-header">' +
      '<div class="disk-header-spacer"><i class="fa-solid fa-cube" title="RAMLink container"></i></div>' +
      '<div class="disk-name">' + escHtml(ramlinkFileName || 'RAMLink') + '</div>' +
      '<div class="disk-id">RML</div>' +
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
  for (var i = 0; i < ramlinkPartitions.length; i++) {
    var p = ramlinkPartitions[i];
    var canOpen = p.type !== 0xFF; // SYSTEM is shown but not enterable
    if (canOpen) openCount++;
    var startHex = '$' + p.startByte.toString(16).toUpperCase().padStart(8, '0');
    var entryAbs = tableOff + p.index * 32;
    html +=
      '<div class="dir-entry' + (canOpen ? '' : ' deleted') + '" data-ramlink-part="' + i + '" data-offset="' + entryAbs + '">' +
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
      '<span class="dir-footer-tracks">RAMLink container</span>' +
    '</div></div>' +
  '</div>';
  content.innerHTML = html;

  content.querySelectorAll('.dir-entry[data-ramlink-part]').forEach(function(row) {
    var idx = parseInt(row.dataset.ramlinkPart, 10);
    var part = ramlinkPartitions[idx];
    var canOpen = part.type !== 0xFF;
    row.addEventListener('click', function() {
      // Click selects (so Delete RAMLink Partition can target it),
      // dblclick enters. updateEntryMenuState picks up the new
      // selection right away.
      content.querySelectorAll('.dir-entry.selected').forEach(function(el) { el.classList.remove('selected'); });
      row.classList.add('selected');
      updateEntryMenuState();
    });
    row.addEventListener('dblclick', function() {
      if (canOpen) enterRamLinkPartition(idx);
    });
  });

  selectedEntryIndex = -1;
  selectedEntries = [];
  updateEntryMenuState();
}

function enterRamLinkPartition(idx) {
  if (!ramlinkBuffer || !ramlinkPartitions) return;
  var part = ramlinkPartitions[idx];
  if (!part || part.type === 0xFF) return;

  var slice = extractRamLinkPartition(ramlinkBuffer, part);
  if (!slice) {
    showModal('RAMLink', ['Failed to extract partition "' + part.name + '"']);
    return;
  }

  ramlinkPartitionIdx = idx;
  currentBuffer = slice;
  currentPartition = null;
  selectedEntryIndex = -1;
  parseDisk(currentBuffer);
  // Reset undo so the partition's edit history is local to that view.
  clearUndo();
  refreshRamLinkView();
}

function leaveRamLinkPartition() {
  if (!ramlinkBuffer || ramlinkPartitionIdx < 0 || !ramlinkPartitions) return;
  spliceRamLinkPartitionBack();
  ramlinkPartitionIdx = -1;
  currentBuffer = ramlinkBuffer;
  currentFormat = DISK_FORMATS.ramlink;
  currentTracks = 1;
  currentPartition = null;
  selectedEntryIndex = -1;
  clearUndo();
  refreshRamLinkView();
}

// ── New / Delete partition (File menu) ────────────────────────────────
// Only meaningful on the partition-list view. New allocates a 32-byte
// slot, finds free byte space, writes an empty filesystem of the chosen
// type into that range. Delete just zeros the slot — it does NOT zero
// the partition data, so an "undelete" is just re-adding an entry with
// the same start/size if you remember them.
function canAddRamLinkPartition() {
  if (!isRamlinkListView()) return false;
  return findRamLinkEmptySlot(ramlinkBuffer) >= 0;
}

// Single picker for "New Partition" — table-style form with all four
// fields (Slot / Type / Size / Name). Resolves with the full descriptor
// or null on Cancel. Size auto-fills the standard CBM block count when
// a non-Native type is picked and locks the field; Native unlocks it.
var RL_TYPE_PRESETS = [
  { value: 'nat',  label: 'Native (DNP)', size: 256,  fixed: false },
  { value: '1541', label: '1541',         size: 683,  fixed: true },
  { value: '1571', label: '1571',         size: 1366, fixed: true },
  { value: '1581', label: '1581',         size: 3200, fixed: true },
];
function showNewPartitionPicker() {
  return new Promise(function(resolve) {
    setModalSize(null);
    document.getElementById('modal-title').textContent = 'New RAMLink Partition';
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
    for (var pi = 0; pi < ramlinkPartitions.length; pi++) {
      occupied[ramlinkPartitions[pi].index] = ramlinkPartitions[pi];
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
    RL_TYPE_PRESETS.forEach(function(t, i) {
      var lbl = document.createElement('label');
      lbl.style.marginRight = '14px';
      lbl.style.cursor = 'pointer';
      var radio = document.createElement('input');
      radio.type = 'radio';
      radio.name = 'rl-new-type';
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
      for (var i = 0; i < radios.length; i++) if (radios[i].checked) return RL_TYPE_PRESETS[i];
      return RL_TYPE_PRESETS[0];
    }
    function applyType() {
      var t = currentType();
      sizeInput.value = String(t.size);
      sizeInput.disabled = t.fixed;
      sizeInput.style.opacity = t.fixed ? '0.5' : '';
      // Only refresh the name field if the user hasn't customised it from
      // the previously-selected default.
      var prevDefaults = RL_TYPE_PRESETS.map(function(p) {
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
      // Clamp + round size silently — non-Native types are locked to a
      // valid preset, so this only matters when the user types junk into
      // the Native field.
      var size = parseInt(sizeInput.value, 10);
      if (isNaN(size) || size < 256) size = 256;
      if (size % 256 !== 0) size = Math.floor(size / 256) * 256;
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
function buildPartitionFilesystem(typeChoice, sizeBlocks) {
  var savedFmt = currentFormat, savedTracks = currentTracks;
  var initBuf;
  var typeCode;
  if (typeChoice === '1541')      { initBuf = createEmptyDisk('d64', 35); typeCode = 0x02; }
  else if (typeChoice === '1571') { initBuf = createEmptyDisk('d71', 70); typeCode = 0x03; }
  else if (typeChoice === '1581') {
    initBuf = createEmptyDisk('d81', 80); typeCode = 0x04;
    // Real RAMLink writes 0x00 at T40/S0 +0x03 instead of the standard
    // 0xBB inverted-DOS marker that createEmptyDisk produces. Functionally
    // inert, but matches a VICE-/RAMLink-formatted partition byte-for-byte.
    new Uint8Array(initBuf)[0x61803] = 0x00;
  }
  else                            { initBuf = createEmptyDisk('dnp', sizeBlocks / 256); typeCode = 0x01; }
  currentFormat = savedFmt;
  currentTracks = savedTracks;
  return { buffer: initBuf, typeCode: typeCode };
}

async function addRamLinkPartition() {
  if (!isRamlinkListView()) return;
  if (findRamLinkEmptySlot(ramlinkBuffer) < 0) {
    showModal('RAMLink', ['No free partition slot — all 31 are allocated.']);
    return;
  }

  var picked = await showNewPartitionPicker();
  if (!picked) return;

  var sizeBytes = picked.size * 256;
  var free = findRamLinkFreeSpace(ramlinkBuffer, ramlinkPartitions, sizeBytes);
  if (sizeBytes > free.size) {
    showModal('New Partition', [
      'Not enough free space in the RAMLink container.',
      'Requested: ' + Math.round(sizeBytes / 1024) + ' KiB.',
      'Largest free gap: ' + Math.round(free.size / 1024) + ' KiB.'
    ]);
    return;
  }

  var built = buildPartitionFilesystem(picked.type, picked.size);

  pushUndo();
  // Splice the freshly-initialised filesystem into the .rml at the
  // chosen offset; zero any trailing bytes if the FS is shorter than
  // the requested size (defensive — shouldn't happen with current
  // createEmptyDisk).
  var dst = new Uint8Array(ramlinkBuffer);
  var src = new Uint8Array(built.buffer);
  var lim = Math.min(src.length, sizeBytes);
  for (var i = 0; i < lim; i++) dst[free.start + i] = src[i];
  for (var z = lim; z < sizeBytes; z++) dst[free.start + z] = 0;

  writeRamLinkPartitionEntry(ramlinkBuffer, picked.slot, built.typeCode, picked.name, free.start, picked.size);
  ramlinkPartitions = readRamLinkPartitions(ramlinkBuffer).partitions;
  refreshRamLinkView();
}

// Menu entry just hands off to startRenameEntry on the selected row —
// the inline PETSCII editor is the same one regular file rename uses,
// and the partition row's data-offset points at the entry so the
// 16-byte name field round-trips through ramlinkBuffer correctly.
function renameRamLinkPartition() {
  if (!isRamlinkListView()) return;
  var listSelEl = document.querySelector('.dir-entry.selected[data-ramlink-part]');
  if (!listSelEl) {
    showModal('RAMLink', ['Select a partition first.']);
    return;
  }
  var idx = parseInt(listSelEl.dataset.ramlinkPart, 10);
  var part = ramlinkPartitions[idx];
  if (!part || part.type === 0xFF) {
    showModal('RAMLink', ['The SYSTEM partition can\'t be renamed.']);
    return;
  }
  startRenameEntry(listSelEl);
}

async function deleteRamLinkPartition() {
  if (!isRamlinkListView()) return;
  var listSelEl = document.querySelector('.dir-entry.selected[data-ramlink-part]');
  if (!listSelEl) {
    showModal('RAMLink', ['Select a partition first.']);
    return;
  }
  var idx = parseInt(listSelEl.dataset.ramlinkPart, 10);
  var part = ramlinkPartitions[idx];
  if (!part || part.type === 0xFF) {
    showModal('RAMLink', ['The SYSTEM partition can\'t be deleted.']);
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
  clearRamLinkPartitionEntry(ramlinkBuffer, part.index);
  ramlinkPartitions = readRamLinkPartitions(ramlinkBuffer).partitions;
  refreshRamLinkView();
}

document.getElementById('opt-rl-new-partition').addEventListener('click', function(e) {
  e.stopPropagation();
  closeMenus();
  if (this.classList.contains('disabled')) return;
  addRamLinkPartition();
});

document.getElementById('opt-rl-rename-partition').addEventListener('click', function(e) {
  e.stopPropagation();
  closeMenus();
  if (this.classList.contains('disabled')) return;
  renameRamLinkPartition();
});

document.getElementById('opt-rl-delete-partition').addEventListener('click', function(e) {
  e.stopPropagation();
  closeMenus();
  if (this.classList.contains('disabled')) return;
  deleteRamLinkPartition();
});
