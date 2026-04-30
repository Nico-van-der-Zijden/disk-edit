// ── File Info viewer ──────────────────────────────────────────────────
// Detect common C64 packers by examining the decruncher code
function detectPacker(fileData) {
  if (fileData.length < 20) return null;
  var d = fileData;

  // Check for BASIC SYS line first
  var loadAddr = d[0] | (d[1] << 8);
  if (loadAddr !== 0x0801) return null;

  // Parse SYS address from BASIC line
  // Format: [next_ptr_lo] [next_ptr_hi] [line_lo] [line_hi] [token...] [0x00]
  // SYS token = 0x9E, followed by address digits
  var sysAddr = 0;
  var pos = 2; // skip load address
  // Skip next-line pointer (2 bytes) and line number (2 bytes)
  pos += 4;
  // Find SYS token (0x9E)
  var foundSys = false;
  while (pos < Math.min(d.length, 40)) {
    if (d[pos] === 0x9E) { foundSys = true; pos++; break; }
    if (d[pos] === 0x00) break;
    pos++;
  }
  if (foundSys) {
    // Skip spaces
    while (pos < d.length && d[pos] === 0x20) pos++;
    // Parse decimal digits
    var digits = '';
    while (pos < d.length && d[pos] >= 0x30 && d[pos] <= 0x39) {
      digits += String.fromCharCode(d[pos]);
      pos++;
    }
    sysAddr = parseInt(digits, 10) || 0;
  }
  if (!sysAddr) return { sysAddr: 0, packer: null };

  // restore64-scanners.js carries the full 377-packer signature database;
  // ask it first.
  if (typeof detectPackerRestore64 === 'function') {
    var r64 = detectPackerRestore64(d);
    if (r64 && r64.name) {
      var versionStr = r64.name + (r64.version ? ' ' + r64.version : '');
      return { sysAddr: sysAddr, packer: versionStr };
    }
  }

  // Generic heuristic: if the SYS target lies past the standard BASIC stub
  // and starts with SEI / JMP / LDA, it's almost certainly a decruncher
  // restore64 didn't recognise.
  var sysOff = sysAddr - loadAddr + 2; // +2 for the load address bytes
  if (sysAddr > 0x080D && sysOff > 0 && sysOff < d.length) {
    var b = d[sysOff];
    if (b === 0x78 || b === 0x4C || b === 0xA9) {
      return { sysAddr: sysAddr, packer: 'Packed (unknown)' };
    }
  }

  return { sysAddr: sysAddr, packer: null };
}

function showFileInfo(entryOff) {
  if (!currentBuffer) return;
  var data = new Uint8Array(currentBuffer);
  var typeByte = data[entryOff + 2];
  var typeIdx = typeByte & 0x07;
  var closed = (typeByte & 0x80) !== 0;
  var locked = (typeByte & 0x40) !== 0;
  var typeName = FILE_TYPES[typeIdx] || '???';
  var name = petsciiToReadable(readPetsciiString(data, entryOff + 5, 16)).trim();
  var blocks = data[entryOff + 30] | (data[entryOff + 31] << 8);
  var startTrack = data[entryOff + 3];
  var startSector = data[entryOff + 4];

  var addr = getFileAddresses(currentBuffer, entryOff);
  var result = readFileData(currentBuffer, entryOff);
  var fileData = result.data;

  var lines = [];
  lines.push('Type: ' + typeName + (closed ? '' : ' (scratched)') + (locked ? ' (locked)' : ''));
  lines.push('Blocks: ' + blocks);
  lines.push('Size: ' + fileData.length + ' bytes');
  lines.push('Start T:$' + hex8(startTrack) + ' S:$' + hex8(startSector));

  if (addr) {
    lines.push('Load: $' + hex16(addr.start) + ' - $' + hex16(addr.end));
  }

  // PRG-specific: SYS line and packer detection
  if (typeIdx === 2 && fileData.length >= 10) {
    var loadAddr = fileData[0] | (fileData[1] << 8);
    if (loadAddr === 0x0801) {
      var packerInfo = detectPacker(fileData);
      if (packerInfo) {
        if (packerInfo.sysAddr) {
          lines.push('SYS: ' + packerInfo.sysAddr + ' ($' + hex16(packerInfo.sysAddr) + ')');
        }
        if (packerInfo.packer) {
          lines.push('Packer: ' + packerInfo.packer);
        }
      }
    }

    // Check for BASIC program
    if (isBasicProgram(fileData)) {
      var basic = detokenizeBasic(fileData);
      if (basic && basic.lines.length > 0) {
        lines.push('BASIC: ' + basic.lines.length + ' line(s), ' + basic.version);
      }
    }
  }

  // Graphics format detection
  var gfxMatches = detectGfxFormats(fileData);
  if (gfxMatches.length > 0) {
    var exact = gfxMatches.filter(function(m) {
      for (var i = 0; i < GFX_FORMATS.length; i++) {
        if (GFX_FORMATS[i].name === m.name) return true;
      }
      return false;
    });
    if (exact.length > 0) {
      lines.push('Graphics: ' + exact.map(function(m) { return m.name; }).join(', '));
    }
  }

  showModal('File Info \u2014 "' + name + '"', lines);
}

