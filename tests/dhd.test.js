// Round-trip smoke test for DHD-hosted partitions. Exercises the full
// flow that the UI walks through when the user creates a Native partition
// inside a DHD, enters it, writes data, leaves, saves, re-enters: the
// data must still be there on the second entry.
//
// Tests at the format layer (no UI dependencies). Mirrors the byte
// patterns that buildPartitionFilesystem + spliceCmdContainerPartitionBack
// produce, plus the synthetic-file / synthetic-subdir helpers used by
// the existing DNP tests.

const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert');
const { resetGlobals } = require('./test-helper');

// One-sector closed PRG at (track, sector). Marks the BAM bit used and
// writes a directory entry pointing at it. Copy of the helper used in
// tests/dnp.test.js so this file stays self-contained.
function placeSyntheticFile(buffer, track, sector, nameStr) {
  var data = new Uint8Array(buffer);
  var bamSec = 2 + (track >> 3);
  var slotOff = bamSec * 256 + (track & 7) * 32;
  data[slotOff + (sector >> 3)] &= ~(0x80 >> (sector & 7));

  var secOff = (track - 1) * 65536 + sector * 256;
  data[secOff] = 0x00;
  data[secOff + 1] = 0x01;
  data[secOff + 2] = 0x42;

  var dirOff = 34 * 256;
  var slot = -1;
  for (var i = 0; i < 8; i++) {
    if (data[dirOff + i * 32 + 2] === 0) { slot = i; break; }
  }
  if (slot < 0) throw new Error('no free dir slot');
  var entryOff = dirOff + slot * 32;
  data[entryOff + 2] = 0x82; // closed PRG
  data[entryOff + 3] = track;
  data[entryOff + 4] = sector;
  for (var j = 0; j < 16; j++) {
    data[entryOff + 5 + j] = j < nameStr.length ? nameStr.charCodeAt(j) : 0xA0;
  }
  data[entryOff + 0x1E] = 1;
  data[entryOff + 0x1F] = 0;
  return entryOff;
}

// Subdir at (hdrT, hdrS) with dir chain starting at (dirT, dirS), referenced
// from root dir slot `rootSlot`. Mirrors placeSyntheticSubdir in dnp.test.js.
function placeSyntheticSubdir(buffer, hdrT, hdrS, dirT, dirS, rootSlot, name) {
  var data = new Uint8Array(buffer);
  function setBamUsed(track, sector) {
    var bamSec = 2 + (track >> 3);
    var slotOff = bamSec * 256 + (track & 7) * 32;
    data[slotOff + (sector >> 3)] &= ~(0x80 >> (sector & 7));
  }
  setBamUsed(hdrT, hdrS);
  setBamUsed(dirT, dirS);

  var hdrOff = (hdrT - 1) * 65536 + hdrS * 256;
  data[hdrOff + 0x00] = dirT;
  data[hdrOff + 0x01] = dirS;
  data[hdrOff + 0x02] = 0x48;
  data[hdrOff + 0x20] = hdrT;
  data[hdrOff + 0x21] = hdrS;
  data[hdrOff + 0x22] = 0x01;
  data[hdrOff + 0x23] = 0x01;
  data[hdrOff + 0x24] = 1;
  data[hdrOff + 0x25] = 34;
  data[hdrOff + 0x26] = rootSlot;

  var dirOff = (dirT - 1) * 65536 + dirS * 256;
  data[dirOff + 0x00] = 0x00;
  data[dirOff + 0x01] = 0xFF;

  var rootEntryOff = 34 * 256 + rootSlot * 32;
  data[rootEntryOff + 0x02] = 0x86;
  data[rootEntryOff + 0x03] = hdrT;
  data[rootEntryOff + 0x04] = hdrS;
  for (var j = 0; j < 16; j++) {
    data[rootEntryOff + 0x05 + j] = j < name.length ? name.charCodeAt(j) : 0xA0;
  }
  data[rootEntryOff + 0x1E] = 2;
  data[rootEntryOff + 0x1F] = 0;
  return rootEntryOff;
}

