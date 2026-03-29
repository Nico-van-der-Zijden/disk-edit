// ── Current disk state ─────────────────────────────────────────────────
var currentBuffer = null;
var currentFileName = null;
var showDeleted = localStorage.getItem('d64-showDeleted') !== 'false';
var selectedEntryIndex = -1;
var showAddresses = localStorage.getItem('d64-showAddresses') === 'true';
var showTrackSector = localStorage.getItem('d64-showTrackSector') === 'true';
var currentPartition = null; // null = root, or { entryOff, startTrack, partSize, name }

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

    // Find bitmap byte base for this track
    var bbBase;
    if (fmt === DISK_FORMATS.d81) {
      bbBase = fmt._bamBase(bamOff, t) + 1;
    } else if (fmt === DISK_FORMATS.d71 && t > 35) {
      bbBase = fmt._bam2Off(bamOff) + (t - 36) * 3;
    } else {
      bbBase = bamOff + 4 * t + 1;
    }
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
    var bbBase2;
    if (fmt === DISK_FORMATS.d81) {
      bbBase2 = fmt._bamBase(bamOff, t) + 1;
    } else if (fmt === DISK_FORMATS.d71 && t > 35) {
      bbBase2 = fmt._bam2Off(bamOff) + (t - 36) * 3;
    } else {
      bbBase2 = bamOff + 4 * t + 1;
    }
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

    // Find the bitmap byte base for this track
    let bamByteBase;
    if (fmt === DISK_FORMATS.d81) {
      bamByteBase = fmt._bamBase(bamOff, t) + 1;
    } else if (fmt === DISK_FORMATS.d71 && t > 35) {
      bamByteBase = fmt._bam2Off(bamOff) + (t - 36) * 3;
    } else {
      bamByteBase = bamOff + 4 * t + 1;
    }

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
