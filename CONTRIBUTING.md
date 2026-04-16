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

- **JavaScript**: Use `var` for new shared utility code in `cbm-format.js`. UI code may use `const`/`let` where the surrounding code already does.
- **CSS**: Use CSS custom properties (`var(--accent)`, `var(--border)`, etc.) defined in `base.css`. Prefer utility classes from `utilities.css` over inline styles.
- **HTML**: The app is a single `index.html` file. Modal content is built in JavaScript, not as static HTML.

## Architecture

The codebase is organized as global functions across multiple JS files loaded in order by `index.html`:

| File | Role |
|------|------|
| `cbm-format.js` | Disk format definitions, sector geometry, BAM operations, file reading, shared helpers (`forEachFileSector`, `isVlirFile`, `readFileData`, etc.) |
| `cbm-editor.js` | Version, app state, undo, BAM integrity, disk validation, disk optimizer |
| `ui-modals.js` | Modal dialogs (`showModal`, `showChoiceModal`, `showProgressModal`) |
| `ui-fileops.js` | File export, import, copy/paste, CVT, RTF, PDF, scratch/unscratch |
| `ui-directory.js` | Directory manipulation, block counting, file addresses |
| `ui-viewers.js` | Graphics, GEOS, BASIC, REL viewers with export |
| `ui-disk-ops.js` | BAM viewer, validate, optimize, interleave settings |
| `ui-search.js` | Search, Go to Sector, recalculate free blocks |
| `ui-export.js` | Bulk export (ZIP, CSV, HTML, PNG), ZipCode, file chains |
| `ui-init.js` | Drag and drop, theme toggle, initialization |

### Key patterns

- **`forEachFileSector(data, entryOff, callback)`** walks all sectors of a file including GEOS info blocks, VLIR record chains, and REL side-sector chains. Use this instead of writing manual chain-walking loops.
- **`isVlirFile(data, entryOff)`** detects GEOS VLIR files. Use this instead of inline byte checks.
- **`FILE_TYPE.REL`**, **`FILE_TYPE.CBM`**, etc. are named constants. Use these instead of magic numbers for file type checks.
- **`showProgressModal(title)`** returns `{ status, bar, update(idx, total, label) }` for progress dialogs.

### File structure conventions

- GEOS files have an info block sector at directory entry bytes `0x15`/`0x16`, and VLIR files store a record index at the directory T/S (bytes 3-4) instead of a data chain.
- REL files have a side-sector chain at bytes `0x15`/`0x16`.
- When adding code that walks file sectors, always handle GEOS and REL structures via `forEachFileSector` or explicit checks.

## Testing

There is no automated test suite. Test manually:

1. **Open test disks** in D64, D71, D81, D80, D82, DNP, D1M, D2M, D4M formats
2. **GEOS files**: copy/paste GEOS VLIR and Sequential files between disks, verify BAM is clean (no errors in BAM viewer), block counts match
3. **Validate**: run Disk > Validate on disks with GEOS, REL, and normal files
4. **Export**: test PNG, JPG, GIF, SVG export from the graphics viewer
5. **Cross-browser**: check Chrome, Firefox, Safari, Edge

A GEOS test disk is available at `disks/org_geos.D64`.

## Submitting Changes

1. Fork the repository
2. Create a feature branch (`git checkout -b my-feature`)
3. Make your changes
4. Update `APP_VERSION` in `cbm-editor.js` (bump the build number)
5. Add a changelog entry in `ui-help.js` (the `changes` array at the top of the changelog handler)
6. Update Credits & Thanks in `ui-help.js` if you used new external references
7. Update `README.md` if features or supported formats changed
8. Commit and open a pull request

## License

By contributing, you agree that your contributions will be licensed under the [MIT License](LICENSE).
