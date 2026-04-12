// ── C64 screen renderer (CHROUT $FFD2 simulation) ────────────────────

// Map PETSCII control codes to color indices
var PETSCII_COLOR_MAP = {
  0x05: 1,  // white
  0x1C: 2,  // red
  0x1E: 5,  // green
  0x1F: 6,  // blue
  0x81: 8,  // orange
  0x90: 0,  // black
  0x95: 9,  // brown
  0x96: 10, // light red
  0x97: 11, // dark grey
  0x98: 12, // medium grey
  0x99: 13, // light green
  0x9A: 14, // light blue
  0x9B: 15, // light grey
  0x9C: 4,  // purple
  0x9E: 7,  // yellow
  0x9F: 3   // cyan
};

function showFilePetsciiViewer(entryOff) {
  if (!currentBuffer) return;
  var data = new Uint8Array(currentBuffer);
  var result = readFileData(currentBuffer, entryOff);
  var fileData = result.data;
  var name = petsciiToReadable(readPetsciiString(data, entryOff + 5, 16)).trim();

  // Virtual 40x25 screen
  var W = 40, H = 25;
  var screen = [];
  for (var i = 0; i < W * H; i++) {
    screen[i] = { ch: 0x20, color: 14, reverse: false }; // light blue on blue, like C64 default
  }

  var curX = 0, curY = 0, curColor = 14, reverseOn = false;
  var lowercase = false;

  function putChar(petscii) {
    if (curY >= H) return; // off screen
    var idx = curY * W + curX;
    screen[idx] = { ch: petscii, color: curColor, reverse: reverseOn };
    curX++;
    if (curX >= W) {
      curX = 0;
      curY++;
    }
  }

  // Process each byte through CHROUT
  for (var bi = 0; bi < fileData.length; bi++) {
    var b = fileData[bi];

    // Color control codes
    if (PETSCII_COLOR_MAP[b] !== undefined) {
      curColor = PETSCII_COLOR_MAP[b];
      continue;
    }

    switch (b) {
      case 0x00: break; // null — ignored
      case 0x0D: // carriage return
        curX = 0;
        curY++;
        break;
      case 0x0E: // switch to lowercase
        lowercase = true;
        break;
      case 0x11: // cursor down
        curY++;
        break;
      case 0x12: // reverse on
        reverseOn = true;
        break;
      case 0x13: // home
        curX = 0;
        curY = 0;
        break;
      case 0x14: // delete (backspace)
        if (curX > 0) curX--;
        else if (curY > 0) { curY--; curX = W - 1; }
        screen[curY * W + curX] = { ch: 0x20, color: curColor, reverse: false };
        break;
      case 0x8E: // switch to uppercase
        lowercase = false;
        break;
      case 0x91: // cursor up
        if (curY > 0) curY--;
        break;
      case 0x92: // reverse off
        reverseOn = false;
        break;
      case 0x93: // clear screen
        for (var ci = 0; ci < W * H; ci++) {
          screen[ci] = { ch: 0x20, color: curColor, reverse: false };
        }
        curX = 0;
        curY = 0;
        break;
      case 0x1D: // cursor right
        curX++;
        if (curX >= W) { curX = 0; curY++; }
        break;
      case 0x9D: // cursor left
        if (curX > 0) curX--;
        else if (curY > 0) { curY--; curX = W - 1; }
        break;
      default:
        // Printable character ranges
        if ((b >= 0x20 && b <= 0x7F) || (b >= 0xA0 && b <= 0xFF)) {
          putChar(b);
        }
        // Other control codes (F-keys, etc.) — ignored
        break;
    }

    // Scroll if cursor past bottom
    if (curY >= H) {
      // Scroll screen up
      for (var si = 0; si < W * (H - 1); si++) {
        screen[si] = screen[si + W];
      }
      for (var si2 = W * (H - 1); si2 < W * H; si2++) {
        screen[si2] = { ch: 0x20, color: curColor, reverse: false };
      }
      curY = H - 1;
    }
  }

  // Render screen to HTML
  // Use uppercase or lowercase PETSCII map based on charset mode
  var html = '<div class="c64-screen">';
  for (var row = 0; row < H; row++) {
    html += '<div class="c64-screen-row">';
    for (var col = 0; col < W; col++) {
      var cell = screen[row * W + col];
      var fg = C64_COLORS[cell.color];
      var bg = 'transparent';
      if (cell.reverse) {
        bg = fg;
        fg = '#352879'; // screen background color (C64 blue)
      }
      // Use the appropriate PETSCII map character
      var displayChar;
      if (lowercase && cell.ch >= 0x41 && cell.ch <= 0x5A) {
        // Uppercase PETSCII → lowercase display (E1xx range)
        displayChar = String.fromCharCode(0xE100 + cell.ch);
      } else if (lowercase && cell.ch >= 0xC1 && cell.ch <= 0xDA) {
        // Shifted uppercase in lowercase mode → uppercase display (E0xx range)
        displayChar = String.fromCharCode(0xE000 + cell.ch);
      } else {
        displayChar = PETSCII_MAP[cell.ch] || ' ';
      }
      html += '<span class="c64-screen-char" style="color:' + fg +
        (bg !== 'transparent' ? ';background:' + bg : '') +
        '">' + escHtml(displayChar) + '</span>';
    }
    html += '</div>';
  }
  html += '</div>';

  var titleText = 'PETSCII View \u2014 "' + name + '"';
  if (result.error) titleText += ' \u2014 ' + result.error;

  document.getElementById('modal-title').textContent = titleText;
  var body = document.getElementById('modal-body');
  body.innerHTML = html;

  var footer = document.querySelector('#modal-overlay .modal-footer');
  footer.innerHTML = '<button id="modal-close">OK</button>';
  document.getElementById('modal-close').addEventListener('click', function() {
    document.getElementById('modal-overlay').classList.remove('open');
  });
  document.getElementById('modal-overlay').classList.add('open');
}

