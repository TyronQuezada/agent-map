// Puente mínimo entre la página y la ventana: solo botones de ventana, confirmación de cierre, portapapeles de texto
// y abrir la carpeta de sonidos propios.
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
  openSoundsFolder: () => ipcRenderer.invoke('open-sounds'), // ~/.agent-map/sounds en el Explorador (la crea si falta)
  onConfirmClose: fn => ipcRenderer.on('confirm-close', (_e, openTerms) => fn(openTerms)),
  onStateChange: fn => ipcRenderer.on('win-state', (_e, st) => fn(st)),
});
