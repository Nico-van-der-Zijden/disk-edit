// ────────────────────────────────────────────────────────────────────────
// cbm-tape.js — Commodore tape image (TAP v0/v1) parser
// ────────────────────────────────────────────────────────────────────────
//
// Decodes the standard CBM ROM tape encoding plus selected turbo loaders.
// Loaders supported: CBM ROM, Turbotape 250, Novaload (+Special).
// Cyberload F1-F4 stub left for follow-up (variable thresholds per tape
// require interpreting the boot loader's 6502 code).
//
// Pulse-stream convention: clock cycles (PAL ~985248 Hz). FT Console's
// "TAP byte" units are cycles/8 — multiply by 8 to compare. Each turbo
// loader encodes 1 bit per pulse (threshold compare). The CBM ROM format
// encodes 1 bit per pulse pair via S/M/L pulse classes.
//
// Module globals:
//   parseTAP(buffer)        — entry point invoked from cbm-format.js
//   parsedTAPEntries        — declared in cbm-format.js, written here
//   parsedTapeDir           — declared in cbm-format.js, written here
//
// Reads PETSCII_MAP (declared in cbm-format.js, loaded earlier).

// ── Tape format parameters (from FT Console main.c) ──────────────────
// Values are TAP-byte units (cycles/8). en: 'MSB' | 'LSB'.
var TAPE_FMT_TT250 = { sp: 0x1A, lp: 0x28, tp: 0x20, pv: 0x02, sv: 0x09, en: 'MSB', pmin: 50 };
var TAPE_FMT_NOVA  = { sp: 0x24, lp: 0x56, tp: 0x3D, pv: 0,    sv: 1,    en: 'LSB', pmin: 1800 };

var TAPE_TOL = 11; // pulse-width tolerance (FT default = 10 + 1)

// ── Pulse stream extraction ──────────────────────────────────────────
function extractTAPPulses(buffer) {
  var data = new Uint8Array(buffer);
  var version = data[0x0C];
  var dataSize = data[0x10] | (data[0x11] << 8) | (data[0x12] << 16) | (data[0x13] << 24);
  var pulses = [];
  var pos = 0x14;
  var endPos = Math.min(pos + dataSize, data.length);
  while (pos < endPos) {
    var b = data[pos++];
    if (b === 0x00 && version >= 1 && pos + 2 < endPos) {
      pulses.push(data[pos] | (data[pos + 1] << 8) | (data[pos + 2] << 16));
      pos += 3;
    } else if (b === 0x00) {
      pulses.push(256 * 8);
    } else {
      pulses.push(b * 8);
    }
  }
  return { pulses: pulses, version: version };
}

// ── Turbo bit/byte readers (mirror FT readttbit / readttbyte) ────────
// Returns 0 / 1 / -1 (read error). All thresholds in TAP-byte units.
function readTurboBit(pulses, pos, sp, lp, tp) {
  if (pos < 0 || pos >= pulses.length) return -1;
  var b = pulses[pos];
  var spc = sp * 8, lpc = lp * 8, tpc = tp * 8, tolc = TAPE_TOL * 8;
  if (b < tpc && b > spc - tolc) return 0;
  if (b > tpc && b < lpc + tolc) return 1;
  return -1;
}

function readTurboByte(pulses, pos, sp, lp, tp, en) {
  var bits = [0,0,0,0,0,0,0,0];
  for (var i = 0; i < 8; i++) {
    var bit = readTurboBit(pulses, pos + i, sp, lp, tp);
    if (bit === -1) return -1;
    bits[i] = bit;
  }
  var v = 0;
  if (en === 'MSB') {
    for (var j = 0; j < 8; j++) if (bits[j]) v |= (128 >> j);
  } else {
    for (var k = 0; k < 8; k++) if (bits[k]) v |= (1 << k);
  }
  return v;
}

// Walk through pilot tone, return position of first non-pilot pulse, or -1.
function findTurboPilot(pulses, pos, fmt) {
  if (fmt.pv === 0 || fmt.pv === 1) {
    if (readTurboBit(pulses, pos, fmt.sp, fmt.lp, fmt.tp) !== fmt.pv) return -1;
    var n = 0;
    while (pos < pulses.length && readTurboBit(pulses, pos, fmt.sp, fmt.lp, fmt.tp) === fmt.pv) {
      n++;
      pos++;
    }
    if (n < fmt.pmin) return -1;
    return pos;
  }
  if (readTurboByte(pulses, pos, fmt.sp, fmt.lp, fmt.tp, fmt.en) !== fmt.pv) return -1;
  var nb = 0;
  while (pos < pulses.length - 7 &&
         readTurboByte(pulses, pos, fmt.sp, fmt.lp, fmt.tp, fmt.en) === fmt.pv) {
    nb++;
    pos += 8;
  }
  if (nb < fmt.pmin) return -1;
  return pos;
}

// ── CBM ROM tape scanner (1 bit per pulse pair) ──────────────────────
// Pulse classes: Short ~363cy, Medium ~531cy, Long ~699cy.
function classifyCbmPulse(cycles) {
  if (cycles < 432) return 0; // short
  if (cycles < 616) return 1; // medium
  return 2;                   // long
}

function decodeCbmByte(pulses, pi) {
  if (pi + 1 >= pulses.length) return null;
  var p0 = classifyCbmPulse(pulses[pi]);
  var p1 = classifyCbmPulse(pulses[pi + 1]);
  if (p0 !== 2 || p1 !== 1) return null; // expect (L,M) new-data marker
  pi += 2;
  var byte = 0;
  for (var bit = 0; bit < 8; bit++) {
    if (pi + 1 >= pulses.length) return null;
    var a = classifyCbmPulse(pulses[pi]);
    var b = classifyCbmPulse(pulses[pi + 1]);
    pi += 2;
    if (a === 1 && b === 0) byte |= (1 << bit);            // M+S = 1
    else if (a === 0 && b === 1) { /* S+M = 0 */ }
    else return null;
  }
  pi += 2; // parity bit pair
  return { byte: byte, nextIndex: pi };
}

function findCbmSync(pulses, startPi) {
  var pi = startPi;
  while (pi < pulses.length - 100) {
    var shortCount = 0;
    while (pi < pulses.length && classifyCbmPulse(pulses[pi]) === 0) {
      shortCount++;
      pi++;
    }
    if (shortCount < 200) { pi++; continue; }
    var countdown = [];
    var tryPi = pi;
    for (var attempt = 0; attempt < 500 && tryPi < pulses.length; attempt++) {
      var r = decodeCbmByte(pulses, tryPi);
      if (!r) { tryPi++; continue; }
      countdown.push(r.byte);
      tryPi = r.nextIndex;
      if (countdown.length >= 9) {
        var last9 = countdown.slice(-9);
        if (last9[0] === 0x89 && last9[8] === 0x81) {
          var ok = true;
          for (var c = 1; c < 9; c++) {
            if (last9[c] !== last9[c - 1] - 1) { ok = false; break; }
          }
          if (ok) return tryPi;
        }
      }
    }
    pi = tryPi;
  }
  return -1;
}

function decodeCbmBlock(pulses, startPi, maxBytes) {
  var bytes = [];
  var bp = startPi;
  for (var i = 0; i < maxBytes && bp < pulses.length; i++) {
    var r = decodeCbmByte(pulses, bp);
    if (!r) break;
    bytes.push(r.byte);
    bp = r.nextIndex;
  }
  return { bytes: bytes, nextIndex: bp };
}

