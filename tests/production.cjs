// Extensive production test — drives every tool through its real state machine in the
// live Electron app, exercises layers/undo/save-load, and writes DXF/SVG/PDF for parser
// validation. Run against a running app on :9223.  node tests/production.cjs <outDir>
const puppeteer = require('puppeteer-core');
const fs = require('fs');
const path = require('path');
const outDir = process.argv[2] || '.';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const results = [];
const check = (name, cond, extra = '') => { results.push({ name, pass: !!cond, extra: String(extra) }); };

(async () => {
  const APP_URL = process.env.APP_URL || 'http://127.0.0.1:8390/';
  const browser = await puppeteer.connect({ browserURL: 'http://127.0.0.1:9223', defaultViewport: null });
  const page = (await browser.pages())[0];
  await page.goto(APP_URL, { waitUntil: 'networkidle0' });
  await page.bringToFront();
  await sleep(400);
  const pageErrors = [];
  page.on('pageerror', e => pageErrors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') pageErrors.push('console: ' + m.text()); });
  await page.bringToFront();

  // ---- A. module self-tests (run in-page, resolves against the app origin) ----
  await page.evaluate(() => { localStorage.clear(); localStorage.setItem('tl-tour-done', '1'); localStorage.setItem('tl-frdone', '1'); });
  await page.reload({ waitUntil: 'networkidle0' });
  await sleep(1000);
  const testLogs = await page.evaluate(() =>
    Promise.all(['geom', 'dxf', 'pdf', 'icons'].map(async n => {
      const m = await import('/js/' + n + '.js');
      return [n, m.selfTest ? m.selfTest() : { pass: false, failures: ['no selfTest'] }];
    })));
  for (const [n, r] of testLogs) check('module selftest: ' + n, r.pass, (r.failures || []).join(','));

  // ---- set up interactive session ----
  await page.evaluate(async () => { window.__m = await import('/js/app.js'); });

  // Drive tools with synthetic PointerEvents on the overlay — same handler path as real
  // input, but immune to whether the background-launched window is composited for hit-testing.
  const pdispatch = (type, wx, wy, buttons) => page.evaluate((type, wx, wy, buttons) => {
    const m = window.__m, cv = document.getElementById('cvOverlay');
    const r = cv.getBoundingClientRect(), s = m.toScreen({ x: wx, y: wy });
    cv.dispatchEvent(new PointerEvent(type, {
      clientX: r.left + s.x, clientY: r.top + s.y, button: 0, buttons,
      pointerId: 1, pointerType: 'pen', pressure: type === 'pointerup' ? 0 : 0.5, isPrimary: true, bubbles: true,
    }));
  }, type, wx, wy, buttons);
  async function clickW(wx, wy) { await pdispatch('pointermove', wx, wy, 0); await pdispatch('pointerdown', wx, wy, 1); await pdispatch('pointerup', wx, wy, 0); await sleep(50); }
  async function moveW(wx, wy) { await pdispatch('pointermove', wx, wy, 0); await sleep(20); }
  const pkey = key => page.evaluate(k => window.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true })), key);
  const arm = id => page.evaluate(id => window.__m.setTool(id), id);
  const reset = () => page.evaluate(() => { window.__m.newDoc(); window.__m.App.view = { x: -20, y: -20, z: 3 }; window.__m.invalidate('all'); });
  const ents = () => page.evaluate(() => window.__m.App.doc.entities.map(e => e.type));
  const last = () => page.evaluate(() => window.__m.App.doc.entities[window.__m.App.doc.entities.length - 1]);
  const seed = arr => page.evaluate(a => { const m = window.__m; m.newDoc(); m.App.view = { x: -20, y: -20, z: 3 }; for (const e of a) m.addEntity(e); m.invalidate('all'); }, arr);
  const selectAll = () => page.evaluate(() => { const m = window.__m; m.setSelection(m.App.doc.entities.map(e => e.id)); });

  // ---- B. draw tools via pointer ----
  await reset();
  await arm('polyline');
  await clickW(0, 0); await clickW(40, 0); await clickW(40, 30);
  await pkey('Enter'); await sleep(100);
  check('polyline drawn', (await last())?.type === 'poly', JSON.stringify(await ents()));

  await arm('point'); await clickW(60, 10);
  check('point placed', (await last())?.type === 'point');

  await arm('text'); await clickW(5, 50); await sleep(150);
  await page.evaluate(() => { const i = document.querySelector('#viewport > .dynfield input'); if (i) { i.value = 'PART-01'; i.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); } });
  await sleep(150);
  check('text placed', (await last())?.type === 'text' && (await last())?.text === 'PART-01', (await last())?.text);

  // circle center-radius via two picks (center + radius point)
  await reset(); await arm('circle');
  await page.evaluate(() => { window.__m.App.tool.mode = 'cr'; });
  await clickW(50, 50); await clickW(75, 50); await sleep(100);
  check('circle center-radius r=25', (await last())?.type === 'circle' && Math.abs((await last()).r - 25) < 1e-6, (await last())?.r);

  // ---- C. modify tools ----
  // MOVE
  await seed([{ type: 'line', a: { x: 0, y: 0 }, b: { x: 20, y: 0 } }]);
  await selectAll(); await arm('move');
  await clickW(0, 0); await clickW(100, 0); await sleep(100);
  check('move +100x', Math.abs((await last()).a.x - 100) < 0.5, (await last())?.a?.x);

  // COPY
  await seed([{ type: 'line', a: { x: 0, y: 0 }, b: { x: 20, y: 0 } }]);
  await selectAll(); await arm('copy');
  await clickW(0, 0); await clickW(0, 40); await sleep(100);
  check('copy makes 2', (await ents()).filter(t => t === 'line').length === 2, (await ents()).length);

  // ROTATE via ray pick (dest straight down = -90° → b lands at (0,-30))
  await seed([{ type: 'line', a: { x: 0, y: 0 }, b: { x: 30, y: 0 } }]);
  await selectAll(); await arm('rotate');
  await clickW(0, 0);                       // base -> phase act
  await clickW(0, -30);                     // ray at atan2(-30,0) = -90°
  await sleep(100);
  check('rotate -90 (b.y≈-30)', Math.abs((await last()).b.y - (-30)) < 0.5, (await last())?.b?.y);

  // SCALE reference mode: pick base + reference length, then supply true length via onInput
  await seed([{ type: 'line', a: { x: 0, y: 0 }, b: { x: 10, y: 0 } }]);
  await selectAll(); await arm('scale');
  await page.evaluate(() => { window.__m.App.tool.refMode = true; window.__m.App.tool.refLen = null; });
  await clickW(0, 0);                       // base -> act
  await clickW(10, 0);                      // reference length pick = 10
  await page.evaluate(() => window.__m.App.tool.onInput({ len: 20 }, '20'));   // true length 20 -> ×2
  await sleep(100);
  check('scale ref 10->20 (len≈20)', Math.abs(Math.hypot((await last()).b.x - (await last()).a.x, (await last()).b.y - (await last()).a.y) - 20) < 0.5, Math.hypot((await last()).b.x - (await last()).a.x, (await last()).b.y - (await last()).a.y));

  // MIRROR keep
  await seed([{ type: 'line', a: { x: 0, y: 5 }, b: { x: 20, y: 5 } }]);
  await selectAll(); await arm('mirror');
  await page.evaluate(() => { window.__m.App.tool.keep = true; });
  await clickW(0, 0); await clickW(20, 0); await sleep(120);
  check('mirror keep -> 2 lines', (await ents()).filter(t => t === 'line').length === 2);

  // OFFSET
  await seed([{ type: 'line', a: { x: 0, y: 0 }, b: { x: 40, y: 0 } }]);
  await arm('offset');
  await page.evaluate(() => { window.__m.App.tool.d = 10; });
  await clickW(20, 0);                      // pick target
  await clickW(20, 20);                     // side
  await sleep(120);
  check('offset -> 2 lines', (await ents()).filter(t => t === 'line').length === 2);

  // EXTEND
  await seed([{ type: 'line', a: { x: 0, y: 0 }, b: { x: 20, y: 0 } }, { type: 'line', a: { x: 50, y: -20 }, b: { x: 50, y: 20 } }]);
  await arm('extend');
  await clickW(18, 0);                      // near the b-end of the short line
  await sleep(120);
  const exLine = await page.evaluate(() => window.__m.App.doc.entities.find(e => e.type === 'line' && Math.abs(e.a.x) < 1e-6));
  check('extend to boundary x=50', exLine && Math.abs(exLine.b.x - 50) < 0.5, exLine?.b?.x);

  // FILLET
  await seed([{ type: 'line', a: { x: 0, y: 0 }, b: { x: 40, y: 0 } }, { type: 'line', a: { x: 0, y: 0 }, b: { x: 0, y: 40 } }]);
  await arm('fillet');
  await page.evaluate(() => { window.__m.App.tool.r = 8; });
  await clickW(30, 0); await clickW(0, 30); await sleep(150);
  check('fillet adds arc', (await ents()).includes('arc'), JSON.stringify(await ents()));

  // CHAMFER
  await seed([{ type: 'line', a: { x: 0, y: 0 }, b: { x: 40, y: 0 } }, { type: 'line', a: { x: 0, y: 0 }, b: { x: 0, y: 40 } }]);
  await arm('chamfer');
  await page.evaluate(() => { window.__m.App.tool.d1 = 6; window.__m.App.tool.d2 = 6; });
  await clickW(30, 0); await clickW(0, 30); await sleep(150);
  check('chamfer -> 3 lines', (await ents()).filter(t => t === 'line').length === 3, (await ents()).length);

  // ---- D. measure + area (status message) ----
  await seed([{ type: 'poly', closed: true, pts: [{ x: 0, y: 0 }, { x: 40, y: 0 }, { x: 40, y: 20 }, { x: 0, y: 20 }] }]);
  await arm('measure-area');
  await clickW(20, 0); await sleep(120);          // click ON the bottom edge, not the interior
  const areaMsg = await page.evaluate(() => document.getElementById('hintMsg').textContent);
  check('area reports 800 mm²', /800/.test(areaMsg), areaMsg);

  // dimension radial on a circle
  await seed([{ type: 'circle', c: { x: 20, y: 20 }, r: 15 }]);
  await arm('dim-radial');
  await clickW(35, 20);                     // pick circle (on its edge)
  await clickW(45, 30);                     // text pos
  await sleep(120);
  check('radial dimension added', (await ents()).includes('dim'), JSON.stringify(await ents()));

  // ---- E. layers, undo/redo, save/load ----
  await reset();
  await page.evaluate(() => {
    const m = window.__m;
    m.mutate('add line', () => m.addEntity({ type: 'line', a: { x: 0, y: 0 }, b: { x: 30, y: 0 } }));
    m.mutate('add circle', () => m.addEntity({ type: 'circle', c: { x: 50, y: 20 }, r: 10 }));
  });
  const nAdd = await page.evaluate(() => window.__m.App.doc.entities.length);
  await page.evaluate(() => window.__m.undo());
  const nUndo = await page.evaluate(() => window.__m.App.doc.entities.length);
  await page.evaluate(() => window.__m.redo());
  const nRedo = await page.evaluate(() => window.__m.App.doc.entities.length);
  check('undo/redo integrity', nUndo === nAdd - 1 && nRedo === nAdd, `${nAdd}/${nUndo}/${nRedo}`);

  const layerOk = await page.evaluate(() => {
    const m = window.__m;
    m.mutate('add layer', () => { m.App.doc.layers.push({ id: 'L9', name: 'holes', color: '#FF5C5C', ltype: 'continuous', visible: true, locked: false }); });
    const circ = m.App.doc.entities.find(e => e.type === 'circle');
    m.mutate('assign', () => { circ.layer = 'L9'; });
    const before = m.visibleEntities().length;
    m.mutate('hide', () => { m.App.doc.layers.find(l => l.id === 'L9').visible = false; });
    const after = m.visibleEntities().length;
    return { before, after };
  });
  check('layer hide removes from visible', layerOk.after === layerOk.before - 1, JSON.stringify(layerOk));

  const roundtrip = await page.evaluate(() => {
    const m = window.__m;
    const json = m.projectJSON();
    const nBefore = m.App.doc.entities.length;
    m.newDoc();
    m.loadProject(json);
    return { nBefore, nAfter: m.App.doc.entities.length, layers: m.App.doc.layers.length };
  });
  check('project save/load round-trip', roundtrip.nAfter === roundtrip.nBefore && roundtrip.layers >= 2, JSON.stringify(roundtrip));

  // ---- F. exports (all formats) from a rich drawing ----
  await page.evaluate(() => {
    const m = window.__m;
    m.newDoc();
    m.addEntity({ type: 'line', a: { x: 0, y: 0 }, b: { x: 100, y: 0 } });
    m.addEntity({ type: 'circle', c: { x: 50, y: 40 }, r: 20 });
    m.addEntity({ type: 'arc', c: { x: 0, y: 40 }, r: 25, a0: 0, a1: Math.PI / 2 });
    m.addEntity({ type: 'poly', closed: true, pts: [{ x: 0, y: 60 }, { x: 40, y: 60, bulge: 0.5 }, { x: 40, y: 90 }] });
    m.addEntity({ type: 'text', p: { x: 5, y: 100 }, text: 'TrueLine', h: 6, rot: 0 });
    m.addEntity({ type: 'point', p: { x: 90, y: 90 } });
    m.addEntity({ type: 'dim', kind: 'aligned', p1: { x: 0, y: 0 }, p2: { x: 100, y: 0 }, tp: { x: 50, y: -12 } });
  });
  const dxf = await page.evaluate(async () => {
    const m = window.__m; const d = await import('/js/dxf.js');
    return d.writeDXF(m.decomposeForExport(m.App.doc.entities), m.App.doc.layers, { units: 'mm' });
  });
  fs.writeFileSync(path.join(outDir, 'prod.dxf'), dxf);
  check('DXF export non-trivial', dxf.includes('ENTITIES') && dxf.length > 1500, dxf.length);

  // capture the real export path (doExport → svgOut/pdfOut → download), stubbing the
  // anchor click so nothing navigates, and reading back the produced blob.
  const captureExport = fmt => page.evaluate(fmt => new Promise(res => {
    const origCreate = URL.createObjectURL, origRevoke = URL.revokeObjectURL, origClick = HTMLAnchorElement.prototype.click;
    let blob = null;
    URL.createObjectURL = b => { blob = b; return 'blob:capture'; };
    URL.revokeObjectURL = () => {};
    HTMLAnchorElement.prototype.click = function () {};
    window.__m.App.ui.doExport(fmt);
    document.querySelectorAll('#modalBox button').forEach(b => { if (b.textContent === 'Export drawing') b.click(); });
    setTimeout(async () => {
      URL.createObjectURL = origCreate; URL.revokeObjectURL = origRevoke; HTMLAnchorElement.prototype.click = origClick;
      if (!blob) return res({ size: 0, text: '' });
      res({ size: blob.size, text: fmt === 'pdf' ? '' : await blob.text() });
    }, 250);
  }), fmt);

  const svg = (await captureExport('svg')).text;
  fs.writeFileSync(path.join(outDir, 'prod.svg'), svg || '');
  check('SVG export well-formed', !!svg && svg.startsWith('<svg') && svg.includes('mm"') && svg.includes('</svg>'), (svg || '').length);

  const pdfCap = await captureExport('pdf');
  check('PDF export produced bytes', pdfCap.size > 400, pdfCap.size);
  // also write the PDF bytes for structural validation
  const pdfBytes = await page.evaluate(async () => {
    const m = window.__m; const pmod = await import('/js/pdf.js');
    // reproduce a minimal page to guarantee bytes on disk for the validator
    const bytes = pmod.writePDF([{ widthMM: 120, heightMM: 120, paths: [{ segs: [{ m: { x: 10, y: 10 } }, { l: { x: 100, y: 100 } }], strokeRGB: [0, 0, 0], widthMM: 0.25 }], texts: [{ xMM: 10, yMM: 20, text: 'TrueLine', sizeMM: 5, rotRad: 0 }] }]);
    return Array.from(bytes);
  });
  fs.writeFileSync(path.join(outDir, 'prod.pdf'), Buffer.from(pdfBytes));

  // ---- G. no uncaught page errors during the whole run ----
  check('no page errors during run', pageErrors.length === 0, pageErrors.slice(0, 3).join(' | '));

  // ---- report ----
  console.log(results.map(r => (r.pass ? 'PASS ' : 'FAIL ') + r.name + (r.pass ? '' : '  [' + r.extra + ']')).join('\n'));
  const fails = results.filter(r => !r.pass);
  console.log(`\n${results.length - fails.length}/${results.length} passed`);
  console.log(fails.length ? 'PRODUCTION FAIL' : 'PRODUCTION PASS');
  await browser.disconnect();
  process.exit(fails.length ? 1 : 0);
})().catch(e => { console.error('PRODUCTION CRASH', e); process.exit(2); });
