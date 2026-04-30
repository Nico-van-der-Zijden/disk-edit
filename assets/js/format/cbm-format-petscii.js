// ── PETSCII → Unicode ─────────────────────────────────────────────────
// C64 Pro font PUA ranges:
// E000-E0FF = uppercase/graphics mode (default)
// E100-E1FF = lowercase/uppercase mode
var charsetMode = localStorage.getItem('cbm-charsetMode') === 'lowercase' ? 'lowercase' : 'uppercase';

function buildPetsciiMap(mode) {
  var m = new Array(256).fill('\u00B7');
  var base = mode === 'lowercase' ? 0xE100 : 0xE000;

  // $00-$1F: reversed chars — use $40-$5F glyphs from the chosen charset
  for (var i = 0x00; i <= 0x1F; i++) m[i] = String.fromCharCode(base + 0x40 + i);

  // $20-$7F: displayable characters
  for (i = 0x20; i <= 0x7F; i++) m[i] = String.fromCharCode(base + i);

  // $80-$9F: reversed chars — use $C0-$DF glyphs from the chosen charset
  for (i = 0x80; i <= 0x9F; i++) m[i] = String.fromCharCode(base + 0xC0 + (i - 0x80));

  // $A0-$FF: displayable characters
  for (i = 0xA0; i <= 0xFF; i++) m[i] = String.fromCharCode(base + i);

  return m;
}

var PETSCII_MAP = buildPetsciiMap(charsetMode);

// Screen-code map for monitor/hex-dump style display.
// On a real C64 a memory dump prints each byte as the glyph at that
// screen-code position in the character ROM. Screen codes $00-$7F address
// the 128 normal glyphs; $80-$FF are the same glyphs drawn reversed.
//
// Screen codes do NOT line up 1:1 with PETSCII byte values, and the
// C64 Pro Mono PUA only populates PETSCII positions ($E020-$E07F /
// $E0A0-$E0FF). So screen code N maps to its PETSCII equivalent first,
// then to the PUA glyph at that PETSCII code:
//
//   sc $00-$1F  letters / brackets  → PETSCII $40-$5F  (sc + $40)
//   sc $20-$3F  punctuation/digits  → PETSCII $20-$3F  (identity)
//   sc $40-$5F  graphics block A    → PETSCII $60-$7F  (sc + $20)
//   sc $60-$7F  graphics block B    → PETSCII $A0-$BF  (sc + $40)
//
// Each entry: { char: <PUA glyph>, reversed: <bool> } so the renderer can
// wrap the reversed half in `.petscii-rev` for the inverse-color box —
// the same trick the directory listing uses for filenames.
function buildScreencodeMap(mode) {
  var base = mode === 'lowercase' ? 0xE100 : 0xE000;
  var m = new Array(256);
  for (var i = 0; i < 256; i++) {
    var reversed = i >= 0x80;
    var sc = reversed ? (i - 0x80) : i;
    var pua;
    if (sc <= 0x1F)      pua = base + sc + 0x40;  // letters/brackets → PETSCII $40-$5F
    else if (sc <= 0x3F) pua = base + sc;          // punctuation/digits identity
    else                 pua = base + sc + 0x80;  // alt letters / graphics → PETSCII $C0-$FF
    m[i] = { char: String.fromCharCode(pua), reversed: reversed };
  }
  return m;
}
var SCREENCODE_MAP = buildScreencodeMap(charsetMode);

// PETSCII byte → screen-code conversion (the mapping the C64 KERNAL applies
// when PRINTing). Used by the TASS source viewer to render `.text` strings
// the way TASS does — control codes ($00-$1F, $80-$9F) appear as reversed
// letters/brackets, regular printables look like themselves.
function petsciiToScreencode(b) {
  if (b <= 0x1F) return b + 0x80;
  if (b <= 0x3F) return b;
  if (b <= 0x5F) return b - 0x40;
  if (b <= 0x7F) return b - 0x20;
  if (b <= 0x9F) return b;
  if (b <= 0xBF) return b - 0x40;
  return b - 0x80;
}

function setCharsetMode(mode) {
  charsetMode = mode;
  localStorage.setItem('cbm-charsetMode', mode);
  PETSCII_MAP = buildPetsciiMap(mode);
  SCREENCODE_MAP = buildScreencodeMap(mode);
}

/** @param {number} byte @returns {string} PUA character */
function petsciiToAscii(byte) {
  return PETSCII_MAP[byte & 0xFF];
}

/** @param {Uint8Array} data @param {number} offset @param {number} len @param {boolean} [stopAtPadding] @returns {string} */
function readPetsciiString(data, offset, len, stopAtPadding) {
  let contentLen = len;
  if (stopAtPadding !== false) {
    for (let i = 0; i < len; i++) {
      if (data[offset + i] === 0xA0) { contentLen = i; break; }
    }
  }
  let s = '';
  for (let i = 0; i < contentLen; i++) s += petsciiToAscii(data[offset + i]);
  return s;
}

function readPetsciiRich(data, offset, len) {
  let contentLen = len;
  for (let i = 0; i < len; i++) {
    if (data[offset + i] === 0xA0) { contentLen = i; break; }
  }
  const chars = [];
  for (let i = 0; i < contentLen; i++) {
    const b = data[offset + i];
    const reversed = (b >= 0x00 && b <= 0x1F) || (b >= 0x80 && b <= 0x9F);
    chars.push({ char: petsciiToAscii(b), reversed });
  }
  return chars;
}

const UNICODE_TO_PETSCII = (() => {
  var rev = new Map();
  // Map all PETSCII_MAP entries back (including PUA chars)
  for (var i = 255; i >= 0; i--) {
    var ch = PETSCII_MAP[i];
    if (ch && ch !== '\u00B7') rev.set(ch, i);
  }
  // Keyboard typed characters → PETSCII bytes (override duplicates)
  for (i = 0x41; i <= 0x5A; i++) rev.set(String.fromCharCode(i), i);       // A-Z
  for (i = 0x41; i <= 0x5A; i++) rev.set(String.fromCharCode(i + 32), i);  // a-z
  for (i = 0x20; i <= 0x3F; i++) rev.set(String.fromCharCode(i), i);
  rev.set('@', 0x40); rev.set('[', 0x5B); rev.set(']', 0x5D);
  rev.set('\u00A3', 0x5C); rev.set('\u2191', 0x5E); rev.set('\u2190', 0x5F);
  rev.set('\u03C0', 0xFF); rev.set(' ', 0x20);
  return rev;
})();

function unicodeToPetscii(char) {
  var cp = char.charCodeAt(0);
  if (cp >= 0xE000 && cp <= 0xE0FF) return cp - 0xE000;
  if (cp >= 0xE100 && cp <= 0xE1FF) return cp - 0xE100;
  return UNICODE_TO_PETSCII.get(char) || 0x20;
}
