const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('accessGate', Object.freeze({
  verify: (password) => ipcRenderer.invoke('access:verify', password),
  exit: () => ipcRenderer.invoke('access:exit')
}));