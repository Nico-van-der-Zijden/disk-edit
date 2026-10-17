// Regression tests for the IDE64 / CMD-container review fixes.
const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
require('./test-helper');

function loadScript(relPath) {
  var src = fs.readFileSync(path.join(__dirname, '..', relPath), 'utf8')
    .replace(/^const /gm, 'var ')
    .replace(/^let /gm, 'var ');
  vm.runInThisContext(src, { filename: relPath });
}
loadScript('assets/js/ui/disk/ui-ide64.js');
loadScript('assets/js/ui/disk/ui-cmd.js');

function bytesOf(str) {
  var out = new Uint8Array(str.length);
  for (var i = 0; i < str.length; i++) out[i] = str.charCodeAt(i);
  return out;
}

function nameBytes16(str) {
  var out = new Uint8Array(16).fill(0xA0);
  for (var i = 0; i < str.length && i < 16; i++) out[i] = str.charCodeAt(i);
  return out;
}

function freshHdd(mib) {
  var buf = createEmptyHdd(mib);
  var part = readIde64Partitions(buf).partitions[0];
  return { buf: buf, part: part, root: part.cfsRootDir.addr };
}

function liveNames(buf, dirLba) {
  return readCfsDirectory(buf, dirLba)
    .filter(function(e) { return !e.empty && !e.isSelfRef && e.ftype !== CFS_FTYPE.DEL; })
    .map(function(e) { return petsciiToReadable(e.name); });
}

describe('CFS bitmap validator on multi-chunk partitions', function() {
  it('a fresh 32 MiB image validates with nothing lost or missing', function() {
    var h = freshHdd(32);
    var v = cfsValidatePartition(h.buf, h.part);
    assert.strictEqual(v.lostCount, 0);
    assert.strictEqual(v.missingCount, 0);
    assert.strictEqual(v.overlapCount, 0);
  });

  it('Fix Bitmap keeps the companion sectors and the backup-table LBA reserved', function() {
    var h = freshHdd(32);
    cfsValidatePartition(h.buf, h.part, { fix: true });
    assert.strictEqual(cfsIsSectorFree(h.buf, h.part.startLba, h.part.endLba), false, 'last LBA / backup table');
    for (var c = h.part.startLba; c <= h.part.endLba; c += CFS_BITMAP_CHUNK) {
      assert.strictEqual(cfsIsSectorFree(h.buf, h.part.startLba, c + 1), false, 'companion of chunk at ' + c);
    }
  });

  it('heat map and validator agree after an import', function() {
    var h = freshHdd(32);
    assert.ok(cfsImportFile(h.buf, h.part.startLba, h.part.endLba, h.root, 'BIG', new Uint8Array(200000)).ok);
    assert.strictEqual(cfsValidatePartition(h.buf, h.part).lostCount, 0);
    assert.strictEqual(_cfsBuildLbaOwnership(h.buf, h.part).lostCount, 0);
  });
});