// ── File hex viewer (read-only) ───────────────────────────────────────
function showFileHexViewer(entryOff) {
  if (!currentBuffer) return;
  var data = new Uint8Array(currentBuffer);
  var result = readFileData(currentBuffer, entryOff);
  var fileData = result.data;
  var name = petsciiToReadable(readPetsciiString(data, entryOff + 5, 16)).trim();
  var totalBytes = fileData.length;

  var html = '<div class="hex-editor">';
  var rows = Math.ceil(totalBytes / 8) || 1;
  for (var row = 0; row < rows; row++) {
    var rowOff = row * 8;
    html += '<div class="hex-row"><span class="hex-offset">' + rowOff.toString(16).toUpperCase().padStart(4, '0') + '</span><span class="hex-bytes">';
    for (var col = 0; col < 8; col++) {
      var idx = rowOff + col;
      html += idx < totalBytes ? '<span class="hex-byte">' + fileData[idx].toString(16).toUpperCase().padStart(2, '0') + '</span>' : '<span class="hex-byte" style="opacity:0.2">--</span>';
    }
    html += '</span><span class="hex-separator"></span><span class="hex-ascii">';
    for (var col2 = 0; col2 < 8; col2++) {
      var idx2 = rowOff + col2;
      html += idx2 < totalBytes ? '<span class="hex-char">' + escHtml(PETSCII_MAP[fileData[idx2]]) + '</span>' : '<span class="hex-char" style="opacity:0.2">.</span>';
    }
    html += '</span></div>';
  }
  html += '</div>';

  var titleText = 'Hex View \u2014 "' + name + '" (' + totalBytes + ' bytes)';
  if (result.error) titleText += ' \u2014 ' + result.error;
  document.getElementById('modal-title').textContent = titleText;
  document.getElementById('modal-body').innerHTML = html;
  var footer = document.querySelector('#modal-overlay .modal-footer');
  footer.innerHTML = '<button id="modal-close">OK</button>';
  document.getElementById('modal-close').addEventListener('click', function() {
    document.getElementById('modal-overlay').classList.remove('open');
  });
  document.getElementById('modal-overlay').classList.add('open');
}

