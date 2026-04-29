// ── Drag & Drop from OS ──────────────────────────────────────────────
var dragCounter = 0;
document.addEventListener('dragenter', function(e) {
  if (e.dataTransfer.types.indexOf('Files') >= 0) {
    dragCounter++;
    document.body.classList.add('drop-active');
  }
});
document.addEventListener('dragleave', function(e) {
  dragCounter--;
  if (dragCounter <= 0) { dragCounter = 0; document.body.classList.remove('drop-active'); }
});
document.addEventListener('dragover', function(e) {
  // Only intervene when an actual OS file is being dragged in. In-page
  // drags (directory reorder) have empty dataTransfer.types and use
  // 'move' effects via their own per-row handlers; setting 'copy' here
  // would clash with effectAllowed='move' and silently cancel the drop.
  if (!e.dataTransfer || (e.dataTransfer.types || []).indexOf('Files') < 0) return;
  e.preventDefault();
  e.dataTransfer.dropEffect = 'copy';
});

document.addEventListener('drop', async function(e) {
  // Same gating as the dragover above — leave in-page drops to the
  // dir-panel / per-entry handlers.
  if (!e.dataTransfer || (e.dataTransfer.types || []).indexOf('Files') < 0) return;
  e.preventDefault();
  dragCounter = 0;
  document.body.classList.remove('drop-active');
  var files = Array.from(e.dataTransfer.files);
  if (files.length === 0) return;

  // expandArchives reads each file once, transparently decompresses .gz,
  // and pops the picker for .zip — the result is a flat list of
  // { name, buffer } entries with the user's archive choices already
  // resolved. Everything below is the existing classify-by-extension
  // dispatch, just driven by pre-loaded buffers.
  var entries = await expandArchives(files);
  if (entries.length === 0) return;

  var diskExts = ['.d64', '.d71', '.d81', '.d80', '.d82', '.t64', '.tap', '.x64', '.g64', '.d1m', '.d2m', '.d4m', '.dnp'];
  var fileExts = ['.prg', '.seq', '.usr', '.rel', '.p00', '.s00', '.u00', '.r00', '.cvt', '.txt'];
  var archiveExts = ['.lnx'];
  var ramlinkExts = ['.rml', '.rl'];
  var diskEntries = [], importEntries = [], archiveEntries = [], ramlinkEntries = [];
  for (var i = 0; i < entries.length; i++) {
    var lname = entries[i].name.toLowerCase();
    var ext = lname.substring(lname.lastIndexOf('.'));
    if (ramlinkExts.indexOf(ext) >= 0) ramlinkEntries.push(entries[i]);
    else if (diskExts.indexOf(ext) >= 0) diskEntries.push(entries[i]);
    else if (archiveExts.indexOf(ext) >= 0) archiveEntries.push(entries[i]);
    else if (fileExts.indexOf(ext) >= 0) importEntries.push(entries[i]);
  }

  // Open disk images in new tabs
  if (diskEntries.length > 0) {
    saveActiveTab();
    for (var di = 0; di < diskEntries.length; di++) {
      try {
        var buf = diskEntries[di].buffer;
        var fname = diskEntries[di].name;
        clearRamLinkState();
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
        showModal('Error', ['Error reading ' + diskEntries[di].name + ': ' + err.message]);
      }
    }
    var info = parseCurrentDir(currentBuffer);
    renderDisk(info);
    renderTabs();
    updateMenuState();
  }

  // RAMLink containers: pop the partition picker for each, open the
  // chosen partition into a new tab. Sequential because the picker is
  // modal — one at a time avoids stacked dialogs.
  for (var ri = 0; ri < ramlinkEntries.length; ri++) {
    try {
      await openRamLinkAsTab(ramlinkEntries[ri].buffer, ramlinkEntries[ri].name);
    } catch (err) {
      showModal('Error', ['Failed to read RAMLink image ' + ramlinkEntries[ri].name + ': ' + (err && err.message ? err.message : err)]);
    }
  }

  // Archives (LNX): extract each one to a new D64 tab
  if (archiveEntries.length > 0) {
    saveActiveTab();
    for (var ai = 0; ai < archiveEntries.length; ai++) {
      try {
        clearRamLinkState();
        openLnxArchiveAsTab(archiveEntries[ai].buffer, archiveEntries[ai].name);
        addRecentDisk(archiveEntries[ai].name, archiveEntries[ai].buffer);
      } catch (err) {
        showModal('Error', ['Failed to read archive ' + archiveEntries[ai].name + ': ' + err.message]);
      }
    }
  }

  // Import PRG/SEQ/USR/REL/CVT files into current disk
  if (importEntries.length > 0 && currentBuffer) {
    var imported = 0, failed = 0;
    for (var ii = 0; ii < importEntries.length; ii++) {
      try {
        var ent = importEntries[ii];
        var iext = ent.name.substring(ent.name.lastIndexOf('.')).toLowerCase();
        if (iext === '.cvt') {
          await importCvtFile(ent.name, new Uint8Array(ent.buffer));
        } else {
          importFileToDisk(ent.name, new Uint8Array(ent.buffer));
          imported++;
        }
      } catch (err) {
        failed++;
      }
    }
    if (imported > 0) {
      var info2 = parseCurrentDir(currentBuffer);
      renderDisk(info2);
      showModal('Import Complete', [imported + ' file(s) imported.' + (failed > 0 ? ' ' + failed + ' failed.' : '')]);
    }
  } else if (importEntries.length > 0 && !currentBuffer) {
    showModal('Drop Error', ['No disk open to import files into. Open or create a disk first.']);
  }
});

