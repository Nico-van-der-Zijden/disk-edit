
// ── BASIC detokenizer ─────────────────────────────────────────────────
// BASIC V2 tokens ($80-$CB) — C64, VIC-20, C128 (shared base)
var BASIC_V2_TOKENS = [
  'END','FOR','NEXT','DATA','INPUT#','INPUT','DIM','READ',       // $80-$87
  'LET','GOTO','RUN','IF','RESTORE','GOSUB','RETURN','REM',      // $88-$8F
  'STOP','ON','WAIT','LOAD','SAVE','VERIFY','DEF','POKE',        // $90-$97
  'PRINT#','PRINT','CONT','LIST','CLR','CMD','SYS','OPEN',       // $98-$9F
  'CLOSE','GET','NEW','TAB(','TO','FN','SPC(','THEN',             // $A0-$A7
  'NOT','STEP','+','-','*','/','^','AND',                         // $A8-$AF
  'OR','>','=','<','SGN','INT','ABS','USR',                       // $B0-$B7
  'FRE','POS','SQR','RND','LOG','EXP','COS','SIN',               // $B8-$BF
  'TAN','ATN','PEEK','LEN','STR$','VAL','ASC','CHR$',            // $C0-$C7
  'LEFT$','RIGHT$','MID$','GO'                                    // $C8-$CB
];

// BASIC V7 extended single-byte tokens ($CC-$FD) — C128
var BASIC_V7_TOKENS = [
  'RGR','RCLR',                                                   // $CC-$CD
  null,                                                            // $CE = prefix
  'JOY','RDOT','DEC','HEX$','ERR$','INSTR',                      // $CF-$D4
  'ELSE','RESUME','TRAP','TRON','TROFF','SOUND',                  // $D5-$DA
  'VOL','AUTO','PUDEF','GRAPHIC','PAINT','CHAR',                  // $DB-$E0
  'BOX','CIRCLE','GSHAPE','SSHAPE','DRAW','LOCATE',              // $E1-$E6
  'COLOR','SCNCLR','SCALE','HELP','DO','LOOP',                   // $E7-$EC
  'EXIT','DIRECTORY','DSAVE','DLOAD','HEADER','SCRATCH',          // $ED-$F2
  'COLLECT','COPY','RENAME','BACKUP','DELETE','RENUMBER',         // $F3-$F8
  'KEY','MONITOR','USING','UNTIL','WHILE',                        // $F9-$FD
  null                                                             // $FE = prefix
];

// BASIC V7 $CE prefix tokens (functions)
var BASIC_V7_CE_TOKENS = {
  0x02: 'POT', 0x03: 'BUMP', 0x04: 'PEN', 0x05: 'RSPPOS',
  0x06: 'RSPRITE', 0x07: 'RCOLOR', 0x08: 'XOR', 0x09: 'RWINDOW',
  0x0A: 'POINTER'
};

// BASIC V7 $FE prefix tokens (commands)
var BASIC_V7_FE_TOKENS = {
  0x02: 'BANK', 0x03: 'FILTER', 0x04: 'PLAY', 0x05: 'TEMPO',
  0x06: 'MOVSPR', 0x07: 'SPRITE', 0x08: 'SPRCOLOR', 0x09: 'RREG',
  0x0A: 'ENVELOPE', 0x0B: 'SLEEP', 0x0C: 'CATALOG', 0x0D: 'DOPEN',
  0x0E: 'APPEND', 0x0F: 'DCLOSE', 0x10: 'BSAVE', 0x11: 'BLOAD',
  0x12: 'RECORD', 0x13: 'CONCAT', 0x14: 'DVERIFY', 0x15: 'DCLEAR',
  0x16: 'SPRSAV', 0x17: 'COLLISION', 0x18: 'BEGIN', 0x19: 'BEND',
  0x1A: 'WINDOW', 0x1B: 'BOOT', 0x1C: 'WIDTH', 0x1D: 'SPRDEF',
  0x1E: 'QUIT', 0x1F: 'STASH', 0x21: 'FETCH', 0x23: 'SWAP',
  0x24: 'OFF', 0x25: 'FAST', 0x26: 'SLOW'
};

