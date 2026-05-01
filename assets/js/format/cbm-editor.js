// ── Version ───────────────────────────────────────────────────────────
var APP_VERSION = { major: 1, minor: 3, build: 100 };
var APP_VERSION_STRING = APP_VERSION.major + '.' + APP_VERSION.minor + '.' + APP_VERSION.build;

// ── Current disk state ─────────────────────────────────────────────────
var currentBuffer = null;
var currentFileName = null;
var showDeleted = localStorage.getItem('cbm-showDeleted') !== 'false';
var selectedEntryIndex = -1;
var selectedEntries = []; // multi-select: array of entryOff values
var showAddresses = localStorage.getItem('cbm-showAddresses') !== 'false';
var showTrackSector = localStorage.getItem('cbm-showTrackSector') !== 'false';
var currentPartition = null; // null = root, or { entryOff, startTrack, partSize, name }

// ── CMD container state (RAMLink, D1M/D2M/D4M, …) ───────────────────
// When the active tab is a CMD-style container (.rml/.rl/.d1m/.d2m/.d4m),
// we keep the full container buffer here and let the user move between
// the partition list and any individual partition. currentBuffer /
// currentFormat reflect whatever view is active: when cmdcPartitionIdx
// === -1 we're on the list (currentBuffer = the full container);
// otherwise currentBuffer is a slice of that partition (DNP / D64 /
// D71 / D81). Edits inside a partition are spliced back into cmdcBuffer
// on exit / save.
var cmdcBuffer = null;          // full container ArrayBuffer or null
var cmdcFileName = null;        // original container file name
var cmdcPartitions = null;      // parsed partition list (from readCmdContainerPartitions)
var cmdcPartitionIdx = -1;      // -1 = partition-list view, else index into cmdcPartitions
var cmdcContainerKey = null;    // 'ramlink' / 'd1m' / 'd2m' / 'd4m' — picks the CMD_CONTAINERS descriptor

// True when the active tab is a CMD container and we're showing the
// partition list (not inside any partition). Disk-edit operations don't
// apply at this level — we're on a container, not a filesystem — so
// menu state queries this to grey them out.
function isCmdContainerListView() {
  return !!cmdcBuffer && cmdcPartitions && cmdcPartitionIdx === -1;
}

// Reset the CMD container globals back to "no container active". Called
// from every non-container load / new-tab path: createTab / loadTab only
// update per-tab fields, not the globals, so without an explicit reset
// the previous tab's container state would leak into a freshly-opened
// D64 (renderDisk would still see cmdcPartitions and draw the partition
// list).
function clearCmdContainerState() {
  cmdcBuffer = null;
  cmdcFileName = null;
  cmdcPartitions = null;
  cmdcPartitionIdx = -1;
  cmdcContainerKey = null;
}
// Per-track physical sector layout captured by decodeG64toD64 when the
// active tab was opened from a .g64. null on D64/D71/D81 etc. — the G64
// Layout viewer reads this and is greyed out when null.
var currentG64Layout = null;
var clipboard = []; // array of { typeIdx, nameBytes, geosBytes, geosInfoBlock, data, vlirRecords }
                    // data is null for GEOS VLIR files; vlirRecords is null for everything else
var dirInterleave = 3;   // directory sector interleave
var fileInterleave = 10; // file data sector interleave

