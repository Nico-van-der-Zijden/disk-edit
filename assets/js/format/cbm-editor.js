// ── Version ───────────────────────────────────────────────────────────
var APP_VERSION = { major: 1, minor: 5, build: 2 };
var APP_VERSION_STRING = APP_VERSION.major + '.' + APP_VERSION.minor + '.' + APP_VERSION.build;

// ── Current disk state ─────────────────────────────────────────────────
var currentBuffer = null;
var currentFileName = null;
var showDeleted = localStorage.getItem('cbm-showDeleted') !== 'false';
var selectedEntryIndex = -1;
var selectedEntries = []; // multi-select: array of entryOff values
var showAddresses = localStorage.getItem('cbm-showAddresses') !== 'false';
var showTrackSector = localStorage.getItem('cbm-showTrackSector') !== 'false';
var hexColoring = localStorage.getItem('cbm-hexColoring') || 'none'; // none | hexyl | rgb | nybble
// Container partition sizes in MiB / KiB rather than blocks (default on:
// native tools size them in MiB, and block counts outgrow the column).
var partitionSizeInMib = localStorage.getItem('cbm-partitionSizeMib') !== 'false';
function formatPartitionSize(sizeBytes, sizeBlocks) {
  if (!partitionSizeInMib) {
    if (sizeBlocks == null) return '';
    return String(sizeBlocks);
  }
  if (sizeBytes == null) return '';
  var mib = sizeBytes / (1024 * 1024);
  if (mib >= 1) return (mib < 10 ? mib.toFixed(2) : Math.round(mib).toString()) + ' MiB';
  return (sizeBytes / 1024).toFixed(1) + ' KiB';
}
function setHexColoring(name) {
  hexColoring = name;
  localStorage.setItem('cbm-hexColoring', name);
  document.querySelectorAll('.hex-editor').forEach(function(el) {
    el.setAttribute('data-coloring', name);
  });
}
// Per-byte hue rules for the "rgb" hex colouring; reversed bytes $80-$FF
// get the hue as background instead.
(function injectHexColoringRgbRules() {
  if (typeof document === 'undefined' || !document.head) return;
  if (document.getElementById('hex-coloring-rgb')) return;
  var dark = '', light = '';
  for (var i = 0; i < 256; i++) {
    var hex = i.toString(16).toUpperCase().padStart(2, '0');
    var hue = (i / 256 * 360).toFixed(1);
    var darkColor  = 'oklch(75% 0.18 ' + hue + ')';
    var lightColor = 'oklch(55% 0.18 ' + hue + ')';
    dark  += '.hex-editor[data-coloring="rgb"] [data-byte="' + hex + '"]{color:' + darkColor + ';}';
    light += '[data-theme="light"] .hex-editor[data-coloring="rgb"] [data-byte="' + hex + '"]{color:' + lightColor + ';}';
    if (i >= 0x80) {
      dark  += '.hex-editor[data-coloring="rgb"] .hex-char.petscii-rev[data-byte="' + hex + '"]{background:' + darkColor + ' !important;}';
      light += '[data-theme="light"] .hex-editor[data-coloring="rgb"] .hex-char.petscii-rev[data-byte="' + hex + '"]{background:' + lightColor + ' !important;}';
    }
  }
  var style = document.createElement('style');
  style.id = 'hex-coloring-rgb';
  style.textContent = dark + light;
  document.head.appendChild(style);
})();
var currentPartition = null; // null = root, or { entryOff, startTrack, partSize, name }

// ── CMD container state (RAMLink, D1M/D2M/D4M, …) ───────────────────
// cmdcBuffer holds the whole container. cmdcPartitionIdx -1 = partition
// list (currentBuffer is the container); otherwise currentBuffer is that
// partition's slice, and edits are spliced back into cmdcBuffer
// on exit / save.
var cmdcBuffer = null;          // full container ArrayBuffer or null
var cmdcFileName = null;        // original container file name
var cmdcPartitions = null;      // parsed partition list (from readCmdContainerPartitions)
var cmdcPartitionIdx = -1;      // -1 = partition-list view, else index into cmdcPartitions
var cmdcContainerKey = null;    // 'ramlink' / 'd1m' / 'd2m' / 'd4m' / 'dhd' — picks the CMD_CONTAINERS descriptor

// IDE64 .hdd container state, parallel to the CMD container globals.
var hddBuffer = null;
var hddFileName = null;
var hddBootInfo = null;
var hddPartitions = null;

// CFS view: cfsPartitionIdx >= 0 shows that partition's directory at
// cfsDirLba; cfsDirStack is the breadcrumb of parent dirs.
var cfsPartitionIdx = -1;
var cfsDirLba = 0;
var cfsDirEntries = null;
var cfsDirStack = []; // array of { dirLba, name, enteredAs }
var cfsEnteredAs = null; // parent entry's name for the current dir (may differ from its self-ref)

// On a CMD container's partition list, where disk-edit operations don't apply.
function isCmdContainerListView() {
  return !!cmdcBuffer && cmdcPartitions && cmdcPartitionIdx === -1;
}

// Reset the CMD and IDE64 container globals; every non-container load /
// new-tab path calls this, since createTab / loadTab don't touch them.
function clearCmdContainerState() {
  cmdcBuffer = null;
  cmdcFileName = null;
  cmdcPartitions = null;
  cmdcPartitionIdx = -1;
  cmdcContainerKey = null;
  hddBuffer = null;
  hddFileName = null;
  hddBootInfo = null;
  hddPartitions = null;
  cfsPartitionIdx = -1;
  cfsDirLba = 0;
  cfsDirEntries = null;
  cfsDirStack = [];
}
// Per-track physical sector layout of a tab opened from .g64/.nib; null otherwise.
var currentG64Layout = null;
var clipboard = []; // array of { typeIdx, nameBytes, geosBytes, geosInfoBlock, data, vlirRecords }
                    // data is null for GEOS VLIR files; vlirRecords is null for everything else.
                    // CFS dir-tree entries carry { kind: 'cfs-dir-tree', nameBytes, tree, skippedLnks }
                    // — `tree` matches cfsCollectDirTree's output shape.
var dirInterleave = 3;   // directory sector interleave
var fileInterleave = 10; // file data sector interleave

// ── DiskCtx: explicit disk context ───────────────────────────────────
// { buffer, partition, format, tracks, dirInterleave, fileInterleave } —
// lets helpers work on a view other than the current one (e.g. pasting
// into another partition). getCurrentCtx() snapshots the globals.
function getCurrentCtx() {
  return {
    buffer: typeof currentBuffer !== 'undefined' ? currentBuffer : null,
    partition: typeof currentPartition !== 'undefined' ? currentPartition : null,
    format: typeof currentFormat !== 'undefined' ? currentFormat : null,
    tracks: typeof currentTracks !== 'undefined' ? currentTracks : 0,
    dirInterleave: dirInterleave,
    fileInterleave: fileInterleave,
  };
}

