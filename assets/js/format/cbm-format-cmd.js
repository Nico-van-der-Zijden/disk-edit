// ── CMD container partition tables (RAMLink, FD2000/FD4000, CMD HD) ──
//
// 32-byte slots, slot 0 = SYSTEM (type 0xFF). Per slot:
//   +0x00..+0x01  flags (01 01 on SYSTEM); on sectored tables these are
//                 the sector's chain link, so writers leave them alone
//   +0x02         type: 00 empty, 01 Native, 02 1541, 03 1571, 04 1581,
//                 05 CMD81, 06 Print, 07 Foreign, FF System
//   +0x05..+0x14  name, $A0-padded
//   +0x15..+0x18  start (CMD_CONTAINERS.startEnc)
//   +0x1D..+0x1F  size, 24-bit BE in CMD_CONTAINERS.sizeUnit bytes

var CMD_PART_TYPE_NAMES = {
  0x00: 'Empty',
  0x01: 'Native',
  0x02: '1541',
  0x03: '1571',
  0x04: '1581',
  0x05: 'CMD81',
  0x06: 'Print',
  0x07: 'Foreign',
  0xFF: 'System',
};

// Partition type → format key for non-Native types. Native (0x01) is
// container-specific (use ct.nativeFormatKey) — DNP for RAMLink, the
// parent format for FD2000/FD4000.
var CMD_PART_TYPE_FORMAT = {
  0x02: 'd64',
  0x03: 'd71',
  0x04: 'd81',
};

var CMD_PART_TYPE_NATIVE = 0x01;
var CMD_PART_TYPE_SYSTEM = 0xFF;
function isCmdSystemPartition(part) {
  return part.type === CMD_PART_TYPE_SYSTEM;
}
// Native or a type with an image format (1541/1571/1581 → .d64/.d71/.d81).
function isCmdExportablePartition(part) {
  return part.type === CMD_PART_TYPE_NATIVE || !!CMD_PART_TYPE_FORMAT[part.type];
}

var DHD_PART_TABLE_OFFSET = 0x40000; // sector 1024, fixed regardless of image size

// FD2000/FD4000 descriptor; only the disk geometry differs. Table lives on
// last-track sectors 8-11, start is 16-bit BE × 512 at +0x16, size is in
// 512-byte clusters (FD-Tools v1.05's `bx=2` multiplier).
function _makeCmdFdContainer(formatKey) {
  return {
    name: formatKey.toUpperCase(),
    formatKey: formatKey,
    extensions: ['.' + formatKey],
    getTableLayout: function(buffer) {
      var fmt = DISK_FORMATS[formatKey];
      var spt = fmt.sectorsPerTrack(1);
      var tracks = fmt.sizes[0].tracks;
      var tLast = (tracks - 1) * spt * 256;
      return [
        { off: tLast +  8 * 256, slots: 8 },
        { off: tLast +  9 * 256, slots: 8 },
        { off: tLast + 10 * 256, slots: 8 },
        { off: tLast + 11 * 256, slots: 8 },
      ];
    },
    // Magic "CMD FD SERIES   " sits at last-track sector 5 + 0xF0
    isSignaturePresent: function(data, layout) {
      var fmt = DISK_FORMATS[formatKey];
      var spt = fmt.sectorsPerTrack(1);
      var tracks = fmt.sizes[0].tracks;
      var sigOff = (tracks - 1) * spt * 256 + 5 * 256;
      if (sigOff + 0xF0 + 16 > data.length) return false;
      for (var m = 0; m < 16; m++) {
        if (data[sigOff + 0xF0 + m] !== _CMD_FD_MAGIC.charCodeAt(m)) return false;
      }
      return true;
    },
    startEnc: 'block16x512',
    sizeUnit: 512,
    // D2M-DNP.TXT: an FD 1571 partition is 684 clusters (the 1541's 342
    // doubled), one cluster more than its 1366 blocks need.
    fixedTypeUnits: { 0x03: 684 },
    diskIdLabel: formatKey.toUpperCase(),
    nativeFormatKey: formatKey, // Native partition slices parse as the parent FD format
    getReservedRanges: function(buffer) { // the whole last track
      var fmt = DISK_FORMATS[formatKey];
      var spt = fmt.sectorsPerTrack(1);
      var tracks = fmt.sizes[0].tracks;
      var tLast = (tracks - 1) * spt * 256;
      return [{ start: tLast, end: buffer.byteLength }];
    },
  };
}

