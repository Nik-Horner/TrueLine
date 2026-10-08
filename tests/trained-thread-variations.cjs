// Perturbations of one real capture, not six independent part photographs.
const http=require('node:http'),fs=require('node:fs'),path=require('node:path'),{execFileSync:exec}=require('node:child_process'),puppeteer=require('puppeteer-core'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..'),dir=path.join(root,'test-artifacts/model-evaluation/thread-variants');fs.mkdirSync(dir,{recursive:true});
const variants=[['original',[]],['rotated',['-rotate','90']],['darker',['-evaluate','multiply','.85']],['brighter',['-evaluate','multiply','1.15']],['mild-blur',['-blur','0x.6']],['compressed',['-quality','60']]];
for(const[id,args]of variants)exec('magick',[path.join(root,'test-artifacts/complex-parts/screw-input.png'),...args,path.join(dir,id+(id==='compressed'?'.jpg':'.png'))]);
const server=http.createServer((req,res)=>{
 const url=new URL(req.url,'http://localhost');
 if(url.pathname==='/js/previous-trained-segmentation.js'){res.setHeader('Content-Type','text/javascript');res.end(fs.readFileSync(path.join(root,'js/trained-segmentation.js'),'utf8').replace("from './autotrace.js'","from '/tests/fixtures/autotrace-before-subpixel.js'"));return;}
 const file=path.resolve(root,'.'+url.pathname);if(!file.startsWith(root+path.sep)){res.writeHead(403).end();return;}
 fs.readFile(file,(e,b)=>{if(e){res.writeHead(404).end();return;}res.setHeader('Content-Type',({'.html':'text/html','.js':'text/javascript','.mjs':'text/javascript','.wasm':'application/wasm','.png':'image/png','.jpg':'image/jpeg'})[path.extname(file)]||'application/octet-stream');res.end(b);});
});
const inside=(x,y,c)=>{let v=false;for(let i=0,j=c.length-1;i<c.length;j=i++){const a=c[i],b=c[j];if((a.y>y)!==(b.y>y)&&x<(b.x-a.x)*(y-a.y)/(b.y-a.y)+a.x)v=!v;}return v;};
(async()=>{
 const {outlineIssue}=await import('../js/outline-editor.js'),reference=JSON.parse(fs.readFileSync(path.join(root,'tests/fixtures/screw-reference.json'))).points;
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const browser=await puppeteer.launch({executablePath:process.env.CHROME_BIN||'/usr/bin/chromium',headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});
 try{
  const page=await browser.newPage();page.setDefaultTimeout(180000);await page.goto(`http://127.0.0.1:${server.address().port}/index.html`);const rows=[];
  for(const[id]of variants){
   const outputs=await page.evaluate(async id=>{
    const image=new Image();image.src='/test-artifacts/model-evaluation/thread-variants/'+id+(id==='compressed'?'.jpg':'.png');await image.decode();const c=new OffscreenCanvas(image.width,image.height),ctx=c.getContext('2d');ctx.drawImage(image,0,0);const rgba=ctx.getImageData(0,0,image.width,image.height).data,out={};
    for(const[label,module]of[['previous','previous-trained-segmentation'],['current','trained-segmentation']]){const {traceWithModel}=await import('/js/'+module+'.js');out[label]=await traceWithModel(image.width,image.height,rgba);}
    return out;
   },id);
   const ref=id==='rotated'?reference.map(p=>({x:256-p.y,y:p.x})):reference,row={id,independentCapture:false};
   for(const[label,result]of Object.entries(outputs)){
    assert.equal(outlineIssue(result.entities),'',id+': '+label+' valid CAD contour');assert.equal(result.contours.length,1,id+': '+label+' no invented holes');
    let n=0,d=0;for(let y=0;y<256;y++)for(let x=0;x<256;x++){const a=inside(x+.5,y+.5,ref),b=inside(x+.5,y+.5,result.contours[0]);n+=a&&b;d+=a||b;}
    row[label]={silhouetteIoU:n/d,vertices:result.contours[0].length};fs.writeFileSync(path.join(dir,id+'-'+label+'.json'),JSON.stringify(result));
    const input=path.join(dir,id+(id==='compressed'?'.jpg':'.png'));exec('magick',[input,'-fill','none','-stroke','#00ffff','-strokewidth','.6','-draw',`path 'M${result.contours[0].map(p=>p.x+','+p.y).join(' L')} Z'`,'-resize','768x768',path.join(dir,id+'-'+label+'.png')]);
   }
   assert.ok(row.current.silhouetteIoU>.75,id+': preserve the silhouette under capture changes');rows.push(row);console.log(JSON.stringify(row));
  }
  const mean=(label,key)=>rows.reduce((s,r)=>s+r[label][key],0)/rows.length;
  // Half a percentage point is smaller than the stated source-annotation
  // uncertainty; a larger degradation must fail even if the path looks smooth.
  assert.ok(mean('current','silhouetteIoU')>=mean('previous','silhouetteIoU')-.005,'subpixel tracing must preserve measured silhouette accuracy');
  assert.ok(mean('current','vertices')<mean('previous','vertices'),'remove raster staircase vertices');
  fs.writeFileSync(path.join(dir,'results.json'),JSON.stringify({independentPhotos:1,referenceUncertaintyPx:2,cases:rows,meanPreviousIoU:mean('previous','silhouetteIoU'),meanCurrentIoU:mean('current','silhouetteIoU'),meanPreviousVertices:mean('previous','vertices'),meanCurrentVertices:mean('current','vertices')},null,2));
  console.log('PASS: actual ONNX inference on the screw and five capture perturbations, editable geometry and bounded accuracy change');
 }finally{await browser.close();server.close();}
})().catch(e=>{console.error(e);server.close();process.exitCode=1;});
