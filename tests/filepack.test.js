// Tests for FilePacked ZipCode (a!NAME .. w!NAME + x!NAME).
// Spec: disks/FORMATS/ZIP_FILE.TXT rev 1.4
//
// Synthesized with a spec-conformant encoder. The reader is additionally
// validated against four real sets (see disks/scratch/fp-verify.js), whose
// track==0 file boundaries match their x! directory sector counts exactly.
const { describe, it } = require('node:test');
const assert = require('node:assert');
require('./test-helper');

const SECTOR = 254;

function nameBytes(str) {
  const nb = new Uint8Array(16);
  for (let i = 0; i < 16; i++) nb[i] = i < str.length ? str.charCodeAt(i) : 0xA0;
  return nb;
}

// files: [{ name, type ('P'|'S'|'U'), data(Uint8Array) }]
// opts: { split: [n, ...] sectors per data file, method: 0|1|2, badLoad, dataFileCount }
function buildFilePack(files, opts) {
  opts = opts || {};
  const method = opts.method === undefined ? 0 : opts.method;

  // Turn every file into a list of sector entries.
  const entries = [];
  for (const f of files) {
    const blocks = Math.max(1, Math.ceil(f.data.length / SECTOR));
    for (let b = 0; b < blocks; b++) {
      const chunk = f.data.subarray(b * SECTOR, (b + 1) * SECTOR);
      const payload = new Uint8Array(SECTOR);
      payload.set(chunk, 0);
      const last = b === blocks - 1;
      entries.push({
        // Real files carry the original T/S here; only track==0 is meaningful.
        track: last ? 0 : (1 + (b % 35)),
        sector: last ? (f.data.length - b * SECTOR) : (b % 20),
        payload: payload,
      });
    }
  }

  function encodeEntry(e) {
    const out = [];
    let m = method;
    // A uniform payload can use fill; otherwise fall back to store.
    if (m === 1 && !e.payload.every(v => v === e.payload[0])) m = 0;
    out.push((m << 6) | e.track, e.sector);
    if (m === 0) {
      for (let i = 0; i < SECTOR; i++) out.push(e.payload[i]);
    } else if (m === 1) {
      out.push(e.payload[0]);
    } else {
      // RLE: length, REP, then payload where REP introduces (count, value).
      let rep = -1;
      for (let c = 0; c < 256 && rep < 0; c++) if (!e.payload.includes(c)) rep = c;
      const p = [];
      for (let i = 0; i < SECTOR;) {
        let run = 1;
        while (i + run < SECTOR && e.payload[i + run] === e.payload[i] && run < 255) run++;
        if (run >= 4) { p.push(rep, run, e.payload[i]); i += run; }
        else { for (let k = 0; k < run; k++) p.push(e.payload[i]); i += run; }
      }
      out.push(p.length, rep);
      for (const b of p) out.push(b);
    }
    return out;
  }

  // Distribute entries across data files.
  const split = opts.split || [entries.length];
  const dataFiles = [];
  let idx = 0;
  for (const n of split) {
    const slice = entries.slice(idx, idx + n);
    idx += n;
    const bytes = [opts.badLoad ? 0x00 : 0xFF, opts.badLoad ? 0x08 : 0x03, slice.length];
    for (const e of slice) bytes.push(...encodeEntry(e));
    dataFiles.push(Uint8Array.from(bytes));
  }

  // x! directory: BASIC area, data-file count at $1FF, file count at $200.
  const x = new Uint8Array(0x201 + files.length * 21);
  x[0x1FF] = opts.dataFileCount !== undefined ? opts.dataFileCount : dataFiles.length;
  x[0x200] = files.length;
  files.forEach((f, i) => {
    const o = 0x201 + i * 21;
    x.set(nameBytes(f.name), o);
    x[o + 0x10] = (f.type || 'P').charCodeAt(0) | 0x80;
    const sectors = Math.max(1, Math.ceil(f.data.length / SECTOR));
    x[o + 0x11] = sectors & 0xFF;
    x[o + 0x12] = sectors >> 8;
    x[o + 0x13] = 17;
    x[o + 0x14] = 0;
  });

  return { dataFiles, x };
}

