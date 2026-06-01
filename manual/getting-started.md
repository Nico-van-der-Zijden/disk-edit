# Getting started

CBM Disk Editor is a single HTML page hosted at <https://d64.sannic.nl>. There is nothing to install. Everything happens in your browser tab — no upload, no account, no cloud.

## Opening your first disk

Three ways to load a disk:

1. **Disk → Open** — opens your OS file picker. Pick a disk image (`.d64`, `.d71`, `.d81`, `.hdd`, etc.) and the editor will detect the format from the file size + magic bytes.
2. **Drag and drop** — drop one or more files onto the page. Disks open as tabs; files (`.prg`, `.cvt`, etc.) get imported into the *currently active* disk tab; archives (`.lnx`) extract to a new D64; CMD-container files (`.dhd`, `.rml`) open as partition lists.
3. **Disk → Recent** — your last opened disks (stored in browser localStorage; nothing leaves your computer).

If you don't have a disk image to try, **Disk → New** creates a freshly-formatted blank disk in any supported format.

## What you see

```
┌─────────────────────────────────────────────────────┐
│  Disk  File  Edit  Search  View  Options  Help    │  ← Menubar
├─────────────────────────────────────────────────────┤
│  [Open] [Save] [Close] | [Undo] [Copy] [Paste] ...  │  ← Toolbar (optional)
├─────────────────────────────────────────────────────┤
│  disk1.d64 ●   disk2.d81   ide.hdd   +              │  ← Tab bar
├─────────────────────────────────────────────────────┤
│  📀 DISK NAME           "ID 2A"   664 BLOCKS FREE   │  ← Disk header
├─────────────────────────────────────────────────────┤
│   1  "FILENAME"            PRG                      │  ← Directory listing
│   5  "ANOTHER FILE"        SEQ                      │
│  10  "EXAMPLE"             PRG                      │
│  ...                                                │
├─────────────────────────────────────────────────────┤
│  35 tracks, 664 blocks free, 8 files                │  ← Footer
└─────────────────────────────────────────────────────┘
```

- The **disk header** shows the disk name, the 5-byte ID/DOS-type field, and the free-block count. On `.hdd` images it shows the disk label.
- The **directory listing** mirrors a real CBM `LOAD"$",8` listing — file size in blocks, filename in quotes, file type. Click a row to select it; double-click to rename (on regular files) or to enter a sub-directory (on DIR-type entries).
- The **footer** shows track count, free blocks, file count, and a health indicator (green / yellow / red dot) hinting at BAM / file-chain integrity.

## Editing

Most edits are inline:

- **Double-click a filename** to rename. Type the new name; press Enter to commit, Escape to cancel.
- **Double-click the block-count column** to edit a file's block count.
- **Double-click the type column** to change file type (PRG ↔ SEQ ↔ USR ↔ REL ↔ DEL).
- **Drag rows** to reorder. Hold Ctrl while dragging to copy instead of move (where it makes sense).
- **Drag a file out of the browser** to export it to your OS.
- **Drag a file into the browser** to import it into the current disk.

Disk-level changes (sort, validate, scan for lost files, etc.) live under **Disk → Disk Tools**.

## Saving

The editor never writes to your disk automatically. To save:

- **Disk → Save** writes the current disk image to your Downloads folder, with the file extension the format expects.
- **Disk → Save As...** lets you change the extension or filename.
- **Disk → Export Disk** can produce a zip with the disk + a Text / CSV / HTML directory listing.
- **File → Export ▸ Export File** writes the selected file(s) to your OS as raw bytes.

The tab title shows a `●` next to the disk name when there are unsaved changes. Closing a tab with unsaved changes brings up a confirmation prompt.

## Charset modes

C64 disks store filenames in PETSCII. The two on-screen rendering modes are:

- **Uppercase mode** (default, C64 boot mode) — letters render as `A-Z`; the C= and other graphic codes show as graphic glyphs.
- **Lowercase mode** — letters render as `a-z`; some bytes display differently (uppercase letters at the shifted positions).

Switch via **View → Switch to Uppercase / Lowercase** (the label flips to show the *other* mode) or the keyboard shortcut **Ctrl+Shift** (matches what a real C64 does with **C= + Shift**). The choice persists in localStorage and applies across all open tabs.

## What's not supported

- Writing TAP / T64 — read-only (tape image producers are rare in practice).
- Writing NIB / NBZ — these are raw nibble dumps; the editor converts them to G64 in memory so saving produces a proper `.g64`.
- Archive containers (LNX) — read by extracting all files into a fresh D64. There's no LNX writer.
- Real-hardware drive emulation — this isn't an emulator; it edits *images* of disks. Pair it with VICE / EmulatorJS / real hardware to test the disks.

## Next steps

- Pick your disk format from the [Formats](README.md#formats) section for format-specific details.
- See [Keyboard shortcuts](ui/keyboard-shortcuts.md) to speed up common edits.
- See [Tips & gotchas](tips-and-gotchas.md) for the non-obvious stuff.
