import { isMac, localizeShortcuts } from './platform.js';
// TrueLine UI: DOM chrome, panels, exports. app.js stays DOM-free apart from canvases.
import {
  App, newDoc, setTool, invalidate, invalidateView, zoomFit, zoomPhysical, zoomAt,
  fmt, fmtU, parseNum, undo, redo, beginChange, commitChange, deleteSelection, setSelection, selectedEntities,
  decomposeForExport, projectJSON, loadProject, scheduleAutosave, setUnderlay,
  reloadUnderlayImg, getUnderlayImg, k, toScreen, newId, mutate, addEntity, drawingBounds,
  visibleEntities, currentLayer, layerOf, viewSize, setCalibration, flushAutosave,
} from './app.js';
import { TOOL_GROUPS } from './tools.js';
import { ICONS, icon } from './icons.js';
import { writeDXF, readDXF } from './dxf.js';
import { writePDF } from './pdf.js';
import { startTour, tourDone } from './tour.js';
import * as G from './geom.js';
import { clearOlderRevisions } from './recovery.js';
import { createOutlineEditor, circlePoints, closestOnSegment, outlineIssue } from './outline-editor.js';

const $ = id => document.getElementById(id);
function el(tag, attrs = {}, ...kids) {
  const n = document.createElement(tag);
  for (const [key, v] of Object.entries(attrs)) {
    if (key === 'class') n.className = v;
    else if (key === 'html') n.innerHTML = v;
    else if (key.startsWith('on')) n.addEventListener(key.slice(2), v);
    else if (v !== null && v !== undefined) n.setAttribute(key, v);
  }
  for (const kid of kids) if (kid != null) n.append(kid);
  return n;
}
function download(data, name, mime) {
  const blob = data instanceof Blob ? data : new Blob([data], { type: mime });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

// ---------------------------------------------------------------- popovers
let openPop = null;
function closePop() { if (openPop) { openPop.remove(); openPop = null; } }
function popover(anchor, build) {
  closePop();
  const pop = el('div', { class: 'pop' });
  build(pop);
  document.getElementById('popRoot').append(pop);
  const r = anchor.getBoundingClientRect();
  const pw = pop.offsetWidth, ph = pop.offsetHeight;
  pop.style.left = Math.min(innerWidth - pw - 8, Math.max(8, r.left)) + 'px';
  pop.style.top = (r.top - ph - 6 > 40 ? r.top - ph - 6 : r.bottom + 6) + 'px';
  openPop = pop;
  setTimeout(() => {
    const close = ev => { if (!pop.contains(ev.target)) { closePop(); removeEventListener('pointerdown', close, true); } };
    addEventListener('pointerdown', close, true);
  });
  return pop;
}
document.addEventListener('keydown', ev => {
  const modal = document.getElementById('modalRoot');
  if (modal && !modal.hidden) {
    if (ev.key === 'Escape') hideModal();
    ev.stopPropagation();          // global shortcuts stay dead while a modal is open
    return;
  }
  if (ev.key === 'Escape') closePop();
});

// ---------------------------------------------------------------- toast / hints
let toastTimer = null, msgTimer = null;
function toast(text, ms = 3200) {
  const t = $('toast');
  t.textContent = text; t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, ms);
}
function hint(html) { $('hintPrompt').innerHTML = html || ''; }
function msg(text) {
  const m = $('hintMsg');
  m.textContent = text || ''; m.style.opacity = 1;
  clearTimeout(msgTimer);
  msgTimer = setTimeout(() => { m.style.opacity = 0.25; }, 4000);
}

// ---------------------------------------------------------------- palette
const groupLastUsed = {};
function buildPalette() {
  const pal = $('palette');
  pal.innerHTML = '';
  TOOL_GROUPS.forEach((grp, gi) => {
    if (gi) pal.append(el('div', { class: 'pal-sep' }));
    for (const tid of grp.ids) {
      const t = App.tools.get(tid);
      if (!t) continue;
      const b = el('button', {
        class: 'pal-btn', 'data-tool': tid,
        title: `${t.name}${t.key ? ' · ' + t.key : ''}`,
        html: icon(t.icon),
        onclick: () => setTool(tid),
      });
      pal.append(b);
    }
  });
  refreshPalette();
}
function refreshPalette() {
  document.querySelectorAll('.pal-btn').forEach(b =>
    b.classList.toggle('active', App.tool && b.dataset.tool === App.tool.id));
}

// ---------------------------------------------------------------- context strip
function renderCtx(tool) {
  $('ctxIcon').innerHTML = icon(tool.icon);
  $('ctxName').textContent = tool.name;
  const box = $('ctxControls');
  box.innerHTML = '';
  const opts = tool.options ? tool.options() : [];
  for (const o of opts) {
    if (o.type === 'seg') {
      const seg = el('div', { class: 'seg' });
      for (const opt of o.options) {
        const b = el('button', { class: opt.id === o.value ? 'on' : '', html: opt.label, onclick: () => { o.onChange(opt.id); renderCtx(tool); } });
        seg.append(b);
      }
      box.append(seg);
    } else if (o.type === 'num') {
      const inp = el('input', { type: 'number', step: o.step || 'any', value: o.unit ? +fmt(o.value) : o.value });
      inp.addEventListener('change', () => {
        const v = o.unit ? parseNum(inp.value) : parseFloat(inp.value);
        if (v !== null && !isNaN(v)) o.onChange(v);
      });
      box.append(el('label', {}, o.label + (o.unit ? ` (${App.doc.units})` : ''), inp));
    } else if (o.type === 'check') {
      const inp = el('input', { type: 'checkbox' });
      inp.checked = !!o.value;
      inp.addEventListener('change', () => o.onChange(inp.checked));
      box.append(el('label', {}, inp, o.label));
    } else if (o.type === 'btn') {
      box.append(el('button', { class: 'ab-btn', html: o.label, onclick: o.cb }));
    } else if (o.type === 'info') {
      box.append(el('label', {}, o.text));
    }
  }
}

// ---------------------------------------------------------------- layers panel
const LAYER_COLORS = ['#DEE3EC', '#FF5C5C', '#FFB224', '#F5E663', '#43E08A', '#3FCFC0', '#4C9FFF', '#B48CFF', '#FF7AD9', '#FF9A5C', '#8A93A6', '#5C7A99'];
function refreshLayers() {
  const list = $('layerList');
  list.innerHTML = '';
  for (const layer of App.doc.layers) {
    const row = el('div', { class: 'layer-row' + (layer.id === App.doc.currentLayer ? ' current' : '') });
    row.append(el('span', { class: 'lr-cur' }));
    const sw = el('span', { class: 'lr-swatch' });
    sw.style.background = layer.color;
    sw.addEventListener('click', ev => {
      ev.stopPropagation();
      popover(sw, pop => {
        pop.append(el('h4', { html: 'Layer color' }));
        const grid = el('div', { class: 'swatches' });
        for (const c of LAYER_COLORS) {
          const b = el('button');
          b.style.background = c;
          b.addEventListener('click', () => { mutate('Layer color', () => { layer.color = c; }); closePop(); refreshLayers(); });
          grid.append(b);
        }
        pop.append(grid);
        const custom = el('input', { type: 'color', value: layer.color });
        custom.addEventListener('change', () => { mutate('Layer color', () => { layer.color = custom.value; }); refreshLayers(); });
        pop.append(el('label', {}, 'Custom ', custom));
        const lt = el('select', {},
          ...['continuous', 'dashed', 'hidden', 'center', 'dashdot'].map(x => el('option', { value: x, ...(layer.ltype === x ? { selected: '' } : {}) }, x)));
        lt.addEventListener('change', () => { mutate('Linetype', () => { layer.ltype = lt.value; }); });
        pop.append(el('label', {}, 'Linetype ', lt));
      });
    });
    row.append(sw);
    const name = el('span', { class: 'lr-name', title: layer.name }, layer.name);
    name.addEventListener('dblclick', () => {
      const inp = el('input', { value: layer.name });
      name.innerHTML = ''; name.append(inp);
      inp.focus(); inp.select();
      const done = () => { mutate('Rename layer', () => { layer.name = inp.value || layer.name; }); refreshLayers(); };
      inp.addEventListener('blur', done);
      inp.addEventListener('keydown', ev => { if (ev.key === 'Enter') inp.blur(); ev.stopPropagation(); });
    });
    row.append(name);
    const lockBtn = el('button', { class: 'lr-btn' + (layer.locked ? ' on' : ''), html: icon(layer.locked ? 'lock' : 'unlock'), title: 'Lock' });
    lockBtn.addEventListener('click', ev => { ev.stopPropagation(); mutate(layer.locked ? 'Unlock layer' : 'Lock layer', () => { layer.locked = !layer.locked; }); refreshLayers(); });
    const eyeBtn = el('button', { class: 'lr-btn' + (layer.visible ? ' on' : ''), html: icon(layer.visible ? 'eye' : 'eye-off'), title: 'Visibility' });
    eyeBtn.addEventListener('click', ev => { ev.stopPropagation(); mutate(layer.visible ? 'Hide layer' : 'Show layer', () => { layer.visible = !layer.visible; }); refreshLayers(); invalidate('scene'); });
    row.append(lockBtn, eyeBtn);
    row.addEventListener('click', () => { App.doc.currentLayer = layer.id; refreshLayers(); setDirty(true); scheduleAutosave(); });
    list.append(row);
  }
}
function wireLayerTools() {
  $('layerAdd').innerHTML = icon('plus');
  $('layerDup').innerHTML = icon('copy');
  $('layerDel').innerHTML = icon('trash');
  $('layerIso').innerHTML = icon('eye');
  $('layerAdd').onclick = () => {
    mutate('Add layer', () => {
      const id = 'L' + newId();
      App.doc.layers.push({ id, name: 'Layer ' + App.doc.layers.length, color: LAYER_COLORS[App.doc.layers.length % LAYER_COLORS.length], ltype: 'continuous', visible: true, locked: false });
      App.doc.currentLayer = id;
    });
    refreshLayers();
  };
  $('layerDup').onclick = () => {
    const src = currentLayer();
    mutate('Duplicate layer', () => {
      const id = 'L' + newId();
      App.doc.layers.push({ ...src, id, name: src.name + ' copy' });
      App.doc.currentLayer = id;
    });
    refreshLayers();
  };
  $('layerDel').onclick = () => {
    if (App.doc.layers.length < 2) { msg('Cannot delete the last layer'); return; }
    const doomed = currentLayer();
    const fallback = App.doc.layers.find(l => l.id !== doomed.id);
    mutate('Delete layer', () => {
      for (const e of App.doc.entities) if (e.layer === doomed.id) e.layer = fallback.id;
      App.doc.layers = App.doc.layers.filter(l => l !== doomed);
      App.doc.currentLayer = fallback.id;
    });
    refreshLayers(); invalidate('scene');
  };
  $('layerIso').onclick = () => {
    const cur = currentLayer();
    const othersVisible = App.doc.layers.some(l => l !== cur && l.visible);
    mutate('Isolate layer', () => {
      for (const l of App.doc.layers) l.visible = othersVisible ? l === cur : true;
    });
    refreshLayers(); invalidate('scene');
  };
}
function moveSelectionToLayer() {
  if (!App.selection.size) return;
  popover($('ctxControls'), pop => {
    pop.append(el('h4', { html: 'Move selection to layer' }));
    for (const l of App.doc.layers) {
      const b = el('button', { class: 'ab-btn', style: 'display:block;width:100%;margin:2px 0' }, l.name);
      b.addEventListener('click', () => {
        mutate(`To layer ${l.name}`, () => { for (const e of selectedEntities()) e.layer = l.id; });
        closePop(); invalidate('scene');
      });
      pop.append(b);
    }
  });
}

