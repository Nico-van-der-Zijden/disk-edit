<!DOCTYPE html>
<html lang="en" data-theme="dark">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta http-equiv="X-UA-Compatible" content="IE=edge">
<title>D64 Disk Viewer</title>
<link rel="stylesheet" href="assets/fontawesome/all.min.css">
<link rel="icon" type="image/svg+xml" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'%3E%3Crect x='4' y='2' width='56' height='60' rx='3' fill='%23222' stroke='%23555' stroke-width='2'/%3E%3Crect x='18' y='2' width='28' height='14' rx='1' fill='%23888'/%3E%3Crect x='24' y='4' width='16' height='10' rx='1' fill='%23222'/%3E%3Ccircle cx='32' cy='36' r='14' fill='none' stroke='%23555' stroke-width='2'/%3E%3Ccircle cx='32' cy='36' r='6' fill='%23555'/%3E%3Crect x='30' y='30' width='4' height='12' rx='1' fill='%23888' transform='rotate(45 32 36)'/%3E%3Crect x='8' y='52' width='20' height='6' rx='1' fill='%23444'/%3E%3C/svg%3E">
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

  .editable, .dir-name.editing, .blocks-input, .name-input, .header-input {
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

  .menubar.menu-active .menu-item:hover > .menu-dropdown {
    display: block;
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
    font-size: 10px;
  }

  .has-submenu::after {
    content: '\f054';
    font-family: 'Font Awesome 6 Free';
    font-weight: 900;
    font-size: 9px;
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
    text-align: right;
    color: var(--text-muted);
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
    min-width: 18ch;
  }

  .disk-id .editable {
    min-width: 6ch;
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
    background: none;
    outline: none;
    padding: 0;
    cursor: text;
  }

  .disk-id {
    width: 5ch;
    min-width: 5ch;
    font-size: 14px;
    color: var(--text-muted);
    text-align: left;
    flex-shrink: 0;
    white-space: pre;
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

  .dir-header-row {
    cursor: default;
    font-size: 11px;
    color: var(--text-muted);
    border-bottom: 1px solid var(--border);
    padding-bottom: 4px;
    margin-bottom: 4px;
  }

  .dir-header-row .dir-blocks,
  .dir-header-row .dir-name,
  .dir-header-row .dir-type,
  .dir-header-row .dir-ts,
  .dir-header-row .dir-addr {
    color: var(--text-muted);
    font-size: 11px;
  }

  .dir-header-row:hover {
    background: none;
  }

  .dir-entry:not(.dir-header-row):hover {
    background: var(--hover);
  }

  .dir-entry.selected {
    background: var(--accent);
    color: var(--bg);
  }

  .dir-entry.selected .dir-blocks,
  .dir-entry.selected .dir-type,
  .dir-entry.selected .dir-addr,
  .dir-entry.selected .dir-ts {
    color: var(--bg);
  }

  .dir-blocks {
    width: 48px;
    text-align: right;
    color: var(--text-muted);
    flex-shrink: 0;
  }

  .blocks-input {
    width: 100%;
    background: var(--bg);
    border: 1px solid var(--accent);
    border-radius: 3px;
    padding: 0 4px;
    color: var(--text);
    font-family: inherit;
    font-size: inherit;
    text-align: right;
    outline: none;
    -moz-appearance: textfield;
  }

  .blocks-input::-webkit-inner-spin-button,
  .blocks-input::-webkit-outer-spin-button {
    -webkit-appearance: none;
    margin: 0;
  }

  .dir-name {
    flex: 1;
    white-space: pre;
  }

  .name-input, .header-input {
    width: 100%;
    box-sizing: border-box;
    background: var(--bg);
    border: 1px solid var(--accent);
    border-radius: 3px;
    padding: 0 4px;
    color: var(--text);
    font-family: inherit;
    font-size: inherit;
    letter-spacing: inherit;
    outline: none;
  }

  .dir-type {
    width: 5ch;
    text-align: left;
    color: var(--text-muted);
    flex-shrink: 0;
    white-space: pre;
    position: relative;
  }

  .dir-addr {
    width: 11ch;
    text-align: left;
    color: var(--text-muted);
    flex-shrink: 0;
    font-size: 12px;
    white-space: pre;
    display: none;
  }

  .show-addresses .dir-addr {
    display: block;
  }

  .dir-ts {
    width: 7ch;
    text-align: left;
    color: var(--text-muted);
    flex-shrink: 0;
    font-size: 12px;
    white-space: pre;
    display: none;
  }

  .show-tracksector .dir-ts {
    display: block;
  }

  .dir-grip {
    width: 16px;
    flex-shrink: 0;
    cursor: grab;
    color: var(--text-muted);
    font-size: 12px;
    text-align: center;
    opacity: 0;
    transition: opacity 0.15s;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .dir-entry:hover .dir-grip {
    opacity: 0.5;
  }

  .dir-entry.selected .dir-grip {
    color: var(--bg);
  }

  .dir-header-row .dir-grip {
    cursor: default;
    opacity: 0 !important;
  }

  .dir-entry.drag-over-top {
    border-top: 2px solid var(--accent);
  }

  .dir-entry.drag-over-bottom {
    border-bottom: 2px solid var(--accent);
  }

  .dir-entry.dragging {
    opacity: 0.4;
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
    font-size: 10px;
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

  .dir-footer-tracks {
    font-size: 11px;
    opacity: 0.6;
  }

  .dir-entry.deleted {
    opacity: 0.5;
  }

  .petscii-rev {
    background: var(--text);
    color: var(--bg);
    border-radius: 1px;
  }

  /* --- PETSCII Keyboard Picker --- */
  .petscii-picker {
    display: none;
    position: fixed;
    background: var(--bg-menu);
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 10px;
    z-index: 250;
    box-shadow: 0 8px 32px rgba(0,0,0,.4);
  }

  .petscii-picker.open {
    display: block;
  }

  .petscii-modifiers {
    display: flex;
    gap: 4px;
    margin-bottom: 8px;
  }

  .petscii-mod {
    padding: 4px 12px;
    font-family: inherit;
    font-size: 11px;
    border: 1px solid var(--border);
    border-radius: 4px;
    cursor: pointer;
    background: var(--bg);
    color: var(--text);
  }

  .petscii-mod.active {
    background: var(--accent);
    color: var(--bg);
    border-color: var(--accent);
  }

  .petscii-mod:hover:not(.active):not(.disabled) {
    background: var(--hover);
  }

  .petscii-mod.disabled {
    opacity: 0.3;
    cursor: not-allowed;
  }

  .petscii-kb-row {
    display: flex;
    gap: 3px;
    margin-bottom: 3px;
    justify-content: center;
  }

  .petscii-key {
    width: 28px;
    height: 28px;
    display: flex;
    align-items: center;
    justify-content: center;
    border: 1px solid var(--border);
    border-radius: 4px;
    cursor: pointer;
    font-size: 14px;
    color: var(--text);
    background: var(--bg);
    flex-shrink: 0;
  }

  .petscii-key:hover {
    background: var(--accent);
    color: var(--bg);
    border-color: var(--accent);
  }

  .petscii-key.wide {
    width: auto;
    padding: 0 10px;
    font-size: 11px;
  }

  .petscii-key.space {
    width: 180px;
  }

  .petscii-key.rev-char {
    background: var(--text);
    color: var(--bg);
  }

  .petscii-key.rev-char:hover {
    background: var(--accent);
    color: var(--bg);
  }

  .petscii-key.unsafe {
    border-color: #f38ba8;
    color: #f38ba8;
  }

  [data-theme="light"] .petscii-key.unsafe {
    border-color: #d20f39;
    color: #d20f39;
  }

  .petscii-key.unsafe:hover {
    background: #f38ba8;
    color: var(--bg);
    border-color: #f38ba8;
  }

  .petscii-key.disabled {
    opacity: 0.2;
    cursor: not-allowed;
  }

  .petscii-key.disabled:hover {
    background: var(--bg);
    color: var(--text);
    border-color: var(--border);
  }

  .petscii-key.empty {
    visibility: hidden;
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
    flex-shrink: 0;
    display: flex;
    gap: 8px;
    justify-content: flex-end;
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

  .modal-btn-secondary {
    background: transparent !important;
    border-color: var(--border) !important;
  }

  .modal-btn-secondary:hover {
    background: var(--hover) !important;
  }

  .modal-input {
    width: 100%;
    padding: 8px 10px;
    font-family: inherit;
    font-size: 14px;
    background: var(--bg);
    color: var(--text);
    border: 1px solid var(--border);
    border-radius: 4px;
    outline: none;
  }

  .modal-input:focus {
    border-color: var(--accent);
  }

</style>
</head>
<body>

<div class="menubar">
  <div class="menu-item" id="menu-file">
    Disk
    <div class="menu-dropdown">
      <div class="option has-submenu" id="opt-new">New
        <div class="submenu">
          <div class="option" data-tracks="35">35 Tracks</div>
          <div class="option" data-tracks="40">40 Tracks</div>
        </div>
      </div>
      <div class="option" id="opt-open">Open...</div>
      <div class="option disabled" id="opt-close">Close</div>
      <div class="separator"></div>
      <div class="option disabled" id="opt-save">Save</div>
      <div class="option disabled" id="opt-save-as">Save As...</div>
      <div class="separator"></div>
      <div class="option disabled" id="opt-validate">Validate</div>
      <div class="option disabled" id="opt-show-deleted"><span class="check" id="check-deleted"></span>Show Deleted Files</div>
      <div class="option disabled has-submenu" id="opt-sort">Sort
        <div class="submenu">
          <div class="option" data-sort="name-asc">Name Ascending</div>
          <div class="option" data-sort="name-desc">Name Descending</div>
          <div class="separator"></div>
          <div class="option" data-sort="blocks-asc">Blocks Ascending</div>
          <div class="option" data-sort="blocks-desc">Blocks Descending</div>
        </div>
      </div>
      <div class="separator"></div>
      <div class="option disabled" id="opt-edit-free">Edit Blocks Free</div>
      <div class="option disabled" id="opt-recalc-free">Recalculate Blocks Free</div>
    </div>
  </div>
  <div class="menu-item" id="menu-entry">
    File
    <div class="menu-dropdown">
      <div class="option disabled" id="opt-rename">Rename</div>
      <div class="option disabled" id="opt-insert">Insert File</div>
      <div class="option disabled" id="opt-remove">Remove Entry</div>
      <div class="option disabled has-submenu" id="opt-align">Align
        <div class="submenu">
          <div class="option" data-align="left">Align Left</div>
          <div class="option" data-align="right">Align Right</div>
          <div class="option" data-align="center">Center</div>
          <div class="option" data-align="justify">Justify</div>
          <div class="option" data-align="expand">Expand</div>
        </div>
      </div>
      <div class="separator"></div>
      <div class="option disabled" id="opt-lock">Lock File</div>
      <div class="option disabled" id="opt-splat">Scratch File</div>
      <div class="option disabled" id="opt-block-size">Change File Size</div>
      <div class="option disabled" id="opt-recalc-size">Set Actual File Size</div>
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
  <div class="menu-item" id="menu-view">
    View
    <div class="menu-dropdown">
      <div class="option" id="opt-show-addr"><span class="check" id="check-addr"></span>Show Addresses</div>
      <div class="option" id="opt-show-ts"><span class="check" id="check-ts"></span>Show Track/Sector</div>
    </div>
  </div>
  <div class="menu-item" id="menu-options">
    Options
    <div class="menu-dropdown">
      <div class="option" id="opt-unsafe-chars"><span class="check" id="check-unsafe"></span>Allow Unsafe Characters</div>
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

<div class="petscii-picker" id="petscii-picker"></div>

<div class="modal-overlay" id="input-modal-overlay">
  <div class="modal">
    <div class="modal-title" id="input-modal-title"></div>
    <div class="modal-body">
      <input type="text" id="input-modal-field" class="modal-input">
    </div>
    <div class="modal-footer">
      <button id="input-modal-cancel" class="modal-btn-secondary">Cancel</button>
      <button id="input-modal-ok">OK</button>
    </div>
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

// ── Input Modal ───────────────────────────────────────────────────────
let inputModalResolve = null;

function showInputModal(title, defaultValue) {
  return new Promise((resolve) => {
    inputModalResolve = resolve;
    document.getElementById('input-modal-title').textContent = title;
    const field = document.getElementById('input-modal-field');
    field.value = defaultValue || '';
    document.getElementById('input-modal-overlay').classList.add('open');
    field.focus();
    field.select();
  });
}

function closeInputModal(value) {
  document.getElementById('input-modal-overlay').classList.remove('open');
  if (inputModalResolve) {
    inputModalResolve(value);
    inputModalResolve = null;
  }
}

document.getElementById('input-modal-ok').addEventListener('click', () => {
  closeInputModal(document.getElementById('input-modal-field').value);
});

document.getElementById('input-modal-cancel').addEventListener('click', () => {
  closeInputModal(null);
});

document.getElementById('input-modal-overlay').addEventListener('click', (e) => {
  if (e.target === e.currentTarget) closeInputModal(null);
});

document.getElementById('input-modal-field').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    closeInputModal(document.getElementById('input-modal-field').value);
  } else if (e.key === 'Escape') {
    e.preventDefault();
    closeInputModal(null);
  }
});

// ── Disable Edge/browser mini menu and context menu ───────────────────
document.addEventListener('contextmenu', e => e.preventDefault());
document.addEventListener('selectstart', e => {
  if (!e.target.isContentEditable && !e.target.closest('.editing')) e.preventDefault();
});
if (navigator.userAgent.includes('Edg')) {
  document.addEventListener('pointerup', e => {
    const sel = window.getSelection();
    if (sel && !e.target.isContentEditable && !e.target.closest('.editing')) sel.removeAllRanges();
  });
}

// ── D64 Format Constants ──────────────────────────────────────────────
const D64_SIZE_35 = 174848;   // 35 tracks, 683 sectors
const D64_SIZE_35E = 175531;  // 35 tracks + 683 error bytes
const D64_SIZE_40 = 196608;   // 40 tracks, 768 sectors
const D64_SIZE_40E = 197376;  // 40 tracks + 768 error bytes

function sectorsPerTrack(t) {
  if (t <= 17) return 21;
  if (t <= 24) return 19;
  if (t <= 30) return 18;
  return 17;
}

function detectTrackCount(bufferSize) {
  if (bufferSize >= D64_SIZE_40) return 40;
  return 35;
}

const TRACK_OFFSETS = (() => {
  const offsets = [0]; // index 0 unused
  let offset = 0;
  for (let t = 1; t <= 40; t++) {
    offsets.push(offset);
    offset += sectorsPerTrack(t) * 256;
  }
  return offsets;
})();

function sectorOffset(track, sector) {
  if (track < 1 || track > 40) return -1;
  if (sector < 0 || sector >= sectorsPerTrack(track)) return -1;
  return TRACK_OFFSETS[track] + sector * 256;
}

// ── PETSCII → Unicode ─────────────────────────────────────────────────
// C64 uppercase/graphics mode character mapping.
// Maps PETSCII byte values to Unicode characters.
// Graphics characters use Box Drawing, Block Elements, and Geometric Shapes.
const PETSCII_MAP = (() => {
  const m = new Array(256).fill('\u00B7'); // · middle dot for unmapped

  // 0x00-0x1F: reversed characters (reverse video of screen codes 0-31)
  // On C64 screen these show as inverted (white on blue). We mark them for
  // special rendering with a prefix that renderDisk will detect.
  m[0x00] = '@';
  for (let i = 0x01; i <= 0x1A; i++) m[i] = String.fromCharCode(i - 0x01 + 65); // A-Z
  m[0x1B] = '[';
  m[0x1C] = '\u00A3'; // £
  m[0x1D] = ']';
  m[0x1E] = '\u2191'; // ↑
  m[0x1F] = '\u2190'; // ←

  // 0x20-0x3F: standard ASCII printable (space, digits, punctuation)
  for (let i = 0x20; i <= 0x3F; i++) m[i] = String.fromCharCode(i);

  // 0x40: @
  m[0x40] = '@';

  // 0x41-0x5A: A-Z → display as lowercase (modern convention)
  for (let i = 0x41; i <= 0x5A; i++) m[i] = String.fromCharCode(i + 32);

  // 0x5B-0x5F: special PETSCII characters
  m[0x5B] = '[';
  m[0x5C] = '\u00A3'; // £ (pound sign)
  m[0x5D] = ']';
  m[0x5E] = '\u2191'; // ↑ (up arrow)
  m[0x5F] = '\u2190'; // ← (left arrow)

  // 0x60-0x7F: graphics characters (screen codes 64-95)
  // These are the SHIFT+key graphics on the C64 keyboard
  const gfx1 = [
    '\u2500', // 0x60 SC64: ─ horizontal line
    '\u2660', // 0x61 SC65: ♠ spade
    '\u2502', // 0x62 SC66: │ vertical line
    '\u2500', // 0x63 SC67: ─ horizontal line
    '\u2597', // 0x64 SC68: ▗ quadrant lower right
    '\u2596', // 0x65 SC69: ▖ quadrant lower left
    '\u2598', // 0x66 SC70: ▘ quadrant upper left
    '\u259D', // 0x67 SC71: ▝ quadrant upper right
    '\u256E', // 0x68 SC72: ╮ rounded corner top-right
    '\u2570', // 0x69 SC73: ╰ rounded corner bottom-left
    '\u256F', // 0x6A SC74: ╯ rounded corner bottom-right
    '\u2572', // 0x6B SC75: ╲ diagonal backslash
    '\u2571', // 0x6C SC76: ╱ diagonal slash
    '\u25CF', // 0x6D SC77: ● filled circle
    '\u2592', // 0x6E SC78: ▒ checker pattern
    '\u2665', // 0x6F SC79: ♥ heart
    '\u256D', // 0x70 SC80: ╭ rounded corner top-left
    '\u2518', // 0x71 SC81: ┘ box bottom-right
    '\u2524', // 0x72 SC82: ┤ box right T
    '\u2510', // 0x73 SC83: ┐ box top-right
    '\u250C', // 0x74 SC84: ┌ box top-left
    '\u2534', // 0x75 SC85: ┴ box bottom T
    '\u252C', // 0x76 SC86: ┬ box top T
    '\u251C', // 0x77 SC87: ├ box left T
    '\u253C', // 0x78 SC88: ┼ box cross
    '\u2514', // 0x79 SC89: └ box bottom-left
    '\u2666', // 0x7A SC90: ♦ diamond
    '\u253C', // 0x7B SC91: ┼ cross
    '\u2502', // 0x7C SC92: │ vertical (thick)
    '\u2500', // 0x7D SC93: ─ horizontal (thick)
    '\u03C0', // 0x7E SC94: π pi
    '\u25E5', // 0x7F SC95: ◥ upper right triangle
  ];
  for (let i = 0; i < 32; i++) m[0x60 + i] = gfx1[i];

  // 0x80-0x9F: reversed characters (reverse video of screen codes 0-31)
  // In context of filenames, display as their non-reversed equivalents
  m[0x80] = ' '; // reversed @? treat as space
  for (let i = 0x81; i <= 0x9A; i++) m[i] = String.fromCharCode(i - 0x81 + 65); // reversed A-Z → A-Z
  m[0x9B] = '[';
  m[0x9C] = '\u00A3'; // reversed £
  m[0x9D] = ']';
  m[0x9E] = '\u2191'; // reversed ↑
  m[0x9F] = '\u2190'; // reversed ←

  // 0xA0: shifted space
  m[0xA0] = ' ';

  // 0xA1-0xBF: graphics characters (screen codes 97-127)
  // These are the CBM+key graphics on the C64 keyboard
  const gfx2 = [
    '\u258C', // 0xA1 SC97:  ▌ left half block
    '\u2584', // 0xA2 SC98:  ▄ lower half block
    '\u2594', // 0xA3 SC99:  ▔ upper 1/8 block
    '\u2581', // 0xA4 SC100: ▁ lower 1/8 block
    '\u258E', // 0xA5 SC101: ▎ left 1/4 block
    '\u2592', // 0xA6 SC102: ▒ medium shade
    '\u2595', // 0xA7 SC103: ▕ right 1/8 block
    '\u259E', // 0xA8 SC104: ▞ quadrant upper right + lower left
    '\u25E4', // 0xA9 SC105: ◤ upper left triangle
    '\u259A', // 0xAA SC106: ▚ quadrant upper left + lower right
    '\u2586', // 0xAB SC107: ▆ lower 3/4 block
    '\u258A', // 0xAC SC108: ▊ left 3/4 block
    '\u259B', // 0xAD SC109: ▛ upper left + upper right + lower left
    '\u259C', // 0xAE SC110: ▜ upper left + upper right + lower right
    '\u2599', // 0xAF SC111: ▙ upper left + lower left + lower right
    '\u259F', // 0xB0 SC112: ▟ upper right + lower left + lower right
    '\u2580', // 0xB1 SC113: ▀ upper half block
    '\u2590', // 0xB2 SC114: ▐ right half block
    '\u2588', // 0xB3 SC115: █ full block
    '\u2582', // 0xB4 SC116: ▂ lower 1/4 block
    '\u258F', // 0xB5 SC117: ▏ left 1/8 block
    '\u2583', // 0xB6 SC118: ▃ lower 3/8 block
    '\u2585', // 0xB7 SC119: ▅ lower 5/8 block
    '\u2587', // 0xB8 SC120: ▇ lower 7/8 block
    '\u258B', // 0xB9 SC121: ▋ left 5/8 block
    '\u2589', // 0xBA SC122: ▉ left 7/8 block
    '\u258D', // 0xBB SC123: ▍ left 3/8 block
    '\u2663', // 0xBC SC124: ♣ club
    '\u25CF', // 0xBD SC125: ● filled circle
    '\u25CB', // 0xBE SC126: ○ empty circle
    '\u2663', // 0xBF SC127: ♣ club (variant)
  ];
  for (let i = 0; i < 31; i++) m[0xA1 + i] = gfx2[i];

  // 0xC0: ─ horizontal line (same as SC64)
  m[0xC0] = '\u2500';

  // 0xC1-0xDA: uppercase A-Z (commonly used in D64 filenames)
  for (let i = 0xC1; i <= 0xDA; i++) m[i] = String.fromCharCode(i - 0xC1 + 65);

  // 0xDB-0xDF: special chars (same visual as 0x5B-0x5F)
  m[0xDB] = '[';
  m[0xDC] = '\u00A3'; // £
  m[0xDD] = ']';
  m[0xDE] = '\u2191'; // ↑
  m[0xDF] = '\u2190'; // ←

  // 0xE0-0xFE: same graphics as 0xA0-0xBE
  for (let i = 0xE0; i <= 0xFE; i++) m[i] = m[i - 0x40];

  // 0xFF: π
  m[0xFF] = '\u03C0';

  return m;
})();

function petsciiToAscii(byte) {
  return PETSCII_MAP[byte & 0xFF];
}

function readPetsciiString(data, offset, len, stopAtPadding) {
  let contentLen = len;
  if (stopAtPadding !== false) {
    // Find content length: 0xA0 is padding, stop there
    for (let i = 0; i < len; i++) {
      if (data[offset + i] === 0xA0) {
        contentLen = i;
        break;
      }
    }
  }
  let s = '';
  for (let i = 0; i < contentLen; i++) {
    s += petsciiToAscii(data[offset + i]);
  }
  return s;
}

// Returns array of {char, reversed} for rendering with inverse video
function readPetsciiRich(data, offset, len) {
  // Find content length: 0xA0 is padding
  let contentLen = len;
  for (let i = 0; i < len; i++) {
    if (data[offset + i] === 0xA0) {
      contentLen = i;
      break;
    }
  }
  const chars = [];
  for (let i = 0; i < contentLen; i++) {
    const b = data[offset + i];
    const reversed = (b >= 0x00 && b <= 0x1F) || (b >= 0x80 && b <= 0x9F);
    chars.push({ char: petsciiToAscii(b), reversed });
  }
  return chars;
}

// ── Reverse PETSCII map (Unicode → PETSCII byte) ─────────────────────
const UNICODE_TO_PETSCII = (() => {
  const rev = new Map();
  // Build reverse map, prefer lower PETSCII codes for duplicates
  for (let i = 255; i >= 0; i--) {
    const ch = PETSCII_MAP[i];
    if (ch && ch !== ' ' && ch !== '\u00B7') {
      rev.set(ch, i);
    }
  }
  // Explicit overrides for common chars (prefer standard PETSCII range)
  for (let i = 0x41; i <= 0x5A; i++) rev.set(String.fromCharCode(i + 32), i); // a-z → 0x41-0x5A
  for (let i = 0x41; i <= 0x5A; i++) rev.set(String.fromCharCode(i), i); // A-Z → 0x41-0x5A
  for (let i = 0x20; i <= 0x3F; i++) rev.set(String.fromCharCode(i), i); // standard punctuation
  rev.set('@', 0x40);
  rev.set('[', 0x5B);
  rev.set(']', 0x5D);
  rev.set('\u00A3', 0x5C); // £
  rev.set('\u2191', 0x5E); // ↑
  rev.set('\u2190', 0x5F); // ←
  rev.set('\u03C0', 0xFF); // π
  rev.set(' ', 0x20);
  return rev;
})();

function unicodeToPetscii(char) {
  return UNICODE_TO_PETSCII.get(char) ?? 0x20;
}

// Write a Unicode string to the d64 buffer as PETSCII bytes
function writePetsciiString(buffer, offset, str, maxLen, overrides) {
  const data = new Uint8Array(buffer);
  for (let i = 0; i < maxLen; i++) {
    if (i < str.length) {
      // Use override if a specific PETSCII code was set (e.g., reversed chars from picker)
      if (overrides && overrides[i] !== undefined) {
        data[offset + i] = overrides[i];
      } else {
        data[offset + i] = unicodeToPetscii(str[i]);
      }
    } else {
      data[offset + i] = 0xA0; // padding
    }
  }
}

// ── Safe PETSCII characters ───────────────────────────────────────────
let allowUnsafeChars = localStorage.getItem('d64-allowUnsafe') === 'true';

// Bytes that are safe to use in C64 filenames
// Unsafe: $00(NULL), $0D(CR), $14(DEL), $22("), $60-$7F(GFX set 1),
//         $8D(shifted CR), $A0(padding), $E0-$FE(GFX duplicates), $FF(π)
const SAFE_PETSCII = new Set([
  0x01,0x02,0x03,0x04,0x05,0x06,0x07,0x08,0x09,0x0A,0x0B,0x0C,0x0E,0x0F,
  0x10,0x11,0x12,0x13,0x15,0x16,0x17,0x18,0x19,0x1A,0x1B,0x1C,0x1D,0x1E,0x1F,
  0x20,0x21,0x23,0x24,0x25,0x26,0x27,0x28,0x29,0x2A,0x2B,0x2C,0x2D,0x2E,0x2F,
  0x30,0x31,0x32,0x33,0x34,0x35,0x36,0x37,0x38,0x39,0x3A,0x3B,0x3C,0x3D,0x3E,0x3F,
  0x40,0x41,0x42,0x43,0x44,0x45,0x46,0x47,0x48,0x49,0x4A,0x4B,0x4C,0x4D,0x4E,0x4F,
  0x50,0x51,0x52,0x53,0x54,0x55,0x56,0x57,0x58,0x59,0x5A,0x5B,0x5C,0x5D,0x5E,0x5F,
  0x80,0x81,0x82,0x83,0x84,0x85,0x86,0x87,0x88,0x89,0x8A,0x8B,0x8C,0x8E,0x8F,
  0x90,0x91,0x92,0x93,0x94,0x95,0x96,0x97,0x98,0x99,0x9A,0x9B,0x9C,0x9D,0x9E,0x9F,
  0xA1,0xA2,0xA3,0xA4,0xA5,0xA6,0xA7,0xA8,0xA9,0xAA,0xAB,0xAC,0xAD,0xAE,0xAF,
  0xB0,0xB1,0xB2,0xB3,0xB4,0xB5,0xB6,0xB7,0xB8,0xB9,0xBA,0xBB,0xBC,0xBD,0xBE,0xBF,
  0xC0,0xC1,0xC2,0xC3,0xC4,0xC5,0xC6,0xC7,0xC8,0xC9,0xCA,0xCB,0xCC,0xCD,0xCE,0xCF,
  0xD0,0xD1,0xD2,0xD3,0xD4,0xD5,0xD6,0xD7,0xD8,0xD9,0xDA,0xDB,0xDC,0xDD,0xDE,0xDF,
]);

// ── PETSCII Picker ───────────────────────────────────────────────────
const petsciiPicker = document.getElementById('petscii-picker');
let pickerTarget = null; // the element being edited
let pickerMaxLen = 16;
let pickerClicking = false; // prevents blur during picker interaction

// C64 keyboard layout: [label, normal, shift, cbm] per key
// In uppercase mode: normal = lowercase display (0x41-0x5A), shift = uppercase (0xC1-0xDA)
// Graphics: on key fronts — right side = shift, left side = cbm
const KB_ROWS = [
  // Row 1: ← 1-9 0 + - £
  [['←',0x5F,-1,-1],['1',0x31,0x21,-1],['2',0x32,0x22,-1],['3',0x33,0x23,-1],['4',0x34,0x24,-1],['5',0x35,0x25,-1],['6',0x36,0x26,-1],['7',0x37,0x27,-1],['8',0x38,0x28,-1],['9',0x39,0x29,-1],['0',0x30,-1,-1],['+',0x2B,-1,-1],['-',0x2D,-1,-1],['£',0x5C,-1,-1]],
  // Row 2: Q-P @ * ↑
  [['q',0x51,0xC1,0xAB],['w',0x57,0xC7,0xB3],['e',0x45,0xC5,0xB1],['r',0x52,0xD2,0xB2],['t',0x54,0xD4,0xA3],['y',0x59,0xD9,0xB7],['u',0x55,0xD5,0xB8],['i',0x49,0xC9,0xA2],['o',0x4F,0xCF,0xB9],['p',0x50,0xD0,0xAF],['@',0x40,0xBA,-1],['*',0x2A,0xC0,-1],['↑',0x5E,0xFF,-1]],
  // Row 3: A-L : ; =
  [['a',0x41,0xC1,0xB0],['s',0x53,0xD3,0xAE],['d',0x44,0xC4,0xAC],['f',0x46,0xC6,0xBB],['g',0x47,0xC7,0xA5],['h',0x48,0xC8,0xB4],['j',0x4A,0xCA,0xB5],['k',0x4B,0xCB,0xA1],['l',0x4C,0xCC,0xB6],[':',0x3A,0x5B,-1],[';',0x3B,0x5D,-1],['=',0x3D,-1,-1]],
  // Row 4: Z-M , . /
  [['z',0x5A,0xDA,0xAD],['x',0x58,0xD8,0xBD],['c',0x43,0xC3,0xBC],['v',0x56,0xD6,0xBE],['b',0x42,0xC2,0xBF],['n',0x4E,0xCE,0xAA],['m',0x4D,0xCD,0xA7],[',',0x2C,0x3C,-1],['.',0x2E,0x3E,-1],['/',0x2F,0x3F,-1]],
];

// Front-of-key graphics (SHIFT+letter → right graphic, same PETSCII as shift column above
// but we also allow the 0x60-0x7F graphics via a separate "GFX" mode)
// GFX keys use 0xC0-0xDF range (safe) instead of 0x60-0x7F (unsafe)
// Both map to the same screen codes (64-95) on the C64
const KB_GFX_ROW2 = [0xD1,0xD7,0xC5,0xD2,0xD4,0xD9,0xD5,0xC9,0xCF,0xD0];
const KB_GFX_ROW3 = [0xC1,0xD3,0xC4,0xC6,0xC7,0xC8,0xCA,0xCB,0xCC];
const KB_GFX_ROW4 = [0xDA,0xD8,0xC3,0xD6,0xC2,0xCE,0xCD];

let pickerModifier = 'normal'; // 'normal', 'shift', 'gfx', 'cbm'
let pickerReverse = false;

function buildPetsciiPicker() {
  renderPicker();

  petsciiPicker.addEventListener('mousedown', (e) => {
    e.preventDefault();
    e.stopPropagation();
    pickerClicking = true;
    setTimeout(() => { pickerClicking = false; }, 100);

    // Modifier buttons
    const mod = e.target.closest('.petscii-mod');
    if (mod) {
      if (mod.classList.contains('disabled')) return;
      const m = mod.dataset.mod;
      if (m === 'rev') {
        pickerReverse = !pickerReverse;
      } else {
        pickerModifier = (pickerModifier === m) ? 'normal' : m;
      }
      renderPicker();
      return;
    }

    // Character keys
    const key = e.target.closest('.petscii-key');
    if (!key || !pickerTarget || key.classList.contains('empty') || key.classList.contains('disabled')) return;
    let code = parseInt(key.dataset.code, 10);
    if (code < 0) return;

    // Apply reverse where PETSCII has reversed equivalents:
    // 0x40-0x5F (@,A-Z,[,£,],↑,←) → 0x00-0x1F (reversed)
    // 0xC0-0xDF (same chars, shifted) → 0x80-0x9F (reversed)
    // Other ranges (graphics, punctuation) have no PETSCII reversed codes
    let actualCode = code;
    if (pickerReverse) {
      if (code >= 0x40 && code <= 0x5F) actualCode = code - 0x40;
      else if (code >= 0xC0 && code <= 0xDF) actualCode = code - 0xC0 + 0x80;
    }

    const ch = PETSCII_MAP[actualCode];
    insertAtCursor(pickerTarget, ch, actualCode);
  });
}

function renderPicker() {
  let html = '<div class="petscii-modifiers">';
  html += '<div class="petscii-mod' + (pickerModifier === 'shift' ? ' active' : '') + '" data-mod="shift">SHIFT</div>';
  html += '<div class="petscii-mod' + (pickerModifier === 'gfx' ? ' active' : '') + '" data-mod="gfx">GFX</div>';
  html += '<div class="petscii-mod' + (pickerModifier === 'cbm' ? ' active' : '') + '" data-mod="cbm">CBM</div>';
  html += '<div class="petscii-mod' + (pickerReverse ? ' active' : '') + '" data-mod="rev">RVS</div>';
  html += '</div>';

  for (let r = 0; r < KB_ROWS.length; r++) {
    const row = KB_ROWS[r];
    html += '<div class="petscii-kb-row">';
    for (let k = 0; k < row.length; k++) {
      const [label, normal, shift, cbm] = row[k];
      let code;
      if (pickerModifier === 'shift') code = shift;
      else if (pickerModifier === 'cbm') code = cbm;
      else if (pickerModifier === 'gfx') {
        // GFX keys: use safe 0xC0-0xDF codes but display the 0x60-0x7F glyphs
        if (r === 1 && k < 10) code = KB_GFX_ROW2[k];
        else if (r === 2 && k < 9) code = KB_GFX_ROW3[k];
        else if (r === 3 && k < 7) code = KB_GFX_ROW4[k];
        else code = -1;
      }
      else code = normal;

      if (code === -1) {
        html += '<div class="petscii-key empty" data-code="-1"></div>';
      } else {
        // Determine actual code after reverse
        let actualCode = code;
        if (pickerReverse) {
          if (code >= 0x40 && code <= 0x5F) actualCode = code - 0x40;
          else if (code >= 0xC0 && code <= 0xDF) actualCode = code - 0xC0 + 0x80;
        }
        const isSafe = SAFE_PETSCII.has(actualCode);
        const disabled = !isSafe && !allowUnsafeChars;
        // For GFX mode, show the graphic glyph from 0x60-0x7F range (same screen code)
        const displayCode = (pickerModifier === 'gfx' && code >= 0xC0 && code <= 0xDF) ? code - 0x60 : code;
        const ch = PETSCII_MAP[displayCode];
        const title = label + ' → $' + code.toString(16).toUpperCase().padStart(2, '0') + (pickerReverse ? ' (RVS)' : '') + (!isSafe ? ' (unsafe)' : '');
        html += '<div class="petscii-key' + (pickerReverse ? ' rev-char' : '') + (disabled ? ' disabled' : (!isSafe ? ' unsafe' : '')) + '" data-code="' + code + '" title="' + title + '">' + escHtml(ch) + '</div>';
      }
    }
    html += '</div>';
  }

  // Space bar row
  html += '<div class="petscii-kb-row">';
  html += '<div class="petscii-key space" data-code="32">SPACE</div>';
  html += '</div>';

  petsciiPicker.innerHTML = html;
}

function trackCursorPos(input) {
  const update = () => { input._lastCursorPos = input.selectionStart; };
  input.addEventListener('keyup', update);
  input.addEventListener('click', update);
  input.addEventListener('input', update);
  update();
}

function insertAtCursor(el, ch, petsciiCode) {
  if (el.tagName === 'INPUT') {
    // Always use tracked position — browser may reset selectionStart on blur/refocus
    const start = el._lastCursorPos != null ? el._lastCursorPos : (el.selectionStart || 0);
    const end = start;
    const val = el.value;
    const maxLen = el.maxLength || Infinity;
    const newVal = val.slice(0, start) + ch + val.slice(end);
    if (newVal.length > maxLen) return; // enforce max length
    el.value = newVal;

    // Track raw PETSCII bytes for characters that can't round-trip via Unicode
    if (petsciiCode !== undefined) {
      if (!el._petsciiOverrides) el._petsciiOverrides = {};
      el._petsciiOverrides[start] = petsciiCode;
    }

    // Focus first, then set cursor position
    el.focus();
    const newPos = start + ch.length;
    el.selectionStart = el.selectionEnd = newPos;
    el._lastCursorPos = newPos;
    return;
  }

  if (el.isContentEditable) {
    el.focus();
    const sel = window.getSelection();
    if (sel.rangeCount > 0) {
      const range = sel.getRangeAt(0);
      range.deleteContents();
      range.insertNode(document.createTextNode(ch));
      range.collapse(false);
      sel.removeAllRanges();
      sel.addRange(range);
    } else {
      el.textContent += ch;
    }
  }
}

function showPetsciiPicker(targetEl, maxLen) {
  pickerTarget = targetEl;
  pickerMaxLen = maxLen;
  pickerModifier = 'normal';
  renderPicker();

  const rect = targetEl.getBoundingClientRect();
  petsciiPicker.classList.add('open');

  let top = rect.bottom + 4;
  let left = rect.left;

  const pickerRect = petsciiPicker.getBoundingClientRect();
  if (top + pickerRect.height > window.innerHeight) {
    top = rect.top - pickerRect.height - 4;
  }
  if (left + pickerRect.width > window.innerWidth) {
    left = window.innerWidth - pickerRect.width - 8;
  }

  petsciiPicker.style.top = Math.max(0, top) + 'px';
  petsciiPicker.style.left = Math.max(0, left) + 'px';
}

function hidePetsciiPicker() {
  petsciiPicker.classList.remove('open');
  pickerTarget = null;
}

buildPetsciiPicker();

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
  if (data.length < D64_SIZE_35) throw new Error('File too small to be a valid .d64');

  const numTracks = detectTrackCount(data.length);
  currentTracks = numTracks;

  // BAM is at track 18, sector 0
  const bamOffset = sectorOffset(18, 0);

  const diskName = readPetsciiString(data, bamOffset + 0x90, 16);
  const diskId = readPetsciiString(data, bamOffset + 0xA2, 5, false);

  // Count free blocks from BAM (skip track 18)
  // Note: tracks 36-40 on extended D64 are NOT in the standard BAM
  // The 1541 only stores BAM for tracks 1-35
  let freeBlocks = 0;
  for (let t = 1; t <= Math.min(numTracks, 35); t++) {
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

      // Skip completely unused slots: type=0, no file track/sector,
      // no name data, and no block count
      if (typeByte === 0x00) {
        const fileTrack = data[entryOff + 3];
        const fileSector = data[entryOff + 4];
        const blocks = data[entryOff + 30] | (data[entryOff + 31] << 8);
        let hasName = false;
        for (let j = 0; j < 16; j++) {
          if (data[entryOff + 5 + j] !== 0x00 && data[entryOff + 5 + j] !== 0xA0) {
            hasName = true; break;
          }
        }
        if (!hasName && fileTrack === 0 && fileSector === 0 && blocks === 0) continue;
      }

      const name = readPetsciiString(data, entryOff + 5, 16);

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
function createEmptyD64(numTracks) {
  numTracks = numTracks || 35;
  const totalSectors = (() => {
    let s = 0;
    for (let t = 1; t <= numTracks; t++) s += sectorsPerTrack(t);
    return s;
  })();
  const data = new Uint8Array(totalSectors * 256);

  // BAM at track 18, sector 0
  const bamOff = sectorOffset(18, 0);
  data[bamOff + 0] = 18;  // directory track
  data[bamOff + 1] = 1;   // directory sector
  data[bamOff + 2] = 0x41; // DOS version 'A'

  // BAM entries for tracks 1-35 (standard BAM only covers 35 tracks)
  const bamTracks = Math.min(numTracks, 35);
  for (let t = 1; t <= bamTracks; t++) {
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

  // BAM byte 3: 0x00 (unused, should be 0x00 on 1541)
  data[bamOff + 3] = 0x00;

  // Disk name at 0x90-0x9F: all 0xA0 (no name)
  for (let i = 0; i < 16; i++) {
    data[bamOff + 0x90 + i] = 0xA0;
  }

  // Bytes 0xA0-0xA1: 0xA0 (fill bytes between name and ID)
  data[bamOff + 0xA0] = 0xA0;
  data[bamOff + 0xA1] = 0xA0;

  // Disk ID at 0xA2-0xA3: 0xA0 (no ID)
  data[bamOff + 0xA2] = 0xA0;
  data[bamOff + 0xA3] = 0xA0;

  // Byte 0xA4: 0xA0 (fill)
  data[bamOff + 0xA4] = 0xA0;

  // DOS type at 0xA5-0xA6: "2A"
  data[bamOff + 0xA5] = 0x32; // '2'
  data[bamOff + 0xA6] = 0x41; // 'A'

  // Bytes 0xA7-0xAA: 0xA0 (fill)
  for (let i = 0xA7; i <= 0xAA; i++) {
    data[bamOff + i] = 0xA0;
  }

  // First directory sector at track 18, sector 1
  const dirOff = sectorOffset(18, 1);
  data[dirOff + 0] = 0x00; // no next track (end of chain)
  data[dirOff + 1] = 0xFF; // standard end-of-chain marker
  // All 8 entries are zeroed (already 0x00 from Uint8Array init)

  return data.buffer;
}

// ── Current disk state ─────────────────────────────────────────────────
let currentBuffer = null;
let currentFileName = null;
let currentTracks = 35;
let showDeleted = localStorage.getItem('d64-showDeleted') !== 'false'; // default true
let selectedEntryIndex = -1;
let showAddresses = localStorage.getItem('d64-showAddresses') === 'true';
let showTrackSector = localStorage.getItem('d64-showTrackSector') === 'true';

// ── Allowed C64 characters ────────────────────────────────────────────
function isValidPetscii(ch) {
  return UNICODE_TO_PETSCII.has(ch);
}

function filterC64Input(str, maxLen) {
  return Array.from(str).filter(ch => isValidPetscii(ch)).slice(0, maxLen).join('');
}

// ── Write header fields back to D64 buffer ────────────────────────────
function writeDiskName(buffer, name, overrides) {
  writePetsciiString(buffer, sectorOffset(18, 0) + 0x90, name, 16, overrides);
}

function writeDiskId(buffer, id, overrides) {
  writePetsciiString(buffer, sectorOffset(18, 0) + 0xA2, id, 5, overrides);
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
  const numTracks = currentTracks;
  const log = [];

  // Allocation map: true = used
  const allocated = [];
  for (let t = 0; t <= numTracks; t++) {
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
      if (t < 1 || t > numTracks) {
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
    if (dirTrack < 1 || dirTrack > numTracks || dirSector < 0 || dirSector >= sectorsPerTrack(dirTrack)) {
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

  // Rebuild BAM from allocation map (BAM only covers tracks 1-35)
  let bamErrors = 0;
  for (let t = 1; t <= Math.min(numTracks, 35); t++) {
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
    <div class="disk-panel${showAddresses ? ' show-addresses' : ''}${showTrackSector ? ' show-tracksector' : ''}">
      <div class="disk-header">
        <div class="disk-header-spacer">0</div>
        <div class="disk-name"><span class="editable" id="edit-name" data-field="name" data-max="16">"${escHtml(info.diskName.padEnd(16))}"</span></div>
        <div class="disk-id"><span class="editable" id="edit-id" data-field="id" data-max="5">${escHtml(info.diskId)}</span></div>
      </div>
      <div class="dir-listing">
        <div class="dir-entry dir-header-row">
          <span class="dir-grip"></span>
          <span class="dir-blocks">Size</span>
          <span class="dir-name">Filename</span>
          <span class="dir-type">Type</span>
          <span class="dir-ts">T/S</span>
          <span class="dir-addr">Address</span>
        </div>`;

  let entries = info.entries.filter(e => !e.deleted || showDeleted);

  for (const e of entries) {
    // Render filename with reversed character support
    const richName = currentBuffer ? readPetsciiRich(new Uint8Array(currentBuffer), e.entryOff + 5, 16) : null;
    let nameHtml;
    if (richName) {
      const nameStr = richName.map(c =>
        c.reversed ? '<span class="petscii-rev">' + escHtml(c.char) + '</span>' : escHtml(c.char)
      ).join('');
      // Closing quote after content, then pad to fill 18 chars total (quote + 16 + quote)
      const pad = Math.max(0, 16 - richName.length);
      nameHtml = '"' + nameStr + '"' + ' '.repeat(pad);
    } else {
      const pad = Math.max(0, 16 - e.name.length);
      nameHtml = '"' + escHtml(e.name) + '"' + ' '.repeat(pad);
    }

    // Get file addresses if showing
    let addrHtml = '';
    if (showAddresses && currentBuffer) {
      const addr = getFileAddresses(currentBuffer, e.entryOff);
      if (addr) {
        const s = '$' + addr.start.toString(16).toUpperCase().padStart(4, '0');
        const en = '$' + addr.end.toString(16).toUpperCase().padStart(4, '0');
        addrHtml = s + '-' + en;
      }
    }

    html += `
        <div class="dir-entry${e.deleted ? ' deleted' : ''}" data-offset="${e.entryOff}" draggable="true">
          <span class="dir-grip"><i class="fa-solid fa-grip-vertical"></i></span>
          <span class="dir-blocks">${e.blocks}</span>
          <span class="dir-name">${nameHtml}</span>
          <span class="dir-type">${escHtml(e.type)}</span>
          <span class="dir-ts">${currentBuffer ? ('$' + new Uint8Array(currentBuffer)[e.entryOff + 3].toString(16).toUpperCase().padStart(2, '0') + ' $' + new Uint8Array(currentBuffer)[e.entryOff + 4].toString(16).toUpperCase().padStart(2, '0')) : ''}</span>
          <span class="dir-addr">${addrHtml}</span>
        </div>`;
  }

  html += `
      </div>
      <div class="dir-footer">
        <span class="dir-footer-blocks">${info.freeBlocks}</span>
        <span class="dir-footer-label">blocks free.</span>
        <span class="dir-footer-tracks">${currentTracks} tracks</span>
      </div>
    </div>`;

  content.innerHTML = html;
  bindEditableFields();
  bindDirSelection();

  // Double-click on blocks free to edit
  const footerBlocks = document.querySelector('.dir-footer-blocks');
  if (footerBlocks) {
    footerBlocks.style.cursor = 'pointer';
    footerBlocks.addEventListener('dblclick', () => {
      startEditFreeBlocks(footerBlocks);
    });
  }

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

let activeEditEl = null;
let activeEditCleanup = null;

function registerActiveEdit(el, cleanup) {
  activeEditEl = el;
  activeEditCleanup = cleanup;
}

function cancelActiveEdits() {
  if (activeEditEl && activeEditCleanup) {
    activeEditCleanup();
  }
  activeEditEl = null;
  activeEditCleanup = null;
}

function bindDirSelection() {
  const entries = document.querySelectorAll('.dir-entry:not(.dir-header-row)');
  let dragSrcOffset = null;

  entries.forEach(el => {
    // Click to select/deselect
    el.addEventListener('click', (e) => {
      if (e.target.tagName === 'INPUT' || e.target.classList.contains('editing') || e.target.closest('.editing')) return;
      cancelActiveEdits();
      const wasSelected = el.classList.contains('selected');
      entries.forEach(e => e.classList.remove('selected'));
      if (wasSelected) {
        selectedEntryIndex = -1;
      } else {
        el.classList.add('selected');
        selectedEntryIndex = parseInt(el.dataset.offset, 10);
      }
      updateEntryMenuState();
    });

    // Double-click to edit
    el.addEventListener('dblclick', (e) => {
      if (e.target.classList.contains('dir-type')) {
        const entryOff = parseInt(el.dataset.offset, 10);
        showTypeDropdown(e.target, entryOff);
      } else if (e.target.classList.contains('dir-blocks')) {
        startEditBlockSize(el);
      } else {
        startRenameEntry(el);
      }
    });

    // Drag and drop
    el.addEventListener('dragstart', (e) => {
      dragSrcOffset = parseInt(el.dataset.offset, 10);
      el.classList.add('dragging');
      e.dataTransfer.effectAllowed = 'move';
    });

    el.addEventListener('dragend', () => {
      el.classList.remove('dragging');
      entries.forEach(e => { e.classList.remove('drag-over-top', 'drag-over-bottom'); });
      dragSrcOffset = null;
    });

    el.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      entries.forEach(e => { e.classList.remove('drag-over-top', 'drag-over-bottom'); });
      const rect = el.getBoundingClientRect();
      const midY = rect.top + rect.height / 2;
      if (e.clientY < midY) {
        el.classList.add('drag-over-top');
      } else {
        el.classList.add('drag-over-bottom');
      }
    });

    el.addEventListener('dragleave', () => {
      el.classList.remove('drag-over-top', 'drag-over-bottom');
    });

    el.addEventListener('drop', (e) => {
      e.preventDefault();
      entries.forEach(e => { e.classList.remove('drag-over-top', 'drag-over-bottom'); });
      if (dragSrcOffset === null || !currentBuffer) return;

      const targetOffset = parseInt(el.dataset.offset, 10);
      if (dragSrcOffset === targetOffset) return;

      const slots = getDirSlotOffsets(currentBuffer);
      const srcIdx = slots.indexOf(dragSrcOffset);
      let targetIdx = slots.indexOf(targetOffset);
      if (srcIdx < 0 || targetIdx < 0) return;

      // Determine if dropping above or below
      const rect = el.getBoundingClientRect();
      const midY = rect.top + rect.height / 2;
      if (e.clientY >= midY && targetIdx < srcIdx) targetIdx++;
      else if (e.clientY < midY && targetIdx > srcIdx) targetIdx--;

      // Move by repeatedly swapping adjacent entries
      const dir = targetIdx > srcIdx ? 1 : -1;
      let cur = srcIdx;
      while (cur !== targetIdx) {
        swapDirEntries(currentBuffer, slots[cur], slots[cur + dir]);
        cur += dir;
      }

      selectedEntryIndex = slots[targetIdx];
      const info = parseD64(currentBuffer);
      renderDisk(info);
    });
  });

}

// Click outside dir entries deselects (registered once)
document.addEventListener('click', (e) => {
  if (!e.target.closest('.dir-entry') && !e.target.closest('.menu-item') && !e.target.closest('.petscii-picker') && !e.target.closest('.type-dropdown')) {
    document.querySelectorAll('.dir-entry.selected').forEach(el => el.classList.remove('selected'));
    selectedEntryIndex = -1;
    updateEntryMenuState();
  }
});

// Keyboard: Arrow Up/Down to select, Ctrl+Arrow to move entry
// Registered once outside bindDirSelection to avoid stacking listeners
document.addEventListener('keydown', (e) => {
  if (!currentBuffer) return;
  if (document.activeElement && (document.activeElement.tagName === 'INPUT' || document.activeElement.isContentEditable)) return;

  // Enter: edit selected filename
  if (e.key === 'Enter' && selectedEntryIndex >= 0) {
    e.preventDefault();
    const selected = document.querySelector('.dir-entry.selected');
    if (selected) startRenameEntry(selected);
    return;
  }

  // Delete: remove selected entry
  if (e.key === 'Delete' && selectedEntryIndex >= 0 && currentBuffer) {
    e.preventDefault();
    const slots = getDirSlotOffsets(currentBuffer);
    const idx = slots.indexOf(selectedEntryIndex);
    removeFileEntry(currentBuffer, selectedEntryIndex);
    const info = parseD64(currentBuffer);
    // Select next entry, or previous if at end
    const visibleEntries = info.entries.filter(en => !en.deleted || showDeleted);
    if (visibleEntries.length > 0) {
      const newIdx = Math.min(idx, visibleEntries.length - 1);
      selectedEntryIndex = visibleEntries[newIdx].entryOff;
    } else {
      selectedEntryIndex = -1;
    }
    renderDisk(info);
    return;
  }

  if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
  e.preventDefault();

  const dir = e.key === 'ArrowUp' ? -1 : 1;

  if (e.ctrlKey && selectedEntryIndex >= 0) {
    // Ctrl+Arrow: move the selected entry
    moveEntry(dir);
  } else {
    // Arrow: select next/previous entry
    const allEntries = document.querySelectorAll('.dir-entry:not(.dir-header-row)');
    if (allEntries.length === 0) return;

    if (selectedEntryIndex < 0) {
      // Nothing selected — select first or last
      const target = dir === 1 ? allEntries[0] : allEntries[allEntries.length - 1];
      allEntries.forEach(el => el.classList.remove('selected'));
      target.classList.add('selected');
      selectedEntryIndex = parseInt(target.dataset.offset, 10);
      target.scrollIntoView({ block: 'nearest' });
    } else {
      // Find current index in the DOM list
      let currentIdx = -1;
      allEntries.forEach((el, i) => {
        if (parseInt(el.dataset.offset, 10) === selectedEntryIndex) currentIdx = i;
      });
      const newIdx = currentIdx + dir;
      if (newIdx >= 0 && newIdx < allEntries.length) {
        allEntries.forEach(el => el.classList.remove('selected'));
        allEntries[newIdx].classList.add('selected');
        selectedEntryIndex = parseInt(allEntries[newIdx].dataset.offset, 10);
        allEntries[newIdx].scrollIntoView({ block: 'nearest' });
      }
    }
    updateEntryMenuState();
  }
});

function updateEntryMenuState() {
  const hasSelection = selectedEntryIndex >= 0 && currentBuffer;
  document.getElementById('opt-rename').classList.toggle('disabled', !hasSelection);
  document.getElementById('opt-insert').classList.toggle('disabled', !currentBuffer || !canInsertFile());
  document.getElementById('opt-remove').classList.toggle('disabled', !hasSelection);
  document.getElementById('opt-align').classList.toggle('disabled', !hasSelection);
  document.getElementById('opt-block-size').classList.toggle('disabled', !hasSelection);
  document.getElementById('opt-recalc-size').classList.toggle('disabled', !hasSelection);
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
      document.getElementById('check-type-' + i).innerHTML = i === currentTypeIdx ? '<i class="fa-solid fa-check"></i>' : '';
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
  if (el.querySelector('input')) return;
  const field = el.dataset.field;
  const maxLen = parseInt(el.dataset.max, 10);
  // Read actual content from buffer (stops at 0xA0 padding)
  let currentValue = '';
  if (currentBuffer) {
    const data = new Uint8Array(currentBuffer);
    const bamOff = sectorOffset(18, 0);
    if (field === 'name') currentValue = readPetsciiString(data, bamOff + 0x90, 16);
    else if (field === 'id') currentValue = readPetsciiString(data, bamOff + 0xA2, 5);
  } else {
    const isEmpty = el.classList.contains('empty');
    currentValue = isEmpty ? '' : el.textContent;
  }

  const input = document.createElement('input');
  input.type = 'text';
  input.maxLength = maxLen;
  input.value = currentValue;
  input.className = 'header-input';

  el.textContent = '';
  el.appendChild(input);
  el.classList.add('editing');
  el.classList.remove('empty');
  trackCursorPos(input);
  input.focus();
  input.selectionStart = input.selectionEnd = currentValue.length;

  showPetsciiPicker(input, maxLen);

  function setDisplay(value) {
    el.classList.remove('empty');
    if (field === 'name') {
      el.textContent = '"' + value.padEnd(16) + '"';
    } else {
      el.textContent = value;
    }
  }

  let reverted = false;

  function cleanup() {
    el.classList.remove('editing');
    hidePetsciiPicker();
  }

  function commitEdit() {
    if (reverted) return;
    let value = filterC64Input(input.value, maxLen);
    if (currentBuffer) {
      if (field === 'name') writeDiskName(currentBuffer, value, input._petsciiOverrides);
      else if (field === 'id') writeDiskId(currentBuffer, value, input._petsciiOverrides);
    }
    cleanup();
    setDisplay(value);
  }

  function revert() {
    reverted = true;
    cleanup();
    setDisplay(currentValue);
  }

  input.addEventListener('blur', () => {
    if (pickerClicking) { input.focus(); input.selectionStart = input.selectionEnd = input._lastCursorPos || 0; return; }
    commitEdit();
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); commitEdit(); }
    else if (e.key === 'Escape') { e.preventDefault(); revert(); }
  });
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
  document.getElementById('opt-edit-free').classList.toggle('disabled', !hasDisk);
  document.getElementById('opt-recalc-free').classList.toggle('disabled', !hasDisk);
}

// ── Menu logic ────────────────────────────────────────────────────────
const fileInput = document.getElementById('file-input');
let openMenu = null;

function closeMenus() {
  document.querySelectorAll('.menu-item').forEach(m => m.classList.remove('open'));
  document.querySelector('.menubar').classList.remove('menu-active');
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
      document.querySelector('.menubar').classList.add('menu-active');
      openMenu = menu;
    }
  });
  menu.addEventListener('mouseenter', () => {
    if (openMenu && openMenu !== menu) {
      openMenu.classList.remove('open');
      menu.classList.add('open');
      openMenu = menu;
    }
  });
});

document.addEventListener('click', () => {
  closeMenus();
});

document.querySelectorAll('#opt-new .submenu .option').forEach(el => {
  el.addEventListener('click', (e) => {
    e.stopPropagation();
    closeMenus();
    const tracks = parseInt(el.dataset.tracks, 10);
    const buf = createEmptyD64(tracks);
    currentBuffer = buf;
    currentFileName = null;
    const info = parseD64(buf);
    renderDisk(info);
    updateMenuState();
  });
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

document.getElementById('opt-save-as').addEventListener('click', async (e) => {
  e.stopPropagation();
  if (!currentBuffer) return;
  closeMenus();
  const defaultName = currentFileName || 'disk.d64';
  const fileName = await showInputModal('Save As', defaultName);
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
  localStorage.setItem('d64-showDeleted', showDeleted);
  document.getElementById('check-deleted').innerHTML = showDeleted ? '<i class="fa-solid fa-check"></i>' : '';
  const info = parseD64(currentBuffer);
  renderDisk(info);
});

document.querySelectorAll('#opt-sort .submenu .option').forEach(el => {
  el.addEventListener('click', (e) => {
    e.stopPropagation();
    if (!currentBuffer) return;
    closeMenus();
    sortDirectory(currentBuffer, el.dataset.sort);
    const info = parseD64(currentBuffer);
    renderDisk(info);
  });
});

// ── View menu ─────────────────────────────────────────────────────────
document.getElementById('opt-show-addr').addEventListener('click', (e) => {
  e.stopPropagation();
  closeMenus();
  showAddresses = !showAddresses;
  localStorage.setItem('d64-showAddresses', showAddresses);
  document.getElementById('check-addr').innerHTML = showAddresses ? '<i class="fa-solid fa-check"></i>' : '';
  if (currentBuffer) {
    const info = parseD64(currentBuffer);
    renderDisk(info);
  }
});

document.getElementById('opt-show-ts').addEventListener('click', (e) => {
  e.stopPropagation();
  closeMenus();
  showTrackSector = !showTrackSector;
  localStorage.setItem('d64-showTrackSector', showTrackSector);
  document.getElementById('check-ts').innerHTML = showTrackSector ? '<i class="fa-solid fa-check"></i>' : '';
  if (currentBuffer) {
    const info = parseD64(currentBuffer);
    renderDisk(info);
  }
});

// ── Options menu ──────────────────────────────────────────────────────
document.getElementById('opt-unsafe-chars').addEventListener('click', (e) => {
  e.stopPropagation();
  closeMenus();
  allowUnsafeChars = !allowUnsafeChars;
  localStorage.setItem('d64-allowUnsafe', allowUnsafeChars);
  document.getElementById('check-unsafe').innerHTML = allowUnsafeChars ? '<i class="fa-solid fa-check"></i>' : '';
  // Re-render picker if open
  if (pickerTarget) renderPicker();
});

document.getElementById('opt-edit-free').addEventListener('click', (e) => {
  e.stopPropagation();
  if (!currentBuffer) return;
  closeMenus();
  const footerBlocks = document.querySelector('.dir-footer-blocks');
  if (footerBlocks) startEditFreeBlocks(footerBlocks);
});

document.getElementById('opt-recalc-free').addEventListener('click', (e) => {
  e.stopPropagation();
  if (!currentBuffer) return;
  closeMenus();

  // Recalculate by following all file sector chains to find used sectors,
  // then rebuild the BAM free counts from scratch. Don't trust the existing BAM.
  const data = new Uint8Array(currentBuffer);
  const bamOff = sectorOffset(18, 0);

  // Build allocation map for all tracks
  const used = {};
  for (let t = 1; t <= currentTracks; t++) {
    used[t] = new Uint8Array(sectorsPerTrack(t));
  }

  // Track 18 sector 0 (BAM) is always used
  used[18][0] = 1;

  // Mark directory chain sectors as used
  let dirT = 18, dirS = 1;
  const dirVisited = new Set();
  while (dirT !== 0) {
    const key = `${dirT}:${dirS}`;
    if (dirVisited.has(key)) break;
    dirVisited.add(key);
    if (dirT < 1 || dirT > currentTracks || dirS < 0 || dirS >= sectorsPerTrack(dirT)) break;
    used[dirT][dirS] = 1;
    const off = sectorOffset(dirT, dirS);
    dirT = data[off];
    dirS = data[off + 1];
  }

  // Follow each closed file's sector chain
  const info = parseD64(currentBuffer);
  for (const entry of info.entries) {
    if (entry.deleted) continue;
    let ft = data[entry.entryOff + 3];
    let fs = data[entry.entryOff + 4];
    const visited = new Set();
    while (ft !== 0) {
      if (ft < 1 || ft > currentTracks) break;
      if (fs < 0 || fs >= sectorsPerTrack(ft)) break;
      const key = `${ft}:${fs}`;
      if (visited.has(key)) break;
      visited.add(key);
      used[ft][fs] = 1;
      const off = sectorOffset(ft, fs);
      ft = data[off];
      fs = data[off + 1];
    }
  }

  // Read old total
  const oldInfo = parseD64(currentBuffer);
  const oldFree = oldInfo.freeBlocks;

  // Update only the free block counts per track, leave BAM bitmaps untouched
  // BAM only covers tracks 1-35
  for (let t = 1; t <= Math.min(currentTracks, 35); t++) {
    if (t === 18) continue;
    const spt = sectorsPerTrack(t);
    let free = 0;
    for (let s = 0; s < spt; s++) {
      if (!used[t][s]) free++;
    }
    data[bamOff + 4 * t] = free;
  }

  const updatedInfo = parseD64(currentBuffer);
  renderDisk(updatedInfo);

  const newFree = updatedInfo.freeBlocks;
  if (oldFree === newFree) {
    showModal('Recalculate Blocks Free', ['Blocks free is correct: ' + newFree + '.']);
  } else {
    showModal('Recalculate Blocks Free', ['Changed from ' + oldFree + ' to ' + newFree + ' blocks free.']);
  }
});

// ── Move directory entry ──────────────────────────────────────────────
// Get ordered list of directory entry offsets from the chain
function getDirSlotOffsets(buffer) {
  const data = new Uint8Array(buffer);
  const offsets = [];
  let t = 18, s = 1;
  const visited = new Set();
  while (t !== 0) {
    const key = `${t}:${s}`;
    if (visited.has(key)) break;
    visited.add(key);
    const off = sectorOffset(t, s);
    if (off < 0) break;
    for (let i = 0; i < 8; i++) offsets.push(off + i * 32);
    t = data[off];
    s = data[off + 1];
  }
  return offsets;
}

function swapDirEntries(buffer, offA, offB) {
  if (offA === offB) return;
  const data = new Uint8Array(buffer);
  // Swap bytes 2-31 (entry data, skip 0-1 which are chain links for entry 0)
  for (let j = 2; j < 32; j++) {
    const tmp = data[offA + j];
    data[offA + j] = data[offB + j];
    data[offB + j] = tmp;
  }
}

function moveEntry(direction) {
  if (!currentBuffer || selectedEntryIndex < 0) return;
  const slots = getDirSlotOffsets(currentBuffer);
  const currentIdx = slots.indexOf(selectedEntryIndex);
  if (currentIdx < 0) return;

  const targetIdx = currentIdx + direction;
  if (targetIdx < 0 || targetIdx >= slots.length) return;

  swapDirEntries(currentBuffer, slots[currentIdx], slots[targetIdx]);
  // Update selection to follow the moved entry
  selectedEntryIndex = slots[targetIdx];
  const info = parseD64(currentBuffer);
  renderDisk(info);
}

// ── Sort directory ────────────────────────────────────────────────────
function sortDirectory(buffer, sortType) {
  const data = new Uint8Array(buffer);

  // Collect all directory entry slots (raw 32-byte blocks) from the chain
  const slots = []; // { off, bytes, isEmpty, name, blocks }
  let t = 18, s = 1;
  const visited = new Set();
  const sectorOffsets = [];

  while (t !== 0) {
    const key = `${t}:${s}`;
    if (visited.has(key)) break;
    visited.add(key);
    const off = sectorOffset(t, s);
    if (off < 0) break;
    sectorOffsets.push(off);

    for (let i = 0; i < 8; i++) {
      const eo = off + i * 32;
      const raw = data.slice(eo, eo + 32);
      const typeByte = raw[2];

      // Check if slot is empty
      let isEmpty = true;
      for (let j = 2; j < 32; j++) {
        if (raw[j] !== 0x00) { isEmpty = false; break; }
      }

      const name = readPetsciiString(data, eo + 5, 16);
      const blocks = raw[30] | (raw[31] << 8);

      slots.push({ off: eo, bytes: new Uint8Array(raw), isEmpty, name, blocks, typeByte });
    }

    t = data[off];
    s = data[off + 1];
  }

  // Separate non-empty and empty slots
  const entries = slots.filter(s => !s.isEmpty);
  const empties = slots.filter(s => s.isEmpty);

  // Sort non-empty entries
  if (sortType === 'name-asc') entries.sort((a, b) => a.name.localeCompare(b.name));
  else if (sortType === 'name-desc') entries.sort((a, b) => b.name.localeCompare(a.name));
  else if (sortType === 'blocks-asc') entries.sort((a, b) => a.blocks - b.blocks);
  else if (sortType === 'blocks-desc') entries.sort((a, b) => b.blocks - a.blocks);

  // Recombine: entries first, empties at end
  const sorted = [...entries, ...empties];

  // Write back to the directory sectors in order
  // Note: bytes 0-1 of each entry slot are NOT part of the entry data for entries 1-7.
  // Only entry 0 of each sector uses bytes 0-1 as the chain link (next T/S).
  // For entries 1-7, bytes 0-1 in their 32-byte slot are part of the entry but
  // conventionally unused (the real chain link is only in entry 0).
  for (let i = 0; i < sorted.length && i < slots.length; i++) {
    const targetOff = slots[i].off;
    const srcBytes = sorted[i].bytes;
    // Write bytes 2-31 (skip 0-1 which are chain link for entry 0 or unused)
    for (let j = 2; j < 32; j++) {
      data[targetOff + j] = srcBytes[j];
    }
  }
}

// ── Align filename ────────────────────────────────────────────────────
function getFilenameContent(data, entryOff) {
  // Find content: everything before the first 0xA0 padding byte
  const nameOff = entryOff + 5;
  let contentLen = 16;
  for (let i = 0; i < 16; i++) {
    if (data[nameOff + i] === 0xA0) { contentLen = i; break; }
  }
  const content = [];
  for (let i = 0; i < contentLen; i++) content.push(data[nameOff + i]);
  return content;
}

function writeFilenameAligned(data, entryOff, content) {
  const nameOff = entryOff + 5;
  for (let i = 0; i < 16; i++) {
    data[nameOff + i] = i < content.length ? content[i] : 0xA0;
  }
}

function alignFilename(buffer, entryOff, alignment) {
  const data = new Uint8Array(buffer);
  const content = getFilenameContent(data, entryOff);

  // Strip trailing 0x20 spaces and 0xA0 padding
  while (content.length > 0 && (content[content.length - 1] === 0x20 || content[content.length - 1] === 0xA0)) content.pop();
  // Strip leading 0x20 spaces
  while (content.length > 0 && content[0] === 0x20) content.shift();
  if (content.length === 0 || content.length >= 16) return;

  const result = new Uint8Array(16).fill(0x20); // fill with real spaces
  const padCount = 16 - content.length;

  if (alignment === 'left') {
    for (let i = 0; i < content.length; i++) result[i] = content[i];

  } else if (alignment === 'right') {
    for (let i = 0; i < content.length; i++) result[padCount + i] = content[i];

  } else if (alignment === 'center') {
    const leftPad = Math.floor(padCount / 2);
    for (let i = 0; i < content.length; i++) result[leftPad + i] = content[i];

  } else if (alignment === 'justify') {
    // Split into words (by 0x20 space)
    const words = [];
    let word = [];
    for (const b of content) {
      if (b === 0x20) {
        if (word.length) { words.push(word); word = []; }
      } else {
        word.push(b);
      }
    }
    if (word.length) words.push(word);

    if (words.length <= 1) {
      // Single word — left align
      for (let i = 0; i < content.length; i++) result[i] = content[i];
    } else {
      const totalChars = words.reduce((sum, w) => sum + w.length, 0);
      const totalGaps = words.length - 1;
      const totalSpaces = 16 - totalChars;
      if (totalSpaces < totalGaps) {
        // Not enough room — just left align
        for (let i = 0; i < content.length; i++) result[i] = content[i];
      } else {
        const baseSpaces = Math.floor(totalSpaces / totalGaps);
        let extraSpaces = totalSpaces % totalGaps;
        let pos = 0;
        for (let w = 0; w < words.length; w++) {
          for (const b of words[w]) result[pos++] = b;
          if (w < words.length - 1) {
            let spaces = baseSpaces + (extraSpaces > 0 ? 1 : 0);
            if (extraSpaces > 0) extraSpaces--;
            for (let s = 0; s < spaces; s++) result[pos++] = 0x20;
          }
        }
      }
    }

  } else if (alignment === 'expand') {
    // Pad filename with 0x20 spaces to fill all 16 bytes
    for (let i = 0; i < content.length; i++) result[i] = content[i];
    for (let i = content.length; i < 16; i++) result[i] = 0x20;
  }

  writeFilenameAligned(data, entryOff, result);
}

// ── Remove directory entry ────────────────────────────────────────────
function removeFileEntry(buffer, entryOff) {
  const data = new Uint8Array(buffer);
  const slots = getDirSlotOffsets(buffer);
  const idx = slots.indexOf(entryOff);
  if (idx < 0) return;

  // Shift all entries after the removed one up by one slot
  for (let i = idx; i < slots.length - 1; i++) {
    const src = slots[i + 1];
    const dst = slots[i];
    // Copy bytes 2-31 (entry data, preserve chain links)
    for (let j = 2; j < 32; j++) {
      data[dst + j] = data[src + j];
    }
  }

  // Zero out the last slot (now a duplicate or was already empty)
  const lastSlot = slots[slots.length - 1];
  for (let j = 2; j < 32; j++) {
    data[lastSlot + j] = 0x00;
  }
}

// ── Insert file entry ─────────────────────────────────────────────────
// Max 144 entries: 18 directory sectors on track 18 (sectors 1-18) × 8 entries
const MAX_DIR_ENTRIES = 144;

function countDirEntries() {
  if (!currentBuffer) return 0;
  const data = new Uint8Array(currentBuffer);
  let count = 0;
  let t = 18, s = 1;
  const visited = new Set();
  while (t !== 0) {
    const key = `${t}:${s}`;
    if (visited.has(key)) break;
    visited.add(key);
    const off = sectorOffset(t, s);
    if (off < 0) break;
    for (let i = 0; i < 8; i++) {
      const eo = off + i * 32;
      // Count non-empty slots (any slot that isn't fully zeroed)
      const typeByte = data[eo + 2];
      if (typeByte !== 0x00) { count++; continue; }
      let hasData = false;
      for (let j = 3; j < 32; j++) {
        if (data[eo + j] !== 0x00) { hasData = true; break; }
      }
      if (hasData) count++;
    }
    t = data[off];
    s = data[off + 1];
  }
  return count;
}

function canInsertFile() {
  if (!currentBuffer) return false;
  return countDirEntries() < MAX_DIR_ENTRIES;
}

function insertFileEntry() {
  if (!currentBuffer) return -1;
  const data = new Uint8Array(currentBuffer);
  const bamOff = sectorOffset(18, 0);

  // Walk directory chain, find first empty slot
  let t = 18, s = 1;
  const visited = new Set();
  let lastOff = -1;

  while (t !== 0) {
    const key = `${t}:${s}`;
    if (visited.has(key)) break;
    visited.add(key);
    const off = sectorOffset(t, s);
    if (off < 0) break;
    lastOff = off;

    for (let i = 0; i < 8; i++) {
      const eo = off + i * 32;
      // Check if slot is fully zeroed (unused)
      let isEmpty = true;
      for (let j = 2; j < 32; j++) {
        if (data[eo + j] !== 0x00) { isEmpty = false; break; }
      }
      if (isEmpty) {
        // Found empty slot — write new entry
        writeNewEntry(data, eo);
        return eo;
      }
    }

    t = data[off];
    s = data[off + 1];
  }

  // No empty slots in existing chain — allocate a new directory sector
  // Find a free sector on track 18 (sectors 1-18)
  const spt = sectorsPerTrack(18);
  let newSector = -1;
  for (let cs = 1; cs < spt; cs++) {
    if (visited.has(`18:${cs}`)) continue;
    newSector = cs;
    break;
  }

  if (newSector === -1) return -1; // track 18 full

  // Link the new sector from the last sector in the chain
  if (lastOff >= 0) {
    data[lastOff] = 18;
    data[lastOff + 1] = newSector;
  }

  // Initialize new directory sector
  const newOff = sectorOffset(18, newSector);
  data[newOff] = 0x00; // end of chain
  data[newOff + 1] = 0xFF;
  // Zero out all 8 entries
  for (let i = 2; i < 256; i++) data[newOff + i] = 0x00;

  // Write new entry in first slot
  writeNewEntry(data, newOff);

  // Mark sector as used in BAM
  const bamBase = bamOff + 4 * 18;
  const bm = data[bamBase + 1] | (data[bamBase + 2] << 8) | (data[bamBase + 3] << 16);
  const newBm = bm & ~(1 << newSector);
  data[bamBase + 1] = newBm & 0xFF;
  data[bamBase + 2] = (newBm >> 8) & 0xFF;
  data[bamBase + 3] = (newBm >> 16) & 0xFF;
  // Update free count
  let free = 0;
  for (let cs = 0; cs < spt; cs++) {
    if (newBm & (1 << cs)) free++;
  }
  data[bamBase] = free;

  return newOff;
}

function writeNewEntry(data, entryOff) {
  // Type: PRG, closed
  data[entryOff + 2] = 0x82;
  // File start: track 18, sector 0 (placeholder)
  data[entryOff + 3] = 18;
  data[entryOff + 4] = 0;
  // Filename: filled with 0xA0 (empty name)
  for (let i = 0; i < 16; i++) data[entryOff + 5 + i] = 0xA0;
  // Unused bytes
  for (let i = 21; i < 30; i++) data[entryOff + i] = 0x00;
  // Block size: 0
  data[entryOff + 30] = 0;
  data[entryOff + 31] = 0;
}

// ── File menu: Rename ─────────────────────────────────────────────────
function writeFileName(buffer, entryOff, name, overrides) {
  writePetsciiString(buffer, entryOff + 5, name, 16, overrides);
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
    check.innerHTML = idx === currentTypeIdx ? '<i class="fa-solid fa-check"></i>' : '';
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

// ── Edit block size ───────────────────────────────────────────────────
// Max value for block size field: 16-bit unsigned (2 bytes in directory entry)
const MAX_BLOCKS = 65535;

function getFileAddresses(buffer, entryOff) {
  const data = new Uint8Array(buffer);
  const typeByte = data[entryOff + 2];
  const fileType = typeByte & 0x07;

  let t = data[entryOff + 3];
  let s = data[entryOff + 4];
  if (t === 0) return null;

  // Read first sector to get load address (first 2 data bytes for PRG)
  const firstOff = sectorOffset(t, s);
  if (firstOff < 0) return null;

  // For PRG files, bytes 2-3 of first sector are the load address
  // For other types, there's no standard load address
  const startAddr = data[firstOff + 2] | (data[firstOff + 3] << 8);

  // Follow chain to find total data size
  const visited = new Set();
  let totalBytes = 0;
  let lastUsed = 0;
  while (t !== 0) {
    if (t < 1 || t > currentTracks) break;
    if (s < 0 || s >= sectorsPerTrack(t)) break;
    const key = `${t}:${s}`;
    if (visited.has(key)) break;
    visited.add(key);

    const off = sectorOffset(t, s);
    const nextT = data[off];
    const nextS = data[off + 1];

    if (nextT === 0) {
      // Last sector: nextS = number of bytes used in this sector (1-based)
      lastUsed = nextS;
      totalBytes += Math.max(0, nextS - 1); // -1 because byte count includes the pointer byte
    } else {
      totalBytes += 254; // 256 - 2 byte pointer
    }

    t = nextT;
    s = nextS;
  }

  // For PRG: subtract 2 for the load address bytes stored in the data
  // End address = start + data size - 1
  if (fileType === 2) { // PRG
    const dataSize = Math.max(0, totalBytes - 2);
    const endAddr = (startAddr + dataSize) & 0xFFFF;
    return { start: startAddr, end: endAddr };
  }

  // For other types, show start address and data extent
  const endAddr = (startAddr + Math.max(0, totalBytes - 1)) & 0xFFFF;
  return { start: startAddr, end: endAddr };
}

function countActualBlocks(buffer, entryOff) {
  const data = new Uint8Array(buffer);
  let t = data[entryOff + 3];
  let s = data[entryOff + 4];
  if (t === 0) return 0;

  const visited = new Set();
  let blocks = 0;
  while (t !== 0) {
    if (t < 1 || t > currentTracks) break;
    if (s < 0 || s >= sectorsPerTrack(t)) break;
    const key = `${t}:${s}`;
    if (visited.has(key)) break;
    visited.add(key);
    blocks++;
    const off = sectorOffset(t, s);
    t = data[off + 0];
    s = data[off + 1];
  }
  return blocks;
}

// ── Free blocks editing ───────────────────────────────────────────────
// Free block count per track is a single byte (0-255), stored in BAM.
// BAM only covers tracks 1-35. Data tracks = tracks 1-35 minus track 18.
// 34 data tracks × 255 = 8670 max.
const MAX_FREE_BLOCKS = 8670;

function writeFreeBlocks(buffer, freeBlocks) {
  const data = new Uint8Array(buffer);
  const bamOff = sectorOffset(18, 0);

  // BAM only covers tracks 1-35
  const bamTracks = Math.min(currentTracks, 35);

  // Read current per-track free counts and their max
  const tracks = [];
  let currentTotal = 0;
  for (let t = 1; t <= bamTracks; t++) {
    if (t === 18) continue;
    const free = data[bamOff + 4 * t];
    const spt = sectorsPerTrack(t);
    tracks.push({ t, free, spt });
    currentTotal += free;
  }

  const desired = Math.max(0, freeBlocks);
  const diff = desired - currentTotal;

  if (diff === 0) return;

  if (diff > 0) {
    // Need more free blocks — increase tracks that aren't at max yet
    let remaining = diff;
    for (const tr of tracks) {
      if (remaining <= 0) break;
      const canAdd = Math.min(255, tr.spt) - tr.free;
      if (canAdd > 0) {
        const add = Math.min(remaining, canAdd);
        tr.free += add;
        remaining -= add;
      }
    }
    // If still remaining (exceeding real max), overflow into first tracks
    for (const tr of tracks) {
      if (remaining <= 0) break;
      const canAdd = 255 - tr.free;
      if (canAdd > 0) {
        const add = Math.min(remaining, canAdd);
        tr.free += add;
        remaining -= add;
      }
    }
  } else {
    // Need fewer free blocks — decrease tracks that have free sectors
    let remaining = -diff;
    for (let i = tracks.length - 1; i >= 0; i--) {
      if (remaining <= 0) break;
      const tr = tracks[i];
      const canRemove = tr.free;
      if (canRemove > 0) {
        const remove = Math.min(remaining, canRemove);
        tr.free -= remove;
        remaining -= remove;
      }
    }
  }

  // Write back only the count bytes, leave bitmaps untouched
  for (const tr of tracks) {
    data[bamOff + 4 * tr.t] = tr.free;
  }
}

function countActualFreeBlocks(buffer) {
  const data = new Uint8Array(buffer);
  const bamOff = sectorOffset(18, 0);
  let free = 0;
  const bamTracks = Math.min(currentTracks, 35);
  for (let t = 1; t <= bamTracks; t++) {
    if (t === 18) continue;
    free += data[bamOff + 4 * t];
  }
  return free;
}

function startEditFreeBlocks(blocksSpan) {
  if (!currentBuffer || !blocksSpan) return;
  if (blocksSpan.querySelector('input')) return;

  cancelActiveEdits();
  const currentValue = blocksSpan.textContent.trim();

  const input = document.createElement('input');
  input.type = 'number';
  input.min = '0';
  input.max = String(MAX_FREE_BLOCKS);
  input.value = currentValue;
  input.className = 'blocks-input';

  blocksSpan.textContent = '';
  blocksSpan.appendChild(input);
  blocksSpan.classList.add('editing');
  input.focus();
  input.select();

  let reverted = false;

  function cleanup() {
    blocksSpan.classList.remove('editing');
    activeEditEl = null;
    activeEditCleanup = null;
  }

  function commitEdit() {
    if (reverted) return;
    let value = parseInt(input.value, 10);
    if (isNaN(value) || value < 0) value = 0;
    if (value > MAX_FREE_BLOCKS) value = MAX_FREE_BLOCKS;
    writeFreeBlocks(currentBuffer, value);
    cleanup();
    blocksSpan.textContent = value;
  }

  function revert() {
    reverted = true;
    cleanup();
    blocksSpan.textContent = currentValue;
  }

  input.addEventListener('blur', () => {
    if (pickerClicking) { input.focus(); input.selectionStart = input.selectionEnd = input._lastCursorPos || 0; return; }
    commitEdit();
  });
  input.addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter') { ev.preventDefault(); commitEdit(); }
    else if (ev.key === 'Escape') { ev.preventDefault(); revert(); }
  });

  registerActiveEdit(blocksSpan, revert);
}

function writeBlockSize(buffer, entryOff, blocks) {
  const data = new Uint8Array(buffer);
  data[entryOff + 30] = blocks & 0xFF;
  data[entryOff + 31] = (blocks >> 8) & 0xFF;
}

function startEditBlockSize(entryEl) {
  if (!currentBuffer || !entryEl) return;
  const entryOff = parseInt(entryEl.dataset.offset, 10);
  const blocksSpan = entryEl.querySelector('.dir-blocks');
  if (blocksSpan.querySelector('input')) return;

  cancelActiveEdits();
  const currentValue = blocksSpan.textContent.trim();

  const input = document.createElement('input');
  input.type = 'number';
  input.min = '0';
  input.max = String(MAX_BLOCKS);
  input.value = currentValue;
  input.className = 'blocks-input';

  blocksSpan.textContent = '';
  blocksSpan.appendChild(input);
  blocksSpan.classList.add('editing');
  input.focus();
  input.select();

  let reverted = false;

  function cleanup() {
    blocksSpan.classList.remove('editing');
    activeEditEl = null;
    activeEditCleanup = null;
  }

  function commitEdit() {
    if (reverted) return;
    let value = parseInt(input.value, 10);
    if (isNaN(value) || value < 0) value = 0;
    if (value > MAX_BLOCKS) value = MAX_BLOCKS;
    writeBlockSize(currentBuffer, entryOff, value);
    cleanup();
    blocksSpan.textContent = value;
  }

  function revert() {
    reverted = true;
    cleanup();
    blocksSpan.textContent = currentValue;
  }

  input.addEventListener('blur', () => {
    if (pickerClicking) { input.focus(); input.selectionStart = input.selectionEnd = input._lastCursorPos || 0; return; }
    commitEdit();
  });
  input.addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter') { ev.preventDefault(); commitEdit(); }
    else if (ev.key === 'Escape') { ev.preventDefault(); revert(); }
  });

  registerActiveEdit(blocksSpan, revert);
}

function startRenameEntry(entryEl) {
  if (!currentBuffer || !entryEl) return;
  const entryOff = parseInt(entryEl.dataset.offset, 10);
  const nameSpan = entryEl.querySelector('.dir-name');
  if (nameSpan.querySelector('input')) return;

  cancelActiveEdits();
  // Read actual content from buffer (stops at 0xA0 padding)
  const currentValue = readPetsciiString(new Uint8Array(currentBuffer), entryOff + 5, 16);

  const input = document.createElement('input');
  input.type = 'text';
  input.maxLength = 16;
  input.value = currentValue;
  input.className = 'name-input';

  nameSpan.textContent = '';
  nameSpan.appendChild(input);
  nameSpan.classList.add('editing');
  trackCursorPos(input);
  input.focus();
  input.selectionStart = input.selectionEnd = currentValue.length;

  showPetsciiPicker(input, 16);

  let reverted = false;

  function cleanup() {
    nameSpan.classList.remove('editing');
    hidePetsciiPicker();
    activeEditEl = null;
    activeEditCleanup = null;
  }

  function commitRename() {
    if (reverted) return;
    let value = filterC64Input(input.value, 16);
    if (currentBuffer) {
      writeFileName(currentBuffer, entryOff, value, input._petsciiOverrides);
    }
    cleanup();
    // Re-render to show reversed chars properly
    const info = parseD64(currentBuffer);
    renderDisk(info);
  }

  function revert() {
    reverted = true;
    cleanup();
    nameSpan.textContent = '"' + currentValue.padEnd(16) + '"';
  }

  input.addEventListener('blur', () => {
    if (pickerClicking) { input.focus(); input.selectionStart = input.selectionEnd = input._lastCursorPos || 0; return; }
    commitRename();
  });
  input.addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter') { ev.preventDefault(); commitRename(); }
    else if (ev.key === 'Escape') { ev.preventDefault(); revert(); }
  });

  registerActiveEdit(nameSpan, revert);
}

document.getElementById('opt-rename').addEventListener('click', (e) => {
  e.stopPropagation();
  if (!currentBuffer || selectedEntryIndex < 0) return;
  closeMenus();
  const selected = document.querySelector('.dir-entry.selected');
  startRenameEntry(selected);
});

document.getElementById('opt-insert').addEventListener('click', (e) => {
  e.stopPropagation();
  if (!currentBuffer || !canInsertFile()) return;
  closeMenus();
  const newOff = insertFileEntry();
  if (newOff >= 0) {
    selectedEntryIndex = newOff;
    const info = parseD64(currentBuffer);
    renderDisk(info);
  }
});

document.getElementById('opt-remove').addEventListener('click', (e) => {
  e.stopPropagation();
  if (!currentBuffer || selectedEntryIndex < 0) return;
  closeMenus();
  const slots = getDirSlotOffsets(currentBuffer);
  const idx = slots.indexOf(selectedEntryIndex);
  removeFileEntry(currentBuffer, selectedEntryIndex);
  const info = parseD64(currentBuffer);
  const visibleEntries = info.entries.filter(en => !en.deleted || showDeleted);
  if (visibleEntries.length > 0) {
    const newIdx = Math.min(idx, visibleEntries.length - 1);
    selectedEntryIndex = visibleEntries[newIdx].entryOff;
  } else {
    selectedEntryIndex = -1;
  }
  renderDisk(info);
});

document.querySelectorAll('#opt-align .submenu .option').forEach(el => {
  el.addEventListener('click', (e) => {
    e.stopPropagation();
    if (!currentBuffer || selectedEntryIndex < 0) return;
    closeMenus();
    alignFilename(currentBuffer, selectedEntryIndex, el.dataset.align);
    const info = parseD64(currentBuffer);
    renderDisk(info);
  });
});

document.getElementById('opt-block-size').addEventListener('click', (e) => {
  e.stopPropagation();
  if (!currentBuffer || selectedEntryIndex < 0) return;
  closeMenus();
  const selected = document.querySelector('.dir-entry.selected');
  startEditBlockSize(selected);
});

document.getElementById('opt-recalc-size').addEventListener('click', (e) => {
  e.stopPropagation();
  if (!currentBuffer || selectedEntryIndex < 0) return;
  closeMenus();
  const actual = countActualBlocks(currentBuffer, selectedEntryIndex);
  writeBlockSize(currentBuffer, selectedEntryIndex, actual);
  const info = parseD64(currentBuffer);
  renderDisk(info);
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
  themeToggle.innerHTML = isDark ? '<i class="fa-solid fa-sun"></i>' : '<i class="fa-solid fa-moon"></i>';
}
updateThemeIcon();
// Restore check marks from saved settings
document.getElementById('check-deleted').innerHTML = showDeleted ? '<i class="fa-solid fa-check"></i>' : '';
document.getElementById('check-addr').innerHTML = showAddresses ? '<i class="fa-solid fa-check"></i>' : '';
document.getElementById('check-ts').innerHTML = showTrackSector ? '<i class="fa-solid fa-check"></i>' : '';
document.getElementById('check-unsafe').innerHTML = allowUnsafeChars ? '<i class="fa-solid fa-check"></i>' : '';

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
