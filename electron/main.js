// Agent Map como app de escritorio: arranca el servidor dentro de la app (puerto fijo 47317, o al azar si está ocupado)
// y lo muestra en una ventana sin marco con la barra de título XP propia.
import { app, BrowserWindow, ipcMain, shell, dialog, clipboard, powerMonitor } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startServer, killAllTerms, openTermCount, setLogger, activeRequests } from '../server.js';
import { USAGE_FILE } from '../statusline-tap.js';
import { readPrefs } from '../lib/prefs.js';
import { startLagMonitor } from '../lib/diag.js';

// Diagnóstico interno: false lo apaga. Solo registra tramos del event loop ocupados más de lagThresholdMs.
const DIAG = { lagMonitor: true, lagThresholdMs: 50 };

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

// Puerto fijo: la página siempre tiene el mismo origen (http://127.0.0.1:47317), así que su localStorage
// (paneles, secciones plegadas, mensajes leídos) se conserva entre reinicios. Está fuera del rango efímero de
// Windows (49152+). Si está ocupado o reservado, se usa uno al azar: nunca se habla con lo que lo ocupe, porque
// la ventana se abre en el puerto donde de verdad quedó escuchando este proceso.
const PREFERRED_PORT = 47317;
async function listenOnPreferredPort() {
  try { return await startServer(PREFERRED_PORT); }
  catch (err) {
    if (err.code !== 'EADDRINUSE' && err.code !== 'EACCES') throw err;
    const port = await startServer(0);
    log(`puerto ${PREFERRED_PORT} no disponible (${err.code}): se usa el ${port}; en este arranque no se conservan las preferencias de la ventana`);
    return port;
  }
}

async function createWindow() {
  installTap();
  const port = await listenOnPreferredPort();
  origin = `http://127.0.0.1:${port}`;
  const prefs = readPrefs();
  win = new BrowserWindow({
    width: 1400, height: 880, minWidth: 900, minHeight: 560,
    fullscreen: prefs.startFullscreen, // como apretar F11 al abrir (se cambia en ⚙ Opciones)
    frame: false, backgroundColor: { matrix: '#000000', noche: '#0f1626' }[prefs.theme] || '#ece9d8', show: false,
    title: 'Agent Map', icon: path.join(here, '..', 'build', 'icon.ico'),
    webPreferences: { preload: path.join(here, 'preload.cjs'), contextIsolation: true, sandbox: true, nodeIntegration: false },
  });
  win.once('ready-to-show', () => win.show());
  const sendState = () => win.webContents.send('win-state', { max: win.isMaximized(), full: win.isFullScreen() });
  for (const ev of ['maximize', 'unmaximize', 'enter-full-screen', 'leave-full-screen']) win.on(ev, sendState);

  // Links externos (repos de agentes, documentación) se abren en el navegador, nunca dentro de la app.
  // Única ventana propia permitida: la oficina del equipo (para moverla a otro monitor).
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith(origin + '/office.html?')) return { action: 'allow', overrideBrowserWindowOptions: {
      width: 960, height: 760, minWidth: 360, minHeight: 300, title: 'Oficina · Agent Map', autoHideMenuBar: true,
      backgroundColor: '#120d0a', icon: path.join(here, '..', 'build', 'icon.ico'),
    } };
    if (/^https:\/\//.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('did-create-window', child => { // la oficina tampoco puede navegar fuera ni abrir otras ventanas
    child.webContents.on('will-navigate', (e, url) => { if (!url.startsWith(origin)) e.preventDefault(); });
    child.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    watchRenderer(child.webContents, 'oficina');
  });
  watchRenderer(win.webContents, 'principal');
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
if (DIAG.lagMonitor) {
  const lag = startLagMonitor({ log, thresholdMs: DIAG.lagThresholdMs, context: activeRequests });
  // Al suspender el equipo el reloj salta: no es un bloqueo. (powerMonitor solo existe tras app ready.)
  app.whenReady().then(() => { powerMonitor.on('suspend', lag.pause); powerMonitor.on('resume', lag.resume); });
}

// Caídas de una página (proceso renderer). Solo se registran: no hay recarga automática.
function watchRenderer(wc, name) {
  wc.on('render-process-gone', (_e, d) => log(`renderer caído: ventana ${name}, motivo ${d.reason}, código de salida ${d.exitCode}`));
}

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
  else if (action === 'maximize') {
    if (win.isFullScreen()) win.setFullScreen(false); // en pantalla completa, □ vuelve a ventana
    else win.isMaximized() ? win.unmaximize() : win.maximize();
  }
  else if (action === 'fullscreen') win.setFullScreen(!win.isFullScreen());
  else if (action === 'close') win.close(); // pasa por la confirmación de arriba
  else if (action === 'close-confirmed') quit();
});
ipcMain.handle('win-state', e => e.sender === win?.webContents ? { max: win.isMaximized(), full: win.isFullScreen() } : null);
// Portapapeles para la terminal (Ctrl+V / click derecho): la página no tiene acceso directo con sandbox.
ipcMain.handle('clip-read', e => e.sender === win?.webContents ? clipboard.readText() : '');
ipcMain.on('clip-write', (e, text) => { if (e.sender === win?.webContents && typeof text === 'string') clipboard.writeText(text); });

if (firstInstance) app.whenReady().then(createWindow).catch(err => {
  dialog.showErrorBox('Agent Map no pudo iniciar', String(err?.stack || err));
  app.quit();
});
app.on('window-all-closed', () => quit());
// Cierre de Windows (apagar, cerrar sesión) u otro app.quit(): también pasa por la salida ordenada.
app.on('before-quit', e => { if (!quitting) { e.preventDefault(); quit(); } });
