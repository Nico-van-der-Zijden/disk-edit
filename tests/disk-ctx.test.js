// Tests for the DiskCtx refactor groundwork in cbm-editor.js.
// Phase 1: getCurrentCtx() snapshots globals; withDiskCtx() swaps + restores.
const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert');
const { resetGlobals } = require('./test-helper');

describe('DiskCtx — phase 1 (foundation)', () => {
  beforeEach(() => {
    resetGlobals();
    // dirInterleave / fileInterleave are not reset by resetGlobals; pin to defaults.
    dirInterleave = 3;
    fileInterleave = 10;
  });

  describe('getCurrentCtx', () => {
    it('captures all six fields from globals when nothing is loaded', () => {
      var ctx = getCurrentCtx();
      assert.strictEqual(ctx.buffer, null);
      assert.strictEqual(ctx.partition, null);
      assert.strictEqual(ctx.format, null);
      assert.strictEqual(ctx.tracks, 0);
      assert.strictEqual(ctx.dirInterleave, 3);
      assert.strictEqual(ctx.fileInterleave, 10);
    });

    it('captures current globals when a disk is set', () => {
      var fakeBuf = new ArrayBuffer(256);
      currentBuffer = fakeBuf;
      currentTracks = 35;
      currentPartition = { name: 'P1' };
      dirInterleave = 5;
      var ctx = getCurrentCtx();
      assert.strictEqual(ctx.buffer, fakeBuf);
      assert.strictEqual(ctx.tracks, 35);
      assert.deepStrictEqual(ctx.partition, { name: 'P1' });
      assert.strictEqual(ctx.dirInterleave, 5);
    });
  });

  describe('withDiskCtx', () => {
    it('swaps globals for the duration of fn and restores them after', () => {
      currentBuffer = new ArrayBuffer(128);
      currentTracks = 35;
      var savedBuffer = currentBuffer;
      var newBuffer = new ArrayBuffer(256);
      var observed = null;
      withDiskCtx({
        buffer: newBuffer, partition: { name: 'OTHER' }, format: null,
        tracks: 80, dirInterleave: 1, fileInterleave: 1,
      }, function() {
        observed = { buffer: currentBuffer, tracks: currentTracks };
      });
      assert.strictEqual(observed.buffer, newBuffer);
      assert.strictEqual(observed.tracks, 80);
      // Restored afterward
      assert.strictEqual(currentBuffer, savedBuffer);
      assert.strictEqual(currentTracks, 35);
    });

    it('restores globals even if fn throws', () => {
      currentBuffer = new ArrayBuffer(64);
      currentTracks = 35;
      var savedBuffer = currentBuffer;
      assert.throws(function() {
        withDiskCtx({
          buffer: new ArrayBuffer(128), partition: null, format: null,
          tracks: 80, dirInterleave: 3, fileInterleave: 10,
        }, function() {
          throw new Error('boom');
        });
      }, /boom/);
      // Globals are back to their pre-call values
      assert.strictEqual(currentBuffer, savedBuffer);
      assert.strictEqual(currentTracks, 35);
    });

    it('returns the value fn returned', () => {
      var ret = withDiskCtx(getCurrentCtx(), function() { return 42; });
      assert.strictEqual(ret, 42);
    });

    it('round-trips a current ctx (snapshot, swap, snapshot equal)', () => {
      currentBuffer = new ArrayBuffer(512);
      currentPartition = { dnpDir: true, dnpHeaderT: 1, dnpHeaderS: 0, dnpDirT: 1, dnpDirS: 1, name: 'X' };
      currentTracks = 80;
      dirInterleave = 3;
      fileInterleave = 10;
      var snapshot = getCurrentCtx();
      // withDiskCtx using the same snapshot must not change globals
      withDiskCtx(snapshot, function() {
        // mid-fn observed state matches the snapshot
        assert.strictEqual(currentBuffer, snapshot.buffer);
        assert.deepStrictEqual(currentPartition, snapshot.partition);
        assert.strictEqual(currentTracks, snapshot.tracks);
      });
      // and after the call too
      var after = getCurrentCtx();
      assert.strictEqual(after.buffer, snapshot.buffer);
      assert.deepStrictEqual(after.partition, snapshot.partition);
      assert.strictEqual(after.tracks, snapshot.tracks);
    });
  });
});
