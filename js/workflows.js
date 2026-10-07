// Precision workflows. World coordinates are millimeters, Y-down.
import * as G from './geom.js';

export function rigidAlignment(source, target) {
  if (source.length !== target.length || source.length < 2) throw new Error('Use at least two matching reference marks.');
  const mean = ps => ({ x: ps.reduce((s, p) => s + p.x, 0) / ps.length, y: ps.reduce((s, p) => s + p.y, 0) / ps.length });
  const a = mean(source), b = mean(target);
  let dot = 0, cross = 0, spread = 0, targetSpread = 0;
  source.forEach((p, i) => {
    const x = p.x - a.x, y = p.y - a.y, u = target[i].x - b.x, v = target[i].y - b.y;
    dot += x * u + y * v; cross += x * v - y * u; spread += x * x + y * y; targetSpread += u * u + v * v;
  });
  if (spread < 1e-8 || targetSpread < 1e-8) throw new Error('Reference marks must be distinct.');
  const angle = Math.atan2(cross, dot);
  const point = p => { const q = G.rotatePt(p, a, angle); return { x: q.x - a.x + b.x, y: q.y - a.y + b.y }; };
  const errors = source.map((p, i) => G.dist(point(p), target[i]));
  return { a, b, angle, point, rms: Math.sqrt(errors.reduce((s, e) => s + e * e, 0) / errors.length), max: errors.reduce((m, e) => Math.max(m, e), 0),
    entity: e => G.translateEnt(G.rotateEnt(e, a, angle), b.x - a.x, b.y - a.y) };
}

export function fitTrace(pts, opts) {
  if (pts.length < 2) return [];
  if (opts.mode === 'raw') {
    const simp = G.smoothStroke(pts, opts.tol);
    const closed = opts.close && simp.length > 2 && G.dist(simp[0], simp.at(-1)) < opts.tol * 6;
    return [{ type: 'poly', pts: (closed ? simp.slice(0, -1) : simp).map(q => ({ ...q })), closed }];
  }
  const ents = G.fitStroke(pts, { tol: opts.tol, cornerDeg: opts.cornerDeg, closeTol: opts.close ? opts.tol * 6 : 0 });
  const tol = (opts.axisSnapDeg ?? 2) * Math.PI / 180;
  return ents.map(e => {
    if (e.type !== 'line') return e;
    const ang = Math.atan2(e.b.y - e.a.y, e.b.x - e.a.x);
    const d = ang - Math.round(ang / (Math.PI / 2)) * Math.PI / 2;
    return Math.abs(d) < tol ? G.rotateEnt(e, { x: (e.a.x + e.b.x) / 2, y: (e.a.y + e.b.y) / 2 }, -d) : e;
  });
}
export function traceDeviation(raw, entities) {
  if (!raw.length || !entities.length) return { max: 0, rms: 0 };
  const fitted = entities.flatMap(e => e.type === 'poly' ? G.polyToSegments(e) : [e]);
  const errors = raw.map(p => fitted.reduce((best, e) => Math.min(best, G.closestPointOnEntity(e, p)?.d ?? Infinity), Infinity));
  return { max: errors.reduce((m, e) => Math.max(m, e), 0), rms: Math.sqrt(errors.reduce((s, e) => s + e * e, 0) / errors.length) };
}

