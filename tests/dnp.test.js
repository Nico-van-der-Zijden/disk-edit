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
    var bamOff = sectorOffset(1, 1);
    var data = new Uint8Array(buf);
    // checkSectorFree(data, bamOff, track, sector) uses fmt.isSectorFree for CMD
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
    var bamOff = sectorOffset(1, 1);
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
    var bamOff = sectorOffset(1, 1);
    var freeBefore = currentFormat.readTrackFree(data, bamOff, 3);
    assert.strictEqual(freeBefore, 256);
    // Mark T3/S10 used
    bamMarkSectorUsed(data, 3, 10, bamOff);
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
    var result = resizeDnpImage(currentBuffer, 10);
    assert.ok(result.buffer, 'should return a buffer');
    assert.strictEqual(result.buffer.byteLength, 10 * 65536);
  });

  it('updates the numTracks byte in the BAM header', () => {
    var result = resizeDnpImage(currentBuffer, 10);
    var data = new Uint8Array(result.buffer);
    assert.strictEqual(data[2 * 256 + 0x08], 10);
  });

  it('existing track 1 header and dir content is preserved', () => {
    var before = new Uint8Array(currentBuffer).slice(0, 65536);
    var result = resizeDnpImage(currentBuffer, 10);
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
    var result = resizeDnpImage(currentBuffer, 10);
    // Temporarily point currentBuffer/Tracks at the resized disk so the BAM
    // helpers use the right offsets.
    var savedBuf = currentBuffer, savedTracks = currentTracks;
    global.currentBuffer = result.buffer;
    global.currentTracks = 10;
    try {
      var data = new Uint8Array(result.buffer);
      var bamOff = sectorOffset(1, 1);
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
    var result = resizeDnpImage(currentBuffer, 5);
    assert.ok(result.buffer, 'should succeed on a clean disk');
    assert.strictEqual(result.buffer.byteLength, 5 * 65536);
    var data = new Uint8Array(result.buffer);
    assert.strictEqual(data[2 * 256 + 0x08], 5);
  });

  it('blocks shrink when a file lives on a track being removed', () => {
    loadFreshDnp(10);
    placeSyntheticFile(currentBuffer, 8, 0, 'BLOCKER');
    var result = resizeDnpImage(currentBuffer, 5);
    assert.strictEqual(result.error, 'blocked');
    assert.ok(Array.isArray(result.owners));
    assert.ok(result.owners.length >= 1);
    assert.ok(result.owners.some(function(o) { return o.track === 8 && o.sector === 0; }),
      'blocker at 8:0 should be listed');
  });

  it('returns input unchanged when newTracks equals current size', () => {
    loadFreshDnp(8);
    var result = resizeDnpImage(currentBuffer, 8);
    assert.strictEqual(result.buffer, currentBuffer);
  });

  it('rejects out-of-range track counts', () => {
    loadFreshDnp(5);
    assert.ok(resizeDnpImage(currentBuffer, 1).error);
    assert.ok(resizeDnpImage(currentBuffer, 256).error);
    assert.ok(resizeDnpImage(currentBuffer, 0).error);
  });
});
