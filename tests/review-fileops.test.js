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

describe('removeFileEntry frees blocks', () => {
  function sectorsOf(off) {
    var list = [];
    forEachFileSector(new Uint8Array(currentBuffer), off, function(t, s) { list.push([t, s]); }, getCurrentCtx());
    return list;
  }
  function isFree(ts) { return checkSectorFree(new Uint8Array(currentBuffer), bamOff(), ts[0], ts[1], getCurrentCtx()); }

  it('frees a removed file\'s sectors and the free count follows', () => {
    freshDisk('d64', 35);
    var freeBefore = parseCurrentDir(currentBuffer).freeBlocks;
    assert.ok(writeFileToDisk(FILE_TYPE.PRG, nb('A'), new Uint8Array(3000), null, true));
    var secs = sectorsOf(selectedEntryIndex);
    assert.ok(removeFileEntry(currentBuffer, selectedEntryIndex));
    assert.ok(secs.every(isFree));
    assert.strictEqual(parseCurrentDir(currentBuffer).freeBlocks, freeBefore);
  });

  it('keeps sectors another live file still uses', () => {
    freshDisk('d64', 35);
    assert.ok(writeFileToDisk(FILE_TYPE.PRG, nb('A'), new Uint8Array(1000), null, true));
    var a = selectedEntryIndex;
    var b = insertFileEntry();
    var data = new Uint8Array(currentBuffer);
    data[b + 3] = data[a + 3];
    data[b + 4] = data[a + 4];
    var secs = sectorsOf(a);
    assert.ok(removeFileEntry(currentBuffer, a));
    assert.ok(secs.every(function(ts) { return !isFree(ts); }));
  });

  it('leaves a scratched entry\'s sectors alone', () => {
    freshDisk('d64', 35);
    assert.ok(writeFileToDisk(FILE_TYPE.PRG, nb('OLD'), new Uint8Array(600), null, true));
    var old = selectedEntryIndex;
    var secs = sectorsOf(old);
    scratchCbmEntry(currentBuffer, old, getCurrentCtx());
    // A new file now holds the freed sectors.
    assert.ok(writeFileToDisk(FILE_TYPE.PRG, nb('NEW'), new Uint8Array(600), null, true));
    assert.ok(removeFileEntry(currentBuffer, old));
    assert.ok(secs.every(function(ts) { return !isFree(ts); }));
  });

  it('frees a DNP subdir with everything in it', () => {
    freshDisk('dnp', 16);
    var freeBefore = parseCurrentDir(currentBuffer).freeBlocks;
    var res = _cbmCreateDnpSubdir(getCurrentCtx(), 'SUB');
    assert.ok(res.ok);
    global.currentPartition = res.partition;
    for (var i = 0; i < 10; i++) assert.ok(writeFileToDisk(FILE_TYPE.PRG, nb('F' + i), new Uint8Array(800), null, true));
    global.currentPartition = null;
    var data = new Uint8Array(currentBuffer);
    var sub = getDirSlotOffsets(currentBuffer).find(function(o) { return (data[o + 2] & 0x07) === currentFormat.subdirType; });
    assert.ok(removeFileEntry(currentBuffer, sub));
    assert.strictEqual(parseCurrentDir(currentBuffer).freeBlocks, freeBefore);
  });
});

describe('sectors in use without a dir entry', () => {
  function geosDiskWithBorder() {
    freshDisk('d64', 35);
    writeGeosSignature(currentBuffer, getCurrentCtx());
    // 17/0: the first sector a D64 write would pick.
    var data = new Uint8Array(currentBuffer);
    var hdr = sectorOffset(currentFormat.headerTrack, currentFormat.headerSector, getCurrentCtx());
    data[hdr + 0xAB] = 17;
    data[hdr + 0xAC] = 0;
    bamMarkSectorUsed(data, 17, 0, bamOff(), getCurrentCtx());
    return readGeosBorderRef(currentBuffer, getCurrentCtx());
  }

  it('writes never land on the GEOS border sector', () => {
    var border = geosDiskWithBorder();
    var used = {};
    while (writeFileToDisk(FILE_TYPE.PRG, nb('X'), new Uint8Array(254 * 20), null, true)) {
      forEachFileSector(new Uint8Array(currentBuffer), selectedEntryIndex, function(t, s) { used[t + ':' + s] = true; }, getCurrentCtx());
    }
    assert.ok(!used[border.track + ':' + border.sector]);
  });

  it('validate keeps the GEOS border sector and C128 boot block allocated', () => {
    var border = geosDiskWithBorder();
    var data = new Uint8Array(currentBuffer);
    var boot = sectorOffset(1, 0, getCurrentCtx());
    data[boot] = 0x43; data[boot + 1] = 0x42; data[boot + 2] = 0x4D;
    bamMarkSectorUsed(data, 1, 0, bamOff(), getCurrentCtx());
    validateDisk(currentBuffer, getCurrentCtx());
    assert.ok(!checkSectorFree(data, bamOff(), border.track, border.sector, getCurrentCtx()));
    assert.ok(!checkSectorFree(data, bamOff(), 1, 0, getCurrentCtx()));
  });
});

