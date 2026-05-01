// ── Type Definitions (JSDoc) ──────────────────────────────────────────

/**
 * @typedef {Object} DiskFormat
 * @property {string} name - Display name (e.g., 'D64')
 * @property {string} ext - File extension (e.g., '.d64')
 * @property {number} dirTrack - Root directory track
 * @property {number} dirSector - Root directory sector
 * @property {number} headerTrack - Disk header track (name/ID)
 * @property {number} headerSector - Disk header sector
 * @property {number} bamTrack - BAM track
 * @property {number} bamSector - BAM sector
 * @property {number[][]} bamSectors - All BAM sector locations [[t,s], ...]
 * @property {number} dosVersion - DOS version byte
 * @property {string} dosType - 2-char DOS type string
 * @property {number} nameOffset - Offset within header sector for disk name
 * @property {number} nameLength - Disk name length
 * @property {number} idOffset - Offset within header sector for disk ID
 * @property {number} idLength - ID + DOS type length
 * @property {number} maxDirSectors - Max directory sectors
 * @property {number} entriesPerSector - Directory entries per sector (8)
 * @property {number} entrySize - Bytes per directory entry (32)
 * @property {number} defaultInterleave - Default file data interleave
 * @property {boolean} hasBamFreeCounts - Whether BAM has per-track free counts
 * @property {(t: number) => number} sectorsPerTrack - Sectors on a given track
 * @property {(numTracks: number) => number} bamTracksRange - Max track in BAM
 * @property {(data: Uint8Array, bamOff: number, track: number) => number} readTrackFree
 * @property {(data: Uint8Array, bamOff: number, track: number, free: number) => void} writeTrackFree
 * @property {(data: Uint8Array, bamOff: number, numTracks: number) => void} initBAM
 * @property {(sector: number) => number} bamBitMask - Bit mask for a sector in BAM byte
 * @property {(track: number) => number[]} getProtectedSectors - System sectors on a track
 * @property {(track: number) => Object<number, boolean>} [getSkipTracks] - Tracks to skip during allocation
 */

/**
 * @typedef {Object} FileReadResult
 * @property {Uint8Array} data - File contents (including 2-byte load address for PRG)
 * @property {?string} error - Error message or null on success
 */

/**
 * @typedef {Object} DiskInfo
 * @property {string} diskName - Disk name (PETSCII/PUA)
 * @property {string} diskId - Disk ID string
 * @property {number} freeBlocks - Free blocks from BAM
 * @property {DirEntry[]} entries - Directory entries
 */

/**
 * @typedef {Object} DirEntry
 * @property {string} name - File name (PETSCII/PUA)
 * @property {string} type - Formatted type string (" PRG ", "*SEQ<", etc.)
 * @property {number} blocks - Block count from directory
 * @property {boolean} deleted - Whether entry is scratched
 * @property {number} entryOff - Byte offset in buffer
 */

/**
 * @typedef {Object} BAMIntegrityResult
 * @property {Object<string, string>} sectorOwner - "track:sector" → owner name
 * @property {string[]} bamErrors - Free count mismatches per track
 * @property {number} allocMismatch - Sectors owned by files but marked free
 * @property {number} orphanCount - Sectors marked used but not owned
 * @property {Object<number, boolean>} errorTracks - Tracks with BAM errors
 * @property {Object<string, boolean>} errorSectors - Sectors free but used by file
 * @property {Object<string, boolean>} orphanSectors - Sectors used but not owned
 */

// ── CMD native-partition BAM helpers (DNP / D1M / D2M / D4M) ─────────
// All four formats share the same on-disk BAM layout:
//   - Header at track 1 sector 2 (32 bytes), then 32-byte slots for tracks 1-7.
//   - Sectors 3, 4, ... hold 8 tracks each (32 bytes per track, no header).
//   - Bitmap is MSB-first (opposite of D64/D71/D81).
// The only difference between formats is sectorsPerTrack, so read/write BAM
// helpers can be shared.
function _cmdBamBase(track) {
  var bamSec = 2 + (track >> 3);
  var bamByteOff = (track & 7) * 32;
  return sectorOffset(1, bamSec) + bamByteOff;
}
function _cmdIsSectorFree(data, bamOff, track, sector) {
  var base = this._bamBase(track);
  if (base < 0 || base + 32 > data.length) return false;
  return (data[base + (sector >> 3)] & (0x80 >> (sector & 7))) !== 0;
}
function _cmdReadTrackFree(data, bamOff, track) {
  var base = this._bamBase(track);
  if (base < 0 || base + 32 > data.length) return 0;
  var numBytes = Math.ceil(this.sectorsPerTrack(track) / 8);
  var free = 0;
  for (var i = 0; i < numBytes; i++) {
    var b = data[base + i];
    while (b) { free += b & 1; b >>= 1; }
  }
  return free;
}
// DNP track 1 has sectors 0-63 reserved for filesystem overhead: boot, header,
// 32-sector BAM area (covers up to 255 tracks), dir start (S$22), and 29
// pre-reserved sectors for dir-chain growth. CMD HD's "blocks free" excludes
// those 64 sectors regardless of bitmap state — so skip the first 8 bitmap
// bytes (sectors 0-63) when totalling free blocks for the dir track.
function _dnpReadTrackFree(data, bamOff, track) {
  var base = this._bamBase(track);
  if (base < 0 || base + 32 > data.length) return 0;
  var startByte = (track === this.dirTrack) ? 8 : 0;
  var free = 0;
  for (var i = startByte; i < 32; i++) {
    var b = data[base + i];
    while (b) { free += b & 1; b >>= 1; }
  }
  return free;
}
function _cmdReadTrackBitmap(data, bamOff, track) {
  var base = this._bamBase(track);
  if (base < 0 || base + 32 > data.length) return 0;
  return data[base] | (data[base+1] << 8) | (data[base+2] << 16) | ((data[base+3] << 24) >>> 0);
}
function _cmdNoop() {}

// ── CMD FD BAM helpers (D1M/D2M/D4M) ──────────────────────────────────
// FD2000/FD4000 native filesystems use a more compact BAM than DNP —
// instead of one 32-byte slot per *physical* track, one slot per
// *logical* 256-LBA track is packed contiguously from T1/S2 +0x20,
// with byte +0x08 of T1/S2 holding the logical-track count.
//
// Free-block calculation, verified against five samples (empty d1m/
// d2m/d4m + game(d2m)/game(d4m)):
//   1. effective_slots: usually equals byte +0x08, but a half-formatted
//      disk (game(d2m).d2m) can carry a "system marker" slot at the end
//      with 16 FF + 16 zero — that slot is excluded.
//   2. First 8 bytes of slot 0 are skipped — sectors 0..63 of T1 are
//      reserved overhead (header / BAM / dir-start), exactly mirroring
//      DNP's _dnpReadTrackFree convention.
function _fdBamBase(track) {
  return sectorOffset(1, 2) + 32 + (track - 1) * 32;
}
function _fdLogicalTrackCount(data) {
  var hdr = sectorOffset(1, 2);
  if (hdr < 0 || hdr + 0x09 > data.length) return 0;
  return data[hdr + 0x08];
}
// "System marker" detection: a slot of 16 0xFF bytes followed by 16 0x00
// bytes signals a half-formatted disk's reserved tail. Only the last
// slot is checked; regular data slots can never have this exact shape
// for a fresh disk, and a used disk's last slot is unlikely to as well.
function _fdLastSlotIsSystemMarker(data, hdrOff, n) {
  var off = hdrOff + 0x20 + (n - 1) * 32;
  if (off + 32 > data.length) return false;
  for (var i = 0; i < 16; i++) if (data[off + i] !== 0xFF) return false;
  for (var j = 16; j < 32; j++) if (data[off + j] !== 0x00) return false;
  return true;
}
function _fdEffectiveSlots(data) {
  var hdr = sectorOffset(1, 2);
  var n = _fdLogicalTrackCount(data);
  if (n === 0 || hdr < 0) return 0;
  return _fdLastSlotIsSystemMarker(data, hdr, n) ? n - 1 : n;
}
function _fdIsSectorFree(data, bamOff, track, sector) {
  if (track > _fdEffectiveSlots(data)) return false;
  var base = this._bamBase(track);
  if (base < 0 || base + 32 > data.length) return false;
  return (data[base + (sector >> 3)] & (0x80 >> (sector & 7))) !== 0;
}
function _fdReadTrackFree(data, bamOff, track) {
  if (track > _fdEffectiveSlots(data)) return 0;
  var base = this._bamBase(track);
  if (base < 0 || base + 32 > data.length) return 0;
  // Track 1 (slot 0): skip first 8 bytes (sectors 0..63 are reserved
  // T1 overhead — header / BAM / dir-start — matching DNP convention).
  var startByte = (track === 1) ? 8 : 0;
  var free = 0;
  for (var i = startByte; i < 32; i++) {
    var b = data[base + i];
    while (b) { free += b & 1; b >>= 1; }
  }
  return free;
}

// ── Disk Format Descriptors ───────────────────────────────────────────
// Each format defines its geometry, BAM layout, and directory structure.
// Adding D71/D81 support = adding a new descriptor + format-specific BAM functions.

