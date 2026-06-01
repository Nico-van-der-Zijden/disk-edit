// ── File menu: Export File ─────────────────────────────────────────────
document.getElementById('opt-export').addEventListener('click', (e) => {
  e.stopPropagation();
  if (!currentBuffer || selectedEntryIndex < 0) return;
  closeMenus();
  // CFS view: read via the B-tree walker, name + extension from the
  // entry's typeSuffix. The CFS dir layout doesn't match CBM-DOS's
  // entryOff + 2 / + 5 conventions, so the CBM-DOS loop below would
  // misread the byte offsets. Handles multi-select — every browser will
  // show a "site is downloading multiple files" prompt after the first.
  if (cfsPartitionIdx >= 0 && cfsDirEntries) {
    var rawIdx = selectedEntries.length > 0 ? selectedEntries : [selectedEntryIndex];
    for (var ti = 0; ti < rawIdx.length; ti++) {
      var cEntry = cfsDirEntries[rawIdx[ti]];
      if (!cEntry || cEntry.empty || cEntry.ftype === CFS_FTYPE.DIR ||
          cEntry.ftype === CFS_FTYPE.LNK || cEntry.ftype === CFS_FTYPE.DEL) continue;
      if (!cEntry.dataTreePtr || !cEntry.dataTreePtr.lba) continue;
      var cRes = readCfsFileData(hddBuffer, cEntry.dataTreePtr.addr, cEntry.size);
      if (cRes.error || !cRes.data || cRes.data.length === 0) continue;
      var cName = petsciiToReadable(cEntry.name).trim().replace(/[<>:"/\\|?*\x00-\x1F]/g, '_');
      if (!cName) cName = 'export';
      var cExt = (cEntry.typeSuffix || 'PRG').toLowerCase();
      var cBlob = new Blob([cRes.data], { type: 'application/octet-stream' });
      var cAnchor = document.createElement('a');
      cAnchor.href = URL.createObjectURL(cBlob);
      cAnchor.download = cName + '.' + cExt;
      cAnchor.click();
      URL.revokeObjectURL(cAnchor.href);
    }
    return;
  }
  var entries = selectedEntries.length > 0 ? selectedEntries : [selectedEntryIndex];
  var data = new Uint8Array(currentBuffer);
  var extMap = { 1: '.seq', 2: '.prg', 3: '.usr', 4: '.rel' };

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
      if (typeIdx < 1 || typeIdx > 4) continue;
      // GEOS VLIR: dir T/S is the index sector, not file data — use Export CVT
      if (isVlirFile(data, entOff)) continue;
      ext = extMap[typeIdx];
      name = petsciiToReadable(readPetsciiString(data, entOff + 5, 16)).trim();
    }

    var result = readFileData(currentBuffer, entOff, getCurrentCtx());
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
  // Payload path. Snapshot the existing dir slot offsets so we can find
  // the entry writeFileToDisk just added (it doesn't return an offset).
  var beforeSlots = getDirSlotOffsets(currentBuffer);
  var snap = new Uint8Array(currentBuffer);
  var beforeFingerprints = {};
  for (var bsi = 0; bsi < beforeSlots.length; bsi++) {
    var bo = beforeSlots[bsi];
    beforeFingerprints[bo] = snap[bo + 2];
  }
  if (!writeFileToDisk(0, item.nameBytes, item.payload, null, true, getCurrentCtx())) return false;
  var afterSlots = getDirSlotOffsets(currentBuffer);
  var nowData = new Uint8Array(currentBuffer);
  for (var asi = 0; asi < afterSlots.length; asi++) {
    var ao = afterSlots[asi];
    // Newly written entry: either a slot that didn't exist before, or
    // a slot whose type byte just flipped from 0 (empty) to non-zero.
    var wasFingerprint = beforeFingerprints[ao];
    if (wasFingerprint !== undefined && wasFingerprint !== 0) continue;
    if (nowData[ao + 2] === 0) continue;
    // Confirm by nameBytes match — guards against picking up an
    // unrelated concurrent write.
    var match = true;
    for (var nm = 0; nm < 16; nm++) {
      if (nowData[ao + 5 + nm] !== item.nameBytes[nm]) { match = false; break; }
    }
    if (!match) continue;
    nowData[ao + 2] = item.typeByte;   // restore Lock bit; writeFileToDisk only set 0x80|typeIdx
    nowData[ao + 30] = item.blockCount & 0xFF;
    nowData[ao + 31] = (item.blockCount >> 8) & 0xFF;
    for (var gb = 0; gb < 9; gb++) nowData[ao + 21 + gb] = item.geosBytes[gb];
    return true;
  }
  // Fallback — entry was written but we couldn't locate it to patch.
  // Disk is still consistent (just block count derived from chain length
  // and lock bit cleared), so report success.
  return true;
}


// ── File menu: Copy / Paste ──────────────────────────────────────────
document.getElementById('opt-copy').addEventListener('click', async (e) => {
  e.stopPropagation();
  if (!currentBuffer || selectedEntryIndex < 0) return;
  closeMenus();
  // CFS view: read each selected file via the B-tree walker, stash a
  // clipboard entry shaped like the CBM-DOS entries below (typeIdx +
  // 16-byte name + payload), plus a `cfsTypeSuffix` so pasting back
  // into CFS preserves the original label. CFS files have no GEOS
  // metadata to carry along; geosBytes are zeroed and infoBlock stays
  // null. DIR / LNK / DEL entries are skipped — they have no file
  // payload to copy.
  if (cfsPartitionIdx >= 0 && cfsDirEntries) {
    var rawIdx = selectedEntries.length > 0 ? selectedEntries : [selectedEntryIndex];
    clipboard = [];
    var cfsSkipped = [];
    var cfsProgress = rawIdx.length > 1 ? showProgressModal('Copying Files') : null;
    var cfsSuffixToTypeIdx = { SEQ: 1, PRG: 2, USR: 3, REL: 4 };
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
        var dirSrcOff = ce.dirLba * 512 + ce.index * 32;
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
        var sepSrcOff = ce.dirLba * 512 + ce.index * 32;
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
      var srcOff = ce.dirLba * 512 + ce.index * 32;
      for (var nbi = 0; nbi < 16; nbi++) nameBytes[nbi] = disk[srcOff + nbi];
      // Map typeSuffix → CBM-DOS typeIdx for pasting into a D64 etc.
      // Falls back to PRG when the suffix is custom (CVT/TXT/etc).
      var sufKey = (ce.typeSuffix || 'PRG').toUpperCase();
      var typeIdxFromCfs = cfsSuffixToTypeIdx[sufKey] || 2;
      clipboard.push({
        typeIdx: typeIdxFromCfs,
        nameBytes: nameBytes,
        geosBytes: new Uint8Array(9),
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
  // CFS view: paste each clipboard entry via cfsImportFile. Works for
  // clipboard items copied from either a D64 (carries CBM typeIdx) or
  // another CFS partition (additionally carries cfsTypeSuffix). GEOS
  // metadata is dropped — CFS has no GEOS notion. DIR/LNK clipboard
  // shapes don't exist (copy refuses on them), so the paste only ever
  // handles file-style payloads.
  if (cfsPartitionIdx >= 0 && cfsDirEntries) {
    var cPart = hddPartitions && hddPartitions[cfsPartitionIdx];
    if (!cPart) return;
    // Dir-tree clipboard: route through the recursive paste helper.
    // Accepts both 'cfs-dir-tree' (CFS source) and 'cbm-dir-tree'
    // (CBM-DOS source) — cfsPasteDirTree's cross-family translation
    // handles the type-field difference. Pre-check destination free
    // space, prompt on top-level conflict, then call cfsPasteDirTree.
    var treeItems = clipboard.filter(function(it) {
      return it.kind === 'cfs-dir-tree' || it.kind === 'cbm-dir-tree';
    });
    if (treeItems.length > 0) {
      // Pre-check: sum sectors needed across all tree items + count free.
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
      // Per-item: check top-level conflict, prompt if any, then paste.
      var treePasted = 0, treeFiles = 0, treeDirs = 0;
      var treeAllLnks = [];
      pushUndo();
      for (var pti = 0; pti < treeItems.length; pti++) {
        var titem = treeItems[pti];
        var existingTop = _cfsFindDirEntryByNameBytes(hddBuffer, cfsDirLba, titem.nameBytes);
        var mode = 'cancel';
        if (existingTop) {
          var dispName = '';
          for (var dn = 0; dn < 16; dn++) {
            var dnb = titem.nameBytes[dn];
            if (dnb === 0xA0 || dnb === 0x00) break;
            if (dnb >= 0xC1 && dnb <= 0xDA) dispName += String.fromCharCode(dnb - 0x80);
            else if (dnb >= 0x20 && dnb <= 0x7E) dispName += String.fromCharCode(dnb);
          }
          var choice = await showChoiceModal(
            'Directory exists',
            'The destination already has an entry named "' + dispName.trim() + '". What would you like to do?',
            [
              { label: 'Cancel', value: 'cancel', secondary: true },
              { label: 'Rename', value: 'rename' },
              { label: 'Overwrite', value: 'overwrite' },
            ]
          );
          if (choice === 'cancel' || choice == null) {
            if (typeof popUndo === 'function') popUndo();
            return;
          }
          mode = choice;
        } else {
          mode = 'cancel'; // no conflict — onConflict arg is unused, but paste expects a value
        }
        var pres = cfsPasteDirTree(hddBuffer, cPart.startLba, cPart.endLba, cfsDirLba, titem.tree, { onConflict: mode });
        if (!pres.ok) {
          showModal('Paste failed', [pres.error || 'Unknown error.']);
          if (typeof popUndo === 'function') popUndo();
          return;
        }
        treePasted++;
        treeFiles += pres.copiedFiles;
        treeDirs += pres.copiedDirs;
        if (pres.skippedLnks) treeAllLnks = treeAllLnks.concat(pres.skippedLnks);
        // Also include LNKs noted at copy-time but not seen during paste
        // (paste's recurse only sees them via the source tree).
        if (titem.skippedLnks) {
          for (var tlnk = 0; tlnk < titem.skippedLnks.length; tlnk++) {
            if (treeAllLnks.indexOf(titem.skippedLnks[tlnk]) < 0) treeAllLnks.push(titem.skippedLnks[tlnk]);
          }
        }
      }
      refreshIde64View();
      var summary = ['Pasted ' + treeDirs + ' director' + (treeDirs === 1 ? 'y' : 'ies') + ' and ' + treeFiles + ' file' + (treeFiles === 1 ? '' : 's') + '.'];
      if (treeAllLnks.length > 0) {
        summary.push('');
        summary.push(treeAllLnks.length + ' link(s) not copied (link targets generally don\'t resolve across .hdd images):');
        for (var sl = 0; sl < treeAllLnks.length && sl < 12; sl++) summary.push('  ' + treeAllLnks[sl]);
        if (treeAllLnks.length > 12) summary.push('  … and ' + (treeAllLnks.length - 12) + ' more');
      }
      showModal('Paste complete', summary);
      return;
    }
    // cfsImportFile auto-extends the dir chain when every existing dir
    // sector is full, so we don't pre-block here. If extension itself
    // fails (the partition is out of free sectors), the per-file result
    // surfaces the error in the partial-paste summary.
    var cfsTypeIdxToSuffix = { 1: 'SEQ', 2: 'PRG', 3: 'USR', 4: 'REL' };
    var cfsFtypeFromIdx = { 1: CFS_FTYPE.NORMAL, 2: CFS_FTYPE.NORMAL, 3: CFS_FTYPE.NORMAL, 4: CFS_FTYPE.REL };
    var cTotal = clipboard.length;
    var cProgress = cTotal > 1 ? showProgressModal('Pasting Files') : null;
    pushUndo();
    var cPasted = 0;
    var cSkipped = [];
    for (var pi2 = 0; pi2 < cTotal; pi2++) {
      var item = clipboard[pi2];
      // Closed-DEL clipboard entry (directory art) — route through the
      // existing CFS separator insert. Block count + lock bit don't
      // translate; payload, if captured on the source side, is dropped.
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
      if (!item.data || item.vlirRecords) {
        cSkipped.push((item.cfsTypeSuffix || cfsTypeIdxToSuffix[item.typeIdx] || '?') + ': cannot paste VLIR / empty');
        continue;
      }
      // Build the CFS-side name string: read bytes from clipboard (stops
      // at $A0 / $00 terminator) so reversed-PETSCII glyphs and
      // hard-space padding survive the round-trip.
      var pName = '';
      for (var ni = 0; ni < 16; ni++) {
        var nb = item.nameBytes[ni];
        if (nb === 0xA0 || nb === 0x00) break;
        pName += String.fromCharCode(nb);
      }
      if (!pName) pName = 'PASTED';
      var pSuffix = item.cfsTypeSuffix || cfsTypeIdxToSuffix[item.typeIdx] || 'PRG';
      var pFtype = cfsFtypeFromIdx[item.typeIdx] || CFS_FTYPE.NORMAL;
      if (cProgress) await cProgress.update(pi2, cTotal, pName);
      var pRes = cfsImportFile(hddBuffer, cPart.startLba, cPart.endLba, cfsDirLba, pName, item.data, {
        ftype: pFtype, typeSuffix: pSuffix,
      });
      if (pRes.ok) cPasted++;
      else cSkipped.push(pName + ' — ' + (pRes.error || 'unknown'));
    }
    if (cProgress) document.getElementById('modal-overlay').classList.remove('open');
    refreshIde64View();
    if (cSkipped.length > 0) {
      showModal('Paste — partial', [cPasted + ' file(s) pasted.'].concat(cSkipped));
    }
    return;
  }
  if (!currentBuffer || !canInsertFile()) return;

  // Check if any GEOS files in clipboard and disk is not GEOS. Tree
  // entries (kind:'cfs-dir-tree' / 'cbm-dir-tree') have no top-level
  // geosInfoBlock field; the per-file GEOS data inside the tree is
  // handled by cbmPasteDirTree per-file. Exclude tree kinds and use a
  // loose != so undefined doesn't trigger the prompt.
  var hasGeos = clipboard.some(function(c) {
    return c.kind !== 'cfs-dir-tree' && c.kind !== 'cbm-dir-tree' && c.geosInfoBlock != null;
  });
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
    if (choice === 'cancel') return;
    if (choice === 'convert') {
      writeGeosSignature(currentBuffer, getCurrentCtx());
      updateMenuState();
    }
  }

  var total = clipboard.length;

  // Tree clipboard items route through cbmPasteDirTree. Symmetric with
  // the CFS branch above — accepts both 'cfs-dir-tree' (CFS source)
  // and 'cbm-dir-tree' (CBM-DOS source); cbmPasteDirTree's cross-family
  // type translation handles the field-shape difference. Trees are
  // processed BEFORE the regular file-paste loop so the loop only ever
  // sees flat file entries.
  var cbmTreeItems = clipboard.filter(function(it) {
    return it.kind === 'cfs-dir-tree' || it.kind === 'cbm-dir-tree';
  });
  if (cbmTreeItems.length > 0) {
    // Pre-check: sum sectors needed across all tree items + count free.
    var cbmPreCtx = getCurrentCtx();
    var cbmNeeded = 0;
    for (var cni = 0; cni < cbmTreeItems.length; cni++) {
      cbmNeeded += cbmEstimateTreeSectors(cbmTreeItems[cni].tree, cbmPreCtx.format);
    }
    var cbmFree = cbmCountFreeSectors(cbmPreCtx);
    if (cbmNeeded > cbmFree) {
      var shortfall = cbmNeeded - cbmFree;
      // If we're inside a D81 sub-partition, see whether growing it into
      // adjacent free root tracks could close the gap, and ask the user
      // before mutating anything.
      var canGrow = (cbmPreCtx.partition && cbmPreCtx.partition.startTrack &&
                     cbmPreCtx.format.supportsSubdirs && !cbmPreCtx.format.subdirLinked);
      var growPreview = null;
      if (canGrow) {
        var preview = _cbmGrowD81Partition(cbmPreCtx, shortfall, { dryRun: true });
        if (preview.ok) growPreview = preview;
      }

      if (growPreview && growPreview.addedSectors >= shortfall) {
        // Grow can close the gap. Offer it as a choice.
        var grow = await showChoiceModal(
          'Directory full',
          'Need ' + shortfall + ' more block(s) (' + cbmNeeded + ' needed, ' + cbmFree + ' free).\n' +
          'Grow this directory by ' + growPreview.addedTracks + ' track(s) (' +
            growPreview.addedSectors + ' blocks) into adjacent free space?',
          [
            { label: 'Cancel', value: false, secondary: true },
            { label: 'Grow', value: true },
          ]
        );
        if (!grow) return;
        var grown = _cbmGrowD81Partition(cbmPreCtx, shortfall);
        if (!grown.ok) {
          showModal('Grow failed', [grown.error || 'Could not grow the directory.']);
          return;
        }
        cbmPreCtx.partition.partSize = grown.newPartSize;
        if (typeof currentPartition !== 'undefined' && currentPartition) {
          currentPartition.partSize = grown.newPartSize;
        }
        cbmFree = cbmCountFreeSectors(cbmPreCtx);
      } else if (growPreview) {
        // Grow possible but not enough. Tell the user the partial figure.
        showModal('Directory full', [
          'Need ' + shortfall + ' more block(s) (' + cbmNeeded + ' needed, ' + cbmFree + ' free).',
          'This directory can only be grown by ' + growPreview.addedSectors +
            ' block(s) — still ' + (shortfall - growPreview.addedSectors) + ' block(s) short.',
          'Free up space or paste into a different directory.',
        ]);
        return;
      } else {
        // No growth possible (root dir, no adjacent free tracks, or BAM cap hit).
        showModal('Directory full', [
          'Need ' + shortfall + ' more block(s) (' + cbmNeeded + ' needed, ' + cbmFree + ' free).',
          'Free up space or paste into a different directory.',
        ]);
        return;
      }
    }
    pushUndo();
    var cbmTreePasted = 0, cbmTreeFiles = 0, cbmTreeDirs = 0;
    var cbmTreeSkippedDirs = [];
    var cbmTreeSkippedLnks = [];
    for (var ctI = 0; ctI < cbmTreeItems.length; ctI++) {
      var titem = cbmTreeItems[ctI];
      // Compute display name from the tree's top-level nameBytes.
      var dispName = '';
      if (titem.nameBytes) {
        for (var dnI = 0; dnI < 16; dnI++) {
          var dnB = titem.nameBytes[dnI];
          if (dnB === 0xA0 || dnB === 0x00) break;
          if (dnB >= 0xC1 && dnB <= 0xDA) dispName += String.fromCharCode(dnB - 0x80);
          else if (dnB >= 0x20 && dnB <= 0x7E) dispName += String.fromCharCode(dnB);
        }
      }
      // Conflict pre-scan: covers both top-level wrap (D81 root partition
      // collision) AND immediate child file / subdir collisions when the
      // tree pastes flat into the current dir (e.g. inside an existing
      // D81 sub-partition). One prompt for any of the above.
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
        if (cbmChoice === 'cancel' || cbmChoice == null) {
          if (typeof popUndo === 'function') popUndo();
          return;
        }
        mode = cbmChoice;
      }
      var pres = cbmPasteDirTree(cbmCtx, titem.tree, { onConflict: mode });
      if (!pres.ok) {
        showModal('Paste failed', [pres.error || 'Unknown error.']);
        if (typeof popUndo === 'function') popUndo();
        return;
      }
      cbmTreePasted++;
      cbmTreeFiles += pres.copiedFiles;
      cbmTreeDirs += pres.copiedDirs;
      if (pres.skippedDirs) cbmTreeSkippedDirs = cbmTreeSkippedDirs.concat(pres.skippedDirs);
      if (pres.skippedLnks) cbmTreeSkippedLnks = cbmTreeSkippedLnks.concat(pres.skippedLnks);
    }
    // Re-render after tree paste
    renderDisk(parseCurrentDir(currentBuffer));
    updateMenuState();
    // If clipboard had ONLY trees, summarise + return. Otherwise the
    // remaining (file) items continue through the normal paste loop.
    var nonTreeRemaining = clipboard.length - cbmTreeItems.length;
    if (nonTreeRemaining === 0) {
      var cbmSummary = ['Pasted ' + cbmTreeDirs + ' director' + (cbmTreeDirs === 1 ? 'y' : 'ies') +
        ' and ' + cbmTreeFiles + ' file' + (cbmTreeFiles === 1 ? '' : 's') + '.'];
      if (cbmTreeSkippedDirs.length > 0) {
        cbmSummary.push('');
        cbmSummary.push(cbmTreeSkippedDirs.length + ' director' +
          (cbmTreeSkippedDirs.length === 1 ? 'y' : 'ies') + ' not copied:');
        for (var sdi = 0; sdi < cbmTreeSkippedDirs.length && sdi < 12; sdi++) cbmSummary.push('  ' + cbmTreeSkippedDirs[sdi]);
        if (cbmTreeSkippedDirs.length > 12) cbmSummary.push('  … and ' + (cbmTreeSkippedDirs.length - 12) + ' more');
      }
      if (cbmTreeSkippedLnks.length > 0) {
        cbmSummary.push('');
        cbmSummary.push(cbmTreeSkippedLnks.length + ' link(s) not copied:');
        for (var sli = 0; sli < cbmTreeSkippedLnks.length && sli < 12; sli++) cbmSummary.push('  ' + cbmTreeSkippedLnks[sli]);
        if (cbmTreeSkippedLnks.length > 12) cbmSummary.push('  … and ' + (cbmTreeSkippedLnks.length - 12) + ' more');
      }
      showModal('Paste complete', cbmSummary);
      return;
    }
  }

  var progress = showProgressModal('Pasting Files');
  var pasted = 0;
  var skipped = [];

  for (var pi = 0; pi < total; pi++) {
    var item = clipboard[pi];
    // Skip tree-kind items — they were processed above.
    if (item.kind === 'cfs-dir-tree' || item.kind === 'cbm-dir-tree') continue;
    var fileName = petsciiToReadable(readPetsciiString(item.nameBytes, 0, 16)).trim() || '?';

    await progress.update(pi, total, fileName);

    // Closed-DEL clipboard entry (directory art). Bare or payload — the
    // helper handles both, and preserves typeByte (Closed + Lock) +
    // block count from the source verbatim.
    if (item.kind === 'cbm-del') {
      if (_pasteArtDelToCbmDos(item)) pasted++;
      else { skipped.push({ name: fileName, reason: 'No directory space' }); break; }
      continue;
    }

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
      success = writeFileToDisk(item.typeIdx, item.nameBytes, item.data, geosData, getCurrentCtx());
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
function writeFileToDisk(typeIdx, nameBytes, fileData, geosData, silent, diskCtx) {
  diskCtx = diskCtx || getCurrentCtx();
  if (!silent) pushUndo();
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

  // Rollback helper: byte-restore from snapshot so we don't replace the
  // buffer object (callers may hold references). Only matters when the
  // caller passed an explicit diskCtx; the legacy fallback path reassigns
  // currentBuffer below to preserve old behavior for un-ported callers.
  function rollback() {
    new Uint8Array(buffer).set(new Uint8Array(snapshot));
    if (diskCtx.buffer === currentBuffer) currentBuffer = snapshot;
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

  selectedEntryIndex = entryOff;
  return true;
}

// Convert ASCII filename to 16-byte PETSCII name padded with $A0
// When the OS file name (extension stripped) is longer than 16 chars,
// prompt the user with the auto-truncated suggestion and let them edit
// it. Returns the chosen name string, or null if the user cancelled.
// Pass-through when the name already fits.
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

async function importFileToDisk(fileName, fileData) {
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
  // Too-long names get a Cancel / OK prompt with the auto-truncated
  // suggestion; OK is gated on length 1..16. PC64-format names are
  // re-read from the file header further down and override this.
  var chosen = await promptShortenImportName(baseName, fileName);
  if (chosen == null) return;
  baseName = chosen;
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

  if (writeFileToDisk(typeIdx, nameBytes, fileData, getCurrentCtx())) {
    var info = parseCurrentDir(currentBuffer);
    renderDisk(info);
    var numSectors = fileData.length === 0 ? 1 : Math.ceil(fileData.length / 254);
    showModal('Import Successful', ['"' + baseName.toUpperCase() + '" imported successfully.', numSectors + ' block(s) written.']);
  }
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

async function importCvtFile(fileName, cvt) {
  if (cvt.length < 762) {
    showModal('Import Error', ['CVT file too small.']);
    return;
  }

  // Warn if disk will be converted to GEOS format
  if (!hasGeosSignature(currentBuffer, getCurrentCtx())) {
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

function writeVlirFileToDisk(typeByte, nameBytes, records, geosBytes, infoBlock, silent) {
  if (!silent) pushUndo();
  var snapshot = currentBuffer.slice(0);
  var data = new Uint8Array(currentBuffer);
  var allocated = buildTrueAllocationMap(currentBuffer, getCurrentCtx());

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

  var sectorList = allocateSectors(allocated, totalSectors, getCurrentCtx());
  if (sectorList.length < totalSectors) {
    currentBuffer = snapshot;
    if (!silent) showModal('Write Error', ['Not enough free sectors. Need ' + totalSectors + ', have ' + sectorList.length + '.']);
    return false;
  }

  var entryOff = findFreeDirEntry(currentBuffer, allocated, getCurrentCtx());
  if (entryOff < 0) {
    currentBuffer = snapshot;
    if (!silent) showModal('Write Error', ['No free directory entry available.']);
    return false;
  }

  var secIdx = 0;

  // Write info block
  var infoSec = sectorList[secIdx++];
  var infoOff = sectorOffset(infoSec.track, infoSec.sector, getCurrentCtx());
  for (var ib2 = 0; ib2 < 256; ib2++) data[infoOff + ib2] = infoBlock[ib2];
  data[infoOff] = 0x00; data[infoOff + 1] = 0xFF;

  // Write VLIR index sector
  var vlirSec = sectorList[secIdx++];
  var vlirOff = sectorOffset(vlirSec.track, vlirSec.sector, getCurrentCtx());
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
      var soff = sectorOffset(sec.track, sec.sector, getCurrentCtx());

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
    bamMarkSectorUsed(data, sectorList[ai].track, sectorList[ai].sector, bamOff, getCurrentCtx());
  }

  // Ensure GEOS disk signature is present
  if (!hasGeosSignature(currentBuffer, getCurrentCtx())) {
    writeGeosSignature(currentBuffer, getCurrentCtx());
  }

  selectedEntryIndex = entryOff;
  return true;
}

// Find a free directory entry (typeByte === 0x00 with all entry bytes zeroed)
// Also allocates a new directory sector if needed (like insertFileEntry but without writing an entry)
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

  // No empty slot — allocate new directory sector
  var dirTrk, newSector;

  if (fmt.subdirLinked && partition && partition.dnpDir) {
    // Linked subdirs: directory can span any track, use allocateSectors
    var allocMap = preAllocated || buildTrueAllocationMap(buffer, diskCtx);
    var secList = allocateSectors(allocMap, 1, diskCtx);
    if (secList.length === 0) return -1;
    dirTrk = secList[0].track;
    newSector = secList[0].sector;
  } else {
    // Standard: allocate on the directory track only
    dirTrk = dctx.dirTrackNum;
    var spt = sectorsPerTrack(dirTrk, diskCtx);
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

  var newOff = sectorOffset(dirTrk, newSector, diskCtx);
  data[newOff] = 0x00;
  data[newOff + 1] = 0xFF;
  for (var zi = 2; zi < 256; zi++) data[newOff + zi] = 0x00;

  // Mark sector as used in BAM
  bamMarkSectorUsed(data, dirTrk, newSector, bamOff, diskCtx);

  return newOff;
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
      showModal('Scratch failed', failures);
      if (typeof popUndo === 'function') popUndo();
      return;
    }
    refreshIde64View();
    if (failures.length > 0) {
      showModal('Scratch — partial', ['Some entries could not be scratched:'].concat(failures));
    }
    return;
  }
  pushUndo();
  var data = new Uint8Array(currentBuffer);
  var entryOff = selectedEntryIndex;
  var fmt = currentFormat;
  var bamOff = sectorOffset(fmt.bamTrack, fmt.bamSector, getCurrentCtx());

  // Clear the closed bit (scratch the file)
  data[entryOff + 2] &= ~0x80;

  // Free all file sectors in BAM (main chain + REL + GEOS)
  forEachFileSector(data, entryOff, function(t, s) {
    bamMarkSectorFree(data, t, s, bamOff, getCurrentCtx());
  }, getCurrentCtx());

  var info = parseCurrentDir(currentBuffer);
  renderDisk(info);
  updateMenuState();
  updateEntryMenuState();
});

document.getElementById('opt-unscratch').addEventListener('click', (e) => {
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
      showModal('Unscratch failed', [res.error || 'Unknown error.']);
      if (typeof popUndo === 'function') popUndo();
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
  pushUndo();
  var data = new Uint8Array(currentBuffer);
  var entryOff = selectedEntryIndex;

  // Set file type to PRG + closed
  // Set closed bit, preserve original file type; default to PRG if type is DEL
  if ((data[entryOff + 2] & 0x07) === 0) data[entryOff + 2] = 0x82;
  else data[entryOff + 2] |= 0x80;

  // Mark all file sectors as used in BAM (main chain + REL + GEOS)
  var fmt = currentFormat;
  var bamOff = sectorOffset(fmt.bamTrack, fmt.bamSector, getCurrentCtx());
  var sectorCount = forEachFileSector(data, entryOff, function(t, s) {
    bamMarkSectorUsed(data, t, s, bamOff, getCurrentCtx());
  }, getCurrentCtx());

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
    // CFS view: dispatch to cfsChangeFileType which maps the CBM type
    // index to CFS ftype + 3-char typeSuffix. DEL (0) + CBM (5) aren't
    // valid CFS targets — the menu state disables them in CFS view.
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
    var entries = selectedEntries.length > 0 ? selectedEntries : [selectedEntryIndex];
    for (var i = 0; i < entries.length; i++) changeFileType(entries[i], typeIdx);
  });
});

