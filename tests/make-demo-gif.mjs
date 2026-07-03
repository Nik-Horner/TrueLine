// Capture the app tracing rough shapes and snapping them clean, as an animated GIF.
// Requires the dev app on :9223 / :8390.  node tests/make-demo-gif.mjs
import puppeteer from 'puppeteer-core';
import pngjs from 'pngjs';
const { PNG } = pngjs;
import gifenc from 'gifenc';
const { GIFEncoder, quantize, applyPalette } = gifenc;
import { writeFileSync } from 'fs';

const sleep = ms => new Promise(r => setTimeout(r, ms));
const browser = await puppeteer.connect({ browserURL: 'http://127.0.0.1:9223', defaultViewport: null });
const page = (await browser.pages())[0];
await page.goto('http://127.0.0.1:8390/', { waitUntil: 'networkidle0' });
await page.evaluate(() => { localStorage.setItem('tl-frdone', '1'); localStorage.setItem('tl-tour-done', '1'); });
await page.reload({ waitUntil: 'networkidle0' });
await sleep(700);

// page.screenshot forces a real paint (canvas.toDataURL reads a throttled/stale buffer
// when the window isn't focused). Clip to the drawing stack, then downscale for the GIF.
const stackRect = await page.evaluate(() => { const r = document.getElementById('stack').getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height) }; });
function downscale(png, targetW) {
  const scale = targetW / png.width, W = targetW, H = Math.round(png.height * scale);
  const out = new Uint8Array(W * H * 4);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const sx = Math.min(png.width - 1, Math.floor(x / scale)), sy = Math.min(png.height - 1, Math.floor(y / scale));
    const si = (sy * png.width + sx) * 4, di = (y * W + x) * 4;
    out[di] = png.data[si]; out[di + 1] = png.data[si + 1]; out[di + 2] = png.data[si + 2]; out[di + 3] = 255;
  }
  return { data: out, width: W, height: H };
}
async function grab() {
  const buf = await page.screenshot({ clip: stackRect });
  return downscale(PNG.sync.read(Buffer.from(buf)), 460);
}

const frames = [];
async function capture(n = 1) { const f = await grab(); for (let i = 0; i < n; i++) frames.push(f); }

// drive a rough freehand stroke that grows, then snaps — for two shapes
async function traceShape(kind) {
  await page.evaluate((kind) => {
    const m = window.__mm;
    m.newDoc(); m.App.view = { x: -18, y: -14, z: 1.7 }; m.invalidate('all');
    m.setTool('freehand'); m.App.doc.traceOpts.mode = 'fit';
    window.__pe = (t, wx, wy, b) => {
      const cv = document.getElementById('cvOverlay'), r = cv.getBoundingClientRect(), sc = m.toScreen({ x: wx, y: wy });
      cv.dispatchEvent(new PointerEvent(t, { clientX: r.left + sc.x, clientY: r.top + sc.y, button: 0, buttons: b, pointerId: 1, pointerType: 'pen', pressure: b ? 0.5 : 0, isPrimary: true, bubbles: true }));
    };
    window.__path = (() => {
      let s = 7; const rnd = () => { s = (s * 1103515245 + 12345) % 2147483648; return s / 2147483648 - 0.5; };
      const p = [];
      if (kind === 'circle') for (let i = 0; i <= 120; i++) { const a = i / 120 * Math.PI * 2; p.push([55 + 30 * Math.cos(a) + rnd() * 2.2, 45 + 30 * Math.sin(a) + rnd() * 2.2]); }
      else for (let i = 0; i <= 120; i++) p.push([8 + i * 0.85, 45 + 26 * Math.sin(i / 19) + rnd() * 2.4]);
      return p;
    })();
    window.__i = 0;
  }, kind);
  await page.evaluate(() => { window.__pe('pointerdown', window.__path[0][0], window.__path[0][1], 1); });
  // grow the stroke, grabbing frames
  const steps = 10;
  for (let s = 1; s <= steps; s++) {
    await page.evaluate((frac) => {
      const to = Math.floor(window.__path.length * frac);
      while (window.__i < to) { window.__i++; const pt = window.__path[window.__i]; if (pt) window.__pe('pointermove', pt[0], pt[1], 1); }
    }, s / steps);
    await capture(1);
  }
  await page.evaluate(() => { const last = window.__path[window.__path.length - 1]; window.__pe('pointerup', last[0], last[1], 0); });
  await sleep(120);
  await capture(9);   // hold on the clean snapped result
}

await page.evaluate(async () => { window.__mm = await import('/js/app.js'); });
await traceShape('circle');
await traceShape('wave');

// encode GIF
const { width, height } = frames[0];
const enc = GIFEncoder();
frames.forEach((f, idx) => {
  const palette = quantize(f.data, 256);
  const index = applyPalette(f.data, palette);
  const held = idx % 19 >= 10;   // longer delay on the "snapped" hold frames
  enc.writeFrame(index, width, height, { palette, delay: held ? 90 : 110 });
});
enc.finish();
writeFileSync(new URL('../assets/demo.gif', import.meta.url), enc.bytes());
console.log('wrote assets/demo.gif', frames.length, 'frames', width + 'x' + height);
await browser.disconnect();
