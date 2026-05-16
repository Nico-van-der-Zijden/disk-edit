// ── Separators ─────────────────────────────────────────────────────
// ── Insert Separator ──────────────────────────────────────────────────
// Separator patterns — each is a 16-byte array or a single byte (repeated 16x)
// PETSCII codes for box drawing: $C0=─, $DD=│, $B0=┌, $AE=┐, $AD=└, $BD=┘, $AB=├, $B3=┤, $B1=┴, $B2=┬
// PETSCII box drawing: $C0=─, $DD=│, $B0=┌, $AE=┐, $AD=└, $BD=┘, $AB=├, $B3=┤, $B1=┴, $B2=┬
// Rounded corners: $D5=╭, $C9=╮, $CA=╰, $CB=╯
// Diagonals: $CD=╱, $CC=╲
var _h14 = [0xC0,0xC0,0xC0,0xC0,0xC0,0xC0,0xC0,0xC0,0xC0,0xC0,0xC0,0xC0,0xC0,0xC0];
var _s14 = [0x20,0x20,0x20,0x20,0x20,0x20,0x20,0x20,0x20,0x20,0x20,0x20,0x20,0x20];
var DEFAULT_SEPARATORS = [
  { name: 'Horizontal line', bytes: [0xC0,0xC0,0xC0,0xC0,0xC0,0xC0,0xC0,0xC0,0xC0,0xC0,0xC0,0xC0,0xC0,0xC0,0xC0,0xC0] },
  { name: 'Wavy line',       bytes: [0x66,0x72,0xAF,0x72,0x66,0xC0,0x64,0x65,0x65,0x64,0x60,0x66,0x72,0xAF,0x72,0x66] },
  { name: 'Top sharp',       bytes: [0xB0].concat(_h14,[0xAE]) },
  { name: 'Bottom sharp',    bytes: [0xAD].concat(_h14,[0xBD]) },
  { name: 'T-junction',      bytes: [0xAB].concat(_h14,[0xB3]) },
  { name: 'Sides',           bytes: [0xDD].concat(_s14,[0xDD]) },
  { name: 'Top rounded',     bytes: [0xD5].concat(_h14,[0xC9]) },
  { name: 'Bottom rounded',  bytes: [0xCA].concat(_h14,[0xCB]) },
];

// Custom separators stored in localStorage
var customSeparators = JSON.parse(localStorage.getItem('cbm-customSeparators') || '[]');

function saveCustomSeparators() {
  localStorage.setItem('cbm-customSeparators', JSON.stringify(customSeparators));
}

function separatorExists(bytes) {
  for (var i = 0; i < customSeparators.length; i++) {
    var match = true;
    for (var j = 0; j < 16; j++) {
      if (customSeparators[i].bytes[j] !== bytes[j]) { match = false; break; }
    }
    if (match) return true;
  }
  return false;
}

function getAllSeparators() {
  return DEFAULT_SEPARATORS.concat(customSeparators);
}

function sepBytesToPreview(bytes) {
  var preview = '';
  for (var j = 0; j < 16; j++) {
    var b = bytes[j] != null ? bytes[j] : 0xA0;
    var rev = (b <= 0x1F) || (b >= 0x80 && b <= 0x9F);
    var ch = escHtml(PETSCII_MAP[b]);
    preview += rev ? '<span class="petscii-rev">' + ch + '</span>' : ch;
  }
  return preview;
}

// Build the separator submenu
function buildSepSubmenu() {
  var submenu = document.getElementById('sep-submenu');
  if (!submenu) return;
  var all = getAllSeparators();
  var html = '';
  for (var i = 0; i < all.length; i++) {
    if (i === DEFAULT_SEPARATORS.length && customSeparators.length > 0) {
      html += '<div class="separator"></div>';
    }
    var sepLabel = all[i].name ? ' <span style="font-size:11px;color:var(--text-muted)">' + escHtml(all[i].name) + '</span>' : '';
    html += '<div class="option" data-sep-idx="' + i + '" title="' + escHtml(all[i].name) + '">' +
      '<span style="font-family:\'C64 Pro Mono\',monospace;font-size:12px">' + sepBytesToPreview(all[i].bytes) + '</span>' + sepLabel + '</div>';
  }
  submenu.innerHTML = html;
}