const DISK_FORMATS = {
  d64: {
    name: 'D64',
    ext: '.d64',
    dirTrack: 18,
    dirSector: 1,
    headerTrack: 18,     // disk name/ID are in BAM sector for D64
    headerSector: 0,
    bamTrack: 18,
    bamSector: 0,
    bamSectors: [[18,0]],
    dosVersion: 0x41,    // 'A'
    dosType: '2A',
    nameOffset: 0x90,    // offset within header sector for disk name
    nameLength: 16,
    idOffset: 0xA2,      // offset within BAM sector for disk ID
    idLength: 5,
    maxDirSectors: 18,   // sectors 1-18 on track 18
    entriesPerSector: 8,
    entrySize: 32,
    doubleSidedFlag: 0x00,
    fileTypes: [0, 1, 2, 3, 4],  // DEL, SEQ, PRG, USR, REL
    defaultInterleave: 10,
    hasBamFreeCounts: true,
    interleavePresets: [
      { value: 10, label: '1541 Standard', desc: 'Interleave 10 \u2014 stock CBM DOS, compatible with everything' },
      { value: 6, label: '1541 JiffyDOS', desc: 'Interleave 6 \u2014 optimized for JiffyDOS ROM, also faster on stock hardware' },
    ],
    interleaveDefault: 1, // index into presets
    sizes: [
      { tracks: 35, bytes: 174848, label: '35 Tracks' },
      { tracks: 35, bytes: 175531, label: '35 Tracks + Errors' },
      { tracks: 40, bytes: 196608, label: '40 Tracks' },
      { tracks: 40, bytes: 197376, label: '40 Tracks + Errors' },
      { tracks: 42, bytes: 205312, label: '42 Tracks' },
      { tracks: 42, bytes: 206114, label: '42 Tracks + Errors' },
    ],
    sectorsPerTrack(t) {
      if (t <= 17) return 21;
      if (t <= 24) return 19;
      if (t <= 30) return 18;
      return 17;
    },
    // BAM: 4 bytes per track (free count + 3 bitmap bytes), tracks 1-35
    bamTracksRange(numTracks) { return Math.min(numTracks, 35); },
    readTrackFree(data, bamOff, track) {
      return data[bamOff + 4 * track];
    },
    writeTrackFree(data, bamOff, track, free) {
      data[bamOff + 4 * track] = free;
    },
    readTrackBitmap(data, bamOff, track) {
      const base = bamOff + 4 * track;
      return data[base + 1] | (data[base + 2] << 8) | (data[base + 3] << 16);
    },
    writeTrackBitmap(data, bamOff, track, bm) {
      const base = bamOff + 4 * track;
      data[base + 1] = bm & 0xFF;
      data[base + 2] = (bm >> 8) & 0xFF;
      data[base + 3] = (bm >> 16) & 0xFF;
    },
    initBAM(data, bamOff, numTracks) {
      data[bamOff + 0] = this.dirTrack;
      data[bamOff + 1] = this.dirSector;
      data[bamOff + 2] = this.dosVersion;
      data[bamOff + 3] = this.doubleSidedFlag;

      const bamTracks = this.bamTracksRange(numTracks);
      for (let t = 1; t <= bamTracks; t++) {
        const spt = this.sectorsPerTrack(t);
        const base = bamOff + 4 * t;
        if (t === this.dirTrack) {
          data[base] = spt - 2;
          let bm = (1 << spt) - 1;
          bm &= ~(1 << 0); // BAM sector used
          bm &= ~(1 << 1); // first dir sector used
          data[base + 1] = bm & 0xFF;
          data[base + 2] = (bm >> 8) & 0xFF;
          data[base + 3] = (bm >> 16) & 0xFF;
        } else {
          data[base] = spt;
          let bm = (1 << spt) - 1;
          data[base + 1] = bm & 0xFF;
          data[base + 2] = (bm >> 8) & 0xFF;
          data[base + 3] = (bm >> 16) & 0xFF;
        }
      }

      // Disk name: 0xA0 padding
      for (let i = 0; i < 16; i++) data[bamOff + this.nameOffset + i] = 0xA0;
      // Fill bytes
      data[bamOff + 0xA0] = 0xA0;
      data[bamOff + 0xA1] = 0xA0;
      // Disk ID: 0xA0
      data[bamOff + 0xA2] = 0xA0;
      data[bamOff + 0xA3] = 0xA0;
      // Fill
      data[bamOff + 0xA4] = 0xA0;
      // DOS type
      data[bamOff + 0xA5] = this.dosType.charCodeAt(0);
      data[bamOff + 0xA6] = this.dosType.charCodeAt(1);
      // Fill
      for (let i = 0xA7; i <= 0xAA; i++) data[bamOff + i] = 0xA0;
    },
  },
  // D71 format descriptor (1571 drive, double-sided 5.25" disk)
  d71: {
    name: 'D71',
    ext: '.d71',
    dirTrack: 18,
    dirSector: 1,
    headerTrack: 18,
    headerSector: 0,
    bamTrack: 18,
    bamSector: 0,
    bamSectors: [[18,0],[53,0]], // side 1 at T18/S0, side 2 at T53/S0
    dosVersion: 0x41,    // 'A'
    dosType: '2A',
    nameOffset: 0x90,
    nameLength: 16,
    idOffset: 0xA2,
    idLength: 5,
    maxDirSectors: 18,
    entriesPerSector: 8,
    entrySize: 32,
    doubleSidedFlag: 0x80,
    fileTypes: [0, 1, 2, 3, 4],  // DEL, SEQ, PRG, USR, REL
    defaultInterleave: 6,
    hasBamFreeCounts: true,
    interleavePresets: [
      { value: 6, label: '1571 Standard', desc: 'Interleave 6 \u2014 stock 1571 DOS, native double-sided mode' },
      { value: 5, label: '1571 Optimized', desc: 'Interleave 5 \u2014 slightly faster with burst transfer' },
      { value: 10, label: '1541 Compatible', desc: 'Interleave 10 \u2014 safe for 1541 mode on a 1571' },
      { value: 4, label: '1571 JiffyDOS', desc: 'Interleave 4 \u2014 optimized for JiffyDOS ROM in 1571 mode' },
    ],
    interleaveDefault: 0,
    sizes: [
      { tracks: 70, bytes: 349696, label: '70 Tracks' },
      { tracks: 70, bytes: 351062, label: '70 Tracks + Errors' },
      { tracks: 80, bytes: 393216, label: '80 Tracks' },
      { tracks: 80, bytes: 394752, label: '80 Tracks + Errors' },
    ],
    sectorsPerTrack(t) {
      // Both sides have the same layout
      const st = t <= 35 ? t : t - 35;
      if (st <= 17) return 21;
      if (st <= 24) return 19;
      if (st <= 30) return 18;
      return 17;
    },
    // Side 1 BAM: same as D64 at T18/S0 (4 bytes per track, tracks 1-35)
    // Side 2 free counts: at T18/S0 bytes $DD-$FF (1 byte per track, tracks 36-70)
    // Side 2 bitmaps: at T53/S0 bytes $00-$68 (3 bytes per track, tracks 36-70)
    bamTracksRange(numTracks) { return Math.min(numTracks, 70); },
    readTrackFree(data, bamOff, track) {
      if (track <= 35) {
        return data[bamOff + 4 * track];
      } else {
        // Side 2 free counts at T18/S0 bytes $DD + (track - 36)
        return data[bamOff + 0xDD + (track - 36)];
      }
    },
    writeTrackFree(data, bamOff, track, free) {
      if (track <= 35) {
        data[bamOff + 4 * track] = free;
      } else {
        data[bamOff + 0xDD + (track - 36)] = free;
      }
    },
    readTrackBitmap(data, bamOff, track) {
      if (track <= 35) {
        const base = bamOff + 4 * track;
        return data[base + 1] | (data[base + 2] << 8) | (data[base + 3] << 16);
      } else {
        // Side 2 bitmaps at T53/S0 bytes $00 + (track - 36) * 3
        const bam2Off = this._bam2Off(bamOff);
        const base = bam2Off + (track - 36) * 3;
        return data[base] | (data[base + 1] << 8) | (data[base + 2] << 16);
      }
    },
    writeTrackBitmap(data, bamOff, track, bm) {
      if (track <= 35) {
        const base = bamOff + 4 * track;
        data[base + 1] = bm & 0xFF;
        data[base + 2] = (bm >> 8) & 0xFF;
        data[base + 3] = (bm >> 16) & 0xFF;
      } else {
        const bam2Off = this._bam2Off(bamOff);
        const base = bam2Off + (track - 36) * 3;
        data[base] = bm & 0xFF;
        data[base + 1] = (bm >> 8) & 0xFF;
        data[base + 2] = (bm >> 16) & 0xFF;
      }
    },
    _bam2Off(bamOff) {
      // T53/S0 offset — T53 is track 53, same geometry as T18 on side 2
      // Need to calculate from track offsets
      const offsets = getTrackOffsets(this, 70);
      return offsets[53];
    },
    initBAM(data, bamOff, numTracks) {
      // Side 1 BAM (same layout as D64)
      data[bamOff + 0] = this.dirTrack;
      data[bamOff + 1] = this.dirSector;
      data[bamOff + 2] = this.dosVersion;
      data[bamOff + 3] = this.doubleSidedFlag; // 0x80 = double-sided

      // BAM entries for tracks 1-35 (side 1)
      for (let t = 1; t <= 35; t++) {
        const spt = this.sectorsPerTrack(t);
        const base = bamOff + 4 * t;
        if (t === this.dirTrack) {
          data[base] = spt - 2;
          let bm = (1 << spt) - 1;
          bm &= ~(1 << 0);
          bm &= ~(1 << 1);
          data[base + 1] = bm & 0xFF;
          data[base + 2] = (bm >> 8) & 0xFF;
          data[base + 3] = (bm >> 16) & 0xFF;
        } else {
          data[base] = spt;
          let bm = (1 << spt) - 1;
          data[base + 1] = bm & 0xFF;
          data[base + 2] = (bm >> 8) & 0xFF;
          data[base + 3] = (bm >> 16) & 0xFF;
        }
      }

      // Disk name, ID, DOS type (same offsets as D64)
      for (let i = 0; i < 16; i++) data[bamOff + this.nameOffset + i] = 0xA0;
      data[bamOff + 0xA0] = 0xA0;
      data[bamOff + 0xA1] = 0xA0;
      data[bamOff + 0xA2] = 0xA0;
      data[bamOff + 0xA3] = 0xA0;
      data[bamOff + 0xA4] = 0xA0;
      data[bamOff + 0xA5] = this.dosType.charCodeAt(0);
      data[bamOff + 0xA6] = this.dosType.charCodeAt(1);
      for (let i = 0xA7; i <= 0xAA; i++) data[bamOff + i] = 0xA0;

      // Side 2 BAM: free counts at T18/S0 $DD-$FF (35 bytes, tracks 36-70)
      // Bitmaps at T53/S0 $00-$68 (105 bytes, tracks 36-70)
      // Tracks 71-80 on extended disks are outside the BAM
      const bam2Off = this._bam2Off(bamOff);
      const maxBamTrack = Math.min(numTracks, 70);
      for (let t = 36; t <= maxBamTrack; t++) {
        const spt = this.sectorsPerTrack(t);
        // Free count at T18/S0 byte $DD + (t - 36)
        if (t === 53) {
          data[bamOff + 0xDD + (t - 36)] = spt - 1;
        } else {
          data[bamOff + 0xDD + (t - 36)] = spt;
        }
        // Bitmap at T53/S0 byte (t - 36) * 3
        const bmBase = bam2Off + (t - 36) * 3;
        let bm = (1 << spt) - 1;
        if (t === 53) bm &= ~(1 << 0); // T53/S0 used for BAM2
        data[bmBase] = bm & 0xFF;
        data[bmBase + 1] = (bm >> 8) & 0xFF;
        data[bmBase + 2] = (bm >> 16) & 0xFF;
      }
    },
  },

  // D81 format descriptor (1581 drive, 3.5" disk)
  d81: {
    name: 'D81',
    ext: '.d81',
    dirTrack: 40,
    dirSector: 3,
    headerTrack: 40,    // disk name/ID are in the header sector (T40/S0)
    headerSector: 0,
    bamTrack: 40,
    bamSector: 1,
    bamSectors: [[40,0],[40,1],[40,2]], // header + BAM1 + BAM2
    dosVersion: 0x44,   // 'D'
    dosType: '3D',
    nameOffset: 0x04,   // offset within HEADER sector for disk name
    nameLength: 16,
    idOffset: 0x16,     // offset within HEADER sector for disk ID
    idLength: 5,
    maxDirSectors: 37,   // sectors 3-39 on track 40 (0=header, 1-2=BAM)
    entriesPerSector: 8,
    entrySize: 32,
    doubleSidedFlag: 0x00,
    fileTypes: [0, 1, 2, 3, 4, 5],  // DEL, SEQ, PRG, USR, REL, CBM
    supportsSubdirs: true,
    subdirType: 5,      // CBM partition type
    subdirLinked: false, // contiguous track block
    partitionSpt: 40,   // sectors per track within D81 partitions
    partitionBamOffset: 0x10, // BAM entry offset within partition BAM sector
    partitionBamEntrySize: 6, // bytes per track in partition BAM
    partitionDirSector: 3,    // directory starts at sector 3 in partitions
    defaultInterleave: 1,
    hasBamFreeCounts: true,
    interleavePresets: [
      { value: 1, label: '1581 Standard', desc: 'Interleave 1 \u2014 stock 1581 burst mode, maximum speed' },
      { value: 2, label: '1581 Compatible', desc: 'Interleave 2 \u2014 safer for slower interfaces or emulators' },
    ],
    interleaveDefault: 0,
    sizes: [
      { tracks: 80, bytes: 819200, label: '80 Tracks' },
      { tracks: 80, bytes: 822400, label: '80 Tracks + Errors' },
    ],
    sectorsPerTrack(t) {
      return 40; // all tracks have 40 sectors on D81
    },
    // BAM: 6 bytes per track (free count + 5 bitmap bytes for 40 sectors)
    // Tracks 1-40 in BAM sector 1 (T40/S1) starting at offset 0x10
    // Tracks 41-80 in BAM sector 2 (T40/S2) starting at offset 0x10
    bamTracksRange(numTracks) { return numTracks; }, // all 80 tracks are in BAM
    _bamBase(bamOff, track) {
      // bamOff points to T40/S1
      if (track <= 40) {
        return bamOff + 0x10 + (track - 1) * 6;
      } else {
        // BAM sector 2 is at T40/S2 (256 bytes after T40/S1)
        return bamOff + 256 + 0x10 + (track - 41) * 6;
      }
    },
    readTrackFree(data, bamOff, track) {
      return data[this._bamBase(bamOff, track)];
    },
    writeTrackFree(data, bamOff, track, free) {
      data[this._bamBase(bamOff, track)] = free;
    },
    readTrackBitmap(data, bamOff, track) {
      const base = this._bamBase(bamOff, track);
      // 5 bitmap bytes = 40 bits for 40 sectors
      return (data[base+1] | (data[base+2]<<8) | (data[base+3]<<16) |
             ((data[base+4]<<24) >>> 0)) + ((data[base+5] & 0xFF) * 0x100000000);
    },
    writeTrackBitmap(data, bamOff, track, bm) {
      const base = this._bamBase(bamOff, track);
      data[base+1] = bm & 0xFF;
      data[base+2] = (bm >>> 8) & 0xFF;
      data[base+3] = (bm >>> 16) & 0xFF;
      data[base+4] = (bm >>> 24) & 0xFF;
      data[base+5] = Math.floor(bm / 0x100000000) & 0xFF;
    },
    initBAM(data, bamOff, numTracks) {
      // Header sector (T40/S0) — contains disk name, ID, DOS type
      var headerOff = bamOff - this.bamSector * 256 + this.headerSector * 256; // T40/S0
      data[headerOff + 0x00] = this.dirTrack;
      data[headerOff + 0x01] = this.dirSector;
      data[headerOff + 0x02] = this.dosVersion; // 'D'
      data[headerOff + 0x03] = 0xBB;

      // Disk name at header offset 0x04: 0xA0 padding
      for (var i = 0; i < 16; i++) data[headerOff + this.nameOffset + i] = 0xA0;
      // Fill bytes
      data[headerOff + 0x14] = 0xA0;
      data[headerOff + 0x15] = 0xA0;
      // Disk ID: 0xA0
      data[headerOff + 0x16] = 0xA0;
      data[headerOff + 0x17] = 0xA0;
      // Fill
      data[headerOff + 0x18] = 0xA0;
      // DOS type
      data[headerOff + 0x19] = this.dosType.charCodeAt(0);
      data[headerOff + 0x1A] = this.dosType.charCodeAt(1);
      // Fill
      for (i = 0x1B; i < 0x100; i++) data[headerOff + i] = 0x00;

      // BAM sector 1 (T40/S1) — BAM for tracks 1-40
      data[bamOff + 0x00] = this.dirTrack;
      data[bamOff + 0x01] = 2; // link to BAM sector 2
      data[bamOff + 0x02] = this.dosVersion;
      data[bamOff + 0x03] = 0xBB;
      // Disk ID copy in BAM sectors
      data[bamOff + 0x04] = 0xA0;
      data[bamOff + 0x05] = 0xA0;

      // BAM sector 2 (T40/S2) — BAM for tracks 41-80
      var bam2Off = bamOff + 256;
      data[bam2Off + 0x00] = 0x00;
      data[bam2Off + 0x01] = 0xFF;
      data[bam2Off + 0x02] = this.dosVersion;
      data[bam2Off + 0x03] = 0xBB;
      data[bam2Off + 0x04] = 0xA0;
      data[bam2Off + 0x05] = 0xA0;

      // Init BAM entries for all tracks
      for (var t = 1; t <= numTracks; t++) {
        var spt = this.sectorsPerTrack(t);
        var base = this._bamBase(bamOff, t);
        if (t === this.dirTrack) {
          // Track 40: sectors 0,1,2,3 used (header, BAM1, BAM2, first dir sector)
          data[base] = spt - 4;
          // Set all bits free, then clear bits 0,1,2,3
          for (var b = 0; b < 5; b++) data[base + 1 + b] = 0xFF;
          data[base + 1] &= ~(1 << 0); // sector 0 (header)
          data[base + 1] &= ~(1 << 1); // sector 1 (BAM1)
          data[base + 1] &= ~(1 << 2); // sector 2 (BAM2)
          data[base + 1] &= ~(1 << 3); // sector 3 (first dir)
        } else {
          data[base] = spt; // all free
          for (var b = 0; b < 5; b++) data[base + 1 + b] = 0xFF;
        }
      }

      // Directory sector init is handled by createEmptyDisk
    },
  },
  // D80 format descriptor (8050 drive, single-sided)
  d80: {
    name: 'D80',
    ext: '.d80',
    dirTrack: 39,
    dirSector: 1,
    headerTrack: 39,
    headerSector: 0,
    bamTrack: 38,
    bamSector: 0,
    bamSectors: [[38,0],[38,3]], // all BAM sector locations
    dosVersion: 0x43, // 'C'
    dosType: '2C',
    nameOffset: 0x06,  // within header sector T39/S0
    nameLength: 16,
    idOffset: 0x18,
    idLength: 5,
    maxDirSectors: 28,
    entriesPerSector: 8,
    entrySize: 32,
    doubleSidedFlag: 0x00,
    fileTypes: [0, 1, 2, 3, 4],
    defaultInterleave: 6,
    hasBamFreeCounts: true,
    interleavePresets: [
      { value: 6, label: '8050/8250 Standard', desc: 'Interleave 6 \u2014 stock CBM DOS for IEEE-488 drives' },
      { value: 5, label: '8050/8250 Optimized', desc: 'Interleave 5 \u2014 tighter timing, faster loading' },
    ],
    interleaveDefault: 0,
    sizes: [
      { tracks: 77, bytes: 533248, label: '77 Tracks' },
    ],
    sectorsPerTrack(t) {
      var st = t <= 77 ? t : t - 77;
      if (st <= 39) return 29;
      if (st <= 53) return 27;
      if (st <= 64) return 25;
      return 23;
    },
    bamTracksRange(numTracks) { return Math.min(numTracks, 77); },
    // BAM: 5 bytes per track (free count + 4 bitmap bytes)
    // BAM1 at T38/S0 covers tracks 1-50, BAM2 at T38/S3 covers tracks 51-77
    // Each BAM sector has 6-byte header then entries at offset 0x06
    _bamEntryBase(bamOff, track) {
      if (track <= 50) return bamOff + 0x06 + (track - 1) * 5;
      // BAM2 is at T38/S3 = bamOff + 3*256 (sector offset within same track)
      return bamOff + 3 * 256 + 0x06 + (track - 51) * 5;
    },
    readTrackFree(data, bamOff, track) { return data[this._bamEntryBase(bamOff, track)]; },
    writeTrackFree(data, bamOff, track, free) { data[this._bamEntryBase(bamOff, track)] = free; },
    readTrackBitmap(data, bamOff, track) {
      var b = this._bamEntryBase(bamOff, track) + 1;
      return data[b] | (data[b+1] << 8) | (data[b+2] << 16) | ((data[b+3] << 24) >>> 0);
    },
    writeTrackBitmap(data, bamOff, track, bm) {
      var b = this._bamEntryBase(bamOff, track) + 1;
      data[b] = bm & 0xFF; data[b+1] = (bm >> 8) & 0xFF;
      data[b+2] = (bm >> 16) & 0xFF; data[b+3] = (bm >> 24) & 0xFF;
    },
    initBAM(data, bamOff, numTracks) {
      var headerOff = sectorOffset(this.headerTrack, this.headerSector);

      // Header sector T39/S0: points to first BAM sector
      data[headerOff + 0] = this.bamTrack; // 38
      data[headerOff + 1] = 0;             // sector 0
      data[headerOff + 2] = this.dosVersion;
      for (var hi = 3; hi < 6; hi++) data[headerOff + hi] = 0x00;
      // Disk name at offset 0x06
      for (var ni = 0; ni < 16; ni++) data[headerOff + 0x06 + ni] = 0xA0;
      data[headerOff + 0x16] = 0xA0; data[headerOff + 0x17] = 0xA0;
      data[headerOff + 0x18] = 0xA0; data[headerOff + 0x19] = 0xA0;
      data[headerOff + 0x1A] = 0xA0;
      data[headerOff + 0x1B] = this.dosType.charCodeAt(0);
      data[headerOff + 0x1C] = this.dosType.charCodeAt(1);

      // BAM sector 1 (T38/S0): covers tracks 1-50
      data[bamOff + 0] = 38; data[bamOff + 1] = 3; // chain to BAM2
      data[bamOff + 2] = this.dosVersion; data[bamOff + 3] = 0x00;
      data[bamOff + 4] = 1; data[bamOff + 5] = 51; // track range

      // BAM sector 2 (T38/S3): covers tracks 51-77
      var bam2 = bamOff + 3 * 256;
      data[bam2 + 0] = this.dirTrack; data[bam2 + 1] = this.dirSector; // chain to dir
      data[bam2 + 2] = this.dosVersion; data[bam2 + 3] = 0x00;
      data[bam2 + 4] = 51; data[bam2 + 5] = 78; // track range

      // Init BAM entries for all tracks
      for (var t = 1; t <= numTracks; t++) {
        var spt = this.sectorsPerTrack(t);
        var free = spt;
        var bm = (1 << spt) - 1;
        if (t === this.bamTrack) { free -= 2; bm &= ~(1 << 0); bm &= ~(1 << 3); }
        if (t === this.dirTrack) { free -= 2; bm &= ~(1 << 0); bm &= ~(1 << 1); }
        this.writeTrackFree(data, bamOff, t, free);
        this.writeTrackBitmap(data, bamOff, t, bm);
      }

      // First dir sector T39/S1
      var dirOff = sectorOffset(this.dirTrack, this.dirSector);
      data[dirOff + 0] = 0x00; data[dirOff + 1] = 0xFF;
    },
  },

  // D82 format descriptor (8250 drive, double-sided)
  d82: {
    name: 'D82',
    ext: '.d82',
    dirTrack: 39,
    dirSector: 1,
    headerTrack: 39,
    headerSector: 0,
    bamTrack: 38,
    bamSector: 0,
    bamSectors: [[38,0],[38,3],[38,6],[38,9]], // all BAM sector locations
    dosVersion: 0x43,
    dosType: '2C',
    nameOffset: 0x06,
    nameLength: 16,
    idOffset: 0x18,
    idLength: 5,
    maxDirSectors: 28,
    entriesPerSector: 8,
    entrySize: 32,
    doubleSidedFlag: 0x00,
    fileTypes: [0, 1, 2, 3, 4],
    defaultInterleave: 6,
    hasBamFreeCounts: true,
    interleavePresets: [
      { value: 6, label: '8050/8250 Standard', desc: 'Interleave 6 \u2014 stock CBM DOS for IEEE-488 drives' },
      { value: 5, label: '8050/8250 Optimized', desc: 'Interleave 5 \u2014 tighter timing, faster loading' },
    ],
    interleaveDefault: 0,
    sizes: [
      { tracks: 154, bytes: 1066496, label: '154 Tracks' },
    ],
    sectorsPerTrack(t) {
      var st = t <= 77 ? t : t - 77;
      if (st <= 39) return 29;
      if (st <= 53) return 27;
      if (st <= 64) return 25;
      return 23;
    },
    bamTracksRange(numTracks) { return Math.min(numTracks, 154); },
    // 4 BAM sectors: T38/S0 (1-50), T38/S3 (51-100), T38/S6 (101-150), T38/S9 (151-154)
    _bamEntryBase(bamOff, track) {
      var sector, idx;
      if (track <= 50) { sector = 0; idx = track - 1; }
      else if (track <= 100) { sector = 3; idx = track - 51; }
      else if (track <= 150) { sector = 6; idx = track - 101; }
      else { sector = 9; idx = track - 151; }
      return bamOff + sector * 256 + 0x06 + idx * 5;
    },
    readTrackFree(data, bamOff, track) { return data[this._bamEntryBase(bamOff, track)]; },
    writeTrackFree(data, bamOff, track, free) { data[this._bamEntryBase(bamOff, track)] = free; },
    readTrackBitmap(data, bamOff, track) {
      var b = this._bamEntryBase(bamOff, track) + 1;
      return data[b] | (data[b+1] << 8) | (data[b+2] << 16) | ((data[b+3] << 24) >>> 0);
    },
    writeTrackBitmap(data, bamOff, track, bm) {
      var b = this._bamEntryBase(bamOff, track) + 1;
      data[b] = bm & 0xFF; data[b+1] = (bm >> 8) & 0xFF;
      data[b+2] = (bm >> 16) & 0xFF; data[b+3] = (bm >> 24) & 0xFF;
    },
    initBAM(data, bamOff, numTracks) {
      var headerOff = sectorOffset(this.headerTrack, this.headerSector);

      // Header sector T39/S0
      data[headerOff + 0] = this.bamTrack;
      data[headerOff + 1] = 0;
      data[headerOff + 2] = this.dosVersion;
      for (var hi = 3; hi < 6; hi++) data[headerOff + hi] = 0x00;
      for (var ni = 0; ni < 16; ni++) data[headerOff + 0x06 + ni] = 0xA0;
      data[headerOff + 0x16] = 0xA0; data[headerOff + 0x17] = 0xA0;
      data[headerOff + 0x18] = 0xA0; data[headerOff + 0x19] = 0xA0;
      data[headerOff + 0x1A] = 0xA0;
      data[headerOff + 0x1B] = this.dosType.charCodeAt(0);
      data[headerOff + 0x1C] = this.dosType.charCodeAt(1);

      // BAM sectors with chain and track range headers
      var bamSectors = [
        { sec: 0, nextT: 38, nextS: 3, lo: 1, hi: 51 },
        { sec: 3, nextT: 38, nextS: 6, lo: 51, hi: 101 },
        { sec: 6, nextT: 38, nextS: 9, lo: 101, hi: 151 },
        { sec: 9, nextT: this.dirTrack, nextS: this.dirSector, lo: 151, hi: 155 },
      ];
      for (var bi = 0; bi < bamSectors.length; bi++) {
        var bs = bamSectors[bi];
        var off = bamOff + bs.sec * 256;
        data[off + 0] = bs.nextT; data[off + 1] = bs.nextS;
        data[off + 2] = this.dosVersion; data[off + 3] = 0x00;
        data[off + 4] = bs.lo; data[off + 5] = bs.hi;
      }

      // Init BAM entries for all tracks
      for (var t = 1; t <= numTracks; t++) {
        var spt = this.sectorsPerTrack(t);
        var free = spt;
        var bm = (1 << spt) - 1;
        if (t === this.bamTrack) { free -= 4; bm &= ~(1 << 0); bm &= ~(1 << 3); bm &= ~(1 << 6); bm &= ~(1 << 9); }
        if (t === this.dirTrack) { free -= 2; bm &= ~(1 << 0); bm &= ~(1 << 1); }
        this.writeTrackFree(data, bamOff, t, free);
        this.writeTrackBitmap(data, bamOff, t, bm);
      }

      var dirOff = sectorOffset(this.dirTrack, this.dirSector);
      data[dirOff + 0] = 0x00; data[dirOff + 1] = 0xFF;
    },
  },

  // DNP — CMD Native Partition (256 sectors/track, BAM at T1/S1, dir at T1/S34)
  dnp: {
    name: 'DNP',
    ext: '.dnp',
    dirTrack: 1,
    dirSector: 34,
    headerTrack: 1,
    headerSector: 1,  // header is at T1/S1 (same as BAM start)
    bamTrack: 1,
    bamSector: 1,
    bamSectors: [[1,1]], // header/BAM starts at T1/S1
    dosVersion: 0x48,   // 'H'
    dosType: '1H',
    nameOffset: 0x04,
    nameLength: 16,
    idOffset: 0x16,
    idLength: 5,      // 2-byte ID + pad + 2-byte DOS type (same layout as D64)
    maxDirSectors: 222, // sectors 34-255 on track 1
    entriesPerSector: 8,
    entrySize: 32,
    doubleSidedFlag: 0x00,
    fileTypes: [0, 1, 2, 3, 4, 5, 6], // DEL, SEQ, PRG, USR, REL, CBM, DIR
    supportsSubdirs: true,
    subdirType: 6,      // DIR type
    subdirLinked: true,  // header sector + linked dir chain
    subdirSelfRef: 0x20,   // header offset: self T/S (2 bytes)
    subdirParentRef: 0x22, // header offset: parent header T/S (2 bytes)
    subdirParentEntry: 0x24, // header offset: parent dir entry ref (2 bytes)
    defaultInterleave: 1,
    hasBamFreeCounts: false,
    interleavePresets: [
      { value: 1, label: 'CMD Native', desc: 'Interleave 1 \u2014 CMD HD/FD native mode' },
    ],
    interleaveDefault: 0,
    sizes: [], // variable size — detected by file size being multiple of 65536
    sectorsPerTrack(t) { return 256; },
    bamTracksRange(numTracks) { return numTracks; },
    _bamBase: _cmdBamBase,
    isSectorFree: _cmdIsSectorFree,
    readTrackFree: _dnpReadTrackFree,
    writeTrackFree: _cmdNoop,
    readTrackBitmap: _cmdReadTrackBitmap,
    writeTrackBitmap: _cmdNoop,
    initBAM: _cmdNoop,
  },

  // D1M — CMD FD-2000 Double Density (81 tracks, 40 sectors/track)
  d1m: {
    name: 'D1M',
    ext: '.d1m',
    dirTrack: 1,
    dirSector: 34,
    headerTrack: 1,
    headerSector: 1,
    bamTrack: 1,
    bamSector: 1,
    bamSectors: [[1,1]],
    dosVersion: 0x48,
    dosType: '1H',
    nameOffset: 0x04,
    nameLength: 16,
    idOffset: 0x16,
    idLength: 5,
    maxDirSectors: 6, // sectors 34-39 on track 1 (40 SPT)
    entriesPerSector: 8,
    entrySize: 32,
    doubleSidedFlag: 0x00,
    fileTypes: [0, 1, 2, 3, 4, 5, 6],
    supportsSubdirs: true,
    subdirType: 6,
    subdirLinked: true,
    subdirSelfRef: 0x20,
    subdirParentRef: 0x22,
    subdirParentEntry: 0x24,
    defaultInterleave: 1,
    hasBamFreeCounts: false,
    interleavePresets: [
      { value: 1, label: 'FD-2000 Standard', desc: 'Interleave 1 \u2014 CMD FD-2000 native mode' },
    ],
    interleaveDefault: 0,
    sizes: [
      { tracks: 81, bytes: 829440, label: '81 Tracks' },
      { tracks: 81, bytes: 832680, label: '81 Tracks + Errors' },
    ],
    sectorsPerTrack(t) { return 40; },
    bamTracksRange(numTracks) { return numTracks; },
    _bamBase: _fdBamBase,
    isSectorFree: _fdIsSectorFree,
    readTrackFree: _fdReadTrackFree,
    writeTrackFree: _cmdNoop,
    readTrackBitmap: _cmdReadTrackBitmap,
    writeTrackBitmap: _cmdNoop,
    initBAM: _cmdNoop,
  },

  // D2M — CMD FD-2000 High Density (81 tracks, 80 sectors/track)
  d2m: {
    name: 'D2M',
    ext: '.d2m',
    dirTrack: 1,
    dirSector: 34,
    headerTrack: 1,
    headerSector: 1,
    bamTrack: 1,
    bamSector: 1,
    bamSectors: [[1,1]],
    dosVersion: 0x48,
    dosType: '1H',
    nameOffset: 0x04,
    nameLength: 16,
    idOffset: 0x16,
    idLength: 5,
    maxDirSectors: 46, // sectors 34-79 on track 1 (80 SPT)
    entriesPerSector: 8,
    entrySize: 32,
    doubleSidedFlag: 0x00,
    fileTypes: [0, 1, 2, 3, 4, 5, 6],
    supportsSubdirs: true,
    subdirType: 6,
    subdirLinked: true,
    subdirSelfRef: 0x20,
    subdirParentRef: 0x22,
    subdirParentEntry: 0x24,
    defaultInterleave: 1,
    hasBamFreeCounts: false,
    interleavePresets: [
      { value: 1, label: 'FD-2000 Standard', desc: 'Interleave 1 \u2014 CMD FD-2000 native mode' },
    ],
    interleaveDefault: 0,
    sizes: [
      { tracks: 81, bytes: 1658880, label: '81 Tracks' },
      { tracks: 81, bytes: 1665360, label: '81 Tracks + Errors' },
    ],
    sectorsPerTrack(t) { return 80; },
    bamTracksRange(numTracks) { return numTracks; },
    _bamBase: _fdBamBase,
    isSectorFree: _fdIsSectorFree,
    readTrackFree: _fdReadTrackFree,
    writeTrackFree: _cmdNoop,
    readTrackBitmap: _cmdReadTrackBitmap,
    writeTrackBitmap: _cmdNoop,
    initBAM: _cmdNoop,
  },

  // D4M — CMD FD-4000 Extra Density (81 tracks, 160 sectors/track)
  d4m: {
    name: 'D4M',
    ext: '.d4m',
    dirTrack: 1,
    dirSector: 34,
    headerTrack: 1,
    headerSector: 1,
    bamTrack: 1,
    bamSector: 1,
    bamSectors: [[1,1]],
    dosVersion: 0x48,
    dosType: '1H',
    nameOffset: 0x04,
    nameLength: 16,
    idOffset: 0x16,
    idLength: 5,
    maxDirSectors: 126, // sectors 34-159 on track 1 (160 SPT)
    entriesPerSector: 8,
    entrySize: 32,
    doubleSidedFlag: 0x00,
    fileTypes: [0, 1, 2, 3, 4, 5, 6],
    supportsSubdirs: true,
    subdirType: 6,
    subdirLinked: true,
    subdirSelfRef: 0x20,
    subdirParentRef: 0x22,
    subdirParentEntry: 0x24,
    defaultInterleave: 1,
    hasBamFreeCounts: false,
    interleavePresets: [
      { value: 1, label: 'FD-4000 Standard', desc: 'Interleave 1 \u2014 CMD FD-4000 native mode' },
    ],
    interleaveDefault: 0,
    sizes: [
      { tracks: 81, bytes: 3317760, label: '81 Tracks' },
      { tracks: 81, bytes: 3330720, label: '81 Tracks + Errors' },
    ],
    sectorsPerTrack(t) { return 160; },
    bamTracksRange(numTracks) { return numTracks; },
    _bamBase: _fdBamBase,
    isSectorFree: _fdIsSectorFree,
    readTrackFree: _fdReadTrackFree,
    writeTrackFree: _cmdNoop,
    readTrackBitmap: _cmdReadTrackBitmap,
    writeTrackBitmap: _cmdNoop,
    initBAM: _cmdNoop,
  },

  // TAP tape image (read-only, raw pulse data)
  tap: {
    name: 'TAP',
    ext: '.tap',
    dirTrack: 0,
    dirSector: 0,
    headerTrack: 0,
    headerSector: 0,
    bamTrack: 0,
    bamSector: 0,
    dosVersion: 0x00,
    dosType: 'TP',
    nameOffset: 0x0C,
    nameLength: 0,
    idOffset: 0x0C,
    idLength: 1,
    maxDirSectors: 0,
    entriesPerSector: 0,
    entrySize: 32,
    doubleSidedFlag: 0x00,
    fileTypes: [1, 2],
    sizes: [],
    sectorsPerTrack: function() { return 0; },
    bamTracksRange: function() { return 0; },
    readTrackFree: function() { return 0; },
    writeTrackFree: function() {},
    readTrackBitmap: function() { return 0; },
    writeTrackBitmap: function() {},
    initBAM: function() {},
  },

  // T64 tape image (read-only virtual format)
  t64: {
    name: 'T64',
    ext: '.t64',
    dirTrack: 0,
    dirSector: 0,
    headerTrack: 0,
    headerSector: 0,
    bamTrack: 0,
    bamSector: 0,
    dosVersion: 0x00,
    dosType: 'T6',
    nameOffset: 0x28,
    nameLength: 24,
    idOffset: 0x28,
    idLength: 5,
    maxDirSectors: 0,
    entriesPerSector: 0,
    entrySize: 32,
    doubleSidedFlag: 0x00,
    fileTypes: [1, 2],
    sizes: [], // variable size, detected by magic bytes
    sectorsPerTrack: function() { return 0; },
    bamTracksRange: function() { return 0; },
    readTrackFree: function() { return 0; },
    writeTrackFree: function() {},
    readTrackBitmap: function() { return 0; },
    writeTrackBitmap: function() {},
    initBAM: function() {},
  },
};

