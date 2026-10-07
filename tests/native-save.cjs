// Exercise Electron's real save handler against a temporary directory with stubbed dialogs.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
(async () => {
  const directory = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'trueline-save-'));
  try {
    let handler, choice, failRename = false;
    const sender = { getURL: () => 'http://127.0.0.1:8390/', mainFrame: {} };
    const electron = {
      app: { requestSingleInstanceLock: () => true, on() {}, whenReady: () => ({ then() {} }) },
      BrowserWindow: { fromWebContents: s => s === sender ? {} : null },
      ipcMain: { handle: (name, fn) => { assert.equal(name, 'trueline:save-project'); handler = fn; } },
      dialog: { showSaveDialog: async () => choice },
    };
    const fileSystem = { ...fs, promises: { ...fs.promises, rename: async (...args) => { if (failRename) throw new Error('Simulated disk failure'); return fs.promises.rename(...args); } } };
    vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../electron/main.cjs'), 'utf8'), {
      require: name => name === 'electron' ? electron : name === 'fs' ? fileSystem : require(name),
      __dirname: path.join(__dirname, '../electron'), process, URL,
    });
    const event = { sender, senderFrame: sender.mainFrame };
    const project = { name: 'part', app: 'trueline', entities: [], layers: [{ id: 'L0' }] };
    const payload = { name: 'part.trueline.json', json: JSON.stringify(project) };
    choice = { canceled: true }; assert.equal((await handler(event, payload)).canceled, true);
    assert.deepEqual(await fs.promises.readdir(directory), []);
    const target = path.join(directory, 'part.trueline.json');
    choice = { canceled: false, filePath: target };
    assert.equal((await handler(event, payload)).saved, true);
    assert.deepEqual(JSON.parse(await fs.promises.readFile(target, 'utf8')), project);
    payload.json = JSON.stringify({ ...project, name: 'updated part' });
    assert.equal((await handler(event, payload)).saved, true);
    assert.equal(JSON.parse(await fs.promises.readFile(target, 'utf8')).name, 'updated part');
    failRename = true; payload.json = JSON.stringify({ ...project, name: 'must not replace old file' });
    const failed = await handler(event, payload); assert.equal(failed.saved, false);
    assert.equal(JSON.parse(await fs.promises.readFile(target, 'utf8')).name, 'updated part');
    assert.deepEqual(await fs.promises.readdir(directory), ['part.trueline.json']);
    await assert.rejects(handler({ sender, senderFrame: {} }, payload), /Invalid save caller/);
    console.log('native save: PASS (cancel, write, replace, failed-write preservation)');
  } finally { await fs.promises.rm(directory, { recursive: true, force: true }); }
})().catch(err => { console.error(err); process.exitCode = 1; });
