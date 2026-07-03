// TrueLine desktop shell.
const { app, BrowserWindow } = require('electron');
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const MIME = {
  '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript',
  '.json': 'application/json', '.woff2': 'font/woff2', '.svg': 'image/svg+xml',
  '.png': 'image/png',
};

// tiny local static server: file:// blocks ES-module imports, http:// does not
function serve() {
  return new Promise(resolve => {
    const srv = http.createServer((req, res) => {
      const urlPath = decodeURIComponent(req.url.split('?')[0]);
      let fp = path.normalize(path.join(ROOT, urlPath === '/' ? 'index.html' : urlPath));
      if (!fp.startsWith(ROOT)) { res.writeHead(403); res.end(); return; }
      fs.readFile(fp, (err, data) => {
        if (err) { res.writeHead(404); res.end('not found'); return; }
        res.writeHead(200, {
          'Content-Type': MIME[path.extname(fp)] || 'application/octet-stream',
          'Cache-Control': 'no-store',   // always serve current files (matters for updates)
        });
        res.end(data);
      });
    });
    // fixed port when TRUELINE_PORT is set (tests); otherwise an ephemeral port
    const port = parseInt(process.env.TRUELINE_PORT || '0', 10) || 0;
    srv.listen(port, '127.0.0.1', () => resolve(srv.address().port));
  });
}

async function createWindow() {
  const port = await serve();
  const win = new BrowserWindow({
    width: 1500, height: 950,
    minWidth: 1100, minHeight: 700,
    backgroundColor: '#0B0E13',
    title: 'TrueLine',
    autoHideMenuBar: true,
    webPreferences: { contextIsolation: true, sandbox: true },
  });
  win.setMenu(null);
  win.webContents.on('before-input-event', (ev, input) => {
    if (input.key === 'F12' && input.type === 'keyDown') win.webContents.toggleDevTools();
  });
  win.loadURL(`http://127.0.0.1:${port}/`);
}

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

app.whenReady().then(() => { createWindow(); initUpdater(); });
app.on('window-all-closed', () => app.quit());