// ---------------------------------------------------------------- properties panel
function refreshProps() {
  const box = $('propsBody');
  box.innerHTML = '';
  const sel = selectedEntities();
  if (!sel.length) {
    // document properties
    const g = el('div', { class: 'prop-grid' });
    const gridInp = el('input', { type: 'number', step: 'any', value: +fmt(App.doc.gridStep) });
    gridInp.addEventListener('change', () => { const v = parseNum(gridInp.value); if (v > 0) { App.doc.gridStep = v; invalidate('grid'); setDirty(true); scheduleAutosave(); } });
    g.append(el('label', {}, `Grid (${App.doc.units})`), gridInp);
    if (App.doc.underlay) {
      const op = el('input', { type: 'range', min: 0.05, max: 1, step: 0.05, value: App.doc.underlay.opacity });
      op.addEventListener('input', () => { beginChange(); App.doc.underlay.opacity = +op.value; invalidate('grid'); });
      op.addEventListener('change', () => commitChange('Image opacity'));
      g.append(el('label', {}, 'Underlay α'), op);
      const vis = el('input', { type: 'checkbox' });
      vis.checked = App.doc.underlay.visible;
      vis.addEventListener('change', () => { mutate('Image visibility', () => { App.doc.underlay.visible = vis.checked; }); });
      g.append(el('label', {}, 'Underlay'), vis);
    }
    box.append(el('div', { class: 'prop-group' }, el('div', { class: 'prop-title', html: 'Document' }), g));
    const stats = el('div', { class: 'prop-group' },
      el('div', { class: 'prop-title', html: 'Drawing' }),
      el('div', { class: 'prop-ro', html: `${App.doc.entities.length} entities · ${App.doc.layers.length} layers` }));
    box.append(stats);
    return;
  }
  const counts = {};
  for (const e of sel) counts[e.type] = (counts[e.type] || 0) + 1;
  box.append(el('div', { class: 'prop-group' },
    el('div', { class: 'prop-title', html: `${sel.length} selected · ` + Object.entries(counts).map(([t, n]) => `${n} ${t}`).join(', ') })));

  // common: layer
  const lay = el('select', {}, ...App.doc.layers.map(l =>
    el('option', { value: l.id, ...(sel.every(e => e.layer === l.id) ? { selected: '' } : {}) }, l.name)));
  lay.addEventListener('change', () => {
    mutate('Change layer', () => { for (const e of sel) e.layer = lay.value; });
    invalidate('scene');
  });
  const cg = el('div', { class: 'prop-grid' });
  cg.append(el('label', {}, 'Layer'), lay);
  box.append(el('div', { class: 'prop-group' }, cg));

  if (sel.length === 1) box.append(geomProps(sel[0]));
}
function numField(value, cb, raw = false) {
  const inp = el('input', { type: 'number', step: 'any', value: raw ? +value.toFixed(4) : +fmt(value) });
  inp.addEventListener('change', () => {
    const v = raw ? parseFloat(inp.value) : parseNum(inp.value);
    if (v !== null && !isNaN(v)) { mutate('Edit property', () => cb(v)); invalidate('scene'); refreshProps(); }
  });
  inp.addEventListener('keydown', ev => ev.stopPropagation());
  return inp;
}
function geomProps(e) {
  const g = el('div', { class: 'prop-grid' });
  const add = (labelTxt, node) => g.append(el('label', {}, labelTxt), node);
  if (e.type === 'line') {
    add('x1', numField(e.a.x, v => { e.a.x = v; }));
    add('y1', numField(e.a.y, v => { e.a.y = v; }));
    add('x2', numField(e.b.x, v => { e.b.x = v; }));
    add('y2', numField(e.b.y, v => { e.b.y = v; }));
    add('length', el('span', { class: 'prop-ro', html: fmtU(G.dist(e.a, e.b)) }));
  } else if (e.type === 'circle') {
    add('cx', numField(e.c.x, v => { e.c.x = v; }));
    add('cy', numField(e.c.y, v => { e.c.y = v; }));
    add('r', numField(e.r, v => { if (v > 0) e.r = v; }));
    add('⌀', el('span', { class: 'prop-ro', html: fmtU(e.r * 2) }));
  } else if (e.type === 'arc') {
    add('cx', numField(e.c.x, v => { e.c.x = v; }));
    add('cy', numField(e.c.y, v => { e.c.y = v; }));
    add('r', numField(e.r, v => { if (v > 0) e.r = v; }));
    add('sweep', el('span', { class: 'prop-ro', html: (G.sweep(e.a0, e.a1) * 180 / Math.PI).toFixed(1) + '°' }));
  } else if (e.type === 'poly') {
    add('vertices', el('span', { class: 'prop-ro', html: String(e.pts.length) }));
    add('closed', (() => {
      const c = el('input', { type: 'checkbox' });
      c.checked = e.closed;
      c.addEventListener('change', () => { mutate('Toggle closed', () => { e.closed = c.checked; }); invalidate('scene'); });
      return c;
    })());
    const ap = G.polyAreaPerimeter(e);
    add('perimeter', el('span', { class: 'prop-ro', html: fmtU(ap.perimeter) }));
    if (e.closed) add('area', el('span', { class: 'prop-ro', html: `${fmt(ap.area, 1)} ${App.doc.units}²` }));
    const ex = el('button', { class: 'ab-btn', html: 'Explode' });
    ex.addEventListener('click', () => {
      mutate('Explode', () => {
        const segs = G.polyToSegments(e).map(s => ({ ...s, id: newId(), layer: e.layer }));
        App.doc.entities = App.doc.entities.filter(x => x !== e);
        App.doc.entities.push(...segs);
      });
      setSelection([]);
    });
    add('', ex);
  } else if (e.type === 'text') {
    add('text', (() => {
      const inp = el('input', { value: e.text });
      inp.addEventListener('change', () => { mutate('Edit text', () => { e.text = inp.value; }); invalidate('scene'); });
      inp.addEventListener('keydown', ev => ev.stopPropagation());
      return inp;
    })());
    add('height', numField(e.h, v => { if (v > 0) e.h = v; }));
    add('angle°', numField(-((e.rot || 0) * 180 / Math.PI), v => { e.rot = -v * Math.PI / 180; }, true));
  } else if (e.type === 'point') {
    add('x', numField(e.p.x, v => { e.p.x = v; }));
    add('y', numField(e.p.y, v => { e.p.y = v; }));
  }
  return el('div', { class: 'prop-group' }, el('div', { class: 'prop-title', html: e.type.toUpperCase() }), g);
}

// ---------------------------------------------------------------- tablet panel
export const tabletCfg = JSON.parse(localStorage.getItem('tl-tablet') || 'null') || {
  barrel: 'cycle-tool', eraser: 'delete', keys: {},   // keys: {"h": "line", ...} raw key -> tool id/action
};
function saveTablet() { localStorage.setItem('tl-tablet', JSON.stringify(tabletCfg)); }
const PEN_ACTIONS = [
  ['finish', 'Finish / accept trace'], ['cycle-tool', 'Next tool'], ['pan', 'Pan'], ['undo', 'Undo'], ['esc', 'Esc / cancel'],
  ['toggle-osnap', 'Toggle OSNAP'], ['repeat', 'Repeat last tool'], ['delete', 'Delete hovered'], ['none', 'Nothing'],
];
let listening = null;
function refreshTablet() {
  const box = $('tabletBody');
  box.innerHTML = '';
  const penRow = (labelTxt, key) => {
    const s = el('select', {}, ...PEN_ACTIONS.map(([v, t]) => el('option', { value: v, ...(tabletCfg[key] === v ? { selected: '' } : {}) }, t)));
    s.addEventListener('change', () => { tabletCfg[key] = s.value; saveTablet(); });
    box.append(el('div', { class: 'tb-row' }, el('span', { html: labelTxt }), s));
  };
  penRow('Pen barrel button', 'barrel');
  penRow('Pen eraser end', 'eraser');
  box.append(el('div', { class: 'tb-note', html: 'Tablet express keys send keystrokes. Bind them below: arm, press the pad button, pick what it does.' }));
  const listenBtn = el('button', { class: 'tb-listen' + (listening ? ' armed' : ''), html: listening ? 'press a pad button…' : '+ Bind a pad button' });
  listenBtn.addEventListener('click', () => { listening = listening ? null : { stage: 'key' }; refreshTablet(); });
  box.append(el('div', { class: 'tb-row' }, listenBtn));
  for (const [key, action] of Object.entries(tabletCfg.keys)) {
    const s = el('select', {},
      ...[...App.tools.values()].map(t => el('option', { value: t.id, ...(action === t.id ? { selected: '' } : {}) }, 'Tool: ' + t.name)),
      ...PEN_ACTIONS.map(([v, t]) => el('option', { value: 'act:' + v, ...(action === 'act:' + v ? { selected: '' } : {}) }, t)));
    s.addEventListener('change', () => { tabletCfg.keys[key] = s.value; saveTablet(); });
    const rm = el('button', { class: 'lr-btn', html: icon('close') });
    rm.addEventListener('click', () => { delete tabletCfg.keys[key]; saveTablet(); refreshTablet(); });
    box.append(el('div', { class: 'tb-row' }, el('span', { html: `<kbd>${key}</kbd>` }), el('span', {}, s, rm)));
  }
  const stat = el('div', { class: 'tb-note', html: App.pen.seen ? `Pen detected ✓ (pressure ${App.pen.pressure.toFixed(2)})` : 'No pen seen yet — hover the tablet.' });
  box.append(stat);
}
export function tabletCaptureKey(ev) {
  if (!listening) return false;
  const key = ev.key.toLowerCase();
  if (key === 'escape') { listening = null; refreshTablet(); return true; }
  const RESERVED = new Set(['f3', 'f7', 'f8', 'f9', 'f10', 'f12', 'delete', 'backspace', 'enter', ' ']);
  if (RESERVED.has(key) || ev.ctrlKey || ev.metaKey) {
    listening = null; refreshTablet();
    msg(`"${key}" is reserved — set your tablet driver to send a different key`);
    return true;
  }
  tabletCfg.keys[key] = tabletCfg.keys[key] || 'line';
  listening = null;
  saveTablet(); refreshTablet();
  msg(`Bound pad key "${key}" — choose its tool in the Tablet panel`);
  return true;
}
export function penIndicator(live, pressure) {
  App.pen.seen = App.pen.seen || live;
  if (pressure !== undefined) App.pen.pressure = pressure;
  $('penDot').classList.toggle('live', !!live);
}

