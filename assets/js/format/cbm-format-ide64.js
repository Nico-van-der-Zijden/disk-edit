// ── IDE64 / CFS 0.11 container support ────────────────────────────────
//
// .hdd images hold the CFS 0.11 filesystem used by the IDE64 cartridge.
// 512-byte sectors, LBA addressing, B-tree files — none of the CBM-DOS
// helpers (sectorOffset, forEachFileSector, readFileData, BAM walkers)
// apply. CFS runs as a parallel parser; the only thing shared with the
// CBM-DOS side is the tab/buffer shell and partition-list UI shape.
//
// Phase 1 scope: detect the container, list its 16 partitions for the
// partition-list view. Entering a CFS partition is Phase 2.
//
// Spec sources used here:
//   - cfs.html (https://singularcrew.hu/idedos/cfs.html) — high-level
//     overview. Note the spec page understates the partition-name field
//     length (says 8, actually 16) and partition-entry offsets; the C
//     source below is authoritative.
//   - fusecfs 2.0.4 (block.c, cfs011mount.c) — Soci/Singular's FUSE
//     driver. The partition entry / pointer encoding here matches its
//     offset_from() codec and the partition-loading loop in
//     cfs011_init exactly.

var IDE64_MAGIC_STRING = 'C64 CFS V 0.11B ';
var IDE64_MAGIC_OFFSET = 0x08;
var IDE64_SECTOR_SIZE = 512;
var IDE64_PARTITION_ENTRIES = 16;
var IDE64_PARTITION_ENTRY_SIZE = 32;

// CFS directory entry layout (32 bytes, 16 per 512-B sector):
//   $00..$0F  16  filename (space- or null-padded)
//   $10..$13   4  32-bit file size (LE) — for DIR/LNK this slot has other meaning
//   $14..$17   4  data-tree root pointer (LBA + flags via the standard codec)
//   $18        1  attribute byte: bits 0..2 = FTYPE, bit 7 = closed, rest = perms
//   $19..$1B   3  3-byte type suffix display string ("PRG" / "SEQ" / "USR" / "REL" / "DIR" / "LNK")
//   $1C..$1F   4  packed creation/modification time
//
// FTYPE values (low 3 bits of $18) — from fusecfs FTYPE enum:
//   0 = DEL, 1 = normal file (variant in $19..$1B), 2 = REL,
//   3 = DIR, 4 = LNK, 5..7 = reserved.
var CFS_FTYPE = {
  DEL: 0,
  NORMAL: 1,
  REL: 2,
  DIR: 3,
  LNK: 4,
};
var CFS_FTYPE_MASK = 0x07;
var CFS_DIR_ENTRY_SIZE = 32;
var CFS_DIR_ENTRIES_PER_SECTOR = 16;

// Decode the 4-byte packed mtime at directory-entry offset $1C..$1F.
// Layout (cross-checked between fusecfs decode_time and fill_in_time):
//   byte 0 bits 0..5 = seconds 0..59
//   byte 0 bits 6..7 = month bits 2..3 (top of 4-bit month)
//   byte 1 bits 0..5 = minutes 0..59
//   byte 1 bits 6..7 = month bits 0..1 (low of 4-bit month)
//   byte 2 bits 0..5 = year offset from 1980 (0..63 → 1980..2043)
//   byte 2 bits 6..7 = hour bits 3..4 (top of 5-bit hour)
//   byte 3 bits 0..4 = day 1..31
//   byte 3 bits 5..7 = hour bits 0..2 (low of 5-bit hour)
function decodeCfsTimestamp(b0, b1, b2, b3) {
  if (b0 === 0 && b1 === 0 && b2 === 0 && b3 === 0) return null;
  return {
    sec:   b0 & 0x3F,
    min:   b1 & 0x3F,
    hour:  (b3 >>> 5) | ((b2 >>> 3) & 0x18),
    day:   b3 & 0x1F,
    month: ((b0 >>> 4) & 0x0C) | ((b1 >>> 6) & 0x03),
    year:  1980 + (b2 & 0x3F),
    raw:   [b0, b1, b2, b3],
  };
}

