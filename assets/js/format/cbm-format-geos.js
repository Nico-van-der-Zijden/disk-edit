// ── GEOS support ─────────────────────────────────────────────────────
var GEOS_FILE_TYPES = {
  0x00: 'Non-GEOS',
  0x01: 'BASIC',
  0x02: 'Assembler',
  0x03: 'Data file',
  0x04: 'System file',
  0x05: 'Desk accessory',
  0x06: 'Application',
  0x07: 'Application data',
  0x08: 'Font file',
  0x09: 'Printer driver',
  0x0A: 'Input driver',
  0x0B: 'Disk driver/device',
  0x0C: 'System boot file',
  0x0D: 'Temporary',
  0x0E: 'Auto-exec file',
  0x0F: 'Input 128',
  0x10: 'Numerics',
  0x11: 'Help file',
  0x12: 'MEGA patch',
  0x13: 'Write image',
  0x14: 'Paint image',
  0x15: 'Photo scrap',
  0x16: 'Text scrap',
  0x17: 'Text album',
  0x18: 'Photo album',
  0x19: 'Cardset',
  0x1A: 'Gateway GeoCalc',
  0x1B: 'Gateway GeoFile',
  0x1C: 'Sound file',
  0x1D: 'Configuration',
};

var GEOS_STRUCTURE_TYPES = {
  0x00: 'Sequential',
  0x01: 'VLIR',
  0x02: 'Chained VLIR',
};

var GEOS_SIGNATURE = 'GEOS format V1.0';
var GEOS_SIG_OFFSET = 0xAD; // offset within header sector

/** @param {ArrayBuffer} buffer @returns {boolean} */
function hasGeosSignature(buffer) {
  if (!buffer) return false;
  var data = new Uint8Array(buffer);
  var hdrOff = sectorOffset(currentFormat.headerTrack, currentFormat.headerSector);
  if (hdrOff < 0) return false;
  for (var i = 0; i < GEOS_SIGNATURE.length; i++) {
    if (data[hdrOff + GEOS_SIG_OFFSET + i] !== GEOS_SIGNATURE.charCodeAt(i)) return false;
  }
  return true;
}

/** @param {ArrayBuffer} buffer */
function writeGeosSignature(buffer) {
  var data = new Uint8Array(buffer);
  var hdrOff = sectorOffset(currentFormat.headerTrack, currentFormat.headerSector);
  if (hdrOff < 0) return;
  for (var i = 0; i < GEOS_SIGNATURE.length; i++) {
    data[hdrOff + GEOS_SIG_OFFSET + i] = GEOS_SIGNATURE.charCodeAt(i);
  }
  // Also set the "border" byte at 0xAB to 0x00 (GEOS uses this)
  data[hdrOff + 0xAB] = 0x00;
  data[hdrOff + 0xAC] = 0x00;
}

// Check if a disk has GEOS formatting (border sector signature at T18/S0 offset 0xAD)
function isGeosDisk(buffer) {
  if (!buffer) return false;
  var data = new Uint8Array(buffer);
  var bamOff = sectorOffset(currentFormat.bamTrack, currentFormat.bamSector);
  if (bamOff < 0) return false;
  // GEOS identification: bytes at BAM offset 0xAD-0xBC contain "GEOS format"
  // or the border sector has specific values. A simpler check: look for any
  // directory entry with GEOS file type > 0
  var info = parseDisk(buffer);
  for (var i = 0; i < info.entries.length; i++) {
    var eOff = info.entries[i].entryOff;
    if (data[eOff + 0x18] > 0) return true; // GEOS file type at byte 24
  }
  return false;
}

