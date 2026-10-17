# File operations

Everything you can do to a single file (or selection of files) within a directory.

## Import

Bring an external file *into* the active disk.

### Via File picker

**File → Import File** opens your OS file picker (filtered to `.prg .seq .usr .rel .p00 .s00 .u00 .r00 .cvt .txt`). You can pick several files at once; they are written to the current dir in order. Picking several shows one summary at the end listing any that failed, and each successful file is its own undo step.

**Disk → Open...** takes the same route as drag-and-drop (below), so it also opens `.hdd` images, ZipCode sets and archives, and imports `.prg` / `.seq` / etc. into the open disk.

### Via drag-drop

Drop a file onto the page. Dropped files go through the same import path as File → Import File (same summary, same undo steps). The editor inspects the extension:

- `.prg .seq .usr .rel .p00 .s00 .u00 .r00` — imported into the active disk
- `.cvt` — GEOS CVT import (name comes from inside the file)
- `.txt` — converted from ASCII to PETSCII and imported as SEQ
- `.lnx` — extracts all files into a fresh D64 (opens as new tab)
- `.d64 .d71 .d81 .dnp .hdd ...` — opened as a new tab
- ZipCode sets — these have no extension, so they are matched by name. Drop a
  whole set and it becomes a D64 in a new tab; drop several at once and each
  gets its own tab. An incomplete set is reported rather than ignored. All
  three variants are handled:
  - **DiskPacked** `1!NAME`…`4!NAME`, plus `5!NAME` for a 40-track disk. The
    common one — a compressed sector copy of a whole disk.
  - **SixPack** `1!!NAME`…`6!!NAME` (note the two `!`). Stores raw GCR, so it
    can carry error-protected and fastloader disks; sectors that were
    unreadable on the original are preserved as CBM error codes, and such a
    set opens as a `+Errors` image.
  - **FilePacked** `a!NAME`…`w!NAME` plus the `x!NAME` directory file. Packs
    individual files rather than a disk, so it extracts onto a fresh D64 the
    way a LYNX archive does.
- `.zip .tar .tgz .tar.gz .gz .lha .lzh` — opened as containers. Their
  contents are classified by the same rules, so a disk image inside a tarball
  opens as a tab and a ZipCode set inside a zip is reassembled. When a
  container holds exactly one openable thing you get no dialog at all;
  otherwise you pick from a list. LHA supports the `-lh0-` (stored) and
  `-lh5-` methods and verifies every member against its stored CRC. A damaged
  ZIP member (bad CRC, unsupported method) is skipped and reported instead of
  failing the whole archive.

Anything the editor doesn't recognise is reported — a drop that does nothing
will tell you why.

### REL files

`.rel` / `.r00` imports into a CBM-DOS disk are **refused**: the editor doesn't build REL side sectors yet, so the result would be a broken file. The same applies to pasting a REL file into a CBM-DOS disk — it's skipped and listed in the paste summary.

### Filename handling

- **Standard files** — extension stripped, base name converted to PETSCII. If the base name exceeds 16 chars, a dialog appears with the auto-truncated suggestion for you to edit.
- **PC64 (.P00 etc.)** — if the file has the "C64File" header, the embedded original filename is used instead.
- **CVT** — the GEOS name stored inside the CVT is used; the OS file name is ignored.

### Multiple imports

Files are imported one after another. A file that fails (directory full, not enough free blocks, refused type) doesn't stop the batch — it's listed under **Failed** in the summary at the end.

## Export

Write a file *out of* the active disk to your OS.

### Via File → Export ▸ Export File (Ctrl+Alt+E)

The selected file(s) are downloaded as raw bytes with the file's name + the appropriate extension (`.prg`, `.seq`, `.usr`, `.rel`).

**Exception: ZipCode parts** (`1!NAME`, `1!!NAME`, `a!NAME`, `x!NAME`) export with **no** extension appended, keeping the exact name that was on the disk. That matters because ZipCode parts are recognised by name, not by extension — an exported `1!!NAME.prg` would be treated as a file to import when dropped back in, instead of being reassembled. This applies to drag-out and bulk ZIP export too.

### Via drag-out

Drag a directory row out of the browser onto your desktop (Chrome / Edge). Same result.

### CVT export for GEOS files

GEOS files (VLIR or sequential) → **File → Export ▸ Export as CVT** produces a CVT container with INFO block + record chains. The CVT round-trips back to a GEOS disk correctly.

### Bulk export

