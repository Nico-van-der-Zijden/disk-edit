# Tips and gotchas

Non-obvious things you'll want to know.

## Charset mode matters for what you SEE, not what you SAVE

The editor stores PETSCII bytes raw. The charset mode (Options → Uppercase / Lowercase, Ctrl+Shift) only changes how those bytes render on your screen.

- Switching modes doesn't modify the disk
- Saving and re-opening uses whatever mode is active at open-time
- A filename that looks like garbage in one mode might look fine in the other
- **File → Name Case** is the tool to actually change bytes (uppercase / lowercase / toggle each letter)

## PETSCII vs ASCII confusion

The C64's PETSCII isn't quite ASCII:

- Bytes `$41-$5A` (= ASCII `A-Z`) are **uppercase A-Z** in uppercase mode, **lowercase a-z** in lowercase mode
- Bytes `$C1-$DA` are the **shifted variants** — graphics in uppercase mode, uppercase A-Z in lowercase mode
- Bytes `$61-$7A` (= ASCII `a-z`) don't exist as letters in PETSCII; they overlap with graphic chars

If you import a file whose PC filename has lowercase letters, the editor uppercases them (`asciiToNameBytes` converts `$61-$7A` to `$41-$5A`) so the result looks right in uppercase mode. If you want lowercase, use **File → Name Case → lowercase** after importing.

## Block-count cap = 65,024

The dir-entry block-count field is 16-bit (up to 65,535). The editor caps at 65,024 because VICE's directory listing truncates higher values. You can still store more in the field, but it won't display in `LOAD"$",8`.

## $00 vs $A0 padding

CBM-DOS uses `$A0` (shifted space) to pad short filenames. CFS uses `$00` (NULL) in some places, `$A0` in others. The editor treats both as "end-of-name" when reading and uses the format-appropriate padding when writing.

If you see a name like `SUBDIR@@@@@@@@@@` somewhere, that's `$00`-padded bytes rendered as `@` (PETSCII `$00`'s glyph). Cosmetic issue only.

## D81 sub-partition "size" is total, not free

The Add Directory prompt for a D81 sub-partition asks for **total partition size in sectors** — the on-disk size that ends up in the dir entry's size field. Minimum 120 sectors (3 tracks); must be a multiple of 40.

So entering 120 gives you a 120-sector partition. Of those, 4 sectors are reserved (header + 2 BAM + first dir), leaving 116 usable for data.

## Paste-into-full-dir grow

If you paste files into a D81 sub-partition that doesn't have enough free space, the editor offers to **grow** the partition into adjacent free root tracks. Cancel/Grow prompt shows the exact shortfall.

If no adjacent tracks are free, the prompt tells you that and skips the Grow option.

## CFS filenames can contain "/"

`/` is a valid PETSCII byte (`$2F`) and shows up in some GEOS filenames. But CFS treats `/` as a path separator (`cfsResolvePath` splits on it). The editor strips `/` from imported file names in CFS context (replaced with space) to avoid confusing the path resolver.

## Resize Image vs container partitions

**Disk → Disk Tools → Resize Image** only works on standalone DNP files. It's *disabled* inside a CMD container (DHD / RAMLink / FD-2000/4000) because the container slot has a fixed allocation.

To grow a partition inside a container, work from the container's partition list view: delete the partition, recreate it at the new size, restore your files.

## Validate doesn't repair everything

Validate fixes:

- Splat files (open files get scratched)
- BAM bitmap mismatches (rebuilt from file chains)
- Free-count drift

It does NOT fix:

- Cross-linked sectors (two files claiming the same sector) — reported as errors, both files left as-is
- Broken file chains (mid-chain corruption) — reported, file partially readable
- Truly corrupted directory structure — abandon ship, restore from backup

For real recovery work, use **Disk → Disk Tools → Scan for Lost Files** which goes beyond Validate.

## Scratch + write = data lost

Scratching a file marks the dir entry deleted and returns the data sectors to the BAM. If you immediately write a new file, those same sectors get reused — and the scratched file is lost.

The recoverability indicator (heart-pulse / broken-heart / skull icons) tells you if Unscratch will still work.

## Multi-disk operations + memory

The editor holds every open disk in memory. 5-10 tabs is fine; 30+ may slow your browser down. Use **Disk → Close** to free memory (Recent will re-open the disk).

## Backup before bulk edits

There's no auto-save and no "save to a different file automatically" option. Before doing a destructive bulk op (sort, validate, scratch many), do a quick **Disk → Save As...** with a "-backup" suffix.

## TAP / T64 are read-only

Tape images can be read but not written. The format is intricate at the pulse-timing level and writing tape images isn't supported.

If you need to modify tape content, extract to D64 first, edit there, then use a dedicated tape-mastering tool (tapclean / Fast Tape Tools) for the round-trip.

## NIB / NBZ convert to G64 on save

Opening a `.nib` or `.nbz` shows the disk normally; saving writes a `.g64` (a real GCR-encoded G64 that VICE will mount). The editor doesn't write NIB / NBZ — they're an archival input format.

## .lnx has no writer

LNX archives are read by extracting all files into a fresh D64. There's no LNX *write* path. To produce a `.lnx`, edit the resulting D64 then use a Commodore-era LNX tool.

## Right-click hides irrelevant entries

Right-click context menu hides entries that don't apply to the current selection — typically less than half the menubar's entries are live for any given file. This is by design (popup stays short). Use the menubar / keyboard shortcuts for action you know exists but don't see in the popup.

## Ctrl+Shift toggles charset

The only "CBM-like" Ctrl combo is **Ctrl+Shift** (alone, no other key) — switches uppercase/lowercase charset. Every other Ctrl combo is a normal app shortcut (Ctrl+C / V / Z etc.).

Tab as the CBM-key shortcut (matching VICE) was considered + rejected — would break browser focus navigation. The picker's CBM modifier covers it.

## Editor settings persist per-browser

All your settings (charset mode, hex coloring, toolbar visibility, picker preferences, recent files, separator library) live in browser localStorage. They don't sync between browsers or devices.

**File → Export Settings** writes a JSON; **File → Import Settings** restores. Use this to sync your setup across machines.

## Privacy

Everything happens client-side. No data leaves your browser. Closing the tab loses unsaved changes (saving downloads to your OS).

The exception: **File → Run in Emulator** sends the disk/PRG to c64.sannic.nl via postMessage. Same author, same browser, but it's still a separate origin — declined by some strict CORS configurations.
