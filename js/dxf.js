// js/dxf.js — DXF R12 (AC1009) writer + tolerant reader. No DOM, no deps.
//
// Internal frame (ARCHITECTURE.md): true millimeters, Y grows DOWN, angles in
// radians via atan2(dy,dx) in that Y-down frame, arcs sweep a0->a1 in the
// increasing-angle direction. DXF files are Y-up: this module owns the flip.
// On write: y -> -y, angles/bulges/rotations negate. On read: the inverse.

const TAU = Math.PI * 2;
const DEG = Math.PI / 180;

// ---------------------------------------------------------------------------
// ACI color table (standard 255-entry palette, generated: 1-9 named, 10-249
// 24 hues x 5 values x {full, half} saturation, 250-255 grays).
// ---------------------------------------------------------------------------
const ACI_RGB = (() => {
  const t = new Array(256);
  t[0] = [0, 0, 0];
  const base = [[255,0,0],[255,255,0],[0,255,0],[0,255,255],[0,0,255],[255,0,255],[255,255,255],[128,128,128],[192,192,192]];
  for (let i = 0; i < 9; i++) t[i + 1] = base[i];
  const V = [255, 204, 153, 127, 76];
  for (let c = 10; c <= 249; c++) {
    const i = c - 10;
    const hue = Math.floor(i / 10) * 15;
    const f = V[(i % 10) >> 1];
    const sat = (i % 2) ? 0.5 : 1;
    const C = (f / 255) * sat, m = f / 255 - C;
    const hp = hue / 60, X = C * (1 - Math.abs(hp % 2 - 1));
    let r, g, b;
    if (hp < 1) { r = C; g = X; b = 0; }
    else if (hp < 2) { r = X; g = C; b = 0; }
    else if (hp < 3) { r = 0; g = C; b = X; }
    else if (hp < 4) { r = 0; g = X; b = C; }
    else if (hp < 5) { r = X; g = 0; b = C; }
    else { r = C; g = 0; b = X; }
    t[c] = [Math.floor((r + m) * 255 + 1e-6), Math.floor((g + m) * 255 + 1e-6), Math.floor((b + m) * 255 + 1e-6)];
  }
  const grays = [51, 80, 105, 130, 190, 255];
  for (let c = 250; c <= 255; c++) t[c] = [grays[c - 250], grays[c - 250], grays[c - 250]];
  return t;
})();

function aciToHex(aci) {
  let i = Math.abs(aci | 0);
  if (i < 1 || i > 255) i = 7;
  const t = ACI_RGB[i];
  return '#' + t.map(c => c.toString(16).padStart(2, '0')).join('');
}

function hexToACI(hex) {
  const m = /^#?([0-9a-fA-F]{6})$/.exec(String(hex || '').trim());
  if (!m) return 7;
  const v = parseInt(m[1], 16), r = (v >> 16) & 255, g = (v >> 8) & 255, b = v & 255;
  let best = 7, bd = Infinity;
  for (let i = 1; i <= 255; i++) {
    const t = ACI_RGB[i];
    const d = (t[0] - r) * (t[0] - r) + (t[1] - g) * (t[1] - g) + (t[2] - b) * (t[2] - b);
    if (d < bd) { bd = d; best = i; }
  }
  return best;
}

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------
function fmt(v) {
  if (!isFinite(v)) v = 0;
  let s = v.toFixed(9);
  s = s.replace(/0+$/, '').replace(/\.$/, '.0');
  if (s === '-0.0') s = '0.0';
  return s;
}

const norm360 = d => ((d % 360) + 360) % 360;
const normAng = a => { a = a % TAU; if (a > Math.PI) a -= TAU; if (a <= -Math.PI) a += TAU; return a; };

function sanitizeLayerName(n) {
  const s = String(n == null ? '' : n).replace(/[^A-Za-z0-9_$\-]/g, '_');
  return s || '0';
}

// Encode chars >127 as \U+XXXX (per UTF-16 code unit) for R12 ASCII files.
function encodeText(s) {
  let r = '';
  s = String(s == null ? '' : s);
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    r += c > 127 ? '\\U+' + c.toString(16).toUpperCase().padStart(4, '0') : s[i];
  }
  return r;
}

// Decode %% escapes (R12 TEXT) and \U+XXXX.
function decodeText(s) {
  s = String(s == null ? '' : s)
    .replace(/%%%/g, '\x01')
    .replace(/%%[dD]/g, '°')
    .replace(/%%[pP]/g, '±')
    .replace(/%%[cC]/g, '∅')
    .replace(/%%[uUoO]/g, '')
    .replace(/\x01/g, '%');
  return s.replace(/\\U\+([0-9A-Fa-f]{4})/g, (m, h) => String.fromCharCode(parseInt(h, 16)));
}

// Strip MTEXT inline formatting codes (spec B.4 order).
function stripMtext(s) {
  return String(s)
    .replace(/\\\\/g, '\x00')
    .replace(/\\P/gi, '\n')
    .replace(/\\~/g, ' ')
    .replace(/\\[ACFHQTWfp][^;]*;/g, '')
    .replace(/\\[LlOoKkX]/g, '')
    .replace(/[{}]/g, '')
    .replace(/\x00/g, '\\');
}

// ---------------------------------------------------------------------------
// WRITER — DXF R12 (AC1009)
// ---------------------------------------------------------------------------
const LTYPE_DEFS = [
  ['CONTINUOUS', 'Solid line', []],
  ['DASHED', 'Dashed __ __ __ __', [0.5, -0.25]],
  ['CENTER', 'Center ____ _ ____ _', [1.25, -0.25, 0.25, -0.25]],
  ['HIDDEN', 'Hidden __ __ __ __', [0.25, -0.125]],
];
const LTYPE_NAMES = LTYPE_DEFS.map(d => d[0]);

