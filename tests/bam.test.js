// Tests for BAM operations and sector walking
const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert');
const { loadDisk, resetGlobals } = require('./test-helper');

describe('checkBAMIntegrity on org_geos.D64', () => {
  beforeEach(() => {
    loadDisk('org_geos.D64');
  });

  it('returns an object with expected properties', () => {
    var result = checkBAMIntegrity(currentBuffer);
    assert.ok(result.sectorOwner);
    assert.ok(Array.isArray(result.bamErrors));
    assert.strictEqual(typeof result.allocMismatch, 'number');
    assert.strictEqual(typeof result.orphanCount, 'number');
  });

  it('directory sectors are owned', () => {
    var result = checkBAMIntegrity(currentBuffer);
    // D64 directory starts at T18/S1
    assert.ok(result.sectorOwner['18:1']);
  });

  it('has zero allocMismatch on the original disk', () => {
    var result = checkBAMIntegrity(currentBuffer);
    assert.strictEqual(result.allocMismatch, 0);
  });
});

describe('BAM sector operations on D64', () => {
  beforeEach(() => {
    loadDisk('org_geos.D64');
  });

  it('checkSectorFree detects free vs used sectors', () => {
    var data = new Uint8Array(currentBuffer);
    var bamOff = sectorOffset(currentFormat.bamTrack, currentFormat.bamSector);
    // Track 18 sector 0 (BAM) should be used
    assert.strictEqual(checkSectorFree(data, bamOff, 18, 0), false);
  });

  it('bamMarkSectorUsed marks a free sector as used', () => {
    var data = new Uint8Array(currentBuffer);
    var bamOff = sectorOffset(currentFormat.bamTrack, currentFormat.bamSector);
    // Find a free sector on track 1
    var freeSector = -1;
    for (var s = 0; s < 21; s++) {
      if (checkSectorFree(data, bamOff, 1, s)) { freeSector = s; break; }
    }
    if (freeSector >= 0) {
      bamMarkSectorUsed(data, 1, freeSector, bamOff);
      assert.strictEqual(checkSectorFree(data, bamOff, 1, freeSector), false);
    }
  });

  it('bamMarkSectorFree marks a used sector as free', () => {
    var data = new Uint8Array(currentBuffer);
    var bamOff = sectorOffset(currentFormat.bamTrack, currentFormat.bamSector);
    // Track 18 sector 1 is used (directory)
    bamMarkSectorFree(data, 18, 1, bamOff);
    assert.strictEqual(checkSectorFree(data, bamOff, 18, 1), true);
  });

  it('bamRecalcFree updates the free count correctly', () => {
    var data = new Uint8Array(currentBuffer);
    var bamOff = sectorOffset(currentFormat.bamTrack, currentFormat.bamSector);
    // Find a track with free sectors
    var testTrack = -1;
    for (var t = 19; t <= 35; t++) {
      if (currentFormat.readTrackFree(data, bamOff, t) > 0) { testTrack = t; break; }
    }
    assert.ok(testTrack > 0, 'should find a track with free sectors');
    var freeBefore = currentFormat.readTrackFree(data, bamOff, testTrack);
    var spt = currentFormat.sectorsPerTrack(testTrack);
    for (var s = 0; s < spt; s++) {
      if (checkSectorFree(data, bamOff, testTrack, s)) {
        bamMarkSectorUsed(data, testTrack, s, bamOff);
        break;
      }
    }
    var freeAfter = currentFormat.readTrackFree(data, bamOff, testTrack);
    assert.strictEqual(freeAfter, freeBefore - 1);
  });
});

