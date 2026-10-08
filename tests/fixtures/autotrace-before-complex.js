// Test-only extractor snapshot for reproducible before / after comparisons.
// This file is never imported by the application.
// Offline photo outline extraction. The image is segmented against its border
// background, then converted to closed pixel-boundary contours.

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

function median(values) {
  values.sort((a, b) => a - b);
  const mid = values.length >> 1;
  return values.length & 1 ? values[mid] : (values[mid - 1] + values[mid]) / 2;
}

function borderColor(width, height, rgba) {
  const rs = [], gs = [], bs = [];
  const step = Math.max(1, Math.floor(Math.min(width, height) / 256));
  const band = Math.max(1, Math.round(Math.min(width, height) * 0.012));
  const take = (x, y) => {
    const i = (y * width + x) * 4;
    if (rgba[i + 3] < 32) return;
    rs.push(rgba[i]); gs.push(rgba[i + 1]); bs.push(rgba[i + 2]);
  };
  for (let y = 0; y < band; y += step) for (let x = 0; x < width; x += step) {
    take(x, y); take(x, height - 1 - y);
  }
  for (let x = 0; x < band; x += step) for (let y = band; y < height - band; y += step) {
    take(x, y); take(width - 1 - x, y);
  }
  if (!rs.length) return [255, 255, 255];
  return [median(rs), median(gs), median(bs)];
}

function otsu(hist, total) {
  let sum = 0;
  for (let i = 0; i < hist.length; i++) sum += i * hist[i];
  let backCount = 0, backSum = 0, best = 0, bestVariance = -1;
  for (let t = 0; t < hist.length - 1; t++) {
    backCount += hist[t]; backSum += t * hist[t];
    const frontCount = total - backCount;
    if (!backCount || !frontCount) continue;
    const delta = backSum / backCount - (sum - backSum) / frontCount;
    const variance = backCount * frontCount * delta * delta;
    if (variance > bestVariance) { bestVariance = variance; best = t; }
  }
  return best;
}

function denoiseMask(source, width, height, preserveHoles = false) {
  const result = source.slice();
  for (let y = 1; y < height - 1; y++) for (let x = 1; x < width - 1; x++) {
    let count = 0, i = y * width + x;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) count += source[i + dy * width + dx];
    result[i] = preserveHoles && !source[i] ? 0 : count >= 5 ? 1 : 0;
  }
  return result;
}

function largestInteriorComponent(mask, width, height) {
  const seen = new Uint8Array(mask.length), queue = new Int32Array(mask.length);
  let best = null, bestCount = 0;
  for (let seed = 0; seed < mask.length; seed++) {
    if (!mask[seed] || seen[seed]) continue;
    let head = 0, tail = 0, touchesEdge = false;
    queue[tail++] = seed; seen[seed] = 1;
    while (head < tail) {
      const i = queue[head++], x = i % width, y = (i / width) | 0;
      if (x === 0 || y === 0 || x === width - 1 || y === height - 1) touchesEdge = true;
      const add = j => { if (mask[j] && !seen[j]) { seen[j] = 1; queue[tail++] = j; } };
      if (x) add(i - 1);
      if (x + 1 < width) add(i + 1);
      if (y) add(i - width);
      if (y + 1 < height) add(i + width);
    }
    if (!touchesEdge && tail > bestCount) { best = queue.slice(0, tail); bestCount = tail; }
  }
  if (!best) return null;
  mask.fill(0);
  for (const i of best) mask[i] = 1;
  return { pixels: bestCount, mask };
}

