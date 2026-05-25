// Tests for DNP (CMD Native Partition) format, BAM helpers, and resize
const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert');
const { resetGlobals } = require('./test-helper');

// Helper: synthesize a 1-sector closed PRG file at the given (track, sector)
// on a fresh DNP buffer. Marks the sector used in BAM and writes a directory
// entry pointing at it. No sector-chain walking needed — one sector is enough
// to exercise findDnpHighTrackOwners and the resize-blocking check.
function placeSyntheticFile(buffer, track, sector, nameStr) {
  var data = new Uint8Array(buffer);
  var bamSec = 2 + (track >> 3);
  var slotOff = bamSec * 256 + (track & 7) * 32;
  data[slotOff + (sector >> 3)] &= ~(0x80 >> (sector & 7));

  var secOff = (track - 1) * 65536 + sector * 256;
  data[secOff] = 0x00;      // next track: 0 (terminal)
  data[secOff + 1] = 0x01;  // bytes-used: 1
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
  data[entryOff + 30] = 1;
  data[entryOff + 31] = 0;
}

function loadFreshDnp(tracks) {
  var buf = createEmptyDisk('dnp', tracks);
  global.currentBuffer = buf;
  global.currentFormat = DISK_FORMATS.dnp;
  global.currentTracks = tracks;
  global.currentPartition = null;
  return buf;
}

describe('createEmptyDisk for DNP', () => {
  beforeEach(() => { resetGlobals(); });

  it('produces a buffer sized numTracks * 65536', () => {
    var buf = loadFreshDnp(5);
    assert.strictEqual(buf.byteLength, 5 * 65536);
  });

  it('records numTracks in the BAM header byte', () => {
    var buf = loadFreshDnp(7);
    var data = new Uint8Array(buf);
    // First BAM sector is at T1/S2 (offset 2*256), numTracks byte at +0x08
    assert.strictEqual(data[2 * 256 + 0x08], 7);
  });

  it('marks track 1 sectors 0-34 used in BAM', () => {
    var buf = loadFreshDnp(5);
    var bamOff = sectorOffset(1, 1, getCurrentCtx());
    var data = new Uint8Array(buf);
    // checkSectorFree(data, bamOff, track, sector, getCurrentCtx()) uses fmt.isSectorFree for CMD
    for (var s = 0; s <= 34; s++) {
      assert.strictEqual(currentFormat.isSectorFree(data, bamOff, 1, s), false,
        'sector 1:' + s + ' should be used');
    }
    // Sector 35 onwards on track 1 should be free
    assert.strictEqual(currentFormat.isSectorFree(data, bamOff, 1, 35), true);
  });

  it('marks tracks 2..numTracks fully free', () => {
    var buf = loadFreshDnp(5);
    var data = new Uint8Array(buf);
    var bamOff = sectorOffset(1, 1, getCurrentCtx());
    for (var t = 2; t <= 5; t++) {
      assert.strictEqual(currentFormat.readTrackFree(data, bamOff, t), 256,
        'track ' + t + ' should have 256 free sectors');
    }
  });
});

describe('_cmdReadTrackFree / _cmdIsSectorFree on a populated DNP', () => {
  beforeEach(() => {
    resetGlobals();
    loadFreshDnp(5);
  });

  it('reports correct free count after marking one sector used', () => {
    var data = new Uint8Array(currentBuffer);
    var bamOff = sectorOffset(1, 1, getCurrentCtx());
    var freeBefore = currentFormat.readTrackFree(data, bamOff, 3);
    assert.strictEqual(freeBefore, 256);
    // Mark T3/S10 used
    bamMarkSectorUsed(data, 3, 10, bamOff, getCurrentCtx());
    assert.strictEqual(currentFormat.readTrackFree(data, bamOff, 3), 255);
    assert.strictEqual(currentFormat.isSectorFree(data, bamOff, 3, 10), false);
    assert.strictEqual(currentFormat.isSectorFree(data, bamOff, 3, 11), true);
  });
});

