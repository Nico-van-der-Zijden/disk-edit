# Run in emulator

The editor pairs with **<https://c64.sannic.nl>** — an in-browser VICE x64sc instance via EmulatorJS — to run your disks without leaving the browser.

## Run a single PRG

Select a PRG file → **File → Run in Emulator**. The PRG is sent to c64.sannic.nl over `postMessage`. The emulator loads it on the simulated C64 and `RUN`s it.

The PRG transfers as bytes, not as a URL — no upload, no URL-length limit. You can run multi-megabyte PRGs this way.

## Run the whole disk

**Disk → Open in Emulator** sends the current disk image to c64.sannic.nl. The emulator mounts it as a disk drive; you can `LOAD"$",8` to see the directory and `LOAD"filename",8` to run a specific file.

This is the right option for disks where the entry point isn't a single PRG (e.g., a multi-loader game or a disk with multiple BASIC programs you might want to pick from).

## What c64.sannic.nl does

It's a standard VICE x64sc compiled to WASM via EmulatorJS, hosted by the same author. The disk-editor → emulator handoff is a `postMessage` from one origin to another (no shared origin needed) carrying the disk bytes + a metadata blob (filename, file-type, run/load directive).

Source for the emulator wrapper is at <https://github.com/Nico-van-der-Zijden/c64-sannic-nl> if you're curious.

## Limitations

- **No save-back** — the emulator doesn't write changes back to the editor. If you edit a file inside the emulator (e.g., via a `geoWrite`-equivalent), those changes don't make it back to the disk image in the editor.
- **G64-specific features** — copy protection that depends on raw GCR works in VICE x64sc (since we send the actual G64). But if the protection requires specific disk-drive hardware quirks (real 1541, parallel cable), the emulator may not handle it.
- **CMD HD / RAMLink / IDE64** — VICE supports these via the relevant cartridge emulation. The c64.sannic.nl wrapper currently uses x64sc which means it's set up for 1541 emulation primarily. If you want to test a `.hdd`, you'll need a local VICE with IDE64 cart configuration.

## Hand-off timing

The emulator opens in a new browser tab; first time it takes a moment to download the VICE WASM (~5-10 MB). Subsequent runs are instant from the browser cache.

## Alternative: download and run locally

If you prefer a local emulator (VICE, Hoxs64, CCS64, etc.), use **Disk → Save** to write the disk to your OS, then mount it in your emulator. The editor's output is byte-identical to what other tools produce, so any emulator that handles the format will accept the saved file.