function pattern(len, seed) {
  const d = new Uint8Array(len);
  let s = seed || 1;
  for (let i = 0; i < len; i++) { s = (s * 1103515245 + 12345) & 0x7FFFFFFF; d[i] = (s >> 8) & 0xFF; }
  return d;
}

describe('parseFilePackDirectory', () => {
  it('reads names, types and counts', () => {
    const { x } = buildFilePack([
      { name: 'FIRST', type: 'P', data: pattern(300, 1) },
      { name: 'SECOND', type: 'S', data: pattern(100, 2) },
      { name: 'THIRD', type: 'U', data: pattern(600, 3) },
    ]);
    const dir = parseFilePackDirectory(x);
    assert.ok(!dir.error, dir.error);
    assert.strictEqual(dir.files.length, 3);
    assert.deepStrictEqual(dir.files.map(f => petsciiToReadable(f.name).trim()), ['FIRST', 'SECOND', 'THIRD']);
    assert.deepStrictEqual(dir.files.map(f => f.typeChar), ['P', 'S', 'U']);
    assert.deepStrictEqual(dir.files.map(f => f.sectors), [2, 1, 3]);
  });

  it('rejects a too-small or empty directory', () => {
    assert.ok(parseFilePackDirectory(new Uint8Array(16)).error);
    const empty = new Uint8Array(0x201);
    assert.ok(parseFilePackDirectory(empty).error);
  });

  it('reports a directory that ends mid-entry', () => {
    const { x } = buildFilePack([{ name: 'A', data: pattern(300, 1) }]);
    const cut = x.subarray(0, x.length - 5).slice();
    assert.ok(parseFilePackDirectory(cut).error);
  });
});