// Simons' BASIC extended tokens ($CC-$FE)
var SIMONS_TOKENS = [
  'HIRES','PLOT','LINE','BLOCK','FCHR','FCOL','FILL','REC',      // $CC-$D3
  'ROT','DRAW','CHAR','HI COL','INV','FREV','BASE','DENSITY',    // $D4-$DB
  'DVPLPT','COLOURS','PENX','PENY','SOUND','VOL','WAVE','MUSIC', // $DC-$E3
  'PLAY','RPT','ENVELOPE','CENTRE','DESIGN','RCOMP','DISPLAY',   // $E4-$EA
  'MOV','TRACE','IF#','ELSE','PAGE','EXEC','FIND','OPTION',      // $EB-$F2
  'AUTO','OLD','JOY','MOD','DIV','!','DEC','HEX$',               // $F3-$FA
  'DEEK','ERROR','CGOTO'                                           // $FB-$FD
];

// Final Cartridge III extended tokens ($CC-$FE)
var FC3_TOKENS = [
  'OFF','AUTO','DEL','RENUM','?','DUMP','ARRAY','MEM',            // $CC-$D3
  'TRACE','REPLACE','ORDER','PACK','UNPACK','MREAD','MWRITE',     // $D4-$DA
  null, null, null, null, null, null, null, null,                  // $DB-$E2
  null, null, null, null, null, null, null, null,                  // $E3-$EA
  null, null, null, null, null, null, null, null,                  // $EB-$F2
  null, null, null, null, null, null                                // $F3-$F8
];

// BASIC V3.5 (C16/Plus4) extended tokens ($CC-$FE)
var BASIC_V35_TOKENS = [
  'RGR','RCLR','RLUM','JOY','RDOT','DEC','HEX$','ERR$',         // $CC-$D3
  'INSTR','ELSE','RESUME','TRAP','TRON','TROFF','SOUND',          // $D4-$DA
  'VOL','AUTO','PUDEF','GRAPHIC','PAINT','CHAR','BOX',            // $DB-$E1
  'CIRCLE','PASTE','CUT','LINE','LOCATE','COLOR','SCNCLR',       // $E2-$E8
  'SCALE','HELP','DO','LOOP','EXIT','DIRECTORY','DSAVE',          // $E9-$EF
  'DLOAD','HEADER','SCRATCH','COLLECT','COPY','RENAME','BACKUP',  // $F0-$F6
  'DELETE','RENUMBER','KEY','MONITOR','USING','UNTIL','WHILE'     // $F7-$FD
];

// Known BASIC load addresses → version
var BASIC_LOAD_ADDRS = {
  0x0401: 'V2',   // VIC-20 unexpanded
  0x0801: 'V2',   // C64
  0x1001: 'V35',  // C16/Plus4 (or VIC-20 +8K)
  0x1201: 'V2',   // VIC-20 +16K
  0x1C01: 'V7'    // C128
};

// Check if file data looks like a BASIC program
function isBasicProgram(fileData) {
  if (!fileData || fileData.length < 6) return false;
  var addr = fileData[0] | (fileData[1] << 8);
  return BASIC_LOAD_ADDRS[addr] !== undefined;
}

function emitLiteral(parts, b, type) {
  // Render every PETSCII byte through the same map filenames/TASS use,
  // so the visible glyph is consistent across the app and the C64 Pro
  // font handles all 256 positions. Control-code ranges ($00-$1F and
  // $80-$9F) get reversed:true so the renderer wraps them in
  // `.petscii-rev` — matching how the C64 LIST routine displays them
  // and how TASS draws .text strings.
  var rev = (b <= 0x1F) || (b >= 0x80 && b <= 0x9F);
  parts.push({ type: type, text: petsciiToAscii(b), reversed: rev });
}

