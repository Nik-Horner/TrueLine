// pdf.js — minimal vector PDF writer (research spec PART C). No DOM, no deps.
// Input: mm in the app's Y-DOWN frame (ARCHITECTURE.md). This module owns the
// flip to PDF's Y-up user space: y' = heightMM - y, angles negate, arcs become
// cubic beziers (max 90 deg per piece, k = (4/3)tan(da/4)).
//
// writePDF(pages) -> Uint8Array
//   pages = [{ widthMM, heightMM,
//              paths:[{ segs, strokeRGB:[r,g,b] 0..1, widthMM,
//                       dash?:[onMM,offMM], closed?:bool }],
//              texts:[{ xMM, yMM, text, sizeMM, rotRad?:0 }] }]
//   segs ops: {m:{x,y}} moveto | {l:{x,y}} lineto | {a:{c:{x,y},r,a0,a1}} arc.

const PT = 72 / 25.4; // points per mm
const TAU = Math.PI * 2;

// ---------------------------------------------------------------- helpers ---

// Fixed-point decimal, trailing zeros stripped ("28.35", "1", "0.7071").
// d=2 matches the byte-verified spec C.5 example; d=4 for rotation matrices.
function fmt(v, d = 2) {
  const p = 10 ** d;
  return String(Math.round(v * p) / p); // String(-0) === "0"
}

// PDF literal string: chars > 255 unsupported by WinAnsi -> '?', escape \ ( ).
function escText(s) {
  return s.replace(/[^\x00-\xFF]/g, '?').replace(/[\\()]/g, m => '\\' + m);
}

// latin-1 byte helper: one char = one byte, so string .length = byte offset.
function latin1(s) {
  const u = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i) & 0xff;
  return u;
}

// ------------------------------------------------------------ content ops ---

// Arc {c,r,a0,a1} in Y-down mm -> beziers in Y-up pt appended to out.
// Y-flip: center y mirrors, angles negate, so the CCW-in-Y-down sweep becomes
// a negative (clockwise) sweep in PDF space.
function emitArc(a, H, out, hasCur) {
  const cx = a.c.x * PT, cy = (H - a.c.y) * PT, r = a.r * PT;
  let sw = ((a.a1 - a.a0) % TAU + TAU) % TAU;
  if (sw < 1e-12) sw = TAU; // a0 === a1: treat as full circle
  const A0 = -a.a0, sweep = -sw;
  const sx = cx + r * Math.cos(A0), sy = cy + r * Math.sin(A0);
  out.push(`${fmt(sx)} ${fmt(sy)} ${hasCur ? 'l' : 'm'}`);
  const n = Math.ceil(Math.abs(sweep) / (Math.PI / 2) - 1e-9);
  for (let i = 1; i <= n; i++) {
    const p = A0 + sweep * (i - 1) / n, q = A0 + sweep * i / n;
    const k = (4 / 3) * Math.tan((q - p) / 4);
    const x0 = cx + r * Math.cos(p), y0 = cy + r * Math.sin(p);
    const x3 = cx + r * Math.cos(q), y3 = cy + r * Math.sin(q);
    out.push(`${fmt(x0 - k * r * Math.sin(p))} ${fmt(y0 + k * r * Math.cos(p))} ` +
             `${fmt(x3 + k * r * Math.sin(q))} ${fmt(y3 - k * r * Math.cos(q))} ` +
             `${fmt(x3)} ${fmt(y3)} c`);
  }
}

