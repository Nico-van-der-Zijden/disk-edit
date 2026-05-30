// ── PETSCII Keyboard Picker ───────────────────────────────────────────
// Provides an on-screen C64 keyboard for inserting PETSCII characters.

// Shared picker state. Accessed cross-file from ui-options.js, ui-init.js,
// ui-directory.js, ui-editing.js, ui-search.js, and ui-disk-tools.js — the
// app has no module system so this is the only namespacing we get.
var petsciiPicker = {
  target: null,
  clicking: false,
  modifier: 'normal', // 'normal', 'shift', 'cbm', 'all'
  reverse: false,
  defaultAll: localStorage.getItem('cbm-pickerAll') === 'true',
  stick: localStorage.getItem('cbm-pickerStick') === 'true',
  // Active tab in the floating PETSCII window. 'hex' = the 16×16 grid
  // with row/col hex labels; 'chart' = a denser unlabelled C64 charset
  // chart in the style of older builder tools.
  floatTab: localStorage.getItem('cbm-pickerFloatTab') || 'hex'
};

// PETSCII byte ranges that render reversed (white-on-text vs text-on-background)
const PETSCII_REV_LO_START = 0x00, PETSCII_REV_LO_END = 0x1F;
const PETSCII_REV_HI_START = 0x80, PETSCII_REV_HI_END = 0x9F;
// Picker's RVS button toggles the "normal" $40-$5F range to its reversed
// $00-$1F counterpart, and the shifted $C0-$DF range to $80-$9F.
const PETSCII_NORM_RANGE_START = 0x40, PETSCII_NORM_RANGE_END = 0x5F;
const PETSCII_SHIFTED_RANGE_START = 0xC0, PETSCII_SHIFTED_RANGE_END = 0xDF;
// Letters in the unshifted/shifted PETSCII charsets (keyboard-typed letter
// mapping; "A"=$41 unshifted, $C1 shifted)
const PETSCII_UC_LETTER_START = 0x41, PETSCII_UC_LETTER_END = 0x5A;
const PETSCII_LC_LETTER_START = 0x61, PETSCII_LC_LETTER_END = 0x7A;
const PETSCII_SHIFTED_LETTER_START = 0xC1;

function isPetsciiReversed(code) {
  return (code >= PETSCII_REV_LO_START && code <= PETSCII_REV_LO_END) ||
         (code >= PETSCII_REV_HI_START && code <= PETSCII_REV_HI_END);
}

// C64 keyboard layout: [label, normal, shift, cbm] per key
const KB_ROWS = [
  [['←',0x5F,-1,-1],['1',0x31,0x21,-1],['2',0x32,0x22,-1],['3',0x33,0x23,-1],['4',0x34,0x24,-1],['5',0x35,0x25,-1],['6',0x36,0x26,-1],['7',0x37,0x27,-1],['8',0x38,0x28,-1],['9',0x39,0x29,-1],['0',0x30,-1,-1],['+',0x2B,-1,-1],['-',0x2D,-1,-1],['£',0x5C,-1,-1]],
  [['Q',0x51,0xD1,0xAB],['W',0x57,0xD7,0xB3],['E',0x45,0xC5,0xB1],['R',0x52,0xD2,0xB2],['T',0x54,0xD4,0xA3],['Y',0x59,0xD9,0xB7],['U',0x55,0xD5,0xB8],['I',0x49,0xC9,0xA2],['O',0x4F,0xCF,0xB9],['P',0x50,0xD0,0xAF],['@',0x40,0xBA,-1],['*',0x2A,0xC0,-1],['↑',0x5E,0xFF,-1]],
  [['A',0x41,0xC1,0xB0],['S',0x53,0xD3,0xAE],['D',0x44,0xC4,0xAC],['F',0x46,0xC6,0xBB],['G',0x47,0xC7,0xA5],['H',0x48,0xC8,0xB4],['J',0x4A,0xCA,0xB5],['K',0x4B,0xCB,0xA1],['L',0x4C,0xCC,0xB6],[':',0x3A,0x5B,-1],[';',0x3B,0x5D,-1],['=',0x3D,-1,-1]],
  [['Z',0x5A,0xDA,0xAD],['X',0x58,0xD8,0xBD],['C',0x43,0xC3,0xBC],['V',0x56,0xD6,0xBE],['B',0x42,0xC2,0xBF],['N',0x4E,0xCE,0xAA],['M',0x4D,0xCD,0xA7],[',',0x2C,0x3C,-1],['.',0x2E,0x3E,-1],['/',0x2F,0x3F,-1]],
];

// 16x16 PETSCII character grid HTML in raw byte order. Tooltip on each
// cell carries the hex code, so no row/column header chrome.
function buildAllGridHtml() {
  var html = '<div class="petscii-grid">';
  for (var row = 0; row < 16; row++) {
    html += '<div class="petscii-kb-row">';
    for (var col = 0; col < 16; col++) {
      var code = row * 16 + col;
      var isSafe = SAFE_PETSCII.has(code);
      var disabled = !isSafe && !allowUnsafeChars;
      var isReversed = isPetsciiReversed(code);
      var ch = PETSCII_MAP[code];
      var title = '$' + code.toString(16).toUpperCase().padStart(2, '0');
      html += '<div class="petscii-key' +
        (isReversed ? ' rev-char' : '') +
        (disabled ? ' disabled' : (!isSafe ? ' unsafe' : '')) +
        '" data-code="' + code + '" title="' + title + '">' + escHtml(ch) + '</div>';
    }
    html += '</div>';
  }
  html += '</div>';
  return html;
}

