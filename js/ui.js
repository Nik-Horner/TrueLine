// TrueLine UI: DOM chrome, panels, exports. app.js stays DOM-free apart from canvases.
import {
  App, newDoc, setTool, invalidate, invalidateView, zoomFit, zoomPhysical, zoomAt,
  fmt, fmtU, parseNum, undo, redo, beginChange, commitChange, deleteSelection, setSelection, selectedEntities,
  decomposeForExport, projectJSON, loadProject, scheduleAutosave, setUnderlay,
  reloadUnderlayImg, k, toScreen, newId, mutate, addEntity, drawingBounds,
  visibleEntities, currentLayer, layerOf, viewSize, setCalibration, flushAutosave,
} from './app.js';
import { TOOL_GROUPS } from './tools.js';
import { ICONS, icon } from './icons.js';
import { writeDXF, readDXF } from './dxf.js';
import { writePDF } from './pdf.js';
import { startTour, tourDone } from './tour.js';
import * as G from './geom.js';
import { clearOlderRevisions } from './recovery.js';

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
  fp.accept = '.json,.dxf,.png,.jpg,.jpeg';
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
    } else {
      importUnderlay(file);
    }
  };
  fp.click();
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
  const rd = new FileReader();
  rd.onload = () => {
    const img = new Image();
    img.onload = () => {
      const wMM = img.naturalWidth * 25.4 / 96, hMM = img.naturalHeight * 25.4 / 96;
      const c = { x: App.view.x + viewSize().w / k() / 2, y: App.view.y + viewSize().h / k() / 2 };
      setUnderlay({ dataURL: rd.result, x: c.x - wMM / 2, y: c.y - hMM / 2, wMM, hMM, opacity: 0.5, visible: true }, img);
      toast('Image placed — Tracing → Calibrate photo measurements sets its true scale');
      refreshProps();
    };
    img.src = rd.result;
  };
  rd.readAsDataURL(file);
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
export function showModal(build) {
  const root = $('modalRoot');
  root.hidden = false;
  const box = $('modalBox');
  box.innerHTML = '';
  build(box);
  $('modalScrim').onclick = hideModal;
}
export function hideModal() { $('modalRoot').hidden = true; }

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
    else if (cmd === 'underlay') openFile();
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
