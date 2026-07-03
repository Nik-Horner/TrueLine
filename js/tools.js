// TrueLine tools: every tool is a state machine registered into App.tools.
// main.js routes pointer/keyboard events here; app.js renders via tool.preview(ctx).
import {
  App, toScreen, toWorld, k, fmt, fmtU, parseNum,
  addEntity, replaceEntity, mutate, beginChange, commitChange, abortChange,
  setSelection, selectedEntities, deleteSelection,
  hitTest, marqueeSelect, invalidate, invalidateView, palette,
  strokeEntityPath, toolHint, setTool, newId, currentLayer, setCalibration,
  drawingBounds, zoomFit, setUnderlay, dimGeometry, visibleEntities,
} from './app.js';
import * as G from './geom.js';

const reg = t => App.tools.set(t.id, t);
const P = () => palette();

// ---------------------------------------------------------------- helpers
function ghost(cx, ent, color, dash) {
  cx.strokeStyle = color || P().sel;
  cx.lineWidth = 1.4;
  cx.setLineDash(dash || []);
  strokeEntityPath(cx, ent);
  cx.stroke();
  cx.setLineDash([]);
}
function ghostLine(cx, a, b, color, dash) { ghost(cx, { type: 'line', a, b }, color, dash); }
function label(cx, worldP, text, dyOff = -12) {
  const s = toScreen(worldP);
  cx.font = `11px 'IBM Plex Mono'`;
  const w = cx.measureText(text).width;
  cx.fillStyle = 'rgba(24,28,36,.92)';
  cx.fillRect(s.x + 12, s.y + dyOff - 11, w + 10, 16);
  cx.fillStyle = P().dim;
  cx.fillText(text, s.x + 17, s.y + dyOff);
}
const angDeg = (a, b) => {
  let d = -Math.atan2(b.y - a.y, b.x - a.x) * 180 / Math.PI;   // CCW-visual for humans
  if (d < 0) d += 360;
  return d;
};
function lineInfo(a, b) { return `${fmt(G.dist(a, b))}  ∠${angDeg(a, b).toFixed(1)}°`; }

// place a fresh entity honoring current layer
function commitEnt(ent, msg) {
  mutate(msg, () => addEntity(ent));
}

// pick an entity under cursor with hover highlight support
function pickable(p) { return hitTest(p, 8); }

// =================================================================
// SELECT
// =================================================================
reg({
  id: 'select', name: 'Select', icon: 'select', key: 'V', group: 'select',
  st: null,            // null | {mode:'maybe',start,ent} | {mode:'marquee',a,b} | {mode:'grip',...} | {mode:'drag',...}
  hover: null,
  activate() { this.st = null; this.hint(); },
  hint() {
    toolHint(`<b>SELECT</b>  click entity · drag L→R window · R→L crossing · Shift add · drag grip to edit`);
  },
  options() {
    const n = App.selection.size;
    return [
      { type: 'info', text: n ? `${n} selected` : 'nothing selected' },
      { type: 'btn', label: 'Select all', cb: () => setSelection(App.doc.entities.map(e => e.id)) },
      { type: 'btn', label: 'To layer…', cb: () => App.ui.moveSelectionToLayer?.() },
    ];
  },
  getAnchor() { return this.st?.mode === 'grip' ? this.st.other : null; },
  onDown(p, ev, raw) {
    // grip first (screen-space test)
    if (App.selection.size) {
      for (const e of selectedEntities()) {
        if (e.type === 'dim') continue;
        const grips = e.type === 'text' ? [{ p: e.p, kind: 'end', index: 0 }] : G.gripPoints(e);
        for (const g of grips) {
          const s = toScreen(g.p), c = toScreen(raw);
          if (Math.abs(s.x - c.x) <= 6 && Math.abs(s.y - c.y) <= 6) {
            beginChange();
            // anchor = opposite endpoint (copied — entity mutates in place during drag)
            const other = (e.type === 'line' && g.kind === 'end') ? { ...(g.index === 0 ? e.b : e.a) } : { ...g.p };
            this.st = { mode: 'grip', ent: e, grip: g, other };
            return;
          }
        }
      }
    }
    const ent = hitTest(raw, 8);
    if (ent) {
      if (ev.shiftKey) {
        const s = new Set(App.selection);
        s.has(ent.id) ? s.delete(ent.id) : s.add(ent.id);
        setSelection([...s]);
        this.st = null;
      } else {
        if (!App.selection.has(ent.id)) setSelection([ent.id]);
        this.st = { mode: 'maybe-drag', start: p, last: p };
      }
    } else {
      this.st = { mode: 'marquee', a: raw, b: raw, add: ev.shiftKey };
    }
    App.ui.refreshProps?.();
  },
  onMove(p, ev, raw) {
    if (!this.st) {
      const h = hitTest(raw, 8);
      if ((h?.id || null) !== App.hoverId) { App.hoverId = h?.id || null; invalidate('overlay'); }
      return;
    }
    if (this.st.mode === 'marquee') { this.st.b = raw; invalidate('overlay'); return; }
    if (this.st.mode === 'maybe-drag' || this.st.mode === 'drag') {
      if (this.st.mode === 'maybe-drag') {
        if (G.dist(this.st.start, p) * k() < 4) return;
        beginChange();
        this.st.mode = 'drag';
      }
      const dx = p.x - this.st.last.x, dy = p.y - this.st.last.y;
      for (const e of selectedEntities()) {
        const moved = G.translateEnt(e, dx, dy);
        Object.assign(e, moved);
      }
      this.st.last = p;
      invalidate('scene'); invalidate('overlay');
      return;
    }
    if (this.st.mode === 'grip') {
      const moved = G.setGrip(this.st.ent, this.st.grip, p);
      Object.assign(this.st.ent, moved);
      invalidate('scene'); invalidate('overlay');
    }
  },
  onUp(p, ev) {
    if (!this.st) return;
    if (this.st.mode === 'marquee') {
      const crossing = this.st.b.x < this.st.a.x;
      if (G.dist(this.st.a, this.st.b) * k() > 6) {
        const found = marqueeSelect(this.st.a, this.st.b, crossing).map(e => e.id);
        setSelection(this.st.add ? [...App.selection, ...found] : found);
      } else if (!this.st.add) setSelection([]);
    } else if (this.st.mode === 'drag') {
      commitChange(`Moved ${App.selection.size}`);
    } else if (this.st.mode === 'grip') {
      commitChange('Grip edit');
    }
    this.st = null;
    invalidate('overlay');
  },
  onKey(ev) {
    if (ev.key === 'Escape') { this.cancel(); setSelection([]); invalidate('overlay'); return true; }
  },
  snapExclude() {
    return this.st && ['grip', 'drag', 'maybe-drag'].includes(this.st.mode) ? App.selection : null;
  },
  cancel() { if (this.st?.mode === 'grip' || this.st?.mode === 'drag') abortChange(); this.st = null; },
  preview(cx) {
    if (App.hoverId && !this.st) {
      const e = App.doc.entities.find(en => en.id === App.hoverId);
      if (e && !App.selection.has(e.id) && e.type !== 'text' && e.type !== 'dim' && e.type !== 'point')
        ghost(cx, e, P().sel, [2, 3]);
    }
    if (this.st?.mode === 'marquee') {
      const a = toScreen(this.st.a), b = toScreen(this.st.b);
      const crossing = this.st.b.x < this.st.a.x;
      const col = crossing ? P().marqueeC : P().sel;
      cx.fillStyle = col + '18';
      cx.strokeStyle = col;
      cx.lineWidth = 1;
      cx.setLineDash(crossing ? [4, 3] : []);
      cx.fillRect(Math.min(a.x, b.x), Math.min(a.y, b.y), Math.abs(b.x - a.x), Math.abs(b.y - a.y));
      cx.strokeRect(Math.min(a.x, b.x) + .5, Math.min(a.y, b.y) + .5, Math.abs(b.x - a.x), Math.abs(b.y - a.y));
      cx.setLineDash([]);
    }
  },
});

