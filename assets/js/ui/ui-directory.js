// ── Move directory entry ──────────────────────────────────────────────
// Get ordered list of directory entry offsets from the chain
// ── Partition-aware parse helper ──────────────────────────────────────
function parseCurrentDir(buffer) {
  // CMD container, partition-list view: nothing to parse as a disk.
  // Render path detects this and draws the partition list instead.
  if (cmdcPartitions && cmdcPartitionIdx === -1) {
    var ct = cmdcContainerKey ? CMD_CONTAINERS[cmdcContainerKey] : null;
    return { entries: [], freeBlocks: 0, diskName: cmdcFileName || (ct ? ct.name : 'Container'), diskId: '' };
  }
  if (currentPartition) {
    if (currentPartition.dnpDir) {
      return parseDnpDirectory(buffer, currentPartition.dnpDirT, currentPartition.dnpDirS,
        currentPartition.name, currentPartition.dnpHeaderT, currentPartition.dnpHeaderS);
    }
    return parsePartition(buffer, currentPartition.startTrack, currentPartition.partSize, getCurrentCtx());
  }
  // Inside a CMD container partition slice: preserve the format set by
  // enterCmdContainerPartition. detectFormat would otherwise misidentify
  // slices whose size coincides with a standard format (e.g. a 819200-byte
  // Native partition reading as D81).
  var hint = null;
  if (cmdcPartitions && cmdcPartitionIdx >= 0 && currentFormat) {
    for (var key in DISK_FORMATS) {
      if (DISK_FORMATS[key] === currentFormat) { hint = key; break; }
    }
  }
  return parseDisk(buffer, hint);
}

