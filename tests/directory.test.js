// Tests for directory editing operations on org_geos.D64.
// Covers the pure functions in ui-directory.js: slot enumeration, entry
// swap/move/remove, filename alignment, block-count writes, sort,
// address calculation, and block walking.
const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert');
const { loadDisk, resetGlobals } = require('./test-helper');

// PETSCII helpers for writing test names by hand
function p(str) {
  var out = [];
  for (var i = 0; i < str.length; i++) out.push(str.charCodeAt(i));
  return out;
}

describe('getDirSlotOffsets', () => {
  beforeEach(() => loadDisk('org_geos.D64'));

  it('returns slot offsets stepping by 32 within each sector', () => {
    var offs = getDirSlotOffsets(currentBuffer);
    assert.ok(offs.length > 0);
    // First slot is on the dir track at offset 32 (sector 1 entry 0 — entry 0
    // of dir sector occupies bytes 0-31; entries 0..7 are at +0,+32..+224).
    // The exact track varies, but consecutive entries within one sector
    // must differ by 32 bytes.
    for (var i = 0; i < 7; i++) {
      assert.strictEqual(offs[i + 1] - offs[i], 32, 'consecutive slots in sector should be 32 apart');
    }
  });

  it('total slot count is a multiple of 8 (entries per dir sector)', () => {
    var offs = getDirSlotOffsets(currentBuffer);
    assert.strictEqual(offs.length % 8, 0);
  });

  it('all slots are unique', () => {
    var offs = getDirSlotOffsets(currentBuffer);
    var seen = new Set(offs);
    assert.strictEqual(seen.size, offs.length);
  });
});

describe('swapDirEntries', () => {
  beforeEach(() => loadDisk('org_geos.D64'));

  it('swaps bytes 2-31 between two entries', () => {
    var data = new Uint8Array(currentBuffer);
    var offs = getDirSlotOffsets(currentBuffer);
    var a = offs[0], b = offs[1];
    var beforeA = data.slice(a, a + 32);
    var beforeB = data.slice(b, b + 32);

    swapDirEntries(currentBuffer, a, b);

    var afterA = data.slice(a, a + 32);
    var afterB = data.slice(b, b + 32);
    // Bytes 0-1 unchanged
    assert.strictEqual(afterA[0], beforeA[0]);
    assert.strictEqual(afterA[1], beforeA[1]);
    assert.strictEqual(afterB[0], beforeB[0]);
    assert.strictEqual(afterB[1], beforeB[1]);
    // Bytes 2-31 swapped
    for (var j = 2; j < 32; j++) {
      assert.strictEqual(afterA[j], beforeB[j]);
      assert.strictEqual(afterB[j], beforeA[j]);
    }
  });

  it('is a no-op when both offsets are the same', () => {
    var data = new Uint8Array(currentBuffer);
    var offs = getDirSlotOffsets(currentBuffer);
    var before = data.slice(offs[0], offs[0] + 32);
    swapDirEntries(currentBuffer, offs[0], offs[0]);
    var after = data.slice(offs[0], offs[0] + 32);
    for (var j = 0; j < 32; j++) assert.strictEqual(after[j], before[j]);
  });
});

describe('writeBlockSize', () => {
  beforeEach(() => loadDisk('org_geos.D64'));

  it('writes block count as little-endian 16-bit at +30/+31', () => {
    var data = new Uint8Array(currentBuffer);
    var offs = getDirSlotOffsets(currentBuffer);
    writeBlockSize(currentBuffer, offs[0], 0x1234);
    assert.strictEqual(data[offs[0] + 30], 0x34);
    assert.strictEqual(data[offs[0] + 31], 0x12);
  });

  it('truncates values >0xFFFF to low 16 bits', () => {
    var data = new Uint8Array(currentBuffer);
    var offs = getDirSlotOffsets(currentBuffer);
    writeBlockSize(currentBuffer, offs[0], 0x10001);
    assert.strictEqual(data[offs[0] + 30], 0x01);
    assert.strictEqual(data[offs[0] + 31], 0x00);
  });
});

