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

// ── Directory-entry field offsets (32-byte CBM-DOS entry) ────────────
var DIRENT_TYPE = 0x02;
var DIRENT_TRACK = 0x03;
var DIRENT_SECTOR = 0x04;
var DIRENT_NAME = 0x05;
var DIRENT_GEOS_INFO_TRACK = 0x15;  // REL: side-sector T/S
var DIRENT_GEOS_INFO_SECTOR = 0x16;
var DIRENT_GEOS_STRUCT = 0x17;      // REL: record length
var DIRENT_GEOS_TYPE = 0x18;
var DIRENT_BLOCKS_LO = 0x1E;        // file size in blocks / partition size in sectors
var DIRENT_BLOCKS_HI = 0x1F;

function direntBlocks(data, entryOff) {
  return data[entryOff + DIRENT_BLOCKS_LO] | (data[entryOff + DIRENT_BLOCKS_HI] << 8);
}

// ── CMD native-partition BAM helpers (DNP / D1M / D2M / D4M) ─────────
// DNP BAM: header at T1/S2, then one 32-byte MSB-first slot per track
// (8 per sector). Track 1 starts the image, so T1/Sn is always at n*256.
function _cmdBamBase(track) {
  return (2 + (track >> 3)) * 256 + (track & 7) * 32;
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
// The CMD ROM treats T1 sectors 0-63 as reserved regardless of bitmap
// state, so "blocks free" skips the first 8 bitmap bytes of the dir track.
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
// One 32-byte slot per *logical* 256-sector track, packed from T1/S2
// +$20; T1/S2 +$08 holds the slot count. A trailing slot of 16×$FF +
// 16×$00 is a half-formatted disk's system marker and isn't counted.
var _FD_BAM_HDR = 2 * 256; // T1/S2
function _fdBamBase(track) {
  return _FD_BAM_HDR + 32 + (track - 1) * 32;
}
function _fdLogicalTrackCount(data) {
  if (_FD_BAM_HDR + 0x09 > data.length) return 0;
  return data[_FD_BAM_HDR + 0x08];
}
function _fdLastSlotIsSystemMarker(data, hdrOff, n) {
  var off = hdrOff + 0x20 + (n - 1) * 32;
  if (off + 32 > data.length) return false;
  for (var i = 0; i < 16; i++) if (data[off + i] !== 0xFF) return false;
  for (var j = 16; j < 32; j++) if (data[off + j] !== 0x00) return false;
  return true;
}
function _fdEffectiveSlots(data) {
  var n = _fdLogicalTrackCount(data);
  if (n === 0) return 0;
  return _fdLastSlotIsSystemMarker(data, _FD_BAM_HDR, n) ? n - 1 : n;
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
  var startByte = (track === 1) ? 8 : 0; // T1 sectors 0-63 reserved, as on DNP
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
    hasSoftWriteProtect: true, // BAM +$02 (DOS version) gates writes — see isSoftWriteProtected
    supportsSpeederBam: true, // 40-track speeder DOSs (SpeedDOS/DolphinDOS) — see getSpeederVariant
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
    // BAM: 4 bytes per track (free count + 3 bitmap bytes), tracks 1-35.
    // On 40-track disks, tracks 36-40 use a speeder-DOS extended BAM at
    // a variant-dependent offset — see getSpeederVariant / _d64BamEntry.
    bamTracksRange(numTracks) {
      if (numTracks <= 35) return numTracks;
      return (currentBuffer && getSpeederVariant(currentBuffer, getCurrentCtx())) ? numTracks : 35;
    },
    getBamBitmapBase(bamOff, track) { return _d64BamEntry(bamOff, track, null) + 1; },
    readTrackFree(data, bamOff, track) {
      return data[_d64BamEntry(bamOff, track, data)];
    },
    writeTrackFree(data, bamOff, track, free) {
      data[_d64BamEntry(bamOff, track, data)] = free;
    },
    readTrackBitmap(data, bamOff, track) {
      const base = _d64BamEntry(bamOff, track, data);
      return data[base + 1] | (data[base + 2] << 8) | (data[base + 3] << 16);
    },
    writeTrackBitmap(data, bamOff, track, bm) {
      const base = _d64BamEntry(bamOff, track, data);
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
    hasSoftWriteProtect: true, // BAM +$02 (DOS version) gates writes — see isSoftWriteProtected
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
    getBamBitmapBase(bamOff, track) {
      // Primary BAM (tracks 1-35): 4 bytes/track (free count + 3 bitmap)
      // Secondary BAM at T53/S0 (tracks 36-70): 3 bitmap bytes, no leading
      // free-count byte (free counts for that half live in the primary BAM header).
      if (track <= 35) return bamOff + 4 * track + 1;
      return this._bam2Off(bamOff) + (track - 36) * 3;
    },
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

      // Side 2: free counts at T18/S0 +$DD, bitmaps at T53/S0. The 1571
      // allocates all of T53 (D71.TXT), so it counts 0 free. Tracks
      // 71-80 of extended images are outside the BAM.
      const bam2Off = this._bam2Off(bamOff);
      const maxBamTrack = Math.min(numTracks, 70);
      for (let t = 36; t <= maxBamTrack; t++) {
        const spt = this.sectorsPerTrack(t);
        const bmBase = bam2Off + (t - 36) * 3;
        const bm = t === 53 ? 0 : (1 << spt) - 1;
        data[bamOff + 0xDD + (t - 36)] = t === 53 ? 0 : spt;
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
    dirInterleave: 1,         // D81.TXT: dir uses interleave 1, not 3

    hasBamFreeCounts: true,
    hasSoftWriteProtect: true, // BAM +$02 (DOS version) gates writes — see isSoftWriteProtected
    hasAutoBootFlag: true,    // BAM +$07 = 1581 auto-boot loader flag — see hasD81AutoBootLoader
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
    _bamBase(bamOff, track) { return d81BamEntryBase(bamOff, track); },
    getBamBitmapBase(bamOff, track) { return this._bamBase(bamOff, track) + 1; },
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
      data[headerOff + 0x02] = this.dosVersion;
      data[headerOff + 0x03] = 0x00;
      for (var i = 0; i < 16; i++) data[headerOff + this.nameOffset + i] = 0xA0;
      data[headerOff + 0x14] = 0xA0;
      data[headerOff + 0x15] = 0xA0;
      data[headerOff + 0x16] = 0xA0; // disk ID
      data[headerOff + 0x17] = 0xA0;
      data[headerOff + 0x18] = 0xA0;
      data[headerOff + 0x19] = this.dosType.charCodeAt(0);
      data[headerOff + 0x1A] = this.dosType.charCodeAt(1);
      data[headerOff + 0x1B] = 0xA0;
      data[headerOff + 0x1C] = 0xA0;
      for (i = 0x1D; i < 0x100; i++) data[headerOff + i] = 0x00;

      // BAM sectors: T40/S1 covers tracks 1-40 and links to T40/S2 (41-80).
      var bam2Off = bamOff + 256;
      _d81WriteBamHeader(data, bamOff, this.dirTrack, 2, 0xA0, 0xA0);
      _d81WriteBamHeader(data, bam2Off, 0x00, 0xFF, 0xA0, 0xA0);

      for (var t = 1; t <= numTracks; t++) {
        _d81WriteBamEntry(data, this._bamBase(bamOff, t), t === this.dirTrack ? 'system' : 'free');
      }
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
    defaultInterleave: 1,
    dirInterleave: 1, // D80-D82.TXT line 130: files AND directory use interleave 1
    hasBamFreeCounts: true,
    hasSoftWriteProtect: true, // BAM +$02 (DOS version) gates writes — see isSoftWriteProtected
    interleavePresets: [
      { value: 1, label: '8050/8250 Standard', desc: 'Interleave 1 \u2014 stock CBM DOS for IEEE-488 drives (8050/8250 buffer whole tracks)' },
    ],
    interleaveDefault: 0,
    sizes: [
      { tracks: 77, bytes: 533248, label: '77 Tracks' },
      { tracks: 77, bytes: 535331, label: '77 Tracks + Errors' }, // 533248 + 2083 error bytes
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
    getBamBitmapBase(bamOff, track) { return this._bamEntryBase(bamOff, track) + 1; },
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
      var headerOff = getTrackOffsets(this, numTracks)[this.headerTrack] + this.headerSector * 256;

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
      for (var fi = 0x1D; fi <= 0x20; fi++) data[headerOff + fi] = 0xA0;

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
      var dirOff = getTrackOffsets(this, numTracks)[this.dirTrack] + this.dirSector * 256;
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
    defaultInterleave: 1,
    dirInterleave: 1, // D80-D82.TXT line 130: files AND directory use interleave 1
    hasBamFreeCounts: true,
    hasSoftWriteProtect: true, // BAM +$02 (DOS version) gates writes — see isSoftWriteProtected
    interleavePresets: [
      { value: 1, label: '8050/8250 Standard', desc: 'Interleave 1 \u2014 stock CBM DOS for IEEE-488 drives (8050/8250 buffer whole tracks)' },
    ],
    interleaveDefault: 0,
    sizes: [
      { tracks: 154, bytes: 1066496, label: '154 Tracks' },
      { tracks: 154, bytes: 1070662, label: '154 Tracks + Errors' }, // 1066496 + 4166 error bytes
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
    getBamBitmapBase(bamOff, track) { return this._bamEntryBase(bamOff, track) + 1; },
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
      var headerOff = getTrackOffsets(this, numTracks)[this.headerTrack] + this.headerSector * 256;

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
      for (var fi = 0x1D; fi <= 0x20; fi++) data[headerOff + fi] = 0xA0;

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

      var dirOff = getTrackOffsets(this, numTracks)[this.dirTrack] + this.dirSector * 256;
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
    dirInterleave: 1,        // CMD native: whole-track buffering, no skip
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
    dirInterleave: 1,
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
    dirInterleave: 1,
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
    dirInterleave: 1,
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
    isTape: true,           // read-only cassette image, not a disk
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
    isTape: true,           // read-only tape archive, not a disk
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
  // CFS 0.11 inside an IDE64 partition: currentFormat while one is open,
  // so code can branch on .filesystem. The CBM-DOS hooks are placeholders.
  cfs: {
    name: 'CFS',
    ext: '.hdd',
    filesystem: 'cfs',
    sectorSize: 512,
    isTape: false,
    dirTrack: 0,
    dirSector: 0,
    headerTrack: 0,
    headerSector: 0,
    bamTrack: 0,
    bamSector: 0,
    dosVersion: 0x00,
    dosType: 'CF',
    nameOffset: 0,
    nameLength: 16,
    idOffset: 0,
    idLength: 0,
    maxDirSectors: 0,
    entriesPerSector: 16,
    entrySize: 32,
    doubleSidedFlag: 0x00,
    fileTypes: [],
    sizes: [],
    sectorsPerTrack: function() { return 0; },
    bamTracksRange: function() { return 0; },
    readTrackFree: function() { return 0; },
    writeTrackFree: function() {},
    readTrackBitmap: function() { return 0; },
    writeTrackBitmap: function() {},
    initBAM: function() {},
  },
  // IDE64 .hdd — a container, not a CBM-DOS filesystem. Descriptor exists
  // only so the tab/save-as machinery has something to point at; CFS-aware
  // code branches on filesystem === 'ide64-container' before any T/S code
  // can run. Detection lives in cbm-format-ide64.js (boot-sector magic).
  hdd: {
    name: 'IDE64 HDD',
    ext: '.hdd',
    filesystem: 'ide64-container',
    isTape: false,
    dirTrack: 0,
    dirSector: 0,
    headerTrack: 0,
    headerSector: 0,
    bamTrack: 0,
    bamSector: 0,
    dosVersion: 0x00,
    dosType: 'I6',
    nameOffset: 0,
    nameLength: 8,
    idOffset: 0,
    idLength: 0,
    maxDirSectors: 0,
    entriesPerSector: 0,
    entrySize: 32,
    doubleSidedFlag: 0x00,
    fileTypes: [],
    sizes: [], // variable size; detected by boot-sector magic
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
// CMD native (DNP/D1M/D2M/D4M): BAM slots have no leading free-count byte,
// so the bitmap starts at the slot base. bamOff is unused for these formats
// because each format already knows its own slot layout via _bamBase.
var _cmdGetBamBitmapBase = function(bamOff, track) { return this._bamBase(track); };
['dnp', 'd1m', 'd2m', 'd4m'].forEach(function(k) {
  DISK_FORMATS[k].bamBitMask = _cmdBamBitMask;
  DISK_FORMATS[k].getProtectedSectors = _cmdGetProtectedSectors;
  DISK_FORMATS[k].getBamBitmapBase = _cmdGetBamBitmapBase;
});

// D1M/D2M/D4M system partition on the last track (signature sector 5,
// partition dir 8-11, per VICE fsimage-create.c): never allocated to
// files, yet VICE leaves it free in the BAM (getBamOmittedSectors).
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
// The FD BAM is indexed by logical 256-sector track, not by the physical
// SPT the descriptor declares; BAM walkers iterate with these.
var _cmdFdGetBamIterTracks = function(data) {
  return _fdEffectiveSlots(data);
};
var _cmdFdGetBamIterSectorsPerTrack = function(track) {
  return 256;
};
['d1m', 'd2m', 'd4m'].forEach(function(k) {
  DISK_FORMATS[k].getProtectedSectors = _cmdFdGetProtectedSectors;
  DISK_FORMATS[k].getBamOmittedSectors = _cmdFdGetBamOmittedSectors;
  DISK_FORMATS[k].getBamIterTracks = _cmdFdGetBamIterTracks;
  DISK_FORMATS[k].getBamIterSectorsPerTrack = _cmdFdGetBamIterSectorsPerTrack;
  // Dir and file-chain T:S are logical: LBA = (T-1)*256 + S, whatever the physical SPT.
  DISK_FORMATS[k].lbaAddressing = true;
});

// D71: the 1571 allocates all of T53 (side-2 BAM track), not just 53/0.
DISK_FORMATS.d71.getProtectedSectors = function(track) {
  if (track !== 53) return _defaultGetProtectedSectors.call(this, track);
  var secs = [];
  for (var s = 0; s < this.sectorsPerTrack(track); s++) secs.push(s);
  return secs;
};

// A flat RAMLink dump is a DNP; the alias only keeps the name and .rml suffix.
DISK_FORMATS.ramlink = Object.assign({}, DISK_FORMATS.dnp, {
  name: 'RAMLink',
  ext: '.rml',
  // Both .rml and .rl are seen in the wild — save-as keeps whichever
  // extension the user opened; only canonical .rml is added if neither.
  extAlternates: ['.rl'],
});

// CMD HD — same container shape as RAMLink (32-slot partition table,
// Native sub-partitions are DNP). Aliased here so save-as keeps the .dhd
// suffix and the disk-format pipeline recognises the format key.
DISK_FORMATS.dhd = Object.assign({}, DISK_FORMATS.dnp, {
  name: 'CMD HD',
  ext: '.dhd',
});

// ── Active format ────────────────────────────────────────────────────
var currentFormat = DISK_FORMATS.d64;
var currentTracks = 35;
var parsedT64Entries = null; // entryOff → { t64DataOffset, t64StartAddr, t64EndAddr }
var parsedTAPEntries = null; // entryOff → { fileData: Uint8Array }
var parsedTapeDir = null;    // last parsed tape directory entries array

// ── Sector geometry (delegates to current format) ────────────────────
function sectorsPerTrack(t, ctx) {
  return ctx.format.sectorsPerTrack(t);
}

// Bounds for T/S links in dir and file chains. On lbaAddressing formats
// (D1M/D2M/D4M) links are logical: S runs 0-255 on every track and the
// last logical track may be partial.
function _lbaSectorCount(ctx) {
  var n = ctx.tracks * ctx.format.sectorsPerTrack(1);
  if (ctx.buffer) n = Math.min(n, Math.floor(ctx.buffer.byteLength / 256));
  return n;
}
function chainTrackCount(ctx) {
  if (!ctx.format.lbaAddressing) return ctx.tracks;
  return Math.ceil(_lbaSectorCount(ctx) / 256);
}
function chainSectorsPerTrack(track, ctx) {
  if (!ctx.format.lbaAddressing) return ctx.format.sectorsPerTrack(track);
  return Math.max(0, Math.min(256, _lbaSectorCount(ctx) - (track - 1) * 256));
}
function isValidChainLink(track, sector, ctx) {
  return track >= 1 && track <= chainTrackCount(ctx) &&
         sector >= 0 && sector < chainSectorsPerTrack(track, ctx);
}

// ── BAM byte-level helpers (partition-aware, handles D81 >32 sectors) ─
// Entry (free-count byte) of a D81 sub-partition's BAM for a track given
// relative to the partition start (1 = its first track).
function getPartitionBamEntry(bamOff, relTrack, ctx) {
  return d81BamEntryBase(bamOff, ctx.partition.startTrack + relTrack - 1);
}

// Byte offset of a track's bitmap bytes. Inside a D81 sub-partition,
// bamOff is the partition's own BAM and track is absolute.
function getBamBitmapBase(track, bamOff, ctx) {
  var partition = ctx.partition;
  if (partition && !partition.dnpDir) return d81BamEntryBase(bamOff, track) + 1;
  return ctx.format.getBamBitmapBase(bamOff, track);
}

/** @param {Uint8Array} data @param {number} bamOff @param {number} track @param {number} sector @returns {boolean} */
function checkSectorFree(data, bamOff, track, sector, ctx) {
  if (ctx.format.isSectorFree) return ctx.format.isSectorFree(data, bamOff, track, sector);
  var base = getBamBitmapBase(track, bamOff, ctx);
  return (data[base + (sector >> 3)] & ctx.format.bamBitMask(sector)) !== 0;
}

/** @param {Uint8Array} data @param {number} track @param {number} sector @param {number} bamOff */
function bamMarkSectorUsed(data, track, sector, bamOff, ctx) {
  var base = getBamBitmapBase(track, bamOff, ctx);
  data[base + (sector >> 3)] &= ~ctx.format.bamBitMask(sector);
  bamRecalcFree(data, track, bamOff, ctx);
}

/** @param {Uint8Array} data @param {number} track @param {number} sector @param {number} bamOff */
function bamMarkSectorFree(data, track, sector, bamOff, ctx) {
  var base = getBamBitmapBase(track, bamOff, ctx);
  data[base + (sector >> 3)] |= ctx.format.bamBitMask(sector);
  bamRecalcFree(data, track, bamOff, ctx);
}

/** @param {Uint8Array} data @param {number} track @param {number} bamOff */
function bamRecalcFree(data, track, bamOff, ctx) {
  var fmt = ctx.format;
  var partition = ctx.partition;
  var spt = fmt.sectorsPerTrack(track);
  var numBytes = Math.ceil(spt / 8);
  var base = getBamBitmapBase(track, bamOff, ctx);
  var free = 0;
  for (var i = 0; i < numBytes; i++) {
    var bval = data[base + i];
    var maxBit = Math.min(8, spt - i * 8);
    for (var bit = 0; bit < maxBit; bit++) {
      if (bval & (1 << bit)) free++;
    }
  }
  if (partition && !partition.dnpDir) {
    data[d81BamEntryBase(bamOff, track)] = free;
  } else {
    fmt.writeTrackFree(data, bamOff, track, free);
  }
}

function totalSectors(format, numTracks) {
  let s = 0;
  for (let t = 1; t <= numTracks; t++) s += format.sectorsPerTrack(t);
  return s;
}


/** @param {ArrayBuffer} buffer @param {number} entryOff @returns {FileReadResult} */
function readFileData(buffer, entryOff, ctx) {
  var disk = new Uint8Array(buffer);

  // T64: read directly from stored data offset, prepend load address
  if (ctx.format === DISK_FORMATS.t64) {
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
  if (ctx.format === DISK_FORMATS.tap) {
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
    if (t < 1 || t > chainTrackCount(ctx)) return { data: new Uint8Array(bytes), error: 'Illegal track ' + t };
    if (s < 0 || s >= chainSectorsPerTrack(t, ctx)) return { data: new Uint8Array(bytes), error: 'Illegal sector ' + s + ' on track ' + t };
    var key = t + ':' + s;
    if (visited[key]) return { data: new Uint8Array(bytes), error: 'Circular reference at T:' + t + ' S:' + s };
    visited[key] = true;

    var off = sectorOffset(t, s, ctx);
    if (off < 0) return { data: new Uint8Array(bytes), error: 'Invalid sector offset' };

    var nextT = disk[off];
    var nextS = disk[off + 1];

    if (nextT === 0) {
      // Last sector: nextS = index of the last data byte
      for (var i = 2; i <= nextS && i < 256; i++) bytes.push(disk[off + i]);
    } else {
      for (var j = 2; j < 256; j++) bytes.push(disk[off + j]);
    }

    t = nextT;
    s = nextS;
  }
  return { data: new Uint8Array(bytes), error: null };
}

/** @returns {number} Byte offset of the header sector */
function getHeaderOffset(ctx) {
  var fmt = ctx.format;
  return sectorOffset(fmt.headerTrack || fmt.bamTrack, fmt.headerSector != null ? fmt.headerSector : fmt.bamSector, ctx);
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
// D64.TXT rev 1.11 lines 439-569 — error codes as the 1541 drive
// controller reports them, mapped to the human-readable description.
var ERROR_CODES = {
  0x01: 'No error',                            // 1541 err 00 — sector OK
  0x02: 'Header descriptor byte not found',    // err 20 — GCR $52 missing
  0x03: 'No SYNC sequence found',              // err 21
  0x04: 'Data descriptor byte not found',      // err 22 — GCR $55 missing
  0x05: 'Checksum error in data block',        // err 23
  0x06: 'Write verify (on format)',            // err 24
  0x07: 'Write verify error',                  // err 25
  0x08: 'Write protect on',                    // err 26
  0x09: 'Checksum error in header block',      // err 27
  0x0A: 'Write error',                         // err 28
  0x0B: 'Disk sector ID mismatch',             // err 29
  0x0F: 'Drive not ready',                     // err 74
};

// ── D64-specific spec features (D64.TXT rev 1.11) ────────────────────

// BAM entry (free-count byte) for D64 track N. Tracks 36-40 live in the
// speeder-DOS extended BAM; -1 when neither variant is present. `data`
// may be null for callers without the image (falls back to the globals).
function _d64BamEntry(bamOff, track, data) {
  if (track <= 35) return bamOff + 4 * track;
  if (!data) {
    var cur = getCurrentCtx();
    if (!cur.buffer) return -1;
    data = new Uint8Array(cur.buffer);
  }
  if (_hasFdEntries(data, bamOff + 0xC0)) return bamOff + 0xC0 + (track - 36) * 4; // SpeedDOS
  if (_hasFdEntries(data, bamOff + 0xAC)) return bamOff + 0xAC + (track - 36) * 4; // DolphinDOS
  return -1;
}


// BAM +$02 other than the format's dosVersion or $00 makes the drive fail
// every write with error 73 (D64/D71/D81 specs). Returns that byte, or
// null when writable. Reported only; writes aren't blocked.
function isSoftWriteProtected(buffer, ctx) {
  if (!buffer || !ctx.format.hasSoftWriteProtect) return null;
  var data = new Uint8Array(buffer);
  var bamOff = sectorOffset(ctx.format.bamTrack, ctx.format.bamSector, ctx);
  if (bamOff < 0) return null;
  var v = data[bamOff + 0x02];
  return (v === ctx.format.dosVersion || v === 0x00) ? null : v;
}

// 40-track speeder DOSes keep the tracks 36-40 BAM at +$C0 (SpeedDOS) or
// +$AC (DolphinDOS). Identified by plausible BAM data there, not by the
// user-editable DOS-type bytes. Returns 'SpeedDOS' | 'DolphinDOS' | null.
function getSpeederVariant(buffer, ctx) {
  if (!buffer || !ctx.format.supportsSpeederBam) return null;
  if (ctx.tracks < 40) return null;
  var data = new Uint8Array(buffer);
  var bamOff = sectorOffset(ctx.format.bamTrack, ctx.format.bamSector, ctx);
  if (bamOff < 0) return null;
  if (_hasFdEntries(data, bamOff + 0xC0)) return 'SpeedDOS';
  if (_hasFdEntries(data, bamOff + 0xAC)) return 'DolphinDOS';
  return null;
}

// 5 four-byte entries: free counts <= 17 and at least one non-zero bitmap byte.
function _hasFdEntries(data, off) {
  var anyBitmap = false;
  for (var i = 0; i < 5; i++) {
    var fc = data[off + i * 4];
    if (fc > 17) return false;
    var bm = data[off + i * 4 + 1] | data[off + i * 4 + 2] | data[off + i * 4 + 3];
    if (bm !== 0) anyBitmap = true;
  }
  return anyBitmap;
}

// C128 auto-boot: 'CBM' at T1/S0 +$00 (C128BOOT.TXT).
function hasC128BootSignature(buffer, ctx) {
  if (!buffer) return false;
  var data = new Uint8Array(buffer);
  var off = sectorOffset(1, 0, ctx);
  if (off < 0 || off + 3 > data.length) return false;
  return data[off] === 0x43 && data[off + 1] === 0x42 && data[off + 2] === 0x4D;
}

// 1581 auto-boot: BAM +$07 non-zero makes the drive run USR "COPYRIGHT CBM 86".
function hasD81AutoBootLoader(buffer, ctx) {
  if (!buffer || !ctx.format.hasAutoBootFlag) return false;
  var data = new Uint8Array(buffer);
  var bamOff = sectorOffset(ctx.format.bamTrack, ctx.format.bamSector, ctx);
  if (bamOff < 0 || bamOff + 8 > data.length) return false;
  return data[bamOff + 0x07] !== 0x00;
}


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


function _isKnownImageSize(size) {
  for (var key in DISK_FORMATS) {
    var sizes = DISK_FORMATS[key].sizes;
    for (var i = 0; i < sizes.length; i++) if (sizes[i].bytes === size) return true;
  }
  return false;
}

// X64: $43 $15 $41 $64 magic + 64-byte header in front of a regular image.
function isX64Buffer(data) {
  return data.length > 64 && data[0] === 0x43 && data[1] === 0x15 &&
         data[2] === 0x41 && data[3] === 0x64 && _isKnownImageSize(data.length - 64);
}

function parseDisk(buffer, formatHint) {
  var data = new Uint8Array(buffer);

  // Container sniffing only applies to a freshly opened file: an already
  // decoded image (re-parsed on every dir refresh) has a known image size,
  // and its first sector may happen to start with one of these magics.
  // currentG64Layout is only ever set here; file-open handlers clear it.
  if (!formatHint && !_isKnownImageSize(data.length)) {
    if (isX64Buffer(data)) {
      // The header is dropped, so the tab saves as a plain .d64.
      buffer = buffer.slice(64);
      data = new Uint8Array(buffer);
      currentBuffer = buffer;
      if (currentFileName) currentFileName = currentFileName.replace(/\.x64$/i, '.d64');
    } else if (data.length > 12 && data[0] === 0x47 && data[1] === 0x43 && data[2] === 0x52 && data[3] === 0x2D) {
      var g64Result = decodeG64toD64(data);
      buffer = g64Result.d64;
      data = new Uint8Array(buffer);
      currentBuffer = buffer;
      currentG64Layout = g64Result.layout;
    } else if (isNibBuffer(data)) {
      // NIB/NB2 decode like a G64 and are saved back as .g64.
      var nibResult = parseNibFile(data);
      buffer = nibResult.d64;
      data = new Uint8Array(buffer);
      currentBuffer = buffer;
      currentG64Layout = nibResult.layout;
      if (currentFileName) {
        currentFileName = currentFileName.replace(/\.(nib|nb2)$/i, '.g64');
        if (!/\.g64$/i.test(currentFileName)) currentFileName += '.g64';
      }
    }
  }

  // formatHint: a CMD-container partition slice whose size needn't match
  // a standard image. DNP is variable-size, so its tracks come from the slice.
  if (formatHint && DISK_FORMATS[formatHint]) {
    currentFormat = DISK_FORMATS[formatHint];
    if (formatHint === 'dnp') {
      currentTracks = Math.floor(buffer.byteLength / 65536);
      if (currentTracks < 1) currentTracks = 1;
      if (currentTracks > 255) currentTracks = 255;
    } else {
      currentTracks = currentFormat.sizes && currentFormat.sizes[0]
        ? currentFormat.sizes[0].tracks : 81;
    }
  } else {
    const detected = detectFormat(data.length, buffer);
    currentFormat = detected.format;
    currentTracks = detected.tracks;
  }

  // A standalone .rml/.rl without a partition table is a flat DNP dump.
  if (!cmdcBuffer && currentFormat === DISK_FORMATS.dnp && currentFileName && /\.(rml|rl)$/i.test(currentFileName)) {
    currentFormat = DISK_FORMATS.ramlink;
  }

  // Directory interleave is 3 unless the descriptor says otherwise.
  if (currentFormat.defaultInterleave) {
    fileInterleave = currentFormat.defaultInterleave;
    dirInterleave = (currentFormat.dirInterleave != null)
      ? currentFormat.dirInterleave
      : 3;
  }

  // Tape images use their own parsers
  if (currentFormat === DISK_FORMATS.tap) return parseTAP(buffer);
  if (currentFormat === DISK_FORMATS.t64) return parseT64(buffer);

  // Clear tape lookup maps for disk formats
  parsedT64Entries = null;
  parsedTAPEntries = null;

  const fmt = currentFormat;
  const bamOffset = sectorOffset(fmt.bamTrack, fmt.bamSector, getCurrentCtx());
  const headerOff = getHeaderOffset(getCurrentCtx());

  const diskName = readPetsciiString(data, headerOff + fmt.nameOffset, fmt.nameLength);
  const diskId = readPetsciiString(data, headerOff + fmt.idOffset, fmt.idLength, false);

  // CBM formats leave the dir track out of "blocks free"; the CMD native
  // formats count it (their dir track also holds file data).
  let freeBlocks = 0;
  const bamTracks = fmt.bamTracksRange(currentTracks);
  const skipDirTrack = !fmt.isSectorFree;
  for (let t = 1; t <= bamTracks; t++) {
    if (skipDirTrack && t === fmt.dirTrack) continue;
    freeBlocks += fmt.readTrackFree(data, bamOffset, t);
  }

  const dctx = Object.assign(getCurrentCtx(), { buffer: buffer });
  const entries = readDirChainEntries(data, fmt.dirTrack, fmt.dirSector, dctx);
  return { diskName, diskId, freeBlocks, entries, format: fmt.name, tracks: currentTracks };
}

// Directory listing entries for the dir chain starting at dirTrack/dirSector.
// Never-used slots are skipped; scratched ones are returned as deleted.
function readDirChainEntries(data, dirTrack, dirSector, ctx) {
  var fmt = ctx.format;
  var entries = [];
  var visited = {};
  while (dirTrack !== 0) {
    var key = dirTrack + ':' + dirSector;
    if (visited[key] || !isValidChainLink(dirTrack, dirSector, ctx)) break;
    visited[key] = true;
    var off = sectorOffset(dirTrack, dirSector, ctx);
    if (off < 0) break;

    for (var i = 0; i < fmt.entriesPerSector; i++) {
      var entryOff = off + i * fmt.entrySize;
      var typeByte = data[entryOff + DIRENT_TYPE];
      var blocks = direntBlocks(data, entryOff);
      if (typeByte === 0x00 && blocks === 0 &&
          data[entryOff + DIRENT_TRACK] === 0 && data[entryOff + DIRENT_SECTOR] === 0) {
        var hasName = false;
        for (var j = 0; j < 16; j++) {
          var nb = data[entryOff + DIRENT_NAME + j];
          if (nb !== 0x00 && nb !== 0xA0) { hasName = true; break; }
        }
        if (!hasName) continue;
      }
      var name = readPetsciiString(data, entryOff + DIRENT_NAME, 16);
      if (typeByte & 0x80) {
        entries.push({ name: name, type: fileTypeName(typeByte), blocks: blocks, deleted: false, entryOff: entryOff });
      } else {
        var typeName = FILE_TYPES[typeByte & 0x07] || 'DEL';
        var locked = (typeByte & 0x40) !== 0;
        entries.push({ name: name, type: '*' + typeName + (locked ? '<' : ' '), blocks: blocks, deleted: true, entryOff: entryOff });
      }
    }
    dirTrack = data[off];
    dirSector = data[off + 1];
  }
  return entries;
}

// ── D81 BAM layout (root and sub-partition) ──────────────────────────
// A sub-partition's BAM pair "has the same layout as the disk BAM on
// track 40" (D81.TXT): entries are indexed by ABSOLUTE track 1-80 and
// every sector outside the partition is marked allocated.
var _D81_TRACKS_PER_BAM_SECTOR = 40;

// Byte offset of an absolute track's 6-byte entry (free count + 5 bitmap
// bytes) in the BAM pair whose first sector is at bam1Off.
function d81BamEntryBase(bam1Off, track) {
  var f = DISK_FORMATS.d81;
  var sec = track > _D81_TRACKS_PER_BAM_SECTOR ? 1 : 0;
  var idx = (track - 1) % _D81_TRACKS_PER_BAM_SECTOR;
  return bam1Off + sec * 256 + f.partitionBamOffset + idx * f.partitionBamEntrySize;
}

// BAM sector bytes $00-$0F: link, version, complement, ID, I/O byte ($C0
// as the 1581 formats it), auto-boot flag.
function _d81WriteBamHeader(data, off, linkT, linkS, id0, id1) {
  var f = DISK_FORMATS.d81;
  data[off + 0x00] = linkT;
  data[off + 0x01] = linkS;
  data[off + 0x02] = f.dosVersion;
  data[off + 0x03] = (~f.dosVersion) & 0xFF;
  data[off + 0x04] = id0;
  data[off + 0x05] = id1;
  data[off + 0x06] = 0xC0;
  for (var i = 0x07; i < f.partitionBamOffset; i++) data[off + i] = 0x00;
}

// kind: 'free' (all 40 free), 'used' (all allocated), 'system' (sectors
// 0-3 = header, 2 BAM, first dir allocated).
function _d81WriteBamEntry(data, base, kind) {
  var spt = DISK_FORMATS.d81.partitionSpt;
  var fill = kind === 'used' ? 0x00 : 0xFF;
  for (var b = 1; b <= 5; b++) data[base + b] = fill;
  if (kind === 'system') data[base + 1] &= ~0x0F;
  data[base] = kind === 'used' ? 0 : kind === 'system' ? spt - 4 : spt;
}

// ── Parse a D81 sub-partition ─────────────────────────────────────────
// Header at startTrack/0, BAM at /1-/2, directory from /3. partSize is
// the dir entry's size in sectors. The system track isn't counted free.
function parsePartition(buffer, startTrack, partSize, ctx) {
  const data = new Uint8Array(buffer);
  const fmt = ctx.format;

  const headerOff = sectorOffset(startTrack, 0, ctx);
  if (headerOff < 0) return null;

  const diskName = readPetsciiString(data, headerOff + fmt.nameOffset, fmt.nameLength);
  const diskId = readPetsciiString(data, headerOff + fmt.idOffset, fmt.idLength, false);

  const partBamOff = sectorOffset(startTrack, 1, ctx);
  const lastTrack = startTrack + Math.floor(partSize / fmt.partitionSpt) - 1;
  let freeBlocks = 0;
  for (let t = startTrack + 1; t <= lastTrack; t++) {
    freeBlocks += data[d81BamEntryBase(partBamOff, t)];
  }

  const entries = readDirChainEntries(data, startTrack, fmt.partitionDirSector, ctx);
  return { diskName, diskId, freeBlocks, entries, format: fmt.name, tracks: ctx.tracks, isPartition: true };
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

// ── CBM-DOS dir-tree paste (cross-family writer) ─────────────────────
// Mirrors cfsPasteDirTree for D81 / DNP / D1M-D4M Native destinations,
// writing through the ctx-aware writers so the target dir comes from
// `diskCtx`. Subdirs become DNP subdirs or D81 sub-partitions.

// CFS ftype/typeSuffix → CBM typeIdx; anything not SEQ/USR/REL is PRG.
// The CFS_FTYPE values (NORMAL=1, REL=2) are inlined to avoid a dependency
// on cbm-format-ide64.js.
function cfsToCbmTypeIdx(ftype, typeSuffix) {
  if (ftype === 2) return 4; // REL
  if (typeSuffix === 'SEQ') return 1;
  if (typeSuffix === 'USR') return 3;
  if (typeSuffix === 'REL') return 4;
  return 2; // default PRG
}

function resolveFileCbmTypeIdx(file) {
  if (file.cbmTypeIdx) return file.cbmTypeIdx;
  return cfsToCbmTypeIdx(file.ftype, file.typeSuffix);
}

// Inverse of cfsToCbmTypeIdx, for CBM-collected files pasted into CFS.
function cbmToCfsTypeFields(cbmTypeIdx) {
  if (cbmTypeIdx === 4) return { ftype: 2, typeSuffix: 'REL' };
  if (cbmTypeIdx === 1) return { ftype: 1, typeSuffix: 'SEQ' };
  if (cbmTypeIdx === 3) return { ftype: 1, typeSuffix: 'USR' };
  return { ftype: 1, typeSuffix: 'PRG' };
}

function resolveFileCfsTypeFields(file) {
  if (file.ftype && file.typeSuffix) return { ftype: file.ftype, typeSuffix: file.typeSuffix };
  if (file.cbmTypeIdx) return cbmToCfsTypeFields(file.cbmTypeIdx);
  return { ftype: 1, typeSuffix: 'PRG' };
}

// Entry offset of the name in diskCtx's current dir, or -1. Padding
// ($A0 / $00 / trailing spaces) is ignored on both sides.
function _cbmFindDirEntryByNameBytes(diskCtx, nameBytes) {
  var buffer = diskCtx.buffer;
  var data = new Uint8Array(buffer);
  var fmt = diskCtx.format;
  var dctx = getDirContext(diskCtx);
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
  if (srcLen === 0) return -1;
  var t = dctx.dirTrack, s = dctx.dirSector;
  var visited = {};
  while (t !== 0) {
    var key = t + ':' + s;
    if (visited[key]) break;
    visited[key] = true;
    var off = sectorOffset(t, s, diskCtx);
    if (off < 0) break;
    for (var i = 0; i < fmt.entriesPerSector; i++) {
      var eo = off + i * fmt.entrySize;
      var typeByte = data[eo + 2];
      if (typeByte === 0) continue; // empty slot
      var enLen = trimTrailingSpaces(data.subarray(eo + 5, eo + 21), effectiveLen(data.subarray(eo + 5, eo + 21)));
      if (enLen !== srcLen) continue;
      var match = true;
      for (var k = 0; k < srcLen; k++) {
        if (data[eo + 5 + k] !== nameBytes[k]) { match = false; break; }
      }
      if (match) return eo;
    }
    t = data[off]; s = data[off + 1];
  }
  return -1;
}

// First free "NAME (N)" for N = 2..99, base truncated to fit 16 bytes.
// Returns $A0-padded name bytes, or null when all are taken.
function _cbmAutoRenameInDir(diskCtx, baseNameBytes) {
  if (!diskCtx || !diskCtx.buffer) return null;
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
    if (_cbmFindDirEntryByNameBytes(diskCtx, candidate) < 0) return candidate;
  }
  return null;
}

// Collect diskCtx's current dir (files + DNP subdirs / D81 sub-partitions,
// recursively) into the generic tree shape cfsCollectDirTree also emits.
// GEOS files carry geosBytes/geosInfoBlock; VLIR files their records.
// Returns { ok, tree, error? }.
function cbmCollectDirTree(diskCtx, sourceNameBytes) {
  if (!diskCtx || !diskCtx.buffer || !diskCtx.format) return { ok: false, error: 'invalid disk context' };
  var data = new Uint8Array(diskCtx.buffer);
  var fmt = diskCtx.format;
  var visited = {}; // cycle guard keyed by 'startT:startS' for subdirs

  function readNameBytes(entryOff) {
    var out = new Uint8Array(16);
    for (var i = 0; i < 16; i++) out[i] = data[entryOff + 5 + i];
    return out;
  }

  function walk(ctx, nameBytes) {
    var localData = new Uint8Array(ctx.buffer);
    var localFmt = ctx.format;
    var dctx = getDirContext(ctx);
    var t = dctx.dirTrack, s = dctx.dirSector;
    var node = { nameBytes: nameBytes, files: [], subdirs: [], skippedLnks: [] };
    var sectorVisited = {};
    while (t !== 0) {
      var key = t + ':' + s;
      if (sectorVisited[key]) break;
      sectorVisited[key] = true;
      var off = sectorOffset(t, s, ctx);
      if (off < 0) break;
      for (var i = 0; i < localFmt.entriesPerSector; i++) {
        var entryOff = off + i * localFmt.entrySize;
        var typeByte = localData[entryOff + 2];
        if (typeByte === 0) continue;       // empty slot
        if ((typeByte & 0x80) === 0) continue; // scratched (closed bit clear)
        var typeIdx = typeByte & 0x07;
        var fileT = localData[entryOff + 3];
        var fileS = localData[entryOff + 4];

        // DNP / Native linked subdir
        if (typeIdx === localFmt.subdirType && localFmt.subdirLinked) {
          var subKey = fileT + ':' + fileS;
          if (visited[subKey]) continue; // cycle guard
          visited[subKey] = true;
          var hdrOff = sectorOffset(fileT, fileS, ctx);
          if (hdrOff < 0) continue;
          var childCtx = Object.assign({}, ctx, {
            partition: {
              dnpDir: true,
              dnpHeaderT: fileT, dnpHeaderS: fileS,
              dnpDirT: localData[hdrOff + 0x00], dnpDirS: localData[hdrOff + 0x01],
              name: '',
            },
          });
          var subNode = walk(childCtx, readNameBytes(entryOff));
          node.subdirs.push(subNode);
          continue;
        }

        // D81 sub-partition
        if (typeIdx === localFmt.subdirType && !localFmt.subdirLinked) {
          var partSize = direntBlocks(localData, entryOff);
          if (!partSize) continue;
          var partKey = 'p' + fileT;
          if (visited[partKey]) continue;
          visited[partKey] = true;
          var childCtxP = Object.assign({}, ctx, {
            partition: { startTrack: fileT, partSize: partSize, name: '' },
          });
          var subNodeP = walk(childCtxP, readNameBytes(entryOff));
          node.subdirs.push(subNodeP);
          continue;
        }

        if (typeIdx < 1 || typeIdx > 4) continue; // SEQ/PRG/USR/REL only
        var fileName = readNameBytes(entryOff);
        // Entry bytes $15-$1D (GEOS info T/S, structure, type, date) as-is.
        var hasGeos = false;
        var geosBytes = new Uint8Array(9);
        for (var gi = 0; gi < 9; gi++) {
          geosBytes[gi] = localData[entryOff + DIRENT_GEOS_INFO_TRACK + gi];
          if (geosBytes[gi] !== 0) hasGeos = true;
        }
        var geosInfoBlock = null;
        if (hasGeos) {
          var infoT = localData[entryOff + DIRENT_GEOS_INFO_TRACK];
          var infoS = localData[entryOff + DIRENT_GEOS_INFO_SECTOR];
          if (infoT > 0) {
            var infoOff = sectorOffset(infoT, infoS, ctx);
            if (infoOff >= 0 && infoOff + 256 <= localData.length) {
              geosInfoBlock = new Uint8Array(256);
              for (var ib = 0; ib < 256; ib++) geosInfoBlock[ib] = localData[infoOff + ib];
            }
          }
        }
        var isVlir = (hasGeos && localData[entryOff + DIRENT_GEOS_STRUCT] === 0x01);

        var fileEntry = {
          nameBytes: fileName,
          cbmTypeIdx: typeIdx,
          payload: null,
          size: 0,
        };
        if (hasGeos) {
          fileEntry.geosBytes = geosBytes;
          fileEntry.geosInfoBlock = geosInfoBlock;
        }
        if (isVlir) {
          fileEntry.vlirRecords = readVLIRRecordsForCopy(ctx.buffer, entryOff, ctx);
          fileEntry.payload = new Uint8Array(0);
        } else {
          var rd = readFileData(ctx.buffer, entryOff, ctx);
          if (rd.error) {
            node.skippedLnks.push('(unreadable file)');
            continue;
          }
          fileEntry.payload = rd.data;
          fileEntry.size = rd.data.length;
        }
        node.files.push(fileEntry);
      }
      t = localData[off]; s = localData[off + 1];
    }
    return node;
  }

  // Default root-name: the source partition's disk-header label.
  if (!sourceNameBytes) {
    sourceNameBytes = new Uint8Array(16);
    var hdrOff = sectorOffset(fmt.headerTrack || fmt.bamTrack, fmt.headerSector != null ? fmt.headerSector : fmt.bamSector, diskCtx);
    if (hdrOff >= 0 && fmt.nameOffset != null) {
      for (var nb = 0; nb < 16; nb++) sourceNameBytes[nb] = data[hdrOff + fmt.nameOffset + nb] || 0xA0;
    } else {
      for (var nb2 = 0; nb2 < 16; nb2++) sourceNameBytes[nb2] = 0xA0;
    }
  }

  var tree = walk(diskCtx, sourceNameBytes);
  return { ok: true, tree: tree };
}

// Create a DNP / FD Native linked subdir (header + first dir sector) with
// a DIR entry in diskCtx's current dir. Returns { ok, error?, partition }
// with a {dnpDir:true, ...} partition for a child diskCtx.
function _cbmCreateDnpSubdir(diskCtx, name) {
  if (!diskCtx || !diskCtx.buffer || !diskCtx.format) return { ok: false, error: 'invalid disk context' };
  if (!name) return { ok: false, error: 'empty name' };
  var buffer = diskCtx.buffer;
  var fmt = diskCtx.format;
  var partition = diskCtx.partition;
  if (!fmt.subdirLinked) return { ok: false, error: 'format does not support linked subdirs' };
  var data = new Uint8Array(buffer);

  var bamOff = sectorOffset(fmt.bamTrack, fmt.bamSector, diskCtx);

  var allocated = buildTrueAllocationMap(buffer, diskCtx);
  var sectorList = allocateSectors(allocated, 2, diskCtx);
  if (sectorList.length < 2) return { ok: false, error: 'Not enough free sectors for a new subdir' };
  var hdrSec = sectorList[0];
  var dirSec = sectorList[1];

  // Pass the map so a parent-dir extension can't reuse the two sectors above.
  var entryOff = findFreeDirEntry(buffer, allocated, diskCtx);
  if (entryOff < 0) return { ok: false, error: 'No free directory entry available' };

  var parentHeaderT = fmt.headerTrack;
  var parentHeaderS = fmt.headerSector;
  if (partition && partition.dnpHeaderT !== undefined) {
    parentHeaderT = partition.dnpHeaderT;
    parentHeaderS = partition.dnpHeaderS;
  }

  var hdrOff = sectorOffset(hdrSec.track, hdrSec.sector, diskCtx);
  for (var hi = 0; hi < 256; hi++) data[hdrOff + hi] = 0x00;
  data[hdrOff + 0x00] = dirSec.track;
  data[hdrOff + 0x01] = dirSec.sector;
  data[hdrOff + 0x02] = fmt.dosVersion;
  for (var ni = 0; ni < fmt.nameLength; ni++) {
    if (ni < name.length) {
      var ch = name.charCodeAt(ni);
      data[hdrOff + fmt.nameOffset + ni] = (ch >= 0x20 && ch <= 0x7E) ? ch : 0x20;
    } else {
      data[hdrOff + fmt.nameOffset + ni] = 0xA0;
    }
  }
  // Disk ID + DOS type copied from the root header, then $A0 $A0.
  var rootHdrOff = sectorOffset(fmt.headerTrack, fmt.headerSector, diskCtx);
  for (var idi = 0; idi < fmt.idLength; idi++) {
    data[hdrOff + fmt.idOffset + idi] = data[rootHdrOff + fmt.idOffset + idi];
  }
  data[hdrOff + fmt.idOffset + fmt.idLength] = 0xA0;
  data[hdrOff + fmt.idOffset + fmt.idLength + 1] = 0xA0;
  data[hdrOff + fmt.subdirSelfRef] = hdrSec.track;
  data[hdrOff + fmt.subdirSelfRef + 1] = hdrSec.sector;
  data[hdrOff + fmt.subdirParentRef] = parentHeaderT;
  data[hdrOff + fmt.subdirParentRef + 1] = parentHeaderS;

  var dirOff = sectorOffset(dirSec.track, dirSec.sector, diskCtx);
  for (var di = 0; di < 256; di++) data[dirOff + di] = 0x00;
  data[dirOff + 0x01] = 0xFF;

  bamMarkSectorUsed(data, hdrSec.track, hdrSec.sector, bamOff, diskCtx);
  bamMarkSectorUsed(data, dirSec.track, dirSec.sector, bamOff, diskCtx);

  data[entryOff + DIRENT_TYPE] = 0x80 | fmt.subdirType;
  data[entryOff + DIRENT_TRACK] = hdrSec.track;
  data[entryOff + DIRENT_SECTOR] = hdrSec.sector;
  for (var eni = 0; eni < fmt.nameLength; eni++) {
    data[entryOff + DIRENT_NAME + eni] = data[hdrOff + fmt.nameOffset + eni];
  }
  for (var eu = DIRENT_GEOS_INFO_TRACK; eu < DIRENT_BLOCKS_LO; eu++) data[entryOff + eu] = 0x00;
  data[entryOff + DIRENT_BLOCKS_LO] = 2;
  data[entryOff + DIRENT_BLOCKS_HI] = 0;

  // +$24/$25: T/S of the parent dir block holding our entry; +$26: offset
  // of the entry's type byte in that block (D2M-DNP.TXT: $02, $22, ...).
  // Chain T/S on these formats is (offset >> 16) + 1 / (offset >> 8) & $FF.
  data[hdrOff + fmt.subdirParentEntry] = (entryOff >>> 16) + 1;
  data[hdrOff + fmt.subdirParentEntry + 1] = (entryOff >>> 8) & 0xFF;
  data[hdrOff + fmt.subdirParentEntry + 2] = (entryOff & 0xFF) + DIRENT_TYPE;

  return {
    ok: true,
    partition: {
      dnpDir: true,
      dnpHeaderT: hdrSec.track, dnpHeaderS: hdrSec.sector,
      dnpDirT: dirSec.track, dnpDirS: dirSec.sector,
      name: name,
    },
  };
}

// Create and format a D81 sub-partition (type $05) of totalSectors in a
// free contiguous track run, entry in the root dir. Size follows D81.TXT:
// a multiple of 40, at least 120. Returns { ok, error?, partition }.
function _cbmCreateD81Partition(diskCtx, name, totalSectors) {
  if (!diskCtx || !diskCtx.buffer || !diskCtx.format) return { ok: false, error: 'invalid disk context' };
  if (!name) return { ok: false, error: 'empty name' };
  var fmt = diskCtx.format;
  if (!fmt.supportsSubdirs || fmt.subdirLinked) {
    return { ok: false, error: 'format does not support D81-style CBM partitions' };
  }
  if (diskCtx.partition && diskCtx.partition.startTrack) {
    return { ok: false, error: 'D81 sub-partitions cannot be nested' };
  }
  var data = new Uint8Array(diskCtx.buffer);
  var pSpt = fmt.partitionSpt;
  var partSectors = Math.max(3 * pSpt, Math.ceil((totalSectors || 0) / pSpt) * pSpt);
  var numTracks = partSectors / pSpt;

  // Must not include the dir track (D81.TXT rule 4).
  var allocated = buildTrueAllocationMap(diskCtx.buffer, diskCtx);
  var startTrack = -1;
  for (var t = 1; t <= diskCtx.tracks - numTracks + 1; t++) {
    var endTrack = t + numTracks - 1;
    if (t <= fmt.dirTrack && endTrack >= fmt.dirTrack) continue;
    var allFree = true;
    for (var ct = t; ct <= endTrack; ct++) {
      var spt = fmt.sectorsPerTrack(ct);
      for (var cs = 0; cs < spt; cs++) {
        if (allocated[ct + ':' + cs]) { allFree = false; break; }
      }
      if (!allFree) break;
    }
    if (allFree) { startTrack = t; break; }
  }
  if (startTrack < 0) {
    return { ok: false, error: 'no contiguous free space for ' + numTracks + ' tracks' };
  }

  var entryOff = findFreeDirEntry(diskCtx.buffer, allocated, diskCtx);
  if (entryOff < 0) return { ok: false, error: 'no free directory entry' };

  data[entryOff + DIRENT_TYPE] = 0x80 | fmt.subdirType;
  data[entryOff + DIRENT_TRACK] = startTrack;
  data[entryOff + DIRENT_SECTOR] = 0;
  for (var ni = 0; ni < 16; ni++) {
    if (ni < name.length) {
      var ch = name.charCodeAt(ni);
      data[entryOff + DIRENT_NAME + ni] = (ch >= 0x20 && ch <= 0x7E) ? ch : 0x20;
    } else {
      data[entryOff + DIRENT_NAME + ni] = 0xA0;
    }
  }
  for (var ui = DIRENT_GEOS_INFO_TRACK; ui < DIRENT_BLOCKS_LO; ui++) data[entryOff + ui] = 0x00;
  data[entryOff + DIRENT_BLOCKS_LO] = partSectors & 0xFF;
  data[entryOff + DIRENT_BLOCKS_HI] = (partSectors >> 8) & 0xFF;

  // Header at startTrack/0, laid out like the root header, with the root's disk ID.
  var rootHdrOff = sectorOffset(fmt.headerTrack, fmt.headerSector, diskCtx);
  var id0 = data[rootHdrOff + fmt.idOffset], id1 = data[rootHdrOff + fmt.idOffset + 1];
  var headerOff = sectorOffset(startTrack, 0, diskCtx);
  for (var hz = 0; hz < 256; hz++) data[headerOff + hz] = 0x00;
  data[headerOff + 0x00] = startTrack;
  data[headerOff + 0x01] = fmt.partitionDirSector;
  data[headerOff + 0x02] = fmt.dosVersion;
  for (var hni = 0; hni < 16; hni++) data[headerOff + fmt.nameOffset + hni] = data[entryOff + DIRENT_NAME + hni];
  data[headerOff + 0x14] = 0xA0;
  data[headerOff + 0x15] = 0xA0;
  data[headerOff + fmt.idOffset] = id0;
  data[headerOff + fmt.idOffset + 1] = id1;
  data[headerOff + 0x18] = 0xA0;
  data[headerOff + 0x19] = fmt.dosType.charCodeAt(0);
  data[headerOff + 0x1A] = fmt.dosType.charCodeAt(1);
  data[headerOff + 0x1B] = 0xA0;
  data[headerOff + 0x1C] = 0xA0;

  // Own BAM pair, absolute-track indexed: everything outside the partition
  // allocated, its first track holding header + BAM + first dir.
  var bam1Off = sectorOffset(startTrack, 1, diskCtx);
  var bam2Off = sectorOffset(startTrack, 2, diskCtx);
  for (var bz = 0; bz < 256; bz++) { data[bam1Off + bz] = 0x00; data[bam2Off + bz] = 0x00; }
  _d81WriteBamHeader(data, bam1Off, startTrack, 2, id0, id1);
  _d81WriteBamHeader(data, bam2Off, 0x00, 0xFF, id0, id1);
  for (var at = 1; at <= _D81_TRACKS_PER_BAM_SECTOR * 2; at++) {
    var kind = at === startTrack ? 'system' : (at > startTrack && at < startTrack + numTracks) ? 'free' : 'used';
    _d81WriteBamEntry(data, d81BamEntryBase(bam1Off, at), kind);
  }

  var dirOff = sectorOffset(startTrack, fmt.partitionDirSector, diskCtx);
  for (var di = 0; di < 256; di++) data[dirOff + di] = 0x00;
  data[dirOff + 1] = 0xFF;

  var rootBamOff = sectorOffset(fmt.bamTrack, fmt.bamSector, diskCtx);
  for (var rt = startTrack; rt < startTrack + numTracks; rt++) {
    _d81WriteBamEntry(data, d81BamEntryBase(rootBamOff, rt), 'used');
  }

  return {
    ok: true,
    partition: { startTrack: startTrack, partSize: partSectors, name: name },
  };
}

// Grow the D81 sub-partition diskCtx points into by claiming the fully
// free root tracks right after its end (never the dir track), enough for
// extraSectorsNeeded. opts.dryRun only reports. Returns { ok, error?,
// addedSectors, addedTracks, newPartSize }.
function _cbmGrowD81Partition(diskCtx, extraSectorsNeeded, opts) {
  opts = opts || {};
  var dryRun = !!opts.dryRun;
  if (!diskCtx || !diskCtx.buffer || !diskCtx.format) return { ok: false, error: 'invalid disk context' };
  if (!diskCtx.partition || !diskCtx.partition.startTrack) {
    return { ok: false, error: 'not inside a D81 sub-partition' };
  }
  var fmt = diskCtx.format;
  if (!fmt.supportsSubdirs || fmt.subdirLinked) {
    return { ok: false, error: 'format does not host D81-style partitions' };
  }
  var pSpt = fmt.partitionSpt;
  var data = new Uint8Array(diskCtx.buffer);
  var startTrack = diskCtx.partition.startTrack;
  var curPartSize = diskCtx.partition.partSize;
  var curNumTracks = Math.floor(curPartSize / pSpt);
  var partEndTrack = startTrack + curNumTracks - 1;

  var rootCtx = Object.assign({}, diskCtx, { partition: null });
  var rootDir = getDirContext(rootCtx);
  var entryOff = -1;
  var t = rootDir.dirTrack, s = rootDir.dirSector;
  var visited = {};
  while (t !== 0 && entryOff < 0) {
    var k = t + ':' + s;
    if (visited[k]) break;
    visited[k] = true;
    var off = sectorOffset(t, s, rootCtx);
    if (off < 0) break;
    for (var i = 0; i < fmt.entriesPerSector; i++) {
      var eo = off + i * fmt.entrySize;
      var typeByte = data[eo + DIRENT_TYPE];
      if ((typeByte & 0x80) === 0) continue;
      if ((typeByte & 0x07) !== fmt.subdirType) continue;
      if (data[eo + DIRENT_TRACK] === startTrack && data[eo + DIRENT_SECTOR] === 0) { entryOff = eo; break; }
    }
    t = data[off + 0]; s = data[off + 1];
  }
  if (entryOff < 0) {
    return { ok: false, error: 'parent dir entry for the partition not found in the root' };
  }

  var rootBamOff = sectorOffset(fmt.bamTrack, fmt.bamSector, rootCtx);
  function trackIsFreeInRoot(track) {
    if (track === fmt.dirTrack || track < 1 || track > diskCtx.tracks) return false;
    return data[d81BamEntryBase(rootBamOff, track)] >= fmt.sectorsPerTrack(track);
  }

  var addableTracks = 0;
  var trackCursor = partEndTrack + 1;
  var maxAddable = Math.max(1, Math.ceil(extraSectorsNeeded / pSpt));
  while (addableTracks < maxAddable && trackIsFreeInRoot(trackCursor)) {
    addableTracks++;
    trackCursor++;
  }
  if (addableTracks <= 0) {
    return { ok: false, error: 'no contiguous free tracks immediately after the partition' };
  }

  if (dryRun) {
    return {
      ok: true,
      dryRun: true,
      addedSectors: addableTracks * pSpt,
      addedTracks: addableTracks,
      newPartSize: curPartSize + addableTracks * pSpt,
    };
  }

  // New tracks: free in the partition's own BAM, used in the root BAM.
  var partBamOff = sectorOffset(startTrack, 1, diskCtx);
  for (var rt = partEndTrack + 1; rt <= partEndTrack + addableTracks; rt++) {
    _d81WriteBamEntry(data, d81BamEntryBase(partBamOff, rt), 'free');
    _d81WriteBamEntry(data, d81BamEntryBase(rootBamOff, rt), 'used');
  }

  var newPartSize = curPartSize + addableTracks * pSpt;
  data[entryOff + DIRENT_BLOCKS_LO] = newPartSize & 0xFF;
  data[entryOff + DIRENT_BLOCKS_HI] = (newPartSize >>> 8) & 0xFF;

  return {
    ok: true,
    addedSectors: addableTracks * pSpt,
    addedTracks: addableTracks,
    newPartSize: newPartSize,
  };
}

// Upper-bound sector count for pasting `tree` (paste pre-check): file
// blocks + GEOS info blocks, 2 + 1 spare per DNP subdir, whole tracks
// (plus a system track, min 3) per D81 sub-partition.
function cbmEstimateTreeSectors(tree, fmt) {
  if (!tree) return 0;
  var supportsSubdirs = fmt && fmt.supportsSubdirs;
  var subdirLinked = fmt && fmt.subdirLinked;
  var partitionSpt = (fmt && fmt.partitionSpt) || 40;
  var total = 0;
  function visit(node) {
    for (var i = 0; i < node.files.length; i++) {
      var f = node.files[i];
      if (f.vlirRecords) continue; // skipped at write time
      var size = f.size || (f.payload ? f.payload.length : 0);
      total += Math.max(1, Math.ceil(size / 254));
      if (f.geosInfoBlock) total += 1;
    }
    if (!supportsSubdirs || !node.subdirs) return;
    for (var s = 0; s < node.subdirs.length; s++) {
      var sub = node.subdirs[s];
      if (subdirLinked) {
        total += 3;
        visit(sub);
      } else {
        var inner = 0;
        for (var fi = 0; fi < sub.files.length; fi++) {
          var sf = sub.files[fi];
          if (sf.vlirRecords) continue;
          var sz = sf.size || (sf.payload ? sf.payload.length : 0);
          inner += Math.max(1, Math.ceil(sz / 254));
          if (sf.geosInfoBlock) inner += 1;
        }
        var dataTracks = Math.max(1, Math.ceil(inner / partitionSpt));
        var numTracks = Math.max(3, dataTracks + 1);
        total += numTracks * partitionSpt;
      }
    }
  }
  visit(tree);
  return total;
}

// "Blocks free" of diskCtx's current view, counted like parseDisk /
// parsePartition: the (partition) dir track is left out where files
// can't go.
function cbmCountFreeSectors(diskCtx) {
  if (!diskCtx || !diskCtx.buffer || !diskCtx.format) return 0;
  var data = new Uint8Array(diskCtx.buffer);
  var fmt = diskCtx.format;
  var partition = diskCtx.partition;
  var bamOff = getDirContext(diskCtx).bamOff;
  if (!fmt.readTrackFree) return 0;
  var startTrack = 1, endTrack = fmt.bamTracksRange(diskCtx.tracks || 1);
  var skipTrack = fmt.isSectorFree ? -1 : fmt.dirTrack;
  if (partition && !partition.dnpDir && partition.startTrack) {
    startTrack = partition.startTrack;
    endTrack = partition.startTrack + Math.floor(partition.partSize / fmt.partitionSpt) - 1;
    skipTrack = partition.startTrack;
  }
  var total = 0;
  for (var t = startTrack; t <= endTrack; t++) {
    if (t === skipTrack) continue;
    total += fmt.readTrackFree(data, bamOff, t) | 0;
  }
  return total;
}

// 16 raw name bytes → printable string (shifted letters as A-Z, padding
// and non-printables dropped) for messages.
function decodePetsciiNameForDisplay(nameBytes) {
  var s = '';
  if (!nameBytes) return s;
  for (var i = 0; i < 16; i++) {
    var b = nameBytes[i];
    if (b === 0xA0 || b === 0x00) break;
    if (b >= 0xC1 && b <= 0xDA) s += String.fromCharCode(b - 0x80);
    else if (b >= 0x20 && b <= 0x7E) s += String.fromCharCode(b);
  }
  return s.replace(/ +$/, '');
}

// Name collisions cbmPasteDirTree would hit at the destination's top
// level: { topLevel, files[], subdirs[], total }. In wrap mode only the
// wrapper name is checked; merges into an existing dir aren't descended.
function cbmFindTreeConflicts(diskCtx, tree) {
  var out = { topLevel: null, files: [], subdirs: [], total: 0 };
  if (!diskCtx || !diskCtx.buffer || !diskCtx.format || !tree) return out;
  var fmt = diskCtx.format;
  var hostsSubdirs = !!fmt.supportsSubdirs &&
                     (fmt.subdirLinked || !(diskCtx.partition && diskCtx.partition.startTrack));
  if (hostsSubdirs && tree.nameBytes) {
    if (_cbmFindDirEntryByNameBytes(diskCtx, tree.nameBytes) >= 0) {
      out.topLevel = decodePetsciiNameForDisplay(tree.nameBytes);
      out.total++;
    }
    return out;  // wrap mode: files inside go into the new wrapper, no inner conflicts
  }
  // No wrap: tree.files + tree.subdirs are pasted directly.
  if (tree.files) {
    for (var i = 0; i < tree.files.length; i++) {
      var f = tree.files[i];
      if (_cbmFindDirEntryByNameBytes(diskCtx, f.nameBytes) >= 0) {
        out.files.push(decodePetsciiNameForDisplay(f.nameBytes));
        out.total++;
      }
    }
  }
  if (tree.subdirs) {
    for (var si = 0; si < tree.subdirs.length; si++) {
      var sub = tree.subdirs[si];
      if (_cbmFindDirEntryByNameBytes(diskCtx, sub.nameBytes) >= 0) {
        out.subdirs.push(decodePetsciiNameForDisplay(sub.nameBytes));
        out.total++;
      }
    }
  }
  return out;
}

// Paste a generic dir tree into diskCtx's current dir, wrapped in a new
// subdir named tree.nameBytes unless opts.flat. opts.onConflict:
// 'overwrite' replaces same-named files (freeing their sectors) and merges
// into same-named dirs, 'rename' auto-suffixes, 'cancel' refuses.
// A file never replaces a dir/partition or vice versa.
// Returns { ok, error?, copiedFiles, copiedDirs, skippedLnks, skippedDirs }.
function cbmPasteDirTree(diskCtx, tree, opts) {
  if (!diskCtx || !diskCtx.buffer || !diskCtx.format) return { ok: false, error: 'invalid disk context' };
  if (!tree) return { ok: false, error: 'invalid tree' };
  opts = opts || {};
  var onConflict = opts.onConflict || 'cancel';
  var wrap = !opts.flat;

  var copiedFiles = 0;
  var copiedDirs = 0;
  var skippedLnks = (tree.skippedLnks || []).slice();
  var skippedDirs = [];
  var _displayName = decodePetsciiNameForDisplay;

  var fmt = diskCtx.format;
  var targetCtx = diskCtx;
  // DNP-style subdirs nest freely; D81 sub-partitions only at the root.
  function _hostsSubdirs(ctx) {
    var f = ctx.format;
    if (f.subdirLinked) return true;
    return !!f.supportsSubdirs && !(ctx.partition && ctx.partition.startTrack);
  }
  function _isDirEntry(ctx, entryOff) {
    var tb = new Uint8Array(ctx.buffer)[entryOff + DIRENT_TYPE];
    return !!ctx.format.supportsSubdirs && (tb & 0x07) === ctx.format.subdirType;
  }
  function _createSubdir(ctx, subName, dataSectors) {
    var f = ctx.format;
    if (f.subdirLinked) return _cbmCreateDnpSubdir(ctx, subName);
    // Data demand plus a system track; the creator applies the spec minimum.
    var pSpt = f.partitionSpt;
    var totalSectors = (Math.ceil((dataSectors || 0) / pSpt) + 1) * pSpt;
    return _cbmCreateD81Partition(ctx, subName, totalSectors);
  }
  function _childCtxForExisting(ctx, existingEntryOff) {
    var f = ctx.format;
    var d = new Uint8Array(ctx.buffer);
    var hdrT = d[existingEntryOff + DIRENT_TRACK];
    var hdrS = d[existingEntryOff + DIRENT_SECTOR];
    if (f.subdirLinked) {
      var hOff = sectorOffset(hdrT, hdrS, ctx);
      if (hOff < 0) return null;
      return Object.assign({}, ctx, {
        partition: {
          dnpDir: true,
          dnpHeaderT: hdrT, dnpHeaderS: hdrS,
          dnpDirT: d[hOff + 0x00], dnpDirS: d[hOff + 0x01],
          name: '',
        },
      });
    }
    var pSize = direntBlocks(d, existingEntryOff);
    return Object.assign({}, ctx, {
      partition: { startTrack: hdrT, partSize: pSize, name: '' },
    });
  }
  if (wrap && _hostsSubdirs(diskCtx) && tree.nameBytes) {
    var topName = _displayName(tree.nameBytes);
    if (topName) {
      var existing = _cbmFindDirEntryByNameBytes(diskCtx, tree.nameBytes);
      if (existing >= 0 && onConflict !== 'overwrite' && onConflict !== 'rename') {
        return { ok: false, error: 'A "' + topName + '" already exists; choose Overwrite or Rename.' };
      }
      var createNameStr = topName;
      if (existing >= 0 && onConflict === 'rename') {
        var renamedBytes = _cbmAutoRenameInDir(diskCtx, tree.nameBytes);
        if (!renamedBytes) return { ok: false, error: 'All " (N)" rename suffixes 2..99 are taken; choose a different destination.' };
        createNameStr = _displayName(renamedBytes);
        existing = -1;
      }
      if (existing >= 0) {
        if (!_isDirEntry(diskCtx, existing)) {
          return { ok: false, error: 'A file named "' + topName + '" already exists; a directory can\'t replace it.' };
        }
        var reuseCtx = _childCtxForExisting(diskCtx, existing);
        if (!reuseCtx) {
          return { ok: false, error: 'Existing "' + topName + '" entry points at an invalid sector.' };
        }
        targetCtx = reuseCtx;
      } else {
        var needed = cbmEstimateTreeSectors(tree, fmt);
        var created = _createSubdir(diskCtx, createNameStr, needed);
        if (!created.ok) {
          return { ok: false, error: 'creating top-level dir "' + createNameStr + '": ' + (created.error || 'unknown') };
        }
        targetCtx = Object.assign({}, diskCtx, { partition: created.partition });
        copiedDirs++;
      }
    }
  }
  diskCtx = targetCtx;

  for (var i = 0; i < tree.files.length; i++) {
    var file = tree.files[i];
    // VLIR files carry an empty payload; their content is in vlirRecords.
    if (!file.vlirRecords && (!file.payload || file.payload.length === 0)) continue;
    var typeIdx = resolveFileCbmTypeIdx(file);
    var writeNameBytes = file.nameBytes;
    var existing = _cbmFindDirEntryByNameBytes(diskCtx, file.nameBytes);
    if (existing >= 0) {
      var fileName = _displayName(file.nameBytes);
      if (onConflict === 'cancel') {
        return { ok: false, error: 'File "' + fileName + '" already exists; choose Overwrite or Rename.' };
      }
      if (onConflict === 'rename') {
        var renamedFile = _cbmAutoRenameInDir(diskCtx, file.nameBytes);
        if (!renamedFile) {
          return { ok: false, error: 'All " (N)" rename suffixes 2..99 are taken for a colliding file.' };
        }
        writeNameBytes = renamedFile;
      } else {
        if (_isDirEntry(diskCtx, existing)) {
          return { ok: false, error: '"' + fileName + '" is a directory or partition here; a file can\'t replace it.' };
        }
        // Free the old file's sectors, then clear the slot so it's reused.
        var dataBefore = new Uint8Array(diskCtx.buffer);
        var oldBamOff = getDirContext(diskCtx).bamOff;
        forEachFileSector(dataBefore, existing, function(t, s) {
          bamMarkSectorFree(dataBefore, t, s, oldBamOff, diskCtx);
        }, diskCtx);
        for (var w = DIRENT_TYPE; w < 32; w++) dataBefore[existing + w] = 0x00;
      }
    }
    var geosData = null;
    if (file.geosBytes || file.geosInfoBlock) {
      geosData = {
        geosBytes: file.geosBytes || new Uint8Array(9),
        geosInfoBlock: file.geosInfoBlock || null,
      };
    }
    var ok;
    if (file.vlirRecords && Array.isArray(file.vlirRecords)) {
      ok =writeVlirFileToDisk(0x80 | typeIdx, writeNameBytes, file.vlirRecords,
        geosData ? geosData.geosBytes : null,
        geosData ? geosData.geosInfoBlock : null,
        true, diskCtx);
    } else {
      ok = writeFileToDisk(typeIdx, writeNameBytes, file.payload, geosData, true, diskCtx);
    }
    if (!ok) {
      return { ok: false, error: (file.vlirRecords ? 'writeVlirFileToDisk' : 'writeFileToDisk') + ' failed for a file' };
    }
    copiedFiles++;
  }

  if (tree.subdirs && tree.subdirs.length > 0) {
    for (var di = 0; di < tree.subdirs.length; di++) {
      var sub = tree.subdirs[di];
      var subName = _displayName(sub.nameBytes);
      if (!subName) subName = 'SUBDIR';
      if (!_hostsSubdirs(diskCtx)) {
        skippedDirs.push(subName + ' (this format does not support nested subdirs here)');
        continue;
      }
      var existing = _cbmFindDirEntryByNameBytes(diskCtx, sub.nameBytes);
      var subCtx = null;
      if (existing >= 0 && onConflict === 'overwrite') {
        if (!_isDirEntry(diskCtx, existing)) {
          return { ok: false, error: 'A file named "' + subName + '" already exists; a directory can\'t replace it.' };
        }
        subCtx = _childCtxForExisting(diskCtx, existing);
        if (!subCtx) {
          skippedDirs.push(subName + ' (existing dir entry points at an invalid sector)');
          continue;
        }
      } else if (existing >= 0 && onConflict === 'cancel') {
        return { ok: false, error: 'Directory "' + subName + '" already exists; choose Overwrite or Rename.' };
      } else {
        var createName = subName;
        if (existing >= 0 && onConflict === 'rename') {
          var renamedSub = _cbmAutoRenameInDir(diskCtx, sub.nameBytes);
          if (!renamedSub) {
            return { ok: false, error: 'All " (N)" rename suffixes 2..99 are taken for "' + subName + '".' };
          }
          createName = _displayName(renamedSub);
        }
        var neededSub = cbmEstimateTreeSectors(sub, diskCtx.format);
        var creation = _createSubdir(diskCtx, createName, neededSub);
        if (!creation.ok) {
          return { ok: false, error: 'creating subdir "' + createName + '": ' + (creation.error || 'unknown') };
        }
        subCtx = Object.assign({}, diskCtx, { partition: creation.partition });
        copiedDirs++;
      }
      // Recurse into the (new or merged) subdir
      var rr = cbmPasteDirTree(subCtx, sub, opts);
      if (!rr.ok) return rr;
      copiedFiles += rr.copiedFiles;
      copiedDirs += rr.copiedDirs;
      for (var sl = 0; sl < rr.skippedLnks.length; sl++) skippedLnks.push(rr.skippedLnks[sl]);
      for (var sd = 0; sd < rr.skippedDirs.length; sd++) skippedDirs.push(rr.skippedDirs[sd]);
    }
  }

  return {
    ok: true,
    copiedFiles: copiedFiles,
    copiedDirs: copiedDirs,
    skippedLnks: skippedLnks,
    skippedDirs: skippedDirs,
  };
}