// Run a synchronous `fn` with the globals set to `ctx`, restoring them
// afterwards; for helpers that still read the globals.
function withDiskCtx(ctx, fn) {
  var saved = getCurrentCtx();
  try {
    if (typeof currentBuffer !== 'undefined') currentBuffer = ctx.buffer;
    if (typeof currentPartition !== 'undefined') currentPartition = ctx.partition;
    if (typeof currentFormat !== 'undefined') currentFormat = ctx.format;
    if (typeof currentTracks !== 'undefined') currentTracks = ctx.tracks;
    dirInterleave = ctx.dirInterleave;
    fileInterleave = ctx.fileInterleave;
    return fn();
  } finally {
    currentBuffer = saved.buffer;
    currentPartition = saved.partition;
    currentFormat = saved.format;
    currentTracks = saved.tracks;
    dirInterleave = saved.dirInterleave;
    fileInterleave = saved.fileInterleave;
  }
}

// ── Undo system ──────────────────────────────────────────────────────
// The tab is "clean" (tabDirty=false) when undoStack.length === cleanStackLength.
// Set by markClean() on load / save; read by popUndo() to restore clean state
// when the user undoes back past all edits made since the last save.
// cleanStackLength = -1 means "clean state no longer reachable" (an older entry
// fell off the end when we hit MAX_UNDO).
var undoStack = [];
var redoStack = [];
var MAX_UNDO = 20;
var tabDirty = false;
var cleanStackLength = 0;

// The disk is about to change (or just did, for undo/redo): an open
// detail-pane view redraws after the listing does.
function notifyDiskChange() {
  if (typeof markPaneStale === 'function') markPaneStale();
}

// `snapshot`: a pre-change copy the caller already took; default copies currentBuffer.
function pushUndo(snapshot) {
  notifyDiskChange();
  if (!snapshot) {
    if (!currentBuffer) return;
    snapshot = currentBuffer.slice(0);
  }
  inheritSpeederBamHint(currentBuffer, snapshot);
  undoStack.push(snapshot);
  if (undoStack.length > MAX_UNDO) {
    undoStack.shift();
    if (cleanStackLength > 0) cleanStackLength--;
    else if (cleanStackLength === 0) cleanStackLength = -1;
  }
  // Any new edit invalidates the redo history.
  if (redoStack.length) redoStack = [];
  if (!tabDirty) {
    tabDirty = true;
    if (typeof renderTabs === 'function') renderTabs();
  }
}

function popUndo() {
  if (undoStack.length === 0 || !currentBuffer) return false;
  notifyDiskChange();
  var redoSnap = currentBuffer.slice(0);
  inheritSpeederBamHint(currentBuffer, redoSnap);
  redoStack.push(redoSnap);
  if (redoStack.length > MAX_UNDO) redoStack.shift();
  currentBuffer = undoStack.pop();
  var tab = getActiveTab();
  if (tab) tab.buffer = currentBuffer;
  var shouldBeDirty = (undoStack.length !== cleanStackLength);
  if (tabDirty !== shouldBeDirty) {
    tabDirty = shouldBeDirty;
    if (typeof renderTabs === 'function') renderTabs();
  }
  return true;
}

function popRedo() {
  if (redoStack.length === 0 || !currentBuffer) return false;
  notifyDiskChange();
  var undoSnap = currentBuffer.slice(0);
  inheritSpeederBamHint(currentBuffer, undoSnap);
  undoStack.push(undoSnap);
  if (undoStack.length > MAX_UNDO) {
    undoStack.shift();
    if (cleanStackLength > 0) cleanStackLength--;
    else if (cleanStackLength === 0) cleanStackLength = -1;
  }
  currentBuffer = redoStack.pop();
  var tab = getActiveTab();
  if (tab) tab.buffer = currentBuffer;
  var shouldBeDirty = (undoStack.length !== cleanStackLength);
  if (tabDirty !== shouldBeDirty) {
    tabDirty = shouldBeDirty;
    if (typeof renderTabs === 'function') renderTabs();
  }
  return true;
}

// Rolls back a failed operation to its pushUndo snapshot. Unlike popUndo
// it leaves no redo step, and it keeps the container views' buffers
// pointing at the restored buffer so a batch can carry on.
function discardUndo() {
  if (undoStack.length === 0) return false;
  notifyDiskChange();
  var old = currentBuffer;
  currentBuffer = undoStack.pop();
  if (hddBuffer === old) hddBuffer = currentBuffer;
  if (cmdcBuffer === old) cmdcBuffer = currentBuffer;
  var tab = getActiveTab();
  if (tab) tab.buffer = currentBuffer;
  var shouldBeDirty = (undoStack.length !== cleanStackLength);
  if (tabDirty !== shouldBeDirty) {
    tabDirty = shouldBeDirty;
    if (typeof renderTabs === 'function') renderTabs();
  }
  return true;
}

function clearUndo() { undoStack = []; redoStack = []; cleanStackLength = 0; }

function markClean() {
  cleanStackLength = undoStack.length;
  tabDirty = false;
}

// ── Tab management ────────────────────────────────────────────────────
var tabs = [];        // array of { id, name, buffer, fileName, format, tracks, partition, selectedEntry }
var activeTabId = null;
var nextTabId = 1;
var newDiskCount = 0;

function createTab(name, buffer, fileName) {
  var tab = {
    id: nextTabId++,
    name: name,
    buffer: buffer,
    fileName: fileName,
    format: currentFormat,
    tracks: currentTracks,
    partition: null,
    selectedEntry: -1,
    undoStack: [],
    redoStack: [],
    cleanStackLength: 0,
    dirty: false,
    cmdFdBuffer: null,
    cmdFdFileName: null,
    cmdFdPartOffset: -1,
    cmdFdPartSize: -1,
    cmdcBuffer: null,
    cmdcFileName: null,
    cmdcPartitions: null,
    cmdcPartitionIdx: -1,
    cmdcContainerKey: null,
    hddBuffer: null,
    hddFileName: null,
    hddBootInfo: null,
    hddPartitions: null,
    cfsPartitionIdx: -1,
    cfsDirLba: 0,
    cfsDirEntries: null,
    cfsDirStack: [],
    g64Layout: currentG64Layout
  };
  tabs.push(tab);
  return tab;
}

function saveActiveTab() {
  if (activeTabId === null) return;
  var tab = tabs.find(function(t) { return t.id === activeTabId; });
  if (!tab) return;
  tab.buffer = currentBuffer;
  tab.fileName = currentFileName;
  tab.format = currentFormat;
  tab.tracks = currentTracks;
  tab.partition = currentPartition;
  tab.selectedEntry = selectedEntryIndex;
  tab.undoStack = undoStack;
  tab.redoStack = redoStack;
  tab.cleanStackLength = cleanStackLength;
  tab.dirty = tabDirty;
  tab.tapeEntries = parsedT64Entries;
  tab.tapEntries = parsedTAPEntries;
  tab.tapeDir = parsedTapeDir;
  tab.cmdcBuffer = cmdcBuffer;
  tab.cmdcFileName = cmdcFileName;
  tab.cmdcPartitions = cmdcPartitions;
  tab.cmdcPartitionIdx = cmdcPartitionIdx;
  tab.cmdcContainerKey = cmdcContainerKey;
  tab.hddBuffer = hddBuffer;
  tab.hddFileName = hddFileName;
  tab.hddBootInfo = hddBootInfo;
  tab.hddPartitions = hddPartitions;
  tab.cfsPartitionIdx = cfsPartitionIdx;
  tab.cfsDirLba = cfsDirLba;
  tab.cfsDirEntries = cfsDirEntries;
  tab.cfsDirStack = cfsDirStack.slice();
  tab.g64Layout = currentG64Layout;
}

