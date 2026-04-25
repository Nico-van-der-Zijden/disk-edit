// ── PETSCII Keyboard Picker ───────────────────────────────────────────
// Provides an on-screen C64 keyboard for inserting PETSCII characters.

var pickerTarget = null;
var pickerClicking = false;
var pickerModifier = 'normal'; // 'normal', 'shift', 'cbm', 'all'
var pickerReverse = false;
var pickerDefaultAll = localStorage.getItem('cbm-pickerAll') === 'true';
var pickerStick = localStorage.getItem('cbm-pickerStick') === 'true';

// C64 keyboard layout: [label, normal, shift, cbm] per key
const KB_ROWS = [
  [['←',0x5F,-1,-1],['1',0x31,0x21,-1],['2',0x32,0x22,-1],['3',0x33,0x23,-1],['4',0x34,0x24,-1],['5',0x35,0x25,-1],['6',0x36,0x26,-1],['7',0x37,0x27,-1],['8',0x38,0x28,-1],['9',0x39,0x29,-1],['0',0x30,-1,-1],['+',0x2B,-1,-1],['-',0x2D,-1,-1],['£',0x5C,-1,-1]],
  [['Q',0x51,0xD1,0xAB],['W',0x57,0xD7,0xB3],['E',0x45,0xC5,0xB1],['R',0x52,0xD2,0xB2],['T',0x54,0xD4,0xA3],['Y',0x59,0xD9,0xB7],['U',0x55,0xD5,0xB8],['I',0x49,0xC9,0xA2],['O',0x4F,0xCF,0xB9],['P',0x50,0xD0,0xAF],['@',0x40,0xBA,-1],['*',0x2A,0xC0,-1],['↑',0x5E,0xFF,-1]],
  [['A',0x41,0xC1,0xB0],['S',0x53,0xD3,0xAE],['D',0x44,0xC4,0xAC],['F',0x46,0xC6,0xBB],['G',0x47,0xC7,0xA5],['H',0x48,0xC8,0xB4],['J',0x4A,0xCA,0xB5],['K',0x4B,0xCB,0xA1],['L',0x4C,0xCC,0xB6],[':',0x3A,0x5B,-1],[';',0x3B,0x5D,-1],['=',0x3D,-1,-1]],
  [['Z',0x5A,0xDA,0xAD],['X',0x58,0xD8,0xBD],['C',0x43,0xC3,0xBC],['V',0x56,0xD6,0xBE],['B',0x42,0xC2,0xBF],['N',0x4E,0xCE,0xAA],['M',0x4D,0xCD,0xA7],[',',0x2C,0x3C,-1],['.',0x2E,0x3E,-1],['/',0x2F,0x3F,-1]],
];

