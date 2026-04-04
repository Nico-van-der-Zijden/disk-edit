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

// ── BAM byte-level helpers (partition-aware, handles D81 >32 sectors) ─
// Returns the byte offset of the bitmap bytes for a given track.
// For partitions, track is absolute (disk-level) and bamOff is the partition BAM offset.
function getBamBitmapBase(track, bamOff) {
  if (currentPartition) {
    var relTrack = track - currentPartition.startTrack + 1;
    if (relTrack <= 40) return bamOff + 0x10 + (relTrack - 1) * 6 + 1;
    return bamOff + 256 + 0x10 + (relTrack - 41) * 6 + 1;
  }
  var fmt = currentFormat;
  if (fmt === DISK_FORMATS.d81) return fmt._bamBase(bamOff, track) + 1;
  if (fmt === DISK_FORMATS.d71 && track > 35) return fmt._bam2Off(bamOff) + (track - 36) * 3;
  if (fmt === DISK_FORMATS.d80 || fmt === DISK_FORMATS.d82) return fmt._bamEntryBase(bamOff, track) + 1;
  return bamOff + 4 * track + 1;
}

// Clear a sector's bit in the BAM (mark as used) and recalculate the track's free count.
function bamMarkSectorUsed(data, track, sector, bamOff) {
  var base = getBamBitmapBase(track, bamOff);
  data[base + Math.floor(sector / 8)] &= ~(1 << (sector % 8));
  bamRecalcFree(data, track, bamOff);
}

// Recalculate and write the free count for a track by counting bitmap bits.
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
  if (currentPartition) {
    var relTrack = track - currentPartition.startTrack + 1;
    if (relTrack <= 40) data[bamOff + 0x10 + (relTrack - 1) * 6] = free;
    else data[bamOff + 256 + 0x10 + (relTrack - 41) * 6] = free;
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
var charsetMode = localStorage.getItem('d64-charsetMode') === 'lowercase' ? 'lowercase' : 'uppercase';

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
  localStorage.setItem('d64-charsetMode', mode);
  PETSCII_MAP = buildPetsciiMap(mode);
}

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

// Read all data bytes from a file's sector chain (or tape container)
// Returns { data: Uint8Array, error: string|null }
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
      else if (petscii >= 0x20 && petscii <= 0x3F) out += String.fromCharCode(petscii); // space, punct, digits
      else if (petscii === 0x40) out += '@';
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
var GEOS_SIG_OFFSET = 0xAD; // offset within BAM sector

// Check if the GEOS signature is present in the BAM sector
function hasGeosSignature(buffer) {
  if (!buffer) return false;
  var data = new Uint8Array(buffer);
  var bamOff = sectorOffset(currentFormat.bamTrack, currentFormat.bamSector);
  if (bamOff < 0) return false;
  for (var i = 0; i < GEOS_SIGNATURE.length; i++) {
    if (data[bamOff + GEOS_SIG_OFFSET + i] !== GEOS_SIGNATURE.charCodeAt(i)) return false;
  }
  return true;
}

// Write the GEOS signature to the BAM sector
function writeGeosSignature(buffer) {
  var data = new Uint8Array(buffer);
  var bamOff = sectorOffset(currentFormat.bamTrack, currentFormat.bamSector);
  if (bamOff < 0) return;
  for (var i = 0; i < GEOS_SIGNATURE.length; i++) {
    data[bamOff + GEOS_SIG_OFFSET + i] = GEOS_SIGNATURE.charCodeAt(i);
  }
  // Also set the "border" byte at 0xAB to 0x00 (GEOS uses this)
  data[bamOff + 0xAB] = 0x00;
  data[bamOff + 0xAC] = 0x00;
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
  var description = decodeGeosString(data, off + 0xA1, 94);

  return {
    className: className,
    description: description,
    loadAddr: data[off + 0x47] | (data[off + 0x48] << 8),
    endAddr: data[off + 0x49] | (data[off + 0x4A] << 8),
    initAddr: data[off + 0x4B] | (data[off + 0x4C] << 8),
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
function hex8(n) { return n.toString(16).toUpperCase().padStart(2, '0'); }
function hex16(n) { return n.toString(16).toUpperCase().padStart(4, '0'); }

function escHtml(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ── File type names (shared across all CBM formats) ──────────────────
const FILE_TYPES = ['DEL', 'SEQ', 'PRG', 'USR', 'REL', 'CBM'];

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

function parseDisk(buffer) {
  const data = new Uint8Array(buffer);
  const detected = detectFormat(data.length, buffer);
  currentFormat = detected.format;
  currentTracks = detected.tracks;

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
  const numPartTracks = Math.floor(partSize / 40);
  let freeBlocks = 0;
  for (let t = 1; t <= numPartTracks; t++) {
    // Skip the partition's own system track (track 1 = first track of partition)
    if (t === 1) continue;
    var base;
    if (t <= 40) {
      base = partBamOff + 0x10 + (t - 1) * 6;
    } else {
      base = partBamOff + 256 + 0x10 + (t - 41) * 6;
    }
    freeBlocks += data[base];
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

// ── Safe PETSCII characters ──────────────────────────────────────────
var allowUnsafeChars = localStorage.getItem('d64-allowUnsafe') === 'true';

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
