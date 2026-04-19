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
function _cmdReadTrackBitmap(data, bamOff, track) {
  var base = this._bamBase(track);
  if (base < 0 || base + 32 > data.length) return 0;
  return data[base] | (data[base+1] << 8) | (data[base+2] << 16) | ((data[base+3] << 24) >>> 0);
}
function _cmdNoop() {}

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
    readTrackFree: _cmdReadTrackFree,
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
    _bamBase: _cmdBamBase,
    isSectorFree: _cmdIsSectorFree,
    readTrackFree: _cmdReadTrackFree,
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
    _bamBase: _cmdBamBase,
    isSectorFree: _cmdIsSectorFree,
    readTrackFree: _cmdReadTrackFree,
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
    _bamBase: _cmdBamBase,
    isSectorFree: _cmdIsSectorFree,
    readTrackFree: _cmdReadTrackFree,
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

// ── G64 GCR decoder ──────────────────────────────────────────────────
// GCR 5-bit to 4-bit decode table
var GCR_DECODE = [
  -1,-1,-1,-1,-1,-1,-1,-1,-1, 8,-1, 1,-1,12, 4, 5,
  -1,-1, 2, 3,-1,15, 6, 7,-1, 9,10,11,-1,13,14,-1
];

function decodeG64toD64(g64) {
  var numHalfTracks = g64[9];
  var numTracks = Math.min(Math.floor(numHalfTracks / 2), 42);

  // Standard D64 sector counts per track
  var spt = function(t) {
    if (t <= 17) return 21;
    if (t <= 24) return 19;
    if (t <= 30) return 18;
    return 17;
  };

  // Calculate D64 size
  var totalSectors = 0;
  for (var t = 1; t <= numTracks; t++) totalSectors += spt(t);
  var d64 = new Uint8Array(totalSectors * 256);

  // Read track offset table (starts at byte 12, 4 bytes per half-track)
  for (var track = 1; track <= numTracks; track++) {
    var halfTrackIdx = (track - 1) * 2; // whole tracks only
    var offTablePos = 12 + halfTrackIdx * 4;
    var trackOffset = g64[offTablePos] | (g64[offTablePos + 1] << 8) |
      (g64[offTablePos + 2] << 16) | (g64[offTablePos + 3] << 24);
    if (trackOffset === 0 || trackOffset >= g64.length) continue;

    var trackSize = g64[trackOffset] | (g64[trackOffset + 1] << 8);
    if (trackSize === 0 || trackOffset + 2 + trackSize > g64.length) continue;
    var trackData = g64.subarray(trackOffset + 2, trackOffset + 2 + trackSize);

    // Extract sectors from GCR track data
    var sectors = spt(track);
    for (var sec = 0; sec < sectors; sec++) {
      var sectorData = extractGCRSector(trackData, trackSize, track, sec);
      if (sectorData) {
        var d64Off = calcD64Offset(track, sec, spt);
        for (var bi = 0; bi < 256; bi++) d64[d64Off + bi] = sectorData[bi];
      }
    }
  }

  return d64.buffer;
}

function calcD64Offset(track, sector, sptFn) {
  var off = 0;
  for (var t = 1; t < track; t++) off += sptFn(t) * 256;
  return off + sector * 256;
}

// Decode 5 GCR bytes into 4 data bytes
function decodeGCR5(gcr, pos) {
  if (pos + 4 >= gcr.length) return null;
  var b0 = gcr[pos], b1 = gcr[pos + 1], b2 = gcr[pos + 2], b3 = gcr[pos + 3], b4 = gcr[pos + 4];

  var n0 = GCR_DECODE[b0 >> 3];
  var n1 = GCR_DECODE[((b0 & 7) << 2) | (b1 >> 6)];
  var n2 = GCR_DECODE[(b1 >> 1) & 0x1F];
  var n3 = GCR_DECODE[((b1 & 1) << 4) | (b2 >> 4)];
  var n4 = GCR_DECODE[((b2 & 0xF) << 1) | (b3 >> 7)];
  var n5 = GCR_DECODE[(b3 >> 2) & 0x1F];
  var n6 = GCR_DECODE[((b3 & 3) << 3) | (b4 >> 5)];
  var n7 = GCR_DECODE[b4 & 0x1F];

  if (n0 < 0 || n1 < 0 || n2 < 0 || n3 < 0 || n4 < 0 || n5 < 0 || n6 < 0 || n7 < 0) return null;

  return [(n0 << 4) | n1, (n2 << 4) | n3, (n4 << 4) | n5, (n6 << 4) | n7];
}

function extractGCRSector(trackData, trackSize, track, sector) {
  // Scan for sync marks and sector headers
  var len = trackSize;

  for (var pos = 0; pos < len - 10; pos++) {
    // Find sync: consecutive $FF bytes
    if (trackData[pos] !== 0xFF) continue;
    while (pos < len && trackData[pos] === 0xFF) pos++;
    if (pos >= len - 10) break;

    // Decode header (10 GCR bytes = 8 data bytes)
    var hdr = decodeGCR5(trackData, pos);
    if (!hdr) continue;
    var hdr2 = decodeGCR5(trackData, pos + 5);
    if (!hdr2) continue;

    // Header: byte 0 = $08 (header ID), byte 2 = sector, byte 3 = track
    if (hdr[0] !== 0x08) continue;
    if (hdr[2] !== sector || hdr[3] !== track) continue;

    // Found matching header — now find data sync
    var dataPos = pos + 10;
    var found = false;
    for (var sp = dataPos; sp < Math.min(dataPos + 500, len); sp++) {
      if (trackData[sp] === 0xFF) {
        while (sp < len && trackData[sp] === 0xFF) sp++;
        dataPos = sp;
        found = true;
        break;
      }
    }
    if (!found || dataPos + 325 > len) {
      // Try wrapping around track
      continue;
    }

    // Decode data block (325 GCR bytes = 260 data bytes)
    var decoded = [];
    var ok = true;
    for (var gi = 0; gi < 65; gi++) {
      var group = decodeGCR5(trackData, dataPos + gi * 5);
      if (!group) { ok = false; break; }
      decoded.push(group[0], group[1], group[2], group[3]);
    }
    if (!ok || decoded.length < 260) continue;

    // Data block: byte 0 = $07, bytes 1-256 = sector data
    if (decoded[0] !== 0x07) continue;

    return new Uint8Array(decoded.slice(1, 257));
  }

  // Sector not found — try wrapping (track is circular)
  // Create wrapped copy and try again
  if (trackSize > 0) {
    var wrapped = new Uint8Array(trackSize * 2);
    wrapped.set(trackData);
    wrapped.set(trackData, trackSize);
    for (var pos2 = trackSize - 20; pos2 < trackSize + 10; pos2++) {
      if (wrapped[pos2] !== 0xFF) continue;
      while (pos2 < wrapped.length && wrapped[pos2] === 0xFF) pos2++;
      if (pos2 >= wrapped.length - 10) break;

      var hdr3 = decodeGCR5(wrapped, pos2);
      if (!hdr3) continue;
      if (hdr3[0] !== 0x08) continue;
      var hdr4 = decodeGCR5(wrapped, pos2 + 5);
      if (!hdr4) continue;
      if (hdr3[2] !== sector || hdr3[3] !== track) continue;

      var dp2 = pos2 + 10;
      for (var sp2 = dp2; sp2 < Math.min(dp2 + 500, wrapped.length); sp2++) {
        if (wrapped[sp2] === 0xFF) {
          while (sp2 < wrapped.length && wrapped[sp2] === 0xFF) sp2++;
          dp2 = sp2;
          break;
        }
      }
      if (dp2 + 325 > wrapped.length) continue;

      var dec2 = [];
      var ok2 = true;
      for (var gi2 = 0; gi2 < 65; gi2++) {
        var grp = decodeGCR5(wrapped, dp2 + gi2 * 5);
        if (!grp) { ok2 = false; break; }
        dec2.push(grp[0], grp[1], grp[2], grp[3]);
      }
      if (!ok2 || dec2.length < 260 || dec2[0] !== 0x07) continue;
      return new Uint8Array(dec2.slice(1, 257));
    }
  }

  return null; // sector not found
}

// ── CMD FD partition table reader ─────────────────────────────────────
// CMD_FD_SIZES is now only used for DHD (CMD Hard Drive) container detection.
// D1M/D2M/D4M are detected via DISK_FORMATS size tables as native CMD formats.
var CMD_FD_SIZES = {};

var CMD_PART_TYPES = { 0: 'Empty', 1: 'Native', 2: '1541', 3: '1571', 4: '1581', 5: 'System' };

function isCmdImage(buffer) {
  return CMD_FD_SIZES[buffer.byteLength] !== undefined;
}

