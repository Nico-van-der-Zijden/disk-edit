// ── IDE64 / CFS 0.11 container support ────────────────────────────────
//
// .hdd images hold the CFS 0.11 filesystem: 512-byte sectors, LBA
// addressing, B-tree files. None of the CBM-DOS sector helpers apply.
//
// Sources: cfs.html (singularcrew.hu/idedos/cfs.html; understates the
// partition-name length, which is 16) and fusecfs 2.0.4 (block.c,
// cfs011mount.c), which is authoritative for the encodings below.

var IDE64_MAGIC_STRING = 'C64 CFS V 0.11B ';
var IDE64_MAGIC_OFFSET = 0x08;
var IDE64_SECTOR_SIZE = 512;
var IDE64_PARTITION_ENTRIES = 16;
var IDE64_PARTITION_ENTRY_SIZE = 32;
var CFS_BITMAP_CHUNK = 4096;      // LBAs covered by one allocation-bitmap sector
var CFS_MAX_DIR_SECTORS = 64;     // fusecfs extend_dir limit (1024 entries)
// Bits 5..4 of byte $14 in every dir slot carry a slice of the sector's
// dir-next pointer, not slot data.
var CFS_DIR_NEXT_BITS = 0x30;
var CFS_DIR_NEXT_KEEP = 0xCF;

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

