// ── Search ────────────────────────────────────────────────────────────
// Parse hex string like "$A0 FF", "A0FF", "$A0$FF" into byte array, or null if not hex
function parseHexSearch(term) {
  var cleaned = term.replace(/[\s\$,]/g, '');
  if (cleaned.length === 0 || cleaned.length % 2 !== 0) return null;
  if (!/^[0-9A-Fa-f]+$/.test(cleaned)) return null;
  // Only treat as hex if it looks intentional: has $ prefix, spaces between pairs, or all hex with even length
  var looksHex = term.indexOf('$') >= 0 || /^[0-9A-Fa-f]{2}(\s+[0-9A-Fa-f]{2})+$/.test(term.trim()) ||
    (cleaned.length >= 2 && cleaned.length <= 512 && /^[0-9A-Fa-f]+$/.test(cleaned) && !/^[A-Za-z]+$/.test(cleaned));
  if (!looksHex) return null;
  var bytes = [];
  for (var i = 0; i < cleaned.length; i += 2) {
    bytes.push(parseInt(cleaned.substring(i, i + 2), 16));
  }
  return bytes;
}

function searchDisk(buffer, format, numTracks, term, scope) {
  var data = new Uint8Array(buffer);
  var results = [];
  if (!term || term.length === 0) return results;

  // Try hex pattern first
  var hexBytes = parseHexSearch(term);
  var isHex = hexBytes !== null;

  var termBytes, termPetscii;
  if (isHex) {
    termBytes = hexBytes;
    termPetscii = hexBytes; // exact byte match for hex
  } else {
    // Convert search term to byte array (try PETSCII and ASCII)
    var termUpper = term.toUpperCase();
    termBytes = [];
    for (var ti = 0; ti < term.length; ti++) termBytes.push(term.charCodeAt(ti));
    termPetscii = [];
    for (var tp = 0; tp < termUpper.length; tp++) {
      var ch = termUpper.charCodeAt(tp);
      if (ch >= 0x41 && ch <= 0x5A) termPetscii.push(ch);
      else if (ch >= 0x20 && ch <= 0x3F) termPetscii.push(ch);
      else termPetscii.push(ch);
    }
  }

  // Determine which sectors to search based on scope
  var dirTrack = format.dirTrack || format.bamTrack;

  for (var t = 1; t <= numTracks; t++) {
    var spt = format.sectorsPerTrack(t);
    for (var s = 0; s < spt; s++) {
      var off = getTrackOffsets(format, numTracks)[t] + s * 256;
      if (off < 0 || off + 256 > data.length) continue;

      if (scope === 'filename') {
        if (t !== dirTrack) continue;
        for (var ei = 0; ei < format.entriesPerSector; ei++) {
          var eo = off + ei * format.entrySize;
          var nameOff = eo + 5;
          var mPos = matchBytesAt(data, nameOff, 16, termBytes, termPetscii);
          if (mPos >= 0) {
            var cp = buildContextParts(data, nameOff, 16, nameOff + mPos, termBytes.length);
            results.push({ track: t, sector: s, offset: nameOff - off + mPos, petParts: cp.petParts });
          }
        }
      } else if (scope === 'header') {
        if (t !== format.bamTrack) continue;
        var hOff = off + format.nameOffset;
        var mPos2 = matchBytesAt(data, hOff, format.nameLength, termBytes, termPetscii);
        if (mPos2 >= 0) {
          var cp2 = buildContextParts(data, hOff, format.nameLength, hOff + mPos2, termBytes.length);
          results.push({ track: t, sector: s, offset: format.nameOffset + mPos2, petParts: cp2.petParts });
        }
      } else if (scope === 'id') {
        if (t !== format.bamTrack) continue;
        var idOff = off + format.idOffset;
        var mPos3 = matchBytesAt(data, idOff, format.idLength, termBytes, termPetscii);
        if (mPos3 >= 0) {
          var cp3 = buildContextParts(data, idOff, format.idLength, idOff + mPos3, termBytes.length);
          results.push({ track: t, sector: s, offset: format.idOffset + mPos3, petParts: cp3.petParts });
        }
      } else {
        // Search all bytes in sector
        var matches = findAllInSector(data, off, 256, termBytes, termPetscii);
        for (var mi = 0; mi < matches.length; mi++) {
          results.push({ track: t, sector: s, offset: matches[mi].offset, context: matches[mi].context });
        }
      }
    }
  }
  return results;
}

