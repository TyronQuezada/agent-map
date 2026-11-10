// Agent Map como app de escritorio: arranca el servidor dentro de la app (puerto interno al azar)
// y lo muestra en una ventana sin marco con la barra de título XP propia.
import { app, BrowserWindow, ipcMain, shell, dialog } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startServer, killAllTerms, openTermCount, setLogger } from '../server.js';
import { USAGE_FILE } from '../statusline-tap.js';

const here = path.dirname(fileURLToPath(import.meta.url));
let win = null;
let origin = '';
let quitting = false;

// Una sola instancia: abrirla de nuevo (o desde la barra de tareas) enfoca la ventana que ya existe.
const firstInstance = app.requestSingleInstanceLock();
if (!firstInstance) app.exit(0); // exit, no quit: quit es asíncrono y alcanzaría a crear otra ventana
app.on('second-instance', () => {
  if (!win) return;
  if (win.isMinimized()) win.restore();
  win.show(); win.focus();
});

// Copia el tap de statusline a ~/.agent-map: una ruta fija para settings.json aunque la app
// se instale en otra carpeta o se reinstale. .mjs para que node lo ejecute como módulo ES.
export const TAP_FILE = path.join(path.dirname(USAGE_FILE), 'statusline-tap.mjs');
function installTap() {
  try {
    const src = fs.readFileSync(path.join(here, '..', 'statusline-tap.js')); // fs de Electron lee dentro del asar
    let cur = null;
    try { cur = fs.readFileSync(TAP_FILE); } catch {}
    if (cur && cur.equals(src)) return;
    fs.mkdirSync(path.dirname(TAP_FILE), { recursive: true });
    fs.writeFileSync(TAP_FILE, src);
  } catch (err) { console.error('No se pudo instalar statusline-tap:', err); }
}

async function createWindow() {
  installTap();
  const port = await startServer(0);
  origin = `http://127.0.0.1:${port}`;
  win = new BrowserWindow({
    width: 1400, height: 880, minWidth: 900, minHeight: 560,
    frame: false, backgroundColor: '#ece9d8', show: false,
    title: 'Agent Map', icon: path.join(here, '..', 'build', 'icon.ico'),
    webPreferences: { preload: path.join(here, 'preload.cjs'), contextIsolation: true, sandbox: true, nodeIntegration: false },
  });
  win.once('ready-to-show', () => win.show());
  win.on('maximize', () => win.webContents.send('win-state', true));
  win.on('unmaximize', () => win.webContents.send('win-state', false));

  // Links externos (repos de agentes, documentación) se abren en el navegador, nunca dentro de la app.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https:\/\//.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e, url) => { if (!url.startsWith(origin)) e.preventDefault(); });

  // Cerrar (×, Alt+F4, barra de tareas): pregunta primero con el popup XP de la página.
  win.on('close', e => {
    if (quitting) return;
    e.preventDefault();
    if (win.webContents.isLoading() || win.webContents.isCrashed()) return askNative();
    win.webContents.send('confirm-close', openTermCount());
  });

  await win.loadURL(origin);
}

// Respaldo si la página no puede mostrar su popup.
async function askNative() {
  const { response } = await dialog.showMessageBox(win, {
    type: 'question', buttons: ['Cerrar Agent Map', 'Cancelar'], defaultId: 1, cancelId: 1,
    title: 'Agent Map', message: '¿Seguro que quieres cerrar Agent Map?',
  });
  if (response === 0) quit();
}

// Registro mínimo en ~/.agent-map/agent-map.log (arranque, cierre y errores) para poder diagnosticar.
const LOG_FILE = path.join(path.dirname(USAGE_FILE), 'agent-map.log');
function log(msg) {
  try { fs.mkdirSync(path.dirname(LOG_FILE), { recursive: true }); fs.appendFileSync(LOG_FILE, `${new Date().toISOString()} ${msg}\n`); } catch {}
}
setLogger(log);
process.on('uncaughtException', err => log('uncaughtException ' + (err?.stack || err)));
process.on('unhandledRejection', err => log('unhandledRejection ' + (err?.stack || err)));

// Salida ordenada: esconder la ventana, esperar a que las terminales terminen y recién ahí salir.
async function quit() {
  if (quitting) return;
  quitting = true;
  log(`cerrando: ${openTermCount()} terminal(es) abiertas`);
  win?.hide();
  try { await killAllTerms(); } catch (err) { log('killAllTerms falló ' + (err?.stack || err)); }
  log('terminales detenidas, saliendo');
  app.exit(0);
}

ipcMain.on('win', (e, action) => {
  if (!win || e.sender !== win.webContents) return;
  if (action === 'minimize') win.minimize();
  else if (action === 'maximize') win.isMaximized() ? win.unmaximize() : win.maximize();
  else if (action === 'close') win.close(); // pasa por la confirmación de arriba
  else if (action === 'close-confirmed') quit();
});
ipcMain.handle('win-is-maximized', e => e.sender === win?.webContents && win.isMaximized());

if (firstInstance) app.whenReady().then(createWindow).catch(err => {
  dialog.showErrorBox('Agent Map no pudo iniciar', String(err?.stack || err));
  app.quit();
});
app.on('window-all-closed', () => quit());
// Cierre de Windows (apagar, cerrar sesión) u otro app.quit(): también pasa por la salida ordenada.
app.on('before-quit', e => { if (!quitting) { e.preventDefault(); quit(); } });
