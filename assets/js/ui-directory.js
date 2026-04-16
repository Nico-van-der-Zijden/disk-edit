// ── Move directory entry ──────────────────────────────────────────────
// Get ordered list of directory entry offsets from the chain
// ── Partition-aware parse helper ──────────────────────────────────────
function parseCurrentDir(buffer) {
  if (currentPartition) {
    if (currentPartition.dnpDir) {
      return parseDnpDirectory(buffer, currentPartition.dnpDirT, currentPartition.dnpDirS,
        currentPartition.name, currentPartition.dnpHeaderT, currentPartition.dnpHeaderS);
    }
    return parsePartition(buffer, currentPartition.startTrack, currentPartition.partSize);
  }
  return parseDisk(buffer);
}

// ── Partition-aware directory helpers ──────────────────────────────────
// Returns { dirTrack, dirSector, dirTrackNum, bamOff, maxDirSectors }
// for the current context (root or partition)
function getDirContext() {
  if (currentPartition) {
    if (currentPartition.dnpDir) {
      return {
        dirTrack: currentPartition.dnpDirT, dirSector: currentPartition.dnpDirS,
        dirTrackNum: currentPartition.dnpDirT,
        bamOff: sectorOffset(currentFormat.bamTrack, currentFormat.bamSector),
        maxDirSectors: 222 // DNP can expand directory freely
      };
    }
    var st = currentPartition.startTrack;
    return {
      dirTrack: st, dirSector: 3, dirTrackNum: st,
      bamOff: sectorOffset(st, 1),
      maxDirSectors: 37
    };
  }
  return {
    dirTrack: currentFormat.dirTrack, dirSector: currentFormat.dirSector,
    dirTrackNum: currentFormat.dirTrack,
    bamOff: sectorOffset(currentFormat.bamTrack, currentFormat.bamSector),
    maxDirSectors: currentFormat.maxDirSectors
  };
}

function getDirSlotOffsets(buffer) {
  const data = new Uint8Array(buffer);
  const offsets = [];
  var ctx = getDirContext();
  let t = ctx.dirTrack, s = ctx.dirSector;
  const visited = new Set();
  while (t !== 0) {
    const key = `${t}:${s}`;
    if (visited.has(key)) break;
    visited.add(key);
    const off = sectorOffset(t, s);
    if (off < 0) break;
    for (let i = 0; i < currentFormat.entriesPerSector; i++) offsets.push(off + i * currentFormat.entrySize);
    t = data[off];
    s = data[off + 1];
  }
  return offsets;
}

function swapDirEntries(buffer, offA, offB) {
  if (offA === offB) return;
  const data = new Uint8Array(buffer);
  // Swap bytes 2-31 (entry data, skip 0-1 which are chain links for entry 0)
  for (let j = 2; j < 32; j++) {
    const tmp = data[offA + j];
    data[offA + j] = data[offB + j];
    data[offB + j] = tmp;
  }
}

function moveEntry(direction) {
  if (!currentBuffer || selectedEntryIndex < 0) return;
  var slots = getDirSlotOffsets(currentBuffer);
  var entries = selectedEntries.length > 1 ? selectedEntries.slice() : [selectedEntryIndex];

  // Get sorted slot indices for the selected entries
  var indices = [];
  for (var i = 0; i < entries.length; i++) {
    var idx = slots.indexOf(entries[i]);
    if (idx >= 0) indices.push(idx);
  }
  indices.sort(function(a, b) { return a - b; });
  if (indices.length === 0) return;

  // Find last non-empty slot for lower bound
  var data = new Uint8Array(currentBuffer);
  var lastUsed = -1;
  for (var li = slots.length - 1; li >= 0; li--) {
    var empty = true;
    for (var bi = 2; bi < 32; bi++) {
      if (data[slots[li] + bi] !== 0x00) { empty = false; break; }
    }
    if (!empty) { lastUsed = li; break; }
  }

  // Check bounds
  if (direction < 0 && indices[0] <= 0) return;
  if (direction > 0 && indices[indices.length - 1] >= lastUsed) return;

  pushUndo();

  if (direction < 0) {
    // Moving up: swap each entry with the one above, top to bottom
    for (var u = 0; u < indices.length; u++) {
      swapDirEntries(currentBuffer, slots[indices[u]], slots[indices[u] - 1]);
      indices[u]--;
    }
  } else {
    // Moving down: swap each entry with the one below, bottom to top
    for (var d = indices.length - 1; d >= 0; d--) {
      swapDirEntries(currentBuffer, slots[indices[d]], slots[indices[d] + 1]);
      indices[d]++;
    }
  }

  // Update selection to follow moved entries
  selectedEntries = [];
  for (var j = 0; j < indices.length; j++) {
    selectedEntries.push(slots[indices[j]]);
  }
  selectedEntryIndex = selectedEntries[0];

  var info = parseCurrentDir(currentBuffer);
  renderDisk(info);
}

// ── Sort directory ────────────────────────────────────────────────────
function sortDirectory(buffer, sortType) {
  pushUndo();
  const data = new Uint8Array(buffer);

  // Collect all directory entry slots (raw 32-byte blocks) from the chain
  const slots = []; // { off, bytes, isEmpty, name, blocks }
  let t = currentFormat.dirTrack, s = currentFormat.dirSector;
  const visited = new Set();
  const sectorOffsets = [];

  while (t !== 0) {
    const key = `${t}:${s}`;
    if (visited.has(key)) break;
    visited.add(key);
    const off = sectorOffset(t, s);
    if (off < 0) break;
    sectorOffsets.push(off);

    for (let i = 0; i < 8; i++) {
      const eo = off + i * 32;
      const raw = data.slice(eo, eo + 32);
      const typeByte = raw[2];

      // Check if slot is empty
      let isEmpty = true;
      for (let j = 2; j < 32; j++) {
        if (raw[j] !== 0x00) { isEmpty = false; break; }
      }

      const name = readPetsciiString(data, eo + 5, 16);
      const blocks = raw[30] | (raw[31] << 8);

      slots.push({ off: eo, bytes: new Uint8Array(raw), isEmpty, name, blocks, typeByte });
    }

    t = data[off];
    s = data[off + 1];
  }

  // Separate non-empty and empty slots
  const entries = slots.filter(s => !s.isEmpty);
  const empties = slots.filter(s => s.isEmpty);

  // Sort non-empty entries
  if (sortType === 'name-asc') entries.sort((a, b) => a.name.localeCompare(b.name));
  else if (sortType === 'name-desc') entries.sort((a, b) => b.name.localeCompare(a.name));
  else if (sortType === 'blocks-asc') entries.sort((a, b) => a.blocks - b.blocks);
  else if (sortType === 'blocks-desc') entries.sort((a, b) => b.blocks - a.blocks);

  // Recombine: entries first, empties at end
  const sorted = [...entries, ...empties];

  // Write back to the directory sectors in order
  // Note: bytes 0-1 of each entry slot are NOT part of the entry data for entries 1-7.
  // Only entry 0 of each sector uses bytes 0-1 as the chain link (next T/S).
  // For entries 1-7, bytes 0-1 in their 32-byte slot are part of the entry but
  // conventionally unused (the real chain link is only in entry 0).
  for (let i = 0; i < sorted.length && i < slots.length; i++) {
    const targetOff = slots[i].off;
    const srcBytes = sorted[i].bytes;
    // Write bytes 2-31 (skip 0-1 which are chain link for entry 0 or unused)
    for (let j = 2; j < 32; j++) {
      data[targetOff + j] = srcBytes[j];
    }
  }
}

