# Export

Ways to get data out of the editor: the disk image itself, its files, its directory listing, or a data URI.

## Save the disk image

**Disk → Save** / **Save As...** download the image itself (see [Getting started](../getting-started.md#saving)).

## Export all files as ZIP

**Disk → Export Disk ▸ Export All Files** writes every closed SEQ / PRG / USR / REL file of the current directory into one `.zip`, named after the disk. GEOS VLIR files are skipped — export those one by one with **Export as CVT**. ZipCode parts keep their exact name (see below). Inside an IDE64 `.hdd` partition it zips the current CFS directory's files.

## Export the directory listing

| Item | Output |
|---|---|
| **Export as Text** | Plain text mimicking `LOAD"$",8` |
| **Export as CSV** | Spreadsheet-friendly, with a header row |
| **Export as HTML** | Standalone web page with the listing |
| **Export Directory as PNG** | Image of the listing |

## Export single files

**File → Export ▸ Export File** (Ctrl+Alt+E) writes the selected dir entries out as raw bytes. Per file:

- Filename + extension from the file type: PRG → `.prg`, SEQ → `.seq`, USR → `.usr`, REL → `.rel`
- GEOS VLIR files are skipped — use **File → Export ▸ Export as CVT** (CVT container with INFO block + records)
- **ZipCode parts** (`1!NAME`, `1!!NAME`, `a!NAME`, `x!NAME`) → **no extension**, keeping the exact name from the disk. They're recognised by name, so an exported `1!!NAME.prg` would be treated as a file to import when dropped back in rather than reassembled. Applies to drag-out and Export All Files too.

You can also **drag** a row out of the editor onto your OS (Chrome / Edge) — same result.

With a multi-selection each file is downloaded individually (your browser typically asks to confirm multiple downloads).

## Export disk as base64 data URI

**Disk → Export Disk ▸ Show as Base64 Data URI** opens a dialog with the whole image as

```
data:application/octet-stream;base64,...
```

and a **Copy to clipboard** button. A G64 tab exports the GCR image, not the decoded D64.

Use case: embedding small disks in forum posts, GitHub issues, chat messages. Large disks produce big URIs, so this isn't useful for `.hdd` images — share the file directly.

## Disk hash

**Disk → Export Disk ▸ Show Disk Hash** shows the file name, size, **CRC32** and **SHA-256** of the image.

## Export a partition (CMD containers)

**File → Export Partition...** (or Ctrl+Alt+E on the partition list) writes the selected partition as a standalone file:

- Native partition → `.dnp`
- 1541 partition → `.d64`
- 1571 → `.d71`
- 1581 → `.d81`

The reverse is **File → Import Partition...**, which pulls a `.dnp` / `.d64` / `.d71` / `.d81` into a partition. IDE64 `.hdd` partitions can't be exported as separate files.

## Export viewer content

- **Graphics viewer** — Save button: PNG / JPG / GIF / SVG
- **geoWrite documents** — **File → Export ▸ Export as RTF / Export as PDF / Export as Text (geoWrite)**

## What's NOT a built-in export

- **D64 → G64 conversion** — the editor only writes G64 for tabs that were opened from G64 / NIB / NBZ; a D64 tab always saves as `.d64`.
- **Writing LNX, tar or LHA** — read-only. ZIP is written by Export All Files; ZipCode sets by **Disk → Disk Tools → Create ZipCode…**.