// Filename-Builder style PETSCII chart — 16×16 grid in the layout used
// by Petmate (https://github.com/nurpax/petmate/blob/master/src/utils/index.ts).
// Each entry is a SCREEN CODE; positions $80-$FF give the reversed half
// of the chart naturally (rows 9-16 are the reversed mirror of rows 1-8).
//
// Click → PETSCII byte conversion goes through _chartScToPetscii below;
// for screencode positions that have no single-byte PETSCII equivalent
// (reversed punct/digits/graphics) we fall back to the non-reversed
// counterpart so the filename still gets something sensible.
var CHART_SC_UPPER = [
  32, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15,
  16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 46, 44, 59, 33, 63,
  48, 49, 50, 51, 52, 53, 54, 55, 56, 57, 34, 35, 36, 37, 38, 39,
  112, 110, 108, 123, 85, 73, 79, 80, 113, 114, 40, 41, 60, 62, 78, 77,
  109, 125, 124, 126, 74, 75, 76, 122, 107, 115, 27, 29, 31, 30, 95, 105,
  100, 111, 121, 98, 120, 119, 99, 116, 101, 117, 97, 118, 103, 106, 91, 43,
  82, 70, 64, 45, 67, 68, 69, 84, 71, 66, 93, 72, 89, 47, 86, 42,
  61, 58, 28, 0, 127, 104, 92, 102, 81, 87, 65, 83, 88, 90, 94, 96,
  160, 129, 130, 131, 132, 133, 134, 135, 136, 137, 138, 139, 140, 141, 142, 143,
  144, 145, 146, 147, 148, 149, 150, 151, 152, 153, 154, 174, 172, 187, 161, 191,
  176, 177, 178, 179, 180, 181, 182, 183, 184, 185, 162, 163, 164, 165, 166, 167,
  240, 238, 236, 251, 213, 201, 207, 208, 241, 242, 168, 169, 188, 190, 206, 205,
  237, 253, 252, 254, 202, 203, 204, 250, 235, 243, 155, 157, 159, 158, 223, 233,
  228, 239, 249, 226, 248, 247, 227, 244, 229, 245, 225, 246, 231, 234, 219, 171,
  210, 198, 192, 173, 195, 196, 197, 212, 199, 194, 221, 200, 217, 175, 214, 170,
  189, 186, 156, 128, 255, 232, 220, 230, 209, 215, 193, 211, 216, 218, 222, 224,
];
var CHART_SC_LOWER = [
  32, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15,
  16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 46, 44, 59, 33, 63,
  96, 65, 66, 67, 68, 69, 70, 71, 72, 73, 74, 75, 76, 77, 78, 79,
  80, 81, 82, 83, 84, 85, 86, 87, 88, 89, 90, 34, 35, 36, 37, 38,
  48, 49, 50, 51, 52, 53, 54, 55, 56, 57, 43, 45, 42, 61, 39, 0,
  112, 110, 108, 123, 113, 114, 40, 41, 95, 105, 92, 127, 60, 62, 28, 47,
  109, 125, 124, 126, 107, 115, 27, 29, 94, 102, 104, 58, 30, 31, 91, 122,
  100, 111, 121, 98, 99, 119, 120, 101, 116, 117, 97, 103, 106, 118, 64, 93,
  160, 129, 130, 131, 132, 133, 134, 135, 136, 137, 138, 139, 140, 141, 142, 143,
  144, 145, 146, 147, 148, 149, 150, 151, 152, 153, 154, 174, 172, 187, 161, 191,
  224, 193, 194, 195, 196, 197, 198, 199, 200, 201, 202, 203, 204, 205, 206, 207,
  208, 209, 210, 211, 212, 213, 214, 215, 216, 217, 218, 162, 163, 164, 165, 166,
  176, 177, 178, 179, 180, 181, 182, 183, 184, 185, 171, 173, 170, 189, 167, 128,
  240, 238, 236, 251, 241, 242, 168, 169, 223, 233, 220, 255, 188, 190, 156, 175,
  237, 253, 252, 254, 235, 243, 155, 157, 222, 230, 232, 186, 158, 159, 219, 250,
  228, 239, 249, 226, 227, 247, 248, 229, 244, 245, 225, 231, 234, 246, 192, 221,
];

// Screencode → PETSCII byte. Inverse of petsciiToScreencode for the
// ranges that have a clean inverse; lossy fallback otherwise so the
// chart cell stays clickable.
function _chartScToPetscii(sc) {
  if (sc <= 0x1F) return sc + 0x40;         // letters → $40-$5F
  if (sc <= 0x3F) return sc;                 // punct/digits identity
  if (sc <= 0x5F) return sc + 0x80;          // graphics A → $C0-$DF (matches the shifted-alt convention)
  if (sc <= 0x7F) return sc + 0x40;          // graphics B → $A0-$BF
  if (sc <= 0x9F) return sc - 0x80;          // reversed letters → $00-$1F (real reversed byte)
  if (sc <= 0xBF) return sc - 0x80;          // reversed punct/digits → $20-$3F (lossy: filename won't actually render reversed)
  if (sc <= 0xDF) return sc - 0x20;          // reversed graphics A → $A0-$BF (lossy)
  return sc - 0x40;                           // reversed graphics B → $A0-$BF (lossy)
}

