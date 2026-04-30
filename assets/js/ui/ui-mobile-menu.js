// ──────────────────────────────────────────────────────────────────────
// ui-mobile-menu.js — touch-first drill-down menu for narrow screens
// ──────────────────────────────────────────────────────────────────────
//
// At ≤ 900px the desktop menubar's items are hidden via CSS; tapping
// the hamburger button opens this component instead. Each level of the
// menu is rendered as a flat list — taps on a row either drill into a
// submenu or fire the original desktop option's click handler. The
// drill-down model avoids the accordion's tap-precision problems where
// a tap meant for the "Help" header lands on a "Changelog" row that
// happened to be rendered inline below it.
//
// Single source of truth: this module never duplicates the menu data.
// It walks the existing desktop menubar DOM (.menubar .menu-item, their
// .menu-dropdown / .submenu children) and triggers .click() on the
// original element when the user activates a leaf row. All existing
// option click handlers continue to work unchanged.

(function() {
  var menubarEl = document.querySelector('.menubar');
  var hamburger = document.getElementById('menubar-hamburger');
  if (!menubarEl || !hamburger) return;

  var mmRoot = null, mmTitleEl = null, mmListEl = null, mmBackBtn = null;
  // Stack of { label, parentEl, scrollTop } describing the navigation
  // path. parentEl is the desktop element whose children we're showing
  // (a top-level .menu-item, or any .has-submenu/.option that contains
  // a .menu-dropdown / .submenu).
  var pathStack = [];
  // Used to look up the original DOM element from a clicked mm-item.
  var nextRef = 1;
  var refToEl = new Map();

  function refFor(el) {
    var ref = el.dataset.mmRef;
    if (ref && refToEl.get(ref) === el) return ref;
    ref = 'mm' + (nextRef++);
    el.dataset.mmRef = ref;
    refToEl.set(ref, el);
    return ref;
  }

  function escHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  // The label text of an option / menu-item without the contents of any
  // nested .menu-dropdown / .submenu / .check span. We clone-and-strip
  // because the real elements have a lot of nested HTML for desktop.
  function labelOf(el) {
    var clone = el.cloneNode(true);
    clone.querySelectorAll('.menu-dropdown, .submenu, .check').forEach(function(n) {
      n.remove();
    });
    return clone.textContent.replace(/\s+/g, ' ').trim();
  }

  function ensureRoot() {
    if (mmRoot) return;
    mmRoot = document.createElement('div');
    mmRoot.className = 'mm-root';
    mmRoot.id = 'mobile-menu';
    mmRoot.innerHTML =
      '<div class="mm-header">' +
        '<button class="mm-back" type="button" aria-label="Back" hidden>' +
          '<i class="fa-solid fa-chevron-left"></i>' +
        '</button>' +
        '<div class="mm-title"></div>' +
        '<button class="mm-close" type="button" aria-label="Close">' +
          '<i class="fa-solid fa-xmark"></i>' +
        '</button>' +
      '</div>' +
      '<div class="mm-list" role="menu"></div>';
    document.body.appendChild(mmRoot);

    mmTitleEl = mmRoot.querySelector('.mm-title');
    mmListEl = mmRoot.querySelector('.mm-list');
    mmBackBtn = mmRoot.querySelector('.mm-back');

    mmBackBtn.addEventListener('click', function(e) {
      e.stopPropagation();
      navigateBack();
    });
    mmRoot.querySelector('.mm-close').addEventListener('click', function(e) {
      e.stopPropagation();
      close();
    });
    mmListEl.addEventListener('click', onListClick);
  }

  // Walk the children of a desktop container and emit mm-item HTML for
  // each .option (or .menu-item at the top level). Separators become
  // visual dividers; .has-submenu rows get a chevron and are tagged
  // .mm-has-submenu.
  function renderChildren(container) {
    var html = '';
    var anyCheck = false;
    var children = Array.from(container.children);
    // Detect whether any sibling has a .check span so we can keep the
    // label column aligned across rows.
    children.forEach(function(child) {
      if (child.querySelector(':scope > .check')) anyCheck = true;
    });
    children.forEach(function(child) {
      if (child.classList.contains('separator')) {
        html += '<div class="mm-separator"></div>';
        return;
      }
      var isOption = child.classList.contains('option');
      var isMenuItem = child.classList.contains('menu-item');
      if (!isOption && !isMenuItem) return;
      // Skip anything internal that shouldn't appear (parent-row,
      // header-row, etc. shouldn't be inside menu containers anyway).
      var isHasSubmenu = child.classList.contains('has-submenu');
      var hasNestedDropdown = !!child.querySelector(':scope > .menu-dropdown, :scope > .submenu');
      var disabled = child.classList.contains('disabled');
      var label = labelOf(child);
      if (!label) return;
      var ref = refFor(child);
      var checkSpan = child.querySelector(':scope > .check');
      var checkHtml = anyCheck
        ? '<span class="mm-check">' + (checkSpan ? checkSpan.innerHTML : '') + '</span>'
        : '';
      var chev = (isHasSubmenu || hasNestedDropdown)
        ? '<i class="fa-solid fa-chevron-right mm-chevron"></i>'
        : '';
      html +=
        '<button type="button"' +
          ' class="mm-item' +
            ((isHasSubmenu || hasNestedDropdown) ? ' mm-has-submenu' : '') +
            (disabled ? ' mm-disabled' : '') +
            (anyCheck ? ' mm-has-check' : '') +
          '"' +
          ' data-mm-ref="' + ref + '"' +
          (disabled ? ' disabled' : '') +
        '>' +
          checkHtml +
          '<span class="mm-label">' + escHtml(label) + '</span>' +
          chev +
        '</button>';
    });
    return html;
  }

  function render() {
    ensureRoot();
    if (pathStack.length === 0) {
      // Top level: list each .menu-item in the menubar (always
      // navigable since menu-items always have a dropdown).
      mmTitleEl.textContent = 'Menu';
      mmBackBtn.hidden = true;
      var html = '';
      Array.from(menubarEl.querySelectorAll(':scope > .menubar-items > .menu-item, :scope > .menu-item')).forEach(function(menuItem) {
        var label = labelOf(menuItem);
        if (!label) return;
        var ref = refFor(menuItem);
        html +=
          '<button type="button" class="mm-item mm-has-submenu" data-mm-ref="' + ref + '">' +
            '<span class="mm-label">' + escHtml(label) + '</span>' +
            '<i class="fa-solid fa-chevron-right mm-chevron"></i>' +
          '</button>';
      });
      mmListEl.innerHTML = html;
      mmListEl.scrollTop = 0;
      return;
    }
    var current = pathStack[pathStack.length - 1];
    mmTitleEl.textContent = current.label;
    mmBackBtn.hidden = false;
    var children = current.parentEl.querySelector(':scope > .menu-dropdown, :scope > .submenu');
    mmListEl.innerHTML = children ? renderChildren(children) : '';
    mmListEl.scrollTop = current.scrollTop || 0;
  }

  function navigateInto(el) {
    if (pathStack.length > 0) {
      pathStack[pathStack.length - 1].scrollTop = mmListEl.scrollTop;
    }
    pathStack.push({ label: labelOf(el), parentEl: el, scrollTop: 0 });
    render();
  }

  function navigateBack() {
    if (pathStack.length === 0) return;
    pathStack.pop();
    render();
  }

  function onListClick(e) {
    var item = e.target.closest('.mm-item');
    if (!item) return;
    if (item.classList.contains('mm-disabled')) return;
    e.stopPropagation();
    e.preventDefault();
    var ref = item.dataset.mmRef;
    var orig = refToEl.get(ref);
    if (!orig) return;
    if (item.classList.contains('mm-has-submenu')) {
      navigateInto(orig);
      return;
    }
    // Leaf option: close the mobile menu first so any modal/dialog the
    // option opens isn't covered by us, then dispatch a click on the
    // original desktop element. Closing first also frees up any focus
    // states that the action might want.
    close();
    // Dispatch the click asynchronously so the close paint happens
    // first — avoids visible overlap on slower devices.
    setTimeout(function() { orig.click(); }, 0);
  }

  function open() {
    ensureRoot();
    pathStack = [];
    render();
    mmRoot.classList.add('mm-open');
    hamburger.setAttribute('aria-expanded', 'true');
  }

  function close() {
    if (!mmRoot) return;
    mmRoot.classList.remove('mm-open');
    hamburger.setAttribute('aria-expanded', 'false');
  }

  hamburger.addEventListener('click', function(e) {
    e.stopPropagation();
    if (mmRoot && mmRoot.classList.contains('mm-open')) {
      close();
    } else {
      open();
    }
  });

  // ESC key — when the menu is open, prefer "back" over "close" so the
  // user can step out one level at a time on a hardware keyboard.
  document.addEventListener('keydown', function(e) {
    if (!mmRoot || !mmRoot.classList.contains('mm-open')) return;
    if (e.key === 'Escape') {
      e.stopPropagation();
      if (pathStack.length > 0) navigateBack();
      else close();
    }
  });

  // If the viewport widens past the breakpoint while the menu is open,
  // close it so we don't leave a stale overlay in front of the desktop
  // menubar.
  window.addEventListener('resize', function() {
    if (mmRoot && mmRoot.classList.contains('mm-open') && window.innerWidth > 900) {
      close();
    }
  });
})();
