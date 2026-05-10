// ── Turbo Assembler viewer ────────────────────────────────────────────
// TASS V5.x source format (reverse-engineered): header (16 bytes) with
// magic $FF at offset $0F. Source body is stored in REVERSE display
// order, $80-delimited. Labels live in an ASCII table at end of file
// (last char of each name has bit 7 set). Instructions are 6502 opcode
// bytes plus operand prefixes ($28 hex byte, $29 hex word, $2A decimal,
// $38/$39 label-ref). Label-defs are `$30 NN`.

// Apply the user's charset-mode case to Latin text (labels/comments).
// `.text` directives respect mode via the PUA glyphs in PETSCII_MAP;
// this is the equivalent for Latin fallback rendering.
function tassDisplayCase(s) {
  return (typeof charsetMode !== 'undefined' && charsetMode === 'lowercase')
    ? s.toLowerCase() : s.toUpperCase();
}

// 151 official 6502 opcodes. Note that some opcode bytes ($28/$30/$38
// etc.) double as TASS operand-prefix markers — those are disambiguated
// in the tokenizer before this table is consulted.
var TASS_OPCODES = {
  // ORA
  0x01:['ora','izx'], 0x05:['ora','zp'], 0x09:['ora','imm'], 0x0D:['ora','abs'],
  0x11:['ora','iny'], 0x15:['ora','zpx'], 0x19:['ora','abs-y'], 0x1D:['ora','abs-x'],
  // AND
  0x21:['and','izx'], 0x25:['and','zp'], 0x29:['and','imm'], 0x2D:['and','abs'],
  0x31:['and','iny'], 0x35:['and','zpx'], 0x39:['and','abs-y'], 0x3D:['and','abs-x'],
  // EOR
  0x41:['eor','izx'], 0x45:['eor','zp'], 0x49:['eor','imm'], 0x4D:['eor','abs'],
  0x51:['eor','iny'], 0x55:['eor','zpx'], 0x59:['eor','abs-y'], 0x5D:['eor','abs-x'],
  // ADC
  0x61:['adc','izx'], 0x65:['adc','zp'], 0x69:['adc','imm'], 0x6D:['adc','abs'],
  0x71:['adc','iny'], 0x75:['adc','zpx'], 0x79:['adc','abs-y'], 0x7D:['adc','abs-x'],
  // STA
  0x81:['sta','izx'], 0x85:['sta','zp'], 0x8D:['sta','abs'],
  0x91:['sta','iny'], 0x95:['sta','zpx'], 0x99:['sta','abs-y'], 0x9D:['sta','abs-x'],
  // LDA
  0xA1:['lda','izx'], 0xA5:['lda','zp'], 0xA9:['lda','imm'], 0xAD:['lda','abs'],
  0xB1:['lda','iny'], 0xB5:['lda','zpx'], 0xB9:['lda','abs-y'], 0xBD:['lda','abs-x'],
  // CMP
  0xC1:['cmp','izx'], 0xC5:['cmp','zp'], 0xC9:['cmp','imm'], 0xCD:['cmp','abs'],
  0xD1:['cmp','iny'], 0xD5:['cmp','zpx'], 0xD9:['cmp','abs-y'], 0xDD:['cmp','abs-x'],
  // SBC
  0xE1:['sbc','izx'], 0xE5:['sbc','zp'], 0xE9:['sbc','imm'], 0xED:['sbc','abs'],
  0xF1:['sbc','iny'], 0xF5:['sbc','zpx'], 0xF9:['sbc','abs-y'], 0xFD:['sbc','abs-x'],
  // ASL
  0x06:['asl','zp'], 0x0A:['asl','acc'], 0x0E:['asl','abs'],
  0x16:['asl','zpx'], 0x1E:['asl','abs-x'],
  // ROL
  0x26:['rol','zp'], 0x2A:['rol','acc'], 0x2E:['rol','abs'],
  0x36:['rol','zpx'], 0x3E:['rol','abs-x'],
  // LSR
  0x46:['lsr','zp'], 0x4A:['lsr','acc'], 0x4E:['lsr','abs'],
  0x56:['lsr','zpx'], 0x5E:['lsr','abs-x'],
  // ROR
  0x66:['ror','zp'], 0x6A:['ror','acc'], 0x6E:['ror','abs'],
  0x76:['ror','zpx'], 0x7E:['ror','abs-x'],
  // STX / LDX / STY / LDY / DEC / INC / CPX / CPY / BIT
  0x84:['sty','zp'], 0x8C:['sty','abs'], 0x94:['sty','zpx'],
  0xA4:['ldy','zp'], 0xAC:['ldy','abs'], 0xB4:['ldy','zpx'], 0xBC:['ldy','abs-x'],
  0xC4:['cpy','zp'], 0xCC:['cpy','abs'], 0xC0:['cpy','imm'],
  0x86:['stx','zp'], 0x8E:['stx','abs'], 0x96:['stx','zpy'],
  0xA6:['ldx','zp'], 0xAE:['ldx','abs'], 0xB6:['ldx','zpy'], 0xBE:['ldx','abs-y'],
  0xE4:['cpx','zp'], 0xEC:['cpx','abs'], 0xE0:['cpx','imm'],
  0xA2:['ldx','imm'], 0xA0:['ldy','imm'],
  0xC6:['dec','zp'], 0xCE:['dec','abs'], 0xD6:['dec','zpx'], 0xDE:['dec','abs-x'],
  0xE6:['inc','zp'], 0xEE:['inc','abs'], 0xF6:['inc','zpx'], 0xFE:['inc','abs-x'],
  0x24:['bit','zp'], 0x2C:['bit','abs'],
  // Jumps
  0x4C:['jmp','abs'], 0x6C:['jmp','ind'], 0x20:['jsr','abs'],
  // Branches (all rel)
  0x10:['bpl','rel'], 0x30:['bmi','rel'], 0x50:['bvc','rel'], 0x70:['bvs','rel'],
  0x90:['bcc','rel'], 0xB0:['bcs','rel'], 0xD0:['bne','rel'], 0xF0:['beq','rel'],
  // Implied / register
  0x00:['brk','none'], 0x40:['rti','none'], 0x60:['rts','none'],
  0x08:['php','none'], 0x28:['plp','none'], 0x48:['pha','none'], 0x68:['pla','none'],
  0x18:['clc','none'], 0x38:['sec','none'], 0x58:['cli','none'], 0x78:['sei','none'],
  0xB8:['clv','none'], 0xD8:['cld','none'], 0xF8:['sed','none'],
  0x88:['dey','none'], 0xC8:['iny','none'], 0xCA:['dex','none'], 0xE8:['inx','none'],
  0xAA:['tax','none'], 0xA8:['tay','none'], 0xBA:['tsx','none'],
  0x8A:['txa','none'], 0x9A:['txs','none'], 0x98:['tya','none'],
  0xEA:['nop','none']
};

function isTassSource(fileData) {
  if (!fileData || fileData.length < 0x20) return false;
  // Magic at $0F is always $FF; the byte at $0E is editor-state (varies)
  // but always < $20 in real TASS files.
  return fileData[0x0F] === 0xFF && fileData[0x0E] < 0x20;
}