function buildChartGridHtml() {
  // Follows the global charset mode (toggled via the Options menu or
  // Ctrl+Shift) — no separate per-chart switch.
  var mode = charsetMode === 'lowercase' ? 'lowercase' : 'uppercase';
  var scOrder = mode === 'lowercase' ? CHART_SC_LOWER : CHART_SC_UPPER;
  var scMap = buildScreencodeMap(mode);

  var html = '<div class="petscii-chart">';
  for (var idx = 0; idx < scOrder.length; idx++) {
    if (idx % 16 === 0) {
      if (idx > 0) html += '</div>';
      html += '<div class="petscii-chart-row">';
    }
    var sc = scOrder[idx];
    var entry = scMap[sc];
    var petsciiCode = _chartScToPetscii(sc);
    var isSafe = SAFE_PETSCII.has(petsciiCode);
    var disabled = !isSafe && !allowUnsafeChars;
    var title = 'SC $' + sc.toString(16).toUpperCase().padStart(2, '0') +
                ' → $' + petsciiCode.toString(16).toUpperCase().padStart(2, '0');
    html += '<div class="petscii-key' +
      (entry.reversed ? ' rev-char' : '') +
      (disabled ? ' disabled' : (!isSafe ? ' unsafe' : '')) +
      '" data-code="' + petsciiCode + '" title="' + title + '">' +
      escHtml(entry.char) + '</div>';
  }
  html += '</div></div>';
  return html;
}

// ── Render the picker HTML ───────────────────────────────────────────
function renderPicker() {
  const el = document.getElementById('petscii-picker');
  let html = '<div class="petscii-modifiers">';
  html += '<div class="petscii-mod' + (petsciiPicker.modifier === 'shift' ? ' active' : '') + '" data-mod="shift">SHIFT</div>';
  html += '<div class="petscii-mod' + (petsciiPicker.modifier === 'cbm' ? ' active' : '') + '" data-mod="cbm">CBM</div>';
  html += '<div class="petscii-mod' + (petsciiPicker.reverse ? ' active' : '') + '" data-mod="rev">RVS</div>';
  html += '<div class="petscii-mod' + (petsciiPicker.modifier === 'all' ? ' active' : '') + '" data-mod="all">ALL</div>';
  html += '</div>';

  if (petsciiPicker.modifier === 'all') {
    // Legacy in-place 16x16 grid — unreachable in normal flow now that the
    // ALL button switches to the floating window, but kept as a backup.
    html += buildAllGridHtml();
  } else {
    // Standard keyboard layout
    for (var r = 0; r < KB_ROWS.length; r++) {
      var rowData = KB_ROWS[r];
      html += '<div class="petscii-kb-row">';
      for (var k = 0; k < rowData.length; k++) {
        var entry = rowData[k];
        var label = entry[0], normal = entry[1], shift = entry[2], cbm = entry[3];
        var code;
        if (petsciiPicker.modifier === 'shift') code = shift;
        else if (petsciiPicker.modifier === 'cbm') code = cbm;
        else code = normal;

        if (code === -1) {
          html += '<div class="petscii-key empty"></div>';
        } else {
          var actualCode = code;
          if (petsciiPicker.reverse) {
            if (code >= PETSCII_NORM_RANGE_START && code <= PETSCII_NORM_RANGE_END) actualCode = code - PETSCII_NORM_RANGE_START;
            else if (code >= PETSCII_SHIFTED_RANGE_START && code <= PETSCII_SHIFTED_RANGE_END) actualCode = code - PETSCII_SHIFTED_RANGE_START + PETSCII_REV_HI_START;
          }
          var isSafe = SAFE_PETSCII.has(actualCode);
          var disabled = !isSafe && !allowUnsafeChars;
          var ch = PETSCII_MAP[code];
          var title = label + ' $' + code.toString(16).toUpperCase().padStart(2, '0');
          html += '<div class="petscii-key' +
            (petsciiPicker.reverse ? ' rev-char' : '') +
            (disabled ? ' disabled' : (!isSafe ? ' unsafe' : '')) +
            '" data-code="' + code + '" title="' + title + '">' + escHtml(ch) + '</div>';
        }
      }
      html += '</div>';
    }

    html += '<div class="petscii-kb-row"><div class="petscii-key space" data-code="32">SPACE</div></div>';
  }
  el.innerHTML = html;
}

