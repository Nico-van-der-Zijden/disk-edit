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