function scanCbmRom(pulses, ctx) {
  var pi = 0;
  while (pi < pulses.length) {
    var startPi = pi;
    pi = findCbmSync(pulses, pi);
    if (pi < 0) break;

    var headerBlock = decodeCbmBlock(pulses, pi, 192);
    pi = headerBlock.nextIndex;
    if (headerBlock.bytes.length < 21) continue;

    var hdr = headerBlock.bytes;
    var fileType = hdr[0];
    if (fileType < 1 || fileType > 5) continue;
    if (fileType === 5) continue; // end-of-tape marker

    // Stash the raw 192-byte header for chained decoders (Cyberload F1
    // reads the encrypted loader code from offsets 21..191).
    if (hdr.length >= 192) {
      var headerCopy = new Uint8Array(192);
      for (var hci = 0; hci < 192; hci++) headerCopy[hci] = hdr[hci] & 0xFF;
      ctx.cbmHeaders.push({ bytes: headerCopy, firstPulse: startPi });
    }

    var startAddr = hdr[1] | (hdr[2] << 8);
    var endAddr = hdr[3] | (hdr[4] << 8);
    var name = '';
    for (var ni = 0; ni < 16; ni++) {
      var ch = hdr[5 + ni];
      if (ch === 0x00) name += PETSCII_MAP[0xA0];
      else name += PETSCII_MAP[ch] || '?';
    }

    var dataPi = findCbmSync(pulses, pi);
    var fileData = null;
    var dataSize = endAddr > startAddr ? endAddr - startAddr : 0;
    if (dataPi >= 0 && dataSize > 0) {
      var dataBlock = decodeCbmBlock(pulses, dataPi, dataSize + 10);
      pi = dataBlock.nextIndex;
      var decoded = dataBlock.bytes.slice(0, dataSize);
      fileData = new Uint8Array(decoded.length + 2);
      fileData[0] = startAddr & 0xFF;
      fileData[1] = (startAddr >> 8) & 0xFF;
      for (var di = 0; di < decoded.length; di++) fileData[di + 2] = decoded[di];
    }

    var blocks = Math.ceil(dataSize / 254);
    var typeStr = (fileType === 4) ? ' SEQ ' : ' PRG ';
    pushTapeEntry(ctx, {
      name: name,
      type: typeStr,
      blocks: blocks,
      loader: 'CBM',
      firstPulse: startPi,
      fileData: fileData,
    });
  }
}

// ── Turbotape 250 scanner ────────────────────────────────────────────
// Pilot $02 × 50+, sync countdown $09 $08 ... $01.
// Block ID byte: $00=DATA, $01=BASIC HEADER, $02=PRG HEADER.
// Header: ID + start(2) + end(2) + B0(1) + name(16) + padding ($20).
// Data: ID + n bytes + XOR checksum byte. Headers have no checksum.
function scanTurbotape250(pulses, ctx) {
  var fmt = TAPE_FMT_TT250;
  var pending = null;
  var pi = 20;
  while (pi < pulses.length - 8) {
    var z = findTurboPilot(pulses, pi, fmt);
    if (z < 0) { pi++; continue; }
    pi = z;

    // Sync byte $09 followed by countdown $08..$01 (9 bytes total).
    if (readTurboByte(pulses, pi, fmt.sp, fmt.lp, fmt.tp, fmt.en) !== fmt.sv) {
      pi++; continue;
    }
    var pat = [];
    for (var c = 0; c < 9; c++) {
      pat.push(readTurboByte(pulses, pi + c * 8, fmt.sp, fmt.lp, fmt.tp, fmt.en));
    }
    var syncOk = true;
    for (var s = 0; s < 9; s++) if (pat[s] !== 9 - s) { syncOk = false; break; }
    if (!syncOk) { pi++; continue; }

    var sof = pi;          // start of countdown
    var sod = pi + 9 * 8;  // start of ID byte (after 9 sync bytes)
    var idByte = readTurboByte(pulses, sod, fmt.sp, fmt.lp, fmt.tp, fmt.en);

    if (idByte === 0x01 || idByte === 0x02) {
      // Header block. Layout from sod:
      //   0      : ID
      //   1..2   : startAddr (LSBF)
      //   3..4   : endAddr (LSBF)
      //   5      : $B0 contents
      //   6..21  : 16-byte filename
      //   22..   : padding ($20) up to 192 total bytes (sometimes shorter)
      var hd = [];
      for (var hi = 0; hi < 22; hi++) {
        hd.push(readTurboByte(pulses, sod + hi * 8, fmt.sp, fmt.lp, fmt.tp, fmt.en));
      }
      var startAddr = (hd[1] & 0xFF) | ((hd[2] & 0xFF) << 8);
      var endAddr = (hd[3] & 0xFF) | ((hd[4] & 0xFF) << 8);
      var psize = endAddr - startAddr;
      var name = '';
      for (var ni = 0; ni < 16; ni++) {
        var ch = hd[6 + ni];
        if (ch === undefined || ch < 0) ch = 0xA0;
        name += PETSCII_MAP[ch] || '?';
      }
      pending = { startAddr: startAddr, endAddr: endAddr, psize: psize, name: name, sof: sof };

      // Skip header padding so we don't re-find the same pilot.
      var pad = 22;
      while (pad < 250) {
        var pb = readTurboByte(pulses, sod + pad * 8, fmt.sp, fmt.lp, fmt.tp, fmt.en);
        if (pb !== 0x20) break;
        pad++;
      }
      pi = sod + pad * 8;
    } else if (idByte === 0x00 && pending) {
      // Data block matching previous header.
      var size = pending.psize;
      if (size <= 0 || size > 65536) { pending = null; pi = sod + 8; continue; }
      var data = new Uint8Array(size);
      var cs = 0;
      var rdErr = 0;
      for (var di = 0; di < size; di++) {
        var bd = readTurboByte(pulses, sod + 8 + di * 8, fmt.sp, fmt.lp, fmt.tp, fmt.en);
        if (bd === -1) { rdErr++; bd = 0; }
        cs ^= bd;
        data[di] = bd;
      }
      var actCs = readTurboByte(pulses, sod + 8 + size * 8, fmt.sp, fmt.lp, fmt.tp, fmt.en);
      var fileData = new Uint8Array(size + 2);
      fileData[0] = pending.startAddr & 0xFF;
      fileData[1] = (pending.startAddr >> 8) & 0xFF;
      fileData.set(data, 2);

      pushTapeEntry(ctx, {
        name: pending.name,
        type: ' PRG ',
        blocks: Math.ceil(size / 254),
        loader: 'TT250',
        firstPulse: pending.sof,
        fileData: fileData,
        rdErr: rdErr,
        csOk: (cs & 0xFF) === actCs,
      });
      pending = null;
      pi = sod + 8 + (size + 1) * 8;
    } else {
      // Unrecognized ID; advance past sync to keep searching.
      pi = sod + 8;
    }
  }
}