// ── Align filename ────────────────────────────────────────────────────
function getFilenameContent(data, entryOff) {
  // Find content: everything before the first 0xA0 padding byte
  const nameOff = entryOff + 5;
  let contentLen = 16;
  for (let i = 0; i < 16; i++) {
    if (data[nameOff + i] === 0xA0) { contentLen = i; break; }
  }
  const content = [];
  for (let i = 0; i < contentLen; i++) content.push(data[nameOff + i]);
  return content;
}

function writeFilenameAligned(data, entryOff, content) {
  const nameOff = entryOff + 5;
  for (let i = 0; i < 16; i++) {
    data[nameOff + i] = i < content.length ? content[i] : 0xA0;
  }
}

function alignFilename(buffer, entryOff, alignment) {
  const data = new Uint8Array(buffer);
  const content = getFilenameContent(data, entryOff);

  // Strip trailing 0x20 spaces and 0xA0 padding
  while (content.length > 0 && (content[content.length - 1] === 0x20 || content[content.length - 1] === 0xA0)) content.pop();
  // Strip leading 0x20 spaces
  while (content.length > 0 && content[0] === 0x20) content.shift();
  if (content.length >= 16) return;
  if (content.length === 0 && alignment !== 'expand') return;

  const result = new Uint8Array(16).fill(0x20); // fill with real spaces
  const padCount = 16 - content.length;

  if (alignment === 'left') {
    for (let i = 0; i < content.length; i++) result[i] = content[i];

  } else if (alignment === 'right') {
    for (let i = 0; i < content.length; i++) result[padCount + i] = content[i];

  } else if (alignment === 'center') {
    const leftPad = Math.floor(padCount / 2);
    for (let i = 0; i < content.length; i++) result[leftPad + i] = content[i];

  } else if (alignment === 'justify') {
    // Split into words (by 0x20 space)
    const words = [];
    let word = [];
    for (const b of content) {
      if (b === 0x20) {
        if (word.length) { words.push(word); word = []; }
      } else {
        word.push(b);
      }
    }
    if (word.length) words.push(word);

    if (words.length <= 1) {
      // Single word — left align
      for (let i = 0; i < content.length; i++) result[i] = content[i];
    } else {
      const totalChars = words.reduce((sum, w) => sum + w.length, 0);
      const totalGaps = words.length - 1;
      const totalSpaces = 16 - totalChars;
      if (totalSpaces < totalGaps) {
        // Not enough room — just left align
        for (let i = 0; i < content.length; i++) result[i] = content[i];
      } else {
        const baseSpaces = Math.floor(totalSpaces / totalGaps);
        let extraSpaces = totalSpaces % totalGaps;
        let pos = 0;
        for (let w = 0; w < words.length; w++) {
          for (const b of words[w]) result[pos++] = b;
          if (w < words.length - 1) {
            let spaces = baseSpaces + (extraSpaces > 0 ? 1 : 0);
            if (extraSpaces > 0) extraSpaces--;
            for (let s = 0; s < spaces; s++) result[pos++] = 0x20;
          }
        }
      }
    }

  } else if (alignment === 'expand') {
    // Pad filename with 0x20 spaces to fill all 16 bytes
    for (let i = 0; i < content.length; i++) result[i] = content[i];
    for (let i = content.length; i < 16; i++) result[i] = 0x20;
  }

  writeFilenameAligned(data, entryOff, result);
}

// ── Remove directory entry ────────────────────────────────────────────
function removeFileEntry(buffer, entryOff) {
  pushUndo();
  const data = new Uint8Array(buffer);
  const slots = getDirSlotOffsets(buffer);
  const idx = slots.indexOf(entryOff);
  if (idx < 0) return;

  // If removing a CBM partition, free its tracks in the root BAM
  var typeByte = data[entryOff + 2];
  if (!currentFormat.subdirLinked && (typeByte & 0x07) === currentFormat.subdirType) {
    var partStart = data[entryOff + 3];
    var partSize = data[entryOff + 30] | (data[entryOff + 31] << 8);
    var fmt = currentFormat;
    var partTracks = Math.floor(partSize / fmt.partitionSpt);
    var bamOff = sectorOffset(fmt.bamTrack, fmt.bamSector);

    for (var pt = partStart; pt < partStart + partTracks; pt++) {
      var spt = fmt.sectorsPerTrack(pt);
      var rbase;
      if (pt <= 40) {
        rbase = bamOff + 0x10 + (pt - 1) * 6;
      } else {
        rbase = bamOff + 256 + 0x10 + (pt - 41) * 6;
      }
      // Mark all sectors as free
      data[rbase] = spt; // free count = all sectors
      for (var rb = 0; rb < 5; rb++) data[rbase + 1 + rb] = 0xFF;
    }
  }

  // Shift all entries after the removed one up by one slot
  for (let i = idx; i < slots.length - 1; i++) {
    const src = slots[i + 1];
    const dst = slots[i];
    // Copy bytes 2-31 (entry data, preserve chain links)
    for (let j = 2; j < 32; j++) {
      data[dst + j] = data[src + j];
    }
  }

  // Zero out the last slot (now a duplicate or was already empty)
  const lastSlot = slots[slots.length - 1];
  for (let j = 2; j < 32; j++) {
    data[lastSlot + j] = 0x00;
  }
}

// ── Insert file entry ─────────────────────────────────────────────────
function getMaxDirEntries() {
  var ctx = getDirContext();
  return ctx.maxDirSectors * currentFormat.entriesPerSector;
}

function countDirEntries() {
  if (!currentBuffer) return 0;
  const data = new Uint8Array(currentBuffer);
  var ctx = getDirContext();
  let count = 0;
  let t = ctx.dirTrack, s = ctx.dirSector;
  const visited = new Set();
  while (t !== 0) {
    const key = `${t}:${s}`;
    if (visited.has(key)) break;
    visited.add(key);
    const off = sectorOffset(t, s);
    if (off < 0) break;
    for (let i = 0; i < 8; i++) {
      const eo = off + i * 32;
      const typeByte = data[eo + 2];
      if (typeByte !== 0x00) { count++; continue; }
      let hasData = false;
      for (let j = 3; j < 32; j++) {
        if (data[eo + j] !== 0x00) { hasData = true; break; }
      }
      if (hasData) count++;
    }
    t = data[off];
    s = data[off + 1];
  }
  return count;
}

function canInsertFile() {
  if (!currentBuffer) return false;
  return countDirEntries() < getMaxDirEntries();
}

