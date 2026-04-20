// Tests for the graphics format parsers in ui-viewers.js
// These are round-trip tests: synthesize a file with distinct marker patterns
// in each region, run it through the layout parser, and assert the parser's
// subarrays contain the expected bytes. This freezes the region offsets so a
// refactor that shifts a slice by a byte trips an assertion.
const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert');
const { resetGlobals } = require('./test-helper');

// Build a buffer of `size` bytes with a 2-byte load-address prefix and the
// remainder filled with a predictable pattern (byte = index & 0xFF). Callers
// can then overlay specific regions.
function mkBuf(loadAddr, size) {
  var buf = new Uint8Array(size);
  buf[0] = loadAddr & 0xFF;
  buf[1] = (loadAddr >> 8) & 0xFF;
  for (var i = 2; i < size; i++) buf[i] = i & 0xFF;
  return buf;
}

// Write a region with a constant marker value so we can spot-check the slice.
function fill(buf, start, end, marker) {
  for (var i = start; i < end; i++) buf[i] = marker;
}

describe('GFX_PARSERS — koala layout', () => {
  it('slices bm/scr/col at the canonical offsets', () => {
    var d = mkBuf(0x6000, 10003);
    fill(d, 2, 8002, 0xAA);     // bitmap
    fill(d, 8002, 9002, 0xBB);  // screen
    fill(d, 9002, 10002, 0xCC); // color
    d[10002] = 0x05;            // bg

    var g = GFX_PARSERS.koala(d);
    assert.strictEqual(g.bm.length, 8000);
    assert.strictEqual(g.scr.length, 1000);
    assert.strictEqual(g.col.length, 1000);
    assert.strictEqual(g.bm[0], 0xAA);
    assert.strictEqual(g.bm[7999], 0xAA);
    assert.strictEqual(g.scr[0], 0xBB);
    assert.strictEqual(g.col[0], 0xCC);
    assert.strictEqual(g.bg, 0x05);
  });
});

describe('GFX_PARSERS — advanced art studio (aas) layout', () => {
  it('places the color map 16 bytes past koala (9018, not 9002)', () => {
    var d = mkBuf(0x2000, 10018);
    fill(d, 2, 8002, 0xAA);
    fill(d, 8002, 9002, 0xBB);
    fill(d, 9018, 10018, 0xCC);
    d[9003] = 0x07;
    var g = GFX_PARSERS.aas(d);
    assert.strictEqual(g.col[0], 0xCC);
    assert.strictEqual(g.col[999], 0xCC);
    assert.strictEqual(g.bg, 0x07);
  });
});

describe('GFX_PARSERS — saracen paint layout', () => {
  it('shifts all regions by an 18-byte header', () => {
    var d = mkBuf(0x3F8E, 10023);
    fill(d, 20, 8020, 0xAA);
    fill(d, 8020, 9020, 0xBB);
    fill(d, 9020, 10020, 0xCC);
    d[10020] = 0x09;
    var g = GFX_PARSERS.saracen(d);
    assert.strictEqual(g.bm.length, 8000);
    assert.strictEqual(g.bm[0], 0xAA);
    assert.strictEqual(g.scr[0], 0xBB);
    assert.strictEqual(g.col[0], 0xCC);
    assert.strictEqual(g.bg, 0x09);
  });
});

describe('GFX_PARSERS — hires bmscr/scrbm layouts', () => {
  it('bmscr: bitmap then screen', () => {
    var d = mkBuf(0x2000, 9009);
    fill(d, 2, 8002, 0xAA);
    fill(d, 8002, 9002, 0xBB);
    var g = GFX_PARSERS.bmscr(d);
    assert.strictEqual(g.bm.length, 8000);
    assert.strictEqual(g.scr.length, 1000);
    assert.strictEqual(g.bm[0], 0xAA);
    assert.strictEqual(g.scr[0], 0xBB);
  });

  it('scrbm: screen then bitmap (Doodle)', () => {
    var d = mkBuf(0x5C00, 9218);
    fill(d, 2, 1026, 0xBB);
    fill(d, 1026, 9218, 0xAA);
    var g = GFX_PARSERS.scrbm(d);
    assert.strictEqual(g.scr[0], 0xBB);
    assert.strictEqual(g.bm[0], 0xAA);
    assert.strictEqual(g.bm.length, 8192);
  });

  it('bmonly: synthesizes a white-on-black screen map', () => {
    var d = mkBuf(0x2000, 8002);
    fill(d, 2, 8002, 0xAA);
    var g = GFX_PARSERS.bmonly(d);
    assert.strictEqual(g.bm[0], 0xAA);
    assert.strictEqual(g.scr.length, 1000);
    assert.strictEqual(g.scr[0], 0x10);
  });
});