function tassParseLabels(data) {
  var labels = [];
  // Label table = sequence of label-format runs (chars + high-bit
  // terminator). Some files embed "screen-code" comment/data blocks
  // between runs, so we anchor on the LONGEST run with a terminator
  // and parse from there to end-of-file, skipping non-label bytes.
  function isLabelChar(b) {
    return (b >= 0x41 && b <= 0x5A) || (b >= 0x30 && b <= 0x39) ||
           b === 0x2E || b === 0x5F;
  }
  // Terminator = last char of name with bit 7 set. Excludes $C0 (decorative).
  function isLabelTerm(b) {
    return (b >= 0xC1 && b <= 0xDA) || (b >= 0xB0 && b <= 0xB9) || b === 0xAE || b === 0xDF;
  }
  function isLabelByte(b) { return isLabelChar(b) || isLabelTerm(b); }

  // Anchor on the longest label-format run with a high-bit terminator
  // (min length 3 to tolerate small test files).
  var anchor = -1;
  var anchorLen = 0;
  var runStart = -1, runLen = 0, runHasTerm = false;
  function consider(start, len, hasTerm) {
    if (len >= 3 && hasTerm && len > anchorLen) {
      anchor = start;
      anchorLen = len;
    }
  }
  for (var i = 0; i < data.length; i++) {
    if (isLabelByte(data[i])) {
      if (runLen === 0) { runStart = i; runHasTerm = false; }
      runLen++;
      if (isLabelTerm(data[i])) runHasTerm = true;
    } else {
      consider(runStart, runLen, runHasTerm);
      runLen = 0;
    }
  }
  consider(runStart, runLen, runHasTerm);
  if (anchor < 0) return { labels: labels, start: data.length };

  // Lone high-bit bytes outside the strict terminator range (e.g. $9F,
  // $A0 inside embedded comment data) are dummy slots — TASS reserves
  // an index but leaves the name empty. Track them so later labels keep
  // their absolute-index numbering.
  function isDummyTerm(b) {
    return (b >= 0x80 && b <= 0xAD) || b === 0xAF || (b >= 0xBA && b <= 0xC0) ||
           (b >= 0xDB && b <= 0xDE) || (b >= 0xE0 && b <= 0xFA);
  }

  // Skip stale leading bytes that some files leave before the first real
  // label (leftover editor state from earlier edits). Three observed
  // patterns: "X Y X term" (1 stale char + 3-char label), lone terminator
  // before a label-char, and 2 stale digits before an uppercase letter.
  var p = anchor;
  if (anchor + 3 < data.length &&
      isLabelChar(data[anchor]) &&
      data[anchor] === data[anchor + 2] &&
      isLabelTerm(data[anchor + 3])) {
    p = anchor + 1;
  }
  if (p < data.length && isLabelTerm(data[p]) &&
      p + 1 < data.length && isLabelChar(data[p + 1])) {
    p++;
  }
  if (p + 3 < data.length &&
      data[p] >= 0x30 && data[p] <= 0x39 &&
      data[p + 1] >= 0x30 && data[p + 1] <= 0x39 &&
      data[p + 2] >= 0x41 && data[p + 2] <= 0x5A) {
    p += 2;
  }
  var gap = 0;
  while (p < data.length && gap < 64) {
    var b = data[p];
    if (isLabelByte(b)) {
      // 0+ label-chars followed by one terminator. A lone terminator
      // byte ($C4 = "D", etc.) encodes a 1-char label.
      var name = '';
      var closed = false;
      var pStart = p;
      while (p < data.length) {
        var x = data[p];
        if (isLabelChar(x)) { name += String.fromCharCode(x); p++; }
        else if (isLabelTerm(x)) { name += String.fromCharCode(x - 0x80); p++; closed = true; break; }
        else break;
      }
      if (name.length > 0 && closed) { labels.push(tassDisplayCase(name)); gap = 0; }
      else { gap += Math.max(1, p - pStart); if (p === pStart) p++; }
    } else if (isDummyTerm(b)) {
      // Placeholder slot: empty name so indices keep aligning with refs.
      labels.push('');
      p++;
      gap = 0;
    } else { gap++; p++; }
  }
  return { labels: labels, start: anchor };
}

// TASS operator bytes ($40-$4B). Note unusual syntax: `&` is AND, `.`
// is OR, `:` is EOR. We preserve source characters in the display.
var TASS_OPERATORS = {
  0x40:'+', 0x41:'-', 0x42:'*', 0x43:'/',
  0x44:'>', 0x45:'<', 0x46:'!', 0x47:'&',
  0x48:'.', 0x49:':', 0x4A:'(', 0x4B:')'
};

// Value-introducing prefix bytes. `lblIdx` flags those that reference a label
// index (caller validates against labels.length).
var TASS_OPERAND_PFX = {
  0x20: true,  // expression with literal-leading byte ($20 LIT [OP RHS…])
  0x21: true,  // expression with literal-leading word ($21 LO HI [OP RHS…])
  0x22: true,  // expression with literal-leading byte ($22 LIT [OP RHS...]) — alt form
  0x25: true,  // current PC with expression following (`*-3` = $25 $41 $2A $03)
  0x28: true,  // hex byte ($XX)
  0x29: true,  // hex word ($XXXX)
  0x2A: true,  // decimal byte
  0x2C: true,  // binary byte (%nnnnnnnn)
  0x2D: true,  // current PC (*) standalone (no expression)
  0x2E: true,  // char/string ("X")
  0x30: { lblIdx: true },   // label-with-expression
  0x38: { lblIdx: true },   // label-ref low page
  0x39: { lblIdx: true, lblPage: 1 } // label-ref high page
};

