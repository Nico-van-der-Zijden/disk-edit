// Tests for cbmPasteDirTree (CBM-DOS tree paster, task #12).
// Uses a fresh DNP image as the target — DNP supports flat files,
// subdirs (linked), and the same writeFileToDisk path as D81 / D64.
const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert');
const { resetGlobals } = require('./test-helper');

function loadFreshDnp(tracks) {
  var buf = createEmptyDisk('dnp', tracks);
  global.currentBuffer = buf;
  global.currentFormat = DISK_FORMATS.dnp;
  global.currentTracks = tracks;
  global.currentPartition = null;
  return buf;
}

// Build a minimal generic tree of two files (PRG + SEQ) at the root.
function _buildSimpleTree() {
  function nb(s) {
    var out = new Uint8Array(16);
    for (var i = 0; i < 16; i++) {
      out[i] = i < s.length ? s.charCodeAt(i) : 0xA0;
    }
    return out;
  }
  return {
    nameBytes: nb('SRC'),
    files: [
      { nameBytes: nb('HELLO'),   cbmTypeIdx: 2, payload: new Uint8Array([0x01, 0x08, 0xAA, 0xBB]), size: 4 },
      { nameBytes: nb('SEQTEST'), cbmTypeIdx: 1, payload: new Uint8Array(100), size: 100 },
    ],
    subdirs: [],
    skippedLnks: [],
  };
}

