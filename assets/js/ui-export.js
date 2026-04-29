// ── Name Case Operations ──────────────────────────────────────────────
function changeNameCase(entryOff, mode) {
  var data = new Uint8Array(currentBuffer);
  for (var i = 0; i < 16; i++) {
    var b = data[entryOff + 5 + i];
    if (b === 0xA0) break; // end of name
    if (mode === 'upper') {
      // PETSCII lowercase ($41-$5A) → uppercase ($C1-$DA)
      if (b >= 0x41 && b <= 0x5A) data[entryOff + 5 + i] = b + 0x80;
    } else if (mode === 'lower') {
      // PETSCII uppercase ($C1-$DA) → lowercase ($41-$5A)
      if (b >= 0xC1 && b <= 0xDA) data[entryOff + 5 + i] = b - 0x80;
    } else {
      // Toggle
      if (b >= 0x41 && b <= 0x5A) data[entryOff + 5 + i] = b + 0x80;
      else if (b >= 0xC1 && b <= 0xDA) data[entryOff + 5 + i] = b - 0x80;
    }
  }
}

['upper', 'lower', 'toggle'].forEach(function(mode) {
  document.getElementById('opt-case-' + mode).addEventListener('click', function(e) {
    e.stopPropagation();
    if (!currentBuffer || selectedEntryIndex < 0) return;
    closeMenus();
    pushUndo();
    var entries = selectedEntries.length > 0 ? selectedEntries : [selectedEntryIndex];
    for (var i = 0; i < entries.length; i++) changeNameCase(entries[i], mode);
    var info = parseCurrentDir(currentBuffer);
    renderDisk(info);
  });
});

// ── Compact Directory ────────────────────────────────────────────────
document.getElementById('opt-compact-dir').addEventListener('click', function(e) {
  e.stopPropagation();
  if (!currentBuffer) return;
  closeMenus();
  pushUndo();
  var data = new Uint8Array(currentBuffer);
  var fmt = currentFormat;
  var ctx = getDirContext();
  var t = ctx.dirTrack, s = ctx.dirSector;
  var visited = {};
  var allEntries = []; // collect all non-deleted entries

  // Read all directory entries
  while (t !== 0) {
    var key = t + ':' + s;
    if (visited[key]) break;
    visited[key] = true;
    var off = sectorOffset(t, s);
    if (off < 0) break;
    for (var i = 0; i < fmt.entriesPerSector; i++) {
      var eo = off + i * fmt.entrySize;
      var typeByte = data[eo + 2];
      if ((typeByte & 0x07) > 0) {
        // Non-deleted entry - save the 30 bytes (offset 2-31)
        var entry = new Uint8Array(30);
        for (var j = 0; j < 30; j++) entry[j] = data[eo + 2 + j];
        allEntries.push(entry);
      }
    }
    t = data[off]; s = data[off + 1];
  }

  // Rewrite directory with compacted entries
  t = ctx.dirTrack; s = ctx.dirSector;
  visited = {};
  var entryIdx = 0;
  while (t !== 0) {
    var key2 = t + ':' + s;
    if (visited[key2]) break;
    visited[key2] = true;
    var off2 = sectorOffset(t, s);
    if (off2 < 0) break;
    for (var i2 = 0; i2 < fmt.entriesPerSector; i2++) {
      var eo2 = off2 + i2 * fmt.entrySize;
      if (entryIdx < allEntries.length) {
        for (var j2 = 0; j2 < 30; j2++) data[eo2 + 2 + j2] = allEntries[entryIdx][j2];
        entryIdx++;
      } else {
        // Clear remaining entries
        for (var j3 = 2; j3 < 32; j3++) data[eo2 + j3] = 0x00;
      }
    }
    t = data[off2]; s = data[off2 + 1];
  }

  var removed = Object.keys(visited).length * fmt.entriesPerSector - allEntries.length;
  var info = parseCurrentDir(currentBuffer);
  renderDisk(info);
  selectedEntryIndex = -1;
  updateEntryMenuState();
  showModal('Compact Directory', [allEntries.length + ' file(s) kept, ' + removed + ' empty slot(s) removed.']);
});

