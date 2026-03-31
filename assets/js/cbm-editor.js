// ── Current disk state ─────────────────────────────────────────────────
var currentBuffer = null;
var currentFileName = null;
var showDeleted = localStorage.getItem('d64-showDeleted') !== 'false';
var selectedEntryIndex = -1;
var showAddresses = localStorage.getItem('d64-showAddresses') === 'true';
var showTrackSector = localStorage.getItem('d64-showTrackSector') === 'true';
var currentPartition = null; // null = root, or { entryOff, startTrack, partSize, name }
var clipboard = null; // { typeIdx, nameBytes: Uint8Array(16), data: Uint8Array }

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
    selectedEntry: -1
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
}

function loadTab(tab) {
  currentBuffer = tab.buffer;
  currentFileName = tab.fileName;
  currentFormat = tab.format;
  currentTracks = tab.tracks;
  currentPartition = tab.partition;
  selectedEntryIndex = tab.selectedEntry;
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
    document.getElementById('content').innerHTML =
      '<div class="empty-state">No disk loaded.<br>' +
      'Use Disk &gt; New to create an empty disk,<br>' +
      'or Disk &gt; Open to load a disk image.</div>';
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

function updateTabName() {
  var tab = getActiveTab();
  if (!tab) return;
  if (tab.fileName) {
    tab.name = tab.fileName;
  }
  renderTabs();
}

// ── BAM integrity check (read-only, doesn't modify disk) ─────────────
// Returns { sectorOwner: {}, bamErrors: [], allocMismatch: number }
function checkBAMIntegrity(buffer) {
  var data = new Uint8Array(buffer);
  var fmt = currentFormat;
  var bamOff = sectorOffset(fmt.bamTrack, fmt.bamSector);
  var bamTracks = fmt.bamTracksRange(currentTracks);

  // Follow all file chains to build sector ownership map
  var sectorOwner = {};
  var info = parseDisk(buffer);
  for (var fi = 0; fi < info.entries.length; fi++) {
    var entry = info.entries[fi];
    if (entry.deleted) continue;
    var entryType = data[entry.entryOff + 2] & 0x07;

    // CBM partition: mark entire contiguous block as owned (don't follow chain)
    if (entryType === 5 && fmt === DISK_FORMATS.d81) {
      var partStart = data[entry.entryOff + 3];
      var partSize = data[entry.entryOff + 30] | (data[entry.entryOff + 31] << 8);
      var partTracks = Math.floor(partSize / 40);
      for (var pt = partStart; pt < partStart + partTracks && pt <= currentTracks; pt++) {
        var pspt = fmt.sectorsPerTrack(pt);
        for (var ps = 0; ps < pspt; ps++) {
          sectorOwner[pt + ':' + ps] = entry.name || '?';
        }
      }
      continue;
    }

    var ft = data[entry.entryOff + 3];
    var fs = data[entry.entryOff + 4];
    var visited = {};
    while (ft !== 0 && ft <= currentTracks) {
      if (fs >= fmt.sectorsPerTrack(ft)) break;
      var key = ft + ':' + fs;
      if (visited[key]) break;
      visited[key] = true;
      sectorOwner[key] = entry.name || '?';
      var soff = sectorOffset(ft, fs);
      if (soff < 0) break;
      ft = data[soff]; fs = data[soff + 1];
    }
  }

  // Check free count vs bitmap bits (byte-level for D81's 40 sectors per track)
  var bamErrors = [];
  var errorTracks = {}; // track → true
  for (var t = 1; t <= bamTracks; t++) {
    var spt = fmt.sectorsPerTrack(t);
    var storedFree = fmt.readTrackFree(data, bamOff, t);
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
  var allocMismatch = 0;
  var errorSectors = {}; // "t:s" → true
  for (t = 1; t <= bamTracks; t++) {
    if (t === fmt.dirTrack) continue;
    var spt2 = fmt.sectorsPerTrack(t);
    var bbBase2 = getBamBitmapBase(t, bamOff);
    for (var s2 = 0; s2 < spt2; s2++) {
      var byteIdx = Math.floor(s2 / 8);
      var bitIdx = s2 % 8;
      var isFree = (data[bbBase2 + byteIdx] & (1 << bitIdx)) !== 0;
      var isUsed = sectorOwner[t + ':' + s2] !== undefined;
      if (isFree && isUsed) {
        allocMismatch++;
        errorSectors[t + ':' + s2] = true;
      }
    }
  }

  return { sectorOwner: sectorOwner, bamErrors: bamErrors, allocMismatch: allocMismatch,
           errorTracks: errorTracks, errorSectors: errorSectors };
}

// ── Allowed C64 characters ────────────────────────────────────────────
function isValidPetscii(ch) {
  var cp = ch.charCodeAt(0);
  if (cp >= 0xE000 && cp <= 0xE0FF) return true;
  if (cp >= 0xE100 && cp <= 0xE1FF) return true;
  return UNICODE_TO_PETSCII.has(ch);
}

function filterC64Input(str, maxLen) {
  return Array.from(str).filter(ch => isValidPetscii(ch)).slice(0, maxLen).join('');
}

// ── Write header fields back to buffer ────────────────────────────────
function writeDiskName(buffer, name, overrides) {
  writePetsciiString(buffer, getHeaderOffset() + currentFormat.nameOffset, name, currentFormat.nameLength, overrides);
}

function writeDiskId(buffer, id, overrides) {
  writePetsciiString(buffer, getHeaderOffset() + currentFormat.idOffset, id, currentFormat.idLength, overrides);
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

  allocated[fmt.bamTrack][fmt.bamSector] = 1;

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

  let dirTrack = fmt.dirTrack, dirSector = fmt.dirSector;
  const dirSectors = [];
  const dirVisited = new Set();
  while (dirTrack !== 0) {
    const key = `${dirTrack}:${dirSector}`;
    if (dirVisited.has(key)) { log.push('ERROR: circular directory chain'); break; }
    dirVisited.add(key);
    if (dirTrack < 1 || dirTrack > numTracks || dirSector < 0 || dirSector >= fmt.sectorsPerTrack(dirTrack)) {
      log.push(`ERROR: illegal directory sector track ${dirTrack} sector ${dirSector}`);
      break;
    }
    allocated[dirTrack][dirSector] = 1;
    dirSectors.push({ track: dirTrack, sector: dirSector });
    const off = sectorOffset(dirTrack, dirSector);
    dirTrack = data[off + 0];
    dirSector = data[off + 1];
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

      // CBM partition: mark the entire contiguous block as allocated (don't follow chain)
      if (fileType === 5 && fmt === DISK_FORMATS.d81) {
        const partSize = data[entryOff + 30] | (data[entryOff + 31] << 8);
        const partTracks = Math.floor(partSize / 40);
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
      const expectedBlocks = data[entryOff + 30] | (data[entryOff + 31] << 8);
      if (result.blocks !== expectedBlocks && !result.error) {
        log.push(`  Warning: ${label}: block count ${expectedBlocks} in directory, actual ${result.blocks}`);
      }
    }
  }

  // Rebuild BAM (byte-level to handle D81's 40 sectors per track)
  const bamTracks = fmt.bamTracksRange(numTracks);
  let bamErrors = 0;
  for (let t = 1; t <= bamTracks; t++) {
    const spt = fmt.sectorsPerTrack(t);
    const numBytes = Math.ceil(spt / 8);

    // Build new bitmap bytes and free count from allocation table
    let free = 0;
    const newBytes = new Uint8Array(numBytes);
    for (let s = 0; s < spt; s++) {
      if (!allocated[t][s]) {
        free++;
        newBytes[Math.floor(s / 8)] |= (1 << (s % 8));
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
  const numPartTracks = Math.floor(partSize / 40);
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
    if (relT < 1 || relT > numPartTracks || dirSector < 0 || dirSector >= 40) {
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
      const expectedBlocks = data[entryOff + 30] | (data[entryOff + 31] << 8);
      if (result.blocks !== expectedBlocks && !result.error) {
        log.push(`  Warning: ${label}: block count ${expectedBlocks} in directory, actual ${result.blocks}`);
      }
    }
  }

  // Rebuild partition BAM
  let bamErrors = 0;
  for (let t = 1; t <= numPartTracks; t++) {
    const spt = 40;
    const numBytes = Math.ceil(spt / 8);
    let free = 0;
    const newBytes = new Uint8Array(numBytes);
    for (let s = 0; s < spt; s++) {
      if (!allocated[t][s]) {
        free++;
        newBytes[Math.floor(s / 8)] |= (1 << (s % 8));
      }
    }

    let bamBase;
    if (t <= 40) {
      bamBase = partBamOff + 0x10 + (t - 1) * 6;
    } else {
      bamBase = partBamOff + 256 + 0x10 + (t - 41) * 6;
    }

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

// Backward-compatible alias
function validateD64(buffer) { return validateDisk(buffer); }

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
    maxTrack = currentPartition.startTrack + Math.floor(currentPartition.partSize / 40) - 1;
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
