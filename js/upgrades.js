// Tracing workflows and review UI; geometry lives in workflows.js.
import { App, mutate, addEntity, setTool, setSelection, selectedEntities, selectableEntities,
  invalidate, zoomFit, toScreen, getUnderlayImg, setUnderlay,
  recoveryHistory, flushAutosave, loadProject, scheduleAutosave, reloadUnderlayImg } from './app.js';
import { rigidAlignment, auditContours, joinContours, measurementScale, homography, imagePoint } from './workflows.js';
import * as G from './geom.js';
import { readRevisions } from './recovery.js';

const $ = id => document.getElementById(id);
function node(tag, text, attrs = {}) {
  const n = document.createElement(tag);
  if (text != null) n.textContent = text;
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
  return n;
}
function button(label, cb) { const b = node('button', label, { class: 'btn-ghost', type: 'button' }); b.onclick = cb; return b; }
function paragraph(box, text) { box.append(node('p', text)); }
function number(box, label, value, min = 0.001) {
  const l = node('label', label, { class: 'workflow-field' });
  const i = node('input', null, { type: 'number', value, min, step: 'any' });
  l.append(i); box.append(l); return i;
}
function actions(box, ...buttons) { const row = node('div', null, { class: 'modal-actions' }); row.append(...buttons); box.append(row); }
function modal(title, build) { App.ui.showModal(box => { box.append(node('h3', title)); build(box); }); }
function close() { App.ui.hideModal(); }
function error(e) { App.ui.toast(e.message || String(e), 6500); }
function dirty() { App.ui.setDirty(true); scheduleAutosave(); invalidate('all'); App.ui.refreshAll(); }
function withImage(fn) { if (!App.doc.underlay || !getUnderlayImg()?.naturalWidth) { App.ui.toast('Import an image underlay first'); return; } fn(); }
function noPending() {
  if (App.tools.get('freehand').pending || App.tools.get('freehand').raw) { App.ui.toast('Accept or discard the trace preview first'); return false; }
  return true;
}

// A reusable point-picking state machine. Esc always returns to selection.
const picker = {
  id: 'workflow-pick', name: 'Reference marks', icon: 'point', key: '', points: [], cur: null,
  activate(opts) { this.points = []; this.cur = null; Object.assign(this, opts); this.hint(); },
  hint() { App.ui.hint(`<b>REFERENCE</b> ${this.instructions[this.points.length] || 'review measurements'} · Esc cancel`); },
  options() { return [{ type: 'info', text: `${this.points.length} / ${this.count} marks` }]; },
  onDown(p) {
    this.points.push({ ...p });
    if (this.points.length === this.count) {
      const points = this.points.map(p => ({ ...p })), done = this.done;
      setTool('select');
      try { done(points); } catch (e) { error(e); }
    } else { this.hint(); App.ui.refreshCtx(); }
    invalidate('overlay');
  },
  onMove(p) { this.cur = p; }, onUp() {},
  onKey(ev) { if (ev.key === 'Escape') { setTool('select'); return true; } },
  cancel() { this.points = []; },
  preview(cx) {
    cx.strokeStyle = '#f5ad56'; cx.fillStyle = '#f5ad56'; cx.font = '12px sans-serif'; cx.lineWidth = 2;
    this.points.forEach((p, i) => { const s = toScreen(p); cx.beginPath(); cx.arc(s.x, s.y, 6, 0, Math.PI * 2); cx.stroke(); cx.fillText(String(i + 1), s.x + 9, s.y - 9); });
  },
};
App.tools.set(picker.id, picker);
function pick(instructions, done) { setTool(picker.id, { instructions, count: instructions.length, done }); }