function showFileDisasmViewer(entryOff) {
  if (!currentBuffer) return;
  var data = new Uint8Array(currentBuffer);
  var result = readFileData(currentBuffer, entryOff);
  var fileData = result.data;
  var name = petsciiToReadable(readPetsciiString(data, entryOff + 5, 16)).trim();

  var loadAddr = fileData.length >= 2 ? (fileData[0] | (fileData[1] << 8)) : 0;
  var codeData = fileData.subarray(2);
  var lines = disassemble6502(codeData, loadAddr, 5000);

  // Detect SYS address for auto-scroll
  var sysTarget = null;
  var packerInfo = detectPacker(fileData);
  if (packerInfo && packerInfo.sysAddr > loadAddr) {
    sysTarget = '$' + hex16(packerInfo.sysAddr);
  }

  var html = '<div class="hex-editor">';
  for (var di = 0; di < lines.length; di++) {
    var l = lines[di];
    var instrClass = l.type === 2 ? 'dasm-unsafe' : l.type === 1 ? 'dasm-illegal' : 'dasm-instr';
    var isSysEntry = (sysTarget && l.addr === sysTarget);
    html += '<div class="hex-row' + (isSysEntry ? ' dasm-sys-entry' : '') + '"' +
      (isSysEntry ? ' id="dasm-sys-target"' : '') +
      '><span class="dasm-offset">' + l.addr + '</span><span class="dasm-bytes">' + escHtml(l.bytes) + '</span><span class="' + instrClass + '">' + escHtml(l.text) + '</span></div>';
  }
  html += '</div>';

  var titleText = 'Disassembly \u2014 "' + name + '" (load: $' + hex16(loadAddr) + ', ' + codeData.length + ' bytes)';
  if (sysTarget) titleText += ', SYS ' + sysTarget;
  if (result.error) titleText += ' \u2014 ' + result.error;
  document.getElementById('modal-title').textContent = titleText;
  document.getElementById('modal-body').innerHTML = html;
  var footer = document.querySelector('#modal-overlay .modal-footer');
  footer.innerHTML = '<button id="modal-close">OK</button>';
  document.getElementById('modal-close').addEventListener('click', function() {
    document.getElementById('modal-overlay').classList.remove('open');
  });
  document.getElementById('modal-overlay').classList.add('open');

  // Scroll to SYS entry point
  var sysEl = document.getElementById('dasm-sys-target');
  if (sysEl) sysEl.scrollIntoView({ block: 'start' });
}

// ── Hex sector editor ─────────────────────────────────────────────────
// ── 6502 Disassembler ─────────────────────────────────────────────────
// 6502 opcode table: [mnemonic, addressing mode, type]
// type: 0=legal, 1=illegal (stable), 2=illegal (unstable)
// Addressing modes: 0=impl, 1=imm, 2=zp, 3=zpx, 4=zpy, 5=abs, 6=absx, 7=absy, 8=indx, 9=indy, 10=rel, 11=ind
// Mnemonics follow oxyron.de naming convention
var OPS_6502 = [
  ['BRK',0,0],['ORA',8,0],['KIL',0,2],['SLO',8,1],['NOP',2,1],['ORA',2,0],['ASL',2,0],['SLO',2,1],['PHP',0,0],['ORA',1,0],['ASL',0,0],['ANC',1,1],['NOP',5,1],['ORA',5,0],['ASL',5,0],['SLO',5,1],
  ['BPL',10,0],['ORA',9,0],['KIL',0,2],['SLO',9,1],['NOP',3,1],['ORA',3,0],['ASL',3,0],['SLO',3,1],['CLC',0,0],['ORA',7,0],['NOP',0,1],['SLO',7,1],['NOP',6,1],['ORA',6,0],['ASL',6,0],['SLO',6,1],
  ['JSR',5,0],['AND',8,0],['KIL',0,2],['RLA',8,1],['BIT',2,0],['AND',2,0],['ROL',2,0],['RLA',2,1],['PLP',0,0],['AND',1,0],['ROL',0,0],['ANC',1,1],['BIT',5,0],['AND',5,0],['ROL',5,0],['RLA',5,1],
  ['BMI',10,0],['AND',9,0],['KIL',0,2],['RLA',9,1],['NOP',3,1],['AND',3,0],['ROL',3,0],['RLA',3,1],['SEC',0,0],['AND',7,0],['NOP',0,1],['RLA',7,1],['NOP',6,1],['AND',6,0],['ROL',6,0],['RLA',6,1],
  ['RTI',0,0],['EOR',8,0],['KIL',0,2],['SRE',8,1],['NOP',2,1],['EOR',2,0],['LSR',2,0],['SRE',2,1],['PHA',0,0],['EOR',1,0],['LSR',0,0],['ALR',1,1],['JMP',5,0],['EOR',5,0],['LSR',5,0],['SRE',5,1],
  ['BVC',10,0],['EOR',9,0],['KIL',0,2],['SRE',9,1],['NOP',3,1],['EOR',3,0],['LSR',3,0],['SRE',3,1],['CLI',0,0],['EOR',7,0],['NOP',0,1],['SRE',7,1],['NOP',6,1],['EOR',6,0],['LSR',6,0],['SRE',6,1],
  ['RTS',0,0],['ADC',8,0],['KIL',0,2],['RRA',8,1],['NOP',2,1],['ADC',2,0],['ROR',2,0],['RRA',2,1],['PLA',0,0],['ADC',1,0],['ROR',0,0],['ARR',1,1],['JMP',11,0],['ADC',5,0],['ROR',5,0],['RRA',5,1],
  ['BVS',10,0],['ADC',9,0],['KIL',0,2],['RRA',9,1],['NOP',3,1],['ADC',3,0],['ROR',3,0],['RRA',3,1],['SEI',0,0],['ADC',7,0],['NOP',0,1],['RRA',7,1],['NOP',6,1],['ADC',6,0],['ROR',6,0],['RRA',6,1],
  ['NOP',1,1],['STA',8,0],['NOP',1,1],['SAX',8,1],['STY',2,0],['STA',2,0],['STX',2,0],['SAX',2,1],['DEY',0,0],['NOP',1,1],['TXA',0,0],['XAA',1,2],['STY',5,0],['STA',5,0],['STX',5,0],['SAX',5,1],
  ['BCC',10,0],['STA',9,0],['KIL',0,2],['AHX',9,2],['STY',3,0],['STA',3,0],['STX',4,0],['SAX',4,1],['TYA',0,0],['STA',7,0],['TXS',0,0],['TAS',7,2],['SHY',6,2],['STA',6,0],['SHX',7,2],['AHX',7,2],
  ['LDY',1,0],['LDA',8,0],['LDX',1,0],['LAX',8,1],['LDY',2,0],['LDA',2,0],['LDX',2,0],['LAX',2,1],['TAY',0,0],['LDA',1,0],['TAX',0,0],['LAX',1,2],['LDY',5,0],['LDA',5,0],['LDX',5,0],['LAX',5,1],
  ['BCS',10,0],['LDA',9,0],['KIL',0,2],['LAX',9,1],['LDY',3,0],['LDA',3,0],['LDX',4,0],['LAX',4,1],['CLV',0,0],['LDA',7,0],['TSX',0,0],['LAS',7,2],['LDY',6,0],['LDA',6,0],['LDX',7,0],['LAX',7,1],
  ['CPY',1,0],['CMP',8,0],['NOP',1,1],['DCP',8,1],['CPY',2,0],['CMP',2,0],['DEC',2,0],['DCP',2,1],['INY',0,0],['CMP',1,0],['DEX',0,0],['AXS',1,1],['CPY',5,0],['CMP',5,0],['DEC',5,0],['DCP',5,1],
  ['BNE',10,0],['CMP',9,0],['KIL',0,2],['DCP',9,1],['NOP',3,1],['CMP',3,0],['DEC',3,0],['DCP',3,1],['CLD',0,0],['CMP',7,0],['NOP',0,1],['DCP',7,1],['NOP',6,1],['CMP',6,0],['DEC',6,0],['DCP',6,1],
  ['CPX',1,0],['SBC',8,0],['NOP',1,1],['ISC',8,1],['CPX',2,0],['SBC',2,0],['INC',2,0],['ISC',2,1],['INX',0,0],['SBC',1,0],['NOP',0,0],['SBC',1,1],['CPX',5,0],['SBC',5,0],['INC',5,0],['ISC',5,1],
  ['BEQ',10,0],['SBC',9,0],['KIL',0,2],['ISC',9,1],['NOP',3,1],['SBC',3,0],['INC',3,0],['ISC',3,1],['SED',0,0],['SBC',7,0],['NOP',0,1],['ISC',7,1],['NOP',6,1],['SBC',6,0],['INC',6,0],['ISC',6,1]
];
var MODE_SIZE = [1,2,2,2,2,3,3,3,2,2,2,3];

