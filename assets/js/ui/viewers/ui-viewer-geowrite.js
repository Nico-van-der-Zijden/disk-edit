// ── geoWrite Document Viewer ─────────────────────────────────────────
// GEOS font IDs → CSS stack (viewer), RTF font name and PDF base-14 family
// (exports). CSS stacks use single quotes: they end up inside style="…".
var GEOS_FONT_SERIF = { css: "'Times New Roman',Times,Georgia,serif", rtf: 'Times New Roman', pdf: 'Times' };
var GEOS_FONT_SANS  = { css: 'Helvetica,Arial,sans-serif', rtf: 'Helvetica', pdf: 'Helvetica' };
var GEOS_FONTS = {
  0:  { css: "'Courier New',Courier,monospace", rtf: 'Courier New', pdf: 'Courier' }, // BSW (system mono)
  1:  GEOS_FONT_SANS,                                                                  // University
  2:  GEOS_FONT_SANS,                                                                  // California
  3:  GEOS_FONT_SERIF,                                                                 // Roma
  4:  GEOS_FONT_SERIF,                                                                 // Dwinelle
  5:  GEOS_FONT_SANS,                                                                  // Cory
  6:  { css: "'C64 Pro Mono',monospace", rtf: 'Courier New', pdf: 'Courier' },        // Commodore
  7:  { css: "'Palatino Linotype',Palatino,'Book Antiqua',serif", rtf: 'Palatino Linotype', pdf: 'Times' }, // Monterey
  8:  GEOS_FONT_SERIF,                                                                 // LW Roma
  9:  GEOS_FONT_SANS,                                                                  // LW Cal
  10: { css: 'Symbol,serif', rtf: 'Symbol', pdf: 'Helvetica' },                       // LW Greek
  11: GEOS_FONT_SERIF                                                                  // LW Barrows
};

function geosFontInfo(fontId) {
  return GEOS_FONTS[fontId] || GEOS_FONT_SERIF;
}

// NEWCARDSET font word → { fontId, pointSize }.
function geoWriteSplitFontWord(word) {
  return { fontId: word >> 5, pointSize: word & 0x1F };
}

// Parse one geoWrite text page (VLIR record 0-60) into a flat element list:
//   { type:'text', text, styleSeq, fontId, fontSize, bold, italic, underline,
//     outline, superscript, subscript }
//   { type:'ruler', align (0=left 1=center 2=right 3=justify), spacing (0=1 1=1.5 2=2) }
//   { type:'image', record, w, h, missing }   — w/h from the image record when present
//   { type:'tab', <same style fields as text> } | { type:'cr' } | { type:'pagebreak' }
// styleSeq changes on every NEWCARDSET so renderers can group style runs.
// `images` maps record number → { w, h }.
function parseGeoWritePage(rec, images) {
  var elements = [];
  var pos = 0, len = rec.length;

  var fontId = 0, fontSize = 12, styleSeq = 0;
  var bold = false, italic = false, underline = false, outline = false;
  var superscript = false, subscript = false;
  var currentText = '';

  function styled(type) {
    return { type: type, styleSeq: styleSeq, fontId: fontId, fontSize: fontSize,
      bold: bold, italic: italic, underline: underline, outline: outline,
      superscript: superscript, subscript: subscript };
  }
  function flushText() {
    if (currentText.length === 0) return;
    var el = styled('text');
    el.text = currentText;
    elements.push(el);
    currentText = '';
  }

  while (pos < len) {
    var b = rec[pos];
    if (b === 0x00) break;
    else if (b === 0x11) { // ESC_RULER: 1 + 26 bytes
      if (pos + 27 > len) break;
      flushText();
      var justByte = rec[pos + 23];
      elements.push({ type: 'ruler', align: justByte & 0x03, spacing: (justByte >> 2) & 0x03 });
      pos += 27;
    } else if (b === 0x17) { // NEWCARDSET: font word + style byte
      if (pos + 4 > len) break;
      flushText();
      var font = geoWriteSplitFontWord(rec[pos + 1] | (rec[pos + 2] << 8));
      var styleByte = rec[pos + 3];
      fontId = font.fontId;
      fontSize = font.pointSize || 12;
      underline = (styleByte & 0x80) !== 0;
      bold = (styleByte & 0x40) !== 0;
      italic = (styleByte & 0x10) !== 0;
      outline = (styleByte & 0x08) !== 0;
      superscript = (styleByte & 0x04) !== 0;
      subscript = (styleByte & 0x02) !== 0;
      styleSeq++;
      pos += 4;
    } else if (b === 0x10) { // ESC_GRAPHICS: width in cards, height, record
      if (pos + 5 > len) break;
      flushText();
      var imgRec = rec[pos + 4];
      var img = images && images[imgRec];
      elements.push({ type: 'image', record: imgRec,
        w: img ? img.w : rec[pos + 1] * 8,
        h: img ? img.h : (rec[pos + 2] | (rec[pos + 3] << 8)),
        missing: !img });
      pos += 5;
    } else if (b === 0x0D) {
      flushText();
      elements.push({ type: 'cr' });
      pos++;
    } else if (b === 0x09) {
      flushText();
      elements.push(styled('tab'));
      pos++;
    } else if (b === 0x0C) {
      flushText();
      elements.push({ type: 'pagebreak' });
      pos++;
    } else if (b >= 0x20 && b <= 0x7E) {
      currentText += String.fromCharCode(b);
      pos++;
    } else if (b === 0x08 || b === 0x18) { pos += 20; } // V1.x compat
    else if (b === 0xF5) { pos += 11; }                 // V1.x compat
    else pos++;
  }
  flushText();
  return elements;
}

