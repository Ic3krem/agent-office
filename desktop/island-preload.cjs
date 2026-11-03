// The only bridge from the island page to the desktop (plus settings patches and the chime toggle): click-through, focus, opening an office view, hotkey toggle, and the visibility/mute/fullscreen/peek state pushed from the tray.
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('islandDesk', {
  interactive: on => ipcRenderer.send('island:interactive', !!on),
  focus: () => ipcRenderer.send('island:focus'),
  office: view => ipcRenderer.send('island:office', String(view || '')),
  settings: patch => ipcRenderer.send('island:settings', patch && typeof patch === 'object' ? patch : {}),
  mute: on => ipcRenderer.send('island:mute', !!on),
  media: verb => ipcRenderer.send('island:media', String(verb || '')),
  guard: {
    get: () => ipcRenderer.invoke('guard:get'),
    set: patch => ipcRenderer.invoke('guard:set', patch && typeof patch === 'object' ? patch : {}),
    remember: (key, label) => ipcRenderer.invoke('guard:remember', String(key || ''), String(label || '')),
    forget: key => ipcRenderer.invoke('guard:forget', String(key || '')),
  },
  update: {
    get: () => ipcRenderer.invoke('update:get'),
    check: () => ipcRenderer.invoke('update:check'),
    install: () => ipcRenderer.invoke('update:install'),
    set: patch => ipcRenderer.invoke('update:set', patch && typeof patch === 'object' ? { auto: typeof patch.auto === 'boolean' ? patch.auto : undefined } : {}),
    on: fn => ipcRenderer.on('island:update', (_e, u) => fn(u)),
  },
  onLyrics: fn => ipcRenderer.on('island:lyrics', (_e, l) => fn(l)),
  onNowPlaying: fn => ipcRenderer.on('island:nowplaying', (_e, np) => fn(np)),
  onToggle: fn => ipcRenderer.on('island:toggle', () => fn()),
  onState: fn => ipcRenderer.on('island:state', (_e, st) => fn(st)),
});
