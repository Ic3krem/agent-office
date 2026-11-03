// The only bridge from the dashboard window to the desktop shell: read and set the notch on/off.
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('agentOfficeDesktop', {
  guard: {
    get: () => ipcRenderer.invoke('guard:get'),
    set: patch => ipcRenderer.invoke('guard:set', patch && typeof patch === 'object' ? patch : {}),
    remember: (key, label) => ipcRenderer.invoke('guard:remember', String(key || ''), String(label || '')),
    forget: key => ipcRenderer.invoke('guard:forget', String(key || '')),
  },
  notch: {
    get: () => ipcRenderer.invoke('notch:get'),
    set: on => ipcRenderer.invoke('notch:set', on === true),
  },
});