// Read GEOS info for a directory entry
function readGeosInfo(buffer, entryOff) {
  var data = new Uint8Array(buffer);
  var infoTrack = data[entryOff + 0x15];     // byte 21: info block track
  var infoSector = data[entryOff + 0x16];    // byte 22: info block sector
  var geosStructure = data[entryOff + 0x17]; // byte 23: structure type
  var geosFileType = data[entryOff + 0x18];  // byte 24: GEOS file type
  var year = data[entryOff + 0x19];          // byte 25: year (0-99, + 1900)
  var month = data[entryOff + 0x1A];         // byte 26: month (1-12)
  var day = data[entryOff + 0x1B];           // byte 27: day (1-31)
  var hour = data[entryOff + 0x1C];          // byte 28: hour (0-23)
  var minute = data[entryOff + 0x1D];        // byte 29: minute (0-59)

  var fullYear = year > 0 ? (year < 50 ? 2000 + year : 1900 + year) : 0;

  var result = {
    isGeos: geosFileType > 0,
    structure: geosStructure,
    structureName: GEOS_STRUCTURE_TYPES[geosStructure] || 'Unknown ($' + geosStructure.toString(16).toUpperCase().padStart(2, '0') + ')',
    fileType: geosFileType,
    fileTypeName: GEOS_FILE_TYPES[geosFileType] || 'Unknown ($' + geosFileType.toString(16).toUpperCase().padStart(2, '0') + ')',
    year: fullYear,
    month: month,
    day: day,
    hour: hour,
    minute: minute,
    date: '',
    infoTrack: infoTrack,
    infoSector: infoSector,
  };

  if (fullYear > 0 && month > 0 && month <= 12 && day > 0 && day <= 31) {
    result.date = fullYear + '-' +
      String(month).padStart(2, '0') + '-' +
      String(day).padStart(2, '0') + ' ' +
      String(hour).padStart(2, '0') + ':' +
      String(minute).padStart(2, '0');
  }

  return result;
}

// Read GEOS info block (256-byte sector with icon, description, class, author)
function decodeGeosString(data, offset, maxLen) {
  var s = '';
  for (var i = 0; i < maxLen; i++) {
    var b = data[offset + i];
    if (b === 0x00) break;
    if (b >= 0x20 && b <= 0x7E) s += String.fromCharCode(b);
    else if (b >= 0xC1 && b <= 0xDA) s += String.fromCharCode(b - 0x80); // shifted → uppercase
    else if (b === 0x0D) s += '\n';
    else s += '.';
  }
  return s;
}

// Read VLIR records from a GEOS VLIR file.
// The directory entry's T/S points to the VLIR index sector.
// The index contains up to 127 record pointers (T/S pairs at bytes 2-255).
// Each record is a standard sector chain. Returns array of Uint8Array (one per record).
function readVLIRRecords(buffer, entryOff) {
  var data = new Uint8Array(buffer);
  var fmt = currentFormat;
  var indexT = data[entryOff + 3];
  var indexS = data[entryOff + 4];
  if (indexT === 0) return [];

  var idxOff = sectorOffset(indexT, indexS);
  if (idxOff < 0) return [];

  var records = [];
  // Index sector: bytes 2-255 = up to 127 record T/S pairs
  for (var ri = 0; ri < 127; ri++) {
    var recT = data[idxOff + 2 + ri * 2];
    var recS = data[idxOff + 2 + ri * 2 + 1];
    if (recT === 0 && recS === 0) {
      records.push(null); // empty record
      continue;
    }
    if (recT === 0 && recS === 0xFF) {
      records.push(null); // non-existent record
      continue;
    }
    // Follow this record's sector chain
    var bytes = [];
    var visited = {};
    var t = recT, s = recS;
    while (t !== 0) {
      if (t < 1 || t > currentTracks) break;
      if (s >= fmt.sectorsPerTrack(t)) break;
      var key = t + ':' + s;
      if (visited[key]) break;
      visited[key] = true;
      var off = sectorOffset(t, s);
      if (off < 0) break;
      var nextT = data[off], nextS = data[off + 1];
      if (nextT === 0) {
        for (var i = 2; i <= nextS && i < 256; i++) bytes.push(data[off + i]);
      } else {
        for (var j = 2; j < 256; j++) bytes.push(data[off + j]);
      }
      t = nextT; s = nextS;
    }
    records.push(new Uint8Array(bytes));
  }
  // Trim trailing null records
  while (records.length > 0 && records[records.length - 1] === null) records.pop();
  return records;
}