// ── Protected sector helpers (shared defaults) ─────────────────────
// Returns sector numbers on the given track that must not be used for
// file data or directory expansion (BAM, header, system sectors).
function _defaultGetProtectedSectors(track) {
  var secs = [];
  for (var i = 0; i < this.bamSectors.length; i++) {
    if (this.bamSectors[i][0] === track) secs.push(this.bamSectors[i][1]);
  }
  if (this.headerTrack === track && secs.indexOf(this.headerSector) === -1) {
    secs.push(this.headerSector);
  }
  return secs;
}

// Returns object of tracks to skip entirely during file sector allocation.
function _defaultGetSkipTracks() {
  var tracks = {};
  tracks[this.dirTrack] = true;
  tracks[this.bamTrack] = true;
  for (var i = 0; i < this.bamSectors.length; i++) {
    tracks[this.bamSectors[i][0]] = true;
  }
  return tracks;
}

// Returns the bit mask for a sector in the BAM bitmap byte.
// Default: LSB-first (D64/D71/D81/D80/D82). DNP overrides to MSB-first.
function _defaultBamBitMask(sector) {
  return 1 << (sector % 8);
}

// Assign defaults to all formats, then override for DNP
(function() {
  var fmts = Object.keys(DISK_FORMATS);
  for (var i = 0; i < fmts.length; i++) {
    var fmt = DISK_FORMATS[fmts[i]];
    if (!fmt.getProtectedSectors) fmt.getProtectedSectors = _defaultGetProtectedSectors;
    if (!fmt.getSkipTracks) fmt.getSkipTracks = _defaultGetSkipTracks;
    if (!fmt.bamBitMask) fmt.bamBitMask = _defaultBamBitMask;
  }
})();

