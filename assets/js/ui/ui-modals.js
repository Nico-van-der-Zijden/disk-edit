// ── Modal z-index stacking ────────────────────────────────────────────
var modalZCounter = 200;

// Charset-toggle re-render hook; set by viewers that paint PETSCII, cleared
// when the modal closes.
var modalCharsetRedraw = null;

// Body of the live viewer surface: the modal when open, else the detail pane.
function getViewerBody() {
  if (document.querySelector('#modal-overlay.open')) return document.getElementById('modal-body');
  if (document.body.classList.contains('pane-open')) return document.getElementById('detail-pane-body');
  return document.getElementById('modal-body');
}

// Footer of the live viewer surface (the pane footer also carries .modal-footer).
function getViewerFooter() {
  if (document.querySelector('#modal-overlay.open')) return document.querySelector('#modal-overlay .modal-footer');
  if (document.body.classList.contains('pane-open')) return document.getElementById('detail-pane-footer');
  return document.querySelector('#modal-overlay .modal-footer');
}

// Close whichever viewer surface is live, so the same Close button works in
// the pane and in the modal.
function closeViewer() {
  if (document.querySelector('#modal-overlay.open')) {
    document.getElementById('modal-overlay').classList.remove('open');
  } else if (typeof closeDetailPane === 'function' && document.body.classList.contains('pane-open')) {
    closeDetailPane();
  } else {
    document.getElementById('modal-overlay').classList.remove('open');
  }
}

// Set the title of the active viewer surface (pane header or modal title).
function setViewerTitle(text) {
  if (document.querySelector('#modal-overlay.open')) {
    document.getElementById('modal-title').textContent = text;
  } else if (document.body.classList.contains('pane-open')) {
    var t = document.getElementById('detail-pane-title');
    if (t) t.textContent = text;
  } else {
    document.getElementById('modal-title').textContent = text;
  }
}

// Open an empty viewer surface (detail pane unless forceModal) and return its
// body, for viewers that build and re-render their body themselves.
function openViewerSurface(title, forceModal) {
  if (!forceModal && typeof openDetailPane === 'function') {
    return openDetailPane(title, '');
  }
  setModalSize(null);
  document.getElementById('modal-title').textContent = title || '';
  var body = document.getElementById('modal-body');
  body.innerHTML = '';
  var footer = document.querySelector('#modal-overlay .modal-footer');
  footer.className = 'modal-footer';
  footer.innerHTML = '';
  document.getElementById('modal-overlay').classList.add('open');
  return body;
}

