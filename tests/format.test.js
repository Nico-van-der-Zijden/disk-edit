// Tests for disk format operations — needs globals + test disk images
const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert');
const { loadDisk, resetGlobals } = require('./test-helper');

describe('D64 sector geometry', () => {
  beforeEach(() => {
    loadDisk('org_geos.D64');
  });

  it('sectorOffset returns correct offset for track 1 sector 0', () => {
    assert.strictEqual(sectorOffset(1, 0, getCurrentCtx()), 0);
  });

  it('sectorOffset returns correct offset for track 1 sector 1', () => {
    assert.strictEqual(sectorOffset(1, 1, getCurrentCtx()), 256);
  });

  it('sectorOffset returns correct offset for track 18 sector 0 (BAM)', () => {
    // Tracks 1-17: 17 tracks × 21 sectors = 357 sectors × 256 bytes
    assert.strictEqual(sectorOffset(18, 0, getCurrentCtx()), 357 * 256);
  });

  it('sectorOffset returns -1 for out-of-range track', () => {
    assert.strictEqual(sectorOffset(0, 0, getCurrentCtx()), -1);
    assert.strictEqual(sectorOffset(36, 0, getCurrentCtx()), -1);
  });

  it('sectorOffset returns -1 for out-of-range sector', () => {
    assert.strictEqual(sectorOffset(1, 21, getCurrentCtx()), -1); // Track 1 has 21 sectors (0-20)
  });

  it('sectorsPerTrack returns correct values for D64 zones', () => {
    assert.strictEqual(currentFormat.sectorsPerTrack(1), 21);   // Zone 1: tracks 1-17
    assert.strictEqual(currentFormat.sectorsPerTrack(17), 21);
    assert.strictEqual(currentFormat.sectorsPerTrack(18), 19);  // Zone 2: tracks 18-24
    assert.strictEqual(currentFormat.sectorsPerTrack(24), 19);
    assert.strictEqual(currentFormat.sectorsPerTrack(25), 18);  // Zone 3: tracks 25-30
    assert.strictEqual(currentFormat.sectorsPerTrack(30), 18);
    assert.strictEqual(currentFormat.sectorsPerTrack(31), 17);  // Zone 4: tracks 31-35
    assert.strictEqual(currentFormat.sectorsPerTrack(35), 17);
  });
});

// TODO: re-enable "D81 sector geometry" suite once tests/fixtures/error_geos.d81
// is available. Asserted: sectorsPerTrack(1/40/80, getCurrentCtx()) === 40, dirTrack === 40,
// bamTrack/bamSector === 40/1, headerTrack/headerSector === 40/0.

describe('parseDisk on org_geos.D64', () => {
  beforeEach(() => {
    loadDisk('org_geos.D64');
  });

  it('returns correct format', () => {
    var info = parseDisk(currentBuffer);
    assert.strictEqual(currentFormat.name, 'D64');
    assert.strictEqual(currentTracks, 35);
  });

  it('returns non-empty directory', () => {
    var info = parseDisk(currentBuffer);
    assert.ok(info.entries.length > 0);
  });

  it('finds geos v2.0 as first file', () => {
    var info = parseDisk(currentBuffer);
    var first = info.entries[0];
    var readable = petsciiToReadable(first.name).toLowerCase();
    assert.ok(readable.includes('geos'), 'first file should contain "geos", got: ' + readable);
  });

  it('reports free blocks', () => {
    var info = parseDisk(currentBuffer);
    assert.ok(info.freeBlocks >= 0);
    assert.ok(info.freeBlocks <= 683);
  });
});

