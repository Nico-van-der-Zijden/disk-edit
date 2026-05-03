// ── Turbo Assembler viewer ────────────────────────────────────────────
// TASS V5.x source format (reverse-engineered):
//   Header (16 bytes) with $09 $FF magic at offset $0E-$0F.
//   Source body stored in REVERSE display order; lines delimited by $80 with
//   $C0 padding between. Labels stored in ASCII table at end (last char has
//   bit 7 set). Instructions use actual 6502 opcodes as mnemonic tokens plus
//   operand-type prefixes ($28 hex byte, $29 hex word, $2A decimal byte,
//   $38 label ref). Label definitions are $30 NN.
// Complete 6502 official opcode table (151 opcodes). The mode string drives
// tassDecodeOperand. Note: opcodes like $28/$30/$38 double as TASS operand-
// prefix markers (hex byte / label def / label ref). We handle those specially
// in the tokenizer BEFORE consulting this table, so these entries only apply
// when those bytes appear as real opcodes at the start of an instruction.
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
  // Magic $09 $FF at file offset $0E-$0F (fileData includes the 2-byte load
  // address prefix, so this is payload offset $0C-$0D).
  return fileData[0x0E] === 0x09 && fileData[0x0F] === 0xFF;
}

function tassParseLabels(data) {
  var labels = [];
  // The label table is a sequence of label-format runs (chars + high-bit
  // terminator). In some files the table is interrupted by short embedded
  // "screen-code" comment/data sections, so we can't just pick the longest
  // run. Instead: find the FIRST long label-format run (the anchor that tells
  // us where the table region starts), then greedily parse labels from that
  // point to end-of-file, skipping over non-label bytes.
  function isLabelChar(b) {
    return (b >= 0x41 && b <= 0x5A) || (b >= 0x30 && b <= 0x39) ||
           b === 0x2E || b === 0x5F;
  }
  // Terminator = last char of name with bit 7 set. Only ranges that
  // correspond to a valid label char: A-Z ($C1-$DA), 0-9 ($B0-$B9), '.'
  // ($AE), '_' ($DF). Explicitly EXCLUDES $C0 which is decorative padding.
  function isLabelTerm(b) {
    return (b >= 0xC1 && b <= 0xDA) || (b >= 0xB0 && b <= 0xB9) || b === 0xAE || b === 0xDF;
  }
  function isLabelByte(b) { return isLabelChar(b) || isLabelTerm(b); }

  // Anchor: pick the LONGEST run of label-format bytes that contains a
  // high-bit terminator and meets a minimum length. Threshold is small
  // (3) to tolerate test files with one tiny label like "CNT" + $B0.
  // Larger runs in real source files easily beat any short false-positive
  // burst elsewhere because we track the longest match.
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

  // From the anchor to end of file, parse label-format tokens. Skip any byte
  // that isn't a label character or terminator. Terminate parsing if we hit
  // a long gap of non-label bytes (>=64), which signals we've walked past
  // the label table.
  // A lone high-bit byte OUTSIDE the strict terminator range (e.g. $9F, $A0
  // in the middle of embedded comment text) acts as a dummy/placeholder label
  // slot — TASS reserves the index but leaves the name empty. Track these so
  // subsequent labels retain their absolute-index numbering.
  function isDummyTerm(b) {
    return (b >= 0x80 && b <= 0xAD) || b === 0xAF || (b >= 0xBA && b <= 0xC0) ||
           (b >= 0xDB && b <= 0xDE) || (b >= 0xE0 && b <= 0xFA);
  }

  // Some files (like SPD 03 on `sources 03.d64`) have a stale 1-byte
  // leading character before the first real label, leftover from an
  // earlier edit. Detect this when the byte at `anchor` matches the byte
  // at `anchor+2` AND `anchor+3` is a bit-7-set label terminator: that's
  // the "X Y X term" pattern (e.g. "RIRQ"). Skip the leading byte so the
  // first label parses correctly (= "IRQ" per VICE).
  var p = anchor;
  if (anchor + 3 < data.length &&
      isLabelChar(data[anchor]) &&
      data[anchor] === data[anchor + 2] &&
      isLabelTerm(data[anchor + 3])) {
    p = anchor + 1;
  }
  var gap = 0;
  while (p < data.length && gap < 64) {
    var b = data[p];
    if (isLabelByte(b)) {
      // Parse a label: zero or more label-chars followed by one terminator.
      // A lone terminator byte ($C4 = "D", etc.) encodes a 1-char label.
      var name = '';
      var closed = false;
      var pStart = p;
      while (p < data.length) {
        var x = data[p];
        if (isLabelChar(x)) { name += String.fromCharCode(x); p++; }
        else if (isLabelTerm(x)) { name += String.fromCharCode(x - 0x80); p++; closed = true; break; }
        else break;
      }
      if (name.length > 0 && closed) { labels.push(name.toLowerCase()); gap = 0; }
      else { gap += Math.max(1, p - pStart); if (p === pStart) p++; }
    } else if (isDummyTerm(b)) {
      // Placeholder slot — push an empty name so indices line up with the
      // source's label references.
      labels.push('');
      p++;
      gap = 0;
    } else { gap++; p++; }
  }
  return { labels: labels, start: anchor };
}

