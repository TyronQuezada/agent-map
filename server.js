// Agent Map: servidor local (solo 127.0.0.1) con API de sesiones y terminales reales vía node-pty.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { WebSocketServer } from 'ws';
import pty from 'node-pty';
import { scanAll, isUuid, readMessages, pluginRepos, planInfo, CLAUDE_DIR } from './lib/scan.js';
import { USAGE_FILE } from './statusline-tap.js';
import { listDirs, makeDir, isDir } from './lib/folders.js';
import { readPrefs, updatePrefs } from './lib/prefs.js';
import { createTeam, teamStatus } from './lib/team.js';

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

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${HOST}`);
  // Contra DNS rebinding: una web ajena que apunte su dominio a 127.0.0.1 llega con otro Host.
  if (!ALLOWED_HOSTS.has(req.headers.host)) { res.writeHead(403); return res.end(); }
  try {
    if (url.pathname === '/api/usage') {
      // Límites del plan que guarda statusline-tap.js; null si todavía no hay datos.
      let usage = null;
      try { usage = JSON.parse(await fs.promises.readFile(USAGE_FILE, 'utf8')); } catch {}
      return json(res, { plan: planInfo(), usage });
    }
    if (url.pathname === '/api/dirs') {
      try { return json(res, await listDirs(url.searchParams.get('path'))); }
      catch (err) { res.writeHead(400); return res.end(err.code === 'ENOENT' ? 'La carpeta no existe' : err.code === 'EPERM' || err.code === 'EACCES' ? 'Sin permiso para abrir esta carpeta' : err.message); }
    }
    if (url.pathname === '/api/mkdir' && req.method === 'POST') {
      // Escribe en disco: solo desde la propia página (otra web podría mandar un POST simple).
      if (!ALLOWED_ORIGINS.has(req.headers.origin)) { res.writeHead(403); return res.end(); }
      try { const { parent, name } = await readJson(req); return json(res, { path: await makeDir(parent, name) }); }
      catch (err) { res.writeHead(400); return res.end(err.code === 'EEXIST' ? 'Ya existe una carpeta con ese nombre' : err.message); }
    }
    if (url.pathname === '/api/team') {
      if (req.method === 'POST') {
        // Escribe archivos en la carpeta del proyecto: solo desde la propia página.
        if (!ALLOWED_ORIGINS.has(req.headers.origin)) { res.writeHead(403); return res.end(); }
        try {
          const body = await readJson(req);
          if (!isDir(body?.dir)) throw new Error('Carpeta no encontrada');
          return json(res, createTeam(path.resolve(body.dir), body));
        } catch (err) { res.writeHead(400); return res.end(err.message); }
      }
      const dir = url.searchParams.get('dir');
      return json(res, isDir(dir) ? teamStatus(dir) : null);
    }
    if (url.pathname === '/api/prefs') {
      if (req.method !== 'POST') return json(res, readPrefs());
      // Escribe en disco: solo desde la propia página.
      if (!ALLOWED_ORIGINS.has(req.headers.origin)) { res.writeHead(403); return res.end(); }
      try { return json(res, updatePrefs(await readJson(req))); }
      catch (err) { res.writeHead(400); return res.end(err.message); }
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
    const file = VENDOR[url.pathname] ||
      path.join(here, 'public', url.pathname === '/' ? 'index.html' : path.normalize(url.pathname));
    if (!file.startsWith(here)) { res.writeHead(403); return res.end(); }
    const data = await fs.promises.readFile(file);
    res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream' });
    res.end(data);
  } catch (err) {
    res.writeHead(err.code === 'ENOENT' ? 404 : 500);
    res.end(err.code === 'ENOENT' ? 'No encontrado' : 'Error');
    if (err.code !== 'ENOENT') console.error(err);
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
  const t = { key, label, sessionId, cwd, pty: p, buffer: '', sockets: new Set(), alive: true };
  p.onData(d => {
    t.buffer = (t.buffer + d).slice(-MAX_BUFFER);
    for (const ws of t.sockets) ws.send(d);
  });
  p.onExit(({ exitCode }) => {
    t.alive = false;
    const msg = `\r\n\x1b[90m[Proceso terminado, código ${exitCode}. Cierra la pestaña o vuelve a abrir la sesión.]\x1b[0m\r\n`;
    t.buffer += msg;
    for (const ws of t.sockets) ws.send(msg);
  });
  terms.set(key, t);
  return t;
}

const wss = new WebSocketServer({ noServer: true });
server.on('upgrade', (req, socket, head) => {
  // Bloquea páginas web ajenas que intenten abrir una terminal en tu máquina.
  if (!ALLOWED_ORIGINS.has(req.headers.origin)) { socket.destroy(); return; }
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
  if (t.buffer) ws.send(t.buffer);
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

/** Arranca el servidor en 127.0.0.1. port 0 = puerto libre al azar. Devuelve el puerto real. */
export function startServer(port) {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, HOST, () => {
      const real = server.address().port;
      for (const h of [HOST, 'localhost']) { ALLOWED_HOSTS.add(`${h}:${real}`); ALLOWED_ORIGINS.add(`http://${h}:${real}`); }
      resolve(real);
    });
  });
}

// Modo navegador: `npm run web` (o `node server.js`).
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = await startServer(Number(process.env.PORT) || 4317);
  console.log(`Agent Map listo en http://localhost:${port}`);
  const shutdown = () => killAllTerms().then(() => process.exit(0));
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}
