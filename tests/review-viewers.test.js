// Tests for viewer/export decode fixes: BASIC token tables and dialects,
// screen-code → PETSCII chart mapping, geoWrite page parsing/HTML, TASS
// short padding runs and expression depth, graphics parser bounds, export
// name helpers.
const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
require('./test-helper');

// Files test-helper doesn't load. They only touch the DOM through the
// helper's stubs at load time.
function loadExtra(relPath) {
  var src = fs.readFileSync(path.join(__dirname, '..', relPath), 'utf8')
    .replace(/^const /gm, 'var ')
    .replace(/^let /gm, 'var ');
  vm.runInThisContext(src, { filename: relPath });
}
if (typeof global.fileInput === 'undefined') global.fileInput = document.getElementById('file-input');
loadExtra('assets/js/ui/cbm-petscii.js');
loadExtra('assets/js/ui/viewers/ui-tass-viewer.js');
loadExtra('assets/js/ui/ui-export.js');

// One BASIC line at `addr` holding `body` bytes, followed by the end link.
function basicPrg(addr, body) {
  var out = [addr & 0xFF, addr >> 8, 0x01, 0x01, 0x0A, 0x00].concat(body, [0x00, 0x00, 0x00]);
  return new Uint8Array(out);
}
function keywords(res) {
  return res.lines[0].parts.filter(function(p) { return p.type === 'keyword'; }).map(function(p) { return p.text; });
}

describe('BASIC detokenizer', () => {
  it('BASIC 3.5 $E3-$E5 are GSHAPE, SSHAPE, DRAW', () => {
    var res = detokenizeBasic(basicPrg(0x1001, [0xE3, 0x3A, 0xE4, 0x3A, 0xE5]));
    assert.strictEqual(res.version, 'V35');
    assert.deepStrictEqual(keywords(res), ['GSHAPE', 'SSHAPE', 'DRAW']);
  });

  it('plain V2 has no extended tokens (no Simons\' fallback)', () => {
    var res = detokenizeBasic(basicPrg(0x0801, [0xCC]));
    assert.strictEqual(res.version, 'V2');
    assert.deepStrictEqual(keywords(res), []);
    assert.strictEqual(res.lines[0].parts.length, 1);
  });

  it('Simons\' dialect still maps when picked explicitly', () => {
    var res = detokenizeBasic(basicPrg(0x0801, [0xCC]), 'SIMONS');
    assert.deepStrictEqual(keywords(res), ['HIRES']);
  });

  it('VIC-20 load addresses map to V2; $1001 stays V3.5 but is flagged ambiguous', () => {
    assert.strictEqual(BASIC_LOAD_ADDRS[0x0401], 'V2');
    assert.strictEqual(BASIC_LOAD_ADDRS[0x1201], 'V2');
    assert.strictEqual(BASIC_LOAD_ADDRS[0x1001], 'V35');
    assert.strictEqual(BASIC_AMBIGUOUS_ADDR, 0x1001);
  });

  it('control codes inside strings are flagged reversed', () => {
    var res = detokenizeBasic(basicPrg(0x0801, [0x99, 0x22, 0x93, 0x41, 0x22]));
    var str = res.lines[0].parts.filter(function(p) { return p.type === 'string' && p.reversed !== undefined; });
    assert.strictEqual(str[0].reversed, true);  // $93
    assert.strictEqual(str[1].reversed, false); // $41
  });
});

describe('PETSCII chart screen-code mapping', () => {
  it('reversed graphics A ($C0-$DF) maps to the reversed bytes $80-$9F', () => {
    assert.strictEqual(_chartScToPetscii(0xC0), 0x80);
    assert.strictEqual(_chartScToPetscii(0xDF), 0x9F);
    // Same glyph as the chart cell, and the byte renders reversed
    for (var sc = 0xC0; sc <= 0xDF; sc++) {
      var p = _chartScToPetscii(sc);
      assert.strictEqual(PETSCII_MAP[p], SCREENCODE_MAP[sc].char);
      assert.strictEqual(isPetsciiReversed(p), true);
    }
  });
});

