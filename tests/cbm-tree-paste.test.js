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
    var res = cbmPasteDirTree(ctx, tree, { onConflict: 'cancel' });
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
    cbmPasteDirTree(ctx, tree, { onConflict: 'cancel' });
    // Second paste — should refuse on the first conflict
    var res = cbmPasteDirTree(ctx, tree, { onConflict: 'cancel' });
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
    // First, paste a small HELLO
    cbmPasteDirTree(ctx, {
      nameBytes: nb('X'), files: [{ nameBytes: nb('HELLO'), cbmTypeIdx: 2, payload: new Uint8Array(8), size: 8 }],
      subdirs: [], skippedLnks: [],
    }, { onConflict: 'cancel' });
    // Now overwrite with a bigger HELLO
    var bigger = new Uint8Array(500);
    for (var i = 0; i < 500; i++) bigger[i] = i & 0xFF;
    var res = cbmPasteDirTree(ctx, {
      nameBytes: nb('X'), files: [{ nameBytes: nb('HELLO'), cbmTypeIdx: 2, payload: bigger, size: 500 }],
      subdirs: [], skippedLnks: [],
    }, { onConflict: 'overwrite' });
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
    var res = cbmPasteDirTree(ctx, tree, { onConflict: 'cancel' });
    assert.strictEqual(res.ok, true);
    assert.strictEqual(res.copiedFiles, 2);   // FILE1 at root + PONG inside GAMES
    assert.strictEqual(res.copiedDirs, 2);    // GAMES + ART
    assert.strictEqual(res.skippedDirs.length, 0);
    // Verify GAMES and ART entries exist in the root dir
    var dirInfo = parseCurrentDir(buf);
    var entries = (dirInfo && dirInfo.entries) || [];
    var dirNames = entries.map(function(e) { return petsciiToReadable(e.name || '').trim(); });
    assert.ok(dirNames.indexOf('GAMES') >= 0, 'GAMES dir present: ' + JSON.stringify(dirNames));
    assert.ok(dirNames.indexOf('ART')   >= 0, 'ART dir present');
    assert.ok(dirNames.indexOf('FILE1') >= 0, 'FILE1 at root');
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
    // Paste two files first, then collect them back
    cbmPasteDirTree(ctx, {
      nameBytes: nb('SRC'),
      files: [
        { nameBytes: nb('ALPHA'), cbmTypeIdx: 2, payload: new Uint8Array([1, 2, 3, 4]), size: 4 },
        { nameBytes: nb('BETA'),  cbmTypeIdx: 1, payload: new Uint8Array(300), size: 300 },
      ],
      subdirs: [], skippedLnks: [],
    }, { onConflict: 'cancel' });
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
    }, { onConflict: 'cancel' });

    var coll = cbmCollectDirTree(ctxA);
    assert.strictEqual(coll.ok, true);
    assert.strictEqual(coll.tree.files.length, 1);
    assert.strictEqual(coll.tree.subdirs.length, 1);
    assert.strictEqual(coll.tree.subdirs[0].files.length, 1);

    // Paste into a fresh DNP
    var bufB = createEmptyDisk('dnp', 81);
    global.currentBuffer = bufB;
    global.currentFormat = DISK_FORMATS.dnp;
    global.currentTracks = 81;
    global.currentPartition = null;
    var ctxB = getCurrentCtx();
    var res = cbmPasteDirTree(ctxB, coll.tree, { onConflict: 'cancel' });
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

  it('captures GEOS metadata when a GEOS file is present', () => {
    // Build a fresh GEOS disk + write a sequential GEOS file via the
    // writer (it sets up the info block + the geosBytes correctly).
    var buf = createEmptyDisk('d64', 35);
    global.currentBuffer = buf;
    global.currentFormat = DISK_FORMATS.d64;
    global.currentTracks = 35;
    global.currentPartition = null;
    writeGeosSignature(buf);
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
