// E2E: los cuatro sonidos reales de Sounds/ (desarrollo) o de resources/sounds (instalador local, npm run dist:local).
// Sin preferencias previas: comprueba los predeterminados, la reproducción real de cada archivo, los controles y el reinicio.
import fs from 'node:fs';
import path from 'node:path';
import { APP, launch, makeFixture, packaged, reporter, sleep, tempRoot, userLine, assistantLine } from './lib.mjs';

const FILES = ['messenger-tono-mensaje.mp3', 'msn-alert.mp3', 'msn-online.mp3', 'nudge-nudge-msn.mp3'];
const repoSounds = path.join(APP, 'Sounds');
if (!packaged && !FILES.every(f => fs.existsSync(path.join(repoSounds, f)))) {
  console.log('\n== Sonidos reales ==\nOMITIDA: no están los cuatro mp3 en Sounds/ de este equipo.');
  process.exit(0);
}
const { root, cleanup } = tempRoot('sounds');
const fx = makeFixture(root);
const am = path.join(root, 'agent-map');
const env = { CLAUDE_CONFIG_DIR: fx.claude, AGENT_MAP_USAGE_FILE: path.join(am, 'usage.json') };
const profile = path.join(root, 'perfil');
const LIVE = path.join(fx.claude, 'sessions', process.pid + '.json');
const r = reporter('Sonidos reales (los cuatro mp3)');
// Registra solo reproducciones que de verdad arrancaron (la promesa de play() se cumplió) y con qué volumen.
const HOOK = `(() => { window.__plays = []; const orig = HTMLMediaElement.prototype.play;
  HTMLMediaElement.prototype.play = function () { const p = orig.call(this); p.then(() => __plays.push({ file: decodeURIComponent(this.src.split('/').pop()), vol: this.volume }), () => {}); return p; }; return true; })()`;
const GAP = 3200;

