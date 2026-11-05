const assert = require('node:assert/strict');
const {EventEmitter} = require('node:events');
const {latestUpdate, offerUpdate, RELEASES_URL} = require('../electron/update-check.cjs');
(async () => {
  const release = (tag, extra = {}) => async (url, options) => {
    assert.equal(url, 'https://api.github.com/repos/Nik-Horner/TrueLine/releases/latest');
    assert.ok(options.signal);
    return {ok:true, json:async()=>({tag_name:tag,...extra})};
  };
  assert.equal(await latestUpdate(release('v3.2.0'), '3.1.1'), '3.2.0');
  assert.equal(await latestUpdate(release('v3.1.1'), '3.1.1'), null);
  assert.equal(await latestUpdate(release('v3.0.2'), '3.1.1'), null);
  assert.equal(await latestUpdate(release('v3.2.0-beta.1'), '3.1.1'), null);
  assert.equal(await latestUpdate(release('v3.2.0', {draft:true}), '3.1.1'), null);
  assert.equal(await latestUpdate(release('v3.2.0', {prerelease:true}), '3.1.1'), null);
  assert.equal(await latestUpdate(release('not-a-version'), '3.1.1'), null);
  assert.equal(await latestUpdate(release('v3.2.0'), 'invalid'), null);
  assert.equal(await latestUpdate(async()=>({ok:false}), '3.1.1'), null);
  await assert.rejects(latestUpdate(async()=>{throw Error('offline');}, '3.1.1'), /offline/);
  assert.equal(RELEASES_URL, 'https://github.com/Nik-Horner/TrueLine/releases/latest');

  class Window extends EventEmitter {
    constructor() { super(); this.progress=[]; this.destroyed=false; this.allowClose=true; }
    isDestroyed() { return this.destroyed; }
    setProgressBar(value) { this.progress.push(value); }
    close() { if(this.allowClose){this.destroyed=true;this.emit('closed');}else this.emit('trueline:update-cancelled'); }
  }
  const setup = (responses, behavior = {}) => {
    const win=new Window(),updater=new EventEmitter(),messages=[],opened=[];
    let downloads=0,restarts=0,checks=0;
    updater.checkForUpdates=async()=>{checks++;if(behavior.checkError)throw Error('offline');return {updateInfo:{version:behavior.feedVersion||'3.2.0'}};};
    updater.downloadUpdate=async()=>{downloads++;if(behavior.downloadError)throw Error('download failed');updater.emit('download-progress',{percent:42});};
    updater.quitAndInstall=()=>{restarts++;};
    const dialog={showMessageBox:async(w,options)=>{assert.equal(w,win);messages.push(options);return {response:responses.shift()};}};
    const shell={openExternal:async url=>{opened.push(url);}};
    return {win,updater,dialog,shell,messages,opened,counts:()=>({downloads,restarts,checks})};
  };
  const offer = s => offerUpdate(s.win,'3.2.0','3.1.1',s.updater,s.dialog,s.shell,'win32');
  let state=setup([1]);await offer(state);
  assert.deepEqual(state.messages[0].buttons,['Update','Later']);assert.deepEqual(state.counts(),{downloads:0,restarts:0,checks:0});
  state=setup([0,1]);await offer(state);
  assert.deepEqual(state.counts(),{downloads:1,restarts:0,checks:1});assert.deepEqual(state.win.progress,[2,.42,-1]);
  assert.deepEqual(state.messages[1].buttons,['Restart and update','Later']);
  state=setup([0,0]);await offer(state);assert.deepEqual(state.counts(),{downloads:1,restarts:1,checks:1});
  state=setup([0,0]);state.win.allowClose=false;await offer(state);
  assert.equal(state.counts().restarts,0,'cancelled unsaved-work prompt must not restart');
  state.win.allowClose=true;state.win.close();assert.equal(state.counts().restarts,0,'a later normal close must not trigger an unexpected restart');
  for(const behavior of [{checkError:true},{downloadError:true},{feedVersion:'3.1.9'}]){
    state=setup([0,0],behavior);await offer(state);
    assert.deepEqual(state.opened,[RELEASES_URL]);assert.equal(state.counts().restarts,0);
    assert.match(state.messages[1].message,/could not update automatically/);
    if(behavior.feedVersion)assert.equal(state.counts().downloads,0,'never install a different version from the advertised release');
  }
  // macOS must finish native signature verification before offering a restart.
  state=setup([0,1]);state.updater.nativeUpdater=new EventEmitter();
  state.updater.downloadUpdate=async()=>{};
  const pending=offerUpdate(state.win,'3.2.0','3.1.1',state.updater,state.dialog,state.shell,'darwin',state.updater.nativeUpdater);
  for(let i=0;i<3;i++)await new Promise(setImmediate);
  assert.equal(state.messages.length,1,'a downloaded file is not yet a verified macOS update');
  state.updater.nativeUpdater.emit('update-downloaded');await pending;
  assert.equal(state.messages[1].title,'Update ready');
  state=setup([0,1]);state.updater.nativeUpdater=new EventEmitter();
  state.updater.downloadUpdate=async()=>{state.updater.nativeUpdater.emit('error',Error('signature rejected'));};
  await offerUpdate(state.win,'3.2.0','3.1.1',state.updater,state.dialog,state.shell,'darwin',state.updater.nativeUpdater);
  assert.equal(state.messages[1].title,'Automatic update unavailable');
  state=setup([0,1]);state.updater=null;await offer(state);
  assert.match(state.messages[1].message,/could not update automatically/);assert.deepEqual(state.opened,[]);
  // The real shell must configure the updater for a user-initiated download.
  {
    const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
    let ready,prompt;const windows=[],updater=new EventEmitter();
    class NativeWindow extends Window {
      constructor(){super();this.webContents={on(){}};windows.push(this);}
      loadURL(){} setMenu(){} static getAllWindows(){return windows;}
    }
    const electron={
      app:{isPackaged:true,getVersion:()=> '3.1.1',requestSingleInstanceLock:()=>true,on(){},whenReady:()=>({then:fn=>{ready=fn;}})},
      BrowserWindow:NativeWindow,ipcMain:{handle(){}},Menu:{},net:{fetch:release('v3.2.0')},shell:{},
      dialog:{showMessageBox:async(win,options)=>{prompt=options;return {response:1};}},
    };
    vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../electron/main.cjs'),'utf8'),{
      require:name=>name==='electron'?electron:name==='./update-check.cjs'?require('../electron/update-check.cjs'):
        name==='./static-server.cjs'?{createStaticServer:()=>({on(){},listen(p,h,cb){cb();},address:()=>({port:8390})})}:
        name==='electron-updater'?{autoUpdater:updater}:require(name),
      __dirname:path.join(__dirname,'../electron'),process:{platform:'win32',env:{}},URL,
    });
    ready();for(let i=0;i<5;i++)await new Promise(setImmediate);
    assert.equal(updater.autoDownload,false);assert.equal(updater.autoInstallOnAppQuit,true);
    assert.deepEqual(prompt.buttons,['Update','Later']);
  }
  console.log('PASS: release comparison, update download, fallback, restart and unsaved-work cancellation');
})().catch(err => { console.error(err); process.exitCode = 1; });