function readCmdFdPartitions(buffer, formatName) {
  var data = new Uint8Array(buffer);
  var fdInfo = CMD_FD_SIZES[buffer.byteLength];
  var name = fdInfo ? fdInfo.name : (formatName || 'CMD');

  var partitions = [];
  // Partition table at track 1, sector 1 (offset 256), 32 bytes per entry, 8 per sector
  for (var i = 0; i < 31; i++) {
    var secIdx = 1 + Math.floor(i / 8);
    var entryIdx = i % 8;
    var off = secIdx * 256 + entryIdx * 32;
    if (off + 32 > data.length) break;

    var type = data[off];
    if (type === 0) continue; // empty entry

    var startBlock = (data[off + 1] << 16) | (data[off + 2] << 8) | data[off + 3];
    var sizeBlocks = (data[off + 5] << 16) | (data[off + 6] << 8) | data[off + 7];
    var startByte = startBlock * 512;
    var sizeBytes = sizeBlocks * 512;

    var name = '';
    for (var ni = 0; ni < 16; ni++) {
      var ch = data[off + 8 + ni];
      if (ch === 0xA0) break;
      name += String.fromCharCode(ch >= 0xC1 && ch <= 0xDA ? ch - 0x80 : ch);
    }

    partitions.push({
      index: i + 1,
      type: type,
      typeName: CMD_PART_TYPES[type] || 'Unknown',
      name: name || 'Partition ' + (i + 1),
      startByte: startByte,
      sizeBytes: sizeBytes,
      sizeBlocks: sizeBlocks
    });
  }
  return { format: name, spt: fdInfo ? fdInfo.spt : 256, partitions: partitions };
}

function extractCmdPartition(buffer, partition) {
  if (partition.startByte + partition.sizeBytes > buffer.byteLength) {
    // Clamp to available data
    var available = buffer.byteLength - partition.startByte;
    if (available <= 0) return null;
    return buffer.slice(partition.startByte, partition.startByte + available);
  }
  return buffer.slice(partition.startByte, partition.startByte + partition.sizeBytes);
}

