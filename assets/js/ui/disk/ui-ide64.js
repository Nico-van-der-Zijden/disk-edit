// ── IDE64 .hdd partition list (Phase 1, read-only) ────────────────────
//
// Mirrors the CMD container UI in ui-cmd.js: opening a .hdd creates a tab
// showing the disk label + 16 partition slots. Double-click currently
// shows a "not yet supported" modal — entering CFS partitions is Phase 2.
//
// State globals (hddBuffer, hddPartitions, hddBootInfo) are persisted on
// the active tab so switching tabs and coming back keeps the view.

function isIde64ContainerView() {
  return !!hddBuffer && !!hddPartitions;
}

function clearIde64State() {
  hddBuffer = null;
  hddFileName = null;
  hddBootInfo = null;
  hddPartitions = null;
}

function openIde64AsTab(buffer, fileName) {
  if (!buffer) return;
  var info = readIde64Partitions(buffer);
  saveActiveTab();
  clearCmdContainerState();
  clearIde64State();

  if (!info) {
    showModal('IDE64 HDD', [
      'Could not parse the partition table in ' + fileName + '.',
      'The boot-sector magic is present but the partition directory pointer is missing or invalid.',
    ]);
    return;
  }

  hddBuffer = buffer;
  hddFileName = fileName;
  hddBootInfo = info;
  hddPartitions = info.partitions;
  currentBuffer = buffer;
  currentFileName = fileName;
  currentFormat = DISK_FORMATS.hdd;
  currentTracks = 0;
  currentPartition = null;
  selectedEntryIndex = -1;

  var tab = createTab(fileName, buffer, fileName);
  activeTabId = tab.id;
  tabDirty = false;
  clearUndo();
  addRecentDisk(fileName, buffer);

  refreshIde64View();
}

function refreshIde64View() {
  renderIde64PartitionList();
  renderTabs();
  updateMenuState();
  updateEntryMenuState();
}

function renderIde64PartitionList() {
  if (!hddPartitions || !hddBootInfo) return;

  var content = document.getElementById('content');
  var label = hddBootInfo.label || 'IDE64';
  var defaultPart = hddBootInfo.defaultPart;

  var html = '<div class="disk-panel">' +
    '<div class="disk-header">' +
      '<div class="disk-header-spacer"><i class="fa-solid fa-hard-drive" title="IDE64 hard-disk image"></i></div>' +
      '<div class="disk-name">' + escHtml(hddFileName || label) + '</div>' +
      '<div class="disk-id">IDE64</div>' +
    '</div>' +
    '<div class="dir-entry dir-header-row">' +
      '<span class="dir-grip"></span>' +
      '<span class="dir-blocks">Size</span>' +
      '<span class="dir-name">Partition</span>' +
      '<span class="dir-type">Type</span>' +
      '<span class="dir-slot">#</span>' +
      '<span class="dir-ts">Start LBA</span>' +
      '<span class="dir-addr">Flags</span>' +
      '<span class="dir-icons"></span>' +
    '</div>' +
    '<div class="dir-listing">';

  var openCount = 0;
  for (var i = 0; i < hddPartitions.length; i++) {
    var p = hddPartitions[i];
    var enterable = p.type === 0x01; // CFS — others not supported yet
    if (!p.empty) openCount++;

    var sizeBlocks = '';
    var sizeLabel = '';
    if (p.sizeSectors !== null && !p.empty) {
      // Each CFS sector = 512 B = 2 CBM blocks; show CBM-block count to
      // match the convention used elsewhere in the editor.
      sizeBlocks = (p.sizeSectors * 2).toString();
      var mib = p.sizeBytes / (1024 * 1024);
      sizeLabel = mib >= 1
        ? mib.toFixed(mib < 10 ? 2 : 1) + ' MiB'
        : (p.sizeBytes / 1024).toFixed(1) + ' KiB';
    }

    var startHex = p.startLba !== null
      ? '$' + p.startLba.toString(16).toUpperCase().padStart(8, '0')
      : '(CHS)';

    var flagBits = [];
    if (!p.empty) {
      if (p.hidden) flagBits.push('H');
      if (p.writeable) flagBits.push('W');
      if (p.lba) flagBits.push('L');
      if (i === defaultPart) flagBits.push('*');
    }
    var flagStr = flagBits.join('');

    var nameDisplay = p.empty
      ? '(empty)'
      : (p.name || ('Partition ' + i));

    var extraCls = p.empty ? ' deleted' : (enterable ? '' : ' disabled-row');
    var rowTitle = p.empty
      ? 'Slot ' + i + ' — empty'
      : (p.typeName + (sizeLabel ? ' — ' + sizeLabel : '') +
         (i === defaultPart ? ' — default partition' : '') +
         (enterable ? '' : ' — entering this partition type is not yet supported'));

    html +=
      '<div class="dir-entry' + extraCls + '" data-hdd-part="' + i + '" title="' + escHtml(rowTitle) + '">' +
        '<span class="dir-grip"></span>' +
        '<span class="dir-blocks">' + sizeBlocks + '</span>' +
        '<span class="dir-name">"' + escHtml(nameDisplay) + '"</span>' +
        '<span class="dir-type">' + escHtml(p.typeName) + '</span>' +
        '<span class="dir-slot">' + p.index + '</span>' +
        '<span class="dir-ts">' + startHex + '</span>' +
        '<span class="dir-addr">' + escHtml(flagStr) + '</span>' +
        '<span class="dir-icons"></span>' +
      '</div>';
  }

  html += '</div>' +
    '<div class="dir-footer"><div class="dir-footer-row">' +
      '<span class="dir-footer-blocks">' + openCount + '</span>' +
      '<span class="dir-footer-label">partition(s).</span>' +
      '<span class="dir-footer-tracks">IDE64 container</span>' +
    '</div></div>' +
  '</div>';
  content.innerHTML = html;

  content.querySelectorAll('.dir-entry[data-hdd-part]').forEach(function(row) {
    var idx = parseInt(row.dataset.hddPart, 10);
    row.addEventListener('click', function() {
      content.querySelectorAll('.dir-entry.selected').forEach(function(el) { el.classList.remove('selected'); });
      row.classList.add('selected');
      updateEntryMenuState();
    });
    row.addEventListener('dblclick', function() {
      var p = hddPartitions[idx];
      if (!p || p.empty) return;
      if (p.type === 0x01) {
        showModal('CFS partition', [
          'Entering "' + (p.name || ('Partition ' + idx)) + '" is not yet supported.',
          'Phase 2 will add a CFS directory reader. For now the container view shows what\'s on the disk.',
        ]);
      } else {
        showModal(p.typeName + ' partition', [
          '"' + (p.name || ('Partition ' + idx)) + '" is a ' + p.typeName + ' partition.',
          'Only CFS partitions are planned for the editor; other types stay informational.',
        ]);
      }
    });
  });

  selectedEntryIndex = -1;
  selectedEntries = [];
  updateEntryMenuState();
}