var CMD_CONTAINERS = {
  ramlink: {
    name: 'RAMLink',
    formatKey: 'ramlink',
    extensions: ['.rml', '.rl'],
    getTableLayout: function(buffer) {
      return [{ off: buffer.byteLength - 2048, slots: 32 }];
    },
    isSignaturePresent: function(data, layout) {
      var off = layout[0].off + 2;
      return off < data.length && data[off] === 0xFF;
    },
    startEnc: 'byte32',
    sizeUnit: 256,
    diskIdLabel: 'RML',
    partitionIdBytes: [0x52, 0x4C], // "RL" — stamped into freshly-built partitions
    nativeFormatKey: 'dnp',
    getReservedRanges: function(buffer) { // SYSTEM = final 16 sectors
      return [{ start: buffer.byteLength - 16 * 256, end: buffer.byteLength }];
    },
  },
  d1m: _makeCmdFdContainer('d1m'),
  d2m: _makeCmdFdContainer('d2m'),
  d4m: _makeCmdFdContainer('d4m'),
  // CMD HD. SYSTEM spans sectors 768-1055 (HD-DOS shadow + table). Start
  // and size are 24-bit BE 512-byte clusters; 16-bit readers mis-read
  // partitions above the 16 MiB mark.
  dhd: {
    name: 'CMD HD',
    formatKey: 'dhd',
    extensions: ['.dhd'],
    // 32 sectors × 8 slots, minus slot 255 (overlaps the chain terminator).
    getTableLayout: function(buffer) {
      var sections = [];
      for (var sec = 0; sec < 31; sec++) {
        sections.push({ off: DHD_PART_TABLE_OFFSET + sec * 256, slots: 8 });
      }
      sections.push({ off: DHD_PART_TABLE_OFFSET + 31 * 256, slots: 7 });
      return sections;
    },
    isSignaturePresent: function(data, layout) {
      var off = layout[0].off + 2;
      return off < data.length && data[off] === 0xFF;
    },
    startEnc: 'block24x512',
    sizeUnit: 512,
    diskIdLabel: 'HD',
    partitionIdBytes: [0x48, 0x44], // "HD" — what HD-Tools / DirMaster stamp
    nativeFormatKey: 'dnp',
    getReservedRanges: function(buffer) {
      return [];
    },
    getMinPartitionStart: function(buffer) {
      return DHD_MIN_SIZE; // first sector past SYSTEM
    },
    // Grow-as-needed: the only container with this hook; the others are fixed-size.
    getMaxGrownSize: function(buffer) { return 0xFFFFFFFF; },
  },
};

// Slot N's absolute byte offset under a (possibly multi-section) layout.
function _cmdContainerSlotOffset(layout, slotIdx) {
  var cumulative = 0;
  for (var li = 0; li < layout.length; li++) {
    var sec = layout[li];
    if (slotIdx < cumulative + sec.slots) {
      return sec.off + (slotIdx - cumulative) * 32;
    }
    cumulative += sec.slots;
  }
  return -1;
}

function _cmdContainerReadStart(data, off, startEnc) {
  if (startEnc === 'byte32') {
    return (data[off + 0x15] * 0x1000000) + (data[off + 0x16] << 16) +
           (data[off + 0x17] << 8) + data[off + 0x18];
  }
  if (startEnc === 'block24x512') {
    // 24-bit BE × 512. High byte goes non-zero past the 16 MiB mark.
    var blocks24 = (data[off + 0x15] << 16) | (data[off + 0x16] << 8) | data[off + 0x17];
    return blocks24 * 512;
  }
  // 16-bit BE × 512 (FD only; +0x15 is always zero in those images).
  var blocks = (data[off + 0x16] << 8) | data[off + 0x17];
  return blocks * 512;
}

function _cmdContainerWriteStart(data, off, startEnc, startByte) {
  if (startEnc === 'byte32') {
    data[off + 0x15] = (startByte >>> 24) & 0xFF;
    data[off + 0x16] = (startByte >>> 16) & 0xFF;
    data[off + 0x17] = (startByte >>> 8) & 0xFF;
    data[off + 0x18] = startByte & 0xFF;
    return;
  }
  if (startEnc === 'block24x512') {
    var blocks24w = Math.floor(startByte / 512);
    data[off + 0x15] = (blocks24w >>> 16) & 0xFF;
    data[off + 0x16] = (blocks24w >>> 8) & 0xFF;
    data[off + 0x17] = blocks24w & 0xFF;
    return;
  }
  var blocks = Math.floor(startByte / 512);
  data[off + 0x15] = 0x00;
  data[off + 0x16] = (blocks >>> 8) & 0xFF;
  data[off + 0x17] = blocks & 0xFF;
}

// Read all populated partitions. Returns { format, container, partitions }
// or null when the descriptor's signature isn't present (i.e. this isn't
// a recognised container of `containerKey`).
function readCmdContainerPartitions(buffer, containerKey) {
  var ct = CMD_CONTAINERS[containerKey];
  if (!ct || !buffer) return null;
  var data = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  var layout = ct.getTableLayout(buffer);
  for (var li = 0; li < layout.length; li++) {
    if (layout[li].off + layout[li].slots * 32 > data.length) return null;
  }
  if (!ct.isSignaturePresent(data, layout)) return null;

  var partitions = [];
  var slotIdx = 0;
  for (var sli = 0; sli < layout.length; sli++) {
    var section = layout[sli];
    for (var si = 0; si < section.slots; si++, slotIdx++) {
      var off = section.off + si * 32;
      var type = data[off + 0x02];
      if (type === 0x00) continue;

      var name = readPetsciiString(data, off + 0x05, 16, true);
      var startByte = _cmdContainerReadStart(data, off, ct.startEnc);
      var sizeStored = (data[off + 0x1D] << 16) | (data[off + 0x1E] << 8) | data[off + 0x1F];
      var unit = ct.sizeUnit || 256;
      var sizeBytes = sizeStored * unit;
      partitions.push({
        index: slotIdx,
        type: type,
        typeName: CMD_PART_TYPE_NAMES[type] || ('0x' + type.toString(16)),
        name: name || ('Partition ' + slotIdx),
        startByte: startByte,
        sizeBytes: sizeBytes,
        // sizeBlocks = displayed 256-byte blocks (matches FD-Tools' bx multiplier)
        sizeBlocks: sizeBytes / 256,
      });
    }
  }
  return { format: ct.name, container: containerKey, partitions: partitions };
}

