// Regression tests for the archive / GCR / tape review fixes.
const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { resetGlobals } = require('./test-helper');

// cbm-tape.js isn't part of the shared bootstrap.
vm.runInThisContext(fs.readFileSync(path.join(__dirname, '..', 'assets/js/format/cbm-tape.js'), 'utf8'),
  { filename: 'cbm-tape.js' });

const ascii = s => Uint8Array.from(s, c => c.charCodeAt(0));

// ── ZIP ──────────────────────────────────────────────────────────────
describe('ZIP CRC-32', () => {
  it('computes the standard check value', () => {
    assert.strictEqual(crc32(ascii('123456789')), 0xCBF43926);
    assert.strictEqual(crc32(new Uint8Array(0)), 0);
  });

  it('buildZip writes the CRC into the local and central headers', () => {
    const zip = buildZip([{ name: 'A.PRG', data: ascii('123456789') }]);
    const dv = new DataView(zip.buffer);
    assert.strictEqual(dv.getUint32(14, true), 0xCBF43926);
    const central = 30 + 5 + 9;
    assert.strictEqual(dv.getUint32(central, true), 0x02014b50);
    assert.strictEqual(dv.getUint32(central + 16, true), 0xCBF43926);
  });

  it('parseZip round-trips and reports a damaged member instead of failing', async () => {
    const zip = buildZip([
      { name: 'dir\\BAD.PRG', data: ascii('hello') },
      { name: 'sub/GOOD.D64', data: ascii('world') },
    ]);
    let res = await parseZip(zip.slice().buffer);
    assert.deepStrictEqual(res.entries.map(e => e.name), ['BAD.PRG', 'GOOD.D64']);
    assert.strictEqual(res.skipped.length, 0);

    zip[30 + 11] ^= 0xFF;                       // first byte of BAD.PRG's data
    res = await parseZip(zip.buffer);
    assert.deepStrictEqual(res.entries.map(e => e.name), ['GOOD.D64']);
    assert.strictEqual(res.skipped.length, 1);
    assert.match(res.skipped[0].reason, /CRC/);
  });

  it('returns { error } for something that is not a ZIP', async () => {
    assert.ok((await parseZip(new Uint8Array(64).buffer)).error);
  });
});

// ── GCR track builder ────────────────────────────────────────────────
const SPT1 = 21;
function gcrHeader(track, sector, id1 = 0x41, id2 = 0x42) {
  return encodeGCR4(0x08, sector ^ track ^ id2 ^ id1, sector, track)
    .concat(encodeGCR4(id2, id1, 0x0F, 0x0F));
}
function payloadFor(track, sector) {
  const p = new Uint8Array(256);
  for (let i = 0; i < 256; i++) p[i] = (track * 31 + sector * 7 + i) & 0xFF;
  return p;
}
function badChecksumBlock(payload) {
  const raw = new Uint8Array(GCR_DATA_PLAIN);
  raw[0] = 0x07;
  raw.set(payload, 1);
  let x = 0;
  for (let i = 0; i < 256; i++) x ^= payload[i];
  raw[257] = x ^ 0x5A;
  return encodeGCRDataBlock(raw);
}
const ff = n => new Array(n).fill(0xFF);
const gap = n => new Array(n).fill(0x55);

// opts: { bad: Set, noData: Set } of sector numbers.
function buildTrack(track, opts = {}) {
  const out = [];
  for (let s = 0; s < SPT1; s++) {
    out.push(...ff(5), ...gcrHeader(track, s), ...gap(9));
    if (opts.noData && opts.noData.has(s)) continue;
    const p = payloadFor(track, s);
    const block = opts.bad && opts.bad.has(s) ? badChecksumBlock(p) : encodeGCRSector(p);
    out.push(...ff(5), ...block, ...gap(8));
  }
  return Uint8Array.from(out);
}