function detokenizeBasic(fileData, dialect) {
  if (fileData.length < 4) return null;

  var loadAddr = fileData[0] | (fileData[1] << 8);
  var version = dialect || BASIC_LOAD_ADDRS[loadAddr] || 'V2';
  var isV7 = version === 'V7';
  var lines = [];
  var pos = 2;

  while (pos < fileData.length - 1) {
    // C64 LIST checks only the high byte of the link pointer for end-of-program
    if (fileData[pos + 1] === 0x00) break;

    var lineNum = fileData[pos + 2] | (fileData[pos + 3] << 8);
    pos += 4;

    var parts = [];
    var inQuotes = false;
    var inRem = false;
    var inData = false;

    while (pos < fileData.length && fileData[pos] !== 0x00) {
      var b = fileData[pos];

      // Inside REM: everything is literal
      if (inRem) {
        emitLiteral(parts, b, 'rem');
        pos++;
        continue;
      }

      // Quote toggle
      if (b === 0x22) {
        inQuotes = !inQuotes;
        parts.push({ type: 'string', text: '"' });
        pos++;
        continue;
      }

      // Inside quotes or DATA: literal characters
      if (inQuotes) {
        emitLiteral(parts, b, 'string');
        pos++;
        continue;
      }

      // Colon ends DATA mode
      if (inData && b === 0x3A) inData = false;

      // Inside DATA values: treat as literal (no token expansion)
      if (inData) {
        emitLiteral(parts, b, 'text');
        pos++;
        continue;
      }

      // V7 prefix tokens
      if (isV7 && b === 0xCE && pos + 1 < fileData.length) {
        var ceToken = BASIC_V7_CE_TOKENS[fileData[pos + 1]];
        if (ceToken) {
          parts.push({ type: 'keyword', text: ceToken });
          pos += 2;
          continue;
        }
      }
      if (isV7 && b === 0xFE && pos + 1 < fileData.length) {
        var feToken = BASIC_V7_FE_TOKENS[fileData[pos + 1]];
        if (feToken) {
          parts.push({ type: 'keyword', text: feToken });
          pos += 2;
          continue;
        }
      }

      // V7 single-byte extended tokens ($CC-$FD)
      if (isV7 && b >= 0xCC && b <= 0xFD) {
        var v7kw = BASIC_V7_TOKENS[b - 0xCC];
        if (v7kw) {
          parts.push({ type: 'keyword', text: v7kw });
          pos++;
          continue;
        }
      }

      // V2 tokens ($80-$CB)
      if (b >= 0x80 && b <= 0xCB) {
        var keyword = BASIC_V2_TOKENS[b - 0x80];
        parts.push({ type: 'keyword', text: keyword });
        if (keyword === 'REM') inRem = true;
        if (keyword === 'DATA') inData = true;
        pos++;
        continue;
      }

      // Extended tokens ($CC-$FD) for non-V7 dialects
      if (!isV7 && b >= 0xCC && b <= 0xFD) {
        var extKw = null;
        if (version === 'V35') extKw = BASIC_V35_TOKENS[b - 0xCC];
        else if (version === 'FC3') extKw = FC3_TOKENS[b - 0xCC];
        else if (version === 'SIMONS') extKw = SIMONS_TOKENS[b - 0xCC];
        else extKw = SIMONS_TOKENS[b - 0xCC]; // default for V2
        if (extKw) {
          parts.push({ type: 'keyword', text: extKw });
          pos++;
          continue;
        }
      }

      // Literal character (rare — should normally be inside a string or REM,
      // but handle gracefully). Same PETSCII rendering rules as emitLiteral.
      var revLit = (b <= 0x1F) || (b >= 0x80 && b <= 0x9F);
      parts.push({ type: 'text', text: petsciiToAscii(b), reversed: revLit });
      pos++;
    }

    if (pos < fileData.length) pos++; // skip the 0x00 terminator
    lines.push({ lineNum: lineNum, parts: parts });
  }

  return { loadAddr: loadAddr, version: version, lines: lines };
}

