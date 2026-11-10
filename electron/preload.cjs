// Puente mínimo entre la página y la ventana: solo botones de ventana y confirmación de cierre.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('desktop', {
  minimize: () => ipcRenderer.send('win', 'minimize'),
  maximize: () => ipcRenderer.send('win', 'maximize'),
  close: () => ipcRenderer.send('win', 'close'),
  confirmClose: () => ipcRenderer.send('win', 'close-confirmed'),
  isMaximized: () => ipcRenderer.invoke('win-is-maximized'),
  onConfirmClose: fn => ipcRenderer.on('confirm-close', (_e, openTerms) => fn(openTerms)),
  onMaximizedChange: fn => ipcRenderer.on('win-state', (_e, max) => fn(max)),
});