// ── Extended BAM detection (SpeedDOS/DolphinDOS/PrologicDOS) ─────────
function detectExtendedBAM(buffer) {
  if (!buffer) return null;
  var data = new Uint8Array(buffer);
  var fmt = currentFormat;
  if (fmt !== DISK_FORMATS.d64 || currentTracks < 40) return null;

  var bamOff = sectorOffset(fmt.bamTrack, fmt.bamSector);
  if (bamOff < 0) return null;

  // SpeedDOS: extra BAM at T18/S0 offset $C0-$D3 (4 bytes × 5 tracks = 20 bytes)
  var speedDosOk = false;
  var hasBytesAtC0 = false;
  for (var i = 0xC0; i < 0xD4; i++) {
    if (data[bamOff + i] !== 0x00) { hasBytesAtC0 = true; break; }
  }
  if (hasBytesAtC0) speedDosOk = true;

  // DolphinDOS: extra BAM at T18/S0 offset $AC-$BF (4 bytes × 5 tracks)
  var dolphinOk = false;
  var hasBytesAtAC = false;
  for (var j = 0xAC; j < 0xC0; j++) {
    if (data[bamOff + j] !== 0xA0 && data[bamOff + j] !== 0x00) { hasBytesAtAC = true; break; }
  }
  if (hasBytesAtAC) dolphinOk = true;

  // PrologicDOS: extra BAM at T18/S1 offset $00-$13
  var dirOff = sectorOffset(fmt.dirTrack, fmt.dirSector);
  var prologicOk = false;
  // Check if bytes at the start of T18/S1 look like BAM entries (not directory data)
  if (dirOff >= 0 && data[dirOff + 2] === 0x00) {
    // First dir entry type byte is 0 — could be prologic BAM
    var hasNonZero = false;
    for (var k = 4; k < 20; k++) {
      if (data[dirOff + k] !== 0x00) { hasNonZero = true; break; }
    }
    // Not reliable enough to auto-detect
  }

  if (speedDosOk) return 'SpeedDOS';
  if (dolphinOk) return 'DolphinDOS';
  return null;
}

// ── Undo system ──────────────────────────────────────────────────────
// The tab is "clean" (tabDirty=false) when undoStack.length === cleanStackLength.
// Set by markClean() on load / save; read by popUndo() to restore clean state
// when the user undoes back past all edits made since the last save.
// cleanStackLength = -1 means "clean state no longer reachable" (an older entry
// fell off the end when we hit MAX_UNDO).
var undoStack = [];
var MAX_UNDO = 20;
var tabDirty = false;
var cleanStackLength = 0;

function pushUndo() {
  if (!currentBuffer) return;
  undoStack.push(currentBuffer.slice(0));
  if (undoStack.length > MAX_UNDO) {
    undoStack.shift();
    if (cleanStackLength > 0) cleanStackLength--;
    else if (cleanStackLength === 0) cleanStackLength = -1;
  }
  if (!tabDirty) {
    tabDirty = true;
    if (typeof renderTabs === 'function') renderTabs();
  }
}

