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
    { ver: '1.3.53', title: 'Friendlier changelog', items: [
      'Changelog rewritten in plain English \u2014 technical details left for the git history',
    ]},
    { ver: '1.3.52', title: 'Faster directory rendering', items: [
      'Large directories render more smoothly, especially with many rows selected',
    ]},
    { ver: '1.3.51', title: 'Fresh tabs open clean, undo clears the dirty marker', items: [
      'Fixed: new or freshly opened disks no longer inherit the unsaved-changes marker from another tab',
      'Fixed: undoing back to the last save now correctly clears the unsaved-changes marker',
    ]},
    { ver: '1.3.50', title: 'Warn before discarding unsaved changes', items: [
      'Closing a tab with unsaved changes now prompts before discarding (menu, X, Ctrl+Alt+W)',
      'Close All prompts and lists the affected tabs when any are dirty',
      'Closing or reloading the browser warns whenever any tab has unsaved changes',
    ]},
    { ver: '1.3.49', title: 'Save As uses the tab name', items: [
      'Save As default is the tab\u2019s name (e.g. "New Disk 1.d64") instead of generic "disk.d64"',
      'Renaming via Save As updates the tab title to match',
    ]},
    { ver: '1.3.48', title: 'BAM viewer: tabs stay pinned while scrolling', items: [
      'The BAM tab bar stays visible while scrolling through Sectors / Track Usage / File Fragmentation',
      'Switching tabs scrolls the content back to the top',
    ]},
    { ver: '1.3.47', title: 'Copy Files auto-closes on success', items: [
      'Multi-file copy now closes the progress dialog automatically when everything worked',
      'If some files were skipped, the summary still appears',
    ]},
    { ver: '1.3.46', title: 'Sector editor menu, full-file PETSCII view', items: [
      'Sector editor: Fill / Copy / Paste moved into a \u22EE dropdown so the footer no longer overflows',
      'PETSCII viewer now shows the full file instead of scrolling old rows off the top',
      'Modals always open scrolled to the top',
    ]},
    { ver: '1.3.45', title: 'Modal sizing and positioning', items: [
      'Modals now use consistent width classes and anchor near the top of the viewport',
      'BAM viewer no longer shifts width when switching tabs',
    ]},
    { ver: '1.3.44', title: 'Graphics save split button, BAM tab split', items: [
      'Graphics viewer\u2019s Save As is a split button: main click saves in current format, arrow opens other formats',
      'BAM viewer tabs split: BAM, Track Usage, File Fragmentation',
    ]},
    { ver: '1.3.43', title: 'Visual consistency pass', items: [
      'Unified input/button sizes, border-radius, and dropdown padding',
      'Fixed an orange-warning colour mismatch in light theme',
    ]},
    { ver: '1.3.40', title: 'Per-file fragmentation scores', items: [
      'BAM viewer\u2019s Summary tab shows per-file fragmentation with colour-coded bars',
      'Disk-wide fragmentation percentage in the header, files sorted most fragmented first',
    ]},
    { ver: '1.3.39', title: 'Disk Map: radial BAM visualisation', items: [
      'New Disk Map tab in the BAM viewer \u2014 concentric rings showing tracks and sectors',
      'Hover shows track/sector and file ownership; click opens the sector editor',
    ]},
    { ver: '1.3.38', title: 'Graphics export: PNG, JPG, GIF, SVG', items: [
      'Graphics viewer can now export as PNG, JPG, GIF, or SVG',
      'GIF export uses a built-in encoder (no external dependencies)',
    ]},
    { ver: '1.3.37', title: 'Copy/paste progress, interleave preset fixes', items: [
      'Copy and paste show a progress dialog with file names and a progress bar',
      'Summary lists skipped files with specific reasons',
      'Optimize dialog validates the interleave input and warns on invalid values',
      'Interleave presets corrected against the JiffyDOS V6 User\u2019s Manual',
    ]},
    { ver: '1.3.36', title: 'GEOS overhaul', items: [
      'Fixed: copying GEOS VLIR files (applications, geoWrite docs, geoPaint, fonts, photo albums) now captures and rebuilds each record chain properly',
      'Fixed: GEOS signature no longer corrupts the D81 BAM when converting a disk to GEOS',
      'Scratch, unscratch, validate, BAM viewer, export, and drag-export are now all GEOS and REL aware',
    ]},
    { ver: '1.3.35', title: 'GEOS BAM validation fix', items: [
      'Validate and BAM rebuild now track GEOS info blocks and VLIR record chains',
      'Fixes block-count mismatch warnings and allocator collisions after pasting GEOS files',
    ]},
    { ver: '1.3.34', title: 'Fix copy/paste of GEOS VLIR files', items: [
      'Previously, copying a GEOS VLIR file (applications, geoWrite, geoPaint, fonts, photo albums) only captured the index sector \u2014 pasted files were tiny and unusable',
      'Copy now captures every record chain; paste rebuilds the index and chains on the destination',
    ]},
    { ver: '1.3.33', title: 'CMD FD system partition byte-exact to VICE', items: [
      'D1M / D2M / D4M system partition is now written on track 81 and matches VICE output byte-for-byte',
      'BAM viewer has a Partitions tab listing SYSTEM and user partitions',
      'Fixes the 5-blocks-short bug in the free-block count',
    ]},
    { ver: '1.3.32', title: 'D1M / D2M / D4M as native CMD format', items: [
      'D1M (FD-2000 DD, 829 KB), D2M (FD-2000 HD, 1.6 MB) and D4M (FD-4000 ED, 3.2 MB) handled as proper CMD native partitions',
      'BAM, subdirectories, validate, and integrity check all work correctly',
      'Removed DHD (CMD Hard Drive) support \u2014 images too large for browser use',
    ]},
    { ver: '1.3.31', title: 'DNP BAM and validate fixes', items: [
      'Fixed BAM writes going to the wrong offset inside DNP subdirectories',
      'Validate and integrity check now recurse into linked subdirectories',
    ]},
    { ver: '1.3.30', title: 'Format-driven interleave, DNP subdir expansion', items: [
      'Interleave presets and defaults now live with each disk format',
      'Fixed DNP subdirectory expansion colliding with file sectors during paste',
    ]},
    { ver: '1.3.29', title: 'DNP subdirectory fixes', items: [
      'DNP: nested subdirectories supported',
      'DNP: pasting or importing files inside a subdirectory no longer corrupts the disk',
      'DNP: changing the disk ID offers to update subdirectory headers',
    ]},
    { ver: '1.3.28', title: 'Fix directory expansion overwriting system sectors', items: [
      'Fixed directory expansion overwriting BAM or header sectors on D81, DNP, and D71',
    ]},
    { ver: '1.3.27', title: 'Keyboard shortcuts remap, submenu nav, DNP BAM fix', items: [
      'Keyboard shortcuts remapped off Ctrl+letter combos that conflict with browsers (now Ctrl+Shift or Ctrl+Alt)',
      'Nested submenu keyboard navigation now traverses multiple levels',
      'DNP: fixed sector 34 marking in the BAM',
    ]},
    { ver: '1.3.26', title: 'New disk menu, CMD formats', items: [
      'New menu reorganised by drive type (1541 / 1571 / 1581 / 8050 / 8250 / CMD)',
      'Create empty CMD Native (DNP), CMD FD (D1M / D2M / D4M), and CMD HD (DHD) images',
    ]},
    { ver: '1.3.25', title: 'CMD FD partitions, scratch/unscratch', items: [
      'CMD FD: partition picker; each partition opens as a virtual disk (1541 / 1571 / 1581 / native)',
      'New: Scratch and Unscratch File \u2014 C64-style soft delete and restore',
      'Download the standalone version from the Help menu',
    ]},
    { ver: '1.3.24', title: 'ZipCode decompression', items: [
      'Detect ZipCode file sets (1!\u20144!) on disk and extract them to a new D64 tab',
    ]},
    { ver: '1.3.23', title: 'New format support: G64, DNP, D1M / D2M / D4M', items: [
      'G64 (GCR disk image): auto-decoded to D64 on open',
      'DNP (CMD Native Partition) and D1M / D2M / D4M (CMD FD) read/write',
    ]},
    { ver: '1.3.22', title: 'BASIC dialect selector, sector clipboard', items: [
      'BASIC viewer: dialect selector (V2 / Simons\u2019 / FC3) for C64 programs',
      'Sector clipboard persists across editor sessions and tabs',
      '\u201CScratch File\u201D renamed to \u201CSplat File\u201D',
    ]},
    { ver: '1.3.21', title: 'Export All, more BASIC dialects, sector tools', items: [
      'Export All Files: one-click ZIP download of every file on disk',
      'BASIC: added Simons\u2019 BASIC, Final Cartridge III, and BASIC V3.5 (C16/Plus4) tokens',
      'Sector editor: Fill sector, Copy / Paste sector, back-navigate chain',
      'Export as HTML with C64-coloured directory listing',
      'X64 format: auto-detect and strip the 64-byte header',
    ]},
    { ver: '1.3.20', title: 'Build script and settings export', items: [
      'Build script produces a single self-contained dist/index.html with everything inlined',
      'Options: export and import settings and separators (auto-detects on import)',
      'Show Addresses and Track/Sector columns default to on for new users',
    ]},
    { ver: '1.3.19', title: 'More graphics formats', items: [
      'Added detection for Advanced Art Studio, Saracen Paint, Run Paint, PMC, CDU-Paint, Pixel Perfect (24+ formats in total)',
    ]},
    { ver: '1.3.18', title: 'Menu reorganisation, Save as Separator', items: [
      'Disk and File menus grouped into submenus (Disk Tools, Export)',
      'Save as Separator \u2014 turn any file pattern into a reusable separator',
    ]},
    { ver: '1.3.17', title: 'REL viewer, BAM toggle, File Chains', items: [
      'View As \u2192 REL Records: relative file viewer with hex and ASCII columns',
      'BAM view: right-click a sector to toggle free/used',
      'File Chains view: sector chains for every file on disk',
    ]},
    { ver: '1.3.16', title: 'Name case, compact dir, follow chain', items: [
      'Name case: Ctrl+L / Ctrl+U / Ctrl+T to lowercase, uppercase, or toggle',
      'Compact Directory: remove deleted entries',
      'Follow Chain: jump to the next linked sector',
      'New exports: CSV directory, directory as PNG, geoWrite as plain text',
    ]},
    { ver: '1.3.15', title: 'Search UX and keyboard shortcuts', items: [
      'Search: PETSCII keyboard, scope radio buttons, hex byte display in results',
      'New shortcuts: Ctrl+Alt+H / B / P / D for viewers, Ctrl+Alt+V validate, Ctrl+Shift+S save as',
    ]},
    { ver: '1.3.14', title: 'Search improvements, Go to Sector, PDF fonts', items: [
      'Search: hex byte pattern ($A0 FF or A0FF), per-sector match counts',
      'Go to Sector (Ctrl+G): jump directly to any T:S in the sector editor',
      'PDF export: accurate per-character widths for Helvetica, Times, Courier',
    ]},
    { ver: '1.3.13', title: 'Search + sector editor highlights', items: [
      'Ctrl+F to search the current disk, Ctrl+Shift+F to search every open tab',
      'Sector editor highlights the search matches',
    ]},
    { ver: '1.3.12', title: 'geoWrite viewer, CVT import/export', items: [
      'View As \u2192 geoWrite: styled viewer with fonts, alignment, and inline images',
      'Export geoWrite as RTF or PDF (with formatting and images)',
      'Import and export GEOS ConVerT (CVT) files',
      'Close All tabs from the Disk menu',
    ]},
    { ver: '1.3.10', title: 'Disk optimizer and BAM improvements', items: [
      'New: Optimize Disk \u2014 rewrite file sector chains with chosen interleave for faster loading; optional defragment packs files onto consecutive tracks',
      'BAM view: error sectors with red outlines, orphan detection',
      'Charset and sprite viewer: hardware-accurate multicolor drawing',
      'Directory header row stays visible when scrolling',
    ]},
    { ver: '1.3.9', title: 'Tab indicators for tape and unsaved changes', items: [
      'Tape tabs (T64 / TAP) visually distinct from disk tabs',
      'Dirty tabs show a bullet prefix and italic name',
    ]},
    { ver: '1.3.8', title: 'Tape read-only enforcement', items: [
      'T64 / TAP images are now read-only throughout \u2014 edits, paste, and import are all disabled',
      'Copy, export, and all viewers still work',
    ]},
    { ver: '1.3.7', title: 'Tape file copy and export', items: [
      'T64 / TAP: export files (.prg / .seq) and copy them to the clipboard for paste into other tabs',
    ]},
    { ver: '1.3.6', title: 'TAP support', items: [
      'Read-only TAP tape image support \u2014 decodes pulse timing into file headers and data blocks',
    ]},
    { ver: '1.3.5', title: 'GEOS info and file info fixes', items: [
      'GEOS info: fixed class-name display and description offset',
      'File info: load address shown as a range (e.g. $0801\u2013$08FF)',
      'Ctrl+Alt+N: new disk shortcut',
    ]},
    { ver: '1.3.4', title: 'Disassembler, shortcuts, menu navigation', items: [
      'Disassembler: full 256-opcode table with colour-coded illegal opcodes',
      'Submenus flip to stay on-screen',
      'Move entry: multi-select support',
      'Drag & drop: added T64, D80, D82, and P00/S00/U00/R00',
    ]},
    { ver: '1.3.3', title: 'PETSCII keyboard and sticky picker fixes', items: [
      'PETSCII input: shift+letter produces the correct shifted characters per charset mode',
      'Sticky picker stays below the input and no longer overflows the viewport',
    ]},
    { ver: '1.3.2', title: 'Empty state, dark theme, keyboard menu nav', items: [
      'Empty state: drop zone with links to create a new disk or open an image',
      'Redesigned dark theme with softer contrast and a lavender accent',
      'Full keyboard menu navigation (arrows / Enter / Escape / submenus)',
    ]},
    { ver: '1.3.1', title: 'BASIC viewer and disassembly fixes', items: [
      'BASIC viewer: correct end-of-program detection (matches the C64 ROM)',
      'Disassembly viewer layout fixes',
    ]},
    { ver: '1.3.0', title: 'Disassembly viewer, TASS viewer', items: [
      'View As \u2192 Disassembly: 6502 disassembler with the file\u2019s load address',
      'View As \u2192 Turbo Assembler: TASS source file viewer',
    ]},
    { ver: '1.2.0', title: 'Hashing, comparison, interleave, extended BAM', items: [
      'Disk hashing (CRC32 and SHA-256)',
      'Disk comparison: sector-by-sector diff with another image',
      'Configurable directory and file interleave',
      'SpeedDOS / DolphinDOS extended BAM detection on 40-track D64',
    ]},
    { ver: '1.1.1', title: 'Multi-select, P00, export text', items: [
      'Multi-select in the directory (Ctrl+click to toggle, Shift+click for range)',
      'Import PC64 (.P00 / .S00 / .U00 / .R00) with original filename',
      'Export directory as plain text',
      'Health indicator in the footer (green / yellow / red)',
    ]},
    { ver: '1.1.0', title: 'New formats, undo, disassembler', items: [
      'New format support: D80, D82, D64 42-track, T64 tape',
      'Undo (Ctrl+Z) with a 20-step history',
      '6502 disassembler in the hex viewer',
    ]},
    { ver: '1.0.1', items: [
      'Drag & drop: disk images and files to and from the OS',
      'File info: load/end address, SYS line, detection of 370+ packers',
      'View As: Graphics (17+ formats), BASIC, PETSCII, Hex',
      'Multi-tab interface with copy/paste across tabs',
      'D81 subdirectories: create, navigate, edit inside partitions',
      'GEOS copy/paste with info-block handling',
      'Scan for lost files: recover orphaned sector chains',
      'Context menus on directory entries and empty area',
    ]},
    { ver: '1.0.0', title: 'Accuracy fixes', items: [
      'Accuracy fixes for D71 side-2 BAM, D81 32-bit bitmap operations, directory limits, and CBM partition validation',
    ]},
    { ver: '0.9', title: 'Core editing features', items: [
      'Import and export PRG / SEQ / USR / REL with sector chain verification',
      'Real drive sector allocation (interleave 10 for 1541 / 1571, 1 for 1581)',
      'GEOS info viewer and signature detection',
      'Charset mode toggle, PETSCII keyboard',
      'Filename alignment (left / right / centre / justify / expand)',
    ]},
    { ver: '0.8', title: 'Hex editor and BAM', items: [
      'Hex sector editor with track/sector navigation',
      'BAM viewer with integrity checking and colour-coded sector map',
      'Error byte viewer for disks that carry error info',
      'Separator editor with custom PETSCII patterns',
    ]},
    { ver: '0.7', title: 'Multi-format support', items: [
      'D71 (1571) double-sided and D81 (1581) 3.5" support',
      'Format auto-detection by file size',
      'C64 Pro Mono font for authentic PETSCII display',
    ]},
    { ver: '0.5', title: 'Foundation', items: [
      'D64 (1541) disk image loading and display, 35 and 40 tracks',
      'Inline editing: rename files, edit disk name / ID, insert / remove / sort entries',
      'Create new empty disks, Save / Save As',
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

