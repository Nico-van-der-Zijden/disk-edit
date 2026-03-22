<!DOCTYPE html>
<html lang="en" data-theme="dark">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta http-equiv="X-UA-Compatible" content="IE=edge">
<title>D64 Disk Viewer</title>
<style>
  :root {
    --bg: #1e1e2e;
    --bg-menu: #2a2a3c;
    --bg-panel: #262637;
    --text: #cdd6f4;
    --text-muted: #6c7086;
    --border: #45475a;
    --accent: #89b4fa;
    --hover: #363648;
    --menu-hover: #3a3a4e;
    --placeholder-bg: #2e2e40;
    --hover-edit: #40405a;
  }

  [data-theme="light"] {
    --bg: #eff1f5;
    --bg-menu: #dce0e8;
    --bg-panel: #e6e9ef;
    --text: #4c4f69;
    --text-muted: #8c8fa1;
    --border: #bcc0cc;
    --accent: #1e66f5;
    --hover: #ccd0da;
    --menu-hover: #c5c9d5;
    --placeholder-bg: #d0d4de;
    --hover-edit: #b8bcc8;
  }

  * { margin: 0; padding: 0; box-sizing: border-box; -webkit-user-modify: unset; }

  ::selection { background: var(--accent); color: var(--bg); }

  body {
    font-family: "Cascadia Code", "Fira Code", "JetBrains Mono", "Consolas", "Courier New", monospace;
    background: var(--bg);
    color: var(--text);
    min-height: 100vh;
    -ms-content-zooming: none;
  }

  body, .menubar, .dir-listing, .dir-entry, .disk-header, .dir-footer {
    -webkit-user-select: none;
    user-select: none;
  }

  .editable, .dir-name.editing {
    -webkit-user-select: text;
    user-select: text;
  }

  /* --- Menu Bar --- */
  .menubar {
    display: flex;
    align-items: center;
    background: var(--bg-menu);
    border-bottom: 1px solid var(--border);
    height: 32px;
    padding: 0 4px;
    user-select: none;
    font-size: 13px;
  }

  .menu-item {
    position: relative;
    padding: 4px 10px;
    cursor: pointer;
    border-radius: 4px;
  }

  .menu-item:hover,
  .menu-item.open {
    background: var(--menu-hover);
  }

  .menu-dropdown {
    display: none;
    position: absolute;
    top: 100%;
    left: 0;
    background: var(--bg-menu);
    border: 1px solid var(--border);
    border-radius: 6px;
    padding: 4px 0;
    min-width: 160px;
    z-index: 100;
    box-shadow: 0 4px 16px rgba(0,0,0,.25);
  }

  .menu-item.open .menu-dropdown {
    display: block;
  }

  .menu-dropdown .option {
    padding: 6px 12px 6px 28px;
    cursor: pointer;
    white-space: nowrap;
    position: relative;
  }

  .menu-dropdown .option .check {
    position: absolute;
    left: 10px;
    top: 50%;
    transform: translateY(-50%);
  }

  .has-submenu::after {
    content: '\25B8';
    position: absolute;
    right: 10px;
    top: 50%;
    transform: translateY(-50%);
  }

  .submenu {
    display: none;
    position: absolute;
    left: 100%;
    top: -4px;
    background: var(--bg-menu);
    border: 1px solid var(--border);
    border-radius: 6px;
    padding: 4px 0;
    min-width: 180px;
    box-shadow: 0 4px 16px rgba(0,0,0,.25);
  }

  .has-submenu:not(.disabled):hover > .submenu {
    display: block;
  }

  .menu-dropdown .option:hover:not(.disabled) {
    background: var(--hover);
  }

  .menu-dropdown .option.disabled {
    color: var(--text-muted);
    cursor: default;
    opacity: 0.5;
  }

  .menu-dropdown .separator {
    height: 1px;
    background: var(--border);
    margin: 4px 0;
  }

  .spacer { flex: 1; }

  .theme-toggle {
    padding: 4px 10px;
    cursor: pointer;
    border-radius: 4px;
    font-size: 13px;
  }
  .theme-toggle:hover { background: var(--menu-hover); }

  /* --- Content --- */
  .content {
    max-width: 720px;
    margin: 0 auto;
    padding: 24px 16px;
  }

  .empty-state {
    text-align: center;
    color: var(--text-muted);
    margin-top: 120px;
    font-size: 14px;
    line-height: 2;
  }

  /* --- Disk Panel --- */
  .disk-panel {
    display: flex;
    flex-direction: column;
    max-height: calc(100vh - 80px);
  }

  /* --- Disk Header --- */
  .disk-header {
    display: flex;
    gap: 8px;
    align-items: center;
    padding: 14px 16px;
    background: var(--bg-menu);
    border: 1px solid var(--border);
    border-radius: 6px 6px 0 0;
    flex-shrink: 0;
  }

  .disk-header-spacer {
    width: 48px;
    flex-shrink: 0;
  }

  .disk-name {
    flex: 1;
    font-size: 16px;
    color: var(--accent);
    letter-spacing: 1px;
    white-space: pre;
  }

  .disk-name .editable,
  .disk-id .editable {
    display: inline-block;
    padding: 2px 4px;
    border-radius: 3px;
    cursor: pointer;
  }

  .disk-name .editable {
    min-width: 16ch;
  }

  .disk-id .editable {
    min-width: 5ch;
  }

  .disk-name .editable.empty,
  .disk-id .editable.empty {
    background: var(--placeholder-bg);
    min-height: 1.4em;
  }

  .disk-name .editable:hover,
  .disk-id .editable:hover {
    background: var(--hover-edit);
  }

  .disk-name .editable.editing,
  .disk-id .editable.editing {
    background: var(--bg);
    outline: 1px solid var(--accent);
    cursor: text;
  }

  .disk-id {
    width: 5ch;
    font-size: 14px;
    color: var(--text-muted);
    text-align: left;
    flex-shrink: 0;
  }

  /* --- Directory Listing --- */
  .dir-listing {
    font-size: 14px;
    line-height: 1.7;
    overflow-y: auto;
    flex: 1;
    min-height: 0;
    padding: 8px 0;
    border-left: 1px solid var(--border);
    border-right: 1px solid var(--border);
  }

  .dir-entry {
    display: flex;
    gap: 8px;
    padding: 2px 16px;
  }

  .dir-entry {
    cursor: pointer;
  }

  .dir-entry:hover {
    background: var(--hover);
  }

  .dir-entry.selected {
    background: var(--accent);
    color: var(--bg);
  }

  .dir-entry.selected .dir-blocks,
  .dir-entry.selected .dir-type {
    color: var(--bg);
  }

  .dir-blocks {
    width: 48px;
    text-align: right;
    color: var(--text-muted);
    flex-shrink: 0;
  }

  .dir-name {
    flex: 1;
    white-space: pre;
  }

  .dir-name.editing {
    background: var(--bg);
    outline: 1px solid var(--accent);
    border-radius: 3px;
    padding: 0 4px;
    white-space: pre;
    color: var(--text);
  }

  .dir-type {
    width: 5ch;
    text-align: left;
    color: var(--text-muted);
    flex-shrink: 0;
    white-space: pre;
    position: relative;
  }

  .type-dropdown {
    position: fixed;
    background: var(--bg-menu);
    border: 1px solid var(--border);
    border-radius: 6px;
    padding: 4px 0;
    min-width: 80px;
    z-index: 200;
    box-shadow: 0 4px 16px rgba(0,0,0,.25);
  }

  .type-dropdown .type-option {
    padding: 4px 10px 4px 26px;
    cursor: pointer;
    white-space: nowrap;
    position: relative;
    color: var(--text);
  }

  .type-dropdown .type-option .check {
    position: absolute;
    left: 8px;
    top: 50%;
    transform: translateY(-50%);
  }

  .type-dropdown .type-option:hover {
    background: var(--hover);
  }

  .dir-footer {
    display: flex;
    gap: 8px;
    padding: 10px 16px;
    background: var(--bg-menu);
    border: 1px solid var(--border);
    border-top: none;
    border-radius: 0 0 6px 6px;
    color: var(--text-muted);
    font-size: 13px;
    flex-shrink: 0;
  }

  .dir-footer-blocks {
    width: 48px;
    text-align: right;
    flex-shrink: 0;
  }

  .dir-footer-label {
    flex: 1;
  }

  .dir-entry.deleted {
    opacity: 0.5;
  }

  /* Hidden file input */
  #file-input { display: none; }

  /* --- Modal --- */
  .modal-overlay {
    display: none;
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, .5);
    z-index: 200;
    align-items: center;
    justify-content: center;
  }

  .modal-overlay.open {
    display: flex;
  }

  .modal {
    background: var(--bg-menu);
    border: 1px solid var(--border);
    border-radius: 8px;
    width: 460px;
    max-width: 90vw;
    max-height: 70vh;
    display: flex;
    flex-direction: column;
    box-shadow: 0 8px 32px rgba(0, 0, 0, .4);
  }

  .modal-title {
    padding: 14px 16px;
    font-size: 14px;
    font-weight: bold;
    border-bottom: 1px solid var(--border);
    flex-shrink: 0;
  }

  .modal-body {
    padding: 16px;
    overflow-y: auto;
    flex: 1;
    min-height: 0;
    font-size: 13px;
    line-height: 1.7;
  }

  .modal-body ul {
    list-style: disc;
    padding-left: 20px;
    margin: 0;
  }

  .modal-body ul li {
    padding: 1px 0;
  }

  .modal-body .log-error {
    color: #f38ba8;
  }

  [data-theme="light"] .modal-body .log-error {
    color: #d20f39;
  }

  .modal-body .log-warning {
    color: #fab387;
  }

  [data-theme="light"] .modal-body .log-warning {
    color: #df8e1d;
  }

  .modal-footer {
    padding: 10px 16px;
    border-top: 1px solid var(--border);
    text-align: right;
    flex-shrink: 0;
  }

  .modal-footer button {
    font-family: inherit;
    font-size: 13px;
    padding: 6px 20px;
    border: 1px solid var(--border);
    border-radius: 4px;
    background: var(--hover);
    color: var(--text);
    cursor: pointer;
  }

  .modal-footer button:hover {
    background: var(--menu-hover);
  }
