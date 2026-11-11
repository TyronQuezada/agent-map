// E2E: avisos (toasts), sonidos y copiar mensajes. Datos, preferencias, sonidos y perfil en una carpeta temporal;
// el portapapeles se guarda al empezar y se restaura al terminar.
import fs from 'node:fs';
import path from 'node:path';
import { launch, makeFixture, makeWav, reporter, sleep, tempRoot, userLine, assistantLine } from './lib.mjs';

const { root, cleanup } = tempRoot('ux');
const fx = makeFixture(root);
const am = path.join(root, 'agent-map');                  // hace de ~/.agent-map
const env = { CLAUDE_CONFIG_DIR: fx.claude, AGENT_MAP_USAGE_FILE: path.join(am, 'usage.json') };
const PREFS = path.join(am, 'prefs.json');
makeWav(path.join(am, 'sounds', 'e2e-mensaje.wav'), 880);  // sonidos propios del usuario (generados aquí)
makeWav(path.join(am, 'sounds', 'e2e-fin.wav'), 523);
makeWav(path.join(am, 'sounds', 'e2e-aviso.wav'), 330);
fs.writeFileSync(PREFS, JSON.stringify({ sounds: { volume: 0.2, message: { on: true, file: 'e2e-mensaje.wav' },
  finished: { on: true, file: 'e2e-fin.wav' }, toast: { on: true, file: 'e2e-aviso.wav' } } }));
const profile = path.join(root, 'perfil');
const S1 = fx.blog, S2 = fx.juego;
const NEW = '99999999-aaaa-bbbb-cccc-dddddddddddd', NEWF = path.join(S1.dir, NEW + '.jsonl');
const LIVE = path.join(fx.claude, 'sessions', process.pid + '.json'); // pid de este proceso: "vivo" mientras dura la prueba
const setLive = (status, at) => fs.writeFileSync(LIVE, JSON.stringify({ pid: process.pid, sessionId: S2.id, cwd: S2.cwd, status, statusUpdatedAt: at, updatedAt: at, kind: 'interactive', entrypoint: 'cli' }));
const r = reporter('Avisos, sonidos y copiar mensajes');

const TOASTS = `JSON.stringify([...document.querySelectorAll('#toasts .toast:not(.out)')].map(t => ({ key: t.dataset.toastKey, role: t.getAttribute('role'), text: t.textContent })))`;
const PLAYS = `(() => { window.__plays = []; const orig = HTMLMediaElement.prototype.play;
  HTMLMediaElement.prototype.play = function () { const p = orig.call(this); p.then(() => __plays.push(decodeURIComponent(this.src.split('/').pop())), () => {}); return p; }; return true; })()`;
const GAP = 3200; // el mismo sonido no se repite antes de 3 s

