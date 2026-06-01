# RAMLink — RML / RL

RAMLink is the CMD RAMLink — a battery-backed RAM expansion that holds C64 disks in fast memory. The container file format is `.rml` or `.rl`. Up to **31 partitions** of types Native / 1541 / 1571 / 1581.

## Sizes

Standard RAMLink sizes:

| Size | Bytes |
|---|---|
| 1 MiB | 1,048,576 |
| 2 MiB | 2,097,152 |
| 4 MiB | 4,194,304 |
| 8 MiB | 8,388,608 (byte-checked against VICE) |
| 16 MiB | 16,777,216 |

The editor reads + writes all sizes; the 8 MiB output was byte-verified against VICE. The 1 / 2 / 4 / 16 MiB SYSTEM block layouts are believed-correct but not VICE-verified — if you produce a RAMLink at one of those sizes for real hardware, please diff against VICE and tell us.

## Structure

A RAMLink container has:

- **System block** at the start (firmware-specific layout)
- **32-slot partition table** (with the 31 user partitions + a hidden system slot)
- **Partitions** referenced by the table

## Geometry difference vs DHD

RAMLink uses **byte32 / sizeUnit: 256** for partition entries. CMD HD uses **block16 / sizeUnit: 512** (FD-style). The editor handles both, but they're not interchangeable.

## What you can do

- Open — partition list view with up to 31 partitions.
- **File → New → RAMLink** creates fresh containers in standard sizes (1 / 2 / 4 / 8 / 16 MiB). VICE will mount the output.
- **File → New Partition** adds a partition into free space; the picker UI shows free slots / available LBA ranges.
- **File → Import / Export Partition** — round-trip as `.dnp` / `.d64` / `.d71` / `.d81`.
- Drill into a partition; full read/write.

## Drag-drop containers and standalone DNPs

A `.rl` or `.rml` file is detected as a RAMLink container; a `.dnp` is a standalone Native partition. If a flat `.rml` happens to be just a DNP under that extension, the editor labels it RAMLink so the saved file keeps the right extension. This is one of the few cases where file extension tells the editor something the size alone can't.

## Default partition flag

Same open question as [DHD](dhd.md) — the equivalent of CFS's boot-sector `+$01` for RAMLink hasn't been located. Send reference images that differ only by default slot if you have them.