function popUndo() {
  if (undoStack.length === 0 || !currentBuffer) return false;
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

function clearUndo() { undoStack = []; cleanStackLength = 0; }

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
    activeTabId = null;
    currentBuffer = null;
    currentFileName = null;
    selectedEntryIndex = -1;
    currentPartition = null;
    clearCmdContainerState();
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
/** @param {ArrayBuffer} buffer @returns {BAMIntegrityResult} */
function checkBAMIntegrity(buffer) {
  var data = new Uint8Array(buffer);
  var fmt = currentFormat;
  var bamOff = sectorOffset(fmt.bamTrack, fmt.bamSector);
  var bamTracks = fmt.bamTracksRange(currentTracks);

  // Follow all file chains to build sector ownership map
  var sectorOwner = {};

  // Walk a directory chain, processing file entries and recursing into linked subdirs
  function walkIntegrityDir(dirT, dirS, parentName) {
    var dirVisited = {};
    while (dirT !== 0 && dirT <= currentTracks) {
      if (dirS >= fmt.sectorsPerTrack(dirT)) break;
      var dk = dirT + ':' + dirS;
      if (dirVisited[dk]) break;
      dirVisited[dk] = true;
      sectorOwner[dk] = parentName || 'Directory';
      var doff = sectorOffset(dirT, dirS);
      if (doff < 0) break;

      for (var i = 0; i < fmt.entriesPerSector; i++) {
        var entOff = doff + i * fmt.entrySize;
        var tb = data[entOff + 2];
        var typeIdx = tb & 0x07;
        var closed = (tb & 0x80) !== 0;
        if (typeIdx === 0 && !closed) continue;
        var eName = readPetsciiString(data, entOff + 5, 16);
        if (!eName.trim() && typeIdx === 0) continue;
        var et = data[entOff + 3], es = data[entOff + 4];
        var ownerName = eName || '?';

        // Linked subdirectory: mark header + recurse
        if (fmt.subdirLinked && typeIdx === fmt.subdirType && closed) {
          sectorOwner[et + ':' + es] = ownerName;
          var hOff = sectorOffset(et, es);
          if (hOff >= 0) walkIntegrityDir(data[hOff], data[hOff + 1], ownerName);
          continue;
        }

        // CBM partition: mark entire contiguous block
        if (!fmt.subdirLinked && typeIdx === fmt.subdirType && closed) {
          var partStart = et;
          var partSize = data[entOff + 30] | (data[entOff + 31] << 8);
          var partTracks = Math.floor(partSize / fmt.partitionSpt);
          for (var pt = partStart; pt < partStart + partTracks && pt <= currentTracks; pt++) {
            var pspt = fmt.sectorsPerTrack(pt);
            for (var ps = 0; ps < pspt; ps++) {
              sectorOwner[pt + ':' + ps] = ownerName;
            }
          }
          continue;
        }

        // Regular file: follow all sector chains (main + REL + GEOS)
        if (closed) {
          forEachFileSector(data, entOff, function(t, s) {
            sectorOwner[t + ':' + s] = ownerName;
          });
        }
      }

      dirT = data[doff]; dirS = data[doff + 1];
    }
  }

  // Start from root directory
  walkIntegrityDir(fmt.dirTrack, fmt.dirSector, 'Directory');

  // Mark format-specific system sectors as owned. Skip "BAM-omitted" sectors —
  // these are protected from allocation but intentionally marked *free* in the main
  // BAM (e.g. CMD FD system partition on the last track of D1M/D2M/D4M). Owning them
  // here would falsely trigger allocMismatch because BAM-free + owned = mismatch.
  for (var pst = 1; pst <= currentTracks; pst++) {
    if (pst === fmt.dirTrack) continue; // dir track already skipped in orphan check
    var protSecs = fmt.getProtectedSectors(pst);
    var bamOmitted = fmt.getBamOmittedSectors ? fmt.getBamOmittedSectors(pst) : [];
    for (var psi2 = 0; psi2 < protSecs.length; psi2++) {
      if (bamOmitted.indexOf(protSecs[psi2]) !== -1) continue;
      sectorOwner[pst + ':' + protSecs[psi2]] = 'System';
    }
  }

  // Check free count vs bitmap bits
  var bamErrors = [];
  var errorTracks = {};
  for (var t = 1; t <= bamTracks; t++) {
    var spt = fmt.sectorsPerTrack(t);
    var storedFree = fmt.readTrackFree(data, bamOff, t);
    // Skip count comparison for formats without per-track free counts
    if (!fmt.hasBamFreeCounts) continue;
    var actualFree = 0;
    var bbBase = getBamBitmapBase(t, bamOff);
    var numBytes = Math.ceil(spt / 8);
    for (var bi = 0; bi < numBytes; bi++) {
      var bval = data[bbBase + bi];
      var maxBit = Math.min(8, spt - bi * 8);
      for (var bit = 0; bit < maxBit; bit++) {
        if (bval & (1 << bit)) actualFree++;
      }
    }

    if (storedFree !== actualFree) {
      bamErrors.push('T:$' + t.toString(16).toUpperCase().padStart(2, '0') +
        ' count=' + storedFree + ' actual=' + actualFree);
      errorTracks[t] = true;
    }
  }

  // Check for sectors used by files but marked free in BAM (byte-level)
  // Also detect orphaned sectors: marked used but not owned by any file
  var allocMismatch = 0;
  var orphanCount = 0;
  var errorSectors = {}; // "t:s" → true (free but used by file)
  var orphanSectors = {}; // "t:s" → true (used but not owned by any file)
  for (t = 1; t <= bamTracks; t++) {
    if (t === fmt.dirTrack) continue;
    var spt2 = fmt.sectorsPerTrack(t);
    for (var s2 = 0; s2 < spt2; s2++) {
      var isFree = checkSectorFree(data, bamOff, t, s2);
      var isUsed = sectorOwner[t + ':' + s2] !== undefined;
      if (isFree && isUsed) {
        allocMismatch++;
        errorSectors[t + ':' + s2] = true;
      }
      if (!isFree && !isUsed) {
        orphanCount++;
        orphanSectors[t + ':' + s2] = true;
      }
    }
  }

  return { sectorOwner: sectorOwner, bamErrors: bamErrors, allocMismatch: allocMismatch,
           orphanCount: orphanCount, errorTracks: errorTracks, errorSectors: errorSectors,
           orphanSectors: orphanSectors };
}

// ── Optimize Disk ────────────────────────────────────────────────────
// Rewrite all file sector chains with a chosen interleave, optionally
// defragmenting (packing files onto consecutive tracks).
// Returns { filesOptimized, sectorsRewritten, log[] }
function optimizeDisk(buffer, interleave, defragment) {
  var data = new Uint8Array(buffer);
  var fmt = currentFormat;
  var bamOff = sectorOffset(fmt.bamTrack, fmt.bamSector);
  var bamTracks = fmt.bamTracksRange(currentTracks);
  var log = [];

  // Phase 1: Read all file data into memory
  var info = parseDisk(buffer);
  var files = [];
  for (var fi = 0; fi < info.entries.length; fi++) {
    var entry = info.entries[fi];
    if (entry.deleted) continue;
    var typeByte = data[entry.entryOff + 2];
    var typeIdx = typeByte & 0x07;

    // Skip CBM partitions — they are contiguous track blocks
    if (!fmt.subdirLinked && typeIdx === fmt.subdirType) {
      log.push('Skipped partition: "' + petsciiToReadable(entry.name) + '"');
      continue;
    }

    // Skip REL files — side-sector chains have internal T/S pointers
    // Their sectors will be protected via the protectedSectors map below
    if (typeIdx === FILE_TYPE.REL) {
      log.push('Skipped REL file: "' + petsciiToReadable(entry.name) + '"');
      continue;
    }

    // Skip GEOS VLIR files — record chains inside the index sector can't be
    // reallocated by the linear-chain optimizer. Their sectors are protected below.
    if (isVlirFile(data, entry.entryOff)) {
      log.push('Skipped GEOS VLIR file: "' + petsciiToReadable(entry.name) + '"');
      continue;
    }

    var ft = data[entry.entryOff + 3];
    var fs = data[entry.entryOff + 4];
    if (ft === 0) continue; // empty file

    // Read all raw sector data (preserving bytes 0-255 of each sector)
    var sectorData = [];
    var t = ft, s = fs;
    var visited = {};
    while (t !== 0) {
      if (t < 1 || t > currentTracks) break;
      if (s >= fmt.sectorsPerTrack(t)) break;
      var key = t + ':' + s;
      if (visited[key]) break;
      visited[key] = true;
      var soff = sectorOffset(t, s);
      if (soff < 0) break;
      // Save data payload (bytes 2-255)
      var payload = new Uint8Array(254);
      for (var b = 0; b < 254; b++) payload[b] = data[soff + 2 + b];
      // Save the last-sector byte count for final sector
      var nextT = data[soff], nextS = data[soff + 1];
      sectorData.push({ payload: payload, nextT: nextT, nextS: nextS });
      t = nextT; s = nextS;
    }

    if (sectorData.length === 0) continue;

    // Check for GEOS info block at entry+0x15/0x16
    var geosInfoT = data[entry.entryOff + 0x15];
    var geosInfoS = data[entry.entryOff + 0x16];
    var geosInfoData = null;
    if (geosInfoT > 0 && geosInfoT <= currentTracks && data[entry.entryOff + 0x18] > 0) {
      var giOff = sectorOffset(geosInfoT, geosInfoS);
      if (giOff >= 0) {
        geosInfoData = new Uint8Array(256);
        for (var gi = 0; gi < 256; gi++) geosInfoData[gi] = data[giOff + gi];
      }
    }

    files.push({
      entryOff: entry.entryOff,
      name: entry.name,
      sectorData: sectorData,
      geosInfoData: geosInfoData,
      lastSectorEnd: sectorData[sectorData.length - 1].nextS // byte count in last sector
    });
  }

  if (files.length === 0) {
    log.push('No files to optimize.');
    return { filesOptimized: 0, sectorsRewritten: 0, log: log };
  }

  // Phase 2: Clear all non-system sectors in BAM (mark as free)
  // Build set of protected sectors (BAM + directory chain)
  var protectedSectors = {};
  for (var bsi = 0; bsi < fmt.bamSectors.length; bsi++) {
    protectedSectors[fmt.bamSectors[bsi][0] + ':' + fmt.bamSectors[bsi][1]] = true;
  }
  // Walk directory chain
  var dirT = fmt.dirTrack, dirS = fmt.dirSector;
  var dirVisited = {};
  while (dirT !== 0) {
    var dkey = dirT + ':' + dirS;
    if (dirVisited[dkey]) break;
    dirVisited[dkey] = true;
    protectedSectors[dkey] = true;
    var doff = sectorOffset(dirT, dirS);
    if (doff < 0) break;
    dirT = data[doff]; dirS = data[doff + 1];
  }

  // Also protect CBM partition sectors (contiguous block subdirs)
  if (fmt.supportsSubdirs && !fmt.subdirLinked) {
    for (fi = 0; fi < info.entries.length; fi++) {
      var pe = info.entries[fi];
      if (pe.deleted) continue;
      var ptb = data[pe.entryOff + 2] & 0x07;
      if (ptb === FILE_TYPE.CBM) {
        var partStart = data[pe.entryOff + 3];
        var partSize = data[pe.entryOff + 30] | (data[pe.entryOff + 31] << 8);
        var partTracks = Math.floor(partSize / fmt.partitionSpt);
        for (var pt = partStart; pt < partStart + partTracks && pt <= currentTracks; pt++) {
          var pspt = fmt.sectorsPerTrack(pt);
          for (var ps = 0; ps < pspt; ps++) {
            protectedSectors[pt + ':' + ps] = true;
          }
        }
      }
    }
  }

  // Protect REL and GEOS VLIR file sectors (skipped during optimization)
  for (fi = 0; fi < info.entries.length; fi++) {
    var pe2 = info.entries[fi];
    if (pe2.deleted) continue;
    var ptb2 = data[pe2.entryOff + 2] & 0x07;
    if (ptb2 === FILE_TYPE.REL || isVlirFile(data, pe2.entryOff)) {
      forEachFileSector(data, pe2.entryOff, function(t, s) {
        protectedSectors[t + ':' + s] = true;
      });
    }
  }

  // Mark all non-protected sectors as free
  var allocated = {}; // our working allocation map
  for (var tk = 1; tk <= bamTracks; tk++) {
    var spt = fmt.sectorsPerTrack(tk);
    for (var sk = 0; sk < spt; sk++) {
      if (protectedSectors[tk + ':' + sk]) {
        allocated[tk + ':' + sk] = true;
      }
    }
  }

  // Phase 3: Build track order and reallocate each file
  var dirTrack = fmt.dirTrack;
  var trackOrder = [];
  var skipTracks = fmt.getSkipTracks();

  if (defragment) {
    // Sequential from track 1, skipping system tracks
    for (var td = 1; td <= bamTracks; td++) {
      if (!skipTracks[td]) trackOrder.push(td);
    }
  } else {
    // CBM drive order: below dir track descending, then above ascending
    for (var tb = dirTrack - 1; tb >= 1; tb--) {
      if (!skipTracks[tb]) trackOrder.push(tb);
    }
    for (var ta = dirTrack + 1; ta <= bamTracks; ta++) {
      if (!skipTracks[ta]) trackOrder.push(ta);
    }
  }

  var filesOptimized = 0;
  var sectorsRewritten = 0;

  for (var fIdx = 0; fIdx < files.length; fIdx++) {
    var file = files[fIdx];
    var numSectors = file.sectorData.length;
    var needExtra = file.geosInfoData ? 1 : 0;
    var totalNeed = numSectors + needExtra;

    // Allocate sectors with chosen interleave
    var sectorList = allocateSectorsFromTrackOrder(allocated, totalNeed, trackOrder, interleave);

    if (sectorList.length < totalNeed) {
      log.push('ERROR: Not enough free sectors for "' + petsciiToReadable(file.name) + '"');
      continue;
    }

    // Write GEOS info block if present (first allocated sector)
    var dataSectorStart = 0;
    if (file.geosInfoData) {
      var infoSec = sectorList[0];
      var infoOff = sectorOffset(infoSec.track, infoSec.sector);
      for (var ib = 0; ib < 256; ib++) data[infoOff + ib] = file.geosInfoData[ib];
      data[infoOff] = 0x00;
      data[infoOff + 1] = 0xFF;
      data[file.entryOff + 0x15] = infoSec.track;
      data[file.entryOff + 0x16] = infoSec.sector;
      dataSectorStart = 1;
      sectorsRewritten++;
    }

    // Write file data sectors with new chain links
    var fileSectors = sectorList.slice(dataSectorStart);
    for (var si = 0; si < fileSectors.length; si++) {
      var sec = fileSectors[si];
      var soff2 = sectorOffset(sec.track, sec.sector);

      if (si < fileSectors.length - 1) {
        var nextSec = fileSectors[si + 1];
        data[soff2] = nextSec.track;
        data[soff2 + 1] = nextSec.sector;
      } else {
        // Last sector
        data[soff2] = 0x00;
        data[soff2 + 1] = file.lastSectorEnd;
      }
      // Write payload
      var payload = file.sectorData[si].payload;
      for (var pb = 0; pb < 254; pb++) data[soff2 + 2 + pb] = payload[pb];
      sectorsRewritten++;
    }

    // Update directory entry to point to new first sector
    data[file.entryOff + 3] = fileSectors[0].track;
    data[file.entryOff + 4] = fileSectors[0].sector;

    filesOptimized++;
  }

  // Phase 4: Rebuild BAM from final allocation state
  for (var bt = 1; bt <= bamTracks; bt++) {
    var bspt = fmt.sectorsPerTrack(bt);
    var numBytes = Math.ceil(bspt / 8);
    var bbBase = getBamBitmapBase(bt, bamOff);
    var free = 0;
    var newBytes = new Uint8Array(numBytes);
    for (var bs = 0; bs < bspt; bs++) {
      if (!allocated[bt + ':' + bs]) {
        free++;
        newBytes[Math.floor(bs / 8)] |= (1 << (bs % 8));
      }
    }
    fmt.writeTrackFree(data, bamOff, bt, free);
    for (var bi = 0; bi < numBytes; bi++) {
      data[bbBase + bi] = newBytes[bi];
    }
  }

  // Phase 5: Verify all files can still be read correctly
  var verifyErrors = 0;
  for (fIdx = 0; fIdx < files.length; fIdx++) {
    var vf = files[fIdx];
    var verify = readFileData(buffer, vf.entryOff);
    if (verify.error) {
      log.push('VERIFY ERROR: "' + petsciiToReadable(vf.name) + '": ' + verify.error);
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
function validateDisk(buffer) {
  const data = new Uint8Array(buffer);
  const fmt = currentFormat;
  const bamOff = sectorOffset(fmt.bamTrack, fmt.bamSector);
  const numTracks = currentTracks;
  const log = [];

  const allocated = [];
  for (let t = 0; t <= numTracks; t++) {
    allocated[t] = new Uint8Array(fmt.sectorsPerTrack(Math.max(t, 1)));
  }

  // Mark all system sectors (BAM + header + format-specific) as allocated
  for (var stk = 1; stk <= numTracks; stk++) {
    var ps = fmt.getProtectedSectors(stk);
    for (var psi = 0; psi < ps.length; psi++) allocated[stk][ps[psi]] = 1;
  }

  function followChain(startTrack, startSector, label) {
    const visited = new Set();
    let t = startTrack, s = startSector;
    let blocks = 0;
    while (t !== 0) {
      if (t < 1 || t > numTracks) {
        log.push(`  ERROR: ${label}: illegal track ${t}`);
        return { blocks, error: true };
      }
      if (s < 0 || s >= fmt.sectorsPerTrack(t)) {
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
      const off = sectorOffset(t, s);
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
      if (dTrack < 1 || dTrack > numTracks || dSector < 0 || dSector >= fmt.sectorsPerTrack(dTrack)) {
        log.push(`ERROR: illegal directory sector track ${dTrack} sector ${dSector}`);
        break;
      }
      allocated[dTrack][dSector] = 1;

      const off = sectorOffset(dTrack, dSector);
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
          if (fileTrack < 1 || fileTrack > numTracks) {
            log.push(`  ERROR: ${sdLabel}: invalid header track ${fileTrack}`);
            continue;
          }
          if (allocated[fileTrack][fileSector]) {
            log.push(`  ERROR: ${sdLabel}: cross-linked header at track ${fileTrack} sector ${fileSector}`);
            continue;
          }
          allocated[fileTrack][fileSector] = 1; // header sector
          var hdrOff = sectorOffset(fileTrack, fileSector);
          if (hdrOff >= 0) {
            walkValidateDir(data[hdrOff], data[hdrOff + 1], dirVisited);
          }
          continue;
        }

        // CBM partition: mark the entire contiguous block as allocated (don't follow chain)
        if (!fmt.subdirLinked && fileType === fmt.subdirType) {
          const partSize = data[entryOff + 30] | (data[entryOff + 31] << 8);
          const partTracks = Math.floor(partSize / fmt.partitionSpt);
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

        forEachGeosAuxSector(data, entryOff,
          function(infoT, infoS) {
            if (infoT < 1 || infoT > numTracks || infoS >= fmt.sectorsPerTrack(infoT)) return;
            if (allocated[infoT][infoS]) {
              log.push(`  ERROR: ${label}: cross-linked info block at track ${infoT} sector ${infoS}`);
            } else {
              allocated[infoT][infoS] = 1;
              totalBlocks++;
            }
          },
          function(recT, recS, recIdx) {
            totalBlocks += followChain(recT, recS, label + ' record ' + recIdx).blocks;
          });

        const expectedBlocks = data[entryOff + 30] | (data[entryOff + 31] << 8);
        if (totalBlocks !== expectedBlocks && !result.error) {
          log.push(`  Warning: ${label}: block count ${expectedBlocks} in directory, actual ${totalBlocks}`);
        }
      }

      dTrack = data[off + 0];
      dSector = data[off + 1];
    }
  }

  walkValidateDir(fmt.dirTrack, fmt.dirSector, new Set());

  // Rebuild BAM (byte-level to handle D81's 40 sectors per track)
  const bamTracks = fmt.bamTracksRange(numTracks);
  let bamErrors = 0;
  for (let t = 1; t <= bamTracks; t++) {
    const spt = fmt.sectorsPerTrack(t);
    const numBytes = Math.ceil(spt / 8);
    // BAM-omitted sectors (e.g. CMD FD system partition on last track) are
    // protected from allocation but must remain marked *free* in the main BAM
    // to stay consistent with VICE/DirMaster output.
    const bamOmitted = fmt.getBamOmittedSectors ? fmt.getBamOmittedSectors(t) : [];

    // Build new bitmap bytes and free count from allocation table
    let free = 0;
    const newBytes = new Uint8Array(numBytes);
    for (let s = 0; s < spt; s++) {
      const alloc = allocated[t][s] && bamOmitted.indexOf(s) === -1;
      if (!alloc) {
        free++;
        newBytes[s >> 3] |= fmt.bamBitMask(s);
      }
    }

    let bamByteBase = getBamBitmapBase(t, bamOff);

    // Check if anything changed
    const oldFree = fmt.readTrackFree(data, bamOff, t);
    let bitmapChanged = oldFree !== free;
    for (let bi = 0; bi < numBytes && !bitmapChanged; bi++) {
      if (data[bamByteBase + bi] !== newBytes[bi]) bitmapChanged = true;
    }
    if (bitmapChanged) bamErrors++;

    // Write new values
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

// Validate a D81 partition's contents and rebuild its internal BAM
function validatePartition(buffer, startTrack, partSize) {
  const data = new Uint8Array(buffer);
  const fmt = currentFormat;
  const numPartTracks = Math.floor(partSize / fmt.partitionSpt);
  const partBamOff = sectorOffset(startTrack, 1);
  const log = [];

  // Build allocation table for partition tracks (relative: 1..numPartTracks)
  const allocated = [];
  for (let t = 0; t <= numPartTracks; t++) {
    allocated[t] = new Uint8Array(40); // D81: 40 sectors per track
  }
  // System sectors on track 1: header(0), BAM1(1), BAM2(2)
  allocated[1][0] = 1;
  allocated[1][1] = 1;
  allocated[1][2] = 1;

  function followChain(startT, startS, label) {
    const visited = new Set();
    let t = startT, s = startS;
    let blocks = 0;
    while (t !== 0) {
      // Convert absolute track to relative
      const relT = t - startTrack + 1;
      if (relT < 1 || relT > numPartTracks) {
        log.push(`  ERROR: ${label}: illegal track ${t} (outside partition)`);
        return { blocks, error: true };
      }
      if (s < 0 || s >= 40) {
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
      const off = sectorOffset(t, s);
      t = data[off]; s = data[off + 1];
    }
    return { blocks, error: false };
  }

  // Walk partition directory chain (starts at startTrack, sector 3)
  let dirTrack = startTrack, dirSector = 3;
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
    const off = sectorOffset(dirTrack, dirSector);
    dirTrack = data[off]; dirSector = data[off + 1];
  }

  let splatCount = 0;
  for (const ds of dirSectors) {
    const off = sectorOffset(ds.track, ds.sector);
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
        });

      const expectedBlocks = data[entryOff + 30] | (data[entryOff + 31] << 8);
      if (totalBlocks !== expectedBlocks && !result.error) {
        log.push(`  Warning: ${label}: block count ${expectedBlocks} in directory, actual ${totalBlocks}`);
      }
    }
  }

  // Rebuild partition BAM
  let bamErrors = 0;
  for (let t = 1; t <= numPartTracks; t++) {
    const spt = fmt.partitionSpt;
    const numBytes = Math.ceil(spt / 8);
    let free = 0;
    const newBytes = new Uint8Array(numBytes);
    for (let s = 0; s < spt; s++) {
      if (!allocated[t][s]) {
        free++;
        newBytes[Math.floor(s / 8)] |= (1 << (s % 8));
      }
    }

    const bamBase = d81PartitionBamBase(partBamOff, t);
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
function scanOrphanedChains(buffer) {
  var data = new Uint8Array(buffer);
  var fmt = currentFormat;

  // Step 1: Build set of all owned sectors
  var owned = buildTrueAllocationMap(buffer);

  // Determine scan range (partition-aware)
  var minTrack = 1, maxTrack = currentTracks;
  if (currentPartition) {
    minTrack = currentPartition.startTrack;
    maxTrack = currentPartition.startTrack + Math.floor(currentPartition.partSize / currentFormat.partitionSpt) - 1;
  }

  // Step 2: Classify unowned sectors
  var unowned = {}; // "t:s" -> { nextT, nextS, isEnd }
  var pointedTo = {}; // "t:s" -> true

  for (var t = minTrack; t <= maxTrack; t++) {
    var spt = fmt.sectorsPerTrack(t);
    for (var s = 0; s < spt; s++) {
      var key = t + ':' + s;
      if (owned[key]) continue;

      var off = sectorOffset(t, s);
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
      } else if (nextT >= minTrack && nextT <= maxTrack &&
                 nextS < fmt.sectorsPerTrack(nextT)) {
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

      var coff = sectorOffset(ct, cs);
      if (coff < 0) { integrity = 'broken'; break; }

      sectors.push({ t: ct, s: cs });

      var nt = data[coff];
      var ns = data[coff + 1];

      if (nt === 0) {
        // Last sector: collect bytes 2..ns-1
        for (var i = 2; i < ns && i < 256; i++) bytes.push(data[coff + i]);
        break;
      } else {
        // Full sector: collect bytes 2-255
        for (var j = 2; j < 256; j++) bytes.push(data[coff + j]);
      }

      // Validate next link
      if (nt < minTrack || nt > maxTrack || ns >= fmt.sectorsPerTrack(nt)) {
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
