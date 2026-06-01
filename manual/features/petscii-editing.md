# PETSCII editing

PETSCII (PET Standard Code of Information Interchange) is the C64's character set — a superset of ASCII with extra graphic chars, reversed chars, and the famous C= / Shift key combinations.

CBM filenames are stored as raw PETSCII bytes. The editor renders them with the C64 Pro Mono font so they look like they would on a real C64.

## How the editor renders PETSCII

PETSCII has 256 byte values. The editor maps each to a Unicode Private Use Area (PUA) codepoint:

- **Uppercase mode**: PUA `$E000-$E0FF`
- **Lowercase mode**: PUA `$E100-$E1FF`

The C64 Pro Mono font has glyphs at those PUA positions. Switch modes via Ctrl+Shift or **Options → Switch to Uppercase / Lowercase**.

### Reversed bytes

PETSCII `$00-$1F` and `$80-$9F` are "reversed" — they render as the letter/glyph at +`$40` / -`$80` but with inverted background. The editor handles this throughout:

- Directory listing — reversed chars in filenames show with inverted bg
- Hex viewer PETSCII column — same
- Inline rename editor — same

You can insert reversed chars via the picker's **RVS** modifier button, or directly through bytes `$00-$1F` in the chart.

## The rename editor

Double-click a filename or press Enter to start renaming. The plain text gets replaced with a **PETSCII editor** — a contenteditable region that tracks a shadow byte buffer alongside what the browser shows.

### Lossless round-trip

The shadow buffer holds the actual PETSCII bytes. Reversed bytes (`$00-$1F`, `$80-$9F`) survive editing intact — they don't get collapsed to their normal-letter equivalents the way a naive `<input>` would.

### Cursor handling

The editor renders consecutive same-reversed-status bytes as merged runs (text nodes for normal bytes, `.pe-rev` spans for reversed runs). This keeps the cursor walking the text naturally with arrow keys.

A separate fake-caret element (positioned via `getBoundingClientRect`) draws the visible cursor — Chromium refuses to draw the native caret in this exact DOM/CSS combination, so we render our own. You see a blinking accent-coloured bar that moves with the cursor.

### Keyboard shortcuts inside the editor

| Key | Effect |
|---|---|
| Letters A-Z | Insert as PETSCII `$41-$5A` |
| Shift+letter | Insert as PETSCII `$C1-$DA` (shifted variant — graphic chars in uppercase mode) |
| Digits / punctuation | Insert that byte |
| ← / → / Home / End | Move cursor |
| Backspace / Delete | Delete previous / next char |
| Enter | Commit |
| Escape | Cancel |
| Ctrl combos | Bypassed (browser handles copy/paste/select-all) |

### Charset toggle preserves the edit

Pressing Ctrl+Shift while editing a name switches the charset without losing your edit. The editor snapshots the state, lets the directory rebuild, then re-enters edit on the new row with the same typed bytes and caret position.

## The PETSCII picker

When you start a rename, the picker appears (compact keyboard layout by default). Click any cell to insert that PETSCII byte at the cursor.

See [PETSCII picker](../ui/petscii-picker.md) for the full picker reference.

## Plain text inputs

Modals with plain `<input>` fields (Import dialog, Add Directory, Disk Label) follow the charset mode visually via CSS `text-transform` — type `i` in uppercase mode and the field displays `I`. The underlying value is whatever you typed; `asciiToNameBytes` uppercases on commit. So:

- What you SEE in the field matches what the C64 will render
- What gets stored is the PETSCII letter byte (`$49` either way)

## Charset detection caveats

- File names are stored as PETSCII; the editor doesn't try to detect "actually-ASCII" filenames. If your disk was created with mixed-case (e.g., a PC tool wrote `Filename.PRG`), the bytes are PETSCII `$46 $69 $6C ...` which in uppercase mode renders as `F` + lowercase-graphic + lowercase-graphic — garbled.
- **Edit → Name Case → UPPERCASE** fixes this by converting `$61-$7A` (lowercase ASCII) bytes to `$41-$5A` (PETSCII A-Z).

## PETSCII vs screen codes

The two are not the same:

- **PETSCII** is the byte stored on disk / sent over the serial port / received via INPUT$
- **Screen code** is the byte stored in screen RAM (`$0400-$07E7` on C64)

Mapping per PETSCII.TXT:

- PETSCII `$00-$1F` → screen code `$80-$9F` (reversed letters)
- PETSCII `$20-$3F` → screen code `$20-$3F` (identity)
- PETSCII `$40-$5F` → screen code `$00-$1F` (letters / brackets)
- PETSCII `$60-$7F` → screen code `$40-$5F` (graphics block A)
- PETSCII `$80-$9F` → screen code `$80-$9F` (also reversed letters)
- PETSCII `$A0-$BF` → screen code `$60-$7F` (graphics block B)
- PETSCII `$C0-$FF` → screen code `$40-$7F` (alt letters / graphics)

The hex viewer's PETSCII column actually shows **screen codes** via `SCREENCODE_MAP` — matches a real C64 hex monitor's behaviour where each byte is rendered as the glyph at that screen position.
