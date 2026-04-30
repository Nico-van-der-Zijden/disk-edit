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

  // Anchor: first run of at least 32 consecutive label-bytes that contains a
  // high-bit terminator. That's well into the label table and avoids matching
  // short label-like bursts that can appear in data areas.
  var anchor = -1;
  var runStart = -1, runLen = 0, runHasTerm = false;
  for (var i = 0; i < data.length; i++) {
    if (isLabelByte(data[i])) {
      if (runLen === 0) { runStart = i; runHasTerm = false; }
      runLen++;
      if (isLabelTerm(data[i])) runHasTerm = true;
      if (runLen >= 32 && runHasTerm) { anchor = runStart; break; }
    } else {
      runLen = 0;
    }
  }
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

  var p = anchor;
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

function tassDecodeOperand(data, pos, opInfo, labels) {
  var mode = opInfo[1];
  if (mode === 'none' || mode === 'acc') return { text: '', n: 0 };
  if (pos >= data.length) return { text: '', n: 0 };
  var pfx = data[pos];
  var lo, hi, v, idx;
  if (mode === 'imm') {
    if (pfx === 0x28) { v = data[pos + 1] || 0; return { text: '#$' + v.toString(16).padStart(2,'0'), n: 2 }; }
    if (pfx === 0x2A) { v = data[pos + 1] || 0; return { text: '#' + v.toString(), n: 2 }; }
    if (pfx === 0x2E) {
      // Character-literal immediate: `#"X"`. Render the value as a quoted char
      // if printable, otherwise as hex.
      v = data[pos + 1] || 0;
      if (v >= 0x20 && v <= 0x7E) return { text: '#"' + String.fromCharCode(v) + '"', n: 2 };
      return { text: '#$' + v.toString(16).padStart(2,'0'), n: 2 };
    }
    if (pfx === 0x38 || pfx === 0x39) {
      idx = (pfx - 0x38) * 256 + data[pos + 1];
      return { text: '#' + (labels[idx] || '?lbl' + idx), n: 2 };
    }
    // $44 = '>' (high byte of expression), $45 = '<' (low byte). Both take a
    // label-ref ($38 NN or $39 NN) as the argument.
    if ((pfx === 0x44 || pfx === 0x45) && (data[pos + 1] === 0x38 || data[pos + 1] === 0x39)) {
      var lblPg = data[pos + 1] - 0x38;
      idx = lblPg * 256 + data[pos + 2];
      var lblName = labels[idx] || ('?lbl' + idx);
      return { text: '#' + (pfx === 0x44 ? '>' : '<') + lblName, n: 3 };
    }
    return { text: '#?$' + pfx.toString(16), n: 1 };
  }
  if (mode === 'abs' || mode === 'abs-x' || mode === 'abs-y' || mode === 'iny' ||
      mode === 'ind' || mode === 'zp' || mode === 'zpx' || mode === 'zpy' || mode === 'izx') {
    var val = '', n = 1;
    // $2D alone (not followed by an operand) = "*" (current PC). Seen after
    // jmp/jsr/branches as `jmp *` (infinite loop at current address).
    if (pfx === 0x2D) { return { text: '*', n: 1 }; }
    if (pfx === 0x28) { val = '$' + (data[pos + 1] || 0).toString(16).padStart(2,'0'); n = 2; }
    else if (pfx === 0x29) { lo = data[pos + 1] || 0; hi = data[pos + 2] || 0; val = '$' + ((hi << 8) | lo).toString(16).padStart(4,'0'); n = 3; }
    else if (pfx === 0x38 || pfx === 0x39) { idx = (pfx - 0x38) * 256 + data[pos + 1]; val = labels[idx] || ('?lbl' + idx); n = 2; }
    else if (pfx === 0x2A) { val = (data[pos + 1] || 0).toString(); n = 2; }
    else if (pfx === 0x30) {
      // label-with-expression: $30 LBL [$40 $2A/$28/$29 VALUE]  →  "label+N"
      idx = data[pos + 1];
      val = labels[idx] || ('?lbl' + idx);
      n = 2;
      var op3 = data[pos + 2];
      if (op3 === 0x40) {
        var vpfx = data[pos + 3];
        if (vpfx === 0x2A) { val += '+' + (data[pos + 4] || 0).toString(); n = 5; }
        else if (vpfx === 0x28) { val += '+$' + (data[pos + 4] || 0).toString(16).padStart(2,'0'); n = 5; }
        else if (vpfx === 0x29) { val += '+$' + (((data[pos + 5] || 0) << 8) | (data[pos + 4] || 0)).toString(16).padStart(4,'0'); n = 6; }
        else { val += '+?'; n = 3; }
      }
    }
    else { val = '?$' + pfx.toString(16); n = 1; }
    if (mode === 'abs-x' || mode === 'zpx') val += ',x';
    else if (mode === 'abs-y' || mode === 'zpy') val += ',y';
    else if (mode === 'iny') val = '(' + val + '),y';
    else if (mode === 'izx') val = '(' + val + ',x)';
    else if (mode === 'ind') val = '(' + val + ')';
    return { text: val, n: n };
  }
  if (mode === 'rel') {
    if (pfx === 0x38 || pfx === 0x39) { idx = (pfx - 0x38) * 256 + data[pos + 1]; return { text: labels[idx] || ('?lbl' + idx), n: 2 }; }
    if (pfx === 0x28) { return { text: '$' + (data[pos + 1] || 0).toString(16).padStart(2,'0'), n: 2 }; }
    return { text: '?', n: 1 };
  }
  return { text: '?', n: 0 };
}

