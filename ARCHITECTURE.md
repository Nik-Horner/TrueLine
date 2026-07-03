# Free Trace v3 — shared conventions

Browser 2D CAD for pen-tablet tracing. No frameworks, no build step, ES modules served statically.

## Files
- `index.html`, `style.css` — UI shell (dark, precision-instrument aesthetic)
- `js/app.js` — state, tools, input, rendering, UI wiring (main author)
- `js/geom.js` — pure geometry, no DOM (agent-built)
- `js/dxf.js` — DXF R12 writer + tolerant reader, no DOM (agent-built)
- `js/pdf.js` — minimal vector PDF writer, no DOM (agent-built)
- `tests/run-tests.mjs` — node harness; each module exports `selfTest() -> {pass, failures[]}`

## Coordinate system (critical, applies to ALL modules)
- World units are **true millimeters**, **Y grows DOWN** (screen-like) everywhere in memory.
- Angles in **radians**, measured with `Math.atan2(dy, dx)` in that Y-down frame.
- Arcs `{c:{x,y}, r, a0, a1}` sweep from `a0` to `a1` in the **increasing-angle** direction
  (visually clockwise on screen). Sweep size = `((a1 - a0) % 2π + 2π) % 2π`.
- Polyline vertices may carry `bulge` (DXF convention `tan(sweep/4)`) describing the arc from
  this vertex to the next. **Internal bulge sign uses the Y-down frame**: positive bulge bows
  to the left of the travel direction *in Y-down coords*. `dxf.js` owns the Y-flip: on
  write/read it negates Y and negates bulge/angles so files are standard Y-up DXF.
- `dxf.js` and `pdf.js` receive entities in mm and handle their own unit conversion
  (`opts.units: 'mm'|'in'` for DXF `$INSUNITS`; PDF converts mm→pt at 72/25.4).

## Entity model (plain JSON objects; `id` string, `layer` string layer-id)
```js
{ id, type:'line',   a:{x,y}, b:{x,y}, layer }
{ id, type:'circle', c:{x,y}, r, layer }
{ id, type:'arc',    c:{x,y}, r, a0, a1, layer }
{ id, type:'poly',   pts:[{x,y,bulge}], closed:boolean, layer }   // bulge optional, 0 = straight
{ id, type:'point',  p:{x,y}, layer }
{ id, type:'text',   p:{x,y}, text, h, rot, layer }               // h = text height mm, rot radians
```
Dimensions are stored semantically in app.js but are **decomposed to line/text entities before
being handed to dxf/pdf/svg writers** — writers never see a 'dim' type.

## Layer model
```js
{ id, name, color:'#rrggbb', visible:true, locked:false }
```
`dxf.js` maps hex color → nearest ACI code for group 62 and back on import.

## Module signatures
```js
// geom.js — every fn pure, returns fresh objects
// dxf.js
export function writeDXF(entities, layers, opts /*{units}*/) -> string
export function readDXF(text) -> { entities, layers, warnings: string[] }   // never throws on bad input
// pdf.js
export function writePDF(pages /*[{widthMM,heightMM,paths:[{ops,strokeRGB,widthMM}],texts:[{xMM,yMM,text,sizeMM}]}]*/) -> Uint8Array
```