// Format a decoded timestamp as `YYYY-MM-DD HH:MM:SS` (empty string for null).
function formatCfsTimestamp(ts) {
  if (!ts) return '';
  function pad(n) { return n < 10 ? '0' + n : '' + n; }
  return ts.year + '-' + pad(ts.month) + '-' + pad(ts.day) + ' ' +
         pad(ts.hour) + ':' + pad(ts.min) + ':' + pad(ts.sec);
}

// ── CFS B-tree file reader ────────────────────────────────────────────
//
// File content lives in 512-byte data sectors addressed by a B-tree of
// "tree sectors". Each tree sector contains 128 data-sector pointers
// (4 bytes each, 512 bytes total). The tree branches via "treelinks" —
// up-to-8 next-level pointers encoded across bits 5..4 of byte 0 of 16
// data-sector pointers in each 64-byte sub-region of the tree sector.
//
// Tree depth for a byte offset `off`:
//   m = floor(off / 65536); level grows by 1 every 8× of m.
//   level 0 = ≤64 KiB, 1 = ≤512 KiB, 2 = ≤4 MiB, ... up to 4 GiB.
//
// Walking down from the root, each level picks one of 8 treelinks based
// on a 3-bit slice of m peeled in reverse order. Same algorithm as
// fusecfs read_tree_search() (cfs011mount.c, GPL).

// Extract a 4-byte treelink pointer from a 64-byte tree-sector sub-region.
// Inverse encoding: the link's 4 bytes are scattered into bits 5..4 of
// byte 0 of 16 4-byte slots (in reverse 16-byte-block order).
function _cfsReadTreeLink(data, base) {
  var bytes = [0, 0, 0, 0];
  for (var i = 0; i < 4; i++) {
    var entryBase = base + (3 - i) * 16;
    var c = (data[entryBase] << 2) & 0xC0;
    c |= data[entryBase + 4] & 0x30;
    c |= (data[entryBase + 8] >>> 2) & 0x0C;
    c |= (data[entryBase + 12] >>> 4) & 0x03;
    bytes[i] = c;
  }
  var b0 = bytes[0], b1 = bytes[1], b2 = bytes[2], b3 = bytes[3];
  var lba = (b0 & 0x40) !== 0;
  var addr = lba ? (((b0 & 0x0F) << 24) | (b1 << 16) | (b2 << 8) | b3) : null;
  return { raw0: b0, lba: lba, addr: addr };
}

// Walk the B-tree from rootLba down to the leaf containing byteOffset.
// Returns the leaf-tree-sector LBA, or null if the path is broken /
// the file has a sparse hole at this offset.
function _cfsTreeSearch(data, rootLba, byteOffset) {
  var m = Math.floor(byteOffset / 65536);
  var m2 = 0;
  var level = 0;
  while (m > 0) {
    m--;
    m2 = (m2 << 1) | (m & 1); m = m >>> 1;
    m2 = (m2 << 1) | (m & 1); m = m >>> 1;
    m2 = (m2 << 1) | (m & 1); m = m >>> 1;
    level++;
  }
  var itt = rootLba;
  while (level > 0 && itt !== null && itt > 0) {
    var sectorBase = itt * IDE64_SECTOR_SIZE;
    if (sectorBase + IDE64_SECTOR_SIZE > data.length) return null;
    var slotOff = sectorBase + (m2 & 7) * 64;
    var link = _cfsReadTreeLink(data, slotOff);
    itt = (link.lba && link.addr > 0) ? link.addr : null;
    m2 = m2 >>> 3;
    level--;
  }
  return itt;
}