// =================================================================
// PAN
// =================================================================
reg({
  id: 'pan', name: 'Pan', icon: 'pan', key: 'H', group: 'select',
  st: null,
  activate() { toolHint('<b>PAN</b>  drag to pan · wheel zoom'); },
  options() { return []; },
  onDown(p, ev, raw) { this.st = { sx: ev.clientX, sy: ev.clientY, vx: App.view.x, vy: App.view.y }; },
  onMove(p, ev) {
    if (!this.st) return;
    App.view.x = this.st.vx - (ev.clientX - this.st.sx) / k();
    App.view.y = this.st.vy - (ev.clientY - this.st.sy) / k();
    invalidateView();
  },
  onUp() { this.st = null; },
  cancel() { this.st = null; },
  preview() {},
});

// =================================================================
// two-click drafting base
// =================================================================
function twoPoint(spec) {
  return {
    a: null, cur: null, fresh: false,
    activate() { this.a = null; this.cur = null; this.hint(); },
    hint() { toolHint(`<b>${spec.title}</b>  ${this.a ? spec.hint2 : spec.hint1}`); },
    getAnchor() { return this.a; },
    onDown(p) {
      if (!this.a) { this.a = p; this.fresh = true; this.hint(); }
      else { this.finish(p); }
    },
    onMove(p) { this.cur = p; invalidate('overlay'); },
    onUp(p, ev, raw, travelledPx) {
      if (this.a && this.fresh) {
        this.fresh = false;
        if (travelledPx > 8) this.finish(p);
      }
    },
    onInput(parsed, str) { spec.onInput?.call(this, parsed, str); },
    finish(p) {
      if (this.a && spec.make.call(this, this.a, p)) {
        this.a = spec.chain ? p : null;
        this.hint();
      }
    },
    cancel() { this.a = null; this.cur = null; invalidate('overlay'); },
    onKey(ev) {
      if (ev.key === 'Escape' && this.a) { this.cancel(); this.hint(); return true; }
    },
    preview(cx) { if (this.a && this.cur) spec.preview.call(this, cx, this.a, this.cur); },
    ...spec.extra,
  };
}

// LINE (chained)
reg(Object.assign(twoPoint({
  title: 'LINE', chain: true,
  hint1: 'first point', hint2: 'next point · type length or 50<30 · Esc end',
  make(a, b) {
    if (G.dist(a, b) < 1e-6) return false;
    commitEnt({ type: 'line', a: { ...a }, b: { ...b } }, 'Line');
    return true;
  },
  preview(cx, a, b) { ghostLine(cx, a, b); label(cx, b, lineInfo(a, b)); },
  onInput(parsed) {
    if (!this.a) return;
    if (parsed.p) { this.finish(parsed.p); return; }
    if (parsed.len && this.cur) {
      const d = G.dist(this.a, this.cur) || 1;
      const b = { x: this.a.x + (this.cur.x - this.a.x) / d * parsed.len, y: this.a.y + (this.cur.y - this.a.y) / d * parsed.len };
      this.finish(b);
    }
  },
}), { id: 'line', name: 'Line', icon: 'line', key: 'L', group: 'draw' }));

// RECTANGLE
reg(Object.assign(twoPoint({
  title: 'RECT',
  hint1: 'first corner', hint2: 'opposite corner · type WxH',
  make(a, b) {
    if (Math.abs(a.x - b.x) < 1e-6 || Math.abs(a.y - b.y) < 1e-6) return false;
    commitEnt({ type: 'poly', closed: true, pts: [{ x: a.x, y: a.y }, { x: b.x, y: a.y }, { x: b.x, y: b.y }, { x: a.x, y: b.y }] }, 'Rectangle');
    return true;
  },
  preview(cx, a, b) {
    ghost(cx, { type: 'poly', closed: true, pts: [{ x: a.x, y: a.y }, { x: b.x, y: a.y }, { x: b.x, y: b.y }, { x: a.x, y: b.y }] });
    label(cx, b, `${fmt(Math.abs(b.x - a.x))} × ${fmt(Math.abs(b.y - a.y))}`);
  },
  onInput(parsed) {
    if (!this.a) return;
    if (parsed.wh) {
      const sx = this.cur && this.cur.x < this.a.x ? -1 : 1;
      const sy = this.cur && this.cur.y < this.a.y ? -1 : 1;
      this.finish({ x: this.a.x + sx * parsed.wh.w, y: this.a.y + sy * parsed.wh.h });
    } else if (parsed.p) this.finish(parsed.p);
  },
}), { id: 'rect', name: 'Rectangle', icon: 'rect', key: 'R', group: 'draw' }));

