// ── File Info viewer ──────────────────────────────────────────────────
// Detect common C64 packers by examining the decruncher code
function detectPacker(fileData) {
  if (fileData.length < 20) return null;
  var d = fileData;

  // Check for BASIC SYS line first
  var loadAddr = d[0] | (d[1] << 8);
  if (loadAddr !== 0x0801) return null;

  // Parse SYS address from BASIC line
  // Format: [next_ptr_lo] [next_ptr_hi] [line_lo] [line_hi] [token...] [0x00]
  // SYS token = 0x9E, followed by address digits
  var sysAddr = 0;
  var pos = 2; // skip load address
  // Skip next-line pointer (2 bytes) and line number (2 bytes)
  pos += 4;
  // Find SYS token (0x9E)
  var foundSys = false;
  while (pos < Math.min(d.length, 40)) {
    if (d[pos] === 0x9E) { foundSys = true; pos++; break; }
    if (d[pos] === 0x00) break;
    pos++;
  }
  if (foundSys) {
    // Skip spaces
    while (pos < d.length && d[pos] === 0x20) pos++;
    // Parse decimal digits
    var digits = '';
    while (pos < d.length && d[pos] >= 0x30 && d[pos] <= 0x39) {
      digits += String.fromCharCode(d[pos]);
      pos++;
    }
    sysAddr = parseInt(digits, 10) || 0;
  }
  if (!sysAddr) return { sysAddr: 0, packer: null };

  // Try restore64 scanner database (377 packers) first
  if (typeof detectPackerRestore64 === 'function') {
    var r64 = detectPackerRestore64(d);
    if (r64 && r64.name) {
      var versionStr = r64.name + (r64.version ? ' ' + r64.version : '');
      return { sysAddr: sysAddr, packer: versionStr };
    }
  }

  // Fallback: our own signature detection
  // Calculate offset of SYS target within file data
  var sysOff = sysAddr - loadAddr + 2; // +2 for the load address bytes in data

  // Search for packer signatures in the code area
  function findString(str, start, end) {
    start = start || 0;
    end = Math.min(end || d.length, d.length);
    for (var i = start; i <= end - str.length; i++) {
      var match = true;
      for (var j = 0; j < str.length; j++) {
        if (d[i + j] !== str.charCodeAt(j)) { match = false; break; }
      }
      if (match) return i;
    }
    return -1;
  }

  function findBytes(pattern, start, end) {
    start = start || 0;
    end = Math.min(end || d.length, d.length);
    for (var i = start; i <= end - pattern.length; i++) {
      var match = true;
      for (var j = 0; j < pattern.length; j++) {
        if (pattern[j] !== null && d[i + j] !== pattern[j]) { match = false; break; }
      }
      if (match) return i;
    }
    return -1;
  }

  var packer = null;
  var searchEnd = Math.min(d.length, 1024);

  // Exact byte signatures (highest confidence, checked first)

  // Exomizer v1: SYS2059, specific stub bytes
  if (!packer && sysAddr === 2059 && findBytes([0xA0, 0x00, 0x78, 0xE6, 0x01, 0xBA, 0xBD], 13, 22) >= 0) packer = 'Exomizer v1';

  // ByteBoozer 2: SEI + LDA #$34 + STA $01 + LDX #$B7 at offset 12
  if (!packer && findBytes([0x78, 0xA9, 0x34, 0x85, 0x01, 0xA2, 0xB7], 12, 22) >= 0) packer = 'ByteBoozer 2';

  // PuCrunch: BASIC line number 239 ($EF $00) at offset 4-5
  if (!packer && d.length > 16 && d[4] === 0xEF && d[5] === 0x00 && findBytes([0x78, 0xA9, 0x38, 0x85, 0x01], 14, 22) >= 0) packer = 'PuCrunch';

  // Dali: BASIC line number 1602 ($42 $06) at offset 4-5
  if (!packer && d.length > 16 && d[4] === 0x42 && d[5] === 0x06) packer = 'Dali';

  // Exomizer v2/v3: decrunch table at $0334, memory restore A9 37 85 01
  if (!packer && findBytes([0xA9, 0x37, 0x85, 0x01], sysOff, searchEnd) >= 0) {
    // Check for $0334 table reference
    if (findBytes([0x34, 0x03], sysOff, searchEnd) >= 0) packer = 'Exomizer v2/v3';
  }

  // ByteBoozer 1: BB string + SEI + LDX #0
  if (!packer && findString('BB', 2, searchEnd) >= 0 && findBytes([0xA2, 0x00, 0x78], sysOff, searchEnd) >= 0) packer = 'ByteBoozer v1';

  // TSCrunch: uses ZP $F8, first decrunch reads LDA ($F8),Y
  if (!packer && findBytes([0xB1, 0xF8], sysOff, sysOff + 64) >= 0) packer = 'TSCrunch';

  // String-based signatures
  if (!packer && (findString('exo', 2, searchEnd) >= 0 || findString('Exo', 2, searchEnd) >= 0)) packer = 'Exomizer';
  if (!packer && findString('PuCr', 2, searchEnd) >= 0) packer = 'PuCrunch';
  if (!packer && findString('IRC', 2, searchEnd) >= 0) packer = 'IRCrunch';
  if (!packer && findString('Sub', 2, searchEnd) >= 0 && findBytes([0x4C], sysOff, sysOff + 3) >= 0) packer = 'Subsizer';
  if (!packer && findString('LC', 2, searchEnd) >= 0 && findBytes([0xA9, null, 0x85], sysOff, searchEnd) >= 0) packer = 'Level Crusher';
  if (!packer && findString('AB', 2, searchEnd) >= 0 && sysAddr >= 0x080D && sysAddr <= 0x0830) packer = 'Cruncher AB';

  // Code pattern signatures
  // MegaLZ / Doynax / Doynamite
  if (!packer && findBytes([0xA2, 0x00, 0xA0, 0x00, 0xB1], sysOff, searchEnd) >= 0) packer = 'MegaLZ/Doynax';

  // Common decruncher init: SEI + memory config change
  if (!packer && sysOff > 0 && sysOff < d.length) {
    var initByte = d[sysOff];
    if (initByte === 0x78) { // SEI
      // Check memory config: LDA #$34 (all RAM)
      if (findBytes([0xA9, 0x34, 0x85, 0x01], sysOff, sysOff + 16) >= 0) packer = 'Unknown packer (all-RAM)';
      // LDA #$35 (I/O + RAM)
      else if (findBytes([0xA9, 0x35, 0x85, 0x01], sysOff, sysOff + 16) >= 0) packer = 'Unknown packer';
    }
  }

  // Generic heuristic: SYS points past standard BASIC stub
  if (!packer && sysAddr > 0x080D) {
    // Check for common decruncher patterns near SYS target
    if (sysOff > 0 && sysOff < d.length && (d[sysOff] === 0x78 || d[sysOff] === 0x4C || d[sysOff] === 0xA9)) {
      packer = 'Packed (unknown)';
    }
  }

  return { sysAddr: sysAddr, packer: packer };
}

function showFileInfo(entryOff) {
  if (!currentBuffer) return;
  var data = new Uint8Array(currentBuffer);
  var typeByte = data[entryOff + 2];
  var typeIdx = typeByte & 0x07;
  var closed = (typeByte & 0x80) !== 0;
  var locked = (typeByte & 0x40) !== 0;
  var typeName = FILE_TYPES[typeIdx] || '???';
  var name = petsciiToReadable(readPetsciiString(data, entryOff + 5, 16)).trim();
  var blocks = data[entryOff + 30] | (data[entryOff + 31] << 8);
  var startTrack = data[entryOff + 3];
  var startSector = data[entryOff + 4];

  var addr = getFileAddresses(currentBuffer, entryOff);
  var result = readFileData(currentBuffer, entryOff);
  var fileData = result.data;

  var lines = [];
  lines.push('Type: ' + typeName + (closed ? '' : ' (scratched)') + (locked ? ' (locked)' : ''));
  lines.push('Blocks: ' + blocks);
  lines.push('Size: ' + fileData.length + ' bytes');
  lines.push('Start T:$' + hex8(startTrack) + ' S:$' + hex8(startSector));

  if (addr) {
    lines.push('Load: $' + hex16(addr.start) + ' - $' + hex16(addr.end));
  }

  // PRG-specific: SYS line and packer detection
  if (typeIdx === 2 && fileData.length >= 10) {
    var loadAddr = fileData[0] | (fileData[1] << 8);
    if (loadAddr === 0x0801) {
      var packerInfo = detectPacker(fileData);
      if (packerInfo) {
        if (packerInfo.sysAddr) {
          lines.push('SYS: ' + packerInfo.sysAddr + ' ($' + hex16(packerInfo.sysAddr) + ')');
        }
        if (packerInfo.packer) {
          lines.push('Packer: ' + packerInfo.packer);
        }
      }
    }

    // Check for BASIC program
    if (isBasicProgram(fileData)) {
      var basic = detokenizeBasic(fileData);
      if (basic && basic.lines.length > 0) {
        lines.push('BASIC: ' + basic.lines.length + ' line(s), ' + basic.version);
      }
    }
  }

  // Graphics format detection
  var gfxMatches = detectGfxFormats(fileData);
  if (gfxMatches.length > 0) {
    var exact = gfxMatches.filter(function(m) {
      for (var i = 0; i < GFX_FORMATS.length; i++) {
        if (GFX_FORMATS[i].name === m.name) return true;
      }
      return false;
    });
    if (exact.length > 0) {
      lines.push('Graphics: ' + exact.map(function(m) { return m.name; }).join(', '));
    }
  }

  showModal('File Info \u2014 "' + name + '"', lines);
}

// ── C64 color palette ─────────────────────────────────────────────────
// Pepto's VIC-II palette (https://www.pepto.de/projects/colorvic/2001/)
var C64_COLORS = [
  '#000000', '#FFFFFF', '#683726', '#70A4B2', '#6F3D86', '#588D43',
  '#352879', '#B8C76F', '#6F4F25', '#433900', '#9A6759', '#444444',
  '#6C6C6C', '#9AD284', '#6C5EB5', '#959595'
];

// ── C64 Graphics format viewer ────────────────────────────────────────

// Known formats: exact match by load address + file size
var GFX_FORMATS = [
  // Multicolor — Koala-style layout (bm+scr+col+bg) at specific addresses
  { name: 'Koala Painter', addr: 0x6000, size: 10003, mode: 'mc', layout: 'koala' },
  { name: 'Gun Paint', addr: 0x4000, size: 10003, mode: 'mc', layout: 'koala' },
  { name: 'Zoomatic', addr: 0x5800, size: 10003, mode: 'mc', layout: 'koala' },
  { name: 'Micro Illustrator', addr: 0x1800, size: 10003, mode: 'mc', layout: 'koala' },
  { name: 'Amica Paint', addr: 0x4000, size: 10018, mode: 'mc', layout: 'koala' },
  { name: 'Run Paint', addr: 0x6000, size: 10003, mode: 'mc', layout: 'koala' },
  { name: 'PMC (Pixel Multicolor)', addr: 0x7800, size: 10003, mode: 'mc', layout: 'koala' },
  { name: 'CDU-Paint', addr: 0x7EEF, size: 10277, mode: 'mc', layout: 'koala' },
  { name: 'Pixel Perfect', addr: 0x5C00, size: 10006, mode: 'mc', layout: 'koala' },
  { name: 'Advanced Art Studio', addr: 0x2000, size: 10018, mode: 'mc', layout: 'aas' },
  { name: 'Saracen Paint', addr: 0x3F8E, size: 10023, mode: 'mc', layout: 'saracen' },
  // Multicolor — other layouts
  { name: 'Drazpaint', addr: 0x5800, size: 10051, mode: 'mc', layout: 'drp' },
  { name: 'Vidcom 64', addr: 0x5800, size: 10050, mode: 'mc', layout: 'vidcom' },
  // Hires — bitmap+screen layout
  { name: 'Art Studio', addr: 0x2000, size: 9009, mode: 'hires', layout: 'bmscr' },
  { name: 'Hires Manager', addr: 0x4000, size: 9002, mode: 'hires', layout: 'bmscr' },
  { name: 'Blazing Paddles', addr: 0xA000, size: 10242, mode: 'hires', layout: 'bmscr' },
  { name: 'Face Painter', addr: 0x6000, size: 9332, mode: 'hires', layout: 'bmscr' },
  // Hires — screen+bitmap layout (Doodle-style)
  { name: 'Doodle', addr: 0x5C00, size: 9218, mode: 'hires', layout: 'scrbm' },
  { name: 'Artist 64', addr: 0x2000, size: 9218, mode: 'hires', layout: 'scrbm' },
  // FLI
  { name: 'FLI (Blackmail)', addr: 0x3C00, size: 17409, mode: 'fli', layout: 'fli' },
  { name: 'FLI Graph 2.2', addr: 0x3C00, size: 17474, mode: 'fli', layout: 'fli' },
  { name: 'AFLI', addr: 0x4000, size: 16386, mode: 'afli', layout: 'afli' },
  // Interlaced
  { name: 'Drazlace', addr: 0x5800, size: 18242, mode: 'mc', layout: 'drazlace' },
  { name: 'ECI', addr: 0x4000, size: 32770, mode: 'fli', layout: 'eci' },
];