// ── Novaload scanner ─────────────────────────────────────────────────
// Pilot bit-0 × 1800+, sync bit-1, $AA flag.
// Standard:  $AA + filenameLen + filename + (start-256, end, totalSize+256)
//            + chain of sub-blocks (each = cs_so_far + ≤256 bytes data)
//            + final cs byte.
// Special:   $AA + $55 + chain of sub-blocks (each = startAddrHi + 256 + cs).
// We decode standard files; special files are noted but not extracted.
function scanNovaload(pulses, ctx) {
  var fmt = TAPE_FMT_NOVA;
  var pi = 20;
  while (pi < pulses.length - 8) {
    var z = findTurboPilot(pulses, pi, fmt);
    if (z < 0) { pi++; continue; }
    var sof = pi;
    pi = z;

    // Sync bit
    if (readTurboBit(pulses, pi, fmt.sp, fmt.lp, fmt.tp) !== fmt.sv) { pi++; continue; }
    pi++; // skip sync bit

    var b1 = readTurboByte(pulses, pi, fmt.sp, fmt.lp, fmt.tp, fmt.en);
    if (b1 !== 0xAA) { pi++; continue; }

    var sod = pi + 8; // first byte after $AA
    var fnLen = readTurboByte(pulses, sod, fmt.sp, fmt.lp, fmt.tp, fmt.en);

    if (fnLen === 0x55) {
      // Novaload Special — sub-block chain with no main header.
      // We don't reassemble these because each sub-block's load address is
      // independent (any address in C64 RAM). Note the detection so the
      // user knows the loader is present.
      pushTapeEntry(ctx, {
        name: 'NOVA*SPECIAL',
        type: ' PRG ',
        blocks: 0,
        loader: 'NOVA*',
        firstPulse: sof,
        fileData: null,
      });
      pi = sod + 8;
      continue;
    }

    if (fnLen < 0 || fnLen > 32) { pi++; continue; }

    // Read header (filename length already decoded as fnLen).
    var hd = [fnLen];
    for (var hi = 1; hi < fnLen + 7; hi++) {
      hd.push(readTurboByte(pulses, sod + hi * 8, fmt.sp, fmt.lp, fmt.tp, fmt.en));
    }
    var name = '';
    for (var ni = 0; ni < fnLen && ni < 16; ni++) {
      var ch = hd[1 + ni];
      if (ch === undefined || ch < 0) ch = 0x20;
      name += PETSCII_MAP[ch] || '?';
    }
    if (name === '') name = '(no name)';

    var startAddr = ((hd[fnLen + 1] | (hd[fnLen + 2] << 8)) + 256) & 0xFFFF;
    var endAddr = (hd[fnLen + 3] | (hd[fnLen + 4] << 8)) & 0xFFFF;
    var dataSize = endAddr - startAddr;
    if (dataSize <= 0 || dataSize > 0xC000) { pi++; continue; }

    // Sub-block chain. First cs_so_far is at sod + (fnLen+7) bytes.
    var data = new Uint8Array(dataSize);
    var dataPos = sod + (fnLen + 7) * 8;
    var cnt = 0;
    var rdErr = 0;
    while (cnt < dataSize) {
      dataPos += 8; // skip cs_so_far
      var blockSize = Math.min(256, dataSize - cnt);
      for (var i = 0; i < blockSize; i++) {
        var b = readTurboByte(pulses, dataPos + i * 8, fmt.sp, fmt.lp, fmt.tp, fmt.en);
        if (b === -1) { rdErr++; b = 0; }
        data[cnt++] = b;
      }
      dataPos += blockSize * 8;
    }

    var fileData = new Uint8Array(dataSize + 2);
    fileData[0] = startAddr & 0xFF;
    fileData[1] = (startAddr >> 8) & 0xFF;
    fileData.set(data, 2);

    pushTapeEntry(ctx, {
      name: name,
      type: ' PRG ',
      blocks: Math.ceil(dataSize / 254),
      loader: 'NOVA',
      firstPulse: sof,
      fileData: fileData,
      rdErr: rdErr,
    });
    pi = dataPos + 8; // past final cs byte
  }
}

// ── Creatures / Mayhem / Creatures 2 custom loader ───────────────────
// "Creatures" by Apex/Thalamus uses a custom turbo loader where each
// file has only a 1-byte ID header — the load address, end address, and
// XOR checkbyte are looked up from a known per-game table. All bits are
// inverted on tape (XOR $FF). Format params (from tapclean):
//   sp=$2E, lp=$4C, tp=$3A, MSB, pilot $F0 × 64+, sync $47.
// File table covers Creatures, Creatures 2 (Torture Trouble), and
// Mayhem in Monsterland. ID byte on tape = letter ^ $FF.
var TAPE_FMT_CREATURES = { sp: 0x2E, lp: 0x4C, tp: 0x3A, pv: 0xF0, sv: 0x47, en: 'MSB', pmin: 64 };

// Each entry: [id, startAddr, endAddrPlus1, expectedXorChecksum, gameLabel]
// Stored with id pre-inverted (the tape byte the scanner compares).
var CREATURES_FILE_TABLE = [
  // Creatures
  [0x54 ^ 0xFF, 0x5800, 0x6A00, 0xA7, 'Creatures'],
  [0x31 ^ 0xFF, 0x5800, 0xAC00, 0x28, 'Creatures'],
  [0x32 ^ 0xFF, 0x8700, 0xAC00, 0x96, 'Creatures'],
  [0x33 ^ 0xFF, 0x5800, 0xAC00, 0xB1, 'Creatures'],
  [0x34 ^ 0xFF, 0x5800, 0xAC00, 0x1D, 'Creatures'],
  [0x35 ^ 0xFF, 0x8700, 0x9A00, 0x1B, 'Creatures'],
  [0x36 ^ 0xFF, 0x5800, 0xAC00, 0xDD, 'Creatures'],
  [0x37 ^ 0xFF, 0x5800, 0xAC00, 0x82, 'Creatures'],
  [0x38 ^ 0xFF, 0x8700, 0x9A00, 0xD3, 'Creatures'],
  [0x39 ^ 0xFF, 0x5800, 0xAC00, 0x8D, 'Creatures'],
  [0x43 ^ 0xFF, 0x5800, 0xAC00, 0x60, 'Creatures'],
  // Creatures 2 — Torture Trouble
  [0x31 ^ 0xFF, 0x5800, 0xB000, 0xBD, 'Creatures 2'],
  [0x32 ^ 0xFF, 0x5800, 0xB000, 0xC8, 'Creatures 2'],
  [0x33 ^ 0xFF, 0x5800, 0xB000, 0x21, 'Creatures 2'],
  [0x34 ^ 0xFF, 0x5800, 0xB000, 0x42, 'Creatures 2'],
  [0x35 ^ 0xFF, 0x5800, 0xB000, 0x55, 'Creatures 2'],
  [0x36 ^ 0xFF, 0x5800, 0xB000, 0xFA, 'Creatures 2'],
  [0x37 ^ 0xFF, 0x5800, 0xB000, 0xF4, 'Creatures 2'],
  [0x38 ^ 0xFF, 0x5800, 0xB000, 0x63, 'Creatures 2'],
  [0x39 ^ 0xFF, 0x5800, 0xB000, 0xCB, 'Creatures 2'],
  [0x41 ^ 0xFF, 0x5800, 0xB000, 0x78, 'Creatures 2'],
  [0x42 ^ 0xFF, 0x5800, 0xB000, 0xDE, 'Creatures 2'],
  [0x43 ^ 0xFF, 0x5800, 0xB000, 0x41, 'Creatures 2'],
  // Mayhem in Monsterland
  [0x31 ^ 0xFF, 0x5A00, 0xB100, 0x3C, 'Mayhem'],
  [0x32 ^ 0xFF, 0x5A00, 0xB100, 0x0C, 'Mayhem'],
  [0x33 ^ 0xFF, 0x5A00, 0xB100, 0xC9, 'Mayhem'],
  [0x34 ^ 0xFF, 0x5A00, 0xB100, 0x53, 'Mayhem'],
  [0x35 ^ 0xFF, 0x5A00, 0xB100, 0xAD, 'Mayhem'],
  [0x43 ^ 0xFF, 0x5A00, 0xB100, 0x17, 'Mayhem'],
];

