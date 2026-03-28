// ── Current disk state ─────────────────────────────────────────────────
var currentBuffer = null;
var currentFileName = null;
var showDeleted = localStorage.getItem('d64-showDeleted') !== 'false';
var selectedEntryIndex = -1;
var showAddresses = localStorage.getItem('d64-showAddresses') === 'true';
var showTrackSector = localStorage.getItem('d64-showTrackSector') === 'true';

// ── Allowed C64 characters ────────────────────────────────────────────
function isValidPetscii(ch) {
  return UNICODE_TO_PETSCII.has(ch);
}

function filterC64Input(str, maxLen) {
  return Array.from(str).filter(ch => isValidPetscii(ch)).slice(0, maxLen).join('');
}

// ── Write header fields back to buffer ────────────────────────────────
function writeDiskName(buffer, name, overrides) {
  const fmt = currentFormat;
  const bamOff = sectorOffset(fmt.bamTrack, fmt.bamSector);
  writePetsciiString(buffer, bamOff + fmt.nameOffset, name, fmt.nameLength, overrides);
}

function writeDiskId(buffer, id, overrides) {
  const fmt = currentFormat;
  const bamOff = sectorOffset(fmt.bamTrack, fmt.bamSector);
  writePetsciiString(buffer, bamOff + fmt.idOffset, id, fmt.idLength, overrides);
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
      if (!closed) {
        log.push(`Removed splat file: "${name}"`);
        data[entryOff + 2] = 0x00;
        splatCount++;
        continue;
      }
      const label = `"${name}"`;
      const result = followChain(fileTrack, fileSector, label);
      const expectedBlocks = data[entryOff + 30] | (data[entryOff + 31] << 8);
      if (result.blocks !== expectedBlocks && !result.error) {
        log.push(`  Warning: ${label}: block count ${expectedBlocks} in directory, actual ${result.blocks}`);
      }
    }
  }

  // Rebuild BAM
  const bamTracks = fmt.bamTracksRange(numTracks);
  let bamErrors = 0;
  for (let t = 1; t <= bamTracks; t++) {
    const spt = fmt.sectorsPerTrack(t);
    let free = 0, bm = 0;
    for (let s = 0; s < spt; s++) {
      if (!allocated[t][s]) { free++; bm |= (1 << s); }
    }
    const oldFree = fmt.readTrackFree(data, bamOff, t);
    const oldBm = fmt.readTrackBitmap(data, bamOff, t);
    if (oldFree !== free || oldBm !== bm) bamErrors++;
    fmt.writeTrackFree(data, bamOff, t, free);
    fmt.writeTrackBitmap(data, bamOff, t, bm);
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

// Backward-compatible alias
function validateD64(buffer) { return validateDisk(buffer); }
