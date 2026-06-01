# IDE64 .hdd — CFS 0.11 filesystem

`.hdd` is the file format for an **IDE64** hard-disk image. The filesystem on it is **CFS 0.11** — IDEDOS's modern filesystem with up to 16 partitions, B-tree files (up to 4 GiB), LNK symlinks, and real sub-directories.

## Sizes

Variable, 4 MiB to 512 MiB on creation. The editor's **File → New → IDE64 HDD** writes a `cfsfdisk`-compatible byte layout (MBR + boot total-LBA count), so VICE's IDE64 auto-detect picks them up without the manual C/H/S dance.

## Structure

```
┌───────────────────────────────────────────┐
│ LBA 0      MBR / boot sector              │  ← partition default flag, label, magic
├───────────────────────────────────────────┤
│ LBA 1      Primary partition table        │  ← 16 slots × 32 bytes
├───────────────────────────────────────────┤
│ LBA 2 - N  Partition data                 │  ← each partition is a CFS filesystem slice
│            ...                            │
├───────────────────────────────────────────┤
│ Last LBA   Backup partition table         │  ← byte-identical mirror of LBA 1
└───────────────────────────────────────────┘
```

The 16-slot primary partition table is mirrored at the disk's last LBA as a backup — IDEDOS writes both whenever the table changes. If the primary gets corrupted, **Disk → Disk Tools → Restore Partition Table from Backup** copies the backup over the primary.

## Per partition

Each CFS partition is a filesystem with:

- **Bitmap** — one bit per LBA, marks allocated / free
- **Directory** — a chain of LBAs holding 32-byte entries (16 per LBA)
- **Files** — B-tree structures with byte-sliced data sectors
- **Boot sector** — partition name, deldir LBA pointer, etc.

### Byte-sliced data sectors

CFS data sectors are byte-sliced with stride 4 — file byte N lives at offset `(N & 0x7F) * 4 + (N >> 7)` within its sector. This is IDEDOS-specific and the editor applies the slicing on every read and write. Round-trip with DirMaster and VICE matches byte-for-byte.

### B-tree files

Files larger than one sector use a B-tree:

- Depth 0: file fits in 1 sector (≤ 512 bytes)
- Depth 1: 1 leaf pointing at up to 128 data sectors (≤ 64 KiB)
- Depth 2: 1 root + leaves (≤ 8 MiB)
- Depth 3: 1 root + 128 leaves + leaves (≤ 1 GiB)
- Depth 4: max 4 GiB

The editor caps imports at 4 MiB to avoid pathological depth-3+ trees in the UI. The format itself can handle larger.

### LNK symlinks

CFS supports `LNK` (link) entries that point at another file by path. The editor displays LNK entries as `LNK` in the type column; **View Link Target** shows where they point. Following a link (e.g., to view as PRG) opens the target file.

## What you can do

Full read/write inside CFS partitions, same UX as D64 / D71 / etc:

- Subdirectory navigation with breadcrumb + ".." row, LNK following
- PETSCII filenames, multi-select, drag-to-reorder
- Drag-drop import / export
- Rename, Scratch / Unscratch, Restore Directory, Restore Partition
- Insert / Remove / Align / Name Case / Lock / Splat / Separators
- File Type changes (DEL / SEQ / PRG / USR / REL)
- View As Hex / Disassembly / PETSCII / BASIC / Graphics / TASS
- Run in Emulator
- Save as Separator

Disk-level:

- Validate (reconciles partition bitmap against the B-tree set)
- Sort Directory
- **Scan for Lost Files (Quick + Deep)** — recovers via the byte-slice decoder with Export / Restore per candidate
- **Export Disk** (zip + Text / CSV / HTML listing)
- **View BAM** with a 64×64 heat map and Density / Ownership colour modes
- **Disk Map** at the partition-list view — horizontal strip showing MBR / PT / PT⁺ / live & deleted partitions / gaps

### .hdd-specific Disk Tools

- **Rename Disk Label** — edits the 16-byte boot-sector label; container header shows it instead of the filename
- **Restore Partition Table from Backup** — emergency recovery if the primary table is corrupt; preview modal shows what the backup contains before applying

## Block count cap

CFS uses 256-byte blocks for the size column display. The 65,024 cap still applies (VICE display).

## Recovery model

Everything destructive in CFS is reversible the way IDEDOS does it:

- **Scratching a file** marks the dir entry deleted (closed bit cleared); the data sectors stay; **Unscratch** restores the entry.
- **Removing a directory** moves its dir entries to a `<<DELETED FILES>>` deldir (per-partition); **Restore Directory** brings them back.
- **Deleting a partition** marks it deleted in the table but keeps the data sectors; **Restore Partition** un-deletes it (provided the data sectors haven't been claimed by a fresh partition that overlapped the same LBA range).

## Known features not yet built

These are deferred (currently disabled in `.hdd` view):

- **Find / Find in All Tabs** — needs a B-tree walker + per-file content scan
- **Compare With…** — per-file content compare + optional per-LBA structural diff
- **Fill Free Sectors / Optimize Disk** — low value for CFS, revisit on demand

## Saving

Writes the whole `.hdd` container as one file. Backup partition table at the last LBA stays in sync.