describe('readFileData', () => {
  beforeEach(() => {
    loadDisk('org_geos.D64');
  });

  it('reads a file without error', () => {
    var info = parseDisk(currentBuffer);
    var entry = info.entries[0]; // geos v2.0 (PRG)
    var result = readFileData(currentBuffer, entry.entryOff, getCurrentCtx());
    assert.strictEqual(result.error, null);
    assert.ok(result.data.length > 0);
  });

  it('returns error for invalid T/S', () => {
    // Create a fake entry with T/S = 0/0
    var data = new Uint8Array(currentBuffer);
    var fakeOff = sectorOffset(18, 1, getCurrentCtx()); // first dir sector, first entry
    var origT = data[fakeOff + 3];
    data[fakeOff + 3] = 0; // set track to 0
    var result = readFileData(currentBuffer, fakeOff, getCurrentCtx());
    assert.ok(result.data.length === 0 || result.error !== null);
    data[fakeOff + 3] = origT; // restore
  });
});

describe('hasErrorBytes', () => {
  it('returns false for standard D64 (174848 bytes)', () => {
    loadDisk('org_geos.D64');
    assert.strictEqual(hasErrorBytes(currentBuffer), false);
  });
});

describe('DISK_FORMATS structure', () => {
  it('all formats have required properties', () => {
    var required = ['name', 'ext', 'dirTrack', 'dirSector', 'bamTrack', 'bamSector',
      'entriesPerSector', 'entrySize', 'sectorsPerTrack', 'bamTracksRange'];
    var formats = Object.keys(DISK_FORMATS);
    for (var fi = 0; fi < formats.length; fi++) {
      var fmt = DISK_FORMATS[formats[fi]];
      for (var ri = 0; ri < required.length; ri++) {
        assert.ok(fmt[required[ri]] !== undefined,
          formats[fi] + ' missing ' + required[ri]);
      }
    }
  });

  it('entrySize is always 32', () => {
    var formats = Object.keys(DISK_FORMATS);
    for (var fi = 0; fi < formats.length; fi++) {
      var fmt = DISK_FORMATS[formats[fi]];
      if (fmt.entrySize) assert.strictEqual(fmt.entrySize, 32, formats[fi]);
    }
  });
});

// ── D64-specific spec features (D64.TXT rev 1.11) ────────────────────

describe('ERROR_CODES spec mapping', () => {
  it('matches D64.TXT rev 1.11 lines 439-569', () => {
    assert.strictEqual(ERROR_CODES[0x01], 'No error');
    assert.strictEqual(ERROR_CODES[0x02], 'Header descriptor byte not found');
    assert.strictEqual(ERROR_CODES[0x03], 'No SYNC sequence found');
    assert.strictEqual(ERROR_CODES[0x04], 'Data descriptor byte not found');
    assert.strictEqual(ERROR_CODES[0x05], 'Checksum error in data block');
    assert.strictEqual(ERROR_CODES[0x06], 'Write verify (on format)');
    assert.strictEqual(ERROR_CODES[0x07], 'Write verify error');
    assert.strictEqual(ERROR_CODES[0x08], 'Write protect on');
    assert.strictEqual(ERROR_CODES[0x09], 'Checksum error in header block');
    assert.strictEqual(ERROR_CODES[0x0A], 'Write error');
    assert.strictEqual(ERROR_CODES[0x0B], 'Disk sector ID mismatch');
    assert.strictEqual(ERROR_CODES[0x0F], 'Drive not ready');
  });
});

