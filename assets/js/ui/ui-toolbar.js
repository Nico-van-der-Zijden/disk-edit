// ── Toolbar ──────────────────────────────────────────────────────────
// Thin icon strip under the menubar. Each .toolbar-btn carries a
// data-cmd pointing at the menu item it should fire. Enabled/disabled
// state is mirrored from the original menu items so the toolbar never
// invents its own state — refreshToolbarState() reads classList from
// the live menu items and toggles the toolbar buttons to match.
//
// Visibility is gated by the body.toolbar-on class. The Options →
// Show Toolbar item flips it and persists to localStorage.

var toolbarVisible = localStorage.getItem('cbm-toolbar') !== 'false';

function applyToolbarVisibility() {
  document.body.classList.toggle('toolbar-on', toolbarVisible);
}

function refreshToolbarState() {
  var bar = document.getElementById('toolbar');
  if (!bar) return;
  bar.querySelectorAll('.toolbar-btn[data-cmd]').forEach(function(btn) {
    var target = document.getElementById(btn.getAttribute('data-cmd'));
    btn.classList.toggle('disabled', !target || target.classList.contains('disabled'));
  });
}

(function bindToolbar() {
  var bar = document.getElementById('toolbar');
  if (!bar) return;
  bar.addEventListener('click', function(e) {
    var btn = e.target.closest('.toolbar-btn[data-cmd]');
    if (!btn || btn.classList.contains('disabled')) return;
    var target = document.getElementById(btn.getAttribute('data-cmd'));
    if (target) target.click();
  });
})();
