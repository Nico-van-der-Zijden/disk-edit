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

// CFS analogue: name lives at $00..$0F of the 32-byte dir entry (no $05
// offset). Same PETSCII byte conventions ($41-$5A ↔ $C1-$DA), terminated
// by $A0 or $00 (CFS uses both depending on who wrote the entry).
function changeCfsNameCase(entry, mode) {
  if (!entry || entry.dirLba == null) return;
  var data = new Uint8Array(hddBuffer);
  var off = entry.dirLba * 512 + entry.index * 32;
  for (var i = 0; i < 16; i++) {
    var b = data[off + i];
    if (b === 0xA0 || b === 0x00) break;
    if (mode === 'upper') {
      if (b >= 0x41 && b <= 0x5A) data[off + i] = b + 0x80;
    } else if (mode === 'lower') {
      if (b >= 0xC1 && b <= 0xDA) data[off + i] = b - 0x80;
    } else {
      if (b >= 0x41 && b <= 0x5A) data[off + i] = b + 0x80;
      else if (b >= 0xC1 && b <= 0xDA) data[off + i] = b - 0x80;
    }
  }
}

['upper', 'lower', 'toggle'].forEach(function(mode) {
  document.getElementById('opt-case-' + mode).addEventListener('click', function(e) {
    e.stopPropagation();
    if (!currentBuffer || selectedEntryIndex < 0) return;
    closeMenus();
    // CFS view: changeNameCase writes at entryOff + 5 which is wrong
    // (CFS dir name lives at +0). Route through the CFS-aware variant.
    if (cfsPartitionIdx >= 0 && cfsDirEntries) {
      // Multi-select: iterate selectedEntries (fallback to single).
      // Skip protected / invalid entries silently in a batch.
      var rawIdx = selectedEntries.length > 0 ? selectedEntries : [selectedEntryIndex];
      var targets = [];
      for (var ti = 0; ti < rawIdx.length; ti++) {
        var ent = cfsDirEntries[rawIdx[ti]];
        if (!ent || ent.empty) continue;
        if (typeof _cfsEntryIsDeldirRef === 'function' && _cfsEntryIsDeldirRef(ent)) {
          if (rawIdx.length === 1) {
            showModal('Protected entry', ['The <<DELETED FILES>> entry is system-managed and can\'t be renamed or case-flipped.']);
            return;
          }
          continue;
        }
        targets.push(ent);
      }
      if (targets.length === 0) return;
      pushUndo();
      for (var ci = 0; ci < targets.length; ci++) changeCfsNameCase(targets[ci], mode);
      refreshIde64View();
      return;
    }
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
    var off = sectorOffset(t, s, getCurrentCtx());
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
    var off2 = sectorOffset(t, s, getCurrentCtx());
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
// Decoding lives in the cbm-format-*.js modules. These helpers are shared by
// the on-disk handler (refs are dir entry offsets) and the drop path in
// ui-init.js (refs are loaded buffers). `readRef` returns one file's bytes.
function zipCodeDecodeSets(sets, readRef) {
  var results = [], failures = [];
  for (var si = 0; si < sets.length; si++) {
    var set = sets[si];
    var files = [], readErr = null;
    for (var fi = 0; fi < set.refs.length; fi++) {
      var data = readRef(set.refs[fi], fi, set);
      if (!data || data.length < 3) {
        readErr = 'could not read ' + (fi + 1) + '!' + set.name;
        break;
      }
      files.push(data);
    }
    if (readErr) { failures.push('"' + set.name + '": ' + readErr); continue; }

    var res = decompressZipCode(files);
    if (res.error) { failures.push('"' + set.name + '": ' + res.error); continue; }
    results.push({ name: set.name, res: res });
  }
  return { results: results, failures: failures };
}

// SixPack counterpart, same { results, failures } shape. `res.buffer` is the
// image to open — a "+Errors" D64 when the set carries read errors.
function sixPackDecodeSets(sets, readRef) {
  var results = [], failures = [];
  for (var si = 0; si < sets.length; si++) {
    var set = sets[si];
    var files = [], readErr = null;
    for (var fi = 0; fi < set.refs.length; fi++) {
      var data = readRef(set.refs[fi], fi, set);
      if (!data || data.length < 4) {
        readErr = 'could not read ' + (fi + 1) + '!!' + set.name;
        break;
      }
      files.push(data);
    }
    if (readErr) { failures.push('"' + set.name + '": ' + readErr); continue; }

    var res = decompressSixPack(files);
    if (res.error) { failures.push('"' + set.name + '": ' + res.error); continue; }
    res.buffer = sixPackToImage(res);
    results.push({ name: set.name, res: res });
  }
  return { results: results, failures: failures };
}

// Call only after every set is decoded: opening a tab repoints currentBuffer
// and would break any remaining reads.
function zipCodeOpenTabs(results) {
  if (results.length === 0) return;
  saveActiveTab();
  var firstTabId = null;
  for (var ri = 0; ri < results.length; ri++) {
    // CBM names can hold characters illegal in host filenames ("HACK
    // CD1/TRIAD" is real), so the tab keeps the original and Save gets a
    // sanitized one.
    var title = results[ri].name + '.d64';
    var safeBase = results[ri].name.replace(/[<>:"/\\|?*\x00-\x1F]/g, '_') || 'zipcode';
    var name = safeBase + '.d64';
    currentBuffer = results[ri].res.buffer;
    currentFileName = name;
    currentPartition = null;
    selectedEntryIndex = -1;
    clearCmdContainerState();
    parseDisk(currentBuffer);
    var tab = createTab(title, currentBuffer, name);
    activeTabId = tab.id;
    clearUndo();
    // Memory-only, so start dirty. cleanStackLength = -1 survives an
    // edit-then-undo (undoStack.length can never be -1) until a real save.
    cleanStackLength = -1;
    tabDirty = true;
    if (firstTabId === null) firstTabId = tab.id;
    // Persist this tab's state before the next iteration overwrites the
    // globals it was built from.
    saveActiveTab();
  }
  if (activeTabId !== firstTabId) {
    switchToTab(firstTabId);
  } else {
    renderDisk(parseCurrentDir(currentBuffer));
    renderTabs();
    updateMenuState();
  }
}

// Summary modal: per-set track counts, zero-filled gaps, then failures.
// `extraLines` is appended last (partial sets, unsupported SixPack, ...).
function zipCodeReport(results, failures, extraLines) {
  var lines = [];
  for (var li = 0; li < results.length; li++) {
    var r = results[li];
    var line = '"' + r.name + '" → ' + r.res.tracks + ' tracks';
    if (r.res.missing > 0) {
      line += ' (' + r.res.missing + ' sector(s) absent from the set, zero-filled)';
    }
    // SixPack only: a set carrying read errors opens as a "+Errors" image.
    if (r.res.errorCount > 0) {
      line += ' — ' + r.res.errorCount + ' sector(s) with read errors, kept in an +Errors image';
    }
    lines.push(line);
  }
  if (results.length > 0) {
    lines.unshift(results.length === 1
      ? 'Decompressed 1 set into a new tab:'
      : 'Decompressed ' + results.length + ' sets into new tabs:');
  }
  if (failures.length > 0) {
    if (lines.length > 0) lines.push('');
    lines.push(failures.length === 1 ? 'One set failed:' : failures.length + ' sets failed:');
    for (var fj = 0; fj < failures.length; fj++) lines.push(failures[fj]);
  }
  if (extraLines && extraLines.length) {
    if (lines.length > 0) lines.push('');
    for (var ej = 0; ej < extraLines.length; ej++) lines.push(extraLines[ej]);
  }
  if (lines.length === 0) return;
  showModal(failures.length > 0 && results.length === 0 ? 'Decompress Error' : 'Decompress ZipCode', lines);
}

// Lines describing sets that couldn't be used, shared by both entry points.
function zipCodePartialLines(partial) {
  var out = [];
  for (var pi = 0; pi < partial.length; pi++) {
    var part = partial[pi];
    var got = part.found.map(function(d) { return d + '!'; }).join(', ');
    out.push('"' + part.name + '": found ' + got + ' (need 1!, 2!, 3!, 4!)');
  }
  if (out.length) out.unshift(out.length === 1 ? 'Incomplete set:' : 'Incomplete sets:');
  return out;
}

document.getElementById('opt-unzip').addEventListener('click', async function(e) {
  e.stopPropagation();
  if (!currentBuffer) return;
  closeMenus();

  var items = zipCodeGatherItems();
  var found = findZipCodeSets(items);
  var foundSix = findSixPackSets(items);
  var foundFile = findFilePackSets(items);
  // Tag each candidate so the picker can label it and the decode can route
  // to the right reader — DiskPacked and SixPack share nothing but the name.
  var candidates = found.complete.map(function(s) { return { set: s, kind: 'zipcode' }; })
    .concat(foundSix.complete.map(function(s) { return { set: s, kind: 'sixpack' }; }))
    .concat(foundFile.complete.map(function(s) { return { set: s, kind: 'filepack' }; }));

  if (candidates.length === 0) {
    var none = zipCodePartialLines(found.partial);
    for (var pj = 0; pj < foundSix.partial.length; pj++) {
      var spp = foundSix.partial[pj];
      none.push('Incomplete SixPack set "' + spp.name + '": found ' +
        spp.found.map(function(d) { return d + '!!'; }).join(', ') + ' (need 1!! through 6!!)');
    }
    for (var pk = 0; pk < foundFile.partial.length; pk++) {
      var fpp = foundFile.partial[pk];
      none.push('Incomplete FilePacked set "' + fpp.name + '": found ' +
        fpp.found.map(function(L) { return L + '!'; }).join(', ') +
        (fpp.hasDir ? '' : ' — the x! directory file is missing'));
    }
    if (none.length === 0) {
      none = [
        'No ZipCode files found on this disk.',
        'DiskPacked sets are named 1!NAME through 4!NAME (plus 5!NAME for 40 tracks); ' +
        'SixPack sets are 1!!NAME through 6!!NAME.'
      ];
    }
    showModal('Decompress ZipCode', none);
    return;
  }

  // One set needs no picker; several get the multi-select.
  var picks;
  if (candidates.length === 1) {
    picks = candidates;
  } else {
    picks = await showZipCodeSetPicker(candidates.map(function(c) {
      return {
        name: c.set.name,
        tracks: c.kind === 'sixpack' ? 0 : c.set.tracks,
        refs: c.set.refs,
        kind: c.kind,
      };
    }));
    if (picks.length === 0) return;
    // Map the picker's rows back to the tagged candidates.
    picks = picks.map(function(p) {
      return candidates.filter(function(c) { return c.set.name === p.name && c.kind === p.kind; })[0];
    }).filter(Boolean);
  }

  // Read every pick before any tab is opened. Each ref knows which disk it
  // came from, so a set spanning several tabs reads from each in turn.
  var readEntry = function(ref) {
    var r = readFileData(ref.ctx.buffer, ref.entryOff, ref.ctx);
    return (r.error || !r.data) ? null : r.data;
  };
  var zcPicks = picks.filter(function(p) { return p.kind === 'zipcode'; }).map(function(p) { return p.set; });
  var spPicks = picks.filter(function(p) { return p.kind === 'sixpack'; }).map(function(p) { return p.set; });
  var fpPicks = picks.filter(function(p) { return p.kind === 'filepack'; }).map(function(p) { return p.set; });

  // FilePacked sets have to be read before any tab is opened too, since the
  // extraction repoints currentBuffer at the fresh D64 it builds.
  var fpLoaded = fpPicks.map(function(s) {
    return {
      name: s.name,
      parts: s.refs.map(readEntry),
      dir: readEntry(s.dirRef),
    };
  });

  var zcDec = zipCodeDecodeSets(zcPicks, readEntry);
  var spDec = sixPackDecodeSets(spPicks, readEntry);
  var results = zcDec.results.concat(spDec.results);
  var failures = zcDec.failures.concat(spDec.failures);
  zipCodeOpenTabs(results);

  // Note any set that was assembled from more than one open disk, so it's
  // obvious where the parts came from rather than looking like magic.
  var extra = [];
  for (var ci = 0; ci < picks.length; ci++) {
    var pset = picks[ci].set;
    var refs = pset.refs.concat(pset.dirRef ? [pset.dirRef] : []);
    var tabNames = [];
    for (var ri2 = 0; ri2 < refs.length; ri2++) {
      var tn = refs[ri2] && refs[ri2].tab;
      if (tn && tabNames.indexOf(tn) < 0) tabNames.push(tn);
    }
    if (tabNames.length > 1) {
      extra.push('"' + pset.name + '" was assembled from ' + tabNames.length +
        ' open disks: ' + tabNames.join(', '));
    }
  }

  for (var fl = 0; fl < fpLoaded.length; fl++) {
    var L = fpLoaded[fl];
    if (!L.dir || L.parts.some(function(p) { return !p; })) {
      extra.push('"' + L.name + '": could not read every part off the disk.');
      continue;
    }
    var fpRes = openFilePackSetAsTab(L.parts, L.dir, L.name, /*silent*/ true);
    if (fpRes && fpRes.lines) extra = extra.concat(fpRes.lines);
  }
  zipCodeReport(results, failures, extra);
});

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
  redoStack = [];
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
  if (hasCvt) writeGeosSignature(currentBuffer, getCurrentCtx());

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

    if (writeFileToDisk(f.typeIdx, nameBytes, f.data, null, true, getCurrentCtx())) {
      imported++;
    } else {
      skipped.push({ name: display, reason: 'disk or directory full' });
    }
  }

  // Fresh-tab state: clear undo and dirty flag so the new D64 opens clean
  // (user can Save As to keep it).
  undoStack = [];
  redoStack = [];
  cleanStackLength = 0;
  tabDirty = false;

  return { buffer: currentBuffer, imported: imported, skipped: skipped, comment: parsed.comment };
}

// ── FilePacked ZipCode → new D64 ─────────────────────────────────────
// Holds files, not a disk image, so it extracts onto a fresh D64 like LNX.
// Globals point at the new disk so writeFileToDisk works normally.
function extractFilePackToNewD64(dataFiles, dirFile) {
  var parsed = decompressFilePack(dataFiles, dirFile);
  if (parsed.error) return { error: parsed.error };

  saveActiveTab();
  var d64 = createEmptyDisk('d64', 35);
  currentBuffer = d64;
  currentFormat = DISK_FORMATS.d64;
  currentTracks = 35;
  currentPartition = null;
  selectedEntryIndex = -1;
  clearCmdContainerState();
  parseDisk(currentBuffer);

  var imported = 0;
  var skipped = parsed.skipped.slice();
  for (var i = 0; i < parsed.files.length; i++) {
    var f = parsed.files[i];
    var display = petsciiToReadable(f.name).trim() || '<file ' + (i + 1) + '>';
    // x! records the type as the letter OR'd with $80, so only P/S/U can
    // appear — no REL, and no splat/lock bits.
    var typeIdx = f.typeChar === 'S' ? FILE_TYPE.SEQ
      : f.typeChar === 'U' ? FILE_TYPE.USR
      : f.typeChar === 'P' ? FILE_TYPE.PRG : -1;
    if (typeIdx < 0) {
      skipped.push({ name: display, reason: 'unsupported type "' + f.typeChar + '"' });
      continue;
    }
    if (writeFileToDisk(typeIdx, f.nameBytes, f.data, null, true, getCurrentCtx())) {
      imported++;
    } else {
      skipped.push({ name: display, reason: 'disk or directory full' });
    }
  }

  undoStack = [];
  redoStack = [];
  cleanStackLength = 0;
  tabDirty = false;

  return { buffer: currentBuffer, imported: imported, skipped: skipped };
}

// Open a FilePacked set as a new D64 tab. `dataFiles` are the a!/b!/... byte
// arrays in letter order, `dirFile` the x! one.
// With `silent`, returns { lines } instead of popping a modal, so a caller
// handling several sets can compose one report — the app has a single shared
// modal, and a second showModal would overwrite the first.
function openFilePackSetAsTab(dataFiles, dirFile, setName, silent) {
  var result = extractFilePackToNewD64(dataFiles, dirFile);
  if (result.error) {
    if (silent) return { lines: ['"' + setName + '": ' + result.error], error: result.error };
    showModal('Decompress Error', ['"' + setName + '": ' + result.error]);
    return null;
  }
  var tabName = setName + '.d64';
  var tab = createTab(tabName, currentBuffer, null);
  activeTabId = tab.id;

  var info = parseCurrentDir(currentBuffer);
  renderDisk(info);
  renderTabs();
  updateMenuState();

  var lines = ['"' + setName + '": extracted ' + result.imported + ' file(s) to a new D64.'];
  if (result.skipped.length > 0) {
    lines.push('');
    lines.push(result.skipped.length + ' file(s) skipped:');
    var cap = Math.min(20, result.skipped.length);
    for (var si = 0; si < cap; si++) {
      lines.push('  ' + result.skipped[si].name + ' — ' + result.skipped[si].reason);
    }
    if (result.skipped.length > cap) {
      lines.push('  … and ' + (result.skipped.length - cap) + ' more');
    }
  }
  if (silent) return { tab: tab, lines: lines };
  showModal('Decompress ZipCode', lines);
  return tab;
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
    var off = sectorOffset(ft, fs, getCurrentCtx());
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
    var idxOff = sectorOffset(startT, startS, getCurrentCtx());
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
  closeMenus();
  var files = [];
  var diskName;
  // CFS view: walk cfsDirEntries via the B-tree reader; the same shape
  // (name, ftype, typeSuffix, data) drops into buildZip below.
  if (cfsPartitionIdx >= 0 && cfsDirEntries && hddBuffer) {
    for (var ci = 0; ci < cfsDirEntries.length; ci++) {
      var ce = cfsDirEntries[ci];
      if (!ce || ce.empty) continue;
      if (ce.ftype === CFS_FTYPE.DIR || ce.ftype === CFS_FTYPE.LNK || ce.ftype === CFS_FTYPE.DEL) continue;
      if (!ce.dataTreePtr || !ce.dataTreePtr.lba) continue;
      var cRes = readCfsFileData(hddBuffer, ce.dataTreePtr.addr, ce.size);
      if (cRes.error || !cRes.data || cRes.data.length === 0) continue;
      var cName = petsciiToReadable(ce.name).trim().replace(/[<>:"/\\|?*\x00-\x1F]/g, '_');
      if (!cName) cName = 'file' + ci;
      var ext = '.' + (ce.typeSuffix || 'prg').toLowerCase();
      files.push({ name: cName + exportExtFor(cName, ext), data: cRes.data });
    }
    var part = hddPartitions && hddPartitions[cfsPartitionIdx];
    diskName = (part && part.name ? petsciiToReadable(part.name) : 'partition')
      .trim().replace(/[<>:"/\\|?*]/g, '_') || 'partition';
  } else {
    if (!currentBuffer) return;
    var data = new Uint8Array(currentBuffer);
    var info = parseCurrentDir(currentBuffer);
    var extMap = { 1: '.seq', 2: '.prg', 3: '.usr', 4: '.rel' };

    for (var i = 0; i < info.entries.length; i++) {
      var en = info.entries[i];
      if (en.deleted) continue;
      var typeByte = data[en.entryOff + 2];
      var typeIdx = typeByte & 0x07;
      if (typeIdx < 1 || typeIdx > 4) continue;
      // GEOS VLIR: dir T/S is the index sector, not file data — use Export CVT
      if (isVlirFile(data, en.entryOff)) continue;
      var result = readFileData(currentBuffer, en.entryOff, getCurrentCtx());
      if (result.error || result.data.length === 0) continue;
      var name = petsciiToReadable(en.name || '').trim().replace(/[<>:"/\\|?*\x00-\x1F]/g, '_');
      if (!name) name = 'file' + i;
      files.push({ name: name + exportExtFor(name, extMap[typeIdx] || '.prg'), data: result.data });
    }
    diskName = petsciiToReadable(info.diskName || '').trim().replace(/[<>:"/\\|?*]/g, '_') || 'disk';
  }

  if (files.length === 0) {
    showModal('Export All', ['No exportable files found.']);
    return;
  }

  var zip = buildZip(files);
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
  closeMenus();
  var lines;
  var diskName;
  if (cfsPartitionIdx >= 0 && cfsDirEntries && hddPartitions) {
    lines = ['Filename,Type,Blocks,Locked,LBA,Size'];
    for (var ci = 0; ci < cfsDirEntries.length; ci++) {
      var ce = cfsDirEntries[ci];
      if (!ce || ce.empty) continue;
      var cName = petsciiToReadable(ce.name).replace(/"/g, '""').trim();
      var cType = (ce.typeSuffix || '').trim();
      var cBlocks = ce.size ? Math.ceil(ce.size / 256) : 0;
      var cLocked = (ce.attrByte & 0x10) ? 'N' : 'Y'; // writeable bit cleared = locked
      var cLba = (ce.dataTreePtr && ce.dataTreePtr.addr) || 0;
      lines.push('"' + cName + '",' + cType + ',' + cBlocks + ',' + cLocked + ',' + cLba + ',' + (ce.size || 0));
    }
    var part = hddPartitions[cfsPartitionIdx];
    diskName = (part && part.name ? petsciiToReadable(part.name) : 'partition').trim().replace(/[<>:"/\\|?*]/g, '_') || 'partition';
  } else {
    if (!currentBuffer) return;
    var info = parseCurrentDir(currentBuffer);
    lines = ['Filename,Type,Blocks,Locked,Track,Sector'];
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
    diskName = petsciiToReadable(info.diskName || '').trim().replace(/[<>:"/\\|?*]/g, '_') || 'disk';
  }
  var csv = lines.join('\n');
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
  closeMenus();
  // CFS branch: build the listing from cfsDirEntries (partition name +
  // typeSuffix + size). Wraps to the same template as the CBM-DOS path
  // below so a single set of HTML/CSS handles both.
  if (cfsPartitionIdx >= 0 && cfsDirEntries && hddPartitions) {
    var cfsPart = hddPartitions[cfsPartitionIdx];
    var cfsPName = cfsPart && cfsPart.name ? petsciiToReadable(cfsPart.name).padEnd(16) : ''.padEnd(16);
    var cfsTitleName = cfsPName.trim() || 'partition';
    var cfsRows = [];
    for (var cci = 0; cci < cfsDirEntries.length; cci++) {
      var cce = cfsDirEntries[cci];
      if (!cce || cce.empty) continue;
      if (cce.ftype === CFS_FTYPE.DEL && !showDeleted) continue;
      var ccBlocks = cce.size ? Math.ceil(cce.size / 256) : 0;
      var ccName = '"' + petsciiToReadable(cce.name).padEnd(16) + '"';
      var ccType = (cce.typeSuffix || 'PRG').trim();
      cfsRows.push(String(ccBlocks).padStart(4) + ' ' + ccName + ' ' + escHtml(ccType));
    }
    var cfsHtml = '<!DOCTYPE html>\n<html>\n<head>\n<meta charset="utf-8">\n' +
      '<title>' + escHtml(cfsTitleName) + '</title>\n' +
      '<style>\n' +
      'body { background: #40318d; color: #6C5EB5; font-family: "C64 Pro Mono", "Courier New", monospace; font-size: 16px; padding: 20px; }\n' +
      'pre { margin: 0; line-height: 1.4; }\n' +
      '.dir { color: #6C5EB5; }\n' +
      '</style>\n</head>\n<body>\n<pre class="dir">\n' +
      '0 "' + escHtml(cfsPName) + '" CFS\n' +
      cfsRows.join('\n') + (cfsRows.length ? '\n' : '') +
      '</pre>\n</body>\n</html>';
    var cfsSafe = cfsTitleName.replace(/[<>:"/\\|?*]/g, '_') || 'directory';
    var cfsBlob = new Blob([cfsHtml], { type: 'text/html' });
    var cfsA = document.createElement('a');
    cfsA.href = URL.createObjectURL(cfsBlob);
    cfsA.download = cfsSafe + '.html';
    cfsA.click();
    URL.revokeObjectURL(cfsA.href);
    return;
  }
  if (!currentBuffer) return;
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
        clearCmdContainerState();
        openLnxArchiveAsTab(buf, fname);
        addRecentDisk(fname, buf);
        continue;
      }

      // CMD containers (RAMLink, FD2000/FD4000, CMD HD): open the partition list.
      if (/\.(rml|rl|d1m|d2m|d4m|dhd)$/i.test(fname)) {
        await openCmdContainerAsTab(buf, fname);
        continue;
      }

      clearCmdContainerState();
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