describe('CMD container partition sizes round up to whole clusters', function() {
  it('a 1541 on CMD HD stores 342 clusters and the next one starts past it', function() {
    var buf = createEmptyDhd();
    var info = readCmdContainerPartitions(buf, 'dhd');
    var free = findCmdContainerFreeSpace(buf, 'dhd', info.partitions);
    buf = growCmdContainer(buf, free.start + cmdContainerPartitionBytes('dhd', 0x02, 683));
    writeCmdContainerPartitionEntry(buf, 'dhd', 1, 0x02, '1541', free.start, 683);
    var p = readCmdContainerPartitions(buf, 'dhd').partitions.filter(function(x) { return x.index === 1; })[0];
    assert.strictEqual(p.sizeBytes, 342 * 512);
    assert.ok(extractCmdContainerPartition(buf, p).byteLength >= 174848, 'slice holds all 683 blocks');
    var next = findCmdContainerFreeSpace(buf, 'dhd', readCmdContainerPartitions(buf, 'dhd').partitions);
    assert.ok(next.start >= free.start + 174848, 'next partition must not overlap T35');
    assert.strictEqual(next.start % 512, 0);
  });

  it('a 1571 is 683 clusters on CMD HD but 684 on FD (D2M-DNP.TXT)', function() {
    assert.strictEqual(cmdContainerPartitionBytes('dhd', 0x03, 1366), 683 * 512);
    assert.strictEqual(cmdContainerPartitionBytes('d2m', 0x03, 1366), 684 * 512);
    assert.strictEqual(cmdContainerPartitionBytes('d2m', 0x02, 683), 342 * 512);
    assert.strictEqual(cmdContainerPartitionBytes('d2m', 0x04, 3200), 1600 * 512);
    assert.strictEqual(cmdContainerPartitionBytes('ramlink', 0x02, 683), 683 * 256);
  });

  it('a 1541 on an FD image is 342 clusters and leaves room after it', function() {
    var buf = createCmdNativeImage('d2m', 81);
    clearCmdContainerPartitionEntry(buf, 'd2m', 1);
    var free = findCmdContainerFreeSpace(buf, 'd2m', readCmdContainerPartitions(buf, 'd2m').partitions);
    writeCmdContainerPartitionEntry(buf, 'd2m', 1, 0x02, '1541', free.start, 683);
    var parts = readCmdContainerPartitions(buf, 'd2m').partitions;
    var p = parts.filter(function(x) { return x.index === 1; })[0];
    assert.strictEqual(p.sizeBytes, 342 * 512);
    assert.strictEqual(findCmdContainerFreeSpace(buf, 'd2m', parts).start, free.start + 342 * 512);
  });
});

describe('CMD partition free-block tooltip', function() {
  it('does not depend on the DOS version byte', function() {
    var d64 = new Uint8Array(createEmptyDisk('d64', 35));
    var part = { type: 0x02, startByte: 0, sizeBytes: 342 * 512 };
    var container = new Uint8Array(part.sizeBytes);
    container.set(d64);
    var before = computePartitionFreeBlocks(container.buffer, part);
    assert.strictEqual(before, 664);
    container[0x16502] = 0x00;
    assert.strictEqual(computePartitionFreeBlocks(container.buffer, part), 664);
    assert.strictEqual(computePartitionFreeBlocks(new ArrayBuffer(part.sizeBytes), part), null, 'empty slot');
  });

  it('reports the BLOCKS FREE count for empty 1571 / 1581 partitions', function() {
    var d71 = createEmptyDisk('d71', 70);
    assert.strictEqual(computePartitionFreeBlocks(d71, { type: 0x03, startByte: 0, sizeBytes: d71.byteLength }), 1328);
    var d81 = createEmptyDisk('d81', 80);
    assert.strictEqual(computePartitionFreeBlocks(d81, { type: 0x04, startByte: 0, sizeBytes: d81.byteLength }), 3160);
  });
});

describe('CFS 0-byte files', function() {
  it('cfsImportFile accepts an empty payload without allocating data', function() {
    var h = freshHdd(4);
    var freeBefore = cfsCountFreeSectors(h.buf, h.part.startLba, h.part.endLba);
    var r = cfsImportFile(h.buf, h.part.startLba, h.part.endLba, h.root, 'EMPTY', new Uint8Array(0));
    assert.ok(r.ok, r.error);
    assert.strictEqual(cfsCountFreeSectors(h.buf, h.part.startLba, h.part.endLba), freeBefore);
    var e = readCfsDirectory(h.buf, h.root).filter(function(x) { return !x.empty && x.name && petsciiToReadable(x.name) === 'EMPTY'; })[0];
    assert.ok(e);
    assert.strictEqual(e.size, 0);
    assert.strictEqual(e.dataTreePtr.lba, false);
  });

  it('a tree paste with an empty file completes and round-trips', function() {
    var h = freshHdd(4);
    var tree = {
      nameBytes: nameBytes16('TOP'),
      files: [
        { nameBytes: nameBytes16('EMPTY'), ftype: CFS_FTYPE.NORMAL, typeSuffix: 'PRG', payload: new Uint8Array(0), size: 0 },
        { nameBytes: nameBytes16('DATA'), ftype: CFS_FTYPE.NORMAL, typeSuffix: 'PRG', payload: bytesOf('abc'), size: 3 },
      ],
      subdirs: [], skippedLnks: [],
    };
    var res = cfsPasteDirTree(h.buf, h.part.startLba, h.part.endLba, h.root, tree, {});
    assert.ok(res.ok, res.error);
    assert.strictEqual(res.copiedFiles, 2);
    var top = cfsResolvePath(h.buf, h.root, 'TOP');
    assert.deepStrictEqual(liveNames(h.buf, top.dataTreePtr.addr).sort(), ['DATA', 'EMPTY']);
    var coll = cfsCollectDirTree(h.buf, top.dataTreePtr.addr, nameBytes16('TOP'));
    assert.strictEqual(coll.tree.files.length, 2, 'empty file is collected too');
    assert.strictEqual(cfsValidatePartition(h.buf, h.part).lostCount, 0);
  });
});