// Decode a single TASS "primary" value at `pos`: a value-prefix + value bytes,
// or a unary operator + primary, or a parenthesized sub-expression.
// Returns { text, n }.
function tassDecodePrimary(data, pos, end, labels) {
  if (pos >= end) return { text: '?', n: 0 };
  var pfx = data[pos];
  // Open paren: parse the inner expression, expect $4B or $5B close.
  if (pfx === 0x4A) {
    var inner = tassDecodeValue(data, pos + 1, end, labels);
    var after = pos + 1 + inner.n;
    var nClose = (after < end && (data[after] === 0x4B || data[after] === 0x5B)) ? 1 : 0;
    return { text: '(' + inner.text + ')', n: 1 + inner.n + nClose };
  }
  // Unary operator (>, <, !, etc.): operator byte then sub-primary. Skip
  // close-paren bytes ($4B/$5B) since they're not unary.
  if (TASS_OPERATORS[pfx] && pfx !== 0x4B && pfx !== 0x5B) {
    var sub = tassDecodePrimary(data, pos + 1, end, labels);
    return { text: TASS_OPERATORS[pfx] + sub.text, n: 1 + sub.n };
  }
  // Value prefixes
  if (pfx === 0x20) {
    // Byte-literal-leading expression (chains operators in tassDecodeValue).
    return { text: '$' + (data[pos+1]||0).toString(16).padStart(2,'0'), n: 2 };
  }
  if (pfx === 0x21) {
    // Word-literal-leading expression (chains operators).
    var wlo = data[pos+1]||0, whi = data[pos+2]||0;
    return { text: '$' + (((whi<<8)|wlo)>>>0).toString(16).padStart(4,'0'), n: 3 };
  }
  if (pfx === 0x22) { return { text: (data[pos+1]||0).toString(), n: 2 }; }
  if (pfx === 0x28) { return { text: '$' + (data[pos+1]||0).toString(16).padStart(2,'0'), n: 2 }; }
  if (pfx === 0x29) {
    var lo = data[pos+1]||0, hi = data[pos+2]||0;
    return { text: '$' + ((hi<<8)|lo).toString(16).padStart(4,'0'), n: 3 };
  }
  if (pfx === 0x2A) { return { text: (data[pos+1]||0).toString(), n: 2 }; }
  if (pfx === 0x2C) { return { text: '%' + (data[pos+1]||0).toString(2).padStart(8,'0'), n: 2 }; }
  if (pfx === 0x2D) { return { text: '*', n: 1 }; }
  // $25 = current PC `*` in expression context (chains operators);
  // $2D is the standalone form.
  if (pfx === 0x25) { return { text: '*', n: 1 }; }
  if (pfx === 0x2E) {
    // Char-immediate `#"X"`. Use the PUA glyph from petsciiToAscii so
    // control codes ($00-$1F, $80-$9F) render as inverse, like `.text`.
    var cb = (data[pos+1]||0);
    var glyph = petsciiToAscii(cb);
    var rev = (cb <= 0x1F) || (cb >= 0x80 && cb <= 0x9F);
    var txt = '"' + glyph + '"';
    var html = rev
      ? '"<span class="petscii-rev">' + escHtml(glyph) + '</span>"'
      : '"' + escHtml(glyph) + '"';
    return { text: txt, html: html, n: 2 };
  }
  if (pfx === 0x30) {
    var lidx = data[pos+1]||0;
    return { text: labels[lidx] || ('?lbl' + lidx), n: 2 };
  }
  if (pfx === 0x38 || pfx === 0x39) {
    var idx = (pfx - 0x38) * 256 + (data[pos+1]||0);
    return { text: labels[idx] || ('?lbl' + idx), n: 2 };
  }
  return { text: '?$' + pfx.toString(16), n: 1 };
}

// Decode primary + chain of (binary-op + primary). Only chains in
// EXPRESSION context (started by $20-$22/$25/$30/$4A or unary op) —
// otherwise an operator byte after a plain value-prefix is the start
// of the NEXT instruction, not a chain operator.
function tassDecodeValue(data, pos, end, labels) {
  var result = tassDecodePrimary(data, pos, end, labels);
  var firstByte = data[pos];
  var inExpression = firstByte === 0x20 || firstByte === 0x21 || firstByte === 0x22 ||
                     firstByte === 0x25 || firstByte === 0x30 || firstByte === 0x4A ||
                     (TASS_OPERATORS[firstByte] && firstByte !== 0x4B && firstByte !== 0x5B);
  if (!inExpression) return result;
  while (true) {
    var nextPos = pos + result.n;
    if (nextPos >= end) break;
    var op = data[nextPos];
    if (op === 0x4A || op === 0x4B || op === 0x5B) break;
    if (!TASS_OPERATORS[op]) break;
    // $49 (`:`) doubles as EOR-imm opcode. `: byte` XOR inside an
    // address operand is exotic; `eor #$NN` is the everyday
    // interpretation. Break to let the main loop pick it up.
    if (op === 0x49 && nextPos + 1 < end && TASS_OPERAND_PFX[data[nextPos + 1]]) break;
    var rhs = tassDecodePrimary(data, nextPos + 1, end, labels);
    var newText = result.text + TASS_OPERATORS[op] + rhs.text;
    // Carry html when either side needs it (`.text`-style reversed-char
    // spans); plain sides get escaped.
    var newHtml = null;
    if (result.html != null || rhs.html != null) {
      var lhsH = result.html != null ? result.html : escHtml(result.text);
      var rhsH = rhs.html != null ? rhs.html : escHtml(rhs.text);
      newHtml = lhsH + escHtml(TASS_OPERATORS[op]) + rhsH;
    }
    result = { text: newText, n: result.n + 1 + rhs.n };
    if (newHtml != null) result.html = newHtml;
  }
  return result;
}

// Lookahead: does `data[pos]` start an instruction-shaped sequence
// (real opcode-with-operand / label-def / directive / col-marker /
// padding)? Used to disambiguate col-marker-range bytes that double
// as implied opcodes ($88/$8A/$98/$9A) or operand-taking opcodes.
function tassImpliedOpcodeFollows(data, pos, end, labels) {
  if (pos >= end) return true;
  var nb = data[pos];
  if (tassIsValidOpcodeStart(data, pos, end, labels)) return true;
  var op = TASS_OPCODES[nb];
  if (op && (op[1] === 'none' || op[1] === 'acc')) return true;
  if (nb === 0x30 || nb === 0x31) return true;                    // label-def
  if (nb === 0x02 || nb === 0x03 || nb === 0x04 ||
      nb === 0x05 || nb === 0x06) return true;                    // directives
  if (nb >= 0x80 && nb <= 0xA7) return true;                      // col-marker / line-end
  if (nb === 0x00 || nb === 0xC0) return true;                    // padding / end
  return false;
}

