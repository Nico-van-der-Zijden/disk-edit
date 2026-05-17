// ── Open in emulator (c64.sannic.nl) ─────────────────────────────────
// Opens a new tab pointing at the VICE/EmulatorJS host, then hands the
// current disk or PRG over via postMessage. The receiver page wraps the
// bytes in a Blob URL and boots EmulatorJS's vice_x64sc core.
//
// Handshake:
//   c64.sannic.nl posts { type: 'cbm-disk-editor:ready' } to opener on load.
//   We reply with    { type: 'cbm-disk-editor:open-file', payload: {name, bytes} }.
//   They ack with    { type: 'cbm-disk-editor:ack', payload: {name, size} }.

var EMULATOR_URL = 'https://c64.sannic.nl/';
var EMULATOR_ORIGIN = 'https://c64.sannic.nl';
var EMULATOR_HANDSHAKE_TIMEOUT_MS = 15000;

function openInEmulator(bytes, suggestedName) {
  if (!bytes) return;
  var u8 = bytes instanceof Uint8Array
    ? bytes
    : bytes instanceof ArrayBuffer ? new Uint8Array(bytes) : null;
  if (!u8 || u8.byteLength === 0) {
    if (typeof showModal === 'function') {
      showModal('Open in Emulator', ['No data to send.']);
    }
    return;
  }

  var win = window.open(EMULATOR_URL, '_blank', 'noopener=false');
  if (!win) {
    if (typeof showModal === 'function') {
      showModal('Open in Emulator',
        ['Browser blocked the popup. Allow popups for this site and try again.']);
    }
    return;
  }

  var settled = false;
  function cleanup() {
    settled = true;
    window.removeEventListener('message', onMessage);
  }

  function onMessage(event) {
    if (event.origin !== EMULATOR_ORIGIN) return;
    if (event.source !== win) return;
    var msg = event.data;
    if (!msg || typeof msg.type !== 'string') return;
    if (msg.type === 'cbm-disk-editor:ready') {
      try {
        win.postMessage({
          type: 'cbm-disk-editor:open-file',
          payload: { name: suggestedName || 'disk.d64', bytes: u8 },
        }, EMULATOR_ORIGIN, [u8.buffer]);
      } catch (err) {
        // Transferable failed (e.g. shared buffer) — retry without transfer
        win.postMessage({
          type: 'cbm-disk-editor:open-file',
          payload: { name: suggestedName || 'disk.d64', bytes: u8 },
        }, EMULATOR_ORIGIN);
      }
    } else if (msg.type === 'cbm-disk-editor:ack') {
      cleanup();
    }
  }
  window.addEventListener('message', onMessage);

  setTimeout(function() {
    if (settled) return;
    cleanup();
    if (typeof showModal === 'function') {
      showModal('Open in Emulator',
        ['The emulator page did not respond. Make sure ' + EMULATOR_URL + ' loaded correctly.']);
    }
  }, EMULATOR_HANDSHAKE_TIMEOUT_MS);
}

// ── Disk menu: Open in Emulator ───────────────────────────────────────
document.getElementById('opt-open-in-emulator').addEventListener('click', function(e) {
  e.stopPropagation();
  if (!currentBuffer) return;
  openInEmulator(new Uint8Array(currentBuffer.slice(0)), getSaveFileName() || 'disk.d64');
  closeMenus();
});

// ── File menu: Run in Emulator (selected PRG) ─────────────────────────
document.getElementById('opt-run-in-emulator').addEventListener('click', function(e) {
  e.stopPropagation();
  if (selectedEntryIndex < 0) return;

  // CFS view: read via the B-tree walker (selectedEntryIndex is a slot
  // index into cfsDirEntries, not a CBM-DOS byte offset).
  if (cfsPartitionIdx >= 0 && cfsDirEntries) {
    var cfsEntry = cfsDirEntries[selectedEntryIndex];
    if (!cfsEntry || cfsEntry.empty) return;
    if (cfsEntry.ftype === CFS_FTYPE.DIR ||
        cfsEntry.ftype === CFS_FTYPE.LNK ||
        cfsEntry.ftype === CFS_FTYPE.DEL) return;
    var pl = (typeof cfsLoadFileForViewer === 'function') ? cfsLoadFileForViewer(cfsEntry) : null;
    if (!pl || !pl.data || pl.data.length === 0 || pl.error) {
      if (typeof showModal === 'function') {
        showModal('Run in Emulator', [
          'Could not read this file.',
          (pl && pl.error) || 'File data unreadable.',
        ]);
      }
      return;
    }
    openInEmulator(pl.data, (pl.name || 'program').trim() + '.prg');
    closeMenus();
    return;
  }

  if (!currentBuffer) return;
  var name;
  if (isTapeFormat()) {
    var tapeEntry = getTapeEntry(selectedEntryIndex);
    name = (tapeEntry && tapeEntry.name ? tapeEntry.name : 'program').trim() + '.prg';
  } else {
    var data = new Uint8Array(currentBuffer);
    name = petsciiToReadable(readPetsciiString(data, selectedEntryIndex + 5, 16)).trim() + '.prg';
  }

  var result = readFileData(currentBuffer, selectedEntryIndex);
  if (result.error || !result.data || result.data.length === 0) {
    if (typeof showModal === 'function') {
      showModal('Run in Emulator', [
        'Could not read this file.',
        result.error || 'File may have been overwritten (unscratch only restores the directory entry, not the data).',
      ]);
    }
    return;
  }
  openInEmulator(result.data, name);
  closeMenus();
});