function loadTab(tab) {
  currentBuffer = tab.buffer;
  currentFileName = tab.fileName;
  currentFormat = tab.format;
  currentTracks = tab.tracks;
  currentPartition = tab.partition;
  selectedEntryIndex = tab.selectedEntry;
  undoStack = tab.undoStack || [];
  redoStack = tab.redoStack || [];
  cleanStackLength = tab.cleanStackLength || 0;
  tabDirty = tab.dirty || false;
  parsedT64Entries = tab.tapeEntries || null;
  parsedTAPEntries = tab.tapEntries || null;
  parsedTapeDir = tab.tapeDir || null;
  cmdcBuffer = tab.cmdcBuffer || null;
  cmdcFileName = tab.cmdcFileName || null;
  cmdcPartitions = tab.cmdcPartitions || null;
  cmdcPartitionIdx = (typeof tab.cmdcPartitionIdx === 'number') ? tab.cmdcPartitionIdx : -1;
  cmdcContainerKey = tab.cmdcContainerKey || null;
  hddBuffer = tab.hddBuffer || null;
  hddFileName = tab.hddFileName || null;
  hddBootInfo = tab.hddBootInfo || null;
  hddPartitions = tab.hddPartitions || null;
  cfsPartitionIdx = (typeof tab.cfsPartitionIdx === 'number') ? tab.cfsPartitionIdx : -1;
  cfsDirLba = tab.cfsDirLba || 0;
  cfsDirEntries = tab.cfsDirEntries || null;
  cfsDirStack = (tab.cfsDirStack && tab.cfsDirStack.slice) ? tab.cfsDirStack.slice() : [];
  currentG64Layout = tab.g64Layout || null;
  activeTabId = tab.id;
}

function switchToTab(tabId) {
  if (tabId === activeTabId) return;
  saveActiveTab();
  var tab = tabs.find(function(t) { return t.id === tabId; });
  if (!tab) return;
  loadTab(tab);
  var info = parseCurrentDir(currentBuffer);
  renderDisk(info);
  renderTabs();
  updateMenuState();
  updateEntryMenuState();
}

function closeTab(tabId) {
  var idx = tabs.findIndex(function(t) { return t.id === tabId; });
  if (idx < 0) return;
  tabs.splice(idx, 1);

  if (tabs.length === 0) {
    resetNoTabState();
    showEmptyState();
    renderTabs();
    updateMenuState();
    updateEntryMenuState();
    return;
  }

  // Switch to adjacent tab
  var newIdx = Math.min(idx, tabs.length - 1);
  loadTab(tabs[newIdx]);
  var info = parseCurrentDir(currentBuffer);
  renderDisk(info);
  renderTabs();
  updateMenuState();
  updateEntryMenuState();
}

// Globals for "no tab open" (last tab closed / Close All).
function resetNoTabState() {
  activeTabId = null;
  currentBuffer = null;
  currentFileName = null;
  selectedEntryIndex = -1;
  currentPartition = null;
  currentG64Layout = null;
  tabDirty = false;
  clearCmdContainerState();
  clearUndo();
}

function getActiveTab() {
  if (activeTabId === null) return null;
  return tabs.find(function(t) { return t.id === activeTabId; });
}

function isTabDirty(tab) {
  if (!tab) return false;
  if (tab.id === activeTabId) return tabDirty;
  return !!tab.dirty;
}

function anyDirtyTab() {
  return tabs.some(isTabDirty);
}

function updateTabName() {
  var tab = getActiveTab();
  if (!tab) return;
  tab.fileName = currentFileName;
  if (currentFileName) {
    tab.name = currentFileName;
  }
  renderTabs();
}

// ── BAM integrity check (read-only, doesn't modify disk) ─────────────
// Inside a D81 sub-partition this checks the partition against its own
// BAM; a DNP subdir view checks the whole image (one BAM for all dirs).
/** @param {ArrayBuffer} buffer @returns {BAMIntegrityResult} */
function checkBAMIntegrity(buffer, ctx) {
  if (ctx.partition && ctx.partition.dnpDir) ctx = Object.assign({}, ctx, { partition: null });
  var data = new Uint8Array(buffer);
  var fmt = ctx.format;
  var part = ctx.partition;
  var dirCtx = getDirContext(ctx);
  var bamOff = dirCtx.bamOff;
  var bamTracks = fmt.bamTracksRange(ctx.tracks);
  var sysTrack = part ? part.startTrack : fmt.dirTrack;

  var sectorOwner = {};

  // Walk a directory chain, recursing into linked subdirs.
  function walkIntegrityDir(dirT, dirS, parentName) {
    var dirVisited = {};
    while (dirT !== 0 && isValidChainLink(dirT, dirS, ctx)) {
      var dk = dirT + ':' + dirS;
      if (dirVisited[dk]) break;
      dirVisited[dk] = true;
      sectorOwner[dk] = parentName || 'Directory';
      var doff = sectorOffset(dirT, dirS, ctx);
      if (doff < 0) break;

      for (var i = 0; i < fmt.entriesPerSector; i++) {
        var entOff = doff + i * fmt.entrySize;
        var tb = data[entOff + DIRENT_TYPE];
        var typeIdx = tb & 0x07;
        var closed = (tb & 0x80) !== 0;
        if (typeIdx === 0 && !closed) continue;
        var eName = readPetsciiString(data, entOff + DIRENT_NAME, 16);
        if (!eName.trim() && typeIdx === 0) continue;
        var et = data[entOff + DIRENT_TRACK], es = data[entOff + DIRENT_SECTOR];
        var ownerName = eName || '?';

        if (fmt.subdirLinked && typeIdx === fmt.subdirType && closed) {
          sectorOwner[et + ':' + es] = ownerName;
          var hOff = sectorOffset(et, es, ctx);
          if (hOff >= 0) walkIntegrityDir(data[hOff], data[hOff + 1], ownerName);
          continue;
        }

        if (!fmt.subdirLinked && typeIdx === fmt.subdirType && closed) {
          var partTracks = Math.floor(direntBlocks(data, entOff) / fmt.partitionSpt);
          for (var pt = et; pt < et + partTracks && pt <= ctx.tracks; pt++) {
            var pspt = fmt.sectorsPerTrack(pt);
            for (var ps = 0; ps < pspt; ps++) sectorOwner[pt + ':' + ps] = ownerName;
          }
          continue;
        }

        if (closed) {
          forEachFileSector(data, entOff, function(t, s) {
            sectorOwner[t + ':' + s] = ownerName;
          }, ctx);
        }
      }

      dirT = data[doff]; dirS = data[doff + 1];
    }
  }

  walkIntegrityDir(dirCtx.dirTrack, dirCtx.dirSector, 'Directory');

  // System sectors are owned, except "BAM-omitted" ones: protected from
  // allocation but legitimately free in the BAM (CMD FD system partition).
  if (part) {
    for (var ss = 0; ss < fmt.partitionDirSector; ss++) sectorOwner[part.startTrack + ':' + ss] = 'System';
  } else {
    for (var pst = 1; pst <= ctx.tracks; pst++) {
      if (pst === fmt.dirTrack) continue;
      var protSecs = fmt.getProtectedSectors(pst);
      var bamOmitted = fmt.getBamOmittedSectors ? fmt.getBamOmittedSectors(pst) : [];
      for (var psi2 = 0; psi2 < protSecs.length; psi2++) {
        if (bamOmitted.indexOf(protSecs[psi2]) !== -1) continue;
        sectorOwner[pst + ':' + protSecs[psi2]] = 'System';
      }
    }
  }

  // Track range checked, and its BAM coordinates (the FD formats' BAM
  // uses logical 256-sector tracks).
  var firstTrack = 1;
  var lastTrack = fmt.getBamIterTracks ? fmt.getBamIterTracks(data) : bamTracks;
  var iterSptFn = fmt.getBamIterSectorsPerTrack || fmt.sectorsPerTrack;
  if (part) {
    firstTrack = part.startTrack;
    lastTrack = part.startTrack + Math.floor(part.partSize / fmt.partitionSpt) - 1;
  }

  var bamErrors = [];
  var errorTracks = {};
  if (fmt.hasBamFreeCounts) {
    for (var t = firstTrack; t <= (part ? lastTrack : bamTracks); t++) {
      var spt = fmt.sectorsPerTrack(t);
      var storedFree = fmt.readTrackFree(data, bamOff, t);
      var actualFree = 0;
      var bbBase = getBamBitmapBase(t, bamOff, ctx);
      for (var s = 0; s < spt; s++) {
        if (data[bbBase + (s >> 3)] & fmt.bamBitMask(s)) actualFree++;
      }
      if (storedFree !== actualFree) {
        bamErrors.push('T:$' + t.toString(16).toUpperCase().padStart(2, '0') +
          ' count=' + storedFree + ' actual=' + actualFree);
        errorTracks[t] = true;
      }
    }
  }

  // Used-by-a-file but free in the BAM, and allocated but owned by nothing.
  var allocMismatch = 0;
  var orphanCount = 0;
  var errorSectors = {};
  var orphanSectors = {};
  for (t = firstTrack; t <= lastTrack; t++) {
    if (t === sysTrack) continue;
    var spt2 = iterSptFn.call(fmt, t);
    for (var s2 = 0; s2 < spt2; s2++) {
      var key = t + ':' + s2;
      var isFree = checkSectorFree(data, bamOff, t, s2, ctx);
      var isUsed = sectorOwner[key] !== undefined;
      if (isFree && isUsed) {
        allocMismatch++;
        errorSectors[key] = true;
      }
      if (!isFree && !isUsed) {
        orphanCount++;
        orphanSectors[key] = true;
      }
    }
  }

  return { sectorOwner: sectorOwner, bamErrors: bamErrors, allocMismatch: allocMismatch,
           orphanCount: orphanCount, errorTracks: errorTracks, errorSectors: errorSectors,
           orphanSectors: orphanSectors };
}