function insertFileEntry() {
  if (!currentBuffer) return -1;
  const data = new Uint8Array(currentBuffer);
  var ctx = getDirContext();
  const bamOff = ctx.bamOff;

  // Walk directory chain, find first empty slot
  let t = ctx.dirTrack, s = ctx.dirSector;
  const visited = new Set();
  let lastOff = -1;

  while (t !== 0) {
    const key = `${t}:${s}`;
    if (visited.has(key)) break;
    visited.add(key);
    const off = sectorOffset(t, s);
    if (off < 0) break;
    lastOff = off;

    for (let i = 0; i < 8; i++) {
      const eo = off + i * 32;
      let isEmpty = true;
      for (let j = 2; j < 32; j++) {
        if (data[eo + j] !== 0x00) { isEmpty = false; break; }
      }
      if (isEmpty) {
        writeNewEntry(data, eo);
        return eo;
      }
    }

    t = data[off];
    s = data[off + 1];
  }

  // No empty slots — allocate a new directory sector
  var dirTrk, newSector;

  if (currentFormat.subdirLinked && currentPartition && currentPartition.dnpDir) {
    // Linked subdirs: directory can span any track
    var allocated = buildTrueAllocationMap(currentBuffer);
    var secList = allocateSectors(allocated, 1);
    if (secList.length === 0) return -1;
    dirTrk = secList[0].track;
    newSector = secList[0].sector;
  } else {
    // Standard: allocate on the directory track only
    dirTrk = ctx.dirTrackNum;
    const spt = sectorsPerTrack(dirTrk);
    var protectedSecs = new Set(currentFormat.getProtectedSectors(dirTrk));
    newSector = -1;
    for (let cs = 1; cs < spt; cs++) {
      if (visited.has(`${dirTrk}:${cs}`)) continue;
      if (protectedSecs.has(cs)) continue;
      newSector = cs;
      break;
    }
    if (newSector === -1) return -1;
  }

  if (lastOff >= 0) {
    data[lastOff] = dirTrk;
    data[lastOff + 1] = newSector;
  }

  const newOff = sectorOffset(dirTrk, newSector);
  data[newOff] = 0x00;
  data[newOff + 1] = 0xFF;
  for (let i = 2; i < 256; i++) data[newOff + i] = 0x00;

  writeNewEntry(data, newOff);

  // Mark sector as used in BAM
  bamMarkSectorUsed(data, dirTrk, newSector, bamOff);

  return newOff;
}

function writeNewEntry(data, entryOff) {
  // Type: PRG, closed
  data[entryOff + 2] = 0x82;
  // File start: 0/0 (no data yet)
  data[entryOff + 3] = 0;
  data[entryOff + 4] = 0;
  // Filename: filled with 0xA0 (empty name)
  for (let i = 0; i < 16; i++) data[entryOff + 5 + i] = 0xA0;
  // Unused bytes
  for (let i = 21; i < 30; i++) data[entryOff + i] = 0x00;
  // Block size: 0
  data[entryOff + 30] = 0;
  data[entryOff + 31] = 0;
}

// ── File menu: Rename ─────────────────────────────────────────────────
function writeFileName(buffer, entryOff, name, overrides) {
  writePetsciiString(buffer, entryOff + 5, name, 16, overrides);
}

// ── Change file type ──────────────────────────────────────────────────
function changeFileType(entryOff, newTypeIdx) {
  if (!currentBuffer) return;
  pushUndo();
  const data = new Uint8Array(currentBuffer);
  // Preserve closed (bit 7) and locked (bit 6), replace type bits (0-2)
  data[entryOff + 2] = (data[entryOff + 2] & 0xC0) | (newTypeIdx & 0x07);
  const info = parseCurrentDir(currentBuffer);
  renderDisk(info);
}

function showTypeDropdown(typeSpan, entryOff) {
  cancelActiveEdits();
  // Remove any existing dropdown
  const existing = document.querySelector('.type-dropdown');
  if (existing) existing.remove();

  const data = new Uint8Array(currentBuffer);
  const currentTypeIdx = data[entryOff + 2] & 0x07;

  const dropdown = document.createElement('div');
  dropdown.className = 'type-dropdown';

  FILE_TYPES.forEach((typeName, idx) => {
    const opt = document.createElement('div');
    opt.className = 'type-option';
    const check = document.createElement('span');
    check.className = 'check';
    check.innerHTML = idx === currentTypeIdx ? '<i class="fa-solid fa-check"></i>' : '';
    opt.appendChild(check);
    opt.appendChild(document.createTextNode(typeName));
    opt.addEventListener('click', (e) => {
      e.stopPropagation();
      dropdown.remove();
      changeFileType(entryOff, idx);
    });
    dropdown.appendChild(opt);
  });

  document.body.appendChild(dropdown);

  // Position above the type span
  const rect = typeSpan.getBoundingClientRect();
  dropdown.style.left = rect.left + 'px';
  // Place above; if not enough room, place below
  const dropH = dropdown.offsetHeight;
  if (rect.top - dropH > 0) {
    dropdown.style.top = (rect.top - dropH) + 'px';
  } else {
    dropdown.style.top = rect.bottom + 'px';
  }

  // Close on outside click
  function closeDropdown(e) {
    if (!dropdown.contains(e.target)) {
      dropdown.remove();
      document.removeEventListener('click', closeDropdown);
    }
  }
  setTimeout(() => document.addEventListener('click', closeDropdown), 0);
}

// ── Edit block size ───────────────────────────────────────────────────
// Max value for block size field: 16-bit unsigned (2 bytes in directory entry)
const MAX_BLOCKS = 65535;

// Check if a scratched file's sectors are still free (recoverable)
// Returns 'yes' (all free), 'partial' (some free), 'no' (none/invalid chain)
function checkScratchedRecoverable(buffer, entryOff) {
  var data = new Uint8Array(buffer);
  var ft = data[entryOff + 3], fs = data[entryOff + 4];
  if (ft === 0) return 'no';

  var fmt = currentFormat;
  var bamOff = sectorOffset(fmt.bamTrack, fmt.bamSector);
  var visited = {};
  var totalSectors = 0, freeSectors = 0;
  var t = ft, s = fs;

  while (t !== 0) {
    if (t < 1 || t > currentTracks) break;
    if (s >= fmt.sectorsPerTrack(t)) break;
    var key = t + ':' + s;
    if (visited[key]) break;
    visited[key] = true;
    totalSectors++;

    // Check if this sector is free in BAM
    if (checkSectorFree(data, bamOff, t, s)) freeSectors++;

    var off = sectorOffset(t, s);
    if (off < 0) break;
    t = data[off]; s = data[off + 1];
  }

  if (totalSectors === 0) return 'no';
  if (freeSectors === totalSectors) return 'yes';
  if (freeSectors > 0) return 'partial';
  return 'no';
}

