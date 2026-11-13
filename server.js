// Agent Map: servidor local (solo 127.0.0.1) con API de sesiones y terminales reales vía node-pty.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { WebSocketServer } from 'ws';
import pty from 'node-pty';
import { scanAll, liveSessions, useHookStates, isUuid, readMessages, pluginRepos, planInfo, CLAUDE_DIR } from './lib/scan.js';
import { USAGE_FILE } from './statusline-tap.js';
import { listDirs, makeDir, isDir } from './lib/folders.js';
import { readPrefs, updatePrefs, isSoundName, withAvailableSounds } from './lib/prefs.js';
import { createTeam, teamStatus } from './lib/team.js';
import { createThrottle, sanitize, startLagMonitor, activity } from './lib/diag.js';
import { TermBuffer } from './lib/termbuf.js';
import { ensureHookFile, pruneEvents, hookDiagnostics, projectHook, setProjectHook, lastEventIn, hookStates } from './lib/hooks.js';
useHookStates(hookStates); // estado del hook oficial en liveSessions (respaldo: sessions/*.json)

const HOST = '127.0.0.1';
const here = path.dirname(fileURLToPath(import.meta.url));
const nm = p => path.join(here, 'node_modules', p);

// Archivos servidos: la carpeta public/ más los de xterm desde node_modules (sin CDN).
const VENDOR = {
  '/vendor/xterm.js': nm('@xterm/xterm/lib/xterm.js'),
  '/vendor/xterm.css': nm('@xterm/xterm/css/xterm.css'),
  '/vendor/addon-fit.js': nm('@xterm/addon-fit/lib/addon-fit.js'),
};
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png' };
// Sonidos de aviso: se leen del disco local, nunca de internet. Orden: los del usuario (~/.agent-map/sounds),
// Sounds/ junto al código (desarrollo), resources/sounds de la app instalada (solo en la compilación local,
// `npm run dist:local`: esos audios no se redistribuyen en las releases públicas) y al final los incluidos con la app
// (assets/sounds: los predeterminados, originales). Un archivo propio con el mismo nombre gana.
export const SOUNDS_DIR = path.join(path.dirname(USAGE_FILE), 'sounds');
const SOUND_DIRS = [SOUNDS_DIR, path.join(here, 'Sounds'), ...(process.resourcesPath ? [path.join(process.resourcesPath, 'sounds')] : []),
  path.join(here, 'assets', 'sounds')];
const AUDIO_TYPES = { '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.ogg': 'audio/ogg' };
/** nombre -> carpeta. Solo archivos reales que aparecen al listar las carpetas autorizadas (sin enlaces ni rutas). */
async function soundFiles() {
  const found = new Map();
  for (const dir of SOUND_DIRS) {
    let entries = [];
    try { entries = await fs.promises.readdir(dir, { withFileTypes: true }); } catch { continue; } // carpeta inexistente
    for (const e of entries) if (e.isFile() && isSoundName(e.name) && !found.has(e.name)) found.set(e.name, dir);
  }
  return found;
}
// Se llenan al escuchar, cuando ya se conoce el puerto real (la app de escritorio usa uno al azar).
const ALLOWED_ORIGINS = new Set();
const ALLOWED_HOSTS = new Set();

let lastTree = [];

const json = (res, data) => { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(data)); };
async function readJson(req) {
  let body = '';
  for await (const chunk of req) { body += chunk; if (body.length > 10_000) throw new Error('Cuerpo demasiado grande'); }
  return JSON.parse(body || '{}');
}

