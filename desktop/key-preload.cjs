// The native API-key window only: hand the typed key to the main process, or cancel. Nothing else.
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('keyEntry', {
  submit: key => ipcRenderer.send('keyentry:submit', String(key || '')),
  cancel: () => ipcRenderer.send('keyentry:submit', ''),
});