function getFileAddresses(buffer, entryOff) {
  const data = new Uint8Array(buffer);
  const typeByte = data[entryOff + 2];
  const fileType = typeByte & 0x07;

  // GEOS VLIR: dir T/S points to the index sector, not file data
  if (data[entryOff + 0x18] > 0 && fileType !== FILE_TYPE.REL && data[entryOff + 0x17] === 0x01) {
    return null;
  }

  let t = data[entryOff + 3];
  let s = data[entryOff + 4];
  if (t === 0) return null;

  // Read first sector to get load address (first 2 data bytes for PRG)
  const firstOff = sectorOffset(t, s);
  if (firstOff < 0) return null;

  // For PRG files, bytes 2-3 of first sector are the load address
  // For other types, there's no standard load address
  const startAddr = data[firstOff + 2] | (data[firstOff + 3] << 8);

  // Follow chain to find total data size
  const visited = new Set();
  let totalBytes = 0;
  let lastUsed = 0;
  while (t !== 0) {
    if (t < 1 || t > currentTracks) break;
    if (s < 0 || s >= sectorsPerTrack(t)) break;
    const key = `${t}:${s}`;
    if (visited.has(key)) break;
    visited.add(key);

    const off = sectorOffset(t, s);
    const nextT = data[off];
    const nextS = data[off + 1];

    if (nextT === 0) {
      // Last sector: nextS = number of bytes used in this sector (1-based)
      lastUsed = nextS;
      totalBytes += Math.max(0, nextS - 1); // -1 because byte count includes the pointer byte
    } else {
      totalBytes += 254; // 256 - 2 byte pointer
    }

    t = nextT;
    s = nextS;
  }

  // For PRG: subtract 2 for the load address bytes stored in the data
  // End address = start + data size - 1
  if (fileType === 2) { // PRG
    const dataSize = Math.max(0, totalBytes - 2);
    const endAddr = (startAddr + dataSize) & 0xFFFF;
    return { start: startAddr, end: endAddr };
  }

  // For other types, show start address and data extent
  const endAddr = (startAddr + Math.max(0, totalBytes - 1)) & 0xFFFF;
  return { start: startAddr, end: endAddr };
}

function countActualBlocks(buffer, entryOff) {
  const data = new Uint8Array(buffer);
  const fmt = currentFormat;
  let t = data[entryOff + 3];
  let s = data[entryOff + 4];
  if (t === 0) return 0;

  function followChain(ft, fs) {
    var count = 0;
    var visited = {};
    while (ft !== 0) {
      if (ft < 1 || ft > currentTracks) break;
      if (fs < 0 || fs >= sectorsPerTrack(ft)) break;
      var key = ft + ':' + fs;
      if (visited[key]) break;
      visited[key] = true;
      count++;
      var off = sectorOffset(ft, fs);
      ft = data[off]; fs = data[off + 1];
    }
    return count;
  }

  var blocks = followChain(t, s);
  var typeIdx = data[entryOff + 2] & 0x07;

  // REL file: also count side-sector chain
  if (typeIdx === FILE_TYPE.REL) {
    blocks += followChain(data[entryOff + 0x15], data[entryOff + 0x16]);
  }

  // GEOS file: count info block and (for VLIR) record chains
  if (data[entryOff + 0x18] > 0 && typeIdx !== FILE_TYPE.REL) {
    var infoT = data[entryOff + 0x15];
    var infoS = data[entryOff + 0x16];
    if (infoT >= 1 && infoT <= currentTracks && infoS < fmt.sectorsPerTrack(infoT)) {
      blocks++; // info block
    }
    // VLIR: follow each record's sector chain from the index
    if (data[entryOff + 0x17] === 0x01) {
      var vlirOff = sectorOffset(t, s);
      if (vlirOff >= 0) {
        for (var vri = 0; vri < 127; vri++) {
          var recT = data[vlirOff + 2 + vri * 2];
          var recS = data[vlirOff + 2 + vri * 2 + 1];
          if (recT === 0 && recS === 0) break;
          if (recT === 0) continue; // empty slot
          blocks += followChain(recT, recS);
        }
      }
    }
  }

  return blocks;
}

// ── Free blocks editing ───────────────────────────────────────────────
// Free block count per track is a single byte (0-255), stored in BAM.
// BAM only covers tracks 1-35. Data tracks = tracks 1-35 minus track 18.
// 34 data tracks × 255 = 8670 max.
function getMaxFreeBlocks() {
  // Max = (number of BAM tracks - 1 for dir track) × 255 per track byte
  var bamTracks = currentFormat.bamTracksRange(currentTracks);
  return (bamTracks - 1) * 255;
}

function writeFreeBlocks(buffer, freeBlocks) {
  const data = new Uint8Array(buffer);
  const bamOff = sectorOffset(currentFormat.bamTrack, currentFormat.bamSector);

  // BAM only covers tracks 1-35
  const bamTracks = currentFormat.bamTracksRange(currentTracks);

  // Read current per-track free counts and their max
  const tracks = [];
  let currentTotal = 0;
  for (let t = 1; t <= bamTracks; t++) {
    if (t === currentFormat.dirTrack) continue;
    const free = currentFormat.readTrackFree(data, bamOff, t);
    const spt = sectorsPerTrack(t);
    tracks.push({ t, free, spt });
    currentTotal += free;
  }

  const desired = Math.max(0, freeBlocks);
  const diff = desired - currentTotal;

  if (diff === 0) return;

  if (diff > 0) {
    // Need more free blocks — increase tracks that aren't at max yet
    let remaining = diff;
    for (const tr of tracks) {
      if (remaining <= 0) break;
      const canAdd = Math.min(255, tr.spt) - tr.free;
      if (canAdd > 0) {
        const add = Math.min(remaining, canAdd);
        tr.free += add;
        remaining -= add;
      }
    }
    // If still remaining (exceeding real max), overflow into first tracks
    for (const tr of tracks) {
      if (remaining <= 0) break;
      const canAdd = 255 - tr.free;
      if (canAdd > 0) {
        const add = Math.min(remaining, canAdd);
        tr.free += add;
        remaining -= add;
      }
    }
  } else {
    // Need fewer free blocks — decrease tracks that have free sectors
    let remaining = -diff;
    for (let i = tracks.length - 1; i >= 0; i--) {
      if (remaining <= 0) break;
      const tr = tracks[i];
      const canRemove = tr.free;
      if (canRemove > 0) {
        const remove = Math.min(remaining, canRemove);
        tr.free -= remove;
        remaining -= remove;
      }
    }
  }

  // Write back only the count bytes, leave bitmaps untouched
  for (const tr of tracks) {
    currentFormat.writeTrackFree(data, bamOff, tr.t, tr.free);
  }
}

function countActualFreeBlocks(buffer) {
  const data = new Uint8Array(buffer);
  const bamOff = sectorOffset(currentFormat.bamTrack, currentFormat.bamSector);
  let free = 0;
  const bamTracks = currentFormat.bamTracksRange(currentTracks);
  for (let t = 1; t <= bamTracks; t++) {
    if (t === currentFormat.dirTrack) continue;
    free += currentFormat.readTrackFree(data, bamOff, t);
  }
  return free;
}

