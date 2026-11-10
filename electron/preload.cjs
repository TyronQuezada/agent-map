// Puente mínimo entre la página y la ventana: solo botones de ventana, confirmación de cierre y portapapeles de texto.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('desktop', {
  minimize: () => ipcRenderer.send('win', 'minimize'),
  maximize: () => ipcRenderer.send('win', 'maximize'),
  close: () => ipcRenderer.send('win', 'close'),
  confirmClose: () => ipcRenderer.send('win', 'close-confirmed'),
  toggleFullScreen: () => ipcRenderer.send('win', 'fullscreen'),
  getState: () => ipcRenderer.invoke('win-state'), // { max, full }
  readClipboard: () => ipcRenderer.invoke('clip-read'),
  writeClipboard: text => ipcRenderer.send('clip-write', String(text)),
  onConfirmClose: fn => ipcRenderer.on('confirm-close', (_e, openTerms) => fn(openTerms)),
  onStateChange: fn => ipcRenderer.on('win-state', (_e, st) => fn(st)),
});