// Layout parsers — reusable for both exact and generic detection
var GFX_PARSERS = {
  koala: function(d) { return { bm: d.subarray(2, 8002), scr: d.subarray(8002, 9002), col: d.subarray(9002, Math.min(d.length, 10002)), bg: d.length > 10002 ? d[10002] & 0x0F : 0 }; },
  drp: function(d) { return { col: d.subarray(2, 1002), bg: d[1002], bm: d.subarray(1026, 9026), scr: d.subarray(9026, 10026), rowBg: d.subarray(10026, 10051) }; },
  vidcom: function(d) { return { scr: d.subarray(2, 1002), bm: d.subarray(1026, 9026), col: d.subarray(9026, 10026), bg: d[10050] }; },
  aas: function(d) { return { bm: d.subarray(2, 8002), scr: d.subarray(8002, 9002), col: d.subarray(9018, 10018), bg: d[9003] & 0x0F }; },
  saracen: function(d) { return { bm: d.subarray(20, 8020), scr: d.subarray(8020, 9020), col: d.subarray(9020, 10020), bg: d[10020] & 0x0F }; },
  bmscr: function(d) { return { bm: d.subarray(2, 8002), scr: d.subarray(8002, 9002) }; },
  bmonly: function(d) {
    var scr = new Uint8Array(1000);
    for (var i = 0; i < 1000; i++) scr[i] = 0x10; // white on black
    return { bm: d.subarray(2, 8002), scr: scr };
  },
  scrbm: function(d) { return { scr: d.subarray(2, 1026), bm: d.subarray(1026, 9218) }; },
  fli: function(d) {
    // Color RAM (1024), Screen banks (8×1024=8192), Bitmap (8000-8192), optional bg
    var bmStart = 2 + 1024 + 8192; // = 9218
    var bmEnd = Math.min(bmStart + 8192, d.length);
    return { col: d.subarray(2, 1026), scrBanks: d.subarray(1026, 9218), bm: d.subarray(bmStart, bmEnd), bg: d.length > bmEnd ? d[bmEnd] & 0x0F : 0 };
  },
  afli: function(d) { return { scrBanks: d.subarray(2, 8194), bm: d.subarray(8194, 16386) }; },
  drazlace: function(d) { return { col: d.subarray(2, 1002), bg: d[1002], bm: d.subarray(1026, 9026), scr: d.subarray(9026, 10026), rowBg: d.subarray(10026, 10051) }; },
  eci: function(d) { return { col: d.subarray(2, 1026), scrBanks: d.subarray(1026, 9218), bm: d.subarray(9218, 17410), bg: 0 }; },
  printshop: function(d) {
    var bmData = d.subarray(2);
    var bpr = 11;
    var h = Math.floor(bmData.length / bpr);
    return { bm: bmData, width: 88, height: h, bytesPerRow: bpr };
  },
  sprites: function(d) {
    var bmData = d.subarray(2);
    var count = Math.floor(bmData.length / 64);
    return { bm: bmData, count: count };
  },
  charset: function(d) {
    var bmData = d.subarray(2);
    var count = Math.floor(bmData.length / 8);
    return { bm: bmData, count: count };
  },
};

// Detect all plausible formats for a file (returns array of { name, mode, layout })
function detectGfxFormats(fileData) {
  if (!fileData || fileData.length < 4) return [];
  var addr = fileData[0] | (fileData[1] << 8);
  var size = fileData.length;
  var dataBytes = size - 2;
  var matches = [];
  var added = {};

  function add(name, mode, layout) {
    var key = mode + ':' + layout;
    if (added[key]) return;
    added[key] = true;
    matches.push({ name: name, addr: addr, size: size, mode: mode, layout: layout });
  }

  // 1. Exact matches (address + size)
  for (var i = 0; i < GFX_FORMATS.length; i++) {
    if (GFX_FORMATS[i].addr === addr && GFX_FORMATS[i].size === size) {
      add(GFX_FORMATS[i].name, GFX_FORMATS[i].mode, GFX_FORMATS[i].layout);
    }
  }

  // 2. Generic bitmap formats by data size (any load address)
  if (dataBytes >= 8000 && dataBytes <= 8192) add('Hires (bitmap only)', 'hires', 'bmonly');
  if (dataBytes >= 9000 && dataBytes <= 9218) {
    add('Hires (bitmap+screen)', 'hires', 'bmscr');
    add('Hires (screen+bitmap)', 'hires', 'scrbm');
  }
  if (dataBytes >= 10001 && dataBytes <= 10018) {
    add('Multicolor (Koala-style)', 'mc', 'koala');
    add('Multicolor (AAS-style)', 'mc', 'aas');
  }
  if (dataBytes > 10018 && dataBytes <= 10280) add('Multicolor (Koala-style)', 'mc', 'koala');
  if (dataBytes >= 17200 && dataBytes <= 17474) add('Multicolor FLI', 'fli', 'fli');
  if (dataBytes >= 16384 && dataBytes <= 16386) add('Hires FLI (AFLI)', 'afli', 'afli');
  if (dataBytes >= 18200 && dataBytes <= 18250) add('Multicolor Interlace', 'mc', 'drazlace');
  if (dataBytes >= 32760 && dataBytes <= 32780) add('Multicolor IFLI', 'fli', 'eci');

  // 3. Sprites: data bytes divisible by 64
  if (dataBytes >= 64 && dataBytes <= 16384 && dataBytes % 64 === 0) {
    var numSprites = dataBytes / 64;
    add('Sprites (' + numSprites + ')', 'sprites', 'sprites');
    add('Sprites MC (' + numSprites + ')', 'sprites-mc', 'sprites');
  }

  // 4. Charset/tile: data divisible by 8
  if (dataBytes >= 8 && dataBytes % 8 === 0) {
    var numChars = dataBytes / 8;
    add('Charset 1\u00D71 (' + numChars + ')', 'charset', 'charset');
    add('Charset MC 1\u00D71 (' + numChars + ')', 'charset-mc', 'charset');
    // Multi-char tile modes use C64 bank stride of 64
    // WxH needs W*H banks: 1x2/2x1 = 2 banks (128 chars), 2x2 = 4 banks (256 chars)
    if (numChars >= 128) {
      add('Charset 1\u00D72', 'charset-1x2', 'charset');
      add('Charset MC 1\u00D72', 'charset-mc-1x2', 'charset');
      add('Charset 2\u00D71', 'charset-2x1', 'charset');
      add('Charset MC 2\u00D71', 'charset-mc-2x1', 'charset');
    }
    if (numChars >= 256) {
      add('Charset 2\u00D72', 'charset-2x2', 'charset');
      add('Charset MC 2\u00D72', 'charset-mc-2x2', 'charset');
    }
  }

  // 5. Print Shop: small monochrome bitmap
  if (dataBytes >= 11 && dataBytes <= 1500) {
    add('Print Shop', 'printshop', 'printshop');
  }

  return matches;
}

// Detect GEOS graphics formats from directory entry metadata and info block
function detectGeosGfxFormats(entryOff) {
  if (!currentBuffer || isTapeFormat()) return [];
  var geos = readGeosInfo(currentBuffer, entryOff);
  if (!geos.isGeos || geos.structure !== 1) return []; // must be VLIR
  var matches = [];

  // Check file type and class name for geoPaint documents
  var isPaint = (geos.fileType === 0x14);
  if (!isPaint && geos.infoTrack > 0) {
    var infoBlock = readGeosInfoBlock(currentBuffer, geos.infoTrack, geos.infoSector);
    if (infoBlock && infoBlock.className && infoBlock.className.toLowerCase().indexOf('paint') === 0) {
      isPaint = true;
    }
  }
  if (isPaint) {
    matches.push({ name: 'geoPaint', mode: 'geopaint', layout: 'geopaint', geosEntry: entryOff });
  }
  if (geos.fileType === 0x15) {
    matches.push({ name: 'Photo Scrap', mode: 'geoscrap', layout: 'geoscrap', geosEntry: entryOff });
  }
  if (geos.fileType === 0x18) {
    matches.push({ name: 'Photo Album', mode: 'geosalbum', layout: 'geosalbum', geosEntry: entryOff });
  }
  // Check class name for photo album (stored as application data $07)
  if (!isPaint && geos.fileType === 0x07 && geos.infoTrack > 0) {
    var infoBlock2 = readGeosInfoBlock(currentBuffer, geos.infoTrack, geos.infoSector);
    if (infoBlock2 && infoBlock2.className && infoBlock2.className.toLowerCase().indexOf('photo album') === 0) {
      matches.push({ name: 'Photo Album', mode: 'geosalbum', layout: 'geosalbum', geosEntry: entryOff });
    }
  }
  if (geos.fileType === 0x08) {
    matches.push({ name: 'GEOS Font', mode: 'geosfont', layout: 'geosfont', geosEntry: entryOff });
  }
  // geoWrite documents (type $07 or $13, class "Write Image") — embedded images in records 64-126
  if (geos.fileType === 0x07 || geos.fileType === 0x13) {
    var infoBlk = readGeosInfoBlock(currentBuffer, geos.infoTrack, geos.infoSector);
    if (infoBlk && infoBlk.className && infoBlk.className.toLowerCase().indexOf('write image') === 0) {
      matches.push({ name: 'geoWrite Images', mode: 'geoswrite', layout: 'geoswrite', geosEntry: entryOff });
    }
  }
  return matches;
}

// Render a geoPaint image (640×720, VLIR records with GEOS compression).
// Each record = 2 card rows decompressed to 1448 bytes:
//   0-639: bitmap row 0 (80 cards × 8 bytes, column-major)
//   640-1279: bitmap row 1
//   1280-1287: padding
//   1288-1367: color row 0 (80 bytes, high nybble=fg, low=bg)
//   1368-1447: color row 1
function renderGeoPaint(ctx, entryOff) {
  var records = readVLIRRecords(currentBuffer, entryOff);
  if (records.length === 0) return false;

  var w = 640, h = records.length * 16;
  ctx.canvas.width = w;
  ctx.canvas.height = h;
  var img = ctx.createImageData(w, h);
  var px = img.data;
  for (var fi = 3; fi < px.length; fi += 4) px[fi] = 255;

  for (var ri = 0; ri < records.length; ri++) {
    if (!records[ri] || records[ri].length === 0) continue;
    var dec = decompressGeosBitmap(records[ri]);
    if (dec.length < 1288) continue;

    for (var cardRow = 0; cardRow < 2; cardRow++) {
      var bmOff = cardRow * 640;
      var colOff = 1288 + cardRow * 80;

      for (var card = 0; card < 80; card++) {
        var colorByte = colOff + card < dec.length ? dec[colOff + card] : 0;
        var fgRgb = C64_RGB[(colorByte >> 4) & 0x0F];
        var bgRgb = C64_RGB[colorByte & 0x0F];

        for (var line = 0; line < 8; line++) {
          var byt = dec[bmOff + card * 8 + line] || 0;
          var y = ri * 16 + cardRow * 8 + line;
          for (var bit = 7; bit >= 0; bit--) {
            var x = card * 8 + (7 - bit);
            if (x < w && y < h) {
              var rgb = (byt & (1 << bit)) ? fgRgb : bgRgb;
              var off = (y * w + x) * 4;
              px[off] = rgb[0]; px[off + 1] = rgb[1]; px[off + 2] = rgb[2];
            }
          }
        }
      }
    }
  }
  ctx.putImageData(img, 0, 0);
  return true;
}

// Render a single photo scrap from raw data (3-byte header + compressed bitmap).
// Header: byte 0 = width in cards, bytes 1-2 = height in pixels (LE).
// Uses scrap compression (different from geoPaint).
function renderScrapData(ctx, scrapBytes, yOffset) {
  if (scrapBytes.length < 4) return 0;
  var wCards = scrapBytes[0];
  var h = scrapBytes[1] | (scrapBytes[2] << 8);
  if (wCards === 0 || h === 0 || h > 4096) return 0;
  var w = wCards * 8;
  var dec = decompressGeosScrap(scrapBytes.subarray(3));
  if (dec.length < wCards * h) return 0;

  // Ensure canvas is wide enough
  if (w > ctx.canvas.width) ctx.canvas.width = w;

  var img = ctx.getImageData(0, yOffset, w, h);
  var px = img.data;
  for (var fi = 0; fi < px.length; fi++) px[fi] = 255;
  for (var fi2 = 3; fi2 < px.length; fi2 += 4) px[fi2] = 255;

  for (var y = 0; y < h; y++) {
    for (var bx = 0; bx < wCards; bx++) {
      var byt = dec[y * wCards + bx];
      for (var bit = 7; bit >= 0; bit--) {
        var x = bx * 8 + (7 - bit);
        var off = (y * w + x) * 4;
        var on = byt & (1 << bit);
        px[off] = on ? 0 : 255;
        px[off + 1] = on ? 0 : 255;
        px[off + 2] = on ? 0 : 255;
      }
    }
  }
  ctx.putImageData(img, 0, yOffset);
  return h;
}

// Render GEOS Photo Scrap (sequential file, single image)
function renderGeoScrap(ctx, entryOff) {
  var result = readFileData(currentBuffer, entryOff);
  if (result.error || result.data.length < 4) return false;
  var scrapData = result.data;
  var wCards = scrapData[0];
  var h = scrapData[1] | (scrapData[2] << 8);
  if (wCards === 0 || h === 0) return false;
  ctx.canvas.width = wCards * 8;
  ctx.canvas.height = h;
  return renderScrapData(ctx, scrapData, 0) > 0;
}