describe('walkGCRTrack', () => {
  it('flags a bad data checksum as unreadable and keeps the data', () => {
    const w = walkGCRTrack(buildTrack(1, { bad: new Set([3]) }), 1, SPT1);
    assert.deepStrictEqual(w.unreadable, [3]);
    assert.deepStrictEqual(w.badChecksum, [3]);
    assert.deepStrictEqual(Array.from(w.allPayloads[3]), Array.from(payloadFor(1, 3)));
    assert.strictEqual(w.sectorPayloads[3], undefined);
  });

  it("doesn't skip the next sector when a header has no data block", () => {
    const w = walkGCRTrack(buildTrack(1, { noData: new Set([4]) }), 1, SPT1);
    assert.deepStrictEqual(w.unreadable, [4]);
    assert.ok(w.sectorOrder.indexOf(4) >= 0);
    assert.ok(w.sectorPayloads[5], 'sector after the data-less header still reads');
    assert.strictEqual(w.sectorDataStart[4], undefined, 'next header not taken for data');
  });

  it('finds a header whose sync sits at the very end of the track', () => {
    const t = buildTrack(1);
    // Rotate so sector 0's header starts at offset 0 and its sync wraps to the end.
    const rotated = new Uint8Array(t.length);
    rotated.set(t.subarray(5), 0);
    rotated.set(t.subarray(0, 5), t.length - 5);
    const w = walkGCRTrack(rotated, 1, SPT1);
    assert.deepStrictEqual(w.unreadable, []);
    assert.strictEqual(w.sectorOrder.length, SPT1);
  });
});

describe('buildG64ForSave', () => {
  const makeG64 = () => {
    const raw = buildTrack(1, { bad: new Set([3]) });
    return new Uint8Array(encodeG64FromLayout([{ track: 1, halfTrack: false, rawGCR: raw }]));
  };

  it('round-trips an unedited image byte for byte, bad checksum included', () => {
    const g64 = makeG64();
    const opened = decodeG64toD64(g64);
    const saved = new Uint8Array(buildG64ForSave(opened.d64, opened.layout));
    assert.ok(Buffer.from(saved).equals(Buffer.from(g64)));
  });

  it('re-encodes only the sector that was edited', () => {
    const g64 = makeG64();
    const opened = decodeG64toD64(g64);
    const d64 = new Uint8Array(opened.d64);
    d64[5 * 256 + 10] ^= 0xFF;                      // T1 S5
    const again = decodeG64toD64(new Uint8Array(buildG64ForSave(opened.d64, opened.layout)));
    const t1 = again.layout.find(t => t.track === 1);
    assert.deepStrictEqual(t1.unreadableSectors, [3], 'bad sector left alone');
    assert.strictEqual(new Uint8Array(again.d64)[5 * 256 + 10], d64[5 * 256 + 10]);
  });
});

describe('NIB revolution trimming', () => {
  it('cuts a two-revolution capture down to one', () => {
    const rev = buildTrack(1);
    const cap = new Uint8Array(NIB_TRACK_LENGTH);
    for (let i = 0; i < cap.length; i++) cap[i] = rev[(i + 100) % rev.length];
    const trimmed = nibTrimToRevolution(cap);
    assert.strictEqual(trimmed.length, rev.length);
    assert.deepStrictEqual(walkGCRTrack(trimmed, 1, SPT1).unreadable, []);
  });

  it('keeps a capture with no repeat as it is', () => {
    const cap = new Uint8Array(NIB_TRACK_LENGTH).fill(0x55);
    assert.strictEqual(nibTrimToRevolution(cap).length, NIB_TRACK_LENGTH);
  });
});