// CMD native formats: MSB-first bit order (sector 0 = bit 7, sector 7 = bit 0)
// Sectors 0-33 on track 1 are system (boot + header + BAM + reserved)
var _cmdBamBitMask = function(sector) { return 0x80 >> (sector & 7); };
var _cmdGetProtectedSectors = function(track) {
  var secs = _defaultGetProtectedSectors.call(this, track);
  if (track === 1) {
    for (var s = 0; s <= 33; s++) {
      if (secs.indexOf(s) === -1) secs.push(s);
    }
  }
  return secs;
};
['dnp', 'd1m', 'd2m', 'd4m'].forEach(function(k) {
  DISK_FORMATS[k].bamBitMask = _cmdBamBitMask;
  DISK_FORMATS[k].getProtectedSectors = _cmdGetProtectedSectors;
});

// D1M/D2M/D4M: also protect CMD FD system partition sectors on the last track
// (signature sector 5 + partition directory chain sectors 8-11, per VICE fsimage-create.c).
// These sectors are protected from file allocation but VICE leaves them marked *free*
// in the main BAM — see getBamOmittedSectors below so the integrity checker matches.
var _CMD_FD_SYS_SECTORS = [5, 8, 9, 10, 11];
var _cmdFdGetProtectedSectors = function(track) {
  var secs = _cmdGetProtectedSectors.call(this, track);
  if (track === currentTracks) {
    _CMD_FD_SYS_SECTORS.forEach(function(s) { if (secs.indexOf(s) === -1) secs.push(s); });
  }
  return secs;
};
var _cmdFdGetBamOmittedSectors = function(track) {
  return track === currentTracks ? _CMD_FD_SYS_SECTORS.slice() : [];
};
['d1m', 'd2m', 'd4m'].forEach(function(k) {
  DISK_FORMATS[k].getProtectedSectors = _cmdFdGetProtectedSectors;
  DISK_FORMATS[k].getBamOmittedSectors = _cmdFdGetBamOmittedSectors;
});