// ── Decompress ZipCode ───────────────────────────────────────────────
document.getElementById('opt-unzip').addEventListener('click', function(e) {
  e.stopPropagation();
  if (!currentBuffer) return;
  closeMenus();

  var data = new Uint8Array(currentBuffer);
  var info = parseCurrentDir(currentBuffer);

  // Find ZipCode sets: look for files starting with "1!" and matching 2!/3!/4!
  var sets = {};
  for (var i = 0; i < info.entries.length; i++) {
    var en = info.entries[i];
    if (en.deleted) continue;
    var name = petsciiToReadable(en.name || '').trim();
    if (name.length < 3) continue;
    var prefix = name.substring(0, 2);
    if (prefix === '1!' || prefix === '2!' || prefix === '3!' || prefix === '4!') {
      var baseName = name.substring(2);
      if (!sets[baseName]) sets[baseName] = {};
      sets[baseName][prefix[0]] = en.entryOff;
    }
  }

  // Find complete sets (all 4 files present)
  var completeSets = [];
  for (var sn in sets) {
    if (sets[sn]['1'] && sets[sn]['2'] && sets[sn]['3'] && sets[sn]['4']) {
      completeSets.push({ name: sn, offsets: sets[sn] });
    }
  }

  if (completeSets.length === 0) {
    // Show what we found
    var partial = Object.keys(sets);
    if (partial.length > 0) {
      var msgs = ['Incomplete ZipCode set(s) found:'];
      for (var pk = 0; pk < partial.length; pk++) {
        var found = Object.keys(sets[partial[pk]]).sort().map(function(n) { return n + '!'; }).join(', ');
        msgs.push('"' + partial[pk] + '": found ' + found + ' (need 1!, 2!, 3!, 4!)');
      }
      showModal('Decompress ZipCode', msgs);
    } else {
      showModal('Decompress ZipCode', ['No ZipCode files found on this disk.', 'ZipCode files are named 1!NAME, 2!NAME, 3!NAME, 4!NAME.']);
    }
    return;
  }

  // If multiple sets, use the first one (could add a chooser later)
  var set = completeSets[0];
  if (completeSets.length > 1) {
    // TODO: let user pick which set
  }

  // Read all 4 files
  var files = [];
  for (var fi = 1; fi <= 4; fi++) {
    var result = readFileData(currentBuffer, set.offsets[String(fi)]);
    if (result.error || result.data.length < 3) {
      showModal('Decompress Error', ['Failed to read file ' + fi + '!' + set.name + ': ' + (result.error || 'too small')]);
      return;
    }
    files.push(result.data);
  }

  // Decompress into a D64
  var d64 = decompressZipCode(files);
  if (!d64) {
    showModal('Decompress Error', ['ZipCode decompression failed — data may be corrupt.']);
    return;
  }

  // Open as new tab
  saveActiveTab();
  currentBuffer = d64;
  currentFileName = set.name + '.d64';
  currentPartition = null;
  selectedEntryIndex = -1;
  parseDisk(currentBuffer);
  var tab = createTab(set.name + '.d64', currentBuffer, set.name + '.d64');
  activeTabId = tab.id;
  var newInfo = parseCurrentDir(currentBuffer);
  renderDisk(newInfo);
  renderTabs();
  updateMenuState();
  showModal('Decompress ZipCode', ['"' + set.name + '" decompressed successfully.', 'Opened as new tab.']);
});

function decompressZipCode(files) {
  // Standard D64: 35 tracks, 174848 bytes
  var spt = function(t) {
    if (t <= 17) return 21;
    if (t <= 24) return 19;
    if (t <= 30) return 18;
    return 17;
  };

  var d64 = new Uint8Array(174848);
  var tracksPerFile = [8, 8, 9, 10];
  var track = 1;

  for (var fi = 0; fi < 4; fi++) {
    var fileData = files[fi];
    var pos = 2; // skip PRG load address

    for (var ti = 0; ti < tracksPerFile[fi]; ti++) {
      var sectors = spt(track);

      for (var si = 0; si < sectors; si++) {
        if (pos >= fileData.length) return null;

        var packByte = fileData[pos++];
        var method = (packByte >> 6) & 0x03;
        var sectorNum = packByte & 0x3F;

        // Calculate D64 offset for this sector
        var d64Off = 0;
        for (var ct = 1; ct < track; ct++) d64Off += spt(ct) * 256;
        d64Off += sectorNum * 256;

        if (d64Off + 256 > d64.length) return null;

        if (method === 0) {
          // Store: raw 256 bytes
          if (pos + 256 > fileData.length) return null;
          for (var bi = 0; bi < 256; bi++) d64[d64Off + bi] = fileData[pos++];

        } else if (method === 1) {
          // Fill: single byte repeated 256 times
          if (pos >= fileData.length) return null;
          var fillVal = fileData[pos++];
          for (var bi2 = 0; bi2 < 256; bi2++) d64[d64Off + bi2] = fillVal;

        } else if (method === 2) {
          // RLE compressed
          if (pos >= fileData.length) return null;
          var rleEscape = fileData[pos++];
          var decoded = 0;

          while (decoded < 256) {
            if (pos >= fileData.length) return null;
            var b = fileData[pos++];

            if (b === rleEscape) {
              if (pos + 1 >= fileData.length) return null;
              var count = fileData[pos++];
              var fill = fileData[pos++];
              if (count === 0) count = 256;
              for (var ri = 0; ri < count && decoded < 256; ri++) {
                d64[d64Off + decoded++] = fill;
              }
            } else {
              d64[d64Off + decoded++] = b;
            }
          }

        } else {
          // Method 3: invalid
          return null;
        }
      }
      track++;
    }
  }

  return d64.buffer;
}

