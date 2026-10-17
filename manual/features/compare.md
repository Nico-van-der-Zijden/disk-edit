# Compare disks

**Disk → Disk Tools → Compare with...** diffs the current disk against a second disk. Useful for spotting differences between two versions, two backups, or for verifying that a copy round-tripped correctly.

Compare works on CBM-DOS disk images (D64 / D71 / D81 / D80 / D82 / DNP, including G64 / NIB opened as D64). It's disabled for tape images, partition lists and IDE64 `.hdd` images.

## How it works

1. Pick the second disk — another open tab of a comparable format, or a file from disk.
2. The editor reads both directories and every file's data.
3. Files are paired **by name and occurrence**: the second `----` separator on A meets the second `----` on B, so directories with duplicate names (dir art, separators) line up instead of all matching the first one.

## Files tab

Results are organised into four sections:

- **Differ** — same name on both sides, but different type or different bytes
- **Only in A** — files only on the active disk
- **Only in B** — files only on the compared disk
- **Identical** — same name, same type, same bytes

Each section is a collapsible group; **Identical** starts collapsed (usually the biggest and least interesting). The **summary cards** at the top show the count per section — click one to jump to that section. The **Filter by filename…** box narrows the list across all sections, expanding the ones with matches.

## Directory tab

Both directories side by side, row by row, with a marker per pair.

## Sectors tab

Only when both disks are the same format. A map of every track / sector, identical vs differing, with a count of differing sectors and bytes. Click a sector for a side-by-side hex view with the differing bytes highlighted; the ◀ / ▶ buttons step through every differing sector with an "n / total" position label.

## What's compared

- **Filename** — for pairing
- **File type + file content** — every byte of every file

What's NOT compared on the Files tab:

- **Directory order** — two disks with the same files in different orders still match
- **BAM allocation** — only file content matters, not where on disk it lives
- **Disk header / name / ID** — these can differ without files being different

The Sectors tab is purely positional, so it does see all of the above.

## Useful comparisons

- **Did my edit corrupt the disk?** Compare before-edit vs after-edit (save two copies first).
- **Did this copy operation work?** Compare source and destination.
- **What changed between v1 and v2 of this game?** Compare two release versions to find the patched files.
- **Verify a backup.** Compare your live disk vs the backup file.