// =================================================================
// POLYLINE
// =================================================================
reg({
  id: 'polyline', name: 'Polyline', icon: 'polyline', key: 'P', group: 'draw',
  pts: null, cur: null,
  activate() { this.pts = null; this.hint(); },
  hint() { toolHint(`<b>PLINE</b>  ${this.pts ? 'next point · Enter finish · C close · double-click finish' : 'first point'}`); },
  getAnchor() { return this.pts ? this.pts[this.pts.length - 1] : null; },
  onDown(p) {
    if (!this.pts) this.pts = [{ ...p }];
    else if (G.dist(p, this.pts[this.pts.length - 1]) > 1e-6) this.pts.push({ ...p });
    this.hint();
    invalidate('overlay');
  },
  onDbl() { this.finish(false); },
  onMove(p) { this.cur = p; invalidate('overlay'); },
  onUp() {},
  onInput(parsed) {
    if (!this.pts) return;
    const last = this.pts[this.pts.length - 1];
    if (parsed.p) { this.pts.push(parsed.p); invalidate('overlay'); }
    else if (parsed.len && this.cur) {
      const d = G.dist(last, this.cur) || 1;
      this.pts.push({ x: last.x + (this.cur.x - last.x) / d * parsed.len, y: last.y + (this.cur.y - last.y) / d * parsed.len });
      invalidate('overlay');
    }
  },
  finish(close) {
    if (this.pts && this.pts.length > 1) {
      commitEnt({ type: 'poly', pts: this.pts, closed: !!close }, close ? 'Closed polyline' : 'Polyline');
    }
    this.pts = null; this.cur = null;
    this.hint();
    invalidate('overlay');
  },
  onKey(ev) {
    if (!this.pts) return;
    if (ev.key === 'Enter') { this.finish(false); return true; }
    if (ev.key.toLowerCase() === 'c' && this.pts.length > 2) { this.finish(true); return true; }
    if (ev.key === 'Escape') { this.pts = null; invalidate('overlay'); this.hint(); return true; }
  },
  cancel() { this.pts = null; this.cur = null; },
  preview(cx) {
    if (!this.pts) return;
    ghost(cx, { type: 'poly', pts: this.pts, closed: false });
    if (this.cur) {
      ghostLine(cx, this.pts[this.pts.length - 1], this.cur, P().sel, [4, 4]);
      label(cx, this.cur, lineInfo(this.pts[this.pts.length - 1], this.cur));
    }
  },
});

// =================================================================
// CIRCLE (center-r / 2pt / 3pt)
// =================================================================
reg({
  id: 'circle', name: 'Circle', icon: 'circle', key: 'C', group: 'draw',
  mode: 'cr', pts: [], cur: null,
  activate() { this.pts = []; this.hint(); },
  hint() {
    const t = { cr: ['center point', 'radius point · type radius'], '2p': ['first diameter point', 'second diameter point'], '3p': ['first point', 'second point', 'third point'] }[this.mode];
    toolHint(`<b>CIRCLE</b>  ${t[Math.min(this.pts.length, t.length - 1)]}`);
  },
  options() {
    return [{
      type: 'seg', options: [{ id: 'cr', label: 'Center·R' }, { id: '2p', label: '2-Pt' }, { id: '3p', label: '3-Pt' }],
      value: this.mode, onChange: v => { this.mode = v; this.pts = []; this.hint(); App.ui.refreshCtx?.(); },
    }];
  },
  getAnchor() { return this.pts[0] || null; },
  onDown(p) {
    this.pts.push({ ...p });
    const n = this.pts.length;
    if (this.mode === 'cr' && n === 2) this.make(this.pts[0], G.dist(this.pts[0], this.pts[1]));
    else if (this.mode === '2p' && n === 2) {
      const c = { x: (this.pts[0].x + this.pts[1].x) / 2, y: (this.pts[0].y + this.pts[1].y) / 2 };
      this.make(c, G.dist(this.pts[0], this.pts[1]) / 2);
    } else if (this.mode === '3p' && n === 3) {
      const r = G.circleFrom3(this.pts[0], this.pts[1], this.pts[2]);
      if (r) this.make(r.c, r.r); else { App.ui.msg?.('Points are collinear'); this.pts = []; }
    }
    this.hint();
  },
  onMove(p) { this.cur = p; invalidate('overlay'); },
  onUp() {},
  onInput(parsed) {
    if (this.mode === 'cr' && this.pts.length === 1 && parsed.len) this.make(this.pts[0], parsed.len);
  },
  make(c, r) {
    if (r > 1e-6) commitEnt({ type: 'circle', c: { ...c }, r }, 'Circle');
    this.pts = [];
    invalidate('overlay');
  },
  onKey(ev) { if (ev.key === 'Escape' && this.pts.length) { this.pts = []; invalidate('overlay'); this.hint(); return true; } },
  cancel() { this.pts = []; this.cur = null; },
  preview(cx) {
    if (!this.pts.length || !this.cur) return;
    if (this.mode === 'cr') {
      const r = G.dist(this.pts[0], this.cur);
      ghost(cx, { type: 'circle', c: this.pts[0], r });
      label(cx, this.cur, `R ${fmt(r)}  ⌀ ${fmt(2 * r)}`);
    } else if (this.mode === '2p') {
      const c = { x: (this.pts[0].x + this.cur.x) / 2, y: (this.pts[0].y + this.cur.y) / 2 };
      ghost(cx, { type: 'circle', c, r: G.dist(this.pts[0], this.cur) / 2 });
    } else if (this.mode === '3p') {
      if (this.pts.length === 1) ghostLine(cx, this.pts[0], this.cur, P().sel, [4, 4]);
      else {
        const r = G.circleFrom3(this.pts[0], this.pts[1], this.cur);
        if (r) { ghost(cx, { type: 'circle', c: r.c, r: r.r }); label(cx, this.cur, `R ${fmt(r.r)}`); }
      }
    }
  },
});

// =================================================================
// ARC (3pt / center-start-end)
// =================================================================
reg({
  id: 'arc', name: 'Arc', icon: 'arc', key: 'A', group: 'draw',
  mode: '3p', pts: [], cur: null,
  activate() { this.pts = []; this.hint(); },
  hint() {
    const t = this.mode === '3p'
      ? ['start point', 'point on arc', 'end point']
      : ['center point', 'start point', 'end point'];
    toolHint(`<b>ARC</b>  ${t[Math.min(this.pts.length, 2)]}`);
  },
  options() {
    return [{
      type: 'seg', options: [{ id: '3p', label: '3-Pt' }, { id: 'cse', label: 'Ctr·Start·End' }],
      value: this.mode, onChange: v => { this.mode = v; this.pts = []; this.hint(); App.ui.refreshCtx?.(); },
    }];
  },
  getAnchor() { return this.pts.length ? this.pts[this.pts.length - 1] : null; },
  onDown(p) {
    this.pts.push({ ...p });
    if (this.pts.length === 3) {
      let arc = null;
      if (this.mode === '3p') arc = G.arcFrom3(this.pts[0], this.pts[1], this.pts[2]);
      else arc = G.arcFromCenterStartEnd(this.pts[0], this.pts[1], this.pts[2], this.pts[2]);
      if (arc) commitEnt({ type: 'arc', c: arc.c, r: arc.r, a0: arc.a0, a1: arc.a1 }, 'Arc');
      else App.ui.msg?.('Cannot build arc from those points');
      this.pts = [];
      invalidate('overlay');
    }
    this.hint();
  },
  onMove(p) { this.cur = p; invalidate('overlay'); },
  onUp() {},
  onKey(ev) { if (ev.key === 'Escape' && this.pts.length) { this.pts = []; invalidate('overlay'); this.hint(); return true; } },
  cancel() { this.pts = []; this.cur = null; },
  preview(cx) {
    if (!this.pts.length || !this.cur) return;
    if (this.pts.length === 1) { ghostLine(cx, this.pts[0], this.cur, P().sel, [4, 4]); return; }
    let arc = this.mode === '3p'
      ? G.arcFrom3(this.pts[0], this.pts[1], this.cur)
      : G.arcFromCenterStartEnd(this.pts[0], this.pts[1], this.cur, this.cur);
    if (arc) { ghost(cx, { type: 'arc', ...arc }); label(cx, this.cur, `R ${fmt(arc.r)}`); }
  },
});