// ── LNX (Lynx) archive extraction ────────────────────────────────────
// Parse the archive and write every file onto a fresh D64. Globals
// (currentBuffer, currentFormat, currentTracks) are pointed at the new
// D64 for the duration so writeFileToDisk can operate normally; the
// caller is responsible for wiring the result into a new tab.
//
// Returns { buffer, imported, skipped: [{ name, reason }], error? }.
function extractLnxToNewD64(buffer) {
  var parsed = parseLnxArchive(buffer);
  if (parsed.error) return { error: parsed.error };

  saveActiveTab();

  var d64 = createEmptyDisk('d64', 35);
  currentBuffer = d64;
  currentFormat = DISK_FORMATS.d64;
  currentTracks = 35;
  currentPartition = null;
  selectedEntryIndex = -1;
  parseDisk(currentBuffer);
  undoStack = [];
  cleanStackLength = 0;
  tabDirty = false;

  function nameToDisplay(nameBytes) {
    var s = '';
    for (var i = 0; i < nameBytes.length; i++) {
      var b = nameBytes[i];
      if (b === 0xA0 || b === 0x00) break;
      if (b >= 0x20 && b <= 0x7E) s += String.fromCharCode(b);
      else if (b >= 0xC1 && b <= 0xDA) s += String.fromCharCode(b - 0x80);
      else s += '.';
    }
    return s.trim();
  }

  // Detect GEOS ConVerT files. If any are present, apply the GEOS signature
  // to the fresh D64 so subsequent writes land on a proper GEOS-formatted
  // disk, and route CVT files through the CVT import path so their VLIR
  // record structure is reconstructed on the target disk.
  var hasCvt = false;
  for (var ci = 0; ci < parsed.files.length; ci++) {
    if (isCvtFile(parsed.files[ci].data)) { hasCvt = true; break; }
  }
  if (hasCvt) writeGeosSignature(currentBuffer);

  var imported = 0;
  var skipped = [];
  for (var i = 0; i < parsed.files.length; i++) {
    var f = parsed.files[i];
    var display = nameToDisplay(f.name) || '<file ' + (i + 1) + '>';
    if (f.typeIdx < 0 || f.typeIdx === FILE_TYPE.DEL) {
      skipped.push({ name: display, reason: 'unsupported type' });
      continue;
    }

    // CVT: rebuild the GEOS file properly (VLIR structure, info block).
    if (isCvtFile(f.data)) {
      var cvtResult = importCvtFileCore(f.data, /*silent*/ true);
      if (cvtResult.error) {
        skipped.push({ name: display, reason: cvtResult.error });
      } else {
        imported++;
      }
      continue;
    }

    // Plain file: write as-is. The parser returns a 16-byte filename;
    // preserve internal spaces (valid PETSCII), only trailing NUL/$A0 are
    // padding.
    var nameBytes = new Uint8Array(16);
    var trailStart = 16;
    for (var ni = 15; ni >= 0; ni--) {
      var b = ni < f.name.length ? f.name[ni] : 0xA0;
      if (ni === trailStart - 1 && (b === 0x00 || b === 0xA0)) trailStart = ni;
      nameBytes[ni] = b;
    }
    for (var pi = trailStart; pi < 16; pi++) nameBytes[pi] = 0xA0;

    if (writeFileToDisk(f.typeIdx, nameBytes, f.data, null, true)) {
      imported++;
    } else {
      skipped.push({ name: display, reason: 'disk or directory full' });
    }
  }

  // Fresh-tab state: clear undo and dirty flag so the new D64 opens clean
  // (user can Save As to keep it).
  undoStack = [];
  cleanStackLength = 0;
  tabDirty = false;

  return { buffer: currentBuffer, imported: imported, skipped: skipped, comment: parsed.comment };
}

