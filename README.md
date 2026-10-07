# TrueLine

**Trace physical objects with a pen tablet and export dimensionally-accurate DXF / SVG / PDF.**
A free, open-source, offline desktop alternative to the $1,500 Logic Trace digitizing system —
for CNC, CAD, and pattern making.

![TrueLine tracing a rough shape into a clean one](assets/demo.gif)

Sketch a rough circle and it becomes a perfect one. Trace an outline and it snaps to clean
lines, arcs, and smooth curves — then exports as true-to-size DXF your CAM software reads
directly.

### [⬇ Download TrueLine for Windows](https://github.com/Nik-Horner/TrueLine/releases/latest/download/TrueLine-Setup.exe)

[![Download TrueLine for Windows](https://img.shields.io/badge/⬇%20Download-TrueLine%20for%20Windows-2ea44f?style=for-the-badge)](https://github.com/Nik-Horner/TrueLine/releases/latest/download/TrueLine-Setup.exe)
&nbsp;
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg?style=for-the-badge)](LICENSE)

That button downloads the installer directly and always points at the newest version. Run it —
no account, no internet, no license.

> First launch, Windows SmartScreen may show a blue "Windows protected your PC" box because the
> app isn't code-signed with a paid certificate. Click **More info → Run anyway**. That's normal
> for free/indie apps — it's not a virus warning, just an unrecognized publisher.

The app **updates itself**: when a new release is published here, installed copies download it in
the background and install it on the next launch.

---

## What it does

![TrueLine — a dimensioned CAD part](assets/hero.png)

Lay a part, template, or pattern on your tablet (or import a photo), trace the outline with the
pen, clean it up, set the scale from one known measurement, and export. The traced geometry
becomes real millimeters, so the DXF drops straight into Fusion, AutoCAD, LibreCAD, plasma/laser
CAM, or apparel software.

### Tracing that snaps to shapes

![Rough strokes fitted to clean geometry](assets/gallery.png)

Draw rough; get clean. Circles snap to perfect circles, arcs to arcs, straight edges to straight
lines, and freeform curves become smooth tangent-continuous arc chains — not jagged facets.
Prefer a faithful smooth outline? Switch the trace mode to **Raw** for a tremor-cleaned polyline.

### Real parts, real dimensions

![Engineering parts drawn in TrueLine — bracket, flange, slotted plate, lever, gasket, hex spacer](assets/examples.png)

Brackets, flanges, gaskets, slots, bolt circles, hex profiles — traced or drawn with holes,
fillets, arcs, and dimensions, exported as true-scale DXF for the shop.

## Features

- **Draw:** line, polyline, rectangle, circle (center-R / 2-point / **3-point**), arc
  (**3-point** / center-start-end), point, text, freehand **trace** with shape-fitting.
- **Modify:** move, copy, rotate, scale (incl. scale-by-reference), mirror, trim, extend, offset,
  fillet, chamfer, grip editing.
- **Measure & annotate:** distance, angle, area & perimeter; linear / aligned / radial dimensions.
- **Snapping:** endpoint, midpoint, center, quadrant, intersection, perpendicular; ortho, polar, grid.
- **Layers** with color, line type, lock, and hide. **Units** mm / cm / inch with precision.
- **Pen-tablet first:** set true scale from any known dimension, bind the pen barrel button and
  tablet express keys, touch pinch-zoom/pan.
- **Editable hotkeys** — rebind any tool to a keyboard key *or* a tablet pad button.
- **Files:** DXF R12 out *and* in, SVG (true mm), 1:1-scale PDF, native project save/load, autosave.

## Setting the scale (calibration)

The reliable way, and the default: **trace at any size, then click 📏 Set scale, click across one
feature you measured, and type its real size.** The whole drawing snaps to true scale and the DXF
exports dimensionally accurate. It works with any tablet because it depends on a real measurement,
not on the tablet's pixel mapping.

## Tracing and assembly workflows

The **Tracing** menu contains the new workflows. **Tracing mode** (Tab when the
canvas has focus) hides the dock and palette and expands the drawing area. Its
floating controls provide pan, trace, undo, trace acceptance, and assembly access.
Space-drag / middle-drag still pan, and the wheel zooms without changing dimensions.
Bind **Finish / accept trace** to a pen barrel button or tablet express key in the
Tablet panel.

### Review the fitted outline

Tracing now previews the original stroke in orange and its fitted outline in cyan.
Adjust tolerance, corner detection, or Fit/Raw before committing. The options show
maximum and RMS distance from the sampled original stroke to the fitted geometry,
in millimeters. **Enter / Accept** commits; **Esc / Discard** removes the preview.
Turn off **Review** for immediate stroke acceptance. Preview geometry is not part
of an export or saved project until accepted.