// Read VLIR records in the format expected by writeVlirFileToDisk (and CVT import):
//   end marker (00/00)  -> null
//   empty slot (00/FF)  -> { data: null }
//   populated record    -> { data: Uint8Array }
// Unlike readVLIRRecords (which is lossy), this preserves the end-vs-empty distinction
// so a VLIR file can be copied and pasted without losing its index structure.
function readVLIRRecordsForCopy(buffer, entryOff) {
  var data = new Uint8Array(buffer);
  var fmt = currentFormat;
  var indexT = data[entryOff + 3];
  var indexS = data[entryOff + 4];
  if (indexT === 0) return [];
  var idxOff = sectorOffset(indexT, indexS);
  if (idxOff < 0) return [];

  var records = [];
  for (var ri = 0; ri < 127; ri++) {
    var recT = data[idxOff + 2 + ri * 2];
    var recS = data[idxOff + 2 + ri * 2 + 1];
    if (recT === 0 && recS === 0) {
      records.push(null); // end marker — stop
      break;
    }
    if (recT === 0 && recS === 0xFF) {
      records.push({ data: null }); // empty slot
      continue;
    }
    // Populated record: follow sector chain
    var bytes = [];
    var visited = {};
    var t = recT, s = recS;
    while (t !== 0) {
      if (t < 1 || t > currentTracks) break;
      if (s >= fmt.sectorsPerTrack(t)) break;
      var key = t + ':' + s;
      if (visited[key]) break;
      visited[key] = true;
      var off = sectorOffset(t, s);
      if (off < 0) break;
      var nextT = data[off], nextS = data[off + 1];
      if (nextT === 0) {
        for (var i = 2; i <= nextS && i < 256; i++) bytes.push(data[off + i]);
      } else {
        for (var j = 2; j < 256; j++) bytes.push(data[off + j]);
      }
      t = nextT; s = nextS;
    }
    records.push({ data: new Uint8Array(bytes) });
  }
  return records;
}

/** @param {Uint8Array} data @param {number} entryOff @returns {boolean} */
function isVlirFile(data, entryOff) {
  var typeIdx = data[entryOff + 2] & 0x07;
  return data[entryOff + 0x18] > 0 &&
         typeIdx !== FILE_TYPE.REL &&
         data[entryOff + 0x17] === 0x01;
}

/** @param {Uint8Array} data @param {number} entryOff @param {(track: number, sector: number) => void} callback @returns {number} Total sectors visited */
function forEachFileSector(data, entryOff, callback) {
  var fmt = currentFormat;
  var typeIdx = data[entryOff + 2] & 0x07;
  var count = 0;

  function followChain(ft, fs) {
    var visited = {};
    while (ft !== 0) {
      if (ft < 1 || ft > currentTracks) break;
      if (fs >= fmt.sectorsPerTrack(ft)) break;
      var key = ft + ':' + fs;
      if (visited[key]) break;
      visited[key] = true;
      callback(ft, fs);
      count++;
      var off = sectorOffset(ft, fs);
      if (off < 0) break;
      ft = data[off]; fs = data[off + 1];
    }
  }

  // Main file chain
  var startT = data[entryOff + 3], startS = data[entryOff + 4];
  followChain(startT, startS);

  // REL file: side-sector chain
  if (typeIdx === FILE_TYPE.REL) {
    followChain(data[entryOff + 0x15], data[entryOff + 0x16]);
  }

  // GEOS file: info block + VLIR record chains
  if (data[entryOff + 0x18] > 0 && typeIdx !== FILE_TYPE.REL) {
    var infoT = data[entryOff + 0x15];
    var infoS = data[entryOff + 0x16];
    if (infoT >= 1 && infoT <= currentTracks &&
        infoS < fmt.sectorsPerTrack(infoT)) {
      callback(infoT, infoS);
      count++;
    }
    // VLIR: walk each record chain from the index sector
    if (data[entryOff + 0x17] === 0x01) {
      var idxOff = sectorOffset(startT, startS);
      if (idxOff >= 0) {
        for (var vri = 0; vri < 127; vri++) {
          var recT = data[idxOff + 2 + vri * 2];
          var recS = data[idxOff + 2 + vri * 2 + 1];
          if (recT === 0 && recS === 0) break;
          if (recT === 0) continue;
          followChain(recT, recS);
        }
      }
    }
  }

  return count;
}

