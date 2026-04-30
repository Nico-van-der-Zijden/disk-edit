// Tests for disk format operations — needs globals + test disk images
const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert');
const { loadDisk, resetGlobals } = require('./test-helper');

describe('D64 sector geometry', () => {
  beforeEach(() => {
    loadDisk('org_geos.D64');
  });

  it('sectorOffset returns correct offset for track 1 sector 0', () => {
    assert.strictEqual(sectorOffset(1, 0), 0);
  });

  it('sectorOffset returns correct offset for track 1 sector 1', () => {
    assert.strictEqual(sectorOffset(1, 1), 256);
  });

  it('sectorOffset returns correct offset for track 18 sector 0 (BAM)', () => {
    // Tracks 1-17: 17 tracks × 21 sectors = 357 sectors × 256 bytes
    assert.strictEqual(sectorOffset(18, 0), 357 * 256);
  });

  it('sectorOffset returns -1 for out-of-range track', () => {
    assert.strictEqual(sectorOffset(0, 0), -1);
    assert.strictEqual(sectorOffset(36, 0), -1);
  });

  it('sectorOffset returns -1 for out-of-range sector', () => {
    assert.strictEqual(sectorOffset(1, 21), -1); // Track 1 has 21 sectors (0-20)
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
// is available. Asserted: sectorsPerTrack(1/40/80) === 40, dirTrack === 40,
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
    var result = readFileData(currentBuffer, entry.entryOff);
    assert.strictEqual(result.error, null);
    assert.ok(result.data.length > 0);
  });

  it('returns error for invalid T/S', () => {
    // Create a fake entry with T/S = 0/0
    var data = new Uint8Array(currentBuffer);
    var fakeOff = sectorOffset(18, 1); // first dir sector, first entry
    var origT = data[fakeOff + 3];
    data[fakeOff + 3] = 0; // set track to 0
    var result = readFileData(currentBuffer, fakeOff);
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