// Reads `fileSize` bytes from the file whose data-tree root is at
// `treeRootLba`. Returns { data: Uint8Array, error: string|null }, same
// shape as the CBM readFileData so the export pipeline can consume it.
//
// Holes (null pointers in the tree) read as zero — same semantics as
// fusecfs cfs011_read. Out-of-bounds tree/data sectors abort with the
// data read so far + an error string.
function readCfsFileData(buffer, treeRootLba, fileSize) {
  if (!buffer || fileSize <= 0 || treeRootLba == null || treeRootLba <= 0) {
    return { data: new Uint8Array(0), error: null };
  }
  var data = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  var result = new Uint8Array(fileSize);

  var offset = 0;
  var remaining = fileSize;
  var lastBlock = -1;
  var leafLba = null;
  var resultIdx = 0;

  while (remaining > 0) {
    var blockBoundary = offset & ~0xFFFF; // 64 KiB-aligned position
    if (lastBlock !== blockBoundary) {
      lastBlock = blockBoundary;
      leafLba = _cfsTreeSearch(data, treeRootLba, offset);
    }

    // Bytes still available in the current 512-byte data sector
    var sectorAvail = IDE64_SECTOR_SIZE - (offset & (IDE64_SECTOR_SIZE - 1));
    var copyLen = Math.min(remaining, sectorAvail);

    var dataSecLba = null;
    if (leafLba !== null && leafLba > 0) {
      var leafBase = leafLba * IDE64_SECTOR_SIZE;
      if (leafBase + IDE64_SECTOR_SIZE <= data.length) {
        // Data-pointer index inside the leaf: (offset / 512) % 128 → ×4 bytes
        var ptrOff = leafBase + ((offset >>> 7) & 0x1FC);
        var dp = _readIde64Pointer(data, ptrOff);
        if (dp.lba && dp.addr > 0) dataSecLba = dp.addr;
      } else {
        return { data: result.subarray(0, resultIdx), error: 'leaf sector past end of image' };
      }
    }

    if (dataSecLba !== null) {
      var dataByteOff = dataSecLba * IDE64_SECTOR_SIZE + (offset & (IDE64_SECTOR_SIZE - 1));
      if (dataByteOff + copyLen > data.length) {
        return { data: result.subarray(0, resultIdx), error: 'data sector past end of image' };
      }
      for (var b = 0; b < copyLen; b++) result[resultIdx + b] = data[dataByteOff + b];
    }
    // Sparse hole: result is zero-initialized, leave it.

    resultIdx += copyLen;
    offset += copyLen;
    remaining -= copyLen;
  }

  return { data: result, error: null };
}

// Read the "next directory sector" pointer encoded across all 16
// directory entries in a sector. Mirrors fusecfs get_dir_next(): the
// 4-byte next-sector pointer's bytes are reconstructed from bits 5..4
// of byte 0 of each entry's data-tree-pointer field ($14 within the
// 32-byte entry). Same bit-slicing idea as treelinks, just at a 32-byte
// stride instead of 4-byte.
function _cfsReadDirNext(data, sectorBase) {
  var bytes = [0, 0, 0, 0];
  for (var i = 0; i < 4; i++) {
    // i=0 → entries 12..15 (bytes 0x180+0x14, +0x34, +0x54, +0x74)
    // i=1 → entries 8..11
    // i=2 → entries 4..7
    // i=3 → entries 0..3
    var entryBase = sectorBase + 0x180 - i * 0x80;
    var c = (data[entryBase + 0x14] << 2) & 0xC0;
    c |= data[entryBase + 0x34] & 0x30;
    c |= (data[entryBase + 0x54] >>> 2) & 0x0C;
    c |= (data[entryBase + 0x74] >>> 4) & 0x03;
    bytes[i] = c;
  }
  var b0 = bytes[0], b1 = bytes[1], b2 = bytes[2], b3 = bytes[3];
  var lba = (b0 & 0x40) !== 0;
  var addr = lba ? (((b0 & 0x0F) << 24) | (b1 << 16) | (b2 << 8) | b3) : null;
  return { raw0: b0, lba: lba, addr: addr };
}

