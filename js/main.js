// TrueLine bootstrap + input pipeline.
import {
  App, newDoc, loadAutosaved, initCanvases, setTool, invalidate, invalidateView,
  snapPoint, toWorld, toScreen, k, zoomAt, zoomFit, setCursorScreen, hitTest,
  undo, redo, deleteSelection, setSelection, selectedEntities, mutate, addEntity, newId,
  parseCoordInput, decomposeForExport, reloadUnderlayImg, scheduleAutosave,
} from './app.js';
import './tools.js';
import { TOOL_GROUPS } from './tools.js';
import { initUI, tabletCfg, toggle } from './ui.js';
import * as G from './geom.js';
import { initUpgrades } from './upgrades.js';

window.__parseCoordInput = s => parseCoordInput(s, App.tool?.getAnchor?.() || null);

// ---------------------------------------------------------------- boot
if (!await loadAutosaved()) newDoc();
initCanvases({
  cvGrid: document.getElementById('cvGrid'),
  cvScene: document.getElementById('cvScene'),
  cvOverlay: document.getElementById('cvOverlay'),
  rulX: document.getElementById('rulerX'),
  rulY: document.getElementById('rulerY'),
  stackEl: document.getElementById('stack'),
});
initUI();
initUpgrades();
reloadUnderlayImg();
setTool('select');
if (App.doc.entities.length) requestAnimationFrame(() => zoomFit());

// ---------------------------------------------------------------- pointer input
const overlayEl = document.getElementById('cvOverlay');
let spaceDown = false;
let panDrag = null;          // {sx, sy, vx, vy}
let downScreen = null;
let eraserStroke = false;

function stackPos(ev) {
  const r = overlayEl.getBoundingClientRect();
  return { x: ev.clientX - r.left, y: ev.clientY - r.top };
}
function snappedFor(ev, raw) {
  const t = App.tool;
  const noSnap = t && (t.id === 'freehand' || t.id === 'pan');
  return noSnap ? raw : snapPoint(raw, {
    anchor: t?.getAnchor?.() || null,
    shift: ev.shiftKey,
    exclude: t?.snapExclude?.() || null,   // don't snap a dragged entity to itself
  });
}

overlayEl.addEventListener('contextmenu', ev => ev.preventDefault());

// touch = navigation only (pen/mouse draw): one finger pans, two fingers pinch-zoom
const touches = new Map();
let pinch = null;
function touchNav(ev) {
  if (ev.pointerType !== 'touch') return false;
  const s = stackPos(ev);
  if (ev.type === 'pointerdown') {
    touches.set(ev.pointerId, s);
    try { overlayEl.setPointerCapture(ev.pointerId); } catch (e) {}
    const pts = [...touches.values()];
    pinch = pts.length >= 2
      ? { mode: 'pinch', d0: Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y), mid0: { x: (pts[0].x + pts[1].x) / 2, y: (pts[0].y + pts[1].y) / 2 }, view0: { ...App.view } }
      : { mode: 'pan', at: s, view0: { ...App.view } };
  } else if (ev.type === 'pointermove' && touches.has(ev.pointerId)) {
    touches.set(ev.pointerId, s);
    const pts = [...touches.values()];
    if (pinch?.mode === 'pinch' && pts.length >= 2) {
      const d1 = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
      const mid = { x: (pts[0].x + pts[1].x) / 2, y: (pts[0].y + pts[1].y) / 2 };
      const f = d1 / Math.max(1, pinch.d0);
      App.view.z = Math.min(400, Math.max(0.005, pinch.view0.z * f));
      const k1 = App.view.z * App.CAL;
      // keep the world point under the initial midpoint pinned to the current midpoint
      const wx = pinch.mid0.x / (pinch.view0.z * App.CAL) + pinch.view0.x;
      const wy = pinch.mid0.y / (pinch.view0.z * App.CAL) + pinch.view0.y;
      App.view.x = wx - mid.x / k1;
      App.view.y = wy - mid.y / k1;
      invalidateView();
    } else if (pinch?.mode === 'pan') {
      App.view.x = pinch.view0.x - (s.x - pinch.at.x) / (pinch.view0.z * App.CAL);
      App.view.y = pinch.view0.y - (s.y - pinch.at.y) / (pinch.view0.z * App.CAL);
      invalidateView();
    }
  } else if (ev.type === 'pointerup' || ev.type === 'pointercancel') {
    touches.delete(ev.pointerId);
    if (!touches.size) pinch = null;
    else {
      const pts = [...touches.values()];
      pinch = { mode: 'pan', at: pts[0], view0: { ...App.view } };
    }
  }
  ev.preventDefault();
  return true;
}
overlayEl.addEventListener('pointercancel', ev => {
  if (touchNav(ev)) return;
  panDrag = null; eraserStroke = false; downScreen = null;
  App.tool?.cancel?.(); invalidate('overlay'); App.ui.refreshCtx?.();
});

