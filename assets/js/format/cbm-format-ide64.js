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

// Inverse of decodeCfsTimestamp: pack a JS Date (defaulting to now) into
// the 4-byte mtime field at offsets $1C..$1F. Year is clamped to
// 1980..2043 (CFS stores year - 1980 in 6 bits).
function encodeCfsTimestamp(date) {
  if (!date) date = new Date();
  var sec = date.getSeconds() & 0x3F;
  var min = date.getMinutes() & 0x3F;
  var hour = date.getHours() & 0x1F;
  var day = date.getDate() & 0x1F;
  var month = (date.getMonth() + 1) & 0x0F;
  var year = date.getFullYear() - 1980;
  if (year < 0) year = 0;
  if (year > 63) year = 63;
  var b0 = sec | (((month >>> 2) & 0x03) << 6);
  var b1 = min | ((month & 0x03) << 6);
  var b2 = year | (((hour >>> 3) & 0x03) << 6);
  var b3 = day | ((hour & 0x07) << 5);
  return [b0, b1, b2, b3];
}

// Stamp "now" (or a supplied Date) into the entry's mtime bytes
// $1C..$1F. Centralises the timestamp-on-edit policy so writers and UI
// commit paths share one rule: any user-initiated entry mutation —
// add, rename, attr-toggle, size edit, align — touches the mtime.
// Scratch / unscratch / swap deliberately leave it alone so deletion
// state preserves the original modification time for recovery.
function cfsTouchEntryMtime(buffer, dirLba, slotIndex, date) {
  if (!buffer || slotIndex < 0 || slotIndex >= CFS_DIR_ENTRIES_PER_SECTOR) return false;
  var data = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  var off = dirLba * IDE64_SECTOR_SIZE + slotIndex * CFS_DIR_ENTRY_SIZE;
  if (off + 0x20 > data.length) return false;
  var bytes = encodeCfsTimestamp(date);
  data[off + 0x1C] = bytes[0];
  data[off + 0x1D] = bytes[1];
  data[off + 0x1E] = bytes[2];
  data[off + 0x1F] = bytes[3];
  return true;
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

// Compute the tree depth needed for a file of `fileSize` bytes. Same
// algorithm as fusecfs read_tree_search's level loop: peel 3-bit chunks
// from (m-1) until it reaches zero. Result is the *deepest* level any
// read in the file requires; intermediate offsets may need fewer levels.
//   depth 0: ≤ 64 KiB                    (1 leaf = root itself)
//   depth 1: ≤ 9 × 64 KiB ≈ 576 KiB      (root + up to 8 child leaves)
//   depth 2: ≤ 73 × 64 KiB ≈ 4.78 MiB    (and so on...)
function _cfsComputeTreeDepth(fileSize) {
  if (fileSize <= 0) return 0;
  var m = Math.floor((fileSize - 1) / 65536);
  var level = 0;
  while (m > 0) {
    m = (m - 1) >>> 3;
    level++;
  }
  return level;
}

// Encode a 4-byte LBA pointer into the bit-sliced treelink slot at
// `base` (one of 8 64-byte regions in a tree sector). Inverse of
// _cfsReadTreeLink; matches fusecfs set_treelink.
function _cfsWriteTreeLink(data, base, addr) {
  var bytes = [
    0x40 | ((addr >>> 24) & 0x0F),
    (addr >>> 16) & 0xFF,
    (addr >>> 8) & 0xFF,
    addr & 0xFF,
  ];
  for (var i = 0; i < 4; i++) {
    var bj = bytes[i];
    var entryBase = base + (3 - i) * 16;
    data[entryBase]      = (data[entryBase]      & ~0x30) | ((bj >>> 2) & 0x30);
    data[entryBase + 4]  = (data[entryBase + 4]  & ~0x30) | (bj & 0x30);
    data[entryBase + 8]  = (data[entryBase + 8]  & ~0x30) | ((bj << 2) & 0x30);
    data[entryBase + 12] = (data[entryBase + 12] & ~0x30) | ((bj << 4) & 0x30);
  }
}

// Write a 4-byte data-sector pointer at `off`, preserving bits 5..4 of
// byte 0 (those are the SLICE bits a treelink may have stuffed there).
// Without this preservation, growing a single-level tree into a multi-
// level tree would clobber the treelinks the first time a data pointer
// gets rewritten.
function _cfsWriteDataPointer(data, off, lba) {
  data[off + 0] = (data[off + 0] & 0x30) | 0x40 | ((lba >>> 24) & 0x0F);
  data[off + 1] = (lba >>> 16) & 0xFF;
  data[off + 2] = (lba >>> 8) & 0xFF;
  data[off + 3] = lba & 0xFF;
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

// ── CFS bitmap allocator (Phase 4b) ───────────────────────────────────
//
// Each partition has a chain of allocation bitmaps. Bitmap N sits at
// absolute LBA `partition_start + N * 4096` and covers the 4096 sectors
// in that chunk (including itself). Bit-order is MSB-first within each
// byte (byte 0 bit 7 = first sector in chunk, byte 0 bit 0 = 8th).
// Convention is 1 = free, 0 = used, like the rest of the CMD family.
//
// Verified against the 8 MiB ide.hdd reference image: bitmaps at LBAs
// 2, 4098, 8194, 12290 — exactly 4096 LBAs apart from partition_start
// (= 2). Each bitmap covers 4096 sectors and the bitmap LBA itself is
// always marked used (bit 7 of byte 0 = 0).

// Locate the bitmap covering a given absolute LBA.
function cfsBamLocation(partitionStart, absLba) {
  var rel = absLba - partitionStart;
  if (rel < 0) return null;
  var chunkIdx = Math.floor(rel / 4096);
  var bitmapLba = partitionStart + chunkIdx * 4096;
  var bitInChunk = rel & 0xFFF;
  return {
    bitmapLba: bitmapLba,
    byteIdx: bitInChunk >>> 3,
    bitMask: 0x80 >>> (bitInChunk & 7),
    bitInChunk: bitInChunk,
  };
}

// Count the allocated sectors in a partition by scanning every bitmap
// group's bytes and popcount-ing the cleared (= used) bits. Each bitmap
// covers 4096 sectors at partition_start + N * 4096; bits 1 = free,
// 0 = used (MSB-first). The last byte of the last group may have
// trailing bits past partitionEndLba — masked off before counting.
function cfsCountUsedBlocks(buffer, partitionStart, partitionEndLba) {
  if (!buffer) return 0;
  var data = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  var totalSectors = partitionEndLba - partitionStart + 1;
  if (totalSectors <= 0) return 0;
  function popcount(v) {
    v = v - ((v >>> 1) & 0x55);
    v = (v & 0x33) + ((v >>> 2) & 0x33);
    return (v + (v >>> 4)) & 0x0F;
  }
  var used = 0;
  var groupCount = Math.ceil(totalSectors / 4096);
  for (var g = 0; g < groupCount; g++) {
    var sectorsInGroup = Math.min(4096, totalSectors - g * 4096);
    var bmOff = (partitionStart + g * 4096) * IDE64_SECTOR_SIZE;
    if (bmOff + IDE64_SECTOR_SIZE > data.length) break;
    var fullBytes = Math.floor(sectorsInGroup / 8);
    var freeBits = 0;
    for (var b = 0; b < fullBytes; b++) freeBits += popcount(data[bmOff + b]);
    // Partial trailing byte: only count the top `sectorsInGroup % 8` bits.
    var rem = sectorsInGroup - fullBytes * 8;
    if (rem > 0) {
      var mask = (0xFF << (8 - rem)) & 0xFF;
      freeBits += popcount(data[bmOff + fullBytes] & mask);
    }
    used += sectorsInGroup - freeBits;
  }
  return used;
}

function cfsIsSectorFree(buffer, partitionStart, absLba) {
  var loc = cfsBamLocation(partitionStart, absLba);
  if (!loc) return false;
  var data = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  var off = loc.bitmapLba * IDE64_SECTOR_SIZE + loc.byteIdx;
  if (off < 0 || off >= data.length) return false;
  return (data[off] & loc.bitMask) !== 0;
}

function cfsMarkSectorUsed(buffer, partitionStart, absLba) {
  var loc = cfsBamLocation(partitionStart, absLba);
  if (!loc) return false;
  var data = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  var off = loc.bitmapLba * IDE64_SECTOR_SIZE + loc.byteIdx;
  if (off < 0 || off >= data.length) return false;
  data[off] &= ~loc.bitMask;
  return true;
}

function cfsMarkSectorFree(buffer, partitionStart, absLba) {
  var loc = cfsBamLocation(partitionStart, absLba);
  if (!loc) return false;
  var data = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  var off = loc.bitmapLba * IDE64_SECTOR_SIZE + loc.byteIdx;
  if (off < 0 || off >= data.length) return false;
  data[off] |= loc.bitMask;
  return true;
}

// Find and reserve the first free sector ≥ `searchStartLba`, return its
// absolute LBA. Returns -1 if none free up to `partitionEndLba` (inclusive).
// Caller is responsible for snapshotting the buffer for undo first.
function cfsAllocSector(buffer, partitionStart, partitionEndLba, searchStartLba) {
  var data = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  var start = (searchStartLba != null) ? Math.max(searchStartLba, partitionStart) : partitionStart;
  for (var lba = start; lba <= partitionEndLba; lba++) {
    if (cfsIsSectorFree(data, partitionStart, lba)) {
      cfsMarkSectorUsed(data, partitionStart, lba);
      return lba;
    }
  }
  return -1;
}

// ── CFS write helpers (Phase 4a, no bitmap touch) ─────────────────────
// Direct in-place edits of a directory entry's static fields. Caller is
// responsible for snapshotting the buffer for undo and re-rendering.

// Write the 16-byte filename field at $00..$0F. The new name is truncated
// or space-padded to 16 bytes. Returns true on success.
function cfsWriteDirEntryName(buffer, dirLba, slotIndex, newName) {
  if (!buffer || slotIndex < 0 || slotIndex >= CFS_DIR_ENTRIES_PER_SECTOR) return false;
  var data = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  var off = dirLba * IDE64_SECTOR_SIZE + slotIndex * CFS_DIR_ENTRY_SIZE;
  if (off + 16 > data.length) return false;
  // Pad with $A0 (PETSCII hard-space), not 0x20 — VICE and our own row
  // renderer treat 0x20 as a displayable character, so space-padded
  // names show their trailing spaces. $A0 is the recognised filename
  // terminator (same convention CBM-DOS dir entries use), so trailing
  // padding stays invisible.
  for (var i = 0; i < 16; i++) {
    data[off + i] = i < newName.length ? (newName.charCodeAt(i) & 0xFF) : 0xA0;
  }
  cfsTouchEntryMtime(buffer, dirLba, slotIndex);
  return true;
}

// Update the attribute byte at $18 — typically used to toggle R/W/X
// permission bits (bits 5/4/3). The low 3 bits are the file type and
// must be preserved across an attr-only edit, so callers pass the full
// byte (existing-byte high bits OR'd with new-perms / cleared as wanted).
function cfsWriteDirEntryAttrByte(buffer, dirLba, slotIndex, newAttrByte) {
  if (!buffer || slotIndex < 0 || slotIndex >= CFS_DIR_ENTRIES_PER_SECTOR) return false;
  var data = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  var off = dirLba * IDE64_SECTOR_SIZE + slotIndex * CFS_DIR_ENTRY_SIZE;
  if (off + 0x19 > data.length) return false;
  data[off + 0x18] = newAttrByte & 0xFF;
  cfsTouchEntryMtime(buffer, dirLba, slotIndex);
  return true;
}

// Overwrite the file-size field at offset $10..$13 of a dir entry. The
// field is a 32-bit little-endian byte count for NORMAL/DIR/LNK; REL
// files use only the low 24 bits (byte 3 carries REL-specific metadata)
// so this helper preserves that byte for REL entries. Caller is
// responsible for snapshotting the buffer for undo + re-rendering.
function cfsWriteFileSize(buffer, dirLba, slotIndex, newSize, ftype) {
  if (!buffer || slotIndex < 0 || slotIndex >= CFS_DIR_ENTRIES_PER_SECTOR) return false;
  var data = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  var off = dirLba * IDE64_SECTOR_SIZE + slotIndex * CFS_DIR_ENTRY_SIZE;
  if (off + 0x14 > data.length) return false;
  var sz = Math.max(0, Math.floor(newSize)) >>> 0;
  data[off + 0x10] = sz & 0xFF;
  data[off + 0x11] = (sz >>> 8) & 0xFF;
  data[off + 0x12] = (sz >>> 16) & 0xFF;
  if (ftype !== CFS_FTYPE.REL) {
    data[off + 0x13] = (sz >>> 24) & 0xFF;
  }
  cfsTouchEntryMtime(buffer, dirLba, slotIndex);
  return true;
}

// Walk a file's B-tree and count the data sectors it actually has
// allocated (non-zero LBA pointers, within the partition). For DIR
// entries, walks the dir chain via _cfsReadDirNext and counts sectors
// in the chain. Returns 0 for LNK / DEL / out-of-range trees. Result is
// in CFS sectors (512 B each); multiply by 512 for an upper-bound byte
// count when restoring a corrupted size field.
function cfsCountFileDataSectors(buffer, partitionStart, partitionEndLba, entry) {
  if (!buffer || !entry) return 0;
  var data = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  if (entry.ftype === CFS_FTYPE.DEL || entry.ftype === CFS_FTYPE.LNK) return 0;
  if (!entry.dataTreePtr || !entry.dataTreePtr.lba) return 0;
  var rootLba = entry.dataTreePtr.addr;
  if (rootLba <= 0 || rootLba < partitionStart || rootLba > partitionEndLba) return 0;

  if (entry.ftype === CFS_FTYPE.DIR) {
    var visited = {};
    var count = 0;
    var lba = rootLba;
    var hops = 0;
    while (lba && !visited[lba] && hops < 64) {
      visited[lba] = true;
      hops++;
      count++;
      var nextPtr = _cfsReadDirNext(data, lba * IDE64_SECTOR_SIZE);
      lba = (nextPtr.lba && nextPtr.addr > 0) ? nextPtr.addr : 0;
    }
    return count;
  }

  // File: walk B-tree counting unique data-sector pointers (skip tree
  // nodes themselves; we're measuring file content, not overhead).
  var depth = _cfsComputeTreeDepth(entry.size);
  var seenNode = {};
  var seenData = {};
  var dataCount = 0;
  function walk(nodeLba, level) {
    if (!nodeLba || nodeLba < partitionStart || nodeLba > partitionEndLba) return;
    if (seenNode[nodeLba]) return;
    seenNode[nodeLba] = true;
    var nodeBase = nodeLba * IDE64_SECTOR_SIZE;
    if (nodeBase + IDE64_SECTOR_SIZE > data.length) return;
    for (var pi = 0; pi < 128; pi++) {
      var dp = _readIde64Pointer(data, nodeBase + pi * 4);
      if (dp.lba && dp.addr > 0 && dp.addr >= partitionStart && dp.addr <= partitionEndLba) {
        if (!seenData[dp.addr]) { seenData[dp.addr] = true; dataCount++; }
      }
    }
    if (level < depth) {
      for (var s = 0; s < 8; s++) {
        var link = _cfsReadTreeLink(data, nodeBase + s * 64);
        if (link.lba && link.addr > 0) walk(link.addr, level + 1);
      }
    }
  }
  walk(rootLba, 0);
  return dataCount;
}

// Walk a file's entire B-tree, freeing every tree-node sector + every
// data sector it references in the partition bitmap. Visits each node
// once via the seen-set; collects the node's own LBA + the 128 data-
// pointer slots, and recurses into the 8 treelink slots when current
// depth-from-root is less than the file's total tree depth.
function _cfsFreeFileTree(data, partitionStart, partitionEndLba, treeLba, fileSize) {
  if (!treeLba || treeLba < partitionStart || treeLba > partitionEndLba) return;
  var depth = _cfsComputeTreeDepth(fileSize);
  var seen = {};
  function walk(nodeLba, levelFromRoot) {
    if (!nodeLba || nodeLba < partitionStart || nodeLba > partitionEndLba) return;
    if (seen[nodeLba]) return;
    seen[nodeLba] = true;
    var nodeBase = nodeLba * IDE64_SECTOR_SIZE;
    if (nodeBase + IDE64_SECTOR_SIZE > data.length) return;
    for (var ptrIdx = 0; ptrIdx < 128; ptrIdx++) {
      var dp = _readIde64Pointer(data, nodeBase + ptrIdx * 4);
      if (dp.lba && dp.addr > 0 && dp.addr >= partitionStart && dp.addr <= partitionEndLba) {
        cfsMarkSectorFree(data, partitionStart, dp.addr);
      }
    }
    if (levelFromRoot < depth) {
      for (var slot = 0; slot < 8; slot++) {
        var link = _cfsReadTreeLink(data, nodeBase + slot * 64);
        if (link.lba && link.addr > 0) {
          walk(link.addr, levelFromRoot + 1);
        }
      }
    }
    cfsMarkSectorFree(data, partitionStart, nodeLba);
  }
  walk(treeLba, 0);
}

// Recursively delete every non-empty child entry in a directory's chain,
// then free the dir chain's own sectors via bitmap. Each child is run
// through cfsDeleteFile so subdirs unwind the same way IDEDOS does:
// children get their attr byte flipped to 0x78 (DEL, not-Closed) inside
// the dir sectors *before* those sectors are freed. The bytes survive in
// place — only the bitmap bit changes — so the post-delete on-disk state
// matches IDEDOS byte-for-byte.
function _cfsDeleteDirContents(data, partitionStart, partitionEndLba, firstDirLba) {
  if (!firstDirLba || firstDirLba < partitionStart || firstDirLba > partitionEndLba) return;
  var children = readCfsDirectory(data, firstDirLba) || [];
  for (var ci = 0; ci < children.length; ci++) {
    var child = children[ci];
    if (!child || child.empty) continue;
    if (child.isSelfRef) continue;
    if (child.ftype === CFS_FTYPE.DEL) continue; // already deleted; data sectors freed earlier
    cfsDeleteFile(data, partitionStart, partitionEndLba, child);
  }
  // Free every sector in the dir chain. Re-walk via _cfsReadDirNext —
  // entries are still readable byte-wise even after children flipped
  // their attr bytes, since dir-next is bit-sliced across $14 of every
  // entry (not $18).
  var visited = {};
  var dirLba = firstDirLba;
  var hops = 0;
  while (dirLba && !visited[dirLba] && hops < 64) {
    visited[dirLba] = true;
    hops++;
    var nextPtr = _cfsReadDirNext(data, dirLba * IDE64_SECTOR_SIZE);
    cfsMarkSectorFree(data, partitionStart, dirLba);
    dirLba = (nextPtr.lba && nextPtr.addr > 0) ? nextPtr.addr : 0;
  }
}

// Delete a CFS directory entry. Dispatches on ftype:
//   DIR  — recurse into the directory, deleting each child first, then
//          free the directory's own sector chain.
//   NORMAL/REL — walk the B-tree, freeing tree-node + data sectors.
//   LNK  — no allocated data sectors (the target name lives in the entry
//          itself), so nothing to free.
//   DEL  — already deleted; refuse so callers see the no-op.
// In all cases the parent dir entry's attr byte is flipped to 0x78 —
// ftype → 0, Closed bit cleared, D/R/W/X bits preserved. Name, size,
// tree pointer, typeSuffix, mtime are all left intact so the entry stays
// recoverable via cfsUnscratchEntry. Matches IDEDOS scratch byte-for-byte.
function cfsDeleteFile(buffer, partitionStart, partitionEndLba, entry) {
  if (!buffer || !entry || entry.dirLba == null) return { ok: false, error: 'invalid entry' };
  var data = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  if (entry.ftype === CFS_FTYPE.DEL) return { ok: false, error: 'already deleted' };

  if (entry.ftype === CFS_FTYPE.DIR) {
    if (!entry.dataTreePtr || !entry.dataTreePtr.lba) {
      return { ok: false, error: 'no directory pointer' };
    }
    _cfsDeleteDirContents(data, partitionStart, partitionEndLba, entry.dataTreePtr.addr);
  } else if (entry.ftype === CFS_FTYPE.LNK) {
    // LNKs have no data sectors to free.
  } else {
    // File: walk + free the B-tree. Skip the free step when the entry
    // has no tree pointer at all — placeholder entries (cfsInsertPlaceholderEntry)
    // legitimately carry size=0 and a zero pointer, and we want
    // Scratch / Remove to still work on those instead of bailing.
    if (entry.dataTreePtr && entry.dataTreePtr.lba && entry.dataTreePtr.addr > 0) {
      _cfsFreeFileTree(data, partitionStart, partitionEndLba, entry.dataTreePtr.addr, entry.size);
    }
  }

  // Mark dir entry as deleted: ftype → 0, clear Closed bit. Other attr
  // bits preserved for recovery context.
  var entryOff = entry.dirLba * IDE64_SECTOR_SIZE + entry.index * CFS_DIR_ENTRY_SIZE;
  if (entryOff + 0x19 > data.length) return { ok: false, error: 'dir entry out of range' };
  var attr = data[entryOff + 0x18];
  attr = (attr & 0x78);
  data[entryOff + 0x18] = attr;
  return { ok: true };
}

// Hard-remove a directory entry: free its data sectors via cfsDeleteFile
// (recursive for DIRs — same cascade as scratch) and then zero the
// 32-byte slot so it becomes a true empty for the next import. Loses
// unscratch for the entry, but the bitmap stays consistent (no orphans).
// Refuses on the dir self-reference (slot 0 of the first sector — its
// bytes carry the parent/next-sector pointers and the dir's own name).
//
// CAREFUL: bits 5..4 of byte $14 are this slot's contribution to the
// bit-sliced dir-next pointer (encoded across all 16 slots' $14 — see
// _cfsReadDirNext). Zeroing those bits would corrupt the parent dir's
// next-sector pointer, sending subsequent dir-chain reads into random
// LBAs (= garbage in the listing). Preserve them.
function cfsRemoveDirEntry(buffer, partitionStart, partitionEndLba, entry, firstDirLba) {
  if (!buffer || !entry || entry.dirLba == null) return { ok: false, error: 'invalid entry' };
  if (entry.index < 0 || entry.index >= CFS_DIR_ENTRIES_PER_SECTOR) return { ok: false, error: 'invalid slot index' };
  if (entry.index === 0 && firstDirLba != null && entry.dirLba === firstDirLba) {
    return { ok: false, error: 'cannot remove dir self-reference' };
  }
  var data = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  var off = entry.dirLba * IDE64_SECTOR_SIZE + entry.index * CFS_DIR_ENTRY_SIZE;
  if (off + CFS_DIR_ENTRY_SIZE > data.length) return { ok: false, error: 'dir entry out of range' };
  if (entry.ftype !== CFS_FTYPE.DEL) {
    var delRes = cfsDeleteFile(data, partitionStart, partitionEndLba, entry);
    if (!delRes.ok) return delRes;
  }
  var dirNextBits = data[off + 0x14] & 0x30; // bits 5..4 = dir-next contribution
  for (var z = 0; z < CFS_DIR_ENTRY_SIZE; z++) data[off + z] = 0;
  data[off + 0x14] = dirNextBits;
  return { ok: true };
}

// Map the (preserved) typeSuffix on a soft-deleted entry back to the
// original ftype + Closed bit. cfsDeleteFile keeps the suffix bytes
// untouched, so this is unambiguous for every type CFS supports.
function _cfsFtypeFromSuffix(typeSuffix) {
  switch ((typeSuffix || '').toUpperCase()) {
    case 'DIR': return CFS_FTYPE.DIR;
    case 'LNK': return CFS_FTYPE.LNK;
    case 'REL': return CFS_FTYPE.REL;
    case 'PRG':
    case 'SEQ':
    case 'USR': return CFS_FTYPE.NORMAL;
    default: return -1;
  }
}

// Collect every sector the entry's data would occupy if restored. For
// files this is the B-tree node list + its data sectors; for dirs it's
// the dir sector chain. Returns null on an unwalkable tree (e.g. a tree
// pointer outside the partition).
function _cfsCollectEntrySectors(data, partitionStart, partitionEndLba, entry) {
  var sectors = [];
  if (!entry.dataTreePtr || !entry.dataTreePtr.lba) return sectors;
  var rootLba = entry.dataTreePtr.addr;
  if (rootLba <= 0 || rootLba < partitionStart || rootLba > partitionEndLba) return null;

  if (entry.ftype === CFS_FTYPE.DIR ||
      (entry.ftype === CFS_FTYPE.DEL && entry.typeSuffix === 'DIR')) {
    var visited = {};
    var lba = rootLba;
    var hops = 0;
    while (lba && !visited[lba] && hops < 64) {
      visited[lba] = true;
      hops++;
      if (lba < partitionStart || lba > partitionEndLba) return null;
      sectors.push(lba);
      var nextPtr = _cfsReadDirNext(data, lba * IDE64_SECTOR_SIZE);
      lba = (nextPtr.lba && nextPtr.addr > 0) ? nextPtr.addr : 0;
    }
    return sectors;
  }

  if (entry.ftype === CFS_FTYPE.LNK ||
      (entry.ftype === CFS_FTYPE.DEL && entry.typeSuffix === 'LNK')) {
    return sectors; // LNKs have no allocated data sectors
  }

  // File: walk B-tree gathering tree-node + data-pointer LBAs.
  var depth = _cfsComputeTreeDepth(entry.size);
  var seen = {};
  var bad = false;
  function walk(nodeLba, levelFromRoot) {
    if (bad) return;
    if (!nodeLba || nodeLba < partitionStart || nodeLba > partitionEndLba) { bad = true; return; }
    if (seen[nodeLba]) return;
    seen[nodeLba] = true;
    sectors.push(nodeLba);
    var nodeBase = nodeLba * IDE64_SECTOR_SIZE;
    if (nodeBase + IDE64_SECTOR_SIZE > data.length) { bad = true; return; }
    for (var ptrIdx = 0; ptrIdx < 128; ptrIdx++) {
      var dp = _readIde64Pointer(data, nodeBase + ptrIdx * 4);
      if (dp.lba && dp.addr > 0) {
        if (dp.addr < partitionStart || dp.addr > partitionEndLba) continue;
        sectors.push(dp.addr);
      }
    }
    if (levelFromRoot < depth) {
      for (var slot = 0; slot < 8; slot++) {
        var link = _cfsReadTreeLink(data, nodeBase + slot * 64);
        if (link.lba && link.addr > 0) walk(link.addr, levelFromRoot + 1);
      }
    }
  }
  walk(rootLba, 0);
  return bad ? null : sectors;
}

// Restore a soft-deleted entry. The entry must still have its preserved
// metadata (name, size, tree pointer, typeSuffix) — cfsDeleteFile keeps
// all of that. Unscratch:
//   1. Derive the original ftype from typeSuffix.
//   2. Collect every sector the entry's data/dir tree references.
//   3. Refuse if *any* of those sectors is currently allocated to
//      something else (its data has been overwritten); otherwise mark
//      every sector used and flip the attr byte back: original ftype
//      OR'd with the Closed bit, D/R/W/X preserved.
// When the restored entry is a directory, walk the dir chain and
// recursively unscratch every DEL child too — IDEDOS's recursive scratch
// (the pattern we replicate in cfsDeleteFile) leaves children individually
// marked DEL with their data sectors freed, so restoring the parent
// without its contents would yield an empty live directory.
// Best-effort: children whose data sectors have been reallocated stay
// marked DEL; the return value reports how many were restored vs failed.
function cfsUnscratchEntry(buffer, partitionStart, partitionEndLba, entry) {
  if (!buffer || !entry || entry.dirLba == null) return { ok: false, error: 'invalid entry' };
  if (entry.ftype !== CFS_FTYPE.DEL) return { ok: false, error: 'entry is not deleted' };
  var data = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);

  var origFtype = _cfsFtypeFromSuffix(entry.typeSuffix);
  if (origFtype < 0) return { ok: false, error: 'unrecognised typeSuffix "' + (entry.typeSuffix || '') + '"' };

  // Collect-then-validate so we don't mutate the bitmap on a half-walk.
  var sectors = _cfsCollectEntrySectors(data, partitionStart, partitionEndLba, {
    ftype: entry.ftype,
    typeSuffix: entry.typeSuffix,
    size: entry.size,
    dataTreePtr: entry.dataTreePtr,
  });
  if (sectors === null) return { ok: false, error: 'tree walk hit an out-of-range pointer' };

  // Every sector this entry would occupy must currently be free. If a
  // later allocation grabbed any of them, the data on those sectors is
  // someone else's — refuse rather than corrupt both files.
  for (var si = 0; si < sectors.length; si++) {
    if (!cfsIsSectorFree(data, partitionStart, sectors[si])) {
      return { ok: false, error: 'data sector LBA ' + sectors[si] + ' is allocated to another file; cannot recover' };
    }
  }

  // Reclaim every sector + restore the attr byte.
  for (var sj = 0; sj < sectors.length; sj++) {
    cfsMarkSectorUsed(data, partitionStart, sectors[sj]);
  }
  var entryOff = entry.dirLba * IDE64_SECTOR_SIZE + entry.index * CFS_DIR_ENTRY_SIZE;
  if (entryOff + 0x19 > data.length) return { ok: false, error: 'dir entry out of range' };
  var attr = data[entryOff + 0x18];
  attr = (attr & 0x78) | 0x80 | (origFtype & 0x07);
  data[entryOff + 0x18] = attr;

  var childrenRestored = 0;
  var childrenFailed = 0;
  // Recurse into directories: every DEL child we can recover follows the
  // same restore protocol. Sub-DIRs recurse further via the same call.
  if (origFtype === CFS_FTYPE.DIR && entry.dataTreePtr && entry.dataTreePtr.lba) {
    var children = readCfsDirectory(data, entry.dataTreePtr.addr) || [];
    for (var ci = 0; ci < children.length; ci++) {
      var child = children[ci];
      if (!child || child.empty) continue;
      if (child.isSelfRef) continue;
      if (child.ftype !== CFS_FTYPE.DEL) continue;
      var cres = cfsUnscratchEntry(data, partitionStart, partitionEndLba, child);
      if (cres.ok) {
        childrenRestored += 1 + (cres.childrenRestored || 0);
        childrenFailed += (cres.childrenFailed || 0);
      } else {
        childrenFailed += 1;
      }
    }
  }
  return {
    ok: true,
    restoredFtype: origFtype,
    sectorsReclaimed: sectors.length,
    childrenRestored: childrenRestored,
    childrenFailed: childrenFailed,
  };
}

// Find the first empty slot in a directory chain, returning
// { dirLba, slotIndex } or null if every existing dir sector is full.
// Phase 4b doesn't grow the chain — that's Phase 5 (extend_dir analogue).
function cfsFindEmptyDirSlot(buffer, firstDirLba) {
  if (!buffer || !firstDirLba) return null;
  var data = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  var visited = {};
  var dirLba = firstDirLba;
  var hops = 0;
  // Two-pass within the walk: prefer a truly-empty slot in this sector,
  // but remember the first soft-deleted slot we see across the chain so
  // we can fall back to it if no empty slot exists. Reusing a deleted
  // slot invalidates unscratch for that entry, so we only do it when
  // there's no other choice. Importers zero the 32-byte slot before
  // writing, so a deleted slot is safe to hand out.
  //
  // "Empty" tolerates bits 5..4 of byte $14 being set — those bits
  // belong to the dir-next pointer encoding, not to this slot's data,
  // and cfsRemoveDirEntry deliberately preserves them so the dir-chain
  // walker keeps working after a slot is freed.
  var fallback = null;
  while (dirLba && !visited[dirLba] && hops < 64) {
    visited[dirLba] = true;
    hops++;
    var base = dirLba * IDE64_SECTOR_SIZE;
    if (base + IDE64_SECTOR_SIZE > data.length) return null;
    for (var slot = 0; slot < CFS_DIR_ENTRIES_PER_SECTOR; slot++) {
      var eo = base + slot * CFS_DIR_ENTRY_SIZE;
      var allZero = true;
      for (var z = 0; z < CFS_DIR_ENTRY_SIZE; z++) {
        var mask = (z === 0x14) ? 0xCF : 0xFF; // ignore dir-next bits in byte $14
        if ((data[eo + z] & mask) !== 0) { allZero = false; break; }
      }
      if (allZero) return { dirLba: dirLba, slotIndex: slot };
      // Soft-deleted slot: ftype bits in $18 == 0, but the rest of the
      // entry still has data. Skip slot 0 of the first sector (it's the
      // dir's self-reference, not a file entry — its ftype is DIR=3 so
      // this guard is belt-and-braces).
      if (fallback === null && !(dirLba === firstDirLba && slot === 0)) {
        if ((data[eo + 0x18] & CFS_FTYPE_MASK) === CFS_FTYPE.DEL) {
          fallback = { dirLba: dirLba, slotIndex: slot };
        }
      }
    }
    var nextPtr = _cfsReadDirNext(data, base);
    dirLba = (nextPtr.lba && nextPtr.addr > 0) ? nextPtr.addr : 0;
  }
  return fallback;
}

// Maximum tree depth this writer supports. Each depth covers ≈ 8× the
// previous; depth 5 = ≈ 38 GiB which is way past anything sane to host
// in a single CFS file. Reads handle arbitrary depths already (the C
// algorithm doesn't care); the cap here just prevents pathological
// allocations on bad input.
var CFS_MAX_IMPORT_DEPTH = 5;

// Returns the leaf-level tree sector for `byteOffset` within a tree
// rooted at `rootLba`. Walks down `depth` levels (the value computed
// from the file's total size), allocating + zeroing intermediate
// sectors when their treelink slot isn't yet populated. Every newly-
// allocated child is appended to `allocated` so the caller can roll
// back. Returns -1 if any allocation fails.
//
// At offset 0 (m=0) the localLevel computed below is 0 regardless of
// the file's depth → returns rootLba unchanged. This is correct because
// every CFS tree sector serves simultaneously as the *leaf* for the
// 64 KiB chunk that starts at its own walk-base AND as the *internal
// node* for deeper offsets via its treelinks.
function _cfsEnsureLeafForOffset(buffer, rootLba, byteOffset, partitionStart, partitionEndLba, allocated, searchHint) {
  var data = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  var m = Math.floor(byteOffset / 65536);
  var m2 = 0;
  var localLevel = 0;
  var mWork = m;
  while (mWork > 0) {
    mWork--;
    m2 = (m2 << 1) | (mWork & 1); mWork = mWork >>> 1;
    m2 = (m2 << 1) | (mWork & 1); mWork = mWork >>> 1;
    m2 = (m2 << 1) | (mWork & 1); mWork = mWork >>> 1;
    localLevel++;
  }

  var itt = rootLba;
  for (var lvl = 0; lvl < localLevel; lvl++) {
    var slot = m2 & 7;
    m2 = m2 >>> 3;
    var base = itt * IDE64_SECTOR_SIZE + slot * 64;
    var link = _cfsReadTreeLink(data, base);
    if (link.lba && link.addr > 0) {
      itt = link.addr;
    } else {
      var childLba = cfsAllocSector(buffer, partitionStart, partitionEndLba, searchHint || (itt + 1));
      if (childLba < 0) return -1;
      allocated.push(childLba);
      // Zero the new sector so subsequent data-pointer writes start
      // from clean bits 5..4 (any treelinks written by this growth
      // step will set them explicitly).
      var cbase = childLba * IDE64_SECTOR_SIZE;
      for (var z = 0; z < IDE64_SECTOR_SIZE; z++) data[cbase + z] = 0;
      _cfsWriteTreeLink(data, base, childLba);
      itt = childLba;
    }
  }
  return itt;
}

// Import a file of arbitrary size up to ~38 GiB (depth 5 cap). Builds
// the B-tree of arbitrary depth: walks every 512-byte chunk of payload,
// finds (or grows) the leaf sector for that chunk's offset, then writes
// a data-sector pointer there. Treelinks are encoded via bit-slicing
// across bits 5..4 of byte 0 of 16 data pointers in each 64-byte sub-
// region — see _cfsWriteTreeLink. The root sector serves simultaneously
// as both the leaf for offsets 0..64 KiB-1 AND the level-N internal
// node for higher offsets; the two encodings share bytes without
// collision because data-pointer reads ignore bits 5..4 and treelinks
// only use them.
//
// Rolls back every bitmap allocation on any failure.
function cfsImportFile(buffer, partitionStart, partitionEndLba, firstDirLba, name, payload, opts) {
  opts = opts || {};
  if (!buffer || !firstDirLba) return { ok: false, error: 'invalid args' };
  if (!payload || payload.length === 0) return { ok: false, error: 'empty payload' };
  var depth = _cfsComputeTreeDepth(payload.length);
  if (depth > CFS_MAX_IMPORT_DEPTH) {
    return { ok: false, error: 'file size requires tree depth > ' + CFS_MAX_IMPORT_DEPTH };
  }

  var slot = cfsFindEmptyDirSlot(buffer, firstDirLba);
  if (!slot) return { ok: false, error: 'no empty directory slot' };

  var sectorsNeeded = Math.ceil(payload.length / IDE64_SECTOR_SIZE);
  var allocated = [];
  function rollback() {
    for (var ri = 0; ri < allocated.length; ri++) {
      cfsMarkSectorFree(buffer, partitionStart, allocated[ri]);
    }
  }

  var treeLba = cfsAllocSector(buffer, partitionStart, partitionEndLba, firstDirLba + 1);
  if (treeLba < 0) return { ok: false, error: 'no free sector for tree root' };
  allocated.push(treeLba);

  var data = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  // Zero the root so we start from clean state (bits 5..4 of all
  // pointer slots == 0, no stale treelinks).
  var treeBase = treeLba * IDE64_SECTOR_SIZE;
  for (var t = 0; t < IDE64_SECTOR_SIZE; t++) data[treeBase + t] = 0;

  var dataLbas = [];
  var searchFrom = treeLba + 1;
  for (var si = 0; si < sectorsNeeded; si++) {
    var offsetInFile = si * IDE64_SECTOR_SIZE;

    var leafLba = _cfsEnsureLeafForOffset(buffer, treeLba, offsetInFile, partitionStart, partitionEndLba, allocated, searchFrom);
    if (leafLba < 0) { rollback(); return { ok: false, error: 'no free sectors for tree growth' }; }
    if (leafLba >= searchFrom) searchFrom = leafLba + 1;

    var dlba = cfsAllocSector(buffer, partitionStart, partitionEndLba, searchFrom);
    if (dlba < 0) { rollback(); return { ok: false, error: 'no free data sector (sector ' + si + ' of ' + sectorsNeeded + ')' }; }
    allocated.push(dlba);
    dataLbas.push(dlba);
    searchFrom = dlba + 1;

    // Write 512 bytes of payload (last sector zero-padded)
    var dbase = dlba * IDE64_SECTOR_SIZE;
    for (var byteI = 0; byteI < IDE64_SECTOR_SIZE; byteI++) {
      var pi = offsetInFile + byteI;
      data[dbase + byteI] = pi < payload.length ? payload[pi] : 0;
    }

    // Write data pointer in leaf at index (offset/512) % 128
    var ptrIdxInLeaf = (offsetInFile >>> 9) & 0x7F;
    _cfsWriteDataPointer(data, leafLba * IDE64_SECTOR_SIZE + ptrIdxInLeaf * 4, dlba);
  }

  // Directory entry — preserve bits 5..4 of byte $14 across the zero
  // step (they belong to the dir-next pointer encoding shared across
  // all 16 slots, not to this entry).
  var eo = slot.dirLba * IDE64_SECTOR_SIZE + slot.slotIndex * CFS_DIR_ENTRY_SIZE;
  var dirNextBits = data[eo + 0x14] & 0x30;
  for (var z2 = 0; z2 < CFS_DIR_ENTRY_SIZE; z2++) data[eo + z2] = 0;
  // Pad short names with $A0 (CBM/VICE-recognised terminator), not
  // 0x20 — see cfsWriteDirEntryName for the rationale.
  for (var n = 0; n < 16; n++) {
    data[eo + n] = n < name.length ? (name.charCodeAt(n) & 0xFF) : 0xA0;
  }
  data[eo + 0x10] = payload.length & 0xFF;
  data[eo + 0x11] = (payload.length >>> 8) & 0xFF;
  data[eo + 0x12] = (payload.length >>> 16) & 0xFF;
  data[eo + 0x13] = (payload.length >>> 24) & 0xFF;
  data[eo + 0x14] = 0xC0 | dirNextBits | ((treeLba >>> 24) & 0x0F);
  data[eo + 0x15] = (treeLba >>> 16) & 0xFF;
  data[eo + 0x16] = (treeLba >>> 8) & 0xFF;
  data[eo + 0x17] = treeLba & 0xFF;
  var ftype = (opts.ftype != null) ? opts.ftype : CFS_FTYPE.NORMAL;
  data[eo + 0x18] = 0xF8 | (ftype & 0x07);
  var suf = opts.typeSuffix || 'PRG';
  for (var s = 0; s < 3; s++) {
    data[eo + 0x19 + s] = s < suf.length ? (suf.charCodeAt(s) & 0xFF) : 0x20;
  }
  cfsTouchEntryMtime(buffer, slot.dirLba, slot.slotIndex);

  return {
    ok: true,
    dirLba: slot.dirLba,
    slotIndex: slot.slotIndex,
    treeLba: treeLba,
    dataLbas: dataLbas,
    depth: depth,
  };
}

// Single-sector wrapper kept for back-compat with Phase 4b callers/tests.
function cfsImportSingleSectorFile(buffer, partitionStart, partitionEndLba, firstDirLba, name, payload, opts) {
  return cfsImportFile(buffer, partitionStart, partitionEndLba, firstDirLba, name, payload, opts);
}

// Swap the 32-byte contents of two CFS directory slots while keeping
// each slot's bits 5..4 of byte $14 untouched — those bits encode the
// dir-next pointer (bit-sliced across all 16 slots), so swapping them
// would relocate the next-sector pointer. Used by the insert-at-
// selection flow (cfsInsertPlaceholderEntry → shift backward).
function cfsSwapDirSlots(buffer, slotA, slotB) {
  if (!buffer || !slotA || !slotB) return false;
  if (slotA.dirLba === slotB.dirLba && slotA.slotIndex === slotB.slotIndex) return true;
  var data = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  var ao = slotA.dirLba * IDE64_SECTOR_SIZE + slotA.slotIndex * CFS_DIR_ENTRY_SIZE;
  var bo = slotB.dirLba * IDE64_SECTOR_SIZE + slotB.slotIndex * CFS_DIR_ENTRY_SIZE;
  if (ao + CFS_DIR_ENTRY_SIZE > data.length || bo + CFS_DIR_ENTRY_SIZE > data.length) return false;
  for (var z = 0; z < CFS_DIR_ENTRY_SIZE; z++) {
    if (z === 0x14) {
      var aBits = data[ao + z] & 0x30, bBits = data[bo + z] & 0x30;
      var aRest = data[ao + z] & 0xCF, bRest = data[bo + z] & 0xCF;
      data[ao + z] = aBits | bRest;
      data[bo + z] = bBits | aRest;
    } else {
      var tmp = data[ao + z];
      data[ao + z] = data[bo + z];
      data[bo + z] = tmp;
    }
  }
  return true;
}

// Collect every (dirLba, slotIndex) pair in a directory's sector chain,
// in dir-chain order. Skips slot 0 of the first sector — that's the dir
// self-reference and should never be swapped. Caller uses the resulting
// flat list to find positions for the insert-at-selection shift.
function cfsCollectDirSlots(buffer, firstDirLba) {
  if (!buffer || !firstDirLba) return [];
  var data = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  var slots = [];
  var visited = {};
  var dirLba = firstDirLba;
  var hops = 0;
  while (dirLba && !visited[dirLba] && hops < 64) {
    visited[dirLba] = true;
    hops++;
    var base = dirLba * IDE64_SECTOR_SIZE;
    if (base + IDE64_SECTOR_SIZE > data.length) break;
    var startSlot = (dirLba === firstDirLba) ? 1 : 0; // skip self-ref in first sector
    for (var i = startSlot; i < CFS_DIR_ENTRIES_PER_SECTOR; i++) {
      slots.push({ dirLba: dirLba, slotIndex: i });
    }
    var nextPtr = _cfsReadDirNext(data, base);
    dirLba = (nextPtr.lba && nextPtr.addr > 0) ? nextPtr.addr : 0;
  }
  return slots;
}

// Insert a separator dir entry — like cfsInsertPlaceholderEntry but the
// 16-byte name slot carries a separator byte pattern (typically CBM
// reversed-PETSCII glyphs) and the attr byte at $18 is `0xF8` (Closed +
// D + R + W + X + ftype DEL). The Closed bit distinguishes a separator
// from a scratched entry — our renderer skips scratched DEL entries
// (Closed=0) when Show Deleted is off, but separators with Closed=1
// stay visible. D/R/W/X are all set so VICE's CFS listing renders the
// row without a "<" read-only marker; just the Closed bit alone
// (matching the CBM-DOS 0x80 trick) makes VICE flag the row as
// unwriteable in CFS view.
function cfsInsertSeparator(buffer, parentDirLba, patternBytes) {
  if (!buffer || !parentDirLba) return { ok: false, error: 'invalid arguments' };
  var data = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  var slot = cfsFindEmptyDirSlot(buffer, parentDirLba);
  if (!slot) return { ok: false, error: 'no empty directory slot' };
  var eo = slot.dirLba * IDE64_SECTOR_SIZE + slot.slotIndex * CFS_DIR_ENTRY_SIZE;
  if (eo + CFS_DIR_ENTRY_SIZE > data.length) return { ok: false, error: 'dir entry out of range' };

  var dirNextBits = data[eo + 0x14] & 0x30;
  for (var z = 0; z < CFS_DIR_ENTRY_SIZE; z++) data[eo + z] = 0;

  // Pattern bytes fill the 16-byte name field. Two pattern shapes are
  // supported, mirroring the CBM-DOS separators format: a single repeat
  // byte (opts.byte path elsewhere) or an array of explicit bytes.
  var pat = patternBytes || [];
  var pLen = pat.length;
  for (var i = 0; i < 16; i++) {
    data[eo + i] = i < pLen ? (pat[i] & 0xFF) : 0xA0;
  }
  // No size, no tree pointer (just dir-next bits preserved in $14).
  data[eo + 0x14] = dirNextBits;
  data[eo + 0x18] = 0xF8; // Closed + D + R + W + X + ftype DEL
  // typeSuffix "DEL" — VICE's CFS listing reads the three-byte suffix
  // at $19..$1B for the type column. Leaving it zero makes VICE print
  // nothing (only the < / read-only marker shows, even with W set).
  data[eo + 0x19] = 0x44; // 'D'
  data[eo + 0x1A] = 0x45; // 'E'
  data[eo + 0x1B] = 0x4C; // 'L'
  cfsTouchEntryMtime(buffer, slot.dirLba, slot.slotIndex);

  return { ok: true, dirLba: slot.dirLba, slotIndex: slot.slotIndex };
}

// Insert a placeholder dir entry — zero size, no tree pointer, no data
// sectors touched. The CBM-DOS "Insert File" analogue: lets you reserve
// a slot in the directory listing with a chosen name and type without
// committing actual content.
//
// Allocates nothing in the bitmap. The tree-pointer field at $14..$17
// stays clear of the VALID + LBA flags (byte $14 bits 7..6 = 0) so our
// reader returns dataTreePtr.lba === false; downstream code treats that
// the same way it treats a real null pointer (no file content to read,
// scratch/remove skip the bitmap-free step, unscratch reclaims zero
// sectors). Bits 5..4 of byte $14 are preserved across the zero step
// because they belong to the dir-next pointer encoding shared across
// all 16 slots — same rule cfsRemoveDirEntry / cfsImportFile follow.
//
// Returns { ok, dirLba, slotIndex, error? }. opts.ftype defaults to
// NORMAL (PRG-style); typeSuffix to "PRG".
function cfsInsertPlaceholderEntry(buffer, parentDirLba, name, opts) {
  if (!buffer || !parentDirLba) return { ok: false, error: 'invalid arguments' };
  opts = opts || {};
  var data = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  var slot = cfsFindEmptyDirSlot(buffer, parentDirLba);
  if (!slot) return { ok: false, error: 'no empty directory slot' };
  var eo = slot.dirLba * IDE64_SECTOR_SIZE + slot.slotIndex * CFS_DIR_ENTRY_SIZE;
  if (eo + CFS_DIR_ENTRY_SIZE > data.length) return { ok: false, error: 'dir entry out of range' };

  var dirNextBits = data[eo + 0x14] & 0x30;
  for (var z = 0; z < CFS_DIR_ENTRY_SIZE; z++) data[eo + z] = 0;

  var nameStr = String(name || '');
  for (var n = 0; n < 16; n++) {
    data[eo + n] = n < nameStr.length ? (nameStr.charCodeAt(n) & 0xFF) : 0xA0;
  }
  // size left at 0 ($10..$13 already zeroed)
  // tree pointer: no VALID / LBA flag, dir-next bits preserved
  data[eo + 0x14] = dirNextBits;
  // $18 attr: Closed + D|R|W|X + ftype (same pattern as cfsImportFile)
  var ftype = (opts.ftype != null) ? opts.ftype : CFS_FTYPE.NORMAL;
  data[eo + 0x18] = 0xF8 | (ftype & 0x07);
  var suf = opts.typeSuffix || 'PRG';
  for (var s = 0; s < 3; s++) {
    data[eo + 0x19 + s] = s < suf.length ? (suf.charCodeAt(s) & 0xFF) : 0x20;
  }
  cfsTouchEntryMtime(buffer, slot.dirLba, slot.slotIndex);

  return { ok: true, dirLba: slot.dirLba, slotIndex: slot.slotIndex };
}

// Initialize a fresh CFS partition's storage: write 0xFF-filled bitmaps
// every 4096 LBAs from partition_start, mark the bitmaps themselves
// used, mark sectors start+1, +2, +3 used (reserved / deldir / rootdir),
// initialise the root dir sector (self-ref + %DELETED FILES% entry) and
// zero the deldir sector. Mirrors the layout we see in ide.hdd:
//   start+0 = BAM_0, start+1 = unused, start+2 = deldir, start+3 = rootdir
// Returns { ok, rootDirLba, deletedDirLba, error? }.
function cfsInitPartitionStorage(buffer, partitionStart, partitionEndLba, partitionName) {
  if (!buffer) return { ok: false, error: 'invalid buffer' };
  var data = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  var deldirLba = partitionStart + 2;
  var rootdirLba = partitionStart + 3;
  if (rootdirLba > partitionEndLba) return { ok: false, error: 'partition too small for system area' };

  // Fill every bitmap sector with 0xFF (all sectors free) before marking used ones.
  var bitmapCount = 0;
  for (var bm = 0; bm <= (partitionEndLba - partitionStart); bm += 4096) {
    var bitmapLba = partitionStart + bm;
    var bo = bitmapLba * IDE64_SECTOR_SIZE;
    if (bo + IDE64_SECTOR_SIZE > data.length) return { ok: false, error: 'partition extends past buffer' };
    for (var i = 0; i < IDE64_SECTOR_SIZE; i++) data[bo + i] = 0xFF;
    bitmapCount++;
  }

  // Mark each bitmap sector as used (so the partition can't accidentally
  // overwrite its own allocation tables).
  for (var bm2 = 0; bm2 < bitmapCount; bm2++) {
    cfsMarkSectorUsed(buffer, partitionStart, partitionStart + bm2 * 4096);
  }

  // Mark anything past partitionEndLba in the final bitmap as used so
  // the allocator never returns an LBA outside the partition.
  var lastBmStart = partitionStart + (bitmapCount - 1) * 4096;
  var coverageEnd = lastBmStart + 4096 - 1;
  for (var pastLba = partitionEndLba + 1; pastLba <= coverageEnd; pastLba++) {
    cfsMarkSectorUsed(buffer, partitionStart, pastLba);
  }

  // Mark the three reserved system sectors used.
  cfsMarkSectorUsed(buffer, partitionStart, partitionStart + 1);
  cfsMarkSectorUsed(buffer, partitionStart, deldirLba);
  cfsMarkSectorUsed(buffer, partitionStart, rootdirLba);

  // Root dir sector: self-ref at slot 0, %DELETED FILES% at slot 1.
  var rootBase = rootdirLba * IDE64_SECTOR_SIZE;
  for (var rz = 0; rz < IDE64_SECTOR_SIZE; rz++) data[rootBase + rz] = 0;
  var pname = partitionName || 'PARTITION';
  // $A0-pad (CBM/VICE-recognised terminator) — same reason as
  // cfsWriteDirEntryName. 0x20 here would show as trailing spaces in
  // the CFS dir header when entering the partition.
  for (var rn = 0; rn < 16; rn++) {
    data[rootBase + rn] = rn < pname.length ? (pname.charCodeAt(rn) & 0xFF) : 0xA0;
  }
  // Self ptr at $10..$13
  data[rootBase + 0x10] = 0x40 | ((rootdirLba >>> 24) & 0x0F);
  data[rootBase + 0x11] = (rootdirLba >>> 16) & 0xFF;
  data[rootBase + 0x12] = (rootdirLba >>> 8) & 0xFF;
  data[rootBase + 0x13] = rootdirLba & 0xFF;
  // Parent ptr at $14..$17 (root has no parent, points to self)
  data[rootBase + 0x14] = 0x40 | ((rootdirLba >>> 24) & 0x0F);
  data[rootBase + 0x15] = (rootdirLba >>> 16) & 0xFF;
  data[rootBase + 0x16] = (rootdirLba >>> 8) & 0xFF;
  data[rootBase + 0x17] = rootdirLba & 0xFF;
  // Attr + "DIR" suffix
  data[rootBase + 0x18] = 0x7B;
  data[rootBase + 0x19] = 0x44; data[rootBase + 0x1A] = 0x49; data[rootBase + 0x1B] = 0x52;

  // %DELETED FILES% entry at slot 1 (mirrors what ide.hdd has)
  var dfBase = rootBase + CFS_DIR_ENTRY_SIZE;
  var dfName = '%DELETED  FILES%';
  for (var dfn = 0; dfn < 16; dfn++) data[dfBase + dfn] = dfName.charCodeAt(dfn) & 0xFF;
  // $14..$17 pointer to deldir
  data[dfBase + 0x14] = 0xC0 | ((deldirLba >>> 24) & 0x0F);
  data[dfBase + 0x15] = (deldirLba >>> 16) & 0xFF;
  data[dfBase + 0x16] = (deldirLba >>> 8) & 0xFF;
  data[dfBase + 0x17] = deldirLba & 0xFF;
  data[dfBase + 0x18] = 0xAB; // matches the attr byte ide.hdd uses for this special entry
  data[dfBase + 0x19] = 0x44; data[dfBase + 0x1A] = 0x49; data[dfBase + 0x1B] = 0x52;

  // Deleted-dir sector: zero (no deleted files yet).
  var delBase = deldirLba * IDE64_SECTOR_SIZE;
  for (var dz = 0; dz < IDE64_SECTOR_SIZE; dz++) data[delBase + dz] = 0;

  return { ok: true, rootDirLba: rootdirLba, deletedDirLba: deldirLba };
}

// Read the LBA of the backup partition directory from boot $1C..$1F.
// IDEDOS maintains an exact mirror of the primary partition dir at this
// LBA (the last sector of the image on disks we've inspected). Returns
// null if the pointer's LBA flag is clear or the target falls outside
// the buffer.
function _cfsReadBackupPartDirLba(data) {
  var p = _readIde64Pointer(data, 0x1C);
  if (!p.lba || p.addr === null || p.addr === 0) return null;
  if (p.addr === 1) return null; // backup = primary; skip mirroring
  var off = p.addr * IDE64_SECTOR_SIZE;
  if (off + IDE64_SECTOR_SIZE > data.length) return null;
  return p.addr;
}

// Copy the entire 512-byte primary partition directory at LBA 1 to the
// backup LBA referenced by boot $1C. Called from every helper that
// mutates the partition table so the backup never drifts.
function _cfsMirrorPartitionTableToBackup(data) {
  var backupLba = _cfsReadBackupPartDirLba(data);
  if (backupLba === null) return;
  var srcBase = 1 * IDE64_SECTOR_SIZE;
  var dstBase = backupLba * IDE64_SECTOR_SIZE;
  for (var i = 0; i < IDE64_SECTOR_SIZE; i++) data[dstBase + i] = data[srcBase + i];
}

// Increment boot-sector byte $03 (wraps at 256). Empirically observed
// to bump on every partition scratch in IDEDOS — looks like a partition-
// table generation/dirty stamp. Whether IDEDOS also bumps it on add /
// rename / attr changes is unverified, so callers in those paths leave
// it alone; only scratch + restore touch it.
function _cfsBumpPartTableGeneration(data) {
  data[0x03] = (data[0x03] + 1) & 0xFF;
}

// Soft-delete a partition table entry: clear the VALID bit (bit 7 of
// the start-pointer byte 0) and mirror the change to the backup
// partition directory. Name, type, start/end LBAs, delDir, rootDir, and
// HIDDEN/WRITEABLE flags are all preserved so cfsRestorePartition can
// flip the entry live again. The partition's data sectors stay
// allocated (the per-partition bitmap, root dir, file contents) — only
// the entry's "valid" gate changes. Matches IDEDOS scratch byte-for-
// byte (also bumps boot $03).
function cfsSoftDeletePartition(buffer, slotIdx) {
  if (slotIdx < 0 || slotIdx >= IDE64_PARTITION_ENTRIES) return { ok: false, error: 'invalid slot index' };
  var data = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  var eo = 1 * IDE64_SECTOR_SIZE + slotIdx * IDE64_PARTITION_ENTRY_SIZE;
  if (eo + 0x11 > data.length) return { ok: false, error: 'partition table out of range' };
  if ((data[eo + 0x10] & 0x80) === 0) return { ok: false, error: 'partition is already deleted' };
  data[eo + 0x10] &= ~0x80;
  _cfsMirrorPartitionTableToBackup(data);
  _cfsBumpPartTableGeneration(data);
  return { ok: true };
}

// Inverse of cfsSoftDeletePartition: set VALID, mirror to backup, bump
// the generation counter. Refuses if the entry doesn't have type bits +
// pointers we'd expect (e.g. a fully-zeroed slot from the older
// cfsRemovePartitionEntry path — that path destroyed the metadata).
function cfsRestorePartition(buffer, slotIdx) {
  if (slotIdx < 0 || slotIdx >= IDE64_PARTITION_ENTRIES) return { ok: false, error: 'invalid slot index' };
  var data = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  var eo = 1 * IDE64_SECTOR_SIZE + slotIdx * IDE64_PARTITION_ENTRY_SIZE;
  if (eo + IDE64_PARTITION_ENTRY_SIZE > data.length) return { ok: false, error: 'partition table out of range' };
  if ((data[eo + 0x10] & 0x80) !== 0) return { ok: false, error: 'partition is not deleted' };
  // Sanity: end pointer must carry a non-zero type (the entry is meaningful).
  var endB0 = data[eo + 0x14];
  if ((endB0 & 0xB0) === 0) return { ok: false, error: 'partition entry has no type bits; cannot restore' };
  data[eo + 0x10] |= 0x80;
  _cfsMirrorPartitionTableToBackup(data);
  _cfsBumpPartTableGeneration(data);
  return { ok: true };
}

// Zero the partition-table entry at `slotIdx` (hard delete — loses the
// metadata IDEDOS-style soft-delete preserves). Kept for the "Wipe Slot"
// path; callers who want IDEDOS-compatible scratch use
// cfsSoftDeletePartition instead. Mirrors the cleared entry to the
// backup partition directory.
// Returns { ok, error? }.
function cfsRemovePartitionEntry(buffer, slotIdx) {
  if (slotIdx < 0 || slotIdx >= IDE64_PARTITION_ENTRIES) return { ok: false, error: 'invalid slot index' };
  var data = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  var eo = 1 * IDE64_SECTOR_SIZE + slotIdx * IDE64_PARTITION_ENTRY_SIZE;
  if (eo + IDE64_PARTITION_ENTRY_SIZE > data.length) return { ok: false, error: 'partition table out of range' };
  for (var z = 0; z < IDE64_PARTITION_ENTRY_SIZE; z++) data[eo + z] = 0;
  _cfsMirrorPartitionTableToBackup(data);
  return { ok: true };
}

// Set the disk's default partition slot index. Writes byte $01 of the
// boot sector (LBA 0) — IDEDOS reads this on mount to pick which
// partition to auto-select. Returns { ok, error? }.
function cfsSetDefaultPartition(buffer, slotIdx) {
  if (slotIdx < 0 || slotIdx >= IDE64_PARTITION_ENTRIES) return { ok: false, error: 'invalid slot index' };
  var data = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  if (data.length < 2) return { ok: false, error: 'buffer too small' };
  data[0x01] = slotIdx & 0xFF;
  return { ok: true };
}

// Update the HIDDEN / WRITEABLE bits in the start-pointer byte of the
// partition entry at `slotIdx`. The other bits (VALID, LBA, low-nibble
// LBA address bits) are preserved so the entry stays usable.
// Returns { ok, error? }.
function cfsWritePartitionFlags(buffer, slotIdx, hidden, writeable) {
  if (slotIdx < 0 || slotIdx >= IDE64_PARTITION_ENTRIES) return { ok: false, error: 'invalid slot index' };
  var data = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  var eo = 1 * IDE64_SECTOR_SIZE + slotIdx * IDE64_PARTITION_ENTRY_SIZE;
  if (eo + 0x11 > data.length) return { ok: false, error: 'partition table out of range' };
  var startB0 = data[eo + 0x10];
  startB0 &= ~0x30; // clear bits 5 (HIDDEN) and 4 (WRITEABLE)
  if (hidden) startB0 |= 0x20;
  if (writeable) startB0 |= 0x10;
  data[eo + 0x10] = startB0;
  _cfsMirrorPartitionTableToBackup(data);
  return { ok: true };
}

// Update just the 16-byte name field of a partition table entry. Used
// by the Rename Partition action. Returns { ok, error? }.
function cfsRenamePartition(buffer, slotIdx, newName) {
  if (slotIdx < 0 || slotIdx >= IDE64_PARTITION_ENTRIES) return { ok: false, error: 'invalid slot index' };
  var data = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  var eo = 1 * IDE64_SECTOR_SIZE + slotIdx * IDE64_PARTITION_ENTRY_SIZE;
  if (eo + 16 > data.length) return { ok: false, error: 'partition table out of range' };
  for (var i = 0; i < 16; i++) {
    data[eo + i] = i < newName.length ? (newName.charCodeAt(i) & 0xFF) : 0xA0;
  }
  _cfsMirrorPartitionTableToBackup(data);
  return { ok: true };
}

// Write a partition entry at slot `slotIdx` in the partition directory
// (LBA 1). Pointer bytes follow the conventions seen in ide.hdd:
//   $10..$13 start ptr: VALID|LBA|WRITEABLE (0xD0 high nibble)
//   $14..$17 end ptr:   LBA|TYPE-bit-0 (CFS = bit 4) → byte0 0x50
//   $18..$1B deldir:    LBA flag only (0x40)
//   $1C..$1F rootdir:   LBA flag only (0x40)
// IDEDOS creates partitions with WRITEABLE set by default (verified
// against ide.hdd: slot 0 start-ptr.b0 = 0xD0). Users can drop the flag
// later via the Partition Attributes dialog if they want a read-only
// partition.
function cfsAddPartitionToTable(buffer, slotIdx, partitionName, startLba, endLba, rootDirLba, deldirLba, type) {
  if (slotIdx < 0 || slotIdx >= IDE64_PARTITION_ENTRIES) return { ok: false, error: 'invalid slot index' };
  var data = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  var partTableLba = 1; // CFS partition directory is at LBA 1 by convention
  var eo = partTableLba * IDE64_SECTOR_SIZE + slotIdx * IDE64_PARTITION_ENTRY_SIZE;
  if (eo + IDE64_PARTITION_ENTRY_SIZE > data.length) return { ok: false, error: 'partition table out of range' };
  for (var z = 0; z < IDE64_PARTITION_ENTRY_SIZE; z++) data[eo + z] = 0;

  // Name (16 B, $A0-padded — same terminator convention as dir-entry
  // names; keeps VICE from showing trailing spaces on short names)
  for (var n = 0; n < 16; n++) {
    data[eo + n] = n < partitionName.length ? (partitionName.charCodeAt(n) & 0xFF) : 0xA0;
  }
  // Start pointer (VALID|LBA|WRITEABLE)
  data[eo + 0x10] = 0xD0 | ((startLba >>> 24) & 0x0F);
  data[eo + 0x11] = (startLba >>> 16) & 0xFF;
  data[eo + 0x12] = (startLba >>> 8) & 0xFF;
  data[eo + 0x13] = startLba & 0xFF;
  // End pointer with TYPE encoded in bits 7/5/4 of byte 0 (same scheme
  // as the parser uses). CFS = type 1 (bit 4), GEOS = type 2 (bit 5).
  var t = type != null ? type : 0x01;
  var typeBits = ((t & 0x01) ? 0x10 : 0) | ((t & 0x02) ? 0x20 : 0) | ((t & 0x04) ? 0x80 : 0);
  data[eo + 0x14] = 0x40 | typeBits | ((endLba >>> 24) & 0x0F);
  data[eo + 0x15] = (endLba >>> 16) & 0xFF;
  data[eo + 0x16] = (endLba >>> 8) & 0xFF;
  data[eo + 0x17] = endLba & 0xFF;
  // Deleted-dir pointer
  data[eo + 0x18] = 0x40 | ((deldirLba >>> 24) & 0x0F);
  data[eo + 0x19] = (deldirLba >>> 16) & 0xFF;
  data[eo + 0x1A] = (deldirLba >>> 8) & 0xFF;
  data[eo + 0x1B] = deldirLba & 0xFF;
  // Root-dir pointer
  data[eo + 0x1C] = 0x40 | ((rootDirLba >>> 24) & 0x0F);
  data[eo + 0x1D] = (rootDirLba >>> 16) & 0xFF;
  data[eo + 0x1E] = (rootDirLba >>> 8) & 0xFF;
  data[eo + 0x1F] = rootDirLba & 0xFF;
  _cfsMirrorPartitionTableToBackup(data);
  return { ok: true };
}

// Build a fresh, empty IDE64 .hdd of the given size in MiB, with one
// CFS partition spanning the whole image (minus boot sector + partition
// table). Returns an ArrayBuffer.
function createEmptyHdd(sizeMib, opts) {
  opts = opts || {};
  var label = opts.label || 'IDE64 HDD';
  var partitionName = opts.partitionName || 'PARTITION';
  var totalLbas = Math.floor(sizeMib * 1024 * 1024 / IDE64_SECTOR_SIZE);
  if (totalLbas < 10) return null;
  var buf = new ArrayBuffer(totalLbas * IDE64_SECTOR_SIZE);
  var d = new Uint8Array(buf);

  // Boot sector at LBA 0
  d[0x01] = 0; // default partition
  for (var mi = 0; mi < IDE64_MAGIC_STRING.length; mi++) {
    d[IDE64_MAGIC_OFFSET + mi] = IDE64_MAGIC_STRING.charCodeAt(mi);
  }
  // @partition-directory pointer → LBA 1 (LBA flag only). The backup
  // pointer at $1C goes to the last sector of the image — IDEDOS keeps
  // an exact mirror of the partition directory there so a corrupt or
  // unreadable LBA 1 can be recovered. cfsAddPartitionToTable + every
  // partition-table mutator mirrors writes to that LBA automatically.
  d[0x18] = 0x40; d[0x19] = 0x00; d[0x1A] = 0x00; d[0x1B] = 0x01;
  var backupLba = totalLbas - 1;
  d[0x1C] = 0x40 | ((backupLba >>> 24) & 0x0F);
  d[0x1D] = (backupLba >>> 16) & 0xFF;
  d[0x1E] = (backupLba >>> 8) & 0xFF;
  d[0x1F] = backupLba & 0xFF;
  // Disk label at $20 (16 B, space-padded)
  for (var li = 0; li < 16; li++) {
    d[0x20 + li] = li < label.length ? (label.charCodeAt(li) & 0xFF) : 0x20;
  }
  // Partition table at LBA 1 starts zeroed (matches ArrayBuffer default).

  var partStart = 2;
  var partEnd = totalLbas - 1;
  var initRes = cfsInitPartitionStorage(buf, partStart, partEnd, partitionName);
  if (!initRes.ok) return null;
  var addRes = cfsAddPartitionToTable(buf, 0, partitionName, partStart, partEnd, initRes.rootDirLba, initRes.deletedDirLba);
  if (!addRes.ok) return null;
  return buf;
}

// Create a CFS subdirectory inside `parentDirLba`. Allocates one sector
// for the new directory, writes a self-reference entry in its slot 0
// (with self pointer at $10..$13 and parent pointer at $14..$17), then
// adds an outgoing DIR entry in the parent dir's first free slot.
//
// Conventions cross-checked against ide.hdd's PROFIRE self-ref:
//   * self-ref name is space-padded, attr byte 0x7B (D|R|W|X | DIR, no
//     Closed bit — self-refs aren't "files")
//   * outgoing DIR entry name is null-padded, attr byte 0xFB (Closed |
//     D|R|W|X | DIR)
//   * self-ref's $10..$13 pointer uses byte0=0x40 (LBA flag only)
//   * outgoing's data-tree pointer uses byte0=0xC0 (VALID|LBA — clean
//     pattern; reading code never checks VALID anyway)
function cfsCreateSubdir(buffer, partitionStart, partitionEndLba, parentDirLba, name) {
  if (!buffer || !parentDirLba) return { ok: false, error: 'invalid args' };
  if (!name || name.length === 0) return { ok: false, error: 'empty name' };

  var slot = cfsFindEmptyDirSlot(buffer, parentDirLba);
  if (!slot) return { ok: false, error: 'no empty slot in parent dir' };

  var newDirLba = cfsAllocSector(buffer, partitionStart, partitionEndLba, parentDirLba + 1);
  if (newDirLba < 0) return { ok: false, error: 'no free sector for new directory' };

  var data = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);

  // Zero the new directory sector, then write its self-reference at slot 0.
  var newDirBase = newDirLba * IDE64_SECTOR_SIZE;
  for (var z = 0; z < IDE64_SECTOR_SIZE; z++) data[newDirBase + z] = 0;
  // Self-ref name: 16 bytes, $A0-padded so the CFS dir header doesn't
  // display trailing spaces after the dir is entered (the row renderer
  // stops at $A0 / $00 but treats $20 as a visible character now).
  for (var n = 0; n < 16; n++) {
    data[newDirBase + n] = n < name.length ? (name.charCodeAt(n) & 0xFF) : 0xA0;
  }
  // $10..$13 — self pointer (LBA flag, addr = newDirLba)
  data[newDirBase + 0x10] = 0x40 | ((newDirLba >>> 24) & 0x0F);
  data[newDirBase + 0x11] = (newDirLba >>> 16) & 0xFF;
  data[newDirBase + 0x12] = (newDirLba >>> 8) & 0xFF;
  data[newDirBase + 0x13] = newDirLba & 0xFF;
  // $14..$17 — parent pointer
  data[newDirBase + 0x14] = 0x40 | ((parentDirLba >>> 24) & 0x0F);
  data[newDirBase + 0x15] = (parentDirLba >>> 16) & 0xFF;
  data[newDirBase + 0x16] = (parentDirLba >>> 8) & 0xFF;
  data[newDirBase + 0x17] = parentDirLba & 0xFF;
  // $18 — attribute byte (D|R|W|X | DIR, no Closed)
  data[newDirBase + 0x18] = 0x7B;
  // $19..$1B — "DIR"
  data[newDirBase + 0x19] = 0x44; // D
  data[newDirBase + 0x1A] = 0x49; // I
  data[newDirBase + 0x1B] = 0x52; // R
  // $1C..$1F — mtime stays zero (we don't have a clock source here)

  // Write the outgoing entry in the parent directory.
  var po = slot.dirLba * IDE64_SECTOR_SIZE + slot.slotIndex * CFS_DIR_ENTRY_SIZE;
  // Preserve bits 5..4 of byte $14 — see cfsRemoveDirEntry / cfsImportFile
  // for the dir-next bit-slicing rationale.
  var dirNextBits = data[po + 0x14] & 0x30;
  for (var pz = 0; pz < CFS_DIR_ENTRY_SIZE; pz++) data[po + pz] = 0;
  // Outgoing name: null-padded (matches root→PROFIRE in ide.hdd)
  for (var nn = 0; nn < 16 && nn < name.length; nn++) {
    data[po + nn] = name.charCodeAt(nn) & 0xFF;
  }
  // $10..$13 — zeros (outgoing convention; size field is meaningless for DIRs)
  // $14..$17 — data-tree pointer to the new subdir's first sector
  data[po + 0x14] = 0xC0 | dirNextBits | ((newDirLba >>> 24) & 0x0F);
  data[po + 0x15] = (newDirLba >>> 16) & 0xFF;
  data[po + 0x16] = (newDirLba >>> 8) & 0xFF;
  data[po + 0x17] = newDirLba & 0xFF;
  // $18 — attribute byte (Closed|D|R|W|X | DIR)
  data[po + 0x18] = 0xFB;
  // $19..$1B — "DIR"
  data[po + 0x19] = 0x44;
  data[po + 0x1A] = 0x49;
  data[po + 0x1B] = 0x52;
  cfsTouchEntryMtime(buffer, slot.dirLba, slot.slotIndex);

  return { ok: true, dirLba: slot.dirLba, slotIndex: slot.slotIndex, newDirLba: newDirLba };
}