// Walk a directory's sector chain via _cfsReadDirNext and collect every
// entry across all sectors. Returns an array of entry objects (same
// shape as readCfsDirectorySector's output) plus a `dirLba` tag on each
// entry pointing at the sector it was read from. Capped at 64 sectors
// to match fusecfs's extend_dir limit. Cycle-detected via a visited set.
function readCfsDirectory(buffer, firstDirLba) {
  if (!buffer || !firstDirLba) return null;
  var data = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  var allEntries = [];
  var visited = {};
  var dirLba = firstDirLba;
  var sectorCount = 0;
  while (dirLba && !visited[dirLba] && sectorCount < 64) {
    visited[dirLba] = true;
    sectorCount++;
    var entries = readCfsDirectorySector(buffer, dirLba);
    if (!entries) break;
    for (var i = 0; i < entries.length; i++) {
      entries[i].dirLba = dirLba;
      entries[i].sectorIndex = sectorCount - 1;
      // Skip the per-sector self-ref tag for non-first sectors so the
      // UI doesn't hide entry 0 of every chained sector. Only the very
      // first directory sector's entry 0 is the dir's true self-reference.
      if (sectorCount > 1) entries[i].isSelfRef = false;
      allEntries.push(entries[i]);
    }
    var nextPtr = _cfsReadDirNext(data, dirLba * IDE64_SECTOR_SIZE);
    dirLba = (nextPtr.lba && nextPtr.addr > 0) ? nextPtr.addr : 0;
  }
  return allEntries;
}

// Parse one 512-byte CFS directory sector into 16 entries. Each entry's
// `empty` flag is true when the slot is all zeros (unused). Entry 0 is
// the dir's self-reference (its name = the directory's own name); the
// renderer skips it from the file list.
function readCfsDirectorySector(buffer, dirLba) {
  if (!buffer) return null;
  var data = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  var base = dirLba * IDE64_SECTOR_SIZE;
  if (base < 0 || base + IDE64_SECTOR_SIZE > data.length) return null;

  var entries = [];
  for (var i = 0; i < CFS_DIR_ENTRIES_PER_SECTOR; i++) {
    var off = base + i * CFS_DIR_ENTRY_SIZE;
    // Quick all-zero test
    var allZero = true;
    for (var z = 0; z < CFS_DIR_ENTRY_SIZE; z++) {
      if (data[off + z] !== 0) { allZero = false; break; }
    }
    if (allZero) {
      entries.push({ index: i, empty: true });
      continue;
    }

    var nameBytes = [];
    for (var n = 0; n < 16; n++) nameBytes.push(data[off + n]);
    var name = '';
    for (var k = 0; k < 16; k++) {
      var c = nameBytes[k];
      if (c === 0x00 || c === 0xA0) break;
      name += String.fromCharCode(c);
    }
    name = name.replace(/ +$/, '');

    var sizeLo = data[off + 0x10] | (data[off + 0x11] << 8) | (data[off + 0x12] << 16);
    var sizeHi = data[off + 0x13];
    // Per fusecfs: REL files store size in 24 bits (the high byte is REL-
    // specific metadata); everything else uses all 32 bits.
    var attrByte = data[off + 0x18];
    var ftype = attrByte & CFS_FTYPE_MASK;
    var size = (ftype === CFS_FTYPE.REL) ? sizeLo : (sizeLo + sizeHi * 0x1000000);

    var dataTree = _readIde64Pointer(data, off + 0x14);

    var typeSuffix = '';
    for (var ts = 0; ts < 3; ts++) {
      var sb = data[off + 0x19 + ts];
      if (sb === 0x00 || sb === 0x20 || sb === 0xA0) break;
      typeSuffix += String.fromCharCode(sb);
    }

    var mtime = decodeCfsTimestamp(data[off + 0x1C], data[off + 0x1D], data[off + 0x1E], data[off + 0x1F]);

    entries.push({
      index: i,
      empty: false,
      isSelfRef: i === 0,
      name: name,
      nameBytes: nameBytes,
      ftype: ftype,
      typeSuffix: typeSuffix,
      closed: (attrByte & 0x80) !== 0,
      attrByte: attrByte,
      size: size,
      dataTreePtr: dataTree,
      mtime: mtime,
    });
  }
  return entries;
}