function disassemble6502(data, startAddr, maxLines) {
  var lines = [];
  var pos = 0;
  for (var li = 0; li < maxLines && pos < data.length; li++) {
    var opcode = data[pos];
    var op = OPS_6502[opcode];
    var mnemonic = op[0];
    var mode = op[1];
    var type = op[2]; // 0=legal, 1=illegal stable, 2=illegal unsafe
    var size = MODE_SIZE[mode];
    var addr = startAddr + pos;
    var bytes = '';
    for (var b = 0; b < size && pos + b < data.length; b++) {
      bytes += hex8(data[pos + b]) + ' ';
    }
    var operand = '';
    if (size === 2 && pos + 1 < data.length) {
      var val = data[pos + 1];
      var h8 = hex8(val);
      if (mode === 10) { // relative
        var target = addr + 2 + (val > 127 ? val - 256 : val);
        operand = '$' + hex16(target & 0xFFFF);
      } else if (mode === 1) operand = '#$' + h8;
      else if (mode === 8) operand = '($' + h8 + ',X)';
      else if (mode === 9) operand = '($' + h8 + '),Y';
      else if (mode === 3) operand = '$' + h8 + ',X';
      else if (mode === 4) operand = '$' + h8 + ',Y';
      else operand = '$' + h8;
    } else if (size === 3 && pos + 2 < data.length) {
      var val16 = data[pos + 1] | (data[pos + 2] << 8);
      var h16 = hex16(val16);
      if (mode === 11) operand = '($' + h16 + ')';
      else if (mode === 6) operand = '$' + h16 + ',X';
      else if (mode === 7) operand = '$' + h16 + ',Y';
      else operand = '$' + h16;
    }
    lines.push({
      addr: '$' + hex16(addr),
      bytes: bytes.padEnd(9),
      text: mnemonic + (operand ? ' ' + operand : ''),
      type: type
    });
    pos += size;
  }
  return lines;
}