// ---- En vivo: GET /api/events (Server-Sent Events) avisa en ~1 s cuando una sesión de Claude cambia de estado
// (trabajando, terminó, espera permiso) o se abre o cierra, para que la página recargue sin esperar su intervalo.
// Mira ~/.claude/sessions/*.json y los registros del hook (~/.agent-map/events), y solo mientras haya una página conectada.
export const LIVE_POLL_MS = 1000;
const liveClients = new Set();
let liveTimer = null, liveSig = null, livePolling = false;
// Huella del estado en vivo: cambia con cualquier transición, aunque entre dos lecturas haya pasado por otro estado.
async function liveSignature() {
  // Con el hook, también la herramienta en uso: el panel muestra qué está haciendo (como mucho una recarga por segundo).
  return [...await liveSessions()].map(([id, l]) => `${id}:${l.pid}:${l.status}:${l.statusUpdatedAt ?? ''}${l.activity ? ':' + (l.activity.tool || '') : ''}`).sort().join(',');
}
const sendLive = (res, sig) => res.write(`event: live\ndata: ${JSON.stringify(sig)}\n\n`);
async function pollLive() {
  if (livePolling) return; // una lectura lenta no se superpone con la siguiente
  livePolling = true;
  try {
    const sig = await liveSignature();
    if (sig !== liveSig) { liveSig = sig; for (const res of liveClients) sendLive(res, sig); }
  } catch (err) { throttled('live', 'no se pudo leer el estado en vivo: ' + sanitize(err.message)); }
  finally { livePolling = false; }
}
async function openLive(res) {
  res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive' });
  res.write('retry: 3000\n\n'); // si se corta (suspensión, recarga), el navegador reconecta solo
  liveClients.add(res);
  res.on('close', () => { // la página se cerró, recargó o perdió la conexión
    liveClients.delete(res);
    if (!liveClients.size) { clearInterval(liveTimer); liveTimer = null; liveSig = null; }
  });
  if (liveSig === null) liveSig = await liveSignature().catch(() => '');
  if (!res.destroyed) sendLive(res, liveSig); // estado actual al conectar: la página compara y recarga si cambió
  if (!liveTimer && liveClients.size) liveTimer = setInterval(pollLive, LIVE_POLL_MS);
}

