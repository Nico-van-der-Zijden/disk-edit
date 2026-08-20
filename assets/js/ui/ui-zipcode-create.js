// ── Create ZipCode (side pane) ───────────────────────────────────────
// Inspector-style pane: pick a variant, see exactly what it produces, then
// create the disk image(s). Each variant is encoded once and cached, so
// typing a name only re-labels the parts and re-plans the disks.

var _mkzipState = null;

var MKZIP_OUTPUTS = [
  { id: 'zip', label: 'ZIP archive' },
  { id: 'targz', label: 'tar.gz archive' },
  { id: 'd64', label: 'D64 image(s)' },
];

var MKZIP_VARIANTS = [
  { id: 'diskpacked', label: 'DiskPacked', maxBase: 14, sep: '!' },
  { id: 'sixpack', label: 'SixPack', maxBase: 13, sep: '!!' },
  { id: 'filepacked', label: 'FilePacked', maxBase: 14, sep: '!' },
];

function _mkzipVariant(id) {
  for (var i = 0; i < MKZIP_VARIANTS.length; i++) {
    if (MKZIP_VARIANTS[i].id === id) return MKZIP_VARIANTS[i];
  }
  return MKZIP_VARIANTS[0];
}

// What the box may hold while typing: uppercase, only characters a CBM name
// can carry, capped to the variant's length. Deliberately not trimmed — a
// space is trailing the instant you type it, and trimming here would eat it
// before the rest of the word arrives.
function _mkzipClean(name, max) {
  return String(name || '').toUpperCase()
    .replace(/[^A-Z0-9 .+()\-]/g, '').slice(0, max || 14);
}

// The name actually used for parts, disk labels and file names.
function _mkzipSanitize(name, max) {
  return _mkzipClean(name, max).trim();
}

function _mkzipDefaultName() {
  var info = parseCurrentDir(currentBuffer);
  var fromLabel = _mkzipSanitize(petsciiToReadable(info.diskName || ''));
  if (fromLabel) return fromLabel;
  var f = (currentFileName || 'DISK').replace(/\.[^.]*$/, '');
  return _mkzipSanitize(f) || 'DISK';
}

// Encode on demand and keep the result — switching variants back and forth
// shouldn't re-run the encoder.
function _mkzipEncoded(id) {
  var s = _mkzipState;
  if (s.cache[id]) return s.cache[id];
  var res;
  if (id === 'sixpack') res = compressSixPack(s.buffer, 'X', s.errors);
  else if (id === 'filepacked') res = _mkzipPackFiles(s.buffer);
  else res = compressZipCode(s.buffer, 'X');
  // FilePacked returns its directory file separately; the pane treats it as
  // just another part so naming, planning and delivery stay uniform.
  if (res && res.dir) res = { parts: res.parts.concat([res.dir]), tracks: 0 };
  s.cache[id] = res;
  return res;
}