// ── Handle picker interaction ────────────────────────────────────────
function initPicker() {
  const el = document.getElementById('petscii-picker');

  // mousedown: prevent blur on the editing input
  el.addEventListener('mousedown', function(e) {
    e.preventDefault();
    petsciiPicker.clicking = true;
  });

  // mouseup: clear the flag after a delay so blur handlers see it as true
  el.addEventListener('mouseup', function() {
    setTimeout(function() { petsciiPicker.clicking = false; }, 200);
  });

  // click: handle all interactions
  el.addEventListener('click', function(e) {
    e.preventDefault();
    e.stopPropagation();

    var t = e.target;
    if (t.nodeType === 3) t = t.parentElement;
    if (!t) return;

    // Modifier button?
    var mod = t.closest('.petscii-mod');
    if (mod) {
      if (mod.classList.contains('disabled')) return;
      var m = mod.getAttribute('data-mod');
      if (m === 'all') {
        // ALL switches over to the floating 16x16 window. Tear down the
        // compact picker (incl. sticky-modal flip) but keep petsciiPicker.target
        // — the float reuses it.
        hideCompactPicker();
        showPetsciiFloat(petsciiPicker.target);
        return;
      }
      if (m === 'rev') {
        petsciiPicker.reverse = !petsciiPicker.reverse;
      } else {
        petsciiPicker.modifier = (petsciiPicker.modifier === m) ? 'normal' : m;
      }
      renderPicker();
      if (petsciiPicker.target) petsciiPicker.target.focus();
      return;
    }

    // Character key?
    var key = t.closest('.petscii-key');
    if (!key || !petsciiPicker.target || key.classList.contains('empty') || key.classList.contains('disabled')) return;
    var code = parseInt(key.getAttribute('data-code'), 10);
    if (isNaN(code) || code < 0) return;

    var actualCode = code;
    if (petsciiPicker.reverse) {
      if (code >= PETSCII_NORM_RANGE_START && code <= PETSCII_NORM_RANGE_END) actualCode = code - PETSCII_NORM_RANGE_START;
      else if (code >= PETSCII_SHIFTED_RANGE_START && code <= PETSCII_SHIFTED_RANGE_END) actualCode = code - PETSCII_SHIFTED_RANGE_START + PETSCII_REV_HI_START;
    }

    var ch = PETSCII_MAP[actualCode];
    insertCharAtCursor(petsciiPicker.target, ch, actualCode);
  });

  renderPicker();
}

// Picker → editor insertion. PE editors handle the byte directly; for the
// remaining plain `<input>` users (e.g. the search box) we splice the PUA
// char into the value and bump the caret.
function insertCharAtCursor(input, ch, petsciiCode) {
  if (!input) return;
  if (input._isPetsciiEditor) {
    if (petsciiCode === undefined) return;
    input.focus();
    input.insertByte(petsciiCode);
    return;
  }
  if (input.tagName !== 'INPUT') return;
  var pos = (input._lastCursorPos != null) ? input._lastCursorPos : (input.selectionStart || 0);
  var maxLen = (input.maxLength > 0) ? input.maxLength : 9999;
  var newVal = input.value.slice(0, pos) + ch + input.value.slice(pos);
  if (newVal.length > maxLen) return;
  input.value = newVal;
  var newPos = pos + ch.length;
  input.focus();
  input.selectionStart = input.selectionEnd = newPos;
  input._lastCursorPos = newPos;
}