describe('isSoftWriteProtected', () => {
  beforeEach(() => { resetGlobals(); });

  function makeD64(bamVersionByte) {
    var buf = createEmptyDisk('d64', 35);
    var data = new Uint8Array(buf);
    var bamOff = 18 * 17 * 256 + 0; // approximate — we'll use sectorOffset instead
    global.currentBuffer = buf;
    global.currentFormat = DISK_FORMATS.d64;
    global.currentTracks = 35;
    global.currentPartition = null;
    if (bamVersionByte !== undefined) {
      var bo = sectorOffset(DISK_FORMATS.d64.bamTrack, DISK_FORMATS.d64.bamSector, getCurrentCtx());
      data[bo + 0x02] = bamVersionByte;
    }
    return buf;
  }

  it('returns null on a fresh D64 (BAM +$02 = $41)', () => {
    var buf = makeD64();
    assert.strictEqual(isSoftWriteProtected(buf, getCurrentCtx()), null);
  });

  it('returns null when BAM +$02 is $00', () => {
    var buf = makeD64(0x00);
    assert.strictEqual(isSoftWriteProtected(buf, getCurrentCtx()), null);
  });

  it('returns the offending byte when BAM +$02 is $50', () => {
    var buf = makeD64(0x50);
    assert.strictEqual(isSoftWriteProtected(buf, getCurrentCtx()), 0x50);
  });

  it('returns null when format is not D64 or D71', () => {
    var buf = createEmptyDisk('d81', 80);
    global.currentBuffer = buf;
    global.currentFormat = DISK_FORMATS.d81;
    global.currentTracks = 80;
    assert.strictEqual(isSoftWriteProtected(buf, getCurrentCtx()), null);
  });

  it('also covers D71 (same soft-WP semantics per spec)', () => {
    var buf = createEmptyDisk('d71', 70);
    global.currentBuffer = buf;
    global.currentFormat = DISK_FORMATS.d71;
    global.currentTracks = 70;
    var data = new Uint8Array(buf);
    var bo = sectorOffset(DISK_FORMATS.d71.bamTrack, DISK_FORMATS.d71.bamSector, getCurrentCtx());
    // Fresh D71: writable
    assert.strictEqual(isSoftWriteProtected(buf, getCurrentCtx()), null);
    // Flip DOS version byte to $50 — should be flagged
    data[bo + 0x02] = 0x50;
    assert.strictEqual(isSoftWriteProtected(buf, getCurrentCtx()), 0x50);
  });

  it('also covers D81 with format-specific expected byte ($44 D)', () => {
    var buf = createEmptyDisk('d81', 80);
    global.currentBuffer = buf;
    global.currentFormat = DISK_FORMATS.d81;
    global.currentTracks = 80;
    var data = new Uint8Array(buf);
    var bo = sectorOffset(DISK_FORMATS.d81.bamTrack, DISK_FORMATS.d81.bamSector, getCurrentCtx());
    // Fresh D81: BAM +$02 = $44, writable
    assert.strictEqual(data[bo + 0x02], 0x44);
    assert.strictEqual(isSoftWriteProtected(buf, getCurrentCtx()), null);
    // $00 is also OK per spec
    data[bo + 0x02] = 0x00;
    assert.strictEqual(isSoftWriteProtected(buf, getCurrentCtx()), null);
    // $41 (the D64 byte) IS soft-WP on D81
    data[bo + 0x02] = 0x41;
    assert.strictEqual(isSoftWriteProtected(buf, getCurrentCtx()), 0x41);
    // Arbitrary other byte
    data[bo + 0x02] = 0x50;
    assert.strictEqual(isSoftWriteProtected(buf, getCurrentCtx()), 0x50);
  });

  it('also covers D80 with expected byte $43 C', () => {
    var buf = createEmptyDisk('d80', 77);
    global.currentBuffer = buf;
    global.currentFormat = DISK_FORMATS.d80;
    global.currentTracks = 77;
    var data = new Uint8Array(buf);
    var bo = sectorOffset(DISK_FORMATS.d80.bamTrack, DISK_FORMATS.d80.bamSector, getCurrentCtx());
    assert.strictEqual(data[bo + 0x02], 0x43);
    assert.strictEqual(isSoftWriteProtected(buf, getCurrentCtx()), null);
    data[bo + 0x02] = 0x00;
    assert.strictEqual(isSoftWriteProtected(buf, getCurrentCtx()), null);
    data[bo + 0x02] = 0x50;
    assert.strictEqual(isSoftWriteProtected(buf, getCurrentCtx()), 0x50);
  });

  it('also covers D82 with expected byte $43 C', () => {
    var buf = createEmptyDisk('d82', 154);
    global.currentBuffer = buf;
    global.currentFormat = DISK_FORMATS.d82;
    global.currentTracks = 154;
    var data = new Uint8Array(buf);
    var bo = sectorOffset(DISK_FORMATS.d82.bamTrack, DISK_FORMATS.d82.bamSector, getCurrentCtx());
    assert.strictEqual(data[bo + 0x02], 0x43);
    assert.strictEqual(isSoftWriteProtected(buf, getCurrentCtx()), null);
    data[bo + 0x02] = 0x42;
    assert.strictEqual(isSoftWriteProtected(buf, getCurrentCtx()), 0x42);
  });
});