function _mkzipRender() {
  var body = getViewerBody();
  if (!body || !_mkzipState) return;
  var s = _mkzipState;
  var v = _mkzipVariant(s.variant);
  var enc = _mkzipEncoded(s.variant);

  if (enc.error) {
    body.innerHTML = '<div class="text-md">' + escHtml(enc.error) + '</div>';
    return;
  }

  // `typed` is what stays in the box; `base` is what the parts are named,
  // so a half-typed "MY " still previews as "1!MY".
  var typed = _mkzipClean(s.name, v.maxBase);
  var base = typed.trim() || 'DISK';
  enc.parts.forEach(function(p, i) { p.name = (p.prefix || (i + 1) + v.sep) + base; });
  var plan = planZipCodeDisks(enc.parts);
  var single = plan.length === 1;
  var packed = enc.parts.reduce(function(a, p) { return a + p.data.length; }, 0);
  var pct = Math.round(100 * packed / s.sourceBytes);

  var h = '<div class="text-md mb-md">' +
    // .modal-input is the app's text-input style — theme-aware, and it picks
    // up the charset-case rule, which suits a name that becomes a CBM
    // filename. width:100% with a cap keeps it sane as the pane resizes.
    '<label>Set name<br><input type="text" id="mkzip-name" class="modal-input" maxlength="' +
    v.maxBase + '" value="' + escHtml(typed) + '" style="max-width:240px"></label>' +
    '<div class="text-sm text-muted">Parts are named ' + escHtml(base) + ' with a ' +
    enc.parts[0].name.replace(base, '') + ' … ' +
    enc.parts[enc.parts.length - 1].name.replace(base, '') + ' prefix. Up to ' +
    v.maxBase + ' characters.</div></div>';

  h += '<div class="text-md mb-md"><b>Format</b>';
  MKZIP_VARIANTS.forEach(function(opt) {
    h += '<br><label><input type="radio" name="mkzip-fmt" value="' + opt.id + '"' +
      (opt.id === s.variant ? ' checked' : '') + '> ' + opt.label + '</label>';
  });
  h += '<div class="text-sm text-muted">' +
    (s.variant === 'sixpack'
      ? 'Raw GCR, always six parts. The only variant that keeps read errors.'
      : s.variant === 'filepacked'
        ? 'Packs the files rather than the sectors, so it restores files onto a disk rather than restoring the disk itself. LOAD and RUN the x! part on a C64 to list what the set holds.'
        : 'Compressed sector copy, ' + enc.parts.length + ' parts. Cannot carry read errors.') +
    '</div></div>';

  h += '<div class="text-md mb-md"><b>Deliver as</b>';
  MKZIP_OUTPUTS.forEach(function(o) {
    h += '<br><label><input type="radio" name="mkzip-out" value="' + o.id + '"' +
      (o.id === s.output ? ' checked' : '') + '> ' + o.label + '</label>';
  });
  h += '<div class="text-sm text-muted">' +
    (s.output === 'd64'
      ? 'Each image opens as a tab; Save As writes it out.'
      : 'Downloads one file containing every part.') + '</div></div>';

  // Plain integers, no thousands separators: a "." grouping renders
  // "9.543 B" which reads as nine-and-a-half bytes.
  h += '<div class="text-md"><b>Result</b></div><table class="geos-info-table">' +
    '<tr><th>Part</th><th>Bytes</th><th>Blocks</th></tr>';
  enc.parts.forEach(function(p) {
    h += '<tr><td>' + escHtml(p.name) + '</td><td>' + p.data.length +
      '</td><td>' + (Math.ceil(p.data.length / 254) || 1) + '</td></tr>';
  });
  h += '</table>';

  h += '<div class="text-sm mb-md">' + packed + ' bytes total — ' + pct +
    '% of the source disk (' + s.sourceBytes + ' bytes)</div>';

  if (s.output === 'd64') {
    h += '<div class="text-md"><b>Disk image' + (single ? '' : 's') + '</b></div>';
    plan.forEach(function(d) {
      var nums = d.parts.map(function(i) { return i + 1; });
      var span = nums.length > 1 && nums[nums.length - 1] - nums[0] === nums.length - 1
        ? nums[0] + '-' + nums[nums.length - 1]
        : nums.join(', ');
      h += '<div class="text-sm">' + escHtml(_zipCodeDiskName(base, d, single)) +
        ' &mdash; part' + (nums.length === 1 ? ' ' : 's ') + span +
        ' &mdash; ' + d.blocks + ' of ' + ZIPCODE_D64_FREE_BLOCKS + ' blocks</div>';
    });
    h += '<div class="mb-md"></div>';
  }

  if (s.output === 'd64' && !single) {
    h += '<div class="text-sm text-muted mb-md">Too big for one disk, so it splits ' +
      'in part order — the convention real sets use.</div>';
  }
  if (s.errorCount) {
    h += '<div class="text-sm text-muted mb-md">' + s.errorCount +
      ' sector(s) on this disk carry read errors. ' +
      (s.variant === 'sixpack' ? 'SixPack keeps them.' : 'DiskPacked drops them — use SixPack to keep them.') +
      '</div>';
  }

  body.innerHTML = h;

  // The footer outlives a re-render, so keep its label in step with the
  // chosen output.
  var go = document.getElementById('mkzip-go');
  if (go) {
    go.textContent = s.output === 'd64'
      ? 'Create Disk' + (single ? '' : 's')
      : (s.output === 'zip' ? 'Download ZIP' : 'Download tar.gz');
  }

  var input = document.getElementById('mkzip-name');
  if (input) {
    input.addEventListener('input', function() {
      var raw = input.value;
      var caret = input.selectionStart;
      var cleaned = _mkzipClean(raw, v.maxBase);
      // Rendering replaces the element, so put the caret back — shifted left
      // by whatever the cleaner dropped, or it drifts past the text.
      caret -= raw.length - cleaned.length;
      s.name = cleaned;
      _mkzipRender();
      var again = document.getElementById('mkzip-name');
      if (again) {
        again.focus();
        var at = Math.max(0, Math.min(caret, again.value.length));
        again.setSelectionRange(at, at);
      }
    });
  }
  Array.prototype.forEach.call(body.querySelectorAll('input[name="mkzip-out"]'), function(r) {
    r.addEventListener('change', function() {
      if (!r.checked) return;
      s.output = r.value;
      _mkzipRender();
    });
  });
  Array.prototype.forEach.call(body.querySelectorAll('input[name="mkzip-fmt"]'), function(r) {
    r.addEventListener('change', function() {
      if (!r.checked) return;
      s.variant = r.value;
      _mkzipRender();
    });
  });
}

