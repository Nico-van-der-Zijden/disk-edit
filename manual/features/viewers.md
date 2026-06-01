# Viewers

Every "View as …" option, what it does, and when to use it.

## Hex

**File → View As ▸ Hex** opens a hex + PETSCII dump:

```
Offset   00 01 02 03 04 05 06 07 08 09 0A 0B 0C 0D 0E 0F  ASCII / PETSCII
$0000    A2 41 8E 8C 02 A9 0C 8D F5 02 A9 22 8D F6 02 60  .A.................".......`
$0010    ...
```

- For PRG files, the first 2 bytes show the load address (e.g., `$0801` for BASIC).
- The PETSCII column renders chars in screen-code form via `SCREENCODE_MAP`. Reversed bytes (`$80-$FF`) show with inverted background.
- **Options → Hex Coloring** adds per-byte colouring (None / hexyl / xcd-rgb / Nybble).
- **Search → Go to Sector...** (Ctrl+Shift+G) jumps to a specific position.

Best for inspecting raw bytes — debugging file structure, finding magic numbers, etc.

## Disassembly

**File → View As ▸ Disassembly** runs the PRG through a 6502 disassembler starting at the load address. Each line shows:

```
$0801  0C 08  ...           ; BASIC line ptr
$0803  0A 00  ...           ; line number 10
$0805  9E 32 30 36 31 00 00 ; SYS 2061
$080D  A2 41  LDX #$41
$080F  8E 8C 02  STX $028C
$0812  A9 0C  LDA #$0C
$0814  8D F5 02  STA $02F5
...
```

The decoder handles standard NMOS 6502 opcodes. Illegal opcodes (CMOS / 65C02 / 65816 variants) decode as `???`. Branch targets are computed; absolute addresses are shown raw.

Best for reverse-engineering a PRG. For serious work, export to a real disassembler.

## PETSCII

**File → View As ▸ PETSCII** shows the whole file as PETSCII glyphs in a 40-column screen-style layout. Useful for inspecting text files or PETSCII art.

Reversed bytes render with inverted background. The current charset mode (View → Switch to Uppercase / Lowercase) determines the glyph set.

## BASIC

**File → View As ▸ BASIC** detokenizes a BASIC PRG into readable source. Auto-detects the dialect:

- **V2** — Commodore 64 / VIC-20 (default)
- **V3.5** — Commodore 16 / Plus/4
- **V7** — Commodore 128
- **V10** — Commodore 65 / MEGA65 prototype

Use the dialect dropdown above the listing to switch manually if auto-detect picks wrong.

Tokens are rendered as their PETSCII keywords (e.g., `PRINT`, `INPUT#`). Line numbers + indentation are preserved.

## TASS (Turbo Assembler)

**File → View As ▸ TASS** decodes a Turbo Assembler V5 / V6 source file. The source has its own binary format with tokens, expressions, labels, and label-references.

Output is rendered as an assembler listing matching what TASS shows on a real C64:

- 40 chars wide × 23 rows visible (matches the C64 screen)
- Comments aligned to a fixed column
- Label-defs share lines with their instruction where TASS does

This is the most accurate part of the editor — the viewer was built by diffing against VICE rendering of many V5 / V6 sources.

## Graphics

**File → View As ▸ Graphics** auto-detects the bitmap format and renders the file as an image. Recognises:

- **Hires** (8000 bytes) — standard C64 320×200 bitmap
- **Multicolor** (8000 + 1000 + 1000 bytes) — bitmap + color RAM + screen RAM
- **Koala** — 10003 bytes with the koala 2-byte header
- **Doodle** — 9216 bytes
- **AmicaPaint** — 10018 bytes
- **GunPaint** — multi-part
- **Funpaint II** — multi-part
- **FLI** (Flexible Line Interpretation) — variable layout
- **Sprite sheets** — 64-byte sprites in a grid

The viewer picks the most likely format based on size + content. If you have a file the auto-detect gets wrong, use the format dropdown in the viewer to override.

### Export

Save the rendered image as **PNG**, **JPG**, **GIF**, or **SVG** via the Save dropdown in the viewer footer.

## GEOS

**File → View As ▸ GEOS** opens GEOS-specific viewers for GEOS files. Handles:

### INFO block

Every GEOS file has a 256-byte INFO block. The viewer shows:

- Icon (24×21 hires bitmap) rendered visually
- Description text (up to 96 chars)
- Class / Author / Permanent name string
- Creation date
- For VLIR files: the record index + sizes

### geoWrite documents

geoWrite files (.geoWrite extension, MEGA "type 13") get rendered on a paper-white background with dark ink — looks like a real GEOS printout. Supports text formatting, page breaks, font references.

Font preview shows the font's bitmap glyphs at the right size.

### Other GEOS structures

VLIR record viewer for any VLIR file. Shows record index, lets you click into individual records for hex view.

## REL

**File → View As ▸ REL** decodes a Relative file record-by-record. Shows record length (from byte `$17` of the dir entry), record count, and per-record content.

REL files use a side-sector chain that the standard file walker can follow.

## VLIR

**File → View As ▸ VLIR** shows the record index for a GEOS VLIR file:

```
Record 0:  T 18 S  5   17 sectors
Record 1:  T 18 S 22   12 sectors
Record 2:  -- empty --
Record 3:  T 19 S  3    8 sectors
...
```

Click a record to view its content as Hex.

## File info

**View → GEOS File Info** is a minimal modal showing:

- Filename, file type, block count
- First track/sector
- Total sectors used (walking the chain)
- For GEOS: the INFO block summary
- For REL: record length + record count

Quicker than opening a viewer if you just want size info.
