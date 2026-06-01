# DHD — CMD HD container

DHD is the file format for a **CMD HD** hard-drive image. It's a container of up to 254 user partitions of types Native / 1541 / 1571 / 1581.

## Sizes

Variable. The container grows when you add partitions and shrinks when you delete them. There's no fixed minimum or maximum file size — it's the sum of the partition sizes plus the system partition (HD-DOS).

## What you can do

- Open — opens to a partition list with up to 254 user partitions, plus a "system" slot holding HD-DOS itself.
- **Disk → New → CMD HD** creates a fresh image. The first time you open a real DHD that contains HD-DOS, the editor caches it locally; subsequent new images use the cached HD-DOS so they're bootable on a real CMD HD.
- **File → New Partition** adds a partition into free space.
- **File → Import / Export Partition** — round-trip individual partitions as `.dnp` / `.d64` / `.d71` / `.d81`.
- Drill into a partition by double-clicking; full read/write inside.
- **File → Save** writes the whole container.

## Important gotcha — CMD HD vs RAMLink

CMD HD uses **FD-style geometry** (block16x512, sizeUnit: 512), NOT RAMLink's byte32 / sizeUnit: 256. The editor handles both, but if you're hand-editing a partition entry the byte layout differs from RAMLink. The DHD reader matches VICE and DirMaster on real `.dhd` files.

## HD-DOS donor

The "HD-DOS donor" is the system partition image that makes a CMD HD bootable. The editor needs a donor to create bootable images:

1. The **first time** you open a real `.dhd` that contains HD-DOS, the editor caches the system partition in browser localStorage.
2. After that, **Disk → New → CMD HD** uses the cached donor — your new images are bootable on real hardware.
3. Without a donor cached, new images still open and work; they just lack the HD-DOS bootblock.

## Resize

Per-partition resize works through the normal **Disk → Resize Image** flow when you're drilled into a Native partition (Native is the only type that supports resize). 1541 / 1571 / 1581 partitions have fixed sizes.

## Saving

Writes the whole container as one file. The byte size matches the sum of partitions + HD-DOS + the table.

## Default partition flag

CMD HD has a "default partition" concept — one of the user partitions is marked as the one HD-DOS boots from. CFS has a similar flag at boot-sector `+$01`; for DHD / FD / RAMLink the equivalent is suspected but not 100% located. If you have reference images that differ only by default-slot, please send them and we can pin this down.