function extractCmdContainerPartition(buffer, partition) {
  var end = partition.startByte + partition.sizeBytes;
  if (end > buffer.byteLength) end = buffer.byteLength;
  if (partition.startByte >= end) return null;
  return buffer.slice(partition.startByte, end);
}

// Lowest empty user slot. Slot 0 is SYSTEM and never returned. Upper
// bound comes from the descriptor's getTableLayout: 31 for RAMLink /
// FD2000 / FD4000, 254 for CMD HD.
function findCmdContainerEmptySlot(buffer, containerKey) {
  var ct = CMD_CONTAINERS[containerKey];
  if (!ct || !buffer) return -1;
  var data = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  var layout = ct.getTableLayout(buffer);
  var slotIdx = 0;
  for (var sli = 0; sli < layout.length; sli++) {
    var section = layout[sli];
    for (var si = 0; si < section.slots; si++, slotIdx++) {
      if (slotIdx === 0) continue;
      var off = section.off + si * 32;
      if (off + 32 > data.length) return -1;
      if (data[off + 0x02] === 0x00) return slotIdx;
    }
  }
  return -1;
}

// Bump-allocate a new partition right after the highest existing user
// partition's end byte, matching the FD-Tools v1.05 / RAM-Tools v1.02
// allocation logic (lines 14150-14190 in both). Returns { start, size }
// where size is the free space remaining up to the first reserved range.
function findCmdContainerFreeSpace(buffer, containerKey, partitions) {
  var ct = CMD_CONTAINERS[containerKey];
  if (!ct || !buffer) return { start: 0, size: 0 };

  var highEnd = 0;
  for (var i = 0; i < partitions.length; i++) {
    var p = partitions[i];
    if (isCmdSystemPartition(p) || p.type === 0x00) continue;
    var end = p.startByte + p.sizeBytes;
    if (end > highEnd) highEnd = end;
  }
  // Starts are stored in sizeUnit granules (512 on FD / CMD HD).
  var align = ct.sizeUnit || 256;
  highEnd = Math.ceil(highEnd / align) * align;

  var minStart = ct.getMinPartitionStart ? ct.getMinPartitionStart(buffer) : 0;
  if (highEnd < minStart) highEnd = minStart;

  var dataEnd = ct.getMaxGrownSize ? ct.getMaxGrownSize(buffer) : buffer.byteLength;
  var reserved = ct.getReservedRanges(buffer);
  for (var r = 0; r < reserved.length; r++) {
    if (reserved[r].start < dataEnd) dataEnd = reserved[r].start;
  }
  return { start: highEnd, size: Math.max(0, dataEnd - highEnd) };
}

// Bytes a partition of `sizeBlocks` 256-byte blocks occupies: whole
// storage units, so a 1541 (683 blocks) on FD / CMD HD takes 342
// clusters including one filler sector (D2M-DNP.TXT, CMDHD.TXT).
function cmdContainerPartitionBytes(containerKey, type, sizeBlocks) {
  var ct = CMD_CONTAINERS[containerKey];
  var unit = (ct && ct.sizeUnit) || 256;
  var units = Math.ceil(sizeBlocks * 256 / unit);
  var fixed = ct && ct.fixedTypeUnits && ct.fixedTypeUnits[type];
  if (fixed && fixed > units) units = fixed;
  return units * unit;
}

// Write a 32-byte partition entry. Bytes 0x00..0x01 are left alone (chain
// link on sectored tables); the caller stamps SYSTEM's 01 01 flags.
function writeCmdContainerPartitionEntry(buffer, containerKey, slotIdx, type, name, startByte, sizeBlocks) {
  var ct = CMD_CONTAINERS[containerKey];
  if (!ct) return;
  var data = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  var layout = ct.getTableLayout(buffer);
  var off = _cmdContainerSlotOffset(layout, slotIdx);
  if (off < 0) return;

  for (var i = 0x02; i < 0x20; i++) data[off + i] = 0x00;
  data[off + 0x02] = type;
  var upper = (name || '').toUpperCase();
  for (var n = 0; n < 16; n++) {
    data[off + 0x05 + n] = n < upper.length ? upper.charCodeAt(n) : 0xA0;
  }
  _cmdContainerWriteStart(data, off, ct.startEnc, startByte);
  var stored = cmdContainerPartitionBytes(containerKey, type, sizeBlocks) / (ct.sizeUnit || 256);
  data[off + 0x1D] = (stored >>> 16) & 0xFF;
  data[off + 0x1E] = (stored >>> 8) & 0xFF;
  data[off + 0x1F] = stored & 0xFF;
}