// Separator editor modal
function showSeparatorEditor() {
  var editIdx = -1; // -1 = not editing, >= 0 = editing custom separator at this index

  function render() {
    var html = '<div class="sep-editor-layout">';
    html += '<div class="sep-editor-list">';
    // Default separators (read-only)
    for (var i = 0; i < DEFAULT_SEPARATORS.length; i++) {
      html += '<div class="sep-editor-item">';
      html += '<span class="sep-editor-preview">' + sepBytesToPreview(DEFAULT_SEPARATORS[i].bytes) + '</span>';
      html += '<span style="font-size:11px;color:var(--text-muted)">' + escHtml(DEFAULT_SEPARATORS[i].name) + '</span>';
      html += '</div>';
    }
    // Custom separators
    for (var j = 0; j < customSeparators.length; j++) {
      html += '<div class="sep-editor-item">';
      html += '<span class="sep-editor-preview">' + sepBytesToPreview(customSeparators[j].bytes) + '</span>';
      if (customSeparators[j].name) html += '<span style="font-size:11px;color:var(--text-muted)">' + escHtml(customSeparators[j].name) + '</span>';
      html += '<button class="sep-editor-btn" data-action="edit" data-cidx="' + j + '"><i class="fa-solid fa-pen"></i></button>';
      html += '<button class="sep-editor-btn danger" data-action="delete" data-cidx="' + j + '"><i class="fa-solid fa-trash"></i></button>';
      html += '</div>';
    }
    html += '</div>';

    // Add/Edit form (fixed at bottom). The pattern input is a contenteditable
    // PETSCII editor (populated after render so reversed bytes round-trip).
    html += '<div class="sep-editor-form">';
    html += '<div style="display:flex;gap:8px;align-items:center;margin-bottom:4px">';
    html += '<div id="sep-edit-input-host"></div>';
    html += '<input type="text" id="sep-edit-name" style="flex:1;padding:4px 8px;background:var(--bg-input);color:var(--text);border:1px solid var(--border);border-radius:3px;font-size:12px;outline:none" value="' +
      (editIdx >= 0 ? escHtml(customSeparators[editIdx].name || '') : '') + '" placeholder="Name (optional)">';
    html += '<button class="sep-editor-btn" id="sep-edit-save">' + (editIdx >= 0 ? 'Update' : 'Add') + '</button>';
    if (editIdx >= 0) html += '<button class="sep-editor-btn" id="sep-edit-cancel">Cancel</button>';
    html += '</div>';
    html += '</div>';
    html += '</div>'; // close sep-editor-layout

    return html;
  }

  showModal('Edit Separators', []);
  var body = document.getElementById('modal-body');
  body.innerHTML = render();

  function mountPetsciiInput(initialBytes, initialLen) {
    var host = document.getElementById('sep-edit-input-host');
    if (!host) return null;
    host.innerHTML = '';
    var editor = createPetsciiEditor({
      maxLen: 16,
      initialBytes: initialBytes || new Uint8Array(16),
      initialLen: initialLen || 0,
      className: 'sep-editor-input'
    });
    host.appendChild(editor);
    editor.addEventListener('focus', function() { showPetsciiPicker(editor, 16); });
    editor.addEventListener('blur', function() { if (!petsciiPicker.clicking) hidePetsciiPicker(); });
    return editor;
  }

  function attachEvents() {
    var preBytes = null, preLen = 0;
    if (editIdx >= 0) {
      var src = customSeparators[editIdx].bytes;
      preBytes = new Uint8Array(16);
      preLen = Math.min(src.length, 16);
      for (var m = 0; m < preLen; m++) preBytes[m] = src[m];
    }
    mountPetsciiInput(preBytes, preLen);

    body.addEventListener('click', function handler(e) {
      if (e.target.tagName === 'INPUT') return;
      if (e.target.closest('.petscii-editor')) return;
      var btn = e.target.closest('[data-action]');
      if (!btn) {
        // Save/Cancel buttons
        if (e.target.closest('#sep-edit-save')) {
          var host = document.getElementById('sep-edit-input-host');
          var editor = host && host.querySelector('.petscii-editor');
          if (!editor || editor.getLength() === 0) return;
          var byteArr = editor.getBytes();  // no padding
          var bytes = [];
          for (var k = 0; k < byteArr.length; k++) bytes.push(byteArr[k]);
          var nameInput = document.getElementById('sep-edit-name');
          var sepName = nameInput ? nameInput.value.trim() : '';
          if (editIdx >= 0) {
            customSeparators[editIdx].bytes = bytes;
            customSeparators[editIdx].name = sepName;
          } else {
            if (separatorExists(bytes)) { render(); return; }
            customSeparators.push({ name: sepName, bytes: bytes });
          }
          saveCustomSeparators();
          buildSepSubmenu();
          if (typeof renderSepFloatBody === 'function') renderSepFloatBody();
          editIdx = -1;
          body.removeEventListener('click', handler);
          body.innerHTML = render();
          attachEvents();
          return;
        }
        if (e.target.closest('#sep-edit-cancel')) {
          editIdx = -1;
          body.removeEventListener('click', handler);
          body.innerHTML = render();
          attachEvents();
          return;
        }
        return;
      }

      var action = btn.getAttribute('data-action');
      var cidx = parseInt(btn.getAttribute('data-cidx'), 10);

      if (action === 'delete') {
        customSeparators.splice(cidx, 1);
        saveCustomSeparators();
        buildSepSubmenu();
        if (typeof renderSepFloatBody === 'function') renderSepFloatBody();
        editIdx = -1;
        body.removeEventListener('click', handler);
        body.innerHTML = render();
        attachEvents();
      } else if (action === 'edit') {
        editIdx = cidx;
        body.removeEventListener('click', handler);
        body.innerHTML = render();
        attachEvents();
      }
    });
  }

  attachEvents();
}