// ---------------------------------------------------------------- status bar
function wireChips() {
  const map = { chipSnap: 'snap', chipGrid: 'grid', chipOrtho: 'ortho', chipPolar: 'polar', chipOsnap: 'osnap', chipDyn: 'dyn' };
  for (const [id, key] of Object.entries(map)) {
    $(id).addEventListener('click', () => { toggle(key); });
  }
  $('chipOsnap').addEventListener('contextmenu', ev => {
    ev.preventDefault();
    popover($('chipOsnap'), pop => {
      pop.append(el('h4', { html: 'Object snap modes' }));
      const names = { end: 'Endpoint', mid: 'Midpoint', center: 'Center', quad: 'Quadrant', int: 'Intersection', perp: 'Perpendicular', node: 'Node', near: 'Nearest' };
      for (const [key, labelTxt] of Object.entries(names)) {
        const c = el('input', { type: 'checkbox' });
        c.checked = App.osnapModes[key];
        c.addEventListener('change', () => { App.osnapModes[key] = c.checked; });
        pop.append(el('label', {}, c, labelTxt));
      }
    });
  });
  $('chipPolar').addEventListener('contextmenu', ev => {
    ev.preventDefault();
    popover($('chipPolar'), pop => {
      pop.append(el('h4', { html: 'Polar increment' }));
      for (const a of [15, 30, 45, 90]) {
        const b = el('button', { class: 'ab-btn', html: a + '°', style: 'margin:2px' });
        b.addEventListener('click', () => { App.polarStep = a; closePop(); msg(`Polar ${a}°`); });
        pop.append(b);
      }
    });
  });
  $('chipUnits').addEventListener('click', () => {
    popover($('chipUnits'), pop => {
      pop.append(el('h4', { html: 'Units & precision' }));
      const us = el('select', {}, ...['mm', 'cm', 'in'].map(u => el('option', { value: u, ...(App.doc.units === u ? { selected: '' } : {}) }, u)));
      us.addEventListener('change', () => { App.doc.units = us.value; refreshAll(); setDirty(true); scheduleAutosave(); });
      const pr = el('select', {}, ...[0, 1, 2, 3, 4].map(p => el('option', { value: p, ...(App.doc.precision === p ? { selected: '' } : {}) }, `${p} decimals`)));
      pr.addEventListener('change', () => { App.doc.precision = +pr.value; refreshAll(); setDirty(true); scheduleAutosave(); });
      pop.append(el('label', {}, 'Units ', us), el('label', {}, 'Precision ', pr));
    });
  });
  $('chipZoom').addEventListener('click', () => {
    popover($('chipZoom'), pop => {
      const items = [
        ['Zoom fit', () => zoomFit(), 'Shift+1'],
        ['Zoom selection', () => zoomFit(selectedEntities().length ? selectedEntities() : null), 'Shift+2'],
        ['1:1 physical', () => zoomPhysical(), ''],
        ['100%', () => { App.view.z = 1; invalidateView(); }, ''],
      ];
      for (const [labelTxt, cb, kbd] of items) {
        const b = el('button', { class: 'ab-btn', html: `${labelTxt} ${kbd ? `<kbd>${kbd}</kbd>` : ''}`, style: 'display:flex;justify-content:space-between;gap:16px;width:100%;margin:2px 0' });
        b.addEventListener('click', () => { cb(); closePop(); });
        pop.append(b);
      }
    });
  });
  $('chipCal').addEventListener('click', () => setTool('calibrate'));
  refreshChips();
}
export function toggle(key) {
  App.toggles[key] = !App.toggles[key];
  if (key === 'ortho' && App.toggles.ortho) App.toggles.polar = false;
  if (key === 'polar' && App.toggles.polar) App.toggles.ortho = false;
  refreshChips();
  invalidate(key === 'grid' ? 'grid' : 'overlay');
  msg(`${key.toUpperCase()} ${App.toggles[key] ? 'on' : 'off'}`);
}
function refreshChips() {
  const map = { chipSnap: 'snap', chipGrid: 'grid', chipOrtho: 'ortho', chipPolar: 'polar', chipOsnap: 'osnap', chipDyn: 'dyn' };
  for (const [id, key] of Object.entries(map)) $(id).classList.toggle('on', App.toggles[key]);
  $('chipUnits').textContent = `${App.doc.units} · ${(1 / Math.pow(10, App.doc.precision)).toFixed(App.doc.precision)}`;
  updateCalChip();
}
function updateCalChip() {
  const c = $('chipCal');
  if (App.calibrated) { c.textContent = `CAL ${App.CAL.toFixed(2)} px/mm ✓`; c.classList.remove('warn'); }
  else { c.textContent = 'UNCAL'; c.classList.add('warn'); }
}
function updateZoomChip() { $('chipZoom').textContent = Math.round(App.view.z * 100) + '%'; }
export function updateCoords(p, anchor) {
  $('coX').textContent = 'X ' + fmt(p.x);
  $('coY').textContent = 'Y ' + fmt(p.y);
  const d = $('coD');
  if (anchor) {
    d.hidden = false;
    let ang = -Math.atan2(p.y - anchor.y, p.x - anchor.x) * 180 / Math.PI;
    if (ang < 0) ang += 360;
    d.textContent = `Δ ${fmt(G.dist(anchor, p))} ∠ ${ang.toFixed(1)}°`;
  } else d.hidden = true;
}

// ---------------------------------------------------------------- dyn input
let dynCommit = null;
export function summonDyn(prefill = '') {
  if (!App.toggles.dyn) return;
  const dyn = $('dyninput');
  dyn.hidden = false;
  const cur = window.__lastCursor || { x: 200, y: 200 };
  dyn.style.left = Math.min(viewSize().w - 170, cur.x + 36) + 'px';
  dyn.style.top = Math.min(viewSize().h - 60, cur.y + 36) + 'px';
  const inp = $('dynMain');
  $('dynGhost').textContent = App.doc.units;
  inp.value = prefill;
  inp.focus();
}
export function hideDyn() { $('dyninput').hidden = true; $('dynMain').value = ''; }
function wireDyn() {
  const inp = $('dynMain');
  inp.addEventListener('keydown', ev => {
    ev.stopPropagation();
    if (ev.key === 'Enter') {
      const str = inp.value.trim();
      hideDyn();
      if (str && App.tool?.onInput) {
        const parsed = window.__parseCoordInput(str);
        if (parsed) App.tool.onInput(parsed, str);
        else msg('Could not parse: ' + str);
      }
      $('cvOverlay').focus?.();
    } else if (ev.key === 'Escape') hideDyn();
  });
}

// ---------------------------------------------------------------- text prompt
function textPrompt(screenPt, initial, cb) {
  const dyn = el('div', { class: 'dynfield', style: `position:absolute;z-index:60;left:${screenPt.x + 8}px;top:${screenPt.y - 14}px` });
  const inp = el('input', { value: initial, style: 'width:160px' });
  dyn.append(inp);
  $('viewport').append(dyn);
  inp.focus();
  let finished = false;   // Enter and the follow-up blur both call done — run once
  const done = commit => { if (finished) return; finished = true; dyn.remove(); cb(commit ? inp.value.trim() : null); };
  inp.addEventListener('keydown', ev => {
    ev.stopPropagation();
    if (ev.key === 'Enter') done(true);
    if (ev.key === 'Escape') done(false);
  });
  inp.addEventListener('blur', () => done(true));
}

// ---------------------------------------------------------------- exports
function svgOut() {
  const ents = decomposeForExport(visibleEntities());
  const b = drawingBounds(ents.filter(e => e.type !== 'text')) || { minX: 0, minY: 0, maxX: 100, maxY: 100 };
  const m = 5;
  const f = n => +n.toFixed(4);
  const layers = {};
  for (const e of ents) (layers[e.layer] = layers[e.layer] || []).push(e);
  let out = '';
  for (const [lid, list] of Object.entries(layers)) {
    const layer = App.doc.layers.find(l => l.id === lid) || { name: lid, color: '#000' };
    let body = '';
    for (const e of list) {
      if (e.type === 'line') body += `<line x1="${f(e.a.x)}" y1="${f(e.a.y)}" x2="${f(e.b.x)}" y2="${f(e.b.y)}"/>`;
      else if (e.type === 'circle') body += `<circle cx="${f(e.c.x)}" cy="${f(e.c.y)}" r="${f(e.r)}"/>`;
      else if (e.type === 'arc') {
        const sw = G.sweep(e.a0, e.a1);
        const x0 = e.c.x + e.r * Math.cos(e.a0), y0 = e.c.y + e.r * Math.sin(e.a0);
        const x1 = e.c.x + e.r * Math.cos(e.a1), y1 = e.c.y + e.r * Math.sin(e.a1);
        body += `<path d="M ${f(x0)} ${f(y0)} A ${f(e.r)} ${f(e.r)} 0 ${sw > Math.PI ? 1 : 0} 1 ${f(x1)} ${f(y1)}"/>`;
      } else if (e.type === 'poly') {
        let d2 = '';
        const n = e.pts.length;
        d2 += `M ${f(e.pts[0].x)} ${f(e.pts[0].y)}`;
        const segs = e.closed ? n : n - 1;
        for (let i = 0; i < segs; i++) {
          const p1 = e.pts[i], p2 = e.pts[(i + 1) % n];
          if (!p1.bulge) d2 += ` L ${f(p2.x)} ${f(p2.y)}`;
          else {
            const arc = G.bulgeToArc(p1, p2, p1.bulge);
            const sw = G.sweep(arc.a0, arc.a1);
            d2 += ` A ${f(arc.r)} ${f(arc.r)} 0 ${sw > Math.PI ? 1 : 0} ${p1.bulge > 0 ? 1 : 0} ${f(p2.x)} ${f(p2.y)}`;
          }
        }
        if (e.closed) d2 += ' Z';
        body += `<path d="${d2}"/>`;
      } else if (e.type === 'point') {
        body += `<circle cx="${f(e.p.x)}" cy="${f(e.p.y)}" r="0.5" fill="currentColor"/>`;
      } else if (e.type === 'text') {
        const deg = (e.rot || 0) * 180 / Math.PI;
        body += `<text x="${f(e.p.x)}" y="${f(e.p.y)}" font-size="${f(e.h)}" font-family="monospace" fill="${layer.color}" stroke="none"${deg ? ` transform="rotate(${f(deg)} ${f(e.p.x)} ${f(e.p.y)})"` : ''}>${e.text.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</text>`;
      }
    }
    out += `<g id="${layer.name.replace(/"/g, '')}" stroke="${layer.color}" color="${layer.color}">${body}</g>`;
  }
  const w = f(b.maxX - b.minX + 2 * m), h = f(b.maxY - b.minY + 2 * m);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}mm" height="${h}mm" viewBox="${f(b.minX - m)} ${f(b.minY - m)} ${w} ${h}" fill="none" stroke-width="0.25">${out}</svg>`;
}

function pdfOut() {
  // decompose everything to primitives; each arc its own subpath so direction is unambiguous
  const ents = decomposeForExport(visibleEntities());
  const b = drawingBounds(ents.filter(e => e.type !== 'text')) || { minX: 0, minY: 0, maxX: 100, maxY: 100 };
  const m = 10;
  const W = b.maxX - b.minX + 2 * m, H = b.maxY - b.minY + 2 * m;
  const tx = p => ({ x: p.x - b.minX + m, y: p.y - b.minY + m });
  const paths = [], texts = [];
  const hex2rgb = hx => {
    const v = parseInt(hx.slice(1), 16);
    return [(v >> 16 & 255) / 255, (v >> 8 & 255) / 255, (v & 255) / 255];
  };
  for (const e of ents) {
    const color = [0, 0, 0];   // print black regardless of screen layer color
    if (e.type === 'line') paths.push({ segs: [{ m: tx(e.a) }, { l: tx(e.b) }], strokeRGB: color, widthMM: 0.25 });
    else if (e.type === 'circle') {
      const c = tx(e.c);
      paths.push({ segs: [{ m: { x: c.x + e.r, y: c.y } }, { a: { c, r: e.r, a0: 0, a1: Math.PI } }, { a: { c, r: e.r, a0: Math.PI, a1: G.TAU } }], strokeRGB: color, widthMM: 0.25 });
    } else if (e.type === 'arc') {
      const c = tx(e.c);
      const start = { x: c.x + e.r * Math.cos(e.a0), y: c.y + e.r * Math.sin(e.a0) };
      paths.push({ segs: [{ m: start }, { a: { c, r: e.r, a0: e.a0, a1: e.a1 } }], strokeRGB: color, widthMM: 0.25 });
    } else if (e.type === 'poly') {
      for (const s of G.polyToSegments(e)) {
        if (s.type === 'line') paths.push({ segs: [{ m: tx(s.a) }, { l: tx(s.b) }], strokeRGB: color, widthMM: 0.25 });
        else {
          const c = tx(s.c);
          paths.push({ segs: [{ m: { x: c.x + s.r * Math.cos(s.a0), y: c.y + s.r * Math.sin(s.a0) } }, { a: { c, r: s.r, a0: s.a0, a1: s.a1 } }], strokeRGB: color, widthMM: 0.25 });
        }
      }
    } else if (e.type === 'point') {
      const p = tx(e.p);
      paths.push({ segs: [{ m: { x: p.x - 1, y: p.y } }, { l: { x: p.x + 1, y: p.y } }], strokeRGB: color, widthMM: 0.25 });
      paths.push({ segs: [{ m: { x: p.x, y: p.y - 1 } }, { l: { x: p.x, y: p.y + 1 } }], strokeRGB: color, widthMM: 0.25 });
    } else if (e.type === 'text') {
      const p = tx(e.p);
      texts.push({ xMM: p.x, yMM: p.y, text: e.text, sizeMM: e.h, rotRad: e.rot || 0 });
    }
  }
  return writePDF([{ widthMM: W, heightMM: H, paths, texts }]);
}

