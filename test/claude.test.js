// Detección de Claude Code: el comando en el PATH, la carpeta de datos y los errores claros al abrir una terminal.
// Nunca se ejecuta el claude real: cada caso falla antes de lanzar nada. Carpetas temporales fijadas ANTES de importar.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import WebSocket from 'ws';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentmap-claude-'));
after(() => fs.rmSync(dir, { recursive: true, force: true }));
const claudeDir = path.join(dir, 'claude');
process.env.CLAUDE_CONFIG_DIR = claudeDir;
process.env.AGENT_MAP_USAGE_FILE = path.join(dir, 'am', 'usage.json');
const { findOnPath, claudeStatus } = await import('../lib/claude.js');
const { startServer } = await import('../server.js');

const PATH_KEY = Object.keys(process.env).find(k => k.toUpperCase() === 'PATH') || 'PATH';
function withPath(value, fn) {
  const old = process.env[PATH_KEY];
  process.env[PATH_KEY] = value;
  return Promise.resolve().then(fn).finally(() => { process.env[PATH_KEY] = old; });
}

test('findOnPath: busca en orden por el PATH y las extensiones de PATHEXT, sin ejecutar nada', () => {
  const a = path.join(dir, 'bin a'), b = path.join(dir, 'bin-b'), empty = path.join(dir, 'vacia');
  for (const d of [a, b, empty]) fs.mkdirSync(d, { recursive: true });
  fs.writeFileSync(path.join(b, 'claude.cmd'), '@echo off');
  fs.writeFileSync(path.join(a, 'claude.exe'), '');
  fs.mkdirSync(path.join(empty, 'claude.cmd')); // una carpeta con ese nombre no es el comando
  const env = { Path: [empty, `"${a}"`, b].join(';'), PATHEXT: '.COM;.EXE;.BAT;.CMD' }; // "Path" como en Windows, carpeta entre comillas
  assert.equal(findOnPath('claude', env, 'win32'), path.join(a, 'claude.exe')); // la primera carpeta que lo tiene
  assert.equal(findOnPath('claude', { ...env, PATHEXT: '.CMD' }, 'win32'), path.join(b, 'claude.cmd'));
  assert.equal(findOnPath('claude', { PATH: empty }, 'win32'), null);
  assert.equal(findOnPath('claude', {}, 'win32'), null); // sin PATH
  assert.equal(findOnPath('claude', { PATH: b }, 'win32'), path.join(b, 'claude.cmd')); // PATHEXT por defecto
  if (process.platform !== 'win32') { // separador ":" (en Windows las rutas llevan "C:")
    fs.writeFileSync(path.join(b, 'claude'), '');
    assert.equal(findOnPath('claude', { PATH: [empty, b].join(':') }, 'linux'), path.join(b, 'claude')); // sin extensiones
  }
});

test('claudeStatus: carpeta ausente, sin sesiones todavía, con sesiones y error de lectura', async () => {
  const st = await claudeStatus();
  assert.deepEqual(st.data, { state: 'missing', dir: claudeDir, code: null });
  assert.equal(typeof st.cli.found, 'boolean');
  fs.mkdirSync(claudeDir);
  assert.equal((await claudeStatus()).data.state, 'ok'); // instalado, aún sin projects/
  fs.writeFileSync(path.join(claudeDir, 'projects'), 'no es una carpeta'); // ilegible como carpeta
  assert.deepEqual((await claudeStatus()).data, { state: 'error', dir: claudeDir, code: 'ENOTDIR' });
  fs.rmSync(path.join(claudeDir, 'projects'));
  fs.mkdirSync(path.join(claudeDir, 'projects'));
  assert.equal((await claudeStatus()).data.state, 'ok');
  await withPath('', async () => assert.deepEqual((await claudeStatus()).cli, { found: false, path: null }));
});

test('servidor: /api/claude y errores claros al abrir una terminal, antes de lanzar claude', async () => {
  const id = '11111111-2222-4333-8444-555555555555';
  const gone = path.join(dir, 'carpeta-borrada');
  const pdir = path.join(claudeDir, 'projects', 'C--carpeta-borrada');
  fs.mkdirSync(pdir, { recursive: true });
  fs.writeFileSync(path.join(pdir, id + '.jsonl'), JSON.stringify({ type: 'user', timestamp: '2026-01-01T10:00:00Z', cwd: gone, message: { role: 'user', content: 'hola' } }) + '\n');
  const port = await startServer(0);
  const base = `http://127.0.0.1:${port}`;
  const st = await (await fetch(base + '/api/claude')).json();
  assert.equal(st.data.state, 'ok');
  assert.equal(st.data.dir, claudeDir);
  assert.deepEqual(Object.keys(st.cli).sort(), ['found', 'path']);
  assert.deepEqual(Object.keys(await (await fetch(base + '/api/tree')).json()).sort(), ['open', 'projects', 'repos']); // misma forma de siempre

  const closeOf = query => new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/?${query}`, { origin: base });
    ws.on('message', () => reject(new Error('no debía abrirse una terminal')));
    ws.on('close', (code, reason) => resolve({ code, reason: reason.toString() }));
    ws.on('error', reject);
  });
  // Sesión cuya carpeta ya no existe: se dice eso (antes llegaba un error de node-pty o de cmd.exe).
  assert.deepEqual(await closeOf(`session=${id}&cols=80&rows=24`), { code: 4006, reason: 'La carpeta de esta sesión ya no existe' });
  // Sin claude en el PATH: código propio, para que la página explique cómo resolverlo. Nada queda abierto.
  const here = path.join(dir, 'proyecto'); fs.mkdirSync(here);
  await withPath(path.join(dir, 'vacia'), async () => {
    assert.deepEqual(await closeOf(`newIn=${encodeURIComponent(here)}&cols=80&rows=24`), { code: 4005, reason: 'Claude Code no está instalado o no está en el PATH' });
  });
  assert.deepEqual((await (await fetch(base + '/api/tree')).json()).open, []);
});