document.getElementById('opt-edit-separators').addEventListener('click', function(e) {
  e.stopPropagation();
  closeMenus();
  showSeparatorEditor();
});

document.getElementById('opt-save-sep').addEventListener('click', async function(e) {
  e.stopPropagation();
  if (!currentBuffer || selectedEntryIndex < 0) return;
  closeMenus();

  var data = new Uint8Array(currentBuffer);
  var bytes = [];
  for (var i = 0; i < 16; i++) bytes.push(data[selectedEntryIndex + 5 + i]);

  if (separatorExists(bytes)) {
    showModal('Save as Separator', ['This separator already exists.']);
    return;
  }

  var name = await showInputModal('Separator Name (optional)', '');
  if (name === null) return; // cancelled

  customSeparators.push({ name: name || '', bytes: bytes });
  saveCustomSeparators();
  buildSepSubmenu();
  if (typeof renderSepFloatBody === 'function') renderSepFloatBody();
  showModal('Save as Separator', ['Separator saved.' + (name ? ' Name: "' + name + '"' : '')]);
});

function insertSeparator(pattern) {
  if (!currentBuffer || !canInsertFile()) return;
  var newOff = insertAndPosition();
  if (newOff < 0) return;

  // Convert to a closed DEL with the separator pattern
  var data = new Uint8Array(currentBuffer);
  data[newOff + 2] = 0x80; // DEL, closed (not scratched)
  data[newOff + 3] = 0x00; // track 0
  data[newOff + 4] = 0x00; // sector 0
  var patBytes = pattern.bytes || [];
  var patLen = patBytes.length;
  for (var i = 0; i < 16; i++) {
    if (pattern.byte !== undefined) {
      data[newOff + 5 + i] = pattern.byte;
    } else if (i < patLen) {
      data[newOff + 5 + i] = patBytes[i];
    }
  }
  data[newOff + 30] = 0x00; // 0 blocks
  data[newOff + 31] = 0x00;

  selectedEntryIndex = newOff;
  var info = parseCurrentDir(currentBuffer);
  renderDisk(info);
}