export function writeDXF(entities, layers, opts) {
  const inches = !!(opts && opts.units === 'in');
  const k = inches ? 1 / 25.4 : 1;           // mm -> file units
  const fx = x => x * k;
  const fy = y => -y * k;                    // Y-down internal -> Y-up file

  // Layer table: map internal layer id -> sanitized unique DXF name.
  const nameById = new Map();
  const usedUC = new Set();
  const defs = [];
  for (const L of layers || []) {
    let n = sanitizeLayerName(L.name != null ? L.name : L.id);
    while (usedUC.has(n.toUpperCase())) n += '_';
    usedUC.add(n.toUpperCase());
    nameById.set(String(L.id), n);
    const lt = String(L.ltype || '').toUpperCase();
    defs.push({ name: n, aci: hexToACI(L.color), ltype: LTYPE_NAMES.indexOf(lt) >= 0 ? lt : 'CONTINUOUS' });
  }
  if (!usedUC.has('0')) defs.unshift({ name: '0', aci: 7, ltype: 'CONTINUOUS' });
  const lname = id => nameById.get(String(id)) || '0';

  // Emit entities first (into their own list) so extents are known for HEADER.
  const el = [];
  const tag = (c, v) => { el.push(String(c), String(v)); };
  const num = (c, v) => { el.push(String(c), fmt(v)); };
  let ext = null;
  const grow = (x, y) => {
    if (!ext) ext = { x0: x, y0: y, x1: x, y1: y };
    else {
      if (x < ext.x0) ext.x0 = x; if (x > ext.x1) ext.x1 = x;
      if (y < ext.y0) ext.y0 = y; if (y > ext.y1) ext.y1 = y;
    }
  };

  for (const e of entities || []) {
    const L = lname(e.layer);
    switch (e.type) {
      case 'line': {
        const ax = fx(e.a.x), ay = fy(e.a.y), bx = fx(e.b.x), by = fy(e.b.y);
        grow(ax, ay); grow(bx, by);
        tag(0, 'LINE'); tag(8, L);
        num(10, ax); num(20, ay); num(30, 0);
        num(11, bx); num(21, by); num(31, 0);
        break;
      }
      case 'circle': {
        const cx = fx(e.c.x), cy = fy(e.c.y), r = e.r * k;
        grow(cx - r, cy - r); grow(cx + r, cy + r);
        tag(0, 'CIRCLE'); tag(8, L);
        num(10, cx); num(20, cy); num(30, 0); num(40, r);
        break;
      }
      case 'arc': {
        // Internal arc sweeps a0->a1 increasing in Y-down frame; under the
        // Y-flip the file arc runs CCW from -a1 to -a0.
        const cx = fx(e.c.x), cy = fy(e.c.y), r = e.r * k;
        grow(cx - r, cy - r); grow(cx + r, cy + r);
        tag(0, 'ARC'); tag(8, L);
        num(10, cx); num(20, cy); num(30, 0); num(40, r);
        num(50, norm360(-e.a1 / DEG)); num(51, norm360(-e.a0 / DEG));
        break;
      }
      case 'poly': {
        const pts = e.pts || [];
        if (pts.length < 2) break;
        tag(0, 'POLYLINE'); tag(8, L); tag(66, 1); tag(70, e.closed ? 1 : 0);
        num(10, 0); num(20, 0); num(30, 0);
        for (const p of pts) {
          const x = fx(p.x), y = fy(p.y);
          grow(x, y);
          tag(0, 'VERTEX'); tag(8, L);
          num(10, x); num(20, y); num(30, 0);
          if (p.bulge) num(42, -p.bulge);      // bulge sign flips with Y
        }
        tag(0, 'SEQEND'); tag(8, L);
        break;
      }
      case 'point': {
        const x = fx(e.p.x), y = fy(e.p.y);
        grow(x, y);
        tag(0, 'POINT'); tag(8, L);
        num(10, x); num(20, y); num(30, 0);
        break;
      }
      case 'text': {
        const x = fx(e.p.x), y = fy(e.p.y);
        grow(x, y);
        tag(0, 'TEXT'); tag(8, L);
        num(10, x); num(20, y); num(30, 0);
        num(40, (e.h || 2.5) * k);
        tag(1, encodeText(e.text));
        const rd = norm360(-(e.rot || 0) / DEG);
        if (rd !== 0) num(50, rd);
        tag(7, 'STANDARD');
        break;
      }
      default: break; // writers never see 'dim'; unknown types skipped
    }
  }
  if (!ext) ext = { x0: 0, y0: 0, x1: 0, y1: 0 };

  // Assemble file: HEADER, TABLES, ENTITIES.
  const out = [];
  const T = (c, v) => { out.push(String(c), String(v)); };
  const N = (c, v) => { out.push(String(c), fmt(v)); };

  T(0, 'SECTION'); T(2, 'HEADER');
  T(9, '$ACADVER'); T(1, 'AC1009');
  T(9, '$INSUNITS'); T(70, inches ? 1 : 4);
  T(9, '$EXTMIN'); N(10, ext.x0); N(20, ext.y0); N(30, 0);
  T(9, '$EXTMAX'); N(10, ext.x1); N(20, ext.y1); N(30, 0);
  T(0, 'ENDSEC');

  T(0, 'SECTION'); T(2, 'TABLES');
  T(0, 'TABLE'); T(2, 'LTYPE'); T(70, LTYPE_DEFS.length);
  for (const [name, desc, dashes] of LTYPE_DEFS) {
    T(0, 'LTYPE'); T(2, name); T(70, 64); T(3, desc); T(72, 65);
    T(73, dashes.length);
    N(40, dashes.reduce((s, d) => s + Math.abs(d), 0));
    for (const d of dashes) N(49, d);
  }
  T(0, 'ENDTAB');
  T(0, 'TABLE'); T(2, 'LAYER'); T(70, defs.length);
  for (const d of defs) {
    T(0, 'LAYER'); T(2, d.name); T(70, 64); T(62, d.aci); T(6, d.ltype);
  }
  T(0, 'ENDTAB');
  T(0, 'TABLE'); T(2, 'STYLE'); T(70, 1);
  T(0, 'STYLE'); T(2, 'STANDARD'); T(70, 0); N(40, 0); N(41, 1); N(50, 0);
  T(71, 0); N(42, 2.5); T(3, 'txt'); T(4, '');
  T(0, 'ENDTAB');
  T(0, 'ENDSEC');

  T(0, 'SECTION'); T(2, 'ENTITIES');
  out.push(...el);
  T(0, 'ENDSEC');
  T(0, 'EOF');
  return out.join('\r\n') + '\r\n';
}

// ---------------------------------------------------------------------------
// READER — tolerant tokenizer + structure walk (R12 and R2000-lite)
// ---------------------------------------------------------------------------
function tokenize(text) {
  const tags = []; // flat [code, value, ...]
  if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
  text = text.replace(/\r(?!\n)/g, '\n'); // lone-CR files
  const lines = text.split('\n');
  for (let i = 0; i + 1 < lines.length; i += 2) {
    const code = parseInt(lines[i].trim(), 10); // trims CR + padded codes
    if (Number.isNaN(code)) { i -= 1; continue; } // resync on garbage line
    let value = lines[i + 1];
    if (value.endsWith('\r')) value = value.slice(0, -1);
    if (code === 999) continue; // comment pair
    tags.push(code, value);
  }
  return tags;
}

function cursor(tags) {
  let i = 0;
  return {
    eof: () => i >= tags.length,
    peekCode: () => tags[i],
    peekVal: () => tags[i + 1],
    next: () => { const t = { code: tags[i], value: tags[i + 1] }; i += 2; return t; },
    back: () => { i = Math.max(0, i - 2); },
  };
}

const pf = v => { const n = parseFloat(v); return isFinite(n) ? n : 0; };
const pi = v => { const n = parseInt(v, 10); return Number.isNaN(n) ? 0 : n; };

// Read all tags of the current record (until the next code 0).
function collect(cur) {
  const a = [];
  while (!cur.eof() && cur.peekCode() !== 0) a.push(cur.next());
  return a;
}

function skipSection(cur) {
  while (!cur.eof()) {
    const t = cur.next();
    if (t.code === 0) {
      const v = String(t.value).trim().toUpperCase();
      if (v === 'ENDSEC') return;
      if (v === 'SECTION' || v === 'EOF') { cur.back(); return; }
    }
  }
}

function readHeader(cur) {
  let insunits = 0;
  while (!cur.eof()) {
    const t = cur.next();
    if (t.code === 0) {
      const v = String(t.value).trim().toUpperCase();
      if (v === 'ENDSEC') break;
      if (v === 'SECTION' || v === 'EOF') { cur.back(); break; }
    } else if (t.code === 9 && t.value.trim() === '$INSUNITS' && cur.peekCode() === 70) {
      insunits = pi(cur.next().value);
    }
  }
  return insunits;
}