function scanCreatures(pulses, ctx) {
  var fmt = TAPE_FMT_CREATURES;
  var pi = 20;
  while (pi < pulses.length - 64) {
    var z = findTurboPilot(pulses, pi, fmt);
    if (z < 0) { pi++; continue; }
    if (readTurboByte(pulses, z, fmt.sp, fmt.lp, fmt.tp, fmt.en) !== fmt.sv) { pi++; continue; }

    var sof = pi;
    var sod = z + 8; // first byte = ID (XOR $FF on tape)
    var idByte = readTurboByte(pulses, sod, fmt.sp, fmt.lp, fmt.tp, fmt.en);
    if (idByte < 0) { pi = sod; continue; }

    // Look up file in table by raw (inverted) ID. Try each match — multiple
    // games share IDs ($31..$39) so we'd verify by checksum below.
    var matched = null;
    for (var ti = 0; ti < CREATURES_FILE_TABLE.length; ti++) {
      var row = CREATURES_FILE_TABLE[ti];
      if (row[0] !== idByte) continue;
      var startAddr = row[1];
      var endPlus1 = row[2];
      var expectedCs = row[3];
      var gameLabel = row[4];
      var size = (endPlus1 === 0 ? 0x10000 : endPlus1) - startAddr;
      if (size <= 0 || size > 0x10000) continue;

      // Decode size bytes (each byte XOR'd with $FF on tape).
      var data = new Uint8Array(size);
      var cb = 0;
      var rdErr = 0;
      var dataStart = sod + 8;
      for (var di = 0; di < size; di++) {
        var b = readTurboByte(pulses, dataStart + di * 8, fmt.sp, fmt.lp, fmt.tp, fmt.en);
        if (b < 0) { rdErr++; b = 0xFF; }
        b ^= 0xFF;
        cb ^= b;
        data[di] = b;
      }
      // The expected checkbyte is pre-computed for the original tape — if
      // it doesn't match, this isn't the right table entry; try the next.
      if ((cb & 0xFF) !== (expectedCs & 0xFF)) continue;
      if (rdErr > size / 4) continue;

      matched = {
        idLetter: idByte ^ 0xFF,
        startAddr: startAddr, size: size,
        data: data, rdErr: rdErr, game: gameLabel,
        nextPulse: dataStart + size * 8,
      };
      break;
    }

    if (matched) {
      var fileData = new Uint8Array(matched.size + 2);
      fileData[0] = matched.startAddr & 0xFF;
      fileData[1] = (matched.startAddr >> 8) & 0xFF;
      fileData.set(matched.data, 2);
      var letter = String.fromCharCode(matched.idLetter);
      pushTapeEntry(ctx, {
        name: matched.game + ' "' + letter + '"',
        type: ' PRG ',
        blocks: Math.ceil(matched.size / 254),
        loader: 'CREAT',
        firstPulse: sof,
        fileData: fileData,
        rdErr: matched.rdErr,
      });
      claimRange(ctx, sof, matched.nextPulse);
      pi = matched.nextPulse;
    } else {
      pi = sod + 8;
    }
  }
}

// ── Cyberload chain decoder: F1 + F2 ─────────────────────────────────
// Cyberload's per-tape variables (thresholds, pilot/sync, XOR keys) live
// as immediate operands inside the boot loader's 6502 code. We extract
// them by following the same chain FT Console uses, but without a 6502
// emulator — direct byte-level deciphering and opcode-pattern signature
// matching at fixed offsets:
//
//   1. CBM boot block:  decipher LOADER1 in-place, read tp/pv/sv from
//      fixed offsets 28, 33, 47, 58.
//   2. F1 file (LOADER2): find the decryptor pattern + 16 fixed
//      "decryptor codes", run the F2 decipher routine in JS, then
//      pattern-match set-pilot and set-threshold opcode sequences to
//      extract F2 params and EOR keys.
//   3. F2 file (LOADER3): pattern-match same set-pilot / set-threshold
//      opcodes for F3/F4 params (we already have a heuristic F3 scanner
//      that handles the unencrypted sub-block decoding).

// Threshold-to-pulse-set mapping (from FT). Returns null on no match —
// such tapes fall through to heuristic auto-detection.
function cyberThresholdToPulseSet(tp) {
  if (tp > 0x39 && tp < 0x45) return { sp: 0x30, lp: 0x5A };  // Set A (most common)
  if (tp > 0x44 && tp < 0x52) return { sp: 0x3B, lp: 0x72 };  // Set B
  if (tp === 0x2B) return { sp: 0x24, lp: 0x40 };             // Set C — Sanxion
  if (tp === 0x79) return { sp: 0x55, lp: 0xA5 };             // Set D — Image System, Gangster
  return null;
}

// Search for a byte pattern in buf. Pattern entries === -1 are wildcards.
// Returns first match offset, or -1.
function findByteSequence(buf, bufLen, pattern) {
  var pn = pattern.length;
  for (var i = 0; i <= bufLen - pn; i++) {
    var ok = true;
    for (var j = 0; j < pn; j++) {
      if (pattern[j] !== -1 && pattern[j] !== buf[i + j]) { ok = false; break; }
    }
    if (ok) return i;
  }
  return -1;
}

// Apply the Cyberload F1 (LOADER1) decipher to a copy of the CBM header.
// Decipher is a self-mutating XOR chain, A=3 initial, Y=$AB down to 1,
// off=20+Y, A^=buf[off], buf[off]=A.
function decipherCyberloadF1(header192) {
  var buf = new Uint8Array(192);
  buf.set(header192);
  var a = 3;
  var y = 171; // $AB
  while (y > 0) {
    var off = 20 + y;
    a = (a ^ buf[off]) & 0xFF;
    buf[off] = a;
    y--;
  }
  return buf;
}

// Read F1 params from a CBM boot block. Returns null if the threshold
// doesn't map to a known pulse set (treat as not Cyberload).
function extractCyberloadF1Params(header192) {
  var buf = decipherCyberloadF1(header192);
  var tpRaw = (buf[33] << 8) | buf[28];
  var tp = (tpRaw * 0.123156) | 0;
  var ps = cyberThresholdToPulseSet(tp);
  if (!ps) return null;
  return {
    sp: ps.sp, lp: ps.lp, tp: tp,
    pv: buf[47], sv: buf[58],
    en: 'MSB',
    pmin: 50,
  };
}

