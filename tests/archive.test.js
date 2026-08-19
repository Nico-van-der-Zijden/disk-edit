// Tests for the tar and LHA/LZH readers.
//
// Everything is synthesized — no fixture files. Tar is fully covered here.
// For LHA this covers header walking, -lh0- (stored), CRC verification and
// the error paths; the -lh5- Huffman decoder is validated separately against
// a real corpus (disks/scratch/lha-verify.js), because hand-building a valid
// lh5 bit stream in a test would prove less than CRC-checking thousands of
// real members does.
const { describe, it } = require('node:test');
const assert = require('node:assert');
require('./test-helper');

// ── tar builders ─────────────────────────────────────────────────────
function tarHeader(name, size, typeFlag, prefix) {
  const h = new Uint8Array(512);
  const put = (off, str) => { for (let i = 0; i < str.length; i++) h[off + i] = str.charCodeAt(i); };
  put(0, name.slice(0, 100));
  put(0x64, '000644 ');                       // mode
  put(0x6C, '000000 ');                       // uid
  put(0x74, '000000 ');                        // gid
  put(0x7C, size.toString(8).padStart(11, '0'));
  put(0x88, '00000000000');                    // mtime
  h[0x9C] = (typeFlag || '0').charCodeAt(0);
  put(0x101, 'ustar');                         // magic
  put(0x107, '00');                            // version
  if (prefix) put(0x159, prefix.slice(0, 155));
  // Checksum: sum of all bytes with the checksum field read as spaces.
  for (let i = 0x94; i < 0x9C; i++) h[i] = 0x20;
  let sum = 0;
  for (let i = 0; i < 512; i++) sum += h[i];
  put(0x94, sum.toString(8).padStart(6, '0'));
  h[0x9A] = 0x00; h[0x9B] = 0x20;
  return h;
}

// members: [{ name, data(Uint8Array), type?, prefix? }]
function buildTar(members, opts) {
  opts = opts || {};
  const blocks = [];
  for (const m of members) {
    const size = m.data ? m.data.length : 0;
    blocks.push(tarHeader(m.name, size, m.type, m.prefix));
    if (size) {
      const padded = new Uint8Array(Math.ceil(size / 512) * 512);
      padded.set(m.data, 0);
      blocks.push(padded);
    }
  }
  if (!opts.noTrailer) { blocks.push(new Uint8Array(512)); blocks.push(new Uint8Array(512)); }
  let total = 0;
  for (const b of blocks) total += b.length;
  const out = new Uint8Array(total);
  let p = 0;
  for (const b of blocks) { out.set(b, p); p += b.length; }
  return out;
}

const bytes = (...v) => Uint8Array.from(v);

