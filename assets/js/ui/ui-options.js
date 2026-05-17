// ── File Content Viewer ───────────────────────────────────────────────

// ── Options menu ──────────────────────────────────────────────────────
document.getElementById('opt-unsafe-chars').addEventListener('click', (e) => {
  e.stopPropagation();
  closeMenus();
  allowUnsafeChars = !allowUnsafeChars;
  localStorage.setItem('cbm-allowUnsafe', allowUnsafeChars);
  document.getElementById('check-unsafe').innerHTML = allowUnsafeChars ? '<i class="fa-solid fa-check"></i>' : '';
  if (petsciiPicker.target) renderPicker();
  // The floating charset window has its own DOM — refresh its grid too
  // so disabled/unsafe cell classes stay in sync with the toggle.
  var fl = document.getElementById('petscii-float');
  if (fl && fl.classList.contains('open')) {
    fl.querySelector('.petscii-float-body').innerHTML = buildAllGridHtml();
  }
});

document.getElementById('opt-picker-all').addEventListener('click', (e) => {
  e.stopPropagation();
  closeMenus();
  petsciiPicker.defaultAll = !petsciiPicker.defaultAll;
  localStorage.setItem('cbm-pickerAll', petsciiPicker.defaultAll);
  document.getElementById('check-picker-all').innerHTML = petsciiPicker.defaultAll ? '<i class="fa-solid fa-check"></i>' : '';
});

document.getElementById('opt-picker-stick').addEventListener('click', (e) => {
  e.stopPropagation();
  closeMenus();
  petsciiPicker.stick = !petsciiPicker.stick;
  localStorage.setItem('cbm-pickerStick', petsciiPicker.stick);
  document.getElementById('check-picker-stick').innerHTML = petsciiPicker.stick ? '<i class="fa-solid fa-check"></i>' : '';
});

document.getElementById('opt-show-toolbar').addEventListener('click', (e) => {
  e.stopPropagation();
  closeMenus();
  toolbarVisible = !toolbarVisible;
  localStorage.setItem('cbm-toolbar', toolbarVisible);
  document.getElementById('check-toolbar').innerHTML = toolbarVisible ? '<i class="fa-solid fa-check"></i>' : '';
  applyToolbarVisibility();
});

document.getElementById('opt-partition-size-mib').addEventListener('click', (e) => {
  e.stopPropagation();
  closeMenus();
  partitionSizeInMib = !partitionSizeInMib;
  localStorage.setItem('cbm-partitionSizeMib', partitionSizeInMib);
  document.getElementById('check-partition-size-mib').innerHTML = partitionSizeInMib ? '<i class="fa-solid fa-check"></i>' : '';
  // Re-render whichever container view is currently visible. Both
  // refresh functions are no-ops when their globals aren't set.
  if (typeof refreshCmdContainerView === 'function') refreshCmdContainerView();
  if (typeof refreshIde64View === 'function') refreshIde64View();
});

// ── Export/Import Settings ────────────────────────────────────────────
document.getElementById('opt-export-settings').addEventListener('click', function(e) {
  e.stopPropagation();
  closeMenus();
  var settings = {};
  for (var i = 0; i < localStorage.length; i++) {
    var key = localStorage.key(i);
    if (key.indexOf('cbm-') === 0 && key !== 'cbm-customSeparators') {
      settings[key] = localStorage.getItem(key);
    }
  }
  var json = JSON.stringify(settings, null, 2);
  var blob = new Blob([json], { type: 'application/json' });
  var a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'cbm-disk-editor-settings.json';
  a.click();
  URL.revokeObjectURL(a.href);
});

// ── Export Separators ─────────────────────────────────────────────────
document.getElementById('opt-export-separators').addEventListener('click', function(e) {
  e.stopPropagation();
  closeMenus();
  if (customSeparators.length === 0) {
    showModal('Export Separators', ['No custom separators to export.']);
    return;
  }
  var json = JSON.stringify(customSeparators, null, 2);
  var blob = new Blob([json], { type: 'application/json' });
  var a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'cbm-disk-editor-separators.json';
  a.click();
  URL.revokeObjectURL(a.href);
});

// ── Import Settings / Separators (auto-detects format) ───────────────
document.getElementById('opt-import-settings').addEventListener('click', function(e) {
  e.stopPropagation();
  closeMenus();
  var input = document.createElement('input');
  input.type = 'file';
  input.accept = '.json';
  input.addEventListener('change', function() {
    var file = input.files[0];
    if (!file) return;
    var reader = new FileReader();
    reader.onload = function() {
      try {
        var parsed = JSON.parse(reader.result);
        var results = [];

        if (Array.isArray(parsed)) {
          // Separator file: array of { name, bytes }
          var added = 0;
          for (var i = 0; i < parsed.length; i++) {
            var sep = parsed[i];
            if (!sep.bytes || !Array.isArray(sep.bytes) || sep.bytes.length !== 16) continue;
            if (separatorExists(sep.bytes)) continue;
            customSeparators.push({ name: sep.name || '', bytes: sep.bytes });
            added++;
          }
          saveCustomSeparators();
          buildSepSubmenu();
          if (added > 0) results.push(added + ' separator(s) imported.');
        } else if (typeof parsed === 'object') {
          // Settings file: { "cbm-key": "value", ... }
          var settingsCount = 0;
          var sepCount = 0;
          Object.keys(parsed).forEach(function(key) {
            if (key.indexOf('cbm-') !== 0) return;
            if (key === 'cbm-customSeparators') {
              // Embedded separators in settings file
              try {
                var seps = JSON.parse(parsed[key]);
                if (Array.isArray(seps)) {
                  for (var si = 0; si < seps.length; si++) {
                    if (seps[si].bytes && Array.isArray(seps[si].bytes) && seps[si].bytes.length === 16) {
                      if (!separatorExists(seps[si].bytes)) {
                        customSeparators.push({ name: seps[si].name || '', bytes: seps[si].bytes });
                        sepCount++;
                      }
                    }
                  }
                  saveCustomSeparators();
                  buildSepSubmenu();
                }
              } catch (e2) {}
            } else {
              localStorage.setItem(key, parsed[key]);
              settingsCount++;
            }
          });
          if (settingsCount > 0) results.push(settingsCount + ' setting(s) imported.');
          if (sepCount > 0) results.push(sepCount + ' separator(s) imported.');
        }

        if (results.length === 0) {
          showModal('Import', ['No valid settings or separators found in file.']);
        } else {
          results.push('Reload the page to apply settings.');
          showModal('Import Successful', results);
        }
      } catch (err) {
        showModal('Import Error', ['Invalid file: ' + err.message]);
      }
    };
    reader.readAsText(file);
  });
  input.click();
});

