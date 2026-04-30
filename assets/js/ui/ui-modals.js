// ── Modal z-index stacking ────────────────────────────────────────────
var modalZCounter = 200;

// Auto-manage z-index stacking when modals open/close
document.addEventListener('DOMContentLoaded', function() {
  var overlays = document.querySelectorAll('.modal-overlay');
  var observer = new MutationObserver(function(mutations) {
    mutations.forEach(function(m) {
      if (m.type !== 'attributes' || m.attributeName !== 'class') return;
      var el = m.target;
      if (el.classList.contains('open')) {
        modalZCounter += 10;
        el.style.zIndex = modalZCounter;
        // Always open modals at the top — scroll position should not persist
        // between open/close cycles.
        el.querySelectorAll('.modal-body').forEach(function(body) {
          body.scrollTop = 0;
        });
      }
    });
  });
  overlays.forEach(function(el) {
    observer.observe(el, { attributes: true, attributeFilter: ['class'] });
  });
});

// ── Modal sizing ──────────────────────────────────────────────────────
// Apply a fixed-size class to the shared modal so tab switches inside the body
// don't cause the modal to grow/shrink with content.
// Size: null (reset to default/auto) or 'sm'|'md'|'lg'|'xl'|'xxl'.
function setModalSize(size) {
  var modalEl = document.querySelector('#modal-overlay .modal');
  if (!modalEl) return;
  modalEl.classList.remove('modal-sm', 'modal-md', 'modal-lg', 'modal-xl', 'modal-xxl');
  if (size) modalEl.classList.add('modal-' + size);
}

// ── Modal ─────────────────────────────────────────────────────────────
function showModal(title, lines) {
  setModalSize(null);
  document.getElementById('modal-title').textContent = title;
  // Always restore the standard OK footer
  var footer = document.querySelector('#modal-overlay .modal-footer');
  footer.innerHTML = '<button id="modal-close">OK</button>';
  document.getElementById('modal-close').addEventListener('click', function() {
    document.getElementById('modal-overlay').classList.remove('open');
  });
  const body = document.getElementById('modal-body');
  body.innerHTML = '';
  const isSummary = l => l.startsWith('Validation complete') || l.startsWith('Disk is valid');
  const details = lines.filter(l => !isSummary(l));
  const summary = lines.filter(l => isSummary(l));

  if (details.length) {
    const ul = document.createElement('ul');
    for (const line of details) {
      const li = document.createElement('li');
      li.textContent = line.replace(/^\s+/, '');
      if (line.includes('ERROR') || line.includes('corrected') || line.startsWith('Removed')) li.className = 'log-error';
      else if (line.includes('Warning')) li.className = 'log-warning';
      ul.appendChild(li);
    }
    body.appendChild(ul);
  }

  for (const line of summary) {
    const div = document.createElement('div');
    div.textContent = line;
    div.style.marginTop = '12px';
    body.appendChild(div);
  }
  document.getElementById('modal-overlay').classList.add('open');
}

document.getElementById('modal-close').addEventListener('click', () => {
  document.getElementById('modal-overlay').classList.remove('open');
});

// Drop-in scaffolding for read-only viewer modals (hex, BASIC, TASS,
// VLIR, REL, ...): set the title, install body content, restore the
// standard "OK" footer (clearing any custom modal-footer-* classes a
// previous viewer left behind), and open the overlay.
//
//   bodyContent: HTML string, a Node, or null to leave the body untouched
//                (callers that need to mix in extra elements append them
//                after this returns).
//   size:        optional modal size class (passed through to setModalSize).
// Returns the modal-body element.
function showViewerModal(title, bodyContent, size) {
  if (size !== undefined) setModalSize(size);
  document.getElementById('modal-title').textContent = title;
  var body = document.getElementById('modal-body');
  if (typeof bodyContent === 'string') body.innerHTML = bodyContent;
  else if (bodyContent instanceof Node) { body.innerHTML = ''; body.appendChild(bodyContent); }
  // else: leave existing body content
  var footer = document.querySelector('#modal-overlay .modal-footer');
  footer.className = 'modal-footer';
  footer.innerHTML = '<button id="modal-close">OK</button>';
  document.getElementById('modal-close').addEventListener('click', function() {
    document.getElementById('modal-overlay').classList.remove('open');
  });
  document.getElementById('modal-overlay').classList.add('open');
  return body;
}

// Show a progress modal with a title, status text, and progress bar.
// Returns { status, bar, update(idx, total, label) }.
function showProgressModal(title) {
  setModalSize(null);
  document.getElementById('modal-title').textContent = title;
  var body = document.getElementById('modal-body');
  body.innerHTML =
    '<div class="text-md text-muted mb-md" id="progress-status"></div>' +
    '<div class="progress-track"><div class="progress-fill" id="progress-bar"></div></div>';
  document.querySelector('#modal-overlay .modal-footer').innerHTML = '';
  var status = document.getElementById('progress-status');
  var bar = document.getElementById('progress-bar');
  document.getElementById('modal-overlay').classList.add('open');
  return {
    status: status,
    bar: bar,
    update: function(idx, total, label) {
      if (status) status.textContent = (idx + 1) + ' / ' + total + ': ' + label;
      if (bar) bar.style.width = Math.round(((idx + 1) / total) * 100) + '%';
      return new Promise(function(r) { setTimeout(r, 0); });
    }
  };
}