function doExport(kind, reviewed = false) {
  if (!reviewed && App.ui.reviewContours) return App.ui.reviewContours(() => doExport(kind, true));
  const name = (App.doc.name || 'drawing').replace(/[^\w.-]+/g, '_');
  try {
    if (kind === 'dxf') {
      const ents = decomposeForExport(App.doc.entities);
      const dxf = writeDXF(ents, App.doc.layers, { units: App.doc.units === 'in' ? 'in' : 'mm' });
      download(dxf, name + '.dxf', 'application/dxf');
      msg(`Exported ${ents.length} entities → ${name}.dxf`);
    } else if (kind === 'svg') {
      download(svgOut(), name + '.svg', 'image/svg+xml');
      msg('Exported SVG (true mm scale)');
    } else if (kind === 'pdf') {
      download(new Blob([pdfOut()], { type: 'application/pdf' }), name + '.pdf', 'application/pdf');
      msg('Exported PDF at 1:1 — print with "Actual size"');
    }
    localStorage.setItem('tl-lastexport', kind);
    $('exportBtn').textContent = 'Export ' + kind.toUpperCase();
  } catch (err) {
    console.error(err);
    toast('Export failed: ' + err.message);
  }
}

// ---------------------------------------------------------------- file ops
function openFile() {
  const fp = $('filePick');
  fp.accept = '.json,.dxf';
  fp.onchange = async () => {
    const file = fp.files[0];
    fp.value = '';
    if (!file) return;
    const lower = file.name.toLowerCase();
    if (lower.endsWith('.json')) {
      try { loadProject(await file.text()); toast('Project loaded'); refreshAll(); zoomFit(); }
      catch (err) { toast('Open failed: ' + err.message); }
    } else if (lower.endsWith('.dxf')) {
      importDXF(await file.text(), file.name);
    }
  };
  fp.click();
}
function openImageFile() {
  const fp = $('imagePick');
  fp.onchange = () => {
    const file = fp.files[0];
    fp.value = '';
    if (file) importUnderlay(file);
  };
  fp.click();
}
function zoomUnderlay(u) {
  const origin = { x: u.x, y: u.y };
  const corners = [
    origin,
    { x: u.x + u.wMM, y: u.y },
    { x: u.x + u.wMM, y: u.y + u.hMM },
    { x: u.x, y: u.y + u.hMM },
  ].map(p => G.rotatePt(p, origin, u.rotation || 0));
  const b = {
    minX: Math.min(...corners.map(p => p.x)), maxX: Math.max(...corners.map(p => p.x)),
    minY: Math.min(...corners.map(p => p.y)), maxY: Math.max(...corners.map(p => p.y)),
  };
  const { w, h } = viewSize(), bw = Math.max(b.maxX - b.minX, 1), bh = Math.max(b.maxY - b.minY, 1);
  App.view.z = Math.min(400, Math.max(0.005, Math.min(w / (bw * App.CAL) * 0.85, h / (bh * App.CAL) * 0.85)));
  const scale = App.view.z * App.CAL;
  App.view.x = b.minX - (w / scale - bw) / 2;
  App.view.y = b.minY - (h / scale - bh) / 2;
  invalidateView();
}
function importDXF(text, fname) {
  try {
    const res = readDXF(text);
    mutate(`Imported ${fname}`, () => {
      const layerMap = {};
      for (const il of res.layers || []) {
        let existing = App.doc.layers.find(l => l.name === il.name);
        if (!existing) {
          existing = { id: 'L' + newId(), name: il.name, color: il.color || '#DEE3EC', ltype: il.ltype || 'continuous', visible: il.visible !== false, locked: false };
          App.doc.layers.push(existing);
        }
        layerMap[il.name] = existing.id;
      }
      for (const e of res.entities) {
        e.id = newId();
        e.layer = layerMap[e.layer] || App.doc.currentLayer;
        App.doc.entities.push(e);
      }
    });
    zoomFit();
    refreshAll();
    toast(`Imported ${res.entities.length} entities${res.warnings?.length ? ` · ${res.warnings.length} warnings (console)` : ''}`);
    if (res.warnings?.length) console.warn('DXF import warnings:', res.warnings);
  } catch (err) {
    console.error(err);
    toast('DXF import failed: ' + err.message);
  }
}
function importUnderlay(file) {
  if (!file?.size || file.size > 24 * 1024 * 1024) { toast('Choose an image file smaller than 24 MB.'); return; }
  const rd = new FileReader();
  rd.onerror = () => toast('Could not read that image file');
  rd.onload = () => {
    const img = new Image();
    img.onerror = () => toast('That image could not be decoded');
    img.onload = () => {
      if (!img.naturalWidth || !img.naturalHeight || img.naturalWidth * img.naturalHeight > 64 * 1024 * 1024) { toast('Choose an image smaller than 64 megapixels.'); return; }
      const wMM = img.naturalWidth * 25.4 / 96, hMM = img.naturalHeight * 25.4 / 96;
      const c = { x: App.view.x + viewSize().w / k() / 2, y: App.view.y + viewSize().h / k() / 2 };
      const u = { dataURL: rd.result, x: c.x - wMM / 2, y: c.y - hMM / 2, wMM, hMM, opacity: 0.5, visible: true, rotation: 0 };
      setUnderlay(u, img);
      zoomUnderlay(u);
      toast('Image uploaded — choose File → Auto-trace image outline');
      refreshProps();
    };
    img.src = rd.result;
  };
  rd.readAsDataURL(file);
}
function autoTraceUnderlay() {
  const underlay = App.doc.underlay, img = getUnderlayImg();
  if (!underlay || !img?.naturalWidth) { toast('Upload an image first'); return; }
  const ratio = Math.min(1, 2048 / Math.max(img.naturalWidth, img.naturalHeight));
  const width = Math.round(img.naturalWidth * ratio), height = Math.round(img.naturalHeight * ratio);
  if (width < 16 || height < 16) { toast('Choose an image at least 16 × 16 pixels on each side.'); return; }
  const source = document.createElement('canvas'); source.width = width; source.height = height;
  const sourceCtx = source.getContext('2d', { willReadFrequently: true });
  if (!sourceCtx) { toast('Image processing is unavailable in this window.'); return; }
  sourceCtx.fillStyle = '#fff'; sourceCtx.fillRect(0, 0, width, height); sourceCtx.drawImage(img, 0, 0, width, height);
  showModal(box => {
    box.classList.add('trace-modal');
    box.setAttribute('role', 'dialog'); box.setAttribute('aria-modal', 'true'); box.setAttribute('aria-labelledby', 'trace-title');
    const close = el('button', { class: 'trace-close', 'aria-label': 'Close auto-trace', html: '×', onclick: hideModal });
    box.append(el('header', { class: 'trace-header' }, el('div', {}, el('h3', { id: 'trace-title', html: 'Auto-trace image' }), el('p', { html: 'Select a part, then check its outline before adding it.' })), close));
    const body = el('div', { class: 'trace-body' }); box.append(body);
    const crop = el('button', { class: 'trace-button', html: 'Crop part', 'aria-pressed': 'false' });
    const reset = el('button', { class: 'trace-button', html: 'Reset crop' });
    const cropInfo = el('span', { class: 'trace-crop-info' });
    const edit = el('button', { class: 'trace-button', html: 'Edit outline', 'aria-pressed': 'false', disabled: '' });
    body.append(el('div', { class: 'trace-toolbar' }, crop, reset, edit, cropInfo));
    const editBar=el('div',{class:'trace-edit-toolbar',hidden:''});
    const editButton=(text)=>{const b=el('button',{class:'trace-button',html:text});editBar.append(b);return b;};
    const drawOpening=editButton('Draw opening'),finishOpening=editButton('Finish opening'),cancelOpening=editButton('Cancel opening'),insertPoint=editButton('Insert point'),removePoint=editButton('Remove point'),removeOutline=editButton('Remove outline'),convertCircle=editButton('Convert to points');
    const undoEdit=editButton('Undo edit'),redoEdit=editButton('Redo edit'),resetEdits=editButton('Reset edits');
    const panView=editButton('Pan view'),zoomOut=editButton('−'),zoomIn=editButton('+'),fitPreview=editButton('Fit image');
    panView.setAttribute('aria-pressed','false');zoomOut.setAttribute('aria-label','Zoom out preview');zoomIn.setAttribute('aria-label','Zoom in preview');
    const selectedInfo=el('span',{class:'trace-selected-info','aria-live':'polite'});editBar.append(selectedInfo);body.append(editBar);
    const preview = document.createElement('canvas'); preview.width = width; preview.height = height;
    preview.setAttribute('aria-label', 'Photo and outline preview. In edit mode drag handles, double-click an edge to add a point, or use arrow keys to adjust the selected handle.');
    preview.tabIndex=0;
    const stage = el('div', { class: 'trace-stage' }, preview); body.append(stage);
    const instructions = el('p', { class: 'trace-help', html: 'Cyan: detected outline · Amber: crop or edges to review. Leave background around every edge of the part.' });
    body.append(instructions);
    const contrast = el('input', { id: 'trace-contrast', type: 'range', min: '.15', max: '1.5', step: '.05', value: '.35' });
    const value = el('output', { for: 'trace-contrast', html: '0.35' });
    const details = el('input', { id: 'trace-openings', type: 'checkbox' });
    body.append(el('div', { class: 'trace-settings' }, el('div', { class: 'trace-contrast' }, el('label', { for: 'trace-contrast', html: 'Edge contrast' }), value, contrast), el('label', { class: 'trace-check', for: 'trace-openings' }, details, el('span', {}, 'Keep small or irregular openings', el('small', { html: 'Includes more detail, but may also include glare and texture.' })))));
    const bounds = el('details', { class: 'trace-bounds' }, el('summary', { html: 'Set crop bounds in pixels' }));
    const fields = {}, fieldRow = el('div', { class: 'trace-bound-fields' });
    for (const [key, label] of [['x','Left'], ['y','Top'], ['w','Width'], ['h','Height']]) {
      fields[key] = el('input', { type: 'number', step: '1', min: key === 'w' || key === 'h' ? '16' : '0', id: `trace-${key}` });
      fieldRow.append(el('label', { for: `trace-${key}` }, label, fields[key]));
    }
    bounds.append(fieldRow); body.append(bounds);
    const status = el('div', { class: 'trace-status', role: 'status', 'aria-live': 'polite' }); body.append(status);
    const accept = el('button', { class: 'trace-button trace-accept', html: 'Add outline', disabled: '' });
    box.append(el('footer', { class: 'trace-footer' }, el('span', {}, 'Processed on this device · Check scale before export.'), el('div', { class: 'trace-actions' }, el('button', { class: 'trace-button', html: 'Cancel', onclick: hideModal }), accept)));
    let roi = { x: 0, y: 0, w: width, h: height }, start = null, previousROI = null, result = null, cropMode = false;
    let worker = null, request = 0, timer = null, deadline = null, alive = true;
    let editor=null,editMode=false,selection=null,editDrag=null,draft=null,panMode=false,previewZoom=1,previewPan={x:0,y:0};
    const setCropMode = on => {
      if(on){setEditMode(false);previewZoom=1;previewPan={x:0,y:0};}
      cropMode = on; crop.setAttribute('aria-pressed', String(on)); stage.classList.toggle('is-cropping', on);
      instructions.textContent = on ? 'Drag a box around one part. Keep a margin of background on all sides.' : 'Cyan: detected outline · Amber: crop or edges to review. Leave background around every edge of the part.';
    };
    const syncFields = () => {
      for (const key of ['x','y','w','h']) fields[key].value = roi[key];
      cropInfo.textContent = `${roi.w} × ${roi.h} px${roi.w === width && roi.h === height ? ' · Full image' : ' · Selected area'}`;
    };
    const paint = () => {
      const ctx = preview.getContext('2d'); ctx.setTransform(1,0,0,1,0,0);ctx.clearRect(0,0,width,height);
      ctx.setTransform(previewZoom,0,0,previewZoom,previewPan.x,previewPan.y);ctx.drawImage(source, 0, 0);
      ctx.lineWidth = Math.max(1, width / 600)/previewZoom; ctx.strokeStyle = '#00ffff';
      for (const e of editor?.entities || result?.entities || []) {
        ctx.beginPath();
        if (e.type === 'circle') ctx.arc(e.c.x, e.c.y, e.r, 0, Math.PI * 2);
        else { e.pts.forEach((p, i) => i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)); ctx.closePath(); }
        ctx.stroke();
      }
      ctx.strokeStyle='#ffbd4a';
      for(const [a,b] of (editor?.dirty?[]:result?.quality?.weakSegments)||[]){ctx.beginPath();ctx.moveTo(a.x,a.y);ctx.lineTo(b.x,b.y);ctx.stroke();}
      if(editMode&&editor){
        const scale=displayScale()*previewZoom,selected=editor.entities[selection?.entity];
        ctx.lineWidth=1.5/scale;ctx.fillStyle='#f7fbff';ctx.strokeStyle='#00ffff';
        const handles=selected?.type==='circle'?[selected.c,{x:selected.c.x+selected.r,y:selected.c.y}]:selected?.pts||[];
        let lastHandle=null;
        for(let i=0;i<handles.length;i++){const p=handles[i],chosen=selected?.type==='circle'?(selection.handle==='center'?i===0:i===1):selection.point===i;if(!chosen&&lastHandle&&Math.hypot(p.x-lastHandle.x,p.y-lastHandle.y)*scale<8)continue;lastHandle=p;ctx.beginPath();ctx.arc(p.x,p.y,(chosen?5:3.5)/scale,0,Math.PI*2);ctx.fillStyle=chosen?'#ffbd4a':'#f7fbff';ctx.fill();ctx.stroke();}
        if(draft?.length){ctx.beginPath();draft.forEach((p,i)=>i?ctx.lineTo(p.x,p.y):ctx.moveTo(p.x,p.y));ctx.strokeStyle='#ffbd4a';ctx.stroke();for(const p of draft){ctx.beginPath();ctx.arc(p.x,p.y,4/scale,0,Math.PI*2);ctx.fillStyle='#ffbd4a';ctx.fill();}}
      }
      if (roi.x === 0 && roi.y === 0 && roi.w === width && roi.h === height && !start) return;
      ctx.fillStyle = 'rgba(0,0,0,.4)';
      ctx.fillRect(0, 0, width, roi.y); ctx.fillRect(0, roi.y + roi.h, width, height - roi.y - roi.h);
      ctx.fillRect(0, roi.y, roi.x, roi.h); ctx.fillRect(roi.x + roi.w, roi.y, width - roi.x - roi.w, roi.h);
      ctx.strokeStyle = '#ffbd4a'; ctx.strokeRect(roi.x, roi.y, roi.w, roi.h);
    };
    const invalidateResult = () => { request++; clearTimeout(timer); clearTimeout(deadline); worker?.terminate(); worker = null; result = null; editor=null;selection=null;draft=null;edit.disabled=true;accept.disabled = true; };
    const run = () => {
      if(editor?.dirty){status.textContent='Reset edits before changing automatic tracing settings.';return;}
      invalidateResult(); syncFields(); paint();
      if (roi.w < 16 || roi.h < 16 || roi.x < 0 || roi.y < 0 || roi.x + roi.w > width || roi.y + roi.h > height) {
        status.dataset.state = 'error'; status.textContent = 'Choose a crop at least 16 × 16 pixels inside the image, or reset the crop.'; return;
      }
      status.dataset.state = 'busy'; status.textContent = 'Finding the outline…';
      const id = request;
      timer = setTimeout(() => {
        if (!alive || id !== request) return;
        let settled=false;
        const finish = ({ result: local, error }) => {
          if (settled || !alive || id !== request) return;
          settled=true;
          clearTimeout(deadline);deadline=null;
          worker?.terminate(); worker = null;
          if (error) { status.dataset.state = 'error'; status.textContent = error; return; }
          const issue=local&&Array.isArray(local.entities)?outlineIssue(local.entities):'No valid outline was returned.';
          if(issue){status.dataset.state='error';status.textContent='The automatic outline is invalid. Crop around the part and try again. '+issue;return;}
          const offset = p => ({ x: p.x + roi.x, y: p.y + roi.y });
          result = { ...local, entities: local.entities.map(e => e.type === 'circle' ? { ...e, c: offset(e.c) } : { ...e, pts: e.pts.map(offset) }) };
          if(local.quality)result.quality={...local.quality,weakSegments:(local.quality.weakSegments||[]).map(segment=>segment.map(offset))};
          status.dataset.state = local.warnings?.length?'warning':'ready';
          status.textContent = `${result.engine?.startsWith('MobileSAM')?'AI outline · ':''}${result.entities.length} contours found.${local.suppressedOpenings ? ` ${local.suppressedOpenings} possible openings hidden; enable detail to inspect them.` : ''} ${local.warnings?.length?' '+local.warnings.join(' '):' Inspect shadows and openings before adding.'}`;
          editor=createOutlineEditor(result.entities);edit.disabled=false;selection=firstSelection();
          accept.disabled = false;updateEditorControls();paint();
        };
        try {
          const rgba = sourceCtx.getImageData(roi.x, roi.y, roi.w, roi.h).data;
          const options = { sensitivity: Number(contrast.value), keepSmallHoles: details.checked };
          worker = new Worker(new URL('./autotrace-worker.js', import.meta.url), { type: 'module' });
          worker.onmessage = ({ data }) => {
            if(!data||data.id!==id||settled||!alive||id!==request)return;
            if(data.progress){status.dataset.state='busy';status.textContent=data.progress;return;}
            finish(data);
          };
          worker.onerror = ev => { ev.preventDefault(); finish({ error: 'The outline engine could not start. Check the app installation and try again.' }); };
          worker.onmessageerror = () => finish({error:'The outline result could not be read. Try tracing again.'});
          deadline=setTimeout(()=>finish({error:'Tracing took too long. Crop closer around one part and try again.'}),120000);
          worker.postMessage({ id, width: roi.w, height: roi.h, rgba, options }, [rgba.buffer]);
        } catch (err) { finish({ error: err.name==='SecurityError'?'Upload the image from a local file before tracing.':err.message }); }
      }, 100);
    };
    const displayScale=()=>{const r=preview.getBoundingClientRect();return Math.min(r.width/width,r.height/height);};
    const position = ev => {
      const r = preview.getBoundingClientRect(), scale = Math.min(r.width / width, r.height / height);
      const x=((ev.clientX-r.left-(r.width-width*scale)/2)/scale-previewPan.x)/previewZoom,y=((ev.clientY-r.top-(r.height-height*scale)/2)/scale-previewPan.y)/previewZoom;
      return {x:Math.max(0,Math.min(width,editMode?x:Math.round(x))),y:Math.max(0,Math.min(height,editMode?y:Math.round(y)))};
    };
    const updateDrag = ev => { const p = position(ev); roi = { x: Math.min(start.x,p.x), y: Math.min(start.y,p.y), w: Math.abs(p.x-start.x), h: Math.abs(p.y-start.y) }; syncFields(); paint(); };
    preview.onpointerdown = ev => {
      if(editMode&&editor){editPointerDown(ev);return;}
      if (!cropMode || ev.button !== 0 || !ev.isPrimary || start) return;
      previousROI = { ...roi }; start = { ...position(ev), pointerId: ev.pointerId }; invalidateResult(); preview.setPointerCapture(ev.pointerId); status.textContent = 'Release to trace the selected area.';
    };
    preview.onpointermove = ev => { if(editDrag){editPointerMove(ev);return;}if (start?.pointerId === ev.pointerId) updateDrag(ev); };
    preview.onpointerup = ev => {
      if(editDrag?.pointerId===ev.pointerId){finishEditDrag(ev,false);return;}
      if (start?.pointerId !== ev.pointerId) return;
      updateDrag(ev); start = null; preview.releasePointerCapture(ev.pointerId); setCropMode(false); run();
    };
    const cancelDrag = ev => { if(editDrag?.pointerId===ev.pointerId){finishEditDrag(ev,true);return;}if (start?.pointerId !== ev.pointerId) return; roi = previousROI; start = null; setCropMode(false); run(); };
    preview.onpointercancel = cancelDrag; preview.onlostpointercapture = cancelDrag;
    const firstSelection=()=>editor?.entities.length?{entity:0,...(editor.entities[0].type==='circle'?{handle:'center'}:{point:0})}:null;
    const updateEditorControls=()=>{
      const entity=editor?.entities[selection?.entity],dirty=!!editor?.dirty,busy=!!editDrag;
      edit.disabled=!editor||busy;edit.setAttribute('aria-pressed',String(editMode));editBar.hidden=!editMode;
      for(const input of [contrast,details,crop,reset,...Object.values(fields)])input.disabled=editMode||dirty;
      undoEdit.disabled=!editor?.canUndo||busy||!!draft;redoEdit.disabled=!editor?.canRedo||busy||!!draft;resetEdits.disabled=!dirty||busy||!!draft;
      insertPoint.disabled=busy||!!draft||entity?.type!=='poly';
      removePoint.disabled=draft?busy||!draft.length:busy||entity?.type!=='poly'||selection?.point==null||entity.pts.length<=3;
      removeOutline.disabled=busy||!!draft||!entity;convertCircle.disabled=busy||!!draft||entity?.type!=='circle';
      for(const button of [panView,zoomOut,zoomIn,fitPreview])button.disabled=busy;
      drawOpening.disabled=busy||!!draft;drawOpening.hidden=!!draft;finishOpening.hidden=!draft;cancelOpening.hidden=!draft;finishOpening.disabled=busy||!draft||draft.length<3;convertCircle.hidden=entity?.type!=='circle';
      const issue=editor&&!busy?outlineIssue(editor.entities):'';
      accept.disabled=!editor||busy||!!draft||!!issue;
      if(issue){status.dataset.state='error';status.textContent=issue;}
      else if(dirty){status.dataset.state='ready';status.textContent='Outline adjusted. Check its shape, then add it to the drawing. Reset edits to change automatic tracing settings.';}
      else if(editor&&!draft){status.dataset.state=result.warnings?.length?'warning':'ready';status.textContent=`${result.engine?.startsWith('MobileSAM')?'AI outline · ':''}${editor.entities.length} contours found.${result.suppressedOpenings?` ${result.suppressedOpenings} possible openings hidden; enable detail to inspect them.`:''} ${result.warnings?.join(' ')||'Inspect the outline or choose Edit outline to correct it.'}`;}
      if(draft)selectedInfo.textContent=`New opening · ${draft.length} points · Enter to finish, Escape to cancel`;
      else if(entity?.type==='circle')selectedInfo.textContent=`Circle ${selection.entity+1} · radius ${entity.r.toFixed(2)} px`;
      else if(entity&&selection.point!=null){const p=entity.pts[selection.point];selectedInfo.textContent=`Outline ${selection.entity+1} · Point ${selection.point+1}/${entity.pts.length} · ${p.x.toFixed(2)}, ${p.y.toFixed(2)} px`;}
      else selectedInfo.textContent='Select an outline or point in the photo.';
    };
    const setEditMode=on=>{
      if(editDrag){editor?.cancel();editDrag=null;}
      draft=null;editMode=!!on&&!!editor;stage.classList.toggle('is-editing',editMode);
      if(!editMode){panMode=false;panView.setAttribute('aria-pressed','false');stage.classList.remove('is-panning');previewZoom=1;previewPan={x:0,y:0};}
      if(editMode){setCropMode(false);selection=selection||firstSelection();}
      instructions.textContent=editMode?'Drag a point to move it; double-click an edge to add a point. Circles have center and radius handles. Wheel to zoom; Shift-drag or Pan view to pan. Arrow keys nudge the selected handle.':'Cyan: detected outline · Amber: crop or edges to review. Leave background around every edge of the part.';
      updateEditorControls();paint();
    };
    const editChange=fn=>{
      if(!editor||editDrag)return;editor.begin();fn();editor.commit();updateEditorControls();paint();
    };
    const hitOutline=p=>{
      const threshold=10/(displayScale()*previewZoom),order=editor.entities.map((_,i)=>i);
      if(selection){order.splice(order.indexOf(selection.entity),1);order.unshift(selection.entity);}
      let hit=null,best=threshold;
      for(const index of order){const e=editor.entities[index];if(!e)continue;
        if(e.type==='circle'){
          const center=Math.hypot(p.x-e.c.x,p.y-e.c.y),edge=Math.abs(center-e.r);
          if(center<best){best=center;hit={entity:index,handle:'center'};}
          if(edge<best){best=edge;hit={entity:index,handle:'radius'};}
        }else for(let i=0;i<e.pts.length;i++){
          const distance=Math.hypot(p.x-e.pts[i].x,p.y-e.pts[i].y);
          if(distance<best){best=distance;hit={entity:index,point:i};}
        }
      }
      if(hit)return hit;
      for(const index of order){const e=editor.entities[index];if(e?.type!=='poly')continue;
        for(let i=0;i<e.pts.length;i++){const candidate=closestOnSegment(p,e.pts[i],e.pts[(i+1)%e.pts.length]);if(candidate.distance<best){best=candidate.distance;hit={entity:index,segment:i};}}
      }
      return hit;
    };
    const finishDraft=()=>{
      if(!draft||draft.length<3)return;
      const entity={type:'poly',closed:true,pts:draft.map(p=>({...p}))},issue=outlineIssue([entity]);
      if(issue){status.dataset.state='error';status.textContent=issue;return;}
      const area=entity.pts.reduce((sum,p,i)=>{const q=entity.pts[(i+1)%entity.pts.length];return sum+p.x*q.y-q.x*p.y;},0);
      if(area>0)entity.pts.reverse();draft=null;
      editChange(()=>{editor.entities.push(entity);selection={entity:editor.entities.length-1,point:0};});
    };
    const editPointerDown=ev=>{
      if(!ev.isPrimary||editDrag||![0,1].includes(ev.button))return;ev.preventDefault();preview.focus({preventScroll:true});const p=position(ev);
      if(panMode||ev.shiftKey||ev.altKey||ev.button===1){editDrag={kind:'pan',pointerId:ev.pointerId,x:ev.clientX,y:ev.clientY,pan:{...previewPan}};}
      else if(draft){
        if(draft.length>=3&&Math.hypot(p.x-draft[0].x,p.y-draft[0].y)<8/(displayScale()*previewZoom)){finishDraft();return;}
        if(!draft.length||Math.hypot(p.x-draft.at(-1).x,p.y-draft.at(-1).y)>.5)draft.push(p);
        updateEditorControls();paint();return;
      }else{
        selection=hitOutline(p);updateEditorControls();paint();
        if(!selection||selection.segment!=null)return;
        const e=editor.entities[selection.entity],target=e.type==='circle'?e.c:e.pts[selection.point];
        editor.begin();editDrag={kind:'point',pointerId:ev.pointerId,offset:{x:p.x-target.x,y:p.y-target.y},radius:e.r,distance:e.type==='circle'?Math.hypot(p.x-e.c.x,p.y-e.c.y):0};
      }
      preview.setPointerCapture(ev.pointerId);updateEditorControls();
    };
    const editPointerMove=ev=>{
      if(editDrag?.pointerId!==ev.pointerId)return;
      if(editDrag.kind==='pan'){const scale=displayScale();previewPan={x:editDrag.pan.x+(ev.clientX-editDrag.x)/scale,y:editDrag.pan.y+(ev.clientY-editDrag.y)/scale};paint();return;}
      const p=position(ev),e=editor.entities[selection.entity];
      if(e.type==='circle'){
        if(selection.handle==='radius')e.r=Math.max(.5,Math.min(e.c.x,width-e.c.x,e.c.y,height-e.c.y,editDrag.radius+Math.hypot(p.x-e.c.x,p.y-e.c.y)-editDrag.distance));
        else e.c={x:Math.max(e.r,Math.min(width-e.r,p.x-editDrag.offset.x)),y:Math.max(e.r,Math.min(height-e.r,p.y-editDrag.offset.y))};
      }else e.pts[selection.point]={x:Math.max(0,Math.min(width,p.x-editDrag.offset.x)),y:Math.max(0,Math.min(height,p.y-editDrag.offset.y))};
      updateEditorControls();paint();
    };
    const finishEditDrag=(ev,cancel)=>{
      const drag=editDrag;if(!drag)return;
      if(drag.kind==='point'){if(cancel)editor.cancel();else editor.commit();}
      else if(cancel)previewPan=drag.pan;
      editDrag=null;if(preview.hasPointerCapture(ev.pointerId))preview.releasePointerCapture(ev.pointerId);updateEditorControls();paint();
    };
    const zoomPreview=(factor,anchor={x:width/2,y:height/2})=>{
      const next=Math.max(1,Math.min(16,previewZoom*factor)),p={x:(anchor.x-previewPan.x)/previewZoom,y:(anchor.y-previewPan.y)/previewZoom};
      previewPan={x:anchor.x-p.x*next,y:anchor.y-p.y*next};previewZoom=next;paint();
    };
    edit.onclick=()=>setEditMode(!editMode);
    insertPoint.onclick=()=>{if(insertPoint.disabled)return;editChange(()=>{const e=editor.entities[selection.entity],i=selection.segment??selection.point??0,a=e.pts[i],b=e.pts[(i+1)%e.pts.length];e.pts.splice(i+1,0,{x:(a.x+b.x)/2,y:(a.y+b.y)/2});selection={entity:selection.entity,point:i+1};});};
    removePoint.onclick=()=>{if(removePoint.disabled)return;if(draft){draft.pop();updateEditorControls();paint();return;}editChange(()=>{const e=editor.entities[selection.entity];e.pts.splice(selection.point,1);selection.point=Math.min(selection.point,e.pts.length-1);});};
    removeOutline.onclick=()=>{if(removeOutline.disabled)return;editChange(()=>{editor.entities.splice(selection.entity,1);selection=firstSelection();});};
    convertCircle.onclick=()=>{if(convertCircle.disabled)return;editChange(()=>{editor.entities[selection.entity]={type:'poly',closed:true,pts:circlePoints(editor.entities[selection.entity])};selection={entity:selection.entity,point:0};});};
    drawOpening.onclick=()=>{draft=[];selection=null;panMode=false;panView.setAttribute('aria-pressed','false');updateEditorControls();paint();};
    finishOpening.onclick=finishDraft;cancelOpening.onclick=()=>{draft=null;selection=firstSelection();updateEditorControls();paint();};
    undoEdit.onclick=()=>{editor.undo();selection=firstSelection();updateEditorControls();paint();};
    redoEdit.onclick=()=>{editor.redo();selection=firstSelection();updateEditorControls();paint();};
    resetEdits.onclick=()=>{editor.reset();selection=firstSelection();status.dataset.state=result.warnings?.length?'warning':'ready';status.textContent='Automatic outline restored.';updateEditorControls();paint();};
    panView.onclick=()=>{panMode=!panMode;panView.setAttribute('aria-pressed',String(panMode));stage.classList.toggle('is-panning',panMode);};
    zoomOut.onclick=()=>zoomPreview(1/1.5);zoomIn.onclick=()=>zoomPreview(1.5);
    fitPreview.onclick=()=>{previewZoom=1;previewPan={x:0,y:0};paint();};
    preview.addEventListener('wheel',ev=>{if(!editMode||editDrag)return;ev.preventDefault();if(isMac&&!ev.ctrlKey&&!ev.metaKey){previewPan.x-=ev.deltaX/displayScale();previewPan.y-=ev.deltaY/displayScale();paint();return;}const p=position(ev);zoomPreview(Math.exp(-ev.deltaY*.002),{x:p.x*previewZoom+previewPan.x,y:p.y*previewZoom+previewPan.y});},{passive:false});
    preview.ondblclick=ev=>{
      if(!editMode||!editor||panMode)return;ev.preventDefault();if(draft){finishDraft();return;}
      const p=position(ev),hit=hitOutline(p);if(!hit)return;const e=editor.entities[hit.entity];if(e.type!=='poly')return;
      let closest=null;for(let i=0;i<e.pts.length;i++){const c=closestOnSegment(p,e.pts[i],e.pts[(i+1)%e.pts.length]);if(!closest||c.distance<closest.distance)closest={...c,index:i};}
      if(closest.distance>10/(displayScale()*previewZoom))return;
      const a=e.pts[closest.index],b=e.pts[(closest.index+1)%e.pts.length];
      if(Math.min(Math.hypot(closest.point.x-a.x,closest.point.y-a.y),Math.hypot(closest.point.x-b.x,closest.point.y-b.y))<.25){status.textContent='Zoom in and double-click between two points.';return;}
      editChange(()=>{e.pts.splice(closest.index+1,0,closest.point);selection={entity:hit.entity,point:closest.index+1};});
    };
    const editKeys=ev=>{
      if(!editMode||ev.target.matches('input,textarea'))return;
      if(draft&&['Escape','Enter','Backspace','Delete'].includes(ev.key)){
        ev.preventDefault();ev.stopPropagation();if(ev.key==='Escape')draft=null;else if(ev.key==='Enter')finishDraft();else draft.pop();updateEditorControls();paint();return;
      }
      if((ev.ctrlKey||ev.metaKey)&&['z','y'].includes(ev.key.toLowerCase())){ev.preventDefault();ev.stopPropagation();if(ev.key.toLowerCase()==='y'||ev.shiftKey)redoEdit.click();else undoEdit.click();return;}
      if(ev.target!==preview||editDrag)return;
      if(ev.key==='Delete'||ev.key==='Backspace'){ev.preventDefault();ev.stopPropagation();removePoint.click();return;}
      const step=ev.shiftKey?10:1,delta={ArrowLeft:[-step,0],ArrowRight:[step,0],ArrowUp:[0,-step],ArrowDown:[0,step]}[ev.key];
      const e=editor.entities[selection?.entity];if(!delta||!e||selection.segment!=null)return;ev.preventDefault();ev.stopPropagation();
      editChange(()=>{
        if(e.type==='circle'){
          if(selection.handle==='radius')e.r=Math.max(.5,Math.min(e.c.x,width-e.c.x,e.c.y,height-e.c.y,e.r+delta[0]-delta[1]));
          else e.c={x:Math.max(e.r,Math.min(width-e.r,e.c.x+delta[0])),y:Math.max(e.r,Math.min(height-e.r,e.c.y+delta[1]))};
        }else if(selection.point!=null){const p=e.pts[selection.point];p.x=Math.max(0,Math.min(width,p.x+delta[0]));p.y=Math.max(0,Math.min(height,p.y+delta[1]));}
      });
    };
    box.addEventListener('keydown',editKeys);

    crop.onclick = () => setCropMode(!cropMode);
    reset.onclick = () => { start = null; roi = { x: 0, y: 0, w: width, h: height }; setCropMode(false); run(); };
    for (const key of ['x','y','w','h']) fields[key].onchange = () => {
      const candidate = Object.fromEntries(Object.entries(fields).map(([k,input]) => [k, Number(input.value)]));
      if (Object.values(fields).some(input => input.value === '') || !Object.values(candidate).every(Number.isInteger)) { invalidateResult(); status.dataset.state = 'error'; status.textContent = 'Use whole pixel values for crop bounds.'; return; }
      roi = candidate; setCropMode(false); run();
    };
    contrast.oninput = () => { value.textContent = Number(contrast.value).toFixed(2); run(); }; details.onchange = run;
    accept.onclick = () => {
      if (!result||editDrag||draft) return;
      if(editor){const issue=outlineIssue(editor.entities);if(issue){status.dataset.state='error';status.textContent=issue;return;}}
      if(editor)result.entities=editor.entities;
      if (App.doc.underlay !== underlay) { status.dataset.state = 'error'; status.textContent = 'The image changed. Close this preview and trace the current image.'; accept.disabled = true; return; }
      if (currentLayer()?.locked) { status.dataset.state = 'error'; status.textContent = 'The current layer is locked. Unlock it before adding the outline.'; return; }
      if (autoTraceUnderlayApply(result, width, height)) hideModal();
    };
    const focusTrap = ev => {
      if (ev.key !== 'Tab') return;
      const controls = [...box.querySelectorAll('button,input,summary')].filter(n => !n.disabled && n.getClientRects().length);
      const first = controls[0], last = controls.at(-1);
      if (ev.shiftKey && document.activeElement === first) { ev.preventDefault(); last.focus(); }
      else if (!ev.shiftKey && document.activeElement === last) { ev.preventDefault(); first.focus(); }
    };
    box.addEventListener('keydown', focusTrap);
    modalCleanup = () => { alive = false; invalidateResult(); box.removeEventListener('keydown', focusTrap);box.removeEventListener('keydown',editKeys); };
    run(); crop.focus();
  });
}
function autoTraceUnderlayApply(result, width, height) {
  const underlay = App.doc.underlay;
  if (!underlay) return;
  try {
    if(![underlay.x,underlay.y,underlay.wMM,underlay.hMM,underlay.rotation??0].every(Number.isFinite)||underlay.wMM<=0||underlay.hMM<=0)
      throw new Error('The image scale or position is invalid. Set a positive image size before adding its outline.');
    const origin = { x: underlay.x, y: underlay.y };
    const mapPoint = p => G.rotatePt({
        x: underlay.x + p.x / width * underlay.wMM,
        y: underlay.y + p.y / height * underlay.hMM,
      }, origin, underlay.rotation || 0);
    const sx = underlay.wMM / width, sy = underlay.hMM / height;
    const entities = result.entities.map(e => {
      if (e.type === 'circle' && Math.abs(sx - sy) <= Math.max(sx, sy) * 1e-3)
        return { type: 'circle', c: mapPoint(e.c), r: e.r * (sx + sy) / 2, layer: App.doc.currentLayer };
      const points = e.type === 'circle' ? Array.from({ length: 180 }, (_, i) => ({
        x: e.c.x + e.r * Math.cos(i * Math.PI * 2 / 180), y: e.c.y + e.r * Math.sin(i * Math.PI * 2 / 180),
      })) : e.pts;
      return { type: 'poly', closed: true, layer: App.doc.currentLayer, pts: points.map(mapPoint) };
    });
    if (entities.some(e => e.type === 'circle'
      ? ![e.c.x, e.c.y, e.r].every(Number.isFinite) || e.r <= 0
      : e.pts.some(p => ![p.x, p.y].every(Number.isFinite))))
      throw new Error('The image scale or position exceeds the supported range. Reduce it before adding the outline.');
    const ids = [];
    mutate(`Auto-traced ${entities.length} contours`, () => {
      for (const entity of entities) ids.push(addEntity(entity).id);
    });
    setSelection(ids);
    const circles = entities.filter(e => e.type === 'circle').length;
    toast(`Auto-traced ${entities.length} contours · ${circles} fitted circles. Check the shape and set its scale before export.`, 6500);
    return true;
  } catch (err) {
    toast(err.message || 'Auto-trace failed');
  }
}
let savingProject = false;
async function saveProject() {
  if (savingProject) return;
  if (App.tools.get('freehand')?.pending) { toast('Accept or discard the trace preview before saving'); return; }
  savingProject = true;
  const json = projectJSON(), name = (App.doc.name || 'drawing').replace(/[^\w.-]+/g, '_') + '.trueline.json';
  try {
    if (window.trueLineFiles) {
      const result = await window.trueLineFiles.saveProject({ json, name });
      if (result.canceled) return;
      if (!result.saved) throw new Error(result.error || 'File was not saved');
      if (projectJSON() === json) setDirty(false);
      msg('Project file saved');
    } else {
      download(json, name, 'application/json');
      // Browser downloads provide no completion/cancellation signal.
      toast('Project download started. Confirm the file was saved before closing.', 6000);
    }
    await flushAutosave();
  } catch (err) { toast('Save failed: ' + err.message, 8000); }
  finally { savingProject = false; }
}
function setDirty(d) {
  App.fileDirty = d; $('dirty').hidden = !d;
  try { localStorage.setItem('tl-file-dirty', String(d)); } catch {}
  App.ui.recoveryStatus?.();
}

