// TrueLine geometry. Pure functions, no DOM.
// Frame: mm, Y-DOWN, angles = atan2(dy,dx), arcs {c,r,a0,a1} sweep a0->a1 with INCREASING angle.
// Polyline vertex bulge b: arc from this vertex to the next; b>0 travels in the
// increasing-angle direction, |b| = tan(sweep/4). See ARCHITECTURE.md.

export const TAU = Math.PI * 2;
export const EPS = 1e-9;

export const sweep = (a0, a1) => ((a1 - a0) % TAU + TAU) % TAU;
export const norm = a => ((a % TAU) + TAU) % TAU;
export const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
export function angOnArc(arc, ang) {
  const da = sweep(arc.a0, ang);
  return da <= sweep(arc.a0, arc.a1) + 1e-7 || da >= TAU - 1e-7;
}
export function rotatePt(p, c, ang) {
  const co = Math.cos(ang), si = Math.sin(ang);
  const dx = p.x - c.x, dy = p.y - c.y;
  return { x: c.x + dx * co - dy * si, y: c.y + dx * si + dy * co };
}
const clonePt = p => p.bulge !== undefined ? { x: p.x, y: p.y, bulge: p.bulge } : { x: p.x, y: p.y };
const arcPt = (arc, ang) => ({ x: arc.c.x + arc.r * Math.cos(ang), y: arc.c.y + arc.r * Math.sin(ang) });

// ---------------------------------------------------------------- transforms
function mapPts(e, fn) {
  switch (e.type) {
    case 'line': return { ...e, a: fn(e.a), b: fn(e.b) };
    case 'circle': return { ...e, c: fn(e.c) };
    case 'point': return { ...e, p: fn(e.p) };
    case 'text': return { ...e, p: fn(e.p) };
    case 'poly': return { ...e, pts: e.pts.map(p => ({ ...clonePt(p), ...fn(p) })) };
    default: return { ...e };
  }
}
export function translateEnt(e, dx, dy) {
  const fn = p => ({ x: p.x + dx, y: p.y + dy });
  if (e.type === 'arc') return { ...e, c: fn(e.c) };
  if (e.type === 'dim') {
    const out = { ...e };
    for (const key of ['p1', 'p2', 'tp', 'c']) if (out[key]) out[key] = fn(out[key]);
    return out;
  }
  return mapPts(e, fn);
}
export function rotateEnt(e, center, ang) {
  const fn = p => rotatePt(p, center, ang);
  if (e.type === 'arc') return { ...e, c: fn(e.c), a0: norm(e.a0 + ang), a1: norm(e.a1 + ang) };
  if (e.type === 'text') return { ...e, p: fn(e.p), rot: (e.rot || 0) + ang };
  if (e.type === 'dim') {
    const out = { ...e };
    for (const key of ['p1', 'p2', 'tp', 'c']) if (out[key]) out[key] = fn(out[key]);
    // axis-locked dims: swap h/v on odd 90° multiples, else fall back to aligned
    if (out.kind === 'linear-h' || out.kind === 'linear-v') {
      const q = norm(ang) / (Math.PI / 2), kq = Math.round(q);
      if (Math.abs(q - kq) < 1e-9) {
        if (kq % 2) out.kind = out.kind === 'linear-h' ? 'linear-v' : 'linear-h';
      } else out.kind = 'aligned';
    }
    return out;
  }
  return mapPts(e, fn);
}
export function scaleEnt(e, center, f) {
  const fn = p => ({ x: center.x + (p.x - center.x) * f, y: center.y + (p.y - center.y) * f });
  if (e.type === 'arc') return { ...e, c: fn(e.c), r: e.r * f };
  if (e.type === 'circle') return { ...e, c: fn(e.c), r: e.r * f };
  if (e.type === 'text') return { ...e, p: fn(e.p), h: (e.h || 3) * f };
  if (e.type === 'dim') {
    const out = { ...e };
    for (const key of ['p1', 'p2', 'tp', 'c']) if (out[key]) out[key] = fn(out[key]);
    if (out.r) out.r *= f;
    return out;
  }
  return mapPts(e, fn);
}
export function reflectPt(p, p1, p2) {
  const dx = p2.x - p1.x, dy = p2.y - p1.y;
  const len2 = dx * dx + dy * dy;
  if (len2 < EPS) return { x: p.x, y: p.y };
  const t = ((p.x - p1.x) * dx + (p.y - p1.y) * dy) / len2;
  const fx = p1.x + t * dx, fy = p1.y + t * dy;
  return { x: 2 * fx - p.x, y: 2 * fy - p.y };
}
export function mirrorEnt(e, p1, p2) {
  const fn = p => reflectPt(p, p1, p2);
  const phi = Math.atan2(p2.y - p1.y, p2.x - p1.x);
  if (e.type === 'arc') {
    // reflection maps angle t -> 2*phi - t and reverses orientation
    return { ...e, c: fn(e.c), a0: norm(2 * phi - e.a1), a1: norm(2 * phi - e.a0) };
  }
  if (e.type === 'text') return { ...e, p: fn(e.p), rot: 2 * phi - (e.rot || 0) };
  if (e.type === 'poly') {
    return {
      ...e,
      pts: e.pts.map(p => {
        const q = fn(p);
        return p.bulge ? { x: q.x, y: q.y, bulge: -p.bulge } : { x: q.x, y: q.y };
      }),
    };
  }
  if (e.type === 'dim') {
    const out = { ...e };
    for (const key of ['p1', 'p2', 'tp', 'c']) if (out[key]) out[key] = fn(out[key]);
    return out;
  }
  return mapPts(e, fn);
}

// ---------------------------------------------------------------- bulge math
export function bulgeToArc(p1, p2, b) {
  const dx = p2.x - p1.x, dy = p2.y - p1.y;
  const c = Math.hypot(dx, dy);
  if (c < EPS || Math.abs(b) < EPS) return null;
  const ux = dx / c, uy = dy / c;
  const px = uy, py = -ux;                          // chord dir rotated -90°
  const mx = (p1.x + p2.x) / 2, my = (p1.y + p2.y) / 2;
  const r = c * (1 + b * b) / (4 * Math.abs(b));
  const d = c * (b * b - 1) / (4 * b);
  const O = { x: mx + px * d, y: my + py * d };
  const a1 = Math.atan2(p1.y - O.y, p1.x - O.x);
  const a2 = Math.atan2(p2.y - O.y, p2.x - O.x);
  // b>0: travel p1->p2 in increasing-angle direction; b<0: decreasing (store swapped)
  return b > 0 ? { c: O, r, a0: norm(a1), a1: norm(a2) } : { c: O, r, a0: norm(a2), a1: norm(a1) };
}
export function arcToBulgeSegs(arc) {
  const s = sweep(arc.a0, arc.a1) || TAU;
  const halves = s >= Math.PI - 1e-12 ? 2 : 1;
  const out = [];
  for (let i = 0; i < halves; i++) {
    const f0 = arc.a0 + s * i / halves, f1 = arc.a0 + s * (i + 1) / halves;
    out.push({ p1: arcPt(arc, f0), p2: arcPt(arc, f1), b: Math.tan((s / halves) / 4) });
  }
  return out;
}
export function polyToSegments(e) {
  const out = [];
  const n = e.pts.length;
  const count = e.closed ? n : n - 1;
  for (let i = 0; i < count; i++) {
    const p1 = e.pts[i], p2 = e.pts[(i + 1) % n];
    if (dist(p1, p2) < EPS) continue;
    if (!p1.bulge) out.push({ type: 'line', a: { x: p1.x, y: p1.y }, b: { x: p2.x, y: p2.y } });
    else {
      const arc = bulgeToArc(p1, p2, p1.bulge);
      if (arc) out.push({ type: 'arc', ...arc });
      else out.push({ type: 'line', a: { x: p1.x, y: p1.y }, b: { x: p2.x, y: p2.y } });
    }
  }
  return out;
}
export function segmentsToPoly(segs, tol = 1e-6) {
  if (!segs.length) return null;
  const ends = s => s.type === 'line' ? [s.a, s.b] : [arcPt(s, s.a0), arcPt(s, s.a1)];
  const segBulge = (s, forward) => {
    if (s.type === 'line') return 0;
    const sw = sweep(s.a0, s.a1) || TAU;
    const b = Math.tan(sw / 4);
    return forward ? b : -b;
  };
  const pts = [];
  const used = new Set([0]);
  const [start0, end0] = ends(segs[0]);
  pts.push({ x: start0.x, y: start0.y, bulge: segBulge(segs[0], true) });
  let cursor = end0;
  for (let step = 1; step < segs.length; step++) {
    let found = -1, fwd = true;
    for (let i = 0; i < segs.length; i++) {
      if (used.has(i)) continue;
      const [s0, s1] = ends(segs[i]);
      if (dist(cursor, s0) < tol) { found = i; fwd = true; break; }
      if (dist(cursor, s1) < tol) { found = i; fwd = false; break; }
    }
    if (found < 0) return null;
    used.add(found);
    const s = segs[found];
    const [s0, s1] = ends(s);
    const at = fwd ? s0 : s1;
    pts.push({ x: at.x, y: at.y, bulge: segBulge(s, fwd) });
    cursor = fwd ? s1 : s0;
  }
  const closed = dist(cursor, { x: pts[0].x, y: pts[0].y }) < tol;
  if (!closed) pts.push({ x: cursor.x, y: cursor.y });
  return { type: 'poly', pts, closed };
}