// Show a modal with custom buttons, returns a promise resolving to the button value
// Optional items array shows a list below the message
function showChoiceModal(title, message, buttons, items) {
  return new Promise(function(resolve) {
    setModalSize(null);
    document.getElementById('modal-title').textContent = title;
    var body = document.getElementById('modal-body');
    body.innerHTML = '';
    var p = document.createElement('div');
    p.textContent = message;
    body.appendChild(p);

    if (items && items.length) {
      var ul = document.createElement('ul');
      ul.style.maxHeight = '150px';
      ul.style.overflowY = 'auto';
      ul.style.margin = '8px 0';
      for (var ii = 0; ii < items.length; ii++) {
        var li = document.createElement('li');
        li.textContent = items[ii];
        ul.appendChild(li);
      }
      body.appendChild(ul);
    }

    var footer = document.querySelector('#modal-overlay .modal-footer');
    footer.innerHTML = '';
    buttons.forEach(function(btn) {
      var el = document.createElement('button');
      el.textContent = btn.label;
      if (btn.secondary) el.className = 'modal-btn-secondary';
      el.addEventListener('click', function() {
        document.getElementById('modal-overlay').classList.remove('open');
        resolve(btn.value);
      });
      footer.appendChild(el);
    });
    document.getElementById('modal-overlay').classList.add('open');
  });
}

document.getElementById('modal-overlay').addEventListener('click', (e) => {
  if (e.target === e.currentTarget) {
    hidePetsciiPicker();
    document.getElementById('modal-overlay').classList.remove('open');
  }
});

