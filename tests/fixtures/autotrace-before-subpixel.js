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
function refineEdges(points,width,height,rgba,hole=false,model=null) {
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
    const val=(xx,yy)=>{const i=(yy*width+xx)*4,a=rgba[i+3]/255,bg=a<1?(model?.at(xx,yy)||[255,255,255]):[0,0,0];return (.299*rgba[i]+.587*rgba[i+1]+.114*rgba[i+2])*a+(.299*bg[0]+.587*bg[1]+.114*bg[2])*(1-a);};
    return (val(ix,iy)*(1-fx)+val(Math.min(width-1,ix+1),iy)*fx)*(1-fy)+(val(ix,Math.min(height-1,iy+1))*(1-fx)+val(Math.min(width-1,ix+1),Math.min(height-1,iy+1))*fx)*fy;
  };
  const states=Array.from({length:19},(_,i)=>i-4),count=states.length,zero=4,normals=[],costs=[];
  for(let i=0;i<dense.length;i++){
    const p=dense[i],a=dense[(i-2+dense.length)%dense.length],b=dense[(i+2)%dense.length],len=Math.hypot(b.x-a.x,b.y-a.y)||1;
    const nx=-(b.y-a.y)/len,ny=(b.x-a.x)/len;normals.push({x:nx,y:ny});
    const strength=t=>Math.abs(gray(p.x+nx*(t+1),p.y+ny*(t+1))-gray(p.x+nx*(t-1),p.y+ny*(t-1)))/2;
    const original=strength(0);
    costs.push(states.map(t=>!hole&&original>25&&t!==0?1e6:-Math.min(40,strength(t))/(1+Math.abs(t)*(hole?.03:.04))+Math.abs(t)*.08));
  }
  // A closed-chain dynamic program keeps neighboring displacements coherent,
  // rather than letting each point jump to an unrelated texture edge.
  let previous=new Float64Array(count).fill(1e6);previous[zero]=costs[0][zero];
  const links=new Int8Array(dense.length*count);
  for(let i=1;i<dense.length;i++){
    const next=new Float64Array(count).fill(1e6);
    for(let k=0;k<count;k++)for(let j=Math.max(0,k-5);j<=Math.min(count-1,k+5);j++){
      const candidate=previous[j]+costs[i][k]+.2*(states[k]-states[j])**2;
      if(candidate<next[k]){next[k]=candidate;links[i*count+k]=j;}
    }
    previous=next;
  }
  let state=zero,best=Infinity;
  for(let k=0;k<count;k++){const score=previous[k]+.2*states[k]**2;if(score<best){best=score;state=k;}}
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
  return traceRaster(width, height, rgba, options);
}

