// Test bootstrap: stubs browser globals and loads cbm-format.js + cbm-editor.js
// Usage: const { loadDisk, resetGlobals } = require('./test-helper');

const fs = require('fs');
const path = require('path');
const vm = require('vm');

// Stub browser globals
global.localStorage = { getItem: () => null, setItem: () => {} };
var noopEl = {
  addEventListener: () => {},
  classList: { add: () => {}, remove: () => {}, toggle: () => {}, contains: () => false },
  querySelectorAll: () => [],
  querySelector: () => null,
  setAttribute: () => {},
  getAttribute: () => null,
  style: {},
  innerHTML: '',
  textContent: '',
  click: () => {},
  appendChild: () => {},
  removeChild: () => {},
  closest: () => null,
  dataset: {}
};
global.document = {
  addEventListener: () => {},
  getElementById: () => noopEl,
  querySelector: () => noopEl,
  querySelectorAll: () => [],
  createElement: () => Object.assign({}, noopEl),
  body: Object.assign({}, noopEl),
  documentElement: Object.assign({}, noopEl)
};
global.window = {};
global.getComputedStyle = () => ({ getPropertyValue: () => '' });
global.URL = { createObjectURL: () => '', revokeObjectURL: () => {} };
global.Blob = function() {};

// Load JS files into global scope via vm.runInThisContext
function loadScript(relPath) {
  var src = fs.readFileSync(path.join(__dirname, '..', relPath), 'utf8')
    .replace(/^const /gm, 'var ')
    .replace(/^let /gm, 'var ');
  vm.runInThisContext(src, { filename: relPath });
}

loadScript('assets/js/cbm-format.js');
loadScript('assets/js/cbm-editor.js');
loadScript('assets/js/ui-directory.js');
loadScript('assets/js/ui-fileops.js');

// Helper: load a disk image and set globals
function loadDisk(filename) {
  var diskPath = path.join(__dirname, '..', 'disks', filename);
  var buf = new Uint8Array(fs.readFileSync(diskPath)).buffer;
  global.currentBuffer = buf;
  global.currentPartition = null;

  var size = buf.byteLength;
  if (size === 174848 || size === 175531) { global.currentFormat = DISK_FORMATS.d64; global.currentTracks = 35; }
  else if (size === 349696 || size === 351062) { global.currentFormat = DISK_FORMATS.d71; global.currentTracks = 70; }
  else if (size === 819200 || size === 822400) { global.currentFormat = DISK_FORMATS.d81; global.currentTracks = 80; }
  else if (size === 533248) { global.currentFormat = DISK_FORMATS.d80; global.currentTracks = 77; }
  else if (size === 829440 || size === 832680) { global.currentFormat = DISK_FORMATS.d1m; global.currentTracks = 81; }
  else if (size === 1658880 || size === 1665360) { global.currentFormat = DISK_FORMATS.d2m; global.currentTracks = 81; }
  else if (size === 3317760 || size === 3330720) { global.currentFormat = DISK_FORMATS.d4m; global.currentTracks = 81; }
  else throw new Error('Unknown disk size: ' + size + ' for ' + filename);

  return buf;
}

// Helper: reset globals between tests
function resetGlobals() {
  global.currentBuffer = null;
  global.currentFormat = null;
  global.currentTracks = 0;
  global.currentPartition = null;
}

module.exports = { loadDisk, resetGlobals };
