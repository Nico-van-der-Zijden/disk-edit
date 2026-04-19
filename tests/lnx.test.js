// Tests for LNX (Lynx) archive parsing
const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert');
const { resetGlobals } = require('./test-helper');

// Build a synthetic LNX archive from { name (str, <=16), type (char), data (Uint8Array) }
// entries. The header encodes the exact layout parseLnxArchive expects.
function buildLnx(entries) {
  function cr(s) { return s + '\r'; }

  // Pass 1: build the header (excluding header-blocks value) so we know its size.
  // The header-blocks value itself is part of the header, so we compute size first.
  function makeHeader(headerBlocks) {
    var h = '';
    h += cr(' USE LYNX XVII TO DISSOLVE THIS FILE');
    h += cr(' ' + headerBlocks + ' ');
    h += cr(' ' + entries.length + ' ');
    for (var i = 0; i < entries.length; i++) {
      var e = entries[i];
      // 16-byte filename padded with $A0
      var nb = new Uint8Array(16);
      for (var j = 0; j < 16; j++) nb[j] = j < e.name.length ? e.name.charCodeAt(j) : 0xA0;
      var nameStr = '';
      for (var k = 0; k < 16; k++) nameStr += String.fromCharCode(nb[k]);
      h += nameStr + '\r';
      var blocks = Math.ceil(e.data.length / 254);
      var lastBytes = e.data.length === 0 ? 1 : (e.data.length % 254) || 254;
      h += cr(' ' + blocks + ' ');
      h += cr(' ' + e.type + ' ');
      h += cr(' ' + lastBytes + ' ');
    }
    return h;
  }

  // Iterate to stabilize the header-blocks count (rare that two iterations differ).
  var headerBlocks = 1;
  var headerStr;
  for (var attempt = 0; attempt < 5; attempt++) {
    headerStr = makeHeader(headerBlocks);
    var hb = Math.ceil(headerStr.length / 254);
    if (hb === headerBlocks) break;
    headerBlocks = hb;
  }

  var totalLen = headerBlocks * 254;
  for (var ei = 0; ei < entries.length; ei++) {
    totalLen += Math.ceil(entries[ei].data.length / 254) * 254;
  }

  var buf = new Uint8Array(totalLen);
  for (var hi = 0; hi < headerStr.length; hi++) buf[hi] = headerStr.charCodeAt(hi);

  var off = headerBlocks * 254;
  for (var fi = 0; fi < entries.length; fi++) {
    var d = entries[fi].data;
    for (var di = 0; di < d.length; di++) buf[off + di] = d[di];
    off += Math.ceil(d.length / 254) * 254;
  }
  return buf.buffer;
}

describe('parseLnxArchive', () => {
  beforeEach(() => { resetGlobals(); });

  it('parses an archive with three files of different types', () => {
    var a = new Uint8Array([0x01, 0x02, 0x03]);
    var b = new Uint8Array(300); for (var i = 0; i < 300; i++) b[i] = i & 0xFF;
    var c = new Uint8Array([0x41, 0x42]);
    var buf = buildLnx([
      { name: 'HELLO', type: 'P', data: a },
      { name: 'BIGFILE', type: 'S', data: b },
      { name: 'C', type: 'U', data: c },
    ]);
    var result = parseLnxArchive(buf);
    assert.ok(!result.error, 'should parse without error: ' + result.error);
    assert.strictEqual(result.files.length, 3);
    assert.strictEqual(result.files[0].typeIdx, FILE_TYPE.PRG);
    assert.strictEqual(result.files[1].typeIdx, FILE_TYPE.SEQ);
    assert.strictEqual(result.files[2].typeIdx, FILE_TYPE.USR);
    assert.deepStrictEqual(Array.from(result.files[0].data), [0x01, 0x02, 0x03]);
    assert.strictEqual(result.files[1].data.length, 300);
    assert.deepStrictEqual(Array.from(result.files[2].data), [0x41, 0x42]);
  });

  it('preserves the 16-byte filename bytes exactly', () => {
    var buf = buildLnx([
      { name: 'NAME', type: 'P', data: new Uint8Array([0xFF]) },
    ]);
    var result = parseLnxArchive(buf);
    assert.strictEqual(result.files[0].name.length, 16);
    // 'NAME' + 12 $A0 padding bytes
    assert.strictEqual(result.files[0].name[0], 0x4E);
    assert.strictEqual(result.files[0].name[3], 0x45);
    assert.strictEqual(result.files[0].name[4], 0xA0);
    assert.strictEqual(result.files[0].name[15], 0xA0);
  });

  it('rejects buffers missing the LYNX signature', () => {
    var buf = new Uint8Array(512);
    for (var i = 0; i < 100; i++) buf[i] = 0x20; // nothing but spaces
    var result = parseLnxArchive(buf.buffer);
    assert.ok(result.error, 'should reject');
    assert.ok(/LYNX/.test(result.error), 'error mentions LYNX: ' + result.error);
  });

  it('rejects archives whose declared data runs past the buffer', () => {
    var buf = buildLnx([{ name: 'A', type: 'P', data: new Uint8Array(500) }]);
    // Keep only the header + half of the first file's data.
    var headerBlocks = Math.ceil(buf.byteLength / 254) - Math.ceil(500 / 254);
    var keep = headerBlocks * 254 + 100;
    var truncated = new Uint8Array(buf, 0, keep).slice().buffer;
    var result = parseLnxArchive(truncated);
    assert.ok(result.error, 'should reject truncated buffer: got ' + JSON.stringify(result).slice(0, 120));
  });

  it('skips an optional PRG load-address prefix', () => {
    var inner = buildLnx([{ name: 'X', type: 'P', data: new Uint8Array([0xAA]) }]);
    var innerArr = new Uint8Array(inner);
    var wrapped = new Uint8Array(innerArr.length + 2);
    wrapped[0] = 0x01; wrapped[1] = 0x08;
    wrapped.set(innerArr, 2);
    var result = parseLnxArchive(wrapped.buffer);
    assert.ok(!result.error, 'should parse PRG-wrapped archive: ' + result.error);
    assert.strictEqual(result.files.length, 1);
    assert.strictEqual(result.files[0].typeIdx, FILE_TYPE.PRG);
    assert.deepStrictEqual(Array.from(result.files[0].data), [0xAA]);
  });

  it('exposes the archive comment', () => {
    var buf = buildLnx([{ name: 'X', type: 'P', data: new Uint8Array([0xAA]) }]);
    var result = parseLnxArchive(buf);
    assert.ok(!result.error);
    assert.ok(/XVII/.test(result.comment), 'comment should include "XVII": ' + result.comment);
  });
});