function tassTokenizeBlock(data, start, end, labels) {
  var lines = [];
  var cur = { label: null, instr: null, operand: null, comment: null, isData: false };
  var unknownRun = [];
  function flushData() {
    if (unknownRun.length === 0) return;
    var parts = [];
    for (var k = 0; k < unknownRun.length; k++) parts.push('$' + unknownRun[k].toString(16).padStart(2, '0'));
    lines.push({ label: null, instr: '.byte', operand: parts.join(','), comment: null, isData: true });
    unknownRun = [];
  }
  function flush() {
    flushData();
    if (cur.label || cur.instr || cur.comment) lines.push(cur);
    cur = { label: null, instr: null, operand: null, comment: null, isData: false };
  }
  var i = start;
  while (i < end) {
    var b = data[i];
    // Comment markers: $93-$97 are all `;` variants (different column
    // alignment in TASS's editor). $94/$95/$96/$97 also happen to be valid
    // 6502 opcodes (STY/STA/STX zpx/zpy etc.), so only treat as a comment if
    // the next byte is NOT a TASS operand prefix.
    if (b >= 0x93 && b <= 0x97 && !(
      (b === 0x94 || b === 0x95 || b === 0x96) && i + 1 < end &&
      (data[i + 1] === 0x28 || data[i + 1] === 0x29 || data[i + 1] === 0x2A ||
       data[i + 1] === 0x38 || data[i + 1] === 0x39)
    )) {
      flushData();
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
      while (i < end) {
        var c = data[i];
        if (c === 0x80) break;
        // $2D is literal '-' in comments (before opcode check: $2D=AND abs
        // is a valid 6502 opcode, but inside a comment '-' is overwhelmingly
        // more likely).
        if (c === 0x2D) { text += '-'; i++; continue; }
        // An opcode that takes an operand followed by a valid TASS operand
        // prefix unambiguously starts the next instruction.
        var op = TASS_OPCODES[c];
        if (op && op[1] !== 'none' && op[1] !== 'acc' && i + 1 < end) {
          var nx = data[i + 1];
          if (nx === 0x28 || nx === 0x29 || nx === 0x2A || nx === 0x38 || nx === 0x39) break;
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
        // Label-def marker `$30 NN` or `$31 NN` — treat as line-start only if
        // the byte AFTER the label index is a directive marker or $80. Avoid
        // matching on opcodes here because ASCII digits like "dc01$8D" could
        // collide (and $8D won't appear inside a comment, so a non-printable
        // byte breaks the comment naturally on its own).
        if ((c === 0x30 || c === 0x31) && i + 2 < end) {
          var lbNN = data[i + 1];
          var lbIdx = (c - 0x30) * 256 + lbNN;
          if (lbIdx < labels.length) {
            var after = data[i + 2];
            if (after === 0x02 || after === 0x03 || after === 0x04 ||
                after === 0x05 || after === 0x06 || after === 0x80) break;
          }
        }
        var letter = petsciiToLetter(c);
        if (letter !== null) { text += letter; i++; continue; }
        break;
      }
      cur.comment = text.replace(/\s+$/, '');
      flush();
      continue;
    }
    // $30 NN = label def (idx NN). $31 NN = high-page label def (idx 256+NN).
    // Generalized as $(30+page) NN for label indexes in [page*256, page*256+256).
    if ((b === 0x30 || b === 0x31) && i + 1 < end) {
      var page = b - 0x30;
      var lidx = page * 256 + data[i + 1];
      if (lidx < labels.length) {
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
      var pfxOk = bpfx === 0x28 || bpfx === 0x29 || bpfx === 0x2A || bpfx === 0x38;
      if (pfxOk) {
        flushData();
        if (cur.instr) flush();
        cur.instr = b === 0x04 ? '.word' : '.byte';
        var bvals = [];
        i++;
        while (i < end) {
          var bp = data[i];
          if (bp === 0x28) { bvals.push('$' + (data[i + 1] || 0).toString(16).padStart(2,'0')); i += 2; }
          else if (bp === 0x29) { bvals.push('$' + (((data[i + 2] || 0) << 8) | (data[i + 1] || 0)).toString(16).padStart(4,'0')); i += 3; }
          else if (bp === 0x2A) { bvals.push((data[i + 1] || 0).toString()); i += 2; }
          else if (bp === 0x38 || bp === 0x39) { var lix = (bp - 0x38) * 256 + data[i + 1]; bvals.push(labels[lix] || ('?lbl' + lix)); i += 2; }
          else break;
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
    if (b === 0x80) {
      // Block boundary: flush any in-progress line and skip past the $80.
      // We emit synthetic separator tokens lazily based on block content
      // (see "pure-padding" check below), not automatically per boundary.
      flushData();
      if (cur.label || cur.instr || cur.comment) flush();
      i++;
      // Look ahead to the next $80 and classify the block.
      var look = i;
      while (look < end && data[look] !== 0x80) look++;
      // Classify the block: is it a "pure comment line" (no code/directive
      // bytes) or does it contain instructions?
      //
      // A whole-line comment in TASS is just a block of text/decoration
      // without any opcode or directive marker. The `;` prefix we show
      // is TASS's comment-marker convention — it's NOT stored in the
      // bytes. Whatever is in the bytes renders literally after `;`.
      //
      // Note: $20 (JSR), $38 (label-ref prefix), etc. are printable ASCII
      // AND valid code bytes. Distinguish by looking for opcode+operand-prefix
      // sequences, directive markers, and comment markers — if any of those
      // are present, the block is code.
      var hasCode = false;
      var renderable = 0;
      for (var ti2 = i; ti2 < look; ti2++) {
        var bb = data[ti2];
        if (bb === 0x00) continue;
        // Strong code indicators — bytes / patterns that are unambiguous:
        //   * High-bit opcode ($80+) that takes an operand, followed by a
        //     valid TASS operand prefix. These bytes are outside printable
        //     ASCII, so they can't appear in comment text.
        //   * `$20 $38/$39` = `jsr label` (JSR + label-ref prefix). $20 alone
        //     is ASCII space, so we require the following $38/$39.
        //   * `$4C $29/$38/$39/$2D` = `jmp $XXXX/label/*`. $4C is ASCII 'L'
        //     but these specific next bytes are unlikely in text.
        //   * Directive markers $02/$03/$04/$06 followed by a valid prefix.
        //   * Inline comment markers $93-$97.
        if (bb >= 0x80 && TASS_OPCODES[bb] && ti2 + 1 < look) {
          var mode0 = TASS_OPCODES[bb][1];
          var next0 = data[ti2 + 1];
          if (mode0 !== 'none' && mode0 !== 'acc' &&
              (next0 === 0x28 || next0 === 0x29 || next0 === 0x2A ||
               next0 === 0x38 || next0 === 0x39 || next0 === 0x2D ||
               next0 === 0x44 || next0 === 0x45 || next0 === 0x30 ||
               (next0 === 0x2E && mode0 === 'imm'))) {
            hasCode = true; break;
          }
        }
        if (bb === 0x20 && ti2 + 1 < look && (data[ti2 + 1] === 0x38 || data[ti2 + 1] === 0x39 || data[ti2 + 1] === 0x29)) {
          hasCode = true; break;
        }
        if (bb === 0x4C && ti2 + 1 < look) {
          var jn = data[ti2 + 1];
          if (jn === 0x29 || jn === 0x38 || jn === 0x39 || jn === 0x2D) {
            hasCode = true; break;
          }
        }
        if ((bb === 0x02 || bb === 0x03 || bb === 0x04 || bb === 0x06) && ti2 + 1 < look) {
          var dnx0 = data[ti2 + 1];
          if (dnx0 === 0x28 || dnx0 === 0x29 || dnx0 === 0x2A || dnx0 === 0x38 || dnx0 === 0x39 ||
              (bb === 0x02 && dnx0 > 0 && dnx0 <= 64)) {
            hasCode = true; break;
          }
        }
        if (bb >= 0x93 && bb <= 0x97) { hasCode = true; break; }
        // Otherwise check if byte is a plausible comment character.
        var isCommentChar = (bb >= 0x20 && bb <= 0x7E) || bb === 0xA0 ||
                            (bb >= 0xC1 && bb <= 0xDA) || bb === 0xC0;
        if (isCommentChar) { renderable++; continue; }
        hasCode = true;
        break;
      }
      if (!hasCode && renderable >= 1) {
        // Whole-line comment. Render each byte through the PETSCII PUA map
        // so the C64 Pro font picks the correct glyph. $00 is skipped
        // (pure padding, never typed).
        var cmtStr = '';
        for (var ri = i; ri < look; ri++) {
          var rb = data[ri];
          if (rb === 0x00) continue;
          cmtStr += petsciiToAscii(rb);
        }
        if (cmtStr.length >= 1) {
          lines.push({ label: null, instr: null, operand: null, comment: cmtStr, isTextBlock: true });
          i = look;
          continue;
        }
      }
      // Code/data block — fall through to normal tokenizer.
      continue;
    }
    // $C0, $00, $2D = padding / horizontal-rule filler — skip. ($2D is
    // ambiguous: it's also ASCII '-', but treating it as padding loses '-' in
    // text comments — a small readability trade-off to avoid false `and *`
    // decodes on `$2D $2D` rule-fill bytes.)
    // A run of 30+ padding bytes represents a user-drawn rule line; emit a
    // synthetic SEP so it renders as `;---` in the output.
    // A long run of padding/decoration bytes in the middle of a block is a
    // user-drawn rule line. Emit the actual character sequence as a comment.
    if (b === 0xC0 || b === 0x00 || b === 0x2D || b === 0x3D || b === 0x5F) {
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
      // TASS operand prefix ($28/$29/$2A/$30/$38). If not, this byte is almost
      // certainly a data byte that happens to land on a valid opcode value.
      if (mode !== 'none' && mode !== 'acc') {
        var nextB = i + 1 < end ? data[i + 1] : 0;
        var validPfx = false;
        if (nextB === 0x28 || nextB === 0x29 || nextB === 0x2A || nextB === 0x38 || nextB === 0x39) validPfx = true;
        else if (nextB === 0x2E && mode === 'imm') validPfx = true;
        // $30 = label-ref with expression ($30 LBL $40 PFX VAL). Only valid in
        // abs-like modes. Also requires the following byte to be a label index.
        else if (nextB === 0x30 && (mode === 'abs' || mode === 'abs-x' || mode === 'abs-y' ||
                                    mode === 'zp' || mode === 'zpx' || mode === 'zpy')) {
          // Label index must be valid
          if (i + 2 < end && data[i + 2] < labels.length) validPfx = true;
        }
        // $2D = '*' (current PC), only in abs-like modes (jmp/jsr/branches).
        else if (nextB === 0x2D && (mode === 'abs' || mode === 'rel' || mode === 'ind')) validPfx = true;
        // $44/$45 = '>'/'<' operators, only in imm mode, followed by $38 LBL.
        else if ((nextB === 0x44 || nextB === 0x45) && mode === 'imm' &&
                 i + 2 < end && data[i + 2] === 0x38) validPfx = true;
        if (!validPfx) {
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
  // Column layout matches TASS's on-screen format:
  //   col  0-8: label name (padded with spaces)
  //   col   9+: mnemonic
  //   col  14+: operand
  //   col  25+: trailing comment (`;comment`)
  var html = '';
  if (line.label) {
    var pad = Math.max(1, 9 - line.label.length);
    html += '<span class="basic-keyword">' + escHtml(line.label) + '</span>' + ' '.repeat(pad);
  } else {
    html += '         ';
  }
  var instrLen = 0;
  if (line.instr) {
    html += '<span class="basic-keyword">' + escHtml(line.instr) + '</span>';
    instrLen += line.instr.length;
    if (line.operand) {
      // operandHtml carries pre-built HTML (e.g. `.text` strings with
      // reversed-char spans); operand stays as plain text for length math.
      html += ' ' + (line.operandHtml || escHtml(line.operand));
      instrLen += 1 + line.operand.length;
    }
  }
  if (line.comment) {
    var gap = Math.max(1, 16 - instrLen);
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

  // Source body starts at $0100 in the PRG payload (after 16-byte header +
  // editor-state bytes $10-$FF). Find the first $80 at or after that offset —
  // that's the top-of-source marker.
  var srcStart = 0x100;
  while (srcStart < payload.length && payload[srcStart] !== 0x80) srcStart++;

  // TASS marks the end of the source body with a sentinel:
  //   $06 $29 <addr-lo> <addr-hi> <any> $54 $55 $52 $42 $4F $04
  // The `$06 $29 XX YY` encodes the leading `*= $YYXX` origin directive, and
  // `$54..$4F $04` = "TURBO" + $04 marks the handoff from user source to
  // TASS-appended metadata (assembled output, sprite data, etc.). Find the
  // first occurrence at or after srcStart and treat that as the true source end.
  var tassSentinelEnd = -1;
  var tassOrigin = -1;
  for (var ss = srcStart; ss < payload.length - 10; ss++) {
    if (payload[ss] === 0x06 && payload[ss + 1] === 0x29 &&
        payload[ss + 5] === 0x54 && payload[ss + 6] === 0x55 &&
        payload[ss + 7] === 0x52 && payload[ss + 8] === 0x42 &&
        payload[ss + 9] === 0x4F && payload[ss + 10] === 0x04) {
      tassOrigin = payload[ss + 2] | (payload[ss + 3] << 8);
      tassSentinelEnd = ss + 11;
      break;
    }
  }

  // Source body end: if we found the TURBO sentinel, stop at the $06 byte
  // (so the sentinel itself is excluded from block parsing). Otherwise fall
  // back to the start of the label table.
  var srcEnd = tassSentinelEnd > 0 ? (tassSentinelEnd - 11) : labelsStart;
  while (srcEnd > srcStart && payload[srcEnd - 1] === 0) srcEnd--;

  // NOTE: $80 is a block separator BUT can also appear as the low byte of an
  // absolute address (e.g. `sta $0580` = $8D $29 $80 $05). Pre-splitting on
  // raw $80 would cut through real instructions. Instead, tokenize the whole
  // source as one stream — $80 is only a separator when encountered at an
  // instruction boundary (not mid-operand).

  var html = '<div class="basic-listing">';
  if (srcStart >= payload.length) {
    html += '<div class="basic-line">Could not locate source body (no $80 separator found).</div>';
  }

  // Emit `*= $origin` as the first source line when the TURBO sentinel told us
  // the origin address — this is always the top-of-source directive in TASS.
  if (tassOrigin >= 0) {
    html += '<div class="basic-line">         <span class="basic-keyword">*=</span> $' + tassOrigin.toString(16).padStart(4, '0') + '</div>';
  }

  // Tokenize the entire source body as one stream (skipping the initial $80
  // marker). Separator tokens are emitted inside the tokenizer only at true
  // instruction boundaries, so $80 bytes embedded in operands don't cause
  // false block splits.
  var allLines = tassTokenizeBlock(payload, srcStart + 1, srcEnd, labels);

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
  showViewerModal(titleText, html);
}
