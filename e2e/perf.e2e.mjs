// E2E de rendimiento (E0.2.c A3): mide en Electron, en desarrollo o empaquetado (AGENT_MAP_EXE), el escaneo en
// frío y los siguientes, un escaneo con mucho JSONL nuevo, una ráfaga de salida de terminal, los bloqueos del
// event loop del proceso principal, la memoria, y que el búfer de la terminal se recupere idéntico al reconectar.
//
// Cómo se mide (todo desde fuera, sin código de prueba dentro de la app):
// - Escaneo: duración de GET /api/tree vista por la página (Resource Timing / performance.now()).
// - Bloqueos: una "sonda" en la página pide sin parar un archivo estático chico mientras corre la operación; el
//   atraso máximo de esas respuestas, menos la mediana sin carga, acota el bloqueo continuo más largo del proceso
//   principal (incluye ruido de red local y del renderer: es una cota superior). Además se leen los avisos del
//   monitor de bloqueos (> 50 ms) del log de esta ejecución, con su actividad (terminal, ventana, GC, memoria).
// - Memoria: working set del proceso principal según Windows (Get-Process), y la del log cuando hay avisos.
// - Terminal: un `claude` falso (claude.cmd en una carpeta temporal, primero en PATH) que escribe una ráfaga,
//   repite lo que recibe y termina con "salir". Nunca se abre el claude real ni se retoma una sesión.
//
// Datos: JSONL sintético (AGENT_MAP_PERF_MB, 100 MB por defecto). AGENT_MAP_PERF_REAL=1 escanea tu ~/.claude real
// solo en lectura (no escribe nada ahí y no muestra contenido: solo tiempos y totales).
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { launch, makeFixture, reporter, sleep, tempRoot, userLine, assistantLine } from './lib.mjs';

const REAL = process.env.AGENT_MAP_PERF_REAL === '1';
const MB = Math.max(10, Number(process.env.AGENT_MAP_PERF_MB) || 100);
const MAX_BUFFER = 400_000;
const r = reporter(`Rendimiento ${REAL ? '(datos reales, solo lectura)' : `(${MB} MB sintéticos)`}`);
const { root, cleanup } = tempRoot('perf');
const am = path.join(root, 'agent-map');
const LOG = path.join(am, 'agent-map.log');
const info = (k, v) => console.log(`     ${k}: ${v}`);

// ---- datos sintéticos: varios proyectos, sesiones grandes y algunas líneas de 1,5 MB ----
function makeBigFixture() {
  const fx = makeFixture(root);
  const filler = 'Texto sintético de prueba para medir el escaneo. '.repeat(40);
  const block = (n, cwd) => {
    let s = '';
    for (let i = 0; i < n; i++) s += userLine(`pedido ${i} ${filler}`, cwd) + assistantLine(`respuesta ${i} ${filler}`, `msg_${n}_${i}`);
    return s;
  };
  const chunk = block(250, 'D:\\Proyectos\\perf'); // ~1 MB
  const long = assistantLine('L'.repeat(1_500_000), 'msg_largo');
  let written = 0, files = 0;
  for (let p = 0; written < MB * 1048576; p++) {
    const dir = path.join(fx.claude, 'projects', 'D--Proyectos-perf-' + p);
    fs.mkdirSync(dir, { recursive: true });
    for (let s = 0; s < 5 && written < MB * 1048576; s++) {
      const id = `${String(p).padStart(8, '0')}-0000-4000-8000-${String(s).padStart(12, '0')}`;
      const fd = fs.openSync(path.join(dir, id + '.jsonl'), 'w');
      fs.writeSync(fd, userLine('Inicio de la sesión sintética', 'D:\\Proyectos\\perf-' + p));
      const size = (s === 0 ? 25 : 4) * 1048576; // una sesión grande por proyecto
      for (let w = 0; w < size && written < MB * 1048576; w += chunk.length) { fs.writeSync(fd, chunk); written += chunk.length; }
      if (s === 0) { fs.writeSync(fd, long); written += long.length; }
      fs.closeSync(fd); files++;
    }
  }
  return { fx, files, written };
}

// ---- claude falso para la terminal ----
function makeFakeClaude() {
  const bin = path.join(root, 'bin');
  fs.mkdirSync(bin, { recursive: true });
  fs.writeFileSync(path.join(bin, 'burst.mjs'), `
import readline from 'node:readline';
process.stdout.write('AGENTMAP-FAKE-CLAUDE\\r\\n');
const line = 'x'.repeat(100);
for (let i = 0; i < 2000; i++) {
  let s = ''; for (let j = 0; j < 40; j++) s += i + ':' + j + ' ' + line + ' ñ😀\\r\\n';
  process.stdout.write(s);
}
process.stdout.write('FIN-RAFAGA\\r\\n');
const rl = readline.createInterface({ input: process.stdin });
rl.on('line', l => { if (l.trim() === 'salir') process.exit(0); process.stdout.write('ECO:' + l.trim() + '\\r\\n'); });
`);
  fs.writeFileSync(path.join(bin, 'claude.cmd'), `@echo off\r\n"${process.execPath}" "%~dp0burst.mjs"\r\n`);
  return bin;
}

