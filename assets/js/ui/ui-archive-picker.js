// ── ZIP archive picker modal ─────────────────────────────────────────

var ZIP_DISK_EXTS = ['.d64', '.d71', '.d81', '.d80', '.d82', '.t64', '.tap', '.x64', '.g64', '.nib', '.nb2', '.d1m', '.d2m', '.d4m', '.dnp', '.lnx', '.rml', '.rl', '.dhd'];
var ZIP_FILE_EXTS = ['.prg', '.seq', '.usr', '.rel', '.p00', '.s00', '.u00', '.r00', '.cvt', '.txt'];

// Settle a picker exactly once, whether by its own buttons or by the modal
// being dismissed (Escape / X / backdrop fire 'modaldismiss').
function _pickerSettler(resolve, cancelValue) {
  var overlay = document.getElementById('modal-overlay');
  var settled = false;
  function settle(value) {
    if (settled) return;
    settled = true;
    overlay.removeEventListener('modaldismiss', onDismiss);
    overlay.classList.remove('open');
    resolve(value);
  }
  function onDismiss() { settle(cancelValue); }
  overlay.addEventListener('modaldismiss', onDismiss);
  return settle;
}

// Bucket ZIP members for both the picker and the auto-open shortcut, so the
// two can't drift apart. ZipCode members group into whole sets (one row, not
// files a user could half-select); leftovers come back as `orphans`.
function classifyZipEntries(entries) {
  // Claimed by the same rule the drop path uses, including an appended CBM
  // type — a zip of exported parts holds "1!!NAME.prg".
  var claim = classifyDroppedZipCodeSets(entries);
  var disks = [], files = [], others = [];
  entries.forEach(function(e) {
    if (claim.claimed.indexOf(e) >= 0) return;
    var n = e.name.toLowerCase();
    var ext = n.substring(n.lastIndexOf('.'));
    if (ZIP_DISK_EXTS.indexOf(ext) >= 0) disks.push(e);
    else if (ZIP_FILE_EXTS.indexOf(ext) >= 0) files.push(e);
    else others.push(e);
  });

  var toRefs = function(list) {
    return list.map(function(x) { return { name: x.name, ref: x.entry }; });
  };
  var found = findZipCodeSets(toRefs(claim.zipcode));
  var foundSix = findSixPackSets(toRefs(claim.sixpack));
  var foundFile = findFilePackSets(toRefs(claim.filepack));
  var zc = toRefs(claim.zipcode), sp = toRefs(claim.sixpack), fp = toRefs(claim.filepack);
  var sets = found.complete.map(function(s) {
    return { name: s.name, tracks: s.tracks, members: s.refs, kind: 'zipcode' };
  }).concat(foundSix.complete.map(function(s) {
    // Track count isn't known until the signature byte is read, so label it
    // by member count here and let the decode report the real figure.
    return { name: s.name, tracks: 0, members: s.refs, kind: 'sixpack' };
  })).concat(foundFile.complete.map(function(s) {
    // The x! directory travels with the data parts — selecting the row has
    // to take it too or the set can't be decoded.
    return { name: s.name, tracks: 0, members: s.refs.concat([s.dirRef]), kind: 'filepack' };
  }));

  var claimed = [];
  sets.forEach(function(s) { claimed = claimed.concat(s.members); });
  var orphans = zc.concat(sp).concat(fp)
    .filter(function(x) { return claimed.indexOf(x.ref) < 0; })
    .map(function(x) { return x.ref; });

  return {
    disks: disks, files: files, sets: sets, orphans: orphans,
    partial: found.partial.concat(foundSix.partial).concat(foundFile.partial),
    others: others,
  };
}