describe('parseTar', () => {
  it('reads a single member byte-for-byte', () => {
    const payload = bytes(1, 2, 3, 4, 5);
    const res = parseTar(buildTar([{ name: 'hello.prg', data: payload }]).buffer);
    assert.ok(!res.error, res.error);
    assert.strictEqual(res.entries.length, 1);
    assert.strictEqual(res.entries[0].name, 'hello.prg');
    assert.deepStrictEqual(new Uint8Array(res.entries[0].data), payload);
  });

  it('reads several members and preserves order', () => {
    const res = parseTar(buildTar([
      { name: 'a.prg', data: bytes(0xAA) },
      { name: 'b.prg', data: bytes(0xBB, 0xBB) },
      { name: 'c.prg', data: bytes(0xCC, 0xCC, 0xCC) },
    ]).buffer);
    assert.deepStrictEqual(res.entries.map(e => e.name), ['a.prg', 'b.prg', 'c.prg']);
    assert.deepStrictEqual(res.entries.map(e => e.data.byteLength), [1, 2, 3]);
  });

  it('handles a member whose size is an exact block multiple', () => {
    const payload = new Uint8Array(1024).fill(0x5A);
    const res = parseTar(buildTar([
      { name: 'exact.d64', data: payload },
      { name: 'after.prg', data: bytes(9) },
    ]).buffer);
    assert.strictEqual(res.entries.length, 2);
    assert.strictEqual(res.entries[0].data.byteLength, 1024);
    assert.strictEqual(res.entries[1].name, 'after.prg');
  });

  it('handles a zero-length member', () => {
    const res = parseTar(buildTar([
      { name: 'empty.prg', data: bytes() },
      { name: 'next.prg', data: bytes(7) },
    ]).buffer);
    assert.strictEqual(res.entries.length, 2);
    assert.strictEqual(res.entries[0].data.byteLength, 0);
  });

  it('strips directory paths from member names', () => {
    const res = parseTar(buildTar([{ name: 'sub/dir/game.d64', data: bytes(1) }]).buffer);
    assert.strictEqual(res.entries[0].name, 'game.d64');
  });

  it('joins the USTAR prefix field before taking the basename', () => {
    const res = parseTar(buildTar([{ name: 'game.d64', data: bytes(1), prefix: 'long/path' }]).buffer);
    assert.strictEqual(res.entries[0].name, 'game.d64');
  });

  it('skips directory members', () => {
    const res = parseTar(buildTar([
      { name: 'adir/', data: bytes(), type: '5' },
      { name: 'file.prg', data: bytes(1) },
    ]).buffer);
    assert.strictEqual(res.entries.length, 1);
    assert.strictEqual(res.entries[0].name, 'file.prg');
  });

  it('reports unusual member types instead of dropping them silently', () => {
    const res = parseTar(buildTar([
      { name: 'link', data: bytes(), type: '2' },
      { name: 'real.prg', data: bytes(1) },
    ]).buffer);
    assert.strictEqual(res.entries.length, 1);
    assert.strictEqual(res.skipped.length, 1);
    assert.match(res.skipped[0].reason, /member type/);
  });

  it('applies a GNU long name to the following member', () => {
    const longName = 'a-very-long-name-'.repeat(8) + '.prg';
    const res = parseTar(buildTar([
      { name: '././@LongLink', data: Uint8Array.from(longName, c => c.charCodeAt(0)), type: 'L' },
      { name: 'truncated-name.prg', data: bytes(1, 2) },
    ]).buffer);
    assert.strictEqual(res.entries.length, 1);
    assert.strictEqual(res.entries[0].name, longName);
  });

  it('stops cleanly at the end-of-archive marker', () => {
    const good = buildTar([{ name: 'a.prg', data: bytes(1) }]);
    const padded = new Uint8Array(good.length + 512);
    padded.set(good, 0);
    padded.fill(0x41, good.length);            // junk after the trailer
    const res = parseTar(padded.buffer);
    assert.strictEqual(res.entries.length, 1);
  });

  it('rejects data that is not a tar at all', () => {
    assert.ok(parseTar(new Uint8Array(1024).fill(0x41).buffer).error);
    assert.ok(parseTar(new Uint8Array(10).buffer).error);
    assert.ok(parseTar(new Uint8Array(1024).buffer).error);   // all zero
  });

  it('reports a truncated member rather than inventing data', () => {
    const t = buildTar([{ name: 'big.d64', data: new Uint8Array(2048).fill(3) }], { noTrailer: true });
    const cut = t.subarray(0, 512 + 1024);      // header says 2048, only 1024 present
    const res = parseTar(cut.slice().buffer);
    assert.strictEqual(res.entries.length, 0);
    assert.strictEqual(res.skipped.length, 1);
    assert.match(res.skipped[0].reason, /truncated/);
  });
});

// ── LHA builders ─────────────────────────────────────────────────────
function lhaCrc16(d) {
  let c = 0;
  for (let i = 0; i < d.length; i++) {
    c ^= d[i];
    for (let b = 0; b < 8; b++) c = (c & 1) ? ((c >>> 1) ^ 0xA001) : (c >>> 1);
  }
  return c & 0xFFFF;
}

// A level-0 header followed by stored data. `crcOverride` lets a test forge a
// wrong CRC to prove verification actually bites.
function buildLha0(members) {
  const chunks = [];
  for (const m of members) {
    const method = m.method || '-lh0-';
    const data = m.data || new Uint8Array(0);
    const nameBytes = Uint8Array.from(m.name, c => c.charCodeAt(0));
    const headerSize = 22 + nameBytes.length + 2 - 2;   // bytes $02..end
    const h = new Uint8Array(2 + headerSize);
    h[0] = headerSize;
    h[1] = 0;                                            // checksum (unverified)
    for (let i = 0; i < 5; i++) h[2 + i] = method.charCodeAt(i);
    const dv = new DataView(h.buffer);
    dv.setUint32(7, m.packedSize !== undefined ? m.packedSize : data.length, true);
    dv.setUint32(11, data.length, true);
    dv.setUint32(15, 0, true);
    h[19] = 0x20;
    h[20] = 0;                                           // header level 0
    h[21] = nameBytes.length;
    h.set(nameBytes, 22);
    dv.setUint16(22 + nameBytes.length,
      m.crcOverride !== undefined ? m.crcOverride : lhaCrc16(data), true);
    chunks.push(h, data);
  }
  chunks.push(new Uint8Array(1));                        // terminating zero size
  let total = 0;
  for (const c of chunks) total += c.length;
  const out = new Uint8Array(total);
  let p = 0;
  for (const c of chunks) { out.set(c, p); p += c.length; }
  return out;
}

