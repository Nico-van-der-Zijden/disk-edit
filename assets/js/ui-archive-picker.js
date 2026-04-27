// ── ZIP archive picker modal ─────────────────────────────────────────
// Lists the entries of an opened ZIP. Each actionable entry gets a
// checkbox (selected by default); the user reviews / unselects, then
// hits "Open Selected" to dispatch them all in one go. Downstream
// classification by extension decides whether each chosen entry is
// opened in a new tab or imported into the current disk — the picker
// itself doesn't care.

function showZipArchiveModal(archiveName, entries) {
  return new Promise(function(resolve) {
    var diskExts = ['.d64', '.d71', '.d81', '.d80', '.d82', '.t64', '.tap', '.x64', '.g64', '.d1m', '.d2m', '.d4m', '.dnp', '.lnx'];
    var fileExts = ['.prg', '.seq', '.usr', '.rel', '.p00', '.s00', '.u00', '.r00', '.cvt', '.txt'];

    var disks = [], files = [], others = [];
    entries.forEach(function(e) {
      var n = e.name.toLowerCase();
      var ext = n.substring(n.lastIndexOf('.'));
      if (diskExts.indexOf(ext) >= 0) disks.push(e);
      else if (fileExts.indexOf(ext) >= 0) files.push(e);
      else others.push(e);
    });

    setModalSize('md');
    document.getElementById('modal-title').textContent = 'ZIP archive: ' + archiveName;
    var body = document.getElementById('modal-body');
    body.innerHTML = '';

    // checkbox → entry, populated as we render. "Open Selected" walks
    // this to collect the user's choices without re-querying the DOM.
    var checkboxes = [];

    function done(picked) {
      document.getElementById('modal-overlay').classList.remove('open');
      resolve(picked);
    }

    if (disks.length === 0 && files.length === 0) {
      var empty = document.createElement('div');
      empty.textContent = 'No supported files in this archive.';
      body.appendChild(empty);
    } else {
      if (disks.length > 0) {
        appendArchivePickerSection(body, 'Disk images', disks, false, checkboxes);
      }
      if (files.length > 0) {
        var canImport = !!currentBuffer;
        var fileTitle = canImport ? 'Files' : 'Files (no disk open — import disabled)';
        appendArchivePickerSection(body, fileTitle, files, !canImport, checkboxes);
      }
      if (others.length > 0) {
        appendArchivePickerSection(body, 'Other (skipped)', others, true, null);
      }
    }

    var footer = document.querySelector('#modal-overlay .modal-footer');
    footer.innerHTML = '';

    var closeBtn = document.createElement('button');
    closeBtn.textContent = 'Close';
    closeBtn.className = 'modal-btn-secondary';
    closeBtn.addEventListener('click', function() { done([]); });
    footer.appendChild(closeBtn);

    var openBtn = document.createElement('button');
    openBtn.textContent = 'Open Selected';
    openBtn.addEventListener('click', function() {
      var picked = [];
      for (var i = 0; i < checkboxes.length; i++) {
        if (checkboxes[i].cb.checked) picked.push(checkboxes[i].entry);
      }
      done(picked);
    });
    footer.appendChild(openBtn);

    function refreshOpenBtn() {
      var anyChecked = checkboxes.some(function(c) { return c.cb.checked; });
      openBtn.disabled = !anyChecked;
    }
    checkboxes.forEach(function(c) {
      c.cb.addEventListener('change', refreshOpenBtn);
    });
    refreshOpenBtn();

    document.getElementById('modal-overlay').classList.add('open');
  });
}

// Returns the single disk-image entry if the archive holds exactly one,
// and no importable file entries that the user might also want — in
// that case the picker would just be a forced extra click. Returns null
// to fall through to the picker.
function pickSoloDisk(entries) {
  var diskExts = ['.d64', '.d71', '.d81', '.d80', '.d82', '.t64', '.tap', '.x64', '.g64', '.d1m', '.d2m', '.d4m', '.dnp', '.lnx'];
  var fileExts = ['.prg', '.seq', '.usr', '.rel', '.p00', '.s00', '.u00', '.r00', '.cvt', '.txt'];
  var disks = [], files = 0;
  for (var i = 0; i < entries.length; i++) {
    var n = entries[i].name.toLowerCase();
    var ext = n.substring(n.lastIndexOf('.'));
    if (diskExts.indexOf(ext) >= 0) disks.push(entries[i]);
    else if (fileExts.indexOf(ext) >= 0) files++;
  }
  if (disks.length === 1 && files === 0) return disks[0];
  return null;
}

