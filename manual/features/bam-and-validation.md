# BAM, heat map, validate

The Block Allocation Map (BAM) tracks which sectors are in use on a disk. The editor shows it as a heat map and uses it for integrity checks.

## View BAM

**Disk → View BAM** opens the heat map. Each disk format has its own layout:

### CBM-DOS (D64 / D71 / D81 / D80 / D82)

Concentric strip: inner = track 1, outer = max track. Each sector is one cell.

Colors:

| State | Color |
|---|---|
| **Free** | Light blue |
| **Used (file)** | Dark blue or per-file colour in Ownership mode |
| **Reserved (system)** | Grey — directory track, BAM blocks, etc. |
| **Splat / orphan** | Yellow — sector claimed by an open / corrupted file |
| **Lost** | Red — sector has data but no dir entry owns it |

### IDE64 .hdd

64×64 heat map of CFS LBAs. Same colour scheme. Tabbed modal: **Partitions** tab shows the disk-map strip with MBR / PT / PT⁺ / per-partition blocks; the second tab shows the current partition's heat map.

### CMD containers (DHD / RAMLink / D1M/D2M/D4M)

Partition-list view doesn't have BAM (the container itself isn't a filesystem). Drill into a partition to see its BAM.

### G64

**Disk → Disk Tools → G64 Layout…** opens a multi-tab viewer:

- **Layout** tab — per-track summary with copy-protection tagging (standard / interleave-1 / copy-protected / scrambled)
- **Raw Tracks** tab — concentric tracks coloured by underlying GCR bits (sync marks red, normal green, gap blue). Zoom 1× → 5× with click-drag panning

## Heat map modes

Top-right toggle switches between:

### Density

Per-sector colour by *how much* of the sector is non-zero. Useful for spotting under-utilised disks at a glance.

### Ownership

Each file gets its own colour; clicking a file in the directory highlights its sectors in the BAM.

## Per-track free-block summary

Below the heat map, a table lists each track with its free-block count and the sectors that are free / used / reserved. Useful for picking where to allocate next.

## Validate

**Disk → Validate** rebuilds the BAM from the directory chain + every file's sector chain. Equivalent to `V0:` on a real C64.

Validate performs these passes:

1. **Walk directory entries** — for every "closed" file, walk its sector chain. Mark each sector as owned by that file.
2. **Walk REL side-sectors** — REL files have an extra chain.
3. **Walk GEOS info blocks + VLIR records** — same idea.
4. **Cross-link detection** — if two files claim the same sector, log it as ERROR with both names.
5. **Orphan detection** — sectors with data but no owner get flagged as "lost".
6. **Splat removal** — open files (closed bit unset) get scratched.
7. **BAM rebuild** — write the new free-block counts + bitmaps based on the walk.

Validate produces a log modal:

- 🟢 No errors → "Disk is valid. No changes."
- 🟡 Cleaned up splat files / recalculated BAM → "Validation complete. N changes."
- 🔴 Real corruption (cross-links, broken chains) → "Validation complete with errors." Each error names the affected file.

Splat removal and BAM rebuild mark the tab dirty (you need to **Save** to commit). Errors are *reports* — Validate doesn't try to repair corruption beyond the splat removal.

## Scan for Lost Files

**Disk → Disk Tools → Scan for Lost Files ▸**

When you scratch a file, the dir entry's "closed" bit clears but the data sectors stay. As long as nothing has been written to the disk since, the file content is recoverable.

Two modes:

### Quick

Walks the directory looking for entries with the closed-bit clear (i.e., scratched but not overwritten dir entries). For each found, reports the original filename and offers Export / Restore.

### Deep

Walks the **whole disk** looking for orphaned chains — sectors that look like file data (valid T/S linkage, plausible end-marker) but aren't claimed by any dir entry. This catches files where the dir entry has been overwritten too.

Deep scan uses a heuristic: a sector is a "plausible chain start" if at least 8 of its 16 contiguous track-sector pointer slots make sense. The threshold filters out random byte sequences that happen to look like chains.

Both modes produce a list. Per candidate:

- **Export** — saves the recovered bytes to your OS (you pick a filename and extension)
- **Restore** — writes a new dir entry pointing at the chain, marking the file in use again

## Disk integrity indicator

The status footer shows a coloured dot:

- 🟢 **Green** — BAM matches the directory walk, no splat / orphans
- 🟡 **Yellow** — minor issues (a splat file, BAM count drift)
- 🔴 **Red** — real corruption (cross-links, broken chain)
- ⚪ **Grey** — not yet computed

Hover for a one-line summary; **Disk → Validate** for the full report.

## Disk Map (.hdd only)

The disk map strip in the partition-list view of an `.hdd` shows the whole disk linearly:

```
[ MBR ][ PT ][ Partition 0: STORAGE     ][ gap ][ Partition 1: GAMES ][ ... ][ PT⁺ ]
```

- **MBR**, **PT**, **PT⁺** get fixed-width labelled blocks so they're visible regardless of disk size
- **Live partitions** scale by sector count (a 4 MiB partition is ~2× as wide as a 2 MiB one)
- **Deleted partitions** show with a struck-through styling
- **Hidden partitions** show with a paler tint
- **Gaps** (unallocated space) appear as empty regions

Click a region for details; double-click a CFS partition to drill in.