// Open an LNX archive as a new D64 tab. Called from drag-drop and file-picker.
function openLnxArchiveAsTab(buffer, archiveName) {
  var result = extractLnxToNewD64(buffer);
  if (result.error) {
    showModal('LYNX Error', [archiveName + ': ' + result.error]);
    return null;
  }
  var base = archiveName.replace(/\.lnx$/i, '');
  var tabName = base + '.d64';
  var tab = createTab(tabName, currentBuffer, null);
  activeTabId = tab.id;

  var info = parseCurrentDir(currentBuffer);
  renderDisk(info);
  renderTabs();
  updateMenuState();

  var lines = ['"' + archiveName + '": extracted ' + result.imported + ' file(s) to a new D64.'];
  if (result.comment) lines.push('Comment: ' + result.comment);
  if (result.skipped.length > 0) {
    lines.push('');
    lines.push(result.skipped.length + ' file(s) skipped:');
    var cap = Math.min(20, result.skipped.length);
    for (var si = 0; si < cap; si++) {
      lines.push('  ' + result.skipped[si].name + ' \u2014 ' + result.skipped[si].reason);
    }
    if (result.skipped.length > cap) lines.push('  \u2026 and ' + (result.skipped.length - cap) + ' more');
  }
  showModal('Decompress LYNX', lines);
  return tab;
}

// ── File Chains ──────────────────────────────────────────────────────
// Walk a single sector chain via T/S links. Returns the list of sectors
// visited and a `loop` flag if a cycle was detected. Does not call any
// external helpers \u2014 keeps this self-contained for the file-chain view.
function fchainWalkChain(data, startT, startS) {
  var fmt = currentFormat;
  var sectors = [];
  var loop = false;
  var visited = {};
  var ft = startT, fs = startS;
  while (ft !== 0) {
    if (ft < 1 || ft > currentTracks) break;
    if (fs >= fmt.sectorsPerTrack(ft)) break;
    var key = ft + ':' + fs;
    if (visited[key]) { loop = true; break; }
    visited[key] = true;
    sectors.push({ t: ft, s: fs });
    var off = sectorOffset(ft, fs);
    if (off < 0) break;
    ft = data[off]; fs = data[off + 1];
  }
  return { sectors: sectors, loop: loop };
}

// Decompose a directory entry into its constituent sector chains. The
// shape depends on the file type:
//   regular file  \u2192 [{ kind:'main', sectors }]
//   REL file      \u2192 [main, side-sectors]
//   GEOS sequential \u2192 [info-block, main]
//   GEOS VLIR     \u2192 [info-block, vlir-index, record 0, record 1, ...]
// Each entry: { kind, label, sectors[], loop?, byteCount? }
function fchainAnalyse(data, entryOff) {
  var fmt = currentFormat;
  var typeIdx = data[entryOff + 2] & 0x07;
  var startT = data[entryOff + 3], startS = data[entryOff + 4];
  var isRel = (typeIdx === FILE_TYPE.REL);
  var isGeos = data[entryOff + 0x18] > 0 && !isRel;
  var isVlir = isGeos && data[entryOff + 0x17] === 0x01;

  var chains = [];

  function addInfoBlock() {
    var t = data[entryOff + 0x15], s = data[entryOff + 0x16];
    if (t < 1 || t > currentTracks || s >= fmt.sectorsPerTrack(t)) return;
    chains.push({ kind: 'info', label: 'GEOS info', sectors: [{ t: t, s: s }] });
  }

  if (isVlir) {
    addInfoBlock();
    chains.push({ kind: 'index', label: 'VLIR index', sectors: [{ t: startT, s: startS }] });
    var idxOff = sectorOffset(startT, startS);
    if (idxOff >= 0) {
      for (var vri = 0; vri < 127; vri++) {
        var recT = data[idxOff + 2 + vri * 2];
        var recS = data[idxOff + 2 + vri * 2 + 1];
        if (recT === 0 && recS === 0) break; // end of records
        if (recT === 0) {
          // Empty record slot (recS = $FF for unused). Show as placeholder
          // so the record-number sequence stays visible.
          chains.push({ kind: 'record-empty', label: 'Record ' + vri, sectors: [], note: 'empty' });
          continue;
        }
        var rec = fchainWalkChain(data, recT, recS);
        chains.push({ kind: 'record', label: 'Record ' + vri, sectors: rec.sectors, loop: rec.loop });
      }
    }
  } else if (isGeos) {
    addInfoBlock();
    var seqMain = fchainWalkChain(data, startT, startS);
    chains.push({ kind: 'main', label: 'Data', sectors: seqMain.sectors, loop: seqMain.loop });
  } else if (isRel) {
    var relMain = fchainWalkChain(data, startT, startS);
    chains.push({ kind: 'main', label: 'Data', sectors: relMain.sectors, loop: relMain.loop });
    var sideT = data[entryOff + 0x15], sideS = data[entryOff + 0x16];
    if (sideT >= 1) {
      var side = fchainWalkChain(data, sideT, sideS);
      chains.push({ kind: 'side', label: 'Side-sectors', sectors: side.sectors, loop: side.loop });
    }
  } else {
    var main = fchainWalkChain(data, startT, startS);
    chains.push({ kind: 'main', label: 'Data', sectors: main.sectors, loop: main.loop });
  }

  return { chains: chains, isGeos: isGeos, isVlir: isVlir, isRel: isRel, typeIdx: typeIdx };
}