overlayEl.addEventListener('pointerdown', ev => {
  if (touchNav(ev)) return;
  overlayEl.focus?.();
  const s = stackPos(ev);
  downScreen = s;
  window.__lastCursor = { x: s.x + 20, y: s.y + 20 };
  if (ev.pointerType === 'pen') { App.pen.seen = true; App.ui.penIndicator?.(true, ev.pressure); }

  // pen eraser end
  if (ev.pointerType === 'pen' && (ev.button === 5 || (ev.buttons & 32))) {
    if (tabletCfg.eraser === 'delete') {
      eraserStroke = true;
      eraseAt(toWorld(s.x, s.y));
      try { overlayEl.setPointerCapture(ev.pointerId); } catch (e) {}
    }
    return;
  }
  // pen barrel button
  if (ev.pointerType === 'pen' && ev.button !== 0) {
    ev.preventDefault();
    penAction(tabletCfg.barrel, ev, s);
    return;
  }
  // middle mouse / space = pan
  if (ev.button === 1 || spaceDown) {
    panDrag = { sx: ev.clientX, sy: ev.clientY, vx: App.view.x, vy: App.view.y };
    try { overlayEl.setPointerCapture(ev.pointerId); } catch (e) {}
    return;
  }
  if (ev.button !== 0) return;
  try { overlayEl.setPointerCapture(ev.pointerId); } catch (e) {}
  const raw = toWorld(s.x, s.y);
  const p = snappedFor(ev, raw);
  App.tool?.onDown?.(p, ev, raw);
  invalidate('overlay');
});

overlayEl.addEventListener('pointermove', ev => {
  if (touchNav(ev)) return;
  const s = stackPos(ev);
  setCursorScreen(s);
  window.__lastCursor = { x: s.x + 20, y: s.y + 20 };
  if (ev.pointerType === 'pen') App.ui.penIndicator?.(true, ev.pressure);

  if (panDrag) {
    App.view.x = panDrag.vx - (ev.clientX - panDrag.sx) / k();
    App.view.y = panDrag.vy - (ev.clientY - panDrag.sy) / k();
    invalidateView();
    return;
  }
  const raw = toWorld(s.x, s.y);
  if (eraserStroke) { eraseAt(raw); return; }
  const p = snappedFor(ev, raw);
  App.ui.updateCoords?.(p, App.tool?.getAnchor?.() || null);

  let coalesced = null;
  if (App.tool?.id === 'freehand' && ev.buttons) {
    let evs = ev.getCoalescedEvents ? ev.getCoalescedEvents() : [];
    if (!evs.length) evs = [ev];
    const r = overlayEl.getBoundingClientRect();
    coalesced = evs.map(e => toWorld(e.clientX - r.left, e.clientY - r.top));
  }
  App.tool?.onMove?.(p, ev, raw, coalesced);
  invalidate('overlay');
  invalidate('rulers');
});

overlayEl.addEventListener('pointerup', ev => {
  if (touchNav(ev)) return;
  const s = stackPos(ev);
  if (panDrag) { panDrag = null; return; }
  if (eraserStroke) { eraserStroke = false; return; }
  if (ev.button !== 0) return;
  const raw = toWorld(s.x, s.y);
  const p = snappedFor(ev, raw);
  const travelled = downScreen ? Math.hypot(s.x - downScreen.x, s.y - downScreen.y) : 0;
  App.tool?.onUp?.(p, ev, raw, travelled);
  invalidate('overlay');
});

overlayEl.addEventListener('dblclick', ev => {
  const s = stackPos(ev);
  const raw = toWorld(s.x, s.y);
  App.tool?.onDbl?.(snappedFor(ev, raw), ev, raw);
});

overlayEl.addEventListener('pointerleave', () => {
  setCursorScreen(null);
  App.ui.penIndicator?.(false);
  invalidate('overlay'); invalidate('rulers');
});

overlayEl.addEventListener('wheel', ev => {
  ev.preventDefault();
  const s = stackPos(ev);
  zoomAt(s.x, s.y, Math.pow(1.1, -ev.deltaY / 100));
}, { passive: false });

