// ── Help menu ────────────────────────────────────────────────────────
document.getElementById('opt-about').addEventListener('click', function(e) {
  e.stopPropagation();
  closeMenus();
  document.getElementById('modal-title').textContent = 'About CBM Disk Editor';
  var body = document.getElementById('modal-body');
  body.innerHTML =
    '<div style="text-align:center;margin-bottom:16px;font-family:\'C64 Pro Mono\',monospace">' +
      '<div style="font-size:20px;color:' + C64_COLORS[14] + ';margin-bottom:8px">CBM DISK EDITOR</div>' +
      '<div style="font-size:12px;color:' + C64_COLORS[15] + '">VERSION ' + APP_VERSION_STRING + '</div>' +
      '<div style="font-size:11px;color:' + C64_COLORS[7] + ';margin-top:12px">CODED BY VAI OF SLASH DESIGN</div>' +
      '<div style="font-size:11px;color:' + C64_COLORS[13] + ';margin-top:4px"><i class="fa-solid fa-cannabis"></i> OOK EEN TREKJE? <i class="fa-solid fa-joint"></i></div>' +
    '</div>' +
    '<div class="text-base line-tall">' +
      '<b>Supported formats:</b> D64 (1541), D71 (1571), D81 (1581), D80 (8050), D82 (8250), G64 (GCR), DNP (CMD), D1M/D2M/D4M (CMD FD), X64, T64 (tape), TAP (raw tape), CVT (GEOS)<br>' +
      '<b>Features:</b><br>' +
      '&bull; Directory editing: rename, insert, remove, sort, align, lock, splat<br>' +
      '&bull; Hex sector editor with track/sector navigation and search highlighting<br>' +
      '&bull; BAM viewer with integrity checking and file ownership display<br>' +
      '&bull; Search: Find/Find in Tabs with text and hex byte pattern matching<br>' +
      '&bull; Go to Sector (Ctrl+G): jump to any track/sector<br>' +
      '&bull; File import/export/copy/paste across disk images<br>' +
      '&bull; View As: Hex, Disassembly, PETSCII (C64 screen), BASIC (V2/V3.5/V7/Simons\'/FC3), Graphics, geoWrite, REL Records<br>' +
      '&bull; Graphics: 24+ formats (Koala, Art Studio, Advanced Art Studio, FLI, sprites, charset, Print Shop) with PNG export<br>' +
      '&bull; GEOS: geoPaint, Photo Scrap, Photo Album, geoWrite, Font viewers<br>' +
      '&bull; geoWrite document viewer with styled text and inline images<br>' +
      '&bull; Export: ZIP (all files), CVT, RTF, PDF, CSV, HTML, directory PNG<br>' +
      '&bull; Packer detection: 370+ signatures<br>' +
      '&bull; File chains viewer, compact directory, name case operations<br>' +
      '&bull; Save as separator with custom names<br>' +
      '&bull; D81 subdirectories (partitions)<br>' +
      '&bull; Disk optimizer with configurable interleave<br>' +
      '&bull; Lost file recovery (orphaned sector chain scanning)<br>' +
      '&bull; Fill free sectors, validate disk, recalculate BAM<br>' +
      '&bull; Multi-tab interface for working with multiple disks<br>' +
      '&bull; Drag &amp; drop: disk images, PRG/SEQ/USR/REL/CVT files, export by dragging<br>' +
      '&bull; 40+ keyboard shortcuts for all major operations<br>' +
      '&bull; Dark and light themes<br>' +
    '</div>';
  var footer = document.querySelector('#modal-overlay .modal-footer');
  footer.innerHTML = '<button id="modal-close">OK</button>';
  document.getElementById('modal-close').addEventListener('click', function() {
    document.getElementById('modal-overlay').classList.remove('open');
  });
  document.getElementById('modal-overlay').classList.add('open');
});

document.getElementById('opt-credits').addEventListener('click', function(e) {
  e.stopPropagation();
  closeMenus();
  document.getElementById('modal-title').textContent = 'Credits & Thanks';
  var body = document.getElementById('modal-body');
  body.innerHTML =
    '<div class="text-base line-tall">' +
      '<b>Packer detection:</b><br>' +
      '&bull; <a href="https://restore64.dev/" target="_blank" class="link">Restore64</a> — 370+ packer signatures<br>' +
      '&bull; <a href="https://csdb.dk/release/?id=235681" target="_blank" class="link">UNP64</a> by iAN CooG — signature architecture (GPL)<br>' +
      '<br>' +
      '<b>C64 color palette:</b><br>' +
      '&bull; <a href="https://www.pepto.de/projects/colorvic/2001/" target="_blank" class="link">Pepto\'s VIC-II palette</a> — accurate VIC-II color reproduction<br>' +
      '<br>' +
      '<b>Fonts:</b><br>' +
      '&bull; <a href="https://style64.org/c64-truetype" target="_blank" class="link">C64 Pro Mono</a> by Style64 — TrueType PETSCII font<br>' +
      '<br>' +
      '<b>GEOS format references:</b><br>' +
      '&bull; <a href="https://www.pagetable.com/?p=1471" target="_blank" class="link">Inside geoWrite</a> by Michael Steil — geoWrite file format documentation<br>' +
      '&bull; <a href="https://github.com/mist64/geowrite2rtf" target="_blank" class="link">geowrite2rtf</a> by Michael Steil — CVT/geoWrite parsing reference<br>' +
      '&bull; <a href="https://thornton2.com/programming/geos/compaction-strategy.html" target="_blank" class="link">Thornton2</a> — GEOS bitmap compaction strategy<br>' +
      '<br>' +
      '<b>Technical references:</b><br>' +
      '&bull; <a href="https://vice-emu.sourceforge.io/vice_17.html" target="_blank" class="link">VICE Manual</a> — disk image format documentation<br>' +
      '&bull; <a href="https://ist.uwaterloo.ca/~schepers/formats.html" target="_blank" class="link">Peter Schepers</a> — D64, D71, D81, D80, D82, D2M-DNP format specifications<br>' +
      '&bull; <a href="https://www.oxyron.de/html/opcodes02.html" target="_blank" class="link">Oxyron 6502 Opcode Table</a> — illegal opcode reference<br>' +
      '&bull; <a href="https://c64-wiki.com/" target="_blank" class="link">C64-Wiki</a> — Commodore 64 technical reference<br>' +
      '&bull; <a href="https://sta.c64.org/" target="_blank" class="link">STA\'s C64 pages</a> — disk format details<br>' +
      '&bull; <a href="https://github.com/OpenCBM/libcbmimage" target="_blank" class="link">libcbmimage</a> — CBM disk image library (CMD FD/HD reference)<br>' +
      '&bull; <a href="https://csdb.dk/" target="_blank" class="link">CSDb</a> — C64 Scene Database<br>' +
      '&bull; <a href="https://www.zimmers.net/anonftp/pub/cbm/" target="_blank" class="link">Zimmers.net</a> — CBM file archive and GEOS format documentation<br>' +
      '&bull; <a href="https://archive.org/details/JiffyDos_V6_Users_Manual" target="_blank" class="link">JiffyDOS V6 User\'s Manual</a> — sector interleave and fast loader reference<br>' +
    '</div>';
  var footer = document.querySelector('#modal-overlay .modal-footer');
  footer.innerHTML = '<button id="modal-close">OK</button>';
  document.getElementById('modal-close').addEventListener('click', function() {
    document.getElementById('modal-overlay').classList.remove('open');
  });
  document.getElementById('modal-overlay').classList.add('open');
});