// Does `data[opPos]` start a valid 6502-opcode-with-operand sequence?
// Implied/acc-mode opcodes return false (they have no prefix to
// validate; the main loop handles them directly). For prefixes that
// double as ASCII text in comments ($38='8', $30='0', $44='D' etc.)
// we additionally validate that label-ref indices are in range.
function tassIsValidOpcodeStart(data, opPos, end, labels) {
  if (opPos >= end) return false;
  var op = TASS_OPCODES[data[opPos]];
  if (!op) return false;
  var mode = op[1];
  if (mode === 'none' || mode === 'acc') return false;
  if (opPos + 1 >= end) return false;
  // Skip past unary operators and open-parens to find the value prefix.
  // E.g. `lda #>label` = $A9 $44 $38 IDX ; `lda (1+2)` = $AD $4A $22 …
  var probePos = opPos + 1;
  while (probePos < end) {
    var pb = data[probePos];
    if (pb === 0x4A) { probePos++; continue; }                // open paren
    if (TASS_OPERATORS[pb] && pb !== 0x4B && pb !== 0x5B) {   // unary op (not close)
      probePos++; continue;
    }
    break;
  }
  if (probePos >= end) return false;
  var pfxByte = data[probePos];
  var pfxInfo = TASS_OPERAND_PFX[pfxByte];
  if (!pfxInfo) return false;
  // $2E (char-imm `#"X"`) is only valid in IMM mode — it doubles as
  // ROL abs opcode, so `$2E $2E $XX` would otherwise parse as
  // `rol "X"` from comment-text dots.
  if (pfxByte === 0x2E && mode !== 'imm') return false;
  // Expression-leading prefixes need a full `primary + operator +
  // value-prefix` shape. Operators $40-$4B double as letters '@'-'K',
  // so requiring just the operator falsely matches comment text like
  // "00 IS" ($30 $30 $20 $49 $53, where $49 = ':' operator). The
  // value-prefix tail rules that out.
  if (pfxByte === 0x20 || pfxByte === 0x21 || pfxByte === 0x22 || pfxByte === 0x30) {
    var primaryLen = (pfxByte === 0x21) ? 3 : 2;
    if (probePos + primaryLen + 1 >= end) return false;
    if (pfxByte === 0x30 && data[probePos + 1] >= labels.length) return false;
    var op30 = data[probePos + primaryLen];
    if (!TASS_OPERATORS[op30] || op30 === 0x4B || op30 === 0x5B) return false;
    var tailPfx = data[probePos + primaryLen + 1];
    if (TASS_OPERAND_PFX[tailPfx] === undefined) return false;
    // Real TASS expressions never nest expression-leading prefixes —
    // `$20 LIT op $20` is exclusively a comment-text false positive.
    if ((pfxByte === 0x20 || pfxByte === 0x22) &&
        (tailPfx === 0x20 || tailPfx === 0x22)) return false;
    // `$22 LIT` with a printable-ASCII outer opcode collides with
    // [comment-byte][`lda #>label` = $A9 $44 $38 NN]. When the LIT
    // byte is itself a clean opcode start, prefer that reading.
    if (pfxByte === 0x22) {
      var outerOp = data[opPos];
      if (outerOp >= 0x20 && outerOp <= 0x7E && probePos + 1 < end &&
          tassIsValidOpcodeStart(data, probePos + 1, end, labels)) {
        return false;
      }
    }
    return true;
  }
  if (pfxByte === 0x25) {
    // 1-byte primary (just `*`): operator at probePos+1, value-prefix
    // at probePos+2
    if (probePos + 2 >= end) return false;
    var op25 = data[probePos + 1];
    if (!TASS_OPERATORS[op25] || op25 === 0x4B || op25 === 0x5B) return false;
    return TASS_OPERAND_PFX[data[probePos + 2]] !== undefined;
  }
  if (pfxByte === 0x2D) {
    // Standalone `*` (current PC). Require the byte AFTER to look like
    // a clean line/instruction transition; otherwise the bytes are
    // probably comment text like "0-" or "$500-".
    if (probePos + 1 >= end) return true;
    var afterStar = data[probePos + 1];
    if (afterStar === 0x00) return true;
    if (afterStar >= 0x80 && afterStar <= 0xA7) return true;
    if (afterStar === 0x02 || afterStar === 0x03 ||
        afterStar === 0x04 || afterStar === 0x06) return true;
    if (afterStar === 0x30 || afterStar === 0x31) return true;
    if (TASS_OPCODES[afterStar]) {
      var nextProbe = probePos + 2;
      if (TASS_OPCODES[afterStar][1] === 'none' ||
          TASS_OPCODES[afterStar][1] === 'acc') return true;
      if (nextProbe < end && TASS_OPERAND_PFX[data[nextProbe]]) return true;
    }
    return false;
  }
  if (pfxInfo === true) return true;
  if (pfxInfo.lblIdx) {
    if (probePos + 1 >= end) return false;
    var page = pfxInfo.lblPage || 0;
    return (page * 256 + data[probePos + 1]) < labels.length;
  }
  return true;
}

function tassDecodeOperand(data, pos, opInfo, labels) {
  var mode = opInfo[1];
  if (mode === 'none') return { text: '', n: 0 };
  // Accumulator mode: TASS writes `a` explicitly to disambiguate from
  // the zero-page form (`rol $10` vs `rol a`).
  if (mode === 'acc') return { text: 'a', n: 0 };
  if (pos >= data.length) return { text: '', n: 0 };
  var v = tassDecodeValue(data, pos, data.length, labels);
  function withSuffix(prefix, suffix) {
    var r = { text: prefix + v.text + suffix, n: v.n };
    if (v.html != null) r.html = prefix + v.html + suffix;
    return r;
  }
  if (mode === 'imm') return withSuffix('#', '');
  if (mode === 'rel') return v; // branches: just the target
  if (mode === 'abs-x' || mode === 'zpx') return withSuffix('', ',x');
  if (mode === 'abs-y' || mode === 'zpy') return withSuffix('', ',y');
  if (mode === 'iny') return withSuffix('(', '),y');
  if (mode === 'izx') return withSuffix('(', ',x)');
  if (mode === 'ind') return withSuffix('(', ')');
  return withSuffix('', ''); // abs / zp
}