describe('forEachFileSector', () => {
  beforeEach(() => {
    loadDisk('org_geos.D64');
  });

  it('counts sectors matching directory block count for a normal file', () => {
    var info = parseDisk(currentBuffer);
    var data = new Uint8Array(currentBuffer);
    // Find the first non-GEOS PRG file (geos v2.0 engl.)
    var entry = info.entries[0];
    var blocks = data[entry.entryOff + 30] | (data[entry.entryOff + 31] << 8);
    var count = forEachFileSector(data, entry.entryOff, function() {});
    assert.strictEqual(count, blocks);
  });

  it('counts sectors matching directory block count for a GEOS VLIR file', () => {
    var info = parseDisk(currentBuffer);
    var data = new Uint8Array(currentBuffer);
    // Find "desk top" (VLIR file)
    var entry = null;
    for (var i = 0; i < info.entries.length; i++) {
      if (isVlirFile(data, info.entries[i].entryOff)) {
        entry = info.entries[i];
        break;
      }
    }
    assert.ok(entry, 'should find a VLIR file');
    var blocks = data[entry.entryOff + 30] | (data[entry.entryOff + 31] << 8);
    var count = forEachFileSector(data, entry.entryOff, function() {});
    assert.strictEqual(count, blocks);
  });

  it('counts sectors for GEOS Sequential = data chain + 1 info block', () => {
    var info = parseDisk(currentBuffer);
    var data = new Uint8Array(currentBuffer);
    // Find a GEOS Sequential file (not VLIR, geos type > 0)
    var entry = null;
    for (var i = 0; i < info.entries.length; i++) {
      var eOff = info.entries[i].entryOff;
      var typeIdx = data[eOff + 2] & 0x07;
      if (data[eOff + 0x18] > 0 && typeIdx !== FILE_TYPE.REL && data[eOff + 0x17] !== 0x01) {
        entry = info.entries[i];
        break;
      }
    }
    assert.ok(entry, 'should find a GEOS Sequential file');
    var blocks = data[entry.entryOff + 30] | (data[entry.entryOff + 31] << 8);
    var count = forEachFileSector(data, entry.entryOff, function() {});
    assert.strictEqual(count, blocks);
  });

  it('invokes callback for every sector', () => {
    var info = parseDisk(currentBuffer);
    var data = new Uint8Array(currentBuffer);
    var entry = info.entries[0];
    var sectors = [];
    forEachFileSector(data, entry.entryOff, function(t, s) {
      sectors.push(t + ':' + s);
    });
    assert.ok(sectors.length > 0);
    // No duplicates
    var unique = new Set(sectors);
    assert.strictEqual(unique.size, sectors.length, 'no duplicate sectors');
  });
});

describe('isVlirFile', () => {
  beforeEach(() => {
    loadDisk('org_geos.D64');
  });

  it('returns true for VLIR files', () => {
    var info = parseDisk(currentBuffer);
    var data = new Uint8Array(currentBuffer);
    // "desk top" is a VLIR file (entry index 1)
    var found = false;
    for (var i = 0; i < info.entries.length; i++) {
      if (isVlirFile(data, info.entries[i].entryOff)) { found = true; break; }
    }
    assert.ok(found, 'should find at least one VLIR file');
  });

  it('returns false for non-GEOS files', () => {
    var info = parseDisk(currentBuffer);
    var data = new Uint8Array(currentBuffer);
    // First entry is a normal PRG
    assert.strictEqual(isVlirFile(data, info.entries[0].entryOff), false);
  });
});

describe('buildTrueAllocationMap', () => {
  beforeEach(() => {
    loadDisk('org_geos.D64');
  });

  it('returns an object with sector keys', () => {
    var map = buildTrueAllocationMap(currentBuffer);
    assert.ok(map['18:0'], 'BAM sector should be allocated');
    assert.ok(map['18:1'], 'first directory sector should be allocated');
  });

  it('all file sectors are in the map', () => {
    var map = buildTrueAllocationMap(currentBuffer);
    var info = parseDisk(currentBuffer);
    var data = new Uint8Array(currentBuffer);
    for (var i = 0; i < info.entries.length; i++) {
      if (info.entries[i].deleted) continue;
      forEachFileSector(data, info.entries[i].entryOff, function(t, s) {
        assert.ok(map[t + ':' + s], 'sector ' + t + ':' + s + ' should be in allocation map');
      });
    }
  });
});