describe('hasD81AutoBootLoader', () => {
  beforeEach(() => { resetGlobals(); });

  it('returns false on a fresh D81 (BAM +$07 = 0)', () => {
    var buf = createEmptyDisk('d81', 80);
    global.currentBuffer = buf;
    global.currentFormat = DISK_FORMATS.d81;
    global.currentTracks = 80;
    assert.strictEqual(hasD81AutoBootLoader(buf, getCurrentCtx()), false);
  });

  it('returns true when BAM(40/1)+$07 is non-zero', () => {
    var buf = createEmptyDisk('d81', 80);
    global.currentBuffer = buf;
    global.currentFormat = DISK_FORMATS.d81;
    global.currentTracks = 80;
    var data = new Uint8Array(buf);
    var bo = sectorOffset(40, 1, getCurrentCtx());
    data[bo + 0x07] = 0x01;
    assert.strictEqual(hasD81AutoBootLoader(buf, getCurrentCtx()), true);
  });

  it('returns false on non-D81 formats even if the byte is set', () => {
    var buf = createEmptyDisk('d64', 35);
    global.currentBuffer = buf;
    global.currentFormat = DISK_FORMATS.d64;
    global.currentTracks = 35;
    assert.strictEqual(hasD81AutoBootLoader(buf, getCurrentCtx()), false);
  });
});

describe('Per-format dirInterleave (D81.TXT lines 17-24, D80-D82.TXT line 130)', () => {
  it('D81 uses interleave 1 for directory (spec)', () => {
    assert.strictEqual(DISK_FORMATS.d81.dirInterleave, 1);
  });

  it('CMD native formats use interleave 1 for directory', () => {
    assert.strictEqual(DISK_FORMATS.dnp.dirInterleave, 1);
    assert.strictEqual(DISK_FORMATS.d1m.dirInterleave, 1);
    assert.strictEqual(DISK_FORMATS.d2m.dirInterleave, 1);
    assert.strictEqual(DISK_FORMATS.d4m.dirInterleave, 1);
  });

  it('D80/D82 use interleave 1 (D80-D82.TXT line 130)', () => {
    assert.strictEqual(DISK_FORMATS.d80.dirInterleave, 1);
    assert.strictEqual(DISK_FORMATS.d82.dirInterleave, 1);
  });

  it('D64/D71 default (no dirInterleave override → parseDisk uses 3)', () => {
    assert.ok(DISK_FORMATS.d64.dirInterleave == null);
    assert.ok(DISK_FORMATS.d71.dirInterleave == null);
  });
});

describe('D80/D82 file interleave (D80-D82.TXT line 130)', () => {
  it('D80 defaultInterleave is 1', () => {
    assert.strictEqual(DISK_FORMATS.d80.defaultInterleave, 1);
  });

  it('D82 defaultInterleave is 1', () => {
    assert.strictEqual(DISK_FORMATS.d82.defaultInterleave, 1);
  });
});

