// ── Disk menu: Scan for Lost Files ───────────────────────────────────
document.getElementById('opt-scan-orphans').addEventListener('click', async function(e) {
  e.stopPropagation();
  closeMenus();

  // CFS branch: hunt orphan tree-node sectors (USED in bitmap, not
  // reachable from any dir entry, looks like a valid tree node) and
  // reconstruct the file content via the byte-slice decoder. Export
  // lets the user save the recovered bytes; Restore creates a fresh
  // dir entry pointing at the existing tree LBA (no sector rewrite).
  if (cfsPartitionIdx >= 0 && cfsDirEntries && hddPartitions) {
    var cfsPart = hddPartitions[cfsPartitionIdx];
    var deep = false;
    if (typeof showChoiceModal === 'function') {
      var modeChoice = await showChoiceModal(
        'Scan for Lost Files',
        'Quick = scan only sectors marked used in the bitmap. ' +
        'Deep = also scan freed sectors for recently-scratched files (more false positives).',
        [
          { label: 'Cancel', value: null, secondary: true },
          { label: 'Quick Scan', value: false },
          { label: 'Deep Scan', value: true }
        ]
      );
      if (modeChoice === null) return;
      deep = !!modeChoice;
    }
    var cfsResults = cfsScanOrphans(hddBuffer, cfsPart, { deep: deep });
    if (cfsResults.length === 0) {
      showModal('Scan for Lost Files', [
        'No lost files found in the partition.',
        deep ? 'Deep scan also examined free sectors.' : 'Try Deep Scan to also check freed sectors.',
      ]);
      return;
    }
    document.getElementById('modal-title').textContent = 'Scan for Lost Files' + (deep ? ' — Deep Scan' : '');
    var cfsBody = document.getElementById('modal-body');
    cfsBody.innerHTML = '';
    var cfsSum = document.createElement('div');
    cfsSum.textContent = 'Found ' + cfsResults.length + ' orphan tree-node sector(s)' +
      (deep ? ' (deep scan — some may be false positives).' : '.');
    cfsSum.style.marginBottom = '12px';
    cfsBody.appendChild(cfsSum);
    for (var rri = 0; rri < cfsResults.length; rri++) {
      (function(r, idx) {
        var card = document.createElement('div');
        card.className = 'modal-info-card';
        var typeStr = r.suggestedType + (r.loadAddress !== null
          ? ' ($' + r.loadAddress.toString(16).toUpperCase().padStart(4, '0') + ')' : '');
        var sourceTag = r.fromFree ? ' <span style="color:var(--text-muted);font-style:italic">(from free space)</span>' : '';
        card.innerHTML =
          '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">' +
            '<strong>#' + (idx + 1) + '</strong>' +
            '<span style="font-size:12px;color:var(--text-muted)">Tree LBA $' +
              r.treeLba.toString(16).toUpperCase() + sourceTag + '</span>' +
          '</div>' +
          '<div style="font-size:12px;margin-bottom:6px">' +
            r.dataLbas.length + ' data sector(s), ' + r.data.length + ' bytes — ' + typeStr +
          '</div>' +
          '<div style="display:flex;gap:6px"></div>';
        var btnRow = card.lastElementChild;

        var expBtn = document.createElement('button');
        expBtn.textContent = 'Export';
        expBtn.className = 'btn-small';
        expBtn.addEventListener('click', function() {
          var ext = '.' + r.suggestedType.toLowerCase();
          var blob = new Blob([r.data], { type: 'application/octet-stream' });
          downloadBlob(blob, 'cfs_recovered_' + String(idx + 1).padStart(3, '0') + ext);
        });
        btnRow.appendChild(expBtn);

        var resBtn = document.createElement('button');
        resBtn.textContent = 'Restore';
        resBtn.className = 'btn-small';
        resBtn.addEventListener('click', async function() {
          document.getElementById('modal-overlay').classList.remove('open');
          var name = await showInputModal('Filename for Recovered File', 'RECOVERED' + (idx + 1));
          if (!name) return;
          name = String(name).toUpperCase().substring(0, 16);
          // Find a free dir slot, write a new entry pointing at the
          // existing tree LBA. No new sectors allocated — the tree
          // and its data sectors are already in the bitmap.
          var slot = cfsFindEmptyDirSlot(hddBuffer, cfsDirLba);
          if (!slot) { showModal('Restore', ['No free directory slot.']); return; }
          pushUndo();
          var eo = slot.dirLba * IDE64_SECTOR_SIZE + slot.slotIndex * CFS_DIR_ENTRY_SIZE;
          var wd = new Uint8Array(hddBuffer);
          var dirNextBits = wd[eo + 0x14] & 0x30;
          for (var z = 0; z < 32; z++) wd[eo + z] = 0;
          for (var ni = 0; ni < 16; ni++) {
            wd[eo + ni] = ni < name.length ? (name.charCodeAt(ni) & 0xFF) : 0x00;
          }
          wd[eo + 0x10] = r.data.length & 0xFF;
          wd[eo + 0x11] = (r.data.length >>> 8) & 0xFF;
          wd[eo + 0x12] = (r.data.length >>> 16) & 0xFF;
          wd[eo + 0x13] = (r.data.length >>> 24) & 0xFF;
          wd[eo + 0x14] = 0x40 | dirNextBits | ((r.treeLba >>> 24) & 0x0F);
          wd[eo + 0x15] = (r.treeLba >>> 16) & 0xFF;
          wd[eo + 0x16] = (r.treeLba >>> 8) & 0xFF;
          wd[eo + 0x17] = r.treeLba & 0xFF;
          var ftype = r.suggestedType === 'REL' ? 2 : 1; // NORMAL covers PRG/SEQ/USR
          wd[eo + 0x18] = 0xF8 | (ftype & 0x07);
          var suf = r.suggestedType.length === 3 ? r.suggestedType : 'PRG';
          wd[eo + 0x19] = suf.charCodeAt(0);
          wd[eo + 0x1A] = suf.charCodeAt(1);
          wd[eo + 0x1B] = suf.charCodeAt(2);
          cfsTouchEntryMtime(hddBuffer, slot.dirLba, slot.slotIndex);
          refreshIde64View();
          showModal('File Restored', ['"' + name + '" restored at tree LBA $' + r.treeLba.toString(16).toUpperCase() + ' (' + r.dataLbas.length + ' data sector(s)).']);
        });
        btnRow.appendChild(resBtn);
        cfsBody.appendChild(card);
      })(cfsResults[rri], rri);
    }
    var cfsFooter = document.querySelector('#modal-overlay .modal-footer');
    cfsFooter.innerHTML = '<button id="modal-close">Close</button>';
    document.getElementById('modal-close').addEventListener('click', function() {
      document.getElementById('modal-overlay').classList.remove('open');
    });
    document.getElementById('modal-overlay').classList.add('open');
    return;
  }

  if (!currentBuffer) return;

  var results = scanOrphanedChains(currentBuffer, getCurrentCtx());

  if (results.length === 0) {
    showModal('Scan for Lost Files', ['No lost files found.']);
    return;
  }

  // Build modal content
  document.getElementById('modal-title').textContent = 'Scan for Lost Files';
  var body = document.getElementById('modal-body');
  body.innerHTML = '';

  var summary = document.createElement('div');
  summary.textContent = 'Found ' + results.length + ' lost file(s):';
  summary.style.marginBottom = '12px';
  body.appendChild(summary);

  var list = document.createElement('div');

  for (var ri = 0; ri < results.length; ri++) {
    (function(r, idx) {
      var card = document.createElement('div');
      card.className = 'modal-info-card';

      var typeStr = r.suggestedType;
      if (r.suggestedType === 'PRG' && r.loadAddress !== null) {
        typeStr += ' ($' + r.loadAddress.toString(16).toUpperCase().padStart(4, '0') + ')';
      }

      var integrityIcon = '';
      if (r.integrity === 'ok') integrityIcon = '<span style="color:var(--color-recover)">&#10003;</span> ';
      else if (r.integrity === 'broken') integrityIcon = '<span style="color:var(--color-warn)">&#9888;</span> ';
      else integrityIcon = '<span style="color:var(--color-error)">&#9888;</span> ';

      card.innerHTML =
        '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">' +
          '<strong>#' + (idx + 1) + '</strong>' +
          '<span style="font-size:12px;color:var(--text-muted)">' + integrityIcon + r.integrity + '</span>' +
        '</div>' +
        '<div style="font-size:12px;margin-bottom:6px">' +
          'Start: T:$' + r.startTrack.toString(16).toUpperCase().padStart(2, '0') +
          ' S:$' + r.startSector.toString(16).toUpperCase().padStart(2, '0') +
          ' &mdash; ' + r.sectors.length + ' block(s), ' + r.dataSize + ' bytes' +
          ' &mdash; ' + typeStr +
        '</div>' +
        '<div style="display:flex;gap:6px"></div>';

      var btnRow = card.lastElementChild;

      var exportBtn = document.createElement('button');
      exportBtn.textContent = 'Export';
      exportBtn.className = 'btn-small';
      exportBtn.addEventListener('click', function() {
        var ext = r.suggestedType === 'PRG' ? '.prg' : r.suggestedType === 'SEQ' ? '.seq' : '.bin';
        var blob = new Blob([r.data], { type: 'application/octet-stream' });
        downloadBlob(blob, 'recovered_' + String(idx + 1).padStart(3, '0') + ext);
      });
      btnRow.appendChild(exportBtn);

      var restoreBtn = document.createElement('button');
      restoreBtn.textContent = 'Restore';
      restoreBtn.className = 'btn-small';
      restoreBtn.addEventListener('click', async function() {
        document.getElementById('modal-overlay').classList.remove('open');
        var name = await showInputModal('Filename for Recovered File', 'RECOVERED');
        if (!name) return;
        name = name.toUpperCase().substring(0, 16);

        var typeIdx = r.suggestedType === 'PRG' ? 2 : r.suggestedType === 'SEQ' ? 1 : 3;

        pushUndo();
        // The lost chain isn't reachable from any dir yet, so tell the
        // dir-sector allocator about it explicitly.
        var allocMap = buildTrueAllocationMap(currentBuffer, getCurrentCtx());
        for (var ai = 0; ai < r.sectors.length; ai++) allocMap[r.sectors[ai].t + ':' + r.sectors[ai].s] = true;
        var entryOff = findFreeDirEntry(currentBuffer, allocMap, getCurrentCtx());
        if (entryOff < 0) {
          discardUndo();
          showModal('Restore Error', ['No free directory entry available.']);
          return;
        }

        var wd = new Uint8Array(currentBuffer);
        wd[entryOff + 2] = 0x80 | typeIdx;
        wd[entryOff + 3] = r.startTrack;
        wd[entryOff + 4] = r.startSector;
        for (var ni = 0; ni < 16; ni++) {
          if (ni < name.length) {
            var ch = name.charCodeAt(ni);
            if (ch >= 0x41 && ch <= 0x5A) wd[entryOff + 5 + ni] = ch;
            else if (ch >= 0x30 && ch <= 0x39) wd[entryOff + 5 + ni] = ch;
            else if (ch === 0x20) wd[entryOff + 5 + ni] = 0x20;
            else wd[entryOff + 5 + ni] = 0x20;
          } else {
            wd[entryOff + 5 + ni] = 0xA0;
          }
        }
        for (var ui = 21; ui < 30; ui++) wd[entryOff + ui] = 0x00;
        wd[entryOff + 30] = r.sectors.length & 0xFF;
        wd[entryOff + 31] = (r.sectors.length >> 8) & 0xFF;

        var ctx = getDirContext();
        var bamOff = ctx.bamOff;
        for (var si = 0; si < r.sectors.length; si++) {
          bamMarkSectorUsed(wd, r.sectors[si].t, r.sectors[si].s, bamOff, getCurrentCtx());
        }

        selectedEntryIndex = entryOff;
        var info = parseCurrentDir(currentBuffer);
        renderDisk(info);
        updateMenuState();
        showModal('File Restored', ['"' + name + '" restored with ' + r.sectors.length + ' block(s).']);
      });
      btnRow.appendChild(restoreBtn);

      list.appendChild(card);
    })(results[ri], ri);
  }

  body.appendChild(list);

  // Set footer to just OK
  var footer = document.querySelector('#modal-overlay .modal-footer');
  footer.innerHTML = '<button id="modal-close">OK</button>';
  document.getElementById('modal-close').addEventListener('click', function() {
    document.getElementById('modal-overlay').classList.remove('open');
  });
  document.getElementById('modal-overlay').classList.add('open');
});