// ---------------------------------------------------------------- bounds & length
export function entBounds(e) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const eat = p => {
    if (p.x < minX) minX = p.x; if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y; if (p.y > maxY) maxY = p.y;
  };
  if (e.type === 'line') { eat(e.a); eat(e.b); }
  else if (e.type === 'circle') { eat({ x: e.c.x - e.r, y: e.c.y - e.r }); eat({ x: e.c.x + e.r, y: e.c.y + e.r }); }
  else if (e.type === 'arc') {
    eat(arcPt(e, e.a0)); eat(arcPt(e, e.a1));
    for (const q of [0, Math.PI / 2, Math.PI, 3 * Math.PI / 2])
      if (angOnArc(e, q)) eat(arcPt(e, q));
  } else if (e.type === 'poly') {
    if (!e.pts.length) eat({ x: 0, y: 0 });
    else {
      e.pts.forEach(eat);
      for (const s of polyToSegments(e)) {
        if (s.type !== 'arc') continue;
        const b = entBounds(s);
        eat({ x: b.minX, y: b.minY }); eat({ x: b.maxX, y: b.maxY });
      }
    }
  } else if (e.type === 'point') eat(e.p);
  else if (e.type === 'text') {
    eat(e.p);
    eat({ x: e.p.x + (e.text ? e.text.length : 1) * (e.h || 3) * 0.62, y: e.p.y - (e.h || 3) });
  } else eat({ x: 0, y: 0 });
  return { minX, minY, maxX, maxY };
}
export function entityLength(e) {
  if (e.type === 'line') return dist(e.a, e.b);
  if (e.type === 'circle') return TAU * e.r;
  if (e.type === 'arc') return (sweep(e.a0, e.a1) || TAU) * e.r;
  if (e.type === 'poly') return polyToSegments(e).reduce((s, seg) => s + entityLength(seg), 0);
  return 0;
}
export function polyAreaPerimeter(e) {
  // shoelace over vertices + circular-segment corrections for bulges (spec D.9)
  let area2 = 0, perim = 0;
  const n = e.pts.length;
  const count = e.closed ? n : n - 1;
  for (let i = 0; i < count; i++) {
    const p1 = e.pts[i], p2 = e.pts[(i + 1) % n];
    area2 += p1.x * p2.y - p2.x * p1.y;
    const chord = dist(p1, p2);
    if (p1.bulge) {
      const theta = 4 * Math.atan(p1.bulge);
      const arc = bulgeToArc(p1, p2, p1.bulge);
      if (arc) {
        perim += arc.r * Math.abs(theta);
        const segA = (arc.r * arc.r / 2) * (Math.abs(theta) - Math.sin(Math.abs(theta)));
        area2 += 2 * Math.sign(theta) * segA;
      } else perim += chord;
    } else perim += chord;
  }
  return { area: Math.abs(area2) / 2, perimeter: perim };
}

// ---------------------------------------------------------------- closest point
export function closestPointOnEntity(e, p) {
  if (e.type === 'line') {
    const dx = e.b.x - e.a.x, dy = e.b.y - e.a.y;
    const len2 = dx * dx + dy * dy;
    let t = len2 < EPS ? 0 : ((p.x - e.a.x) * dx + (p.y - e.a.y) * dy) / len2;
    t = Math.max(0, Math.min(1, t));
    const q = { x: e.a.x + t * dx, y: e.a.y + t * dy };
    return { p: q, d: dist(p, q), t };
  }
  if (e.type === 'circle') {
    const ang = Math.atan2(p.y - e.c.y, p.x - e.c.x);
    const q = { x: e.c.x + e.r * Math.cos(ang), y: e.c.y + e.r * Math.sin(ang) };
    return { p: q, d: Math.abs(dist(p, e.c) - e.r), t: norm(ang) / TAU };
  }
  if (e.type === 'arc') {
    const ang = Math.atan2(p.y - e.c.y, p.x - e.c.x);
    const sw = sweep(e.a0, e.a1) || TAU;
    if (angOnArc(e, ang)) {
      const q = arcPt(e, ang);
      return { p: q, d: dist(p, q), t: Math.min(1, sweep(e.a0, ang) / sw) };
    }
    const q0 = arcPt(e, e.a0), q1 = arcPt(e, e.a1);
    return dist(p, q0) <= dist(p, q1)
      ? { p: q0, d: dist(p, q0), t: 0 }
      : { p: q1, d: dist(p, q1), t: 1 };
  }
  if (e.type === 'poly') {
    const segs = polyToSegments(e);
    if (!segs.length) {
      const q = e.pts[0] ? { x: e.pts[0].x, y: e.pts[0].y } : { x: 0, y: 0 };
      return { p: q, d: dist(p, q), t: 0 };
    }
    let best = null;
    for (let i = 0; i < segs.length; i++) {
      const cp = closestPointOnEntity(segs[i], p);
      if (!best || cp.d < best.d) best = { p: cp.p, d: cp.d, t: (i + cp.t) / segs.length };
    }
    return best;
  }
  if (e.type === 'point') return { p: { ...e.p }, d: dist(p, e.p), t: 0 };
  if (e.type === 'text') return { p: { ...e.p }, d: dist(p, e.p), t: 0 };
  return null;
}

// ---------------------------------------------------------------- intersections
export function lineLine(a1, a2, b1, b2, ext1 = false, ext2 = false) {
  const rx = a2.x - a1.x, ry = a2.y - a1.y;
  const sx = b2.x - b1.x, sy = b2.y - b1.y;
  const denom = rx * sy - ry * sx;
  if (Math.abs(denom) < EPS) return null;
  const qx = b1.x - a1.x, qy = b1.y - a1.y;
  const t = (qx * sy - qy * sx) / denom;
  const u = (qx * ry - qy * rx) / denom;
  const tol = 1e-9;
  if (!ext1 && (t < -tol || t > 1 + tol)) return null;
  if (!ext2 && (u < -tol || u > 1 + tol)) return null;
  return { p: { x: a1.x + t * rx, y: a1.y + t * ry }, t, u };
}
function lineCircle(a, b, c, r, ext) {
  const dx = b.x - a.x, dy = b.y - a.y;
  const fx = a.x - c.x, fy = a.y - c.y;
  const A = dx * dx + dy * dy;
  if (A < EPS) return [];
  const B = 2 * (fx * dx + fy * dy);
  const C = fx * fx + fy * fy - r * r;
  let disc = B * B - 4 * A * C;
  if (disc < -1e-9) return [];
  disc = Math.max(0, disc);
  const sq = Math.sqrt(disc);
  const ts = disc < 1e-12 ? [-B / (2 * A)] : [(-B - sq) / (2 * A), (-B + sq) / (2 * A)];
  const out = [];
  for (const t of ts) {
    if (!ext && (t < -1e-9 || t > 1 + 1e-9)) continue;
    out.push({ p: { x: a.x + t * dx, y: a.y + t * dy }, t });
  }
  return out;
}
function circleCircle(c1, r1, c2, r2) {
  const d = dist(c1, c2);
  if (d < EPS) return [];
  if (d > r1 + r2 + 1e-9 || d < Math.abs(r1 - r2) - 1e-9) return [];
  const a = (r1 * r1 - r2 * r2 + d * d) / (2 * d);
  const h2 = r1 * r1 - a * a;
  const h = Math.sqrt(Math.max(0, h2));
  const ux = (c2.x - c1.x) / d, uy = (c2.y - c1.y) / d;
  const mx = c1.x + a * ux, my = c1.y + a * uy;
  if (h < 1e-9) return [{ p: { x: mx, y: my } }];
  return [
    { p: { x: mx - h * uy, y: my + h * ux } },
    { p: { x: mx + h * uy, y: my - h * ux } },
  ];
}
function paramOn(e, p) {
  const cp = closestPointOnEntity(e, p);
  return cp ? cp.t : 0;
}
function arcContains(e, p) {
  return angOnArc(e, Math.atan2(p.y - e.c.y, p.x - e.c.x));
}
export function intersectEntities(e1, e2, ext1 = false, ext2 = false) {
  if (e1.type === 'poly') {
    const segs = polyToSegments(e1);
    const out = [];
    for (let i = 0; i < segs.length; i++)
      for (const hit of intersectEntities(segs[i], e2, false, ext2))
        out.push({ p: hit.p, t1: (i + hit.t1) / segs.length, t2: hit.t2 });
    return out;
  }
  if (e2.type === 'poly') {
    return intersectEntities(e2, e1, ext2, ext1).map(h => ({ p: h.p, t1: h.t2, t2: h.t1 }));
  }
  const isCir = e => e.type === 'circle' || e.type === 'arc';
  if (e1.type === 'line' && e2.type === 'line') {
    const hit = lineLine(e1.a, e1.b, e2.a, e2.b, ext1, ext2);
    return hit ? [{ p: hit.p, t1: hit.t, t2: hit.u }] : [];
  }
  if (e1.type === 'line' && isCir(e2)) {
    return lineCircle(e1.a, e1.b, e2.c, e2.r, ext1)
      .filter(h => ext2 || e2.type === 'circle' || arcContains(e2, h.p))
      .map(h => ({ p: h.p, t1: h.t, t2: paramOn(e2, h.p) }));
  }
  if (isCir(e1) && e2.type === 'line') {
    return intersectEntities(e2, e1, ext2, ext1).map(h => ({ p: h.p, t1: h.t2, t2: h.t1 }));
  }
  if (isCir(e1) && isCir(e2)) {
    return circleCircle(e1.c, e1.r, e2.c, e2.r)
      .filter(h => (ext1 || e1.type === 'circle' || arcContains(e1, h.p)) &&
                   (ext2 || e2.type === 'circle' || arcContains(e2, h.p)))
      .map(h => ({ p: h.p, t1: paramOn(e1, h.p), t2: paramOn(e2, h.p) }));
  }
  return [];
}