// POINT
reg({
  id: 'point', name: 'Point', icon: 'point', key: 'N', group: 'draw',
  activate() { toolHint('<b>POINT</b>  click to place a node'); },
  onDown(p) { commitEnt({ type: 'point', p: { ...p } }, 'Point'); },
  onMove() {}, onUp() {}, cancel() {}, preview() {},
});

// TEXT
reg({
  id: 'text', name: 'Text', icon: 'text', key: 'T', group: 'draw',
  h: 5,
  activate() { toolHint('<b>TEXT</b>  click to place text'); },
  options() {
    return [{ type: 'num', label: 'Height', value: this.h, unit: true, onChange: v => { this.h = v; } }];
  },
  onDown(p, ev, raw) {
    App.ui.textPrompt?.(toScreen(p), '', txt => {
      if (txt) commitEnt({ type: 'text', p: { ...p }, text: txt, h: this.h, rot: 0 }, 'Text');
    });
  },
  onMove() {}, onUp() {}, cancel() {}, preview() {},
});

// =================================================================
// FREEHAND TRACE
// =================================================================
reg({
  id: 'freehand', name: 'Trace', icon: 'freehand', key: 'S', group: 'draw',
  raw: null,
  activate() { toolHint('<b>TRACE</b>  draw with the pen — strokes are fitted to lines & arcs on release'); },
  options() {
    const o = App.doc.traceOpts;
    return [
      { type: 'seg', options: [{ id: 'fit', label: 'Fit lines+arcs' }, { id: 'raw', label: 'Raw polyline' }], value: o.mode, onChange: v => { o.mode = v; } },
      { type: 'num', label: 'Tolerance', value: o.tol, unit: true, step: 0.1, onChange: v => { o.tol = Math.max(0.05, v); } },
      { type: 'num', label: 'Corner °', value: o.cornerDeg, step: 5, onChange: v => { o.cornerDeg = Math.min(80, Math.max(15, v)); } },
      { type: 'check', label: 'Auto-close', value: o.close, onChange: v => { o.close = v; } },
    ];
  },
  onDown(p, ev, raw) { this.raw = [{ ...raw }]; },
  onMove(p, ev, raw, coalesced) {
    if (!this.raw) return;
    for (const c of coalesced || [raw]) this.raw.push({ ...c });
    invalidate('overlay');
  },
  onUp() {
    if (!this.raw || this.raw.length < 2) { this.raw = null; return; }
    const o = App.doc.traceOpts;
    const pts = this.raw; this.raw = null;
    let ents;
    if (o.mode === 'raw') {
      const simp = G.smoothStroke(pts, o.tol);
      const closed = o.close && simp.length > 2 && G.dist(simp[0], simp[simp.length - 1]) < o.tol * 6;
      ents = [{ type: 'poly', pts: closed ? simp.slice(0, -1).map(q => ({ ...q })) : simp.map(q => ({ ...q })), closed }];
    } else {
      ents = G.fitStroke(pts, { tol: o.tol, cornerDeg: o.cornerDeg, closeTol: o.tol * 6 });
      ents = axisSnapPass(ents, App.doc.traceOpts.axisSnapDeg || 2);
    }
    if (ents && ents.length) {
      mutate(`Traced → ${ents.length} ${ents.length > 1 ? 'entities' : 'entity'}`, () => {
        for (const e of ents) addEntity({ ...e, id: newId(), layer: App.doc.currentLayer });
      });
    }
    invalidate('overlay');
  },
  onKey(ev) { if (ev.key === 'Escape' && this.raw) { this.raw = null; invalidate('overlay'); return true; } },
  cancel() { this.raw = null; },
  preview(cx) {
    if (!this.raw || this.raw.length < 2) return;
    cx.strokeStyle = P().accent;
    cx.lineWidth = 1.4;
    cx.beginPath();
    const s0 = toScreen(this.raw[0]);
    cx.moveTo(s0.x, s0.y);
    for (let i = 1; i < this.raw.length; i++) { const s = toScreen(this.raw[i]); cx.lineTo(s.x, s.y); }
    cx.stroke();
  },
});

function axisSnapPass(ents, deg) {
  const tol = deg * Math.PI / 180;
  return ents.map(e => {
    if (e.type !== 'line') return e;
    const ang = Math.atan2(e.b.y - e.a.y, e.b.x - e.a.x);
    for (const target of [0, Math.PI / 2, Math.PI, -Math.PI / 2, -Math.PI]) {
      const d = ang - target;
      if (Math.abs(d) < tol) return G.rotateEnt(e, { x: (e.a.x + e.b.x) / 2, y: (e.a.y + e.b.y) / 2 }, -d);
    }
    return e;
  });
}

// =================================================================
// MOVE / COPY / ROTATE / SCALE / MIRROR (selection-based transforms)
// =================================================================
function xformTool(spec) {
  return {
    st: null,   // {phase, base, ...}
    activate() {
      this.st = App.selection.size ? { phase: 'base' } : { phase: 'pick' };
      this.hint();
    },
    hint() {
      const t = { pick: 'select entities (click / marquee), then click again to start', base: spec.baseHint, act: spec.actHint }[this.st?.phase || 'pick'];
      toolHint(`<b>${spec.title}</b>  ${t}`);
    },
    getAnchor() { return this.st?.base || null; },
    options() { return spec.options ? spec.options.call(this) : []; },
    onDown(p, ev, raw) {
      if (this.st.phase === 'pick') {
        const e = hitTest(raw, 8);
        if (e) { setSelection(ev.shiftKey ? [...App.selection, e.id] : [e.id]); this.st = { phase: 'base' }; }
        this.hint();
        return;
      }
      if (this.st.phase === 'base') {
        if (!App.selection.size) { this.st = { phase: 'pick' }; this.hint(); return; }
        this.st = { phase: 'act', base: p };
        this.hint();
        return;
      }
      spec.apply.call(this, this.st.base, p);
    },
    onMove(p) { this.cur = p; invalidate('overlay'); },
    onUp() {},
    onInput(parsed, str) { spec.onInput?.call(this, parsed, str); },
    onKey(ev) {
      if (ev.key === 'Escape' && this.st.phase !== 'pick') { this.st = { phase: App.selection.size ? 'base' : 'pick' }; invalidate('overlay'); this.hint(); return true; }
    },
    cancel() { this.st = { phase: 'pick' }; },
    preview(cx) {
      if (this.st?.phase !== 'act' || !this.cur) return;
      spec.preview.call(this, cx, this.st.base, this.cur);
    },
    ...spec.extra,
  };
}