// TASS operand-prefix bytes — the discrete set of byte values that introduce
// an operand value in source storage. T.ASS itself looks up bytes against an
// internal table; we mirror that.
//
// Confirmed via test 3 (`disks/tass test.d64`): `$22` introduces a literal-
// leading expression, `$2C` is binary value, `$2E` is char/string (works in
// abs mode too, not just imm), and operators are encoded as $40+(idx-4) per
// the 16-entry operator-character table at $BB13 in T.ASS V6.4. The full set
// of operator codes maps to BB13 indices 4-15:
//   $40 '+' add        $41 '-' subtract    $42 '*' multiply   $43 '/' divide
//   $44 '>' high byte  $45 '<' low byte    $46 '!' decimal    $47 '&' AND
//   $48 '.' OR         $49 ':' EOR         $4A '(' open paren $4B ')' close paren
// Note the unusual syntax: `&` is bitwise AND, `.` is bitwise OR, `:` is
// EOR (XOR). The display preserves source characters; semantics are TASS's.
var TASS_OPERATORS = {
  0x40:'+', 0x41:'-', 0x42:'*', 0x43:'/',
  0x44:'>', 0x45:'<', 0x46:'!', 0x47:'&',
  0x48:'.', 0x49:':', 0x4A:'(', 0x4B:')'
};