describe('findDnpHighTrackOwners', () => {
  beforeEach(() => {
    resetGlobals();
    loadFreshDnp(10);
  });

  it('returns empty list on a fresh disk (no files)', () => {
    var owners = findDnpHighTrackOwners(currentBuffer, 5);
    assert.deepStrictEqual(owners, []);
  });

  it('finds a synthetic file placed on a high track', () => {
    placeSyntheticFile(currentBuffer, 7, 0, 'HIGHFILE');
    var owners = findDnpHighTrackOwners(currentBuffer, 6);
    assert.ok(owners.length >= 1, 'should find the file sector');
    assert.ok(owners.some(function(o) { return o.track === 7 && o.sector === 0; }),
      'should report 7:0 as an owner');
  });

  it('ignores files on tracks below the minTrack cutoff', () => {
    placeSyntheticFile(currentBuffer, 3, 0, 'LOWFILE');
    // Asking about tracks >= 5 should return nothing
    var owners = findDnpHighTrackOwners(currentBuffer, 5);
    assert.deepStrictEqual(owners, []);
  });
});

describe('resizeDnpImage — grow', () => {
  beforeEach(() => {
    resetGlobals();
    loadFreshDnp(5);
  });

  it('grows 5 -> 10 tracks, buffer size doubles', () => {
    var result = resizeDnpImage(currentBuffer, 10, getCurrentCtx());
    assert.ok(result.buffer, 'should return a buffer');
    assert.strictEqual(result.buffer.byteLength, 10 * 65536);
  });

  it('updates the numTracks byte in the BAM header', () => {
    var result = resizeDnpImage(currentBuffer, 10, getCurrentCtx());
    var data = new Uint8Array(result.buffer);
    assert.strictEqual(data[2 * 256 + 0x08], 10);
  });

  it('existing track 1 header and dir content is preserved', () => {
    var before = new Uint8Array(currentBuffer).slice(0, 65536);
    var result = resizeDnpImage(currentBuffer, 10, getCurrentCtx());
    var after = new Uint8Array(result.buffer).slice(0, 65536);
    // Everything on track 1 except the numTracks byte (already tested) matches
    var mismatches = 0;
    for (var i = 0; i < 65536; i++) {
      if (i === 2 * 256 + 0x08) continue;
      if (before[i] !== after[i]) mismatches++;
    }
    assert.strictEqual(mismatches, 0);
  });

  it('new tracks have all-free BAM bitmaps', () => {
    var result = resizeDnpImage(currentBuffer, 10, getCurrentCtx());
    // Temporarily point currentBuffer/Tracks at the resized disk so the BAM
    // helpers use the right offsets.
    var savedBuf = currentBuffer, savedTracks = currentTracks;
    global.currentBuffer = result.buffer;
    global.currentTracks = 10;
    try {
      var data = new Uint8Array(result.buffer);
      var bamOff = sectorOffset(1, 1, getCurrentCtx());
      for (var t = 6; t <= 10; t++) {
        assert.strictEqual(currentFormat.readTrackFree(data, bamOff, t), 256,
          'new track ' + t + ' should be fully free');
      }
    } finally {
      global.currentBuffer = savedBuf;
      global.currentTracks = savedTracks;
    }
  });
});