describe('CFS directory sector cap', function() {
  it('refuses to grow a directory past CFS_MAX_DIR_SECTORS', function() {
    var h = freshHdd(4);
    var sub = cfsCreateSubdir(h.buf, h.part.startLba, h.part.endLba, h.root, 'BIGDIR');
    assert.ok(sub.ok);
    var maxEntries = CFS_MAX_DIR_SECTORS * CFS_DIR_ENTRIES_PER_SECTOR - 1; // minus the self-ref
    for (var i = 0; i < maxEntries; i++) {
      var r = cfsImportFile(h.buf, h.part.startLba, h.part.endLba, sub.newDirLba, 'F' + i, new Uint8Array(0));
      assert.ok(r.ok, 'entry ' + i + ': ' + r.error);
    }
    assert.strictEqual(liveNames(h.buf, sub.newDirLba).length, maxEntries, 'every entry is visible');
    var freeBefore = cfsCountFreeSectors(h.buf, h.part.startLba, h.part.endLba);
    var over = cfsImportFile(h.buf, h.part.startLba, h.part.endLba, sub.newDirLba, 'ONEMORE', bytesOf('x'));
    assert.strictEqual(over.ok, false);
    assert.match(over.error, /full/);
    assert.strictEqual(cfsCreateSubdir(h.buf, h.part.startLba, h.part.endLba, sub.newDirLba, 'D').ok, false);
    assert.strictEqual(cfsCountFreeSectors(h.buf, h.part.startLba, h.part.endLba), freeBefore);
  });
});

describe('CFS paste ignores scratched entries', function() {
  it('a scratched entry with the same name is no conflict and stays restorable', function() {
    var h = freshHdd(4);
    cfsImportFile(h.buf, h.part.startLba, h.part.endLba, h.root, 'TOP', bytesOf('old'));
    var old = cfsResolvePath(h.buf, h.root, 'TOP');
    assert.ok(cfsDeleteFile(h.buf, h.part.startLba, h.part.endLba, old).ok);
    var tree = { nameBytes: nameBytes16('TOP'), files: [], subdirs: [], skippedLnks: [] };
    var res = cfsPasteDirTree(h.buf, h.part.startLba, h.part.endLba, h.root, tree, { onConflict: 'cancel' });
    assert.ok(res.ok, res.error);
    var scratched = readCfsDirectory(h.buf, h.root).filter(function(e) {
      return !e.empty && e.ftype === CFS_FTYPE.DEL && petsciiToReadable(e.name) === 'TOP';
    });
    assert.strictEqual(scratched.length, 1);
  });

  it('overwrite-merge leaves a scratched same-named file alone', function() {
    var h = freshHdd(4);
    var top = cfsCreateSubdir(h.buf, h.part.startLba, h.part.endLba, h.root, 'TOP');
    cfsImportFile(h.buf, h.part.startLba, h.part.endLba, top.newDirLba, 'A', bytesOf('old'));
    var a = cfsResolvePath(h.buf, top.newDirLba, 'A');
    cfsDeleteFile(h.buf, h.part.startLba, h.part.endLba, a);
    var tree = {
      nameBytes: nameBytes16('TOP'),
      files: [{ nameBytes: nameBytes16('A'), ftype: CFS_FTYPE.NORMAL, typeSuffix: 'PRG', payload: bytesOf('new'), size: 3 }],
      subdirs: [], skippedLnks: [],
    };
    var res = cfsPasteDirTree(h.buf, h.part.startLba, h.part.endLba, h.root, tree, { onConflict: 'overwrite' });
    assert.ok(res.ok, res.error);
    var all = readCfsDirectory(h.buf, top.newDirLba).filter(function(e) { return !e.empty && !e.isSelfRef; });
    assert.strictEqual(all.filter(function(e) { return e.ftype === CFS_FTYPE.DEL; }).length, 1);
    assert.deepStrictEqual(liveNames(h.buf, top.newDirLba), ['A']);
  });
});