function startEditFreeBlocks(blocksSpan) {
  if (!currentBuffer || !blocksSpan || isTapeFormat()) return;
  if (blocksSpan.querySelector('input')) return;

  cancelActiveEdits();
  const currentValue = blocksSpan.textContent.trim();

  const input = document.createElement('input');
  input.type = 'number';
  input.min = '0';
  input.max = String(getMaxFreeBlocks());
  input.value = currentValue;
  input.className = 'blocks-input';

  blocksSpan.textContent = '';
  blocksSpan.appendChild(input);
  blocksSpan.classList.add('editing');
  input.focus();
  input.select();

  let reverted = false;

  function cleanup() {
    blocksSpan.classList.remove('editing');
    activeEditEl = null;
    activeEditCleanup = null;
  }

  function commitEdit() {
    if (reverted) return;
    pushUndo();
    let value = parseInt(input.value, 10);
    if (isNaN(value) || value < 0) value = 0;
    if (value > getMaxFreeBlocks()) value = getMaxFreeBlocks();
    writeFreeBlocks(currentBuffer, value);
    cleanup();
    blocksSpan.textContent = value;
  }

  function revert() {
    reverted = true;
    cleanup();
    blocksSpan.textContent = currentValue;
  }

  input.addEventListener('blur', () => {
    if (pickerClicking) { input.focus(); input.selectionStart = input.selectionEnd = input._lastCursorPos || 0; return; }
    commitEdit();
  });
  input.addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter') { ev.preventDefault(); ev.stopPropagation(); commitEdit(); }
    else if (ev.key === 'Escape') { ev.preventDefault(); ev.stopPropagation(); revert(); }
  });

  registerActiveEdit(blocksSpan, revert);
}

function writeBlockSize(buffer, entryOff, blocks) {
  const data = new Uint8Array(buffer);
  data[entryOff + 30] = blocks & 0xFF;
  data[entryOff + 31] = (blocks >> 8) & 0xFF;
}

// ── Reusable hex input ────────────────────────────────────────────────
// Creates a hex input element with validation.
// Options: { value, maxBytes (1 or 2), validate(val) → bool }
function createHexInput(options) {
  const maxChars = (options.maxBytes || 1) * 2;
  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'hex-input';
  input.maxLength = maxChars;
  input.value = (options.value || 0).toString(16).toUpperCase().padStart(maxChars, '0');
  input.style.width = (maxChars + 1) + 'ch';

  const validateAndMark = () => {
    const val = parseInt(input.value, 16);
    const valid = !isNaN(val) && input.value.length > 0 &&
      /^[0-9A-Fa-f]*$/.test(input.value) &&
      (!options.validate || options.validate(val));
    input.classList.toggle('invalid', !valid);
    return valid;
  };

  input.addEventListener('input', () => {
    // Strip non-hex chars
    input.value = input.value.replace(/[^0-9A-Fa-f]/g, '').toUpperCase().slice(0, maxChars);
    validateAndMark();
  });

  input.addEventListener('keydown', (e) => {
    // Allow: backspace, delete, tab, arrow keys, home, end, select all
    if (['Backspace','Delete','Tab','ArrowLeft','ArrowRight','Home','End'].includes(e.key)) return;
    if (e.ctrlKey && e.key === 'a') return;
    // Allow hex chars
    if (/^[0-9A-Fa-f]$/.test(e.key)) return;
    e.preventDefault();
  });

  input.getValue = () => parseInt(input.value, 16) || 0;
  input.isValid = validateAndMark;
  validateAndMark();

  return input;
}

// ── Track/Sector editor ──────────────────────────────────────────────
function startEditTrackSector(entryEl) {
  if (!currentBuffer || !entryEl) return;
  const entryOff = parseInt(entryEl.dataset.offset, 10);
  const tsSpan = entryEl.querySelector('.dir-ts');
  if (!tsSpan || tsSpan.querySelector('.hex-input-group')) return;

  cancelActiveEdits();
  const data = new Uint8Array(currentBuffer);
  const curTrack = data[entryOff + 3];
  const curSector = data[entryOff + 4];

  const group = document.createElement('span');
  group.className = 'hex-input-group';

  const trackInput = createHexInput({
    value: curTrack,
    maxBytes: 1,
    validate: (val) => val >= 0 && val <= currentTracks
  });

  const sep = document.createElement('span');
  sep.className = 'hex-input-sep';
  sep.textContent = '/';

  const sectorInput = createHexInput({
    value: curSector,
    maxBytes: 1,
    validate: (val) => {
      const t = trackInput.getValue();
      if (t < 1 || t > currentTracks) return false;
      return val >= 0 && val < sectorsPerTrack(t);
    }
  });

  // Re-validate sector when track changes
  trackInput.addEventListener('input', () => sectorInput.isValid());

  group.appendChild(trackInput);
  group.appendChild(sep);
  group.appendChild(sectorInput);

  tsSpan.textContent = '';
  tsSpan.appendChild(group);
  tsSpan.classList.add('editing');

  trackInput.focus();
  trackInput.select();

  let reverted = false;

  function cleanup() {
    tsSpan.classList.remove('editing');
    activeEditEl = null;
    activeEditCleanup = null;
  }

  function commitEdit() {
    if (reverted) return;
    if (!trackInput.isValid() || !sectorInput.isValid()) {
      revert();
      return;
    }
    pushUndo();
    const newTrack = trackInput.getValue();
    const newSector = sectorInput.getValue();
    data[entryOff + 3] = newTrack;
    data[entryOff + 4] = newSector;
    cleanup();
    // Re-render to update address column
    const info = parseCurrentDir(currentBuffer);
    renderDisk(info);
  }

  function revert() {
    reverted = true;
    cleanup();
    tsSpan.textContent = '$' + curTrack.toString(16).toUpperCase().padStart(2, '0') +
      ' $' + curSector.toString(16).toUpperCase().padStart(2, '0');
  }

  function onBlur(e) {
    // Don't commit if focus moved to the other input in the group
    if (pickerClicking) return;
    setTimeout(() => {
      if (reverted) return;
      if (!group.contains(document.activeElement)) {
        commitEdit();
      }
    }, 10);
  }

  function onKeyDown(e) {
    if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); commitEdit(); }
    else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); revert(); }
    else if (e.key === 'Tab') {
      e.preventDefault();
      if (e.target === trackInput) {
        sectorInput.focus();
        sectorInput.select();
      } else {
        trackInput.focus();
        trackInput.select();
      }
    }
  }

  trackInput.addEventListener('blur', onBlur);
  sectorInput.addEventListener('blur', onBlur);
  trackInput.addEventListener('keydown', onKeyDown);
  sectorInput.addEventListener('keydown', onKeyDown);

  registerActiveEdit(tsSpan, revert);
}

function startEditBlockSize(entryEl) {
  if (!currentBuffer || !entryEl) return;
  const entryOff = parseInt(entryEl.dataset.offset, 10);
  const blocksSpan = entryEl.querySelector('.dir-blocks');
  if (blocksSpan.querySelector('input')) return;

  cancelActiveEdits();
  const currentValue = blocksSpan.textContent.trim();

  const input = document.createElement('input');
  input.type = 'number';
  input.min = '0';
  input.max = String(MAX_BLOCKS);
  input.value = currentValue;
  input.className = 'blocks-input';

  blocksSpan.textContent = '';
  blocksSpan.appendChild(input);
  blocksSpan.classList.add('editing');
  input.focus();
  input.select();

  let reverted = false;

  function cleanup() {
    blocksSpan.classList.remove('editing');
    activeEditEl = null;
    activeEditCleanup = null;
  }

  function commitEdit() {
    if (reverted) return;
    pushUndo();
    let value = parseInt(input.value, 10);
    if (isNaN(value) || value < 0) value = 0;
    if (value > MAX_BLOCKS) value = MAX_BLOCKS;
    writeBlockSize(currentBuffer, entryOff, value);
    cleanup();
    blocksSpan.textContent = value;
  }

  function revert() {
    reverted = true;
    cleanup();
    blocksSpan.textContent = currentValue;
  }

  input.addEventListener('blur', () => {
    if (pickerClicking) { input.focus(); input.selectionStart = input.selectionEnd = input._lastCursorPos || 0; return; }
    commitEdit();
  });
  input.addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter') { ev.preventDefault(); ev.stopPropagation(); commitEdit(); }
    else if (ev.key === 'Escape') { ev.preventDefault(); ev.stopPropagation(); revert(); }
  });

  registerActiveEdit(blocksSpan, revert);
}