// ── LHA level 1 ──────────────────────────────────────────────────────
function lhaCrc16(d) {
  let c = 0;
  for (let i = 0; i < d.length; i++) {
    c ^= d[i];
    for (let b = 0; b < 8; b++) c = (c & 1) ? ((c >>> 1) ^ 0xA001) : (c >>> 1);
  }
  return c & 0xFFFF;
}
// Level-1 header, no extended headers. `orig` overrides the size field.
function lha1(name, method, data, orig) {
  const n = name.length;
  const h = new Uint8Array(27 + n);
  const dv = new DataView(h.buffer);
  h[0] = 25 + n;
  for (let i = 0; i < 5; i++) h[2 + i] = method.charCodeAt(i);
  dv.setUint32(7, data.length, true);
  dv.setUint32(11, orig !== undefined ? orig : data.length, true);
  h[19] = 0x20;
  h[20] = 1;
  h[21] = n;
  h.set(ascii(name), 22);
  dv.setUint16(22 + n, lhaCrc16(data), true);
  h[24 + n] = 0x4D;                               // OS id; ext size 0 follows
  const out = new Uint8Array(h.length + data.length);
  out.set(h); out.set(data, h.length);
  return out;
}
const concat = (...parts) => {
  const out = new Uint8Array(parts.reduce((a, p) => a + p.length, 0));
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
};

describe('parseLha level 1', () => {
  it('walks past a -lhd- directory entry', () => {
    const res = parseLha(concat(lha1('SUB', '-lhd-', new Uint8Array(0)),
      lha1('F.PRG', '-lh0-', ascii('abc')), new Uint8Array(1)).buffer);
    assert.deepStrictEqual(res.entries.map(e => e.name), ['F.PRG']);
  });

  it('walks past an unsupported method by its skip size', () => {
    const res = parseLha(concat(lha1('OLD.PRG', '-lh1-', ascii('xyzzy')),
      lha1('F.PRG', '-lh0-', ascii('abc')), new Uint8Array(1)).buffer);
    assert.deepStrictEqual(res.entries.map(e => e.name), ['F.PRG']);
    assert.match(res.skipped[0].reason, /-lh1-/);
  });

  it('skips a member with an absurd declared size instead of throwing', () => {
    const res = parseLha(concat(lha1('BIG', '-lh5-', ascii('xx'), 0xFFFFFFF0),
      lha1('F.PRG', '-lh0-', ascii('abc')), new Uint8Array(1)).buffer);
    assert.deepStrictEqual(res.entries.map(e => e.name), ['F.PRG']);
    assert.match(res.skipped[0].reason, /too large/);
  });
});

// ── LNX ──────────────────────────────────────────────────────────────
function buildLnx(entries) {
  let h = ' 1  LYNX TEST\r ' + entries.length + ' \r';
  for (const e of entries) {
    h += e.name + '\r ' + e.blocks + ' \r' + e.type + '\r';
    if (e.record !== undefined) h += ' ' + e.record + ' \r';
    h += ' ' + e.lsu + ' \r';
  }
  const total = 254 + entries.reduce((a, e) => a + e.blocks * 254, 0);
  const buf = new Uint8Array(total);
  buf.set(ascii(h), 0);
  let off = 254;
  for (const e of entries) { buf.set(e.data, off); off += e.blocks * 254; }
  return buf.buffer;
}

describe('parseLnxArchive', () => {
  it('reads the record size of a REL entry and stays in step after it', () => {
    const rel = new Uint8Array(300).fill(0x11);
    const res = parseLnxArchive(buildLnx([
      { name: 'DATA', blocks: 2, type: 'R', record: 64, lsu: 47, data: rel },
      { name: 'NEXT', blocks: 1, type: 'P', lsu: 4, data: ascii('\x01\x08\x00') },
    ]));
    assert.ok(!res.error, res.error);
    assert.strictEqual(res.files.length, 2);
    assert.strictEqual(res.files[0].typeIdx, FILE_TYPE.REL);
    assert.strictEqual(res.files[0].recordSize, 64);
    assert.strictEqual(res.files[0].data.length, 254 + 46);
    assert.strictEqual(res.files[1].typeIdx, FILE_TYPE.PRG);
    assert.deepStrictEqual(Array.from(res.files[1].data), [1, 8, 0]);
  });

  it('accepts zero-block entries (directory art)', () => {
    const res = parseLnxArchive(buildLnx([
      { name: '----------------', blocks: 0, type: 'P', lsu: 1, data: new Uint8Array(0) },
      { name: 'GAME', blocks: 1, type: 'P', lsu: 3, data: ascii('\x01\x08') },
    ]));
    assert.ok(!res.error, res.error);
    assert.strictEqual(res.files.length, 2);
    assert.strictEqual(res.files[0].data.length, 0);
    assert.deepStrictEqual(Array.from(res.files[1].data), [1, 8]);
  });
});