document.getElementById('opt-shortcuts').addEventListener('click', function(e) {
  e.stopPropagation();
  closeMenus();
  document.getElementById('modal-title').textContent = 'Keyboard Shortcuts';
  var body = document.getElementById('modal-body');
  var sections = [
    { title: 'File Navigation', shortcuts: [
      ['Arrow Up / Down', 'Select previous/next file'],
      ['Ctrl + Arrow Up / Down', 'Move file up/down in directory'],
      ['Enter', 'Rename selected file'],
      ['Delete', 'Remove selected file'],
    ]},
    { title: 'File Operations', shortcuts: [
      ['Ctrl + C', 'Copy selected file(s)'],
      ['Ctrl + A', 'Select all files'],
      ['Ctrl + V', 'Paste file (works across tabs)'],
      ['Ctrl + Shift + I', 'Insert file'],
      ['Ctrl + Alt + E', 'Export selected file(s)'],
      ['Ctrl + Shift + D', 'Add directory (D81/DNP)'],
      ['Ctrl + Z', 'Undo last change'],
      ['Ctrl + Alt + O', 'Open disk'],
      ['Ctrl + Alt + S', 'Save disk'],
      ['Ctrl + Shift + S', 'Save as'],
      ['Ctrl + Alt + N', 'New disk'],
      ['Ctrl + Alt + W', 'Close current tab'],
      ['Ctrl + Shift + B', 'View BAM'],
      ['Ctrl + Alt + V', 'Validate disk'],
      ['Ctrl + Shift + H', 'Edit disk name'],
      ['Ctrl + Alt + I', 'Edit disk ID'],
    ]},
    { title: 'Viewers', shortcuts: [
      ['Ctrl + Alt + H', 'View as hex'],
      ['Ctrl + Alt + B', 'View as BASIC'],
      ['Ctrl + Alt + P', 'View as PETSCII'],
      ['Ctrl + Alt + D', 'View as disassembly'],
      ['Ctrl + Alt + G', 'View as graphics'],
    ]},
    { title: 'Search', shortcuts: [
      ['Ctrl + F', 'Find in current disk'],
      ['Ctrl + Shift + F', 'Find in all tabs'],
      ['Ctrl + Shift + G', 'Go to sector'],
    ]},
    { title: 'Formatting', shortcuts: [
      ['Ctrl + Alt + L', 'Align left'],
      ['Ctrl + Alt + R', 'Align right'],
      ['Ctrl + Alt + C', 'Center'],
      ['Ctrl + Alt + J', 'Justify'],
      ['Ctrl + <', 'Lock / unlock file'],
      ['Ctrl + *', 'Splat / unsplat file'],
      ['Ctrl + Shift + L', 'Name to lowercase'],
      ['Ctrl + Shift + U', 'Name to UPPERCASE'],
      ['Ctrl + Shift + T', 'Toggle name case'],
    ]},
    { title: 'Editing (double-click)', shortcuts: [
      ['Filename', 'Rename file (PETSCII keyboard available)'],
      ['Type column', 'Change file type'],
      ['Blocks column', 'Edit block count'],
      ['T/S column', 'Edit track/sector'],
      ['Disk name / ID', 'Edit disk header'],
      ['Blocks free', 'Edit free block count'],
    ]},
    { title: 'Sector Editor', shortcuts: [
      ['Ctrl + J', 'Follow sector chain (jump to T/S in bytes 0-1)'],
      ['Click hex byte', 'Edit byte value'],
      ['Escape', 'Cancel byte edit'],
    ]},
    { title: 'Drag & Drop', shortcuts: [
      ['Drop .d64/.d71/.d81', 'Open disk image(s) in new tab(s)'],
      ['Drop .prg/.seq/.usr/.rel/.cvt', 'Import file(s) into current disk'],
      ['Drag file entry to OS', 'Export file (Chrome/Edge)'],
    ]},
    { title: 'General', shortcuts: [
      ['Ctrl + Shift', 'Toggle uppercase/lowercase charset'],
      ['Right-click', 'Context menu on file entry or empty area'],
      ['Escape', 'Close modal or menu'],
      ['Tab', 'Next input (fill pattern, hex editor)'],
    ]},
  ];
  var html = '';
  for (var si = 0; si < sections.length; si++) {
    html += '<div style="font-weight:bold;font-size:12px;margin:' + (si > 0 ? '12px' : '0') + ' 0 6px;color:var(--text-muted)">' + escHtml(sections[si].title) + '</div>';
    html += '<table style="width:100%;border-collapse:collapse">';
    for (var ki = 0; ki < sections[si].shortcuts.length; ki++) {
      var sc = sections[si].shortcuts[ki];
      html += '<tr><td style="padding:3px 12px 3px 8px;white-space:nowrap;font-size:12px"><code class="code-tag" style="font-size:11px">' +
        escHtml(sc[0]) + '</code></td><td style="padding:3px 0;font-size:12px;color:var(--text-muted)">' +
        escHtml(sc[1]) + '</td></tr>';
    }
    html += '</table>';
  }
  body.innerHTML = html;
  var footer = document.querySelector('#modal-overlay .modal-footer');
  footer.innerHTML = '<button id="modal-close">OK</button>';
  document.getElementById('modal-close').addEventListener('click', function() {
    document.getElementById('modal-overlay').classList.remove('open');
  });
  document.getElementById('modal-overlay').classList.add('open');
});