describe('decompressFilePack', () => {
  it('extracts a single stored file byte-for-byte', () => {
    const data = pattern(700, 7);
    const { dataFiles, x } = buildFilePack([{ name: 'ONE', data }]);
    const res = decompressFilePack(dataFiles, x);
    assert.ok(!res.error, res.error);
    assert.strictEqual(res.files.length, 1);
    assert.strictEqual(petsciiToReadable(res.files[0].name).trim(), 'ONE');
    assert.ok(Buffer.from(res.files[0].data).equals(Buffer.from(data)));
  });

  it('extracts several files and keeps directory order', () => {
    const a = pattern(500, 11), b = pattern(254, 12), c = pattern(1000, 13);
    const { dataFiles, x } = buildFilePack([
      { name: 'AAA', data: a }, { name: 'BBB', data: b }, { name: 'CCC', data: c },
    ]);
    const res = decompressFilePack(dataFiles, x);
    assert.ok(!res.error, res.error);
    assert.deepStrictEqual(res.files.map(f => petsciiToReadable(f.name).trim()), ['AAA', 'BBB', 'CCC']);
    assert.ok(Buffer.from(res.files[0].data).equals(Buffer.from(a)));
    assert.ok(Buffer.from(res.files[1].data).equals(Buffer.from(b)));
    assert.ok(Buffer.from(res.files[2].data).equals(Buffer.from(c)));
  });

  it('follows a file split across several data parts', () => {
    const a = pattern(2000, 21), b = pattern(1500, 22);
    const built = buildFilePack([{ name: 'AAA', data: a }, { name: 'BBB', data: b }], { split: [5, 4, 5] });
    assert.strictEqual(built.dataFiles.length, 3);
    const res = decompressFilePack(built.dataFiles, built.x);
    assert.ok(!res.error, res.error);
    assert.ok(Buffer.from(res.files[0].data).equals(Buffer.from(a)));
    assert.ok(Buffer.from(res.files[1].data).equals(Buffer.from(b)));
  });

  it('honours the last-block byte count', () => {
    // 254*2 + 5 bytes: the final block carries only 5 usable bytes.
    const data = pattern(513, 31);
    const { dataFiles, x } = buildFilePack([{ name: 'ODD', data }]);
    const res = decompressFilePack(dataFiles, x);
    assert.strictEqual(res.files[0].data.length, 513);
    assert.ok(Buffer.from(res.files[0].data).equals(Buffer.from(data)));
  });

  it('decodes fill-compressed sectors', () => {
    const data = new Uint8Array(700).fill(0xAB);
    const { dataFiles, x } = buildFilePack([{ name: 'FILL', data }], { method: 1 });
    const res = decompressFilePack(dataFiles, x);
    assert.ok(!res.error, res.error);
    assert.ok(Buffer.from(res.files[0].data).equals(Buffer.from(data)));
  });

  it('decodes RLE-compressed sectors', () => {
    // Long runs plus literal bytes, so RLE actually engages.
    const data = new Uint8Array(760);
    for (let i = 0; i < data.length; i++) data[i] = i % 254 < 40 ? (i & 0xFF) : 0x5A;
    const { dataFiles, x } = buildFilePack([{ name: 'RLE', data }], { method: 2 });
    const res = decompressFilePack(dataFiles, x);
    assert.ok(!res.error, res.error);
    assert.ok(Buffer.from(res.files[0].data).equals(Buffer.from(data)));
  });

  it('carries the file type through', () => {
    const { dataFiles, x } = buildFilePack([
      { name: 'P1', type: 'P', data: pattern(100, 1) },
      { name: 'S1', type: 'S', data: pattern(100, 2) },
      { name: 'U1', type: 'U', data: pattern(100, 3) },
    ]);
    const res = decompressFilePack(dataFiles, x);
    assert.deepStrictEqual(res.files.map(f => f.typeChar), ['P', 'S', 'U']);
  });

  it('rejects a wrong load address', () => {
    const { dataFiles, x } = buildFilePack([{ name: 'A', data: pattern(300, 1) }], { badLoad: true });
    const res = decompressFilePack(dataFiles, x);
    assert.ok(res.error && /load address/.test(res.error), res.error);
  });

  it('rejects a data-file count that disagrees with x!', () => {
    const { dataFiles, x } = buildFilePack([{ name: 'A', data: pattern(300, 1) }], { dataFileCount: 3 });
    const res = decompressFilePack(dataFiles, x);
    assert.ok(res.error && /expects 3 data file/.test(res.error), res.error);
  });

  it('rejects no data files at all', () => {
    const { x } = buildFilePack([{ name: 'A', data: pattern(300, 1) }]);
    assert.ok(decompressFilePack([], x).error);
  });

  it('reports directory entries with no data in the stream', () => {
    const built = buildFilePack([
      { name: 'AAA', data: pattern(300, 1) },
      { name: 'GHOST', data: pattern(300, 2) },
    ]);
    // Drop the second file's entries, keeping the directory claiming two.
    const only = built.dataFiles[0];
    const firstBlocks = 2;                      // AAA is 2 sectors
    const trimmed = Uint8Array.from([only[0], only[1], firstBlocks,
      ...Array.from(only.subarray(3, 3 + firstBlocks * (2 + SECTOR)))]);
    const res = decompressFilePack([trimmed], built.x);
    assert.ok(!res.error, res.error);
    assert.strictEqual(res.files.length, 1);
    assert.ok(res.skipped.some(s => /not present/.test(s.reason)));
  });
});

