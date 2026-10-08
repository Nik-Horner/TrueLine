import {execFileSync as exec} from 'node:child_process';
import {existsSync,mkdirSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {autoTraceRaster} from '../js/autotrace.js';
import {autoTraceRaster as baselineTrace} from './fixtures/autotrace-before-complex.js';
const dir=fileURLToPath(new URL('../test-artifacts/complex-parts/',import.meta.url));mkdirSync(dir,{recursive:true});
const foam='https://raw.githubusercontent.com/foostan/corneliuskbd/2fa8e256f20cf210a2121b2bd4fe5990921286ee/docs/v1/images/package-foam.jpg';
const iad='https://raw.githubusercontent.com/realiad4ad/Real-IAD/8f774faa776cd01b974d1ed4283473190201a178/assets/images/sample_data.png';
const mpdd2='https://raw.githubusercontent.com/stepanje/MPDD2/36464e836064851f07017e5896b03b27d2fd6068/samples.png';
const cases=[
 {id:'foam-rectangular',title:'Flat foam plate: dozens of rectangular openings',url:foam,source:'foam.jpg',crop:'1110x360+230+45',kind:'Flat part on a tabletop',credit:'foostan/corneliuskbd; CC BY-NC-SA 4.0'},
 {id:'foam-irregular',title:'Flat foam gasket: irregular openings and thin webs',url:foam,source:'foam.jpg',crop:'1110x375+230+420',kind:'Flat part on a tabletop',credit:'foostan/corneliuskbd; CC BY-NC-SA 4.0'},
 {id:'white-switch-plate',title:'White switch plate on wood: cutouts, bolt holes, occlusion',url:'https://raw.githubusercontent.com/jpconstantineau/ErgoTravel/e9be40f69359cc593c21303f7be7bc1916a83468/images/alps_ergotravel_plate.jpg',source:'white-plate.jpg',kind:'Flat part photographed at an angle; one opening is occluded',credit:'jpconstantineau/ErgoTravel; image-specific license not verified'},
 {id:'sim-slot',title:'Metal SIM carrier: slot, side rail and concave profile',url:iad,source:'realiad.png',crop:'330x300+1745+410',kind:'Real industrial photograph; projected outline',credit:'Real-IAD example collage, realiad4ad; website CC BY-SA 4.0, dataset terms separate'},
 {id:'white-bracket',title:'Notched white bracket: concave profile and opening',url:mpdd2,source:'mpdd2.png',crop:'168x168+383+41',kind:'Angled 3D bracket; projected outline only',credit:'Stepan Jezek et al., MPDD2; CC BY-NC-SA 4.0'},
 {id:'steel-bracket',title:'Dark steel bracket: two mounting holes on textured gray',url:mpdd2,source:'mpdd2.png',crop:'167x168+198+41',kind:'Angled 3D bracket; projected outline only',credit:'Stepan Jezek et al., MPDD2; CC BY-NC-SA 4.0'},
 {id:'screw',title:'Screw: threads and cast shadow',url:'https://raw.githubusercontent.com/openvinotoolkit/anomalib/9fb1337c0ac866797f4eedcaa0972d0f24a84f19/docs/source/images/uflow/results-mvtec-good.jpg',source:'mvtec.jpg',crop:'256x256+2374+0',kind:'3D screw; silhouette check, not a flat manufacturing profile',credit:'MVTec AD reproduced in anomalib; CC BY-NC-SA 4.0'},
];
const records=[];
for(const c of cases){
 const source=join(dir,c.source);if(!existsSync(source))exec('curl',['--fail','--location','--silent','--show-error','--max-time','45',c.url,'-o',source]);
 const input=join(dir,c.id+'-input.png'),args=[source];if(c.crop)args.push('-crop',c.crop,'+repage');args.push('-resize','2048x2048>','-background','white','-alpha','remove','-alpha','off','-depth','8',input);exec('magick',args);
 const [w,h]=exec('magick',['identify','-format','%w %h',input]).toString().split(' ').map(Number),rgba=exec('magick',[input,'-depth','8','RGBA:-'],{maxBuffer:32*1024*1024});
 const record={...c,width:w,height:h},panels=[];
 for(const [label,fn] of [['source',null],['before',baselineTrace],['after',autoTraceRaster]]){
  let r,error;const start=performance.now();if(fn){try{r=fn(w,h,rgba);}catch(e){error=e.message;}record[label]={contours:r?.contours.length||0,threshold:r?.threshold,elapsedMs:Math.round(performance.now()-start),error};if(r)writeFileSync(join(dir,c.id+'-'+label+'-geometry.json'),JSON.stringify(r,null,2));}
  const overlay=join(dir,c.id+'-'+label+'.png'),draw=[];
  for(const e of r?.entities||[]){if(e.type==='circle')draw.push(`circle ${e.c.x},${e.c.y} ${e.c.x+e.r},${e.c.y}`);else draw.push(`path 'M${e.pts.map(p=>`${p.x},${p.y}`).join(' L')} Z'`);}
  const a=[input,'-fill','none','-stroke','#00ffff','-strokewidth',String(Math.max(1,w/700))];if(draw.length)a.push('-draw',draw.join(' '));a.push(overlay);exec('magick',a);
  const panel=join(dir,c.id+'-'+label+'-panel.png');exec('magick',[overlay,'-resize','460x320','-background','#172536','-gravity','center','-extent','480x360','-font','DejaVu-Sans','-fill','#e7edf6','-pointsize','15','-gravity','northwest','-annotate','+14+24',label.toUpperCase()+(fn?` · ${record[label].contours} contours`:''),panel]);panels.push(panel);
 }
 exec('magick',[...panels,'+append','-background','#0c1420','-gravity','north','-splice','0x75','-font','DejaVu-Sans','-fill','#f2f6fb','-pointsize','22','-gravity','northwest','-annotate','+20+29',c.title,'-fill','#aab8c8','-pointsize','13','-annotate','+20+56',c.kind+' | Original photograph and production geometry; no manual outline edits',join(dir,c.id+'-comparison.png')]);
 records.push(record);console.log(JSON.stringify(record));
}
writeFileSync(join(dir,'results.json'),JSON.stringify(records,null,2));
writeFileSync(join(dir,'sources.json'),JSON.stringify(cases,null,2));
exec('magick',[...cases.map(c=>join(dir,c.id+'-comparison.png')),'-append',join(dir,'all-complex-results.png')]);