// CFS partition type IDs. 3-bit value encoded in end-pointer byte 0
// across bits 7, 5, 4 (bit 6 is the LBA flag and is left alone).
var IDE64_PART_TYPE_NAMES = {
  0x00: 'Empty',
  0x01: 'CFS',
  0x02: 'GEOS',
  0x03: 'Reserved 3',
  0x04: 'Reserved 4',
  0x05: 'Reserved 5',
  0x06: 'Reserved 6',
  0x07: 'Reserved 7',
};

// True iff buffer starts with the IDE64 / CFS boot-sector magic. This is
// the only byte-pattern detection we use for the format; the magic lives
// at a fixed boot-sector offset and isn't a user-editable surface in this
// app, so it's allowed under the size-first detection policy.
function isIde64Hdd(buffer) {
  if (!buffer) return false;
  var data = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  if (data.length < IDE64_MAGIC_OFFSET + 16) return false;
  for (var i = 0; i < 16; i++) {
    if (data[IDE64_MAGIC_OFFSET + i] !== IDE64_MAGIC_STRING.charCodeAt(i)) return false;
  }
  return true;
}

// Read a 4-byte CFS pointer. Per fusecfs offset_from():
//   byte 0 bit 6   LBA flag (1 = LBA, 0 = CHS)
//   byte 0 bits 3-0 head (CHS) or LBA bits 27-24
//   byte 1         cyl-high (CHS) or LBA bits 23-16
//   byte 2         cyl-low  (CHS) or LBA bits 15-8
//   byte 3         sector (1-based CHS, 1..63) or LBA bits 7-0
// Bit 7 carries VALID (start-ptr) or part of the partition TYPE field
// (end-ptr). bits 5/4 carry HIDDEN/WRITEABLE on start-ptr or more of the
// TYPE field on end-ptr. Higher-level callers decode those.
function _readIde64Pointer(data, off) {
  var b0 = data[off];
  var b1 = data[off + 1];
  var b2 = data[off + 2];
  var b3 = data[off + 3];
  var lba = (b0 & 0x40) !== 0;
  var lbaAddr = lba ? (((b0 & 0x0F) << 24) | (b1 << 16) | (b2 << 8) | b3) : null;
  return {
    raw0: b0,
    lba: lba,
    addr: lbaAddr,
    chsHead: lba ? null : (b0 & 0x0F),
    chsCyl: lba ? null : ((b1 << 8) | b2),
    chsSec: lba ? null : b3,
  };
}

// 3-bit partition type encoded in end-pointer byte 0 bits 7, 5, 4:
//   bit 4 → TYPE bit 0
//   bit 5 → TYPE bit 1
//   bit 7 → TYPE bit 2
// (bit 6 is the LBA flag, kept clear of the type field.) So a CFS
// partition has byte 0 == 0x10 | optional flags; GEOS would be 0x20.
function _ide64PartTypeFromEnd(b0) {
  var t = 0;
  if (b0 & 0x10) t |= 0x01;
  if (b0 & 0x20) t |= 0x02;
  if (b0 & 0x80) t |= 0x04;
  return t;
}

// Boot sector layout — bytes referenced match the fusecfs driver's
// cfs011_init() boot-sector reads (block.data + 0x18 etc):
//   $0001    1   default partition (0..15)
//   $0004    4   @last-disk-sector pointer (CHS geometry probe)
//   $0008    16  magic ID "C64 CFS V 0.11B "
//   $0018    4   @partition directory pointer
//   $001C    4   @partition directory backup
//   $0020   16   disk label (PETSCII / ASCII, space padded)
function parseIde64BootSector(buffer) {
  if (!buffer) return null;
  var data = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  if (data.length < IDE64_SECTOR_SIZE) return null;
  if (!isIde64Hdd(data)) return null;
  var lastSector = _readIde64Pointer(data, 0x04);
  var partDir = _readIde64Pointer(data, 0x18);
  var partDirBackup = _readIde64Pointer(data, 0x1C);
  var labelRaw = [];
  for (var i = 0; i < 16; i++) labelRaw.push(data[0x20 + i]);
  var label = '';
  for (var li = 0; li < labelRaw.length; li++) {
    var c = labelRaw[li];
    if (c === 0xA0 || c === 0x00) break;
    label += String.fromCharCode(c);
  }
  return {
    defaultPart: data[0x01],
    lastSector: lastSector,
    partDir: partDir,
    partDirBackup: partDirBackup,
    label: label.replace(/ +$/, ''),
    labelBytes: labelRaw,
  };
}