var sectorClipboard = null;

function showSectorHexEditor(track, sector, highlightOff, highlightLen) {
  if (!currentBuffer) return;
  var off = sectorOffset(track, sector);
  if (off < 0) return;
  var data = new Uint8Array(currentBuffer);

  // Copy original sector data for comparison
  var original = new Uint8Array(256);
  for (var i = 0; i < 256; i++) original[i] = data[off + i];

  // Working copy
  var working = new Uint8Array(256);
  for (i = 0; i < 256; i++) working[i] = original[i];

  // Build highlight set: find ALL occurrences of the search term in this sector
  var hlSet = {};
  if (highlightOff !== undefined && highlightLen !== undefined && highlightLen > 0) {
    // Extract the search term bytes from the clicked match
    var termBytes = [];
    for (var tb = 0; tb < highlightLen && highlightOff + tb < 256; tb++) {
      termBytes.push(working[highlightOff + tb]);
    }
    // Find all matches in the sector
    for (var sp = 0; sp <= 256 - termBytes.length; sp++) {
      var match = true;
      for (var sb = 0; sb < termBytes.length; sb++) {
        if (working[sp + sb] !== termBytes[sb]) { match = false; break; }
      }
      if (match) {
        for (var hb = 0; hb < termBytes.length; hb++) hlSet[sp + hb] = true;
      }
    }
  }

  var html = '<div class="hex-editor">';
  for (var row = 0; row < 32; row++) {
    var rowOff = row * 8;
    html += '<div class="hex-row">';
    html += '<span class="hex-offset">' + rowOff.toString(16).toUpperCase().padStart(2, '0') + '</span>';
    html += '<span class="hex-bytes">';
    for (var col = 0; col < 8; col++) {
      var idx = rowOff + col;
      var b = working[idx];
      var hl = hlSet[idx] ? ' hex-highlight' : '';
      html += '<span class="hex-byte' + hl + '" data-idx="' + idx + '" data-row="' + row + '">' +
        b.toString(16).toUpperCase().padStart(2, '0') + '</span>';
    }
    html += '</span>';
    html += '<span class="hex-separator"></span>';
    html += '<span class="hex-ascii">';
    for (var col2 = 0; col2 < 8; col2++) {
      var idx2 = rowOff + col2;
      html += '<span class="hex-char" data-idx="' + idx2 + '">' + escHtml(PETSCII_MAP[working[idx2]]) + '</span>';
    }
    html += '</span>';
    html += '</div>';
  }
  html += '</div>';

  // Show modal with editable T/S in title and custom footer
  var titleEl = document.getElementById('modal-title');
  titleEl.innerHTML = 'Sector Editor \u2014 T:$' +
    '<span class="hex-nav-group">' +
      '<span id="hex-nav-track" class="hex-nav-field">' + track.toString(16).toUpperCase().padStart(2, '0') + '</span>' +
      '<span class="hex-nav-arrows">' +
        '<span class="hex-nav-btn" id="hex-track-up"><i class="fa-solid fa-chevron-up"></i></span>' +
        '<span class="hex-nav-btn" id="hex-track-down"><i class="fa-solid fa-chevron-down"></i></span>' +
      '</span>' +
    '</span>' +
    ' S:$' +
    '<span class="hex-nav-group">' +
      '<span id="hex-nav-sector" class="hex-nav-field">' + sector.toString(16).toUpperCase().padStart(2, '0') + '</span>' +
      '<span class="hex-nav-arrows">' +
        '<span class="hex-nav-btn" id="hex-sector-up"><i class="fa-solid fa-chevron-up"></i></span>' +
        '<span class="hex-nav-btn" id="hex-sector-down"><i class="fa-solid fa-chevron-down"></i></span>' +
      '</span>' +
    '</span>';

  var body = document.getElementById('modal-body');
  body.innerHTML = html;
  var footer = document.querySelector('#modal-overlay .modal-footer');
  var origFooter = footer.innerHTML;
  var origFooterClass = footer.className;
  var nextT = working[0], nextS = working[1];
  var hasChain = nextT > 0 && nextT <= currentTracks;
  footer.className = 'modal-footer modal-footer-split';
  footer.innerHTML =
    '<div class="modal-footer-actions">' +
    '<button id="hex-back" class="modal-btn-secondary" title="Find sector pointing here">\u2190 Back</button>' +
    '<button id="hex-follow" class="modal-btn-secondary"' + (hasChain ? '' : ' disabled') +
    ' title="Follow sector chain (Ctrl+J)">Follow \u2192</button>' +
    '<button id="hex-fill-sec" class="modal-btn-secondary" title="Fill sector with byte">Fill</button>' +
    '<button id="hex-copy-sec" class="modal-btn-secondary" title="Copy sector to clipboard">Copy</button>' +
    '<button id="hex-paste-sec" class="modal-btn-secondary" title="Paste from clipboard"' + (sectorClipboard ? '' : ' disabled') + '>Paste</button>' +
    '</div>' +
    '<div class="modal-footer-nav"><button id="hex-cancel" class="modal-btn-secondary">Cancel</button><button id="hex-save">Save</button></div>';
  document.getElementById('modal-overlay').classList.add('open');

  var navTrack = track;
  var navSector = sector;

  function saveCurrentAndNavigate(newTrack, newSector) {
    // Save current edits if modified
    var hasChanges = false;
    for (var c = 0; c < 256; c++) { if (working[c] !== original[c]) { hasChanges = true; break; } }
    if (hasChanges) {
      pushUndo();
      for (var c2 = 0; c2 < 256; c2++) data[off + c2] = working[c2];
    }
    document.removeEventListener('keydown', onKeyDown);
    document.getElementById('modal-overlay').classList.remove('open');
    footer.className = origFooterClass;
    footer.innerHTML = origFooter;
    var closeBtn = document.getElementById('modal-close');
    if (closeBtn) closeBtn.addEventListener('click', function() {
      document.getElementById('modal-overlay').classList.remove('open');
    });
    showSectorHexEditor(newTrack, newSector);
  }

  // Click track/sector field to edit inline
  function setupNavClick(spanId, getValue, validateFn, onCommit) {
    var span = document.getElementById(spanId);
    if (!span) return;
    span.addEventListener('click', function() {
      if (span.querySelector('input')) return;
      var curVal = getValue();
      var input = createHexInput({ value: curVal, maxBytes: 1, validate: validateFn });
      span.textContent = '';
      span.appendChild(input);
      input.focus();
      input.select();
      function commit() {
        if (input.isValid()) {
          onCommit(input.getValue());
        } else {
          span.textContent = getValue().toString(16).toUpperCase().padStart(2, '0');
        }
      }
      input.addEventListener('keydown', function(e) {
        if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); commit(); }
        else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); span.textContent = getValue().toString(16).toUpperCase().padStart(2, '0'); }
        else if (e.key === 'Tab') { e.preventDefault(); commit(); }
      });
      input.addEventListener('blur', function() {
        setTimeout(function() { if (span.querySelector('input')) commit(); }, 150);
      });
    });
  }

  setupNavClick('hex-nav-track',
    function() { return navTrack; },
    function(val) { return val >= 1 && val <= currentTracks; },
    function(newTrack) {
      navTrack = newTrack;
      // Only reset sector if current sector is invalid for the new track
      if (navSector >= sectorsPerTrack(navTrack)) navSector = 0;
      document.getElementById('hex-nav-track').textContent = newTrack.toString(16).toUpperCase().padStart(2, '0');
      // Auto-focus sector
      var secSpan = document.getElementById('hex-nav-sector');
      secSpan.textContent = navSector.toString(16).toUpperCase().padStart(2, '0');
      setTimeout(function() { secSpan.click(); }, 50);
    }
  );

  setupNavClick('hex-nav-sector',
    function() { return navSector; },
    function(val) { return val >= 0 && val < sectorsPerTrack(navTrack); },
    function(newSector) {
      navSector = newSector;
      saveCurrentAndNavigate(navTrack, navSector);
    }
  );

  // Arrow buttons
  document.getElementById('hex-track-up').addEventListener('click', function() {
    if (navTrack < currentTracks) {
      navTrack++;
      if (navSector >= sectorsPerTrack(navTrack)) navSector = 0;
      saveCurrentAndNavigate(navTrack, navSector);
    }
  });
  document.getElementById('hex-track-down').addEventListener('click', function() {
    if (navTrack > 1) {
      navTrack--;
      if (navSector >= sectorsPerTrack(navTrack)) navSector = 0;
      saveCurrentAndNavigate(navTrack, navSector);
    }
  });
  document.getElementById('hex-sector-up').addEventListener('click', function() {
    if (navSector < sectorsPerTrack(navTrack) - 1) {
      navSector++;
    } else if (navTrack < currentTracks) {
      navTrack++;
      navSector = 0;
    } else {
      return;
    }
    saveCurrentAndNavigate(navTrack, navSector);
  });
  document.getElementById('hex-sector-down').addEventListener('click', function() {
    if (navSector > 0) {
      navSector--;
    } else if (navTrack > 1) {
      navTrack--;
      navSector = sectorsPerTrack(navTrack) - 1;
    } else {
      return;
    }
    saveCurrentAndNavigate(navTrack, navSector);
  });

  var editingByte = null;
  var editBuffer = '';

  function updateByte(idx, val) {
    working[idx] = val;
    var byteEl = body.querySelector('.hex-byte[data-idx="' + idx + '"]');
    var charEl = body.querySelector('.hex-char[data-idx="' + idx + '"]');
    if (byteEl) {
      byteEl.textContent = val.toString(16).toUpperCase().padStart(2, '0');
      byteEl.classList.toggle('modified', val !== original[idx]);
    }
    if (charEl) charEl.innerHTML = escHtml(PETSCII_MAP[val]);
  }

  function startEdit(idx) {
    stopEdit();
    editingByte = idx;
    editBuffer = '';
    var el = body.querySelector('.hex-byte[data-idx="' + idx + '"]');
    if (el) el.classList.add('editing');
  }

  function stopEdit() {
    if (editingByte !== null) {
      var el = body.querySelector('.hex-byte[data-idx="' + editingByte + '"]');
      if (el) el.classList.remove('editing');
      if (editBuffer.length === 1) {
        // Partial input — apply as high nibble with 0 low nibble
        updateByte(editingByte, parseInt(editBuffer + '0', 16));
      }
    }
    editingByte = null;
    editBuffer = '';
  }

  // Click to start editing a byte
  body.addEventListener('click', function(e) {
    var byteEl = e.target.closest('.hex-byte');
    if (byteEl) {
      var idx = parseInt(byteEl.getAttribute('data-idx'), 10);
      startEdit(idx);
    }
  });

  // Keyboard input for hex editing
  function onKeyDown(e) {
    // J key: follow chain when not editing
    if (editingByte === null && e.ctrlKey && (e.key === 'j' || e.key === 'J')) {
      e.preventDefault();
      followChain();
      return;
    }
    if (editingByte === null) return;
    var hexChar = e.key.toUpperCase();

    if (/^[0-9A-F]$/.test(hexChar)) {
      e.preventDefault();
      editBuffer += hexChar;
      // Show partial input
      var el = body.querySelector('.hex-byte[data-idx="' + editingByte + '"]');
      if (el) el.textContent = editBuffer.padEnd(2, '_');

      if (editBuffer.length === 2) {
        var val = parseInt(editBuffer, 16);
        updateByte(editingByte, val);
        var curRow = Math.floor(editingByte / 8);
        var curCol = editingByte % 8;
        el.classList.remove('editing');
        if (curCol < 7) {
          // Move to next byte on same row
          startEdit(editingByte + 1);
        } else {
          // Last byte on row — stop editing
          stopEdit();
        }
      }
    } else if (e.key === 'Escape') {
      e.preventDefault();
      // Revert current byte to working value
      var el2 = body.querySelector('.hex-byte[data-idx="' + editingByte + '"]');
      if (el2) {
        el2.textContent = working[editingByte].toString(16).toUpperCase().padStart(2, '0');
        el2.classList.remove('editing');
      }
      editingByte = null;
      editBuffer = '';
    } else if (e.key === 'Tab') {
      e.preventDefault();
      var cur = editingByte;
      stopEdit();
      var next = e.shiftKey ? cur - 1 : cur + 1;
      if (next >= 0 && next < 256) startEdit(next);
    } else if (e.key === 'ArrowRight' && editBuffer.length === 0) {
      e.preventDefault();
      var cur2 = editingByte;
      stopEdit();
      if (cur2 < 255) startEdit(cur2 + 1);
    } else if (e.key === 'ArrowLeft' && editBuffer.length === 0) {
      e.preventDefault();
      var cur3 = editingByte;
      stopEdit();
      if (cur3 > 0) startEdit(cur3 - 1);
    }
  }

  document.addEventListener('keydown', onKeyDown);

  // Highlight on hover
  body.addEventListener('mouseover', function(e) {
    var t = e.target.closest('[data-idx]');
    if (!t) return;
    var idx = t.getAttribute('data-idx');
    body.querySelectorAll('.highlight').forEach(function(el) { el.classList.remove('highlight'); });
    body.querySelectorAll('[data-idx="' + idx + '"]').forEach(function(el) { el.classList.add('highlight'); });
  });
  body.addEventListener('mouseout', function(e) {
    var t = e.target.closest('[data-idx]');
    if (t) body.querySelectorAll('.highlight').forEach(function(el) { el.classList.remove('highlight'); });
  });

  // Close handlers
  function closeEditor(save) {
    document.removeEventListener('keydown', onKeyDown);
    if (save) {
      // Write working copy back to disk buffer
      for (var i = 0; i < 256; i++) data[off + i] = working[i];
      // Re-render disk view
      var info = parseCurrentDir(currentBuffer);
      renderDisk(info);
    }
    document.getElementById('modal-overlay').classList.remove('open');
    footer.className = origFooterClass;
    footer.innerHTML = origFooter;
    // Re-attach the OK button handler
    var closeBtn2 = document.getElementById('modal-close');
    if (closeBtn2) closeBtn2.addEventListener('click', function() {
      document.getElementById('modal-overlay').classList.remove('open');
    });
  }

  // Follow chain: jump to sector pointed to by bytes 0-1
  function followChain() {
    var nt = working[0], ns = working[1];
    if (nt === 0 || nt > currentTracks) return;
    if (ns >= currentFormat.sectorsPerTrack(nt)) return;
    saveCurrentAndNavigate(nt, ns);
  }
  // Back-navigate: find sector whose bytes 0-1 point to current T:S
  document.getElementById('hex-back').addEventListener('click', function() {
    var d2 = new Uint8Array(currentBuffer);
    for (var bt = 1; bt <= currentTracks; bt++) {
      var spt = currentFormat.sectorsPerTrack(bt);
      for (var bs = 0; bs < spt; bs++) {
        var boff = sectorOffset(bt, bs);
        if (boff < 0) continue;
        if (d2[boff] === track && d2[boff + 1] === sector) {
          saveCurrentAndNavigate(bt, bs);
          return;
        }
      }
    }
    showModal('Back Navigate', ['No sector found pointing to T:$' +
      track.toString(16).toUpperCase().padStart(2, '0') + ' S:$' +
      sector.toString(16).toUpperCase().padStart(2, '0')]);
  });

  document.getElementById('hex-follow').addEventListener('click', followChain);

  // Fill sector with a byte value
  document.getElementById('hex-fill-sec').addEventListener('click', async function() {
    var val = await showInputModal('Fill sector with hex byte (00-FF)', '00');
    if (val === null) return;
    var byte = parseInt(val.replace(/[\s\$]/g, ''), 16);
    if (isNaN(byte) || byte < 0 || byte > 255) return;
    for (var fi = 0; fi < 256; fi++) { updateByte(fi, byte); }
  });

  // Copy sector bytes to internal clipboard
  document.getElementById('hex-copy-sec').addEventListener('click', function() {
    sectorClipboard = new Uint8Array(working);
    document.getElementById('hex-paste-sec').disabled = false;
  });

  // Paste sector from clipboard
  document.getElementById('hex-paste-sec').addEventListener('click', function() {
    if (!sectorClipboard) return;
    for (var pi = 0; pi < 256; pi++) { updateByte(pi, sectorClipboard[pi]); }
  });

  document.getElementById('hex-save').addEventListener('click', function() { closeEditor(true); });
  document.getElementById('hex-cancel').addEventListener('click', function() { closeEditor(false); });
}

