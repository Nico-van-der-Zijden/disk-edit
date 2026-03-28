// ── PETSCII Keyboard Picker ───────────────────────────────────────────
// Provides an on-screen C64 keyboard for inserting PETSCII characters.

var pickerTarget = null;
var pickerClicking = false;
var pickerModifier = 'normal'; // 'normal', 'shift', 'cbm'
var pickerReverse = false;

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
  html += '</div>';

  for (let r = 0; r < KB_ROWS.length; r++) {
    const row = KB_ROWS[r];
    html += '<div class="petscii-kb-row">';
    for (let k = 0; k < row.length; k++) {
      const [label, normal, shift, cbm] = row[k];
      let code;
      if (pickerModifier === 'shift') code = shift;
      else if (pickerModifier === 'cbm') code = cbm;
      else code = normal;

      if (code === -1) {
        html += '<div class="petscii-key empty"></div>';
      } else {
        let actualCode = code;
        if (pickerReverse) {
          if (code >= 0x40 && code <= 0x5F) actualCode = code - 0x40;
          else if (code >= 0xC0 && code <= 0xDF) actualCode = code - 0xC0 + 0x80;
        }
        const isSafe = SAFE_PETSCII.has(actualCode);
        const disabled = !isSafe && !allowUnsafeChars;
        const ch = PETSCII_MAP[code];
        const title = label + ' $' + code.toString(16).toUpperCase().padStart(2, '0');
        html += '<div class="petscii-key' +
          (pickerReverse ? ' rev-char' : '') +
          (disabled ? ' disabled' : (!isSafe ? ' unsafe' : '')) +
          '" data-code="' + code + '" title="' + title + '">' + escHtml(ch) + '</div>';
      }
    }
    html += '</div>';
  }

  html += '<div class="petscii-kb-row"><div class="petscii-key space" data-code="32">SPACE</div></div>';
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

// ── Insert character into an input element ───────────────────────────
function insertCharAtCursor(input, ch, petsciiCode) {
  if (!input || input.tagName !== 'INPUT') return;
  var pos = (input._lastCursorPos != null) ? input._lastCursorPos : (input.selectionStart || 0);
  var val = input.value;
  var maxLen = input.maxLength || 9999;
  var newVal = val.slice(0, pos) + ch + val.slice(pos);
  if (newVal.length > maxLen) return;
  input.value = newVal;

  if (petsciiCode !== undefined) {
    if (!input._petsciiOverrides) input._petsciiOverrides = {};
    input._petsciiOverrides[pos] = petsciiCode;
  }

  var newPos = pos + ch.length;
  input.focus();
  input.selectionStart = input.selectionEnd = newPos;
  input._lastCursorPos = newPos;
}

// ── Track cursor position on inputs ──────────────────────────────────
function trackCursorPos(input) {
  var update = function() { input._lastCursorPos = input.selectionStart; };
  input.addEventListener('keyup', update);
  input.addEventListener('mouseup', update);
  input.addEventListener('input', update);
  update();
}

// ── Show/hide picker ─────────────────────────────────────────────────
function showPetsciiPicker(targetEl, maxLen) {
  var el = document.getElementById('petscii-picker');
  pickerTarget = targetEl;
  pickerModifier = 'normal';
  pickerReverse = false;
  renderPicker();

  var rect = targetEl.getBoundingClientRect();
  el.classList.add('open');

  var top = rect.bottom + 4;
  var left = rect.left;
  var pickerRect = el.getBoundingClientRect();
  if (top + pickerRect.height > window.innerHeight) {
    top = rect.top - pickerRect.height - 4;
  }
  if (left + pickerRect.width > window.innerWidth) {
    left = window.innerWidth - pickerRect.width - 8;
  }
  el.style.top = Math.max(0, top) + 'px';
  el.style.left = Math.max(0, left) + 'px';
}

function hidePetsciiPicker() {
  document.getElementById('petscii-picker').classList.remove('open');
  pickerTarget = null;
}

// Old name compatibility
var insertAtCursor = insertCharAtCursor;

// Initialize
initPicker();