// ── PETSCII contenteditable editor ────────────────────────────────────
// A lossless replacement for <input> when editing PETSCII strings.
// Tracks a shadow Uint8Array so bytes round-trip losslessly — editing a
// name containing $01 $02 (which render as reversed A, B) preserves those
// bytes on commit instead of collapsing them to $41 $42 via the display
// map's aliasing (where $01 and $41 both map to the same PUA glyph).
//
// Reversed bytes ($00-$1F, $80-$9F) render with the .pe-rev class so
// they're visible as such during editing, matching the listing's
// readPetsciiRich behavior.
//
// Returns a div with:
//   .getBytes(padLen, padByte) → Uint8Array of current bytes
//   .getLength()                → current byte count
//   .insertByte(byte)           → insert one byte at the caret (used by picker)
//   ._isPetsciiEditor           → flag for insertCharAtCursor routing
//   ._lastCursorPos             → caret byte index (kept in sync)
//   ._maxLen                    → configured max byte count
function createPetsciiEditor(opts) {
  var maxLen = opts.maxLen;
  var shadow = new Uint8Array(maxLen);
  var shadowLen = 0;
  if (opts.initialBytes) {
    shadowLen = Math.min(opts.initialLen != null ? opts.initialLen : maxLen, maxLen);
    for (var i = 0; i < shadowLen; i++) shadow[i] = opts.initialBytes[i];
  }

  var el = document.createElement('div');
  el.className = 'petscii-editor ' + (opts.className || '');
  el.setAttribute('contenteditable', 'true');
  el.setAttribute('tabindex', '0');
  el.spellcheck = false;
  // .dir-entry sets draggable=true, which intercepts mousedown on child
  // contenteditables — Chrome/Edge start a drag instead of moving the caret.
  // Override it here so typing and text selection work normally.
  el.draggable = false;
  el.setAttribute('draggable', 'false');
  el._isPetsciiEditor = true;
  el._maxLen = maxLen;

  function render() {
    var html = '';
    for (var i = 0; i < shadowLen; i++) {
      var b = shadow[i];
      var rev = isPetsciiReversed(b);
      var ch = escHtml(petsciiToAscii(b));
      html += '<span class="pe-char' + (rev ? ' pe-rev' : '') + '">' + ch + '</span>';
    }
    el.innerHTML = html;
  }

  function setCaret(pos) {
    pos = Math.max(0, Math.min(pos, shadowLen));
    var sel = window.getSelection();
    var range = document.createRange();
    if (shadowLen === 0 || pos === 0) {
      range.setStart(el, 0);
    } else {
      range.setStartAfter(el.children[pos - 1]);
    }
    range.collapse(true);
    sel.removeAllRanges();
    sel.addRange(range);
    el._lastCursorPos = pos;
  }

  function nodeToByteIdx(node, offset) {
    if (node === el) return Math.min(offset, shadowLen);
    if (node.nodeType === 3 && node.parentNode && node.parentNode.parentNode === el) {
      var idx = Array.prototype.indexOf.call(el.children, node.parentNode);
      return idx + (offset > 0 ? 1 : 0);
    }
    if (node.parentNode === el) {
      var spanIdx = Array.prototype.indexOf.call(el.children, node);
      return spanIdx + (offset > 0 ? 1 : 0);
    }
    return shadowLen;
  }

  function getSelectionRange() {
    var sel = window.getSelection();
    if (!sel.rangeCount) return { start: shadowLen, end: shadowLen };
    var range = sel.getRangeAt(0);
    if (!el.contains(range.startContainer) || !el.contains(range.endContainer)) {
      return { start: shadowLen, end: shadowLen };
    }
    var a = nodeToByteIdx(range.startContainer, range.startOffset);
    var b = nodeToByteIdx(range.endContainer, range.endOffset);
    return { start: Math.min(a, b), end: Math.max(a, b) };
  }

  function replaceRange(start, end, bytes) {
    var delLen = end - start;
    var room = maxLen - (shadowLen - delLen);
    if (bytes.length > room) bytes = bytes.slice(0, Math.max(0, room));
    var shift = bytes.length - delLen;
    if (shift > 0) {
      for (var i = shadowLen - 1; i >= end; i--) shadow[i + shift] = shadow[i];
    } else if (shift < 0) {
      for (var j = end; j < shadowLen; j++) shadow[j + shift] = shadow[j];
    }
    for (var k = 0; k < bytes.length; k++) shadow[start + k] = bytes[k];
    shadowLen = shadowLen - delLen + bytes.length;
    render();
    setCaret(start + bytes.length);
  }

  // Backstop for paste and IME input (keydown doesn't fire for these).
  el.addEventListener('beforeinput', function(e) {
    var it = e.inputType;
    // Insertion via paste / IME: accept the data, convert per-char.
    if (it === 'insertFromPaste' || it === 'insertCompositionText' || it === 'insertReplacementText') {
      e.preventDefault();
      var text = e.data || '';
      if (!text && e.dataTransfer) text = e.dataTransfer.getData('text/plain') || '';
      var bytes = [];
      for (var ci = 0; ci < text.length; ci++) {
        var bc = unicodeToPetscii(text[ci]);
        if (bc !== undefined) bytes.push(bc);
      }
      var r = getSelectionRange();
      replaceRange(r.start, r.end, bytes);
      return;
    }
    // For everything else (insertText, deletions, line breaks, history),
    // block the default DOM mutation — the keydown handler below owns edits.
    e.preventDefault();
  });

  // Handle all edits in keydown so we don't depend on beforeinput firing
  // reliably for every key. Letters use shift-aware PETSCII mapping; other
  // printable keys go through UNICODE_TO_PETSCII; Delete/Backspace map to
  // range deletions on the shadow array.
  el.addEventListener('keydown', function(e) {
    // Let outer handlers see Enter / Escape.
    if (e.key === 'Enter' || e.key === 'Escape') return;
    // Don't interfere with arrow navigation, Home/End, Tab etc.
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight' ||
        e.key === 'ArrowUp' || e.key === 'ArrowDown' ||
        e.key === 'Home' || e.key === 'End' || e.key === 'Tab') return;

    // Backspace: delete the char before the caret (or the selection).
    if (e.key === 'Backspace') {
      e.preventDefault();
      var rb = getSelectionRange();
      if (rb.start !== rb.end) replaceRange(rb.start, rb.end, []);
      else if (rb.start > 0) replaceRange(rb.start - 1, rb.end, []);
      return;
    }

    // Delete: delete the char after the caret (or the selection).
    if (e.key === 'Delete') {
      e.preventDefault();
      var rd = getSelectionRange();
      if (rd.start !== rd.end) replaceRange(rd.start, rd.end, []);
      else if (rd.end < shadowLen) replaceRange(rd.start, rd.end + 1, []);
      return;
    }

    // Ctrl/Meta combos: let the browser handle them (copy/paste/select-all).
    // Alt is a modifier used by AltGr; don't skip based on alt alone because
    // AltGr combos on some layouts still produce printable chars.
    if (e.ctrlKey || e.metaKey) return;

    // Printable single-char keys.
    if (e.key.length !== 1) return;

    var code = e.key.charCodeAt(0);
    var petscii = -1;
    if (code >= PETSCII_UC_LETTER_START && code <= PETSCII_UC_LETTER_END) petscii = code - PETSCII_UC_LETTER_START + PETSCII_SHIFTED_LETTER_START;     // shifted letter → $C1-$DA
    else if (code >= PETSCII_LC_LETTER_START && code <= PETSCII_LC_LETTER_END) petscii = code - PETSCII_LC_LETTER_START + PETSCII_UC_LETTER_START;     // lowercase letter → $41-$5A
    else {
      var mapped = UNICODE_TO_PETSCII.get(e.key);
      if (mapped !== undefined) petscii = mapped;
      else return;   // character not representable in PETSCII — drop silently
    }
    e.preventDefault();
    var r = getSelectionRange();
    replaceRange(r.start, r.end, [petscii]);
  });

  function updateCursor() { el._lastCursorPos = getSelectionRange().start; }
  el.addEventListener('keyup', updateCursor);
  el.addEventListener('mouseup', updateCursor);
  el.addEventListener('focus', updateCursor);

  // Stop mousedown from bubbling to the draggable .dir-entry ancestor —
  // otherwise the browser starts a drag instead of moving the caret.
  el.addEventListener('mousedown', function(e) { e.stopPropagation(); });

  el.getBytes = function(padTo, padByte) {
    var out = new Uint8Array(padTo != null ? padTo : shadowLen);
    var lim = Math.min(shadowLen, out.length);
    for (var i = 0; i < lim; i++) out[i] = shadow[i];
    if (padByte !== undefined) {
      for (var j = lim; j < out.length; j++) out[j] = padByte;
    }
    return out;
  };
  el.getLength = function() { return shadowLen; };
  el.insertByte = function(byte) {
    var r = getSelectionRange();
    replaceRange(r.start, r.end, [byte]);
  };
  el._setCaret = setCaret;

  render();
  el._lastCursorPos = shadowLen;
  return el;
}