function startSection() {
  if (!noPending()) return;
  if (App.doc.section) { App.ui.toast('Align or discard the active section before starting another'); return; }
  modal('Trace an assembly piece', box => {
    paragraph(box, 'Use three well-spaced marks on the part that remain accessible in both positions. First trace the portion that fits. Pick those marks in the existing drawing, then reposition the physical part and trace the next portion, including the same marks.');
    paragraph(box, 'After tracing, choose Assemble active piece and pick the marks in the new position in the same order. Alignment moves and rotates only the new section; it preserves its dimensions.');
    const name = node('input', null, { value: `Piece ${(App.doc.assemblies?.length || 0) + 1}`, 'aria-label': 'Piece name', maxlength: 80 }); box.append(name);
    const two = node('input', null, { type: 'checkbox' }); const label = node('label', ' Use only two marks (less verification)'); label.prepend(two); box.append(label);
    actions(box, button('Pick shared reference marks', () => {
      close(); pick(Array.from({ length: two.checked ? 2 : 3 }, (_, i) => `Pick existing shared mark ${i + 1}`), target => {
        if (G.dist(target[0], target[1]) < 0.01) throw new Error('Choose distinct, well-spaced marks.');
        mutate('Started assembly piece', () => {
          const previousLayer = App.doc.currentLayer, layer = 'L' + Date.now().toString(36);
          App.doc.layers.push({ id: layer, name: name.value.trim() || 'Assembly piece', color: '#54dbe7', ltype: 'continuous', visible: true, locked: false });
          App.doc.currentLayer = layer;
          App.doc.section = { target, ids: [], name: name.value.trim() || 'Assembly piece', layer, previousLayer };
        });
        setTool('freehand'); App.ui.toast('Reposition the part, trace this piece, then choose Assemble active piece', 9000);
      });
    }), button('Cancel', close));
  });
}
function alignSection() {
  if (!noPending()) return;
  const section = App.doc.section;
  if (!section?.ids.length) { App.ui.toast('Start a section and trace its new outline first'); return; }
  pick(section.target.map((_, i) => `Pick shared mark ${i + 1} on the NEW piece`), source => {
    const alignment = rigidAlignment(source, section.target);
    modal('Review assembly placement', box => {
      paragraph(box, `Rotation ${(alignment.angle * 180 / Math.PI).toFixed(2)}° · reference error ${alignment.max.toFixed(3)} mm. Dimensions are preserved.`);
      const mismatch = alignment.max > App.doc.traceOpts.tol;
      if (mismatch) paragraph(box, 'The reference error exceeds your tracing tolerance. Placement is blocked: recheck the marks or retrace this piece.');
      paragraph(box, 'This keeps the piece on its own layer. Shared edges are not merged or stretched. Run Check contours to inspect connections before explicitly joining edges.');
      const ids = new Set(section.ids), entities = App.doc.entities.filter(e => ids.has(e.id));
      setSelection([...ids]);
      const preview = node('canvas', null, { width: 560, height: 240, class: 'alignment-preview' }); box.append(preview);
      const ctx = preview.getContext('2d');
      const transformed = entities.map(alignment.entity);
      const bounds = [...App.doc.entities.filter(e => !ids.has(e.id)), ...transformed].map(G.entBounds);
      const minX = Math.min(...bounds.map(b => b.minX)), minY = Math.min(...bounds.map(b => b.minY));
      const maxX = Math.max(...bounds.map(b => b.maxX)), maxY = Math.max(...bounds.map(b => b.maxY));
      const scale = Math.min(520 / Math.max(1, maxX - minX), 200 / Math.max(1, maxY - minY));
      const draw = (list, color) => {
        ctx.strokeStyle = color; ctx.lineWidth = 1.2;
        for (const e of list) {
          const segs = e.type === 'poly' ? G.polyToSegments(e) : [e];
          for (const seg of segs) {
            ctx.beginPath();
            const map = p => ({ x: 20 + (p.x - minX) * scale, y: 20 + (p.y - minY) * scale });
            if (seg.type === 'line') { const a = map(seg.a), b = map(seg.b); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); }
            else if (seg.type === 'arc' || seg.type === 'circle') { const c = map(seg.c); ctx.arc(c.x, c.y, seg.r * scale, seg.a0 || 0, seg.type === 'circle' ? Math.PI * 2 : (seg.a0 + G.sweep(seg.a0, seg.a1))); }
            ctx.stroke();
          }
        }
      };
      draw(App.doc.entities.filter(e => !ids.has(e.id)), '#DEE3EC'); draw(transformed, '#54dbe7');
      paragraph(box, 'White: existing drawing. Cyan: aligned section.');
      const apply = button('Place separate piece', () => {
        if (mismatch) return;
        mutate('Aligned trace section', () => {
          App.doc.entities = App.doc.entities.map(e => ids.has(e.id) ? alignment.entity(e) : e);
          App.doc.assemblies ||= [];
          const record = { name: section.name, layer: section.layer, ids: section.ids, source, target: section.target, maxError: alignment.max };
          const existing = App.doc.assemblies.findIndex(p => p.layer === section.layer);
          if (existing >= 0) App.doc.assemblies[existing] = record; else App.doc.assemblies.push(record);
          App.doc.currentLayer = section.previousLayer || App.doc.currentLayer;
          App.doc.section = null;
        });
        close(); zoomFit(); setTool('freehand');
      });
      apply.disabled = mismatch;
      actions(box, apply, button('Pick marks again', () => { close(); alignSection(); }), button('Cancel', close));
    });
  });
}
function discardSection() {
  if (!App.doc.section || !noPending()) return;
  if (App.doc.section.existing) { mutate('Canceled reassembly', () => { App.doc.section = null; }); return; }
  modal('Discard active piece?', box => {
    paragraph(box, 'This removes the entities captured since you started this section. You can undo the removal.');
    actions(box, button('Discard section', () => {
      const ids = new Set(App.doc.section.ids);
      mutate('Discarded assembly piece', () => {
        App.doc.entities = App.doc.entities.filter(e => !ids.has(e.id));
        App.doc.currentLayer = App.doc.section.previousLayer || App.doc.currentLayer;
        App.doc.layers = App.doc.layers.filter(l => l.id !== App.doc.section.layer);
        App.doc.section = null;
      });
      close(); setSelection([]);
    }), button('Keep tracing', close));
  });
}

