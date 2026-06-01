# Options menu reference

Every persisted setting in the editor. Settings are stored in your browser's localStorage and apply across tabs. **File → Export Settings** dumps them to JSON; **File → Import Settings** restores.

## Charset display

### Switch to Uppercase / Lowercase

Toggles which PETSCII charset the directory listing + viewers render in.

- **Uppercase** (C64 default boot mode) — letters appear as `A-Z`; the C= positions show graphic glyphs.
- **Lowercase** — letters appear as `a-z`; the C= positions show uppercase `A-Z`.

Keyboard shortcut: **Ctrl+Shift** (matches the C64's C= + Shift).

The setting also drives a `body[data-charset]` CSS attribute so plain `<input>` name fields (Import dialog, Add Directory, Disk Label) render in the correct case via `text-transform`. Typing `i` in uppercase mode shows `I`; the underlying input value is unchanged.

### Hex Coloring

Per-byte colouring scheme in the hex viewer, sector editor, and side-by-side compare. Cycles through:

- **None** (default) — plain text
- **hexyl** — null / whitespace / printable / control / high categories (mirrors the `hexyl` tool)
- **xcd-rgb** — full 256-hue rainbow (one colour per byte value)
- **Nybble** — colour by the high nibble of the byte

Both hex and PETSCII columns get the scheme's colour. Reversed bytes (`$80-$FF`) keep the scheme hue.

Switching schemes recolours every open hex modal instantly.

## Toolbar / display

### Show Toolbar

The toolbar under the menubar. On by default; off on phones (toggle to enable on mobile).

### Show Address

When you hover a directory entry / cell, show its byte / track-sector position in the footer. Useful for low-level debugging.

### Partition Sizes in MiB

Default **on**. Partition lists in CMD-container / IDE64 views show sizes as `512 MiB` / `1.50 MiB`. Flip off for the old block-count view (`524288 blocks` style) that matches `LOAD"$",8` listings.

## PETSCII picker behaviour

### Show All Characters by Default

When you start a rename, jump straight to the floating chart window instead of the compact keyboard. Off by default (compact keyboard first, ALL button opens the chart).

### Stick PETSCII picker

Picker stays anchored to the editor when you scroll a modal. Off by default — picker can drift when scrolling but doesn't cover text.

### Allow Unsafe Characters

By default the picker disables byte values that would corrupt CBM filenames (control codes, certain high-ASCII). Flip on to enable them. You should know what you're doing.

## File operations

### Set Interleave

Per-format file + dir interleave override. JiffyDOS-style presets available for 1541 / 1571. Most users never touch this; the format-default interleaves work well.

## Settings backup

### Export Settings

Writes a JSON file with every persisted setting (charset mode, hex colouring, toolbar visibility, picker preferences, partition-size unit, etc.).

### Import Settings

Reads a previously-exported JSON file. Useful for syncing your preferences across browsers or devices.
