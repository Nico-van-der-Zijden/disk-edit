// ── File menu: Export File ─────────────────────────────────────────────
document.getElementById('opt-export').addEventListener('click', (e) => {
  e.stopPropagation();
  if (!currentBuffer || selectedEntryIndex < 0) return;
  closeMenus();
  var entries = selectedEntries.length > 0 ? selectedEntries : [selectedEntryIndex];
  var data = new Uint8Array(currentBuffer);
  var extMap = { 1: '.seq', 2: '.prg', 3: '.usr', 4: '.rel' };

  for (var ei = 0; ei < entries.length; ei++) {
    var entOff = entries[ei];
    var ext, name;

    if (isTapeFormat()) {
      var tapeEntry = getTapeEntry(entOff);
      if (!tapeEntry) continue;
      ext = tapeEntry.type.trim() === 'SEQ' ? '.seq' : '.prg';
      name = petsciiToReadable(tapeEntry.name).trim();
    } else {
      var typeByte = data[entOff + 2];
      var typeIdx = typeByte & 0x07;
      if (typeIdx < 1 || typeIdx > 4) continue;
      ext = extMap[typeIdx];
      name = petsciiToReadable(readPetsciiString(data, entOff + 5, 16)).trim();
    }

    var result = readFileData(currentBuffer, entOff);
    if (result.error || result.data.length === 0) continue;

    name = name.replace(/[<>:"/\\|?*\x00-\x1F]/g, '_');
    if (!name) name = 'export';

    var blob = new Blob([result.data], { type: 'application/octet-stream' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name + ext;
    a.click();
    URL.revokeObjectURL(a.href);
  }
});

// ── Export as CVT (GEOS ConVerT format) ──────────────────────────────
function buildCvtFile(entryOff) {
  var data = new Uint8Array(currentBuffer);
  var geos = readGeosInfo(currentBuffer, entryOff);

  // Block 1: directory entry bytes 2-31 + signature + zero padding
  var block1 = new Uint8Array(254);
  for (var i = 0; i < 30; i++) block1[i] = data[entryOff + 2 + i];
  var isVlir = geos.structure === 1;
  var sig = isVlir ? 'PRG formatted GEOS file V1.0' : 'SEQ formatted GEOS file V1.0';
  for (var si = 0; si < sig.length; si++) block1[30 + si] = sig.charCodeAt(si);

  // Block 2: info block (254 bytes = sector bytes 2-255)
  var block2 = new Uint8Array(254);
  if (geos.infoTrack > 0) {
    var infoOff = sectorOffset(geos.infoTrack, geos.infoSector);
    if (infoOff >= 0) {
      for (var j = 0; j < 254; j++) block2[j] = data[infoOff + 2 + j];
    }
  }

  if (isVlir) {
    var records = readVLIRRecords(currentBuffer, entryOff);

    // Read VLIR index sector to distinguish 00/00 vs 00/FF
    var vlirT = data[entryOff + 3], vlirS = data[entryOff + 4];
    var vlirOff = sectorOffset(vlirT, vlirS);
    var vlirRaw = (vlirOff >= 0) ? data.subarray(vlirOff, vlirOff + 256) : null;

    // Block 3: record index
    var block3 = new Uint8Array(254);
    var recordChunks = [];

    for (var ri = 0; ri < 127; ri++) {
      var rec = ri < records.length ? records[ri] : null;
      if (rec && rec.length > 0) {
        var numBlocks = Math.ceil(rec.length / 254);
        var remainder = rec.length % 254;
        var lastByte = (remainder === 0) ? 0xFF : (remainder + 1);
        block3[ri * 2] = numBlocks;
        block3[ri * 2 + 1] = lastByte;
        // Pad data to full blocks
        var padded = new Uint8Array(numBlocks * 254);
        padded.set(rec);
        recordChunks.push(padded);
      } else if (vlirRaw && ri < 127) {
        // Preserve original empty marker (00/FF = empty, 00/00 = end)
        block3[ri * 2] = vlirRaw[2 + ri * 2];
        block3[ri * 2 + 1] = vlirRaw[2 + ri * 2 + 1];
      }
    }

    var totalLen = 254 + 254 + 254;
    for (var ci = 0; ci < recordChunks.length; ci++) totalLen += recordChunks[ci].length;
    var cvt = new Uint8Array(totalLen);
    cvt.set(block1, 0);
    cvt.set(block2, 254);
    cvt.set(block3, 508);
    var pos = 762;
    for (var di = 0; di < recordChunks.length; di++) {
      cvt.set(recordChunks[di], pos);
      pos += recordChunks[di].length;
    }
    return cvt;
  } else {
    // Sequential file
    var result = readFileData(currentBuffer, entryOff);
    var fileBytes = result.data;
    var seqBlocks = Math.max(1, Math.ceil(fileBytes.length / 254));
    var seqPadded = new Uint8Array(seqBlocks * 254);
    seqPadded.set(fileBytes);

    var cvt = new Uint8Array(254 + 254 + seqPadded.length);
    cvt.set(block1, 0);
    cvt.set(block2, 254);
    cvt.set(seqPadded, 508);
    return cvt;
  }
}

document.getElementById('opt-export-cvt').addEventListener('click', function(e) {
  e.stopPropagation();
  if (!currentBuffer || selectedEntryIndex < 0) return;
  closeMenus();

  var data = new Uint8Array(currentBuffer);
  var name = petsciiToReadable(readPetsciiString(data, selectedEntryIndex + 5, 16)).trim();
  name = name.replace(/[<>:"/\\|?*\x00-\x1F]/g, '_');
  if (!name) name = 'export';

  var cvtData = buildCvtFile(selectedEntryIndex);
  var blob = new Blob([cvtData], { type: 'application/octet-stream' });
  var a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name + '.cvt';
  a.click();
  URL.revokeObjectURL(a.href);
});

// ── geoWrite RTF/PDF Export ───────────────────────────────────────────
// Map GEOS font IDs to RTF font names
var GEOS_RTF_FONTS = {
  0:'Courier New', 1:'Helvetica', 2:'Helvetica', 3:'Times New Roman',
  4:'Times New Roman', 5:'Helvetica', 6:'Courier New', 7:'Palatino Linotype',
  8:'Times New Roman', 9:'Helvetica', 10:'Symbol', 11:'Times New Roman'
};

// Parse geoWrite VLIR records into a structured document
function parseGeoWriteDoc(entryOff) {
  var records = readVLIRRecords(currentBuffer, entryOff);
  if (records.length === 0) return null;

  // Pre-render inline images as PNG data URLs
  var images = {};
  for (var ri = 64; ri < records.length && ri <= 126; ri++) {
    if (!records[ri] || records[ri].length < 4) continue;
    var wCards = records[ri][0];
    var imgH = records[ri][1] | (records[ri][2] << 8);
    if (wCards === 0 || imgH === 0 || imgH > 4096) continue;
    var tmpC = document.createElement('canvas');
    tmpC.width = wCards * 8; tmpC.height = imgH;
    renderScrapData(tmpC.getContext('2d'), records[ri], 0);
    // Get raw PNG bytes
    var dataUrl = tmpC.toDataURL('image/png');
    images[ri] = { w: wCards * 8, h: imgH, dataUrl: dataUrl,
      base64: dataUrl.substring(dataUrl.indexOf(',') + 1) };
  }

  // Parse text pages
  var pages = [];
  for (var pi = 0; pi <= 60 && pi < records.length; pi++) {
    var rec = records[pi];
    if (!rec || rec.length === 0) continue;
    pages.push(parseGeoWritePageStructured(rec, images));
  }

  return { pages: pages, images: images };
}

// Parse a single geoWrite page into structured elements
function parseGeoWritePageStructured(rec, images) {
  var elements = []; // array of { type, ... }
  var pos = 0, len = rec.length;

  var fontId = 0, fontSize = 12;
  var bold = false, italic = false, underline = false, outline = false;
  var superscript = false, subscript = false;
  var align = 0, spacing = 0; // 0=left,1=center,2=right,3=justified; 0=single,1=1.5,2=double

  var currentText = '';

  function flushText() {
    if (currentText.length > 0) {
      elements.push({ type: 'text', text: currentText,
        fontId: fontId, fontSize: fontSize,
        bold: bold, italic: italic, underline: underline, outline: outline,
        superscript: superscript, subscript: subscript });
      currentText = '';
    }
  }

  while (pos < len) {
    var b = rec[pos];
    if (b === 0x00) break;
    else if (b === 0x11) { // ruler
      if (pos + 27 > len) break;
      flushText();
      var justByte = rec[pos + 23];
      align = justByte & 0x03;
      spacing = (justByte >> 2) & 0x03;
      elements.push({ type: 'ruler', align: align, spacing: spacing });
      pos += 27;
    } else if (b === 0x17) { // font/style change
      if (pos + 4 > len) break;
      flushText();
      var fontWord = rec[pos + 1] | (rec[pos + 2] << 8);
      var styleByte = rec[pos + 3];
      fontId = fontWord >> 5;
      fontSize = fontWord & 0x1F;
      if (fontSize === 0) fontSize = 12;
      bold = (styleByte & 0x40) !== 0;
      italic = (styleByte & 0x10) !== 0;
      underline = (styleByte & 0x80) !== 0;
      outline = (styleByte & 0x08) !== 0;
      superscript = (styleByte & 0x04) !== 0;
      subscript = (styleByte & 0x02) !== 0;
      pos += 4;
    } else if (b === 0x10) { // inline image
      if (pos + 5 > len) break;
      flushText();
      var imgRec = rec[pos + 4];
      var img = images[imgRec];
      if (img) elements.push({ type: 'image', record: imgRec, w: img.w, h: img.h });
      pos += 5;
    } else if (b === 0x0D) { // CR
      flushText();
      elements.push({ type: 'cr' });
      pos++;
    } else if (b === 0x09) { // tab
      flushText();
      elements.push({ type: 'tab' });
      pos++;
    } else if (b === 0x0C) { // page break
      flushText();
      elements.push({ type: 'pagebreak' });
      pos++;
    } else if (b >= 0x20 && b <= 0x7E) {
      currentText += String.fromCharCode(b);
      pos++;
    } else if (b === 0x08 || b === 0x18) { pos += 20; }
    else if (b === 0xF5) { pos += 11; }
    else pos++;
  }
  flushText();
  return elements;
}

// ── RTF Export ───────────────────────────────────────────────────────
function geoWriteToRtf(entryOff) {
  var doc = parseGeoWriteDoc(entryOff);
  if (!doc || doc.pages.length === 0) return null;

  // Build font table from all used fonts
  var fontSet = {};
  for (var pi = 0; pi < doc.pages.length; pi++) {
    for (var ei = 0; ei < doc.pages[pi].length; ei++) {
      var el = doc.pages[pi][ei];
      if (el.type === 'text') fontSet[el.fontId] = true;
    }
  }
  var fontIds = Object.keys(fontSet).map(Number);
  if (fontIds.length === 0) fontIds = [0];
  var fontMap = {}; // geosId -> rtfIndex
  var fontTable = '{\\fonttbl';
  for (var fi = 0; fi < fontIds.length; fi++) {
    fontMap[fontIds[fi]] = fi;
    var fname = GEOS_RTF_FONTS[fontIds[fi]] || 'Times New Roman';
    var fFamily = (fname === 'Courier New') ? 'fmodern' :
      (fname === 'Helvetica') ? 'fswiss' : 'froman';
    fontTable += '{\\f' + fi + '\\' + fFamily + ' ' + fname + ';}';
  }
  fontTable += '}';

  var rtf = '{\\rtf1\\ansi\\deff0\n' + fontTable + '\n';

  var curAlign = 0;
  var curSpacing = 0;

  function alignCmd(a) {
    if (a === 1) return '\\qc';
    if (a === 2) return '\\qr';
    if (a === 3) return '\\qj';
    return '\\ql';
  }

  function spacingCmd(s) {
    if (s === 1) return '\\sl360\\slmult1'; // 1.5
    if (s === 2) return '\\sl480\\slmult1'; // double
    return '\\sl240\\slmult1'; // single
  }

  function escRtf(text) {
    var out = '';
    for (var i = 0; i < text.length; i++) {
      var c = text.charCodeAt(i);
      if (c === 0x5C) out += '\\\\';
      else if (c === 0x7B) out += '\\{';
      else if (c === 0x7D) out += '\\}';
      else if (c > 127) out += '\\u' + c + '?';
      else out += text[i];
    }
    return out;
  }

  for (var pi2 = 0; pi2 < doc.pages.length; pi2++) {
    var page = doc.pages[pi2];
    if (pi2 > 0) rtf += '\\page\n';

    var paraOpen = false;
    function openPara() {
      if (!paraOpen) {
        rtf += '\\pard ' + alignCmd(curAlign) + ' ' + spacingCmd(curSpacing) + ' ';
        paraOpen = true;
      }
    }
    function closePara() {
      if (paraOpen) { rtf += '\\par\n'; paraOpen = false; }
    }

    for (var ei2 = 0; ei2 < page.length; ei2++) {
      var el2 = page[ei2];

      if (el2.type === 'ruler') {
        closePara();
        curAlign = el2.align;
        curSpacing = el2.spacing;
      } else if (el2.type === 'text') {
        openPara();
        var fIdx = fontMap[el2.fontId] !== undefined ? fontMap[el2.fontId] : 0;
        var ptSize = Math.max(10, el2.fontSize) * 2; // RTF uses half-points
        rtf += '{\\f' + fIdx + '\\fs' + ptSize;
        if (el2.bold) rtf += '\\b';
        if (el2.italic) rtf += '\\i';
        if (el2.underline) rtf += '\\ul';
        if (el2.superscript) rtf += '\\super';
        if (el2.subscript) rtf += '\\sub';
        if (el2.outline) rtf += '\\outl';
        rtf += ' ' + escRtf(el2.text) + '}';
      } else if (el2.type === 'cr') {
        if (!paraOpen) openPara();
        closePara();
      } else if (el2.type === 'tab') {
        openPara();
        rtf += '\\tab ';
      } else if (el2.type === 'pagebreak') {
        closePara();
        rtf += '\\page\n';
      } else if (el2.type === 'image') {
        openPara();
        var img2 = doc.images[el2.record];
        if (img2) {
          // Embed as PNG in RTF using \pngblip
          var hex = atob(img2.base64).split('').map(function(c) {
            return ('0' + c.charCodeAt(0).toString(16)).slice(-2);
          }).join('');
          rtf += '{\\pict\\pngblip\\picw' + (el2.w * 15) +
            '\\pich' + (el2.h * 15) +
            '\\picwgoal' + (el2.w * 15) +
            '\\pichgoal' + (el2.h * 15) + '\n';
          // Line-wrap hex at 80 chars
          for (var hi = 0; hi < hex.length; hi += 80) {
            rtf += hex.substring(hi, hi + 80) + '\n';
          }
          rtf += '}';
        }
      }
    }
    closePara();
  }

  rtf += '}';
  return rtf;
}

document.getElementById('opt-export-rtf').addEventListener('click', function(e) {
  e.stopPropagation();
  if (!currentBuffer || selectedEntryIndex < 0) return;
  closeMenus();

  var data = new Uint8Array(currentBuffer);
  var name = petsciiToReadable(readPetsciiString(data, selectedEntryIndex + 5, 16)).trim();
  name = name.replace(/[<>:"/\\|?*\x00-\x1F]/g, '_') || 'document';

  var rtf = geoWriteToRtf(selectedEntryIndex);
  if (!rtf) { showModal('Export Error', ['No geoWrite data found.']); return; }

  var blob = new Blob([rtf], { type: 'application/rtf' });
  var a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name + '.rtf';
  a.click();
  URL.revokeObjectURL(a.href);
});

// ── PDF Export ───────────────────────────────────────────────────────
// Minimal PDF generator (no external library)
function geoWriteToPdf(entryOff) {
  var doc = parseGeoWriteDoc(entryOff);
  if (!doc || doc.pages.length === 0) return null;

  var data = new Uint8Array(currentBuffer);
  var docName = petsciiToReadable(readPetsciiString(data, entryOff + 5, 16)).trim();

  // PDF coordinate system: 72 units per inch, origin at bottom-left
  var pageW = 595, pageH = 842; // A4
  var marginL = 56, marginR = 56, marginT = 56, marginB = 56;
  var usableW = pageW - marginL - marginR;

  // Collect embedded images and convert to PDF image XObjects
  var imgObjIds = {};

  // We'll build the PDF structure manually
  var objects = [];
  var objOffsets = [];

  function addObj(content) {
    objects.push(content);
    return objects.length; // 1-based ID
  }

  // PDF font mapping: use the 14 standard PDF fonts
  function pdfFontName(geosId) {
    var isSerif = [3, 4, 7, 8, 11].indexOf(geosId) >= 0;
    var isMono = (geosId === 0 || geosId === 6);
    if (isMono) return 'Courier';
    if (isSerif) return 'Times-Roman';
    return 'Helvetica';
  }

  function pdfFontNameStyled(geosId, bold, italic) {
    var base = pdfFontName(geosId);
    if (base === 'Courier') {
      if (bold && italic) return 'Courier-BoldOblique';
      if (bold) return 'Courier-Bold';
      if (italic) return 'Courier-Oblique';
      return 'Courier';
    }
    if (base === 'Helvetica') {
      if (bold && italic) return 'Helvetica-BoldOblique';
      if (bold) return 'Helvetica-Bold';
      if (italic) return 'Helvetica-Oblique';
      return 'Helvetica';
    }
    // Times
    if (bold && italic) return 'Times-BoldItalic';
    if (bold) return 'Times-Bold';
    if (italic) return 'Times-Italic';
    return 'Times-Roman';
  }

  // Collect all font variants used
  var fontVariants = {};
  for (var pi = 0; pi < doc.pages.length; pi++) {
    for (var ei = 0; ei < doc.pages[pi].length; ei++) {
      var el = doc.pages[pi][ei];
      if (el.type === 'text') {
        var fn = pdfFontNameStyled(el.fontId, el.bold, el.italic);
        fontVariants[fn] = true;
      }
    }
  }
  if (Object.keys(fontVariants).length === 0) fontVariants['Helvetica'] = true;

  // Assign font resource names
  var fontResNames = {};
  var fontResIdx = 0;
  for (var fv in fontVariants) {
    fontResNames[fv] = 'F' + fontResIdx;
    fontResIdx++;
  }

  // Create font objects
  var fontObjIds = {};
  for (var fv2 in fontVariants) {
    var fObjId = addObj('<< /Type /Font /Subtype /Type1 /BaseFont /' + fv2 + ' /Encoding /WinAnsiEncoding >>');
    fontObjIds[fv2] = fObjId;
  }

  // Create image XObjects
  for (var imgRec in doc.images) {
    var img = doc.images[imgRec];
    // Decode PNG to raw pixels for PDF (use canvas)
    var tmpC = document.createElement('canvas');
    tmpC.width = img.w; tmpC.height = img.h;
    var tmpCtx = tmpC.getContext('2d');
    var tmpImg = new Image();
    tmpImg.src = img.dataUrl;
    tmpCtx.drawImage(tmpImg, 0, 0);
    var imgData = tmpCtx.getImageData(0, 0, img.w, img.h);

    // Convert to grayscale (GEOS images are monochrome)
    var grayData = new Uint8Array(img.w * img.h);
    for (var px = 0; px < img.w * img.h; px++) {
      grayData[px] = imgData.data[px * 4]; // R channel (mono: 0 or 255)
    }

    var imgHexArr = new Array(grayData.length);
    for (var gi = 0; gi < grayData.length; gi++) {
      imgHexArr[gi] = ('0' + grayData[gi].toString(16)).slice(-2);
    }
    var imgStream = imgHexArr.join('');

    var imgObjId = addObj('<< /Type /XObject /Subtype /Image /Width ' + img.w +
      ' /Height ' + img.h + ' /ColorSpace /DeviceGray /BitsPerComponent 8 ' +
      '/Length ' + imgStream.length + ' /Filter /ASCIIHexDecode >>\nstream\n' +
      imgStream + '>\nendstream');
    imgObjIds[imgRec] = imgObjId;
  }

  // Build page content streams
  var pageObjIds = [];
  var contentObjIds = [];
  var pagesObjId; // will be set after

  // Helper: escape PDF string
  function escPdf(text) {
    return text.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
  }

  // Per-character widths for standard PDF fonts (Adobe widths / 1000)
  // Covers ASCII 32-126; default for unknown chars
  var HELVETICA_W = [
    278,278,355,556,556,889,667,191,333,333,389,584,278,333,278,278, // 32-47 (space ! " # $ % & ' ( ) * + , - . /)
    556,556,556,556,556,556,556,556,556,556,278,278,584,584,584,556, // 48-63 (0-9 : ; < = > ?)
    1015,667,667,722,722,667,611,778,722,278,500,667,556,833,722,778, // 64-79 (@A-O)
    667,778,722,667,611,722,667,944,667,667,611,278,278,278,469,556, // 80-95 (P-Z [ \ ] ^ _)
    333,556,556,500,556,556,278,556,556,222,222,500,222,833,556,556, // 96-111 (` a-o)
    556,556,333,500,278,556,500,722,500,500,500,334,260,334,584       // 112-126 (p-z { | } ~)
  ];
  var TIMES_W = [
    250,333,408,500,500,833,778,180,333,333,500,564,250,333,250,278, // 32-47
    500,500,500,500,500,500,500,500,500,500,278,278,564,564,564,444, // 48-63
    921,722,667,667,722,611,556,722,722,333,389,722,611,889,722,722, // 64-79
    556,722,667,556,611,722,722,944,722,722,611,333,278,333,469,500, // 80-95
    333,444,500,444,500,444,333,500,500,278,278,500,278,778,500,500, // 96-111
    500,500,333,389,278,500,500,722,500,500,444,480,200,480,541       // 112-126
  ];

  function textWidth(fontName, text, fontSize) {
    var isCourier = fontName.indexOf('Courier') === 0;
    var isHelv = fontName.indexOf('Helvetica') === 0;
    var widths = isHelv ? HELVETICA_W : TIMES_W;
    var total = 0;
    for (var i = 0; i < text.length; i++) {
      if (isCourier) { total += 600; continue; }
      var code = text.charCodeAt(i);
      var w = (code >= 32 && code <= 126) ? widths[code - 32] : 500;
      total += w;
    }
    return total * fontSize / 1000;
  }

  for (var pi2 = 0; pi2 < doc.pages.length; pi2++) {
    var page = doc.pages[pi2];
    var stream = '';
    var curY = pageH - marginT;
    var curFontName = 'Helvetica';
    var curFontSize = 12;
    var lineHeight = 14;
    var curAlign = 0;

    stream += 'BT\n';
    stream += '/' + fontResNames[curFontName] + ' ' + curFontSize + ' Tf\n';
    stream += marginL + ' ' + curY + ' Td\n';

    var lineText = '';
    var lineWidth = 0;

    function flushLine() {
      if (lineText.length === 0) return;

      var xOffset = 0;
      if (curAlign === 1) xOffset = (usableW - lineWidth) / 2; // center
      else if (curAlign === 2) xOffset = usableW - lineWidth; // right

      if (xOffset > 0) {
        stream += xOffset.toFixed(1) + ' 0 Td\n';
      }
      stream += '(' + escPdf(lineText) + ') Tj\n';
      if (xOffset > 0) {
        stream += (-xOffset).toFixed(1) + ' 0 Td\n';
      }
      lineText = '';
      lineWidth = 0;
    }

    function newLine() {
      flushLine();
      curY -= lineHeight;
      if (curY < marginB) {
        // Would overflow page — stop (simplified: no auto-pagination within a GEOS page)
        curY = marginB;
      }
      stream += 0 + ' ' + (-lineHeight).toFixed(1) + ' Td\n';
    }

    for (var ei2 = 0; ei2 < page.length; ei2++) {
      var el2 = page[ei2];

      if (el2.type === 'ruler') {
        curAlign = el2.align;
        if (el2.spacing === 1) lineHeight = curFontSize * 1.5;
        else if (el2.spacing === 2) lineHeight = curFontSize * 2;
        else lineHeight = curFontSize * 1.2;
      } else if (el2.type === 'text') {
        var fn2 = pdfFontNameStyled(el2.fontId, el2.bold, el2.italic);
        var sz2 = Math.max(10, el2.fontSize);
        if (fn2 !== curFontName || sz2 !== curFontSize) {
          flushLine();
          curFontName = fn2;
          curFontSize = sz2;
          lineHeight = sz2 * 1.2;
          stream += '/' + fontResNames[curFontName] + ' ' + curFontSize + ' Tf\n';
        }
        lineText += el2.text;
        lineWidth += textWidth(curFontName, el2.text, curFontSize);
      } else if (el2.type === 'cr') {
        newLine();
      } else if (el2.type === 'tab') {
        lineText += '    ';
        lineWidth += textWidth(curFontName, '    ', curFontSize);
      } else if (el2.type === 'pagebreak') {
        flushLine();
        // Simplified: just add extra vertical space
        curY -= lineHeight * 2;
        stream += '0 ' + (-(lineHeight * 2)).toFixed(1) + ' Td\n';
      } else if (el2.type === 'image') {
        flushLine();
        stream += 'ET\n'; // end text to draw image
        var imgObj = imgObjIds[el2.record];
        if (imgObj) {
          var imgDisplayW = Math.min(el2.w, usableW);
          var imgDisplayH = el2.h * (imgDisplayW / el2.w);
          curY -= imgDisplayH + 4;
          stream += 'q ' + imgDisplayW.toFixed(1) + ' 0 0 ' + imgDisplayH.toFixed(1) +
            ' ' + marginL + ' ' + curY.toFixed(1) + ' cm /Im' + el2.record + ' Do Q\n';
          curY -= 4;
        }
        stream += 'BT\n';
        stream += '/' + fontResNames[curFontName] + ' ' + curFontSize + ' Tf\n';
        stream += marginL + ' ' + curY.toFixed(1) + ' Td\n';
      }
    }
    flushLine();
    stream += 'ET\n';

    // Build resource dictionary for this page
    var fontRes = '';
    for (var fr in fontResNames) {
      fontRes += '/' + fontResNames[fr] + ' ' + fontObjIds[fr] + ' 0 R ';
    }
    var imgRes = '';
    for (var ir in imgObjIds) {
      imgRes += '/Im' + ir + ' ' + imgObjIds[ir] + ' 0 R ';
    }

    var contentId = addObj('<< /Length ' + stream.length + ' >>\nstream\n' + stream + 'endstream');
    contentObjIds.push(contentId);

    var resDict = '<< /Font << ' + fontRes + '>> ';
    if (imgRes) resDict += '/XObject << ' + imgRes + '>> ';
    resDict += '>>';

    var pageId = addObj('<< /Type /Page /Parent PAGES_REF /MediaBox [0 0 ' +
      pageW + ' ' + pageH + '] /Contents ' + contentId + ' 0 R /Resources ' + resDict + ' >>');
    pageObjIds.push(pageId);
  }

  // Pages object
  var kidsStr = pageObjIds.map(function(id) { return id + ' 0 R'; }).join(' ');
  pagesObjId = addObj('<< /Type /Pages /Kids [' + kidsStr + '] /Count ' + pageObjIds.length + ' >>');

  // Catalog
  var catalogId = addObj('<< /Type /Catalog /Pages ' + pagesObjId + ' 0 R >>');

  // Info
  var infoId = addObj('<< /Title (' + escPdf(docName) + ') /Producer (CBM Disk Editor) /Creator (geoWrite) >>');

  // Now build the actual PDF bytes
  var pdf = '%PDF-1.4\n';

  // Write objects and track offsets
  for (var oi = 0; oi < objects.length; oi++) {
    objOffsets.push(pdf.length);
    var objContent = objects[oi];
    // Replace PAGES_REF placeholder in page objects
    objContent = objContent.replace('PAGES_REF', pagesObjId + ' 0 R');
    pdf += (oi + 1) + ' 0 obj\n' + objContent + '\nendobj\n';
  }

  // Cross-reference table
  var xrefOff = pdf.length;
  pdf += 'xref\n0 ' + (objects.length + 1) + '\n';
  pdf += '0000000000 65535 f \n';
  for (var xi = 0; xi < objOffsets.length; xi++) {
    pdf += ('0000000000' + objOffsets[xi]).slice(-10) + ' 00000 n \n';
  }

  pdf += 'trailer\n<< /Size ' + (objects.length + 1) +
    ' /Root ' + catalogId + ' 0 R /Info ' + infoId + ' 0 R >>\n';
  pdf += 'startxref\n' + xrefOff + '\n%%EOF\n';

  return pdf;
}

document.getElementById('opt-export-pdf').addEventListener('click', function(e) {
  e.stopPropagation();
  if (!currentBuffer || selectedEntryIndex < 0) return;
  closeMenus();

  var data = new Uint8Array(currentBuffer);
  var name = petsciiToReadable(readPetsciiString(data, selectedEntryIndex + 5, 16)).trim();
  name = name.replace(/[<>:"/\\|?*\x00-\x1F]/g, '_') || 'document';

  var pdf = geoWriteToPdf(selectedEntryIndex);
  if (!pdf) { showModal('Export Error', ['No geoWrite data found.']); return; }

  var blob = new Blob([pdf], { type: 'application/pdf' });
  var a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name + '.pdf';
  a.click();
  URL.revokeObjectURL(a.href);
});

// ── geoWrite Plain Text Export ────────────────────────────────────────
document.getElementById('opt-export-txt-gw').addEventListener('click', function(e) {
  e.stopPropagation();
  if (!currentBuffer || selectedEntryIndex < 0) return;
  closeMenus();

  var doc = parseGeoWriteDoc(selectedEntryIndex);
  if (!doc || doc.pages.length === 0) {
    showModal('Export Error', ['No geoWrite data found.']);
    return;
  }

  var text = '';
  for (var pi = 0; pi < doc.pages.length; pi++) {
    var page = doc.pages[pi];
    for (var ei = 0; ei < page.length; ei++) {
      var el = page[ei];
      if (el.type === 'text') text += el.text;
      else if (el.type === 'cr') text += '\n';
      else if (el.type === 'tab') text += '\t';
      else if (el.type === 'pagebreak') text += '\n--- Page Break ---\n';
      else if (el.type === 'image') text += '[Image]\n';
    }
    if (pi < doc.pages.length - 1) text += '\n';
  }

  var data = new Uint8Array(currentBuffer);
  var name = petsciiToReadable(readPetsciiString(data, selectedEntryIndex + 5, 16)).trim();
  name = name.replace(/[<>:"/\\|?*\x00-\x1F]/g, '_') || 'document';

  var blob = new Blob([text], { type: 'text/plain' });
  var a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name + '.txt';
  a.click();
  URL.revokeObjectURL(a.href);
});

// ── File menu: Copy / Paste ──────────────────────────────────────────
document.getElementById('opt-copy').addEventListener('click', (e) => {
  e.stopPropagation();
  if (!currentBuffer || selectedEntryIndex < 0) return;
  closeMenus();
  var data = new Uint8Array(currentBuffer);
  var entries = selectedEntries.length > 0 ? selectedEntries : [selectedEntryIndex];
  clipboard = [];

  for (var ci = 0; ci < entries.length; ci++) {
    var entOff = entries[ci];
    var typeIdx, nameBytes, geosBytes, geosInfoBlock;

    if (isTapeFormat()) {
      var tapeEntry = getTapeEntry(entOff);
      if (!tapeEntry) continue;
      typeIdx = tapeEntry.type.trim() === 'SEQ' ? 1 : 2; // SEQ=1, PRG=2
      // Convert PUA name back to PETSCII bytes
      nameBytes = new Uint8Array(16);
      for (var ni = 0; ni < 16 && ni < tapeEntry.name.length; ni++) {
        nameBytes[ni] = unicodeToPetscii(tapeEntry.name[ni]);
      }
      for (var pi = tapeEntry.name.length; pi < 16; pi++) nameBytes[pi] = 0xA0;
      geosBytes = new Uint8Array(9);
      geosInfoBlock = null;
    } else {
      var typeByte = data[entOff + 2];
      typeIdx = typeByte & 0x07;
      if (typeIdx < 1 || typeIdx > 4) continue;
      nameBytes = new Uint8Array(16);
      for (var i = 0; i < 16; i++) nameBytes[i] = data[entOff + 5 + i];
      geosBytes = new Uint8Array(9);
      for (var g = 0; g < 9; g++) geosBytes[g] = data[entOff + 21 + g];
      geosInfoBlock = null;
      var infoTrack = data[entOff + 0x15];
      var infoSector = data[entOff + 0x16];
      if (data[entOff + 0x18] > 0 && infoTrack > 0) {
        var infoOff = sectorOffset(infoTrack, infoSector);
        if (infoOff >= 0) {
          geosInfoBlock = new Uint8Array(256);
          for (var ib = 0; ib < 256; ib++) geosInfoBlock[ib] = data[infoOff + ib];
        }
      }
    }

    var result = readFileData(currentBuffer, entOff);
    if (result.error || result.data.length === 0) continue;

    clipboard.push({
      typeIdx: typeIdx,
      nameBytes: nameBytes,
      geosBytes: geosBytes,
      geosInfoBlock: geosInfoBlock,
      data: new Uint8Array(result.data)
    });
  }
  updateEntryMenuState();
});

document.getElementById('opt-paste').addEventListener('click', async (e) => {
  e.stopPropagation();
  if (clipboard.length === 0 || !currentBuffer || !canInsertFile()) return;
  closeMenus();

  // Check if any GEOS files in clipboard and disk is not GEOS
  var hasGeos = clipboard.some(function(c) { return c.geosInfoBlock !== null; });
  if (hasGeos && !hasGeosSignature(currentBuffer)) {
    var choice = await showChoiceModal(
      'GEOS File',
      'Clipboard contains GEOS file(s) but the disk is not in GEOS format. Convert disk to GEOS format?',
      [
        { label: 'Cancel', value: 'cancel', secondary: true },
        { label: 'Paste Anyway', value: 'paste' },
        { label: 'Convert & Paste', value: 'convert' }
      ]
    );
    if (choice === 'cancel') return;
    if (choice === 'convert') {
      writeGeosSignature(currentBuffer);
      updateMenuState();
    }
  }

  var pasted = 0;
  var remaining = clipboard.length;
  for (var pi = 0; pi < clipboard.length; pi++) {
    var item = clipboard[pi];
    var geosData = null;
    if (item.geosBytes || item.geosInfoBlock) {
      geosData = { geosBytes: item.geosBytes, geosInfoBlock: item.geosInfoBlock };
    }
    if (writeFileToDisk(item.typeIdx, item.nameBytes, item.data, geosData)) {
      pasted++;
    } else {
      // writeFileToDisk already showed the error — stop here
      remaining = clipboard.length - pi - 1;
      break;
    }
  }

  if (pasted > 0) {
    var info = parseCurrentDir(currentBuffer);
    renderDisk(info);
    if (pasted === clipboard.length) {
      showModal('Paste Complete', [pasted + ' file(s) pasted successfully.']);
    } else {
      showModal('Paste Incomplete', [pasted + ' of ' + clipboard.length + ' file(s) pasted.', remaining + ' file(s) could not be pasted (disk full or no directory space).']);
    }
  }
  // If pasted === 0, writeFileToDisk already showed the error
});

// ── File menu: Import File ────────────────────────────────────────────
var importFileInput = document.createElement('input');
importFileInput.type = 'file';
importFileInput.accept = '.prg,.seq,.usr,.rel,.p00,.s00,.u00,.r00,.cvt,.txt';
importFileInput.style.display = 'none';
document.body.appendChild(importFileInput);

document.getElementById('opt-import').addEventListener('click', (e) => {
  e.stopPropagation();
  if (!currentBuffer || !canInsertFile()) return;
  closeMenus();
  importFileInput.click();
});

importFileInput.addEventListener('change', () => {
  var file = importFileInput.files[0];
  if (!file) return;
  importFileInput.value = '';
  var reader = new FileReader();
  reader.onload = () => {
    importFileToDisk(file.name, new Uint8Array(reader.result));
  };
  reader.readAsArrayBuffer(file);
});

// Build a true sector allocation map by following all file and directory chains.
// Does NOT trust the BAM — walks every chain on disk.
function buildTrueAllocationMap(buffer) {
  var data = new Uint8Array(buffer);
  var fmt = currentFormat;
  var allocated = {}; // "t:s" -> true

  if (currentPartition && !currentPartition.dnpDir) {
    // Inside a D81 partition: mark partition system sectors (header, BAM1, BAM2)
    var st = currentPartition.startTrack;
    allocated[st + ':0'] = true; // header
    allocated[st + ':1'] = true; // BAM1
    allocated[st + ':2'] = true; // BAM2
  } else {
    // Root or linked subdir: mark all protected sectors (BAM, header, system)
    var sysTracks = fmt.getSkipTracks();
    for (var st2 in sysTracks) {
      var ps = fmt.getProtectedSectors(parseInt(st2));
      for (var psi = 0; psi < ps.length; psi++) allocated[st2 + ':' + ps[psi]] = true;
    }
    // Also mark protected sectors on non-skip tracks (e.g. D1M/D2M/D4M system partition on track 26)
    for (var et = 1; et <= currentTracks; et++) {
      if (sysTracks[et]) continue; // already handled above
      var eps = fmt.getProtectedSectors(et);
      for (var epi = 0; epi < eps.length; epi++) allocated[et + ':' + eps[epi]] = true;
    }
  }

  // Walk a directory chain, mark its sectors and all file chains as allocated.
  // For linked subdirs, recurse into subdirectory entries.
  function walkDirectory(dirT, dirS) {
    while (dirT !== 0) {
      var key = dirT + ':' + dirS;
      if (allocated[key]) break; // already visited (also prevents loops)
      allocated[key] = true;

      var off = sectorOffset(dirT, dirS);
      if (off < 0) break;

      for (var i = 0; i < fmt.entriesPerSector; i++) {
        var entOff = off + i * fmt.entrySize;
        var typeByte = data[entOff + 2];
        var typeIdx = typeByte & 0x07;
        if (typeIdx === 0 && !(typeByte & 0x80)) continue;

        var ft = data[entOff + 3], fs = data[entOff + 4];

        // Linked subdirectory: mark header + recurse into its dir chain
        if (fmt.subdirLinked && typeIdx === fmt.subdirType && (typeByte & 0x80)) {
          var hdrKey = ft + ':' + fs;
          if (!allocated[hdrKey]) {
            allocated[hdrKey] = true;
            var hdrOff = sectorOffset(ft, fs);
            if (hdrOff >= 0) {
              walkDirectory(data[hdrOff], data[hdrOff + 1]);
            }
          }
          continue;
        }

        // Follow file sector chain
        var fileVisited = {};
        while (ft !== 0) {
          if (ft < 1 || ft > currentTracks) break;
          if (fs >= fmt.sectorsPerTrack(ft)) break;
          var fkey = ft + ':' + fs;
          if (fileVisited[fkey]) break;
          fileVisited[fkey] = true;
          allocated[fkey] = true;
          var foff = sectorOffset(ft, fs);
          if (foff < 0) break;
          ft = data[foff]; fs = data[foff + 1];
        }

        // REL file side-sector chain
        if (typeIdx === 4) {
          var sst = data[entOff + 0x15], sss = data[entOff + 0x16];
          var ssVisited = {};
          while (sst !== 0) {
            var sskey = sst + ':' + sss;
            if (ssVisited[sskey]) break;
            ssVisited[sskey] = true;
            if (sst < 1 || sst > currentTracks) break;
            if (sss >= fmt.sectorsPerTrack(sst)) break;
            allocated[sskey] = true;
            var ssoff = sectorOffset(sst, sss);
            if (ssoff < 0) break;
            sst = data[ssoff]; sss = data[ssoff + 1];
          }
        }
      }

      dirT = data[off]; dirS = data[off + 1];
    }
  }

  // For linked subdirs, always walk from root to cover all directories
  if (fmt.subdirLinked && currentPartition && currentPartition.dnpDir) {
    walkDirectory(fmt.dirTrack, fmt.dirSector);
  } else {
    var ctx = getDirContext();
    walkDirectory(ctx.dirTrack, ctx.dirSector);
  }

  return allocated;
}

// Allocate sectors using the same strategy as a real CBM drive:
// - 1541/1571: tracks below dir track first (descending), then above (ascending), interleave 10
// - 1581: tracks below dir track first (descending), then above (ascending), interleave 1
function allocateSectors(allocated, numSectors) {
  var fmt = currentFormat;

  var trackOrder = [];
  var interleave;

  if (currentPartition && !currentPartition.dnpDir) {
    // Inside a D81 partition: use partition's tracks (skip track 1 = system track)
    var st = currentPartition.startTrack;
    var numPartTracks = Math.floor(currentPartition.partSize / fmt.partitionSpt);
    // Partition's "directory track" is the start track; data goes on tracks 2+ (absolute: st+1, st+2, ...)
    for (var pt = 2; pt <= numPartTracks; pt++) trackOrder.push(st + pt - 1);
    interleave = fmt.defaultInterleave;
  } else {
    var dirTrack = fmt.dirTrack;
    var skipTracks = fmt.getSkipTracks();
    var maxBamTrack = fmt.bamTracksRange(currentTracks);
    for (var t = dirTrack - 1; t >= 1; t--) { if (!skipTracks[t]) trackOrder.push(t); }
    for (var t2 = dirTrack + 1; t2 <= maxBamTrack; t2++) { if (!skipTracks[t2]) trackOrder.push(t2); }
    interleave = fileInterleave;
  }
  var sectorList = [];
  var lastSector = 0;

  for (var ti = 0; ti < trackOrder.length && sectorList.length < numSectors; ti++) {
    var track = trackOrder[ti];
    var spt = fmt.sectorsPerTrack(track);

    // On a new track, apply interleave from the last allocated sector
    var startS = (lastSector + interleave) % spt;

    // Find first free sector starting from startS, scanning forward
    var s = startS;
    var foundFirst = false;
    for (var attempt = 0; attempt < spt; attempt++) {
      if (!allocated[track + ':' + s]) {
        sectorList.push({ track: track, sector: s });
        allocated[track + ':' + s] = true;
        lastSector = s;
        foundFirst = true;
        break;
      }
      s = (s + 1) % spt;
    }

    // Continue allocating more sectors on this same track
    if (foundFirst) {
      while (sectorList.length < numSectors) {
        var nextS = (lastSector + interleave) % spt;
        var foundMore = false;
        for (var a2 = 0; a2 < spt; a2++) {
          if (!allocated[track + ':' + nextS]) {
            sectorList.push({ track: track, sector: nextS });
            allocated[track + ':' + nextS] = true;
            lastSector = nextS;
            foundMore = true;
            break;
          }
          nextS = (nextS + 1) % spt;
        }
        if (!foundMore) break; // track full
      }
    }
  }

  return sectorList;
}

// Core write: writes file data to disk with sector chain, directory entry, BAM update, and verification.
// nameBytes = 16-byte Uint8Array of PETSCII filename (already padded with $A0)
// Returns true on success, false on failure (with rollback).
// geosData is optional: { geosBytes: Uint8Array(9), geosInfoBlock: Uint8Array(256)|null }
function writeFileToDisk(typeIdx, nameBytes, fileData, geosData) {
  pushUndo();
  var snapshot = currentBuffer.slice(0);
  var data = new Uint8Array(currentBuffer);

  // Build true allocation map (don't trust BAM)
  var allocated = buildTrueAllocationMap(currentBuffer);

  // Calculate required sectors for file data
  var dataLen = fileData.length;
  var numSectors = dataLen === 0 ? 1 : Math.ceil(dataLen / 254);
  // No extra sector needed: byte 1 = 255 correctly represents 254 data bytes

  // If GEOS info block present, need one extra sector for it
  var needsInfoBlock = geosData && geosData.geosInfoBlock;
  if (needsInfoBlock) numSectors++;

  // Allocate sectors using real drive algorithm
  var sectorList = allocateSectors(allocated, numSectors);
  if (sectorList.length < numSectors) {
    showModal('Write Error', ['Not enough free sectors. Need ' + numSectors + ', have ' + sectorList.length + '.']);
    return false;
  }

  // Reserve a directory entry before writing any data (fail early)
  // Pass allocated map so linked subdir expansion doesn't reuse file sectors
  var entryOff = findFreeDirEntry(currentBuffer, allocated);
  if (entryOff < 0) {
    showModal('Write Error', ['No free directory entry available.']);
    return false;
  }

  // If GEOS, write the info block to the first allocated sector
  var infoSec = null;
  var dataSectorStart = 0;
  if (needsInfoBlock) {
    infoSec = sectorList[0];
    var infoOff = sectorOffset(infoSec.track, infoSec.sector);
    for (var ib = 0; ib < 256; ib++) data[infoOff + ib] = geosData.geosInfoBlock[ib];
    // Info block bytes 0-1 should be 00 FF (standard GEOS info block marker)
    data[infoOff] = 0x00;
    data[infoOff + 1] = 0xFF;
    dataSectorStart = 1; // file data starts from sector index 1
  }

  // Write file data into the sector chain (starting after info block if GEOS)
  var fileSectors = sectorList.slice(dataSectorStart);
  var dataPos = 0;
  for (var si = 0; si < fileSectors.length; si++) {
    var sec = fileSectors[si];
    var soff = sectorOffset(sec.track, sec.sector);

    if (si < fileSectors.length - 1) {
      var nextSec = fileSectors[si + 1];
      data[soff] = nextSec.track;
      data[soff + 1] = nextSec.sector;
      for (var b = 2; b < 256; b++) {
        data[soff + b] = dataPos < dataLen ? fileData[dataPos++] : 0x00;
      }
    } else {
      data[soff] = 0x00;
      var bytesInLast = dataLen - dataPos;
      if (bytesInLast <= 0) bytesInLast = 0;
      data[soff + 1] = bytesInLast + 1;
      for (var b2 = 2; b2 < 256; b2++) {
        data[soff + b2] = dataPos < dataLen ? fileData[dataPos++] : 0x00;
      }
    }
  }

  // Fill directory entry
  data[entryOff + 2] = 0x80 | typeIdx;
  data[entryOff + 3] = fileSectors[0].track;
  data[entryOff + 4] = fileSectors[0].sector;
  for (var ni = 0; ni < 16; ni++) data[entryOff + 5 + ni] = nameBytes[ni];

  // GEOS metadata (bytes 21-29) or zeroed
  if (geosData && geosData.geosBytes) {
    for (var gi = 0; gi < 9; gi++) data[entryOff + 21 + gi] = geosData.geosBytes[gi];
    // Update info block T/S to point to the newly allocated sector
    if (infoSec) {
      data[entryOff + 0x15] = infoSec.track;
      data[entryOff + 0x16] = infoSec.sector;
    }
  } else {
    for (var ui = 21; ui < 30; ui++) data[entryOff + ui] = 0x00;
  }

  data[entryOff + 30] = fileSectors.length & 0xFF;
  data[entryOff + 31] = (fileSectors.length >> 8) & 0xFF;

  // Update BAM for all sectors (file data + info block)
  var ctx = getDirContext();
  var bamOff = ctx.bamOff;
  for (var bi = 0; bi < sectorList.length; bi++) {
    bamMarkSectorUsed(data, sectorList[bi].track, sectorList[bi].sector, bamOff);
  }

  // Verify the write by reading back the file data
  var verify = readFileData(currentBuffer, entryOff);
  if (verify.error || verify.data.length !== fileData.length) {
    currentBuffer = snapshot;
    showModal('Write Error', ['Verification failed: ' + (verify.error || 'size mismatch')]);
    return false;
  }
  for (var vi = 0; vi < fileData.length; vi++) {
    if (verify.data[vi] !== fileData[vi]) {
      currentBuffer = snapshot;
      showModal('Write Error', ['Verification failed: data mismatch at byte ' + vi + '.']);
      return false;
    }
  }

  selectedEntryIndex = entryOff;
  return true;
}

// Convert ASCII filename to 16-byte PETSCII name padded with $A0
function asciiToNameBytes(name) {
  var bytes = new Uint8Array(16);
  name = name.toUpperCase().substring(0, 16);
  for (var i = 0; i < 16; i++) {
    if (i < name.length) {
      var ch = name.charCodeAt(i);
      if (ch >= 0x41 && ch <= 0x5A) bytes[i] = ch;
      else if (ch >= 0x30 && ch <= 0x39) bytes[i] = ch;
      else if (ch === 0x20) bytes[i] = 0x20;
      else if (ch >= 0x21 && ch <= 0x3F) bytes[i] = ch;
      else bytes[i] = 0x20;
    } else {
      bytes[i] = 0xA0;
    }
  }
  return bytes;
}

function importFileToDisk(fileName, fileData) {
  var dotIdx = fileName.lastIndexOf('.');
  var ext = dotIdx >= 0 ? fileName.substring(dotIdx + 1).toLowerCase() : '';

  // CVT import: GEOS ConVerT format
  if (ext === 'cvt') {
    importCvtFile(fileName, fileData);
    return;
  }

  // TXT import: convert ASCII to PETSCII and import as SEQ
  if (ext === 'txt') {
    var text = new TextDecoder().decode(fileData);
    var petBytes = [];
    for (var ti = 0; ti < text.length; ti++) {
      var ch = text.charCodeAt(ti);
      if (ch === 0x0A) { petBytes.push(0x0D); continue; } // LF → CR
      if (ch === 0x0D) continue; // skip CR (handled with LF)
      if (ch >= 0x41 && ch <= 0x5A) petBytes.push(ch); // A-Z → PETSCII uppercase
      else if (ch >= 0x61 && ch <= 0x7A) petBytes.push(ch - 0x20); // a-z → A-Z in PETSCII
      else if (ch >= 0x20 && ch <= 0x3F) petBytes.push(ch); // space, digits, punctuation
      else if (ch === 0x5B) petBytes.push(0x5B); // [
      else if (ch === 0x5D) petBytes.push(0x5D); // ]
      else petBytes.push(0x2E); // unknown → dot
    }
    fileData = new Uint8Array(petBytes);
    ext = 'seq';
  }

  var typeMap = { prg: 2, seq: 1, usr: 3, rel: 4, p00: 2, s00: 1, u00: 3, r00: 4 };
  var typeIdx = typeMap[ext];
  if (typeIdx === undefined) {
    showModal('Import Error', ['Unsupported file type: .' + ext]);
    return;
  }

  var baseName = dotIdx >= 0 ? fileName.substring(0, dotIdx) : fileName;
  var nameBytes = asciiToNameBytes(baseName);

  // PC64 format (.P00/.S00/etc.): 26-byte header with original filename
  if (ext === 'p00' || ext === 's00' || ext === 'u00' || ext === 'r00') {
    if (fileData.length > 26 && fileData[0] === 0x43 && fileData[1] === 0x36 && fileData[2] === 0x34) {
      // "C64File" magic — extract original name and strip header
      var pc64Name = '';
      for (var pi = 8; pi < 24 && fileData[pi] !== 0x00; pi++) pc64Name += String.fromCharCode(fileData[pi]);
      if (pc64Name) nameBytes = asciiToNameBytes(pc64Name);
      fileData = fileData.subarray(26);
    }
  }

  if (writeFileToDisk(typeIdx, nameBytes, fileData)) {
    var info = parseCurrentDir(currentBuffer);
    renderDisk(info);
    var numSectors = fileData.length === 0 ? 1 : Math.ceil(fileData.length / 254);
    showModal('Import Successful', ['"' + baseName.toUpperCase() + '" imported successfully.', numSectors + ' block(s) written.']);
  }
}

// ── CVT Import ─────────────────────────────────────────────────────
function showConfirmModal(title, message) {
  return new Promise(function(resolve) {
    document.getElementById('modal-title').textContent = title;
    var body = document.getElementById('modal-body');
    body.innerHTML = '<div class="text-base">' + escHtml(message) + '</div>';
    var footer = document.querySelector('#modal-overlay .modal-footer');
    footer.innerHTML = '<button class="modal-btn-secondary" id="confirm-cancel">Cancel</button>' +
      '<button id="confirm-ok">OK</button>';
    document.getElementById('confirm-ok').addEventListener('click', function() {
      document.getElementById('modal-overlay').classList.remove('open');
      resolve(true);
    });
    document.getElementById('confirm-cancel').addEventListener('click', function() {
      document.getElementById('modal-overlay').classList.remove('open');
      resolve(false);
    });
    document.getElementById('modal-overlay').classList.add('open');
  });
}

async function importCvtFile(fileName, cvt) {
  if (cvt.length < 762) {
    showModal('Import Error', ['CVT file too small.']);
    return;
  }

  // Warn if disk will be converted to GEOS format
  if (!hasGeosSignature(currentBuffer)) {
    var ok = await showConfirmModal('Import CVT',
      'This disk does not have a GEOS signature. Importing a CVT file will convert it to a GEOS disk. Continue?');
    if (!ok) return;
  }

  // Block 1 ($000-$0FD): directory entry
  var dirEntry = cvt.subarray(0, 254);

  // Detect variant from signature at offset 30
  var sigBytes = dirEntry.subarray(30, 60);
  var sig = '';
  for (var si = 0; si < 30 && sigBytes[si] !== 0; si++) sig += String.fromCharCode(sigBytes[si]);

  var isV10 = sig.indexOf('V1.0') >= 0;
  var isBroken = !isV10 && sig.indexOf('formatted GEOS file') >= 0;
  if (!isV10 && !isBroken) {
    showModal('Import Error', ['Not a valid CVT file (unknown signature).']);
    return;
  }

  // Extract name (bytes 3-18 of dir entry, $A0 padded)
  var nameBytes = new Uint8Array(16);
  for (var ni = 0; ni < 16; ni++) nameBytes[ni] = dirEntry[3 + ni];

  var typeByte = dirEntry[0]; // CBM file type (e.g. $84 = USR + closed)
  var typeIdx = typeByte & 0x07;
  if (typeIdx < 1) typeIdx = 3; // default to USR

  var geosStructure = dirEntry[0x15]; // CVT offset $15 = dir byte $17 = GEOS structure
  var geosFileType = dirEntry[0x16];  // CVT offset $16 = dir byte $18 = GEOS file type

  // GEOS metadata bytes = dir entry bytes $15-$1D (info T/S, structure, file type, date)
  // CVT block 1 stores dir bytes 2-31 at offsets 0-29, so dir byte $15 = CVT offset $13
  var geosBytes = new Uint8Array(9);
  for (var gi = 0; gi < 9; gi++) geosBytes[gi] = dirEntry[0x13 + gi];

  // Block 2 ($0FE-$1FB): info block (254 bytes, without T/S link)
  var infoBlock = new Uint8Array(256);
  infoBlock[0] = 0x00; infoBlock[1] = 0xFF; // standard info block marker
  for (var ib = 0; ib < 254; ib++) infoBlock[2 + ib] = cvt[254 + ib];

  var isVlir = geosStructure === 1;

  if (!isVlir) {
    // Sequential GEOS file: data starts at offset 508
    var seqData = cvt.subarray(508);
    // Trim trailing zeros from last block
    var geosData = { geosBytes: geosBytes, geosInfoBlock: infoBlock };
    // Set info T/S in geosBytes (will be updated by writeFileToDisk)
    geosBytes[0] = 0; // info track placeholder
    geosBytes[1] = 0; // info sector placeholder

    if (writeFileToDisk(typeIdx | 0x80, nameBytes, seqData, geosData)) {
      var info = parseCurrentDir(currentBuffer);
      renderDisk(info);
      var baseName = petsciiToReadable(readPetsciiString(nameBytes, 0, 16)).trim();
      showModal('CVT Import Successful', ['"' + baseName + '" imported successfully.']);
    }
  } else {
    // VLIR file: block 3 ($1FC-$2F9) = record index, then record data
    var recordIndex = cvt.subarray(508, 762);

    // Parse record sizes and extract record data
    var records = [];
    var dataPos = 762;
    for (var ri = 0; ri < 127; ri++) {
      var b0 = recordIndex[ri * 2];
      var b1 = recordIndex[ri * 2 + 1];
      if (b0 === 0 && b1 === 0) {
        records.push(null); // end marker
        break;
      }
      if (b0 === 0 && b1 === 0xFF) {
        records.push({ data: null }); // empty record
        continue;
      }
      // Populated record
      var grossSize, dataSize;
      if (isV10) {
        grossSize = b0 * 254;
        dataSize = (b0 - 1) * 254 + b1 - 1;
      } else {
        grossSize = b0 * 254 + b1;
        dataSize = grossSize;
      }
      if (dataPos + grossSize > cvt.length) {
        dataSize = Math.min(dataSize, cvt.length - dataPos);
        grossSize = Math.min(grossSize, cvt.length - dataPos);
      }
      records.push({ data: cvt.subarray(dataPos, dataPos + dataSize) });
      dataPos += grossSize;
    }

    // Write VLIR file to disk
    if (writeVlirFileToDisk(typeIdx | 0x80, nameBytes, records, geosBytes, infoBlock)) {
      var info2 = parseCurrentDir(currentBuffer);
      renderDisk(info2);
      var baseName2 = petsciiToReadable(readPetsciiString(nameBytes, 0, 16)).trim();
      showModal('CVT Import Successful', ['"' + baseName2 + '" imported successfully.']);
    }
  }
}

function writeVlirFileToDisk(typeByte, nameBytes, records, geosBytes, infoBlock) {
  pushUndo();
  var snapshot = currentBuffer.slice(0);
  var data = new Uint8Array(currentBuffer);
  var allocated = buildTrueAllocationMap(currentBuffer);

  // Count total sectors needed: 1 info block + 1 VLIR index + data sectors
  var totalSectors = 2; // info + index
  var recordMeta = []; // { startSectorIdx, numBlocks } for each record
  for (var ri = 0; ri < records.length; ri++) {
    var rec = records[ri];
    if (!rec || !rec.data || rec.data.length === 0) {
      recordMeta.push(null);
      continue;
    }
    var numBlocks = Math.max(1, Math.ceil(rec.data.length / 254));
    recordMeta.push({ numBlocks: numBlocks });
    totalSectors += numBlocks;
  }

  var sectorList = allocateSectors(allocated, totalSectors);
  if (sectorList.length < totalSectors) {
    currentBuffer = snapshot;
    showModal('Write Error', ['Not enough free sectors. Need ' + totalSectors + ', have ' + sectorList.length + '.']);
    return false;
  }

  var entryOff = findFreeDirEntry(currentBuffer);
  if (entryOff < 0) {
    currentBuffer = snapshot;
    showModal('Write Error', ['No free directory entry available.']);
    return false;
  }

  var secIdx = 0;

  // Write info block
  var infoSec = sectorList[secIdx++];
  var infoOff = sectorOffset(infoSec.track, infoSec.sector);
  for (var ib2 = 0; ib2 < 256; ib2++) data[infoOff + ib2] = infoBlock[ib2];
  data[infoOff] = 0x00; data[infoOff + 1] = 0xFF;

  // Write VLIR index sector
  var vlirSec = sectorList[secIdx++];
  var vlirOff = sectorOffset(vlirSec.track, vlirSec.sector);
  for (var vi = 0; vi < 256; vi++) data[vlirOff + vi] = 0x00;
  data[vlirOff] = 0x00; data[vlirOff + 1] = 0xFF;

  // Write each record's sector chain and update VLIR index
  for (var ri2 = 0; ri2 < records.length && ri2 < 127; ri2++) {
    var meta = recordMeta[ri2];
    if (!meta) {
      // Empty or null record
      if (records[ri2] === null) {
        // End marker
        data[vlirOff + 2 + ri2 * 2] = 0x00;
        data[vlirOff + 2 + ri2 * 2 + 1] = 0x00;
      } else {
        // Empty record
        data[vlirOff + 2 + ri2 * 2] = 0x00;
        data[vlirOff + 2 + ri2 * 2 + 1] = 0xFF;
      }
      continue;
    }

    var recData = records[ri2].data;
    var recSectors = sectorList.slice(secIdx, secIdx + meta.numBlocks);
    secIdx += meta.numBlocks;

    // Point VLIR index to first sector of this record
    data[vlirOff + 2 + ri2 * 2] = recSectors[0].track;
    data[vlirOff + 2 + ri2 * 2 + 1] = recSectors[0].sector;

    // Write sector chain
    var recPos = 0;
    for (var rsi = 0; rsi < recSectors.length; rsi++) {
      var sec = recSectors[rsi];
      var soff = sectorOffset(sec.track, sec.sector);

      if (rsi < recSectors.length - 1) {
        var nextSec = recSectors[rsi + 1];
        data[soff] = nextSec.track;
        data[soff + 1] = nextSec.sector;
        for (var b = 2; b < 256; b++) {
          data[soff + b] = recPos < recData.length ? recData[recPos++] : 0x00;
        }
      } else {
        data[soff] = 0x00;
        var bytesInLast = recData.length - recPos;
        if (bytesInLast <= 0) bytesInLast = 0;
        data[soff + 1] = bytesInLast + 1;
        for (var b2 = 2; b2 < 256; b2++) {
          data[soff + b2] = recPos < recData.length ? recData[recPos++] : 0x00;
        }
      }
    }
  }
  // Remaining VLIR index entries: 00/00 (end)
  for (var ri3 = records.length; ri3 < 127; ri3++) {
    data[vlirOff + 2 + ri3 * 2] = 0x00;
    data[vlirOff + 2 + ri3 * 2 + 1] = 0x00;
  }

  // Fill directory entry
  data[entryOff + 2] = typeByte;
  data[entryOff + 3] = vlirSec.track; // points to VLIR index, not info block
  data[entryOff + 4] = vlirSec.sector;
  for (var ni2 = 0; ni2 < 16; ni2++) data[entryOff + 5 + ni2] = nameBytes[ni2];

  // GEOS metadata
  for (var gi2 = 0; gi2 < 9; gi2++) data[entryOff + 21 + gi2] = geosBytes[gi2];
  data[entryOff + 0x15] = infoSec.track;
  data[entryOff + 0x16] = infoSec.sector;

  // Block count = all sectors (info + index + data)
  data[entryOff + 30] = totalSectors & 0xFF;
  data[entryOff + 31] = (totalSectors >> 8) & 0xFF;

  // Update BAM
  var ctx = getDirContext();
  var bamOff = ctx.bamOff;
  for (var ai = 0; ai < sectorList.length; ai++) {
    bamMarkSectorUsed(data, sectorList[ai].track, sectorList[ai].sector, bamOff);
  }

  // Ensure GEOS disk signature is present
  if (!hasGeosSignature(currentBuffer)) {
    writeGeosSignature(currentBuffer);
  }

  selectedEntryIndex = entryOff;
  return true;
}

// Find a free directory entry (typeByte === 0x00 with all entry bytes zeroed)
// Also allocates a new directory sector if needed (like insertFileEntry but without writing an entry)
function findFreeDirEntry(buffer, preAllocated) {
  var data = new Uint8Array(buffer);
  var fmt = currentFormat;
  var ctx = getDirContext();
  var bamOff = ctx.bamOff;
  var t = ctx.dirTrack, s = ctx.dirSector;
  var visited = {};
  var lastOff = -1;

  while (t !== 0) {
    var key = t + ':' + s;
    if (visited[key]) break;
    visited[key] = true;
    var off = sectorOffset(t, s);
    if (off < 0) break;
    lastOff = off;

    for (var i = 0; i < fmt.entriesPerSector; i++) {
      var eo = off + i * fmt.entrySize;
      var isEmpty = true;
      for (var j = 2; j < 32; j++) {
        if (data[eo + j] !== 0x00) { isEmpty = false; break; }
      }
      if (isEmpty) return eo;
    }

    t = data[off]; s = data[off + 1];
  }

  // No empty slot — allocate new directory sector
  var dirTrk, newSector;

  if (fmt.subdirLinked && currentPartition && currentPartition.dnpDir) {
    // Linked subdirs: directory can span any track, use allocateSectors
    var allocMap = preAllocated || buildTrueAllocationMap(buffer);
    var secList = allocateSectors(allocMap, 1);
    if (secList.length === 0) return -1;
    dirTrk = secList[0].track;
    newSector = secList[0].sector;
  } else {
    // Standard: allocate on the directory track only
    dirTrk = ctx.dirTrackNum;
    var spt = sectorsPerTrack(dirTrk);
    var protectedSecs = fmt.getProtectedSectors(dirTrk);
    newSector = -1;
    for (var cs = 1; cs < spt; cs++) {
      if (visited[dirTrk + ':' + cs]) continue;
      if (protectedSecs.indexOf(cs) !== -1) continue;
      newSector = cs;
      break;
    }
    if (newSector === -1) return -1;
  }

  if (lastOff >= 0) {
    data[lastOff] = dirTrk;
    data[lastOff + 1] = newSector;
  }

  var newOff = sectorOffset(dirTrk, newSector);
  data[newOff] = 0x00;
  data[newOff + 1] = 0xFF;
  for (var zi = 2; zi < 256; zi++) data[newOff + zi] = 0x00;

  // Mark sector as used in BAM
  bamMarkSectorUsed(data, dirTrk, newSector, bamOff);

  return newOff;
}

document.getElementById('opt-lock').addEventListener('click', (e) => {
  e.stopPropagation();
  if (!currentBuffer || selectedEntryIndex < 0) return;
  closeMenus();
  pushUndo();
  const data = new Uint8Array(currentBuffer);
  var entries = selectedEntries.length > 0 ? selectedEntries : [selectedEntryIndex];
  for (var i = 0; i < entries.length; i++) data[entries[i] + 2] ^= 0x40;
  const info = parseCurrentDir(currentBuffer);
  renderDisk(info);
});

document.getElementById('opt-splat').addEventListener('click', (e) => {
  e.stopPropagation();
  if (!currentBuffer || selectedEntryIndex < 0) return;
  closeMenus();
  pushUndo();
  const data = new Uint8Array(currentBuffer);
  var entries = selectedEntries.length > 0 ? selectedEntries : [selectedEntryIndex];
  for (var i = 0; i < entries.length; i++) data[entries[i] + 2] ^= 0x80;
  const info = parseCurrentDir(currentBuffer);
  renderDisk(info);
});

document.getElementById('opt-scratch').addEventListener('click', (e) => {
  e.stopPropagation();
  if (!currentBuffer || selectedEntryIndex < 0) return;
  closeMenus();
  pushUndo();
  var data = new Uint8Array(currentBuffer);
  var entryOff = selectedEntryIndex;
  var fmt = currentFormat;
  var bamOff = sectorOffset(fmt.bamTrack, fmt.bamSector);

  // Clear the closed bit (scratch the file)
  data[entryOff + 2] &= ~0x80;

  // Free all sectors in the chain in BAM
  var t = data[entryOff + 3], s = data[entryOff + 4];
  var visited = {};
  while (t !== 0) {
    if (t < 1 || t > currentTracks || s >= fmt.sectorsPerTrack(t)) break;
    var key = t + ':' + s;
    if (visited[key]) break;
    visited[key] = true;
    // Set the sector's bit in BAM (mark as free)
    bamMarkSectorFree(data, t, s, bamOff);
    var off = sectorOffset(t, s);
    if (off < 0) break;
    t = data[off]; s = data[off + 1];
  }

  var info = parseCurrentDir(currentBuffer);
  renderDisk(info);
  updateMenuState();
  updateEntryMenuState();
});

document.getElementById('opt-unscratch').addEventListener('click', (e) => {
  e.stopPropagation();
  if (!currentBuffer || selectedEntryIndex < 0) return;
  closeMenus();
  pushUndo();
  var data = new Uint8Array(currentBuffer);
  var entryOff = selectedEntryIndex;

  // Set file type to PRG + closed
  // Set closed bit, preserve original file type; default to PRG if type is DEL
  if ((data[entryOff + 2] & 0x07) === 0) data[entryOff + 2] = 0x82;
  else data[entryOff + 2] |= 0x80;

  // Mark all sectors in the chain as used in BAM
  var fmt = currentFormat;
  var bamOff = sectorOffset(fmt.bamTrack, fmt.bamSector);
  var t = data[entryOff + 3], s = data[entryOff + 4];
  var visited = {}, sectorCount = 0;
  while (t !== 0) {
    if (t < 1 || t > currentTracks || s >= fmt.sectorsPerTrack(t)) break;
    var key = t + ':' + s;
    if (visited[key]) break;
    visited[key] = true;
    sectorCount++;
    bamMarkSectorUsed(data, t, s, bamOff);
    var off = sectorOffset(t, s);
    if (off < 0) break;
    t = data[off]; s = data[off + 1];
  }

  // Update block count in directory entry
  data[entryOff + 30] = sectorCount & 0xFF;
  data[entryOff + 31] = (sectorCount >> 8) & 0xFF;

  var info = parseCurrentDir(currentBuffer);
  renderDisk(info);
  updateMenuState();
  updateEntryMenuState();
});

document.querySelectorAll('#opt-change-type .submenu .option').forEach(el => {
  el.addEventListener('click', (e) => {
    e.stopPropagation();
    if (!currentBuffer || selectedEntryIndex < 0) return;
    closeMenus();
    var typeIdx = parseInt(el.dataset.typeidx, 10);
    var entries = selectedEntries.length > 0 ? selectedEntries : [selectedEntryIndex];
    for (var i = 0; i < entries.length; i++) changeFileType(entries[i], typeIdx);
  });
});