function showFileBasicViewer(entryOff) {
  if (!currentBuffer) return;
  showFileBasicRendered(entryOff, null);
}

function showFileBasicRendered(entryOff, dialect) {
  var result = readFileData(currentBuffer, entryOff);
  var fileData = result.data;
  var data = new Uint8Array(currentBuffer);
  var name = petsciiToReadable(readPetsciiString(data, entryOff + 5, 16)).trim();

  var basic = detokenizeBasic(fileData, dialect);
  if (!basic || basic.lines.length === 0) {
    showModal('BASIC View', ['Not a valid BASIC program or empty file.']);
    return;
  }

  var rendered = renderBasicHtml(basic, name, result);

  var versionLabels = {
    V2: 'BASIC V2', V7: 'BASIC V7 (C128)', V35: 'BASIC V3.5 (C16/Plus4)',
    SIMONS: "Simons' BASIC", FC3: 'Final Cartridge III'
  };
  var versionLabel = versionLabels[rendered.basic.version] || 'BASIC V2';
  var titleText = versionLabel + ' \u2014 "' + name + '" (load: $' + hex16(rendered.basic.loadAddr) + ')';
  if (result.error) titleText += ' \u2014 ' + result.error;

  // Dialect selector for C64 programs (V2 load address, not V7/V35)
  var detectedVersion = BASIC_LOAD_ADDRS[rendered.basic.loadAddr] || 'V2';
  var showDialect = (detectedVersion === 'V2');
  var currentDialect = dialect || detectedVersion;

  var body = showViewerModal(titleText, rendered.html);

  if (showDialect) {
    var selDiv = document.createElement('div');
    selDiv.style.cssText = 'margin-bottom:8px;display:flex;gap:8px;align-items:center;font-size:12px';
    var selLabel = document.createElement('span');
    selLabel.textContent = 'Dialect:';
    selLabel.style.color = 'var(--text-muted)';
    selDiv.appendChild(selLabel);
    var dialects = [
      ['V2', 'BASIC V2 (standard)'],
      ['SIMONS', "Simons' BASIC"],
      ['FC3', 'Final Cartridge III']
    ];
    for (var di = 0; di < dialects.length; di++) {
      (function(val, label) {
        var btn = document.createElement('button');
        btn.textContent = label;
        btn.className = 'btn-small' + (currentDialect === val ? ' active' : '');
        btn.addEventListener('click', function() {
          showFileBasicRendered(entryOff, val);
        });
        selDiv.appendChild(btn);
      })(dialects[di][0], dialects[di][1]);
    }
    body.insertBefore(selDiv, body.firstChild);
  }
}

function renderBasicHtml(basic, name, result) {
  var html = '<div class="basic-listing">';
  for (var li = 0; li < basic.lines.length; li++) {
    var line = basic.lines[li];
    html += '<div class="basic-line">';
    html += '<span class="basic-linenum">' + line.lineNum + ' </span>';
    for (var pi = 0; pi < line.parts.length; pi++) {
      var part = line.parts[pi];
      var inner = escHtml(part.text);
      if (part.reversed) inner = '<span class="petscii-rev">' + inner + '</span>';
      switch (part.type) {
        case 'keyword':
          html += '<span class="basic-keyword">' + inner + '</span>';
          break;
        case 'string':
          html += '<span class="basic-string">' + inner + '</span>';
          break;
        case 'rem':
          html += '<span class="basic-rem">' + inner + '</span>';
          break;
        case 'ctrl':
          html += '<span class="basic-ctrl">' + inner + '</span>';
          break;
        default:
          html += inner;
          break;
      }
    }
    html += '</div>';
  }
  html += '</div>';
  return { html: html, basic: basic };
}