// ── Optimize Disk ────────────────────────────────────────────────────
// Rewrite the chain of every plain root-dir file with `interleave`, packed
// from track 1 when `defragment`, then rebuild the BAM. REL and VLIR
// files, partitions and whole subdirectory trees stay where they are.
// Whole-disk only: refused inside a partition or subdirectory view.
// Returns { filesOptimized, sectorsRewritten, log[], error? }.
function optimizeDisk(buffer, interleave, defragment, ctx) {
  if (ctx.partition) {
    var refusal = 'Optimize Disk works on the whole disk. Leave the partition or subdirectory first.';
    return { filesOptimized: 0, sectorsRewritten: 0, log: [refusal], error: refusal };
  }
  var data = new Uint8Array(buffer);
  var fmt = ctx.format;
  var bamOff = sectorOffset(fmt.bamTrack, fmt.bamSector, ctx);
  var bamTracks = fmt.getBamIterTracks ? fmt.getBamIterTracks(data) : fmt.bamTracksRange(ctx.tracks);
  var bamSptFn = fmt.getBamIterSectorsPerTrack || fmt.sectorsPerTrack;
  var log = [];

  var protectedSectors = {};
  function protect(t, s) { protectedSectors[t + ':' + s] = true; }
  for (var pt = 1; pt <= ctx.tracks; pt++) {
    var ps = fmt.getProtectedSectors(pt);
    for (var psi = 0; psi < ps.length; psi++) protect(pt, ps[psi]);
  }
  // In use without a dir entry: C128 boot block, GEOS border sector.
  if (hasC128BootSignature(buffer, ctx)) protect(1, 0);
  if (hasGeosSignature(buffer, ctx)) {
    var border = readGeosBorderRef(buffer, ctx);
    if (border && isValidChainLink(border.track, border.sector, ctx)) protect(border.track, border.sector);
  }

  function forEachClosedEntry(dirOff, fn) {
    for (var i = 0; i < fmt.entriesPerSector; i++) {
      var eo = dirOff + i * fmt.entrySize;
      if (data[eo + DIRENT_TYPE] & 0x80) fn(eo, data[eo + DIRENT_TYPE] & 0x07);
    }
  }
  function entryLabel(eo) {
    return '"' + petsciiToReadable(readPetsciiString(data, eo + DIRENT_NAME, 16)) + '"';
  }
  function protectLinkedSubdir(hdrT, hdrS) {
    if (!isValidChainLink(hdrT, hdrS, ctx) || protectedSectors[hdrT + ':' + hdrS]) return;
    protect(hdrT, hdrS);
    var hOff = sectorOffset(hdrT, hdrS, ctx);
    var t = data[hOff], s = data[hOff + 1];
    while (t !== 0 && isValidChainLink(t, s, ctx) && !protectedSectors[t + ':' + s]) {
      protect(t, s);
      var off = sectorOffset(t, s, ctx);
      forEachClosedEntry(off, function(eo, typeIdx) {
        if (typeIdx === fmt.subdirType) protectLinkedSubdir(data[eo + DIRENT_TRACK], data[eo + DIRENT_SECTOR]);
        else forEachFileSector(data, eo, protect, ctx);
      });
      t = data[off]; s = data[off + 1];
    }
  }
  // A file's sectors and GEOS info block, or null when its chain is broken.
  function readChain(eo) {
    var t = data[eo + DIRENT_TRACK], s = data[eo + DIRENT_SECTOR];
    var sectorData = [];
    var visited = {};
    var lastByte = 0;
    while (t !== 0) {
      if (!isValidChainLink(t, s, ctx) || visited[t + ':' + s]) return null;
      visited[t + ':' + s] = true;
      var soff = sectorOffset(t, s, ctx);
      sectorData.push(data.slice(soff + 2, soff + 256));
      if (data[soff] === 0) lastByte = data[soff + 1];
      t = data[soff]; s = data[soff + 1];
    }
    var geosInfoData = null;
    var infoT = data[eo + DIRENT_GEOS_INFO_TRACK], infoS = data[eo + DIRENT_GEOS_INFO_SECTOR];
    if (data[eo + DIRENT_GEOS_TYPE] > 0 && isValidChainLink(infoT, infoS, ctx)) {
      var giOff = sectorOffset(infoT, infoS, ctx);
      geosInfoData = data.slice(giOff, giOff + 256);
    }
    return { entryOff: eo, label: entryLabel(eo), sectorData: sectorData, geosInfoData: geosInfoData, lastByte: lastByte };
  }

  var files = [];
  var dirT = fmt.dirTrack, dirS = fmt.dirSector;
  while (dirT !== 0 && isValidChainLink(dirT, dirS, ctx) && !protectedSectors[dirT + ':' + dirS]) {
    protect(dirT, dirS);
    var doff = sectorOffset(dirT, dirS, ctx);
    forEachClosedEntry(doff, function(eo, typeIdx) {
      if (fmt.supportsSubdirs && typeIdx === fmt.subdirType) {
        if (fmt.subdirLinked) {
          protectLinkedSubdir(data[eo + DIRENT_TRACK], data[eo + DIRENT_SECTOR]);
          log.push('Skipped directory: ' + entryLabel(eo));
        } else {
          var start = data[eo + DIRENT_TRACK];
          var partTracks = Math.floor(direntBlocks(data, eo) / fmt.partitionSpt);
          for (var t = start; t < start + partTracks && t <= ctx.tracks; t++) {
            for (var s = 0; s < fmt.sectorsPerTrack(t); s++) protect(t, s);
          }
          log.push('Skipped partition: ' + entryLabel(eo));
        }
        return;
      }
      // Side-sector and VLIR record chains hold T/S pointers of their own.
      if (typeIdx === FILE_TYPE.REL || isVlirFile(data, eo)) {
        forEachFileSector(data, eo, protect, ctx);
        log.push('Skipped ' + (typeIdx === FILE_TYPE.REL ? 'REL' : 'GEOS VLIR') + ' file: ' + entryLabel(eo));
        return;
      }
      if (data[eo + DIRENT_TRACK] === 0) return;
      var f = readChain(eo);
      if (f) {
        files.push(f);
      } else {
        forEachFileSector(data, eo, protect, ctx);
        log.push('Skipped file with a broken chain: ' + entryLabel(eo));
      }
    });
    dirT = data[doff]; dirS = data[doff + 1];
  }

  if (files.length === 0) {
    log.push('No files to optimize.');
    return { filesOptimized: 0, sectorsRewritten: 0, log: log };
  }

  var allocated = {};
  for (var pk in protectedSectors) allocated[pk] = true;

  var trackOrder = [];
  var skipTracks = fmt.getSkipTracks();
  if (defragment) {
    for (var td = 1; td <= bamTracks; td++) {
      if (!skipTracks[td]) trackOrder.push(td);
    }
  } else {
    // Drive order: below the dir track descending, then above ascending.
    for (var tb = fmt.dirTrack - 1; tb >= 1; tb--) {
      if (!skipTracks[tb]) trackOrder.push(tb);
    }
    for (var ta = fmt.dirTrack + 1; ta <= bamTracks; ta++) {
      if (!skipTracks[ta]) trackOrder.push(ta);
    }
  }

  var filesOptimized = 0;
  var sectorsRewritten = 0;

  // Plan every file before writing anything: old chains are already
  // counted free, so a partial run would leave files pointing at reused sectors.
  for (var pIdx = 0; pIdx < files.length; pIdx++) {
    var need = files[pIdx].sectorData.length + (files[pIdx].geosInfoData ? 1 : 0);
    files[pIdx].sectorList = allocateSectorsFromTrackOrder(allocated, need, trackOrder, interleave, ctx);
    if (files[pIdx].sectorList.length < need) {
      var noRoom = 'Not enough free sectors to relocate ' + files[pIdx].label + '; nothing was changed.';
      log.push('ERROR: ' + noRoom);
      return { filesOptimized: 0, sectorsRewritten: 0, log: log, error: noRoom };
    }
  }

  for (var fIdx = 0; fIdx < files.length; fIdx++) {
    var file = files[fIdx];
    var sectorList = file.sectorList;
    var dataSectorStart = 0;
    if (file.geosInfoData) {
      var infoSec = sectorList[0];
      var infoOff = sectorOffset(infoSec.track, infoSec.sector, ctx);
      data.set(file.geosInfoData, infoOff);
      data[infoOff] = 0x00;
      data[infoOff + 1] = 0xFF;
      data[file.entryOff + DIRENT_GEOS_INFO_TRACK] = infoSec.track;
      data[file.entryOff + DIRENT_GEOS_INFO_SECTOR] = infoSec.sector;
      dataSectorStart = 1;
      sectorsRewritten++;
    }

    var fileSectors = sectorList.slice(dataSectorStart);
    for (var si = 0; si < fileSectors.length; si++) {
      var sec = fileSectors[si];
      var soff2 = sectorOffset(sec.track, sec.sector, ctx);
      if (si < fileSectors.length - 1) {
        data[soff2] = fileSectors[si + 1].track;
        data[soff2 + 1] = fileSectors[si + 1].sector;
      } else {
        data[soff2] = 0x00;
        data[soff2 + 1] = file.lastByte;
      }
      data.set(file.sectorData[si], soff2 + 2);
      sectorsRewritten++;
    }

    data[file.entryOff + DIRENT_TRACK] = fileSectors[0].track;
    data[file.entryOff + DIRENT_SECTOR] = fileSectors[0].sector;
    filesOptimized++;
  }

  // Rebuild the BAM from the final allocation (BAM-omitted sectors stay free).
  for (var bt = 1; bt <= bamTracks; bt++) {
    var bspt = bamSptFn.call(fmt, bt);
    var numBytes = Math.ceil(bspt / 8);
    var bbBase = getBamBitmapBase(bt, bamOff, ctx);
    var omitted = fmt.getBamOmittedSectors ? fmt.getBamOmittedSectors(bt) : [];
    var free = 0;
    var newBytes = new Uint8Array(numBytes);
    for (var bs = 0; bs < bspt; bs++) {
      if (allocated[bt + ':' + bs] && omitted.indexOf(bs) === -1) continue;
      free++;
      newBytes[bs >> 3] |= fmt.bamBitMask(bs);
    }
    fmt.writeTrackFree(data, bamOff, bt, free);
    data.set(newBytes, bbBase);
  }

  var verifyErrors = 0;
  for (fIdx = 0; fIdx < files.length; fIdx++) {
    var verify = readFileData(buffer, files[fIdx].entryOff, ctx);
    if (verify.error) {
      log.push('VERIFY ERROR: ' + files[fIdx].label + ': ' + verify.error);
      verifyErrors++;
    }
  }
  if (verifyErrors > 0) {
    log.push('WARNING: ' + verifyErrors + ' file(s) failed verification!');
  }

  log.push('Optimized ' + filesOptimized + ' file(s), ' + sectorsRewritten + ' sector(s) rewritten.');
  log.push('Interleave: ' + interleave + (defragment ? ' (defragmented)' : ''));

  return { filesOptimized: filesOptimized, sectorsRewritten: sectorsRewritten, log: log };
}

