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
| LNX | Lynx | Archive container of C64 files (extracts to a new D64) |

### Format Detection

Formats are detected by file size, with magic byte checks for ambiguous cases:

| Format | File Size (bytes) | With Error Bytes | Notes |
|--------|-------------------|------------------|-------|
| D64 35t | 174,848 | 175,531 | Default |
| D64 40t | 196,608 | 197,376 | |
| D64 42t | 205,312 | 206,114 | |
| D71 70t | 349,696 | 351,062 | |
| D71 80t | 393,216 | 394,752 | |
| D81 | 819,200 | 822,400 | |
| D80 | 533,248 | — | |
| D82 | 1,066,496 | — | |
| D1M | 829,440 | 832,680 | |
| D2M | 1,658,880 | 1,665,360 | |
| D4M | 3,317,760 | 3,330,720 | |
| DNP | n × 65,536 | — | Header byte `$48` at offset 258 |
| G64 | Variable | — | Magic: `GCR-1541` at offset 0 |
| X64 | Variable | — | Magic: `C1541` at offset 0 |
| T64 | Variable | — | Magic: `C64` at offset 0 |
| TAP | Variable | — | Magic: `C64-TAPE-RAW` at offset 0 |

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
- LYNX (.lnx) archive extraction: drop an archive and every file lands on a fresh D64 tab; CVT-containing archives unpack to a GEOS-formatted disk with proper VLIR structure

### Viewers
- **Hex**: Full sector editor with track/sector navigation
- **BASIC**: V2, V3.5, V7, Simons' BASIC, Final Cartridge III
- **PETSCII**: C64 screen rendering with color codes
- **Disassembly**: 6502/6510 with illegal opcodes
- **Graphics**: 24+ formats (Koala, Art Studio, Advanced Art Studio, FLI, IFLI, sprites, charsets, Print Shop, and more) with PNG, JPG, GIF, SVG export
- **C64 Charset**: live preview of "THE QUICK BROWN FOX…" in the selected tile size (1×1, 2×1, 1×2, 2×2), plus the full character grid
- **SEQ**: Sequential file viewer with PETSCII color rendering
- **REL**: Relative file record viewer

### GEOS Support
- geoPaint, Photo Scrap, Photo Album viewers
- geoWrite document viewer with styled text and inline images
- GEOS font viewer: pangram sample per size + labeled 16×6 glyph grid
- Export GEOS fonts as native C64 charsets (.prg, auto-detects 1×1/2×1/1×2/2×2 tile fit, $3000 load)
- Export to RTF and PDF
- Convert plain D64 to GEOS format on the fly when importing CVT files

### Disk Tools
- BAM viewer with four tabs: BAM (grid + integrity), Track Usage, File Fragmentation (per-file score), and a radial Disk Map mirroring physical geometry
- Disk optimizer with configurable interleave presets per drive type and optional defragment
- Validate disk and recalculate BAM (GEOS / REL aware)
- Lost file recovery (orphaned sector chain scanning)
- Cross-link detection
- Compact Directory (remove deleted slots)
- File Chains view (sector chain for every file)
- Fill free sectors
- ZipCode decompression (1!–4! file sets)
- Resize Image (DNP only — grow/shrink the track count, auto-compacts files on shrink)
- Convert to GEOS Format (adds the GEOS signature to a regular disk)

### CMD Native Support
- DNP, D1M, D2M, D4M with full read/write
- Nested subdirectories (DIR type)
- Shared BAM across subdirectories
- System partition on the last track (D1M/D2M/D4M)
- DNP track resize with auto-compaction (Disk → Disk Tools → Resize Image…)

### Other
- Multi-tab interface for working with multiple disks, with unsaved-changes warnings on close / reload / Close All
- 40+ keyboard shortcuts
- Search across current disk or all open tabs
- Packer detection with 370+ signatures
- CSV, PNG, HTML, plain-text directory export
- Disk hashing (CRC32, SHA-256) and sector-by-sector disk comparison
- Dark and light themes
- D81 subdirectories (CBM partitions)

