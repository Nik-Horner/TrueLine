const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('trueLineFiles', {
  appVersion: () => ipcRenderer.invoke('trueline:app-version'),
  saveProject: ({ json, name }) => ipcRenderer.invoke('trueline:save-project', { json, name }),
});