// Delete a partition: shift every partition above it down by its size,
// zero the freed tail, and clear only the slot's type byte (name/start/
// size stay as residue). Matches RAM-Tools v1.02 and the FD2000 ROM's
// d-p command.
function clearCmdContainerPartitionEntry(buffer, containerKey, slotIdx) {
  var ct = CMD_CONTAINERS[containerKey];
  if (!ct) return;
  var data = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  var layout = ct.getTableLayout(buffer);
  var off = _cmdContainerSlotOffset(layout, slotIdx);
  if (off < 0) return;

  var info = readCmdContainerPartitions(buffer, containerKey);
  var deleted = info && info.partitions.filter(function(p) { return p.index === slotIdx; })[0];
  if (deleted && !isCmdSystemPartition(deleted)) {
    var delStart = deleted.startByte;
    var delSize = deleted.sizeBytes;
    // Ascending order: each move lands in bytes the previous one freed.
    var toShift = info.partitions
      .filter(function(p) { return p.index !== slotIdx && !isCmdSystemPartition(p) && p.type !== 0x00 && p.startByte > delStart; })
      .sort(function(a, b) { return a.startByte - b.startByte; });
    var maxEndBefore = delStart + delSize;
    for (var i = 0; i < toShift.length; i++) {
      var p = toShift[i];
      data.set(data.subarray(p.startByte, p.startByte + p.sizeBytes), p.startByte - delSize);
      var entryOff = _cmdContainerSlotOffset(layout, p.index);
      if (entryOff >= 0) _cmdContainerWriteStart(data, entryOff, ct.startEnc, p.startByte - delSize);
      var end = p.startByte + p.sizeBytes;
      if (end > maxEndBefore) maxEndBefore = end;
    }
    for (var z = Math.max(0, maxEndBefore - delSize); z < maxEndBefore && z < buffer.byteLength; z++) data[z] = 0;
  }

  data[off + 0x02] = 0x00;
}

// Build a fresh RAMLink container matching VICE's "empty RAMCard" output:
// one Native partition "RAMLINK  1" over [0, size − 64 KiB), then the
// firmware's 240-block scratch gap and the 16-sector SYSTEM partition
// (bookkeeping block at +0x500, partition table at sector 8, chain
// markers on sectors 9-11). Without the bookkeeping block VICE treats
// the container as uninitialised RAM.
function createEmptyRamLink(sizeMiB) {
  var size = sizeMiB * 1024 * 1024;
  var totalBlocks = size / 256;
  var natBlocks = totalBlocks - 256;
  var natTracks = natBlocks / 256; // DNP: 256 sectors per track
  var natBytes = natBlocks * 256;
  var buf = new ArrayBuffer(size);
  var data = new Uint8Array(buf);

  // 1. Default Native partition filesystem at byte 0. createEmptyDisk
  // touches currentFormat / currentTracks; restore them so the caller's
  // view isn't disturbed.
  var savedFmt = currentFormat, savedTracks = currentTracks;
  var natBuf = createEmptyDisk('dnp', natTracks);
  currentFormat = savedFmt;
  currentTracks = savedTracks;
  var natSrc = new Uint8Array(natBuf);
  for (var i = 0; i < natSrc.length && i < natBytes; i++) data[i] = natSrc[i];
  // VICE writes the partition's name into the DNP header too, so the
  // disk-header line shows "RAMLINK  1" when the firmware mounts it.
  // Header sits at T1/S1 offset 4 (= file offset 0x104), 16 bytes.
  var natHeaderName = 'RAMLINK  1';
  for (var hn = 0; hn < 16; hn++) {
    data[0x104 + hn] = hn < natHeaderName.length ? natHeaderName.charCodeAt(hn) : 0xA0;
  }
  // ID bytes — VICE writes "RL" both in the disk header (T1/S1 offset
  // 0x16) and in the BAM (T1/S2 offset 0x04). createEmptyDisk leaves
  // both as 0xA0 0xA0, so override after the fact.
  data[0x116] = 0x52; // T1/S1 ID byte 1: 'R'
  data[0x117] = 0x4C; // T1/S1 ID byte 2: 'L'
  data[0x204] = 0x52; // T1/S2 BAM ID byte 1
  data[0x205] = 0x4C; // T1/S2 BAM ID byte 2

  // 2. System partition (last 4 KiB).
  var sysStart = size - 4096;

  // 2a. Bookkeeping block +0x500..+0x5FF, verbatim from VICE: 0x80 marker,
  //     0xFF filler with `00 00` pairs at +0x538/+0x570/+0x5A8, ID block at
  //     +0x5E0, "RAMLINK     " at +0x5F0, 0xAA × 4 at +0x5FC. Size-dependent
  //     (from VICE 1/8/16 MiB samples): +0x571 and +0x5EB = sizeMiB << 4,
  //     +0x5EE = (sizeMiB - 1) << 4.
  var byteSizeMark1 = (sizeMiB << 4) & 0xFF;
  var byteSizeMark2 = ((sizeMiB - 1) << 4) & 0xF0;

  for (var f = 0; f < 256; f++) data[sysStart + 0x500 + f] = 0xFF;
  data[sysStart + 0x500] = 0x80;
  data[sysStart + 0x538] = 0x00; data[sysStart + 0x539] = 0x00;
  data[sysStart + 0x570] = 0x00; data[sysStart + 0x571] = byteSizeMark1;
  data[sysStart + 0x5A8] = 0x00; data[sysStart + 0x5A9] = 0x00;

  var rlIdBlock = [0xFF, 0x10, 0x01, 0x01, 0x10, 0xFF, 0xFF, 0xFF,
                   0x01, 0x00, 0xFF, 0x00, 0xFF, 0xFF, 0x00, 0xFF];
  rlIdBlock[0x0B] = byteSizeMark1;  // +0x5EB
  rlIdBlock[0x0E] = byteSizeMark2;  // +0x5EE
  for (var b = 0; b < 16; b++) data[sysStart + 0x5E0 + b] = rlIdBlock[b];
  var sig = 'RAMLINK     '; // 7 letters + 5 spaces = 12 bytes
  for (var s = 0; s < 12; s++) data[sysStart + 0x5F0 + s] = sig.charCodeAt(s);
  data[sysStart + 0x5FC] = 0xAA;
  data[sysStart + 0x5FD] = 0xAA;
  data[sysStart + 0x5FE] = 0xAA;
  data[sysStart + 0x5FF] = 0xAA;

  // 2b. Chain link bytes at sectors 9/10/11 of the system partition.
  data[sysStart + 0x900] = 0x01; data[sysStart + 0x901] = 0x02;
  data[sysStart + 0xA00] = 0x01; data[sysStart + 0xA01] = 0x03;
  data[sysStart + 0xB00] = 0x00; data[sysStart + 0xB01] = 0xFF;

  // 2c. Partition table at sector 8.
  writeCmdContainerPartitionEntry(buf, 'ramlink', 0, CMD_PART_TYPE_SYSTEM, 'SYSTEM', sysStart, 16);
  // SYSTEM record's flag bytes are `01 01` (the generic writer leaves
  // bytes 0/1 untouched; stamp afterwards).
  data[sysStart + 0x800 + 0] = 0x01;
  data[sysStart + 0x800 + 1] = 0x01;
  writeCmdContainerPartitionEntry(buf, 'ramlink', 1, 0x01, 'RAMLINK  1', 0, natBlocks);

  return buf;
}