// Value-introducing prefix bytes. `lblIdx` flags those that reference a label
// index (caller validates against labels.length).
var TASS_OPERAND_PFX = {
  0x22: true,  // expression with literal-leading byte ($22 LIT [OP RHS...])
  0x28: true,  // hex byte ($XX)
  0x29: true,  // hex word ($XXXX)
  0x2A: true,  // decimal byte
  0x2C: true,  // binary byte (%nnnnnnnn)
  0x2D: true,  // current PC (*)
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
  if (pfx === 0x22) { return { text: (data[pos+1]||0).toString(), n: 2 }; }
  if (pfx === 0x28) { return { text: '$' + (data[pos+1]||0).toString(16).padStart(2,'0'), n: 2 }; }
  if (pfx === 0x29) {
    var lo = data[pos+1]||0, hi = data[pos+2]||0;
    return { text: '$' + ((hi<<8)|lo).toString(16).padStart(4,'0'), n: 3 };
  }
  if (pfx === 0x2A) { return { text: (data[pos+1]||0).toString(), n: 2 }; }
  if (pfx === 0x2C) { return { text: '%' + (data[pos+1]||0).toString(2).padStart(8,'0'), n: 2 }; }
  if (pfx === 0x2D) { return { text: '*', n: 1 }; }
  if (pfx === 0x2E) {
    var c = (data[pos+1]||0) & 0x7F;
    if (c >= 0x20 && c <= 0x7E) return { text: '"' + String.fromCharCode(c) + '"', n: 2 };
    return { text: '$' + ((data[pos+1]||0)).toString(16).padStart(2,'0'), n: 2 };
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

// Decode a TASS expression: primary + chain of (binary-op + primary).
// Returns { text, n }. Stops at non-operator bytes, paren markers (which
// belong to primaries, not the binary-op chain), or end of buffer.
//
// CRITICAL: only chain binary operators when we're in an EXPRESSION
// context — introduced by $22 (literal-leading-expression), $30 (label-
// with-expression), $4A (open paren), or a leading unary operator. After
// a plain value-prefix ($28 hex, $29 word, $2A decimal, etc.), the value
// is standalone — any operator-looking byte that follows should be the
// start of a NEW instruction, not chained as a binary op. Without this
// guard, `sta $d015` ($8D $29 $15 $D0) followed by `eor #$01` ($49 $28
// $01) gets parsed as `sta $d015:$01` because $49 doubles as the `:`
// operator, eating the EOR instruction.
function tassDecodeValue(data, pos, end, labels) {
  var result = tassDecodePrimary(data, pos, end, labels);
  var firstByte = data[pos];
  var inExpression = firstByte === 0x22 || firstByte === 0x30 ||
                     firstByte === 0x4A ||
                     (TASS_OPERATORS[firstByte] && firstByte !== 0x4B && firstByte !== 0x5B);
  if (!inExpression) return result;
  while (true) {
    var nextPos = pos + result.n;
    if (nextPos >= end) break;
    var op = data[nextPos];
    if (op === 0x4A || op === 0x4B || op === 0x5B) break;
    if (!TASS_OPERATORS[op]) break;
    var rhs = tassDecodePrimary(data, nextPos + 1, end, labels);
    result = {
      text: result.text + TASS_OPERATORS[op] + rhs.text,
      n: result.n + 1 + rhs.n
    };
  }
  return result;
}

// Decide whether `data[pos]` looks like the start of a valid TASS opcode
// THAT TAKES AN OPERAND with a recognizable prefix byte. Used to
// disambiguate $80-$A7 bytes (comment markers vs LDX/LDY/STA/STY/STX
// opcodes) and to find break points inside comment text.
//
// 0-operand opcodes ('none'/'acc') return false: those have no prefix to
// disambiguate against, and bytes like $38 SEC / $88 DEY / $D8 CLD are
// common ASCII digits/letters in comment text. The main opcode-decode
// branch handles real implied opcodes directly.
//
// For prefixes that double as ASCII text in comments ($38/$39 = '8'/'9',
// $44/$45 = 'D'/'E', $30 = '0'), we additionally require the referenced
// label index to be in range — TASS source files are valid, so byte
// sequences that would imply out-of-range labels can't really be opcodes.
function tassIsValidOpcodeStart(data, opPos, end, labels) {
  if (opPos >= end) return false;
  var op = TASS_OPCODES[data[opPos]];
  if (!op) return false;
  var mode = op[1];
  if (mode === 'none' || mode === 'acc') return false;
  if (opPos + 1 >= end) return false;
  // Skip past any unary operators ($40-$49 except parens) AND open-parens
  // ($4A) to find the actual value prefix. Common cases:
  //   `lda #>label`  = $A9 $44 $38 IDX  (unary > then label-ref)
  //   `lda (1+2)`    = $AD $4A $22 ... (open paren then literal)
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
  // $22 is the literal-leading-expression prefix; bare `$22 LIT` without a
  // following operator wouldn't be emitted by TASS (it'd use $2A decimal
  // instead). When we see $22 not followed by an operator, this isn't a
  // real opcode operand — likely a label idx that happens to be $22.
  if (pfxByte === 0x22) {
    if (probePos + 2 >= end) return false;
    return TASS_OPERATORS[data[probePos + 2]] !== undefined;
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
  if (mode === 'none' || mode === 'acc') return { text: '', n: 0 };
  if (pos >= data.length) return { text: '', n: 0 };
  var v = tassDecodeValue(data, pos, data.length, labels);
  if (mode === 'imm') return { text: '#' + v.text, n: v.n };
  if (mode === 'rel') return v; // branches: just the target
  // abs / abs-x / abs-y / iny / ind / zp / zpx / zpy / izx — value with suffix
  var val = v.text;
  if (mode === 'abs-x' || mode === 'zpx') val += ',x';
  else if (mode === 'abs-y' || mode === 'zpy') val += ',y';
  else if (mode === 'iny') val = '(' + val + '),y';
  else if (mode === 'izx') val = '(' + val + ',x)';
  else if (mode === 'ind') val = '(' + val + ')';
  return { text: val, n: v.n };
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
    if (cur.label || cur.instr || cur.comment) lines.push(cur);
    cur = { label: null, instr: null, operand: null, comment: null, commentCol: -1, isData: false };
  }
  var i = start;
  while (i < end) {
    var b = data[i];
    // Comment markers: TASS encodes `;` with one byte per editor column —
    // $80 = column 0, $81 = column 1, …, $A7 = column 39. The range tops
    // out at the C64's 40-column screen width; bytes from $A8 upward are
    // unambiguously real opcodes (LDA #/LDX zp/etc.). Within $80-$A7,
    // many bytes are also valid 6502 opcodes (STY/STA/STX/LDY/LDA/LDX
    // …), so disambiguate by the next byte: if this byte is an opcode
    // that takes an operand AND the next byte is a valid TASS operand
    // prefix, treat as the opcode. Otherwise, it's a comment marker.
    //
    // EXCEPTION: $88 (DEY), $8A (TXA), $98 (TYA), $9A (TXS) are 0-operand
    // opcodes that fall in this range. Without explicit handling they'd
    // ALWAYS be treated as comment markers (cols 8/10/24/26) since they
    // have no operand prefix to validate against. In real TASS source
    // these bytes are virtually never comment markers — programmers
    // place comments at col 0, col 9 (right after label), or trailing
    // (col 18+/32). Treat them as their implied opcode unconditionally.
    var commentCol = -1;
    if (b >= 0x80 && b <= 0xA7 &&
        b !== 0x88 && b !== 0x8A && b !== 0x98 && b !== 0x9A &&
        !tassIsValidOpcodeStart(data, i, end, labels)) {
      commentCol = b - 0x80;
    }
    if (commentCol >= 0) {
      flushData();
      // Decide whether this comment belongs on the current line (trailing)
      // or starts a new line. A `;` at column N can only be on the same
      // row as the existing label/instr if N is past where that content
      // ends; otherwise the editor cursor would have had to overwrite
      // existing text — TASS never stores that, so it's a new row.
      if (cur.label || cur.instr) {
        var curEnd = (cur.label ? 9 : 9);
        if (cur.instr) curEnd += cur.instr.length;
        if (cur.operand) curEnd += 1 + cur.operand.length;
        if (commentCol < curEnd) flush();
      }
      i++;
      var text = '';
      // Read comment text until we hit a byte that clearly starts a new
      // instruction/directive/label-def. Printable-ASCII bytes (including
      // digits like '0'=$30 and '8'=$38) are treated as comment text unless
      // they specifically form a new-instruction pattern. PETSCII shifted
      // letters ($C1-$DA) are also treated as text (rendered as A-Z).
      // $2D (hyphen) is normally padding; inside a comment it's literal '-'.
      function petsciiToLetter(b) {
        if (b >= 0x20 && b <= 0x7E) return String.fromCharCode(b).toLowerCase();
        if (b === 0xA0) return ' ';
        if (b >= 0xC1 && b <= 0xDA) return String.fromCharCode(b - 0x80).toLowerCase();
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
        // A new comment marker ($80-$A7, with the same opcode-disambiguation
        // as the outer loop) ends this comment so the next one can start.
        if (c >= 0x80 && c <= 0xA7 &&
            c !== 0x88 && c !== 0x8A && c !== 0x98 && c !== 0x9A &&
            !tassIsValidOpcodeStart(data, i, end, labels)) break;
        // $2D is literal '-' in comments (before opcode check: $2D=AND abs
        // is a valid 6502 opcode, but inside a comment '-' is overwhelmingly
        // more likely).
        if (c === 0x2D) { text += '-'; i++; continue; }
        // An opcode + valid TASS operand prefix may be a real instruction
        // boundary, but in COMMENT text many printable-ASCII bytes
        // ($20=JSR, $4C=JMP, $20-$7E broadly) double as letters/punctuation.
        // For those we only break if the operand value bytes contain a
        // non-printable byte — real instruction operands usually do
        // (high bytes of $XXYY addresses are typically >$7E), pure text
        // never does. Opcodes outside $20-$7E (e.g. $A9 LDA #, $D0 BNE)
        // can't be confused with text and break unconditionally.
        if (tassIsValidOpcodeStart(data, i, end, labels)) {
          var opByte = c;
          var shouldBreak = opByte < 0x20 || opByte > 0x7E;
          if (!shouldBreak) {
            var pfx = data[i + 1];
            // Label-ref prefix ($38/$39) is a strong "real instruction"
            // signal — `jsr label`/`jmp label`/`bne label` etc. The idx
            // can be any printable byte ($30-$7E), so the printable-
            // operand heuristic alone misses these. Always break.
            if (pfx === 0x38 || pfx === 0x39) {
              shouldBreak = true;
            } else {
              var operandLen = (pfx === 0x29) ? 2 : 1;
              for (var ob = 0; ob < operandLen && i + 2 + ob < end; ob++) {
                var bv = data[i + 2 + ob];
                // $80-$BF is the comment-marker range — if it appears at
                // an operand-byte position, it's more likely the next
                // line's marker than a real instruction operand.
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
        // Label-def `$30 NN` followed by a real new instruction → break, the
        // label-def starts a new source line. Example MINER 02:
        //   `;MARK/UNMARK BOMBS` + $30 $68 + $20 $38 $69 (skip0: jsr rout3)
        // would read "MARK/UNMARK BOMBS0h 8i" if we kept consuming.
        // The check at i+2 (byte after IDX) must look like a TASS opcode
        // start — that's what tells us label-def vs digit-text. We also
        // require IDX itself to be NOT a digit ($30-$39): runs like
        // "$1000" in comment text are bytes $31 $30 $30 $30 where IDX=$30
        // is a literal '0', not a label index. Only break when IDX is a
        // non-digit label-char (uppercase letters, etc.).
        if ((c === 0x30 || c === 0x31) && i + 2 < end) {
          var lbNN = data[i + 1];
          if (lbNN < 0x30 || lbNN > 0x39) {
            var lbIdx = (c - 0x30) * 256 + lbNN;
            if (lbIdx < labels.length &&
                tassIsValidOpcodeStart(data, i + 2, end, labels)) break;
          }
        }
        var letter = petsciiToLetter(c);
        if (letter !== null) { text += letter; i++; continue; }
        break;
      }
      cur.comment = text.replace(/\s+$/, '');
      // commentCol = column the editor placed `;` at; the renderer pads
      // up to that column when there's a preceding label/instr, or just
      // anchors the comment there for whole-line comments.
      cur.commentCol = commentCol;
      flush();
      continue;
    }
    // $30 NN = label def (idx NN). $31 NN = high-page label def (idx 256+NN).
    // $30/$31 are ALSO 6502 opcodes (BMI rel / AND iny). The opcode is only a
    // realistic interpretation when the operand is a label-ref ($38/$39) with
    // a valid index OR `*` (current PC) — real TASS source virtually never
    // uses branches with literal byte/decimal/binary targets, so when the
    // prefix is a value-introducer ($28/$29/$2A/$2C/$2E etc.) prefer the
    // label-def interpretation. Examples:
    //   SPD 03 0x2E1 `$30 $38 $CD` — `bmi` target idx 205 > 64 → cmp2:
    //   SPD 03 0x4F7 `$30 $38 $07` — `bmi` target idx 7 in range → bmi next0
    //   PLASMA   `$30 $2C $03`     — would be `bmi %00000011` literal → cnt3:
    if ((b === 0x30 || b === 0x31) && i + 1 < end) {
      var page = b - 0x30;
      var nextLB = data[i + 1];
      var opcodeValidHere = false;
      if (nextLB === 0x38 || nextLB === 0x39) {
        var brTarget = (nextLB - 0x38) * 256 + (i + 2 < end ? data[i + 2] : 256);
        opcodeValidHere = brTarget < labels.length;
        // Additional check: if the byte at i+3 (just after the supposed
        // BMI's target-idx byte) is a TASS operand prefix, then i+2 is
        // really the start of a new instruction needing that prefix —
        // meaning $30 $38 was a label-def, not BMI. Example from VIEW 06:
        //   `$30 $38 $A9 $28 $00` → label-def loop1 + `lda #$00`
        // (not `bmi jsrr` + `plp` + `brk` which makes no programming sense).
        if (opcodeValidHere && i + 3 < end && TASS_OPERAND_PFX[data[i + 3]]) {
          opcodeValidHere = false;
        }
      } else if (nextLB === 0x2D) {
        // `bmi *` / `and ($..),y` with current-PC operand
        opcodeValidHere = true;
      }
      var lidx = page * 256 + nextLB;
      if (!opcodeValidHere && lidx < labels.length) {
        flushData();
        if (cur.instr || cur.comment) flush();
        cur.label = labels[lidx];
        i += 2;
        // If the label-def is immediately followed by `$05`, it's a label
        // ASSIGNMENT: `label = value`. The value uses the usual prefix bytes.
        if (i < end && data[i] === 0x05) {
          i++;
          var apfx = i < end ? data[i] : 0;
          cur.instr = '=';
          if (apfx === 0x28) { cur.operand = '$' + ((data[i + 1] || 0)).toString(16).padStart(2,'0'); i += 2; }
          else if (apfx === 0x29) { cur.operand = '$' + ((((data[i + 2] || 0) << 8) | (data[i + 1] || 0)).toString(16).padStart(4,'0')); i += 3; }
          else if (apfx === 0x2A) { cur.operand = (data[i + 1] || 0).toString(); i += 2; }
          else if (apfx === 0x38) { var li2 = data[i + 1]; cur.operand = labels[li2] || ('?lbl' + li2); i += 2; }
          else { cur.operand = '?$' + apfx.toString(16); i += 1; }
          flush();
        }
        continue;
      }
    }
    // `.byte` / `.word` directive: `$03 PFX VALUE[...]`. $28 hex-byte, $29
    // hex-word, $2A decimal-byte. Multiple values are emitted as one .byte
    // line if consecutive $03-prefixed values appear with no other content
    // between them.
    // `.text "string"` directive: `$02 LEN ASCII_CHARS*LEN`. LEN is the
    // character count (1 byte), ASCII chars follow verbatim.
    if (b === 0x02 && i + 1 < end) {
      var tlen = data[i + 1];
      if (tlen > 0 && tlen <= 64 && i + 2 + tlen <= end) {
        // Accept the .text directive as long as the payload doesn't contain
        // $80 (block end). TASS strings often include control bytes ($12,
        // $93, colour codes, etc.) so a strict printable-only check wrongly
        // rejects valid strings.
        var hasBlockEnd = false;
        for (var tk = 0; tk < tlen; tk++) {
          if (data[i + 2 + tk] === 0x80) { hasBlockEnd = true; break; }
        }
        if (!hasBlockEnd) {
          flushData();
          if (cur.instr) flush();
          cur.instr = '.text';
          // Render through the same PETSCII map filenames use, with
          // `.petscii-rev` wrapping bytes in the control-code ranges
          // ($00-$1F, $80-$9F). The `.basic-listing .petscii-rev` CSS
          // override gives those spans the proper inverted-blue look.
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
    // `.byte` (`$03`) and `.word` (`$04`) directives. Subsequent values in the
    // same directive are stored as bare PFX VALUE pairs without repeating the
    // directive marker. Value prefixes: $28 hex byte, $29 hex word, $2A dec byte,
    // $38 label ref (treated as word when emitted under .word).
    if ((b === 0x03 || b === 0x04) && i + 1 < end) {
      var bpfx = data[i + 1];
      if (TASS_OPERAND_PFX[bpfx]) {
        flushData();
        if (cur.instr) flush();
        cur.instr = b === 0x04 ? '.word' : '.byte';
        var bvals = [];
        i++;
        while (i < end && TASS_OPERAND_PFX[data[i]]) {
          // $30 IDX is ALSO the label-def line-start marker. Allow it inside
          // a .byte/.word value list only when an expression operator follows
          // ($30 IDX OP RHS = `label+N`). Bare `$30 IDX` is a new line, stop.
          if (data[i] === 0x30 && i + 2 < end && !TASS_OPERATORS[data[i + 2]]) break;
          var v = tassDecodeValue(data, i, end, labels);
          if (v.n === 0) break;
          bvals.push(v.text);
          i += v.n;
        }
        cur.operand = bvals.join(',');
        // Intentionally do NOT flush here: a trailing comment ($93/$94) or a
        // following label-def/opcode will flush the line. This lets `player
        // .byte $00 ;comment` render as one line instead of splitting the
        // comment onto its own row.
        continue;
      }
    }
    // Origin directive `*= address`: byte $06 followed by value-prefix.
    if (b === 0x06 && i + 1 < end) {
      var opfx = data[i + 1];
      if (opfx === 0x29 || opfx === 0x28) {
        flushData();
        if (cur.instr || cur.comment) flush();
        cur.instr = '*=';
        if (opfx === 0x29) { cur.operand = '$' + ((((data[i + 3] || 0) << 8) | (data[i + 2] || 0)).toString(16).padStart(4,'0')); i += 4; }
        else { cur.operand = '$' + (data[i + 2] || 0).toString(16).padStart(2,'0'); i += 3; }
        flush();
        continue;
      }
    }
    // `.offs` directive: byte $01 followed by a value (verified via test 3
    // `$01 $29 $00 $10` = `.offs $1000`).
    if (b === 0x01 && i + 1 < end && TASS_OPERAND_PFX[data[i + 1]]) {
      flushData();
      if (cur.instr || cur.comment) flush();
      var v = tassDecodeValue(data, i + 1, end, labels);
      cur.instr = '.offs';
      cur.operand = v.text;
      i += 1 + v.n;
      flush();
      continue;
    }
    // ($80 is now handled above in the unified comment-marker block.)
    // $C0, $00, $2D = padding / horizontal-rule filler — skip. ($2D is
    // ambiguous: it's also ASCII '-', but treating it as padding loses '-' in
    // text comments — a small readability trade-off to avoid false `and *`
    // decodes on `$2D $2D` rule-fill bytes.)
    // A run of 30+ padding bytes represents a user-drawn rule line; emit a
    // synthetic SEP so it renders as `;---` in the output.
    // A long run of padding/decoration bytes in the middle of a block is a
    // user-drawn rule line. Emit the actual character sequence as a comment.
    // $C0 is also the CPY-imm opcode. Only treat as padding when it's part
    // of a RUN (next byte is also $C0). A solo $C0 is `cpy` and falls
    // through to opcode handling. Other padding bytes ($00/$2D/$3D/$5F)
    // start padding handling unconditionally.
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
      // For opcodes that take an operand, verify the following byte is a real
      // TASS operand prefix. tassIsValidOpcodeStart looks up the prefix in the
      // shared TASS_OPERAND_PFX table (and skips past unary operators). If not
      // valid, this byte is almost certainly a data byte that happens to land
      // on a valid opcode value.
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
  // TASS's on-screen format:
  //   col  0-8: label name (padded with spaces)
  //   col   9+: mnemonic
  //   col  14+: operand
  //   `;comment`: at the column the editor placed it — captured in
  //              line.commentCol from the marker byte ($80 + col). We
  //              fall back to 23 (the typical trailing-comment column)
  //              for older code paths that don't set commentCol.
  var html = '';
  // Track absolute column written so the comment can land at its real
  // target (line.commentCol is a 0-based absolute column).
  var col = 0;
  if (line.label) {
    var pad = Math.max(1, 9 - line.label.length);
    html += '<span class="basic-keyword">' + escHtml(line.label) + '</span>' + ' '.repeat(pad);
    col = line.label.length + pad;
  } else if (line.instr) {
    // Indent to col 9 only when there's an instruction. Comment-only lines
    // anchor on commentCol and emit their own leading spaces below — the
    // 9-space mnemonic indent would push col-0 ";---" rule lines to col 10.
    html += '         ';
    col = 9;
  }
  if (line.instr) {
    html += '<span class="basic-keyword">' + escHtml(line.instr) + '</span>';
    col += line.instr.length;
    if (line.operand) {
      // operandHtml carries pre-built HTML (e.g. `.text` strings with
      // reversed-char spans); operand stays as plain text for length math.
      html += ' ' + (line.operandHtml || escHtml(line.operand));
      col += 1 + line.operand.length;
    }
  }
  if (line.comment) {
    var target = (line.commentCol >= 0) ? line.commentCol : 32;
    // Need at least one space between content and the `;`. If the
    // operand pushed us past the target column, just use one space.
    var gap = Math.max((col === 0 || col === 9 ? 0 : 1), target - col);
    html += ' '.repeat(gap) + '<span class="text-muted">;' + escHtml(line.comment) + '</span>';
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

  var labelRes = tassParseLabels(payload);
  var labels = labelRes.labels;
  var labelsStart = labelRes.start;

  // Source body starts at file offset $0100 (after the 2-byte load address
  // + 14-byte header through the magic + 240 bytes of editor state). In
  // payload coordinates (load address stripped) that's $00FE. The body
  // starts directly with content — no leading marker is required (some
  // files begin with a column-0 comment $80, others with an instruction
  // or directive). We tokenize from $00FE unconditionally.
  var srcStart = 0xFE;

  // TASS marks the end of the source body with the "TURBO" signature.
  // Two shapes seen in real files:
  //   long  : $06 $29 <addr-lo> <addr-hi> <any> $54 $55 $52 $42 $4F $04
  //   short : <any> $54 $55 $52 $42 $4F …    (no `*= $XXXX` directive)
  // The `$06 $29 LO HI` form encodes a leading `*= $HILO` origin
  // directive that we surface as the first display line. The short
  // form appears when the source has no origin directive (e.g., a
  // pure-comment file). Either way, "TURBO" marks the handoff from
  // user source to TASS metadata (assembled output, sprite data, …).
  var tassSentinelStart = -1;
  var tassSentinelEnd = -1;
  var tassOrigin = -1;
  for (var ss = srcStart; ss < payload.length - 5; ss++) {
    if (payload[ss] === 0x54 && payload[ss + 1] === 0x55 &&
        payload[ss + 2] === 0x52 && payload[ss + 3] === 0x42 &&
        payload[ss + 4] === 0x4F) {
      tassSentinelEnd = ss + 5;
      // Long form? Check for `$06 $29 LO HI <any>` 5 bytes earlier.
      if (ss >= srcStart + 5 && payload[ss - 5] === 0x06 && payload[ss - 4] === 0x29) {
        tassOrigin = payload[ss - 3] | (payload[ss - 2] << 8);
        tassSentinelStart = ss - 5;
      } else {
        // Short form: trim back through the immediately-preceding byte
        // (typically $FF) so it doesn't get treated as source content.
        tassSentinelStart = ss > srcStart && payload[ss - 1] === 0xFF ? ss - 1 : ss;
      }
      break;
    }
  }

  // Source body end: stop right before the sentinel preamble. Falls
  // back to the label-table start when no sentinel is found.
  // NOTE: don't trim trailing $00 bytes — a $00 just before the sentinel
  // is often the operand byte of the last instruction (e.g. `bit base0`
  // where label "base0" is idx 0 → $00 is a legitimate operand byte, not
  // padding). The TURBO sentinel detection already gives us the precise
  // end of source content.
  var srcEnd = tassSentinelStart > 0 ? tassSentinelStart : labelsStart;

  // NOTE: $80 is a block separator BUT can also appear as the low byte of an
  // absolute address (e.g. `sta $0580` = $8D $29 $80 $05). Pre-splitting on
  // raw $80 would cut through real instructions. Instead, tokenize the whole
  // source as one stream — $80 is only a separator when encountered at an
  // instruction boundary (not mid-operand).

  var html = '<div class="basic-listing tass-screen">';
  if (srcStart >= payload.length) {
    html += '<div class="basic-line">Could not locate source body (no $80 separator found).</div>';
  }

  // Emit `*= $origin` as the first source line when the TURBO sentinel told us
  // the origin address — this is always the top-of-source directive in TASS.
  if (tassOrigin >= 0) {
    html += '<div class="basic-line">         <span class="basic-keyword">*=</span> $' + tassOrigin.toString(16).padStart(4, '0') + '</div>';
  }

  // Tokenize the entire source body as one stream. $80-$BF bytes are
  // comment markers (column = byte - $80), disambiguated against opcodes
  // by checking the following byte for a valid TASS operand prefix.
  var allLines = tassTokenizeBlock(payload, srcStart, srcEnd, labels);

  // Pure-ASCII run collapsing: a sequence of .byte lines whose bytes are all
  // printable ASCII and which is bookended by separators represents a user
  // comment line that TASS stored as literal ASCII text. Collapse those into
  // a single ;text line.
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
    // Try to accumulate run of consecutive label-less, no-comment .byte lines
    // that decode to printable ASCII between separators.
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
        // Only collapse if there's at least one surrounding separator and
        // the next real token after the run is also a separator.
        var bookendedByEnd = aj >= allLines.length || allLines[aj].separator;
        if (bookendedByEnd && accTxt.length >= 2) {
          collapsed.push({ label: null, instr: null, operand: null, comment: accTxt.toLowerCase(), isTextBlock: true });
          ai = aj - 1;
          continue;
        }
      }
    }
    collapsed.push(cur2);
  }

  // Reverse the collapsed token list for display (TASS stores source bottom-up
  // within each block AND blocks bottom-up too).
  collapsed.reverse();

  // Deduplicate consecutive separators, and strip leading/trailing separators.
  var cleaned = [];
  for (var ci = 0; ci < collapsed.length; ci++) {
    var ln = collapsed[ci];
    if (ln.separator && cleaned.length > 0 && cleaned[cleaned.length - 1].separator) continue;
    cleaned.push(ln);
  }
  // Trim a trailing separator only (the final $80 before the TURBO sentinel
  // often leaves a stray empty tail). Keep leading separators — user code
  // often starts with a `;----` rule line right under the `*= $orig` line.
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
  showViewerModal(titleText, html, 'lg');
}
