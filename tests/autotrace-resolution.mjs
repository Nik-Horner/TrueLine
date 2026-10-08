// Resolution changes are transformations of existing photos, not new captures.
import assert from 'node:assert/strict';
import {execFileSync as exec} from 'node:child_process';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {autoTraceRaster} from '../js/autotrace.js';
const dir=new URL('../test-artifacts/resolution-checks/',import.meta.url);mkdirSync(dir,{recursive:true});
const ref=JSON.parse(readFileSync(new URL('./fixtures/screw-reference.json',import.meta.url))).points;
const inside=(x,y,c)=>{let v=false;for(let i=0,j=c.length-1;i<c.length;j=i++){const a=c[i],b=c[j];if((a.y>y)!==(b.y>y)&&x<(b.x-a.x)*(y-a.y)/(b.y-a.y)+a.x)v=!v;}return v;};
const annotations=JSON.parse(readFileSync(new URL('./fixtures/precision-reference.json',import.meta.url)));
const plateCenters=annotations['white-switch-plate'].visibleOpeningCenters;
const rows=[];
const cases=[...[128,192,256,384,512,768].map(size=>({id:'screw',size,expected:1})),
 ...[.4,.5,.6,.75,1,1.25,1.5].map(factor=>({id:'foam-rectangular',factor,expected:49})),
 ...[.4,.6,.75,1,1.25,1.5,2].map(factor=>({id:'steel-bracket',factor,expected:3})),
 ...[.5,1].map(factor=>({id:'white-switch-plate',factor,visible:25})),
 // Previously failing cases are mandatory regressions.
 {id:'steel-bracket',factor:.5,expected:3},
 ...[.4,.5,.6,.75,1.25,1.5].map(factor=>({id:'foam-irregular',factor,expected:50}))];
for(const c of cases){
 const source=new URL('../test-artifacts/complex-parts/'+c.id+'-input.png',import.meta.url).pathname;
 const [sw,sh]=exec('magick',['identify','-format','%w %h',source]).toString().split(' ').map(Number);
 const w=c.size||Math.round(sw*c.factor),h=c.size||Math.round(sh*c.factor),name=c.id+'-'+w;
 const input=new URL(name+'-input.png',dir).pathname;exec('magick',[source,'-resize',`${w}x${h}!`,input]);
 const data=exec('magick',[input,'-depth','8','RGBA:-'],{maxBuffer:32e6}),r=autoTraceRaster(w,h,data);
 const row={id:c.id,width:w,height:h,expectedContours:c.expected,actualContours:r.contours.length,topologyMatches:r.contours.length===c.expected,warnings:r.warnings};
 if(c.id==='screw'){
  const outline=r.contours[0].map(p=>({x:p.x*256/w,y:p.y*256/h}));let union=0,intersection=0;
  for(let y=0;y<256;y++)for(let x=0;x<256;x++){const a=inside(x+.5,y+.5,ref),b=inside(x+.5,y+.5,outline);union+=a||b;intersection+=a&&b;}
  row.silhouetteIoU=intersection/union;assert.ok(row.silhouetteIoU>.8,name+': silhouette must remain above 80% overlap');
 }
 if(c.id==='steel-bracket'){
  const outline=annotations['steel-bracket'].outline.map(([x,y])=>({x:x*w/sw,y:y*h/sh}));let union=0,intersection=0;
  for(let y=0;y<h;y++)for(let x=0;x<w;x++){const a=inside(x+.5,y+.5,outline),b=inside(x+.5,y+.5,r.contours[0]);union+=a||b;intersection+=a&&b;}
  row.silhouetteIoU=intersection/union;
  row.holesLocated=annotations['steel-bracket'].holes.filter(([x,y])=>r.contours.slice(1).some(loop=>inside(x*w/sw,y*h/sh,loop))).length;
  assert.equal(row.holesLocated,2,name+': both actual hole locations');assert.ok(row.silhouetteIoU>.8,name+': annotated full-body silhouette');
 }
 if(c.id.startsWith('foam-')){
  const full=JSON.parse(readFileSync(new URL('../test-artifacts/complex-parts/'+c.id+'-after-geometry.json',import.meta.url)));
  row.referenceOpeningsLocated=full.contours.slice(1).filter(loop=>{const x=loop.reduce((s,p)=>s+p.x,0)/loop.length*w/sw,y=loop.reduce((s,p)=>s+p.y,0)/loop.length*h/sh;return r.contours.slice(1).some(p=>inside(x,y,p));}).length;
  assert.equal(row.referenceOpeningsLocated,c.expected-1,name+': opening positions preserved across resolution');
 }
 if(c.visible){row.visibleOpeningsLocated=plateCenters.filter(([x,y])=>r.contours.slice(1).some(loop=>inside(x*w/sw,y*h/sh,loop))).length;row.expectedVisibleOpenings=c.visible;row.topologyMatches=row.visibleOpeningsLocated===c.visible;assert.equal(row.visibleOpeningsLocated,c.visible,name+': visible openings');}
 if(!c.visible)assert.equal(r.contours.length,c.expected,name+': contour topology');
 row.status=row.topologyMatches?'pass':'remaining failure';rows.push(row);
 if(['screw-512','foam-rectangular-555','steel-bracket-84','foam-irregular-555'].includes(name)){
  writeFileSync(new URL(name+'-geometry.json',dir),JSON.stringify(r));
  const draw=r.entities.map(e=>e.type==='circle'?`circle ${e.c.x},${e.c.y} ${e.c.x+e.r},${e.c.y}`:`path 'M${e.pts.map(p=>`${p.x},${p.y}`).join(' L')} Z'`).join(' ');
  exec('magick',[input,'-fill','none','-stroke','#00ffff','-strokewidth','1','-draw',draw,new URL(name+'-current.png',dir).pathname]);
 }
}
writeFileSync(new URL('results.json',dir),JSON.stringify({method:'Resolution transforms of five existing photographs. Screw silhouette annotation uncertainty approximately ±2 original pixels; no dimensional accuracy claim.',cases:rows},null,2));
const passed=rows.filter(r=>r.status==='pass').length;
console.log(`Resolution checks: ${passed}/${rows.length} cases pass; screw and bracket silhouettes exceed 80% overlap, both bracket holes and all foam opening positions are retained.`);
