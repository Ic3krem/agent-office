// The only bridge from the dashboard window to the desktop shell: read and set the notch on/off.
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('agentOfficeDesktop', {
  notch: {
    get: () => ipcRenderer.invoke('notch:get'),
    set: on => ipcRenderer.invoke('notch:set', on === true),
  },
});
