// E2E: ocultar sesiones y proyectos, recuperarlos en ⚙ Opciones y borrar los datos propios de Agent Map (UX-04 niveles 1 y 2).
// Datos, preferencias y perfil en una carpeta temporal. Se comprueba que los archivos de Claude no cambian.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { launch, makeFixture, reporter, sleep, tempRoot, assistantLine } from './lib.mjs';

const { root, cleanup } = tempRoot('hide');
const fx = makeFixture(root);
const am = path.join(root, 'agent-map');                  // hace de ~/.agent-map
const env = { CLAUDE_CONFIG_DIR: fx.claude, AGENT_MAP_USAGE_FILE: path.join(am, 'usage.json') };
const PREFS = path.join(am, 'prefs.json');
const S1 = fx.blog, S2 = fx.juego, S3 = fx.tienda;
const TIENDA = 'D:\\Proyectos\\tienda-web';
// Preferencias de una versión anterior (sin "hidden"): nombres, color y fijado.
fs.mkdirSync(am, { recursive: true });
fs.writeFileSync(PREFS, JSON.stringify({ theme: 'xp', labels: { [S1.id]: { name: 'Blog fijado', color: 'blue', pinned: true }, [S2.id]: { name: 'Juego renombrado' } } }));
const profile = path.join(root, 'perfil');
const r = reporter('Ocultar y borrar datos de Agent Map');

/** Huella de toda la carpeta de Claude (contenido y fecha de cada archivo). */
const snap = () => fs.readdirSync(fx.claude, { recursive: true }).sort().map(f => {
  const full = path.join(fx.claude, f), st = fs.statSync(full);
  return st.isFile() ? `${f}:${crypto.createHash('sha1').update(fs.readFileSync(full)).digest('hex')}:${st.mtimeMs}` : f;
}).join('|');
const prefs = () => JSON.parse(fs.readFileSync(PREFS, 'utf8'));

