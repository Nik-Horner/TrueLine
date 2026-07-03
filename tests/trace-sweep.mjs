// Exhaustive tracing sweep: run RAW (rdp) and FIT (fitStroke) over a large library of
// shapes at several noise levels, measure fidelity + entity count, flag anomalies.
//   node tests/trace-sweep.mjs [--verbose]
import * as G from '../js/geom.js';

const verbose = process.argv.includes('--verbose');
const TAU = Math.PI * 2;

// seeded rng so results are reproducible
function rng(seed) { let s = seed >>> 0; return () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff - 0.5; }; }

// resample an analytic path densely (simulate pen sampling ~0.7mm) + add tremor
function sample(fn, n, noise, seed) {
  const r = rng(seed);
  const pts = [];
  for (let i = 0; i <= n; i++) {
    const p = fn(i / n);
    pts.push({ x: p.x + r() * noise, y: p.y + r() * noise });
  }
  return pts;
}

// ---- shape library: each returns { name, pts, expect:{closed, kind} } ----
function lib(noise, seed) {
  const S = [];
  const add = (name, fn, n, expect) => S.push({ name, pts: sample(fn, n, noise, seed), expect });

  add('line', t => ({ x: t * 100, y: 30 }), 60, { closed: false, kind: 'line' });
  add('diag-line', t => ({ x: t * 80, y: t * 60 }), 60, { closed: false, kind: 'line' });
  add('L-corner', t => t < 0.5 ? { x: t * 2 * 60, y: 0 } : { x: 60, y: (t - 0.5) * 2 * 60 }, 80, { closed: false, kind: 'lines' });
  add('zigzag', t => { const seg = Math.min(3, Math.floor(t * 4)); const f = t * 4 - seg; const pts = [[0, 0], [30, 40], [60, 0], [90, 40], [120, 0]]; const a = pts[seg], b = pts[seg + 1]; return { x: a[0] + (b[0] - a[0]) * f, y: a[1] + (b[1] - a[1]) * f }; }, 120, { closed: false, kind: 'lines' });
  add('circle', t => ({ x: 40 + 30 * Math.cos(t * TAU), y: 40 + 30 * Math.sin(t * TAU) }), 140, { closed: true, kind: 'circle' });
  add('small-circle', t => ({ x: 10 + 6 * Math.cos(t * TAU), y: 10 + 6 * Math.sin(t * TAU) }), 90, { closed: true, kind: 'circle' });
  add('big-circle', t => ({ x: 200 + 150 * Math.cos(t * TAU), y: 200 + 150 * Math.sin(t * TAU) }), 220, { closed: true, kind: 'circle' });
  add('half-circle', t => ({ x: 40 + 40 * Math.cos(Math.PI * t), y: 40 + 40 * Math.sin(Math.PI * t) }), 90, { closed: false, kind: 'arc' });
  add('quarter-arc', t => ({ x: 50 * Math.cos(t * Math.PI / 2), y: 50 * Math.sin(t * Math.PI / 2) }), 70, { closed: false, kind: 'arc' });
  add('shallow-arc', t => ({ x: t * 100, y: 10 * Math.sin(t * Math.PI) }), 90, { closed: false, kind: 'arc' });
  add('S-curve', t => ({ x: t * 120, y: 25 * Math.sin(t * TAU) }), 120, { closed: false, kind: 'mixed' });
  add('sine-squiggle', t => ({ x: t * 140, y: 18 * Math.sin(t * 3 * TAU) }), 180, { closed: false, kind: 'mixed' });
  add('triangle', t => { const v = [[0, 0], [80, 0], [40, 60], [0, 0]]; const seg = Math.min(2, Math.floor(t * 3)); const f = t * 3 - seg; const a = v[seg], b = v[seg + 1]; return { x: a[0] + (b[0] - a[0]) * f, y: a[1] + (b[1] - a[1]) * f }; }, 120, { closed: true, kind: 'lines' });
  add('square', t => { const v = [[0, 0], [70, 0], [70, 70], [0, 70], [0, 0]]; const seg = Math.min(3, Math.floor(t * 4)); const f = t * 4 - seg; const a = v[seg], b = v[seg + 1]; return { x: a[0] + (b[0] - a[0]) * f, y: a[1] + (b[1] - a[1]) * f }; }, 160, { closed: true, kind: 'lines' });
  add('pentagon', t => { const seg = Math.min(4, Math.floor(t * 5)); const f = t * 5 - seg; const A = i => ({ x: 40 + 40 * Math.cos(-Math.PI / 2 + i / 5 * TAU), y: 40 + 40 * Math.sin(-Math.PI / 2 + i / 5 * TAU) }); const a = A(seg), b = A(seg + 1); return { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f }; }, 150, { closed: true, kind: 'lines' });
  add('rounded-rect', t => roundedRect(t, 80, 50, 10), 200, { closed: true, kind: 'mixed' });
  add('stadium', t => roundedRect(t, 80, 40, 20), 200, { closed: true, kind: 'mixed' });
  add('ellipse', t => ({ x: 60 + 50 * Math.cos(t * TAU), y: 40 + 25 * Math.sin(t * TAU) }), 160, { closed: true, kind: 'ellipse' });
  add('teardrop', t => { const a = t * TAU; const r = 30 * (1 - 0.6 * Math.cos(a)); return { x: 40 + r * Math.cos(a), y: 40 + r * Math.sin(a) }; }, 160, { closed: true, kind: 'blob' });
  add('slot', t => roundedRect(t, 100, 20, 10), 200, { closed: true, kind: 'mixed' });
  add('spiral', t => { const a = t * 3 * TAU; const r = 5 + t * 40; return { x: 60 + r * Math.cos(a), y: 60 + r * Math.sin(a) }; }, 240, { closed: false, kind: 'mixed' });
  add('wave-line', t => ({ x: t * 120, y: 3 * Math.sin(t * 8 * TAU) }), 200, { closed: false, kind: 'line' });   // tremor-heavy near-straight
  add('rounded-L', t => roundedL(t), 140, { closed: false, kind: 'mixed' });
  add('tangent-line-arc', t => tangentLineArc(t), 140, { closed: false, kind: 'mixed' });
  return S;
}
function roundedRect(t, w, h, r) {
  const straightB = w - 2 * r, straightR = h - 2 * r, quarter = Math.PI / 2 * r;
  const per = 2 * straightB + 2 * straightR + 4 * quarter;
  let d = t * per;
  const arc = (cx, cy, a0) => { const a = a0 + (d / r); return { x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) }; };
  if (d < straightB) return { x: r + d, y: 0 }; d -= straightB;
  if (d < quarter) return arc(w - r, r, -Math.PI / 2); d -= quarter;
  if (d < straightR) return { x: w, y: r + d }; d -= straightR;
  if (d < quarter) return arc(w - r, h - r, 0); d -= quarter;
  if (d < straightB) return { x: w - r - d, y: h }; d -= straightB;
  if (d < quarter) return arc(r, h - r, Math.PI / 2); d -= quarter;
  if (d < straightR) return { x: 0, y: h - r - d }; d -= straightR;
  return arc(r, r, Math.PI);
}
function roundedL(t) { // horizontal then rounded 90 then vertical
  const r = 12; if (t < 0.42) return { x: t / 0.42 * 60, y: 0 };
  if (t < 0.58) { const a = -Math.PI / 2 + (t - 0.42) / 0.16 * Math.PI / 2; return { x: 60 + r * Math.cos(a), y: r + r * Math.sin(a) }; }
  return { x: 60 + r, y: r + (t - 0.58) / 0.42 * 60 };
}
function tangentLineArc(t) { if (t < 0.5) return { x: t / 0.5 * 50, y: 0 }; const a = -Math.PI / 2 + (t - 0.5) / 0.5 * Math.PI; return { x: 50 + 25 * Math.cos(a), y: 25 + 25 * Math.sin(a) }; }
function keyhole(t) { const a = t * TAU; if (t < 0.75) { return { x: 40 + 25 * Math.cos(a * 4 / 3 - Math.PI / 2), y: 30 + 25 * Math.sin(a * 4 / 3 - Math.PI / 2) }; } return { x: 40, y: 55 + (t - 0.75) / 0.25 * 0 }; }