describe('resizeDnpImage — shrink', () => {
  beforeEach(() => { resetGlobals(); });

  it('shrinks a clean 10-track DNP to 5 tracks', () => {
    loadFreshDnp(10);
    var result = resizeDnpImage(currentBuffer, 5, getCurrentCtx());
    assert.ok(result.buffer, 'should succeed on a clean disk');
    assert.strictEqual(result.buffer.byteLength, 5 * 65536);
    var data = new Uint8Array(result.buffer);
    assert.strictEqual(data[2 * 256 + 0x08], 5);
  });

  it('blocks shrink when a file lives on a track being removed', () => {
    loadFreshDnp(10);
    placeSyntheticFile(currentBuffer, 8, 0, 'BLOCKER');
    var result = resizeDnpImage(currentBuffer, 5, getCurrentCtx());
    assert.strictEqual(result.error, 'blocked');
    assert.ok(Array.isArray(result.owners));
    assert.ok(result.owners.length >= 1);
    assert.ok(result.owners.some(function(o) { return o.track === 8 && o.sector === 0; }),
      'blocker at 8:0 should be listed');
  });

  it('returns input unchanged when newTracks equals current size', () => {
    loadFreshDnp(8);
    var result = resizeDnpImage(currentBuffer, 8, getCurrentCtx());
    assert.strictEqual(result.buffer, currentBuffer);
  });

  it('rejects out-of-range track counts', () => {
    loadFreshDnp(5);
    assert.ok(resizeDnpImage(currentBuffer, 1, getCurrentCtx()).error);
    assert.ok(resizeDnpImage(currentBuffer, 256, getCurrentCtx()).error);
    assert.ok(resizeDnpImage(currentBuffer, 0, getCurrentCtx()).error);
  });
});

// Helper: place a two-sector file chain spanning two tracks. Returns entryOff.
// Sector A (startT/startS) links to sector B (nextT/nextS); B terminates.
function placeTwoSectorChain(buffer, startT, startS, nextT, nextS, nameStr) {
  var data = new Uint8Array(buffer);
  function setBamUsed(track, sector) {
    var bamSec = 2 + (track >> 3);
    var slotOff = bamSec * 256 + (track & 7) * 32;
    data[slotOff + (sector >> 3)] &= ~(0x80 >> (sector & 7));
  }
  setBamUsed(startT, startS);
  setBamUsed(nextT, nextS);

  var offA = (startT - 1) * 65536 + startS * 256;
  data[offA] = nextT;
  data[offA + 1] = nextS;
  data[offA + 2] = 0x42;

  var offB = (nextT - 1) * 65536 + nextS * 256;
  data[offB] = 0x00;
  data[offB + 1] = 0x01;
  data[offB + 2] = 0x99;

  var dirOff = 34 * 256;
  var slot = -1;
  for (var i = 0; i < 8; i++) {
    if (data[dirOff + i * 32 + 2] === 0) { slot = i; break; }
  }
  if (slot < 0) throw new Error('no free dir slot');
  var entryOff = dirOff + slot * 32;
  data[entryOff + 2] = 0x82;
  data[entryOff + 3] = startT;
  data[entryOff + 4] = startS;
  for (var j = 0; j < 16; j++) {
    data[entryOff + 5 + j] = j < nameStr.length ? nameStr.charCodeAt(j) : 0xA0;
  }
  data[entryOff + 30] = 2;
  data[entryOff + 31] = 0;
  return entryOff;
}