document.getElementById('opt-changelog').addEventListener('click', function(e) {
  e.stopPropagation();
  closeMenus();
  document.getElementById('modal-title').textContent = 'Changelog';
  var body = document.getElementById('modal-body');
  var changes = [
    { ver: '1.3.52', title: 'Directory render pass: cache buffer wrap, one-pass selection restore', items: [
      'Directory render used to wrap currentBuffer into a Uint8Array four times per entry (filename, T/S column, deleted-icon branch, regular-icon branch). It now wraps once before the loop and reuses it \u2014 on a 100-entry disk that removes \u2248400 redundant typed-array wraps per render',
      'isTapeFormat() was called three times per entry; now cached once outside the loop',
      'Icon markup extracted into buildEntryIconsHtml (ui-render.js) \u2014 same output, but the per-row template no longer inlines an IIFE that re-wrapped the buffer',
      'Selection restore used to run one document.querySelector per selected row; for a multi-select of N rows that was N full document scans. It now builds a single offset-to-element map after innerHTML and does O(1) lookups from it',
      'No user-visible behaviour change; 63 tests still pass',
    ]},
    { ver: '1.3.51', title: 'Fresh tabs open clean; undo clears dirty; internal deduplication', items: [
      'Fix: opening or creating a disk while another tab had unsaved changes used to inherit that dirty state onto the new tab, triggering the unsaved-changes warning on an untouched disk. Both Open paths (drag-and-drop, file picker) and New Disk now reset the dirty flag and undo stack for the freshly-opened tab',
      'Fix: undoing past every edit since the last save now correctly clears the tab\u2019s dirty marker. The tab tracks the undo-stack length at each clean point (load / save) and compares against it on each undo, so \u201Cdirty\u201D accurately reflects whether the buffer differs from the saved version',
      'Internal: validateDisk and validatePartition now share a GEOS aux-sector helper (info block + VLIR record enumeration) instead of keeping two drifting copies',
      'Internal: DNP / D1M / D2M / D4M now share _cmdBamBase, _cmdIsSectorFree, _cmdReadTrackFree, _cmdReadTrackBitmap \u2014 one source of truth for CMD native BAM reads',
      'Internal: sector allocation centralised into allocateSectorsFromTrackOrder, used by both the Optimize dialog and runtime file writes',
      'Net \u2248190 lines of duplicated code removed; 63 tests still pass',
    ]},
    { ver: '1.3.50', title: 'Warn before discarding unsaved changes', items: [
      'Closing a tab with unsaved changes (menu, X button, or Ctrl+Alt+W) now prompts before discarding',
      'Close All also prompts when any open tab is dirty, listing the affected tab names',
      'Browser close/reload triggers the native beforeunload warning whenever a tab has unsaved changes',
      'Insert File and Insert Separator now mark the tab dirty so they show up in the unsaved-changes warning',
    ]},
    { ver: '1.3.49', title: 'Save As uses tab name and syncs tab back', items: [
      'Save As default filename now falls back to the active tab\u2019s name (e.g. "New Disk 1.d64") instead of a generic "disk.d64" when the disk hasn\u2019t been saved yet',
      'When you change the filename in Save As, the tab title updates to match so Save and subsequent Save As defaults stay in sync',
    ]},
    { ver: '1.3.48', title: 'BAM viewer keeps tabs pinned while content scrolls', items: [
      'BAM modal wraps the body in a flex-column layout so only the active tab\u2019s content scrolls',
      'Tab bar (and any BAM warnings above it) stays visible when scrolling long Sectors / Track Usage / File Fragmentation content',
      'Tab switch now resets the inner scroll position to the top so each tab starts at 0',
    ]},
    { ver: '1.3.47', title: 'Copy Files auto-closes on success', items: [
      'Multi-file copy: progress modal now auto-closes when all files copied OK \u2014 no more "Copy Complete" OK prompt on the happy path',
      'If some files were skipped (unsupported type, empty VLIR, etc.) the summary dialog still appears so nothing fails silently',
      'Paste unchanged \u2014 still shows Paste Complete / Paste Incomplete with OK',
    ]},
    { ver: '1.3.46', title: 'Sector editor menu, PETSCII full-file view, modal scroll reset', items: [
      'Sector editor: Fill / Copy / Paste consolidated into a hamburger (\u22EE) dropdown in the footer so action buttons no longer overflow',
      'Added .dropdown-btn-menu-item.disabled style; Paste stays greyed out in the menu until the clipboard has data',
      'PETSCII viewer (View As \u2192 PETSCII): now shows the full file \u2014 the virtual screen grows past 25 rows instead of scrolling old content off the top',
      'CHROUT CLR ($93) still resets to a fresh 25-row screen',
      'Modals always open at scrollTop 0 \u2014 scroll position no longer carries over between open/close cycles',
    ]},
    { ver: '1.3.45', title: 'Modal sizing classes and stable positioning', items: [
      'Added modal size classes: modal-sm (460px), modal-md (560px), modal-lg (720px), modal-xl (900px + 80vh), modal-xxl (1100px + 80vh)',
      'New setModalSize(size) helper in ui-modals.js; showModal / showChoiceModal / showProgressModal auto-reset the size so it doesn\u2019t leak into follow-up dialogs',
      'Modal overlay now anchors the modal at top (10vh) instead of center-aligning \u2014 no visual \u201Cshift\u201D when modal content resizes',
      'Modal max-height reduced from 90vh to 85vh (5vh breathing room at the bottom)',
      'BAM viewer locked to modal-md so tab switching no longer jumps the modal width',
      'Removed the redundant filename tooltip in the File Fragmentation tab',
    ]},
    { ver: '1.3.44', title: 'Graphics save split button and BAM tab split', items: [
      'Graphics viewer \u201CSave as\u201D is now a split button: main click saves in current format, arrow opens the dropdown of other formats',
      'Dropdown excludes the currently-selected format (main button already covers it)',
      'Fixed dropdown menu items appearing as stacked buttons \u2014 the <button> elements inherited .modal-footer button styling; items are now <div>',
      'BAM viewer tabs renamed: Sectors/Map \u2192 BAM, and old Summary split into Track Usage and File Fragmentation',
      'File Fragmentation tab shows a hint when the disk has no multi-block files instead of a bare 0% header',
      'Per-file fragmentation bar colors now use --color-warn and --color-error vars',
    ]},
    { ver: '1.3.43', title: 'GUI consistency pass', items: [
      'Centralized status colors into CSS variables: --color-error, --color-warn, --color-dir, --color-recover*',
      'Extracted C64 palette tokens: --c64-screen-bg, --c64-text, --c64-string, --c64-control, --c64-highlight, --c64-sys',
      'Removed ~12 redundant [data-theme="light"] override blocks \u2014 vars handle theme switching',
      'Replaced inline health-indicator colors in ui-render.js with .health-ok/warn/error classes',
      'Unified input font-size to 14px (search input and wide hex input were 13px)',
      'Unified small-button font-size to 12px (separator editor button was 11px)',
      'Normalized border-radius: 2px for tiny elements, 3px for inputs/buttons, 4px for containers (removed 1/6/8/12 outliers)',
      'Unified dropdown popup padding to 4px 0 (color-dropdown-popup and dropdown-btn-menu were 2px 0)',
      'Fixed missing --bg-input CSS variable reference (used --hover for progress track, --bg for search input)',
      'Unified orange warning light-theme color to #df8e1d (was split between #fe640b and #df8e1d)',
    ]},
    { ver: '1.3.42', title: 'JSDoc type annotations and TypeScript checking', items: [
      'Added tsconfig.json with allowJs + checkJs for gradual TypeScript type checking',
      'JSDoc type definitions for core types: DiskFormat, FileReadResult, DiskInfo, DirEntry, BAMIntegrityResult',
      'Annotated ~20 critical functions in cbm-format.js: sector ops, BAM helpers, PETSCII, file reading, GEOS',
      'Annotated checkBAMIntegrity in cbm-editor.js',
      'VS Code now provides autocomplete, hover docs, and type error highlighting',
      'Zero build changes \u2014 JSDoc is comments only, no compilation step',
    ]},
    { ver: '1.3.41', title: 'Automated test suite (63 tests)', items: [
      'Added test suite using Node.js built-in test runner (zero dependencies)',
      '63 tests across 4 test files: PETSCII, format/geometry, BAM operations, GEOS',
      'Tests verify: sector offsets, BAM integrity, forEachFileSector, VLIR records, GEOS signature',
      'Run with: npm test (or: node --test tests/*.test.js)',
      'Test helper bootstraps browser globals for Node.js compatibility',
    ]},
    { ver: '1.3.40', title: 'Per-file fragmentation scores in BAM Summary', items: [
      'BAM viewer Summary tab now shows a per-file fragmentation table',
      'Each file shows block count, fragmentation percentage, and a color-coded bar',
      'Disk-wide fragmentation percentage displayed as a header',
      'Files sorted by fragmentation (most fragmented first)',
      'Fragmentation measured by non-adjacent sector transitions (track jumps)',
      'Color coding: green (0%), blue (\u226430%), orange (\u226460%), red (>60%)',
    ]},
    { ver: '1.3.39', title: 'Disk Map: radial BAM visualization', items: [
      'New "Disk Map" tab in the BAM viewer showing the disk as concentric rings',
      'Tracks as rings with sectors as arcs, mirroring real physical disk geometry',
      'Variable sectors-per-track visible (D64 zones, D80/D82 zones)',
      'Hover shows track/sector, file ownership, and BAM status',
      'Click opens the hex sector editor',
      'Disk name displayed in the center spindle hole',
      'Works on all supported formats including CMD high-SPT disks',
    ]},
    { ver: '1.3.38', title: 'Graphics export: PNG, JPG, GIF, SVG with dropdown button', items: [
      'Graphics viewer now supports four export formats: PNG, JPG, GIF, and SVG',
      'Dropdown button replaces split button \u2014 click to open format menu, label shows last-used format',
      'GIF export uses an inline GIF89a encoder with LZW compression (zero dependencies)',
      'SVG export generates pixel-accurate scalable graphics with crispEdges rendering',
      'Extracted showProgressModal() helper for reusable progress modals',
      'Refactored: replaced magic number 40 with fmt.sectorsPerTrack() in validatePartition',
      'Refactored: replaced magic number 5 with FILE_TYPE.CBM in optimizer',
    ]},
    { ver: '1.3.37', title: 'UX improvements and interleave preset fixes', items: [
      'Copy and paste operations now show a progress modal with file names and a progress bar',
      'Summary after copy/paste lists skipped files with specific reasons',
      'Optimize dialog: custom interleave input right-aligned, shows format default as value and placeholder',
      'Optimize dialog: invalid interleave input highlighted with warning, Optimize button disabled',
      'Set Interleave dialog: removed leading zero from hex values',
      'Interleave presets: removed unverified fast loader claims (SpeedDOS, DolphinDOS)',
      'Interleave presets: renamed to match verified JiffyDOS V6 User\u2019s Manual values (6 on 1541, 4 on 1571)',
      'Added JiffyDOS V6 User\u2019s Manual to Credits & Thanks',
      'Added no-cache meta tags to prevent stale browser caching',
    ]},
    { ver: '1.3.36', title: 'GEOS overhaul: centralized sector walking, VLIR copy fix, BAM integrity', items: [
      'Fixed VLIR copy detection: was checking info block icon width (byte 0x02) instead of dir entry structure type (byte 0x17) \u2014 VLIR files were never detected during copy',
      'GEOS signature now written to header sector, not BAM sector \u2014 fixes D81 BAM corruption on GEOS disk conversion',
      'Centralized all file sector walking into forEachFileSector() \u2014 single source of truth for GEOS info blocks, VLIR record chains, and REL side-sector chains',
      'Added isVlirFile() helper replacing 5 duplicated 3-part VLIR detection conditions',
      'Scratch/unscratch now correctly frees/marks all GEOS and REL sectors in BAM',
      'Disk optimizer skips GEOS VLIR files (protects all their sectors from reallocation)',
      'Set Actual File Size, BAM viewer, recalculate-free, export, drag-export all GEOS/REL-aware',
      'Block count in writeFileToDisk now includes GEOS info block sector',
      'Scratched file recovery indicator checks all GEOS/REL sectors',
      'GEOS-aware validation: correctly tracks all sectors unlike 1541 DOS validate',
    ]},
    { ver: '1.3.35', title: 'Fix GEOS BAM validation and allocation tracking', items: [
      'Validate and BAM rebuild now correctly track GEOS info block sectors and VLIR record chains',
      'Previously only the VLIR index sector was followed, causing BAM errors after pasting GEOS files',
      'Fixes block count mismatch warnings for GEOS Sequential files (info block was uncounted)',
      'buildTrueAllocationMap now sees all GEOS sectors, preventing allocator from reusing them',
      'Added FILE_TYPE lookup object derived from FILE_TYPES array, replacing magic numbers',
      'REL files excluded from GEOS detection to prevent false positives (byte 0x17 overlap)',
    ]},
    { ver: '1.3.34', title: 'Fix copy/paste of GEOS VLIR files', items: [
      'Copying a GEOS VLIR file (applications, geoWrite docs, fonts, photo albums, geoPaint) previously grabbed only the VLIR index sector as "file data"',
      'Pasted VLIR files ended up tiny and unusable \u2014 wrong size, wrong data, stale sector pointers from the source disk',
      'Copy now detects VLIR via info-block structure byte and captures each record\u2019s sector chain separately',
      'Paste rebuilds the VLIR index and record chains on the destination disk',
      'GEOS Sequential files and non-GEOS files keep the existing linear-chain code path',
    ]},
    { ver: '1.3.33', title: 'D1M/D2M/D4M: CMD FD system partition byte-exact to VICE', items: [
      'Fixed: system partition now written on the last track (track 81), not track 26',
      'Writer is byte-exact to VICE fsimage-create.c for D1M/D2M/D4M signature sector and partition directory chain',
      'Added "CMD FD SERIES" magic at track 81 sector 5 +0xF0 (required for VICE to recognise the disk)',
      'New BAM viewer Partitions tab lists SYSTEM + PARTITION 1 entries with type, start block, and size',
      'Fixed 5-blocks-short bug: free-block count now matches VICE (3205 / 6445 / 12925 for D1M/D2M/D4M)',
      'Integrity check no longer flags CMD FD system sectors as allocation errors (VICE leaves them marked free in the main BAM)',
      'Validate Disk preserves the VICE-style BAM instead of reverting it',
    ]},
    { ver: '1.3.32', title: 'D1M/D2M/D4M as native CMD format, remove DHD', items: [
      'D1M/D2M/D4M: proper DISK_FORMATS definitions as CMD native partitions',
      'D1M (FD-2000 DD): 81 tracks, 40 sectors/track, 829 KB',
      'D2M (FD-2000 HD): 81 tracks, 80 sectors/track, 1.6 MB',
      'D4M (FD-4000 ED): 81 tracks, 160 sectors/track, 3.2 MB',
      'System partition at track 26 with DevBlock and partition directory',
      'BAM, subdirectories, validate, integrity check all work correctly',
      'Removed DHD (CMD Hard Drive) support \u2014 files too large for browser',
      'Removed CMD container/partition-picker infrastructure',
      'Fixed getBamBitmapBase to use isSectorFree presence for CMD native detection',
    ]},
    { ver: '1.3.31', title: 'Fix DNP BAM corruption, validate, and integrity check', items: [
      'Fixed BAM writes going to wrong offset inside DNP subdirectories',
      'Validate and BAM integrity check now recurse into linked subdirectories',
      'Validate BAM rebuild uses correct MSB-first bit order for DNP',
      'Validate marks all format-specific system sectors as allocated',
      'REL side-sector chains followed during recursive integrity walk',
    ]},
    { ver: '1.3.30', title: 'Format-driven interleave/BAM, DNP subdir directory expansion', items: [
      'Interleave presets and defaults moved into DISK_FORMATS definitions',
      'BAM free count check uses format property instead of DNP comparison',
      'DNP subdirectory expansion allocates dir sectors from any free track',
      'Fixed directory expansion collision with file sectors during paste',
      'Partition validation uses format SPT instead of hardcoded 40',
      'Removed BAM track fallback value',
    ]},
    { ver: '1.3.29', title: 'Centralize format properties, DNP subdirectory fixes', items: [
      'Centralized protected sectors, skip tracks, and BAM bit order into DISK_FORMATS',
      'Added getProtectedSectors(), getSkipTracks(), bamBitMask() format methods',
      'Added bamMarkSectorFree() function, removing duplicated inline bit manipulation',
      'Subdirectory support driven by format properties: supportsSubdirs, subdirType, subdirLinked',
      'DNP: nested subdirectories supported (Add Directory enabled inside subdirs)',
      'DNP: file paste/import in subdirectories no longer corrupts disk',
      'DNP: allocation map now walks all directories recursively',
      'DNP: disk ID change offers to update subdirectory headers',
      'DNP: disk ID now displays DOS type (1H) like other formats',
      'Removed all hardcoded format checks (DISK_FORMATS.dnp/d81) from allocation and subdir code',
    ]},
    { ver: '1.3.28', title: 'Fix directory expansion overwriting BAM/header sectors', items: [
      'Fixed directory expansion in paste/import overwriting BAM and header sectors on D81/DNP',
      'Fixed directory expansion in insert overwriting BAM sectors (missing format variable)',
      'Fixed D71 file allocation potentially overwriting side-2 BAM at track 53',
      'All directory expansion paths now skip protected sectors (BAM, header, system)',
    ]},
    { ver: '1.3.27', title: 'Keyboard shortcuts remap, nested submenu nav, DNP BAM fix', items: [
      'Keyboard shortcuts: remapped all Ctrl+letter conflicts with browser shortcuts',
      'Ctrl+W/T/L/U/D/B/H/G/E/I all moved to Ctrl+Shift or Ctrl+Alt combos',
      'Removed Ctrl+W (close tab) and Ctrl+Shift+W (close all) — browser conflicts',
      'Nested submenu keyboard navigation: ArrowRight/Left traverses multiple levels',
      'DNP BAM: fixed getBamBitmapBase for DNP format, sector 34 marked as used',
      'Change Partition: always shows picker dialog (forceDialog)',
      'CMD FD: creates multiple partitions to fill available space',
      'DHD: prompts for partition count (1-31)',
    ]},
    { ver: '1.3.26', title: 'New disk menu with CMD formats, DHD support', items: [
      'New menu: reorganized by drive type (1541/1571/1581/8050/8250/CMD)',
      'New: CMD Native (DNP) with formatted BAM and directory',
      'New: CMD FD (D1M/D2M/D4M) with partition table and default 1581 partition',
      'New: CMD HD (DHD) with partition table and default 1581 partition',
      'DHD format: CMD Hard Drive image support via file extension detection',
    ]},
    { ver: '1.3.25', title: 'CMD FD partitions, scratch/unscratch, fixes', items: [
      'D1M/D2M/D4M: proper partition table reading with partition picker dialog',
      'CMD FD: partitions extracted as virtual disks (1541/1571/1581/native)',
      'CMD FD: auto-opens single-partition images, picker for multi-partition',
      'Scratch File: C64-style scratch (clear closed bit + free sectors in BAM)',
      'Unscratch File: restore scratched files (set closed bit + mark sectors used)',
      'Scratch/Unscratch: show/hide based on file state, locked files can\'t be scratched',
      'CBM partition protection: scratch/splat/change type disabled on directory entries',
      'DNP: Add Directory enabled for CMD native partitions',
      'PETSCII: fixed $61-$7A and $C1-$DA in petsciiToReadable for GEOS filenames',
      'PETSCII picker: z-index always above current modal',
      'Search input: focus styling matches other inputs',
      'Separator editor: scrollable list with fixed input at bottom, name field',
      'Download standalone: build.ps1 creates ZIP, Help menu fetches it',
    ]},
    { ver: '1.3.24', title: 'ZipCode decompression', items: [
      'Decompress ZipCode: detect 1!-4! file sets on disk and extract to new D64 tab',
      'Three compression methods: store (raw), fill (single byte), RLE',
      'Validates complete set (all 4 files present) with clear error for partial sets',
    ]},
    { ver: '1.3.23', title: 'G64, DNP, D1M/D2M/D4M format support', items: [
      'G64 (GCR disk image): auto-decode to D64 on open, full GCR-to-sector extraction',
      'DNP (CMD Native Partition): read/write support with 256 sectors/track BAM',
      'D1M/D2M/D4M (CMD FD2000/FD4000): detected by file size, treated as DNP',
      'GCR decoder: sync detection, header/data block parsing, track wrap handling',
    ]},
    { ver: '1.3.22', title: 'BASIC dialect selector, modal stacking, sector clipboard fix', items: [
      'BASIC viewer: dialect selector (V2/Simons\'/FC3) for C64 programs',
      'BASIC viewer: re-renders instantly when switching dialect',
      'Modal stacking: MutationObserver auto-bumps z-index for any modal opened on top of another',
      'Sector clipboard: persists across sector editor sessions and tabs',
      'Sector fill: uses styled input modal instead of browser prompt',
      'Scratched file recovery icon: clickable for chain details and restore',
      'Health dot: opens error bytes viewer for yellow, BAM for red/green',
      'Splat File renamed from Scratch File',
    ]},
    { ver: '1.3.21', title: 'Export All ZIP, BASIC dialects, sector tools, X64, recovery', items: [
      'Export All Files: one-click ZIP download of all files on disk',
      'BASIC: Simons\' BASIC, Final Cartridge III, BASIC V3.5 (C16/Plus4) token support',
      'Sector editor: Fill sector with byte, Copy/Paste sector, Back-navigate chain',
      'Export as HTML: styled directory listing with C64 colors',
      'X64 format: auto-detect and strip 64-byte header',
      'ASCII to PETSCII: .txt files auto-convert on import as SEQ',
      'Scratched file recovery: click heartbeat icon to view chain and restore',
      'Generic graphics detection: widened size ranges for relocated bitmaps',
    ]},
    { ver: '1.3.20', title: 'Build script, settings export, UI polish', items: [
      'Build script (build.ps1): single self-contained dist/index.html with all JS/CSS/fonts inlined',
      'Options: Export/Import Settings and Separators with auto-detect on import',
      'Separator duplicate prevention on import and save',
      'Separator editor: replaced built-in grid with standard PETSCII picker',
      'Modal footer split: actions (left) vs navigation (right) for cleaner UX',
      'Follow chain shortcut changed to Ctrl+J (was bare J key)',
      'Show Addresses and Track/Sector columns default to on for new users',
      'localStorage keys renamed from d64- to cbm- prefix',
      'Fixed follow chain null error when restoring footer',
    ]},
    { ver: '1.3.19', title: 'Additional graphics formats', items: [
      'Graphics: Advanced Art Studio (multicolor, $2000, 10018 bytes)',
      'Graphics: Saracen Paint (multicolor, $3F8E, 10023 bytes)',
      'Graphics: Run Paint, PMC, CDU-Paint, Pixel Perfect (multicolor, various addresses)',
      'New parsers: AAS layout (bm+scr+border+bg+col), Saracen layout (18-byte header)',
      'Total supported graphics formats: 24+',
    ]},
    { ver: '1.3.18', title: 'Menu reorganization, save as separator, help updates', items: [
      'Disk menu: grouped into Disk Tools and Export Disk submenus',
      'File menu: grouped exports into Export submenu',
      'File menu: Save as Separator \u2014 save any file pattern as reusable separator',
      'Separator names shown in editor and insert submenu',
      'Keyboard shortcuts dialog: added name case, sector editor, updated drag & drop',
    ]},
    { ver: '1.3.17', title: 'REL viewer, BAM toggle, file chains', items: [
      'View As > REL Records: relative file viewer showing records with hex and ASCII',
      'BAM view: right-click sector to toggle free/used allocation',
      'File Chains: show sector chains for all files on disk (Disk menu)',
    ]},
    { ver: '1.3.16', title: 'Name case, compact dir, follow chain, CSV/PNG/text export', items: [
      'Name Case: Ctrl+L lowercase, Ctrl+U uppercase, Ctrl+T toggle (Entry menu)',
      'Compact Directory: remove deleted entries from directory (Disk menu)',
      'Follow Chain: J key or button in sector editor to jump to next linked sector',
      'Export as CSV: directory listing with filename, type, blocks, lock, T/S',
      'Export Directory as PNG: C64-style directory screenshot',
      'Export as Text (geoWrite): plain text extraction from geoWrite documents',
    ]},
    { ver: '1.3.15', title: 'Search UX, keyboard shortcuts, refactoring', items: [
      'Search: PETSCII keyboard attached to search input for special character entry',
      'Search: radio buttons for scope selection, spinner during search',
      'Search: hex byte display and PETSCII chars in results, scrollable results',
      'Go to Sector: proper hex input fields for track and sector with validation',
      'Keyboard shortcuts: Ctrl+W close tab, Ctrl+Shift+W close all, Ctrl+Shift+S save as',
      'Keyboard shortcuts: Ctrl+Alt+H/B/P/D for hex/BASIC/PETSCII/disassembly viewers',
      'Keyboard shortcuts: Ctrl+Alt+V validate disk',
      'Keyboard shortcuts dialog: new Viewers and Search sections',
      'Sector editor: search match highlighting on hex bytes only (removed from PETSCII column)',
      'Refactor: removed dead matchBytes() function, unused pdfImages variable',
      'Refactor: optimized PDF image hex encoding with Array.join()',
      'Fix: PETSCII picker maxLength check for inputs without explicit maxLength',
    ]},
    { ver: '1.3.14', title: 'Search improvements, Go to Sector, PDF font metrics', items: [
      'Search: hex byte pattern search ($A0 FF, A0FF) in addition to text',
      'Search: match count per sector shown in results',
      'Search > Go to Sector (Ctrl+G): jump directly to any T:S in the sector editor',
      'PDF export: proper per-character width tables for Helvetica, Times, Courier',
    ]},
    { ver: '1.3.13', title: 'Search, sector editor highlights', items: [
      'Search > Find (Ctrl+F): search current disk by text with scope filter (All/Filename/Header/ID)',
      'Search > Find in All Tabs (Ctrl+Shift+F): search across all open tabs',
      'Search results: click to open sector editor with all matches highlighted',
      'Sector editor: highlight support for search matches (hex and ASCII columns)',
    ]},
    { ver: '1.3.12', title: 'geoWrite viewer, CVT import/export, graphics PNG save', items: [
      'View As > geoWrite: styled document viewer with fonts, alignment, inline images',
      'View As > Graphics: geoWrite embedded image viewer for VLIR records 64-126',
      'Export as RTF: geoWrite documents with full formatting and embedded PNG images',
      'Export as PDF: geoWrite documents with standard fonts, alignment, images',
      'Export as CVT: GEOS ConVerT format for any GEOS VLIR/SEQ file',
      'Import CVT: restore GEOS files from ConVerT format including VLIR structure',
      'Import CVT: GEOS disk signature conversion warning for non-GEOS disks',
      'Close All: close all open tabs from Disk menu',
      'Save as PNG: export graphics from the graphics viewer',
      'Context menu: fixed submenu hover closing on disabled items',
      'Top menu and context menu now properly close each other',
    ]},
    { ver: '1.3.10', title: 'Disk optimizer, BAM view, charset/sprite viewer improvements', items: [
      'Optimize Disk: rewrite file sector chains with chosen interleave for faster loading',
      'Optimize Disk: preset interleaves per drive type (1541/1571/1581/8050), custom option',
      'Optimize Disk: defragment option packs files onto consecutive tracks',
      'Optimize Disk: updates global interleave setting after optimization',
      'BAM view: error sectors show used color with red outline and owning filename',
      'BAM view: orphan detection \u2014 sectors marked used but not owned by any file',
      'Charset viewer: correct C64 bank-stride tile layout (1\u00D72, 2\u00D71, 2\u00D72)',
      'Charset/sprite viewer: multicolor now draws double-wide pixels like real hardware',
      'Graphics viewer: MC toggle button replaces duplicate format buttons',
      'Graphics viewer: color picker dropdowns replace swatch rows for stable modal width',
      'Disassembly viewer: auto-scrolls to SYS entry point, highlighted with accent border',
      'Directory header row (Size/Filename/Type) stays visible when scrolling',
    ]},
    { ver: '1.3.9', title: 'Tab indicators for tape and unsaved changes', items: [
      'Tape tabs (T64/TAP): left border accent to distinguish from disk tabs',
      'Dirty tabs: bullet prefix and italic name when disk has unsaved changes',
      'Dirty state cleared on Save/Save As, tracked across tab switches',
    ]},
    { ver: '1.3.8', title: 'Tape read-only enforcement', items: [
      'T64/TAP: all editing disabled (rename, insert, remove, sort, align, lock, etc.)',
      'T64/TAP: paste and import disabled (read-only target)',
      'T64/TAP: double-click editing blocked for filenames, types, blocks, T/S',
      'T64/TAP: header/ID/blocks-free editing blocked',
      'T64/TAP: Ctrl+Arrow move, Delete key disabled',
      'T64/TAP: disk operations disabled (save, validate, BAM, fill, scan)',
      'T64/TAP: copy, export, and all viewers remain functional',
    ]},
    { ver: '1.3.7', title: 'Tape file copy/export, T64 file reading', items: [
      'T64/TAP: readFileData now works — enables export, copy, and all viewers',
      'T64/TAP: copy files to clipboard, paste into disk images across tabs',
      'T64/TAP: export files as .prg/.seq with correct filenames',
    ]},
    { ver: '1.3.6', title: 'TAP support, refactoring', items: [
      'TAP tape image support (read-only): decodes standard CBM tape encoding',
      'TAP: detects file headers and data blocks from raw pulse data',
      'Refactor: hex8()/hex16() helpers replace verbose hex formatting',
      'Refactor: cached DOM elements for menubar, menu items, alignment',
      'Refactor: consolidated dasm CSS font declarations',
      'Refactor: alignment shortcuts use data-driven lookup',
      'Refactor: decodeGeosString() shared helper for GEOS text fields',
    ]},
    { ver: '1.3.5', title: 'GEOS class names, file info, menu key fix', items: [
      'GEOS info: fixed class name display (was showing dots for ASCII chars)',
      'GEOS info: corrected description offset to $A1',
      'File info: load address shown as range (Load: $0801 - $08FF)',
      'Ctrl+Alt+N: new disk shortcut',
      'Arrow keys no longer change file selection while menu is open',
    ]},
    { ver: '1.3.4', title: 'Shortcuts, illegal opcodes, menu navigation fixes', items: [
      'Disassembly: full 256-opcode table with illegal opcodes (oxyron.de naming)',
      'Disassembly: illegal stable (amber) and unstable (red) opcodes color-coded',
      'Keyboard shortcuts: Ctrl+I/E/D/B/H, Ctrl+Alt+L/R/C/J/I, Ctrl+</*/Shift',
      'Menu keyboard navigation fixes: proper dropdown switching, submenu flip',
      'Submenus flip left/up when overflowing viewport edge',
      'Move entry: multi-select support, respects last-file boundary',
      'Edit fields: Enter/Escape no longer triggers rename on selected file',
      'Drag & drop: added T64, D80, D82, P00/S00/U00/R00 support',
    ]},
    { ver: '1.3.3', title: 'PETSCII keyboard input, sticky picker fix', items: [
      'PETSCII input: shift+letter produces shifted chars ($C1-$DA), correct per charset mode',
      'Sticky picker: fixed positioning, stays below input field, scrolls into view',
      'Sticky picker: clamps horizontally to prevent overflow off-screen',
    ]},
    { ver: '1.3.2', title: 'Empty state, dark theme, keyboard menu navigation', items: [
      'Empty state: drop zone with links to create new disk or open a disk image',
      'Dark theme: lighter backgrounds, softer text, lavender accent instead of green',
      'Full keyboard menu navigation: arrow keys, Enter, Escape, submenu support',
      'Keyboard/mouse mode switching: hover disabled during keynav, restored on mouse move',
    ]},
    { ver: '1.3.1', title: 'BASIC viewer fix, disassembly layout', items: [
      'BASIC viewer: match C64 ROM LIST end-of-program check (high byte of link pointer)',
      'Disassembly viewer: fix overlapping address/bytes columns with proper CSS classes',
      'TASS viewer: disabled until parser is validated against real source files',
    ]},
    { ver: '1.3.0', title: 'Disassembly viewer, TASS viewer', items: [
      'View As > Disassembly: separate 6502 disassembly viewer with load address',
      'View As > Turbo Assembler: TASS source file viewer with mnemonic decoding',
      'TASS detection: identifies source files by .TEXT/.BYTE signatures and $C0 padding',
      'Hex viewer simplified (disassembly moved to own viewer)',
    ]},
    { ver: '1.2.0', title: 'Hashing, comparison, interleave, extended BAM', items: [
      'Disk hashing: CRC32 and SHA-256 (Show MD5 Hash menu)',
      'Disk comparison: sector-by-sector diff with another image',
      'Configurable interleave: directory (default 3) and file (default 10)',
      'SpeedDOS/DolphinDOS extended BAM detection for 40-track D64',
      'Extended BAM type shown in health indicator tooltip',
    ]},
    { ver: '1.1.1', title: 'Multi-select, P00, export text, fixes', items: [
      'Multi-select: Ctrl+click to toggle, Shift+click for range',
      'PC64 (.P00/.S00/.U00/.R00) import with original filename extraction',
      'Export as Text: directory listing as .txt file',
      'Report 0 Blocks Free: set all track free counts to 0',
      'Undo in Edit menu (not just Ctrl+Z)',
      'Health indicator: green=OK, yellow=error bytes, red=BAM issues',
    ]},
    { ver: '1.1.0', title: 'New formats, undo, disassembler', items: [
      'D80 (8050) and D82 (8250) disk format support',
      'D64 42-track support',
      'T64 tape image support (read-only)',
      'Undo system (Ctrl+Z) with 20-level snapshot history',
      '6502 disassembler in hex viewer (toggle Hex/Disassembly)',
      'Filesystem health indicator in footer (green/red dot)',
    ]},
    { ver: '1.0.1', items: [
      'Drag & drop: disk images and PRG/SEQ/USR/REL from OS, drag entries to export',
      'File info icon: load/end address, SYS line, 370+ packer detection (Restore64/UNP64)',
      'View As Graphics: 17+ C64 formats, sprites, charsets (MC/hires), Print Shop, color pickers',
      'View As BASIC: V2 (C64) and V7 (C128) detokenizer with syntax coloring',
      'View As PETSCII: C64 screen simulation (CHROUT $FFD2) with Pepto palette',
      'View As Hex: full file hex viewer with PETSCII display',
      'Multi-tab interface: multiple disks, copy/paste files across tabs',
      'D81 subdirectories: create, navigate, full editing inside partitions',
      'GEOS copy/paste with info block, auto-convert prompt for non-GEOS disks',
      'Scan for lost files: orphaned sector chain recovery with export/restore',
      'Fill free sectors with custom hex byte pattern',
      'Context menu on directory entries and empty area',
      'C64 scene visual identity with Pepto VIC-II color palette',
      'Help menu: About, Credits & Thanks, Keyboard Shortcuts, Changelog',
    ]},
    { ver: '1.0.0', title: 'Bug fixes & accuracy', items: [
      'Fix readFileData off-by-one (last sector byte count convention)',
      'Fix D71 side 2 BAM layout (free counts at T18/S0 $DD, bitmaps at T53/S0)',
      'Fix D81 32-bit bitmap operations for sectors 32-39',
      'Fix D71 80-track initBAM overflow into directory sector',
      'Fix D81 max directory sectors (37, not 39)',
      'Validate: CBM partition handling, byte-level BAM rebuild for all formats',
      'Refactor: extract BAM helpers, remove dead code, consolidate styles',
    ]},
    { ver: '0.9', title: 'Core editing features', items: [
      'Export/import PRG, SEQ, USR, REL files with sector chain verification',
      'Real drive sector allocation: interleave 10 (1541/1571), interleave 1 (1581)',
      'GEOS support: info viewer, GEOS signature detection',
      'Charset mode toggle (uppercase/lowercase)',
      'PETSCII keyboard: ALL mode, sticky picker, shift/graphics/CBM modifiers',
      'Align filenames: left, right, center, justify, expand',
      'File viewer with text/hex/records tabs',
    ]},
    { ver: '0.8', title: 'Hex editor & BAM', items: [
      'Hex sector editor with track/sector navigation',
      'BAM viewer with integrity checking and color-coded sector map',
      'Error byte viewer for disks with error info',
      'Edit menu: separator editor with custom PETSCII patterns',
      'Recalculate blocks free from actual BAM',
    ]},
    { ver: '0.7', title: 'Multi-format support', items: [
      'D71 (1571) double-sided disk support',
      'D81 (1581) 3.5" disk support',
      'Format auto-detection by file size',
      'C64 Pro Mono TrueType font for authentic PETSCII display',
      'PETSCII character mapping rewrite with PUA glyphs',
    ]},
    { ver: '0.5', title: 'Foundation', items: [
      'D64 (1541) disk image loading and display',
      '35 and 40 track support',
      'Directory listing with file type, blocks, name',
      'Inline editing: rename files, edit disk name/ID',
      'Insert/remove directory entries, sort directory',
      'Create new empty disk images',
      'Save/Save As disk images',
      'Safe/unsafe PETSCII character support',
      'Dark and light themes',
      'Drag & drop reordering of directory entries',
    ]},
  ];
  var html = '';
  for (var ci = 0; ci < changes.length; ci++) {
    html += '<div style="font-weight:bold;font-size:13px;margin-bottom:4px;color:var(--selected-text);font-family:\'C64 Pro Mono\',monospace">v' + escHtml(changes[ci].ver) +
      (changes[ci].title ? ' <span style="font-size:11px;color:var(--text-muted);font-family:inherit">\u2014 ' + escHtml(changes[ci].title) + '</span>' : '') + '</div>';
    html += '<ul style="margin:0 0 16px 20px;font-size:12px;line-height:1.7">';
    for (var ii = 0; ii < changes[ci].items.length; ii++) {
      html += '<li>' + escHtml(changes[ci].items[ii]) + '</li>';
    }
    html += '</ul>';
  }
  body.innerHTML = html;
  var footer = document.querySelector('#modal-overlay .modal-footer');
  footer.innerHTML = '<button id="modal-close">OK</button>';
  document.getElementById('modal-close').addEventListener('click', function() {
    document.getElementById('modal-overlay').classList.remove('open');
  });
  document.getElementById('modal-overlay').classList.add('open');
});

// ── Download standalone version ──────────────────────────────────────
document.getElementById('opt-download').addEventListener('click', function(e) {
  e.stopPropagation();
  closeMenus();

  var errorMessages = [
    'The hamster powering the download server is on a coffee break.',
    'Looks like the 1541 drive is still formatting... please try again later!',
    'LOAD"*",8,1 \u2014 ?FILE NOT FOUND ERROR',
    'The standalone version went to get milk. Please try again later.',
    'All the bytes are there, they\'re just not in the right order yet.',
    'This file has been scratched. Recovery status: not recoverable \uD83D\uDC80',
    'The bits got lost somewhere between track 18 and the internet.',
    'PRESS PLAY ON TAPE... just kidding. Download not available right now.',
  ];

  var zipName = 'CBM Disk Editor ' + APP_VERSION_STRING + '.zip';

  fetch('dist/' + zipName).then(function(response) {
    if (!response.ok) throw new Error('not found');
    return response.blob();
  }).then(function(blob) {
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = zipName;
    a.click();
    URL.revokeObjectURL(a.href);
  }).catch(function() {
    var msg = errorMessages[Math.floor(Math.random() * errorMessages.length)];
    showModal('Download', [msg]);
  });
});