// Decode the F1 chain. F1 uses 9-bit-per-byte encoding: 8 data bits
// followed by an "extra bit" pulse. Extra bit set (LP) = another byte
// follows; clear (SP) = end of file. After the last byte (= "stack
// byte", not data), one more bit indicates whether a further file
// follows in the chain. Returns array of { startAddr, data }.
function decodeCyberloadF1Chain(pulses, fmt) {
  var files = [];
  // F1 uses NO threshold (only sp/lp midpoint check). We emulate FT's
  // tap.tmem[pos] > lp-tol && < lp+tol comparison directly to detect
  // continuation bits.
  var spc = fmt.sp * 8, lpc = fmt.lp * 8, tolc = TAPE_TOL * 8;
  function isLong(pos) {
    if (pos < 0 || pos >= pulses.length) return false;
    var v = pulses[pos];
    return v > lpc - tolc && v < lpc + tolc;
  }
  function isShort(pos) {
    if (pos < 0 || pos >= pulses.length) return false;
    var v = pulses[pos];
    return v > spc - tolc && v < spc + tolc;
  }

  var pi = 20;
  while (pi < pulses.length - 64) {
    var z = findTurboPilot(pulses, pi, fmt);
    if (z < 0) { pi++; continue; }
    if (readTurboByte(pulses, z, fmt.sp, fmt.lp, fmt.tp, fmt.en) !== fmt.sv) { pi++; continue; }

    var sod = z + 8; // first F1 byte (load offset)
    var b0 = readTurboByte(pulses, sod, fmt.sp, fmt.lp, fmt.tp, fmt.en);
    if (b0 !== 0x2D) { pi = z + 8; continue; }

    // Walk the chain. Each file: load offset (no continuation), then
    // data bytes each with a trailing continuation bit, then a stack
    // byte (not data), then a "more files?" bit.
    var zpload = 0xFFD5;
    var done = false;
    while (!done) {
      var loadOffset = readTurboByte(pulses, sod, fmt.sp, fmt.lp, fmt.tp, fmt.en);
      if (loadOffset < 0) break;
      zpload = (zpload + loadOffset) & 0xFFFF;

      // Data bytes start at sod+8. Continuation bit i is at sod+16+i*9.
      // Walk continuation bits until one is SP (clear).
      var k = 8;
      var len = 0;
      while (isLong(sod + k + 8)) {
        k += 9;
        len++;
        if (len > 0x10000) { done = true; break; }
      }
      if (done) break;

      // Read data bytes 0..len-1 (each at sod+8+i*9). Byte at sod+8+len*9
      // is the stack byte (skipped).
      var data = new Uint8Array(len);
      var rdErr = 0;
      for (var i = 0; i < len; i++) {
        var b = readTurboByte(pulses, sod + 8 + i * 9, fmt.sp, fmt.lp, fmt.tp, fmt.en);
        if (b < 0) { rdErr++; b = 0; }
        data[i] = b;
      }

      files.push({
        startAddr: zpload,
        data: data,
        rdErr: rdErr,
        firstPulse: pi,
      });

      // "More files?" bit at sod+k+9 (right after the stack byte).
      var morePos = sod + k + 9;
      if (isLong(morePos)) {
        // Another file follows immediately after the bit.
        sod = morePos + 1;
        zpload = (zpload + len) & 0xFFFF;
      } else {
        done = true;
      }
    }

    // Advance past the chain.
    pi = sod + 64;
  }
  return files;
}

// FT's "decryptor codes" array — 16 bytes from $0314 in the original
// loader. The F2 decipher XORs against these in a y-down loop.
var CYBER_F2_DECRYPTOR_CODES = [
  0xA6, 0x02, 0x6B, 0x8E, 0xC1, 0xFE, 0xBC, 0x8D,
  0x8B, 0x49, 0x7F, 0x8D, 0x60, 0xD1, 0x8D, 0xE1,
];

// Pattern signatures (XX = wildcard).
var CYBER_F2_DECRYPTOR_PATTERN = [0x59, 0x14, 0x03, 0x88, 0x10, 0xFA, 0x9D];
var CYBER_SET_THRES_PATTERN = [0xA9, -1, 0x8D, 0x04, 0xDC, 0xA9, -1, 0x8D, 0x05, 0xDC];
var CYBER_SET_PILOT_PATTERN = [0xC9, -1, 0xF0, -1, 0xC9, -1, 0xD0];

// Run the F2 decipher routine on a buffer copy of the F1-decoded
// LOADER2 file. Returns { buf, eor1, eor2, params } or null on failure.
// The decipher index can run past the end of the buffer (in C64 RAM
// it's reading zero-page); we pad with 200 zero bytes to avoid out-of-
// bounds reads, mirroring FT's approach.
function decipherCyberloadF2(loader2Bytes) {
  var bufsz = loader2Bytes.length;
  var buf = new Uint8Array(bufsz + 200);
  buf.set(loader2Bytes);

  var k = findByteSequence(buf, bufsz, CYBER_F2_DECRYPTOR_PATTERN);
  if (k !== -1) {
    var encstart = (buf[k - 2] - 0x02) & 0xFFFF;
    var x = buf[k - 8];
    while (x > 0) {
      var a = x & 0x0F;
      var y = a;
      a = (a ^ buf[(encstart + x) & 0xFFFF]) & 0xFF;
      while (y >= 0) {
        a = (a ^ CYBER_F2_DECRYPTOR_CODES[y]) & 0xFF;
        y--;
      }
      buf[(encstart + x) & 0xFFFF] = a;
      x--;
    }
  }
  // Note: FT proceeds even if the decryptor pattern wasn't found
  // (Sanxion's loader doesn't require it). We do the same.

  // set_pilot pattern → pv, sv (and possibly Sanxion EOR1).
  var pi = findByteSequence(buf, bufsz, CYBER_SET_PILOT_PATTERN);
  if (pi === -1) return null;
  var pv = buf[pi + 1];
  var sv = buf[pi + 5];
  var eor1 = 0xAE, eor2 = 0xD2; // common defaults
  var sanxion = (buf[pi + 25] === 0xA0); // LDY (other loaders have EOR $49 here)
  if (sanxion) {
    eor1 = buf[pi + 14];
    eor2 = 0;
  }

  // set_thres pattern → tp.
  var ti = findByteSequence(buf, bufsz, CYBER_SET_THRES_PATTERN);
  if (ti === -1) return null;
  var tpRaw = (buf[ti + 6] << 8) | buf[ti + 1];
  var tp = (tpRaw * 0.123156) | 0;
  var ps = cyberThresholdToPulseSet(tp);
  if (!ps) return null;

  // Non-Sanxion loaders have EOR1, EOR2 at fixed offsets relative to
  // the set_thres match.
  if (!sanxion) {
    eor1 = buf[ti + 39];
    eor2 = buf[ti + 51];
  }

  return {
    buf: buf,
    eor1: eor1,
    eor2: eor2,
    sanxion: sanxion,
    params: {
      sp: ps.sp, lp: ps.lp, tp: tp,
      pv: pv, sv: sv,
      en: 'MSB',
      pmin: 20,
    },
  };
}

