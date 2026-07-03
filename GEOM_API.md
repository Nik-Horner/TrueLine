# geom.js public API (contract — app.js is written against exactly this)

Frame: mm, **Y-down**, angles = `Math.atan2(dy,dx)` in that frame, arcs `{c:{x,y}, r, a0, a1}`
always sweep from a0 to a1 in the **increasing-angle** direction. No CCW flag exists.
Entities per ARCHITECTURE.md. All functions pure; never mutate inputs; return fresh objects.
Entity params other than geometry (id, layer, etc.) must be preserved on returned entities
(spread the input, override geometry).

```js
export const TAU;
export const EPS;                                   // 1e-9
export function sweep(a0, a1);                      // (a1-a0) mod TAU in [0,TAU)
export function norm(a);                            // angle into [0,TAU)
export function angOnArc(arc, ang);                 // ang within arc sweep (inclusive, EPS slack)
export function dist(a, b);
export function rotatePt(p, center, ang);           // fresh {x,y}

// rigid/affine ops — handle every entity type incl. text/point; arcs get correct
// angle updates; mirror renormalizes arcs to increasing-angle form and flips bulges
export function translateEnt(e, dx, dy);
export function rotateEnt(e, center, ang);
export function scaleEnt(e, center, f);             // uniform only
export function mirrorEnt(e, p1, p2);               // reflect across line p1-p2

export function entBounds(e);                       // {minX,minY,maxX,maxY}; arcs exact-ish (sampled 32)
export function entityLength(e);                    // perimeter for closed poly/circle
export function closestPointOnEntity(e, p);         // {p:{x,y}, d, t}  t in [0,1] (circle/arc: angle-fraction)
export function polyAreaPerimeter(e);               // {area, perimeter} shoelace + bulge segment corrections

export function lineLine(a1, a2, b1, b2, ext1, ext2);    // {p,t,u}|null  ext flags allow t/u outside [0,1]
export function intersectEntities(e1, e2, ext1, ext2);   // [{p, t1, t2}] (poly handled per-segment)

export function bulgeToArc(p1, p2, b);              // arc {c,r,a0,a1} in our frame (b!=0)
export function arcToBulgeSegs(arc);                // [{p1,p2,b}] — splits sweep >= PI into 2
export function polyToSegments(e);                  // explode -> [line|arc entities] (fresh ids not required)
export function segmentsToPoly(segs);               // inverse where chainable; else null

export function circleFrom3(p1, p2, p3);            // {c,r}|null
export function arcFrom3(p1, p2, p3);               // {c,r,a0,a1}|null — passes through p2
export function arcFromCenterStartEnd(c, pStart, pEnd, throughPt); // pick direction so arc passes nearer throughPt side; returns arc
export function pointInPoly(p, pts /*[{x,y}]*/);

export function offsetEntity(e, d);                 // line/arc/circle/poly; +d = toward normal n=(-dy,dx)/L
                                                    // of travel; arcs: r-d rule per that side; null if degenerate
export function offsetPolyTowards(e, throughPt, d); // convenience: picks sign so result lies on throughPt side
export function filletSegments(e1, pick1, e2, pick2, r);   // lines only in v1 -> {arc, e1: trimmed, e2: trimmed} | {error:string}
export function chamferSegments(e1, pick1, e2, pick2, d1, d2); // {line, e1, e2} | {error}
export function trimEntity(target, cutters, pickPt);       // [replacements] (0..2 entities) | null if no cut
export function extendEntity(target, boundaries, pickPt);  // replacement | null

export function rdp(pts /*[{x,y}]*/, eps);
export function fitStroke(rawPts /*[{x,y}]*/, opts /*{tol, cornerDeg, minArcSweepDeg, closeTol}*/);
        // -> entity array: lines/arcs merged per spec D.10; if closable & chainable, ONE closed
        //    poly with bulges; tolerances in mm

export function gripPoints(e);                      // [{p:{x,y}, kind:'end'|'mid'|'center'|'radius'|'vertex', index}]
export function setGrip(e, grip, newPt);            // fresh entity with that grip moved (mid/center = translate)

export function selfTest();                         // {pass, failures:[]}
```
