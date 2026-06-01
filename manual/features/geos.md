# GEOS support

GEOS is the C64's graphical OS. GEOS files have extra metadata beyond CBM-DOS's standard dir entry — an INFO block, a "structure" type (sequential vs VLIR), and a GEOS-specific file type (Application / Font / Desk Accessory / etc.).

The editor recognises GEOS disks and renders the extra info inline.

## GEOS detection

The editor uses a 5-step heuristic from GEOS.TXT rev 1.4 (lines 280-303), with one deliberate deviation:

1. **Lower 3 bits of dir +$02** (file type): accept DEL/SEQ/PRG/USR. Reject REL+.
2. **Structure byte (+$17)** must be `$00` (sequential) or `$01` (VLIR). Anything else = not GEOS.
3. **Filetype byte (+$18)** non-zero = INFO block likely exists.
4. **Info T/S** (+$15/+$16) must be valid for the disk's track range.
5. **USR fallback** — real geoMagazine disks use USR-typed entries for VLIR data files. The editor accepts those, contrary to the spec.

A disk is "GEOS-formatted" if its border-sector pointer (header `+$AB/$AC`) is non-zero. The BAM viewer banner flags this.

## GEOS file types

Per GEOS.TXT, the file type byte (`+$18` of the dir entry) encodes:

| Value | Type |
|---|---|
| `$01` | Application |
| `$02` | Desk Accessory |
| `$03` | Photo Album |
| `$04` | Font |
| `$05` | Printer Driver |
| `$06` | Input Driver |
| `$07` | Disk Device |
| `$08` | System Boot |
| `$0E` | geoWrite Document |
| `$0F` | geoPaint Document |
| `$13` | geoFile Database |
| `$15` | Image |
| `$1A` | Album |
| ... | (full list in GEOS.TXT) |

The dir-listing's type column shows the GEOS type instead of the standard PRG/SEQ for GEOS files.

## INFO block

Every GEOS file has a 256-byte INFO block at the location stored in dir-entry bytes `+$15/+$16` (track / sector). The block contains:

- **Icon** at +`$05-$BC` — 24×21 hires bitmap (63 bytes for the 504-bit grid)
- **Description** at +`$BE-$FD` — up to 96 chars of text
- **Class** at +`$60-$77` — 24 chars (e.g., `geoWrite    V2.1`)
- **Author** at +`$78-$7B` — 4 chars
- **Permanent name** — fixed for some file types
- **Creation date** — year / month / day / hour / minute
- **Author 2** at +`$8D-$AC` — optional, longer author field (rev 1.4 addition)
- **Created-by app** at +`$AD-$DC` — optional, the app that wrote the file (rev 1.4 addition)

**File → View As ▸ GEOS** renders all of this. The icon shows as a 24×21 pixel image; the description and class strings are decoded from PETSCII.

## VLIR files

Variable-Length Indexed Record. Used by geoWrite (records = pages), geoPaint, photo albums, etc.

A VLIR file has:

- Standard dir entry pointing at an **index sector** (T/S at +`$03/$04`)
- INFO block at the location in +`$15/$16`
- Index sector: 254 bytes of (T/S, sector count) pairs — one per record. Up to 127 records.
- Per record: a sector chain holding that record's data

**File → View As ▸ VLIR** opens the record index. Empty records (`T=0, S=0`) show as "—empty—".

## CVT round-trip

[CVT (GEOS ConVerT)](../formats/cvt.md) is the standard way to move a GEOS file between disks. Right-click → **Export as CVT** produces a CVT with INFO + records. Drag-drop or **File → Import File** brings a CVT back in.

The 16-byte filename in bytes `$03-$12` of the CVT is the GEOS file's original name. The OS file name on the `.cvt` container is ignored on import.

## Border sector

GEOS uses one sector on the disk (referenced from header +`$AB/$AC`) as a "border" — a staging area for cross-disk drag-and-drop. Shows up as a file entry in the directory but is system-managed.

**Disk → Disk Tools → View GEOS Border Sector** opens the border sector contents. Most disks won't have anything interesting there.

## geoWrite preview

geoWrite documents (file type `$0E`) get a paper-style preview when viewed:

- Paper-white background
- Dark ink
- Page breaks, headers, footers
- Multiple fonts when available (Roma is the common case; BSW substitutions are not wired in)

The preview is rendered without the dark theme so it actually looks like geoWrite output.

## Font preview

Font files (type `$04`) show the bitmap glyphs in the GEOS font format. Glyph sizes vary per font.

## Known limitations

- **GEOS files into CFS / .hdd** — copy/paste into a CFS partition is blocked. CFS reserves a GEOS partition type but the on-disk layout isn't documented; we'd rather refuse than silently corrupt. CBM-DOS-to-CBM-DOS VLIR paste does work (single-file and tree). Use CVT export → import to move GEOS files onto an IDE64 .hdd.
- **REL record length on CFS interop** — isn't preserved when pasting REL files between CBM-DOS and CFS. CFS has no per-file record-length field.
- **Font substitutions** — most geoWrite docs use Roma; BSW-only fonts (Berkelium 64, etc.) aren't rendered with their actual glyphs, just substituted.

## CVT plus GEOS in archives

LNX archives that contain CVT-format GEOS files are handled — when you extract the LNX, the editor recognises the CVT signature and writes the GEOS file properly (with INFO + records) instead of as an opaque blob.
