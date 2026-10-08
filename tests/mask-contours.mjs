import assert from 'node:assert/strict';
import {maskContours} from '../js/mask-contours.js';
const field=(w,h,f)=>Float32Array.from({length:w*h},(_,i)=>f(i%w+.5,Math.floor(i/w)+.5));
const circle=maskContours(64,64,field(64,64,(x,y)=>14.2-Math.hypot(x-31.25,y-29.75)));
assert.equal(circle.length,1);
assert.ok(circle[0].every(p=>Math.abs(Math.hypot(p.x-31.25,p.y-29.75)-14.2)<.04),'subpixel crossings stay on the known circle');
assert.ok(circle[0].some(p=>p.x%1!==0&&p.y%1!==0),'retain fractional coordinates');
const ring=maskContours(64,64,field(64,64,(x,y)=>Math.min(18-Math.hypot(x-32,y-32),Math.hypot(x-32,y-32)-8)));
assert.equal(ring.length,2,'retain the opening as a separate loop');
for(const [positive,negative,count] of [[3,-1,1],[1,-3,2]]){
 const values=new Float32Array(36).fill(-10);values[2*6+2]=positive;values[3*6+3]=positive;values[2*6+3]=negative;values[3*6+2]=negative;
 assert.equal(maskContours(6,6,values).length,count,'resolve a saddle using continuous evidence');
}
assert.equal(maskContours(10,10,new Float32Array(100).fill(-1)).length,0);
assert.throws(()=>maskContours(10,10,new Float32Array(99)),/dimensions/);
assert.throws(()=>maskContours(512,512,field(512,512,(x,y)=>(Math.floor(x)+Math.floor(y))%2?1:-1)),/too much edge detail/,'pathological texture must fail within the geometry budget');
console.log('PASS: continuous mask circles, fractional precision, openings, saddle topology and invalid dimensions');