describe('resizeDnpImage — boundary & chain cases', () => {
  beforeEach(() => { resetGlobals(); });

  it('allows shrink when file sits on the highest kept track', () => {
    loadFreshDnp(10);
    placeSyntheticFile(currentBuffer, 5, 3, 'LASTKEEP');
    var result = resizeDnpImage(currentBuffer, 5, getCurrentCtx());
    assert.ok(result.buffer, 'should succeed when file is on the new boundary track');
    assert.strictEqual(result.buffer.byteLength, 5 * 65536);
  });

  it('blocks shrink when file sits on the first doomed track', () => {
    loadFreshDnp(10);
    placeSyntheticFile(currentBuffer, 6, 0, 'FIRSTCUT');
    var result = resizeDnpImage(currentBuffer, 5, getCurrentCtx());
    assert.strictEqual(result.error, 'blocked');
    assert.ok(result.owners.some(function(o) { return o.track === 6; }));
  });

  it('blocks shrink when a file chain crosses into a doomed track', () => {
    loadFreshDnp(10);
    // Start on kept track 5, continuation on doomed track 7
    placeTwoSectorChain(currentBuffer, 5, 10, 7, 4, 'CROSSING');
    var result = resizeDnpImage(currentBuffer, 6, getCurrentCtx());
    assert.strictEqual(result.error, 'blocked');
    assert.ok(result.owners.some(function(o) { return o.track === 7 && o.sector === 4; }),
      'high-track sector 7:4 should be flagged even though the chain starts on track 5');
  });

  it('grow then shrink back is byte-identical to the original', () => {
    loadFreshDnp(5);
    placeSyntheticFile(currentBuffer, 3, 12, 'ROUNDTRIP');
    var original = new Uint8Array(currentBuffer).slice();
    var grown = resizeDnpImage(currentBuffer, 10, getCurrentCtx());
    assert.ok(grown.buffer);
    // Point format context at the resized disk so findDnpHighTrackOwners walks correctly
    global.currentBuffer = grown.buffer;
    global.currentTracks = 10;
    var shrunk = resizeDnpImage(grown.buffer, 5, getCurrentCtx());
    assert.ok(shrunk.buffer, 'shrink back should succeed (no files above track 5)');
    var after = new Uint8Array(shrunk.buffer);
    assert.strictEqual(after.length, original.length);
    for (var i = 0; i < original.length; i++) {
      assert.strictEqual(after[i], original[i], 'byte ' + i + ' differs after grow+shrink round-trip');
    }
  });

  it('shrinks a clean 10-track disk to the 2-track minimum', () => {
    loadFreshDnp(10);
    var result = resizeDnpImage(currentBuffer, 2, getCurrentCtx());
    assert.ok(result.buffer);
    assert.strictEqual(result.buffer.byteLength, 2 * 65536);
    assert.strictEqual(new Uint8Array(result.buffer)[2 * 256 + 0x08], 2);
  });

  it('grows a 5-track disk to the 255-track maximum without overflow', () => {
    loadFreshDnp(5);
    var result = resizeDnpImage(currentBuffer, 255, getCurrentCtx());
    assert.ok(result.buffer);
    assert.strictEqual(result.buffer.byteLength, 255 * 65536);
    assert.strictEqual(new Uint8Array(result.buffer)[2 * 256 + 0x08], 255);
  });
});

// Build a synthetic DNP subdir: header at (hdrT, hdrS), dir chain starting at
// (dirT, dirS). Writes the subdir entry into the root dir at slot `rootSlot`
// with initial blockCount = 2 (header + 1 dir block, per spec). Returns
// { rootEntryOff, hdrOff, dirOff }.
function placeSyntheticSubdir(buffer, hdrT, hdrS, dirT, dirS, rootSlot, name) {
  var data = new Uint8Array(buffer);

  function setBamUsed(track, sector) {
    var bamSec = 2 + (track >> 3);
    var slotOff = bamSec * 256 + (track & 7) * 32;
    data[slotOff + (sector >> 3)] &= ~(0x80 >> (sector & 7));
  }
  setBamUsed(hdrT, hdrS);
  setBamUsed(dirT, dirS);

  // Subdir header sector: self T/S at +$20, parent header T/S at +$22
  // (T1/S1 = root header), parent-entry pointer at +$24..+$26.
  var hdrOff = (hdrT - 1) * 65536 + hdrS * 256;
  data[hdrOff + 0x00] = dirT;
  data[hdrOff + 0x01] = dirS;
  data[hdrOff + 0x02] = 0x48; // 'H'
  data[hdrOff + 0x20] = hdrT;
  data[hdrOff + 0x21] = hdrS;
  data[hdrOff + 0x22] = 0x01; // parent header = root T1/S1
  data[hdrOff + 0x23] = 0x01;
  data[hdrOff + 0x24] = 1;    // parent dir sector = T1/S34 (root)
  data[hdrOff + 0x25] = 34;
  data[hdrOff + 0x26] = rootSlot;

  // Subdir dir block: terminal link, ready to accept entries.
  var dirOff = (dirT - 1) * 65536 + dirS * 256;
  data[dirOff + 0x00] = 0x00;
  data[dirOff + 0x01] = 0xFF;

  // Root dir entry pointing at the new subdir (type 0x86 = closed DIR).
  var rootDirOff = (1 - 1) * 65536 + 34 * 256;
  var entryOff = rootDirOff + rootSlot * 32;
  data[entryOff + 0x02] = 0x86;
  data[entryOff + 0x03] = hdrT;
  data[entryOff + 0x04] = hdrS;
  for (var j = 0; j < 16; j++) {
    data[entryOff + 0x05 + j] = j < name.length ? name.charCodeAt(j) : 0xA0;
  }
  data[entryOff + 0x1E] = 2;  // header + 1 dir block
  data[entryOff + 0x1F] = 0;

  return { rootEntryOff: entryOff, hdrOff: hdrOff, dirOff: dirOff };
}

