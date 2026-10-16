// Verify calibration input and downloaded SVGs through the production UI.
const assert = require('node:assert/strict');
const path = require('node:path');
const puppeteer = require('puppeteer-core');
const { createStaticServer } = require('../electron/static-server.cjs');

(async () => {
  const server = createStaticServer(path.resolve(__dirname, '..'));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  let browser;
  try {
    browser = await puppeteer.launch({
      executablePath: process.env.CHROME_BIN || '/usr/bin/chromium',
      headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'],
    });
    const page = await browser.newPage();
    await page.setViewport({ width: 1500, height: 950 });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.evaluateOnNewDocument(() => {
      localStorage.setItem('tl-tour-done', '1');
      localStorage.setItem('tl-frdone', '1');
    });
    await page.goto(`http://127.0.0.1:${server.address().port}/`);
    await page.waitForFunction(async () => (await import('/js/app.js')).App.ready);
    await page.evaluate(async () => { window.m = await import('/js/app.js'); });

    const pick = (x, y) => page.evaluate((x, y) => {
      const canvas = document.getElementById('cvOverlay');
      const rect = canvas.getBoundingClientRect(), screen = m.toScreen({ x, y });
      for (const type of ['pointerdown', 'pointerup']) canvas.dispatchEvent(new PointerEvent(type, {
        pointerId: 1, pointerType: 'mouse', isPrimary: true, button: 0,
        buttons: type === 'pointerdown' ? 1 : 0, bubbles: true,
        clientX: rect.left + screen.x, clientY: rect.top + screen.y,
      }));
    }, x, y);
    const seedScale = async () => {
      await page.evaluate(() => {
        m.newDoc(); m.App.view = { x: -20, y: -20, z: 1 };
        m.App.toggles.osnap = false;
        m.mutate('Calibration fixture', () => m.addEntity({ type: 'circle', c: { x: 5, y: 0 }, r: 5 }));
        m.setTool('calibrate');
      });
      await pick(0, 0); await pick(10, 0);
    };
    await seedScale();
    const before = await page.evaluate(() => ({ json: m.projectJSON(), cal: m.App.CAL, undo: m.App.undoStack.length }));
    for (const value of ['-20', '0', '9'.repeat(310)]) {
      await page.evaluate(value => { document.getElementById('dyninput').hidden = false; document.getElementById('dynMain').value = value; }, value);
      await page.focus('#dynMain');
      await page.keyboard.press('Enter');
      const after = await page.evaluate(() => ({ json: m.projectJSON(), cal: m.App.CAL, undo: m.App.undoStack.length }));
      assert.deepEqual(after, before, `Invalid length ${value.slice(0, 20)} must leave geometry, calibration and undo intact`);
      assert.match(await page.$eval('#toast', element => element.textContent), /positive.*length/i);
    }
    await page.evaluate(() => { document.getElementById('dyninput').hidden = false; document.getElementById('dynMain').value = '20'; });
    await page.focus('#dynMain'); await page.keyboard.press('Enter');
    const scaled = await page.evaluate(() => ({ radius: m.App.doc.entities[0].r, cal: m.App.CAL }));
    assert.ok(Math.abs(scaled.radius - 10) < 1e-10);
    assert.ok(Math.abs(scaled.cal - before.cal / 2) < 1e-10);
    await page.evaluate(() => m.undo());
    assert.deepEqual(await page.evaluate(() => ({ radius: m.App.doc.entities[0].r, cal: m.App.CAL })), { radius: 5, cal: before.cal });
    await page.evaluate(() => m.redo());
    assert.deepEqual(await page.evaluate(() => ({ radius: m.App.doc.entities[0].r, cal: m.App.CAL })), scaled);
    console.log('PASS: scale rejects invalid input; valid calibration, undo and redo preserve physical dimensions');

    const svgCheck = await page.evaluate(async () => {
      const layerName = 'Outline & holes <reviewed> "final"';
      const label = 'TrueLine & CAD <1:1>';
      m.App.doc.layers[0].name = layerName;
      m.mutate('Label', () => m.addEntity({ type: 'text', p: { x: -100, y: -100 }, h: 3, rot: Math.PI, text: label }));
      const createURL = URL.createObjectURL, click = HTMLAnchorElement.prototype.click;
      let blob;
      try {
        URL.createObjectURL = value => { blob = value; return 'blob:capture'; };
        HTMLAnchorElement.prototype.click = function () {};
        m.App.ui.doExport('svg', true);
      } finally {
        URL.createObjectURL = createURL; HTMLAnchorElement.prototype.click = click;
      }
      const xml = new DOMParser().parseFromString(await blob.text(), 'image/svg+xml');
      let pdf;
      try {
        URL.createObjectURL = value => { pdf = value; return 'blob:capture'; };
        HTMLAnchorElement.prototype.click = function () {};
        m.App.ui.doExport('pdf', true);
      } finally {
        URL.createObjectURL = createURL; HTMLAnchorElement.prototype.click = click;
      }
      const mediaBox = /\/MediaBox \[0 0 ([\d.]+) ([\d.]+)\]/.exec(await pdf.text());
      return {
        errors: [...xml.querySelectorAll('parsererror')].map(error => error.textContent),
        layer: xml.querySelector('g')?.getAttribute('id'), label: xml.querySelector('text')?.textContent,
        radius: Number(xml.querySelector('circle')?.getAttribute('r')), layerName, expectedLabel: label,
        viewBox: xml.documentElement.getAttribute('viewBox')?.split(' ').map(Number),
        pdfWidthMM: Number(mediaBox?.[1]) * 25.4 / 72,
      };
    });
    assert.deepEqual(svgCheck.errors, [], 'SVG must parse as XML with punctuation in layer names');
    assert.equal(svgCheck.layer, svgCheck.layerName);
    assert.equal(svgCheck.label, svgCheck.expectedLabel);
    assert.equal(svgCheck.radius, 10, 'SVG preserves the calibrated 20 mm diameter');
    const textMinX = -100 - svgCheck.expectedLabel.length * 3 * .62;
    assert.ok(svgCheck.viewBox[0] < textMinX && svgCheck.viewBox[1] < -100, 'SVG includes labels outside the part, including rotated text');
    assert.ok(svgCheck.pdfWidthMM > 20 - textMinX, 'PDF page includes the rotated label and the calibrated part');
    assert.deepEqual(errors, []);
    console.log('PASS: SVG punctuation, calibrated dimensions and SVG/PDF bounds for rotated labels outside the part');
  } finally { await browser?.close(); await new Promise(resolve => server.close(resolve)); }
})().catch(error => { console.error(error); process.exitCode = 1; });