function workingSetMB(pid) {
  try {
    const out = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', `(Get-Process -Id ${pid | 0}).WorkingSet64`], { encoding: 'utf8', windowsHide: true });
    return Math.round(Number(out.trim()) / 1048576);
  } catch { return null; }
}
const lagLines = () => { try { return fs.readFileSync(LOG, 'utf8').split('\n').filter(l => l.includes('event loop bloqueado')); } catch { return []; } };

// En la página: corre `op` mientras una sonda mide el atraso de respuestas a un archivo estático.
const PROBE = `window.__probe = async (op, warm = 30) => {
  const one = async () => { const t = performance.now(); await (await fetch('/events.js?p=' + Math.random(), { cache: 'no-store' })).text(); return performance.now() - t; };
  const base = []; for (let i = 0; i < warm; i++) base.push(await one());
  base.sort((a, b) => a - b);
  let done = false; const lat = [];
  const loop = (async () => { while (!done) lat.push(await one()); })();
  const t = performance.now(); const res = await op(); const ms = performance.now() - t;
  done = true; await loop;
  return { ms, res, median: base[base.length >> 1], max: Math.max(0, ...lat), n: lat.length };
}; true`;

let a;
try {
  let env = { AGENT_MAP_USAGE_FILE: path.join(am, 'usage.json') };
  let big = null;
  if (!REAL) {
    const t = performance.now();
    big = makeBigFixture();
    env.CLAUDE_CONFIG_DIR = big.fx.claude;
    info('datos', `${big.files + 3} archivos JSONL, ${Math.round(big.written / 1048576)} MB (generados en ${Math.round(performance.now() - t)} ms)`);
  }
  const bin = makeFakeClaude();
  const pathKey = Object.keys(process.env).find(k => k.toUpperCase() === 'PATH') || 'PATH';
  env[pathKey] = bin + path.delimiter + process.env[pathKey];

  const t0 = performance.now();
  a = await launch({ profile: path.join(root, 'perfil'), env });
  info('arranque hasta árbol visible', Math.round(performance.now() - t0) + ' ms');
  await a.ev(PROBE);

  // 1. Escaneo en frío: lo hace la página al abrir. Se toma la primera petición de /api/tree.
  // La ventana puede verse antes de que termine (las secciones se dibujan vacías): se espera esa primera respuesta.
  const entries = JSON.parse(await a.ev(`(async () => { const t = performance.now(); const get = () => performance.getEntriesByType('resource').map(e => [new URL(e.name).pathname, Math.round(e.duration)]);
    while (!get().some(([p]) => p === '/api/tree') && performance.now() - t < 28000) await new Promise(r => setTimeout(r, 50)); return JSON.stringify(get()); })()`));
  const cold = entries.filter(([p]) => p === '/api/tree').map(([, d]) => d);
  if (!cold.length) info('peticiones vistas', entries.map(e => e.join(' ')).join(', '));
  info('escaneo en frío (1.ª GET /api/tree)', cold[0] + ' ms');
  const memCold = workingSetMB(a.pid);
  info('memoria del proceso principal tras el frío', memCold + ' MB');
  r.check('escaneo en frío medido', cold.length >= 1 && cold[0] > 0, cold.join(', ') + ' ms');

  // 2. Escaneos siguientes y estructura de /api/tree.
  const warm = JSON.parse(await a.ev(`(async () => { const out = []; let j;
    for (let i = 0; i < 5; i++) { const t = performance.now(); j = await (await fetch('/api/tree')).json(); out.push(Math.round(performance.now() - t)); }
    const p = j.projects[0], s = p?.sessions[0];
    return JSON.stringify({ out, top: Object.keys(j).sort(), proj: p && Object.keys(p).sort(), sess: s && Object.keys(s).sort(), np: j.projects.length, ns: j.projects.reduce((n, p) => n + p.sessions.length, 0) }); })()`));
  info('escaneos siguientes', warm.out.join(', ') + ' ms');
  r.check('/api/tree: misma forma de respuesta ({ open, projects, repos })', JSON.stringify(warm.top) === '["open","projects","repos"]', warm.top.join(','));
  if (!REAL) r.check('/api/tree: todas las sesiones de los datos', warm.ns === big.files + 3, `${warm.np} proyectos, ${warm.ns} sesiones`);
  else info('árbol real', `${warm.np} proyectos, ${warm.ns} sesiones`);
  info('campos de proyecto', warm.proj?.join(','));
  info('campos de sesión', warm.sess?.join(','));
  r.check('escaneos siguientes rápidos (< 500 ms cada uno)', warm.out.every(x => x < 500), warm.out.join(', ') + ' ms');

  // 3. Escaneo con mucho JSONL nuevo (equivale a uno en frío de ese tamaño), con la sonda de bloqueos.
  if (!REAL) {
    const add = Math.min(50, MB / 2);
    const extra = (userLine('nuevo', 'D:\\Proyectos\\perf') + assistantLine('nuevo '.repeat(300), 'msg_n')).repeat(Math.ceil(add * 1048576 / 2400));
    const dirs = fs.readdirSync(path.join(big.fx.claude, 'projects')).filter(d => d.startsWith('D--Proyectos-perf-'));
    const per = Math.ceil(extra.length / dirs.length);
    for (const [i, d] of dirs.entries()) {
      const f = path.join(big.fx.claude, 'projects', d, `${String(i).padStart(8, '0')}-0000-4000-8000-000000000000.jsonl`);
      fs.appendFileSync(f, extra.slice(0, per).replace(/[^\n]*$/, ''));
    }
    const s = JSON.parse(await a.ev(`__probe(async () => (await fetch('/api/tree')).status).then(x => JSON.stringify(x))`));
    info(`escaneo con ~${add} MB nuevos`, `${Math.round(s.ms)} ms; sonda: mediana ${s.median.toFixed(1)} ms, peor ${s.max.toFixed(1)} ms en ${s.n} respuestas`);
    r.check('escaneo grande sin bloqueos largos del proceso principal (peor respuesta de la sonda < 100 ms)', s.res === 200 && s.max < 100, `peor ${s.max.toFixed(1)} ms`);
  }

  // 4. Terminal: ráfaga, eco, cambio de tamaño, reconexión con el búfer idéntico, y fin del proceso.
  const cwd = path.join(root, 'trabajo'); fs.mkdirSync(cwd);
  await a.ev(`(() => { window.__t = { all: '', n: 0, hello: null, closed: false };
    const ws = new WebSocket('ws://' + location.host + '/pty?cols=120&rows=30&newIn=' + encodeURIComponent(${JSON.stringify(cwd)}));
    window.__ws = ws;
    ws.onmessage = e => { if (!__t.hello) { __t.hello = JSON.parse(e.data); return; } __t.all += e.data; __t.n++; __t.last = performance.now(); };
    ws.onclose = e => { __t.closed = e.code; };
    return true; })()`);
  const burst = JSON.parse(await a.ev(`__probe(async () => {
    const t = performance.now();
    while (!__t.all.includes('FIN-RAFAGA') && performance.now() - t < 60000 && __t.closed === false) await new Promise(r => setTimeout(r, 20));
    return { ok: __t.all.includes('FIN-RAFAGA'), fake: __t.all.includes('AGENTMAP-FAKE-CLAUDE'), n: __t.n, chars: __t.all.length };
  }, 10).then(x => JSON.stringify(x))`));
  if (!burst.res.fake) { await a.ev(`__ws.send(JSON.stringify({ t: 'kill' })), true`).catch(() => {}); throw new Error('la terminal no abrió el claude falso'); }
  info('ráfaga de terminal', `${burst.res.n} mensajes, ${Math.round(burst.res.chars / 1024)} K caracteres en ${Math.round(burst.ms)} ms; sonda: mediana ${burst.median.toFixed(1)} ms, peor ${burst.max.toFixed(1)} ms`);
  r.check('la ráfaga llega completa a la página', burst.res.ok, `${burst.res.n} mensajes`);
  r.check('ráfaga sin bloqueos largos del proceso principal (peor respuesta de la sonda < 100 ms)', burst.max < 100, `peor ${burst.max.toFixed(1)} ms`);
  info('memoria del proceso principal tras la ráfaga', workingSetMB(a.pid) + ' MB');

  // Esperar a que la salida se calme y reconectar con la misma clave: debe llegar exactamente lo último que se vio.
  await a.ev(`(async () => { while (performance.now() - __t.last < 1000) await new Promise(r => setTimeout(r, 100)); return true; })()`);
  const rec = JSON.parse(await a.ev(`new Promise(res => {
    const msgs = []; const ws = new WebSocket('ws://' + location.host + '/pty?key=' + encodeURIComponent(__t.hello.key));
    ws.onmessage = e => { msgs.push(e.data); if (msgs.length === 2) { ws.close(); const buf = msgs[1]; const want = __t.all.slice(-${MAX_BUFFER});
      res(JSON.stringify({ hello: JSON.parse(msgs[0]).key === __t.hello.key, len: buf.length, total: __t.all.length, same: buf === want })); } };
    setTimeout(() => res(JSON.stringify({ timeout: true, n: msgs.length })), 10000);
  })`));
  r.check('reconexión: el búfer es idéntico a los últimos 400 000 caracteres recibidos', rec.hello && rec.same && rec.len === Math.min(MAX_BUFFER, rec.total), JSON.stringify(rec));

  await a.ev(`__ws.send(JSON.stringify({ t: 'resize', cols: 100, rows: 40 })), __ws.send(JSON.stringify({ t: 'in', d: 'hola agent map\\r' })), true`);
  const eco = await a.ev(`(async () => { const t = performance.now(); while (!__t.all.includes('ECO:hola agent map') && performance.now() - t < 10000) await new Promise(r => setTimeout(r, 50)); return __t.all.includes('ECO:hola agent map'); })()`);
  r.check('terminal: cambiar el tamaño y escribir siguen funcionando (eco)', eco);
  await a.ev(`__ws.send(JSON.stringify({ t: 'in', d: 'salir\\r' })), true`);
  const ended = await a.ev(`(async () => { const t = performance.now(); while (!__t.all.includes('[Proceso terminado') && performance.now() - t < 10000) await new Promise(r => setTimeout(r, 50)); return __t.all.includes('[Proceso terminado, código 0'); })()`);
  r.check('terminal: al terminar el proceso llega el aviso de fin', ended);
  await a.ev(`__ws.close(), true`);

  // 5. Bloqueo real y conocido: una sola línea JSONL de 80 MB (JSON.parse no se puede trocear). El monitor debe
  //    registrarlo en el log con su actividad. Es el caso límite del informe E0.2.c (líneas de más de ~30 MB).
  //    El monitor solo ve la parte del bloqueo que pasa del tick siguiente (hasta 50 ms menos que el real) y agrupa
  //    los avisos de 10 s: se sale primero de esa ventana y se repite con otra línea si quedó bajo el umbral.
  const GIANT_RE = /bloqueado \d+ ms \(proceso browser, pid \d+, en curso: GET \/api\/tree.*\) — terminal .*; gc .*; memoria rss \d+ MB, heap \d+\/\d+ MB, externa \d+ MB$/;
  if (!REAL) {
    const lastAt = () => { const l = lagLines().at(-1); return l ? Date.parse(l.split(' ')[0]) : 0; };
    const wait = 10_500 - (Date.now() - lastAt());
    if (wait > 0) await sleep(wait);
    const before = lagLines().length;
    const dir = fs.readdirSync(path.join(big.fx.claude, 'projects')).find(d => d.startsWith('D--Proyectos-perf-'));
    let seen = false, tries = 0;
    while (!seen && tries < 4) {
      tries++;
      fs.writeFileSync(path.join(big.fx.claude, 'projects', dir, `00000000-0000-4000-8000-00000000000${tries}.jsonl`),
        userLine('sesión con una línea enorme', 'D:\\Proyectos\\perf') + assistantLine('G'.repeat(80 * 1048576), 'msg_gigante'));
      const g = JSON.parse(await a.ev(`__probe(async () => (await fetch('/api/tree')).status, 10).then(x => JSON.stringify(x))`));
      info(`escaneo con una línea de 80 MB (intento ${tries})`, `${Math.round(g.ms)} ms; sonda: peor ${g.max.toFixed(1)} ms; memoria del proceso principal ${workingSetMB(a.pid)} MB`);
      await sleep(400); // el aviso con actividad se escribe un tick después
      seen = lagLines().slice(before).some(l => GIANT_RE.test(l));
    }
    r.check('el monitor registra el bloqueo de una línea de 80 MB con terminal, GC y memoria', seen, `${tries} intento(s)`);
  }

  // 6. Avisos del monitor de bloqueos en esta ejecución.
  await sleep(400);
  const lags = lagLines();
  info('avisos de bloqueo (> 50 ms) en el log', lags.length ? '' : 'ninguno');
  for (const l of lags) console.log('       ' + l.replace(/^\S+ /, '').replace(/pid \d+/, 'pid …'));
  r.check('los avisos (si los hay) traen la actividad del tramo y nada de contenido',
    lags.every(l => / — terminal (0|\d+ trozos\/\d+ KB)(; .*)?$/.test(l) && !/hola|ECO|FAKE|sintétic|RAFAGA/.test(l)), lags.length + ' avisos');
} catch (err) { r.fail(err); }
if (a?.close) await a.close();
await sleep(1500); // Electron puede tardar en soltar los archivos de la carpeta temporal (~200 MB)
cleanup();
process.exit(r.finish());