// ---- metrics ----
function toSegs(entities) {
  return entities.flatMap(e => e.type === 'poly' ? G.polyToSegments(e) : e.type === 'circle' ? [e] : [e]);
}
function fidelity(entities, pts) {
  const segs = toSegs(entities);
  if (!segs.length) return Infinity;
  let maxd = 0;
  for (const p of pts) {
    let best = Infinity;
    for (const s of segs) { const cp = G.closestPointOnEntity(s, p); if (cp && cp.d < best) best = cp.d; }
    if (best > maxd) maxd = best;
  }
  return maxd;
}
function entityCount(entities) {
  let n = 0;
  for (const e of entities) n += e.type === 'poly' ? G.polyToSegments(e).length : 1;
  return n;
}
// max tangent-discontinuity (kink) between consecutive fit segments, in degrees.
// smooth curves should have small kinks; sharp corners (polygons) legitimately have big ones.
function segTangents(s) {
  if (s.type === 'line') { const d = { x: s.b.x - s.a.x, y: s.b.y - s.a.y }; const L = Math.hypot(d.x, d.y) || 1; const t = { x: d.x / L, y: d.y / L }; return [t, t]; }
  if (s.type === 'arc') {
    const t0 = { x: -Math.sin(s.a0), y: Math.cos(s.a0) }, t1 = { x: -Math.sin(s.a1), y: Math.cos(s.a1) };
    const dir = G.sweep(s.a0, s.a1) <= Math.PI ? 1 : 1;   // increasing-angle traversal
    return [{ x: t0.x * dir, y: t0.y * dir }, { x: t1.x * dir, y: t1.y * dir }];
  }
  return [{ x: 1, y: 0 }, { x: 1, y: 0 }];
}
function maxKink(entities) {
  const segs = entities.flatMap(e => e.type === 'poly' ? G.polyToSegments(e) : [e]);
  let mk = 0;
  for (let i = 1; i < segs.length; i++) {
    const [, tEnd] = segTangents(segs[i - 1]); const [tStart] = segTangents(segs[i]);
    let a = Math.abs(Math.atan2(tStart.x * tEnd.y - tStart.y * tEnd.x, tStart.x * tEnd.x + tStart.y * tEnd.y)) * 180 / Math.PI;
    if (a > 90) a = 180 - a;   // arc-tangent orientation ambiguity → fold to [0,90]
    if (a > mk) mk = a;
  }
  return mk;
}