// ── Show/hide picker ─────────────────────────────────────────────────
var pickerScrollHandler = null;
var pickerSavedScrollY = 0;

// isInitial=true only on the first call from showPetsciiPicker. When called
// from the scroll handler, scrollIntoView() would itself trigger a scroll
// event, re-entering positionPicker and re-scrolling — infinite smooth-scroll
// loop that also pins the page at the picker's bottom.
function positionPicker(isInitial) {
  if (!petsciiPicker.target) return;
  var el = document.getElementById('petscii-picker');
  var rect = petsciiPicker.target.getBoundingClientRect();

  var inModal = !!petsciiPicker.target.closest('.modal-overlay');

  if (petsciiPicker.stick && !inModal) {
    // Sticky on the main page: input scrolls with the page, so place the
    // picker at a document-Y = rect.bottom + scrollY. When the page scrolls,
    // both rect.bottom and scrollY shift by the same amount in opposite
    // directions, so the picker visually tracks the input with no handler
    // intervention required (the scroll handler just re-asserts the same
    // value — harmless).
    el.style.position = 'absolute';
    var top = rect.bottom + window.scrollY + 4;
    var left = rect.left + window.scrollX;
    el.style.top = top + 'px';
    el.style.left = left + 'px';
    requestAnimationFrame(function() {
      var elRect = el.getBoundingClientRect();
      if (elRect.right > window.innerWidth) {
        var adjusted = window.innerWidth - elRect.width - 8 + window.scrollX;
        el.style.left = Math.max(0, adjusted) + 'px';
      }
      if (isInitial) {
        elRect = el.getBoundingClientRect();
        if (elRect.bottom > window.innerHeight) {
          el.scrollIntoView({ block: 'end', behavior: 'smooth' });
        }
      }
    });
  } else if (petsciiPicker.stick && inModal) {
    // Sticky inside a modal: same absolute+scrollY math as the main-page
    // case. We also flip the modal overlay to position:absolute (via a body
    // class toggled by showPetsciiPicker) so the modal scrolls with the
    // document. With that, rect.bottom tracks scrollY (input is in doc
    // flow-ish), the scrollIntoView reveal on initial scrolls both modal and
    // picker together, and later positionPicker calls compute the same top.
    el.style.position = 'absolute';
    el.style.top = (rect.bottom + window.scrollY + 4) + 'px';
    el.style.left = (rect.left + window.scrollX) + 'px';
    requestAnimationFrame(function() {
      var elRect = el.getBoundingClientRect();
      if (elRect.right > window.innerWidth) {
        el.style.left = Math.max(0, window.innerWidth - elRect.width - 8 + window.scrollX) + 'px';
      }
      if (isInitial) {
        elRect = el.getBoundingClientRect();
        if (elRect.bottom > window.innerHeight) {
          el.scrollIntoView({ block: 'end', behavior: 'smooth' });
        }
      }
    });
  } else {
    // Non-sticky: fit within the viewport, flip above if there's no room below.
    el.style.position = 'fixed';
    var ftop = rect.bottom + 4;
    var fleft = rect.left;
    requestAnimationFrame(function() {
      var pickerRect = el.getBoundingClientRect();
      if (ftop + pickerRect.height > window.innerHeight) {
        var above = rect.top - pickerRect.height - 4;
        if (above >= 0) {
          el.style.top = above + 'px';
        } else {
          el.style.top = Math.max(0, window.innerHeight - pickerRect.height - 4) + 'px';
        }
      }
      if (fleft + pickerRect.width > window.innerWidth) {
        fleft = window.innerWidth - pickerRect.width - 8;
      }
      el.style.left = Math.max(0, fleft) + 'px';
    });
    el.style.top = ftop + 'px';
    el.style.left = Math.max(0, fleft) + 'px';
  }
}

// ── Floating "All charset" window ─────────────────────────────────────
// Separate window for the 16x16 grid because it's too dense to live next
// to the input. The user drags it where they want; the position is kept
// in module state for the rest of the page session and resets to default
// on reload. The sticky-keyboard option doesn't apply here — float is
// always position:fixed and user-positioned.
var floatPosition = null; // { left, top } or null = default centered