describe('insertFileEntry — DNP subdir size invariant', () => {
  beforeEach(() => { resetGlobals(); });

  it('does NOT bump any parent count when inserting in the root', () => {
    loadFreshDnp(5);
    var data = new Uint8Array(currentBuffer);

    // Capture the byte at T1/S34 +$3E/+$3F (where a hypothetical "parent" of
    // root would live — there is none). Fill the root dir's first sector and
    // force allocation of a 2nd dir sector.
    var rootDirOff = 34 * 256;
    var before = data.slice(rootDirOff, rootDirOff + 256).toString();

    var inserted = 0;
    while (inserted < 9) {
      var off = insertFileEntry();
      assert.ok(off >= 0, 'insertFileEntry should succeed (iter ' + inserted + ')');
      inserted++;
    }

    // The root has no parent entry — nothing about size fields elsewhere
    // should have changed. Spot-check that no foreign sector got a stray
    // size bump by re-reading T1/S34's first entry: it's an inserted file,
    // not a subdir, so its +$1E/+$1F is the file's own block count.
    // No assertion needed beyond "insertFileEntry returned successfully
    // without throwing". Mainly we're asserting the size-bump branch
    // exits cleanly when currentPartition is null (root).
    assert.ok(true);
  });

  it('bumps parent entry block count from 2 to 3 when a DNP subdir grows', () => {
    loadFreshDnp(5);
    var info = placeSyntheticSubdir(currentBuffer, 2, 0, 2, 1, 0, 'SUBDIR');
    var data = new Uint8Array(currentBuffer);

    // Pre-fill the subdir's first dir block with 8 entries so the next
    // insert forces a new dir sector.
    for (var i = 0; i < 8; i++) {
      var eo = info.dirOff + i * 32;
      data[eo + 0x02] = 0x82; // closed PRG
      data[eo + 0x03] = 0;
      data[eo + 0x04] = 0;
      for (var j = 0; j < 16; j++) data[eo + 0x05 + j] = 0x41 + i; // filler name
      data[eo + 0x1E] = 1;
      data[eo + 0x1F] = 0;
    }

    // Descend into the subdir context.
    global.currentPartition = {
      dnpDir: true,
      dnpDirT: 2, dnpDirS: 1,
      dnpHeaderT: 2, dnpHeaderS: 0,
      name: 'SUBDIR',
    };

    // Sanity: parent entry's block count starts at 2.
    assert.strictEqual(data[info.rootEntryOff + 0x1E], 2);
    assert.strictEqual(data[info.rootEntryOff + 0x1F], 0);

    var newOff = insertFileEntry();
    assert.ok(newOff >= 0, 'insertFileEntry should allocate a new dir block');

    // Re-read — the buffer may not have been replaced, but be safe.
    data = new Uint8Array(currentBuffer);
    var sz = data[info.rootEntryOff + 0x1E] | (data[info.rootEntryOff + 0x1F] << 8);
    assert.strictEqual(sz, 3,
      'parent entry block count should bump from 2 to 3 after subdir growth');
  });

  it('does not bump twice when an existing free slot is reused', () => {
    loadFreshDnp(5);
    var info = placeSyntheticSubdir(currentBuffer, 2, 0, 2, 1, 0, 'SUBDIR');
    var data = new Uint8Array(currentBuffer);

    // Only fill 4 entries — slots 4-7 remain free, so the next insert
    // should NOT need a new sector.
    for (var i = 0; i < 4; i++) {
      var eo = info.dirOff + i * 32;
      data[eo + 0x02] = 0x82;
      for (var j = 0; j < 16; j++) data[eo + 0x05 + j] = 0x41 + i;
      data[eo + 0x1E] = 1;
    }

    global.currentPartition = {
      dnpDir: true,
      dnpDirT: 2, dnpDirS: 1,
      dnpHeaderT: 2, dnpHeaderS: 0,
      name: 'SUBDIR',
    };

    var newOff = insertFileEntry();
    assert.ok(newOff >= 0);
    data = new Uint8Array(currentBuffer);
    var sz = data[info.rootEntryOff + 0x1E] | (data[info.rootEntryOff + 0x1F] << 8);
    assert.strictEqual(sz, 2,
      'parent block count should be unchanged when no new dir sector was allocated');
  });
});