describe('findFilePackSets', () => {
  const mk = names => names.map((n, i) => ({ name: n, ref: 200 + i }));

  it('finds a complete set with its x! directory', () => {
    const r = findFilePackSets(mk(['a!GAME', 'b!GAME', 'c!GAME', 'x!GAME']));
    assert.strictEqual(r.complete.length, 1);
    assert.strictEqual(r.complete[0].name, 'GAME');
    assert.deepStrictEqual(r.complete[0].refs, [200, 201, 202]);
    assert.strictEqual(r.complete[0].dirRef, 203);
  });

  it('orders parts a!, b!, c! regardless of input order', () => {
    const r = findFilePackSets(mk(['c!G', 'x!G', 'a!G', 'b!G']));
    assert.deepStrictEqual(r.complete[0].refs, [202, 203, 200]);
  });

  it('accepts a single-part set', () => {
    const r = findFilePackSets(mk(['a!ONE', 'x!ONE']));
    assert.strictEqual(r.complete.length, 1);
    assert.strictEqual(r.complete[0].refs.length, 1);
  });

  it('reports a set with no x! as partial', () => {
    const r = findFilePackSets(mk(['a!G', 'b!G']));
    assert.strictEqual(r.complete.length, 0);
    assert.strictEqual(r.partial[0].hasDir, false);
  });

  it('reports a gap in the letter run as partial', () => {
    const r = findFilePackSets(mk(['a!G', 'c!G', 'x!G']));
    assert.strictEqual(r.complete.length, 0);
    assert.strictEqual(r.partial.length, 1);
  });

  it('treats a lone x! as partial, not complete', () => {
    const r = findFilePackSets(mk(['x!LUNCH']));
    assert.strictEqual(r.complete.length, 0);
    assert.strictEqual(r.partial[0].name, 'LUNCH');
  });

  it('separates two sets sharing a folder', () => {
    const r = findFilePackSets(mk(['a!ONE', 'x!ONE', 'a!TWO', 'b!TWO', 'x!TWO']));
    assert.strictEqual(r.complete.length, 2);
  });

  it('ignores DiskPacked and SixPack names', () => {
    const r = findFilePackSets(mk(['1!G', '2!G', '3!G', '4!G', '1!!S', '2!!S']));
    assert.strictEqual(r.complete.length, 0);
    assert.strictEqual(r.partial.length, 0);
  });
});

describe('FilePacked name classifiers', () => {
  it('accepts a!..w! as data parts', () => {
    for (const n of ['a!G', 'b!G', 'w!G', 'A!G']) assert.ok(isFilePackFileName(n), n);
  });

  it('treats x! as the directory, not a data part', () => {
    assert.ok(isFilePackDirName('x!G'));
    assert.ok(!isFilePackFileName('x!G'));
  });

  it('rejects digits and double bangs', () => {
    for (const n of ['1!G', '5!G', 'a!!G', 'x!!G']) {
      assert.ok(!isFilePackFileName(n), n);
      assert.ok(!isFilePackDirName(n), n);
    }
  });

  it('rejects y! and z! (outside the a-w run)', () => {
    assert.ok(!isFilePackFileName('y!G'));
    assert.ok(!isFilePackFileName('z!G'));
  });
});

