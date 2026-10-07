// End-to-end upgrade workflows in a real Chromium renderer, without an Electron display.
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const puppeteer = require('puppeteer-core');
const root = path.resolve(__dirname, '..');
const server = http.createServer((req, res) => {
  const name = new URL(req.url, 'http://localhost').pathname;
  const file = path.resolve(root, '.' + (name === '/' ? '/index.html' : name));
  if (!file.startsWith(root + path.sep)) { res.writeHead(403); res.end(); return; }
  fs.readFile(file, (err, data) => { if (err) { res.writeHead(404); res.end(); return; }
    res.setHeader('Content-Type', ({ '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' })[path.extname(file)] || 'application/octet-stream'); res.end(data); });
});
(async () => {
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const browser = await puppeteer.launch({ executablePath: process.env.CHROME_BIN || '/usr/bin/chromium', headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage', '--remote-debugging-port=9223'] });
  try {
    const page = await browser.newPage(); await page.setViewport({ width: 1500, height: 950 });
    const errors = []; page.on('pageerror', e => errors.push(e.message)); page.on('dialog', d => d.accept());
    await page.evaluateOnNewDocument(() => { localStorage.setItem('tl-tour-done', '1'); localStorage.setItem('tl-frdone', '1'); });
    const url = `http://127.0.0.1:${server.address().port}/`;
    await page.goto(url, { waitUntil: 'networkidle0' });
    await page.evaluate(async () => { window.m = await import('/js/app.js'); });
    const run = fn => page.evaluate(fn);
    const clickText = text => page.evaluate(text => {
      const button = [...document.querySelectorAll('button')].find(b => b.textContent.trim() === text && b.getClientRects().length);
      if (!button) throw new Error('Missing button: ' + text); button.click();
    }, text);
    const menu = async text => { await page.click('.workflow-menu summary'); await clickText(text); };
    const pick = (x, y) => page.evaluate((x, y) => {
      const cv = document.getElementById('cvOverlay'), r = cv.getBoundingClientRect(), s = m.toScreen({ x, y });
      for (const type of ['pointerdown', 'pointerup']) cv.dispatchEvent(new PointerEvent(type, { pointerType: 'pen', pointerId: 1, isPrimary: true, button: 0, buttons: type === 'pointerdown' ? 1 : 0, clientX: r.left + s.x, clientY: r.top + s.y, bubbles: true }));
    }, x, y);
    const seed = () => run(() => { m.newDoc(); m.App.view = { x: -20, y: -20, z: 1 }; m.App.toggles.osnap = false; m.invalidate('all'); });
    const hiddenModal = () => page.waitForFunction(() => document.getElementById('modalRoot').hidden);

    // Trace is reversible until accepted; tolerance edits refit original points.
    await seed();
    await run(() => { m.setTool('freehand'); const t = m.App.tool; t.onDown(null, {}, { x: 0, y: 0 }); for (let i = 1; i <= 40; i++) t.onMove(null, {}, { x: i, y: Math.sin(i)*0.2 }); t.onUp(); });
    assert.equal(await run(() => m.App.doc.entities.length), 0);
    assert.ok(await run(() => Number.isFinite(m.App.tool.pending.deviation.max)));
    await clickText('Accept'); assert.equal(await run(() => m.App.doc.entities.length), 1);
    await run(() => m.undo()); assert.equal(await run(() => m.App.doc.entities.length), 0);
    console.log('PASS: trace preview, fidelity readout, accept and undo');

    // Full tracing mode actually increases the canvas area.
    const original = await run(() => m.viewSize().w);
    await clickText('Tracing mode · Tab');
    await page.waitForFunction(w => document.getElementById('stack').clientWidth > w, {}, original);
    await clickText('Exit · Tab');
    console.log('PASS: tracing mode expands canvas and exits');

    // Create and place an independent piece using three shared marks.
    await seed();
    await run(() => m.mutate('Base', () => m.addEntity({ type: 'line', a: { x: 0, y: 0 }, b: { x: 30, y: 0 } })));
    await menu('Trace assembly piece…'); await clickText('Pick shared reference marks');
    await pick(0, 0); await pick(30, 0); await pick(0, 20);
    assert.ok(await run(() => m.App.doc.section && m.App.doc.currentLayer !== 'L0'));
    await run(() => m.mutate('Piece', () => m.addEntity({ type: 'line', a: { x: 100, y: 100 }, b: { x: 130, y: 100 } })));
    await menu('Assemble active piece…'); await pick(100, 100); await pick(130, 100); await pick(100, 120);
    await page.screenshot({ path: path.join(root, 'dist-test/assembly-review.png') });
    await clickText('Place separate piece');
    assert.equal(await run(() => m.App.doc.assemblies.length), 1);
    assert.equal(await run(() => m.App.doc.section), null);
    assert.ok(await run(() => Math.abs(m.App.doc.entities[1].a.x) < 1e-8 && m.App.doc.entities[1].layer !== m.App.doc.entities[0].layer));
    await run(() => m.undo()); assert.ok(await run(() => m.App.doc.section && m.App.doc.entities[1].a.x === 100));
    await run(() => m.redo());
    await menu('Assembly pieces…'); await clickText('Select piece'); assert.equal(await run(() => m.App.selection.size), 1);
    console.log('PASS: assembly placement preserves independent pieces, dimensions and undo');

    // Large reference mismatch cannot be applied.
    await menu('Trace assembly piece…'); await clickText('Pick shared reference marks');
    await pick(0, 0); await pick(30, 0); await pick(0, 20);
    await run(() => m.mutate('Bad piece', () => m.addEntity({ type: 'line', a: { x: 100, y: 100 }, b: { x: 140, y: 100 } })));
    await menu('Assemble active piece…'); await pick(100, 100); await pick(140, 100); await pick(100, 150);
    assert.equal(await run(() => [...document.querySelectorAll('#modalBox button')].find(b => b.textContent === 'Place separate piece').disabled), true);
    await clickText('Cancel'); await menu('Discard active piece…'); await clickText('Discard section');
    console.log('PASS: inaccurate assembly placement is blocked');

    // Seed an image, rotate it, undo, calibrate from two actual measurements.
    await seed();
    await run(async () => {
      const cv = document.createElement('canvas'); cv.width = 200; cv.height = 120;
      const cx = cv.getContext('2d'); cx.fillStyle = '#f00'; cx.fillRect(0, 0, 100, 120); cx.fillStyle = '#00f'; cx.fillRect(100, 0, 100, 120);
      const img = new Image(); img.src = cv.toDataURL(); await img.decode();
      m.setUnderlay({ dataURL: img.src, x: 0, y: 0, wMM: 100, hMM: 60, opacity: 0.5, visible: true }, img);
    });
    await menu('Rotate image…'); await run(() => document.querySelector('#modalBox input').value = '15'); await clickText('Apply');
    assert.ok(await run(() => Math.abs(m.App.doc.underlay.rotation - Math.PI / 12) < 1e-8));
    await run(async () => { m.undo(); await m.reloadUnderlayImg(); });
    assert.equal(await run(() => m.App.doc.underlay.rotation || 0), 0);
    await menu('Calibrate photo measurements…'); await pick(0, 0); await pick(100, 0);
    await run(() => document.querySelector('#modalBox input').value = '200'); await clickText('Add measurement'); await clickText('Add another measurement');
    await pick(0, 0); await pick(0, 60); await run(() => document.querySelector('#modalBox input').value = '120'); await clickText('Add measurement'); await clickText('Apply photo scale');
    assert.ok(await run(() => Math.abs(m.App.doc.underlay.wMM - 200) < 1e-8)); assert.ok(await run(() => Math.abs(m.App.doc.underlay.hMM - 120) < 1e-8));
    console.log('PASS: photo rotation, undo and multiple measurement calibration');

    // Rectify an image from four corners and known physical dimensions.
    await menu('Correct photo perspective…'); await clickText('Pick four corners');
    await pick(0, 0); await pick(200, 0); await pick(200, 120); await pick(0, 120);
    await run(() => { const inputs = document.querySelectorAll('#modalBox input'); inputs[0].value = '100'; inputs[1].value = '60'; });
    await clickText('Correct image'); await hiddenModal();
    assert.equal(await run(() => m.App.doc.underlay.wMM), 100); assert.equal(await run(() => m.App.doc.underlay.rotation), 0);
    assert.ok(await run(() => m.getUnderlayImg().naturalWidth === 200));
    await run(async () => { m.undo(); await m.reloadUnderlayImg(); }); assert.ok(await run(() => Math.abs(m.App.doc.underlay.wMM - 200) < 1e-8));
    // Cancellation during raster work does not commit an image edit.
    await menu('Correct photo perspective…'); await clickText('Pick four corners');
    await pick(0, 0); await pick(200, 0); await pick(200, 120); await pick(0, 120);
    await run(() => { const inputs = document.querySelectorAll('#modalBox input'); inputs[0].value = '90'; inputs[1].value = '50'; });
    await clickText('Correct image'); await clickText('Cancel');
    await run(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
    assert.ok(await run(() => Math.abs(m.App.doc.underlay.wMM - 200) < 1e-8));
    await run(() => {
      const slider = document.querySelector('#propsBody input[type=range]');
      slider.value = '0.7'; slider.dispatchEvent(new Event('input', { bubbles: true }));
      if (!slider.isConnected) throw new Error('Opacity slider was replaced during dragging');
      slider.dispatchEvent(new Event('change', { bubbles: true }));
    });
    assert.equal(await run(() => m.App.doc.underlay.opacity), 0.7);
    await run(() => m.undo()); assert.equal(await run(() => m.App.doc.underlay.opacity), 0.5);
    console.log('PASS: photo perspective correction, cancellation and image-edit undo');

    // Inspect gaps, join explicitly, and exercise the actual export review.
    await seed();
    await run(() => m.mutate('Gap', () => { m.addEntity({ type: 'line', a: { x: 0, y: 0 }, b: { x: 10, y: 0 } }); m.addEntity({ type: 'line', a: { x: 10.2, y: 0 }, b: { x: 20, y: 0 } }); }));
    await menu('Check contours…'); assert.ok(await run(() => document.getElementById('modalBox').textContent.includes('gap'))); await clickText('Close');
    await menu('Join contours…'); await clickText('Apply joins'); await clickText('Close');
    assert.equal(await run(() => m.App.doc.entities.length), 1);
    assert.equal(await run(() => m.App.doc.entities[0].pts.length), 4);
    await page.evaluate(() => { window.captured = false; const old = HTMLAnchorElement.prototype.click; window.restoreClick = () => HTMLAnchorElement.prototype.click = old; HTMLAnchorElement.prototype.click = function () { if (this.download) window.captured = true; else old.call(this); }; m.App.ui.doExport('dxf'); });
    assert.equal(await run(() => window.captured), false); await clickText('Export drawing'); assert.equal(await run(() => window.captured), true); await run(() => window.restoreClick());
    console.log('PASS: contour gap review, explicit joins and pre-export checks');

    // Desktop save cancellation/error/confirmed success and edits during saving.
    await run(() => { window.trueLineFiles = { saveProject: async () => ({ canceled: true }) }; });
    await run(() => m.App.ui.saveProject()); assert.equal(await run(() => m.App.fileDirty), true);
    await run(() => { window.trueLineFiles.saveProject = async () => ({ saved: false, error: 'Disk full' }); }); await run(() => m.App.ui.saveProject()); assert.equal(await run(() => m.App.fileDirty), true);
    await run(() => { window.trueLineFiles.saveProject = async () => ({ saved: true }); }); await run(() => m.App.ui.saveProject()); assert.equal(await run(() => m.App.fileDirty), false);
    await run(() => { m.mutate('Edit', () => m.addEntity({ type: 'point', p: { x: 30, y: 30 } })); window.trueLineFiles.saveProject = async () => { m.mutate('Edit during save', () => m.addEntity({ type: 'point', p: { x: 35, y: 35 } })); return { saved: true }; }; });
    await run(() => m.App.ui.saveProject()); assert.equal(await run(() => m.App.fileDirty), true);
    console.log('PASS: save status follows actual success and remains dirty for later edits');

    // Recover a document larger than localStorage's quota; older revisions remain usable.
    await run(async () => { m.App.doc.largeNote = 'x'.repeat(6*1024*1024); m.App.ui.setDirty(true); await m.flushAutosave(); });
    assert.equal(await run(() => m.App.fileDirty), true);
    await page.reload({ waitUntil: 'networkidle0' }); await page.evaluate(async () => { window.m = await import('/js/app.js'); });
    assert.equal(await run(() => m.App.doc.largeNote.length), 6 * 1024 * 1024);
    assert.equal(await run(() => m.App.fileDirty), true);
    await menu('Recovery history…');
    await page.waitForSelector('.recovery-list button');
    const revisions = await run(() => document.querySelectorAll('.recovery-list button').length); assert.ok(revisions > 1 && revisions <= 12);
    await run(() => document.querySelectorAll('.recovery-list button')[1].click()); await hiddenModal();
    assert.equal(await run(() => m.App.fileDirty), true);
    await run(() => { delete m.App.doc.largeNote; m.App.ui.setDirty(false); });
    console.log('PASS: oversized-document recovery, restart, history and restore');
    await page.screenshot({ path: path.join(root, 'dist-test/upgrades.png') });
    assert.deepEqual(errors, []);
    console.log('All upgrade browser checks passed.');
  } finally { await browser.close(); server.close(); }
})().catch(e => { console.error(e); server.close(); process.exitCode = 1; });
