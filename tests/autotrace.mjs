import assert from 'node:assert/strict';
import { autoTraceRaster } from '../js/autotrace.js';

function raster(width, height, background, foreground) {
  const rgba = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const p = y * width + x, color = foreground(x, y) || background(x, y);
    rgba[p * 4] = color[0]; rgba[p * 4 + 1] = color[1]; rgba[p * 4 + 2] = color[2]; rgba[p * 4 + 3] = 255;
  }
  return rgba;
}
const inPoly = (x, y, pts) => {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const a = pts[i], b = pts[j];
    if ((a[1] > y) !== (b[1] > y) && x < (b[0] - a[0]) * (y - a[1]) / (b[1] - a[1]) + a[0]) inside = !inside;
  }
  return inside;
};
const circle = (x, y, cx, cy, r) => (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
const bounds = points => ({
  minX: Math.min(...points.map(p => p.x)), maxX: Math.max(...points.map(p => p.x)),
  minY: Math.min(...points.map(p => p.y)), maxY: Math.max(...points.map(p => p.y)),
});

// Dark rubber gasket on a softly lit worktop, with a center opening and two bolt holes.
const gasket = raster(144, 144,
  (x, y) => [214 + Math.round(x / 24), 218 + Math.round(y / 28), 216],
  (x, y) => {
    const r = Math.hypot(x - 72, y - 72);
    const material = r >= 25 && r <= 38 && !circle(x, y, 40, 72, 3) && !circle(x, y, 104, 72, 3);
    return material ? [28 + Math.round(r / 10), 31, 34] : null;
  });
const gasketResult = autoTraceRaster(144, 144, gasket);
assert.equal(gasketResult.contours.length, 4, 'gasket: outer edge, center opening, and two bolt holes');
const gasketOuter = bounds(gasketResult.contours[0]);
assert.ok(Math.abs(gasketOuter.minX - 34) <= 2 && Math.abs(gasketOuter.maxX - 110) <= 2, 'gasket outer width');
assert.equal(gasketResult.entities[0].type, 'circle', 'gasket outside must export as a smooth CAD circle');
assert.ok(Math.abs(gasketResult.entities[0].r - 38) < 1, 'gasket circle radius within one source pixel');

// Bright chamfered aluminum plate on a dark mat, including two internal cutouts.
const platePoly = [[30, 20], [112, 20], [124, 32], [124, 104], [112, 116], [30, 116], [18, 104], [18, 32]];
const plate = raster(144, 144,
  (x, y) => [32 + ((x * 7 + y * 3) % 4), 39 + ((x * 5 + y) % 3), 45],
  (x, y) => inPoly(x, y, platePoly) && !circle(x, y, 47, 49, 8) && !circle(x, y, 95, 87, 11) ? [178 + ((x + y) % 5), 184, 188] : null);
const plateResult = autoTraceRaster(144, 144, plate);
assert.equal(plateResult.contours.length, 3, 'plate: outside contour and two holes');
const plateOuter = bounds(plateResult.contours[0]);
assert.ok(Math.abs(plateOuter.minX - 18) <= 2 && Math.abs(plateOuter.maxX - 124) <= 2, 'plate outer width');
assert.equal(plateResult.entities[0].type, 'poly', 'chamfers must remain a polygon');
assert.ok(plateResult.entities.slice(1).every(e => e.type === 'circle'), 'plate holes must export as circles');

// A teal L-bracket photographed on a mildly textured wood-colored surface.
const bracketPoly = [[25, 24], [110, 24], [110, 50], [58, 50], [58, 116], [25, 116]];
const bracket = raster(144, 144,
  (x, y) => [116 + ((x + y) % 5), 77 + ((2 * x + y) % 5), 49 + ((x + 3 * y) % 4)],
  (x, y) => inPoly(x, y, bracketPoly) && !circle(x, y, 42, 42, 7) ? [27, 132 + ((x + y) % 6), 154] : null);
const bracketResult = autoTraceRaster(144, 144, bracket);
assert.equal(bracketResult.contours.length, 2, 'bracket: outside contour and one mounting hole');
const bracketOuter = bounds(bracketResult.contours[0]);
assert.ok(Math.abs(bracketOuter.minX - 25) <= 2 && Math.abs(bracketOuter.maxX - 110) <= 2, 'bracket outer width');
assert.equal(bracketResult.entities[0].type, 'poly', 'L-profile must retain its concave corner');

assert.throws(() => autoTraceRaster(32, 32, new Uint8ClampedArray(32 * 32 * 4)), /Could not isolate a part/);
console.log('autotrace: PASS (rubber gasket, aluminum plate, textured-background bracket, empty image)');
