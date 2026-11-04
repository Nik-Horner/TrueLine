// Local supplied-photo regression. Photos and generated model output stay ignored.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {outlineIssue} from '../js/outline-editor.js';
import {writeDXF,readDXF} from '../js/dxf.js';
const dir=process.argv[2]||'test-artifacts/user-photos/current';
const inside=(p,loop)=>{let yes=false;for(let i=0,j=loop.length-1;i<loop.length;j=i++){const a=loop[i],b=loop[j];if((a.y>p.y)!==(b.y>p.y)&&p.x<(b.x-a.x)*(p.y-a.y)/(b.y-a.y)+a.x)yes=!yes;}return yes;};
for(const [id,holes,expectedCircles] of [
  ['IMG_5422',[[221,557],[939,606],[269,1265],[838,1254]],4],
  ['IMG_5418',[[191,697],[913,611],[356,1361],[920,1301]],null],
  ['IMG_5419',[],2],
]){
  const result=JSON.parse(fs.readFileSync(path.join(dir,id+'-browser-geometry.json')));
  assert.equal(outlineIssue(result.entities),'',id+': valid CAD');
  assert.equal(result.entities.length,holes.length?6:2,id+': all openings, no invented contours');
  for(const [x,y] of holes)assert.ok(result.contours.slice(1).some(c=>inside({x,y},c)),id+': keep bolt hole at '+x+','+y);
  const count=result.entities.reduce((n,e)=>n+(e.type==='circle'?1:e.pts.length),0);
  assert.ok(count<(id==='IMG_5422'?60:160),id+': compact output, got '+count);
  if(id==='IMG_5422')assert.ok(result.entities.slice(0,2).every(e=>e.type==='poly'&&e.pts.some(p=>p.bulge)),id+': boundaries retain true CAD arcs');
  if(expectedCircles!==null)assert.equal(result.entities.filter(e=>e.type==='circle').length,expectedCircles,id+': circles use CAD primitives');
  const dxf=readDXF(writeDXF(result.entities.map(e=>({...e,layer:'L0'})),[{id:'L0',name:'Outline',color:'#ffffff'}],{}));
  assert.equal(dxf.warnings.length,0);assert.equal(dxf.entities.length,result.entities.length);
  if(id==='IMG_5422'){
    let tangentJoins=0;
    for(const e of dxf.entities.filter(e=>e.type==='poly'))for(let i=0;i<e.pts.length;i++){
      const pts=e.pts,a=pts[(i+pts.length-1)%pts.length],b=pts[i],c=pts[(i+1)%pts.length];
      if(Boolean(a.bulge)===Boolean(b.bulge))continue;
      const u=Math.atan2(b.y-a.y,b.x-a.x)+2*Math.atan(a.bulge||0),v=Math.atan2(c.y-b.y,c.x-b.x)-2*Math.atan(b.bulge||0);
      if(Math.abs(Math.atan2(Math.sin(v-u),Math.cos(v-u)))<.02)tangentJoins++;
    }
    assert.ok(tangentJoins>=8,'paper gasket retains tangent line/arc joins in DXF');
  }
  console.log(id+': '+result.entities.length+' contours, '+count+' CAD primitives');
}
console.log('PASS: supplied gasket paper/wood and ring photos, all holes, circle fitting and DXF');