document.querySelectorAll('#opt-sort .submenu .option').forEach(el => {
  el.addEventListener('click', (e) => {
    e.stopPropagation();
    closeMenus();
    var sortKey = el.dataset.sort;
    // CFS view: route to cfsSortDirectory which walks the dir chain
    // and preserves the bit-sliced dir-next bits at byte $14. The
    // system entries (self-ref + %DELETED FILES%) stay pinned.
    if (cfsPartitionIdx >= 0 && cfsDirEntries && hddPartitions) {
      var part = hddPartitions[cfsPartitionIdx];
      var deldirLba = (part && part.cfsDeletedDir && part.cfsDeletedDir.lba) ? part.cfsDeletedDir.addr : 0;
      pushUndo();
      cfsSortDirectory(hddBuffer, cfsDirLba, deldirLba, sortKey);
      refreshIde64View();
      return;
    }
    if (!currentBuffer) return;
    sortDirectory(currentBuffer, sortKey);
    const info = parseCurrentDir(currentBuffer);
    renderDisk(info);
  });
});

// ── View menu ─────────────────────────────────────────────────────────
document.getElementById('opt-charset-mode').addEventListener('click', (e) => {
  e.stopPropagation();
  closeMenus();
  var newMode = charsetMode === 'uppercase' ? 'lowercase' : 'uppercase';
  setCharsetMode(newMode);
  document.getElementById('opt-charset-mode').textContent = newMode === 'lowercase' ? 'Switch to Uppercase' : 'Switch to Lowercase';
  buildSepSubmenu();
  if (currentBuffer) {
    var info = parseCurrentDir(currentBuffer);
    renderDisk(info);
  }
  if (petsciiPicker.target) renderPicker();
});

document.getElementById('opt-show-addr').addEventListener('click', (e) => {
  e.stopPropagation();
  closeMenus();
  showAddresses = !showAddresses;
  localStorage.setItem('cbm-showAddresses', showAddresses);
  document.getElementById('check-addr').innerHTML = showAddresses ? '<i class="fa-solid fa-check"></i>' : '';
  if (currentBuffer) {
    const info = parseCurrentDir(currentBuffer);
    renderDisk(info);
  }
});

document.getElementById('opt-show-ts').addEventListener('click', (e) => {
  e.stopPropagation();
  closeMenus();
  showTrackSector = !showTrackSector;
  localStorage.setItem('cbm-showTrackSector', showTrackSector);
  document.getElementById('check-ts').innerHTML = showTrackSector ? '<i class="fa-solid fa-check"></i>' : '';
  if (currentBuffer) {
    const info = parseCurrentDir(currentBuffer);
    renderDisk(info);
  }
});

// ── Hex Coloring picker ────────────────────────────────────────────
// Each sub-option carries data-hex-coloring; click flips the active
// scheme on every open .hex-editor (no rebuild — the data-coloring
// attribute alone toggles which CSS rules match).
function refreshHexColoringChecks() {
  var ids = { none: 'check-hex-none', hexyl: 'check-hex-hexyl', rgb: 'check-hex-rgb', nybble: 'check-hex-nybble' };
  Object.keys(ids).forEach(function(k) {
    var el = document.getElementById(ids[k]);
    if (el) el.innerHTML = (hexColoring === k) ? '<i class="fa-solid fa-check"></i>' : '';
  });
}
document.querySelectorAll('#opt-hex-coloring [data-hex-coloring]').forEach(function(opt) {
  opt.addEventListener('click', function(e) {
    e.stopPropagation();
    closeMenus();
    setHexColoring(opt.getAttribute('data-hex-coloring'));
    refreshHexColoringChecks();
  });
});


// ── Disk menu: Fill Free Sectors ─────────────────────────────────────
// Overwrites every sector no chain reaches with link $00 $00 + the
// repeating pattern. Inside a D81 partition only the partition's own
// tracks are touched. Returns the sector count, or -1 when refused.
function fillFreeSectors(buffer, pattern, diskCtx) {
  var fmt = diskCtx.format;
  var partition = diskCtx.partition;
  var firstTrack = 1, lastTrack = diskCtx.tracks;
  if (partition && !partition.dnpDir) {
    var partTracks = fmt.partitionSpt ? Math.floor((partition.partSize || 0) / fmt.partitionSpt) : 0;
    if (!partition.startTrack || partTracks < 1) return -1;
    firstTrack = partition.startTrack;
    lastTrack = Math.min(diskCtx.tracks, firstTrack + partTracks - 1);
  }
  var allocated = buildTrueAllocationMap(buffer, diskCtx);
  var data = new Uint8Array(buffer);
  var filled = 0;
  for (var t = firstTrack; t <= lastTrack; t++) {
    var spt = fmt.sectorsPerTrack(t);
    for (var s = 0; s < spt; s++) {
      if (allocated[t + ':' + s]) continue;
      var off = sectorOffset(t, s, diskCtx);
      if (off < 0) continue;
      data[off] = 0x00;
      data[off + 1] = 0x00;
      var pi = 0;
      for (var b = 2; b < 256; b++) {
        data[off + b] = pattern[pi];
        pi = (pi + 1) % pattern.length;
      }
      filled++;
    }
  }
  return filled;
}