function fchainRenderName(data, entryOff) {
  var rich = readPetsciiRich(data, entryOff + 5, 16);
  if (!rich || rich.length === 0) return '<span class="text-muted">(unnamed)</span>';
  return rich.map(function(c) {
    var ch = escHtml(c.char);
    return c.reversed ? '<span class="petscii-rev">' + ch + '</span>' : ch;
  }).join('');
}

function fchainRenderSectors(chain) {
  if (chain.note === 'empty') {
    return '<span class="fchain-empty-note">(empty)</span>';
  }
  if (chain.sectors.length === 0) {
    return '<span class="fchain-empty-note">(none)</span>';
  }
  var html = '';
  for (var i = 0; i < chain.sectors.length; i++) {
    var s = chain.sectors[i];
    if (i > 0) html += '<span class="fchain-arrow"><i class="fa-solid fa-angle-right"></i></span>';
    html += '<span class="fchain-chip fchain-chip-' + chain.kind + '">' +
      '$' + s.t.toString(16).toUpperCase().padStart(2, '0') + ':$' +
      s.s.toString(16).toUpperCase().padStart(2, '0') + '</span>';
  }
  if (chain.loop) {
    html += '<span class="fchain-loop"><i class="fa-solid fa-arrow-rotate-left"></i> loop</span>';
  }
  return html;
}

document.getElementById('opt-file-chains').addEventListener('click', function(e) {
  e.stopPropagation();
  if (!currentBuffer) return;
  closeMenus();

  var data = new Uint8Array(currentBuffer);
  var info = parseCurrentDir(currentBuffer);

  // Counters for the summary strip at the top.
  var fileCount = 0, geosCount = 0, vlirCount = 0, relCount = 0, totalSectors = 0;

  var cardsHtml = '';
  for (var i = 0; i < info.entries.length; i++) {
    var en = info.entries[i];
    if (en.deleted) continue;
    var typeByte = data[en.entryOff + 2];
    var ftype = typeByte & 0x07;
    if (ftype === 0) continue; // separators / scratched
    var startT = data[en.entryOff + 3];
    if (startT === 0) continue;

    var an = fchainAnalyse(data, en.entryOff);
    fileCount++;
    if (an.isVlir) vlirCount++;
    else if (an.isGeos) geosCount++;
    if (an.isRel) relCount++;

    var sectorCount = 0;
    an.chains.forEach(function(c) { sectorCount += c.sectors.length; });
    totalSectors += sectorCount;

    var typeName = (en.type || '').trim();
    var locked = (typeByte & 0x40) !== 0;

    // Type badge \u2014 let the type letter be colour-coded by category so
    // a quick glance shows GEOS / REL / standard at once.
    var typeBadgeClass = 'fchain-badge-type';
    if (an.isVlir) typeBadgeClass += ' fchain-badge-geos';
    else if (an.isGeos) typeBadgeClass += ' fchain-badge-geos-seq';
    else if (an.isRel) typeBadgeClass += ' fchain-badge-rel';
    var typeLabel = typeName + (locked ? '<' : '');

    var structLabel =
      an.isVlir ? 'VLIR' :
      an.isGeos ? 'GEOS sequential' :
      an.isRel ? 'REL' :
      'sequential';

    cardsHtml += '<div class="fchain-card">';
    cardsHtml += '<div class="fchain-header">';
    cardsHtml +=   '<span class="fchain-badge ' + typeBadgeClass + '">' + escHtml(typeLabel) + '</span>';
    cardsHtml +=   '<span class="fchain-name">' + fchainRenderName(data, en.entryOff) + '</span>';
    cardsHtml +=   '<span class="fchain-struct">' + escHtml(structLabel) + '</span>';
    cardsHtml +=   '<span class="fchain-count">' + sectorCount + ' sector' + (sectorCount === 1 ? '' : 's') + '</span>';
    cardsHtml += '</div>';

    cardsHtml += '<div class="fchain-body">';
    an.chains.forEach(function(c) {
      cardsHtml += '<div class="fchain-row">';
      cardsHtml +=   '<span class="fchain-row-label fchain-label-' + c.kind + '">' + escHtml(c.label) + '</span>';
      cardsHtml +=   '<span class="fchain-row-sectors">' + fchainRenderSectors(c) + '</span>';
      cardsHtml += '</div>';
    });
    cardsHtml += '</div>';

    cardsHtml += '</div>';
  }

  // Summary strip / legend at top.
  var summaryHtml = '<div class="fchain-summary">' +
    '<span><b>' + fileCount + '</b> file' + (fileCount === 1 ? '' : 's') + '</span>' +
    '<span class="fchain-summary-sep">\u00b7</span>' +
    '<span><b>' + totalSectors + '</b> sectors</span>';
  if (vlirCount) summaryHtml += '<span class="fchain-summary-sep">\u00b7</span><span><b>' + vlirCount + '</b> GEOS VLIR</span>';
  if (geosCount) summaryHtml += '<span class="fchain-summary-sep">\u00b7</span><span><b>' + geosCount + '</b> GEOS sequential</span>';
  if (relCount)  summaryHtml += '<span class="fchain-summary-sep">\u00b7</span><span><b>' + relCount + '</b> REL</span>';
  summaryHtml += '</div>';

  var emptyHtml = '<div class="text-base text-muted">No files to show.</div>';
  var html = '<div class="fchain-list">' + summaryHtml + (cardsHtml || emptyHtml) + '</div>';

  showModal('File Chains', []);
  setModalSize('xl');
  document.getElementById('modal-body').innerHTML = html;
});