describe('getFilenameContent / writeFilenameAligned', () => {
  beforeEach(() => loadDisk('org_geos.D64'));

  it('reads bytes up to first 0xA0 padding', () => {
    var data = new Uint8Array(currentBuffer);
    var offs = getDirSlotOffsets(currentBuffer);
    // Write a known name: "AB" then padding
    data[offs[0] + 5] = 0x41; // A
    data[offs[0] + 6] = 0x42; // B
    for (var i = 7; i < 21; i++) data[offs[0] + i] = 0xA0;
    var content = getFilenameContent(data, offs[0]);
    assert.deepStrictEqual(content, [0x41, 0x42]);
  });

  it('returns full 16 bytes when no 0xA0 found', () => {
    var data = new Uint8Array(currentBuffer);
    var offs = getDirSlotOffsets(currentBuffer);
    for (var i = 0; i < 16; i++) data[offs[0] + 5 + i] = 0x41 + i; // A..P
    var content = getFilenameContent(data, offs[0]);
    assert.strictEqual(content.length, 16);
  });

  it('writeFilenameAligned pads short content with 0xA0 to 16 bytes', () => {
    var data = new Uint8Array(currentBuffer);
    var offs = getDirSlotOffsets(currentBuffer);
    writeFilenameAligned(data, offs[0], [0x41, 0x42, 0x43]);
    assert.strictEqual(data[offs[0] + 5], 0x41);
    assert.strictEqual(data[offs[0] + 6], 0x42);
    assert.strictEqual(data[offs[0] + 7], 0x43);
    for (var i = 8; i < 21; i++) assert.strictEqual(data[offs[0] + i], 0xA0);
  });
});

describe('alignFilename', () => {
  var entryOff;
  beforeEach(() => {
    loadDisk('org_geos.D64');
    var offs = getDirSlotOffsets(currentBuffer);
    entryOff = offs[0];
  });

  function setName(bytes) {
    var data = new Uint8Array(currentBuffer);
    writeFilenameAligned(data, entryOff, bytes);
  }
  function readName() {
    var data = new Uint8Array(currentBuffer);
    var out = [];
    for (var i = 0; i < 16; i++) out.push(data[entryOff + 5 + i]);
    return out;
  }

  it('left: content first, padding spaces after', () => {
    setName(p('HI'));
    alignFilename(currentBuffer, entryOff, 'left');
    var n = readName();
    assert.strictEqual(n[0], 0x48); // H
    assert.strictEqual(n[1], 0x49); // I
    assert.strictEqual(n[2], 0x20); // space
    assert.strictEqual(n[15], 0x20);
  });

  it('right: spaces first, content at end', () => {
    setName(p('HI'));
    alignFilename(currentBuffer, entryOff, 'right');
    var n = readName();
    assert.strictEqual(n[14], 0x48);
    assert.strictEqual(n[15], 0x49);
    assert.strictEqual(n[0], 0x20);
    assert.strictEqual(n[13], 0x20);
  });

  it('center: equal padding both sides (favoring left for odd remainder)', () => {
    setName(p('HI'));
    alignFilename(currentBuffer, entryOff, 'center');
    var n = readName();
    // 16 - 2 = 14 padding, leftPad = floor(14/2) = 7
    assert.strictEqual(n[7], 0x48);
    assert.strictEqual(n[8], 0x49);
    assert.strictEqual(n[6], 0x20);
    assert.strictEqual(n[9], 0x20);
  });

  it('justify with 2 words distributes spaces between them', () => {
    setName(p('A B'));
    alignFilename(currentBuffer, entryOff, 'justify');
    var n = readName();
    // Words: "A" (1 char) + "B" (1 char) = 2 chars, 14 spaces between
    assert.strictEqual(n[0], 0x41); // A
    assert.strictEqual(n[15], 0x42); // B
    for (var i = 1; i < 15; i++) assert.strictEqual(n[i], 0x20);
  });

  it('expand pads short content with 0x20 spaces (no 0xA0)', () => {
    setName(p('HI'));
    alignFilename(currentBuffer, entryOff, 'expand');
    var n = readName();
    assert.strictEqual(n[0], 0x48);
    assert.strictEqual(n[1], 0x49);
    for (var i = 2; i < 16; i++) assert.strictEqual(n[i], 0x20);
  });

  it('strips trailing 0x20 and leading 0x20 before alignment', () => {
    var data = new Uint8Array(currentBuffer);
    // Manual write: " HI " (leading + trailing space)
    data[entryOff + 5] = 0x20;
    data[entryOff + 6] = 0x48;
    data[entryOff + 7] = 0x49;
    data[entryOff + 8] = 0x20;
    for (var i = 9; i < 21; i++) data[entryOff + i] = 0xA0;
    alignFilename(currentBuffer, entryOff, 'left');
    var n = readName();
    // After strip, content = "HI"
    assert.strictEqual(n[0], 0x48);
    assert.strictEqual(n[1], 0x49);
    assert.strictEqual(n[2], 0x20);
  });

  it('does nothing when content is already 16 bytes', () => {
    var data = new Uint8Array(currentBuffer);
    for (var i = 0; i < 16; i++) data[entryOff + 5 + i] = 0x41 + i;
    var before = readName();
    alignFilename(currentBuffer, entryOff, 'left');
    var after = readName();
    assert.deepStrictEqual(after, before);
  });
});

