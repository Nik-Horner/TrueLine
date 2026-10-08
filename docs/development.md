# Development

[Back to TrueLine](../README.md)

## Build from source

Requires [Node.js](https://nodejs.org) 22.12+ (Node 24 recommended).

```bash
npm install
npm start            # run the app
npm run installer -- --publish never # build Windows installer without publishing
npm run pack         # or a portable folder in dist/
```

## macOS

macOS 12 or later is required. `npm run pack:mac` builds separate Apple Silicon (arm64) and Intel (x64) `.app`
bundles under `dist/`. Run `npm run installer:mac` on a Mac to create DMG and ZIP
previews with verified local ad-hoc signatures. These signatures keep the repackaged
Electron executables consistent; they do not establish Apple Gatekeeper approval.
For public distribution, configure Apple Developer ID signing and notarization
credentials and run `electron-builder --mac --arm64 --x64 --publish never` directly,
without the preview script's signing overrides.

The Desktop Builds workflow checks PRs on Windows, Apple Silicon Mac and Intel Mac
without publishing. `npm run test:mac:package` mounts the native architecture's DMG,
copies the app out, verifies its signature and launches it to test Command shortcuts
and drawing/export workflows. Mac auto-update requires signed release artifacts and
the corresponding `latest-mac.yml` update metadata.

Mac menus and help use Command shortcuts, with Command+Shift+Z for redo.
Two-finger trackpad scrolling pans the drawing and outline editor; pinch or
Command+scroll zooms. Canvas rendering respects Retina display scaling. Closing
all windows keeps the app running; clicking the Dock icon opens a fresh window.
Save uses the native system dialog.

`npm run test:mac` checks lifecycle/menu wiring plus simulated Mac shortcuts and
Retina/trackpad behavior in Chromium (`CHROME_BIN` selects your browser). These
cross-platform checks complement native Mac testing.

## Tests

```bash
npm test             # geometry, exports, workflows, native-save tests (no app needed)
node tests/trace-sweep.mjs      # 96-case tracing sweep (fidelity + entity count)
npm run test:app     # full app suite against a running app on CDP :9223
npm run test:upgrades # standalone Chromium workflow suite (set CHROME_BIN if needed)
```

## Publishing an update

1. Bump `"version"` in `package.json`.
2. `npm run installer`
3. Create a GitHub release for the new tag and attach the three files from `dist-installer/`:
   `TrueLine-Setup.exe`, `latest.yml`, and `TrueLine-Setup.exe.blockmap`.

```bash
gh release create v3.1.0 dist-installer/TrueLine-Setup.exe dist-installer/latest.yml \
  dist-installer/TrueLine-Setup.exe.blockmap --title "TrueLine 3.1.0" --notes "..."
```

Installed apps pick it up automatically on next launch, and the Windows download button in the README always
points at the newest installer (the filename never changes).

## Auto-trace evaluation

Auto-trace coverage: `npm test` includes 39 extraction edge-case checks. Use
`npm run test:autotrace:ui` for Chromium upload, crop, acceptance and responsive-layout checks;
`npm run test:autotrace:edit` for correction controls, edit history, zoom/pan, new openings,
coordinate mapping, cancellation and invalid-contour guards;
`npm run test:autotrace:photos` for the original 15 real-photo evaluations;
`npm run test:autotrace:complex` adds six complex-part cases and a screw retest, including
97 foam apertures, shaded-region probes, an independently annotated screw silhouette,
steel boundary-distance checks, all 25 unobscured plate openings, and five screw
rotation/exposure/blur/compression variations;
and `npm run test:autotrace:report` to render their results. UI checks need Chromium; the photo
suite needs curl and ImageMagick. Amber preview edges indicate weak image evidence;
brightness-only openings may be surface markings or obstructions. Passing these checks does
not establish dimensional accuracy, and hidden edges cannot be verified from one photograph.


Automatic tracing checks weak boundaries against a second image scale to reduce shadow
and texture capture. Small neutral highlights need stronger background evidence before
becoming openings; aperture expansion scales down for smaller photos.
`npm run test:autotrace:resolution` checks 29 resize cases from five existing
photographs, including annotated screw and bracket silhouettes, both bracket hole
locations, every foam opening location, and the white plate's 25 annotated openings.
Small breaks in a dark rim are closed before filling its face. Interior dark holes
are preserved independently of that rim. Shadowed openings in dark perforated parts
can seed from substantial bright interior patches; small texture patches are rejected.
The previously failing small bracket and irregular gasket now pass these checks.
These results do not establish dimensional accuracy or general reliability.

### Trained outline detection

Auto-trace now runs the bundled **MobileSAM** model locally in its preview worker.
An initial edge proposal guides semantic segmentation; alternative model regions
recover parts when that proposal selects the table. The learned material region
then guides source-resolution color and opening extraction. Neural mask scores
are not presented as probabilities of outline correctness. Weak image evidence
remains amber, and a model that would lose thin material around known apertures
is rejected in favor of source-derived edges. Simple raster circles and clean
line art keep exact image edges rather than neural approximations.

The model and ONNX Runtime Web are bundled: **no photo uploads, account, Python,
or inference server are required**. The runtime and model add about 55 MiB to
the app. Loading and processing are cancellable; results remain preview-only
until **Add outline**. Missing model assets produce an error instead of a
silently substituted result. CPU inference in the browser benchmark takes
roughly 5–9 seconds per part. The model has not been fine-tuned on these parts.

`npm run prepare:photos` downloads pinned evaluation photographs and creates their
recorded crops locally (curl and ImageMagick 7 are required). Generated photos and
reports are git-ignored and never redistributed in app packages. Model test scripts
prepare missing inputs automatically.

`npm run test:autotrace:model` executes 11 real-photo cases in Chromium and checks
six manually annotated silhouettes, all 97 foam apertures, 25 annotated visible
plate openings, bracket hole locations and the added carrier views' main cutouts.
The benchmark uses four additional photographed carrier views, not four new
part categories. Both foam crops come from one photograph. Reference annotations
are evaluation-only and never enter inference. Results and all source/previous/
trained comparisons are in `test-artifacts/model-evaluation/report.html`.

`npm run test:autotrace:model:ui` exercises actual model-worker cancellation,
local-only processing, preview edits, transformed coordinates, document undo,
locked layers and missing-model failure. `npm run verify:models` verifies bundled
model checksums before packaging. `npm run test:autotrace:model:report` renders
the browser evaluation report. The existing extraction and editing checks remain
available through `npm test`, `test:autotrace:ui`, and `test:autotrace:edit`.

Model license, upstream checkpoint hash and exported ONNX hashes are in
`models/mobile-sam/`. ONNX Runtime's license and third-party notices are in
`js/vendor/onnx/`. Evaluation photos and Python model tools are excluded from
packaged applications. Developers can reproduce ONNX export using
`tools/model-eval/export.py` with the upstream MobileSAM source and the checkpoint
whose SHA-256 is recorded in `models/mobile-sam/manifest.json`.

Model outlines now retain interpolated, fractional-pixel mask boundaries rather
than tracing a binary pixel staircase. For material with a distinct color, a
small additional pass selects a nearby boundary from the observed hue transition;
it limits movement to two source pixels and skips neutral material where shadows
cannot be distinguished by hue. This improves path quality and some boundaries;
it does not establish exact physical dimensions or recover invisible features.

`npm run test:autotrace:model:threads` compares actual ONNX inference before and
after this change on the screw and five rotation, lighting, blur and compression
perturbations. These are six cases from one capture. The test checks CAD validity,
preserved silhouette accuracy within half a percentage point, no invented holes,
and fewer staircase vertices. `npm test` also checks continuous contour precision,
openings and ambiguous saddle topology against known synthetic fields.