function assemblyDialog() {
  if (!noPending()) return;
  modal('Assembly pieces', box => {
    paragraph(box, 'Each piece remains independent on its own layer. Select a piece to move or rotate it, or reassemble it using shared marks. Joining contours is a separate, explicit operation.');
    const pieces = App.doc.assemblies || [];
    if (!pieces.length) paragraph(box, 'No placed pieces yet. Start with Trace assembly piece.');
    for (const piece of pieces) {
      const ids = piece.ids.filter(id => App.doc.entities.some(e => e.id === id));
      const row = node('div', null, { class: 'assembly-piece' });
      row.append(node('strong', piece.name), node('span', ` ${ids.length} entities · last alignment error ${piece.maxError.toFixed(3)} mm`));
      row.append(button('Select piece', () => { close(); setTool('select'); setSelection(ids); zoomFit(selectedEntities()); }), button('Reassemble', () => {
        if (App.doc.section) return App.ui.toast('Finish the active piece first');
        if (!ids.length) return App.ui.toast('This piece has been joined or deleted');
        close();
        pick(['Pick shared mark 1 in the main outline', 'Pick shared mark 2 in the main outline', 'Pick shared mark 3 in the main outline'], target => {
          mutate('Reassembling piece', () => {
            App.doc.section = { target, ids, name: piece.name, layer: piece.layer, previousLayer: App.doc.currentLayer, existing: true };
          });
          alignSection();
        });
      })); box.append(row);
    }
    actions(box, button('Trace another piece', () => { close(); startSection(); }), button('Close', close));
  });
}

