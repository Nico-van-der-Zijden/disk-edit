// ── File menu: Export File ─────────────────────────────────────────────
document.getElementById('opt-export').addEventListener('click', (e) => {
  e.stopPropagation();
  if (!currentBuffer || selectedEntryIndex < 0) return;
  closeMenus();
  // CFS: data via the B-tree walker, extension from the entry's typeSuffix.
  if (cfsPartitionIdx >= 0 && cfsDirEntries) {
    var rawIdx = selectedEntries.length > 0 ? selectedEntries : [selectedEntryIndex];
    for (var ti = 0; ti < rawIdx.length; ti++) {
      var cEntry = cfsDirEntries[rawIdx[ti]];
      if (!cEntry || cEntry.empty || cEntry.ftype === CFS_FTYPE.DIR ||
          cEntry.ftype === CFS_FTYPE.LNK || cEntry.ftype === CFS_FTYPE.DEL) continue;
      if (!cEntry.dataTreePtr || !cEntry.dataTreePtr.lba) continue;
      var cRes = readCfsFileData(hddBuffer, cEntry.dataTreePtr.addr, cEntry.size);
      if (cRes.error || !cRes.data || cRes.data.length === 0) continue;
      var cName = safeHostFileName(petsciiToReadable(cEntry.name).trim(), 'export');
      var cExt = (cEntry.typeSuffix || 'PRG').toLowerCase();
      downloadBlob(new Blob([cRes.data], { type: 'application/octet-stream' }), cName + '.' + cExt);
    }
    return;
  }
  var entries = selectedEntries.length > 0 ? selectedEntries : [selectedEntryIndex];
  var data = new Uint8Array(currentBuffer);

  for (var ei = 0; ei < entries.length; ei++) {
    var entOff = entries[ei];
    var ext, name;

    if (isTapeFormat(getCurrentCtx())) {
      var tapeEntry = getTapeEntry(entOff);
      if (!tapeEntry) continue;
      ext = tapeEntry.type.trim() === 'SEQ' ? '.seq' : '.prg';
      name = petsciiToReadable(tapeEntry.name).trim();
    } else {
      var typeByte = data[entOff + 2];
      var typeIdx = typeByte & 0x07;
      if (typeIdx < FILE_TYPE.SEQ || typeIdx > FILE_TYPE.REL) continue;
      // GEOS VLIR: dir T/S is the index sector, not file data — use Export CVT
      if (isVlirFile(data, entOff)) continue;
      ext = '.' + FILE_TYPES[typeIdx].toLowerCase();
      name = petsciiToReadable(readPetsciiString(data, entOff + 5, 16)).trim();
    }

    var result = readFileData(currentBuffer, entOff, getCurrentCtx());
    if (result.error || result.data.length === 0) continue;

    name = safeHostFileName(name, 'export');
    downloadBlob(new Blob([result.data], { type: 'application/octet-stream' }), name + exportExtFor(name, ext));
  }
});

// ── Export as CVT (GEOS ConVerT format) ──────────────────────────────
function buildCvtFile(entryOff) {
  var data = new Uint8Array(currentBuffer);
  var geos = readGeosInfo(currentBuffer, entryOff, getCurrentCtx());

  // Block 1: directory entry bytes 2-31 + signature + zero padding
  var block1 = new Uint8Array(254);
  for (var i = 0; i < 30; i++) block1[i] = data[entryOff + 2 + i];
  var isVlir = geos.structure === 1;
  var sig = isVlir ? 'PRG formatted GEOS file V1.0' : 'SEQ formatted GEOS file V1.0';
  for (var si = 0; si < sig.length; si++) block1[30 + si] = sig.charCodeAt(si);

  // Block 2: info block (254 bytes = sector bytes 2-255)
  var block2 = new Uint8Array(254);
  if (geos.infoTrack > 0) {
    var infoOff = sectorOffset(geos.infoTrack, geos.infoSector, getCurrentCtx());
    if (infoOff >= 0) {
      for (var j = 0; j < 254; j++) block2[j] = data[infoOff + 2 + j];
    }
  }

  if (isVlir) {
    var records = readVLIRRecords(currentBuffer, entryOff, getCurrentCtx());

    // Read VLIR index sector to distinguish 00/00 vs 00/FF
    var vlirT = data[entryOff + 3], vlirS = data[entryOff + 4];
    var vlirOff = sectorOffset(vlirT, vlirS, getCurrentCtx());
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
    var result = readFileData(currentBuffer, entryOff, getCurrentCtx());
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
  var name = safeHostFileName(petsciiToReadable(readPetsciiString(data, selectedEntryIndex + 5, 16)).trim(), 'export');
  var cvtData = buildCvtFile(selectedEntryIndex);
  downloadBlob(new Blob([cvtData], { type: 'application/octet-stream' }), name + '.cvt');
});


// ── DEL-art detection helpers ──────────────────────────────────────────
// Closed-DEL dir entries are usually directory art — graphic name bytes,
// block count often deliberately set to a number with no relation to a
// real chain (e.g. the year the production was made), T/S pointing at
// the dir track or some other "looks nice" value that isn't a real file
// start. A rare alternative is the "DEL with hidden payload" trick: a
// closed-DEL whose T/S really does start a chain of loadable bytes.
//
// _tryWalkDelPayload walks the candidate chain with strict sanity guards
// and returns the data only if every check passes — including a tight
// length match to the source block count and the constraint that the
// chain doesn't pass through the dir track. Callers should additionally
// check that the chain sectors don't overlap any other live file's
// chain (via _collectLiveFileSectorOwners).
function _tryWalkDelPayload(buffer, ctx, startT, startS, expectedBlocks) {
  if (startT === 0 || expectedBlocks <= 0) return null;
  var dirCtx = getDirContext(ctx);
  if (startT === dirCtx.dirTrack) return null;
  if (startT < 1 || startT > ctx.tracks) return null;
  var disk = new Uint8Array(buffer);
  var visited = {};
  var sectors = [];
  var bytes = [];
  var blocks = 0;
  var cap = expectedBlocks + 4;
  var t = startT, s = startS;
  while (t !== 0) {
    if (blocks > cap) return null;
    if (t < 1 || t > ctx.tracks) return null;
    if (t === dirCtx.dirTrack) return null;
    var spt = ctx.format.sectorsPerTrack(t);
    if (s < 0 || s >= spt) return null;
    var key = t * 256 + s;
    if (visited[key]) return null;
    visited[key] = true;
    sectors.push(key);
    var off = sectorOffset(t, s, ctx);
    if (off < 0) return null;
    var nextT = disk[off];
    var nextS = disk[off + 1];
    if (nextT === 0) {
      var lastIdx = nextS;
      for (var i = 2; i <= lastIdx && i < 256; i++) bytes.push(disk[off + i]);
    } else {
      for (var j = 2; j < 256; j++) bytes.push(disk[off + j]);
    }
    blocks++;
    t = nextT;
    s = nextS;
  }
  if (Math.abs(blocks - expectedBlocks) > 2) return null;
  return { data: new Uint8Array(bytes), blocks: blocks, sectors: sectors };
}

// Map every sector owned by a closed regular file (typeIdx 1-4) in the
// current directory to "true". Used to make sure a DEL-payload chain we
// just walked doesn't trespass on a real file's storage — that'd mean we
// were just following someone else's chain and would duplicate the data
// (and risk corrupting the source on paste).
function _collectLiveFileSectorOwners(buffer, ctx, excludeEntryOff) {
  var data = new Uint8Array(buffer);
  var slots = getDirSlotOffsets(buffer);
  var owned = {};
  for (var si = 0; si < slots.length; si++) {
    var eo = slots[si];
    if (eo === excludeEntryOff) continue;
    var tb = data[eo + 2];
    if ((tb & 0x80) === 0) continue;
    var ti = tb & 0x07;
    if (ti < 1 || ti > 4) continue;
    var t = data[eo + 3], s = data[eo + 4];
    if (t === 0) continue;
    var visited = {};
    var hops = 0;
    while (t !== 0 && hops < 65536) {
      var key = t * 256 + s;
      if (visited[key]) break;
      visited[key] = true;
      owned[key] = true;
      var off = sectorOffset(t, s, ctx);
      if (off < 0) break;
      t = data[off]; s = data[off + 1];
      hops++;
    }
  }
  return owned;
}


