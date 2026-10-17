// ── PETSCII → Unicode ─────────────────────────────────────────────────
// C64 Pro font PUA ranges:
// E000-E0FF = uppercase/graphics mode (default)
// E100-E1FF = lowercase/uppercase mode
var charsetMode = localStorage.getItem('cbm-charsetMode') === 'lowercase' ? 'lowercase' : 'uppercase';

// PETSCII control-code ranges; shown as reversed glyphs of the $40/$C0 rows.
var PETSCII_CTRL_LO_START = 0x00, PETSCII_CTRL_LO_END = 0x1F;
var PETSCII_CTRL_HI_START = 0x80, PETSCII_CTRL_HI_END = 0x9F;

function isPetsciiControlCode(b) {
  return (b >= PETSCII_CTRL_LO_START && b <= PETSCII_CTRL_LO_END) ||
         (b >= PETSCII_CTRL_HI_START && b <= PETSCII_CTRL_HI_END);
}

function buildPetsciiMap(mode) {
  var m = new Array(256).fill('\u00B7');
  var base = mode === 'lowercase' ? 0xE100 : 0xE000;

  for (var i = 0; i < 256; i++) {
    if (i <= PETSCII_CTRL_LO_END) m[i] = String.fromCharCode(base + 0x40 + i);
    else if (i >= PETSCII_CTRL_HI_START && i <= PETSCII_CTRL_HI_END) m[i] = String.fromCharCode(base + 0xC0 + (i - 0x80));
    else m[i] = String.fromCharCode(base + i);
  }
  return m;
}

var PETSCII_MAP = buildPetsciiMap(charsetMode);

// Screen code → { char, reversed } for monitor-style dumps; $80-$FF are
// $00-$7F reversed. The PUA font is indexed by PETSCII, so each screen
// code goes via its PETSCII row: $00-$1F → $40-$5F, $20-$3F → same,
// $40-$7F → $C0-$FF.
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

// PETSCII → screen code as the KERNAL PRINTs it; control codes come out
// as reversed letters/brackets (TASS viewer `.text` rendering).
function petsciiToScreencode(b) {
  if (b <= 0x1F) return b + 0x80;
  if (b <= 0x3F) return b;
  if (b <= 0x5F) return b - 0x40;
  if (b <= 0x7F) return b - 0x20;
  if (b <= 0x9F) return b;
  if (b <= 0xBF) return b - 0x40;
  if (b === 0xFF) return 0x5E; // pi: the KERNAL prints $FF as $DE's glyph
  return b - 0x80;
}

function setCharsetMode(mode) {
  charsetMode = mode;
  localStorage.setItem('cbm-charsetMode', mode);
  PETSCII_MAP = buildPetsciiMap(mode);
  SCREENCODE_MAP = buildScreencodeMap(mode);
  applyCharsetBodyAttr();
  // Modals, viewers and the picker re-render on this; the dir listing is
  // refreshed by the handler that changed the mode.
  if (typeof document !== 'undefined' && typeof document.dispatchEvent === 'function' &&
      typeof CustomEvent === 'function') {
    document.dispatchEvent(new CustomEvent('cbm-charsetchange', { detail: { mode: mode } }));
  }
}

// <body data-charset> lets CSS show plain filename inputs in the C64's case.
function applyCharsetBodyAttr() {
  if (typeof document === 'undefined' || !document.body) return;
  document.body.setAttribute('data-charset', charsetMode);
}
applyCharsetBodyAttr();

/** @param {number} byte @returns {string} PUA character */
function petsciiToAscii(byte) {
  return PETSCII_MAP[byte & 0xFF];
}

/** @param {Uint8Array} data @param {number} offset @param {number} len @param {boolean} [stopAtPadding] @returns {string} */
function readPetsciiString(data, offset, len, stopAtPadding) {
  let contentLen = len;
  if (stopAtPadding !== false) {
    contentLen = _petsciiPaddedLength(data, offset, len);
  }
  let s = '';
  for (let i = 0; i < contentLen; i++) s += petsciiToAscii(data[offset + i]);
  return s;
}

// Name length up to the first $A0 (CBM-DOS) or $00 (CFS / IDE64) padding byte.
function _petsciiPaddedLength(data, offset, len) {
  for (var i = 0; i < len; i++) {
    var b = data[offset + i];
    if (b === 0xA0 || b === 0x00) return i;
  }
  return len;
}

function readPetsciiRich(data, offset, len) {
  const contentLen = _petsciiPaddedLength(data, offset, len);
  const chars = [];
  for (let i = 0; i < contentLen; i++) {
    const b = data[offset + i];
    chars.push({ char: petsciiToAscii(b), reversed: isPetsciiControlCode(b) });
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
