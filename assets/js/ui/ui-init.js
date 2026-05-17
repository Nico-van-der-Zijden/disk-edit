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

  const diskExts = ['.d64', '.d71', '.d81', '.d80', '.d82', '.t64', '.tap', '.x64', '.g64', '.dnp', '.nib', '.nb2'];
  const fileExts = ['.prg', '.seq', '.usr', '.rel', '.p00', '.s00', '.u00', '.r00', '.cvt', '.txt'];
  const archiveExts = ['.lnx'];
  const cmdcExts = ['.rml', '.rl', '.d1m', '.d2m', '.d4m', '.dhd'];
  const ide64Exts = ['.hdd'];
  var diskEntries = [], importEntries = [], archiveEntries = [], cmdcEntries = [], ide64Entries = [];
  for (var i = 0; i < entries.length; i++) {
    var lname = entries[i].name.toLowerCase();
    var ext = lname.substring(lname.lastIndexOf('.'));
    if (cmdcExts.indexOf(ext) >= 0) cmdcEntries.push(entries[i]);
    else if (ide64Exts.indexOf(ext) >= 0) ide64Entries.push(entries[i]);
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
        clearCmdContainerState();
        currentBuffer = buf;
        currentFileName = fname;
        currentPartition = null;
        selectedEntryIndex = -1;
        currentG64Layout = null;
        parseDisk(currentBuffer);
        // Use currentFileName (post-parseDisk) so a NIB rename to .g64
        // shows up in the tab title and survives a tab switch.
        var tab = createTab(currentFileName, currentBuffer, currentFileName);
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

  // CMD containers (RAMLink, FD2000/FD4000): each opens to its partition
  // list. Sequential because the partition-picker dialogs are modal —
  // one at a time avoids stacked dialogs.
  for (var ri = 0; ri < cmdcEntries.length; ri++) {
    try {
      await openCmdContainerAsTab(cmdcEntries[ri].buffer, cmdcEntries[ri].name);
    } catch (err) {
      showModal('Error', ['Failed to read container ' + cmdcEntries[ri].name + ': ' + (err && err.message ? err.message : err)]);
    }
  }

  // IDE64 .hdd containers — separate filesystem (CFS), separate parser.
  for (var ii64 = 0; ii64 < ide64Entries.length; ii64++) {
    try {
      openIde64AsTab(ide64Entries[ii64].buffer, ide64Entries[ii64].name);
    } catch (err) {
      showModal('Error', ['Failed to read IDE64 image ' + ide64Entries[ii64].name + ': ' + (err && err.message ? err.message : err)]);
    }
  }

  // Archives (LNX): extract each one to a new D64 tab
  if (archiveEntries.length > 0) {
    saveActiveTab();
    for (var ai = 0; ai < archiveEntries.length; ai++) {
      try {
        clearCmdContainerState();
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
    // CFS view: route each file through cfsImportFile (no GEOS .cvt
    // handling — CFS imports are plain file writes). Same dispatch
    // criteria as opt-import / the View Separators float.
    var inCfsImport = typeof cfsPartitionIdx !== 'undefined' && cfsPartitionIdx >= 0;
    var cfsImportPart = inCfsImport && hddPartitions ? hddPartitions[cfsPartitionIdx] : null;
    for (var ii = 0; ii < importEntries.length; ii++) {
      try {
        var ent = importEntries[ii];
        var iext = ent.name.substring(ent.name.lastIndexOf('.')).toLowerCase();
        if (inCfsImport && cfsImportPart) {
          // Reuse CBM-DOS's asciiToNameBytes via _cfsImportNameBytes so
          // dropped files name the same way as on a D64 (only "/" is
          // stripped — CFS treats it as the path separator).
          var baseName = _cfsImportNameBytes(ent.name);
          var extM = (ent.name.match(/\.([^.]+)$/) || [])[1] || 'PRG';
          extM = extM.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 3) || 'PRG';
          pushUndo();
          var cres = cfsImportFile(hddBuffer, cfsImportPart.startLba, cfsImportPart.endLba, cfsDirLba, baseName, new Uint8Array(ent.buffer), {
            ftype: CFS_FTYPE.NORMAL,
            typeSuffix: extM,
          });
          if (cres.ok) imported++;
          else { failed++; if (typeof popUndo === 'function') popUndo(); }
        } else if (iext === '.cvt') {
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
      if (inCfsImport) {
        refreshIde64View();
      } else {
        var info2 = parseCurrentDir(currentBuffer);
        renderDisk(info2);
      }
      showModal('Import Complete', [imported + ' file(s) imported.' + (failed > 0 ? ' ' + failed + ' failed.' : '')]);
    }
  } else if (importEntries.length > 0 && !currentBuffer) {
    showModal('Drop Error', ['No disk open to import files into. Open or create a disk first.']);
  }
});

// Make dir entries draggable to OS (export on drag)
document.addEventListener('dragstart', function(e) {
  var entry = e.target.closest('.dir-entry:not(.dir-header-row):not(.dir-parent-row)');
  if (!entry) return;

  // Helper: turn one .dir-entry row into { name, ext, data } or null.
  // Centralises the CFS vs CBM-DOS read paths so the multi-drag branch
  // below can build a payload list and the single-drag branch reuses
  // the same logic.
  function buildPayloadFromRow(row) {
    if (row.dataset.cfsEntry !== undefined && typeof cfsPartitionIdx !== 'undefined' && cfsPartitionIdx >= 0 && cfsDirEntries) {
      var ce = cfsDirEntries[parseInt(row.dataset.cfsEntry, 10)];
      if (!ce || ce.empty) return null;
      if (ce.ftype === CFS_FTYPE.DIR || ce.ftype === CFS_FTYPE.LNK || ce.ftype === CFS_FTYPE.DEL) return null;
      if (!ce.dataTreePtr || !ce.dataTreePtr.lba) return null;
      var cRes = readCfsFileData(hddBuffer, ce.dataTreePtr.addr, ce.size);
      if (cRes.error || !cRes.data || cRes.data.length === 0) return null;
      var cName = petsciiToReadable(ce.name).trim().replace(/[<>:"/\\|?*\x00-\x1F]/g, '_');
      return {
        name: cName || 'export',
        ext: '.' + (ce.typeSuffix || 'PRG').toLowerCase(),
        data: cRes.data,
      };
    }
    if (currentBuffer && row.dataset.offset) {
      var entryOff = parseInt(row.dataset.offset, 10);
      var data = new Uint8Array(currentBuffer);
      var typeByte = data[entryOff + 2];
      var typeIdx = typeByte & 0x07;
      if (typeIdx < 1 || typeIdx > 4 || !(typeByte & 0x80)) return null;
      if (isVlirFile(data, entryOff)) return null; // GEOS VLIR needs Export CVT
      var result = readFileData(currentBuffer, entryOff);
      if (result.error || result.data.length === 0) return null;
      var extMap = { 1: '.seq', 2: '.prg', 3: '.usr', 4: '.rel' };
      var rName = petsciiToReadable(readPetsciiString(data, entryOff + 5, 16)).trim().replace(/[<>:"/\\|?*\x00-\x1F]/g, '_');
      return {
        name: rName || 'export',
        ext: extMap[typeIdx] || '.prg',
        data: result.data,
      };
    }
    return null;
  }

  var primary = buildPayloadFromRow(entry);
  if (!primary) return;

  // Set DownloadURL on the drag — this is what lets the user drop onto
  // a folder window and get the file there. HTML5's DownloadURL is
  // single-file by design, so the dragged row is the one that lands at
  // the drop target.
  var primaryBlob = new Blob([primary.data], { type: 'application/octet-stream' });
  var primaryUrl = URL.createObjectURL(primaryBlob);
  try {
    e.dataTransfer.setData('DownloadURL', 'application/octet-stream:' + primary.name + primary.ext + ':' + primaryUrl);
  } catch (err) {
    // DownloadURL not supported in all browsers
  }
  e.dataTransfer.effectAllowed = 'copyMove';
  // Multi-select drag only exports the dragged row. HTML5's DownloadURL
  // protocol is single-file per event, and any side-channel download
  // (a.click() on the other selected rows) bypasses the drop target —
  // those files land in the OS Downloads folder regardless of where
  // the user is dragging. For multi-file export, use File → Export
  // File from the menu / context menu instead.
});

// CMD container loading + partition management lives in
// ui-cmd.js (openCmdContainerAsTab, addCmdContainerPartition, etc.).

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
document.getElementById('check-picker-all').innerHTML = petsciiPicker.defaultAll ? '<i class="fa-solid fa-check"></i>' : '';
document.getElementById('check-picker-stick').innerHTML = petsciiPicker.stick ? '<i class="fa-solid fa-check"></i>' : '';
refreshHexColoringChecks();
document.getElementById('check-toolbar').innerHTML = toolbarVisible ? '<i class="fa-solid fa-check"></i>' : '';
document.getElementById('check-partition-size-mib').innerHTML = partitionSizeInMib ? '<i class="fa-solid fa-check"></i>' : '';
applyToolbarVisibility();
refreshToolbarState();

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
