// The only bridge from the dashboard window to the desktop shell: read and set the notch on/off.
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('agentOfficeDesktop', {
  guard: {
    get: () => ipcRenderer.invoke('guard:get'),
    set: patch => ipcRenderer.invoke('guard:set', patch && typeof patch === 'object' ? patch : {}),
    remember: (key, label) => ipcRenderer.invoke('guard:remember', String(key || ''), String(label || '')),
    forget: key => ipcRenderer.invoke('guard:forget', String(key || '')),
  },
  external: {
    confirm: (key, vals) => ipcRenderer.invoke('external:confirm', String(key || ''), vals && typeof vals === 'object' ? { auto: vals.auto === true, args: String(vals.args ?? ''), command: String(vals.command ?? '') } : {}),
  },
  // Sign-ins: a CLI's own login in a terminal window; Claude's API key only ever typed into the app's native window.
  auth: {
    login: cli => ipcRenderer.invoke('auth:login', String(cli || '')),
    logout: () => ipcRenderer.invoke('auth:logout'),
    keyState: () => ipcRenderer.invoke('auth:keyState'),
    setKey: () => ipcRenderer.invoke('auth:setKey'),
    removeKey: () => ipcRenderer.invoke('auth:removeKey'),
    setMode: mode => ipcRenderer.invoke('auth:setMode', mode === 'key' ? 'key' : 'account'),
  },
  music: { pickFolder: () => ipcRenderer.invoke('music:pickFolder') },
  spotify: { signIn: () => ipcRenderer.invoke('spotify:signIn') },
  notch: {
    get: () => ipcRenderer.invoke('notch:get'),
    set: on => ipcRenderer.invoke('notch:set', on === true),
  },
});