function ghostTransformed(cx, fn) {
  for (const e of selectedEntities()) {
    if (e.type === 'dim' || e.type === 'text') continue;
    try { ghost(cx, fn(e), P().sel, [3, 3]); } catch (err) {}
  }
}

reg(Object.assign(xformTool({
  title: 'MOVE', baseHint: 'base point', actHint: 'destination point',
  apply(base, p) {
    const dx = p.x - base.x, dy = p.y - base.y;
    mutate(`Moved ${App.selection.size}`, () => {
      for (const e of selectedEntities()) Object.assign(e, G.translateEnt(e, dx, dy));
    });
    this.st = { phase: 'base' }; this.hint();
  },
  preview(cx, base, cur) {
    ghostLine(cx, base, cur, P().sel, [4, 4]);
    ghostTransformed(cx, e => G.translateEnt(e, cur.x - base.x, cur.y - base.y));
    label(cx, cur, lineInfo(base, cur));
  },
  onInput(parsed) {
    if (this.st.phase === 'act' && parsed.p) this.st.base && this.onDown(parsed.p);
    else if (this.st.phase === 'act' && parsed.len && this.cur) {
      const d = G.dist(this.st.base, this.cur) || 1;
      this.onDown({ x: this.st.base.x + (this.cur.x - this.st.base.x) / d * parsed.len, y: this.st.base.y + (this.cur.y - this.st.base.y) / d * parsed.len });
    }
  },
}), { id: 'move', name: 'Move', icon: 'move', key: 'M', group: 'modify' }));

reg(Object.assign(xformTool({
  title: 'COPY', baseHint: 'base point', actHint: 'destination (repeats · Esc to stop)',
  apply(base, p) {
    const dx = p.x - base.x, dy = p.y - base.y;
    mutate(`Copied ${App.selection.size}`, () => {
      for (const e of selectedEntities()) addEntity({ ...G.translateEnt(e, dx, dy), id: newId() });
    });
  },
  preview(cx, base, cur) {
    ghostLine(cx, base, cur, P().sel, [4, 4]);
    ghostTransformed(cx, e => G.translateEnt(e, cur.x - base.x, cur.y - base.y));
  },
}), { id: 'copy', name: 'Copy', icon: 'copy', key: 'Shift+C', group: 'modify' }));

reg(Object.assign(xformTool({
  title: 'ROTATE', baseHint: 'center of rotation', actHint: 'angle by click · or type degrees',
  copy: false,
  options() { return [{ type: 'check', label: 'Copy', value: this.copy, onChange: v => { this.copy = v; } }]; },
  apply(base, p) {
    // click semantics: rotate by the picked ray's angle from +x axis (CCW visual)
    const ang = Math.atan2(p.y - base.y, p.x - base.x);
    this.applyAng(base, ang);
    this.st = { phase: 'base' }; this.hint();
  },
  preview(cx, base, cur) {
    const ang = Math.atan2(cur.y - base.y, cur.x - base.x);
    ghostLine(cx, base, cur, P().sel, [4, 4]);
    ghostTransformed(cx, e => G.rotateEnt(e, base, ang));
    label(cx, cur, `∠ ${(-ang * 180 / Math.PI).toFixed(1)}°`);
  },
  onInput(parsed, str) {
    if (this.st.phase !== 'act') return;
    const deg = parseFloat(str);               // raw degrees, no unit conversion
    if (!isNaN(deg)) {
      this.applyAng(this.st.base, -deg * Math.PI / 180);
      this.st = { phase: 'base' }; this.hint();
    }
  },
  extra: {
    applyAng(base, ang) {
      mutate(this.copy ? 'Rotate-copied' : 'Rotated', () => {
        for (const e of selectedEntities()) {
          const r = G.rotateEnt(e, base, ang);
          this.copy ? addEntity({ ...r, id: newId() }) : Object.assign(e, r);
        }
      });
    },
  },
}), { id: 'rotate', name: 'Rotate', icon: 'rotate', key: 'Q', group: 'modify' }));

reg(Object.assign(xformTool({
  title: 'SCALE', baseHint: 'base point', actHint: 'factor by click distance · or type factor',
  copy: false, refMode: false, refLen: null,
  options() {
    return [
      { type: 'seg', options: [{ id: 'f', label: 'Factor' }, { id: 'r', label: 'Reference' }], value: this.refMode ? 'r' : 'f', onChange: v => { this.refMode = v === 'r'; this.refLen = null; } },
      { type: 'check', label: 'Copy', value: this.copy, onChange: v => { this.copy = v; } },
    ];
  },
  apply(base, p) {
    const d = G.dist(base, p);
    if (this.refMode) {
      if (this.refLen === null) { this.refLen = d; App.ui.msg?.(`Reference length: ${fmtU(d)} — now type the true length`); App.ui.summonDyn?.(); return; }
      return;
    }
    App.ui.msg?.('Type the scale factor and press Enter');
    App.ui.summonDyn?.();
  },
  preview(cx, base, cur) {
    ghostLine(cx, base, cur, P().sel, [4, 4]);
    label(cx, cur, this.refMode && this.refLen ? `ref ${fmt(this.refLen)} → type true length` : `type factor + Enter`);
  },
  onInput(parsed, str) {
    if (this.st.phase !== 'act') return;
    if (this.refMode && this.refLen && parsed.len) {          // true length: units apply
      this.applyF(this.st.base, parsed.len / this.refLen);
      this.refLen = null;
      this.st = { phase: 'base' }; this.hint();
    } else if (!this.refMode) {
      const f = parseFloat(str);                              // raw factor, no unit conversion
      if (f > 1e-9) { this.applyF(this.st.base, f); this.st = { phase: 'base' }; this.hint(); }
    }
  },
  extra: {
    applyF(base, f) {
      mutate(this.copy ? `Scale-copied ×${f.toFixed(4)}` : `Scaled ×${f.toFixed(4)}`, () => {
        for (const e of selectedEntities()) {
          const r = G.scaleEnt(e, base, f);
          this.copy ? addEntity({ ...r, id: newId() }) : Object.assign(e, r);
        }
      });
    },
  },
}), { id: 'scale', name: 'Scale', icon: 'scale', key: 'W', group: 'modify' }));

