import {bulgeToArc, closestPointOnEntity} from './geom.js';

// Preview-only edits. The drawing is changed once, when the user adds the result.
const copy = value => structuredClone(value);
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

export function createOutlineEditor(entities) {
  const original = copy(entities);
  let current = copy(original), history = [copy(original)], cursor = 0, pending = null;
  return {
    get entities() { return current; },
    get dirty() { return !same(current, original); },
    get canUndo() { return cursor > 0; },
    get canRedo() { return cursor < history.length - 1; },
    begin() { if (!pending) pending = copy(current); },
    commit() {
      if (!pending) return;
      if (!same(pending, current)) {
        history = history.slice(0, cursor + 1); history.push(copy(current));
        if (history.length > 60) history.shift();
        cursor = history.length - 1;
      }
      pending = null;
    },
    cancel() { if (pending) current = pending; pending = null; },
    undo() { this.cancel(); if (this.canUndo) current = copy(history[--cursor]); },
    redo() { this.cancel(); if (this.canRedo) current = copy(history[++cursor]); },
    reset() { this.begin(); current = copy(original); this.commit(); },
  };
}

export function circlePoints(circle) {
  return Array.from({ length: 48 }, (_, i) => ({
    x: circle.c.x + circle.r * Math.cos(i * Math.PI / 24),
    y: circle.c.y + circle.r * Math.sin(i * Math.PI / 24),
  }));
}

export function closestOnSegment(p, a, b) {
  const arc = a.bulge && bulgeToArc(a, b, a.bulge);
  const hit = closestPointOnEntity(arc ? {type:'arc', ...arc} : {type:'line', a, b}, p);
  return {point:hit.p, distance:hit.d};
}

// Sample only for validation and stretched images; CAD output keeps exact arcs.
export function outlinePoints(entity, error = .1) {
  return entity.pts.flatMap((a, i) => {
    const b = entity.pts[(i + 1) % entity.pts.length];
    const arc = a.bulge && bulgeToArc(a, b, a.bulge);
    if (!arc) return [{x:a.x, y:a.y}];
    const turn = 4 * Math.atan(a.bulge), start = Math.atan2(a.y-arc.c.y, a.x-arc.c.x);
    const step = Math.max(.001, 2 * Math.acos(Math.max(-1, 1-error/arc.r)));
    const count = Math.ceil(Math.abs(turn)/step);
    return Array.from({length:count}, (_, j) => ({
      x:arc.c.x+arc.r*Math.cos(start+turn*j/count),
      y:arc.c.y+arc.r*Math.sin(start+turn*j/count),
    }));
  });
}

export function splitOutlineSegment(entity, index, point) {
  const a=entity.pts[index], b=entity.pts[(index+1)%entity.pts.length];
  const arc=a.bulge && bulgeToArc(a,b,a.bulge);
  let next={...point};
  if(arc){
    const turn=4*Math.atan(a.bulge), start=Math.atan2(a.y-arc.c.y,a.x-arc.c.x);
    const angle=Math.atan2(point.y-arc.c.y,point.x-arc.c.x);
    const part=((Math.sign(turn)*(angle-start)%(2*Math.PI))+2*Math.PI)%(2*Math.PI)*Math.sign(turn);
    a.bulge=Math.tan(part/4);next.bulge=Math.tan((turn-part)/4);
  }
  entity.pts.splice(index+1,0,next);
}

export function outlineIssue(entities) {
  if (!Array.isArray(entities)||!entities.length) return 'Keep at least one outline, or undo the removal.';
  const cross = (a, b, c) => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
  const on = (a, b, c) => Math.abs(cross(a, b, c)) < 1e-8 && c.x >= Math.min(a.x, b.x) - 1e-8 && c.x <= Math.max(a.x, b.x) + 1e-8 && c.y >= Math.min(a.y, b.y) - 1e-8 && c.y <= Math.max(a.y, b.y) + 1e-8;
  for (const [index,e] of entities.entries()) {
    const issue=text=>`Outline ${index+1}: ${text}`;
    if(!e||!['circle','poly'].includes(e.type))return issue('The outline has an unsupported shape.');
    if (e.type === 'circle') {
      if (!e.c||![e.c.x,e.c.y,e.r].every(Number.isFinite) || e.r < .5) return issue('Give the circle a radius of at least half a pixel.');
      continue;
    }
    let p = e.pts;
    if (!Array.isArray(p)||p.length < 3 || p.some(v => !v||![v.x,v.y,v.bulge??0].every(Number.isFinite))) return issue('An outline needs at least three valid points.');
    if(p.length>10000)return issue('Too many points to review safely. Crop closer around the part and trace again.');
    if(p.some(v=>v.bulge)){p=outlinePoints(e);if(p.length>10000)return issue('Too much curve detail to review safely.');}
    if(e.closed!==true)return issue('Close the outline before adding it.');
    if(p.some((a,i)=>{const b=p[(i+1)%p.length];return Math.hypot(a.x-b.x,a.y-b.y)<1e-7;}))return issue('Two points overlap. Move or remove one of them.');
    let area = 0;
    for (let i = 0; i < p.length; i++) {
      const a = p[i], b = p[(i + 1) % p.length];
      if (Math.hypot(a.x - b.x, a.y - b.y) < 1e-7) return issue('Two points overlap. Move or remove one of them.');
      area += a.x * b.y - b.x * a.y;
      for (let j = i + 2; j < p.length; j++) {
        if (i === 0 && j === p.length - 1) continue;
        const c = p[j], d = p[(j + 1) % p.length];
        if ((cross(a,b,c) * cross(a,b,d) < 0 && cross(c,d,a) * cross(c,d,b) < 0) || on(a,b,c) || on(a,b,d) || on(c,d,a) || on(c,d,b))
          return issue('The outline crosses itself. Adjust the points or undo the edit.');
      }
    }
    if (Math.abs(area) < .5) return issue('The outline is too small or flat. Adjust its points.');
  }
  return '';
}
