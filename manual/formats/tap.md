# TAP — raw tape pulse data

TAP is a raw recording of a Commodore Datasette tape — the on-tape pulse durations, in a CCS64-style file format. Unlike T64, it preserves the exact bit-level structure including custom turbo loaders.

## What the editor does

**Read-only.** The editor decodes TAP files using built-in scanners for the standard CBM ROM loader plus several common turbo loaders:

- **CBM ROM** — the stock 300 baud format
- **Turbotape 250** — Markt & Technik's tape turbo
- **Novaload** — Mastertronic / Ocean turbo
- **Cyberload F1-F4 chain** — System 3's multi-stage loader
- **Creatures** custom loader — game-specific protection

Once decoded, the directory listing shows the programs the way they'd appear loading on a real C64. Some entries get a 🔒 icon (encrypted/scrambled loader) or 📚 icon (multi-load).

## What you can do

- List the files
- View files as Hex / Disassembly / PETSCII / BASIC / Graphics / TASS (where the decode succeeded)
- Export individual programs as `.prg`
- Extract everything to a new D64

## What you can't do

- Write TAP. The format is intricate at the pulse-timing level and the editor isn't a tape mastering tool. Use the original mastering tools (tapclean / Fast Tape Tools) for that.

## Reference material

The TAP scanners were written using **FT Console 2.76** source code and the **tapclean** project as references. Both are GPL — patterns/specs used, no C code copied. Find them under `disks/FT Console 2.76 src/` and `disks/tapclean/` if you're curious about how loader detection works.
