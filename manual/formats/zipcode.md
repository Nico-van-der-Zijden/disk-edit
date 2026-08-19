# ZipCode

ZipCode is the family name for three unrelated C64 archive formats that share a naming convention: the part number lives in the *filename*, not in an extension. That is why the editor matches them by name — `1!GAME` has no extension to route on.

Specs live in `disks/FORMATS/`: `ZIP_DISK.TXT`, `ZIP_SIX.TXT`, `ZIP_FILE.TXT`.

| Variant | Names | What it holds | Result |
|---|---|---|---|
| **DiskPacked** | `1!NAME` … `4!NAME`, plus `5!NAME` | compressed sector copy of a whole disk | plain D64, 35 or 40 tracks |
| **SixPack** | `1!!NAME` … `6!!NAME` (two `!`) | raw GCR, per sector | D64, `+Errors` when the original had bad sectors |
| **FilePacked** | `a!NAME` … `w!NAME` plus `x!NAME` | individual files, not a disk | files written onto a fresh D64 |

## DiskPacked (the common one)

Four files for a 35-track disk, five for 40. Each sector is stored, fill-compressed, or RLE-compressed. There is no provision for error bytes, so the output is always a plain D64 — 174,848 or 196,608 bytes.

The track, not the sector, rides in the top byte of each entry, and sectors are stored in the packer's read interleave rather than in order.

## SixPack

Six files, and nothing like DiskPacked: no compression, and no track/sector references in the data stream. It stores raw GCR — the encoding a 1541 writes to the disk surface — which is why it can carry disks DiskPacked cannot represent.

Because of that it preserves read errors. Sectors that were unreadable on the original come back as CBM error codes (21 no sync, 20/27 header problems, 22/23 data problems, 29 ID mismatch), and a set carrying any of them opens as a **`+Errors` image** (175,531 or 197,376 bytes) rather than a plain D64.

It sits between D64 and G64: GCR-encoded, but still sector-structured, so it cannot represent the arbitrary track layouts that G64 can. For a disk using an unusual low-level encoding (Vorpal, Warp25) the GCR is preserved in the SixPack file but will not decode into standard sectors.

A 40-track SixPack does not fit on one 1541 disk, so sets are routinely **split across two disks** — see below.

## FilePacked

Letters instead of digits, plus an `x!` file holding the directory. It packs individual files rather than a disk image, so there is no original disk to recover: the editor extracts the files onto a fresh D64, the same way it handles a LYNX archive.

The `x!` directory records names, types and sizes, but its sector counts are advisory — real sets disagree with them. File boundaries come from markers in the data stream instead.

## Opening a set

Three routes, all of which end in a new tab:

- **From a disk** — open a disk that holds the parts, then **Disk → Disk Tools → Decompress ZipCode**. If a disk holds more than one set you get a multi-select.
- **Drop the loose parts** — drop the files onto the page. Parts are grouped by base name, and several sets dropped together each open in their own tab.
- **Drop an archive** — a `.zip`, `.tar`, `.lha` etc. containing a set works too. A set counts as a single unit in the archive picker, and an archive holding nothing but one set opens with no dialog at all.

An incomplete set is reported rather than ignored, naming which parts were found.

## Sets split across disks

**Decompress ZipCode looks across every open disk tab**, not just the active one. Open both halves of a split set — for example parts 1-3 on one disk and 4-6 on another — and the menu item assembles them. The confirmation names the disks it drew from.

Only one half open means the set is still reported as incomplete, which is correct.

## Exporting parts

Parts export with **no extension appended**, keeping the exact name from the disk. This is deliberate: they're recognised by name, so `1!!NAME.prg` would be treated as a file to import when dropped back in. Exported parts drop straight back in and reassemble.

Parts that arrive from elsewhere carrying a `.prg` suffix are still recognised, provided they form a complete set.

## Limits

- No **writing** — the editor reads all three variants but cannot create a set.
- SixPack is validated against the spec and against real sets, but a disk using a non-standard low-level encoding (Vorpal, Warp25) decodes to error codes rather than data, as noted above.
- FilePacked type support is limited to what the format allows: `P`, `S` and `U` only, with no REL and no lock/splat bits.

## See also

- [LNX](lnx.md) — the other C64 archive that extracts to a new D64
- [File operations](../features/file-operations.md) — the full drop-and-import rules
- [G64](g64.md) — when you need the raw track bitstream rather than sectors