reg(Object.assign(xformTool({
  title: 'MIRROR', baseHint: 'first axis point', actHint: 'second axis point',
  keep: true,
  options() { return [{ type: 'check', label: 'Keep original', value: this.keep, onChange: v => { this.keep = v; } }]; },
  apply(base, p) {
    if (G.dist(base, p) < 1e-9) return;
    mutate('Mirrored', () => {
      for (const e of selectedEntities()) {
        const m = G.mirrorEnt(e, base, p);
        this.keep ? addEntity({ ...m, id: newId() }) : Object.assign(e, m);
      }
    });
    this.st = { phase: 'base' }; this.hint();
  },
  preview(cx, base, cur) {
    ghostLine(cx, base, cur, P().dim, [8, 4]);
    ghostTransformed(cx, e => G.mirrorEnt(e, base, cur));
  },
}), { id: 'mirror', name: 'Mirror', icon: 'mirror', key: 'Shift+M', group: 'modify' }));

// =================================================================
// TRIM / EXTEND / OFFSET / FILLET / CHAMFER
// =================================================================
reg({
  id: 'trim', name: 'Trim', icon: 'trim', key: 'X', group: 'modify',
  hoverCut: null,
  activate() { this.hoverCut = null; toolHint('<b>TRIM</b>  click the part of an entity to remove (cut at nearest intersections)'); },
  onDown(p, ev, raw) {
    const target = hitTest(raw, 8);
    if (!target || target.type === 'dim' || target.type === 'text' || target.type === 'point') return;
    const cutters = visibleEntities().filter(e => e !== target && e.type !== 'dim' && e.type !== 'text' && e.type !== 'point');
    const res = G.trimEntity(target, cutters, raw);
    if (res === null) { App.ui.msg?.('No intersection to trim against'); return; }
    mutate('Trimmed', () => replaceEntity(target, res));
    this.hoverCut = null;
  },
  onMove(p, ev, raw) {
    const t = hitTest(raw, 8);
    this.hoverCut = t && t.type !== 'dim' && t.type !== 'text' && t.type !== 'point' ? { ent: t, at: p } : null;
    invalidate('overlay');
  },
  onUp() {}, cancel() { this.hoverCut = null; },
  preview(cx) {
    if (this.hoverCut) ghost(cx, this.hoverCut.ent, P().danger, [3, 3]);
  },
});

reg({
  id: 'extend', name: 'Extend', icon: 'extend', key: 'Shift+X', group: 'modify',
  activate() { toolHint('<b>EXTEND</b>  click near the end of an entity to extend it to the next boundary'); },
  onDown(p, ev, raw) {
    const target = hitTest(raw, 8);
    if (!target || (target.type !== 'line' && target.type !== 'arc')) { if (target) App.ui.msg?.('Extend works on lines and arcs'); return; }
    const bounds = visibleEntities().filter(e => e !== target && e.type !== 'dim' && e.type !== 'text' && e.type !== 'point');
    const res = G.extendEntity(target, bounds, raw);
    if (!res) { App.ui.msg?.('Nothing to extend to'); return; }
    mutate('Extended', () => replaceEntity(target, [res]));
  },
  onMove() {}, onUp() {}, cancel() {}, preview() {},
});

reg({
  id: 'offset', name: 'Offset', icon: 'offset', key: 'O', group: 'modify',
  d: 5, target: null, cur: null,
  activate() { this.target = null; this.hint(); },
  hint() { toolHint(`<b>OFFSET</b>  ${this.target ? 'click the side to offset toward' : 'click entity to offset · set distance in the strip'}`); },
  options() {
    return [{ type: 'num', label: 'Distance', value: this.d, unit: true, step: 0.5, onChange: v => { this.d = Math.abs(v) || 1; } }];
  },
  onDown(p, ev, raw) {
    if (!this.target) {
      const t = hitTest(raw, 8);
      if (t && (t.type === 'line' || t.type === 'arc' || t.type === 'circle' || t.type === 'poly')) { this.target = t; this.hint(); }
      return;
    }
    const off = G.offsetPolyTowards(this.target, raw, this.d);
    if (off) mutate(`Offset ${fmtU(this.d)}`, () => addEntity({ ...off, id: newId() }));
    else App.ui.msg?.('Offset failed (degenerate result)');
    this.target = null;
    this.hint();
  },
  onMove(p, ev, raw) { this.cur = raw; if (this.target) invalidate('overlay'); },
  onUp() {},
  onKey(ev) { if (ev.key === 'Escape' && this.target) { this.target = null; this.hint(); invalidate('overlay'); return true; } },
  cancel() { this.target = null; },
  preview(cx) {
    if (!this.target) return;
    ghost(cx, this.target, P().accent, [3, 3]);
    if (this.cur) {
      const off = G.offsetPolyTowards(this.target, this.cur, this.d);
      if (off) ghost(cx, off, P().sel, [4, 3]);
    }
  },
});

function twoEntityTool(spec) {
  return {
    first: null, firstPick: null,
    activate() { this.first = null; this.hint(); },
    hint() { toolHint(`<b>${spec.title}</b>  ${this.first ? 'second line' : 'first line'}${spec.hintExtra || ''}`); },
    onDown(p, ev, raw) {
      const t = hitTest(raw, 8);
      if (!t || t.type !== 'line') { if (t) App.ui.msg?.(`${spec.title} works on lines in v1`); return; }
      if (!this.first) { this.first = t; this.firstPick = raw; this.hint(); return; }
      if (t === this.first) return;
      spec.apply.call(this, this.first, this.firstPick, t, raw);
      this.first = null;
      this.hint();
    },
    onMove() {}, onUp() {},
    onKey(ev) { if (ev.key === 'Escape' && this.first) { this.first = null; this.hint(); invalidate('overlay'); return true; } },
    cancel() { this.first = null; },
    preview(cx) { if (this.first) ghost(cx, this.first, P().accent, [3, 3]); },
    ...spec.extra,
  };
}

reg(Object.assign(twoEntityTool({
  title: 'FILLET', hintExtra: ' · radius in strip (0 = square corner)',
  apply(e1, p1, e2, p2) {
    if (this.r === 0) {
      const hit = G.lineLine(e1.a, e1.b, e2.a, e2.b, true, true);
      if (!hit) { App.ui.msg?.('Lines are parallel'); return; }
      mutate('Corner', () => {
        const c1 = cornerTrim(e1, p1, hit.p), c2 = cornerTrim(e2, p2, hit.p);
        Object.assign(e1, c1); Object.assign(e2, c2);
      });
      return;
    }
    const res = G.filletSegments(e1, p1, e2, p2, this.r);
    if (res.error) { App.ui.msg?.('Fillet: ' + res.error); return; }
    mutate(`Fillet R${fmt(this.r)}`, () => {
      Object.assign(e1, res.e1); Object.assign(e2, res.e2);
      addEntity({ ...res.arc, type: 'arc', id: newId(), layer: e1.layer });
    });
  },
  extra: {
    r: 3,
    options() { return [{ type: 'num', label: 'Radius', value: this.r, unit: true, step: 0.5, onChange: v => { this.r = Math.max(0, v); } }]; },
  },
}), { id: 'fillet', name: 'Fillet', icon: 'fillet', key: 'F', group: 'modify' }));