describe('removeFileEntry', () => {
  beforeEach(() => loadDisk('org_geos.D64'));

  it('shifts subsequent entries up and zeros the last slot', () => {
    var data = new Uint8Array(currentBuffer);
    var offs = getDirSlotOffsets(currentBuffer);
    // Capture entry-1 type byte before remove (becomes entry-0 after)
    var entry1TypeBefore = data[offs[1] + 2];
    var lastOff = offs[offs.length - 1];

    removeFileEntry(currentBuffer, offs[0]);

    // Entry that was at offs[1] should now be at offs[0]
    assert.strictEqual(data[offs[0] + 2], entry1TypeBefore);
    // Last slot's bytes 2-31 are zeroed
    for (var j = 2; j < 32; j++) {
      assert.strictEqual(data[lastOff + j], 0x00, 'last slot byte ' + j + ' should be 0');
    }
  });

  it('decreases countDirEntries by 1 when removing a real entry', () => {
    var offs = getDirSlotOffsets(currentBuffer);
    // Find first non-empty slot
    var data = new Uint8Array(currentBuffer);
    var firstReal = -1;
    for (var i = 0; i < offs.length; i++) {
      if (data[offs[i] + 2] !== 0x00) { firstReal = i; break; }
    }
    assert.ok(firstReal >= 0, 'expected at least one real entry');
    var before = countDirEntries();
    removeFileEntry(currentBuffer, offs[firstReal]);
    assert.strictEqual(countDirEntries(), before - 1);
  });
});