// ── Validate disk ────────────────────────────────────────────────────
function validateDisk(buffer, ctx) {
  const data = new Uint8Array(buffer);
  const fmt = ctx.format;
  const bamOff = sectorOffset(fmt.bamTrack, fmt.bamSector, ctx);
  const numTracks = ctx.tracks;
  const log = [];

  // Chain links on the FD formats are logical (S 0-255), hence the 256.
  const allocated = [];
  for (let t = 0; t <= numTracks; t++) {
    allocated[t] = new Uint8Array(fmt.lbaAddressing ? 256 : fmt.sectorsPerTrack(Math.max(t, 1)));
  }

  for (var stk = 1; stk <= numTracks; stk++) {
    var ps = fmt.getProtectedSectors(stk);
    for (var psi = 0; psi < ps.length; psi++) allocated[stk][ps[psi]] = 1;
  }
  // In use without a dir entry: C128 boot block, GEOS border sector.
  if (hasC128BootSignature(buffer, ctx)) allocated[1][0] = 1;
  if (hasGeosSignature(buffer, ctx)) {
    var border = readGeosBorderRef(buffer, ctx);
    if (border && isValidChainLink(border.track, border.sector, ctx)) allocated[border.track][border.sector] = 1;
  }

  function followChain(startTrack, startSector, label) {
    const visited = new Set();
    let t = startTrack, s = startSector;
    let blocks = 0;
    while (t !== 0) {
      if (t < 1 || t > chainTrackCount(ctx)) {
        log.push(`  ERROR: ${label}: illegal track ${t}`);
        return { blocks, error: true };
      }
      if (s < 0 || s >= chainSectorsPerTrack(t, ctx)) {
        log.push(`  ERROR: ${label}: illegal sector ${s} on track ${t}`);
        return { blocks, error: true };
      }
      const key = `${t}:${s}`;
      if (visited.has(key)) {
        log.push(`  ERROR: ${label}: circular reference at track ${t} sector ${s}`);
        return { blocks, error: true };
      }
      visited.add(key);
      if (allocated[t][s]) {
        log.push(`  ERROR: ${label}: cross-linked at track ${t} sector ${s}`);
        return { blocks, error: true };
      }
      allocated[t][s] = 1;
      blocks++;
      const off = sectorOffset(t, s, ctx);
      t = data[off + 0];
      s = data[off + 1];
    }
    return { blocks, error: false };
  }

  // Walk a directory chain, collecting dir sectors and processing entries.
  // For linked subdirs, recurses into subdirectory entries.
  let splatCount = 0;
  function walkValidateDir(dTrack, dSector, dirVisited) {
    while (dTrack !== 0) {
      const key = `${dTrack}:${dSector}`;
      if (dirVisited.has(key)) { log.push('ERROR: circular directory chain'); break; }
      dirVisited.add(key);
      if (!isValidChainLink(dTrack, dSector, ctx)) {
        log.push(`ERROR: illegal directory sector track ${dTrack} sector ${dSector}`);
        break;
      }
      allocated[dTrack][dSector] = 1;

      const off = sectorOffset(dTrack, dSector, ctx);
      for (let i = 0; i < fmt.entriesPerSector; i++) {
        const entryOff = off + i * fmt.entrySize;
        const typeByte = data[entryOff + 2];
        const fileType = typeByte & 0x07;
        const closed = (typeByte & 0x80) !== 0;
        if (fileType === 0 && !closed) continue;
        const name = readPetsciiString(data, entryOff + 5, 16);
        if (!name.trim() && fileType === 0) continue;
        const fileTrack = data[entryOff + 3];
        const fileSector = data[entryOff + 4];
        var rname = petsciiToReadable(name);
        if (!closed) {
          log.push('Removed splat file: "' + rname + '"');
          data[entryOff + 2] = 0x00;
          splatCount++;
          continue;
        }

        // Linked subdirectory: mark header + recurse into its dir chain
        if (fmt.subdirLinked && fileType === fmt.subdirType) {
          var sdLabel = 'Directory "' + rname + '"';
          if (!isValidChainLink(fileTrack, fileSector, ctx)) {
            log.push(`  ERROR: ${sdLabel}: invalid header track ${fileTrack} sector ${fileSector}`);
            continue;
          }
          if (allocated[fileTrack][fileSector]) {
            log.push(`  ERROR: ${sdLabel}: cross-linked header at track ${fileTrack} sector ${fileSector}`);
            continue;
          }
          allocated[fileTrack][fileSector] = 1; // header sector
          var hdrOff = sectorOffset(fileTrack, fileSector, ctx);
          if (hdrOff >= 0) {
            walkValidateDir(data[hdrOff], data[hdrOff + 1], dirVisited);
          }
          continue;
        }

        // CBM partition: the whole contiguous block, no chain.
        if (!fmt.subdirLinked && fileType === fmt.subdirType) {
          const partTracks = Math.floor(direntBlocks(data, entryOff) / fmt.partitionSpt);
          var label = 'Partition "' + rname + '"';
          if (fileTrack < 1 || fileTrack > numTracks || fileSector !== 0) {
            log.push(`  ERROR: ${label}: invalid start track ${fileTrack} sector ${fileSector}`);
            continue;
          }
          for (let pt = fileTrack; pt < fileTrack + partTracks && pt <= numTracks; pt++) {
            const spt = fmt.sectorsPerTrack(pt);
            for (let ps = 0; ps < spt; ps++) {
              if (allocated[pt][ps]) {
                log.push(`  ERROR: ${label}: cross-linked at track ${pt} sector ${ps}`);
              }
              allocated[pt][ps] = 1;
            }
          }
          continue;
        }

        var label = '"' + rname + '"';
        const result = followChain(fileTrack, fileSector, label);
        var totalBlocks = result.blocks;
        if (fileType === FILE_TYPE.REL) {
          totalBlocks += followChain(data[entryOff + 0x15], data[entryOff + 0x16], label + ' side sectors').blocks;
        }

        forEachGeosAuxSector(data, entryOff,
          function(infoT, infoS) {
            if (!isValidChainLink(infoT, infoS, ctx)) return;
            if (allocated[infoT][infoS]) {
              log.push(`  ERROR: ${label}: cross-linked info block at track ${infoT} sector ${infoS}`);
            } else {
              allocated[infoT][infoS] = 1;
              totalBlocks++;
            }
          },
          function(recT, recS, recIdx) {
            totalBlocks += followChain(recT, recS, label + ' record ' + recIdx).blocks;
          }, ctx);

        const expectedBlocks = direntBlocks(data, entryOff);
        if (totalBlocks !== expectedBlocks && !result.error) {
          log.push(`  Warning: ${label}: block count ${expectedBlocks} in directory, actual ${totalBlocks}`);
        }
      }

      dTrack = data[off + 0];
      dSector = data[off + 1];
    }
  }

  walkValidateDir(fmt.dirTrack, fmt.dirSector, new Set());

  // Rebuild the BAM. The FD formats' BAM is in logical 256-sector tracks;
  // BAM-omitted sectors (CMD FD system partition) stay free, as VICE has them.
  const bamTracks = fmt.getBamIterTracks ? fmt.getBamIterTracks(data) : fmt.bamTracksRange(numTracks);
  const bamSptFn = fmt.getBamIterSectorsPerTrack || fmt.sectorsPerTrack;
  let bamErrors = 0;
  for (let t = 1; t <= bamTracks; t++) {
    const spt = bamSptFn.call(fmt, t);
    const numBytes = Math.ceil(spt / 8);
    const bamOmitted = fmt.getBamOmittedSectors ? fmt.getBamOmittedSectors(t) : [];

    let free = 0;
    const newBytes = new Uint8Array(numBytes);
    for (let s = 0; s < spt; s++) {
      const alloc = allocated[t][s] && bamOmitted.indexOf(s) === -1;
      if (!alloc) {
        free++;
        newBytes[s >> 3] |= fmt.bamBitMask(s);
      }
    }

    let bamByteBase = getBamBitmapBase(t, bamOff, ctx);

    // CMD formats store no free count (readTrackFree derives one), so only
    // the bitmap is compared there.
    let bitmapChanged = fmt.hasBamFreeCounts && fmt.readTrackFree(data, bamOff, t) !== free;
    for (let bi = 0; bi < numBytes && !bitmapChanged; bi++) {
      if (data[bamByteBase + bi] !== newBytes[bi]) bitmapChanged = true;
    }
    if (bitmapChanged) bamErrors++;

    fmt.writeTrackFree(data, bamOff, t, free);
    for (let bi = 0; bi < numBytes; bi++) {
      data[bamByteBase + bi] = newBytes[bi];
    }
  }

  if (bamErrors > 0) log.push(`BAM corrected: ${bamErrors} track(s) had incorrect allocation`);
  if (splatCount > 0) log.push(`Removed ${splatCount} splat file(s)`);
  if (bamErrors === 0 && splatCount === 0 && log.length === 0) {
    log.push('Disk is valid. No errors found.');
  } else if (!log.some(l => l.startsWith('  ERROR'))) {
    log.push('Validation complete.');
  } else {
    log.push('Validation complete with errors.');
  }
  return log;
}

