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
// DNP dir-track free-blocks: skip the first 8 BAM bytes (sectors 0-63 of
// the dir track). The CMD HD ROM treats those 64 sectors as reserved
// regardless of bitmap state — 35 of them are bitmap-marked used (boot,
// T1/S1 header, 32 BAM sectors, first dir) and the remaining 29 are
// pre-reserved for dir-chain growth. Real hardware reports `(tracks × 256) − 64`
// free on a fresh-formatted Native; we have to subtract the same 29
// invisible reserved sectors to match.
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
      return (currentBuffer && getSpeederVariant(currentBuffer)) ? numTracks : 35;
    },
    getBamBitmapBase(bamOff, track) { return _d64BamEntry(bamOff, track) + 1; },
    readTrackFree(data, bamOff, track) {
      return data[_d64BamEntry(bamOff, track)];
    },
    writeTrackFree(data, bamOff, track, free) {
      data[_d64BamEntry(bamOff, track)] = free;
    },
    readTrackBitmap(data, bamOff, track) {
      const base = _d64BamEntry(bamOff, track);
      return data[base + 1] | (data[base + 2] << 8) | (data[base + 3] << 16);
    },
    writeTrackBitmap(data, bamOff, track, bm) {
      const base = _d64BamEntry(bamOff, track);
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
    _bamBase(bamOff, track) {
      // bamOff points to T40/S1
      if (track <= 40) {
        return bamOff + 0x10 + (track - 1) * 6;
      } else {
        // BAM sector 2 is at T40/S2 (256 bytes after T40/S1)
        return bamOff + 256 + 0x10 + (track - 41) * 6;
      }
    },
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
  // CFS 0.11 filesystem inside an IDE64 partition. Becomes currentFormat
  // on entering a CFS partition so menu-state queries that read
  // currentFormat.filesystem branch to CFS-aware code without touching
  // the CBM-DOS path. Geometry differs from CBM-DOS in every dimension —
  // 512-byte sectors, LBA addressing, 16-byte filenames, 16 dir entries
  // per sector. The placeholder CBM-DOS hooks below are never invoked
  // because dispatch happens earlier (cfsPartitionIdx >= 0).
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
// BAM iteration extent for D1M/D2M/D4M. The BAM is LBA-indexed (one slot
// per 256-sector logical track) while the format descriptor declares
// physical SPT (40/80/160). Validators iterating the bitmap need LBA
// coords; without this override they'd visit physical tracks past the
// effective slot count, where _fdIsSectorFree returns false for every
// sector and produces phantom orphans (e.g. 4960 on a fresh D4M).
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
  // LBA addressing: dir/file-chain T:S use sector_idx = (T-1)*256 + S
  // regardless of physical SPT. Consumed by sectorOffset().
  DISK_FORMATS[k].lbaAddressing = true;
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
  ctx = ctx || getCurrentCtx();
  return ctx.format.sectorsPerTrack(t);
}



// ── BAM byte-level helpers (partition-aware, handles D81 >32 sectors) ─
// Partition BAM: returns byte offset for a track's BAM entry (free count byte)
// relTrack is 1-based relative to partition start
function getPartitionBamEntry(bamOff, relTrack, ctx) {
  ctx = ctx || getCurrentCtx();
  var fmt = ctx.format;
  var spt = fmt.partitionSpt;
  var off = fmt.partitionBamOffset;
  var esz = fmt.partitionBamEntrySize;
  if (relTrack <= spt) return bamOff + off + (relTrack - 1) * esz;
  return bamOff + 256 + off + (relTrack - spt - 1) * esz;
}

// Returns the byte offset of the bitmap bytes for a given track.
// For partitions, track is absolute (disk-level) and bamOff is the partition BAM offset.
function getBamBitmapBase(track, bamOff, ctx) {
  ctx = ctx || getCurrentCtx();
  var partition = ctx.partition;
  if (partition && !partition.dnpDir) {
    var relTrack = track - partition.startTrack + 1;
    return getPartitionBamEntry(bamOff, relTrack, ctx) + 1;
  }
  return ctx.format.getBamBitmapBase(bamOff, track);
}

/** @param {Uint8Array} data @param {number} bamOff @param {number} track @param {number} sector @returns {boolean} */
function checkSectorFree(data, bamOff, track, sector, ctx) {
  ctx = ctx || getCurrentCtx();
  if (ctx.format.isSectorFree) return ctx.format.isSectorFree(data, bamOff, track, sector);
  var base = getBamBitmapBase(track, bamOff, ctx);
  return (data[base + Math.floor(sector / 8)] & (1 << (sector % 8))) !== 0;
}

