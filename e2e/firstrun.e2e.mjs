// E2E de primera ejecución: sin ~/.claude, sin `claude` en el PATH, sin sesiones y con error de lectura; los sonidos
// incluidos suenan desde un perfil limpio (también con preferencias viejas que apuntan a mp3 ausentes) y retomar una
// sesión cuya carpeta ya no existe lo explica. Nunca se abre el claude real: el PATH es solo el de Windows o un falso.
import fs from 'node:fs';
import path from 'node:path';
import { launch, reporter, sleep, tempRoot, userLine, assistantLine } from './lib.mjs';

const { root, cleanup } = tempRoot('firstrun');
const r = reporter('Primera ejecución (sin Claude Code, sin sesiones, sonidos incluidos)');
const pathKey = Object.keys(process.env).find(k => k.toUpperCase() === 'PATH') || 'PATH';
const WIN = process.env.SystemRoot || 'C:\\Windows';
const NO_CLAUDE_PATH = [path.join(WIN, 'System32'), WIN].join(';'); // solo Windows: ahí no hay claude
const bin = path.join(root, 'bin');
fs.mkdirSync(bin, { recursive: true });
fs.writeFileSync(path.join(bin, 'claude.cmd'), '@echo off\r\necho AGENTMAP-FAKE-CLAUDE\r\n'); // solo para que "exista"
const FAKE_PATH = [bin, NO_CLAUDE_PATH].join(';');
const SOUND_FILES = ['agentmap-mensaje.wav', 'agentmap-fin.wav', 'agentmap-aviso.wav'];

// Reproducciones que de verdad arrancaron (la promesa de play() se cumplió: el archivo existe y se decodificó).
const HOOK = `(() => { window.__plays = []; const orig = HTMLMediaElement.prototype.play;
  HTMLMediaElement.prototype.play = function () { const p = orig.call(this); p.then(() => __plays.push(decodeURIComponent(this.src.split('/').pop())), () => {}); return p; }; return true; })()`;
const termText = `(() => { const t = [...state.terms.values()].at(-1); if (!t) return ''; const b = t.term.buffer.active; let s = '';
  for (let i = 0; i < b.length; i++) s += b.getLine(i).translateToString(true) + '\\n'; return s; })()`;
const toastKeys = `JSON.stringify([...document.querySelectorAll('#toasts .toast')].map(t => t.dataset.toastKey))`;
const waitFor = async (a, expr, ms = 8000) => { const t = Date.now(); let v; while (!(v = await a.ev(expr)) && Date.now() - t < ms) await sleep(150); return v; };

function setup(name, { claude, path: PATH, prefs }) {
  const dir = path.join(root, name);
  const am = path.join(dir, 'agent-map');
  fs.mkdirSync(am, { recursive: true });
  if (prefs) fs.writeFileSync(path.join(am, 'prefs.json'), JSON.stringify(prefs));
  return { dir, am, claudeDir: claude || path.join(dir, 'claude'),
    env: { CLAUDE_CONFIG_DIR: claude || path.join(dir, 'claude'), AGENT_MAP_USAGE_FILE: path.join(am, 'usage.json'), [pathKey]: PATH } };
}

