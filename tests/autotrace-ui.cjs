// End-to-end upgrade workflows in a real Chromium renderer, without an Electron display.
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const puppeteer = require('puppeteer-core');
const root = path.resolve(__dirname, '..');
fs.mkdirSync(path.join(root,'test-artifacts'),{recursive:true});
const server = http.createServer((req, res) => {
  const name = new URL(req.url, 'http://localhost').pathname;
  const file = path.resolve(root, '.' + (name === '/' ? '/index.html' : name));
  if (!file.startsWith(root + path.sep)) { res.writeHead(403); res.end(); return; }
  fs.readFile(file, (err, data) => { if (err) { res.writeHead(404); res.end(); return; }
    res.setHeader('Content-Type', ({ '.html': 'text/html', '.js': 'text/javascript', '.mjs':'text/javascript', '.wasm':'application/wasm', '.css': 'text/css' })[path.extname(file)] || 'application/octet-stream'); res.end(data); });
});
(async () => {
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const browser = await puppeteer.launch({ executablePath: process.env.CHROME_BIN || '/usr/bin/chromium', headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage', '--remote-debugging-port=9223'] });
  try {
    const page = await browser.newPage(); await page.setViewport({ width: 1500, height: 950 });
    const errors = []; page.on('pageerror', e => errors.push(e.message)); page.on('dialog', d => d.accept());
    await page.evaluateOnNewDocument(() => { localStorage.setItem('tl-tour-done', '1'); localStorage.setItem('tl-frdone', '1'); });
    const url = `http://127.0.0.1:${server.address().port}/`;
    await page.goto(url, { waitUntil: 'networkidle0' });
    await page.evaluate(async () => { window.m = await import('/js/app.js'); });
    const run = fn => page.evaluate(fn);
    const clickText = text => page.evaluate(text => {
      const button = [...document.querySelectorAll('button')].find(b => b.textContent.trim() === text && b.getClientRects().length);
      if (!button) throw new Error('Missing button: ' + text); button.click();
    }, text);
    const hiddenModal = () => page.waitForFunction(() => document.getElementById('modalRoot').hidden);

    const open = () => run(() => document.querySelector('[data-cmd="autotrace"]').click());
    const ready = () => page.waitForFunction(() => ['ready','warning'].includes(document.querySelector('.trace-status')?.dataset.state));
    const seedImage = async (options = {}) => {
      await page.evaluate(async options => {
        m.newDoc(); const c = document.createElement('canvas'); c.width = options.width || 160; c.height = options.height || 120;
        const ctx = c.getContext('2d'); ctx.fillStyle = '#eeeeee'; ctx.fillRect(0,0,c.width,c.height);
        ctx.fillStyle = '#222222'; ctx.beginPath(); ctx.arc(c.width/2,c.height/2,Math.min(c.width,c.height)*.3,0,Math.PI*2); ctx.fill();
        ctx.fillStyle = '#eeeeee'; ctx.beginPath(); ctx.arc(c.width/2,c.height/2,Math.min(c.width,c.height)*.13,0,Math.PI*2); ctx.fill();
        const img = new Image(); img.src = c.toDataURL(); await img.decode();
        m.setUnderlay({dataURL:img.src,x:10,y:20,wMM:c.width*.5,hMM:c.height*(options.stretch ? .8 : .5),rotation:options.rotation || 0,opacity:.5,visible:true},img);
      }, options);
    };
    const count = () => run(() => m.App.doc.entities.length);
    await run(() => m.newDoc()); await open();
    assert.match(await run(() => document.getElementById('toast').textContent), /Upload/);
    await seedImage({width:12,height:12}); await open();
    assert.match(await run(() => document.getElementById('toast').textContent), /16/);
    await seedImage(); await open(); await ready();
    assert.equal(await count(), 0, 'preview must not mutate the document');
    await clickText('Cancel'); assert.equal(await count(), 0);
    await open(); await ready(); await clickText('Add outline'); assert.equal(await count(), 2);
    await run(() => m.undo()); assert.equal(await count(), 0);
    await run(() => m.redo()); assert.equal(await count(), 2);
    await seedImage(); await open(); await ready();
    // Crop mode is explicit; image clicks outside crop mode do not invalidate the outline.
    const rect = await (await page.$('#modalBox canvas')).boundingBox();
    await page.mouse.click(rect.x+rect.width/2,rect.y+rect.height/2); await ready();
    await clickText('Crop part');
    // The displayed canvas letterboxes this landscape image; crop through numeric inputs
    // also provides a keyboard-accessible alternative to dragging.
    await run(() => {
      for (const [k,v] of Object.entries({x:20,y:10,w:120,h:100})) document.getElementById('trace-'+k).value = v;
      document.getElementById('trace-w').dispatchEvent(new Event('change'));
    }); await ready();
    await clickText('Add outline');
    const circles = await run(() => m.App.doc.entities);
    assert.equal(circles.length, 2); assert.ok(circles.every(e => e.type === 'circle'));
    assert.ok(Math.abs(circles[0].c.x-50) < .7 && Math.abs(circles[0].c.y-50) < .7, 'crop offset must map back into the full photo');
    await seedImage({rotation:Math.PI/2}); await open(); await ready(); await clickText('Add outline');
    const rotated = await run(() => m.App.doc.entities[0]);
    assert.ok(Math.abs(rotated.c.x+20) < .7 && Math.abs(rotated.c.y-60) < .7, 'underlay rotation must be preserved');
    await seedImage({stretch:true}); await open(); await ready(); await clickText('Add outline');
    assert.ok(await run(() => m.App.doc.entities.every(e => e.type === 'poly')), 'stretched images must not create inaccurate circles');
    await seedImage(); await open(); await ready();
    await clickText('Crop part');
    let r = await (await page.$('#modalBox canvas')).boundingBox();
    await page.mouse.move(r.x+r.width/2,r.y+r.height/2); await page.mouse.down(); await page.mouse.move(r.x+r.width/2+2,r.y+r.height/2+2); await page.mouse.up();
    assert.ok(await run(() => document.querySelector('.trace-accept').disabled), 'tiny crop must disable Add');
    assert.match(await run(() => document.querySelector('.trace-status').textContent), /16/);
    await clickText('Reset crop'); await ready();
    await clickText('Crop part');
    // Pointer cancellation restores the last valid crop and recomputes its result.
    await page.mouse.move(r.x+r.width/2,r.y+r.height/2); await page.mouse.down();
    await run(() => { const canvas = document.querySelector('.trace-stage canvas'); canvas.dispatchEvent(new PointerEvent('pointercancel',{pointerId:1})); });
    await page.mouse.up(); await ready();
    assert.equal(await run(() => document.getElementById('trace-w').value), '160');
    // Malformed numeric bounds and locked-layer acceptance cannot write geometry.
    await run(() => { document.getElementById('trace-x').value='-1'; document.getElementById('trace-x').dispatchEvent(new Event('change')); });
    assert.ok(await run(() => document.querySelector('.trace-accept').disabled));
    await clickText('Reset crop'); await ready();
    await run(() => { document.getElementById('trace-x').value=''; document.getElementById('trace-x').dispatchEvent(new Event('change')); });
    assert.ok(await run(() => document.querySelector('.trace-accept').disabled));
    await clickText('Reset crop'); await ready();
    await run(() => m.App.doc.layers.find(l => l.id === m.App.doc.currentLayer).locked = true);
    await clickText('Add outline'); assert.equal(await count(), 0);
    assert.match(await run(() => document.querySelector('.trace-status').textContent), /locked/);
    await run(() => m.App.doc.layers.find(l => l.id === m.App.doc.currentLayer).locked = false);
    // Stale image results are blocked.
    await run(() => m.App.doc.underlay = {...m.App.doc.underlay}); await clickText('Add outline');
    assert.equal(await count(), 0); assert.match(await run(() => document.querySelector('.trace-status').textContent), /changed/);
    await clickText('Cancel');
    // Closing while a worker is pending must not modify the closed dialog or document.
    await seedImage({width:2048,height:1024}); await open(); await clickText('Cancel');
    assert.equal(await count(), 0);
    // Rapid control updates use the newest settings only.
    await seedImage(); await open();
    await run(() => { const slider=document.getElementById('trace-contrast'); for(const v of ['.15','.9','.4']) {slider.value=v;slider.dispatchEvent(new Event('input'));} });
    await ready(); assert.equal(await run(() => document.querySelector('.trace-contrast output').textContent), '0.40');
    // Footer stays visible and controls stay separated across window sizes.
    for (const [width,height] of [[1500,950],[1024,600],[390,700],[800,420]]) {
      await page.setViewport({width,height});
      const layout = await run(() => {
        const box=document.getElementById('modalBox').getBoundingClientRect(), footer=document.querySelector('.trace-footer').getBoundingClientRect();
        const cancel=[...document.querySelectorAll('.trace-actions button')][0].getBoundingClientRect(), add=document.querySelector('.trace-accept').getBoundingClientRect();
        return {box:{left:box.left,right:box.right,top:box.top,bottom:box.bottom},footer:{top:footer.top,bottom:footer.bottom},gap:add.left-cancel.right,body:document.querySelector('.trace-body').getBoundingClientRect().height};
      });
      assert.ok(layout.box.left >= 0 && layout.box.right <= width+1 && layout.box.top >= 0 && layout.box.bottom <= height+1, `dialog fits ${width}x${height}`);
      assert.ok(layout.footer.bottom <= height && layout.gap >= 9 && layout.body > 0, `footer visible and buttons separated ${width}x${height}`);
      if(width === 390) await page.screenshot({path:path.join(root,'test-artifacts','autotrace-review-mobile.png')});
    }
    await page.setViewport({width:1500,height:950});
    await page.screenshot({path:path.join(root,'test-artifacts','autotrace-review.png')});
    await run(() => document.querySelector('.trace-accept').focus()); await page.keyboard.press('Tab');
    assert.equal(await run(() => document.activeElement.getAttribute('aria-label')), 'Close auto-trace', 'focus wraps inside the dialog');
    await page.keyboard.press('Escape'); await hiddenModal(); assert.equal(await count(),0);
    assert.equal(await run(() => document.activeElement.id), 'fileBtn', 'focus returns to a visible control');
    // Exercise the actual upload picker and browser decoders for common formats.
    await seedImage();
    const uploadImages = await run(async () => {
      const c=document.createElement('canvas');c.width=160;c.height=120;const ctx=c.getContext('2d');
      const img = new Image();img.src=m.App.doc.underlay.dataURL;await img.decode();ctx.drawImage(img,0,0);
      return ['png','jpeg','webp'].map(format=>({format,data:c.toDataURL('image/'+format).split(',')[1]}));
    });
    for(const {format,data} of uploadImages) {
      const input=path.join(root,'test-artifacts','ui-upload.'+format);fs.writeFileSync(input,Buffer.from(data,'base64'));
      await run(() => {m.newDoc();document.querySelector('[data-cmd="upload-image"]').click();});
      await (await page.$('#imagePick')).uploadFile(input);
      await page.waitForFunction(()=>m.App.doc.underlay && m.getUnderlayImg()?.naturalWidth===160);
      await open();await ready();await clickText('Add outline');assert.equal(await count(),2,format+' upload and trace');
    }
    // Test all eight EXIF transforms with an off-center part, so flips and
    // rotations must preserve both decoder dimensions and geometry position.
    const orientedData=await run(()=>{const c=document.createElement('canvas');c.width=160;c.height=120;const ctx=c.getContext('2d');ctx.fillStyle='#eee';ctx.fillRect(0,0,160,120);ctx.fillStyle='#222';ctx.beginPath();ctx.arc(60,45,28,0,Math.PI*2);ctx.fill();ctx.fillStyle='#eee';ctx.beginPath();ctx.arc(60,45,12,0,Math.PI*2);ctx.fill();return c.toDataURL('image/jpeg',.9).split(',')[1];});
    const jpeg=Buffer.from(orientedData,'base64');
    const centers=[[60,45],[100,45],[100,75],[60,75],[45,60],[75,60],[75,100],[45,100]];
    for(let orientation=1;orientation<=8;orientation++) {
      const exif=Buffer.alloc(32);exif.write('Exif',0);exif.write('II',6);exif.writeUInt16LE(42,8);exif.writeUInt32LE(8,10);
      exif.writeUInt16LE(1,14);exif.writeUInt16LE(0x112,16);exif.writeUInt16LE(3,18);exif.writeUInt32LE(1,20);exif.writeUInt16LE(orientation,24);
      const oriented=path.join(root,'test-artifacts','ui-oriented-'+orientation+'.jpeg');fs.writeFileSync(oriented,Buffer.concat([jpeg.subarray(0,2),Buffer.from([255,225,0,34]),exif,jpeg.subarray(2)]));
      await run(()=>{m.newDoc();document.querySelector('[data-cmd="upload-image"]').click();});
      await (await page.$('#imagePick')).uploadFile(oriented);
      const width=orientation>=5?120:160,height=orientation>=5?160:120;
      await page.waitForFunction((w,h)=>m.getUnderlayImg()?.naturalWidth===w&&m.getUnderlayImg()?.naturalHeight===h,{},width,height);
      await open();await ready();await clickText('Add outline');assert.equal(await count(),2,'EXIF orientation '+orientation);
      const center=await run(()=>{const e=m.App.doc.entities[0],u=m.App.doc.underlay,img=m.getUnderlayImg();return {x:(e.c.x-u.x)/u.wMM*img.naturalWidth,y:(e.c.y-u.y)/u.hMM*img.naturalHeight};});
      assert.ok(Math.abs(center.x-centers[orientation-1][0])<1.5&&Math.abs(center.y-centers[orientation-1][1])<1.5,'EXIF geometry position '+orientation);
    }
    const alpha=await run(()=>{const c=document.createElement('canvas');c.width=160;c.height=120;const ctx=c.getContext('2d');ctx.fillStyle='#222';ctx.beginPath();ctx.arc(80,60,36,0,Math.PI*2);ctx.fill();ctx.globalCompositeOperation='destination-out';ctx.beginPath();ctx.arc(80,60,15,0,Math.PI*2);ctx.fill();return c.toDataURL().split(',')[1];});
    const transparent=path.join(root,'test-artifacts','ui-transparent.png');fs.writeFileSync(transparent,Buffer.from(alpha,'base64'));
    await run(()=>{m.newDoc();document.querySelector('[data-cmd="upload-image"]').click();});
    await (await page.$('#imagePick')).uploadFile(transparent);
    await page.waitForFunction(()=>m.getUnderlayImg()?.naturalWidth===160);
    await open();await ready();await clickText('Add outline');assert.equal(await count(),2,'transparent PNG is composited onto white');
    await seedImage({width:4096,height:3072});await open();await ready();
    assert.equal(await run(()=>document.querySelector('.trace-stage canvas').width),2048,'large imports downsample before tracing');
    await clickText('Add outline');assert.equal(await count(),2);
    const large=await run(()=>m.App.doc.entities[0]);assert.ok(Math.abs(large.c.x-1034)<1&&Math.abs(large.c.y-788)<1,'downsampling preserves world coordinates');
    const corrupt=path.join(root,'test-artifacts','ui-corrupt.png');fs.writeFileSync(corrupt,'not a valid image');
    await run(() => {m.newDoc();document.querySelector('[data-cmd="upload-image"]').click();});
    await (await page.$('#imagePick')).uploadFile(corrupt);
    await page.waitForFunction(()=>document.getElementById('toast').textContent.includes('could not be decoded'));
    assert.equal(await run(()=>m.App.doc.underlay),null);assert.equal(await count(),0);
    // Resource and worker failures never write geometry. Model success is
    // exercised through the real worker in the separate trained-model suite.
    await seedImage();
    await run(()=>{
      window.__traceOriginalWorker=window.Worker;window.__traceOriginalTimeout=window.setTimeout;
      window.Worker=class {terminate(){this.terminated=true;}postMessage(data){
        window.__traceFailureWorker=this;this.requestId=data.id;
        if(window.__traceFailure==='hang')return;
        setTimeout(()=>this.onmessage?.({data:{id:data.id,result:{entities:[{type:'poly',closed:true,pts:[{x:1,y:1},{x:10,y:10},{x:1,y:10},{x:10,y:1}]}]}}}),0);
      }};
      window.setTimeout=(fn,delay,...args)=>window.__traceOriginalTimeout(fn,delay===120000?50:delay,...args);
      window.__traceFailure='invalid';
    });
    await open();await page.waitForFunction(()=>document.querySelector('.trace-status')?.dataset.state==='error');
    assert.match(await run(()=>document.querySelector('.trace-status').textContent),/invalid/);assert.equal(await count(),0);assert.ok(await run(()=>document.querySelector('.trace-accept').disabled));await clickText('Cancel');
    await run(()=>window.__traceFailure='hang');await open();await page.waitForFunction(()=>document.querySelector('.trace-status')?.dataset.state==='error');
    assert.match(await run(()=>document.querySelector('.trace-status').textContent),/too long/);assert.equal(await count(),0);assert.ok(await run(()=>window.__traceFailureWorker.terminated));
    await run(()=>window.__traceFailureWorker.onmessage({data:{id:window.__traceFailureWorker.requestId,result:{entities:[{type:'circle',c:{x:60,y:60},r:20}],warnings:[]}}}));
    assert.ok(await run(()=>document.querySelector('.trace-accept').disabled));assert.match(await run(()=>document.querySelector('.trace-status').textContent),/too long/);await clickText('Cancel');
    await run(()=>{window.Worker=window.__traceOriginalWorker;window.setTimeout=window.__traceOriginalTimeout;});
    await seedImage();await open();await ready();await run(()=>m.App.doc.underlay.wMM=0);await clickText('Add outline');
    assert.equal(await count(),0);assert.match(await run(()=>document.getElementById('toast').textContent),/scale or position/);await clickText('Cancel');
    await seedImage();await open();await ready();
    await run(()=>{m.App.doc.underlay.wMM=Number.MAX_VALUE;m.App.doc.underlay.x=Number.MAX_VALUE;});await clickText('Add outline');
    assert.equal(await count(),0,'finite image parameters must not overflow exported coordinates');
    assert.match(await page.$eval('#toast',e=>e.textContent),/supported range/);await clickText('Cancel');
    const oversize=path.join(root,'test-artifacts','ui-oversize.png');fs.writeFileSync(oversize,Buffer.alloc(24*1024*1024+1));
    await run(()=>{m.newDoc();document.querySelector('[data-cmd="upload-image"]').click();});await (await page.$('#imagePick')).uploadFile(oversize);
    await page.waitForFunction(()=>document.getElementById('toast').textContent.includes('24 MB'));assert.equal(await run(()=>m.App.doc.underlay),null);
    // Portrait and panorama letterboxing support reverse-direction crops.
    for(const options of [{width:120,height:320},{width:640,height:120}]) {
      await seedImage(options); await open(); await ready(); await clickText('Crop part');
      const coordinates = await run(() => { const canvas=document.querySelector('.trace-stage canvas'),r=canvas.getBoundingClientRect(),s=Math.min(r.width/canvas.width,r.height/canvas.height); return {x:r.left+(r.width-canvas.width*s)/2,y:r.top+(r.height-canvas.height*s)/2,w:canvas.width*s,h:canvas.height*s}; });
      await page.mouse.move(coordinates.x+coordinates.w*.95,coordinates.y+coordinates.h*.95); await page.mouse.down();
      await page.mouse.move(coordinates.x+coordinates.w*.05,coordinates.y+coordinates.h*.05,{steps:6}); await page.mouse.up(); await ready();
      assert.ok(Math.abs(await run(() => Number(document.getElementById('trace-w').value))-options.width*.9)<=2);
      await clickText('Cancel');
    }
    if (fs.existsSync(path.join(root,'test-artifacts','real-photos','metal-nut-input.png'))) {
      await run(async () => {
        m.newDoc(); const img=new Image();img.src='/test-artifacts/real-photos/metal-nut-input.png';await img.decode();
        m.setUnderlay({dataURL:img.src,x:0,y:0,wMM:256,hMM:256,rotation:0,opacity:.5,visible:true},img);
      }); await open();await ready();
      await page.screenshot({path:path.join(root,'test-artifacts','autotrace-review-real-photo.png')});
      await clickText('Cancel');
    }
    if(fs.existsSync(path.join(root,'test-artifacts','complex-parts','white-switch-plate-input.png'))){
      await run(async()=>{m.newDoc();const img=new Image();img.src='/test-artifacts/complex-parts/white-switch-plate-input.png';await img.decode();m.setUnderlay({dataURL:img.src,x:0,y:0,wMM:2048,hMM:1152,rotation:0,opacity:.5,visible:true},img);});
      await open();await ready();
      assert.equal(await run(()=>document.querySelector('.trace-status').dataset.state),'warning','uncertain openings must be flagged in the production popup');
      assert.match(await run(()=>document.querySelector('.trace-status').textContent),/markings or obstructions/);
      const amber=await run(()=>{const c=document.querySelector('.trace-stage canvas'),data=c.getContext('2d').getImageData(0,0,c.width,c.height).data;let pixels=0;for(let i=0;i<data.length;i+=4)if(data[i]>245&&data[i+1]>175&&data[i+1]<205&&data[i+2]<95)pixels++;return pixels;});
      assert.ok(amber>20,'amber boundary review highlights must be visible without a crop box');
      assert.equal(await count(),0,'uncertainty preview does not modify document geometry');
      await page.screenshot({path:path.join(root,'test-artifacts','autotrace-review-uncertainty.png')});
      await clickText('Cancel');assert.equal(await count(),0);
    }
    assert.deepEqual(errors, []);
    console.log('PASS: auto-trace Chromium checks (preview, cancel, accept, undo/redo, crop offsets, rotation, nonuniform scale, tiny/invalid/reverse/cancelled crops, locked/stale targets, worker cancellation, rapid changes, keyboard focus, PNG/JPEG/WebP/alpha/EXIF uploads, large-image downsampling and 4 viewport sizes)');
  } finally { await browser.close(); server.close(); }
})().catch(err => { console.error(err); server.close(); process.exitCode = 1; });