/** @param {Uint8Array} data @param {number} track @param {number} sector @param {number} bamOff */
function bamMarkSectorUsed(data, track, sector, bamOff, ctx) {
  ctx = ctx || getCurrentCtx();
  var base = getBamBitmapBase(track, bamOff, ctx);
  data[base + (sector >> 3)] &= ~ctx.format.bamBitMask(sector);
  bamRecalcFree(data, track, bamOff, ctx);
}

/** @param {Uint8Array} data @param {number} track @param {number} sector @param {number} bamOff */
function bamMarkSectorFree(data, track, sector, bamOff, ctx) {
  ctx = ctx || getCurrentCtx();
  var base = getBamBitmapBase(track, bamOff, ctx);
  data[base + (sector >> 3)] |= ctx.format.bamBitMask(sector);
  bamRecalcFree(data, track, bamOff, ctx);
}

/** @param {Uint8Array} data @param {number} track @param {number} bamOff */
function bamRecalcFree(data, track, bamOff, ctx) {
  ctx = ctx || getCurrentCtx();
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
  // Write free count
  if (partition && !partition.dnpDir) {
    var relTrack = track - partition.startTrack + 1;
    data[getPartitionBamEntry(bamOff, relTrack, ctx)] = free;
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
  ctx = ctx || getCurrentCtx();
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
    if (t < 1 || t > ctx.tracks) return { data: new Uint8Array(bytes), error: 'Illegal track ' + t };
    if (s < 0 || s >= ctx.format.sectorsPerTrack(t)) return { data: new Uint8Array(bytes), error: 'Illegal sector ' + s + ' on track ' + t };
    var key = t + ':' + s;
    if (visited[key]) return { data: new Uint8Array(bytes), error: 'Circular reference at T:' + t + ' S:' + s };
    visited[key] = true;

    var off = sectorOffset(t, s, ctx);
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

// Resolve the BAM entry start (free-count byte) for D64 track N.
// Tracks 1-35: standard 4-byte entries starting at +$04. Tracks 36-40:
// speeder-DOS extended BAM at the variant's offset, or -1 when no
// variant is detected (the caller shouldn't reach here in that case
// because bamTracksRange caps at 35).
function _d64BamEntry(bamOff, track) {
  if (track <= 35) return bamOff + 4 * track;
  var v = currentBuffer ? getSpeederVariant(currentBuffer) : null;
  if (v === 'SpeedDOS') return bamOff + 0xC0 + (track - 36) * 4;
  if (v === 'DolphinDOS') return bamOff + 0xAC + (track - 36) * 4;
  return -1;
}


// D64.TXT lines 233-242 / D71.TXT lines 248-251 / D81.TXT lines 117-120:
// BAM +$02 ("DOS version") that isn't the format's expected byte or $00
// triggers a "DOS Version" error 73 on every write — a "soft write protect".
// Expected byte: $41 ('A') for D64/D71, $44 ('D') for D81, $43 ('C') for
// D80/D82 — pulled from the format descriptor's `dosVersion` field.
// Gated by `fmt.hasSoftWriteProtect` so any future format that grows the
// same semantic is covered by setting the flag on its descriptor.
// We don't block writes (the user knows what they're doing); we just
// surface the state in the health-dot tooltip and the BAM-view banner.
// Returns the offending byte value, or null when the disk is writable.
function isSoftWriteProtected(buffer) {
  if (!buffer || !currentFormat.hasSoftWriteProtect) return null;
  var data = new Uint8Array(buffer);
  var bamOff = sectorOffset(currentFormat.bamTrack, currentFormat.bamSector);
  if (bamOff < 0) return null;
  var v = data[bamOff + 0x02];
  return (v === currentFormat.dosVersion || v === 0x00) ? null : v;
}

// Spec lines 327-364: 40-track speeder-DOS variants store the extra
// BAM entries for tracks 36-40 at non-standard offsets. We identify
// the variant by the *presence of plausible BAM data* at the known
// offsets, NOT by the DOS-type field at +$A5/+$A6 — that byte pair is
// user-editable and unreliable as a format signal (see PrologicDOS /
// ProfDOS "2P"/"4A" which are deliberately not supported here).
//
// Returns 'SpeedDOS' | 'DolphinDOS' | null. Gated by
// `fmt.supportsSpeederBam` so the check stays inert on formats that
// don't define the speeder-BAM layout (D71/D80/D82/D81/CMD native).
function getSpeederVariant(buffer) {
  if (!buffer || !currentFormat.supportsSpeederBam) return null;
  if (currentTracks < 40) return null;
  var data = new Uint8Array(buffer);
  var bamOff = sectorOffset(currentFormat.bamTrack, currentFormat.bamSector);
  if (bamOff < 0) return null;
  if (_hasFdEntries(data, bamOff + 0xC0)) return 'SpeedDOS';
  if (_hasFdEntries(data, bamOff + 0xAC)) return 'DolphinDOS';
  return null;
}

// 5 entries × 4 bytes (free-count + 3 bitmap bytes) — require free
// counts <= 17 (max SPT on tracks 36-40) and at least one bitmap byte
// non-zero. Pure padding / all-zero ranges → no extended BAM there.
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

// C128 auto-boot disks have the literal bytes 'CBM' at T1/S0 +$00..+$02
// (C128BOOT.TXT rev 1.1). Routed through sectorOffset so the check
// also works on D71/D81 if anyone ever stamps a boot block there.
function hasC128BootSignature(buffer) {
  if (!buffer) return false;
  var data = new Uint8Array(buffer);
  var off = sectorOffset(1, 0);
  if (off < 0 || off + 3 > data.length) return false;
  return data[off] === 0x43 && data[off + 1] === 0x42 && data[off + 2] === 0x4D;
}

// D81-specific auto-boot loader flag (D81.TXT lines 497-510). When BAM
// (T40/S1) +$07 is non-zero the 1581 ROM looks for a USR file named
// "COPYRIGHT CBM 86" on reset and executes it. Independent of the C128
// boot-block signature above. Gated by `fmt.hasAutoBootFlag` so any
// future format that grows the same convention can opt in.
function hasD81AutoBootLoader(buffer) {
  if (!buffer || !currentFormat.hasAutoBootFlag) return false;
  var data = new Uint8Array(buffer);
  var bamOff = sectorOffset(currentFormat.bamTrack, currentFormat.bamSector);
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
  //
  // DNP is variable-size — sizes[] is empty — so derive track count from
  // the slice itself (one track = 256 sectors × 256 bytes = 64 KiB).
  // Without this, parseDisk would fall through to the hardcoded "81"
  // default and a 16 MiB Native partition would mis-report itself as an
  // 81-track DNP, showing 20,672 free instead of 65,216.
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

  // Flat .rml-as-DNP fallback: when a file ending in .rml/.rl turns
  // out to be a plain DNP (no RAMLink partition table), label it as
  // RAMLink so save-as keeps the .rml extension. Skipped inside a real
  // CMD container (cmdcBuffer set) — there the slice is a genuine
  // DNP/D64/D81 and shouldn't be relabelled.
  if (!cmdcBuffer && currentFormat === DISK_FORMATS.dnp && currentFileName && /\.(rml|rl)$/i.test(currentFileName)) {
    currentFormat = DISK_FORMATS.ramlink;
  }

  // Reset interleave to format defaults. dirInterleave is per-format:
  // D64/D71/D80/D82 use 3; D81 and the CMD native formats (DNP/D1M/D2M/D4M)
  // buffer a whole track at once so they use 1 for both files and dir.
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

// ── CBM-DOS dir-tree paste (cross-family writer) ─────────────────────
// Mirrors cfsPasteDirTree, but writes to a CBM-DOS partition (D81 / DNP
// / D1M-D2M-D4M Native). Uses the ctx-aware writeFileToDisk so the
// target dir is determined by `diskCtx` (typically pointing at a
// non-current partition).
//
// First-pass MVP: pastes files only. Subdir creation in the destination
// is deferred to a follow-up — when the source tree carries subdirs
// they're skipped and reported in skippedDirs.

// Map a CFS file's ftype/typeSuffix to a CBM-DOS typeIdx (1=SEQ 2=PRG
// 3=USR 4=REL). CFS-typed files (NORMAL with a "TXT" / "PRG" suffix
// string) collapse to PRG unless they explicitly declare SEQ / USR.
function cfsToCbmTypeIdx(ftype, typeSuffix) {
  // CFS_FTYPE.REL (the format-ide64.js constant) is 2. Use the numeric
  // value directly so this helper has no dependency on cbm-format-ide64.js
  if (ftype === 2) return 4; // REL
  if (typeSuffix === 'SEQ') return 1;
  if (typeSuffix === 'USR') return 3;
  if (typeSuffix === 'REL') return 4;
  return 2; // default PRG
}

// Resolve the effective CBM typeIdx for a generic-tree file entry —
// prefers file.cbmTypeIdx when the collector set it, falls back to the
// CFS mapping otherwise. Returns 2 (PRG) for fully untyped entries.
function resolveFileCbmTypeIdx(file) {
  if (file.cbmTypeIdx) return file.cbmTypeIdx;
  return cfsToCbmTypeIdx(file.ftype, file.typeSuffix);
}

// Inverse of cfsToCbmTypeIdx — map a CBM-DOS typeIdx (1=SEQ, 2=PRG,
// 3=USR, 4=REL) onto CFS file fields. Used by cfsPasteDirTree when a
// file in the source tree came from a CBM-DOS collector (cbmTypeIdx
// set, ftype/typeSuffix unset). Returned typeSuffix matches what
// cfsImportFile expects to land in the dir entry's $19..$1B "PRG" /
// "SEQ" / "USR" / "REL" suffix bytes.
function cbmToCfsTypeFields(cbmTypeIdx) {
  // CFS_FTYPE constants (NORMAL=1, REL=2) are defined in cbm-format-ide64.js.
  // Use the numeric values directly so this helper has no cross-file dep.
  if (cbmTypeIdx === 4) return { ftype: 2, typeSuffix: 'REL' }; // REL
  if (cbmTypeIdx === 1) return { ftype: 1, typeSuffix: 'SEQ' };
  if (cbmTypeIdx === 3) return { ftype: 1, typeSuffix: 'USR' };
  return { ftype: 1, typeSuffix: 'PRG' }; // 2 PRG and any unknown default
}

// Resolve the effective CFS ftype/typeSuffix for a generic-tree file —
// mirrors resolveFileCbmTypeIdx. Prefers the source-set CFS fields,
// falls back to the CBM mapping, then to NORMAL/PRG.
function resolveFileCfsTypeFields(file) {
  if (file.ftype && file.typeSuffix) return { ftype: file.ftype, typeSuffix: file.typeSuffix };
  if (file.cbmTypeIdx) return cbmToCfsTypeFields(file.cbmTypeIdx);
  return { ftype: 1, typeSuffix: 'PRG' };
}

// Find a CBM-DOS dir entry by raw 16-byte PETSCII name in the current
// directory referenced by diskCtx. Uses effective-length comparison
// (trim $A0 / $00 / trailing-space padding) so a space-padded name
// matches an $A0-padded one when the visible prefix agrees. Returns
// the entry offset or -1.
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

// Walk a CBM-DOS directory and collect every file + nested subdir into
// the generic tree shape that cbmPasteDirTree / cfsPasteDirTree consume.
// `diskCtx` selects the partition / root (via diskCtx.partition). The
// returned tree carries CBM-DOS-typed file entries (cbmTypeIdx +
// optional geosBytes/geosInfoBlock/vlirRecords) that the paster's
// type-translation layer maps onto CFS when crossing families.
//
// Subdir traversal:
//   - DNP / CMD Native (subdirLinked:true): DIR entries point at the
//     subdir's header sector. Recurse with a {dnpDir:true, ...} child
//     partition.
//   - D81 (subdirLinked:false): a $05 PARTITION entry points at the
//     sub-disk's start track. Recurse with a {startTrack, partSize}
//     child partition.
//
// VLIR GEOS files are captured (geosBytes + geosInfoBlock + a marker)
// but a `vlirRecords: { skipped: true }` flag is set so the CBM-DOS
// paster knows to skip them rather than corrupt the destination with
// a flat-byte-stream rewrite. The CFS paster also skips VLIR for the
// same reason.
//
// Returns { ok, tree, error? }. The tree shape matches what
// cfsCollectDirTree emits, so paste targets stay symmetric.
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

        // D81 sub-partition (file type $05, but format is not subdirLinked)
        if (typeIdx === localFmt.subdirType && !localFmt.subdirLinked) {
          // entry[30..31] = partition size in sectors (LE)
          var partSize = localData[entryOff + 30] | (localData[entryOff + 31] << 8);
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

        // Regular file (PRG / SEQ / USR / REL). Skip the type-$00 DEL
        // case (already filtered above by typeByte === 0 / closed bit).
        if (typeIdx < 1 || typeIdx > 4) continue;
        var fileName = readNameBytes(entryOff);
        // GEOS metadata: bytes 21-29 of dir entry. Capture as-is.
        var hasGeos = false;
        var geosBytes = new Uint8Array(9);
        for (var gi = 0; gi < 9; gi++) {
          geosBytes[gi] = localData[entryOff + 21 + gi];
          if (geosBytes[gi] !== 0) hasGeos = true;
        }
        // Read info block (at entry $15/$16) if it points at a real
        // sector — GEOS sequential + VLIR files both carry this.
        var geosInfoBlock = null;
        if (hasGeos) {
          var infoT = localData[entryOff + 0x15];
          var infoS = localData[entryOff + 0x16];
          if (infoT > 0) {
            var infoOff = sectorOffset(infoT, infoS, ctx);
            if (infoOff >= 0 && infoOff + 256 <= localData.length) {
              geosInfoBlock = new Uint8Array(256);
              for (var ib = 0; ib < 256; ib++) geosInfoBlock[ib] = localData[infoOff + ib];
            }
          }
        }
        // VLIR detection: entry byte $17 = 0x01 means VLIR file. Capture
        // the flag so the paster can skip with a clear warning instead
        // of writing the VLIR index sector as a flat byte stream.
        var isVlir = (hasGeos && localData[entryOff + 0x17] === 0x01);

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
          // Mark as VLIR without reading the payload — the index sector
          // bytes alone aren't a valid file body, and unpacking the
          // record chains here would duplicate ui-viewer-vlir's logic.
          fileEntry.vlirRecords = { skipped: true };
          fileEntry.payload = new Uint8Array(0);
        } else {
          var rd = readFileData(ctx.buffer, entryOff, ctx);
          if (rd.error) {
            // Unreadable chain — surface in skippedLnks-style list so
            // the caller's summary can note it.
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

// Create a DNP-style linked subdir (subdirLinked formats: CMD Native,
// D1M/D2M/D4M Native partitions). Allocates 2 sectors (header + first
// dir sector), wires up the parent/child pointers per the format
// descriptor's subdir* offsets, and creates a DIR entry in the current
// parent. Returns { ok, error?, partition } where `partition` is a
// {dnpDir:true, dnpHeaderT, dnpHeaderS, dnpDirT, dnpDirS, name} shape
// suitable for building a child diskCtx to recurse into.
function _cbmCreateDnpSubdir(diskCtx, name) {
  if (!diskCtx || !diskCtx.buffer || !diskCtx.format) return { ok: false, error: 'invalid disk context' };
  if (!name) return { ok: false, error: 'empty name' };
  var buffer = diskCtx.buffer;
  var fmt = diskCtx.format;
  var partition = diskCtx.partition;
  if (!fmt.subdirLinked) return { ok: false, error: 'format does not support linked subdirs' };
  var data = new Uint8Array(buffer);

  var bamOff = sectorOffset(fmt.bamTrack, fmt.bamSector, diskCtx);

  // Allocate 2 sectors: header + first dir sector
  var allocated = buildTrueAllocationMap(buffer, diskCtx);
  var sectorList = allocateSectors(allocated, 2, diskCtx);
  if (sectorList.length < 2) return { ok: false, error: 'Not enough free sectors for a new subdir' };

  var hdrSec = sectorList[0];
  var dirSec = sectorList[1];

  // Parent header T/S for back-navigation (root vs nested subdir)
  var parentHeaderT = fmt.headerTrack;
  var parentHeaderS = fmt.headerSector;
  if (partition && partition.dnpHeaderT !== undefined) {
    parentHeaderT = partition.dnpHeaderT;
    parentHeaderS = partition.dnpHeaderS;
  }

  // Header sector
  var hdrOff = sectorOffset(hdrSec.track, hdrSec.sector, diskCtx);
  for (var hi = 0; hi < 256; hi++) data[hdrOff + hi] = 0x00;
  data[hdrOff + 0x00] = dirSec.track;
  data[hdrOff + 0x01] = dirSec.sector;
  data[hdrOff + 0x02] = fmt.dosVersion;
  for (var ni = 0; ni < fmt.nameLength; ni++) {
    if (ni < name.length) {
      var ch = name.charCodeAt(ni);
      data[hdrOff + fmt.nameOffset + ni] = (ch >= 0x41 && ch <= 0x5A) ? ch : (ch >= 0x30 && ch <= 0x39) ? ch : 0x20;
    } else {
      data[hdrOff + fmt.nameOffset + ni] = 0xA0;
    }
  }
  // ID region from the root header (preserves disk ID + DOS-type bytes)
  var rootHdrOff = sectorOffset(fmt.headerTrack, fmt.headerSector, diskCtx);
  for (var idi = 0; idi < fmt.idLength; idi++) {
    data[hdrOff + fmt.idOffset + idi] = data[rootHdrOff + fmt.idOffset + idi];
  }
  // Self-reference + parent-header pointers
  data[hdrOff + fmt.subdirSelfRef] = hdrSec.track;
  data[hdrOff + fmt.subdirSelfRef + 1] = hdrSec.sector;
  data[hdrOff + fmt.subdirParentRef] = parentHeaderT;
  data[hdrOff + fmt.subdirParentRef + 1] = parentHeaderS;

  // First dir sector: 00 FF + zeroes
  var dirOff = sectorOffset(dirSec.track, dirSec.sector, diskCtx);
  for (var di = 0; di < 256; di++) data[dirOff + di] = 0x00;
  data[dirOff + 0x00] = 0x00;
  data[dirOff + 0x01] = 0xFF;

  bamMarkSectorUsed(data, hdrSec.track, hdrSec.sector, bamOff, diskCtx);
  bamMarkSectorUsed(data, dirSec.track, dirSec.sector, bamOff, diskCtx);

  // Create DIR entry in the parent
  var entryOff = findFreeDirEntry(buffer, null, diskCtx);
  if (entryOff < 0) return { ok: false, error: 'No free directory entry available' };
  data[entryOff + 2] = 0x80 | fmt.subdirType;
  data[entryOff + 3] = hdrSec.track;
  data[entryOff + 4] = hdrSec.sector;
  for (var eni = 0; eni < fmt.nameLength; eni++) {
    data[entryOff + 5 + eni] = data[hdrOff + fmt.nameOffset + eni];
  }
  for (var eu = 21; eu < 30; eu++) data[entryOff + eu] = 0x00;
  data[entryOff + 30] = 2;
  data[entryOff + 31] = 0;

  // Parent dir-entry reference per D2M-DNP.TXT (rev 1.3):
  //   +$24/$25 = T/S of the parent dir block holding our entry
  //   +$26    = entry index within that block (0..7)
  // For LBA-addressed formats (DNP / D1M / D2M / D4M), sectorOffset uses
  //   ((T-1)*256 + S)*256, so the inverse is straightforward.
  var parentDirT = (entryOff >>> 16) + 1;
  var parentDirS = (entryOff >>> 8) & 0xFF;
  var parentIdx = (entryOff >>> 5) & 0x07;
  data[hdrOff + fmt.subdirParentEntry] = parentDirT;
  data[hdrOff + fmt.subdirParentEntry + 1] = parentDirS;
  data[hdrOff + fmt.subdirParentEntry + 2] = parentIdx;

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

// Paste a generic dir tree into a CBM-DOS partition. opts.onConflict
// behaves like cfsPasteDirTree: 'overwrite' removes the existing file
// before writing, 'rename' would auto-suffix (deferred for now since
// CBM-DOS rename + truncation isn't built yet), 'cancel' refuses.
// Returns { ok, error?, copiedFiles, copiedDirs, skippedLnks, skippedDirs }.
function cbmPasteDirTree(diskCtx, tree, opts) {
  if (!diskCtx || !diskCtx.buffer || !diskCtx.format) return { ok: false, error: 'invalid disk context' };
  if (!tree) return { ok: false, error: 'invalid tree' };
  opts = opts || {};
  var onConflict = opts.onConflict || 'cancel';

  var copiedFiles = 0;
  var copiedDirs = 0;
  var skippedLnks = (tree.skippedLnks || []).slice();
  var skippedDirs = [];

  // Decode a raw 16-byte PETSCII name into a display string. Inline so
  // the file + subdir loops below stay self-contained.
  function _displayName(nameBytes) {
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

  for (var i = 0; i < tree.files.length; i++) {
    var file = tree.files[i];
    if (!file.payload) continue;
    // GEOS VLIR files don't roundtrip cleanly through writeFileToDisk
    // (their payload is the index sector + record chains, not a flat
    // byte stream). Skip with a warning rather than corrupting the
    // destination disk.
    if (file.vlirRecords) {
      skippedLnks.push('(GEOS VLIR file skipped — not yet supported by CBM-DOS writer)');
      continue;
    }
    var typeIdx = resolveFileCbmTypeIdx(file);
    // Conflict check on the file name
    if (onConflict === 'overwrite' || onConflict === 'cancel') {
      var existing = _cbmFindDirEntryByNameBytes(diskCtx, file.nameBytes);
      if (existing >= 0) {
        if (onConflict === 'cancel') {
          var displayName = '';
          for (var dn = 0; dn < 16; dn++) {
            var dnb = file.nameBytes[dn];
            if (dnb === 0xA0 || dnb === 0x00) break;
            if (dnb >= 0xC1 && dnb <= 0xDA) displayName += String.fromCharCode(dnb - 0x80);
            else if (dnb >= 0x20 && dnb <= 0x7E) displayName += String.fromCharCode(dnb);
          }
          return { ok: false, error: 'File "' + displayName.trim() + '" already exists; choose Overwrite (or remove it first).' };
        }
        // Overwrite: scratch the existing entry first (closed bit cleared
        // makes the slot reusable on next write).
        var dataBefore = new Uint8Array(diskCtx.buffer);
        dataBefore[existing + 2] = 0x00; // wipe type — full scratch happens by writeFileToDisk picking the slot
        // Wipe other bytes too so findFreeDirEntry treats the slot as
        // empty on its scan.
        for (var w = 3; w < 32; w++) dataBefore[existing + w] = 0x00;
      }
    }
    var geosData = null;
    if (file.geosBytes || file.geosInfoBlock) {
      geosData = {
        geosBytes: file.geosBytes || new Uint8Array(9),
        geosInfoBlock: file.geosInfoBlock || null,
      };
    }
    var ok = writeFileToDisk(typeIdx, file.nameBytes, file.payload, geosData, true, diskCtx);
    if (!ok) {
      return { ok: false, error: 'writeFileToDisk failed for a file' };
    }
    copiedFiles++;
  }

  // Subdirectories — only supported on linked-subdir formats (DNP and
  // CMD Native partitions inside D1M/D2M/D4M). D81 sub-partitions and
  // other non-linked subdir mechanisms aren't built yet; their entries
  // get reported in skippedDirs.
  if (tree.subdirs && tree.subdirs.length > 0) {
    var fmt = diskCtx.format;
    for (var di = 0; di < tree.subdirs.length; di++) {
      var sub = tree.subdirs[di];
      var subName = _displayName(sub.nameBytes);
      if (!subName) subName = 'SUBDIR';
      if (!fmt.subdirLinked) {
        skippedDirs.push(subName + ' (this format does not support nested subdirs)');
        continue;
      }
      var existing = _cbmFindDirEntryByNameBytes(diskCtx, sub.nameBytes);
      var subCtx = null;
      if (existing >= 0 && onConflict === 'overwrite') {
        // Same-name subdir already exists. Read its header T/S so we
        // can recurse into the existing dir rather than re-creating it.
        var dataNow = new Uint8Array(diskCtx.buffer);
        var hdrT = dataNow[existing + 3], hdrS = dataNow[existing + 4];
        var hdrOff = sectorOffset(hdrT, hdrS, diskCtx);
        if (hdrOff < 0) {
          skippedDirs.push(subName + ' (existing dir entry points at an invalid sector)');
          continue;
        }
        subCtx = Object.assign({}, diskCtx, {
          partition: {
            dnpDir: true,
            dnpHeaderT: hdrT, dnpHeaderS: hdrS,
            dnpDirT: dataNow[hdrOff + 0x00], dnpDirS: dataNow[hdrOff + 0x01],
            name: subName,
          },
        });
      } else if (existing >= 0 && onConflict === 'cancel') {
        return { ok: false, error: 'Directory "' + subName + '" already exists; choose Overwrite (or rename it first).' };
      } else {
        var creation = _cbmCreateDnpSubdir(diskCtx, subName);
        if (!creation.ok) {
          return { ok: false, error: 'creating subdir "' + subName + '": ' + (creation.error || 'unknown') };
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