export function toggleTracingMode() {
  document.body.classList.toggle('tracing-mode');
  $('tracingMode').textContent = document.body.classList.contains('tracing-mode') ? 'Exit tracing mode · Tab' : 'Tracing mode · Tab';
  invalidate('all');
}

function rotatePhoto() { withImage(() => modal('Rotate image underlay', box => {
  const angle = number(box, 'Rotation in degrees (clockwise)', ((App.doc.underlay.rotation || 0) * 180 / Math.PI).toFixed(2), -360);
  actions(box, button('Apply', () => {
    const value = +angle.value;
    if (!Number.isFinite(value) || !angle.value.trim()) return error(new Error('Enter a valid angle.'));
    mutate('Rotated image', () => { App.doc.underlay.rotation = value * Math.PI / 180; }); close();
  }), button('Cancel', close));
})); }
function photoCalibration() { withImage(() => {
  if (!noPending()) return;
  const samples = [];
  const next = () => pick(['Pick one end of a measured feature in the photo', 'Pick its other end'], points => {
    const measured = G.dist(...points);
    if (measured < 0.001) { error(new Error('Choose two distinct endpoints.')); return; }
    modal('Photo measurement', box => {
      const actual = number(box, 'Real length in millimeters', measured.toFixed(2));
      actions(box, button('Add measurement', () => {
        if (!(+actual.value > 0) || !Number.isFinite(+actual.value)) return error(new Error('Enter a positive length.'));
        samples.push({ measured, actual: +actual.value }); close(); review();
      }), button('Cancel', close));
    });
  });
  const review = () => modal('Calibrate photo from several measurements', box => {
    paragraph(box, `${samples.length} measurements. Use features in different parts of the image to check consistency. Only the photo will be resized; existing geometry keeps its dimensions.`);
    const list = node('ul'); samples.forEach((m, i) => list.append(node('li', `${i + 1}: current ${m.measured.toFixed(3)} mm → real ${m.actual.toFixed(3)} mm`))); box.append(list);
    let fit;
    if (samples.length >= 2) { fit = measurementScale(samples); paragraph(box, `Scale ×${fit.factor.toFixed(5)} · RMS measurement error ${fit.rms.toFixed(3)} mm. Perspective or lens distortion can cause inconsistent measurements.`); }
    actions(box, button('Add another measurement', () => { close(); next(); }), ...(fit ? [button('Apply photo scale', () => {
      mutate('Calibrated photo', () => { App.doc.underlay.wMM *= fit.factor; App.doc.underlay.hMM *= fit.factor; App.doc.underlay.calibration = { samples, rms: fit.rms }; });
      close(); App.ui.toast('Photo scale applied; verify a separate known distance');
    })] : []), button('Cancel', close));
  });
  next();
}); }
function rectifyPhoto() { withImage(() => {
  if (!noPending()) return;
  modal('Correct photo perspective', box => {
    paragraph(box, 'Place a known rectangular reference on the same flat plane as the part. Pick its corners clockwise: top-left, top-right, bottom-right, bottom-left. Enter its real width and height. The result covers that rectangle; include the entire part inside it.');
    paragraph(box, 'This corrects perspective on a flat plane. Use measured features afterward to check lens distortion.');
    actions(box, button('Pick four corners', () => { close(); pick(['Pick top-left corner', 'Pick top-right corner', 'Pick bottom-right corner', 'Pick bottom-left corner'], corners => {
      const u = { ...App.doc.underlay }, img = getUnderlayImg(), pixels = corners.map(p => imagePoint(p, u, img));
      if (pixels.some(p => p.x < -1e-5 || p.y < -1e-5 || p.x > img.naturalWidth + 1e-5 || p.y > img.naturalHeight + 1e-5)) throw new Error('All four corners must be inside the image.');
      homography(pixels, 1, 1); // validate before opening dimensions
      modal('Reference rectangle dimensions', box => {
        const width = number(box, 'Real width in millimeters', G.dist(corners[0], corners[1]).toFixed(2));
        const height = number(box, 'Real height in millimeters', G.dist(corners[1], corners[2]).toFixed(2));
        const apply = button('Correct image', async () => {
          const wMM = +width.value, hMM = +height.value;
          if (!(wMM > 0 && hMM > 0 && Number.isFinite(wMM) && Number.isFinite(hMM))) return error(new Error('Enter positive, finite dimensions.'));
          apply.disabled = true; apply.textContent = 'Correcting…';
          try {
            const resolution = Math.min(2048 / wMM, 2048 / hMM, img.naturalWidth / wMM, img.naturalHeight / hMM);
            const w = Math.max(1, Math.round(wMM * resolution)), h = Math.max(1, Math.round(hMM * resolution));
            const map = homography(pixels, w, h);
            const srcCanvas = document.createElement('canvas'); srcCanvas.width = img.naturalWidth; srcCanvas.height = img.naturalHeight;
            const sc = srcCanvas.getContext('2d', { willReadFrequently: true }); sc.drawImage(img, 0, 0);
            const src = sc.getImageData(0, 0, srcCanvas.width, srcCanvas.height);
            const dest = document.createElement('canvas'); dest.width = w; dest.height = h;
            const dc = dest.getContext('2d'), out = dc.createImageData(w, h);
            for (let y = 0; y < h; y++) {
              for (let x = 0; x < w; x++) {
                const p = map(x + 0.5, y + 0.5), fx = Math.max(0, Math.min(src.width - 1, p.x - 0.5)), fy = Math.max(0, Math.min(src.height - 1, p.y - 0.5));
                const x0 = Math.floor(fx), y0 = Math.floor(fy), x1 = Math.min(src.width - 1, x0 + 1), y1 = Math.min(src.height - 1, y0 + 1), tx = fx - x0, ty = fy - y0;
                for (let c = 0; c < 4; c++) out.data[(y*w+x)*4+c] =
                  src.data[(y0*src.width+x0)*4+c]*(1-tx)*(1-ty) + src.data[(y0*src.width+x1)*4+c]*tx*(1-ty) +
                  src.data[(y1*src.width+x0)*4+c]*(1-tx)*ty + src.data[(y1*src.width+x1)*4+c]*tx*ty;
              }
              if (y % 64 === 0) {
                await new Promise(r => requestAnimationFrame(r));
                if ($('modalRoot').hidden || !apply.isConnected) return;
              }
            }
            if ($('modalRoot').hidden || !apply.isConnected) return;
            dc.putImageData(out, 0, 0);
            setUnderlay({ dataURL: dest.toDataURL('image/png'), x: corners[0].x, y: corners[0].y, wMM, hMM, rotation: 0, opacity: u.opacity, visible: true });
            await reloadUnderlayImg(); close(); App.ui.toast('Perspective corrected. Undo restores the original photo.');
          } catch (e) { error(e); apply.disabled = false; apply.textContent = 'Correct image'; }
        });
        actions(box, apply, button('Cancel', close));
      });
    }); }), button('Cancel', close));
  });
}); }