function tassTokenizeBlock(data, start, end, labels) {
  var lines = [];
  var cur = { label: null, instr: null, operand: null, comment: null, commentCol: -1, isData: false };
  var unknownRun = [];
  function flushData() {
    if (unknownRun.length === 0) return;
    var parts = [];
    for (var k = 0; k < unknownRun.length; k++) parts.push('$' + unknownRun[k].toString(16).padStart(2, '0'));
    lines.push({ label: null, instr: '.byte', operand: parts.join(','), comment: null, commentCol: -1, isData: true });
    unknownRun = [];
  }
  function flush() {
    flushData();
    // Keep an empty comment marker only when paired with label/instr
    // (TASS stores e.g. `joy0 .byte $04 ;` with a marker but no text).
    // Standalone empty `;` markers are structural noise — drop them.
    var hasContent = cur.label || cur.instr || cur.comment;
    var emptyMarkerOnInstrLine = (cur.commentCol >= 0) && (cur.label || cur.instr);
    if (hasContent || emptyMarkerOnInstrLine) lines.push(cur);
    cur = { label: null, instr: null, operand: null, comment: null, commentCol: -1, isData: false };
  }
  var i = start;
  while (i < end) {
    var b = data[i];
    // Comment column markers: $80-$A7 = `;` at column 0-39. Many bytes
    // in this range are also 6502 opcodes — disambiguate by the next
    // byte, with extra peek-ahead logic for the implied-opcode bytes
    // ($88/$8A/$98/$9A) and label-ref-operand opcodes (which back-to-
    // back `jsr label ;comment` rows can mimic).
    var commentCol = -1;
    if (b >= 0x80 && b <= 0xA7) {
      var validOpHere = tassIsValidOpcodeStart(data, i, end, labels);
      if (!validOpHere) {
        if (b === 0x88 || b === 0x8A || b === 0x98 || b === 0x9A) {
          if (!tassImpliedOpcodeFollows(data, i + 1, end, labels)) {
            commentCol = b - 0x80;
          }
        } else {
          commentCol = b - 0x80;
        }
      } else if (i + 3 < end && (data[i + 1] === 0x38 || data[i + 1] === 0x39)) {
        if (!tassImpliedOpcodeFollows(data, i + 3, end, labels)) {
          commentCol = b - 0x80;
        }
      }
    }
    if (commentCol >= 0) {
      flushData();
      // Trailing `;` at column N belongs on the same row only when N is
      // past where existing content ends; otherwise it's a new row.
      if (cur.label || cur.instr) {
        var curEnd = (cur.label ? 9 : 9);
        if (cur.instr) curEnd += cur.instr.length;
        if (cur.operand) curEnd += 1 + cur.operand.length;
        if (commentCol < curEnd) flush();
      }
      i++;
      var text = '';
      // Read comment text until a byte that clearly starts a new
      // instruction/directive/label-def. Printable PETSCII (including
      // digits and shifted letters $C1-$DA) is text; $2D is literal `-`.
      function petsciiToLetter(b) {
        // C64 PETSCII glyphs that ASCII renders wrong:
        //   $5E = ↑ (up arrow), $5F = ← (left arrow)
        if (b === 0x5E) return '↑';
        if (b === 0x5F) return '←';
        // Unshifted PETSCII: byte value is the natural-case Latin letter.
        // Render in the case the user's charset mode would show it as.
        if (b >= 0x20 && b <= 0x7E) return tassDisplayCase(String.fromCharCode(b));
        if (b === 0xA0) return ' ';
        // Shifted PETSCII: in lowercase mode renders UPPERCASE, in
        // uppercase mode renders graphics (Latin fallback = opposite case
        // from unshifted in the same mode).
        if (b >= 0xC1 && b <= 0xDA) {
          var c = String.fromCharCode(b - 0x80);
          return (typeof charsetMode !== 'undefined' && charsetMode === 'lowercase')
            ? c.toUpperCase() : c.toLowerCase();
        }
        return null;
      }
      // A comment occupies the row from `;` to col 39 (the C64 screen edge),
      // so its body is at most (40 - commentCol - 1) chars wide. This stops
      // a col-0 rule line from absorbing the next instruction byte (e.g.
      // $60 RTS = '`' backtick) after exactly the screen-width worth of
      // content has been read.
      var maxCommentLen = 40 - commentCol - 1;
      while (i < end) {
        if (text.length >= maxCommentLen) break;
        var c = data[i];
        // $A0 inside comment text is usually the PETSCII shifted-space
        // (NBSP) — but it's ALSO LDY-imm opcode. Disambiguate the same way
        // as the outer $80-$A7 check: if it's followed by a valid TASS
        // operand prefix, it's a real instruction starting after the
        // comment, so break. Otherwise treat as space and continue. This
        // stops `sta ($ae),y ;NAME(NBSP)$A0 $28 $00` (= `ldy #$00`) from
        // appending " (" to the previous comment.
        if (c === 0xA0) {
          if (tassIsValidOpcodeStart(data, i, end, labels)) break;
          text += ' '; i++; continue;
        }
        // Another comment marker ($80-$A7) ends this comment.
        if (c >= 0x80 && c <= 0xA7 && !tassIsValidOpcodeStart(data, i, end, labels)) {
          if (c === 0x88 || c === 0x8A || c === 0x98 || c === 0x9A) {
            if (!tassImpliedOpcodeFollows(data, i + 1, end, labels)) break;
          } else {
            break;
          }
        }
        // $2D is `-` in comments (`$2D` = AND-abs as opcode, but `-` in
        // comments is overwhelmingly more likely).
        if (c === 0x2D) { text += '-'; i++; continue; }
        // Implied-mode opcode ($60 RTS, $40 RTI, etc.) followed by a
        // real opcode-start = real instruction sequence, not text.
        var thisOp = TASS_OPCODES[c];
        if (thisOp && (thisOp[1] === 'none' || thisOp[1] === 'acc') &&
            i + 1 < end && tassIsValidOpcodeStart(data, i + 1, end, labels)) {
          break;
        }
        // Real instruction shapes that collide with comment text. For
        // printable-PETSCII opcodes ($20-$7E) we additionally have
        // hex-literal context heuristics — `;$d018` style addresses
        // chain bytes that match opcode patterns by accident.
        if (tassIsValidOpcodeStart(data, i, end, labels)) {
          // Hex-literal CONTINUATION: text already starts with `$` + hex
          // digits and current byte is a digit.
          var cIsDigit = c >= 0x30 && c <= 0x39;
          var inHexLitCtx = false;
          if (cIsDigit && text.length > 0 && text.charCodeAt(0) === 0x24) {
            inHexLitCtx = true;
            for (var hk3 = 1; hk3 < text.length; hk3++) {
              var hc3 = text.charCodeAt(hk3);
              if (!((hc3 >= 0x30 && hc3 <= 0x39) || (hc3 >= 0x61 && hc3 <= 0x66) ||
                    (hc3 >= 0x41 && hc3 <= 0x46))) { inHexLitCtx = false; break; }
            }
          }
          // Hex-literal START: `$` followed by 2+ hex-digit chars
          // (mid-comment hex address like `- $0EC0 - $0EFF`).
          if (!inHexLitCtx && c === 0x24 && i + 2 < end) {
            var hxK = i + 1, hxN = 0;
            while (hxK < end && hxN < 8) {
              var hxB = data[hxK];
              if ((hxB >= 0x30 && hxB <= 0x39) || (hxB >= 0x41 && hxB <= 0x46) ||
                  (hxB >= 0x61 && hxB <= 0x66)) { hxK++; hxN++; }
              else break;
            }
            if (hxN >= 2) inHexLitCtx = true;
          }
          if (inHexLitCtx) {
            var letterHex = petsciiToLetter(c);
            if (letterHex !== null) { text += letterHex; i++; continue; }
          }
          var opByte = c;
          var shouldBreak = opByte < 0x20 || opByte > 0x7E;
          if (!shouldBreak) {
            var pfx = data[i + 1];
            // Label-ref prefix ($38/$39) = strong real-instruction signal.
            if (pfx === 0x38 || pfx === 0x39) {
              shouldBreak = true;
            } else if (pfx === 0x20 || pfx === 0x21 || pfx === 0x22 ||
                       pfx === 0x25 || pfx === 0x30) {
              // Expression-leading: require primary + operator +
              // value-prefix tail (operators $40-$4B are also letters
              // 'A'-'K', so the operator alone matches text by accident).
              var primaryLen = (pfx === 0x25) ? 1 : (pfx === 0x21 ? 3 : 2);
              var afterPrimary = i + 1 + primaryLen;
              if (afterPrimary + 1 < end) {
                var opAfter = data[afterPrimary];
                if (TASS_OPERATORS[opAfter] && opAfter !== 0x4B && opAfter !== 0x5B
                    && TASS_OPERAND_PFX[data[afterPrimary + 1]]) {
                  shouldBreak = true;
                }
              }
            } else {
              // Real instruction operands have non-printable high
              // bytes (e.g. addresses $D000+); pure comment text doesn't.
              var operandLen = (pfx === 0x29) ? 2 : 1;
              for (var ob = 0; ob < operandLen && i + 2 + ob < end; ob++) {
                var bv = data[i + 2 + ob];
                if (bv >= 0x80 && bv <= 0xBF) continue;
                if (bv < 0x20 || bv > 0x7E) { shouldBreak = true; break; }
              }
            }
          }
          if (shouldBreak) break;
        }
        // Directive markers at the start of a line.
        if (c === 0x02 && i + 1 < end) {
          var tl = data[i + 1];
          if (tl > 0 && tl <= 64 && i + 2 + tl <= end) {
            var ok = true;
            for (var tz = 0; tz < tl; tz++) {
              var cc2 = data[i + 2 + tz];
              if (cc2 < 0x20 || cc2 > 0x7E) { ok = false; break; }
            }
            if (ok) break;
          }
        }
        if ((c === 0x03 || c === 0x04) && i + 1 < end) {
          var dnx = data[i + 1];
          if (dnx === 0x28 || dnx === 0x29 || dnx === 0x2A || dnx === 0x38 || dnx === 0x39) break;
        }
        if (c === 0x06 && i + 1 < end) {
          var onx = data[i + 1];
          if (onx === 0x28 || onx === 0x29) break;
        }
        // Label-def `$30/$31 IDX` followed by a real new instruction →
        // break (the label-def starts a new source line).
        if ((c === 0x30 || c === 0x31) && i + 2 < end) {
          var lbNN = data[i + 1];
          var lbIdx = (c - 0x30) * 256 + lbNN;
          if (lbIdx < labels.length) {
            var ahead = data[i + 2];
            var aheadIsValidOpStart = tassIsValidOpcodeStart(data, i + 2, end, labels);
            // Implied/acc opcodes (RTS/RTI/PHA/etc.) need their own
            // lookahead since they don't register as valid opcode starts.
            var aheadOp = TASS_OPCODES[ahead];
            var aheadIsImplied = aheadOp && (aheadOp[1] === 'none' || aheadOp[1] === 'acc');
            var impliedThenInstr = aheadIsImplied && i + 3 < end && (
                tassIsValidOpcodeStart(data, i + 3, end, labels) ||
                (TASS_OPCODES[data[i + 3]] &&
                 (TASS_OPCODES[data[i + 3]][1] === 'none' || TASS_OPCODES[data[i + 3]][1] === 'acc')) ||
                data[i + 3] === 0x30 || data[i + 3] === 0x31 ||
                (data[i + 3] >= 0x80 && data[i + 3] <= 0xA7));
            // Hex-literal context: text already looks like `$` + hex
            // digits and IDX is a digit — comment hex address like
            // `;$d018`, NOT a label-def.
            var lbNNIsDigit = lbNN >= 0x30 && lbNN <= 0x39;
            var inHexCtx = false;
            if (lbNNIsDigit && text.length > 0 && text.charCodeAt(0) === 0x24) {
              inHexCtx = true;
              for (var hk = 1; hk < text.length; hk++) {
                var hc = text.charCodeAt(hk);
                if (!((hc >= 0x30 && hc <= 0x39) || (hc >= 0x61 && hc <= 0x66) ||
                      (hc >= 0x41 && hc <= 0x46))) { inHexCtx = false; break; }
              }
            }
            if (!inHexCtx && (
                ((ahead === 0x02 || ahead === 0x03 || ahead === 0x04 || ahead === 0x06) &&
                 i + 3 < end && TASS_OPERAND_PFX[data[i + 3]]) ||
                ahead === 0x05 ||
                aheadIsValidOpStart ||
                impliedThenInstr)) {
              break;
            }
            // Weaker signal: next-line comment marker only (require
            // non-digit IDX so `$1000` digit runs aren't cut).
            if (lbNN < 0x30 || lbNN > 0x39) {
              if (ahead >= 0x80 && ahead <= 0xA7) break;
            }
          }
        }
        var letter = petsciiToLetter(c);
        if (letter !== null) { text += letter; i++; continue; }
        break;
      }
      cur.comment = text.replace(/\s+$/, '');
      cur.commentCol = commentCol;
      flush();
      continue;
    }
    // $30/$31 IDX = label-def (idx 0-255 / 256-511). $30 is also BMI
    // rel and $31 is AND iny; only treat as opcode when the operand
    // looks like a real branch target.
    if ((b === 0x30 || b === 0x31) && i + 1 < end) {
      var page = b - 0x30;
      var nextLB = data[i + 1];
      var opcodeValidHere = false;
      if (nextLB === 0x38 || nextLB === 0x39) {
        var brTarget = (nextLB - 0x38) * 256 + (i + 2 < end ? data[i + 2] : 256);
        opcodeValidHere = brTarget < labels.length;
        // If i+3 is itself an operand prefix, i+2 starts a new
        // instruction — so $30 $38 was a label-def, not a branch.
        if (opcodeValidHere && i + 3 < end && TASS_OPERAND_PFX[data[i + 3]]) {
          opcodeValidHere = false;
        }
      } else if (nextLB === 0x2D) {
        // `$30 $2D` ambiguous: `bmi *` (deliberate hang) vs label-def.
        // Default to label-def unless nothing instruction-shaped follows.
        var nb = i + 2 < end ? data[i + 2] : 0;
        var nbOp = TASS_OPCODES[nb];
        var hasInstrAfter = i + 2 < end && (
          tassIsValidOpcodeStart(data, i + 2, end, labels) ||
          (nbOp && (nbOp[1] === 'none' || nbOp[1] === 'acc')) ||
          nb === 0x30 || nb === 0x31 ||
          (nb >= 0x80 && nb <= 0xA7) ||
          nb === 0x02 || nb === 0x03 || nb === 0x04 ||
          nb === 0x05 || nb === 0x06
        );
        opcodeValidHere = !hasInstrAfter;
      }
      var lidx = page * 256 + nextLB;
      if (!opcodeValidHere && lidx < labels.length) {
        flushData();
        if (cur.instr || cur.comment) flush();
        cur.label = labels[lidx];
        i += 2;
        // `$05` after label-def = `label = value` assignment. Don't
        // flush here so a trailing comment can attach.
        if (i < end && data[i] === 0x05) {
          i++;
          var apfx = i < end ? data[i] : 0;
          cur.instr = '=';
          if (apfx === 0x28) { cur.operand = '$' + ((data[i + 1] || 0)).toString(16).padStart(2,'0'); i += 2; }
          else if (apfx === 0x29) { cur.operand = '$' + ((((data[i + 2] || 0) << 8) | (data[i + 1] || 0)).toString(16).padStart(4,'0')); i += 3; }
          else if (apfx === 0x2A) { cur.operand = (data[i + 1] || 0).toString(); i += 2; }
          else if (apfx === 0x38) { var li2 = data[i + 1]; cur.operand = labels[li2] || ('?lbl' + li2); i += 2; }
          else { cur.operand = '?$' + apfx.toString(16); i += 1; }
        }
        continue;
      }
    }
    // `.text "string"`: `$02 LEN <LEN bytes>`. TASS strings can include
    // control bytes (color codes etc.), so accept as long as $80 (block
    // end) doesn't appear in the payload.
    if (b === 0x02 && i + 1 < end) {
      var tlen = data[i + 1];
      if (tlen > 0 && tlen <= 64 && i + 2 + tlen <= end) {
        var hasBlockEnd = false;
        for (var tk = 0; tk < tlen; tk++) {
          if (data[i + 2 + tk] === 0x80) { hasBlockEnd = true; break; }
        }
        if (!hasBlockEnd) {
          flushData();
          if (cur.instr) flush();
          cur.instr = '.text';
          // Reversed glyphs ($00-$1F, $80-$9F) wrap in petscii-rev.
          var tplain = '';
          var thtml = '';
          for (var tk2 = 0; tk2 < tlen; tk2++) {
            var bb = data[i + 2 + tk2];
            var glyph = petsciiToAscii(bb);
            var rev = (bb <= 0x1F) || (bb >= 0x80 && bb <= 0x9F);
            tplain += glyph;
            if (rev) thtml += '<span class="petscii-rev">' + escHtml(glyph) + '</span>';
            else thtml += escHtml(glyph);
          }
          cur.operand = '"' + tplain + '"';
          cur.operandHtml = '"' + thtml + '"';
          i += 2 + tlen;
          continue;
        }
      }
    }
    // `.byte` ($03) / `.word` ($04). Subsequent values are bare
    // PFX VAL pairs (no repeated directive marker).
    if ((b === 0x03 || b === 0x04) && i + 1 < end) {
      var bpfx = data[i + 1];
      if (TASS_OPERAND_PFX[bpfx]) {
        flushData();
        if (cur.instr) flush();
        cur.instr = b === 0x04 ? '.word' : '.byte';
        var bvals = [];
        i++;
        while (i < end && TASS_OPERAND_PFX[data[i]]) {
          // $30 IDX is allowed inside a .byte/.word list only when an
          // operator follows (= label+N expression); bare $30 IDX is a
          // new line, stop.
          if (data[i] === 0x30 && i + 2 < end && !TASS_OPERATORS[data[i + 2]]) break;
          var v = tassDecodeValue(data, i, end, labels);
          if (v.n === 0) break;
          bvals.push(v.text);
          i += v.n;
        }
        cur.operand = bvals.join(',');
        // Don't flush — a trailing comment or next opcode does it.
        continue;
      }
    }
    // `*= address` ($06 + value-prefix).
    if (b === 0x06 && i + 1 < end) {
      var opfx = data[i + 1];
      if (opfx === 0x29 || opfx === 0x28) {
        flushData();
        if (cur.instr || cur.comment) flush();
        cur.instr = '*=';
        if (opfx === 0x29) { cur.operand = '$' + ((((data[i + 3] || 0) << 8) | (data[i + 2] || 0)).toString(16).padStart(4,'0')); i += 4; }
        else { cur.operand = '$' + (data[i + 2] || 0).toString(16).padStart(2,'0'); i += 3; }
        continue;
      }
    }
    // `.offs <value>` ($01 + value-prefix).
    if (b === 0x01 && i + 1 < end && TASS_OPERAND_PFX[data[i + 1]]) {
      flushData();
      if (cur.instr || cur.comment) flush();
      var v = tassDecodeValue(data, i + 1, end, labels);
      cur.instr = '.offs';
      cur.operand = v.text;
      i += 1 + v.n;
      continue;
    }
    // 30+ padding/rule bytes ($00/$2D/$3D/$5F, also $C0 in runs) =
    // user-drawn rule line, emit as a `;---` separator.
    // ($C0 is also CPY-imm — only treat as padding when followed by
    // another $C0; solo $C0 falls through to opcode handling.)
    var isPad = (b === 0x00 || b === 0x2D || b === 0x3D || b === 0x5F) ||
                (b === 0xC0 && i + 1 < end && data[i + 1] === 0xC0);
    if (isPad) {
      var pStart0 = i;
      while (i < end && (data[i] === 0xC0 || data[i] === 0x00 || data[i] === 0x2D || data[i] === 0x3D || data[i] === 0x5F)) i++;
      if (i - pStart0 >= 30) {
        flushData();
        if (cur.label || cur.instr || cur.comment) flush();
        var cStr = '';
        for (var ri2 = pStart0; ri2 < i; ri2++) {
          var rb2 = data[ri2];
          if (rb2 === 0x00) continue;
          cStr += petsciiToAscii(rb2);
        }
        if (cStr.length > 0) lines.push({ label: null, instr: null, operand: null, comment: cStr, isTextBlock: true });
      }
      continue;
    }
    if (TASS_OPCODES[b]) {
      var op = TASS_OPCODES[b];
      var mode = op[1];
      // For operand-taking opcodes, verify the prefix shape — otherwise
      // this byte is data that happened to land on a valid opcode value.
      if (mode !== 'none' && mode !== 'acc') {
        if (!tassIsValidOpcodeStart(data, i, end, labels)) {
          if (cur.instr || cur.comment) flush();
          unknownRun.push(b);
          i++;
          if (unknownRun.length >= 8) flushData();
          continue;
        }
      }
      flushData();
      if (cur.instr) flush();
      cur.instr = op[0];
      var od = tassDecodeOperand(data, i + 1, op, labels);
      cur.operand = od.text;
      if (od.html != null) cur.operandHtml = od.html;
      i += 1 + od.n;
      continue;
    }
    // Unknown byte — accumulate into a .byte run instead of one ?-line per byte
    if (cur.instr || cur.comment) flush();
    unknownRun.push(b);
    i++;
    if (unknownRun.length >= 8) flushData();
  }
  flush();
  return lines;
}