let a;
try {
  // 1. Equipo sin Claude Code: no existe ~/.claude ni el comando. Preferencias de una versión vieja (mp3 de MSN).
  const legacy = { sounds: { volume: 0.6, message: { on: true, file: 'messenger-tono-mensaje.mp3' }, finished: { on: true, file: 'msn-online.mp3' },
    toast: { on: true, file: 'nudge-nudge-msn.mp3' } } };
  const s1 = setup('sin-claude', { path: NO_CLAUDE_PATH, prefs: legacy });
  const prefsBefore = fs.readFileSync(path.join(s1.am, 'prefs.json'), 'utf8');
  a = await launch({ profile: path.join(s1.dir, 'perfil'), env: s1.env });
  await a.ev(HOOK);
  const missing = await waitFor(a, `(() => { const e = document.querySelector('#tree [data-claude]'); return e && JSON.stringify({ kind: e.dataset.claude, text: e.textContent }); })()`);
  const m = JSON.parse(missing || '{}');
  r.check('sin ~/.claude: el árbol dice que no se encontró la carpeta de Claude Code (no "no hay coincidencias")',
    m.kind === 'missing' && m.text.includes('No se encontró la carpeta de Claude Code') && m.text.includes(s1.claudeDir) && m.text.includes('claude --version'), m.text);
  const card = await a.ev(`document.querySelector('#home .claude-missing')?.textContent || ''`);
  r.check('sin claude en el PATH: Inicio avisa y explica cómo instalarlo, sin bloquear la app', /Claude Code no está disponible/.test(card) && /code\.claude\.com/.test(card)
    && await a.ev(`!!document.querySelector('#newBtn') && !!document.querySelector('#tree')`), card.slice(0, 90));
  await a.ev(`state.newDir = ${JSON.stringify(s1.dir)}, showHome(), document.querySelector('#newBtn').click(), true`);
  const t1 = await waitFor(a, `(${termText}).includes('claude --version') && ${termText}`);
  r.check('iniciar Claude sin el comando: la terminal explica el problema y los pasos (no el error de cmd.exe)',
    !!t1 && t1.includes('Claude Code no está instalado o no está en el PATH') && t1.includes('Reinicia Agent Map') && !/no se reconoce/i.test(t1), (t1 || '').trim().split('\n')[0]);
  r.check('la app sigue respondiendo tras el error (opciones abren)', await a.ev(`(showOptions(), !!document.querySelector('[data-snd-file="message"]'))`));
  await sleep(500);

  // Sonidos: con preferencias viejas cuyos mp3 no están, se usan los incluidos; los que sí están se respetan.
  const have = JSON.parse(await a.ev(`fetch('/api/sounds').then(x => x.json()).then(j => JSON.stringify(j.files.map(f => f.name)))`));
  r.check('/api/sounds trae los tres sonidos incluidos desde un perfil limpio', SOUND_FILES.every(f => have.includes(f)), have.join(', '));
  const want = ['message', 'finished', 'toast'].map((k, i) => have.includes(legacy.sounds[k].file) ? legacy.sounds[k].file : SOUND_FILES[i]);
  const shown = JSON.parse(await a.ev(`JSON.stringify(['message', 'finished', 'toast'].map(k => document.querySelector('[data-snd-file="' + k + '"]').value).concat(!!document.querySelector('.snd-missing')))`));
  r.check('preferencias viejas: cada sonido es uno que existe (el incluido si falta el mp3); nada marcado "(falta)"',
    JSON.stringify(shown) === JSON.stringify([...want, false]), JSON.stringify(shown));
  // Espera a que el mensaje de ese sonido aparezca (con la suite cargada puede tardar más que un tiempo fijo).
  const test = async k => { await a.ev(`$('#optSndMsg').textContent = '', document.querySelector('[data-snd-test="${k}"]').click(), true`);
    return (await waitFor(a, `$('#optSndMsg').textContent`, 4000)) || ''; };
  const msgs = [await test('message'), await test('finished'), await test('toast')];
  const plays = JSON.parse(await a.ev('JSON.stringify(__plays)'));
  r.check('▶ Probar reproduce de verdad los tres sonidos configurados', msgs.every(x => x.startsWith('▶')) && JSON.stringify(plays) === JSON.stringify(want), plays.join(', ') + ' | ' + msgs.join(' | '));
  r.check('prefs.json no se reescribió por la sustitución', fs.readFileSync(path.join(s1.am, 'prefs.json'), 'utf8') === prefsBefore);
  r.check('CSP: ningún recurso bloqueado', a.csp.length === 0, a.csp.join(' | '));
  await a.close(); a = null;

  // 2. Claude Code instalado (claude en el PATH) pero nunca usado: ~/.claude existe, sin sesiones.
  const s2 = setup('sin-sesiones', { path: FAKE_PATH });
  fs.mkdirSync(path.join(s2.claudeDir, 'projects'), { recursive: true });
  a = await launch({ profile: path.join(s2.dir, 'perfil'), env: s2.env });
  const empty = JSON.parse(await waitFor(a, `(() => { const e = document.querySelector('#tree [data-claude]'); return e && JSON.stringify({ kind: e.dataset.claude, text: e.textContent }); })()`) || '{}');
  r.check('con Claude Code pero sin sesiones: "Todavía no hay sesiones" y cómo empezar; sin aviso de comando faltante',
    empty.kind === 'empty' && empty.text.includes('Todavía no hay sesiones de Claude Code') && !empty.text.includes('Tampoco se encontró')
    && !(await a.ev(`!!document.querySelector('#home .claude-missing')`)), empty.text);
  await a.close(); a = null;

  // 3. Carpeta de datos que no se puede leer (projects no es una carpeta).
  const s3 = setup('error-lectura', { path: FAKE_PATH });
  fs.mkdirSync(s3.claudeDir, { recursive: true });
  fs.writeFileSync(path.join(s3.claudeDir, 'projects'), 'no es una carpeta');
  a = await launch({ profile: path.join(s3.dir, 'perfil'), env: s3.env });
  const err = JSON.parse(await waitFor(a, `(() => { const e = document.querySelector('#tree [data-claude]'); return e && JSON.stringify({ kind: e.dataset.claude, text: e.textContent }); })()`) || '{}');
  r.check('error de lectura: lo dice con la carpeta y el código, distinto de "sin sesiones"',
    err.kind === 'error' && err.text.includes('No se pudo leer la carpeta de Claude Code') && err.text.includes('ENOTDIR'), err.text);
  await a.close(); a = null;

  // 4. Con sesiones y sonidos predeterminados (sin prefs): un aviso real suena con el incluido; retomar una sesión cuya
  //    carpeta ya no existe lo explica en la terminal.
  const s4 = setup('con-sesiones', { path: FAKE_PATH });
  const gone = path.join(s4.dir, 'carpeta-borrada');
  const id = '44444444-5555-4666-8777-888888888888';
  const pdir = path.join(s4.claudeDir, 'projects', 'C--carpeta-borrada');
  fs.mkdirSync(pdir, { recursive: true });
  fs.mkdirSync(path.join(s4.claudeDir, 'sessions'), { recursive: true });
  const file = path.join(pdir, id + '.jsonl');
  fs.writeFileSync(file, userLine('Pedido de prueba', gone) + assistantLine('Primera respuesta.', 'msg_fr1'));
  a = await launch({ profile: path.join(s4.dir, 'perfil'), env: s4.env });
  await a.ev(HOOK);
  await waitFor(a, `!!document.querySelector('#tree [data-id="${id}"]')`);
  fs.appendFileSync(file, assistantLine('Respuesta nueva.', 'msg_fr2'));
  await a.ev('load()');
  const played = await waitFor(a, `__plays.length && __plays.at(-1)`);
  r.check('aviso real con los predeterminados: suena agentmap-mensaje.wav y no hay avisos de sonido faltante',
    played === 'agentmap-mensaje.wav' && !JSON.parse(await a.ev(toastKeys)).some(k => /^sound-/.test(k)), String(played));
  await a.ev(`openTerm({ session: '${id}', key: '${id}' }, 'Borrada', '${id}'), true`);
  const t4 = await waitFor(a, `(${termText}).includes('ya no existe') && ${termText}`);
  r.check('retomar con la carpeta borrada: la terminal dice que la carpeta ya no existe y cuál es', !!t4 && t4.includes('La carpeta de esta sesión ya no existe')
    && t4.replace(/\s+/g, '').includes(gone.replace(/\s+/g, '')), (t4 || '').trim().split('\n')[0]);
  r.check('no quedó ninguna terminal abierta en el servidor', await a.ev(`fetch('/api/tree').then(x => x.json()).then(j => j.open.length === 0)`));
} catch (err) { r.fail(err); }
if (a?.close) await a.close();
await sleep(500);
cleanup();
process.exit(r.finish());