// Build submenu on load and when charset changes
buildSepSubmenu();

// ── Floating "Show Separators" palette ───────────────────────────────
// Same draggable-titled-window pattern as the PETSCII charset float.
// While open, clicking a separator inserts it at the currently selected
// directory row (subject to the usual canInsertFile() guards).
var sepFloatPosition = null;

function ensureSepFloatBuilt() {
  var fl = document.getElementById('sep-float');
  if (fl) return fl;
  fl = document.createElement('div');
  fl.id = 'sep-float';
  fl.className = 'sep-float';
  fl.innerHTML =
    '<div class="sep-float-titlebar">' +
      '<i class="fa-solid fa-grip-vertical"></i>' +
      '<span class="sep-float-label">Separators</span>' +
      '<button class="sep-float-close" title="Close" aria-label="Close">&times;</button>' +
    '</div>' +
    '<div class="sep-float-body"></div>';
  document.body.appendChild(fl);

  var titleBar = fl.querySelector('.sep-float-titlebar');
  bindFloatDrag(fl, titleBar, function(x, y) {
    sepFloatPosition = { left: x, top: y };
  });

  fl.querySelector('.sep-float-close').addEventListener('click', function(e) {
    e.stopPropagation();
    hideSepFloat();
  });

  fl.querySelector('.sep-float-body').addEventListener('click', function(e) {
    var item = e.target.closest('.sep-float-item');
    if (!item || item.classList.contains('disabled')) return;
    var idx = parseInt(item.getAttribute('data-sep-idx'), 10);
    var all = getAllSeparators();
    if (isNaN(idx) || idx < 0 || idx >= all.length) return;
    if (typeof cfsPartitionIdx !== 'undefined' && cfsPartitionIdx >= 0) {
      insertCfsSeparator(all[idx]);
    } else {
      insertSeparator(all[idx]);
    }
    // Re-render so the disabled state updates if this insert filled the dir.
    renderSepFloatBody();
  });

  return fl;
}

function renderSepFloatBody() {
  var fl = document.getElementById('sep-float');
  if (!fl) return;
  var body = fl.querySelector('.sep-float-body');
  var all = getAllSeparators();
  // canInsertFile is CBM-DOS-only; in a CFS partition view, gate on the
  // CFS empty-slot check instead so the float stays clickable on .hdd.
  var inCfs = typeof cfsPartitionIdx !== 'undefined' && cfsPartitionIdx >= 0;
  var canInsert = inCfs
    ? !!(hddBuffer && cfsFindEmptyDirSlot(hddBuffer, cfsDirLba))
    : (!!currentBuffer && !isTapeFormat() && canInsertFile());

  var html = '';
  for (var i = 0; i < all.length; i++) {
    html += sepFloatItem(i, all[i], canInsert);
  }
  if (!canInsert) {
    var why = inCfs
      ? 'Directory is full — no room for another entry.'
      : (!currentBuffer ? 'Open an editable disk to insert separators.'
         : isTapeFormat() ? 'Tape images are read-only.'
         : 'Directory is full — no room for another entry.');
    html += '<div class="sep-float-hint">' + escHtml(why) + '</div>';
  }
  body.innerHTML = html;

  // Re-fit after content changes — when the body grew (new separator
  // saved while the float sat near the bottom of the viewport), this
  // both caps the body height to the visible space and slides the
  // float up if it would otherwise hang off-screen.
  fitSepFloat();
}