document.addEventListener('cbm-charsetchange', function() {
  if (typeof modalCharsetRedraw !== 'function') return;
  // Preserve scroll across the redraw. TASS/hex viewers scroll an inner
  // .basic-listing / .hex-editor; other viewers scroll the body itself.
  var body = getViewerBody();
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

// Close the shared modal without a footer button (Esc, X, backdrop). Listeners
// for 'modaldismiss' settle pending promises / drop per-session handlers.
function dismissModal() {
  var overlay = document.getElementById('modal-overlay');
  if (!overlay.classList.contains('open')) return;
  hidePetsciiPicker();
  overlay.classList.remove('open');
  overlay.dispatchEvent(new CustomEvent('modaldismiss'));
}

// Focus to hand back when a modal closes. Tracked on focusin because openers
// usually focus a field inside the modal before the observer below runs.
var lastFocusOutsideModal = null;
document.addEventListener('focusin', function(e) {
  if (!e.target.closest('.modal-overlay')) lastFocusOutsideModal = e.target;
});
document.addEventListener('focusout', function(e) {
  if (!e.relatedTarget && e.target === lastFocusOutsideModal) lastFocusOutsideModal = null;
});

// Z-index stacking, scroll reset, and open/close bookkeeping. Runs as a
// mutation callback, so a close immediately followed by a re-open (chained
// dialogs) is seen as "still open".
document.addEventListener('DOMContentLoaded', function() {
  var overlays = document.querySelectorAll('.modal-overlay');
  var observer = new MutationObserver(function(mutations) {
    mutations.forEach(function(m) {
      if (m.type !== 'attributes' || m.attributeName !== 'class') return;
      var el = m.target;
      if (el.classList.contains('open')) {
        modalZCounter += 10;
        el.style.zIndex = modalZCounter;
        el.querySelectorAll('.modal-body, .modal-body .basic-listing, .modal-body .hex-editor').forEach(function(scroller) {
          scroller.scrollTop = 0;
        });
      } else {
        modalCharsetRedraw = null;
      }
    });
    overlays.forEach(function(el) {
      var isOpen = el.classList.contains('open');
      if (isOpen === !!el._wasOpen) return;
      el._wasOpen = isOpen;
      if (isOpen) {
        el._prevFocus = lastFocusOutsideModal;
        return;
      }
      if (el.id === 'modal-overlay') {
        // Every opener starts from the default size and a plain footer.
        setModalSize(null);
        var footer = el.querySelector('.modal-footer');
        if (footer) footer.className = 'modal-footer';
      }
      // Return focus only if it was lost to <body> or left inside the modal.
      var prev = el._prevFocus;
      el._prevFocus = null;
      var ae = document.activeElement;
      if (prev && document.contains(prev) && typeof prev.focus === 'function' &&
          (!ae || ae === document.body || el.contains(ae))) {
        prev.focus();
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
  var footer = document.querySelector('#modal-overlay .modal-footer');
  footer.className = 'modal-footer';
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

// Open a read-only viewer: in the detail pane by default (size is ignored
// there), or in the shared modal with a plain OK footer when forceModal.
//   bodyContent: HTML string, a Node, or null to leave the body untouched.
// Returns the body element of whichever surface was used.
function showViewerModal(title, bodyContent, size, forceModal) {
  if (!forceModal && typeof openDetailPane === 'function') {
    return openDetailPane(title, bodyContent);
  }
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
  var footer = document.querySelector('#modal-overlay .modal-footer');
  footer.className = 'modal-footer';
  footer.innerHTML = '';
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

    var overlay = document.getElementById('modal-overlay');
    var footer = overlay.querySelector('.modal-footer');
    footer.className = 'modal-footer';
    footer.innerHTML = '';
    // Dismissing without a button resolves like the Cancel-style button
    // (the first secondary one), or undefined when there is none.
    var cancelBtn = buttons.filter(function(b) { return b.secondary; })[0];
    function onDismiss() { finish(cancelBtn ? cancelBtn.value : undefined); }
    function finish(value) {
      overlay.removeEventListener('modaldismiss', onDismiss);
      resolve(value);
    }
    overlay.addEventListener('modaldismiss', onDismiss);
    buttons.forEach(function(btn) {
      var el = document.createElement('button');
      el.textContent = btn.label;
      if (btn.secondary) el.className = 'modal-btn-secondary';
      el.addEventListener('click', function() {
        overlay.classList.remove('open');
        finish(btn.value);
      });
      footer.appendChild(el);
    });
    overlay.classList.add('open');
  });
}

document.getElementById('modal-overlay').addEventListener('click', (e) => {
  if (e.target === e.currentTarget) dismissModal();
});

document.getElementById('modal-close-x').addEventListener('click', dismissModal);

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
  // Handlers that consume Esc themselves (byte edit, input modal, mobile
  // menu) stop its propagation. defaultPrevented can't be used here because
  // createHexInput prevents the default of every non-hex key.
  if (e.key === 'Escape' &&
      document.getElementById('modal-overlay').classList.contains('open')) {
    e.preventDefault(); // tells the detail pane this Esc was used
    dismissModal();
    return;
  }

  // Enter triggers the primary (non-secondary) footer button. Textareas,
  // contenteditables and a focused button keep their own Enter behaviour.
  if (e.key === 'Enter' && !e.defaultPrevented &&
      document.getElementById('modal-overlay').classList.contains('open')) {
    var ae = document.activeElement;
    if (ae && (ae.tagName === 'TEXTAREA' || ae.isContentEditable)) return;
    if (ae && ae.tagName === 'BUTTON') return;
    var primary = document.querySelector('#modal-overlay .modal-footer button:not(.modal-btn-secondary):not(:disabled)');
    if (primary) {
      e.preventDefault();
      primary.click();
    }
  }

  var ae = document.activeElement;
  var inField = ae && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA' ||
                       ae.tagName === 'SELECT' || ae.isContentEditable);

  // Cursor / page keys scroll an open modal instead of the directory list.
  // Inner .basic-listing / .hex-editor scrollers win so static headers stay.
  var overlay = document.getElementById('modal-overlay');
  if (overlay && overlay.classList.contains('open')) {
    if (!inField && !e.ctrlKey && !e.altKey && !e.metaKey) {
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
  // Global shortcuts. Never while typing, and never for AltGr (reported as
  // Ctrl+Alt), which types characters like é ß ñ on international layouts.
  if (inField || !e.ctrlKey) return;
  var ctrlAlt = e.altKey && !(e.getModifierState && e.getModifierState('AltGraph'));
  var ctrlShift = e.shiftKey && !e.altKey;
  var ctrlOnly = !e.shiftKey && !e.altKey;
  var menuId = null;
  if (ctrlAlt) {
    menuId = {
      KeyG: 'opt-view-gfx', KeyH: 'opt-view-hex', KeyB: 'opt-view-basic',
      KeyP: 'opt-view-petscii', KeyD: 'opt-view-disasm',
      KeyW: 'opt-close', KeyV: 'opt-validate', KeyO: 'opt-open',
    }[e.code] || null;
  } else if (ctrlShift) {
    // Ctrl+G / Ctrl+S variants without Shift belong to the browser.
    menuId = { KeyF: 'opt-find-tabs', KeyG: 'opt-goto-sector', KeyS: 'opt-save-as' }[e.code] || null;
  } else if (ctrlOnly && e.code === 'KeyF') {
    menuId = 'opt-find';
  }
  if (menuId) {
    e.preventDefault();
    var menuEl = document.getElementById(menuId);
    if (menuEl && !menuEl.classList.contains('disabled')) menuEl.click();
    return;
  }
  // Ctrl+Alt+S: save, or Save As for a disk that has no file name yet
  if (ctrlAlt && e.code === 'KeyS') {
    e.preventDefault();
    var saveEl = document.getElementById('opt-save');
    if (saveEl.classList.contains('disabled')) saveEl = document.getElementById('opt-save-as');
    if (!saveEl.classList.contains('disabled')) saveEl.click();
    return;
  }
  // Ctrl+Alt+N: new disk (open Disk > New submenu with first option focused)
  if (ctrlAlt && e.code === 'KeyN') {
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
    // An in-progress inline rename survives the re-render: capture it and
    // skip its commit, then re-enter it on the new DOM.
    var resumeEdit = (typeof captureActiveEditResume === 'function')
      ? captureActiveEditResume() : null;
    if (resumeEdit) suppressActiveEditCommit = true;
    // Blur first: a blur handler firing mid-renderDisk innerHTML throws
    // NotFoundError in Chrome.
    var ae = document.activeElement;
    if (ae && typeof ae.blur === 'function' && ae !== document.body) ae.blur();
    document.getElementById('opt-charset-mode').click();
    if (resumeEdit) {
      suppressActiveEditCommit = false;
      setTimeout(resumeEdit, 0);
    }
  }
});

// ── Input Modal ───────────────────────────────────────────────────────
let inputModalResolve = null;

// opts (all optional):
//   description: extra line shown above the input
//   maxLen:      input maxlength + OK is disabled while value.length > maxLen or 0
function showInputModal(title, defaultValue, opts) {
  opts = opts || {};
  return new Promise((resolve) => {
    inputModalResolve = resolve;
    document.getElementById('input-modal-title').textContent = title;
    var bodyEl = document.querySelector('#input-modal-overlay .modal-body');
    var prevDescs = bodyEl.querySelectorAll('.modal-input-desc');
    for (var pi = 0; pi < prevDescs.length; pi++) prevDescs[pi].remove();
    if (opts.description) {
      var lines = String(opts.description).split('\n');
      for (var li = lines.length - 1; li >= 0; li--) {
        var desc = document.createElement('div');
        desc.className = 'modal-input-desc';
        desc.textContent = lines[li];
        bodyEl.insertBefore(desc, bodyEl.firstChild);
      }
    }
    const field = document.getElementById('input-modal-field');
    field.value = defaultValue || '';
    field.removeAttribute('maxlength');
    if (opts.maxLen) field.setAttribute('maxlength', String(opts.maxLen));

    var okBtn = document.getElementById('input-modal-ok');
    function validate() {
      var len = field.value.length;
      if (opts.maxLen) okBtn.disabled = (len === 0 || len > opts.maxLen);
      else okBtn.disabled = (len === 0);
    }
    // Replace any prior input listener (we attach a fresh one per call).
    if (field._validate) field.removeEventListener('input', field._validate);
    field._validate = validate;
    field.addEventListener('input', validate);
    validate();

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
  // Stop propagation so a modal underneath doesn't also act on the key.
  if (e.key === 'Enter') {
    e.preventDefault();
    e.stopPropagation();
    closeInputModal(document.getElementById('input-modal-field').value);
  } else if (e.key === 'Escape') {
    e.preventDefault();
    e.stopPropagation();
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

    var overlay = document.getElementById('modal-overlay');
    var modalFooter = overlay.querySelector('.modal-footer');
    modalFooter.className = 'modal-footer';
    modalFooter.innerHTML = '';
    var done = false;
    function finish(value) {
      if (done) return;
      done = true;
      overlay.removeEventListener('modaldismiss', cancel);
      overlay.classList.remove('open');
      resolve(value);
    }
    function ok() { finish(sliderRow.getValue()); }
    function cancel() { finish(null); }
    overlay.addEventListener('modaldismiss', cancel);
    var cancelBtn = document.createElement('button');
    cancelBtn.textContent = 'Cancel';
    cancelBtn.className = 'modal-btn-secondary';
    cancelBtn.addEventListener('click', cancel);
    modalFooter.appendChild(cancelBtn);
    var okBtn = document.createElement('button');
    okBtn.textContent = 'OK';
    okBtn.addEventListener('click', ok);
    modalFooter.appendChild(okBtn);

    overlay.classList.add('open');
    setTimeout(function() { sliderRow.input.focus(); sliderRow.input.select(); }, 0);
  });
}

