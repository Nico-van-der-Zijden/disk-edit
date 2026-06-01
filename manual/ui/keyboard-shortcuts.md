# Keyboard shortcuts

Grouped by what you'd be doing when you'd reach for the shortcut. **Ctrl** here means Cmd on macOS unless noted.

## File / disk

| Shortcut | Action |
|---|---|
| **Ctrl+Alt+O** | Open file (disk picker) |
| **Ctrl+Alt+S** | Save current disk |
| **Ctrl+Alt+N** | New disk (picker for format) |
| **Ctrl+Alt+W** | Close current tab |
| **Ctrl+Shift+S** | Save All open tabs |

## Edit (on the active disk)

| Shortcut | Action |
|---|---|
| **Ctrl+Z** | Undo |
| **Ctrl+Y** / **Ctrl+Shift+Z** | Redo |
| **Ctrl+C** | Copy selected file(s) |
| **Ctrl+V** | Paste clipboard contents |
| **Ctrl+A** | Select all entries |
| **Ctrl+F** | Find in current tab |
| **Ctrl+Shift+F** | Find in all open tabs |
| **Ctrl+Shift+G** | Go to track / sector |
| **Delete** | Scratch selected file(s) |
| **Enter** | Start renaming the selected entry |
| **Escape** | Cancel an active rename / close a modal |
| **F2** | Start renaming (alternative to Enter) |

## Selection / navigation

| Shortcut | Action |
|---|---|
| **↑ / ↓** | Move selection up / down |
| **Ctrl+↑ / Ctrl+↓** | Move selected entry up / down within the directory |
| **Shift+↑ / Shift+↓** | Extend selection |
| **Click** | Select |
| **Ctrl+Click** | Toggle selection (multi-select) |
| **Shift+Click** | Select range |
| **Double-click filename** | Inline rename |
| **Double-click block-count column** | Edit block count |
| **Double-click type column** | Type dropdown |

## Entry-specific actions

| Shortcut | Action |
|---|---|
| **Ctrl+Shift+L** | Lock toggle (`<` suffix) |
| **Ctrl+Shift+U** | Unlock toggle |
| **Ctrl+Shift+T** | Type change dropdown |
| **Ctrl+Alt+L** / **R** / **C** / **J** / **E** | Align Left / Right / Centre / Justify / Expand |
| **Ctrl+<** | Lock toggle (alt binding) |
| **Ctrl+\*** | Splat toggle |

## Viewers

| Shortcut | Action |
|---|---|
| **Ctrl+Alt+H** | View as Hex |
| **Ctrl+Alt+D** | View as Disassembly |
| **Ctrl+Alt+P** | View as PETSCII |
| **Ctrl+Alt+B** | View as BASIC |
| **Ctrl+Alt+G** | View as Graphics |
| **Ctrl+Alt+V** | View as VLIR (GEOS) |
| **Ctrl+Alt+T** | View as TASS source |

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

## Disk Map / BAM

| Shortcut | Action |
|---|---|
| **Ctrl+Shift+B** | Open View BAM |
| **Ctrl+Shift+D** | Open Compare With… |

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
| **Drop a `.dhd` / `.rml`** | Opens as partition list |
| **Drag a file out of the editor** | Saves to your OS |
| **Drag a row within the directory** | Reorders |

## Mobile / touch

| Action | Effect |
|---|---|
| **Tap row** | Select |
| **Double-tap row** | Same as desktop double-click |
| **Long-press row** | Open context menu |