document.getElementById('opt-mkzip').addEventListener('click', function(e) {
  e.stopPropagation();
  if (!currentBuffer) return;
  closeMenus();

  // Count error sectors up front so the pane can steer the variant choice.
  var spt = DISK_FORMATS.d64.sectorsPerTrack;
  var tracks = currentBuffer.byteLength >= 196608 ? 40 : 35;
  var totalSectors = 0;
  for (var t = 1; t <= tracks; t++) totalSectors += spt(t);
  var errors = null, errorCount = 0;
  if (currentBuffer.byteLength > totalSectors * 256) {
    errors = new Uint8Array(currentBuffer, totalSectors * 256, totalSectors);
    for (var i = 0; i < errors.length; i++) if (errors[i] !== 1) errorCount++;
  }

  _mkzipState = {
    name: _mkzipDefaultName(),
    variant: errorCount > 0 ? 'sixpack' : 'diskpacked',
    buffer: currentBuffer,
    errors: errors,
    errorCount: errorCount,
    output: MKZIP_OUTPUTS[0].id,
    sourceBytes: currentBuffer.byteLength,
    cache: {},
  };

  openViewerSurface('Create ZipCode');

  // Footer before the first render: the render labels the primary button to
  // match the chosen output, and it can only do that once the button exists.
  var footer = getViewerFooter();
  if (footer) {
    footer.innerHTML = '<button id="mkzip-cancel" class="modal-btn-secondary">Close</button> ' +
      '<button id="mkzip-go"></button>';
    document.getElementById('mkzip-cancel').addEventListener('click', function() { closeViewer(); });
    document.getElementById('mkzip-go').addEventListener('click', _mkzipCreate);
  }
  _mkzipRender();
});

