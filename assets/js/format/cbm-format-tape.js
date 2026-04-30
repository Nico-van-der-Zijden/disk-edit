// ── T64 tape image parser ─────────────────────────────────────────────
// parseT64 / getTapeEntry / isTapeFormat. The TAP loader (parseTAP)
// lives in cbm-tape.js with its multi-loader support (CBM ROM,
// Turbotape 250, Novaload, Cyberload F1-F4 chain, Creatures custom).
// Both share parsedT64Entries / parsedTAPEntries / parsedTapeDir
// declared at the top of cbm-format.js.
function parseT64(buffer) {
  var data = new Uint8Array(buffer);
  parsedT64Entries = {};
  parsedTAPEntries = null;
  var maxEntries = data[0x22] | (data[0x23] << 8);
  var usedEntries = data[0x24] | (data[0x25] << 8);
  var tapeName = '';
  for (var i = 0; i < 24; i++) {
    var ch = data[0x28 + i];
    if (ch === 0x00) break;
    tapeName += PETSCII_MAP[ch] || String.fromCharCode(ch);
  }

  var entries = [];
  for (var ei = 0; ei < maxEntries && ei < 256; ei++) {
    var eOff = 0x40 + ei * 32;
    if (eOff + 32 > data.length) break;
    var entryType = data[eOff];
    if (entryType === 0) continue; // empty entry
    var fileType = data[eOff + 1]; // C64 file type (1=SEQ, $82=PRG, etc.)
    var startAddr = data[eOff + 2] | (data[eOff + 3] << 8);
    var endAddr = data[eOff + 4] | (data[eOff + 5] << 8);
    var dataOffset = data[eOff + 8] | (data[eOff + 9] << 8) | (data[eOff + 10] << 16) | (data[eOff + 11] << 24);
    var name = '';
    for (var ni = 0; ni < 16; ni++) {
      var ch2 = data[eOff + 16 + ni];
      if (ch2 === 0x00) { name += PETSCII_MAP[0xA0]; continue; }
      name += PETSCII_MAP[ch2] || '?';
    }
    var dataSize = endAddr - startAddr;
    var blocks = Math.ceil(dataSize / 254);
    var typeStr = (fileType & 0x07) === 1 ? ' SEQ ' : ' PRG ';
    parsedT64Entries[eOff] = {
      t64DataOffset: dataOffset,
      t64StartAddr: startAddr,
      t64EndAddr: endAddr
    };
    entries.push({
      name: name,
      type: typeStr,
      blocks: blocks,
      deleted: false,
      entryOff: eOff,
    });
  }

  parsedTapeDir = entries;
  return {
    diskName: tapeName,
    diskId: 'T64',
    freeBlocks: 0,
    entries: entries,
    format: 'T64',
    tracks: 0
  };
}

// Look up a tape directory entry by entryOff
function getTapeEntry(entryOff) {
  if (!parsedTapeDir) return null;
  for (var i = 0; i < parsedTapeDir.length; i++) {
    if (parsedTapeDir[i].entryOff === entryOff) return parsedTapeDir[i];
  }
  return null;
}

function isTapeFormat() {
  return currentFormat === DISK_FORMATS.t64 || currentFormat === DISK_FORMATS.tap;
}