function eraseAt(p) {
  const e = hitTest(p, 10);
  if (e) mutate('Erased', () => {
    App.doc.entities = App.doc.entities.filter(x => x !== e);
    App.selection.delete(e.id);
  });
}

const FLAT_TOOLS = TOOL_GROUPS.flatMap(g => g.ids);
function penAction(action, ev, s) {
  switch (action) {
    case 'cycle-tool': {
      const i = FLAT_TOOLS.indexOf(App.tool?.id);
      setTool(FLAT_TOOLS[(i + 1) % FLAT_TOOLS.length]);
      App.ui.msg?.('Barrel → ' + App.tool.name);
      break;
    }
    case 'pan': {
      if (typeof ev.clientX !== 'number') { setTool('pan'); break; }   // keyboard-bound pan: switch tool instead
      panDrag = { sx: ev.clientX, sy: ev.clientY, vx: App.view.x, vy: App.view.y };
      if (ev.pointerId !== undefined) { try { overlayEl.setPointerCapture(ev.pointerId); } catch (e) {} }
      break;
    }
    case 'finish': if (App.tool?.id === 'freehand') App.tool.accept(); else App.tool?.onKey?.({ key: 'Enter' }); break;
    case 'undo': undo(); App.ui.refreshAll?.(); break;
    case 'esc': App.tool?.cancel?.(); App.tool?.hint?.(); invalidate('overlay'); break;
    case 'toggle-osnap': App.toggles.osnap = !App.toggles.osnap; App.ui.refreshAll?.(); break;
    case 'repeat': setTool(App.lastToolId); break;
    case 'delete': eraseAt(toWorld(s.x, s.y)); break;
  }
}

// ---------------------------------------------------------------- keyboard
const FKEYS = { F3: 'osnap', F7: 'grid', F8: 'ortho', F9: 'snap', F10: 'polar', F12: 'dyn' };