describe('CFS LNK entries own their data tree', function() {
  it('count, scratch and unscratch treat a LNK like a file', function() {
    var h = freshHdd(4);
    var freeBefore = cfsCountFreeSectors(h.buf, h.part.startLba, h.part.endLba);
    var r = cfsImportFile(h.buf, h.part.startLba, h.part.endLba, h.root, 'LINK', bytesOf('/TARGET'),
      { ftype: CFS_FTYPE.LNK, typeSuffix: 'LNK' });
    assert.ok(r.ok);
    var lnk = cfsResolvePath(h.buf, h.root, 'LINK');
    assert.strictEqual(cfsCountFileDataSectors(h.buf, h.part.startLba, h.part.endLba, lnk), 1);
    assert.strictEqual(cfsValidatePartition(h.buf, h.part).lostCount, 0);
    assert.ok(cfsDeleteFile(h.buf, h.part.startLba, h.part.endLba, lnk).ok);
    assert.strictEqual(cfsCountFreeSectors(h.buf, h.part.startLba, h.part.endLba), freeBefore, 'tree + data freed');
    var dead = readCfsDirectory(h.buf, h.root).filter(function(e) { return !e.empty && e.typeSuffix === 'LNK'; })[0];
    var un = cfsUnscratchEntry(h.buf, h.part.startLba, h.part.endLba, dead);
    assert.ok(un.ok, un.error);
    assert.strictEqual(un.sectorsReclaimed, 2);
    var v = cfsValidatePartition(h.buf, h.part);
    assert.strictEqual(v.lostCount + v.missingCount, 0);
  });
});

describe('cfsSortDirectory with gaps', function() {
  it('a gap whose slot carries dir-next bits sorts to the end', function() {
    var h = freshHdd(4);
    for (var i = 0; i < 16; i++) {
      cfsImportFile(h.buf, h.part.startLba, h.part.endLba, h.root, 'F' + String.fromCharCode(0x41 + i), bytesOf('x'));
    }
    var data = new Uint8Array(h.buf);
    var entries = readCfsDirectory(h.buf, h.root);
    var victim = entries.filter(function(e) {
      return !e.empty && !e.isSelfRef && e.dirLba === h.root &&
        (data[e.dirLba * IDE64_SECTOR_SIZE + e.index * CFS_DIR_ENTRY_SIZE + 0x14] & CFS_DIR_NEXT_BITS);
    })[0];
    assert.ok(victim, 'need a slot carrying dir-next bits');
    cfsRemoveDirEntry(h.buf, h.part.startLba, h.part.endLba, victim, h.root);
    assert.ok(cfsSortDirectory(h.buf, h.root, h.part.cfsDeletedDir.addr, 'name-asc'));
    var after = readCfsDirectory(h.buf, h.root).filter(function(e) { return !e.isSelfRef; });
    var firstEmpty = after.findIndex(function(e) { return e.empty; });
    var lastUsed = -1;
    after.forEach(function(e, idx) { if (!e.empty) lastUsed = idx; });
    assert.ok(firstEmpty > lastUsed, 'no gap before a live entry');
    assert.strictEqual(liveNames(h.buf, h.root).length, 16, '%DELETED FILES% + 15 files');
  });
});

