# Copy / paste across disk formats

Copy a file or directory in one disk and paste it into another — including across disk-image formats.

## File-level copy / paste

Select one or more files in a directory → **File → Copy** (or Ctrl+C). The clipboard now holds those file entries (name + type + data + GEOS metadata if applicable).

Switch to another tab (different disk), navigate to where you want the files → **File → Paste** (or Ctrl+V). Each file is written to the destination dir with its original name, type, and content.

If the destination has matching names, you get a **Cancel / Rename / Overwrite** prompt:

- **Cancel** — abort the paste entirely
- **Rename** — auto-suffix conflicting files with " (2)", " (3)", … " (99)". Truncates names to keep within 16 bytes
- **Overwrite** — replace existing files with the same name

The prompt applies to **every conflict in the paste set** — there's no per-file decision; one prompt covers everything.

## Cross-family translation

Pasting between different disk families translates file types where they differ:

| Source | Destination | Translation |
|---|---|---|
| CBM-DOS PRG | CFS | NORMAL with `PRG` suffix |
| CBM-DOS SEQ | CFS | NORMAL with `SEQ` suffix |
| CBM-DOS REL | CFS | NORMAL with `REL` suffix (record length preservation in progress) |
| CFS NORMAL | CBM-DOS | PRG/SEQ/USR based on the type suffix bytes |
| CFS DIR | CBM-DOS | DIR (becomes sub-partition on D81, linked subdir on DNP) |
| CFS LNK | any | Skipped with a warning (no LNK on CBM-DOS) |
| GEOS VLIR | CBM-DOS / CFS | Skipped with a warning (writer not built yet — round-trip via CVT) |

LNK and GEOS VLIR are captured into the clipboard but skipped on paste. You get a summary modal at the end listing what was skipped and why.

## Directory-level copy / paste

Select a **DIR** entry (sub-directory / sub-partition) → **File → Copy**. The whole tree — files + nested sub-directories — gets captured.

Paste into:

- **Same family** (e.g., DNP → DNP) — full tree round-trip
- **Different family** — files translate per the table above; sub-directories become whatever the target format supports

### Cross-family pasting limits

- **D64 / D71** can't host sub-directories, so the tree gets **flattened** — every file ends up at the destination's root. Sub-directories are reported in the summary as "not copied (this format doesn't support nested subdirs)".
- **D81** supports sub-partitions only at the root, not nested. A nested sub-tree gets the same flattening.
- **DNP / CFS** support arbitrarily nested subdirs; the tree copies whole.

## Pre-check: space + conflicts

Before any write, the paste handler runs two checks:

### 1. Free space

It sums the data sectors the paste needs and compares against the destination's free-block count.

If short, it offers:

- For D81 sub-partitions with adjacent free root tracks: **Cancel / Grow** prompt with the exact shortfall in blocks and proposed grow size
- For other destinations: a "need N more blocks" message and the paste aborts

### 2. Name conflicts

It scans every immediate file + sub-dir in the tree against the destination dir. If any name matches, the Cancel / Rename / Overwrite prompt shown above appears. Up to 8 conflicting names are listed in the prompt; "and X more" overflow handles larger sets.

## Pasting flat file lists

If your clipboard has individual files (not a tree), the paste loop handles them one at a time — each file gets its own write, with the same conflict / size checks.

## Drag-paste

For files only (not whole directories), you can drag a row out of one tab onto another tab's body to copy. Multi-select drag works too.

## Undo

Paste is undoable via Ctrl+Z. The undo restores the full pre-paste state of the destination disk in one step.

## Directory-art (closed DEL) entries

Closed-DEL dir entries — the ones used to draw graphics into the directory listing — are first-class clipboard content. Select them like any other file and Ctrl+C / Ctrl+V.

What's preserved:

- The 16-byte name (PETSCII bytes verbatim, including reversed-bit glyphs)
- The closed bit and the lock bit (so a `< ` -suffixed entry stays `< ` on paste)
- The block-count field — verbatim. Some productions deliberately set this to the year, a version number, or anything that reads nicely in a `LOAD"$",8` listing; we keep your value, not a chain-derived one

Cross-family: CBM-DOS art-DEL pastes into an IDE64 .hdd partition as a CFS separator (the equivalent feature inside `cbm-format-ide64.js`), and CFS separators paste into CBM-DOS disks as closed-DEL entries.

### The rare "DEL with a real chain" case

A few demo loaders stash actual loadable bytes behind a DEL-typed dir entry. The copy step detects this when:

- block count > 0
- T/S is in range, not the dir track, not 0/0
- The chain walks cleanly (visited-set + length cap)
- Walked length is within ±2 of the source's block count
- The chain doesn't overlap any live file's sectors

If all of those pass, you get a one-shot prompt — **Yes / No / Yes to all / No to all** — asking whether to bring the payload along. Bare entry every other time. We never blindly follow a track/sector that might point into the directory, into another file's chain, or just garbage.

Pasting into CFS drops the payload (CFS has no DEL-with-payload convention) and logs the skip. The bare separator still gets written.

Conflict prompts skip DEL entries — dir art duplicates name bytes by design.

## Limitations

- **GEOS VLIR write** isn't implemented yet — VLIR files (geoWrite docs, fonts) round-trip via CVT (export to .cvt, import to other disk).
- **REL record length** isn't preserved through cross-family pastes (CFS doesn't have a per-file record-length field). Treat REL files as opaque for now.
- **Reversed-byte filenames** round-trip correctly. The `$00-$1F` bytes survive the paste.