// Allocate up to `numSectors` sectors by scanning `trackOrder` with the given
// drive `interleave`. Mirrors CBM drive behaviour: on each track, scan forward
// from (lastSector + interleave) wrapping at sectorsPerTrack, fill the track
// as far as possible, then advance to the next track. Mutates `allocated`
// (keys "t:s") to mark chosen sectors, and returns the new [{ track, sector }]
// list. Callers build their own trackOrder + allocated map.
function allocateSectorsFromTrackOrder(allocated, numSectors, trackOrder, interleave) {
  var fmt = currentFormat;
  var sectorList = [];
  var lastSector = 0;

  for (var ti = 0; ti < trackOrder.length && sectorList.length < numSectors; ti++) {
    var track = trackOrder[ti];
    var spt = fmt.sectorsPerTrack(track);

    var s = (lastSector + interleave) % spt;
    var foundFirst = false;
    for (var attempt = 0; attempt < spt; attempt++) {
      if (!allocated[track + ':' + s]) {
        sectorList.push({ track: track, sector: s });
        allocated[track + ':' + s] = true;
        lastSector = s;
        foundFirst = true;
        break;
      }
      s = (s + 1) % spt;
    }

    if (!foundFirst) continue;

    while (sectorList.length < numSectors) {
      var nextS = (lastSector + interleave) % spt;
      var foundMore = false;
      for (var a2 = 0; a2 < spt; a2++) {
        if (!allocated[track + ':' + nextS]) {
          sectorList.push({ track: track, sector: nextS });
          allocated[track + ':' + nextS] = true;
          lastSector = nextS;
          foundMore = true;
          break;
        }
        nextS = (nextS + 1) % spt;
      }
      if (!foundMore) break;
    }
  }

  return sectorList;
}

// Walk a DNP image (root dir + linked subdirs) and return a list of
// { owner, track, sector } entries describing each allocated sector whose
// track is >= minTrack. Used by the DNP resize operation to explain to the
// user what's preventing a shrink from fitting.
function findDnpHighTrackOwners(buffer, minTrack) {
  var data = new Uint8Array(buffer);
  var totalTracks = buffer.byteLength / 65536;
  var fmt = DISK_FORMATS.dnp;
  var owners = [];

  function dnpOff(t, s) { return (t - 1) * 65536 + s * 256; }
  function record(ownerLabel, t, s) {
    if (t >= minTrack && t <= totalTracks) owners.push({ owner: ownerLabel, track: t, sector: s });
  }

  function walkChain(startT, startS, label) {
    var visited = {};
    var t = startT, s = startS;
    while (t !== 0 && t <= totalTracks) {
      if (s < 0 || s >= 256) break;
      var key = t + ':' + s;
      if (visited[key]) break;
      visited[key] = true;
      record(label, t, s);
      var off = dnpOff(t, s);
      t = data[off];
      s = data[off + 1];
    }
  }

  function walkDir(dirT, dirS, path) {
    var dirVisited = {};
    while (dirT !== 0 && dirT <= totalTracks) {
      var key = dirT + ':' + dirS;
      if (dirVisited[key]) break;
      dirVisited[key] = true;
      record((path || '<root>') + ' (directory)', dirT, dirS);
      var off = dnpOff(dirT, dirS);
      for (var i = 0; i < 8; i++) {
        var eo = off + i * 32;
        var tb = data[eo + 2];
        if ((tb & 0x80) === 0) continue;
        var typeIdx = tb & 0x07;
        var rawName = readPetsciiString(data, eo + 5, 16);
        var readable = petsciiToReadable(rawName).trim() || '<unnamed>';
        var label = path ? path + '/' + readable : readable;

        if (typeIdx === fmt.subdirType) {
          var hdrT = data[eo + 3], hdrS = data[eo + 4];
          record(label + ' (subdir header)', hdrT, hdrS);
          var hdrOff = dnpOff(hdrT, hdrS);
          walkDir(data[hdrOff], data[hdrOff + 1], label);
          continue;
        }

        walkChain(data[eo + 3], data[eo + 4], label);

        if (typeIdx === FILE_TYPE.REL) {
          walkChain(data[eo + 0x15], data[eo + 0x16], label + ' (REL side-sectors)');
        } else if (data[eo + 0x18] > 0) {
          var giT = data[eo + 0x15], giS = data[eo + 0x16];
          if (giT > 0) record(label + ' (GEOS info)', giT, giS);
          if (data[eo + 0x17] === 0x01) {
            var viT = data[eo + 3], viS = data[eo + 4];
            if (viT > 0 && viT <= totalTracks) {
              var viOff = dnpOff(viT, viS);
              for (var r = 0; r < 127; r++) {
                var rT = data[viOff + 2 + r * 2];
                var rS = data[viOff + 2 + r * 2 + 1];
                if (rT === 0 && rS === 0) break;
                if (rT === 0) continue;
                walkChain(rT, rS, label + ' (VLIR record ' + r + ')');
              }
            }
          }
        }
      }
      var chainOff = dnpOff(dirT, dirS);
      dirT = data[chainOff];
      dirS = data[chainOff + 1];
    }
  }

  walkDir(fmt.dirTrack, fmt.dirSector, '');
  return owners;
}