function readTables(cur, layerMap, warnings) {
  while (!cur.eof()) {
    const t = cur.next();
    if (t.code !== 0) continue;
    const v = String(t.value).trim().toUpperCase();
    if (v === 'ENDSEC') return;
    if (v === 'SECTION' || v === 'EOF') { cur.back(); return; }
    if (v !== 'TABLE') continue;
    let tname = '';
    if (cur.peekCode() === 2) tname = String(cur.peekVal()).trim().toUpperCase();
    if (tname !== 'LAYER') { // skip other tables to ENDTAB
      while (!cur.eof()) {
        const u = cur.next();
        if (u.code === 0) {
          const w = String(u.value).trim().toUpperCase();
          if (w === 'ENDTAB') break;
          if (w === 'ENDSEC' || w === 'SECTION' || w === 'EOF') { cur.back(); break; }
        }
      }
      continue;
    }
    // LAYER table
    while (!cur.eof()) {
      const u = cur.next();
      if (u.code !== 0) continue;
      const w = String(u.value).trim().toUpperCase();
      if (w === 'ENDTAB') break;
      if (w === 'ENDSEC' || w === 'SECTION' || w === 'EOF') { cur.back(); break; }
      if (w !== 'LAYER') { collect(cur); continue; }
      const a = collect(cur);
      let name = '0', color = 7, flags = 0;
      for (const g of a) {
        if (g.code === 2) name = String(g.value).trim();
        else if (g.code === 62) color = pi(g.value);
        else if (g.code === 70) flags = pi(g.value);
      }
      layerMap.set(name, {
        id: name, name,
        color: aciToHex(color),
        visible: color >= 0 && !(flags & 1),   // 62 negative = off, 70 bit1 = frozen
        locked: !!(flags & 4),
      });
    }
  }
}

// Apply extrusion (210/220/230) mirror for the common 230 == -1 case.
function extrusionFlip(a, warnings) {
  let nx = 0, ny = 0, nz = 1, seen = false;
  for (const g of a) {
    if (g.code === 210) { nx = pf(g.value); seen = true; }
    else if (g.code === 220) { ny = pf(g.value); seen = true; }
    else if (g.code === 230) { nz = pf(g.value); seen = true; }
  }
  if (!seen) return false;
  if (nz < -0.9999 && Math.abs(nx) < 1e-6 && Math.abs(ny) < 1e-6) return true;
  if (nz < 0.9999 || Math.abs(nx) > 1e-6 || Math.abs(ny) > 1e-6)
    warnings.push('non-standard extrusion direction ignored');
  return false;
}

// Parse one entity record (file frame, Y-up). May consume trailing
// VERTEX/SEQEND or ATTRIB/SEQEND records. Returns entity, array, or null.
function readEntity(cur, ty, warnings, warnedTypes) {
  switch (ty) {
    case 'LINE': {
      const a = collect(cur);
      let x1 = 0, y1 = 0, x2 = 0, y2 = 0, layer = '0';
      for (const g of a) switch (g.code) {
        case 8: layer = g.value.trim(); break;
        case 10: x1 = pf(g.value); break; case 20: y1 = pf(g.value); break;
        case 11: x2 = pf(g.value); break; case 21: y2 = pf(g.value); break;
      }
      if (extrusionFlip(a, warnings)) { x1 = -x1; x2 = -x2; }
      return { type: 'line', a: { x: x1, y: y1 }, b: { x: x2, y: y2 }, layer };
    }
    case 'CIRCLE': {
      const a = collect(cur);
      let cx = 0, cy = 0, r = 0, layer = '0';
      for (const g of a) switch (g.code) {
        case 8: layer = g.value.trim(); break;
        case 10: cx = pf(g.value); break; case 20: cy = pf(g.value); break;
        case 40: r = pf(g.value); break;
      }
      if (extrusionFlip(a, warnings)) cx = -cx;
      return { type: 'circle', c: { x: cx, y: cy }, r, layer };
    }
    case 'ARC': {
      const a = collect(cur);
      let cx = 0, cy = 0, r = 0, a0 = 0, a1 = 0, layer = '0';
      for (const g of a) switch (g.code) {
        case 8: layer = g.value.trim(); break;
        case 10: cx = pf(g.value); break; case 20: cy = pf(g.value); break;
        case 40: r = pf(g.value); break;
        case 50: a0 = pf(g.value) * DEG; break; case 51: a1 = pf(g.value) * DEG; break;
      }
      if (extrusionFlip(a, warnings)) {
        cx = -cx;
        const n0 = Math.PI - a1, n1 = Math.PI - a0; // mirror + keep CCW
        a0 = n0; a1 = n1;
      }
      return { type: 'arc', c: { x: cx, y: cy }, r, a0, a1, layer };
    }
    case 'POINT': {
      const a = collect(cur);
      let x = 0, y = 0, layer = '0';
      for (const g of a) switch (g.code) {
        case 8: layer = g.value.trim(); break;
        case 10: x = pf(g.value); break; case 20: y = pf(g.value); break;
      }
      if (extrusionFlip(a, warnings)) x = -x;
      return { type: 'point', p: { x, y }, layer };
    }
    case 'LWPOLYLINE': {
      const a = collect(cur);
      const pts = []; let closed = false, layer = '0', v = null;
      for (const g of a) switch (g.code) {
        case 8: layer = g.value.trim(); break;
        case 70: closed = !!(pi(g.value) & 1); break;
        case 10: v = { x: pf(g.value), y: 0, bulge: 0 }; pts.push(v); break; // 10 starts a vertex
        case 20: if (v) v.y = pf(g.value); break;
        case 42: if (v) v.bulge = pf(g.value); break;
        // 90 declared count / 38 elevation / 43 width: ignored
      }
      if (extrusionFlip(a, warnings)) for (const p of pts) { p.x = -p.x; p.bulge = -p.bulge; }
      if (pts.length < 2) { warnings.push('LWPOLYLINE with <2 vertices skipped'); return null; }
      return { type: 'poly', pts, closed, layer };
    }
    case 'POLYLINE': {
      const a = collect(cur);
      let flags = 0, layer = '0';
      for (const g of a) switch (g.code) {
        case 8: layer = g.value.trim(); break;
        case 70: flags = pi(g.value); break;
      }
      const mirror = extrusionFlip(a, warnings);
      const mesh = !!(flags & (16 | 64));
      const pts = [];
      while (!cur.eof()) {
        if (cur.peekCode() !== 0) { cur.next(); continue; }
        const w = String(cur.peekVal()).trim().toUpperCase();
        if (w === 'VERTEX') {
          cur.next();
          const va = collect(cur);
          let x = 0, y = 0, bulge = 0, vf = 0;
          for (const g of va) switch (g.code) {
            case 10: x = pf(g.value); break; case 20: y = pf(g.value); break;
            case 42: bulge = pf(g.value); break; case 70: vf = pi(g.value); break;
          }
          if (!(vf & 16)) pts.push({ x, y, bulge }); // drop spline-frame verts
        } else if (w === 'SEQEND') { cur.next(); collect(cur); break; }
        else break; // missing SEQEND: next entity starts
      }
      if (mesh) { warnings.push('POLYLINE mesh skipped'); return null; }
      if (mirror) for (const p of pts) { p.x = -p.x; p.bulge = -p.bulge; }
      if (pts.length < 2) { warnings.push('POLYLINE with <2 vertices skipped'); return null; }
      return { type: 'poly', pts, closed: !!(flags & 1), layer };
    }
    case 'TEXT': {
      const a = collect(cur);
      let str = '', x = 0, y = 0, ax = 0, ay = 0, h = 2.5, rot = 0, hj = 0, vj = 0, layer = '0';
      for (const g of a) switch (g.code) {
        case 8: layer = g.value.trim(); break;
        case 1: str = g.value; break;
        case 10: x = pf(g.value); break; case 20: y = pf(g.value); break;
        case 11: ax = pf(g.value); break; case 21: ay = pf(g.value); break;
        case 40: h = pf(g.value); break;
        case 50: rot = pf(g.value) * DEG; break;
        case 72: hj = pi(g.value); break; case 73: vj = pi(g.value); break;
      }
      const use11 = (hj || vj) ? true : false;
      let px = use11 ? ax : x, py = use11 ? ay : y;
      if (extrusionFlip(a, warnings)) px = -px;
      return { type: 'text', p: { x: px, y: py }, text: decodeText(str), h, rot, layer };
    }
    case 'MTEXT': {
      const a = collect(cur);
      let chunks = '', last = '', x = 0, y = 0, h = 2.5, rot = 0, hasRot = false, dx = 0, dy = 0, hasDir = false, layer = '0';
      for (const g of a) switch (g.code) {
        case 8: layer = g.value.trim(); break;
        case 3: chunks += g.value; break;
        case 1: last = g.value; break;
        case 10: x = pf(g.value); break; case 20: y = pf(g.value); break;
        case 40: h = pf(g.value); break;
        case 50: rot = pf(g.value) * DEG; hasRot = true; break;
        case 11: dx = pf(g.value); hasDir = true; break;
        case 21: dy = pf(g.value); hasDir = true; break;
      }
      if (!hasRot && hasDir) rot = Math.atan2(dy, dx);
      const str = decodeText(stripMtext(chunks + last));
      return { type: 'text', p: { x, y }, text: str, h, rot, layer };
    }
    case 'SPLINE':
      return readSpline(collect(cur), warnings);
    case 'INSERT': {
      const a = collect(cur);
      const e = { type: 'insert', name: '', x: 0, y: 0, sx: 1, sy: 1, rot: 0, cols: 1, rows: 1, colSp: 0, rowSp: 0, layer: '0' };
      let attribs = false;
      for (const g of a) switch (g.code) {
        case 8: e.layer = g.value.trim(); break;
        case 2: e.name = String(g.value).trim(); break;
        case 10: e.x = pf(g.value); break; case 20: e.y = pf(g.value); break;
        case 41: e.sx = pf(g.value) || 1; break; case 42: e.sy = pf(g.value) || 1; break;
        case 50: e.rot = pf(g.value) * DEG; break;
        case 66: attribs = pi(g.value) === 1; break;
        case 70: e.cols = Math.max(1, pi(g.value)); break;
        case 71: e.rows = Math.max(1, pi(g.value)); break;
        case 44: e.colSp = pf(g.value); break; case 45: e.rowSp = pf(g.value); break;
      }
      if (attribs) { // consume ATTRIB entities up to SEQEND, discard
        while (!cur.eof()) {
          if (cur.peekCode() !== 0) { cur.next(); continue; }
          const w = String(cur.peekVal()).trim().toUpperCase();
          if (w === 'ATTRIB') { cur.next(); collect(cur); }
          else if (w === 'SEQEND') { cur.next(); collect(cur); break; }
          else break;
        }
      }
      return e;
    }
    case 'VERTEX': case 'SEQEND': case 'ATTRIB': // stray; skip silently
      collect(cur);
      return null;
    default:
      collect(cur);
      if (!warnedTypes.has(ty)) {
        warnedTypes.add(ty);
        warnings.push('unsupported entity type ' + ty + ' skipped');
      }
      return null;
  }
}

