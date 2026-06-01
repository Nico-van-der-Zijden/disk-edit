# CVT — GEOS ConVerT

CVT is a single-file representation of one GEOS file, complete with its INFO block and (for VLIR files) every record's data. It's the standard way GEOS files travel between disks without having to also move the whole disk.

## Structure

A CVT begins with a 30-byte "mock directory entry" — including the 16-byte filename at offset `$03-$12`, the file type, and the GEOS metadata bytes — followed by an identifying signature like `PRG formatted GEOS file V1.0` at offset `$1E`.

For a sequential GEOS file: signature → INFO block (256 bytes) → file data.
For a VLIR file: signature → INFO block → 254-byte record index → record data, in order.

The track/sector references inside a CVT are zeroed out — they'd be wrong once re-imported anyway.

## What you can do

- **Open** a CVT — shows the GEOS info block (icon, description, class, author) on its own, no disk attached.
- **Import** a CVT into the currently active disk via **File → Import File** or drag-drop. The editor parses the CVT, writes the GEOS file to the disk (including the INFO block and all VLIR records), and refreshes the directory listing.
- View the file as Hex / Graphics / GEOS / BASIC / TASS like any other file.

## Important: file name comes from inside the CVT

When you import a `.cvt`, the editor reads the GEOS filename from **bytes `$03-$12` of the CVT** — NOT from the OS file name. This is by design: the GEOS file's original name lives inside the container so it round-trips correctly back to a GEOS disk.

If your `.cvt` file is named `8-pretty.8 - kopie met een veel te lange naam.cvt` on disk, the imported directory entry will use whatever name is encoded inside the CVT (e.g. `8/PRETTY.8` if that's what the original GEOS file was called).

## When CVT vs the disk?

Use CVT to move a single GEOS file between disks (e.g., a font, a document, a desk accessory). For copying multiple files at once it's usually easier to copy between disks via cross-family copy/paste.

## Reverse — exporting a GEOS file as CVT

**Right-click a GEOS file → Export as CVT** (or **File → Export ▸ Export as CVT** when the file is GEOS). The editor produces a valid CVT with the original GEOS filename, INFO block, and (for VLIR) all records.

The exported CVT is GEOS-app compatible — drop it into GEOS via your tooling and it reconstructs.

## GEOS bulk: LNX

If you have many GEOS files in one go, [LNX](lnx.md) archives can pack them all into one container. The editor recognises LNX with GEOS files inside and routes the GEOS bits through the CVT path automatically when extracting.
