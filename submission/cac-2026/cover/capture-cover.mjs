/** CAC portrait cover: use the original TrueLine logo, as requested by the entrant. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../../..');
const logo = await fs.readFile(path.join(root, 'build/icon.png'));
const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>TrueLine cover</title><style>
  *{box-sizing:border-box}html,body{margin:0;width:600px;height:800px;overflow:hidden;background:#0b0e13}
  body{display:flex;align-items:center;justify-content:center}img{display:block;width:400px;height:400px}
</style></head><body><img src="/logo.png" alt="TrueLine logo"></body></html>`;
const server = http.createServer((req, res) => {
  if (req.url === '/logo.png') { res.setHeader('Content-Type', 'image/png'); res.end(logo); }
  else { res.setHeader('Content-Type', 'text/html'); res.end(html); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const browser = await puppeteer.launch({ executablePath: process.env.CHROME_BIN || '/usr/bin/chromium', headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
try {
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.setViewport({ width: 600, height: 800, deviceScaleFactor: 1 });
  await page.goto(`http://127.0.0.1:${server.address().port}`, { waitUntil: 'load' });
  const dimensions = await page.evaluate(async () => {
    const image = document.querySelector('img');
    await image.decode();
    return { width: image.naturalWidth, height: image.naturalHeight };
  });
  assert.deepEqual(dimensions, { width: 256, height: 256 });
  assert.deepEqual(errors, []);
  const filename = path.join(here, 'trueline-cover-600x800.jpg');
  await page.screenshot({ path: filename, type: 'jpeg', quality: 97 });
  await fs.writeFile(path.join(here, 'capture-manifest.json'), JSON.stringify({
    width: 600,
    height: 800,
    format: 'JPEG',
    source: 'build/icon.png',
    sourceSHA256: createHash('sha256').update(logo).digest('hex'),
    sourceDimensions: dimensions,
    displayedLogo: { width: 400, height: 400, left: 100, top: 200 },
    background: '#0b0e13',
    capture: 'Original TrueLine logo centered on its existing brand background; no redrawing, extra text, or generated artwork',
    pageErrors: errors,
  }, null, 2) + '\n');
  console.log(filename);
} finally { await browser.close(); server.close(); }