// ---------------------------------------------------------------- modals
let modalCleanup = null;
let modalReturnFocus = null;
export function showModal(build) {
  modalCleanup?.(); modalCleanup = null;
  modalReturnFocus = document.activeElement;
  const root = $('modalRoot');
  root.hidden = false;
  const box = $('modalBox');
  box.innerHTML = ''; box.classList.remove('trace-modal');
  for (const name of ['role','aria-modal','aria-labelledby']) box.removeAttribute(name);
  build(box);
  $('modalScrim').onclick = hideModal;
}
export function hideModal() {
  modalCleanup?.(); modalCleanup = null; $('modalRoot').hidden = true;
  if (modalReturnFocus?.isConnected && modalReturnFocus !== document.body && modalReturnFocus.getClientRects().length) modalReturnFocus.focus();
  else $('fileBtn')?.focus();
  modalReturnFocus = null;
}

// ---- editable tool key bindings ----
// main.js matches tools by their live `tool.key`, so rebinding = mutate tool.key + persist.
const keyDefaults = new Map();
export function initKeyBindings() {
  for (const [id, t] of App.tools) if (!keyDefaults.has(id)) keyDefaults.set(id, t.key || '');
  let saved = {};
  try { saved = JSON.parse(localStorage.getItem('tl-keys')) || {}; } catch (e) {}
  for (const [id, k] of Object.entries(saved)) {
    const t = App.tools.get(id);
    if (t) t.key = k;
  }
}
function persistKeyBindings() {
  const diff = {};
  for (const [id, def] of keyDefaults) {
    const cur = App.tools.get(id)?.key || '';
    if (cur !== def) diff[id] = cur;
  }
  localStorage.setItem('tl-keys', JSON.stringify(diff));
}
function setToolKey(toolId, keyStr) {
  const lower = keyStr.toLowerCase();
  let stolen = null;
  for (const [id, t] of App.tools) {
    if (id !== toolId && (t.key || '').toLowerCase() === lower) { stolen = t.name; t.key = ''; }
  }
  const t = App.tools.get(toolId);
  if (!t) return;
  t.key = keyStr;
  persistKeyBindings();
  buildPalette();               // refresh tooltips
  if (App.tool) renderCtx(App.tool);
  msg(stolen ? `${t.name} = ${keyStr}  (taken from ${stolen})` : `${t.name} = ${keyStr}`);
}
function resetToolKeys() {
  for (const [id, def] of keyDefaults) { const t = App.tools.get(id); if (t) t.key = def; }
  localStorage.removeItem('tl-keys');
  buildPalette();
  msg('Tool keys reset to defaults');
}
// Accept a keyboard key OR a tablet express-key keystroke. Tablet buttons emit
// ordinary keydowns (letters, function keys, symbols), so binding one is the same
// as binding a key — we just widen what's accepted beyond A–Z.
const RESERVED_BIND = new Set(['Enter', 'Delete', 'Backspace', 'Tab', ' ']);
const TOGGLE_BIND = new Set(['F3', 'F7', 'F8', 'F9', 'F10', 'F12']);   // status-bar toggles
function normalizeBindKey(ev) {
  if (ev.key === 'Escape') return { cancel: true };
  if (['Shift', 'Control', 'Alt', 'Meta', 'AltGraph', 'CapsLock', 'Dead'].includes(ev.key)) return { wait: true };
  if (ev.ctrlKey || ev.altKey || ev.metaKey) return { err: 'no Ctrl/Alt' };
  if (RESERVED_BIND.has(ev.key)) return { err: 'reserved' };
  if (TOGGLE_BIND.has(ev.key)) return { err: ev.key + ' = toggle' };
  if (/^[0-9]$/.test(ev.key)) return { err: 'digit reserved' };   // digits do numeric entry
  const k = ev.key;
  if (k.length === 1 && /[a-z]/i.test(k))                          // a letter: Shift distinguishes m vs Shift+M
    return { key: ev.shiftKey ? 'Shift+' + k.toUpperCase() : k.toUpperCase() };
  // a symbol, function key, or named key (this is the tablet-express-key path)
  return { key: ev.shiftKey && k.length > 1 ? 'Shift+' + k : k };
}

