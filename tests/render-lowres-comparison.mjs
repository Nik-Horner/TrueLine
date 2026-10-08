// Historical outlines are archived artifacts; cyan lines are actual extractor
// output, never reference annotations or manually corrected geometry.
import{execFileSync as exec}from'node:child_process';import{readFileSync}from'node:fs';
const dir=new URL('../test-artifacts/resolution-checks/',import.meta.url),path=name=>new URL(name,dir).pathname,rows=[];
for(const name of ['steel-bracket-84','foam-irregular-555']){
 const input=path(name+'-input.png'),panels=[];
 for(const version of ['source','before','current']){
  const args=[input];let label='SOURCE';
  if(version!=='source'){
   const r=JSON.parse(readFileSync(path(name+(version==='before'?'-before':'')+'-geometry.json'))),draw=r.entities.map(e=>e.type==='circle'?`circle ${e.c.x},${e.c.y} ${e.c.x+e.r},${e.c.y}`:`path 'M${e.pts.map(p=>`${p.x},${p.y}`).join(' L')} Z'`).join(' ');
   args.push('-fill','none','-stroke','#00ffff','-strokewidth','.65','-draw',draw);label=(version==='before'?'BEFORE':'CURRENT')+' / '+r.contours.length+' contours';
  }
  if(name.startsWith('foam'))args.push('-crop','130x80+190+75','+repage');
  const panel=path(name+'-lowres-'+version+'-panel.png');args.push('-resize','460x400','-background','#172536','-gravity','center','-extent','480x460','-font','DejaVu-Sans','-fill','#e7edf6','-pointsize','18','-gravity','northwest','-annotate','+12+28',label,panel);exec('magick',args);panels.push(panel);
 }
 const row=path(name+'-fixed-comparison.png');exec('magick',[...panels,'+append','-background','#0c1420','-gravity','north','-splice','0x55','-font','DejaVu-Sans','-fill','#e7edf6','-pointsize','22','-gravity','northwest','-annotate','+20+32',name.startsWith('steel')?'Small steel bracket: whole body and both mounting holes':'Irregular gasket: shaded center opening recovered (detail crop)',row]);rows.push(row);
}
exec('magick',[...rows,'-append',path('lowres-fixed-comparison.png')]);
console.log('Wrote resolution-checks/lowres-fixed-comparison.png');
