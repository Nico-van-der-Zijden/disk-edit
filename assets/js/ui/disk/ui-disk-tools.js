// ── Disk menu: Scan for Lost Files ───────────────────────────────────
document.getElementById('opt-scan-orphans').addEventListener('click', async function(e) {
  e.stopPropagation();
  if (!currentBuffer) return;
  closeMenus();

  var results = scanOrphanedChains(currentBuffer);

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
      if (r.integrity === 'ok') integrityIcon = '<span style="color:#4c4">&#10003;</span> ';
      else if (r.integrity === 'broken') integrityIcon = '<span style="color:#ca4">&#9888;</span> ';
      else integrityIcon = '<span style="color:#c44">&#9888;</span> ';

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
        var a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = 'recovered_' + String(idx + 1).padStart(3, '0') + ext;
        a.click();
        URL.revokeObjectURL(a.href);
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

        var snapshot = currentBuffer.slice(0);
        var entryOff = findFreeDirEntry(currentBuffer);
        if (entryOff < 0) {
          currentBuffer = snapshot;
          showModal('Restore Error', ['No free directory entry available.']);
          return;
        }

        var wd = new Uint8Array(currentBuffer);
        // File type: closed
        wd[entryOff + 2] = 0x80 | typeIdx;
        // First track/sector
        wd[entryOff + 3] = r.startTrack;
        wd[entryOff + 4] = r.startSector;
        // Filename
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
        // Clear unused
        for (var ui = 21; ui < 30; ui++) wd[entryOff + ui] = 0x00;
        // Block count
        wd[entryOff + 30] = r.sectors.length & 0xFF;
        wd[entryOff + 31] = (r.sectors.length >> 8) & 0xFF;

        // Mark chain sectors as allocated in BAM
        var ctx = getDirContext();
        var bamOff = ctx.bamOff;
        for (var si = 0; si < r.sectors.length; si++) {
          bamMarkSectorUsed(wd, r.sectors[si].t, r.sectors[si].s, bamOff);
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
    if (!currentBuffer) return;
    closeMenus();
    sortDirectory(currentBuffer, el.dataset.sort);
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
  if (pickerTarget) renderPicker();
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


// ── Disk menu: Fill Free Sectors ─────────────────────────────────────
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

  function updatePreview() {
    if (fillBytes.length === 0) {
      preview.textContent = '';
      return;
    }
    preview.textContent = 'Pattern: ' + fillBytes.map(function(b) {
      return '$' + b.toString(16).toUpperCase().padStart(2, '0');
    }).join(' ');
  }


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

    // Read all valid bytes from inputs (ignore empty ones)
    var fillBytes = readAllBytes();
    if (fillBytes.length === 0) return;
    pushUndo();

    // Build true allocation map (don't trust BAM)
    var allocated = buildTrueAllocationMap(currentBuffer);
    var data = new Uint8Array(currentBuffer);
    var fmt = currentFormat;
    var filled = 0;

    for (var t = 1; t <= currentTracks; t++) {
      var spt = fmt.sectorsPerTrack(t);
      for (var s = 0; s < spt; s++) {
        if (allocated[t + ':' + s]) continue;
        var off = sectorOffset(t, s);
        if (off < 0) continue;

        // Set track/sector link to 00 00 (no chain)
        data[off] = 0x00;
        data[off + 1] = 0x00;

        // Fill bytes 2-255 with the repeating pattern
        var pi = 0;
        for (var b = 2; b < 256; b++) {
          data[off + b] = fillBytes[pi];
          pi = (pi + 1) % fillBytes.length;
        }
        filled++;
      }
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
  if (!currentBuffer || isTapeFormat()) return;
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
    var result = optimizeDisk(currentBuffer, ilVal, defrag);

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
  var attempt = resizeDnpImage(scratch, newTracks);

  // Shrink blocked? Auto-compact and retry. optimizeDisk reads currentBuffer/
  // currentTracks indirectly via parseDisk, so point it at the scratch copy
  // for the compaction pass.
  if (attempt.error === 'blocked' && newTracks < oldTracks) {
    var savedBuf = currentBuffer;
    currentBuffer = scratch;
    try {
      optimizeDisk(scratch, currentFormat.defaultInterleave, true);
    } finally {
      currentBuffer = savedBuf;
      currentTracks = oldTracks;
    }
    attempt = resizeDnpImage(scratch, newTracks);
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
  if (!currentBuffer) return;
  closeMenus();
  var info = parseCurrentDir(currentBuffer);
  var lines = [];
  lines.push('0 "' + petsciiToReadable(info.diskName).replace(/"/g, '') + '" ' + petsciiToReadable(info.diskId));
  for (var i = 0; i < info.entries.length; i++) {
    var en = info.entries[i];
    if (en.deleted && !showDeleted) continue;
    var nameR = petsciiToReadable(en.name);
    lines.push(String(en.blocks).padStart(5) + ' "' + nameR + '"' + ' '.repeat(Math.max(0, 16 - nameR.length)) + ' ' + en.type.trim());
  }
  lines.push(info.freeBlocks + ' BLOCKS FREE.');
  var txt = lines.join('\n') + '\n';
  var blob = new Blob([txt], { type: 'text/plain' });
  var a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = (currentFileName || 'disk') + '.txt';
  a.click();
  URL.revokeObjectURL(a.href);
});

// ── Disk menu: MD5 Hash ──────────────────────────────────────────────
document.getElementById('opt-md5').addEventListener('click', async function(e) {
  e.stopPropagation();
  if (!currentBuffer) return;
  closeMenus();
  // Use Web Crypto API for SHA-256 (MD5 not available, but SHA-256 is better)
  // Also compute a simple checksum for quick comparison
  var data = new Uint8Array(currentBuffer);
  try {
    var hashBuffer = await crypto.subtle.digest('SHA-256', data);
    var hashArray = new Uint8Array(hashBuffer);
    var sha256 = Array.from(hashArray).map(function(b) { return b.toString(16).padStart(2, '0'); }).join('');
    // Simple MD5-like CRC32 for quick checks
    var crc = 0xFFFFFFFF;
    for (var i = 0; i < data.length; i++) {
      crc ^= data[i];
      for (var j = 0; j < 8; j++) crc = (crc >>> 1) ^ (crc & 1 ? 0xEDB88320 : 0);
    }
    crc = (crc ^ 0xFFFFFFFF) >>> 0;
    var crc32 = crc.toString(16).toUpperCase().padStart(8, '0');

    document.getElementById('modal-title').textContent = 'Disk Hash';
    var body = document.getElementById('modal-body');
    body.innerHTML =
      '<div style="font-size:13px;line-height:2">' +
        '<b>File:</b> ' + escHtml(currentFileName || 'unnamed') + '<br>' +
        '<b>Size:</b> ' + data.length + ' bytes<br>' +
        '<b>CRC32:</b> <code class="code-tag">' + crc32 + '</code><br>' +
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
// Builds a `data:application/octet-stream;base64,…` string from the
// disk's save buffer (so G64 tabs export the GCR-encoded G64, not the
// internal D64) and shows it in a modal with a Copy button. Useful for
// embedding small disks in forum posts or git issues.
document.getElementById('opt-base64').addEventListener('click', function(e) {
  e.stopPropagation();
  if (!currentBuffer) return;
  closeMenus();

  // Convert ArrayBuffer to base64 in 32KB chunks — String.fromCharCode
  // chokes on million-byte spreads, and a per-byte concat is too slow
  // for a 174KB D64 (let alone a 333KB G64).
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

  var layout = currentG64Layout;
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

  // Bucket each track by what its physical layout looks like, so the
  // table can show plain-English labels instead of raw "12/21 i=1"
  // strings. The thresholds are chosen so the legend's four colour
  // bands have intuitive boundaries: green for normal, amber for
  // copy-protected (some sectors hidden behind custom GCR), red for
  // scrambled (the loader trampolines through a non-arithmetic order),
  // grey for empty / undecodable tracks.
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

  // Disk-level read: roll up the per-track classification into one of
  // the friendlier story types ("standard mastered disk", "all tracks
  // copy-protected on track 1 only", etc.). Callers display the head
  // result; the byKind counts power the per-class chips next to it.
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

  showModal('G64 Layout', []);
  setModalSize('xl');
  var body = document.getElementById('modal-body');
  body.innerHTML =
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
    '</div>';

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
    for (var i = 0; i < t.sectorOrder.length; i++) {
      var sec = t.sectorOrder[i];
      var x = labelW + i * stepX + gap;
      // Highlight a cell when its position differs from the expected
      // logical position computed from the track's nominal interleave.
      var expectedSec = iv != null ? (t.sectorOrder[0] + i * iv) % t.expectedSpt : sec;
      var off = (sec !== expectedSec);
      ctx.fillStyle = off ? cellAccent : cellBg;
      ctx.beginPath();
      ctx.roundRect(x, y, cellW, cellH, 2);
      ctx.fill();

      ctx.fillStyle = off ? bgColor : cellText;
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
    var unreadHtml = t.unreadableSectors.length === 0 ? ''
      : '<div class="g64-warn"><b>Unreadable sectors:</b> ' +
        t.unreadableSectors.map(function(s){ return s; }).join(', ') +
        '</div>';
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

  var footer = document.querySelector('#modal-overlay .modal-footer');
  footer.innerHTML = '<button id="modal-close">OK</button>';
  document.getElementById('modal-close').addEventListener('click', function() {
    document.getElementById('modal-overlay').classList.remove('open');
  });
  document.getElementById('modal-overlay').classList.add('open');
});

// Render the disk as concentric tracks with each pixel coloured by the
// bit pattern of the raw GCR byte at that angular position. Track 1 is
// the outer ring, the last track is the inner ring; each track plays
// counter-clockwise from the bottom. Sync marks (long $FF runs) show as
// red, gaps/padding (long $00 runs) as blue, normal GCR data as green
// shaded by 1-bit count. Style follows Michael Steil's 1541 visual.
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

  // Pre-compute per-track classification: byte index → category.
  //   0 = data byte (use popcount green/red)
  //   1 = mid sync run ($FF inside a long $FF run): pure red
  //   2 = mid zero run ($00 inside a long $00 run): pure blue
  // Using >= 4 consecutive bytes as the threshold so a single $FF in
  // header content doesn't get tagged as sync.
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
      if (cls === 1) {           // sync run
        r = 220; g = 60;  bcol = 60;
      } else if (cls === 2) {    // zero run
        r = 60;  g = 80;  bcol = 200;
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

  // Linked directory: header sector + dir chain (e.g. CMD Native DIR type)
  if (currentFormat.subdirLinked) {
    var name = await showInputModal('Directory Name', 'SUBDIR');
    if (!name) return;
    name = name.toUpperCase().substring(0, 16);

    pushUndo();
    var data = new Uint8Array(currentBuffer);
    var fmt = currentFormat;
    var bamOff = sectorOffset(fmt.bamTrack, fmt.bamSector);

    // Allocate 2 sectors: header + first dir sector
    var allocated = buildTrueAllocationMap(currentBuffer);
    var sectorList = allocateSectors(allocated, 2);
    if (sectorList.length < 2) {
      showModal('Add Directory Error', ['Not enough free sectors.']);
      return;
    }

    var hdrSec = sectorList[0];
    var dirSec = sectorList[1];

    // Find parent header T/S for back-navigation
    var parentHeaderT = fmt.headerTrack;
    var parentHeaderS = fmt.headerSector;
    if (currentPartition && currentPartition.dnpHeaderT !== undefined) {
      parentHeaderT = currentPartition.dnpHeaderT;
      parentHeaderS = currentPartition.dnpHeaderS;
    }

    // Write header sector
    var hdrOff = sectorOffset(hdrSec.track, hdrSec.sector);
    for (var hi = 0; hi < 256; hi++) data[hdrOff + hi] = 0x00;
    data[hdrOff + 0x00] = dirSec.track;  // dir chain T/S
    data[hdrOff + 0x01] = dirSec.sector;
    data[hdrOff + 0x02] = fmt.dosVersion;
    // Write name at format's name offset
    for (var ni = 0; ni < fmt.nameLength; ni++) {
      if (ni < name.length) {
        var ch = name.charCodeAt(ni);
        data[hdrOff + fmt.nameOffset + ni] = (ch >= 0x41 && ch <= 0x5A) ? ch : (ch >= 0x30 && ch <= 0x39) ? ch : 0x20;
      } else {
        data[hdrOff + fmt.nameOffset + ni] = 0xA0;
      }
    }
    // Copy disk ID region from root header (includes pad + DOS type)
    var rootHdrOff = sectorOffset(fmt.headerTrack, fmt.headerSector);
    for (var idi = 0; idi < fmt.idLength; idi++) {
      data[hdrOff + fmt.idOffset + idi] = data[rootHdrOff + fmt.idOffset + idi];
    }
    // Self-reference
    data[hdrOff + fmt.subdirSelfRef] = hdrSec.track;
    data[hdrOff + fmt.subdirSelfRef + 1] = hdrSec.sector;
    // Parent header
    data[hdrOff + fmt.subdirParentRef] = parentHeaderT;
    data[hdrOff + fmt.subdirParentRef + 1] = parentHeaderS;

    // Write empty dir sector
    var dirOff = sectorOffset(dirSec.track, dirSec.sector);
    for (var di = 0; di < 256; di++) data[dirOff + di] = 0x00;
    data[dirOff + 0x00] = 0x00;
    data[dirOff + 0x01] = 0xFF;

    // Mark sectors as used in BAM
    bamMarkSectorUsed(data, hdrSec.track, hdrSec.sector, bamOff);
    bamMarkSectorUsed(data, dirSec.track, dirSec.sector, bamOff);

    // Create directory entry
    var entryOff = findFreeDirEntry(currentBuffer);
    if (entryOff < 0) {
      showModal('Add Directory Error', ['No free directory entry.']);
      return;
    }
    data[entryOff + 2] = 0x80 | fmt.subdirType; // subdir type + closed
    data[entryOff + 3] = hdrSec.track;
    data[entryOff + 4] = hdrSec.sector;
    for (var eni = 0; eni < fmt.nameLength; eni++) data[entryOff + 5 + eni] = data[hdrOff + fmt.nameOffset + eni];
    for (var eu = 21; eu < 30; eu++) data[entryOff + eu] = 0x00;
    data[entryOff + 30] = 2; // 2 blocks (header + dir)
    data[entryOff + 31] = 0;

    // Store parent entry reference in header
    data[hdrOff + fmt.subdirParentEntry] = entryOff >> 8;
    data[hdrOff + fmt.subdirParentEntry + 1] = entryOff & 0xFF;

    var info = parseCurrentDir(currentBuffer);
    renderDisk(info);
    updateMenuState();
    return;
  }

  if (currentFormat.subdirLinked || !currentFormat.supportsSubdirs || currentPartition) return;

  // Ask for partition name
  var name = await showInputModal('Directory Name', 'SUBDIR');
  if (!name) return;
  name = name.toUpperCase().substring(0, 16);

  // Ask for desired blocks free (minimum 80 = 2 data tracks + 1 system track)
  var blocksStr = await showInputModal('Blocks Free (min 80, multiples of 40)', '80');
  if (!blocksStr) return;
  var desiredBlocks = parseInt(blocksStr, 10);
  if (isNaN(desiredBlocks) || desiredBlocks < 80) {
    showModal('Add Directory Error', ['Minimum is 80 blocks (2 data tracks).']);
    return;
  }
  // Round up to next multiple of sectors-per-track
  var pSpt = currentFormat.partitionSpt;
  var dataTracks = Math.ceil(desiredBlocks / pSpt);
  var numTracks = dataTracks + 1; // +1 for system track (header, BAM, dir)
  var partSectors = numTracks * pSpt;
  var actualBlocks = dataTracks * pSpt;

  // Build true allocation map to find contiguous free tracks
  var allocated = buildTrueAllocationMap(currentBuffer);
  var fmt = currentFormat;

  // Find contiguous free tracks (must not include track 40, must start at sector 0)
  // Search for a contiguous run of numTracks tracks that are completely free
  var startTrack = -1;
  for (var t = 1; t <= currentTracks - numTracks + 1; t++) {
    // Skip ranges that include track 40 (system track)
    var endTrack = t + numTracks - 1;
    if (t <= fmt.dirTrack && endTrack >= fmt.dirTrack) continue;

    var allFree = true;
    for (var ct = t; ct <= endTrack; ct++) {
      var spt = fmt.sectorsPerTrack(ct);
      for (var cs = 0; cs < spt; cs++) {
        if (allocated[ct + ':' + cs]) { allFree = false; break; }
      }
      if (!allFree) break;
    }
    if (allFree) { startTrack = t; break; }
  }

  if (startTrack < 0) {
    showModal('Add Directory Error', ['Not enough contiguous free space. Need ' + numTracks + ' tracks (' + actualBlocks + ' blocks + 1 system track).']);
    return;
  }

  // Check we have a free directory entry
  if (!canInsertFile()) {
    showModal('Add Directory Error', ['No free directory entry available.']);
    return;
  }

  pushUndo();
  // Take snapshot for rollback
  var snapshot = currentBuffer.slice(0);
  var data = new Uint8Array(currentBuffer);

  // Create directory entry for the partition
  var entryOff = findFreeDirEntry(currentBuffer);
  if (entryOff < 0) {
    currentBuffer = snapshot;
    showModal('Add Directory Error', ['Failed to allocate directory entry.']);
    return;
  }

  // Subdir type + closed
  data[entryOff + 2] = 0x80 | currentFormat.subdirType;
  // Start track/sector (sector must be 0)
  data[entryOff + 3] = startTrack;
  data[entryOff + 4] = 0;
  // Name
  for (var ni = 0; ni < 16; ni++) {
    if (ni < name.length) {
      var ch = name.charCodeAt(ni);
      if (ch >= 0x41 && ch <= 0x5A) data[entryOff + 5 + ni] = ch;
      else if (ch >= 0x30 && ch <= 0x39) data[entryOff + 5 + ni] = ch;
      else if (ch === 0x20) data[entryOff + 5 + ni] = 0x20;
      else data[entryOff + 5 + ni] = 0x20;
    } else {
      data[entryOff + 5 + ni] = 0xA0;
    }
  }
  // Clear unused bytes
  for (var ui = 21; ui < 30; ui++) data[entryOff + ui] = 0x00;
  // Partition size in sectors
  data[entryOff + 30] = partSectors & 0xFF;
  data[entryOff + 31] = (partSectors >> 8) & 0xFF;

  // Format the partition: header (sector 0), BAM (sectors 1-2), directory (sector 3)
  var headerOff = sectorOffset(startTrack, 0);

  // Header sector — mirrors D81 root header layout
  data[headerOff + 0x00] = startTrack; // dir track (self-referencing)
  data[headerOff + 0x01] = 3;          // dir sector
  data[headerOff + 0x02] = 0x44;       // DOS version 'D'
  data[headerOff + 0x03] = 0xBB;
  // Disk name at offset 0x04
  for (var hi = 0; hi < 16; hi++) data[headerOff + 0x04 + hi] = data[entryOff + 5 + hi];
  data[headerOff + 0x14] = 0xA0;
  data[headerOff + 0x15] = 0xA0;
  // Disk ID
  data[headerOff + 0x16] = 0x31; // '1'
  data[headerOff + 0x17] = 0x41; // 'A'
  data[headerOff + 0x18] = 0xA0;
  // DOS type
  data[headerOff + 0x19] = 0x33; // '3'
  data[headerOff + 0x1A] = 0x44; // 'D'
  for (var fi = 0x1B; fi < 0x100; fi++) data[headerOff + fi] = 0x00;

  // BAM sector 1 (startTrack, 1) — covers tracks 1..40 of the partition
  var bam1Off = sectorOffset(startTrack, 1);
  data[bam1Off + 0x00] = startTrack;
  data[bam1Off + 0x01] = 2;        // link to BAM sector 2
  data[bam1Off + 0x02] = 0x44;     // DOS version
  data[bam1Off + 0x03] = 0xBB;
  data[bam1Off + 0x04] = 0x31;     // ID copy
  data[bam1Off + 0x05] = 0x41;
  for (var b1 = 0x06; b1 < 0x10; b1++) data[bam1Off + b1] = 0x00;

  // BAM sector 2 (startTrack, 2) — covers tracks 41..80 of the partition
  var bam2Off = sectorOffset(startTrack, 2);
  data[bam2Off + 0x00] = 0x00;     // end of chain
  data[bam2Off + 0x01] = 0xFF;
  data[bam2Off + 0x02] = 0x44;
  data[bam2Off + 0x03] = 0xBB;
  data[bam2Off + 0x04] = 0x31;
  data[bam2Off + 0x05] = 0x41;
  for (var b2 = 0x06; b2 < 0x10; b2++) data[bam2Off + b2] = 0x00;

  // Initialize BAM entries for each track in the partition
  for (var pt = 1; pt <= numTracks; pt++) {
    var base;
    if (pt <= 40) {
      base = bam1Off + 0x10 + (pt - 1) * 6;
    } else {
      base = bam2Off + 0x10 + (pt - 41) * 6;
    }

    if (pt === 1) {
      // First track: sectors 0-3 used (header, BAM1, BAM2, first dir sector)
      data[base] = 40 - 4; // 36 free
      for (var bb = 0; bb < 5; bb++) data[base + 1 + bb] = 0xFF;
      data[base + 1] &= ~(1 << 0); // sector 0
      data[base + 1] &= ~(1 << 1); // sector 1
      data[base + 1] &= ~(1 << 2); // sector 2
      data[base + 1] &= ~(1 << 3); // sector 3
    } else {
      // Other tracks: all 40 sectors free
      data[base] = 40;
      for (var bb2 = 0; bb2 < 5; bb2++) data[base + 1 + bb2] = 0xFF;
    }
  }

  // Initialize first directory sector (startTrack, 3)
  var dirOff = sectorOffset(startTrack, 3);
  data[dirOff + 0] = 0x00; // end of chain
  data[dirOff + 1] = 0xFF;
  for (var di = 2; di < 256; di++) data[dirOff + di] = 0x00;

  // Mark all partition sectors as allocated in the root BAM
  var rootBamOff = sectorOffset(fmt.bamTrack, fmt.bamSector);
  for (var rt = startTrack; rt < startTrack + numTracks; rt++) {
    var spt = fmt.sectorsPerTrack(rt);
    // Clear all bits (mark all sectors as used)
    var rbase;
    if (rt <= 40) {
      rbase = rootBamOff + 0x10 + (rt - 1) * 6;
    } else {
      rbase = rootBamOff + 256 + 0x10 + (rt - 41) * 6;
    }
    data[rbase] = 0; // 0 free
    for (var rb = 0; rb < 5; rb++) data[rbase + 1 + rb] = 0x00; // all bits clear = all used
  }

  // Success
  selectedEntryIndex = entryOff;
  var info = parseDisk(currentBuffer);
  renderDisk(info);
  updateMenuState();
  showModal('Directory Created', [
    'Directory "' + name + '" created.',
    numTracks + ' tracks (' + startTrack + '-' + (startTrack + numTracks - 1) + '), ' + actualBlocks + ' blocks free.',
    'Double-click to enter the directory.'
  ]);
});

