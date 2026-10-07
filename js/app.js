// TrueLine core: document, view, rendering, snapping, input routing.
// Frame: world = true millimeters, Y-down. k() = screen px per mm.
import * as G from './geom.js';
import { readRevisions, writeRevision } from './recovery.js';

export const App = {
  doc: null,
  fileDirty: false,
  recoveryAt: null,
  view: { x: -30, y: -30, z: 1 },
  CAL: +localStorage.getItem('tl-cal') || 96 / 25.4,   // px per mm at zoom 1
  calibrated: !!localStorage.getItem('tl-cal'),

  selection: new Set(),
  hoverId: null,

  toggles: { snap: false, grid: true, ortho: false, polar: false, osnap: true, dyn: true },
  osnapModes: { end: true, mid: true, center: true, quad: true, int: true, perp: true, node: true, near: false },
  polarStep: 15,

  tools: new Map(),       // id -> tool object (tools.js registers)
  tool: null,
  lastToolId: 'line',
  clipboard: null,

  undoStack: [], redoStack: [],
  ui: {},                 // ui.js hooks: msg, prompt, refreshLayers, refreshProps, chips, ctxStrip...
  pen: { seen: false, pressure: 0, type: 'none' },

  G,                      // expose geometry module to tools/ui
};

let cvGrid, cvScene, cvOverlay, rulX, rulY, stackEl;
let ctxG, ctxS, ctxO, ctxRX, ctxRY;
let dirtyFlags = { grid: true, scene: true, overlay: true, rulers: true };
let rafQueued = false;

export const k = () => App.view.z * App.CAL;
export const toScreen = p => ({ x: (p.x - App.view.x) * k(), y: (p.y - App.view.y) * k() });
export const toWorld = (sx, sy) => ({ x: sx / k() + App.view.x, y: sy / k() + App.view.y });

// ---------------------------------------------------------------- document
export function newDoc() {
  if (App.doc) flushAutosave();
  App.tool?.cancel?.();
  App.doc = {
    v: 3,
    name: 'untitled',
    units: 'mm', precision: 2,
    gridStep: 10,                 // mm
    entities: [],
    layers: [{ id: 'L0', name: 'Layer 0', color: '#DEE3EC', ltype: 'continuous', visible: true, locked: false }],
    currentLayer: 'L0',
    dimStyle: { textH: 3.5, arrow: 2.5, extOff: 1.5, extOver: 1.5 },
    traceOpts: { tol: 0.8, cornerDeg: 40, axisSnapDeg: 2, close: true, mode: 'fit', preview: true },
    section: null, assemblies: [],
    underlay: null,               // {dataURL, x, y, wMM, hMM, opacity, visible}
  };
  App.fileDirty = false; pendingSnap = null; App.ui.setDirty?.(false);
  App.selection.clear();
  App.undoStack = []; App.redoStack = [];
  underlayImg = null;
  invalidate('all');
}

let idCounter = Date.now() % 1e8;
export const newId = () => 'e' + (idCounter++).toString(36);

export function layerOf(e) {
  return App.doc.layers.find(l => l.id === e.layer) || App.doc.layers[0];
}
export function currentLayer() {
  return App.doc.layers.find(l => l.id === App.doc.currentLayer) || App.doc.layers[0];
}
export function visibleEntities() {
  const vis = new Set(App.doc.layers.filter(l => l.visible).map(l => l.id));
  return App.doc.entities.filter(e => vis.has(e.layer));
}
export function selectableEntities() {
  const ok = new Set(App.doc.layers.filter(l => l.visible && !l.locked).map(l => l.id));
  return App.doc.entities.filter(e => ok.has(e.layer));
}

// ---------------------------------------------------------------- undo/redo
function snapshot() {
  return JSON.stringify({ doc: App.doc, CAL: App.CAL, calibrated: App.calibrated });
}
function restore(s) {
  const d = JSON.parse(s);
  App.doc = d.doc; App.CAL = d.CAL; App.calibrated = d.calibrated;
  if (App.calibrated) localStorage.setItem('tl-cal', App.CAL); else localStorage.removeItem('tl-cal');
  reloadUnderlayImg(); App.ui.updateCalChip?.();
  App.selection = new Set([...App.selection].filter(id => App.doc.entities.some(e => e.id === id)));
}
let pendingSnap = null;
// first-wins: a mutate fired mid-drag must not clobber the live pre-drag snapshot
function trimUndoHistory(stack) {
  let bytes = stack.reduce((sum, s) => sum + s.length * 2, 0);
  while (stack.length > 1 && (stack.length > 200 || bytes > 64 * 1024 * 1024)) bytes -= stack.shift().length * 2;
}
export function beginChange() { if (pendingSnap === null) pendingSnap = snapshot(); }
export function commitChange(label) {
  if (pendingSnap === null) return;
  if (pendingSnap === snapshot()) { pendingSnap = null; return; }
  App.undoStack.push(pendingSnap);
  trimUndoHistory(App.undoStack);
  App.redoStack = [];
  pendingSnap = null;
  markDirtyDoc(label);
}
export function abortChange() {
  if (pendingSnap !== null) { restore(pendingSnap); pendingSnap = null; invalidate('scene'); }
}
export function mutate(label, fn) { beginChange(); fn(); commitChange(label); }
export function undo() {
  if (App.tools.get('freehand')?.pending) { App.tools.get('freehand').cancel(); App.ui.refreshCtx?.(); invalidate('overlay'); return; }
  if (pendingSnap !== null) { abortChange(); return; }
  if (!App.undoStack.length) return;
  App.redoStack.push(snapshot()); trimUndoHistory(App.redoStack);
  restore(App.undoStack.pop());
  markDirtyDoc('undo');
}
export function redo() {
  if (!App.redoStack.length) return;
  App.undoStack.push(snapshot()); trimUndoHistory(App.undoStack);
  restore(App.redoStack.pop());
  markDirtyDoc('redo');
}
function markDirtyDoc(label) {
  invalidate('all');
  App.ui.refreshLayers?.(); App.ui.refreshProps?.(); App.ui.refreshUndo?.();
  App.ui.setDirty?.(true);
  scheduleAutosave();
  if (label && label !== 'undo' && label !== 'redo') App.ui.msg?.(label);
}