function traceRaster(width, height, rgba, options = {}, scaleChecks = 0) {
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
  const candidates=[];
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
    candidates.push({pixels:candidate.pixels,score});
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
  if(options.materialMask){
    if(options.materialMask.length!==n)throw new Error('Invalid learned material mask.');
    const learned=largestInteriorComponent(Uint8Array.from(options.materialMask),width,height);
    if(learned)component=learned;
  }
  let segmentation = 'background-distance', materialColor = null, materialLightFloor = 0;
  if (component) {
    const samples=[],backgrounds=[],brightness=[],lightness=[];
    for(let i=0;i<n;i+=Math.max(1,Math.floor(n/3000))){
      if(!component.mask[i])continue;const j=i*4,bg=model.at(i%width,(i/width)|0),sum=rgba[j]+rgba[j+1]+rgba[j+2],bgSum=bg[0]+bg[1]+bg[2];
      if(sum<150||bgSum<150)continue;
      if(options.materialMask&&Math.hypot(...[0,1,2].map(c=>rgba[j+c]/sum-bg[c]/bgSum))<.03)continue;
      samples.push([rgba[j]/sum,rgba[j+1]/sum,rgba[j+2]/sum]);backgrounds.push(bg.map(v=>v/bgSum));brightness.push(sum/bgSum);lightness.push(.299*rgba[j]+.587*rgba[j+1]+.114*rgba[j+2]);
    }
    if(samples.length>12){
      const color=[0,1,2].map(c=>median(samples.map(p=>p[c]))),support=[0,1,2].map(c=>median(backgrounds.map(p=>p[c])));
      const separation=Math.hypot(...color.map((v,c)=>v-support[c]));
      const variation=median(samples.map(p=>Math.hypot(...p.map((v,c)=>v-color[c]))));
      if(separation>.045&&variation<separation*.6&&(options.materialMask||median(brightness)>.7)){
        const tolerance=Math.min(separation*.8,Math.max(.025,variation*4)),mask=new Uint8Array(n);
        const brightNeutral=median(brightness)>1.5&&Math.max(...color)-Math.min(...color)<.07,minimumLuma=brightNeutral?median(lightness)*.8:0;
        for(let i=0;i<n;i++){
          const j=i*4,sum=rgba[j]+rgba[j+1]+rgba[j+2];
          if(sum<60)continue;
          const difference=Math.hypot(rgba[j]/sum-color[0],rgba[j+1]/sum-color[1],rgba[j+2]/sum-color[2]);
          mask[i]=difference<tolerance&&(.299*rgba[j]+.587*rgba[j+1]+.114*rgba[j+2])>=minimumLuma?1:0;
        }
        const colored=largestInteriorComponent(denoiseMask(mask,width,height,options.keepSmallHoles),width,height);
        if(colored&&colored.pixels>component.pixels*.3&&colored.pixels<n*.9){component=colored;segmentation='material-color';materialColor=color;materialLightFloor=minimumLuma;}
      }
    }
  }
  // A dark closed rim can bound a bright face that has nearly the same color
  // as the table. Local contrast removes slow lighting changes before filling
  // the rim. Only accept a substantially larger, enclosed candidate.
  if(component&&segmentation==='background-distance'&&component.pixels<n*.06){
    const gray=new Float32Array(n),integral=new Float64Array((width+1)*(height+1)),stride=width+1;
    for(let y=0;y<height;y++){let row=0;for(let x=0;x<width;x++){const i=y*width+x,j=i*4;gray[i]=.299*rgba[j]+.587*rgba[j+1]+.114*rgba[j+2];row+=gray[i];integral[(y+1)*stride+x+1]=integral[y*stride+x+1]+row;}}
    const dark=new Uint8Array(n),radius=Math.max(3,Math.min(12,Math.round(Math.min(width,height)*.035)));
    for(let y=1;y<height-1;y++)for(let x=1;x<width-1;x++){
      const x0=Math.max(0,x-radius),x1=Math.min(width,x+radius+1),y0=Math.max(0,y-radius),y1=Math.min(height,y+radius+1);
      const mean=(integral[y1*stride+x1]-integral[y0*stride+x1]-integral[y1*stride+x0]+integral[y0*stride+x0])/((x1-x0)*(y1-y0));
      dark[y*width+x]=gray[y*width+x]<mean-6?1:0;
    }
    const originalDark=dark.slice();
    // Close single-pixel gaps in an observed rim without inventing a large
    // missing edge. Retain the original evidence for locating interior holes.
    const dilated=dark.slice(),closed=dark.slice();
    for(let y=1;y<height-1;y++)for(let x=1;x<width-1;x++){
      let value=0;for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++)value|=dark[(y+dy)*width+x+dx];dilated[y*width+x]=value;
    }
    for(let y=1;y<height-1;y++)for(let x=1;x<width-1;x++){
      let value=1;for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++)value&=dilated[(y+dy)*width+x+dx];closed[y*width+x]=value;
    }
    // Prefer an already closed rim; only bridge gaps when it encloses no face.
    let rim=largestInteriorComponent(dark.slice(),width,height);
    const rawLoops=rim?extractLoops(rim.mask,width,height):[];
    const bridged=!rawLoops.some(p=>signedArea(p)<-9);
    if(bridged)rim=largestInteriorComponent(closed,width,height);
    if(rim){
      const outside=new Uint8Array(n),queue=new Int32Array(n);let head=0,tail=0;
      const add=i=>{if(!rim.mask[i]&&!outside[i]){outside[i]=1;queue[tail++]=i;}};
      for(let x=0;x<width;x++){add(x);add((height-1)*width+x);}for(let y=0;y<height;y++){add(y*width);add(y*width+width-1);}
      while(head<tail){const i=queue[head++],x=i%width,y=(i/width)|0;if(x)add(i-1);if(x+1<width)add(i+1);if(y)add(i-width);if(y+1<height)add(i+width);}
      const filled=new Uint8Array(n);let pixels=0;for(let i=0;i<n;i++){filled[i]=outside[i]?0:1;pixels+=filled[i];}
      if(pixels>rim.pixels*(Math.min(width,height)<128?1.5:2)&&pixels>component.pixels*1.4&&pixels<n*.2){
        // Preserve distinct dark openings inside the face, excluding its rim.
        for(let i=0;i<n;i++)if(filled[i]&&originalDark[i]){
          const x=i%width,y=(i/width)|0,margin=Math.max(2,Math.round(Math.min(width,height)/42));let interior=true;
          for(let dy=-margin;dy<=margin;dy++)for(let dx=-margin;dx<=margin;dx++)if(x+dx<0||x+dx>=width||y+dy<0||y+dy>=height||outside[(y+dy)*width+x+dx])interior=false;
          if(interior)filled[i]=0;
        }
        const candidate=largestInteriorComponent(denoiseMask(filled,width,height,true),width,height);
        if(candidate){component=candidate;segmentation='closed-dark-rim';}
      }
    }
  }
  if (!component || component.pixels < Math.max(20, n * 0.00008) || component.pixels > n * 0.97)
    throw new Error('Could not isolate a part. Try a clear photo with the part separated from the image edges and a contrasting, uncluttered background.');
  // Expand enclosed apertures through their cast shadows on dark, perforated
  // material. Exterior pixels never seed this pass, so tabletop lighting cannot
  // erode the outside profile. Limit growth to the neighborhood of each hole.
  const initialLoops=extractLoops(component.mask,width,height);
  const largestLoopArea=initialLoops.reduce((largest,p)=>Math.max(largest,Math.abs(signedArea(p))),0);
  const apertureBrightness=initialLoops.filter(p=>Math.abs(signedArea(p))>=9&&Math.abs(signedArea(p))<largestLoopArea).map(loop=>{
    const x=clamp(Math.floor(loop.reduce((s,p)=>s+p.x,0)/loop.length),0,width-1),y=clamp(Math.floor(loop.reduce((s,p)=>s+p.y,0)/loop.length),0,height-1),j=(y*width+x)*4,bg=model.at(x,y);
    return (.299*rgba[j]+.587*rgba[j+1]+.114*rgba[j+2])/Math.max(1,.299*bg[0]+.587*bg[1]+.114*bg[2]);
  });
  if(initialLoops.filter(p=>Math.abs(signedArea(p))>=9).length>=8){
    const tones=[],supportTones=[];for(let i=0;i<n;i+=Math.max(1,Math.floor(n/4000)))if(component.mask[i]){const j=i*4;tones.push(.299*rgba[j]+.587*rgba[j+1]+.114*rgba[j+2]);const bg=model.at(i%width,(i/width)|0);supportTones.push(.299*bg[0]+.587*bg[1]+.114*bg[2]);}
    const materialTone=median(tones);
    if(materialTone<90&&materialTone<median(supportTones)*.5&&median(apertureBrightness)>.8){
      const exterior=new Uint8Array(n),queue=new Int32Array(n),depth=new Uint8Array(n);let head=0,tail=0;
      const addExterior=i=>{if(!component.mask[i]&&!exterior[i]){exterior[i]=1;queue[tail++]=i;}};
      for(let x=0;x<width;x++){addExterior(x);addExterior((height-1)*width+x);}
      for(let y=0;y<height;y++){addExterior(y*width);addExterior(y*width+width-1);}
      while(head<tail){const i=queue[head++],x=i%width,y=(i/width)|0;if(x)addExterior(i-1);if(x+1<width)addExterior(i+1);if(y)addExterior(i-width);if(y+1<height)addExterior(i+width);}
      head=0;tail=0;const visited=exterior.slice(),mask=component.mask.slice(),holeBrightness=[];
      for(let i=0;i<n;i++)if(!mask[i]&&!exterior[i]){queue[tail++]=i;visited[i]=1;const j=i*4,bg=model.at(i%width,(i/width)|0);holeBrightness.push((.299*rgba[j]+.587*rgba[j+1]+.114*rgba[j+2])/Math.max(1,.299*bg[0]+.587*bg[1]+.114*bg[2]));}
      // Metallic highlights can mimic holes in an underexposed part. Require
      // aperture seeds to retain substantial support-surface brightness.
      if(median(holeBrightness)>.7){
      const cutoff=materialTone*1.65;
      const growthLimit=Math.max(2,Math.min(14,Math.round(Math.min(width,height)*.04)));
      const apertureAreas=initialLoops.map(p=>Math.abs(signedArea(p))).filter(a=>a>=9&&a<largestLoopArea);
      const minimumSeedArea=Math.max(9,median(apertureAreas)*.35);
      // A fully shaded opening may have no pixels matching the border model.
      // On a dark perforated face, seek compact bright interior patches as
      // additional seeds. Isolated bright texture pixels cannot seed growth.
      const bright=new Uint8Array(n);
      const seedMargin=growthLimit+2;
      for(let y=seedMargin;y<height-seedMargin;y++)for(let x=seedMargin;x<width-seedMargin;x++){
        const i=y*width+x,j=i*4;if(!mask[i])continue;
        if(.299*rgba[j]+.587*rgba[j+1]+.114*rgba[j+2]<materialTone*2)continue;
        let enclosed=true;
        for(let dy=-seedMargin;dy<=seedMargin&&enclosed;dy++)for(let dx=-seedMargin;dx<=seedMargin;dx++)if(exterior[(y+dy)*width+x+dx]){enclosed=false;break;}
        if(enclosed)bright[i]=1;
      }
      for(let seed=0;seed<n;seed++)if(bright[seed]){
        const patch=[seed];bright[seed]=0;
        for(let pos=0;pos<patch.length;pos++){
          const i=patch[pos],x=i%width,y=(i/width)|0;
          const add=k=>{if(bright[k]){bright[k]=0;patch.push(k);}};
          if(x)add(i-1);if(x+1<width)add(i+1);if(y)add(i-width);if(y+1<height)add(i+width);
        }
        if(patch.length<minimumSeedArea||patch.length>component.pixels*.02)continue;
        if(patch.some(i=>[i-1,i+1,i-width,i+width].some(k=>!component.mask[k]&&!exterior[k])))continue;
        for(const i of patch)if(!visited[i]){mask[i]=0;visited[i]=1;queue[tail++]=i;}
      }
      while(head<tail){const i=queue[head++],x=i%width,y=(i/width)|0;if(depth[i]>=growthLimit)continue;
        const grow=k=>{if(visited[k])return;visited[k]=1;const j=k*4,tone=.299*rgba[j]+.587*rgba[j+1]+.114*rgba[j+2];if(tone>cutoff){mask[k]=0;depth[k]=depth[i]+1;queue[tail++]=k;}};
        if(x)grow(i-1);if(x+1<width)grow(i+1);if(y)grow(i-width);if(y+1<height)grow(i+width);
      }
      const expanded=largestInteriorComponent(denoiseMask(mask,width,height,options.keepSmallHoles),width,height);
      if(expanded&&expanded.pixels>component.pixels*.8){component=expanded;segmentation='shadow-aware-apertures';}
      }
    }
  }
  let contours = extractLoops(component.mask, width, height);
  if (!contours.length) throw new Error('No usable outline was found. Try a sharper photo with more contrast around the part.');
  contours.sort((a, b) => Math.abs(signedArea(b)) - Math.abs(signedArea(a)));
  const detectedOpenings = contours.length - 1, uncertainOpenings=[];
  const materialTones=[];
  for(let i=0;i<n;i+=Math.max(1,Math.floor(n/4000)))if(component.mask[i]){
    const j=i*4;materialTones.push(.299*rgba[j]+.587*rgba[j+1]+.114*rgba[j+2]);
  }
  const typicalMaterialTone=median(materialTones);
  // Reject tiny texture islands and require background evidence for openings.
  // Elongated slots are retained; the detail override exposes uncertain holes.
  if (!options.keepSmallHoles) contours = contours.filter((points, index) => {
    if (!index) return true;
    if (Math.abs(signedArea(points)) < (segmentation==='closed-dark-rim'?Math.max(3,n*.0006):9)) return false;
    const smallPatch=Math.abs(signedArea(points))<n*.001;
    if(segmentation==='shadow-aware-apertures')return true;
    if(segmentation==='closed-dark-rim'){
      const perimeter=points.reduce((sum,p,i)=>sum+Math.hypot(p.x-points[(i+1)%points.length].x,p.y-points[(i+1)%points.length].y),0);
      return Math.abs(signedArea(points))*4*Math.PI/(perimeter*perimeter)>(Math.min(width,height)<128?.45:.3);
    }
    const bounds = points.reduce((b,p) => ({ minY: Math.min(b.minY,p.y), maxY: Math.max(b.maxY,p.y) }), { minY: height, maxY: 0 });
    let samples = 0, background = 0, colorSupported = 0;
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
          // Neutral metallic highlights also resemble dimmed table pixels.
          // Shadow-only evidence needs separation from the material itself;
          // otherwise leave that ambiguous opening to the detail override.
          const tone=.299*rgba[j]+.587*rgba[j+1]+.114*rgba[j+2];
          const shadowBackground=threshold<=baseThreshold*1.5&&bg[0]+bg[1]+bg[2]>240&&scale>=.5&&scale<=.9&&(!smallPatch||tone>typicalMaterialTone*2)&&residual<Math.max(10,model.noise*2);
          const sum=rgba[j]+rgba[j+1]+rgba[j+2],bgSum=bg[0]+bg[1]+bg[2];
          const hueBackground=materialColor&&sum>60&&bgSum>60&&(()=>{
            const hue=[rgba[j]/sum,rgba[j+1]/sum,rgba[j+2]/sum];
            const nearBackground=Math.hypot(...hue.map((v,c)=>v-bg[c]/bgSum));
            const nearMaterial=Math.hypot(...hue.map((v,c)=>v-materialColor[c]));
            return nearBackground<.09&&nearBackground<nearMaterial*.8;
          })();
          const matchesBackground=distances[i]<Math.max(10,model.noise*2,threshold*.5)&&(!smallPatch||rgba[j+3]<32||scale>.8||tone>typicalMaterialTone*2);
          if(matchesBackground || hueBackground)colorSupported++;
          if (matchesBackground || shadowBackground || hueBackground || (materialLightFloor && tone<materialLightFloor)) background++;
        }
    }
    const keep=samples>0&&background/samples>=.7;
    if(keep&&colorSupported/samples<.7)uncertainOpenings.push(points);
    return keep;
  });
  if(!options.materialMask&&segmentation!=='shadow-aware-apertures'&&segmentation!=='closed-dark-rim')contours = contours.map((points,index) => index>0&&segmentation==='material-color'?points:refineEdges(points,width,height,rgba,index>0,model));
  const entities = contours.map(points => fitCircularOutline(points) || { type: 'poly', pts: points, closed: true });
  // These are image-evidence diagnostics, not a probability of correctness.
  // Highlight weak boundary sections so a plausible-looking outline cannot
  // silently imply that every physical edge was observed.
  const {weakSegments,weakBoundaryFraction}=measureBoundaryEvidence(contours,width,height,rgba,model);
  const selectionUnstable=segmentation==='background-distance'&&candidates.some(c=>c.score>bestScore*.6&&c.pixels>component.pixels*3);
  const warnings=[];
  for(const loop of uncertainOpenings)for(let i=0;i<loop.length;i++)weakSegments.push([loop[i],loop[(i+1)%loop.length]]);
  if(uncertainOpenings.length)warnings.push(`${uncertainOpenings.length} openings rely on brightness evidence. Check for markings or obstructions.`);
  if(weakBoundaryFraction>.08)warnings.push('Amber edges have weak image evidence. Review them before using this outline.');
  if(selectionUnstable)warnings.push('Part selection changes substantially with contrast. Crop closer around one part.');
  // Texture, interpolation and broad shadows can dominate a fine-scale mask.
  // Compare an independently segmented, area-averaged raster only when the
  // chosen boundary lacks evidence. Never replace a strong full-size result.
  if(!options.materialMask&&segmentation==='background-distance'&&weakBoundaryFraction>.15&&Math.min(width,height)>=320&&scaleChecks<3){
    const w=Math.floor(width/2),h=Math.floor(height/2),small=new Uint8ClampedArray(w*h*4);
    for(let y=0;y<h;y++)for(let x=0;x<w;x++){
      const x0=Math.floor(x*width/w),x1=Math.floor((x+1)*width/w),y0=Math.floor(y*height/h),y1=Math.floor((y+1)*height/h);
      let alpha=0,count=0;const color=[0,0,0];
      for(let yy=y0;yy<y1;yy++)for(let xx=x0;xx<x1;xx++){
        const i=(yy*width+xx)*4,a=rgba[i+3];alpha+=a;count++;
        for(let c=0;c<3;c++)color[c]+=rgba[i+c]*a;
      }
      const j=(y*w+x)*4;for(let c=0;c<3;c++)small[j+c]=alpha?color[c]/alpha:0;small[j+3]=alpha/count;
    }
    let coarse;
    try{coarse=traceRaster(w,h,small,options,scaleChecks+1);}catch{/* An unresolved second scale must not discard the first result. */}
    if(coarse&&coarse.quality.weakBoundaryFraction<weakBoundaryFraction*.6){
      const sx=width/w,sy=height/h,map=p=>({x:p.x*sx,y:p.y*sy}),mapped=coarse.contours.map(c=>c.map(map));
      const fineArea=Math.abs(signedArea(contours[0])),coarseArea=Math.abs(signedArea(mapped[0]));
      const bounds=p=>p.reduce((b,v)=>({x0:Math.min(b.x0,v.x),y0:Math.min(b.y0,v.y),x1:Math.max(b.x1,v.x),y1:Math.max(b.y1,v.y)}),{x0:Infinity,y0:Infinity,x1:0,y1:0});
      const a=bounds(contours[0]),b=bounds(mapped[0]),intersection=Math.max(0,Math.min(a.x1,b.x1)-Math.max(a.x0,b.x0))*Math.max(0,Math.min(a.y1,b.y1)-Math.max(a.y0,b.y0));
      const overlap=intersection/Math.max(1,Math.min((a.x1-a.x0)*(a.y1-a.y0),(b.x1-b.x0)*(b.y1-b.y0)));
      if(coarseArea>fineArea*.65&&coarseArea<fineArea*1.35&&overlap>.9){
        return {...coarse,contours:mapped,entities:mapped.map(p=>fitCircularOutline(p)||{type:'poly',pts:p,closed:true}),
          foregroundPixels:Math.round(coarse.foregroundPixels*sx*sy),
          warnings:[...coarse.warnings,'Image scales disagree. A clearer boundary was selected; check shadows and small openings.'],
          quality:{...coarse.quality,scaleDisagreement:true,weakSegments:coarse.quality.weakSegments.map(s=>s.map(map))}};
      }
    }
    warnings.push('The boundary remains ambiguous at another image scale. Review shadows and openings.');
  }
  return { contours, entities, threshold, segmentation, warnings, quality:{weakBoundaryFraction,weakSegments,selectionUnstable,uncertainOpenings:uncertainOpenings.length,uncertainOpeningLoops:uncertainOpenings}, suppressedOpenings: detectedOpenings - contours.length + 1, foregroundPixels: component.pixels, foregroundFraction: component.pixels / n };
}

