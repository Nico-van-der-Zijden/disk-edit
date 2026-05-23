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

  it('reports subdirs in skippedDirs (MVP — subdir creation not yet implemented)', () => {
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
        { nameBytes: nb('GAMES'), files: [], subdirs: [], skippedLnks: [] },
        { nameBytes: nb('ART'),   files: [], subdirs: [], skippedLnks: [] },
      ],
      skippedLnks: [],
    };
    var res = cbmPasteDirTree(ctx, tree, { onConflict: 'cancel' });
    assert.strictEqual(res.ok, true);
    assert.strictEqual(res.copiedFiles, 1);
    assert.strictEqual(res.skippedDirs.length, 2);
    assert.ok(res.skippedDirs.indexOf('GAMES') >= 0);
    assert.ok(res.skippedDirs.indexOf('ART') >= 0);
  });

  it('maps CFS-style ftype/typeSuffix to CBM-DOS typeIdx', () => {
    assert.strictEqual(cfsToCbmTypeIdx(2, 'REL'), 4);   // CFS REL → CBM REL
    assert.strictEqual(cfsToCbmTypeIdx(1, 'PRG'), 2);   // NORMAL+PRG → PRG
    assert.strictEqual(cfsToCbmTypeIdx(1, 'SEQ'), 1);   // NORMAL+SEQ → SEQ
    assert.strictEqual(cfsToCbmTypeIdx(1, 'USR'), 3);   // NORMAL+USR → USR
    assert.strictEqual(cfsToCbmTypeIdx(1, 'TXT'), 2);   // unknown suffix → PRG default
  });
});