function startRenameEntry(entryEl) {
  if (!currentBuffer || !entryEl || isTapeFormat()) return;
  const entryOff = parseInt(entryEl.dataset.offset, 10);
  const nameSpan = entryEl.querySelector('.dir-name');
  if (nameSpan.querySelector('input')) return;

  cancelActiveEdits();
  // Read actual content from buffer (stops at 0xA0 padding)
  const currentValue = readPetsciiString(new Uint8Array(currentBuffer), entryOff + 5, 16);

  const input = document.createElement('input');
  input.type = 'text';
  input.maxLength = 16;
  input.value = currentValue;
  input.className = 'name-input';

  nameSpan.textContent = '';
  nameSpan.appendChild(input);
  nameSpan.classList.add('editing');
  trackCursorPos(input);
  input.focus();
  input.selectionStart = input.selectionEnd = currentValue.length;

  showPetsciiPicker(input, 16);

  let reverted = false;

  function cleanup() {
    nameSpan.classList.remove('editing');
    hidePetsciiPicker();
    activeEditEl = null;
    activeEditCleanup = null;
  }

  function commitRename() {
    if (reverted) return;
    let value = filterC64Input(input.value, 16);
    if (currentBuffer) {
      pushUndo();
      writeFileName(currentBuffer, entryOff, value, input._petsciiOverrides);
    }
    cleanup();
    // Re-render to show reversed chars properly
    const info = parseCurrentDir(currentBuffer);
    renderDisk(info);
  }

  function revert() {
    reverted = true;
    cleanup();
    nameSpan.textContent = '"' + currentValue.padEnd(16) + '"';
  }

  input.addEventListener('blur', () => {
    if (pickerClicking) { input.focus(); input.selectionStart = input.selectionEnd = input._lastCursorPos || 0; return; }
    commitRename();
  });
  input.addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter') { ev.preventDefault(); ev.stopPropagation(); commitRename(); }
    else if (ev.key === 'Escape') { ev.preventDefault(); ev.stopPropagation(); revert(); }
  });

  registerActiveEdit(nameSpan, revert);
}

document.getElementById('opt-rename').addEventListener('click', (e) => {
  e.stopPropagation();
  if (!currentBuffer || selectedEntryIndex < 0) return;
  closeMenus();
  const selected = document.querySelector('.dir-entry.selected');
  startRenameEntry(selected);
});

// Insert a new entry and position it after the selected entry (or at end)
function insertAndPosition() {
  if (!currentBuffer || !canInsertFile()) return -1;
  var newOff = insertFileEntry();
  if (newOff < 0) return -1;

  if (selectedEntryIndex >= 0 && selectedEntryIndex !== newOff) {
    var slots = getDirSlotOffsets(currentBuffer);
    var selIdx = slots.indexOf(selectedEntryIndex);
    var newIdx = slots.indexOf(newOff);
    if (selIdx >= 0 && newIdx >= 0 && newIdx > selIdx + 1) {
      var cur = newIdx;
      var target = selIdx + 1;
      while (cur !== target) {
        swapDirEntries(currentBuffer, slots[cur], slots[cur - 1]);
        cur--;
      }
      newOff = slots[target];
    }
  }
  return newOff;
}

document.getElementById('opt-insert').addEventListener('click', (e) => {
  e.stopPropagation();
  if (!currentBuffer || !canInsertFile()) return;
  closeMenus();
  var newOff = insertAndPosition();
  if (newOff < 0) return;
  selectedEntryIndex = newOff;
  var info = parseCurrentDir(currentBuffer);
  renderDisk(info);
});

// ── Insert Separator ──────────────────────────────────────────────────
// Separator patterns — each is a 16-byte array or a single byte (repeated 16x)
// PETSCII codes for box drawing: $C0=─, $DD=│, $B0=┌, $AE=┐, $AD=└, $BD=┘, $AB=├, $B3=┤, $B1=┴, $B2=┬
// PETSCII box drawing: $C0=─, $DD=│, $B0=┌, $AE=┐, $AD=└, $BD=┘, $AB=├, $B3=┤, $B1=┴, $B2=┬
// Rounded corners: $D5=╭, $C9=╮, $CA=╰, $CB=╯
// Diagonals: $CD=╱, $CC=╲
var _h14 = [0xC0,0xC0,0xC0,0xC0,0xC0,0xC0,0xC0,0xC0,0xC0,0xC0,0xC0,0xC0,0xC0,0xC0];
var _s14 = [0x20,0x20,0x20,0x20,0x20,0x20,0x20,0x20,0x20,0x20,0x20,0x20,0x20,0x20];
var DEFAULT_SEPARATORS = [
  { name: 'Horizontal line', bytes: [0xC0,0xC0,0xC0,0xC0,0xC0,0xC0,0xC0,0xC0,0xC0,0xC0,0xC0,0xC0,0xC0,0xC0,0xC0,0xC0] },
  { name: 'Wavy line',       bytes: [0x66,0x72,0xAF,0x72,0x66,0xC0,0x64,0x65,0x65,0x64,0x60,0x66,0x72,0xAF,0x72,0x66] },
  { name: 'Top sharp',       bytes: [0xB0].concat(_h14,[0xAE]) },
  { name: 'Bottom sharp',    bytes: [0xAD].concat(_h14,[0xBD]) },
  { name: 'T-junction',      bytes: [0xAB].concat(_h14,[0xB3]) },
  { name: 'Sides',           bytes: [0xDD].concat(_s14,[0xDD]) },
  { name: 'Top rounded',     bytes: [0xD5].concat(_h14,[0xC9]) },
  { name: 'Bottom rounded',  bytes: [0xCA].concat(_h14,[0xCB]) },
];

// Custom separators stored in localStorage
var customSeparators = JSON.parse(localStorage.getItem('cbm-customSeparators') || '[]');

function saveCustomSeparators() {
  localStorage.setItem('cbm-customSeparators', JSON.stringify(customSeparators));
}

function separatorExists(bytes) {
  for (var i = 0; i < customSeparators.length; i++) {
    var match = true;
    for (var j = 0; j < 16; j++) {
      if (customSeparators[i].bytes[j] !== bytes[j]) { match = false; break; }
    }
    if (match) return true;
  }
  return false;
}

function getAllSeparators() {
  return DEFAULT_SEPARATORS.concat(customSeparators);
}