const vertexKey = (x, y, stride) => y * stride + x;
function extractLoops(mask, width, height) {
  const stride = width + 1, edges = [], outgoing = new Map();
  const add = (x1, y1, x2, y2, dir) => {
    const from = vertexKey(x1, y1, stride), to = vertexKey(x2, y2, stride);
    const edge = { from, to, dir, used: false };
    edges.push(edge);
    if (!outgoing.has(from)) outgoing.set(from, []);
    outgoing.get(from).push(edge);
  };
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const i = y * width + x;
    if (!mask[i]) continue;
    if (!y || !mask[i - width]) add(x, y, x + 1, y, 0);
    if (x + 1 === width || !mask[i + 1]) add(x + 1, y, x + 1, y + 1, 1);
    if (y + 1 === height || !mask[i + width]) add(x + 1, y + 1, x, y + 1, 2);
    if (!x || !mask[i - 1]) add(x, y + 1, x, y, 3);
  }

  const loops = [];
  for (const first of edges) {
    if (first.used) continue;
    const start = first.from, points = [{ x: start % stride, y: (start / stride) | 0 }];
    let edge = first, guard = 0;
    while (edge && !edge.used && guard++ <= edges.length) {
      edge.used = true;
      const x = edge.to % stride, y = (edge.to / stride) | 0;
      points.push({ x, y });
      if (edge.to === start) break;
      const candidates = (outgoing.get(edge.to) || []).filter(e => !e.used);
      if (!candidates.length) { edge = null; break; }
      const turnRank = e => {
        const turn = (e.dir - edge.dir + 4) % 4;
        return turn === 1 ? 0 : turn === 0 ? 1 : turn === 3 ? 2 : 3;
      };
      candidates.sort((a, b) => turnRank(a) - turnRank(b));
      edge = candidates[0];
    }
    if (points.length >= 5 && points.at(-1).x === points[0].x && points.at(-1).y === points[0].y) {
      points.pop();
      const simplified = simplifyClosed(points, 0.45);
      if (simplified.length >= 3 && Math.abs(signedArea(simplified)) >= 3) loops.push(simplified);
    }
  }
  return loops;
}

function signedArea(points) {
  let area = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[i], b = points[(i + 1) % points.length];
    area += a.x * b.y - b.x * a.y;
  }
  return area / 2;
}

function simplifyOpen(points, tolerance) {
  if (points.length <= 2) return points;
  const keep = new Uint8Array(points.length), stack = [[0, points.length - 1]];
  keep[0] = keep[points.length - 1] = 1;
  while (stack.length) {
    const [start, end] = stack.pop(), a = points[start], b = points[end];
    const dx = b.x - a.x, dy = b.y - a.y, len2 = dx * dx + dy * dy;
    let best = tolerance, index = -1;
    for (let i = start + 1; i < end; i++) {
      const p = points[i];
      const t = len2 ? clamp(((p.x - a.x) * dx + (p.y - a.y) * dy) / len2, 0, 1) : 0;
      const d = Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
      if (d > best) { best = d; index = i; }
    }
    if (index >= 0) { keep[index] = 1; stack.push([start, index], [index, end]); }
  }
  return points.filter((_, i) => keep[i]);
}

function simplifyClosed(points, tolerance) {
  if (points.length < 4) return points;
  let a = 0, farthest = -1;
  for (let i = 1; i < points.length; i++) {
    const dx = points[i].x - points[0].x, dy = points[i].y - points[0].y, d = dx * dx + dy * dy;
    if (d > farthest) { farthest = d; a = i; }
  }
  let b = a;
  farthest = -1;
  for (let i = 0; i < points.length; i++) {
    const dx = points[i].x - points[a].x, dy = points[i].y - points[a].y, d = dx * dx + dy * dy;
    if (d > farthest) { farthest = d; b = i; }
  }
  const one = [], two = [];
  for (let i = a; ; i = (i + 1) % points.length) { one.push(points[i]); if (i === b) break; }
  for (let i = b; ; i = (i + 1) % points.length) { two.push(points[i]); if (i === a) break; }
  const first = simplifyOpen(one, tolerance), second = simplifyOpen(two, tolerance);
  const joined = first.concat(second.slice(1, -1));
  return joined;
}

/**
 * Find the largest non-border object that contrasts with the image border.
 * `rgba` is an ImageData.data-compatible RGBA array. Returned contour points
 * are in the supplied raster's pixel coordinates; holes are separate loops.
 */
