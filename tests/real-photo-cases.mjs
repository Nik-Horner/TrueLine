// Evaluation on independently sourced camera photos, without per-image tuning.
// ImageMagick decodes the photos and renders the extracted geometry; the
// production autoTraceRaster function performs all segmentation and tracing.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { autoTraceRaster } from '../js/autotrace.js';

const dir = fileURLToPath(new URL('../test-artifacts/real-photos/', import.meta.url));
mkdirSync(dir, { recursive: true });
const gasketCommit = 'dbff6eb5e393c6cd85f2eff19fee79aa2805e85b';
const anomalibCommit = '9fb1337c0ac866797f4eedcaa0972d0f24a84f19';
const gasketUrl = file => `https://raw.githubusercontent.com/changhaowang/GasketDetection/${gasketCommit}/DetectionFramework2D/Pictures/${file}`;
const mvtecUrl = `https://raw.githubusercontent.com/openvinotoolkit/anomalib/${anomalibCommit}/docs/source/images/uflow/results-mvtec-good.jpg`;
const cases = [
  { id: 'washer-tabletop', title: 'Washer on a tabletop: full camera frame', url: gasketUrl('1_M22.bmp'), expectedContours: 2, credit: 'changhaowang/GasketDetection; no image license specified' },
  { id: 'washer-crop', title: 'Same washer: crop around the part', url: gasketUrl('1_M22.bmp'), crop: '120x120+321+138', expectedContours: 2, credit: 'changhaowang/GasketDetection; no image license specified' },
  { id: 'three-washers', title: 'Three washers on cardboard', url: gasketUrl('M1822_1.png'), expectedContours: 2, note: 'Current algorithm keeps only the largest connected part.', credit: 'changhaowang/GasketDetection; no image license specified' },
  { id: 'metal-nut', title: 'Reflective metal nut on a dark surface', url: mvtecUrl, crop: '256x256+1858+0', expectedContours: 2, credit: 'MVTec AD photo reproduced in anomalib / U-Flow comparison; CC BY-NC-SA 4.0. Crop of input-image row only.' },
  { id: 'screw', title: 'Metal screw on a gray surface', url: mvtecUrl, crop: '256x256+2374+0', expectedContours: 1, credit: 'MVTec AD photo reproduced in anomalib / U-Flow comparison; CC BY-NC-SA 4.0. Crop of input-image row only.' },
  { id: 'three-washers-full', title: 'Washers on cardboard: full workshop scene', url: gasketUrl('M1822.jpg'), expectedContours: 2, note: 'The requested object is a washer, not the board or table.', credit: 'changhaowang/GasketDetection; no image license specified' },
];

const nut = cases.find(c => c.id === 'metal-nut');
for (const [suffix,title,transforms] of [
  ['rotated','Rotated 90 degrees',['-rotate','90']],
  ['blurred','Mild lens blur',['-blur','0x0.7']],
  ['small','Half resolution',['-resize','128x128']],
  ['very-small','Quarter resolution',['-resize','64x64']],
  ['dark','Lower exposure',['-evaluate','multiply','.65']],
  ['bright','Higher exposure',['-evaluate','multiply','1.3']],
  ['jpeg','JPEG compression at quality 35',['-quality','35']],
  ['severe-blur','Severe lens blur',['-blur','0x3']],
]) cases.push({ ...nut, id: 'nut-'+suffix, title: 'Real nut: '+title, transforms });
cases.push({ id:'workshop-washer-crop', title:'Workshop washer: explicit part selection', url:gasketUrl('M1822.jpg'), crop:'120x100+345+215', expectedContours:2, credit:cases[0].credit });

