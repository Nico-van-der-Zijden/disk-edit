// ── CMD container UI (RAMLink, FD2000/FD4000, CMD HD) ─────────────────
//
// Container files hold a partition table plus N sub-partitions (Native/
// DNP, 1541, 1571, 1581) each formatted as a standalone CBM filesystem.
// Format-layer helpers abstract over per-container quirks via
// CMD_CONTAINERS; everything in this module is user-facing wiring:
// open / render-partition-list / enter / leave / add / delete / import /
// export / install-HD-DOS.
//
// State globals (cmdcBuffer, cmdcPartitions, cmdcPartitionIdx,
// cmdcContainerKey) are owned by the editor module — per-tab
// serialization happens there.

// File extension (lowercase, no dot) → key in CMD_CONTAINERS. Null when
// the extension isn't a recognised container type.
function cmdContainerKeyForExt(ext) {
  if (ext === 'rml' || ext === 'rl') return 'ramlink';
  if (ext === 'd1m' || ext === 'd2m' || ext === 'd4m') return ext;
  if (ext === 'dhd') return 'dhd';
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

// Per partition-type metadata for free-blocks computation: format key,
// the offset + expected value of the DOS-version byte that screens out
// not-actually-filesystem partitions, and the theoretical max free
// (used as a second-line sanity cap because the DOS byte alone can be
// matched by chance in raw-code partitions).
var CMDC_FREE_BLOCKS_META = {
  0x01: { fmtKey: 'dnp', dosVerOff: 0x202,   dosVerByte: 0x48, maxFree: null },     // DNP — variable
  0x02: { fmtKey: 'd64', dosVerOff: 0x16502, dosVerByte: 0x41, maxFree: 664 },
  0x03: { fmtKey: 'd71', dosVerOff: 0x16502, dosVerByte: 0x41, maxFree: 1328 },
  0x04: { fmtKey: 'd81', dosVerOff: 0x61802, dosVerByte: 0x44, maxFree: 3160 },
};

// Free blocks for one partition by walking its BAM — matches the
// `BLOCKS FREE` footer the user sees after entering the partition.
// Returns null for SYSTEM, empty/truncated slots, or partitions whose
// header byte doesn't match the expected DOS version (e.g. partitions
// that hold raw code instead of filesystem data).
//
// Briefly swaps currentFormat / currentTracks because readTrackFree
// reaches through sectorOffset → currentFormat.sectorsPerTrack; both
// are restored before return.
function computePartitionFreeBlocks(containerBuf, partition) {
  if (!containerBuf || !partition) return null;
  var meta = CMDC_FREE_BLOCKS_META[partition.type];
  if (!meta) return null;
  if (partition.startByte + partition.sizeBytes > containerBuf.byteLength) return null;

  var fmt = DISK_FORMATS[meta.fmtKey];
  if (!fmt || !fmt.readTrackFree) return null;
  var partBytes = new Uint8Array(containerBuf, partition.startByte, partition.sizeBytes);
  if (meta.dosVerOff >= partBytes.length || partBytes[meta.dosVerOff] !== meta.dosVerByte) return null;

  var savedFmt = currentFormat, savedTracks = currentTracks;
  currentFormat = fmt;
  var maxTrack;
  if (meta.fmtKey === 'dnp') {
    maxTrack = partBytes[0x208] || Math.floor(partBytes.length / 65536);
    if (maxTrack < 1) maxTrack = 1;
    if (maxTrack > 255) maxTrack = 255;
  } else {
    maxTrack = fmt.sizes[0].tracks;
  }
  currentTracks = maxTrack;
  var total = 0;
  for (var t = 1; t <= maxTrack; t++) total += fmt.readTrackFree(partBytes, 0, t);
  currentFormat = savedFmt;
  currentTracks = savedTracks;

  // Sanity cap. Above the format's theoretical max the partition is not
  // a real filesystem regardless of what the DOS-version byte said.
  var theoreticalMax = meta.maxFree !== null ? meta.maxFree : (maxTrack * 256 - 64);
  if (total > theoreticalMax) return null;
  return total;
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

  // For DHDs, snapshot the HD-DOS shadow if this image carries one.
  // The captured bytes live only in the user's localStorage and are
  // re-used by createEmptyDhd to make subsequent "New CMD HD" images
  // bootable. We always overwrite the cached copy — the most recently
  // opened DHD wins.
  if (containerKey === 'dhd' && dhdHasDosShadow(buffer)) {
    var snap = extractDhdDosShadow(buffer);
    if (snap) saveDhdDosShadow(snap);
  }

  // currentFormat is set to the container alias so save-as picks the
  // right extension; the tab body shows the partition list instead of
  // a directory while cmdcPartitionIdx === -1.
  //
  // Null the IDE64 globals first — if the previous tab was an .hdd
  // they'd otherwise leak through (renderDisk happens to render CMD
  // correctly because the CMD branch runs first, but menu-state /
  // dispatch checks use isIde64ContainerView() and would mistake this
  // for an HDD tab).
  hddBuffer = null;
  hddFileName = null;
  hddBootInfo = null;
  hddPartitions = null;
  cfsPartitionIdx = -1;
  cfsDirLba = 0;
  cfsDirEntries = null;
  cfsDirStack = [];
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
      '<span class="dir-blocks dir-blocks-container">Size</span>' +
      '<span class="dir-name">Partition</span>' +
      '<span class="dir-type">Type</span>' +
      '<span class="dir-slot">#</span>' +
      '<span class="dir-ts">Start</span>' +
      '<span class="dir-addr"></span>' +
      '<span class="dir-icons"></span>' +
    '</div>' +
    '<div class="dir-listing">';

  // DHD-only: tint the SYSTEM row green when the image carries an HD-DOS
  // shadow, red when it doesn't. Hover for version info or install guidance.
  var dhdDosState = null; // { cls, title } when applicable
  if (cmdcContainerKey === 'dhd' && cmdcBuffer) {
    if (dhdHasDosShadow(cmdcBuffer)) {
      var ver = extractDhdDosVersion(cmdcBuffer);
      var label = 'HD-DOS';
      if (ver && ver.version) label += ' V' + ver.version;
      if (ver && ver.date) label += ' (' + ver.date + ')';
      dhdDosState = { cls: 'dhd-dos-present', title: label + ' — embedded in this image' };
    } else {
      dhdDosState = {
        cls: 'dhd-dos-missing',
        title: 'No HD-DOS present. Open a real .dhd that contains one to ' +
               'cache it locally, then use Disk → Disk Tools → Install ' +
               'HD-DOS to copy the cached firmware into this image.',
      };
    }
  }

  var openCount = 0;
  for (var i = 0; i < cmdcPartitions.length; i++) {
    var p = cmdcPartitions[i];
    var canOpen = p.type !== 0xFF; // SYSTEM is shown but not enterable
    if (canOpen) openCount++;
    var startHex = '$' + p.startByte.toString(16).toUpperCase().padStart(8, '0');
    var entryAbs = entryAbsForSlot(p.index);
    var extraCls = canOpen ? '' : ' deleted';
    var rowTitle = null;
    if (dhdDosState && p.type === 0xFF) {
      extraCls += ' ' + dhdDosState.cls;
      rowTitle = dhdDosState.title;
    }
    // The list shows the partition's declared size; free blocks live in
    // the dir footer when the user enters a partition. Tooltip shows
    // both numbers when we can compute the BAM free count.
    var freeForTooltip = computePartitionFreeBlocks(cmdcBuffer, p);
    if (!rowTitle) {
      rowTitle = (freeForTooltip === null)
        ? (p.sizeBlocks + ' blocks total')
        : (freeForTooltip + ' free of ' + p.sizeBlocks + ' blocks');
    }
    var extraAttrs = ' title="' + escHtml(rowTitle) + '"';
    // CMD blocks are 256 B each — pass that to formatPartitionSize so the
    // MiB / KiB conversion is correct (CFS uses 512 B sectors, but for
    // CMD-Native / 1541 / 71 / 81 partitions the on-disk block size is
    // always 256 bytes).
    var sizeStr = formatPartitionSize(p.sizeBlocks * 256, p.sizeBlocks);
    html +=
      '<div class="dir-entry' + extraCls + '" data-cmdc-part="' + i + '" data-offset="' + entryAbs + '"' + extraAttrs + '>' +
        '<span class="dir-grip"></span>' +
        '<span class="dir-blocks dir-blocks-container">' + sizeStr + '</span>' +
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
  { value: 'nat',  label: 'Native',       size: 4096, fixed: false },
  { value: '1541', label: '1541',         size: 683,  fixed: true },
  { value: '1571', label: '1571',         size: 1366, fixed: true },
  { value: '1581', label: '1581',         size: 3200, fixed: true },
];

// DNP format limit: 255 tracks (track count is a single byte) × 256
// sectors = 65,280 blocks (16 MiB) per partition.
var DNP_MAX_TRACKS = 255;
var DNP_MAX_BLOCKS = DNP_MAX_TRACKS * 256;
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

    // Dropdown of free slot numbers. Total count comes from the
    // descriptor's layout — 32 for RAMLink/FD, 255 for CMD HD.
    var occupied = {};
    for (var pi = 0; pi < cmdcPartitions.length; pi++) {
      occupied[cmdcPartitions[pi].index] = cmdcPartitions[pi];
    }
    var totalSlots = 0;
    if (ct && cmdcBuffer) {
      var lay = ct.getTableLayout(cmdcBuffer);
      for (var li = 0; li < lay.length; li++) totalSlots += lay[li].slots;
    }
    if (totalSlots === 0) totalSlots = 32; // safety fallback
    var slotSelect = document.createElement('select');
    slotSelect.className = 'modal-input';
    for (var s = 1; s < totalSlots; s++) {
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

    // Native is sized in 256-block steps up to min(DNP cap, free space).
    // 1541/71/81 are fixed; their slider is hidden in applyType().
    var freeSpace = (ct && cmdcBuffer)
        ? findCmdContainerFreeSpace(cmdcBuffer, cmdcContainerKey, cmdcPartitions)
        : { size: DNP_MAX_BLOCKS * 256 };
    var maxBlocksNative = Math.min(DNP_MAX_BLOCKS, Math.floor(freeSpace.size / 256));
    maxBlocksNative = Math.max(256, Math.floor(maxBlocksNative / 256) * 256);
    var defaultNative = Math.min(4096, maxBlocksNative);

    function formatBytes(blocks) {
      var bytes = blocks * 256;
      if (bytes >= 1024 * 1024) return (bytes / 1024 / 1024).toFixed(2) + ' MiB';
      return (bytes / 1024).toFixed(0) + ' KiB';
    }

    var sizeWrap = document.createElement('div');
    sizeWrap.style.display = 'flex';
    sizeWrap.style.flexDirection = 'column';
    sizeWrap.style.gap = '4px';

    var sliderRow = buildBlockSliderRow({
      min: 256, max: maxBlocksNative, step: 256, value: defaultNative,
      formatLabel: formatBytes,
    });

    var sizeFooter = document.createElement('div');
    sizeFooter.style.opacity = '0.55';
    sizeFooter.style.fontSize = '0.9em';

    sizeWrap.appendChild(sliderRow.row);
    sizeWrap.appendChild(sizeFooter);
    row('Size', sizeWrap);

    function refreshMaxLabel() {
      var t = currentType();
      if (t.fixed) {
        sizeFooter.textContent = 'fixed: ' + t.size + ' blocks (' + formatBytes(t.size) + ')';
      } else {
        sizeFooter.textContent = 'max ' + maxBlocksNative + ' blocks (' + formatBytes(maxBlocksNative) + ')';
      }
    }

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
      if (t.fixed) {
        sliderRow.slider.style.display = 'none';
        sliderRow.input.disabled = true;
        sliderRow.input.style.opacity = '0.5';
        sliderRow.input.value = String(t.size);
        sliderRow.readout.textContent = formatBytes(t.size);
      } else {
        sliderRow.slider.style.display = '';
        sliderRow.input.disabled = false;
        sliderRow.input.style.opacity = '';
        sliderRow.input.value = String(defaultNative);
        sliderRow.slider.value = String(defaultNative);
        sliderRow.readout.textContent = formatBytes(defaultNative);
      }
      refreshMaxLabel();
      // Only refresh the name field if the user hasn't customised it from
      // the previously-selected default.
      var prevDefaults = CMDC_TYPE_PRESETS.map(function(p) {
        return p.value === 'nat' ? 'NATIVE' : p.value;
      });
      if (prevDefaults.indexOf(nameInput.value) >= 0) {
        nameInput.value = (t.value === 'nat') ? 'NATIVE' : t.value;
      }
    }
    applyType();

    var footer = document.querySelector('#modal-overlay .modal-footer');
    footer.innerHTML = '';
    var done = false;
    function ok() {
      if (done) return;
      var t = currentType();
      // Native: getValue() clamps + snaps to a 256-block boundary.
      // 1541/71/81: trust the preset (their block counts aren't 256-aligned).
      var size = t.fixed ? t.size : sliderRow.getValue();
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

// Per-type recipe for building a fresh partition: which disk format to
// instantiate, the resulting partition type code, the byte offsets of
// the 16-byte disk name and every 2-byte disk ID inside the resulting
// filesystem, and an optional post-build patch. `tracks` is overridden
// to sizeBlocks/256 for the Native (DNP) case.
var CMDC_BUILD_RECIPES = {
  '1541': {
    fmtKey: 'd64', typeCode: 0x02, tracks: 35,
    nameOff: 0x16500 + 0x90,
    idOffs: [0x16500 + 0xA2],
  },
  '1571': {
    fmtKey: 'd71', typeCode: 0x03, tracks: 70,
    nameOff: 0x16500 + 0x90,
    idOffs: [0x16500 + 0xA2],
  },
  '1581': {
    fmtKey: 'd81', typeCode: 0x04, tracks: 80,
    nameOff: 0x61800 + 0x04,
    idOffs: [0x61800 + 0x16, 0x61900 + 0x04, 0x61A00 + 0x04],
    // CMD writes 0x00 at T40/S0 +0x03 in place of the standard 0xBB
    // inverted-DOS marker. Inert, but matches the canonical bytes.
    patch: function(buf) { new Uint8Array(buf)[0x61803] = 0x00; },
  },
  'nat': {
    fmtKey: 'dnp', typeCode: 0x01, tracks: null, // derived from sizeBlocks
    nameOff: 0x100 + 0x04,
    idOffs: [0x100 + 0x16, 0x200 + 0x04],
  },
};

// Build a fresh partition's filesystem bytes. `createEmptyDisk`
// side-effects currentFormat/currentTracks, so they're saved + restored
// around the call. The container's `partitionIdBytes` are stamped at
// every ID location; the user-supplied name is uppercased + 0xA0-padded
// at the disk-header position. Returns { buffer, typeCode }.
function buildPartitionFilesystem(typeChoice, sizeBlocks, name) {
  var recipe = CMDC_BUILD_RECIPES[typeChoice] || CMDC_BUILD_RECIPES['nat'];
  var savedFmt = currentFormat, savedTracks = currentTracks;
  var tracks = recipe.tracks !== null ? recipe.tracks : sizeBlocks / 256;
  var initBuf = createEmptyDisk(recipe.fmtKey, tracks);
  currentFormat = savedFmt;
  currentTracks = savedTracks;
  if (recipe.patch) recipe.patch(initBuf);

  var view = new Uint8Array(initBuf);
  var upper = (name || '').toUpperCase();
  for (var n = 0; n < 16; n++) {
    view[recipe.nameOff + n] = n < upper.length ? upper.charCodeAt(n) : 0xA0;
  }
  var ctForId = CMD_CONTAINERS[cmdcContainerKey];
  var idBytes = (ctForId && ctForId.partitionIdBytes) ? ctForId.partitionIdBytes : [0x52, 0x4C];
  for (var ii = 0; ii < recipe.idOffs.length; ii++) {
    view[recipe.idOffs[ii]] = idBytes[0];
    view[recipe.idOffs[ii] + 1] = idBytes[1];
  }
  return { buffer: initBuf, typeCode: recipe.typeCode };
}

// Total user-slot count (descriptor capacity minus the SYSTEM slot).
// 31 for RAMLink/FD, 254 for CMD HD.
function _cmdcUserSlotCount() {
  var ct = CMD_CONTAINERS[cmdcContainerKey];
  if (!ct || !cmdcBuffer) return 0;
  var total = 0;
  var lay = ct.getTableLayout(cmdcBuffer);
  for (var i = 0; i < lay.length; i++) total += lay[i].slots;
  return Math.max(0, total - 1);
}

// Splice a fresh partition's bytes into the container at `start`, growing
// the buffer if needed, then write its table entry. Used by both the
// "New Partition" picker path and the .dnp/.d64/.d71/.d81 import path.
function _cmdcInsertPartition(slot, typeCode, name, partBytes, start, sizeBlocks) {
  var sizeBytes = sizeBlocks * 256;
  pushUndo();
  if (start + sizeBytes > cmdcBuffer.byteLength) {
    cmdcBuffer = growCmdContainer(cmdcBuffer, start + sizeBytes);
    // In the partition-list view currentBuffer === cmdcBuffer; keep
    // them aliased so saveActiveTab() persists the grown reference.
    currentBuffer = cmdcBuffer;
  }
  var dst = new Uint8Array(cmdcBuffer);
  var lim = Math.min(partBytes.length, sizeBytes);
  dst.set(partBytes.subarray(0, lim), start);
  if (lim < sizeBytes) dst.fill(0, start + lim, start + sizeBytes);
  writeCmdContainerPartitionEntry(cmdcBuffer, cmdcContainerKey, slot, typeCode, name, start, sizeBlocks);
  cmdcPartitions = readCmdContainerPartitions(cmdcBuffer, cmdcContainerKey).partitions;
  tabDirty = true;
  refreshCmdContainerView();
}

async function addCmdContainerPartition() {
  if (!isCmdContainerListView()) return;
  if (findCmdContainerEmptySlot(cmdcBuffer, cmdcContainerKey) < 0) {
    showModal('Container', ['No free partition slot — all ' + _cmdcUserSlotCount() + ' user slots are allocated.']);
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
  _cmdcInsertPartition(picked.slot, built.typeCode, picked.name, new Uint8Array(built.buffer), free.start, picked.size);
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
  var sizeStr = partitionSizeInMib
    ? formatPartitionSize(part.sizeBlocks * 256, part.sizeBlocks)
    : (part.sizeBlocks + ' blocks');
  var choice = await showChoiceModal(
    'Delete Partition',
    'Delete partition "' + petsciiToReadable(part.name) + '" (' + part.typeName + ', ' + sizeStr + ')?',
    [
      { label: 'Cancel', value: false, secondary: true },
      { label: 'Delete', value: true }
    ]
  );
  if (!choice) return;

  pushUndo();
  clearCmdContainerPartitionEntry(cmdcBuffer, cmdcContainerKey, part.index);
  // Grow-as-needed containers (DHD) shrink the file once the partition
  // is gone; fixed-size containers (RAMLink, FD) keep their byte length.
  var shrunk = compactCmdContainer(cmdcBuffer, cmdcContainerKey);
  if (shrunk !== cmdcBuffer) {
    cmdcBuffer = shrunk;
    currentBuffer = cmdcBuffer;
  }
  cmdcPartitions = readCmdContainerPartitions(cmdcBuffer, cmdcContainerKey).partitions;
  tabDirty = true;
  refreshCmdContainerView();
}

document.getElementById('opt-cmdc-new-partition').addEventListener('click', function(e) {
  e.stopPropagation();
  closeMenus();
  if (this.classList.contains('disabled')) return;
  // Same menu item serves both CMD containers and IDE64 .hdd; dispatch
  // based on which container view is active.
  if (typeof isIde64ContainerView === 'function' && isIde64ContainerView() && cfsPartitionIdx < 0 && !isCmdContainerListView()) {
    showHddPartitionEditor(-1);
  } else {
    addCmdContainerPartition();
  }
});

document.getElementById('opt-cmdc-rename-partition').addEventListener('click', function(e) {
  e.stopPropagation();
  closeMenus();
  if (this.classList.contains('disabled')) return;
  if (typeof isIde64ContainerView === 'function' && isIde64ContainerView() && cfsPartitionIdx < 0 && !isCmdContainerListView()) {
    var selEl = document.querySelector('.dir-entry.selected[data-hdd-part]');
    if (selEl) startInlineRenameHddPartition(selEl);
  } else {
    renameCmdContainerPartition();
  }
});

document.getElementById('opt-cmdc-delete-partition').addEventListener('click', function(e) {
  e.stopPropagation();
  closeMenus();
  if (this.classList.contains('disabled')) return;
  if (typeof isIde64ContainerView === 'function' && isIde64ContainerView() && cfsPartitionIdx < 0 && !isCmdContainerListView()) {
    var selEl2 = document.querySelector('.dir-entry.selected[data-hdd-part]');
    var idx2 = selEl2 ? parseInt(selEl2.dataset.hddPart, 10) : -1;
    if (idx2 >= 0) confirmHddPartitionDelete(idx2);
  } else {
    deleteCmdContainerPartition();
  }
});

document.getElementById('opt-hdd-partition-attrs').addEventListener('click', function(e) {
  e.stopPropagation();
  closeMenus();
  if (this.classList.contains('disabled')) return;
  var selEl = document.querySelector('.dir-entry.selected[data-hdd-part]');
  var idx = selEl ? parseInt(selEl.dataset.hddPart, 10) : -1;
  if (idx >= 0) showHddPartitionAttrsDialog(idx);
});

// Restore a soft-deleted partition. Enabled only when the selected row's
// p.deleted is true; updateEntryMenuState handles the visibility toggle.
document.getElementById('opt-hdd-partition-restore').addEventListener('click', function(e) {
  e.stopPropagation();
  closeMenus();
  if (this.classList.contains('disabled')) return;
  var selEl = document.querySelector('.dir-entry.selected[data-hdd-part]');
  var idx = selEl ? parseInt(selEl.dataset.hddPart, 10) : -1;
  if (idx >= 0) confirmHddPartitionRestore(idx);
});

// Rename the .hdd's global disk label (boot sector $20..$2F). cfsfdisk's
// "g" command. Visible only on the .hdd partition-list view.
document.getElementById('opt-hdd-rename-disk').addEventListener('click', function(e) {
  e.stopPropagation();
  closeMenus();
  if (this.classList.contains('disabled')) return;
  showHddRenameDiskDialog();
});

// Emergency recovery: copy the backup partition table at boot $1C's LBA
// over the primary at LBA 1. cfsfdisk's "u" command. Visible only on the
// .hdd partition-list view.
document.getElementById('opt-hdd-restore-backup-pt').addEventListener('click', function(e) {
  e.stopPropagation();
  closeMenus();
  if (this.classList.contains('disabled')) return;
  confirmHddLoadBackupPartitionTable();
});

// Type code → file extension + accepted import sizes. `sizes: null`
// means variable-size (DNP — any 64 KiB multiple up to 16 MiB).
var CMDC_IMPORT_EXPORT_TYPES = {
  0x01: { ext: '.dnp', label: 'Native (DNP)', sizes: null },
  0x02: { ext: '.d64', label: '1541',         sizes: [174848, 196608] },
  0x03: { ext: '.d71', label: '1571',         sizes: [349696] },
  0x04: { ext: '.d81', label: '1581',         sizes: [819200] },
};

function _cmdcSanitiseFilename(name, fallback) {
  var clean = '';
  for (var i = 0; i < name.length && clean.length < 16; i++) {
    var cc = name.charCodeAt(i);
    if (cc >= 0xE000 && cc < 0xE200) cc &= 0xFF;
    if ((cc >= 0x30 && cc <= 0x39) || (cc >= 0x41 && cc <= 0x5A) || (cc >= 0x61 && cc <= 0x7A)) {
      clean += String.fromCharCode(cc).toLowerCase();
    } else if (cc === 0x20 || cc === 0x2D || cc === 0x5F) {
      clean += '_';
    }
  }
  return clean || fallback;
}

// Download the selected partition as a standalone disk image. The
// extension comes from the partition's type code; the bytes are an
// exact copy of the container slice and re-open as a normal disk.
function exportCmdContainerPartition() {
  if (!isCmdContainerListView()) return;
  var listSelEl = document.querySelector('.dir-entry.selected[data-cmdc-part]');
  if (!listSelEl) { showModal('Container', ['Select a partition first.']); return; }
  var idx = parseInt(listSelEl.dataset.cmdcPart, 10);
  var part = cmdcPartitions[idx];
  if (!part) return;
  var meta = CMDC_IMPORT_EXPORT_TYPES[part.type];
  if (!meta) {
    showModal('Export Partition', [
      'Partition type ' + part.typeName + ' cannot be exported as a standalone disk image.',
    ]);
    return;
  }
  var slice = extractCmdContainerPartition(cmdcBuffer, part);
  if (!slice) {
    showModal('Export Partition', ['Failed to extract partition data.']);
    return;
  }
  var clean = _cmdcSanitiseFilename(part.name, 'partition_' + part.index);
  downloadD64(slice, clean + meta.ext);
}

// Import a standalone disk image as a new partition. Type is detected
// from the file extension, size validated against that type's canonical
// disk size(s). The file's bytes are spliced in verbatim.
function importCmdContainerPartition() {
  if (!isCmdContainerListView()) return;
  if (findCmdContainerEmptySlot(cmdcBuffer, cmdcContainerKey) < 0) {
    showModal('Container', ['No free partition slot available.']);
    return;
  }
  var picker = document.createElement('input');
  picker.type = 'file';
  picker.accept = '.dnp,.d64,.d71,.d81';
  picker.style.display = 'none';
  picker.addEventListener('change', async function() {
    var f = picker.files && picker.files[0];
    if (!f) return;
    var fileName = f.name || '';
    var lower = fileName.toLowerCase();

    // Detect partition type from extension.
    var typeCode = null;
    for (var tc in CMDC_IMPORT_EXPORT_TYPES) {
      if (lower.endsWith(CMDC_IMPORT_EXPORT_TYPES[tc].ext)) { typeCode = parseInt(tc, 10); break; }
    }
    if (typeCode === null) {
      showModal('Import Partition', [
        'Unrecognised file extension. Supported types:',
        '  .dnp (Native), .d64 (1541), .d71 (1571), .d81 (1581).'
      ]);
      return;
    }
    var meta = CMDC_IMPORT_EXPORT_TYPES[typeCode];

    var buf = await f.arrayBuffer();
    // Size validation per type.
    var sizeOk = false;
    if (meta.sizes === null) {
      // Native (DNP): any non-zero multiple of 64 KiB up to 16 MiB.
      sizeOk = (buf.byteLength > 0 && buf.byteLength % 65536 === 0 && buf.byteLength <= 255 * 65536);
    } else {
      sizeOk = (meta.sizes.indexOf(buf.byteLength) >= 0);
    }
    if (!sizeOk) {
      var expected = meta.sizes === null
        ? 'a non-zero multiple of 64 KiB up to 16 MiB'
        : meta.sizes.map(function(n) { return n + ' bytes'; }).join(' or ');
      showModal('Import Partition', [
        'File size doesn’t match a valid ' + meta.label + ' image.',
        'Expected: ' + expected + '.',
        'Got: ' + buf.byteLength + ' bytes.'
      ]);
      return;
    }

    var slot = findCmdContainerEmptySlot(cmdcBuffer, cmdcContainerKey);
    var free = findCmdContainerFreeSpace(cmdcBuffer, cmdcContainerKey, cmdcPartitions);
    if (buf.byteLength > free.size) {
      showModal('Import Partition', [
        'Not enough free space in the container.',
        'File size: ' + Math.round(buf.byteLength / 1024) + ' KiB.',
        'Available: ' + Math.round(free.size / 1024) + ' KiB.'
      ]);
      return;
    }

    // Partition-table entry name from the filename (sans extension).
    // The file's internal disk-header name is left untouched.
    var baseName = fileName.replace(/\.[a-zA-Z0-9]+$/, '');
    var partName = baseName.toUpperCase().slice(0, 16) || ('IMPORTED ' + slot);
    _cmdcInsertPartition(slot, typeCode, partName, new Uint8Array(buf), free.start, buf.byteLength / 256);
  });
  document.body.appendChild(picker);
  picker.click();
  setTimeout(function() { if (picker.parentNode) picker.parentNode.removeChild(picker); }, 0);
}

document.getElementById('opt-cmdc-export-partition').addEventListener('click', function(e) {
  e.stopPropagation();
  closeMenus();
  if (this.classList.contains('disabled')) return;
  exportCmdContainerPartition();
});

document.getElementById('opt-cmdc-import-partition').addEventListener('click', function(e) {
  e.stopPropagation();
  closeMenus();
  if (this.classList.contains('disabled')) return;
  importCmdContainerPartition();
});

// Install the cached HD-DOS shadow into the active DHD. The shadow is
// captured the first time the user opens any DHD that carries one.
function installDhdDosIntoActive() {
  if (cmdcContainerKey !== 'dhd' || !cmdcBuffer) return;
  var shadow = loadDhdDosShadow();
  if (!shadow) {
    showModal('Install HD-DOS', [
      'No HD-DOS shadow has been captured yet.',
      'Open a real CMD HD image (.dhd) that contains the firmware once — ' +
      'the bytes are then cached locally and re-used here and for new images.',
    ]);
    return;
  }
  pushUndo();
  installDhdDosShadow(cmdcBuffer, shadow);
  tabDirty = true;
  refreshCmdContainerView();
}

document.getElementById('opt-dhd-install-dos').addEventListener('click', function(e) {
  e.stopPropagation();
  closeMenus();
  if (this.classList.contains('disabled')) return;
  installDhdDosIntoActive();
});