// CMD RAMLink — image is a raw RAM dump (1–8 MiB typical, up to 64 MiB)
// laid out internally as a single DNP. We register it as a DNP alias
// with a distinct name and .rml extension so the editor labels the
// format correctly and saves with the original suffix; everything else
// (BAM walk, directory parse, subdir navigation) is plain DNP.
DISK_FORMATS.ramlink = Object.assign({}, DISK_FORMATS.dnp, {
  name: 'RAMLink',
  ext: '.rml',
  // Both .rml and .rl are seen in the wild — save-as keeps whichever
  // extension the user opened; only canonical .rml is added if neither.
  extAlternates: ['.rl'],
});

// ── Active format ────────────────────────────────────────────────────
var currentFormat = DISK_FORMATS.d64;
var currentTracks = 35;
var parsedT64Entries = null; // entryOff → { t64DataOffset, t64StartAddr, t64EndAddr }
var parsedTAPEntries = null; // entryOff → { fileData: Uint8Array }
var parsedTapeDir = null;    // last parsed tape directory entries array

// ── Sector geometry (delegates to current format) ────────────────────
function sectorsPerTrack(t) {
  return currentFormat.sectorsPerTrack(t);
}



// ── BAM byte-level helpers (partition-aware, handles D81 >32 sectors) ─
// Partition BAM: returns byte offset for a track's BAM entry (free count byte)
// relTrack is 1-based relative to partition start
function getPartitionBamEntry(bamOff, relTrack) {
  var fmt = currentFormat;
  var spt = fmt.partitionSpt;
  var off = fmt.partitionBamOffset;
  var esz = fmt.partitionBamEntrySize;
  if (relTrack <= spt) return bamOff + off + (relTrack - 1) * esz;
  return bamOff + 256 + off + (relTrack - spt - 1) * esz;
}