document.getElementById('opt-fill-free').addEventListener('click', function(e) {
  e.stopPropagation();
  if (!currentBuffer) return;
  closeMenus();

  document.getElementById('modal-title').textContent = 'Fill Free Sectors';
  var body = document.getElementById('modal-body');
  body.innerHTML = '';

  var hint = document.createElement('div');
  hint.className = 'text-md text-muted mb-md';
  hint.textContent = 'Enter hex bytes (00-FF). Up to 8 bytes, pattern repeats across each sector.';
  body.appendChild(hint);

  var row = document.createElement('div');
  row.className = 'flex-row-wrap gap-md mb-lg';
  body.appendChild(row);

  var preview = document.createElement('div');
  preview.className = 'text-md text-muted font-mono';
  body.appendChild(preview);

  function readAllBytes(includePending) {
    var bytes = [];
    var inputs = row.querySelectorAll('input');
    for (var i = 0; i < inputs.length; i++) {
      var v = inputs[i].value.replace(/[^0-9a-fA-F]/g, '');
      if (v.length === 2) {
        var val = parseInt(v, 16);
        if (!isNaN(val) && val >= 0 && val <= 255) bytes.push(val);
      } else if (v.length === 1 && includePending) {
        var val2 = parseInt('0' + v, 16);
        if (!isNaN(val2)) bytes.push(val2);
      }
    }
    return bytes;
  }

  var fillBtn; // declared here so refreshPreview can access it

  function refreshPreview() {
    var confirmed = readAllBytes(false);
    var withPending = readAllBytes(true);
    if (fillBtn) fillBtn.disabled = confirmed.length === 0;
    if (withPending.length === 0) { preview.textContent = ''; return; }
    preview.textContent = 'Pattern: ' + withPending.map(function(b) {
      return '$' + b.toString(16).toUpperCase().padStart(2, '0');
    }).join(' ');
  }

  function ensureEmptyInput() {
    // Make sure there's exactly one empty input at the end (if under 8 total)
    var inputs = row.querySelectorAll('input');
    var last = inputs.length > 0 ? inputs[inputs.length - 1] : null;
    var filledCount = 0;
    for (var i = 0; i < inputs.length; i++) {
      if (inputs[i].value.replace(/[^0-9a-fA-F]/g, '').length === 2) filledCount++;
    }
    if (last && last.value === '' && filledCount < 8) return; // already have one
    if (filledCount >= 8) return;
    addByteInput('', false);
  }

  function addByteInput(value, doFocus) {
    var inp = document.createElement('input');
    inp.type = 'text';
    inp.maxLength = 2;
    inp.className = 'fill-byte-input';
    inp.value = value || '';
    row.appendChild(inp);

    inp.addEventListener('keydown', function(ev) {
      if (ev.key === 'Backspace' && inp.value === '') {
        // Focus previous input, but don't remove this one yet
        var prev = inp.previousElementSibling;
        if (prev) {
          ev.preventDefault();
          ev.stopPropagation();
          prev.focus();
          var len = prev.value.length;
          prev.setSelectionRange(len, len);
          return;
        }
      }
      if (ev.key === 'Tab' && !ev.shiftKey) {
        var v = inp.value.replace(/[^0-9a-fA-F]/g, '');
        if (v.length > 0 && v.length < 2) inp.value = '0' + v.toUpperCase();
        if (inp.value.length === 2 && row.querySelectorAll('input').length < 8) {
          ev.preventDefault();
          ev.stopPropagation();
          ensureEmptyInput();
          var next = inp.nextElementSibling;
          if (next) next.focus();
          refreshPreview();
          return;
        }
      }
      if (ev.key !== 'Escape') ev.stopPropagation();
    });

    inp.addEventListener('input', function() {
      inp.value = inp.value.replace(/[^0-9a-fA-F]/g, '').substring(0, 2);
      // If this input now has <2 chars, remove any trailing empty inputs
      if (inp.value.length < 2) {
        var next = inp.nextElementSibling;
        while (next && next.value === '') {
          var toRemove = next;
          next = next.nextElementSibling;
          row.removeChild(toRemove);
        }
      }
      refreshPreview();
      if (inp.value.length === 2) {
        // Auto-advance: ensure there's a next input and focus it
        ensureEmptyInput();
        var next = inp.nextElementSibling;
        if (next) setTimeout(function() { next.focus(); }, 0);
      }
    });

    inp.addEventListener('focus', function() {
      inp.select();
    });

    inp.addEventListener('blur', function() {
      var v = inp.value.replace(/[^0-9a-fA-F]/g, '');
      if (v.length === 0) {
        // Empty input: remove it (unless it's the only one)
        if (row.querySelectorAll('input').length > 1) {
          row.removeChild(inp);
          refreshPreview();
          ensureEmptyInput();
        }
      } else if (v.length === 1) {
        // Single digit: pad with leading zero
        inp.value = '0' + v.toUpperCase();
        refreshPreview();
        ensureEmptyInput();
      }
    });

    if (doFocus) setTimeout(function() { inp.focus(); inp.select(); }, 50);
  }

  addByteInput('00', true);
  refreshPreview();

  var footer = document.querySelector('#modal-overlay .modal-footer');
  footer.innerHTML = '';

  var cancelBtn = document.createElement('button');
  cancelBtn.textContent = 'Cancel';
  cancelBtn.className = 'modal-btn-secondary';
  cancelBtn.addEventListener('click', function() {
    document.getElementById('modal-overlay').classList.remove('open');
  });
  footer.appendChild(cancelBtn);

  fillBtn = document.createElement('button');
  fillBtn.textContent = 'Fill';
  fillBtn.addEventListener('click', function() {
    document.getElementById('modal-overlay').classList.remove('open');

    var fillBytes = readAllBytes();
    if (fillBytes.length === 0) return;
    pushUndo();
    var filled = fillFreeSectors(currentBuffer, fillBytes, getCurrentCtx());
    if (filled < 0) {
      discardUndo();
      showModal('Fill Free Sectors', ['Can\'t determine this partition\'s track range; nothing was filled.']);
      return;
    }

    var info = parseCurrentDir(currentBuffer);
    renderDisk(info);
    updateMenuState();
    showModal('Fill Free Sectors', [
      filled + ' sector(s) filled with pattern: ' + fillBytes.map(function(b) { return '$' + b.toString(16).toUpperCase().padStart(2, '0'); }).join(' ')
    ]);
  });
  footer.appendChild(fillBtn);

  document.getElementById('modal-overlay').classList.add('open');
});