function cornerTrim(line, pick, X) {
  // keep the picked side, move the other endpoint to X
  const dA = G.dist(pick, line.a), dB = G.dist(pick, line.b);
  return dA <= dB ? { ...line, b: { ...X } } : { ...line, a: { ...X } };
}

reg(Object.assign(twoEntityTool({
  title: 'CHAMFER', hintExtra: ' · distances in strip',
  apply(e1, p1, e2, p2) {
    const res = G.chamferSegments(e1, p1, e2, p2, this.d1, this.d2);
    if (res.error) { App.ui.msg?.('Chamfer: ' + res.error); return; }
    mutate('Chamfer', () => {
      Object.assign(e1, res.e1); Object.assign(e2, res.e2);
      addEntity({ ...res.line, type: 'line', id: newId(), layer: e1.layer });
    });
  },
  extra: {
    d1: 3, d2: 3,
    options() {
      return [
        { type: 'num', label: 'Dist 1', value: this.d1, unit: true, step: 0.5, onChange: v => { this.d1 = Math.max(0.01, v); } },
        { type: 'num', label: 'Dist 2', value: this.d2, unit: true, step: 0.5, onChange: v => { this.d2 = Math.max(0.01, v); } },
      ];
    },
  },
}), { id: 'chamfer', name: 'Chamfer', icon: 'chamfer', key: 'Shift+F', group: 'modify' }));

// =================================================================
// MEASURE
// =================================================================
reg({
  id: 'measure', name: 'Measure', icon: 'measure', key: 'U', group: 'measure',
  a: null, b: null, cur: null,
  activate() { this.a = this.b = null; toolHint('<b>MEASURE</b>  two points — distance, Δx, Δy, angle'); },
  getAnchor() { return this.a; },
  onDown(p) {
    if (!this.a || this.b) { this.a = p; this.b = null; }
    else {
      this.b = p;
      const d = G.dist(this.a, p);
      App.ui.msg?.(`Distance ${fmtU(d)} · Δx ${fmt(Math.abs(p.x - this.a.x))} · Δy ${fmt(Math.abs(p.y - this.a.y))} · ∠ ${angDeg(this.a, p).toFixed(2)}°`);
    }
    invalidate('overlay');
  },
  onMove(p) { this.cur = p; invalidate('overlay'); },
  onUp() {},
  onKey(ev) { if (ev.key === 'Escape') { this.a = this.b = null; invalidate('overlay'); return true; } },
  cancel() { this.a = this.b = null; },
  preview(cx) {
    const end = this.b || this.cur;
    if (!this.a || !end) return;
    ghostLine(cx, this.a, end, P().marqueeC, [6, 4]);
    label(cx, end, `${fmt(G.dist(this.a, end))}  ∠${angDeg(this.a, end).toFixed(1)}°`);
  },
});

reg({
  id: 'measure-angle', name: 'Angle', icon: 'dim-angular', key: 'Shift+U', group: 'measure',
  first: null,
  activate() { this.first = null; toolHint('<b>ANGLE</b>  pick two lines'); },
  onDown(p, ev, raw) {
    const t = hitTest(raw, 8);
    if (!t || t.type !== 'line') return;
    if (!this.first) { this.first = t; toolHint('<b>ANGLE</b>  second line'); return; }
    const a1 = Math.atan2(this.first.b.y - this.first.a.y, this.first.b.x - this.first.a.x);
    const a2 = Math.atan2(t.b.y - t.a.y, t.b.x - t.a.x);
    let d = Math.abs(a1 - a2) * 180 / Math.PI;
    if (d > 180) d = 360 - d;
    App.ui.msg?.(`Angle between lines: ${d.toFixed(2)}°  (${(180 - d).toFixed(2)}° supplement)`);
    this.first = null;
    this.activate();
  },
  onMove() {}, onUp() {},
  cancel() { this.first = null; },
  preview(cx) { if (this.first) ghost(cx, this.first, P().marqueeC, [3, 3]); },
});

reg({
  id: 'measure-area', name: 'Area', icon: 'area', key: '', group: 'measure',
  activate() { toolHint('<b>AREA</b>  click a closed polyline or circle'); },
  onDown(p, ev, raw) {
    const t = hitTest(raw, 8);
    if (!t) return;
    if (t.type === 'circle') {
      App.ui.msg?.(`Area ${fmt(Math.PI * t.r * t.r, 1)} ${App.doc.units}² · circumference ${fmtU(G.TAU * t.r)}`);
    } else if (t.type === 'poly' && t.closed) {
      const { area, perimeter } = G.polyAreaPerimeter(t);
      App.ui.msg?.(`Area ${fmt(area, 1)} ${App.doc.units}² · perimeter ${fmtU(perimeter)}`);
    } else App.ui.msg?.('Pick a closed polyline or a circle');
  },
  onMove() {}, onUp() {}, cancel() {}, preview() {},
});

// =================================================================
// DIMENSIONS
// =================================================================
function dimTool(kindResolver, spec) {
  return {
    pts: [], cur: null,
    activate() { this.pts = []; this.hint(); },
    hint() { toolHint(`<b>${spec.title}</b>  ${spec.hints[Math.min(this.pts.length, spec.hints.length - 1)]}`); },
    getAnchor() { return this.pts[0] || null; },
    onDown(p, ev, raw) { spec.onDown.call(this, p, raw); },
    onMove(p) { this.cur = p; invalidate('overlay'); },
    onUp() {},
    onKey(ev) { if (ev.key === 'Escape' && this.pts.length) { this.pts = []; invalidate('overlay'); this.hint(); return true; } },
    cancel() { this.pts = []; },
    preview(cx) {
      if (!this.cur) return;
      const d = spec.buildPreview.call(this, this.cur);
      if (d) {
        cx.globalAlpha = 0.8;
        previewDim(cx, d);
        cx.globalAlpha = 1;
      }
    },
    ...spec.extra,
  };
}
function previewDim(cx, dimEnt) {
  const g = dimGeometry(dimEnt);
  cx.strokeStyle = P().dim; cx.fillStyle = P().dim; cx.lineWidth = 1;
  cx.beginPath();
  for (const l of g.lines) { const a = toScreen(l.a), b = toScreen(l.b); cx.moveTo(a.x, a.y); cx.lineTo(b.x, b.y); }
  cx.stroke();
  for (const t of g.texts) {
    const s = toScreen(t.p);
    cx.save(); cx.translate(s.x, s.y); cx.rotate(t.rot || 0);
    cx.font = `${Math.max(3, App.doc.dimStyle.textH * k())}px 'IBM Plex Mono'`;
    cx.textAlign = 'center';
    cx.fillText(t.text, 0, -2);
    cx.restore();
  }
}