// Returns the byte offset of the bitmap bytes for a given track.
// For partitions, track is absolute (disk-level) and bamOff is the partition BAM offset.
function getBamBitmapBase(track, bamOff) {
  if (currentPartition && !currentPartition.dnpDir) {
    var relTrack = track - currentPartition.startTrack + 1;
    return getPartitionBamEntry(bamOff, relTrack) + 1;
  }
  var fmt = currentFormat;
  if (fmt.isSectorFree) return fmt._bamBase(track); // CMD native (DNP/D1M/D2M/D4M): own BAM layout
  if (fmt._bamBase) return fmt._bamBase(bamOff, track) + 1; // D81: BAM base + 1 (skip free count byte)
  if (fmt === DISK_FORMATS.d71 && track > 35) return fmt._bam2Off(bamOff) + (track - 36) * 3;
  if (fmt === DISK_FORMATS.d80 || fmt === DISK_FORMATS.d82) return fmt._bamEntryBase(bamOff, track) + 1;
  return bamOff + 4 * track + 1;
}

/** @param {Uint8Array} data @param {number} bamOff @param {number} track @param {number} sector @returns {boolean} */
function checkSectorFree(data, bamOff, track, sector) {
  if (currentFormat.isSectorFree) return currentFormat.isSectorFree(data, bamOff, track, sector);
  var base = getBamBitmapBase(track, bamOff);
  return (data[base + Math.floor(sector / 8)] & (1 << (sector % 8))) !== 0;
}

/** @param {Uint8Array} data @param {number} track @param {number} sector @param {number} bamOff */
function bamMarkSectorUsed(data, track, sector, bamOff) {
  var base = getBamBitmapBase(track, bamOff);
  data[base + (sector >> 3)] &= ~currentFormat.bamBitMask(sector);
  bamRecalcFree(data, track, bamOff);
}

/** @param {Uint8Array} data @param {number} track @param {number} sector @param {number} bamOff */
function bamMarkSectorFree(data, track, sector, bamOff) {
  var base = getBamBitmapBase(track, bamOff);
  data[base + (sector >> 3)] |= currentFormat.bamBitMask(sector);
  bamRecalcFree(data, track, bamOff);
}

/** @param {Uint8Array} data @param {number} track @param {number} bamOff */
function bamRecalcFree(data, track, bamOff) {
  var spt = currentFormat.sectorsPerTrack(track);
  var numBytes = Math.ceil(spt / 8);
  var base = getBamBitmapBase(track, bamOff);
  var free = 0;
  for (var i = 0; i < numBytes; i++) {
    var bval = data[base + i];
    var maxBit = Math.min(8, spt - i * 8);
    for (var bit = 0; bit < maxBit; bit++) {
      if (bval & (1 << bit)) free++;
    }
  }
  // Write free count
  if (currentPartition && !currentPartition.dnpDir) {
    var relTrack = track - currentPartition.startTrack + 1;
    data[getPartitionBamEntry(bamOff, relTrack)] = free;
  } else {
    currentFormat.writeTrackFree(data, bamOff, track, free);
  }
}

function totalSectors(format, numTracks) {
  let s = 0;
  for (let t = 1; t <= numTracks; t++) s += format.sectorsPerTrack(t);
  return s;
}


/** @param {ArrayBuffer} buffer @param {number} entryOff @returns {FileReadResult} */
function readFileData(buffer, entryOff) {
  var disk = new Uint8Array(buffer);

  // T64: read directly from stored data offset, prepend load address
  if (currentFormat === DISK_FORMATS.t64) {
    var info = parsedT64Entries && parsedT64Entries[entryOff];
    if (!info) return { data: new Uint8Array(0), error: 'T64 entry not found' };
    var size = info.t64EndAddr - info.t64StartAddr;
    if (size <= 0 || info.t64DataOffset + size > disk.length) {
      return { data: new Uint8Array(0), error: 'Invalid T64 data range' };
    }
    var out = new Uint8Array(size + 2);
    out[0] = info.t64StartAddr & 0xFF;
    out[1] = (info.t64StartAddr >> 8) & 0xFF;
    out.set(disk.subarray(info.t64DataOffset, info.t64DataOffset + size), 2);
    return { data: out, error: null };
  }

  // TAP: return pre-decoded data stored during parsing
  if (currentFormat === DISK_FORMATS.tap) {
    var tapEntry = parsedTAPEntries && parsedTAPEntries[entryOff];
    if (!tapEntry) return { data: new Uint8Array(0), error: 'TAP entry not found' };
    if (!tapEntry.fileData) return { data: new Uint8Array(0), error: 'TAP data not decoded (turbo loader?)' };
    return { data: tapEntry.fileData, error: null };
  }

  var t = disk[entryOff + 3];
  var s = disk[entryOff + 4];
  if (t === 0) return { data: new Uint8Array(0), error: 'No file data (T/S = 0/0)' };

  var bytes = [];
  var visited = {};
  while (t !== 0) {
    if (t < 1 || t > currentTracks) return { data: new Uint8Array(bytes), error: 'Illegal track ' + t };
    if (s < 0 || s >= currentFormat.sectorsPerTrack(t)) return { data: new Uint8Array(bytes), error: 'Illegal sector ' + s + ' on track ' + t };
    var key = t + ':' + s;
    if (visited[key]) return { data: new Uint8Array(bytes), error: 'Circular reference at T:' + t + ' S:' + s };
    visited[key] = true;

    var off = sectorOffset(t, s);
    if (off < 0) return { data: new Uint8Array(bytes), error: 'Invalid sector offset' };

    var nextT = disk[off];
    var nextS = disk[off + 1];

    if (nextT === 0) {
      // Last sector: nextS = index of last data byte, data is bytes 2..nextS
      for (var i = 2; i <= nextS && i < 256; i++) bytes.push(disk[off + i]);
    } else {
      // Full sector: data is bytes 2-255 (254 bytes)
      for (var j = 2; j < 256; j++) bytes.push(disk[off + j]);
    }

    t = nextT;
    s = nextS;
  }
  return { data: new Uint8Array(bytes), error: null };
}