export function autoTraceRaster(width, height, rgba, options = {}) {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 16 || height < 16 || !rgba || rgba.length < width * height * 4)
    throw new Error('Choose an image at least 16 × 16 pixels.');
  if (width * height > 2048 * 2048) throw new Error('Resize the image to at most 4 megapixels before tracing.');
  if (!options || !Number.isFinite(options.sensitivity ?? .35) || (options.sensitivity ?? .35) < .15 || (options.sensitivity ?? .35) > 1.5)
    throw new Error('Edge contrast must be between 0.15 and 1.5.');
  const bg = borderColor(width, height, rgba), n = width * height, distances = new Uint8Array(n), hist = new Uint32Array(256);
  for (let i = 0; i < n; i++) {
    const j = i * 4, alpha = rgba[j + 3] / 255;
    const dr = rgba[j] * alpha + bg[0] * (1 - alpha) - bg[0];
    const dg = rgba[j + 1] * alpha + bg[1] * (1 - alpha) - bg[1];
    const db = rgba[j + 2] * alpha + bg[2] * (1 - alpha) - bg[2];
    const d = Math.min(255, Math.round(Math.sqrt(0.299 * dr * dr + 0.587 * dg * dg + 0.114 * db * db)));
    distances[i] = d; hist[d]++;
  }
  let threshold = Math.max(10, Math.round(otsu(hist, n) * (options.sensitivity ?? 0.35)));
  let mask = new Uint8Array(n);
  for (let i = 0; i < n; i++) mask[i] = distances[i] > threshold ? 1 : 0;
  mask = denoiseMask(mask, width, height, options.keepSmallHoles);
  let component = largestInteriorComponent(mask, width, height);
  if (!component) {
    threshold = Math.max(10, otsu(hist, n));
    for (let i = 0; i < n; i++) mask[i] = distances[i] > threshold ? 1 : 0;
    component = largestInteriorComponent(denoiseMask(mask, width, height, options.keepSmallHoles), width, height);
  }
  if (!component || component.pixels < Math.max(20, n * 0.00008) || component.pixels > n * 0.97)
    throw new Error('Could not isolate a part. Try a clear photo with the part separated from the image edges and a contrasting, uncluttered background.');
  let contours = extractLoops(component.mask, width, height);
  if (!contours.length) throw new Error('No usable outline was found. Try a sharper photo with more contrast around the part.');
  contours.sort((a, b) => Math.abs(signedArea(b)) - Math.abs(signedArea(a)));
  const detectedOpenings = contours.length - 1;
  // Reject tiny texture islands and require background evidence for openings.
  // Elongated slots are retained; the detail override exposes uncertain holes.
  if (!options.keepSmallHoles) contours = contours.filter((points, index) => {
    if (!index) return true;
    if (Math.abs(signedArea(points)) < 9) return false;
    const bounds = points.reduce((b,p) => ({ minY: Math.min(b.minY,p.y), maxY: Math.max(b.maxY,p.y) }), { minY: height, maxY: 0 });
    let samples = 0, background = 0;
    // Scanline intervals avoid a point-in-polygon test for every interior pixel.
    for (let y = Math.max(0, Math.floor(bounds.minY)); y < Math.min(height, Math.ceil(bounds.maxY)); y++) {
      const crossings = [];
      for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
        const a = points[i], b = points[j];
        if ((a.y > y + .5) !== (b.y > y + .5)) crossings.push((b.x-a.x)*(y+.5-a.y)/(b.y-a.y)+a.x);
      }
      crossings.sort((a,b) => a-b);
      for (let i = 0; i + 1 < crossings.length; i += 2)
        for (let x = Math.max(0, Math.ceil(crossings[i] - .5)); x < Math.min(width, Math.ceil(crossings[i+1] - .5)); x++) {
          samples++; if (distances[y * width + x] < Math.max(10, threshold * .5)) background++;
        }
    }
    return samples > 0 && background / samples >= .7;
  });
  const entities = contours.map(points => fitCircularOutline(points) || { type: 'poly', pts: points, closed: true });
  return { contours, entities, threshold, suppressedOpenings: detectedOpenings - contours.length + 1, foregroundPixels: component.pixels, foregroundFraction: component.pixels / n };
}

// Only replace a loop with a CAD circle when its measured deviations stay
// within raster precision. Arbitrary profiles retain their sampled geometry.
function fitCircularOutline(points) {
  const n = points.length;
  const mx = points.reduce((s, p) => s + p.x, 0) / n;
  const my = points.reduce((s, p) => s + p.y, 0) / n;
  let xx = 0, xy = 0, yy = 0, xq = 0, yq = 0, qsum = 0;
  for (const p of points) {
    const x = p.x - mx, y = p.y - my, q = x*x + y*y;
    xx += x*x; xy += x*y; yy += y*y; xq += x*q; yq += y*q; qsum += q;
  }
  const det = xx*yy - xy*xy;
  if (Math.abs(det) < 1e-8) return null;
  const dx = (xq*yy - yq*xy) / det / 2;
  const dy = (yq*xx - xq*xy) / det / 2;
  const c = { x: mx + dx, y: my + dy }, r = Math.sqrt(qsum / n + dx*dx + dy*dy);
  if (r < 2.5) return null;
  const errors = points.map(p => Math.abs(Math.hypot(p.x-c.x, p.y-c.y)-r));
  const rms = Math.sqrt(errors.reduce((s, e) => s + e*e, 0) / n);
  if (rms > 0.6 || errors.some(e => e > 1) || Math.abs(Math.abs(signedArea(points)) / (Math.PI*r*r) - 1) > 0.08) return null;
  return { type: 'circle', c, r };
}
