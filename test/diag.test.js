// Instrumentación E0.2.a: bloqueos del event loop, errores HTTP en el log y nada de datos privados.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import http from 'node:http';
import { startLagMonitor, createThrottle, sanitize } from '../lib/diag.js';

const sleep = ms => new Promise(r => setTimeout(r, ms));
const busy = ms => { const end = performance.now() + ms; while (performance.now() < end); }; // bloqueo real del hilo

test('event loop: avisa un bloqueo de más de 50 ms con duración, proceso y contexto', async () => {
  const logs = [];
  const stop = startLagMonitor({ log: m => logs.push(m), intervalMs: 50, context: () => 'GET /api/tree' });
  await sleep(120);
  busy(250);
  await sleep(150);
  stop();
  assert.equal(logs.length, 1, logs.join('\n'));
  assert.match(logs[0], /^event loop bloqueado \d+ ms \(proceso node, pid \d+, en curso: GET \/api\/tree\)$/);
  assert.ok(Number(logs[0].match(/bloqueado (\d+)/)[1]) >= 150);
});

test('event loop: sin bloqueos no escribe nada (sin ruido)', async () => {
  const logs = [];
  const stop = startLagMonitor({ log: m => logs.push(m), intervalMs: 50 });
  await sleep(600);
  stop();
  assert.deepEqual(logs, []);
});

test('event loop: bloqueos seguidos se agrupan en vez de llenar el log', async () => {
  const logs = [];
  const stop = startLagMonitor({ log: m => logs.push(m), intervalMs: 50, quietMs: 60_000 });
  for (let i = 0; i < 4; i++) { await sleep(80); busy(120); }
  await sleep(80);
  stop();
  assert.equal(logs.length, 1); // el resto se cuenta y se informa en el próximo aviso
});

test('event loop: en pausa (equipo suspendido) no avisa; al reanudar vuelve a medir', async () => {
  const logs = [];
  const stop = startLagMonitor({ log: m => logs.push(m), intervalMs: 50, quietMs: 0 });
  await sleep(80);
  stop.pause();
  busy(200);
  await sleep(80);
  stop.resume();
  await sleep(80);
  assert.deepEqual(logs, []);
  busy(200);
  await sleep(80);
  stop();
  assert.equal(logs.length, 1);
});

test('avisos repetidos: una vez por minuto, con la cuenta de los que se omitieron', () => {
  const logs = [];
  const t = createThrottle(m => logs.push(m), 50);
  t('a', 'error A'); t('a', 'error A'); t('a', 'error A'); t('b', 'error B');
  assert.deepEqual(logs, ['error A', 'error B']);
  const until = Date.now() + 60; while (Date.now() < until);
  t('a', 'error A');
  assert.deepEqual(logs.at(-1), 'error A (+2 iguales en el último minuto)');
});

test('sanitize: sin la carpeta del usuario, en una línea y acotado', () => {
  const s = sanitize(`ENOENT: no such file, open '${os.homedir()}\\.claude\\x.jsonl'\n  at algo`);
  assert.ok(!s.includes(os.homedir()));
  assert.match(s, /'~\\\.claude\\x\.jsonl' at algo$/);
  assert.equal(sanitize('x'.repeat(500)).length, 201);
});

test('servidor: registra errores HTTP sin query, cuerpo ni cabeceras, y responde igual que antes', async () => {
  const { startServer, setLogger } = await import('../server.js');
  const logs = [];
  setLogger(m => logs.push(m));
  const port = await startServer(0);
  const base = `http://127.0.0.1:${port}`;
  const origin = base;

  // 404 de la API: se registra la ruta, nunca el id ni otros parámetros
  const r404 = await fetch(base + '/api/messages?id=11111111-2222-3333-4444-555555555555&token=SECRETO');
  assert.equal(r404.status, 404);
  assert.equal(await r404.text(), 'Sesión no encontrada');
  // 400 con datos privados en el cuerpo: el aviso no lleva el mensaje
  const r400 = await fetch(base + '/api/prefs', { method: 'POST', headers: { origin, 'content-type': 'application/json', cookie: 'sid=SECRETO', authorization: 'Bearer SECRETO' }, body: '{"theme":"conversación privada SECRETO"}' });
  assert.equal(r400.status, 400);
  assert.equal(await r400.text(), 'Tema desconocido');
  // 500 real: pedir una carpeta como si fuera un archivo
  const r500 = await fetch(base + '/about/');
  assert.equal(r500.status, 500);
  assert.equal(await r500.text(), 'Error');
  // 403 por Host ajeno
  const s403 = await new Promise(res => http.get({ host: '127.0.0.1', port, path: '/api/tree?x=SECRETO', headers: { host: 'evil.com' } }, r => { r.resume(); res(r.statusCode); }));
  assert.equal(s403, 403);
  // WebSocket desde un origen ajeno
  await new Promise(res => {
    const req = http.request({ host: '127.0.0.1', port, path: '/pty?newIn=C:%5C', headers: { origin: 'http://evil.com', connection: 'Upgrade', upgrade: 'websocket', 'sec-websocket-version': '13', 'sec-websocket-key': 'dGhlIHNhbXBsZSBub25jZQ==' } });
    req.on('error', () => res()); req.on('close', () => res()); req.end();
  });
  // un 404 de archivo estático no es un error de la app
  assert.equal((await fetch(base + '/no-existe.png')).status, 404);
  await sleep(50);

  const all = logs.join('\n');
  assert.match(all, /HTTP 404 GET \/api\/messages \(sin excepción\)/);
  assert.match(all, /HTTP 400 POST \/api\/prefs \(Error\)/);
  assert.match(all, /HTTP 500 GET \/about\/ \(Error EISDIR: EISDIR: illegal operation on a directory/);
  assert.match(all, /HTTP 403 GET \/api\/tree \(sin excepción\)/);
  assert.match(all, /WebSocket rechazado: origen no permitido \(http:\/\/evil\.com\)/);
  assert.ok(!/no-existe/.test(all));
  assert.ok(!/SECRETO|privada|token=|Bearer|sid=/.test(all), all);
  assert.ok(!all.includes(os.homedir()));
});