describe('40-track speeder BAM', () => {
  var EXT = { SpeedDOS: 0xC0, DolphinDOS: 0xAC };
  function speederDisk(variant) {
    freshDisk('d64', 40);
    var data = new Uint8Array(currentBuffer);
    var base = bamOff() + EXT[variant];
    for (var t = 0; t < 5; t++) data.set([17, 0xFF, 0xFF, 0x01], base + t * 4);
    assert.strictEqual(getSpeederVariant(currentBuffer, getCurrentCtx()), variant);
    return base;
  }
  function fillExt() {
    var data = new Uint8Array(currentBuffer);
    for (var t = 36; t <= 40; t++) for (var s = 0; s < 17; s++) bamMarkSectorUsed(data, t, s, bamOff(), getCurrentCtx());
  }

  ['SpeedDOS', 'DolphinDOS'].forEach(function(variant) {
    it(variant + ': stays found once tracks 36-40 are full', () => {
      var base = speederDisk(variant);
      fillExt();
      var data = new Uint8Array(currentBuffer);
      assert.strictEqual(data[base + 16], 0, 'track 40 free count');
      assert.strictEqual(getSpeederVariant(currentBuffer, getCurrentCtx()), variant);
      var t1s0 = data.slice(0, 3);
      bamMarkSectorFree(data, 38, 5, bamOff(), getCurrentCtx());
      assert.deepStrictEqual(data.slice(0, 3), t1s0, 'track 1 sector 0 untouched');
      assert.ok(checkSectorFree(data, bamOff(), 38, 5, getCurrentCtx()));
      assert.strictEqual(data[base + 8], 1);
    });
  });

  it('an undo snapshot keeps the variant of a full disk', () => {
    speederDisk('SpeedDOS');
    fillExt();
    pushUndo();
    assert.ok(popUndo());
    assert.strictEqual(getSpeederVariant(currentBuffer, getCurrentCtx()), 'SpeedDOS');
  });

  it('without a speeder BAM, tracks 36-40 read as used and are never written', () => {
    freshDisk('d64', 40);
    var data = new Uint8Array(currentBuffer);
    var before = data.slice();
    bamMarkSectorFree(data, 38, 5, bamOff(), getCurrentCtx());
    bamMarkSectorUsed(data, 39, 1, bamOff(), getCurrentCtx());
    assert.deepStrictEqual(data, before);
    assert.strictEqual(checkSectorFree(data, bamOff(), 38, 5, getCurrentCtx()), false);
  });

  it('GEOS conversion is refused on a DolphinDOS disk', () => {
    var base = speederDisk('DolphinDOS');
    var before = new Uint8Array(currentBuffer).slice(base, base + 20);
    assert.ok(geosConversionBlocker(currentBuffer, getCurrentCtx()));
    assert.strictEqual(writeGeosSignature(currentBuffer, getCurrentCtx()), false);
    assert.deepStrictEqual(new Uint8Array(currentBuffer).slice(base, base + 20), before);
    assert.strictEqual(hasGeosSignature(currentBuffer, getCurrentCtx()), false);
  });

  it('GEOS conversion still works on a SpeedDOS disk', () => {
    speederDisk('SpeedDOS');
    assert.strictEqual(writeGeosSignature(currentBuffer, getCurrentCtx()), true);
    assert.strictEqual(getSpeederVariant(currentBuffer, getCurrentCtx()), 'SpeedDOS');
  });
});