// ── Export All Files ─────────────────────────────────────────────────
// Minimal ZIP builder (store-only, no compression)
function buildZip(files) {
  var localHeaders = [], centralHeaders = [], offset = 0;
  for (var i = 0; i < files.length; i++) {
    var f = files[i];
    var nameBytes = new TextEncoder().encode(f.name);
    // Local file header (30 + name + data)
    var lh = new Uint8Array(30 + nameBytes.length + f.data.length);
    var v = new DataView(lh.buffer);
    v.setUint32(0, 0x04034b50, true); // signature
    v.setUint16(4, 20, true); // version needed
    v.setUint16(8, 0, true); // method: store
    v.setUint32(18, f.data.length, true); // compressed size
    v.setUint32(22, f.data.length, true); // uncompressed size
    v.setUint16(26, nameBytes.length, true); // name length
    lh.set(nameBytes, 30);
    lh.set(f.data, 30 + nameBytes.length);
    localHeaders.push(lh);
    // Central directory header (46 + name)
    var ch = new Uint8Array(46 + nameBytes.length);
    var cv = new DataView(ch.buffer);
    cv.setUint32(0, 0x02014b50, true); // signature
    cv.setUint16(4, 20, true); // version made by
    cv.setUint16(6, 20, true); // version needed
    cv.setUint16(10, 0, true); // method: store
    cv.setUint32(20, f.data.length, true); // compressed
    cv.setUint32(24, f.data.length, true); // uncompressed
    cv.setUint16(28, nameBytes.length, true); // name length
    cv.setUint32(42, offset, true); // local header offset
    ch.set(nameBytes, 46);
    centralHeaders.push(ch);
    offset += lh.length;
  }
  var centralStart = offset;
  var centralSize = 0;
  for (var ci = 0; ci < centralHeaders.length; ci++) centralSize += centralHeaders[ci].length;
  // End of central directory (22 bytes)
  var eocd = new Uint8Array(22);
  var ev = new DataView(eocd.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, files.length, true); // entries on disk
  ev.setUint16(10, files.length, true); // total entries
  ev.setUint32(12, centralSize, true);
  ev.setUint32(16, centralStart, true);
  // Combine
  var total = offset + centralSize + 22;
  var zip = new Uint8Array(total);
  var pos = 0;
  for (var li = 0; li < localHeaders.length; li++) { zip.set(localHeaders[li], pos); pos += localHeaders[li].length; }
  for (var di = 0; di < centralHeaders.length; di++) { zip.set(centralHeaders[di], pos); pos += centralHeaders[di].length; }
  zip.set(eocd, pos);
  return zip;
}

