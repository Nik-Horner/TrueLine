// TrueLine first-use walkthrough: coach-mark tour with live "try it" steps.
// The canvas stays interactive during the tour; steps with a watch() predicate
// auto-advance once the user actually performs the action.
import { App } from './app.js';

const $ = id => document.getElementById(id);

let active = false;
let stepIdx = 0;
let baseline = {};          // counts captured when a step opens
let watchTimer = null;
let ring, card;

const STEPS = [
  {
    title: 'Welcome to TrueLine',
    body: 'This tool turns pen strokes into real CAD geometry and exports true-scale DXF for CNC, CAD, and pattern work.<br><br>The tour takes ~2 minutes and <b>you can draw the whole time</b> — some steps advance by themselves when you try the action.',
  },
  {
    target: 'palette', place: 'right',
    title: 'The tool palette',
    body: 'Drawing tools on top, modify tools (trim, offset, fillet…) below, measuring at the bottom. Hover any icon for its name and hotkey.<br><br><b>Try it: press <kbd>L</kbd> for Line.</b>',
    watch: () => App.tool?.id === 'line',
    done: 'Line tool armed ✓',
  },
  {
    title: 'Draw your first line',
    body: 'Click a start point, move, click the end point.<br><br>For an <b>exact</b> line: click the start, aim, then just type a number like <kbd>100</kbd> and press <kbd>Enter</kbd> — that\'s exactly 100&nbsp;mm. <kbd>Esc</kbd> ends the chain.<br><br><b>Try it: draw a line now.</b>',
    enter: () => { baseline.lines = count('line'); },
    watch: () => count('line') > baseline.lines,
    done: 'Line drawn ✓',
  },
  {
    target: 'ctxstrip', place: 'below',
    title: 'Tool options strip',
    body: 'Every tool shows its options here. Pick Circle (<kbd>C</kbd>) and you get <b>Center·R / 2-Pt / 3-Pt</b> modes — yes, proper 3-point circles. Arc (<kbd>A</kbd>) has 3-point and center-start-end.',
  },
  {
    title: 'Trace mode — the whole point',
    body: 'Press <kbd>S</kbd> and draw freehand with the pen. On release the stroke is <b>fitted into clean lines and arcs</b> automatically — corners detected, near-closed shapes snapped shut. Adjust the fit tolerance in the options strip.',
  },
  {
    target: 'statusbar', place: 'above',
    title: 'Precision chips',
    body: '<b>OSNAP</b> snaps your cursor to endpoints, midpoints, centers and intersections (watch for the green glyphs). <b>ORTHO</b> locks to 0/90°, <b>POLAR</b> to angle steps, <b>SNAP</b> to the grid.<br><br>Right-click OSNAP or POLAR for their settings. Hold <kbd>Shift</kbd> for temporary ortho.',
  },
  {
    title: 'Moving around the board',
    body: '<b>Wheel</b> zooms at the cursor · hold <b>Space</b> (or middle-drag) to pan · <kbd>Shift+1</kbd> fits the whole drawing · <kbd>H</kbd> is a pan tool for pen users.<br><br>On a touch tablet: one finger pans, two fingers pinch-zoom — the pen only ever draws.',
  },
  {
    target: 'chipCal', place: 'above',
    title: 'Calibrate — make it a measuring instrument',
    body: 'Click this chip, lay a ruler on your tablet, trace along a known distance, type the true length. From then on <b>everything you draw is real millimeters</b> and the DXF is dimensionally accurate.<br><br>You can also rescale an existing drawing or an imported photo the same way.',
  },
  {
    target: 'panelTablet', place: 'left',
    title: 'Your pen & pad buttons',
    body: 'Pen <b>barrel button</b> = next tool (configurable). Pen <b>eraser end</b> deletes what it touches.<br><br>Pad express keys send keystrokes: click <b>“+ Bind a pad button”</b>, press the physical button, then pick which tool it fires.',
  },
  {
    target: 'panelLayers', place: 'left',
    title: 'Layers & properties',
    body: 'Separate outline / holes / notes onto layers with their own colors and linetypes; hide or lock them. Select any entity and the <b>Properties</b> panel shows its exact coordinates — type new numbers to edit precisely.',
  },
  {
    target: 'exportBtn', place: 'below',
    title: 'Get your DXF',
    body: '<b>Export DXF</b> opens in AutoCAD, Fusion, LibreCAD and CAM software at true scale. SVG and 1:1-printable PDF live in the dropdown. <kbd>Ctrl+S</kbd> saves the project (it also autosaves).<br><br>That\'s everything — happy tracing! Reopen this tour anytime from <b>File → Tutorial</b>.',
  },
];

