// ── Mobile menu ───────────────────────────────────────────────────────
// Drill-down menu shown instead of the desktop menubar on narrow screens.
// It renders from the live desktop menu DOM and activates a leaf by
// clicking the original element, so it never duplicates menu data.

// Keep in sync with the @media (max-width: 900px) block in menus.css.
var MOBILE_MENU_BREAKPOINT = 900;

(function() {
  var menubarEl = document.querySelector('.menubar');
  var hamburger = document.getElementById('menubar-hamburger');
  if (!menubarEl || !hamburger) return;

  var mmRoot = null, mmTitleEl = null, mmListEl = null, mmBackBtn = null;
  // Navigation path: [{ label, parentEl (desktop element), scrollTop }]
  var pathStack = [];
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

  // Own label text, without nested dropdowns / submenus / check marks.
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

  // mm-item HTML for the visible options of one desktop container. Items the
  // desktop menu hides (style.display = 'none') are skipped, and separators
  // are collapsed so none lead, trail or double up.
  function renderChildren(container) {
    var html = '';
    var anyCheck = false;
    var pendingSep = false, emittedItem = false;
    var children = Array.from(container.children).filter(function(child) {
      return child.style.display !== 'none';
    });
    // Keep the label column aligned when any row has a check mark.
    children.forEach(function(child) {
      if (child.querySelector(':scope > .check')) anyCheck = true;
    });
    children.forEach(function(child) {
      if (child.classList.contains('separator')) {
        if (emittedItem) pendingSep = true;
        return;
      }
      var isOption = child.classList.contains('option');
      var isMenuItem = child.classList.contains('menu-item');
      if (!isOption && !isMenuItem) return;
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
      if (pendingSep) html += '<div class="mm-separator"></div>';
      pendingSep = false;
      emittedItem = true;
      html +=
        '<button type="button" role="menuitem"' +
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
      mmTitleEl.textContent = 'Menu';
      mmBackBtn.hidden = true;
      var html = '';
      Array.from(menubarEl.querySelectorAll(':scope > .menubar-items > .menu-item, :scope > .menu-item')).forEach(function(menuItem) {
        var label = labelOf(menuItem);
        if (!label) return;
        var ref = refFor(menuItem);
        html +=
          '<button type="button" role="menuitem" class="mm-item mm-has-submenu" data-mm-ref="' + ref + '">' +
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
    // Close first (and click on the next tick) so a dialog the option opens
    // isn't covered by the menu.
    close();
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

  // Esc steps back one level, then closes. Captured and stopped here so the
  // modal / detail-pane Esc handlers never see it.
  document.addEventListener('keydown', function(e) {
    if (!mmRoot || !mmRoot.classList.contains('mm-open')) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      if (pathStack.length > 0) navigateBack();
      else close();
    }
  }, true);

  window.addEventListener('resize', function() {
    if (mmRoot && mmRoot.classList.contains('mm-open') && window.innerWidth > MOBILE_MENU_BREAKPOINT) {
      close();
    }
  });
})();
