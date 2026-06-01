# Compare disks

**Disk → Compare With…** runs a side-by-side diff of the current disk against a second disk. Useful for spotting differences between two versions, two backups, or for verifying that a copy round-tripped correctly.

## How it works

1. Pick the second disk via the prompt — either an already-open tab or an external file.
2. The editor walks both disks' directories + file contents.
3. Results are organised into four sections:
   - **Differ** — files with the same name on both sides but different content
   - **Only in A** — files only on the active disk
   - **Only in B** — files only on the compared disk
   - **Identical** — files with the same name + same bytes

## UI

Each section is a collapsible group. The "Identical" section is collapsed by default (it's usually the biggest and least interesting); the other three start expanded.

**Filter box** above the file list — type to narrow the list by filename across all sections. Matching sections auto-expand.

**Summary cards** at the top show the count per section. Click a card to jump to that section.

**Column headers** stay visible while you scroll the file list.

## Sector-level diff

Click a file in the **Differ** section to open the sector-level drill-down: side-by-side hex view of the two files' bytes, highlighted at each differing byte.

`◀ / ▶` buttons step through every differing sector with a "5 / 23" position label. Useful for spotting where two versions diverged.

## What's compared

- **Filename + type** — for matching
- **File content** — every byte of every file's data sectors
- **Block count** — informational
- **GEOS INFO blocks** — included in the byte comparison
- **REL side-sectors** — included

What's NOT compared:

- **Directory order** — two disks with the same files in different orders both match
- **BAM allocation** — only file content matters, not where on disk it lives
- **Disk header / name / ID** — these can differ without files being different

## CFS (.hdd) limitations

Compare is **disabled** for `.hdd` disks today. Needs per-file content compare (which means byte-slice decoding) and ideally also per-LBA structural diff. On the TODO list.

## Compare two RAMLink containers

Compare can handle containers — it descends into each partition and diffs them in turn. Result groups by partition.

## Useful comparisons

- **Did my edit corrupt the disk?** Compare before-edit vs after-edit (save two copies first).
- **Did this copy operation work?** Compare source and destination.
- **What changed between v1 and v2 of this game?** Compare two release versions to find the patched files.
- **Verify a backup.** Compare your live disk vs the backup file.
