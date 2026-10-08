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

// Fit a robust background plane to the image margin. This accounts for
// illumination gradients without learning foreground colors from the part.
function backgroundModel(width, height, rgba) {
  const base = borderColor(width, height, rgba), samples = [];
  const step = Math.max(1, Math.floor(Math.min(width,height) / 180));
  const take = (x,y) => {
    const i=(y*width+x)*4;if(rgba[i+3]<32)return;
    samples.push({u:2*x/(width-1)-1,v:2*y/(height-1)-1,c:[rgba[i],rgba[i+1],rgba[i+2]]});
  };
  // Sample just inside the border to avoid one-pixel collage frames.
  const inset = Math.min(3, Math.max(1, Math.floor(Math.min(width,height)*.008)));
  for(let x=inset;x<width-inset;x+=step){take(x,inset);take(x,height-1-inset);}
  for(let y=inset;y<height-inset;y+=step){take(inset,y);take(width-1-inset,y);}
  let coefficients=base.map(c=>[c,0,0]);
  const predict=(u,v)=>coefficients.map(c=>clamp(c[0]+c[1]*u+c[2]*v,0,255));
  const solve=(a,b)=>{
    const m=a.map((row,i)=>[...row,b[i]]);
    for(let i=0;i<3;i++){
      let pivot=i;for(let j=i+1;j<3;j++)if(Math.abs(m[j][i])>Math.abs(m[pivot][i]))pivot=j;
      [m[i],m[pivot]]=[m[pivot],m[i]];if(Math.abs(m[i][i])<1e-8)return null;
      const d=m[i][i];for(let k=i;k<4;k++)m[i][k]/=d;
      for(let j=0;j<3;j++)if(j!==i){const f=m[j][i];for(let k=i;k<4;k++)m[j][k]-=f*m[i][k];}
    }return m.map(row=>row[3]);
  };
  for(let iteration=0;iteration<5&&samples.length>=12;iteration++){
    const residuals=samples.map(p=>{const c=predict(p.u,p.v);return Math.hypot(...p.c.map((v,i)=>v-c[i]));});
    const limit=Math.max(8,median(residuals.slice())*1.8),a=Array.from({length:3},()=>[0,0,0]),b=Array.from({length:3},()=>[0,0,0]);
    samples.forEach((p,i)=>{
      const w=Math.min(1,(limit/Math.max(limit,residuals[i]))**4),v=[1,p.u,p.v];
      for(let j=0;j<3;j++)for(let k=0;k<3;k++)a[j][k]+=w*v[j]*v[k];
      for(let c=0;c<3;c++)for(let j=0;j<3;j++)b[c][j]+=w*p.c[c]*v[j];
    });
    const next=b.map(v=>solve(a,v));if(next.every(Boolean))coefficients=next;
  }
  const errors=samples.map(p=>{const c=predict(p.u,p.v);return Math.sqrt(.299*(p.c[0]-c[0])**2+.587*(p.c[1]-c[1])**2+.114*(p.c[2]-c[2])**2);}).sort((a,b)=>a-b);
  return {at:(x,y)=>predict(2*x/(width-1)-1,2*y/(height-1)-1),noise:errors[Math.floor(errors.length*.7)]||0};
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

// Move threshold boundaries onto nearby image edges. The material-facing
// normal also expands openings out of the bright patch left by cast shadow.
function refineEdges(points,width,height,rgba,hole=false) {
  const bounds=points.reduce((b,p)=>({minX:Math.min(b.minX,p.x),maxX:Math.max(b.maxX,p.x),minY:Math.min(b.minY,p.y),maxY:Math.max(b.maxY,p.y)}),{minX:width,minY:height,maxX:0,maxY:0});
  if(Math.min(bounds.maxX-bounds.minX,bounds.maxY-bounds.minY)<(hole?20:4))return points;
  const dense=[];
  for(let i=0;i<points.length;i++){
    const a=points[i],b=points[(i+1)%points.length],steps=Math.max(1,Math.ceil(Math.hypot(b.x-a.x,b.y-a.y)/2));
    for(let j=0;j<steps;j++)dense.push({x:a.x+(b.x-a.x)*j/steps,y:a.y+(b.y-a.y)*j/steps});
  }
  const gray=(x,y)=>{
    x=clamp(x-.5,0,width-1);y=clamp(y-.5,0,height-1);
    const ix=Math.floor(x),iy=Math.floor(y),fx=x-ix,fy=y-iy;
    const val=(xx,yy)=>{const i=(yy*width+xx)*4;return .299*rgba[i]+.587*rgba[i+1]+.114*rgba[i+2];};
    return (val(ix,iy)*(1-fx)+val(Math.min(width-1,ix+1),iy)*fx)*(1-fy)+(val(ix,Math.min(height-1,iy+1))*(1-fx)+val(Math.min(width-1,ix+1),Math.min(height-1,iy+1))*fx)*fy;
  };
  const states=Array.from({length:19},(_,i)=>i-4),count=states.length,zero=4,normals=[],costs=[];
  for(let i=0;i<dense.length;i++){
    const p=dense[i],a=dense[(i-2+dense.length)%dense.length],b=dense[(i+2)%dense.length],len=Math.hypot(b.x-a.x,b.y-a.y)||1;
    const nx=-(b.y-a.y)/len,ny=(b.x-a.x)/len;normals.push({x:nx,y:ny});
    const strength=t=>Math.abs(gray(p.x+nx*(t+1),p.y+ny*(t+1))-gray(p.x+nx*(t-1),p.y+ny*(t-1)))/2;
    const original=strength(0);
    costs.push(states.map(t=>!hole&&original>25&&t!==0?1e6:-Math.min(40,strength(t))/(1+Math.abs(t)*(hole?.03:.1))+Math.abs(t)*.08));
  }
  // A closed-chain dynamic program keeps neighboring displacements coherent,
  // rather than letting each point jump to an unrelated texture edge.
  let previous=new Float64Array(count).fill(1e6);previous[zero]=costs[0][zero];
  const links=new Int8Array(dense.length*count);
  for(let i=1;i<dense.length;i++){
    const next=new Float64Array(count).fill(1e6);
    for(let k=0;k<count;k++)for(let j=Math.max(0,k-3);j<=Math.min(count-1,k+3);j++){
      const candidate=previous[j]+costs[i][k]+.65*(states[k]-states[j])**2;
      if(candidate<next[k]){next[k]=candidate;links[i*count+k]=j;}
    }
    previous=next;
  }
  let state=zero,best=Infinity;
  for(let k=0;k<count;k++){const score=previous[k]+.65*states[k]**2;if(score<best){best=score;state=k;}}
  const shifts=new Int8Array(dense.length);
  for(let i=dense.length-1;i>=0;i--){shifts[i]=states[state];state=links[i*count+state];}
  if(shifts.every(v=>v===0))return points;
  const refined=dense.map((p,i)=>({x:clamp(p.x+normals[i].x*shifts[i],1,width-1),y:clamp(p.y+normals[i].y*shifts[i],1,height-1)}));
  let simplified=simplifyClosed(refined,.65);
  if(Math.sign(signedArea(simplified))!==Math.sign(signedArea(points)))return points;
  const orientation=(a,b,c)=>(b.x-a.x)*(c.y-a.y)-(b.y-a.y)*(c.x-a.x);
  // Remove only the small loops introduced by displaced neighboring edges.
  // Keeping the larger arc preserves the silhouette and its winding.
  for(let pass=0;pass<100;pass++){
    let crossing=false;
    outer:for(let i=0;i<simplified.length;i++)for(let j=i+2;j<simplified.length;j++){
      if(i===0&&j===simplified.length-1)continue;
      const a=simplified[i],b=simplified[(i+1)%simplified.length],c=simplified[j],d=simplified[(j+1)%simplified.length];
      if(orientation(a,b,c)*orientation(a,b,d)<-1e-8&&orientation(c,d,a)*orientation(c,d,b)<-1e-8){
        const rx=b.x-a.x,ry=b.y-a.y,sx=d.x-c.x,sy=d.y-c.y,t=((c.x-a.x)*sy-(c.y-a.y)*sx)/(rx*sy-ry*sx);
        const hit={x:a.x+t*rx,y:a.y+t*ry},one=[hit,...simplified.slice(i+1,j+1)],two=[hit,...simplified.slice(j+1),...simplified.slice(0,i+1)];
        simplified=Math.abs(signedArea(one))>Math.abs(signedArea(two))?one:two;crossing=true;break outer;
      }
    }
    if(!crossing)return simplified;
  }
  return points;
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
  const model = backgroundModel(width, height, rgba), n = width * height, distances = new Uint8Array(n), hist = new Uint32Array(256);
  for (let i = 0; i < n; i++) {
    const bg = model.at(i % width, (i / width) | 0);
    const j = i * 4, alpha = rgba[j + 3] / 255;
    const dr = rgba[j] * alpha + bg[0] * (1 - alpha) - bg[0];
    const dg = rgba[j + 1] * alpha + bg[1] * (1 - alpha) - bg[1];
    const db = rgba[j + 2] * alpha + bg[2] * (1 - alpha) - bg[2];
    const d = Math.min(255, Math.round(Math.sqrt(0.299 * dr * dr + 0.587 * dg * dg + 0.114 * db * db)));
    distances[i] = d; hist[d]++;
  }
  const automatic = otsu(hist, n), baseThreshold = Math.max(10, Math.round(model.noise * 1.6), Math.round(automatic * (options.sensitivity ?? .35)));
  let threshold = baseThreshold, component = null, bestScore = -1, boundaryStrength = 0;
  // A low threshold can join the part to a textured background. Evaluate
  // several levels and prefer substantial isolated regions with real edges.
  const levels = [...new Set([1,1.5,2,3,4,5].map(f=>Math.min(250,Math.round(baseThreshold*f))))];
  for (const level of levels) {
    let mask = new Uint8Array(n);
    for (let i = 0; i < n; i++) mask[i] = distances[i] > level ? 1 : 0;
    mask = denoiseMask(mask, width, height, options.keepSmallHoles);
    const candidate = largestInteriorComponent(mask, width, height);
    if (!candidate || candidate.pixels < Math.max(20,n*.00008) || candidate.pixels > n*.97) continue;
    let edgeSum=0,edgeCount=0;
    for(let y=1;y<height-1;y++)for(let x=1;x<width-1;x++){
      const i=y*width+x;if(!candidate.mask[i])continue;
      if(candidate.mask[i-1]&&candidate.mask[i+1]&&candidate.mask[i-width]&&candidate.mask[i+width])continue;
      const gx=(distances[i+1]-distances[i-1])/2,gy=(distances[i+width]-distances[i-width])/2;
      edgeSum+=Math.hypot(gx,gy);edgeCount++;
    }
    const score=Math.sqrt(candidate.pixels)*Math.min(30,edgeSum/Math.max(1,edgeCount));
    if(score>bestScore){bestScore=score;threshold=level;component=candidate;boundaryStrength=edgeSum/Math.max(1,edgeCount);}
  }
  // Low-contrast material can sit inside a broad lighting patch. Closed strong
  // image edges provide an independent candidate for these cases.
  if(component&&boundaryStrength<5){
    const gray=new Float32Array(n),edges=new Uint8Array(n);
    for(let i=0;i<n;i++){const j=i*4;gray[i]=.299*rgba[j]+.587*rgba[j+1]+.114*rgba[j+2];}
    for(let y=1;y<height-1;y++)for(let x=1;x<width-1;x++){
      const i=y*width+x,gx=(gray[i-width+1]+2*gray[i+1]+gray[i+width+1]-gray[i-width-1]-2*gray[i-1]-gray[i+width-1])/8,gy=(gray[i+width-1]+2*gray[i+width]+gray[i+width+1]-gray[i-width-1]-2*gray[i-width]-gray[i-width+1])/8;
      if(Math.hypot(gx,gy)>6)edges[i]=1;
    }
    const dilated=edges.slice();
    for(let y=1;y<height-1;y++)for(let x=1;x<width-1;x++)if(edges[y*width+x])for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++)dilated[(y+dy)*width+x+dx]=1;
    const interior=new Uint8Array(n);for(let i=0;i<n;i++)interior[i]=dilated[i]?0:1;
    const enclosed=largestInteriorComponent(interior,width,height);
    if(enclosed&&enclosed.pixels>20&&enclosed.pixels<n*.8){
      const expanded=enclosed.mask.slice();
      for(let y=2;y<height-2;y++)for(let x=2;x<width-2;x++)if(enclosed.mask[y*width+x])for(let dy=-2;dy<=2;dy++)for(let dx=-2;dx<=2;dx++)expanded[(y+dy)*width+x+dx]=1;
      const candidate=largestInteriorComponent(expanded,width,height);
      if(candidate&&candidate.pixels<component.pixels&&candidate.pixels>component.pixels*.03)component=candidate;
    }
  }
  let segmentation = 'background-distance';
  if (component) {
    const samples=[],backgrounds=[],brightness=[];
    for(let i=0;i<n;i+=Math.max(1,Math.floor(n/3000))){
      if(!component.mask[i])continue;const j=i*4,bg=model.at(i%width,(i/width)|0),sum=rgba[j]+rgba[j+1]+rgba[j+2],bgSum=bg[0]+bg[1]+bg[2];
      if(sum<150||bgSum<150)continue;
      samples.push([rgba[j]/sum,rgba[j+1]/sum,rgba[j+2]/sum]);backgrounds.push(bg.map(v=>v/bgSum));brightness.push(sum/bgSum);
    }
    if(samples.length>12){
      const color=[0,1,2].map(c=>median(samples.map(p=>p[c]))),support=[0,1,2].map(c=>median(backgrounds.map(p=>p[c])));
      const separation=Math.hypot(...color.map((v,c)=>v-support[c]));
      const variation=median(samples.map(p=>Math.hypot(...p.map((v,c)=>v-color[c]))));
      if(separation>.045&&variation<separation*.6&&median(brightness)>.7){
        const tolerance=Math.min(separation*.8,Math.max(.025,variation*4)),mask=new Uint8Array(n);
        for(let i=0;i<n;i++){
          const j=i*4,sum=rgba[j]+rgba[j+1]+rgba[j+2];
          if(sum<60)continue;
          const difference=Math.hypot(rgba[j]/sum-color[0],rgba[j+1]/sum-color[1],rgba[j+2]/sum-color[2]);
          mask[i]=difference<tolerance?1:0;
        }
        const colored=largestInteriorComponent(denoiseMask(mask,width,height,options.keepSmallHoles),width,height);
        if(colored&&colored.pixels>component.pixels*.3&&colored.pixels<n*.9){component=colored;segmentation='material-color';}
      }
    }
  }
  if (!component || component.pixels < Math.max(20, n * 0.00008) || component.pixels > n * 0.97)
    throw new Error('Could not isolate a part. Try a clear photo with the part separated from the image edges and a contrasting, uncluttered background.');
  // Expand enclosed apertures through their cast shadows on dark, perforated
  // material. Exterior pixels never seed this pass, so tabletop lighting cannot
  // erode the outside profile. Limit growth to the neighborhood of each hole.
  const initialLoops=extractLoops(component.mask,width,height);
  if(initialLoops.filter(p=>Math.abs(signedArea(p))>=9).length>=8){
    const tones=[],supportTones=[];for(let i=0;i<n;i+=Math.max(1,Math.floor(n/4000)))if(component.mask[i]){const j=i*4;tones.push(.299*rgba[j]+.587*rgba[j+1]+.114*rgba[j+2]);const bg=model.at(i%width,(i/width)|0);supportTones.push(.299*bg[0]+.587*bg[1]+.114*bg[2]);}
    const materialTone=median(tones);
    if(materialTone<90&&materialTone<median(supportTones)*.5){
      const exterior=new Uint8Array(n),queue=new Int32Array(n),depth=new Uint8Array(n);let head=0,tail=0;
      const addExterior=i=>{if(!component.mask[i]&&!exterior[i]){exterior[i]=1;queue[tail++]=i;}};
      for(let x=0;x<width;x++){addExterior(x);addExterior((height-1)*width+x);}
      for(let y=0;y<height;y++){addExterior(y*width);addExterior(y*width+width-1);}
      while(head<tail){const i=queue[head++],x=i%width,y=(i/width)|0;if(x)addExterior(i-1);if(x+1<width)addExterior(i+1);if(y)addExterior(i-width);if(y+1<height)addExterior(i+width);}
      head=0;tail=0;const visited=exterior.slice(),mask=component.mask.slice();
      for(let i=0;i<n;i++)if(!mask[i]&&!exterior[i]){queue[tail++]=i;visited[i]=1;}
      const cutoff=materialTone*1.65;
      while(head<tail){const i=queue[head++],x=i%width,y=(i/width)|0;if(depth[i]>=14)continue;
        const grow=k=>{if(visited[k])return;visited[k]=1;const j=k*4,tone=.299*rgba[j]+.587*rgba[j+1]+.114*rgba[j+2];if(tone>cutoff){mask[k]=0;depth[k]=depth[i]+1;queue[tail++]=k;}};
        if(x)grow(i-1);if(x+1<width)grow(i+1);if(y)grow(i-width);if(y+1<height)grow(i+width);
      }
      const expanded=largestInteriorComponent(denoiseMask(mask,width,height,options.keepSmallHoles),width,height);
      if(expanded&&expanded.pixels>component.pixels*.8){component=expanded;segmentation='shadow-aware-apertures';}
    }
  }
  let contours = extractLoops(component.mask, width, height);
  if (!contours.length) throw new Error('No usable outline was found. Try a sharper photo with more contrast around the part.');
  contours.sort((a, b) => Math.abs(signedArea(b)) - Math.abs(signedArea(a)));
  const detectedOpenings = contours.length - 1;
  // Reject tiny texture islands and require background evidence for openings.
  // Elongated slots are retained; the detail override exposes uncertain holes.
  if (!options.keepSmallHoles) contours = contours.filter((points, index) => {
    if (!index) return true;
    if (Math.abs(signedArea(points)) < 9) return false;
    if(segmentation==='shadow-aware-apertures')return true;
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
          samples++;
          const i=y*width+x,j=i*4,bg=model.at(x,y),norm=bg[0]**2+bg[1]**2+bg[2]**2;
          const scale=norm? (rgba[j]*bg[0]+rgba[j+1]*bg[1]+rgba[j+2]*bg[2])/norm : 1;
          const residual=Math.sqrt(.299*(rgba[j]-bg[0]*scale)**2+.587*(rgba[j+1]-bg[1]*scale)**2+.114*(rgba[j+2]-bg[2]*scale)**2);
          const shadowBackground=threshold<=baseThreshold*1.5&&bg[0]+bg[1]+bg[2]>240&&scale>=.5&&scale<=.9&&residual<Math.max(10,model.noise*2);
          if (distances[i] < Math.max(10, model.noise * 2, threshold * .5) || shadowBackground) background++;
        }
    }
    return samples > 0 && background / samples >= .7;
  });
  if(segmentation!=='shadow-aware-apertures')contours = contours.map((points,index) => index>0&&segmentation==='material-color'?points:refineEdges(points,width,height,rgba,index>0));
  const entities = contours.map(points => fitCircularOutline(points) || { type: 'poly', pts: points, closed: true });
  return { contours, entities, threshold, segmentation, suppressedOpenings: detectedOpenings - contours.length + 1, foregroundPixels: component.pixels, foregroundFraction: component.pixels / n };
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