/** @returns {number} Byte offset of the header sector */
function getHeaderOffset() {
  var fmt = currentFormat;
  return sectorOffset(fmt.headerTrack || fmt.bamTrack, fmt.headerSector != null ? fmt.headerSector : fmt.bamSector);
}

function petsciiToReadable(str) {
  var out = '';
  for (var i = 0; i < str.length; i++) {
    var cp = str.charCodeAt(i);
    // Handle both uppercase (E0xx) and lowercase (E1xx) PUA ranges
    var petscii = -1;
    if (cp >= 0xE000 && cp <= 0xE0FF) petscii = cp - 0xE000;
    else if (cp >= 0xE100 && cp <= 0xE1FF) petscii = cp - 0xE100;

    if (petscii >= 0) {
      if (petscii >= 0x41 && petscii <= 0x5A) out += String.fromCharCode(petscii); // A-Z
      else if (petscii >= 0x61 && petscii <= 0x7A) out += String.fromCharCode(petscii - 0x20); // lowercase → A-Z
      else if (petscii >= 0xC1 && petscii <= 0xDA) out += String.fromCharCode(petscii - 0x80); // shifted → A-Z
      else if (petscii >= 0x20 && petscii <= 0x3F) out += String.fromCharCode(petscii); // space, punct, digits
      else if (petscii === 0x40) out += '@';
      else if (petscii >= 0x5B && petscii <= 0x5F) out += String.fromCharCode(petscii); // [\]^_
      else out += '.'; // graphics → dot
    } else {
      out += str[i];
    }
  }
  return out;
}

// Check if disk image has error bytes appended
function hasErrorBytes(buffer) {
  if (!buffer) return false;
  var size = buffer.byteLength || buffer.length;
  for (var key in DISK_FORMATS) {
    var fmt = DISK_FORMATS[key];
    for (var i = 0; i < fmt.sizes.length; i++) {
      if (size === fmt.sizes[i].bytes && fmt.sizes[i].label.indexOf('Errors') >= 0) return true;
    }
  }
  return false;
}

// Get the offset where error bytes start (after all sector data)
function getErrorBytesOffset(format, numTracks) {
  return totalSectors(format, numTracks) * 256;
}

// Error code descriptions
var ERROR_CODES = {
  0x00: 'No error (unused)',
  0x01: 'OK',
  0x02: 'Header block not found',
  0x03: 'No sync mark',
  0x04: 'Data block not found',
  0x05: 'Checksum error (data)',
  0x06: 'Decode error',
  0x09: 'Checksum error (header)',
  0x0B: 'ID mismatch',
  0x0F: 'Drive not ready'
};


// ── Utility ──────────────────────────────────────────────────────────
/** @param {number} n @returns {string} */ function hex8(n) { return n.toString(16).toUpperCase().padStart(2, '0'); }
/** @param {number} n @returns {string} */ function hex16(n) { return n.toString(16).toUpperCase().padStart(4, '0'); }