// One page's content stream data (exact bytes, LF separators, no trailing LF).
function pageContent(page) {
  const H = page.heightMM;
  const out = [];
  let dashed = false;
  for (const p of page.paths || []) {
    out.push(`${fmt(p.widthMM * PT)} w`);
    out.push(`${fmt(p.strokeRGB[0])} ${fmt(p.strokeRGB[1])} ${fmt(p.strokeRGB[2])} RG`);
    if (p.dash) {
      out.push(`[${fmt(p.dash[0] * PT)} ${fmt(p.dash[1] * PT)}] 0 d`);
      dashed = true;
    } else if (dashed) {
      out.push('[] 0 d'); // reset leaked dash state (no q/Q, so explicit)
      dashed = false;
    }
    let cur = false;
    for (const s of p.segs) {
      if (s.m) { out.push(`${fmt(s.m.x * PT)} ${fmt((H - s.m.y) * PT)} m`); cur = true; }
      else if (s.l) { out.push(`${fmt(s.l.x * PT)} ${fmt((H - s.l.y) * PT)} ${cur ? 'l' : 'm'}`); cur = true; }
      else if (s.a) { emitArc(s.a, H, out, cur); cur = true; }
    }
    if (p.closed) out.push('h');
    out.push('S');
  }
  for (const t of page.texts || []) {
    const rot = t.rotRad || 0;
    // PDF rotation = -rot (Y-flip negates angles). Tm = [cos sin -sin cos x y].
    const co = fmt(Math.cos(rot), 4), si = fmt(-Math.sin(rot), 4), ns = fmt(Math.sin(rot), 4);
    out.push(`BT /F1 ${fmt(t.sizeMM * PT)} Tf ${co} ${si} ${ns} ${co} ` +
             `${fmt(t.xMM * PT)} ${fmt((H - t.yMM) * PT)} Tm (${escText(t.text)}) Tj ET`);
  }
  return out.join('\n');
}

// ------------------------------------------------------------------ writer ---

