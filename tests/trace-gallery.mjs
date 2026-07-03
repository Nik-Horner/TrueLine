// Render a visual gallery: for each shape, show the noisy INPUT stroke (grey),
// the RAW smooth polyline (blue), and the FIT result (amber, with dots at vertices).
// Writes gallery.svg to the app root so it can be opened / screenshotted.
import * as G from '../js/geom.js';
import { writeFileSync } from 'fs';

const TAU = Math.PI * 2;
function rng(seed) { let s = seed >>> 0; return () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff - 0.5; }; }
function sample(fn, n, noise, seed) { const r = rng(seed); const p = []; for (let i = 0; i <= n; i++) { const q = fn(i / n); p.push({ x: q.x + r() * noise, y: q.y + r() * noise }); } return p; }
function rr(t, w, h, rad) { const sB = w - 2 * rad, sR = h - 2 * rad, q = Math.PI / 2 * rad, per = 2 * sB + 2 * sR + 4 * q; let d = t * per; const arc = (cx, cy, a0) => { const a = a0 + d / rad; return { x: cx + rad * Math.cos(a), y: cy + rad * Math.sin(a) }; }; if (d < sB) return { x: rad + d, y: 0 }; d -= sB; if (d < q) return arc(w - rad, rad, -Math.PI / 2); d -= q; if (d < sR) return { x: w, y: rad + d }; d -= sR; if (d < q) return arc(w - rad, h - rad, 0); d -= q; if (d < sB) return { x: w - rad - d, y: h }; d -= sB; if (d < q) return arc(rad, h - rad, Math.PI / 2); d -= q; if (d < sR) return { x: 0, y: h - rad - d }; d -= sR; return arc(rad, rad, Math.PI); }

const shapes = [
  ['circle', t => ({ x: 45 + 35 * Math.cos(t * TAU), y: 45 + 35 * Math.sin(t * TAU) }), 140],
  ['half-circle', t => ({ x: 45 + 40 * Math.cos(Math.PI + Math.PI * t), y: 60 + 40 * Math.sin(Math.PI + Math.PI * t) }), 90],
  ['square', t => { const v = [[5, 5], [80, 5], [80, 80], [5, 80], [5, 5]]; const s = Math.min(3, Math.floor(t * 4)); const f = t * 4 - s; const a = v[s], b = v[s + 1]; return { x: a[0] + (b[0] - a[0]) * f, y: a[1] + (b[1] - a[1]) * f }; }, 160],
  ['triangle', t => { const v = [[5, 80], [85, 80], [45, 8], [5, 80]]; const s = Math.min(2, Math.floor(t * 3)); const f = t * 3 - s; const a = v[s], b = v[s + 1]; return { x: a[0] + (b[0] - a[0]) * f, y: a[1] + (b[1] - a[1]) * f }; }, 120],
  ['rounded-rect', t => rr(t, 85, 55, 12), 200],
  ['slot', t => rr(t, 90, 26, 13), 200],
  ['ellipse', t => ({ x: 48 + 42 * Math.cos(t * TAU), y: 45 + 24 * Math.sin(t * TAU) }), 160],
  ['L-shape', t => t < 0.5 ? { x: 8 + t * 2 * 74, y: 12 } : { x: 82, y: 12 + (t - 0.5) * 2 * 70 }, 90],
  ['S-curve', t => ({ x: 8 + t * 80, y: 45 + 32 * Math.sin(t * TAU) }), 120],
  ['squiggle', t => ({ x: 8 + t * 82, y: 45 + 22 * Math.sin(t * 3.2 * TAU) }), 180],
  ['tangent line+arc', t => t < 0.5 ? { x: 6 + t / 0.5 * 44, y: 20 } : (() => { const a = -Math.PI / 2 + (t - 0.5) / 0.5 * Math.PI; return { x: 50 + 28 * Math.cos(a), y: 48 + 28 * Math.sin(a) }; })(), 130],
  ['spiral', t => { const a = t * 2.5 * TAU; const r = 6 + t * 34; return { x: 48 + r * Math.cos(a), y: 48 + r * Math.sin(a) }; }, 220],
];