// ---------------------------------------------------------------- constructions
export function circleFrom3(p1, p2, p3) {
  const d = 2 * (p1.x * (p2.y - p3.y) + p2.x * (p3.y - p1.y) + p3.x * (p1.y - p2.y));
  if (Math.abs(d) < 1e-9) return null;
  const s1 = p1.x * p1.x + p1.y * p1.y, s2 = p2.x * p2.x + p2.y * p2.y, s3 = p3.x * p3.x + p3.y * p3.y;
  const cx = (s1 * (p2.y - p3.y) + s2 * (p3.y - p1.y) + s3 * (p1.y - p2.y)) / d;
  const cy = (s1 * (p3.x - p2.x) + s2 * (p1.x - p3.x) + s3 * (p2.x - p1.x)) / d;
  const c = { x: cx, y: cy };
  return { c, r: dist(c, p1) };
}
export function arcFrom3(p1, p2, p3) {
  const cr = circleFrom3(p1, p2, p3);
  if (!cr) return null;
  const t1 = Math.atan2(p1.y - cr.c.y, p1.x - cr.c.x);
  const t2 = Math.atan2(p2.y - cr.c.y, p2.x - cr.c.x);
  const t3 = Math.atan2(p3.y - cr.c.y, p3.x - cr.c.x);
  return sweep(t1, t2) <= sweep(t1, t3)
    ? { c: cr.c, r: cr.r, a0: norm(t1), a1: norm(t3) }
    : { c: cr.c, r: cr.r, a0: norm(t3), a1: norm(t1) };
}
export function arcFromCenterStartEnd(c, pStart, pEnd, throughPt) {
  const r = dist(c, pStart);
  if (r < EPS) return null;
  const a0 = Math.atan2(pStart.y - c.y, pStart.x - c.x);
  const a1 = Math.atan2(pEnd.y - c.y, pEnd.x - c.x);
  const cand1 = { c: { ...c }, r, a0: norm(a0), a1: norm(a1) };
  const cand2 = { c: { ...c }, r, a0: norm(a1), a1: norm(a0) };
  if (!throughPt) return cand1;
  const tAng = Math.atan2(throughPt.y - c.y, throughPt.x - c.x);
  const in1 = angOnArc(cand1, tAng), in2 = angOnArc(cand2, tAng);
  if (in1 && !in2) return cand1;
  if (in2 && !in1) return cand2;
  return cand1;
}
export function pointInPoly(p, v) {
  let inside = false;
  for (let i = 0, j = v.length - 1; i < v.length; j = i++) {
    if (((v[i].y > p.y) !== (v[j].y > p.y)) &&
        (p.x < (v[j].x - v[i].x) * (p.y - v[i].y) / (v[j].y - v[i].y) + v[i].x))
      inside = !inside;
  }
  return inside;
}

// ---------------------------------------------------------------- offset
function segStart(s) { return s.type === 'line' ? { x: s.a.x, y: s.a.y } : arcPt(s, s.a0); }
function segEnd(s) { return s.type === 'line' ? { x: s.b.x, y: s.b.y } : arcPt(s, s.a1); }
function setSegStart(s, p) {
  if (s.type === 'line') s.a = { x: p.x, y: p.y };
  else s.a0 = norm(Math.atan2(p.y - s.c.y, p.x - s.c.x));
}
function setSegEnd(s, p) {
  if (s.type === 'line') s.b = { x: p.x, y: p.y };
  else s.a1 = norm(Math.atan2(p.y - s.c.y, p.x - s.c.x));
}
export function offsetEntity(e, d) {
  if (Math.abs(d) < EPS) return { ...e };
  if (e.type === 'line') {
    const L = dist(e.a, e.b);
    if (L < EPS) return null;
    const nx = -(e.b.y - e.a.y) / L, ny = (e.b.x - e.a.x) / L;
    return { ...e, a: { x: e.a.x + nx * d, y: e.a.y + ny * d }, b: { x: e.b.x + nx * d, y: e.b.y + ny * d } };
  }
  if (e.type === 'circle' || e.type === 'arc') {
    // for increasing-angle travel the unit normal n=(-ty,tx) points at the center → +d shrinks
    const r = e.r - d;
    if (r < EPS) return null;
    return { ...e, r };
  }
  if (e.type === 'poly') {
    const segs = polyToSegments(e);
    if (!segs.length) return null;
    const off = [];
    for (const s of segs) {
      const o = offsetEntity(s, d);
      if (o) off.push(o);
    }
    if (!off.length) return null;
    const joinCount = e.closed ? off.length : off.length - 1;
    for (let i = 0; i < joinCount; i++) {
      const A = off[i], B = off[(i + 1) % off.length];
      const hits = intersectEntities(A, B, true, true);
      if (hits.length) {
        const vOrig = segEnd(segs[Math.min(i, segs.length - 1)]);
        hits.sort((h1, h2) => dist(h1.p, vOrig) - dist(h2.p, vOrig));
        setSegEnd(A, hits[0].p);
        setSegStart(B, hits[0].p);
      }
      // no intersection → bevel gap, bridged below
    }
    // stitch into one polyline, bridging gaps with straight segments
    const pts = [];
    const pushPt = (p, bulge = 0) => {
      const last = pts[pts.length - 1];
      if (last && dist(last, p) < 1e-9) { if (bulge) last.bulge = bulge; return; }
      pts.push(bulge ? { x: p.x, y: p.y, bulge } : { x: p.x, y: p.y });
    };
    for (const s of off) {
      const st = segStart(s), en = segEnd(s);
      if (s.type === 'line') { pushPt(st); pushPt(en); }
      else {
        const sw = sweep(s.a0, s.a1) || TAU;
        pushPt(st, Math.tan(sw / 4));
        pushPt(en);
      }
    }
    if (e.closed && pts.length > 1 && dist(pts[0], pts[pts.length - 1]) < 1e-9) pts.pop();
    if (pts.length < 2) return null;
    return { ...e, pts, closed: e.closed };
  }
  return null;
}
export function offsetPolyTowards(e, throughPt, d) {
  const c1 = offsetEntity(e, Math.abs(d));
  const c2 = offsetEntity(e, -Math.abs(d));
  const d1 = c1 ? (closestPointOnEntity(c1, throughPt)?.d ?? Infinity) : Infinity;
  const d2 = c2 ? (closestPointOnEntity(c2, throughPt)?.d ?? Infinity) : Infinity;
  if (d1 === Infinity && d2 === Infinity) return null;
  return d1 <= d2 ? c1 : c2;
}