function readSpline(a, warnings) {
  let flags = 0, degree = 3, layer = '0';
  const knots = [], ctrl = [], wts = [], fit = [];
  let cp = null, fp = null;
  for (const g of a) switch (g.code) {
    case 8: layer = g.value.trim(); break;
    case 70: flags = pi(g.value); break;
    case 71: degree = pi(g.value); break;
    case 40: knots.push(pf(g.value)); break;
    case 10: cp = { x: pf(g.value), y: 0 }; ctrl.push(cp); break;
    case 20: if (cp) cp.y = pf(g.value); break;
    case 41: wts.push(pf(g.value)); break;
    case 11: fp = { x: pf(g.value), y: 0 }; fit.push(fp); break;
    case 21: if (fp) fp.y = pf(g.value); break;
  }
  const closed = !!(flags & 1);
  let pts;
  if (fit.length >= 2) {
    pts = fit.map(p => ({ x: p.x, y: p.y, bulge: 0 })); // fit points lie on the curve
  } else if (ctrl.length >= 2) {
    const p = Math.min(degree, ctrl.length - 1);
    if (knots.length < ctrl.length + p + 1) {
      warnings.push('SPLINE with bad knot vector: control polygon used');
      pts = ctrl.map(q => ({ x: q.x, y: q.y, bulge: 0 }));
    } else {
      const rational = wts.length === ctrl.length && wts.some(w => Math.abs(w - wts[0]) > 1e-12);
      const P = rational
        ? ctrl.map((q, i) => [q.x * wts[i], q.y * wts[i], wts[i]])
        : ctrl.map(q => [q.x, q.y]);
      const t0 = knots[p], t1 = knots[knots.length - 1 - p];
      const n = Math.max(16, 8 * (ctrl.length - p));
      pts = [];
      for (let i = 0; i < n; i++) {
        const t = t0 + (t1 - t0) * i / (n - 1);
        const d = deBoor(t, p, knots, P);
        pts.push(rational
          ? { x: d[0] / d[2], y: d[1] / d[2], bulge: 0 }
          : { x: d[0], y: d[1], bulge: 0 });
      }
    }
  } else {
    warnings.push('SPLINE with insufficient data skipped');
    return null;
  }
  return { type: 'poly', pts, closed, layer };
}

function deBoor(t, p, knots, P) {
  let k = p;
  while (k + 1 < knots.length - p - 1 && knots[k + 1] <= t) k++;
  const d = P.slice(k - p, k + 1).map(v => v.slice());
  for (let r = 1; r <= p; r++)
    for (let j = p; j >= r; j--) {
      const i = k - p + j;
      const den = knots[i + p - r + 1] - knots[i];
      const a = den === 0 ? 0 : (t - knots[i]) / den;
      for (let c = 0; c < d[j].length; c++) d[j][c] = (1 - a) * d[j - 1][c] + a * d[j][c];
    }
  return d[p];
}

// Read entities until (0, endWord) / ENDSEC / EOF.
function readEntityList(cur, endWord, warnings, warnedTypes) {
  const ents = [];
  while (!cur.eof()) {
    const t = cur.next();
    if (t.code !== 0) continue; // stray tags between records
    const ty = String(t.value).trim().toUpperCase();
    if (ty === endWord || ty === 'ENDSEC' || ty === 'EOF') {
      if (ty !== endWord) cur.back();
      break;
    }
    const e = readEntity(cur, ty, warnings, warnedTypes);
    if (e) ents.push(e);
  }
  return ents;
}