// ── CMD HD DOS shadow ────────────────────────────────────────────────
// HD-DOS lives on the disk itself; without it a DHD won't boot. We don't
// ship it — it's captured from any opened DHD and cached in localStorage.
var DHD_DOS_OFFSET = 0x30400;  // sector 772
var DHD_DOS_SIZE   = 0x7C00;   // 31 KiB
var DHD_DOS_LS_KEY = 'cbm-dhd-hddos-shadow-v2';

// True when the DOS region holds ≥256 non-zero bytes.
function dhdHasDosShadow(buffer) {
  if (!buffer || buffer.byteLength < DHD_DOS_OFFSET + DHD_DOS_SIZE) return false;
  var data = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  var nonZero = 0;
  for (var i = 0; i < DHD_DOS_SIZE; i++) {
    if (data[DHD_DOS_OFFSET + i] !== 0) {
      nonZero++;
      if (nonZero >= 256) return true;
    }
  }
  return false;
}

function extractDhdDosShadow(buffer) {
  if (!dhdHasDosShadow(buffer)) return null;
  var data = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  return data.slice(DHD_DOS_OFFSET, DHD_DOS_OFFSET + DHD_DOS_SIZE);
}

function installDhdDosShadow(buffer, shadow) {
  if (!buffer || !shadow) return false;
  if (buffer.byteLength < DHD_DOS_OFFSET + DHD_DOS_SIZE) return false;
  var data = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  data.set(shadow.subarray(0, DHD_DOS_SIZE), DHD_DOS_OFFSET);
  return true;
}

// Persist a captured shadow as base64 in localStorage. Silent on quota /
// SecurityError so headless test environments don't trip.
function saveDhdDosShadow(shadow) {
  if (!shadow || typeof localStorage === 'undefined') return false;
  try {
    var chunkSize = 0x4000;
    var s = '';
    for (var i = 0; i < shadow.length; i += chunkSize) {
      s += String.fromCharCode.apply(null, shadow.subarray(i, i + chunkSize));
    }
    localStorage.setItem(DHD_DOS_LS_KEY, btoa(s));
    return true;
  } catch (e) {
    return false;
  }
}

function loadDhdDosShadow() {
  if (typeof localStorage === 'undefined') return null;
  try {
    var b64 = localStorage.getItem(DHD_DOS_LS_KEY);
    if (!b64) return null;
    var s = atob(b64);
    if (s.length !== DHD_DOS_SIZE) return null;
    var out = new Uint8Array(DHD_DOS_SIZE);
    for (var i = 0; i < DHD_DOS_SIZE; i++) out[i] = s.charCodeAt(i);
    return out;
  } catch (e) {
    return null;
  }
}

function hasStoredDhdDosShadow() {
  if (typeof localStorage === 'undefined') return false;
  try { return !!localStorage.getItem(DHD_DOS_LS_KEY); } catch (e) { return false; }
}

// Read the HD-DOS version + date strings. Layout at the start of the
// shadow: 16 bytes of header, 4 spaces, 4-byte version (e.g. "1.92"),
// then 8-byte date (e.g. "03/22/96"). Returns { version, date } with
// either field nullable, or null when neither parses.
function readDhdDosVersionFrom(bytes, base) {
  function readAscii(off, len) {
    var s = '';
    for (var i = 0; i < len; i++) {
      var b = bytes[base + off + i];
      if (b < 0x20 || b >= 0x7F) break;
      s += String.fromCharCode(b);
    }
    return s.trim();
  }
  var v = readAscii(0x14, 4);
  var d = readAscii(0x18, 8);
  var versionOk = /^[0-9](\.[0-9]+)?$/.test(v);
  var dateOk = /^\d{2}\/\d{2}\/\d{2}$/.test(d);
  if (!versionOk && !dateOk) return null;
  return { version: versionOk ? v : null, date: dateOk ? d : null };
}

function extractDhdDosVersion(buffer) {
  if (!buffer) return null;
  var data = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  // Two call shapes: full DHD (look at +DHD_DOS_OFFSET) or just the shadow.
  if (data.length >= DHD_DOS_OFFSET + 0x40) return readDhdDosVersionFrom(data, DHD_DOS_OFFSET);
  if (data.length >= 0x40) return readDhdDosVersionFrom(data, 0);
  return null;
}

