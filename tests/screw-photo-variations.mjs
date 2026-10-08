// Photo perturbations share one capture; they are not independent examples.
import assert from 'node:assert/strict';
import {execFileSync as exec} from 'node:child_process';
import {readFileSync,writeFileSync} from 'node:fs';
import {autoTraceRaster} from '../js/autotrace.js';
import {autoTraceRaster as previousTrace} from './fixtures/autotrace-before-precision.js';
const dir=new URL('../test-artifacts/complex-parts/',import.meta.url),source=new URL('screw-input.png',dir).pathname;
const ref=JSON.parse(readFileSync(new URL('./fixtures/screw-reference.json',import.meta.url))).points;
const variants=[['rotated',['-rotate','90']],['darker',['-evaluate','multiply','.85']],['brighter',['-evaluate','multiply','1.15']],['mild-blur',['-blur','0x.6']],['compressed',['-quality','60']]];
const inside=(x,y,c)=>{let v=false;for(let i=0,j=c.length-1;i<c.length;j=i++){const a=c[i],b=c[j];if((a.y>y)!==(b.y>y)&&x<(b.x-a.x)*(y-a.y)/(b.y-a.y)+a.x)v=!v;}return v;};
const rows=[];
for(const [id,transform] of variants){
 const file=new URL('screw-variation-'+id+(id==='compressed'?'.jpg':'.png'),dir).pathname;exec('magick',[source,...transform,file]);
 const data=exec('magick',[file,'-depth','8','RGBA:-']);const reference=id==='rotated'?ref.map(p=>({x:256-p.y,y:p.x})):ref;
 const row={id,transform,independentCapture:false};
 for(const [label,trace] of [['previous',previousTrace],['current',autoTraceRaster]]){
  const r=trace(256,256,data);if(label==='current')assert.equal(r.contours.length,1,id+': screw remains one silhouette');let intersection=0,union=0;
  for(let y=0;y<256;y++)for(let x=0;x<256;x++){const a=inside(x+.5,y+.5,reference),b=inside(x+.5,y+.5,r.contours[0]);intersection+=a&&b;union+=a||b;}
  row[label]={contours:r.contours.length,silhouetteIoU:intersection/union};
 }
 assert.ok(row.current.silhouetteIoU>.75,id+': photo variation must not destroy silhouette');rows.push(row);
}
const average=label=>rows.reduce((s,r)=>s+r[label].silhouetteIoU,0)/rows.length;
assert.ok(average('current')>=average('previous'),'thread refinement must improve the variation set as well as the original photo');
writeFileSync(new URL('screw-variations.json',dir),JSON.stringify({independentPhotos:1,cases:rows,meanPrevious:average('previous'),meanCurrent:average('current')},null,2));
console.log(`PASS: five screw photo variations; average silhouette overlap ${(average('previous')*100).toFixed(1)}% → ${(average('current')*100).toFixed(1)}%.`);
