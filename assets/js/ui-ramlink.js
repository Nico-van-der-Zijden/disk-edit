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
    html +=
      '<div class="dir-entry' + (canOpen ? '' : ' deleted') + '" data-ramlink-part="' + i + '">' +
        '<span class="dir-grip"></span>' +
        '<span class="dir-blocks">' + p.sizeBlocks + '</span>' +
        '<span class="dir-name">"' + escHtml(p.name) + '"</span>' +
        '<span class="dir-type">' + escHtml(p.typeName) + '</span>' +
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

// createEmptyDisk side-effects currentFormat/currentTracks. We restore
// them after building the filesystem so the container view's labels stay
// correct.
function buildPartitionFilesystem(typeChoice, sizeBlocks) {
  var savedFmt = currentFormat, savedTracks = currentTracks;
  var initBuf;
  var typeCode;
  if (typeChoice === '1541')      { initBuf = createEmptyDisk('d64', 35); typeCode = 0x02; }
  else if (typeChoice === '1571') { initBuf = createEmptyDisk('d71', 70); typeCode = 0x03; }
  else if (typeChoice === '1581') { initBuf = createEmptyDisk('d81', 80); typeCode = 0x04; }
  else                            { initBuf = createEmptyDisk('dnp', sizeBlocks / 256); typeCode = 0x01; }
  currentFormat = savedFmt;
  currentTracks = savedTracks;
  return { buffer: initBuf, typeCode: typeCode };
}

async function addRamLinkPartition() {
  if (!isRamlinkListView()) return;
  var slot = findRamLinkEmptySlot(ramlinkBuffer);
  if (slot < 0) {
    showModal('RAMLink', ['No free partition slot — all 16 are allocated.']);
    return;
  }

  var typeChoice = await showChoiceModal('New RAMLink Partition', 'Pick a partition type:', [
    { label: 'Cancel', value: null, secondary: true },
    { label: 'Native (DNP)', value: 'nat' },
    { label: '1541', value: '1541' },
    { label: '1571', value: '1571' },
    { label: '1581', value: '1581' },
  ]);
  if (!typeChoice) return;

  var name = await showInputModal('Partition Name (max 16 chars)', 'PARTITION');
  if (name === null) return;
  name = (name || '').trim().slice(0, 16) || 'PARTITION';

  // Fixed sizes for emulation modes; Native asks the user.
  var sizeBlocks;
  if (typeChoice === '1541')      sizeBlocks = 683;  // standard 35-track D64
  else if (typeChoice === '1571') sizeBlocks = 1366; // standard 70-track D71
  else if (typeChoice === '1581') sizeBlocks = 3200; // standard D81
  else {
    var sizeStr = await showInputModal('Native partition size in 256-byte blocks (multiple of 256)', '256');
    if (sizeStr === null) return;
    sizeBlocks = parseInt(sizeStr, 10);
    if (isNaN(sizeBlocks) || sizeBlocks < 256) {
      showModal('New Partition', ['Invalid size — must be at least 256 blocks.']);
      return;
    }
    if (sizeBlocks % 256 !== 0) sizeBlocks = Math.floor(sizeBlocks / 256) * 256; // DNP: 1 track = 256 sectors
  }

  var sizeBytes = sizeBlocks * 256;
  var free = findRamLinkFreeSpace(ramlinkBuffer, ramlinkPartitions);
  if (sizeBytes > free.size) {
    showModal('New Partition', [
      'Not enough free space in the RAMLink container.',
      'Requested: ' + Math.round(sizeBytes / 1024) + ' KiB.',
      'Available: ' + Math.round(free.size / 1024) + ' KiB.'
    ]);
    return;
  }

  var built = buildPartitionFilesystem(typeChoice, sizeBlocks);

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

  writeRamLinkPartitionEntry(ramlinkBuffer, slot, built.typeCode, name, free.start, sizeBlocks);
  ramlinkPartitions = readRamLinkPartitions(ramlinkBuffer).partitions;
  refreshRamLinkView();
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

document.getElementById('opt-rl-delete-partition').addEventListener('click', function(e) {
  e.stopPropagation();
  closeMenus();
  if (this.classList.contains('disabled')) return;
  deleteRamLinkPartition();
});