document.getElementById('opt-edit-sector').addEventListener('click', function(e) {
  e.stopPropagation();
  if (!currentBuffer || selectedEntryIndex < 0) return;
  closeMenus();

  // Find which directory sector this entry is in
  var slots = getDirSlotOffsets(currentBuffer);
  var slotIdx = slots.indexOf(selectedEntryIndex);
  var dirSectorIdx = Math.floor(slotIdx / currentFormat.entriesPerSector);
  var data = new Uint8Array(currentBuffer);
  var dt = currentFormat.dirTrack, ds = currentFormat.dirSector;
  var visited = new Set();
  for (var i = 0; i < dirSectorIdx && dt !== 0; i++) {
    var key = dt + ':' + ds;
    if (visited.has(key)) break;
    visited.add(key);
    var doff = sectorOffset(dt, ds);
    dt = data[doff]; ds = data[doff + 1];
  }

  showSectorHexEditor(dt, ds);
});

document.getElementById('opt-edit-file-sector').addEventListener('click', function(e) {
  e.stopPropagation();
  if (!currentBuffer || selectedEntryIndex < 0) return;
  closeMenus();

  // Get the file's starting track/sector from the directory entry
  var data = new Uint8Array(currentBuffer);
  var ft = data[selectedEntryIndex + 3];
  var fs = data[selectedEntryIndex + 4];
  if (ft === 0) return; // no file data

  showSectorHexEditor(ft, fs);
});