// Object layout (spec C.3): 1 Catalog, 2 Pages, 3 Font (only if any text),
// then per page i: Page = first+2i, Contents = first+2i+1.
export function writePDF(pages) {
  const hasText = pages.some(p => p.texts && p.texts.length > 0);
  const chunks = [];
  let off = 0;
  const offsets = []; // offsets[objNum - 1] = byte offset of "N 0 obj"
  const push = s => { chunks.push(s); off += s.length; };
  const obj = (num, body) => { offsets[num - 1] = off; push(`${num} 0 obj\n${body}\nendobj\n`); };

  push('%PDF-1.4\n');
  const first = hasText ? 4 : 3;
  const kids = pages.map((_, i) => `${first + 2 * i} 0 R`).join(' ');
  obj(1, '<< /Type /Catalog /Pages 2 0 R >>');
  obj(2, `<< /Type /Pages /Kids [${kids}] /Count ${pages.length} >>`);
  if (hasText)
    obj(3, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
  const res = hasText ? ' /Resources << /Font << /F1 3 0 R >> >>' : '';
  pages.forEach((page, i) => {
    const pn = first + 2 * i, cn = pn + 1;
    obj(pn, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${fmt(page.widthMM * PT)} ` +
            `${fmt(page.heightMM * PT)}] /Contents ${cn} 0 R${res} >>`);
    const data = pageContent(page);
    offsets[cn - 1] = off; // /Length = exact stream data bytes (C.3)
    push(`${cn} 0 obj\n<< /Length ${data.length} >>\nstream\n${data}\nendstream\nendobj\n`);
  });

  const xrefOff = off;
  const size = offsets.length + 1;
  let xref = `xref\n0 ${size}\n0000000000 65535 f \n`; // 20-byte entries (C.4)
  for (const o of offsets) xref += `${String(o).padStart(10, '0')} 00000 n \n`;
  push(xref);
  push(`trailer\n<< /Size ${size} /Root 1 0 R >>\nstartxref\n${xrefOff}\n%%EOF\n`);
  return latin1(chunks.join(''));
}

// ---------------------------------------------------------------- selfTest ---

// Mini self-parser: header, startxref -> 'xref', 20-byte entries, every xref
// offset lands on "N 0 obj", trailer /Size, every /Length exact, %%EOF.
function checkStructure(u8) {
  const fails = [];
  let s = '';
  for (let i = 0; i < u8.length; i++) s += String.fromCharCode(u8[i]);
  if (!s.startsWith('%PDF-1.')) fails.push('missing %PDF header');
  if (!s.endsWith('%%EOF\n')) fails.push('missing %%EOF');
  const sx = s.lastIndexOf('startxref\n');
  if (sx < 0) { fails.push('missing startxref'); return fails; }
  const xoff = parseInt(s.slice(sx + 10), 10);
  if (s.slice(xoff, xoff + 5) !== 'xref\n')
    fails.push(`startxref ${xoff} does not point at "xref"`);
  const hm = /^xref\n0 (\d+)\n/.exec(s.slice(xoff));
  if (!hm) { fails.push('bad xref subsection header'); return fails; }
  const n = parseInt(hm[1], 10);
  const tbl = xoff + hm[0].length;
  if (s.substr(tbl, 20) !== '0000000000 65535 f \n') fails.push('bad free entry 0');
  for (let i = 1; i < n; i++) {
    const e = s.substr(tbl + 20 * i, 20);
    const em = /^(\d{10}) 00000 n \n$/.exec(e);
    if (!em) { fails.push(`xref entry ${i} not 20-byte form: ${JSON.stringify(e)}`); continue; }
    const o = parseInt(em[1], 10);
    const want = `${i} 0 obj\n`;
    if (s.substr(o, want.length) !== want)
      fails.push(`xref ${i}: offset ${o} not at "${i} 0 obj"`);
  }
  const tm = /^trailer\n<< \/Size (\d+) \/Root 1 0 R >>\n/.exec(s.slice(tbl + 20 * n));
  if (!tm) fails.push('malformed trailer');
  else if (parseInt(tm[1], 10) !== n) fails.push(`trailer /Size ${tm[1]} != ${n}`);
  const re = /<< \/Length (\d+) >>\nstream\n/g;
  let sm;
  while ((sm = re.exec(s))) {
    const L = parseInt(sm[1], 10);
    if (s.substr(sm.index + sm[0].length + L, 11) !== '\nendstream\n')
      fails.push(`/Length ${L} at ${sm.index} is not the exact stream byte count`);
  }
  return fails;
}

export function selfTest() {
  const failures = [];
  const ok = (cond, msg) => { if (!cond) failures.push(msg); };
  const str = u8 => { let s = ''; for (let i = 0; i < u8.length; i++) s += String.fromCharCode(u8[i]); return s; };
  const streamOf = s => s.slice(s.indexOf('stream\n') + 7, s.indexOf('\nendstream'));

  // ---- (1) spec C.5 example: 100x100mm, blue 1pt line (10,10)->(90,90) in
  // PDF frame => internal Y-down (10,90)->(90,10). Must be 465 bytes exactly.
  const pdf1 = writePDF([{
    widthMM: 100, heightMM: 100,
    paths: [{ segs: [{ m: { x: 10, y: 90 } }, { l: { x: 90, y: 10 } }],
              strokeRGB: [0, 0, 1], widthMM: 25.4 / 72 /* exactly 1pt */ }],
    texts: [],
  }]);
  ok(pdf1.length === 465, `C.5: byte length ${pdf1.length} != 465`);
  const s1 = str(pdf1);
  ok(streamOf(s1) === '1 w\n0 0 1 RG\n28.35 28.35 m\n255.12 255.12 l\nS',
     'C.5: content stream bytes mismatch');
  ok(s1.includes('xref\n0 5\n0000000000 65535 f \n0000000009 00000 n \n' +
                 '0000000058 00000 n \n0000000115 00000 n \n0000000208 00000 n \n'),
     'C.5: xref offsets != 9/58/115/208');
  ok(/startxref\n302\n%%EOF\n$/.test(s1), 'C.5: startxref != 302');
  ok(!s1.includes('/Font'), 'C.5: font object must be absent without texts');
  for (const f of checkStructure(pdf1)) failures.push('C.5: ' + f);

  // ---- (2) two pages: arc + dashed closed path + dash reset + rotated text.
  const pdf2 = writePDF([
    { widthMM: 200, heightMM: 100,
      paths: [
        { segs: [{ a: { c: { x: 50, y: 50 }, r: 20, a0: 0, a1: Math.PI / 2 } }],
          strokeRGB: [1, 0, 0], widthMM: 0.5 },
        { segs: [{ m: { x: 0, y: 0 } }, { l: { x: 10, y: 0 } }, { l: { x: 10, y: 10 } }],
          strokeRGB: [0, 0, 0], widthMM: 0.25, dash: [2, 1], closed: true },
        { segs: [{ m: { x: 20, y: 20 } }, { l: { x: 30, y: 20 } }],
          strokeRGB: [0, 1, 0], widthMM: 0.25 },
      ],
      texts: [{ xMM: 100, yMM: 50, text: '45° (ok) \\', sizeMM: 3.5, rotRad: Math.PI / 4 }] },
    { widthMM: 50, heightMM: 50,
      paths: [{ segs: [{ m: { x: 5, y: 5 } }, { l: { x: 45, y: 45 } }],
                strokeRGB: [0, 0, 1], widthMM: 0.3 }],
      texts: [] },
  ]);
  const s2 = str(pdf2);
  for (const f of checkStructure(pdf2)) failures.push('doc2: ' + f);
  ok(s2.includes('/BaseFont /Helvetica') && s2.includes('/Encoding /WinAnsiEncoding'),
     'doc2: Helvetica/WinAnsi font object missing');
  ok(s2.includes('/Kids [4 0 R 6 0 R] /Count 2'), 'doc2: /Kids or /Count wrong');
  ok(s2.includes('/Resources << /Font << /F1 3 0 R >> >>'), 'doc2: page /Resources missing');
  ok(s2.includes('[5.67 2.83] 0 d'), 'doc2: dash pattern [2mm 1mm] -> [5.67 2.83] pt missing');
  ok(s2.includes('\nh\nS'), 'doc2: closepath h before S missing');
  ok(s2.includes('[] 0 d'), 'doc2: dash reset after dashed path missing');
  ok(s2.includes('(45\xB0 \\(ok\\) \\\\) Tj ET'), 'doc2: WinAnsi/escaped text mismatch');
  ok(s2.includes('BT /F1 9.92 Tf 0.7071 -0.7071 0.7071 0.7071 '),
     'doc2: rotated text Tm (PDF angle = -rotRad) mismatch');
  // Arc: internal quarter (50,50) r20 a0=0 a1=pi/2 on H=100 => PDF start
  // (70,50)mm = 198.43 141.73 pt, end (50,30)mm = 141.73 85.04 pt, ONE bezier.
  const ai = s2.indexOf('198.43 141.73 m\n');
  ok(ai >= 0, 'doc2: arc start moveto missing');
  if (ai >= 0) {
    const lines = s2.slice(ai).split('\n');
    ok(lines[1].endsWith(' c'), 'doc2: arc bezier op missing');
    ok(lines[2] === 'S', `doc2: quarter arc must be 1 bezier, next line "${lines[2]}"`);
    const nb = lines[1].split(' ').map(Number);
    ok(Math.abs(nb[4] - 141.73) < 0.02 && Math.abs(nb[5] - 85.04) < 0.02,
       `doc2: arc endpoint (${nb[4]},${nb[5]}) != (141.73,85.04)`);
    // t=0.5 point of the cubic must lie on the circle (center 141.73,141.73 pt, r 56.69 pt)
    const mx = (198.43 + 3 * nb[0] + 3 * nb[2] + nb[4]) / 8;
    const my = (141.73 + 3 * nb[1] + 3 * nb[3] + nb[5]) / 8;
    const dr = Math.hypot(mx - 141.73, my - 141.73) - 20 * PT;
    ok(Math.abs(dr) < 0.1, `doc2: bezier midpoint off circle by ${dr}pt`);
  }

  // ---- (3) full circle via a0 === a1: 4 bezier pieces, closes on start point.
  const pdf3 = writePDF([{
    widthMM: 100, heightMM: 100,
    paths: [{ segs: [{ a: { c: { x: 50, y: 50 }, r: 10, a0: Math.PI / 3, a1: Math.PI / 3 } }],
              strokeRGB: [0, 0, 0], widthMM: 0.2 }],
    texts: [],
  }]);
  const s3 = str(pdf3);
  for (const f of checkStructure(pdf3)) failures.push('doc3: ' + f);
  const l3 = streamOf(s3).split('\n');
  const cN = l3.filter(l => l.endsWith(' c')).length;
  ok(cN === 4, `doc3: full circle emitted ${cN} beziers, expected 4`);
  const start = l3[2].split(' ').map(Number); // after "w" and "RG" lines
  ok(l3[2].endsWith(' m'), 'doc3: circle must start with moveto');
  const last = l3[2 + cN].split(' ').map(Number);
  ok(Math.abs(last[4] - start[0]) < 0.02 && Math.abs(last[5] - start[1]) < 0.02,
     `doc3: circle end (${last[4]},${last[5]}) != start (${start[0]},${start[1]})`);

  return { pass: failures.length === 0, failures };
}