// ── Disk menu: Optimize Disk ─────────────────────────────────────────
document.getElementById('opt-optimize').addEventListener('click', function(e) {
  e.stopPropagation();
  if (!currentBuffer || isTapeFormat(getCurrentCtx())) return;
  closeMenus();

  var fmt = currentFormat;

  // Presets from format definition
  var presets = fmt.interleavePresets || [{ value: fmt.defaultInterleave, label: 'Default', desc: 'Default interleave for this format' }];
  var defaultPreset = fmt.interleaveDefault || 0;

  document.getElementById('modal-title').textContent = 'Optimize Disk';
  var body = document.getElementById('modal-body');
  var html =
    '<div class="text-md text-muted mb-lg">Rearrange sectors on disk to reduce loading time on real hardware.</div>' +
    '<div class="opt-presets">';
  for (var pi = 0; pi < presets.length; pi++) {
    html += '<label class="opt-preset' + (pi === defaultPreset ? ' selected' : '') + '">' +
      '<input type="radio" name="opt-preset" value="' + presets[pi].value + '"' + (pi === defaultPreset ? ' checked' : '') + '>' +
      '<span class="opt-preset-content">' +
        '<span class="opt-preset-label">' + presets[pi].label + '</span>' +
        '<span class="opt-preset-desc">' + presets[pi].desc + '</span>' +
      '</span>' +
    '</label>';
  }
  html += '<label class="opt-preset">' +
    '<input type="radio" name="opt-preset" value="custom">' +
    '<span class="opt-preset-content">' +
      '<span class="opt-preset-label">Custom</span>' +
      '<span class="opt-preset-desc">Interleave: <input type="text" id="opt-il-custom" maxlength="2" value="' + fmt.defaultInterleave.toString(16).toUpperCase() + '" class="hex-input" placeholder="' + fmt.defaultInterleave.toString(16).toUpperCase() + '"></span>' +
    '</span>' +
  '</label>';
  html += '</div>';
  html += '<div class="opt-defrag-row">' +
    '<label class="opt-check-label">' +
      '<input type="checkbox" id="opt-defrag">' +
      '<span class="opt-defrag-content">' +
        '<span class="opt-preset-label">Defragment</span>' +
        '<span class="opt-preset-desc">Move files closer together, reduces head movement between tracks</span>' +
      '</span>' +
    '</label>' +
  '</div>';
  body.innerHTML = html;

  // Wire up preset selection highlighting
  var presetLabels = body.querySelectorAll('.opt-preset');
  var customInput = document.getElementById('opt-il-custom');
  presetLabels.forEach(function(label) {
    var radio = label.querySelector('input[type="radio"]');
    radio.addEventListener('change', function() {
      presetLabels.forEach(function(l) { l.classList.remove('selected'); });
      label.classList.add('selected');
      if (radio.value === 'custom') customInput.focus();
    });
  });
  // Clicking custom input auto-selects the custom radio
  customInput.addEventListener('focus', function() {
    var customRadio = body.querySelector('input[value="custom"]');
    customRadio.checked = true;
    customRadio.dispatchEvent(new Event('change'));
  });

  var footer = document.querySelector('#modal-overlay .modal-footer');
  footer.innerHTML = '';

  var cancelBtn = document.createElement('button');
  cancelBtn.textContent = 'Cancel';
  cancelBtn.className = 'modal-btn-secondary';
  cancelBtn.addEventListener('click', function() {
    document.getElementById('modal-overlay').classList.remove('open');
  });
  footer.appendChild(cancelBtn);

  var okBtn = document.createElement('button');
  okBtn.textContent = 'Optimize';

  // Validate custom interleave and update button/input state
  function validateCustomInput() {
    var selected = body.querySelector('input[name="opt-preset"]:checked');
    if (!selected || selected.value !== 'custom') {
      customInput.classList.remove('invalid');
      okBtn.disabled = false;
      return;
    }
    var cStr = customInput.value.trim();
    if (cStr === '') {
      customInput.classList.remove('invalid');
      okBtn.disabled = false;
      return;
    }
    var val = parseInt(cStr, 16);
    var valid = !isNaN(val) && val >= 1 && val <= 20;
    customInput.classList.toggle('invalid', !valid);
    okBtn.disabled = !valid;
  }
  customInput.addEventListener('input', validateCustomInput);
  presetLabels.forEach(function(label) {
    label.querySelector('input[type="radio"]').addEventListener('change', validateCustomInput);
  });

  okBtn.addEventListener('click', function() {
    var selected = body.querySelector('input[name="opt-preset"]:checked');
    var ilVal;
    if (selected.value === 'custom') {
      var cStr = customInput.value.trim();
      if (cStr === '') {
        ilVal = fmt.defaultInterleave;
      } else {
        ilVal = parseInt(cStr, 16);
        if (isNaN(ilVal) || ilVal < 1 || ilVal > 20) return;
      }
    } else {
      ilVal = parseInt(selected.value, 10);
    }
    var defrag = document.getElementById('opt-defrag').checked;
    document.getElementById('modal-overlay').classList.remove('open');

    pushUndo();
    var result = optimizeDisk(currentBuffer, ilVal, defrag, getCurrentCtx());
    if (result.error) {
      discardUndo();
      showModal('Optimize Disk', result.log && result.log.length ? result.log : [result.error]);
      return;
    }

    // Update global interleave so new files use the same setting
    fileInterleave = ilVal;

    var info = parseCurrentDir(currentBuffer);
    renderDisk(info);
    updateMenuState();
    showModal('Optimize Disk', result.log);
  });
  footer.appendChild(okBtn);

  // Stop propagation on inputs
  body.querySelectorAll('input').forEach(function(inp) {
    inp.addEventListener('keydown', function(ev) { ev.stopPropagation(); });
  });

  document.getElementById('modal-overlay').classList.add('open');
});

// ── Disk menu: Resize DNP Image ──────────────────────────────────────
document.getElementById('opt-resize-dnp').addEventListener('click', async function(e) {
  e.stopPropagation();
  var optEl = document.getElementById('opt-resize-dnp');
  if (optEl.classList.contains('disabled')) return;
  closeMenus();

  // A CMD container slot has a fixed size: growing would truncate on
  // splice-back, shrinking would strand container space.
  if (typeof cmdcPartitionIdx !== 'undefined' && cmdcPartitionIdx >= 0) {
    showModal('Resize Image', [
      'This DNP is a fixed-size partition inside a CMD container ' +
      '(DHD / RAMLink / FD). Resizing it here would corrupt the ' +
      'container — the partition slot has a fixed allocation that ' +
      'can\'t grow.',
      '',
      'To enlarge: delete this partition and create a new bigger one, ' +
      'then paste your files into it. To use Resize Image, export the ' +
      'partition as a stand-alone .dnp first (File → Export Partition).',
    ]);
    return;
  }

  var oldTracks = currentTracks;
  var oldKB = Math.round(oldTracks * 65536 / 1024);
  var input = await showInputModal(
    'Resize DNP (current: ' + oldTracks + ' tracks, ' + oldKB + ' KB)',
    String(oldTracks)
  );
  if (input === null) return;
  var newTracks = parseInt(input, 10);
  if (isNaN(newTracks) || newTracks < 2 || newTracks > 255) {
    showModal('Resize', ['Track count must be between 2 and 255.']);
    return;
  }
  if (newTracks === oldTracks) return;

  // Work on a scratch buffer so a failure leaves the real image untouched.
  var scratch = currentBuffer.slice(0);
  var attempt = resizeDnpImage(scratch, newTracks, getCurrentCtx());

  // Shrink blocked? Auto-compact and retry. optimizeDisk reads currentBuffer/
  // currentTracks indirectly via parseDisk, so point it at the scratch copy
  // for the compaction pass.
  if (attempt.error === 'blocked' && newTracks < oldTracks) {
    var savedBuf = currentBuffer;
    currentBuffer = scratch;
    try {
      optimizeDisk(scratch, currentFormat.defaultInterleave, true, getCurrentCtx());
    } finally {
      currentBuffer = savedBuf;
      currentTracks = oldTracks;
    }
    attempt = resizeDnpImage(scratch, newTracks, getCurrentCtx());
  }

  if (attempt.error === 'blocked') {
    var list = attempt.owners.slice(0, 20).map(function(o) {
      return o.owner + ' @ ' + o.track + ':' + o.sector;
    });
    if (attempt.owners.length > 20) list.push('\u2026 and ' + (attempt.owners.length - 20) + ' more');
    showModal('Cannot Shrink', [
      'After auto-compact, ' + attempt.owners.length + ' sector(s) still live on tracks ' + (newTracks + 1) + '\u2013' + oldTracks + ':',
      ''
    ].concat(list).concat([
      '',
      'Remove the offending files or choose a larger track count.'
    ]));
    return;
  }
  if (attempt.error) {
    showModal('Resize Error', [attempt.error]);
    return;
  }

  pushUndo();
  currentBuffer = attempt.buffer;
  var tab = getActiveTab();
  if (tab) tab.buffer = currentBuffer;
  var info = parseCurrentDir(currentBuffer);
  // parseDisk (inside parseCurrentDir) updates currentTracks from the new buffer size.
  if (tab) tab.tracks = currentTracks;
  renderDisk(info);
  updateMenuState();
  var newKB = Math.round(newTracks * 65536 / 1024);
  showModal('Resize', [
    'DNP image resized from ' + oldTracks + ' tracks (' + oldKB + ' KB) to ' + newTracks + ' tracks (' + newKB + ' KB).'
  ]);
});

