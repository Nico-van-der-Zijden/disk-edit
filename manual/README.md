# CBM Disk Editor — User Manual

The CBM Disk Editor (live at <https://d64.sannic.nl>) is a browser-based editor for Commodore 8-bit disk images. This manual is the comprehensive reference: every supported format, every feature, every menu and dialog.

> **Manual source** lives in `manual/` of the [project repository](https://github.com/Nico-van-der-Zijden/disk-edit). The in-app **Help → User Manual** link sends you here.

## How to use this manual

- New to the editor? Start with [Getting started](getting-started.md).
- Looking up a specific disk format? See the [Formats](#formats) section.
- Looking up what a menu item / dialog does? See the [UI reference](#ui-reference).
- Cross-cutting features (copy/paste, validate, viewers, etc.) are in the [Features](#features) section.

## Getting started

- [Getting started](getting-started.md) — open / save / first edits, browser support, where your data lives

## Formats

The editor reads every Commodore disk format in widespread use. Most are full read/write with byte-equal round-trip; a few (tape, NIB, archive containers) are read-only or one-way.

### Floppy disk images

- [D64](formats/d64.md) — 1541 (5.25", 35 / 40 / 42 tracks)
- [D71](formats/d71.md) — 1571 (5.25" double-sided, 70 / 80 tracks)
- [D81](formats/d81.md) — 1581 (3.5", 80 tracks, 40 sectors/track) with CBM sub-partitions
- [D80 / D82](formats/d80-d82.md) — 8050 / 8250 (IEEE-488 drives)
- [G64](formats/g64.md) — GCR-encoded 1541, round-trips copy-protected sectors
- [NIB / NBZ](formats/nib-nbz.md) — raw nibble dumps from nibtools
- [X64](formats/x64.md) — extended D64 with a 64-byte VICE header

### CMD partition containers

- [DNP](formats/dnp.md) — CMD Native Partition (variable size, sub-directories)
- [D1M / D2M / D4M](formats/d1m-d2m-d4m.md) — CMD FD-2000 / FD-4000 floppies
- [DHD](formats/dhd.md) — CMD HD container (Native / 1541 / 1571 / 1581 partitions)
- [RML / RL (RAMLink)](formats/ramlink.md) — CMD RAMLink container

### IDE64

- [IDE64 .hdd / CFS 0.11](formats/ide64-hdd.md) — IDE64 hard-disk image with the CFS filesystem; B-tree files up to 4 GiB, LNK symlinks, sub-directories

### Tape

- [T64](formats/t64.md) — tape archive container (read-only)
- [TAP](formats/tap.md) — raw tape pulse data with built-in turbo-loader scanners (read-only)

### Single-file containers

- [CVT](formats/cvt.md) — GEOS ConVerT (one GEOS file with its INFO block + records)
- [LNX](formats/lnx.md) — Lynx archive (extracts to a new D64)
- [ZipCode](formats/zipcode.md) — DiskPacked (`1!`–`5!`), SixPack (`1!!`–`6!!`, keeps read errors) and FilePacked (`a!`–`x!`), including sets split across disks

### Host archives

Dropped `.zip`, `.gz`, `.tar` / `.tgz` / `.tar.gz`, `.lha` / `.lzh` and `.nbz` files are unpacked automatically and their contents classified by the same rules — see [File operations](features/file-operations.md).

## Features

- [File operations](features/file-operations.md) — import, export, rename, scratch / unscratch, lock, splat, change type
- [Directory editing](features/directory-editing.md) — sort, insert, remove, align, name case, separators, move up/down
- [Copy / paste across formats](features/copy-paste.md) — file-level and directory-level, including cross-family conversion
- [BAM, heat map, validate](features/bam-and-validation.md) — block allocation viewer, integrity check, lost-file recovery
- [Viewers](features/viewers.md) — Hex, BASIC, PETSCII, TASS, Graphics, GEOS, REL, VLIR
- [GEOS support](features/geos.md) — INFO blocks, VLIR records, geoWrite preview, font preview, CVT round-trip
- [PETSCII editing](features/petscii-editing.md) — lossless byte editing, picker keyboard, charset chart, reversed-byte handling
- [Search](features/search.md) — find filenames or byte patterns across one tab or all open tabs
- [Compare disks](features/compare.md) — file-level + sector-level diff between two disks
- [Export](features/export.md) — export disk as zip + listing, export individual files, base64 data URI
- [Tabs and recent files](features/tabs-and-recent.md) — multi-disk editing, tab management, recent disks list
- [Run in emulator](features/run-in-emulator.md) — hand the current disk / selected PRG to c64.sannic.nl

## UI reference

- [Menus](ui/menus.md) — every Disk / File / Edit / Search / View / Options / Help item
- [Keyboard shortcuts](ui/keyboard-shortcuts.md) — every shortcut, grouped by context
- [Toolbar](ui/toolbar.md) — single-click access to common actions
- [Modals and dialogs](ui/dialogs.md) — reference for every dialog the editor shows
- [PETSCII picker](ui/petscii-picker.md) — keyboard layout, Default + Graphical chart tabs, modifier buttons
- [Options menu reference](ui/options.md) — every persisted setting (charset mode, partition size unit, hex coloring, etc.)

## Tips and gotchas

- [Tips & gotchas](tips-and-gotchas.md) — common pitfalls, format quirks, debugging tricks

## About

- The editor runs entirely in your browser — no files are uploaded anywhere
- All data lives in your browser tab; close the tab and unsaved changes are gone
- "Save" downloads a file to your computer; there is no auto-save
- Tested in Chrome, Firefox, Edge, Safari on Windows, macOS, Linux, ChromeOS