function matchBytesAt(data, offset, len, termAscii, termPetscii) {
  if (offset + termAscii.length > data.length) return -1;
  if (termAscii.length > len) return -1;
  for (var pos = 0; pos <= len - termAscii.length; pos++) {
    var matchA = true, matchP = true;
    for (var i = 0; i < termAscii.length; i++) {
      var b = data[offset + pos + i];
      if (b !== termAscii[i]) matchA = false;
      if (b !== termPetscii[i]) matchP = false;
      if (!matchA && !matchP) break;
    }
    if (matchA || matchP) return pos;
  }
  return -1;
}


function findAllInSector(data, sectorOff, len, termAscii, termPetscii) {
  var results = [];
  for (var pos = 0; pos <= len - termAscii.length; pos++) {
    var matchA = true, matchP = true;
    for (var i = 0; i < termAscii.length; i++) {
      var b = data[sectorOff + pos + i];
      if (b !== termAscii[i]) matchA = false;
      if (b !== termPetscii[i]) matchP = false;
      if (!matchA && !matchP) break;
    }
    if (matchA || matchP) {
      var ctxStart = Math.max(0, pos - 4);
      var ctxEnd = Math.min(len, pos + termAscii.length + 4);
      var petParts = [];
      for (var ci = ctxStart; ci < ctxEnd; ci++) {
        var cb = data[sectorOff + ci];
        var isMatch = (ci >= pos && ci < pos + termAscii.length);
        petParts.push({ ch: byteToDisplayChar(cb), match: isMatch });
      }
      results.push({ offset: pos, petParts: petParts });
      pos += termAscii.length - 1; // skip past match
    }
  }
  return results;
}

// Convert byte to a displayable character (ASCII-safe, no PUA/C64 glyphs)
function byteToDisplayChar(b) {
  if (b >= 0x20 && b <= 0x7E) return String.fromCharCode(b); // printable ASCII
  if (b >= 0x41 && b <= 0x5A) return String.fromCharCode(b); // A-Z
  if (b >= 0xC1 && b <= 0xDA) return String.fromCharCode(b - 0x80); // PETSCII uppercase → A-Z
  if (b >= 0x61 && b <= 0x7A) return String.fromCharCode(b - 0x20); // PETSCII shifted lowercase → A-Z
  return '\u00B7'; // middle dot for non-printable
}

function buildContextParts(data, startOff, len, matchOff, matchLen) {
  var petParts = [];
  for (var i = 0; i < len; i++) {
    var b = data[startOff + i];
    if (b === 0xA0) continue; // skip PETSCII padding
    var isMatch = (startOff + i >= matchOff && startOff + i < matchOff + matchLen);
    petParts.push({ ch: byteToDisplayChar(b), match: isMatch });
  }
  return { petParts: petParts };
}

