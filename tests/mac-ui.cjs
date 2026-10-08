const assert = require('node:assert/strict'), puppeteer = require('puppeteer-core');
const {createStaticServer} = require('../electron/static-server.cjs');
(async () => {
  const server = createStaticServer(require('node:path').resolve(__dirname, '..'));
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const browser = await puppeteer.launch({executablePath: process.env.CHROME_BIN || '/usr/bin/chromium', args: ['--no-sandbox'], headless: true});
  try {
    const page = await browser.newPage(), errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.setViewport({width:1440, height:900, deviceScaleFactor:2});
    await page.evaluateOnNewDocument(() => {
      Object.defineProperty(navigator, 'platform', {get: () => 'MacIntel'});
      Object.defineProperty(navigator, 'userAgentData', {get: () => undefined});
      localStorage.setItem('tl-tour-done','1'); localStorage.setItem('tl-frdone','1');
    });
    await page.goto(`http://127.0.0.1:${server.address().port}/`);
    await page.waitForFunction(async () => (await import('/js/app.js')).App.ready);
    await page.evaluate(async () => { window.m = await import('/js/app.js'); m.newDoc(); m.mutate('Mac test', () => m.addEntity({type:'circle', c:{x:10,y:10},r:5})); });
    assert.match(await page.$eval('#redoBtn', e => e.title), /⌘⇧Z/);
    assert.match(await page.$eval('[data-cmd="save"]', e => e.textContent), /⌘S/);
    assert.equal(await page.$eval('#cvScene', e => e.width), await page.$eval('#stack', e => e.clientWidth * 2));
    const key = (key, shiftKey=false) => page.evaluate((key,shiftKey) => document.body.dispatchEvent(new KeyboardEvent('keydown',{key,metaKey:true,shiftKey,bubbles:true,cancelable:true})), key,shiftKey);
    const count = () => page.evaluate(() => m.App.doc.entities.length);
    await key('z'); assert.equal(await count(),0); await key('z',true); assert.equal(await count(),1);
    await key('a'); await key('c'); await key('v'); assert.equal(await count(),2);
    // Typing/editing text must never invoke drawing undo.
    await page.evaluate(() => { const input = document.createElement('input'); document.body.append(input); input.focus(); input.dispatchEvent(new KeyboardEvent('keydown',{key:'z',metaKey:true,bubbles:true})); input.remove(); });
    assert.equal(await count(),2);
    const navigation = await page.evaluate(() => {
      const cv = document.getElementById('cvOverlay'), before = {...m.App.view};
      cv.dispatchEvent(new WheelEvent('wheel',{deltaX:30,deltaY:20,bubbles:true,cancelable:true}));
      const pan = {...m.App.view};
      cv.dispatchEvent(new WheelEvent('wheel',{deltaY:-40,ctrlKey:true,bubbles:true,cancelable:true}));
      return {before, pan, pinch: {...m.App.view}};
    });
    assert.equal(navigation.before.z,navigation.pan.z); assert.notEqual(navigation.before.x,navigation.pan.x);
    assert.notEqual(navigation.pan.z,navigation.pinch.z);
    await page.evaluate(async () => {
      m.newDoc(); const canvas = document.createElement('canvas'); canvas.width=200; canvas.height=200;
      const ctx=canvas.getContext('2d');ctx.fillStyle='white';ctx.fillRect(0,0,200,200);ctx.fillStyle='black';ctx.fillRect(40,40,120,120);
      const image=new Image();image.src=canvas.toDataURL();await image.decode();
      m.setUnderlay({dataURL:image.src,x:0,y:0,wMM:100,hMM:100,rotation:0,opacity:.5,visible:true},image);
      document.querySelector('[data-cmd="autotrace"]').click();
    });
    await page.waitForFunction(() => ['ready','warning'].includes(document.querySelector('.trace-status')?.dataset.state));
    await page.evaluate(() => {
      [...document.querySelectorAll('#modalBox button')].find(b => b.textContent.trim()==='Edit outline').click();
      const canvas=document.querySelector('.trace-stage canvas');
      canvas.dispatchEvent(new WheelEvent('wheel',{deltaX:20,deltaY:15,bubbles:true,cancelable:true}));
      canvas.dispatchEvent(new WheelEvent('wheel',{deltaY:-30,ctrlKey:true,bubbles:true,cancelable:true}));
    });
    const editKey = (key, metaKey=false, shiftKey=false) => page.evaluate((key,metaKey,shiftKey) => document.querySelector('.trace-stage canvas').dispatchEvent(new KeyboardEvent('keydown',{key,metaKey,shiftKey,bubbles:true,cancelable:true})),key,metaKey,shiftKey);
    const pointLabel = () => page.$eval('.trace-selected-info',e=>e.textContent);
    const beforePoint = await pointLabel(); await editKey('ArrowRight');
    const afterPoint = await pointLabel(); assert.notEqual(afterPoint,beforePoint);
    await editKey('z',true); assert.equal(await pointLabel(),beforePoint);
    await editKey('z',true,true); assert.equal(await pointLabel(),afterPoint);
    assert.equal(await count(),0,'Mac editor history must not change the document');
    await new Promise(r=>setTimeout(r,100));
    require('node:fs').mkdirSync('test-artifacts/release',{recursive:true});
    await page.screenshot({path:'test-artifacts/release/mac-retina-outline.png'});
    await page.evaluate(() => document.querySelector('.trace-accept').click()); assert.equal(await count(),1);
    assert.deepEqual(errors,[]);
    console.log('PASS: Mac shortcut labels, Command undo/redo/copy/paste, focused text protection and Retina canvas sizing (Chromium simulation)');
  } finally { await browser.close(); server.close(); }
})().catch(e=>{console.error(e);process.exitCode=1;});