describe('sortDirectory', () => {
  beforeEach(() => loadDisk('org_geos.D64'));

  it('name-asc places non-empty entries before empty slots in ascending order', () => {
    sortDirectory(currentBuffer, 'name-asc');
    var data = new Uint8Array(currentBuffer);
    var offs = getDirSlotOffsets(currentBuffer);
    // Walk slots: collect names from non-empty entries until first empty
    var names = [];
    var sawEmpty = false;
    for (var i = 0; i < offs.length; i++) {
      var typeByte = data[offs[i] + 2];
      var isEmpty = true;
      for (var j = 2; j < 32; j++) {
        if (data[offs[i] + j] !== 0x00) { isEmpty = false; break; }
      }
      if (isEmpty) { sawEmpty = true; continue; }
      // Empty slots must not appear before non-empty after sort
      assert.strictEqual(sawEmpty, false, 'non-empty entry after empty slot at slot ' + i);
      names.push(readPetsciiString(data, offs[i] + 5, 16));
    }
    // Ascending order
    for (var k = 1; k < names.length; k++) {
      assert.ok(names[k - 1] <= names[k], 'name order broken: "' + names[k - 1] + '" > "' + names[k] + '"');
    }
  });

  it('name-desc reverses the order', () => {
    sortDirectory(currentBuffer, 'name-desc');
    var data = new Uint8Array(currentBuffer);
    var offs = getDirSlotOffsets(currentBuffer);
    var names = [];
    for (var i = 0; i < offs.length; i++) {
      var isEmpty = true;
      for (var j = 2; j < 32; j++) {
        if (data[offs[i] + j] !== 0x00) { isEmpty = false; break; }
      }
      if (isEmpty) continue;
      names.push(readPetsciiString(data, offs[i] + 5, 16));
    }
    for (var k = 1; k < names.length; k++) {
      assert.ok(names[k - 1] >= names[k], 'desc order broken');
    }
  });

  it('blocks-asc orders by block count', () => {
    sortDirectory(currentBuffer, 'blocks-asc');
    var data = new Uint8Array(currentBuffer);
    var offs = getDirSlotOffsets(currentBuffer);
    var blocks = [];
    for (var i = 0; i < offs.length; i++) {
      var isEmpty = true;
      for (var j = 2; j < 32; j++) {
        if (data[offs[i] + j] !== 0x00) { isEmpty = false; break; }
      }
      if (isEmpty) continue;
      blocks.push(data[offs[i] + 30] | (data[offs[i] + 31] << 8));
    }
    for (var k = 1; k < blocks.length; k++) {
      assert.ok(blocks[k - 1] <= blocks[k], 'blocks order broken');
    }
  });

  it('preserves the total entry count', () => {
    var before = countDirEntries();
    sortDirectory(currentBuffer, 'name-asc');
    assert.strictEqual(countDirEntries(), before);
  });
});

describe('getFileAddresses', () => {
  beforeEach(() => loadDisk('org_geos.D64'));

  it('returns null for VLIR (GEOS) files', () => {
    var data = new Uint8Array(currentBuffer);
    var offs = getDirSlotOffsets(currentBuffer);
    // Find a VLIR file
    var vlirOff = -1;
    for (var i = 0; i < offs.length; i++) {
      if (data[offs[i] + 2] !== 0x00 && isVlirFile(data, offs[i])) {
        vlirOff = offs[i]; break;
      }
    }
    if (vlirOff >= 0) {
      assert.strictEqual(getFileAddresses(currentBuffer, vlirOff), null);
    }
  });

  it('returns null when first sector pointer is track 0', () => {
    var data = new Uint8Array(currentBuffer);
    var offs = getDirSlotOffsets(currentBuffer);
    // Synthesize: zero out track byte
    var fakeOff = offs[0];
    var savedT = data[fakeOff + 3];
    data[fakeOff + 3] = 0;
    assert.strictEqual(getFileAddresses(currentBuffer, fakeOff), null);
    data[fakeOff + 3] = savedT; // restore
  });
});

describe('countActualBlocks', () => {
  beforeEach(() => loadDisk('org_geos.D64'));

  it('returns 0 for entries with no data chain (track byte = 0)', () => {
    var data = new Uint8Array(currentBuffer);
    var offs = getDirSlotOffsets(currentBuffer);
    var fakeOff = offs[0];
    var savedT = data[fakeOff + 3];
    data[fakeOff + 3] = 0;
    assert.strictEqual(countActualBlocks(currentBuffer, fakeOff), 0);
    data[fakeOff + 3] = savedT;
  });

  it('returns positive count for files with valid data', () => {
    var data = new Uint8Array(currentBuffer);
    var offs = getDirSlotOffsets(currentBuffer);
    var realOff = -1;
    for (var i = 0; i < offs.length; i++) {
      if (data[offs[i] + 2] !== 0x00 && data[offs[i] + 3] !== 0) {
        realOff = offs[i]; break;
      }
    }
    assert.ok(realOff >= 0);
    var blocks = countActualBlocks(currentBuffer, realOff);
    assert.ok(blocks > 0, 'expected blocks > 0, got ' + blocks);
  });
});