addEventListener('keydown', ev => {
  const t = ev.target;
  if (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA' || t.isContentEditable) return;
  if (ev.key === ' ') { spaceDown = true; ev.preventDefault(); return; }

  if (App.ui.tabletCaptureKey?.(ev)) { ev.preventDefault(); return; }

  if (FKEYS[ev.key]) {
    ev.preventDefault();
    toggle(FKEYS[ev.key]);
    return;
  }
  if (ev.ctrlKey || ev.metaKey) {
    const key = ev.key.toLowerCase();
    if (key === 'z' && !ev.shiftKey) { ev.preventDefault(); undo(); App.ui.refreshAll?.(); }
    else if (key === 'y' || (key === 'z' && ev.shiftKey)) { ev.preventDefault(); redo(); App.ui.refreshAll?.(); }
    else if (key === 's') { ev.preventDefault(); App.ui.saveProject?.(); }
    else if (key === 'o') { ev.preventDefault(); App.ui.openFile?.(); }
    else if (key === 'a') { ev.preventDefault(); setSelection(App.doc.entities.map(e => e.id)); setTool('select'); }
    else if (key === 'c') { copySel(); }
    else if (key === 'x') { copySel(); deleteSelection(); }
    else if (key === 'v') { pasteClip(); }
    else if (key === 'd') { ev.preventDefault(); duplicateSel(); }
    return;
  }
  if (ev.key === 'Delete' || ev.key === 'Backspace') { deleteSelection(); return; }
  if (ev.shiftKey && ev.code === 'Digit1') { zoomFit(); return; }
  if (ev.shiftKey && ev.code === 'Digit2') { zoomFit(selectedEntities().length ? selectedEntities() : null); return; }
  if (ev.key === '?') { App.ui.helpMenu?.(); return; }

  // tool-internal keys first (Enter finish, C close, Esc stage-cancel)
  if (App.tool?.onKey?.(ev)) { invalidate('overlay'); return; }

  if (ev.key === 'Escape') {
    if (App.tool && App.tool.id !== 'select') { setTool('select'); }
    else setSelection([]);
    return;
  }
  if (ev.key === 'Enter') {
    if (App.tool?.id === 'select') setTool(App.lastToolId);
    return;
  }

  // dynamic numeric input: typing digits while a drafting tool is armed
  if (/^[\d.\-@#]$/.test(ev.key) && App.tool && App.tool.onInput && App.toggles.dyn) {
    App.ui.summonDyn?.(ev.key);
    ev.preventDefault();
    return;
  }

  // custom tablet bindings first, then tool hotkeys
  const kl = ev.key.toLowerCase();
  const custom = tabletCfg.keys[kl];
  if (custom) {
    if (custom.startsWith('act:')) penAction(custom.slice(4), ev, window.__lastCursor || { x: 0, y: 0 });
    else setTool(custom);
    return;
  }
  for (const tool of App.tools.values()) {
    if (!tool.key) continue;
    const wantShift = tool.key.startsWith('Shift+');
    const base = (wantShift ? tool.key.slice(6) : tool.key).toLowerCase();   // letter, symbol, or 'f1' etc.
    if (kl === base && ev.shiftKey === wantShift) { ev.preventDefault(); setTool(tool.id); return; }
  }
});
addEventListener('keyup', ev => { if (ev.key === ' ') spaceDown = false; });

// clipboard
function copySel() {
  const sel = selectedEntities();
  if (sel.length) { App.clipboard = JSON.parse(JSON.stringify(sel)); App.ui.msg?.(`Copied ${sel.length}`); }
}
function pasteClip() {
  if (!App.clipboard?.length) return;
  mutate(`Pasted ${App.clipboard.length}`, () => {
    const ids = [];
    for (const e of App.clipboard) {
      const c = G.translateEnt(e, 5, 5);
      c.id = newId();
      App.doc.entities.push(c);
      ids.push(c.id);
    }
    setSelection(ids);
  });
}
function duplicateSel() {
  copySel();
  pasteClip();
}

// ---------------------------------------------------------------- self-test (?test=1)
if (location.search.includes('test=1')) {
  (async () => {
    const results = {};
    for (const name of ['geom', 'dxf', 'pdf', 'icons']) {
      try {
        const m = await import(`./${name}.js`);
        results[name] = m.selfTest ? m.selfTest() : { pass: false, failures: ['no selfTest'] };
      } catch (e) { results[name] = { pass: false, failures: [String(e)] }; }
    }
    // app smoke test
    const smoke = [];
    try {
      const saveDoc = JSON.stringify(App.doc);
      newDoc();
      addEntity({ type: 'line', a: { x: 0, y: 0 }, b: { x: 100, y: 0 } });
      addEntity({ type: 'circle', c: { x: 50, y: 50 }, r: 25 });
      addEntity({ type: 'arc', c: { x: 0, y: 50 }, r: 20, a0: 0, a1: Math.PI / 2 });
      addEntity({ type: 'poly', pts: [{ x: 0, y: 100 }, { x: 50, y: 100, bulge: 0.5 }, { x: 50, y: 150 }], closed: false });
      addEntity({ type: 'text', p: { x: 10, y: 10 }, text: 'hello', h: 5, rot: 0 });
      addEntity({ type: 'point', p: { x: 5, y: 5 } });
      addEntity({ type: 'dim', kind: 'aligned', p1: { x: 0, y: 0 }, p2: { x: 100, y: 0 }, tp: { x: 50, y: -10 } });
      const dec = decomposeForExport(App.doc.entities);
      if (!dec.some(e => e.type === 'text')) smoke.push('dim decompose lost text');
      const { writeDXF, readDXF } = await import('./dxf.js');
      const dxf = writeDXF(dec, App.doc.layers, { units: 'mm' });
      if (!dxf.includes('ENTITIES')) smoke.push('dxf write failed');
      const back = readDXF(dxf);
      if (back.entities.length < 6) smoke.push(`dxf roundtrip lost entities: ${back.entities.length}`);
      const { writePDF } = await import('./pdf.js');
      const pdf = writePDF([{ widthMM: 100, heightMM: 100, paths: [{ segs: [{ m: { x: 0, y: 0 } }, { l: { x: 50, y: 50 } }], strokeRGB: [0, 0, 0], widthMM: 0.25 }], texts: [] }]);
      const head = String.fromCharCode(...pdf.slice(0, 5));
      if (head !== '%PDF-') smoke.push('pdf header wrong: ' + head);
      const snap = snapPoint({ x: 0.4, y: 0.2 }, {});
      if (Math.abs(snap.x) > 1e-6 || Math.abs(snap.y) > 1e-6) smoke.push('osnap endpoint failed');
      App.doc = JSON.parse(saveDoc);
      invalidate('all');
    } catch (e) { smoke.push('smoke crashed: ' + (e.stack || e)); }
    results.app = { pass: !smoke.length, failures: smoke };
    const allPass = Object.values(results).every(r => r.pass);
    console.log(JSON.stringify(results, (kk, v) => v, 1));
    console.log(allPass ? 'TESTS PASS' : 'TESTS FAIL');
  })();
}