describe('cbmPasteDirTree (task #12 — MVP file-only writer)', () => {
  beforeEach(() => { resetGlobals(); });

  it('writes files into the destination DNP and they read back correctly', () => {
    var buf = loadFreshDnp(81);
    var ctx = getCurrentCtx();
    var tree = _buildSimpleTree();
    var res = cbmPasteDirTree(ctx, tree, { onConflict: 'cancel', flat: true });
    assert.strictEqual(res.ok, true);
    assert.strictEqual(res.copiedFiles, 2);
    assert.strictEqual(res.skippedLnks.length, 0);
    assert.strictEqual(res.skippedDirs.length, 0);
    // Verify the file actually exists in the directory. parseDisk
    // returns names as PUA-encoded PETSCII strings; petsciiToReadable
    // gives us ASCII for the assertion.
    var dirInfo = parseCurrentDir(buf);
    var entries = (dirInfo && dirInfo.entries) || [];
    var fileNames = entries.map(function(e) { return petsciiToReadable(e.name || '').trim(); });
    assert.ok(fileNames.indexOf('HELLO') >= 0, 'HELLO present in dir, got: ' + JSON.stringify(fileNames));
    assert.ok(fileNames.indexOf('SEQTEST') >= 0, 'SEQTEST present in dir');
  });

  it('refuses on cancel mode when the file name already exists', () => {
    var buf = loadFreshDnp(81);
    var ctx = getCurrentCtx();
    var tree = _buildSimpleTree();
    cbmPasteDirTree(ctx, tree, { onConflict: 'cancel', flat: true });
    // Second flat-paste — should refuse on the first file conflict (HELLO already exists at root)
    var res = cbmPasteDirTree(ctx, tree, { onConflict: 'cancel', flat: true });
    assert.strictEqual(res.ok, false);
    assert.ok(res.error && res.error.indexOf('already exists') >= 0);
  });

  it('overwrite mode replaces the existing file by name', () => {
    var buf = loadFreshDnp(81);
    var ctx = getCurrentCtx();
    function nb(s) {
      var out = new Uint8Array(16);
      for (var i = 0; i < 16; i++) out[i] = i < s.length ? s.charCodeAt(i) : 0xA0;
      return out;
    }
    // First, paste a small HELLO (flat = file at root)
    cbmPasteDirTree(ctx, {
      nameBytes: nb('X'), files: [{ nameBytes: nb('HELLO'), cbmTypeIdx: 2, payload: new Uint8Array(8), size: 8 }],
      subdirs: [], skippedLnks: [],
    }, { onConflict: 'cancel', flat: true });
    // Now overwrite with a bigger HELLO (flat again so the file conflict triggers)
    var bigger = new Uint8Array(500);
    for (var i = 0; i < 500; i++) bigger[i] = i & 0xFF;
    var res = cbmPasteDirTree(ctx, {
      nameBytes: nb('X'), files: [{ nameBytes: nb('HELLO'), cbmTypeIdx: 2, payload: bigger, size: 500 }],
      subdirs: [], skippedLnks: [],
    }, { onConflict: 'overwrite', flat: true });
    assert.strictEqual(res.ok, true);
    // Verify only one HELLO exists in the dir
    var dirInfo = parseCurrentDir(buf);
    var entries = (dirInfo && dirInfo.entries) || [];
    var helloCount = entries.filter(function(e) {
      return petsciiToReadable(e.name || '').trim() === 'HELLO';
    }).length;
    assert.strictEqual(helloCount, 1, 'exactly one HELLO after overwrite');
  });

  it('creates DNP subdirs and recurses into them', () => {
    var buf = loadFreshDnp(81);
    var ctx = getCurrentCtx();
    function nb(s) {
      var out = new Uint8Array(16);
      for (var i = 0; i < 16; i++) out[i] = i < s.length ? s.charCodeAt(i) : 0xA0;
      return out;
    }
    var tree = {
      nameBytes: nb('SRC'),
      files: [{ nameBytes: nb('FILE1'), cbmTypeIdx: 2, payload: new Uint8Array(8), size: 8 }],
      subdirs: [
        {
          nameBytes: nb('GAMES'),
          files: [{ nameBytes: nb('PONG'), cbmTypeIdx: 2, payload: new Uint8Array(16), size: 16 }],
          subdirs: [], skippedLnks: [],
        },
        { nameBytes: nb('ART'), files: [], subdirs: [], skippedLnks: [] },
      ],
      skippedLnks: [],
    };
    var res = cbmPasteDirTree(ctx, tree, { onConflict: 'cancel', flat: true });
    assert.strictEqual(res.ok, true);
    assert.strictEqual(res.copiedFiles, 2);   // FILE1 at root + PONG inside GAMES
    assert.strictEqual(res.copiedDirs, 2);    // GAMES + ART
    assert.strictEqual(res.skippedDirs.length, 0);
    // Verify GAMES + ART + FILE1 via cbmCollectDirTree (test-helper
    // doesn't load parseDnpDirectory so we use the lower-level walker).
    var coll = cbmCollectDirTree(ctx);
    function nameOf(bytes) {
      var n = '';
      for (var i = 0; i < 16; i++) { var b = bytes[i]; if (b === 0xA0 || b === 0) break; n += String.fromCharCode(b); }
      return n.replace(/ +$/, '');
    }
    var subNames = coll.tree.subdirs.map(function(s) { return nameOf(s.nameBytes); });
    assert.ok(subNames.indexOf('GAMES') >= 0, 'GAMES dir present: ' + JSON.stringify(subNames));
    assert.ok(subNames.indexOf('ART')   >= 0, 'ART dir present');
    var rootFileNames = coll.tree.files.map(function(f) { return nameOf(f.nameBytes); });
    assert.ok(rootFileNames.indexOf('FILE1') >= 0, 'FILE1 at root');
  });

  it('wrap-mode rename picks " (N)" suffix with name-length truncation', () => {
    function nb(s) {
      var out = new Uint8Array(16);
      for (var i = 0; i < 16; i++) out[i] = i < s.length ? s.charCodeAt(i) : 0xA0;
      return out;
    }
    function nameOf(bytes) {
      var n = '';
      for (var i = 0; i < 16; i++) { var b = bytes[i]; if (b === 0xA0 || b === 0) break; n += String.fromCharCode(b); }
      return n.replace(/ +$/, '');
    }
    var buf = loadFreshDnp(81);
    var ctx = getCurrentCtx();
    // First paste creates SRC; second paste with 'rename' should land
    // as 'SRC (2)'.
    cbmPasteDirTree(ctx, _buildSimpleTree(), { onConflict: 'cancel' });
    var res = cbmPasteDirTree(ctx, _buildSimpleTree(), { onConflict: 'rename' });
    assert.strictEqual(res.ok, true);
    var subs = cbmCollectDirTree(ctx).tree.subdirs.map(function(s) { return nameOf(s.nameBytes); });
    assert.ok(subs.indexOf('SRC') >= 0, 'original SRC still present');
    assert.ok(subs.indexOf('SRC (2)') >= 0, 'renamed SRC (2) created: ' + JSON.stringify(subs));

    // Truncation: 'LONGDIRNAMEXYZW' (15 chars) + ' (2)' (4 chars) = 19 →
    // base trimmed to 12 chars → 'LONGDIRNAMEX (2)' (16 chars).
    var longTree = { nameBytes: nb('LONGDIRNAMEXYZW'), files: [], subdirs: [], skippedLnks: [] };
    cbmPasteDirTree(ctx, longTree, { onConflict: 'cancel' });
    var res2 = cbmPasteDirTree(ctx, longTree, { onConflict: 'rename' });
    assert.strictEqual(res2.ok, true);
    var subs2 = cbmCollectDirTree(ctx).tree.subdirs.map(function(s) { return nameOf(s.nameBytes); });
    assert.ok(subs2.indexOf('LONGDIRNAMEX (2)') >= 0, 'truncated rename present: ' + JSON.stringify(subs2));
  });

  it('_cbmGrowD81Partition extends a sub-partition into free root tracks', () => {
    function nb(s) {
      var out = new Uint8Array(16);
      for (var i = 0; i < 16; i++) out[i] = i < s.length ? s.charCodeAt(i) : 0xA0;
      return out;
    }
    var buf = createEmptyDisk('d81', 80);
    global.currentBuffer = buf;
    global.currentFormat = DISK_FORMATS.d81;
    global.currentTracks = 80;
    global.currentPartition = null;
    var rootCtx = getCurrentCtx();
    // Create a 3-track sub-partition (the spec minimum)
    var res = _cbmCreateD81Partition(rootCtx, 'GAMES', 40); // 40 below spec floor → bumped to 120 (3 tracks)
    assert.strictEqual(res.ok, true);
    var startTrack = res.partition.startTrack;
    var origSize = res.partition.partSize;
    assert.strictEqual(origSize, 120, '3-track partition = 120 sectors');

    // Build a sub-partition ctx and try to grow it by 200 sectors (5 tracks)
    var subCtx = Object.assign({}, rootCtx, {
      partition: { startTrack: startTrack, partSize: origSize, name: 'GAMES' },
    });
    var grown = _cbmGrowD81Partition(subCtx, 200);
    assert.strictEqual(grown.ok, true, 'grow ok: ' + JSON.stringify(grown));
    assert.ok(grown.addedTracks >= 5, 'added at least 5 tracks (got ' + grown.addedTracks + ')');
    assert.strictEqual(grown.newPartSize, origSize + grown.addedTracks * 40);

    // Verify partSize byte in the parent dir entry was rewritten
    var dirInfo = parseCurrentDir(buf);
    var games = (dirInfo.entries || []).find(function(e) { return petsciiToReadable(e.name || '').trim() === 'GAMES'; });
    var d = new Uint8Array(buf);
    var partSizeOnDisk = d[games.entryOff + 30] | (d[games.entryOff + 31] << 8);
    assert.strictEqual(partSizeOnDisk, grown.newPartSize, 'parent entry partSize matches grow output');
  });

  it('_cbmGrowD81Partition refuses when next track is occupied', () => {
    function nb(s) {
      var out = new Uint8Array(16);
      for (var i = 0; i < 16; i++) out[i] = i < s.length ? s.charCodeAt(i) : 0xA0;
      return out;
    }
    var buf = createEmptyDisk('d81', 80);
    global.currentBuffer = buf;
    global.currentFormat = DISK_FORMATS.d81;
    global.currentTracks = 80;
    global.currentPartition = null;
    var rootCtx = getCurrentCtx();
    // Create two back-to-back 3-track sub-partitions
    var a = _cbmCreateD81Partition(rootCtx, 'A', 40);
    var b = _cbmCreateD81Partition(rootCtx, 'B', 40);
    assert.strictEqual(a.ok, true);
    assert.strictEqual(b.ok, true);
    assert.strictEqual(b.partition.startTrack, a.partition.startTrack + 3, 'B is right after A');

    // Try to grow A — should refuse because B occupies the next track
    var subCtxA = Object.assign({}, rootCtx, {
      partition: { startTrack: a.partition.startTrack, partSize: a.partition.partSize, name: 'A' },
    });
    var grown = _cbmGrowD81Partition(subCtxA, 40);
    assert.strictEqual(grown.ok, false);
    assert.ok(grown.error && grown.error.indexOf('no contiguous free tracks') >= 0);
  });

  it('creates D81 CBM partitions for subdirs (file type $05)', () => {
    function nb(s) {
      var out = new Uint8Array(16);
      for (var i = 0; i < 16; i++) out[i] = i < s.length ? s.charCodeAt(i) : 0xA0;
      return out;
    }
    var buf = createEmptyDisk('d81', 80);
    global.currentBuffer = buf;
    global.currentFormat = DISK_FORMATS.d81;
    global.currentTracks = 80;
    global.currentPartition = null;
    var ctx = getCurrentCtx();
    var tree = {
      nameBytes: nb('GAMES'),
      files: [{ nameBytes: nb('PONG'), cbmTypeIdx: 2, payload: new Uint8Array(16), size: 16 }],
      subdirs: [], skippedLnks: [],
    };
    var res = cbmPasteDirTree(ctx, tree, { onConflict: 'cancel' });
    assert.strictEqual(res.ok, true, 'paste ok: ' + JSON.stringify(res));
    assert.strictEqual(res.copiedDirs, 1);
    assert.strictEqual(res.copiedFiles, 1);
    // Walk the D81 root dir, find a type-$05 partition entry pointing
    // at a 3-track partition starting at some startTrack.
    var dirInfo = parseCurrentDir(buf);
    var entries = (dirInfo && dirInfo.entries) || [];
    var gamesEntry = entries.find(function(e) {
      return petsciiToReadable(e.name || '').trim() === 'GAMES';
    });
    assert.ok(gamesEntry, 'GAMES partition entry in D81 root');
    // entry.type includes 'CBM' or 'CBM<' (read-only marker) — accept both
    assert.ok(/CBM/.test(gamesEntry.type), 'entry type is CBM partition: ' + gamesEntry.type);
    // partSize stored at +30/+31 of the dir entry
    var partSize = (new Uint8Array(buf))[gamesEntry.entryOff + 30] | ((new Uint8Array(buf))[gamesEntry.entryOff + 31] << 8);
    assert.ok(partSize >= 120, 'partition is at least 3 tracks (' + partSize + ' sectors)');
  });

  it('rejects non-linked formats from creating nested subdirs', () => {
    // Use a fresh D64 (no subdirLinked support) and try to paste a tree
    // with subdirs. The subdirs should land in skippedDirs.
    var buf = createEmptyDisk('d64', 35);
    global.currentBuffer = buf;
    global.currentFormat = DISK_FORMATS.d64;
    global.currentTracks = 35;
    global.currentPartition = null;
    var ctx = getCurrentCtx();
    function nb(s) {
      var out = new Uint8Array(16);
      for (var i = 0; i < 16; i++) out[i] = i < s.length ? s.charCodeAt(i) : 0xA0;
      return out;
    }
    var res = cbmPasteDirTree(ctx, {
      nameBytes: nb('SRC'),
      files: [{ nameBytes: nb('HI'), cbmTypeIdx: 2, payload: new Uint8Array(4), size: 4 }],
      subdirs: [{ nameBytes: nb('NESTED'), files: [], subdirs: [], skippedLnks: [] }],
      skippedLnks: [],
    }, { onConflict: 'cancel' });
    assert.strictEqual(res.ok, true);
    assert.strictEqual(res.copiedFiles, 1);
    assert.strictEqual(res.copiedDirs, 0);
    assert.strictEqual(res.skippedDirs.length, 1);
    assert.ok(res.skippedDirs[0].indexOf('NESTED') >= 0);
  });

  it('maps CFS-style ftype/typeSuffix to CBM-DOS typeIdx', () => {
    assert.strictEqual(cfsToCbmTypeIdx(2, 'REL'), 4);   // CFS REL → CBM REL
    assert.strictEqual(cfsToCbmTypeIdx(1, 'PRG'), 2);   // NORMAL+PRG → PRG
    assert.strictEqual(cfsToCbmTypeIdx(1, 'SEQ'), 1);   // NORMAL+SEQ → SEQ
    assert.strictEqual(cfsToCbmTypeIdx(1, 'USR'), 3);   // NORMAL+USR → USR
    assert.strictEqual(cfsToCbmTypeIdx(1, 'TXT'), 2);   // unknown suffix → PRG default
  });
});

