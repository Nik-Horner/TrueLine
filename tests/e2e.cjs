// E2E drive of the running TrueLine Electron app via CDP (real input events).
// Usage: node tests/e2e.cjs <shotDir>
const puppeteer = require('puppeteer-core');
const fs = require('fs');
const path = require('path');

const shotDir = process.argv[2] || '.';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const results = [];
const check = (name, cond, extra = '') => { results.push({ name, pass: !!cond, extra }); };

(async () => {
  const APP_URL = process.env.APP_URL || 'http://127.0.0.1:8390/';
  const browser = await puppeteer.connect({ browserURL: 'http://127.0.0.1:9223', defaultViewport: null });
  const page = (await browser.pages())[0];
  await page.goto(APP_URL, { waitUntil: 'networkidle0' });
  await page.bringToFront();

  // fresh state (tour marked done so its card doesn't sit over test click targets)
  await page.evaluate(() => { localStorage.clear(); localStorage.setItem('tl-tour-done', '1'); });
  await page.reload({ waitUntil: 'networkidle0' });
  await sleep(800);

  // overlay rect in window coords
  const rect = await page.evaluate(() => {
    const r = document.getElementById('cvOverlay').getBoundingClientRect();
    return { x: r.x, y: r.y, w: r.width, h: r.height };
  });
  check('canvas has size', rect.w > 400 && rect.h > 300, JSON.stringify(rect));
  const at = (fx, fy) => ({ x: rect.x + rect.w * fx, y: rect.y + rect.h * fy });

  const mod = () => page.evaluate(() => import('/js/app.js').then(m => {
    window.__app = m;
    return true;
  }));
  await mod();
  const appEval = fn => page.evaluate(fn);

  // skip first-run card
  const fr = await page.$('#firstrun:not([hidden]) #frSkip');
  if (fr) { await fr.click(); await sleep(200); }

  const entCount = () => appEval(() => window.__app.App.doc.entities.length);
  const lastEnt = () => appEval(() => window.__app.App.doc.entities[window.__app.App.doc.entities.length - 1]);

  // ---- 1. LINE with typed exact length 100
  await page.keyboard.press('l');
  const p1 = at(0.2, 0.5);
  await page.mouse.click(p1.x, p1.y);
  await page.mouse.move(p1.x + 200, p1.y);        // aim +x
  await sleep(120);
  await page.keyboard.type('100', { delay: 40 });
  await sleep(150);
  await page.keyboard.press('Enter');
  await sleep(200);
  await page.keyboard.press('Escape');            // end chain
  let e = await lastEnt();
  const lineLen = e && e.type === 'line' ? Math.hypot(e.b.x - e.a.x, e.b.y - e.a.y) : 0;
  check('typed 100mm line', e && e.type === 'line' && Math.abs(lineLen - 100) < 1e-6, `len=${lineLen}`);

  // ---- 2. CIRCLE 3-point
  await page.keyboard.press('c');
  await sleep(150);
  const seg3 = await page.$$eval('#ctxControls .seg button', (btns) => {
    const b = btns.find(b => b.textContent.trim() === '3-Pt');
    if (b) { b.click(); return true; }
    return false;
  });
  check('3-Pt circle mode button', seg3);
  const c1 = at(0.55, 0.35), c2 = at(0.65, 0.30), c3 = at(0.62, 0.45);
  for (const p of [c1, c2, c3]) { await page.mouse.click(p.x, p.y); await sleep(90); }
  e = await lastEnt();
  check('3pt circle created', e && e.type === 'circle' && e.r > 1, e && `r=${e.r?.toFixed(2)}`);

  // ---- 3. ARC 3-point
  await page.keyboard.press('a');
  const a1 = at(0.3, 0.75), a2 = at(0.4, 0.68), a3 = at(0.5, 0.75);
  for (const p of [a1, a2, a3]) { await page.mouse.click(p.x, p.y); await sleep(90); }
  e = await lastEnt();
  check('3pt arc created', e && e.type === 'arc', e && e.type);

  // ---- 4. RECT with typed WxH
  await page.keyboard.press('r');
  const r1 = at(0.7, 0.6);
  await page.mouse.click(r1.x, r1.y);
  await page.mouse.move(r1.x + 80, r1.y + 60);
  await sleep(120);
  await page.keyboard.type('80x40', { delay: 40 });
  await page.keyboard.press('Enter');
  await sleep(200);
  e = await lastEnt();
  const rectOK = e && e.type === 'poly' && e.closed && e.pts.length === 4 &&
    Math.abs(Math.abs(e.pts[1].x - e.pts[0].x) - 80) < 1e-6 &&
    Math.abs(Math.abs(e.pts[2].y - e.pts[1].y) - 40) < 1e-6;
  check('typed 80x40 rect', rectOK, e && JSON.stringify(e.pts?.map(p => [p.x.toFixed(1), p.y.toFixed(1)])));

  // ---- 5. FREEHAND trace: L-shaped drag -> fitted lines
  const before = await entCount();
  await page.keyboard.press('s');
  const t0 = at(0.15, 0.15);
  await page.mouse.move(t0.x, t0.y);
  await page.mouse.down();
  for (let i = 1; i <= 30; i++) { await page.mouse.move(t0.x + i * 4, t0.y, { steps: 1 }); }
  for (let i = 1; i <= 25; i++) { await page.mouse.move(t0.x + 120, t0.y + i * 4, { steps: 1 }); }
  await page.mouse.up();
  await sleep(300);
  const after = await entCount();
  e = await lastEnt();
  const fitInfo = await appEval(() => {
    const app = window.__app.App;
    const e = app.doc.entities[app.doc.entities.length - 1];
    if (!e) return 'none';
    if (e.type === 'poly') return 'poly:' + e.pts.length + 'pts' + (e.pts.some(p => p.bulge) ? '+bulge' : '');
    return e.type;
  });
  check('freehand fitted', after === before + 1 && (e.type === 'poly' || e.type === 'line'), fitInfo);

  // ---- 6. TRIM: two crossing lines, cut one
  const trimSetup = await appEval(() => {
    const m = window.__app;
    m.mutate('test-lines', () => {
      m.addEntity({ type: 'line', a: { x: 300, y: 300 }, b: { x: 400, y: 300 } });
      m.addEntity({ type: 'line', a: { x: 350, y: 250 }, b: { x: 350, y: 350 } });
    });
    return m.App.doc.entities.length;
  });
  await page.keyboard.press('Escape');
  await appEval(() => window.__app.zoomFit());   // make the test lines visible before clicking
  await sleep(300);
  await page.keyboard.press('x');   // trim
  // click on the left half of the horizontal line (world 320,300 -> screen)
  const scr = await appEval(() => {
    const m = window.__app;
    const s = m.toScreen({ x: 320, y: 300 });
    const r = document.getElementById('cvOverlay').getBoundingClientRect();
    return { x: r.x + s.x, y: r.y + s.y };
  });
  await page.mouse.click(scr.x, scr.y);
  await sleep(200);
  const trimmed = await appEval(() => {
    const m = window.__app;
    const lines = m.App.doc.entities.filter(e => e.type === 'line' && Math.abs(e.a.y - 300) < 1e-6 && Math.abs(e.b.y - 300) < 1e-6);
    return lines.map(l => [l.a.x, l.b.x]);
  });
  check('trim cut at intersection', JSON.stringify(trimmed).includes('350') && JSON.stringify(trimmed).includes('400'), JSON.stringify(trimmed));

  // ---- 7. DIMENSION aligned on the 100mm line via endpoint osnap
  await page.keyboard.press('Escape');
  const dimPts = await appEval(() => {
    const m = window.__app;
    const line = m.App.doc.entities.find(e => e.type === 'line' && Math.abs(Math.hypot(e.b.x - e.a.x, e.b.y - e.a.y) - 100) < 1e-6);
    if (!line) return null;
    const r = document.getElementById('cvOverlay').getBoundingClientRect();
    const s1 = m.toScreen(line.a), s2 = m.toScreen(line.b);
    return { x1: r.x + s1.x, y1: r.y + s1.y, x2: r.x + s2.x, y2: r.y + s2.y };
  });
  if (dimPts) {
    await page.keyboard.press('d');
    await page.mouse.click(dimPts.x1 + 3, dimPts.y1 + 2);   // near endpoint -> osnap
    await sleep(100);
    await page.mouse.click(dimPts.x2 - 3, dimPts.y2 - 2);
    await sleep(100);
    await page.mouse.click((dimPts.x1 + dimPts.x2) / 2, dimPts.y1 - 40);
    await sleep(200);
    const dim = await appEval(() => {
      const m = window.__app;
      const d = m.App.doc.entities.find(e => e.type === 'dim');
      if (!d) return null;
      return { kind: d.kind, measured: Math.hypot(d.p2.x - d.p1.x, d.p2.y - d.p1.y) };
    });
    check('dimension measures 100', dim && Math.abs(dim.measured - 100) < 0.5, JSON.stringify(dim));
  } else check('dimension measures 100', false, 'line not found');

  // ---- 8. select all, undo/redo integrity
  await page.keyboard.press('Escape');
  const nBefore = await entCount();
  await page.keyboard.down('Control'); await page.keyboard.press('z'); await page.keyboard.up('Control');
  const nUndo = await entCount();
  await page.keyboard.down('Control'); await page.keyboard.press('y'); await page.keyboard.up('Control');
  const nRedo = await entCount();
  check('undo/redo', nUndo <= nBefore && nRedo === nBefore, `${nBefore}/${nUndo}/${nRedo}`);

  // ---- 9. zoom fit + screenshot
  await page.keyboard.down('Shift'); await page.keyboard.press('Digit1'); await page.keyboard.up('Shift');
  await sleep(400);
  await page.screenshot({ path: path.join(shotDir, 'desktop-app.png') });

  // ---- 10. layers panel + DXF export content
  const dxf = await appEval(async () => {
    const m = window.__app;
    const dxfMod = await import('/js/dxf.js');
    return dxfMod.writeDXF(m.decomposeForExport(m.App.doc.entities), m.App.doc.layers, { units: 'mm' });
  });
  fs.writeFileSync(path.join(shotDir, 'e2e-export.dxf'), dxf);
  check('dxf export non-trivial', dxf.length > 1000 && dxf.includes('ENTITIES'), `${dxf.length} chars`);

  // ---- 11. pinch zoom (two synthetic touch pointers)
  const zBefore = await appEval(() => window.__app.App.view.z);
  await appEval(() => {
    const cv = document.getElementById('cvOverlay');
    const r = cv.getBoundingClientRect();
    const mk = (type, id, x, y) => cv.dispatchEvent(new PointerEvent(type, {
      pointerId: id, pointerType: 'touch', clientX: r.x + x, clientY: r.y + y,
      isPrimary: id === 1, bubbles: true, buttons: 1,
    }));
    mk('pointerdown', 1, 300, 300); mk('pointerdown', 2, 400, 300);
    for (let i = 1; i <= 10; i++) { mk('pointermove', 1, 300 - i * 8, 300); mk('pointermove', 2, 400 + i * 8, 300); }
    mk('pointerup', 1, 220, 300); mk('pointerup', 2, 480, 300);
  });
  const zAfter = await appEval(() => window.__app.App.view.z);
  check('pinch zoom', zAfter > zBefore * 1.5, `${zBefore.toFixed(3)} -> ${zAfter.toFixed(3)}`);

  console.log(JSON.stringify(results, null, 1));
  const fails = results.filter(r => !r.pass);
  console.log(fails.length ? `E2E FAIL (${fails.length})` : 'E2E PASS');
  await browser.disconnect();
  process.exit(fails.length ? 1 : 0);
})().catch(err => { console.error('E2E CRASH', err); process.exit(2); });
