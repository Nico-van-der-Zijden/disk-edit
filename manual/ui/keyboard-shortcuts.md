# Keyboard shortcuts

Grouped by what you'd be doing when you'd reach for the shortcut. The handlers check the **Ctrl** key only — on macOS that means the Control key, not Cmd.

Shortcuts are ignored while you're typing in a text field, so Ctrl+A / Ctrl+C / Ctrl+V keep their normal text-editing meaning there. **AltGr** combinations (which browsers report as Ctrl+Alt) type characters and never trigger a Ctrl+Alt shortcut.

## Disk

| Shortcut | Action |
|---|---|
| **Ctrl+Alt+O** | Open file (same routing as drag-and-drop) |
| **Ctrl+Alt+S** | Save current disk (Save As if it has no file name yet) |
| **Ctrl+Shift+S** | Save As |
| **Ctrl+Alt+N** | New disk (opens the Disk → New submenu) |
| **Ctrl+Alt+W** | Close current tab |
| **Ctrl+Alt+V** | Validate disk |
| **Ctrl+Shift+B** | View BAM |

## Edit

| Shortcut | Action |
|---|---|
| **Ctrl+Z** | Undo |
| **Ctrl+Y** / **Ctrl+Shift+Z** | Redo |
| **Ctrl+C** | Copy selected file(s) |
| **Ctrl+V** | Paste clipboard contents |
| **Ctrl+A** | Select all entries (or all partitions on a partition list) |
| **Delete** | Remove Entry — works on a multi-selection and asks first about 1581 partitions that still contain files. On a partition list: delete the selected partition(s), with confirmation |
| **Enter** / **F2** | Rename the selected entry (or partition) |
| **Escape** | Cancel an active rename / close a dialog, the context menu or the side pane |
| **Ctrl+Shift+I** | Insert File (empty directory entry) |
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
| **Double-click T/S column** | Edit start track / sector |
| **Double-click partition / sub-directory row** | Open it |

## Entry-specific actions

| Shortcut | Action |
|---|---|
| **Ctrl+Shift+L** | Name to lowercase |
| **Ctrl+Shift+U** | Name to UPPERCASE |
| **Ctrl+Shift+T** | Toggle name case |
| **Ctrl+Alt+L** / **R** / **C** / **J** | Align Left / Right / Center / Justify |
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

geoWrite / VLIR Layout / REL Records / Turbo Assembler don't have dedicated shortcuts — open them via **File → View As**.

Viewers open in the docked side pane, not a modal. While the pane is open the arrow keys keep driving the directory list; scroll the pane with the mouse or touchpad. **Escape** closes the pane.

Inside a modal dialog:

| Shortcut | Action |
|---|---|
| **↑ / ↓ / Page Up / Page Down** | Scroll the dialog body (instead of moving the selection) |
| **Home / End** | Jump to top / bottom |
| **Escape** | Close the dialog |
| **Enter** | Trigger the dialog's primary button (bright one) |

## Sector editor

| Shortcut | Action |
|---|---|
| **Click a hex byte** | Start editing that byte; type two hex digits |
| **Tab / Shift+Tab** | Next / previous byte |
| **← / →** | Previous / next byte (before you've typed a digit) |
| **Escape** | Cancel the byte edit only — press again to close the editor |
| **Ctrl+J** | Follow the chain link (T/S in bytes 0-1) |

## PETSCII charset toggle

| Shortcut | Action |
|---|---|
| **Ctrl+Shift** (alone, no other key) | Switch upper ↔ lowercase charset (matches the C64's C= + Shift) |

This is the only "CBM-like" shortcut in the app — every other Ctrl combo is a normal app action.

## Editing inside the filename rename editor

When you start an inline rename (double-click, Enter or F2 on selection):

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
| **Drop `.prg` / `.seq` / etc. onto the page** | Imports into the active disk (several at once: one summary at the end) |
| **Drop an `.lnx`** | Extracts to a new D64 |
| **Drop a ZipCode set (`1!`…`4!`)** | Reassembles it into a new D64 tab |
| **Drop a SixPack set (`1!!`…`6!!`)** | Rebuilds the disk from GCR, keeping read errors |
| **Drop a FilePacked set (`a!`…`x!`)** | Extracts its files onto a new D64 |
| **Drop a `.zip` / `.tar` / `.tgz` / `.lha` / `.lzh`** | Opens the container and picks members |
| **Drop a `.dhd` / `.rml` / `.d1m` / `.d2m` / `.d4m`** | Opens as partition list |
| **Drag a file out of the editor** | Saves to your OS (Chrome / Edge) |
| **Drag a row within the directory** | Reorders |

## Mobile / touch

| Action | Effect |
|---|---|
| **Tap row** | Select |
| **Double-tap row** | Same as desktop double-click |
| **Long-press row** | Open context menu |
