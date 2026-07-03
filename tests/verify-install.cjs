// Confirm the silently-installed TrueLine actually runs and exports valid DXF.
// Assumes the installed app was launched with TRUELINE_PORT=8392 --remote-debugging-port=9225.
const puppeteer = require('puppeteer-core');
const fs = require('fs');
const sleep = ms => new Promise(r => setTimeout(r, ms));
(async () => {
  const browser = await puppeteer.connect({ browserURL: 'http://127.0.0.1:9225', defaultViewport: null });
  const page = (await browser.pages())[0];
  await page.goto('http://127.0.0.1:8392/', { waitUntil: 'networkidle0' });
  await sleep(800);
  const checks = [];
  checks.push(['title', (await page.title()) === 'TrueLine — Trace to DXF']);
  checks.push(['palette rendered', (await page.$$eval('.pal-btn', e => e.length)) >= 15]);
  const st = await page.evaluate(() => Promise.all(['geom', 'dxf', 'pdf', 'icons'].map(async n => { const m = await import('/js/' + n + '.js'); return m.selfTest().pass; })));
  checks.push(['module selftests', st.every(Boolean)]);
  const dxf = await page.evaluate(async () => {
    const m = await import('/js/app.js'); const d = await import('/js/dxf.js');
    m.newDoc();
    m.addEntity({ type: 'line', a: { x: 0, y: 0 }, b: { x: 100, y: 0 } });
    m.addEntity({ type: 'circle', c: { x: 50, y: 40 }, r: 20 });
    m.addEntity({ type: 'arc', c: { x: 0, y: 40 }, r: 25, a0: 0, a1: Math.PI / 2 });
    return d.writeDXF(m.decomposeForExport(m.App.doc.entities), m.App.doc.layers, { units: 'mm' });
  });
  fs.writeFileSync('dist-test/installed.dxf', dxf);
  checks.push(['DXF export', dxf.includes('ENTITIES') && dxf.length > 400]);
  await page.evaluate(() => { const f = document.getElementById('firstrun'); if (f && !f.hidden) document.getElementById('frSkip').click(); });
  await sleep(300);
  await page.screenshot({ path: 'installed-app.png' });
  console.log(checks.map(([n, ok]) => (ok ? 'PASS ' : 'FAIL ') + n).join('\n'));
  await browser.disconnect();
  process.exit(checks.every(([, ok]) => ok) ? 0 : 1);
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