// Partition directory: 1 × 512-B sector at the LBA in the boot sector's
// @partition-directory pointer. 16 entries × 32 bytes each:
//   $00 16  partition name (PETSCII, $A0 or null padded)
//   $10 4   start pointer (VALID=bit7, LBA=bit6, HIDDEN=bit5, WRITEABLE=bit4)
//   $14 4   end pointer (TYPE encoded in bits 7/5/4, LBA=bit6)
//   $18 4   deleted-directory pointer (CFS-specific)
//   $1C 4   root-directory pointer + bitmap-bit-7 flag (CFS-specific)
function readIde64Partitions(buffer) {
  if (!buffer) return null;
  var data = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  var boot = parseIde64BootSector(data);
  if (!boot || !boot.partDir.lba) return null;
  var dirByteOff = boot.partDir.addr * IDE64_SECTOR_SIZE;
  if (dirByteOff < 0 || dirByteOff + IDE64_SECTOR_SIZE > data.length) return null;

  var partitions = [];
  for (var i = 0; i < IDE64_PARTITION_ENTRIES; i++) {
    var off = dirByteOff + i * IDE64_PARTITION_ENTRY_SIZE;

    var nameBytes = [];
    for (var j = 0; j < 16; j++) nameBytes.push(data[off + j]);
    // Trim trailing CBM ($A0) / null padding for display.
    var name = '';
    for (var k = 0; k < 16; k++) {
      var c = nameBytes[k];
      if (c === 0xA0 || c === 0x00) break;
      name += String.fromCharCode(c);
    }

    var startPtr = _readIde64Pointer(data, off + 0x10);
    var endPtr = _readIde64Pointer(data, off + 0x14);
    var startValid = (startPtr.raw0 & 0x80) !== 0;
    var type = _ide64PartTypeFromEnd(endPtr.raw0);
    var empty = !startValid || type === 0x00;

    var startLba = startPtr.lba ? startPtr.addr : null;
    // End-pointer's high nibble (bits 3..0 of byte 0) carries LBA bits
    // 27..24 the same way the start pointer does; bits 7/5/4 of byte 0
    // carry the TYPE field separately, so the two never collide.
    var endLba = endPtr.lba ? endPtr.addr : null;

    var sizeSectors = null;
    if (startLba !== null && endLba !== null) {
      sizeSectors = (endLba - startLba) + 1;
      if (sizeSectors < 0) sizeSectors = 0;
    }

    partitions.push({
      index: i,
      name: name,
      nameBytes: nameBytes,
      type: type,
      typeName: IDE64_PART_TYPE_NAMES[type] || ('Type ' + type),
      empty: empty,
      startValid: startValid,
      startLba: startLba,
      endLba: endLba,
      sizeSectors: sizeSectors,
      sizeBytes: sizeSectors !== null ? sizeSectors * IDE64_SECTOR_SIZE : null,
      lba: startPtr.lba,
      hidden: (startPtr.raw0 & 0x20) !== 0,
      writeable: (startPtr.raw0 & 0x10) !== 0,
      // CFS partition-specific: pointers used by the Phase 2 directory
      // walker. Captured for non-CFS too; the renderer ignores them.
      cfsDeletedDir: _readIde64Pointer(data, off + 0x18),
      cfsRootDir:    _readIde64Pointer(data, off + 0x1C),
    });
  }

  return {
    label: boot.label,
    defaultPart: boot.defaultPart,
    partitions: partitions,
  };
}
