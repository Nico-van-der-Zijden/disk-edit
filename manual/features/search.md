# Search

Find files by name or byte content within one disk or across all open tabs.

## Find in current tab

**Edit → Find** (Ctrl+F) opens a search modal:

- **Filename** — matches against the dir-entry names (case-insensitive, partial matches OK)
- **Byte pattern** — searches all file content + system structures for a byte sequence. Specify as hex (`A2 41 8E ...`) or PETSCII (`HELLO`)
- **Sector address** — jump to a track/sector

Results show inline with row numbers; click a result to navigate to it.

## Find in all open tabs

**Edit → Find in All Tabs** (Ctrl+Shift+F) — same search but spans every open disk. Results are grouped by tab.

Useful when you've got 5+ disks open and you're hunting for a specific file (e.g., "where did I put COMPILER.PRG?").

## Go to track / sector

**Disk → Go To Track/Sector** (Ctrl+Shift+G) opens a small modal:

```
Track:  [18]
Sector: [ 1]
       [Cancel] [Go]
```

Jumps to that T/S in the sector editor / hex view. The Go button stays disabled until both fields have valid values for the current format.

## Caveats

- **CFS (.hdd) search is not yet implemented.** Search disabled when you're inside an `.hdd` partition. A CFS-aware Find needs a B-tree walker + byte-slice decoder on every file's content. On the TODO list.
- **Multi-byte patterns** match the literal bytes — they don't unscramble byte-sliced CFS data.
- **Filename match** treats PETSCII bytes literally — a lowercase `a` in your search box matches PETSCII `$61` (which is `a` in lowercase mode, a graphic char in uppercase mode). Use uppercase mode for typical CBM filenames.