function sepBytesToPreview(bytes) {
  var preview = '';
  for (var j = 0; j < 16; j++) preview += escHtml(PETSCII_MAP[bytes[j] || 0xA0]);
  return preview;
}

// Build the separator submenu
function buildSepSubmenu() {
  var submenu = document.getElementById('sep-submenu');
  if (!submenu) return;
  var all = getAllSeparators();
  var html = '';
  for (var i = 0; i < all.length; i++) {
    if (i === DEFAULT_SEPARATORS.length && customSeparators.length > 0) {
      html += '<div class="separator"></div>';
    }
    var sepLabel = all[i].name ? ' <span style="font-size:11px;color:var(--text-muted)">' + escHtml(all[i].name) + '</span>' : '';
    html += '<div class="option" data-sep-idx="' + i + '" title="' + escHtml(all[i].name) + '">' +
      '<span style="font-family:\'C64 Pro Mono\',monospace;font-size:12px">' + sepBytesToPreview(all[i].bytes) + '</span>' + sepLabel + '</div>';
  }
  submenu.innerHTML = html;
}

// Separator editor modal
function showSeparatorEditor() {
  var editIdx = -1; // -1 = not editing, >= 0 = editing custom separator at this index

  function render() {
    var html = '<div class="sep-editor-layout">';
    html += '<div class="sep-editor-list">';
    // Default separators (read-only)
    for (var i = 0; i < DEFAULT_SEPARATORS.length; i++) {
      html += '<div class="sep-editor-item">';
      html += '<span class="sep-editor-preview">' + sepBytesToPreview(DEFAULT_SEPARATORS[i].bytes) + '</span>';
      html += '<span style="font-size:11px;color:var(--text-muted)">' + escHtml(DEFAULT_SEPARATORS[i].name) + '</span>';
      html += '</div>';
    }
    // Custom separators
    for (var j = 0; j < customSeparators.length; j++) {
      html += '<div class="sep-editor-item">';
      html += '<span class="sep-editor-preview">' + sepBytesToPreview(customSeparators[j].bytes) + '</span>';
      if (customSeparators[j].name) html += '<span style="font-size:11px;color:var(--text-muted)">' + escHtml(customSeparators[j].name) + '</span>';
      html += '<button class="sep-editor-btn" data-action="edit" data-cidx="' + j + '"><i class="fa-solid fa-pen"></i></button>';
      html += '<button class="sep-editor-btn danger" data-action="delete" data-cidx="' + j + '"><i class="fa-solid fa-trash"></i></button>';
      html += '</div>';
    }
    html += '</div>';

    // Add/Edit form (fixed at bottom)
    html += '<div class="sep-editor-form">';
    html += '<div style="display:flex;gap:8px;align-items:center;margin-bottom:4px">';
    html += '<input type="text" id="sep-edit-input" class="sep-editor-input" maxlength="16" value="" placeholder="Pattern">';
    html += '<input type="text" id="sep-edit-name" style="flex:1;padding:4px 8px;background:var(--bg-input);color:var(--text);border:1px solid var(--border);border-radius:3px;font-size:12px;outline:none" value="' +
      (editIdx >= 0 ? escHtml(customSeparators[editIdx].name || '') : '') + '" placeholder="Name (optional)">';
    html += '<button class="sep-editor-btn" id="sep-edit-save">' + (editIdx >= 0 ? 'Update' : 'Add') + '</button>';
    if (editIdx >= 0) html += '<button class="sep-editor-btn" id="sep-edit-cancel">Cancel</button>';
    html += '</div>';
    html += '</div>';
    html += '</div>'; // close sep-editor-layout

    return html;
  }

  showModal('Edit Separators', []);
  var body = document.getElementById('modal-body');
  body.innerHTML = render();

  function attachEvents() {
    var input = document.getElementById('sep-edit-input');
    if (input) {
      // Track cursor for PETSCII picker insertion
      var updateCursor = function() { input._lastCursorPos = input.selectionStart; };
      input.addEventListener('keyup', updateCursor);
      input.addEventListener('mouseup', updateCursor);
      input.addEventListener('input', updateCursor);

      input.addEventListener('focus', function() { showPetsciiPicker(input, 16); });
      input.addEventListener('blur', function() { if (!pickerClicking) hidePetsciiPicker(); });
    }

    body.addEventListener('click', function handler(e) {
      if (e.target.tagName === 'INPUT') return;
      var btn = e.target.closest('[data-action]');
      if (!btn) {
        // Save/Cancel buttons
        if (e.target.closest('#sep-edit-save')) {
          var inp = document.getElementById('sep-edit-input');
          if (!inp || inp.value.length === 0) return;
          // Convert input value to PETSCII bytes (no padding)
          var bytes = [];
          for (var k = 0; k < inp.value.length; k++) {
            bytes.push(unicodeToPetscii(inp.value[k]));
          }
          var nameInput = document.getElementById('sep-edit-name');
          var sepName = nameInput ? nameInput.value.trim() : '';
          if (editIdx >= 0) {
            customSeparators[editIdx].bytes = bytes;
            customSeparators[editIdx].name = sepName;
          } else {
            if (separatorExists(bytes)) { render(); return; }
            customSeparators.push({ name: sepName, bytes: bytes });
          }
          saveCustomSeparators();
          buildSepSubmenu();
          editIdx = -1;
          body.removeEventListener('click', handler);
          body.innerHTML = render();
          attachEvents();
          return;
        }
        if (e.target.closest('#sep-edit-cancel')) {
          editIdx = -1;
          body.removeEventListener('click', handler);
          body.innerHTML = render();
          attachEvents();
          return;
        }
        return;
      }

      var action = btn.getAttribute('data-action');
      var cidx = parseInt(btn.getAttribute('data-cidx'), 10);

      if (action === 'delete') {
        customSeparators.splice(cidx, 1);
        saveCustomSeparators();
        buildSepSubmenu();
        editIdx = -1;
        body.removeEventListener('click', handler);
        body.innerHTML = render();
        attachEvents();
      } else if (action === 'edit') {
        editIdx = cidx;
        body.removeEventListener('click', handler);
        body.innerHTML = render();
        // Pre-fill input with existing bytes
        var inp2 = document.getElementById('sep-edit-input');
        if (inp2) {
          var val = '';
          for (var m = 0; m < customSeparators[cidx].bytes.length; m++) {
            var ch = PETSCII_MAP[customSeparators[cidx].bytes[m]];
            if (ch) val += ch;
          }
          inp2.value = val;
        }
        attachEvents();
      }
    });
  }

  attachEvents();
}

document.getElementById('opt-undo').addEventListener('click', function(e) {
  e.stopPropagation();
  closeMenus();
  if (popUndo()) {
    var info = parseCurrentDir(currentBuffer);
    renderDisk(info);
    updateMenuState();
    updateEntryMenuState();
  }
});

document.getElementById('opt-edit-separators').addEventListener('click', function(e) {
  e.stopPropagation();
  closeMenus();
  showSeparatorEditor();
});

