// The only bridge from Kiro's page to the desktop: click-through, dragging, opening the office.
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('kiroDesk', {
  interactive: on => ipcRenderer.send('kiro:interactive', !!on),
  move: (dx, dy) => ipcRenderer.send('kiro:move', Number(dx), Number(dy)),
  moved: () => ipcRenderer.send('kiro:moved'),
  office: () => ipcRenderer.send('kiro:office'),
});
