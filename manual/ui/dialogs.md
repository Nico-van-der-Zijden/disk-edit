# Modals and dialogs

Every dialog the editor shows, grouped by purpose. Each is a modal — interaction is blocked behind it until you confirm or cancel.

## Standard buttons

All modals follow the same convention:

- **Cancel** (muted style) on the left
- **Primary action** (bright style) on the right
- **Enter** triggers the primary action
- **Escape** cancels
- **✕ in the top-right corner** also cancels
- **Click on the backdrop** (outside the modal) cancels (where safe)

## Info modal

```
┌─ Title ────────────────── ✕ ┐
│                              │
│ One or more lines of body    │
│ text. Optionally a bulleted  │
│ list for validate output etc.│
│                              │
├──────────────────────────────┤
│                         [OK] │
└──────────────────────────────┘
```

Plain notification — nothing destructive, just informs.

## Choice modal

Cancel / Rename / Overwrite (or any custom set). Used by the paste conflict prompt, the Restore Backup PT preview, etc. Multiple buttons in the footer; the primary one is rightmost.

## Input modal

Small dialog with one text field + optional description. Used by:

- Add Directory name
- Disk Label rename
- Import "file name too long" prompt
- Inline-rename fallback when the inline editor can't fit

The OK button is disabled while the input is empty or (when `maxLen` is set) longer than the limit. Long descriptions wrap; the modal width is capped so it doesn't stretch wider than ~480 px.

## Confirm modal

Cancel / OK with a multi-line message. Used by:

- "Disk modified — save before close?"
- Delete-partition confirmation
- "Restore from backup" preview

## Progress modal

```
┌─ Pasting files ────────── ✕ ┐
│                              │
│ 7 / 23: ROBOCOP.PRG          │
│ [██████████░░░░░░░░░░░░░░]   │
│                              │
└──────────────────────────────┘
```

Shows progress for long operations (bulk paste, sort, large export). No buttons — closes automatically when the task finishes.

## Viewer modal

Most file viewers (Hex, BASIC, PETSCII, TASS, Graphics, GEOS) open in a viewer modal:

```
┌─ View as Hex: filename ── ✕ ┐
│ ┌──────────────────────────┐ │
│ │ 00: A2 41 8E ...         │ │
│ │ 10: ...                  │ │ ← scrollable body
│ │ ...                      │ │
│ └──────────────────────────┘ │
├──────────────────────────────┤
│ Color: [None ▾] [Save GFX]   │
└──────────────────────────────┘
```

- The body scrolls with **Arrow keys**, **PageUp/Down**, **Home/End**.
- Toggling charset (Ctrl+Shift) re-renders the body in the new case mode while keeping scroll position.
- Footer holds viewer-specific controls (colour picker, save / export buttons).

## Tabbed modal

Some viewers have multiple tabs in one modal:

- **View BAM** on `.hdd` — Partitions / per-partition heat map
- **G64 Layout** — Layout / Raw Tracks
- **Graphics viewer** — multiple format variants (hires, multicolor, koala, etc.)

Tabs are along the top of the modal body. Click to switch.

## Floating windows

Not strictly modals — these stay open *over* the editor and let you keep interacting with the page:

- **PETSCII picker** — appears when you start an inline rename. Compact keyboard layout, or full chart via the ALL button (which opens the larger float window with Default + Graphical tabs)
- **Separators palette** — draggable palette listing your saved separators; click while a dir row is selected to insert

## Modal sizes

The editor has five size classes — `sm` (460 px), `md` (560 px), `lg` (720 px), `xl` (900 px + 80vh tall), `xxl` (1100 px + 80vh tall). Most viewers use `lg` or `xl`. Anything else (a typo like `'large'`) silently falls back to width:auto, so always pick one of the five.

## Top-anchored layout

Modals don't centre vertically — they anchor near the top of the viewport (10vh padding). This way, expanding content (longer dir listing, taller hex dump) grows downward instead of pushing the modal off-screen on small viewports. Max height is 85vh; bodies scroll within the modal.
