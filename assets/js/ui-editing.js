// ── Inline editing ────────────────────────────────────────────────────
function bindEditableFields() {
  document.querySelectorAll('.editable').forEach(el => {
    el.addEventListener('dblclick', () => startEditing(el));
  });
}

function startEditing(el) {
  if (isTapeFormat()) return;
  if (el.classList.contains('editing')) return;
  if (el.querySelector('input')) return;
  cancelActiveEdits();
  const field = el.dataset.field;
  const maxLen = parseInt(el.dataset.max, 10);
  // Read actual content from buffer (stops at 0xA0 padding)
  let currentValue = '';
  if (currentBuffer) {
    const data = new Uint8Array(currentBuffer);
    var headerOff = getHeaderOffset();
    if (field === 'name') currentValue = readPetsciiString(data, headerOff + currentFormat.nameOffset, currentFormat.nameLength);
    else if (field === 'id') currentValue = readPetsciiString(data, headerOff + currentFormat.idOffset, currentFormat.idLength, false);
  } else {
    const isEmpty = el.classList.contains('empty');
    currentValue = isEmpty ? '' : el.textContent;
  }

  const input = document.createElement('input');
  input.type = 'text';
  input.maxLength = maxLen;
  input.value = currentValue;
  input.className = 'header-input';
  input.style.width = (maxLen + 1) + 'ch';

  el.textContent = '';
  el.appendChild(input);
  el.classList.add('editing');
  el.classList.remove('empty');
  trackCursorPos(input);
  input.focus();
  input.selectionStart = input.selectionEnd = currentValue.length;

  showPetsciiPicker(input, maxLen);

  function setDisplay(value) {
    el.classList.remove('empty');
    if (field === 'name') {
      el.textContent = '"' + value.padEnd(16) + '"';
    } else {
      el.textContent = value;
    }
  }

  let reverted = false;

  function cleanup() {
    el.classList.remove('editing');
    hidePetsciiPicker();
  }

  async function commitEdit() {
    if (reverted) return;
    let value = filterC64Input(input.value, maxLen);
    if (currentBuffer) {
      pushUndo();
      if (field === 'name') writeDiskName(currentBuffer, value, input._petsciiOverrides);
      else if (field === 'id') writeDiskId(currentBuffer, value, input._petsciiOverrides);

      // For formats with linked subdirs, offer to update subdirectory headers
      if (field === 'id' && currentFormat.subdirLinked && !currentPartition) {
        var subdirCount = countLinkedSubdirs(currentBuffer);
        if (subdirCount > 0) {
          var choice = await showChoiceModal(
            'Update Subdirectories',
            subdirCount + ' subdirector' + (subdirCount === 1 ? 'y' : 'ies') + ' found. Update ' + (subdirCount === 1 ? 'its' : 'their') + ' ID to match?',
            [
              { label: 'No', value: 'no', secondary: true },
              { label: 'Yes', value: 'yes' }
            ]
          );
          if (choice === 'yes') {
            updateLinkedSubdirIds(currentBuffer);
          }
        }
      }
    }
    cleanup();
    setDisplay(value);
  }

  function revert() {
    reverted = true;
    cleanup();
    setDisplay(currentValue);
  }

  input.addEventListener('blur', () => {
    if (pickerClicking) { input.focus(); input.selectionStart = input.selectionEnd = input._lastCursorPos || 0; return; }
    commitEdit();
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); commitEdit(); }
    else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); revert(); }
  });
}

// escHtml is defined in cbm-format.js

// ── Save helpers ──────────────────────────────────────────────────────
function getSaveBuffer() {
  return currentBuffer;
}

function getSaveFileName() {
  return currentFileName;
}