function showGeoWriteViewer(entryOff) {
  if (!currentBuffer) return;
  var data = new Uint8Array(currentBuffer);
  var name = petsciiToReadable(readPetsciiString(data, entryOff + 5, 16)).trim();
  var records = readVLIRRecords(currentBuffer, entryOff, getCurrentCtx());
  if (records.length === 0) {
    showModal('geoWrite', ['No data found in this document.']);
    return;
  }

  var imageCache = renderGeoWriteImageCanvases(records);
  for (var ri in imageCache) imageCache[ri].url = imageCache[ri].canvas.toDataURL();

  var html = '<div class="geowrite-doc">';
  var pageCount = 0;

  // Text pages are records 0-60
  for (var pi = 0; pi <= 60 && pi < records.length; pi++) {
    var rec = records[pi];
    if (!rec || rec.length === 0) continue;

    pageCount++;
    html += '<div class="geowrite-page">';
    html += geoWritePageToHtml(parseGeoWritePage(rec, imageCache), imageCache);
    html += '</div>';
  }

  if (pageCount === 0) {
    showModal('geoWrite', ['No text pages found in this document.']);
    return;
  }

  html += '</div>';

  showViewerModal(
    'geoWrite — "' + name + '" (' + pageCount + ' page' + (pageCount > 1 ? 's' : '') + ')',
    html
  );
}

var GEOWRITE_ALIGN_CSS = ['left', 'center', 'right', 'justify'];

function geoWriteSpanStyle(el) {
  var styles = ['font-family:' + geosFontInfo(el.fontId).css];
  // GEOS sizes are points; 1pt = 1.333px, floored at 10pt for readability
  var pxSize = Math.round(Math.max(10, el.fontSize * 1.333));
  if (el.superscript || el.subscript) pxSize = Math.round(pxSize * 0.7);
  styles.push('font-size:' + pxSize + 'px');
  if (el.bold) styles.push('font-weight:bold');
  if (el.italic) styles.push('font-style:italic');
  if (el.underline) styles.push('text-decoration:underline');
  if (el.outline) styles.push('-webkit-text-stroke:0.5px;color:transparent');
  if (el.superscript) styles.push('vertical-align:super');
  if (el.subscript) styles.push('vertical-align:sub');
  return styles.join(';');
}

function geoWritePageToHtml(elements, imageCache) {
  var html = '';
  var align = 'left', lineSpacing = 1;
  var paraOpen = false, spanSeq = -1;

  function openPara() {
    if (paraOpen) return;
    var style = 'text-align:' + align;
    if (lineSpacing > 1) style += ';line-height:' + lineSpacing;
    html += '<div class="geowrite-para" style="' + style + '">';
    paraOpen = true;
  }
  function closePara() {
    flushSpan();
    if (!paraOpen) return;
    html += '</div>';
    paraOpen = false;
  }
  function flushSpan() {
    if (spanSeq >= 0) { html += '</span>'; spanSeq = -1; }
  }
  function ensureSpan(el) {
    if (spanSeq === el.styleSeq) return;
    flushSpan();
    openPara();
    html += '<span style="' + geoWriteSpanStyle(el) + '">';
    spanSeq = el.styleSeq;
  }

  for (var i = 0; i < elements.length; i++) {
    var el = elements[i];
    if (el.type === 'ruler') {
      closePara();
      align = GEOWRITE_ALIGN_CSS[el.align];
      lineSpacing = el.spacing === 0 ? 1 : el.spacing === 1 ? 1.5 : 2;
    } else if (el.type === 'text') {
      ensureSpan(el);
      html += escHtml(el.text);
    } else if (el.type === 'tab') {
      ensureSpan(el);
      html += '<span class="geowrite-tab">\t</span>';
    } else if (el.type === 'cr') {
      flushSpan();
      openPara();
      closePara();
    } else if (el.type === 'pagebreak') {
      closePara();
      html += '<div class="geowrite-pagebreak">─── page break ───</div>';
    } else if (el.type === 'image') {
      flushSpan();
      openPara();
      var img = imageCache[el.record];
      if (img) {
        html += '<img class="geowrite-img" src="' + img.url +
          '" width="' + img.w + '" height="' + img.h + '">';
      } else {
        html += '<span style="color:#6C6C6C">[Image: record ' + el.record +
          ', ' + el.w + 'x' + el.h + ']</span>';
      }
    }
  }
  closePara();

  if (html === '') html = '<div class="geowrite-para" style="color:#6C6C6C">(empty page)</div>';
  return html;
}