// Scan for and decode F2 files. Each F2 file has its load addr + size
// XOR-encrypted with eor1, and its data XOR-encrypted with eor2. The
// first byte after sync is $2D for F1 (skip) or anything else for F2.
function decodeCyberloadF2Files(pulses, fmt, eor1, eor2) {
  var files = [];
  var pi = 20;
  while (pi < pulses.length - 64) {
    var z = findTurboPilot(pulses, pi, fmt);
    if (z < 0) { pi++; continue; }
    if (readTurboByte(pulses, z, fmt.sp, fmt.lp, fmt.tp, fmt.en) !== fmt.sv) { pi++; continue; }

    var sod = z + 8;
    var b0 = readTurboByte(pulses, sod, fmt.sp, fmt.lp, fmt.tp, fmt.en);
    if (b0 < 0 || b0 === 0x2D) { pi = z + 8; continue; } // F1, not F2

    // Header: 4 bytes XOR-encrypted with eor1.
    //   byte 0..1 = load addr (LSBF)
    //   byte 2..3 = size (LSBF)
    var b1 = readTurboByte(pulses, sod + 8, fmt.sp, fmt.lp, fmt.tp, fmt.en);
    var b2 = readTurboByte(pulses, sod + 16, fmt.sp, fmt.lp, fmt.tp, fmt.en);
    var b3 = readTurboByte(pulses, sod + 24, fmt.sp, fmt.lp, fmt.tp, fmt.en);
    if (b1 < 0 || b2 < 0 || b3 < 0) { pi = z + 8; continue; }
    var loadAddr = ((b0 ^ eor1) | ((b1 ^ eor1) << 8)) & 0xFFFF;
    var size = ((b2 ^ eor1) | ((b3 ^ eor1) << 8)) & 0xFFFF;
    if (size === 0 || size > 0xC000) { pi = z + 8; continue; }

    var data = new Uint8Array(size);
    var rdErr = 0;
    for (var di = 0; di < size; di++) {
      var b = readTurboByte(pulses, sod + (4 + di) * 8, fmt.sp, fmt.lp, fmt.tp, fmt.en);
      if (b < 0) { rdErr++; b = 0; }
      data[di] = (b ^ eor2) & 0xFF;
    }
    if (rdErr > size / 4) { pi = z + 8; continue; } // too noisy

    files.push({
      startAddr: loadAddr,
      data: data,
      rdErr: rdErr,
      firstPulse: pi,
    });
    pi = sod + (4 + size + 1) * 8;
  }
  return files;
}

// Run the chain: CBM boot block → F1 → F2. Pushes detected files to
// ctx.entries. Returns the final F2 params (which serve as F3 defaults)
// so the heuristic F3 scanner can swap from auto-detect to deterministic.
function runCyberloadChain(pulses, ctx) {
  if (!ctx.cbmHeaders || ctx.cbmHeaders.length === 0) return null;

  // Try every CBM header — usually only the first is the boot block,
  // but cheap to attempt all.
  var f1Params = null;
  for (var i = 0; i < ctx.cbmHeaders.length; i++) {
    var p = extractCyberloadF1Params(ctx.cbmHeaders[i].bytes);
    if (p) { f1Params = p; break; }
  }
  if (!f1Params) return null;

  // Decode F1 chain.
  var f1Files = decodeCyberloadF1Chain(pulses, f1Params);
  if (f1Files.length === 0) return null;

  // Emit F1 entries.
  for (var fi = 0; fi < f1Files.length; fi++) {
    var f = f1Files[fi];
    var fileData = new Uint8Array(f.data.length + 2);
    fileData[0] = f.startAddr & 0xFF;
    fileData[1] = (f.startAddr >> 8) & 0xFF;
    fileData.set(f.data, 2);
    var addrHex = ('0000' + f.startAddr.toString(16).toUpperCase()).slice(-4);
    pushTapeEntry(ctx, {
      name: 'CYBER F1 LOADER2 $' + addrHex,
      type: ' PRG ',
      blocks: Math.ceil(f.data.length / 254),
      loader: 'CYB1',
      firstPulse: f.firstPulse,
      fileData: fileData,
      rdErr: f.rdErr,
    });
  }

  // The first F1 file is LOADER2 (loads at $0002). Run F2 decipher on it.
  var loader2 = null;
  for (var li = 0; li < f1Files.length; li++) {
    if (f1Files[li].startAddr === 0x0002) { loader2 = f1Files[li]; break; }
  }
  if (!loader2) return null;

  var f2 = decipherCyberloadF2(loader2.data);
  if (!f2) return null;

  // Decode F2 files using extracted params + EOR keys.
  var f2Files = decodeCyberloadF2Files(pulses, f2.params, f2.eor1, f2.eor2);
  for (var fj = 0; fj < f2Files.length; fj++) {
    var ff = f2Files[fj];
    var fdata = new Uint8Array(ff.data.length + 2);
    fdata[0] = ff.startAddr & 0xFF;
    fdata[1] = (ff.startAddr >> 8) & 0xFF;
    fdata.set(ff.data, 2);
    var addrHex2 = ('0000' + ff.startAddr.toString(16).toUpperCase()).slice(-4);
    pushTapeEntry(ctx, {
      name: 'CYBER F2 LOADER3 $' + addrHex2,
      type: ' PRG ',
      blocks: Math.ceil(ff.data.length / 254),
      loader: 'CYB2',
      firstPulse: ff.firstPulse,
      fileData: fdata,
      rdErr: ff.rdErr,
    });
  }

  return f2.params;
}

// ── Auto-detect turbo pulse thresholds ───────────────────────────────
// Build a histogram of pulse-byte values and locate the two strongest
// peaks. Returns { sp, lp, tp } in TAP-byte units, or null if the stream
// doesn't look like a clean two-class turbo encoding (e.g. CBM ROM has 3
// pulse classes and would return null).
function autoDetectTurboThresholds(pulses) {
  var hist = new Uint32Array(256);
  for (var i = 0; i < pulses.length; i++) {
    var tb = (pulses[i] / 8) | 0;
    if (tb >= 1 && tb <= 254) hist[tb]++;
  }
  // Find local-maximum peaks above 1% of total counted pulses.
  var total = 0;
  for (var k = 0; k < 256; k++) total += hist[k];
  var floor = Math.max(50, total * 0.01);
  var peaks = [];
  for (var v = 2; v < 254; v++) {
    if (hist[v] < floor) continue;
    if (hist[v] >= hist[v - 1] && hist[v] >= hist[v + 1] &&
        hist[v] >= hist[v - 2] && hist[v] >= hist[v + 2]) {
      peaks.push({ v: v, n: hist[v] });
    }
  }
  if (peaks.length < 2) return null;
  // Two highest peaks.
  peaks.sort(function(a, b) { return b.n - a.n; });
  var top2 = peaks.slice(0, 2);
  if (top2[0].v === top2[1].v) return null;
  var sp = Math.min(top2[0].v, top2[1].v);
  var lp = Math.max(top2[0].v, top2[1].v);
  if (lp - sp < 8) return null; // peaks too close — not a turbo encoding
  return { sp: sp, lp: lp, tp: ((sp + lp) >> 1) };
}