// ---------------------------------------------------------------- fillet / chamfer (lines)
const sub = (a, b) => ({ x: a.x - b.x, y: a.y - b.y });
function unit(v) { const L = Math.hypot(v.x, v.y); return L < EPS ? null : { x: v.x / L, y: v.y / L }; }
function cornerFrame(e1, pick1, e2, pick2) {
  const X = lineLine(e1.a, e1.b, e2.a, e2.b, true, true);
  if (!X) return { error: 'lines are parallel' };
  const keep1 = dist(pick1, e1.a) <= dist(pick1, e1.b) ? e1.a : e1.b;
  const keep2 = dist(pick2, e2.a) <= dist(pick2, e2.b) ? e2.a : e2.b;
  const u1 = unit(sub(keep1, X.p)), u2 = unit(sub(keep2, X.p));
  if (!u1 || !u2) return { error: 'degenerate pick (endpoint at intersection)' };
  const alpha = Math.acos(Math.max(-1, Math.min(1, u1.x * u2.x + u1.y * u2.y)));
  if (alpha < 1e-6 || alpha > Math.PI - 1e-6) return { error: 'collinear corner' };
  return { X: X.p, u1, u2, alpha, keep1, keep2 };
}
function trimLineTo(line, keepEnd, newPt) {
  return dist(keepEnd, line.a) <= dist(keepEnd, line.b)
    ? { ...line, a: { ...line.a }, b: { x: newPt.x, y: newPt.y } }
    : { ...line, a: { x: newPt.x, y: newPt.y }, b: { ...line.b } };
}
export function filletSegments(e1, pick1, e2, pick2, r) {
  if (e1.type !== 'line' || e2.type !== 'line') return { error: 'fillet supports lines in v1' };
  const fr = cornerFrame(e1, pick1, e2, pick2);
  if (fr.error) return fr;
  const { X, u1, u2, alpha, keep1, keep2 } = fr;
  const tDist = r / Math.tan(alpha / 2);
  if (tDist > dist(X, keep1) + 1e-9 || tDist > dist(X, keep2) + 1e-9) return { error: 'radius too large for these segments' };
  const T1 = { x: X.x + u1.x * tDist, y: X.y + u1.y * tDist };
  const T2 = { x: X.x + u2.x * tDist, y: X.y + u2.y * tDist };
  const bis = unit({ x: u1.x + u2.x, y: u1.y + u2.y });
  const C = { x: X.x + bis.x * r / Math.sin(alpha / 2), y: X.y + bis.y * r / Math.sin(alpha / 2) };
  let a0 = norm(Math.atan2(T1.y - C.y, T1.x - C.x));
  let a1 = norm(Math.atan2(T2.y - C.y, T2.x - C.x));
  if (sweep(a0, a1) > Math.PI) [a0, a1] = [a1, a0];
  return {
    arc: { c: C, r, a0, a1 },
    e1: trimLineTo(e1, keep1, T1),
    e2: trimLineTo(e2, keep2, T2),
  };
}
export function chamferSegments(e1, pick1, e2, pick2, d1, d2) {
  if (e1.type !== 'line' || e2.type !== 'line') return { error: 'chamfer supports lines in v1' };
  const fr = cornerFrame(e1, pick1, e2, pick2);
  if (fr.error) return fr;
  const { X, u1, u2, keep1, keep2 } = fr;
  if (d1 > dist(X, keep1) + 1e-9 || d2 > dist(X, keep2) + 1e-9) return { error: 'distance too large' };
  const C1 = { x: X.x + u1.x * d1, y: X.y + u1.y * d1 };
  const C2 = { x: X.x + u2.x * d2, y: X.y + u2.y * d2 };
  return {
    line: { a: C1, b: C2 },
    e1: trimLineTo(e1, keep1, C1),
    e2: trimLineTo(e2, keep2, C2),
  };
}

// ---------------------------------------------------------------- trim / extend
export function trimEntity(target, cutters, pickPt) {
  if (target.type === 'poly') {
    const segs = polyToSegments(target);
    if (!segs.length) return null;
    let bestI = 0, bestD = Infinity;
    for (let i = 0; i < segs.length; i++) {
      const cp = closestPointOnEntity(segs[i], pickPt);
      if (cp.d < bestD) { bestD = cp.d; bestI = i; }
    }
    const res = trimEntity(segs[bestI], cutters, pickPt);
    if (res === null) return null;
    const out = [];
    segs.forEach((s, i) => { if (i !== bestI) out.push(s); });
    out.push(...res);
    return out.map(s => ({ ...s, layer: target.layer }));
  }
  const hits = [];
  for (const c of cutters) {
    if (c === target) continue;
    for (const h of intersectEntities(target, c)) hits.push(h.t1);
  }
  if (!hits.length) return null;
  const tPick = paramOn(target, pickPt);
  if (target.type === 'circle') {
    if (hits.length < 2) return null;
    const angs = [...new Set(hits.map(t => +norm(t * TAU).toFixed(9)))].sort((a, b) => a - b);
    if (angs.length < 2) return null;
    const pAng = norm(tPick * TAU);
    let lo = null, hi = null;
    for (const a of angs) if (a <= pAng) lo = a;
    for (let i = angs.length - 1; i >= 0; i--) if (angs[i] >= pAng) hi = angs[i];
    if (lo === null) lo = angs[angs.length - 1];
    if (hi === null) hi = angs[0];
    if (Math.abs(lo - hi) < 1e-9) return null;
    const { type, c: cc, r, ...rest } = target;
    return [{ ...rest, type: 'arc', c: { ...target.c }, r: target.r, a0: hi, a1: lo }];
  }
  const eps = 1e-6;
  let lo = null, hi = null;
  for (const t of hits) {
    if (t < tPick - eps && (lo === null || t > lo)) lo = t;
    if (t > tPick + eps && (hi === null || t < hi)) hi = t;
  }
  if (lo === null && hi === null) return null;
  const out = [];
  if (target.type === 'line') {
    const at = t => ({ x: target.a.x + t * (target.b.x - target.a.x), y: target.a.y + t * (target.b.y - target.a.y) });
    if (lo !== null && lo > 1e-6) out.push({ ...target, a: { ...target.a }, b: at(lo) });
    if (hi !== null && hi < 1 - 1e-6) out.push({ ...target, a: at(hi), b: { ...target.b } });
  } else if (target.type === 'arc') {
    const sw = sweep(target.a0, target.a1) || TAU;
    if (lo !== null && lo > 1e-6) out.push({ ...target, a1: norm(target.a0 + sw * lo) });
    if (hi !== null && hi < 1 - 1e-6) out.push({ ...target, a0: norm(target.a0 + sw * hi) });
  } else return null;
  return out;
}
export function extendEntity(target, boundaries, pickPt) {
  if (target.type === 'line') {
    const extendB = dist(pickPt, target.b) <= dist(pickPt, target.a);
    const dx = target.b.x - target.a.x, dy = target.b.y - target.a.y;
    let best = null;
    for (const bnd of boundaries) {
      if (bnd === target) continue;
      for (const h of intersectEntities(target, bnd, true, false)) {
        if (extendB && h.t1 > 1 + 1e-9 && (best === null || h.t1 < best)) best = h.t1;
        if (!extendB && h.t1 < -1e-9 && (best === null || h.t1 > best)) best = h.t1;
      }
    }
    if (best === null) return null;
    const at = { x: target.a.x + best * dx, y: target.a.y + best * dy };
    return extendB ? { ...target, b: at } : { ...target, a: at };
  }
  if (target.type === 'arc') {
    const sw = sweep(target.a0, target.a1) || TAU;
    const pickAng = Math.atan2(pickPt.y - target.c.y, pickPt.x - target.c.x);
    const extendEndB = sweep(target.a0, pickAng) > sw / 2;
    const circle = { type: 'circle', c: target.c, r: target.r };
    let bestDelta = null;
    for (const bnd of boundaries) {
      if (bnd === target) continue;
      for (const h of intersectEntities(circle, bnd)) {
        const ang = norm(h.t1 * TAU);
        if (angOnArc(target, ang)) continue;
        if (extendEndB) {
          const delta = sweep(target.a1, ang);
          if (delta > 1e-9 && (bestDelta === null || delta < bestDelta)) bestDelta = delta;
        } else {
          const delta = sweep(ang, target.a0);
          if (delta > 1e-9 && (bestDelta === null || delta < bestDelta)) bestDelta = delta;
        }
      }
    }
    if (bestDelta === null || sw + bestDelta >= TAU - 1e-6) return null;
    return extendEndB
      ? { ...target, a1: norm(target.a1 + bestDelta) }
      : { ...target, a0: norm(target.a0 - bestDelta) };
  }
  return null;
}

// ---------------------------------------------------------------- RDP
export function rdp(pts, eps) {
  if (pts.length < 3) return pts.map(p => ({ x: p.x, y: p.y }));
  const seg = { type: 'line', a: pts[0], b: pts[pts.length - 1] };
  let maxD = 0, idx = 0;
  for (let i = 1; i < pts.length - 1; i++) {
    const d = closestPointOnEntity(seg, pts[i]).d;
    if (d > maxD) { maxD = d; idx = i; }
  }
  if (maxD <= eps) return [{ x: pts[0].x, y: pts[0].y }, { x: pts[pts.length - 1].x, y: pts[pts.length - 1].y }];
  const left = rdp(pts.slice(0, idx + 1), eps);
  const right = rdp(pts.slice(idx), eps);
  return left.slice(0, -1).concat(right);
}

// ---------------------------------------------------------------- stroke fitting
// fit pipeline uses "trace segments": {type:'line',a,b} or {type:'arc',a,b,bulge,c,r}
// where a/b are the traversal endpoints and bulge is signed (tan of quarter-sweep).
const polylineLength = pts => { let L = 0; for (let i = 1; i < pts.length; i++) L += dist(pts[i - 1], pts[i]); return L; };
const segLen = s => s.type === 'line' ? dist(s.a, s.b) : Math.abs(4 * Math.atan(s.bulge)) * (s.r || dist(s.a, s.b) || 1);
const circleRMS = (pts, cf) => { let s = 0; for (const p of pts) s += (dist(p, cf.c) - cf.r) ** 2; return Math.sqrt(s / pts.length); };
function totalTurning(pts, c) {
  let t = 0;
  for (let i = 1; i < pts.length; i++) {
    const v1 = sub(pts[i - 1], c), v2 = sub(pts[i], c);
    t += Math.atan2(v1.x * v2.y - v1.y * v2.x, v1.x * v2.x + v1.y * v2.y);
  }
  return t;
}