// ── Disk menu: Export as Text ────────────────────────────────────────
document.getElementById('opt-export-txt').addEventListener('click', function(e) {
  e.stopPropagation();
  closeMenus();
  var lines = [];
  var fileBase;
  if (cfsPartitionIdx >= 0 && cfsDirEntries && hddPartitions) {
    var part = hddPartitions[cfsPartitionIdx];
    var pName = part && part.name ? petsciiToReadable(part.name).replace(/"/g, '') : '';
    lines.push('0 "' + pName + '" CFS');
    for (var ci = 0; ci < cfsDirEntries.length; ci++) {
      var ce = cfsDirEntries[ci];
      if (!ce || ce.empty) continue;
      if (ce.ftype === CFS_FTYPE.DEL && !showDeleted) continue;
      var cName = petsciiToReadable(ce.name);
      var blocks = ce.size ? Math.ceil(ce.size / 256) : 0;
      lines.push(String(blocks).padStart(5) + ' "' + cName + '"' + ' '.repeat(Math.max(0, 16 - cName.length)) + ' ' + (ce.typeSuffix || ''));
    }
    fileBase = (pName.trim() || 'partition');
  } else {
    if (!currentBuffer) return;
    var info = parseCurrentDir(currentBuffer);
    lines.push('0 "' + petsciiToReadable(info.diskName).replace(/"/g, '') + '" ' + petsciiToReadable(info.diskId));
    for (var i = 0; i < info.entries.length; i++) {
      var en = info.entries[i];
      if (en.deleted && !showDeleted) continue;
      var nameR = petsciiToReadable(en.name);
      lines.push(String(en.blocks).padStart(5) + ' "' + nameR + '"' + ' '.repeat(Math.max(0, 16 - nameR.length)) + ' ' + en.type.trim());
    }
    lines.push(info.freeBlocks + ' BLOCKS FREE.');
    fileBase = currentFileName || 'disk';
  }
  var txt = lines.join('\n') + '\n';
  downloadBlob(new Blob([txt], { type: 'text/plain' }), fileBase + '.txt');
});

// ── Disk menu: Disk Hash (CRC32 + SHA-256) ───────────────────────────
// Web Crypto has no MD5, so the "opt-md5" item shows CRC32 + SHA-256.
document.getElementById('opt-md5').addEventListener('click', async function(e) {
  e.stopPropagation();
  if (!currentBuffer) return;
  closeMenus();
  var data = new Uint8Array(currentBuffer);
  try {
    var hashBuffer = await crypto.subtle.digest('SHA-256', data);
    var hashArray = new Uint8Array(hashBuffer);
    var sha256 = Array.from(hashArray).map(function(b) { return b.toString(16).padStart(2, '0'); }).join('');
    var crcHex = crc32(data).toString(16).toUpperCase().padStart(8, '0');

    document.getElementById('modal-title').textContent = 'Disk Hash';
    var body = document.getElementById('modal-body');
    body.innerHTML =
      '<div style="font-size:13px;line-height:2">' +
        '<b>File:</b> ' + escHtml(currentFileName || 'unnamed') + '<br>' +
        '<b>Size:</b> ' + data.length + ' bytes<br>' +
        '<b>CRC32:</b> <code class="code-tag">' + crcHex + '</code><br>' +
        '<b>SHA-256:</b> <code class="code-tag" style="font-size:11px;word-break:break-all">' + sha256 + '</code>' +
      '</div>';
    var footer = document.querySelector('#modal-overlay .modal-footer');
    footer.innerHTML = '<button id="modal-close">OK</button>';
    document.getElementById('modal-close').addEventListener('click', function() {
      document.getElementById('modal-overlay').classList.remove('open');
    });
    document.getElementById('modal-overlay').classList.add('open');
  } catch(err) {
    showModal('Hash Error', ['Failed to compute hash: ' + err.message]);
  }
});

// ── Disk menu: Show as Base64 Data URI ───────────────────────────────
// Uses the save buffer, so a G64 tab exports the GCR image, not the D64.
document.getElementById('opt-base64').addEventListener('click', function(e) {
  e.stopPropagation();
  if (!currentBuffer) return;
  closeMenus();

  // Chunked: String.fromCharCode.apply overflows the stack on large spreads.
  function bufferToBase64(buf) {
    var bytes = new Uint8Array(buf);
    var chunk = 0x8000;
    var binary = '';
    for (var i = 0; i < bytes.length; i += chunk) {
      binary += String.fromCharCode.apply(null, bytes.subarray(i, Math.min(i + chunk, bytes.length)));
    }
    return btoa(binary);
  }

  var saveBuf = getSaveBuffer();
  var name = getSaveFileName() || 'disk';
  var b64 = bufferToBase64(saveBuf);
  var dataUri = 'data:application/octet-stream;base64,' + b64;
  var byteLen = (saveBuf.byteLength !== undefined) ? saveBuf.byteLength : (saveBuf.length || 0);

  document.getElementById('modal-title').textContent = 'Base64 Data URI';
  var body = document.getElementById('modal-body');
  body.innerHTML =
    '<div class="text-base mb-md">' +
      '<b>File:</b> ' + escHtml(name) + ' &mdash; ' + byteLen + ' bytes &rarr; ' +
      dataUri.length.toLocaleString() + ' chars base64' +
    '</div>' +
    '<div class="b64-actions">' +
      '<button id="b64-copy" class="modal-btn-secondary"><i class="fa-solid fa-copy"></i> Copy to clipboard</button>' +
      '<span id="b64-copy-status" class="b64-copy-status"></span>' +
    '</div>' +
    '<textarea class="b64-textarea" id="b64-textarea" readonly></textarea>';

  var ta = document.getElementById('b64-textarea');
  ta.value = dataUri;

  var copyBtn = document.getElementById('b64-copy');
  var status = document.getElementById('b64-copy-status');
  copyBtn.addEventListener('click', async function() {
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(dataUri);
      } else {
        // Fallback for older browsers / non-https origins
        ta.select();
        document.execCommand('copy');
      }
      status.textContent = '✓ copied';
      status.className = 'b64-copy-status b64-copy-ok';
      setTimeout(function() { status.textContent = ''; }, 2500);
    } catch (err) {
      status.textContent = 'copy failed — select the text below and use Ctrl+C';
      status.className = 'b64-copy-status b64-copy-err';
    }
  });

  var footer = document.querySelector('#modal-overlay .modal-footer');
  footer.innerHTML = '<button id="modal-close">OK</button>';
  document.getElementById('modal-close').addEventListener('click', function() {
    document.getElementById('modal-overlay').classList.remove('open');
  });
  document.getElementById('modal-overlay').classList.add('open');
});

// ── Disk menu: G64 Layout viewer ─────────────────────────────────────
// Shows the physical sector order each track was laid down in, captured
// by decodeG64toD64 at open time. The menu item is enabled only when the
// active tab carries a g64Layout (i.e. was opened from a .g64).
document.getElementById('opt-g64-layout').addEventListener('click', function(e) {
  e.stopPropagation();
  closeMenus();
  if (!currentG64Layout) return;

  // Half-tracks are preserved in currentG64Layout for save round-trip
  // but don't belong in the per-track D64 layout view (they carry
  // copy-protection bytes with no D64 sector mapping). Surface them
  // only as a count in the headline.
  var fullLayout = currentG64Layout;
  var layout = fullLayout.filter(function(t) { return !t.halfTrack; });
  var halfTrackCount = fullLayout.length - layout.length;
  var fmt = currentFormat || DISK_FORMATS.d64;

  // Per-track physical interleave: distance between the first two
  // sectors in the order, mod expectedSpt. Tracks with zero or one
  // recovered sector report '—' (no interleave to compute).
  function computeInterleave(t) {
    if (t.sectorOrder.length < 2 || t.expectedSpt <= 1) return null;
    var d = (t.sectorOrder[1] - t.sectorOrder[0] + t.expectedSpt) % t.expectedSpt;
    return d === 0 ? null : d;
  }

  // Verify the order is a strict arithmetic step at `interleave` —
  // standard mastered disks satisfy this for every adjacent pair, copy
  // protections often don't.
  function isUniformInterleave(t, interleave) {
    if (interleave == null) return false;
    var spt = t.expectedSpt;
    for (var i = 1; i < t.sectorOrder.length; i++) {
      var step = (t.sectorOrder[i] - t.sectorOrder[i - 1] + spt) % spt;
      if (step !== interleave) return false;
    }
    return true;
  }

  // Bucket each track into one of the legend's colour bands.
  function classifyTrack(t) {
    var found = t.sectorOrder.length;
    var spt = t.expectedSpt;
    if (spt === 0 || found === 0) {
      return { kind: 'empty', label: 'No sectors decoded', color: 'g64-tag-empty' };
    }
    var iv = computeInterleave(t);
    var arithmetic = iv != null && isUniformInterleave(t, iv);
    if (found === spt && arithmetic) {
      if (iv === 1) return { kind: 'unmastered', label: 'Sequential (interleave 1)', color: 'g64-tag-unmastered' };
      return { kind: 'standard', label: 'Standard interleave ' + iv, color: 'g64-tag-standard' };
    }
    if (found < spt && arithmetic) {
      var hidden = spt - found;
      return { kind: 'protected', label: hidden + ' sector' + (hidden === 1 ? '' : 's') + ' hidden (custom GCR)', color: 'g64-tag-protected' };
    }
    if (found === spt && !arithmetic) {
      return { kind: 'scrambled', label: 'Scrambled physical layout', color: 'g64-tag-scrambled' };
    }
    return { kind: 'irregular', label: found + '/' + spt + ' sectors, irregular order', color: 'g64-tag-scrambled' };
  }

  // Roll the per-track classes up into a disk-level headline + per-class counts.
  var byKind = { standard: 0, unmastered: 0, protected: 0, scrambled: 0, irregular: 0, empty: 0 };
  var classified = layout.map(function(t) {
    var c = classifyTrack(t);
    byKind[c.kind]++;
    return c;
  });
  var totalReadable = layout.length - byKind.empty;
  var diskHeadline;
  if (byKind.standard === totalReadable && totalReadable > 0) {
    var stdIv = computeInterleave(layout.find(function(t, i) { return classified[i].kind === 'standard'; }));
    diskHeadline = 'Mastered disk, standard interleave ' + stdIv + ' on every track';
  } else if (byKind.unmastered === totalReadable && totalReadable > 0) {
    diskHeadline = 'Sequential layout (interleave 1) — likely an unmastered dump or a homebrew disk';
  } else if (byKind.protected > 0 && byKind.scrambled === 0 && byKind.irregular === 0) {
    diskHeadline = 'Mastered disk with copy protection: ' + byKind.protected +
      ' track' + (byKind.protected === 1 ? '' : 's') + ' hide sectors behind custom GCR';
  } else if (byKind.scrambled > 0 || byKind.irregular > 0) {
    diskHeadline = 'Heavily protected disk: ' + (byKind.scrambled + byKind.irregular) +
      ' track' + (byKind.scrambled + byKind.irregular === 1 ? '' : 's') + ' use a non-standard physical layout';
  } else {
    diskHeadline = 'Mixed layout — see per-track breakdown below';
  }
  var chipsHtml = '<span class="g64-chip-row">';
  if (byKind.standard)   chipsHtml += '<span class="g64-tag g64-tag-standard">' + byKind.standard + ' standard</span>';
  if (byKind.unmastered) chipsHtml += '<span class="g64-tag g64-tag-unmastered">' + byKind.unmastered + ' interleave 1</span>';
  if (byKind.protected)  chipsHtml += '<span class="g64-tag g64-tag-protected">' + byKind.protected + ' copy-protected</span>';
  if (byKind.scrambled)  chipsHtml += '<span class="g64-tag g64-tag-scrambled">' + byKind.scrambled + ' scrambled</span>';
  if (byKind.irregular)  chipsHtml += '<span class="g64-tag g64-tag-scrambled">' + byKind.irregular + ' irregular</span>';
  if (byKind.empty)      chipsHtml += '<span class="g64-tag g64-tag-empty">' + byKind.empty + ' empty</span>';
  if (halfTrackCount)    chipsHtml += '<span class="g64-tag g64-tag-protected">' + halfTrackCount + ' half-track' + (halfTrackCount === 1 ? '' : 's') + '</span>';
  chipsHtml += '</span>';

  // Sector cell layout. We size to the widest track (track 1, 21 sectors
  // on a standard 1541) so every row aligns column-wise.
  var maxSpt = 0;
  layout.forEach(function(t) { if (t.expectedSpt > maxSpt) maxSpt = t.expectedSpt; });

  var cellW = 22, cellH = 18, gap = 2;
  var stepX = cellW + gap, stepY = cellH + gap;
  var labelW = 36;
  var canvasW = labelW + maxSpt * stepX + gap;
  var canvasH = layout.length * stepY + gap;

  var rowsHtml = '';
  layout.forEach(function(t, idx) {
    var iv = computeInterleave(t);
    var ivText = iv == null ? '—' : String(iv);
    var c = classified[idx];
    rowsHtml +=
      '<tr data-track="' + t.track + '">' +
        '<td>$' + t.track.toString(16).toUpperCase().padStart(2, '0') + '</td>' +
        '<td>' + t.sectorOrder.length + '/' + t.expectedSpt + '</td>' +
        '<td>' + ivText + '</td>' +
        '<td><span class="g64-tag ' + c.color + '">' + escHtml(c.label) + '</span></td>' +
        '<td>' + t.rawTrackBytes + ' B</td>' +
      '</tr>';
  });

  var body = showViewerModal('G64 Layout',
    '<div class="text-base mb-md">' +
      '<b>' + escHtml(currentFileName || 'unnamed') + '</b> &mdash; ' + layout.length + ' tracks. ' +
      '<span class="g64-headline">' + escHtml(diskHeadline) + '</span> ' + chipsHtml +
    '</div>' +
    '<div class="g64-tabs">' +
      '<span class="g64-tab active" data-g64-view="sectors">Sectors</span>' +
      '<span class="g64-tab" data-g64-view="raw">Raw Tracks</span>' +
    '</div>' +
    '<div class="g64-view" data-g64-view="sectors">' +
      '<div class="g64-help text-base mb-md">' +
        'Each row is one track laid out in physical order — the number in each cell is the sector that ' +
        'landed at that position. The colour bar on the right tags every track with how its layout reads:' +
        '<ul class="g64-legend">' +
          '<li><span class="g64-tag g64-tag-standard">standard</span> a normal arithmetic interleave like the 1541 ROM produces</li>' +
          '<li><span class="g64-tag g64-tag-unmastered">interleave 1</span> sectors in their natural order — typical for unmastered dumps and homebrew</li>' +
          '<li><span class="g64-tag g64-tag-protected">copy-protected</span> the order is still arithmetic but some sectors don’t decode (custom GCR hides them from the standard reader)</li>' +
          '<li><span class="g64-tag g64-tag-scrambled">scrambled</span> the order isn’t arithmetic at all — the loader trampolines through a custom physical layout</li>' +
        '</ul>' +
        'Cell colours:' +
        '<ul class="g64-legend">' +
          '<li><span class="g64-tag g64-tag-unmastered">off order</span> sector sits where the track’s interleave doesn’t put it</li>' +
          '<li><span class="g64-tag g64-tag-protected">bad checksum</span> header found, data block fails its checksum (error 23, usually copy protection)</li>' +
          '<li><span class="g64-tag g64-tag-missing">not found</span> no header for this sector on the track</li>' +
        '</ul>' +
      '</div>' +
      '<div class="g64-layout-wrap">' +
        '<canvas id="g64-layout-canvas" width="' + canvasW + '" height="' + canvasH +
          '" style="display:block;cursor:default"></canvas>' +
      '</div>' +
      '<div class="g64-track-detail" id="g64-track-detail">' +
        '<div class="text-muted text-base">Click a track row in the table or the canvas for its full sector sequence.</div>' +
      '</div>' +
      '<table class="g64-track-table">' +
        '<thead><tr><th>Track</th><th>Sectors</th><th>Interleave</th><th>Layout</th><th>Raw bytes</th></tr></thead>' +
        '<tbody>' + rowsHtml + '</tbody>' +
      '</table>' +
    '</div>' +
    '<div class="g64-view" data-g64-view="raw" style="display:none">' +
      '<div class="g64-help text-base mb-md">' +
        'The disk laid out as concentric tracks. Track 1 is the outer ring (where the head starts), track ' +
        layout.length + ' is the inner ring. Each track plays counter-clockwise from the bottom. Color is ' +
        'the bit pattern of the raw GCR data:' +
        '<ul class="g64-legend">' +
          '<li><span class="g64-tag g64-tag-rawred">red</span> long runs of 1-bits — sync marks (each sector is preceded by two)</li>' +
          '<li><span class="g64-tag g64-tag-rawgreen">green</span> normal GCR data — header + payload of the sector; brighter green = more 1-bits in that byte</li>' +
          '<li><span class="g64-tag g64-tag-rawblue">blue</span> long runs of 0-bits — gap or padding between sectors</li>' +
          '<li><span class="g64-tag g64-tag-empty">grey</span> empty / unformatted track</li>' +
        '</ul>' +
      '</div>' +
      '<div class="g64-raw-toolbar">' +
        '<span class="color-picker-label">Zoom:</span>' +
        '<input type="range" min="1" max="5" step="0.5" value="1" id="g64-raw-zoom" class="gfx-zoom-slider">' +
        '<span class="gfx-zoom-value" id="g64-raw-zoom-value">1x</span>' +
      '</div>' +
      '<div class="g64-raw-wrap" id="g64-raw-wrap">' +
        '<canvas id="g64-raw-canvas" width="640" height="640" class="g64-raw-canvas"></canvas>' +
      '</div>' +
    '</div>');

  var canvas = body.querySelector('#g64-layout-canvas');
  var ctx = canvas.getContext('2d');
  var cs = getComputedStyle(document.documentElement);
  var labelColor = cs.getPropertyValue('--text-muted').trim();
  var bgColor = cs.getPropertyValue('--bg').trim();
  var cellBg = cs.getPropertyValue('--bg-panel').trim();
  var cellAccent = cs.getPropertyValue('--accent').trim();
  var cellWarn = cs.getPropertyValue('--color-warn').trim();
  var cellText = cs.getPropertyValue('--text').trim();

  ctx.fillStyle = bgColor;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.font = '10px monospace';
  ctx.textBaseline = 'middle';

  layout.forEach(function(t, ti) {
    var y = ti * stepY + gap;
    ctx.fillStyle = labelColor;
    ctx.textAlign = 'left';
    ctx.fillText('$' + t.track.toString(16).toUpperCase().padStart(2, '0'), 2, y + cellH / 2);

    var iv = computeInterleave(t);
    var uniform = isUniformInterleave(t, iv);
    var badSum = t.badChecksumSectors || [];
    for (var i = 0; i < t.sectorOrder.length; i++) {
      var sec = t.sectorOrder[i];
      var x = labelW + i * stepX + gap;
      // Highlight a cell when its position differs from the expected
      // logical position computed from the track's nominal interleave.
      var expectedSec = iv != null ? (t.sectorOrder[0] + i * iv) % t.expectedSpt : sec;
      var off = (sec !== expectedSec);
      var bad = badSum.indexOf(sec) >= 0;
      ctx.fillStyle = bad ? cellWarn : off ? cellAccent : cellBg;
      ctx.beginPath();
      ctx.roundRect(x, y, cellW, cellH, 2);
      ctx.fill();

      ctx.fillStyle = (bad || off) ? bgColor : cellText;
      ctx.textAlign = 'center';
      ctx.fillText(String(sec), x + cellW / 2, y + cellH / 2);
    }
    // Render unread sectors as muted hashed cells past the recovered run.
    for (var ui = t.sectorOrder.length; ui < t.expectedSpt; ui++) {
      var ux = labelW + ui * stepX + gap;
      ctx.fillStyle = cellWarn;
      ctx.globalAlpha = 0.25;
      ctx.beginPath();
      ctx.roundRect(ux, y, cellW, cellH, 2);
      ctx.fill();
      ctx.globalAlpha = 1.0;
    }
  });

  function showTrackDetail(track) {
    var t = null, idx = -1;
    for (var i = 0; i < layout.length; i++) {
      if (layout[i].track === track) { t = layout[i]; idx = i; break; }
    }
    var detail = body.querySelector('#g64-track-detail');
    if (!t) { detail.innerHTML = ''; return; }
    var iv = computeInterleave(t);
    var c = classified[idx];
    var badSum = t.badChecksumSectors || [];
    var missing = t.unreadableSectors.filter(function(s) { return badSum.indexOf(s) < 0; });
    var unreadHtml =
      (badSum.length === 0 ? '' : '<div class="g64-warn"><b>Bad data checksum (error 23):</b> ' + badSum.join(', ') + '</div>') +
      (missing.length === 0 ? '' : '<div class="g64-warn"><b>Unreadable sectors:</b> ' + missing.join(', ') + '</div>');
    detail.innerHTML =
      '<div class="g64-track-detail-header">' +
        '<b>Track $' + t.track.toString(16).toUpperCase().padStart(2, '0') + '</b> ' +
        '<span class="g64-tag ' + c.color + '">' + escHtml(c.label) + '</span>' +
      '</div>' +
      '<div class="g64-track-detail-meta">' +
        t.rawTrackBytes + ' raw GCR bytes, ' +
        t.sectorOrder.length + ' of ' + t.expectedSpt + ' sectors recovered, ' +
        'interleave ' + (iv == null ? '—' : iv) +
      '</div>' +
      '<div class="text-muted" style="font-size:11px;margin-bottom:4px">Physical sector order:</div>' +
      '<div class="g64-sector-sequence">' +
        t.sectorOrder.map(function(s) { return s; }).join(', ') +
      '</div>' +
      unreadHtml;
  }

  body.querySelectorAll('.g64-track-table tbody tr').forEach(function(row) {
    row.addEventListener('click', function() {
      body.querySelectorAll('.g64-track-table tbody tr').forEach(function(r) {
        r.classList.remove('selected');
      });
      row.classList.add('selected');
      showTrackDetail(parseInt(row.getAttribute('data-track'), 10));
    });
  });

  canvas.addEventListener('click', function(e) {
    var rect = canvas.getBoundingClientRect();
    var y = e.clientY - rect.top;
    var trackIdx = Math.floor((y - gap * 0.5) / stepY);
    if (trackIdx < 0 || trackIdx >= layout.length) return;
    var track = layout[trackIdx].track;
    showTrackDetail(track);
    var row = body.querySelector('.g64-track-table tbody tr[data-track="' + track + '"]');
    if (row) {
      body.querySelectorAll('.g64-track-table tbody tr').forEach(function(r) {
        r.classList.remove('selected');
      });
      row.classList.add('selected');
      row.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  });

  // Tab switching between Sectors and Raw Tracks. Raw Tracks renders
  // lazily on first show — full-canvas pixel-fill for 35-42 tracks isn't
  // cheap and there's no reason to pay for it if the user never opens it.
  var rawRendered = false;
  body.querySelectorAll('.g64-tab').forEach(function(tab) {
    tab.addEventListener('click', function() {
      body.querySelectorAll('.g64-tab').forEach(function(t) { t.classList.remove('active'); });
      tab.classList.add('active');
      var view = tab.getAttribute('data-g64-view');
      body.querySelectorAll('.g64-view').forEach(function(v) {
        v.style.display = v.getAttribute('data-g64-view') === view ? '' : 'none';
      });
      if (view === 'raw' && !rawRendered) {
        rawRendered = true;
        var rawCanvas = body.querySelector('#g64-raw-canvas');
        renderRawTracksCanvas(rawCanvas, layout);
        wireRawTracksZoomAndPan(body, rawCanvas);
      }
    });
  });
});

// Concentric rings, track 1 outermost, each running CCW from the bottom:
// sync runs red, $00 gap runs blue, GCR data green shaded by popcount
// (after Michael Steil's 1541 visual).
function renderRawTracksCanvas(canvas, layout) {
  var w = canvas.width, h = canvas.height;
  var ctx = canvas.getContext('2d');
  var img = ctx.createImageData(w, h);
  var px = img.data;

  // Slate-coloured backdrop so empty tracks (no rawGCR) read as part
  // of the diagram rather than punching through to the modal-body.
  var bgRGB = [24, 26, 36];
  for (var i = 0; i < px.length; i += 4) {
    px[i] = bgRGB[0]; px[i + 1] = bgRGB[1]; px[i + 2] = bgRGB[2]; px[i + 3] = 255;
  }

  var cx = w / 2, cy = h / 2;
  var outerR = Math.min(w, h) / 2 - 12;
  var innerR = outerR * 0.22;
  var n = layout.length;

  // Per byte: 0 = data, 1 = inside a $FF run, 2 = inside a $00 run.
  // Runs need >= 4 bytes so a lone $FF in header data isn't sync.
  function classifyTrackBytes(buf) {
    var len = buf.length;
    var cls = new Uint8Array(len);
    if (len === 0) return cls;
    // Sync runs (>= 4 consecutive 0xFF)
    var run = 0;
    for (var i = 0; i < len; i++) {
      if (buf[i] === 0xFF) run++; else {
        if (run >= 4) for (var j = i - run; j < i; j++) cls[j] = 1;
        run = 0;
      }
    }
    if (run >= 4) for (var k = len - run; k < len; k++) cls[k] = 1;
    // Zero runs
    run = 0;
    for (var ii = 0; ii < len; ii++) {
      if (buf[ii] === 0x00) run++; else {
        if (run >= 4) for (var jj = ii - run; jj < ii; jj++) cls[jj] = 2;
        run = 0;
      }
    }
    if (run >= 4) for (var kk = len - run; kk < len; kk++) cls[kk] = 2;
    return cls;
  }
  var trackClass = layout.map(function(t) { return classifyTrackBytes(t.rawGCR || new Uint8Array(0)); });

  // Shared with the legend swatches (.g64-tag-rawred / -rawblue).
  function cssVarRgb(name, fallback) {
    var v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    var m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(v);
    return m ? [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)] : fallback;
  }
  var syncRGB = cssVarRgb('--g64-raw-sync', [220, 60, 60]);
  var gapRGB = cssVarRgb('--g64-raw-gap', [60, 80, 200]);

  // popcount lookup
  var popcount = new Uint8Array(256);
  for (var b = 0; b < 256; b++) {
    var c = 0, v = b;
    while (v) { c += v & 1; v >>= 1; }
    popcount[b] = c;
  }

  for (var y = 0; y < h; y++) {
    for (var x = 0; x < w; x++) {
      var dx = x - cx, dy = y - cy;
      var dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < innerR || dist > outerR) continue;

      // Outer ring = track 1, inner ring = last track.
      var rNorm = (dist - innerR) / (outerR - innerR);
      var trackIdx = Math.floor((1 - rNorm) * n);
      if (trackIdx < 0 || trackIdx >= n) continue;

      var t = layout[trackIdx];
      var rawGCR = t && t.rawGCR;
      if (!rawGCR || rawGCR.length === 0) continue;

      // Angle: 0 = bottom, counter-clockwise.
      var ang = Math.atan2(dy, dx);            // -π..π, 0 = right
      var theta = ang + Math.PI / 2;            // 0 = bottom, CW positive
      if (theta < 0) theta += 2 * Math.PI;
      theta = (2 * Math.PI - theta) % (2 * Math.PI); // CCW

      var byteIdx = Math.floor((theta / (2 * Math.PI)) * rawGCR.length);
      if (byteIdx >= rawGCR.length) byteIdx = rawGCR.length - 1;

      var byte = rawGCR[byteIdx];
      var cls = trackClass[trackIdx][byteIdx];
      var r, g, bcol;
      if (cls === 1) {
        r = syncRGB[0]; g = syncRGB[1]; bcol = syncRGB[2];
      } else if (cls === 2) {
        r = gapRGB[0]; g = gapRGB[1]; bcol = gapRGB[2];
      } else {                    // data: green shaded by popcount
        var ones = popcount[byte];
        // popcount 0..8 → brightness 60..240 with green dominant
        r = 30 + ones * 12;
        g = 90 + ones * 18;
        bcol = 30 + ones * 8;
      }
      var off = (y * w + x) * 4;
      px[off] = r; px[off + 1] = g; px[off + 2] = bcol;
    }
  }
  ctx.putImageData(img, 0, 0);
}