// Resolve a slash-separated CFS path against `buffer`, starting at the
// directory at `startDirLba`. Returns the matched entry or null when
// any component is missing or a non-DIR is encountered mid-path. Names
// are matched case-sensitively — CFS preserves case (unlike CBM-DOS).
function cfsResolvePath(buffer, startDirLba, path) {
  if (!buffer || !path) return null;
  var parts = path.split('/').filter(function(p) { return p.length > 0; });
  if (parts.length === 0) return null;
  var dirLba = startDirLba;
  var found = null;
  for (var i = 0; i < parts.length; i++) {
    var entries = readCfsDirectory(buffer, dirLba);
    if (!entries) return null;
    // Compare via petsciiToReadable on both sides: entry names carry
    // PUA-PETSCII codepoints (so the C64 font renders them); the path
    // string the caller passed is plain ASCII or a similar PUA form,
    // either of which collapses to the same readable form.
    var targetReadable = petsciiToReadable(parts[i]);
    var match = null;
    for (var j = 0; j < entries.length; j++) {
      var e = entries[j];
      if (e.empty || e.isSelfRef) continue;
      if (petsciiToReadable(e.name) === targetReadable) { match = e; break; }
    }
    if (!match) return null;
    if (i < parts.length - 1) {
      if (match.ftype !== CFS_FTYPE.DIR) return null;
      if (!match.dataTreePtr || !match.dataTreePtr.lba) return null;
      dirLba = match.dataTreePtr.addr;
    } else {
      found = match;
    }
  }
  return found;
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
    // Quick all-zero test — ignore bits 5..4 of byte $14, they're the
    // dir-next pointer's bit-sliced contribution from this slot and
    // cfsRemoveDirEntry deliberately preserves them. A slot with only
    // those bits set is truly empty for the user's purposes.
    var allZero = true;
    for (var z = 0; z < CFS_DIR_ENTRY_SIZE; z++) {
      var mask = (z === 0x14) ? 0xCF : 0xFF;
      if ((data[off + z] & mask) !== 0) { allZero = false; break; }
    }
    if (allZero) {
      entries.push({ index: i, empty: true });
      continue;
    }

    var nameBytes = [];
    for (var n = 0; n < 16; n++) nameBytes.push(data[off + n]);
    // Trim length at the byte level (stop at $A0 / $00, then strip
    // trailing $20 runs) before decoding PETSCII → PUA codepoints. PUA
    // chars don't match JS regex `\s` so post-decode trim wouldn't
    // catch the space-padded names we get from createEmptyHdd.
    var nlen = 16;
    for (var nb = 0; nb < 16; nb++) {
      if (data[off + nb] === 0xA0 || data[off + nb] === 0x00) { nlen = nb; break; }
    }
    while (nlen > 0 && data[off + nlen - 1] === 0x20) nlen--;
    var name = readPetsciiString(data, off, nlen, false);

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
    // Decode as PETSCII (returns PUA codepoints the C64-font CSS can
    // render). readPetsciiString stops at $A0 / $00; we also strip
    // trailing spaces because fresh partitions we create are space-
    // padded.
    var nlen = 16;
    for (var nb = 0; nb < 16; nb++) {
      if (data[off + nb] === 0xA0 || data[off + nb] === 0x00) { nlen = nb; break; }
    }
    while (nlen > 0 && data[off + nlen - 1] === 0x20) nlen--;
    var name = readPetsciiString(data, off, nlen, false);

    var startPtr = _readIde64Pointer(data, off + 0x10);
    var endPtr = _readIde64Pointer(data, off + 0x14);
    var startValid = (startPtr.raw0 & 0x80) !== 0;
    var type = _ide64PartTypeFromEnd(endPtr.raw0);
    // Distinguish "truly empty" from "soft-deleted". A soft-deleted slot
    // still has its type bits + name + LBAs preserved (IDEDOS scratch
    // only flips the VALID bit), so we can list and restore it. A truly
    // empty slot has no type → nothing to recover.
    var empty = type === 0x00;
    var deleted = !empty && !startValid;

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
      deleted: deleted,
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