// Resize a DNP image to `newTracks` (2..255). Returns one of:
//   { buffer: ArrayBuffer }                   — success
//   { error: string }                         — rejected (bad input / wrong format)
//   { error: 'blocked', owners: [...] }       — shrink blocked; list from findDnpHighTrackOwners
// Grow: always succeeds. Appends empty tracks and sets their BAM bitmap to all-free.
// Shrink: only succeeds if every sector above newTracks is already free. The UI
// handler is expected to compact first (via optimizeDisk) and retry.
function resizeDnpImage(buffer, newTracks) {
  if (currentFormat !== DISK_FORMATS.dnp) return { error: 'Resize is only supported for DNP images.' };
  if (typeof newTracks !== 'number' || !isFinite(newTracks) || newTracks < 2 || newTracks > 255) {
    return { error: 'Track count must be between 2 and 255.' };
  }
  var oldTracks = buffer.byteLength / 65536;
  if (newTracks === oldTracks) return { buffer: buffer };
  var oldData = new Uint8Array(buffer);

  if (newTracks < oldTracks) {
    var owners = findDnpHighTrackOwners(buffer, newTracks + 1);
    if (owners.length > 0) return { error: 'blocked', owners: owners };
    var shrunk = new Uint8Array(newTracks * 65536);
    shrunk.set(oldData.subarray(0, newTracks * 65536));
    shrunk[2 * 256 + 0x08] = newTracks;
    return { buffer: shrunk.buffer };
  }

  var grown = new Uint8Array(newTracks * 65536);
  grown.set(oldData);
  // Each BAM slot (32 bytes) = 256 bits = 256 sectors; 0xFF = free.
  for (var t = oldTracks + 1; t <= newTracks; t++) {
    var bamSec = 2 + (t >> 3);
    var slotOff = bamSec * 256 + (t & 7) * 32;
    for (var b = 0; b < 32; b++) grown[slotOff + b] = 0xFF;
  }
  grown[2 * 256 + 0x08] = newTracks;
  return { buffer: grown.buffer };
}

// Enumerate the GEOS "auxiliary" sectors of a file entry: info block and
// VLIR record chain starts. Unlike forEachFileSector, this does NOT walk the
// record chains themselves — callers that need per-sector cross-link /
// error-reporting context (validateDisk, validatePartition) plug in their own
// walker for each record start.
//
// onInfoBlock(track, sector) — called once if the entry has a GEOS info block.
// onRecordStart(track, sector, recordIdx) — called per VLIR record chain head.
function forEachGeosAuxSector(data, entryOff, onInfoBlock, onRecordStart) {
  var typeIdx = data[entryOff + 2] & 0x07;
  if (data[entryOff + 0x18] === 0 || typeIdx === FILE_TYPE.REL) return;
  if (onInfoBlock) onInfoBlock(data[entryOff + 0x15], data[entryOff + 0x16]);
  if (data[entryOff + 0x17] !== 0x01) return;
  var startT = data[entryOff + 3], startS = data[entryOff + 4];
  var idxOff = sectorOffset(startT, startS);
  if (idxOff < 0) return;
  for (var i = 0; i < 127; i++) {
    var recT = data[idxOff + 2 + i * 2];
    var recS = data[idxOff + 2 + i * 2 + 1];
    if (recT === 0 && recS === 0) break;
    if (recT === 0) continue;
    if (onRecordStart) onRecordStart(recT, recS, i);
  }
}

