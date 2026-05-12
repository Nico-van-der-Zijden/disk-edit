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
      // GEOS VLIR: dir T/S is the index sector, not file data — use Export CVT
      if (isVlirFile(data, entOff)) continue;
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


// ── File menu: Copy / Paste ──────────────────────────────────────────
document.getElementById('opt-copy').addEventListener('click', async (e) => {
  e.stopPropagation();
  if (!currentBuffer || selectedEntryIndex < 0) return;
  closeMenus();
  var data = new Uint8Array(currentBuffer);
  var entries = selectedEntries.length > 0 ? selectedEntries : [selectedEntryIndex];
  clipboard = [];

  var total = entries.length;
  var skipped = [];

  var progress = total > 1 ? showProgressModal('Copying Files') : null;

  for (var ci = 0; ci < entries.length; ci++) {
    var entOff = entries[ci];
    var typeIdx, nameBytes, geosBytes, geosInfoBlock;
    var fileName = '';

    if (isTapeFormat()) {
      var tapeEntry = getTapeEntry(entOff);
      if (!tapeEntry) continue;
      typeIdx = tapeEntry.type.trim() === 'SEQ' ? 1 : 2;
      nameBytes = new Uint8Array(16);
      for (var ni = 0; ni < 16 && ni < tapeEntry.name.length; ni++) {
        nameBytes[ni] = unicodeToPetscii(tapeEntry.name[ni]);
      }
      for (var pi = tapeEntry.name.length; pi < 16; pi++) nameBytes[pi] = 0xA0;
      geosBytes = new Uint8Array(9);
      geosInfoBlock = null;
      fileName = petsciiToReadable(tapeEntry.name).trim();
    } else {
      var typeByte = data[entOff + 2];
      typeIdx = typeByte & 0x07;
      nameBytes = new Uint8Array(16);
      for (var i = 0; i < 16; i++) nameBytes[i] = data[entOff + 5 + i];
      fileName = petsciiToReadable(readPetsciiString(data, entOff + 5, 16)).trim() || '?';
      if (typeIdx < 1 || typeIdx > 4) {
        skipped.push({ name: fileName, reason: 'Unsupported file type' });
        continue;
      }
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

    if (progress) await progress.update(ci, total, fileName);

    var vlirRecords = null;
    var fileData = null;
    if (isVlirFile(data, entOff)) {
      vlirRecords = readVLIRRecordsForCopy(currentBuffer, entOff);
      if (!vlirRecords || vlirRecords.length === 0) {
        skipped.push({ name: fileName, reason: 'Empty VLIR file (no records)' });
        continue;
      }
    } else {
      var result = readFileData(currentBuffer, entOff);
      if (result.error) {
        skipped.push({ name: fileName, reason: result.error });
        continue;
      }
      if (result.data.length === 0) {
        skipped.push({ name: fileName, reason: 'Empty file (no data)' });
        continue;
      }
      fileData = new Uint8Array(result.data);
    }

    clipboard.push({
      typeIdx: typeIdx,
      nameBytes: nameBytes,
      geosBytes: geosBytes,
      geosInfoBlock: geosInfoBlock,
      data: fileData,
      vlirRecords: vlirRecords
    });
  }

  // Close the progress modal on the happy path; only surface a summary
  // dialog when some files couldn't be copied.
  if (total > 1) {
    if (skipped.length > 0) {
      var lines = [clipboard.length + ' file(s) copied to clipboard.'];
      for (var si = 0; si < skipped.length; si++) {
        lines.push(skipped[si].name + ' \u2014 ' + skipped[si].reason);
      }
      showModal('Copy Complete', lines);
    } else {
      document.getElementById('modal-overlay').classList.remove('open');
    }
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

  var total = clipboard.length;
  var progress = showProgressModal('Pasting Files');

  var pasted = 0;
  var skipped = [];

  for (var pi = 0; pi < total; pi++) {
    var item = clipboard[pi];
    var fileName = petsciiToReadable(readPetsciiString(item.nameBytes, 0, 16)).trim() || '?';

    await progress.update(pi, total, fileName);

    var success;
    if (item.vlirRecords) {
      success = writeVlirFileToDisk(
        item.typeIdx | 0x80,
        item.nameBytes,
        item.vlirRecords,
        item.geosBytes,
        item.geosInfoBlock
      );
    } else {
      var geosData = null;
      if (item.geosBytes || item.geosInfoBlock) {
        geosData = { geosBytes: item.geosBytes, geosInfoBlock: item.geosInfoBlock };
      }
      success = writeFileToDisk(item.typeIdx, item.nameBytes, item.data, geosData);
    }
    if (success) {
      pasted++;
    } else {
      skipped.push({ name: fileName, reason: 'Disk full or no directory space' });
      break;
    }
  }

  for (var ri = pasted + skipped.length; ri < total; ri++) {
    var rItem = clipboard[ri];
    var rName = petsciiToReadable(readPetsciiString(rItem.nameBytes, 0, 16)).trim() || '?';
    skipped.push({ name: rName, reason: 'Not attempted (previous file failed)' });
  }

  if (pasted > 0) {
    var info = parseCurrentDir(currentBuffer);
    renderDisk(info);
  }

  var lines = [];
  if (pasted > 0) lines.push(pasted + ' file(s) pasted successfully.');
  for (var si2 = 0; si2 < skipped.length; si2++) {
    lines.push('Warning: ' + skipped[si2].name + ' \u2014 ' + skipped[si2].reason);
  }
  if (lines.length === 0) lines.push('No files pasted.');
  showModal(pasted === total ? 'Paste Complete' : 'Paste Incomplete', lines);
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

// Core write: writes file data to disk with sector chain, directory entry, BAM update, and verification.
// nameBytes = 16-byte Uint8Array of PETSCII filename (already padded with $A0)
// Returns true on success, false on failure (with rollback).
// geosData is optional: { geosBytes: Uint8Array(9), geosInfoBlock: Uint8Array(256)|null }
function writeFileToDisk(typeIdx, nameBytes, fileData, geosData, silent) {
  if (!silent) pushUndo();
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
    if (!silent) showModal('Write Error', ['Not enough free sectors. Need ' + numSectors + ', have ' + sectorList.length + '.']);
    return false;
  }

  // Reserve a directory entry before writing any data (fail early)
  // Pass allocated map so linked subdir expansion doesn't reuse file sectors
  var entryOff = findFreeDirEntry(currentBuffer, allocated);
  if (entryOff < 0) {
    if (!silent) showModal('Write Error', ['No free directory entry available.']);
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

  // Block count: all sectors including GEOS info block
  data[entryOff + 30] = sectorList.length & 0xFF;
  data[entryOff + 31] = (sectorList.length >> 8) & 0xFF;

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
    if (!silent) showModal('Write Error', ['Verification failed: ' + (verify.error || 'size mismatch')]);
    return false;
  }
  for (var vi = 0; vi < fileData.length; vi++) {
    if (verify.data[vi] !== fileData[vi]) {
      currentBuffer = snapshot;
      if (!silent) showModal('Write Error', ['Verification failed: data mismatch at byte ' + vi + '.']);
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

// Is `bytes` (Uint8Array) a CVT (GEOS ConVerT) file?
// CVT layout per Schepers' format docs: bytes 0-29 are a mock dir entry,
// and bytes 30-58 hold a NUL-terminated signature such as
// "PRG formatted GEOS file V1.0" (older CVTs omit " V1.0"). Some writers
// put a leading $00 at byte 30 before the "PRG"/"SEQ" prefix; tolerate
// that. We scan the printable chars in bytes 30-58 and require the
// signature text to be present.
function isCvtFile(bytes) {
  if (!bytes || bytes.length < 762) return false;
  var s = '';
  var end = Math.min(58, bytes.length);
  for (var i = 30; i < end; i++) {
    var b = bytes[i];
    if (b >= 0x20 && b <= 0x7E) s += String.fromCharCode(b);
  }
  return s.indexOf('formatted GEOS file') >= 0;
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

  var result = importCvtFileCore(cvt, /*silent*/ false);
  if (result.error) {
    showModal('Import Error', [result.error]);
    return;
  }
  var info = parseCurrentDir(currentBuffer);
  renderDisk(info);
  showModal('CVT Import Successful', ['"' + result.name + '" imported successfully.']);
}

// Core CVT import: parse the CVT structure and write the file to the current
// disk. Silent (no modals); returns { name } on success or { error } on
// failure. Shared by importCvtFile (public) and extractLnxToNewD64 (bulk
// GEOS extraction).
function importCvtFileCore(cvt, silent) {
  if (cvt.length < 762) return { error: 'CVT file too small.' };

  // Block 1 ($000-$0FD): directory entry + CVT signature area
  var dirEntry = cvt.subarray(0, 254);

  // Detect signature anywhere in bytes 30-79 (some archives have a leading
  // NUL at offset 30, so a NUL-stopped scan misses the real text).
  var sig = '';
  for (var si = 30; si < Math.min(80, dirEntry.length); si++) {
    var b = dirEntry[si];
    if (b >= 0x20 && b <= 0x7E) sig += String.fromCharCode(b);
  }
  var isV10 = sig.indexOf('V1.0') >= 0;
  var isBroken = !isV10 && sig.indexOf('formatted GEOS file') >= 0;
  if (!isV10 && !isBroken) return { error: 'Not a valid CVT file (unknown signature).' };

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

  var displayName = petsciiToReadable(readPetsciiString(nameBytes, 0, 16)).trim();

  if (!isVlir) {
    // Sequential GEOS file: data starts at offset 508
    var seqData = cvt.subarray(508);
    var geosData = { geosBytes: geosBytes, geosInfoBlock: infoBlock };
    geosBytes[0] = 0; // info track placeholder
    geosBytes[1] = 0; // info sector placeholder
    if (writeFileToDisk(typeIdx | 0x80, nameBytes, seqData, geosData, silent)) {
      return { name: displayName };
    }
    return { error: 'Failed to write "' + displayName + '" (disk or directory full).' };
  }

  // VLIR file: block 3 ($1FC-$2F9) = record index, then record data
  var recordIndex = cvt.subarray(508, 762);
  var records = [];
  var dataPos = 762;
  for (var ri = 0; ri < 127; ri++) {
    var b0 = recordIndex[ri * 2];
    var b1 = recordIndex[ri * 2 + 1];
    if (b0 === 0 && b1 === 0) { records.push(null); break; }
    if (b0 === 0 && b1 === 0xFF) { records.push({ data: null }); continue; }
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
  if (writeVlirFileToDisk(typeIdx | 0x80, nameBytes, records, geosBytes, infoBlock, silent)) {
    return { name: displayName };
  }
  return { error: 'Failed to write "' + displayName + '" (disk or directory full).' };
}

function writeVlirFileToDisk(typeByte, nameBytes, records, geosBytes, infoBlock, silent) {
  if (!silent) pushUndo();
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
    if (!silent) showModal('Write Error', ['Not enough free sectors. Need ' + totalSectors + ', have ' + sectorList.length + '.']);
    return false;
  }

  var entryOff = findFreeDirEntry(currentBuffer, allocated);
  if (entryOff < 0) {
    currentBuffer = snapshot;
    if (!silent) showModal('Write Error', ['No free directory entry available.']);
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

  // Free all file sectors in BAM (main chain + REL + GEOS)
  forEachFileSector(data, entryOff, function(t, s) {
    bamMarkSectorFree(data, t, s, bamOff);
  });

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

  // Mark all file sectors as used in BAM (main chain + REL + GEOS)
  var fmt = currentFormat;
  var bamOff = sectorOffset(fmt.bamTrack, fmt.bamSector);
  var sectorCount = forEachFileSector(data, entryOff, function(t, s) {
    bamMarkSectorUsed(data, t, s, bamOff);
  });

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

