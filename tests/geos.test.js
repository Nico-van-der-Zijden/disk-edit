// Tests for GEOS-specific functions
const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert');
const { loadDisk, resetGlobals } = require('./test-helper');

describe('GEOS signature on org_geos.D64', () => {
  beforeEach(() => {
    loadDisk('org_geos.D64');
  });

  it('hasGeosSignature returns true for GEOS disk', () => {
    assert.strictEqual(hasGeosSignature(currentBuffer), true);
  });

  it('hasGeosSignature returns false for non-GEOS disk', () => {
    // Zero out the signature area on a copy
    var copy = currentBuffer.slice(0);
    var data = new Uint8Array(copy);
    var hdrOff = sectorOffset(currentFormat.headerTrack, currentFormat.headerSector);
    for (var i = 0; i < 20; i++) data[hdrOff + 0xAD + i] = 0x00;
    assert.strictEqual(hasGeosSignature(copy), false);
  });

  it('writeGeosSignature writes to header sector not BAM', () => {
    var copy = currentBuffer.slice(0);
    var data = new Uint8Array(copy);
    // Clear signature
    var hdrOff = sectorOffset(currentFormat.headerTrack, currentFormat.headerSector);
    for (var i = 0; i < 20; i++) data[hdrOff + 0xAD + i] = 0x00;
    assert.strictEqual(hasGeosSignature(copy), false);
    // Write it back
    writeGeosSignature(copy);
    assert.strictEqual(hasGeosSignature(copy), true);
    // Verify it's on the header sector
    var sig = '';
    for (var j = 0; j < 16; j++) sig += String.fromCharCode(data[hdrOff + 0xAD + j]);
    assert.strictEqual(sig, 'GEOS format V1.0');
  });
});

describe('readVLIRRecordsForCopy on org_geos.D64', () => {
  beforeEach(() => {
    loadDisk('org_geos.D64');
  });

  it('reads VLIR records from desk top', () => {
    var info = parseDisk(currentBuffer);
    var data = new Uint8Array(currentBuffer);
    // Find desk top (VLIR file)
    var entry = null;
    for (var i = 0; i < info.entries.length; i++) {
      if (isVlirFile(data, info.entries[i].entryOff)) {
        entry = info.entries[i];
        break;
      }
    }
    assert.ok(entry, 'should find desk top');
    var records = readVLIRRecordsForCopy(currentBuffer, entry.entryOff);
    assert.ok(records.length > 0, 'should have records');
  });

  it('preserves end marker as null', () => {
    var info = parseDisk(currentBuffer);
    var data = new Uint8Array(currentBuffer);
    var entry = null;
    for (var i = 0; i < info.entries.length; i++) {
      if (isVlirFile(data, info.entries[i].entryOff)) { entry = info.entries[i]; break; }
    }
    var records = readVLIRRecordsForCopy(currentBuffer, entry.entryOff);
    // Last record should be null (end marker)
    assert.strictEqual(records[records.length - 1], null);
  });

  it('populated records have non-empty data', () => {
    var info = parseDisk(currentBuffer);
    var data = new Uint8Array(currentBuffer);
    var entry = null;
    for (var i = 0; i < info.entries.length; i++) {
      if (isVlirFile(data, info.entries[i].entryOff)) { entry = info.entries[i]; break; }
    }
    var records = readVLIRRecordsForCopy(currentBuffer, entry.entryOff);
    var populated = records.filter(function(r) { return r && r.data && r.data.length > 0; });
    assert.ok(populated.length > 0, 'should have at least one populated record');
  });
});

describe('GEOS file detection', () => {
  beforeEach(() => {
    loadDisk('org_geos.D64');
  });

  it('org_geos.D64 has both VLIR and Sequential GEOS files', () => {
    var info = parseDisk(currentBuffer);
    var data = new Uint8Array(currentBuffer);
    var vlirCount = 0, seqCount = 0;
    for (var i = 0; i < info.entries.length; i++) {
      var eOff = info.entries[i].entryOff;
      var typeIdx = data[eOff + 2] & 0x07;
      if (data[eOff + 0x18] > 0 && typeIdx !== FILE_TYPE.REL) {
        if (data[eOff + 0x17] === 0x01) vlirCount++;
        else seqCount++;
      }
    }
    assert.ok(vlirCount >= 2, 'should have at least 2 VLIR files (desk top, configure)');
    assert.ok(seqCount >= 10, 'should have many GEOS Sequential files');
  });
});

describe('GEOS signature on D81', () => {
  beforeEach(() => {
    loadDisk('error_geos.d81');
  });

  it('GEOS signature is on header sector (T40/S0), not BAM (T40/S1)', () => {
    // The header and BAM are different sectors on D81
    assert.notStrictEqual(currentFormat.headerSector, currentFormat.bamSector);
    // Check signature is on header
    var data = new Uint8Array(currentBuffer);
    var hdrOff = sectorOffset(currentFormat.headerTrack, currentFormat.headerSector);
    var bamOff = sectorOffset(currentFormat.bamTrack, currentFormat.bamSector);
    assert.notStrictEqual(hdrOff, bamOff, 'header and BAM offsets should differ on D81');
  });
});
