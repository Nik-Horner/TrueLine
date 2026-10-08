// Exercise native macOS lifecycle/menu wiring without claiming a native Mac run.
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
(async () => {
  const events = {}, windows = [], inputs = [], webEvents = {};
  let choice = 0;
  let ready, menu, listens = 0, quit = 0;
  class Window {
    constructor() { windows.push(this); this.webContents = { on: (event, cb) => webEvents[event] = cb, sendInputEvent: e => inputs.push(e) }; }
    loadURL(url) { this.url = url; }
    static getAllWindows() { return windows; }
    static getFocusedWindow() { return windows[0]; }
  }
  const electron = {
    app: { requestSingleInstanceLock: () => true, on: (event, cb) => events[event] = cb, whenReady: () => ({ then: cb => ready = cb }), quit: () => quit++, isReady: () => true },
    BrowserWindow: Window, ipcMain: { handle() {} }, dialog: { showMessageBoxSync: () => choice },
    Menu: { buildFromTemplate: m => m, setApplicationMenu: m => menu = m },
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../electron/main.cjs'), 'utf8'), {
    require: n => n === 'electron' ? electron : n === './static-server.cjs' ? { createStaticServer: () => ({ on() {}, listen: (p, host, cb) => { listens++; cb(); }, address: () => ({ port: 8390 }) }) } : require(n),
    __dirname: path.join(__dirname, '../electron'), process: { platform: 'darwin', env: {} }, URL,
  });
  ready(); events.activate(); events.activate(); await new Promise(setImmediate);
  assert.equal(windows.length, 1); assert.equal(listens, 1);
  let discarded = false; webEvents['will-prevent-unload']({preventDefault: () => discarded = true}); assert.equal(discarded, false);
  choice = 1; webEvents['will-prevent-unload']({preventDefault: () => discarded = true}); assert.equal(discarded, true);
  assert.equal(windows[0].url, 'http://127.0.0.1:8390/');
  assert.equal(menu[0].role, 'appMenu'); assert.equal(menu.at(-1).role, 'windowMenu');
  const redo = menu.find(m => m.label === 'Edit').submenu.find(m => m.label === 'Redo');
  assert.equal(redo.accelerator, 'Command+Shift+Z'); redo.click();
  assert.equal(inputs[0].type, 'keyDown'); assert.deepEqual(Array.from(inputs[0].modifiers), ['meta', 'shift']); assert.equal(inputs[1].type, 'keyUp');
  windows.length = 0; events['window-all-closed'](); assert.equal(quit, 0);
  events.activate(); events.activate(); await new Promise(setImmediate);
  assert.equal(windows.length, 1); assert.equal(listens, 1, 'Dock reopening must reuse the local server');
  windows.length = 0; events['second-instance'](); await new Promise(setImmediate);
  assert.equal(windows.length, 1); assert.equal(listens, 1);
  console.log('PASS: Mac application menu, Command shortcuts, close/activate/second-instance lifecycle and server reuse');
})().catch(e => { console.error(e); process.exitCode = 1; });