function readBlocks(cur, blocks, warnings, warnedTypes) {
  while (!cur.eof()) {
    const t = cur.next();
    if (t.code !== 0) continue;
    const v = String(t.value).trim().toUpperCase();
    if (v === 'ENDSEC') return;
    if (v === 'SECTION' || v === 'EOF') { cur.back(); return; }
    if (v !== 'BLOCK') continue;
    const a = collect(cur);
    let name = '', bx = 0, by = 0;
    for (const g of a) {
      if (g.code === 2 && !name) name = String(g.value).trim();
      else if (g.code === 10) bx = pf(g.value);
      else if (g.code === 20) by = pf(g.value);
    }
    const ents = readEntityList(cur, 'ENDBLK', warnings, warnedTypes);
    collect(cur); // ENDBLK's own tags
    if (name) blocks.set(name.toUpperCase(), { bx, by, ents });
  }
}

// ---------------------------------------------------------------------------
// INSERT explode — 2x2 matrix + translation transforms, file frame (Y-up)
// T = {a,b,c,d,tx,ty}: x' = a*x + c*y + tx ; y' = b*x + d*y + ty
// ---------------------------------------------------------------------------
const T_ID = { a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 };

function tCompose(o, i) { // apply i first, then o
  return {
    a: o.a * i.a + o.c * i.b, b: o.b * i.a + o.d * i.b,
    c: o.a * i.c + o.c * i.d, d: o.b * i.c + o.d * i.d,
    tx: o.a * i.tx + o.c * i.ty + o.tx,
    ty: o.b * i.tx + o.d * i.ty + o.ty,
  };
}
const tPoint = (T, x, y) => ({ x: T.a * x + T.c * y + T.tx, y: T.b * x + T.d * y + T.ty });

function tInfo(T) {
  const l1 = Math.hypot(T.a, T.b), l2 = Math.hypot(T.c, T.d);
  const dot = T.a * T.c + T.b * T.d;
  const scale = Math.max(l1, l2, 1e-12);
  return {
    l1, l2,
    det: T.a * T.d - T.b * T.c,
    phi: Math.atan2(T.b, T.a),
    similar: Math.abs(l1 - l2) <= 1e-9 * scale && Math.abs(dot) <= 1e-9 * scale * scale,
  };
}

// Tessellate a CCW file-frame arc into vertex list (max 5 deg per step).
function tessArcPts(cx, cy, r, a0, a1, closeFull) {
  let sweep = ((a1 - a0) % TAU + TAU) % TAU;
  if (closeFull || sweep === 0) sweep = TAU;
  const n = Math.max(2, Math.ceil(sweep / (5 * DEG)));
  const pts = [];
  const last = closeFull ? n - 1 : n; // closed poly: skip duplicate end point
  for (let i = 0; i <= last; i++) {
    const a = a0 + sweep * i / n;
    pts.push({ x: cx + r * Math.cos(a), y: cy + r * Math.sin(a), bulge: 0 });
  }
  return pts;
}

// bulge -> arc (file frame, standard DXF sign: b>0 CCW). Spec B.6.
function bulgeToArc(p1, p2, b) {
  const dx = p2.x - p1.x, dy = p2.y - p1.y, ch = Math.hypot(dx, dy);
  if (ch < 1e-12) return null;
  const px = dy / ch, py = -dx / ch; // chord dir rotated -90deg
  const mx = (p1.x + p2.x) / 2, my = (p1.y + p2.y) / 2;
  const r = ch * (1 + b * b) / (4 * Math.abs(b));
  const off = ch * (b * b - 1) / (4 * b);
  const O = { x: mx + px * off, y: my + py * off };
  return { O, r, a0: Math.atan2(p1.y - O.y, p1.x - O.x), a1: Math.atan2(p2.y - O.y, p2.x - O.x) };
}

// Replace bulge segments of a file-frame poly with tessellated points.
function flattenPolyBulges(pts, closed) {
  const out = [];
  const n = pts.length;
  const segs = closed ? n : n - 1;
  for (let i = 0; i < segs; i++) {
    const p1 = pts[i], p2 = pts[(i + 1) % n];
    out.push({ x: p1.x, y: p1.y, bulge: 0 });
    if (p1.bulge) {
      const arc = bulgeToArc(p1, p2, p1.bulge);
      if (arc) {
        const ccw = p1.bulge > 0;
        const s0 = ccw ? arc.a0 : arc.a1, s1 = ccw ? arc.a1 : arc.a0;
        const mid = tessArcPts(arc.O.x, arc.O.y, arc.r, s0, s1, false).slice(1, -1);
        if (!ccw) mid.reverse();
        out.push(...mid);
      }
    }
  }
  if (!closed) out.push({ x: pts[n - 1].x, y: pts[n - 1].y, bulge: 0 });
  return out;
}

function transformEntity(e, T, warnings) {
  const info = tInfo(T);
  const map = p => tPoint(T, p.x, p.y);
  switch (e.type) {
    case 'line':
      return { type: 'line', a: map(e.a), b: map(e.b), layer: e.layer };
    case 'point':
      return { type: 'point', p: map(e.p), layer: e.layer };
    case 'text': {
      const rot = info.det >= 0 ? e.rot + info.phi : info.phi - e.rot;
      return { type: 'text', p: map(e.p), text: e.text, h: e.h * info.l2, rot, layer: e.layer };
    }
    case 'circle':
      if (info.similar)
        return { type: 'circle', c: map(e.c), r: e.r * info.l1, layer: e.layer };
      warnings.push('non-uniformly scaled circle tessellated to polyline');
      return {
        type: 'poly', closed: true, layer: e.layer,
        pts: tessArcPts(e.c.x, e.c.y, e.r, 0, TAU, true).map(map).map(p => ({ x: p.x, y: p.y, bulge: 0 })),
      };
    case 'arc': {
      if (info.similar) {
        const c = map(e.c), r = e.r * info.l1;
        if (info.det >= 0)
          return { type: 'arc', c, r, a0: e.a0 + info.phi, a1: e.a1 + info.phi, layer: e.layer };
        // mirrored: angles reflect and sweep direction reverses; keep CCW
        return { type: 'arc', c, r, a0: info.phi - e.a1, a1: info.phi - e.a0, layer: e.layer };
      }
      warnings.push('non-uniformly scaled arc tessellated to polyline');
      return {
        type: 'poly', closed: false, layer: e.layer,
        pts: tessArcPts(e.c.x, e.c.y, e.r, e.a0, e.a1, false).map(map).map(p => ({ x: p.x, y: p.y, bulge: 0 })),
      };
    }
    case 'poly': {
      let pts = e.pts;
      if (!info.similar && pts.some(p => p.bulge)) {
        warnings.push('non-uniformly scaled bulge polyline tessellated');
        pts = flattenPolyBulges(pts, e.closed);
      }
      const bs = info.det >= 0 ? 1 : -1;
      return {
        type: 'poly', closed: e.closed, layer: e.layer,
        pts: pts.map(p => { const q = tPoint(T, p.x, p.y); return { x: q.x, y: q.y, bulge: (p.bulge || 0) * bs }; }),
      };
    }
    default:
      return null;
  }
}