// Hook the Raw Tracks zoom slider + drag-to-pan to the canvas. Mirrors
// the graphics-viewer pattern: CSS-scale the canvas inside an
// overflow:auto wrapper, with `image-rendering: pixelated` so the bit
// blocks stay crisp instead of going blurry at higher zoom.
function wireRawTracksZoomAndPan(body, canvas) {
  var slider = body.querySelector('#g64-raw-zoom');
  var label  = body.querySelector('#g64-raw-zoom-value');
  var wrap   = body.querySelector('#g64-raw-wrap');
  if (!slider || !wrap) return;

  function applyZoom(z) {
    canvas.style.width  = (canvas.width  * z) + 'px';
    canvas.style.height = (canvas.height * z) + 'px';
    label.textContent = z + 'x';
  }
  applyZoom(1);

  slider.addEventListener('input', function() {
    applyZoom(parseFloat(slider.value));
  });

  // Mouse drag-to-pan when zoomed past the wrapper bounds. Touch already
  // pans natively via overflow:auto.
  canvas.addEventListener('pointerdown', function(e) {
    if (e.pointerType !== 'mouse' || e.button !== 0) return;
    if (wrap.scrollWidth <= wrap.clientWidth && wrap.scrollHeight <= wrap.clientHeight) return;
    e.preventDefault();
    canvas.setPointerCapture(e.pointerId);
    wrap.classList.add('gfx-grabbing');
    var startX = e.clientX, startY = e.clientY;
    var startScrollX = wrap.scrollLeft, startScrollY = wrap.scrollTop;
    function onMove(ev) {
      wrap.scrollLeft = startScrollX - (ev.clientX - startX);
      wrap.scrollTop  = startScrollY - (ev.clientY - startY);
    }
    function onUp() {
      canvas.removeEventListener('pointermove',  onMove);
      canvas.removeEventListener('pointerup',    onUp);
      canvas.removeEventListener('pointercancel', onUp);
      wrap.classList.remove('gfx-grabbing');
    }
    canvas.addEventListener('pointermove',  onMove);
    canvas.addEventListener('pointerup',    onUp);
    canvas.addEventListener('pointercancel', onUp);
  });
}

