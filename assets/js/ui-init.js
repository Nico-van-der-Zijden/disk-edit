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
  e.preventDefault();
  e.dataTransfer.dropEffect = 'copy';
});

document.addEventListener('drop', function(e) {
  e.preventDefault();
  dragCounter = 0;
  document.body.classList.remove('drop-active');
  var files = Array.from(e.dataTransfer.files);
  if (files.length === 0) return;

  var diskExts = ['.d64', '.d71', '.d81', '.d80', '.d82', '.t64', '.tap', '.x64', '.g64', '.d1m', '.d2m', '.d4m', '.dnp'];
  var fileExts = ['.prg', '.seq', '.usr', '.rel', '.p00', '.s00', '.u00', '.r00', '.cvt', '.txt'];
  var diskFiles = [];
  var importFiles = [];

  for (var i = 0; i < files.length; i++) {
    var name = files[i].name.toLowerCase();
    var ext = name.substring(name.lastIndexOf('.'));
    if (diskExts.indexOf(ext) >= 0) diskFiles.push(files[i]);
    else if (fileExts.indexOf(ext) >= 0) importFiles.push(files[i]);
  }

  // Open disk images in new tabs
  if (diskFiles.length > 0) {
    function openDiskFile(file) {
      return new Promise(function(resolve, reject) {
        var reader = new FileReader();
        reader.onload = function() { resolve({ name: file.name, buffer: reader.result }); };
        reader.onerror = function() { reject(file.name); };
        reader.readAsArrayBuffer(file);
      });
    }
    Promise.all(diskFiles.map(openDiskFile)).then(async function(results) {
      saveActiveTab();
      for (var i = 0; i < results.length; i++) {
        try {
          var buf = results[i].buffer;
          var fname = results[i].name;

          currentBuffer = buf;
          currentFileName = fname;
          currentPartition = null;
          selectedEntryIndex = -1;
          parseDisk(currentBuffer);
          var tab = createTab(fname, currentBuffer, fname);
          activeTabId = tab.id;
        } catch (err) {
          showModal('Error', ['Error reading ' + results[i].name + ': ' + err.message]);
        }
      }
      var info = parseCurrentDir(currentBuffer);
      renderDisk(info);
      renderTabs();
      updateMenuState();
    });
  }

  // Import PRG/SEQ/USR/REL/CVT files into current disk
  if (importFiles.length > 0 && currentBuffer) {
    var imported = 0, failed = 0;
    function importNext(idx) {
      if (idx >= importFiles.length) {
        if (imported > 0) {
          var info = parseCurrentDir(currentBuffer);
          renderDisk(info);
          showModal('Import Complete', [imported + ' file(s) imported.' + (failed > 0 ? ' ' + failed + ' failed.' : '')]);
        }
        return;
      }
      var file = importFiles[idx];
      var reader = new FileReader();
      reader.onload = async function() {
        var ext = file.name.substring(file.name.lastIndexOf('.')).toLowerCase();
        if (ext === '.cvt') {
          // CVT import is async (confirmation dialog) and shows its own result
          await importCvtFile(file.name, new Uint8Array(reader.result));
          importNext(idx + 1);
          return;
        }
        importFileToDisk(file.name, new Uint8Array(reader.result));
        imported++;
        importNext(idx + 1);
      };
      reader.onerror = function() { failed++; importNext(idx + 1); };
      reader.readAsArrayBuffer(file);
    }
    importNext(0);
  } else if (importFiles.length > 0 && !currentBuffer) {
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

// ── Theme toggle ─────────────────────────────────────────────────────
const themeToggle = document.getElementById('theme-toggle');
const savedTheme = localStorage.getItem('cbm-theme');
if (savedTheme) document.documentElement.setAttribute('data-theme', savedTheme);

function updateThemeIcon() {
  const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
  themeToggle.innerHTML = isDark ? '<i class="fa-solid fa-sun"></i>' : '<i class="fa-solid fa-moon"></i>';
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
  const next = current === 'dark' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', next);
  localStorage.setItem('cbm-theme', next);
  updateThemeIcon();
});
