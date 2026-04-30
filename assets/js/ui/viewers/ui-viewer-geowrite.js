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

  showViewerModal(
    'geoWrite \u2014 "' + name + '" (' + pageCount + ' page' + (pageCount > 1 ? 's' : '') + ')',
    html
  );
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