/** @param {string} s @returns {string} */ function escHtml(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ── File type names (shared across all CBM formats) ──────────────────
const FILE_TYPES = ['DEL', 'SEQ', 'PRG', 'USR', 'REL', 'CBM', 'DIR'];
var FILE_TYPE = {};
FILE_TYPES.forEach(function(name, idx) { FILE_TYPE[name] = idx; });

/** @param {number} typeByte @returns {string} Formatted type string like " PRG " */
function fileTypeName(typeByte) {
  const closed = (typeByte & 0x80) !== 0;
  const locked = (typeByte & 0x40) !== 0;
  const idx = typeByte & 0x07;
  const base = FILE_TYPES[idx] || '???';
  const prefix = closed ? ' ' : '*';
  const suffix = locked ? '<' : ' ';
  return prefix + base + suffix;
}


function parseDisk(buffer, formatHint) {
  var data = new Uint8Array(buffer);

  // X64 format: 64-byte header starting with "C1541" — strip header
  if (data.length > 64 && data[0] === 0x43 && data[1] === 0x31 && data[2] === 0x35 &&
      data[3] === 0x34 && data[4] === 0x31) {
    buffer = buffer.slice(64);
    data = new Uint8Array(buffer);
    currentBuffer = buffer;
  }

  // G64 format: decode GCR to D64 sectors. The decoder also captures the
  // physical sector order per track (for the G64 Layout viewer) — stash
  // that on the global currentG64Layout, parallel to currentBuffer.
  // We only WRITE the layout here, never reset it: parseDisk gets called
  // again from parseCurrentDir on every dir refresh with the already-
  // decoded D64 buffer, which would clobber the layout. The file-open
  // handler is responsible for clearing currentG64Layout when opening a
  // fresh file, same pattern as clearCmdContainerState.
  if (data.length > 12 && data[0] === 0x47 && data[1] === 0x43 && data[2] === 0x52 && data[3] === 0x2D) {
    var g64Result = decodeG64toD64(data);
    buffer = g64Result.d64;
    data = new Uint8Array(buffer);
    currentBuffer = buffer;
    currentG64Layout = g64Result.layout;
  }
  // NIB / NB2 (raw nibble dumps from a 1541, magic "MNIB-1541-RAW").
  // We convert into the same { d64 buffer + g64Layout } shape as G64 so
  // the rest of the editor sees a normal D64 with raw GCR available;
  // saving the tab will encode it back as a real .g64.
  else if (isNibBuffer(data)) {
    var nibResult = parseNibFile(data);
    buffer = nibResult.d64;
    data = new Uint8Array(buffer);
    currentBuffer = buffer;
    currentG64Layout = nibResult.layout;
    // We don't write .nib files — flip the working filename to .g64 so
    // Save / Save As naturally produce a GCR-encoded G64. Tab labels
    // pick this up via the file-open handlers (which read currentFileName
    // for the createTab call after parseDisk runs).
    if (currentFileName) {
      currentFileName = currentFileName.replace(/\.(nib|nb2)$/i, '.g64');
      if (!/\.g64$/i.test(currentFileName)) currentFileName += '.g64';
    }
  }

  // formatHint is used when the buffer is a CMD-container partition slice
  // whose size doesn't match any standard disk format (e.g., an FD Native
  // partition). Caller passes the format key directly so detectFormat is
  // skipped. tracks falls back to the format's first declared size.
  if (formatHint && DISK_FORMATS[formatHint]) {
    currentFormat = DISK_FORMATS[formatHint];
    currentTracks = currentFormat.sizes && currentFormat.sizes[0]
      ? currentFormat.sizes[0].tracks : 81;
  } else {
    const detected = detectFormat(data.length, buffer);
    currentFormat = detected.format;
    currentTracks = detected.tracks;
  }

  // Flat .rml-as-DNP fallback: when a file ending in .rml/.rl turns
  // out to be a plain DNP (no RAMLink partition table), label it as
  // RAMLink so save-as keeps the .rml extension. Skipped inside a real
  // CMD container (cmdcBuffer set) — there the slice is a genuine
  // DNP/D64/D81 and shouldn't be relabelled.
  if (!cmdcBuffer && currentFormat === DISK_FORMATS.dnp && currentFileName && /\.(rml|rl)$/i.test(currentFileName)) {
    currentFormat = DISK_FORMATS.ramlink;
  }

  // Reset interleave to format defaults
  if (currentFormat.defaultInterleave) {
    fileInterleave = currentFormat.defaultInterleave;
    dirInterleave = 3; // standard directory interleave for all formats
  }

  // Tape images use their own parsers
  if (currentFormat === DISK_FORMATS.tap) return parseTAP(buffer);
  if (currentFormat === DISK_FORMATS.t64) return parseT64(buffer);

  // Clear tape lookup maps for disk formats
  parsedT64Entries = null;
  parsedTAPEntries = null;

  const fmt = currentFormat;
  const bamOffset = sectorOffset(fmt.bamTrack, fmt.bamSector);
  const headerOff = getHeaderOffset();

  const diskName = readPetsciiString(data, headerOff + fmt.nameOffset, fmt.nameLength);
  const diskId = readPetsciiString(data, headerOff + fmt.idOffset, fmt.idLength, false);

  // Count free blocks from BAM. CBM formats (D64/D71/D81) exclude the dir
  // track from "blocks free" by convention; CMD native formats (DNP/D1M/D2M/
  // D4M) include it because their bitmap is exhaustive and dir-track sectors
  // genuinely available for files are reported as free.
  let freeBlocks = 0;
  const bamTracks = fmt.bamTracksRange(currentTracks);
  const skipDirTrack = !fmt.isSectorFree;
  for (let t = 1; t <= bamTracks; t++) {
    if (skipDirTrack && t === fmt.dirTrack) continue;
    freeBlocks += fmt.readTrackFree(data, bamOffset, t);
  }

  // Read directory chain
  const entries = [];
  let dirTrack = fmt.dirTrack;
  let dirSector = fmt.dirSector;
  const visited = new Set();

  while (dirTrack !== 0) {
    const key = `${dirTrack}:${dirSector}`;
    if (visited.has(key)) break;
    visited.add(key);

    // Dir chain uses physical T:S even on FD (file chain bytes use LBA,
    // but dir-chain bytes don't). Validate against physical SPT so
    // garbage chain pointers (e.g., game(d2m).d2m's leftover `03 e0` at
    // the end of an 8-entry dir) terminate cleanly instead of being
    // followed via sectorOffset's LBA fallback into file content.
    if (dirSector < 0 || dirSector >= fmt.sectorsPerTrack(dirTrack)) break;
    const off = sectorOffset(dirTrack, dirSector);
    if (off < 0) break;

    for (let i = 0; i < fmt.entriesPerSector; i++) {
      const entryOff = off + i * fmt.entrySize;
      const typeByte = data[entryOff + 2];

      if (typeByte === 0x00) {
        const fileTrack = data[entryOff + 3];
        const fileSector = data[entryOff + 4];
        const blocks = data[entryOff + 30] | (data[entryOff + 31] << 8);
        let hasName = false;
        for (let j = 0; j < 16; j++) {
          if (data[entryOff + 5 + j] !== 0x00 && data[entryOff + 5 + j] !== 0xA0) {
            hasName = true; break;
          }
        }
        if (!hasName && fileTrack === 0 && fileSector === 0 && blocks === 0) continue;
      }

      const name = readPetsciiString(data, entryOff + 5, 16);
      const blocks = data[entryOff + 30] | (data[entryOff + 31] << 8);
      const closed = (typeByte & 0x80) !== 0;
      const deleted = !closed;

      if (deleted) {
        const idx = typeByte & 0x07;
        const typeName = FILE_TYPES[idx] || 'DEL';
        const locked = (typeByte & 0x40) !== 0;
        entries.push({ name, type: '*' + typeName + (locked ? '<' : ' '), blocks, deleted: true, entryOff });
      } else {
        entries.push({ name, type: fileTypeName(typeByte), blocks, deleted: false, entryOff });
      }
    }

    dirTrack = data[off + 0];
    dirSector = data[off + 1];
  }

  return { diskName, diskId, freeBlocks, entries, format: fmt.name, tracks: currentTracks };
}

// Byte offset of a track's BAM slot inside a D81 partition. Each slot is
// 6 bytes (1 free-count byte + 5 bitmap bytes). Tracks 1-40 live in the
// first BAM sector after a 16-byte header; tracks 41-80 live in the second
// BAM sector with the same layout.
function d81PartitionBamBase(partBamOff, track) {
  if (track <= 40) return partBamOff + 0x10 + (track - 1) * 6;
  return partBamOff + 256 + 0x10 + (track - 41) * 6;
}

// ── Parse a D81 partition/subdirectory ────────────────────────────────
// startTrack = first track of the partition (header at sector 0, BAM at 1-2, dir at 3+)
// partSize = size in sectors from directory entry bytes 30-31
function parsePartition(buffer, startTrack, partSize) {
  const data = new Uint8Array(buffer);
  const fmt = currentFormat;

  // Partition header is at (startTrack, 0) — same layout as D81 root header
  const headerOff = sectorOffset(startTrack, 0);
  if (headerOff < 0) return null;

  const diskName = readPetsciiString(data, headerOff + fmt.nameOffset, fmt.nameLength);
  const diskId = readPetsciiString(data, headerOff + fmt.idOffset, fmt.idLength, false);

  // Partition BAM is at (startTrack, 1) and (startTrack, 2)
  // Count free blocks from the partition's own BAM
  const partBamOff = sectorOffset(startTrack, 1);
  const numPartTracks = Math.floor(partSize / fmt.partitionSpt);
  let freeBlocks = 0;
  for (let t = 1; t <= numPartTracks; t++) {
    // Skip the partition's own system track (track 1 = first track of partition)
    if (t === 1) continue;
    freeBlocks += data[d81PartitionBamBase(partBamOff, t)];
  }

  // Directory chain starts at (startTrack, 3)
  const entries = [];
  let dirTrack = startTrack;
  let dirSector = 3;
  const visited = new Set();

  while (dirTrack !== 0) {
    const key = `${dirTrack}:${dirSector}`;
    if (visited.has(key)) break;
    visited.add(key);

    // Dir chain uses physical T:S even on FD (file chain bytes use LBA,
    // but dir-chain bytes don't). Validate against physical SPT so
    // garbage chain pointers (e.g., game(d2m).d2m's leftover `03 e0` at
    // the end of an 8-entry dir) terminate cleanly instead of being
    // followed via sectorOffset's LBA fallback into file content.
    if (dirSector < 0 || dirSector >= fmt.sectorsPerTrack(dirTrack)) break;
    const off = sectorOffset(dirTrack, dirSector);
    if (off < 0) break;

    for (let i = 0; i < fmt.entriesPerSector; i++) {
      const entryOff = off + i * fmt.entrySize;
      const typeByte = data[entryOff + 2];

      if (typeByte === 0x00) {
        const fileTrack = data[entryOff + 3];
        const fileSector = data[entryOff + 4];
        const blocks = data[entryOff + 30] | (data[entryOff + 31] << 8);
        let hasName = false;
        for (let j = 0; j < 16; j++) {
          if (data[entryOff + 5 + j] !== 0x00 && data[entryOff + 5 + j] !== 0xA0) {
            hasName = true; break;
          }
        }
        if (!hasName && fileTrack === 0 && fileSector === 0 && blocks === 0) continue;
      }

      const name = readPetsciiString(data, entryOff + 5, 16);
      const blocks = data[entryOff + 30] | (data[entryOff + 31] << 8);
      const closed = (typeByte & 0x80) !== 0;
      const deleted = !closed;

      if (deleted) {
        const idx = typeByte & 0x07;
        const typeName = FILE_TYPES[idx] || 'DEL';
        const locked = (typeByte & 0x40) !== 0;
        entries.push({ name, type: '*' + typeName + (locked ? '<' : ' '), blocks, deleted: true, entryOff });
      } else {
        entries.push({ name, type: fileTypeName(typeByte), blocks, deleted: false, entryOff });
      }
    }

    dirTrack = data[off + 0];
    dirSector = data[off + 1];
  }

  return { diskName, diskId, freeBlocks, entries, format: fmt.name, tracks: currentTracks, isPartition: true };
}



// ── Create empty disk image ──────────────────────────────────────────
function createEmptyDisk(formatKey, numTracks) {
  // CMD native formats: DNP, D1M, D2M, D4M
  if (formatKey === 'dnp' || formatKey === 'd1m' || formatKey === 'd2m' || formatKey === 'd4m') {
    return createCmdNativeImage(formatKey, numTracks);
  }

  const fmt = DISK_FORMATS[formatKey || 'd64'];
  if (!fmt) throw new Error('Unknown format: ' + formatKey);

  numTracks = numTracks || fmt.sizes[0].tracks;
  const size = totalSectors(fmt, numTracks) * 256;
  const data = new Uint8Array(size);

  // Set active format
  currentFormat = fmt;
  currentTracks = numTracks;

  const bamOff = (() => {
    const offsets = getTrackOffsets(fmt, numTracks);
    return offsets[fmt.bamTrack] + fmt.bamSector * 256;
  })();

  fmt.initBAM(data, bamOff, numTracks);

  // First directory sector
  const dirOff = (() => {
    const offsets = getTrackOffsets(fmt, numTracks);
    return offsets[fmt.dirTrack] + fmt.dirSector * 256;
  })();
  data[dirOff + 0] = 0x00;
  data[dirOff + 1] = 0xFF;

  return data.buffer;
}



// ── Safe PETSCII characters ──────────────────────────────────────────
var allowUnsafeChars = localStorage.getItem('cbm-allowUnsafe') === 'true';

const SAFE_PETSCII = new Set([
  0x01,0x02,0x03,0x04,0x05,0x06,0x07,0x08,0x09,0x0A,0x0B,0x0C,0x0E,0x0F,
  0x10,0x11,0x12,0x13,0x15,0x16,0x17,0x18,0x19,0x1A,0x1B,0x1C,0x1D,0x1E,0x1F,
  0x20,0x21,0x23,0x24,0x25,0x26,0x27,0x28,0x29,0x2A,0x2B,0x2C,0x2D,0x2E,0x2F,
  0x30,0x31,0x32,0x33,0x34,0x35,0x36,0x37,0x38,0x39,0x3A,0x3B,0x3C,0x3D,0x3E,0x3F,
  0x40,0x41,0x42,0x43,0x44,0x45,0x46,0x47,0x48,0x49,0x4A,0x4B,0x4C,0x4D,0x4E,0x4F,
  0x50,0x51,0x52,0x53,0x54,0x55,0x56,0x57,0x58,0x59,0x5A,0x5B,0x5C,0x5D,0x5E,0x5F,
  0x80,0x81,0x82,0x83,0x84,0x85,0x86,0x87,0x88,0x89,0x8A,0x8B,0x8C,0x8E,0x8F,
  0x90,0x91,0x92,0x93,0x94,0x95,0x96,0x97,0x98,0x99,0x9A,0x9B,0x9C,0x9D,0x9E,0x9F,
  0xA1,0xA2,0xA3,0xA4,0xA5,0xA6,0xA7,0xA8,0xA9,0xAA,0xAB,0xAC,0xAD,0xAE,0xAF,
  0xB0,0xB1,0xB2,0xB3,0xB4,0xB5,0xB6,0xB7,0xB8,0xB9,0xBA,0xBB,0xBC,0xBD,0xBE,0xBF,
  0xC0,0xC1,0xC2,0xC3,0xC4,0xC5,0xC6,0xC7,0xC8,0xC9,0xCA,0xCB,0xCC,0xCD,0xCE,0xCF,
  0xD0,0xD1,0xD2,0xD3,0xD4,0xD5,0xD6,0xD7,0xD8,0xD9,0xDA,0xDB,0xDC,0xDD,0xDE,0xDF,
]);
