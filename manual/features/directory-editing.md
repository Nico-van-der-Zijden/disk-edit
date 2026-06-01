# Directory editing

Operations on the directory listing itself — rows, ordering, separators.

## Sort

**Disk → Sort Directory ▸** offers four orderings, ascending or descending each:

| Sort | Effect |
|---|---|
| **Name** | Alphabetical by filename (byte-by-byte, so uppercase letters sort differently from shifted letters) |
| **Type** | DEL / SEQ / PRG / USR / REL / CBM order |
| **Blocks** | Smallest / largest first |
| **Track-Sector** | Physical layout order on disk |

Sort writes the dir chain in the new order. Free sectors are unaffected — only the dir entries shuffle.

## Insert / Remove

### Insert (blank entry)

**Edit → Insert** adds a blank dir entry at the current cursor position. Subsequent entries shift down. The new entry has no filename, no data sectors — useful for visual spacing or as a placeholder before adding a file.

### Remove

**Edit → Remove** deletes the directory entry **without** scratching the file. The data sectors stay (potentially orphaned); the row vanishes.

This is different from **Scratch** which returns the data sectors to the BAM. Use Remove when you want to fix a directory layout without losing the underlying file data.

## Move up / down

Reorder a row:

- **Drag** the row to its new position
- **Ctrl+↑** / **Ctrl+↓** to move the selected row one step
- **Edit → Move Up / Down**

Multi-select supports batch moves: select several rows, drag them as a group.

## Separators

Separators are dir entries with type DEL and a recognisable pattern in the filename. They're used to visually segment a directory into sections (e.g., `--- DEMOS ---`, `=== UTILITIES ===`).

The editor has a **separator library** — pre-defined separator patterns you can drop into any disk. Show the palette via **Disk → Show Separators…** (draggable floating window).

To insert: select a row, click a separator in the palette → it's inserted above the row.

To save a custom separator: select an existing DEL-type separator row in your disk → **File → Separator ▸ → Save Current as New**.

To edit your library: **File → Separator ▸ → Edit List…**.

The library is stored in localStorage and survives across sessions.

## Align

See [File operations → Align name](file-operations.md#align-name).

## Add Directory

Format-dependent:

| Format | What happens |
|---|---|
| **DNP, IDE64 CFS** | Real linked sub-directory; you can navigate into it |
| **D81** | CBM sub-partition (file type `$05`). You're prompted for size in sectors (min 120, multiples of 40) |
| **DHD / RAMLink / FD container** | Same as DNP at the inner-partition level |
| **D64 / D71 / D80 / D82** | Not supported — these formats are flat-directory only |

After adding, **double-click** the dir entry to navigate into the new sub-directory.

## Directory chain auto-extend

When you import or paste a file and the current dir is full (every dir sector exhausted), the editor automatically extends the chain by allocating a new dir sector and linking it from the last existing one.

This works on all formats with chained directories (CBM-DOS, CFS). You won't see a "No empty directory slot available" error on a disk that has free sectors.

## Edit block count

Double-click the **blocks** column on a dir entry. A number-input appears; type the new value, press Enter to commit.

The block-count field is 16-bit (up to 65,535), but the editor caps it at 65,024 — VICE's directory listing truncates higher values. The field can hold more bytes, but they won't display.

This is mostly cosmetic — most users never edit block counts. It's used by some PC tools that store a "real size in bytes" in the block-count field.

## Edit file type

Double-click the **type** column on a dir entry. A dropdown appears; pick DEL / SEQ / PRG / USR / REL / CBM (or the CFS equivalent on `.hdd`).

For DEL entries the column shows nothing; for splat entries the column shows `*` prefix; for locked entries the suffix `<`.