function showArchiveMemberModal(archiveName, entries, skippedMembers) {
  return new Promise(function(resolve) {
    const c = classifyZipEntries(entries);
    const disks = c.disks, files = c.files, others = c.others;

    setModalSize('md');
    document.getElementById('modal-title').textContent = 'Archive: ' + archiveName;
    const body = document.getElementById('modal-body');
    body.innerHTML = '';

    const checkboxes = [];
    const done = _pickerSettler(resolve, []);

    if (disks.length === 0 && files.length === 0 && c.sets.length === 0) {
      const empty = document.createElement('div');
      // Leftover ZipCode members are the one "nothing to open" case with a
      // real explanation, so say what's wrong rather than just "nothing here".
      empty.textContent = c.orphans.length > 0
        ? 'This archive holds an incomplete ZipCode set, so there is nothing to open. ' +
          'A set needs 1!, 2!, 3! and 4! (plus 5! for a 40-track disk).'
        : 'No supported files in this archive.';
      body.appendChild(empty);
    }

    // Sections render regardless, so the skipped ones still explain
    // themselves even when there is nothing selectable.
    if (disks.length > 0) {
      appendArchivePickerSection(body, 'Disk images', disks, false, checkboxes);
    }
    if (c.sets.length > 0) {
      // One row per set, carrying its member entries — ticking the row takes
      // the whole set, which is the only useful granularity.
      const setRows = c.sets.map(function(s) {
        var what = s.kind === 'sixpack'
          ? 'SixPack, ' + s.members.length + ' files'
          : s.kind === 'filepack' ? 'FilePacked, ' + s.members.length + ' files'
          : s.members.length + ' files, ' + s.tracks + ' tracks';
        return { name: s.name + '  (' + what + ')', members: s.members };
      });
      appendArchivePickerSection(body, 'ZipCode sets', setRows, false, checkboxes);
    }
    if (c.orphans.length > 0) {
      // Can't be opened on their own — show them with the reason instead of
      // dropping them into the generic "Other" bucket.
      const missing = c.partial.map(function(p) { return p.name + ' [' + p.found.join(',') + ']'; }).join(', ');
      appendArchivePickerSection(body,
        'Incomplete ZipCode set — skipped' + (missing ? ' (' + missing + ')' : ''),
        c.orphans, true, null);
    }
    if (files.length > 0) {
      const canImport = !!currentBuffer;
      const fileTitle = canImport ? 'Files' : 'Files (no disk open — import disabled)';
      appendArchivePickerSection(body, fileTitle, files, !canImport, checkboxes);
    }
    if (others.length > 0) {
      appendArchivePickerSection(body, 'Other (skipped)', others, true, null);
    }
    if (skippedMembers && skippedMembers.length > 0) {
      appendArchivePickerSection(body, 'Could not be extracted',
        skippedMembers.map(function(s) { return { name: s.name + '  — ' + s.reason }; }),
        true, null);
    }

    const footer = document.querySelector('#modal-overlay .modal-footer');
    footer.innerHTML = '';

    const closeBtn = document.createElement('button');
    closeBtn.textContent = 'Close';
    closeBtn.className = 'modal-btn-secondary';
    closeBtn.addEventListener('click', function() { done([]); });
    footer.appendChild(closeBtn);

    const openBtn = document.createElement('button');
    openBtn.textContent = 'Open Selected';
    openBtn.addEventListener('click', function() {
      const picked = [];
      for (var i = 0; i < checkboxes.length; i++) {
        if (!checkboxes[i].cb.checked) continue;
        // A ZipCode set row stands for all its member files.
        const ent = checkboxes[i].entry;
        if (ent.members) picked.push.apply(picked, ent.members);
        else picked.push(ent);
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

// Entries to open without the picker, or null when there is a real choice.
// One disk image or one complete set counts as no choice; importable files
// and leftover parts block it so nothing is silently dropped.
function pickAutoOpen(entries) {
  var c = classifyZipEntries(entries);
  if (c.files.length > 0) return null;
  if (c.orphans.length > 0) return null;
  if (c.disks.length === 1 && c.sets.length === 0) return [c.disks[0]];
  if (c.sets.length === 1 && c.disks.length === 0) return c.sets[0].members;
  return null;
}

// Run a parsed container (tar / LHA / ZIP) through the member picker and
// append the choices to `out`, so every container type gets the same set
// grouping and shortcut. Unreadable members block it so they get listed.
async function _expandContainer(out, parsed, containerName) {
  if (parsed.error) throw new Error(parsed.error);
  var entries = parsed.entries || [];
  var skipped = parsed.skipped || [];
  if (entries.length === 0) {
    throw new Error(skipped.length
      ? 'nothing usable inside — ' + skipped.map(function(s) {
          return '"' + s.name + '" (' + s.reason + ')';
        }).join(', ')
      : 'no files inside');
  }
  var auto = skipped.length ? null : pickAutoOpen(entries);
  var picked = auto || await showArchiveMemberModal(containerName, entries, skipped);
  for (var j = 0; j < picked.length; j++) {
    out.push({ name: picked[j].name, buffer: picked[j].data });
  }
}

// Expand .gz / .tar / .lha / .zip / .nbz in a list of dropped/picked files;
// containers go through the member picker, everything else passes through.
// Returns Promise<Array<{name, buffer}>>.
async function expandArchives(files) {
  // Blob.arrayBuffer() first: FileReader can fail silently on unhydrated
  // cloud placeholders, where arrayBuffer() gives a real error.
  async function readBuffer(f) {
    try {
      if (typeof f.arrayBuffer === 'function') return await f.arrayBuffer();
    } catch (err) {
      throw new Error('Failed to read ' + f.name + ' — ' + (err && err.message ? err.message : err));
    }
    return await new Promise(function(resolve, reject) {
      var r = new FileReader();
      r.onload = function() { resolve(r.result); };
      r.onerror = function() {
        var underlying = (r.error && r.error.message) ? r.error.message : (r.error && r.error.name) || 'unknown';
        reject(new Error('Failed to read ' + f.name + ' — ' + underlying));
      };
      r.readAsArrayBuffer(f);
    });
  }

  var out = [];
  for (var i = 0; i < files.length; i++) {
    var f = files[i];
    var lower = f.name.toLowerCase();
    try {
      if (lower.endsWith('.gz') || lower.endsWith('.tgz')) {
        var raw = await readBuffer(f);
        var dec = await decompressGzip(raw);
        // Classify by the name left after dropping the gzip suffix.
        var inner = lower.endsWith('.tgz') ? f.name.slice(0, -4) + '.tar' : f.name.slice(0, -3);
        if (/\.tar$/i.test(inner)) {
          await _expandContainer(out, parseTar(dec), inner);
        } else {
          out.push({ name: inner, buffer: dec });
        }
      } else if (lower.endsWith('.tar')) {
        await _expandContainer(out, parseTar(await readBuffer(f)), f.name);
      } else if (lower.endsWith('.lha') || lower.endsWith('.lzh') || lower.endsWith('.lzs')) {
        await _expandContainer(out, parseLha(await readBuffer(f)), f.name);
      } else if (lower.endsWith('.nbz')) {
        var rawNbz = await readBuffer(f);
        var nibBuf = decompressNbz(rawNbz);
        out.push({ name: f.name.slice(0, -4) + '.nib', buffer: nibBuf });
      } else if (lower.endsWith('.zip')) {
        await _expandContainer(out, await parseZip(await readBuffer(f)), f.name);
      } else {
        var raw2 = await readBuffer(f);
        out.push({ name: f.name, buffer: raw2 });
      }
    } catch (err) {
      var msg = (err && err.message) ? err.message : String(err);
      // Dragging out of WinRAR/7-Zip (or a cloud stub) gives an unreadable
      // virtual handle; only the user can fix that.
      var hint = /Failed to read|NotReadableError|NotFoundError|network error/i.test(msg)
        ? 'If you dragged the file straight from an archive (WinRAR / 7-Zip / Bandizip / …) the browser only sees a virtual handle, not a real file. Extract the file first, then drop the extracted copy. Same fix for cloud-storage placeholders (OneDrive / iCloud) — make sure the file is downloaded locally before dropping.'
        : null;
      var lines = ['Failed to process ' + f.name + ': ' + msg];
      if (hint) lines.push('', hint);
      showModal('Archive error', lines);
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
      // Keeps names aligned with the rows that have checkboxes.
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

// ── ZipCode set picker (multi-select) ─────────────────────────────────
// A disk can hold several complete 1!..N! sets. Let the user tick any
// number; the caller opens one tab per pick. Resolves to an array of the
// chosen set objects (empty array = cancelled / nothing ticked).
function showZipCodeSetPicker(sets) {
  return new Promise(function(resolve) {
    setModalSize('md');
    document.getElementById('modal-title').textContent = 'Decompress ZipCode';
    var body = document.getElementById('modal-body');
    body.innerHTML = '';

    var intro = document.createElement('div');
    intro.textContent = sets.length + ' complete ZipCode sets found. ' +
      'Each set you pick opens in its own tab.';
    body.appendChild(intro);

    var checkboxes = [];
    var rows = sets.map(function(s) {
      // SixPack and FilePacked don't know a track count before decoding.
      var what = s.kind === 'sixpack' ? 'SixPack, ' + s.refs.length + ' files'
        : s.kind === 'filepack' ? 'FilePacked, ' + s.refs.length + ' files'
        : s.tracks + ' tracks, ' + s.refs.length + ' files';
      return { name: s.name + '  (' + what + ')', set: s };
    });
    appendArchivePickerSection(body, 'ZipCode sets', rows, false, checkboxes);

    var footer = document.querySelector('#modal-overlay .modal-footer');
    footer.innerHTML = '';
    var done = _pickerSettler(resolve, []);

    var cancelBtn = document.createElement('button');
    cancelBtn.textContent = 'Cancel';
    cancelBtn.className = 'modal-btn-secondary';
    cancelBtn.addEventListener('click', function() { done([]); });
    footer.appendChild(cancelBtn);

    // Primary (no .modal-btn-secondary) so Enter triggers it.
    var okBtn = document.createElement('button');
    okBtn.textContent = 'Decompress Selected';
    okBtn.addEventListener('click', function() {
      var picked = [];
      for (var i = 0; i < checkboxes.length; i++) {
        if (checkboxes[i].cb.checked) picked.push(checkboxes[i].entry.set);
      }
      done(picked);
    });
    footer.appendChild(okBtn);

    function refreshOkBtn() {
      okBtn.disabled = !checkboxes.some(function(c) { return c.cb.checked; });
    }
    checkboxes.forEach(function(c) { c.cb.addEventListener('change', refreshOkBtn); });
    refreshOkBtn();

    document.getElementById('modal-overlay').classList.add('open');
  });
}