let a, clipBefore = null;
try {
  a = await launch({ profile, env });
  const toastsNow = async () => JSON.parse(await a.ev(TOASTS));
  const plays = async () => JSON.parse(await a.ev('JSON.stringify(__plays)'));
  const clear = () => a.ev(`(async () => { for (let i = 0; i < 3; i++) { for (const b of document.querySelectorAll('#toasts .toast-close')) b.click(); await new Promise(r => setTimeout(r, 450)); } return true; })()`);
  // El evento 'close' del <dialog> llega asíncrono y Chromium puede demorarlo más de 100 ms: se espera el evento real.
  const closeModal = () => a.ev(`new Promise(r => { const m = document.querySelector('#modal'); if (!m.open) return r(true);
    m.addEventListener('close', () => setTimeout(() => r(true), 0), { once: true }); m.close(); setTimeout(() => r(false), 5000); })`);
  clipBefore = await a.ev('window.desktop.readClipboard()');
  await a.ev(PLAYS);
  await a.ev('toasts.setDuration(60000), true'); // largos: la prueba los cuenta y cierra a mano

  await a.ev('load()');
  r.check('carga inicial y recarga sin cambios: sin avisos ni sonidos históricos', (await toastsNow()).length === 0 && (await plays()).length === 0);

  const LONG = 'SECRETO-E2E ' + 'palabra '.repeat(400) + 'FINAL-DEL-TEXTO';
  fs.appendFileSync(S1.file, assistantLine(LONG, 'msg_e2e_1'));
  await a.ev('load()'); await sleep(300);
  let t = await toastsNow();
  r.check('mensaje nuevo: un aviso con sesión y proyecto, sin contenido de la respuesta, con su sonido',
    t.length === 1 && t[0].key === 'message:' + S1.id && t[0].text.includes('Migrar el blog a Markdown') && t[0].text.includes('blog-personal')
    && !t[0].text.includes('SECRETO') && t[0].role === 'status' && JSON.stringify(await plays()) === '["e2e-mensaje.wav"]', t[0]?.text);

  await a.ev('load()'); await a.ev('load()');
  r.check('recargas sin cambios: sin avisos ni sonidos duplicados', (await toastsNow()).length === 1 && (await plays()).length === 1);

  await sleep(GAP);
  fs.appendFileSync(S1.file, assistantLine('otra', 'msg_e2e_2') + assistantLine('y otra', 'msg_e2e_3'));
  await a.ev('load()');
  t = await toastsNow();
  r.check('varias respuestas de la misma sesión: un solo aviso que suma', t.length === 1 && /3 respuestas nuevas/.test(t[0].text), t[0]?.text);
  await clear();
  r.check('el botón × cierra el aviso', (await toastsNow()).length === 0);

  setLive('busy', 1000); await a.ev('load()');
  const silentLive = (await toastsNow()).length === 0;
  await sleep(GAP);
  setLive('idle', 2000); await a.ev('load()'); await sleep(300);
  t = await toastsNow();
  r.check('busy -> idle: "Claude terminó" con el sonido de finalización (uno solo)', silentLive && t.length === 1 && t[0].key === 'finished:' + S2.id
    && /Claude terminó/.test(t[0].text) && (await plays()).at(-1) === 'e2e-fin.wav', (await plays()).join(','));

  setLive('busy', 3000); await a.ev('load()');
  await sleep(GAP);
  setLive('waiting', 4000); await a.ev('load()'); await sleep(300);
  t = await toastsNow();
  r.check('busy -> waiting: aviso de espera (no "terminó") con el sonido general', t.some(x => x.key === 'waiting:' + S2.id && /espera tu intervención/.test(x.text))
    && t.filter(x => /terminó/.test(x.text)).length === 1 && (await plays()).at(-1) === 'e2e-aviso.wav');

  await sleep(GAP);
  fs.rmSync(LIVE); await a.ev('load()');
  r.check('sesión cerrada: aviso', (await toastsNow()).some(x => x.key === 'session-closed:' + S2.id && /Sesión cerrada/.test(x.text)));
  await clear();

  fs.writeFileSync(NEWF, userLine('hola nueva', S1.cwd) + assistantLine('respuesta nueva', 'msg_new_1'));
  await a.ev('load()');
  t = await toastsNow();
  r.check('sesión nueva externa: aviso (sin nombre: nunca se usa el prompt)', t.length === 1 && t[0].key === 'session-new:' + NEW && !t[0].text.includes('hola nueva'), t[0]?.text);
  await clear();

  await a.ev(`[1,2,3,4,5].forEach(i => toasts.show({ key: 'q' + i, kind: 'info', title: 'Cola ' + i })), true`);
  const c1 = await a.ev('JSON.stringify(toasts.count())');
  await a.ev(`document.querySelector('#toasts .toast-close').click(), true`); await sleep(450);
  const c2 = await a.ev('JSON.stringify(toasts.count())');
  r.check('cola: máximo 3 visibles; al cerrar uno entra el siguiente', c1 === '{"visible":3,"queued":2}' && c2 === '{"visible":3,"queued":1}', `${c1} -> ${c2}`);
  await clear();
  r.check('cola vacía y sin avisos colgando tras cerrarlos', (await a.ev('JSON.stringify(toasts.count())')) === '{"visible":0,"queued":0}'
    && (await a.ev(`document.querySelectorAll('#toasts .toast').length`)) === 0);

  await a.ev(`toasts.setDuration(1000), toasts.show({ key: 'auto', kind: 'info', title: 'Se va solo' }), true`);
  await sleep(200); const visibleBefore = (await toastsNow()).length;
  await sleep(1500);
  r.check('cierre automático (duración configurable)', visibleBefore === 1 && (await a.ev(`document.querySelectorAll('#toasts .toast').length`)) === 0);
  await a.ev('toasts.setDuration(60000), true');

  await sleep(GAP);
  fs.appendFileSync(S1.file, assistantLine('para el click', 'msg_e2e_4'));
  await a.ev(`window.__opened = null; window.selectSession = id => { window.__opened = id; }; true`); // sin lanzar un Claude real
  await a.ev('load()');
  await a.ev(`document.querySelector('#toasts .toast-body').click(), true`); await sleep(450);
  r.check('click en el aviso abre su sesión y lo cierra', (await a.ev('window.__opened')) === S1.id && (await toastsNow()).length === 0);

  await a.ev('showOptions(), true');
  await a.ev(`toasts.show({ key: 'modal', kind: 'info', title: 'Espera al modal' }), true`);
  const during = await a.ev('JSON.stringify(toasts.count())');
  await closeModal();
  r.check('con un modal abierto el aviso espera; al cerrarlo aparece', during === '{"visible":0,"queued":1}' && (await a.ev('JSON.stringify(toasts.count())')) === '{"visible":1,"queued":0}', during);
  await clear();

  // Opciones de sonido: lista real de archivos, guardar, probar y aviso de archivo faltante
  await a.ev('showOptions(), true'); await sleep(400);
  const ui = JSON.parse(await a.ev(`JSON.stringify({ vol: $('#optVol').value, rows: document.querySelectorAll('.sound-row').length,
    files: [...document.querySelectorAll('[data-snd-file="message"] option')].map(o => o.value), dir: $('#optSndDir').textContent, folder: !!$('#optSndFolder') })`));
  r.check('opciones: filas, archivos reales de la carpeta del usuario y su ruta', ui.vol === '20' && ui.rows === 3 && ['e2e-aviso.wav', 'e2e-fin.wav', 'e2e-mensaje.wav'].every(f => ui.files.includes(f))
    && ui.dir.includes(path.join(am, 'sounds')) && ui.folder, JSON.stringify(ui));
  await a.ev(`(() => { const v = $('#optVol'); v.value = 40; v.dispatchEvent(new Event('change', { bubbles: true }));
    const c = document.querySelector('[data-snd-on="finished"]'); c.checked = false; c.dispatchEvent(new Event('change', { bubbles: true }));
    const s = document.querySelector('[data-snd-file="message"]'); s.value = 'e2e-aviso.wav'; s.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`);
  await sleep(700);
  const disk = JSON.parse(fs.readFileSync(PREFS, 'utf8')).sounds;
  r.check('volumen, interruptor y archivo se guardan en prefs.json', disk.volume === 0.4 && disk.finished.on === false && disk.message.file === 'e2e-aviso.wav', JSON.stringify(disk));
  await a.ev(`document.querySelector('[data-snd-test="finished"]').click(), true`); await sleep(700);
  const msg = await a.ev(`$('#optSndMsg').textContent`);
  r.check('▶ Probar reproduce aunque esté desactivado', msg.startsWith('▶') && (await plays()).at(-1) === 'e2e-fin.wav', msg);
  await a.ev(`savePrefs({ sounds: { toast: { file: 'no-existe.mp3' } } }).then(() => true)`);
  await closeModal();
  await a.ev('showOptions(), true'); await sleep(400);
  const miss = JSON.parse(await a.ev(`JSON.stringify({ opt: document.querySelector('[data-snd-file="toast"]').selectedOptions[0].textContent, warn: !!document.querySelector('.snd-missing') })`));
  await a.ev(`document.querySelector('[data-snd-test="toast"]').click(), true`); await sleep(500);
  const missMsg = await a.ev(`$('#optSndMsg').textContent`);
  await closeModal();
  r.check('archivo faltante: se marca "(falta)" y probar lo explica sin fallar', miss.opt === 'no-existe.mp3 (falta)' && miss.warn && /No se encontró/.test(missMsg), JSON.stringify(miss));

  await sleep(GAP);
  const n0 = (await plays()).length;
  setLive('busy', 5000); await a.ev('load()');
  await sleep(GAP);
  setLive('idle', 6000); await a.ev('load()'); await sleep(300);
  r.check('finalización con su sonido desactivado: aviso sin sonido', (await toastsNow()).some(x => x.key === 'finished:' + S2.id) && (await plays()).length === n0);
  await sleep(GAP);
  fs.rmSync(LIVE); await a.ev('load()'); await sleep(500);
  t = await toastsNow();
  const warns = t.filter(x => x.key === 'sound-missing:no-existe.mp3').length;
  await clear();
  await sleep(GAP);
  fs.writeFileSync(path.join(fx.claude, 'sessions', process.pid + '.json'), JSON.stringify({ pid: process.pid, sessionId: S2.id, status: 'busy' }));
  await a.ev('load()'); await sleep(GAP);
  fs.rmSync(LIVE); await a.ev('load()'); await sleep(500);
  r.check('sonido faltante en un aviso real: se avisa una sola vez por arranque', warns === 1 && !(await toastsNow()).some(x => x.key === 'sound-missing:no-existe.mp3'), 'primer aviso: ' + JSON.stringify(t.map(x => x.key)) + ' cola ' + (await a.ev('JSON.stringify(toasts.count())')));
  await clear();

  // Copiar: cada mensaje tiene su propio botón y copia solo ese mensaje, completo y tal cual
  const USER_TXT = 'Pedido con formato:\n\n- punto uno\n- punto dos\n\n    código indentado\nFin del pedido ✓';
  const LONG20 = ('Línea larga ' + 'x'.repeat(80) + '\n').repeat(220) + 'ÚLTIMA-LÍNEA';
  fs.appendFileSync(S1.file, userLine(USER_TXT, S1.cwd) + assistantLine(LONG20, 'msg_e2e_20k'));
  await a.ev('load()'); await clear();
  await a.ev(`(async () => { state.selected = '${S1.id}'; state.convo = null; renderStats(); for (let i = 0; i < 50 && !state.convo?.list; i++) await new Promise(r => setTimeout(r, 100)); renderStats(); return true; })()`);
  const list = JSON.parse(await a.ev('JSON.stringify(state.convo.list.map(m => ({ role: m.role, text: m.text })))'));
  const iu = list.findIndex(m => m.text === USER_TXT), ic = list.findIndex(m => m.text === LONG20);
  const clipboard = () => a.ev('window.desktop.readClipboard()');
  const clickCopy = async sel => { await a.ev(`document.querySelector('${sel}').click(), true`); await sleep(250);
    return JSON.parse(await a.ev(`JSON.stringify({ text: document.querySelector('${sel}')?.textContent, cls: document.querySelector('${sel}')?.className })`)); };
  const icons = await a.ev(`JSON.stringify({ icons: document.querySelectorAll('#convo [data-copy-msg]').length, bubbles: document.querySelectorAll('#convo [data-msg]').length,
    shown: document.querySelector('#convo [data-msg="${ic}"] span').textContent.length, global: !!document.querySelector('[data-copy-convo]') })`);
  r.check('cada mensaje de la conversación tiene su botón de copiar; no hay "Copiar todo"; en pantalla se ve recortado',
    JSON.parse(icons).icons === list.length && JSON.parse(icons).bubbles === list.length && JSON.parse(icons).shown <= 600 && !JSON.parse(icons).global && iu >= 0 && ic >= 0, icons);
  let st = await clickCopy(`[data-copy-msg="${iu}"]`);
  let clip = await clipboard();
  r.check('copiar un mensaje tuyo copia solo ese mensaje, con su formato, y confirma junto al botón',
    clip === USER_TXT && st.text === '✓' && /copied/.test(st.cls), JSON.stringify(st));
  st = await clickCopy(`[data-copy-msg="${ic}"]`);
  clip = await clipboard();
  r.check('copiar una respuesta de 20 000+ caracteres la copia completa y sin otros mensajes',
    clip === LONG20 && clip.length > 20000 && !clip.includes('Pedido con formato') && !clip.includes('Listo, primera respuesta.') && !clip.includes('SECRETO-E2E'), `${clip.length} caracteres`);
  let allOk = true;
  for (let i = 0; i < list.length; i++) { await clickCopy(`[data-copy-msg="${i}"]`); if ((await clipboard()) !== list[i].text) allOk = false; }
  r.check(`cada uno de los ${list.length} botones copia exactamente su mensaje (orden y formato originales)`, allOk);
  await a.ev(`document.querySelector('#convo [data-msg="${ic}"]').click(), true`); await sleep(300);
  st = await clickCopy('[data-copy-modal]');
  clip = await clipboard();
  r.check('modal de una respuesta: su botón copia esa respuesta completa y confirma', clip === LONG20 && st.text === '✓ Copiado', st.text);
  await closeModal();
  await a.ev(`renderStats(), document.querySelector('[data-prompt="last"]').click(), true`); await sleep(600);
  st = await clickCopy('[data-copy-modal]');
  clip = await clipboard();
  r.check('modal del último prompt: su botón copia ese prompt completo', clip === USER_TXT && st.text === '✓ Copiado', st.text);
  await a.ev(`window.copyText = async () => false; true`); // portapapeles que no responde
  st = await clickCopy('[data-copy-modal]');
  const modalFail = st.text === '⚠ No se pudo copiar' && /copy-failed/.test(st.cls);
  await closeModal(); await clear();
  await a.ev('renderStats(), true');
  st = await clickCopy(`[data-copy-msg="${iu}"]`); await sleep(200);
  r.check('si el portapapeles falla: se marca el botón y aparece un aviso de error', modalFail && st.text === '⚠' && /copy-failed/.test(st.cls)
    && (await toastsNow()).some(x => /No se pudo copiar/.test(x.text) && x.role === 'alert'), JSON.stringify(st));

  // Reinicio: preferencias conservadas y nada histórico
  await a.ev(`window.desktop.writeClipboard(${JSON.stringify(clipBefore)}), true`);
  await a.close();
  a = await launch({ profile, env });
  await a.ev(PLAYS);
  await a.ev('load()');
  await a.ev('showOptions(), true'); await sleep(400);
  const after = await a.ev(`JSON.stringify({ vol: $('#optVol').value, fin: document.querySelector('[data-snd-on="finished"]').checked, msg: document.querySelector('[data-snd-file="message"]').value })`);
  await closeModal();
  r.check('tras reiniciar: preferencias de sonido conservadas, sin avisos ni sonidos históricos',
    after === '{"vol":"40","fin":false,"msg":"e2e-aviso.wav"}' && (await toastsNow()).length === 0 && (await plays()).length === 0, after);
} catch (err) { r.fail(err); }
try { if (a?.ev && clipBefore !== null) await a.ev(`window.desktop.writeClipboard(${JSON.stringify(clipBefore)}), true`); } catch {}
if (a?.close) await a.close();
await sleep(300);
cleanup();
process.exit(r.finish());
