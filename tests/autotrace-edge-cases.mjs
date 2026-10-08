import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { writeDXF, readDXF } from '../js/dxf.js';
import { autoTraceRaster } from '../js/autotrace.js';

const results = [];
function check(name, fn) {
  const start = performance.now();
  try { fn(); results.push({ name, status: 'pass', elapsedMs: Math.round(performance.now()-start) }); }
  catch (err) { results.push({ name, status: 'fail', error: err.message }); console.error(name, err); }
}
function image(w,h,paint) {
  const data = new Uint8ClampedArray(w*h*4);
  for(let y=0;y<h;y++) for(let x=0;x<w;x++) data.set(paint(x,y),4*(y*w+x));
  return data;
}
const disk = (x,y,cx,cy,r) => (x-cx)**2+(y-cy)**2 <= r*r;
const area = p => Math.abs(p.reduce((s,a,i) => {const b=p[(i+1)%p.length];return s+a.x*b.y-b.x*a.y;},0)/2);
const box = p => p.reduce((b,v) => ({minX:Math.min(b.minX,v.x),maxX:Math.max(b.maxX,v.x),minY:Math.min(b.minY,v.y),maxY:Math.max(b.maxY,v.y)}),{minX:Infinity,minY:Infinity,maxX:-Infinity,maxY:-Infinity});
const geometry = r => {
  assert.equal(r.entities.length,r.contours.length);
  for(const e of r.entities) {
    if(e.type==='circle') assert.ok(Number.isFinite(e.c.x+e.c.y+e.r) && e.r>0);
    else { assert.equal(e.closed,true);assert.ok(e.pts.length>=3);assert.ok(e.pts.every(p=>Number.isFinite(p.x+p.y))); }
  }
};
const trace = (w,h,paint,options) => { const r=autoTraceRaster(w,h,image(w,h,paint),options); geometry(r);return r; };
const bg = [220,220,220,255], fg = [30,30,30,255];
const annulus = (x,y) => disk(x,y,64,64,36)&&!disk(x,y,64,64,15)?fg:bg;
check('invalid dimensions: zero, negative, fractional, below minimum, NaN',()=>{
  for(const [w,h] of [[0,16],[-16,16],[16.5,16],[15,32],[32,15],[NaN,32]]) assert.throws(()=>autoTraceRaster(w,h,new Uint8Array(4096)),/at least/);
});
check('missing or truncated RGBA buffers',()=>{for(const data of [null,undefined,new Uint8Array(1)]) assert.throws(()=>autoTraceRaster(16,16,data),/at least/);});
check('oversized raster rejected before allocation',()=>assert.throws(()=>autoTraceRaster(4096,4096,{length:4096*4096*4}),/4 megapixels/));
check('invalid contrast settings',()=>{for(const sensitivity of [NaN,Infinity,-1,0,1.6,'0.35']) assert.throws(()=>autoTraceRaster(16,16,new Uint8Array(1024),{sensitivity}),/Edge contrast/);});
check('empty transparent image',()=>assert.throws(()=>autoTraceRaster(32,32,new Uint8Array(4096)),/Could not isolate/));
check('uniform black, white, and gray images',()=>{for(const v of [0,128,255]) assert.throws(()=>trace(64,64,()=>[v,v,v,255]),/Could not isolate/);});
check('dark annulus on light surface: outside and hole geometry',()=>{const r=trace(128,128,annulus);assert.equal(r.contours.length,2);assert.ok(r.entities.every(e=>e.type==='circle'));assert.ok(Math.abs(r.entities[0].r-36)<1);assert.ok(Math.abs(r.entities[1].r-15)<1);});
check('bright annulus on dark surface',()=>assert.equal(trace(128,128,(x,y)=>annulus(x,y)===fg?bg:fg).contours.length,2));
check('transparent background and transparent opening',()=>{const r=trace(128,128,(x,y)=>annulus(x,y)===fg?fg:[255,0,255,0]);assert.equal(r.contours.length,2);});
check('partially transparent part',()=>assert.equal(trace(128,128,(x,y)=>annulus(x,y)===fg?[30,30,30,160]:[0,0,0,0]).contours.length,2));
check('color contrast with similar brightness',()=>assert.equal(trace(128,128,(x,y)=>annulus(x,y)===fg?[200,60,60,255]:[50,130,60,255]).contours.length,2));
check('low contrast below raster tolerance is rejected',()=>assert.throws(()=>trace(128,128,(x,y)=>annulus(x,y)===fg?[215,215,215,255]:bg),/Could not isolate/));
check('minimum 16-pixel input remains supported',()=>assert.equal(trace(16,16,(x,y)=>x>=4&&x<12&&y>=4&&y<12?fg:bg).contours.length,1));
check('part cut by image boundary is rejected',()=>assert.throws(()=>trace(128,128,(x,y)=>disk(x,y,4,64,35)?fg:bg),/Could not isolate/));
check('border clutter does not replace separated interior part',()=>{const r=trace(128,128,(x,y)=>x<10||disk(x,y,70,64,20)?fg:bg);const b=box(r.contours[0]);assert.ok(b.minX>45&&b.maxX<95);});
check('multiple parts choose largest separated component',()=>{const r=trace(160,128,(x,y)=>disk(x,y,45,64,25)||disk(x,y,120,64,14)?fg:bg);assert.equal(r.contours.length,1);assert.ok(box(r.contours[0]).maxX<80);});
check('one-pixel noise islands removed',()=>{const r=trace(128,128,(x,y)=>annulus(x,y)===fg||((x*131+y*71)%997===0)?fg:bg);assert.equal(r.contours.length,2);});
check('mild background gradient and texture',()=>{const r=trace(128,128,(x,y)=>annulus(x,y)===fg?fg:[210+Math.floor(x/16)+(x+y)%3,210+Math.floor(y/16),215,255]);assert.equal(r.contours.length,2);});
check('long slot retained without a circular-shape assumption',()=>{const r=trace(160,128,(x,y)=>x>20&&x<140&&y>20&&y<108&&!(x>35&&x<125&&y>60&&y<68)?fg:bg);assert.equal(r.contours.length,2);const b=box(r.contours[1]);assert.ok(b.maxX-b.minX>80&&b.maxY-b.minY<12);});
check('small opening filter and explicit detail override',()=>{const paint=(x,y)=>x>20&&x<108&&y>20&&y<108&&!(x>=60&&x<=62&&y>=60&&y<=62)?fg:bg;const standard=trace(128,128,paint),detail=trace(128,128,paint,{keepSmallHoles:true});assert.equal(standard.contours.length,1);assert.equal(standard.suppressedOpenings,1);assert.equal(detail.contours.length,2);});
check('narrow two-pixel slot survives explicit detail mode',()=>{
  const paint=(x,y)=>x>20&&x<108&&y>20&&y<108&&!(x>=45&&x<85&&y>=63&&y<65)?fg:bg;
  const r=trace(128,128,paint,{keepSmallHoles:true});assert.equal(r.contours.length,2);assert.ok(area(r.contours[1])>=70);
});
check('opening connected to exterior remains a notch, not a false hole',()=>{
  const r=trace(128,128,(x,y)=>x>20&&x<108&&y>20&&y<108&&!(x>60&&x<70&&y<65)?fg:bg);assert.equal(r.contours.length,1);assert.equal(r.entities[0].type,'poly');
});
check('disconnected assemblies choose one part rather than claiming a full assembly',()=>{
  const r=trace(128,128,(x,y)=>disk(x,y,35,64,20)||disk(x,y,95,64,10)?fg:bg);assert.equal(r.contours.length,1);assert.ok(box(r.contours[0]).maxX<60);
});
check('touching objects are one connected silhouette, a documented limitation',()=>{
  const r=trace(128,128,(x,y)=>disk(x,y,45,64,25)||disk(x,y,85,64,25)?fg:bg);assert.equal(r.contours.length,1);assert.equal(r.entities[0].type,'poly');
});
check('fitted circles and traced profiles survive DXF round-trip',()=>{
  for(const r of [trace(128,128,annulus),trace(128,128,(x,y)=>x>20&&x<108&&y>20&&y<108&&!(x>40&&x<90&&y>60&&y<68)?fg:bg)]) {
    const layers=[{id:'L0',name:'Parts',color:'#ffffff'}];const entities=r.entities.map(e=>({...e,layer:'L0'}));
    const parsed=readDXF(writeDXF(entities,layers,{}));assert.equal(parsed.entities.length,entities.length);assert.equal(parsed.warnings.length,0);
    for(let i=0;i<entities.length;i++) {assert.equal(parsed.entities[i].type,entities[i].type);if(entities[i].type==='circle') assert.ok(Math.abs(parsed.entities[i].r-entities[i].r)<.00001);else assert.equal(parsed.entities[i].closed,true);}
  }
});
check('material discoloration is not automatically a through-hole',()=>{const r=trace(128,128,(x,y)=>x>20&&x<108&&y>20&&y<108?(disk(x,y,64,64,12)?[207,207,207,255]:fg):bg,{sensitivity:1});assert.equal(r.contours.length,1);assert.equal(r.suppressedOpenings,1);});
check('perspective ellipse remains polygon rather than false circle',()=>{const r=trace(160,128,(x,y)=>((x-80)/45)**2+((y-64)/20)**2<=1?fg:bg);assert.equal(r.entities[0].type,'poly');});
check('concave corner remains outside geometry',()=>{const r=trace(128,128,(x,y)=>((x>20&&x<100&&y>20&&y<45)||(x>20&&x<45&&y>20&&y<105))?fg:bg);assert.equal(r.entities[0].type,'poly');assert.ok(area(r.contours[0])<4000);});
check('rotation retains outline area and hole count',()=>{const r=trace(160,160,(x,y)=>{const dx=x-80,dy=y-80,a=.7,u=dx*Math.cos(a)+dy*Math.sin(a),v=-dx*Math.sin(a)+dy*Math.cos(a);return Math.abs(u)<45&&Math.abs(v)<25&&!(u*u+v*v<100)?fg:bg;});assert.equal(r.contours.length,2);assert.ok(Math.abs(area(r.contours[0])-4500)<200);});
check('blurred boundaries produce finite closed geometry',()=>{const data=image(128,128,annulus),blur=data.slice();for(let y=1;y<127;y++)for(let x=1;x<127;x++)for(let c=0;c<3;c++){let sum=0;for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++)sum+=data[((y+dy)*128+x+dx)*4+c];blur[(y*128+x)*4+c]=sum/9;}const r=autoTraceRaster(128,128,blur);geometry(r);assert.equal(r.contours.length,2);});
check('wide image and tall image geometry',()=>{for(const [w,h] of [[512,64],[64,512]]){const r=trace(w,h,(x,y)=>disk(x,y,w/2,h/2,20)?fg:bg);assert.equal(r.contours.length,1);assert.ok(Math.abs(r.entities[0].r-20)<1);}});
check('same input and settings are deterministic',()=>{const data=image(128,128,annulus);assert.deepEqual(autoTraceRaster(128,128,data),autoTraceRaster(128,128,data));});
check('input pixels are never mutated',()=>{const data=image(128,128,annulus),copy=data.slice();autoTraceRaster(128,128,data);assert.deepEqual(data,copy);});
check('transparent black geometry has the same edge evidence as composited white',()=>{
  const shape=(x,y)=>disk(x,y,64,64,38)&&!disk(x,y,64,64,15);
  const alpha=trace(128,128,(x,y)=>shape(x,y)?[0,0,0,255]:[0,0,0,0]);
  const opaque=trace(128,128,(x,y)=>shape(x,y)?[0,0,0,255]:[255,255,255,255]);
  assert.deepEqual(alpha.entities,opaque.entities);
  assert.equal(alpha.quality.weakBoundaryFraction,opaque.quality.weakBoundaryFraction);
  assert.equal(alpha.quality.uncertainOpenings,0);
});
check('weak photographic contrast is flagged without inventing a confidence score',()=>{
  const r=trace(128,128,(x,y)=>disk(x,y,64,64,30)?[110,110,110,255]:[121,121,121,255]);
  assert.ok(r.quality.weakBoundaryFraction>.8);
  assert.ok(r.warnings.some(w=>w.includes('weak image evidence')));
  assert.ok(r.quality.weakSegments.length>0);
});
for(const size of [96,128,192])check(`Low-contrast face with a one-pixel rim gap at ${size}px retains body and both holes`,()=>{
  for(const gap of [0,1]){
    const r=trace(size,size,(x,y)=>{
      const u=x*128/size,v=y*128/size,body=u>=48&&u<80&&v>=20&&v<110;
      const rim=body&&(u<50||u>=78||v<22||v>=108),broken=u<50&&v>=50&&v<50+gap;
      const holes=disk(u,v,64,37,4)||disk(u,v,64,92,4),tone=rim&&!broken||body&&holes?65:125;
      return [tone,tone,tone,255];
    });
    assert.equal(r.contours.length,3);
    const b=box(r.contours[0]);assert.ok(b.minY<size*.18&&b.maxY>size*.83,'whole face must be recovered');
    for(const y of [37,92])assert.ok(r.contours.slice(1).some(p=>{const b=box(p);return b.minX<64*size/128&&b.maxX>64*size/128&&b.minY<y*size/128&&b.maxY>y*size/128;}),'actual hole position must be retained');
  }
});
check('2048-pixel photo stays within a 10-second processing budget',()=>{const start=performance.now();const r=trace(2048,1024,(x,y)=>disk(x,y,1024,512,300)&&!disk(x,y,1024,512,100)?fg:bg);assert.equal(r.contours.length,2);assert.ok(performance.now()-start<10000);});
mkdirSync(new URL('../test-artifacts/',import.meta.url),{recursive:true});
writeFileSync(new URL('../test-artifacts/autotrace-edge-cases.json',import.meta.url),JSON.stringify(results,null,2));
const failures=results.filter(r=>r.status==='fail');
console.log(`auto-trace edge cases: ${results.length-failures.length}/${results.length} passed`);
if(failures.length) process.exitCode=1;