// Paste an art-DEL clipboard item into a CBM-DOS destination. Bare path
// (no payload): allocate a dir slot via insertFileEntry, patch the bytes
// to match the source (typeByte preserves Closed + Lock, T/S=0/0, block
// count from source — could be 0, the year, anything). Payload path:
// writeFileToDisk allocates the chain, then we override the type byte
// (to preserve the lock bit writeFileToDisk doesn't carry) and the
// block-count field (source's value, which may not match the chain
// length).
function _pasteArtDelToCbmDos(item) {
  if (!item.payload) {
    var off = insertFileEntry();
    if (off < 0) return false;
    var d = new Uint8Array(currentBuffer);
    d[off + 2] = item.typeByte;
    d[off + 3] = 0;
    d[off + 4] = 0;
    for (var bn = 0; bn < 16; bn++) d[off + 5 + bn] = item.nameBytes[bn];
    for (var bg = 0; bg < 9; bg++) d[off + 21 + bg] = item.geosBytes[bg];
    d[off + 30] = item.blockCount & 0xFF;
    d[off + 31] = (item.blockCount >> 8) & 0xFF;
    return true;
  }
  // Payload path: writeFileToDisk leaves the new entry in selectedEntryIndex.
  if (!writeFileToDisk(0, item.nameBytes, item.payload, null, true, getCurrentCtx())) return false;
  var nowData = new Uint8Array(currentBuffer);
  var ao = selectedEntryIndex;
  nowData[ao + 2] = item.typeByte;   // restore Lock bit; writeFileToDisk only set 0x80|typeIdx
  nowData[ao + 30] = item.blockCount & 0xFF;
  nowData[ao + 31] = (item.blockCount >> 8) & 0xFF;
  for (var gb = 0; gb < 9; gb++) nowData[ao + 21 + gb] = item.geosBytes[gb];
  return true;
}


