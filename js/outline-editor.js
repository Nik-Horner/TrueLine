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
  const dx = b.x - a.x, dy = b.y - a.y;
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy || 1)));
  const point = { x: a.x + t * dx, y: a.y + t * dy };
  return { point, distance: Math.hypot(p.x - point.x, p.y - point.y) };
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
    const p = e.pts;
    if (!Array.isArray(p)||p.length < 3 || p.some(v => !v||![v.x,v.y].every(Number.isFinite))) return issue('An outline needs at least three valid points.');
    if(p.length>10000)return issue('Too many points to review safely. Crop closer around the part and trace again.');
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