function ensureFloatBuilt() {
  var fl = document.getElementById('petscii-float');
  if (fl) return fl;
  fl = document.createElement('div');
  fl.id = 'petscii-float';
  fl.className = 'petscii-float';
  fl.innerHTML =
    '<div class="petscii-float-titlebar">' +
      '<i class="fa-solid fa-grip-vertical"></i>' +
      '<span class="petscii-float-label">PETSCII Charset</span>' +
    '</div>' +
    '<div class="petscii-float-tabs">' +
      '<div class="petscii-float-tab" data-tab="hex">Default</div>' +
      '<div class="petscii-float-tab" data-tab="chart">Graphical</div>' +
    '</div>' +
    '<div class="petscii-float-body"></div>';
  document.body.appendChild(fl);

  var titleBar = fl.querySelector('.petscii-float-titlebar');
  var body = fl.querySelector('.petscii-float-body');
  var tabBar = fl.querySelector('.petscii-float-tabs');

  bindFloatDrag(fl, titleBar, function(x, y) {
    floatPosition = { left: x, top: y };
  });

  // Tab strip needs the same petsciiPicker.clicking bracket as the body
  // so the editor's blur handler doesn't close the picker between
  // mousedown and click on a tab.
  tabBar.addEventListener('mousedown', function(e) {
    e.preventDefault();
    petsciiPicker.clicking = true;
  });
  tabBar.addEventListener('mouseup', function() {
    setTimeout(function() { petsciiPicker.clicking = false; }, 200);
  });

  // Tab clicks swap the body content + persist the choice.
  tabBar.addEventListener('click', function(e) {
    var tab = e.target.closest('.petscii-float-tab');
    if (!tab) return;
    var which = tab.getAttribute('data-tab');
    if (!which || which === petsciiPicker.floatTab) return;
    petsciiPicker.floatTab = which;
    localStorage.setItem('cbm-pickerFloatTab', which);
    refreshFloatBody();
    // Return focus to the target editor so subsequent typing / Enter
    // keeps working without an extra click.
    if (petsciiPicker.target) petsciiPicker.target.focus();
  });

  // Same petsciiPicker.clicking bracket as the compact picker, so the editor's
  // blur handler doesn't commit the edit while the user clicks a cell.
  body.addEventListener('mousedown', function(e) {
    e.preventDefault();
    petsciiPicker.clicking = true;
  });
  body.addEventListener('mouseup', function() {
    setTimeout(function() { petsciiPicker.clicking = false; }, 200);
  });
  body.addEventListener('click', function(e) {
    e.preventDefault();
    e.stopPropagation();
    var t = e.target;
    if (t.nodeType === 3) t = t.parentElement;
    if (!t) return;
    var key = t.closest('.petscii-key');
    if (!key || !petsciiPicker.target || key.classList.contains('empty') || key.classList.contains('disabled')) return;
    var code = parseInt(key.getAttribute('data-code'), 10);
    if (isNaN(code) || code < 0) return;
    var ch = PETSCII_MAP[code];
    insertCharAtCursor(petsciiPicker.target, ch, code);
  });

  return fl;
}

// Reusable drag helper for floating titled windows. `onPosChange(x, y)`
// fires after each move so callers can persist the position in their
// own state (the PETSCII float keeps it in floatPosition; the
// separator float in ui-directory has its own variable).
function bindFloatDrag(fl, handle, onPosChange) {
  handle.addEventListener('pointerdown', function(e) {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    // Don't start a drag if the pointer landed on a control inside the
    // titlebar (close buttons, etc.) — capturing the pointer here would
    // block the button's click event.
    if (e.target && e.target.closest('button')) return;
    e.preventDefault();

    // First-drag normalization: convert the centered transform to inline
    // left/top so subsequent moves are deltas rather than transforms.
    var rect = fl.getBoundingClientRect();
    fl.style.transform = '';
    fl.style.left = rect.left + 'px';
    fl.style.top = rect.top + 'px';

    var startX = e.clientX, startY = e.clientY;
    var origLeft = rect.left, origTop = rect.top;
    var width = rect.width, height = rect.height;
    var pointerId = e.pointerId;

    handle.classList.add('dragging');
    try { handle.setPointerCapture(pointerId); } catch (_) {}

    function onMove(ev) {
      if (ev.pointerId !== pointerId) return;
      var nx = origLeft + (ev.clientX - startX);
      var ny = origTop + (ev.clientY - startY);
      // Clamp to viewport so the title bar can't be dragged off-screen
      // (otherwise the user can't grab it again to bring it back).
      nx = Math.max(0, Math.min(window.innerWidth - width, nx));
      ny = Math.max(0, Math.min(window.innerHeight - height, ny));
      fl.style.left = nx + 'px';
      fl.style.top = ny + 'px';
      if (typeof onPosChange === 'function') onPosChange(nx, ny);
    }
    function onUp() {
      handle.classList.remove('dragging');
      try { handle.releasePointerCapture(pointerId); } catch (_) {}
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onUp);
      document.removeEventListener('pointercancel', onUp);
    }
    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp);
    document.addEventListener('pointercancel', onUp);
  });
}

// Keep the chart in sync when the user toggles charset mode (menu or
// Ctrl+Shift). Deferred to a microtask so we don't mutate the float DOM
// in the same call stack as the menu handler's renderDisk — innerHTML on
// #content was racing with our refresh and throwing NotFoundError.
document.addEventListener('cbm-charsetchange', function() {
  setTimeout(function() {
    var fl = document.getElementById('petscii-float');
    if (fl && fl.classList.contains('open')) refreshFloatBody();
  }, 0);
});

