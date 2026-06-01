# File operations

Everything you can do to a single file (or selection of files) within a directory.

## Import

Bring an external file *into* the active disk.

### Via File picker

**File → Import File…** opens your OS file picker (filtered to `.prg .seq .usr .rel .p00 .s00 .u00 .r00 .cvt .txt`). After picking, the file is read and written to the current dir.

### Via drag-drop

Drop a file onto the page. The editor inspects the extension:

- `.prg .seq .usr .rel .p00 .s00 .u00 .r00` — imported into the active disk
- `.cvt` — GEOS CVT import (name comes from inside the file)
- `.txt` — converted from ASCII to PETSCII and imported as SEQ
- `.lnx` — extracts all files into a fresh D64 (opens as new tab)
- `.d64 .d71 .d81 .dnp .hdd ...` — opened as a new tab

### Filename handling

- **Standard files** — extension stripped, base name passed through `asciiToNameBytes` (uppercase, only printable PETSCII allowed). If the base name exceeds 16 chars, a dialog appears with the auto-truncated suggestion for you to edit.
- **PC64 (.P00 etc.)** — if the file has the "C64File" magic header, the embedded original filename is used instead.
- **CVT** — the 16-byte GEOS name from bytes `$03-$12` of the CVT is used; the OS file name is ignored.

### Multiple imports

Drop several files at once and they all import sequentially. Disk capacity is checked before each write; if a file doesn't fit, you get a warning and the import stops there (no partial write).

## Export

Write a file *out of* the active disk to your OS.

### Via right-click → Export

Selected file is downloaded as raw bytes with the file's name + the appropriate extension (`.prg`, `.seq`, `.usr`, `.rel`, `.cvt` for GEOS).

### Via drag-out

Drag a directory row out of the browser onto your desktop. Same result.

### CVT export for GEOS files

GEOS files (any structure: VLIR, sequential) right-click → **Export as CVT** produces a CVT container with INFO block + record chains. The CVT round-trips back to a GEOS disk correctly.

### Bulk export

**File → Export Disk → As ZIP** writes every file in the disk to a zip archive plus a Text / CSV / HTML directory listing. The HTML listing is browsable as a stand-alone web page with file links.

**File → Export Disk → As Base64 Data URI** produces a `data:` URI for the whole disk that you can paste into a forum post or git issue (useful for small disks).

## Rename

### Inline

Double-click the filename column (or press Enter on a selected row). A PETSCII editor replaces the rendered name. Type the new name; press Enter to commit, Escape to cancel.

The editor uses the PETSCII picker so you can insert characters not on your keyboard. Reversed bytes (`$00-$1F`) round-trip losslessly.

### Modal

For CFS file rename you can also right-click → **Rename…** which opens a modal with a plain text input. Used when the inline editor doesn't fit (e.g., column too narrow).

## Scratch / Unscratch

### Scratch

**Delete** key or **Edit → Scratch** marks the file deleted: the directory entry's "closed" bit is cleared and the data sectors are returned to the BAM. Mirrors `S0:filename` on a real C64.

In CFS (.hdd) the file goes to a `<<DELETED FILES>>` deldir per partition, with the original tree pointer preserved for full recoverability.

### Unscratch

Restores a previously scratched file. **Only works if the data sectors haven't been claimed** by a fresh write — once another file allocates the sectors, unscratch isn't recoverable.

The recoverability indicator (green / yellow / no dot) next to a scratched file tells you if unscratch will work:

- 🟢 **Green** — data sectors are still free; unscratch will restore the file completely
- 🟡 **Yellow** — partial: some sectors are still free but the chain is incomplete or tail-overwritten
- ⚪ **No dot** — data sectors have been overwritten; only the dir entry can be restored (data will be garbage)

## Lock / Splat

### Lock (`<` suffix)

A locked file shows with a `<` after the type (`PRG<`). On a real C64 this prevents `SCRATCH`. The editor honours the bit for display only — you can still delete the file via the menu.

Toggle via right-click → **Lock / Unlock**, or **Ctrl+Shift+L** / **Ctrl+Shift+U**.

### Splat (`*` prefix)

A splat file shows with a `*` before the type (`*PRG`). It's an OPEN file — the bit means the file wasn't closed properly. Real C64 firmware refuses to load these; on real hardware you need to **Validate** to remove them.

Toggle via right-click → **Splat / Unsplat**, or **Ctrl+\***.

## Change file type

**Edit → Change Type ▸** picks from DEL / SEQ / PRG / USR / REL / CBM. The data sectors don't change; only the type byte (`$02` of the dir entry, low 3 bits) does.

For CFS the available types are slightly different — see [IDE64 .hdd](../formats/ide64-hdd.md).

## Align name

**Edit → Align ▸** repositions the filename within the 16-byte field:

- **Left** — name at the start, `$A0` padding after
- **Right** — `$A0` padding before, name at the end
- **Centre** — equal padding either side
- **Justify** — `$A0` between letters (e.g., `A B C D`)
- **Expand** — same as justify but more aggressively

This affects how the name sorts (CBM sort is byte-based) and how it appears in a `LOAD"$",8` listing.

## Name case

**Edit → Name Case ▸** converts the file's letter bytes:

- **UPPERCASE** — converts `$C1-$DA` to `$41-$5A`
- **lowercase** — converts `$41-$5A` to `$C1-$DA`
- **Toggle Case** — swaps each letter

PETSCII byte values matter here; the visual depends on the current charset mode (see [Options](../ui/options.md)).

## Splat & lock combination

A file can be both locked and splat at the same time. The dir-entry type byte holds independent flags for each.

## Multi-select operations

Most operations work on a selection. Ctrl+click / Shift+click to multi-select, then:

- **Delete** scratches all selected
- **Edit → Change Type** changes all selected
- **Edit → Align** aligns all selected
- **Drag** moves all selected as a group

When a multi-select group contains incompatible files (e.g., a GEOS VLIR and a plain PRG), the action only applies where applicable; the others are skipped with a warning at the end.