// Try to decode a Cyberload F4 file at sod (start of header byte 0,
// just after the sync byte). F4 has 3 sub-types distinguished by which
// header XOR-checksum scheme validates:
//   Type 1 (Last Ninja):    20-byte XOR check at byte 20, header = 21
//   Type 2 (Ninja Spirit):  22-byte XOR check at byte 22 + $00 closer, header = 24
//   Type 3 (Last Ninja 3):  flag at byte 0; XOR(1..22) at byte 23 + $00, header = 25
// Each file: header + data sub-blocks (256 bytes + 1 XOR cs each, last
// partial). Returns the next pulse position to resume from, or null on
// failure (caller advances past sync and keeps scanning).
function tryDecodeCyberloadF4(pulses, ctx, sof, sod, sp, lp, tp) {
  var hd = [];
  for (var i = 0; i < 32; i++) {
    var hb = readTurboByte(pulses, sod + i * 8, sp, lp, tp, 'MSB');
    if (hb < 0) return null;
    hd.push(hb);
  }

  var type = 0, ofn = 0, hSize = 0;
  // Type 1: XOR(hd[0..19]) === hd[20]
  var cb1 = 0;
  for (var j = 0; j < 20; j++) cb1 ^= hd[j];
  if (hd[20] === cb1) { type = 1; ofn = 0; hSize = 21; }
  // Type 2 (overrides Type 1 on tie, per FT): XOR(hd[0..21]) === hd[22]
  var cb2 = cb1 ^ hd[20] ^ hd[21];
  if (hd[22] === cb2) { type = 2; ofn = 0; hSize = 24; }
  // Type 3: XOR(hd[1..22]) === hd[23], filename starts at byte 1
  var cb3 = 0;
  for (var k = 1; k < 23; k++) cb3 ^= hd[k];
  if (hd[23] === cb3) { type = 3; ofn = 1; hSize = 25; }

  if (type === 0) return null;

  var name = '';
  for (var ni = 0; ni < 16; ni++) {
    var ch = hd[ofn + ni];
    if (ch === undefined || ch < 0) ch = 0x20;
    name += PETSCII_MAP[ch] || '?';
  }
  var loadAddr = hd[ofn + 16] | (hd[ofn + 17] << 8);
  var size = hd[ofn + 18] | (hd[ofn + 19] << 8);
  if (size === 0 || size > 0xC000) return null;

  // Decode sub-blocks: each is 256 data + 1 cs byte = 257 bytes; last
  // is partial (remaining data + 1 cs). Sub-blocks chain consecutively
  // on tape — no inter-block sync. We verify each sub-block's XOR cs to
  // gate against false positives where the header checksum matched by
  // chance — random data would fail most sub-block checks.
  var data = new Uint8Array(size);
  var rdErr = 0;
  var dataStart = sod + hSize * 8;
  var total = 0, blockIdx = 0;
  var goodBlocks = 0, totalBlocks = 0;
  while (total < size) {
    var blockSize = Math.min(256, size - total);
    var blockOff = blockIdx * 257 * 8;
    var cs = 0;
    for (var bi = 0; bi < blockSize; bi++) {
      var b = readTurboByte(pulses, dataStart + blockOff + bi * 8, sp, lp, tp, 'MSB');
      if (b < 0) { rdErr++; b = 0; }
      cs ^= b;
      data[total++] = b;
    }
    var csByte = readTurboByte(pulses, dataStart + blockOff + blockSize * 8, sp, lp, tp, 'MSB');
    if (csByte === cs) goodBlocks++;
    totalBlocks++;
    blockIdx++;
  }
  if (rdErr > size / 4) return null;
  // Require ≥ 50% of sub-blocks to pass their XOR checksum, else treat
  // as a false positive (header XOR-match was coincidental).
  if (goodBlocks * 2 < totalBlocks) return null;

  var fileData = new Uint8Array(size + 2);
  fileData[0] = loadAddr & 0xFF;
  fileData[1] = (loadAddr >> 8) & 0xFF;
  fileData.set(data, 2);

  var trimmed = name.replace(/\s+$/, '');
  pushTapeEntry(ctx, {
    name: 'CYBER F4.' + type + (trimmed ? ' ' + trimmed : ''),
    type: ' PRG ',
    blocks: Math.ceil(size / 254),
    loader: 'CYB4.' + type,
    firstPulse: sof,
    fileData: fileData,
    rdErr: rdErr,
  });

  // Advance past header + all sub-blocks (256+1 each).
  var totalSubBlocks = Math.ceil(size / 256);
  return dataStart + totalSubBlocks * 257 * 8;
}