describe('DHD-hosted partition round-trip', () => {
  beforeEach(function() {
    resetGlobals();
  });

  it('a Native partition created inside a DHD survives splice-out / splice-in with files intact', function() {
    // ── Step 1: empty DHD container (264 KiB, just SYSTEM)
    var dhdBuf = createEmptyDhd();
    assert.strictEqual(dhdBuf.byteLength, 0x42000, 'fresh DHD is 264 KiB');

    // ── Step 2: simulate addCmdContainerPartition: grow buffer + splice in
    // a 2-track Native filesystem at sector 1056 (the bump-allocator
    // result on a fresh DHD).
    var partTracks = 2;
    var partBytes = partTracks * 65536;
    var partStart = 0x42000;
    dhdBuf = growCmdContainer(dhdBuf, partStart + partBytes);
    assert.strictEqual(dhdBuf.byteLength, partStart + partBytes, 'container grew to fit partition');

    var partBuf = createEmptyDisk('dnp', partTracks);
    new Uint8Array(dhdBuf).set(new Uint8Array(partBuf), partStart);

    // Stamp a partition table entry at slot 1.
    writeCmdContainerPartitionEntry(dhdBuf, 'dhd', 1, 0x01, 'TESTPART', partStart, partTracks * 256);

    // ── Step 3: verify the container now reports the new partition
    var info = readCmdContainerPartitions(dhdBuf, 'dhd');
    assert.strictEqual(info.partitions.length, 2, 'SYSTEM + new Native');
    var newPart = info.partitions.find(function(p) { return p.index === 1; });
    assert.ok(newPart, 'slot 1 populated');
    assert.strictEqual(newPart.type, 0x01, 'type Native');
    assert.strictEqual(newPart.startByte, partStart);
    assert.strictEqual(newPart.sizeBytes, partBytes);

    // ── Step 4: simulate enterCmdContainerPartition — extract the slice
    // and write a file + subdir into it (the user's edits inside the
    // partition view).
    var slice = extractCmdContainerPartition(dhdBuf, newPart);
    assert.strictEqual(slice.byteLength, partBytes);

    placeSyntheticFile(slice, 1, 35, 'HELLO');
    placeSyntheticSubdir(slice, 1, 36, 1, 37, 1, 'SUBDIR');

    // ── Step 5: simulate spliceCmdContainerPartitionBack — copy the
    // (now-modified) slice back into the container at partStart.
    new Uint8Array(dhdBuf).set(new Uint8Array(slice), partStart);

    // ── Step 6: read the container as if it were freshly loaded from
    // disk. Re-extract the partition and parse its directory.
    var info2 = readCmdContainerPartitions(dhdBuf, 'dhd');
    var part2 = info2.partitions.find(function(p) { return p.index === 1; });
    var slice2 = extractCmdContainerPartition(dhdBuf, part2);

    // Set the format globals as enterCmdContainerPartition would.
    global.currentBuffer = slice2;
    global.currentFormat = DISK_FORMATS.dnp;
    global.currentTracks = partTracks;
    global.currentPartition = null;
    parseDisk(slice2, 'dnp');

    var info3 = parseCurrentDir(slice2);
    // Names come back as PETSCII PUA glyphs (U+E000+byte). Decode back to
    // ASCII for the assertion.
    var names = info3.entries.map(function(e) {
      var s = '';
      for (var k = 0; k < e.name.length; k++) {
        var cc = e.name.charCodeAt(k);
        s += String.fromCharCode(cc >= 0xE000 && cc < 0xE200 ? (cc & 0xFF) : cc);
      }
      return s;
    });

    // ── Step 7: the file AND the subdir must both still be there.
    assert.ok(names.indexOf('HELLO') >= 0, 'PRG "HELLO" survived round-trip, got: [' + names.join(',') + ']');
    assert.ok(names.indexOf('SUBDIR') >= 0, 'subdir "SUBDIR" survived round-trip, got: [' + names.join(',') + ']');

    // Sanity: free count uses the partition slice (not the container)
    // and matches a freshly-formatted 2-track DNP. The synthetic file
    // and subdir we placed sit at T1/S35..S37 — inside the dir-track's
    // ROM-reserved 64-sector zone — so they don't change the reported
    // free count (it's (tracks × 256) − 64 regardless of bitmap state
    // in that zone; see _dnpReadTrackFree's skip-8 convention).
    assert.strictEqual(info3.freeBlocks, 2 * 256 - 64);
  });

  it('deleting a partition compacts data downward and shrinks the buffer', function() {
    // Start with a fresh DHD, grow + add two 2-track Native partitions
    // (slots 1 and 2). Then clear slot 1: slot 2's data must shift down
    // into slot 1's range and the container's buffer must trim to fit.
    var dhdBuf = createEmptyDhd();
    var partTracks = 2;
    var partBytes = partTracks * 65536;
    var p1Start = 0x42000;
    var p2Start = p1Start + partBytes;
    dhdBuf = growCmdContainer(dhdBuf, p2Start + partBytes);

    new Uint8Array(dhdBuf).set(new Uint8Array(createEmptyDisk('dnp', partTracks)), p1Start);
    writeCmdContainerPartitionEntry(dhdBuf, 'dhd', 1, 0x01, 'FIRST', p1Start, partTracks * 256);
    new Uint8Array(dhdBuf).set(new Uint8Array(createEmptyDisk('dnp', partTracks)), p2Start);
    writeCmdContainerPartitionEntry(dhdBuf, 'dhd', 2, 0x01, 'SECOND', p2Start, partTracks * 256);

    // Distinct signature in slot 2's body so we can prove it moved.
    new Uint8Array(dhdBuf)[p2Start + 0x400] = 0xAB;
    new Uint8Array(dhdBuf)[p2Start + 0x401] = 0xCD;

    var sizeBefore = dhdBuf.byteLength;
    clearCmdContainerPartitionEntry(dhdBuf, 'dhd', 1);
    dhdBuf = compactCmdContainer(dhdBuf, 'dhd');

    assert.ok(dhdBuf.byteLength < sizeBefore, 'buffer shrank: was ' + sizeBefore + ', now ' + dhdBuf.byteLength);
    assert.strictEqual(dhdBuf.byteLength, p1Start + partBytes, 'trimmed to fit one remaining Native partition');

    var info = readCmdContainerPartitions(dhdBuf, 'dhd');
    assert.strictEqual(info.partitions.length, 2, 'SYSTEM + the one remaining partition');
    var second = info.partitions.find(function(p) { return p.index === 2; });
    assert.ok(second, 'slot 2 still populated');
    assert.strictEqual(second.startByte, p1Start, 'slot 2 shifted down into slot 1\'s old range');
    assert.strictEqual(new Uint8Array(dhdBuf)[p1Start + 0x400], 0xAB, 'slot 2 data moved with the entry');
    assert.strictEqual(new Uint8Array(dhdBuf)[p1Start + 0x401], 0xCD);

    // Delete the last user partition; buffer must collapse back to the
    // minimum SYSTEM-only size.
    clearCmdContainerPartitionEntry(dhdBuf, 'dhd', 2);
    dhdBuf = compactCmdContainer(dhdBuf, 'dhd');
    assert.strictEqual(dhdBuf.byteLength, 0x42000, 'empty DHD shrinks back to 264 KiB');
  });

  it('partition entry start/size encoding round-trips on a multi-MiB DHD', function() {
    // Place a partition at a byte address whose high byte (+0x15) is
    // non-zero, exercising the block24x512 start encoder. 32 MiB into the
    // image gives start = 0x20000 × 0x100 = 0x2000000 bytes, encoded as
    // +0x15..+0x17 = 01 00 00.
    var dhdBuf = createEmptyDhd();
    var start = 0x40_00000; // 64 MiB into the image
    dhdBuf = growCmdContainer(dhdBuf, start + 65536);
    writeCmdContainerPartitionEntry(dhdBuf, 'dhd', 5, 0x01, 'FAR', start, 256);

    var info = readCmdContainerPartitions(dhdBuf, 'dhd');
    var far = info.partitions.find(function(p) { return p.index === 5; });
    assert.ok(far, 'slot 5 populated');
    assert.strictEqual(far.startByte, start, 'block24x512 start round-trips at 64 MiB offset');
    assert.strictEqual(far.sizeBytes, 65536, '256 256-byte blocks = 64 KiB');
  });
});
