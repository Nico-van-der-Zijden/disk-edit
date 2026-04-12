# CBM Disk Editor

A browser-based disk image editor for Commodore 8-bit computers. No installation required - runs entirely in the browser as a single HTML file with zero dependencies.

## Supported Formats

| Format | Drive | Description |
|--------|-------|-------------|
| D64 | 1541 | 35/40/42 tracks, with optional error bytes |
| D71 | 1571 | Double-sided 5.25" (70/80 tracks) |
| D81 | 1581 | 3.5" disk (80 tracks, 40 sectors/track) |
| D80 | 8050 | IEEE-488 drive (77 tracks) |
| D82 | 8250 | IEEE-488 dual drive (154 tracks) |
| G64 | 1541 | GCR-encoded disk image (auto-decoded to D64) |
| X64 | 1541 | Extended D64 with 64-byte header |
| DNP | CMD | CMD Native Partition (variable size) |
| D1M | CMD FD-2000 | Double density 3.5" (81 tracks, 40 spt) |
| D2M | CMD FD-2000 | High density 3.5" (81 tracks, 80 spt) |
| D4M | CMD FD-4000 | Extra density 3.5" (81 tracks, 160 spt) |
| T64 | Tape | Tape archive container (read-only) |
| TAP | Tape | Raw tape pulse data (read-only) |
| CVT | GEOS | GEOS Convert file format |

## Features

### Directory Editing
- Rename, insert, remove, reorder files via drag and drop
- Sort, align, lock, splat operations
- File type changes, block count editing
- PETSCII character picker for authentic C64 filenames
- Separator entries with custom names

### File Operations
- Import/export PRG, SEQ, USR, REL, CVT files
- Copy/paste files across disk images and tabs
- Export all files as ZIP
- ASCII to PETSCII conversion on import
- Drag and drop: open disk images or import files

### Viewers
- **Hex**: Full sector editor with track/sector navigation
- **BASIC**: V2, V3.5, V7, Simons' BASIC, Final Cartridge III
- **PETSCII**: C64 screen rendering with color codes
- **Disassembly**: 6502/6510 with illegal opcodes
- **Graphics**: 24+ formats (Koala, Art Studio, Advanced Art Studio, FLI, IFLI, sprites, charsets, Print Shop, and more) with PNG export
- **SEQ**: Sequential file viewer with PETSCII color rendering
- **REL**: Relative file record viewer

### GEOS Support
- geoPaint, Photo Scrap, Photo Album viewers
- geoWrite document viewer with styled text and inline images
- GEOS font viewer
- Export to RTF and PDF

### Disk Tools
- BAM viewer with integrity checking and file ownership display
- Disk optimizer with configurable interleave presets per drive type
- Validate disk and recalculate BAM
- Lost file recovery (orphaned sector chain scanning)
- Cross-link detection
- Fill free sectors
- ZipCode decompression (1!-4! file sets)

### CMD Native Support
- DNP, D1M, D2M, D4M with full read/write
- Nested subdirectories (DIR type)
- Shared BAM across subdirectories
- System partition at track 26 (D1M/D2M/D4M)

### Other
- Multi-tab interface for working with multiple disks
- 40+ keyboard shortcuts
- Search across current disk or all open tabs
- Packer detection with 370+ signatures
- CSV export with optional MD5 checksums
- Directory export as PNG or HTML
- Dark and light themes
- D81 subdirectories (CBM partitions)

## Getting Started

1. Open `index.html` in a modern browser (Chrome, Edge, Firefox, Safari)
2. Drop a disk image onto the window, or use **Disk > Open**
3. Create a new disk with **Disk > New**

No web server required - works directly from the filesystem.

## Building a Standalone Version

The build script creates a single self-contained HTML file with all JS, CSS, and fonts inlined:

```powershell
powershell -ExecutionPolicy Bypass -File build.ps1
```

Output:
- `dist/index.html` - Single file, no dependencies
- `dist/CBM Disk Editor X.Y.Z.zip` - Ready to distribute

## Project Structure

```
index.html              Main application (HTML + CSS)
assets/
  js/
    cbm-format.js       Disk format definitions, BAM operations, GCR decoder
    cbm-editor.js       Version, tabs, undo, BAM integrity, disk optimizer
    cbm-petscii.js      PETSCII character picker
    ui-modals.js        Modal dialogs and input prompts
    ui-render.js        Directory rendering, partition navigation
    ui-menus.js         Context menu, selection, keyboard shortcuts
    ui-editing.js       Inline editing, save helpers, menu bar, tabs
    ui-disk-ops.js      BAM viewer, validate, optimize, fill, scan, add directory
    ui-options.js       Options menu, settings export/import
    ui-viewers.js       Graphics, GEOS, BASIC, REL, TASS viewers
    ui-screen.js        PETSCII renderer, hex viewer, sector editor, disassembler
    ui-search.js        Search and Go to Sector
    ui-directory.js     Directory manipulation, sort, separators, property editors
    ui-fileops.js       File export, import, copy/paste, CVT, RTF, PDF
    ui-export.js        Bulk export (ZIP, CSV, HTML, PNG), ZipCode, name case
    ui-init.js          Drag and drop, theme toggle, initialization
    ui-help.js          About, credits, keyboard shortcuts, changelog
  fontawesome/           FontAwesome icons (bundled)
  webfonts/              C64 Pro Mono font + FontAwesome webfonts
build.ps1               Build script (PowerShell)
dist/                   Build output (ignored)
ExampleDisks/           Example disk images for testing
```

## Credits

- **Packer detection**: [Restore64](https://restore64.dev/) - 370+ signatures, based on [UNP64](https://csdb.dk/release/?id=235681) by iAN CooG
- **C64 color palette**: [Pepto's VIC-II palette](https://www.pepto.de/projects/colorvic/2001/)
- **Font**: [C64 Pro Mono](https://style64.org/c64-truetype) by Style64
- **Icons**: [FontAwesome](https://fontawesome.com/) (Free)

## License

See [LICENSE](LICENSE) for details.
