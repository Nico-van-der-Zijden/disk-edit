# Menus

The editor has six top-level menus. Items are **context-sensitive** — entries that don't apply to the current state are either hidden or greyed out (right-click menus prefer hiding so the popup stays short; the menubar prefers greying so the layout is stable).

## File

Disk-level open / save / export.

| Item | Action |
|---|---|
| **New** ▸ | Creates a fresh disk. Sub-menu lists every supported format with size variants (D64 35/40/42, D71 70/80, D81, D80/D82, DNP, D1M/D2M/D4M, RAMLink 1/2/4/8/16 MiB, CMD HD, IDE64 HDD 4-512 MiB) |
| **Open…** | OS file picker |
| **Recent** ▸ | Last-opened disks (localStorage, max 10) |
| **Save** | Writes the current tab to your Downloads folder with the format's natural extension |
| **Save As** | Pick a new file name / extension |
| **Close Tab** | Closes the active tab (prompts if dirty) |
| **Import File…** | OS file picker for `.prg` / `.seq` / `.usr` / `.rel` / `.p00..r00` / `.cvt` / `.txt` |
| **Import Partition…** | (CMD / IDE64 containers) — pull a partition's data in from an external `.dnp` / `.d64` / etc. |
| **Export Selected** | Writes the selected file(s) to your OS as raw bytes |
| **Export Partition** | (CMD / IDE64 containers, partition list view) — writes the selected partition as a standalone file |
| **Export Disk** ▸ | Disk zipped with a Text / CSV / HTML directory listing; or as a base64 data URI |
| **Separator** ▸ | Insert ▸ (pick from saved separators) / Save Current as New / Edit List… |
| **New Partition…** | (CMD / IDE64 partition list views) — adds a partition into free space |
| **Run in Emulator** | Sends the selected PRG to <https://c64.sannic.nl> (VICE x64sc via EmulatorJS) — no upload, no URL limit |

## Disk

Disk-level operations.

| Item | Action |
|---|---|
| **Validate** | Rebuilds the BAM from file chains, removes splat (open) files, reports overlap / orphan errors |
| **Open in Emulator** | Like Run in Emulator but for the whole disk |
| **Disk Tools** ▸ | Submenu — see below |
| **View BAM** | Block Allocation Map viewer (heat map + summary + per-track free counts). For `.hdd` opens a tabbed modal with Partitions / heat map. For G64 opens a multi-tab layout viewer including Raw Tracks |
| **Show Separators…** | Opens the separators palette (draggable floating window) |
| **Compare With…** | Pick a second disk; side-by-side file + sector diff with collapsible sections |
| **Sort Directory** ▸ | Name Ascending / Descending / Type / Size variants |
| **Add Directory** | (DNP / D81 / IDE64 / DHD / RAMLink) — creates a sub-directory / sub-partition |

### Disk → Disk Tools (submenu)

| Item | Action |
|---|---|
| **Set Interleave** | Per-format file + dir interleave (with JiffyDOS preset for 1541 / 1571) |
| **Resize Image** | (DNP) grow / shrink the partition. Disabled inside CMD containers (the slot has a fixed allocation) |
| **Restore DOS Version Byte** | Clears the soft-WP byte at BAM `+$02` |
| **Restore Backup PT** | (.hdd) copies the backup partition table at the last LBA over the primary at LBA 1 |
| **Rename Disk Label** | (.hdd) edits the 16-byte boot-sector label; container header shows it |
| **View GEOS Border Sector** | Opens the rarely-used GEOS cross-disk drag-and-drop area |
| **Scan for Lost Files** ▸ | Quick / Deep — recovers files from deleted-but-not-overwritten dir entries |
| **G64 Layout…** | (G64) physical sector order per track + Raw Tracks view |
| **Fill Free Sectors / Optimize Disk** | Pack files toward the start of the disk |

## Edit

File / directory operations on the selected entry.