describe('D80/D82 error-byte size variants', () => {
  it('D80 sizes table includes 535331 (77 tracks + 2083 error bytes)', () => {
    var found = DISK_FORMATS.d80.sizes.some(function(s) {
      return s.bytes === 535331 && s.label.indexOf('Errors') >= 0;
    });
    assert.ok(found, 'D80 should declare a 535331-byte +Errors variant');
  });

  it('D82 sizes table includes 1070662 (154 tracks + 4166 error bytes)', () => {
    var found = DISK_FORMATS.d82.sizes.some(function(s) {
      return s.bytes === 1070662 && s.label.indexOf('Errors') >= 0;
    });
    assert.ok(found, 'D82 should declare a 1070662-byte +Errors variant');
  });

  it('hasErrorBytes detects D80 error-byte variant', () => {
    // hasErrorBytes scans every format's sizes table for a matching
    // byte length labelled with "Errors" — so a buffer at that size
    // is recognised regardless of which format is currently active.
    var buf = new ArrayBuffer(535331);
    assert.strictEqual(hasErrorBytes(buf), true);
  });

  it('hasErrorBytes detects D82 error-byte variant', () => {
    var buf = new ArrayBuffer(1070662);
    assert.strictEqual(hasErrorBytes(buf), true);
  });
});

describe('getSpeederVariant', () => {
  beforeEach(() => { resetGlobals(); });

  function loadD64(tracks) {
    var buf = createEmptyDisk('d64', tracks);
    global.currentBuffer = buf;
    global.currentFormat = DISK_FORMATS.d64;
    global.currentTracks = tracks;
    global.currentPartition = null;
    return buf;
  }

  function writeFdEntries(buf, offsetIntoBam) {
    var data = new Uint8Array(buf);
    var bamOff = sectorOffset(18, 0, getCurrentCtx());
    // 5 entries × 4 bytes — free-count 17, bitmap $FF $FF $01 (track of 17 sectors all free).
    for (var i = 0; i < 5; i++) {
      data[bamOff + offsetIntoBam + i * 4 + 0] = 17;
      data[bamOff + offsetIntoBam + i * 4 + 1] = 0xFF;
      data[bamOff + offsetIntoBam + i * 4 + 2] = 0xFF;
      data[bamOff + offsetIntoBam + i * 4 + 3] = 0x01;
    }
  }

  it('returns null on stock 35-track D64', () => {
    loadD64(35);
    assert.strictEqual(getSpeederVariant(currentBuffer, getCurrentCtx()), null);
  });

  it('returns null on 40-track D64 with no extended BAM bytes', () => {
    loadD64(40);
    assert.strictEqual(getSpeederVariant(currentBuffer, getCurrentCtx()), null);
  });

  it("returns 'SpeedDOS' when BAM-shaped data is at +$C0..$D3", () => {
    loadD64(40);
    writeFdEntries(currentBuffer, 0xC0);
    assert.strictEqual(getSpeederVariant(currentBuffer, getCurrentCtx()), 'SpeedDOS');
  });

  it("returns 'DolphinDOS' when BAM-shaped data is at +$AC..$BF only", () => {
    loadD64(40);
    writeFdEntries(currentBuffer, 0xAC);
    assert.strictEqual(getSpeederVariant(currentBuffer, getCurrentCtx()), 'DolphinDOS');
  });

  it('rejects ranges where the free-count byte is > 17', () => {
    loadD64(40);
    var data = new Uint8Array(currentBuffer);
    var bamOff = sectorOffset(18, 0, getCurrentCtx());
    // Plant garbage at +$C0 where the first byte (FC = 99) clearly isn't a free-count
    data[bamOff + 0xC0] = 99;
    data[bamOff + 0xC1] = 0xFF;
    assert.strictEqual(getSpeederVariant(currentBuffer, getCurrentCtx()), null);
  });
});