</style>
</head>
<body>

<div class="menubar">
  <div class="menu-item" id="menu-file">
    Disk
    <div class="menu-dropdown">
      <div class="option" id="opt-new">New</div>
      <div class="option" id="opt-open">Open...</div>
      <div class="option disabled" id="opt-close">Close</div>
      <div class="separator"></div>
      <div class="option disabled" id="opt-save">Save</div>
      <div class="option disabled" id="opt-save-as">Save As...</div>
      <div class="separator"></div>
      <div class="option disabled" id="opt-validate">Validate</div>
      <div class="option disabled" id="opt-show-deleted"><span class="check" id="check-deleted">&#10003;</span>Show Deleted Files</div>
      <div class="option disabled has-submenu" id="opt-sort">Sort
        <div class="submenu">
          <div class="option" data-sort="name-asc">Name Ascending</div>
          <div class="option" data-sort="name-desc">Name Descending</div>
          <div class="separator"></div>
          <div class="option" data-sort="blocks-asc">Blocks Ascending</div>
          <div class="option" data-sort="blocks-desc">Blocks Descending</div>
        </div>
      </div>
    </div>
  </div>
  <div class="menu-item" id="menu-entry">
    File
    <div class="menu-dropdown">
      <div class="option disabled" id="opt-rename">Rename</div>
      <div class="separator"></div>
      <div class="option disabled" id="opt-lock">Lock File</div>
      <div class="option disabled" id="opt-splat">Scratch File</div>
      <div class="option disabled has-submenu" id="opt-change-type">File Type
        <div class="submenu">
          <div class="option" data-typeidx="0"><span class="check" id="check-type-0"></span>DEL</div>
          <div class="option" data-typeidx="1"><span class="check" id="check-type-1"></span>SEQ</div>
          <div class="option" data-typeidx="2"><span class="check" id="check-type-2"></span>PRG</div>
          <div class="option" data-typeidx="3"><span class="check" id="check-type-3"></span>USR</div>
          <div class="option" data-typeidx="4"><span class="check" id="check-type-4"></span>REL</div>
        </div>
      </div>
    </div>
  </div>
  <div class="spacer"></div>
  <div class="theme-toggle" id="theme-toggle" title="Toggle theme"></div>