// ---- Diagnóstico: errores HTTP y peticiones en curso (método y ruta; nunca query, cuerpo ni cabeceras) ----
const inflight = new Map(); // "GET /api/tree" -> cantidad en curso
/** Peticiones atendiéndose ahora mismo, para dar contexto a un aviso de bloqueo del event loop. */
export const activeRequests = () => [...inflight].map(([k, n]) => n > 1 ? `${k} ×${n}` : k).join(', ');
const throttled = createThrottle(msg => logger(msg));
function track(req, res, url) {
  if (url.pathname === '/api/events') return; // conexión permanente: no es una petición "en curso" para el monitor
  const route = `${req.method} ${sanitize(url.pathname, 80)}`;
  inflight.set(route, (inflight.get(route) || 0) + 1);
  res.on('close', () => {
    const n = inflight.get(route) - 1;
    n > 0 ? inflight.set(route, n) : inflight.delete(route);
    const code = res.statusCode;
    const api = url.pathname.startsWith('/api/');
    if (code < 400 || (code === 404 && !api)) return; // los estáticos que no existen no son errores de la app
    const err = res.err;
    const kind = err ? `${err.name}${err.code ? ' ' + err.code : ''}` : 'sin excepción';
    // 4xx: sin mensaje (puede repetir lo que escribió el usuario: nombres de carpetas o de agentes).
    const msg = code >= 500 && err ? `: ${sanitize(err.message)}` : '';
    throttled(`${route} ${code} ${kind}`, `HTTP ${code} ${route} (${kind}${msg})`);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${HOST}`);
  track(req, res, url);
  // Contra DNS rebinding: una web ajena que apunte su dominio a 127.0.0.1 llega con otro Host.
  if (!ALLOWED_HOSTS.has(req.headers.host)) { res.writeHead(403); return res.end(); }
  try {
    if (url.pathname === '/api/events') return await openLive(res);
    if (url.pathname === '/api/usage') {
      // Límites del plan que guarda statusline-tap.js; null si todavía no hay datos.
      let usage = null;
      try { usage = JSON.parse(await fs.promises.readFile(USAGE_FILE, 'utf8')); } catch {}
      return json(res, { plan: await planInfo(), usage });
    }
    if (url.pathname === '/api/dirs') {
      try { return json(res, await listDirs(url.searchParams.get('path'))); }
      catch (err) { res.err = err; res.writeHead(400); return res.end(err.code === 'ENOENT' ? 'La carpeta no existe' : err.code === 'EPERM' || err.code === 'EACCES' ? 'Sin permiso para abrir esta carpeta' : err.message); }
    }
    if (url.pathname === '/api/mkdir' && req.method === 'POST') {
      // Escribe en disco: solo desde la propia página (otra web podría mandar un POST simple).
      if (!ALLOWED_ORIGINS.has(req.headers.origin)) { res.writeHead(403); return res.end(); }
      try { const { parent, name } = await readJson(req); return json(res, { path: await makeDir(parent, name) }); }
      catch (err) { res.err = err; res.writeHead(400); return res.end(err.code === 'EEXIST' ? 'Ya existe una carpeta con ese nombre' : err.message); }
    }
    if (url.pathname === '/api/team') {
      if (req.method === 'POST') {
        // Escribe archivos en la carpeta del proyecto: solo desde la propia página.
        if (!ALLOWED_ORIGINS.has(req.headers.origin)) { res.writeHead(403); return res.end(); }
        try {
          const body = await readJson(req);
          if (!isDir(body?.dir)) throw new Error('Carpeta no encontrada');
          return json(res, createTeam(path.resolve(body.dir), body));
        } catch (err) { res.err = err; res.writeHead(400); return res.end(err.message); }
      }
      // Se consulta cada 1,5 s: sin statSync. Una ruta que no es carpeta o no existe da null igual que antes,
      // porque teamStatus no encuentra el archivo del equipo.
      const dir = url.searchParams.get('dir');
      return json(res, typeof dir === 'string' && path.isAbsolute(dir) ? await teamStatus(dir) : null);
    }
    if (url.pathname === '/api/hook') return json(res, await hookDiagnostics()); // diagnóstico: ¿llegan eventos?
    if (url.pathname === '/api/hook/project') {
      // Hook oficial en UNA carpeta, solo cuando el usuario lo pide. GET = estado y vista previa (no escribe nada).
      try {
        if (req.method !== 'POST') { const info = projectHook(url.searchParams.get('dir'), CLAUDE_DIR); return json(res, { ...info, lastEventAt: await lastEventIn(info.dir) }); }
        // Escribe en la carpeta del proyecto: solo desde la propia página, y con la acción explícita.
        if (!ALLOWED_ORIGINS.has(req.headers.origin)) { res.writeHead(403); return res.end(); }
        const body = await readJson(req);
        if (typeof body?.install !== 'boolean') throw new Error('Acción inválida');
        if (body.install) ensureHookFile(); // el comando apunta a ~/.agent-map/agentmap-hook.mjs: que exista
        return json(res, setProjectHook(body.dir, CLAUDE_DIR, body.install));
      } catch (err) { res.err = err; res.writeHead(400); return res.end(err.message); }
    }
    if (url.pathname === '/api/prefs') {
      // Los sonidos que se entregan son los que de verdad hay (un predeterminado viejo ausente pasa al incluido).
      const withSounds = async p => ({ ...p, sounds: withAvailableSounds(p.sounds, await soundFiles()) });
      if (req.method !== 'POST') return json(res, await withSounds(readPrefs()));
      // Escribe en disco: solo desde la propia página.
      if (!ALLOWED_ORIGINS.has(req.headers.origin)) { res.writeHead(403); return res.end(); }
      try { return json(res, await withSounds(updatePrefs(await readJson(req)))); }
      catch (err) { res.err = err; res.writeHead(400); return res.end(err.message); }
    }
    if (url.pathname === '/api/tree') {
      lastTree = await scanAll();
      const open = [...terms.values()].map(t => ({ key: t.key, label: t.label, sessionId: t.sessionId, cwd: t.cwd, alive: t.alive }));
      res.writeHead(200, { 'content-type': 'application/json' });
      return res.end(JSON.stringify({ projects: lastTree, open, repos: pluginRepos() }));
    }
    if (url.pathname === '/api/messages') {
      // Conversación completa (prompts + respuestas); solo de sesiones conocidas, nunca rutas del navegador.
      const id = url.searchParams.get('id');
      const found = isUuid(id) && findSession(id);
      if (!found) { res.writeHead(404); return res.end('Sesión no encontrada'); }
      const msgs = await readMessages(path.join(CLAUDE_DIR, 'projects', found.s.dirKey, id + '.jsonl'));
      res.writeHead(200, { 'content-type': 'application/json' });
      return res.end(JSON.stringify(msgs));
    }
    if (url.pathname === '/api/sounds') { // qué sonidos hay de verdad, para las opciones
      const files = [...await soundFiles()].map(([name, dir]) => ({ name, mine: dir === SOUNDS_DIR }));
      return json(res, { dir: SOUNDS_DIR, files: files.sort((a, b) => a.name.localeCompare(b.name)) });
    }
    if (url.pathname.startsWith('/sounds/')) {
      let name = '';
      try { name = decodeURIComponent(url.pathname.slice('/sounds/'.length)); } catch { /* %mal formado */ }
      // Solo un nombre que aparezca al listar una carpeta autorizada: nada de rutas, enlaces ni dispositivos.
      const dir = isSoundName(name) && (await soundFiles()).get(name);
      if (!dir) { res.writeHead(404); return res.end('No encontrado'); }
      const data = await fs.promises.readFile(path.join(dir, name));
      res.writeHead(200, { 'content-type': AUDIO_TYPES[path.extname(name).toLowerCase()] });
      return res.end(data);
    }
    const file = VENDOR[url.pathname] ||
      path.join(here, 'public', url.pathname === '/' ? 'index.html' : path.normalize(url.pathname));
    if (!file.startsWith(here)) { res.writeHead(403); return res.end(); }
    const data = await fs.promises.readFile(file);
    res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream' });
    res.end(data);
  } catch (err) {
    res.writeHead(err.code === 'ENOENT' ? 404 : 500);
    res.end(err.code === 'ENOENT' ? 'No encontrado' : 'Error');
    res.err = err; // se registra al cerrar la respuesta (track), con el mensaje saneado
  }
});

// ---- Terminales: siguen vivas aunque cambies de sesión en la UI ----
const terms = new Map(); // key -> { key, label, sessionId, pty, buffer, sockets, alive }
const MAX_BUFFER = 400_000;

function findSession(id) {
  for (const p of lastTree) for (const s of p.sessions) if (s.id === id) return { p, s };
  return null;
}

// Si el servidor se lanzó desde dentro de Claude Code, no pasar las marcas de esa sesión:
// harían que el claude hijo se creyera un subproceso y desactive el guardado del historial.
const SESSION_VARS = ['CLAUDECODE', 'CLAUDE_PID', 'CLAUDE_EFFORT', 'CLAUDE_CODE_CHILD_SESSION', 'CLAUDE_CODE_SESSION_ID',
  'CLAUDE_CODE_MESSAGING_SOCKET', 'CLAUDE_CODE_MESSAGING_TOKEN', 'CLAUDE_CODE_SESSION_ATTENDED',
  'CLAUDE_CODE_ENTRYPOINT', 'CLAUDE_CODE_EXECPATH'];
function cleanEnv() {
  const env = { ...process.env };
  for (const k of SESSION_VARS) delete env[k];
  return env;
}

// En Windows, pty.kill() solo mata lo conectado a la consola (los MCP de Claude tienen consola propia y
// quedaban vivos) y cerrar la pseudo-consola al salir puede colgar la app. `taskkill /T` tampoco basta:
// deja escapar hijos cuyo padre muere primero. Se fotografía el árbol entero y se mata desde las hojas.
// El hijo debe ser más nuevo que su padre: así no se toca un proceso ajeno que herede un PID reciclado.
const PS_KILL_TREE = `
$all = Get-CimInstance Win32_Process -Property ProcessId,ParentProcessId,CreationDate
function Kids($p) { $all | ? { $_.ParentProcessId -eq $p.ProcessId -and $_.CreationDate -ge $p.CreationDate } | % { Kids $_; $_ } }
$root = $all | ? ProcessId -eq ROOT
if ($root) { foreach ($x in @(Kids $root) + $root) { Stop-Process -Id $x.ProcessId -Force -ErrorAction SilentlyContinue } }`;
// Asíncrono a propósito: con execFileSync el hilo quedaba bloqueado hasta 15 s por terminal y el
// timeout de killAllTerms no podía saltar (causa probable del cierre que una vez quedó colgado).
function killTree(t) {
  if (process.platform !== 'win32') return t.pty.kill();
  execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', PS_KILL_TREE.replace(/ROOT/g, String(t.pty.pid | 0))],
    { windowsHide: true, timeout: 15000 },
    err => { if (err) logger(`killTree falló para PID ${t.pty.pid}: ${err.message}`); });
}

// La app de escritorio redirige esto a su archivo de log; en modo navegador sale por consola.
let logger = msg => console.error(msg);
export const setLogger = fn => { logger = fn; };

function startTerm({ key, label, sessionId, cwd, args, cols, rows }) {
  const shell = process.platform === 'win32' ? (process.env.ComSpec || 'cmd.exe') : 'claude';
  const shellArgs = process.platform === 'win32' ? ['/c', 'claude', ...args] : args;
  const p = pty.spawn(shell, shellArgs, { name: 'xterm-256color', cols, rows, cwd, env: cleanEnv() });
  const t = { key, label, sessionId, cwd, pty: p, buffer: new TermBuffer(MAX_BUFFER), sockets: new Set(), alive: true };
  p.onData(d => {
    t.buffer.push(d); // últimos MAX_BUFFER caracteres, sin copiar todo el búfer por cada trozo
    activity.add('terminal', Buffer.byteLength(d)); // solo cantidad y bytes, nunca el contenido
    for (const ws of t.sockets) ws.send(d);
  });
  p.onExit(({ exitCode }) => {
    t.alive = false;
    const msg = `\r\n\x1b[90m[Proceso terminado, código ${exitCode}. Cierra la pestaña o vuelve a abrir la sesión.]\x1b[0m\r\n`;
    t.buffer.append(msg);
    for (const ws of t.sockets) ws.send(msg);
  });
  terms.set(key, t);
  return t;
}

const wss = new WebSocketServer({ noServer: true });
server.on('upgrade', (req, socket, head) => {
  // Bloquea páginas web ajenas que intenten abrir una terminal en tu máquina.
  if (!ALLOWED_ORIGINS.has(req.headers.origin)) {
    throttled('ws-origen', `WebSocket rechazado: origen no permitido (${sanitize(req.headers.origin || 'sin origen', 80)})`);
    socket.destroy(); return;
  }
  wss.handleUpgrade(req, socket, head, ws => onTerminal(ws, new URL(req.url, `http://${HOST}`)));
});

async function onTerminal(ws, url) {
  const cols = Math.max(20, Number(url.searchParams.get('cols')) || 100);
  const rows = Math.max(5, Number(url.searchParams.get('rows')) || 30);
  const sessionId = url.searchParams.get('session');
  const newCwd = url.searchParams.get('newIn');
  const key = url.searchParams.get('key');

  let t = key && terms.get(key);
  if (t && !t.alive) { terms.delete(key); t = null; }
  if (!t) {
    if (!lastTree.length) lastTree = await scanAll();
    if (sessionId) {
      const found = isUuid(sessionId) && findSession(sessionId);
      if (!found) { ws.close(4004, 'Sesión no encontrada'); return; }
      t = startTerm({ key: sessionId, label: found.s.title || found.s.aiTitle || found.p.name, sessionId,
        cwd: found.s.cwd || found.p.cwd, args: ['--resume', sessionId], cols, rows });
    } else if (newCwd) {
      // Cualquier carpeta existente que elija el usuario; el chequeo de Origin del upgrade impide que la mande otra web.
      if (!isDir(newCwd)) { ws.close(4004, 'Carpeta no encontrada'); return; }
      const cwd = path.resolve(newCwd);
      const k = 'new-' + Date.now();
      t = startTerm({ key: k, label: 'Nueva · ' + (path.basename(cwd) || cwd), sessionId: null, cwd, args: [], cols, rows });
    } else { ws.close(4000, 'Falta parámetro'); return; }
  }

  t.sockets.add(ws);
  ws.send(JSON.stringify({ t: 'hello', key: t.key, label: t.label }));
  if (t.buffer.length) ws.send(t.buffer.toString());
  ws.on('message', raw => {
    let m;
    try { m = JSON.parse(raw); } catch { return; }
    if (m.t === 'in' && t.alive && typeof m.d === 'string') t.pty.write(m.d);
    else if (m.t === 'resize' && t.alive) t.pty.resize(Math.max(20, m.cols | 0), Math.max(5, m.rows | 0));
    else if (m.t === 'kill') { if (t.alive) killTree(t); terms.delete(t.key); }
  });
  ws.on('close', () => t.sockets.delete(ws));
}

/**
 * Detiene todas las terminales (Claude se cierra; las conversaciones quedan guardadas).
 * Espera a que cada una termine: salir del proceso con ConPTY a medio cerrar corrompe el heap (0xc0000374).
 */
export function killAllTerms(timeoutMs = 10000) {
  const alive = [...terms.values()].filter(t => t.alive);
  const exits = alive.map(t => new Promise(resolve => {
    t.pty.onExit(() => { logger(`terminal ${t.pty.pid} terminó`); resolve(); });
    logger(`matando árbol de la terminal ${t.pty.pid}`);
    try { killTree(t); } catch (err) { logger('killTree lanzó ' + err.message); resolve(); }
  }));
  return Promise.race([Promise.all(exits), new Promise(r => setTimeout(r, timeoutMs))]);
}
export const openTermCount = () => [...terms.values()].filter(t => t.alive).length;

/**
 * Arranca el servidor en 127.0.0.1 (nunca en la red local). port 0 = puerto libre al azar. Devuelve el puerto real.
 * Si el puerto está ocupado rechaza con el error (EADDRINUSE/EACCES) y deja el servidor listo para reintentar:
 * el propio intento de escuchar es la comprobación, así que no hay carrera entre "ver si está libre" y usarlo.
 */
export function startServer(port) {
  return new Promise((resolve, reject) => {
    const onError = err => { server.off('listening', onListening); reject(err); };
    const onListening = () => {
      server.off('error', onError);
      const real = server.address().port;
      for (const h of [HOST, 'localhost']) { ALLOWED_HOSTS.add(`${h}:${real}`); ALLOWED_ORIGINS.add(`http://${h}:${real}`); }
      resolve(real);
    };
    server.once('error', onError);
    server.once('listening', onListening);
    server.listen(port, HOST);
  });
}

/** Al abrir la app: copia agentmap-hook a ~/.agent-map (si cambió) y borra registros de eventos viejos. Nada de Claude Code. */
export function prepareHook() {
  try { ensureHookFile(); } catch (err) { logger('no se pudo copiar agentmap-hook: ' + sanitize(err.message)); }
  pruneEvents().catch(() => {});
}

// Modo navegador: `npm run web` (o `node server.js`).
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  prepareHook();
  const port = await startServer(Number(process.env.PORT) || 4317);
  console.log(`Agent Map listo en http://localhost:${port}`);
  if (process.env.AGENT_MAP_LAG !== '0') startLagMonitor({ log: msg => logger(msg), context: activeRequests, activity });
  const shutdown = () => killAllTerms().then(() => process.exit(0));
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}
