// ── Inline editing ────────────────────────────────────────────────────
function bindEditableFields() {
  document.querySelectorAll('.editable').forEach(el => {
    el.addEventListener('dblclick', () => startEditing(el));
  });
}

function startEditing(el) {
  if (isTapeFormat()) return;
  if (el.classList.contains('editing')) return;
  if (el.querySelector('.petscii-editor')) return;
  cancelActiveEdits();
  const field = el.dataset.field;
  const maxLen = parseInt(el.dataset.max, 10);

  // Read original bytes from the buffer (we'll write the exact same bytes
  // back unless the user changed them — no round-trip via unicodeToPetscii,
  // which aliases $00-$1F / $80-$9F onto $40-$5F / $C0-$DF).
  const origBytes = new Uint8Array(maxLen);
  let origLen = maxLen;
  const stopAtPadding = field === 'name';
  if (currentBuffer) {
    const data = new Uint8Array(currentBuffer);
    const headerOff = getHeaderOffset();
    const fieldOff = field === 'name' ? headerOff + currentFormat.nameOffset : headerOff + currentFormat.idOffset;
    for (let i = 0; i < maxLen; i++) {
      origBytes[i] = data[fieldOff + i];
      if (stopAtPadding && origBytes[i] === 0xA0 && origLen === maxLen) origLen = i;
    }
  } else {
    origLen = 0;
  }

  const editor = createPetsciiEditor({
    maxLen: maxLen,
    initialBytes: origBytes,
    initialLen: origLen,
    className: 'header-input'
  });
  editor.style.width = (maxLen + 1) + 'ch';

  el.textContent = '';
  el.appendChild(editor);
  el.classList.add('editing');
  el.classList.remove('empty');
  editor.focus();
  editor._setCaret(origLen);
  setTimeout(function() {
    if (document.activeElement !== editor) {
      editor.focus();
      editor._setCaret(editor._lastCursorPos);
    }
  }, 0);

  showPetsciiPicker(editor, maxLen);

  let reverted = false;

  function cleanup() {
    el.classList.remove('editing');
    hidePetsciiPicker();
  }

  function bytesEqual(a, b, len) {
    for (let i = 0; i < len; i++) { if (a[i] !== b[i]) return false; }
    return true;
  }

  async function commitEdit() {
    if (reverted) return;
    // For 'name' we pad with $A0; for 'id' we write exactly what's there
    // (id's default is space-filled, not A0-terminated).
    const padByte = field === 'name' ? 0xA0 : 0x20;
    const newBytes = editor.getBytes(maxLen, padByte);
    const changed = !bytesEqual(newBytes, origBytes, maxLen);
    if (currentBuffer && changed) {
      pushUndo();
      const data = new Uint8Array(currentBuffer);
      const headerOff = getHeaderOffset();
      const fieldOff = field === 'name' ? headerOff + currentFormat.nameOffset : headerOff + currentFormat.idOffset;
      for (let i = 0; i < maxLen; i++) data[fieldOff + i] = newBytes[i];

      if (field === 'id' && currentFormat.subdirLinked && !currentPartition) {
        const subdirCount = countLinkedSubdirs(currentBuffer);
        if (subdirCount > 0) {
          const choice = await showChoiceModal(
            'Update Subdirectories',
            subdirCount + ' subdirector' + (subdirCount === 1 ? 'y' : 'ies') + ' found. Update ' + (subdirCount === 1 ? 'its' : 'their') + ' ID to match?',
            [
              { label: 'No', value: 'no', secondary: true },
              { label: 'Yes', value: 'yes' }
            ]
          );
          if (choice === 'yes') updateLinkedSubdirIds(currentBuffer);
        }
      }
    }
    cleanup();
    // Re-render the whole disk so the header picks up rich display of any
    // reversed chars (matching how the listing renders filenames).
    if (currentBuffer) renderDisk(parseCurrentDir(currentBuffer));
  }

  function revert() {
    reverted = true;
    cleanup();
    if (currentBuffer) renderDisk(parseCurrentDir(currentBuffer));
  }

  editor.addEventListener('blur', () => {
    if (pickerClicking) { editor.focus(); editor._setCaret(editor._lastCursorPos || 0); return; }
    commitEdit();
  });
  editor.addEventListener('keydown', (e) => {
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
  document.getElementById('opt-resize-dnp').classList.toggle('disabled', !hasDisk || currentFormat !== DISK_FORMATS.dnp || !!currentPartition);
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
  // Defensive: nuke any stale inline submenu display styles and any
  // lingering classes that would keep a submenu visible.
  menubarEl.querySelectorAll('.submenu').forEach(function(s) { s.style.display = ''; });
  menubarEl.querySelectorAll('.menu-focused').forEach(function(el) { el.classList.remove('menu-focused'); });
  menubarEl.querySelectorAll('.submenu-open').forEach(function(el) { el.classList.remove('submenu-open'); });
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

// Drive menubar submenus via JS mouseenter/mouseleave + .submenu-open class
// rather than CSS :hover. Browser :hover state persists across rapid DOM
// mutations (e.g. when closing the menu after a click fires inside a submenu),
// which can leave a submenu looking "stuck open" the next time its parent
// menu is reopened. The context menu already uses this pattern.
function openMenubarSubmenu(item) {
  if (item.classList.contains('disabled')) return;
  // Close siblings so only one submenu is open per dropdown level
  var parent = item.parentElement;
  if (parent) {
    parent.querySelectorAll(':scope > .has-submenu.submenu-open').forEach(function(el) {
      if (el !== item) el.classList.remove('submenu-open');
    });
  }
  item.classList.add('submenu-open');
  var sub = item.querySelector('.submenu');
  if (sub) adjustSubmenu(sub);
}

document.querySelectorAll('.menubar .has-submenu').forEach(function(item) {
  item.addEventListener('mouseenter', function() {
    openMenubarSubmenu(item);
  });
  item.addEventListener('mouseleave', function() {
    item.classList.remove('submenu-open');
  });
  // Click on a has-submenu shouldn't close the menu — submenus are
  // hover-driven, so a click on (say) "Disk Tools" should leave the
  // dropdown up while the user picks a child.
  item.addEventListener('click', function(e) {
    if (item.classList.contains('disabled')) return;
    e.stopPropagation();
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
    // Tape images (T64/TAP) are read-only — the TAPE badge alone marks
    // them; no disk icon, since there's nothing to save.
    var label = (isTape
      ? '<span class="tab-tape-badge">TAPE</span> '
      : '<i class="fa-solid fa-floppy-disk tab-disk-icon"></i> ') +
      escHtml(t.name);
    html += '<div class="' + cls + '" data-tab-id="' + t.id + '" draggable="true">' +
      '<span class="tab-name" title="' + escHtml(t.name) + '">' + label + '</span>' +
      '<span class="tab-close" data-tab-close="' + t.id + '"><i class="fa-solid fa-xmark"></i></span>' +
    '</div>';
  }
  bar.innerHTML = html;

  // Tab click handlers
  bar.querySelectorAll('.tab').forEach(function(el) {
    var tid = parseInt(el.dataset.tabId, 10);
    el.addEventListener('click', function(e) {
      if (e.target.closest('.tab-close')) return;
      switchToTab(tid);
    });
    bindTabGestures(el, tid);
    bindTabDrag(el, tid);
  });
  bar.querySelectorAll('.tab-close').forEach(function(el) {
    el.addEventListener('click', function(e) {
      e.stopPropagation();
      closeTabSafe(parseInt(el.dataset.tabClose, 10));
    });
  });

  // Update browser tab title
  var activeTab = tabs.find(function(t) { return t.id === activeTabId; });
  if (activeTab) {
    document.title = (activeTab.dirty ? '* ' : '') + activeTab.name + ' \u2014 CBM Disk Editor';
  } else {
    document.title = 'CBM Disk Editor';
  }

  // Overflow controls + scroll the active tab into view.
  updateTabBarOverflow();
  scrollActiveTabIntoView();
  // The dropdown's contents must mirror the current tab list \u2014 close it
  // if it happened to be open during a re-render, otherwise it'd show
  // stale entries.
  closeTabListDropdown();
}

// \u2500\u2500 Tab-bar overflow controls \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
// Toggles a class on the wrap when the strip needs to scroll, which
// reveals the < / > scroll buttons and the \u00bb all-tabs dropdown trigger.
function updateTabBarOverflow() {
  var bar = document.getElementById('tab-bar');
  var wrap = document.getElementById('tab-bar-wrap');
  if (!bar || !wrap) return;
  var hasOverflow = bar.scrollWidth > bar.clientWidth + 1;
  wrap.classList.toggle('tab-bar-overflow', hasOverflow);
  var leftBtn = wrap.querySelector('.tab-scroll-left');
  var rightBtn = wrap.querySelector('.tab-scroll-right');
  if (leftBtn) leftBtn.disabled = bar.scrollLeft <= 0;
  if (rightBtn) rightBtn.disabled = bar.scrollLeft + bar.clientWidth >= bar.scrollWidth - 1;
}

function scrollActiveTabIntoView() {
  var bar = document.getElementById('tab-bar');
  if (!bar) return;
  var activeEl = bar.querySelector('.tab.active');
  if (!activeEl) return;
  // scrollIntoView with inline:'nearest' avoids unnecessary scrolling
  // when the active tab is already visible. Block:'nearest' prevents
  // vertical scroll of the page on narrow screens.
  activeEl.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' });
}

(function bindTabBarControls() {
  var wrap = document.getElementById('tab-bar-wrap');
  var bar = document.getElementById('tab-bar');
  if (!wrap || !bar) return;
  var leftBtn = wrap.querySelector('.tab-scroll-left');
  var rightBtn = wrap.querySelector('.tab-scroll-right');
  var listBtn = wrap.querySelector('.tab-list-btn');

  if (leftBtn) leftBtn.addEventListener('click', function() {
    bar.scrollBy({ left: -Math.max(120, bar.clientWidth * 0.6), behavior: 'smooth' });
  });
  if (rightBtn) rightBtn.addEventListener('click', function() {
    bar.scrollBy({ left:  Math.max(120, bar.clientWidth * 0.6), behavior: 'smooth' });
  });
  if (listBtn) listBtn.addEventListener('click', function(e) {
    e.stopPropagation();
    if (document.getElementById('tab-list-dropdown')) closeTabListDropdown();
    else openTabListDropdown(listBtn);
  });
  // Update button enable state as the strip scrolls or resizes.
  bar.addEventListener('scroll', updateTabBarOverflow, { passive: true });
  window.addEventListener('resize', updateTabBarOverflow);
})();

// \u2500\u2500 Tab list dropdown (\u00bb button) \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
function openTabListDropdown(anchor) {
  closeTabListDropdown();
  var dd = document.createElement('div');
  dd.className = 'tab-list-dropdown';
  dd.id = 'tab-list-dropdown';
  var html = '';
  for (var i = 0; i < tabs.length; i++) {
    var t = tabs[i];
    var isTape = t.format === DISK_FORMATS.t64 || t.format === DISK_FORMATS.tap;
    var cls = 'tab-list-dropdown-item' + (t.id === activeTabId ? ' active' : '') +
      (t.dirty ? ' tab-dirty' : '');
    var label = (isTape
      ? '<span class="tab-tape-badge">TAPE</span> '
      : '<i class="fa-solid fa-floppy-disk tab-disk-icon"></i> ') +
      escHtml(t.name);
    html += '<div class="' + cls + '" data-tab-id="' + t.id + '">' +
      '<span class="tab-list-name" title="' + escHtml(t.name) + '">' + label + '</span>' +
      '<span class="tab-list-close" data-tab-close="' + t.id + '" title="Close tab">' +
        '<i class="fa-solid fa-xmark"></i>' +
      '</span>' +
    '</div>';
  }
  dd.innerHTML = html;
  document.body.appendChild(dd);

  // Position below the anchor button. Clamp horizontally so it stays
  // on screen on narrow viewports.
  var rect = anchor.getBoundingClientRect();
  var ddRect = dd.getBoundingClientRect();
  var top = rect.bottom + 4;
  var left = Math.max(8, Math.min(rect.right - ddRect.width, window.innerWidth - ddRect.width - 8));
  // If it would go off the bottom edge, flip above the anchor instead.
  if (top + ddRect.height > window.innerHeight - 8) {
    top = Math.max(8, rect.top - ddRect.height - 4);
  }
  dd.style.top = top + 'px';
  dd.style.left = left + 'px';

  anchor.setAttribute('aria-expanded', 'true');

  dd.addEventListener('click', function(e) {
    var closeBtn = e.target.closest('.tab-list-close');
    if (closeBtn) {
      e.stopPropagation();
      closeTabSafe(parseInt(closeBtn.dataset.tabClose, 10));
      // After a tab close, re-render dropdown (or close it if empty).
      if (tabs.length > 0) openTabListDropdown(anchor);
      else closeTabListDropdown();
      return;
    }
    var item = e.target.closest('.tab-list-dropdown-item');
    if (!item) return;
    closeTabListDropdown();
    switchToTab(parseInt(item.dataset.tabId, 10));
  });
}

function closeTabListDropdown() {
  var dd = document.getElementById('tab-list-dropdown');
  if (dd) dd.remove();
  var listBtn = document.querySelector('.tab-list-btn');
  if (listBtn) listBtn.setAttribute('aria-expanded', 'false');
}

// Tap outside or press Escape to dismiss the tab list dropdown.
document.addEventListener('click', function(e) {
  var dd = document.getElementById('tab-list-dropdown');
  if (!dd) return;
  if (e.target.closest('.tab-list-dropdown') || e.target.closest('.tab-list-btn')) return;
  closeTabListDropdown();
});
document.addEventListener('keydown', function(e) {
  if (e.key === 'Escape') closeTabListDropdown();
});

// ── Tab context menu (right-click / middle-click / long-press) ───────
// Floating menu with Close / Close Others / Close Tabs to the Right /
// Close All. Built fresh each time, dismissed by outside click, Escape,
// or another contextmenu elsewhere. Bulk closes route through
// closeMultipleTabs which prompts once for all dirty tabs.
function closeTabContextMenu() {
  var m = document.getElementById('tab-context-menu');
  if (m) m.remove();
}

function showTabContextMenu(x, y, tabId) {
  closeTabContextMenu();
  closeTabListDropdown();
  closeMenus();
  if (typeof closeContextMenu === 'function') closeContextMenu();
  var idx = tabs.findIndex(function(t) { return t.id === tabId; });
  if (idx < 0) return;

  var hasOthers = tabs.length > 1;
  var hasRight = idx < tabs.length - 1;
  var hasLeft = idx > 0;

  var m = document.createElement('div');
  m.id = 'tab-context-menu';
  m.className = 'tab-context-menu';
  m.innerHTML =
    '<div class="tab-ctx-item" data-act="close">Close</div>' +
    '<div class="tab-ctx-item' + (hasOthers ? '' : ' disabled') + '" data-act="close-others">Close Others</div>' +
    '<div class="tab-ctx-item' + (hasRight ? '' : ' disabled') + '" data-act="close-right">Close Tabs to the Right</div>' +
    '<div class="tab-ctx-separator"></div>' +
    '<div class="tab-ctx-item' + (hasLeft ? '' : ' disabled') + '" data-act="move-left">Move Left</div>' +
    '<div class="tab-ctx-item' + (hasRight ? '' : ' disabled') + '" data-act="move-right">Move Right</div>' +
    '<div class="tab-ctx-separator"></div>' +
    '<div class="tab-ctx-item" data-act="close-all">Close All</div>';
  document.body.appendChild(m);

  // Edge-clamp so the menu stays fully on-screen.
  var rect = m.getBoundingClientRect();
  var nx = x, ny = y;
  if (nx + rect.width > window.innerWidth - 4) nx = Math.max(4, window.innerWidth - rect.width - 4);
  if (ny + rect.height > window.innerHeight - 4) ny = Math.max(4, window.innerHeight - rect.height - 4);
  m.style.left = nx + 'px';
  m.style.top = ny + 'px';

  m.addEventListener('click', function(e) {
    var item = e.target.closest('.tab-ctx-item');
    if (!item || item.classList.contains('disabled')) return;
    e.stopPropagation();
    var act = item.dataset.act;
    closeTabContextMenu();
    if (act === 'close') closeTabSafe(tabId);
    else if (act === 'close-others') closeOtherTabs(tabId);
    else if (act === 'close-right') closeTabsToRight(tabId);
    else if (act === 'move-left') moveTab(tabId, -1);
    else if (act === 'move-right') moveTab(tabId, 1);
    else if (act === 'close-all') document.getElementById('opt-close-all').click();
  });
}

// Single dirty-prompt covering every target. Iterates in reverse so
// indices remain valid as tabs are spliced out.
async function closeMultipleTabs(targetIds, actionLabel) {
  if (!targetIds.length) return;
  var active = getActiveTab();
  if (active) active.dirty = tabDirty;
  var dirty = targetIds
    .map(function(id) { return tabs.find(function(t) { return t.id === id; }); })
    .filter(function(t) { return t && isTabDirty(t); });
  if (dirty.length > 0) {
    var msg = dirty.length === 1
      ? 'One tab has unsaved changes. ' + actionLabel + ' without saving?'
      : dirty.length + ' tabs have unsaved changes. ' + actionLabel + ' without saving?';
    var choice = await showChoiceModal(
      'Unsaved changes', msg,
      [
        { label: 'Cancel', value: false, secondary: true },
        { label: actionLabel, value: true }
      ],
      dirty.map(function(t) { return t.name; })
    );
    if (!choice) return;
  }
  for (var i = targetIds.length - 1; i >= 0; i--) closeTab(targetIds[i]);
}

function closeOtherTabs(keepId) {
  var others = tabs.filter(function(t) { return t.id !== keepId; }).map(function(t) { return t.id; });
  closeMultipleTabs(others, 'Close Others');
}

function closeTabsToRight(fromId) {
  var idx = tabs.findIndex(function(t) { return t.id === fromId; });
  if (idx < 0) return;
  var ids = tabs.slice(idx + 1).map(function(t) { return t.id; });
  closeMultipleTabs(ids, 'Close to Right');
}

// Wires right-click, middle-click, and long-press on a tab element.
// Long-press uses a 500ms timer that's cancelled on touchmove > 10px so
// horizontal swipes (used to scroll the tab strip) still work.
function bindTabGestures(el, tabId) {
  el.addEventListener('contextmenu', function(e) {
    e.preventDefault();
    e.stopPropagation();
    showTabContextMenu(e.clientX, e.clientY, tabId);
  });

  el.addEventListener('auxclick', function(e) {
    if (e.button === 1) {
      e.preventDefault();
      e.stopPropagation();
      closeTabSafe(tabId);
    }
  });
  // Suppress the autoscroll cursor that mousedown on middle button
  // triggers in some browsers.
  el.addEventListener('mousedown', function(e) {
    if (e.button === 1) e.preventDefault();
  });

  // Tab context menu is desktop-only: long-press on touch is reserved
  // for the OS / for the tab strip's native horizontal scroll. Mobile
  // users still get tap-to-switch and the × close button.
}

// ── Drag-to-reorder tabs (HTML5 native DnD) ──────────────────────────
// Native DnD covers desktop reliably. Touch users get the same outcome
// via the Move Left / Move Right items on the tab context menu.
// The shared MIME 'application/x-cbm-tab' keeps OS-file drags (which
// use 'Files' / OS mime types) from being interpreted as tab drags.
var TAB_DRAG_MIME = 'application/x-cbm-tab';
var draggedTabId = null;

function moveTab(tabId, delta) {
  var idx = tabs.findIndex(function(t) { return t.id === tabId; });
  if (idx < 0) return;
  var to = idx + delta;
  if (to < 0 || to >= tabs.length) return;
  var moved = tabs.splice(idx, 1)[0];
  tabs.splice(to, 0, moved);
  renderTabs();
}

function reorderTabs(fromId, toId, before) {
  if (fromId === toId) return;
  var fromIdx = tabs.findIndex(function(t) { return t.id === fromId; });
  var toIdx = tabs.findIndex(function(t) { return t.id === toId; });
  if (fromIdx < 0 || toIdx < 0) return;
  var insertIdx = before ? toIdx : toIdx + 1;
  // Splicing the source out shifts later indices left — adjust target.
  if (insertIdx > fromIdx) insertIdx--;
  if (insertIdx === fromIdx) return;
  var moved = tabs.splice(fromIdx, 1)[0];
  tabs.splice(insertIdx, 0, moved);
  renderTabs();
}

// One floating indicator on the bar (not per-tab classes that change
// margins) — that way tab geometry is stable during the drag and the
// pointer never falls into a "gap" that retriggers dragenter/leave.
function ensureDropLine() {
  var bar = document.getElementById('tab-bar');
  if (!bar) return null;
  var line = document.getElementById('tab-drop-line');
  if (!line) {
    line = document.createElement('div');
    line.id = 'tab-drop-line';
    line.className = 'tab-drop-line';
    bar.appendChild(line);
  }
  line.style.display = 'none';
  return line;
}

function positionDropLine(viewportX) {
  var bar = document.getElementById('tab-bar');
  var line = document.getElementById('tab-drop-line');
  if (!bar || !line) return;
  var barRect = bar.getBoundingClientRect();
  // line is a child of bar (scrolls with content) — convert viewport X
  // to content X.
  var x = viewportX - barRect.left + bar.scrollLeft;
  line.style.left = x + 'px';
  line.style.display = 'block';
}

function hideDropLine() {
  var line = document.getElementById('tab-drop-line');
  if (line) line.style.display = 'none';
}

function removeDropLine() {
  var line = document.getElementById('tab-drop-line');
  if (line) line.remove();
}

function bindTabDrag(el, tabId) {
  el.addEventListener('dragstart', function(e) {
    if (!e.dataTransfer) return;
    closeTabContextMenu();
    closeTabListDropdown();
    draggedTabId = tabId;
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData(TAB_DRAG_MIME, String(tabId));
    // Some browsers (Firefox) require text/plain for the drag to start.
    e.dataTransfer.setData('text/plain', String(tabId));
    el.classList.add('tab-dragging');
    ensureDropLine();
  });
  el.addEventListener('dragend', function() {
    draggedTabId = null;
    el.classList.remove('tab-dragging');
    removeDropLine();
  });
  el.addEventListener('dragover', function(e) {
    var types = e.dataTransfer && e.dataTransfer.types ? Array.prototype.slice.call(e.dataTransfer.types) : [];
    if (types.indexOf(TAB_DRAG_MIME) < 0) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    if (draggedTabId === tabId) {
      // Hovering over the source — no useful drop position to show.
      hideDropLine();
      return;
    }
    var rect = el.getBoundingClientRect();
    var leftHalf = e.clientX < rect.left + rect.width / 2;
    positionDropLine(leftHalf ? rect.left : rect.right);
  });
  el.addEventListener('drop', function(e) {
    var types = e.dataTransfer && e.dataTransfer.types ? Array.prototype.slice.call(e.dataTransfer.types) : [];
    if (types.indexOf(TAB_DRAG_MIME) < 0) return;
    e.preventDefault();
    e.stopPropagation();
    var fromId = parseInt(e.dataTransfer.getData(TAB_DRAG_MIME), 10);
    if (isNaN(fromId)) return;
    var rect = el.getBoundingClientRect();
    var leftHalf = e.clientX < rect.left + rect.width / 2;
    removeDropLine();
    reorderTabs(fromId, tabId, leftHalf);
  });
}

// Outside-click / Escape / right-click-elsewhere dismiss for the tab
// context menu.
document.addEventListener('click', function(e) {
  if (!document.getElementById('tab-context-menu')) return;
  if (e.target.closest('#tab-context-menu')) return;
  closeTabContextMenu();
});
document.addEventListener('contextmenu', function(e) {
  if (!document.getElementById('tab-context-menu')) return;
  // Right-click on a tab will reopen its own menu — let the per-tab
  // handler run after we close the current one.
  if (e.target.closest('.tab')) return;
  closeTabContextMenu();
});
document.addEventListener('keydown', function(e) {
  if (e.key === 'Escape') closeTabContextMenu();
});

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
    tabDirty = false;
    clearUndo();
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

async function closeTabSafe(tabId) {
  var tab = tabs.find(function(t) { return t.id === tabId; });
  if (isTabDirty(tab)) {
    var choice = await showChoiceModal(
      'Unsaved changes',
      'The tab "' + tab.name + '" has unsaved changes. Close without saving?',
      [
        { label: 'Cancel', value: false, secondary: true },
        { label: 'Close', value: true }
      ]
    );
    if (!choice) return;
  }
  closeTab(tabId);
}

document.getElementById('opt-close').addEventListener('click', (e) => {
  e.stopPropagation();
  if (!currentBuffer) return;
  closeMenus();
  if (activeTabId !== null) {
    closeTabSafe(activeTabId);
  }
});

document.getElementById('opt-close-all').addEventListener('click', async (e) => {
  e.stopPropagation();
  if (tabs.length === 0) return;
  closeMenus();
  // Sync active tab's dirty state before checking
  var active = getActiveTab();
  if (active) active.dirty = tabDirty;
  var dirty = tabs.filter(function(t) { return t.dirty; });
  if (dirty.length > 0) {
    var msg = dirty.length === 1
      ? 'One tab has unsaved changes. Close all without saving?'
      : dirty.length + ' tabs have unsaved changes. Close all without saving?';
    var choice = await showChoiceModal(
      'Unsaved changes',
      msg,
      [
        { label: 'Cancel', value: false, secondary: true },
        { label: 'Close All', value: true }
      ],
      dirty.map(function(t) { return t.name; })
    );
    if (!choice) return;
  }
  while (tabs.length > 0) {
    tabs.pop();
  }
  activeTabId = null;
  currentBuffer = null;
  currentFileName = null;
  selectedEntryIndex = -1;
  currentPartition = null;
  tabDirty = false;
  clearUndo();
  showEmptyState();
  renderTabs();
  updateMenuState();
  updateEntryMenuState();
});

window.addEventListener('beforeunload', function(e) {
  if (anyDirtyTab()) {
    e.preventDefault();
    e.returnValue = '';
    return '';
  }
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
  markClean();
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
  markClean();
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