| Item | Action |
|---|---|
| **Undo** (Ctrl+Z) | Reverts the last buffer-modifying action |
| **Redo** (Ctrl+Y) | Re-applies an undone action |
| **Copy** (Ctrl+C) | Copies selected file(s) or directory to the clipboard |
| **Paste** (Ctrl+V) | Pastes clipboard contents into the current dir. Cross-family translation handles type differences |
| **Select All** (Ctrl+A) | Selects every dir entry |
| **Rename** (Enter on selection) | Inline rename |
| **Insert** | New blank file entry |
| **Remove** | Removes the selected dir entry (without clearing the data sectors) |
| **Scratch** (Delete) | Marks file deleted; data sectors are returned to the BAM |
| **Unscratch** | Restores a previously scratched file (data sectors must still be unused) |
| **Lock** ▸ | `<` suffix (write-protect within the directory listing). Submenu: Lock / Unlock |
| **Splat** ▸ | `*` prefix (open file, unsafe). Submenu: Splat / Unsplat |
| **Move Up / Down** | Swap with neighbour (Ctrl+Arrow keyboard shortcut) |
| **Align** ▸ | Left / Right / Center / Justify / Expand the filename within 16 chars |
| **Name Case** ▸ | UPPERCASE / lowercase / Toggle Case |
| **Change Type** ▸ | DEL / SEQ / PRG / USR / REL / CBM |

## View

File viewers and visualizations.

| Item | Action |
|---|---|
| **As Hex** | Hex + PETSCII dump of the selected file |
| **As Disassembly** | 6502 disassembly starting at the file's load address |
| **As PETSCII** | Full file as PETSCII glyphs (screen-style) |
| **As BASIC** | Detokenized BASIC listing (dialect auto-detect: V2, V3.5, V7, V10) |
| **As Graphics** | Auto-detects bitmap format (hires, multicolor, koala, etc.) |
| **As GEOS** | INFO block + (for VLIR) record index; for geoWrite docs shows a paper-style preview |
| **As REL** | Record-by-record decode of REL files |
| **As VLIR** | Record list for GEOS VLIR files |
| **As TASS** | Turbo Assembler V5 / V6 source file viewer |
| **View Link Target** | (CFS LNK entries) shows where the link points and follows on confirm |

## Options

Persisted in localStorage. Apply across all open tabs.

| Item | Default | Effect |
|---|---|---|
| **Switch to Uppercase / Lowercase** | Uppercase | Toggles PETSCII charset render mode (Ctrl+Shift) |
| **Hex Coloring** ▸ | None | Per-byte colouring in hex viewers / sector editor / compare. Schemes: None / hexyl / xcd-rgb / Nybble |
| **Show Toolbar** | On (off on phones) | Toolbar under the menubar |
| **Show Address** | On | Show byte / track-sector position in the footer while hovering |
| **Show all PETSCII characters** | Off | Opens picker direct to the floating chart instead of the keyboard view |
| **Stick PETSCII picker** | Off | Picker stays anchored to the editor when scrolling in a modal |
| **Partition Sizes in MiB** | On | Show partition sizes as MiB instead of CBM blocks |
| **Allow Unsafe Characters** | Off | Lets you type bytes in the picker that aren't safe in CBM filenames |
| **Set Interleave** | (per-format default) | File + dir interleave override |
| **Import Settings / Export Settings** | — | Save your preferences to a JSON file you can re-import later |

## Help

| Item | Action |
|---|---|
| **About** | App info, credits, version |
| **Changelog** | Per-version notes |
| **Keyboard Shortcuts** | Reference table |
| **Credits & Thanks** | Tool references, format specs, contributors |
| **User Manual** | Link to this manual |

## Right-click context menu

Right-clicking a directory entry opens a context menu with the **actionable** entries for that file type. Entries that don't apply (e.g. View as GEOS on a non-GEOS file) are hidden, not greyed out — typically less than half the entries are live for any given file, so the popup stays short.

Right-clicking on background (no entry selected) shows disk-level actions instead.