// ── Pre-processing: expand .gz / .zip in a list of dropped/picked files
// Each input File is read once. .gz is transparently decompressed (the
// .gz suffix is stripped from the resulting name). .zip pops the picker
// and yields the user's chosen entries. Other inputs pass through as-is.
// Returns Promise<Array<{name, buffer}>> ready for normal extension-
// based classification by the caller.
async function expandArchives(files) {
  function readBuffer(f) {
    return new Promise(function(resolve, reject) {
      var r = new FileReader();
      r.onload = function() { resolve(r.result); };
      r.onerror = function() { reject(new Error('Failed to read ' + f.name)); };
      r.readAsArrayBuffer(f);
    });
  }

  var out = [];
  for (var i = 0; i < files.length; i++) {
    var f = files[i];
    var lower = f.name.toLowerCase();
    try {
      if (lower.endsWith('.gz')) {
        var raw = await readBuffer(f);
        var dec = await decompressGzip(raw);
        out.push({ name: f.name.slice(0, -3), buffer: dec });
      } else if (lower.endsWith('.zip')) {
        var rawZip = await readBuffer(f);
        var entries = await parseZip(rawZip);
        // If the archive holds exactly one disk image (plus optional
        // skip-able non-disk fluff like README.txt) and no importable
        // files, open it directly — the picker is just an extra click.
        var solo = pickSoloDisk(entries);
        var picked = solo ? [solo] : await showZipArchiveModal(f.name, entries);
        for (var j = 0; j < picked.length; j++) {
          out.push({ name: picked[j].name, buffer: picked[j].data });
        }
      } else {
        var raw2 = await readBuffer(f);
        out.push({ name: f.name, buffer: raw2 });
      }
    } catch (err) {
      showModal('Archive error', ['Failed to process ' + f.name + ': ' + (err && err.message ? err.message : err)]);
    }
  }
  return out;
}

// Render one section header + its entry rows. When `checkboxes` is
// provided each row gets a checkbox (default checked unless disabled);
// pass null for the "Other (skipped)" section which is read-only.
function appendArchivePickerSection(body, title, entries, disabled, checkboxes) {
  var h = document.createElement('div');
  h.textContent = title;
  h.style.fontWeight = 'bold';
  h.style.marginTop = '10px';
  h.style.marginBottom = '4px';
  h.style.color = 'var(--text-muted)';
  h.style.fontSize = '11px';
  h.style.textTransform = 'uppercase';
  h.style.letterSpacing = '0.5px';
  body.appendChild(h);

  entries.forEach(function(entry) {
    var row = document.createElement('label');
    row.style.display = 'flex';
    row.style.alignItems = 'center';
    row.style.gap = '8px';
    row.style.padding = '4px 0';
    row.style.cursor = checkboxes && !disabled ? 'pointer' : 'default';

    if (checkboxes) {
      var cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.checked = !disabled;
      cb.disabled = !!disabled;
      cb.style.flexShrink = '0';
      row.appendChild(cb);
      checkboxes.push({ cb: cb, entry: entry });
    } else {
      // Spacer so unchecked-section rows align with the rows that have
      // checkboxes — keeps the names in a tidy column.
      var spacer = document.createElement('span');
      spacer.style.width = '13px';
      spacer.style.flexShrink = '0';
      row.appendChild(spacer);
    }

    var name = document.createElement('span');
    name.textContent = entry.name;
    name.style.flex = '1';
    name.style.overflow = 'hidden';
    name.style.textOverflow = 'ellipsis';
    name.style.whiteSpace = 'nowrap';
    if (disabled) name.style.color = 'var(--text-muted)';
    row.appendChild(name);

    body.appendChild(row);
  });
}