// ── Disk menu: Set Interleave ────────────────────────────────────────
document.getElementById('opt-interleave').addEventListener('click', function(e) {
  e.stopPropagation();
  closeMenus();

  document.getElementById('modal-title').textContent = 'Set Interleave';
  var body = document.getElementById('modal-body');
  body.innerHTML =
    '<div class="text-md text-muted mb-lg">Sector interleave for ' + currentFormat.name + '. Resets to format default when opening a new disk.</div>' +
    '<div class="form-row">' +
      '<label class="form-label">Directory:</label>' +
      '<input type="text" id="il-dir" maxlength="2" value="' + dirInterleave.toString(16).toUpperCase() + '" class="hex-input wide">' +
    '</div>' +
    '<div class="form-row">' +
      '<label class="form-label">File data:</label>' +
      '<input type="text" id="il-file" maxlength="2" value="' + fileInterleave.toString(16).toUpperCase() + '" class="hex-input wide">' +
    '</div>';

  var footer = document.querySelector('#modal-overlay .modal-footer');
  footer.innerHTML = '<button class="modal-btn-secondary" id="il-cancel">Cancel</button><button id="il-ok">OK</button>';
  document.getElementById('il-cancel').addEventListener('click', function() {
    document.getElementById('modal-overlay').classList.remove('open');
  });
  document.getElementById('il-ok').addEventListener('click', function() {
    var dStr = document.getElementById('il-dir').value.trim();
    var fStr = document.getElementById('il-file').value.trim();
    var dVal = parseInt(dStr, 16);
    var fVal = parseInt(fStr, 16);
    if (!isNaN(dVal) && dVal >= 1 && dVal <= 0x14) dirInterleave = dVal;
    if (!isNaN(fVal) && fVal >= 1 && fVal <= 0x14) fileInterleave = fVal;
    document.getElementById('modal-overlay').classList.remove('open');
  });
  // Stop propagation on inputs so keydown handlers don't interfere
  body.querySelectorAll('input').forEach(function(inp) {
    inp.addEventListener('keydown', function(ev) { ev.stopPropagation(); });
  });
  document.getElementById('modal-overlay').classList.add('open');
  document.getElementById('il-dir').focus();
});