{
  const t = dimTool(null, {
    title: 'DIM LINEAR',
    hints: ['first point', 'second point', 'dimension line position'],
    onDown(p) {
      this.pts.push({ ...p });
      if (this.pts.length === 3) {
        const [p1, p2, tp] = this.pts;
        const kind = Math.abs(tp.y - (p1.y + p2.y) / 2) >= Math.abs(tp.x - (p1.x + p2.x) / 2) ? 'linear-h' : 'linear-v';
        mutate('Dimension', () => addEntity({ type: 'dim', kind, p1, p2, tp }));
        this.pts = [];
      }
      this.hint();
    },
    buildPreview(cur) {
      if (this.pts.length !== 2) return null;
      const kind = Math.abs(cur.y - (this.pts[0].y + this.pts[1].y) / 2) >= Math.abs(cur.x - (this.pts[0].x + this.pts[1].x) / 2) ? 'linear-h' : 'linear-v';
      return { type: 'dim', kind, p1: this.pts[0], p2: this.pts[1], tp: cur };
    },
  });
  reg(Object.assign(t, { id: 'dim-linear', name: 'Dim linear', icon: 'dim-linear', key: 'D', group: 'measure' }));
}
{
  const t = dimTool(null, {
    title: 'DIM ALIGNED',
    hints: ['first point', 'second point', 'dimension line position'],
    onDown(p) {
      this.pts.push({ ...p });
      if (this.pts.length === 3) {
        const [p1, p2, tp] = this.pts;
        mutate('Dimension', () => addEntity({ type: 'dim', kind: 'aligned', p1, p2, tp }));
        this.pts = [];
      }
      this.hint();
    },
    buildPreview(cur) {
      if (this.pts.length !== 2) return null;
      return { type: 'dim', kind: 'aligned', p1: this.pts[0], p2: this.pts[1], tp: cur };
    },
  });
  reg(Object.assign(t, { id: 'dim-aligned', name: 'Dim aligned', icon: 'dim-linear', key: '', group: 'measure' }));
}
{
  const t = dimTool(null, {
    title: 'DIM RADIUS',
    hints: ['pick circle or arc', 'text position'],
    onDown(p, raw) {
      if (!this.pts.length) {
        const e = hitTest(raw, 8);
        if (e && (e.type === 'circle' || e.type === 'arc')) { this.target = e; this.pts.push(p); this.hint(); }
        return;
      }
      mutate('Dimension', () => addEntity({ type: 'dim', kind: this.diam ? 'diam' : 'radial', c: { ...this.target.c }, r: this.target.r, tp: { ...p } }));
      this.pts = []; this.target = null;
      this.hint();
    },
    buildPreview(cur) {
      if (!this.target) return null;
      return { type: 'dim', kind: this.diam ? 'diam' : 'radial', c: this.target.c, r: this.target.r, tp: cur };
    },
    extra: {
      diam: false, target: null,
      options() {
        return [{ type: 'seg', options: [{ id: 'r', label: 'Radius' }, { id: 'd', label: 'Diameter' }], value: this.diam ? 'd' : 'r', onChange: v => { this.diam = v === 'd'; } }];
      },
    },
  });
  reg(Object.assign(t, { id: 'dim-radial', name: 'Dim radial', icon: 'dim-radial', key: '', group: 'measure' }));
}

// =================================================================
// CALIBRATE
// =================================================================
reg({
  id: 'calibrate', name: 'Set scale', icon: 'calibrate', key: '', group: 'measure',
  a: null, b: null, cur: null,
  activate() { this.a = this.b = null; this.hint(); },
  hint() {
    toolHint(`<b>SET SCALE</b>  ${!this.a ? 'click one end of something you know the real size of' : !this.b ? 'click the other end' : 'type its real length and press Enter'}`);
  },
  options() {
    return [{ type: 'info', text: 'click across a known distance → type its real size; the whole drawing snaps to true scale' }];
  },
  getAnchor() { return this.a; },
  onDown(p) {
    if (!this.a) this.a = p;
    else if (!this.b) { this.b = p; App.ui.summonDyn?.(); }
    else { this.a = p; this.b = null; }
    this.hint();
    invalidate('overlay');
  },
  onMove(p) { this.cur = p; invalidate('overlay'); },
  onUp() {},
  onInput(parsed) {
    if (!this.a || !this.b || !parsed.len) return;
    const measured = G.dist(this.a, this.b);
    if (measured < 1e-9) return;
    const f = parsed.len / measured;                 // scale so the clicked feature = its real length
    const hasContent = App.doc.entities.length > 0 || App.doc.underlay;
    if (hasContent) {
      mutate(`Set scale ×${f.toFixed(3)}`, () => {
        for (const e of App.doc.entities) Object.assign(e, G.scaleEnt(e, this.a, f));
        const u = App.doc.underlay;
        if (u) { u.wMM *= f; u.hMM *= f; u.x = this.a.x + (u.x - this.a.x) * f; u.y = this.a.y + (u.y - this.a.y) * f; }
      });
      App.ui.toast?.(`Scale set — that feature is now exactly ${fmtU(parsed.len)}. Your DXF exports at true size.`);
    } else {
      App.ui.toast?.('Tablet scale set — everything you trace is now true size.');
    }
    setCalibration(App.CAL / f);                     // keep the readout + future strokes consistent
    this.a = this.b = null;
    App.ui.updateCalChip?.();
    App.ui.setDirty?.(true);
    if (hasContent) zoomFit();
    invalidate('all');
    setTool('freehand');   // hand the user straight back to tracing
  },
  onKey(ev) { if (ev.key === 'Escape') { this.a = this.b = null; invalidate('overlay'); this.hint(); return true; } },
  cancel() { this.a = this.b = null; },
  preview(cx) {
    const end = this.b || this.cur;
    if (!this.a || !end) return;
    ghostLine(cx, this.a, end, P().accent, [6, 4]);
    label(cx, end, `${fmt(G.dist(this.a, end))} measured — type true length`);
  },
});

export const TOOL_GROUPS = [
  { name: 'select', ids: ['select', 'pan'] },
  { name: 'draw', ids: ['line', 'polyline', 'rect', 'circle', 'arc', 'freehand', 'point', 'text'] },
  { name: 'modify', ids: ['move', 'copy', 'rotate', 'scale', 'mirror', 'trim', 'extend', 'offset', 'fillet', 'chamfer'] },
  { name: 'measure', ids: ['measure', 'measure-angle', 'measure-area', 'dim-linear', 'dim-aligned', 'dim-radial', 'calibrate'] },
];
