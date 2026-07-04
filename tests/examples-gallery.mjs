// Render a gallery of realistic engineering parts (as TrueLine geometry) for the README.
// Writes examples.svg to the app root; convert to PNG with the canvas readback step.
import * as G from '../js/geom.js';
import { writeFileSync } from 'fs';

const TAU = Math.PI * 2, B = Math.tan(Math.PI / 8);   // 90° corner bulge
const circle = (x, y, r) => ({ type: 'circle', c: { x, y }, r });
// rounded rectangle as a closed bulge polyline (convex corners)
function roundRect(x, y, w, h, r) {
  const pts = [
    { x: x + r, y }, { x: x + w - r, y, bulge: B },
    { x: x + w, y: y + r }, { x: x + w, y: y + h - r, bulge: B },
    { x: x + w - r, y: y + h }, { x: x + r, y: y + h, bulge: B },
    { x, y: y + h - r }, { x, y: y + r, bulge: B },
  ];
  return { type: 'poly', closed: true, pts };
}
// slot / stadium (fully rounded ends)
const slot = (x, y, w, h) => roundRect(x, y, w, h, h / 2);
const boltCircle = (cx, cy, br, n, hr, a0 = -Math.PI / 2) =>
  Array.from({ length: n }, (_, i) => circle(cx + br * Math.cos(a0 + i / n * TAU), cy + br * Math.sin(a0 + i / n * TAU), hr));
function regPoly(cx, cy, r, n, a0 = -Math.PI / 2) {
  const pts = Array.from({ length: n }, (_, i) => ({ x: cx + r * Math.cos(a0 + i / n * TAU), y: cy + r * Math.sin(a0 + i / n * TAU) }));
  return { type: 'poly', closed: true, pts };
}
const dimH = (p1, p2, tp) => ({ type: 'dim', kind: 'linear-h', p1, p2, tp });
const dimR = (c, r, tp) => ({ type: 'dim', kind: 'radial', c, r, tp });

const parts = [
  { name: 'mounting bracket', ents: () => [
    roundRect(0, 0, 100, 64, 8),
    circle(14, 14, 4.5), circle(86, 14, 4.5), circle(14, 50, 4.5), circle(86, 50, 4.5),
    circle(50, 32, 13),
    dimH({ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 50, y: -14 }),
  ] },
  { name: 'bolt flange', ents: () => [
    circle(45, 45, 42), circle(45, 45, 15),
    ...boltCircle(45, 45, 30, 6, 5),
    dimR({ x: 45, y: 45 }, 42, { x: 45 + 42 * Math.cos(-0.9), y: 45 + 42 * Math.sin(-0.9) }),
  ] },
  { name: 'slotted plate', ents: () => [
    roundRect(0, 0, 110, 50, 6),
    slot(28, 18, 54, 14),
    circle(12, 25, 5), circle(98, 25, 5),
  ] },
  { name: 'pivot lever', ents: () => [
    slot(0, 20, 96, 26),                    // body
    circle(15, 33, 8), circle(15, 33, 4),   // pivot boss
    circle(84, 33, 5),                       // grip hole
    dimH({ x: 0, y: 33 }, { x: 96, y: 33 }, { x: 48, y: 4 }),
  ] },
  { name: 'gasket', ents: () => [
    { type: 'poly', closed: true, pts: [
      { x: 8, y: 0, bulge: 0 }, { x: 92, y: 0, bulge: B },
      { x: 100, y: 10 }, { x: 100, y: 46, bulge: B },
      { x: 84, y: 62 }, { x: 44, y: 62, bulge: -B * 1.2 },
      { x: 20, y: 54, bulge: 0 }, { x: 0, y: 30, bulge: 0 }, { x: 0, y: 10, bulge: B },
    ] },
    ...boltCircle(52, 34, 30, 8, 4),
    circle(52, 34, 14),
  ] },
  { name: 'hex spacer', ents: () => [
    regPoly(45, 42, 40, 6, 0),
    circle(45, 42, 18),
    dimH({ x: 45 - 40 * Math.cos(Math.PI / 6), y: 42 - 40 * Math.sin(Math.PI / 6) }, { x: 45 + 40 * Math.cos(Math.PI / 6), y: 42 - 40 * Math.sin(Math.PI / 6) }, { x: 45, y: -12 }),
  ] },
];