export function fitStroke(rawPts, opts = {}) {
  const tol = opts.tol ?? 0.8;
  const cornerDeg = opts.cornerDeg ?? 35;
  const minArcSweep = (opts.minArcSweepDeg ?? 18) * Math.PI / 180;
  const closeTol = opts.closeTol ?? Math.max(tol * 5, 2);
  const h = Math.min(1.0, Math.max(0.25, tol * 0.6));

  const rs = resample(rawPts, h);
  if (rs.length < 3) return rs.length ? [{ type: 'line', a: { ...rs[0] }, b: { ...rs[rs.length - 1] } }] : [];
  // light smoothing only — heavy passes distort corners and line/arc transitions
  const passes = rs.length > 40 ? 2 : 1;
  let sm = rs;
  for (let i = 0; i < passes; i++) sm = smooth5(sm);

  const pathLen = polylineLength(sm);
  const closed = dist(sm[0], sm[sm.length - 1]) < closeTol && pathLen > 6 * closeTol;

  // whole-stroke CIRCLE — a closed loop that fits one circle is a circle
  if (closed) {
    const cf = kasa(sm);
    if (cf) {
      const maxDev = circleMaxDev(sm, cf);
      const turn = Math.abs(totalTurning(sm, cf.c));
      if (maxDev < Math.max(tol * 1.5, cf.r * 0.04) && turn > 1.5 * Math.PI && turn < 2.6 * Math.PI)
        return [{ type: 'circle', c: { ...cf.c }, r: cf.r }];
    }
  }

  const corners = findCorners(sm, 4, cornerDeg * Math.PI / 180);
  const cuts = [0, ...corners, sm.length - 1];
  let parts = [];
  for (let ci = 0; ci < cuts.length - 1; ci++)
    parts.push(...classifyRun(sm.slice(cuts[ci], cuts[ci + 1] + 1), tol, minArcSweep, 0));
  parts = parts.filter(s => segLen(s) > 1e-4);
  if (!parts.length) return [{ type: 'line', a: { ...sm[0] }, b: { ...sm[sm.length - 1] } }];
  parts = mergeParts(parts, tol);
  weld(parts);

  const toArcEnt = s => { const a = bulgeToArc(s.a, s.b, s.bulge); return a ? { type: 'arc', c: a.c, r: a.r, a0: a.a0, a1: a.a1 } : { type: 'line', a: { ...s.a }, b: { ...s.b } }; };

  let out;
  if (parts.length === 1) {
    const s = parts[0];
    if (s.type === 'arc' && Math.abs(4 * Math.atan(s.bulge)) > 1.9 * Math.PI && s.c)
      return [{ type: 'circle', c: { ...s.c }, r: s.r }];
    out = [s.type === 'arc' ? toArcEnt(s) : { type: 'line', a: { ...s.a }, b: { ...s.b } }];
  } else {
    // chain the pieces into ONE polyline (arcs → bulges). weld made endpoints coincide.
    const isClosed = closed || dist(parts[0].a, parts[parts.length - 1].b) < closeTol;
    const pts = parts.map(s => s.bulge ? { x: s.a.x, y: s.a.y, bulge: s.bulge } : { x: s.a.x, y: s.a.y });
    if (!isClosed) { const e = parts[parts.length - 1].b; pts.push({ x: e.x, y: e.y }); }
    out = [{ type: 'poly', pts, closed: isClosed }];
  }

  // safety net: the fit must never track the stroke worse than a plain smooth polyline would.
  // if it diverged (pathological/degenerate input), fall back to the smooth RDP polyline.
  if (fitMaxDev(out, sm) > tol * 2.5) {
    const simp = rdp(sm, tol);
    if (closed && simp.length > 3 && dist(simp[0], simp[simp.length - 1]) < closeTol) simp.pop();
    return [{ type: 'poly', pts: simp.map(p => ({ x: p.x, y: p.y })), closed }];
  }
  return out;
}
// max distance from stroke points to the fitted geometry (fidelity check)
function fitMaxDev(entities, pts) {
  const segs = entities.flatMap(e => e.type === 'poly' ? polyToSegments(e) : [e]);
  if (!segs.length) return Infinity;
  let m = 0;
  for (const p of pts) {
    let best = Infinity;
    for (const s of segs) { const cp = closestPointOnEntity(s, p); if (cp && cp.d < best) best = cp.d; }
    if (best > m) m = best;
  }
  return m;
}
// RAW mode: a faithful but smooth polyline of the stroke — tremor removed, curves preserved.
export function smoothStroke(rawPts, tol = 0.8) {
  const h = Math.min(1.0, Math.max(0.25, tol * 0.6));
  const rs = resample(rawPts, h);
  if (rs.length < 3) return rs.map(p => ({ x: p.x, y: p.y }));
  const passes = rs.length > 40 ? 2 : 1;
  let sm = rs;
  for (let i = 0; i < passes; i++) sm = smooth5(sm);
  return rdp(sm, tol * 0.5).map(p => ({ x: p.x, y: p.y }));   // keep curve detail, drop redundancy
}
function resample(pts, h) {
  const out = [{ x: pts[0].x, y: pts[0].y }];
  let acc = 0;
  for (let i = 1; i < pts.length; i++) {
    let a = out.length ? { ...pts[i - 1] } : pts[i - 1];
    a = pts[i - 1];
    let b = pts[i];
    let cur = { x: a.x, y: a.y };
    let d = dist(cur, b);
    while (acc + d >= h) {
      const t = (h - acc) / d;
      cur = { x: cur.x + (b.x - cur.x) * t, y: cur.y + (b.y - cur.y) * t };
      out.push({ ...cur });
      d = dist(cur, b);
      acc = 0;
    }
    acc += d;
  }
  const lastIn = pts[pts.length - 1];
  if (dist(out[out.length - 1], lastIn) > h / 4) out.push({ x: lastIn.x, y: lastIn.y });
  return out;
}
function smooth5(pts) {
  const out = pts.map(p => ({ x: p.x, y: p.y }));
  for (let i = 2; i < pts.length - 2; i++) {
    out[i] = {
      x: (pts[i - 2].x + pts[i - 1].x + pts[i].x + pts[i + 1].x + pts[i + 2].x) / 5,
      y: (pts[i - 2].y + pts[i - 1].y + pts[i].y + pts[i + 1].y + pts[i + 2].y) / 5,
    };
  }
  return out;
}
function findCorners(pts, w, thresh) {
  const n = pts.length;
  const th = new Array(n).fill(0);
  for (let i = w; i < n - w; i++) {
    const v1 = sub(pts[i], pts[i - w]), v2 = sub(pts[i + w], pts[i]);
    th[i] = Math.atan2(v1.x * v2.y - v1.y * v2.x, v1.x * v2.x + v1.y * v2.y);
  }
  const corners = [];
  let lastC = -Infinity;
  for (let i = w; i < n - w; i++) {
    if (Math.abs(th[i]) < thresh) continue;
    let isMax = true;
    for (let j = Math.max(0, i - w); j <= Math.min(n - 1, i + w); j++)
      if (Math.abs(th[j]) > Math.abs(th[i])) { isMax = false; break; }
    if (isMax && i - lastC >= 2 * w) { corners.push(i); lastC = i; }
  }
  return corners;
}
function classifyRun(run, tol, minArcSweep, depth) {
  if (run.length < 2) return [];
  // only a SHORT run with coincident endpoints is dust; a long closed loop must be split
  if (run.length < 5) return dist(run[0], run[run.length - 1]) < EPS ? [] : [{ type: 'line', a: { ...run[0] }, b: { ...run[run.length - 1] } }];

  const runLen = polylineLength(run);
  const lineFit = tlsLine(run);
  // a genuine line's endpoints span most of its length; a folded/closed run's don't
  const spanOK = dist(run[0], run[run.length - 1]) > runLen * 0.2;
  // gate on MAX deviation, not RMS — RMS lets a single 5mm bulge through
  if (lineFit.maxDev < tol && spanOK)
    return [{ type: 'line', a: lineFit.project(run[0]), b: lineFit.project(run[run.length - 1]) }];

  const cf = kasa(run);
  if (cf) {
    const arcMax = circleMaxDev(run, cf);
    const turn = Math.abs(totalTurning(run, cf.c));
    if (arcMax < tol * 1.3 && turn >= minArcSweep && turn < 2.6 * Math.PI && cf.r < runLen * 30 && spanOK) {
      const t = totalTurning(run, cf.c);   // signed sweep → signed bulge (traversal direction preserved)
      return [{ type: 'arc', a: { ...run[0] }, b: { ...run[run.length - 1] }, bulge: Math.tan(t / 4), c: { ...cf.c }, r: cf.r }];
    }
  }
  // organic run: split off genuinely straight spans as LINES, biarc-fit the curved gaps
  return classifyCurve(run, tol);
}
// straight spans become exact lines; curved gaps become smooth tangent-continuous biarcs
function classifyCurve(run, tol) {
  const n = run.length, w = 3;
  const straightThresh = 5 * Math.PI / 180;
  const straight = new Array(n).fill(false);
  for (let i = w; i < n - w; i++) {
    const v1 = sub(run[i], run[i - w]), v2 = sub(run[i + w], run[i]);
    straight[i] = Math.abs(Math.atan2(cross2(v1, v2), dot2(v1, v2))) < straightThresh;
  }
  const minPts = 6, minLen = Math.max(6, tol * 8);
  const spans = [];
  let i = 0;
  while (i < n) {
    if (!straight[i]) { i++; continue; }
    let j = i;
    while (j < n && straight[j]) j++;
    if (j - i >= minPts) {
      const slice = run.slice(i, j);
      if (tlsLine(slice).maxDev < tol && polylineLength(slice) >= minLen) spans.push([i, j - 1]);
    }
    i = j;
  }
  if (!spans.length) return fitSmoothRun(run, tol, 0);
  const lineDir = (a, b) => unit(sub(run[b], run[a])) || { x: 1, y: 0 };
  const out = [];
  let pos = 0, prevLineT = undefined;
  const gap = (a, b, T0, T1) => {
    if (b - a >= 2) out.push(...fitSmoothRun(run.slice(a, b + 1), tol, 0, T0, T1));
    else if (b > a) out.push({ type: 'line', a: { ...run[a] }, b: { ...run[b] } });
  };
  for (const [s0, s1] of spans) {
    const T = lineDir(s0, s1);
    if (s0 > pos) gap(pos, s0, prevLineT, T);        // curve flows into this line (tangent = T)
    const lf = tlsLine(run.slice(s0, s1 + 1));
    out.push({ type: 'line', a: lf.project(run[s0]), b: lf.project(run[s1]) });
    pos = s1; prevLineT = T;
  }
  if (pos < n - 1) gap(pos, n - 1, prevLineT, undefined);
  return out;
}