describe('cbmCollectDirTree (task #11 — CBM-DOS reader)', () => {
  beforeEach(() => { resetGlobals(); });

  function nb(s) {
    var out = new Uint8Array(16);
    for (var i = 0; i < 16; i++) out[i] = i < s.length ? s.charCodeAt(i) : 0xA0;
    return out;
  }

  it('collects flat files from a DNP root', () => {
    var buf = createEmptyDisk('dnp', 81);
    global.currentBuffer = buf;
    global.currentFormat = DISK_FORMATS.dnp;
    global.currentTracks = 81;
    global.currentPartition = null;
    var ctx = getCurrentCtx();
    // Paste two files first (flat — at root, not under a wrapper),
    // then collect them back.
    cbmPasteDirTree(ctx, {
      nameBytes: nb('SRC'),
      files: [
        { nameBytes: nb('ALPHA'), cbmTypeIdx: 2, payload: new Uint8Array([1, 2, 3, 4]), size: 4 },
        { nameBytes: nb('BETA'),  cbmTypeIdx: 1, payload: new Uint8Array(300), size: 300 },
      ],
      subdirs: [], skippedLnks: [],
    }, { onConflict: 'cancel', flat: true });
    var coll = cbmCollectDirTree(ctx);
    assert.strictEqual(coll.ok, true);
    assert.strictEqual(coll.tree.files.length, 2);
    assert.strictEqual(coll.tree.subdirs.length, 0);
    // File order matches dir-entry order; verify type + size
    var names = coll.tree.files.map(function(f) { return petsciiToReadable(readPetsciiString(f.nameBytes, 0, 16)).trim(); });
    assert.ok(names.indexOf('ALPHA') >= 0);
    assert.ok(names.indexOf('BETA')  >= 0);
    var alpha = coll.tree.files.find(function(f) { return petsciiToReadable(readPetsciiString(f.nameBytes, 0, 16)).trim() === 'ALPHA'; });
    assert.strictEqual(alpha.cbmTypeIdx, 2); // PRG
    assert.strictEqual(alpha.size, 4);
    assert.deepStrictEqual(Array.from(alpha.payload), [1, 2, 3, 4]);
  });

  it('round-trips a DNP tree with nested subdirs through collect + paste', () => {
    // Build a small tree on disk A, collect it, paste into disk B,
    // verify disk B's collect output matches.
    var bufA = createEmptyDisk('dnp', 81);
    global.currentBuffer = bufA;
    global.currentFormat = DISK_FORMATS.dnp;
    global.currentTracks = 81;
    global.currentPartition = null;
    var ctxA = getCurrentCtx();
    // flat:true so the top-level files+subdirs land at the DNP root
    cbmPasteDirTree(ctxA, {
      nameBytes: nb('SRC'),
      files: [{ nameBytes: nb('FILE1'), cbmTypeIdx: 2, payload: new Uint8Array([0xAA]), size: 1 }],
      subdirs: [
        {
          nameBytes: nb('GAMES'),
          files: [{ nameBytes: nb('PONG'), cbmTypeIdx: 2, payload: new Uint8Array(8), size: 8 }],
          subdirs: [], skippedLnks: [],
        },
      ],
      skippedLnks: [],
    }, { onConflict: 'cancel', flat: true });

    var coll = cbmCollectDirTree(ctxA);
    assert.strictEqual(coll.ok, true);
    assert.strictEqual(coll.tree.files.length, 1);
    assert.strictEqual(coll.tree.subdirs.length, 1);
    assert.strictEqual(coll.tree.subdirs[0].files.length, 1);

    // Paste into a fresh DNP, flat again so we can compare collector
    // output against the source structure without an extra wrapper.
    var bufB = createEmptyDisk('dnp', 81);
    global.currentBuffer = bufB;
    global.currentFormat = DISK_FORMATS.dnp;
    global.currentTracks = 81;
    global.currentPartition = null;
    var ctxB = getCurrentCtx();
    var res = cbmPasteDirTree(ctxB, coll.tree, { onConflict: 'cancel', flat: true });
    assert.strictEqual(res.ok, true);
    assert.strictEqual(res.copiedFiles, 2);
    assert.strictEqual(res.copiedDirs, 1);

    // Collect from B and confirm same shape
    var collB = cbmCollectDirTree(ctxB);
    assert.strictEqual(collB.tree.files.length, 1);
    assert.strictEqual(collB.tree.subdirs.length, 1);
    assert.strictEqual(collB.tree.subdirs[0].files.length, 1);
  });

  it('maps CBM-DOS typeIdx onto CFS ftype + typeSuffix (cross-family)', () => {
    var rel = cbmToCfsTypeFields(4);
    assert.strictEqual(rel.typeSuffix, 'REL');
    assert.strictEqual(rel.ftype, 2); // CFS_FTYPE.REL
    var seq = cbmToCfsTypeFields(1);
    assert.strictEqual(seq.typeSuffix, 'SEQ');
    assert.strictEqual(seq.ftype, 1); // CFS_FTYPE.NORMAL
    var prg = cbmToCfsTypeFields(2);
    assert.strictEqual(prg.typeSuffix, 'PRG');
    var usr = cbmToCfsTypeFields(3);
    assert.strictEqual(usr.typeSuffix, 'USR');
    // resolveFileCfsTypeFields prefers source-set CFS fields when both present
    var withCfs = resolveFileCfsTypeFields({ ftype: 2, typeSuffix: 'REL', cbmTypeIdx: 1 });
    assert.strictEqual(withCfs.typeSuffix, 'REL'); // source CFS wins
    var withCbm = resolveFileCfsTypeFields({ cbmTypeIdx: 3 });
    assert.strictEqual(withCbm.typeSuffix, 'USR'); // CBM-only collector → USR
    var untyped = resolveFileCfsTypeFields({});
    assert.strictEqual(untyped.typeSuffix, 'PRG'); // safe default
  });

  it('cbmEstimateTreeSectors + cbmCountFreeSectors gate the pre-check', () => {
    function nbLocal(s) {
      var out = new Uint8Array(16);
      for (var i = 0; i < 16; i++) out[i] = i < s.length ? s.charCodeAt(i) : 0xA0;
      return out;
    }
    var buf = createEmptyDisk('dnp', 81);
    global.currentBuffer = buf;
    global.currentFormat = DISK_FORMATS.dnp;
    global.currentTracks = 81;
    global.currentPartition = null;
    var ctx = getCurrentCtx();
    var fresh = cbmCountFreeSectors(ctx);
    assert.ok(fresh > 100, 'fresh DNP has plenty of free sectors (got ' + fresh + ')');
    var tinyTree = {
      nameBytes: nbLocal('TINY'),
      files: [
        { nameBytes: nbLocal('A'), cbmTypeIdx: 2, payload: new Uint8Array(100), size: 100 },
        { nameBytes: nbLocal('B'), cbmTypeIdx: 1, payload: new Uint8Array(500), size: 500 },
      ],
      subdirs: [{ nameBytes: nbLocal('S'), files: [], subdirs: [], skippedLnks: [] }],
      skippedLnks: [],
    };
    var est = cbmEstimateTreeSectors(tinyTree, DISK_FORMATS.dnp);
    // ceil(100/254)=1 + ceil(500/254)=2 + subdir 2 + dir-margin 1 = 6 at minimum
    assert.ok(est >= 6, 'tree estimate at least 6 sectors (got ' + est + ')');
    assert.ok(fresh > est, 'fresh DNP can hold the tiny tree');
  });

  it('cross-family: CFS tree pastes into a DNP with type translation', () => {
    // Build a CFS subdir with files of every CBM type (SEQ / PRG / USR / REL)
    var hdd = createEmptyHdd(4);
    var info = readIde64Partitions(hdd);
    var p = info.partitions[0];
    var rootLba = p.cfsRootDir.addr;
    var games = cfsCreateSubdir(hdd, p.startLba, p.endLba, rootLba, 'GAMES');
    cfsImportFile(hdd, p.startLba, p.endLba, games.newDirLba, 'AS_PRG', new Uint8Array([0x01, 0x08]), { ftype: CFS_FTYPE.NORMAL, typeSuffix: 'PRG' });
    cfsImportFile(hdd, p.startLba, p.endLba, games.newDirLba, 'AS_SEQ', new Uint8Array(50),  { ftype: CFS_FTYPE.NORMAL, typeSuffix: 'SEQ' });
    cfsImportFile(hdd, p.startLba, p.endLba, games.newDirLba, 'AS_USR', new Uint8Array(50),  { ftype: CFS_FTYPE.NORMAL, typeSuffix: 'USR' });
    cfsImportFile(hdd, p.startLba, p.endLba, games.newDirLba, 'AS_REL', new Uint8Array(50),  { ftype: CFS_FTYPE.REL,    typeSuffix: 'REL' });
    // Read GAMES nameBytes off disk
    var d = new Uint8Array(hdd);
    var rootEntries = readCfsDirectory(hdd, rootLba);
    var gamesEntry = rootEntries.find(function(e) {
      return !e.empty && !e.isSelfRef && e.ftype === CFS_FTYPE.DIR && e.dataTreePtr && e.dataTreePtr.addr === games.newDirLba;
    });
    var nameOff = gamesEntry.dirLba * 512 + gamesEntry.index * 32;
    var gamesNameBytes = new Uint8Array(16);
    for (var i = 0; i < 16; i++) gamesNameBytes[i] = d[nameOff + i];

    var coll = cfsCollectDirTree(hdd, games.newDirLba, gamesNameBytes);
    assert.strictEqual(coll.ok, true);
    assert.strictEqual(coll.tree.files.length, 4);

    // Paste into a fresh DNP
    var dnp = createEmptyDisk('dnp', 81);
    global.currentBuffer = dnp;
    global.currentFormat = DISK_FORMATS.dnp;
    global.currentTracks = 81;
    global.currentPartition = null;
    var ctx = getCurrentCtx();
    var res = cbmPasteDirTree(ctx, coll.tree, { onConflict: 'cancel' });
    assert.strictEqual(res.ok, true);
    assert.strictEqual(res.copiedDirs, 1);  // GAMES
    assert.strictEqual(res.copiedFiles, 4); // all four types

    // Verify GAMES + each file via cbmCollectDirTree (avoids
    // parseDnpDirectory which isn't loaded by test-helper).
    var dnpColl = cbmCollectDirTree(ctx);
    function nameOf(bytes) {
      var n = '';
      for (var i = 0; i < 16; i++) { var b = bytes[i]; if (b === 0xA0 || b === 0) break; n += String.fromCharCode(b); }
      return n.replace(/ +$/, '');
    }
    var subs = dnpColl.tree.subdirs.map(function(s) { return nameOf(s.nameBytes); });
    assert.ok(subs.indexOf('GAMES') >= 0, 'GAMES subdir created on DNP');
    var gamesSub = dnpColl.tree.subdirs.find(function(s) { return nameOf(s.nameBytes) === 'GAMES'; });
    assert.strictEqual(gamesSub.files.length, 4);
    var byName = {};
    for (var fi = 0; fi < gamesSub.files.length; fi++) {
      byName[nameOf(gamesSub.files[fi].nameBytes)] = gamesSub.files[fi].cbmTypeIdx;
    }
    assert.strictEqual(byName.AS_PRG, 2);
    assert.strictEqual(byName.AS_SEQ, 1);
    assert.strictEqual(byName.AS_USR, 3);
    assert.strictEqual(byName.AS_REL, 4);
  });

  it('cross-family: DNP tree pastes into a CFS partition with type translation', () => {
    function nbLocal(s) {
      var out = new Uint8Array(16);
      for (var i = 0; i < 16; i++) out[i] = i < s.length ? s.charCodeAt(i) : 0xA0;
      return out;
    }
    // Build a small DNP tree with each CBM file type
    var dnp = createEmptyDisk('dnp', 81);
    global.currentBuffer = dnp;
    global.currentFormat = DISK_FORMATS.dnp;
    global.currentTracks = 81;
    global.currentPartition = null;
    var dnpCtx = getCurrentCtx();
    // flat:true so the four files land at the DNP root (no SRC wrapper)
    cbmPasteDirTree(dnpCtx, {
      nameBytes: nbLocal('SRC'),
      files: [
        { nameBytes: nbLocal('AS_PRG'), cbmTypeIdx: 2, payload: new Uint8Array([0x01, 0x08, 0xAA]), size: 3 },
        { nameBytes: nbLocal('AS_SEQ'), cbmTypeIdx: 1, payload: new Uint8Array(50), size: 50 },
        { nameBytes: nbLocal('AS_USR'), cbmTypeIdx: 3, payload: new Uint8Array(50), size: 50 },
        { nameBytes: nbLocal('AS_REL'), cbmTypeIdx: 4, payload: new Uint8Array(50), size: 50 },
      ],
      subdirs: [], skippedLnks: [],
    }, { onConflict: 'cancel', flat: true });
    var dnpColl = cbmCollectDirTree(dnpCtx, nbLocal('SRC'));
    assert.strictEqual(dnpColl.ok, true);
    assert.strictEqual(dnpColl.tree.files.length, 4);

    // Wrap the four files in an outer subdir for the CFS paste
    var wrappedTree = {
      nameBytes: nbLocal('WRAP'),
      files: dnpColl.tree.files,
      subdirs: [],
      skippedLnks: [],
    };

    // Paste into a fresh CFS partition
    var hdd = createEmptyHdd(4);
    var hddInfo = readIde64Partitions(hdd);
    var p = hddInfo.partitions[0];
    var res = cfsPasteDirTree(hdd, p.startLba, p.endLba, p.cfsRootDir.addr, wrappedTree, { onConflict: 'cancel' });
    assert.strictEqual(res.ok, true);
    assert.strictEqual(res.copiedDirs, 1);
    assert.strictEqual(res.copiedFiles, 4);

    // Find WRAP subdir in CFS root and verify each file's CFS typeSuffix
    var rootEntries = readCfsDirectory(hdd, p.cfsRootDir.addr);
    var wrapEntry = rootEntries.find(function(e) {
      return !e.empty && !e.isSelfRef && e.ftype === CFS_FTYPE.DIR && e.dataTreePtr && e.dataTreePtr.addr !== p.cfsDeletedDir.addr;
    });
    assert.ok(wrapEntry, 'WRAP subdir created in CFS root');
    var children = readCfsDirectory(hdd, wrapEntry.dataTreePtr.addr).filter(function(e) { return !e.empty && !e.isSelfRef; });
    var bySuffix = {};
    for (var ci = 0; ci < children.length; ci++) {
      bySuffix[petsciiToReadable(children[ci].name).trim()] = children[ci].typeSuffix;
    }
    assert.strictEqual(bySuffix.AS_PRG, 'PRG');
    assert.strictEqual(bySuffix.AS_SEQ, 'SEQ');
    assert.strictEqual(bySuffix.AS_USR, 'USR');
    assert.strictEqual(bySuffix.AS_REL, 'REL');
  });

  it('captures GEOS metadata when a GEOS file is present', () => {
    // Build a fresh GEOS disk + write a sequential GEOS file via the
    // writer (it sets up the info block + the geosBytes correctly).
    var buf = createEmptyDisk('d64', 35);
    global.currentBuffer = buf;
    global.currentFormat = DISK_FORMATS.d64;
    global.currentTracks = 35;
    global.currentPartition = null;
    writeGeosSignature(buf, getCurrentCtx());
    var ctx = getCurrentCtx();
    var nameBytes = nb('GEOFILE');
    var geosBytes = new Uint8Array(9);
    geosBytes[0] = 0;   // info block T (set later by writer when present)
    geosBytes[1] = 0;
    geosBytes[2] = 0x01; // structure: sequential
    geosBytes[3] = 0x83; // file type — arbitrary geos file type
    var infoBlock = new Uint8Array(256);
    infoBlock[0] = 0x00;
    infoBlock[1] = 0xFF;
    for (var i = 2; i < 256; i++) infoBlock[i] = (i + 0x42) & 0xFF;
    var ok = writeFileToDisk(2, nameBytes, new Uint8Array([1, 2, 3, 4]), { geosBytes: geosBytes, geosInfoBlock: infoBlock }, true, ctx);
    assert.strictEqual(ok, true, 'GEOS write should succeed');
    var coll = cbmCollectDirTree(ctx);
    var geoFile = coll.tree.files.find(function(f) { return petsciiToReadable(readPetsciiString(f.nameBytes, 0, 16)).trim() === 'GEOFILE'; });
    assert.ok(geoFile, 'GEOFILE collected');
    assert.ok(geoFile.geosBytes, 'geosBytes captured');
    assert.strictEqual(geoFile.geosBytes[2], 0x01, 'structure byte preserved');
    assert.ok(geoFile.geosInfoBlock, 'geosInfoBlock captured');
    assert.strictEqual(geoFile.geosInfoBlock.length, 256);
  });
});