**Disk → Export Disk ▸ Export All Files** writes every closed SEQ / PRG / USR / REL file on the disk into one ZIP. GEOS VLIR files are skipped — export those individually as CVT. ZIPs the editor creates carry valid CRC-32s, so any unzip tool accepts them.

**Export as Text / CSV / HTML** and **Export Directory as PNG** write the directory listing only.

**Disk → Export Disk ▸ Show as Base64 Data URI** produces a `data:` URI for the whole disk that you can paste into a forum post or git issue (useful for small disks).

## Rename

Double-click the filename column (or press Enter / F2 on a selected row). A PETSCII editor replaces the rendered name. Type the new name; press Enter to commit, Escape to cancel. CFS (.hdd) entries use the same inline editor.

The editor uses the PETSCII picker so you can insert characters not on your keyboard. Reversed bytes (`$00-$1F`) round-trip losslessly.

## Scratch / Unscratch / Remove

### Scratch

**File → Scratch File** works like `S0:filename` on a real drive: the type byte becomes `$00` (the entry disappears from the listing) and the data sectors are returned to the BAM. The track/sector link stays, so the file can be unscratched until its sectors are reused. Locked files can't be scratched; with a multi-selection, locked and non-file entries are left alone.

In CFS (.hdd) the file goes to a `<<DELETED FILES>>` deldir per partition, with the original tree pointer preserved for full recoverability.

### Unscratch

Restores previously scratched file(s). A scratch doesn't keep the file type, so you're asked to restore it as PRG, SEQ or USR. **Refused if any of the file's sectors now belong to another file** — the refusal names the file and how many sectors were taken. With a multi-selection, the files that can be restored are, and the rest are listed.

The recoverability indicator next to a scratched file is a quick guide:

- **Heart-pulse** — every sector of the chain is still free in the BAM and the chain ends cleanly
- **Broken heart** — some sectors are free, or the chain is broken
- **Skull** — nothing recoverable (invalid start, no free sectors)

### Remove Entry

**File → Remove Entry** (or **Delete**) takes the entry out of the directory and closes the gap; the data sectors are **not** freed. Works on a multi-selection. Removing a 1581 sub-partition frees its tracks; if it still contains files you're asked first (**Move to Root** / **Remove All** for a single partition).

## Lock / Splat

### Lock (`<` suffix)

A locked file shows with a `<` after the type (`PRG<`). On a real C64 this prevents `SCRATCH`; the editor's Scratch is disabled for locked files too. Remove Entry still works.

Toggle via **File → Lock File / Unlock File**, or **Ctrl+<**.

### Splat (`*` prefix)

A splat file shows with a `*` before the type (`*PRG`). It's an OPEN file — the bit means the file wasn't closed properly. Real C64 firmware refuses to load these; **Validate** removes them.

Toggle via **File → Splat File / Unsplat File**, or **Ctrl+\***.

## Change file type

**File → File Type ▸** picks from DEL / SEQ / PRG / USR / REL / CBM (types the format doesn't support are greyed). The data sectors don't change; only the type byte (`$02` of the dir entry, low 3 bits) does.

For CFS the available types are slightly different — see [IDE64 .hdd](../formats/ide64-hdd.md).

## Align name

**File → Align ▸** repositions the filename within the 16-byte field. Leading / trailing spaces and `$A0` padding are stripped first, then the field is filled with `$20` spaces:

- **Align Left** — name at the start
- **Align Right** — name at the end
- **Center** — equal padding either side
- **Justify** — spaces distributed between the words (single word: left)
- **Expand** — name at the start, spaces out to the full 16 bytes

This affects how the name sorts (CBM sort is byte-based) and how it appears in a `LOAD"$",8` listing.

## Name case

**File → Name Case ▸** converts the file's letter bytes:

- **UPPERCASE** — `$41-$5A` → `$C1-$DA`
- **lowercase** — `$C1-$DA` → `$41-$5A`
- **Toggle Case** — swaps each letter

Shortcuts: **Ctrl+Shift+U** / **Ctrl+Shift+L** / **Ctrl+Shift+T**. PETSCII byte values matter here; the visual depends on the current charset mode (see [Options](../ui/options.md)).

## Splat & lock combination

A file can be both locked and splat at the same time. The dir-entry type byte holds independent flags for each.

## Multi-select operations

Ctrl+click / Shift+click (or Shift+↑/↓) to multi-select, then:

- **Delete** / **File → Remove Entry** removes all selected
- **File → Scratch File** / **Unscratch File** work on all selected
- **File → File Type** changes all selected
- **File → Align** and **Name Case** apply to all selected
- **Copy** / **Export** take the whole selection

Dragging a row to reorder moves only that row.