// Build the images and open each as a tab — the mirror of Decompress ZipCode,
// which also lands in a tab. Save As from there puts them wherever you like.
function _mkzipCreate() {
  var s = _mkzipState;
  if (!s) return;
  var v = _mkzipVariant(s.variant);
  var enc = _mkzipEncoded(s.variant);
  if (enc.error) { showModal('Create ZipCode', [enc.error]); return; }

  var base = _mkzipSanitize(s.name, v.maxBase) || 'DISK';
  enc.parts.forEach(function(p, i) { p.name = (p.prefix || (i + 1) + v.sep) + base; });

  if (s.output !== 'd64') { _mkzipDownload(enc.parts, base, s.output, v); return; }

  var built = zipCodeSetToDisks(enc.parts, base);
  if (built.error) { showModal('Create ZipCode', [built.error]); return; }
  closeViewer();

  saveActiveTab();
  var firstTabId = null;
  built.disks.forEach(function(d) {
    currentBuffer = d.buffer;
    currentFileName = d.name;
    currentPartition = null;
    selectedEntryIndex = -1;
    clearCmdContainerState();
    parseDisk(currentBuffer);
    var tab = createTab(d.name, currentBuffer, d.name);
    activeTabId = tab.id;
    clearUndo();
    cleanStackLength = -1;
    tabDirty = true;
    if (firstTabId === null) firstTabId = tab.id;
    saveActiveTab();
  });
  if (activeTabId !== firstTabId) {
    switchToTab(firstTabId);
  } else {
    renderDisk(parseCurrentDir(currentBuffer));
    renderTabs();
    updateMenuState();
  }

  var lines = ['Created ' + built.disks.length + ' ' + v.label + ' disk image' +
    (built.disks.length === 1 ? '' : 's') + ' holding "' + base + '":'];
  built.disks.forEach(function(d) { lines.push('  ' + d.name + ' — ' + d.parts.join(', ')); });
  lines.push('');
  lines.push('Each opened as a tab. Use Save As to write them out.');
  if (s.errorCount) {
    lines.push(s.variant === 'sixpack'
      ? s.errorCount + ' error sector(s) preserved.'
      : s.errorCount + ' error sector(s) were dropped — DiskPacked cannot carry them.');
  }
  showModal('Create ZipCode', lines);
}

// ZIP / tar.gz delivery: one file holding every part, so there's no
// multi-download prompt whichever variant produced them.
async function _mkzipDownload(parts, base, output, variant) {
  var members = parts.map(function(p) { return { name: p.name, data: p.data }; });
  var bytes, ext;
  try {
    if (output === 'zip') {
      bytes = buildZip(members);
      ext = '.zip';
    } else {
      bytes = await gzipBytes(buildTar(members));
      ext = '.tar.gz';
    }
  } catch (err) {
    showModal('Create ZipCode', [(err && err.message) ? err.message : String(err)]);
    return;
  }

  var safe = base.replace(/[<>:"/\|?*\x00-\x1F]/g, '_') || 'zipcode';
  var a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([bytes], { type: 'application/octet-stream' }));
  a.download = safe + ext;
  a.click();
  URL.revokeObjectURL(a.href);

  closeViewer();
  showModal('Create ZipCode', [
    'Wrote ' + safe + ext + ' — ' + variant.label + ', ' + parts.length + ' parts, ' +
      bytes.length + ' bytes.',
    'Dropping this file back in reassembles the disk.',
  ]);
}

// Gather the disk's files for FilePacked, which packs files rather than
// sectors. Only P/S/U survive the format — no REL, no lock/splat bits.
function _mkzipPackFiles(buffer) {
  var ctx = {
    buffer: buffer, partition: null, format: DISK_FORMATS.d64,
    tracks: buffer.byteLength >= 196608 ? 40 : 35,
    dirInterleave: dirInterleave, fileInterleave: fileInterleave,
  };
  var info = withDiskCtx(ctx, function() { return parseCurrentDir(buffer); });
  var data = new Uint8Array(buffer);
  var files = [], skipped = 0;

  for (var i = 0; i < info.entries.length; i++) {
    var e = info.entries[i];
    if (e.deleted || e.entryOff === undefined) continue;
    var idx = data[e.entryOff + 2] & 0x07;
    if (idx < 1 || idx > 3) { skipped++; continue; }        // SEQ / PRG / USR only
    var r = readFileData(buffer, e.entryOff, ctx);
    if (r.error || !r.data || !r.data.length) { skipped++; continue; }
    files.push({
      nameBytes: data.slice(e.entryOff + 5, e.entryOff + 21),
      typeChar: ['', 'S', 'P', 'U'][idx],
      data: r.data,
    });
  }
  if (files.length === 0) return { error: 'No SEQ / PRG / USR files on this disk to pack.' };
  var res = compressFilePack(files, 'X');
  if (!res.error) res.skippedFiles = skipped;
  return res;
}