describe('geoWrite page parser', () => {
  // NEWCARDSET font word = (3 << 5) | 10 under the current split.
  var fontWord = (3 << 5) | 10;
  var rec = new Uint8Array([
    0x17, fontWord & 0xFF, fontWord >> 8, 0x40,     // Roma-ish 10pt bold
    0x41, 0x26, 0x42,                                // A&B
    0x09,                                            // tab
    0x0D,                                            // CR
    0x10, 0x02, 0x10, 0x00, 0x41,                    // image ref, record 65 (missing)
    0x00
  ]);

  it('produces styled text, tab, cr and image elements', () => {
    var els = parseGeoWritePage(rec, {});
    assert.deepStrictEqual(els.map(function(e) { return e.type; }), ['text', 'tab', 'cr', 'image']);
    assert.strictEqual(els[0].text, 'A&B');
    assert.strictEqual(els[0].fontId, 3);
    assert.strictEqual(els[0].fontSize, 10);
    assert.strictEqual(els[0].bold, true);
    assert.strictEqual(els[1].styleSeq, els[0].styleSeq);
    assert.deepStrictEqual([els[3].record, els[3].w, els[3].h, els[3].missing], [0x41, 16, 16, true]);
  });

  it('HTML keeps font-size/bold in the same style attribute as the font stack', () => {
    var html = geoWritePageToHtml(parseGeoWritePage(rec, {}), {});
    var m = html.match(/<span style="([^"]*)">A&amp;B/);
    assert.ok(m, html);
    assert.match(m[1], /font-family:'Times New Roman'/);
    assert.match(m[1], /font-size:\d+px/);
    assert.match(m[1], /font-weight:bold/);
    assert.match(html, /\[Image: record 65, 16x16\]/);
  });

  it('every GEOS font CSS stack is safe inside a double-quoted attribute', () => {
    Object.keys(GEOS_FONTS).forEach(function(k) {
      assert.ok(GEOS_FONTS[k].css.indexOf('"') < 0, 'font ' + k);
    });
  });
});

describe('TASS tokenizer', () => {
  it('decodes a lone `and $d011` ($2D) instead of dropping it as padding', () => {
    var data = new Uint8Array([0x2D, 0x29, 0x11, 0xD0]);
    var lines = tassTokenizeBlock(data, 0, data.length, []);
    var ands = lines.filter(function(l) { return l.instr === 'and'; });
    assert.strictEqual(ands.length, 1);
    assert.strictEqual(ands[0].operand.toLowerCase(), '$d011');
  });

  it('still turns a 30+ byte rule run into a separator comment', () => {
    var data = new Uint8Array(40).fill(0x2D);
    var lines = tassTokenizeBlock(data, 0, data.length, []);
    assert.strictEqual(lines.length, 1);
    assert.strictEqual(lines[0].isTextBlock, true);
  });

  it('a long run of open parens does not blow the stack', () => {
    var data = new Uint8Array(50000).fill(0x4A);
    var v = tassDecodeValue(data, 0, data.length, []);
    assert.ok(v.n > 0);
  });
});

describe('Graphics parsers stay in bounds for their exact sizes', () => {
  it('no parser returns an undefined background', () => {
    GFX_FORMATS.forEach(function(f) {
      var d = new Uint8Array(f.size);
      d[0] = f.addr & 0xFF; d[1] = f.addr >> 8;
      var g = GFX_PARSERS[f.layout](d);
      if ('bg' in g) assert.strictEqual(typeof g.bg, 'number', f.name);
    });
  });
});

describe('Export helpers', () => {
  it('safeHostFileName strips illegal and control characters, with fallback', () => {
    assert.strictEqual(safeHostFileName('A/B:C\x01', 'x'), 'A_B_C_');
    assert.strictEqual(safeHostFileName('', 'disk'), 'disk');
  });

  it('petsciiChangeCase flips only letters', () => {
    assert.strictEqual(petsciiChangeCase(0x41, 'upper'), 0xC1);
    assert.strictEqual(petsciiChangeCase(0xDA, 'lower'), 0x5A);
    assert.strictEqual(petsciiChangeCase(0xC1, 'upper'), 0xC1);
    assert.strictEqual(petsciiChangeCase(0x5A, 'toggle'), 0xDA);
    assert.strictEqual(petsciiChangeCase(0xDA, 'toggle'), 0x5A);
    assert.strictEqual(petsciiChangeCase(0x30, 'toggle'), 0x30);
  });
});
