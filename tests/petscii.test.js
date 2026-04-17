// Tests for PETSCII conversion functions — pure, no disk images needed
const { describe, it } = require('node:test');
const assert = require('node:assert');
require('./test-helper');

describe('petsciiToAscii', () => {
  it('returns a PUA character for letters', () => {
    // petsciiToAscii maps to C64 Pro font PUA range, not ASCII
    var result = petsciiToAscii(0x41); // 'A' in PETSCII
    assert.ok(result.length > 0, 'should return a character');
    assert.ok(result.charCodeAt(0) >= 0xE000, 'should be in PUA range');
  });

  it('returns a character for every byte value', () => {
    for (var b = 0; b < 256; b++) {
      var result = petsciiToAscii(b);
      assert.ok(typeof result === 'string', 'byte ' + b + ' should return a string');
    }
  });
});

describe('petsciiToReadable (PUA to ASCII)', () => {
  it('converts PUA uppercase to A-Z', () => {
    var pua = String.fromCharCode(0xE041);
    assert.strictEqual(petsciiToReadable(pua), 'A');
  });

  it('converts PUA lowercase to A-Z', () => {
    var pua = String.fromCharCode(0xE161);
    assert.strictEqual(petsciiToReadable(pua), 'A');
  });

  it('converts a full PETSCII string round-trip', () => {
    // HELLO in PETSCII bytes: 0x48 0x45 0x4C 0x4C 0x4F
    var data = new Uint8Array([0x48, 0x45, 0x4C, 0x4C, 0x4F]);
    var puaStr = readPetsciiString(data, 0, 5);
    var readable = petsciiToReadable(puaStr);
    assert.strictEqual(readable, 'HELLO');
  });
});

describe('readPetsciiString', () => {
  it('reads a string and stops at 0xA0 padding', () => {
    var data = new Uint8Array([0x48, 0x49, 0xA0, 0xA0, 0xA0]); // HI + padding
    var result = readPetsciiString(data, 0, 5);
    assert.strictEqual(petsciiToReadable(result), 'HI');
  });

  it('returns empty for all padding', () => {
    var data = new Uint8Array([0xA0, 0xA0, 0xA0]);
    var result = readPetsciiString(data, 0, 3);
    assert.strictEqual(result, '');
  });

  it('respects offset parameter', () => {
    var data = new Uint8Array([0x00, 0x00, 0x48, 0x49, 0xA0]);
    var result = readPetsciiString(data, 2, 3);
    assert.strictEqual(petsciiToReadable(result), 'HI');
  });

  it('reads the full length when no padding', () => {
    var data = new Uint8Array([0x48, 0x45, 0x4C, 0x4C, 0x4F]);
    var result = readPetsciiString(data, 0, 5);
    assert.strictEqual(result.length, 5);
  });
});

describe('escHtml', () => {
  it('escapes HTML entities', () => {
    assert.strictEqual(escHtml('<b>"test"</b>'), '&lt;b&gt;&quot;test&quot;&lt;/b&gt;');
  });

  it('passes plain text through', () => {
    assert.strictEqual(escHtml('hello'), 'hello');
  });
});

describe('hex8 / hex16', () => {
  it('pads single digit to 2 chars', () => {
    assert.strictEqual(hex8(0), '00');
    assert.strictEqual(hex8(5), '05');
  });

  it('formats multi-digit hex', () => {
    assert.strictEqual(hex8(255), 'FF');
    assert.strictEqual(hex8(16), '10');
  });

  it('formats 16-bit values', () => {
    assert.strictEqual(hex16(0), '0000');
    assert.strictEqual(hex16(0x0801), '0801');
    assert.strictEqual(hex16(0xFFFF), 'FFFF');
  });
});

describe('fileTypeName', () => {
  it('formats closed PRG', () => {
    assert.strictEqual(fileTypeName(0x82).trim(), 'PRG');
  });

  it('formats deleted/splat file', () => {
    var name = fileTypeName(0x02);
    assert.ok(name.startsWith('*'));
  });

  it('formats locked file', () => {
    var name = fileTypeName(0xC2);
    assert.ok(name.endsWith('<'));
  });

  it('formats SEQ', () => {
    assert.strictEqual(fileTypeName(0x81).trim(), 'SEQ');
  });

  it('formats REL', () => {
    assert.strictEqual(fileTypeName(0x84).trim(), 'REL');
  });
});

describe('FILE_TYPE constants', () => {
  it('has correct values', () => {
    assert.strictEqual(FILE_TYPE.DEL, 0);
    assert.strictEqual(FILE_TYPE.SEQ, 1);
    assert.strictEqual(FILE_TYPE.PRG, 2);
    assert.strictEqual(FILE_TYPE.USR, 3);
    assert.strictEqual(FILE_TYPE.REL, 4);
    assert.strictEqual(FILE_TYPE.CBM, 5);
    assert.strictEqual(FILE_TYPE.DIR, 6);
  });

  it('matches FILE_TYPES array', () => {
    for (var key in FILE_TYPE) {
      assert.strictEqual(FILE_TYPES[FILE_TYPE[key]], key);
    }
  });
});