function explodeInserts(list, blocks, warnings) {
  const out = [];
  const emit = (e, T, depth, stack) => {
    if (e.type !== 'insert') {
      const r = transformEntity(e, T, warnings);
      if (r) out.push(r);
      return;
    }
    const uc = e.name.toUpperCase();
    if (/^\*(MODEL_SPACE|PAPER_SPACE)/.test(uc)) return; // already in ENTITIES
    const blk = blocks.get(uc);
    if (!blk) { warnings.push('unresolved block "' + e.name + '" skipped'); return; }
    if (depth >= 8) { warnings.push('INSERT nesting deeper than 8 skipped'); return; }
    if (stack.has(uc)) { warnings.push('cyclic INSERT of "' + e.name + '" skipped'); return; }
    const cos = Math.cos(e.rot), sin = Math.sin(e.rot);
    const M = { a: e.sx * cos, b: e.sx * sin, c: -e.sy * sin, d: e.sy * cos };
    const next = new Set(stack); next.add(uc);
    for (let ri = 0; ri < e.rows; ri++) {
      for (let ci = 0; ci < e.cols; ci++) {
        const ox = ci * e.colSp, oy = ri * e.rowSp; // grid offset in rotated frame
        const Ti = {
          ...M,
          tx: e.x + (cos * ox - sin * oy) - (M.a * blk.bx + M.c * blk.by),
          ty: e.y + (sin * ox + cos * oy) - (M.b * blk.bx + M.d * blk.by),
        };
        const Tc = tCompose(T, Ti);
        for (const child of blk.ents) emit(child, Tc, depth + 1, next);
      }
    }
  };
  for (const e of list) emit(e, T_ID, 0, new Set());
  return out;
}

// ---------------------------------------------------------------------------
// File frame (Y-up, file units) -> internal frame (Y-down, mm)
// ---------------------------------------------------------------------------
const INSUNITS_TO_MM = { 0: 1, 1: 25.4, 2: 304.8, 4: 1, 5: 10, 6: 1000 };

function toInternal(e, k, id) {
  switch (e.type) {
    case 'line':
      return { id, type: 'line', a: { x: e.a.x * k, y: -e.a.y * k }, b: { x: e.b.x * k, y: -e.b.y * k }, layer: e.layer };
    case 'circle':
      return { id, type: 'circle', c: { x: e.c.x * k, y: -e.c.y * k }, r: e.r * k, layer: e.layer };
    case 'arc':
      // file CCW a0->a1 becomes internal increasing-angle -a1 -> -a0
      return { id, type: 'arc', c: { x: e.c.x * k, y: -e.c.y * k }, r: e.r * k, a0: normAng(-e.a1), a1: normAng(-e.a0), layer: e.layer };
    case 'poly':
      return {
        id, type: 'poly', closed: e.closed, layer: e.layer,
        pts: e.pts.map(p => ({ x: p.x * k, y: -p.y * k, bulge: -(p.bulge || 0) })),
      };
    case 'point':
      return { id, type: 'point', p: { x: e.p.x * k, y: -e.p.y * k }, layer: e.layer };
    case 'text':
      return { id, type: 'text', p: { x: e.p.x * k, y: -e.p.y * k }, text: e.text, h: e.h * k, rot: normAng(-e.rot), layer: e.layer };
    default:
      return null;
  }
}

export function readDXF(text) {
  const warnings = [];
  const result = { entities: [], layers: [], warnings };
  try {
    text = String(text == null ? '' : text);
    if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
    if (text.startsWith('AutoCAD Binary DXF')) {
      warnings.push('binary DXF not supported');
      return result;
    }
    const cur = cursor(tokenize(text));
    const layerMap = new Map();
    const blocks = new Map();
    const warnedTypes = new Set();
    let raw = [];
    let insunits = 0;
    while (!cur.eof()) {
      const t = cur.next();
      if (t.code !== 0) continue;
      const v = String(t.value).trim().toUpperCase();
      if (v === 'EOF') break;
      if (v !== 'SECTION') continue;
      let name = '';
      if (cur.peekCode() === 2) name = String(cur.next().value).trim().toUpperCase();
      if (name === 'HEADER') insunits = readHeader(cur);
      else if (name === 'TABLES') readTables(cur, layerMap, warnings);
      else if (name === 'BLOCKS') readBlocks(cur, blocks, warnings, warnedTypes);
      else if (name === 'ENTITIES') raw = raw.concat(readEntityList(cur, 'ENDSEC', warnings, warnedTypes));
      else skipSection(cur);
    }
    const flat = explodeInserts(raw, blocks, warnings);
    let k = INSUNITS_TO_MM[insunits];
    if (k === undefined) { warnings.push('unsupported $INSUNITS ' + insunits + ': treated as mm'); k = 1; }
    let seq = 0;
    for (const e of flat) {
      const ie = toInternal(e, k, 'dxf' + (++seq));
      if (ie) result.entities.push(ie);
    }
    // Layers: table entries + any referenced-but-undeclared layers.
    for (const e of result.entities) {
      if (!layerMap.has(e.layer))
        layerMap.set(e.layer, { id: e.layer, name: e.layer, color: '#ffffff', visible: true, locked: false });
    }
    result.layers = [...layerMap.values()];
  } catch (err) {
    warnings.push('reader error: ' + (err && err.message ? err.message : String(err)));
  }
  return result;
}