function detectFormat(bufferSize, buffer) {
  if (buffer) {
    var data = new Uint8Array(buffer);
    // Check for TAP magic: "C64-TAPE-RAW"
    if (bufferSize >= 20 && data[0] === 0x43 && data[1] === 0x36 && data[2] === 0x34 &&
        data[3] === 0x2D && data[4] === 0x54 && data[5] === 0x41 && data[6] === 0x50 && data[7] === 0x45) {
      return { format: DISK_FORMATS.tap, tracks: 0 };
    }
    // Check for T64 magic: "C64"
    if (bufferSize >= 64 && data[0] === 0x43 && data[1] === 0x36 && data[2] === 0x34) {
      return { format: DISK_FORMATS.t64, tracks: 0 };
    }
  }
  // DNP: multiple of 65536, at least 2 tracks, check header signature before size table
  if (bufferSize >= 131072 && bufferSize % 65536 === 0 && bufferSize <= 16711680 && buffer) {
    var dnpData = new Uint8Array(buffer);
    // Header at T1/S1 (offset 256): byte 2 = format type 'H' ($48)
    if (dnpData[258] === 0x48 || dnpData[0x119] === 0x31) {
      return { format: DISK_FORMATS.dnp, tracks: bufferSize / 65536 };
    }
  }
  // Try each format's sizes
  for (const [key, fmt] of Object.entries(DISK_FORMATS)) {
    for (const size of fmt.sizes) {
      if (bufferSize === size.bytes) return { format: fmt, tracks: size.tracks };
    }
  }
  // Fallback: if larger than D64 40-track, check D64 variants
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
function sectorOffset(track, sector) {
  const maxTrack = currentTracks || 40;
  if (track < 1 || track > maxTrack) return -1;
  if (sector < 0 || sector >= currentFormat.sectorsPerTrack(track)) return -1;
  const offsets = getTrackOffsets(currentFormat, maxTrack);
  return offsets[track] + sector * 256;
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

// ── PETSCII → Unicode ─────────────────────────────────────────────────
// C64 Pro font PUA ranges:
// E000-E0FF = uppercase/graphics mode (default)
// E100-E1FF = lowercase/uppercase mode
var charsetMode = localStorage.getItem('cbm-charsetMode') === 'lowercase' ? 'lowercase' : 'uppercase';

function buildPetsciiMap(mode) {
  var m = new Array(256).fill('\u00B7');
  var base = mode === 'lowercase' ? 0xE100 : 0xE000;

  // $00-$1F: reversed chars — use $40-$5F glyphs from the chosen charset
  for (var i = 0x00; i <= 0x1F; i++) m[i] = String.fromCharCode(base + 0x40 + i);

  // $20-$7F: displayable characters
  for (i = 0x20; i <= 0x7F; i++) m[i] = String.fromCharCode(base + i);

  // $80-$9F: reversed chars — use $C0-$DF glyphs from the chosen charset
  for (i = 0x80; i <= 0x9F; i++) m[i] = String.fromCharCode(base + 0xC0 + (i - 0x80));

  // $A0-$FF: displayable characters
  for (i = 0xA0; i <= 0xFF; i++) m[i] = String.fromCharCode(base + i);

  return m;
}

var PETSCII_MAP = buildPetsciiMap(charsetMode);

function setCharsetMode(mode) {
  charsetMode = mode;
  localStorage.setItem('cbm-charsetMode', mode);
  PETSCII_MAP = buildPetsciiMap(mode);
}

/** @param {number} byte @returns {string} PUA character */
function petsciiToAscii(byte) {
  return PETSCII_MAP[byte & 0xFF];
}

/** @param {Uint8Array} data @param {number} offset @param {number} len @param {boolean} [stopAtPadding] @returns {string} */
function readPetsciiString(data, offset, len, stopAtPadding) {
  let contentLen = len;
  if (stopAtPadding !== false) {
    for (let i = 0; i < len; i++) {
      if (data[offset + i] === 0xA0) { contentLen = i; break; }
    }
  }
  let s = '';
  for (let i = 0; i < contentLen; i++) s += petsciiToAscii(data[offset + i]);
  return s;
}

function readPetsciiRich(data, offset, len) {
  let contentLen = len;
  for (let i = 0; i < len; i++) {
    if (data[offset + i] === 0xA0) { contentLen = i; break; }
  }
  const chars = [];
  for (let i = 0; i < contentLen; i++) {
    const b = data[offset + i];
    const reversed = (b >= 0x00 && b <= 0x1F) || (b >= 0x80 && b <= 0x9F);
    chars.push({ char: petsciiToAscii(b), reversed });
  }
  return chars;
}

const UNICODE_TO_PETSCII = (() => {
  var rev = new Map();
  // Map all PETSCII_MAP entries back (including PUA chars)
  for (var i = 255; i >= 0; i--) {
    var ch = PETSCII_MAP[i];
    if (ch && ch !== '\u00B7') rev.set(ch, i);
  }
  // Keyboard typed characters → PETSCII bytes (override duplicates)
  for (i = 0x41; i <= 0x5A; i++) rev.set(String.fromCharCode(i), i);       // A-Z
  for (i = 0x41; i <= 0x5A; i++) rev.set(String.fromCharCode(i + 32), i);  // a-z
  for (i = 0x20; i <= 0x3F; i++) rev.set(String.fromCharCode(i), i);
  rev.set('@', 0x40); rev.set('[', 0x5B); rev.set(']', 0x5D);
  rev.set('\u00A3', 0x5C); rev.set('\u2191', 0x5E); rev.set('\u2190', 0x5F);
  rev.set('\u03C0', 0xFF); rev.set(' ', 0x20);
  return rev;
})();

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

// ── GEOS support ─────────────────────────────────────────────────────
var GEOS_FILE_TYPES = {
  0x00: 'Non-GEOS',
  0x01: 'BASIC',
  0x02: 'Assembler',
  0x03: 'Data file',
  0x04: 'System file',
  0x05: 'Desk accessory',
  0x06: 'Application',
  0x07: 'Application data',
  0x08: 'Font file',
  0x09: 'Printer driver',
  0x0A: 'Input driver',
  0x0B: 'Disk driver/device',
  0x0C: 'System boot file',
  0x0D: 'Temporary',
  0x0E: 'Auto-exec file',
  0x0F: 'Input 128',
  0x10: 'Numerics',
  0x11: 'Help file',
  0x12: 'MEGA patch',
  0x13: 'Write image',
  0x14: 'Paint image',
  0x15: 'Photo scrap',
  0x16: 'Text scrap',
  0x17: 'Text album',
  0x18: 'Photo album',
  0x19: 'Cardset',
  0x1A: 'Gateway GeoCalc',
  0x1B: 'Gateway GeoFile',
  0x1C: 'Sound file',
  0x1D: 'Configuration',
};

var GEOS_STRUCTURE_TYPES = {
  0x00: 'Sequential',
  0x01: 'VLIR',
  0x02: 'Chained VLIR',
};

var GEOS_SIGNATURE = 'GEOS format V1.0';
var GEOS_SIG_OFFSET = 0xAD; // offset within header sector

/** @param {ArrayBuffer} buffer @returns {boolean} */
function hasGeosSignature(buffer) {
  if (!buffer) return false;
  var data = new Uint8Array(buffer);
  var hdrOff = sectorOffset(currentFormat.headerTrack, currentFormat.headerSector);
  if (hdrOff < 0) return false;
  for (var i = 0; i < GEOS_SIGNATURE.length; i++) {
    if (data[hdrOff + GEOS_SIG_OFFSET + i] !== GEOS_SIGNATURE.charCodeAt(i)) return false;
  }
  return true;
}

/** @param {ArrayBuffer} buffer */
function writeGeosSignature(buffer) {
  var data = new Uint8Array(buffer);
  var hdrOff = sectorOffset(currentFormat.headerTrack, currentFormat.headerSector);
  if (hdrOff < 0) return;
  for (var i = 0; i < GEOS_SIGNATURE.length; i++) {
    data[hdrOff + GEOS_SIG_OFFSET + i] = GEOS_SIGNATURE.charCodeAt(i);
  }
  // Also set the "border" byte at 0xAB to 0x00 (GEOS uses this)
  data[hdrOff + 0xAB] = 0x00;
  data[hdrOff + 0xAC] = 0x00;
}

// Check if a disk has GEOS formatting (border sector signature at T18/S0 offset 0xAD)
function isGeosDisk(buffer) {
  if (!buffer) return false;
  var data = new Uint8Array(buffer);
  var bamOff = sectorOffset(currentFormat.bamTrack, currentFormat.bamSector);
  if (bamOff < 0) return false;
  // GEOS identification: bytes at BAM offset 0xAD-0xBC contain "GEOS format"
  // or the border sector has specific values. A simpler check: look for any
  // directory entry with GEOS file type > 0
  var info = parseDisk(buffer);
  for (var i = 0; i < info.entries.length; i++) {
    var eOff = info.entries[i].entryOff;
    if (data[eOff + 0x18] > 0) return true; // GEOS file type at byte 24
  }
  return false;
}

// Read GEOS info for a directory entry
function readGeosInfo(buffer, entryOff) {
  var data = new Uint8Array(buffer);
  var infoTrack = data[entryOff + 0x15];     // byte 21: info block track
  var infoSector = data[entryOff + 0x16];    // byte 22: info block sector
  var geosStructure = data[entryOff + 0x17]; // byte 23: structure type
  var geosFileType = data[entryOff + 0x18];  // byte 24: GEOS file type
  var year = data[entryOff + 0x19];          // byte 25: year (0-99, + 1900)
  var month = data[entryOff + 0x1A];         // byte 26: month (1-12)
  var day = data[entryOff + 0x1B];           // byte 27: day (1-31)
  var hour = data[entryOff + 0x1C];          // byte 28: hour (0-23)
  var minute = data[entryOff + 0x1D];        // byte 29: minute (0-59)

  var fullYear = year > 0 ? (year < 50 ? 2000 + year : 1900 + year) : 0;

  var result = {
    isGeos: geosFileType > 0,
    structure: geosStructure,
    structureName: GEOS_STRUCTURE_TYPES[geosStructure] || 'Unknown ($' + geosStructure.toString(16).toUpperCase().padStart(2, '0') + ')',
    fileType: geosFileType,
    fileTypeName: GEOS_FILE_TYPES[geosFileType] || 'Unknown ($' + geosFileType.toString(16).toUpperCase().padStart(2, '0') + ')',
    year: fullYear,
    month: month,
    day: day,
    hour: hour,
    minute: minute,
    date: '',
    infoTrack: infoTrack,
    infoSector: infoSector,
  };

  if (fullYear > 0 && month > 0 && month <= 12 && day > 0 && day <= 31) {
    result.date = fullYear + '-' +
      String(month).padStart(2, '0') + '-' +
      String(day).padStart(2, '0') + ' ' +
      String(hour).padStart(2, '0') + ':' +
      String(minute).padStart(2, '0');
  }

  return result;
}

// Read GEOS info block (256-byte sector with icon, description, class, author)
function decodeGeosString(data, offset, maxLen) {
  var s = '';
  for (var i = 0; i < maxLen; i++) {
    var b = data[offset + i];
    if (b === 0x00) break;
    if (b >= 0x20 && b <= 0x7E) s += String.fromCharCode(b);
    else if (b >= 0xC1 && b <= 0xDA) s += String.fromCharCode(b - 0x80); // shifted → uppercase
    else if (b === 0x0D) s += '\n';
    else s += '.';
  }
  return s;
}

// Read VLIR records from a GEOS VLIR file.
// The directory entry's T/S points to the VLIR index sector.
// The index contains up to 127 record pointers (T/S pairs at bytes 2-255).
// Each record is a standard sector chain. Returns array of Uint8Array (one per record).
function readVLIRRecords(buffer, entryOff) {
  var data = new Uint8Array(buffer);
  var fmt = currentFormat;
  var indexT = data[entryOff + 3];
  var indexS = data[entryOff + 4];
  if (indexT === 0) return [];

  var idxOff = sectorOffset(indexT, indexS);
  if (idxOff < 0) return [];

  var records = [];
  // Index sector: bytes 2-255 = up to 127 record T/S pairs
  for (var ri = 0; ri < 127; ri++) {
    var recT = data[idxOff + 2 + ri * 2];
    var recS = data[idxOff + 2 + ri * 2 + 1];
    if (recT === 0 && recS === 0) {
      records.push(null); // empty record
      continue;
    }
    if (recT === 0 && recS === 0xFF) {
      records.push(null); // non-existent record
      continue;
    }
    // Follow this record's sector chain
    var bytes = [];
    var visited = {};
    var t = recT, s = recS;
    while (t !== 0) {
      if (t < 1 || t > currentTracks) break;
      if (s >= fmt.sectorsPerTrack(t)) break;
      var key = t + ':' + s;
      if (visited[key]) break;
      visited[key] = true;
      var off = sectorOffset(t, s);
      if (off < 0) break;
      var nextT = data[off], nextS = data[off + 1];
      if (nextT === 0) {
        for (var i = 2; i <= nextS && i < 256; i++) bytes.push(data[off + i]);
      } else {
        for (var j = 2; j < 256; j++) bytes.push(data[off + j]);
      }
      t = nextT; s = nextS;
    }
    records.push(new Uint8Array(bytes));
  }
  // Trim trailing null records
  while (records.length > 0 && records[records.length - 1] === null) records.pop();
  return records;
}

// Read VLIR records in the format expected by writeVlirFileToDisk (and CVT import):
//   end marker (00/00)  -> null
//   empty slot (00/FF)  -> { data: null }
//   populated record    -> { data: Uint8Array }
// Unlike readVLIRRecords (which is lossy), this preserves the end-vs-empty distinction
// so a VLIR file can be copied and pasted without losing its index structure.
function readVLIRRecordsForCopy(buffer, entryOff) {
  var data = new Uint8Array(buffer);
  var fmt = currentFormat;
  var indexT = data[entryOff + 3];
  var indexS = data[entryOff + 4];
  if (indexT === 0) return [];
  var idxOff = sectorOffset(indexT, indexS);
  if (idxOff < 0) return [];

  var records = [];
  for (var ri = 0; ri < 127; ri++) {
    var recT = data[idxOff + 2 + ri * 2];
    var recS = data[idxOff + 2 + ri * 2 + 1];
    if (recT === 0 && recS === 0) {
      records.push(null); // end marker — stop
      break;
    }
    if (recT === 0 && recS === 0xFF) {
      records.push({ data: null }); // empty slot
      continue;
    }
    // Populated record: follow sector chain
    var bytes = [];
    var visited = {};
    var t = recT, s = recS;
    while (t !== 0) {
      if (t < 1 || t > currentTracks) break;
      if (s >= fmt.sectorsPerTrack(t)) break;
      var key = t + ':' + s;
      if (visited[key]) break;
      visited[key] = true;
      var off = sectorOffset(t, s);
      if (off < 0) break;
      var nextT = data[off], nextS = data[off + 1];
      if (nextT === 0) {
        for (var i = 2; i <= nextS && i < 256; i++) bytes.push(data[off + i]);
      } else {
        for (var j = 2; j < 256; j++) bytes.push(data[off + j]);
      }
      t = nextT; s = nextS;
    }
    records.push({ data: new Uint8Array(bytes) });
  }
  return records;
}

/** @param {Uint8Array} data @param {number} entryOff @returns {boolean} */
function isVlirFile(data, entryOff) {
  var typeIdx = data[entryOff + 2] & 0x07;
  return data[entryOff + 0x18] > 0 &&
         typeIdx !== FILE_TYPE.REL &&
         data[entryOff + 0x17] === 0x01;
}

/** @param {Uint8Array} data @param {number} entryOff @param {(track: number, sector: number) => void} callback @returns {number} Total sectors visited */
function forEachFileSector(data, entryOff, callback) {
  var fmt = currentFormat;
  var typeIdx = data[entryOff + 2] & 0x07;
  var count = 0;

  function followChain(ft, fs) {
    var visited = {};
    while (ft !== 0) {
      if (ft < 1 || ft > currentTracks) break;
      if (fs >= fmt.sectorsPerTrack(ft)) break;
      var key = ft + ':' + fs;
      if (visited[key]) break;
      visited[key] = true;
      callback(ft, fs);
      count++;
      var off = sectorOffset(ft, fs);
      if (off < 0) break;
      ft = data[off]; fs = data[off + 1];
    }
  }

  // Main file chain
  var startT = data[entryOff + 3], startS = data[entryOff + 4];
  followChain(startT, startS);

  // REL file: side-sector chain
  if (typeIdx === FILE_TYPE.REL) {
    followChain(data[entryOff + 0x15], data[entryOff + 0x16]);
  }

  // GEOS file: info block + VLIR record chains
  if (data[entryOff + 0x18] > 0 && typeIdx !== FILE_TYPE.REL) {
    var infoT = data[entryOff + 0x15];
    var infoS = data[entryOff + 0x16];
    if (infoT >= 1 && infoT <= currentTracks &&
        infoS < fmt.sectorsPerTrack(infoT)) {
      callback(infoT, infoS);
      count++;
    }
    // VLIR: walk each record chain from the index sector
    if (data[entryOff + 0x17] === 0x01) {
      var idxOff = sectorOffset(startT, startS);
      if (idxOff >= 0) {
        for (var vri = 0; vri < 127; vri++) {
          var recT = data[idxOff + 2 + vri * 2];
          var recS = data[idxOff + 2 + vri * 2 + 1];
          if (recT === 0 && recS === 0) break;
          if (recT === 0) continue;
          followChain(recT, recS);
        }
      }
    }
  }

  return count;
}

// Allocate up to `numSectors` sectors by scanning `trackOrder` with the given
// drive `interleave`. Mirrors CBM drive behaviour: on each track, scan forward
// from (lastSector + interleave) wrapping at sectorsPerTrack, fill the track
// as far as possible, then advance to the next track. Mutates `allocated`
// (keys "t:s") to mark chosen sectors, and returns the new [{ track, sector }]
// list. Callers build their own trackOrder + allocated map.
function allocateSectorsFromTrackOrder(allocated, numSectors, trackOrder, interleave) {
  var fmt = currentFormat;
  var sectorList = [];
  var lastSector = 0;

  for (var ti = 0; ti < trackOrder.length && sectorList.length < numSectors; ti++) {
    var track = trackOrder[ti];
    var spt = fmt.sectorsPerTrack(track);

    var s = (lastSector + interleave) % spt;
    var foundFirst = false;
    for (var attempt = 0; attempt < spt; attempt++) {
      if (!allocated[track + ':' + s]) {
        sectorList.push({ track: track, sector: s });
        allocated[track + ':' + s] = true;
        lastSector = s;
        foundFirst = true;
        break;
      }
      s = (s + 1) % spt;
    }

    if (!foundFirst) continue;

    while (sectorList.length < numSectors) {
      var nextS = (lastSector + interleave) % spt;
      var foundMore = false;
      for (var a2 = 0; a2 < spt; a2++) {
        if (!allocated[track + ':' + nextS]) {
          sectorList.push({ track: track, sector: nextS });
          allocated[track + ':' + nextS] = true;
          lastSector = nextS;
          foundMore = true;
          break;
        }
        nextS = (nextS + 1) % spt;
      }
      if (!foundMore) break;
    }
  }

  return sectorList;
}

// Walk a DNP image (root dir + linked subdirs) and return a list of
// { owner, track, sector } entries describing each allocated sector whose
// track is >= minTrack. Used by the DNP resize operation to explain to the
// user what's preventing a shrink from fitting.
function findDnpHighTrackOwners(buffer, minTrack) {
  var data = new Uint8Array(buffer);
  var totalTracks = buffer.byteLength / 65536;
  var fmt = DISK_FORMATS.dnp;
  var owners = [];

  function dnpOff(t, s) { return (t - 1) * 65536 + s * 256; }
  function record(ownerLabel, t, s) {
    if (t >= minTrack && t <= totalTracks) owners.push({ owner: ownerLabel, track: t, sector: s });
  }

  function walkChain(startT, startS, label) {
    var visited = {};
    var t = startT, s = startS;
    while (t !== 0 && t <= totalTracks) {
      if (s < 0 || s >= 256) break;
      var key = t + ':' + s;
      if (visited[key]) break;
      visited[key] = true;
      record(label, t, s);
      var off = dnpOff(t, s);
      t = data[off];
      s = data[off + 1];
    }
  }

  function walkDir(dirT, dirS, path) {
    var dirVisited = {};
    while (dirT !== 0 && dirT <= totalTracks) {
      var key = dirT + ':' + dirS;
      if (dirVisited[key]) break;
      dirVisited[key] = true;
      record((path || '<root>') + ' (directory)', dirT, dirS);
      var off = dnpOff(dirT, dirS);
      for (var i = 0; i < 8; i++) {
        var eo = off + i * 32;
        var tb = data[eo + 2];
        if ((tb & 0x80) === 0) continue;
        var typeIdx = tb & 0x07;
        var rawName = readPetsciiString(data, eo + 5, 16);
        var readable = petsciiToReadable(rawName).trim() || '<unnamed>';
        var label = path ? path + '/' + readable : readable;

        if (typeIdx === fmt.subdirType) {
          var hdrT = data[eo + 3], hdrS = data[eo + 4];
          record(label + ' (subdir header)', hdrT, hdrS);
          var hdrOff = dnpOff(hdrT, hdrS);
          walkDir(data[hdrOff], data[hdrOff + 1], label);
          continue;
        }

        walkChain(data[eo + 3], data[eo + 4], label);

        if (typeIdx === FILE_TYPE.REL) {
          walkChain(data[eo + 0x15], data[eo + 0x16], label + ' (REL side-sectors)');
        } else if (data[eo + 0x18] > 0) {
          var giT = data[eo + 0x15], giS = data[eo + 0x16];
          if (giT > 0) record(label + ' (GEOS info)', giT, giS);
          if (data[eo + 0x17] === 0x01) {
            var viT = data[eo + 3], viS = data[eo + 4];
            if (viT > 0 && viT <= totalTracks) {
              var viOff = dnpOff(viT, viS);
              for (var r = 0; r < 127; r++) {
                var rT = data[viOff + 2 + r * 2];
                var rS = data[viOff + 2 + r * 2 + 1];
                if (rT === 0 && rS === 0) break;
                if (rT === 0) continue;
                walkChain(rT, rS, label + ' (VLIR record ' + r + ')');
              }
            }
          }
        }
      }
      var chainOff = dnpOff(dirT, dirS);
      dirT = data[chainOff];
      dirS = data[chainOff + 1];
    }
  }

  walkDir(fmt.dirTrack, fmt.dirSector, '');
  return owners;
}

// Resize a DNP image to `newTracks` (2..255). Returns one of:
//   { buffer: ArrayBuffer }                   — success
//   { error: string }                         — rejected (bad input / wrong format)
//   { error: 'blocked', owners: [...] }       — shrink blocked; list from findDnpHighTrackOwners
// Grow: always succeeds. Appends empty tracks and sets their BAM bitmap to all-free.
// Shrink: only succeeds if every sector above newTracks is already free. The UI
// handler is expected to compact first (via optimizeDisk) and retry.
function resizeDnpImage(buffer, newTracks) {
  if (currentFormat !== DISK_FORMATS.dnp) return { error: 'Resize is only supported for DNP images.' };
  if (typeof newTracks !== 'number' || !isFinite(newTracks) || newTracks < 2 || newTracks > 255) {
    return { error: 'Track count must be between 2 and 255.' };
  }
  var oldTracks = buffer.byteLength / 65536;
  if (newTracks === oldTracks) return { buffer: buffer };
  var oldData = new Uint8Array(buffer);

  if (newTracks < oldTracks) {
    var owners = findDnpHighTrackOwners(buffer, newTracks + 1);
    if (owners.length > 0) return { error: 'blocked', owners: owners };
    var shrunk = new Uint8Array(newTracks * 65536);
    shrunk.set(oldData.subarray(0, newTracks * 65536));
    shrunk[2 * 256 + 0x08] = newTracks;
    return { buffer: shrunk.buffer };
  }

  var grown = new Uint8Array(newTracks * 65536);
  grown.set(oldData);
  // Each BAM slot (32 bytes) = 256 bits = 256 sectors; 0xFF = free.
  for (var t = oldTracks + 1; t <= newTracks; t++) {
    var bamSec = 2 + (t >> 3);
    var slotOff = bamSec * 256 + (t & 7) * 32;
    for (var b = 0; b < 32; b++) grown[slotOff + b] = 0xFF;
  }
  grown[2 * 256 + 0x08] = newTracks;
  return { buffer: grown.buffer };
}

// Enumerate the GEOS "auxiliary" sectors of a file entry: info block and
// VLIR record chain starts. Unlike forEachFileSector, this does NOT walk the
// record chains themselves — callers that need per-sector cross-link /
// error-reporting context (validateDisk, validatePartition) plug in their own
// walker for each record start.
//
// onInfoBlock(track, sector) — called once if the entry has a GEOS info block.
// onRecordStart(track, sector, recordIdx) — called per VLIR record chain head.
function forEachGeosAuxSector(data, entryOff, onInfoBlock, onRecordStart) {
  var typeIdx = data[entryOff + 2] & 0x07;
  if (data[entryOff + 0x18] === 0 || typeIdx === FILE_TYPE.REL) return;
  if (onInfoBlock) onInfoBlock(data[entryOff + 0x15], data[entryOff + 0x16]);
  if (data[entryOff + 0x17] !== 0x01) return;
  var startT = data[entryOff + 3], startS = data[entryOff + 4];
  var idxOff = sectorOffset(startT, startS);
  if (idxOff < 0) return;
  for (var i = 0; i < 127; i++) {
    var recT = data[idxOff + 2 + i * 2];
    var recS = data[idxOff + 2 + i * 2 + 1];
    if (recT === 0 && recS === 0) break;
    if (recT === 0) continue;
    if (onRecordStart) onRecordStart(recT, recS, i);
  }
}

// Decompress GEOS bitmap data (geoPaint compression).
// code < 64: next 'code' bytes are literal data
// code 64-127: fill (code-64) cards with next 8-byte pattern
// code > 127: repeat next byte (code-128) times
function decompressGeosBitmap(compressed) {
  var out = [];
  var pos = 0;
  while (pos < compressed.length) {
    var code = compressed[pos++];
    if (code < 64) {
      for (var i = 0; i < code && pos < compressed.length; i++) out.push(compressed[pos++]);
    } else if (code < 128) {
      var count = code - 64;
      if (pos + 8 > compressed.length) break;
      var pat = [];
      for (var p = 0; p < 8; p++) pat.push(compressed[pos++]);
      for (var r = 0; r < count; r++) for (var p2 = 0; p2 < 8; p2++) out.push(pat[p2]);
    } else {
      if (pos >= compressed.length) break;
      var val = compressed[pos++];
      var reps = code - 128;
      for (var r2 = 0; r2 < reps; r2++) out.push(val);
    }
  }
  return new Uint8Array(out);
}

// Decompress GEOS scrap/album bitmap stream (different from geoPaint!).
// 0, 128, 220: skip (illegal opcodes)
// 1-127: RLE — repeat next byte 'code' times
// 129-219: literal — next (code-128) bytes are data
// 221-255: pattern — patsize=(code-220), next byte=repeat count, then patsize pattern bytes
function decompressGeosScrap(compressed) {
  var out = [];
  var pos = 0;
  while (pos < compressed.length) {
    var code = compressed[pos++];
    if (code === 0 || code === 128 || code === 220) continue;
    if (code < 128) {
      if (pos >= compressed.length) break;
      var val = compressed[pos++];
      for (var r = 0; r < code; r++) out.push(val);
    } else if (code <= 219) {
      var count = code - 128;
      for (var i = 0; i < count && pos < compressed.length; i++) out.push(compressed[pos++]);
    } else {
      var patsize = code - 220;
      if (pos + 1 + patsize > compressed.length) break;
      var repeat = compressed[pos++];
      var pat = [];
      for (var p = 0; p < patsize; p++) pat.push(compressed[pos++]);
      for (var r2 = 0; r2 < repeat; r2++) for (var p2 = 0; p2 < patsize; p2++) out.push(pat[p2]);
    }
  }
  return new Uint8Array(out);
}

function readGeosInfoBlock(buffer, track, sector) {
  if (track === 0) return null;
  var off = sectorOffset(track, sector);
  if (off < 0) return null;
  var data = new Uint8Array(buffer);

  // Info block layout:
  // 0x00-0x01: info block ID bytes (should be 0x00, 0xFF)
  // 0x02-0x03: icon width (bytes), height (pixels)
  // 0x04-0x43: icon sprite data (63 bytes)
  // 0x44: CBM file type
  // 0x45: GEOS file type
  // 0x46: GEOS structure type
  // 0x47-0x48: load address
  // 0x49-0x4A: end address
  // 0x4B-0x4C: init address
  // 0x4D-0x60: class name (20 bytes, 0x00 terminated)
  // 0x61-0x74: author (20 bytes, 0x00 terminated)  — actually at different offset
  // 0x85-0xFE: file description (free-form text, 0x00 terminated)

  var className = decodeGeosString(data, off + 0x4D, 20);
  var description = decodeGeosString(data, off + 0xA0, 96);

  // Icon: $02 = width (bytes), $03 = height (pixels), $04 = width (pixels), $05-$43 = bitmap
  var iconW = data[off + 0x02]; // width in bytes (typically 3 = 24px)
  var iconH = data[off + 0x03]; // height in pixels (typically 21)
  var iconBytes = iconW * iconH;
  var iconData = (iconW > 0 && iconH > 0 && iconBytes <= 63)
    ? data.subarray(off + 0x05, off + 0x05 + iconBytes) : null;

  return {
    className: className,
    description: description,
    loadAddr: data[off + 0x47] | (data[off + 0x48] << 8),
    endAddr: data[off + 0x49] | (data[off + 0x4A] << 8),
    initAddr: data[off + 0x4B] | (data[off + 0x4C] << 8),
    iconW: iconW * 8,
    iconH: iconH,
    iconData: iconData,
  };
}

function unicodeToPetscii(char) {
  var cp = char.charCodeAt(0);
  if (cp >= 0xE000 && cp <= 0xE0FF) return cp - 0xE000;
  if (cp >= 0xE100 && cp <= 0xE1FF) return cp - 0xE100;
  return UNICODE_TO_PETSCII.get(char) || 0x20;
}

function writePetsciiString(buffer, offset, str, maxLen, overrides) {
  const data = new Uint8Array(buffer);
  for (let i = 0; i < maxLen; i++) {
    if (i < str.length) {
      if (overrides && overrides[i] !== undefined) {
        data[offset + i] = overrides[i];
      } else {
        data[offset + i] = unicodeToPetscii(str[i]);
      }
    } else {
      data[offset + i] = 0xA0;
    }
  }
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

// ── TAP tape image parser ────────────────────────────────────────────
// Decodes standard CBM tape encoding to find file headers
function parseTAP(buffer) {
  var data = new Uint8Array(buffer);
  // TAP header: 0x00-0x0B = "C64-TAPE-RAW", 0x0C = version, 0x10-0x13 = data size
  var version = data[0x0C];
  var dataSize = data[0x10] | (data[0x11] << 8) | (data[0x12] << 16) | (data[0x13] << 24);
  var tapeName = 'TAP v' + version;

  // Read pulse lengths from the data section
  var pulses = [];
  var pos = 0x14;
  var endPos = Math.min(pos + dataSize, data.length);
  while (pos < endPos) {
    var b = data[pos++];
    if (b === 0x00 && version >= 1 && pos + 2 < endPos) {
      // Version 1: 3-byte overflow pulse
      pulses.push(data[pos] | (data[pos + 1] << 8) | (data[pos + 2] << 16));
      pos += 3;
    } else if (b === 0x00) {
      pulses.push(256 * 8); // version 0 overflow
    } else {
      pulses.push(b * 8);
    }
  }

  // Classify pulses: S(hort)=0, M(edium)=1, L(ong)=2
  // Thresholds based on C64 PAL clock (985248 Hz)
  // Short: ~363 cycles, Medium: ~531 cycles, Long: ~699 cycles
  function classifyPulse(cycles) {
    if (cycles < 432) return 0; // short
    if (cycles < 616) return 1; // medium
    return 2; // long
  }

  // Decode a byte from pulses starting at index pi (CBM standard encoding)
  // Returns { byte, nextIndex } or null if decoding fails
  function decodeByte(pi) {
    // Expect a new-data marker: long-medium pair
    if (pi + 1 >= pulses.length) return null;
    var p0 = classifyPulse(pulses[pi]);
    var p1 = classifyPulse(pulses[pi + 1]);
    if (p0 !== 2 || p1 !== 1) return null;
    pi += 2;

    // Read 8 data bits (LSB first) + 1 parity bit = 9 bit pairs
    var byte = 0;
    for (var bit = 0; bit < 8; bit++) {
      if (pi + 1 >= pulses.length) return null;
      var a = classifyPulse(pulses[pi]);
      var b2 = classifyPulse(pulses[pi + 1]);
      pi += 2;
      if (a === 1 && b2 === 0) byte |= (1 << bit);      // medium+short = 1
      else if (a === 0 && b2 === 1) { /* short+medium = 0 */ }
      else return null; // invalid
    }
    // Skip parity bit pair
    pi += 2;
    return { byte: byte, nextIndex: pi };
  }

  // Find pilot tone + sync countdown, return pulse index after sync or -1
  function findSync(startPi) {
    var pi2 = startPi;
    while (pi2 < pulses.length - 100) {
      // Skip to pilot tone (short pulses)
      var shortCount = 0;
      while (pi2 < pulses.length && classifyPulse(pulses[pi2]) === 0) {
        shortCount++;
        pi2++;
      }
      if (shortCount < 200) { pi2++; continue; }

      // Try to find countdown sync $89→$81
      var countdown = [];
      var tryPi = pi2;
      for (var attempt = 0; attempt < 500 && tryPi < pulses.length; attempt++) {
        var result = decodeByte(tryPi);
        if (!result) { tryPi++; continue; }
        countdown.push(result.byte);
        tryPi = result.nextIndex;
        if (countdown.length >= 9) {
          var last9 = countdown.slice(-9);
          // Standard CBM sync: $89 $88 $87 $86 $85 $84 $83 $82 $81
          if (last9[0] === 0x89 && last9[8] === 0x81) {
            var valid = true;
            for (var ci = 1; ci < 9; ci++) {
              if (last9[ci] !== last9[ci - 1] - 1) { valid = false; break; }
            }
            if (valid) return tryPi;
          }
        }
      }
      pi2 = tryPi;
    }
    return -1;
  }

  // Decode a block of bytes from pulses at given index
  function decodeBlock(startPi, maxBytes) {
    var bytes = [];
    var bp = startPi;
    for (var i = 0; i < maxBytes && bp < pulses.length; i++) {
      var r = decodeByte(bp);
      if (!r) break;
      bytes.push(r.byte);
      bp = r.nextIndex;
    }
    return { bytes: bytes, nextIndex: bp };
  }

  // Scan for file headers and their data blocks
  var entries = [];
  parsedTAPEntries = {};
  parsedT64Entries = null;
  var pi = 0;
  var entryId = 0;

  while (pi < pulses.length) {
    // Find header block
    pi = findSync(pi);
    if (pi < 0) break;

    var headerBlock = decodeBlock(pi, 192);
    pi = headerBlock.nextIndex;
    if (headerBlock.bytes.length < 21) continue;

    var hdr = headerBlock.bytes;
    var fileType = hdr[0];
    if (fileType < 1 || fileType > 5) continue;
    if (fileType === 5) continue; // end-of-tape marker

    var startAddr = hdr[1] | (hdr[2] << 8);
    var endAddr = hdr[3] | (hdr[4] << 8);
    var name = '';
    for (var ni = 0; ni < 16; ni++) {
      var ch = hdr[5 + ni];
      if (ch === 0x00) name += PETSCII_MAP[0xA0];
      else name += PETSCII_MAP[ch] || '?';
    }

    // Find and decode the data block (follows after another pilot+sync)
    var dataPi = findSync(pi);
    var fileData = null;
    var dataSize2 = endAddr > startAddr ? endAddr - startAddr : 0;
    if (dataPi >= 0 && dataSize2 > 0) {
      var dataBlock = decodeBlock(dataPi, dataSize2 + 10); // extra for checksum etc.
      pi = dataBlock.nextIndex;
      // Build PRG-style data: 2-byte load address + file bytes
      var decoded = dataBlock.bytes.slice(0, dataSize2);
      fileData = new Uint8Array(decoded.length + 2);
      fileData[0] = startAddr & 0xFF;
      fileData[1] = (startAddr >> 8) & 0xFF;
      for (var di = 0; di < decoded.length; di++) fileData[di + 2] = decoded[di];
    }

    var eOff = entryId++;
    var blocks = Math.ceil(dataSize2 / 254);
    var typeStr = (fileType === 4) ? ' SEQ ' : ' PRG ';

    parsedTAPEntries[eOff] = { fileData: fileData };
    entries.push({
      name: name,
      type: typeStr,
      blocks: blocks,
      deleted: false,
      entryOff: eOff,
    });
  }

  // Detect turbo loader stubs: files with same small size likely use turbo loading
  var turboWarning = '';
  if (entries.length > 0) {
    var stubCount = 0;
    for (var ti = 0; ti < entries.length; ti++) {
      if (entries[ti].blocks <= 1) stubCount++;
    }
    if (stubCount > 0) {
      turboWarning = stubCount === entries.length
        ? 'Turbo loader detected \u2014 only loader stubs extractable'
        : stubCount + ' of ' + entries.length + ' files are turbo loader stubs';
    }
  }

  parsedTapeDir = entries;
  return {
    diskName: tapeName,
    diskId: 'v' + version,
    freeBlocks: 0,
    entries: entries,
    format: 'TAP',
    tracks: 0,
    turboWarning: turboWarning
  };
}

// ── Parse disk image ─────────────────────────────────────────────────
function parseT64(buffer) {
  var data = new Uint8Array(buffer);
  parsedT64Entries = {};
  parsedTAPEntries = null;
  var maxEntries = data[0x22] | (data[0x23] << 8);
  var usedEntries = data[0x24] | (data[0x25] << 8);
  var tapeName = '';
  for (var i = 0; i < 24; i++) {
    var ch = data[0x28 + i];
    if (ch === 0x00) break;
    tapeName += PETSCII_MAP[ch] || String.fromCharCode(ch);
  }

  var entries = [];
  for (var ei = 0; ei < maxEntries && ei < 256; ei++) {
    var eOff = 0x40 + ei * 32;
    if (eOff + 32 > data.length) break;
    var entryType = data[eOff];
    if (entryType === 0) continue; // empty entry
    var fileType = data[eOff + 1]; // C64 file type (1=SEQ, $82=PRG, etc.)
    var startAddr = data[eOff + 2] | (data[eOff + 3] << 8);
    var endAddr = data[eOff + 4] | (data[eOff + 5] << 8);
    var dataOffset = data[eOff + 8] | (data[eOff + 9] << 8) | (data[eOff + 10] << 16) | (data[eOff + 11] << 24);
    var name = '';
    for (var ni = 0; ni < 16; ni++) {
      var ch2 = data[eOff + 16 + ni];
      if (ch2 === 0x00) { name += PETSCII_MAP[0xA0]; continue; }
      name += PETSCII_MAP[ch2] || '?';
    }
    var dataSize = endAddr - startAddr;
    var blocks = Math.ceil(dataSize / 254);
    var typeStr = (fileType & 0x07) === 1 ? ' SEQ ' : ' PRG ';
    parsedT64Entries[eOff] = {
      t64DataOffset: dataOffset,
      t64StartAddr: startAddr,
      t64EndAddr: endAddr
    };
    entries.push({
      name: name,
      type: typeStr,
      blocks: blocks,
      deleted: false,
      entryOff: eOff,
    });
  }

  parsedTapeDir = entries;
  return {
    diskName: tapeName,
    diskId: 'T64',
    freeBlocks: 0,
    entries: entries,
    format: 'T64',
    tracks: 0
  };
}

// Look up a tape directory entry by entryOff
function getTapeEntry(entryOff) {
  if (!parsedTapeDir) return null;
  for (var i = 0; i < parsedTapeDir.length; i++) {
    if (parsedTapeDir[i].entryOff === entryOff) return parsedTapeDir[i];
  }
  return null;
}

function isTapeFormat() {
  return currentFormat === DISK_FORMATS.t64 || currentFormat === DISK_FORMATS.tap;
}

// ── LNX (Lynx) archive parser ─────────────────────────────────────────
// LNX wraps multiple individual C64 files (PRG/SEQ/USR/REL) in a single
// uncompressed container: ASCII header + CR-delimited directory + sector-
// aligned concatenated file bytes. No disk geometry.
//
// Header layout (Ultra Lynx / UNLYNX compatible):
//   [optional 2-byte $01 $08 PRG load address + self-extracting BASIC stub]
//   <headerBlocks decimal> <whitespace/*> "LYNX" <space + comment> <CR>
//   <fileCount decimal> <CR>
//   repeat for each file:
//     <16-byte filename or CR-terminated ASCII> <CR>
//     <block-count decimal>                     <CR>
//     <type letter / word: P|S|U|R|DEL|...>     <CR>
//     <last-sector-bytes decimal, 1..255>       <CR>   // CBM convention: value = bytes_in_last_sector + 1
//   <padding to next 254-byte block>
//   <file 1 data> <file 2 data> ...
//
// dataStart = headerBlocks * 254 (absolute, header area absorbs any PRG prefix).
//
// Returns { files: [{ name, typeIdx, data }], comment } on success or
// { error } on failure. `name` is a Uint8Array of up to 16 PETSCII bytes.
function parseLnxArchive(buffer) {
  var data = new Uint8Array(buffer);
  if (data.length < 32) return { error: 'File is too small to be a LYNX archive.' };

  // Find "LYNX" magic. Self-extracting archives embed a BASIC stub that says
  // "USE LYNX TO DISSOLVE THIS FILE", so the first occurrence isn't always the
  // real header. For each candidate, look backward on the same line for the
  // leading integer (headerBlocks), then forward past the comment's CR to
  // read another integer (fileCount). Only commit when both parse cleanly.
  var magicOff = -1;
  var headerBlocks = 0;
  var fileCount = -1;
  var commentStart = 0, commentEnd = 0;
  var searchStart = 0;
  var searchLimit = Math.min(4096, data.length - 4);
  while (searchStart < searchLimit && magicOff < 0) {
    var candidate = -1;
    for (var i = searchStart; i < searchLimit; i++) {
      if (data[i] === 0x4C && data[i+1] === 0x59 && data[i+2] === 0x4E && data[i+3] === 0x58) {
        candidate = i;
        break;
      }
    }
    if (candidate < 0) break;

    // Walk backward from the candidate to find the CR (or buffer start) that
    // begins this line. Bytes between line-start and the candidate carry the
    // leading integer (headerBlocks). Cap backward scan at 64 bytes.
    var lineStart = candidate - 1;
    var lineMin = Math.max(0, candidate - 64);
    while (lineStart >= lineMin && data[lineStart] !== 0x0D) lineStart--;
    lineStart++; // first byte of the line

    var leading = '';
    for (var li = lineStart; li < candidate; li++) {
      if (data[li] >= 0x20 && data[li] <= 0x7E) leading += String.fromCharCode(data[li]);
    }
    var m = leading.match(/(\d+)/);
    if (!m) { searchStart = candidate + 4; continue; }
    var hb = parseInt(m[1], 10);
    if (!(hb >= 1 && hb <= 255)) { searchStart = candidate + 4; continue; }

    // Forward: skip comment to its CR, then read fileCount token.
    var pProbe = candidate + 4;
    var commentBegin = pProbe;
    while (pProbe < data.length && data[pProbe] !== 0x0D && (pProbe - commentBegin) < 128) pProbe++;
    if (pProbe >= data.length || data[pProbe] !== 0x0D) { searchStart = candidate + 4; continue; }
    var commentFinish = pProbe;
    pProbe++; // skip CR
    var fcStart = pProbe;
    while (pProbe < data.length && data[pProbe] !== 0x0D && (pProbe - fcStart) < 16) pProbe++;
    if (pProbe >= data.length || data[pProbe] !== 0x0D) { searchStart = candidate + 4; continue; }
    var fcStr = '';
    for (var fcI = fcStart; fcI < pProbe; fcI++) {
      if (data[fcI] >= 0x20 && data[fcI] <= 0x7E) fcStr += String.fromCharCode(data[fcI]);
    }
    fcStr = fcStr.trim();
    if (!/^\d+$/.test(fcStr)) { searchStart = candidate + 4; continue; }
    var fc = parseInt(fcStr, 10);
    if (!(fc >= 0 && fc <= 4096)) { searchStart = candidate + 4; continue; }

    magicOff = candidate;
    headerBlocks = hb;
    fileCount = fc;
    commentStart = commentBegin;
    commentEnd = commentFinish;
  }
  if (magicOff < 0) return { error: 'Not a LYNX archive (no LYNX signature found).' };

  var comment = '';
  for (var cIdx = commentStart; cIdx < commentEnd; cIdx++) {
    if (data[cIdx] >= 0x20 && data[cIdx] <= 0x7E) comment += String.fromCharCode(data[cIdx]);
  }
  comment = comment.trim();

  // Re-derive `p` — the inner-loop variables are scoped to the iteration.
  // Walk past: LYNX (4) + comment to CR + fileCount token to CR.
  var p = magicOff + 4;
  while (p < data.length && data[p] !== 0x0D) p++; p++; // past comment CR
  while (p < data.length && data[p] !== 0x0D) p++; p++; // past fileCount CR

  // Read the next CR-terminated token as a trimmed ASCII string.
  function readToken(maxLen) {
    maxLen = maxLen || 64;
    var start = p;
    while (p < data.length && data[p] !== 0x0D && (p - start) < maxLen) p++;
    if (p >= data.length) return null;
    var s = '';
    for (var k = start; k < p; k++) {
      if (data[k] >= 0x20 && data[k] <= 0x7E) s += String.fromCharCode(data[k]);
    }
    p++; // skip CR
    return s.trim();
  }

  // Read a filename. Handles both common conventions:
  //   (a) fixed 16 bytes, possibly followed by a CR (older LNX).
  //   (b) variable-length, CR-terminated (LYNX XV and later).
  // Detected by scanning forward for a CR within the first 17 bytes.
  // Returns a 16-byte Uint8Array padded with $A0.
  function readFilenameBytes() {
    var crIdx = -1;
    for (var k = p; k < Math.min(p + 17, data.length); k++) {
      if (data[k] === 0x0D) { crIdx = k; break; }
    }
    if (crIdx < 0) return null;
    var nameLen = crIdx - p;
    if (nameLen > 16) nameLen = 16;
    var name = new Uint8Array(16);
    for (var j = 0; j < 16; j++) name[j] = j < nameLen ? data[p + j] : 0xA0;
    p = crIdx + 1;
    return name;
  }

  // Header area = headerBlocks * 254 bytes, and absorbs any PRG prefix
  // that precedes the LYNX text.
  var dataStart = headerBlocks * 254;
  if (dataStart > data.length) return { error: 'LYNX header claims more blocks than the file contains.' };

  // First pass: parse the whole directory so we can pick padded vs compact
  // storage layout by seeing which one lines up best with the actual buffer
  // size. Some writers pad each file to a 254-byte block boundary; others
  // store files back-to-back at their exact data size.
  var entries = [];
  var idx = 0;
  while (true) {
    if (fileCount >= 0 && idx >= fileCount) break;
    if (p >= dataStart) break;
    if (p >= data.length) break;
    if (data[p] === 0x00) break; // header tail is zero-padded

    var nameBytes = readFilenameBytes();
    if (!nameBytes) break;
    var blocksTok = readToken();
    var typeTok = readToken();
    var lastBytesTok = readToken();
    if (blocksTok === null || typeTok === null || lastBytesTok === null) {
      if (fileCount >= 0) return { error: 'Malformed LYNX directory at entry ' + (idx + 1) + '.' };
      break;
    }
    var blocks = parseInt(blocksTok, 10);
    var lastBytes = parseInt(lastBytesTok, 10);
    if (!isFinite(blocks) || blocks < 1 || !isFinite(lastBytes) || lastBytes < 1 || lastBytes > 255) {
      if (fileCount >= 0) {
        return { error: 'Malformed LYNX entry at #' + (idx + 1) + '.' };
      }
      break;
    }

    // Type letter: first non-space ASCII alpha. Accepts P, S, U, R, D.
    var typeIdx = -1;
    for (var ti = 0; ti < typeTok.length; ti++) {
      var ch = typeTok.charCodeAt(ti);
      if (ch === 0x20) continue;
      if (ch === 0x50 || ch === 0x70) { typeIdx = FILE_TYPE.PRG; break; }
      if (ch === 0x53 || ch === 0x73) { typeIdx = FILE_TYPE.SEQ; break; }
      if (ch === 0x55 || ch === 0x75) { typeIdx = FILE_TYPE.USR; break; }
      if (ch === 0x52 || ch === 0x72) { typeIdx = FILE_TYPE.REL; break; }
      if (ch === 0x44 || ch === 0x64) { typeIdx = FILE_TYPE.DEL; break; }
      break;
    }
    entries.push({ name: nameBytes, typeIdx: typeIdx, blocks: blocks, lastBytes: lastBytes });
    idx++;
  }

  if (entries.length === 0) return { error: 'LYNX archive contains no file entries.' };

  // Decide padded vs compact storage: pick whichever predicted end-of-file
  // lines up better with the actual buffer size. `lastBytes` follows the CBM
  // disk convention (value = real bytes in last sector + 1), so the file
  // size is (blocks-1)*254 + (lastBytes-1).
  var paddedTotal = dataStart;
  var compactTotal = dataStart;
  for (var ei = 0; ei < entries.length; ei++) {
    paddedTotal += entries[ei].blocks * 254;
    compactTotal += (entries[ei].blocks - 1) * 254 + (entries[ei].lastBytes - 1);
  }
  var usePadded = Math.abs(paddedTotal - data.length) <= Math.abs(compactTotal - data.length);

  // Second pass: slice each file's data, advancing by padded or compact step.
  // Last file is truncated gracefully if the archive is shorter than declared.
  var files = [];
  var dataOff = dataStart;
  for (var fi = 0; fi < entries.length; fi++) {
    var e = entries[fi];
    var realSize = (e.blocks - 1) * 254 + (e.lastBytes - 1);
    var avail = data.length - dataOff;
    if (avail <= 0) {
      // Can't fit any data — skip the rest.
      break;
    }
    var take = Math.min(realSize, avail);
    var fileData = data.subarray(dataOff, dataOff + take);
    dataOff += usePadded ? (e.blocks * 254) : take;
    if (dataOff > data.length) dataOff = data.length;
    files.push({ name: e.name, typeIdx: e.typeIdx, blocks: e.blocks, data: fileData });
  }

  return { files: files, comment: comment };
}

/** @param {ArrayBuffer} buffer @returns {DiskInfo} */
function parseDisk(buffer) {
  var data = new Uint8Array(buffer);

  // X64 format: 64-byte header starting with "C1541" — strip header
  if (data.length > 64 && data[0] === 0x43 && data[1] === 0x31 && data[2] === 0x35 &&
      data[3] === 0x34 && data[4] === 0x31) {
    buffer = buffer.slice(64);
    data = new Uint8Array(buffer);
    currentBuffer = buffer;
  }

  // G64 format: decode GCR to D64 sectors
  if (data.length > 12 && data[0] === 0x47 && data[1] === 0x43 && data[2] === 0x52 && data[3] === 0x2D) {
    buffer = decodeG64toD64(data);
    data = new Uint8Array(buffer);
    currentBuffer = buffer;
  }

  const detected = detectFormat(data.length, buffer);
  currentFormat = detected.format;
  currentTracks = detected.tracks;

  // Reset interleave to format defaults
  if (detected.format.defaultInterleave) {
    fileInterleave = detected.format.defaultInterleave;
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

  // Count free blocks from BAM
  let freeBlocks = 0;
  const bamTracks = fmt.bamTracksRange(currentTracks);
  for (let t = 1; t <= bamTracks; t++) {
    if (t === fmt.dirTrack) continue;
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



// ── CMD FD system partition (D1M/D2M/D4M, track 81) ──────────────────
// Per-format constants captured byte-exact from VICE-formatted reference disks.
// Signature sector psize bytes at +0x71 (hi) / +0xA9 (lo); partition-1 size at +0x1E/+0x1F.
var _CMD_FD_SIG = {
  d1m: { sigHi71: 0x06, sigLoA9: 0x40, partSizeHi1E: 0x06, partSizeLo1F: 0x00 },
  d2m: { sigHi71: 0x0C, sigLoA9: 0x80, partSizeHi1E: 0x0C, partSizeLo1F: 0x80 },
  d4m: { sigHi71: 0x19, sigLoA9: 0x00, partSizeHi1E: 0x19, partSizeLo1F: 0x00 },
};
var _CMD_FD_MAGIC = 'CMD FD SERIES   '; // 16 bytes at t81 s5 + 0xF0
// VICE partition type codes (vdrive-dir.c:945)
var _CMD_FD_TYPE_NAMES = {
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

// Read the CMD FD system partition table from the last track.
// Returns null if the "CMD FD SERIES   " magic is absent, otherwise an array of
// { type, typeName, name, startBlock, sizeBlocks } for each populated entry.
function readCmdFdSysPartitions(buffer, formatKey, numTracks) {
  if (!_CMD_FD_SIG[formatKey]) return null;
  var data = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  var fmt = DISK_FORMATS[formatKey];
  var spt = fmt.sectorsPerTrack(1);
  var tLast = (numTracks - 1) * spt * 256;
  if (tLast + 12 * 256 > data.length) return null;

  // Magic check at t_last sector 5 offset 0xF0
  var sigOff = tLast + 5 * 256;
  for (var m = 0; m < 16; m++) {
    if (data[sigOff + 0xF0 + m] !== _CMD_FD_MAGIC.charCodeAt(m)) return null;
  }

  var partitions = [];
  var dirSectors = [8, 9, 10, 11];
  for (var si = 0; si < dirSectors.length; si++) {
    var so = tLast + dirSectors[si] * 256;
    // 8 entries per sector, 32 bytes each
    for (var ei = 0; ei < 8; ei++) {
      var e = so + ei * 32;
      var type = data[e + 0x02];
      // Skip unused slots. The chain-link bytes at offsets 0/1 of each sector
      // overlap entry 0's first two bytes, so we only classify by type.
      if (type === 0x00) continue;

      var name = '';
      for (var ni = 0; ni < 16; ni++) {
        var ch = data[e + 0x05 + ni];
        if (ch === 0xA0 || ch === 0x00) break;
        name += String.fromCharCode(ch);
      }
      var startBlock = (data[e + 0x15] << 16) | (data[e + 0x16] << 8) | data[e + 0x17];
      var sizeBlocks = (data[e + 0x1D] << 16) | (data[e + 0x1E] << 8) | data[e + 0x1F];
      partitions.push({
        type: type,
        typeName: _CMD_FD_TYPE_NAMES[type] || ('0x' + type.toString(16)),
        name: name,
        startBlock: startBlock,
        sizeBlocks: sizeBlocks,
      });
    }
  }
  return partitions;
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
  data[hdrOff + fmt.idOffset + 0] = 0xA0;
  data[hdrOff + fmt.idOffset + 1] = 0xA0;
  data[hdrOff + fmt.idOffset + 2] = 0xA0;
  data[hdrOff + fmt.idOffset + 3] = fmt.dosType.charCodeAt(0);
  data[hdrOff + fmt.idOffset + 4] = fmt.dosType.charCodeAt(1);
  data[hdrOff + fmt.subdirSelfRef] = fmt.headerTrack;
  data[hdrOff + fmt.subdirSelfRef + 1] = fmt.headerSector;
  data[hdrOff + fmt.subdirParentRef] = 0x00;
  data[hdrOff + fmt.subdirParentRef + 1] = 0x00;

  // Track 1, Sector 2: first BAM sector (32-byte header + tracks 1-7 bitmap)
  var bam0Off = 2 * 256;
  data[bam0Off + 0x02] = fmt.dosVersion;
  data[bam0Off + 0x03] = ~fmt.dosVersion & 0xFF;
  data[bam0Off + 0x04] = 0xA0; data[bam0Off + 0x05] = 0xA0;
  data[bam0Off + 0x06] = 0xC0; // I/O byte
  data[bam0Off + 0x08] = numTracks;
  // Slots 1-7 (offset 32-255): tracks 1-7 bitmap, all free
  for (var b = 32; b < 256; b++) data[bam0Off + b] = 0xFF;

  // Track 1, Sectors 3-33: remaining BAM sectors (8 tracks each, no header)
  for (var s = 3; s <= 33; s++) {
    var sOff = s * 256;
    for (var b2 = 0; b2 < 256; b2++) data[sOff + b2] = 0xFF;
  }

  // Mark track 1 sectors 0-34 as used in BAM (MSB-first bit order)
  var t1bm = bam0Off + 32; // track 1 bitmap at sector 2 offset 32
  for (var us = 0; us <= 34; us++) {
    data[t1bm + (us >> 3)] &= ~(0x80 >> (us & 7));
  }

  // Clear unused BAM bits for tracks with fewer than 256 sectors
  // (D1M: 40 spt, D2M: 80 spt, D4M: 160 spt — unused bits should be 0)
  if (spt < 256) {
    for (var bt = 1; bt <= numTracks; bt++) {
      var bamSec = 2 + (bt >> 3);
      var bamSlotOff = bamSec * 256 + (bt & 7) * 32;
      var usedBytes = Math.ceil(spt / 8);
      // Clear bits for sectors >= spt in the last used byte
      if (spt % 8 !== 0) {
        var lastByte = usedBytes - 1;
        var validBits = spt % 8;
        // MSB-first: keep top 'validBits' bits, clear the rest
        var mask = 0xFF << (8 - validBits);
        if (bt !== 1) data[bamSlotOff + lastByte] &= mask; // track 1 already handled above
      }
      // Zero out padding bytes beyond the last used byte
      for (var pb = usedBytes; pb < 32; pb++) {
        data[bamSlotOff + pb] = 0x00;
      }
    }
  }

  // Track 1, Sector 34: first directory sector
  var dirOff = 34 * 256;
  data[dirOff + 0] = 0x00; data[dirOff + 1] = 0xFF;

  // D1M/D2M/D4M: write CMD FD system partition on the last track.
  // Note: VICE intentionally leaves t_last s5 & s8-11 marked free in the main BAM —
  // allocation is prevented via fmt.getProtectedSectors(), not via BAM bits. Matching
  // that behaviour keeps the free-block count consistent with VICE/DirMaster.
  if (formatKey !== 'dnp' && _CMD_FD_SIG[formatKey]) {
    writeCmdFdSystemPartition(data, formatKey, numTracks);
  }

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