// ---------------------------------------------------------------- units
const UNITS = {
  mm: { toMM: 1, label: 'mm' },
  cm: { toMM: 10, label: 'cm' },
  in: { toMM: 25.4, label: 'in' },
};
export function fmt(mm, extraDigits = 0) {
  const u = UNITS[App.doc.units];
  return (mm / u.toMM).toFixed(App.doc.precision + extraDigits);
}
export function fmtU(mm) { return fmt(mm) + ' ' + UNITS[App.doc.units].label; }
export function parseNum(str) {
  const v = parseFloat(str);
  return isNaN(v) ? null : v * UNITS[App.doc.units].toMM;
}
// dyn-input grammar: "50" len | "50<30" len+angle(deg, CCW visual = -rad in y-down) | "@dx,dy" rel | "#x,y" abs
export function parseCoordInput(str, anchor) {
  str = str.trim();
  let m;
  if ((m = str.match(/^#\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)$/)))
    return { p: { x: parseNum(m[1]), y: parseNum(m[2]) } };
  if ((m = str.match(/^@\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)$/)))
    return anchor ? { p: { x: anchor.x + parseNum(m[1]), y: anchor.y + parseNum(m[2]) } } : null;
  if ((m = str.match(/^(-?[\d.]+)\s*<\s*(-?[\d.]+)$/))) {
    const len = parseNum(m[1]), ang = -m[2] * Math.PI / 180;  // user angle CCW-visual
    return anchor ? { p: { x: anchor.x + len * Math.cos(ang), y: anchor.y + len * Math.sin(ang) }, len } : null;
  }
  if ((m = str.match(/^(-?[\d.]+)\s*[x,]\s*(-?[\d.]+)$/)))    // rect W x H helper
    return { wh: { w: parseNum(m[1]), h: parseNum(m[2]) } };
  if ((m = str.match(/^-?[\d.]+$/))) {
    const len = parseNum(str);
    return len !== null ? { len } : null;
  }
  return null;
}

// ---------------------------------------------------------------- snapping
const SNAP_APERTURE = 12;      // px
const SNAP_PRIORITY = { end: 0, int: 1, mid: 2, center: 3, node: 4, quad: 5, perp: 6, near: 8, grid: 9 };
export let lastSnap = null;    // {p, kind} for overlay glyph

export function snapPoint(raw, opts = {}) {
  lastSnap = null;
  let p = { x: raw.x, y: raw.y };
  const anchor = opts.anchor || null;
  const tolMM = SNAP_APERTURE / k();

  if (App.toggles.osnap && !opts.noOsnap) {
    const cands = [];
    const near = entitiesNear(raw, tolMM * 2).filter(e => !opts.exclude?.has(e.id));
    const m = App.osnapModes;
    for (const e of near) {
      if (e.type === 'dim' || e.type === 'text') continue;
      if (m.end || m.mid || m.center || m.quad || m.node) {
        for (const g of G.gripPoints(e)) {
          const kind = g.kind === 'vertex' ? 'end' : g.kind === 'radius' ? 'quad' : g.kind;
          const mode = kind === 'end' ? 'end' : kind === 'mid' ? 'mid' : kind === 'center' ? 'center' : 'quad';
          if (!m[mode]) continue;
          cands.push({ p: g.p, kind: mode });
        }
      }
      if (m.node && e.type === 'point') cands.push({ p: e.p, kind: 'node' });
      if (m.perp && anchor) {
        const cp = G.closestPointOnEntity(e, anchor);
        if (cp && G.dist(cp.p, raw) < tolMM) cands.push({ p: cp.p, kind: 'perp' });
      }
      if (m.near) {
        const cp = G.closestPointOnEntity(e, raw);
        if (cp) cands.push({ p: cp.p, kind: 'near' });
      }
    }
    if (m.int) {
      for (let i = 0; i < near.length; i++) for (let j = i + 1; j < near.length; j++) {
        if (near[i].type === 'dim' || near[j].type === 'dim') continue;
        for (const hit of G.intersectEntities(near[i], near[j]))
          cands.push({ p: hit.p, kind: 'int' });
      }
    }
    let best = null, bestScore = Infinity;
    for (const c of cands) {
      const d = G.dist(c.p, raw);
      if (d > tolMM) continue;
      const score = SNAP_PRIORITY[c.kind] * 1000 + d;
      if (score < bestScore) { bestScore = score; best = c; }
    }
    if (best) { lastSnap = best; return { ...best.p }; }
  }

  if (App.toggles.snap && !opts.noGrid) {
    const g = App.doc.gridStep;
    p = { x: Math.round(p.x / g) * g, y: Math.round(p.y / g) * g };
    lastSnap = { p, kind: 'grid' };
  }

  // ortho / polar projection relative to anchor (Shift inverts ortho)
  const orthoOn = App.toggles.ortho !== !!opts.shift;
  if (anchor && (orthoOn || App.toggles.polar)) {
    const dx = p.x - anchor.x, dy = p.y - anchor.y;
    const d = Math.hypot(dx, dy);
    if (d > 1e-9) {
      if (orthoOn) {
        p = Math.abs(dx) >= Math.abs(dy) ? { x: p.x, y: anchor.y } : { x: anchor.x, y: p.y };
      } else {
        const step = App.polarStep * Math.PI / 180;
        const ang = Math.round(Math.atan2(dy, dx) / step) * step;
        p = { x: anchor.x + d * Math.cos(ang), y: anchor.y + d * Math.sin(ang) };
      }
      if (lastSnap && lastSnap.kind !== 'grid') lastSnap = null;
    }
  }
  return p;
}

export function entitiesNear(p, tolMM) {
  const out = [];
  for (const e of visibleEntities()) {
    const b = entBoundsCached(e);
    if (p.x < b.minX - tolMM || p.x > b.maxX + tolMM || p.y < b.minY - tolMM || p.y > b.maxY + tolMM) continue;
    out.push(e);
  }
  return out;
}

// bounds cache is invalidated wholesale whenever the scene is marked dirty —
// entities are edited in place (Object.assign), so identity-keyed caching alone would go stale
let geomRev = 0;
const boundsCache = new WeakMap();
export function bumpGeomRev() { geomRev++; }
export function entBoundsCached(e) {
  const hit = boundsCache.get(e);
  if (hit && hit.rev === geomRev) return hit.b;
  const b = e.type === 'dim' ? dimBounds(e) : e.type === 'text' ? textBounds(e) : G.entBounds(e);
  boundsCache.set(e, { rev: geomRev, b });
  return b;
}

// ---------------------------------------------------------------- hit testing
export function hitTest(p, aperturePx = 8, list = null) {
  const tol = aperturePx / k();
  const ents = list || selectableEntities();
  let best = null, bestD = tol;
  for (let i = ents.length - 1; i >= 0; i--) {
    const e = ents[i];
    const b = entBoundsCached(e);
    if (p.x < b.minX - tol || p.x > b.maxX + tol || p.y < b.minY - tol || p.y > b.maxY + tol) continue;
    let d;
    if (e.type === 'text') d = pointInBox(p, b) ? 0 : Infinity;
    else if (e.type === 'dim') d = dimHit(e, p, tol);
    else {
      const cp = G.closestPointOnEntity(e, p);
      d = cp ? cp.d : Infinity;
    }
    if (d < bestD) { bestD = d; best = e; }
  }
  return best;
}
const pointInBox = (p, b) => p.x >= b.minX && p.x <= b.maxX && p.y >= b.minY && p.y <= b.maxY;

export function marqueeSelect(a, b, crossing) {
  const rect = { minX: Math.min(a.x, b.x), maxX: Math.max(a.x, b.x), minY: Math.min(a.y, b.y), maxY: Math.max(a.y, b.y) };
  const rectPts = [
    { x: rect.minX, y: rect.minY }, { x: rect.maxX, y: rect.minY },
    { x: rect.maxX, y: rect.maxY }, { x: rect.minX, y: rect.maxY }];
  const rectPoly = { type: 'poly', pts: rectPts, closed: true };
  const out = [];
  for (const e of selectableEntities()) {
    const eb = entBoundsCached(e);
    const inside = eb.minX >= rect.minX && eb.maxX <= rect.maxX && eb.minY >= rect.minY && eb.maxY <= rect.maxY;
    if (inside) { out.push(e); continue; }
    if (!crossing) continue;
    const overlap = eb.minX <= rect.maxX && eb.maxX >= rect.minX && eb.minY <= rect.maxY && eb.maxY >= rect.minY;
    if (!overlap) continue;
    if (e.type === 'text' || e.type === 'dim' || e.type === 'point') { out.push(e); continue; }
    if (G.intersectEntities(e, rectPoly).length) { out.push(e); continue; }
    const probe = e.type === 'circle' || e.type === 'arc' ? e.c : e.type === 'poly' ? e.pts[0] : e.a;
    if (probe && G.pointInPoly(probe, rectPts)) out.push(e);
  }
  return out;
}

// ---------------------------------------------------------------- dimensions
export function dimGeometry(e) {
  // returns {lines:[{a,b}], arrows:[{tip,dir}], texts:[{p,text,rot}], arcs?}
  const ds = App.doc.dimStyle;
  const out = { lines: [], arrows: [], texts: [] };
  if (e.kind === 'radial' || e.kind === 'diam') {
    const ang = Math.atan2(e.tp.y - e.c.y, e.tp.x - e.c.x);
    const on = { x: e.c.x + e.r * Math.cos(ang), y: e.c.y + e.r * Math.sin(ang) };
    const txt = (e.kind === 'diam' ? '⌀ ' : 'R ') + fmt(e.kind === 'diam' ? e.r * 2 : e.r);
    out.lines.push({ a: e.kind === 'diam' ? { x: e.c.x - e.r * Math.cos(ang), y: e.c.y - e.r * Math.sin(ang) } : e.c, b: e.tp });
    out.arrows.push({ tip: on, dir: ang });
    out.texts.push({ p: e.tp, text: txt, rot: 0 });
    return out;
  }
  // linear / aligned
  let dir;
  if (e.kind === 'linear-h') dir = { x: 1, y: 0 };
  else if (e.kind === 'linear-v') dir = { x: 0, y: 1 };
  else { const d = G.dist(e.p1, e.p2) || 1; dir = { x: (e.p2.x - e.p1.x) / d, y: (e.p2.y - e.p1.y) / d }; }
  const n = { x: -dir.y, y: dir.x };
  // each extension foot gets its own perpendicular offset (points need not be axis-aligned)
  const off1 = (e.tp.x - e.p1.x) * n.x + (e.tp.y - e.p1.y) * n.y;
  const off2 = (e.tp.x - e.p2.x) * n.x + (e.tp.y - e.p2.y) * n.y;
  const q1 = { x: e.p1.x + n.x * off1, y: e.p1.y + n.y * off1 };
  const q2 = { x: e.p2.x + n.x * off2, y: e.p2.y + n.y * off2 };
  const len = Math.abs((e.p2.x - e.p1.x) * dir.x + (e.p2.y - e.p1.y) * dir.y);
  const sgn = off1 >= 0 ? 1 : -1;
  const ext = (from, to, s) => ({
    a: { x: from.x + n.x * s * ds.extOff, y: from.y + n.y * s * ds.extOff },
    b: { x: to.x + n.x * s * ds.extOver, y: to.y + n.y * s * ds.extOver },
  });
  out.lines.push(
    ext(e.p1, q1, off1 >= 0 ? 1 : -1),
    ext(e.p2, q2, off2 >= 0 ? 1 : -1),
    { a: q1, b: q2 });
  const dimAng = Math.atan2(q2.y - q1.y, q2.x - q1.x);
  out.arrows.push({ tip: q1, dir: dimAng }, { tip: q2, dir: dimAng + Math.PI });
  const mid = { x: (q1.x + q2.x) / 2 + n.x * sgn * ds.textH * 0.8, y: (q1.y + q2.y) / 2 + n.y * sgn * ds.textH * 0.8 };
  let trot = dimAng;
  if (trot > Math.PI / 2 || trot < -Math.PI / 2) trot += Math.PI;
  out.texts.push({ p: mid, text: fmt(len), rot: trot });
  return out;
}
function dimBounds(e) {
  const g = dimGeometry(e);
  let minX = 1e15, minY = 1e15, maxX = -1e15, maxY = -1e15;
  const eat = p => { minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x); minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y); };
  g.lines.forEach(l => { eat(l.a); eat(l.b); });
  g.texts.forEach(t => eat(t.p));
  return { minX, minY, maxX, maxY };
}
function dimHit(e, p, tol) {
  const g = dimGeometry(e);
  let best = Infinity;
  for (const l of g.lines) {
    const d = G.closestPointOnEntity({ type: 'line', a: l.a, b: l.b }, p).d;
    if (d < best) best = d;
  }
  for (const t of g.texts) if (G.dist(t.p, p) < e.h || G.dist(t.p, p) < tol * 2) best = 0;
  return best;
}
function textBounds(e) {
  const w = e.text.length * e.h * 0.62, h = e.h;
  return { minX: e.p.x, minY: e.p.y - h, maxX: e.p.x + w, maxY: e.p.y + h * 0.25 };
}

