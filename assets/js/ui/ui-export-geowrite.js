// ── geoWrite RTF/PDF/TXT Export ───────────────────────────────────────
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
  Object.keys(fontVariants).forEach(function(fv) {
    fontResNames[fv] = 'F' + fontResIdx;
    fontResIdx++;
  });

  // Create font objects
  var fontObjIds = {};
  Object.keys(fontVariants).forEach(function(fv) {
    var fObjId = addObj('<< /Type /Font /Subtype /Type1 /BaseFont /' + fv + ' /Encoding /WinAnsiEncoding >>');
    fontObjIds[fv] = fObjId;
  });

  // Create image XObjects
  Object.keys(doc.images).forEach(function(imgRec) {
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
  });

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
    Object.keys(fontResNames).forEach(function(fr) {
      fontRes += '/' + fontResNames[fr] + ' ' + fontObjIds[fr] + ' 0 R ';
    });
    var imgRes = '';
    Object.keys(imgObjIds).forEach(function(ir) {
      imgRes += '/Im' + ir + ' ' + imgObjIds[ir] + ' 0 R ';
    });

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
