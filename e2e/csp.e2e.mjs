// E2E: Content Security Policy. Con la política activa funcionan la terminal (xterm), los avisos, el sonido, el canal
// en vivo, la guía con imágenes y la ventana de la oficina, sin ningún recurso bloqueado. Y la política de verdad
// bloquea: un <script> en línea no corre (y en la oficina, tampoco un <style> en línea).
// Terminal con un `claude` falso (claude.cmd en una carpeta temporal, primero en PATH): nunca abre el claude real.
import fs from 'node:fs';
import path from 'node:path';
import { launch, makeFixture, makeWav, reporter, sleep, tempRoot } from './lib.mjs';

const { root, cleanup } = tempRoot('csp');
const fx = makeFixture(root);
const am = path.join(root, 'agent-map');
const bin = path.join(root, 'bin');
fs.mkdirSync(bin, { recursive: true });
fs.writeFileSync(path.join(bin, 'fake.mjs'), `process.stdout.write('\\x1b[1;32mAGENTMAP-CSP-OK\\x1b[0m colores y estilos de xterm\\r\\n');
setInterval(() => {}, 1000);`);
fs.writeFileSync(path.join(bin, 'claude.cmd'), `@echo off\r\n"${process.execPath}" "%~dp0fake.mjs"\r\n`);
makeWav(path.join(am, 'sounds', 'e2e-csp.wav'));
fs.writeFileSync(path.join(am, 'prefs.json'), JSON.stringify({ sounds: { volume: 0.2, message: { on: true, file: 'e2e-csp.wav' } } }));
const pathKey = Object.keys(process.env).find(k => k.toUpperCase() === 'PATH') || 'PATH';
const env = { CLAUDE_CONFIG_DIR: fx.claude, AGENT_MAP_USAGE_FILE: path.join(am, 'usage.json'), [pathKey]: bin + path.delimiter + process.env[pathKey] };
const r = reporter('Content Security Policy');

/** CDP mínimo para otra ventana (la oficina): evaluar y juntar los avisos de CSP, también los de su carga. */
async function attach(target) {
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  let id = 0; const pend = new Map(), csp = [];
  ws.onmessage = m => {
    const d = JSON.parse(m.data);
    if (d.method === 'Log.entryAdded' && /Content Security Policy/i.test(d.params.entry.text)) csp.push(d.params.entry.text);
    pend.get(d.id)?.(d); pend.delete(d.id);
  };
  const send = (method, params) => new Promise(res => { const i = ++id; pend.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
  await send('Log.enable');
  const ev = async expr => (await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true })).result?.result?.value;
  return { ev, csp, close: () => ws.close() };
}