function measureBoundaryEvidence(contours,width,height,rgba,model){
  const weakSegments=[];let totalLength=0,weakLength=0;
  const sample=(x,y)=>{x=clamp(Math.floor(x),0,width-1);y=clamp(Math.floor(y),0,height-1);const i=(y*width+x)*4,a=rgba[i+3]/255,bg=a<1?model.at(x,y):[0,0,0];return [0,1,2].map(c=>rgba[i+c]*a+bg[c]*(1-a));};
  for(const loop of contours)for(let i=0;i<loop.length;i++){
    const a=loop[i],b=loop[(i+1)%loop.length],len=Math.hypot(b.x-a.x,b.y-a.y);if(!len)continue;
    const nx=-(b.y-a.y)/len,ny=(b.x-a.x)/len,steps=Math.max(1,Math.ceil(len/3));
    for(let k=0;k<steps;k++){
      const t=(k+.5)/steps,x=a.x+(b.x-a.x)*t,y=a.y+(b.y-a.y)*t,inside=sample(x+nx*2,y+ny*2),outside=sample(x-nx*2,y-ny*2);
      const difference=Math.sqrt(.299*(inside[0]-outside[0])**2+.587*(inside[1]-outside[1])**2+.114*(inside[2]-outside[2])**2);
      totalLength+=len/steps;
      if(difference<12){weakLength+=len/steps;weakSegments.push([{x:a.x+(b.x-a.x)*k/steps,y:a.y+(b.y-a.y)*k/steps},{x:a.x+(b.x-a.x)*(k+1)/steps,y:a.y+(b.y-a.y)*(k+1)/steps}]);}
    }
  }
  const weakBoundaryFraction=weakLength/Math.max(1,totalLength);
  return {weakSegments,weakBoundaryFraction};
}

