# D1M / D2M / D4M — CMD FD-2000 / FD-4000

These are 3.5" floppies for the CMD FD-2000 (D1M / D2M) and FD-4000 (D4M). The format is a system partition + 1 or more Native / 1541 / 1571 / 1581 partitions.

## Sizes

| Format | Drive | Tracks | Sectors/track | Bytes | With errors |
|---|---|---|---|---|---|
| D1M | FD-2000 | 81 | 40 (DD) | 829,440 | 832,680 |
| D2M | FD-2000 | 81 | 80 (HD) | 1,658,880 | 1,665,360 |
| D4M | FD-4000 | 81 | 160 (ED) | 3,317,760 | 3,330,720 |

## Structure

A D1M / D2M / D4M file is a container — the **last track (track 81)** holds a system partition table that lists the user partitions. Each partition is a Native / 1541 / 1571 / 1581 slice of the rest of the disk.

The editor opens these as a **partition list** (like a [DHD](dhd.md) or [RAMLink](ramlink.md)). Double-click a partition to drill into it as a tab.

## What you can do

- Open the container — partition list shows partition type / name / size in MiB or blocks (Options toggle).
- **File → New Partition** — add a Native / 1541 / 1571 / 1581 partition into free space.
- **File → Import Partition** — pull a partition's data in from an external `.dnp` / `.d64` / `.d71` / `.d81`.
- **File → Export Partition** — write a partition out as a standalone file.
- Drill in and use the partition as a regular disk — full read/write.
- **Disk → Save** writes the whole container.

## Geometry of the system partition

The system partition table lives at the start of track 81 (logical). Layout per the CMD FD spec:

- One 32-byte entry per partition slot
- Slot fields: name (16 bytes), partition type, start LBA, size in blocks
- A "system marker" slot (16 × `$FF` then 16 × `$00`) signals a half-formatted disk

The editor handles half-formatted disks (skipping the system marker slot in free-block calculations) so the partition list looks right against real hardware.

## Block count cap

Same 65,024-block cap as the floppy formats (VICE display).

## Known quirks

- A few real-world D1M / D2M disks have soft-WP bytes set in their Native partitions' headers. **Disk Tools → Restore DOS Version Byte** clears them.
- The reader detects format from file size + the partition table layout, so a renamed `.dnp` won't accidentally open as a D1M.