function showSearchModal(title, allTabs) {
  closeMenus();
  document.getElementById('modal-title').textContent = title;
  var body = document.getElementById('modal-body');
  body.innerHTML = '';

  // Search form
  var form = document.createElement('div');
  form.className = 'search-form';

  var row = document.createElement('div');
  row.className = 'search-row';

  var input = document.createElement('input');
  input.type = 'text';
  input.placeholder = 'Text or hex ($A0 FF)...';
  input.id = 'search-input';
  row.appendChild(input);

  var searchBtn = document.createElement('button');
  searchBtn.textContent = 'Search';
  searchBtn.id = 'search-go';
  row.appendChild(searchBtn);

  form.appendChild(row);

  var scopeRow = document.createElement('div');
  scopeRow.className = 'search-scopes';
  var scopes = [['all', 'All sectors'], ['filename', 'Filenames'], ['header', 'Disk name'], ['id', 'Disk ID']];
  for (var si = 0; si < scopes.length; si++) {
    var label = document.createElement('label');
    var radio = document.createElement('input');
    radio.type = 'radio';
    radio.name = 'search-scope';
    radio.value = scopes[si][0];
    if (si === 0) radio.checked = true;
    label.appendChild(radio);
    label.appendChild(document.createTextNode(scopes[si][1]));
    scopeRow.appendChild(label);
  }
  form.appendChild(scopeRow);

  var layout = document.createElement('div');
  layout.className = 'search-layout';
  layout.appendChild(form);

  var resultsDiv = document.createElement('div');
  resultsDiv.className = 'search-results';
  resultsDiv.id = 'search-results';
  layout.appendChild(resultsDiv);

  body.appendChild(layout);

  function doSearch() {
    var term = input.value;
    var scopeRadio = form.querySelector('input[name="search-scope"]:checked');
    var scope = scopeRadio ? scopeRadio.value : 'all';
    resultsDiv.innerHTML = '';

    if (!term) return;

    // Show spinner while searching
    resultsDiv.innerHTML = '<div class="search-spinner"><i class="fa-solid fa-spinner fa-spin"></i> Searching...</div>';
    searchBtn.disabled = true;

    // Determine byte length of search term for highlighting
    var hexParsed = parseHexSearch(term);
    var searchByteLen = hexParsed ? hexParsed.length : term.length;

    // Defer to let spinner render
    setTimeout(function() {
      resultsDiv.innerHTML = '';

      if (allTabs) {
        saveActiveTab();
        var totalResults = 0;
        for (var ti = 0; ti < tabs.length; ti++) {
          var tab = tabs[ti];
          var prevBuffer = currentBuffer;
          var prevFormat = currentFormat;
          var prevTracks = currentTracks;
          currentBuffer = tab.buffer;
          currentFormat = tab.format;
          currentTracks = tab.tracks;

          var results = searchDisk(tab.buffer, tab.format, tab.tracks, term, scope);

          currentBuffer = prevBuffer;
          currentFormat = prevFormat;
          currentTracks = prevTracks;

          if (results.length > 0) {
            var header = document.createElement('div');
            header.className = 'search-tab-header';
            header.textContent = tab.name + ' (' + results.length + ' result' + (results.length > 1 ? 's' : '') + ')';
            resultsDiv.appendChild(header);

            renderResults(resultsDiv, results, tab, searchByteLen);
            totalResults += results.length;
          }
        }
        if (totalResults === 0) {
          resultsDiv.innerHTML = '<div class="search-no-results">No results found.</div>';
        }
      } else {
        var results2 = searchDisk(currentBuffer, currentFormat, currentTracks, term, scope);
        if (results2.length === 0) {
          resultsDiv.innerHTML = '<div class="search-no-results">No results found.</div>';
        } else {
          var summary = document.createElement('div');
          summary.className = 'search-tab-header';
          summary.textContent = results2.length + ' result' + (results2.length > 1 ? 's' : '') + ' found';
          resultsDiv.appendChild(summary);
          renderResults(resultsDiv, results2, null, searchByteLen);
        }
      }
      searchBtn.disabled = false;
    }, 20);
  }

  function renderResults(container, results, targetTab, termLen) {
    // Count matches per sector for display
    var sectorCounts = {};
    for (var ci = 0; ci < results.length; ci++) {
      var key = results[ci].track + ':' + results[ci].sector;
      sectorCounts[key] = (sectorCounts[key] || 0) + 1;
    }

    for (var ri = 0; ri < results.length; ri++) {
      (function(r, tab) {
        var row = document.createElement('div');
        row.className = 'search-result';

        var sKey = r.track + ':' + r.sector;
        var tHex = r.track.toString(16).toUpperCase().padStart(2, '0');
        var sHex = r.sector.toString(16).toUpperCase().padStart(2, '0');

        var html = '<span class="search-result-ts">T:$' + tHex + ' S:$' + sHex + '</span> ';
        if (r.petParts) {
          html += '<span class="search-result-pet">';
          for (var pi = 0; pi < r.petParts.length; pi++) {
            html += escHtml(r.petParts[pi].ch);
          }
          html += '</span>';
        }
        var cnt = sectorCounts[sKey];
        html += ' <span class="search-result-pet">(' + cnt + ' occurrence' + (cnt > 1 ? 's' : '') + ')</span>';
        row.innerHTML = html;

        row.title = 'Open sector editor at T:$' + tHex + ' S:$' + sHex;
        row.addEventListener('click', function() {
          hidePetsciiPicker();
          document.getElementById('modal-overlay').classList.remove('open');
          if (tab) {
            // Switch to the target tab first
            saveActiveTab();
            loadTab(tab);
            activeTabId = tab.id;
            var info = parseCurrentDir(currentBuffer);
            renderDisk(info);
            renderTabs();
            updateMenuState();
          }
          showSectorHexEditor(r.track, r.sector, r.offset, termLen);
        });
        container.appendChild(row);
      })(results[ri], targetTab);
    }
  }

  searchBtn.addEventListener('click', function() { hidePetsciiPicker(); doSearch(); });
  input.addEventListener('keydown', function(e) {
    if (e.key === 'Enter') { e.preventDefault(); hidePetsciiPicker(); doSearch(); }
  });

  // Track cursor for PETSCII picker insertion (without intercepting keyboard)
  var updateCursor = function() { input._lastCursorPos = input.selectionStart; };
  input.addEventListener('keyup', updateCursor);
  input.addEventListener('mouseup', updateCursor);
  input.addEventListener('input', updateCursor);

  // Show picker only when search input has focus
  input.addEventListener('focus', function() {
    showPetsciiPicker(input, 255);
  });
  input.addEventListener('blur', function() {
    if (!pickerClicking) hidePetsciiPicker();
  });

  var footer = document.querySelector('#modal-overlay .modal-footer');
  footer.innerHTML = '<button id="modal-close">OK</button>';
  document.getElementById('modal-close').addEventListener('click', function() {
    hidePetsciiPicker();
    document.getElementById('modal-overlay').classList.remove('open');
  });
  document.getElementById('modal-overlay').classList.add('open');
  requestAnimationFrame(function() {
    input.focus();
  });
}