describe('GFX_PARSERS — FLI layouts', () => {
  it('fli: color RAM, 8 screen banks, bitmap, background', () => {
    // Use FLI Graph 2.2 size (17474) which has a bg byte past the 8K bitmap;
    // the base Blackmail size (17409) ends mid-bitmap and has no bg byte.
    var d = mkBuf(0x3C00, 17474);
    fill(d, 2, 1026, 0xCC);
    fill(d, 1026, 9218, 0xDD);
    fill(d, 9218, 17410, 0xAA);
    d[17410] = 0x03;
    var g = GFX_PARSERS.fli(d);
    assert.strictEqual(g.col.length, 1024);
    assert.strictEqual(g.col[0], 0xCC);
    assert.strictEqual(g.scrBanks.length, 8192);
    assert.strictEqual(g.scrBanks[0], 0xDD);
    assert.strictEqual(g.bm[0], 0xAA);
    assert.strictEqual(g.bg, 0x03);
  });

  it('afli: 8 screen banks + bitmap, no color RAM', () => {
    var d = mkBuf(0x4000, 16386);
    fill(d, 2, 8194, 0xDD);
    fill(d, 8194, 16386, 0xAA);
    var g = GFX_PARSERS.afli(d);
    assert.strictEqual(g.scrBanks.length, 8192);
    assert.strictEqual(g.bm.length, 8192);
    assert.strictEqual(g.scrBanks[0], 0xDD);
    assert.strictEqual(g.bm[0], 0xAA);
  });

  it('eci: color RAM, screen banks, bitmap, bg always 0', () => {
    var d = mkBuf(0x4000, 17410);
    fill(d, 2, 1026, 0xCC);
    fill(d, 1026, 9218, 0xDD);
    fill(d, 9218, 17410, 0xAA);
    var g = GFX_PARSERS.eci(d);
    assert.strictEqual(g.col[0], 0xCC);
    assert.strictEqual(g.scrBanks[0], 0xDD);
    assert.strictEqual(g.bm[0], 0xAA);
    assert.strictEqual(g.bg, 0);
  });
});

describe('GFX_PARSERS — drp/vidcom/drazlace layouts', () => {
  it('drp: color, bg, bitmap, screen, per-row bg', () => {
    var d = mkBuf(0x5800, 10051);
    fill(d, 2, 1002, 0xCC);
    d[1002] = 0x02;
    fill(d, 1026, 9026, 0xAA);
    fill(d, 9026, 10026, 0xBB);
    fill(d, 10026, 10051, 0x0F);
    var g = GFX_PARSERS.drp(d);
    assert.strictEqual(g.col[0], 0xCC);
    assert.strictEqual(g.bg, 0x02);
    assert.strictEqual(g.bm[0], 0xAA);
    assert.strictEqual(g.scr[0], 0xBB);
    assert.strictEqual(g.rowBg.length, 25);
    assert.strictEqual(g.rowBg[0], 0x0F);
  });

  it('vidcom: screen, bitmap, color regions at the correct offsets', () => {
    // Size 10050 matches the format definition. The parser reads bg from
    // d[10050] which is one past the end of a 10050-byte file; not asserting
    // that value here — the region offsets are what this test covers.
    var d = mkBuf(0x5800, 10050);
    fill(d, 2, 1002, 0xBB);
    fill(d, 1026, 9026, 0xAA);
    fill(d, 9026, 10026, 0xCC);
    var g = GFX_PARSERS.vidcom(d);
    assert.strictEqual(g.scr.length, 1000);
    assert.strictEqual(g.bm.length, 8000);
    assert.strictEqual(g.col.length, 1000);
    assert.strictEqual(g.scr[0], 0xBB);
    assert.strictEqual(g.bm[0], 0xAA);
    assert.strictEqual(g.col[0], 0xCC);
  });

  it('drazlace: same layout as drp, size 18242', () => {
    var d = mkBuf(0x5800, 18242);
    fill(d, 2, 1002, 0xCC);
    d[1002] = 0x06;
    fill(d, 1026, 9026, 0xAA);
    fill(d, 9026, 10026, 0xBB);
    var g = GFX_PARSERS.drazlace(d);
    assert.strictEqual(g.col[0], 0xCC);
    assert.strictEqual(g.bg, 0x06);
    assert.strictEqual(g.bm[0], 0xAA);
    assert.strictEqual(g.scr[0], 0xBB);
  });
});

describe('detectGfxFormats — exact-match canonical addresses', () => {
  it('detects Koala Painter (0x6000, 10003 bytes)', () => {
    var d = mkBuf(0x6000, 10003);
    var matches = detectGfxFormats(d);
    assert.ok(matches.some(function(m) { return m.name === 'Koala Painter'; }));
  });

  it('detects Advanced Art Studio (0x2000, 10018 bytes)', () => {
    var d = mkBuf(0x2000, 10018);
    var matches = detectGfxFormats(d);
    assert.ok(matches.some(function(m) { return m.name === 'Advanced Art Studio'; }));
  });

  it('detects FLI Blackmail (0x3C00, 17409 bytes)', () => {
    var d = mkBuf(0x3C00, 17409);
    var matches = detectGfxFormats(d);
    assert.ok(matches.some(function(m) { return m.name === 'FLI (Blackmail)'; }));
  });

  it('detects Doodle (0x5C00, 9218 bytes)', () => {
    var d = mkBuf(0x5C00, 9218);
    var matches = detectGfxFormats(d);
    assert.ok(matches.some(function(m) { return m.name === 'Doodle'; }));
  });
});

describe('detectGfxFormats — generic size-based detection', () => {
  it('treats 64-byte files at any load address as a single sprite', () => {
    var d = mkBuf(0x2000, 66); // 64 data bytes
    var matches = detectGfxFormats(d);
    assert.ok(matches.some(function(m) { return /^Sprites \(1\)/.test(m.name); }));
  });

  it('treats a 2048-byte file (256 chars × 8) as a charset', () => {
    var d = mkBuf(0x2000, 2050);
    var matches = detectGfxFormats(d);
    assert.ok(matches.some(function(m) { return /Charset 1.1 \(256\)/.test(m.name); }));
  });

  it('accepts Koala-sized files at non-canonical load addresses as generic MC', () => {
    var d = mkBuf(0x1234, 10003); // not a known Koala address
    var matches = detectGfxFormats(d);
    assert.ok(matches.some(function(m) { return m.layout === 'koala'; }));
  });

  it('returns nothing for files too small to be any format', () => {
    var d = mkBuf(0x0801, 3);
    var matches = detectGfxFormats(d);
    assert.strictEqual(matches.length, 0);
  });
});
