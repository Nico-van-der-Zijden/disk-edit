# Contributing to CBM Disk Editor

Thanks for your interest in contributing! This project is a browser-based disk image editor for Commodore 8-bit computers. Contributions of all kinds are welcome: bug reports, feature requests, code, documentation, and test disk images.

## Reporting Issues

- Open an issue on [GitHub](https://github.com/Nico-van-der-Zijden/disk-edit/issues)
- Include the disk format (D64, D71, D81, etc.) and steps to reproduce
- Attach the disk image if possible (or describe how to create one)
- Screenshots of BAM errors or visual glitches are very helpful

## Development Setup

No build tools, package managers, or dependencies required.

1. Clone the repository
2. Open `index.html` in a browser (Chrome, Edge, Firefox, Safari)
3. Edit the JS/CSS files and refresh to see changes

That's it. The app is vanilla JavaScript with zero dependencies.

## Code Style

The project uses 2-space indentation, single quotes, and no trailing commas. Configuration is in `.editorconfig` and `.prettierrc`.

- **JavaScript**: Use `var` for new shared utility code under `assets/js/format/`. UI code may use `const`/`let` where the surrounding code already does.
- **CSS**: Use CSS custom properties (`var(--accent)`, `var(--border)`, etc.) defined in `base.css`. Prefer utility classes from `utilities.css` over inline styles.
- **HTML**: The app is a single `index.html` file. Modal content is built in JavaScript, not as static HTML.

## Architecture

The codebase is organized as global functions across multiple JS files loaded in order by `index.html`. Files are grouped into folders by concern — folders are organizational only; everything still attaches to the global scope (no module system):

```
assets/js/
  format/    Disk format parsers and decoders (cbm-format*, cbm-tape, cbm-archive, cbm-editor, restore64-scanners)
  ui/        UI infrastructure and app shell (modals, menus, directory, fileops, screen, search, export, …)
  ui/disk/   Disk-level operations (CMD container UI, BAM viewer, compare, GEOS info, lost-files/optimize/MD5/…)
  ui/viewers/ Per-file-type viewers (graphics, BASIC, geoWrite, REL, VLIR, fileinfo, TASS)
```

Key files (paths relative to `assets/js/`):

| File | Role |
|------|------|
| `format/cbm-format.js` | Disk format table, sector geometry, BAM, file reading, shared helpers (`forEachFileSector`, `isVlirFile`, `readFileData`, …) |
| `format/cbm-format-petscii.js` | PETSCII ↔ Unicode mapping, screen-code tables |
| `format/cbm-format-cmd.js` | CMD container parsers (RAMLink, FD2000/4000 D1M/D2M/D4M) |
| `format/cbm-format-geos.js` | GEOS file types, VLIR records, info-block decoding, bitmap decompression |
| `format/cbm-editor.js` | Version, app state, undo, BAM integrity, disk validation, disk optimizer |
| `ui/ui-modals.js` | Modal dialogs (`showModal`, `showChoiceModal`, `showProgressModal`) |
| `ui/ui-fileops.js` | File export, import, copy/paste, CVT, RTF, PDF, scratch/unscratch |
| `ui/ui-directory.js` | Directory manipulation, block counting, file addresses |
| `ui/ui-search.js` | Search, Go to Sector, recalculate free blocks |
| `ui/ui-export.js` | Bulk export (ZIP, CSV, HTML, PNG), ZipCode, file chains |
| `ui/ui-init.js` | Drag and drop, theme toggle, initialization |
| `ui/disk/ui-cmd.js` | CMD container UI (RAMLink, FD2000/4000 partition table) |
| `ui/disk/ui-disk-bam.js` | BAM viewer modal, error byte viewer |
| `ui/disk/ui-disk-compare.js` | Compare with… (sector-diff modal) |
| `ui/disk/ui-disk-tools.js` | Lost files, fill free, optimize, resize DNP, MD5, interleave |
| `ui/viewers/ui-viewer-graphics.js` | C64/GEOS graphics renderers (24+ formats) |
| `ui/viewers/ui-viewer-basic.js` | BASIC detokenizer + viewer |
| `ui/viewers/ui-viewer-geowrite.js` | geoWrite document viewer |

### Key patterns

- **`forEachFileSector(data, entryOff, callback)`** walks all sectors of a file including GEOS info blocks, VLIR record chains, and REL side-sector chains. Use this instead of writing manual chain-walking loops.
- **`isVlirFile(data, entryOff)`** detects GEOS VLIR files. Use this instead of inline byte checks.
- **`FILE_TYPE.REL`**, **`FILE_TYPE.CBM`**, etc. are named constants derived from the `FILE_TYPES` array. Use these instead of magic numbers for file type checks.
- **`showProgressModal(title)`** returns `{ status, bar, update(idx, total, label) }` for progress dialogs with browser-yield built in.

### File structure conventions

- GEOS files have an info block sector at directory entry bytes `0x15`/`0x16`, and VLIR files store a record index at the directory T/S (bytes 3-4) instead of a data chain.
- REL files have a side-sector chain at bytes `0x15`/`0x16`.
- When adding code that walks file sectors, always handle GEOS and REL structures via `forEachFileSector` or explicit checks.

## Architecture Deep-Dives

### Undo System

The undo system uses full-buffer snapshots stored per tab.

- **`pushUndo()`** (`format/cbm-editor.js`) copies the entire `currentBuffer` onto the tab's `undoStack` (max depth: 20). Called before every destructive operation — directory edits, sector changes, file writes, BAM modifications.
- **`popUndo()`** restores the most recent snapshot and re-renders the disk.
- **`clearUndo()`** empties the stack when a tab is closed.

Each tab stores its own `undoStack` array. On tab switch, `saveActiveTab()` persists the current state (buffer, format, tracks, partition, undo stack) into the tab object, and `loadTab()` restores it.

This is a simple, reliable approach. The trade-off is memory: each undo level stores a full copy of the disk image (175 KB for D64, 819 KB for D81, up to 3.3 MB for D4M). At 20 levels, a D81 uses ~16 MB of undo memory. This is acceptable for browser apps.

### Tab and Disk State

All disk operations use global state variables:

| Variable | Set by | Purpose |
|----------|--------|---------|
| `currentBuffer` | Tab load / file open | Raw disk image as ArrayBuffer |
| `currentFormat` | `parseDisk()` | Format object from `DISK_FORMATS` (d64, d71, d81, etc.) |
| `currentTracks` | `parseDisk()` | Track count (35, 70, 80, etc.) |
| `currentPartition` | Partition navigation | null for root, or `{ startTrack, partSize, ... }` for D81/DNP partitions |

Tabs store snapshots of all these values plus metadata (filename, dirty flag, undo stack, tape entries for T64/TAP). The `saveActiveTab()` / `loadTab()` functions copy globals to/from the active tab object on every switch.

### BAM Integrity Model

There are two separate BAM checking systems:

**`checkBAMIntegrity()`** (BAM viewer) — read-only analysis:
- Walks all directory entries, follows every file's sector chains via `forEachFileSector`, builds a `sectorOwner` map
- Compares sector ownership against the BAM bitmap
- Reports: free-count mismatches per track (`bamErrors`), sectors owned but marked free (`allocMismatch`), sectors marked used but unowned (`orphanCount`)
- Does not modify the disk

**`validateDisk()`** (Disk > Validate) — repairs the disk:
- Walks all files with its own `followChain` that detects cross-links, circular references, and illegal track/sector values
- Removes splat files (unclosed directory entries)
- Rebuilds the BAM bitmap from scratch based on actual sector ownership
- Reports all errors and corrections in a log

**`buildTrueAllocationMap()`** — used by the sector allocator:
- Walks all files via `forEachFileSector` to build a `{ "track:sector": true }` map
- Used by `allocateSectors()` to find genuinely free sectors without trusting the BAM
- Also used by the orphaned chain scanner and recalculate-free

**BAM bit operations** (`format/cbm-format.js`):
- `bamMarkSectorUsed()` clears the sector's bit in the BAM bitmap, then calls `bamRecalcFree()` to recount and write the track's free count
- `bamMarkSectorFree()` sets the bit and recounts
- Each format defines its own `bamBitMask()` — LSB-first for D64/D71/D81, MSB-first for CMD formats (DNP/D1M/D2M/D4M)

### GCR Decoding (G64 Support)

G64 images store raw GCR-encoded disk data as read by the drive head. The decoder converts this to a standard D64.

1. **`decodeG64toD64(g64)`** reads the G64 header (half-track count, offset table), then iterates each track calling `extractGCRSector()` for every expected sector
2. **`extractGCRSector()`** scans for sync marks (consecutive `0xFF` bytes), decodes the sector header (track, sector, checksum), finds the data sync, and decodes 325 GCR bytes into 256 data bytes
3. **`decodeGCR5()`** converts 5 GCR bytes to 4 data bytes using a 32-entry lookup table (`GCR_DECODE`). Each 5-bit GCR nybble maps to a 4-bit value
4. Track wrap-around is handled by doubling the track buffer so sectors that span the physical index hole are decoded correctly

### GEOS Viewer Architecture

GEOS files use the VLIR (Variable Length Index Record) structure where the directory T/S points to an index sector containing up to 127 record pointers.

**Record access:**
- `readVLIRRecords()` follows the index and returns data per record (lossy — trims trailing nulls)
- `readVLIRRecordsForCopy()` preserves the end-marker vs empty-slot distinction for lossless copy/paste

**Viewer dispatch** (`ui/viewers/ui-viewer-graphics.js`): The GEOS file type byte and info block class name determine which viewer is shown:

| Viewer | GEOS Type | Records Used |
|--------|-----------|--------------|
| geoPaint | Paint image (0x14) | All records — each is 2 card rows (1448 bytes), decompressed via `decompressGeosBitmap()` |
| Photo Scrap | Scrap (0x15) | Sequential file — entire chain is header + compressed bitmap |
| Photo Album | Album (0x18) | Each VLIR record is one scrap image |
| geoWrite | Document (0x07/0x13) | Records 0-60 = text pages, records 64-126 = inline images |
| GEOS Font | Font (0x08) | Each record = one font size with metrics + bitmap |

**geoWrite rendering** parses styled text with font IDs, alignment, and spacing. Inline images from records 64-126 are decompressed and rendered as data-URL `<img>` elements.

### Build Process

The build script (`build.ps1` for Windows, `build.sh` for macOS/Linux) creates a single self-contained HTML file:

1. Reads the version from `assets/js/format/cbm-editor.js`
2. Inlines all CSS files as `<style>` tags
3. Converts font files (.woff2, .ttf) to base64 data URIs in `@font-face` rules
4. Converts FontAwesome font references to inline base64
5. Inlines all JS files as `<script>` tags
6. Writes `dist/index.html` (~1-2 MB, zero external dependencies)
7. Creates `dist/CBM Disk Editor X.Y.Z.zip` for distribution

The output runs from the filesystem without a web server.

## Testing

There's a Node-based automated suite and a manual checklist.

### Automated (`npm test`)

Uses the `node:test` runner that's built into Node — no dependencies. The files live in `tests/`:

| File | Focus |
|------|-------|
| `bam.test.js` | BAM integrity, sector helpers, `forEachFileSector`, VLIR detection, allocation map |
| `format.test.js` | Sector geometry per format, `parseDisk`, `readFileData`, DISK_FORMATS structure |
| `geos.test.js` | GEOS signature, VLIR record reading, file-type detection |
| `petscii.test.js` | PETSCII → PUA / ASCII, `readPetsciiString`, hex helpers |
| `dnp.test.js` | DNP create/resize, `findDnpHighTrackOwners`, CMD BAM helpers |
| `lnx.test.js` | LYNX archive parser variants |

Run with:

```bash
npm test
```

Add a test whenever you add a format-level helper or a bulk operation that has a clear input/output contract.

### Manual

1. **Open test disks** in D64, D71, D81, D80, D82, DNP, D1M, D2M, D4M formats
2. **GEOS files**: copy/paste GEOS VLIR and Sequential files between disks, verify BAM is clean (no errors in BAM viewer), block counts match
3. **Validate**: run Disk > Validate on disks with GEOS, REL, and normal files
4. **Export**: test PNG, JPG, GIF, SVG export from the graphics viewer
5. **Cross-browser**: check Chrome, Firefox, Safari, Edge

Test fixtures live in `tests/fixtures/` (gitignored — keep your own local copies). The automated suite uses `tests/fixtures/org_geos.D64` for D64/GEOS coverage; scratch disks for ad-hoc checks belong under `disks/`, which is also gitignored and may be wiped at any time.

## Submitting Changes

1. Fork the repository
2. Create a feature branch (`git checkout -b my-feature`)
3. Make your changes
4. Run `npm test` and confirm the suite stays green; add tests for new helpers
5. Update `APP_VERSION` in `assets/js/format/cbm-editor.js` (bump the build number)
6. Add a user-facing changelog entry in `assets/js/ui/ui-help.js` (the `changes` array near the top of the changelog handler) — keep it short and plain English; technical detail goes in the commit message
7. Update Credits & Thanks in `assets/js/ui/ui-help.js` if you used new external references
8. Update `README.md` if features or supported formats changed
9. Commit and open a pull request

## License

By contributing, you agree that your contributions will be licensed under the [MIT License](LICENSE).