// Validate a D81 sub-partition's contents and rebuild its own BAM.
// `allocated` is indexed by track relative to the partition (1 = first).
function validatePartition(buffer, startTrack, partSize, ctx) {
  const data = new Uint8Array(buffer);
  const fmt = ctx.format;
  const pSpt = fmt.partitionSpt;
  const numPartTracks = Math.floor(partSize / pSpt);
  const partBamOff = sectorOffset(startTrack, 1, ctx);
  const log = [];

  const allocated = [];
  for (let t = 0; t <= numPartTracks; t++) allocated[t] = new Uint8Array(pSpt);
  for (let ss = 0; ss < fmt.partitionDirSector; ss++) allocated[1][ss] = 1; // header + 2 BAM

  function followChain(startT, startS, label) {
    const visited = new Set();
    let t = startT, s = startS;
    let blocks = 0;
    while (t !== 0) {
      const relT = t - startTrack + 1;
      if (relT < 1 || relT > numPartTracks) {
        log.push(`  ERROR: ${label}: illegal track ${t} (outside partition)`);
        return { blocks, error: true };
      }
      if (s < 0 || s >= pSpt) {
        log.push(`  ERROR: ${label}: illegal sector ${s} on track ${t}`);
        return { blocks, error: true };
      }
      const key = `${t}:${s}`;
      if (visited.has(key)) {
        log.push(`  ERROR: ${label}: circular reference at track ${t} sector ${s}`);
        return { blocks, error: true };
      }
      visited.add(key);
      if (allocated[relT][s]) {
        log.push(`  ERROR: ${label}: cross-linked at track ${t} sector ${s}`);
        return { blocks, error: true };
      }
      allocated[relT][s] = 1;
      blocks++;
      const off = sectorOffset(t, s, ctx);
      t = data[off]; s = data[off + 1];
    }
    return { blocks, error: false };
  }

  let dirTrack = startTrack, dirSector = fmt.partitionDirSector;
  const dirVisited = new Set();
  const dirSectors = [];
  while (dirTrack !== 0) {
    const key = `${dirTrack}:${dirSector}`;
    if (dirVisited.has(key)) { log.push('ERROR: circular directory chain'); break; }
    dirVisited.add(key);
    const relT = dirTrack - startTrack + 1;
    if (relT < 1 || relT > numPartTracks || dirSector < 0 || dirSector >= fmt.sectorsPerTrack(dirTrack)) {
      log.push(`ERROR: illegal directory sector track ${dirTrack} sector ${dirSector}`);
      break;
    }
    allocated[relT][dirSector] = 1;
    dirSectors.push({ track: dirTrack, sector: dirSector });
    const off = sectorOffset(dirTrack, dirSector, ctx);
    dirTrack = data[off]; dirSector = data[off + 1];
  }

  let splatCount = 0;
  for (const ds of dirSectors) {
    const off = sectorOffset(ds.track, ds.sector, ctx);
    for (let i = 0; i < fmt.entriesPerSector; i++) {
      const entryOff = off + i * fmt.entrySize;
      const typeByte = data[entryOff + 2];
      const fileType = typeByte & 0x07;
      const closed = (typeByte & 0x80) !== 0;
      if (fileType === 0 && !closed) continue;
      const name = readPetsciiString(data, entryOff + 5, 16);
      if (!name.trim() && fileType === 0) continue;
      const fileTrack = data[entryOff + 3];
      const fileSector = data[entryOff + 4];
      var rname = petsciiToReadable(name);
      if (!closed) {
        log.push('Removed splat file: "' + rname + '"');
        data[entryOff + 2] = 0x00;
        splatCount++;
        continue;
      }
      var label = '"' + rname + '"';
      const result = followChain(fileTrack, fileSector, label);
      var totalBlocks = result.blocks;
      if (fileType === FILE_TYPE.REL) {
        totalBlocks += followChain(data[entryOff + 0x15], data[entryOff + 0x16], label + ' side sectors').blocks;
      }

      forEachGeosAuxSector(data, entryOff,
        function(infoT, infoS) {
          var infoRelT = infoT - startTrack + 1;
          if (infoRelT < 1 || infoRelT > numPartTracks || infoS >= fmt.sectorsPerTrack(infoT)) return;
          if (allocated[infoRelT][infoS]) {
            log.push(`  ERROR: ${label}: cross-linked info block at track ${infoT} sector ${infoS}`);
          } else {
            allocated[infoRelT][infoS] = 1;
            totalBlocks++;
          }
        },
        function(recT, recS, recIdx) {
          totalBlocks += followChain(recT, recS, label + ' record ' + recIdx).blocks;
        }, ctx);

      const expectedBlocks = direntBlocks(data, entryOff);
      if (totalBlocks !== expectedBlocks && !result.error) {
        log.push(`  Warning: ${label}: block count ${expectedBlocks} in directory, actual ${totalBlocks}`);
      }
    }
  }

  // Rebuild the partition's BAM, which covers every track of the disk:
  // tracks outside the partition are all allocated (D81.TXT).
  let bamErrors = 0;
  for (let at = 1; at <= ctx.tracks; at++) {
    const t = at - startTrack + 1;
    const inside = t >= 1 && t <= numPartTracks;
    const spt = fmt.partitionSpt;
    const numBytes = Math.ceil(spt / 8);
    let free = 0;
    const newBytes = new Uint8Array(numBytes);
    for (let s = 0; s < spt && inside; s++) {
      if (!allocated[t][s]) {
        free++;
        newBytes[s >> 3] |= fmt.bamBitMask(s);
      }
    }

    const bamBase = d81BamEntryBase(partBamOff, at);
    const oldFree = data[bamBase];
    let bitmapChanged = oldFree !== free;
    for (let bi = 0; bi < numBytes && !bitmapChanged; bi++) {
      if (data[bamBase + 1 + bi] !== newBytes[bi]) bitmapChanged = true;
    }
    if (bitmapChanged) bamErrors++;

    data[bamBase] = free;
    for (let bi = 0; bi < numBytes; bi++) {
      data[bamBase + 1 + bi] = newBytes[bi];
    }
  }

  if (bamErrors > 0) log.push(`Partition BAM corrected: ${bamErrors} track(s) had incorrect allocation`);
  if (splatCount > 0) log.push(`Removed ${splatCount} splat file(s)`);
  if (bamErrors === 0 && splatCount === 0 && log.length === 0) {
    log.push('Partition is valid. No errors found.');
  } else if (!log.some(l => l.startsWith('  ERROR'))) {
    log.push('Validation complete.');
  } else {
    log.push('Validation complete with errors.');
  }
  return log;
}