const CELL = 150, PAD = 16, COLS = 4, cw = CELL, ch = CELL + 22;
const rows = Math.ceil(shapes.length / COLS);
let body = '';
const path = (pts, closed) => 'M ' + pts.map(p => `${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' L ') + (closed ? ' Z' : '');
function entPath(e) {
  if (e.type === 'line') return `M ${e.a.x.toFixed(1)} ${e.a.y.toFixed(1)} L ${e.b.x.toFixed(1)} ${e.b.y.toFixed(1)}`;
  if (e.type === 'circle') return `M ${(e.c.x - e.r).toFixed(1)} ${e.c.y.toFixed(1)} a ${e.r.toFixed(1)} ${e.r.toFixed(1)} 0 1 0 ${(2 * e.r).toFixed(1)} 0 a ${e.r.toFixed(1)} ${e.r.toFixed(1)} 0 1 0 ${(-2 * e.r).toFixed(1)} 0`;
  if (e.type === 'arc') { const s = { x: e.c.x + e.r * Math.cos(e.a0), y: e.c.y + e.r * Math.sin(e.a0) }; const en = { x: e.c.x + e.r * Math.cos(e.a1), y: e.c.y + e.r * Math.sin(e.a1) }; const sw = G.sweep(e.a0, e.a1); return `M ${s.x.toFixed(1)} ${s.y.toFixed(1)} A ${e.r.toFixed(1)} ${e.r.toFixed(1)} 0 ${sw > Math.PI ? 1 : 0} 1 ${en.x.toFixed(1)} ${en.y.toFixed(1)}`; }
  if (e.type === 'poly') { let d = `M ${e.pts[0].x.toFixed(1)} ${e.pts[0].y.toFixed(1)}`; const n = e.pts.length; const segs = e.closed ? n : n - 1; for (let i = 0; i < segs; i++) { const p1 = e.pts[i], p2 = e.pts[(i + 1) % n]; if (!p1.bulge) d += ` L ${p2.x.toFixed(1)} ${p2.y.toFixed(1)}`; else { const arc = G.bulgeToArc(p1, p2, p1.bulge); const sw = G.sweep(arc.a0, arc.a1); d += ` A ${arc.r.toFixed(1)} ${arc.r.toFixed(1)} 0 ${sw > Math.PI ? 1 : 0} ${p1.bulge > 0 ? 1 : 0} ${p2.x.toFixed(1)} ${p2.y.toFixed(1)}`; } } if (e.closed) d += ' Z'; return d; }
  return '';
}
function verts(entities) { let v = ''; for (const e of entities) { if (e.type === 'poly') for (const p of e.pts) v += `<circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="1.3" fill="#FFB224"/>`; else if (e.type === 'line') { v += `<circle cx="${e.a.x.toFixed(1)}" cy="${e.a.y.toFixed(1)}" r="1.3" fill="#FFB224"/><circle cx="${e.b.x.toFixed(1)}" cy="${e.b.y.toFixed(1)}" r="1.3" fill="#FFB224"/>`; } } return v; }

shapes.forEach(([name, fn, n], idx) => {
  const col = idx % COLS, row = Math.floor(idx / COLS);
  const pts = sample(fn, n, 0.7, 4321 + idx);
  const raw = G.smoothStroke(pts, 0.8);
  const rawClosed = raw.length > 2 && G.dist(raw[0], raw[raw.length - 1]) < 4;
  const fit = G.fitStroke(pts, { tol: 0.8, cornerDeg: 35 });
  const fitDesc = fit.length === 1 ? fit[0].type + (fit[0].type === 'poly' ? `·${G.polyToSegments(fit[0]).length}seg` : '') : fit.length + ' ents';
  const tx = PAD + col * (cw + PAD), ty = PAD + row * (ch + PAD);
  body += `<g transform="translate(${tx},${ty})">`;
  body += `<rect width="${cw}" height="${ch}" rx="6" fill="#12151B" stroke="#262C38"/>`;
  // fit-to-cell transform for the drawing (shapes are ~0..90)
  const gInner = `translate(28,26) scale(1.15)`;
  body += `<g transform="${gInner}">`;
  body += `<path d="${path(pts, false)}" fill="none" stroke="#3a4152" stroke-width="2.4"/>`;            // input (grey, thick)
  body += `<path d="${path(raw, rawClosed)}" fill="none" stroke="#4C9FFF" stroke-width="1" opacity="0.9"/>`;  // raw (blue)
  for (const e of fit) body += `<path d="${entPath(e)}" fill="none" stroke="#FFB224" stroke-width="1.3"/>`;      // fit (amber)
  body += verts(fit);
  body += `</g>`;
  body += `<text x="8" y="${ch - 7}" fill="#DEE3EC" font-family="monospace" font-size="10">${name}</text>`;
  body += `<text x="${cw - 6}" y="${ch - 7}" text-anchor="end" fill="#8A93A6" font-family="monospace" font-size="9">${fitDesc}</text>`;
  body += `</g>`;
});
const W = PAD + COLS * (cw + PAD), H = PAD + rows * (ch + PAD) + 30;
const legend = `<g transform="translate(${PAD},${H - 16})" font-family="monospace" font-size="11">
  <rect x="0" y="-9" width="18" height="3" fill="#3a4152"/><text x="24" y="-4" fill="#8A93A6">input (traced)</text>
  <rect x="150" y="-9" width="18" height="3" fill="#4C9FFF"/><text x="174" y="-4" fill="#8A93A6">raw (smooth)</text>
  <rect x="290" y="-9" width="18" height="3" fill="#FFB224"/><text x="314" y="-4" fill="#8A93A6">fit (snap to shapes)</text></g>`;
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}"><rect width="${W}" height="${H}" fill="#0B0E13"/>${body}${legend}</svg>`;
writeFileSync(new URL('../gallery.svg', import.meta.url), svg);
console.log('wrote gallery.svg', W + 'x' + H);
