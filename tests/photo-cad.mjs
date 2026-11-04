import assert from 'node:assert/strict';
import {autoTraceRaster,traceTrainedMask} from '../js/autotrace.js';
import {outlineIssue,outlinePoints,splitOutlineSegment,closestOnSegment} from '../js/outline-editor.js';
import {polyToSegments,closestPointOnEntity,polyAreaPerimeter} from '../js/geom.js';
import {readDXF,writeDXF} from '../js/dxf.js';

for(const angle of [0,.31,.87,1.6])for(const shape of ['bracket','capsule','notch']){
  const width=480,data=new Uint8ClampedArray(width*width*4),mask=new Uint8Array(width*width);
  for(let y=0;y<width;y++)for(let x=0;x<width;x++){
    const u=(x-240)*Math.cos(angle)+(y-240)*Math.sin(angle),v=-(x-240)*Math.sin(angle)+(y-240)*Math.cos(angle);
    const solid=shape==='bracket'?u>-140&&u<140&&v>-110&&v<110&&!(u>-65&&v>-40):
      shape==='capsule'?Math.hypot(Math.max(0,Math.abs(u)-75),v)<65:
      Math.abs(u)<140&&Math.abs(v)<100&&!(Math.abs(u)<5&&v>70);
    const hole=shape==='bracket'&&Math.hypot(u+105,v+75)<12;
    const i=y*width+x,j=i*4;mask[i]=solid&&!hole?1:0;
    data[j]=data[j+1]=data[j+2]=mask[i]?20+(x*y%7):245+(x+y)%5;data[j+3]=255;
  }
  const result=autoTraceRaster(width,width,data),entity=result.entities[0],label=`${shape} at ${angle}`;
  assert.equal(outlineIssue(result.entities),'',label+': valid geometry');
  assert.equal(entity.type,'poly',label+': preserve noncircular profile');
  assert.ok(entity.pts.length<=24,label+': compact CAD profile, got '+entity.pts.length);
  if(shape==='capsule'){
    assert.ok(entity.pts.some(p=>p.bulge),label+': true circular arcs');
    const pts=entity.pts,joins=pts.map((b,i)=>{
      const a=pts[(i+pts.length-1)%pts.length],c=pts[(i+1)%pts.length];
      if(Boolean(a.bulge)===Boolean(b.bulge))return Infinity;
      const incoming=Math.atan2(b.y-a.y,b.x-a.x)+2*Math.atan(a.bulge||0);
      const outgoing=Math.atan2(c.y-b.y,c.x-b.x)-2*Math.atan(b.bulge||0);
      return Math.abs(Math.atan2(Math.sin(outgoing-incoming),Math.cos(outgoing-incoming)));
    });
    assert.ok(joins.some(a=>a<.02),label+': a line and arc meet tangentially');
  }
  if(shape==='bracket'){
    assert.equal(result.entities.length,2,label+': keep mounting hole');
    assert.equal(result.entities[1].type,'circle',label+': exact CAD hole');
  }
  const segs=polyToSegments(entity);
  for(const p of result.contours[0])assert.ok(segs.some(s=>closestPointOnEntity(s,p).d<=1.5),label+': raster fidelity');
  const samples=outlinePoints(entity);
  assert.ok(samples.every(p=>result.contours[0].some((a,i)=>closestOnSegment(p,a,result.contours[0][(i+1)%result.contours[0].length]).distance<=1.5)),label+': no invented boundary');
  const dx=readDXF(writeDXF(result.entities.map(e=>({...e,layer:'L0'})),[{id:'L0',name:'Part',color:'#ffffff'}],{}));
  assert.equal(dx.warnings.length,0,label+': DXF parses');
  assert.equal(dx.entities[0].pts.length,entity.pts.length,label+': DXF keeps segment count');
  entity.pts.forEach((p,i)=>assert.ok(Math.abs((dx.entities[0].pts[i].bulge||0)-(p.bulge||0))<1e-8,label+': DXF keeps arcs'));
  if(angle===.31){
    const trained=traceTrainedMask(width,width,data,mask,result);
    assert.ok(trained.entities[0].pts.length<=24,label+': trained path also fits CAD primitives');
    console.log(`${label}: ${result.contours[0].length} raster segments → ${entity.pts.length} CAD segments`);
  }
}
for(const bulge of [1,-1]){
  const e={type:'poly',closed:true,pts:[{x:0,y:0,bulge},{x:40,y:0},{x:40,y:40},{x:0,y:40}]};
  const before=polyAreaPerimeter(e),closest=closestOnSegment({x:20,y:-20*bulge},e.pts[0],e.pts[1]);
  assert.ok(closest.distance<1e-8,'arc hit testing follows curve');
  splitOutlineSegment(e,0,closest.point);
  const after=polyAreaPerimeter(e);
  assert.deepEqual(Object.keys(after),Object.keys(before));
  for(const key of Object.keys(before))assert.ok(Math.abs(before[key]-after[key])<1e-6,'split retains '+key);
}

