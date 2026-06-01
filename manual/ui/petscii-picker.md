# PETSCII picker

When you start an inline rename, the PETSCII picker appears so you can insert characters that aren't on your PC keyboard — graphic chars, reversed letters, the £ / ↑ / ← keys, etc.

The picker has two presentations:

## 1. Compact keyboard (default)

Anchored to the editor, laid out like a real C64 keyboard.

```
┌─[ SHIFT ][ CBM ][ RVS ][ ALL ]──────────────────┐
│  ← 1 2 3 4 5 6 7 8 9 0 + - £                    │
│  Q W E R T Y U I O P @ * ↑                      │
│  A S D F G H J K L : ; =                        │
│  Z X C V B N M , . /                            │
│      [    SPACE    ]                            │
└─────────────────────────────────────────────────┘
```

The four buttons at the top are **modifier toggles**:

- **SHIFT** — show the shifted variant of each key (corresponding to PETSCII `$C1-$DA` for letters)
- **CBM** — show the Commodore-key variant (graphics chars)
- **RVS** — toggle reverse video; characters insert as their reversed-byte counterpart (`$00-$1F` for letters)
- **ALL** — switch to the larger floating chart (see below)

Click a key to insert that PETSCII byte at the editor's cursor.

### Disabled / unsafe keys

Some bytes aren't safe in CBM filenames:

- **Disabled** (greyed out) — control codes that would corrupt the filename. The **Options → Allow Unsafe Characters** toggle lets you enable them if you really need them.
- **Unsafe** (red outline) — bytes that work but you probably don't want, e.g. high-ASCII chars that some tools won't decode.

## 2. Floating chart window

Click **ALL** in the compact picker, or enable **Options → Show All Characters by Default**, to open the floating chart window. Draggable, stays open over modals.

The float has two tabs:

### Default tab — 16×16 hex grid

The full PETSCII byte map. Row + column hex labels make it easy to find a specific byte. Click a cell to insert.

### Graphical tab

The C64 screen-code chart, Filename-Builder style:

```
+----+----+----+----+----+----+----+----+----+----+----+----+----+----+----+----+
| @  | A  | B  | C  | D  | E  | F  | G  | H  | I  | J  | K  | L  | M  | N  | O  |  ← row 1 ($00-$0F screen codes)
+----+----+----+----+----+----+----+----+----+----+----+----+----+----+----+----+
| P  | Q  | R  | S  | T  | U  | V  | W  | X  | Y  | Z  | [  | £  | ]  | ↑  | ←  |  ← row 2 ($10-$1F)
+----+----+----+----+----+----+----+----+----+----+----+----+----+----+----+----+
|SPC | !  | "  | #  | $  | %  | &  | '  | (  | )  | *  | +  | ,  | -  | .  | /  |  ← row 3 (punct)
+----+----+----+----+----+----+----+----+----+----+----+----+----+----+----+----+
| 0  | 1  | 2  | 3  | 4  | 5  | 6  | 7  | 8  | 9  | :  | ;  | <  | =  | >  | ?  |  ← row 4 (digits)
+----+----+----+----+----+----+----+----+----+----+----+----+----+----+----+----+
| graphics block A x 2 rows ...                                                  |
+----+----+----+----+----+----+----+----+----+----+----+----+----+----+----+----+
| graphics block B x 2 rows ...                                                  |
+----+----+----+----+----+----+----+----+----+----+----+----+----+----+----+----+
| ... bottom 8 rows are the reversed mirror of the top 8                         |
+----+----+----+----+----+----+----+----+----+----+----+----+----+----+----+----+
```

Bottom 8 rows are the reversed mirror of the top 8 — same characters with inverted colors (achieved via the reversed PETSCII byte where one exists, or visual styling where it doesn't).

The chart follows the current global charset mode — flip via Ctrl+Shift or **View → Switch to Uppercase / Lowercase** and the chart re-renders in the other charset.

### Tab choice persists

Whichever tab you used last is remembered in localStorage. Next session the float opens to the same tab.

## Insertion behavior

When you click a cell:

1. The cell's PETSCII byte is inserted at the editor's cursor (where `_lastCursorPos` is).
2. The cursor advances one byte.
3. If the cell is reversed-mode, the inserted byte is the reversed-byte counterpart (`$00-$1F` for letters), so the filename actually renders reversed on a real C64.

## Sticky-in-modal mode

If you turn on **Options → Stick Keyboard to Edit Field**, the picker stays anchored to the editor even when you scroll the modal. Off by default to avoid covering text.

## Keyboard shortcuts inside the rename editor

The picker is a click-to-insert aid; you can also type:

- **Letters** → the corresponding PETSCII letter (uppercase A-Z = `$41-$5A`)
- **Shift+letter** → shifted variant (`$C1-$DA` — graphic chars in uppercase mode)
- **Digits / punctuation** → that PETSCII byte
- **Ctrl combos** → bypassed, so the browser still handles copy/paste/select-all

Reversed bytes (`$00-$1F`) can only be inserted via the picker — there's no keyboard shortcut for them.