</div>

<input type="file" id="file-input" accept=".d64">

<div class="content" id="content">
  <div class="empty-state">
    No disk loaded.<br>
    Use File &gt; New to create an empty disk,<br>
    or File &gt; Open to load a .d64 file.
  </div>
</div>

<div class="modal-overlay" id="modal-overlay">
  <div class="modal">
    <div class="modal-title" id="modal-title"></div>
    <div class="modal-body" id="modal-body"></div>
    <div class="modal-footer">
      <button id="modal-close">OK</button>
    </div>
  </div>
</div>

<script>
// ── Modal ─────────────────────────────────────────────────────────────
function showModal(title, lines) {
  document.getElementById('modal-title').textContent = title;
  const body = document.getElementById('modal-body');
  body.innerHTML = '';
  const isSummary = l => l.startsWith('Validation complete') || l.startsWith('Disk is valid');
  const details = lines.filter(l => !isSummary(l));
  const summary = lines.filter(l => isSummary(l));

  if (details.length) {
    const ul = document.createElement('ul');
    for (const line of details) {
      const li = document.createElement('li');
      li.textContent = line.replace(/^\s+/, '');
      if (line.includes('ERROR') || line.includes('corrected') || line.startsWith('Removed')) li.className = 'log-error';
      else if (line.includes('Warning')) li.className = 'log-warning';
      ul.appendChild(li);
    }
    body.appendChild(ul);
  }

  for (const line of summary) {
    const div = document.createElement('div');
    div.textContent = line;
    div.style.marginTop = '12px';
    body.appendChild(div);
  }
  document.getElementById('modal-overlay').classList.add('open');
}

document.getElementById('modal-close').addEventListener('click', () => {
  document.getElementById('modal-overlay').classList.remove('open');
});

document.getElementById('modal-overlay').addEventListener('click', (e) => {
  if (e.target === e.currentTarget) {
    document.getElementById('modal-overlay').classList.remove('open');
  }
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && document.getElementById('modal-overlay').classList.contains('open')) {
    document.getElementById('modal-overlay').classList.remove('open');
  }
});

// ── Disable Edge/browser mini menu and context menu ───────────────────
document.addEventListener('contextmenu', e => e.preventDefault());
document.addEventListener('selectstart', e => {
  if (!e.target.isContentEditable) e.preventDefault();
});
if (navigator.userAgent.includes('Edg')) {
  document.addEventListener('pointerup', e => {
    const sel = window.getSelection();
    if (sel && !e.target.isContentEditable) sel.removeAllRanges();
  });
}

// ── D64 Format Constants ──────────────────────────────────────────────
const TRACK_OFFSETS = (() => {
  // Precompute byte offset for each track (1-indexed)
  const sectorsPerTrack = t => {
    if (t <= 17) return 21;
    if (t <= 24) return 19;
    if (t <= 30) return 18;
    return 17;
  };
  const offsets = [0]; // index 0 unused
  let offset = 0;
  for (let t = 1; t <= 40; t++) {
    offsets.push(offset);
    offset += sectorsPerTrack(t) * 256;
  }
  return offsets;
})();

function sectorOffset(track, sector) {
  const sectorsPerTrack = t => {
    if (t <= 17) return 21;
    if (t <= 24) return 19;
    if (t <= 30) return 18;
    return 17;
  };
  if (track < 1 || track > 35) return -1;
  if (sector < 0 || sector >= sectorsPerTrack(track)) return -1;
  return TRACK_OFFSETS[track] + sector * 256;
}

// ── PETSCII → Unicode (screen-friendly subset) ───────────────────────
function petsciiToAscii(byte) {
  if (byte === 0xA0) return ' ';  // shifted space (padding)
  if (byte >= 0x41 && byte <= 0x5A) return String.fromCharCode(byte + 32); // A-Z → a-z
  if (byte >= 0xC1 && byte <= 0xDA) return String.fromCharCode(byte - 0xC1 + 65); // → A-Z
  if (byte >= 0x20 && byte <= 0x7E) return String.fromCharCode(byte);
  return '.';
}

function readPetsciiString(data, offset, len) {
  let s = '';
  for (let i = 0; i < len; i++) {
    const b = data[offset + i];
    if (b === 0xA0 && s.length > 0) break; // padding
    s += petsciiToAscii(b);
  }
  return s;
}

// ── File type names ──────────────────────────────────────────────────
const FILE_TYPES = ['DEL', 'SEQ', 'PRG', 'USR', 'REL'];

function fileTypeName(typeByte) {
  const closed = (typeByte & 0x80) !== 0;
  const locked = (typeByte & 0x40) !== 0;
  const idx = typeByte & 0x07;
  const base = FILE_TYPES[idx] || '???';
  const prefix = closed ? ' ' : '*';
  const suffix = locked ? '<' : ' ';
  return prefix + base + suffix;
}