// ── Render the picker HTML ───────────────────────────────────────────
function renderPicker() {
  const el = document.getElementById('petscii-picker');
  let html = '<div class="petscii-modifiers">';
  html += '<div class="petscii-mod' + (pickerModifier === 'shift' ? ' active' : '') + '" data-mod="shift">SHIFT</div>';
  html += '<div class="petscii-mod' + (pickerModifier === 'cbm' ? ' active' : '') + '" data-mod="cbm">CBM</div>';
  html += '<div class="petscii-mod' + (pickerReverse ? ' active' : '') + '" data-mod="rev">RVS</div>';
  html += '<div class="petscii-mod' + (pickerModifier === 'all' ? ' active' : '') + '" data-mod="all">ALL</div>';
  html += '</div>';

  if (pickerModifier === 'all') {
    // Show all PETSCII characters in a 16x16 grid
    // Header row with column numbers
    html += '<div class="petscii-kb-row"><div class="petscii-key empty" style="width:28px;font-size:9px;color:var(--text-muted)"></div>';
    for (var col = 0; col < 16; col++) {
      html += '<div class="petscii-key empty" style="font-size:9px;color:var(--text-muted);cursor:default">' + col.toString(16).toUpperCase() + '</div>';
    }
    html += '</div>';

    for (var row = 0; row < 16; row++) {
      html += '<div class="petscii-kb-row">';
      // Row label
      html += '<div class="petscii-key empty" style="width:28px;font-size:9px;color:var(--text-muted);cursor:default">' + row.toString(16).toUpperCase() + 'x</div>';
      for (col = 0; col < 16; col++) {
        var code = row * 16 + col;
        var isSafe = SAFE_PETSCII.has(code);
        var disabled = !isSafe && !allowUnsafeChars;
        var isReversed = (code >= 0x00 && code <= 0x1F) || (code >= 0x80 && code <= 0x9F);
        var ch = PETSCII_MAP[code];
        var title = '$' + code.toString(16).toUpperCase().padStart(2, '0');
        html += '<div class="petscii-key' +
          (isReversed ? ' rev-char' : '') +
          (disabled ? ' disabled' : (!isSafe ? ' unsafe' : '')) +
          '" data-code="' + code + '" title="' + title + '">' + escHtml(ch) + '</div>';
      }
      html += '</div>';
    }
  } else {
    // Standard keyboard layout
    for (var r = 0; r < KB_ROWS.length; r++) {
      var rowData = KB_ROWS[r];
      html += '<div class="petscii-kb-row">';
      for (var k = 0; k < rowData.length; k++) {
        var entry = rowData[k];
        var label = entry[0], normal = entry[1], shift = entry[2], cbm = entry[3];
        var code;
        if (pickerModifier === 'shift') code = shift;
        else if (pickerModifier === 'cbm') code = cbm;
        else code = normal;

        if (code === -1) {
          html += '<div class="petscii-key empty"></div>';
        } else {
          var actualCode = code;
          if (pickerReverse) {
            if (code >= 0x40 && code <= 0x5F) actualCode = code - 0x40;
            else if (code >= 0xC0 && code <= 0xDF) actualCode = code - 0xC0 + 0x80;
          }
          var isSafe = SAFE_PETSCII.has(actualCode);
          var disabled = !isSafe && !allowUnsafeChars;
          var ch = PETSCII_MAP[code];
          var title = label + ' $' + code.toString(16).toUpperCase().padStart(2, '0');
          html += '<div class="petscii-key' +
            (pickerReverse ? ' rev-char' : '') +
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
    pickerClicking = true;
  });

  // mouseup: clear the flag after a delay so blur handlers see it as true
  el.addEventListener('mouseup', function() {
    setTimeout(function() { pickerClicking = false; }, 200);
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
      if (m === 'rev') {
        pickerReverse = !pickerReverse;
      } else {
        pickerModifier = (pickerModifier === m) ? 'normal' : m;
      }
      renderPicker();
      if (pickerTarget) pickerTarget.focus();
      return;
    }

    // Character key?
    var key = t.closest('.petscii-key');
    if (!key || !pickerTarget || key.classList.contains('empty') || key.classList.contains('disabled')) return;
    var code = parseInt(key.getAttribute('data-code'), 10);
    if (isNaN(code) || code < 0) return;

    var actualCode = code;
    if (pickerReverse) {
      if (code >= 0x40 && code <= 0x5F) actualCode = code - 0x40;
      else if (code >= 0xC0 && code <= 0xDF) actualCode = code - 0xC0 + 0x80;
    }

    var ch = PETSCII_MAP[actualCode];
    insertCharAtCursor(pickerTarget, ch, actualCode);
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
      var rev = (b <= 0x1F) || (b >= 0x80 && b <= 0x9F);
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
    if (code >= 0x41 && code <= 0x5A) petscii = code - 0x41 + 0xC1;      // shifted letter → $C1-$DA
    else if (code >= 0x61 && code <= 0x7A) petscii = code - 0x61 + 0x41; // lowercase letter → $41-$5A
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
  if (!pickerTarget) return;
  var el = document.getElementById('petscii-picker');
  var rect = pickerTarget.getBoundingClientRect();

  var inModal = !!pickerTarget.closest('.modal-overlay');

  if (pickerStick && !inModal) {
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
  } else if (pickerStick && inModal) {
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

function showPetsciiPicker(targetEl, maxLen) {
  var el = document.getElementById('petscii-picker');
  pickerTarget = targetEl;
  pickerModifier = pickerDefaultAll ? 'all' : 'normal';
  pickerReverse = false;
  renderPicker();
  el.classList.add('open');
  // Always appear above any open modal
  if (typeof modalZCounter !== 'undefined') el.style.zIndex = modalZCounter + 5;
  // Sticky-in-modal: flip the modal overlay to position:absolute so the
  // page can be scrolled to reveal the picker (modal scrolls with it). Save
  // and reset page scroll first so the modal doesn't jump off-screen when
  // the overlay leaves viewport-relative positioning.
  var hostModalOverlay = (pickerStick && targetEl.closest) ? targetEl.closest('.modal-overlay') : null;
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
  if (pickerStick) {
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

function hidePetsciiPicker() {
  document.getElementById('petscii-picker').classList.remove('open');
  pickerTarget = null;
  if (document.body.classList.contains('sticky-picker-in-modal')) {
    document.body.classList.remove('sticky-picker-in-modal');
    // Clear the overlay height we set on open.
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

// Old name compatibility

// Initialize
initPicker();
