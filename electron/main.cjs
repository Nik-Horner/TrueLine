// TrueLine desktop shell.
const { app, BrowserWindow, ipcMain, dialog, Menu } = require('electron');
const { randomUUID } = require('crypto');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const { createStaticServer } = require('./static-server.cjs');

// tiny local static server: file:// blocks ES-module imports, http:// does not
let serverPromise;
function serve() {
  return serverPromise ||= new Promise(resolve => {
    const srv = createStaticServer(ROOT);
    // Stable origin preserves IndexedDB recovery and tablet settings across launches.
    const port = parseInt(process.env.TRUELINE_PORT || '8390', 10) || 8390;
    srv.on('error', err => { dialog.showErrorBox('TrueLine could not start', `The local app server could not start: ${err.message}`); app.quit(); });
    srv.listen(port, '127.0.0.1', () => resolve(srv.address().port));
  });
}

let openingWindow;
function createWindow() {
  return openingWindow ||= openWindow().finally(() => { openingWindow = null; });
}
async function openWindow() {
  const port = await serve();
  const win = new BrowserWindow({
    width: 1500, height: 950,
    minWidth: 1100, minHeight: 700,
    backgroundColor: '#0B0E13',
    title: 'TrueLine',
    autoHideMenuBar: true,
    webPreferences: { contextIsolation: true, sandbox: true, preload: path.join(__dirname, 'preload.cjs') },
  });
  if (process.platform !== 'darwin') win.setMenu(null);
  win.webContents.on('will-prevent-unload', event => {
    const choice = dialog.showMessageBoxSync(win, {
      type: 'question', buttons: ['Keep Editing', 'Discard Changes'], defaultId: 0, cancelId: 0,
      title: 'Unsaved project', message: 'Close this drawing without saving the project?',
      detail: 'Choose Keep Editing to save your project before closing.',
    });
    // Electron cancels unload by default; preventDefault explicitly permits it.
    if (choice === 1) event.preventDefault();
  });
  win.webContents.on('before-input-event', (ev, input) => {
    if (input.key === 'F12' && input.type === 'keyDown') win.webContents.toggleDevTools();
  });
  win.loadURL(`http://127.0.0.1:${port}/`);
}

// Native saving confirms success or cancellation before clearing the dirty indicator.
ipcMain.handle('trueline:save-project', async (event, payload) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  const origin = new URL(event.sender.getURL());
  if (!win || origin.hostname !== '127.0.0.1' || event.senderFrame !== event.sender.mainFrame) throw new Error('Invalid save caller');
  if (typeof payload?.json !== 'string' || payload.json.length > 64 * 1024 * 1024) throw new Error('Invalid or oversized project');
  const data = JSON.parse(payload.json);
  if (data.app !== 'trueline' || !Array.isArray(data.entities) || !Array.isArray(data.layers)) throw new Error('Invalid project');
  const name = typeof payload.name === 'string' ? path.basename(payload.name).replace(/[<>:"/\\|?*]/g, '_') : 'drawing.trueline.json';
  const result = await dialog.showSaveDialog(win, { defaultPath: name, filters: [{ name: 'TrueLine project', extensions: ['json'] }] });
  if (result.canceled || !result.filePath) return { canceled: true };
  const temporary = result.filePath + '.' + randomUUID() + '.tmp';
  try {
    await fs.promises.writeFile(temporary, payload.json, { encoding: 'utf8', flush: true });
    await fs.promises.rename(temporary, result.filePath);
    return { saved: true };
  } catch (err) {
    await fs.promises.unlink(temporary).catch(() => {});
    return { saved: false, error: err.message };
  }
});

// Auto-update: on launch, check the configured feed (build.publish url) for a newer
// version, download it in the background, and install on quit. To PUSH an update you
// build a new version and drop its dist-installer files on that feed — see README.
function initUpdater() {
  let autoUpdater;
  try { ({ autoUpdater } = require('electron-updater')); } catch (e) { return; }   // absent in dev
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.on('error', () => {});   // stay silent offline / when no feed is configured
  autoUpdater.checkForUpdatesAndNotify().catch(() => {});
}

const singleInstance = app.requestSingleInstanceLock();
if (!singleInstance) app.quit();
app.on('second-instance', () => { const win = BrowserWindow.getAllWindows()[0]; if (win) { if (win.isMinimized()) win.restore(); win.focus(); } else if (app.isReady()) createWindow(); });
app.whenReady().then(() => { if (singleInstance) {
  if (process.platform === 'darwin') {
    const key = (key, modifiers = ['meta']) => () => {
      const win = BrowserWindow.getFocusedWindow();
      if (!win) return;
      win.webContents.sendInputEvent({ type: 'keyDown', keyCode: key, modifiers });
      win.webContents.sendInputEvent({ type: 'keyUp', keyCode: key, modifiers });
    };
    Menu.setApplicationMenu(Menu.buildFromTemplate([
      { role: 'appMenu' },
      { label: 'File', submenu: [
        { label: 'Open…', accelerator: 'Command+O', click: key('O') },
        { label: 'Save Project', accelerator: 'Command+S', click: key('S') },
        { type: 'separator' }, { role: 'close' },
      ] },
      { label: 'Edit', submenu: [
        { label: 'Undo', accelerator: 'Command+Z', click: key('Z') },
        { label: 'Redo', accelerator: 'Command+Shift+Z', click: key('Z', ['meta', 'shift']) },
        { type: 'separator' },
        { label: 'Cut', accelerator: 'Command+X', click: key('X') },
        { label: 'Copy', accelerator: 'Command+C', click: key('C') },
        { label: 'Paste', accelerator: 'Command+V', click: key('V') },
        { label: 'Select All', accelerator: 'Command+A', click: key('A') },
      ] },
      { role: 'windowMenu' },
    ]));
  }
  createWindow(); initUpdater();
} });
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('activate', () => { if (singleInstance && !BrowserWindow.getAllWindows().length) createWindow(); });