describe('parseLha', () => {
  it('reads a stored (-lh0-) member byte-for-byte', () => {
    const payload = bytes(1, 2, 3, 4, 5, 6, 7, 8);
    const res = parseLha(buildLha0([{ name: 'FILE.PRG', data: payload }]).buffer);
    assert.ok(!res.error, res.error);
    assert.strictEqual(res.entries.length, 1);
    assert.strictEqual(res.entries[0].name, 'FILE.PRG');
    assert.deepStrictEqual(new Uint8Array(res.entries[0].data), payload);
  });

  it('reads several stored members in order', () => {
    const res = parseLha(buildLha0([
      { name: 'A.PRG', data: bytes(0xAA) },
      { name: 'B.PRG', data: bytes(0xBB, 0xBB) },
      { name: 'C.D64', data: new Uint8Array(300).fill(0xCC) },
    ]).buffer);
    assert.deepStrictEqual(res.entries.map(e => e.name), ['A.PRG', 'B.PRG', 'C.D64']);
    assert.deepStrictEqual(res.entries.map(e => e.data.byteLength), [1, 2, 300]);
  });

  it('rejects a member whose CRC does not match', () => {
    const res = parseLha(buildLha0([
      { name: 'BAD.PRG', data: bytes(1, 2, 3), crcOverride: 0x1234 },
      { name: 'GOOD.PRG', data: bytes(4, 5, 6) },
    ]).buffer);
    assert.strictEqual(res.entries.length, 1);
    assert.strictEqual(res.entries[0].name, 'GOOD.PRG');
    assert.strictEqual(res.skipped.length, 1);
    assert.match(res.skipped[0].reason, /CRC mismatch/);
  });

  it('skips -lhd- directory entries', () => {
    const res = parseLha(buildLha0([
      { name: 'ADIR', data: new Uint8Array(0), method: '-lhd-' },
      { name: 'F.PRG', data: bytes(9) },
    ]).buffer);
    assert.strictEqual(res.entries.length, 1);
    assert.strictEqual(res.entries[0].name, 'F.PRG');
  });

  it('reports an unsupported compression method by name', () => {
    const res = parseLha(buildLha0([
      { name: 'OLD.PRG', data: bytes(1, 2, 3), method: '-lh1-' },
    ]).buffer);
    assert.strictEqual(res.entries.length, 0);
    assert.strictEqual(res.skipped.length, 1);
    assert.match(res.skipped[0].reason, /-lh1-.*not supported/);
  });

  it('strips path separators from member names', () => {
    const res = parseLha(buildLha0([{ name: 'sub\\GAME.D64', data: bytes(1) }]).buffer);
    assert.strictEqual(res.entries[0].name, 'GAME.D64');
  });

  it('rejects data that is not an LHA archive', () => {
    assert.ok(parseLha(new Uint8Array(64).fill(0x41).buffer).error);
    assert.ok(parseLha(new Uint8Array(4).buffer).error);
  });

  it('reports an unsupported header level instead of mis-parsing', () => {
    const a = buildLha0([{ name: 'F.PRG', data: bytes(1, 2, 3) }]);
    a[20] = 2;                                            // claim header level 2
    const res = parseLha(a.buffer);
    assert.strictEqual(res.entries.length, 0);
    assert.match(res.skipped[0].reason, /header level/);
  });

  it('stops at a truncated member rather than reading past the end', () => {
    const a = buildLha0([{ name: 'BIG.D64', data: new Uint8Array(500).fill(7) }]);
    const cut = a.subarray(0, a.length - 200).slice();
    const res = parseLha(cut.buffer);
    // Either skipped as truncated or CRC-rejected — never accepted silently.
    assert.strictEqual(res.entries.length, 0);
    assert.ok(res.skipped.length > 0 || res.error);
  });
});
