# Toolbar

The optional toolbar sits under the menubar and gives single-click access to the most-used actions. Toggle it on/off with **Options → Show Toolbar** (persisted).

On phones it's hidden by default to save screen height; you can flip it on.

## What's there

Buttons left-to-right:

| Button | Action | Same as |
|---|---|---|
| 📂 Open | File picker for disk images | File → Open |
| 💾 Save | Save current disk | File → Save |
| ✕ Close | Close current tab | File → Close Tab |
| ↶ Undo | Undo last buffer change | Ctrl+Z |
| ➕ Insert | Insert a new dir entry | Edit → Insert |
| 🗐 Copy | Copy selected file(s) | Ctrl+C |
| 📋 Paste | Paste clipboard contents | Ctrl+V |
| 🗺️ View BAM | Block Allocation Map | Disk → View BAM |
| ⫽ Show Separators | Separators palette | Disk → Show Separators |
| 🔍 Find | Find in current tab | Ctrl+F |
| ✓ Validate | Validate disk | Disk → Validate |
| ⇆ Compare | Compare two disks | Disk → Compare With… |

Tooltips on hover identify each button.

## Context-sensitivity

Buttons that don't apply to the current state grey out:

- Save, Close, View BAM — disabled when there's no disk loaded
- Undo — disabled when nothing to undo
- Copy / Paste — disabled when there's no selection / no clipboard
- Insert, Find — disabled on read-only formats (TAP, T64)

## Why a toolbar at all?

The menubar is fine but slow if you do the same 3-4 things repeatedly (Save → Validate → Save). The toolbar collapses those to one click each. If you prefer keyboard, the same actions all have shortcuts (see [Keyboard shortcuts](keyboard-shortcuts.md)).
