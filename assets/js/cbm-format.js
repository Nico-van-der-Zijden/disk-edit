// ── Disk Format Descriptors ───────────────────────────────────────────
// Each format defines its geometry, BAM layout, and directory structure.
// Adding D71/D81 support = adding a new descriptor + format-specific BAM functions.

const DISK_FORMATS = {
  d64: {
    name: 'D64',
    ext: '.d64',
    dirTrack: 18,
    dirSector: 1,
    bamTrack: 18,
    bamSector: 0,
    dosVersion: 0x41,    // 'A'
    dosType: '2A',
    nameOffset: 0x90,    // offset within BAM sector for disk name
    nameLength: 16,
    idOffset: 0xA2,      // offset within BAM sector for disk ID
    idLength: 5,
    maxDirSectors: 18,   // sectors 1-18 on track 18
    entriesPerSector: 8,
    entrySize: 32,
    doubleSidedFlag: 0x00,
    sizes: [
      { tracks: 35, bytes: 174848, label: '35 Tracks' },
      { tracks: 35, bytes: 175531, label: '35 Tracks + Errors' },
      { tracks: 40, bytes: 196608, label: '40 Tracks' },
      { tracks: 40, bytes: 197376, label: '40 Tracks + Errors' },
    ],
    sectorsPerTrack(t) {
      if (t <= 17) return 21;
      if (t <= 24) return 19;
      if (t <= 30) return 18;
      return 17;
    },
    // BAM: 4 bytes per track (free count + 3 bitmap bytes), tracks 1-35
    bamTracksRange(numTracks) { return Math.min(numTracks, 35); },
    bamEntryOffset(bamOff, track) { return bamOff + 4 * track; },
    bamEntrySize: 4,
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
    bamTrack: 18,
    bamSector: 0,
    bamTrack2: 53,       // BAM for side 2
    bamSector2: 0,
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
    sizes: [
      { tracks: 70, bytes: 349696, label: '70 Tracks' },
      { tracks: 70, bytes: 351062, label: '70 Tracks + Errors' },
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
    // Side 2 BAM: at T53/S0 — free counts at bytes 0-34, bitmaps at bytes 0xDD-0xFF
    // Side 2 free count for track t (36-70) at byte (t - 36)
    // Side 2 bitmap for track t at byte 0xDD + (t - 36) * 3
    bamTracksRange(numTracks) { return numTracks; },
    readTrackFree(data, bamOff, track) {
      if (track <= 35) {
        return data[bamOff + 4 * track];
      } else {
        // Side 2 BAM at T53/S0
        const bam2Off = this._bam2Off(bamOff);
        return data[bam2Off + (track - 36)];
      }
    },
    writeTrackFree(data, bamOff, track, free) {
      if (track <= 35) {
        data[bamOff + 4 * track] = free;
      } else {
        const bam2Off = this._bam2Off(bamOff);
        data[bam2Off + (track - 36)] = free;
      }
    },
    readTrackBitmap(data, bamOff, track) {
      if (track <= 35) {
        const base = bamOff + 4 * track;
        return data[base + 1] | (data[base + 2] << 8) | (data[base + 3] << 16);
      } else {
        const bam2Off = this._bam2Off(bamOff);
        const base = bam2Off + 0xDD + (track - 36) * 3;
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
        const base = bam2Off + 0xDD + (track - 36) * 3;
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

      // Side 2 BAM at T53/S0
      const bam2Off = this._bam2Off(bamOff);
      for (let t = 36; t <= numTracks; t++) {
        const spt = this.sectorsPerTrack(t);
        // Free count
        if (t === 53) {
          // T53 has BAM sector used
          data[bam2Off + (t - 36)] = spt - 1;
        } else {
          data[bam2Off + (t - 36)] = spt;
        }
        // Bitmap
        const bmBase = bam2Off + 0xDD + (t - 36) * 3;
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
    bamTrack: 40,
    bamSector: 1,       // BAM spans sectors 1 and 2
    bamSector2: 2,
    dosVersion: 0x44,   // 'D'
    dosType: '3D',
    nameOffset: 0x04,   // offset within BAM sector 1 for disk name
    nameLength: 16,
    idOffset: 0x16,     // offset within BAM sector 1 for disk ID
    idLength: 5,
    maxDirSectors: 39,  // sectors 3-39 + more on track 40
    entriesPerSector: 8,
    entrySize: 32,
    doubleSidedFlag: 0x00,
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
      return data[base+1] | (data[base+2]<<8) | (data[base+3]<<16) |
             (data[base+4]<<24) | ((data[base+5] & 0xFF) * 0x100000000);
    },
    writeTrackBitmap(data, bamOff, track, bm) {
      const base = this._bamBase(bamOff, track);
      data[base+1] = bm & 0xFF;
      data[base+2] = (bm >> 8) & 0xFF;
      data[base+3] = (bm >> 16) & 0xFF;
      data[base+4] = (bm >> 24) & 0xFF;
      data[base+5] = Math.floor(bm / 0x100000000) & 0xFF;
    },
    initBAM(data, bamOff, numTracks) {
      // BAM sector 1 (T40/S1)
      data[bamOff + 0x00] = this.dirTrack; // directory track
      data[bamOff + 0x01] = this.bamSector2; // points to BAM sector 2
      data[bamOff + 0x02] = this.dosVersion; // 'D'
      data[bamOff + 0x03] = 0xBB; // double-sided flag for 1581

      // Disk name at offset 0x04: 0xA0 padding
      for (let i = 0; i < 16; i++) data[bamOff + this.nameOffset + i] = 0xA0;
      // Fill bytes
      data[bamOff + 0x14] = 0xA0;
      data[bamOff + 0x15] = 0xA0;
      // Disk ID: 0xA0
      data[bamOff + 0x16] = 0xA0;
      data[bamOff + 0x17] = 0xA0;
      // Fill
      data[bamOff + 0x18] = 0xA0;
      // DOS type
      data[bamOff + 0x19] = this.dosType.charCodeAt(0);
      data[bamOff + 0x1A] = this.dosType.charCodeAt(1);
      // Fill
      data[bamOff + 0x1B] = 0xA0;
      data[bamOff + 0x1C] = 0xA0;

      // BAM sector 2 (T40/S2) — 256 bytes after sector 1
      const bam2Off = bamOff + 256;
      data[bam2Off + 0x00] = 0x00; // no next track
      data[bam2Off + 0x01] = 0xFF;
      data[bam2Off + 0x02] = this.dosVersion;
      data[bam2Off + 0x03] = 0xBB;

      // Init BAM entries for all tracks
      for (let t = 1; t <= numTracks; t++) {
        const spt = this.sectorsPerTrack(t);
        const base = this._bamBase(bamOff, t);
        if (t === this.dirTrack) {
          // Track 40: sectors 1,2,3 used (BAM1, BAM2, first dir sector)
          data[base] = spt - 3;
          // Set all bits free, then clear bits 1,2,3
          // 40 sectors = 5 bytes of bitmap
          for (let b = 0; b < 5; b++) data[base + 1 + b] = 0xFF;
          // Clear sector 1 (BAM1), 2 (BAM2), 3 (first dir sector)
          data[base + 1] &= ~(1 << 1); // sector 1
          data[base + 1] &= ~(1 << 2); // sector 2
          data[base + 1] &= ~(1 << 3); // sector 3
        } else {
          data[base] = spt; // all free
          for (let b = 0; b < 5; b++) data[base + 1 + b] = 0xFF;
        }
      }

      // Directory sector init is handled by createEmptyDisk
    },
  },
};

// ── Active format ────────────────────────────────────────────────────
let currentFormat = DISK_FORMATS.d64;
let currentTracks = 35;

// ── Sector geometry (delegates to current format) ────────────────────
function sectorsPerTrack(t) {
  return currentFormat.sectorsPerTrack(t);
}

function detectFormat(bufferSize) {
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

function sectorOffset(track, sector) {
  const maxTrack = currentTracks || 40;
  if (track < 1 || track > maxTrack) return -1;
  if (sector < 0 || sector >= currentFormat.sectorsPerTrack(track)) return -1;
  const offsets = getTrackOffsets(currentFormat, maxTrack);
  return offsets[track] + sector * 256;
}

function totalSectors(format, numTracks) {
  let s = 0;
  for (let t = 1; t <= numTracks; t++) s += format.sectorsPerTrack(t);
  return s;
}

// ── PETSCII → Unicode ─────────────────────────────────────────────────
// Shared across all CBM disk formats (D64, D71, D81 all use PETSCII)
const PETSCII_MAP = (() => {
  const m = new Array(256).fill('\u00B7');

  m[0x00] = '@';
  for (let i = 0x01; i <= 0x1A; i++) m[i] = String.fromCharCode(i - 0x01 + 65);
  m[0x1B] = '[';
  m[0x1C] = '\u00A3';
  m[0x1D] = ']';
  m[0x1E] = '\u2191';
  m[0x1F] = '\u2190';

  for (let i = 0x20; i <= 0x3F; i++) m[i] = String.fromCharCode(i);

  m[0x40] = '@';
  for (let i = 0x41; i <= 0x5A; i++) m[i] = String.fromCharCode(i + 32);

  m[0x5B] = '[';
  m[0x5C] = '\u00A3';
  m[0x5D] = ']';
  m[0x5E] = '\u2191';
  m[0x5F] = '\u2190';

  const gfx1 = [
    '\u2500','\u2660','\u2502','\u2500','\u2597','\u2596','\u2598','\u259D',
    '\u256E','\u2570','\u256F','\u2572','\u2571','\u25CF','\u2592','\u2665',
    '\u256D','\u2518','\u2524','\u2510','\u250C','\u2534','\u252C','\u251C',
    '\u253C','\u2514','\u2666','\u253C','\u2502','\u2500','\u03C0','\u25E5',
  ];
  for (let i = 0; i < 32; i++) m[0x60 + i] = gfx1[i];

  m[0x80] = ' ';
  for (let i = 0x81; i <= 0x9A; i++) m[i] = String.fromCharCode(i - 0x81 + 65);
  m[0x9B] = '[';
  m[0x9C] = '\u00A3';
  m[0x9D] = ']';
  m[0x9E] = '\u2191';
  m[0x9F] = '\u2190';

  m[0xA0] = ' ';

  const gfx2 = [
    '\u258C','\u2584','\u2594','\u2581','\u258E','\u2592','\u2595',
    '\u259E','\u25E4','\u259A','\u2586','\u258A','\u259B','\u259C',
    '\u2599','\u259F','\u2580','\u2590','\u2588','\u2582','\u258F',
    '\u2583','\u2585','\u2587','\u258B','\u2589','\u258D','\u2663',
    '\u25CF','\u25CB','\u2663',
  ];
  for (let i = 0; i < 31; i++) m[0xA1 + i] = gfx2[i];

  m[0xC0] = '\u2500';
  for (let i = 0xC1; i <= 0xDA; i++) m[i] = String.fromCharCode(i - 0xC1 + 65);
  m[0xDB] = '[';
  m[0xDC] = '\u00A3';
  m[0xDD] = ']';
  m[0xDE] = '\u2191';
  m[0xDF] = '\u2190';

  for (let i = 0xE0; i <= 0xFE; i++) m[i] = m[i - 0x40];
  m[0xFF] = '\u03C0';

  return m;
})();

function petsciiToAscii(byte) {
  return PETSCII_MAP[byte & 0xFF];
}

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
  const rev = new Map();
  for (let i = 255; i >= 0; i--) {
    const ch = PETSCII_MAP[i];
    if (ch && ch !== ' ' && ch !== '\u00B7') rev.set(ch, i);
  }
  for (let i = 0x41; i <= 0x5A; i++) rev.set(String.fromCharCode(i + 32), i);
  for (let i = 0x41; i <= 0x5A; i++) rev.set(String.fromCharCode(i), i);
  for (let i = 0x20; i <= 0x3F; i++) rev.set(String.fromCharCode(i), i);
  rev.set('@', 0x40);
  rev.set('[', 0x5B);
  rev.set(']', 0x5D);
  rev.set('\u00A3', 0x5C);
  rev.set('\u2191', 0x5E);
  rev.set('\u2190', 0x5F);
  rev.set('\u03C0', 0xFF);
  rev.set(' ', 0x20);
  return rev;
})();

function unicodeToPetscii(char) {
  return UNICODE_TO_PETSCII.get(char) ?? 0x20;
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

// ── File type names (shared across all CBM formats) ──────────────────
const FILE_TYPES = ['DEL', 'SEQ', 'PRG', 'USR', 'REL'];

function fileTypeName(typeByte) {
  const closed = (typeByte & 0x80) !== 0;
  const locked = (typeByte & 0x40) !== 0;
  const idx = typeByte & 0x07;
  const base = FILE_TYPES[idx] || '???';
  const prefix = closed ? ' ' : '*';
  const suffix = locked ? '<' : ' ';
  return prefix + base + suffix;
}

// ── Parse disk image ─────────────────────────────────────────────────
function parseDisk(buffer) {
  const data = new Uint8Array(buffer);
  const detected = detectFormat(data.length);
  currentFormat = detected.format;
  currentTracks = detected.tracks;

  const fmt = currentFormat;
  const bamOffset = sectorOffset(fmt.bamTrack, fmt.bamSector);

  const diskName = readPetsciiString(data, bamOffset + fmt.nameOffset, fmt.nameLength);
  const diskId = readPetsciiString(data, bamOffset + fmt.idOffset, fmt.idLength, false);

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

// Backward-compatible alias
function parseD64(buffer) { return parseDisk(buffer); }

// ── Create empty disk image ──────────────────────────────────────────
function createEmptyDisk(formatKey, numTracks) {
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

// Backward-compatible alias
function createEmptyD64(numTracks) { return createEmptyDisk('d64', numTracks); }

// ── Safe PETSCII characters ──────────────────────────────────────────
let allowUnsafeChars = localStorage.getItem('d64-allowUnsafe') === 'true';

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