describe('countDirEntries', () => {
  beforeEach(() => loadDisk('org_geos.D64'));

  it('matches the number of non-empty slots', () => {
    var data = new Uint8Array(currentBuffer);
    var offs = getDirSlotOffsets(currentBuffer);
    var manual = 0;
    for (var i = 0; i < offs.length; i++) {
      var typeByte = data[offs[i] + 2];
      if (typeByte !== 0x00) { manual++; continue; }
      // typeByte=0 but other bytes present → still counts (deleted/scratched)
      for (var j = 3; j < 32; j++) {
        if (data[offs[i] + j] !== 0x00) { manual++; break; }
      }
    }
    assert.strictEqual(countDirEntries(), manual);
  });
});

describe('canInsertFile / getMaxDirEntries', () => {
  beforeEach(() => loadDisk('org_geos.D64'));

  it('getMaxDirEntries is positive for D64 (144 = 18 sectors × 8)', () => {
    var max = getMaxDirEntries();
    assert.strictEqual(max, 18 * 8);
  });

  it('canInsertFile returns true when entries < max', () => {
    var count = countDirEntries();
    var max = getMaxDirEntries();
    assert.strictEqual(canInsertFile(), count < max);
  });
});

describe('changeFileType', () => {
  beforeEach(() => {
    loadDisk('org_geos.D64');
    global.renderDisk = function() {}; // stub — lives in ui-render.js, not loaded in tests
  });

  it('replaces the type bits (0-2) and preserves closed/locked bits (7,6)', () => {
    var data = new Uint8Array(currentBuffer);
    var offs = getDirSlotOffsets(currentBuffer);
    var realOff = -1;
    for (var i = 0; i < offs.length; i++) {
      if (data[offs[i] + 2] !== 0x00) { realOff = offs[i]; break; }
    }
    assert.ok(realOff >= 0);
    // Force-set: closed + locked + DEL (type 0)
    data[realOff + 2] = 0xC0;
    changeFileType(realOff, 0x02); // change to PRG
    assert.strictEqual(data[realOff + 2], 0xC2, 'expected closed+locked+PRG = 0xC2');
  });

  it('masks the type index to low 3 bits', () => {
    var data = new Uint8Array(currentBuffer);
    var offs = getDirSlotOffsets(currentBuffer);
    var off = offs[0];
    data[off + 2] = 0x80; // closed, DEL
    changeFileType(off, 0xFF); // bits above 2 should be ignored
    assert.strictEqual(data[off + 2] & 0x07, 0x07);
    assert.strictEqual(data[off + 2] & 0x80, 0x80);
  });
});

describe('clampInt', () => {
  it('clamps below min to min', () => {
    assert.strictEqual(clampInt('-5', 0, 100), 0);
    assert.strictEqual(clampInt('0', 5, 100), 5);
  });
  it('clamps above max to max', () => {
    assert.strictEqual(clampInt('500', 0, 100), 100);
  });
  it('treats NaN as min', () => {
    assert.strictEqual(clampInt('abc', 0, 100), 0);
    assert.strictEqual(clampInt('', 5, 100), 5);
  });
  it('returns parsed value when in range', () => {
    assert.strictEqual(clampInt('42', 0, 100), 42);
  });
  it('parses leading integer from mixed strings (parseInt behavior)', () => {
    assert.strictEqual(clampInt('42abc', 0, 100), 42);
  });
  it('handles values exactly at min/max boundaries', () => {
    assert.strictEqual(clampInt('0', 0, 100), 0);
    assert.strictEqual(clampInt('100', 0, 100), 100);
  });
});

