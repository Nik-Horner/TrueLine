// Test-only visual annotations never participate in the extractor.
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
const dir=new URL('../test-artifacts/complex-parts/',import.meta.url);
const read=name=>JSON.parse(readFileSync(new URL(name,dir)));
const inside=(p,loop)=>{let yes=false;for(let i=0,j=loop.length-1;i<loop.length;j=i++) {const a=loop[i],b=loop[j];if((a.y>p.y)!==(b.y>p.y)&&p.x<(b.x-a.x)*(p.y-a.y)/(b.y-a.y)+a.x)yes=!yes;}return yes;};
const referenceAnnotation=JSON.parse(readFileSync(new URL('./fixtures/screw-reference.json',import.meta.url)));
writeFileSync(new URL('screw-reference.json',dir),JSON.stringify(referenceAnnotation,null,2));
const reference=referenceAnnotation.points;
const metrics={annotation:'Independent visual silhouette annotation; approximately ±2 source pixels of uncertainty. Raster overlap, not dimensional accuracy.'};
for(const version of ['before','after']){
 const contours=read('screw-'+version+'-geometry.json').contours;let intersection=0,union=0,extra=0,missing=0;
 for(let y=0;y<256;y++)for(let x=0;x<256;x++){const p={x:x+.5,y:y+.5},a=inside(p,reference),b=inside(p,contours[0]);intersection+=a&&b;union+=a||b;extra+=b&&!a;missing+=a&&!b;}
 metrics[version]={silhouetteIoU:intersection/union,extraPixels:extra,missingPixels:missing};
}
assert.ok(metrics.after.silhouetteIoU>.78,'screw must follow the annotated material silhouette');
assert.ok(metrics.after.silhouetteIoU>metrics.before.silhouetteIoU+.15,'screw improvement must exceed contour-count changes');
assert.ok(metrics.after.extraPixels<metrics.before.extraPixels*.4,'screw shadow overreach must fall substantially');
const orientation=(a,b,c)=>(b.x-a.x)*(c.y-a.y)-(b.y-a.y)*(c.x-a.x);
for(const record of read('results.json'))for(const c of read(record.id+'-after-geometry.json').contours){
 for(let i=0;i<c.length;i++)for(let j=i+2;j<c.length;j++){
  if(i===0&&j===c.length-1)continue;
  const a=c[i],b=c[(i+1)%c.length],d=c[j],e=c[(j+1)%c.length];
  assert.ok(!(orientation(a,b,d)*orientation(a,b,e)<-1e-8&&orientation(d,e,a)*orientation(d,e,b)<-1e-8),record.id+': contour must not cross itself');
 }
}
const rect=read('foam-rectangular-after-geometry.json'),irregular=read('foam-irregular-after-geometry.json');
assert.equal(rect.contours.length,49,'rectangular plate: outside plus 48 apertures');
assert.equal(irregular.contours.length,50,'irregular plate: outside plus 48 key apertures and center opening');
const probes=[{x:205,y:78},{x:264,y:86},{x:638,y:101},{x:702,y:83}];
for(const p of probes)assert.ok(rect.contours.slice(1).some(c=>inside(p,c)),`shaded aperture region at ${p.x},${p.y} must be retained`);
metrics.apertureChecks={rectangular:48,irregular:49,shadedRegionProbes:probes};
writeFileSync(new URL('accuracy.json',dir),JSON.stringify(metrics,null,2));
console.log(`Complex photo regressions passed: screw IoU ${(metrics.before.silhouetteIoU*100).toFixed(1)}% → ${(metrics.after.silhouetteIoU*100).toFixed(1)}%; 97 foam apertures and four shaded-region probes.`);