// Render the float's body based on the active tab, and sync the
// .active class on the tab bar. Safe to call multiple times.
function refreshFloatBody() {
  var fl = document.getElementById('petscii-float');
  if (!fl) return;
  var tab = petsciiPicker.floatTab === 'chart' ? 'chart' : 'hex';
  fl.querySelector('.petscii-float-body').innerHTML =
    tab === 'chart' ? buildChartGridHtml() : buildAllGridHtml();
  var tabs = fl.querySelectorAll('.petscii-float-tab');
  for (var i = 0; i < tabs.length; i++) {
    tabs[i].classList.toggle('active', tabs[i].getAttribute('data-tab') === tab);
  }
}

function showPetsciiFloat(targetEl) {
  petsciiPicker.target = targetEl;
  var fl = ensureFloatBuilt();
  refreshFloatBody();

  if (floatPosition) {
    fl.style.left = floatPosition.left + 'px';
    fl.style.top = floatPosition.top + 'px';
    fl.style.transform = '';
  } else {
    fl.style.left = '50%';
    fl.style.top = '50%';
    fl.style.transform = 'translate(-50%, -50%)';
  }

  // Stay above any open modal, same z-index lift as the compact picker.
  if (typeof modalZCounter !== 'undefined') fl.style.zIndex = modalZCounter + 5;

  fl.classList.add('open');
}

function hidePetsciiFloat() {
  var fl = document.getElementById('petscii-float');
  if (fl) fl.classList.remove('open');
}

function showPetsciiPicker(targetEl, maxLen) {
  petsciiPicker.target = targetEl;
  // Show-all-by-default skips the compact picker entirely and brings up
  // the floating window — the docked picker is reserved for the C64
  // keyboard layout.
  if (petsciiPicker.defaultAll) {
    showPetsciiFloat(targetEl);
    return;
  }
  var el = document.getElementById('petscii-picker');
  petsciiPicker.modifier = 'normal';
  petsciiPicker.reverse = false;
  renderPicker();
  el.classList.add('open');
  // Always appear above any open modal
  if (typeof modalZCounter !== 'undefined') el.style.zIndex = modalZCounter + 5;
  // Sticky-in-modal: flip the modal overlay to position:absolute so the
  // page can be scrolled to reveal the picker (modal scrolls with it). Save
  // and reset page scroll first so the modal doesn't jump off-screen when
  // the overlay leaves viewport-relative positioning.
  var hostModalOverlay = (petsciiPicker.stick && targetEl.closest) ? targetEl.closest('.modal-overlay') : null;
  if (hostModalOverlay) {
    pickerSavedScrollY = window.scrollY;
    document.body.classList.add('sticky-picker-in-modal');
    if (window.scrollY !== 0) window.scrollTo(0, 0);
  }
  positionPicker(true);
  // After positioning, stretch the modal overlay to cover the picker so the
  // backdrop continues past the modal even when the picker extends the doc.
  // Absolutely-positioned children don't grow their parent; this sets the
  // overlay's height explicitly.
  if (hostModalOverlay) {
    requestAnimationFrame(function() {
      var pickerRect = el.getBoundingClientRect();
      var bottomDocY = window.scrollY + pickerRect.bottom + 16;
      hostModalOverlay.style.height = bottomDocY + 'px';
    });
  }

  // In sticky mode, follow the input when any scrollable ancestor scrolls.
  // Scroll events don't bubble, so register in the capture phase on document —
  // that fires for scrolls on #content, .modal-body, or any future scroll
  // container without having to locate the right ancestor.
  if (petsciiPicker.stick) {
    if (pickerScrollHandler) {
      document.removeEventListener('scroll', pickerScrollHandler, true);
    }
    // Skip window/document scrolls — those can't move an input that lives in
    // a position:fixed modal, and re-positioning the picker on them would
    // chase its own scrollIntoView target (doc-Y grows with scrollY, which
    // grows the document, which lets scrollY grow further, ...).
    // Inner scroll containers (modal bodies, scrollable lists) still fire
    // this handler so the picker follows an input that actually moves.
    pickerScrollHandler = function(e) {
      var t = e.target;
      if (t === document || t === document.documentElement || t === document.body) return;
      positionPicker();
    };
    document.addEventListener('scroll', pickerScrollHandler, true);
  }
}

// Tear down only the compact picker (and its sticky-modal side effects).
// Caller decides whether to clear petsciiPicker.target — the ALL→float transition
// keeps the same target alive.
function hideCompactPicker() {
  document.getElementById('petscii-picker').classList.remove('open');
  if (document.body.classList.contains('sticky-picker-in-modal')) {
    document.body.classList.remove('sticky-picker-in-modal');
    var openOverlay = document.querySelector('.modal-overlay.open');
    if (openOverlay) openOverlay.style.height = '';
    if (pickerSavedScrollY) window.scrollTo(0, pickerSavedScrollY);
    pickerSavedScrollY = 0;
  }
  if (pickerScrollHandler) {
    document.removeEventListener('scroll', pickerScrollHandler, true);
    pickerScrollHandler = null;
  }
}

function hidePetsciiPicker() {
  hideCompactPicker();
  hidePetsciiFloat();
  petsciiPicker.target = null;
}

// Old name compatibility

// Initialize
initPicker();
