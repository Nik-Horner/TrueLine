const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('trueLineFiles', {
  saveProject: ({ json, name }) => ipcRenderer.invoke('trueline:save-project', { json, name }),
});