describe('isTrackSectorInRange', () => {
  beforeEach(() => loadDisk('org_geos.D64'));

  it('rejects track 0', () => {
    assert.strictEqual(isTrackSectorInRange(0, 0, 35), false);
  });
  it('rejects track > totalTracks', () => {
    assert.strictEqual(isTrackSectorInRange(36, 0, 35), false);
  });
  it('accepts track 1 sector 0', () => {
    assert.strictEqual(isTrackSectorInRange(1, 0, 35), true);
  });
  it('rejects negative sector', () => {
    assert.strictEqual(isTrackSectorInRange(1, -1, 35), false);
  });
  it('rejects sector >= sectors-per-track', () => {
    // Track 1 has 21 sectors (0-20)
    assert.strictEqual(isTrackSectorInRange(1, 21, 35), false);
    assert.strictEqual(isTrackSectorInRange(1, 20, 35), true);
  });
  it('respects per-track sector counts (zone changes)', () => {
    // Track 18 has 19 sectors (0-18) on a D64
    assert.strictEqual(isTrackSectorInRange(18, 18, 35), true);
    assert.strictEqual(isTrackSectorInRange(18, 19, 35), false);
    // Track 31 has 17 sectors
    assert.strictEqual(isTrackSectorInRange(31, 16, 35), true);
    assert.strictEqual(isTrackSectorInRange(31, 17, 35), false);
  });
});

describe('filenameBytesDiffer', () => {
  beforeEach(() => loadDisk('org_geos.D64'));

  it('returns false when newBytes match the existing 16 filename bytes', () => {
    var data = new Uint8Array(currentBuffer);
    var offs = getDirSlotOffsets(currentBuffer);
    var off = offs[0];
    var same = new Uint8Array(16);
    for (var i = 0; i < 16; i++) same[i] = data[off + 5 + i];
    assert.strictEqual(filenameBytesDiffer(currentBuffer, off, same), false);
  });

  it('returns true when any single byte differs', () => {
    var data = new Uint8Array(currentBuffer);
    var offs = getDirSlotOffsets(currentBuffer);
    var off = offs[0];
    var changed = new Uint8Array(16);
    for (var i = 0; i < 16; i++) changed[i] = data[off + 5 + i];
    changed[7] = (changed[7] + 1) & 0xFF;
    assert.strictEqual(filenameBytesDiffer(currentBuffer, off, changed), true);
  });

  it('returns true when all 16 bytes differ', () => {
    var offs = getDirSlotOffsets(currentBuffer);
    var off = offs[0];
    var allDifferent = new Uint8Array(16).fill(0xFF);
    var data = new Uint8Array(currentBuffer);
    // Make sure existing bytes aren't all 0xFF (ensure there's a real diff)
    var anyNon0xFF = false;
    for (var i = 0; i < 16; i++) {
      if (data[off + 5 + i] !== 0xFF) { anyNon0xFF = true; break; }
    }
    if (anyNon0xFF) {
      assert.strictEqual(filenameBytesDiffer(currentBuffer, off, allDifferent), true);
    }
  });
});

describe('insertFileEntry', () => {
  beforeEach(() => loadDisk('org_geos.D64'));

  it('returns a valid offset and writes a PRG-typed empty entry', () => {
    var data = new Uint8Array(currentBuffer);
    var off = insertFileEntry();
    assert.ok(off > 0);
    // writeNewEntry stamps PRG closed (0x82), null start T/S, name padded with 0xA0, blocks 0
    assert.strictEqual(data[off + 2], 0x82);
    assert.strictEqual(data[off + 3], 0);
    assert.strictEqual(data[off + 4], 0);
    for (var i = 0; i < 16; i++) {
      assert.strictEqual(data[off + 5 + i], 0xA0, 'name byte ' + i + ' should be 0xA0');
    }
    assert.strictEqual(data[off + 30], 0);
    assert.strictEqual(data[off + 31], 0);
  });

  it('increments countDirEntries by 1', () => {
    var before = countDirEntries();
    insertFileEntry();
    assert.strictEqual(countDirEntries(), before + 1);
  });
});