// Keep the float fully on-screen and scrollable. Caps the body's
// max-height to "available space below the titlebar within the
// viewport" — that's why the user gets a scrollbar instead of content
// hanging off the bottom — and slides the whole float up if it's
// already positioned where the new content wouldn't fit.
function fitSepFloat() {
  var fl = document.getElementById('sep-float');
  if (!fl || !fl.classList.contains('open')) return;
  var body = fl.querySelector('.sep-float-body');
  if (!body) return;
  var MARGIN = 8;
  // Reset the inline cap so we measure the natural height first.
  body.style.maxHeight = '';
  var rect = fl.getBoundingClientRect();
  var titleBar = fl.querySelector('.sep-float-titlebar');
  var titleH = titleBar ? titleBar.getBoundingClientRect().height : 0;

  var top = rect.top;
  var maxBodyH = window.innerHeight - top - titleH - MARGIN;
  // If the float is positioned so low that nothing fits, lift it.
  if (maxBodyH < 80) {
    top = Math.max(MARGIN, window.innerHeight - titleH - 80 - MARGIN);
    fl.style.top = top + 'px';
    fl.style.transform = '';
    sepFloatPosition = { left: rect.left, top: top };
    maxBodyH = window.innerHeight - top - titleH - MARGIN;
  }
  body.style.maxHeight = Math.max(80, maxBodyH) + 'px';
}

function sepFloatItem(idx, sep, canInsert) {
  var name = sep.name ? '<span class="sep-float-name">' + escHtml(sep.name) + '</span>' : '';
  var cls = 'sep-float-item' + (canInsert ? '' : ' disabled');
  return '<div class="' + cls + '" data-sep-idx="' + idx + '" title="' + escHtml(sep.name || '') + '">' +
    '<span class="sep-float-preview">' + sepBytesToPreview(sep.bytes) + '</span>' +
    name +
  '</div>';
}

function showSepFloat() {
  var fl = ensureSepFloatBuilt();
  if (sepFloatPosition) {
    fl.style.left = sepFloatPosition.left + 'px';
    fl.style.top = sepFloatPosition.top + 'px';
    fl.style.transform = '';
  } else {
    fl.style.left = '50%';
    fl.style.top = '50%';
    fl.style.transform = 'translate(-50%, -50%)';
  }
  if (typeof modalZCounter !== 'undefined') fl.style.zIndex = modalZCounter + 5;
  fl.classList.add('open');
  // renderSepFloatBody calls fitSepFloat at the end, which needs the
  // float to already be visible (and positioned) so getBoundingClientRect
  // reports correct numbers. Hence the order: open first, then render.
  renderSepFloatBody();
  var check = document.getElementById('check-separators');
  if (check) check.classList.add('checked');
}

function hideSepFloat() {
  var fl = document.getElementById('sep-float');
  if (fl) fl.classList.remove('open');
  var check = document.getElementById('check-separators');
  if (check) check.classList.remove('checked');
}

function isSepFloatOpen() {
  var fl = document.getElementById('sep-float');
  return !!(fl && fl.classList.contains('open'));
}

document.getElementById('opt-show-separators').addEventListener('click', function(e) {
  e.stopPropagation();
  if (this.classList.contains('disabled')) return;
  closeMenus();
  if (isSepFloatOpen()) hideSepFloat();
  else showSepFloat();
});

// Re-fit the float on viewport changes so its body cap stays correct
// when the window is resized (or the address bar collapses on mobile).
if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
  window.addEventListener('resize', function() {
    if (isSepFloatOpen()) fitSepFloat();
  });
}