let a, office;
try {
  a = await launch({ profile: path.join(root, 'perfil'), env });
  const meta = await a.ev(`document.querySelector('meta[http-equiv="Content-Security-Policy"]')?.content || ''`);
  r.check('la página principal carga con su política', /default-src 'none'/.test(meta) && /script-src 'self'(;|$)/.test(meta), meta);
  r.check('tema inicial aplicado por theme-init.js (antes era un script en línea)', (await a.ev('document.documentElement.dataset.theme')) === 'xp');

  // Terminal: xterm inyecta <style> y atributos style; el texto con colores tiene que verse.
  await a.ev(`openTerm({ newIn: ${JSON.stringify(root)} }, 'CSP', null), true`);
  let shown = false;
  for (let i = 0; i < 60 && !shown; i++) { await sleep(250); shown = await a.ev(`[...document.querySelectorAll('.term .xterm-rows')].some(r => r.textContent.includes('AGENTMAP-CSP-OK'))`); }
  const styled = await a.ev(`(() => { const sp = [...document.querySelectorAll('.term .xterm-rows span')].find(s => s.textContent.includes('AGENTMAP-CSP-OK'));
    return !!sp && getComputedStyle(sp).color !== getComputedStyle(sp.parentElement).color; })()`);
  r.check('terminal: xterm dibuja el texto y sus colores', shown && styled, `texto ${shown}, color ${styled}`);
  await a.ev(`closeTerm(state.active), true`).catch(() => {});
  await sleep(300);
  await a.ev(`document.querySelector('#modal').open && document.querySelector('#modal button[value="ok"]')?.click(), true`); // confirmar el cierre
  await sleep(800);

  // Avisos, sonido, canal en vivo, opciones y la guía con imágenes
  await a.ev(`toasts.show({ key: 'csp', kind: 'info', title: 'Aviso con CSP' }), true`);
  const toast = await a.ev(`!!document.querySelector('#toasts .toast')`);
  const played = await a.ev(`player.play('message', state.prefs.sounds, true)`);
  await sleep(1500);
  const live = await a.ev(`typeof liveSig === 'string'`);
  r.check('avisos, sonido local (/sounds/) y canal en vivo (/api/events) funcionan', toast && played === 'played' && live, `aviso ${toast}, sonido ${played}, en vivo ${live}`);
  await a.ev('showAbout(), true'); await sleep(600);
  const img = await a.ev(`(() => { const i = document.querySelector('#abImg'); return i.complete && i.naturalWidth > 0; })()`);
  r.check('guía: las imágenes de /about/ cargan', img);
  await a.ev(`document.querySelector('#modal').close(), true`);

  // Oficina en su ventana: canvas y scripts propios con style-src 'self' (sin 'unsafe-inline')
  await a.ev(`window.open('/office.html?dir=' + encodeURIComponent(${JSON.stringify(root)}), 'agentmap-office'), true`);
  let target;
  for (let i = 0; i < 40 && !target; i++) { await sleep(250); target = (await a.targets())?.find(t => t.type === 'page' && t.url.includes('/office.html')); }
  if (!target) throw new Error('no se abrió la ventana de la oficina');
  office = await attach(target);
  for (let i = 0; i < 20 && !(await office.ev(`document.readyState === 'complete' && typeof Office !== 'undefined'`)); i++) await sleep(250);
  const off = JSON.parse(await office.ev(`JSON.stringify({ meta: document.querySelector('meta[http-equiv="Content-Security-Policy"]')?.content || '',
    office: typeof Office, canvas: document.querySelector('#offCanvas').width > 0, theme: document.documentElement.dataset.theme })`));
  r.check('oficina: su política (sin unsafe-inline) y la oficina dibujada', /style-src 'self';/.test(off.meta) && off.office !== 'undefined' && off.canvas && off.theme === 'xp', JSON.stringify(off));

  // La política bloquea de verdad
  r.check('sin recursos bloqueados en el uso normal (principal y oficina)', a.csp.length === 0 && office.csp.length === 0, [...a.csp, ...office.csp].join(' | ').slice(0, 300));
  const inline = await a.ev(`(async () => { const s = document.createElement('script'); s.textContent = 'window.__inl = 1'; document.head.append(s);
    await new Promise(r => setTimeout(r, 200)); return window.__inl === undefined; })()`);
  await sleep(300);
  r.check('bloquea un <script> en línea y lo informa', inline && a.csp.some(t => /script/i.test(t)), a.csp.join(' | ').slice(0, 200));
  // eval desde la página (DevTools salta la CSP en sus propias evaluaciones): un setTimeout con texto es eval.
  const evalBlocked = await a.ev(`(async () => { setTimeout('window.__ev = 1'); await new Promise(r => setTimeout(r, 200)); return window.__ev === undefined; })()`);
  await sleep(200);
  r.check('bloquea eval (código desde texto) y lo informa', evalBlocked && a.csp.some(t => /eval/i.test(t)), String(evalBlocked));
  const styleBlocked = await office.ev(`(async () => { const st = document.createElement('style'); st.textContent = 'body { outline: 7px solid rgb(1, 2, 3) !important }'; document.head.append(st);
    await new Promise(r => setTimeout(r, 200)); return getComputedStyle(document.body).outlineWidth !== '7px'; })()`);
  r.check('oficina: bloquea un <style> en línea', styleBlocked);
  office.close();
} catch (err) { r.fail(err); }
if (a?.close) await a.close();
await sleep(300);
cleanup();
process.exit(r.finish());
