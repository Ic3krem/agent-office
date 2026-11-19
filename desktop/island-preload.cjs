// The only bridge from the island page to the desktop (plus settings patches and the chime toggle): closed view and pin/held-open, focus, opening an office view, hotkey toggle, and the visibility/mute/fullscreen/peek state pushed from the tray.
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('islandDesk', {
  closedView: kind => ipcRenderer.send('island:closedView', String(kind || '')),
  hold: h => ipcRenderer.send('island:hold', { pinned: !!(h && h.pinned), forced: !!(h && h.forced), busy: !!(h && h.busy) }),
  dismiss: () => ipcRenderer.send('island:dismiss'),
  focus: () => ipcRenderer.send('island:focus'),
  office: view => ipcRenderer.send('island:office', String(view || '')),
  settings: patch => ipcRenderer.send('island:settings', patch && typeof patch === 'object' ? patch : {}),
  mute: on => ipcRenderer.send('island:mute', !!on),
  media: verb => ipcRenderer.send('island:media', String(verb || '')),
  perfOpen: on => ipcRenderer.send('island:perfOpen', !!on), // the Performance tab or card is shown
  fpsSetup: () => ipcRenderer.invoke('island:fpsSetup'), // "Turn on FPS": the one-time elevated group step (Windows); only the button calls it
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
  store: {
    get: () => ipcRenderer.invoke('notch:store:get'),
    set: store => ipcRenderer.invoke('notch:store:set', store),
  },
  // The calendar link goes to main once, here; the page never gets it back (onCalendar carries linked/host/events only).
  calendar: {
    set: link => ipcRenderer.invoke('calendar:set', typeof link === 'string' ? link : null), // a non-string is refused by main, never read as ''
    refresh: () => ipcRenderer.invoke('calendar:refresh'),
    join: id => ipcRenderer.send('calendar:join', String(id || '')),
  },
  onCalendar: fn => ipcRenderer.on('island:calendar', (_e, c) => fn(c)),
  onLyrics: fn => ipcRenderer.on('island:lyrics', (_e, l) => fn(l)),
  onPerf: fn => ipcRenderer.on('island:perf', (_e, p) => fn(p)),
  onNowPlaying: fn => ipcRenderer.on('island:nowplaying', (_e, np) => fn(np)),
  onToggle: fn => ipcRenderer.on('island:toggle', () => fn()),
  onState: fn => ipcRenderer.on('island:state', (_e, st) => fn(st)),
});