// Fresh CMD HD: just the SYSTEM partition, grown as partitions are added
// (CMD's tools don't pre-allocate either).
var DHD_MIN_SIZE = 0x42000; // sectors 0..1055, ending where SYSTEM ends

function createEmptyDhd() {
  var buf = new ArrayBuffer(DHD_MIN_SIZE);
  var data = new Uint8Array(buf);

  var dosShadow = loadDhdDosShadow();
  if (dosShadow) installDhdDosShadow(buf, dosShadow);

  // Table sectors chain `01 NN` … `00 FF`; slot 0's flags are the first link.
  for (var s = 0; s <= 30; s++) {
    data[DHD_PART_TABLE_OFFSET + s * 256 + 0] = 0x01;
    data[DHD_PART_TABLE_OFFSET + s * 256 + 1] = (s + 1) & 0xFF;
  }
  data[DHD_PART_TABLE_OFFSET + 31 * 256 + 0] = 0x00;
  data[DHD_PART_TABLE_OFFSET + 31 * 256 + 1] = 0xFF;

  // SYSTEM record: starts at sector 768, 144 × 512-byte clusters.
  writeCmdContainerPartitionEntry(buf, 'dhd', 0, CMD_PART_TYPE_SYSTEM, 'SYSTEM', 0x30000, 288);

  return buf;
}

// Return an ArrayBuffer of at least `newSize` bytes with the old contents
// copied in. Returns `oldBuf` unchanged when no growth is needed. Clamps
// to V8's maxByteLength (4 GiB − 1). Caller must re-assign every alias.
function growCmdContainer(oldBuf, newSize) {
  if (newSize > 0xFFFFFFFF) newSize = 0xFFFFFFFF;
  if (newSize <= oldBuf.byteLength) return oldBuf;
  var newBuf = new ArrayBuffer(newSize);
  new Uint8Array(newBuf).set(new Uint8Array(oldBuf));
  return newBuf;
}

// Trim a grow-as-needed container down to whatever its current
// partitions still need. Returns the same buffer when the container
// isn't shrinkable (RAMLink / FD have a fixed size) or no slack exists.
// Counterpart to growCmdContainer — usually called after a delete to
// reclaim the freed tail.
function compactCmdContainer(oldBuf, containerKey) {
  var ct = CMD_CONTAINERS[containerKey];
  if (!ct || !ct.getMaxGrownSize) return oldBuf;
  var info = readCmdContainerPartitions(oldBuf, containerKey);
  if (!info) return oldBuf;
  var highEnd = 0;
  for (var i = 0; i < info.partitions.length; i++) {
    var p = info.partitions[i];
    if (p.type === 0x00) continue;
    var end = p.startByte + p.sizeBytes;
    if (end > highEnd) highEnd = end;
  }
  if (highEnd & 0xFF) highEnd = (highEnd + 0x100) & ~0xFF;
  if (highEnd >= oldBuf.byteLength) return oldBuf;
  var newBuf = new ArrayBuffer(highEnd);
  new Uint8Array(newBuf).set(new Uint8Array(oldBuf).subarray(0, highEnd));
  return newBuf;
}

function detectFormat(bufferSize, buffer) {
  if (buffer) {
    var data = new Uint8Array(buffer);
    // File-format magics (fixed file headers, not filesystem state):
    // TAP "C64-TAPE-RAW"
    if (bufferSize >= 20 && data[0] === 0x43 && data[1] === 0x36 && data[2] === 0x34 &&
        data[3] === 0x2D && data[4] === 0x54 && data[5] === 0x41 && data[6] === 0x50 && data[7] === 0x45) {
      return { format: DISK_FORMATS.tap, tracks: 0 };
    }
    // T64 "C64"
    if (bufferSize >= 64 && data[0] === 0x43 && data[1] === 0x36 && data[2] === 0x34) {
      return { format: DISK_FORMATS.t64, tracks: 0 };
    }
    // IDE64 .hdd: any size, so only the boot-sector magic identifies it.
    if (typeof isIde64Hdd === 'function' && isIde64Hdd(data)) {
      return { format: DISK_FORMATS.hdd, tracks: 0 };
    }
  }
  // Size first: header bytes (IDs, names, DOS type) are user-editable.
  for (const [key, fmt] of Object.entries(DISK_FORMATS)) {
    for (const size of fmt.sizes) {
      if (bufferSize === size.bytes) return { format: fmt, tracks: size.tracks };
    }
  }
  // Any other 64 KiB multiple up to 255 tracks is a DNP.
  if (bufferSize >= 65536 && bufferSize % 65536 === 0 && bufferSize <= 16711680) {
    return { format: DISK_FORMATS.dnp, tracks: bufferSize / 65536 };
  }
  // Final fallback: assume D64 (35 or 40 tracks depending on size).
  if (bufferSize >= 196608) return { format: DISK_FORMATS.d64, tracks: 40 };
  return { format: DISK_FORMATS.d64, tracks: 35 };
}

// Precompute track offsets for all possible tracks (up to 80 for D81)
const TRACK_OFFSETS_CACHE = {};

function getTrackOffsets(format, maxTracks) {
  const key = format.name + ':' + maxTracks;
  if (TRACK_OFFSETS_CACHE[key]) return TRACK_OFFSETS_CACHE[key];
  const offsets = [0];
  let offset = 0;
  for (let t = 1; t <= maxTracks; t++) {
    offsets.push(offset);
    offset += format.sectorsPerTrack(t) * 256;
  }
  TRACK_OFFSETS_CACHE[key] = offsets;
  return offsets;
}

