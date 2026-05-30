// ── Modal z-index stacking ────────────────────────────────────────────
var modalZCounter = 200;

// Charset-toggle re-render hook for modals. Modals that show PETSCII
// glyphs assign their own render function to this slot when they open;
// the slot is auto-cleared when the modal closes (see the observer
// below) so the wrong modal's render isn't called after a close+reopen.
var modalCharsetRedraw = null;

document.addEventListener('cbm-charsetchange', function() {
  if (typeof modalCharsetRedraw !== 'function') return;
  // Preserve scroll across the redraw — viewers typically rebuild
  // modal-body innerHTML wholesale, which resets scrollTop. The TASS
  // and hex viewers scroll on an inner element (`.basic-listing` /
  // `.hex-editor`, see editors.css `:has` rules); other viewers scroll
  // on modal-body itself. Find whichever element currently shows scroll
  // before the redraw, then restore on the matching post-redraw node.
  var body = document.getElementById('modal-body');
  function findScroller(root) {
    if (!root) return null;
    var inner = root.querySelector('.basic-listing, .hex-editor');
    return inner || root;
  }
  var prev = findScroller(body);
  var prevScroll = prev ? prev.scrollTop : 0;
  try { modalCharsetRedraw(); } catch (_) { /* swallow — modal may be closing */ }
  var next = findScroller(body);
  if (next) next.scrollTop = prevScroll;
});

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
        el.querySelectorAll('.modal-body, .modal-body .basic-listing, .modal-body .hex-editor').forEach(function(scroller) {
          scroller.scrollTop = 0;
        });
      } else {
        // Modal just closed — drop any registered charset-redraw so a
        // future modal that doesn't set one doesn't accidentally fire
        // the previous modal's render.
        modalCharsetRedraw = null;
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
    // Split on \n so callers can put follow-up sentences on their own line
    // without resorting to innerHTML. Each segment becomes its own block.
    var segs = String(message == null ? '' : message).split('\n');
    for (var sIdx = 0; sIdx < segs.length; sIdx++) {
      var p = document.createElement('div');
      p.textContent = segs[sIdx];
      if (sIdx > 0) p.style.marginTop = '8px';
      body.appendChild(p);
    }

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

document.getElementById('modal-close-x').addEventListener('click', () => {
  hidePetsciiPicker();
  document.getElementById('modal-overlay').classList.remove('open');
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

  // Enter inside an open modal triggers its primary action — the footer
  // button that doesn't carry .modal-btn-secondary, matching the visual
  // "bright" styling. Textareas + contenteditables keep their newline
  // behaviour, and a focused button keeps the browser default so Tab + Enter
  // still works on a non-primary button.
  if (e.key === 'Enter' && document.getElementById('modal-overlay').classList.contains('open')) {
    var ae = document.activeElement;
    if (ae && (ae.tagName === 'TEXTAREA' || ae.isContentEditable)) return;
    if (ae && ae.tagName === 'BUTTON') return;
    var primary = document.querySelector('#modal-overlay .modal-footer button:not(.modal-btn-secondary):not(:disabled)');
    if (primary) {
      e.preventDefault();
      primary.click();
    }
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
    if (currentBuffer && !isTapeFormat(getCurrentCtx())) showGoToSector();
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
    if (currentBuffer && currentFileName && !isTapeFormat(getCurrentCtx())) {
      document.getElementById('opt-save').click();
    } else if (currentBuffer && !isTapeFormat(getCurrentCtx())) {
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
    // Commit any in-progress edit first: opt-charset-mode synchronously
    // calls renderDisk → content.innerHTML, and a focused editable's
    // blur handler firing mid-innerHTML reparents siblings and throws
    // NotFoundError (Chrome's "moved in a blur event handler" error).
    var ae = document.activeElement;
    if (ae && typeof ae.blur === 'function' && ae !== document.body) ae.blur();
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

document.getElementById('input-modal-close-x').addEventListener('click', () => {
  closeInputModal(null);
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

// Slider + number input + live readout, tied together with shared state
// and step-aware blur-clamping. Used by anywhere we need a "pick a size
// in N-sized steps" widget. `formatLabel(n)` formats the readout text.
function buildBlockSliderRow(opts) {
  var min = opts.min, step = opts.step;
  var max = opts.max;
  var formatLabel = opts.formatLabel || function(n) { return n + ' blocks'; };

  var row = document.createElement('div');
  row.style.display = 'flex';
  row.style.alignItems = 'center';
  row.style.gap = '8px';

  var slider = document.createElement('input');
  slider.type = 'range';
  slider.min = String(min);
  slider.max = String(max);
  slider.step = String(step);
  slider.value = String(opts.value);
  slider.style.flex = '1';

  var input = document.createElement('input');
  input.type = 'text';
  input.className = 'modal-input';
  input.style.width = '90px';
  input.style.flex = '0 0 auto';
  input.value = String(opts.value);

  var readout = document.createElement('span');
  readout.style.opacity = '0.7';
  readout.style.minWidth = '70px';

  row.appendChild(slider);
  row.appendChild(input);
  row.appendChild(readout);

  function refreshReadout() {
    var n = parseInt(input.value, 10);
    if (isNaN(n)) n = min;
    readout.textContent = formatLabel(n);
  }
  function clamp(n) {
    if (isNaN(n) || n < min) return min;
    if (n > max) return max;
    return Math.floor(n / step) * step;
  }
  slider.addEventListener('input', function() {
    input.value = slider.value;
    refreshReadout();
  });
  // Mid-typing: clamp non-disruptively (don't rewrite the input value).
  input.addEventListener('input', function() {
    var n = parseInt(input.value, 10);
    if (isNaN(n)) return;
    if (n > max) n = max;
    if (n < min) n = min;
    slider.value = String(n);
    refreshReadout();
  });
  // Commit: snap to a valid step.
  input.addEventListener('blur', function() {
    var n = clamp(parseInt(input.value, 10));
    input.value = String(n);
    slider.value = String(n);
    refreshReadout();
  });
  refreshReadout();

  return {
    row: row,
    slider: slider,
    input: input,
    readout: readout,
    getValue: function() { return clamp(parseInt(input.value, 10)); },
    setMax: function(newMax, fallback) {
      max = newMax;
      slider.max = String(newMax);
      var current = parseInt(input.value, 10);
      if (isNaN(current) || current > newMax) {
        var v = fallback !== undefined ? fallback : newMax;
        input.value = String(v);
        slider.value = String(v);
        refreshReadout();
      }
    },
  };
}

// "New DNP" size picker. Returns the chosen block count, or null on
// cancel. Range is 1..255 tracks expressed as 256..65280 blocks.
function showDnpSizePicker(defaultBlocks) {
  return new Promise(function(resolve) {
    setModalSize(null);
    document.getElementById('modal-title').textContent = 'New DNP';
    var body = document.getElementById('modal-body');
    body.innerHTML = '';

    var minBlocks = 256, maxBlocks = 255 * 256;
    var initial = Math.max(minBlocks, Math.min(maxBlocks, defaultBlocks || maxBlocks));
    initial = Math.floor(initial / 256) * 256;

    function formatSize(blocks) {
      var bytes = blocks * 256;
      if (bytes >= 1024 * 1024) return (bytes / 1024 / 1024).toFixed(2) + ' MiB';
      return (bytes / 1024).toFixed(0) + ' KiB';
    }

    var wrap = document.createElement('div');
    wrap.style.display = 'flex';
    wrap.style.flexDirection = 'column';
    wrap.style.gap = '8px';

    var label = document.createElement('div');
    label.style.opacity = '0.7';
    label.textContent = 'Size (' + minBlocks + ' – ' + maxBlocks + ' blocks, step 256)';

    var sliderRow = buildBlockSliderRow({
      min: minBlocks, max: maxBlocks, step: 256, value: initial,
      formatLabel: formatSize,
    });

    var footer = document.createElement('div');
    footer.style.opacity = '0.55';
    footer.style.fontSize = '0.9em';
    footer.textContent = 'max ' + maxBlocks + ' blocks (' + formatSize(maxBlocks) + ')';

    wrap.appendChild(label);
    wrap.appendChild(sliderRow.row);
    wrap.appendChild(footer);
    body.appendChild(wrap);

    var modalFooter = document.querySelector('#modal-overlay .modal-footer');
    modalFooter.innerHTML = '';
    var done = false;
    function ok() {
      if (done) return;
      done = true;
      document.getElementById('modal-overlay').classList.remove('open');
      resolve(sliderRow.getValue());
    }
    function cancel() {
      if (done) return;
      done = true;
      document.getElementById('modal-overlay').classList.remove('open');
      resolve(null);
    }
    var cancelBtn = document.createElement('button');
    cancelBtn.textContent = 'Cancel';
    cancelBtn.className = 'modal-btn-secondary';
    cancelBtn.addEventListener('click', cancel);
    modalFooter.appendChild(cancelBtn);
    var okBtn = document.createElement('button');
    okBtn.textContent = 'OK';
    okBtn.addEventListener('click', ok);
    modalFooter.appendChild(okBtn);

    document.getElementById('modal-overlay').classList.add('open');
    setTimeout(function() { sliderRow.input.focus(); sliderRow.input.select(); }, 0);
  });
}