// ── Parse D64 ────────────────────────────────────────────────────────
function parseD64(buffer) {
  const data = new Uint8Array(buffer);
  if (data.length < 174848) throw new Error('File too small to be a valid .d64');

  // BAM is at track 18, sector 0
  const bamOffset = sectorOffset(18, 0);

  const diskName = readPetsciiString(data, bamOffset + 0x90, 16);
  const diskId = readPetsciiString(data, bamOffset + 0xA2, 5);

  // Count free blocks from BAM (tracks 1-35, skip track 18)
  let freeBlocks = 0;
  for (let t = 1; t <= 35; t++) {
    if (t === 18) continue; // directory track
    freeBlocks += data[bamOffset + 4 * t];
  }

  // Read directory chain starting at track 18, sector 1
  const entries = [];
  let dirTrack = 18;
  let dirSector = 1;
  const visited = new Set();

  while (dirTrack !== 0) {
    const key = `${dirTrack}:${dirSector}`;
    if (visited.has(key)) break;
    visited.add(key);

    const off = sectorOffset(dirTrack, dirSector);
    if (off < 0) break;

    for (let i = 0; i < 8; i++) {
      const entryOff = off + i * 32;
      const typeByte = data[entryOff + 2];

      const name = readPetsciiString(data, entryOff + 5, 16);
      if (!name.trim()) continue;

      const blocks = data[entryOff + 30] | (data[entryOff + 31] << 8);
      const closed = (typeByte & 0x80) !== 0;
      const deleted = !closed;

      if (deleted) {
        const idx = typeByte & 0x07;
        const typeName = FILE_TYPES[idx] || 'DEL';
        const locked = (typeByte & 0x40) !== 0;
        entries.push({ name, type: '*' + typeName + (locked ? '<' : ' '), blocks, deleted: true, entryOff: entryOff });
      } else {
        entries.push({
          name,
          type: fileTypeName(typeByte),
          blocks,
          deleted: false,
          entryOff: entryOff,
        });
      }
    }

    dirTrack = data[off + 0];
    dirSector = data[off + 1];
  }

  return { diskName, diskId, freeBlocks, entries };
}

// ── Create empty D64 ─────────────────────────────────────────────────
function createEmptyD64() {
  const data = new Uint8Array(174848);

  const sectorsPerTrack = t => {
    if (t <= 17) return 21;
    if (t <= 24) return 19;
    if (t <= 30) return 18;
    return 17;
  };

  // BAM at track 18, sector 0
  const bamOff = sectorOffset(18, 0);
  data[bamOff + 0] = 18;  // directory track
  data[bamOff + 1] = 1;   // directory sector
  data[bamOff + 2] = 0x41; // DOS version 'A'

  // BAM entries for tracks 1-35
  for (let t = 1; t <= 35; t++) {
    const spt = sectorsPerTrack(t);
    const base = bamOff + 4 * t;
    if (t === 18) {
      // track 18: mark sectors 0 and 1 as used (BAM + first dir sector)
      data[base] = spt - 2;
      // Build bitmap with all sectors free, then clear bits 0 and 1
      let bm = (1 << spt) - 1; // all free
      bm &= ~(1 << 0); // sector 0 used
      bm &= ~(1 << 1); // sector 1 used
      data[base + 1] = bm & 0xFF;
      data[base + 2] = (bm >> 8) & 0xFF;
      data[base + 3] = (bm >> 16) & 0xFF;
    } else {
      data[base] = spt;
      let bm = (1 << spt) - 1;
      data[base + 1] = bm & 0xFF;
      data[base + 2] = (bm >> 8) & 0xFF;
      data[base + 3] = (bm >> 16) & 0xFF;
    }
  }

  // Disk name: fill with 0xA0 (shifted space)
  for (let i = 0; i < 27; i++) {
    data[bamOff + 0x90 + i] = 0xA0;
  }

  // Default disk name
  const name = 'EMPTY DISK';
  for (let i = 0; i < name.length; i++) {
    data[bamOff + 0x90 + i] = name.charCodeAt(i);
  }

  // Disk ID
  data[bamOff + 0xA2] = 0x30; // '0'
  data[bamOff + 0xA3] = 0x30; // '0'
  data[bamOff + 0xA4] = 0xA0;
  data[bamOff + 0xA5] = 0x32; // '2'
  data[bamOff + 0xA6] = 0x41; // 'A'

  // First directory sector at track 18, sector 1 — all zeros is fine
  // (next track=0 means end of chain, entries are empty)

  return data.buffer;
}

// ── Current disk state ─────────────────────────────────────────────────
let currentBuffer = null;
let currentFileName = null;
let showDeleted = true;
let currentSort = null;
let selectedEntryIndex = -1;