function downloadD64(buffer, fileName) {
  const blob = new Blob([buffer], { type: 'application/octet-stream' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = fileName;
  a.click();
  URL.revokeObjectURL(a.href);
}

function updateMenuState() {
  const hasDisk = currentBuffer !== null;
  const tape = isTapeFormat();
  document.getElementById('opt-close').classList.toggle('disabled', !hasDisk);
  document.getElementById('opt-close-all').classList.toggle('disabled', tabs.length === 0);
  var activeTab = activeTabId !== null ? tabs.find(function(t) { return t.id === activeTabId; }) : null;
  document.getElementById('opt-change-partition').classList.toggle('disabled', true); // CMD container support removed
  document.getElementById('opt-save').classList.toggle('disabled', !hasDisk || !currentFileName || tape);
  document.getElementById('opt-save-as').classList.toggle('disabled', !hasDisk || tape);
  document.getElementById('opt-validate').classList.toggle('disabled', !hasDisk || tape);
  document.getElementById('opt-show-deleted').classList.toggle('disabled', !hasDisk || tape);
  document.getElementById('opt-sort').classList.toggle('disabled', !hasDisk || tape);
  document.getElementById('opt-edit-free').classList.toggle('disabled', !hasDisk || tape);
  document.getElementById('opt-recalc-free').classList.toggle('disabled', !hasDisk || tape);
  document.getElementById('opt-view-bam').classList.toggle('disabled', !hasDisk || tape);
  document.getElementById('opt-view-errors').classList.toggle('disabled', !hasDisk || tape || !hasErrorBytes(currentBuffer));
  document.getElementById('opt-convert-geos').classList.toggle('disabled', !hasDisk || tape || hasGeosSignature(currentBuffer));
  document.getElementById('opt-scan-orphans').classList.toggle('disabled', !hasDisk || tape);
  document.getElementById('opt-compact-dir').classList.toggle('disabled', !hasDisk || tape);
  document.getElementById('opt-file-chains').classList.toggle('disabled', !hasDisk || tape);
  document.getElementById('opt-unzip').classList.toggle('disabled', !hasDisk || tape);
  document.getElementById('opt-undo').classList.toggle('disabled', undoStack.length === 0 || tape);
  document.getElementById('opt-fill-free').classList.toggle('disabled', !hasDisk || tape);
  document.getElementById('opt-optimize').classList.toggle('disabled', !hasDisk || tape);
  document.getElementById('opt-export-all').classList.toggle('disabled', !hasDisk);
  document.getElementById('opt-export-txt').classList.toggle('disabled', !hasDisk);
  document.getElementById('opt-export-csv').classList.toggle('disabled', !hasDisk);
  document.getElementById('opt-export-html-dir').classList.toggle('disabled', !hasDisk);
  document.getElementById('opt-export-png-dir').classList.toggle('disabled', !hasDisk);
  document.getElementById('opt-md5').classList.toggle('disabled', !hasDisk);
  document.getElementById('opt-compare').classList.toggle('disabled', !hasDisk || tape);
  document.getElementById('opt-disk-tools').classList.toggle('disabled', !hasDisk || tape);
  document.getElementById('opt-disk-export').classList.toggle('disabled', !hasDisk);
  document.getElementById('opt-find').classList.toggle('disabled', !hasDisk);
  document.getElementById('opt-find-tabs').classList.toggle('disabled', tabs.length === 0);
  document.getElementById('opt-goto-sector').classList.toggle('disabled', !hasDisk || tape);
}

// ── Menu logic ────────────────────────────────────────────────────────
const fileInput = document.getElementById('file-input');
const menubarEl = document.querySelector('.menubar');
const menuItems = Array.from(document.querySelectorAll('.menu-item'));
const optAlign = document.getElementById('opt-align');
let openMenu = null;

var menuFocused = null;   // currently focused .option element
var menuSubmenu = null;   // currently open submenu forced by keyboard
var menuSubmenuStack = []; // stack for nested submenus
var menuKeyNav = false;   // true once keyboard navigation takes over

function clearMenuFocus() {
  if (menuFocused) menuFocused.classList.remove('menu-focused');
  menuFocused = null;
}

function closeSubmenu() {
  for (var si = 0; si < menuSubmenuStack.length; si++) menuSubmenuStack[si].style.display = '';
  if (menuSubmenu) menuSubmenu.style.display = '';
  menuSubmenu = null;
  menuSubmenuStack = [];
}

function setMenuFocus(opt) {
  if (menuFocused) menuFocused.classList.remove('menu-focused');
  if (!opt) { menuFocused = null; return; }
  menuFocused = opt;
  opt.classList.add('menu-focused');
  opt.scrollIntoView({ block: 'nearest' });
}

function getVisibleOptions(container) {
  if (!container) return [];
  return Array.from(container.querySelectorAll(':scope > .option:not(.disabled)'));
}

function openTopMenu(menu) {
  clearMenuFocus();
  closeSubmenu();
  if (openMenu) openMenu.classList.remove('open');
  menu.classList.add('open');
  menubarEl.classList.add('menu-active');
  openMenu = menu;
  // When keyboard-driven, disable hover so mouse position doesn't interfere
  if (menuKeyNav) {
    menubarEl.classList.add('menu-keynav');
  }
}

function closeMenus() {
  clearMenuFocus();
  closeSubmenu();
  menuItems.forEach(m => m.classList.remove('open'));
  menubarEl.classList.remove('menu-active', 'menu-keynav');
  openMenu = null;
  menuKeyNav = false;
}

menuItems.forEach(menu => {
  menu.addEventListener('click', (e) => {
    e.stopPropagation();
    closeContextMenu();
    if (openMenu === menu) {
      closeMenus();
    } else {
      menuKeyNav = false;
      openTopMenu(menu);
    }
  });
  menu.addEventListener('mouseenter', () => {
    if (openMenu && openMenu !== menu && !menuKeyNav) {
      openTopMenu(menu);
    }
  });
});

// Clear keyboard focus when mouse moves over options (only in mouse mode)
document.querySelectorAll('.menu-dropdown .option').forEach(opt => {
  opt.addEventListener('mouseenter', () => {
    if (!menuKeyNav) clearMenuFocus();
  });
});

// Flip submenus that overflow the viewport
function adjustSubmenu(sub) {
  sub.classList.remove('flip-left', 'flip-up');
  requestAnimationFrame(function() {
    var rect = sub.getBoundingClientRect();
    if (rect.right > window.innerWidth) sub.classList.add('flip-left');
    if (rect.bottom > window.innerHeight) sub.classList.add('flip-up');
  });
}

// Adjust submenus in menubar and context menu (use delegation for cloned context menu)
document.querySelectorAll('.has-submenu').forEach(function(item) {
  item.addEventListener('mouseenter', function() {
    var sub = item.querySelector('.submenu');
    if (sub) adjustSubmenu(sub);
  });
});


document.addEventListener('click', () => {
  closeMenus();
});

// Mouse movement exits keynav mode so hover works naturally again
menubarEl.addEventListener('mousemove', () => {
  if (menuKeyNav) {
    menuKeyNav = false;
    menubarEl.classList.remove('menu-keynav');
  }
});

// Keyboard navigation for menus
document.addEventListener('keydown', (e) => {
  if (!openMenu) return;
  if (['ArrowDown','ArrowUp','ArrowLeft','ArrowRight','Enter','Escape'].indexOf(e.key) < 0) return;

  e.preventDefault();
  menuKeyNav = true;
  menubarEl.classList.add('menu-keynav');

  var inSubmenu = menuSubmenu && menuSubmenu.style.display === 'block';
  var container = inSubmenu ? menuSubmenu : openMenu.querySelector('.menu-dropdown');
  var opts = getVisibleOptions(container);
  var idx = menuFocused ? opts.indexOf(menuFocused) : -1;

  if (e.key === 'ArrowDown') {
    if (opts.length === 0) return;
    setMenuFocus(opts[idx + 1 < opts.length ? idx + 1 : 0]);

  } else if (e.key === 'ArrowUp') {
    if (opts.length === 0) return;
    setMenuFocus(opts[idx - 1 >= 0 ? idx - 1 : opts.length - 1]);

  } else if (e.key === 'ArrowRight') {
    // If focused item has a submenu, enter it
    if (menuFocused && menuFocused.classList.contains('has-submenu') && !menuFocused.classList.contains('disabled')) {
      var sub = menuFocused.querySelector('.submenu');
      if (sub) {
        var subOpts = getVisibleOptions(sub);
        if (subOpts.length > 0) {
          // Push current submenu onto stack (if any) and open nested one
          if (menuSubmenu) menuSubmenuStack.push(menuSubmenu);
          sub.style.display = 'block';
          menuSubmenu = sub;
          adjustSubmenu(sub);
          setMenuFocus(subOpts[0]);
          return;
        }
      }
    }
    // Otherwise switch to next top-level menu
    var menus = menuItems;
    var mi = menus.indexOf(openMenu);
    openTopMenu(menus[(mi + 1) % menus.length]);

  } else if (e.key === 'ArrowLeft') {
    if (inSubmenu) {
      // Close current submenu, go back to parent
      var savedContainer = container;
      menuSubmenu.style.display = '';
      menuSubmenu = menuSubmenuStack.length > 0 ? menuSubmenuStack.pop() : null;
      // Find parent container and re-focus the has-submenu item
      var parentContainer = menuSubmenu || openMenu.querySelector('.menu-dropdown');
      var parentOpts = getVisibleOptions(parentContainer);
      var parentItem = parentOpts.find(function(o) {
        return o.classList.contains('has-submenu') && o.contains(savedContainer);
      });
      if (parentItem) setMenuFocus(parentItem);
    } else {
      // Switch to previous top-level menu
      var menus2 = menuItems;
      var mi2 = menus2.indexOf(openMenu);
      openTopMenu(menus2[(mi2 - 1 + menus2.length) % menus2.length]);
    }

  } else if (e.key === 'Enter') {
    if (!menuFocused) return;
    if (menuFocused.classList.contains('has-submenu') && !menuFocused.classList.contains('disabled')) {
      var sub2 = menuFocused.querySelector('.submenu');
      if (sub2) {
        var subOpts2 = getVisibleOptions(sub2);
        if (subOpts2.length > 0) {
          if (menuSubmenu) menuSubmenuStack.push(menuSubmenu);
          sub2.style.display = 'block';
          menuSubmenu = sub2;
          adjustSubmenu(sub2);
          setMenuFocus(subOpts2[0]);
        }
      }
    } else {
      menuFocused.click();
    }

  } else if (e.key === 'Escape') {
    if (inSubmenu) {
      var savedContainer2 = container;
      closeSubmenu();
      var parentOpts2 = getVisibleOptions(openMenu.querySelector('.menu-dropdown'));
      var parentItem2 = parentOpts2.find(function(o) {
        return o.classList.contains('has-submenu') && o.contains(savedContainer2);
      });
      if (parentItem2) setMenuFocus(parentItem2);
    } else {
      closeMenus();
    }
  }
});

// ── Tab bar rendering ────────────────────────────────────────────────
function renderTabs() {
  // Sync active tab's dirty state before rendering
  if (activeTabId !== null) {
    var activeTab = tabs.find(function(t) { return t.id === activeTabId; });
    if (activeTab) activeTab.dirty = tabDirty;
  }
  var bar = document.getElementById('tab-bar');
  var html = '';
  for (var i = 0; i < tabs.length; i++) {
    var t = tabs[i];
    var cls = 'tab';
    if (t.id === activeTabId) cls += ' active';
    var isTape = t.format === DISK_FORMATS.t64 || t.format === DISK_FORMATS.tap;
    if (isTape) cls += ' tab-tape';
    if (t.dirty) cls += ' tab-dirty';
    var label = (t.dirty ? '* ' : '') + (isTape ? '<span class="tab-tape-badge">TAPE</span> ' : '') + escHtml(t.name);
    html += '<div class="' + cls + '" data-tab-id="' + t.id + '">' +
      '<span class="tab-name" title="' + escHtml(t.name) + '">' + label + '</span>' +
      '<span class="tab-close" data-tab-close="' + t.id + '"><i class="fa-solid fa-xmark"></i></span>' +
    '</div>';
  }
  bar.innerHTML = html;

  // Tab click handlers
  bar.querySelectorAll('.tab').forEach(function(el) {
    el.addEventListener('click', function(e) {
      if (e.target.closest('.tab-close')) return;
      switchToTab(parseInt(el.dataset.tabId, 10));
    });
  });
  bar.querySelectorAll('.tab-close').forEach(function(el) {
    el.addEventListener('click', function(e) {
      e.stopPropagation();
      closeTab(parseInt(el.dataset.tabClose, 10));
    });
  });

  // Update browser tab title
  var activeTab = tabs.find(function(t) { return t.id === activeTabId; });
  if (activeTab) {
    document.title = (activeTab.dirty ? '* ' : '') + activeTab.name + ' \u2014 CBM Disk Editor';
  } else {
    document.title = 'CBM Disk Editor';
  }
}

document.querySelectorAll('#opt-new .option[data-format]').forEach(el => {
  el.addEventListener('click', async (e) => {
    e.stopPropagation();
    closeMenus();
    saveActiveTab();
    var tracks = parseInt(el.dataset.tracks, 10);
    const formatKey = el.dataset.format;

    // DNP: prompt for number of tracks
    if (formatKey === 'dnp') {
      var tracksStr = await showInputModal('Number of tracks (2 - 255)', '255');
      if (tracksStr === null) return;
      tracks = parseInt(tracksStr, 10);
      if (isNaN(tracks) || tracks < 2 || tracks > 255) {
        showModal('New DNP', ['Invalid number. Enter 2 to 255.']);
        return;
      }
    }

    var buf = createEmptyDisk(formatKey, tracks);
    if (!buf) return;
    var fname = null;

    currentBuffer = buf;
    currentFileName = fname;
    currentPartition = null;
    selectedEntryIndex = -1;
    newDiskCount++;
    var tabName = fname || 'New Disk ' + newDiskCount;
    var tab = createTab(tabName, buf, fname);
    activeTabId = tab.id;
    const info = parseDisk(buf);
    renderDisk(info);
    renderTabs();
    updateMenuState();
  });
});

document.getElementById('opt-open').addEventListener('click', (e) => {
  e.stopPropagation();
  closeMenus();
  fileInput.click();
});

// Empty state: shown when no disk is open
function showEmptyState() {
  var content = document.getElementById('content');
  content.innerHTML =
    '<div class="empty-state"><div class="empty-drop-zone">' +
      '<div style="margin-bottom:12px"><i class="fa-solid fa-file-arrow-down" style="font-size:28px;color:var(--border)"></i></div>' +
      '<div style="margin-bottom:16px">No disk loaded.</div>' +
      'Create a <a href="#" id="empty-new">new</a> disk or <a href="#" id="empty-open">open</a> a disk image.<br>' +
      'Drop disk images anywhere on this page.' +
    '</div></div>';
  document.getElementById('empty-new').addEventListener('click', function(e) {
    e.preventDefault();
    e.stopPropagation();
    // Open the Disk menu with New submenu visible and first option focused
    var diskMenu = document.querySelector('.menu-item');
    closeMenus();
    diskMenu.classList.add('open');
    menubarEl.classList.add('menu-active');
    openMenu = diskMenu;
    var newItem = document.getElementById('opt-new');
    var submenu = newItem.querySelector('.submenu');
    submenu.style.display = 'block';
    menuSubmenu = submenu;
    adjustSubmenu(submenu);
    var firstOpt = submenu.querySelector('.option');
    setMenuFocus(firstOpt);
  });
  document.getElementById('empty-open').addEventListener('click', function(e) {
    e.preventDefault();
    fileInput.click();
  });
}

showEmptyState();

document.getElementById('opt-close').addEventListener('click', (e) => {
  e.stopPropagation();
  if (!currentBuffer) return;
  closeMenus();
  if (activeTabId !== null) {
    closeTab(activeTabId);
  }
});

document.getElementById('opt-close-all').addEventListener('click', (e) => {
  e.stopPropagation();
  if (tabs.length === 0) return;
  closeMenus();
  while (tabs.length > 0) {
    tabs.pop();
  }
  activeTabId = null;
  currentBuffer = null;
  currentFileName = null;
  selectedEntryIndex = -1;
  currentPartition = null;
  showEmptyState();
  renderTabs();
  updateMenuState();
  updateEntryMenuState();
});

document.getElementById('opt-change-partition').addEventListener('click', async (e) => {
  e.stopPropagation();
  closeMenus();
  // CMD container support removed (DHD too large for browser use)
  renderTabs();
  updateMenuState();
});

document.getElementById('opt-save').addEventListener('click', (e) => {
  e.stopPropagation();
  if (!currentBuffer || !currentFileName) return;
  closeMenus();
  downloadD64(getSaveBuffer(), getSaveFileName());
  tabDirty = false;
  renderTabs();
});

document.getElementById('opt-save-as').addEventListener('click', async (e) => {
  e.stopPropagation();
  if (!currentBuffer) return;
  closeMenus();
  var ext = currentFormat.ext || '.d64';
  var tab = getActiveTab();
  var baseName = currentFileName || (tab && tab.name) || 'disk';
  var defaultName = baseName.endsWith(ext) ? baseName : baseName + ext;
  const fileName = await showInputModal('Save As', defaultName);
  if (!fileName) return;
  {
    currentFileName = fileName.endsWith(ext) ? fileName : fileName + ext;
    downloadD64(currentBuffer, currentFileName);
  }
  tabDirty = false;
  updateTabName();
  updateMenuState();
});

document.getElementById('opt-validate').addEventListener('click', (e) => {
  e.stopPropagation();
  if (!currentBuffer) return;
  closeMenus();
  pushUndo();
  var log;
  if (currentPartition && !currentPartition.dnpDir) {
    log = validatePartition(currentBuffer, currentPartition.startTrack, currentPartition.partSize);
  } else {
    log = validateDisk(currentBuffer);
  }
  const info = parseCurrentDir(currentBuffer);
  renderDisk(info);
  showModal('Validate', log);
});

document.getElementById('opt-show-deleted').addEventListener('click', (e) => {
  e.stopPropagation();
  if (!currentBuffer) return;
  closeMenus();
  showDeleted = !showDeleted;
  localStorage.setItem('cbm-showDeleted', showDeleted);
  document.getElementById('check-deleted').innerHTML = showDeleted ? '<i class="fa-solid fa-check"></i>' : '';
  const info = parseCurrentDir(currentBuffer);
  renderDisk(info);
});

