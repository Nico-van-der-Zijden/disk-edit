// ── Detail pane ─────────────────────────────────────────────────────────
// Docked side panel hosting the read-only viewers next to the directory list:
// drag-resizable and flippable on desktop, a full-screen overlay on phones
// (workspace.css). Width and side persist in localStorage.

var PANE_WIDTH_KEY = 'cbm-paneWidth';
var PANE_SIDE_KEY = 'cbm-paneSide';
var PANE_MIN = 240; // px — matches .detail-pane min-width
var PANE_EDGE_GAP = 200; // px the list must keep when dragging the splitter

var DIR_WIDTH = 700; // px — fixed directory-list width (var --dir-width)
// Below this the CSS stacks pane and list; keep in sync with the
// @media (max-width: 700px) block in workspace.css.
var PANE_STACK_BREAKPOINT = 700;

function applyPaneWidth(px) {
  document.body.style.setProperty('--detail-pane-width', px + 'px');
  repositionDirectory();
}

// The fixed-width directory anchors to the edge opposite the pane. Once the
// pane grows into it, its near edge stays glued to the pane and the far edge
// slides off-screen.
function repositionDirectory() {
  var workspace = document.getElementById('workspace');
  var content = document.getElementById('content');
  if (!workspace || !content) return;
  var avail = workspace.clientWidth;
  if (avail <= PANE_STACK_BREAKPOINT) { content.style.left = ''; content.style.width = ''; return; }

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
    left = (dirW <= free) ? (avail - dirW) /* anchor far-right */
                          : occupied;       /* glued to pane, slides off right */
  } else {
    left = (dirW <= free) ? 0               /* anchor far-left */
                          : (free - dirW);  /* glued to pane, slides off left */
  }
  content.style.left = Math.round(left) + 'px';
  content.style.width = dirW + 'px';
}

// Open (or update) the pane; content is an HTML string or Node. Returns the
// pane body. Clears modalCharsetRedraw so a previous viewer's redraw can't
// fire for this one.
function openDetailPane(title, content) {
  var pane = document.getElementById('detail-pane');
  var titleEl = document.getElementById('detail-pane-title');
  var body = document.getElementById('detail-pane-body');
  if (!pane || !body) return null;
  paneOpenCount++;
  // A new view replaces the old one; the viewer registers itself after this.
  if (!paneRerunning) { paneView = null; paneTab = activeTabId; }

  titleEl.textContent = title || '';
  if (typeof content === 'string') body.innerHTML = content;
  else if (content instanceof Node) { body.innerHTML = ''; body.appendChild(content); }
  body.scrollTop = 0;
  modalCharsetRedraw = null;
  // Empty footer is hidden by #detail-pane-footer:empty.
  var footer = document.getElementById('detail-pane-footer');
  if (footer) { footer.className = 'modal-footer'; footer.innerHTML = ''; }

  showPaneFrame();
  return body;
}

function showPaneFrame() {
  document.body.classList.add('pane-open');
  document.getElementById('detail-pane').setAttribute('aria-hidden', 'false');
  repositionDirectory();
}

function hidePaneFrame() {
  document.body.classList.remove('pane-open');
  document.getElementById('detail-pane').setAttribute('aria-hidden', 'true');
  repositionDirectory();
}

function closeDetailPane() {
  var pane = document.getElementById('detail-pane');
  if (!pane) return;
  paneView = null;
  paneTab = null;
  paneStale = false;
  modalCharsetRedraw = null;
  var body = document.getElementById('detail-pane-body');
  if (body) body.innerHTML = '';
  hidePaneFrame();
}

function isDetailPaneOpen() {
  return document.body.classList.contains('pane-open');
}

// ── What the pane shows, per tab ───────────────────────────────────────
// Every view registers how to redraw itself (setPaneView). The redraw runs
// after an edit to the disk, keeping scroll positions and inner tabs; file
// views find their file again by its start T/S (or, on IDE64, its data
// tree pointer) and close when it's gone. Each tab keeps its own pane:
// leaving a tab parks the pane's content on it, coming back puts it back
// as it was, and closing the tab drops it.
//
// paneTab: the tab the open pane belongs to (set on open, registered or not).
// paneView: { kind: 'disk' | 'file', rerun(), location }, null for content
// that doesn't redraw itself (a form).
var paneTab = null;
var paneView = null;
var paneByTab = {};       // tabId -> parked pane of a tab not in front
var paneStale = false;    // the disk changed since the view was drawn
var paneRerunning = false;
var paneOpenCount = 0;    // bumped by openDetailPane: did a call open the pane?

