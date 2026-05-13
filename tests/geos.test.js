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

// TODO: re-enable "GEOS signature on D81" suite once
// tests/fixtures/error_geos.d81 is available. Asserted: header and BAM
// live on different sectors (T40/S0 vs T40/S1) so the GEOS signature
// search keys off the header sector, not BAM.

// ── Synthesized GEOS tests (no fixture dependency) ───────────────────
// These exercise the spec-derived behaviour from GEOS.TXT rev 1.4 on
// hand-built buffers, so they run without the gitignored org_geos.D64.

function makeBlankD64() {
  // Minimum: a 35-track D64 (174848 bytes). createEmptyDisk handles
  // header + BAM init; we add specific entries/INFO blocks on top.
  var buf = createEmptyDisk('d64', 35);
  global.currentBuffer = buf;
  global.currentFormat = DISK_FORMATS.d64;
  global.currentTracks = 35;
  global.currentPartition = null;
  return buf;
}

describe('readGeosInfoBlock — magic validation', () => {
  beforeEach(() => { resetGlobals(); });

  it('returns null when the 00/FF link bytes are absent', () => {
    var buf = makeBlankD64();
    var data = new Uint8Array(buf);
    // Pick T17/S0 as the candidate INFO sector — fill with non-magic.
    var off = sectorOffset(17, 0);
    data[off + 0x00] = 0xAB;
    data[off + 0x01] = 0xCD;
    assert.strictEqual(readGeosInfoBlock(buf, 17, 0), null);
  });

  it('returns object when magic 00/FF is present', () => {
    var buf = makeBlankD64();
    var data = new Uint8Array(buf);
    var off = sectorOffset(17, 0);
    data[off + 0x00] = 0x00;
    data[off + 0x01] = 0xFF;
    var ib = readGeosInfoBlock(buf, 17, 0);
    assert.ok(ib, 'should parse INFO block when magic is correct');
  });

  it('returns null for track 0', () => {
    var buf = makeBlankD64();
    assert.strictEqual(readGeosInfoBlock(buf, 0, 0), null);
  });
});

describe('readGeosInfoBlock — author + createdBy', () => {
  beforeEach(() => { resetGlobals(); });

  it('extracts author at +$61 and createdBy at +$75', () => {
    var buf = makeBlankD64();
    var data = new Uint8Array(buf);
    var off = sectorOffset(17, 0);
    data[off + 0x00] = 0x00;
    data[off + 0x01] = 0xFF;
    // Author "Chris Hawley"
    var author = 'Chris Hawley';
    for (var i = 0; i < author.length; i++) data[off + 0x61 + i] = author.charCodeAt(i);
    data[off + 0x61 + author.length] = 0x00; // terminator
    // Created by "geoWrite V2.1"
    var creator = 'geoWrite V2.1';
    for (var j = 0; j < creator.length; j++) data[off + 0x75 + j] = creator.charCodeAt(j);
    data[off + 0x75 + creator.length] = 0x00;
    var ib = readGeosInfoBlock(buf, 17, 0);
    assert.strictEqual(ib.author, 'Chris Hawley');
    assert.strictEqual(ib.createdBy, 'geoWrite V2.1');
  });

  it('returns empty strings when fields are unused (all null)', () => {
    var buf = makeBlankD64();
    var data = new Uint8Array(buf);
    var off = sectorOffset(17, 0);
    data[off + 0x00] = 0x00;
    data[off + 0x01] = 0xFF;
    var ib = readGeosInfoBlock(buf, 17, 0);
    assert.strictEqual(ib.author, '');
    assert.strictEqual(ib.createdBy, '');
  });
});