function count(type) { return App.doc.entities.filter(e => e.type === type).length; }

export function tourDone() { return !!localStorage.getItem('tl-tour-done'); }

export function startTour() {
  if (active) return;
  active = true;
  stepIdx = 0;
  ring = document.createElement('div');
  ring.className = 'tour-ring';
  card = document.createElement('div');
  card.className = 'tour-card';
  document.body.append(ring, card);
  addEventListener('keydown', tourKeys, true);
  addEventListener('resize', position);
  watchTimer = setInterval(tick, 350);
  show();
}

export function endTour() {
  if (!active) return;
  active = false;
  clearInterval(watchTimer);
  removeEventListener('keydown', tourKeys, true);
  removeEventListener('resize', position);
  ring.remove(); card.remove();
  localStorage.setItem('tl-tour-done', '1');
}

function tourKeys(ev) {
  if (ev.key === 'Escape') { endTour(); ev.stopPropagation(); ev.preventDefault(); }
}

let satisfied = false;
function show() {
  const s = STEPS[stepIdx];
  satisfied = false;
  s.enter?.();
  card.innerHTML = `
    <div class="tour-head">
      <span class="tour-step">${stepIdx + 1}/${STEPS.length}</span>
      <b>${s.title}</b>
      <button class="tour-x" title="End tour (Esc)">✕</button>
    </div>
    <div class="tour-body">${s.body}</div>
    <div class="tour-check" hidden></div>
    <div class="tour-actions">
      <button class="tour-back" ${stepIdx === 0 ? 'disabled' : ''}>Back</button>
      <button class="tour-next">${stepIdx === STEPS.length - 1 ? 'Finish' : 'Next'}</button>
    </div>`;
  card.querySelector('.tour-x').onclick = endTour;
  card.querySelector('.tour-back').onclick = () => { if (stepIdx > 0) { stepIdx--; show(); } };
  card.querySelector('.tour-next').onclick = next;
  position();
}
function next() {
  if (stepIdx >= STEPS.length - 1) endTour();
  else { stepIdx++; show(); }
}
function tick() {
  const s = STEPS[stepIdx];
  if (!s.watch || satisfied) { position(); return; }
  if (s.watch()) {
    satisfied = true;
    const chk = card.querySelector('.tour-check');
    chk.hidden = false;
    chk.textContent = s.done || 'Done ✓';
    setTimeout(() => { if (active && satisfied && STEPS[stepIdx] === s) next(); }, 900);
  }
  position();
}
function position() {
  const s = STEPS[stepIdx];
  const target = s.target && $(s.target);
  if (target) {
    const r = target.getBoundingClientRect();
    ring.style.display = 'block';
    ring.style.left = (r.left - 5) + 'px';
    ring.style.top = (r.top - 5) + 'px';
    ring.style.width = (r.width + 10) + 'px';
    ring.style.height = (r.height + 10) + 'px';
    // card placement with clamping
    const cw = card.offsetWidth || 330, ch = card.offsetHeight || 200;
    let x, y;
    switch (s.place) {
      case 'right': x = r.right + 14; y = r.top + 10; break;
      case 'left': x = r.left - cw - 14; y = r.top + 10; break;
      case 'above': x = r.left + r.width / 2 - cw / 2; y = r.top - ch - 14; break;
      default: x = r.left + r.width / 2 - cw / 2; y = r.bottom + 14;
    }
    card.style.left = Math.max(8, Math.min(innerWidth - cw - 8, x)) + 'px';
    card.style.top = Math.max(8, Math.min(innerHeight - ch - 8, y)) + 'px';
  } else {
    ring.style.display = 'none';
    const cw = card.offsetWidth || 330, ch = card.offsetHeight || 200;
    card.style.left = (innerWidth / 2 - cw / 2) + 'px';
    card.style.top = (innerHeight * 0.30 - ch / 2) + 'px';
  }
}