// ── CBM ROM tape: SEQ files ──────────────────────────────────────────
const S = 360, M = 528, L = 688;
function cbmByte(b) {
  const p = [L, M];
  for (let i = 0; i < 8; i++) p.push(...((b >> i) & 1 ? [M, S] : [S, M]));
  p.push(S, M);                                   // parity (not checked)
  return p;
}
function cbmBlock(bytes) {
  const p = new Array(300).fill(S);
  for (let c = 0x89; c >= 0x81; c--) p.push(...cbmByte(c));
  for (const b of bytes) p.push(...cbmByte(b));
  p.push(L, S);                                   // end-of-data marker
  return p;
}
function cbmHeader(type, start, end, name) {
  const h = new Array(192).fill(0x20);
  h[0] = type;
  h[1] = start & 0xFF; h[2] = start >> 8; h[3] = end & 0xFF; h[4] = end >> 8;
  for (let i = 0; i < 16; i++) h[5 + i] = i < name.length ? name.charCodeAt(i) : 0x20;
  return h;
}

describe('CBM ROM tape SEQ files', () => {
  it('collects the type-2 data blocks after a SEQ header', () => {
    const text = [];
    for (let i = 0; i < 250; i++) text.push(0x41 + (i % 26));
    const blk1 = [2].concat(text.slice(0, 191));
    const blk2 = [2].concat(text.slice(191)).concat(new Array(191 - 59).fill(0));
    const pulses = [].concat(
      cbmBlock(cbmHeader(4, 0x033C, 0x03FC, 'NOTES')),
      cbmBlock(blk1), cbmBlock(blk2),
      cbmBlock(cbmHeader(3, 0x0801, 0x0805, 'PROG')),
      cbmBlock([1, 2, 3, 4]),
      new Array(300).fill(S));
    const ctx = { entries: [], tapEntries: {}, cbmHeaders: [], claims: [] };
    scanCbmRom(pulses, ctx);
    assert.deepStrictEqual(ctx.entries.map(e => e.type), [' SEQ ', ' PRG ']);
    assert.deepStrictEqual(Array.from(ctx.tapEntries[0].fileData), text);
    assert.deepStrictEqual(Array.from(ctx.tapEntries[1].fileData), [0x01, 0x08, 1, 2, 3, 4]);
  });

  it('ends the data at the first $00, ignoring leftover buffer bytes after it', () => {
    const blk = [2, 0x48, 0x49, 0x00].concat(new Array(188).fill(0x58)); // "HI", EOF, junk
    const pulses = [].concat(
      cbmBlock(cbmHeader(4, 0x033C, 0x03FC, 'NOTES')),
      cbmBlock(blk), cbmBlock([2].concat(new Array(191).fill(0x59))),
      new Array(300).fill(S));
    const ctx = { entries: [], tapEntries: {}, cbmHeaders: [], claims: [] };
    scanCbmRom(pulses, ctx);
    assert.strictEqual(ctx.entries.length, 1);
    assert.deepStrictEqual(Array.from(ctx.tapEntries[0].fileData), [0x48, 0x49]);
  });
});