// ── Disk menu: Add Directory (D81 partition) ─────────────────────────
document.getElementById('opt-add-partition').addEventListener('click', async function(e) {
  e.stopPropagation();
  if (!currentBuffer) return;
  closeMenus();

  // CFS view: route to the IDE64 subdir-create flow.
  if (cfsPartitionIdx >= 0 && hddBuffer && hddPartitions) {
    showCfsNewSubdirDialog();
    return;
  }

  // Linked directory: header sector + dir chain (e.g. CMD Native DIR type)
  if (currentFormat.subdirLinked) {
    var name = await showInputModal('Directory Name', 'SUBDIR');
    if (!name) return;
    name = name.toUpperCase().substring(0, 16);

    pushUndo();
    var dnpRes = _cbmCreateDnpSubdir(getCurrentCtx(), name);
    if (!dnpRes.ok) {
      discardUndo();
      showModal('Add Directory Error', [dnpRes.error + '.']);
      return;
    }
    var info = parseCurrentDir(currentBuffer);
    renderDisk(info);
    updateMenuState();
    return;
  }

  if (!currentFormat.supportsSubdirs || currentPartition) return;

  var name = await showInputModal('Directory Name', 'SUBDIR');
  if (!name) return;
  name = name.toUpperCase().substring(0, 16);

  // D81.TXT 433-435: total size, min 120 sectors, multiple of 40.
  var pSpt = currentFormat.partitionSpt;
  var sizeStr = await showInputModal('Partition size in sectors (min 120, multiples of 40)', '120');
  if (!sizeStr) return;
  var requestedSectors = parseInt(sizeStr, 10);
  if (isNaN(requestedSectors) || requestedSectors < 120) {
    showModal('Add Directory Error', ['Minimum is 120 sectors (3 tracks).']);
    return;
  }
  var partSectors = Math.ceil(requestedSectors / pSpt) * pSpt;
  var numTracks = partSectors / pSpt;

  if (!canInsertFile()) {
    showModal('Add Directory Error', ['No free directory entry available.']);
    return;
  }

  pushUndo();
  var partRes = _cbmCreateD81Partition(getCurrentCtx(), name, partSectors);
  if (!partRes.ok) {
    discardUndo();
    var errMsg = /contiguous/.test(partRes.error)
      ? 'Not enough contiguous free space. Need ' + numTracks + ' tracks (' + partSectors + ' sectors).'
      : partRes.error.charAt(0).toUpperCase() + partRes.error.slice(1) + '.';
    showModal('Add Directory Error', [errMsg]);
    return;
  }
  var startTrack = partRes.partition.startTrack;

  var info = parseDisk(currentBuffer);
  var newData = new Uint8Array(currentBuffer);
  for (var ei = 0; ei < info.entries.length; ei++) {
    var eo = info.entries[ei].entryOff;
    if ((newData[eo + 2] & 0x07) === currentFormat.subdirType && newData[eo + 3] === startTrack) {
      selectedEntryIndex = eo;
      break;
    }
  }
  renderDisk(info);
  updateMenuState();
  showModal('Directory Created', [
    'Directory "' + name + '" created.',
    numTracks + ' tracks (' + startTrack + '-' + (startTrack + numTracks - 1) + '), ' + partSectors + ' sectors total (' + (partSectors - 4) + ' free for data).',
    'Double-click to enter the directory.'
  ]);
});