// ── Scan for orphaned sector chains (lost files) ─────────────────────
// Finds file data remaining on disk after directory entries have been
// completely removed. Read-only — does not modify the buffer.
function scanOrphanedChains(buffer, ctx) {
  var data = new Uint8Array(buffer);
  var fmt = ctx.format;

  // Step 1: Build set of all owned sectors
  var owned = buildTrueAllocationMap(buffer, ctx);

  var minTrack = 1, maxTrack = chainTrackCount(ctx);
  if (fmt.getBamIterTracks) maxTrack = Math.min(maxTrack, fmt.getBamIterTracks(data));
  if (ctx.partition && !ctx.partition.dnpDir) {
    minTrack = ctx.partition.startTrack;
    maxTrack = ctx.partition.startTrack + Math.floor(ctx.partition.partSize / fmt.partitionSpt) - 1;
  }
  function linkInRange(t, s) {
    return t >= minTrack && t <= maxTrack && s < chainSectorsPerTrack(t, ctx);
  }

  // Step 2: Classify unowned sectors
  var unowned = {}; // "t:s" -> { nextT, nextS, isEnd }
  var pointedTo = {}; // "t:s" -> true

  for (var t = minTrack; t <= maxTrack; t++) {
    var spt = chainSectorsPerTrack(t, ctx);
    for (var s = 0; s < spt; s++) {
      var key = t + ':' + s;
      if (owned[key]) continue;

      var off = sectorOffset(t, s, ctx);
      if (off < 0) continue;

      // Skip all-zero sectors (never written)
      var allZero = true;
      for (var zi = 0; zi < 256; zi++) {
        if (data[off + zi] !== 0) { allZero = false; break; }
      }
      if (allZero) continue;

      var nextT = data[off];
      var nextS = data[off + 1];

      if (nextT === 0 && nextS >= 2) {
        // End-of-chain marker
        unowned[key] = { nextT: 0, nextS: nextS, isEnd: true };
      } else if (linkInRange(nextT, nextS)) {
        // Valid chain link
        unowned[key] = { nextT: nextT, nextS: nextS, isEnd: false };
        // Only build pointedTo from unowned→unowned links (for chain start detection)
        var targetKey = nextT + ':' + nextS;
        if (!owned[targetKey]) pointedTo[targetKey] = true;
      }
      // else: garbage link bytes — not part of a chain
    }
  }

  // Step 3: Find chain starts (unowned sectors not pointed to by another unowned sector)
  var chainStarts = [];
  for (var sk in unowned) {
    if (!pointedTo[sk]) chainStarts.push(sk);
  }

  // Handle circular orphan chains: any unowned sectors still unvisited after chain following
  var globalVisited = {};

  // Step 4: Follow each chain and collect data
  var results = [];

  for (var ci = 0; ci < chainStarts.length; ci++) {
    var parts = chainStarts[ci].split(':');
    followOrphanChain(parseInt(parts[0], 10), parseInt(parts[1], 10));
  }

  // Check for circular orphans (sectors in unowned but not visited by any chain)
  for (var uk in unowned) {
    if (!globalVisited[uk] && !unowned[uk].isEnd) {
      var uparts = uk.split(':');
      followOrphanChain(parseInt(uparts[0], 10), parseInt(uparts[1], 10));
    }
  }

  function followOrphanChain(startT, startS) {
    var sectors = [];
    var bytes = [];
    var visited = {};
    var integrity = 'ok';
    var ct = startT, cs = startS;

    while (true) {
      var ck = ct + ':' + cs;

      // Circular reference
      if (visited[ck]) { integrity = 'circular'; break; }

      // Hit an owned sector (chain crosses into live data)
      if (owned[ck] && sectors.length > 0) { integrity = 'cross-linked'; break; }

      // Cross-linked with another orphan chain
      if (globalVisited[ck]) { integrity = 'cross-linked'; break; }

      visited[ck] = true;
      globalVisited[ck] = true;

      var coff = sectorOffset(ct, cs, ctx);
      if (coff < 0) { integrity = 'broken'; break; }

      sectors.push({ t: ct, s: cs });

      var nt = data[coff];
      var ns = data[coff + 1];

      if (nt === 0) {
        // Last sector: ns is the index of the last data byte (as readFileData)
        for (var i = 2; i <= ns && i < 256; i++) bytes.push(data[coff + i]);
        break;
      } else {
        for (var j = 2; j < 256; j++) bytes.push(data[coff + j]);
      }

      if (!linkInRange(nt, ns)) {
        integrity = 'broken';
        break;
      }

      ct = nt;
      cs = ns;
    }

    if (sectors.length === 0) return;
    // Skip single-sector results with broken chains — likely false positives
    if (sectors.length === 1 && integrity === 'broken') return;
    // Skip single-sector results where all data bytes are zero (wiped sectors like 00 FF 00 00...)
    if (sectors.length === 1 && bytes.length > 0) {
      var allDataZero = true;
      for (var az = 0; az < bytes.length; az++) {
        if (bytes[az] !== 0) { allDataZero = false; break; }
      }
      if (allDataZero) return;
    }

    var fileData = new Uint8Array(bytes);
    var result = {
      startTrack: startT,
      startSector: startS,
      sectors: sectors,
      dataSize: fileData.length,
      data: fileData,
      integrity: integrity,
      suggestedType: 'unknown',
      loadAddress: null
    };

    // Step 5: Type detection heuristics
    if (fileData.length >= 2) {
      var addr = fileData[0] | (fileData[1] << 8);
      var knownAddrs = [0x0401, 0x0801, 0x1001, 0x1C01, 0x2000, 0x4000, 0x6000, 0x8000, 0xA000, 0xC000];
      if (knownAddrs.indexOf(addr) >= 0 || (addr >= 0x0200 && addr <= 0xFFFF && (addr & 0xFF) === 0)) {
        result.suggestedType = 'PRG';
        result.loadAddress = addr;
      }
    }

    if (result.suggestedType === 'unknown' && fileData.length > 0) {
      // Check for SEQ (mostly printable PETSCII)
      var printable = 0;
      for (var pi = 0; pi < fileData.length; pi++) {
        var b = fileData[pi];
        if ((b >= 0x20 && b <= 0x7E) || (b >= 0xA0 && b <= 0xFE) || b === 0x0D) printable++;
      }
      if (printable / fileData.length > 0.7) result.suggestedType = 'SEQ';
    }

    results.push(result);
  }

  return results;
}
