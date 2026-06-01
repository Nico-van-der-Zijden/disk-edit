# Menus

The editor has **seven** top-level menus, left to right: **Disk | File | Edit | Search | View | Options | Help**.

Items are **context-sensitive** — entries that don't apply to the current state are either hidden or greyed out. The right-click context menu prefers hiding (so the popup stays short); the menubar prefers greying (so the layout is stable).

## Disk

Disk-image level operations.

| Item | Action |
|---|---|
| **New** ▸ | Creates a fresh disk. Sub-menus: 1541 (D64 35/40/42), 1571 (D71 70/80), 1581 (D81), 8050 (D80), 8250 (D82), CMD Native (DNP), CMD FD (D1M/D2M/D4M), CMD RAMLink (1/2/4/8/16 MiB), CMD HD (DHD), IDE64 HDD (4/8/16/32/64/128/256/512 MiB) |
| **Open…** | OS file picker |
| **Recent** ▸ | Last-opened disks (localStorage) |
| **Close** | Closes the active tab (prompts if dirty) |
| **Close All** | Closes every open tab (one prompt per dirty tab) |
| **Save** | Writes the current tab to your Downloads folder with the format's natural extension |
| **Save As...** | Pick a new file name / extension |
| **Show Deleted Files** | Toggle — when on, scratched-but-recoverable entries are listed |
| **Sort** ▸ | Name Ascending / Name Descending / Blocks Ascending / Blocks Descending |
| **Edit Blocks Free** | Manually set the BAM free-block count (CBM-DOS only) |
| **Recalculate Blocks Free** | Re-derive the count from the BAM bitmap |
| **Disk Tools** ▸ | Submenu — see below |
| **Open in Emulator** | Sends the whole disk to <https://c64.sannic.nl> (VICE x64sc via EmulatorJS) |
| **Export Disk** ▸ | Export All Files / Export as Text / CSV / HTML / Directory as PNG / Show MD5 Hash / Show as Base64 Data URI |

### Disk → Disk Tools (submenu)

| Item | Action |
|---|---|
| **Validate** | Rebuilds the BAM from file chains, removes splat (open) files, reports overlap / orphan errors |
| **Compare with...** | Pick a second disk; side-by-side file + sector diff with collapsible sections |
| **G64 Layout...** | (G64) physical sector order per track + Raw Tracks view |
| **Scan for Lost Files** | Recovers files from deleted-but-not-overwritten dir entries (Quick / Deep prompt) |
| **Compact Directory** | Removes empty dir slots so used entries are contiguous |
| **File Chains** | T:S chain map for every file (CBM-DOS only) |
| **Decompress ZipCode** | Reassembles a `1!disk` / `2!disk` / `3!disk` / `4!disk` set into a D64 |
| **Fill Free Sectors** | Writes a fill byte into every unallocated sector |
| **Optimize Disk...** | Packs files toward the start of the disk |
| **Resize Image...** | (DNP) grow / shrink the partition. Disabled inside CMD containers — the slot has a fixed allocation |
| **Convert to GEOS Format** | Adds the GEOS BAM signature so the disk is recognised as GEOS |
| **View GEOS Border Sector...** | Opens the rarely-used GEOS cross-disk drag-and-drop area |
| **Restore DOS Version Byte** | Clears the soft-write-protect byte at BAM `+$02` |
| **Install HD-DOS** | (CMD HD) writes the bootable HD-DOS firmware into a freshly created `.dhd` (requires a donor — see DHD format docs) |
| **Rename Disk Label…** | (.hdd) edits the 16-byte boot-sector label |
| **Restore Partition Table from Backup…** | (.hdd) copies the backup partition table at the last LBA over the primary |

## File

Operations on the selected directory entry, plus import / export of individual files.

