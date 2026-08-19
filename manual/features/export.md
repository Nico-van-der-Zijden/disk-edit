# Export

Three ways to get data out of the editor: whole disk, individual files, embedded in a URL.

## Export disk as ZIP + listing

**Disk → Export Disk → As ZIP** writes a `.zip` archive with:

- The disk image itself (`.d64` / `.d81` / etc.) — your edited version
- A directory listing in one or more formats:

| Listing | What it looks like |
|---|---|
| **Text** | Plain text mimicking `LOAD"$",8` — block counts + names + types |
| **CSV** | Spreadsheet-friendly with header row |
| **HTML** | Standalone browsable web page with file table |

The HTML listing has clickable file links — clicking one downloads that file as a separate `.prg`. Useful for sharing a disk image with a non-technical recipient who just wants to grab the BASIC source.

## Export single files

**File → Export ▸ Export File** writes the selected dir entries out as raw bytes. Per file:

- Filename + format-appropriate extension
- File type → extension: PRG → `.prg`, SEQ → `.seq`, USR → `.usr`, REL → `.rel`
- GEOS files → `.cvt` (CVT container with INFO block + records)
- **ZipCode parts** (`1!NAME`, `1!!NAME`, `a!NAME`, `x!NAME`) → **no extension**, keeping the exact name from the disk. They're recognised by name, so an exported `1!!NAME.prg` would be treated as a file to import when dropped back in rather than reassembled. Applies to drag-out and bulk ZIP export too.

You can also **drag** a row out of the editor onto your OS — same result.

For multi-select, each file is downloaded individually (your browser typically asks to confirm multiple downloads).

## Export disk as base64 data URI

**Disk → Export Disk → Show as Base64 Data URI** opens a modal with:

```
data:application/octet-stream;base64,UEsDBAo...
```

Click **Copy** to put it on your clipboard. The URI is the whole disk encoded in base64.

Use case: embedding small disks (typically under ~500 KB) in forum posts, GitHub issues, chat messages. The recipient can paste the URI into their address bar to download the disk.

Large disks produce big URIs; browsers cap URLs at a few MB so this isn't useful for `.hdd` images. For those, share the file directly.

## Export a partition (CMD / IDE64 containers)

**File → Export Partition** writes the selected partition as a standalone file:

- Native partition → `.dnp`
- 1541 partition → `.d64`
- 1571 → `.d71`
- 1581 → `.d81`
- CFS partition → can't export as a file today (it's part of the `.hdd`)

The reverse is **File → Import Partition** which pulls a standalone file into a free partition slot.

## Export viewer content

Each viewer can export what it shows:

- **Hex viewer** — copy bytes to clipboard via the menu
- **Graphics viewer** — Save dropdown: PNG / JPG / GIF / SVG
- **BASIC viewer** — copy detokenized source as text
- **TASS viewer** — copy formatted listing as text
- **GEOS / geoWrite viewer** — print to PDF via the browser's print dialog (the paper-white styling is print-friendly)

## What's NOT a built-in export

- **PETSCII art** — there's no "render directory entry as image" feature. You can use the Graphics viewer if the file IS a bitmap.
- **Disk as IPF / G64 from D64** — the editor reads G64 + IPF (read-only) but only writes G64 from G64 inputs. There's no "format-convert this D64 to G64" path because the operation isn't well-defined (no protection to preserve).
- **Disk thumbnail** — no per-disk preview image.