describe('readGeosInfo — 5-step detection (GEOS.TXT rev 1.4)', () => {
  beforeEach(() => { resetGlobals(); });

  // Helper: write a dir entry into the freshly-made D64 at T18/S1 slot 0.
  function placeEntry(buf, opts) {
    var data = new Uint8Array(buf);
    var dirOff = sectorOffset(18, 1);
    var eOff = dirOff + 0; // slot 0
    data[eOff + 0x02] = opts.typeByte;        // CBM type + flags
    data[eOff + 0x03] = opts.startT || 17;
    data[eOff + 0x04] = opts.startS || 0;
    data[eOff + 0x15] = opts.infoT || 0;
    data[eOff + 0x16] = opts.infoS || 0;
    data[eOff + 0x17] = opts.structure || 0;
    data[eOff + 0x18] = opts.fileType || 0;
    return eOff;
  }

  it('rejects CBM type REL (4) as not GEOS', () => {
    var buf = makeBlankD64();
    var eOff = placeEntry(buf, { typeByte: 0x84, fileType: 6, structure: 1 }); // closed REL
    var geos = readGeosInfo(buf, eOff);
    assert.strictEqual(geos.isGeos, false);
  });

  it('accepts USR (3) as GEOS — real-world geoMag-style App Data files', () => {
    // GEOS.TXT step 1 says 0/1/2 only, but real GEOS publications (e.g.
    // geoMagazine) store VLIR Application Data as USR with valid info
    // blocks. We deviate from the spec to match the existing isVlirFile
    // heuristic. See cbm-format-geos.js comment block for justification.
    var buf = makeBlankD64();
    var eOff = placeEntry(buf, { typeByte: 0x83, fileType: 7, structure: 1, infoT: 17 });
    var geos = readGeosInfo(buf, eOff);
    assert.strictEqual(geos.isGeos, true);
    assert.strictEqual(geos.hasInfoBlock, true);
  });

  it('rejects structure > 1 as not GEOS', () => {
    var buf = makeBlankD64();
    var eOff = placeEntry(buf, { typeByte: 0x82, fileType: 6, structure: 2 }); // PRG, structure=2
    var geos = readGeosInfo(buf, eOff);
    assert.strictEqual(geos.isGeos, false);
  });

  it('accepts VLIR (structure=1) even when filetype is 0', () => {
    var buf = makeBlankD64();
    var eOff = placeEntry(buf, { typeByte: 0x82, fileType: 0, structure: 1, infoT: 17 });
    var geos = readGeosInfo(buf, eOff);
    assert.strictEqual(geos.isGeos, true);
  });

  it('classifies plain C64 (both structure and filetype 0) as not GEOS', () => {
    var buf = makeBlankD64();
    var eOff = placeEntry(buf, { typeByte: 0x82, fileType: 0, structure: 0 });
    var geos = readGeosInfo(buf, eOff);
    assert.strictEqual(geos.isGeos, false);
    assert.strictEqual(geos.hasInfoBlock, false);
  });

  it('flags hasInfoBlock false when info T/S is out of range', () => {
    var buf = makeBlankD64();
    var eOff = placeEntry(buf, { typeByte: 0x82, fileType: 6, structure: 1, infoT: 99 });
    var geos = readGeosInfo(buf, eOff);
    assert.strictEqual(geos.isGeos, true);
    assert.strictEqual(geos.hasInfoBlock, false);
  });

  it('flags hasInfoBlock true when filetype > 0 and info T/S in range', () => {
    var buf = makeBlankD64();
    var eOff = placeEntry(buf, { typeByte: 0x82, fileType: 6, structure: 1, infoT: 17 });
    var geos = readGeosInfo(buf, eOff);
    assert.strictEqual(geos.hasInfoBlock, true);
  });
});

describe('GEOS border sector', () => {
  beforeEach(() => { resetGlobals(); });

  it('readGeosBorderRef returns null when header +$AB is $00', () => {
    var buf = makeBlankD64();
    // Fresh D64: header at T18/S0 starts with $AB/$AC = 0/0 (no border).
    assert.strictEqual(readGeosBorderRef(buf), null);
  });

  it('readGeosBorderRef returns T/S when header +$AB/$AC are set', () => {
    var buf = makeBlankD64();
    var data = new Uint8Array(buf);
    var hdrOff = sectorOffset(currentFormat.headerTrack, currentFormat.headerSector);
    data[hdrOff + 0xAB] = 0x13; // T19
    data[hdrOff + 0xAC] = 0x08; // S8
    var ref = readGeosBorderRef(buf);
    assert.deepStrictEqual(ref, { track: 0x13, sector: 0x08 });
  });

  it('readGeosBorderEntries enumerates populated slots only', () => {
    var buf = makeBlankD64();
    var data = new Uint8Array(buf);
    var hdrOff = sectorOffset(currentFormat.headerTrack, currentFormat.headerSector);
    data[hdrOff + 0xAB] = 19;
    data[hdrOff + 0xAC] = 8;
    // Place 3 entries (slots 0, 2, 5) in the border sector at T19/S8.
    var bOff = sectorOffset(19, 8);
    [0, 2, 5].forEach(function(slot) {
      var eOff = bOff + slot * 32;
      data[eOff + 0x02] = 0x82; // closed PRG
      data[eOff + 0x03] = 1; data[eOff + 0x04] = 0;
      data[eOff + 0x1E] = 1; data[eOff + 0x1F] = 0; // 1 block
    });
    var entries = readGeosBorderEntries(buf);
    assert.strictEqual(entries.length, 3);
    assert.ok(entries.every(function(e) { return e.typeIdx === 2 && e.closed; }));
  });

  it('readGeosBorderEntries returns empty array when no border ref', () => {
    var buf = makeBlankD64();
    assert.deepStrictEqual(readGeosBorderEntries(buf), []);
  });
});