document.getElementById('sep-submenu').addEventListener('click', function(e) {
  e.stopPropagation();
  var opt = e.target.closest('[data-sep-idx]');
  if (!opt) return;
  var idx = parseInt(opt.getAttribute('data-sep-idx'), 10);
  var all = getAllSeparators();
  if (isNaN(idx) || idx < 0 || idx >= all.length) return;
  closeMenus();
  if (typeof cfsPartitionIdx !== 'undefined' && cfsPartitionIdx >= 0) {
    insertCfsSeparator(all[idx]);
    return;
  }
  insertSeparator(all[idx]);
});

// CFS analogue of insertSeparator: write a Closed-DEL entry whose name
// holds the separator pattern, then shift the slot backward through the
// dir chain so it lands right after the current selection (same trick
// the CBM-DOS path uses via insertAndPosition).
function insertCfsSeparator(pattern) {
  if (typeof cfsPartitionIdx === 'undefined' || cfsPartitionIdx < 0) return;
  if (!hddBuffer || !cfsDirEntries) return;
  if (!cfsFindEmptyDirSlot(hddBuffer, cfsDirLba)) {
    showModal('Insert Separator', ['No empty directory slot available.']);
    return;
  }
  // Expand the pattern to a concrete 16-byte array. {byte: N} repeats N
  // for the whole name; {bytes: [...]} carries an explicit pattern that
  // shorter than 16 bytes leaves $A0-padded by cfsInsertSeparator.
  var patBytes;
  if (pattern.byte !== undefined) {
    patBytes = new Array(16);
    for (var pi = 0; pi < 16; pi++) patBytes[pi] = pattern.byte & 0xFF;
  } else {
    patBytes = (pattern.bytes || []).slice(0, 16);
  }
  var selBefore = (selectedEntryIndex >= 0 && cfsDirEntries[selectedEntryIndex])
    ? { dirLba: cfsDirEntries[selectedEntryIndex].dirLba, slotIndex: cfsDirEntries[selectedEntryIndex].index }
    : null;
  pushUndo();
  var res = cfsInsertSeparator(hddBuffer, cfsDirLba, patBytes);
  if (!res.ok) {
    showModal('Insert Separator failed', [res.error || 'Unknown error.']);
    if (typeof popUndo === 'function') popUndo();
    return;
  }
  // Same shift-backward dance as opt-insert so the new row lands right
  // after the selection instead of wherever the first free slot happened
  // to live.
  if (selBefore) {
    var allSlots = cfsCollectDirSlots(hddBuffer, cfsDirLba);
    var selIdx = -1, newIdx = -1;
    for (var si = 0; si < allSlots.length; si++) {
      if (allSlots[si].dirLba === selBefore.dirLba && allSlots[si].slotIndex === selBefore.slotIndex) selIdx = si;
      if (allSlots[si].dirLba === res.dirLba && allSlots[si].slotIndex === res.slotIndex) newIdx = si;
    }
    if (selIdx >= 0 && newIdx > selIdx + 1) {
      var cur = newIdx;
      var target = selIdx + 1;
      while (cur !== target) {
        cfsSwapDirSlots(hddBuffer, allSlots[cur], allSlots[cur - 1]);
        cur--;
      }
      res.dirLba = allSlots[target].dirLba;
      res.slotIndex = allSlots[target].slotIndex;
    }
  }
  refreshIde64View();
  // Drop the selection on the new separator row.
  for (var ni = 0; ni < cfsDirEntries.length; ni++) {
    var ent = cfsDirEntries[ni];
    if (ent && ent.dirLba === res.dirLba && ent.index === res.slotIndex) {
      selectedEntryIndex = ni;
      selectedEntries = [ni];
      var pickRow = document.querySelector('.dir-entry[data-cfs-entry="' + ni + '"]');
      if (pickRow) {
        document.querySelectorAll('.dir-entry.selected').forEach(function(el) { el.classList.remove('selected'); });
        pickRow.classList.add('selected');
      }
      updateEntryMenuState();
      break;
    }
  }
}
