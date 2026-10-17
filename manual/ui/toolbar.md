# Toolbar

The optional toolbar sits under the menubar and gives single-click access to the most-used actions. Toggle it on/off with **Options → Show Toolbar** (persisted).

On narrow screens (720px and below) it's always hidden — the mobile hamburger menu covers the same actions.

## What's there

Buttons left-to-right:

| Button | Action | Same as |
|---|---|---|
| 📂 Open | File picker | Disk → Open (Ctrl+Alt+O) |
| 💾 Save | Save current disk | Disk → Save (Ctrl+Alt+S) |
| ✕ Close | Close current tab | Disk → Close (Ctrl+Alt+W) |
| ↶ Undo | Undo last buffer change | Ctrl+Z |
| ➕ Insert File | Insert an empty directory entry (no data written) | File → Insert File (Ctrl+Shift+I) |
| 🗐 Copy | Copy selected file(s) | Ctrl+C |
| 📋 Paste | Paste clipboard contents | Ctrl+V |
| 🗺️ View BAM | Block Allocation Map | View → View BAM (Ctrl+Shift+B) |
| ⫽ Show Separators | Floating separators palette | View → Show Separators |
| 🔍 Find | Find in current tab | Ctrl+F |
| ✓ Validate | Validate disk | Disk → Disk Tools → Validate (Ctrl+Alt+V) |
| ⇆ Compare | Compare two disks | Disk → Disk Tools → Compare with... |

Tooltips on hover identify each button (including the keyboard shortcut where one exists).

## Context-sensitivity

Each button mirrors the enabled state of the menu item it fires, so a button is greyed out exactly when its menu item is. For example:

- Save, Close, View BAM — disabled when there's no disk loaded
- Undo — disabled when there's nothing to undo
- Copy / Paste — disabled when there's no selection / nothing on the clipboard
- Insert File — disabled on tape images, on partition lists, with a multi-selection, or when the directory is full
- Find — disabled on CMD partition lists and in IDE64 `.hdd` images

## Why a toolbar at all?

The menubar is fine but slow if you do the same 3-4 things repeatedly (Save → Validate → Save). The toolbar collapses those to one click each. If you prefer keyboard, most of the same actions have shortcuts (see [Keyboard shortcuts](keyboard-shortcuts.md)).