const report = [];
const reviews = {
  'washer-tabletop': ['needs crop', 'Full-frame extraction is rejected. Selecting the washer region is required; see the recorded washer-crop case.'],
  'washer-crop': ['rough draft', 'Located the outside edge and center opening. Low source resolution and faceted edges prevent a precision claim.'],
  'three-washers': ['rough draft', 'Located the largest washer and its opening; the other two are intentionally ignored by this algorithm. Low resolution limits accuracy.'],
  'metal-nut': ['improved draft', 'Outside profile and true center opening located; false texture openings removed (15 contours before, 2 after). Boundary precision is not established.'],
  'screw': ['partial fix', 'False highlight holes removed (5 contours before, 1 after). Thread and shadow boundaries improved; see the independent silhouette comparison in complex-parts/accuracy.json. Thread valleys still need precision work; do not use this outline for manufacturing.'],
  'three-washers-full': ['needs crop', 'Full-frame default still selects scene geometry. Use the new crop and review dialog to select one washer.'],
};
for (const c of cases) {
  const source = join(dir, c.url === mvtecUrl ? 'mvtec-source.jpg' : c.url.split('/').at(-1));
  if (!existsSync(source)) execFileSync('curl', ['--fail', '--location', '--silent', '--show-error', '--max-time', '45', c.url, '-o', source]);
  const input = join(dir, `${c.id}-input.png`);
  const args = [source];
  if (c.crop) args.push('-crop', c.crop, '+repage');
  if (c.transforms && c.id !== 'nut-jpeg') args.push(...c.transforms);
  args.push('-resize', '2048x2048>', '-background', 'white', '-alpha', 'remove', '-alpha', 'off', '-colorspace', 'sRGB', '-depth', '8', input);
  execFileSync('magick', args);
  if (c.id === 'nut-jpeg') {
    const compressed = join(dir, c.id+'.jpg');
    execFileSync('magick', [input, ...c.transforms, compressed]);
    execFileSync('magick', [compressed, input]);
  }
  const [width, height] = execFileSync('magick', ['identify', '-format', '%w %h', input]).toString().split(' ').map(Number);
  const rgba = execFileSync('magick', [input, '-depth', '8', 'RGBA:-'], { maxBuffer: 32 * 1024 * 1024 });
  const start = performance.now();
  let result, error;
  try { result = autoTraceRaster(width, height, rgba); } catch (err) { error = err.message; }
  const elapsedMs = Math.round(performance.now() - start);
  const record = { ...c, width, height, elapsedMs, contours: result?.contours.length ?? 0, circles: result?.entities.filter(e => e.type === 'circle').length ?? 0, threshold: result?.threshold, error };
  record.countMatchesExpected = record.contours === c.expectedContours;
  [record.assessment, record.review] = reviews[c.id] || ['needs visual review', 'A controlled variation of a real photograph. Count and position checks alone do not establish dimensional accuracy.'];
  if (result && (c.id === 'metal-nut' || c.id.startsWith('nut-'))) {
    const opening = result.contours[1];
    const bounds = opening && opening.reduce((b,p) => ({minX:Math.min(b.minX,p.x),maxX:Math.max(b.maxX,p.x),minY:Math.min(b.minY,p.y),maxY:Math.max(b.maxY,p.y)}),{minX:width,maxX:0,minY:height,maxY:0});
    record.openingPositionMatches = Boolean(bounds && (bounds.minX+bounds.maxX)/2/width > .43 && (bounds.minX+bounds.maxX)/2/width < .57 && (bounds.minY+bounds.maxY)/2/height > .43 && (bounds.minY+bounds.maxY)/2/height < .57 && (bounds.maxX-bounds.minX)/width > .17 && (bounds.maxX-bounds.minX)/width < .3);
  }
  if (c.id.startsWith('nut-')) {
    record.assessment = record.countMatchesExpected && record.openingPositionMatches ? 'topology check passed' : 'failed topology check';
    record.review = 'Checked contour count and approximate central opening location/size. Outline accuracy still requires visual inspection; no ground-truth silhouette is available.';
  }
  if (c.id === 'workshop-washer-crop') {
    record.assessment = record.countMatchesExpected ? 'rough draft' : 'failed topology check';
    record.review = 'Explicit crop selects the rightmost washer. Source resolution limits precision.';
  }
  if (result) writeFileSync(join(dir, `${c.id}-geometry.json`), JSON.stringify(result, null, 2));
  else rmSync(join(dir, `${c.id}-geometry.json`), { force: true });
  const overlay = join(dir, `${c.id}-overlay.png`);
  const draw = [];
  for (const e of result?.entities || []) {
    if (e.type === 'circle') draw.push(`circle ${e.c.x},${e.c.y} ${e.c.x + e.r},${e.c.y}`);
    else draw.push(`path 'M${e.pts.map(p => `${p.x},${p.y}`).join(' L')} Z'`);
  }
  const overlayArgs = [input, '-fill', 'none', '-stroke', '#00ffff', '-strokewidth', '1.2'];
  if (draw.length) overlayArgs.push('-draw', draw.join(' '));
  overlayArgs.push(overlay);
  execFileSync('magick', overlayArgs);
  const panelPaths = [];
  for (const [i, file] of [input, overlay].entries()) {
    const panel = join(dir, `${c.id}-panel-${i}.png`);
    execFileSync('magick', [file, '-resize', '460x340', '-background', '#172536', '-gravity', 'center', '-extent', '480x360', panel]);
    panelPaths.push(panel);
  }
  const summary = error ? 'NO OUTLINE: ' + error.slice(0, 80) : `${record.contours} contours / ${record.circles} circles | ${width} x ${height} source pixels | ${elapsedMs} ms`;
  execFileSync('magick', [...panelPaths, '+append', '-background', '#0c1420', '-gravity', 'north', '-splice', '0x88',
    '-font', 'DejaVu-Sans', '-fill', '#f2f6fb', '-pointsize', '21', '-gravity', 'northwest', '-annotate', '+20+30', c.title,
    '-fill', '#aab8c8', '-pointsize', '13', '-annotate', '+20+57', summary,
    '-annotate', '+20+78', 'LEFT: source photo     RIGHT: current automatic result in cyan (no manual outline edits)', join(dir, `${c.id}-comparison.png`)]);
  report.push(record);
  console.log(JSON.stringify(record));
}
writeFileSync(join(dir, 'results.json'), JSON.stringify(report, null, 2));
writeFileSync(join(dir, 'SOURCES.md'), '# Real photo evaluation sources\n\nThese are camera photos, not generated examples. Crops are recorded below; controlled photo transformations are explicitly recorded, and no per-image extractor threshold tuning was applied. Counts alone do not establish contour accuracy. Inspection results are documented in REVIEW.md. These third-party photos are evaluation artifacts and are not part of the packaged application.\n\n' + report.map(c => `- **${c.title}**: [source](${c.url}). ${c.credit}. Crop: ${c.crop || 'none'}. Transform: ${JSON.stringify(c.transforms || [])}.`).join('\n'));
writeFileSync(join(dir, 'REVIEW.md'), '# Real photo evaluation\n\nFour distinct real part photographs were evaluated as 15 full-frame, crop, and controlled-variation cases. Variations are not additional independent photographs. This is a small qualitative evaluation, not a representative accuracy benchmark. The revised production extractor was run with default settings. Full-frame failures are retained. The UI now provides a crop and review step; no interactive crop is silently applied to these tests. No model was trained. Exposure, blur, rotation, resize and compression transformations are recorded per case. No extractor thresholds were tuned per image.\n\n**Result: nut topology corrected; screw false holes removed, but shadow remains. Washer crops remain rough drafts. Full scenes still need explicit part selection. These are not manufacturing-ready outlines.**\n\n| Case | Expected contours | Actual | Visual assessment |\n|---|---:|---:|---|\n' + report.map(c => `| ${c.title} | ${c.expectedContours} | ${c.contours} | **${c.assessment}**: ${c.review} |`).join('\n') + '\n\nExpected counts refer to the largest requested part: an outside outline plus each visible opening. Matching a count does not prove correct geometry. MVTec anomaly masks label defects rather than whole-part outlines, so they were not treated as ground-truth part masks. No dimensional accuracy or millimeter error is claimed: these photos provide no usable scale calibration, and the washer occupies roughly 24 source pixels.\n\nRemaining weaknesses: choosing the intended part in a busy scene, shadows, low source resolution, and small or irregular openings. Default filtering can omit real small or irregular holes; the review dialog includes a detailed-openings override. Original results are preserved in ../real-photos-before/.\n\nReproduce with `node tests/real-photo-cases.mjs` (requires curl and ImageMagick). See [SOURCES.md](SOURCES.md) for pinned source URLs and exact crop rectangles, [results.json](results.json) for machine-readable outputs, and each `*-geometry.json` for the actual geometry. Cropping is explicitly recorded; the full-frame failures are retained.\n');
execFileSync('magick', [...report.map(c => join(dir, `${c.id}-comparison.png`)), '-append', join(dir, 'all-real-photo-results.png')]);
execFileSync('magick', ['washer-crop', 'metal-nut', 'screw'].map(id => join(dir, `${id}-comparison.png`)).concat(['-append', join(dir, 'real-photo-highlights.png')]));

// Regression assertions for established supported cases. Full-frame scene and
// shadow failures remain explicit report entries rather than passing tests.
for (const c of report.filter(c => c.id === 'metal-nut' || c.id.startsWith('nut-'))) {
  assert.equal(c.contours, 2, c.id + ': outside and real opening');
  assert.equal(c.openingPositionMatches, true, c.id + ': opening position and approximate size');
}
for (const id of ['washer-crop', 'three-washers', 'workshop-washer-crop'])
  assert.equal(report.find(c => c.id === id).contours, 2, id + ': outside and opening');
assert.equal(report.find(c => c.id === 'screw').contours, 1, 'screw: no invented holes (shadow accuracy remains a known failure)');
console.log('PASS: real-photo topology regressions; unresolved silhouette/scene failures recorded in REVIEW.md');