// A model can fill apertures. Recover dark material against local paper instead
// of requiring every opening to match the wood at the image border.
{
  const w=480,rgba=new Uint8ClampedArray(w*w*4),mask=new Uint8Array(w*w);
  for(let y=0;y<w;y++)for(let x=0;x<w;x++){
    const outer=x>=90&&x<=390&&y>=90&&y<=390;
    const hole=(x>135&&x<345&&y>135&&y<345)||[[112,112],[368,112],[112,368],[368,368]].some(([cx,cy])=>Math.hypot(x-cx,y-cy)<10);
    const color=outer&&!hole?[22,24,28]:x>40&&x<440&&y>40&&y<440?[232,230,224]:[145+(y%13),104,66];
    const j=(y*w+x)*4;rgba.set([...color,255],j);mask[y*w+x]=outer?1:0;
  }
  const proposal={contours:[[{x:90,y:90},{x:391,y:90},{x:391,y:391},{x:90,y:391}]],warnings:[],quality:{weakSegments:[],weakBoundaryFraction:0},segmentation:'background-distance'};
  const r=traceTrainedMask(w,w,rgba,mask,proposal);
  assert.equal(r.entities.length,6,'local material recovers center and all four bolt holes on paper inside wood scene');
  assert.equal(r.entities.filter(e=>e.type==='circle').length,4,'recovered bolt holes are CAD circles');
}
// A rounded-rectangle gasket is designed from tangent lines and quarter arcs.
for(const angle of [0,.31,1.6]){
  const w=720,rgba=new Uint8ClampedArray(w*w*4);
  const rounded=(x,y,hx,hy,r)=>{const dx=Math.abs(x)-(hx-r),dy=Math.abs(y)-(hy-r);return Math.hypot(Math.max(dx,0),Math.max(dy,0))+Math.min(Math.max(dx,dy),0)<=r;};
  for(let y=0;y<w;y++)for(let x=0;x<w;x++){
    const u=(x-360)*Math.cos(angle)+(y-360)*Math.sin(angle),v=-(x-360)*Math.sin(angle)+(y-360)*Math.cos(angle);
    const color=rounded(u,v,250,240,60)&&!rounded(u,v,210,200,20)?20:245,i=(y*w+x)*4;
    rgba[i]=rgba[i+1]=rgba[i+2]=color;rgba[i+3]=255;
  }
  const result=autoTraceRaster(w,w,rgba);
  assert.equal(result.entities.length,2);
  for(const e of result.entities){
    assert.equal(e.type,'poly');assert.equal(e.pts.length,8,'rounded rectangle has eight CAD segments');
    assert.equal(e.pts.filter(p=>p.bulge).length,4,'rounded rectangle has four quarter arcs');
    const [hx,hy,radius]=e===result.entities[0]?[250,240,60]:[210,200,20];
    for(const point of outlinePoints(e)){
      const u=(point.x-360)*Math.cos(angle)+(point.y-360)*Math.sin(angle),v=-(point.x-360)*Math.sin(angle)+(point.y-360)*Math.cos(angle);
      const dx=Math.abs(u)-(hx-radius),dy=Math.abs(v)-(hy-radius);
      assert.ok(Math.abs(Math.hypot(Math.max(dx,0),Math.max(dy,0))+Math.min(Math.max(dx,dy),0)-radius)<2.5,'fitted arcs retain the known design boundary');
    }
    for(let i=0;i<e.pts.length;i++){
      const a=e.pts[(i+e.pts.length-1)%e.pts.length],b=e.pts[i],c=e.pts[(i+1)%e.pts.length];
      const incoming=Math.atan2(b.y-a.y,b.x-a.x)+2*Math.atan(a.bulge||0),outgoing=Math.atan2(c.y-b.y,c.x-b.x)-2*Math.atan(b.bulge||0);
      assert.ok(Math.abs(Math.atan2(Math.sin(outgoing-incoming),Math.cos(outgoing-incoming)))<1e-8,'every rounded-rectangle join is tangent');
    }
  }
}
console.log('PASS: CAD fitting, rotations, holes, narrow notches, trained masks, fidelity, DXF and arc editing');