### Assemble complex parts from separate pieces

1. Trace the first portion and identify three well-spaced shared marks on the part.
2. Choose **Tracing → Trace assembly piece**. Name the piece and pick the shared
   marks in the existing drawing. Two marks are optional, with less verification.
3. Reposition the physical part, then trace the new portion and its shared marks.
   New geometry on the piece's layer is captured as an independent piece.
4. Choose **Assemble active piece** and pick the same marks on the new piece, in
   the same order. Review the placement preview and reference error. Placement is
   blocked if the maximum error exceeds the current tracing tolerance.
5. Accept placement. The piece stays on its own layer and keeps its dimensions.
   **Assembly pieces** lets you select a placed piece or reassemble it later.

Alignment applies only translation and rotation: it never stretches a piece to
hide a mismatch. Connections and overlapping edges remain explicit. Trim overlap,
check the contours, and join only when the fit is satisfactory. Recheck dimensions
across the assembled part with an independent measurement; reference error is a
consistency check, not a guarantee of physical accuracy. Assembly metadata and
unfinished pieces are saved with the project, and placement can be undone.

### Set up a photo

Import an image underlay, then use **Rotate image**, **Correct photo perspective**,
and **Calibrate photo measurements** from the Tracing menu.

Perspective correction needs a known rectangle on the same flat plane as the part.
Pick top-left, top-right, bottom-right, and bottom-left, then enter real width and
height in millimeters. The corrected image covers that rectangle, so the whole
part must lie inside it. Rectification preserves aspect ratio at a maximum of
2048 pixels on either side; it cannot correct lens distortion or a non-flat part.
Undo restores the original image.

Photo calibration combines at least two known lengths using a uniform least-squares
scale and reports the RMS measurement error. It resizes only the image; existing
geometry retains its dimensions. Use features at different positions and verify
an additional length before tracing.

### Check and join outlines

**Check contours** reports gaps within 0.5 mm, open endpoints, duplicate edges,
zero-length edges, branches, and intersections, including within polylines. Select an issue
to locate it, or show all problem marks. Checks use selected geometry or visible
geometry; the pre-export review covers all exported entities, including hidden
layers. Open paths may be intentional for engraving or annotation.

**Join contours** combines unbranched lines, arcs, and polylines. Its adjustable
millimeter tolerance determines which gaps receive explicit straight connectors;
existing arcs are preserved. Branches need manual repair. Joining stays within
layers unless you explicitly choose to join across layers onto the current layer.
The summary shows how many connectors will be added, and joins can be undone.

### Save files and recover work

Desktop **Save project** opens a native save dialog and clears the unsaved indicator
only after the file is successfully written. Canceling or a write failure leaves
the drawing unsaved. Browser previews start a download and keep the indicator
because browsers cannot confirm whether a download completed.

Autosave creates device-local recovery backups independently of project-file saves.
**Recovery history** lists up to 12 recent revisions, with a 64 MiB history budget
(the latest revision is always retained). IndexedDB supports image-heavy projects
that exceed localStorage's quota; localStorage keeps an additional latest-copy
fallback where possible. Restoring a revision marks the drawing unsaved. Save a
project file to preserve it outside this device. Desktop launches use a stable
local origin so recovery and tablet settings survive restarts.

## Build from source

Requires [Node.js](https://nodejs.org) 18+.

```bash
npm install
npm start            # run the app
npm run installer    # build dist-installer/TrueLine-Setup-<version>.exe
npm run pack         # or a portable folder in dist/
```

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
gh release create v3.0.3 dist-installer/TrueLine-Setup.exe dist-installer/latest.yml \
  dist-installer/TrueLine-Setup.exe.blockmap --title "TrueLine 3.0.3" --notes "..."
```

Installed apps pick it up automatically on next launch, and the download button above always
points at the newest installer (the filename never changes).

## Roadmap / deliberately not in v1

DWG, 3D, parametric constraints, blocks round-trip, hatch/fill, and CAM/G-code — DXF hand-off is
the boundary. Ellipse and spline are imported (tessellated) but not yet drawn natively;
fillet/chamfer operate on lines.

## License & credits

TrueLine is [MIT licensed](LICENSE). Bundled fonts (Chakra Petch, IBM Plex Mono) are under the
SIL Open Font License — see [`fonts/OFL.txt`](fonts/OFL.txt). Built with
[Electron](https://www.electronjs.org/). DXF and PDF are open specifications.

Independent project — not affiliated with, endorsed by, or derived from "Logic Trace" or The
Logic Group; that product is named only for factual comparison.
