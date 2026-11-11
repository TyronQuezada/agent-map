// E2E: puerto fijo 47317 (las preferencias de la página sobreviven al reinicio) y respaldo al azar si está ocupado,
// sin hablar nunca con lo que ocupe el puerto ni debilitar las comprobaciones de Host y Origin.
import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import path from 'node:path';
import { launch, makeFixture, reporter, sleep, tempRoot } from './lib.mjs';

const PREF = 47317;
const { root, cleanup } = tempRoot('port');
const fx = makeFixture(root);
const am = path.join(root, 'agent-map');
const env = { CLAUDE_CONFIG_DIR: fx.claude, AGENT_MAP_USAGE_FILE: path.join(am, 'usage.json') };
const P1 = path.join(root, 'perfil1'), P2 = path.join(root, 'perfil2');
const LOG = path.join(am, 'agent-map.log');
const r = reporter('Puerto fijo y respaldo');

const portFree = p => new Promise(res => { const s = net.createServer().once('error', () => res(false)).listen(p, '127.0.0.1', () => s.close(() => res(true))); });
const logText = () => { try { return fs.readFileSync(LOG, 'utf8'); } catch { return ''; } };
function raw(port, { host, origin, method = 'GET', pathname = '/api/usage', upgrade = false }) {
  return new Promise(res => {
    const headers = { host }; if (origin) headers.origin = origin;
    if (upgrade) Object.assign(headers, { connection: 'Upgrade', upgrade: 'websocket', 'sec-websocket-version': '13', 'sec-websocket-key': 'dGhlIHNhbXBsZSBub25jZQ==' });
    const req = http.request({ host: '127.0.0.1', port, method, path: pathname, headers }, x => { x.resume(); res(x.statusCode); });
    req.on('upgrade', () => res(101)); req.on('error', e => res('cerrado:' + e.code)); req.end();
  });
}
async function hostOrigin(port) {
  const other = port === PREF ? PREF + 1 : PREF;
  const got = {
    ok: await raw(port, { host: `127.0.0.1:${port}` }),
    hostAjeno: await raw(port, { host: 'evil.example' }),
    rebinding: await raw(port, { host: `evil.example:${port}` }),
    origenAjeno: await raw(port, { host: `127.0.0.1:${port}`, origin: 'http://evil.example', method: 'POST', pathname: '/api/prefs' }),
    origenOtroPuerto: await raw(port, { host: `127.0.0.1:${port}`, origin: `http://127.0.0.1:${other}`, method: 'POST', pathname: '/api/prefs' }),
    wsAjeno: await raw(port, { host: `127.0.0.1:${port}`, origin: 'http://evil.example', pathname: '/pty', upgrade: true }),
  };
  r.check(`Host y Origin se siguen rechazando en el puerto ${port}`, got.ok === 200 && got.hostAjeno === 403 && got.rebinding === 403
    && got.origenAjeno === 403 && got.origenOtroPuerto === 403 && String(got.wsAjeno).startsWith('cerrado'), JSON.stringify(got));
}
async function officeOrigin(a) {
  await a.ev(`window.open(location.origin + '/office.html?dir=' + encodeURIComponent('C:\\\\no-existe'), 'agentmap-office', 'width=960,height=760'), true`);
  let off;
  for (let i = 0; i < 50 && !off; i++) { off = (await a.targets())?.find(x => x.url.includes('/office.html')); if (!off) await sleep(100); }
  const blocked = await a.ev(`window.open('http://127.0.0.1:${a.port === PREF ? PREF + 1 : PREF}/office.html?dir=x', 'otra') === null`);
  r.check(`la oficina se abre en el origen real (${a.port}) y otro puerto queda bloqueado`, !!off && new URL(off.url).port === String(a.port) && blocked);
}

let a, b;
try {
  if (!(await portFree(PREF))) {
    console.log(`OMITIDA: el puerto ${PREF} ya está en uso en este equipo (¿Agent Map abierto?). Ciérralo y vuelve a correr.`);
    cleanup(); process.exit(0);
  }
  a = await launch({ profile: P1, env });
  r.check('el primer arranque usa el puerto preferido', a.port === PREF, a.url);
  const key = 'k' + Date.now();
  await a.ev(`localStorage.setItem('agentmap.e2e', '${key}'), true`);
  const code = await a.close();
  r.check('cierre completo libera el puerto', code === 0 && await portFree(PREF), 'exit=' + code);
  a = await launch({ profile: P1, env });
  r.check('al reabrir usa el mismo puerto y localStorage se conserva', a.port === PREF && (await a.ev(`localStorage.getItem('agentmap.e2e')`)) === key);
  await hostOrigin(PREF);
  await officeOrigin(a);
  const dup = await launch({ profile: P1, env, waitReady: false });
  r.check('mismo perfil: la segunda instancia sale y la primera sigue', dup.exited === 0 && (await a.ev('location.port')) === String(PREF), 'exit=' + dup.exited);
  b = await launch({ profile: P2, env });
  r.check('otro perfil a la vez: usa otro puerto y funciona', b.port !== PREF && (await b.ev(`fetch('/api/tree').then(x => x.status)`)) === 200, 'puerto=' + b.port);
  await b.close(); b = null;
  await a.close(); a = null;

  let foreignHits = 0;
  const foreign = http.createServer((req, res) => { foreignHits++; res.end('servicio ajeno'); });
  await new Promise(res => foreign.listen(PREF, '127.0.0.1', res));
  const before = logText().length;
  a = await launch({ profile: P1, env });
  const fb = logText().slice(before);
  r.check('puerto ocupado: usa otro, lo registra y nunca le habla al servicio ajeno',
    a.port !== PREF && /puerto 47317 no disponible \(EADDRINUSE\): se usa el \d+/.test(fb) && foreignHits === 0, `puerto=${a.port} visitas=${foreignHits}`);
  const works = await a.ev(`Promise.all(['/api/tree', '/api/usage'].map(u => fetch(u).then(x => x.status))).then(s => s.join(','))`);
  r.check('la app funciona en el puerto alternativo', works === '200,200', works);
  await hostOrigin(a.port);
  await officeOrigin(a);
  await a.close(); a = null;
  foreign.close();
  r.check('el servicio ajeno no recibió ninguna petición', foreignHits === 0);
} catch (err) { r.fail(err); }
if (b?.close) await b.close();
if (a?.close) await a.close();
await sleep(300);
cleanup();
process.exit(r.finish());