// decompose dim entities into primitive entities (for export)
export function decomposeForExport(entities) {
  const out = [];
  const ds = App.doc.dimStyle;
  for (const e of entities) {
    if (e.type !== 'dim') { out.push(e); continue; }
    const g = dimGeometry(e);
    for (const l of g.lines) out.push({ id: newId(), type: 'line', a: l.a, b: l.b, layer: e.layer });
    for (const a of g.arrows) {
      const s = ds.arrow;
      const p1 = { x: a.tip.x + s * Math.cos(a.dir + 0.42) , y: a.tip.y + s * Math.sin(a.dir + 0.42) };
      const p2 = { x: a.tip.x + s * Math.cos(a.dir - 0.42), y: a.tip.y + s * Math.sin(a.dir - 0.42) };
      out.push({ id: newId(), type: 'poly', pts: [{ ...a.tip }, p1, p2], closed: true, layer: e.layer });
    }
    for (const t of g.texts)
      out.push({ id: newId(), type: 'text', p: t.p, text: t.text, h: ds.textH, rot: t.rot, layer: e.layer });
  }
  return out;
}

// ---------------------------------------------------------------- rendering
export function initCanvases(els) {
  ({ cvGrid, cvScene, cvOverlay, rulX, rulY, stackEl } = els);
  ctxG = cvGrid.getContext('2d'); ctxS = cvScene.getContext('2d'); ctxO = cvOverlay.getContext('2d');
  ctxRX = rulX.getContext('2d'); ctxRY = rulY.getContext('2d');
  new ResizeObserver(resizeAll).observe(stackEl);
  resizeAll();
}
function resizeAll() {
  const dpr = devicePixelRatio || 1;
  const w = stackEl.clientWidth, h = stackEl.clientHeight;
  for (const [cv, cx] of [[cvGrid, ctxG], [cvScene, ctxS], [cvOverlay, ctxO]]) {
    cv.width = Math.max(1, w * dpr); cv.height = Math.max(1, h * dpr);
    cx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  rulX.width = rulX.clientWidth * dpr; rulX.height = 20 * dpr; ctxRX.setTransform(dpr, 0, 0, dpr, 0, 0);
  rulY.width = 20 * dpr; rulY.height = rulY.clientHeight * dpr; ctxRY.setTransform(dpr, 0, 0, dpr, 0, 0);
  invalidate('all');
}
export function viewSize() { return { w: stackEl.clientWidth, h: stackEl.clientHeight }; }

export function invalidate(what) {
  if (what === 'all') dirtyFlags = { grid: true, scene: true, overlay: true, rulers: true };
  else dirtyFlags[what] = true;
  if (what === 'grid' || what === 'all') dirtyFlags.rulers = true;
  if (what === 'scene' || what === 'all') bumpGeomRev();
  if (!rafQueued) { rafQueued = true; requestAnimationFrame(renderFrame); }
}
export function invalidateView() { dirtyFlags.grid = dirtyFlags.scene = dirtyFlags.overlay = dirtyFlags.rulers = true; if (!rafQueued) { rafQueued = true; requestAnimationFrame(renderFrame); } }

function renderFrame() {
  rafQueued = false;
  if (dirtyFlags.grid) { drawGrid(); dirtyFlags.grid = false; }
  if (dirtyFlags.scene) { drawScene(); dirtyFlags.scene = false; }
  if (dirtyFlags.rulers) { drawRulers(); dirtyFlags.rulers = false; }
  if (dirtyFlags.overlay) { drawOverlay(); dirtyFlags.overlay = false; }
  App.ui.updateZoomChip?.();
}

const css = name => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
let PAL = null;
export function palette() {
  if (!PAL) PAL = {
    canvas: css('--bg-canvas'), gridMinor: css('--grid-minor'), gridMajor: css('--grid-major'),
    sel: css('--selection'), snap: css('--snap-marker'), dim: css('--dimension'),
    accent: css('--accent'), cross: css('--crosshair'), danger: css('--danger'),
    marqueeC: css('--marquee-cross'), text2: css('--text-secondary'), panel: css('--bg-panel'),
    hairline: css('--stroke-hairline'),
  };
  return PAL;
}

function gridSpacing() {
  // 1/2/5 stepping targeting >= 9px minor spacing
  let g = App.doc.gridStep;
  const seq = [1, 2, 5];
  let base = g, mult = 1;
  while (base * mult * k() < 9) mult *= 10;
  if (mult > 1) return base * mult;
  return g;
}

let underlayImg = null;
export function setUnderlay(u, img) { mutate(u ? 'Image updated' : 'Image removed', () => { App.doc.underlay = u; }); underlayImg = img || null; invalidate('grid'); }
export function getUnderlayImg() { return underlayImg; }
export async function reloadUnderlayImg() {
  if (!App.doc.underlay) { underlayImg = null; return; }
  underlayImg = new Image();
  await new Promise(res => { underlayImg.onload = res; underlayImg.onerror = res; underlayImg.src = App.doc.underlay.dataURL; });
  invalidate('grid');
}

function drawGrid() {
  const P = palette();
  const { w, h } = viewSize();
  ctxG.fillStyle = P.canvas;
  ctxG.fillRect(0, 0, w, h);

  const u = App.doc.underlay;
  if (u && u.visible && underlayImg && underlayImg.complete && underlayImg.naturalWidth) {
    const s = toScreen({ x: u.x, y: u.y });
    ctxG.globalAlpha = u.opacity;
    ctxG.save(); ctxG.translate(s.x, s.y); ctxG.rotate(u.rotation || 0);
    ctxG.drawImage(underlayImg, 0, 0, u.wMM * k(), u.hMM * k()); ctxG.restore();
    ctxG.globalAlpha = 1;
  }

  if (App.toggles.grid) {
    const g = gridSpacing();
    const x0 = Math.floor(App.view.x / g) * g, y0 = Math.floor(App.view.y / g) * g;
    // minor = dots, major (every 10) = lines
    ctxG.fillStyle = '#2A3242';
    const step = g * k();
    if (step >= 5) {
      for (let x = x0; (x - App.view.x) * k() < w; x += g) {
        const sx = (x - App.view.x) * k();
        for (let y = y0; (y - App.view.y) * k() < h; y += g)
          ctxG.fillRect(sx - .5, (y - App.view.y) * k() - .5, 1, 1);
      }
    }
    ctxG.strokeStyle = P.gridMajor; ctxG.lineWidth = 1;
    ctxG.beginPath();
    const G10 = g * 10;
    const gx0 = Math.floor(App.view.x / G10) * G10, gy0 = Math.floor(App.view.y / G10) * G10;
    for (let x = gx0; (x - App.view.x) * k() < w; x += G10) { const sx = Math.round((x - App.view.x) * k()) + .5; ctxG.moveTo(sx, 0); ctxG.lineTo(sx, h); }
    for (let y = gy0; (y - App.view.y) * k() < h; y += G10) { const sy = Math.round((y - App.view.y) * k()) + .5; ctxG.moveTo(0, sy); ctxG.lineTo(w, sy); }
    ctxG.stroke();
  }
  // origin axis cross
  const o = toScreen({ x: 0, y: 0 });
  ctxG.lineWidth = 1.5;
  ctxG.strokeStyle = '#B33'; ctxG.beginPath(); ctxG.moveTo(o.x, o.y); ctxG.lineTo(o.x + 14, o.y); ctxG.stroke();
  ctxG.strokeStyle = '#3A3'; ctxG.beginPath(); ctxG.moveTo(o.x, o.y); ctxG.lineTo(o.x, o.y - 14); ctxG.stroke();
  ctxG.strokeStyle = P.gridMajor;
}

const LTYPES = { continuous: [], dashed: [4, 2], hidden: [2, 2], center: [8, 2, 2, 2], dashdot: [6, 2, 1.5, 2] };

export function strokeEntityPath(cx, e) {
  cx.beginPath();
  if (e.type === 'line') { const a = toScreen(e.a), b = toScreen(e.b); cx.moveTo(a.x, a.y); cx.lineTo(b.x, b.y); }
  else if (e.type === 'circle') { const c = toScreen(e.c); cx.arc(c.x, c.y, e.r * k(), 0, G.TAU); }
  else if (e.type === 'arc') { const c = toScreen(e.c); cx.arc(c.x, c.y, e.r * k(), e.a0, e.a0 + G.sweep(e.a0, e.a1)); }
  else if (e.type === 'poly') {
    const n = e.pts.length;
    const first = toScreen(e.pts[0]);
    cx.moveTo(first.x, first.y);
    const segCount = e.closed ? n : n - 1;
    for (let i = 0; i < segCount; i++) {
      const p1 = e.pts[i], p2 = e.pts[(i + 1) % n];
      const b = p1.bulge || 0;
      const s2 = toScreen(p2);
      if (!b) cx.lineTo(s2.x, s2.y);
      else {
        const arc = G.bulgeToArc(p1, p2, b);
        const cc = toScreen(arc.c);
        const sw = G.sweep(arc.a0, arc.a1);
        // determine drawing direction: path must run p1 -> p2
        const angP1 = Math.atan2(p1.y - arc.c.y, p1.x - arc.c.x);
        const fwd = Math.abs(Math.cos(angP1) - Math.cos(arc.a0)) < 1e-6 && Math.abs(Math.sin(angP1) - Math.sin(arc.a0)) < 1e-6;
        if (fwd) cx.arc(cc.x, cc.y, arc.r * k(), arc.a0, arc.a0 + sw);
        else cx.arc(cc.x, cc.y, arc.r * k(), arc.a1, arc.a1 - sw, true);
      }
    }
    if (e.closed) cx.closePath();
  }
}

function drawEntity(cx, e, colorOverride, dashOverride) {
  const layer = layerOf(e);
  const color = colorOverride || layer.color;
  const P = palette();
  if (e.type === 'point') {
    const s = toScreen(e.p);
    cx.strokeStyle = color; cx.lineWidth = 1.2; cx.setLineDash([]);
    cx.beginPath();
    cx.moveTo(s.x - 5, s.y); cx.lineTo(s.x + 5, s.y);
    cx.moveTo(s.x, s.y - 5); cx.lineTo(s.x, s.y + 5);
    cx.stroke();
    cx.beginPath(); cx.arc(s.x, s.y, 2, 0, G.TAU); cx.fillStyle = color; cx.fill();
    return;
  }
  if (e.type === 'text') {
    const s = toScreen(e.p);
    cx.save();
    cx.translate(s.x, s.y); cx.rotate(e.rot || 0);
    cx.font = `${Math.max(2, e.h * k())}px 'IBM Plex Mono'`;
    cx.fillStyle = color;
    cx.fillText(e.text, 0, 0);
    cx.restore();
    return;
  }
  if (e.type === 'dim') {
    drawDim(cx, e, colorOverride || P.dim, dashOverride);
    return;
  }
  cx.strokeStyle = color;
  cx.lineWidth = 1.6;
  const lt = LTYPES[layer.ltype] || [];
  cx.setLineDash(dashOverride || lt.map(v => v * Math.max(2, k() * 0.6)));
  strokeEntityPath(cx, e);
  cx.stroke();
  cx.setLineDash([]);
}

function drawDim(cx, e, color, dashOverride) {
  const g = dimGeometry(e);
  const ds = App.doc.dimStyle;
  cx.strokeStyle = color; cx.fillStyle = color;
  cx.lineWidth = 1.1;
  cx.setLineDash(dashOverride || []);
  cx.beginPath();
  for (const l of g.lines) { const a = toScreen(l.a), b = toScreen(l.b); cx.moveTo(a.x, a.y); cx.lineTo(b.x, b.y); }
  cx.stroke();
  for (const a of g.arrows) {
    const t = toScreen(a.tip);
    const s = ds.arrow * k();
    cx.beginPath();
    cx.moveTo(t.x, t.y);
    cx.lineTo(t.x + s * Math.cos(a.dir + 0.42), t.y + s * Math.sin(a.dir + 0.42));
    cx.lineTo(t.x + s * Math.cos(a.dir - 0.42), t.y + s * Math.sin(a.dir - 0.42));
    cx.closePath(); cx.fill();
  }
  for (const t of g.texts) {
    const s = toScreen(t.p);
    cx.save();
    cx.translate(s.x, s.y); cx.rotate(t.rot || 0);
    cx.font = `${Math.max(3, ds.textH * k())}px 'IBM Plex Mono'`;
    cx.textAlign = 'center';
    cx.fillText(t.text, 0, -2);
    cx.restore();
  }
  cx.setLineDash([]);
}

function drawScene() {
  const P = palette();
  const { w, h } = viewSize();
  ctxS.clearRect(0, 0, w, h);
  const view = { minX: App.view.x - 5, minY: App.view.y - 5, maxX: App.view.x + w / k() + 5, maxY: App.view.y + h / k() + 5 };
  for (const e of visibleEntities()) {
    const b = entBoundsCached(e);
    if (b.maxX < view.minX || b.minX > view.maxX || b.maxY < view.minY || b.minY > view.maxY) continue;
    const sel = App.selection.has(e.id);
    if (sel) drawEntity(ctxS, e, P.sel, [4, 4]);
    else drawEntity(ctxS, e);
  }
}

// overlay renderer — tools contribute via App.tool.preview(ctx); app draws snap glyph, grips, crosshair
export let cursorScreen = null;   // set by input handler {x,y} in stack px
export function setCursorScreen(p) { cursorScreen = p; }

function drawOverlay() {
  const P = palette();
  const { w, h } = viewSize();
  ctxO.clearRect(0, 0, w, h);

  // grips for selection
  if (App.selection.size && App.selection.size <= 40 && (!App.tool || App.tool.id === 'select')) {
    for (const id of App.selection) {
      const e = App.doc.entities.find(en => en.id === id);
      if (!e || e.type === 'dim') continue;
      const grips = e.type === 'text' ? [{ p: e.p, kind: 'end' }] : G.gripPoints(e);
      for (const g of grips) {
        const s = toScreen(g.p);
        if (g.kind === 'mid' || g.kind === 'center') {
          ctxO.strokeStyle = P.sel; ctxO.lineWidth = 1.4;
          ctxO.strokeRect(s.x - 3, s.y - 3, 6, 6);
        } else {
          ctxO.fillStyle = P.sel;
          ctxO.strokeStyle = P.canvas;
          ctxO.fillRect(s.x - 4, s.y - 4, 8, 8);
          ctxO.strokeRect(s.x - 4, s.y - 4, 8, 8);
        }
      }
    }
  }

  // active tool preview
  if (App.tool?.preview) App.tool.preview(ctxO);

  // snap glyph
  if (lastSnap && lastSnap.kind !== 'grid') {
    const s = toScreen(lastSnap.p);
    ctxO.strokeStyle = P.snap; ctxO.lineWidth = 1.6;
    ctxO.beginPath();
    switch (lastSnap.kind) {
      case 'end': ctxO.rect(s.x - 5, s.y - 5, 10, 10); break;
      case 'mid': ctxO.moveTo(s.x, s.y - 6); ctxO.lineTo(s.x - 6, s.y + 5); ctxO.lineTo(s.x + 6, s.y + 5); ctxO.closePath(); break;
      case 'center': ctxO.arc(s.x, s.y, 6, 0, G.TAU); break;
      case 'int': ctxO.moveTo(s.x - 5, s.y - 5); ctxO.lineTo(s.x + 5, s.y + 5); ctxO.moveTo(s.x + 5, s.y - 5); ctxO.lineTo(s.x - 5, s.y + 5); break;
      case 'perp': ctxO.moveTo(s.x - 5, s.y + 5); ctxO.lineTo(s.x - 5, s.y - 1); ctxO.moveTo(s.x - 5, s.y + 5); ctxO.lineTo(s.x + 1, s.y + 5); ctxO.rect(s.x - 5, s.y - 5, 10, 10); break;
      case 'quad': ctxO.moveTo(s.x, s.y - 6); ctxO.lineTo(s.x + 6, s.y); ctxO.lineTo(s.x, s.y + 6); ctxO.lineTo(s.x - 6, s.y); ctxO.closePath(); break;
      case 'node': ctxO.arc(s.x, s.y, 4, 0, G.TAU); ctxO.moveTo(s.x - 6, s.y - 6); ctxO.lineTo(s.x + 6, s.y + 6); break;
      default: ctxO.arc(s.x, s.y, 5, 0, G.TAU);
    }
    ctxO.stroke();
    ctxO.font = `10px 'IBM Plex Mono'`;
    ctxO.fillStyle = P.snap;
    ctxO.fillText(lastSnap.kind, s.x + 10, s.y - 8);
  }

  // crosshair
  if (cursorScreen) {
    ctxO.strokeStyle = P.cross;
    ctxO.globalAlpha = 0.35;
    ctxO.lineWidth = 1;
    ctxO.beginPath();
    ctxO.moveTo(cursorScreen.x + .5, 0); ctxO.lineTo(cursorScreen.x + .5, h);
    ctxO.moveTo(0, cursorScreen.y + .5); ctxO.lineTo(w, cursorScreen.y + .5);
    ctxO.stroke();
    ctxO.globalAlpha = 1;
    if (App.tool?.id === 'select') {
      ctxO.strokeStyle = P.cross;
      ctxO.strokeRect(cursorScreen.x - 3.5, cursorScreen.y - 3.5, 7, 7);
    }
  }
}

function drawRulers() {
  const P = palette();
  const wx = rulX.clientWidth, wy = rulY.clientHeight;
  ctxRX.fillStyle = P.panel; ctxRX.fillRect(0, 0, wx, 20);
  ctxRY.fillStyle = P.panel; ctxRY.fillRect(0, 0, 20, wy);
  ctxRX.strokeStyle = P.hairline; ctxRX.beginPath(); ctxRX.moveTo(0, 19.5); ctxRX.lineTo(wx, 19.5); ctxRX.stroke();
  ctxRY.strokeStyle = P.hairline; ctxRY.beginPath(); ctxRY.moveTo(19.5, 0); ctxRY.lineTo(19.5, wy); ctxRY.stroke();
  const u = UNITS[App.doc.units];
  // pick tick step in display units: 1/2/5 so that >= 55px apart
  let stepU = 1e-4;
  while (stepU * u.toMM * k() < 55) {
    const m = stepU / Math.pow(10, Math.floor(Math.log10(stepU)));
    stepU *= m < 2 ? 2 : m < 5 ? 2.5 : 2;
  }
  const stepMM = stepU * u.toMM;
  ctxRX.fillStyle = P.text2; ctxRX.strokeStyle = P.text2; ctxRX.font = `9px 'IBM Plex Mono'`;
  ctxRY.fillStyle = P.text2; ctxRY.strokeStyle = P.text2; ctxRY.font = `9px 'IBM Plex Mono'`;
  const x0 = Math.floor(App.view.x / stepMM) * stepMM;
  for (let x = x0; (x - App.view.x) * k() < wx; x += stepMM) {
    const sx = (x - App.view.x) * k();
    ctxRX.beginPath(); ctxRX.moveTo(sx + .5, 12); ctxRX.lineTo(sx + .5, 20); ctxRX.stroke();
    ctxRX.fillText(trimZeros((x / u.toMM).toFixed(2)), sx + 3, 10);
    const sub = stepMM / 5;
    for (let i = 1; i < 5; i++) {
      const sxx = (x + sub * i - App.view.x) * k();
      ctxRX.beginPath(); ctxRX.moveTo(sxx + .5, 16); ctxRX.lineTo(sxx + .5, 20); ctxRX.stroke();
    }
  }
  const y0 = Math.floor(App.view.y / stepMM) * stepMM;
  for (let y = y0; (y - App.view.y) * k() < wy; y += stepMM) {
    const sy = (y - App.view.y) * k();
    ctxRY.beginPath(); ctxRY.moveTo(12, sy + .5); ctxRY.lineTo(20, sy + .5); ctxRY.stroke();
    ctxRY.save();
    ctxRY.translate(9, sy + 3); ctxRY.rotate(-Math.PI / 2);
    ctxRY.fillText(trimZeros((y / u.toMM).toFixed(2)), -ctxRY.measureText('0').width * 0, 0);
    ctxRY.restore();
    const sub = stepMM / 5;
    for (let i = 1; i < 5; i++) {
      const syy = (y + sub * i - App.view.y) * k();
      ctxRY.beginPath(); ctxRY.moveTo(16, syy + .5); ctxRY.lineTo(20, syy + .5); ctxRY.stroke();
    }
  }
  // cursor markers
  if (cursorScreen) {
    ctxRX.fillStyle = P.accent; ctxRX.fillRect(cursorScreen.x, 14, 1.5, 6);
    ctxRY.fillStyle = P.accent; ctxRY.fillRect(14, cursorScreen.y, 6, 1.5);
  }
}
const trimZeros = s => s.replace(/\.?0+$/, '');

// ---------------------------------------------------------------- view ops
export function zoomAt(stackX, stackY, factor) {
  const w = toWorld(stackX, stackY);
  App.view.z = Math.min(400, Math.max(0.005, App.view.z * factor));
  App.view.x = w.x - stackX / k();
  App.view.y = w.y - stackY / k();
  invalidateView();
}
export function drawingBounds(entities = null) {
  const list = entities || visibleEntities();
  if (!list.length) return null;
  let minX = 1e15, minY = 1e15, maxX = -1e15, maxY = -1e15;
  for (const e of list) {
    const b = entBoundsCached(e);
    minX = Math.min(minX, b.minX); maxX = Math.max(maxX, b.maxX);
    minY = Math.min(minY, b.minY); maxY = Math.max(maxY, b.maxY);
  }
  return { minX, minY, maxX, maxY };
}
export function zoomFit(entities = null) {
  const b = drawingBounds(entities);
  const { w, h } = viewSize();
  if (!b) { App.view = { x: -w / k() / 2 * 0.2, y: -h / k() / 2 * 0.2, z: 1 }; invalidateView(); return; }
  const bw = Math.max(b.maxX - b.minX, 1), bh = Math.max(b.maxY - b.minY, 1);
  App.view.z = Math.min(400, Math.max(0.005, Math.min(w / (bw * App.CAL) * 0.85, h / (bh * App.CAL) * 0.85)));
  App.view.x = b.minX - (w / k() - bw) / 2;
  App.view.y = b.minY - (h / k() - bh) / 2;
  invalidateView();
}
export function zoomPhysical() {   // 1 mm on screen ~= 1 mm real (assumes 96dpi CSS)
  const { w, h } = viewSize();
  const c = toWorld(w / 2, h / 2);
  App.view.z = (96 / 25.4) / App.CAL;
  App.view.x = c.x - w / k() / 2; App.view.y = c.y - h / k() / 2;
  invalidateView();
}

// ---------------------------------------------------------------- selection ops
export function setSelection(ids) {
  App.selection = new Set(ids);
  invalidate('scene'); invalidate('overlay');
  App.ui.refreshProps?.();
}
export function selectedEntities() {
  return App.doc.entities.filter(e => App.selection.has(e.id));
}
export function deleteSelection() {
  if (!App.selection.size) return;
  mutate(`Deleted ${App.selection.size}`, () => {
    App.doc.entities = App.doc.entities.filter(e => !App.selection.has(e.id));
  });
  setSelection([]);
}
export function addEntity(e) {
  e.id = e.id || newId();
  e.layer = e.layer || App.doc.currentLayer;
  App.doc.entities.push(e);
  if (App.doc.section && !App.doc.section.existing && e.layer === App.doc.section.layer) App.doc.section.ids.push(e.id);
  return e;
}
export function replaceEntity(oldE, newEnts) {
  const i = App.doc.entities.indexOf(oldE);
  if (i < 0) return;
  // trim splits spread the target, so pieces beyond the first need fresh ids
  App.doc.entities.splice(i, 1, ...newEnts.map((e, k) => ({ ...e, id: (k === 0 && e.id) ? e.id : newId(), layer: e.layer || oldE.layer })));
}

// ---------------------------------------------------------------- persistence
let autosaveTimer = null;
let revisionClock = 0;
export function recoveryHistory() {
  try { return JSON.parse(localStorage.getItem('tl-history') || '[]'); } catch { return []; }
}
export async function flushAutosave() {
  clearTimeout(autosaveTimer);
  if (!App.doc) return;
  const json = JSON.stringify(App.doc), now = revisionClock = Math.max(Date.now(), revisionClock + 1), fileDirty = App.fileDirty;
  const revision = { at: now, name: App.doc.name, json, fileDirty };
  let fallback = false;
  try {
    try { localStorage.setItem('tl-doc', json); }
    catch { localStorage.removeItem('tl-history'); localStorage.setItem('tl-doc', json); }
    localStorage.setItem('tl-recovery-at', String(now));
    localStorage.setItem('tl-file-dirty', String(fileDirty));
    fallback = true;
  } catch {} // Photos may exceed localStorage's quota; IndexedDB remains primary.
  try {
    await writeRevision(revision);
    App.recoveryAt = now; App.ui.recoveryStatus?.();
  } catch {
    if (fallback) { App.recoveryAt = now; App.ui.recoveryStatus?.(); App.ui.toast?.('Recovery history unavailable; latest drawing backed up. Save a project file.', 6500); }
    else App.ui.toast?.('Recovery backup failed — save your project file now', 8000);
  }
}
export function scheduleAutosave() {
  clearTimeout(autosaveTimer);
  autosaveTimer = setTimeout(flushAutosave, 700);
}
export async function loadAutosaved() {
  let revision;
  try { revision = (await readRevisions())[0]; } catch {}
  const localAt = +localStorage.getItem('tl-recovery-at') || 0;
  try {
    if (revision && revision.at >= localAt) {
      const d = JSON.parse(revision.json);
      if (d.v === 3 && Array.isArray(d.entities) && d.layers?.length) {
        App.doc = d; App.fileDirty = revision.fileDirty !== false; App.recoveryAt = revision.at; return true;
      }
    }
    const d = JSON.parse(localStorage.getItem('tl-doc'));
    if (d && d.v === 3 && Array.isArray(d.entities) && Array.isArray(d.layers) && d.layers.length) {
      App.doc = d;
      App.fileDirty = localStorage.getItem('tl-file-dirty') !== 'false';
      App.recoveryAt = +localStorage.getItem('tl-recovery-at') || null;
      return true;
    }
  } catch {}
  return false;
}
export function projectJSON() { return JSON.stringify({ app: 'trueline', ...App.doc }, null, 1); }
export function loadProject(json) {
  const d = JSON.parse(json);
  if (!Array.isArray(d.entities) || !Array.isArray(d.layers) || !d.layers.length) throw new Error('not a TrueLine project');
  delete d.app;
  if (App.doc) flushAutosave();
  App.tool?.cancel?.(); pendingSnap = null;
  App.doc = { ...App.doc, ...d, v: 3, section: d.section || null, assemblies: d.assemblies || [], traceOpts: { tol: 0.8, cornerDeg: 40, axisSnapDeg: 2, close: true, mode: 'fit', preview: true, ...d.traceOpts } };
  App.fileDirty = false;
  App.ui.setDirty?.(false);
  scheduleAutosave();
  App.selection.clear();
  App.undoStack = []; App.redoStack = [];
  reloadUnderlayImg();
  invalidate('all');
  App.ui.refreshAll?.();
}

// ---------------------------------------------------------------- calibration
export function setCalibration(pxPerMM) {
  App.CAL = pxPerMM;
  App.calibrated = true;
  localStorage.setItem('tl-cal', pxPerMM);
  App.ui.updateCalChip?.();
  invalidateView();
}

// ---------------------------------------------------------------- tool switching
export function setTool(id, opts) {
  if (App.tool?.id === 'freehand' && App.tool.pending) { App.ui.toast?.('Accept or discard the trace preview before switching tools'); return; }
  const t = App.tools.get(id);
  if (!t) return;
  if (App.tool?.cancel) App.tool.cancel(true);
  if (App.tool?.group && App.tool.id !== 'select' && App.tool.id !== 'pan') App.lastToolId = App.tool.id;
  App.tool = t;
  t.activate?.(opts);
  App.ui.onToolChange?.(t);
  invalidate('overlay');
}
export function toolHint(html) { App.ui.hint?.(html); }