// ── GEOS ─────────────────────────────────────────────────────────────
describe('readVLIRRecords', () => {
  it('stops at a $00/$00 end marker and keeps $00/$FF as absent', () => {
    resetGlobals();
    const buf = createEmptyDisk('d64', 35);
    global.currentBuffer = buf;
    global.currentFormat = DISK_FORMATS.d64;
    global.currentTracks = 35;
    const ctx = getCurrentCtx();
    const d = new Uint8Array(buf);
    const off = (t, s) => sectorOffset(t, s, ctx);
    const entry = off(18, 1);
    d[entry + 3] = 1; d[entry + 4] = 0;                 // index at T1/S0
    const idx = off(1, 0);
    d[idx] = 0; d[idx + 1] = 0xFF;
    d.set([1, 1, 0, 0xFF, 0, 0, 1, 2], idx + 2);       // rec, absent, END, junk
    d.set([0, 3, 0xAA, 0xBB], off(1, 1));
    d.set([0, 2, 0xCC], off(1, 2));
    const recs = readVLIRRecords(buf, entry, ctx);
    assert.strictEqual(recs.length, 1, 'trailing null trimmed, junk after END ignored');
    assert.deepStrictEqual(Array.from(recs[0]), [0xAA, 0xBB]);
  });
});

describe('findDnpHighTrackOwners', () => {
  it('survives a subdirectory that points back at itself', () => {
    resetGlobals();
    const buf = createEmptyDisk('dnp', 3);
    const d = new Uint8Array(buf);
    const at = (t, s) => (t - 1) * 65536 + s * 256;
    // Root dir T1/S34 entry: DIR whose header is T2/S0; that header's dir
    // chain starts at T2/S1, which holds a DIR entry pointing at T2/S0 again.
    const mkDir = (off, hdrT, hdrS) => {
      d[off + 2] = 0x80 | 6; d[off + 3] = hdrT; d[off + 4] = hdrS;
      d.set(ascii('LOOP'), off + 5);
    };
    mkDir(at(1, 34), 2, 0);
    d[at(2, 0)] = 2; d[at(2, 0) + 1] = 1;
    mkDir(at(2, 1), 2, 0);
    const owners = findDnpHighTrackOwners(buf, 2);
    assert.ok(owners.length > 0 && owners.length < 10);
  });
});

// ── FilePacked part limit ────────────────────────────────────────────
describe('compressFilePack', () => {
  const file = sectors => ({ nameBytes: ascii('BIG').slice(), typeChar: 'P',
    data: new Uint8Array(sectors * FILEPACK_SECTOR_DATA).fill(7) });
  const pad = f => { const n = new Uint8Array(16).fill(0xA0); n.set(f.nameBytes); f.nameBytes = n; return f; };

  it('allows exactly 23 data parts', () => {
    const res = compressFilePack([pad(file(22 * 166 + 1))], 'X');
    assert.ok(!res.error, res.error);
    assert.strictEqual(res.parts.length, 23);
  });

  it('refuses a 24th part', () => {
    assert.ok(compressFilePack([pad(file(23 * 166 + 1))], 'X').error);
  });
});

// ── Archive picker ───────────────────────────────────────────────────
describe('archive picker', () => {
  it('treats .nib / .nb2 members as disk images', () => {
    assert.ok(ZIP_DISK_EXTS.indexOf('.nib') >= 0);
    assert.ok(ZIP_DISK_EXTS.indexOf('.nb2') >= 0);
  });

  it('settles a picker with the cancel value on modaldismiss, once', async () => {
    const overlay = new EventTarget();
    overlay.classList = { remove() {}, add() {} };
    const orig = document.getElementById;
    document.getElementById = id => (id === 'modal-overlay' ? overlay : orig(id));
    try {
      let calls = 0;
      const p = new Promise(resolve => {
        const settle = _pickerSettler(v => { calls++; resolve(v); }, []);
        overlay.dispatchEvent(new CustomEvent('modaldismiss'));
        settle(['late']);
      });
      assert.deepStrictEqual(await p, []);
      overlay.dispatchEvent(new CustomEvent('modaldismiss'));
      assert.strictEqual(calls, 1);
    } finally {
      document.getElementById = orig;
    }
  });
});