let a;
try {
  a = await launch({ profile, env });
  await a.ev(HOOK);
  const plays = async () => JSON.parse(await a.ev('JSON.stringify(__plays)'));
  const lastFile = async () => (await plays()).at(-1)?.file;
  const toastKeys = async () => JSON.parse(await a.ev(`JSON.stringify([...document.querySelectorAll('#toasts .toast')].map(t => t.dataset.toastKey))`));

  const list = JSON.parse(await a.ev(`fetch('/api/sounds').then(x => x.json()).then(j => JSON.stringify(j))`));
  r.check('/api/sounds encuentra los cuatro mp3 sin copiarlos a mano', FILES.every(f => list.files.some(x => x.name === f && !x.mine)), list.files.map(x => x.name).join(', '));
  const served = JSON.parse(await a.ev(`Promise.all(${JSON.stringify(FILES)}.map(f => fetch('/sounds/' + encodeURIComponent(f))
    .then(async x => ({ f, status: x.status, type: x.headers.get('content-type'), size: (await x.arrayBuffer()).byteLength })))).then(j => JSON.stringify(j))`));
  r.check('/sounds/<archivo> entrega cada mp3 completo como audio/mpeg', served.every(s => s.status === 200 && s.type === 'audio/mpeg' && s.size === fs.statSync(path.join(repoSounds, s.f)).size),
    served.map(s => `${s.f}:${s.status}:${s.size}`).join(' '));

  await a.ev('showOptions(), true'); await sleep(500);
  const defaults = JSON.parse(await a.ev(`JSON.stringify(['message', 'finished', 'toast'].map(k => document.querySelector('[data-snd-file="' + k + '"]').value)
    .concat([!!document.querySelector('.snd-missing'), [...document.querySelectorAll('[data-snd-file="message"] option')].map(o => o.value).includes('msn-alert.mp3')]))`));
  r.check('predeterminados: mensaje=messenger-tono-mensaje, terminó=msn-online, otros=nudge-nudge-msn; msn-alert elegible; nada falta',
    JSON.stringify(defaults) === JSON.stringify(['messenger-tono-mensaje.mp3', 'msn-online.mp3', 'nudge-nudge-msn.mp3', false, true]), JSON.stringify(defaults));
  const test = async k => { await a.ev(`document.querySelector('[data-snd-test="${k}"]').click(), true`); await sleep(900); return a.ev(`$('#optSndMsg').textContent`); };
  const m1 = await test('message'); const p1 = await lastFile();
  const m2 = await test('finished'); const p2 = await lastFile();
  const m3 = await test('toast'); const p3 = await lastFile();
  await a.ev(`(() => { const s = document.querySelector('[data-snd-file="message"]'); s.value = 'msn-alert.mp3'; s.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`);
  await sleep(700);
  const m4 = await test('message'); const p4 = await lastFile();
  r.check('▶ Probar reproduce de verdad los cuatro archivos', [m1, m2, m3, m4].every(m => m.startsWith('▶'))
    && JSON.stringify([p1, p2, p3, p4]) === JSON.stringify(['messenger-tono-mensaje.mp3', 'msn-online.mp3', 'nudge-nudge-msn.mp3', 'msn-alert.mp3']), [p1, p2, p3, p4].join(', '));
  await a.ev(`(() => { const v = $('#optVol'); v.value = 30; v.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`); await sleep(600);
  await test('finished');
  const vol = (await plays()).at(-1).vol;
  r.check('el volumen elegido se aplica al reproducir', Math.abs(vol - 0.3) < 0.001, 'volumen=' + vol);
  await a.ev(`(() => { const c = document.querySelector('[data-snd-on="message"]'); c.checked = false; c.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`); await sleep(600);
  await a.ev(`document.querySelector('#modal').close(), true`);

  const n0 = (await plays()).length;
  fs.appendFileSync(fx.blog.file, assistantLine('respuesta sin sonido', 'msg_s1'));
  await a.ev('load()'); await sleep(800);
  r.check('sonido de mensaje desactivado: el aviso aparece pero no suena', (await toastKeys()).includes('message:' + fx.blog.id) && (await plays()).length === n0);
  await a.ev('showOptions(), true'); await sleep(400);
  await a.ev(`(() => { const c = document.querySelector('[data-snd-on="message"]'); c.checked = true; c.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`); await sleep(600);
  await a.ev(`document.querySelector('#modal').close(), true`);
  await sleep(GAP);
  fs.appendFileSync(fx.blog.file, assistantLine('respuesta con sonido', 'msg_s2'));
  await a.ev('load()'); await sleep(900);
  const pm = await lastFile();
  fs.writeFileSync(LIVE, JSON.stringify({ pid: process.pid, sessionId: fx.juego.id, status: 'busy', statusUpdatedAt: 1 }));
  await a.ev('load()');
  fs.writeFileSync(LIVE, JSON.stringify({ pid: process.pid, sessionId: fx.juego.id, status: 'idle', statusUpdatedAt: 2 }));
  await a.ev('load()'); await sleep(900);
  const pf = await lastFile();
  fs.writeFileSync(path.join(fx.tienda.dir, '77777777-aaaa-bbbb-cccc-dddddddddddd.jsonl'), userLine('otra sesión', fx.tienda.cwd) + assistantLine('ok', 'msg_s3'));
  await a.ev('load()'); await sleep(900);
  const pt = await lastFile();
  r.check('avisos reales suenan con su archivo: mensaje (msn-alert elegido), terminó, otros', pm === 'msn-alert.mp3' && pf === 'msn-online.mp3' && pt === 'nudge-nudge-msn.mp3', [pm, pf, pt].join(', '));
  r.check('sin errores de reproducción silenciosos (ningún aviso de sonido faltante o bloqueado)', !(await toastKeys()).some(k => /^sound-/.test(k)));
  fs.rmSync(LIVE);

  await a.close();
  a = await launch({ profile, env });
  await a.ev(HOOK);
  await a.ev('showOptions(), true'); await sleep(500);
  const kept = JSON.parse(await a.ev(`JSON.stringify({ msg: document.querySelector('[data-snd-file="message"]').value, on: document.querySelector('[data-snd-on="message"]').checked, vol: $('#optVol').value })`));
  await test('message'); await test('toast');
  const after = (await plays()).map(p => p.file);
  await a.ev(`document.querySelector('#modal').close(), true`);
  r.check('tras reiniciar: preferencias conservadas y los sonidos siguen sonando', kept.msg === 'msn-alert.mp3' && kept.on && kept.vol === '30'
    && JSON.stringify(after) === JSON.stringify(['msn-alert.mp3', 'nudge-nudge-msn.mp3']), JSON.stringify(kept) + ' ' + after.join(', '));
} catch (err) { r.fail(err); }
if (a?.close) await a.close();
await sleep(300);
cleanup();
process.exit(r.finish());