function tassRenderLineHtml(line) {
  // Source layout: label at col 0-8, mnemonic at col 9+, operand
  // follows, `;comment` at line.commentCol (falls back to 32). Apply
  // charset case here so labels/instrs/operands/hex digits all render
  // consistently in the user's selected mode.
  var html = '';
  var col = 0;
  var lblText = line.label ? tassDisplayCase(line.label) : null;
  var instrText = line.instr ? tassDisplayCase(line.instr) : null;
  var operandText = line.operand ? tassDisplayCase(line.operand) : null;
  var commentText = line.comment ? tassDisplayCase(line.comment) : line.comment;
  if (lblText) {
    var pad = Math.max(1, 9 - lblText.length);
    html += '<span class="basic-keyword">' + escHtml(lblText) + '</span>' + ' '.repeat(pad);
    col = lblText.length + pad;
  } else if (instrText) {
    // Indent to col 9 only when there's an instruction; comment-only
    // lines anchor on commentCol so col-0 `;---` rules don't shift.
    html += '         ';
    col = 9;
  }
  if (instrText) {
    html += '<span class="basic-keyword">' + escHtml(instrText) + '</span>';
    col += instrText.length;
    if (operandText) {
      // operandHtml carries pre-built HTML (`.text` reversed-char spans);
      // operand stays plain text for the column math.
      html += ' ' + (line.operandHtml || escHtml(operandText));
      col += 1 + operandText.length;
    }
  }
  // Render `;` even when text is empty — TASS encodes lines like
  // `joy0 .byte $04 ;` with a marker but no comment text.
  if (line.comment || line.commentCol >= 0) {
    var target = (line.commentCol >= 0) ? line.commentCol : 32;
    var gap = Math.max((col === 0 || col === 9 ? 0 : 1), target - col);
    html += ' '.repeat(gap) + '<span class="text-muted">;' + escHtml(commentText || '') + '</span>';
  }
  return html;
}