// ---- biarc smooth-curve fitting ----
const cross2 = (a, b) => a.x * b.y - a.y * b.x;
const dot2 = (a, b) => a.x * b.x + a.y * b.y;
function tangentAt(pts, i, span) {
  const n = pts.length;
  const a = pts[Math.max(0, i - span)], b = pts[Math.min(n - 1, i + span)];
  const d = { x: b.x - a.x, y: b.y - a.y };
  const L = Math.hypot(d.x, d.y);
  return L < 1e-9 ? { x: 1, y: 0 } : { x: d.x / L, y: d.y / L };
}
function arcTS(P0, P1, bulge) {
  if (Math.abs(bulge) < 8e-3) return { type: 'line', a: { ...P0 }, b: { ...P1 } };   // ~1° bow → line
  const arc = bulgeToArc(P0, P1, bulge);
  if (!arc) return { type: 'line', a: { ...P0 }, b: { ...P1 } };
  // include a0/a1 so closestPointOnEntity measures against the real arc span
  return { type: 'arc', a: { ...P0 }, b: { ...P1 }, bulge, c: arc.c, r: arc.r, a0: arc.a0, a1: arc.a1 };
}
// one biarc: two arcs from P0 (tangent T0) to P1 (tangent T1), tangent-continuous at the joint
function biarcSegs(P0, T0, P1, T1) {
  const v = { x: P1.x - P0.x, y: P1.y - P0.y };
  const vv = dot2(v, v);
  if (vv < 1e-12) return null;
  const tsum = { x: T0.x + T1.x, y: T0.y + T1.y };
  const vt = dot2(v, tsum);
  const denom = 2 * (1 - dot2(T0, T1));
  let d;
  if (Math.abs(denom) < 1e-7) {
    const vT1 = dot2(v, T1);
    if (Math.abs(vT1) < 1e-9) return [arcTS(P0, P1, 0)];
    d = vv / (4 * vT1);
  } else {
    const disc = vt * vt + denom * vv;
    if (disc < 0) return null;
    d = (-vt + Math.sqrt(disc)) / denom;
  }
  if (!(d > 1e-7)) return [arcTS(P0, P1, 0)];
  const A = { x: P0.x + d * T0.x, y: P0.y + d * T0.y };
  const B = { x: P1.x - d * T1.x, y: P1.y - d * T1.y };
  const J = { x: (A.x + B.x) / 2, y: (A.y + B.y) / 2 };
  const c1 = { x: J.x - P0.x, y: J.y - P0.y };
  const b1 = Math.tan(Math.atan2(cross2(T0, c1), dot2(T0, c1)) / 2);
  const Tj = unit({ x: B.x - A.x, y: B.y - A.y }) || T0;
  const c2 = { x: P1.x - J.x, y: P1.y - J.y };
  const b2 = Math.tan(Math.atan2(cross2(Tj, c2), dot2(Tj, c2)) / 2);
  return [arcTS(P0, J, b1), arcTS(J, P1, b2)];
}
// adaptive biarc fit of a smooth run; subdivides at the worst point until within tol
function fitSmoothRun(run, tol, depth, T0, T1) {
  const span = 2;
  if (T0 === undefined) T0 = tangentAt(run, 0, span);
  if (T1 === undefined) T1 = tangentAt(run, run.length - 1, span);
  const ba = biarcSegs(run[0], T0, run[run.length - 1], T1);
  if (ba && run.length > 2) {
    let worst = 0, wi = -1;
    for (let i = 1; i < run.length - 1; i++) {
      let best = Infinity;
      for (const sg of ba) { const cp = closestPointOnEntity(sg, run[i]); if (cp && cp.d < best) best = cp.d; }
      if (best > worst) { worst = best; wi = i; }
    }
    if (worst < tol || depth >= 9 || wi < 1 || wi > run.length - 2) return ba;
    const Tm = tangentAt(run, wi, span);
    return [
      ...fitSmoothRun(run.slice(0, wi + 1), tol, depth + 1, T0, Tm),
      ...fitSmoothRun(run.slice(wi), tol, depth + 1, Tm, T1),
    ];
  }
  if (ba) return ba;
  // biarc degenerate → split at midpoint
  if (depth >= 9) return [{ type: 'line', a: { ...run[0] }, b: { ...run[run.length - 1] } }];
  const mid = run.length >> 1;
  const Tm = tangentAt(run, mid, span);
  return [
    ...fitSmoothRun(run.slice(0, mid + 1), tol, depth + 1, T0, Tm),
    ...fitSmoothRun(run.slice(mid), tol, depth + 1, Tm, T1),
  ];
}
function tlsLine(pts) {
  const n = pts.length;
  let mx = 0, my = 0;
  for (const p of pts) { mx += p.x; my += p.y; }
  mx /= n; my /= n;
  let sxx = 0, sxy = 0, syy = 0;
  for (const p of pts) {
    const dx = p.x - mx, dy = p.y - my;
    sxx += dx * dx; sxy += dx * dy; syy += dy * dy;
  }
  const phi = 0.5 * Math.atan2(2 * sxy, sxx - syy);
  const ux = Math.cos(phi), uy = Math.sin(phi);
  let sum2 = 0, maxDev = 0;
  for (const p of pts) {
    const dx = p.x - mx, dy = p.y - my;
    const perp = Math.abs(-uy * dx + ux * dy);
    sum2 += perp * perp;
    if (perp > maxDev) maxDev = perp;
  }
  return {
    rms: Math.sqrt(sum2 / n),
    maxDev,
    project: p => {
      const t = (p.x - mx) * ux + (p.y - my) * uy;
      return { x: mx + t * ux, y: my + t * uy };
    },
  };
}
// max radial deviation of points from a circle — bounds fidelity better than RMS
const circleMaxDev = (pts, cf) => { let m = 0; for (const p of pts) { const d = Math.abs(dist(p, cf.c) - cf.r); if (d > m) m = d; } return m; };
function kasa(pts) {
  const n = pts.length;
  let mx = 0, my = 0;
  for (const p of pts) { mx += p.x; my += p.y; }
  mx /= n; my /= n;
  let Sxx = 0, Sxy = 0, Syy = 0, Sx = 0, Sy = 0, Sxz = 0, Syz = 0, Sz = 0;
  for (const p of pts) {
    const x = p.x - mx, y = p.y - my;
    const z = x * x + y * y;
    Sxx += x * x; Sxy += x * y; Syy += y * y;
    Sx += x; Sy += y;
    Sxz += x * z; Syz += y * z; Sz += z;
  }
  const M = [
    [Sxx, Sxy, Sx, -Sxz],
    [Sxy, Syy, Sy, -Syz],
    [Sx, Sy, n, -Sz],
  ];
  for (let col = 0; col < 3; col++) {
    let piv = col;
    for (let row = col + 1; row < 3; row++) if (Math.abs(M[row][col]) > Math.abs(M[piv][col])) piv = row;
    if (Math.abs(M[piv][col]) < 1e-12) return null;
    [M[col], M[piv]] = [M[piv], M[col]];
    for (let row = 0; row < 3; row++) {
      if (row === col) continue;
      const f = M[row][col] / M[col][col];
      for (let cc = col; cc < 4; cc++) M[row][cc] -= f * M[col][cc];
    }
  }
  const D = M[0][3] / M[0][0], E = M[1][3] / M[1][1], F = M[2][3] / M[2][2];
  const r2 = D * D / 4 + E * E / 4 - F;
  if (r2 <= 0) return null;
  return { c: { x: -D / 2 + mx, y: -E / 2 + my }, r: Math.sqrt(r2) };
}
function mergeParts(parts, tol) {
  const out = [];
  for (const s of parts) {
    const prev = out[out.length - 1];
    if (prev && prev.type === 'line' && s.type === 'line') {
      const a1 = Math.atan2(prev.b.y - prev.a.y, prev.b.x - prev.a.x);
      const a2 = Math.atan2(s.b.y - s.a.y, s.b.x - s.a.x);
      let dAng = Math.abs(a1 - a2);
      if (dAng > Math.PI) dAng = TAU - dAng;
      if (dAng < 3 * Math.PI / 180) { prev.b = { ...s.b }; continue; }
    }
    // merge consecutive co-circular arcs into one
    if (prev && prev.type === 'arc' && s.type === 'arc' && prev.c && s.c &&
        dist(prev.c, s.c) < tol * 3 && Math.abs(prev.r - s.r) < tol * 3) {
      const sw = 4 * Math.atan(prev.bulge) + 4 * Math.atan(s.bulge);
      if (Math.abs(sw) < TAU * 0.98) { prev.b = { ...s.b }; prev.bulge = Math.tan(sw / 4); continue; }
    }
    out.push(s);
  }
  return out;
}
function weld(parts) {
  for (let i = 0; i < parts.length - 1; i++) {
    const pa = parts[i].b, pb = parts[i + 1].a;
    if (dist(pa, pb) < 1e-9) continue;
    const mid = { x: (pa.x + pb.x) / 2, y: (pa.y + pb.y) / 2 };
    parts[i].b = mid; parts[i + 1].a = { ...mid };
  }
}