document.getElementById('opt-find').addEventListener('click', function(e) {
  e.stopPropagation();
  if (!currentBuffer) return;
  showSearchModal('Find', false);
});

document.getElementById('opt-find-tabs').addEventListener('click', function(e) {
  e.stopPropagation();
  if (tabs.length === 0) return;
  showSearchModal('Find in All Tabs', true);
});

// ── Go to Sector (Ctrl+G) ────────────────────────────────────────────
function showGoToSector() {
  closeMenus();
  document.getElementById('modal-title').textContent = 'Go to Sector';
  var body = document.getElementById('modal-body');
  body.innerHTML = '';

  var row = document.createElement('div');
  row.className = 'flex-row';

  var tLabel = document.createElement('span');
  tLabel.textContent = 'Track: $';
  row.appendChild(tLabel);

  var trackInput = createHexInput({
    value: currentFormat.bamTrack,
    maxBytes: 1,
    validate: function(v) { return v >= 1 && v <= currentTracks; }
  });
  row.appendChild(trackInput);

  var sLabel = document.createElement('span');
  sLabel.textContent = 'Sector: $';
  row.appendChild(sLabel);

  var sectorInput = createHexInput({
    value: 0,
    maxBytes: 1,
    validate: function(v) {
      var t = trackInput.getValue();
      if (t < 1 || t > currentTracks) return false;
      return v >= 0 && v < currentFormat.sectorsPerTrack(t);
    }
  });
  row.appendChild(sectorInput);

  body.appendChild(row);

  // Revalidate sector when track changes
  trackInput.addEventListener('input', function() { sectorInput.isValid(); });

  var footer = document.querySelector('#modal-overlay .modal-footer');
  footer.innerHTML =
    '<button class="modal-btn-secondary" id="goto-cancel">Cancel</button>' +
    '<button id="goto-ok">Go</button>';

  function doGo() {
    if (!trackInput.isValid() || !sectorInput.isValid()) return;
    var t = trackInput.getValue();
    var s = sectorInput.getValue();
    document.getElementById('modal-overlay').classList.remove('open');
    showSectorHexEditor(t, s);
  }

  document.getElementById('goto-ok').addEventListener('click', doGo);
  document.getElementById('goto-cancel').addEventListener('click', function() {
    document.getElementById('modal-overlay').classList.remove('open');
  });

  // Enter to confirm
  trackInput.addEventListener('keydown', function(e) { if (e.key === 'Enter') doGo(); });
  sectorInput.addEventListener('keydown', function(e) { if (e.key === 'Enter') doGo(); });

  document.getElementById('modal-overlay').classList.add('open');
  trackInput.focus();
  trackInput.select();
}

document.getElementById('opt-goto-sector').addEventListener('click', function(e) {
  e.stopPropagation();
  if (!currentBuffer || isTapeFormat()) return;
  showGoToSector();
});

document.getElementById('opt-view-hex').addEventListener('click', function(e) {
  e.stopPropagation();
  if (!currentBuffer || selectedEntryIndex < 0) return;
  closeMenus();
  showFileHexViewer(selectedEntryIndex);
});

document.getElementById('opt-view-disasm').addEventListener('click', function(e) {
  e.stopPropagation();
  if (!currentBuffer || selectedEntryIndex < 0) return;
  closeMenus();
  showFileDisasmViewer(selectedEntryIndex);
});

document.getElementById('opt-view-petscii').addEventListener('click', function(e) {
  e.stopPropagation();
  if (!currentBuffer || selectedEntryIndex < 0) return;
  closeMenus();
  showFilePetsciiViewer(selectedEntryIndex);
});

