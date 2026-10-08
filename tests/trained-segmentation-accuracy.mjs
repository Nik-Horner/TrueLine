// References are evaluation-only and never imported by the app or model.
import assert from 'node:assert/strict';
import{readFileSync,writeFileSync}from'node:fs';
import{execFileSync as exec}from'node:child_process';
import{autoTraceRaster}from'../js/autotrace.js';
import{outlineIssue}from'../js/outline-editor.js';
const root=new URL('../',import.meta.url),dir=new URL('test-artifacts/model-evaluation/',root),read=name=>JSON.parse(readFileSync(new URL(name,root)));
const refs=read('tests/fixtures/precision-reference.json'),additional=read('tests/fixtures/additional-part-reference.json'),screw=read('tests/fixtures/screw-reference.json').points;
const inside=(x,y,c)=>{let v=false;for(let i=0,j=c.length-1;i<c.length;j=i++){const a=c[i],b=c[j];if((a.y>y)!==(b.y>y)&&x<(b.x-a.x)*(y-a.y)/(b.y-a.y)+a.x)v=!v;}return v;};
const distance=(p,a,b)=>{const dx=b.x-a.x,dy=b.y-a.y,t=Math.max(0,Math.min(1,((p.x-a.x)*dx+(p.y-a.y)*dy)/(dx*dx+dy*dy||1)));return Math.hypot(p.x-a.x-t*dx,p.y-a.y-t*dy);};
const edgeError=(p,loops)=>Math.min(...loops.flatMap(c=>c.map((a,i)=>distance(p,a,c[(i+1)%c.length]))));
const rows=[],panels=[];
for(const id of ['screw','steel-bracket','foam-rectangular','foam-irregular','white-switch-plate','sim-slot','white-bracket',...Object.keys(additional.cases)]){
 const added=id.startsWith('sim-carrier-'),input=new URL((added?'test-artifacts/model-evaluation/additional-parts/':'test-artifacts/complex-parts/')+id+'-input.png',root).pathname;
 const [w,h]=exec('magick',['identify','-format','%w %h',input]).toString().split(' ').map(Number),rgba=exec('magick',[input,'-depth','8','RGBA:-'],{maxBuffer:32e6});
 const classic=autoTraceRaster(w,h,rgba),trained=JSON.parse(readFileSync(new URL(id+'-browser-geometry.json',dir)));
 assert.equal(outlineIssue(trained.entities),'',id+': trained outlines must be valid editable CAD contours');
 assert.ok(trained.engine.includes('MobileSAM')||trained.quality.trainedMaskRejected,id+': real-photo model execution');
 writeFileSync(new URL(id+'-classic-geometry.json',dir),JSON.stringify(classic));
 const reference=id==='screw'?screw:id==='steel-bracket'?refs[id].outline.map(([x,y])=>({x,y})):added?additional.cases[id].outline.map(([x,y])=>({x,y})):null;
 const openingPoints=id==='steel-bracket'?refs[id].holes:id==='white-switch-plate'?refs[id].visibleOpeningCenters:added?additional.cases[id].openings:null;
 const row={id,width:w,height:h,engine:trained.engine};
 for(const [label,r]of[['classic',classic],['trained',trained]]){
  const m={contours:r.contours.length};
  if(reference){
   let union=0,intersection=0;for(let y=0;y<h;y++)for(let x=0;x<w;x++){const a=inside(x+.5,y+.5,reference),b=inside(x+.5,y+.5,r.contours[0]);union+=a||b;intersection+=a&&b;}m.silhouetteIoU=intersection/union;
   const samples=[];for(let i=0;i<reference.length;i++){const a=reference[i],b=reference[(i+1)%reference.length],steps=Math.max(1,Math.ceil(Math.hypot(a.x-b.x,a.y-b.y)/2));for(let k=0;k<steps;k++)samples.push({x:a.x+(b.x-a.x)*k/steps,y:a.y+(b.y-a.y)*k/steps});}
   const errors=samples.map(p=>edgeError(p,[r.contours[0]])).sort((a,b)=>a-b);m.meanBoundaryErrorPx=errors.reduce((s,v)=>s+v,0)/errors.length;m.p95BoundaryErrorPx=errors[Math.floor(errors.length*.95)];
  }
  if(openingPoints)m.annotatedOpeningsLocated=openingPoints.filter(([x,y])=>r.contours.slice(1).some(c=>inside(x,y,c))).length;
  if(id==='white-switch-plate'){const errors=refs[id].boundarySamples.map(([x,y])=>edgeError({x,y},r.contours.slice(1)));m.meanOpeningBoundaryErrorPx=errors.reduce((s,v)=>s+v,0)/errors.length;}
  row[label]=m;
  const overlay=new URL(id+'-'+label+'-overlay.png',dir).pathname;
  exec('magick',[input,'-fill','none','-stroke','#00ffff','-strokewidth',String(Math.max(.7,w/1000)),'-draw',r.entities.map(e=>e.type==='circle'?`circle ${e.c.x},${e.c.y} ${e.c.x+e.r},${e.c.y}`:`path 'M${e.pts.map(p=>`${p.x},${p.y}`).join(' L')} Z'`).join(' '),overlay]);
 }
 if(id==='screw'){assert.equal(trained.contours.length,1,'screw: no false holes');assert.ok(row.trained.silhouetteIoU>=row.classic.silhouetteIoU,'screw: actual browser inference must not degrade silhouette');}
 if(id==='steel-bracket'){assert.ok(row.trained.silhouetteIoU>.9,'bracket: model must exceed 90% silhouette overlap');assert.equal(row.trained.annotatedOpeningsLocated,2);assert.ok(row.trained.meanBoundaryErrorPx<row.classic.meanBoundaryErrorPx);}
 if(id==='foam-rectangular'||id==='foam-irregular'){
  assert.equal(trained.contours.length,classic.contours.length,id+': thin material and all openings preserved');
  for(const c of classic.contours.slice(1)){const x=c.reduce((s,p)=>s+p.x,0)/c.length,y=c.reduce((s,p)=>s+p.y,0)/c.length;assert.ok(trained.contours.slice(1).some(loop=>inside(x,y,loop)),id+': existing opening location preserved');}
 }
 if(id==='white-switch-plate'){assert.equal(row.trained.annotatedOpeningsLocated,25);assert.ok(row.trained.meanOpeningBoundaryErrorPx<4);}
 if(added){assert.ok(row.trained.silhouetteIoU>.9,id+': recover the complete photographed body');assert.ok(row.trained.silhouetteIoU>=row.classic.silhouetteIoU,id+': improve existing detector');assert.equal(row.trained.annotatedOpeningsLocated,openingPoints.length,id+': every clearly visible main cutout');}
 rows.push(row);console.log(JSON.stringify(row));
 const group=[];for(const label of ['source','classic','trained']){
  const photo=label==='source'?input:new URL(id+'-'+label+'-overlay.png',dir).pathname,panel=new URL(id+'-'+label+'-panel.png',dir).pathname;
  exec('magick',[photo,'-resize','450x330','-background','#172536','-gravity','center','-extent','470x390','-font','DejaVu-Sans','-fill','#e7edf6','-pointsize','17','-gravity','northwest','-annotate','+12+26',label==='source'?'SOURCE PHOTO':label==='classic'?'PREVIOUS DETECTOR':'TRAINED MODEL + IMAGE EDGES',panel]);group.push(panel);
 }
 const comparison=new URL(id+'-comparison.png',dir).pathname;
 exec('magick',[...group,'+append','-background','#0c1420','-gravity','north','-splice','0x50','-font','DejaVu-Sans','-fill','#e7edf6','-pointsize','22','-gravity','northwest','-annotate','+20+31',id,comparison]);panels.push(comparison);
}
const annotated=rows.filter(r=>r.trained.silhouetteIoU!=null),mean=label=>annotated.reduce((s,r)=>s+r[label].silhouetteIoU,0)/annotated.length;
const metrics={method:'Six manually annotated silhouettes (source-pixel uncertainty approximately +/-2 to 3 pixels), 25 annotated visible plate openings, 97 foam opening checks, and four further carrier capture views. Carrier views are the same category; both foam crops share one photo. No reference or benchmark labels enter inference. Results measure photographed shapes, not physical dimensions.',cases:rows,meanClassicSilhouetteIoU:mean('classic'),meanTrainedSilhouetteIoU:mean('trained')};
writeFileSync(new URL('accuracy.json',dir),JSON.stringify(metrics,null,2));
exec('magick',[...['steel-bracket','sim-carrier-4','sim-carrier-5'].map(id=>new URL(id+'-comparison.png',dir).pathname),'-append',new URL('highlights.png',dir).pathname]);
console.log(`PASS: 11 actual-browser photo cases, six annotated silhouettes ${(mean('classic')*100).toFixed(1)}% → ${(mean('trained')*100).toFixed(1)}% mean overlap, and all required visible openings.`);
