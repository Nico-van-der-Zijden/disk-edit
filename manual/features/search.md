# Search

Find bytes or names within one disk or across all open tabs.

## Find in current tab

**Search → Find...** (Ctrl+F) opens a search dialog with a text field (the PETSCII picker opens while it has focus) and a scope:

- **All sectors** — every sector of the disk, file data and system structures alike
- **Filenames** — the name field of each directory entry on the directory track
- **Disk name** — the disk name in the header
- **Disk ID** — the disk ID in the header

The search term is read as **hex** when it looks intentional — a `$` prefix (`$A9 $00`, `$A900`) or space-separated pairs (`A2 41 8E`). Otherwise it's text and matches either the literal bytes you typed or their uppercased form (unshifted PETSCII, `$41-$5A`), so `load` finds `LOAD` in a normal CBM filename.

Press **Enter** or **Search** to run it; the dialog stays open. Each result shows the track / sector, a few bytes of context and how many hits that sector has. Clicking a result closes the dialog and opens the sector editor at that sector with every occurrence highlighted.

## Find in all open tabs

**Search → Find in All Tabs...** (Ctrl+Shift+F) — same search but spans every open disk. Results are grouped by tab; clicking one switches to that tab first. IDE64 `.hdd` tabs are skipped.

## Go to track / sector

**Search → Go to Sector...** (Ctrl+Shift+G) opens a small dialog:

```
Track: $[12]  Sector: $[00]
              [Cancel] [Go]
```

Values are hex. **Enter** or **Go** opens the sector editor at that T/S; nothing happens until both values are valid for the current format.

## Caveats

- **CFS (.hdd) search is not yet implemented.** Find and Go to Sector are disabled in an `.hdd` tab. A CFS-aware Find needs a B-tree walker + byte-slice decoder on every file's content. On the TODO list.
- **Byte patterns** match the literal bytes in sector order — a match that straddles two sectors of a file chain isn't found.
