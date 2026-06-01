# DNP — CMD Native Partition

DNP is the file format for a single **CMD Native** partition — the variable-size partition type used by CMD HD, FD-2000/4000, and RAMLink. It can stand alone as a file, or live inside a [DHD](dhd.md), [RAMLink](ramlink.md), or [D1M/D2M/D4M](d1m-d2m-d4m.md) container.

## Sizes

Variable. A DNP is always a whole number of "tracks" of 256 sectors of 256 bytes = 64 KiB per track.

| Tracks | Bytes | MiB |
|---|---|---|
| 1 | 65,536 | 0.0625 |
| 16 | 1,048,576 | 1 |
| 128 | 8,388,608 | 8 |
| 255 | 16,711,680 | ~16 (max) |

The max track count is 255 (8-bit field).

## Geometry

- **Track 1 sector 1**: header (disk name + ID + DOS-type), then BAM extends from sector 2
- **BAM**: 32 byte slots, one per track (256 sectors / 8 bits = 32 bytes per slot)
- **Sectors per track**: 256
- **Bytes per sector**: 256
- **Default file + dir interleave**: 1 (the CMD ROM whole-tracks; spec says 1)

## What you can do

Full read/write. The viewer renders the BAM in a single concentric strip (a DNP can be huge — 16 MiB at the limit — so the heat map is denser than D64's).

### Sub-directories

DNP supports **real sub-directories** (linked, not partition-style like D81). Add via **Disk → Add Directory** — creates a header sector + a first dir sector, both allocated from the BAM, plus a directory entry of type `$06` (DIR) in the current dir pointing at the new header.

Each sub-directory has its own dir chain. You can navigate in/out via double-click and the "..\\" row at the top.

Nesting is unlimited in spec, though the CMD firmware caps practical use at ~5 levels deep.

### Free-block accounting

CMD Native uses a 32-byte BAM per track. The first 8 bytes of the directory track's BAM slot are reserved (sectors 0-63 of the dir track) — see [reference: DNP free-count](../../memory/project_dnp_free_count_verify.md) for details. The editor's free-count matches `(tracks × 256) − 64` on a freshly-formatted Native, which is what real CMD hardware reports.

### Resize

**Disk → Resize Image** grows or shrinks a DNP. Growing always succeeds (appends empty tracks); shrinking only succeeds if every sector above the new track count is already free. The editor will tell you which files are in the way otherwise — typically the fix is to run **Disk → Optimize Disk** to pack files toward the start, then resize.

**Note:** Resize is *disabled* when the DNP lives inside a CMD container (DHD, RAMLink, FD) — the container slot has a fixed allocation and the surrounding header bytes encode the size. Resize from the container's partition list instead.

## DNP inside containers

A DNP inside DHD / RAMLink / FD-container is technically the same file format, but the container's partition table dictates start LBA and size. The editor opens the container, lists the partitions, and lets you drill into each as a tab.

## Saving

**File → Save** writes the natural size (tracks × 65,536).