// live key-capture for one row; window-capture phase so it beats the global handlers
let rebindCancel = null;
function beginRebind(kbd, tool) {
  if (rebindCancel) rebindCancel();
  const prev = tool.key;
  kbd.classList.add('capturing');
  kbd.textContent = 'press key / pad button…';
  const handler = ev => {
    ev.preventDefault(); ev.stopPropagation();
    const res = normalizeBindKey(ev);
    if (res.cancel) { done(null); return; }
    if (res.wait) return;                    // bare modifier — wait for the real key
    if (res.err) { kbd.textContent = res.err; return; }
    done(res.key);
  };
  function done(keyStr) {
    window.removeEventListener('keydown', handler, true);
    rebindCancel = null;
    if (keyStr) setToolKey(tool.id, keyStr);
    else kbd.textContent = prev || 'unset';
    shortcutOverlay();                                                   // re-render (conflict clears)
  }
  rebindCancel = () => { window.removeEventListener('keydown', handler, true); kbd.classList.remove('capturing'); kbd.textContent = prev || 'unset'; rebindCancel = null; };
  window.addEventListener('keydown', handler, true);
}

function shortcutOverlay() {
  showModal(box => {
    box.append(el('h3', { html: 'Keyboard shortcuts <small>— Esc to close</small>' }));

    box.append(el('div', { class: 'sc-head', html: 'Tools — click a key, then press a keyboard key or tablet pad button' }));
    const toolGrid = el('div', { class: 'shortcut-grid' });
    for (const grp of TOOL_GROUPS)
      for (const tid of grp.ids) {
        const t = App.tools.get(tid);
        if (!t) continue;
        const kbd = el('button', { class: 'kbd-edit' + (t.key ? '' : ' unset'), title: 'Click, then press a key or tablet pad button' });
        kbd.textContent = t.key || 'unset';
        kbd.addEventListener('click', () => beginRebind(kbd, t));
        toolGrid.append(el('div', {}, el('b', { html: t.name }), kbd));
      }
    box.append(toolGrid);

    box.append(el('div', { class: 'sc-head', html: 'System — fixed' }));
    const sysGrid = el('div', { class: 'shortcut-grid' });
    const rows = [
      ['Undo / Redo', 'Ctrl+Z / Ctrl+Y'], ['Delete selection', 'Del'],
      ['Select all', 'Ctrl+A'], ['Copy / Paste', 'Ctrl+C / Ctrl+V'], ['Save project', 'Ctrl+S'], ['Open', 'Ctrl+O'],
      ['Zoom fit', 'Shift+1'], ['Zoom selection', 'Shift+2'],
      ['OSNAP', 'F3'], ['Grid', 'F7'], ['Ortho', 'F8'], ['Grid snap', 'F9'], ['Polar', 'F10'], ['Dyn input', 'F12'],
      ['Temporary ortho', 'hold Shift'], ['Pan', 'Space-drag / middle-drag'],
      ['Repeat last tool', 'Enter'], ['Help menu', '?'],
    ];
    for (const [n, kk] of rows) sysGrid.append(el('div', {}, el('b', { html: n }), el('kbd', { html: kk })));
    box.append(sysGrid);

    const reset = el('button', { class: 'btn-ghost', html: 'Reset tool keys' });
    reset.addEventListener('click', () => { resetToolKeys(); shortcutOverlay(); });
    const tourBtn = el('button', { class: 'btn-accent', html: '▶ Replay the walkthrough tour' });
    tourBtn.addEventListener('click', () => { hideModal(); startTour(); });
    box.append(el('div', { class: 'modal-actions' }, reset, tourBtn));
  });
}
function helpMenu() {
  popover($('helpBtn'), pop => {
    pop.classList.add('help-menu');
    pop.append(el('h4', { html: 'Help' }));
    const item = (glyph, label, sub, cb) => {
      const b = el('button', { class: 'help-item' },
        el('span', { class: 'help-ico', html: glyph }),
        el('span', { class: 'help-txt' }, el('b', { html: label }), el('small', { html: sub })));
      b.addEventListener('click', () => { closePop(); cb(); });
      return b;
    };
    pop.append(
      item('▶', 'Walkthrough tour', 'Guided 2-minute intro', startTour),
      item('⌨', 'Keyboard shortcuts', 'Every tool & hotkey', shortcutOverlay),
      item('◎', 'Quick tips', 'Trace · calibrate · export', helpTips),
      item('ℹ', 'About TrueLine', 'Version & what it replaces', aboutModal),
    );
  });
}