describe('compressFilePack (creating a set)', () => {
  const mkFile = (name, type, len, seed) => {
    const d = new Uint8Array(len);
    let s = seed || 1;
    for (let i = 0; i < len; i++) { s = (s * 1103515245 + 12345) & 0x7FFFFFFF; d[i] = (s >> 8) & 0xFF; }
    return { nameBytes: nameBytes(name), typeChar: type, data: d };
  };

  it('round-trips files byte-for-byte', () => {
    const files = [mkFile('ONE', 'P', 700, 1), mkFile('TWO', 'S', 254, 2), mkFile('THREE', 'U', 1500, 3)];
    const enc = compressFilePack(files, 'SET');
    assert.ok(!enc.error, enc.error);
    const back = decompressFilePack(enc.parts.map(p => p.data), enc.dir.data);
    assert.ok(!back.error, back.error);
    assert.strictEqual(back.files.length, 3);
    files.forEach((w, i) => {
      assert.ok(Buffer.from(back.files[i].data).equals(Buffer.from(w.data)), 'file ' + i);
    });
  });

  it('keeps names and types', () => {
    const files = [mkFile('PROG', 'P', 300, 1), mkFile('TEXT', 'S', 300, 2), mkFile('USER', 'U', 300, 3)];
    const back = decompressFilePack(
      compressFilePack(files, 'SET').parts.map(p => p.data),
      compressFilePack(files, 'SET').dir.data);
    assert.deepStrictEqual(back.files.map(f => petsciiToReadable(f.name).trim()), ['PROG', 'TEXT', 'USER']);
    assert.deepStrictEqual(back.files.map(f => f.typeChar), ['P', 'S', 'U']);
  });

  it('names parts a!NAME.. and the directory x!NAME', () => {
    const enc = compressFilePack([mkFile('A', 'P', 100, 1)], 'MYSET');
    assert.strictEqual(enc.parts[0].name, 'a!MYSET');
    assert.strictEqual(enc.dir.name, 'x!MYSET');
  });

  it('splits past 166 sectors into a second data file', () => {
    // 200 sectors of content forces b! to appear.
    const enc = compressFilePack([mkFile('BIG', 'P', 200 * 254, 7)], 'SPLIT');
    assert.strictEqual(enc.parts.length, 2);
    assert.deepStrictEqual(enc.parts.map(p => p.name), ['a!SPLIT', 'b!SPLIT']);
    assert.strictEqual(enc.parts[0].data[2], 166);
    const back = decompressFilePack(enc.parts.map(p => p.data), enc.dir.data);
    assert.strictEqual(back.files.length, 1);
    assert.strictEqual(back.files[0].data.length, 200 * 254);
  });

  it('records the data-file count the reader checks', () => {
    const enc = compressFilePack([mkFile('BIG', 'P', 200 * 254, 7)], 'SPLIT');
    assert.strictEqual(enc.dir.data[0x1FF], 2);
    assert.strictEqual(enc.dir.data[0x200], 1);
  });

  it('handles a file that is an exact multiple of the sector size', () => {
    const enc = compressFilePack([mkFile('EXACT', 'P', 254 * 3, 9)], 'X');
    const back = decompressFilePack(enc.parts.map(p => p.data), enc.dir.data);
    assert.strictEqual(back.files[0].data.length, 254 * 3);
  });

  it('compresses uniform content', () => {
    const flat = { nameBytes: nameBytes('FLAT'), typeChar: 'P', data: new Uint8Array(254 * 20).fill(0xEE) };
    const enc = compressFilePack([flat], 'FILL');
    assert.ok(enc.parts[0].data.length < 254 * 20 / 4, 'packed ' + enc.parts[0].data.length);
    const back = decompressFilePack(enc.parts.map(p => p.data), enc.dir.data);
    assert.ok(Buffer.from(back.files[0].data).equals(Buffer.from(flat.data)));
  });

  it('refuses an empty file list', () => {
    assert.ok(compressFilePack([], 'X').error);
  });
});