// ---------------------------------------------------------------------------
// selfTest
// ---------------------------------------------------------------------------
export function selfTest() {
  const F = [];
  const ok = (cond, msg) => { if (!cond) F.push(msg); };
  const near = (a, b, tol) => Math.abs(a - b) <= (tol || 1e-6);
  const angEq = (a, b, tol) => {
    const d = ((a - b) % TAU + TAU) % TAU;
    return d <= (tol || 1e-6) || TAU - d <= (tol || 1e-6);
  };

  try {
    // ---- round-trip: every entity type on 2 layers (internal Y-down mm) ----
    const layers = [
      { id: 'L1', name: 'PART', color: '#ff0000', visible: true, locked: false },
      { id: 'L2', name: 'NOTES', color: '#00c8ff', visible: true, locked: false, ltype: 'HIDDEN' },
    ];
    const src = [
      { id: 'e1', type: 'line', a: { x: 1, y: 2 }, b: { x: 30, y: 40.5 }, layer: 'L1' },
      { id: 'e2', type: 'circle', c: { x: 10, y: -5 }, r: 7.25, layer: 'L1' },
      { id: 'e3', type: 'arc', c: { x: 0, y: 0 }, r: 5, a0: 0.3, a1: 2.1, layer: 'L2' },
      { id: 'e4', type: 'arc', c: { x: -4, y: 8 }, r: 2.5, a0: 5.9, a1: 1.2, layer: 'L1' }, // crosses 0
      { id: 'e5', type: 'poly', closed: true, layer: 'L1', pts: [
        { x: 0, y: 0, bulge: 0.5 }, { x: 20, y: 0, bulge: 0 },
        { x: 20, y: 10, bulge: -0.75 }, { x: 0, y: 10, bulge: 0 }] },
      { id: 'e6', type: 'poly', closed: false, layer: 'L2', pts: [
        { x: -3, y: 1, bulge: 0 }, { x: 4, y: 2, bulge: 0 }, { x: 5, y: -6, bulge: 0 }] },
      { id: 'e7', type: 'point', p: { x: 3.5, y: -2 }, layer: 'L2' },
      { id: 'e8', type: 'text', p: { x: 5, y: 5 }, text: 'Ø10 ±0.1°', h: 3.5, rot: 0.4, layer: 'L2' },
    ];
    const nameOf = { L1: 'PART', L2: 'NOTES' };

    const checkRoundTrip = (units, tag) => {
      const txt = writeDXF(src, layers, { units });
      ok(!/[^\r]\n/.test(txt) && !/^\n/.test(txt), tag + ': non-CRLF line ending in output');
      const rd = readDXF(txt);
      ok(rd.warnings.length === 0, tag + ': unexpected warnings: ' + rd.warnings.join('; '));
      ok(rd.entities.length === src.length, tag + ': entity count ' + rd.entities.length + ' != ' + src.length);
      for (let i = 0; i < Math.min(src.length, rd.entities.length); i++) {
        const s = src[i], r = rd.entities[i], w = tag + ' ' + s.type + '[' + i + ']';
        ok(r.type === s.type, w + ': type ' + r.type);
        ok(r.layer === nameOf[s.layer], w + ': layer ' + r.layer);
        if (s.type === 'line') {
          ok(near(r.a.x, s.a.x) && near(r.a.y, s.a.y) && near(r.b.x, s.b.x) && near(r.b.y, s.b.y), w + ': coords');
        } else if (s.type === 'circle') {
          ok(near(r.c.x, s.c.x) && near(r.c.y, s.c.y) && near(r.r, s.r), w + ': geometry');
        } else if (s.type === 'arc') {
          ok(near(r.c.x, s.c.x) && near(r.c.y, s.c.y) && near(r.r, s.r), w + ': center/radius');
          ok(angEq(r.a0, s.a0) && angEq(r.a1, s.a1), w + ': angles ' + r.a0 + ',' + r.a1);
        } else if (s.type === 'poly') {
          ok(r.closed === s.closed && r.pts.length === s.pts.length, w + ': shape');
          for (let j = 0; j < s.pts.length; j++) {
            ok(near(r.pts[j].x, s.pts[j].x) && near(r.pts[j].y, s.pts[j].y), w + ': pt' + j);
            ok(near(r.pts[j].bulge || 0, s.pts[j].bulge || 0), w + ': bulge' + j + '=' + r.pts[j].bulge);
          }
        } else if (s.type === 'point') {
          ok(near(r.p.x, s.p.x) && near(r.p.y, s.p.y), w + ': coords');
        } else if (s.type === 'text') {
          ok(r.text === s.text, w + ': string "' + r.text + '"');
          ok(near(r.p.x, s.p.x) && near(r.p.y, s.p.y) && near(r.h, s.h) && angEq(r.rot, s.rot), w + ': geom');
        }
      }
      return rd;
    };

    const rd = checkRoundTrip('mm', 'mm');
    checkRoundTrip('in', 'in'); // $INSUNITS 1 + /25.4 out, *25.4 back
    const txt = writeDXF(src, layers, { units: 'mm' });
    ok(txt.indexOf('$INSUNITS') >= 0 && /70\r\n\s*4\r\n/.test(txt), 'writer: $INSUNITS 4 missing');
    ok(/HIDDEN/.test(txt) && /DASHED/.test(txt) && /CENTER/.test(txt), 'writer: LTYPE defs missing');
    const part = rd.layers.find(l => l.name === 'PART');
    ok(part && part.color === '#ff0000', 'layer color ACI round-trip (red): ' + (part && part.color));

    // ---- reader survival: missing EOF + 999 comments + padded codes ----
    let mangled = txt.replace(/0\r\nEOF\r\n$/, ''); // strip EOF
    mangled = '999\r\nheader comment\r\n' + mangled.replace('0\r\nLINE', '999\r\nmid comment\r\n0\r\nLINE');
    mangled = mangled.replace(/^10\r\n/m, '  10\r\n').replace(/^0\r\nCIRCLE/m, '  0\r\nCIRCLE');
    const rd2 = readDXF(mangled);
    ok(rd2.entities.length === src.length, 'mangled file: entity count ' + rd2.entities.length);
    ok(rd2.entities[1] && rd2.entities[1].type === 'circle' && near(rd2.entities[1].c.x, 10), 'mangled file: padded-code CIRCLE');

    // ---- hand-built R2000-ish input: LWPOLYLINE with bulge, layer off ----
    const j = a => a.join('\r\n') + '\r\n';
    const lwTxt = j(['0', 'SECTION', '2', 'TABLES',
      '0', 'TABLE', '2', 'LAYER', '70', '1',
      '0', 'LAYER', '2', 'HID', '62', '-3', '70', '0',
      '0', 'ENDTAB', '0', 'ENDSEC',
      '0', 'SECTION', '2', 'ENTITIES',
      '0', 'LWPOLYLINE', '8', 'HID', '90', '2', '70', '1',
      '10', '0.0', '20', '0.0', '42', '1.0', '10', '10.0', '20', '0.0',
      '0', 'ENDSEC', '0', 'EOF']);
    const rd3 = readDXF(lwTxt);
    ok(rd3.entities.length === 1 && rd3.entities[0].type === 'poly', 'LWPOLYLINE: parsed');
    const lp = rd3.entities[0];
    ok(lp && lp.closed === true && lp.pts.length === 2, 'LWPOLYLINE: closed/count');
    ok(lp && near(lp.pts[0].bulge, -1) && near(lp.pts[1].x, 10) && near(lp.pts[1].y, 0), 'LWPOLYLINE: bulge/coords');
    const hid = rd3.layers.find(l => l.name === 'HID');
    ok(hid && hid.visible === false && hid.color === '#00ff00', 'layer 62 negative: off + color abs');

    // ---- INSERT with rotation + mirror (sx=1, sy=-1, rot=90deg) ----
    const insTxt = j(['0', 'SECTION', '2', 'BLOCKS',
      '0', 'BLOCK', '2', 'B1', '10', '0.0', '20', '0.0',
      '0', 'LINE', '8', '0', '10', '0.0', '20', '0.0', '11', '10.0', '21', '0.0',
      '0', 'ARC', '8', '0', '10', '0.0', '20', '0.0', '40', '5.0', '50', '0.0', '51', '90.0',
      '0', 'ENDBLK', '0', 'ENDSEC',
      '0', 'SECTION', '2', 'ENTITIES',
      '0', 'INSERT', '2', 'B1', '10', '100.0', '20', '50.0', '41', '1.0', '42', '-1.0', '50', '90.0',
      '0', 'ENDSEC', '0', 'EOF']);
    const rd4 = readDXF(insTxt);
    ok(rd4.entities.length === 2, 'INSERT: exploded count ' + rd4.entities.length);
    const il = rd4.entities.find(e => e.type === 'line');
    const ia = rd4.entities.find(e => e.type === 'arc');
    // file frame: M=[0,1,1,0] det=-1. line (0,0)-(10,0) -> (100,50)-(100,60);
    // internal: (100,-50)-(100,-60)
    ok(il && near(il.a.x, 100) && near(il.a.y, -50) && near(il.b.x, 100) && near(il.b.y, -60), 'INSERT: mirrored line');
    ok(ia && near(ia.c.x, 100) && near(ia.c.y, -50) && near(ia.r, 5), 'INSERT: mirrored arc center/r');
    if (ia) {
      // file arc after mirror: CCW 0..90deg at (100,50); internal: a0=-pi/2, a1=0
      const sweep = ((ia.a1 - ia.a0) % TAU + TAU) % TAU;
      const sx = ia.c.x + ia.r * Math.cos(ia.a0), sy = ia.c.y + ia.r * Math.sin(ia.a0);
      const ex = ia.c.x + ia.r * Math.cos(ia.a1), ey = ia.c.y + ia.r * Math.sin(ia.a1);
      ok(near(sweep, Math.PI / 2), 'INSERT: mirrored arc sweep ' + sweep);
      ok(near(sx, 100) && near(sy, -55) && near(ex, 105) && near(ey, -50), 'INSERT: mirrored arc endpoints');
    }

    // ---- INSERT with non-uniform scale: arc tessellation fallback ----
    const insNU = insTxt.replace(['41', '1.0'].join('\r\n'), ['41', '2.0'].join('\r\n'));
    const rd5 = readDXF(insNU);
    const tessPoly = rd5.entities.find(e => e.type === 'poly');
    ok(!!tessPoly && rd5.warnings.some(w => /tessellat/.test(w)), 'INSERT non-uniform: tessellated + warned');
    if (tessPoly) {
      // original arc pts (5cosA, 5sinA) -> file (x,y): x=2*? via M=R(90)S(2,-1):
      // every tessellated internal pt must satisfy ((y+50)/2)^2 + (x-100)^2 = 25
      const bad = tessPoly.pts.some(p => Math.abs(Math.pow((-p.y - 50) / 2, 2) + Math.pow(p.x - 100, 2) - 25) > 1e-6);
      ok(!bad, 'INSERT non-uniform: tessellated points off the ellipse');
    }

    // ---- TEXT %% escapes + MTEXT chunks/inline codes ----
    const txTxt = j(['0', 'SECTION', '2', 'ENTITIES',
      '0', 'TEXT', '8', '0', '10', '1.0', '20', '2.0', '40', '2.5',
      '1', '45%%d %%p0.1 %%c20 100%%% \\U+00D8ok',
      '0', 'MTEXT', '8', '0', '10', '0.0', '20', '0.0', '40', '3.0',
      '3', 'Hello \\C1;wor', '1', 'ld\\Pnext{}',
      '0', 'ENDSEC', '0', 'EOF']);
    const rd6 = readDXF(txTxt);
    ok(rd6.entities.length === 2, 'TEXT/MTEXT: count');
    ok(rd6.entities[0] && rd6.entities[0].text === '45° ±0.1 ∅20 100% Øok', 'TEXT escapes: "' + (rd6.entities[0] && rd6.entities[0].text) + '"');
    ok(rd6.entities[1] && rd6.entities[1].text === 'Hello world\nnext', 'MTEXT strip: "' + (rd6.entities[1] && rd6.entities[1].text) + '"');

    // ---- SPLINE: fit points, then de Boor sampling ----
    const spTxt = j(['0', 'SECTION', '2', 'ENTITIES',
      '0', 'SPLINE', '8', '0', '70', '0', '71', '3',
      '11', '0.0', '21', '0.0', '11', '5.0', '21', '5.0', '11', '10.0', '21', '0.0',
      '0', 'SPLINE', '8', '0', '70', '0', '71', '2',
      '40', '0', '40', '0', '40', '0', '40', '1', '40', '1', '40', '1',
      '10', '0.0', '20', '0.0', '10', '5.0', '20', '10.0', '10', '10.0', '20', '0.0',
      '0', 'ENDSEC', '0', 'EOF']);
    const rd7 = readDXF(spTxt);
    ok(rd7.entities.length === 2 && rd7.entities.every(e => e.type === 'poly'), 'SPLINE: two polylines');
    const fitP = rd7.entities[0], db = rd7.entities[1];
    ok(fitP && fitP.pts.length === 3 && near(fitP.pts[1].x, 5) && near(fitP.pts[1].y, -5), 'SPLINE fit points');
    ok(db && db.pts.length === 16 && near(db.pts[0].x, 0) && near(db.pts[0].y, 0)
      && near(db.pts[15].x, 10) && near(db.pts[15].y, 0), 'SPLINE de Boor endpoints');
    ok(db && db.pts.some(p => Math.abs(p.x - 5) < 0.5 && Math.abs(p.y + 5) < 0.2), 'SPLINE de Boor midpoint');

    // ---- classic POLYLINE: mesh skip + spline-frame vertex drop ----
    const plTxt = j(['0', 'SECTION', '2', 'ENTITIES',
      '0', 'POLYLINE', '8', '0', '66', '1', '70', '16',
      '0', 'VERTEX', '8', '0', '10', '0', '20', '0',
      '0', 'SEQEND', '8', '0',
      '0', 'POLYLINE', '8', '0', '66', '1', '70', '0',
      '0', 'VERTEX', '8', '0', '10', '0', '20', '0',
      '0', 'VERTEX', '8', '0', '10', '9', '20', '9', '70', '16',
      '0', 'VERTEX', '8', '0', '10', '5', '20', '1',
      '0', 'SEQEND', '8', '0',
      '0', 'ENDSEC', '0', 'EOF']);
    const rd8 = readDXF(plTxt);
    ok(rd8.entities.length === 1 && rd8.warnings.some(w => /mesh/.test(w)), 'POLYLINE mesh skipped + warned');
    ok(rd8.entities[0] && rd8.entities[0].pts.length === 2 && near(rd8.entities[0].pts[1].x, 5), 'POLYLINE spline-frame vertex dropped');

    // ---- extrusion 230 = -1 flip ----
    const exTxt = j(['0', 'SECTION', '2', 'ENTITIES',
      '0', 'CIRCLE', '8', '0', '10', '10.0', '20', '4.0', '40', '2.0', '210', '0.0', '220', '0.0', '230', '-1.0',
      '0', 'ENDSEC', '0', 'EOF']);
    const rd9 = readDXF(exTxt);
    ok(rd9.entities.length === 1 && near(rd9.entities[0].c.x, -10) && near(rd9.entities[0].c.y, -4), 'extrusion 230=-1 flips x');

    // ---- unknown entities warn, garbage never throws ----
    const unkTxt = j(['0', 'SECTION', '2', 'ENTITIES',
      '0', 'WIPEOUT', '8', '0', '10', '0', '20', '0',
      '0', 'LINE', '8', '0', '10', '0', '20', '0', '11', '1', '21', '1',
      '0', 'ENDSEC', '0', 'EOF']);
    const rd10 = readDXF(unkTxt);
    ok(rd10.entities.length === 1 && rd10.warnings.some(w => /WIPEOUT/.test(w)), 'unknown entity skipped + warned');
    for (const g of ['', 'garbage\nlines\nonly', null, '0\nSECTION\n2\nENTITIES\n0\nLINE\n10\nxyz']) {
      const r = readDXF(g);
      ok(r && Array.isArray(r.entities) && Array.isArray(r.warnings), 'reader threw or bad shape on garbage input');
    }

    // ---- ACI helpers ----
    ok(hexToACI('#ff0000') === 1 && hexToACI('#fe0100') === 1, 'hexToACI nearest red');
    ok(hexToACI('#ffffff') === 7 && aciToHex(1) === '#ff0000' && aciToHex(-3) === '#00ff00', 'ACI table basics');
    ok(aciToHex(9) === '#c0c0c0' && aciToHex(250) === '#333333', 'ACI grays');
  } catch (err) {
    F.push('selfTest exception: ' + (err && err.stack ? err.stack.split('\n').slice(0, 3).join(' | ') : String(err)));
  }
  return { pass: F.length === 0, failures: F };
}
