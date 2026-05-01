// ── Recent disks list ────────────────────────────────────────────────
// Keeps up to 10 recently-opened disks in IndexedDB along with their raw
// bytes, so clicking a Recent menu entry reopens the same disk instantly
// (as a new tab) without re-prompting the file picker.
//
// Why IndexedDB and not localStorage? localStorage is capped to ~5–10 MB
// per origin; a single 16 MB DNP would blow past that. IndexedDB lets us
// keep up to ~10 disks of any size the browser will let us store (DNP
// gets up to 16 MB, D4M up to 3 MB; typical D64 is 175 KB).

var RECENT_DB_NAME = 'cbm-disk-editor';
var RECENT_STORE = 'recent';
var RECENT_MAX = 10;

// In-memory cache of recent entries (sorted newest first).
// Each entry: { id, name, size, tracks, formatName, timestamp, bytes (ArrayBuffer) }
var recentCache = [];

function _openRecentDb() {
  return new Promise(function(resolve, reject) {
    if (typeof indexedDB === 'undefined') { reject(new Error('IndexedDB unavailable')); return; }
    var req = indexedDB.open(RECENT_DB_NAME, 1);
    req.onupgradeneeded = function(ev) {
      var db = ev.target.result;
      if (!db.objectStoreNames.contains(RECENT_STORE)) {
        db.createObjectStore(RECENT_STORE, { keyPath: 'id' });
      }
    };
    req.onsuccess = function() { resolve(req.result); };
    req.onerror = function() { reject(req.error); };
  });
}

function _dbTx(mode) {
  return _openRecentDb().then(function(db) {
    return db.transaction(RECENT_STORE, mode).objectStore(RECENT_STORE);
  });
}

function _dbGetAll() {
  return _dbTx('readonly').then(function(store) {
    return new Promise(function(resolve, reject) {
      var req = store.getAll();
      req.onsuccess = function() { resolve(req.result || []); };
      req.onerror = function() { reject(req.error); };
    });
  });
}

function _dbPut(entry) {
  return _dbTx('readwrite').then(function(store) {
    return new Promise(function(resolve, reject) {
      var req = store.put(entry);
      req.onsuccess = function() { resolve(); };
      req.onerror = function() { reject(req.error); };
    });
  });
}

function _dbDelete(id) {
  return _dbTx('readwrite').then(function(store) {
    return new Promise(function(resolve, reject) {
      var req = store.delete(id);
      req.onsuccess = function() { resolve(); };
      req.onerror = function() { reject(req.error); };
    });
  });
}

// Load the recent list from IndexedDB into `recentCache`, sorted newest
// first and capped at RECENT_MAX. Called once at startup.
function loadRecentDisks() {
  return _dbGetAll().then(function(entries) {
    entries.sort(function(a, b) { return (b.timestamp || 0) - (a.timestamp || 0); });
    recentCache = entries.slice(0, RECENT_MAX);
    renderRecentSubmenu();
  }).catch(function(err) {
    // Silent fail — IndexedDB may be disabled in private mode, etc.
    recentCache = [];
    renderRecentSubmenu();
  });
}

// Record a disk as "recently opened". Pushes to the top of the list,
// evicts the oldest if the cap is exceeded, and persists to IndexedDB.
// `bytes` is an ArrayBuffer of the raw file.
function addRecentDisk(name, bytes) {
  if (!bytes || !name) return Promise.resolve();
  // Use filename + size as a stable id, so re-opening the same disk
  // updates the timestamp instead of duplicating the entry.
  var id = name + '|' + bytes.byteLength;
  var isArchive = /\.lnx$/i.test(name);
  var entry = {
    id: id,
    name: name,
    size: bytes.byteLength,
    tracks: (typeof currentTracks === 'number') ? currentTracks : 0,
    formatName: isArchive ? 'LNX' : ((currentFormat && currentFormat.name) ? currentFormat.name : ''),
    isArchive: isArchive,
    timestamp: Date.now(),
    bytes: bytes
  };
  // Update in-memory cache (move-to-front, deduplicate by id).
  recentCache = recentCache.filter(function(e) { return e.id !== id; });
  recentCache.unshift(entry);
  var evicted = recentCache.splice(RECENT_MAX);
  renderRecentSubmenu();
  // Persist: upsert the new entry, delete any evicted ones.
  var ops = [ _dbPut(entry) ];
  for (var i = 0; i < evicted.length; i++) ops.push(_dbDelete(evicted[i].id));
  return Promise.all(ops).catch(function() {
    // If the write failed (quota?), drop this entry from the cache so we
    // don't advertise a recent disk we couldn't actually save.
    recentCache = recentCache.filter(function(e) { return e.id !== id; });
    renderRecentSubmenu();
  });
}

