// Render the generated photo-style fixtures and the contours returned by the
// same extractor used in the unit tests. Requires ImageMagick's `magick` CLI.
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { autoTraceRaster } from '../js/autotrace.js';

const size = 576;
function raster(background, foreground) {
  const rgba = new Uint8ClampedArray(size * size * 4);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const i = (y * size + x) * 4, c = foreground(x / 4, y / 4) || background(x / 4, y / 4);
    rgba[i] = c[0]; rgba[i + 1] = c[1]; rgba[i + 2] = c[2]; rgba[i + 3] = 255;
  }
  return rgba;
}
const circle = (x, y, cx, cy, r) => (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
function inPoly(x, y, pts) {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const a = pts[i], b = pts[j];
    if ((a[1] > y) !== (b[1] > y) && x < (b[0] - a[0]) * (y - a[1]) / (b[1] - a[1]) + a[0]) inside = !inside;
  }
  return inside;
}
function makeCase(name, detail, rgba) {
  const result = autoTraceRaster(size, size, rgba);
  const contours = result.entities.map(e => e.type === 'circle' ? Array.from({ length: 360 }, (_, i) => ({
    x: e.c.x + e.r * Math.cos(i * Math.PI / 180), y: e.c.y + e.r * Math.sin(i * Math.PI / 180),
  })) : e.pts);
  return { name, detail, rgba, contours };
}

const gasket = raster(
  (x, y) => [214 + Math.round(x / 24), 218 + Math.round(y / 28), 216],
  (x, y) => {
    const r = Math.hypot(x - 72, y - 72);
    return r >= 25 && r <= 38 && !circle(x, y, 40, 72, 3) && !circle(x, y, 104, 72, 3) ? [28 + Math.round(r / 10), 31, 34] : null;
  });
const platePoly = [[30, 20], [112, 20], [124, 32], [124, 104], [112, 116], [30, 116], [18, 104], [18, 32]];
const plate = raster(
  (x, y) => [32 + ((x * 7 + y * 3) % 4), 39 + ((x * 5 + y) % 3), 45],
  (x, y) => inPoly(x, y, platePoly) && !circle(x, y, 47, 49, 8) && !circle(x, y, 95, 87, 11) ? [178 + ((x + y) % 5), 184, 188] : null);
const bracketPoly = [[25, 24], [110, 24], [110, 50], [58, 50], [58, 116], [25, 116]];
const bracket = raster(
  (x, y) => [116 + ((x + y) % 5), 77 + ((2 * x + y) % 5), 49 + ((x + 3 * y) % 4)],
  (x, y) => inPoly(x, y, bracketPoly) && !circle(x, y, 42, 42, 7) ? [27, 132 + ((x + y) % 6), 154] : null);
const cases = [
  makeCase('Rubber gasket', '4 contours · center opening + 2 bolt holes', gasket),
  makeCase('Aluminum plate', '3 contours · chamfered edge + 2 cutouts', plate),
  makeCase('Mounting bracket', '2 contours · L-profile + 1 hole', bracket),
];

