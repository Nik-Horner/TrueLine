// Exercise the bundled worker/models in a running packaged Electron app.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),puppeteer=require('puppeteer-core');
(async()=>{
 const browser=await puppeteer.connect({browserURL:process.env.CDP_URL||'http://127.0.0.1:9226',defaultViewport:null});
 try{
  const page=(await browser.pages())[0],errors=[],requests=[];
  page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>requests.push(r.url()));
  await page.evaluateOnNewDocument(()=>{localStorage.setItem('tl-tour-done','1');localStorage.setItem('tl-frdone','1');});
  await page.goto(process.env.APP_URL||'http://127.0.0.1:8392/');
  await page.waitForFunction(async()=>(await import('/js/app.js')).App.ready);
  const results=[];fs.mkdirSync('test-artifacts/release',{recursive:true});
  for(const id of ['screw','steel-bracket','foam-irregular']){
   const photo='data:image/png;base64,'+fs.readFileSync(path.join(__dirname,'../test-artifacts/complex-parts',id+'-input.png')).toString('base64');
   await page.evaluate(async photo=>{window.m=await import('/js/app.js');m.newDoc();const image=new Image();image.src=photo;await image.decode();m.setUnderlay({dataURL:photo,x:0,y:0,wMM:100,hMM:100*image.height/image.width,rotation:0,opacity:.5,visible:true},image);document.querySelector('[data-cmd="autotrace"]').click();},photo);
   await page.waitForFunction(()=>['ready','warning','error'].includes(document.querySelector('.trace-status')?.dataset.state),{timeout:125000});
   const status=await page.$eval('.trace-status',e=>({state:e.dataset.state,text:e.textContent}));assert.notEqual(status.state,'error',status.text);
   assert.equal(await page.evaluate(()=>m.App.doc.entities.length),0);
   await page.screenshot({path:`test-artifacts/release/packaged-${id}.png`});
   await page.$eval('.trace-accept',e=>{if(e.disabled)throw Error('Outline unavailable');e.click();});
   const count=await page.evaluate(()=>m.App.doc.entities.length);assert.ok(count>0);
   const roundtrip=await page.evaluate(async()=>{const d=await import('/js/dxf.js');const out=d.writeDXF(m.decomposeForExport(m.App.doc.entities),m.App.doc.layers,{units:'mm'});return d.readDXF(out).entities.length;});assert.ok(roundtrip>0);
   await page.evaluate(()=>m.undo());assert.equal(await page.evaluate(()=>m.App.doc.entities.length),0);
   await page.evaluate(()=>m.redo());assert.equal(await page.evaluate(()=>m.App.doc.entities.length),count);
   results.push({id,status:status.text,entities:count,dxfEntities:roundtrip});
  }
  assert.ok(requests.some(u=>u.endsWith('/encoder.onnx')));assert.ok(requests.some(u=>u.endsWith('/decoder.onnx')));assert.ok(requests.some(u=>u.endsWith('.wasm')));
  assert.deepEqual(requests.filter(u=>/^https?:/.test(u)&&new URL(u).hostname!=='127.0.0.1'),[]);
  assert.deepEqual(errors,[]);fs.writeFileSync('test-artifacts/release/packaged-tracing.json',JSON.stringify({passed:true,results},null,2));
  console.log('PASS: packaged Electron local model/worker, three real photos, preview/commit/undo/redo, DXF roundtrip and no external inference requests');
 }finally{browser.disconnect();}
})().catch(e=>{console.error(e);process.exitCode=1;});