// ---------------------------------------------------------------- grips
export function gripPoints(e) {
  if (e.type === 'line') return [
    { p: { ...e.a }, kind: 'end', index: 0 },
    { p: { ...e.b }, kind: 'end', index: 1 },
    { p: { x: (e.a.x + e.b.x) / 2, y: (e.a.y + e.b.y) / 2 }, kind: 'mid', index: 2 },
  ];
  if (e.type === 'circle') return [
    { p: { ...e.c }, kind: 'center', index: 0 },
    { p: { x: e.c.x + e.r, y: e.c.y }, kind: 'radius', index: 1 },
    { p: { x: e.c.x - e.r, y: e.c.y }, kind: 'radius', index: 2 },
    { p: { x: e.c.x, y: e.c.y + e.r }, kind: 'radius', index: 3 },
    { p: { x: e.c.x, y: e.c.y - e.r }, kind: 'radius', index: 4 },
  ];
  if (e.type === 'arc') {
    const mid = arcPt(e, e.a0 + (sweep(e.a0, e.a1) || TAU) / 2);
    return [
      { p: { ...e.c }, kind: 'center', index: 0 },
      { p: arcPt(e, e.a0), kind: 'end', index: 1 },
      { p: arcPt(e, e.a1), kind: 'end', index: 2 },
      { p: mid, kind: 'mid', index: 3 },
    ];
  }
  if (e.type === 'poly') return e.pts.map((p, i) => ({ p: { x: p.x, y: p.y }, kind: 'vertex', index: i }));
  if (e.type === 'point') return [{ p: { ...e.p }, kind: 'end', index: 0 }];
  if (e.type === 'text') return [{ p: { ...e.p }, kind: 'end', index: 0 }];
  return [];
}
export function setGrip(e, grip, newPt) {
  if (e.type === 'line') {
    if (grip.kind === 'mid') {
      const old = { x: (e.a.x + e.b.x) / 2, y: (e.a.y + e.b.y) / 2 };
      return translateEnt(e, newPt.x - old.x, newPt.y - old.y);
    }
    return grip.index === 0 ? { ...e, a: { x: newPt.x, y: newPt.y } } : { ...e, b: { x: newPt.x, y: newPt.y } };
  }
  if (e.type === 'circle') {
    if (grip.kind === 'center') return { ...e, c: { x: newPt.x, y: newPt.y } };
    const r = dist(e.c, newPt);
    return r > EPS ? { ...e, r } : { ...e };
  }
  if (e.type === 'arc') {
    if (grip.kind === 'center') return { ...e, c: { x: newPt.x, y: newPt.y } };
    if (grip.kind === 'mid') {
      const old = arcPt(e, e.a0 + (sweep(e.a0, e.a1) || TAU) / 2);
      return translateEnt(e, newPt.x - old.x, newPt.y - old.y);
    }
    const ang = norm(Math.atan2(newPt.y - e.c.y, newPt.x - e.c.x));
    return grip.index === 1 ? { ...e, a0: ang } : { ...e, a1: ang };
  }
  if (e.type === 'poly') {
    const pts = e.pts.map(clonePt);
    if (pts[grip.index]) { pts[grip.index].x = newPt.x; pts[grip.index].y = newPt.y; }
    return { ...e, pts };
  }
  if (e.type === 'point') return { ...e, p: { x: newPt.x, y: newPt.y } };
  if (e.type === 'text') return { ...e, p: { x: newPt.x, y: newPt.y } };
  return { ...e };
}

