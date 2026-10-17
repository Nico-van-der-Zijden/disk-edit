# Viewers

Every "View As" option, what it does, and when to use it. Viewers open in the docked side pane next to the directory (Escape closes it), so you can keep the listing in view.

## Hex

**File → View As ▸ Hex** (Ctrl+Alt+H) opens a hex + PETSCII dump, 8 bytes per row:

```
0801  0B 08 0A 00 9E 32 30 36  ......
0809  31 00 00 00 A2 41 8E 8C  1....A..
```

- For PRG files the 2-byte load address is stripped from the dump and used to label the rows instead, so the row addresses match C64 memory. The title shows the load address and the payload size.
- Other file types are labelled from offset `0000`.
- The PETSCII column follows the current charset mode (Ctrl+Shift). Reversed characters render with inverted background.
- **Options → Hex Coloring** adds per-byte colouring (None / hexyl / xcd-rgb / Nybble).

To edit bytes, use the sector editor (**Edit → Edit File Sector**), not this view.

## Disassembly

**File → View As ▸ Disassembly** (Ctrl+Alt+D) disassembles the file from its load address:

```
$080D  A2 41     LDX #$41
$080F  8E 8C 02  STX $028C
$0812  A9 0C     LDA #$0C
```

- Every byte decodes linearly — there's no code / data separation, so a BASIC stub at `$0801` shows up as instructions.
- Undocumented opcodes are decoded with the oxyron.de mnemonics (`SLO`, `LAX`, `DCP`, …) and highlighted; the unstable ones (`XAA`, `AHX`, `TAS`, …) and `KIL` get their own colour.
- If the file starts with a recognisable `SYS` (packer / BASIC stub detection), the title shows the SYS address and the view scrolls to that line.

Up to 5000 lines are shown.

## PETSCII

**File → View As ▸ PETSCII** (Ctrl+Alt+P) prints the file through an emulated CHROUT onto a 40×25 screen: colour codes, cursor movement, HOME, RVS ON/OFF, DEL and the case-switch codes are honoured. Useful for text files and PETSCII art.

The current charset mode (View → Switch to Uppercase / Lowercase, or Ctrl+Shift) picks the glyph set.

## BASIC

**File → View As ▸ BASIC** (Ctrl+Alt+B) detokenizes a BASIC program. The dialect is picked from the load address:

- `$0801` (C64), `$0401` / `$1201` (VIC-20) — **BASIC V2**
- `$1001` — **BASIC V3.5** (C16 / Plus/4)
- `$1C01` — **BASIC V7** (C128)

For V2 programs a **Dialect** bar above the listing switches between **BASIC V2**, **Simons' BASIC** and **Final Cartridge III**. `$1001` is ambiguous (it's also an unexpanded VIC-20), so there the bar offers **V3.5** and **V2 (VIC-20)**.

Control codes inside strings render reversed, the way `LIST` shows them.

## Turbo Assembler

**File → View As ▸ Turbo Assembler** decodes a TASS V5 / V6 source file (tokens, expressions, labels, label references) and renders it the way TASS shows it on a real C64. The viewer was built by diffing against VICE renderings of many V5 / V6 sources.

## Graphics

**File → View As ▸ Graphics** (Ctrl+Alt+G) detects the bitmap format from load address + size and renders the file. A selector above the image lists every format that fits, so you can override the guess. Recognised:

- **Named formats** — Koala Painter, Gun Paint, Zoomatic, Micro Illustrator, Amica Paint, Run Paint, PMC, CDU-Paint, Pixel Perfect, Advanced Art Studio, Saracen Paint, Drazpaint, Vidcom 64, Art Studio, Hires Manager, Blazing Paddles, Face Painter, Doodle, Artist 64, FLI (Blackmail), FLI Graph 2.2, AFLI, Drazlace, ECI
- **Generic layouts by size** — hires (bitmap only / bitmap+screen / screen+bitmap), multicolour (Koala- and AAS-style), FLI, AFLI, interlace, IFLI
- **Sprites** — hires and multicolour
- **Charsets** — 1×1, 1×2, 2×1, 2×2, hires and multicolour
- **Print Shop** graphics
- **GEOS** — geoPaint, Photo Scrap, Photo Album, GEOS fonts, images embedded in geoWrite documents

### Export

Save the rendered image as **PNG**, **JPG**, **GIF** or **SVG** via the Save button in the viewer.

## geoWrite

**File → View As ▸ geoWrite** renders a geoWrite document as formatted text. To get it out of the editor, use **File → Export ▸ Export as RTF / PDF / Text (geoWrite)**.

## VLIR Layout

**File → View As ▸ VLIR Layout** shows the record table of a GEOS VLIR file: one row per used slot with its start T/S, block and byte count, runs of empty slots collapsed. Click a row to expand that record's sector chain.

## REL Records

**File → View As ▸ REL Records** splits a relative file's data into records using the record length from byte `$17` of the dir entry, and lists each record as hex + text. The title shows the record length and record count.

## GEOS File Info

**View → GEOS File Info** (or the GEOS icon on a directory row) shows the GEOS header of the selected file: the INFO-block icon, GEOS type, structure (sequential / VLIR), date, class, author, created-by, load / end / init addresses, description, and where the INFO block sits.

## File info

The info icon on a directory row shows a short summary: type (with scratched / locked flags), blocks, size in bytes, start T/S, load range, plus BASIC / graphics / packer / SYS hints when detected.