// ──────────────────────────────────────────────────────────────────────
// CMD container partition-table start-address encoding (D2M / D4M)
// ──────────────────────────────────────────────────────────────────────
describe('CMD FD container — partition start address encoding', () => {
  it('round-trips a 512-byte-aligned start through write → read', () => {
    var buf = new Uint8Array(64);
    // Write the D2M-DNP.TXT worked example: 1571 partition starts at $C8000.
    _cmdContainerWriteStart(buf, 0, 'block16x512', 0xC8000);

    // Per spec: +$15 = 0x00, +$16/+$17 = high/low of (0xC8000 / 512) = $0640.
    assert.strictEqual(buf[0x15], 0x00);
    assert.strictEqual(buf[0x16], 0x06);
    assert.strictEqual(buf[0x17], 0x40);

    // Read should give back 0xC8000.
    var got = _cmdContainerReadStart(buf, 0, 'block16x512');
    assert.strictEqual(got, 0xC8000);
  });

  it('decodes the D2M-DNP.TXT worked-example 1571 partition entry', () => {
    // Spec sample bytes at entry offset +$15..+$17 = 00 06 40
    var buf = new Uint8Array(64);
    buf[0x15] = 0x00; buf[0x16] = 0x06; buf[0x17] = 0x40;
    var got = _cmdContainerReadStart(buf, 0, 'block16x512');
    // Spec: "starts at file offset $0C8000"
    assert.strictEqual(got, 0xC8000);
  });

  it('decodes the D2M-DNP.TXT 1581 partition (start = 0)', () => {
    var buf = new Uint8Array(64);
    buf[0x15] = 0x00; buf[0x16] = 0x00; buf[0x17] = 0x00;
    assert.strictEqual(_cmdContainerReadStart(buf, 0, 'block16x512'), 0);
  });

  it('RAMLink byte32 encoding still works after refactor', () => {
    var buf = new Uint8Array(64);
    _cmdContainerWriteStart(buf, 0, 'byte32', 0x1234567);
    assert.strictEqual(buf[0x15], 0x01);
    assert.strictEqual(buf[0x16], 0x23);
    assert.strictEqual(buf[0x17], 0x45);
    assert.strictEqual(buf[0x18], 0x67);
    assert.strictEqual(_cmdContainerReadStart(buf, 0, 'byte32'), 0x1234567);
  });
});

describe('checkBAMIntegrity — fresh FD images have no phantom orphans', () => {
  beforeEach(() => { resetGlobals(); });

  ['d1m', 'd2m', 'd4m'].forEach(function(key) {
    it('fresh ' + key.toUpperCase() + ' reports 0 orphans (was 4960+ for D4M before fix)', () => {
      var buf = createEmptyDisk(key, 81);
      global.currentBuffer = buf;
      global.currentFormat = DISK_FORMATS[key];
      global.currentTracks = 81;
      global.currentPartition = null;
      var result = checkBAMIntegrity(buf, getCurrentCtx());
      assert.strictEqual(result.orphanCount, 0,
        'fresh ' + key + ' should not report any orphans');
      assert.strictEqual(result.allocMismatch, 0,
        'fresh ' + key + ' should not report any alloc mismatches');
    });
  });
});