// Make dir entries draggable to OS (export on drag)
document.addEventListener('dragstart', function(e) {
  var entry = e.target.closest('.dir-entry:not(.dir-header-row):not(.dir-parent-row)');
  if (!entry || !currentBuffer || !entry.dataset.offset) return;

  var entryOff = parseInt(entry.dataset.offset, 10);
  var data = new Uint8Array(currentBuffer);
  var typeByte = data[entryOff + 2];
  var typeIdx = typeByte & 0x07;
  if (typeIdx < 1 || typeIdx > 4 || !(typeByte & 0x80)) return;
  // GEOS VLIR: dir T/S is the index sector, not file data — use Export CVT
  if (isVlirFile(data, entryOff)) return;

  var result = readFileData(currentBuffer, entryOff);
  if (result.error || result.data.length === 0) return;

  var extMap = { 1: '.seq', 2: '.prg', 3: '.usr', 4: '.rel' };
  var ext = extMap[typeIdx] || '.prg';
  var name = petsciiToReadable(readPetsciiString(data, entryOff + 5, 16)).trim().replace(/[<>:"/\\|?*\x00-\x1F]/g, '_');
  if (!name) name = 'export';

  var blob = new Blob([result.data], { type: 'application/octet-stream' });
  var url = URL.createObjectURL(blob);

  // Set download data for drag to OS
  try {
    e.dataTransfer.setData('DownloadURL', 'application/octet-stream:' + name + ext + ':' + url);
  } catch (err) {
    // DownloadURL not supported in all browsers
  }
  e.dataTransfer.effectAllowed = 'copyMove';
});

// ── CMD FD Partition Picker ───────────────────────────────────────────
function showCmdFdPartitionPicker(buffer, fileName, formatName, forceDialog) {
  return new Promise(function(resolve) {
    var fdInfo = readCmdFdPartitions(buffer, formatName);
    if (!fdInfo || fdInfo.partitions.length === 0) {
      showModal('CMD Image', ['No partitions found in ' + fileName]);
      resolve(null);
      return;
    }

    // If only one non-system partition and not forced, auto-select it
    var userParts = fdInfo.partitions.filter(function(p) { return p.type !== 5; });
    if (userParts.length === 1 && !forceDialog) {
      var part = userParts[0];
      var extracted = extractCmdPartition(buffer, part);
      if (extracted) {
        resolve({ buffer: extracted, name: fileName + ' [' + part.name + ']', partOffset: part.startByte, partSize: part.sizeBytes });
      } else {
        showModal('CMD Image', ['Failed to extract partition "' + part.name + '"']);
        resolve(null);
      }
      return;
    }

    // Show picker modal
    document.getElementById('modal-title').textContent = fdInfo.format + ' \u2014 ' + fileName;
    var body = document.getElementById('modal-body');
    var html = '<div style="margin-bottom:12px;color:var(--text-muted);font-size:12px">' +
      fdInfo.partitions.length + ' partition(s) found. Select one to open:</div>';

    for (var i = 0; i < fdInfo.partitions.length; i++) {
      var p = fdInfo.partitions[i];
      if (p.type === 5) continue; // skip system partition
      var sizeKB = Math.round(p.sizeBytes / 1024);
      html += '<div class="search-result" data-pidx="' + i + '" style="cursor:pointer;padding:8px">' +
        '<b style="color:var(--accent)">' + escHtml(p.name) + '</b>' +
        ' <span style="color:var(--text-muted)">(' + p.typeName + ', ' + sizeKB + ' KB, ' +
        p.sizeBlocks + ' blocks)</span></div>';
    }

    body.innerHTML = html;

    var footer = document.querySelector('#modal-overlay .modal-footer');
    footer.innerHTML = '<button id="modal-close">Cancel</button>';
    document.getElementById('modal-close').addEventListener('click', function() {
      document.getElementById('modal-overlay').classList.remove('open');
      resolve(null);
    });

    // Click a partition to open it
    body.addEventListener('click', function handler(e) {
      var row = e.target.closest('[data-pidx]');
      if (!row) return;
      body.removeEventListener('click', handler);
      var idx = parseInt(row.getAttribute('data-pidx'), 10);
      var part = fdInfo.partitions[idx];
      var extracted = extractCmdPartition(buffer, part);
      document.getElementById('modal-overlay').classList.remove('open');
      if (extracted) {
        resolve({ buffer: extracted, name: fileName + ' [' + part.name + ']', partOffset: part.startByte, partSize: part.sizeBytes });
      } else {
        showModal('CMD Image', ['Failed to extract partition "' + part.name + '"']);
        resolve(null);
      }
    });

    document.getElementById('modal-overlay').classList.add('open');
  });
}

// RAMLink container loading + partition management lives in
// ui-ramlink.js (openRamLinkAsTab, addRamLinkPartition, etc.).

// ── Theme toggle ─────────────────────────────────────────────────────
const themeToggle = document.getElementById('theme-toggle');
const savedTheme = localStorage.getItem('cbm-theme');
if (savedTheme) document.documentElement.setAttribute('data-theme', savedTheme);

function updateThemeIcon() {
  const theme = document.documentElement.getAttribute('data-theme') === 'light' ? 'light' : 'dark';
  themeToggle.innerHTML = theme === 'dark' ? '<i class="fa-solid fa-sun"></i>' : '<i class="fa-solid fa-moon"></i>';
  // Sync the Options menu check marks too.
  var darkCheck = document.getElementById('check-theme-dark');
  var lightCheck = document.getElementById('check-theme-light');
  if (darkCheck)  darkCheck.innerHTML  = theme === 'dark'  ? '<i class="fa-solid fa-check"></i>' : '';
  if (lightCheck) lightCheck.innerHTML = theme === 'light' ? '<i class="fa-solid fa-check"></i>' : '';
}
function setTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  localStorage.setItem('cbm-theme', theme);
  updateThemeIcon();
}
updateThemeIcon();
// Restore check marks from saved settings
document.getElementById('check-deleted').innerHTML = showDeleted ? '<i class="fa-solid fa-check"></i>' : '';
document.getElementById('check-addr').innerHTML = showAddresses ? '<i class="fa-solid fa-check"></i>' : '';
document.getElementById('check-ts').innerHTML = showTrackSector ? '<i class="fa-solid fa-check"></i>' : '';
document.getElementById('opt-charset-mode').textContent = charsetMode === 'lowercase' ? 'Switch to Uppercase' : 'Switch to Lowercase';
document.getElementById('check-unsafe').innerHTML = allowUnsafeChars ? '<i class="fa-solid fa-check"></i>' : '';
document.getElementById('check-picker-all').innerHTML = pickerDefaultAll ? '<i class="fa-solid fa-check"></i>' : '';
document.getElementById('check-picker-stick').innerHTML = pickerStick ? '<i class="fa-solid fa-check"></i>' : '';

themeToggle.addEventListener('click', () => {
  const current = document.documentElement.getAttribute('data-theme');
  setTheme(current === 'dark' ? 'light' : 'dark');
});

// Same setting is reachable from Options → Theme → Dark / Light so
// users on narrow screens (where the icon is hidden by media query)
// can still switch. No stopPropagation: the document click handler
// runs after this and closes the menu, matching every other option.
document.getElementById('opt-theme-dark').addEventListener('click', function() {
  setTheme('dark');
});
document.getElementById('opt-theme-light').addEventListener('click', function() {
  setTheme('light');
});
