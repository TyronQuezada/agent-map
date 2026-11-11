// Instrumentación E0.2.a: bloqueos del event loop, errores HTTP en el log y nada de datos privados.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import http from 'node:http';
import { startLagMonitor, createThrottle, sanitize, createActivity, formatActivity } from '../lib/diag.js';

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

test('event loop: con el intervalo por defecto un bloqueo de 150 ms siempre se detecta (antes, con 250 ms, podía perderse)', async () => {
  for (let i = 0; i < 5; i++) {
    const logs = [];
    const stop = startLagMonitor({ log: m => logs.push(m) });
    await sleep(60 + i * 9); // el bloqueo empieza en distintos momentos respecto del tick
    busy(150);
    await sleep(120);
    stop();
    assert.equal(logs.length, 1, `intento ${i}: ${logs.join(' | ')}`);
    assert.ok(Number(logs[0].match(/bloqueado (\d+)/)[1]) >= 85, logs[0]);
  }
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

// ---- E0.2.c A1: contexto del bloqueo ----
const LINE = /^event loop bloqueado (\d+) ms \(proceso node, pid \d+(, en curso: [^)]*)?\) — (.*)$/;

test('actividad: el aviso dice la salida de terminal, ventana, GC y memoria del tramo bloqueado', async () => {
  const logs = [];
  const act = createActivity();
  const stop = startLagMonitor({ log: m => logs.push(m), intervalMs: 50, context: () => 'GET /api/tree', activity: act });
  await sleep(120);
  act.add('terminal', 4096); act.add('terminal', 1000); act.add('ventana:resize'); act.add('ventana:resize'); act.add('ventana:creada');
  busy(200);
  await sleep(200); // el aviso se escribe un tick después
  stop();
  assert.equal(logs.length, 1, logs.join('\n'));
  const m = logs[0].match(LINE);
  assert.ok(m, logs[0]);
  assert.ok(Number(m[1]) >= 120);
  assert.equal(m[2], ', en curso: GET /api/tree');
  assert.match(m[3], /^terminal 2 trozos\/5 KB; ventana resize×2, creada×1; gc (0|\d+× \d+ ms \(máx \d+\)); memoria rss \d+ MB, heap \d+\/\d+ MB, externa \d+ MB$/);
});

test('actividad: solo cuenta lo del tramo del bloqueo, no lo de antes', async () => {
  const logs = [];
  const act = createActivity();
  const stop = startLagMonitor({ log: m => logs.push(m), intervalMs: 50, activity: act });
  for (let i = 0; i < 50; i++) act.add('terminal', 100); // salida vieja: tramos sin bloqueo, se descarta
  await sleep(150);
  busy(150);
  await sleep(150);
  stop();
  assert.equal(logs.length, 1);
  assert.match(logs[0], / — terminal 0; /);
});

test('actividad: un evento de ventana reciente fuera del tramo se informa con su antigüedad', async () => {
  const logs = [];
  const act = createActivity();
  const stop = startLagMonitor({ log: m => logs.push(m), intervalMs: 50, activity: act });
  act.add('ventana:maximize');
  await sleep(200);
  busy(150);
  await sleep(150);
  stop();
  assert.match(logs[0], /; ventana: última maximize hace \d+ ms;/);
});

test('actividad: el GC que ocurre durante el bloqueo aparece en el aviso', async () => {
  { // bloqueo que genera mucha basura: fuerza GC dentro del tramo
    const logs = [];
    const act = createActivity();
    const stop = startLagMonitor({ log: m => logs.push(m), intervalMs: 50, activity: act });
    await sleep(120);
    const end = performance.now() + 250;
    let keep = [];
    while (performance.now() < end) { keep.push(new Array(5000).fill({ x: Math.random() })); if (keep.length > 200) keep = []; }
    await sleep(200);
    stop();
    assert.equal(logs.length, 1);
    assert.match(logs[0], /; gc [1-9]\d*× \d+ ms \(máx \d+\);/, logs[0]);
  }
});

test('actividad: sin bloqueos no escribe nada aunque haya mucha salida de terminal', async () => {
  const logs = [];
  const act = createActivity();
  const stop = startLagMonitor({ log: m => logs.push(m), intervalMs: 50, activity: act });
  for (let i = 0; i < 10; i++) { for (let j = 0; j < 1000; j++) act.add('terminal', 4096); await sleep(30); }
  stop();
  assert.deepEqual(logs, []);
});

test('actividad: los avisos agrupados no se multiplican (uno por ventana de silencio)', async () => {
  const logs = [];
  const act = createActivity();
  const stop = startLagMonitor({ log: m => logs.push(m), intervalMs: 50, quietMs: 60_000, activity: act });
  for (let i = 0; i < 4; i++) { await sleep(80); act.add('terminal', 10); busy(120); }
  await sleep(120);
  stop();
  assert.equal(logs.length, 1);
});

test('formatActivity: formato estable y sin datos de contenido', () => {
  const act = new Map([['terminal', { n: 37, bytes: 154_624 }], ['ventana:resize', { n: 3, bytes: 0 }], ['ventana:maximize', { n: 1, bytes: 0 }]]);
  const mem = { rss: 210 * 1048576, heapUsed: 80 * 1048576, heapTotal: 120 * 1048576, external: 6 * 1048576 };
  assert.equal(formatActivity({ act, gc: { n: 2, ms: 41.4, max: 30.2 }, mem }),
    'terminal 37 trozos/151 KB; ventana resize×3, maximize×1; gc 2× 41 ms (máx 30); memoria rss 210 MB, heap 80/120 MB, externa 6 MB');
  assert.equal(formatActivity({}), 'terminal 0');
  assert.equal(formatActivity({ gc: { n: 0, ms: 0, max: 0 }, lastWindow: { name: 'ventana:creada', ago: 812.4 } }),
    'terminal 0; ventana: última creada hace 812 ms; gc 0');
});

test('createActivity: take() entrega y vacía; lastOf() respeta el prefijo y la antigüedad', async () => {
  const a = createActivity();
  a.add('terminal', 10); a.add('terminal', 5); a.add('ventana:resize');
  const t = a.take();
  assert.deepEqual(Object.fromEntries(t), { terminal: { n: 2, bytes: 15 }, 'ventana:resize': { n: 1, bytes: 0 } });
  assert.equal(a.take().size, 0);
  const now = performance.now();
  assert.equal(a.lastOf('ventana:', now, 5000).name, 'ventana:resize');
  assert.equal(a.lastOf('ventana:', now + 6000, 5000), null);
  assert.equal(a.lastOf('otro:', now, 5000), null);
});

test('servidor: la salida de una terminal se cuenta en la actividad compartida (solo cantidad y bytes)', async () => {
  const src = (await import('node:fs')).readFileSync(new URL('../server.js', import.meta.url), 'utf8');
  assert.match(src, /activity\.add\('terminal', Buffer\.byteLength\(d\)\)/);
  assert.ok(!/activity\.add\([^)]*\bd\b[^)]*\)/.test(src.replace("activity.add('terminal', Buffer.byteLength(d))", '')), 'nunca se pasa el contenido');
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