// ── Cyberload F1-F4 heuristic scanner ────────────────────────────────
// Cyberload uses per-tape variable thresholds + sync values that FT
// extracts by interpreting the F2 loader's 6502 code (set-threshold +
// set-pilot patterns). Without a 6502 interpreter we approximate:
//   1. Auto-detect short/long pulse widths from the global histogram.
//   2. Scan for runs of identical bytes (≥7) that look like a pilot.
//   3. Check the next byte against known sync values:
//        $CC = F3 sub-block (unencrypted, decodable)
//        $F0 = F1/F2 (encrypted, detection only)
//        $AA, $96, $99 = F4 (multiload, decoded inline)
//   4. F3: decode header (load addr, size, checksum, 4 internals) + data,
//      verify XOR checksum. Group adjacent sub-blocks by load address.
//   5. F4: dispatch to tryDecodeCyberloadF4 — auto-detects sub-type via
//      header XOR checksum, decodes header + sub-block chain.
function scanCyberload(pulses, ctx) {
  // Phase 1: try the chained decoder (CBM boot → F1 → F2) for
  // deterministic param extraction. F3 sub-blocks remain detected
  // by the heuristic phase below — chain just adds F1/F2 entries.
  var chainParams = runCyberloadChain(pulses, ctx);

  // Phase 2: heuristic detection. Uses chain-extracted params if
  // available, otherwise falls back to histogram peak detection.
  var th = chainParams || autoDetectTurboThresholds(pulses);
  if (!th) return;
  var sp = th.sp, lp = th.lp, tp = th.tp;
  var en = 'MSB';

  // F3: collect sub-blocks then group by adjacency.
  var f3Blocks = [];
  // F1/F2/F4: track detection points so we can emit markers.
  var f1f2Marks = [];
  var f4Marks = [];

  var pi = 20;
  while (pi < pulses.length - 64) {
    // Skip ranges already claimed by other scanners (Creatures, etc.).
    var skipped = skipClaimed(ctx, pi);
    if (skipped !== pi) { pi = skipped; continue; }
    // Probe for a pilot: consecutive identical bytes starting at pi.
    var firstByte = readTurboByte(pulses, pi, sp, lp, tp, en);
    if (firstByte < 0) { pi++; continue; }
    var n = 1, p = pi + 8;
    while (p < pulses.length - 7 &&
           readTurboByte(pulses, p, sp, lp, tp, en) === firstByte) {
      n++; p += 8;
      if (n >= 200) break; // capped — long pilots get truncated
    }
    if (n < 7) { pi++; continue; }

    var pilotByte = firstByte;
    var syncPos = p; // byte position right after the pilot run
    var syncByte = readTurboByte(pulses, syncPos, sp, lp, tp, en);

    if (syncByte === 0xCC) {
      // F3 sub-block. Header layout (8 bytes from sod = syncPos+8):
      //   0..1 = load addr (LSBF)
      //   2    = size (0 → 256)
      //   3    = checksum (XOR of all sub-block bytes including itself = 0)
      //   4..7 = internal use
      //   then n data bytes
      var sod = syncPos + 8;
      var hd = [];
      var ok = true;
      for (var hi = 0; hi < 8; hi++) {
        var hb = readTurboByte(pulses, sod + hi * 8, sp, lp, tp, en);
        if (hb < 0) { ok = false; break; }
        hd.push(hb);
      }
      if (!ok) { pi = syncPos + 8; continue; }
      var loadAddr = hd[0] | (hd[1] << 8);
      var size = hd[2] === 0 ? 256 : hd[2];
      var data = new Uint8Array(size);
      var cb = hd[0] ^ hd[1] ^ hd[2] ^ hd[3] ^ hd[4] ^ hd[5] ^ hd[6] ^ hd[7];
      var rdErr = 0;
      for (var di = 0; di < size; di++) {
        var db = readTurboByte(pulses, sod + (8 + di) * 8, sp, lp, tp, en);
        if (db < 0) { rdErr++; db = 0; }
        cb ^= db;
        data[di] = db;
      }
      if (rdErr > size / 4) {
        // Too noisy to trust — skip past the sync and keep looking.
        pi = sod + 8;
        continue;
      }
      f3Blocks.push({
        firstPulse: pi,
        loadAddr: loadAddr,
        size: size,
        data: data,
        csOk: cb === 0,
        rdErr: rdErr,
        pilotByte: pilotByte,
      });
      pi = sod + (8 + size) * 8;
    } else if (syncByte === 0xF0) {
      f1f2Marks.push({ firstPulse: pi, pilotByte: pilotByte });
      pi = syncPos + 8;
    } else if (syncByte === 0xAA || syncByte === 0x96 || syncByte === 0x99) {
      var f4Next = tryDecodeCyberloadF4(pulses, ctx, pi, syncPos + 8, sp, lp, tp);
      if (f4Next !== null) {
        pi = f4Next;
      } else {
        f4Marks.push({ firstPulse: pi, pilotByte: pilotByte, syncByte: syncByte });
        pi = syncPos + 8;
      }
    } else {
      // Pilot found but no recognised sync — advance past the pilot.
      pi = syncPos;
    }
  }

  // Group adjacent F3 sub-blocks (next.loadAddr === prev.loadAddr + prev.size)
  // into virtual PRGs.
  if (f3Blocks.length > 0) {
    var groups = [[f3Blocks[0]]];
    for (var b = 1; b < f3Blocks.length; b++) {
      var prev = groups[groups.length - 1][groups[groups.length - 1].length - 1];
      if (f3Blocks[b].loadAddr === ((prev.loadAddr + prev.size) & 0xFFFF)) {
        groups[groups.length - 1].push(f3Blocks[b]);
      } else {
        groups.push([f3Blocks[b]]);
      }
    }
    for (var g = 0; g < groups.length; g++) {
      var grp = groups[g];
      var totalSize = 0;
      for (var i = 0; i < grp.length; i++) totalSize += grp[i].size;
      var combined = new Uint8Array(totalSize + 2);
      combined[0] = grp[0].loadAddr & 0xFF;
      combined[1] = (grp[0].loadAddr >> 8) & 0xFF;
      var off = 2;
      var grpRdErr = 0;
      var anyCsBad = false;
      for (var i = 0; i < grp.length; i++) {
        combined.set(grp[i].data, off);
        off += grp[i].size;
        grpRdErr += grp[i].rdErr;
        if (!grp[i].csOk) anyCsBad = true;
      }
      var addrHex = ('0000' + grp[0].loadAddr.toString(16).toUpperCase()).slice(-4);
      var name = 'CYBER F3 $' + addrHex + (grp.length > 1 ? ' x' + grp.length : '');
      pushTapeEntry(ctx, {
        name: name,
        type: ' PRG ',
        blocks: Math.ceil(totalSize / 254),
        loader: anyCsBad ? 'CYB3?' : 'CYB3',
        firstPulse: grp[0].firstPulse,
        fileData: combined,
        rdErr: grpRdErr,
      });
    }
  }

  // F1/F2 marker: only emit if the chain didn't already produce real
  // F1 or F2 file entries (otherwise the marker is redundant noise).
  if (f1f2Marks.length > 0) {
    var hasChainF1F2 = false;
    for (var ce = 0; ce < ctx.entries.length; ce++) {
      var ld = ctx.entries[ce].loader;
      if (ld === 'CYB1' || ld === 'CYB2') { hasChainF1F2 = true; break; }
    }
    if (!hasChainF1F2) {
      pushTapeEntry(ctx, {
        name: 'CYBERLOAD F1/F2',
        type: ' PRG ',
        blocks: 0,
        loader: 'CYB12',
        firstPulse: f1f2Marks[0].firstPulse,
        fileData: null,
        tapeIcon: 'encrypted',
      });
    }
  }

  // F4 marker: only emit if no F4 file was successfully decoded.
  if (f4Marks.length > 0) {
    var hasF4 = false;
    for (var ce2 = 0; ce2 < ctx.entries.length; ce2++) {
      if (ctx.entries[ce2].loader.indexOf('CYB4.') === 0) { hasF4 = true; break; }
    }
    if (!hasF4) {
      pushTapeEntry(ctx, {
        name: 'CYBERLOAD F4',
        type: ' PRG ',
        blocks: 0,
        loader: 'CYB4',
        firstPulse: f4Marks[0].firstPulse,
        fileData: null,
        tapeIcon: 'multiload',
      });
    }
  }
}

// ── Claimed-range tracking ───────────────────────────────────────────
// Scanners record the pulse ranges they successfully decoded so later
// scanners (specifically the permissive Cyberload heuristic) can skip
// over them. Without this, byte runs that look like pilots inside real
// game data trigger spurious detections.
function claimRange(ctx, start, end) {
  ctx.claims.push([start, end]);
}

// If pos falls inside a claimed range, return that range's end (so the
// caller can jump past it). Otherwise return pos unchanged.
function skipClaimed(ctx, pos) {
  for (var i = 0; i < ctx.claims.length; i++) {
    if (pos >= ctx.claims[i][0] && pos < ctx.claims[i][1]) return ctx.claims[i][1];
  }
  return pos;
}

// ── Entry helpers ────────────────────────────────────────────────────
function pushTapeEntry(ctx, info) {
  var eOff = ctx.entries.length;
  ctx.tapEntries[eOff] = { fileData: info.fileData };
  var entry = {
    name: info.name,
    type: info.type,
    blocks: info.blocks,
    deleted: false,
    entryOff: eOff,
    loader: info.loader || '',
    _firstPulse: info.firstPulse | 0,
  };
  if (info.tapeIcon) entry.tapeIcon = info.tapeIcon;
  ctx.entries.push(entry);
}

// ── Public entry point ───────────────────────────────────────────────
function parseTAP(buffer) {
  var data = new Uint8Array(buffer);
  var version = data[0x0C];
  var tapeName = 'TAP v' + version;

  var ctx = { entries: [], tapEntries: {}, cbmHeaders: [], claims: [] };
  var pulses = extractTAPPulses(buffer).pulses;

  scanCbmRom(pulses, ctx);
  scanTurbotape250(pulses, ctx);
  scanNovaload(pulses, ctx);
  scanCreatures(pulses, ctx);
  scanCyberload(pulses, ctx);

  // Sort by tape position so the directory mirrors the physical tape order.
  ctx.entries.sort(function(a, b) { return a._firstPulse - b._firstPulse; });

  // Reassign entryOff to match new order while preserving fileData mapping.
  parsedTAPEntries = {};
  parsedT64Entries = null;
  for (var i = 0; i < ctx.entries.length; i++) {
    var e = ctx.entries[i];
    parsedTAPEntries[i] = ctx.tapEntries[e.entryOff];
    e.entryOff = i;
    delete e._firstPulse;
  }
  parsedTapeDir = ctx.entries;

  var turboWarning = '';
  if (ctx.entries.length === 0) {
    turboWarning = 'No supported loader found';
  }

  return {
    diskName: tapeName,
    diskId: 'v' + version,
    freeBlocks: 0,
    entries: ctx.entries,
    format: 'TAP',
    tracks: 0,
    turboWarning: turboWarning,
  };
}