document.getElementById('opt-view-basic').addEventListener('click', function(e) {
  e.stopPropagation();
  if (!currentBuffer || selectedEntryIndex < 0) return;
  closeMenus();
  showFileBasicViewer(selectedEntryIndex);
});

document.getElementById('opt-view-tass').addEventListener('click', function(e) {
  e.stopPropagation();
  if (!currentBuffer || selectedEntryIndex < 0) return;
  closeMenus();
  showFileTassViewer(selectedEntryIndex);
});

document.getElementById('opt-view-geowrite').addEventListener('click', function(e) {
  e.stopPropagation();
  if (!currentBuffer || selectedEntryIndex < 0) return;
  closeMenus();
  showGeoWriteViewer(selectedEntryIndex);
});

document.getElementById('opt-view-vlir').addEventListener('click', function(e) {
  e.stopPropagation();
  if (!currentBuffer || selectedEntryIndex < 0) return;
  closeMenus();
  showVlirInspector(selectedEntryIndex);
});

document.getElementById('opt-view-rel').addEventListener('click', function(e) {
  e.stopPropagation();
  if (!currentBuffer || selectedEntryIndex < 0) return;
  closeMenus();
  showRelViewer(selectedEntryIndex);
});

document.getElementById('opt-view-gfx').addEventListener('click', function(e) {
  e.stopPropagation();
  if (!currentBuffer || selectedEntryIndex < 0) return;
  closeMenus();
  showFileGfxViewer(selectedEntryIndex);
});

document.getElementById('opt-edit-free').addEventListener('click', (e) => {
  e.stopPropagation();
  if (!currentBuffer) return;
  closeMenus();
  const footerBlocks = document.querySelector('.dir-footer-blocks');
  if (footerBlocks) startEditFreeBlocks(footerBlocks);
});



document.getElementById('opt-recalc-free').addEventListener('click', (e) => {
  e.stopPropagation();
  if (!currentBuffer) return;
  closeMenus();
  pushUndo();

  // Recalculate by following all file sector chains to find used sectors,
  // then rebuild the BAM free counts from scratch. Don't trust the existing BAM.
  const data = new Uint8Array(currentBuffer);
  const bamOff = sectorOffset(currentFormat.bamTrack, currentFormat.bamSector);

  // Build allocation map for all tracks
  const used = {};
  for (let t = 1; t <= currentTracks; t++) {
    used[t] = new Uint8Array(sectorsPerTrack(t));
  }

  // Track 18 sector 0 (BAM) is always used
  used[currentFormat.bamTrack][currentFormat.bamSector] = 1;

  // Mark directory chain sectors as used
  let dirT = currentFormat.dirTrack, dirS = currentFormat.dirSector;
  const dirVisited = new Set();
  while (dirT !== 0) {
    const key = `${dirT}:${dirS}`;
    if (dirVisited.has(key)) break;
    dirVisited.add(key);
    if (dirT < 1 || dirT > currentTracks || dirS < 0 || dirS >= sectorsPerTrack(dirT)) break;
    used[dirT][dirS] = 1;
    const off = sectorOffset(dirT, dirS);
    dirT = data[off];
    dirS = data[off + 1];
  }

  // Follow each closed file's sector chains (main + REL + GEOS)
  const info = parseCurrentDir(currentBuffer);
  for (const entry of info.entries) {
    if (entry.deleted) continue;
    forEachFileSector(data, entry.entryOff, function(t, s) {
      used[t][s] = 1;
    });
  }

  // Read old total
  const oldInfo = parseCurrentDir(currentBuffer);
  const oldFree = oldInfo.freeBlocks;

  // Update only the free block counts per track, leave BAM bitmaps untouched
  // BAM only covers tracks 1-35
  for (let t = 1; t <= currentFormat.bamTracksRange(currentTracks); t++) {
    if (t === currentFormat.dirTrack) continue;
    const spt = sectorsPerTrack(t);
    let free = 0;
    for (let s = 0; s < spt; s++) {
      if (!used[t][s]) free++;
    }
    currentFormat.writeTrackFree(data, bamOff, t, free);
  }

  const updatedInfo = parseCurrentDir(currentBuffer);
  renderDisk(updatedInfo);

  const newFree = updatedInfo.freeBlocks;
  if (oldFree === newFree) {
    showModal('Recalculate Blocks Free', ['Blocks free is correct: ' + newFree + '.']);
  } else {
    showModal('Recalculate Blocks Free', ['Changed from ' + oldFree + ' to ' + newFree + ' blocks free.']);
  }
});