// Ctrl+Shift toggles charset (like Commodore+Shift on C64)
// Fires on keyup only if no other key was pressed while both modifiers were held,
// so Ctrl+Shift+< and Ctrl+Shift+* shortcuts work without triggering the toggle.
var ctrlShiftClean = false;
document.addEventListener('keydown', (e) => {
  if ((e.ctrlKey && e.key === 'Shift') || (e.shiftKey && e.key === 'Control')) {
    ctrlShiftClean = true;
  } else if (e.ctrlKey && e.shiftKey) {
    ctrlShiftClean = false;
  }
  if (e.key === 'Escape' && document.getElementById('modal-overlay').classList.contains('open')) {
    hidePetsciiPicker();
    document.getElementById('modal-overlay').classList.remove('open');
  }

  // While a viewer modal is open, scroll its content with the cursor / page
  // keys instead of letting the directory listing intercept them. Skip when
  // an editable element is focused so input fields keep working.
  var overlay = document.getElementById('modal-overlay');
  if (overlay && overlay.classList.contains('open')) {
    var ae = document.activeElement;
    var inField = ae && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA' || ae.isContentEditable);
    if (!inField && !e.ctrlKey && !e.altKey && !e.metaKey) {
      // Prefer an inner viewer container (.basic-listing / .hex-editor)
      // if present — those have their own scrollbar so a static header
      // (e.g. the BASIC dialect selector) stays in view. Fall back to
      // modal-body for plain modals.
      var body = document.getElementById('modal-body');
      var scroller = body && (body.querySelector('.basic-listing, .hex-editor') || body);
      if (scroller) {
        var page = scroller.clientHeight - 32;
        var step = 32;
        var dy = 0;
        if (e.key === 'ArrowDown') dy = step;
        else if (e.key === 'ArrowUp') dy = -step;
        else if (e.key === 'PageDown') dy = page;
        else if (e.key === 'PageUp') dy = -page;
        else if (e.key === 'Home') { e.preventDefault(); scroller.scrollTop = 0; return; }
        else if (e.key === 'End')  { e.preventDefault(); scroller.scrollTop = scroller.scrollHeight; return; }
        if (dy !== 0) {
          e.preventDefault();
          scroller.scrollTop += dy;
          return;
        }
      }
    }
  }
  // Ctrl+Alt+G: view as graphics
  if (e.ctrlKey && e.altKey && e.code === 'KeyG') {
    e.preventDefault();
    if (currentBuffer && selectedEntryIndex >= 0) {
      closeMenus();
      showFileGfxViewer(selectedEntryIndex);
    }
  }
  // Ctrl+F: find in current tab
  if (e.ctrlKey && !e.altKey && !e.shiftKey && e.code === 'KeyF') {
    e.preventDefault();
    if (currentBuffer) showSearchModal('Find', false);
  }
  // Ctrl+Shift+F: find in all tabs
  if (e.ctrlKey && e.shiftKey && !e.altKey && e.code === 'KeyF') {
    e.preventDefault();
    if (tabs.length > 0) showSearchModal('Find in All Tabs', true);
  }
  // Ctrl+Shift+G: go to track/sector (Ctrl+G conflicts with browser Find Next)
  if (e.ctrlKey && e.shiftKey && !e.altKey && e.code === 'KeyG') {
    e.preventDefault();
    if (currentBuffer && !isTapeFormat()) showGoToSector();
  }
  // Ctrl+Alt+W: close current tab (Ctrl+W conflicts with browser close tab)
  if (e.ctrlKey && e.altKey && e.code === 'KeyW') {
    e.preventDefault();
    var closeEl = document.getElementById('opt-close');
    if (!closeEl.classList.contains('disabled')) closeEl.click();
  }
  // Ctrl+Alt+H: view as hex
  if (e.ctrlKey && e.altKey && e.code === 'KeyH') {
    e.preventDefault();
    if (currentBuffer && selectedEntryIndex >= 0) {
      closeMenus();
      showFileHexViewer(selectedEntryIndex);
    }
  }
  // Ctrl+Alt+B: view as BASIC
  if (e.ctrlKey && e.altKey && e.code === 'KeyB') {
    e.preventDefault();
    if (currentBuffer && selectedEntryIndex >= 0) {
      closeMenus();
      showFileBasicViewer(selectedEntryIndex);
    }
  }
  // Ctrl+Alt+P: view as PETSCII
  if (e.ctrlKey && e.altKey && e.code === 'KeyP') {
    e.preventDefault();
    if (currentBuffer && selectedEntryIndex >= 0) {
      closeMenus();
      showFilePetsciiViewer(selectedEntryIndex);
    }
  }
  // Ctrl+Alt+D: view as disassembly
  if (e.ctrlKey && e.altKey && e.code === 'KeyD') {
    e.preventDefault();
    if (currentBuffer && selectedEntryIndex >= 0) {
      closeMenus();
      showFileDisasmViewer(selectedEntryIndex);
    }
  }
  // Ctrl+Alt+V: validate disk
  if (e.ctrlKey && e.altKey && e.code === 'KeyV') {
    e.preventDefault();
    var valEl = document.getElementById('opt-validate');
    if (!valEl.classList.contains('disabled')) valEl.click();
  }
  // Ctrl+Shift+S: save as
  if (e.ctrlKey && e.shiftKey && !e.altKey && e.code === 'KeyS') {
    e.preventDefault();
    var saveAsEl = document.getElementById('opt-save-as');
    if (!saveAsEl.classList.contains('disabled')) saveAsEl.click();
  }
  // Ctrl+Alt+O: open disk
  if (e.ctrlKey && e.altKey && e.code === 'KeyO') {
    e.preventDefault();
    document.getElementById('opt-open').click();
  }
  // Ctrl+Alt+S: save disk
  if (e.ctrlKey && e.altKey && e.code === 'KeyS') {
    e.preventDefault();
    if (currentBuffer && currentFileName && !isTapeFormat()) {
      document.getElementById('opt-save').click();
    } else if (currentBuffer && !isTapeFormat()) {
      document.getElementById('opt-save-as').click();
    }
  }
  // Ctrl+Alt+N: new disk (open Disk > New submenu with first option focused)
  if (e.ctrlKey && e.altKey && e.code === 'KeyN') {
    e.preventDefault();
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
  }
});

document.addEventListener('keyup', (e) => {
  if ((e.key === 'Shift' || e.key === 'Control') && ctrlShiftClean) {
    ctrlShiftClean = false;
    document.getElementById('opt-charset-mode').click();
  }
});

// ── Input Modal ───────────────────────────────────────────────────────
let inputModalResolve = null;

function showInputModal(title, defaultValue) {
  return new Promise((resolve) => {
    inputModalResolve = resolve;
    document.getElementById('input-modal-title').textContent = title;
    const field = document.getElementById('input-modal-field');
    field.value = defaultValue || '';
    document.getElementById('input-modal-overlay').classList.add('open');
    field.focus();
    field.select();
  });
}

function closeInputModal(value) {
  document.getElementById('input-modal-overlay').classList.remove('open');
  if (inputModalResolve) {
    inputModalResolve(value);
    inputModalResolve = null;
  }
}

document.getElementById('input-modal-ok').addEventListener('click', () => {
  closeInputModal(document.getElementById('input-modal-field').value);
});

document.getElementById('input-modal-cancel').addEventListener('click', () => {
  closeInputModal(null);
});

document.getElementById('input-modal-overlay').addEventListener('click', (e) => {
  if (e.target === e.currentTarget) closeInputModal(null);
});

document.getElementById('input-modal-field').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    closeInputModal(document.getElementById('input-modal-field').value);
  } else if (e.key === 'Escape') {
    e.preventDefault();
    closeInputModal(null);
  }
});