/** @param {number} track @param {number} sector @returns {number} Byte offset or -1 */
function sectorOffset(track, sector, ctx) {
  const fmt = ctx.format;
  // Formats with lbaAddressing:true (D1M/D2M/D4M) treat directory entries
  // and file-chain bytes as LBA-encoded — sector_idx = (T-1) × 256 + S,
  // byte = idx × 256. S ranges 0..255 regardless of physical SPT. For
  // T=1 the formula collapses to physical addressing, so BAM/header/dir
  // reads work too. (Dir-chain bytes still use physical T:S — parseDisk's
  // loop adds its own bounds check to short-circuit those.)
  if (fmt && fmt.lbaAddressing) {
    if (track < 1 || sector < 0 || sector > 255) return -1;
    return ((track - 1) * 256 + sector) * 256;
  }
  const maxTrack = ctx.tracks || 40;
  if (track < 1 || track > maxTrack) return -1;
  if (sector < 0 || sector >= fmt.sectorsPerTrack(track)) return -1;
  const offsets = getTrackOffsets(fmt, maxTrack);
  return offsets[track] + sector * 256;
}


// ── CMD FD system partition (D1M/D2M/D4M, track 81) ──────────────────
// Per-format constants for fresh "full-formatted" disks, verified
// byte-exact against the empty d1m.d1m / d2m.d2m / d4m.d4m references:
//   - sig at signature sector +0x71/+0xA9: data area in 512-byte logical
//     sectors (= disk size minus last physical track / 512).
//   - partSize at partition 1 entry +0x1E/+0x1F: filesystem capacity in
//     1024-byte clusters (= logicalTracks × 128).
//   - logicalTracks: BAM logical-track count (byte +0x08 of T1/S2).
//     Each "logical track" = a 32-byte slot covering 256 LBAs.
//   - bamMark: the two-byte format identifier at BAM header +0x04..+0x05
//     ('TT' / 'T2' / 'T3'). Used by the FD ROM to identify density.
var _CMD_FD_SIG = {
  d1m: { sigHi71: 0x06, sigLoA9: 0x40, partSizeHi1E: 0x06, partSizeLo1F: 0x00, logicalTracks: 12, bamMark: [0x54, 0x54] }, // sig 1600, partSize 1536, 'TT'
  d2m: { sigHi71: 0x0C, sigLoA9: 0x80, partSizeHi1E: 0x0C, partSizeLo1F: 0x80, logicalTracks: 25, bamMark: [0x54, 0x32] }, // sig 3200, partSize 3200, 'T2'
  d4m: { sigHi71: 0x19, sigLoA9: 0x00, partSizeHi1E: 0x19, partSizeLo1F: 0x00, logicalTracks: 50, bamMark: [0x54, 0x33] }, // sig 6400, partSize 6400, 'T3'
};
var _CMD_FD_MAGIC = 'CMD FD SERIES   '; // 16 bytes at t81 s5 + 0xF0

// Write the CMD FD system partition on the last track of a D1M/D2M/D4M image.
function writeCmdFdSystemPartition(data, formatKey, numTracks) {
  var cfg = _CMD_FD_SIG[formatKey];
  if (!cfg) return;
  var fmt = DISK_FORMATS[formatKey];
  var spt = fmt.sectorsPerTrack(1);
  var tLast = (numTracks - 1) * spt * 256; // last-track base offset

  // ── Signature sector (s5): mostly 0xFF with per-format psize markers + magic ──
  var sigOff = tLast + 5 * 256;
  for (var i = 0; i < 256; i++) data[sigOff + i] = 0xFF;
  data[sigOff + 0x00] = 0x00;
  data[sigOff + 0x38] = 0x00; data[sigOff + 0x39] = 0x00;       // partition-area offset (=0)
  data[sigOff + 0x70] = 0x00; data[sigOff + 0x71] = cfg.sigHi71; // psize high
  data[sigOff + 0xA8] = 0x00; data[sigOff + 0xA9] = cfg.sigLoA9; // psize low
  data[sigOff + 0xE0] = 0x00; data[sigOff + 0xE1] = 0x00;
  data[sigOff + 0xE2] = 0x01; data[sigOff + 0xE3] = 0x01;         // default-partition fields
  for (var z = 0xE4; z < 0xF0; z++) data[sigOff + z] = 0x00;
  for (var m = 0; m < 16; m++) data[sigOff + 0xF0 + m] = _CMD_FD_MAGIC.charCodeAt(m);

  // ── Partition directory chain (s8 -> s9 -> s10 -> s11), zero-fill first ──
  for (var s = 8; s <= 11; s++) {
    var so = tLast + s * 256;
    for (var k = 0; k < 256; k++) data[so + k] = 0x00;
  }
  var s8  = tLast +  8 * 256;
  var s9  = tLast +  9 * 256;
  var s10 = tLast + 10 * 256;
  var s11 = tLast + 11 * 256;
  // Chain-link bytes (VICE's exact pattern; first entry of s8 happens to start with 01 01)
  data[s8  + 0] = 0x01; data[s8  + 1] = 0x01;
  data[s9  + 0] = 0x01; data[s9  + 1] = 0x02;
  data[s10 + 0] = 0x01; data[s10 + 1] = 0x03;
  data[s11 + 0] = 0x00; data[s11 + 1] = 0xFF;

  // Entry 0 in s8 — SYSTEM (type 0xFF)
  data[s8 + 0x02] = 0xFF;
  // +0x03..+0x04 already 0x00
  var sysName = 'SYSTEM';
  for (var n = 0; n < 16; n++) {
    data[s8 + 0x05 + n] = n < sysName.length ? sysName.charCodeAt(n) : 0xA0;
  }
  // +0x15..+0x1F already 0x00 (size = 0 for SYSTEM)

  // Entry 1 in s8 — PARTITION 1 (native, type 0x01)
  var e1 = s8 + 0x20;
  data[e1 + 0x00] = 0x00; data[e1 + 0x01] = 0x00;
  data[e1 + 0x02] = 0x01;
  var pName = 'PARTITION 1';
  for (var p = 0; p < 16; p++) {
    data[e1 + 0x05 + p] = p < pName.length ? pName.charCodeAt(p) : 0xA0;
  }
  // Start LBA (+0x15..+0x17) left 0; size at +0x1D..+0x1F
  data[e1 + 0x1E] = cfg.partSizeHi1E;
  data[e1 + 0x1F] = cfg.partSizeLo1F;
}