// ── File menu: Copy / Paste ──────────────────────────────────────────
document.getElementById('opt-copy').addEventListener('click', async (e) => {
  e.stopPropagation();
  if (!currentBuffer || selectedEntryIndex < 0) return;
  closeMenus();
  // CFS: same clipboard shape as CBM-DOS, plus cfsTypeSuffix so a paste
  // back into CFS keeps the original label.
  if (cfsPartitionIdx >= 0 && cfsDirEntries) {
    var rawIdx = selectedEntries.length > 0 ? selectedEntries : [selectedEntryIndex];
    clipboard = [];
    var cfsSkipped = [];
    var cfsProgress = rawIdx.length > 1 ? showProgressModal('Copying Files') : null;
    for (var cci = 0; cci < rawIdx.length; cci++) {
      var ce = cfsDirEntries[rawIdx[cci]];
      if (!ce || ce.empty) continue;
      var ceName = petsciiToReadable(ce.name).trim() || '?';
      // DIR entries: collect the whole subtree (recursive) into a single
      // clipboard item. Paste recreates the tree at the destination.
      if (ce.ftype === CFS_FTYPE.DIR) {
        if (_cfsEntryIsDeldirRef(ce)) {
          cfsSkipped.push({ name: ceName, reason: 'System "<<DELETED FILES>>" entry — not copyable' });
          continue;
        }
        if (!ce.dataTreePtr || !ce.dataTreePtr.lba) {
          cfsSkipped.push({ name: ceName, reason: 'Empty dir pointer' });
          continue;
        }
        var dirDisk = new Uint8Array(hddBuffer);
        var dirNameBytes = new Uint8Array(16);
        var dirSrcOff = ce.dirLba * IDE64_SECTOR_SIZE + ce.index * CFS_DIR_ENTRY_SIZE;
        for (var dni = 0; dni < 16; dni++) dirNameBytes[dni] = dirDisk[dirSrcOff + dni];
        if (cfsProgress) await cfsProgress.update(cci, rawIdx.length, ceName);
        var dirColl = cfsCollectDirTree(hddBuffer, ce.dataTreePtr.addr, dirNameBytes);
        if (!dirColl.ok) {
          cfsSkipped.push({ name: ceName, reason: dirColl.error || 'collect failed' });
          continue;
        }
        clipboard.push({
          kind: 'cfs-dir-tree',
          nameBytes: dirNameBytes,
          tree: dirColl.tree,
          skippedLnks: dirColl.skippedLnks,
        });
        continue;
      }
      // Separator entries: CFS-side directory art (cfsInsertSeparator).
      // Closed-DEL with no real data — capture as a 'cbm-del' clipboard
      // entry so cross-family pastes (CFS → CBM-DOS) and CFS → CFS both
      // work. Scratched DEL (closed bit clear) keeps falling through to
      // the skip path below.
      if (ce.ftype === CFS_FTYPE.DEL && ce.closed) {
        var sepDisk = new Uint8Array(hddBuffer);
        var sepNameBytes = new Uint8Array(16);
        var sepSrcOff = ce.dirLba * IDE64_SECTOR_SIZE + ce.index * CFS_DIR_ENTRY_SIZE;
        for (var spi = 0; spi < 16; spi++) sepNameBytes[spi] = sepDisk[sepSrcOff + spi];
        clipboard.push({
          kind: 'cbm-del',
          typeByte: 0x80,     // CBM-DOS-equivalent: closed DEL, no lock (CFS has no source lock to carry)
          nameBytes: sepNameBytes,
          blockCount: 0,
          geosBytes: new Uint8Array(9),
          payload: null
        });
        continue;
      }
      if (ce.ftype === CFS_FTYPE.LNK || ce.ftype === CFS_FTYPE.DEL) {
        cfsSkipped.push({ name: ceName, reason: 'Not a file (link / scratched)' });
        continue;
      }
      if (!ce.dataTreePtr || !ce.dataTreePtr.lba) {
        cfsSkipped.push({ name: ceName, reason: 'No data tree pointer' });
        continue;
      }
      if (cfsProgress) await cfsProgress.update(cci, rawIdx.length, ceName);
      var cRes = readCfsFileData(hddBuffer, ce.dataTreePtr.addr, ce.size);
      if (cRes.error) { cfsSkipped.push({ name: ceName, reason: cRes.error }); continue; }
      if (!cRes.data || cRes.data.length === 0) { cfsSkipped.push({ name: ceName, reason: 'Empty file' }); continue; }
      // Build a 16-byte $A0-padded name (CBM convention, what
      // writeFileToDisk expects). Source bytes come straight from the
      // dir entry — preserves PETSCII reversed glyphs / hard-spaces.
      var disk = new Uint8Array(hddBuffer);
      var nameBytes = new Uint8Array(16);
      var srcOff = ce.dirLba * IDE64_SECTOR_SIZE + ce.index * CFS_DIR_ENTRY_SIZE;
      for (var nbi = 0; nbi < 16; nbi++) nameBytes[nbi] = disk[srcOff + nbi];
      // Custom suffixes (CVT, TXT, ...) paste into CBM-DOS as PRG.
      var sufKey = (ce.typeSuffix || 'PRG').toUpperCase();
      var typeIdxFromCfs = FILE_TYPE[sufKey] >= FILE_TYPE.SEQ && FILE_TYPE[sufKey] <= FILE_TYPE.REL
        ? FILE_TYPE[sufKey] : FILE_TYPE.PRG;
      clipboard.push({
        typeIdx: typeIdxFromCfs,
        nameBytes: nameBytes,
        geosBytes: null,
        geosInfoBlock: null,
        data: new Uint8Array(cRes.data),
        vlirRecords: null,
        cfsTypeSuffix: ce.typeSuffix || sufKey,
      });
    }
    if (rawIdx.length > 1) {
      if (cfsSkipped.length > 0) {
        var lines = [clipboard.length + ' file(s) copied to clipboard.'];
        for (var sk = 0; sk < cfsSkipped.length; sk++) lines.push(cfsSkipped[sk].name + ' — ' + cfsSkipped[sk].reason);
        showModal('Copy Complete', lines);
      } else {
        document.getElementById('modal-overlay').classList.remove('open');
      }
    }
    updateEntryMenuState();
    return;
  }
  var data = new Uint8Array(currentBuffer);
  var entries = selectedEntries.length > 0 ? selectedEntries : [selectedEntryIndex];
  clipboard = [];

  var total = entries.length;
  var skipped = [];
  // 'ask' | 'yes' | 'no' — for the rare DEL-with-real-payload case, the
  // user gets a single Yes/No/Yes-all/No-all prompt; their answer applies
  // to the rest of this copy.
  var delPayloadDecision = 'ask';

  var progress = total > 1 ? showProgressModal('Copying Files') : null;

  for (var ci = 0; ci < entries.length; ci++) {
    var entOff = entries[ci];
    var typeIdx, nameBytes, geosBytes, geosInfoBlock;
    var fileName = '';

    if (isTapeFormat(getCurrentCtx())) {
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
      // Subdir / sub-partition entries: collect the whole tree into a
      // single clipboard item via cbmCollectDirTree. Symmetric with the
      // CFS-side DIR-copy branch up above. Both DNP linked subdirs and
      // D81-style CBM partitions (file type $05 with !subdirLinked)
      // share this typeByte check; cbmCollectDirTree picks the right
      // child-ctx shape based on the format descriptor.
      if (currentFormat && typeIdx === currentFormat.subdirType) {
        var fileT = data[entOff + 3];
        var fileS = data[entOff + 4];
        var childCtx;
        if (currentFormat.subdirLinked) {
          var hdrOff2 = sectorOffset(fileT, fileS, getCurrentCtx());
          if (hdrOff2 < 0) {
            skipped.push({ name: fileName, reason: 'Subdir header out of range' });
            continue;
          }
          childCtx = Object.assign({}, getCurrentCtx(), {
            partition: {
              dnpDir: true,
              dnpHeaderT: fileT, dnpHeaderS: fileS,
              dnpDirT: data[hdrOff2 + 0x00], dnpDirS: data[hdrOff2 + 0x01],
              name: fileName,
            },
          });
        } else {
          var partSize = data[entOff + 30] | (data[entOff + 31] << 8);
          if (!partSize) {
            skipped.push({ name: fileName, reason: 'Partition entry has zero size' });
            continue;
          }
          childCtx = Object.assign({}, getCurrentCtx(), {
            partition: { startTrack: fileT, partSize: partSize, name: fileName },
          });
        }
        if (progress) await progress.update(ci, total, fileName);
        var coll = cbmCollectDirTree(childCtx, nameBytes);
        if (!coll.ok) {
          skipped.push({ name: fileName, reason: coll.error || 'collect failed' });
          continue;
        }
        clipboard.push({
          kind: 'cbm-dir-tree',
          nameBytes: nameBytes,
          tree: coll.tree,
          skippedLnks: [],
        });
        continue;
      }
      // Closed-DEL = directory art (or, rarely, a DEL with a real chain
      // behind it). Capture the dir-entry bytes; only follow the chain if
      // the detection helpers think it's a real payload AND the user
      // confirms.
      if (typeIdx === 0 && (typeByte & 0x80) !== 0) {
        var delBlockCount = data[entOff + 0x1E] | (data[entOff + 0x1F] << 8);
        var delGeos = new Uint8Array(9);
        for (var dg = 0; dg < 9; dg++) delGeos[dg] = data[entOff + 21 + dg];
        var delPayload = null;
        if (delBlockCount > 0) {
          var startT = data[entOff + 3], startS = data[entOff + 4];
          var walked = _tryWalkDelPayload(currentBuffer, getCurrentCtx(), startT, startS, delBlockCount);
          if (walked) {
            var owners = _collectLiveFileSectorOwners(currentBuffer, getCurrentCtx(), entOff);
            var overlap = false;
            for (var wi = 0; wi < walked.sectors.length; wi++) {
              if (owners[walked.sectors[wi]]) { overlap = true; break; }
            }
            if (!overlap) {
              var decision = delPayloadDecision;
              if (decision === 'ask') {
                var choice = await showChoiceModal(
                  'Copy DEL payload?',
                  '"' + fileName + '" is a closed DEL entry but its track/sector points at what looks like a real ' + walked.blocks + '-block file. Copy the chain too?',
                  [
                    { label: 'No to all', value: 'no-all', secondary: true },
                    { label: 'No', value: 'no', secondary: true },
                    { label: 'Yes', value: 'yes' },
                    { label: 'Yes to all', value: 'yes-all' }
                  ]
                );
                if (choice === 'yes-all') { delPayloadDecision = 'yes'; decision = 'yes'; }
                else if (choice === 'no-all') { delPayloadDecision = 'no'; decision = 'no'; }
                else decision = choice || 'no';
              }
              if (decision === 'yes') delPayload = walked.data;
            }
          }
        }
        clipboard.push({
          kind: 'cbm-del',
          typeByte: typeByte,   // preserves Closed (0x80) + Lock (0x40)
          nameBytes: nameBytes,
          blockCount: delBlockCount,
          geosBytes: delGeos,
          payload: delPayload
        });
        continue;
      }
      if (typeIdx < FILE_TYPE.SEQ || typeIdx > FILE_TYPE.REL) {
        skipped.push({ name: fileName, reason: 'Unsupported file type' });
        continue;
      }
      // $15-$1D only carry GEOS metadata on GEOS files; on a REL file
      // $15-$17 are its side-sector T/S and record length.
      var isGeos = data[entOff + 0x18] > 0 && typeIdx !== FILE_TYPE.REL;
      geosBytes = null;
      geosInfoBlock = null;
      if (isGeos) {
        geosBytes = data.slice(entOff + 21, entOff + 30);
      }
      var infoTrack = data[entOff + 0x15];
      var infoSector = data[entOff + 0x16];
      if (isGeos && infoTrack > 0) {
        var infoOff = sectorOffset(infoTrack, infoSector, getCurrentCtx());
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
      vlirRecords = readVLIRRecordsForCopy(currentBuffer, entOff, getCurrentCtx());
      if (!vlirRecords || vlirRecords.length === 0) {
        skipped.push({ name: fileName, reason: 'Empty VLIR file (no records)' });
        continue;
      }
    } else {
      var result = readFileData(currentBuffer, entOff, getCurrentCtx());
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
  if (clipboard.length === 0) return;
  closeMenus();
  if (cfsPartitionIdx >= 0 && cfsDirEntries) await pasteIntoCfs();
  else await pasteIntoCbmDos();
});

function _isTreeClipItem(it) {
  return it.kind === 'cfs-dir-tree' || it.kind === 'cbm-dir-tree';
}

function _clipItemName(nameBytes) {
  return petsciiToReadable(readPetsciiString(nameBytes, 0, 16)).trim() || '?';
}

// Summary lines for a "not copied" list, capped at 12 names.
function _pasteListLines(header, names) {
  if (!names.length) return [];
  var out = ['', header];
  for (var i = 0; i < names.length && i < 12; i++) out.push('  ' + names[i]);
  if (names.length > 12) out.push('  … and ' + (names.length - 12) + ' more');
  return out;
}

// One undo step for the whole paste: trees first, then flat items.
async function pasteIntoCfs() {
  var cPart = hddPartitions && hddPartitions[cfsPartitionIdx];
  if (!cPart) return;
  var treeItems = clipboard.filter(_isTreeClipItem);
  var flatItems = clipboard.filter(function(it) { return !_isTreeClipItem(it); });
  if (treeItems.length > 0) {
    var needed = 0;
    for (var ti = 0; ti < treeItems.length; ti++) needed += cfsEstimateTreeSectors(treeItems[ti].tree);
    var freeSec = cfsCountFreeSectors(hddBuffer, cPart.startLba, cPart.endLba);
    if (needed > freeSec) {
      showModal('Paste — not enough space', [
        'Pasting needs at least ' + needed + ' free sectors but the partition has ' + freeSec + '.',
        'Free up ' + (needed - freeSec) + ' more sector(s) (or pick a bigger partition) and try again.',
      ]);
      return;
    }
  }

  function abort(title, lines) {
    discardUndo();
    refreshIde64View();
    if (title) showModal(title, lines);
  }

  pushUndo();
  var treeFiles = 0, treeDirs = 0;
  var treeAllLnks = [];
  for (var pti = 0; pti < treeItems.length; pti++) {
    var titem = treeItems[pti];
    var mode = 'cancel'; // no conflict: cfsPasteDirTree ignores the mode
    if (_cfsFindDirEntryByNameBytes(hddBuffer, cfsDirLba, titem.nameBytes)) {
      var choice = await showChoiceModal(
        'Directory exists',
        'The destination already has an entry named "' + _clipItemName(titem.nameBytes) + '". What would you like to do?',
        [
          { label: 'Cancel', value: 'cancel', secondary: true },
          { label: 'Rename', value: 'rename' },
          { label: 'Overwrite', value: 'overwrite' },
        ]
      );
      if (choice === 'cancel' || choice == null) { abort(); return; }
      mode = choice;
    }
    var pres = cfsPasteDirTree(hddBuffer, cPart.startLba, cPart.endLba, cfsDirLba, titem.tree, { onConflict: mode });
    if (!pres.ok) { abort('Paste failed', [pres.error || 'Unknown error.']); return; }
    treeFiles += pres.copiedFiles;
    treeDirs += pres.copiedDirs;
    if (pres.skippedLnks) treeAllLnks = treeAllLnks.concat(pres.skippedLnks);
    // LNKs noted at copy time never reach the paste's recursion.
    if (titem.skippedLnks) {
      for (var tlnk = 0; tlnk < titem.skippedLnks.length; tlnk++) {
        if (treeAllLnks.indexOf(titem.skippedLnks[tlnk]) < 0) treeAllLnks.push(titem.skippedLnks[tlnk]);
      }
    }
  }

  // cfsImportFile extends the dir chain itself when every slot is used.
  var cTotal = flatItems.length;
  var cProgress = cTotal > 1 ? showProgressModal('Pasting Files') : null;
  var cPasted = 0;
  var cSkipped = [];
  for (var pi2 = 0; pi2 < cTotal; pi2++) {
    var item = flatItems[pi2];
    // Directory art goes through the CFS separator insert; block count,
    // lock bit and any DEL payload don't translate.
    if (item.kind === 'cbm-del') {
      if (cProgress) await cProgress.update(pi2, cTotal, '<separator>');
      var sepRes = cfsInsertSeparator(hddBuffer, cfsDirLba, item.nameBytes);
      if (sepRes.ok) {
        cPasted++;
        if (item.payload) cSkipped.push('separator: payload dropped (CFS has no DEL-with-data convention)');
      } else {
        cSkipped.push('separator: ' + (sepRes.error || 'unknown'));
      }
      continue;
    }
    var typeName = item.typeIdx >= FILE_TYPE.SEQ && item.typeIdx <= FILE_TYPE.REL ? FILE_TYPES[item.typeIdx] : 'PRG';
    if (!item.data || item.vlirRecords) {
      cSkipped.push((item.cfsTypeSuffix || typeName) + ': cannot paste VLIR / empty');
      continue;
    }
    // Raw name bytes, so reversed glyphs and hard spaces survive.
    var pName = '';
    for (var ni = 0; ni < 16; ni++) {
      var nb = item.nameBytes[ni];
      if (nb === 0xA0 || nb === 0x00) break;
      pName += String.fromCharCode(nb);
    }
    if (!pName) pName = 'PASTED';
    if (cProgress) await cProgress.update(pi2, cTotal, pName);
    var pRes = cfsImportFile(hddBuffer, cPart.startLba, cPart.endLba, cfsDirLba, pName, item.data, {
      ftype: item.typeIdx === FILE_TYPE.REL ? CFS_FTYPE.REL : CFS_FTYPE.NORMAL,
      typeSuffix: item.cfsTypeSuffix || typeName,
    });
    if (pRes.ok) cPasted++;
    else cSkipped.push(pName + ' — ' + (pRes.error || 'unknown'));
  }
  if (cProgress) document.getElementById('modal-overlay').classList.remove('open');

  if (treeItems.length === 0 && cPasted === 0) {
    abort('Paste failed', cSkipped.length ? cSkipped : ['Nothing could be pasted.']);
    return;
  }
  refreshIde64View();
  if (treeItems.length === 0 && cSkipped.length === 0) return;
  var summary = [];
  if (treeItems.length > 0) {
    summary.push('Pasted ' + treeDirs + ' director' + (treeDirs === 1 ? 'y' : 'ies') + ' and ' +
      treeFiles + ' file' + (treeFiles === 1 ? '' : 's') + '.');
  }
  if (cTotal > 0) summary.push(cPasted + ' file(s) pasted.');
  summary = summary.concat(_pasteListLines(
    treeAllLnks.length + ' link(s) not copied (link targets generally don\'t resolve across .hdd images):', treeAllLnks));
  if (cSkipped.length > 0) summary = summary.concat([''], cSkipped);
  showModal(cSkipped.length > 0 ? 'Paste — partial' : 'Paste complete', summary);
}

// One undo step for the whole paste, including a GEOS conversion or a
// partition grow the user agreed to on the way.
async function pasteIntoCbmDos() {
  if (!currentBuffer || !canInsertFile()) return;
  var treeItems = clipboard.filter(_isTreeClipItem);
  var flatItems = clipboard.filter(function(it) { return !_isTreeClipItem(it); });

  var convertGeos = false;
  var hasGeos = flatItems.some(function(c) { return c.geosInfoBlock != null; });
  if (hasGeos && !hasGeosSignature(currentBuffer, getCurrentCtx())) {
    var choice = await showChoiceModal(
      'GEOS File',
      'Clipboard contains GEOS file(s) but the disk is not in GEOS format. Convert disk to GEOS format?',
      [
        { label: 'Cancel', value: 'cancel', secondary: true },
        { label: 'Paste Anyway', value: 'paste' },
        { label: 'Convert & Paste', value: 'convert' }
      ]
    );
    if (choice !== 'paste' && choice !== 'convert') return;
    convertGeos = choice === 'convert';
  }

  var growShortfall = 0;
  if (treeItems.length > 0) {
    var cbmPreCtx = getCurrentCtx();
    var cbmNeeded = 0;
    for (var cni = 0; cni < treeItems.length; cni++) {
      cbmNeeded += cbmEstimateTreeSectors(treeItems[cni].tree, cbmPreCtx.format);
    }
    var cbmFree = cbmCountFreeSectors(cbmPreCtx);
    if (cbmNeeded > cbmFree) {
      var shortfall = cbmNeeded - cbmFree;
      // A 1581 sub-partition may be able to grow into adjacent free root tracks.
      var canGrow = (cbmPreCtx.partition && cbmPreCtx.partition.startTrack &&
                     cbmPreCtx.format.supportsSubdirs && !cbmPreCtx.format.subdirLinked);
      var growPreview = null;
      if (canGrow) {
        var preview = _cbmGrowD81Partition(cbmPreCtx, shortfall, { dryRun: true });
        if (preview.ok) growPreview = preview;
      }
      var needLine = 'Need ' + shortfall + ' more block(s) (' + cbmNeeded + ' needed, ' + cbmFree + ' free).';
      if (growPreview && growPreview.addedSectors >= shortfall) {
        var grow = await showChoiceModal(
          'Directory full',
          needLine + '\nGrow this directory by ' + growPreview.addedTracks + ' track(s) (' +
            growPreview.addedSectors + ' blocks) into adjacent free space?',
          [
            { label: 'Cancel', value: false, secondary: true },
            { label: 'Grow', value: true },
          ]
        );
        if (!grow) return;
        growShortfall = shortfall;
      } else if (growPreview) {
        showModal('Directory full', [
          needLine,
          'This directory can only be grown by ' + growPreview.addedSectors +
            ' block(s) — still ' + (shortfall - growPreview.addedSectors) + ' block(s) short.',
          'Free up space or paste into a different directory.',
        ]);
        return;
      } else {
        showModal('Directory full', [needLine, 'Free up space or paste into a different directory.']);
        return;
      }
    }
  }

  function abort(title, lines) {
    discardUndo();
    resyncPartitionSize();
    renderDisk(parseCurrentDir(currentBuffer));
    updateMenuState();
    if (title) showModal(title, lines);
  }

  pushUndo();
  if (convertGeos) writeGeosSignature(currentBuffer, getCurrentCtx());
  if (growShortfall > 0) {
    var grown = _cbmGrowD81Partition(getCurrentCtx(), growShortfall);
    if (!grown.ok) { abort('Grow failed', [grown.error || 'Could not grow the directory.']); return; }
    currentPartition.partSize = grown.newPartSize;
  }

  var treeFiles = 0, treeDirs = 0;
  var treeSkippedDirs = [], treeSkippedLnks = [];
  for (var ctI = 0; ctI < treeItems.length; ctI++) {
    var titem = treeItems[ctI];
    // One prompt covers a top-level clash and clashes among the tree's
    // immediate children when it pastes flat into the current dir.
    var cbmCtx = getCurrentCtx();
    var conflicts = cbmFindTreeConflicts(cbmCtx, titem.tree);
    var mode = 'cancel';
    if (conflicts.total > 0) {
      var msgLines = [];
      if (conflicts.topLevel) {
        msgLines.push('Directory "' + conflicts.topLevel + '" already exists at the destination.');
      } else {
        if (conflicts.files.length) {
          msgLines.push(conflicts.files.length + ' file(s) at the destination have the same name:');
          for (var ci = 0; ci < Math.min(conflicts.files.length, 8); ci++) msgLines.push('  ' + conflicts.files[ci]);
          if (conflicts.files.length > 8) msgLines.push('  … and ' + (conflicts.files.length - 8) + ' more');
        }
        if (conflicts.subdirs.length) {
          if (msgLines.length) msgLines.push('');
          msgLines.push(conflicts.subdirs.length + ' director(y/ies) at the destination have the same name:');
          for (var cs = 0; cs < Math.min(conflicts.subdirs.length, 8); cs++) msgLines.push('  ' + conflicts.subdirs[cs]);
          if (conflicts.subdirs.length > 8) msgLines.push('  … and ' + (conflicts.subdirs.length - 8) + ' more');
        }
      }
      msgLines.push('');
      msgLines.push('What would you like to do?');
      var cbmChoice = await showChoiceModal(
        conflicts.topLevel ? 'Directory exists' : 'Existing items',
        msgLines.join('\n'),
        [
          { label: 'Cancel', value: 'cancel', secondary: true },
          { label: 'Rename', value: 'rename' },
          { label: 'Overwrite', value: 'overwrite' },
        ]
      );
      if (cbmChoice === 'cancel' || cbmChoice == null) { abort(); return; }
      mode = cbmChoice;
    }
    var pres = cbmPasteDirTree(cbmCtx, titem.tree, { onConflict: mode });
    if (!pres.ok) { abort('Paste failed', [pres.error || 'Unknown error.']); return; }
    treeFiles += pres.copiedFiles;
    treeDirs += pres.copiedDirs;
    if (pres.skippedDirs) treeSkippedDirs = treeSkippedDirs.concat(pres.skippedDirs);
    if (pres.skippedLnks) treeSkippedLnks = treeSkippedLnks.concat(pres.skippedLnks);
  }

  var progress = flatItems.length > 0 ? showProgressModal('Pasting Files') : null;
  var pasted = 0;
  var skipped = [];
  var stoppedAt = flatItems.length;
  for (var pi = 0; pi < flatItems.length; pi++) {
    var item = flatItems[pi];
    var fileName = _clipItemName(item.nameBytes);
    await progress.update(pi, flatItems.length, fileName);

    var success;
    if (item.kind === 'cbm-del') {
      success = _pasteArtDelToCbmDos(item);
    } else if (item.typeIdx === FILE_TYPE.REL) {
      skipped.push({ name: fileName, reason: 'REL files can\'t be pasted into a CBM-DOS disk yet (side sectors aren\'t rebuilt)' });
      continue;
    } else if (item.vlirRecords) {
      success = writeVlirFileToDisk(item.typeIdx | 0x80, item.nameBytes, item.vlirRecords,
        item.geosBytes, item.geosInfoBlock, true);
    } else {
      var geosData = item.geosBytes
        ? { geosBytes: item.geosBytes, geosInfoBlock: item.geosInfoBlock }
        : null;
      success = writeFileToDisk(item.typeIdx, item.nameBytes, item.data, geosData, true);
    }
    if (success) {
      pasted++;
    } else {
      skipped.push({ name: fileName, reason: item.kind === 'cbm-del' ? 'No directory space' : 'Disk full or no directory space' });
      stoppedAt = pi;
      break;
    }
  }
  for (var ri = stoppedAt + 1; ri < flatItems.length; ri++) {
    skipped.push({ name: _clipItemName(flatItems[ri].nameBytes), reason: 'Not attempted (previous file failed)' });
  }

  var lines = [];
  if (treeItems.length > 0) {
    lines.push('Pasted ' + treeDirs + ' director' + (treeDirs === 1 ? 'y' : 'ies') +
      ' and ' + treeFiles + ' file' + (treeFiles === 1 ? '' : 's') + '.');
  }
  if (pasted > 0) lines.push(pasted + ' file(s) pasted successfully.');
  lines = lines.concat(
    _pasteListLines(treeSkippedDirs.length + ' director' + (treeSkippedDirs.length === 1 ? 'y' : 'ies') + ' not copied:', treeSkippedDirs),
    _pasteListLines(treeSkippedLnks.length + ' link(s) not copied:', treeSkippedLnks));
  if (skipped.length > 0 && lines.length > 0) lines.push('');
  for (var si2 = 0; si2 < skipped.length; si2++) {
    lines.push('Warning: ' + skipped[si2].name + ' — ' + skipped[si2].reason);
  }

  if (treeItems.length === 0 && pasted === 0) {
    abort('Paste Failed', lines.length ? lines : ['No files pasted.']);
    return;
  }
  renderDisk(parseCurrentDir(currentBuffer));
  updateMenuState();
  showModal(skipped.length === 0 ? 'Paste Complete' : 'Paste Incomplete', lines);
}

// ── File menu: Import File ────────────────────────────────────────────
var importFileInput = document.createElement('input');
importFileInput.type = 'file';
importFileInput.accept = '.prg,.seq,.usr,.rel,.p00,.s00,.u00,.r00,.cvt,.txt';
importFileInput.multiple = true;
importFileInput.style.display = 'none';
document.body.appendChild(importFileInput);

document.getElementById('opt-import').addEventListener('click', (e) => {
  e.stopPropagation();
  closeMenus();
  // CFS view: route through the CFS-aware picker. Skips the CBM-DOS
  // canInsertFile() check (which reads currentFormat shape) and the
  // GEOS .cvt handling in importFileToDisk — CFS imports are plain
  // file writes via cfsImportFile.
  if (typeof cfsPartitionIdx !== 'undefined' && cfsPartitionIdx >= 0) {
    if (typeof showCfsImportPicker === 'function') showCfsImportPicker();
    return;
  }
  if (!currentBuffer || !canInsertFile()) return;
  importFileInput.click();
});

importFileInput.addEventListener('change', async () => {
  var entries = await readPickedFiles(importFileInput.files);
  importFileInput.value = '';
  importFilesToCurrentDisk(entries);
});

// FileList → [{ name, buffer }], the shape expandArchives hands the drop
// handler, so picked and dropped files share importFilesToCurrentDisk.
async function readPickedFiles(fileList) {
  var files = Array.from(fileList || []);
  return Promise.all(files.map(async function(f) {
    return { name: f.name, buffer: await f.arrayBuffer() };
  }));
}

// Why files can't be imported into the current (non-CFS) view, or null.
// The drop path doesn't go through the menu's enable checks.
function importRefusalReason() {
  if (isTapeFormat(getCurrentCtx())) return 'Tape images are read-only.';
  if (isCmdContainerListView()) return 'Open a partition first, then import into it.';
  if (typeof hddPartitions !== 'undefined' && hddPartitions) return 'Open a partition first, then import into it.';
  if (!canInsertFile()) return 'The directory is full.';
  return null;
}

// Imports [{ name, buffer }] into the open disk, or into the current
// directory when an IDE64 CFS partition is shown. Shared by File → Import
// File and drag-and-drop. One file keeps the per-file result modal;
// several get a single summary at the end.
async function importFilesToCurrentDisk(entries) {
  if (!entries || entries.length === 0) return;
  var inCfs = typeof cfsPartitionIdx !== 'undefined' && cfsPartitionIdx >= 0;
  var cfsPart = inCfs && hddPartitions ? hddPartitions[cfsPartitionIdx] : null;
  if (inCfs ? !cfsPart : !currentBuffer) return;
  var refusal = inCfs ? null : importRefusalReason();
  if (refusal) {
    showModal('Import Error', [refusal]);
    return;
  }
  var batch = entries.length > 1;
  var imported = 0, skipped = 0, errors = [];
  for (var i = 0; i < entries.length; i++) {
    var ent = entries[i];
    var res;
    try {
      res = inCfs
        ? await importFileToCfs(ent.name, new Uint8Array(ent.buffer), cfsPart, batch)
        : await importFileToDisk(ent.name, new Uint8Array(ent.buffer), batch);
    } catch (err) {
      res = { error: err && err.message ? err.message : String(err) };
    }
    if (res && res.ok) imported++;
    else if (res && res.error) errors.push(ent.name + ': ' + res.error);
    else skipped++;
  }
  if (!batch) return;
  if (imported > 0) {
    if (inCfs) refreshIde64View();
    else renderDisk(parseCurrentDir(currentBuffer));
  }
  if (imported === 0 && errors.length === 0) return; // every name prompt cancelled
  var lines = [imported + ' of ' + entries.length + ' file(s) imported.'];
  if (skipped > 0) lines.push(skipped + ' skipped.');
  if (errors.length > 0) {
    lines.push('');
    lines.push('Failed:');
    for (var e = 0; e < errors.length; e++) lines.push('  ' + errors[e]);
  }
  showModal(errors.length > 0 ? 'Import Finished With Errors' : 'Import Complete', lines);
}

// Core write: writes file data to disk with sector chain, directory entry, BAM update, and verification.
// nameBytes = 16-byte Uint8Array of PETSCII filename (already padded with $A0)
// Returns true on success, false on failure (with rollback).
// geosData is optional: { geosBytes: Uint8Array(9), geosInfoBlock: Uint8Array(256)|null }
// silent: no modals and no undo entry (the caller owns both).
function writeFileToDisk(typeIdx, nameBytes, fileData, geosData, silent, diskCtx) {
  diskCtx = diskCtx || getCurrentCtx();
  var buffer = diskCtx.buffer;
  var snapshot = buffer.slice(0);
  var data = new Uint8Array(buffer);

  // Build true allocation map (don't trust BAM)
  var allocated = buildTrueAllocationMap(buffer, diskCtx);

  // Calculate required sectors for file data
  var dataLen = fileData.length;
  var numSectors = dataLen === 0 ? 1 : Math.ceil(dataLen / 254);
  // No extra sector needed: byte 1 = 255 correctly represents 254 data bytes

  // If GEOS info block present, need one extra sector for it
  var needsInfoBlock = geosData && geosData.geosInfoBlock;
  if (needsInfoBlock) numSectors++;

  // Allocate sectors using real drive algorithm
  var sectorList = allocateSectors(allocated, numSectors, diskCtx);
  if (sectorList.length < numSectors) {
    if (!silent) showModal('Write Error', ['Not enough free sectors. Need ' + numSectors + ', have ' + sectorList.length + '.']);
    return false;
  }

  // Reserve a directory entry before writing any data (fail early)
  // Pass allocated map so linked subdir expansion doesn't reuse file sectors
  var entryOff = findFreeDirEntry(buffer, allocated, diskCtx);
  if (entryOff < 0) {
    if (!silent) showModal('Write Error', ['No free directory entry available.']);
    return false;
  }

  // If GEOS, write the info block to the first allocated sector
  var infoSec = null;
  var dataSectorStart = 0;
  if (needsInfoBlock) {
    infoSec = sectorList[0];
    var infoOff = sectorOffset(infoSec.track, infoSec.sector, diskCtx);
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
    var soff = sectorOffset(sec.track, sec.sector, diskCtx);

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
  var dctx = getDirContext(diskCtx);
  var bamOff = dctx.bamOff;
  for (var bi = 0; bi < sectorList.length; bi++) {
    bamMarkSectorUsed(data, sectorList[bi].track, sectorList[bi].sector, bamOff, diskCtx);
  }

  // Restore in place: callers and the tab hold references to this buffer.
  function rollback() {
    new Uint8Array(buffer).set(new Uint8Array(snapshot));
  }

  // Verify the write by reading back the file data
  var verify = readFileData(buffer, entryOff, diskCtx);
  if (verify.error || verify.data.length !== fileData.length) {
    rollback();
    if (!silent) showModal('Write Error', ['Verification failed: ' + (verify.error || 'size mismatch')]);
    return false;
  }
  for (var vi = 0; vi < fileData.length; vi++) {
    if (verify.data[vi] !== fileData[vi]) {
      rollback();
      if (!silent) showModal('Write Error', ['Verification failed: data mismatch at byte ' + vi + '.']);
      return false;
    }
  }

  if (!silent) pushUndo(snapshot);
  selectedEntryIndex = entryOff;
  return true;
}

// A name longer than 16 chars gets an edit prompt with the truncated
// suggestion. Returns the name, or null when the user cancels.
async function promptShortenImportName(baseName, fullFileName) {
  if (baseName.length <= 16) return baseName;
  var picked = await showInputModal(
    'File name too long',
    baseName.substring(0, 16).toUpperCase(),
    {
      description: '"' + fullFileName + '" exceeds 16 characters.\nEdit the name as it should appear in the directory:',
      maxLen: 16,
    }
  );
  return picked == null ? null : picked;
}

// ASCII name → 16 PETSCII bytes, $A0-padded.
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

// batch: part of a multi-file import — no per-file modals or re-render;
// the caller summarises. Returns { ok }, { error } or { skipped }.
async function importFileToDisk(fileName, fileData, batch) {
  var dotIdx = fileName.lastIndexOf('.');
  var ext = dotIdx >= 0 ? fileName.substring(dotIdx + 1).toLowerCase() : '';

  // CVT import: GEOS ConVerT format
  if (ext === 'cvt') return importCvtFile(fileName, fileData, batch);

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

  var typeIdx = importTypeForExt(ext);
  if (typeIdx < 0) {
    if (!batch) showModal('Import Error', ['Unsupported file type: .' + ext]);
    return { error: 'Unsupported file type: .' + ext };
  }
  if (typeIdx === FILE_TYPE.REL) {
    var relMsg = 'REL files can\'t be imported into a CBM-DOS disk yet (side sectors aren\'t built).';
    if (!batch) showModal('Import Error', [relMsg]);
    return { error: relMsg };
  }

  // A PC64 header carries the real CBM name; only prompt without one.
  var pc64 = /^[psu]\d\d$/.test(ext) ? parsePc64Header(fileData) : null;
  var nameBytes;
  if (pc64 && pc64.nameBytes) {
    nameBytes = pc64.nameBytes;
  } else {
    var baseName = dotIdx >= 0 ? fileName.substring(0, dotIdx) : fileName;
    var chosen = await promptShortenImportName(baseName, fileName);
    if (chosen == null) return { skipped: true };
    nameBytes = asciiToNameBytes(chosen);
  }
  if (pc64) fileData = pc64.data;

  // Batch writes run silent and roll themselves back on failure, so only
  // a successful write gets an undo entry.
  var snap = batch ? currentBuffer.slice(0) : null;
  if (!writeFileToDisk(typeIdx, nameBytes, fileData, null, batch, getCurrentCtx())) {
    return { error: 'Disk or directory full.' };
  }
  if (batch) pushUndo(snap);
  else {
    var info = parseCurrentDir(currentBuffer);
    renderDisk(info);
    var numSectors = fileData.length === 0 ? 1 : Math.ceil(fileData.length / 254);
    var shownName = petsciiToReadable(readPetsciiString(nameBytes, 0, 16)).trim();
    showModal('Import Successful', ['"' + shownName + '" imported successfully.', numSectors + ' block(s) written.']);
  }
  return { ok: true };
}

// CBM file type for an import extension (.prg, .s00, ...), or -1.
function importTypeForExt(ext) {
  if (/^(prg|seq|usr|rel)$/.test(ext)) return FILE_TYPE[ext.toUpperCase()];
  if (/^[psur]\d\d$/.test(ext)) return FILE_TYPE[{ p: 'PRG', s: 'SEQ', u: 'USR', r: 'REL' }[ext[0]]];
  return -1;
}

// PC64 (.P00 etc.): "C64File\0", 16-byte PETSCII name ($00-padded), $00,
// REL record length, then the data. Returns { nameBytes ($A0-padded, null
// if the name is empty), data } or null when the header is missing.
function parsePc64Header(bytes) {
  var magic = 'C64File';
  if (!bytes || bytes.length < 26) return null;
  for (var i = 0; i < magic.length; i++) {
    if (bytes[i] !== magic.charCodeAt(i)) return null;
  }
  if (bytes[7] !== 0x00) return null;
  var nameBytes = new Uint8Array(16).fill(0xA0);
  var len = 0;
  while (len < 16 && bytes[8 + len] !== 0x00) { nameBytes[len] = bytes[8 + len]; len++; }
  return { nameBytes: len > 0 ? nameBytes : null, data: bytes.subarray(26) };
}

// ── CVT Import ─────────────────────────────────────────────────────
function showConfirmModal(title, message, opts) {
  opts = opts || {};
  var okLabel = opts.okLabel || 'OK';
  return new Promise(function(resolve) {
    document.getElementById('modal-title').textContent = title;
    var body = document.getElementById('modal-body');
    // String → single paragraph; array → paragraph per line, blank
    // strings becoming a vertical gap. Matches the multi-line layout
    // showModal uses for validator output, but kept as <div>s so links
    // / formatting remain straightforward and the dialog reads as prose.
    if (Array.isArray(message)) {
      var html = '';
      for (var i = 0; i < message.length; i++) {
        var line = message[i];
        if (line === '') html += '<div class="text-base" style="height:6px"></div>';
        else html += '<div class="text-base">' + escHtml(line) + '</div>';
      }
      body.innerHTML = html;
    } else {
      body.innerHTML = '<div class="text-base">' + escHtml(message) + '</div>';
    }
    var footer = document.querySelector('#modal-overlay .modal-footer');
    footer.innerHTML = '<button class="modal-btn-secondary" id="confirm-cancel">Cancel</button>' +
      '<button id="confirm-ok">' + escHtml(okLabel) + '</button>';
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

// batch: same contract as importFileToDisk.
async function importCvtFile(fileName, cvt, batch) {
  if (cvt.length < 762) {
    if (!batch) showModal('Import Error', ['CVT file too small.']);
    return { error: 'CVT file too small.' };
  }

  // Warn if disk will be converted to GEOS format
  if (!hasGeosSignature(currentBuffer, getCurrentCtx())) {
    var ok = await showConfirmModal('Import CVT',
      'This disk does not have a GEOS signature. Importing a CVT file will convert it to a GEOS disk. Continue?');
    if (!ok) return { skipped: true };
  }

  var snap = batch ? currentBuffer.slice(0) : null;
  var result = importCvtFileCore(cvt, /*silent*/ !!batch);
  if (result.error) {
    if (!batch) showModal('Import Error', [result.error]);
    return { error: result.error };
  }
  if (batch) pushUndo(snap);
  else {
    var info = parseCurrentDir(currentBuffer);
    renderDisk(info);
    showModal('CVT Import Successful', ['"' + result.name + '" imported successfully.']);
  }
  return { ok: true };
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
    if (writeFileToDisk(typeIdx | 0x80, nameBytes, seqData, geosData, silent, getCurrentCtx())) {
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

function writeVlirFileToDisk(typeByte, nameBytes, records, geosBytes, infoBlock, silent, diskCtx) {
  diskCtx = diskCtx || getCurrentCtx();
  var buffer = diskCtx.buffer;
  var snapshot = silent ? null : buffer.slice(0);
  var data = new Uint8Array(buffer);
  var allocated = buildTrueAllocationMap(buffer, diskCtx);

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

  var sectorList = allocateSectors(allocated, totalSectors, diskCtx);
  if (sectorList.length < totalSectors) {
    if (!silent) showModal('Write Error', ['Not enough free sectors. Need ' + totalSectors + ', have ' + sectorList.length + '.']);
    return false;
  }

  var entryOff = findFreeDirEntry(buffer, allocated, diskCtx);
  if (entryOff < 0) {
    if (!silent) showModal('Write Error', ['No free directory entry available.']);
    return false;
  }

  var secIdx = 0;

  // Write info block
  var infoSec = sectorList[secIdx++];
  var infoOff = sectorOffset(infoSec.track, infoSec.sector, diskCtx);
  for (var ib2 = 0; ib2 < 256; ib2++) data[infoOff + ib2] = infoBlock[ib2];
  data[infoOff] = 0x00; data[infoOff + 1] = 0xFF;

  // Write VLIR index sector
  var vlirSec = sectorList[secIdx++];
  var vlirOff = sectorOffset(vlirSec.track, vlirSec.sector, diskCtx);
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
      var soff = sectorOffset(sec.track, sec.sector, diskCtx);

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
  var dirCtxLocal = getDirContext(diskCtx);
  var bamOff = dirCtxLocal.bamOff;
  for (var ai = 0; ai < sectorList.length; ai++) {
    bamMarkSectorUsed(data, sectorList[ai].track, sectorList[ai].sector, bamOff, diskCtx);
  }

  // Ensure GEOS disk signature is present
  if (!hasGeosSignature(buffer, diskCtx)) {
    writeGeosSignature(buffer, diskCtx);
  }

  if (snapshot) pushUndo(snapshot);
  // Selection only makes sense for writes into the shown directory.
  if (!diskCtx.partition || diskCtx.partition === currentPartition) {
    selectedEntryIndex = entryOff;
  }
  return true;
}

// Offset of the first all-zero dir slot, extending the dir chain by one
// sector when it's full; -1 when there's no room. preAllocated: an
// allocation map whose sectors the extension must avoid (it is updated).
function findFreeDirEntry(buffer, preAllocated, diskCtx) {
  diskCtx = diskCtx || getCurrentCtx();
  var data = new Uint8Array(buffer);
  var fmt = diskCtx.format;
  var partition = diskCtx.partition;
  var dctx = getDirContext(diskCtx);
  var bamOff = dctx.bamOff;
  var t = dctx.dirTrack, s = dctx.dirSector;
  var visited = {};
  var lastOff = -1;

  while (t !== 0) {
    var key = t + ':' + s;
    if (visited[key]) break;
    visited[key] = true;
    var off = sectorOffset(t, s, diskCtx);
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

  // No empty slot — extend the chain with a sector nothing else uses.
  var dirTrk, newSector;
  var allocMap = preAllocated || buildTrueAllocationMap(buffer, diskCtx);

  if (fmt.subdirLinked && partition && partition.dnpDir) {
    // Linked subdirs: directory can span any track
    var secList = allocateSectors(allocMap, 1, diskCtx);
    if (secList.length === 0) return -1;
    dirTrk = secList[0].track;
    newSector = secList[0].sector;
  } else {
    dirTrk = dctx.dirTrackNum;
    var spt = sectorsPerTrack(dirTrk, diskCtx);
    var protectedSecs = fmt.getProtectedSectors(dirTrk);
    newSector = -1;
    for (var cs = 1; cs < spt; cs++) {
      var csKey = dirTrk + ':' + cs;
      if (visited[csKey] || allocMap[csKey]) continue;
      if (protectedSecs.indexOf(cs) !== -1) continue;
      if (!checkSectorFree(data, bamOff, dirTrk, cs, diskCtx)) continue;
      newSector = cs;
      break;
    }
    if (newSector === -1) return -1;
    allocMap[dirTrk + ':' + newSector] = true;
  }

  if (lastOff >= 0) {
    data[lastOff] = dirTrk;
    data[lastOff + 1] = newSector;
  }

  var newOff = sectorOffset(dirTrk, newSector, diskCtx);
  data[newOff] = 0x00;
  data[newOff + 1] = 0xFF;
  for (var zi = 2; zi < 256; zi++) data[newOff + zi] = 0x00;

  bamMarkSectorUsed(data, dirTrk, newSector, bamOff, diskCtx);
  if (fmt.subdirLinked && partition && partition.dnpDir) _bumpDnpParentBlocks(data, diskCtx);

  return newOff;
}

// A DNP subdir's block count in its parent entry covers header + dir
// chain (D2M-DNP.TXT, header bytes $24-$26 locate that entry), so it
// grows with every dir sector added.
function _bumpDnpParentBlocks(data, diskCtx) {
  var partition = diskCtx.partition;
  if (!partition.dnpHeaderT) return;
  var hdrOff = sectorOffset(partition.dnpHeaderT, partition.dnpHeaderS, diskCtx);
  if (hdrOff < 0) return;
  var pe = diskCtx.format.subdirParentEntry;
  var pT = data[hdrOff + pe], pS = data[hdrOff + pe + 1], pIdx = data[hdrOff + pe + 2];
  if (pT === 0) return;
  var pDirOff = sectorOffset(pT, pS, diskCtx);
  if (pDirOff < 0) return;
  var pEntry = pDirOff + pIdx * diskCtx.format.entrySize;
  var sz = (data[pEntry + 0x1E] | (data[pEntry + 0x1F] << 8)) + 1;
  data[pEntry + 0x1E] = sz & 0xFF;
  data[pEntry + 0x1F] = (sz >>> 8) & 0xFF;
}

document.getElementById('opt-lock').addEventListener('click', (e) => {
  e.stopPropagation();
  if (!currentBuffer || selectedEntryIndex < 0) return;
  closeMenus();
  // CFS view: flip the W (writeable) bit at byte $18 — that's the
  // attribute VICE / IDEDOS surface as the read-only "<" marker, so
  // it's the closest CFS analogue to CBM-DOS's lock bit.
  if (cfsPartitionIdx >= 0 && cfsDirEntries) {
    var entry = cfsDirEntries[selectedEntryIndex];
    if (!entry || entry.empty) return;
    pushUndo();
    cfsWriteDirEntryAttrByte(hddBuffer, entry.dirLba, entry.index, entry.attrByte ^ 0x10);
    refreshIde64View();
    return;
  }
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
  // CFS view: flip the Closed bit at byte $18 — same bit position as
  // CBM-DOS's closed flag, same semantic. Splatting a CFS entry clears
  // bit 0x80; unsplat sets it. Refuses on DEL entries (scratched files
  // have Closed cleared and DEL ftype together, flipping just the
  // Closed bit there would create an inconsistent state we don't want
  // to expose).
  if (cfsPartitionIdx >= 0 && cfsDirEntries) {
    var sentry = cfsDirEntries[selectedEntryIndex];
    if (!sentry || sentry.empty || sentry.ftype === CFS_FTYPE.DEL) return;
    pushUndo();
    cfsWriteDirEntryAttrByte(hddBuffer, sentry.dirLba, sentry.index, sentry.attrByte ^ 0x80);
    refreshIde64View();
    return;
  }
  pushUndo();
  const data2 = new Uint8Array(currentBuffer);
  var entries2 = selectedEntries.length > 0 ? selectedEntries : [selectedEntryIndex];
  for (var j = 0; j < entries2.length; j++) data2[entries2[j] + 2] ^= 0x80;
  const info2 = parseCurrentDir(currentBuffer);
  renderDisk(info2);
});

// Walk a CFS directory's chain and count every live entry inside it
// (recursively). Used to show "X files / Y dirs" in the Delete Directory
// confirmation so the user sees the cascade scope before committing.
function _cfsCountDirContents(buffer, firstDirLba, depth) {
  if (depth == null) depth = 0;
  if (depth > 32) return { files: 0, dirs: 0 }; // depth guard
  var entries = readCfsDirectory(buffer, firstDirLba) || [];
  var files = 0, dirs = 0;
  for (var i = 0; i < entries.length; i++) {
    var e = entries[i];
    if (!e || e.empty || e.isSelfRef) continue;
    if (e.ftype === CFS_FTYPE.DEL) continue; // already deleted OR separator, no cascade
    if (e.ftype === CFS_FTYPE.DIR) {
      dirs++;
      if (e.dataTreePtr && e.dataTreePtr.lba) {
        var sub = _cfsCountDirContents(buffer, e.dataTreePtr.addr, depth + 1);
        files += sub.files;
        dirs += sub.dirs;
      }
    } else {
      files++;
    }
  }
  return { files: files, dirs: dirs };
}

document.getElementById('opt-scratch').addEventListener('click', async (e) => {
  e.stopPropagation();
  if (!currentBuffer || selectedEntryIndex < 0) return;
  closeMenus();
  // CFS view: scratch routes through cfsDeleteFile (frees data + tree
  // sectors in the partition bitmap, marks the dir entry deleted while
  // keeping the tree pointer for recovery context).
  if (cfsPartitionIdx >= 0 && cfsDirEntries) {
    var part = hddPartitions && hddPartitions[cfsPartitionIdx];
    if (!part) return;
    // Build the multi-select target list (same convention CBM-DOS uses
    // via selectedEntries / selectedEntryIndex fallback). Filter out
    // empties, already-deleted entries, and the protected <<DELETED
    // FILES>> system entry — skipping silently in multi-select keeps
    // an accidental ctrl-click on the system row from cancelling the
    // whole batch with a modal.
    var rawIdx = selectedEntries.length > 0 ? selectedEntries : [selectedEntryIndex];
    var targets = [];
    for (var ti = 0; ti < rawIdx.length; ti++) {
      var tEnt = cfsDirEntries[rawIdx[ti]];
      if (!tEnt || tEnt.empty) continue;
      if (tEnt.ftype === CFS_FTYPE.DEL) continue;
      if (typeof _cfsEntryIsDeldirRef === 'function' && _cfsEntryIsDeldirRef(tEnt)) {
        if (rawIdx.length === 1) {
          showModal('Protected entry', ['The <<DELETED FILES>> entry is system-managed and can\'t be scratched.']);
          return;
        }
        continue;
      }
      targets.push(tEnt);
    }
    if (targets.length === 0) return;
    // Confirmation: single DIR keeps the detailed cascade preview; multi
    // shows a "X file(s) + Y dir(s)" summary; single non-DIR stays silent.
    if (targets.length === 1 && targets[0].ftype === CFS_FTYPE.DIR) {
      var sEntry = targets[0];
      var counts = (sEntry.dataTreePtr && sEntry.dataTreePtr.lba)
        ? _cfsCountDirContents(hddBuffer, sEntry.dataTreePtr.addr)
        : { files: 0, dirs: 0 };
      var contentsBits = [];
      if (counts.files) contentsBits.push(counts.files + ' file' + (counts.files === 1 ? '' : 's'));
      if (counts.dirs) contentsBits.push(counts.dirs + ' subdirector' + (counts.dirs === 1 ? 'y' : 'ies'));
      var contentsLabel = contentsBits.length ? contentsBits.join(' + ') : 'empty';
      var choice = await showChoiceModal(
        'Delete Directory',
        'Delete directory "' + petsciiToReadable(sEntry.name) + '" (' + contentsLabel + ')? It will be recoverable via Restore Directory until the data sectors are reallocated.',
        [
          { label: 'Cancel', value: false, secondary: true },
          { label: 'Delete', value: true }
        ]
      );
      if (!choice) return;
    } else if (targets.length > 1) {
      var batchFiles = 0, batchDirs = 0;
      for (var bi = 0; bi < targets.length; bi++) {
        if (targets[bi].ftype === CFS_FTYPE.DIR) batchDirs++; else batchFiles++;
      }
      var batchLabel = [];
      if (batchFiles) batchLabel.push(batchFiles + ' file' + (batchFiles === 1 ? '' : 's'));
      if (batchDirs) batchLabel.push(batchDirs + ' director' + (batchDirs === 1 ? 'y' : 'ies'));
      var batchChoice = await showChoiceModal(
        'Scratch ' + targets.length + ' entries',
        'Scratch ' + batchLabel.join(' + ') + '? Recoverable via Unscratch until the data sectors are reallocated. Directories cascade — every child gets scratched too.',
        [
          { label: 'Cancel', value: false, secondary: true },
          { label: 'Scratch', value: true }
        ]
      );
      if (!batchChoice) return;
    }
    pushUndo();
    var failures = [];
    for (var di = 0; di < targets.length; di++) {
      var res = cfsDeleteFile(hddBuffer, part.startLba, part.endLba, targets[di]);
      if (!res.ok) failures.push(petsciiToReadable(targets[di].name) + ': ' + (res.error || 'unknown'));
    }
    if (failures.length === targets.length) {
      discardUndo();
      refreshIde64View();
      showModal('Scratch failed', failures);
      return;
    }
    refreshIde64View();
    if (failures.length > 0) {
      showModal('Scratch — partial', ['Some entries could not be scratched:'].concat(failures));
    }
    return;
  }
  var data = new Uint8Array(currentBuffer);
  var ctx = getCurrentCtx();
  var bamOff = getDirContext(ctx).bamOff;
  // Same rule as the menu: closed, unlocked SEQ/PRG/USR/REL only.
  var scratchTargets = (selectedEntries.length > 0 ? selectedEntries : [selectedEntryIndex])
    .filter(function(off) {
      var tb = data[off + 2];
      return (tb & 0x80) && !(tb & 0x40) &&
        (tb & 0x07) >= FILE_TYPE.SEQ && (tb & 0x07) <= FILE_TYPE.REL;
    });
  if (scratchTargets.length === 0) return;
  pushUndo();
  for (var sti = 0; sti < scratchTargets.length; sti++) {
    var entryOff = scratchTargets[sti];
    // Like DOS: type $00 hides the entry; the T/S link stays for Unscratch.
    data[entryOff + 2] = 0x00;
    forEachFileSector(data, entryOff, function(t, s) {
      bamMarkSectorFree(data, t, s, bamOff, ctx);
    }, ctx);
  }

  var info = parseCurrentDir(currentBuffer);
  renderDisk(info);
  updateMenuState();
  updateEntryMenuState();
});

document.getElementById('opt-unscratch').addEventListener('click', async (e) => {
  e.stopPropagation();
  if (!currentBuffer || selectedEntryIndex < 0) return;
  closeMenus();
  // CFS view: route through cfsUnscratchEntry. Restores ftype from the
  // preserved typeSuffix and reclaims the (still-free) sectors. Aborts
  // cleanly if any of them have been allocated to something else.
  if (cfsPartitionIdx >= 0 && cfsDirEntries) {
    var entry = cfsDirEntries[selectedEntryIndex];
    if (!entry || entry.empty) return;
    var part = hddPartitions && hddPartitions[cfsPartitionIdx];
    if (!part) return;
    pushUndo();
    var res = cfsUnscratchEntry(hddBuffer, part.startLba, part.endLba, entry);
    if (!res.ok) {
      discardUndo();
      refreshIde64View();
      showModal('Unscratch failed', [res.error || 'Unknown error.']);
      return;
    }
    // Recursive dir restores can partially succeed (children whose data
    // sectors were reallocated stay marked DEL). Tell the user when that
    // happens so they're not confused by leftover deleted entries inside
    // an otherwise-live directory.
    if (res.childrenFailed) {
      showModal('Restore — partial success', [
        'Restored "' + petsciiToReadable(entry.name) + '"' +
          (res.childrenRestored ? ' plus ' + res.childrenRestored + ' nested entr' + (res.childrenRestored === 1 ? 'y' : 'ies') : '') + '.',
        res.childrenFailed + ' nested entr' + (res.childrenFailed === 1 ? 'y' : 'ies') +
          ' could not be restored (data sectors were reallocated). They remain marked deleted inside the directory.',
      ]);
    }
    refreshIde64View();
    return;
  }
  var data = new Uint8Array(currentBuffer);
  var targets = (selectedEntries.length > 0 ? selectedEntries : [selectedEntryIndex])
    .filter(function(off) { return !(data[off + 2] & 0x80) && data[off + 3] !== 0; });
  if (targets.length === 0) return;
  // A DOS scratch leaves type $00, so the original type is gone: ask.
  var restoreType = FILE_TYPE.PRG;
  if (targets.some(function(off) { return (data[off + 2] & 0x07) === FILE_TYPE.DEL; })) {
    restoreType = await showChoiceModal('Unscratch', 'Restore the file type as:', [
      { label: 'Cancel', value: null, secondary: true },
      { label: 'SEQ', value: FILE_TYPE.SEQ },
      { label: 'USR', value: FILE_TYPE.USR },
      { label: 'PRG', value: FILE_TYPE.PRG }
    ]);
    if (restoreType == null) return;
  }
  pushUndo();
  var restored = 0, refused = [];
  for (var ui = 0; ui < targets.length; ui++) {
    var ures = unscratchCbmEntry(currentBuffer, targets[ui], getCurrentCtx(), restoreType);
    if (ures.ok) restored++;
    else refused.push(petsciiToReadable(readPetsciiString(data, targets[ui] + 5, 16)).trim() + ': ' + ures.error);
  }
  if (restored === 0) discardUndo();

  var info = parseCurrentDir(currentBuffer);
  renderDisk(info);
  updateMenuState();
  updateEntryMenuState();
  if (refused.length > 0) {
    showModal(restored ? 'Unscratch — partial' : 'Unscratch failed', refused);
  }
});

// Restore a scratched CBM-DOS entry: set the closed bit (a $00 type byte
// becomes restoreType, default PRG), mark its sectors used and fix the
// block count. Refuses when another file has since taken any of its sectors.
function unscratchCbmEntry(buffer, entryOff, ctx, restoreType) {
  var data = new Uint8Array(buffer);
  // Owners map without scratched entries — they no longer own anything.
  var probe = buffer.slice(0);
  var probeData = new Uint8Array(probe);
  var slots = withDiskCtx(Object.assign({}, ctx, { buffer: buffer }), function() {
    return getDirSlotOffsets(buffer);
  });
  for (var si = 0; si < slots.length; si++) {
    if (!(probeData[slots[si] + 2] & 0x80)) probeData[slots[si] + 2] = 0;
  }
  var owned = buildTrueAllocationMap(probe, Object.assign({}, ctx, { buffer: probe }));
  var taken = 0;
  forEachFileSector(data, entryOff, function(t, s) { if (owned[t + ':' + s]) taken++; }, ctx);
  if (taken > 0) return { ok: false, error: taken + ' of its sectors now belong to other data.' };

  if ((data[entryOff + 2] & 0x07) === FILE_TYPE.DEL) data[entryOff + 2] = 0x80 | (restoreType || FILE_TYPE.PRG);
  else data[entryOff + 2] |= 0x80;
  var bamOff = getDirContext(ctx).bamOff;
  var sectorCount = forEachFileSector(data, entryOff, function(t, s) {
    bamMarkSectorUsed(data, t, s, bamOff, ctx);
  }, ctx);
  data[entryOff + 30] = sectorCount & 0xFF;
  data[entryOff + 31] = (sectorCount >> 8) & 0xFF;
  return { ok: true };
}

document.querySelectorAll('#opt-change-type .submenu .option').forEach(el => {
  el.addEventListener('click', (e) => {
    e.stopPropagation();
    if (!currentBuffer || selectedEntryIndex < 0) return;
    closeMenus();
    var typeIdx = parseInt(el.dataset.typeidx, 10);
    // CFS: maps the CBM type to ftype + suffix (DEL / CBM are menu-disabled).
    if (cfsPartitionIdx >= 0 && cfsDirEntries) {
      pushUndo();
      var cfsEntries = selectedEntries.length > 0 ? selectedEntries : [selectedEntryIndex];
      for (var ci = 0; ci < cfsEntries.length; ci++) {
        var entry = cfsDirEntries[cfsEntries[ci]];
        if (!entry || entry.empty) continue;
        cfsChangeFileType(hddBuffer, entry.dirLba, entry.index, typeIdx);
      }
      refreshIde64View();
      return;
    }
    changeFileType(selectedEntries.length > 0 ? selectedEntries : [selectedEntryIndex], typeIdx);
  });
});

