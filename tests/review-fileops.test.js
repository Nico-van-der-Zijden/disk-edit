// Tests for the file-operation fixes in ui-fileops.js / ui-directory.js:
// undo granularity, dir-slot allocation, 1581 partition removal, unscratch
// reallocation check, partition-aware BAM edits and PC64 import parsing.
const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert');
const { resetGlobals } = require('./test-helper');

// UI hooks the code under test calls; no DOM here.
if (typeof showModal === 'undefined') global.showModal = function() {};
if (typeof renderDisk === 'undefined') global.renderDisk = function() {};

function nb(s) {
  var out = new Uint8Array(16).fill(0xA0);
  for (var i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

function freshDisk(key, tracks) {
  resetGlobals();
  var buf = createEmptyDisk(key, tracks);
  global.currentBuffer = buf;
  global.currentFormat = DISK_FORMATS[key];
  global.currentTracks = tracks;
  global.currentPartition = null;
  clearUndo();
  return buf;
}

function bamOff() { return getDirContext().bamOff; }

describe('writeFileToDisk undo', () => {
  beforeEach(() => freshDisk('d64', 35));

  it('pushes one undo step on success', () => {
    assert.ok(writeFileToDisk(FILE_TYPE.PRG, nb('A'), new Uint8Array(300), null, false));
    assert.strictEqual(undoStack.length, 1);
  });

  it('pushes nothing when the write fails', () => {
    var before = new Uint8Array(currentBuffer).slice();
    assert.strictEqual(writeFileToDisk(FILE_TYPE.PRG, nb('BIG'), new Uint8Array(200000), null, false), false);
    assert.strictEqual(undoStack.length, 0);
    assert.deepStrictEqual(new Uint8Array(currentBuffer), before);
  });

  it('silent writes leave the undo stack alone', () => {
    assert.ok(writeFileToDisk(FILE_TYPE.PRG, nb('A'), new Uint8Array(10), null, true));
    assert.strictEqual(undoStack.length, 0);
  });
});

describe('findFreeDirEntry dir extension', () => {
  beforeEach(() => freshDisk('d64', 35));

  it('skips dir-track sectors that are in use', () => {
    var data = new Uint8Array(currentBuffer);
    // Fill the first dir sector (18/1).
    for (var i = 0; i < 8; i++) insertFileEntry();
    // 18/2 holds someone's data: BAM says used.
    bamMarkSectorUsed(data, 18, 2, bamOff(), getCurrentCtx());
    var off = findFreeDirEntry(currentBuffer, null, getCurrentCtx());
    assert.strictEqual(off, sectorOffset(18, 3, getCurrentCtx()));
    var link = sectorOffset(18, 1, getCurrentCtx());
    assert.strictEqual(data[link], 18);
    assert.strictEqual(data[link + 1], 3);
  });
});

describe('changeFileType', () => {
  beforeEach(() => freshDisk('d64', 35));

  it('changes several entries in one undo step', () => {
    var a = insertFileEntry(), b = insertFileEntry();
    clearUndo();
    changeFileType([a, b], FILE_TYPE.SEQ);
    var data = new Uint8Array(currentBuffer);
    assert.strictEqual(data[a + 2], 0x80 | FILE_TYPE.SEQ);
    assert.strictEqual(data[b + 2], 0x80 | FILE_TYPE.SEQ);
    assert.strictEqual(undoStack.length, 1);
  });
});

describe('unscratchCbmEntry', () => {
  beforeEach(() => freshDisk('d64', 35));

  it('restores a scratched file whose sectors are still free', () => {
    assert.ok(writeFileToDisk(FILE_TYPE.SEQ, nb('OLD'), new Uint8Array(600), null, true));
    var off = selectedEntryIndex;
    var data = new Uint8Array(currentBuffer);
    data[off + 2] &= ~0x80;
    forEachFileSector(data, off, function(t, s) { bamMarkSectorFree(data, t, s, bamOff(), getCurrentCtx()); }, getCurrentCtx());
    var res = unscratchCbmEntry(currentBuffer, off, getCurrentCtx());
    assert.strictEqual(res.ok, true);
    assert.strictEqual(data[off + 2], 0x80 | FILE_TYPE.SEQ);
    assert.strictEqual(data[off + 30], 3);
  });

  it('refuses when another file took over its sectors', () => {
    assert.ok(writeFileToDisk(FILE_TYPE.PRG, nb('OLD'), new Uint8Array(600), null, true));
    var off = selectedEntryIndex;
    var data = new Uint8Array(currentBuffer);
    var firstT = data[off + 3], firstS = data[off + 4];
    data[off + 2] &= ~0x80;
    forEachFileSector(data, off, function(t, s) { bamMarkSectorFree(data, t, s, bamOff(), getCurrentCtx()); }, getCurrentCtx());
    // A live entry now owns the scratched file's chain.
    var newOff = insertFileEntry();
    data[newOff + 3] = firstT;
    data[newOff + 4] = firstS;
    var res = unscratchCbmEntry(currentBuffer, off, getCurrentCtx());
    assert.strictEqual(res.ok, false);
    assert.strictEqual(data[off + 2] & 0x80, 0);
  });

  it('restores a DOS-style scratch ($00) as the chosen type, PRG by default', () => {
    assert.ok(writeFileToDisk(FILE_TYPE.SEQ, nb('OLD'), new Uint8Array(600), null, true));
    var off = selectedEntryIndex;
    var data = new Uint8Array(currentBuffer);
    data[off + 2] = 0x00;
    forEachFileSector(data, off, function(t, s) { bamMarkSectorFree(data, t, s, bamOff(), getCurrentCtx()); }, getCurrentCtx());
    var snap = currentBuffer.slice(0);
    assert.strictEqual(unscratchCbmEntry(currentBuffer, off, getCurrentCtx(), FILE_TYPE.USR).ok, true);
    assert.strictEqual(data[off + 2], 0x80 | FILE_TYPE.USR);
    new Uint8Array(currentBuffer).set(new Uint8Array(snap));
    assert.strictEqual(unscratchCbmEntry(currentBuffer, off, getCurrentCtx()).ok, true);
    assert.strictEqual(data[off + 2], 0x80 | FILE_TYPE.PRG);
  });

  it('lets new writes reuse the sectors of a DOS-style scratched file', () => {
    assert.ok(writeFileToDisk(FILE_TYPE.PRG, nb('OLD'), new Uint8Array(600), null, true));
    var off = selectedEntryIndex;
    var data = new Uint8Array(currentBuffer);
    var oldFirst = data[off + 3] + ':' + data[off + 4];
    data[off + 2] = 0x00;
    forEachFileSector(data, off, function(t, s) { bamMarkSectorFree(data, t, s, bamOff(), getCurrentCtx()); }, getCurrentCtx());
    var owned = buildTrueAllocationMap(currentBuffer, getCurrentCtx());
    assert.ok(!owned[oldFirst]);
  });
});

describe('1581 partitions', () => {
  var part;
  beforeEach(() => {
    freshDisk('d81', 80);
    var res = _cbmCreateD81Partition(getCurrentCtx(), 'PART', 120);
    assert.ok(res.ok, res.error);
    part = res.partition;
  });

  function rootPartEntry() {
    var data = new Uint8Array(currentBuffer);
    var slots = getDirSlotOffsets(currentBuffer);
    return slots.find(function(o) { return (data[o + 2] & 0x07) === currentFormat.subdirType; });
  }

  it('removeFileEntry spares the kept sectors and frees the rest', () => {
    global.currentPartition = part;
    assert.ok(writeFileToDisk(FILE_TYPE.PRG, nb('KEEP'), new Uint8Array(1000), null, true));
    var data = new Uint8Array(currentBuffer);
    var keep = {};
    forEachFileSector(data, selectedEntryIndex, function(t, s) { keep[t + ':' + s] = true; }, getCurrentCtx());
    global.currentPartition = null;

    assert.ok(removeFileEntry(currentBuffer, rootPartEntry(), keep));
    var ctx = getCurrentCtx();
    for (var t = part.startTrack; t < part.startTrack + 3; t++) {
      for (var s = 0; s < 40; s++) {
        assert.strictEqual(checkSectorFree(data, bamOff(), t, s, ctx), !keep[t + ':' + s], t + '/' + s);
      }
    }
  });

  it('removeFileEntry pushes no undo step itself', () => {
    clearUndo();
    removeFileEntry(currentBuffer, rootPartEntry());
    assert.strictEqual(undoStack.length, 0);
  });

  it('writeFreeBlocks edits the partition BAM, not the root BAM', () => {
    var rootBefore = new Uint8Array(currentBuffer).slice(bamOff(), bamOff() + 512);
    global.currentPartition = part;
    var tracks = freeCountTracks(new Uint8Array(currentBuffer));
    assert.strictEqual(tracks.length, 2); // 3 tracks minus the system track
    writeFreeBlocks(currentBuffer, 5);
    assert.strictEqual(parseCurrentDir(currentBuffer).freeBlocks, 5);
    global.currentPartition = null;
    assert.deepStrictEqual(new Uint8Array(currentBuffer).slice(bamOff(), bamOff() + 512), rootBefore);
  });

  it('resyncPartitionSize follows the root entry', () => {
    global.currentPartition = Object.assign({}, part, { partSize: 999 });
    resyncPartitionSize();
    assert.strictEqual(currentPartition.partSize, part.partSize);
  });

  it('sortDirectory sorts the partition directory', () => {
    global.currentPartition = part;
    ['ZED', 'ALF', 'MID'].forEach(function(n) {
      assert.ok(writeFileToDisk(FILE_TYPE.PRG, nb(n), new Uint8Array(5), null, true));
    });
    sortDirectory(currentBuffer, 'name-asc');
    var names = parseCurrentDir(currentBuffer).entries.map(function(e) { return petsciiToReadable(e.name).trim(); });
    assert.deepStrictEqual(names, ['ALF', 'MID', 'ZED']);
  });
});

describe('PC64 import helpers', () => {
  it('reads the raw PETSCII name and strips the header', () => {
    var file = new Uint8Array(30);
    'C64File'.split('').forEach(function(c, i) { file[i] = c.charCodeAt(0); });
    file[8] = 0xC1; file[9] = 0x42; // shifted A, then B
    file[26] = 0x01; file[27] = 0x08;
    var res = parsePc64Header(file);
    assert.strictEqual(res.nameBytes[0], 0xC1);
    assert.strictEqual(res.nameBytes[1], 0x42);
    assert.strictEqual(res.nameBytes[2], 0xA0);
    assert.deepStrictEqual(Array.from(res.data), [0x01, 0x08, 0, 0]);
  });

  it('returns null without the magic, and no name for an empty one', () => {
    assert.strictEqual(parsePc64Header(new Uint8Array(40)), null);
    var file = new Uint8Array(26);
    'C64File'.split('').forEach(function(c, i) { file[i] = c.charCodeAt(0); });
    assert.strictEqual(parsePc64Header(file).nameBytes, null);
  });

  it('maps extensions to CBM types', () => {
    assert.strictEqual(importTypeForExt('prg'), FILE_TYPE.PRG);
    assert.strictEqual(importTypeForExt('s01'), FILE_TYPE.SEQ);
    assert.strictEqual(importTypeForExt('r00'), FILE_TYPE.REL);
    assert.strictEqual(importTypeForExt('d64'), -1);
  });
});