// Where in the disk the listing is (partition, CMD slice, CFS dir).
function paneLocationKey() {
  var p = typeof currentPartition !== 'undefined' ? currentPartition : null;
  return [
    p ? (p.dnpDir ? 'd' + p.dnpHeaderT + '/' + p.dnpHeaderS : 'p' + p.startTrack) : '',
    typeof cmdcPartitionIdx !== 'undefined' ? cmdcPartitionIdx : -1,
    typeof cfsPartitionIdx !== 'undefined' ? cfsPartitionIdx : -1,
    typeof cfsDirLba !== 'undefined' ? cfsDirLba : 0
  ].join('|');
}

// rerun() redraws the view; it returns false when there's nothing left to
// show (the file is gone), which closes the pane.
function setPaneView(kind, rerun) {
  if (!isDetailPaneOpen()) return;
  paneView = { kind: kind, rerun: rerun, location: paneLocationKey() };
}

// Called before every change to the disk (pushUndo, undo, redo, rollback).
function markPaneStale() {
  if (paneView && paneTab === activeTabId) paneStale = true;
}

// Scroll offsets and active inner tabs of the pane, to carry over a redraw.
function capturePaneState() {
  var body = document.getElementById('detail-pane-body');
  var scrolls = [];
  [body].concat(Array.prototype.slice.call(body.querySelectorAll('*'))).forEach(function(el) {
    if (!el.scrollTop && !el.scrollLeft) return;
    var cls = el === body ? null : el.getAttribute('class');
    if (el !== body && !cls) return;
    scrolls.push({ cls: cls, top: el.scrollTop, left: el.scrollLeft });
  });
  var tabs = [];
  body.querySelectorAll('.active').forEach(function(el) {
    var base = Array.prototype.find.call(el.classList, function(c) { return /-tab$/.test(c); });
    var attr = Array.prototype.find.call(el.attributes, function(a) { return a.name.indexOf('data-') === 0; });
    if (base && attr) tabs.push({ base: base, attr: attr.name, value: attr.value });
  });
  return { scrolls: scrolls, tabs: tabs };
}

function restorePaneState(state) {
  var body = document.getElementById('detail-pane-body');
  state.tabs.forEach(function(t) {
    var el = body.querySelector('.' + t.base + '[' + t.attr + '="' + t.value + '"]');
    if (el && !el.classList.contains('active')) el.click();
  });
  state.scrolls.forEach(function(s) {
    var el = s.cls === null ? body : body.querySelector('.' + s.cls.trim().split(/\s+/).join('.'));
    if (el) { el.scrollTop = s.top; el.scrollLeft = s.left; }
  });
}

// After the listing redraws: redraw the view if the disk changed. A
// disk-wide view also follows a move to another partition or subdir; a
// file view waits until the listing is back where its file is.
function refreshPaneView() {
  if (paneRerunning || !paneView || paneTab !== activeTabId || !isDetailPaneOpen()) return;
  var here = paneLocationKey();
  var moved = paneView.location !== here;
  if (paneView.kind === 'file' ? (!paneStale || moved) : (!paneStale && !moved)) return;
  paneStale = false;
  var state = capturePaneState();
  var view = paneView;
  var opened = paneOpenCount;
  var ok;
  paneRerunning = true;
  try { ok = view.rerun(); } finally { paneRerunning = false; }
  if (ok === false || paneOpenCount === opened) { closeDetailPane(); return; }
  if (paneView) paneView.location = here;
  restorePaneState(state);
}