describe('directory track marked used in the BAM', () => {
  // D81 root with every free track-40 sector marked used: the root dir
  // (40/3) can't grow past its first sector.
  function lockDirTrack() {
    var data = new Uint8Array(currentBuffer);
    for (var s = 4; s < 40; s++) bamMarkSectorUsed(data, 40, s, bamOff(), getCurrentCtx());
  }

  it('Move to Root counts only the slots it can really place', () => {
    freshDisk('d81', 80);
    var res = _cbmCreateD81Partition(getCurrentCtx(), 'PART', 120);
    global.currentPartition = res.partition;
    for (var i = 0; i < 12; i++) assert.ok(writeFileToDisk(FILE_TYPE.PRG, nb('P' + i), new Uint8Array(300), null, true));
    global.currentPartition = null;
    lockDirTrack();
    var partOff = getDirSlotOffsets(currentBuffer)[0];
    var files = parsePartition(currentBuffer, res.partition.startTrack, res.partition.partSize, getCurrentCtx()).entries;
    var before = new Uint8Array(currentBuffer).slice();
    // 8 slots in 40/3 once the partition entry is gone; the old estimate said 12 fit.
    assert.strictEqual(countMoveToRootSlots(partOff, files), 8);
    assert.deepStrictEqual(new Uint8Array(currentBuffer), before, 'trial run leaves the disk alone');
  });

  it('a failed write says the directory can\'t grow', () => {
    freshDisk('d81', 80);
    lockDirTrack();
    for (var i = 0; i < 8; i++) assert.ok(writeFileToDisk(FILE_TYPE.PRG, nb('F' + i), new Uint8Array(10), null, true));
    assert.strictEqual(writeFileToDisk(FILE_TYPE.PRG, nb('X'), new Uint8Array(10), null, true), false);
    assert.strictEqual(writeFailureReason(), DIR_CANT_GROW);
  });
});

describe('REL side sectors', () => {
  // A REL file by hand: data chain from writeFileToDisk plus one side
  // sector borrowed from a second file whose entry is then dropped.
  function makeRel() {
    assert.ok(writeFileToDisk(FILE_TYPE.SEQ, nb('REL'), new Uint8Array(1200), null, true));
    var relOff = selectedEntryIndex;
    assert.ok(writeFileToDisk(FILE_TYPE.SEQ, nb('SS'), new Uint8Array(10), null, true));
    var ssOff = selectedEntryIndex;
    var data = new Uint8Array(currentBuffer);
    var ss = { t: data[ssOff + 3], s: data[ssOff + 4] };
    data[relOff + 2] = 0x80 | FILE_TYPE.REL;
    data[relOff + 0x15] = ss.t;
    data[relOff + 0x16] = ss.s;
    data[relOff + 0x17] = 64;
    data[relOff + 30]++;
    for (var j = 2; j < 32; j++) data[ssOff + j] = 0;
    return { off: relOff, ss: ss };
  }

  ['d64', 'd81'].forEach(function(key) {
    it(key + ': scratch frees the side sectors too', () => {
      freshDisk(key, key === 'd64' ? 35 : 80);
      var rel = makeRel();
      scratchCbmEntry(currentBuffer, rel.off, getCurrentCtx());
      var data = new Uint8Array(currentBuffer);
      assert.strictEqual(data[rel.off + 2], 0x00);
      assert.ok(checkSectorFree(data, bamOff(), rel.ss.t, rel.ss.s, getCurrentCtx()));
    });

    it(key + ': validate keeps the side sectors allocated', () => {
      freshDisk(key, key === 'd64' ? 35 : 80);
      var rel = makeRel();
      var log = validateDisk(currentBuffer, getCurrentCtx());
      assert.ok(!checkSectorFree(new Uint8Array(currentBuffer), bamOff(), rel.ss.t, rel.ss.s, getCurrentCtx()));
      assert.deepStrictEqual(log, ['Disk is valid. No errors found.']);
    });
  });

  it('validate partition keeps the side sectors allocated', () => {
    freshDisk('d81', 80);
    var res = _cbmCreateD81Partition(getCurrentCtx(), 'PART', 120);
    global.currentPartition = res.partition;
    var rel = makeRel();
    var log = validatePartition(currentBuffer, res.partition.startTrack, res.partition.partSize, getCurrentCtx());
    assert.ok(!checkSectorFree(new Uint8Array(currentBuffer), bamOff(), rel.ss.t, rel.ss.s, getCurrentCtx()));
    assert.ok(!log.some(function(l) { return /Warning|ERROR|BAM corrected/.test(l); }), log.join('\n'));
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
