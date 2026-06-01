# LNX — Lynx archive

LNX is a Commodore archive format — a single file holding multiple C64 files. The archive starts with a textual header listing each file's name, type, and length; the file bodies follow concatenated.

The editor reads LNX archives by **extracting all files into a fresh D64**. There's no writer (LNX is rarely produced today).

## What you can do

- **Open** a `.lnx` — the editor extracts all entries into a fresh in-memory D64 and opens it as a tab. The original `.lnx` is not modified.
- From the resulting D64 you can do everything: edit, save (as `.d64`), copy/paste to other disks.
- If the LNX contains GEOS files in CVT-wrapped form, the editor recognises them and writes proper GEOS dir entries (with INFO block + VLIR records) instead of opaque blobs.

## Limitations

- **No writer.** If you want to produce a `.lnx`, use a Commodore-era tool (Lynx Archive Utility, etc.) on the resulting D64.
- Some LNX variants — especially Ultra-LNX with sub-archiving — are not fully tested. If you have one that doesn't extract right, send a sample.

## Saving

The extracted D64 saves as `.d64`. There is no "save the original LNX" path because we modified nothing.

## Older "Ark" / "SRK" formats

The `.ark` and `.srk` archive formats (predecessors to LNX) are not currently supported. They follow a similar concept but with different layouts; if you need them, extract with VICE first.
