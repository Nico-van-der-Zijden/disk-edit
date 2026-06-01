# NIB / NBZ — raw nibble dumps

NIB and NBZ are output formats from **nibtools** — a low-level utility that reads a 1541 floppy at the bit level. They're used for archiving copy-protected disks where even G64's representation isn't precise enough.

## File format

- **NIB**: raw nibble stream + per-track densities. Larger than G64 but contains every bit nibtools could recover.
- **NBZ**: LZ77-compressed NIB.

## What the editor does

The editor **reads** NIB and NBZ files by:

1. Decompressing NBZ → NIB (transparent).
2. Converting the NIB to G64 in memory using nibtools' standard alignment logic.
3. From there, treating it like a normal G64 — directory listing, file viewing, validate, etc.

**Saving** produces a real `.g64`. The editor doesn't write NIB or NBZ — they're considered an archival input format only. If you opened a `.nib` and want to keep editing it, **Disk → Save As...** writes a `.g64` and the filename gets the new extension.

## When to use NIB / NBZ

Mostly when you've archived a disk with nibtools yourself and want a quick way to verify it loaded right. For long-term editing or sharing, save to `.g64` and work from there.

## Known limitations

- Conversion from NIB to G64 isn't lossless for every disk — some custom alignments fall outside nibtools' standard model. Don't use the editor as your primary nibtools tool; use it to verify and convert to a more portable G64.
- Once converted to G64, the same caveats apply as the [G64](g64.md) page: half-tracks and per-byte speed offsets are approximated.
