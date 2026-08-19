# Keyboard shortcuts

Grouped by what you'd be doing when you'd reach for the shortcut. **Ctrl** here means Cmd on macOS unless noted.

## Disk

| Shortcut | Action |
|---|---|
| **Ctrl+Alt+O** | Open file (disk picker) |
| **Ctrl+Alt+S** | Save current disk |
| **Ctrl+Alt+N** | New disk (opens Disk → New submenu) |
| **Ctrl+Alt+W** | Close current tab |
| **Ctrl+Shift+S** | Save As |
| **Ctrl+Alt+V** | Validate disk |
| **Ctrl+Shift+B** | View BAM |

## Edit

| Shortcut | Action |
|---|---|
| **Ctrl+Z** | Undo |
| **Ctrl+Y** / **Ctrl+Shift+Z** | Redo |
| **Ctrl+C** | Copy selected file(s) |
| **Ctrl+V** | Paste clipboard contents |
| **Ctrl+A** | Select all entries |
| **Delete** | Scratch selected file(s) |
| **Enter** / **F2** | Start renaming the selected entry |
| **Escape** | Cancel an active rename / close a modal |
| **Ctrl+Shift+I** | Insert file |
| **Ctrl+Alt+E** | Export selected file(s) — on a CMD container partition list, exports the selected partition |
| **Ctrl+Shift+D** | Add directory inside a dir view; new partition on a partition list view |
| **Ctrl+Shift+H** | Edit disk name |
| **Ctrl+Alt+I** | Edit disk ID |

## Search

| Shortcut | Action |
|---|---|
| **Ctrl+F** | Find in current tab |
| **Ctrl+Shift+F** | Find in all open tabs |
| **Ctrl+Shift+G** | Go to track / sector |

## Selection / navigation

| Shortcut | Action |
|---|---|
| **↑ / ↓** | Move selection up / down |
| **Shift+↑ / Shift+↓** | Extend selection |
| **Ctrl+↑ / Ctrl+↓** | Move selected entry up / down within the directory |
| **Click** | Select |
| **Ctrl+Click** | Toggle selection (multi-select) |
| **Shift+Click** | Select range |
| **Double-click filename** | Inline rename |
| **Double-click block-count column** | Edit block count |
| **Double-click type column** | Type dropdown |

## Entry-specific actions

| Shortcut | Action |
|---|---|
| **Ctrl+Shift+L** | Name to lowercase |
| **Ctrl+Shift+U** | Name to UPPERCASE |
| **Ctrl+Shift+T** | Toggle name case |
| **Ctrl+Alt+L** / **R** / **C** / **J** | Align Left / Right / Centre / Justify |
| **Ctrl+<** | Lock / unlock toggle |
| **Ctrl+\*** | Splat / unsplat toggle |

## Viewers

| Shortcut | Action |
|---|---|
| **Ctrl+Alt+H** | View as Hex |
| **Ctrl+Alt+D** | View as Disassembly |
| **Ctrl+Alt+P** | View as PETSCII |
| **Ctrl+Alt+B** | View as BASIC |
| **Ctrl+Alt+G** | View as Graphics |

GEOS / VLIR / REL / TASS viewers don't have dedicated shortcuts — open them via **File → View As**.

Inside a viewer modal:

| Shortcut | Action |
|---|---|
| **Arrow / Page keys** | Scroll the viewer body (instead of moving the selection) |
| **Home / End** | Jump to top / bottom |
| **Escape** | Close the modal |
| **Enter** | Trigger the modal's primary button (bright one) |

## PETSCII charset toggle

| Shortcut | Action |
|---|---|
| **Ctrl+Shift** (alone, no other key) | Switch upper ↔ lowercase charset (matches the C64's C= + Shift) |

This is the only "CBM-like" shortcut in the app — every other Ctrl combo is a normal app action.

## Editing inside the filename rename editor

When you start an inline rename (double-click or Enter on selection):

| Shortcut | Action |
|---|---|
| **A-Z, 0-9, punctuation** | Insert that character (auto-converted to PETSCII) |
| **Shift+letter** | Insert the *shifted* PETSCII byte (`$C1-$DA`) — graphic chars in uppercase mode |
| **←, →, Home, End** | Move the cursor |
| **Backspace / Delete** | Delete previous / next character |
| **Enter** | Commit |
| **Escape** | Cancel |

## Drag-and-drop

| Action | Effect |
|---|---|
| **Drop a disk file onto the page** | Opens as a new tab |
| **Drop a `.prg` etc. onto the page** | Imports into the active disk |
| **Drop an `.lnx`** | Extracts to a new D64 |
| **Drop a ZipCode set (`1!`…`4!`)** | Reassembles it into a new D64 tab |
| **Drop a SixPack set (`1!!`…`6!!`)** | Rebuilds the disk from GCR, keeping read errors |
| **Drop a FilePacked set (`a!`…`x!`)** | Extracts its files onto a new D64 |
| **Drop a `.tar` / `.tgz` / `.lha` / `.lzh`** | Opens the container and picks members |
| **Drop a `.dhd` / `.rml`** | Opens as partition list |
| **Drag a file out of the editor** | Saves to your OS |
| **Drag a row within the directory** | Reorders |

## Mobile / touch

| Action | Effect |
|---|---|
| **Tap row** | Select |
| **Double-tap row** | Same as desktop double-click |
| **Long-press row** | Open context menu |
