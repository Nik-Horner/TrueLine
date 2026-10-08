// Start the actual Electron shell on the current OS and drive its renderer.
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {spawn,execFileSync}=require('node:child_process'),puppeteer=require('puppeteer-core');
(async()=>{
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'trueline-native-'));
 const log=fs.openSync(path.join(directory,'electron.log'),'w');
 const executable=process.env.TRUELINE_EXECUTABLE||require('electron');
 const launchArgs=process.env.TRUELINE_EXECUTABLE?[]:['.','--no-sandbox','--disable-gpu'];
 const child=spawn(executable,[...launchArgs,'--remote-debugging-port=9238',`--user-data-dir=${directory}`],{cwd:path.resolve(__dirname,'..'),env:{...process.env,TRUELINE_PORT:'8438'},stdio:['ignore',log,log]});
 let browser;
 try{
  const until=Date.now()+45000;
  while(Date.now()<until){
   if(child.exitCode!==null || child.signalCode!==null)throw Error('Electron exited: '+fs.readFileSync(path.join(directory,'electron.log'),'utf8'));
   try{browser=await puppeteer.connect({browserURL:'http://127.0.0.1:9238',defaultViewport:null});break;}catch{await new Promise(r=>setTimeout(r,300));}
  }
  assert.ok(browser,'Electron must start within 45 seconds');const page=(await browser.pages())[0];
  await page.waitForFunction(async()=>(await import('/js/app.js')).App.ready,{timeout:30000});
  await page.evaluate(()=>{localStorage.setItem('tl-tour-done','1');localStorage.setItem('tl-frdone','1');});
  await page.reload();await page.waitForFunction(async()=>(await import('/js/app.js')).App.ready);
  fs.mkdirSync(path.join('test-artifacts','native-'+process.platform),{recursive:true});
  await page.evaluate(async()=>{localStorage.setItem('tl-tour-done','1');localStorage.setItem('tl-frdone','1');window.m=await import('/js/app.js');m.newDoc();m.mutate('Native shortcut test',()=>m.addEntity({type:'circle',c:{x:5,y:5},r:2}));});
  const modifier=process.platform==='darwin'?'Meta':'Control';await page.keyboard.down(modifier);await page.keyboard.press('z');await page.keyboard.up(modifier);
  await page.waitForFunction(()=>m.App.doc.entities.length===0);await page.keyboard.down(modifier);await page.keyboard.down('Shift');await page.keyboard.press('z');await page.keyboard.up('Shift');await page.keyboard.up(modifier);
  await page.waitForFunction(()=>m.App.doc.entities.length===1);await page.evaluate(()=>m.App.fileDirty=false);
  browser.disconnect();browser=null;
  execFileSync(process.execPath,[path.join(__dirname,'production.cjs'),path.join('test-artifacts','native-'+process.platform)],{env:{...process.env,CDP_URL:'http://127.0.0.1:9238',APP_URL:'http://127.0.0.1:8438/'},stdio:'inherit',timeout:90000});
  console.log('PASS: native Electron startup, '+modifier+' undo/redo and general production workflows');
 }finally{
  browser?.disconnect();
  if(process.platform==='win32')spawn('taskkill',['/pid',String(child.pid),'/T','/F'],{stdio:'ignore'});
  else child.kill('SIGKILL');
  fs.closeSync(log);
 }
})().catch(e=>{console.error(e);process.exitCode=1;});