function clearRecentDisks() {
  return _dbTx('readwrite').then(function(store) {
    return new Promise(function(resolve, reject) {
      var req = store.clear();
      req.onsuccess = function() { resolve(); };
      req.onerror = function() { reject(req.error); };
    });
  }).then(function() {
    recentCache = [];
    renderRecentSubmenu();
  });
}

// Open a cached recent disk as a new tab. LNX archives go through the
// archive extractor (same as drag-drop of a .lnx); other files go through
// the normal parseDisk + createTab flow.
function openRecentDisk(entry) {
  if (!entry || !entry.bytes) return;
  saveActiveTab();
  try {
    var bufCopy = entry.bytes.slice(0); // defensive: don't let tab edits mutate the cache
    if (entry.isArchive || /\.lnx$/i.test(entry.name)) {
      clearCmdContainerState();
      openLnxArchiveAsTab(bufCopy, entry.name);
    } else if (/\.(rml|rl|d1m|d2m|d4m)$/i.test(entry.name)) {
      // CMD containers (RAMLink, FD2000/FD4000) open to the partition
      // list — double-click a partition to enter it.
      openCmdContainerAsTab(bufCopy, entry.name);
    } else {
      clearCmdContainerState();
      currentBuffer = bufCopy;
      currentFileName = entry.name;
      currentPartition = null;
      selectedEntryIndex = -1;
      currentG64Layout = null;
      parseDisk(currentBuffer);
      var tab = createTab(entry.name, currentBuffer, entry.name);
      activeTabId = tab.id;
      tabDirty = false;
      clearUndo();
      var info = parseCurrentDir(currentBuffer);
      renderDisk(info);
      renderTabs();
      updateMenuState();
    }
  } catch (err) {
    showModal('Error', ['Error reopening ' + entry.name + ': ' + err.message]);
    return;
  }
  // Bump timestamp so this entry moves back to the top of the list.
  addRecentDisk(entry.name, entry.bytes);
}

function renderRecentSubmenu() {
  var container = document.getElementById('recent-submenu');
  if (!container) return;
  container.innerHTML = '';
  if (recentCache.length === 0) {
    var empty = document.createElement('div');
    empty.className = 'option disabled';
    empty.textContent = '(no recent disks)';
    container.appendChild(empty);
    return;
  }
  for (var i = 0; i < recentCache.length; i++) {
    (function(entry) {
      var opt = document.createElement('div');
      opt.className = 'option';
      var label = entry.name;
      if (entry.formatName) label += '  \u2014 ' + entry.formatName;
      opt.textContent = label;
      opt.title = entry.name + ' (' + Math.round(entry.size / 1024) + ' KB)';
      opt.addEventListener('click', function(e) {
        e.stopPropagation();
        closeMenus();
        openRecentDisk(entry);
      });
      container.appendChild(opt);
    })(recentCache[i]);
  }
  var sep = document.createElement('div');
  sep.className = 'separator';
  container.appendChild(sep);
  var clearOpt = document.createElement('div');
  clearOpt.className = 'option';
  clearOpt.textContent = 'Clear Recent';
  clearOpt.addEventListener('click', function(e) {
    e.stopPropagation();
    closeMenus();
    clearRecentDisks();
  });
  container.appendChild(clearOpt);
}

// Bootstrap on load. Fire-and-forget — menu renders empty until it resolves.
loadRecentDisks();
