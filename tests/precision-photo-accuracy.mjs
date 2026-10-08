import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {execFileSync as exec} from 'node:child_process';
import {autoTraceRaster} from '../js/autotrace.js';
import {autoTraceRaster as previousTrace} from './fixtures/autotrace-before-precision.js';
const dir=new URL('../test-artifacts/complex-parts/',import.meta.url);
const annotation=JSON.parse(readFileSync(new URL('./fixtures/precision-reference.json',import.meta.url)));
const inside=([x,y],loop)=>{let v=false;for(let i=0,j=loop.length-1;i<loop.length;j=i++){const a=loop[i],b=loop[j];if((a.y>y)!==(b.y>y)&&x<(b.x-a.x)*(y-a.y)/(b.y-a.y)+a.x)v=!v;}return v;};
const distance=([x,y],a,b)=>{const dx=b.x-a.x,dy=b.y-a.y,t=Math.max(0,Math.min(1,((x-a.x)*dx+(y-a.y)*dy)/(dx*dx+dy*dy||1)));return Math.hypot(x-a.x-t*dx,y-a.y-t*dy);};
const edgeDistance=(p,loops)=>Math.min(...loops.flatMap(c=>c.map((a,i)=>distance(p,a,c[(i+1)%c.length]))));
const metrics={method:annotation.method};
for(const id of ['steel-bracket','white-switch-plate']){
 const input=new URL(id+'-input.png',dir).pathname,[w,h]=exec('magick',['identify','-format','%w %h',input]).toString().split(' ').map(Number),rgba=exec('magick',[input,'-depth','8','RGBA:-'],{maxBuffer:32e6});
 metrics[id]={};const panels=[];
 const sourcePanel=new URL('precision-'+id+'-source-panel.png',dir).pathname;
 exec('magick',[input,'-resize','630x370','-background','#172536','-gravity','center','-extent','650x430','-font','DejaVu-Sans','-fill','#e7edf6','-pointsize','18','-gravity','northwest','-annotate','+14+28','SOURCE PHOTOGRAPH',sourcePanel]);panels.push(sourcePanel);
 for(const [version,fn] of [['previous',previousTrace],['current',autoTraceRaster]]){
  const r=fn(w,h,rgba),m={contours:r.contours.length};
  if(id==='steel-bracket'){
   const ref=annotation[id].outline.map(([x,y])=>({x,y}));let union=0,intersection=0;
   for(let y=0;y<h;y++)for(let x=0;x<w;x++){const a=inside([x+.5,y+.5],ref),b=inside([x+.5,y+.5],r.contours[0]);union+=a||b;intersection+=a&&b;}
   m.silhouetteIoU=intersection/union;m.holesLocated=annotation[id].holes.filter(p=>r.contours.slice(1).some(c=>inside(p,c))).length;
   const samples=[];const outline=annotation[id].outline;
   for(let i=0;i<outline.length;i++){const a=outline[i],b=outline[(i+1)%outline.length],steps=Math.ceil(Math.hypot(b[0]-a[0],b[1]-a[1])/2);for(let k=0;k<steps;k++)samples.push([a[0]+(b[0]-a[0])*k/steps,a[1]+(b[1]-a[1])*k/steps]);}
   const errors=samples.map(p=>edgeDistance(p,[r.contours[0]]));m.meanBoundaryErrorPx=errors.reduce((s,v)=>s+v,0)/errors.length;m.maxBoundaryErrorPx=Math.max(...errors);
  }else{
   m.visibleOpeningsLocated=annotation[id].visibleOpeningCenters.filter(p=>r.contours.slice(1).some(c=>inside(p,c))).length;
   const errors=annotation[id].boundarySamples.map(p=>edgeDistance(p,r.contours.slice(1))).sort((a,b)=>a-b);m.meanBoundaryErrorPx=errors.reduce((s,v)=>s+v,0)/errors.length;m.p95BoundaryErrorPx=errors[Math.floor(errors.length*.95)];
  }
  metrics[id][version]=m;
  const overlay=new URL('precision-'+id+'-'+version+'.png',dir).pathname,draw=r.entities.map(e=>e.type==='circle'?`circle ${e.c.x},${e.c.y} ${e.c.x+e.r},${e.c.y}`:`path 'M${e.pts.map(p=>`${p.x},${p.y}`).join(' L')} Z'`);
  exec('magick',[input,'-fill','none','-stroke','#00ffff','-strokewidth',String(Math.max(1,w/700)),'-draw',draw.join(' '),overlay]);
  const panel=new URL('precision-'+id+'-'+version+'-panel.png',dir).pathname;
  exec('magick',[overlay,'-resize','630x370','-background','#172536','-gravity','center','-extent','650x430','-font','DejaVu-Sans','-fill','#e7edf6','-pointsize','18','-gravity','northwest','-annotate','+14+28',version==='previous'?'PREVIOUS TURN':'CURRENT EXTRACTOR',panel]);panels.push(panel);
 }
 exec('magick',[...panels,'+append','-background','#0c1420','-gravity','north','-splice','0x65','-font','DejaVu-Sans','-fill','#f2f6fb','-pointsize','24','-gravity','northwest','-annotate','+20+31',id==='steel-bracket'?'Steel bracket: full profile and two holes':'White plate: all 25 unobscured key openings located',new URL('precision-'+id+'-comparison.png',dir).pathname]);
}
exec('magick',[...['steel-bracket','white-switch-plate'].map(id=>new URL('precision-'+id+'-comparison.png',dir).pathname),'-append',new URL('../precision-parts-review.png',dir).pathname]);
console.log(JSON.stringify(metrics,null,2));
writeFileSync(new URL('precision-accuracy.json',dir),JSON.stringify(metrics,null,2));
assert.equal(metrics['steel-bracket'].current.holesLocated,2);
assert.ok(metrics['steel-bracket'].current.silhouetteIoU>.8);
assert.equal(metrics['white-switch-plate'].current.visibleOpeningsLocated,25);
assert.ok(metrics['steel-bracket'].current.meanBoundaryErrorPx<2);
assert.ok(metrics['white-switch-plate'].current.meanBoundaryErrorPx<4);
assert.ok(metrics['white-switch-plate'].current.meanBoundaryErrorPx<metrics['white-switch-plate'].previous.meanBoundaryErrorPx*.5);