function helpTips() {
  showModal(box => {
    box.append(el('h3', { html: 'Quick tips <small>— Esc to close</small>' }));
    const tips = [
      ['Set your scale first', 'Click the <b>CAL</b> chip (bottom-right), trace a known length on your tablet, type the true distance. Now everything is real millimeters and the DXF is dimensionally accurate.'],
      ['Trace, then let it clean up', 'Press <kbd>S</kbd> and draw freehand. On release the stroke is fitted to clean lines and arcs — corners detected, near-closed shapes snapped shut. Tune the fit tolerance in the options strip.'],
      ['Type exact numbers while drawing', 'Click a line start, aim, type <kbd>100</kbd> + <kbd>Enter</kbd> for exactly 100 mm. Use <kbd>80x40</kbd> for a rectangle, <kbd>50&lt;30</kbd> for length-and-angle, <kbd>@dx,dy</kbd> relative.'],
      ['Snap to real points', '<b>OSNAP</b> catches endpoints, midpoints, centers and intersections (green glyphs). Right-click the chip to choose which. <kbd>F8</kbd> ortho, hold <kbd>Shift</kbd> for temporary ortho.'],
      ['Proper circles & arcs', 'Circle (<kbd>C</kbd>) has Center·R / 2-Pt / <b>3-Pt</b>; Arc (<kbd>A</kbd>) has 3-Pt and center-start-end — pick the mode in the options strip.'],
      ['Move around the board', 'Wheel zooms at the cursor, <kbd>Space</kbd>-drag or middle-drag pans, <kbd>Shift+1</kbd> fits everything. Touch tablets: one finger pans, two pinch-zoom.'],
      ['Bind your pad buttons', 'Tablet panel (right dock): the pen barrel button cycles tools, the eraser end deletes, and “+ Bind a pad button” maps any express key.'],
      ['Get your file', '<b>Export DXF</b> for CAD/CNC at true scale; SVG and 1:1-printable PDF are in the dropdown. <kbd>Ctrl+S</kbd> saves the project (it also autosaves).'],
    ];
    const list = el('div', { class: 'tips-list' });
    for (const [h, b] of tips)
      list.append(el('div', { class: 'tip' }, el('b', { html: h }), el('p', { html: b })));
    box.append(list);
    const tourBtn = el('button', { class: 'btn-accent', html: '▶ Replay the walkthrough tour' });
    tourBtn.addEventListener('click', () => { hideModal(); startTour(); });
    box.append(el('div', { class: 'modal-actions' }, tourBtn, el('button', { class: 'btn-ghost', html: 'Close', onclick: hideModal })));
  });
}