## Getting Started

1. Open `index.html` in a modern browser (Chrome, Edge, Firefox, Safari)
2. Drop a disk image onto the window, or use **Disk > Open**
3. Create a new disk with **Disk > New**

No web server required - works directly from the filesystem.

## Building a Standalone Version

The build script creates a single self-contained HTML file with all JS, CSS, and fonts inlined:

**Windows (PowerShell):**
```powershell
powershell -ExecutionPolicy Bypass -File build.ps1
```

**macOS / Linux:**
```bash
./build.sh
```

Output:
- `dist/index.html` - Single file, no dependencies
- `dist/CBM Disk Editor X.Y.Z.zip` - Ready to distribute

## Project Structure

```
index.html              Main application (HTML)
assets/
  css/
    base.css            Variables, fonts, reset, scrollbar
    menus.css           Menu bar and submenus
    layout.css          Content area, tab bar, empty state
    directory.css       Disk panel, header, directory listing
    petscii.css         PETSCII character picker
    modal.css           Modal dialogs
    editors.css         Hex editor, geoWrite, REL, search results
    utilities.css       Utility classes, form elements, code tags
    bam.css             BAM viewer, compact bars, canvas map
    viewers.css         Error bytes, file viewer, separator editor
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
build.sh                Build script (macOS/Linux)
tests/                  Automated test suite (Node.js built-in runner)
  bam.test.js           BAM integrity, sector ops, forEachFileSector
  format.test.js        Sector geometry, disk parsing, readFileData
  geos.test.js          GEOS signature + VLIR record parsing
  petscii.test.js       PETSCII / PUA conversion
  dnp.test.js           DNP format, resize, high-track owners
  lnx.test.js           LNX archive parser
dist/                   Build output (ignored)
ExampleDisks/           Example disk images for testing
```

## Testing

The repo ships with a small Node-based test suite (zero runtime dependencies — uses the `node:test` runner that's built into modern Node):

```bash
npm test
```

Covers sector geometry, BAM operations, PETSCII conversion, GEOS VLIR helpers, DNP format + resize, and LNX archive parsing.

## Credits

- **Packer detection**: [Restore64](https://restore64.dev/) - 370+ signatures, based on [UNP64](https://csdb.dk/release/?id=235681) by iAN CooG
- **C64 color palette**: [Pepto's VIC-II palette](https://www.pepto.de/projects/colorvic/2001/)
- **Font**: [C64 Pro Mono](https://style64.org/c64-truetype) by Style64
- **Icons**: [FontAwesome](https://fontawesome.com/) (Free)

### Technical References

- [VICE Manual](https://vice-emu.sourceforge.io/vice_17.html) — Disk image format documentation
- [Peter Schepers](https://ist.uwaterloo.ca/~schepers/formats.html) — D64, D71, D81, D80, D82, D2M-DNP format specifications
- [libcbmimage](https://github.com/OpenCBM/libcbmimage) — CBM disk image library (CMD FD/HD reference)
- [Inside geoWrite](https://www.pagetable.com/?p=1471) by Michael Steil — geoWrite file format documentation
- [geowrite2rtf](https://github.com/mist64/geowrite2rtf) by Michael Steil — CVT/geoWrite parsing reference
- [Thornton2](https://thornton2.com/programming/geos/compaction-strategy.html) — GEOS bitmap compaction strategy
- [Oxyron 6502 Opcode Table](https://www.oxyron.de/html/opcodes02.html) — Illegal opcode reference
- [C64-Wiki](https://c64-wiki.com/) — Commodore 64 technical reference
- [STA's C64 pages](https://sta.c64.org/) — Disk format details
- [CSDb](https://csdb.dk/) — C64 Scene Database
- [Zimmers.net](https://www.zimmers.net/anonftp/pub/cbm/) — CBM file archive and GEOS format documentation
- [JiffyDOS V6 User's Manual](https://archive.org/details/JiffyDos_V6_Users_Manual) — Sector interleave and fast loader reference

## License

See [LICENSE](LICENSE) for details.