let a;
try {
  a = await launch({ profile, env });
  const TOASTS = `JSON.stringify([...document.querySelectorAll('#toasts .toast:not(.out)')].map(t => t.dataset.toastKey))`;
  const toastKeys = async () => JSON.parse(await a.ev(TOASTS));
  const clear = () => a.ev(`(async () => { for (let i = 0; i < 3; i++) { for (const b of document.querySelectorAll('#toasts .toast-close')) b.click(); await new Promise(r => setTimeout(r, 450)); } return true; })()`);
  const treeIds = async () => JSON.parse(await a.ev(`JSON.stringify([...new Set([...document.querySelectorAll('#tree [data-act="session"]')].map(n => n.dataset.id))])`));
  const projectNames = async () => JSON.parse(await a.ev(`JSON.stringify([...document.querySelectorAll('#tree [data-act="toggle-project"] .label')].map(n => n.textContent))`));
  // Click derecho de verdad (evento contextmenu) y click en una opción del menú.
  const menu = (selector, act) => a.ev(`(() => { const el = ${selector}; if (!el) return 'sin nodo';
    el.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 60, clientY: 60 }));
    const b = document.querySelector('.ctxmenu [data-ctx="${act}"]'); if (!b) return 'sin opción';
    if (b.disabled) return 'deshabilitada'; b.click(); return 'ok'; })()`);
  const sessionEl = id => `document.querySelector('#tree [data-act="session"][data-id="${id}"]')`;
  const projectEl = cwd => `[...document.querySelectorAll('#tree [data-act="toggle-project"]')].find(n => n.dataset.cwd === ${JSON.stringify(cwd)})`;
  const closeModal = () => a.ev(`new Promise(r => { const m = document.querySelector('#modal'); if (!m.open) return r(true);
    m.addEventListener('close', () => setTimeout(() => r(true), 0), { once: true }); m.close(); setTimeout(() => r(false), 5000); })`);
  const confirmWith = value => a.ev(`new Promise(r => { const m = document.querySelector('#modal');
    m.addEventListener('close', () => setTimeout(() => r(true), 0), { once: true }); m.querySelector('button[value="${value}"]').click(); setTimeout(() => r(false), 5000); })`);
  await a.ev('toasts.setDuration(60000), true');
  await a.ev('load()');

  r.check('preferencias anteriores sin "hidden": se ven las 3 sesiones con su nombre', (await treeIds()).length === 3
    && (await a.ev(`${sessionEl(S2.id)}.textContent`)).includes('Juego renombrado'));
  const claude0 = snap();

  // 1. Ocultar una sesión y un proyecto desde el menú contextual
  const m1 = await menu(sessionEl(S2.id), 'hide'); await sleep(400);
  r.check('ocultar sesión: desaparece del árbol, se guarda en prefs.json y avisa dónde recuperarla',
    m1 === 'ok' && !(await treeIds()).includes(S2.id) && JSON.stringify(prefs().hidden.sessions) === JSON.stringify([S2.id])
    && (await toastKeys()).includes('hidden:' + S2.id), m1);
  const m2 = await menu(projectEl(TIENDA), 'hide'); await sleep(400);
  r.check('ocultar proyecto: desaparecen el proyecto y sus sesiones', m2 === 'ok' && !(await projectNames()).includes('tienda-web')
    && !(await treeIds()).includes(S3.id) && prefs().hidden.projects.includes(TIENDA), m2);
  const note = await a.ev(`document.querySelector('#tree [data-act="show-hidden"]')?.textContent || ''`);
  r.check('al pie del árbol: cuántos hay ocultos', /2 ocultos/.test(note), note);
  await a.ev(`state.query = 'renombrado', renderTree(), true`);
  const searchHidden = (await treeIds()).includes(S2.id);
  await a.ev(`state.query = '', renderTree(), true`);
  r.check('la búsqueda no muestra lo oculto', !searchHidden);
  r.check('ocultar no cambia ningún archivo de Claude', snap() === claude0);
  await clear();

  // 2. Avisos: los ocultos no avisan; una sesión visible sí (control)
  fs.appendFileSync(S2.file, assistantLine('respuesta en sesión oculta', 'msg_h_1'));
  fs.appendFileSync(S3.file, assistantLine('respuesta en proyecto oculto', 'msg_h_2'));
  fs.appendFileSync(S1.file, assistantLine('respuesta visible', 'msg_h_3') + assistantLine('otra visible', 'msg_h_4'));
  await a.ev('load()'); await sleep(300);
  let keys = await toastKeys();
  r.check('motor de avisos: nada de lo oculto, sí de lo visible', keys.includes('message:' + S1.id) && !keys.some(k => k.includes(S2.id) || k.includes(S3.id)), keys.join(','));
  await clear();

  // 3. Recuperar el proyecto desde ⚙ Opciones: vuelve con sus sesiones y sin avisos históricos
  fs.appendFileSync(S3.file, assistantLine('otra en proyecto oculto', 'msg_h_5'));
  await a.ev('load()');
  const claude2 = snap();
  await a.ev('showOptions(), true'); await sleep(300);
  const rows = JSON.parse(await a.ev(`JSON.stringify([...document.querySelectorAll('#optHidden .hidden-row')].map(x => x.textContent.replace(/\\s+/g, ' ').trim()))`));
  r.check('⚙ Opciones › Ocultos: lista el proyecto y la sesión con sus nombres', rows.length === 2 && rows.some(x => x.includes('tienda-web'))
    && rows.some(x => x.includes('Juego renombrado')), rows.join(' | '));
  await a.ev(`document.querySelector('#optHidden [data-unhide="project"]').click(), true`); await sleep(400);
  await closeModal();
  await a.ev('load()'); await sleep(300);
  keys = await toastKeys();
  r.check('recuperar proyecto: vuelven sus sesiones, sin avisos de lo que llegó mientras estaba oculto',
    (await projectNames()).includes('tienda-web') && (await treeIds()).includes(S3.id) && !keys.some(k => k.includes(S3.id))
    && prefs().hidden.projects.length === 0, keys.join(','));

  // 4. Reinicio: lo oculto sigue oculto
  r.check('CSP: ningún recurso bloqueado en todo lo anterior', a.csp.length === 0, a.csp.join(' | ').slice(0, 300));
  await a.close();
  a = await launch({ profile, env });
  await a.ev('load()');
  r.check('tras reiniciar: la sesión sigue oculta y el proyecto recuperado sigue visible',
    !(await treeIds()).includes(S2.id) && (await treeIds()).includes(S3.id), JSON.stringify(prefs().hidden));

  // 5. Recuperar la sesión: igual que antes (mismo nombre)
  await a.ev('showOptions(), true'); await sleep(300);
  await a.ev(`document.querySelector('#optHidden [data-unhide="session"]').click(), true`); await sleep(400);
  const empty = await a.ev(`document.querySelector('#optHidden').textContent`);
  await closeModal();
  r.check('recuperar sesión: reaparece con su nombre y estado original; la lista queda vacía',
    (await treeIds()).includes(S2.id) && (await a.ev(`${sessionEl(S2.id)}.textContent`)).includes('Juego renombrado')
    && JSON.stringify(prefs().hidden) === '{"sessions":[],"projects":[]}' && /No hay nada oculto/.test(empty));

  const claudeRecovered = snap(); // tras recuperar proyecto y sesión y reiniciar
  // 6. Borrar datos de Agent Map de una sesión: confirmación, cancelar no cambia nada, aceptar borra solo lo propio
  fs.appendFileSync(S1.file, assistantLine('sin leer 1', 'msg_h_6') + assistantLine('sin leer 2', 'msg_h_7'));
  await a.ev('load()'); await clear();
  const unreadBefore = await a.ev(`${sessionEl(S1.id)}.querySelector('.unread-badge')?.textContent || ''`);
  const claude3 = snap();
  await menu(sessionEl(S1.id), 'forget'); await sleep(300);
  const text = await a.ev(`document.querySelector('#modal').open && document.querySelector('#modalBody').textContent`);
  r.check('borrar datos: pide confirmación y explica qué borra y qué no', typeof text === 'string' && /nombre personalizado/.test(text)
    && /color/.test(text) && /fijada/.test(text) && /leído/.test(text) && /No se toca nada de Claude Code/.test(text), String(text).slice(0, 120));
  await confirmWith('cancel'); await sleep(300);
  r.check('cancelar: no borra nada', prefs().labels[S1.id]?.name === 'Blog fijado' && (await a.ev(`${sessionEl(S1.id)}.querySelector('.unread-badge')?.textContent || ''`)) === unreadBefore);
  await menu(sessionEl(S1.id), 'forget'); await sleep(300);
  await confirmWith('ok'); await sleep(500);
  const after = JSON.parse(await a.ev(`JSON.stringify({ label: ${sessionEl(S1.id)}.querySelector('.label').textContent, badge: !!${sessionEl(S1.id)}.querySelector('.unread-badge'),
    tagged: ${sessionEl(S1.id)}.classList.contains('tagged'), pinnedSection: [...document.querySelectorAll('#tree .section')].some(s => /Fijadas/.test(s.textContent)),
    seen: JSON.parse(localStorage.getItem('agentmap.seen'))[${JSON.stringify(S1.id)}], msgs: findSession(${JSON.stringify(S1.id)}).claudeMsgs })`));
  r.check('aceptar: sin nombre, color ni fijado, y sin no leídos (había ' + unreadBefore + ')', unreadBefore === '2' && prefs().labels[S1.id] === undefined
    && after.label.trim() === 'Migrar el blog a Markdown' && !after.badge && !after.tagged && !after.pinnedSection && after.seen === after.msgs, JSON.stringify(after));
  r.check('las etiquetas de otras sesiones no se tocan', prefs().labels[S2.id]?.name === 'Juego renombrado');

  // 7. Borrar datos de un proyecto entero
  const m3 = await menu(projectEl(S2.cwd), 'forget'); await sleep(300);
  await confirmWith('ok'); await sleep(500);
  r.check('borrar datos del proyecto: quita el nombre de su sesión', m3 === 'ok' && prefs().labels[S2.id] === undefined
    && (await a.ev(`${sessionEl(S2.id)}.textContent`)).includes('Salto con coyote time'), m3);
  r.check('ocultar, recuperar y borrar datos no cambian ningún archivo de Claude (JSONL, history, .claude.json)',
    claudeRecovered === claude2 && snap() === claude3);
} catch (err) { r.fail(err); }
if (a?.close) await a.close();
await sleep(300);
cleanup();
process.exit(r.finish());