// ── Allowed C64 characters ────────────────────────────────────────────
// Letters A-Z, digits 0-9, space, and common C64 PETSCII printable symbols
const ALLOWED_C64 = /^[A-Za-z0-9 !#$%&'()*+,\-./:;<=>?@\[\]^_]$/;

function filterC64Input(str, maxLen) {
  return str.split('').filter(ch => ALLOWED_C64.test(ch)).slice(0, maxLen).join('');
}

// ── Write header fields back to D64 buffer ────────────────────────────
function writeDiskName(buffer, name) {
  const data = new Uint8Array(buffer);
  const bamOff = sectorOffset(18, 0);
  for (let i = 0; i < 16; i++) {
    data[bamOff + 0x90 + i] = i < name.length ? name.toUpperCase().charCodeAt(i) : 0xA0;
  }
}

function writeDiskId(buffer, id) {
  const data = new Uint8Array(buffer);
  const bamOff = sectorOffset(18, 0);
  for (let i = 0; i < 5; i++) {
    data[bamOff + 0xA2 + i] = i < id.length ? id.toUpperCase().charCodeAt(i) : 0xA0;
  }
}

// ── Validate (mimics 1541 VALIDATE command) ──────────────────────────
// The real C64 VALIDATE command:
// 1. Walks the directory chain and follows every closed file's track/sector chain
// 2. Rebuilds the BAM from scratch based on which sectors are actually used
// 3. Removes splat files (unclosed / *-prefixed entries)
// 4. Updates free block counts per track
function validateD64(buffer) {
  const data = new Uint8Array(buffer);
  const bamOff = sectorOffset(18, 0);
  const log = [];

  const sectorsPerTrack = t => {
    if (t <= 17) return 21;
    if (t <= 24) return 19;
    if (t <= 30) return 18;
    return 17;
  };

  // Allocation map: true = used
  const allocated = [];
  for (let t = 0; t <= 35; t++) {
    allocated[t] = new Uint8Array(sectorsPerTrack(Math.max(t, 1)));
  }

  // Track 18 sector 0 (BAM) is always allocated
  allocated[18][0] = 1;

  // Follow a track/sector chain, marking sectors as used
  // Returns { blocks, error }
  function followChain(startTrack, startSector, label) {
    const visited = new Set();
    let t = startTrack, s = startSector;
    let blocks = 0;
    while (t !== 0) {
      if (t < 1 || t > 35) {
        log.push(`  ERROR: ${label}: illegal track ${t}`);
        return { blocks, error: true };
      }
      if (s < 0 || s >= sectorsPerTrack(t)) {
        log.push(`  ERROR: ${label}: illegal sector ${s} on track ${t}`);
        return { blocks, error: true };
      }
      const key = `${t}:${s}`;
      if (visited.has(key)) {
        log.push(`  ERROR: ${label}: circular reference at track ${t} sector ${s}`);
        return { blocks, error: true };
      }
      visited.add(key);

      if (allocated[t][s]) {
        log.push(`  ERROR: ${label}: cross-linked at track ${t} sector ${s}`);
        return { blocks, error: true };
      }
      allocated[t][s] = 1;
      blocks++;

      const off = sectorOffset(t, s);
      t = data[off + 0];
      s = data[off + 1];
    }
    return { blocks, error: false };
  }

  // Walk directory chain, mark directory sectors as allocated
  let dirTrack = 18, dirSector = 1;
  const dirSectors = [];
  const dirVisited = new Set();
  while (dirTrack !== 0) {
    const key = `${dirTrack}:${dirSector}`;
    if (dirVisited.has(key)) {
      log.push('ERROR: circular directory chain');
      break;
    }
    dirVisited.add(key);
    if (dirTrack < 1 || dirTrack > 35 || dirSector < 0 || dirSector >= sectorsPerTrack(dirTrack)) {
      log.push(`ERROR: illegal directory sector track ${dirTrack} sector ${dirSector}`);
      break;
    }
    allocated[dirTrack][dirSector] = 1;
    dirSectors.push({ track: dirTrack, sector: dirSector });

    const off = sectorOffset(dirTrack, dirSector);
    dirTrack = data[off + 0];
    dirSector = data[off + 1];
  }

  // Process directory entries
  let splatCount = 0;
  for (const ds of dirSectors) {
    const off = sectorOffset(ds.track, ds.sector);
    for (let i = 0; i < 8; i++) {
      const entryOff = off + i * 32;
      const typeByte = data[entryOff + 2];
      const fileType = typeByte & 0x07;
      const closed = (typeByte & 0x80) !== 0;

      if (fileType === 0 && !closed) continue; // empty slot

      const name = readPetsciiString(data, entryOff + 5, 16);
      if (!name.trim() && fileType === 0) continue;

      const fileTrack = data[entryOff + 3];
      const fileSector = data[entryOff + 4];

      if (!closed) {
        // Splat file — remove it (zero out the entry type)
        log.push(`Removed splat file: "${name}"`);
        data[entryOff + 2] = 0x00;
        splatCount++;
        continue;
      }

      // Follow the file's sector chain
      const label = `"${name}"`;
      const result = followChain(fileTrack, fileSector, label);
      const expectedBlocks = data[entryOff + 30] | (data[entryOff + 31] << 8);
      if (result.blocks !== expectedBlocks && !result.error) {
        log.push(`  Warning: ${label}: block count ${expectedBlocks} in directory, actual ${result.blocks}`);
      }
    }
  }

  // Rebuild BAM from allocation map
  let bamErrors = 0;
  for (let t = 1; t <= 35; t++) {
    const spt = sectorsPerTrack(t);
    const base = bamOff + 4 * t;

    // Count free sectors
    let free = 0;
    let bm = 0;
    for (let s = 0; s < spt; s++) {
      if (!allocated[t][s]) {
        free++;
        bm |= (1 << s);
      }
    }

    // Compare with existing BAM
    const oldFree = data[base];
    const oldBm = data[base + 1] | (data[base + 2] << 8) | (data[base + 3] << 16);
    const newBm = bm;
    if (oldFree !== free || oldBm !== newBm) {
      bamErrors++;
    }

    // Write corrected BAM
    data[base] = free;
    data[base + 1] = bm & 0xFF;
    data[base + 2] = (bm >> 8) & 0xFF;
    data[base + 3] = (bm >> 16) & 0xFF;
  }

  if (bamErrors > 0) {
    log.push(`BAM corrected: ${bamErrors} track(s) had incorrect allocation`);
  }
  if (splatCount > 0) {
    log.push(`Removed ${splatCount} splat file(s)`);
  }
  if (bamErrors === 0 && splatCount === 0 && log.length === 0) {
    log.push('Disk is valid. No errors found.');
  } else if (!log.some(l => l.startsWith('  ERROR'))) {
    log.push('Validation complete.');
  } else {
    log.push('Validation complete with errors.');
  }

  return log;
}

// ── Render ────────────────────────────────────────────────────────────
function renderDisk(info) {
  const prevSelected = selectedEntryIndex;
  selectedEntryIndex = -1;
  const content = document.getElementById('content');

  let html = `
    <div class="disk-panel">
      <div class="disk-header">
        <div class="disk-header-spacer"></div>
        <div class="disk-name"><span class="editable${info.diskName.trim() ? '' : ' empty'}" id="edit-name" data-field="name" data-max="16">${info.diskName.trim() ? escHtml(info.diskName.padEnd(16)) : ''}</span></div>
        <div class="disk-id"><span class="editable${info.diskId.trim() ? '' : ' empty'}" id="edit-id" data-field="id" data-max="5">${info.diskId.trim() ? escHtml(info.diskId) : ''}</span></div>
      </div>
      <div class="dir-listing">`;

  let entries = info.entries.filter(e => !e.deleted || showDeleted);
  if (currentSort === 'name-asc') entries.sort((a, b) => a.name.localeCompare(b.name));
  else if (currentSort === 'name-desc') entries.sort((a, b) => b.name.localeCompare(a.name));
  else if (currentSort === 'blocks-asc') entries.sort((a, b) => a.blocks - b.blocks);
  else if (currentSort === 'blocks-desc') entries.sort((a, b) => b.blocks - a.blocks);

  for (const e of entries) {
    html += `
        <div class="dir-entry${e.deleted ? ' deleted' : ''}" data-offset="${e.entryOff}">
          <span class="dir-blocks">${e.blocks}</span>
          <span class="dir-name">"${escHtml(e.name.padEnd(16))}"</span>
          <span class="dir-type">${escHtml(e.type)}</span>
        </div>`;
  }

  html += `
      </div>
      <div class="dir-footer">
        <span class="dir-footer-blocks">${info.freeBlocks}</span>
        <span class="dir-footer-label">blocks free.</span>
      </div>
    </div>`;

  content.innerHTML = html;
  bindEditableFields();
  bindDirSelection();

  // Restore selection
  if (prevSelected >= 0) {
    const el = document.querySelector(`.dir-entry[data-offset="${prevSelected}"]`);
    if (el) {
      el.classList.add('selected');
      selectedEntryIndex = prevSelected;
    }
  }
  updateEntryMenuState();
}

function bindDirSelection() {
  const entries = document.querySelectorAll('.dir-entry');
  entries.forEach(el => {
    el.addEventListener('click', () => {
      entries.forEach(e => e.classList.remove('selected'));
      el.classList.add('selected');
      selectedEntryIndex = parseInt(el.dataset.offset, 10);
      updateEntryMenuState();
    });
    el.addEventListener('dblclick', (e) => {
      if (e.target.classList.contains('dir-type')) {
        const entryOff = parseInt(el.dataset.offset, 10);
        showTypeDropdown(e.target, entryOff);
      } else {
        startRenameEntry(el);
      }
    });
  });
}

function updateEntryMenuState() {
  const hasSelection = selectedEntryIndex >= 0 && currentBuffer;
  document.getElementById('opt-rename').classList.toggle('disabled', !hasSelection);
  document.getElementById('opt-lock').classList.toggle('disabled', !hasSelection);
  document.getElementById('opt-splat').classList.toggle('disabled', !hasSelection);
  document.getElementById('opt-change-type').classList.toggle('disabled', !hasSelection);
  const lockEl = document.getElementById('opt-lock');
  const splatEl = document.getElementById('opt-splat');
  if (hasSelection) {
    const data = new Uint8Array(currentBuffer);
    const typeByte = data[selectedEntryIndex + 2];
    const closed = (typeByte & 0x80) !== 0;
    const locked = (typeByte & 0x40) !== 0;
    const currentTypeIdx = typeByte & 0x07;
    lockEl.textContent = locked ? 'Unlock File' : 'Lock File';
    splatEl.textContent = closed ? 'Scratch File' : 'Unscratch File';
    for (let i = 0; i < 5; i++) {
      document.getElementById('check-type-' + i).textContent = i === currentTypeIdx ? '\u2713' : '';
    }
  } else {
    lockEl.textContent = 'Lock File';
    splatEl.textContent = 'Scratch File';
    for (let i = 0; i < 5; i++) {
      document.getElementById('check-type-' + i).textContent = '';
    }
  }
}

// ── Inline editing ────────────────────────────────────────────────────
function bindEditableFields() {
  document.querySelectorAll('.editable').forEach(el => {
    el.addEventListener('dblclick', () => startEditing(el));
  });
}

function startEditing(el) {
  if (el.classList.contains('editing')) return;
  const field = el.dataset.field;
  const maxLen = parseInt(el.dataset.max, 10);
  const isEmpty = el.classList.contains('empty');
  const currentValue = isEmpty ? '' : el.textContent.trimEnd();

  el.classList.add('editing');
  el.classList.remove('empty');
  el.contentEditable = 'true';
  el.textContent = currentValue;
  el.focus();

  // Select all text
  const range = document.createRange();
  range.selectNodeContents(el);
  const sel = window.getSelection();
  sel.removeAllRanges();
  sel.addRange(range);

  function setDisplay(value) {
    if (value.trim()) {
      el.classList.remove('empty');
      el.textContent = field === 'name' ? value.padEnd(16) : value;
    } else {
      el.classList.add('empty');
      el.textContent = '';
    }
  }

  function commitEdit() {
    el.contentEditable = 'false';
    el.classList.remove('editing');
    el.removeEventListener('blur', commitEdit);
    el.removeEventListener('keydown', onKeyDown);

    let value = filterC64Input(el.textContent, maxLen).toUpperCase();

    if (currentBuffer) {
      if (field === 'name') writeDiskName(currentBuffer, value);
      else if (field === 'id') writeDiskId(currentBuffer, value);
    }
    setDisplay(value);
  }

  function onKeyDown(e) {
    if (e.key === 'Enter') {
      e.preventDefault();
      el.blur();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      el.contentEditable = 'false';
      el.classList.remove('editing');
      el.removeEventListener('blur', commitEdit);
      el.removeEventListener('keydown', onKeyDown);
      setDisplay(currentValue);
    } else if (e.key.length === 1 && !e.ctrlKey && !e.metaKey) {
      const sel = window.getSelection();
      const curText = el.textContent;
      const selLen = sel.toString().length;
      if (!ALLOWED_C64.test(e.key) || (curText.length - selLen >= maxLen)) {
        e.preventDefault();
      }
    }
  }

  el.addEventListener('blur', commitEdit);
  el.addEventListener('keydown', onKeyDown);
}

function escHtml(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ── Save helpers ──────────────────────────────────────────────────────
function downloadD64(buffer, fileName) {
  const blob = new Blob([buffer], { type: 'application/octet-stream' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = fileName;
  a.click();
  URL.revokeObjectURL(a.href);
}

function updateMenuState() {
  const hasDisk = currentBuffer !== null;
  document.getElementById('opt-close').classList.toggle('disabled', !hasDisk);
  document.getElementById('opt-save').classList.toggle('disabled', !hasDisk || !currentFileName);
  document.getElementById('opt-save-as').classList.toggle('disabled', !hasDisk);
  document.getElementById('opt-validate').classList.toggle('disabled', !hasDisk);
  document.getElementById('opt-show-deleted').classList.toggle('disabled', !hasDisk);
  document.getElementById('opt-sort').classList.toggle('disabled', !hasDisk);
}

// ── Menu logic ────────────────────────────────────────────────────────
const fileInput = document.getElementById('file-input');
let openMenu = null;

function closeMenus() {
  document.querySelectorAll('.menu-item').forEach(m => m.classList.remove('open'));
  openMenu = null;
}

document.querySelectorAll('.menu-item').forEach(menu => {
  menu.addEventListener('click', (e) => {
    e.stopPropagation();
    if (openMenu === menu) {
      closeMenus();
    } else {
      closeMenus();
      menu.classList.add('open');
      openMenu = menu;
    }
  });
});

document.addEventListener('click', () => {
  closeMenus();
});

document.getElementById('opt-new').addEventListener('click', (e) => {
  e.stopPropagation();
  closeMenus();
  const buf = createEmptyD64();
  currentBuffer = buf;
  currentFileName = null;
  const info = parseD64(buf);
  renderDisk(info);
  updateMenuState();
});

document.getElementById('opt-open').addEventListener('click', (e) => {
  e.stopPropagation();
  closeMenus();
  fileInput.click();
});

document.getElementById('opt-close').addEventListener('click', (e) => {
  e.stopPropagation();
  if (!currentBuffer) return;
  closeMenus();
  currentBuffer = null;
  currentFileName = null;
  selectedEntryIndex = -1;
  document.getElementById('content').innerHTML = `
    <div class="empty-state">
      No disk loaded.<br>
      Use Disk &gt; New to create an empty disk,<br>
      or Disk &gt; Open to load a .d64 file.
    </div>`;
  updateMenuState();
  updateEntryMenuState();
});

document.getElementById('opt-save').addEventListener('click', (e) => {
  e.stopPropagation();
  if (!currentBuffer || !currentFileName) return;
  closeMenus();
  downloadD64(currentBuffer, currentFileName);
});

document.getElementById('opt-save-as').addEventListener('click', (e) => {
  e.stopPropagation();
  if (!currentBuffer) return;
  closeMenus();
  const defaultName = currentFileName || 'disk.d64';
  const fileName = prompt('Save as:', defaultName);
  if (!fileName) return;
  currentFileName = fileName.endsWith('.d64') ? fileName : fileName + '.d64';
  downloadD64(currentBuffer, currentFileName);
  updateMenuState();
});

document.getElementById('opt-validate').addEventListener('click', (e) => {
  e.stopPropagation();
  if (!currentBuffer) return;
  closeMenus();
  const log = validateD64(currentBuffer);
  const info = parseD64(currentBuffer);
  renderDisk(info);
  showModal('Validate', log);
});

document.getElementById('opt-show-deleted').addEventListener('click', (e) => {
  e.stopPropagation();
  if (!currentBuffer) return;
  closeMenus();
  showDeleted = !showDeleted;
  document.getElementById('check-deleted').textContent = showDeleted ? '\u2713' : '';
  const info = parseD64(currentBuffer);
  renderDisk(info);
});

document.querySelectorAll('#opt-sort .submenu .option').forEach(el => {
  el.addEventListener('click', (e) => {
    e.stopPropagation();
    if (!currentBuffer) return;
    closeMenus();
    currentSort = el.dataset.sort;

    const info = parseD64(currentBuffer);
    renderDisk(info);
  });
});

// ── File menu: Rename ─────────────────────────────────────────────────
function writeFileName(buffer, entryOff, name) {
  const data = new Uint8Array(buffer);
  for (let i = 0; i < 16; i++) {
    data[entryOff + 5 + i] = i < name.length ? name.toUpperCase().charCodeAt(i) : 0xA0;
  }
}

// ── Change file type ──────────────────────────────────────────────────
function changeFileType(entryOff, newTypeIdx) {
  if (!currentBuffer) return;
  const data = new Uint8Array(currentBuffer);
  // Preserve closed (bit 7) and locked (bit 6), replace type bits (0-2)
  data[entryOff + 2] = (data[entryOff + 2] & 0xC0) | (newTypeIdx & 0x07);
  const info = parseD64(currentBuffer);
  renderDisk(info);
}

function showTypeDropdown(typeSpan, entryOff) {
  // Remove any existing dropdown
  const existing = document.querySelector('.type-dropdown');
  if (existing) existing.remove();

  const data = new Uint8Array(currentBuffer);
  const currentTypeIdx = data[entryOff + 2] & 0x07;

  const dropdown = document.createElement('div');
  dropdown.className = 'type-dropdown';

  FILE_TYPES.forEach((typeName, idx) => {
    const opt = document.createElement('div');
    opt.className = 'type-option';
    const check = document.createElement('span');
    check.className = 'check';
    check.textContent = idx === currentTypeIdx ? '\u2713' : '';
    opt.appendChild(check);
    opt.appendChild(document.createTextNode(typeName));
    opt.addEventListener('click', (e) => {
      e.stopPropagation();
      dropdown.remove();
      changeFileType(entryOff, idx);
    });
    dropdown.appendChild(opt);
  });

  document.body.appendChild(dropdown);

  // Position above the type span
  const rect = typeSpan.getBoundingClientRect();
  dropdown.style.left = rect.left + 'px';
  // Place above; if not enough room, place below
  const dropH = dropdown.offsetHeight;
  if (rect.top - dropH > 0) {
    dropdown.style.top = (rect.top - dropH) + 'px';
  } else {
    dropdown.style.top = rect.bottom + 'px';
  }

  // Close on outside click
  function closeDropdown(e) {
    if (!dropdown.contains(e.target)) {
      dropdown.remove();
      document.removeEventListener('click', closeDropdown);
    }
  }
  setTimeout(() => document.addEventListener('click', closeDropdown), 0);
}

function startRenameEntry(entryEl) {
  if (!currentBuffer || !entryEl) return;
  const entryOff = parseInt(entryEl.dataset.offset, 10);
  const nameSpan = entryEl.querySelector('.dir-name');
  if (nameSpan.classList.contains('editing')) return;

  const currentValue = nameSpan.textContent.replace(/^"|"$/g, '').trimEnd();

  nameSpan.classList.add('editing');
  nameSpan.contentEditable = 'true';
  nameSpan.textContent = currentValue;
  nameSpan.focus();

  const range = document.createRange();
  range.selectNodeContents(nameSpan);
  const sel = window.getSelection();
  sel.removeAllRanges();
  sel.addRange(range);

  function commitRename() {
    nameSpan.contentEditable = 'false';
    nameSpan.classList.remove('editing');
    nameSpan.removeEventListener('blur', commitRename);
    nameSpan.removeEventListener('keydown', onKeyDown);

    let value = filterC64Input(nameSpan.textContent, 16).toUpperCase();
    if (currentBuffer) {
      writeFileName(currentBuffer, entryOff, value);
    }
    nameSpan.textContent = '"' + value.padEnd(16) + '"';
  }

  function onKeyDown(ev) {
    if (ev.key === 'Enter') {
      ev.preventDefault();
      nameSpan.blur();
    } else if (ev.key === 'Escape') {
      ev.preventDefault();
      nameSpan.contentEditable = 'false';
      nameSpan.classList.remove('editing');
      nameSpan.removeEventListener('blur', commitRename);
      nameSpan.removeEventListener('keydown', onKeyDown);
      nameSpan.textContent = '"' + currentValue.padEnd(16) + '"';
    } else if (ev.key.length === 1 && !ev.ctrlKey && !ev.metaKey) {
      const sel = window.getSelection();
      const curText = nameSpan.textContent;
      const selLen = sel.toString().length;
      if (!ALLOWED_C64.test(ev.key) || (curText.length - selLen >= 16)) {
        ev.preventDefault();
      }
    }
  }

  nameSpan.addEventListener('blur', commitRename);
  nameSpan.addEventListener('keydown', onKeyDown);
}

document.getElementById('opt-rename').addEventListener('click', (e) => {
  e.stopPropagation();
  if (!currentBuffer || selectedEntryIndex < 0) return;
  closeMenus();
  const selected = document.querySelector('.dir-entry.selected');
  startRenameEntry(selected);
});

document.getElementById('opt-lock').addEventListener('click', (e) => {
  e.stopPropagation();
  if (!currentBuffer || selectedEntryIndex < 0) return;
  closeMenus();
  const data = new Uint8Array(currentBuffer);
  data[selectedEntryIndex + 2] ^= 0x40; // toggle lock bit
  const info = parseD64(currentBuffer);
  renderDisk(info);
});

document.getElementById('opt-splat').addEventListener('click', (e) => {
  e.stopPropagation();
  if (!currentBuffer || selectedEntryIndex < 0) return;
  closeMenus();
  const data = new Uint8Array(currentBuffer);
  data[selectedEntryIndex + 2] ^= 0x80; // toggle closed bit
  const info = parseD64(currentBuffer);
  renderDisk(info);
});

document.querySelectorAll('#opt-change-type .submenu .option').forEach(el => {
  el.addEventListener('click', (e) => {
    e.stopPropagation();
    if (!currentBuffer || selectedEntryIndex < 0) return;
    closeMenus();
    changeFileType(selectedEntryIndex, parseInt(el.dataset.typeidx, 10));
  });
});

fileInput.addEventListener('change', () => {
  const file = fileInput.files[0];
  if (!file) return;
  currentFileName = file.name;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      currentBuffer = reader.result;
      const info = parseD64(currentBuffer);
      renderDisk(info);
      updateMenuState();
    } catch (err) {
      alert('Error reading .d64 file: ' + err.message);
    }
  };
  reader.readAsArrayBuffer(file);
  fileInput.value = '';
});

// ── Theme toggle ─────────────────────────────────────────────────────
const themeToggle = document.getElementById('theme-toggle');
const savedTheme = localStorage.getItem('d64-theme');
if (savedTheme) document.documentElement.setAttribute('data-theme', savedTheme);

function updateThemeIcon() {
  const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
  themeToggle.textContent = isDark ? '\u2600' : '\u263D';
}
updateThemeIcon();
updateSortChecks();

themeToggle.addEventListener('click', () => {
  const current = document.documentElement.getAttribute('data-theme');
  const next = current === 'dark' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', next);
  localStorage.setItem('d64-theme', next);
  updateThemeIcon();
});
</script>

</body>
</html>
