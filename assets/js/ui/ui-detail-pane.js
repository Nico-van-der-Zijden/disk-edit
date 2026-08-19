// ── Detail pane ─────────────────────────────────────────────────────────
// A docked side panel that hosts read-only viewers (hex first, more to
// follow) next to the directory list instead of popping them in a modal.
// On desktop it sits beside the list with a drag-resizable splitter and can
// be flipped to either side; on phones the CSS in workspace.css re-positions
// it as a full-screen overlay. Width and side are remembered across sessions
// under the project's cbm-* localStorage convention.

var PANE_WIDTH_KEY = 'cbm-paneWidth';
var PANE_SIDE_KEY = 'cbm-paneSide';
var PANE_MIN = 240; // px — matches .detail-pane min-width
var PANE_EDGE_GAP = 200; // px the list must keep when dragging the splitter

var DIR_WIDTH = 700; // px — fixed directory-list width (var --dir-width)

function applyPaneWidth(px) {
  document.body.style.setProperty('--detail-pane-width', px + 'px');
  repositionDirectory();
}

// Place the fixed-width directory list. It never shrinks; it anchors to the
// screen edge OPPOSITE the pane's side (so it stays clear of the pane and of
// centered floating modals) and stays put there. When closed the pane simply
// occupies no width, so the same rule parks the directory against that edge.
// Once the pane grows enough to reach the directory, the directory's near
// edge stays glued to the pane while its far edge slides off-screen. Below
// 700px the CSS takes over (full width).
function repositionDirectory() {
  var workspace = document.getElementById('workspace');
  var content = document.getElementById('content');
  if (!workspace || !content) return;
  var avail = workspace.clientWidth;
  if (avail <= 700) { content.style.left = ''; content.style.width = ''; return; }

  var dirW = Math.min(DIR_WIDTH, avail);
  var occupied = 0;
  if (isDetailPaneOpen()) {
    var pane = document.getElementById('detail-pane');
    var splitter = document.getElementById('pane-splitter');
    occupied = pane.getBoundingClientRect().width +
               (splitter ? splitter.getBoundingClientRect().width : 0);
  }
  var free = avail - occupied;
  var left;
  if (document.body.classList.contains('pane-left')) {
    // Pane lives on the left; directory anchors to the opposite (right) edge,
    // slack pooled between them — until the pane reaches it, then it slides.
    left = (dirW <= free) ? (avail - dirW) /* anchor far-right */
                          : occupied;       /* glued to pane, slides off right */
  } else {
    // Pane lives on the right; directory anchors to the opposite (left) edge.
    left = (dirW <= free) ? 0               /* anchor far-left */
                          : (free - dirW);  /* glued to pane, slides off left */
  }
  content.style.left = Math.round(left) + 'px';
  content.style.width = dirW + 'px';
}

// Open (or update) the detail pane with a viewer.
//   title:   header text
//   content: HTML string or Node for the body
// Returns the pane body element. Charset re-render is handled the same way as
// for modals: the caller assigns a closure to the global modalCharsetRedraw
// (writing through getViewerBody), and the shared cbm-charsetchange handler in
// ui-modals.js fires it. We clear that slot here so a previous viewer's render
// doesn't fire for a viewer that doesn't paint PETSCII.
function openDetailPane(title, content) {
  var pane = document.getElementById('detail-pane');
  var titleEl = document.getElementById('detail-pane-title');
  var body = document.getElementById('detail-pane-body');
  if (!pane || !body) return null;

  titleEl.textContent = title || '';
  if (typeof content === 'string') body.innerHTML = content;
  else if (content instanceof Node) { body.innerHTML = ''; body.appendChild(content); }
  body.scrollTop = 0;
  modalCharsetRedraw = null;
  // Reset the footer — a viewer that wants one populates it via
  // getViewerFooter() after this returns; footerless viewers leave it empty
  // (hidden by #detail-pane-footer:empty).
  var footer = document.getElementById('detail-pane-footer');
  if (footer) { footer.className = 'modal-footer'; footer.innerHTML = ''; }

  document.body.classList.add('pane-open');
  pane.setAttribute('aria-hidden', 'false');
  repositionDirectory();
  return body;
}

function closeDetailPane() {
  var pane = document.getElementById('detail-pane');
  if (!pane) return;
  document.body.classList.remove('pane-open');
  pane.setAttribute('aria-hidden', 'true');
  modalCharsetRedraw = null;
  var body = document.getElementById('detail-pane-body');
  if (body) body.innerHTML = '';
  repositionDirectory();
}

function isDetailPaneOpen() {
  return document.body.classList.contains('pane-open');
}

document.addEventListener('DOMContentLoaded', function() {
  // Restore remembered width + side.
  var savedWidth = parseInt(localStorage.getItem(PANE_WIDTH_KEY), 10);
  if (savedWidth >= PANE_MIN) applyPaneWidth(savedWidth);
  if (localStorage.getItem(PANE_SIDE_KEY) === 'left') document.body.classList.add('pane-left');

  var closeBtn = document.getElementById('detail-pane-close');
  if (closeBtn) closeBtn.addEventListener('click', closeDetailPane);

  var flipBtn = document.getElementById('detail-pane-flip');
  if (flipBtn) flipBtn.addEventListener('click', function() {
    var nowLeft = document.body.classList.toggle('pane-left');
    localStorage.setItem(PANE_SIDE_KEY, nowLeft ? 'left' : 'right');
    repositionDirectory();
  });

  // Keep the directory placed correctly as the viewport changes.
  window.addEventListener('resize', repositionDirectory);
  repositionDirectory();

  // Splitter drag-resize. Width is measured from the workspace edge the pane
  // is docked against, so the math is correct on either side.
  var splitter = document.getElementById('pane-splitter');
  var workspace = document.getElementById('workspace');
  if (splitter && workspace) {
    var onMove = function(e) {
      var clientX = e.touches ? e.touches[0].clientX : e.clientX;
      var rect = workspace.getBoundingClientRect();
      var dockedLeft = document.body.classList.contains('pane-left');
      var width = dockedLeft ? (clientX - rect.left) : (rect.right - clientX);
      var max = rect.width - PANE_EDGE_GAP;
      width = Math.max(PANE_MIN, Math.min(width, max));
      applyPaneWidth(Math.round(width));
    };
    var onUp = function() {
      document.body.classList.remove('pane-resizing');
      splitter.classList.remove('dragging');
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onUp);
      var w = parseInt(document.body.style.getPropertyValue('--detail-pane-width'), 10);
      if (w >= PANE_MIN) localStorage.setItem(PANE_WIDTH_KEY, w);
    };
    splitter.addEventListener('pointerdown', function(e) {
      e.preventDefault();
      document.body.classList.add('pane-resizing');
      splitter.classList.add('dragging');
      document.addEventListener('pointermove', onMove);
      document.addEventListener('pointerup', onUp);
    });
  }

  // Esc closes the pane — but only when no modal is on top (modals own Esc
  // when open, so we don't steal it from them).
  document.addEventListener('keydown', function(e) {
    if (e.key !== 'Escape' || !isDetailPaneOpen()) return;
    if (document.querySelector('.modal-overlay.open')) return;
    closeDetailPane();
  });
});