// After the tab bar redraws: park the pane of the tab we left, bring back
// the active tab's own pane, forget panes of closed tabs.
function syncPaneToActiveTab() {
  if (paneRerunning) return;
  var body = document.getElementById('detail-pane-body');
  if (!body) return;
  if (isDetailPaneOpen() && paneTab !== activeTabId) {
    var footer = document.getElementById('detail-pane-footer');
    var parked = {
      view: paneView, stale: paneStale, redraw: modalCharsetRedraw,
      title: document.getElementById('detail-pane-title').textContent,
      state: capturePaneState(),
      body: document.createDocumentFragment(),
      footer: document.createDocumentFragment(),
      footerClass: footer.className
    };
    while (body.firstChild) parked.body.appendChild(body.firstChild);
    while (footer.firstChild) parked.footer.appendChild(footer.firstChild);
    if (paneTab !== null) paneByTab[paneTab] = parked;
    paneView = null;
    paneTab = null;
    paneStale = false;
    modalCharsetRedraw = null;
    hidePaneFrame();
  }
  var live = {};
  (typeof tabs !== 'undefined' ? tabs : []).forEach(function(t) { live[t.id] = true; });
  Object.keys(paneByTab).forEach(function(id) { if (!live[id]) delete paneByTab[id]; });
  var saved = activeTabId !== null ? paneByTab[activeTabId] : null;
  if (saved && !isDetailPaneOpen()) {
    delete paneByTab[activeTabId];
    paneTab = activeTabId;
    body.innerHTML = '';
    body.appendChild(saved.body);
    var footerEl = document.getElementById('detail-pane-footer');
    footerEl.innerHTML = '';
    footerEl.className = saved.footerClass;
    footerEl.appendChild(saved.footer);
    document.getElementById('detail-pane-title').textContent = saved.title;
    paneView = saved.view;
    paneStale = saved.stale;
    modalCharsetRedraw = saved.redraw;
    showPaneFrame();
    restorePaneState(saved.state);
  }
}

// ── Registering the viewers ────────────────────────────────────────────
// A CBM-DOS file view's entry: the one at entryOff when it still starts at
// the same T/S, else the live entry that does (Remove shifts entries up).
// -1 when the file is gone (scratched, removed).
function findPaneCbmFile(entryOff, t, s) {
  if (!currentBuffer) return -1;
  var d = new Uint8Array(currentBuffer);
  function same(off) { return d[off + 2] !== 0 && d[off + 3] === t && d[off + 4] === s; }
  if (entryOff >= 0 && entryOff + 32 <= d.length && same(entryOff)) return entryOff;
  if (t === 0) return -1;
  var slots = typeof getDirSlotOffsets === 'function' ? getDirSlotOffsets(currentBuffer) : [];
  for (var i = 0; i < slots.length; i++) if (same(slots[i])) return slots[i];
  return -1;
}

// Wrap a file viewer fn(entryOff, ..., preloaded, ...) so it registers a
// redraw; entryArg / preloadArg are the argument positions (-1: none).
function paneFileViewer(fn, entryArg, preloadArg) {
  return function() {
    var args = Array.prototype.slice.call(arguments);
    var opened = paneOpenCount;
    var result = fn.apply(this, args);
    if (paneRerunning || paneOpenCount === opened || !isDetailPaneOpen()) return result;
    var preloaded = preloadArg >= 0 ? args[preloadArg] : null;
    var rerun;
    if (preloaded) {
      // IDE64: find the entry again by its data tree and reload its bytes.
      var entry = (typeof cfsPartitionIdx !== 'undefined' && cfsPartitionIdx >= 0 && cfsDirEntries)
        ? cfsDirEntries[selectedEntryIndex] : null;
      var treeAddr = entry && entry.dataTreePtr && entry.dataTreePtr.lba ? entry.dataTreePtr.addr : null;
      rerun = function() {
        if (treeAddr === null) return fn.apply(null, args); // nothing to reload from
        var hit = (readCfsDirectory(hddBuffer, cfsDirLba) || []).find(function(e) {
          return !e.empty && e.ftype !== CFS_FTYPE.DEL && e.dataTreePtr && e.dataTreePtr.addr === treeAddr;
        });
        if (!hit) return false;
        var again = args.slice();
        again[preloadArg] = cfsLoadFileForViewer(hit);
        fn.apply(null, again);
      };
    } else {
      var off = args[entryArg];
      var d = new Uint8Array(currentBuffer);
      var t = d[off + 3], s = d[off + 4];
      rerun = function() {
        var now = findPaneCbmFile(off, t, s);
        if (now < 0) return false;
        off = now;
        var again = args.slice();
        again[entryArg] = now;
        fn.apply(null, again);
      };
    }
    setPaneView('file', rerun);
    return result;
  };
}

// Wrap a disk-wide view: redrawing it is calling it again.
function paneDiskViewer(fn) {
  return function() {
    var args = arguments, self = this;
    var opened = paneOpenCount;
    var result = fn.apply(self, args);
    if (!paneRerunning && paneOpenCount !== opened && isDetailPaneOpen()) {
      setPaneView('disk', function() { fn.apply(self, args); });
    }
    return result;
  };
}