// ---------------------------------------------------------------- self-test
export function selfTest() {
  const F = [];
  const ok = (cond, name) => { if (!cond) F.push(name); };
  const near = (a, b, tol = 1e-6) => Math.abs(a - b) < tol;
  const nearPt = (p, q, tol = 1e-6) => dist(p, q) < tol;

  {
    const b = Math.tan(Math.PI / 8);
    const arc = bulgeToArc({ x: 1, y: 0 }, { x: 0, y: 1 }, b);
    ok(arc && nearPt(arc.c, { x: 0, y: 0 }) && near(arc.r, 1), 'bulgeToArc quarter');
    const segs = arcToBulgeSegs({ c: { x: 0, y: 0 }, r: 1, a0: 0, a1: Math.PI / 2 });
    ok(segs.length === 1 && near(segs[0].b, b) && nearPt(segs[0].p1, { x: 1, y: 0 }) && nearPt(segs[0].p2, { x: 0, y: 1 }), 'arcToBulgeSegs quarter');
    const round = bulgeToArc(segs[0].p1, segs[0].p2, segs[0].b);
    ok(round && nearPt(round.c, { x: 0, y: 0 }) && near(round.r, 1), 'bulge round-trip');
    const semi = bulgeToArc({ x: 0, y: 0 }, { x: 10, y: 0 }, 1);
    ok(semi && nearPt(semi.c, { x: 5, y: 0 }) && near(semi.r, 5), 'semicircle bulge=1');
  }
  {
    const h = lineLine({ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 5, y: -5 }, { x: 5, y: 5 });
    ok(h && nearPt(h.p, { x: 5, y: 0 }) && near(h.t, 0.5), 'lineLine');
    ok(lineLine({ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 1 }, { x: 1, y: 1 }) === null, 'lineLine parallel');
  }
  {
    const hits = intersectEntities({ type: 'circle', c: { x: 0, y: 0 }, r: 5 }, { type: 'circle', c: { x: 8, y: 0 }, r: 5 });
    ok(hits.length === 2 && hits.every(h => near(h.p.x, 4)), 'circleCircle');
    const lc = intersectEntities({ type: 'line', a: { x: -10, y: 0 }, b: { x: 10, y: 0 } }, { type: 'circle', c: { x: 0, y: 0 }, r: 5 });
    ok(lc.length === 2, 'lineCircle');
  }
  {
    const sq = { type: 'poly', closed: true, pts: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }] };
    const ap = polyAreaPerimeter(sq);
    ok(near(ap.area, 1) && near(ap.perimeter, 4), 'square area');
    const half = { type: 'poly', closed: true, pts: [{ x: 0, y: 0, bulge: 1 }, { x: 10, y: 0 }] };
    const ap2 = polyAreaPerimeter(half);
    ok(near(ap2.area, Math.PI * 25 / 2, 1e-6), 'semicircle area got ' + ap2.area.toFixed(4));
  }
  {
    const e1 = { type: 'line', a: { x: 0, y: 0 }, b: { x: 10, y: 0 } };
    const e2 = { type: 'line', a: { x: 0, y: 0 }, b: { x: 0, y: 10 } };
    const res = filletSegments(e1, { x: 9, y: 0 }, e2, { x: 0, y: 9 }, 1);
    ok(!res.error, 'fillet ok: ' + (res.error || ''));
    if (!res.error) {
      ok(nearPt(res.arc.c, { x: 1, y: 1 }) && near(res.arc.r, 1), 'fillet center');
      ok(near(sweep(res.arc.a0, res.arc.a1), Math.PI / 2), 'fillet sweep');
      const t1ok = nearPt(res.e1.a, { x: 1, y: 0 }) || nearPt(res.e1.b, { x: 1, y: 0 });
      ok(t1ok, 'fillet trim1');
    }
  }
  {
    const e1 = { type: 'line', a: { x: 0, y: 0 }, b: { x: 10, y: 0 } };
    const e2 = { type: 'line', a: { x: 0, y: 0 }, b: { x: 0, y: 10 } };
    const res = chamferSegments(e1, { x: 9, y: 0 }, e2, { x: 0, y: 9 }, 2, 3);
    ok(!res.error && nearPt(res.line.a, { x: 2, y: 0 }) && nearPt(res.line.b, { x: 0, y: 3 }), 'chamfer');
  }
  {
    const target = { type: 'line', a: { x: 0, y: 0 }, b: { x: 10, y: 0 } };
    const cutter = { type: 'line', a: { x: 5, y: -5 }, b: { x: 5, y: 5 } };
    const res = trimEntity(target, [cutter], { x: 2, y: 0 });
    ok(res && res.length === 1 && nearPt(res[0].a, { x: 5, y: 0 }) && nearPt(res[0].b, { x: 10, y: 0 }), 'trim start half');
    const res2 = trimEntity(target, [cutter, { type: 'line', a: { x: 8, y: -5 }, b: { x: 8, y: 5 } }], { x: 6.5, y: 0 });
    ok(res2 && res2.length === 2, 'trim middle');
  }
  {
    const target = { type: 'line', a: { x: 0, y: 0 }, b: { x: 4, y: 0 } };
    const bnd = { type: 'line', a: { x: 10, y: -5 }, b: { x: 10, y: 5 } };
    const res = extendEntity(target, [bnd], { x: 4, y: 0 });
    ok(res && nearPt(res.b, { x: 10, y: 0 }), 'extend');
  }
  {
    const off = offsetEntity({ type: 'line', a: { x: 0, y: 0 }, b: { x: 10, y: 0 } }, 2);
    ok(off && near(off.a.y, 2) && near(off.b.y, 2), 'offset line');
    const rect = { type: 'poly', closed: true, pts: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }] };
    const offR = offsetPolyTowards(rect, { x: 5, y: 5 }, 2);
    if (offR) {
      const ap = polyAreaPerimeter(offR);
      ok(near(ap.area, 36, 0.6), 'offset rect inward area ~36 got ' + ap.area.toFixed(2));
    } else F.push('offset rect returned null');
  }
  {
    const arc = { type: 'arc', c: { x: 3, y: 4 }, r: 2, a0: 0.5, a1: 2.0 };
    const m2 = mirrorEnt(mirrorEnt(arc, { x: 0, y: 0 }, { x: 1, y: 0 }), { x: 0, y: 0 }, { x: 1, y: 0 });
    ok(nearPt(m2.c, arc.c) && near(sweep(m2.a0, m2.a1), sweep(arc.a0, arc.a1)) && near(norm(m2.a0), norm(arc.a0)), 'mirror involution');
    const m1 = mirrorEnt(arc, { x: 0, y: 0 }, { x: 1, y: 0 });
    ok(nearPt(arcPt(m1, m1.a0), reflectPt(arcPt(arc, arc.a1), { x: 0, y: 0 }, { x: 1, y: 0 })), 'mirror endpoints swap');
  }
  {
    const arc = arcFrom3({ x: 0, y: 0 }, { x: 1, y: 1 }, { x: 2, y: 0 });
    ok(arc && nearPt(arc.c, { x: 1, y: 0 }) && near(arc.r, 1), 'arcFrom3');
    ok(arc && angOnArc(arc, Math.atan2(1 - arc.c.y, 1 - arc.c.x)), 'arcFrom3 through mid');
  }
  ok(rdp([{ x: 0, y: 0 }, { x: 5, y: 0.1 }, { x: 10, y: 0 }], 0.5).length === 2, 'rdp flat');
  ok(rdp([{ x: 0, y: 0 }, { x: 5, y: 5 }, { x: 10, y: 0 }], 0.5).length === 3, 'rdp bent');
  {
    const pts = [];
    for (let i = 0; i <= 40; i++) pts.push({ x: i, y: 0.05 * Math.sin(i) });
    for (let i = 1; i <= 40; i++) pts.push({ x: 40, y: i });
    const ents = fitStroke(pts, { tol: 0.8, cornerDeg: 40 });
    const segs = ents.length === 1 && ents[0].type === 'poly' ? polyToSegments(ents[0]) : ents;
    ok(segs.length === 2 && segs.every(s => s.type === 'line'), `fitStroke L: got ${segs.map(s => s.type).join(',') || 'nothing'}`);
    if (segs.length === 2) {
      ok(nearPt(segStartOf(segs[0]), { x: 0, y: 0 }, 1.5) && nearPt(segEndOf(segs[1]), { x: 40, y: 40 }, 1.5), 'fitStroke L endpoints');
    }
  }
  {
    const pts = [];
    let seed = 42;
    const rand = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648 - 0.5; };
    for (let i = 0; i <= 60; i++) {
      const a = i / 60 * Math.PI / 2;
      pts.push({ x: 50 * Math.cos(a) + rand() * 0.4, y: 50 * Math.sin(a) + rand() * 0.4 });
    }
    const ents = fitStroke(pts, { tol: 0.8, cornerDeg: 40 });
    const segs = ents.length === 1 && ents[0].type === 'poly' ? polyToSegments(ents[0]) : ents;
    ok(segs.length === 1 && segs[0].type === 'arc' && near(segs[0].r, 50, 1.5),
      `fitStroke arc: got ${segs.map(s => s.type + (s.r ? '(' + s.r.toFixed(1) + ')' : '')).join(',') || 'nothing'}`);
  }
  // traced CIRCLE must become ONE circle entity, not a pile of dots (the reported bug)
  {
    let seed = 7;
    const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648 - 0.5; };
    const pts = [];
    for (let i = 0; i <= 120; i++) {
      const a = i / 120 * TAU;
      pts.push({ x: 40 + 30 * Math.cos(a) + rnd() * 0.5, y: 40 + 30 * Math.sin(a) + rnd() * 0.5 });
    }
    const ents = fitStroke(pts, { tol: 0.8, cornerDeg: 35 });
    ok(ents.length === 1 && ents[0].type === 'circle' && near(ents[0].r, 30, 1.5) && nearPt(ents[0].c, { x: 40, y: 40 }, 1.5),
      `fitStroke circle: got ${ents.length} × ${ents.map(e => e.type).join(',')}`);
  }
  // traced rounded rectangle → a handful of entities (lines + arcs), never dozens
  {
    let seed = 99;
    const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648 - 0.5; };
    const pts = [];
    const push = (x, y) => pts.push({ x: x + rnd() * 0.3, y: y + rnd() * 0.3 });
    const rr = 10, w = 80, hh = 50;
    const corner = (cx, cy, a0, a1) => { for (let i = 0; i <= 12; i++) { const a = a0 + (a1 - a0) * i / 12; push(cx + rr * Math.cos(a), cy + rr * Math.sin(a)); } };
    for (let i = 0; i <= 30; i++) push(rr + (w - 2 * rr) * i / 30, 0);          // bottom
    corner(w - rr, rr, -Math.PI / 2, 0);
    for (let i = 0; i <= 20; i++) push(w, rr + (hh - 2 * rr) * i / 20);          // right
    corner(w - rr, hh - rr, 0, Math.PI / 2);
    for (let i = 0; i <= 30; i++) push(w - rr - (w - 2 * rr) * i / 30, hh);      // top
    corner(rr, hh - rr, Math.PI / 2, Math.PI);
    for (let i = 0; i <= 20; i++) push(0, hh - rr - (hh - 2 * rr) * i / 20);     // left
    corner(rr, rr, Math.PI, Math.PI * 1.5);
    const ents = fitStroke(pts, { tol: 0.8, cornerDeg: 35 });
    const segs = ents.length === 1 && ents[0].type === 'poly' ? polyToSegments(ents[0]) : ents;
    ok(segs.length <= 10, `fitStroke rounded-rect entity count ${segs.length} (must be <=10, was 50+ before)`);
    ok(segs.some(s => s.type === 'arc') && segs.some(s => s.type === 'line'), 'rounded-rect has both lines and arcs');
  }
  {
    const poly = { type: 'poly', closed: true, pts: [{ x: 0, y: 0 }, { x: 10, y: 0, bulge: 0.5 }, { x: 10, y: 10 }] };
    const back = segmentsToPoly(polyToSegments(poly));
    ok(back && back.closed && back.pts.length === 3, 'segmentsToPoly round-trip');
  }
  {
    const line = { type: 'line', a: { x: 0, y: 0 }, b: { x: 10, y: 0 } };
    const g = gripPoints(line);
    ok(g.length === 3, 'line grips');
    const moved = setGrip(line, g[2], { x: 10, y: 5 });
    ok(nearPt(moved.a, { x: 5, y: 5 }) && nearPt(moved.b, { x: 15, y: 5 }), 'mid grip translates');
  }
  return { pass: F.length === 0, failures: F };

  function segStartOf(s) { return s.type === 'line' ? s.a : arcPt(s, s.a0); }
  function segEndOf(s) { return s.type === 'line' ? s.b : arcPt(s, s.a1); }
}