describe('x! BASIC lister', () => {
  const mkFile = (name, type, len, fill) => ({
    nameBytes: nameBytes(name), typeChar: type,
    data: new Uint8Array(len).fill(fill === undefined ? 0x41 : fill),
  });

  it('tokenizes to a program our own detokenizer reads back', () => {
    const prog = buildBasicProgram(FILEPACK_LISTER, 0x0801);
    assert.ok(prog, 'program built');
    const file = new Uint8Array(2 + prog.length);
    file[0] = 0x01; file[1] = 0x08;
    file.set(prog, 2);
    const back = detokenizeBasic(file, 'V2');
    assert.strictEqual(back.loadAddr, 0x0801);
    assert.strictEqual(back.lines.length, FILEPACK_LISTER.length);
    back.lines.forEach((l, i) => {
      assert.strictEqual(l.lineNum, FILEPACK_LISTER[i][0]);
      const text = petsciiToReadable(l.parts.map(p => p.text).join(''));
      // $93 (clear screen) lists as a reverse-video "S" on a C64.
      const want = FILEPACK_LISTER[i][1].replace('\x93', 'S');
      assert.strictEqual(text, want, 'line ' + l.lineNum);
    });
  });

  it('fits below the data-file count byte at $01FF', () => {
    const prog = buildBasicProgram(FILEPACK_LISTER, 0x0801);
    assert.ok(2 + prog.length <= 0x1FF, 'lister is ' + prog.length + ' bytes');
  });

  it('is written into a generated x! without disturbing the counts', () => {
    const enc = compressFilePack([mkFile('ONE', 'P', 300), mkFile('TWO', 'S', 300)], 'SET');
    const x = enc.dir.data;
    assert.strictEqual(x[0] | (x[1] << 8), 0x0801, 'load address');
    assert.strictEqual(x[0x1FF], enc.parts.length, 'data-file count intact');
    assert.strictEqual(x[0x200], 2, 'file count intact');
    assert.strictEqual(detokenizeBasic(x, 'V2').lines.length, FILEPACK_LISTER.length);
  });

  it('leaves the set decodable', () => {
    const files = [mkFile('ONE', 'P', 700), mkFile('TWO', 'S', 254)];
    const enc = compressFilePack(files, 'SET');
    const back = decompressFilePack(enc.parts.map(p => p.data), enc.dir.data);
    assert.ok(!back.error, back.error);
    assert.strictEqual(back.files.length, 2);
  });

  // The program PEEKs absolute addresses. Since the file loads at $0801, a
  // PEEK of M reads file offset M - $07FF; if that drifted, the lister would
  // print garbage on real hardware.
  it('PEEKs the addresses the counts and entries actually land on', () => {
    const enc = compressFilePack([mkFile('AAA', 'P', 300), mkFile('BBB', 'U', 300)], 'SET');
    const x = enc.dir.data;
    const PEEK = M => x[M - 0x07FF];
    assert.strictEqual(PEEK(2559), 2, 'PEEK(2559) is the file count');
    assert.strictEqual(PEEK(2558), enc.parts.length, 'PEEK(2558) is the part count');

    // Entry 0 at 2560, entry 1 twenty-one bytes later, as line 5 computes.
    const name0 = [];
    for (let J = 0; J <= 15; J++) {
      const C = PEEK(2560 + J);
      if (C !== 160) name0.push(String.fromCharCode(C));
    }
    assert.strictEqual(name0.join(''), 'AAA');
    assert.strictEqual(String.fromCharCode(PEEK(2560 + 16) & 127), 'P');
    assert.strictEqual(PEEK(2560 + 17) + PEEK(2560 + 18) * 256, 2, 'blocks for a 300-byte file');

    const name1 = [];
    for (let J = 0; J <= 15; J++) {
      const C = PEEK(2560 + 21 + J);
      if (C !== 160) name1.push(String.fromCharCode(C));
    }
    assert.strictEqual(name1.join(''), 'BBB');
    assert.strictEqual(String.fromCharCode(PEEK(2560 + 21 + 16) & 127), 'U');
  });

  it('tokenizes keywords rather than leaving them as text', () => {
    const prog = buildBasicProgram([[10, 'PRINTPEEK(2559)']], 0x0801);
    // link(2) + lineno(2) + PRINT + PEEK + "(2559)" + terminator
    assert.strictEqual(prog[4], 0x99, 'PRINT token');
    assert.strictEqual(prog[5], 0xC2, 'PEEK token');
  });

  it('leaves quoted text alone', () => {
    const prog = buildBasicProgram([[10, 'PRINT"TO PRINT"']], 0x0801);
    const bytes = Array.from(prog.subarray(4));
    assert.strictEqual(bytes[0], 0x99, 'PRINT is tokenized');
    assert.strictEqual(bytes[1], 0x22, 'opening quote');
    // "TO" and "PRINT" inside the string must survive as characters.
    assert.deepStrictEqual(bytes.slice(2, 10).map(b => String.fromCharCode(b)),
      ['T', 'O', ' ', 'P', 'R', 'I', 'N', 'T']);
  });
});