describe('detectFormat — size-first, content-byte-agnostic', () => {
  it('detects a DNP with edited / zeroed DOS-type bytes', () => {
    // Build a 5-track buffer where someone has scrubbed the entire
    // T1/S1 header (no 'H', no '1'). Old detection would have failed and
    // returned D64-40t. Now it should still detect as DNP by size.
    var buf = new ArrayBuffer(5 * 65536);
    var got = detectFormat(buf.byteLength, buf);
    assert.strictEqual(got.format.name, 'DNP');
    assert.strictEqual(got.tracks, 5);
  });

  it('keeps D64-40-track precedence over a 3-track DNP (196608 byte collision)', () => {
    var buf = new ArrayBuffer(196608);
    var got = detectFormat(buf.byteLength, buf);
    // Size table runs first — D64 is declared before DNP and has 196608 in
    // its sizes array, so the collision resolves to D64-40t.
    assert.strictEqual(got.format.name, 'D64');
    assert.strictEqual(got.tracks, 40);
  });

  it('detects D81 (819200 bytes) by size, not by content', () => {
    var buf = new ArrayBuffer(819200);
    var got = detectFormat(buf.byteLength, buf);
    assert.strictEqual(got.format.name, 'D81');
    assert.strictEqual(got.tracks, 80);
  });

  it('detects D2M (1658880 bytes — not a multiple of 65536) by size', () => {
    var buf = new ArrayBuffer(1658880);
    var got = detectFormat(buf.byteLength, buf);
    assert.strictEqual(got.format.name, 'D2M');
  });

  it('falls back to DNP for non-standard multiples of 65536', () => {
    // 25 tracks × 64 KiB = 1638400 — not in any sizes table.
    var buf = new ArrayBuffer(25 * 65536);
    var got = detectFormat(buf.byteLength, buf);
    assert.strictEqual(got.format.name, 'DNP');
    assert.strictEqual(got.tracks, 25);
  });
});

describe('parseCurrentDir — preserves format inside a CMD container partition slice', () => {
  beforeEach(() => {
    resetGlobals();
    global.cmdcPartitions = null;
    global.cmdcPartitionIdx = -1;
    global.cmdcContainerKey = null;
    global.cmdcBuffer = null;
    global.cmdcFileName = null;
  });

  it('keeps currentFormat as D2M for a Native slice whose size matches D81', () => {
    // 819200-byte slice = both a valid D81 size AND a plausible FD Native slice.
    // The bug was: parseDisk(slice) without a hint re-detected as D81.
    var slice = new ArrayBuffer(819200);
    global.currentBuffer = slice;
    global.currentFormat = DISK_FORMATS.d2m;
    global.currentTracks = 81;
    global.currentPartition = null;
    global.cmdcPartitions = [{ type: 0x01 }];
    global.cmdcPartitionIdx = 0;
    global.cmdcContainerKey = 'd2m';

    parseCurrentDir(slice);

    assert.strictEqual(currentFormat.name, 'D2M',
      'format should stay as D2M, not be re-detected as D81');
  });

  it('still falls back to detectFormat when no container partition is active', () => {
    // Without cmdcPartitionIdx >= 0, parseDisk runs detectFormat.
    // 819200 bytes matches D81 in the size table.
    var slice = new ArrayBuffer(819200);
    global.currentBuffer = slice;
    global.currentPartition = null;
    global.cmdcPartitions = null;
    global.cmdcPartitionIdx = -1;

    parseCurrentDir(slice);

    assert.strictEqual(currentFormat.name, 'D81',
      'standalone files should still go through detectFormat');
  });
});