// ---- run sweep ----
const rows = [];
const anomalies = [];
for (const noise of [0.0, 0.3, 0.6, 1.0]) {
  for (const shape of lib(noise, 12345 + Math.round(noise * 100))) {
    const raw = tryFit(() => {
      const simp = G.rdp(shape.pts, 0.8);
      const closed = simp.length > 2 && G.dist(simp[0], simp[simp.length - 1]) < 0.8 * 6;
      return [{ type: 'poly', pts: closed ? simp.slice(0, -1) : simp, closed }];
    });
    const fit = tryFit(() => G.fitStroke(shape.pts, { tol: 0.8, cornerDeg: 35 }));
    const rawFid = fidelity(raw, shape.pts), fitFid = fidelity(fit, shape.pts);
    const fitN = entityCount(fit);           // segment count (info only; smooth polys are fine)
    const entities = fit.length;             // a single stroke should be ONE entity
    const fitClosed = fit.some(e => e.closed) || fit[0]?.type === 'circle';
    const kinds = fit.map(e => e.type).join('+');
    const noiseCeil = 1.6 + noise * 1.6;     // fit must track within ~2×tol + tremor (raw-but-smooth)
    const flags = [];
    if (fitFid > noiseCeil) flags.push(`fitFid ${fitFid.toFixed(1)}>${noiseCeil.toFixed(1)}`);
    if (entities > 2) flags.push(`entities ${entities}`);   // fragmentation = bug
    if (shape.expect.closed && !fitClosed) flags.push('not-closed');
    if (!shape.expect.closed && fitClosed && shape.expect.kind !== 'blob') flags.push('wrongly-closed');
    if (shape.expect.kind === 'circle' && !(fit.length === 1 && fit[0].type === 'circle')) flags.push(`circle→${kinds}`);
    if (shape.expect.kind === 'arc' && !fit.some(e => e.type === 'arc')) flags.push(`arc→${kinds}`);
    rows.push({ noise, name: shape.name, rawFid, fitFid, fitN, kinds, flags });
    if (flags.length) anomalies.push({ noise, name: shape.name, flags, pts: shape.pts.length });
  }
}
function tryFit(fn) { try { return fn() || []; } catch (e) { return [{ _err: e.message }]; } }

if (verbose) {
  console.log('noise  shape             rawFid  fitFid  fitN  kinds            flags');
  for (const r of rows)
    console.log(
      String(r.noise).padEnd(6),
      r.name.padEnd(17),
      r.rawFid.toFixed(2).padStart(6),
      r.fitFid.toFixed(2).padStart(7),
      String(r.fitN).padStart(5),
      ' ' + (r.kinds || '-').padEnd(16),
      r.flags.join(',') || 'ok');
}
console.log(`\n${rows.length} cases, ${anomalies.length} with anomalies`);
const byShape = {};
for (const a of anomalies) (byShape[a.name] = byShape[a.name] || []).push(`n${a.noise}:${a.flags.join('/')}`);
for (const [name, list] of Object.entries(byShape)) console.log('  ✗', name.padEnd(18), list.join('  '));
console.log(anomalies.length === 0 ? '\nSWEEP CLEAN' : `\nSWEEP: ${anomalies.length} anomalies`);
process.exit(anomalies.length ? 1 : 0);