function installPaneViewers() {
  function wrapGlobal(name, wrapper) {
    if (typeof window[name] === 'function') window[name] = wrapper(window[name]);
  }
  // fn(entryOff, preloaded)
  ['showFileHexViewer', 'showFilePetsciiViewer', 'showFileDisasmViewer',
   'showFileTassViewer', 'showFileGfxViewer'].forEach(function(n) {
    wrapGlobal(n, function(fn) { return paneFileViewer(fn, 0, 1); });
  });
  wrapGlobal('showFileBasicRendered', function(fn) { return paneFileViewer(fn, 0, 2); });
  // fn(entryOff)
  ['showFileInfo', 'showGeoWriteViewer', 'showRelViewer', 'showVlirInspector'].forEach(function(n) {
    wrapGlobal(n, function(fn) { return paneFileViewer(fn, 0, -1); });
  });
  wrapGlobal('showIde64BamModal', paneDiskViewer);

  // Comparison: redraw by comparing the disk again with the same other one.
  var lastCompare = null;
  wrapGlobal('runCompareWith', function(fn) {
    return function(otherBuffer, otherFileName, otherTabName) {
      lastCompare = { other: otherBuffer, label: otherTabName || otherFileName || 'compared' };
      return fn.apply(this, arguments);
    };
  });
  wrapGlobal('showCompareResultModal', function(fn) {
    return function() {
      var opened = paneOpenCount;
      var result = fn.apply(this, arguments);
      if (!paneRerunning && paneOpenCount !== opened && lastCompare) {
        var c = lastCompare;
        setPaneView('disk', function() {
          var a = readDiskForCompare(currentBuffer), b = readDiskForCompare(c.other);
          fn(a, b, computeCompareDiff(a, b), currentFileName || 'unnamed', c.label);
        });
      }
      return result;
    };
  });

  // Views opened straight from a menu handler: redraw = choose it again.
  // GEOS File Info shows the selected entry, so it's a file view.
  var menuViews = { 'opt-view-bam': 'disk', 'opt-view-errors': 'disk',
                    'opt-g64-layout': 'disk', 'opt-view-border': 'disk', 'opt-view-geos': 'file' };
  // The handlers stop propagation, so look from the capture phase and
  // register once the click has been handled.
  document.addEventListener('click', function(e) {
    var id = e.target && e.target.id;
    var kind = menuViews[id];
    if (!kind || paneRerunning) return;
    var openedBefore = paneOpenCount;
    var off = selectedEntryIndex;
    setTimeout(function() {
      if (paneOpenCount === openedBefore || !isDetailPaneOpen() || !currentBuffer) return;
      if (kind === 'disk') {
        setPaneView('disk', function() { document.getElementById(id).click(); });
        return;
      }
      var d = new Uint8Array(currentBuffer);
      var t = d[off + 3], s = d[off + 4];
      setPaneView('file', function() {
        var now = findPaneCbmFile(off, t, s);
        if (now < 0) return false;
        off = now;
        var keep = selectedEntryIndex;
        selectedEntryIndex = now;
        document.getElementById(id).click();
        selectedEntryIndex = keep;
      });
    }, 0);
  }, true);

  // Hooks: redraw after the listing updates; follow the active tab.
  ['renderDisk', 'refreshIde64View', 'refreshCmdContainerView'].forEach(function(n) {
    wrapGlobal(n, function(fn) {
      return function() { var r = fn.apply(this, arguments); refreshPaneView(); return r; };
    });
  });
  wrapGlobal('renderTabs', function(fn) {
    return function() { var r = fn.apply(this, arguments); syncPaneToActiveTab(); return r; };
  });
}

document.addEventListener('DOMContentLoaded', function() {
  // Every script has run by now, so the viewers exist to be wrapped.
  installPaneViewers();

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

  // Esc closes the pane unless something else used it first: the modal Esc
  // handler (registered earlier) marks the event with preventDefault.
  document.addEventListener('keydown', function(e) {
    if (e.key !== 'Escape' || e.defaultPrevented || !isDetailPaneOpen()) return;
    if (document.querySelector('.modal-overlay.open')) return;
    closeDetailPane();
  });
});