// Convert a trained material mask using the same raster-to-CAD coordinates.
// Small apertures remain image-derived: SAM's low-resolution decoder can fill
// thin slots and holes that are clearly visible in the source raster.
export function traceTrainedMask(width,height,rgba,mask,proposal,options={}) {
  if(mask.length!==width*height)throw new Error('The segmentation mask has invalid dimensions.');
  const component=largestInteriorComponent(Uint8Array.from(mask,v=>v?1:0),width,height);
  if(!component)throw new Error('The model did not isolate an interior part. Crop around one part and try again.');
  if(component.pixels<Math.max(20,width*height*.003)||component.pixels>width*height*.9)throw new Error('The mask does not isolate a substantial part.');
  const loops=extractLoops(component.mask,width,height).sort((a,b)=>Math.abs(signedArea(b))-Math.abs(signedArea(a)));
  if(!loops.length)throw new Error('The model returned an empty part.');
  let outer=simplifyClosed(loops[0],.65);
  const inside=p=>{let yes=false;for(let i=0,j=outer.length-1;i<outer.length;j=i++){const a=outer[i],b=outer[j];if((a.y>p.y)!==(b.y>p.y)&&p.x<(b.x-a.x)*(p.y-a.y)/(b.y-a.y)+a.x)yes=!yes;}return yes;};
  const learnedEdges=autoTraceRaster(width,height,rgba,{...options,materialMask:component.mask});
  if(learnedEdges.segmentation==='material-color'){
    const edgeOuter=learnedEdges.contours[0],bounds=c=>c.reduce((b,p)=>({x0:Math.min(b.x0,p.x),y0:Math.min(b.y0,p.y),x1:Math.max(b.x1,p.x),y1:Math.max(b.y1,p.y)}),{x0:width,y0:height,x1:0,y1:0});
    const a=bounds(outer),b=bounds(edgeOuter),overlap=Math.max(0,Math.min(a.x1,b.x1)-Math.max(a.x0,b.x0))*Math.max(0,Math.min(a.y1,b.y1)-Math.max(a.y0,b.y0)),area=c=>Math.abs(signedArea(c));
    const evidence=c=>measureBoundaryEvidence([c],width,height,rgba,backgroundModel(width,height,rgba)).weakBoundaryFraction;
    if(overlap/Math.max(1,(a.x1-a.x0)*(a.y1-a.y0))>.85&&area(edgeOuter)>area(outer)*.65&&area(edgeOuter)<area(outer)*1.35&&evidence(edgeOuter)<evidence(outer))outer=edgeOuter;
  }
  const candidates=learnedEdges.contours.slice(1);
  const centroid=c=>({x:c.reduce((s,p)=>s+p.x,0)/c.length,y:c.reduce((s,p)=>s+p.y,0)/c.length});
  const contains=(p,loop)=>{let yes=false;for(let i=0,j=loop.length-1;i<loop.length;j=i++){const a=loop[i],b=loop[j];if((a.y>p.y)!==(b.y>p.y)&&p.x<(b.x-a.x)*(p.y-a.y)/(b.y-a.y)+a.x)yes=!yes;}return yes;};
  const holes=proposal.contours.slice(1).filter(c=>c.every(inside));
  for(const c of candidates)if(c.every(inside)&&!holes.some(existing=>contains(centroid(c),existing)||contains(centroid(existing),c)))holes.push(c);
  if(proposal.segmentation==='shadow-aware-apertures'&&holes.length!==proposal.contours.length-1){
    return {...proposal,engine:'Image edges (trained mask rejected)',warnings:[...proposal.warnings,'The trained mask missed thin material. Image edges were retained; review the highlighted sections.'],quality:{...proposal.quality,trainedMaskRejected:true}};
  }
  const contours=[outer,...holes],entities=contours.map(p=>fitCircularOutline(p)||{type:'poly',pts:p,closed:true});
  const evidence=measureBoundaryEvidence(contours,width,height,rgba,backgroundModel(width,height,rgba));
  const uncertain=[...(proposal.quality.uncertainOpeningLoops||[]),...(learnedEdges.quality.uncertainOpeningLoops||[])].filter(c=>holes.includes(c));
  for(const loop of uncertain)for(let i=0;i<loop.length;i++)evidence.weakSegments.push([loop[i],loop[(i+1)%loop.length]]);
  const warnings=proposal.warnings.filter(w=>!w.includes('Part selection changes')&&!w.includes('Image scales disagree')&&!w.includes('Amber edges')&&!w.includes('openings rely'));
  if(uncertain.length)warnings.push(`${uncertain.length} openings rely on brightness evidence. Check for markings or obstructions.`);
  if(evidence.weakBoundaryFraction>.08)warnings.push('Amber edges have weak image evidence. Review them before using this outline.');
  if(proposal.segmentation==='no-edge-proposal'&&evidence.weakBoundaryFraction>.4)throw new Error('The image does not provide a reliable part boundary. Use a sharper photo with a contrasting background.');
  return {...proposal,contours,entities,segmentation:'trained-material-mask',engine:'MobileSAM + image edges',suppressedOpenings:learnedEdges.suppressedOpenings,foregroundPixels:component.pixels,foregroundFraction:component.pixels/(width*height),
    quality:{...proposal.quality,...evidence,uncertainOpenings:uncertain.length,uncertainOpeningLoops:uncertain,selectionUnstable:false,trainedMask:true},warnings};
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