describe('CFS partition table follows the boot pointer at $18', function() {
  it('rename writes the table the pointer names and mirrors it to the backup', function() {
    var h = freshHdd(4);
    var data = new Uint8Array(h.buf);
    var moved = cfsAllocSector(h.buf, h.part.startLba, h.part.endLba, h.part.startLba + 100);
    data.copyWithin(moved * IDE64_SECTOR_SIZE, IDE64_SECTOR_SIZE, 2 * IDE64_SECTOR_SIZE);
    data.fill(0, IDE64_SECTOR_SIZE, 2 * IDE64_SECTOR_SIZE);
    data[0x18] = 0x40 | ((moved >>> 24) & 0x0F);
    data[0x19] = (moved >>> 16) & 0xFF;
    data[0x1A] = (moved >>> 8) & 0xFF;
    data[0x1B] = moved & 0xFF;
    assert.ok(cfsRenamePartition(h.buf, 0, 'MOVED').ok);
    assert.strictEqual(petsciiToReadable(readIde64Partitions(h.buf).partitions[0].name), 'MOVED');
    assert.strictEqual(petsciiToReadable(readIde64BackupPartitions(h.buf).partitions[0].name), 'MOVED');
    for (var i = 0; i < IDE64_SECTOR_SIZE; i++) assert.strictEqual(data[IDE64_SECTOR_SIZE + i], 0, 'LBA 1 untouched');
  });
});

describe('New CFS partition overlap check', function() {
  it('flags live partitions only', function() {
    var parts = [
      { index: 0, startLba: 2, endLba: 999 },
      { index: 1, startLba: 1000, endLba: 1999, deleted: true },
      { index: 2, empty: true, startLba: null, endLba: null },
    ];
    assert.strictEqual(_hddFindLiveOverlap(parts, 500, 600).index, 0);
    assert.strictEqual(_hddFindLiveOverlap(parts, 999, 1100).index, 0);
    assert.strictEqual(_hddFindLiveOverlap(parts, 1000, 1500), null);
    assert.strictEqual(_hddFindLiveOverlap(parts, 2000, 3000), null);
  });
});

describe('Batch CFS import with a failing middle file', function() {
  beforeEach(function() {
    clearUndo();
    global.refreshIde64View = function() {};
    global.showModal = function() {};
  });

  it('rolls back the failure and still imports the next file into the live buffer', async function() {
    var h = freshHdd(1);
    var info = readIde64Partitions(h.buf);
    currentBuffer = h.buf;
    hddBuffer = h.buf;
    hddBootInfo = info;
    hddPartitions = info.partitions;
    cfsPartitionIdx = 0;
    cfsDirLba = h.root;
    var entries = [
      { name: 'A.PRG', buffer: bytesOf('first').buffer },
      { name: 'BIG.PRG', buffer: new ArrayBuffer(1536 * 1024) },
      { name: 'C.PRG', buffer: bytesOf('third').buffer },
    ];
    await importFilesToCurrentDisk(entries);
    assert.strictEqual(hddBuffer, currentBuffer, 'hddBuffer follows the rolled-back buffer');
    var names = liveNames(currentBuffer, h.root);
    assert.ok(names.indexOf('A') >= 0, 'first file imported');
    assert.ok(names.indexOf('C') >= 0, 'third file imported into the saved buffer');
    assert.ok(names.indexOf('BIG') < 0);
    assert.strictEqual(redoStack.length, 0, 'the failure leaves no redo step');
    assert.strictEqual(undoStack.length, 2);
    var v = cfsValidatePartition(currentBuffer, hddPartitions[0]);
    assert.strictEqual(v.lostCount + v.missingCount, 0);
  });
});