// Render GEOS Photo Album (VLIR, each record is a photo scrap)
function renderGeoAlbum(ctx, entryOff) {
  var records = readVLIRRecords(currentBuffer, entryOff);
  if (records.length === 0) return false;

  // First pass: measure total height and max width
  var totalH = 0, maxW = 0, gap = 4;
  var scraps = [];
  for (var ri = 0; ri < records.length; ri++) {
    if (!records[ri] || records[ri].length < 4) continue;
    var wCards = records[ri][0];
    var h = records[ri][1] | (records[ri][2] << 8);
    if (wCards === 0 || h === 0 || h > 4096) continue;
    var w = wCards * 8;
    if (w > maxW) maxW = w;
    scraps.push({ data: records[ri], h: h });
    totalH += h + gap;
  }
  if (scraps.length === 0) return false;
  totalH -= gap;

  ctx.canvas.width = maxW;
  ctx.canvas.height = totalH;
  // Fill white
  var bgImg = ctx.createImageData(maxW, totalH);
  for (var fi = 0; fi < bgImg.data.length; fi++) bgImg.data[fi] = 255;
  ctx.putImageData(bgImg, 0, 0);

  var yPos = 0;
  for (var si = 0; si < scraps.length; si++) {
    renderScrapData(ctx, scraps[si].data, yPos);
    yPos += scraps[si].h + gap;
  }
  return true;
}

// Render geoWrite embedded images (VLIR records 64-126, each in Photo Scrap format)
function renderGeoWrite(ctx, entryOff) {
  var records = readVLIRRecords(currentBuffer, entryOff);
  if (records.length <= 64) return false;

  // Collect valid image records (indices 64-126)
  var totalH = 0, maxW = 0, gap = 4;
  var scraps = [];
  for (var ri = 64; ri < records.length && ri <= 126; ri++) {
    if (!records[ri] || records[ri].length < 4) continue;
    var wCards = records[ri][0];
    var h = records[ri][1] | (records[ri][2] << 8);
    if (wCards === 0 || h === 0 || h > 4096) continue;
    var w = wCards * 8;
    if (w > maxW) maxW = w;
    scraps.push({ data: records[ri], h: h });
    totalH += h + gap;
  }
  if (scraps.length === 0) return false;
  totalH -= gap;

  ctx.canvas.width = maxW;
  ctx.canvas.height = totalH;
  var bgImg = ctx.createImageData(maxW, totalH);
  for (var fi = 0; fi < bgImg.data.length; fi++) bgImg.data[fi] = 255;
  ctx.putImageData(bgImg, 0, 0);

  var yPos = 0;
  for (var si = 0; si < scraps.length; si++) {
    renderScrapData(ctx, scraps[si].data, yPos);
    yPos += scraps[si].h + gap;
  }
  return true;
}

// Parse a GEOS font's VLIR records into a list of { pt, rec, ascent, rowLen,
// height, bmOff, xTab } objects, one per valid size. See renderGeosFont for
// the format documentation.
function parseGeosFontRecords(records) {
  var fonts = [];
  for (var ri = 0; ri < records.length; ri++) {
    if (!records[ri] || records[ri].length < 8) continue;
    var rec = records[ri];
    var ascent = rec[0];
    var rowLen = rec[1] | (rec[2] << 8);
    var height = rec[3];
    var xTabOff = rec[4] | (rec[5] << 8);
    var bmOff = rec[6] | (rec[7] << 8);
    if (height < 1 || height > 63) continue;
    if (rowLen < 1 || rowLen > 500) continue;
    if (bmOff + height * rowLen > rec.length) continue;
    if (xTabOff + 194 > rec.length) continue;

    var xTab = new Array(97);
    for (var xi = 0; xi < 97; xi++) {
      xTab[xi] = rec[xTabOff + xi * 2] | (rec[xTabOff + xi * 2 + 1] << 8);
    }
    fonts.push({ pt: ri, rec: rec, ascent: ascent, rowLen: rowLen, height: height, bmOff: bmOff, xTab: xTab });
  }
  return fonts;
}

// Is bit (x,y) set inside char #charIdx of GEOS font f?
function geosFontGlyphBit(f, charIdx, x, y) {
  var bitX = f.xTab[charIdx] + x;
  return (f.rec[f.bmOff + y * f.rowLen + (bitX >> 3)] & (0x80 >> (bitX & 7))) ? 1 : 0;
}

// Find the smallest C64 character tile grid that fits every printable glyph
// of f. Each C64 tile is 8x8. Returns { cols, rows, maxW, maxH } or null if
// the font doesn't fit even a 2x2 tile (16x16).
function geosFontC64TileFit(f) {
  var maxW = 0, maxH = f.height;
  for (var ci = 0; ci < 96; ci++) {
    var w = f.xTab[ci + 1] - f.xTab[ci];
    if (w > maxW) maxW = w;
  }
  var cols = maxW <= 8 ? 1 : (maxW <= 16 ? 2 : 0);
  var rows = maxH <= 8 ? 1 : (maxH <= 16 ? 2 : 0);
  if (!cols || !rows) return null;
  return { cols: cols, rows: rows, maxW: maxW, maxH: maxH };
}