let auditMarks = [];
const auditTool = {
  id: 'contour-review', name: 'Contour review', icon: 'measure', key: '',
  activate() { App.ui.hint('<b>CONTOUR CHECK</b> orange marks show gaps and intersections · Esc clears'); },
  cancel() { auditMarks = []; }, onDown() {}, onMove() {}, onUp() {},
  preview(cx) {
    cx.strokeStyle = '#f5ad56'; cx.lineWidth = 2;
    for (const issue of auditMarks) {
      if (!issue.p) continue;
      const p = toScreen(issue.p); cx.beginPath(); cx.arc(p.x, p.y, 7, 0, Math.PI * 2); cx.stroke();
      if (issue.q) { const q = toScreen(issue.q); cx.beginPath(); cx.moveTo(p.x, p.y); cx.lineTo(q.x, q.y); cx.stroke(); }
    }
  },
};
App.tools.set(auditTool.id, auditTool);
function exportEntities() { return App.doc.entities.filter(e => App.doc.layers.find(l => l.id === e.layer)?.visible !== false); }
export function reviewContours(onExport = null) {
  if (!noPending()) return;
  const list = onExport ? App.doc.entities : (selectedEntities().length ? selectedEntities() : exportEntities());
  const issues = auditContours(list);
  modal(onExport ? 'Check outlines before export' : 'Contour check', box => {
    paragraph(box, onExport ? 'Checks cover all exported entities, including hidden layers. Open paths can be intentional for engraving or annotations.' : 'Checks cover the selection, or all visible geometry if nothing is selected. Gap search: 0.5 mm.');
    if (!issues.length) paragraph(box, 'No gaps, open endpoints, duplicate edges, zero-length edges, branches, or intersections found.');
    else {
      const counts = {};
      for (const issue of issues) counts[issue.kind] = (counts[issue.kind] || 0) + 1;
      paragraph(box, Object.entries(counts).map(([kind, n]) => `${n} ${kind}`).join(' · '));
      const ul = node('ul', null, { class: 'contour-issues' });
      for (const issue of issues.slice(0, 100)) {
        const li = node('li'); li.append(button(`${issue.kind}${issue.distance != null ? `: ${issue.distance.toFixed(3)} mm` : ''}`, () => {
          close(); setTool(auditTool.id); auditMarks = [issue];
          setSelection(issue.ids); zoomFit(App.doc.entities.filter(e => issue.ids.includes(e.id))); invalidate('overlay');
        })); ul.append(li);
      }
      box.append(ul);
      if (issues.length > 100) paragraph(box, `Showing the first 100 of ${issues.length} findings.`);
    }
    actions(box, ...(issues.length ? [button('Show all problem marks', () => { close(); setTool(auditTool.id); auditMarks = issues; setSelection([...new Set(issues.flatMap(i => i.ids))]); invalidate('overlay'); })] : []),
      ...(onExport ? [button('Export drawing', () => { close(); onExport(); })] : [button('Join selected / visible contours', () => { close(); joinDialog(); })]), button('Close', close));
  });
}
function joinDialog() {
  if (!noPending()) return;
  const chosen = selectedEntities(), list = chosen.length ? chosen : selectableEntities();
  if (list.some(e => App.doc.layers.find(l => l.id === e.layer)?.locked)) return App.ui.toast('Unlock selected layers before joining');
  modal('Join contour sections', box => {
    paragraph(box, 'Join unbranched lines, arcs, and polylines on the same layer. Small gaps are filled with explicit straight connectors, preserving existing curves. Branches require manual repair.');
    const tolerance = number(box, 'Maximum gap to bridge (millimeters)', 0.5, 0);
    const summary = node('p'); box.append(summary);
    const across = node('input', null, { type: 'checkbox' });
    const crossLabel = node('label', ' Join across layers onto the current layer'); crossLabel.prepend(across); box.append(crossLabel);
    let joined;
    const update = () => { try { joined = joinContours(across.checked ? list.map(e => ({ ...e, layer: App.doc.currentLayer })) : list, +tolerance.value); summary.textContent = `${list.length} entities → ${joined.entities.length} contours/entities · ${joined.bridges} straight gap connectors`; } catch (e) { joined = null; summary.textContent = e.message; } };
    tolerance.oninput = update; across.onchange = update; update();
    actions(box, button('Apply joins', () => {
      update(); if (!joined || !tolerance.value.trim()) return;
      const ids = new Set(list.map(e => e.id));
      mutate('Joined contours', () => { App.doc.entities = App.doc.entities.filter(e => !ids.has(e.id)); for (const e of joined.entities) addEntity({ ...e, id: undefined }); });
      setSelection([]); close(); reviewContours();
    }), button('Cancel', close));
  });
}