export function ends(e) {
  if (e.type === 'line') return [e.a, e.b];
  if (e.type === 'arc') return [e.a0, e.a1].map(a => ({ x: e.c.x + e.r * Math.cos(a), y: e.c.y + e.r * Math.sin(a) }));
  return [];
}
function segments(entities) {
  return entities.flatMap(e => e.type === 'poly' ? G.polyToSegments(e).map(s => ({ ...s, id: e.id, layer: e.layer })) : ['line', 'arc', 'circle'].includes(e.type) ? [e] : []);
}
function sameEdge(a, b, tol) {
  if (a.type !== b.type) return false;
  if (a.type === 'circle') return G.dist(a.c, b.c) <= tol && Math.abs(a.r - b.r) <= tol;
  const [a0, a1] = ends(a), [b0, b1] = ends(b);
  if (!((G.dist(a0, b0) <= tol && G.dist(a1, b1) <= tol) || (G.dist(a0, b1) <= tol && G.dist(a1, b0) <= tol))) return false;
  return a.type === 'line' || (G.dist(a0, b0) <= tol && G.dist(a1, b1) <= tol && G.dist(a.c, b.c) <= tol && Math.abs(a.r - b.r) <= tol && Math.abs(G.sweep(a.a0, a.a1) - G.sweep(b.a0, b.a1)) * a.r <= tol);
}
export function auditContours(entities, gapTol = 0.5) {
  const ss = segments(entities), issues = [], exact = 1e-6;
  for (const e of entities) {
    if (e.type === 'line' && G.dist(e.a, e.b) < exact) issues.push({ kind: 'zero length', ids: [e.id], p: e.a });
    if (e.type === 'poly') {
      const count = e.closed ? e.pts.length : e.pts.length - 1;
      for (let i = 0; i < count; i++) if (G.dist(e.pts[i], e.pts[(i + 1) % e.pts.length]) < exact) issues.push({ kind: 'zero length', ids: [e.id], p: e.pts[i] });
    }
  }
  const endpoints = ss.flatMap((e, i) => ends(e).map(p => ({ p, i, id: e.id })));
  function pointIndex(points, step) {
    const grid = new Map();
    points.forEach((ep, index) => {
      const key = `${Math.floor(ep.p.x / step)},${Math.floor(ep.p.y / step)}`;
      if (!grid.has(key)) grid.set(key, []);
      grid.get(key).push(index);
    });
    return p => {
      const x = Math.floor(p.x / step), y = Math.floor(p.y / step), found = [];
      for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) found.push(...(grid.get(`${x + dx},${y + dy}`) || []));
      return found;
    };
  }
  const adjacent = pointIndex(endpoints, exact);
  const dangling = endpoints.filter((ep, index) => !adjacent(ep.p).some(j => j !== index && G.dist(ep.p, endpoints[j].p) <= exact));
  const branchSeen = new Set();
  endpoints.forEach(ep => {
    const neighbors = adjacent(ep.p).filter(j => G.dist(ep.p, endpoints[j].p) <= exact);
    if (neighbors.length > 2 && !neighbors.some(j => branchSeen.has(j))) {
      neighbors.forEach(j => branchSeen.add(j));
      issues.push({ kind: 'branch', ids: [...new Set(neighbors.map(j => endpoints[j].id))], p: ep.p });
    }
  });
  const gaps = pointIndex(dangling, Math.max(gapTol, exact)), used = new Set();
  dangling.forEach((ep, i) => {
    if (used.has(i)) return;
    let best = -1, distance = gapTol;
    for (const j of gaps(ep.p)) {
      const d = G.dist(ep.p, dangling[j].p);
      if (j !== i && !used.has(j) && d <= distance) { best = j; distance = d; }
    }
    if (best >= 0) { used.add(i); used.add(best); issues.push({ kind: 'gap', ids: [ep.id, dangling[best].id], p: ep.p, q: dangling[best].p, distance }); }
    else issues.push({ kind: 'open endpoint', ids: [ep.id], p: ep.p });
  });
  const ordered = ss.map(e => ({ e, bounds: G.entBounds(e) })).sort((a, b) => a.bounds.minX - b.bounds.minX);
  for (let i = 0; i < ordered.length; i++) for (let j = i + 1; j < ordered.length; j++) {
    const { e: a, bounds: ab } = ordered[i], { e: b, bounds: bb } = ordered[j];
    if (bb.minX > ab.maxX + exact) break;
    if (ab.maxY < bb.minY - exact || bb.maxY < ab.minY - exact) continue;
    if (sameEdge(a, b, exact)) { issues.push({ kind: 'duplicate edge', ids: [a.id, b.id], p: ends(a)[0] || a.c }); continue; }
    for (const hit of G.intersectEntities(a, b)) {
      const joint = ends(a).some(p => G.dist(p, hit.p) < exact) && ends(b).some(p => G.dist(p, hit.p) < exact);
      if (!joint) issues.push({ kind: 'intersection', ids: [a.id, b.id], p: hit.p });
    }
  }
  return issues;
}

