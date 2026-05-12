// ── Sector allocation ─────────────────────────────────────────────────
// Real-drive allocation strategy. Don't trust the BAM — walk every file
// and directory chain to build a "true allocation" map first, then pick
// free sectors matching the format's track order and interleave.
// Used by file write, GEOS write, optimize, scan-orphans, and similar.

// Build a true sector allocation map by following all file and directory chains.
// Does NOT trust the BAM — walks every chain on disk.
function buildTrueAllocationMap(buffer) {
  var data = new Uint8Array(buffer);
  var fmt = currentFormat;
  var allocated = {}; // "t:s" -> true

  if (currentPartition && !currentPartition.dnpDir) {
    // Inside a D81 partition: mark partition system sectors (header, BAM1, BAM2)
    var st = currentPartition.startTrack;
    allocated[st + ':0'] = true; // header
    allocated[st + ':1'] = true; // BAM1
    allocated[st + ':2'] = true; // BAM2
  } else {
    // Root or linked subdir: mark all protected sectors (BAM, header, system)
    var sysTracks = fmt.getSkipTracks();
    Object.keys(sysTracks).forEach(function(st2) {
      var ps = fmt.getProtectedSectors(parseInt(st2));
      for (var psi = 0; psi < ps.length; psi++) allocated[st2 + ':' + ps[psi]] = true;
    });
    // Also mark protected sectors on non-skip tracks (e.g. D1M/D2M/D4M system partition on track 26)
    for (var et = 1; et <= currentTracks; et++) {
      if (sysTracks[et]) continue; // already handled above
      var eps = fmt.getProtectedSectors(et);
      for (var epi = 0; epi < eps.length; epi++) allocated[et + ':' + eps[epi]] = true;
    }
  }

  // Walk a directory chain, mark its sectors and all file chains as allocated.
  // For linked subdirs, recurse into subdirectory entries.
  function walkDirectory(dirT, dirS) {
    while (dirT !== 0) {
      var key = dirT + ':' + dirS;
      if (allocated[key]) break; // already visited (also prevents loops)
      allocated[key] = true;

      var off = sectorOffset(dirT, dirS);
      if (off < 0) break;

      for (var i = 0; i < fmt.entriesPerSector; i++) {
        var entOff = off + i * fmt.entrySize;
        var typeByte = data[entOff + 2];
        var typeIdx = typeByte & 0x07;
        if (typeIdx === 0 && !(typeByte & 0x80)) continue;

        var ft = data[entOff + 3], fs = data[entOff + 4];

        // Linked subdirectory: mark header + recurse into its dir chain
        if (fmt.subdirLinked && typeIdx === fmt.subdirType && (typeByte & 0x80)) {
          var hdrKey = ft + ':' + fs;
          if (!allocated[hdrKey]) {
            allocated[hdrKey] = true;
            var hdrOff = sectorOffset(ft, fs);
            if (hdrOff >= 0) {
              walkDirectory(data[hdrOff], data[hdrOff + 1]);
            }
          }
          continue;
        }

        // Follow all file sector chains (main + REL + GEOS)
        forEachFileSector(data, entOff, function(t, s) {
          allocated[t + ':' + s] = true;
        });
      }

      dirT = data[off]; dirS = data[off + 1];
    }
  }

  // For linked subdirs, always walk from root to cover all directories
  if (fmt.subdirLinked && currentPartition && currentPartition.dnpDir) {
    walkDirectory(fmt.dirTrack, fmt.dirSector);
  } else {
    var ctx = getDirContext();
    walkDirectory(ctx.dirTrack, ctx.dirSector);
  }

  return allocated;
}

// Allocate sectors using the same strategy as a real CBM drive:
// - 1541/1571: tracks below dir track first (descending), then above (ascending), interleave 10
// - 1581: tracks below dir track first (descending), then above (ascending), interleave 1
function allocateSectors(allocated, numSectors) {
  var fmt = currentFormat;

  var trackOrder = [];
  var interleave;

  if (currentPartition && !currentPartition.dnpDir) {
    // Inside a D81 partition: use partition's tracks (skip track 1 = system track)
    var st = currentPartition.startTrack;
    var numPartTracks = Math.floor(currentPartition.partSize / fmt.partitionSpt);
    // Partition's "directory track" is the start track; data goes on tracks 2+ (absolute: st+1, st+2, ...)
    for (var pt = 2; pt <= numPartTracks; pt++) trackOrder.push(st + pt - 1);
    interleave = fmt.defaultInterleave;
  } else {
    var dirTrack = fmt.dirTrack;
    var skipTracks = fmt.getSkipTracks();
    var maxBamTrack = fmt.bamTracksRange(currentTracks);
    for (var t = dirTrack - 1; t >= 1; t--) { if (!skipTracks[t]) trackOrder.push(t); }
    for (var t2 = dirTrack + 1; t2 <= maxBamTrack; t2++) { if (!skipTracks[t2]) trackOrder.push(t2); }
    interleave = fileInterleave;
  }
  return allocateSectorsFromTrackOrder(allocated, numSectors, trackOrder, interleave);
}