document.getElementById('opt-save-sep').addEventListener('click', async function(e) {
  e.stopPropagation();
  if (!currentBuffer || selectedEntryIndex < 0) return;
  closeMenus();

  var data = new Uint8Array(currentBuffer);
  var bytes = [];
  for (var i = 0; i < 16; i++) bytes.push(data[selectedEntryIndex + 5 + i]);

  if (separatorExists(bytes)) {
    showModal('Save as Separator', ['This separator already exists.']);
    return;
  }

  var name = await showInputModal('Separator Name (optional)', '');
  if (name === null) return; // cancelled

  customSeparators.push({ name: name || '', bytes: bytes });
  saveCustomSeparators();
  buildSepSubmenu();
  showModal('Save as Separator', ['Separator saved.' + (name ? ' Name: "' + name + '"' : '')]);
});

function insertSeparator(pattern) {
  if (!currentBuffer || !canInsertFile()) return;
  var newOff = insertAndPosition();
  if (newOff < 0) return;

  // Convert to a closed DEL with the separator pattern
  var data = new Uint8Array(currentBuffer);
  data[newOff + 2] = 0x80; // DEL, closed (not scratched)
  data[newOff + 3] = 0x00; // track 0
  data[newOff + 4] = 0x00; // sector 0
  var patBytes = pattern.bytes || [];
  var patLen = patBytes.length;
  for (var i = 0; i < 16; i++) {
    if (pattern.byte !== undefined) {
      data[newOff + 5 + i] = pattern.byte;
    } else if (i < patLen) {
      data[newOff + 5 + i] = patBytes[i];
    }
  }
  data[newOff + 30] = 0x00; // 0 blocks
  data[newOff + 31] = 0x00;

  selectedEntryIndex = newOff;
  var info = parseCurrentDir(currentBuffer);
  renderDisk(info);
}

// Build submenu on load and when charset changes
buildSepSubmenu();

document.getElementById('sep-submenu').addEventListener('click', function(e) {
  e.stopPropagation();
  var opt = e.target.closest('[data-sep-idx]');
  if (!opt) return;
  var idx = parseInt(opt.getAttribute('data-sep-idx'), 10);
  var all = getAllSeparators();
  if (isNaN(idx) || idx < 0 || idx >= all.length) return;
  closeMenus();
  insertSeparator(all[idx]);
});

document.getElementById('opt-remove').addEventListener('click', async (e) => {
  e.stopPropagation();
  if (!currentBuffer || selectedEntryIndex < 0) return;
  closeMenus();

  var removeEntryOff = selectedEntryIndex;
  var data = new Uint8Array(currentBuffer);
  var typeByte = data[removeEntryOff + 2];
  var isCBM = !currentFormat.subdirLinked && (typeByte & 0x07) === currentFormat.subdirType;

  // Check if this is a CBM partition with files inside
  if (isCBM) {
    var partStart = data[removeEntryOff + 3];
    var partSize = data[removeEntryOff + 30] | (data[removeEntryOff + 31] << 8);
    var partInfo = parsePartition(currentBuffer, partStart, partSize);
    var fileEntries = partInfo ? partInfo.entries.filter(function(en) { return !en.deleted; }) : [];

    if (fileEntries.length > 0) {
      var choice = await showChoiceModal(
        'Remove Directory',
        'This directory contains ' + fileEntries.length + ' file(s). What would you like to do?',
        [
          { label: 'Cancel', value: 'cancel', secondary: true },
          { label: 'Move to Root', value: 'move' },
          { label: 'Remove All', value: 'remove' }
        ]
      );

      if (choice === 'cancel') return;

      if (choice === 'move') {
        // Take snapshot before any changes
        var snapshot = currentBuffer.slice(0);

        // Count available root directory slots
        var freeSlots = getMaxDirEntries() - countDirEntries();
        // We'll also free one slot by removing the partition entry itself
        freeSlots += 1;

        if (freeSlots < fileEntries.length) {
          // Not enough room — show which files can't be moved
          var canMove = freeSlots;
          var cantMove = fileEntries.slice(canMove);
          var lostNames = cantMove.map(function(en) {
            return '"' + petsciiToReadable(en.name).trim() + '"';
          });
          var msg = 'Only ' + canMove + ' of ' + fileEntries.length +
            ' files can be moved to root. The following ' + cantMove.length +
            ' file(s) will be lost:';
          var choice2 = await showChoiceModal(
            'Not Enough Directory Entries',
            msg,
            [
              { label: 'Revert', value: 'revert', secondary: true },
              { label: 'Continue', value: 'continue' }
            ],
            lostNames
          );

          if (choice2 === 'revert') return;
        }

        // Move files from partition to root directory
        var moveCount = Math.min(fileEntries.length, freeSlots);
        for (var fi = 0; fi < moveCount; fi++) {
          var srcOff = fileEntries[fi].entryOff;
          var dstOff = findFreeDirEntry(currentBuffer);
          if (dstOff < 0) break;
          var moveData = new Uint8Array(currentBuffer);
          for (var j = 2; j < 32; j++) moveData[dstOff + j] = moveData[srcOff + j];
        }
      }
      // For both 'move' and 'remove': proceed to remove the partition entry
    }
  }

  const slots = getDirSlotOffsets(currentBuffer);
  const idx = slots.indexOf(removeEntryOff);
  removeFileEntry(currentBuffer, removeEntryOff);
  const info = parseCurrentDir(currentBuffer);
  const visibleEntries = info.entries.filter(en => !en.deleted || showDeleted);
  if (visibleEntries.length > 0) {
    const newIdx = Math.min(idx, visibleEntries.length - 1);
    selectedEntryIndex = visibleEntries[newIdx].entryOff;
    selectedEntries = [selectedEntryIndex];
  } else {
    selectedEntryIndex = -1;
    selectedEntries = [];
  }
  renderDisk(info);
  updateMenuState();
});

document.querySelectorAll('#opt-align .submenu .option').forEach(el => {
  el.addEventListener('click', (e) => {
    e.stopPropagation();
    if (!currentBuffer || selectedEntryIndex < 0) return;
    closeMenus();
    var entries = selectedEntries.length > 0 ? selectedEntries : [selectedEntryIndex];
    for (var ai = 0; ai < entries.length; ai++) alignFilename(currentBuffer, entries[ai], el.dataset.align);
    const info = parseCurrentDir(currentBuffer);
    renderDisk(info);
  });
});

document.getElementById('opt-block-size').addEventListener('click', (e) => {
  e.stopPropagation();
  if (!currentBuffer || selectedEntryIndex < 0) return;
  closeMenus();
  const selected = document.querySelector('.dir-entry.selected');
  startEditBlockSize(selected);
});

document.getElementById('opt-recalc-size').addEventListener('click', (e) => {
  e.stopPropagation();
  if (!currentBuffer || selectedEntryIndex < 0) return;
  closeMenus();
  pushUndo();
  var entries = selectedEntries.length > 0 ? selectedEntries : [selectedEntryIndex];
  for (var ri = 0; ri < entries.length; ri++) {
    var actual = countActualBlocks(currentBuffer, entries[ri]);
    writeBlockSize(currentBuffer, entries[ri], actual);
  }
  const info = parseCurrentDir(currentBuffer);
  renderDisk(info);
});