async function recoveryDialog() {
  if (!noPending()) return;
  await flushAutosave();
  let history;
  try { history = await readRevisions(); } catch { history = recoveryHistory(); }
  modal('Project recovery history', box => {
    paragraph(box, 'Recovery backups are stored on this device and are separate from your saved project file. Save a project file for a durable copy. Restoring a revision keeps the current drawing in history.');
    if (!history.length) paragraph(box, 'No historical revisions available.');
    const list = node('div', null, { class: 'recovery-list' }); box.append(list);
    for (const rev of history) list.append(button(`${rev.name || 'untitled'} — ${new Date(rev.at).toLocaleString()}`, async () => {
      await flushAutosave(); loadProject(rev.json); dirty(); close(); zoomFit(); App.ui.toast('Revision restored — save your project file to keep it');
    }));
    actions(box, button('Save current project', () => App.ui.saveProject()), button('Close', close));
  });
}
export function initUpgrades() {
  const items = [['Trace assembly piece…', startSection], ['Assemble active piece…', alignSection], ['Discard active piece…', discardSection], ['Assembly pieces…', assemblyDialog],
    ['Rotate image…', rotatePhoto], ['Correct photo perspective…', rectifyPhoto], ['Calibrate photo measurements…', photoCalibration],
    ['Check contours…', () => reviewContours()], ['Join contours…', joinDialog], ['Recovery history…', recoveryDialog]];
  const details = node('details', null, { class: 'workflow-menu' }), summary = node('summary', 'Tracing'); details.append(summary);
  const menu = node('div', null, { class: 'menu' }); details.append(menu);
  for (const [label, fn] of items) menu.append(button(label, () => { details.open = false; fn(); }));
  $('fileBtn').closest('.ab-cluster').append(details);
  const mode = button('Tracing mode · Tab', toggleTracingMode); mode.id = 'tracingMode'; mode.className = 'ab-btn';
  $('appbar').querySelector('.ab-right').prepend(mode);
  const floating = node('div', null, { id: 'tracingBar' });
  floating.append(button('Exit · Tab', toggleTracingMode), button('Pan', () => setTool('pan')), button('Trace', () => setTool('freehand')),
    button('Undo', () => App.ui.undo()), button('Accept trace', () => App.tools.get('freehand').accept()), button('Trace piece', startSection), button('Assemble', alignSection));
  document.body.append(floating);
  App.ui.reviewContours = reviewContours;
  const recovery = button('Backup pending', recoveryDialog); recovery.id = 'recoveryChip'; recovery.className = 'chip wide'; $('statusbar').querySelector('.status-right').prepend(recovery);
  App.ui.recoveryStatus = () => {
    recovery.textContent = App.recoveryAt ? 'Backup ✓' : 'Backup pending';
    recovery.title = App.recoveryAt ? `Device recovery: ${new Date(App.recoveryAt).toLocaleString()} · Click for history` : 'No recovery backup yet';
    $('dirty').title = `${App.fileDirty ? 'Changes not saved to a project file. ' : ''}${App.recoveryAt ? 'Recovery backup: ' + new Date(App.recoveryAt).toLocaleTimeString() : 'No recovery backup yet'}`;
  };
  App.ui.setDirty(App.fileDirty); App.ui.recoveryStatus();
  document.addEventListener('keydown', ev => {
    if (ev.key === 'Tab' && !ev.ctrlKey && !ev.metaKey && !ev.altKey && !ev.shiftKey && ev.target === document.body && $('modalRoot').hidden) { ev.preventDefault(); toggleTracingMode(); }
  });
  document.addEventListener('visibilitychange', () => { if (document.hidden) flushAutosave(); });
  window.addEventListener('pagehide', flushAutosave);
  window.addEventListener('beforeunload', ev => { flushAutosave(); if (App.fileDirty) { ev.preventDefault(); ev.returnValue = ''; } });
  document.addEventListener('pointerdown', ev => { if (!details.contains(ev.target)) details.open = false; });
}