// Modal dialog that lists every size of a GEOS font with its C64 charset
// tile fit and offers a download for each. Uses the existing modal-overlay.
function showGeosFontCharsetExport(entryOff) {
  var records = readVLIRRecords(currentBuffer, entryOff);
  var fonts = parseGeosFontRecords(records || []);
  if (fonts.length === 0) { showModal('Export C64 Charset', ['No usable font records found.']); return; }

  var data = new Uint8Array(currentBuffer);
  var fileName = petsciiToReadable(readPetsciiString(data, entryOff + 5, 16)).trim() || 'font';
  var className = '';
  var infoT = data[entryOff + 0x15], infoS = data[entryOff + 0x16];
  if (infoT > 0) {
    var info = readGeosInfoBlock(currentBuffer, infoT, infoS);
    if (info && info.className) className = info.className.trim();
  }
  var safeName = (className || fileName).replace(/[<>:"/\\|?*\x00-\x1F]/g, '_').replace(/\s+/g, '_') || 'font';

  var title = 'Export ' + (className || fileName) + ' as C64 Charset';
  document.getElementById('modal-title').textContent = title;
  var body = document.getElementById('modal-body');
  body.innerHTML = '';

  var intro = document.createElement('div');
  intro.style.cssText = 'margin-bottom:12px;color:var(--text-muted);font-size:12px';
  intro.textContent = 'C64 PRG with load address $3000. Each glyph is emitted as cols\u00D7rows tiles of 8\u00D78 pixels, top-left to bottom-right. 96 glyphs total ($20\u2013$7F). You can drop the .prg back onto a disk to import it.';
  body.appendChild(intro);

  var list = document.createElement('div');
  list.style.cssText = 'display:flex;flex-direction:column;gap:6px';

  for (var i = 0; i < fonts.length; i++) {
    (function(f) {
      var row = document.createElement('div');
      row.style.cssText = 'display:flex;align-items:center;gap:12px;padding:8px;border:1px solid var(--border);border-radius:3px';
      var fit = geosFontC64TileFit(f);
      var info = document.createElement('div');
      info.style.cssText = 'flex:1';
      if (fit) {
        var bytes = 96 * fit.cols * fit.rows * 8 + 2; // + 2 bytes load address
        info.innerHTML = '<b>' + f.pt + 'pt</b> \u2014 widest ' + fit.maxW + 'px, tallest ' + fit.maxH + 'px \u2014 fits <b>' + fit.cols + '\u00D7' + fit.rows + '</b> (' + bytes + ' bytes)';
      } else {
        var mw = 0;
        for (var ci = 0; ci < 96; ci++) { var w = f.xTab[ci+1]-f.xTab[ci]; if (w > mw) mw = w; }
        info.innerHTML = '<b>' + f.pt + 'pt</b> \u2014 widest ' + mw + 'px, tallest ' + f.height + 'px \u2014 <span style="color:var(--color-warn)">too large (max 16\u00D716)</span>';
      }
      row.appendChild(info);
      if (fit) {
        var dl = document.createElement('button');
        dl.className = 'btn-small';
        dl.textContent = 'Download';
        dl.addEventListener('click', function() {
          var bin = geosFontToC64Charset(f, fit.cols, fit.rows);
          // PRG: 2-byte little-endian load address ($3000) + charset bytes.
          // $3000 is a conventional custom-charset location (free zone, safe
          // from BASIC + ROM).
          var prg = new Uint8Array(bin.length + 2);
          prg[0] = 0x00; prg[1] = 0x30;
          prg.set(bin, 2);
          var fname = safeName + '_' + f.pt + 'pt_' + fit.cols + 'x' + fit.rows + '.prg';
          var blob = new Blob([prg], { type: 'application/octet-stream' });
          var a = document.createElement('a');
          a.href = URL.createObjectURL(blob);
          a.download = fname;
          a.click();
          URL.revokeObjectURL(a.href);
        });
        row.appendChild(dl);
      }
      list.appendChild(row);
    })(fonts[i]);
  }
  body.appendChild(list);

  var footer = document.querySelector('#modal-overlay .modal-footer');
  footer.innerHTML = '';
  var closeBtn = document.createElement('button');
  closeBtn.textContent = 'Close';
  closeBtn.addEventListener('click', function() {
    document.getElementById('modal-overlay').classList.remove('open');
  });
  footer.appendChild(closeBtn);

  document.getElementById('modal-overlay').classList.add('open');
}

// Render a GEOS font as a C64-native charset. For each of the 96 printable
// glyphs, emit cols*rows tiles of 8 bytes each (one byte per row, MSB-left),
// laid out in reading order (top-left, top-right, bottom-left, bottom-right
// for 2x2). Returns a Uint8Array of 96 * cols * rows * 8 bytes.
function geosFontToC64Charset(f, cols, rows) {
  var tileBytes = 8;
  var tilesPerChar = cols * rows;
  var out = new Uint8Array(96 * tilesPerChar * tileBytes);
  var o = 0;
  for (var ci = 0; ci < 96; ci++) {
    var glyphW = f.xTab[ci + 1] - f.xTab[ci];
    for (var tr = 0; tr < rows; tr++) {
      for (var tc = 0; tc < cols; tc++) {
        for (var py = 0; py < 8; py++) {
          var byte = 0;
          var srcY = tr * 8 + py;
          if (srcY < f.height) {
            for (var px = 0; px < 8; px++) {
              var srcX = tc * 8 + px;
              if (srcX < glyphW && geosFontGlyphBit(f, ci, srcX, srcY)) {
                byte |= 0x80 >> px;
              }
            }
          }
          out[o++] = byte;
        }
      }
    }
  }
  return out;
}

// Render GEOS font: for each size, show a pangram sample followed by a grid
// of all 96 printable glyphs with their hex codes underneath.
// Font VLIR records are NOT compressed. Record N = N-point font.
// Header (8 bytes): ascent, rowLength(16), height, xTabOffset(16), bmOffset(16)
// X-table: 97 entries x 2 bytes (character boundaries for $20-$7F + total width).
//   xTable[i] = left-edge column of char ($20 + i) in the bitmap;
//   xTable[96] = bitmap width in pixels (one past the last glyph).
// Bitmap: height rows x rowLength bytes (all glyphs concatenated horizontally).
function renderGeosFont(ctx, entryOff) {
  var records = readVLIRRecords(currentBuffer, entryOff);
  if (records.length === 0) return false;

  var fonts = parseGeosFontRecords(records);
  if (fonts.length === 0) return false;

  // Pixel-set test for a given font/char/x/y (returns 1 if the bit is on).
  function glyphBit(f, charIdx, x, y) {
    return geosFontGlyphBit(f, charIdx, x, y);
  }

  // Rasterise a piece of text in the font. Returns total width in pixels;
  // if `px` is given, also writes the glyph pixels into that ImageData buffer.
  function drawSampleText(f, text, px, canvasW, canvasH, startX, startY, color) {
    var x = startX;
    for (var si = 0; si < text.length; si++) {
      var code = text.charCodeAt(si);
      if (code < 0x20 || code > 0x7F) code = 0x20;
      var idx = code - 0x20;
      var w = f.xTab[idx + 1] - f.xTab[idx];
      if (w > 0 && px) {
        for (var gy = 0; gy < f.height; gy++) {
          for (var gx = 0; gx < w; gx++) {
            if (glyphBit(f, idx, gx, gy)) {
              var dx = x + gx, dy = startY + gy;
              if (dx >= 0 && dx < canvasW && dy >= 0 && dy < canvasH) {
                var off = (dy * canvasW + dx) * 4;
                px[off] = color[0]; px[off + 1] = color[1]; px[off + 2] = color[2]; px[off + 3] = 255;
              }
            }
          }
        }
      }
      x += (w > 0) ? w : f.height >> 2;
    }
    return x - startX;
  }

  var sampleText = 'The quick brown fox jumps over the lazy dog. 1234567890';
  var cols = 16;
  var rows = 6;
  var labelH = 10;          // px for hex-code label below each glyph
  var cellPadX = 4;
  var cellPadY = 4;         // space between glyph and label
  var sizeHeaderH = 14;     // px for the "N pt" header above each size
  var sampleGap = 6;        // gap between sample text and grid
  var sizeGap = 20;         // gap between sizes
  var sideMargin = 10;

  // Precompute per-size layout (cell dims, block dims, sample width)
  var blocks = [];
  var maxBlockW = 200;       // ensures header fits on narrow fonts
  var totalH = sideMargin;
  for (var fi = 0; fi < fonts.length; fi++) {
    var f = fonts[fi];
    var maxGlyphW = 1;
    for (var ci = 0; ci < 96; ci++) {
      var gw = f.xTab[ci + 1] - f.xTab[ci];
      if (gw > maxGlyphW) maxGlyphW = gw;
    }
    var cellW = maxGlyphW + cellPadX * 2;
    var cellH = f.height + cellPadY + labelH;
    var gridW = cellW * cols;
    var gridH = cellH * rows;
    var sampleW = drawSampleText(f, sampleText, null, 0, 0, 0, 0, null);
    var blockW = Math.max(gridW, sampleW);
    var blockH = sizeHeaderH + f.height + sampleGap + gridH;
    if (blockW > maxBlockW) maxBlockW = blockW;
    blocks.push({ f: f, cellW: cellW, cellH: cellH, maxGlyphW: maxGlyphW, gridW: gridW, gridH: gridH, blockH: blockH, sampleW: sampleW });
    totalH += blockH + sizeGap;
  }
  totalH -= sizeGap;
  totalH += sideMargin;

  var canvasW = maxBlockW + sideMargin * 2;
  ctx.canvas.width = canvasW;
  ctx.canvas.height = totalH;

  // Dark background so the white glyphs read clearly.
  ctx.fillStyle = '#1e1e1e';
  ctx.fillRect(0, 0, canvasW, totalH);

  // Draw glyphs into an ImageData in one pass, then blit.
  var img = ctx.createImageData(canvasW, totalH);
  var data = img.data;
  for (var ti = 3; ti < data.length; ti += 4) data[ti] = 0; // start transparent

  var glyphWhite = [255, 255, 255];

  var yPos = sideMargin;
  for (var bi = 0; bi < blocks.length; bi++) {
    var blk = blocks[bi];
    var f2 = blk.f;

    // Sample text (one line, left-aligned under the size header)
    var sampleY = yPos + sizeHeaderH;
    drawSampleText(f2, sampleText, data, canvasW, totalH, sideMargin, sampleY, glyphWhite);

    // Grid of all 96 chars
    var gridTop = sampleY + f2.height + sampleGap;
    for (var gi = 0; gi < 96; gi++) {
      var col = gi % cols;
      var rw = Math.floor(gi / cols);
      var cellX = sideMargin + col * blk.cellW;
      var cellY = gridTop + rw * blk.cellH;

      var glyphL = f2.xTab[gi];
      var glyphR = f2.xTab[gi + 1];
      var glyphW = glyphR - glyphL;
      if (glyphW > 0) {
        var glyphX = cellX + cellPadX + Math.floor((blk.maxGlyphW - glyphW) / 2);
        for (var yy = 0; yy < f2.height; yy++) {
          for (var gx = 0; gx < glyphW; gx++) {
            if (glyphBit(f2, gi, gx, yy)) {
              var dx = glyphX + gx;
              var dy = cellY + yy;
              if (dx >= 0 && dx < canvasW && dy >= 0 && dy < totalH) {
                var off = (dy * canvasW + dx) * 4;
                data[off] = 255; data[off + 1] = 255; data[off + 2] = 255; data[off + 3] = 255;
              }
            }
          }
        }
      }
    }
    yPos += blk.blockH + sizeGap;
  }
  ctx.putImageData(img, 0, 0);

  // Labels and size headers. Drawn with ctx.fillText after the glyph blit so
  // they stay crisp (not affected by ImageData transparency quirks). Pick up
  // the body font from the DOM so the size header and hex labels use whatever
  // the app's UI font resolves to.
  var uiFont = 'sans-serif';
  try { uiFont = getComputedStyle(document.body).fontFamily || uiFont; } catch (e) {}

  // Prefer the GEOS class name (includes the version, e.g. "BSW 2.1") when
  // available; fall back to the dir-entry filename otherwise. Render as
  // "<class> (<filename>) - Npt".
  var fileName = '';
  var className = '';
  try {
    var data = new Uint8Array(currentBuffer);
    fileName = petsciiToReadable(readPetsciiString(data, entryOff + 5, 16)).trim();
    var infoT = data[entryOff + 0x15], infoS = data[entryOff + 0x16];
    if (infoT > 0) {
      var info = readGeosInfoBlock(currentBuffer, infoT, infoS);
      if (info && info.className) className = info.className.trim();
    }
  } catch (e) {}

  ctx.textBaseline = 'top';
  yPos = sideMargin;
  for (var bi2 = 0; bi2 < blocks.length; bi2++) {
    var blk2 = blocks[bi2];
    var f3 = blk2.f;

    // Size header above the sample line, e.g. "BSW 2.1 (BSW) - 10pt"
    ctx.fillStyle = '#bbb';
    ctx.font = '12px ' + uiFont;
    var label = className || fileName || '';
    if (className && fileName && className !== fileName) label = className + ' (' + fileName + ')';
    var headerText = (label ? label + ' \u2014 ' : '') + f3.pt + 'pt';
    ctx.fillText(headerText, sideMargin, yPos);

    // Hex labels under each grid cell, prefixed with $ so the hex is unambiguous
    ctx.fillStyle = '#666';
    ctx.font = '6px ' + uiFont;
    var gridTop2 = yPos + sizeHeaderH + f3.height + sampleGap;
    for (var gi2 = 0; gi2 < 96; gi2++) {
      var col2 = gi2 % cols;
      var rw2 = Math.floor(gi2 / cols);
      var cellX2 = sideMargin + col2 * blk2.cellW;
      var cellY2 = gridTop2 + rw2 * blk2.cellH;
      var hex = '$' + (0x20 + gi2).toString(16).toUpperCase().padStart(2, '0');
      ctx.fillText(hex, cellX2 + cellPadX, cellY2 + f3.height + 1);
    }
    yPos += blk2.blockH + sizeGap;
  }
  return true;
}

// Parse C64_COLORS hex to [r,g,b] arrays for canvas
var C64_RGB = C64_COLORS.map(function(hex) {
  return [parseInt(hex.substr(1,2),16), parseInt(hex.substr(3,2),16), parseInt(hex.substr(5,2),16)];
});

function renderC64Multicolor(ctx, gfx) {
  ctx.canvas.width = 320; ctx.canvas.height = 200;
  var img = ctx.createImageData(320, 200);
  var px = img.data;
  var bg = C64_RGB[gfx.bg & 0x0F];

  for (var cellRow = 0; cellRow < 25; cellRow++) {
    for (var cellCol = 0; cellCol < 40; cellCol++) {
      var cellIdx = cellRow * 40 + cellCol;
      var scrHi = (gfx.scr[cellIdx] >> 4) & 0x0F;
      var scrLo = gfx.scr[cellIdx] & 0x0F;
      var colLo = gfx.col[cellIdx] & 0x0F;
      var colors = [bg, C64_RGB[scrHi], C64_RGB[scrLo], C64_RGB[colLo]];

      for (var line = 0; line < 8; line++) {
        var byt = gfx.bm[cellIdx * 8 + line];
        var y = cellRow * 8 + line;
        for (var px2 = 0; px2 < 4; px2++) {
          var bits = (byt >> (6 - px2 * 2)) & 3;
          var rgb = colors[bits];
          var x = cellCol * 8 + px2 * 2;
          var off = (y * 320 + x) * 4;
          px[off] = rgb[0]; px[off+1] = rgb[1]; px[off+2] = rgb[2]; px[off+3] = 255;
          px[off+4] = rgb[0]; px[off+5] = rgb[1]; px[off+6] = rgb[2]; px[off+7] = 255;
        }
      }
    }
  }
  ctx.putImageData(img, 0, 0);
}

function renderC64MulticolorDrp(ctx, gfx) {
  ctx.canvas.width = 320; ctx.canvas.height = 200;
  var img = ctx.createImageData(320, 200);
  var px = img.data;

  for (var cellRow = 0; cellRow < 25; cellRow++) {
    var rowBg = gfx.rowBg ? C64_RGB[gfx.rowBg[cellRow] & 0x0F] : C64_RGB[gfx.bg & 0x0F];
    for (var cellCol = 0; cellCol < 40; cellCol++) {
      var cellIdx = cellRow * 40 + cellCol;
      var scrHi = (gfx.scr[cellIdx] >> 4) & 0x0F;
      var scrLo = gfx.scr[cellIdx] & 0x0F;
      var colLo = gfx.col[cellIdx] & 0x0F;
      var colors = [rowBg, C64_RGB[scrHi], C64_RGB[scrLo], C64_RGB[colLo]];

      for (var line = 0; line < 8; line++) {
        var byt = gfx.bm[cellIdx * 8 + line];
        var y = cellRow * 8 + line;
        for (var px2 = 0; px2 < 4; px2++) {
          var bits = (byt >> (6 - px2 * 2)) & 3;
          var rgb = colors[bits];
          var x = cellCol * 8 + px2 * 2;
          var off = (y * 320 + x) * 4;
          px[off] = rgb[0]; px[off+1] = rgb[1]; px[off+2] = rgb[2]; px[off+3] = 255;
          px[off+4] = rgb[0]; px[off+5] = rgb[1]; px[off+6] = rgb[2]; px[off+7] = 255;
        }
      }
    }
  }
  ctx.putImageData(img, 0, 0);
}

function renderC64Hires(ctx, gfx) {
  ctx.canvas.width = 320; ctx.canvas.height = 200;
  var img = ctx.createImageData(320, 200);
  var px = img.data;

  for (var cellRow = 0; cellRow < 25; cellRow++) {
    for (var cellCol = 0; cellCol < 40; cellCol++) {
      var cellIdx = cellRow * 40 + cellCol;
      var fgColor = C64_RGB[(gfx.scr[cellIdx] >> 4) & 0x0F];
      var bgColor = C64_RGB[gfx.scr[cellIdx] & 0x0F];

      for (var line = 0; line < 8; line++) {
        var byt = gfx.bm[cellIdx * 8 + line];
        var y = cellRow * 8 + line;
        for (var bit = 7; bit >= 0; bit--) {
          var rgb = (byt & (1 << bit)) ? fgColor : bgColor;
          var x = cellCol * 8 + (7 - bit);
          var off = (y * 320 + x) * 4;
          px[off] = rgb[0]; px[off+1] = rgb[1]; px[off+2] = rgb[2]; px[off+3] = 255;
        }
      }
    }
  }
  ctx.putImageData(img, 0, 0);
}

function renderC64FLI(ctx, gfx) {
  ctx.canvas.width = 320; ctx.canvas.height = 200;
  var img = ctx.createImageData(320, 200);
  var px = img.data;
  var bg = C64_RGB[(gfx.bg || 0) & 0x0F];

  for (var cellRow = 0; cellRow < 25; cellRow++) {
    for (var cellCol = 0; cellCol < 40; cellCol++) {
      var cellIdx = cellRow * 40 + cellCol;
      var colLo = gfx.col[cellIdx] & 0x0F;

      for (var line = 0; line < 8; line++) {
        var scrByte = gfx.scrBanks[line * 1024 + cellIdx];
        var scrHi = (scrByte >> 4) & 0x0F;
        var scrLo = scrByte & 0x0F;
        var colors = [bg, C64_RGB[scrHi], C64_RGB[scrLo], C64_RGB[colLo]];

        // FLI bug: first 3 columns show background
        if (cellCol < 3) colors = [bg, bg, bg, bg];

        var byt = gfx.bm[cellIdx * 8 + line];
        var y = cellRow * 8 + line;
        for (var px2 = 0; px2 < 4; px2++) {
          var bits = (byt >> (6 - px2 * 2)) & 3;
          var rgb = colors[bits];
          var x = cellCol * 8 + px2 * 2;
          var off = (y * 320 + x) * 4;
          px[off] = rgb[0]; px[off+1] = rgb[1]; px[off+2] = rgb[2]; px[off+3] = 255;
          px[off+4] = rgb[0]; px[off+5] = rgb[1]; px[off+6] = rgb[2]; px[off+7] = 255;
        }
      }
    }
  }
  ctx.putImageData(img, 0, 0);
}

function renderC64AFLI(ctx, gfx) {
  ctx.canvas.width = 320; ctx.canvas.height = 200;
  var img = ctx.createImageData(320, 200);
  var px = img.data;

  for (var cellRow = 0; cellRow < 25; cellRow++) {
    for (var cellCol = 0; cellCol < 40; cellCol++) {
      var cellIdx = cellRow * 40 + cellCol;

      for (var line = 0; line < 8; line++) {
        var scrByte = gfx.scrBanks[line * 1024 + cellIdx];
        var fgColor = C64_RGB[(scrByte >> 4) & 0x0F];
        var bgColor = C64_RGB[scrByte & 0x0F];

        if (cellCol < 3) { fgColor = C64_RGB[0]; bgColor = C64_RGB[0]; }

        var byt = gfx.bm[cellIdx * 8 + line];
        var y = cellRow * 8 + line;
        for (var bit = 7; bit >= 0; bit--) {
          var rgb = (byt & (1 << bit)) ? fgColor : bgColor;
          var x = cellCol * 8 + (7 - bit);
          var off = (y * 320 + x) * 4;
          px[off] = rgb[0]; px[off+1] = rgb[1]; px[off+2] = rgb[2]; px[off+3] = 255;
        }
      }
    }
  }
  ctx.putImageData(img, 0, 0);
}

// colors = { bg, fg, mc1, mc2 } — color indices 0-15
function renderC64Sprites(ctx, gfx, multicolor, colors) {
  var count = gfx.count;
  var cols = Math.min(count, 8);
  var rows = Math.ceil(count / cols);
  var sprW = 24; // always 24px wide — MC uses double-wide pixels
  var w = cols * (sprW + 1) - 1;
  var h = rows * 22 - 1;
  ctx.canvas.width = w;
  ctx.canvas.height = h;
  var img = ctx.createImageData(w, h);
  var px = img.data;
  for (var fi = 3; fi < px.length; fi += 4) px[fi] = 255;
  var bgRgb = C64_RGB[colors.bg];
  var fgRgb = C64_RGB[colors.fg];
  var mc1Rgb = C64_RGB[colors.mc1];
  var mc2Rgb = C64_RGB[colors.mc2];

  for (var si = 0; si < count; si++) {
    var col = si % cols;
    var row = Math.floor(si / cols);
    var xOff = col * (sprW + 1);
    var yOff = row * 22;
    var base = si * 64;
    for (var line = 0; line < 21; line++) {
      for (var byteIdx = 0; byteIdx < 3; byteIdx++) {
        var byt = gfx.bm[base + line * 3 + byteIdx];
        if (multicolor) {
          for (var px2 = 0; px2 < 4; px2++) {
            var bits = (byt >> (6 - px2 * 2)) & 3;
            var rgb = bits === 0 ? bgRgb : bits === 1 ? mc1Rgb : bits === 2 ? fgRgb : mc2Rgb;
            var y = yOff + line;
            for (var dx = 0; dx < 2; dx++) {
              var x = xOff + byteIdx * 8 + px2 * 2 + dx;
              if (x < w && y < h) {
                var off = (y * w + x) * 4;
                px[off] = rgb[0]; px[off+1] = rgb[1]; px[off+2] = rgb[2];
              }
            }
          }
        } else {
          for (var bit = 7; bit >= 0; bit--) {
            var rgb2 = (byt & (1 << bit)) ? fgRgb : bgRgb;
            var x2 = xOff + byteIdx * 8 + (7 - bit);
            var y2 = yOff + line;
            if (x2 < w && y2 < h) {
              var off2 = (y2 * w + x2) * 4;
              px[off2] = rgb2[0]; px[off2+1] = rgb2[1]; px[off2+2] = rgb2[2];
            }
          }
        }
      }
    }
  }
  ctx.putImageData(img, 0, 0);
}

// colors = { bg, fg, mc1, mc2 }, multicolor flag
// Map an ASCII uppercase letter / digit / punctuation to a C64 screen code.
// Assumes the default uppercase+graphics charset. Unknown codes return space.
function asciiToC64ScreenCode(code) {
  if (code >= 0x41 && code <= 0x5A) return code - 0x40;        // A-Z -> $01-$1A
  if (code >= 0x61 && code <= 0x7A) return code - 0x60;        // a-z fallback -> $01-$1A
  if (code >= 0x30 && code <= 0x39) return code;                // 0-9 -> $30-$39
  if (code === 0x20 || code === 0x2E || code === 0x2C || code === 0x21 ||
      code === 0x3F || code === 0x27 || code === 0x22) return code; // common punctuation
  return 0x20;                                                  // space
}

function renderC64Charset(ctx, gfx, tileW, tileH, colors, multicolor) {
  tileW = tileW || 1;
  tileH = tileH || 1;
  var numChars = gfx.count;
  // C64 charset tile convention: 256-char set = 4 banks of 64 ($00-$3F, $40-$7F, $80-$BF, $C0-$FF).
  // Tiles use banks linearly: 1x2 'A' = $01 top, $41 bottom; 2x1 'A' = $01 $41;
  // 2x2 'A' = $01 $41 top, $81 $C1 bottom.
  // For larger charsets, tiles repeat across bank sets (e.g. 1x2 with 256 chars = 128 tiles).
  var banksPerTile = tileW * tileH;
  var numTiles;
  if (tileW <= 1 && tileH <= 1) {
    numTiles = numChars;
  } else {
    numTiles = Math.floor(numChars / (banksPerTile * 64)) * 64;
  }
  var tilePxW = tileW * 8;
  var tilePxH = tileH * 8;
  var cellGap = 2;
  var cellW = tilePxW + cellGap;
  var cellH = tilePxH + cellGap;
  var gridTargetW = 320;
  var gridCols = Math.max(1, Math.floor(gridTargetW / cellW));
  if (gridCols > numTiles) gridCols = numTiles;
  var gridRows = Math.ceil(numTiles / gridCols);
  var gridW = gridCols * cellW - cellGap;
  var gridH = gridRows * cellH - cellGap;

  var sampleText = 'THE QUICK BROWN FOX JUMPS OVER THE LAZY DOG 1234567890';
  var sampleCodes = [];
  for (var si = 0; si < sampleText.length; si++) {
    sampleCodes.push(asciiToC64ScreenCode(sampleText.charCodeAt(si)));
  }
  // In multi-tile modes (1x2 / 2x1 / 2x2) each letter is a composite of
  // tileW*tileH chars, so the sample text is drawn at the full tile size
  // (same as the grid) to stay readable.
  var sampleW = sampleCodes.length * tilePxW;
  var sampleH = tilePxH;

  var sideMargin = 6;
  var sampleGap = 10;
  var canvasW = Math.max(sampleW, gridW) + sideMargin * 2;
  var canvasH = sideMargin + sampleH + sampleGap + gridH + sideMargin;
  if (canvasW < 1 || canvasH < 1) return;
  ctx.canvas.width = canvasW;
  ctx.canvas.height = canvasH;

  var img = ctx.createImageData(canvasW, canvasH);
  var pxBuf = img.data;
  var bgRgb = C64_RGB[colors.bg];
  var fgRgb = C64_RGB[colors.fg];
  var mc1Rgb = C64_RGB[colors.mc1];
  var mc2Rgb = C64_RGB[colors.mc2];
  // Fill with the background colour so unmapped areas (e.g. sample text
  // characters that aren't present in short charsets) stay consistent.
  for (var fi = 0; fi < pxBuf.length; fi += 4) {
    pxBuf[fi] = bgRgb[0]; pxBuf[fi+1] = bgRgb[1]; pxBuf[fi+2] = bgRgb[2]; pxBuf[fi+3] = 255;
  }

  // Draw a single 8x8 char at (ox, oy) in the ImageData buffer.
  function drawChar(charIdx, ox, oy) {
    if (charIdx < 0 || charIdx >= numChars) return;
    var base = charIdx * 8;
    for (var line = 0; line < 8; line++) {
      var byt = gfx.bm[base + line];
      if (multicolor) {
        for (var p2 = 0; p2 < 4; p2++) {
          var bits = (byt >> (6 - p2 * 2)) & 3;
          var rgb = bits === 0 ? bgRgb : bits === 1 ? mc1Rgb : bits === 2 ? fgRgb : mc2Rgb;
          var y = oy + line;
          for (var dx = 0; dx < 2; dx++) {
            var x = ox + p2 * 2 + dx;
            if (x >= 0 && x < canvasW && y >= 0 && y < canvasH) {
              var off = (y * canvasW + x) * 4;
              pxBuf[off] = rgb[0]; pxBuf[off+1] = rgb[1]; pxBuf[off+2] = rgb[2];
            }
          }
        }
      } else {
        for (var bit = 7; bit >= 0; bit--) {
          var rgb2 = (byt & (1 << bit)) ? fgRgb : bgRgb;
          var x2 = ox + (7 - bit);
          var y2 = oy + line;
          if (x2 >= 0 && x2 < canvasW && y2 >= 0 && y2 < canvasH) {
            var off2 = (y2 * canvasW + x2) * 4;
            pxBuf[off2] = rgb2[0]; pxBuf[off2+1] = rgb2[1]; pxBuf[off2+2] = rgb2[2];
          }
        }
      }
    }
  }

  // Draw a full tile (tileW * tileH chars) for the given screen code at
  // (ox, oy). Matches the grid's char-index mapping so the sample text
  // reads correctly in 1x2 / 2x1 / 2x2 modes.
  function drawTileAtCode(screenCode, ox, oy) {
    for (var cy = 0; cy < tileH; cy++) {
      for (var cx = 0; cx < tileW; cx++) {
        var charIdx = screenCode + (cy * tileW + cx) * 64;
        if (charIdx >= numChars) continue;
        drawChar(charIdx, ox + cx * 8, oy + cy * 8);
      }
    }
  }

  // Sample text at the top, using the current tile size so multi-tile letters
  // (1x2 / 2x1 / 2x2) are assembled correctly.
  for (var ti0 = 0; ti0 < sampleCodes.length; ti0++) {
    drawTileAtCode(sampleCodes[ti0], sideMargin + ti0 * tilePxW, sideMargin);
  }

  // Grid of all tiles.
  var gridTop = sideMargin + sampleH + sampleGap;
  for (var ti = 0; ti < numTiles; ti++) {
    var gc = ti % gridCols;
    var gr = Math.floor(ti / gridCols);
    var tileXOff = sideMargin + gc * cellW;
    var tileYOff = gridTop + gr * cellH;
    for (var cy = 0; cy < tileH; cy++) {
      for (var cx = 0; cx < tileW; cx++) {
        var setIdx = Math.floor(ti / 64);
        var localTi = ti % 64;
        var charIdx = localTi + setIdx * banksPerTile * 64 + (cy * tileW + cx) * 64;
        if (charIdx >= numChars) continue;
        drawChar(charIdx, tileXOff + cx * 8, tileYOff + cy * 8);
      }
    }
  }
  ctx.putImageData(img, 0, 0);
}

function renderC64PrintShop(ctx, gfx) {
  var w = gfx.width || 88;
  var h = gfx.height || 52;
  var bpr = gfx.bytesPerRow || 11;
  ctx.canvas.width = w;
  ctx.canvas.height = h;
  var img = ctx.createImageData(w, h);
  var px = img.data;
  var fg = C64_RGB[0]; // black
  var bg = C64_RGB[1]; // white

  for (var y = 0; y < h && y * bpr < gfx.bm.length; y++) {
    for (var x = 0; x < w; x++) {
      var byteIdx = y * bpr + Math.floor(x / 8);
      var bitIdx = 7 - (x % 8);
      var set = byteIdx < gfx.bm.length && (gfx.bm[byteIdx] & (1 << bitIdx));
      var rgb = set ? fg : bg;
      var off = (y * w + x) * 4;
      px[off] = rgb[0]; px[off+1] = rgb[1]; px[off+2] = rgb[2]; px[off+3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
}

function renderGfxToCanvas(ctx, fmt, fileData, colors) {
  // GEOS formats use VLIR, handled separately
  if (fmt.mode === 'geopaint') { renderGeoPaint(ctx, fmt.geosEntry); return; }
  if (fmt.mode === 'geoscrap') { renderGeoScrap(ctx, fmt.geosEntry); return; }
  if (fmt.mode === 'geosalbum') { renderGeoAlbum(ctx, fmt.geosEntry); return; }
  if (fmt.mode === 'geoswrite') { renderGeoWrite(ctx, fmt.geosEntry); return; }
  if (fmt.mode === 'geosfont') { renderGeosFont(ctx, fmt.geosEntry); return; }

  var parser = GFX_PARSERS[fmt.layout];
  if (!parser) return;
  var gfx = parser(fileData);

  // Apply background color override for bitmap modes
  if (colors && colors.bg !== undefined && (fmt.mode === 'mc' || fmt.layout === 'drp' || fmt.layout === 'drazlace')) {
    gfx.bg = colors.bg;
    if (gfx.rowBg) {
      gfx.rowBg = new Uint8Array(gfx.rowBg.length);
      for (var ri = 0; ri < gfx.rowBg.length; ri++) gfx.rowBg[ri] = colors.bg;
    }
  }

  var mode = fmt.mode;
  // Parse tile dimensions and MC flag from mode string
  var isMC = mode.indexOf('-mc') >= 0 || mode === 'sprites-mc';
  var tileMatch = mode.match(/(\d+)x(\d+)/);
  var tileW = tileMatch ? parseInt(tileMatch[1]) : 1;
  var tileH = tileMatch ? parseInt(tileMatch[2]) : 1;

  if (mode === 'sprites' || mode === 'sprites-mc') {
    renderC64Sprites(ctx, gfx, mode === 'sprites-mc', colors);
  } else if (mode.indexOf('charset') === 0) {
    renderC64Charset(ctx, gfx, tileW, tileH, colors, isMC);
  } else if (fmt.mode === 'printshop') {
    renderC64PrintShop(ctx, gfx);
  } else if (fmt.layout === 'drp' || fmt.layout === 'drazlace') {
    renderC64MulticolorDrp(ctx, gfx);
  } else if (fmt.mode === 'mc') {
    renderC64Multicolor(ctx, gfx);
  } else if (fmt.mode === 'hires') {
    renderC64Hires(ctx, gfx);
  } else if (fmt.mode === 'fli') {
    renderC64FLI(ctx, gfx);
  } else if (fmt.mode === 'afli') {
    renderC64AFLI(ctx, gfx);
  }
}

function showFileGfxViewer(entryOff) {
  if (!currentBuffer) return;
  var data = new Uint8Array(currentBuffer);
  var result = readFileData(currentBuffer, entryOff);
  var fileData = result.data;
  var name = petsciiToReadable(readPetsciiString(data, entryOff + 5, 16)).trim();

  // Check for GEOS graphics first, then standard formats
  var geosMatches = detectGeosGfxFormats(entryOff);
  var matches = geosMatches.concat(detectGfxFormats(fileData));
  if (matches.length === 0) {
    showModal('Graphics View', ['Unrecognized graphics format (' + fileData.length + ' bytes).']);
    return;
  }

  // Separate MC variants from base formats — MC becomes a toggle for sprites/charsets
  var mcToggleModes = {}; // base mode → mc mode
  var baseMatches = [];
  for (var mi2 = 0; mi2 < matches.length; mi2++) {
    var m = matches[mi2];
    // Sprite/charset MC variants become toggles, bitmap 'mc' stays as separate format
    if (m.mode !== 'mc' && (m.mode.indexOf('charset-mc') === 0 || m.mode === 'sprites-mc')) {
      var baseMode = m.mode.replace('-mc', '');
      mcToggleModes[baseMode] = m.mode;
    } else {
      baseMatches.push(m);
    }
  }
  var displayMatches = baseMatches;
  var hasMcToggle = false;
  for (var mi3 = 0; mi3 < displayMatches.length; mi3++) {
    if (mcToggleModes[displayMatches[mi3].mode]) { hasMcToggle = true; break; }
  }

  var activeFmt = displayMatches[0] || matches[0];
  var mcEnabled = false;
  var currentZoom = 0; // 0 = auto-detect on first render
  // Color state for sprites/charset/bitmap
  var gfxColors = { bg: 0, fg: 1, mc1: 2, mc2: 3 };

  function getEffectiveFmt() {
    if (mcEnabled && mcToggleModes[activeFmt.mode]) {
      // Find the MC match object
      for (var ei = 0; ei < matches.length; ei++) {
        if (matches[ei].mode === mcToggleModes[activeFmt.mode] && matches[ei].layout === activeFmt.layout) return matches[ei];
      }
    }
    return activeFmt;
  }

  // For multicolor bitmaps, try to read bg from file
  var needsColorPicker = false;
  var colorLabels = null;

  function updateColorContext() {
    var eff = getEffectiveFmt();
    var mode = eff.mode;
    if (mode === 'mc' || eff.layout === 'drp' || eff.layout === 'drazlace') {
      needsColorPicker = true;
      colorLabels = [{ key: 'bg', label: 'Background' }];
      var parser = GFX_PARSERS[eff.layout];
      if (parser) {
        var gfx = parser(fileData);
        if (gfx.bg !== undefined) gfxColors.bg = gfx.bg & 0x0F;
      }
    } else if (mode.indexOf('sprite') >= 0 || mode.indexOf('charset') >= 0) {
      needsColorPicker = true;
      var isMC = mode.indexOf('-mc') >= 0 || mode === 'sprites-mc';
      colorLabels = [{ key: 'bg', label: 'BG' }, { key: 'fg', label: 'FG' }];
      if (isMC) {
        colorLabels.push({ key: 'mc1', label: 'MC1' });
        colorLabels.push({ key: 'mc2', label: 'MC2' });
      }
    } else {
      needsColorPicker = false;
      colorLabels = null;
    }
  }

  updateColorContext();

  var C64_COLOR_NAMES = [
    'Black', 'White', 'Red', 'Cyan', 'Purple', 'Green',
    'Blue', 'Yellow', 'Orange', 'Brown', 'Light Red', 'Dark Grey',
    'Grey', 'Light Green', 'Light Blue', 'Light Grey'
  ];

  function buildColorPicker(body) {
    if (!needsColorPicker || !colorLabels) return;
    var row = document.createElement('div');
    row.className = 'color-picker-row';

    for (var li = 0; li < colorLabels.length; li++) {
      (function(lbl) {
        var group = document.createElement('div');
        group.className = 'color-picker-group';
        var label = document.createElement('span');
        label.textContent = lbl.label + ':';
        label.className = 'color-picker-label';
        group.appendChild(label);

        var btn = document.createElement('button');
        btn.className = 'color-dropdown-btn';
        var curColor = gfxColors[lbl.key];
        btn.innerHTML = '<span class="color-dropdown-swatch" style="background:' + C64_COLORS[curColor] + '"></span>' +
          '<span class="color-dropdown-name">' + C64_COLOR_NAMES[curColor] + '</span>';
        group.appendChild(btn);

        var popup = document.createElement('div');
        popup.className = 'color-dropdown-popup';
        for (var ci = 0; ci < 16; ci++) {
          (function(colorIdx) {
            var opt = document.createElement('div');
            opt.className = 'color-dropdown-opt' + (colorIdx === curColor ? ' active' : '');
            opt.innerHTML = '<span class="color-dropdown-swatch" style="background:' + C64_COLORS[colorIdx] + '"></span>' +
              '<span class="color-dropdown-name">' + C64_COLOR_NAMES[colorIdx] + '</span>';
            opt.addEventListener('click', function(ev) {
              ev.stopPropagation();
              gfxColors[lbl.key] = colorIdx;
              render();
            });
            popup.appendChild(opt);
          })(ci);
        }
        group.appendChild(popup);

        btn.addEventListener('click', function(ev) {
          ev.stopPropagation();
          var wasOpen = popup.classList.contains('open');
          // Close all other popups
          body.querySelectorAll('.color-dropdown-popup.open').forEach(function(p) { p.classList.remove('open'); });
          if (!wasOpen) popup.classList.add('open');
        });

        row.appendChild(group);
      })(colorLabels[li]);
    }
    body.appendChild(row);

    // Close popups when clicking elsewhere in the modal
    body.addEventListener('click', function() {
      body.querySelectorAll('.color-dropdown-popup.open').forEach(function(p) { p.classList.remove('open'); });
    });
  }

  function render() {
    var eff = getEffectiveFmt();
    document.getElementById('modal-title').textContent = eff.name + ' \u2014 "' + name + '" (' + (fileData.length - 2) + ' bytes)';
    var body = document.getElementById('modal-body');
    body.innerHTML = '';

    // Format selector + MC toggle
    var showSelector = displayMatches.length > 1 || hasMcToggle;
    if (showSelector) {
      var sel = document.createElement('div');
      sel.className = 'flex-row-wrap mb-md';

      if (displayMatches.length > 1) {
        for (var mi = 0; mi < displayMatches.length; mi++) {
          (function(m) {
            var btn = document.createElement('button');
            btn.textContent = m.name;
            btn.className = 'btn-small' + (m === activeFmt ? ' active' : '');
            btn.addEventListener('click', function() {
              activeFmt = m;
              updateColorContext();
              render();
            });
            sel.appendChild(btn);
          })(displayMatches[mi]);
        }
      }

      // MC toggle for sprite/charset modes
      if (hasMcToggle && mcToggleModes[activeFmt.mode]) {
        var mcBtn = document.createElement('button');
        mcBtn.textContent = 'Multicolor';
        mcBtn.className = 'btn-small' + (mcEnabled ? ' active' : '');
        mcBtn.addEventListener('click', function() {
          mcEnabled = !mcEnabled;
          updateColorContext();
          render();
        });
        sel.appendChild(mcBtn);
      }

      body.appendChild(sel);
    }

    var canvas = document.createElement('canvas');
    canvas.className = 'gfx-canvas';
    renderGfxToCanvas(canvas.getContext('2d'), eff, fileData, gfxColors);

    // Auto scale based on format
    if (!currentZoom) {
      if (eff.mode === 'geopaint') {
        currentZoom = 1;
      } else if (eff.mode === 'printshop') {
        currentZoom = 4;
      } else if (eff.mode.indexOf('sprite') >= 0 || eff.mode.indexOf('charset') >= 0) {
        currentZoom = Math.max(2, Math.min(5, Math.floor(600 / (canvas.width || 1))));
      } else {
        currentZoom = 2;
      }
    }
    canvas.style.width = (canvas.width * currentZoom) + 'px';
    canvas.style.height = (canvas.height * currentZoom) + 'px';
    body.appendChild(canvas);

    // Zoom dropdown
    var zoomRow = document.createElement('div');
    zoomRow.className = 'gfx-zoom-row';
    var zoomLabel = document.createElement('span');
    zoomLabel.className = 'color-picker-label';
    zoomLabel.textContent = 'Zoom:';
    zoomRow.appendChild(zoomLabel);

    var zoomGroup = document.createElement('div');
    zoomGroup.className = 'color-picker-group';
    var zoomBtn = document.createElement('button');
    zoomBtn.className = 'color-dropdown-btn';
    zoomBtn.textContent = currentZoom + 'x';
    zoomGroup.appendChild(zoomBtn);

    var zoomPopup = document.createElement('div');
    zoomPopup.className = 'color-dropdown-popup';
    for (var zi = 1; zi <= 5; zi++) {
      (function(z) {
        var opt = document.createElement('div');
        opt.className = 'color-dropdown-opt' + (z === currentZoom ? ' active' : '');
        opt.textContent = z + 'x';
        opt.addEventListener('click', function(ev) {
          ev.stopPropagation();
          currentZoom = z;
          canvas.style.width = (canvas.width * z) + 'px';
          canvas.style.height = (canvas.height * z) + 'px';
          zoomBtn.textContent = z + 'x';
          zoomPopup.classList.remove('open');
        });
        zoomPopup.appendChild(opt);
      })(zi);
    }
    zoomGroup.appendChild(zoomPopup);

    zoomBtn.addEventListener('click', function(ev) {
      ev.stopPropagation();
      var wasOpen = zoomPopup.classList.contains('open');
      body.querySelectorAll('.color-dropdown-popup.open').forEach(function(p) { p.classList.remove('open'); });
      if (!wasOpen) zoomPopup.classList.add('open');
    });

    zoomRow.appendChild(zoomGroup);
    body.appendChild(zoomRow);

    buildColorPicker(body);
  }

  render();

  var footer = document.querySelector('#modal-overlay .modal-footer');
  footer.className = 'modal-footer modal-footer-split';

  var safeName = name.replace(/[<>:"/\\|?*\x00-\x1F]/g, '_') || 'image';

  function getCanvas() {
    return document.querySelector('#modal-body .gfx-canvas');
  }

  function downloadBlob(blob, filename) {
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  function savePng() {
    var c = getCanvas();
    if (!c) return;
    c.toBlob(function(blob) { downloadBlob(blob, safeName + '.png'); }, 'image/png');
  }

  function saveJpg() {
    var c = getCanvas();
    if (!c) return;
    c.toBlob(function(blob) { downloadBlob(blob, safeName + '.jpg'); }, 'image/jpeg', 0.95);
  }

  function saveGif() {
    var c = getCanvas();
    if (!c) return;
    var w = c.width, h = c.height;
    var px = c.getContext('2d').getImageData(0, 0, w, h).data;
    // Build indexed palette from canvas pixels (C64 images have ≤16 colors)
    var palette = [], colorIdx = {};
    for (var i = 0; i < px.length; i += 4) {
      var key = (px[i] << 16) | (px[i + 1] << 8) | px[i + 2];
      if (colorIdx[key] === undefined) {
        colorIdx[key] = palette.length;
        palette.push(key);
      }
    }
    // GIF needs power-of-2 palette; find minimum size
    var bits = 1;
    while ((1 << bits) < palette.length) bits++;
    var palSize = 1 << bits;
    // Pad palette to power-of-2
    while (palette.length < palSize) palette.push(0);
    // Build indexed pixel data
    var indices = new Uint8Array(w * h);
    for (var p = 0; p < w * h; p++) {
      var k = (px[p * 4] << 16) | (px[p * 4 + 1] << 8) | px[p * 4 + 2];
      indices[p] = colorIdx[k];
    }
    // GIF LZW compression (variable-length code output)
    var minCode = Math.max(2, bits);
    var clearCode = 1 << minCode;
    var eoiCode = clearCode + 1;
    var codeSize = minCode + 1;
    var nextCode = eoiCode + 1;
    var maxCode = 1 << codeSize;
    var table = {};
    var buffer = [], bitBuf = 0, bitPos = 0;
    function emit(code) {
      bitBuf |= code << bitPos;
      bitPos += codeSize;
      while (bitPos >= 8) { buffer.push(bitBuf & 0xFF); bitBuf >>= 8; bitPos -= 8; }
    }
    function resetTable() {
      table = {};
      for (var t = 0; t < clearCode; t++) table[String(t)] = t;
      codeSize = minCode + 1;
      nextCode = eoiCode + 1;
      maxCode = 1 << codeSize;
    }
    resetTable();
    emit(clearCode);
    var prev = String(indices[0]);
    for (var gi = 1; gi < indices.length; gi++) {
      var cur = String(indices[gi]);
      var combined = prev + ',' + cur;
      if (table[combined] !== undefined) {
        prev = combined;
      } else {
        emit(table[prev]);
        if (nextCode < 4096) {
          table[combined] = nextCode++;
          if (nextCode > maxCode && codeSize < 12) { codeSize++; maxCode = 1 << codeSize; }
        } else {
          emit(clearCode);
          resetTable();
        }
        prev = cur;
      }
    }
    emit(table[prev]);
    emit(eoiCode);
    if (bitPos > 0) buffer.push(bitBuf & 0xFF);
    // Build sub-blocks (max 255 bytes each)
    var subBlocks = [];
    for (var sb = 0; sb < buffer.length; sb += 255) {
      var chunk = buffer.slice(sb, sb + 255);
      subBlocks.push(chunk.length);
      for (var ci = 0; ci < chunk.length; ci++) subBlocks.push(chunk[ci]);
    }
    subBlocks.push(0); // block terminator
    // Assemble GIF87a binary
    var gif = [];
    function writeStr(s) { for (var si = 0; si < s.length; si++) gif.push(s.charCodeAt(si)); }
    function writeU16(v) { gif.push(v & 0xFF); gif.push((v >> 8) & 0xFF); }
    writeStr('GIF89a');
    writeU16(w); writeU16(h);
    gif.push(0x80 | ((bits - 1) << 4) | (bits - 1)); // GCT flag + color resolution + GCT size
    gif.push(0); // bg color index
    gif.push(0); // pixel aspect ratio
    // Global Color Table
    for (var gc = 0; gc < palSize; gc++) {
      gif.push((palette[gc] >> 16) & 0xFF);
      gif.push((palette[gc] >> 8) & 0xFF);
      gif.push(palette[gc] & 0xFF);
    }
    // Image Descriptor
    gif.push(0x2C);
    writeU16(0); writeU16(0); writeU16(w); writeU16(h);
    gif.push(0); // no local color table
    gif.push(minCode); // LZW minimum code size
    for (var sbi = 0; sbi < subBlocks.length; sbi++) gif.push(subBlocks[sbi]);
    gif.push(0x3B); // trailer
    downloadBlob(new Blob([new Uint8Array(gif)], { type: 'image/gif' }), safeName + '.gif');
  }

  function saveSvg() {
    var c = getCanvas();
    if (!c) return;
    var w = c.width, h = c.height;
    var px = c.getContext('2d').getImageData(0, 0, w, h).data;
    var colorRuns = {};
    for (var y = 0; y < h; y++) {
      for (var x = 0; x < w; x++) {
        var off = (y * w + x) * 4;
        if (px[off + 3] === 0) continue;
        var hex = '#' +
          ('0' + px[off].toString(16)).slice(-2) +
          ('0' + px[off + 1].toString(16)).slice(-2) +
          ('0' + px[off + 2].toString(16)).slice(-2);
        if (!colorRuns[hex]) colorRuns[hex] = [];
        colorRuns[hex].push(x + ',' + y);
      }
    }
    var parts = ['<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + w + ' ' + h +
      '" width="' + w + '" height="' + h + '" shape-rendering="crispEdges">'];
    var colors = Object.keys(colorRuns);
    for (var ci = 0; ci < colors.length; ci++) {
      var col = colors[ci];
      var coords = colorRuns[col];
      parts.push('<g fill="' + col + '">');
      for (var pi = 0; pi < coords.length; pi++) {
        var xy = coords[pi].split(',');
        parts.push('<rect x="' + xy[0] + '" y="' + xy[1] + '" width="1" height="1"/>');
      }
      parts.push('</g>');
    }
    parts.push('</svg>');
    downloadBlob(new Blob([parts.join('')], { type: 'image/svg+xml' }), safeName + '.svg');
  }

  var formats = [
    { label: 'PNG', save: savePng },
    { label: 'JPG', save: saveJpg },
    { label: 'GIF', save: saveGif },
    { label: 'SVG', save: saveSvg }
  ];
  var currentFormat = formats[0];

  // Split button: main click saves in current format; arrow opens dropdown of other formats
  var wrap = document.createElement('div');
  wrap.className = 'dropdown-btn-wrap';

  var mainBtn = document.createElement('button');
  mainBtn.className = 'dropdown-btn-main';
  mainBtn.textContent = 'Save as ' + currentFormat.label;
  mainBtn.addEventListener('click', function() {
    currentFormat.save();
  });

  var arrowBtn = document.createElement('button');
  arrowBtn.className = 'dropdown-btn-arrow';
  arrowBtn.innerHTML = '\u25be';

  var menu = document.createElement('div');
  menu.className = 'dropdown-btn-menu';

  function rebuildMenu() {
    menu.innerHTML = '';
    for (var fi = 0; fi < formats.length; fi++) {
      (function(fmt) {
        if (fmt === currentFormat) return;
        var item = document.createElement('div');
        item.className = 'dropdown-btn-menu-item';
        item.textContent = 'Save as ' + fmt.label;
        item.addEventListener('click', function() {
          menu.classList.remove('open');
          currentFormat = fmt;
          mainBtn.textContent = 'Save as ' + fmt.label;
          rebuildMenu();
          fmt.save();
        });
        menu.appendChild(item);
      })(formats[fi]);
    }
  }
  rebuildMenu();

  wrap.appendChild(mainBtn);
  wrap.appendChild(arrowBtn);
  wrap.appendChild(menu);

  arrowBtn.addEventListener('click', function(ev) {
    ev.stopPropagation();
    menu.classList.toggle('open');
  });
  document.addEventListener('click', function() {
    menu.classList.remove('open');
  });

  footer.innerHTML = '';
  var actionsDiv = document.createElement('div');
  actionsDiv.className = 'modal-footer-actions';
  actionsDiv.appendChild(wrap);
  // GEOS fonts: offer export to a raw C64 charset binary, with per-size tile
  // detection (1x1 / 2x1 / 1x2 / 2x2 of 8x8 C64 character cells).
  if (activeFmt.mode === 'geosfont') {
    var charsetBtn = document.createElement('button');
    charsetBtn.className = 'modal-btn-secondary';
    charsetBtn.textContent = 'Export C64 Charset\u2026';
    charsetBtn.addEventListener('click', function() {
      showGeosFontCharsetExport(activeFmt.geosEntry);
    });
    actionsDiv.appendChild(charsetBtn);
  }
  footer.appendChild(actionsDiv);

  var navDiv = document.createElement('div');
  navDiv.className = 'modal-footer-nav';
  var okBtn = document.createElement('button');
  okBtn.id = 'modal-close';
  okBtn.textContent = 'OK';
  okBtn.addEventListener('click', function() {
    footer.className = 'modal-footer';
    document.getElementById('modal-overlay').classList.remove('open');
  });
  navDiv.appendChild(okBtn);
  footer.appendChild(navDiv);

  setModalSize('xl');
  document.getElementById('modal-overlay').classList.add('open');
}

// ── REL file viewer ──────────────────────────────────────────────────
function showRelViewer(entryOff) {
  if (!currentBuffer) return;
  var data = new Uint8Array(currentBuffer);
  var name = petsciiToReadable(readPetsciiString(data, entryOff + 5, 16)).trim();
  var recordLen = data[entryOff + 0x1C]; // record length from dir entry
  if (recordLen === 0) recordLen = 254;

  // Read file data (follows the data chain)
  var result = readFileData(currentBuffer, entryOff);
  var fileData = result.data;
  if (fileData.length === 0) {
    showModal('REL View', ['No data found or empty file.']);
    return;
  }

  // Split into records
  var numRecords = Math.ceil(fileData.length / recordLen);
  var html = '<div style="overflow-y:auto">';

  for (var ri = 0; ri < numRecords; ri++) {
    var recStart = ri * recordLen;
    var recEnd = Math.min(recStart + recordLen, fileData.length);
    if (recStart >= fileData.length) break;

    html += '<div class="rel-record">';
    html += '<span class="rel-record-num">#' + (ri + 1) + '</span>';

    // Hex bytes
    var hexStr = '';
    var asciiStr = '';
    for (var bi = recStart; bi < recEnd; bi++) {
      var b = fileData[bi];
      hexStr += b.toString(16).toUpperCase().padStart(2, '0') + ' ';
      asciiStr += (b >= 0x20 && b <= 0x7E) ? String.fromCharCode(b) :
        (b >= 0xC1 && b <= 0xDA) ? String.fromCharCode(b - 0x80) : '\u00B7';
    }

    html += '<span class="rel-record-hex">' + escHtml(hexStr.trim()) + '</span>';
    html += '<span class="rel-record-ascii">' + escHtml(asciiStr) + '</span>';
    html += '</div>';
  }
  html += '</div>';

  document.getElementById('modal-title').textContent =
    'REL Records \u2014 "' + name + '" (record length: ' + recordLen + ', ' + numRecords + ' records)';
  var body = document.getElementById('modal-body');
  body.innerHTML = html;

  var footer = document.querySelector('#modal-overlay .modal-footer');
  footer.innerHTML = '<button id="modal-close">OK</button>';
  document.getElementById('modal-close').addEventListener('click', function() {
    document.getElementById('modal-overlay').classList.remove('open');
  });
  document.getElementById('modal-overlay').classList.add('open');
}

// ── Turbo Assembler viewer ────────────────────────────────────────────
// 6502 mnemonics in alphabetical order (TASS token $30-$67)
var TASS_MNEMONICS = [
  'ADC','AND','ASL','BCC','BCS','BEQ','BIT','BMI','BNE','BPL', // $30-$39
  'BRK','BVC','BVS','CLC','CLD','CLI','CLV','CMP','CPX','CPY', // $3A-$43
  'DEC','DEX','DEY','EOR','INC','INX','INY','JMP','JSR','LDA', // $44-$4D
  'LDX','LDY','LSR','NOP','ORA','PHA','PHP','PLA','PLP','ROL', // $4E-$57
  'ROR','RTI','RTS','SBC','SEC','SED','SEI','STA','STX','STY', // $58-$61
  'TAX','TAY','TSX','TXA','TXS','TYA'                          // $62-$67
];

// Detect TASS source file: not BASIC, has TASS-like header with line padding pattern
function isTassSource(fileData) {
  if (!fileData || fileData.length < 100) return false;
  var addr = fileData[0] | (fileData[1] << 8);
  // TASS files don't load at standard BASIC addresses
  if (addr === 0x0801) return false;
  // Look for the .TEXT/.BYTE signatures that TASS embeds
  for (var i = 0x50; i < Math.min(fileData.length, 0x80); i++) {
    if (fileData[i] === 0x2E && i + 4 < fileData.length) {
      var str = String.fromCharCode(fileData[i+1], fileData[i+2], fileData[i+3], fileData[i+4]);
      if (str === 'TEXT' || str === 'BYTE') return true;
    }
  }
  // Check for $C0 padding pattern (line fill bytes)
  var c0Count = 0;
  for (var j = 0x100; j < Math.min(fileData.length, 0x300); j++) {
    if (fileData[j] === 0xC0) c0Count++;
  }
  if (c0Count > 50) return true;
  return false;
}

function showFileTassViewer(entryOff) {
  if (!currentBuffer) return;
  var data = new Uint8Array(currentBuffer);
  var result = readFileData(currentBuffer, entryOff);
  var fileData = result.data;
  var name = petsciiToReadable(readPetsciiString(data, entryOff + 5, 16)).trim();

  // TASS source: lines separated by $80, padded with $C0
  // Scan for line boundaries
  var lines = [];
  var lineStart = -1;

  // Find where source data begins (skip header, ~$100 area)
  var srcStart = 0x100;
  // Scan back from srcStart to find actual beginning
  for (var si = 0x5A; si < Math.min(fileData.length, 0x200); si++) {
    if (fileData[si] === 0x80 || (fileData[si] >= 0x30 && fileData[si] <= 0x67)) {
      srcStart = si;
      break;
    }
  }

  var currentLine = [];
  for (var pos = srcStart; pos < fileData.length; pos++) {
    var b = fileData[pos];

    if (b === 0x80) {
      // Line separator — flush current line
      if (currentLine.length > 0) lines.push(currentLine);
      currentLine = [];
      // Skip $C0 padding
      while (pos + 1 < fileData.length && fileData[pos + 1] === 0xC0) pos++;
      continue;
    }

    if (b === 0xC0) continue; // padding within line

    if (b === 0x00) {
      // End of meaningful data in this region
      if (currentLine.length > 0) lines.push(currentLine);
      currentLine = [];
      // Skip zero block
      while (pos + 1 < fileData.length && fileData[pos + 1] === 0x00) pos++;
      continue;
    }

    currentLine.push(b);
  }
  if (currentLine.length > 0) lines.push(currentLine);

  // Render lines
  var html = '<div class="basic-listing">';

  if (lines.length === 0) {
    html += '<div class="basic-line">No source lines found.</div>';
  }

  for (var li = 0; li < lines.length; li++) {
    var line = lines[li];
    html += '<div class="basic-line">';

    var lineText = '';
    for (var bi = 0; bi < line.length; bi++) {
      var byte = line[bi];

      // TASS mnemonic token ($30-$67)
      if (byte >= 0x30 && byte <= 0x67) {
        var mnem = TASS_MNEMONICS[byte - 0x30];
        if (mnem) {
          lineText += '<span class="basic-keyword">' + mnem + '</span>';
          continue;
        }
      }

      // $28 = operand byte follows
      if (byte === 0x28 && bi + 1 < line.length) {
        var operand = line[bi + 1];
        lineText += '<span class="text-muted">$' + operand.toString(16).toUpperCase().padStart(2, '0') + '</span>';
        bi++; // skip the operand byte
        continue;
      }

      // Directives as ASCII (.TEXT, .BYTE etc.)
      if (byte === 0x2E && bi + 1 < line.length) {
        var dir = '.';
        bi++;
        while (bi < line.length && line[bi] >= 0x41 && line[bi] <= 0x5A) {
          dir += String.fromCharCode(line[bi]);
          bi++;
        }
        bi--; // back up one since the loop will advance
        lineText += '<span class="basic-keyword">' + escHtml(dir) + '</span>';
        continue;
      }

      // Printable ASCII
      if (byte >= 0x20 && byte <= 0x7E) {
        lineText += escHtml(String.fromCharCode(byte));
        continue;
      }

      // Other bytes as hex
      lineText += '<span class="text-muted">[' + byte.toString(16).toUpperCase().padStart(2, '0') + ']</span>';
    }

    html += lineText + '</div>';
  }
  html += '</div>';

  var titleText = 'Turbo Assembler \u2014 "' + name + '" (' + lines.length + ' lines)';
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

// Control code names for display in strings/REM
var PETSCII_CTRL_NAMES = {
  0x03: 'stop', 0x05: 'wht', 0x07: 'bell', 0x0A: 'lf', 0x0D: 'cr',
  0x0E: 'lower', 0x11: 'down', 0x12: 'rvon', 0x13: 'home',
  0x14: 'del', 0x1C: 'red', 0x1D: 'right', 0x1E: 'grn', 0x1F: 'blu',
  0x81: 'orng', 0x8E: 'upper', 0x90: 'blk', 0x91: 'up',
  0x92: 'rvof', 0x93: 'clr', 0x95: 'brn', 0x96: 'lred',
  0x97: 'dgry', 0x98: 'mgry', 0x99: 'lgrn', 0x9A: 'lblu',
  0x9B: 'lgry', 0x9C: 'pur', 0x9D: 'left', 0x9E: 'yel', 0x9F: 'cyn'
};

// Check if file data looks like a BASIC program
function isBasicProgram(fileData) {
  if (!fileData || fileData.length < 6) return false;
  var addr = fileData[0] | (fileData[1] << 8);
  return BASIC_LOAD_ADDRS[addr] !== undefined;
}

function emitLiteral(parts, b, type) {
  if (b >= 0x20 && b <= 0x7E) {
    parts.push({ type: type, text: String.fromCharCode(b) });
  } else if (PETSCII_CTRL_NAMES[b]) {
    parts.push({ type: 'ctrl', text: '{' + PETSCII_CTRL_NAMES[b] + '}' });
  } else if (b >= 0xA0 || (b >= 0x01 && b <= 0x1F)) {
    parts.push({ type: type, text: PETSCII_MAP[b] || '?' });
  } else {
    parts.push({ type: 'ctrl', text: '{$' + b.toString(16).toUpperCase().padStart(2, '0') + '}' });
  }
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

      // Literal character
      if (b >= 0x20 && b <= 0x7E) {
        parts.push({ type: 'text', text: String.fromCharCode(b) });
      } else {
        parts.push({ type: 'ctrl', text: '{$' + b.toString(16).toUpperCase().padStart(2, '0') + '}' });
      }
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

  document.getElementById('modal-title').textContent = titleText;
  var body = document.getElementById('modal-body');

  // Dialect selector for C64 programs (V2 load address, not V7/V35)
  var detectedVersion = BASIC_LOAD_ADDRS[rendered.basic.loadAddr] || 'V2';
  var showDialect = (detectedVersion === 'V2');
  var currentDialect = dialect || detectedVersion;

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
    body.innerHTML = '';
    body.appendChild(selDiv);
    body.insertAdjacentHTML('beforeend', rendered.html);
  } else {
    body.innerHTML = rendered.html;
  }

  var footer = document.querySelector('#modal-overlay .modal-footer');
  footer.innerHTML = '<button id="modal-close">OK</button>';
  document.getElementById('modal-close').addEventListener('click', function() {
    document.getElementById('modal-overlay').classList.remove('open');
  });
  document.getElementById('modal-overlay').classList.add('open');
}

function renderBasicHtml(basic, name, result) {
  var html = '<div class="basic-listing">';
  for (var li = 0; li < basic.lines.length; li++) {
    var line = basic.lines[li];
    html += '<div class="basic-line">';
    html += '<span class="basic-linenum">' + line.lineNum + ' </span>';
    for (var pi = 0; pi < line.parts.length; pi++) {
      var part = line.parts[pi];
      switch (part.type) {
        case 'keyword':
          html += '<span class="basic-keyword">' + escHtml(part.text) + '</span>';
          break;
        case 'string':
          html += '<span class="basic-string">' + escHtml(part.text) + '</span>';
          break;
        case 'rem':
          html += '<span class="basic-rem">' + escHtml(part.text) + '</span>';
          break;
        case 'ctrl':
          html += '<span class="basic-ctrl">' + escHtml(part.text) + '</span>';
          break;
        default:
          html += escHtml(part.text);
          break;
      }
    }
    html += '</div>';
  }
  html += '</div>';
  return { html: html, basic: basic };
}

// ── geoWrite Document Viewer ─────────────────────────────────────────
// Known GEOS font IDs
// Map GEOS font IDs to CSS font stacks that match their style
var GEOS_FONT_CSS = {
  0:  '"Courier New",Courier,monospace',                         // BSW (system mono)
  1:  'Helvetica,Arial,sans-serif',                              // University (sans)
  2:  'Helvetica,Arial,sans-serif',                              // California (sans)
  3:  '"Times New Roman",Times,Georgia,serif',                   // Roma (serif)
  4:  '"Times New Roman",Times,Georgia,serif',                   // Dwinelle (serif)
  5:  'Helvetica,Arial,sans-serif',                              // Cory (sans)
  6:  '"C64 Pro Mono",monospace',                                // Commodore
  7:  '"Palatino Linotype",Palatino,"Book Antiqua",serif',       // Monterey (serif)
  8:  '"Times New Roman",Times,Georgia,serif',                   // LW Roma
  9:  'Helvetica,Arial,sans-serif',                              // LW Cal
  10: 'Symbol,serif',                                            // LW Greek
  11: '"Times New Roman",Times,Georgia,serif'                    // LW Barrows
};

function showGeoWriteViewer(entryOff) {
  if (!currentBuffer) return;
  var data = new Uint8Array(currentBuffer);
  var name = petsciiToReadable(readPetsciiString(data, entryOff + 5, 16)).trim();
  var records = readVLIRRecords(currentBuffer, entryOff);
  if (records.length === 0) {
    showModal('geoWrite', ['No data found in this document.']);
    return;
  }

  // Render inline images to data URLs for embedding in HTML
  var imageCache = {};
  for (var ri = 64; ri < records.length && ri <= 126; ri++) {
    if (!records[ri] || records[ri].length < 4) continue;
    var wCards = records[ri][0];
    var imgH = records[ri][1] | (records[ri][2] << 8);
    if (wCards === 0 || imgH === 0 || imgH > 4096) continue;
    var imgW = wCards * 8;
    var tmpCanvas = document.createElement('canvas');
    tmpCanvas.width = imgW;
    tmpCanvas.height = imgH;
    var tmpCtx = tmpCanvas.getContext('2d');
    renderScrapData(tmpCtx, records[ri], 0);
    imageCache[ri] = { url: tmpCanvas.toDataURL(), w: imgW, h: imgH };
  }

  var html = '<div class="geowrite-doc">';
  var pageCount = 0;

  // Parse text pages (records 0-60)
  for (var pi = 0; pi <= 60 && pi < records.length; pi++) {
    var rec = records[pi];
    if (!rec || rec.length === 0) continue;

    pageCount++;
    html += '<div class="geowrite-page">';
    html += parseGeoWritePage(rec, imageCache);
    html += '</div>';
  }

  if (pageCount === 0) {
    showModal('geoWrite', ['No text pages found in this document.']);
    return;
  }

  html += '</div>';

  document.getElementById('modal-title').textContent =
    'geoWrite \u2014 "' + name + '" (' + pageCount + ' page' + (pageCount > 1 ? 's' : '') + ')';
  var body = document.getElementById('modal-body');
  body.innerHTML = html;

  var footer = document.querySelector('#modal-overlay .modal-footer');
  footer.innerHTML = '<button id="modal-close">OK</button>';
  document.getElementById('modal-close').addEventListener('click', function() {
    document.getElementById('modal-overlay').classList.remove('open');
  });
  document.getElementById('modal-overlay').classList.add('open');
}

function parseGeoWritePage(rec, imageCache) {
  var html = '';
  var pos = 0;
  var len = rec.length;

  // Current style state
  var bold = false, italic = false, underline = false, outline = false;
  var superscript = false, subscript = false;
  var fontSize = 12;
  var fontId = 0;
  var align = 'left';
  var lineSpacing = 1;

  // Start a paragraph
  var paraOpen = false;

  function openPara() {
    if (paraOpen) return;
    var style = 'text-align:' + align;
    if (lineSpacing > 1) style += ';line-height:' + lineSpacing;
    html += '<div class="geowrite-para" style="' + style + '">';
    paraOpen = true;
  }

  function closePara() {
    if (!paraOpen) return;
    html += '</div>';
    paraOpen = false;
  }

  function openSpan() {
    var styles = [];
    var fontCSS = GEOS_FONT_CSS[fontId] || '"Times New Roman",Times,Georgia,serif';
    styles.push('font-family:' + fontCSS);

    // GEOS sizes are in points; convert to px (1pt = 1.333px) and ensure readability
    var pxSize = Math.round(Math.max(10, fontSize * 1.333));
    if (superscript || subscript) pxSize = Math.round(pxSize * 0.7);
    styles.push('font-size:' + pxSize + 'px');

    if (bold) styles.push('font-weight:bold');
    if (italic) styles.push('font-style:italic');
    if (underline) styles.push('text-decoration:underline');
    if (outline) styles.push('-webkit-text-stroke:0.5px;color:transparent');
    if (superscript) styles.push('vertical-align:super');
    if (subscript) styles.push('vertical-align:sub');

    return '<span style="' + styles.join(';') + '">';
  }

  var spanOpen = false;
  function flushSpan() {
    if (spanOpen) { html += '</span>'; spanOpen = false; }
  }
  function ensureSpan() {
    if (!spanOpen) {
      openPara();
      html += openSpan();
      spanOpen = true;
    }
  }

  while (pos < len) {
    var b = rec[pos];

    if (b === 0x00) {
      // End of record
      break;
    } else if (b === 0x11) {
      // ESC_RULER: 1 + 26 bytes
      if (pos + 27 > len) break;
      flushSpan();
      closePara();

      // Parse ruler data (offsets after the $11 byte)
      var justByte = rec[pos + 23];
      var alignVal = justByte & 0x03;
      var spacingVal = (justByte >> 2) & 0x03;

      if (alignVal === 0) align = 'left';
      else if (alignVal === 1) align = 'center';
      else if (alignVal === 2) align = 'right';
      else align = 'justify';

      if (spacingVal === 0) lineSpacing = 1;
      else if (spacingVal === 1) lineSpacing = 1.5;
      else lineSpacing = 2;

      pos += 27;
    } else if (b === 0x17) {
      // NEWCARDSET: 1 + 3 bytes (font descriptor word + style byte)
      if (pos + 4 > len) break;
      flushSpan();

      var fontWord = rec[pos + 1] | (rec[pos + 2] << 8);
      var styleByte = rec[pos + 3];

      fontId = fontWord >> 5;
      fontSize = fontWord & 0x1F;
      if (fontSize === 0) fontSize = 12;

      underline = (styleByte & 0x80) !== 0;
      bold = (styleByte & 0x40) !== 0;
      italic = (styleByte & 0x10) !== 0;
      outline = (styleByte & 0x08) !== 0;
      superscript = (styleByte & 0x04) !== 0;
      subscript = (styleByte & 0x02) !== 0;

      pos += 4;
    } else if (b === 0x10) {
      // ESC_GRAPHICS: 1 + 4 bytes (inline image reference)
      if (pos + 5 > len) break;
      flushSpan();
      openPara();

      var imgWCards = rec[pos + 1];
      var imgHeight = rec[pos + 2] | (rec[pos + 3] << 8);
      var imgRecord = rec[pos + 4];

      if (imageCache[imgRecord]) {
        var img = imageCache[imgRecord];
        html += '<img class="geowrite-img" src="' + img.url +
          '" width="' + img.w + '" height="' + img.h + '">';
      } else {
        html += '<span style="color:#6C6C6C">[Image: record ' + imgRecord +
          ', ' + (imgWCards * 8) + 'x' + imgHeight + ']</span>';
      }

      pos += 5;
    } else if (b === 0x0D) {
      // Carriage return — end line
      flushSpan();
      if (!paraOpen) openPara();
      closePara();
      pos++;
    } else if (b === 0x09) {
      // Tab
      ensureSpan();
      html += '<span class="geowrite-tab">\t</span>';
      pos++;
    } else if (b === 0x0C) {
      // Page break
      flushSpan();
      closePara();
      html += '<div class="geowrite-pagebreak">\u2500\u2500\u2500 page break \u2500\u2500\u2500</div>';
      pos++;
    } else if (b >= 0x20 && b <= 0x7E) {
      // Printable ASCII
      ensureSpan();
      if (b === 0x26) html += '&amp;';
      else if (b === 0x3C) html += '&lt;';
      else if (b === 0x3E) html += '&gt;';
      else if (b === 0x22) html += '&quot;';
      else html += String.fromCharCode(b);
      pos++;
    } else if (b === 0x08 || b === 0x18) {
      // V1.x compat: skip 19 extra bytes
      pos += 20;
    } else if (b === 0xF5) {
      // V1.x compat: skip 10 extra bytes
      pos += 11;
    } else {
      // Unknown control code, skip
      pos++;
    }
  }

  flushSpan();
  closePara();

  // If empty page, show placeholder
  if (html === '') html = '<div class="geowrite-para" style="color:#6C6C6C">(empty page)</div>';

  return html;
}