| Item | Action |
|---|---|
| **Rename** | Inline rename of the selected entry |
| **Insert File** | OS file picker — imports a `.prg` / `.seq` / `.usr` / `.rel` / `.p00..r00` / `.cvt` / `.txt` etc. into the current disk |
| **Separator** ▸ | Insert ▸ (pick from saved separators) / Save Current as New / Edit List… |
| **Copy** | Copies selected file(s) or directory to the clipboard |
| **Paste** | Pastes clipboard contents into the current dir. Cross-family translation handles type differences |
| **Remove Entry** | Removes the dir entry (without clearing the data sectors) |
| **Move Up / Down** | Swap with neighbour |
| **Add Directory** | (DNP / D81 / IDE64 / DHD / RAMLink) — creates a sub-directory / sub-partition |
| **New Partition** | (CMD / IDE64 partition list views) — adds a partition into free space |
| **Rename Partition** | (CMD / IDE64 partition list views) |
| **Delete Partition** | (CMD / IDE64 partition list views) |
| **Restore Partition** | (CMD / IDE64) unscratch a deleted partition |
| **Partition Attributes…** | (CMD / IDE64) edit type / flags |
| **Import Partition...** | Pull a partition's data in from an external `.dnp` / `.d64` / etc. |
| **Export Partition...** | Writes the selected partition out as a standalone file |
| **Align** ▸ | Align Left / Align Right / Center / Justify / Expand the filename within 16 chars |
| **Lock File** | Toggles the `<` suffix (write-protect in the directory listing) |
| **Splat File** | Toggles the `*` prefix (open file, unsafe) |
| **Scratch File** | Marks file deleted; data sectors are returned to the BAM |
| **Unscratch File** | Restores a previously scratched file (data sectors must still be unused) |
| **Name Case** ▸ | UPPERCASE / lowercase / Toggle Case |
| **Change File Size** | Edit the dir-entry block-count field (does not change the actual chain) |
| **Edit Track/Sector** | Edit the dir-entry start T:S |
| **Set Actual File Size** | Recompute the block count from the chain |
| **File Type** ▸ | DEL / SEQ / PRG / USR / REL / CBM |
| **View As** ▸ | Hex / Disassembly / PETSCII / BASIC / Graphics / geoWrite / VLIR Layout / REL Records / Turbo Assembler |
| **Run in Emulator** | Sends the selected PRG to <https://c64.sannic.nl> |
| **Export** ▸ | Export File / Export as CVT / Export as RTF / Export as PDF / Export as Text (geoWrite) |
| **Import File** | (single-file import; same as **File → Insert File** above) |

## Edit

Buffer-level undo plus raw sector edit.

| Item | Action |
|---|---|
| **Undo** (Ctrl+Z) | Reverts the last buffer-modifying action — 20-step history |
| **Redo** (Ctrl+Y / Ctrl+Shift+Z) | Re-applies an undone action |
| **Edit Current Sector** | Opens the raw sector editor at the current disk position |
| **Edit File Sector** | Opens the raw sector editor at the selected file's first data sector |

## Search

| Item | Action |
|---|---|
| **Find...** (Ctrl+F) | Search inside the current disk — filenames + file content |
| **Find in All Tabs...** (Ctrl+Shift+F) | Same search across every open tab |
| **Go to Sector...** (Ctrl+Shift+G) | Jump the sector editor / view to a specific T:S (or LBA, depending on format) |

Find is disabled in IDE64 `.hdd` context (CFS-aware search is on the to-do list).

## View

Display options and disk visualisations.

| Item | Action |
|---|---|
| **Switch to Uppercase / Lowercase** | Toggles PETSCII charset render mode. Label swaps to reflect the *other* mode. Keyboard shortcut: Ctrl+Shift |
| **Show Addresses** | Toggle — adds byte / track-sector position to the footer while hovering |
| **Show Track/Sector** | Toggle — track / sector columns in the directory view |
| **Show Separators** | Toggle — render saved separators in the directory listing |
| **View BAM** (Ctrl+Shift+B) | Block Allocation Map viewer (heat map + summary + per-track free counts). For `.hdd` opens a tabbed modal with Partitions + heat map. For G64 opens a multi-tab layout viewer including Raw Tracks |
| **View Error Bytes** | (D64 +errors variant) shows the 21-byte / 23-byte error map |
| **GEOS File Info** | Shows the INFO block of a selected GEOS file |

## Options

Persisted in localStorage. Apply across all open tabs.

| Item | Default | Effect |
|---|---|---|
| **Theme** ▸ | Dark | Dark / Light |
| **Hex Coloring** ▸ | None | Per-byte colouring in hex viewers / sector editor / compare. Schemes: None / hexyl / xcd-rgb / Nybble |
| **Show Toolbar** | On (off on phones) | Toolbar under the menubar |
| **Partition Sizes in MiB** | On | Show partition sizes as MiB instead of CBM blocks |
| **Allow Unsafe Characters** | Off | Lets you type bytes in the picker that aren't safe in CBM filenames |
| **Show All Characters by Default** | Off | Opens picker direct to the floating chart instead of the keyboard view |
| **Stick Keyboard to Edit Field** | Off | Picker stays anchored to the editor when scrolling in a modal |
| **Set Interleave** | (per-format default) | File + dir interleave override |
| **Export Settings** | — | Save your preferences to a JSON file you can re-import later |
| **Export Separators** | — | Save just the separators list |
| **Import Settings / Separators** | — | Restore preferences or separator list from JSON |

## Help

| Item | Action |
|---|---|
| **About** | App info, version |
| **Credits & Thanks** | Tool references, format specs, contributors |
| **Keyboard Shortcuts** | Reference table |
| **User Manual** | Opens this manual in a new tab |
| **Changelog** | Per-version notes |
| **Download Standalone Version** | Save a single-HTML build for offline use |

## Right-click context menu

Right-clicking a directory entry opens a context menu with the **actionable** entries for that file type. Entries that don't apply (e.g. *View as GEOS* on a non-GEOS file) are hidden, not greyed out — typically less than half the entries are live for any given file, so the popup stays short.

Right-clicking on background (no entry selected) shows disk-level actions instead.