function showFileTassViewer(entryOff) {
  if (!currentBuffer) return;
  var data = new Uint8Array(currentBuffer);
  var result = readFileData(currentBuffer, entryOff);
  var fileData = result.data;
  var name = petsciiToReadable(readPetsciiString(data, entryOff + 5, 16)).trim();

  var loadAddr = fileData[0] | (fileData[1] << 8);
  var payload = fileData.subarray(2);

  // Bail with a clear message if the file doesn't carry the TASS magic.
  if (!isTassSource(fileData)) {
    showViewerModal(
      'Turbo Assembler \u2014 "' + name + '"',
      '<div class="basic-listing"><div class="basic-line">Not recognized as a TASS V5.x source file (missing $09 $FF magic at offset $0E).</div></div>'
    );
    return;
  }

  // Wrap the parse+render so modalCharsetRedraw can re-run it on
  // charset toggle (label/comment case depends on global charsetMode).
  function buildTassHtml() {
  var labelRes = tassParseLabels(payload);
  var labels = labelRes.labels;
  var labelsStart = labelRes.start;

  // Source body starts at fileData $0100 = payload $00FE (after the
  // 2-byte load addr + 14-byte header + 240 bytes of editor state).
  var srcStart = 0xFE;

  // Locate the "TURBO" end-of-source sentinel. Two shapes:
  //   long  : $06 $29 LO HI <comment block> $54 $55 $52 $42 $4F <meta>
  //   short : <any>                         $54 $55 $52 $42 $4F <meta>
  // The long form encodes a leading `*= $HILO` directive we surface as
  // the first display line. Skip TURBO occurrences inside comment text
  // (they're followed by $80 line-break, not metadata).
  var tassSentinelStart = -1;
  var tassSentinelEnd = -1;
  var tassOrigin = -1;
  for (var ss = srcStart; ss < payload.length - 5; ss++) {
    if (payload[ss] === 0x54 && payload[ss + 1] === 0x55 &&
        payload[ss + 2] === 0x52 && payload[ss + 3] === 0x42 &&
        payload[ss + 4] === 0x4F) {
      if (payload[ss + 5] === 0x80) continue;
      tassSentinelEnd = ss + 5;
      if (ss >= srcStart + 5 && payload[ss - 5] === 0x06 && payload[ss - 4] === 0x29) {
        tassOrigin = payload[ss - 3] | (payload[ss - 2] << 8);
        tassSentinelStart = ss - 5;
      } else {
        // Short form: trim a $FF immediately before TURBO if present.
        tassSentinelStart = ss > srcStart && payload[ss - 1] === 0xFF ? ss - 1 : ss;
      }
      break;
    }
  }

  // Don't trim trailing $00 — a $00 just before the sentinel is often
  // a real operand byte (e.g. `bit base0` with base0 at idx 0).
  var srcEnd = tassSentinelStart > 0 ? tassSentinelStart : labelsStart;

  var html = '<div class="basic-listing tass-screen">';
  if (srcStart >= payload.length) {
    html += '<div class="basic-line">Could not locate source body (no $80 separator found).</div>';
  }

  // Long-form sentinel = explicit origin; emit as the first line.
  if (tassOrigin >= 0) {
    html += '<div class="basic-line">         <span class="basic-keyword">*=</span> $' + tassDisplayCase(tassOrigin.toString(16).padStart(4, '0')) + '</div>';
  }

  var allLines = tassTokenizeBlock(payload, srcStart, srcEnd, labels);

  // A run of `.byte` lines whose bytes all decode as printable ASCII,
  // bookended by separators, is a user comment that TASS stored as
  // literal data — collapse to a single `;text` line.
  function byteLineToText(line) {
    if (!line || line.instr !== '.byte' || !line.operand) return null;
    var txt = '';
    var parts = line.operand.split(',');
    for (var p = 0; p < parts.length; p++) {
      var s = parts[p].trim();
      if (s[0] !== '$') return null;
      var v = parseInt(s.slice(1), 16);
      if (isNaN(v)) return null;
      if (v >= 0x20 && v <= 0x7E) txt += String.fromCharCode(v);
      else if (v === 0xA0) txt += ' ';
      else if (v >= 0xC1 && v <= 0xDA) txt += String.fromCharCode(v - 0x80);
      else return null;
    }
    return txt;
  }
  var collapsed = [];
  for (var ai = 0; ai < allLines.length; ai++) {
    var cur2 = allLines[ai];
    if (cur2.separator) { collapsed.push(cur2); continue; }
    if (!cur2.label && !cur2.comment && cur2.instr === '.byte') {
      var txt = byteLineToText(cur2);
      if (txt !== null) {
        var accTxt = txt;
        var aj = ai + 1;
        while (aj < allLines.length) {
          var nx = allLines[aj];
          if (nx.separator) break;
          if (nx.label || nx.comment) break;
          if (nx.instr !== '.byte') break;
          var nxTxt = byteLineToText(nx);
          if (nxTxt === null) break;
          accTxt += nxTxt;
          aj++;
        }
        var bookendedByEnd = aj >= allLines.length || allLines[aj].separator;
        if (bookendedByEnd && accTxt.length >= 2) {
          collapsed.push({ label: null, instr: null, operand: null, comment: tassDisplayCase(accTxt), isTextBlock: true });
          ai = aj - 1;
          continue;
        }
      }
    }
    collapsed.push(cur2);
  }

  // TASS stores source bottom-up — reverse for natural display order.
  collapsed.reverse();

  // Dedupe consecutive separators; trim trailing.
  var cleaned = [];
  for (var ci = 0; ci < collapsed.length; ci++) {
    var ln = collapsed[ci];
    if (ln.separator && cleaned.length > 0 && cleaned[cleaned.length - 1].separator) continue;
    cleaned.push(ln);
  }
  // Trim only trailing separators (final $80 leaves a stray tail);
  // keep leading separators since `*= $orig` is often followed by one.
  while (cleaned.length && cleaned[cleaned.length - 1].separator) cleaned.pop();

  var totalLines = 0;
  for (var rj = 0; rj < cleaned.length; rj++) {
    var ln2 = cleaned[rj];
    if (ln2.separator) {
      var rstr = typeof ln2.ruleStr === 'string' && ln2.ruleStr.length ? ln2.ruleStr : '-'.repeat(39);
      html += '<div class="basic-line"><span class="text-muted">;' + escHtml(rstr) + '</span></div>';
      totalLines++;
      continue;
    }
    if (ln2.isTextBlock) {
      html += '<div class="basic-line"><span class="text-muted">;' + escHtml(ln2.comment) + '</span></div>';
      totalLines++;
      continue;
    }
    html += '<div class="basic-line">' + tassRenderLineHtml(ln2) + '</div>';
    totalLines++;
  }
  html += '</div>';

  var titleText = 'Turbo Assembler \u2014 "' + name + '" (' + labels.length + ' labels, ' + totalLines + ' lines)';
  if (result.error) titleText += ' \u2014 ' + result.error;
  return { title: titleText, html: html };
  } // end buildTassHtml

  var built = buildTassHtml();
  showViewerModal(built.title, built.html, 'lg');
  // Re-render on charset toggle.
  modalCharsetRedraw = function() {
    var rebuilt = buildTassHtml();
    var body = document.getElementById('modal-body');
    if (body) body.innerHTML = rebuilt.html;
  };
}