describe('D64 40-track BAM extension', () => {
  beforeEach(() => { resetGlobals(); });

  it('bamTracksRange returns 40 when SpeedDOS variant detected', () => {
    var buf = createEmptyDisk('d64', 40);
    global.currentBuffer = buf;
    global.currentFormat = DISK_FORMATS.d64;
    global.currentTracks = 40;
    var data = new Uint8Array(buf);
    var bamOff = sectorOffset(18, 0, getCurrentCtx());
    // Plant SpeedDOS BAM at +$C0..
    for (var i = 0; i < 5; i++) {
      data[bamOff + 0xC0 + i * 4 + 0] = 17;
      data[bamOff + 0xC0 + i * 4 + 1] = 0xFF;
      data[bamOff + 0xC0 + i * 4 + 2] = 0xFF;
      data[bamOff + 0xC0 + i * 4 + 3] = 0x01;
    }
    assert.strictEqual(currentFormat.bamTracksRange(40), 40);
  });

  it('bamTracksRange returns 35 when no variant detected on 40-track', () => {
    var buf = createEmptyDisk('d64', 40);
    global.currentBuffer = buf;
    global.currentFormat = DISK_FORMATS.d64;
    global.currentTracks = 40;
    assert.strictEqual(currentFormat.bamTracksRange(40), 35);
  });

  it('readTrackFree(36) reads from the SpeedDOS extended BAM offset', () => {
    var buf = createEmptyDisk('d64', 40);
    global.currentBuffer = buf;
    global.currentFormat = DISK_FORMATS.d64;
    global.currentTracks = 40;
    var data = new Uint8Array(buf);
    var bamOff = sectorOffset(18, 0, getCurrentCtx());
    // Plant SpeedDOS BAM with track 36 free-count = 13, marker
    data[bamOff + 0xC0 + 0] = 13; // free count for track 36
    data[bamOff + 0xC0 + 1] = 0xAA;
    data[bamOff + 0xC0 + 2] = 0xBB;
    data[bamOff + 0xC0 + 3] = 0x01;
    // Round out the other 4 entries so getSpeederVariant accepts the set
    for (var i = 1; i < 5; i++) {
      data[bamOff + 0xC0 + i * 4 + 0] = 17;
      data[bamOff + 0xC0 + i * 4 + 1] = 0xFF;
      data[bamOff + 0xC0 + i * 4 + 2] = 0xFF;
      data[bamOff + 0xC0 + i * 4 + 3] = 0x01;
    }
    assert.strictEqual(currentFormat.readTrackFree(data, bamOff, 36), 13);
  });
});

describe('hasC128BootSignature', () => {
  beforeEach(() => { resetGlobals(); });

  it('returns false on a fresh D64', () => {
    var buf = createEmptyDisk('d64', 35);
    global.currentBuffer = buf;
    global.currentFormat = DISK_FORMATS.d64;
    global.currentTracks = 35;
    assert.strictEqual(hasC128BootSignature(buf, getCurrentCtx()), false);
  });

  it("returns true when bytes 'CBM' are at T1/S0 +$00..+$02", () => {
    var buf = createEmptyDisk('d64', 35);
    global.currentBuffer = buf;
    global.currentFormat = DISK_FORMATS.d64;
    global.currentTracks = 35;
    var data = new Uint8Array(buf);
    var off = sectorOffset(1, 0, getCurrentCtx());
    data[off + 0] = 0x43; // C
    data[off + 1] = 0x42; // B
    data[off + 2] = 0x4D; // M
    assert.strictEqual(hasC128BootSignature(buf, getCurrentCtx()), true);
  });

  it('returns false when only some of the magic bytes match', () => {
    var buf = createEmptyDisk('d64', 35);
    global.currentBuffer = buf;
    global.currentFormat = DISK_FORMATS.d64;
    global.currentTracks = 35;
    var data = new Uint8Array(buf);
    var off = sectorOffset(1, 0, getCurrentCtx());
    data[off + 0] = 0x43;
    data[off + 1] = 0x42;
    data[off + 2] = 0x00;
    assert.strictEqual(hasC128BootSignature(buf, getCurrentCtx()), false);
  });
});