const ds = { textH: 5, arrow: 2.5, extOff: 1.5, extOver: 2 };
function entPath(e) {
  if (e.type === 'line') return `M ${f(e.a.x)} ${f(e.a.y)} L ${f(e.b.x)} ${f(e.b.y)}`;
  if (e.type === 'circle') return `M ${f(e.c.x - e.r)} ${f(e.c.y)} a ${f(e.r)} ${f(e.r)} 0 1 0 ${f(2 * e.r)} 0 a ${f(e.r)} ${f(e.r)} 0 1 0 ${f(-2 * e.r)} 0`;
  if (e.type === 'arc') { const s = pol(e.c, e.r, e.a0), en = pol(e.c, e.r, e.a1), sw = G.sweep(e.a0, e.a1); return `M ${f(s.x)} ${f(s.y)} A ${f(e.r)} ${f(e.r)} 0 ${sw > Math.PI ? 1 : 0} 1 ${f(en.x)} ${f(en.y)}`; }
  if (e.type === 'poly') { let d = `M ${f(e.pts[0].x)} ${f(e.pts[0].y)}`; const n = e.pts.length, segs = e.closed ? n : n - 1; for (let i = 0; i < segs; i++) { const p1 = e.pts[i], p2 = e.pts[(i + 1) % n]; if (!p1.bulge) d += ` L ${f(p2.x)} ${f(p2.y)}`; else { const arc = G.bulgeToArc(p1, p2, p1.bulge); const sw = G.sweep(arc.a0, arc.a1); d += ` A ${f(arc.r)} ${f(arc.r)} 0 ${sw > Math.PI ? 1 : 0} ${p1.bulge > 0 ? 1 : 0} ${f(p2.x)} ${f(p2.y)}`; } } if (e.closed) d += ' Z'; return d; }
  return '';
}
const f = n => +n.toFixed(2);
const pol = (c, r, a) => ({ x: c.x + r * Math.cos(a), y: c.y + r * Math.sin(a) });
// minimal linear/radial dim rendering (matches app style)
function dimSvg(e) {
  let out = '';
  if (e.kind === 'radial') {
    const ang = Math.atan2(e.tp.y - e.c.y, e.tp.x - e.c.x), on = pol(e.c, e.r, ang);
    out += `<line x1="${f(e.c.x)}" y1="${f(e.c.y)}" x2="${f(e.tp.x)}" y2="${f(e.tp.y)}"/>`;
    out += arrow(on, ang);
    out += dimText(e.tp, 'R ' + f(e.r), ang);
  } else {
    const n = { x: 0, y: 1 };
    const off = e.tp.y - (e.p1.y + e.p2.y) / 2;
    const q1 = { x: e.p1.x, y: e.p1.y + off }, q2 = { x: e.p2.x, y: e.p2.y + off };
    const s = off >= 0 ? 1 : -1;
    out += `<line x1="${f(e.p1.x)}" y1="${f(e.p1.y + s * ds.extOff)}" x2="${f(q1.x)}" y2="${f(q1.y + s * ds.extOver)}"/>`;
    out += `<line x1="${f(e.p2.x)}" y1="${f(e.p2.y + s * ds.extOff)}" x2="${f(q2.x)}" y2="${f(q2.y + s * ds.extOver)}"/>`;
    out += `<line x1="${f(q1.x)}" y1="${f(q1.y)}" x2="${f(q2.x)}" y2="${f(q2.y)}"/>`;
    out += arrow(q1, 0) + arrow(q2, Math.PI);
    out += dimText({ x: (q1.x + q2.x) / 2, y: q1.y - 2 }, f(Math.abs(e.p2.x - e.p1.x)) + '', 0);
  }
  return out;
}
function arrow(tip, dir) { const s = ds.arrow; const a = pol(tip, s, dir + 0.42), b = pol(tip, s, dir - 0.42); return `<path d="M ${f(tip.x)} ${f(tip.y)} L ${f(a.x)} ${f(a.y)} L ${f(b.x)} ${f(b.y)} Z" fill="#6FD3E8" stroke="none"/>`; }
function dimText(p, t, rot) { return `<text x="${f(p.x)}" y="${f(p.y)}" fill="#6FD3E8" font-family="monospace" font-size="5" text-anchor="middle" stroke="none">${t}</text>`; }

const CELL = 200, GAP = 14, COLS = 3, ch = CELL + 24;
const rows = Math.ceil(parts.length / COLS);
let body = '';
parts.forEach((part, idx) => {
  const ents = part.ents();
  const geom = ents.filter(e => e.type !== 'dim');
  let minX = 1e9, minY = 1e9, maxX = -1e9, maxY = -1e9;
  for (const e of geom) { const b = G.entBounds(e); minX = Math.min(minX, b.minX); minY = Math.min(minY, b.minY); maxX = Math.max(maxX, b.maxX); maxY = Math.max(maxY, b.maxY); }
  const w = maxX - minX, h = maxY - minY, pad = 22;
  const scale = Math.min((CELL - 2 * pad) / w, (CELL - 2 * pad - 10) / h);
  const ox = (CELL - w * scale) / 2 - minX * scale, oy = (CELL - h * scale) / 2 - minY * scale + 4;
  const col = idx % COLS, row = Math.floor(idx / COLS), tx = GAP + col * (CELL + GAP), ty = GAP + row * (ch + GAP);
  body += `<g transform="translate(${tx},${ty})">`;
  body += `<rect width="${CELL}" height="${ch}" rx="6" fill="#12151B" stroke="#262C38"/>`;
  body += `<g transform="translate(${f(ox)},${f(oy)}) scale(${f(scale)})" fill="none" stroke="#DEE3EC" stroke-width="${f(1.2 / scale)}">`;
  for (const e of geom) body += `<path d="${entPath(e)}"/>`;
  body += `<g stroke="#6FD3E8" stroke-width="${f(0.8 / scale)}">`;
  for (const e of ents) if (e.type === 'dim') body += dimSvg(e);
  body += `</g></g>`;
  body += `<text x="10" y="${ch - 8}" fill="#DEE3EC" font-family="monospace" font-size="11">${part.name}</text>`;
  body += `</g>`;
});
const W = GAP + COLS * (CELL + GAP), H = GAP + rows * (ch + GAP);
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}"><rect width="${W}" height="${H}" fill="#0B0E13"/>${body}</svg>`;
writeFileSync(new URL('../examples.svg', import.meta.url), svg);
console.log('wrote examples.svg', W + 'x' + H, parts.length, 'parts');
