// En vivo: GET /api/events avisa cuando una sesión de Claude cambia de estado, se abre o se cierra.
// Carpeta de Claude temporal: CLAUDE_CONFIG_DIR se fija ANTES de importar (cada archivo de test corre en su proceso).
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentmap-live-'));
after(() => fs.rmSync(dir, { recursive: true, force: true }));
process.env.CLAUDE_CONFIG_DIR = path.join(dir, 'claude');
process.env.AGENT_MAP_USAGE_FILE = path.join(dir, 'am', 'usage.json');
const sessions = path.join(dir, 'claude', 'sessions');
fs.mkdirSync(sessions, { recursive: true });
const { startServer, activeRequests, LIVE_POLL_MS } = await import('../server.js');
const port = await startServer(0);

const ID = '11111111-2222-4333-8444-555555555555';
// pid del propio test: un proceso vivo de verdad (liveSessions descarta los pid muertos).
const writeSession = (status, at) => fs.writeFileSync(path.join(sessions, `${process.pid}.json`),
  JSON.stringify({ pid: process.pid, sessionId: ID, cwd: dir, status, statusUpdatedAt: at, updatedAt: at }));

/** Abre /api/events y junta los eventos "live" que llegan. */
async function connect() {
  const ctrl = new AbortController();
  const res = await fetch(`http://127.0.0.1:${port}/api/events`, { signal: ctrl.signal });
  const events = [];
  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  let buf = '';
  (async () => {
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) return;
        buf += value;
        let i;
        while ((i = buf.indexOf('\n\n')) >= 0) {
          const block = buf.slice(0, i); buf = buf.slice(i + 2);
          if (/^event: live$/m.test(block)) events.push(JSON.parse(block.match(/^data: (.*)$/m)[1]));
        }
      }
    } catch { /* cerrado por el test */ }
  })();
  const waitFor = async (n, ms = LIVE_POLL_MS * 4) => {
    const end = Date.now() + ms;
    while (events.length < n && Date.now() < end) await new Promise(r => setTimeout(r, 20));
    return events.length >= n;
  };
  return { res, events, waitFor, close: () => ctrl.abort() };
}

test('/api/events: SSE, estado actual al conectar y un aviso por cada cambio de estado', async () => {
  writeSession('busy', 1000);
  const c = await connect();
  try {
    assert.equal(c.res.status, 200);
    assert.match(c.res.headers.get('content-type'), /^text\/event-stream/);
    assert.ok(await c.waitFor(1), 'estado al conectar');
    assert.match(c.events[0], new RegExp(`^${ID}:${process.pid}:busy:1000$`));

    writeSession('idle', 2000); // Claude terminó
    assert.ok(await c.waitFor(2), 'aviso de busy -> idle');
    assert.match(c.events[1], /:idle:2000$/);

    writeSession('waiting', 3000); // espera permiso
    assert.ok(await c.waitFor(3), 'aviso de idle -> waiting');
    assert.match(c.events[2], /:waiting:3000$/);

    fs.rmSync(path.join(sessions, `${process.pid}.json`)); // Claude se cerró
    assert.ok(await c.waitFor(4), 'aviso de sesión cerrada');
    assert.equal(c.events[3], '');
  } finally { c.close(); }
});

test('/api/events: sin cambios no manda nada; un cambio rápido de ida y vuelta igual se avisa', async () => {
  writeSession('busy', 5000);
  const c = await connect();
  try {
    assert.ok(await c.waitFor(1));
    await new Promise(r => setTimeout(r, LIVE_POLL_MS * 2.5));
    assert.equal(c.events.length, 1, 'nada nuevo sin cambios');
    // busy -> idle -> busy entre dos lecturas: el estado final es igual, pero statusUpdatedAt cambió.
    writeSession('busy', 6000);
    assert.ok(await c.waitFor(2), 'la transición intermedia no se pierde');
  } finally { c.close(); }
});

test('/api/events: varias páginas reciben el mismo aviso; la conexión no cuenta como petición en curso', async () => {
  writeSession('idle', 7000);
  const a = await connect(), b = await connect();
  try {
    assert.ok(await a.waitFor(1) && await b.waitFor(1));
    assert.ok(!activeRequests().includes('/api/events'), activeRequests());
    writeSession('busy', 8000);
    assert.ok(await a.waitFor(2) && await b.waitFor(2));
    assert.equal(a.events[1], b.events[1]);
  } finally { a.close(); b.close(); }
});

test('/api/events: con otro Host se rechaza (DNS rebinding), igual que el resto de la API', async () => {
  const http = await import('node:http');
  const code = await new Promise((resolve, reject) => {
    http.get({ host: '127.0.0.1', port, path: '/api/events', headers: { host: 'evil.example:80' } }, r => { r.resume(); resolve(r.statusCode); }).on('error', reject);
  });
  assert.equal(code, 403);
});