// Decompress GEOS bitmap data (geoPaint compression).
// code < 64: next 'code' bytes are literal data
// code 64-127: fill (code-64) cards with next 8-byte pattern
// code > 127: repeat next byte (code-128) times
function decompressGeosBitmap(compressed) {
  var out = [];
  var pos = 0;
  while (pos < compressed.length) {
    var code = compressed[pos++];
    if (code < 64) {
      for (var i = 0; i < code && pos < compressed.length; i++) out.push(compressed[pos++]);
    } else if (code < 128) {
      var count = code - 64;
      if (pos + 8 > compressed.length) break;
      var pat = [];
      for (var p = 0; p < 8; p++) pat.push(compressed[pos++]);
      for (var r = 0; r < count; r++) for (var p2 = 0; p2 < 8; p2++) out.push(pat[p2]);
    } else {
      if (pos >= compressed.length) break;
      var val = compressed[pos++];
      var reps = code - 128;
      for (var r2 = 0; r2 < reps; r2++) out.push(val);
    }
  }
  return new Uint8Array(out);
}

// Decompress GEOS scrap/album bitmap stream (different from geoPaint!).
// 0, 128, 220: skip (illegal opcodes)
// 1-127: RLE — repeat next byte 'code' times
// 129-219: literal — next (code-128) bytes are data
// 221-255: pattern — patsize=(code-220), next byte=repeat count, then patsize pattern bytes
function decompressGeosScrap(compressed) {
  var out = [];
  var pos = 0;
  while (pos < compressed.length) {
    var code = compressed[pos++];
    if (code === 0 || code === 128 || code === 220) continue;
    if (code < 128) {
      if (pos >= compressed.length) break;
      var val = compressed[pos++];
      for (var r = 0; r < code; r++) out.push(val);
    } else if (code <= 219) {
      var count = code - 128;
      for (var i = 0; i < count && pos < compressed.length; i++) out.push(compressed[pos++]);
    } else {
      var patsize = code - 220;
      if (pos + 1 + patsize > compressed.length) break;
      var repeat = compressed[pos++];
      var pat = [];
      for (var p = 0; p < patsize; p++) pat.push(compressed[pos++]);
      for (var r2 = 0; r2 < repeat; r2++) for (var p2 = 0; p2 < patsize; p2++) out.push(pat[p2]);
    }
  }
  return new Uint8Array(out);
}

function readGeosInfoBlock(buffer, track, sector) {
  if (track === 0) return null;
  var off = sectorOffset(track, sector);
  if (off < 0) return null;
  var data = new Uint8Array(buffer);

  // Info block layout:
  // 0x00-0x01: info block ID bytes (should be 0x00, 0xFF)
  // 0x02-0x03: icon width (bytes), height (pixels)
  // 0x04-0x43: icon sprite data (63 bytes)
  // 0x44: CBM file type
  // 0x45: GEOS file type
  // 0x46: GEOS structure type
  // 0x47-0x48: load address
  // 0x49-0x4A: end address
  // 0x4B-0x4C: init address
  // 0x4D-0x60: class name (20 bytes, 0x00 terminated)
  // 0x61-0x74: author (20 bytes, 0x00 terminated)  — actually at different offset
  // 0x85-0xFE: file description (free-form text, 0x00 terminated)

  var className = decodeGeosString(data, off + 0x4D, 20);
  var description = decodeGeosString(data, off + 0xA0, 96);

  // Icon: $02 = width (bytes), $03 = height (pixels), $04 = width (pixels), $05-$43 = bitmap
  var iconW = data[off + 0x02]; // width in bytes (typically 3 = 24px)
  var iconH = data[off + 0x03]; // height in pixels (typically 21)
  var iconBytes = iconW * iconH;
  var iconData = (iconW > 0 && iconH > 0 && iconBytes <= 63)
    ? data.subarray(off + 0x05, off + 0x05 + iconBytes) : null;

  return {
    className: className,
    description: description,
    loadAddr: data[off + 0x47] | (data[off + 0x48] << 8),
    endAddr: data[off + 0x49] | (data[off + 0x4A] << 8),
    initAddr: data[off + 0x4B] | (data[off + 0x4C] << 8),
    iconW: iconW * 8,
    iconH: iconH,
    iconData: iconData,
  };
}

function unicodeToPetscii(char) {
  var cp = char.charCodeAt(0);
  if (cp >= 0xE000 && cp <= 0xE0FF) return cp - 0xE000;
  if (cp >= 0xE100 && cp <= 0xE1FF) return cp - 0xE100;
  return UNICODE_TO_PETSCII.get(char) || 0x20;
}