function createCmdNativeImage(formatKey, numTracks) {
  var fmt = DISK_FORMATS[formatKey] || DISK_FORMATS.dnp;
  var spt = fmt.sectorsPerTrack(1);
  numTracks = numTracks || fmt.sizes[0].tracks;
  var size = numTracks * spt * 256;
  var data = new Uint8Array(size);

  // Track 1, Sector 1: partition header (track 1 starts at offset 0)
  var hdrOff = 1 * 256;
  data[hdrOff + 0x00] = fmt.dirTrack;
  data[hdrOff + 0x01] = fmt.dirSector;
  data[hdrOff + 0x02] = fmt.dosVersion;
  for (var i = 0; i < fmt.nameLength; i++) data[hdrOff + fmt.nameOffset + i] = 0xA0;
  // $A0 pads at $14-$15 and $1B-$1C, as in every VICE-formatted header.
  data[hdrOff + 0x14] = 0xA0;
  data[hdrOff + 0x15] = 0xA0;
  data[hdrOff + fmt.idOffset + 0] = 0xA0;
  data[hdrOff + fmt.idOffset + 1] = 0xA0;
  data[hdrOff + fmt.idOffset + 2] = 0xA0;
  data[hdrOff + fmt.idOffset + 3] = fmt.dosType.charCodeAt(0);
  data[hdrOff + fmt.idOffset + 4] = fmt.dosType.charCodeAt(1);
  data[hdrOff + 0x1B] = 0xA0;
  data[hdrOff + 0x1C] = 0xA0;
  data[hdrOff + fmt.subdirSelfRef] = fmt.headerTrack;
  data[hdrOff + fmt.subdirSelfRef + 1] = fmt.headerSector;
  data[hdrOff + fmt.subdirParentRef] = 0x00;
  data[hdrOff + fmt.subdirParentRef + 1] = 0x00;

  // Track 1, Sector 2: BAM header + bitmap.
  var bam0Off = 2 * 256;
  data[bam0Off + 0x02] = fmt.dosVersion;
  data[bam0Off + 0x03] = ~fmt.dosVersion & 0xFF;
  data[bam0Off + 0x06] = 0xC0; // I/O byte

  var fdCfg = _CMD_FD_SIG[formatKey];
  if (fdCfg) {
    // FD native BAM: one 32-byte slot per 256-LBA logical track from
    // T1/S2 +0x20, +0x08 = slot count, +0x04/5 = density mark.
    data[bam0Off + 0x04] = fdCfg.bamMark[0];
    data[bam0Off + 0x05] = fdCfg.bamMark[1];
    var fdLogicalTracks = fdCfg.logicalTracks;
    data[bam0Off + 0x08] = fdLogicalTracks;
    var bitmapStart = bam0Off + 0x20;
    for (var i = 0; i < fdLogicalTracks * 32; i++) {
      data[bitmapStart + i] = 0xFF;
    }
    // Mark slot 0 sectors 0..34 used (MSB-first)
    for (var us = 0; us <= 34; us++) {
      data[bitmapStart + (us >> 3)] &= ~(0x80 >> (us & 7));
    }
  } else {
    // DNP BAM: one 32-byte slot per physical track across T1/S2..S33.
    data[bam0Off + 0x04] = 0xA0; data[bam0Off + 0x05] = 0xA0;
    data[bam0Off + 0x08] = numTracks;
    for (var b = 32; b < 256; b++) data[bam0Off + b] = 0xFF;
    for (var s = 3; s <= 33; s++) {
      var sOff = s * 256;
      for (var b2 = 0; b2 < 256; b2++) data[sOff + b2] = 0xFF;
    }
    // Mark track 1 sectors 0-34 as used in BAM (MSB-first bit order)
    var t1bm = bam0Off + 32;
    for (var us2 = 0; us2 <= 34; us2++) {
      data[t1bm + (us2 >> 3)] &= ~(0x80 >> (us2 & 7));
    }
  }

  // Track 1, Sector 34: first directory sector
  var dirOff = 34 * 256;
  data[dirOff + 0] = 0x00; data[dirOff + 1] = 0xFF;

  // VICE leaves the system sectors free in the BAM; getProtectedSectors()
  // keeps them from being allocated instead.
  if (formatKey !== 'dnp' && _CMD_FD_SIG[formatKey]) {
    writeCmdFdSystemPartition(data, formatKey, numTracks);
  }

  return data.buffer;
}
