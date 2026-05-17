// ── IDE64 .hdd Disk Map ───────────────────────────────────────────────
// Horizontal strip view of the whole .hdd container: MBR + boot sector,
// partition-table sector, every partition (live / deleted / hidden), gaps
// of unallocated space, and the backup partition-table mirror. Opens from
// View → BAM when we're in the partition-list view of an .hdd (inside a
// CFS partition the existing CFS bitmap viewer takes over).

(function() {
  var bamEl = document.getElementById('opt-view-bam');
  if (!bamEl) return;
  bamEl.addEventListener('click', function(ev) {
    // Only handle the partition-list view. Inside a CFS partition the
    // CFS bitmap viewer (registered before us via index.html order) has
    // already stopImmediatePropagation'd before we get here.
    if (typeof hddBuffer === 'undefined' || !hddBuffer) return;
    if (typeof hddPartitions === 'undefined' || !hddPartitions) return;
    if (typeof cfsPartitionIdx !== 'undefined' && cfsPartitionIdx >= 0) return;
    ev.stopImmediatePropagation();
    if (typeof closeMenus === 'function') closeMenus();
    showIde64DiskMap();
  }, true);
})();

function showIde64DiskMap() {
  if (typeof showViewerModal !== 'function') return;
  var boot = parseIde64BootSector(hddBuffer);
  if (!boot) return;
  var info = readIde64Partitions(hddBuffer);
  if (!info) return;

  // Total LBA span: prefer the boot-sector's lastSector pointer (the
  // value cfsfdisk + IDE64 firmware compare against); fall back to the
  // buffer length when the field is zero (old / hand-built images).
  var lastLba = (boot.lastSector && boot.lastSector.lba) ? boot.lastSector.addr : 0;
  if (!lastLba) lastLba = Math.floor(hddBuffer.byteLength / IDE64_SECTOR_SIZE) - 1;
  var totalLbas = lastLba + 1;
  var partDirLba = (boot.partDir && boot.partDir.lba) ? boot.partDir.addr : 1;
  var backupLba = (boot.partDirBackup && boot.partDirBackup.lba) ? boot.partDirBackup.addr : lastLba;

  // Build the list of regions that get drawn on the strip. Each region:
  //   { startLba, endLba, kind, slot?, name?, type?, writeable?, hidden? }
  // kind ∈ 'mbr' | 'parttab' | 'parttab-backup' | 'partition' | 'partition-deleted' | 'gap'
  var regions = [];
  regions.push({ startLba: 0, endLba: 0, kind: 'mbr', label: 'MBR + boot sector' });
  if (partDirLba !== 0) regions.push({ startLba: partDirLba, endLba: partDirLba, kind: 'parttab', label: 'Partition table' });
  if (backupLba !== partDirLba && backupLba <= lastLba) {
    regions.push({ startLba: backupLba, endLba: backupLba, kind: 'parttab-backup', label: 'Partition-table backup' });
  }

  for (var i = 0; i < info.partitions.length; i++) {
    var p = info.partitions[i];
    if (p.empty) continue;
    if (p.startLba == null || p.endLba == null) continue;
    if (p.endLba < p.startLba) continue;
    regions.push({
      startLba: p.startLba,
      endLba: p.endLba,
      kind: p.deleted ? 'partition-deleted' : 'partition',
      slot: i,
      name: petsciiToReadable(p.name || '').trim() || '(unnamed)',
      type: p.typeName,
      typeCode: p.type,
      writeable: !!p.writeable,
      hidden: !!p.hidden,
      isDefault: (boot.defaultPart === i), // boot byte $01 holds the 0-based slot index, matches the partition-list renderer's convention
    });
  }

  // Compute gaps between regions. Sort by start, then fill.
  regions.sort(function(a, b) { return a.startLba - b.startLba; });
  var withGaps = [];
  var cursor = 0;
  for (var ri = 0; ri < regions.length; ri++) {
    var r = regions[ri];
    if (r.startLba > cursor) {
      withGaps.push({ startLba: cursor, endLba: r.startLba - 1, kind: 'gap' });
    }
    withGaps.push(r);
    cursor = Math.max(cursor, r.endLba + 1);
  }
  if (cursor <= lastLba) {
    withGaps.push({ startLba: cursor, endLba: lastLba, kind: 'gap' });
  }

  // Colour resolution per region.
  function regionColor(r) {
    if (r.kind === 'mbr')               return '#7a5c2e';
    if (r.kind === 'parttab')           return '#a87d3e';
    if (r.kind === 'parttab-backup')    return '#a87d3e';
    if (r.kind === 'gap')               return '#1c2030';
    if (r.kind === 'partition-deleted') return '#5a4040';
    // Live partition. CFS / GEOS / reserved get distinct hues.
    if (r.typeCode === 0x02)            return '#9a8030'; // GEOS
    if (r.typeCode === 0x01) {
      if (r.hidden) return '#3a4855';   // hidden
      if (!r.writeable) return '#3a5a7a'; // read-only
      return '#4a8fbd';                 // normal CFS
    }
    return '#666';                      // reserved / unknown
  }

  function fmtSize(sectors) {
    var bytes = sectors * 512;
    if (bytes >= 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(bytes >= 100 * 1024 * 1024 ? 0 : 1) + ' MiB';
    if (bytes >= 1024) return (bytes / 1024).toFixed(0) + ' KiB';
    return bytes + ' B';
  }
  function fmtLba(lba) { return '$' + lba.toString(16).toUpperCase().padStart(6, '0'); }

  // Layout maths: strip is full-width. Each region's left% / width% is
  // its LBA share. Single-LBA system sectors get a min-width via CSS so
  // they remain clickable.
  function buildHtml() {
    var lines = [];
    lines.push('<div class="hdd-map-wrap">');

    lines.push('<div class="hdd-map-stats">' +
      '<span><b>' + (boot.label || '(no label)') + '</b></span> ' +
      '<span>' + totalLbas.toLocaleString() + ' sectors</span> ' +
      '<span>' + fmtSize(totalLbas) + '</span> ' +
      '<span style="color:var(--text-muted)">default partition: slot ' + boot.defaultPart + '</span>' +
      '</div>');

    lines.push('<div class="hdd-map-strip" id="hdd-map-strip">');
    for (var ri = 0; ri < withGaps.length; ri++) {
      var r = withGaps[ri];
      var leftPct = (r.startLba / totalLbas) * 100;
      var widthPct = ((r.endLba - r.startLba + 1) / totalLbas) * 100;
      var cls = 'hdd-map-region hdd-map-' + r.kind;
      lines.push('<span class="' + cls + '" data-ri="' + ri + '" ' +
        'style="left:' + leftPct + '%;width:' + widthPct + '%;background:' + regionColor(r) + '"></span>');
    }
    lines.push('</div>');

    lines.push('<div class="hdd-map-axis">' +
      '<span>' + fmtLba(0) + '</span>' +
      '<span style="text-align:right">' + fmtLba(lastLba) + '</span>' +
      '</div>');

    lines.push('<div class="hdd-map-legend">' +
      '<span><span class="cfs-bam-swatch" style="background:#4a8fbd"></span>CFS</span>' +
      '<span><span class="cfs-bam-swatch" style="background:#3a5a7a"></span>CFS (read-only)</span>' +
      '<span><span class="cfs-bam-swatch" style="background:#3a4855"></span>Hidden</span>' +
      '<span><span class="cfs-bam-swatch" style="background:#9a8030"></span>GEOS</span>' +
      '<span><span class="cfs-bam-swatch" style="background:#5a4040"></span>Deleted (recoverable)</span>' +
      '<span><span class="cfs-bam-swatch" style="background:#a87d3e"></span>Partition table</span>' +
      '<span><span class="cfs-bam-swatch" style="background:#7a5c2e"></span>MBR</span>' +
      '<span><span class="cfs-bam-swatch" style="background:#1c2030"></span>Unallocated</span>' +
      '</div>');

    lines.push('<div class="hdd-map-detail" id="hdd-map-detail">Click a region for details. Partitions: double-click to enter.</div>');

    lines.push('</div>');
    return lines.join('');
  }

  function describeRegion(r) {
    var rangeStr = (r.startLba === r.endLba)
      ? 'LBA ' + fmtLba(r.startLba)
      : 'LBA ' + fmtLba(r.startLba) + ' .. ' + fmtLba(r.endLba);
    var span = r.endLba - r.startLba + 1;
    var sizeStr = (span > 1) ? ' &mdash; ' + span.toLocaleString() + ' sectors (' + fmtSize(span) + ')' : '';
    var out = '<div><b>' + rangeStr + '</b>' + sizeStr + '</div>';

    if (r.kind === 'mbr') {
      out += '<div>The .hdd boot sector at LBA 0. Holds the CFS magic, the pointer to the partition table, the default-partition flag, the label, and a PC-style MBR entry so cfsfdisk recognises the image.</div>';
    } else if (r.kind === 'parttab') {
      out += '<div>Holds the 16-slot partition table this view is built from. Every slot is 32 bytes — name, type, start LBA, end LBA, plus CFS-specific root-dir + deleted-dir pointers.</div>';
    } else if (r.kind === 'parttab-backup') {
      out += '<div>Mirror of the partition table at the last LBA. IDEDOS writes here on every partition-table edit and reads from it if the primary is unreadable.</div>';
    } else if (r.kind === 'gap') {
      out += '<div>Unallocated. No partition claims this range — a new partition could be created here.</div>';
    } else {
      // Partition
      out += '<div>Slot #' + r.slot + ' &mdash; <b>' + escHtml(r.name) + '</b> &lt;' + escHtml(r.type || '?') + '&gt;';
      if (r.isDefault) out += ' <span style="color:var(--accent)">[default]</span>';
      out += '</div>';
      var flags = [];
      if (r.kind === 'partition-deleted') flags.push('deleted (recoverable)');
      if (r.hidden) flags.push('hidden');
      flags.push(r.writeable ? 'writeable' : 'read-only');
      out += '<div style="color:var(--text-muted)">' + flags.join(' &middot; ') + '</div>';
      if (r.kind === 'partition' && r.typeCode === 0x01) {
        out += '<div style="margin-top:6px">Double-click the strip region (or use the partition list) to enter and see this partition\'s bitmap heat map.</div>';
      }
    }
    return out;
  }

  var body = showViewerModal('Disk Map — ' + (boot.label || 'IDE64 .hdd'), buildHtml(), 'large');

  var strip = body.querySelector('#hdd-map-strip');
  var detail = body.querySelector('#hdd-map-detail');
  if (strip && detail) {
    strip.addEventListener('click', function(e) {
      var el = e.target.closest('.hdd-map-region');
      if (!el) return;
      var ri = parseInt(el.getAttribute('data-ri'), 10);
      var r = withGaps[ri];
      if (!r) return;
      strip.querySelectorAll('.hdd-map-region.selected').forEach(function(s) { s.classList.remove('selected'); });
      el.classList.add('selected');
      detail.innerHTML = describeRegion(r);
    });
    strip.addEventListener('mouseover', function(e) {
      var el = e.target.closest('.hdd-map-region');
      if (!el) return;
      var ri = parseInt(el.getAttribute('data-ri'), 10);
      var r = withGaps[ri];
      if (!r) return;
      var label = (r.kind === 'partition' || r.kind === 'partition-deleted')
        ? r.name + ' (slot ' + r.slot + ')'
        : (r.label || r.kind);
      var rangeStr = (r.startLba === r.endLba) ? fmtLba(r.startLba) : fmtLba(r.startLba) + '..' + fmtLba(r.endLba);
      el.title = label + ' — ' + rangeStr;
    });
    strip.addEventListener('dblclick', function(e) {
      var el = e.target.closest('.hdd-map-region');
      if (!el) return;
      var ri = parseInt(el.getAttribute('data-ri'), 10);
      var r = withGaps[ri];
      if (!r || r.kind !== 'partition' || r.typeCode !== 0x01) return;
      if (typeof enterIde64Partition === 'function') {
        document.getElementById('modal-overlay').classList.remove('open');
        enterIde64Partition(r.slot);
      }
    });
  }

  var footer = document.querySelector('#modal-overlay .modal-footer');
  if (footer) {
    footer.innerHTML = '<button id="hdd-map-close">Close</button>';
    document.getElementById('hdd-map-close').addEventListener('click', function() {
      document.getElementById('modal-overlay').classList.remove('open');
    });
  }
}