// ── Partition-aware directory helpers ──────────────────────────────────
// Returns { dirTrack, dirSector, dirTrackNum, bamOff, maxDirSectors }
// for the current context (root or partition)
function getDirContext(diskCtx) {
  diskCtx = diskCtx || getCurrentCtx();
  var partition = diskCtx.partition;
  var fmt = diskCtx.format;
  if (partition) {
    if (partition.dnpDir) {
      return {
        dirTrack: partition.dnpDirT, dirSector: partition.dnpDirS,
        dirTrackNum: partition.dnpDirT,
        bamOff: sectorOffset(fmt.bamTrack, fmt.bamSector, diskCtx),
        maxDirSectors: 222 // DNP can expand directory freely
      };
    }
    var st = partition.startTrack;
    return {
      dirTrack: st, dirSector: 3, dirTrackNum: st,
      bamOff: sectorOffset(st, 1, diskCtx),
      maxDirSectors: 37
    };
  }
  return {
    dirTrack: fmt.dirTrack, dirSector: fmt.dirSector,
    dirTrackNum: fmt.dirTrack,
    bamOff: sectorOffset(fmt.bamTrack, fmt.bamSector, diskCtx),
    maxDirSectors: fmt.maxDirSectors
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
    const off = sectorOffset(t, s, getCurrentCtx());
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
    const off = sectorOffset(t, s, getCurrentCtx());
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

// Pure alignment math: given a content byte array (already stripped of
// surrounding padding), return a 16-byte aligned name. Shared between
// CBM-DOS (entryOff + 5 layout) and CFS (entryOff + 0 layout) — the
// callers handle the differing storage offsets.
function computeAlignedName(content, alignment) {
  // Strip trailing 0x20 spaces and 0xA0 padding
  while (content.length > 0 && (content[content.length - 1] === 0x20 || content[content.length - 1] === 0xA0)) content.pop();
  // Strip leading 0x20 spaces
  while (content.length > 0 && content[0] === 0x20) content.shift();
  if (content.length >= 16) return null;
  if (content.length === 0 && alignment !== 'expand') return null;

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

  return result;
}

function alignFilename(buffer, entryOff, alignment) {
  const data = new Uint8Array(buffer);
  const content = getFilenameContent(data, entryOff);
  const result = computeAlignedName(content, alignment);
  if (!result) return;
  writeFilenameAligned(data, entryOff, result);
}

// CFS analogue: name lives at entry.dirLba*512 + entry.index*32, offset
// 0..15. Refuses on the system "<<DELETED FILES>>" entry, deleted
// entries, and the dir self-ref (slot 0 of the first sector).
function alignCfsFilename(entry, alignment) {
  if (!hddBuffer || !entry || entry.empty || entry.isSelfRef) return;
  if (entry.ftype === CFS_FTYPE.DEL) return;
  if (typeof _cfsEntryIsDeldirRef === 'function' && _cfsEntryIsDeldirRef(entry)) return;
  const data = new Uint8Array(hddBuffer);
  const nameOff = entry.dirLba * 512 + entry.index * 32;
  const content = [];
  for (let i = 0; i < 16; i++) {
    const b = data[nameOff + i];
    if (b === 0xA0 || b === 0x00) break;
    content.push(b);
  }
  const result = computeAlignedName(content, alignment);
  if (!result) return;
  for (let i = 0; i < 16; i++) data[nameOff + i] = result[i];
  if (typeof cfsTouchEntryMtime === 'function') cfsTouchEntryMtime(hddBuffer, entry.dirLba, entry.index);
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
    var bamOff = sectorOffset(fmt.bamTrack, fmt.bamSector, getCurrentCtx());

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
    const off = sectorOffset(t, s, getCurrentCtx());
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
    const off = sectorOffset(t, s, getCurrentCtx());
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
    var allocated = buildTrueAllocationMap(currentBuffer, getCurrentCtx());
    var secList = allocateSectors(allocated, 1, getCurrentCtx());
    if (secList.length === 0) return -1;
    dirTrk = secList[0].track;
    newSector = secList[0].sector;
  } else {
    // Standard: allocate on the directory track only
    dirTrk = ctx.dirTrackNum;
    const spt = sectorsPerTrack(dirTrk, getCurrentCtx());
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

  const newOff = sectorOffset(dirTrk, newSector, getCurrentCtx());
  data[newOff] = 0x00;
  data[newOff + 1] = 0xFF;
  for (let i = 2; i < 256; i++) data[newOff + i] = 0x00;

  writeNewEntry(data, newOff);

  // Mark sector as used in BAM
  bamMarkSectorUsed(data, dirTrk, newSector, bamOff, getCurrentCtx());

  // DNP subdir: bump the parent entry's block count by 1. Spec D2M-DNP.TXT
  // §directory header bytes 24-26: track/sector + index of the entry for
  // this subdir in its parent directory. The size field at +$1E/+$1F counts
  // header + dir-chain blocks only; growing the chain must keep it in sync.
  if (currentFormat.subdirLinked && currentPartition && currentPartition.dnpDir
      && currentPartition.dnpHeaderT) {
    var hdrOff = sectorOffset(currentPartition.dnpHeaderT, currentPartition.dnpHeaderS, getCurrentCtx());
    if (hdrOff >= 0) {
      var pe = currentFormat.subdirParentEntry;
      var pT = data[hdrOff + pe];
      var pS = data[hdrOff + pe + 1];
      var pIdx = data[hdrOff + pe + 2];
      if (pT !== 0) {
        var pDirOff = sectorOffset(pT, pS, getCurrentCtx());
        if (pDirOff >= 0) {
          var pEntry = pDirOff + pIdx * 32;
          var sz = (data[pEntry + 0x1E] | (data[pEntry + 0x1F] << 8)) + 1;
          data[pEntry + 0x1E] = sz & 0xFF;
          data[pEntry + 0x1F] = (sz >>> 8) & 0xFF;
        }
      }
    }
  }

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

  // Only list types valid for the current format (DISK_FORMATS.fileTypes).
  // D64/D71/D81/etc. don't support CBM (partition) or DIR types; only
  // CMD containers and DNP do. Filtering here keeps the dropdown honest
  // — was showing all 7 types regardless of format before.
  var allowedTypes = (currentFormat && currentFormat.fileTypes) || [0, 1, 2, 3, 4];
  FILE_TYPES.forEach((typeName, idx) => {
    if (allowedTypes.indexOf(idx) < 0) return;
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
// VICE's directory listing caps the displayed block count at 65024 even
// though the on-disk field is 16 bits (max 65535). Setting higher values
// is technically valid CBM-DOS, but anything > 65024 silently truncates
// in VICE's `LOAD"$",8` output, so cap user edits here to match what's
// actually viewable. Same cap applies to CFS block-size edits.
const MAX_BLOCKS = 65024;

// Check if a scratched file's sectors are still free (recoverable)
// Returns 'yes' (all free + chain ends cleanly), 'partial' (some free, or
// chain broken before T=0 end-marker), 'no' (head invalid / nothing free).
function checkScratchedRecoverable(buffer, entryOff) {
  var data = new Uint8Array(buffer);
  var fmt = currentFormat;
  var t = data[entryOff + 3], s = data[entryOff + 4];
  if (t === 0) return 'no';
  var bamOff = sectorOffset(fmt.bamTrack, fmt.bamSector, getCurrentCtx());
  var totalSectors = 0, freeSectors = 0;
  var visited = {};
  var chainClean = false;
  while (t !== 0) {
    if (t < 1 || t > currentTracks) break;
    if (s >= fmt.sectorsPerTrack(t)) break;
    var key = t + ':' + s;
    if (visited[key]) break;
    visited[key] = true;
    totalSectors++;
    if (checkSectorFree(data, bamOff, t, s, getCurrentCtx())) freeSectors++;
    var off = sectorOffset(t, s, getCurrentCtx());
    if (off < 0) break;
    var nt = data[off], ns = data[off + 1];
    if (nt === 0) { chainClean = true; break; }
    t = nt; s = ns;
  }
  if (totalSectors === 0) return 'no';
  if (chainClean && freeSectors === totalSectors) return 'yes';
  if (freeSectors > 0) return 'partial';
  return 'no';
}

function getFileAddresses(buffer, entryOff) {
  const data = new Uint8Array(buffer);
  const typeByte = data[entryOff + 2];
  const fileType = typeByte & 0x07;

  // GEOS VLIR: dir T/S points to the index sector, not file data
  if (isVlirFile(data, entryOff)) return null;

  let t = data[entryOff + 3];
  let s = data[entryOff + 4];
  if (t === 0) return null;

  // File chain follows sectorOffset, which transparently switches to
  // FD's LBA-encoded T:S (S = 0..255) for D1M/D2M/D4M and physical T:S
  // for everyone else.
  const firstOff = sectorOffset(t, s, getCurrentCtx());
  if (firstOff < 0 || firstOff + 4 > data.length) return null;

  // For PRG files, bytes 2-3 of first sector are the load address
  // For other types, there's no standard load address
  const startAddr = data[firstOff + 2] | (data[firstOff + 3] << 8);

  // Follow chain to find total data size.
  const visited = new Set();
  let totalBytes = 0;
  let lastUsed = 0;
  while (t !== 0) {
    const off = sectorOffset(t, s, getCurrentCtx());
    if (off < 0 || off + 2 > data.length) break;
    const key = `${t}:${s}`;
    if (visited.has(key)) break;
    visited.add(key);

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
  var data = new Uint8Array(buffer);
  if (data[entryOff + 3] === 0) return 0;
  return forEachFileSector(data, entryOff, function() {}, getCurrentCtx());
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
  const bamOff = sectorOffset(currentFormat.bamTrack, currentFormat.bamSector, getCurrentCtx());

  // BAM only covers tracks 1-35
  const bamTracks = currentFormat.bamTracksRange(currentTracks);

  // Read current per-track free counts and their max
  const tracks = [];
  let currentTotal = 0;
  for (let t = 1; t <= bamTracks; t++) {
    if (t === currentFormat.dirTrack) continue;
    const free = currentFormat.readTrackFree(data, bamOff, t);
    const spt = sectorsPerTrack(t, getCurrentCtx());
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
  const bamOff = sectorOffset(currentFormat.bamTrack, currentFormat.bamSector, getCurrentCtx());
  let free = 0;
  const bamTracks = currentFormat.bamTracksRange(currentTracks);
  for (let t = 1; t <= bamTracks; t++) {
    if (t === currentFormat.dirTrack) continue;
    free += currentFormat.readTrackFree(data, bamOff, t);
  }
  return free;
}

// ── Pure helpers for the inline editors below ────────────────────────
// Extracted so the value-parsing / validation logic is unit-testable
// without a real DOM. The startEdit*/startRename wrappers handle the
// DOM glue and call these for the actual decisions.

// Parse a numeric input string and clamp it into [min, max]. NaN or
// values below `min` clamp to `min`; values above `max` clamp to `max`.
function clampInt(raw, min, max) {
  var v = parseInt(raw, 10);
  if (isNaN(v) || v < min) v = min;
  if (v > max) v = max;
  return v;
}

// True when (track, sector) is a real sector address for the current
// format. Track 1..totalTracks and sector 0..(spt-1).
function isTrackSectorInRange(t, s, totalTracks) {
  if (t < 1 || t > totalTracks) return false;
  if (s < 0 || s >= sectorsPerTrack(t, getCurrentCtx())) return false;
  return true;
}

// True when any of the 16 filename bytes at entryOff+5 differs from the
// matching position in newBytes. Used by the rename committer to decide
// whether to push an undo snapshot + write the change.
function filenameBytesDiffer(buffer, entryOff, newBytes) {
  var data = new Uint8Array(buffer);
  for (var i = 0; i < 16; i++) {
    if (newBytes[i] !== data[entryOff + 5 + i]) return true;
  }
  return false;
}

function startEditFreeBlocks(blocksSpan) {
  if (!currentBuffer || !blocksSpan || isTapeFormat(getCurrentCtx())) return;
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
    var value = clampInt(input.value, 0, getMaxFreeBlocks());
    if (String(value) !== currentValue) {
      pushUndo();
      writeFreeBlocks(currentBuffer, value);
    }
    cleanup();
    blocksSpan.textContent = value;
  }

  function revert() {
    reverted = true;
    cleanup();
    blocksSpan.textContent = currentValue;
  }

  input.addEventListener('blur', () => {
    if (petsciiPicker.clicking) { input.focus(); input.selectionStart = input.selectionEnd = input._lastCursorPos || 0; return; }
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
    validate: (val) => val === 0 || (val >= 1 && val <= currentTracks)
  });

  const sep = document.createElement('span');
  sep.className = 'hex-input-sep';
  sep.textContent = '/';

  const sectorInput = createHexInput({
    value: curSector,
    maxBytes: 1,
    validate: (val) => isTrackSectorInRange(trackInput.getValue(), val, currentTracks)
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
    const newTrack = trackInput.getValue();
    const newSector = sectorInput.getValue();
    if (newTrack !== curTrack || newSector !== curSector) {
      pushUndo();
      data[entryOff + 3] = newTrack;
      data[entryOff + 4] = newSector;
    }
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
    if (petsciiPicker.clicking) return;
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
    var value = clampInt(input.value, 0, MAX_BLOCKS);
    if (String(value) !== currentValue) {
      pushUndo();
      writeBlockSize(currentBuffer, entryOff, value);
    }
    cleanup();
    blocksSpan.textContent = value;
  }

  function revert() {
    reverted = true;
    cleanup();
    blocksSpan.textContent = currentValue;
  }

  input.addEventListener('blur', () => {
    if (petsciiPicker.clicking) { input.focus(); input.selectionStart = input.selectionEnd = input._lastCursorPos || 0; return; }
    commitEdit();
  });
  input.addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter') { ev.preventDefault(); ev.stopPropagation(); commitEdit(); }
    else if (ev.key === 'Escape') { ev.preventDefault(); ev.stopPropagation(); revert(); }
  });

  registerActiveEdit(blocksSpan, revert);
}

function startRenameEntry(entryEl) {
  if (!currentBuffer || !entryEl || isTapeFormat(getCurrentCtx())) return;
  const entryOff = parseInt(entryEl.dataset.offset, 10);
  const nameSpan = entryEl.querySelector('.dir-name');
  if (nameSpan.querySelector('.petscii-editor')) return;

  cancelActiveEdits();
  const disk = new Uint8Array(currentBuffer);
  const origBytes = new Uint8Array(16);
  let origLen = 16;
  for (let i = 0; i < 16; i++) {
    origBytes[i] = disk[entryOff + 5 + i];
    if (origBytes[i] === 0xA0 && origLen === 16) origLen = i;
  }

  const editor = createPetsciiEditor({
    maxLen: 16,
    initialBytes: origBytes,
    initialLen: origLen,
    className: 'name-input'
  });

  nameSpan.textContent = '';
  nameSpan.appendChild(editor);
  nameSpan.classList.add('editing');
  // .dir-entry is draggable=true for reordering; while editing we disable
  // it so mousedown on the contenteditable moves the caret instead of
  // starting a drag.
  const wasDraggable = entryEl.draggable;
  entryEl.draggable = false;
  editor.focus();
  editor._setCaret(origLen);
  // dblclick's default word-selection behavior can reset focus after our
  // handler runs. Re-focus on the next tick so the caret stays on the PE.
  setTimeout(function() {
    if (document.activeElement !== editor) {
      editor.focus();
      editor._setCaret(editor._lastCursorPos);
    }
  }, 0);

  showPetsciiPicker(editor, 16);

  let reverted = false;
  // Re-entry guard: cleanup() → hidePetsciiPicker() can move focus, which
  // fires the editor's own blur handler, which would call commitRename
  // a second time mid-flight. The second call's renderDisk collides with
  // the first innerHTML write — crashes with "node no longer a child".
  let finished = false;

  function cleanup() {
    nameSpan.classList.remove('editing');
    entryEl.draggable = wasDraggable;
    hidePetsciiPicker();
    activeEditEl = null;
    activeEditCleanup = null;
  }

  function commitRename() {
    if (reverted || finished) return;
    finished = true;
    const newBytes = editor.getBytes(16, 0xA0);
    if (currentBuffer && filenameBytesDiffer(currentBuffer, entryOff, newBytes)) {
      pushUndo();
      const data = new Uint8Array(currentBuffer);
      for (let i = 0; i < 16; i++) data[entryOff + 5 + i] = newBytes[i];
    }
    cleanup();
    const info = parseCurrentDir(currentBuffer);
    renderDisk(info);
  }

  function revert() {
    if (finished) return;
    finished = true;
    reverted = true;
    cleanup();
    const info = parseCurrentDir(currentBuffer);
    renderDisk(info);
  }

  editor.addEventListener('blur', () => {
    if (petsciiPicker.clicking) { editor.focus(); editor._setCaret(editor._lastCursorPos || 0); return; }
    if (typeof suppressActiveEditCommit !== 'undefined' && suppressActiveEditCommit) return;
    commitRename();
  });
  editor.addEventListener('keydown', (ev) => {
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
  if (!selected) return;
  // CFS dir entry — different byte layout from CBM-DOS so it needs a
  // dedicated inline editor.
  if (selected.dataset.cfsEntry !== undefined) {
    startInlineRenameCfsEntry(selected);
    return;
  }
  startRenameEntry(selected);
});

// Insert a new entry and position it after the selected entry (or at end)
function insertAndPosition() {
  if (!currentBuffer || !canInsertFile()) return -1;
  pushUndo();
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

document.getElementById('opt-insert').addEventListener('click', async (e) => {
  e.stopPropagation();
  closeMenus();
  // CFS view: insert a placeholder entry — zero size, no tree pointer.
  // CBM-DOS canInsertFile() reads currentFormat shape; in CFS view
  // we route through cfsInsertPlaceholderEntry which checks for a free
  // slot via cfsFindEmptyDirSlot. Prompt for a name + type so the user
  // gets a meaningful slot, not just an empty "NEW" row.
  if (cfsPartitionIdx >= 0 && cfsDirEntries) {
    if (!cfsFindEmptyDirSlot(hddBuffer, cfsDirLba)) {
      showModal('Insert Entry', ['No empty directory slot available — every slot in the dir chain is in use.']);
      return;
    }
    var name = await showInputModal('Entry Name', 'NEW');
    if (!name) return;
    var cleanName = String(name).toUpperCase().substring(0, 16);
    // Snapshot the selection before we mutate — we'll need its
    // (dirLba, slotIndex) to position the new entry right after it.
    var selBefore = (selectedEntryIndex >= 0 && cfsDirEntries[selectedEntryIndex])
      ? { dirLba: cfsDirEntries[selectedEntryIndex].dirLba, slotIndex: cfsDirEntries[selectedEntryIndex].index }
      : null;
    pushUndo();
    var res = cfsInsertPlaceholderEntry(hddBuffer, cfsDirLba, cleanName, { ftype: CFS_FTYPE.NORMAL, typeSuffix: 'PRG' });
    if (!res.ok) {
      showModal('Insert Entry failed', [res.error || 'Unknown error.']);
      if (typeof popUndo === 'function') popUndo();
      return;
    }
    // Shift the inserted slot backward through the dir chain until it
    // sits immediately after the selection — same as CBM-DOS Insert
    // File. Each swap preserves bits 5..4 of byte $14 (dir-next
    // encoding) so the chain pointer stays intact. No selection or
    // free slot already adjacent? No shifting needed.
    if (selBefore) {
      var allSlots = cfsCollectDirSlots(hddBuffer, cfsDirLba);
      var selIdx = -1, newIdx = -1;
      for (var si = 0; si < allSlots.length; si++) {
        if (allSlots[si].dirLba === selBefore.dirLba && allSlots[si].slotIndex === selBefore.slotIndex) selIdx = si;
        if (allSlots[si].dirLba === res.dirLba && allSlots[si].slotIndex === res.slotIndex) newIdx = si;
      }
      if (selIdx >= 0 && newIdx > selIdx + 1) {
        var cur = newIdx;
        var target = selIdx + 1;
        while (cur !== target) {
          cfsSwapDirSlots(hddBuffer, allSlots[cur], allSlots[cur - 1]);
          cur--;
        }
        res.dirLba = allSlots[target].dirLba;
        res.slotIndex = allSlots[target].slotIndex;
      }
    }
    refreshIde64View();
    // Select the (final) new-entry slot so menu state highlights the
    // right options for follow-up edits.
    var pick = -1;
    for (var ni = 0; ni < cfsDirEntries.length; ni++) {
      var ent = cfsDirEntries[ni];
      if (ent && ent.dirLba === res.dirLba && ent.index === res.slotIndex) { pick = ni; break; }
    }
    if (pick >= 0) {
      selectedEntryIndex = pick;
      selectedEntries = [pick];
      var pickRow = document.querySelector('.dir-entry[data-cfs-entry="' + pick + '"]');
      if (pickRow) {
        document.querySelectorAll('.dir-entry.selected').forEach(function(el) { el.classList.remove('selected'); });
        pickRow.classList.add('selected');
      }
      updateEntryMenuState();
    }
    return;
  }
  if (!currentBuffer || !canInsertFile()) return;
  var newOff = insertAndPosition();
  if (newOff < 0) return;
  selectedEntryIndex = newOff;
  var info = parseCurrentDir(currentBuffer);
  renderDisk(info);
});


document.getElementById('opt-undo').addEventListener('click', function(e) {
  e.stopPropagation();
  closeMenus();
  if (popUndo()) {
    if (cfsPartitionIdx >= 0 && cfsDirEntries) {
      if (typeof refreshIde64View === 'function') refreshIde64View();
    } else {
      var info = parseCurrentDir(currentBuffer);
      renderDisk(info);
    }
    updateMenuState();
    updateEntryMenuState();
  }
});

document.getElementById('opt-redo').addEventListener('click', function(e) {
  e.stopPropagation();
  closeMenus();
  if (popRedo()) {
    if (cfsPartitionIdx >= 0 && cfsDirEntries) {
      if (typeof refreshIde64View === 'function') refreshIde64View();
    } else {
      var info = parseCurrentDir(currentBuffer);
      renderDisk(info);
    }
    updateMenuState();
    updateEntryMenuState();
  }
});


document.getElementById('opt-remove').addEventListener('click', async (e) => {
  e.stopPropagation();
  if (!currentBuffer || selectedEntryIndex < 0) return;
  closeMenus();

  // CFS view: cfsRemoveDirEntry handles both DEL (just zero slot) and
  // live (cfsDeleteFile to free bitmap, then zero slot) paths so the
  // bitmap stays consistent. Dir self-ref is refused at the format
  // layer; the menu state separately blocks the protected
  // <<DELETED FILES>> entry. Auto-selects the next entry after removal,
  // matching the CBM-DOS Remove Entry behavior — fall back to the last
  // remaining entry if we removed at the end of the list.
  if (cfsPartitionIdx >= 0 && cfsDirEntries) {
    var part = hddPartitions && hddPartitions[cfsPartitionIdx];
    if (!part) return;
    function _cfsRowVisible(e) {
      if (!e || e.empty || e.isSelfRef) return false;
      if (e.ftype === CFS_FTYPE.DEL && !e.closed && !showDeleted) return false;
      return true;
    }
    // Multi-select: gather candidates from selectedEntries (fallback to
    // selectedEntryIndex). Skip protected and invalid entries silently —
    // they're not part of what the user can act on in this batch.
    var rawIdx = selectedEntries.length > 0 ? selectedEntries : [selectedEntryIndex];
    var rmTargets = [];
    for (var rti = 0; rti < rawIdx.length; rti++) {
      var rmEnt = cfsDirEntries[rawIdx[rti]];
      if (!rmEnt || rmEnt.empty) continue;
      if (typeof _cfsEntryIsDeldirRef === 'function' && _cfsEntryIsDeldirRef(rmEnt)) continue;
      rmTargets.push({ idx: rawIdx[rti], entry: rmEnt });
    }
    if (rmTargets.length === 0) return;
    // Visible position of the earliest removed entry, so the new
    // selection lands at "what slid up into the same spot".
    var firstAbsIdx = rmTargets[0].idx;
    for (var ri = 0; ri < rmTargets.length; ri++) {
      if (rmTargets[ri].idx < firstAbsIdx) firstAbsIdx = rmTargets[ri].idx;
    }
    var prevVisIdx = 0;
    for (var pvi = 0; pvi < firstAbsIdx; pvi++) {
      if (_cfsRowVisible(cfsDirEntries[pvi])) prevVisIdx++;
    }
    pushUndo();
    var rmFailures = [];
    for (var rd = 0; rd < rmTargets.length; rd++) {
      var rmRes = cfsRemoveDirEntry(hddBuffer, part.startLba, part.endLba, rmTargets[rd].entry, cfsDirLba);
      if (!rmRes.ok) rmFailures.push(petsciiToReadable(rmTargets[rd].entry.name) + ': ' + (rmRes.error || 'unknown'));
    }
    if (rmFailures.length === rmTargets.length) {
      showModal('Remove Entry failed', rmFailures);
      if (typeof popUndo === 'function') popUndo();
      return;
    }
    refreshIde64View();
    // After the refresh, cfsDirEntries is a freshly-parsed flat list.
    // Pick the visible entry at min(prevVisIdx, len-1) and re-apply the
    // selection + .selected row class so menu state stays current.
    var newVisible = [];
    for (var nv = 0; nv < cfsDirEntries.length; nv++) {
      if (_cfsRowVisible(cfsDirEntries[nv])) newVisible.push(nv);
    }
    if (newVisible.length > 0) {
      var pick = newVisible[Math.min(prevVisIdx, newVisible.length - 1)];
      selectedEntryIndex = pick;
      selectedEntries = [pick];
      var pickRow = document.querySelector('.dir-entry[data-cfs-entry="' + pick + '"]');
      if (pickRow) {
        document.querySelectorAll('.dir-entry.selected').forEach(function(el) { el.classList.remove('selected'); });
        pickRow.classList.add('selected');
      }
    } else {
      selectedEntryIndex = -1;
      selectedEntries = [];
    }
    updateEntryMenuState();
    if (rmFailures.length > 0) {
      showModal('Remove Entry — partial', ['Some entries could not be removed:'].concat(rmFailures));
    }
    return;
  }

  var removeEntryOff = selectedEntryIndex;
  var data = new Uint8Array(currentBuffer);
  var typeByte = data[removeEntryOff + 2];
  var isCBM = !currentFormat.subdirLinked && (typeByte & 0x07) === currentFormat.subdirType;

  // Check if this is a CBM partition with files inside
  if (isCBM) {
    var partStart = data[removeEntryOff + 3];
    var partSize = data[removeEntryOff + 30] | (data[removeEntryOff + 31] << 8);
    var partInfo = parsePartition(currentBuffer, partStart, partSize, getCurrentCtx());
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
          var dstOff = findFreeDirEntry(currentBuffer, getCurrentCtx());
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
    // CFS view: alignFilename works on entryOff + 5 (CBM-DOS layout).
    // Route through alignCfsFilename which handles the CFS 32-byte
    // entry shape and skips system/protected entries.
    if (cfsPartitionIdx >= 0 && cfsDirEntries) {
      var rawIdx = selectedEntries.length > 0 ? selectedEntries : [selectedEntryIndex];
      var targets = [];
      for (var ti = 0; ti < rawIdx.length; ti++) {
        var ent = cfsDirEntries[rawIdx[ti]];
        if (!ent || ent.empty) continue;
        targets.push(ent);
      }
      if (targets.length === 0) return;
      pushUndo();
      for (var ai = 0; ai < targets.length; ai++) alignCfsFilename(targets[ai], el.dataset.align);
      refreshIde64View();
      return;
    }
    pushUndo();
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
  // CFS view: byte-offset semantics in startEditBlockSize don't apply
  // (rows use data-cfs-entry; size is a 4-byte field at $10..$13 of the
  // dir entry). startInlineEditCfsBlockSize replicates the CBM-DOS UX —
  // inline blocks input on the .dir-blocks span — and writes the result
  // as `blocks × 254` via cfsWriteFileSize.
  if (cfsPartitionIdx >= 0 && cfsDirEntries) {
    var selectedCfs = document.querySelector('.dir-entry.selected[data-cfs-entry]');
    if (selectedCfs) startInlineEditCfsBlockSize(selectedCfs);
    return;
  }
  const selected = document.querySelector('.dir-entry.selected');
  startEditBlockSize(selected);
});

document.getElementById('opt-change-ts').addEventListener('click', (e) => {
  e.stopPropagation();
  if (!currentBuffer || selectedEntryIndex < 0) return;
  closeMenus();
  const selected = document.querySelector('.dir-entry.selected');
  if (selected) startEditTrackSector(selected);
});

document.getElementById('opt-move-up').addEventListener('click', (e) => {
  e.stopPropagation();
  if (selectedEntryIndex < 0) return;
  closeMenus();
  if (cfsPartitionIdx >= 0 && cfsDirEntries) { moveCfsEntries(-1); return; }
  if (!currentBuffer) return;
  moveEntry(-1);
});

document.getElementById('opt-move-down').addEventListener('click', (e) => {
  e.stopPropagation();
  if (selectedEntryIndex < 0) return;
  closeMenus();
  if (cfsPartitionIdx >= 0 && cfsDirEntries) { moveCfsEntries(1); return; }
  if (!currentBuffer) return;
  moveEntry(1);
});

document.getElementById('opt-recalc-size').addEventListener('click', (e) => {
  e.stopPropagation();
  if (!currentBuffer || selectedEntryIndex < 0) return;
  closeMenus();
  // CFS view: countActualBlocks + writeBlockSize would interpret the
  // CFS slot index as a CBM-DOS byte offset and write garbage into the
  // boot sector. Route through CFS helpers — count allocated data
  // sectors via the tree walk, then write size = sectors * 512 (upper
  // bound; the last sector may be partially used, but that detail isn't
  // recoverable from the on-disk layout).
  if (cfsPartitionIdx >= 0 && cfsDirEntries) {
    var part = hddPartitions && hddPartitions[cfsPartitionIdx];
    if (!part) return;
    var rawIdx = selectedEntries.length > 0 ? selectedEntries : [selectedEntryIndex];
    var targets = [];
    for (var ti = 0; ti < rawIdx.length; ti++) {
      var ent = cfsDirEntries[rawIdx[ti]];
      if (!ent || ent.empty) continue;
      if (ent.ftype === CFS_FTYPE.DIR || ent.ftype === CFS_FTYPE.LNK || ent.ftype === CFS_FTYPE.DEL) continue;
      targets.push(ent);
    }
    if (targets.length === 0) return;
    pushUndo();
    for (var si = 0; si < targets.length; si++) {
      var sectors = cfsCountFileDataSectors(hddBuffer, part.startLba, part.endLba, targets[si]);
      cfsWriteFileSize(hddBuffer, targets[si].dirLba, targets[si].index, sectors * 512, targets[si].ftype);
    }
    refreshIde64View();
    return;
  }
  pushUndo();
  var entries = selectedEntries.length > 0 ? selectedEntries : [selectedEntryIndex];
  for (var ri = 0; ri < entries.length; ri++) {
    var actual = countActualBlocks(currentBuffer, entries[ri]);
    writeBlockSize(currentBuffer, entries[ri], actual);
  }
  const info = parseCurrentDir(currentBuffer);
  renderDisk(info);
});

// Directory entries from every open disk tab, since sets are routinely split
// across disks (a 40-track SixPack doesn't fit on one). Active tab first, so
// its entries win the finders' first-occurrence rule; each ref carries its
// own ctx so the reader knows which disk to read from.
function zipCodeGatherItems() {
  var items = [];

  function collect(ctx, tabName) {
    var entries;
    try {
      entries = withDiskCtx(ctx, function() { return parseCurrentDir(ctx.buffer); }).entries;
    } catch (err) {
      return;                       // not a plain CBM-DOS directory; skip it
    }
    for (var i = 0; i < entries.length; i++) {
      var en = entries[i];
      if (en.deleted || en.entryOff === undefined) continue;
      items.push({
        name: petsciiToReadable(en.name || ''),
        ref: { ctx: ctx, entryOff: en.entryOff, tab: tabName },
      });
    }
  }

  var activeCtx = getCurrentCtx();
  var activeTab = typeof getActiveTab === 'function' ? getActiveTab() : null;
  collect(activeCtx, activeTab ? activeTab.name : null);

  if (typeof tabs !== 'undefined' && tabs.length > 1) {
    for (var t = 0; t < tabs.length; t++) {
      var tab = tabs[t];
      if (tab.id === activeTabId || !tab.buffer || !tab.format) continue;
      // Tape and container-list tabs have no CBM-DOS directory to scan.
      if (typeof isTapeFormat === 'function' && isTapeFormat({ format: tab.format })) continue;
      collect({
        buffer: tab.buffer,
        partition: tab.partition || null,
        format: tab.format,
        tracks: tab.tracks,
        dirInterleave: dirInterleave,
        fileInterleave: fileInterleave,
      }, tab.name);
    }
  }
  return items;
}

// Sort dropped files into ZipCode / SixPack / FilePacked buckets. Parts may
// arrive with a CBM type appended (Export writes "1!!NAME.prg"), so names are
// also matched with that stripped. Returns { zipcode, sixpack, filepack,
// claimed }; `claimed` holds the original entries for the caller to skip.
var ZIPCODE_EXPORT_EXT_RE = /\.(prg|seq|usr|rel|p00|s00|u00|r00)$/i;

function classifyDroppedZipCodeSets(entries) {
  var cand = [];
  for (var i = 0; i < entries.length; i++) {
    var full = entries[i].name || '';
    var base = full.substring(Math.max(full.lastIndexOf('/'), full.lastIndexOf('\\')) + 1);
    // Strip an export artifact, but never a real name ending like
    // "1!gfx.muz" or "1!GFXMUS.Z64".
    var hasExportExt = ZIPCODE_EXPORT_EXT_RE.test(base);
    var stripped = base.replace(ZIPCODE_EXPORT_EXT_RE, '');
    var name = null, needsSet = false;
    if (!hasExportExt) {
      if (isAnyZipCodePartName(base)) name = base;
    } else if (isAnyZipCodePartName(stripped)) {
      // Claim only once it completes a set, so a plain "1!GAME.prg" imports.
      name = stripped;
      needsSet = true;
    }
    if (name) cand.push({ entry: entries[i], name: name, needsSet: needsSet });
  }
  if (cand.length === 0) return { zipcode: [], sixpack: [], filepack: [], claimed: [] };

  var zc = cand.filter(function(c) { return isZipCodeFileName(c.name); });
  var sp = cand.filter(function(c) { return isSixPackFileName(c.name); });
  var fp = cand.filter(function(c) { return isFilePackFileName(c.name) || isFilePackDirName(c.name); });

  // Which candidates end up inside a complete set?
  var inComplete = [];
  var ref = function(c) { return c; };
  findZipCodeSets(zc.map(function(c) { return { name: c.name, ref: ref(c) }; }))
    .complete.forEach(function(s) { inComplete = inComplete.concat(s.refs); });
  findSixPackSets(sp.map(function(c) { return { name: c.name, ref: ref(c) }; }))
    .complete.forEach(function(s) { inComplete = inComplete.concat(s.refs); });
  findFilePackSets(fp.map(function(c) { return { name: c.name, ref: ref(c) }; }))
    .complete.forEach(function(s) { inComplete = inComplete.concat(s.refs.concat([s.dirRef])); });

  var keep = cand.filter(function(c) { return !c.needsSet || inComplete.indexOf(c) >= 0; });
  var pick = function(fn) {
    return keep.filter(fn).map(function(c) {
      return { name: c.name, buffer: c.entry.buffer, entry: c.entry };
    });
  };
  return {
    zipcode: pick(function(c) { return isZipCodeFileName(c.name); }),
    sixpack: pick(function(c) { return isSixPackFileName(c.name); }),
    filepack: pick(function(c) { return isFilePackFileName(c.name) || isFilePackDirName(c.name); }),
    claimed: keep.map(function(c) { return c.entry; }),
  };
}

function isAnyZipCodePartName(n) {
  return isZipCodeFileName(n) || isSixPackFileName(n) ||
    isFilePackFileName(n) || isFilePackDirName(n);
}

// ZipCode parts are recognised by name, so appending the CBM type would stop
// an exported part being reassembled when dropped back in. Export them bare.
function exportExtFor(name, ext) {
  return isAnyZipCodePartName(name) ? '' : ext;
}