const width = 2940, height = 876, rgb = Buffer.alloc(width * height * 3);
const set = (x, y, color) => {
  if (x < 0 || y < 0 || x >= width || y >= height) return;
  const i = (y * width + x) * 3; rgb[i] = color[0]; rgb[i + 1] = color[1]; rgb[i + 2] = color[2];
};
const rect = (x, y, w, h, color) => {
  for (let py = y; py < y + h; py++) for (let px = x; px < x + w; px++) set(px, py, color);
};
const line = (a, b, color) => {
  let x = a.x, y = a.y, dx = Math.abs(b.x - x), sx = x < b.x ? 1 : -1;
  let dy = -Math.abs(b.y - y), sy = y < b.y ? 1 : -1, err = dx + dy;
  while (true) {
    for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) set(x + ox, y + oy, color);
    if (x === b.x && y === b.y) break;
    const e2 = 2 * err;
    if (e2 >= dy) { err += dy; x += sx; }
    if (e2 <= dx) { err += dx; y += sy; }
  }
};
rect(0, 0, width, height, [12, 20, 32]);
const imageSize = 380, scale = imageSize / size, cyan = [54, 226, 236];
cases.forEach((c, index) => {
  const cardX = 56 + index * 948, inputX = cardX + 48, outputX = cardX + 516, imageY = 328;
  rect(cardX, 196, 900, 600, [23, 37, 54]);
  for (const originX of [inputX, outputX]) {
    for (let y = 0; y < imageSize; y++) for (let x = 0; x < imageSize; x++) {
      const sx = Math.min(size - 1, Math.floor(x / scale)), sy = Math.min(size - 1, Math.floor(y / scale));
      const i = (sy * size + sx) * 4;
      set(originX + x, imageY + y, [c.rgba[i], c.rgba[i + 1], c.rgba[i + 2]]);
    }
  }
  for (const contour of c.contours) for (let i = 0; i < contour.length; i++) {
    const a = contour[i], b = contour[(i + 1) % contour.length];
    line({ x: Math.round(outputX + a.x * scale), y: Math.round(imageY + a.y * scale) },
      { x: Math.round(outputX + b.x * scale), y: Math.round(imageY + b.y * scale) }, cyan);
  }
});

const outDir = new URL('../test-artifacts/', import.meta.url);
mkdirSync(outDir, { recursive: true });
const ppmPath = join(tmpdir(), 'trueline-autotrace-cases.ppm');
const pngPath = new URL('../test-artifacts/autotrace-cases.png', import.meta.url).pathname;
writeFileSync(ppmPath, Buffer.concat([Buffer.from(`P6\n${width} ${height}\n255\n`), rgb]));
const args = [ppmPath, '-font', 'DejaVu-Sans', '-fill', '#f2f6fb', '-pointsize', '25', '-annotate', '+28+45', 'TrueLine auto-trace test cases',
  '-fill', '#9eacbd', '-pointsize', '14', '-annotate', '+28+72', 'Generated photo-style inputs left · detected closed contours right',
  '-fill', '#f2f6fb', '-pointsize', '21', '-annotate', '+52+132', 'Rubber gasket',
  '-fill', '#aab8c8', '-pointsize', '13', '-annotate', '+52+154', '4 contours · opening + 2 bolt holes',
  '-fill', '#8d9daf', '-pointsize', '11', '-annotate', '+52+382', 'INPUT',
  '-fill', '#36e2ec', '-annotate', '+286+382', 'DETECTED CONTOURS',
  '-fill', '#f2f6fb', '-pointsize', '21', '-annotate', '+526+132', 'Aluminum plate',
  '-fill', '#aab8c8', '-pointsize', '13', '-annotate', '+526+154', '3 contours · chamfer + 2 cutouts',
  '-fill', '#8d9daf', '-pointsize', '11', '-annotate', '+526+382', 'INPUT',
  '-fill', '#36e2ec', '-annotate', '+760+382', 'DETECTED CONTOURS',
  '-fill', '#f2f6fb', '-pointsize', '21', '-annotate', '+1000+132', 'Mounting bracket',
  '-fill', '#aab8c8', '-pointsize', '13', '-annotate', '+1000+154', '2 contours · L-profile + 1 hole',
  '-fill', '#8d9daf', '-pointsize', '11', '-annotate', '+1000+382', 'INPUT',
  '-fill', '#36e2ec', '-annotate', '+1234+382', 'DETECTED CONTOURS', pngPath];
for (let i = 0; i < args.length; i++) {
  if (args[i] === '-pointsize') args[i + 1] = String(Number(args[i + 1]) * 2);
  if (args[i] === '-annotate') args[i + 1] = args[i + 1].replace(/\d+/g, n => String(Number(n) * 2));
}
execFileSync('magick', args);
execFileSync('magick', [pngPath, '-crop', '900x600+56+196', '+repage', new URL('../test-artifacts/autotrace-gasket.png', import.meta.url).pathname]);
console.log(`Wrote ${pngPath}`);