// Join unbranched chains on the same layer. Bridge gaps explicitly, keeping arcs intact.
export function joinContours(entities, tol = 0.5) {
  if (!(tol >= 0) || !Number.isFinite(tol)) throw new Error('Enter a valid gap tolerance.');
  const supported = entities.filter(e => ['line', 'arc', 'poly'].includes(e.type));
  const ss = segments(supported), unused = new Set(ss.map((_, i) => i)), result = [];
  let bridges = 0;
  while (unused.size) {
    const start = unused.values().next().value;
    unused.delete(start);
    const first = ss[start], [a, b] = ends(first);
    const pts = [{ ...a, bulge: first.type === 'arc' ? Math.tan(G.sweep(first.a0, first.a1) / 4) : 0 }, { ...b, bulge: 0 }];
    for (const front of [false, true]) {
      while (unused.size) {
        const cursor = front ? pts[0] : pts.at(-1);
        // Original topology decides ambiguity, even after another chain was consumed.
        const degree = ss.filter(e => e.layer === first.layer).flatMap(ends).filter(p => G.dist(cursor, p) <= Math.max(tol, 1e-6)).length;
        if (degree > 2) break;
        const candidates = [];
        for (const i of unused) {
          if (ss[i].layer !== first.layer) continue;
          ends(ss[i]).forEach((p, side) => { if (G.dist(cursor, p) <= Math.max(tol, 1e-6)) candidates.push({ i, side, p }); });
        }
        if (candidates.length !== 1) break; // leave ambiguous branches for manual repair
        const { i, side, p } = candidates[0], e = ss[i], other = ends(e)[1 - side];
        unused.delete(i);
        const bulge = e.type === 'arc' ? Math.tan(G.sweep(e.a0, e.a1) / 4) * (side ? -1 : 1) : 0;
        if (front) {
          if (G.dist(cursor, p) > 1e-6) { pts.unshift({ ...p, bulge: 0 }); bridges++; }
          pts.unshift({ ...other, bulge: -bulge });
        } else {
          if (G.dist(cursor, p) > 1e-6) { pts.push({ ...p, bulge: 0 }); bridges++; }
          pts.at(-1).bulge = bulge;
          pts.push({ ...other, bulge: 0 });
        }
      }
    }
    let closed = pts.length > 2 && G.dist(pts[0], pts.at(-1)) <= Math.max(tol, 1e-6);
    if (closed && G.dist(pts[0], pts.at(-1)) <= 1e-6) pts.pop();
    else if (closed) bridges++;
    result.push({ type: 'poly', pts, closed, layer: first.layer });
  }
  return { entities: [...entities.filter(e => !supported.includes(e)), ...result], bridges };
}

export function measurementScale(samples) {
  if (samples.length < 2 || samples.some(s => !(s.measured > 0 && s.actual > 0 && Number.isFinite(s.actual) && Number.isFinite(s.measured)))) throw new Error('Provide at least two positive measurements.');
  const factor = samples.reduce((s, m) => s + m.measured * m.actual, 0) / samples.reduce((s, m) => s + m.measured ** 2, 0);
  const errors = samples.map(s => s.measured * factor - s.actual);
  return { factor, rms: Math.sqrt(errors.reduce((s, e) => s + e * e, 0) / errors.length), errors };
}

// Homography mapping a destination rectangle into four source corners (TL, TR, BR, BL).
export function homography(corners, width, height) {
  if (corners.length !== 4 || !(width > 0 && height > 0)) throw new Error('Choose four corners and positive dimensions.');
  const signs = corners.map((p, i) => { const q = corners[(i + 1) % 4], r = corners[(i + 2) % 4]; return (q.x - p.x) * (r.y - q.y) - (q.y - p.y) * (r.x - q.x); });
  if (signs.some(s => Math.abs(s) < 1e-9 || Math.sign(s) !== Math.sign(signs[0]))) throw new Error('Corners must form a convex rectangle outline in order.');
  const dst = [[0, 0], [width, 0], [width, height], [0, height]], rows = [];
  dst.forEach(([x, y], i) => {
    const { x: u, y: v } = corners[i];
    rows.push([x, y, 1, 0, 0, 0, -u*x, -u*y, u], [0, 0, 0, x, y, 1, -v*x, -v*y, v]);
  });
  for (let c = 0; c < 8; c++) {
    let pivot = c;
    for (let i = c + 1; i < 8; i++) if (Math.abs(rows[i][c]) > Math.abs(rows[pivot][c])) pivot = i;
    if (Math.abs(rows[pivot][c]) < 1e-10) throw new Error('Corners are too close or collinear.');
    [rows[c], rows[pivot]] = [rows[pivot], rows[c]];
    const d = rows[c][c]; rows[c] = rows[c].map(v => v / d);
    for (let i = 0; i < 8; i++) if (i !== c) { const f = rows[i][c]; rows[i] = rows[i].map((v, j) => v - f * rows[c][j]); }
  }
  const h = rows.map(r => r[8]);
  return (x, y) => { const d = h[6]*x + h[7]*y + 1; return { x: (h[0]*x + h[1]*y + h[2])/d, y: (h[3]*x + h[4]*y + h[5])/d }; };
}
export function imagePoint(world, u, img) {
  const p = G.rotatePt(world, { x: u.x, y: u.y }, -(u.rotation || 0));
  return { x: (p.x - u.x) / u.wMM * img.naturalWidth, y: (p.y - u.y) / u.hMM * img.naturalHeight };
}