// Stamp "now" (or `date`) into the entry's mtime. Every user edit of an
// entry touches it; scratch / unscratch / swap deliberately don't.
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
  var seen = {};
  while (level > 0 && itt !== null && itt > 0) {
    if (seen[itt]) return null;
    seen[itt] = true;
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
      var sectorBase = dataSecLba * IDE64_SECTOR_SIZE;
      if (sectorBase + IDE64_SECTOR_SIZE > data.length) {
        return { data: result.subarray(0, resultIdx), error: 'data sector past end of image' };
      }
      // CFS data sectors are byte-sliced with stride 4: the N-th file
      // byte within a 512-byte sector lives at sector offset
      // (N & 0x7F) * 4 + (N >> 7). So file bytes 0..127 are at sector
      // offsets 0, 4, 8, …, 508 (pass 0); bytes 128..255 are at offsets
      // 1, 5, 9, …, 509 (pass 1); and so on. Reverse the slicing when
      // reading. Verified against DirMaster's CFS export.
      var byteInSector = offset & (IDE64_SECTOR_SIZE - 1);
      for (var b = 0; b < copyLen; b++) {
        var n = byteInSector + b;
        var sliceOff = (n & 0x7F) * 4 + (n >>> 7);
        result[resultIdx + b] = data[sectorBase + sliceOff];
      }
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

// Inverse of _cfsReadDirNext: distribute a 4-byte dir-next pointer across
// bits 5..4 of byte $14 of every slot in the sector. Each group of 4 slots
// carries one output byte, with positions matching the reader (the first
// slot in the group contributes bits 7..6, the second 5..4, third 3..2,
// fourth 1..0). Other bits of each slot's $14 are preserved.
function _cfsWriteDirNext(data, sectorBase, addr) {
  var b0 = (addr ? 0x40 : 0) | ((addr >>> 24) & 0x0F);
  var b1 = (addr >>> 16) & 0xFF;
  var b2 = (addr >>> 8) & 0xFF;
  var b3 = addr & 0xFF;
  var bytes = [b0, b1, b2, b3];
  for (var i = 0; i < 4; i++) {
    var entryBase = sectorBase + 0x180 - i * 0x80;
    var b = bytes[i];
    data[entryBase + 0x14] = (data[entryBase + 0x14] & CFS_DIR_NEXT_KEEP) | ((b >>> 2) & CFS_DIR_NEXT_BITS);
    data[entryBase + 0x34] = (data[entryBase + 0x34] & CFS_DIR_NEXT_KEEP) | (b & CFS_DIR_NEXT_BITS);
    data[entryBase + 0x54] = (data[entryBase + 0x54] & CFS_DIR_NEXT_KEEP) | ((b << 2) & CFS_DIR_NEXT_BITS);
    data[entryBase + 0x74] = (data[entryBase + 0x74] & CFS_DIR_NEXT_KEEP) | ((b << 4) & CFS_DIR_NEXT_BITS);
  }
}

// ── CFS bitmap allocator ──────────────────────────────────────────────
// Bitmap N sits at partition_start + N × CFS_BITMAP_CHUNK and covers that
// chunk, itself included. MSB-first, 1 = free. Verified on ide.hdd
// (bitmaps at LBA 2, 4098, 8194, 12290).

function cfsBamLocation(partitionStart, absLba) {
  var rel = absLba - partitionStart;
  if (rel < 0) return null;
  var chunkIdx = Math.floor(rel / CFS_BITMAP_CHUNK);
  var bitmapLba = partitionStart + chunkIdx * CFS_BITMAP_CHUNK;
  var bitInChunk = rel % CFS_BITMAP_CHUNK;
  return {
    bitmapLba: bitmapLba,
    byteIdx: bitInChunk >>> 3,
    bitMask: 0x80 >>> (bitInChunk & 7),
    bitInChunk: bitInChunk,
  };
}

// Count used sectors by popcounting each bitmap; bits past
// partitionEndLba in the last bitmap are masked off.
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
  var groupCount = Math.ceil(totalSectors / CFS_BITMAP_CHUNK);
  for (var g = 0; g < groupCount; g++) {
    var sectorsInGroup = Math.min(CFS_BITMAP_CHUNK, totalSectors - g * CFS_BITMAP_CHUNK);
    var bmOff = (partitionStart + g * CFS_BITMAP_CHUNK) * IDE64_SECTOR_SIZE;
    if (bmOff + IDE64_SECTOR_SIZE > data.length) break;
    var fullBytes = Math.floor(sectorsInGroup / 8);
    var freeBits = 0;
    for (var b = 0; b < fullBytes; b++) freeBits += popcount(data[bmOff + b]);
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

// Report every LBA a CFS partition's structures own, via
// claim(lba, kind, entry, path) with kind 'bitmap' | 'dir' | 'tree' |
// 'data' | 'reserved'. 'reserved' — each bitmap's companion sector and
// the last LBA, which cfsfdisk marks used without anything living there
// — is reported last, and only for LBAs nothing else claimed. Files and
// LNKs own their data tree; DEL entries own nothing (freed at scratch).
// The deldir is walked even if no root entry points at it.
function cfsWalkPartitionSectors(buffer, partition, claim, onError) {
  var data = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  var partStart = partition.startLba;
  var partEnd = partition.endLba;
  var claimed = {};
  function inRange(lba) { return lba >= partStart && lba <= partEnd; }
  function put(lba, kind, entry, path) {
    if (!inRange(lba)) return;
    claimed[lba] = true;
    claim(lba, kind, entry, path);
  }

  for (var bm = partStart; bm <= partEnd; bm += CFS_BITMAP_CHUNK) put(bm, 'bitmap', null, 'system');

  function walkTree(entry, path) {
    var depth = _cfsComputeTreeDepth(entry.size || 0);
    var seen = {};
    function w(nodeLba, level) {
      if (!nodeLba || !inRange(nodeLba) || seen[nodeLba]) return;
      seen[nodeLba] = true;
      put(nodeLba, 'tree', entry, path);
      var nodeBase = nodeLba * IDE64_SECTOR_SIZE;
      if (nodeBase + IDE64_SECTOR_SIZE > data.length) return;
      for (var pi = 0; pi < 128; pi++) {
        var dp = _readIde64Pointer(data, nodeBase + pi * 4);
        if (dp.lba && dp.addr > 0) put(dp.addr, 'data', entry, path);
      }
      if (level < depth) {
        for (var s = 0; s < 8; s++) {
          var link = _cfsReadTreeLink(data, nodeBase + s * 64);
          if (link.lba && link.addr > 0) w(link.addr, level + 1);
        }
      }
    }
    w(entry.dataTreePtr.addr, 0);
  }

  var dirVisited = {};
  function walkDirChain(firstDirLba, path) {
    var lba = firstDirLba;
    while (lba && !dirVisited[lba]) {
      if (!inRange(lba)) {
        if (onError) onError(path + ': dir LBA $' + lba.toString(16) + ' outside partition');
        return;
      }
      dirVisited[lba] = true;
      put(lba, 'dir', null, path);
      var entries = readCfsDirectorySector(data, lba);
      if (!entries) break;
      for (var i = (lba === firstDirLba ? 1 : 0); i < entries.length; i++) {
        var en = entries[i];
        if (en.empty || en.ftype === CFS_FTYPE.DEL) continue;
        if (!en.dataTreePtr || !en.dataTreePtr.lba) continue;
        var childPath = path.replace(/\/$/, '') + '/' + petsciiToReadable(en.name);
        if (en.ftype === CFS_FTYPE.DIR) walkDirChain(en.dataTreePtr.addr, childPath);
        else walkTree(en, childPath);
      }
      var nextPtr = _cfsReadDirNext(data, lba * IDE64_SECTOR_SIZE);
      lba = (nextPtr.lba && nextPtr.addr > 0) ? nextPtr.addr : 0;
    }
  }
  if (partition.cfsRootDir && partition.cfsRootDir.lba) walkDirChain(partition.cfsRootDir.addr, '/');
  if (partition.cfsDeletedDir && partition.cfsDeletedDir.lba) walkDirChain(partition.cfsDeletedDir.addr, '/<deleted>');

  var reserved = [];
  for (var c = partStart; c <= partEnd; c += CFS_BITMAP_CHUNK) reserved.push(c + 1);
  reserved.push(partEnd);
  for (var r = 0; r < reserved.length; r++) {
    if (inRange(reserved[r]) && !claimed[reserved[r]]) put(reserved[r], 'reserved', null, 'system');
  }
}

// Reconcile the bitmap against what the partition's structures own.
// Returns { log, lostCount, missingCount, overlapCount, overlap,
// reachable, reserved }:
//   lost    — bitmap USED but unowned (wasted space)
//   missing — owned but bitmap FREE (will be overwritten)
//   overlap — owned twice (one owner reads garbage)
// Reserved sectors are fine either way. opts.fix rewrites the bitmap;
// the caller pushes undo first.
function cfsValidatePartition(buffer, partition, opts) {
  opts = opts || {};
  var log = [];
  if (!buffer || !partition) { log.push('ERROR: invalid arguments'); return { log: log, lostCount: 0, missingCount: 0, reachable: {}, reserved: {} }; }
  var data = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  var partStart = partition.startLba;
  var partEnd = partition.endLba;
  if (partStart == null || partEnd == null) { log.push('ERROR: partition has no LBA bounds'); return { log: log, lostCount: 0, missingCount: 0, reachable: {}, reserved: {} }; }

  var reachable = {};
  var reserved = {};
  var overlap = [];
  cfsWalkPartitionSectors(data, partition, function(lba, kind, entry, path) {
    if (kind === 'reserved') { reserved[lba] = true; return; }
    var owner = kind === 'bitmap' ? 'system:bitmap' : kind + ':' + path;
    var prev = reachable[lba];
    if (prev && prev !== owner) overlap.push({ lba: lba, owners: [prev, owner] });
    else if (!prev) reachable[lba] = owner;
  }, function(msg) { log.push('  ERROR: ' + msg); });

  var lost = [];
  var missing = [];
  for (var lba = partStart; lba <= partEnd; lba++) {
    if (reserved[lba]) continue;
    var isUsed = !cfsIsSectorFree(data, partStart, lba);
    var shouldBeUsed = !!reachable[lba];
    if (isUsed && !shouldBeUsed) lost.push(lba);
    else if (!isUsed && shouldBeUsed) missing.push(lba);
  }

  if (lost.length === 0 && missing.length === 0 && overlap.length === 0) {
    log.push('Bitmap is consistent — every used sector is claimed by a file or system structure.');
  } else {
    if (overlap.length > 0) {
      log.push('ERROR: ' + overlap.length + ' sector(s) claimed by more than one file or structure.');
      log.push('  Data in these sectors is shared — at least one owner is reading garbage.');
      for (var oi = 0; oi < Math.min(overlap.length, 10); oi++) {
        var ov = overlap[oi];
        log.push('    LBA $' + ov.lba.toString(16).toUpperCase() + ': ' + ov.owners[0] + ' + ' + ov.owners[1]);
      }
      if (overlap.length > 10) log.push('    … and ' + (overlap.length - 10) + ' more');
    }
    if (missing.length > 0) {
      log.push('ERROR: ' + missing.length + ' sector(s) claimed by a file but marked FREE in the bitmap.');
      log.push('  These will be re-allocated on next file write, corrupting existing content.');
      for (var mi = 0; mi < Math.min(missing.length, 10); mi++) {
        log.push('    LBA $' + missing[mi].toString(16).toUpperCase());
      }
      if (missing.length > 10) log.push('    … and ' + (missing.length - 10) + ' more');
    }
    if (lost.length > 0) {
      log.push((opts.fix ? '' : 'Warning: ') + lost.length + ' lost sector(s) marked USED in the bitmap but not claimed by any file.');
      for (var li = 0; li < Math.min(lost.length, 10); li++) {
        log.push('    LBA $' + lost[li].toString(16).toUpperCase());
      }
      if (lost.length > 10) log.push('    … and ' + (lost.length - 10) + ' more');
    }
  }

  if (opts.fix && (lost.length > 0 || missing.length > 0)) {
    for (var fl = 0; fl < lost.length; fl++) cfsMarkSectorFree(data, partStart, lost[fl]);
    for (var fm = 0; fm < missing.length; fm++) cfsMarkSectorUsed(data, partStart, missing[fm]);
    log.push('Bitmap rebuilt: ' + lost.length + ' freed, ' + missing.length + ' marked used.');
  }

  return { log: log, lostCount: lost.length, missingCount: missing.length, overlapCount: overlap.length, overlap: overlap, reachable: reachable, reserved: reserved };
}

// Hunt orphan tree-node sectors in a CFS partition. Quick mode checks
// USED-but-unreachable LBAs only; deep mode also scans free space for
// recently-scratched files (more false positives — threshold is higher).
// Each candidate's tree is walked, data sectors byte-slice-decoded, and
// joined into a reconstructed file body. Returns
//   [{ treeLba, dataLbas, data, suggestedType, loadAddress, fromFree }].
function cfsScanOrphans(buffer, partition, opts) {
  opts = opts || {};
  if (!buffer || !partition) return [];
  var data = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  var partStart = partition.startLba;
  var partEnd = partition.endLba;
  if (partStart == null || partEnd == null) return [];

  var walk = cfsValidatePartition(buffer, partition, { fix: false });

  // Candidates: unowned sectors that look like a tree node. Deep mode
  // also scans free space and wants 8+ of the first 16 pointers valid.
  var candidates = [];
  var fromFree = {};
  var minPlausible = opts.deep ? 8 : 1;
  for (var lba = partStart; lba <= partEnd; lba++) {
    if (walk.reachable[lba] || walk.reserved[lba]) continue;
    var isFree = cfsIsSectorFree(data, partStart, lba);
    if (!opts.deep && isFree) continue;
    var base = lba * IDE64_SECTOR_SIZE;
    if (base + IDE64_SECTOR_SIZE > data.length) continue;
    var first = _readIde64Pointer(data, base);
    if (!first.lba || first.addr < partStart || first.addr > partEnd) continue;
    var plausible = 0;
    for (var s = 0; s < 16; s++) {
      var dp = _readIde64Pointer(data, base + s * 4);
      if (dp.lba && dp.addr >= partStart && dp.addr <= partEnd) plausible++;
      else break;
    }
    if (plausible < minPlausible) continue;
    candidates.push(lba);
    if (isFree) fromFree[lba] = true;
  }

  var results = [];
  for (var ci = 0; ci < candidates.length; ci++) {
    var treeLba = candidates[ci];
    var treeBase = treeLba * IDE64_SECTOR_SIZE;
    var dataLbas = [];
    for (var slot = 0; slot < 128; slot++) {
      var p = _readIde64Pointer(data, treeBase + slot * 4);
      if (!p.lba || p.addr <= 0) break;
      if (p.addr < partStart || p.addr > partEnd) break;
      dataLbas.push(p.addr);
    }
    if (dataLbas.length === 0) continue;
    var bytes = new Uint8Array(dataLbas.length * IDE64_SECTOR_SIZE);
    for (var di = 0; di < dataLbas.length; di++) {
      var dBase = dataLbas[di] * IDE64_SECTOR_SIZE;
      if (dBase + IDE64_SECTOR_SIZE > data.length) break;
      for (var bn = 0; bn < IDE64_SECTOR_SIZE; bn++) {
        var sliceOff = (bn & 0x7F) * 4 + (bn >>> 7);
        bytes[di * IDE64_SECTOR_SIZE + bn] = data[dBase + sliceOff];
      }
    }
    // Treat bytes 0..1 as the load address; PRG if it lands in C64 RAM.
    var loadAddr = bytes.length >= 2 ? (bytes[0] | (bytes[1] << 8)) : 0;
    var suggestedType = 'SEQ';
    if (loadAddr >= 0x0400 && loadAddr <= 0xFF00) suggestedType = 'PRG';
    results.push({
      treeLba: treeLba,
      dataLbas: dataLbas,
      data: bytes,
      suggestedType: suggestedType,
      loadAddress: suggestedType === 'PRG' ? loadAddr : null,
      fromFree: !!fromFree[treeLba],
    });
  }
  return results;
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

// ── CFS dir-entry field edits (no bitmap changes) ─────────────────────
// Caller pushes undo and re-renders.

// Write the 16-byte name, $00-padded like IDEDOS / cfsfdisk file entries.
function cfsWriteDirEntryName(buffer, dirLba, slotIndex, newName) {
  if (!buffer || slotIndex < 0 || slotIndex >= CFS_DIR_ENTRIES_PER_SECTOR) return false;
  var data = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  var off = dirLba * IDE64_SECTOR_SIZE + slotIndex * CFS_DIR_ENTRY_SIZE;
  if (off + 16 > data.length) return false;
  for (var i = 0; i < 16; i++) {
    data[off + i] = i < newName.length ? (newName.charCodeAt(i) & 0xFF) : 0x00;
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

// Map a CBM-DOS type index (0..5) to CFS ftype + typeSuffix and write
// it to the entry. 0 DEL preserves typeSuffix and clears Closed (same
// attr edit Scratch does, but leaves sectors allocated); 1/2/3 → NORMAL
// + SEQ/PRG/USR; 4 → REL + "REL"; 5 (CBM) refused. Caller refuses
// DIR/LNK at the UI layer.
function cfsChangeFileType(buffer, dirLba, slotIndex, cbmTypeIdx) {
  if (!buffer || slotIndex < 0 || slotIndex >= CFS_DIR_ENTRIES_PER_SECTOR) return false;
  var data = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  var off = dirLba * IDE64_SECTOR_SIZE + slotIndex * CFS_DIR_ENTRY_SIZE;
  if (off + 0x1C > data.length) return false;
  if (cbmTypeIdx === 0) {
    data[off + 0x18] = data[off + 0x18] & 0x78;
    cfsTouchEntryMtime(buffer, dirLba, slotIndex);
    return true;
  }
  var map = { 1: { ftype: CFS_FTYPE.NORMAL, suffix: 'SEQ' },
              2: { ftype: CFS_FTYPE.NORMAL, suffix: 'PRG' },
              3: { ftype: CFS_FTYPE.NORMAL, suffix: 'USR' },
              4: { ftype: CFS_FTYPE.REL,    suffix: 'REL' } };
  var m = map[cbmTypeIdx];
  if (!m) return false;
  var attr = data[off + 0x18];
  data[off + 0x18] = (attr & 0xF8) | (m.ftype & 0x07);
  data[off + 0x19] = m.suffix.charCodeAt(0);
  data[off + 0x1A] = m.suffix.charCodeAt(1);
  data[off + 0x1B] = m.suffix.charCodeAt(2);
  cfsTouchEntryMtime(buffer, dirLba, slotIndex);
  return true;
}

// Sort a CFS directory by name or size. Slot 0 self-ref and the deldir-
// ref entry stay pinned. Dir-next bits at byte $14 of each slot are
// preserved across the rewrite. sortKey: name-asc|name-desc|blocks-asc|
// blocks-desc. Caller pushes undo + re-renders.
function cfsSortDirectory(buffer, firstDirLba, deldirLba, sortKey) {
  if (!buffer || !firstDirLba) return false;
  var data = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);

  // Collect every (dirLba, slotIndex) across the dir chain.
  var slotList = [];
  var dirLba = firstDirLba;
  var visited = {};
  while (dirLba && !visited[dirLba]) {
    visited[dirLba] = true;
    for (var si = 0; si < CFS_DIR_ENTRIES_PER_SECTOR; si++) {
      slotList.push({ dirLba: dirLba, slotIndex: si });
    }
    var nextPtr = _cfsReadDirNext(data, dirLba * IDE64_SECTOR_SIZE);
    dirLba = (nextPtr.lba && nextPtr.addr > 0) ? nextPtr.addr : 0;
  }
  if (slotList.length === 0) return false;

  // Snapshot every slot's 32 bytes and split into fixed/sortable/empty.
  var sortable = [];
  var fixedSet = {};
  for (var i = 0; i < slotList.length; i++) {
    var sl = slotList[i];
    var off = sl.dirLba * IDE64_SECTOR_SIZE + sl.slotIndex * CFS_DIR_ENTRY_SIZE;
    var bytes = new Uint8Array(CFS_DIR_ENTRY_SIZE);
    for (var b = 0; b < CFS_DIR_ENTRY_SIZE; b++) bytes[b] = data[off + b];

    if (_cfsSlotIsEmpty(bytes, 0)) continue;

    // Self-ref at slot 0 of the first dir sector.
    if (i === 0) { fixedSet[i] = true; continue; }

    // Deldir-ref: tree pointer matches the partition's deldir LBA.
    if (deldirLba && deldirLba > 0) {
      var dpLba = ((bytes[0x14] & 0x0F) << 24) | (bytes[0x15] << 16) | (bytes[0x16] << 8) | bytes[0x17];
      if (dpLba === deldirLba) { fixedSet[i] = true; continue; }
    }

    var nameStr = '';
    for (var nb = 0; nb < 16; nb++) {
      var nc = bytes[nb];
      if (nc === 0x00 || nc === 0xA0) break;
      nameStr += String.fromCharCode(nc);
    }
    // REL files use 24-bit size; others 32-bit. Block divisor = 256.
    var ftype = bytes[0x18] & 0x07;
    var sizeLo = bytes[0x10] | (bytes[0x11] << 8) | (bytes[0x12] << 16);
    var sizeHi = bytes[0x13];
    var byteCount = (ftype === 2 /*REL*/) ? sizeLo : (sizeLo + sizeHi * 0x1000000);
    var blocks = byteCount === 0 ? 0 : Math.ceil(byteCount / 256);

    sortable.push({ bytes: bytes, name: nameStr, blocks: blocks });
  }

  // Sort sortable[] by the requested key.
  var cmp;
  if (sortKey === 'name-asc') cmp = function(a, b) { return a.name < b.name ? -1 : a.name > b.name ? 1 : 0; };
  else if (sortKey === 'name-desc') cmp = function(a, b) { return a.name < b.name ? 1 : a.name > b.name ? -1 : 0; };
  else if (sortKey === 'blocks-asc') cmp = function(a, b) { return a.blocks - b.blocks; };
  else if (sortKey === 'blocks-desc') cmp = function(a, b) { return b.blocks - a.blocks; };
  else return false;
  sortable.sort(cmp);

  // Write back in sorted order, skipping fixed slots and zeroing the tail.
  var srcIdx = 0;
  for (var w = 0; w < slotList.length; w++) {
    if (fixedSet[w]) continue;
    var ws = slotList[w];
    var woff = ws.dirLba * IDE64_SECTOR_SIZE + ws.slotIndex * CFS_DIR_ENTRY_SIZE;
    var dirNextBits = data[woff + 0x14] & CFS_DIR_NEXT_BITS;
    if (srcIdx < sortable.length) {
      var srcBytes = sortable[srcIdx++].bytes;
      for (var c = 0; c < CFS_DIR_ENTRY_SIZE; c++) data[woff + c] = srcBytes[c];
    } else {
      for (var ze = 0; ze < CFS_DIR_ENTRY_SIZE; ze++) data[woff + ze] = 0;
    }
    data[woff + 0x14] = (data[woff + 0x14] & CFS_DIR_NEXT_KEEP) | dirNextBits;
  }
  return true;
}

// True when the 32-byte slot at `off` holds nothing but dir-next bits.
function _cfsSlotIsEmpty(data, off) {
  for (var z = 0; z < CFS_DIR_ENTRY_SIZE; z++) {
    var mask = (z === 0x14) ? CFS_DIR_NEXT_KEEP : 0xFF;
    if ((data[off + z] & mask) !== 0) return false;
  }
  return true;
}

// Overwrite the size at $10..$13 (little-endian). REL keeps byte $13,
// which holds REL metadata rather than size.
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

// Count the data sectors a file's (or LNK's) tree points at, or the
// sectors of a DIR's chain. 0 for DEL / out-of-range trees.
function cfsCountFileDataSectors(buffer, partitionStart, partitionEndLba, entry) {
  if (!buffer || !entry) return 0;
  var data = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  if (entry.ftype === CFS_FTYPE.DEL) return 0;
  if (!entry.dataTreePtr || !entry.dataTreePtr.lba) return 0;
  var rootLba = entry.dataTreePtr.addr;
  if (rootLba <= 0 || rootLba < partitionStart || rootLba > partitionEndLba) return 0;

  if (entry.ftype === CFS_FTYPE.DIR) {
    var visited = {};
    var count = 0;
    var lba = rootLba;
    var hops = 0;
    while (lba && !visited[lba] && hops < CFS_MAX_DIR_SECTORS) {
      visited[lba] = true;
      hops++;
      count++;
      var nextPtr = _cfsReadDirNext(data, lba * IDE64_SECTOR_SIZE);
      lba = (nextPtr.lba && nextPtr.addr > 0) ? nextPtr.addr : 0;
    }
    return count;
  }

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

// Free every tree node and data sector of a file's B-tree in the bitmap.
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

// Scratch every live child (recursively, as IDEDOS does — children are
// marked DEL in place), then free the dir chain's own sectors.
function _cfsDeleteDirContents(data, partitionStart, partitionEndLba, firstDirLba) {
  if (!firstDirLba || firstDirLba < partitionStart || firstDirLba > partitionEndLba) return;
  var children = readCfsDirectory(data, firstDirLba) || [];
  for (var ci = 0; ci < children.length; ci++) {
    var child = children[ci];
    if (!child || child.empty) continue;
    if (child.isSelfRef) continue;
    if (child.ftype === CFS_FTYPE.DEL) continue;
    cfsDeleteFile(data, partitionStart, partitionEndLba, child);
  }
  var visited = {};
  var dirLba = firstDirLba;
  var hops = 0;
  while (dirLba && !visited[dirLba] && hops < CFS_MAX_DIR_SECTORS) {
    visited[dirLba] = true;
    hops++;
    var nextPtr = _cfsReadDirNext(data, dirLba * IDE64_SECTOR_SIZE);
    cfsMarkSectorFree(data, partitionStart, dirLba);
    dirLba = (nextPtr.lba && nextPtr.addr > 0) ? nextPtr.addr : 0;
  }
}

// Scratch an entry the IDEDOS way: free what it owns (a DIR's children
// recursively, then its chain; a file's or LNK's data tree — a LNK's
// target path is stored as file data), then clear ftype + Closed in $18.
// Name, size, pointer and suffix stay so cfsUnscratchEntry can restore it.
function cfsDeleteFile(buffer, partitionStart, partitionEndLba, entry) {
  if (!buffer || !entry || entry.dirLba == null) return { ok: false, error: 'invalid entry' };
  var data = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  if (entry.ftype === CFS_FTYPE.DEL) return { ok: false, error: 'already deleted' };

  if (entry.ftype === CFS_FTYPE.DIR) {
    if (!entry.dataTreePtr || !entry.dataTreePtr.lba) {
      return { ok: false, error: 'no directory pointer' };
    }
    _cfsDeleteDirContents(data, partitionStart, partitionEndLba, entry.dataTreePtr.addr);
  } else if (entry.dataTreePtr && entry.dataTreePtr.lba && entry.dataTreePtr.addr > 0) {
    // No pointer = placeholder / empty file; nothing to free.
    _cfsFreeFileTree(data, partitionStart, partitionEndLba, entry.dataTreePtr.addr, entry.size);
  }

  var entryOff = entry.dirLba * IDE64_SECTOR_SIZE + entry.index * CFS_DIR_ENTRY_SIZE;
  if (entryOff + 0x19 > data.length) return { ok: false, error: 'dir entry out of range' };
  var attr = data[entryOff + 0x18];
  attr = (attr & 0x78);
  data[entryOff + 0x18] = attr;
  return { ok: true };
}

// Hard-remove an entry: scratch it (freeing its sectors) and zero the
// slot except its dir-next bits. Refuses the dir's self-reference.
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
  var dirNextBits = data[off + 0x14] & CFS_DIR_NEXT_BITS;
  for (var z = 0; z < CFS_DIR_ENTRY_SIZE; z++) data[off + z] = 0;
  data[off + 0x14] = dirNextBits;
  return { ok: true };
}

// Original ftype of a scratched entry, from its preserved typeSuffix.
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

// Every sector the entry owns (or would own if restored): a dir's chain,
// or a file's / LNK's tree nodes + data sectors. Null if unwalkable.
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
    while (lba && !visited[lba] && hops < CFS_MAX_DIR_SECTORS) {
      visited[lba] = true;
      hops++;
      if (lba < partitionStart || lba > partitionEndLba) return null;
      sectors.push(lba);
      var nextPtr = _cfsReadDirNext(data, lba * IDE64_SECTOR_SIZE);
      lba = (nextPtr.lba && nextPtr.addr > 0) ? nextPtr.addr : 0;
    }
    return sectors;
  }

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

// Restore a scratched entry: refuse if any sector it owned has been
// reallocated, else re-mark them used and restore ftype + Closed. A DIR
// also restores its DEL children (best effort) — note this includes
// children scratched before the parent; the on-disk state can't tell
// those apart from ones the parent's scratch cascaded to.
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

  for (var si = 0; si < sectors.length; si++) {
    if (!cfsIsSectorFree(data, partitionStart, sectors[si])) {
      return { ok: false, error: 'data sector LBA ' + sectors[si] + ' is allocated to another file; cannot recover' };
    }
  }

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

// First empty slot in the dir chain as { dirLba, slotIndex }; failing
// that, the first scratched slot (reusing one loses its unscratch); else
// null. Doesn't extend the chain — see _cfsFindOrExtendDirSlot.
function cfsFindEmptyDirSlot(buffer, firstDirLba) {
  if (!buffer || !firstDirLba) return null;
  var data = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  var visited = {};
  var dirLba = firstDirLba;
  var hops = 0;
  var fallback = null;
  while (dirLba && !visited[dirLba] && hops < CFS_MAX_DIR_SECTORS) {
    visited[dirLba] = true;
    hops++;
    var base = dirLba * IDE64_SECTOR_SIZE;
    if (base + IDE64_SECTOR_SIZE > data.length) return null;
    for (var slot = 0; slot < CFS_DIR_ENTRIES_PER_SECTOR; slot++) {
      var eo = base + slot * CFS_DIR_ENTRY_SIZE;
      if (_cfsSlotIsEmpty(data, eo)) return { dirLba: dirLba, slotIndex: slot };
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

// Like cfsFindEmptyDirSlot, but appends a sector to a full chain. Returns
// { dirLba, slotIndex, extendedFromLba, newSectorAllocated } (both -1 if
// nothing was appended; on a later failure the caller frees the new
// sector and clears extendedFromLba's dir-next), or { error }.
function _cfsFindOrExtendDirSlot(buffer, partitionStart, partitionEndLba, firstDirLba) {
  var existing = cfsFindEmptyDirSlot(buffer, firstDirLba);
  if (existing) return { dirLba: existing.dirLba, slotIndex: existing.slotIndex, extendedFromLba: -1, newSectorAllocated: -1 };
  var data = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  var lastDirLba = firstDirLba;
  var visited = {};
  var chainLen = 1;
  while (true) {
    visited[lastDirLba] = true;
    var nextPtr = _cfsReadDirNext(data, lastDirLba * IDE64_SECTOR_SIZE);
    if (!nextPtr.lba || !nextPtr.addr || visited[nextPtr.addr]) break;
    lastDirLba = nextPtr.addr;
    chainLen++;
  }
  if (chainLen >= CFS_MAX_DIR_SECTORS) {
    return { error: 'directory is full (' + CFS_MAX_DIR_SECTORS * CFS_DIR_ENTRIES_PER_SECTOR + ' entries max)' };
  }
  var newDirLba = cfsAllocSector(buffer, partitionStart, partitionEndLba, lastDirLba + 1);
  if (newDirLba < 0) return { error: 'no free sector to extend the directory' };
  var newBase = newDirLba * IDE64_SECTOR_SIZE;
  for (var z = 0; z < IDE64_SECTOR_SIZE; z++) data[newBase + z] = 0;
  _cfsWriteDirNext(data, lastDirLba * IDE64_SECTOR_SIZE, newDirLba);
  return { dirLba: newDirLba, slotIndex: 0, extendedFromLba: lastDirLba, newSectorAllocated: newDirLba };
}

// Writer cap only (depth 5 ≈ 38 GiB); readers handle any depth.
var CFS_MAX_IMPORT_DEPTH = 5;

// Leaf tree sector for `byteOffset`, allocating + zeroing missing
// intermediate nodes (appended to `allocated` for rollback); -1 when out
// of space. Every tree node is also the leaf for its own 64 KiB chunk,
// so offset 0 returns rootLba.
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
      var cbase = childLba * IDE64_SECTOR_SIZE;
      for (var z = 0; z < IDE64_SECTOR_SIZE; z++) data[cbase + z] = 0;
      _cfsWriteTreeLink(data, base, childLba);
      itt = childLba;
    }
  }
  return itt;
}

// Import a file into the dir at firstDirLba, building its B-tree (each
// node is both the leaf for its own 64 KiB and, via treelinks in bits
// 5..4, the parent of deeper chunks). An empty payload gets an entry with
// no tree pointer. Every allocation is rolled back on failure.
function cfsImportFile(buffer, partitionStart, partitionEndLba, firstDirLba, name, payload, opts) {
  opts = opts || {};
  if (!buffer || !firstDirLba) return { ok: false, error: 'invalid args' };
  payload = payload || new Uint8Array(0);
  var depth = _cfsComputeTreeDepth(payload.length);
  if (depth > CFS_MAX_IMPORT_DEPTH) {
    return { ok: false, error: 'file size requires tree depth > ' + CFS_MAX_IMPORT_DEPTH };
  }

  var slot = _cfsFindOrExtendDirSlot(buffer, partitionStart, partitionEndLba, firstDirLba);
  if (slot.error) return { ok: false, error: slot.error };

  var sectorsNeeded = Math.ceil(payload.length / IDE64_SECTOR_SIZE);
  var allocated = [];
  var data = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  if (slot.newSectorAllocated >= 0) allocated.push(slot.newSectorAllocated);
  function rollback() {
    for (var ri = 0; ri < allocated.length; ri++) {
      cfsMarkSectorFree(buffer, partitionStart, allocated[ri]);
    }
    if (slot.extendedFromLba >= 0) {
      _cfsWriteDirNext(data, slot.extendedFromLba * IDE64_SECTOR_SIZE, 0);
    }
  }

  var treeLba = 0;
  if (sectorsNeeded > 0) {
    treeLba = cfsAllocSector(buffer, partitionStart, partitionEndLba, firstDirLba + 1);
    if (treeLba < 0) { rollback(); return { ok: false, error: 'no free sector for tree root' }; }
    allocated.push(treeLba);
    var treeBase = treeLba * IDE64_SECTOR_SIZE;
    for (var t = 0; t < IDE64_SECTOR_SIZE; t++) data[treeBase + t] = 0;
  }

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

    // Byte-sliced: file byte N of the sector lives at (N & 0x7F) * 4 + (N >> 7).
    var dbase = dlba * IDE64_SECTOR_SIZE;
    for (var byteI = 0; byteI < IDE64_SECTOR_SIZE; byteI++) {
      data[dbase + byteI] = 0;
    }
    for (var byteI = 0; byteI < IDE64_SECTOR_SIZE; byteI++) {
      var pi = offsetInFile + byteI;
      if (pi >= payload.length) break;
      var sliceOff = (byteI & 0x7F) * 4 + (byteI >>> 7);
      data[dbase + sliceOff] = payload[pi];
    }

    var ptrIdxInLeaf = (offsetInFile >>> 9) & 0x7F;
    _cfsWriteDataPointer(data, leafLba * IDE64_SECTOR_SIZE + ptrIdxInLeaf * 4, dlba);
  }

  var eo = slot.dirLba * IDE64_SECTOR_SIZE + slot.slotIndex * CFS_DIR_ENTRY_SIZE;
  var dirNextBits = data[eo + 0x14] & CFS_DIR_NEXT_BITS;
  for (var z2 = 0; z2 < CFS_DIR_ENTRY_SIZE; z2++) data[eo + z2] = 0;
  for (var n = 0; n < 16; n++) { // $00-padded, as IDEDOS file entries are
    data[eo + n] = n < name.length ? (name.charCodeAt(n) & 0xFF) : 0x00;
  }
  data[eo + 0x10] = payload.length & 0xFF;
  data[eo + 0x11] = (payload.length >>> 8) & 0xFF;
  data[eo + 0x12] = (payload.length >>> 16) & 0xFF;
  data[eo + 0x13] = (payload.length >>> 24) & 0xFF;
  // Tree pointer: LBA flag only. VICE won't list entries with bit 7 set here.
  data[eo + 0x14] = dirNextBits;
  if (treeLba) {
    data[eo + 0x14] |= 0x40 | ((treeLba >>> 24) & 0x0F);
    data[eo + 0x15] = (treeLba >>> 16) & 0xFF;
    data[eo + 0x16] = (treeLba >>> 8) & 0xFF;
    data[eo + 0x17] = treeLba & 0xFF;
  }
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

// Old name, still used by the tests.
function cfsImportSingleSectorFile(buffer, partitionStart, partitionEndLba, firstDirLba, name, payload, opts) {
  return cfsImportFile(buffer, partitionStart, partitionEndLba, firstDirLba, name, payload, opts);
}

// Swap two dir slots (cross-sector OK), leaving each slot's dir-next bits.
function cfsSwapDirSlots(buffer, slotA, slotB) {
  if (!buffer || !slotA || !slotB) return false;
  if (slotA.dirLba === slotB.dirLba && slotA.slotIndex === slotB.slotIndex) return true;
  var data = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  var ao = slotA.dirLba * IDE64_SECTOR_SIZE + slotA.slotIndex * CFS_DIR_ENTRY_SIZE;
  var bo = slotB.dirLba * IDE64_SECTOR_SIZE + slotB.slotIndex * CFS_DIR_ENTRY_SIZE;
  if (ao + CFS_DIR_ENTRY_SIZE > data.length || bo + CFS_DIR_ENTRY_SIZE > data.length) return false;
  for (var z = 0; z < CFS_DIR_ENTRY_SIZE; z++) {
    if (z === 0x14) {
      var aBits = data[ao + z] & CFS_DIR_NEXT_BITS, bBits = data[bo + z] & CFS_DIR_NEXT_BITS;
      var aRest = data[ao + z] & CFS_DIR_NEXT_KEEP, bRest = data[bo + z] & CFS_DIR_NEXT_KEEP;
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

// Every (dirLba, slotIndex) in chain order, minus the self-reference.
function cfsCollectDirSlots(buffer, firstDirLba) {
  if (!buffer || !firstDirLba) return [];
  var data = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  var slots = [];
  var visited = {};
  var dirLba = firstDirLba;
  var hops = 0;
  while (dirLba && !visited[dirLba] && hops < CFS_MAX_DIR_SECTORS) {
    visited[dirLba] = true;
    hops++;
    var base = dirLba * IDE64_SECTOR_SIZE;
    if (base + IDE64_SECTOR_SIZE > data.length) break;
    var startSlot = (dirLba === firstDirLba) ? 1 : 0;
    for (var i = startSlot; i < CFS_DIR_ENTRIES_PER_SECTOR; i++) {
      slots.push({ dirLba: dirLba, slotIndex: i });
    }
    var nextPtr = _cfsReadDirNext(data, base);
    dirLba = (nextPtr.lba && nextPtr.addr > 0) ? nextPtr.addr : 0;
  }
  return slots;
}

// Insert a separator: pattern bytes as the name, attr $F8 (Closed +
// DRWX + ftype DEL — Closed keeps it visible and tells it apart from a
// scratched entry; without DRWX VICE marks the row read-only) and
// suffix "DEL", which VICE prints in the type column.
function cfsInsertSeparator(buffer, parentDirLba, patternBytes) {
  if (!buffer || !parentDirLba) return { ok: false, error: 'invalid arguments' };
  var data = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  var slot = cfsFindEmptyDirSlot(buffer, parentDirLba);
  if (!slot) return { ok: false, error: 'no empty directory slot' };
  var eo = slot.dirLba * IDE64_SECTOR_SIZE + slot.slotIndex * CFS_DIR_ENTRY_SIZE;
  if (eo + CFS_DIR_ENTRY_SIZE > data.length) return { ok: false, error: 'dir entry out of range' };

  var dirNextBits = data[eo + 0x14] & CFS_DIR_NEXT_BITS;
  for (var z = 0; z < CFS_DIR_ENTRY_SIZE; z++) data[eo + z] = 0;

  var pat = patternBytes || [];
  var pLen = pat.length;
  for (var i = 0; i < 16; i++) {
    data[eo + i] = i < pLen ? (pat[i] & 0xFF) : 0x00;
  }
  data[eo + 0x14] = dirNextBits;
  data[eo + 0x18] = 0xF8;
  data[eo + 0x19] = 0x44; // 'D'
  data[eo + 0x1A] = 0x45; // 'E'
  data[eo + 0x1B] = 0x4C; // 'L'
  cfsTouchEntryMtime(buffer, slot.dirLba, slot.slotIndex);

  return { ok: true, dirLba: slot.dirLba, slotIndex: slot.slotIndex };
}

// Insert an empty entry (size 0, no tree pointer, nothing allocated) into
// an existing free slot — the CBM-DOS "Insert File" analogue.
function cfsInsertPlaceholderEntry(buffer, parentDirLba, name, opts) {
  if (!buffer || !parentDirLba) return { ok: false, error: 'invalid arguments' };
  opts = opts || {};
  var data = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  var slot = cfsFindEmptyDirSlot(buffer, parentDirLba);
  if (!slot) return { ok: false, error: 'no empty directory slot' };
  var eo = slot.dirLba * IDE64_SECTOR_SIZE + slot.slotIndex * CFS_DIR_ENTRY_SIZE;
  if (eo + CFS_DIR_ENTRY_SIZE > data.length) return { ok: false, error: 'dir entry out of range' };

  var dirNextBits = data[eo + 0x14] & CFS_DIR_NEXT_BITS;
  for (var z = 0; z < CFS_DIR_ENTRY_SIZE; z++) data[eo + z] = 0;

  var nameStr = String(name || '');
  for (var n = 0; n < 16; n++) {
    data[eo + n] = n < nameStr.length ? (nameStr.charCodeAt(n) & 0xFF) : 0x00;
  }
  data[eo + 0x14] = dirNextBits;
  var ftype = (opts.ftype != null) ? opts.ftype : CFS_FTYPE.NORMAL;
  data[eo + 0x18] = 0xF8 | (ftype & 0x07);
  var suf = opts.typeSuffix || 'PRG';
  for (var s = 0; s < 3; s++) {
    data[eo + 0x19 + s] = s < suf.length ? (suf.charCodeAt(s) & 0xFF) : 0x20;
  }
  cfsTouchEntryMtime(buffer, slot.dirLba, slot.slotIndex);

  return { ok: true, dirLba: slot.dirLba, slotIndex: slot.slotIndex };
}

// Format a CFS partition the way cfsfdisk does: start+0 bitmap, +1
// reserved, +2 deldir, +3 root dir; every chunk's bitmap and companion
// sector, the last LBA and everything past it reserved.
// Returns { ok, rootDirLba, deletedDirLba, error? }.
function cfsInitPartitionStorage(buffer, partitionStart, partitionEndLba, partitionName) {
  if (!buffer) return { ok: false, error: 'invalid buffer' };
  var data = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  var deldirLba = partitionStart + 2;
  var rootdirLba = partitionStart + 3;
  if (rootdirLba > partitionEndLba) return { ok: false, error: 'partition too small for system area' };

  var bitmapCount = 0;
  for (var bm = 0; bm <= (partitionEndLba - partitionStart); bm += CFS_BITMAP_CHUNK) {
    var bitmapLba = partitionStart + bm;
    var bo = bitmapLba * IDE64_SECTOR_SIZE;
    if (bo + IDE64_SECTOR_SIZE > data.length) return { ok: false, error: 'partition extends past buffer' };
    for (var i = 0; i < IDE64_SECTOR_SIZE; i++) data[bo + i] = 0xFF;
    bitmapCount++;
  }

  // The companion sector stays zero-filled; cfsfdisk reserves it per chunk.
  for (var bm2 = 0; bm2 < bitmapCount; bm2++) {
    var bmpLba = partitionStart + bm2 * CFS_BITMAP_CHUNK;
    cfsMarkSectorUsed(buffer, partitionStart, bmpLba);
    cfsMarkSectorUsed(buffer, partitionStart, bmpLba + 1);
  }

  var lastBmStart = partitionStart + (bitmapCount - 1) * CFS_BITMAP_CHUNK;
  var coverageEnd = lastBmStart + CFS_BITMAP_CHUNK - 1;
  for (var pastLba = partitionEndLba + 1; pastLba <= coverageEnd; pastLba++) {
    cfsMarkSectorUsed(buffer, partitionStart, pastLba);
  }

  // Also protects the backup partition table when the partition ends on it.
  cfsMarkSectorUsed(buffer, partitionStart, partitionEndLba);

  cfsMarkSectorUsed(buffer, partitionStart, deldirLba);
  cfsMarkSectorUsed(buffer, partitionStart, rootdirLba);

  // Root dir, as cfsfdisk writes it: slot 0 self-ref (space-padded name,
  // self + parent pointers both = root, VALID|LBA, attr $3B), slot 1 the
  // %DELETED FILES% entry (attr $AB).
  var rootBase = rootdirLba * IDE64_SECTOR_SIZE;
  for (var rz = 0; rz < IDE64_SECTOR_SIZE; rz++) data[rootBase + rz] = 0;
  var pname = partitionName || 'PARTITION';
  for (var rn = 0; rn < 16; rn++) {
    data[rootBase + rn] = rn < pname.length ? (pname.charCodeAt(rn) & 0xFF) : 0x20;
  }
  data[rootBase + 0x10] = 0xC0 | ((rootdirLba >>> 24) & 0x0F);
  data[rootBase + 0x11] = (rootdirLba >>> 16) & 0xFF;
  data[rootBase + 0x12] = (rootdirLba >>> 8) & 0xFF;
  data[rootBase + 0x13] = rootdirLba & 0xFF;
  data[rootBase + 0x14] = 0xC0 | ((rootdirLba >>> 24) & 0x0F);
  data[rootBase + 0x15] = (rootdirLba >>> 16) & 0xFF;
  data[rootBase + 0x16] = (rootdirLba >>> 8) & 0xFF;
  data[rootBase + 0x17] = rootdirLba & 0xFF;
  data[rootBase + 0x18] = 0x3B;
  data[rootBase + 0x19] = 0x44; data[rootBase + 0x1A] = 0x49; data[rootBase + 0x1B] = 0x52;

  var dfBase = rootBase + CFS_DIR_ENTRY_SIZE;
  var dfName = '%DELETED  FILES%';
  for (var dfn = 0; dfn < 16; dfn++) data[dfBase + dfn] = dfName.charCodeAt(dfn) & 0xFF;
  data[dfBase + 0x14] = 0xC0 | ((deldirLba >>> 24) & 0x0F);
  data[dfBase + 0x15] = (deldirLba >>> 16) & 0xFF;
  data[dfBase + 0x16] = (deldirLba >>> 8) & 0xFF;
  data[dfBase + 0x17] = deldirLba & 0xFF;
  data[dfBase + 0x18] = 0xAB;
  data[dfBase + 0x19] = 0x44; data[dfBase + 0x1A] = 0x49; data[dfBase + 0x1B] = 0x52;

  // Deldir: self-ref only (parent = root, attr $2B).
  var delBase = deldirLba * IDE64_SECTOR_SIZE;
  for (var dz = 0; dz < IDE64_SECTOR_SIZE; dz++) data[delBase + dz] = 0;
  var delName = '%DELETED  FILES%';
  for (var dln = 0; dln < 16; dln++) data[delBase + dln] = delName.charCodeAt(dln) & 0xFF;
  data[delBase + 0x10] = 0xC0 | ((deldirLba >>> 24) & 0x0F);
  data[delBase + 0x11] = (deldirLba >>> 16) & 0xFF;
  data[delBase + 0x12] = (deldirLba >>> 8) & 0xFF;
  data[delBase + 0x13] = deldirLba & 0xFF;
  data[delBase + 0x14] = 0xC0 | ((rootdirLba >>> 24) & 0x0F);
  data[delBase + 0x15] = (rootdirLba >>> 16) & 0xFF;
  data[delBase + 0x16] = (rootdirLba >>> 8) & 0xFF;
  data[delBase + 0x17] = rootdirLba & 0xFF;
  data[delBase + 0x18] = 0x2B;
  data[delBase + 0x19] = 0x44; data[delBase + 0x1A] = 0x49; data[delBase + 0x1B] = 0x52;

  return { ok: true, rootDirLba: rootdirLba, deletedDirLba: deldirLba };
}

// LBA of the primary partition directory: the boot pointer at $18
// (normally 1), or 1 when that pointer is unusable.
function _cfsPartDirLba(data) {
  var p = _readIde64Pointer(data, 0x18);
  if (p.lba && p.addr > 0 && (p.addr + 1) * IDE64_SECTOR_SIZE <= data.length) return p.addr;
  return 1;
}

// Byte offset of partition-table slot `slotIdx`.
function _cfsPartEntryOffset(data, slotIdx) {
  return _cfsPartDirLba(data) * IDE64_SECTOR_SIZE + slotIdx * IDE64_PARTITION_ENTRY_SIZE;
}

// LBA of the backup partition directory (boot $1C), or null when unset,
// out of range or the same as the primary.
function _cfsReadBackupPartDirLba(data) {
  var p = _readIde64Pointer(data, 0x1C);
  if (!p.lba || p.addr === null || p.addr === 0) return null;
  if (p.addr === _cfsPartDirLba(data)) return null;
  var off = p.addr * IDE64_SECTOR_SIZE;
  if (off + IDE64_SECTOR_SIZE > data.length) return null;
  return p.addr;
}

// Every partition-table writer calls this so the backup never drifts.
function _cfsMirrorPartitionTableToBackup(data) {
  var backupLba = _cfsReadBackupPartDirLba(data);
  if (backupLba === null) return;
  var srcBase = _cfsPartDirLba(data) * IDE64_SECTOR_SIZE;
  var dstBase = backupLba * IDE64_SECTOR_SIZE;
  for (var i = 0; i < IDE64_SECTOR_SIZE; i++) data[dstBase + i] = data[srcBase + i];
}

// cfsfdisk's "u": copy the backup partition directory over the primary.
function cfsLoadBackupPartitionTable(buffer) {
  if (!buffer) return { ok: false, error: 'invalid buffer' };
  var data = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  var backupLba = _cfsReadBackupPartDirLba(data);
  if (backupLba === null) return { ok: false, error: 'No backup partition table pointer in boot sector' };
  var srcBase = backupLba * IDE64_SECTOR_SIZE;
  if (srcBase + IDE64_SECTOR_SIZE > data.length) return { ok: false, error: 'Backup LBA out of buffer' };
  var dstBase = _cfsPartDirLba(data) * IDE64_SECTOR_SIZE;
  for (var i = 0; i < IDE64_SECTOR_SIZE; i++) data[dstBase + i] = data[srcBase + i];
  return { ok: true };
}

// readIde64Partitions() of the backup table, without touching the buffer.
function readIde64BackupPartitions(buffer) {
  if (!buffer) return null;
  var data = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  var backupLba = _cfsReadBackupPartDirLba(data);
  if (backupLba === null) return null;
  var scratch = new Uint8Array(data);
  var srcBase = backupLba * IDE64_SECTOR_SIZE;
  if (srcBase + IDE64_SECTOR_SIZE > scratch.length) return null;
  var dstBase = _cfsPartDirLba(scratch) * IDE64_SECTOR_SIZE;
  for (var i = 0; i < IDE64_SECTOR_SIZE; i++) scratch[dstBase + i] = scratch[srcBase + i];
  return readIde64Partitions(scratch);
}

// Boot-sector disk label ($20..$2F), space-padded like cfsfdisk's "g".
function cfsSetHddLabel(buffer, newLabel) {
  if (!buffer) return { ok: false, error: 'invalid buffer' };
  var data = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  if (data.length < 0x30) return { ok: false, error: 'buffer too small for boot sector' };
  if (!isIde64Hdd(data)) return { ok: false, error: 'not an IDE64 .hdd image' };
  var s = newLabel || '';
  for (var i = 0; i < 16; i++) {
    data[0x20 + i] = i < s.length ? (s.charCodeAt(i) & 0xFF) : 0x20;
  }
  return { ok: true };
}

// Boot byte $03: IDEDOS bumps it on every partition scratch (a table
// generation stamp). Unverified for other edits, so only scratch and
// restore touch it.
function _cfsBumpPartTableGeneration(data) {
  data[0x03] = (data[0x03] + 1) & 0xFF;
}

// IDEDOS-style partition scratch: clear only VALID (start-ptr bit 7),
// bump $03. Everything else stays so cfsRestorePartition can undo it.
function cfsSoftDeletePartition(buffer, slotIdx) {
  if (slotIdx < 0 || slotIdx >= IDE64_PARTITION_ENTRIES) return { ok: false, error: 'invalid slot index' };
  var data = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  var eo = _cfsPartEntryOffset(data, slotIdx);
  if (eo + 0x11 > data.length) return { ok: false, error: 'partition table out of range' };
  if ((data[eo + 0x10] & 0x80) === 0) return { ok: false, error: 'partition is already deleted' };
  data[eo + 0x10] &= ~0x80;
  _cfsMirrorPartitionTableToBackup(data);
  _cfsBumpPartTableGeneration(data);
  return { ok: true };
}

// Inverse of cfsSoftDeletePartition. Refuses a slot with no type bits.
function cfsRestorePartition(buffer, slotIdx) {
  if (slotIdx < 0 || slotIdx >= IDE64_PARTITION_ENTRIES) return { ok: false, error: 'invalid slot index' };
  var data = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  var eo = _cfsPartEntryOffset(data, slotIdx);
  if (eo + IDE64_PARTITION_ENTRY_SIZE > data.length) return { ok: false, error: 'partition table out of range' };
  if ((data[eo + 0x10] & 0x80) !== 0) return { ok: false, error: 'partition is not deleted' };
  var endB0 = data[eo + 0x14];
  if ((endB0 & 0xB0) === 0) return { ok: false, error: 'partition entry has no type bits; cannot restore' };
  data[eo + 0x10] |= 0x80;
  _cfsMirrorPartitionTableToBackup(data);
  _cfsBumpPartTableGeneration(data);
  return { ok: true };
}

// Zero a partition-table slot (unrecoverable, unlike cfsSoftDeletePartition).
function cfsRemovePartitionEntry(buffer, slotIdx) {
  if (slotIdx < 0 || slotIdx >= IDE64_PARTITION_ENTRIES) return { ok: false, error: 'invalid slot index' };
  var data = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  var eo = _cfsPartEntryOffset(data, slotIdx);
  if (eo + IDE64_PARTITION_ENTRY_SIZE > data.length) return { ok: false, error: 'partition table out of range' };
  for (var z = 0; z < IDE64_PARTITION_ENTRY_SIZE; z++) data[eo + z] = 0;
  _cfsMirrorPartitionTableToBackup(data);
  return { ok: true };
}

// Default partition = boot byte $01.
function cfsSetDefaultPartition(buffer, slotIdx) {
  if (slotIdx < 0 || slotIdx >= IDE64_PARTITION_ENTRIES) return { ok: false, error: 'invalid slot index' };
  var data = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  if (data.length < 2) return { ok: false, error: 'buffer too small' };
  data[0x01] = slotIdx & 0xFF;
  return { ok: true };
}

// Set HIDDEN (bit 5) / WRITEABLE (bit 4) of the start-pointer byte.
function cfsWritePartitionFlags(buffer, slotIdx, hidden, writeable) {
  if (slotIdx < 0 || slotIdx >= IDE64_PARTITION_ENTRIES) return { ok: false, error: 'invalid slot index' };
  var data = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  var eo = _cfsPartEntryOffset(data, slotIdx);
  if (eo + 0x11 > data.length) return { ok: false, error: 'partition table out of range' };
  var startB0 = data[eo + 0x10];
  startB0 &= ~0x30;
  if (hidden) startB0 |= 0x20;
  if (writeable) startB0 |= 0x10;
  data[eo + 0x10] = startB0;
  _cfsMirrorPartitionTableToBackup(data);
  return { ok: true };
}

// Rename a partition ($A0-padded). newName is a string of byte values.
function cfsRenamePartition(buffer, slotIdx, newName) {
  if (slotIdx < 0 || slotIdx >= IDE64_PARTITION_ENTRIES) return { ok: false, error: 'invalid slot index' };
  var data = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  var eo = _cfsPartEntryOffset(data, slotIdx);
  if (eo + 16 > data.length) return { ok: false, error: 'partition table out of range' };
  for (var i = 0; i < 16; i++) {
    data[eo + i] = i < newName.length ? (newName.charCodeAt(i) & 0xFF) : 0xA0;
  }
  _cfsMirrorPartitionTableToBackup(data);
  return { ok: true };
}

// Write a partition-table entry as IDEDOS / current cfsfdisk do: name
// $A0-padded, start ptr VALID|LBA|WRITEABLE ($D0), end ptr LBA + TYPE in
// bits 7/5/4, deldir and root-dir ptrs LBA-only ($40).
function cfsAddPartitionToTable(buffer, slotIdx, partitionName, startLba, endLba, rootDirLba, deldirLba, type) {
  if (slotIdx < 0 || slotIdx >= IDE64_PARTITION_ENTRIES) return { ok: false, error: 'invalid slot index' };
  var data = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  var eo = _cfsPartEntryOffset(data, slotIdx);
  if (eo + IDE64_PARTITION_ENTRY_SIZE > data.length) return { ok: false, error: 'partition table out of range' };
  for (var z = 0; z < IDE64_PARTITION_ENTRY_SIZE; z++) data[eo + z] = 0;

  for (var n = 0; n < 16; n++) {
    data[eo + n] = n < partitionName.length ? (partitionName.charCodeAt(n) & 0xFF) : 0xA0;
  }
  data[eo + 0x10] = 0xD0 | ((startLba >>> 24) & 0x0F);
  data[eo + 0x11] = (startLba >>> 16) & 0xFF;
  data[eo + 0x12] = (startLba >>> 8) & 0xFF;
  data[eo + 0x13] = startLba & 0xFF;
  var t = type != null ? type : 0x01;
  var typeBits = ((t & 0x01) ? 0x10 : 0) | ((t & 0x02) ? 0x20 : 0) | ((t & 0x04) ? 0x80 : 0);
  data[eo + 0x14] = 0x40 | typeBits | ((endLba >>> 24) & 0x0F);
  data[eo + 0x15] = (endLba >>> 16) & 0xFF;
  data[eo + 0x16] = (endLba >>> 8) & 0xFF;
  data[eo + 0x17] = endLba & 0xFF;
  data[eo + 0x18] = 0x40 | ((deldirLba >>> 24) & 0x0F);
  data[eo + 0x19] = (deldirLba >>> 16) & 0xFF;
  data[eo + 0x1A] = (deldirLba >>> 8) & 0xFF;
  data[eo + 0x1B] = deldirLba & 0xFF;
  data[eo + 0x1C] = 0x40 | ((rootDirLba >>> 24) & 0x0F);
  data[eo + 0x1D] = (rootDirLba >>> 16) & 0xFF;
  data[eo + 0x1E] = (rootDirLba >>> 8) & 0xFF;
  data[eo + 0x1F] = rootDirLba & 0xFF;
  _cfsMirrorPartitionTableToBackup(data);
  return { ok: true };
}

// Fresh .hdd of `sizeMib` with one CFS partition over LBA 2..end; the
// last LBA doubles as the backup partition table.
function createEmptyHdd(sizeMib, opts) {
  opts = opts || {};
  var label = opts.label || 'IDE64 HDD';
  var partitionName = opts.partitionName || 'PARTITION';
  var totalLbas = Math.floor(sizeMib * 1024 * 1024 / IDE64_SECTOR_SIZE);
  if (totalLbas < 10) return null;
  var buf = new ArrayBuffer(totalLbas * IDE64_SECTOR_SIZE);
  var d = new Uint8Array(buf);

  d[0x01] = 0; // default partition
  // $04: LBA count, read by cfsfdisk's geometry check and emulator auto-detect.
  d[0x04] = 0x40 | ((totalLbas >>> 24) & 0x0F);
  d[0x05] = (totalLbas >>> 16) & 0xFF;
  d[0x06] = (totalLbas >>> 8) & 0xFF;
  d[0x07] = totalLbas & 0xFF;
  for (var mi = 0; mi < IDE64_MAGIC_STRING.length; mi++) {
    d[IDE64_MAGIC_OFFSET + mi] = IDE64_MAGIC_STRING.charCodeAt(mi);
  }
  // Primary partition directory at LBA 1, backup at the last LBA.
  d[0x18] = 0x40; d[0x19] = 0x00; d[0x1A] = 0x00; d[0x1B] = 0x01;
  var backupLba = totalLbas - 1;
  d[0x1C] = 0x40 | ((backupLba >>> 24) & 0x0F);
  d[0x1D] = (backupLba >>> 16) & 0xFF;
  d[0x1E] = (backupLba >>> 8) & 0xFF;
  d[0x1F] = backupLba & 0xFF;
  for (var li = 0; li < 16; li++) {
    d[0x20 + li] = li < label.length ? (label.charCodeAt(li) & 0xFF) : 0x20;
  }
  // PC MBR entry: type $CF from LBA 1, CHS = FF FF FF ("use LBA").
  d[0x1BE] = 0x00;
  d[0x1BF] = 0xFF; d[0x1C0] = 0xFF; d[0x1C1] = 0xFF;
  d[0x1C2] = 0xCF;
  d[0x1C3] = 0xFF; d[0x1C4] = 0xFF; d[0x1C5] = 0xFF;
  d[0x1C6] = 0x01; d[0x1C7] = 0x00; d[0x1C8] = 0x00; d[0x1C9] = 0x00;
  var sectorCount = totalLbas - 1;
  d[0x1CA] = sectorCount & 0xFF;
  d[0x1CB] = (sectorCount >>> 8) & 0xFF;
  d[0x1CC] = (sectorCount >>> 16) & 0xFF;
  d[0x1CD] = (sectorCount >>> 24) & 0xFF;
  d[0x1FE] = 0x55; d[0x1FF] = 0xAA;

  var partStart = 2;
  var partEnd = totalLbas - 1;
  var initRes = cfsInitPartitionStorage(buf, partStart, partEnd, partitionName);
  if (!initRes.ok) return null;
  var addRes = cfsAddPartitionToTable(buf, 0, partitionName, partStart, partEnd, initRes.rootDirLba, initRes.deletedDirLba);
  if (!addRes.ok) return null;
  return buf;
}

// Create a subdirectory, following ide.hdd's conventions: the new sector's
// slot 0 self-ref (space-padded name, self + parent ptrs LBA-only, attr
// $7B — no Closed bit) and an outgoing entry in the parent ($00-padded
// name, attr $FB).
function cfsCreateSubdir(buffer, partitionStart, partitionEndLba, parentDirLba, name) {
  if (!buffer || !parentDirLba) return { ok: false, error: 'invalid args' };
  if (!name || name.length === 0) return { ok: false, error: 'empty name' };

  var slot = _cfsFindOrExtendDirSlot(buffer, partitionStart, partitionEndLba, parentDirLba);
  if (slot.error) return { ok: false, error: slot.error };
  var data = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);

  var newDirLba = cfsAllocSector(buffer, partitionStart, partitionEndLba, parentDirLba + 1);
  if (newDirLba < 0) {
    if (slot.newSectorAllocated >= 0) cfsMarkSectorFree(buffer, partitionStart, slot.newSectorAllocated);
    if (slot.extendedFromLba >= 0) _cfsWriteDirNext(data, slot.extendedFromLba * IDE64_SECTOR_SIZE, 0);
    return { ok: false, error: 'no free sector for new directory' };
  }

  var newDirBase = newDirLba * IDE64_SECTOR_SIZE;
  for (var z = 0; z < IDE64_SECTOR_SIZE; z++) data[newDirBase + z] = 0;
  for (var n = 0; n < 16; n++) {
    data[newDirBase + n] = n < name.length ? (name.charCodeAt(n) & 0xFF) : 0x20;
  }
  data[newDirBase + 0x10] = 0x40 | ((newDirLba >>> 24) & 0x0F);
  data[newDirBase + 0x11] = (newDirLba >>> 16) & 0xFF;
  data[newDirBase + 0x12] = (newDirLba >>> 8) & 0xFF;
  data[newDirBase + 0x13] = newDirLba & 0xFF;
  data[newDirBase + 0x14] = 0x40 | ((parentDirLba >>> 24) & 0x0F);
  data[newDirBase + 0x15] = (parentDirLba >>> 16) & 0xFF;
  data[newDirBase + 0x16] = (parentDirLba >>> 8) & 0xFF;
  data[newDirBase + 0x17] = parentDirLba & 0xFF;
  data[newDirBase + 0x18] = 0x7B;
  data[newDirBase + 0x19] = 0x44; // D
  data[newDirBase + 0x1A] = 0x49; // I
  data[newDirBase + 0x1B] = 0x52; // R

  var po = slot.dirLba * IDE64_SECTOR_SIZE + slot.slotIndex * CFS_DIR_ENTRY_SIZE;
  var dirNextBits = data[po + 0x14] & CFS_DIR_NEXT_BITS;
  for (var pz = 0; pz < CFS_DIR_ENTRY_SIZE; pz++) data[po + pz] = 0;
  for (var nn = 0; nn < 16 && nn < name.length; nn++) {
    data[po + nn] = name.charCodeAt(nn) & 0xFF;
  }
  data[po + 0x14] = 0x40 | dirNextBits | ((newDirLba >>> 24) & 0x0F); // no VALID bit (VICE)
  data[po + 0x15] = (newDirLba >>> 16) & 0xFF;
  data[po + 0x16] = (newDirLba >>> 8) & 0xFF;
  data[po + 0x17] = newDirLba & 0xFF;
  data[po + 0x18] = 0xFB;
  data[po + 0x19] = 0x44;
  data[po + 0x1A] = 0x49;
  data[po + 0x1B] = 0x52;
  cfsTouchEntryMtime(buffer, slot.dirLba, slot.slotIndex);

  return { ok: true, dirLba: slot.dirLba, slotIndex: slot.slotIndex, newDirLba: newDirLba };
}

// ── Recursive directory copy (clipboard tree) ────────────────────────
// Collect a directory into { nameBytes, files: [{ nameBytes, ftype,
// typeSuffix, payload, size }], subdirs: [same shape], skippedLnks }.
// LNKs are skipped (their targets rarely resolve elsewhere) and reported.
function cfsCollectDirTree(buffer, sourceDirLba, sourceNameBytes) {
  if (!buffer) return { ok: false, error: 'invalid buffer' };
  if (!sourceDirLba) return { ok: false, error: 'invalid dir lba' };
  var data = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  var visited = {};
  var skippedLnksAll = [];

  function rawNameBytes(entry) {
    var off = entry.dirLba * IDE64_SECTOR_SIZE + entry.index * CFS_DIR_ENTRY_SIZE;
    var out = new Uint8Array(16);
    for (var i = 0; i < 16; i++) out[i] = data[off + i];
    return out;
  }

  function walk(dirLba, nameBytes) {
    if (visited[dirLba]) return { error: 'directory cycle at LBA ' + dirLba };
    visited[dirLba] = true;
    var node = { nameBytes: nameBytes, files: [], subdirs: [], skippedLnks: [] };
    var entries = readCfsDirectory(data, dirLba);
    if (!entries) return { error: 'unreadable directory at LBA ' + dirLba };
    for (var i = 0; i < entries.length; i++) {
      var en = entries[i];
      if (!en || en.empty) continue;
      if (en.isSelfRef) continue;
      if (typeof _cfsEntryIsDeldirRef === 'function' && _cfsEntryIsDeldirRef(en)) continue;
      if (en.ftype === CFS_FTYPE.DEL) continue;
      var dispName = (typeof petsciiToReadable === 'function' ? petsciiToReadable(en.name || '') : (en.name || '')).trim();
      if (en.ftype === CFS_FTYPE.LNK) {
        node.skippedLnks.push(dispName || '?');
        skippedLnksAll.push(dispName || '?');
        continue;
      }
      if (en.ftype === CFS_FTYPE.DIR) {
        if (!en.dataTreePtr || !en.dataTreePtr.lba) continue;
        var sub = walk(en.dataTreePtr.addr, rawNameBytes(en));
        if (sub.error) return { error: sub.error };
        node.subdirs.push(sub.node);
        continue;
      }
      // A file without a tree pointer is empty (cfsInsertPlaceholderEntry).
      var hasTree = en.dataTreePtr && en.dataTreePtr.lba;
      var rd = hasTree ? readCfsFileData(data, en.dataTreePtr.addr, en.size || 0) : { data: new Uint8Array(0), error: null };
      if (rd.error) return { error: 'reading file "' + dispName + '": ' + rd.error };
      node.files.push({
        nameBytes: rawNameBytes(en),
        ftype: en.ftype,
        typeSuffix: en.typeSuffix || 'PRG',
        payload: rd.data,
        size: rd.data.length,
      });
    }
    return { node: node };
  }

  var res = walk(sourceDirLba, sourceNameBytes);
  if (res.error) return { ok: false, error: res.error };
  return { ok: true, tree: res.node, skippedLnks: skippedLnksAll };
}

// Upper bound on the sectors pasting `tree` needs: every dir's chain
// (self-ref + one slot per child, 16 per sector), each file's data
// sectors, and its tree nodes (1 + 8 + 64 + … up to its depth).
function cfsEstimateTreeSectors(tree) {
  if (!tree) return 0;
  var total = 0;
  function visit(node, isRoot) {
    if (isRoot) total += 1;
    var slots = 1 + node.files.length + node.subdirs.length;
    total += Math.max(0, Math.ceil(slots / CFS_DIR_ENTRIES_PER_SECTOR) - 1);
    for (var f = 0; f < node.files.length; f++) {
      var sz = node.files[f].size || 0;
      if (sz <= 0) continue;
      total += Math.ceil(sz / IDE64_SECTOR_SIZE);
      var depth = _cfsComputeTreeDepth(sz);
      var levelSize = 1;
      for (var L = 0; L <= depth; L++) { total += levelSize; levelSize *= 8; }
    }
    for (var s = 0; s < node.subdirs.length; s++) {
      total += 1;
      visit(node.subdirs[s], false);
    }
  }
  visit(tree, true);
  return total;
}

function cfsCountFreeSectors(buffer, partitionStart, partitionEndLba) {
  if (!buffer) return 0;
  var data = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  var n = 0;
  for (var lba = partitionStart; lba <= partitionEndLba; lba++) {
    if (cfsIsSectorFree(data, partitionStart, lba)) n++;
  }
  return n;
}

// Live entry whose name matches `nameBytes` ($A0 / $00 / trailing-space
// padding all equivalent), or null. Scratched entries and separators
// don't count — they can be shadowed without a conflict.
function _cfsFindDirEntryByNameBytes(buffer, dirLba, nameBytes) {
  if (!buffer || !dirLba) return null;
  var entries = readCfsDirectory(buffer, dirLba);
  if (!entries) return null;
  function effectiveLen(b) {
    for (var i = 0; i < 16; i++) {
      if (b[i] === 0xA0 || b[i] === 0x00) return i;
    }
    return 16;
  }
  function trimTrailingSpaces(b, n) {
    while (n > 0 && b[n - 1] === 0x20) n--;
    return n;
  }
  var srcLen = trimTrailingSpaces(nameBytes, effectiveLen(nameBytes));
  if (srcLen === 0) return null;
  var data = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  for (var i = 0; i < entries.length; i++) {
    var en = entries[i];
    if (!en || en.empty) continue;
    if (en.isSelfRef || en.ftype === CFS_FTYPE.DEL) continue;
    var off = en.dirLba * IDE64_SECTOR_SIZE + en.index * CFS_DIR_ENTRY_SIZE;
    var enBytes = new Uint8Array(16);
    for (var j = 0; j < 16; j++) enBytes[j] = data[off + j];
    var enLen = trimTrailingSpaces(enBytes, effectiveLen(enBytes));
    if (enLen !== srcLen) continue;
    var match = true;
    for (var k = 0; k < srcLen; k++) {
      if (enBytes[k] !== nameBytes[k]) { match = false; break; }
    }
    if (match) return en;
  }
  return null;
}

// First free "NAME (N)" for N = 2..99 (base truncated to fit 16 bytes),
// $A0-padded, or null.
function _cfsAutoRenameInDir(buffer, parentDirLba, baseNameBytes) {
  if (!buffer || !parentDirLba) return null;
  var baseLen = 16;
  for (var i = 0; i < 16; i++) {
    if (baseNameBytes[i] === 0xA0 || baseNameBytes[i] === 0x00) { baseLen = i; break; }
  }
  while (baseLen > 0 && baseNameBytes[baseLen - 1] === 0x20) baseLen--;
  for (var n = 2; n <= 99; n++) {
    var suffix = ' (' + n + ')';
    var suffixLen = suffix.length;
    var maxBase = 16 - suffixLen;
    var keep = Math.min(baseLen, maxBase);
    if (keep <= 0) return null;
    var candidate = new Uint8Array(16);
    for (var b = 0; b < keep; b++) candidate[b] = baseNameBytes[b];
    for (var s = 0; s < suffixLen; s++) candidate[keep + s] = suffix.charCodeAt(s);
    for (var p = keep + suffixLen; p < 16; p++) candidate[p] = 0xA0;
    if (!_cfsFindDirEntryByNameBytes(buffer, parentDirLba, candidate)) return candidate;
  }
  return null;
}

// Paste a collected `tree` into destDirLba. opts.onConflict on a name
// clash: 'overwrite' merges (same-named files replaced), 'rename' adds
// " (N)", 'cancel' refuses.
// Returns { ok, error?, copiedFiles, copiedDirs, skippedLnks, finalNameBytes }.
function cfsPasteDirTree(buffer, partitionStart, partitionEndLba, destDirLba, tree, opts) {
  if (!buffer || !tree) return { ok: false, error: 'invalid args' };
  opts = opts || {};
  var onConflict = opts.onConflict || 'cancel';
  var data = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);

  var stats = { copiedFiles: 0, copiedDirs: 0, skippedLnks: [] };

  var topNameBytes = tree.nameBytes;
  var existing = _cfsFindDirEntryByNameBytes(buffer, destDirLba, topNameBytes);
  var targetDirLba = null;
  var finalNameBytes = topNameBytes;
  function _displayName(bytes) {
    var s = '';
    for (var i = 0; i < 16; i++) {
      var b = bytes[i];
      if (b === 0xA0 || b === 0x00) break;
      if (b >= 0xC1 && b <= 0xDA) s += String.fromCharCode(b - 0x80);
      else if (b >= 0x20 && b <= 0x7E) s += String.fromCharCode(b);
      else s += '?';
    }
    return s.replace(/ +$/, '');
  }
  if (existing && onConflict !== 'overwrite' && onConflict !== 'rename') {
    return { ok: false, error: 'A "' + _displayName(topNameBytes) + '" already exists; choose Overwrite or Rename.' };
  }
  if (existing && existing.ftype !== CFS_FTYPE.DIR && onConflict === 'overwrite') {
    return { ok: false, error: 'Destination has a non-directory entry with the same name; cannot overwrite.' };
  }
  if (existing && onConflict === 'rename') {
    var renamed = _cfsAutoRenameInDir(buffer, destDirLba, topNameBytes);
    if (!renamed) return { ok: false, error: 'All " (N)" rename suffixes 2..99 are taken; choose a different destination.' };
    finalNameBytes = renamed;
    existing = null;
  }
  if (existing && existing.ftype === CFS_FTYPE.DIR && onConflict === 'overwrite') {
    targetDirLba = existing.dataTreePtr.addr;
  } else {
    var topNameStr = '';
    for (var ti = 0; ti < 16; ti++) {
      var nb = finalNameBytes[ti];
      if (nb === 0xA0 || nb === 0x00) break;
      topNameStr += String.fromCharCode(nb);
    }
    var created = cfsCreateSubdir(buffer, partitionStart, partitionEndLba, destDirLba, topNameStr);
    if (!created.ok) return { ok: false, error: 'creating dir: ' + (created.error || 'unknown') };
    targetDirLba = created.newDirLba;
  }
  stats.copiedDirs++;

  function recurse(srcNode, dstDirLba, mode) {
    for (var fi = 0; fi < srcNode.files.length; fi++) {
      var f = srcNode.files[fi];
      var fName = '';
      for (var fn = 0; fn < 16; fn++) {
        var fb = f.nameBytes[fn];
        if (fb === 0xA0 || fb === 0x00) break;
        fName += String.fromCharCode(fb);
      }
      // GEOS files need the (undocumented) CFS GEOS-partition layout.
      if (f.vlirRecords || f.geosInfoBlock) {
        stats.skippedLnks.push(fName + ' (GEOS file — CFS GEOS partition layout not yet supported)');
        continue;
      }
      if (mode === 'overwrite') {
        var conflict = _cfsFindDirEntryByNameBytes(buffer, dstDirLba, f.nameBytes);
        if (conflict && conflict.ftype !== CFS_FTYPE.DIR) {
          cfsRemoveDirEntry(buffer, partitionStart, partitionEndLba, conflict, dstDirLba);
        } else if (conflict && conflict.ftype === CFS_FTYPE.DIR) {
          return { ok: false, error: 'Cannot overwrite file "' + fName + '" — destination has a directory with the same name.' };
        }
      }
      var cfsType = resolveFileCfsTypeFields(f);
      var imp = cfsImportFile(buffer, partitionStart, partitionEndLba, dstDirLba, fName, f.payload, {
        ftype: cfsType.ftype,
        typeSuffix: cfsType.typeSuffix,
      });
      if (!imp.ok) return { ok: false, error: 'importing "' + fName + '": ' + (imp.error || 'unknown') };
      stats.copiedFiles++;
    }
    for (var si = 0; si < srcNode.subdirs.length; si++) {
      var sub = srcNode.subdirs[si];
      var subName = '';
      for (var sn = 0; sn < 16; sn++) {
        var sb = sub.nameBytes[sn];
        if (sb === 0xA0 || sb === 0x00) break;
        subName += String.fromCharCode(sb);
      }
      var subTargetLba = null;
      if (mode === 'overwrite') {
        var subConflict = _cfsFindDirEntryByNameBytes(buffer, dstDirLba, sub.nameBytes);
        if (subConflict && subConflict.ftype === CFS_FTYPE.DIR) {
          subTargetLba = subConflict.dataTreePtr.addr;
        } else if (subConflict) {
          return { ok: false, error: 'Cannot merge dir "' + subName + '" — destination has a non-directory entry with the same name.' };
        }
      }
      if (subTargetLba === null) {
        var subCreated = cfsCreateSubdir(buffer, partitionStart, partitionEndLba, dstDirLba, subName);
        if (!subCreated.ok) return { ok: false, error: 'creating subdir "' + subName + '": ' + (subCreated.error || 'unknown') };
        subTargetLba = subCreated.newDirLba;
      }
      stats.copiedDirs++;
      var r = recurse(sub, subTargetLba, mode);
      if (r && !r.ok) return r;
    }
    for (var li = 0; li < srcNode.skippedLnks.length; li++) {
      stats.skippedLnks.push(srcNode.skippedLnks[li]);
    }
    return { ok: true };
  }

  var r = recurse(tree, targetDirLba, existing ? 'overwrite' : 'fresh');
  if (!r.ok) return r;
  return {
    ok: true,
    copiedFiles: stats.copiedFiles,
    copiedDirs: stats.copiedDirs,
    skippedLnks: stats.skippedLnks,
    finalNameBytes: finalNameBytes,
  };
}

// Resolve a slash-separated path from startDirLba to its entry, or null.
function cfsResolvePath(buffer, startDirLba, path) {
  if (!buffer || !path) return null;
  var parts = path.split('/').filter(function(p) { return p.length > 0; });
  if (parts.length === 0) return null;
  var dirLba = startDirLba;
  var found = null;
  for (var i = 0; i < parts.length; i++) {
    var entries = readCfsDirectory(buffer, dirLba);
    if (!entries) return null;
    // Entry names are PUA-PETSCII; compare both sides in readable form.
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

// All entries of a dir chain (up to CFS_MAX_DIR_SECTORS sectors), each
// tagged with its dirLba; only the first sector's slot 0 is the self-ref.
function readCfsDirectory(buffer, firstDirLba) {
  if (!buffer || !firstDirLba) return null;
  var data = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  var allEntries = [];
  var visited = {};
  var dirLba = firstDirLba;
  var sectorCount = 0;
  while (dirLba && !visited[dirLba] && sectorCount < CFS_MAX_DIR_SECTORS) {
    visited[dirLba] = true;
    sectorCount++;
    var entries = readCfsDirectorySector(buffer, dirLba);
    if (!entries) break;
    for (var i = 0; i < entries.length; i++) {
      entries[i].dirLba = dirLba;
      entries[i].sectorIndex = sectorCount - 1;
      if (sectorCount > 1) entries[i].isSelfRef = false;
      allEntries.push(entries[i]);
    }
    var nextPtr = _cfsReadDirNext(data, dirLba * IDE64_SECTOR_SIZE);
    dirLba = (nextPtr.lba && nextPtr.addr > 0) ? nextPtr.addr : 0;
  }
  return allEntries;
}

// Parse one dir sector into 16 entries ({ index, empty: true } for unused
// slots). Slot 0 is flagged isSelfRef; readCfsDirectory clears that on
// later sectors.
function readCfsDirectorySector(buffer, dirLba) {
  if (!buffer) return null;
  var data = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  var base = dirLba * IDE64_SECTOR_SIZE;
  if (base < 0 || base + IDE64_SECTOR_SIZE > data.length) return null;

  var entries = [];
  for (var i = 0; i < CFS_DIR_ENTRIES_PER_SECTOR; i++) {
    var off = base + i * CFS_DIR_ENTRY_SIZE;
    if (_cfsSlotIsEmpty(data, off)) {
      entries.push({ index: i, empty: true });
      continue;
    }

    var nameBytes = [];
    for (var n = 0; n < 16; n++) nameBytes.push(data[off + n]);
    // Trim padding at byte level: decoded PUA chars don't match \s.
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
    // IDEDOS scratch only clears VALID, so a typed slot without it is
    // soft-deleted (restorable); no type at all means empty.
    var empty = type === 0x00;
    var deleted = !empty && !startValid;

    var startLba = startPtr.lba ? startPtr.addr : null;
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
      cfsDeletedDir: _readIde64Pointer(data, off + 0x18),
      cfsRootDir:    _readIde64Pointer(data, off + 0x1C),
    });
  }

  return {
    label: boot.label,
    defaultPart: boot.defaultPart,
    partDir: boot.partDir,
    partDirBackup: boot.partDirBackup,
    partitions: partitions,
  };
}