document.getElementById('opt-export-all').addEventListener('click', function(e) {
  e.stopPropagation();
  if (!currentBuffer) return;
  closeMenus();
  var data = new Uint8Array(currentBuffer);
  var info = parseCurrentDir(currentBuffer);
  var extMap = { 1: '.seq', 2: '.prg', 3: '.usr', 4: '.rel' };
  var files = [];

  for (var i = 0; i < info.entries.length; i++) {
    var en = info.entries[i];
    if (en.deleted) continue;
    var typeByte = data[en.entryOff + 2];
    var typeIdx = typeByte & 0x07;
    if (typeIdx < 1 || typeIdx > 4) continue;
    // GEOS VLIR: dir T/S is the index sector, not file data — use Export CVT
    if (isVlirFile(data, en.entryOff)) continue;
    var result = readFileData(currentBuffer, en.entryOff);
    if (result.error || result.data.length === 0) continue;
    var name = petsciiToReadable(en.name || '').trim().replace(/[<>:"/\\|?*\x00-\x1F]/g, '_');
    if (!name) name = 'file' + i;
    files.push({ name: name + (extMap[typeIdx] || '.prg'), data: result.data });
  }

  if (files.length === 0) {
    showModal('Export All', ['No exportable files found.']);
    return;
  }

  var zip = buildZip(files);
  var diskName = petsciiToReadable(info.diskName || '').trim().replace(/[<>:"/\\|?*]/g, '_') || 'disk';
  var blob = new Blob([zip], { type: 'application/zip' });
  var a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = diskName + '.zip';
  a.click();
  URL.revokeObjectURL(a.href);
});

// ── CSV Export ───────────────────────────────────────────────────────
document.getElementById('opt-export-csv').addEventListener('click', function(e) {
  e.stopPropagation();
  if (!currentBuffer) return;
  closeMenus();
  var info = parseCurrentDir(currentBuffer);
  var lines = ['Filename,Type,Blocks,Locked,Track,Sector'];
  for (var i = 0; i < info.entries.length; i++) {
    var en = info.entries[i];
    if (!en.name && !en.type) continue;
    var name = petsciiToReadable(en.name || '').replace(/"/g, '""').trim();
    var type = (en.type || '').trim();
    var blocks = en.blocks || 0;
    var locked = en.locked ? 'Y' : 'N';
    var ft = en.track || 0;
    var fs = en.sector || 0;
    lines.push('"' + name + '",' + type + ',' + blocks + ',' + locked + ',' + ft + ',' + fs);
  }
  var csv = lines.join('\n');
  var diskName = petsciiToReadable(info.diskName || '').trim().replace(/[<>:"/\\|?*]/g, '_') || 'disk';
  var blob = new Blob([csv], { type: 'text/csv' });
  var a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = diskName + '.csv';
  a.click();
  URL.revokeObjectURL(a.href);
});

// ── Directory Export as HTML ─────────────────────────────────────────
document.getElementById('opt-export-html-dir').addEventListener('click', function(e) {
  e.stopPropagation();
  if (!currentBuffer) return;
  closeMenus();
  var info = parseCurrentDir(currentBuffer);
  var diskName = petsciiToReadable(info.diskName || '').padEnd(currentFormat.nameLength);
  var diskId = petsciiToReadable(info.diskId || '');

  var html = '<!DOCTYPE html>\n<html>\n<head>\n<meta charset="utf-8">\n' +
    '<title>' + escHtml(diskName.trim()) + '</title>\n' +
    '<style>\n' +
    'body { background: #40318d; color: #6C5EB5; font-family: "C64 Pro Mono", "Courier New", monospace; font-size: 16px; padding: 20px; }\n' +
    'pre { margin: 0; line-height: 1.4; }\n' +
    '.dir { color: #6C5EB5; }\n' +
    '</style>\n</head>\n<body>\n<pre class="dir">\n';

  html += '0 \u0022' + escHtml(diskName) + '\u0022 ' + escHtml(diskId) + '\n';
  for (var i = 0; i < info.entries.length; i++) {
    var en = info.entries[i];
    if (en.deleted && !showDeleted) continue;
    if (!en.name && !en.type) continue;
    var blocks = String(en.blocks || 0);
    var name = '\u0022' + petsciiToReadable(en.name || '').padEnd(16) + '\u0022';
    var type = (en.type || 'PRG').trim();
    html += blocks.padStart(4) + ' ' + name + ' ' + escHtml(type) + '\n';
  }
  html += (info.freeBlocks || 0) + ' BLOCKS FREE.\n';
  html += '</pre>\n</body>\n</html>';

  var safeName = diskName.trim().replace(/[<>:"/\\|?*]/g, '_') || 'directory';
  var blob = new Blob([html], { type: 'text/html' });
  var a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = safeName + '.html';
  a.click();
  URL.revokeObjectURL(a.href);
});

// ── Directory Export as PNG ──────────────────────────────────────────
document.getElementById('opt-export-png-dir').addEventListener('click', function(e) {
  e.stopPropagation();
  if (!currentBuffer) return;
  closeMenus();
  var info = parseCurrentDir(currentBuffer);

  // Render directory to a canvas using C64 colors
  var charW = 8, charH = 8, scale = 2;
  var cols = 40, rows = info.entries.length + 3; // header + entries + blocks free
  var canvasW = cols * charW * scale;
  var canvasH = rows * charH * scale;

  var canvas = document.createElement('canvas');
  canvas.width = canvasW;
  canvas.height = canvasH;
  var ctx = canvas.getContext('2d');

  // Background
  ctx.fillStyle = C64_COLORS[6]; // blue
  ctx.fillRect(0, 0, canvasW, canvasH);

  ctx.font = (charH * scale) + 'px "C64 Pro Mono", monospace';
  ctx.textBaseline = 'top';

  var y = 0;
  function drawLine(text, color) {
    ctx.fillStyle = color || C64_COLORS[14]; // light blue
    ctx.fillText(text, 0, y);
    y += charH * scale;
  }

  // Header
  var diskName = petsciiToReadable(info.diskName || '').padEnd(currentFormat.nameLength);
  var diskId = petsciiToReadable(info.diskId || '');
  drawLine('0 "' + diskName + '" ' + diskId, C64_COLORS[14]);
  drawLine('', C64_COLORS[14]); // blank line

  // Entries
  for (var i = 0; i < info.entries.length; i++) {
    var en = info.entries[i];
    if (!en.name && !en.type) continue;
    var blocks = String(en.blocks || 0);
    var name = '"' + petsciiToReadable(en.name || '').padEnd(16) + '"';
    var type = (en.type || 'PRG').trim();
    var line = blocks.padStart(4) + ' ' + name + ' ' + type;
    drawLine(line, C64_COLORS[14]);
  }

  // Blocks free
  drawLine((info.freeBlocks || 0) + ' BLOCKS FREE.', C64_COLORS[14]);

  var diskFileName = petsciiToReadable(info.diskName || '').trim().replace(/[<>:"/\\|?*]/g, '_') || 'directory';
  var a = document.createElement('a');
  a.href = canvas.toDataURL('image/png');
  a.download = diskFileName + '_dir.png';
  a.click();
});

// ── geoWrite to Plain Text ──────────────────────────────────────────
document.getElementById('opt-export-rtf').parentElement.insertAdjacentHTML('beforeend', '');

fileInput.addEventListener('change', async () => {
  var files = Array.from(fileInput.files);
  if (files.length === 0) return;
  fileInput.value = '';

  // Same expansion as the drop handler — .gz transparently decompresses,
  // .zip pops the picker. Result is { name, buffer } entries already
  // loaded into memory.
  var entries = await expandArchives(files);
  if (entries.length === 0) return;

  saveActiveTab();
  for (var i = 0; i < entries.length; i++) {
    try {
      var buf = entries[i].buffer;
      var fname = entries[i].name;

      // LNX archives: extract into a new D64 tab instead of opening as-is.
      if (/\.lnx$/i.test(fname)) {
        clearRamLinkState();
        openLnxArchiveAsTab(buf, fname);
        addRecentDisk(fname, buf);
        continue;
      }

      // RAMLink containers: pop the partition picker, open chosen
      // partition as a tab.
      if (/\.(rml|rl)$/i.test(fname)) {
        await openRamLinkAsTab(buf, fname);
        continue;
      }

      clearRamLinkState();
      currentBuffer = buf;
      currentFileName = fname;
      currentPartition = null;
      selectedEntryIndex = -1;
      parseDisk(currentBuffer);
      var tab = createTab(fname, currentBuffer, fname);
      activeTabId = tab.id;
      tabDirty = false;
      clearUndo();
      addRecentDisk(fname, buf);
    } catch (err) {
      showModal('Error', ['Error reading ' + entries[i].name + ': ' + err.message]);
    }
  }
  var info = parseCurrentDir(currentBuffer);
  renderDisk(info);
  renderTabs();
  updateMenuState();
});