function aboutModal() {
  showModal(box => {
    box.append(el('h3', { html: 'TrueLine <small>v3.0.0</small>' }));
    box.append(el('p', { class: 'about-lead', html: 'A free, offline replacement for the $1,500 Logic Trace digitizing system. Trace a physical object with a pen tablet, clean up the geometry, and export dimensionally-accurate DXF, SVG, or 1:1 PDF for CNC, CAD, and pattern work.' }));
    box.append(el('p', { class: 'about-sub', html: 'Runs entirely on your machine — no account, no internet, no per-seat license. Your drawings never leave this computer.' }));
    box.append(el('div', { class: 'modal-actions' },
      el('button', { class: 'btn-ghost', html: 'Keyboard shortcuts', onclick: () => { hideModal(); shortcutOverlay(); } }),
      el('button', { class: 'btn-accent', html: 'Close', onclick: hideModal })));
  });
}

function settingsModal() {
  showModal(box => {
    box.append(el('h3', { html: 'Settings' }));
    const g = el('div', { class: 'prop-grid' });
    const add = (labelTxt, node) => g.append(el('label', {}, labelTxt), node);
    const ds = App.doc.dimStyle;
    const mk = (val, cb) => {
      const inp = el('input', { type: 'number', step: 'any', value: val });
      inp.addEventListener('change', () => { const v = parseFloat(inp.value); if (!isNaN(v) && v > 0) { cb(v); invalidate('scene'); setDirty(true); scheduleAutosave(); } });
      return inp;
    };
    add('Dim text height (mm)', mk(ds.textH, v => { ds.textH = v; }));
    add('Dim arrow size (mm)', mk(ds.arrow, v => { ds.arrow = v; }));
    add('Grid step (' + App.doc.units + ')', mk(+fmt(App.doc.gridStep), v => { App.doc.gridStep = parseNum(String(v)); invalidate('grid'); }));
    box.append(g);
    const reset = el('button', { class: 'btn-ghost', html: 'Reset tablet calibration' });
    reset.addEventListener('click', () => {
      localStorage.removeItem('tl-cal');
      App.CAL = 96 / 25.4; App.calibrated = false;
      updateCalChip(); invalidateView(); hideModal();
      toast('Calibration reset to 96 dpi default');
    });
    const wipe = el('button', { class: 'btn-ghost', html: 'Clear older recovery revisions' });
    wipe.addEventListener('click', async () => {
      try { await flushAutosave(); await clearOlderRevisions(); localStorage.removeItem('tl-history'); toast('Older recovery revisions cleared; latest drawing kept'); }
      catch (err) { toast('Could not clear recovery history: ' + err.message); }
    });
    box.append(el('div', { class: 'modal-actions' }, reset, wipe, el('button', { class: 'btn-accent', html: 'Close', onclick: hideModal })));
  });
}

// ---------------------------------------------------------------- app bar
function wireAppBar() {
  $('undoBtn').innerHTML = icon('undo');
  $('redoBtn').innerHTML = icon('redo');
  $('settingsBtn').innerHTML = icon('settings');
  $('exportMore').innerHTML = icon('chevron-down');
  $('undoBtn').onclick = () => { undo(); refreshAll(); };
  $('redoBtn').onclick = () => { redo(); refreshAll(); };
  $('settingsBtn').onclick = settingsModal;
  $('helpBtn').onclick = helpMenu;

  const fileMenu = $('fileMenu');
  $('fileBtn').onclick = ev => { ev.stopPropagation(); fileMenu.hidden = !fileMenu.hidden; $('exportMenu').hidden = true; };
  $('exportMore').onclick = ev => { ev.stopPropagation(); $('exportMenu').hidden = !$('exportMenu').hidden; fileMenu.hidden = true; };
  $('exportBtn').onclick = () => doExport(localStorage.getItem('tl-lastexport') || 'dxf');
  addEventListener('click', () => { fileMenu.hidden = true; $('exportMenu').hidden = true; });

  document.querySelectorAll('[data-cmd]').forEach(b => b.addEventListener('click', () => {
    const cmd = b.dataset.cmd;
    if (cmd === 'tour') startTour();
    else if (cmd === 'new') { if (confirm('Start a new drawing? The current drawing is kept in recovery history.')) { newDoc(); refreshAll(); zoomFit(); } }
    else if (cmd === 'open') openFile();
    else if (cmd === 'save') saveProject();
    else if (cmd === 'upload-image') openImageFile();
    else if (cmd === 'autotrace') autoTraceUnderlay();
    else if (cmd === 'underlay-clear') { setUnderlay(null, null); refreshProps(); }
    else if (cmd === 'export-dxf') doExport('dxf');
    else if (cmd === 'export-svg') doExport('svg');
    else if (cmd === 'export-pdf') doExport('pdf');
  }));

  const dn = $('docname');
  dn.addEventListener('dblclick', () => {
    dn.contentEditable = 'true';
    dn.focus();
    document.execCommand?.('selectAll');
  });
  dn.addEventListener('blur', () => { dn.contentEditable = 'false'; App.doc.name = dn.textContent.trim() || 'untitled'; setDirty(true); scheduleAutosave(); });
  dn.addEventListener('keydown', ev => { ev.stopPropagation(); if (ev.key === 'Enter') { ev.preventDefault(); dn.blur(); } });

  $('exportBtn').textContent = 'Export ' + (localStorage.getItem('tl-lastexport') || 'dxf').toUpperCase();
}
function refreshUndo() {
  $('undoBtn').disabled = !App.undoStack.length;
  $('redoBtn').disabled = !App.redoStack.length;
}

// ---------------------------------------------------------------- panels collapse
function wirePanels() {
  document.querySelectorAll('.panel-h').forEach(h =>
    h.addEventListener('click', () => h.parentElement.classList.toggle('collapsed')));
}

// ---------------------------------------------------------------- first run
function firstRun() {
  if (App.calibrated || localStorage.getItem('tl-frdone')) return;
  $('firstrun').hidden = false;
  const dismiss = () => { $('firstrun').hidden = true; localStorage.setItem('tl-frdone', '1'); };
  $('frStart').onclick = () => { dismiss(); setTool('freehand'); msg('Trace your object — set the scale afterward with 📏 Set scale'); };
  $('frTour').onclick = () => { dismiss(); startTour(); };
}

// ---------------------------------------------------------------- glue
export function refreshAll() {
  refreshLayers(); refreshProps(); refreshChips(); refreshUndo(); refreshTablet();
  if (App.tool) renderCtx(App.tool);
  $('docname').textContent = App.doc.name;
  invalidate('all');
}

export function initUI() {
  localizeShortcuts(document.body);
  // Help, tracing and menus are created lazily. Localize only newly inserted nodes.
  new MutationObserver(records => {
    for (const record of records) for (const node of record.addedNodes) localizeShortcuts(node);
  }).observe(document.body, { childList: true, subtree: true });
  initKeyBindings();          // apply saved rebinds before palette tooltips render
  buildPalette();
  wireLayerTools();
  wireChips();
  wireAppBar();
  wirePanels();
  wireDyn();
  firstRun();
  App.ui = {
    msg, hint, toast,
    refreshLayers, refreshProps, refreshUndo, refreshAll,
    refreshCtx: () => App.tool && renderCtx(App.tool),
    onToolChange: t => { refreshPalette(); renderCtx(t); t.hint?.(); hideDyn(); },
    updateCalChip, updateZoomChip, updateCoords,
    setDirty, summonDyn, hideDyn, textPrompt,
    moveSelectionToLayer,
    penIndicator, tabletCaptureKey,
    shortcutOverlay, helpMenu, startTour,
    doExport, openFile, saveProject, showModal, hideModal, scheduleAutosave, undo,
  };
  refreshAll();
}
