# Tabs and recent files

The editor can hold multiple disks open at once as tabs. The list of recently-opened disks is remembered for fast re-opening.

## Tab bar

Tabs sit between the toolbar and the disk header:

```
disk1.d64 ●   disk2.d81   ide.hdd   +
```

- Each tab shows the file name (truncated if long)
- A **●** indicates unsaved changes
- Click a tab to switch
- The `+` button on the right adds a new blank tab (opens the New Disk picker)

## Tab management

- **Close a tab**: click the `✕` on the tab, or **File → Close Tab**, or middle-click
- **Reorder tabs**: drag the tab horizontally to a new position
- **Tab overflow**: if tabs don't fit, scroll arrows appear on either end of the bar; a dropdown list lets you jump to any tab

## Close-with-unsaved-changes confirmation

Closing a tab with the `●` indicator brings up a confirmation prompt:

> disk1.d64 has unsaved changes. Discard and close?
> [Cancel] [Discard and close]

The Cancel option keeps the tab open. There's no "Save and close" — you need to save first via Ctrl+Alt+S, then close.

**Close All Tabs** in the File menu prompts once for the whole batch.

## Recent disks

**File → Recent** lists the last 10 disks you opened. Click one to re-open it (your browser's localStorage holds the disk path + the bytes themselves).

A disk in the Recent list is opened from the cached byte buffer — no file picker, no upload. Useful for jumping back into work from yesterday's session.

The Recent list persists in localStorage. It's per-browser and per-tab — opening the editor in a private window won't see your normal-window history.

### Clearing the Recent list

**File → Recent → Clear list** wipes the cache. Useful if you opened something sensitive you don't want lingering.

## Multi-disk operations

Some operations span tabs:

- **Find in All Tabs** (Ctrl+Shift+F) — searches every open disk
- **Compare With…** — picks a second disk from open tabs or external file
- **Copy / Paste** — copy a file in one tab, switch tab, paste in another

## Memory

Each open disk holds its image + parsed structures in memory. A few hundred KB per D64; a few MB per `.hdd`. Browsers usually cope with 5-10 tabs open before things slow down.

If your browser tab starts feeling sluggish, close tabs you're done with — there's no penalty since Recent will re-open them.

## Tab title vs window title

The browser tab title (in your OS taskbar) shows "CBM Disk Editor — disk1.d64". When you switch tabs inside the editor, the browser title updates to the active disk's filename.
