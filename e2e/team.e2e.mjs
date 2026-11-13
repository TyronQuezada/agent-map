// E2E del modo equipo: cada terminal nueva con su propia sesión (conversaciones que no se cruzan), la pestaña Equipo
// visible mientras el equipo esté abierto, la barra de tareas, la oficina en pantalla completa sin cerrarse sola,
// agentes trabajando con el formato actual de Claude Code (sin "finished" mientras trabajan) y su historial desde
// la oficina (click en el personaje o en "Ver historial" del globo). Datos aislados y un `claude` falso.
import fs from 'node:fs';
import path from 'node:path';
import { APP, launch, makeFixture, reporter, sleep, tempRoot, userLine, assistantLine } from './lib.mjs';

const { createTeam } = await import(new URL('lib/team.js', 'file:///' + APP.replace(/\\/g, '/') + '/').href);
const { root, cleanup } = tempRoot('team');
const fx = makeFixture(root);
const r = reporter('Modo equipo (sesiones propias, pestaña, barra de tareas, pantalla completa e historial)');
const L = o => JSON.stringify(o) + '\n';
const pathKey = Object.keys(process.env).find(k => k.toUpperCase() === 'PATH') || 'PATH';
const bin = path.join(root, 'bin');
fs.mkdirSync(bin, { recursive: true });
fs.writeFileSync(path.join(bin, 'fake.mjs'), "process.stdout.write('AGENTMAP-FAKE-CLAUDE ' + process.argv.slice(2).join(' ')); setInterval(() => {}, 1e9);");
fs.writeFileSync(path.join(bin, 'claude.cmd'), `@echo off\r\n"${process.execPath}" "%~dp0fake.mjs" %*\r\n`);

const teamDir = path.join(root, 'juego-equipo');
const otherDir = path.join(root, 'otro-proyecto');
for (const d of [teamDir, otherDir]) fs.mkdirSync(d, { recursive: true });
createTeam(teamDir, { boss: { name: 'Jefa' }, agents: [{ name: 'Programador', role: 'Código' }, { name: 'Artista', role: 'Sprites' }] });
const keyOf = d => path.join(fx.claude, 'projects', path.resolve(d).replace(/[^a-zA-Z0-9]/g, '-'));
const ts = new Date().toISOString();
// Lo que Claude Code escribiría para la sesión `sid` (abierta con --session-id) en la carpeta `dir`.
function session(dir, sid, said, pid) {
  fs.mkdirSync(keyOf(dir), { recursive: true });
  fs.writeFileSync(path.join(keyOf(dir), sid + '.jsonl'), userLine('Pedido de ' + said, dir) + assistantLine(said, 'msg_' + sid.slice(0, 8))
    + (dir === teamDir ? L({ type: 'assistant', timestamp: ts, message: { id: 'msg_enc', content: [{ type: 'tool_use', name: 'Agent', input: { subagent_type: 'programador', description: 'enemigos' } }] } }) : ''));
  if (pid) fs.writeFileSync(path.join(fx.claude, 'sessions', pid + '.json'), JSON.stringify({ pid, sessionId: sid, cwd: dir, status: 'busy', statusUpdatedAt: 1 }));
}
function agentRuns(sid) {
  const sub = path.join(keyOf(teamDir), sid, 'subagents');
  fs.mkdirSync(sub, { recursive: true });
  const write = f => L({ type: 'assistant', timestamp: ts, message: { id: 'm' + f, content: [{ type: 'tool_use', name: 'Write', input: { file_path: path.join(teamDir, f) } }] } });
  fs.writeFileSync(path.join(sub, 'agent-old.meta.json'), JSON.stringify({ agentType: 'programador', description: 'menú principal', finished: true }));
  fs.writeFileSync(path.join(sub, 'agent-old.jsonl'), write('menu.gd'));
  const past = new Date(Date.now() - 3600_000); fs.utimesSync(path.join(sub, 'agent-old.meta.json'), past, past);
  fs.writeFileSync(path.join(sub, 'agent-new.meta.json'), JSON.stringify({ agentType: 'programador', description: 'enemigos' })); // así, mientras trabaja
  fs.writeFileSync(path.join(sub, 'agent-new.jsonl'), write('enemigo.gd'));
}

const env = { CLAUDE_CONFIG_DIR: fx.claude, AGENT_MAP_USAGE_FILE: path.join(root, 'am', 'usage.json'), [pathKey]: bin + path.delimiter + process.env[pathKey] };
const waitFor = async (a, expr, ms = 8000) => { const t = Date.now(); let v; while (!(v = await a.ev(expr)) && Date.now() - t < ms) await sleep(150); return v; };
const tabTeam = `!document.querySelector('#tabTeam').hidden`;
const termIn = dir => `(() => { const e = [...state.terms].filter(([k, t]) => t.cwd === ${JSON.stringify(dir)} && !k.startsWith('tmp-') && t.ws?.readyState === 1 && t.sessionId);
  return e.length ? JSON.stringify(e.map(([k, t]) => [k, t.sessionId])) : ''; })()`;
const convoOf = sid => `document.querySelector('#convo')?.dataset.id === '${sid}' && document.querySelector('#convo .msg') && document.querySelector('#convo').textContent`;

let a;
try {
  a = await launch({ profile: path.join(root, 'perfil'), env });

  // 1. Terminales nuevas: cada una con su propia sesión (--session-id), también dos en la misma carpeta.
  await a.ev(`openTerm({ newIn: ${JSON.stringify(teamDir)} }, 'Nueva · juego-equipo', null), true`);
  const [[teamKey, SID]] = JSON.parse(await waitFor(a, termIn(teamDir)));
  r.check('la terminal nueva arranca con su propio id de sesión (claude --session-id)', /^[0-9a-f-]{36}$/.test(SID)
    && (await waitFor(a, `(() => { const t = state.terms.get('${teamKey}'); const b = t.term.buffer.active; let s = ''; for (let i = 0; i < b.length; i++) s += b.getLine(i).translateToString(true); return s.includes('--session-id ${SID}'); })()`)));
  session(teamDir, SID, 'Repartí el trabajo entre el equipo.', process.pid);
  agentRuns(SID);
  await a.ev('load()');
  r.check('terminal del equipo: pestaña Equipo visible', !!(await waitFor(a, tabTeam)));
  const convo = await waitFor(a, convoOf(SID));
  r.check('modo equipo: el panel derecho muestra la conversación del jefe, junto a la oficina',
    !!convo && convo.includes('Repartí el trabajo') && await a.ev(`!!document.querySelector('#officeSlot canvas')`), String(convo).slice(0, 80));

  await a.ev(`openTerm({ newIn: ${JSON.stringify(otherDir)} }, 'Nueva · otro', null), true`);
  const [[otherKey, OID]] = JSON.parse(await waitFor(a, termIn(otherDir)));
  session(otherDir, OID, 'Hice el login del otro proyecto.', null);
  await a.ev(`openTerm({ newIn: ${JSON.stringify(teamDir)} }, 'Nueva · juego-equipo 2', null), true`);
  const twice = JSON.parse(await waitFor(a, `(${termIn(teamDir)}).split('],[').length > 1 && ${termIn(teamDir)}`));
  const [secondKey, SID2] = twice.find(([k]) => k !== teamKey);
  session(teamDir, SID2, 'Soy la segunda sesión de la misma carpeta.', null);
  await a.ev('load()'); await sleep(300);
  const seen = {};
  for (const [k, id, want] of [[teamKey, SID, 'Repartí'], [otherKey, OID, 'login'], [secondKey, SID2, 'segunda'], [teamKey, SID, 'Repartí']]) {
    await a.ev(`showTerm('${k}'), true`);
    const c = await waitFor(a, convoOf(id), 5000);
    seen[k + id] = !!c && c.includes(want);
  }
  r.check('cada terminal muestra su propia conversación (también dos sesiones en la misma carpeta)', Object.values(seen).every(Boolean) && SID !== SID2, JSON.stringify(seen));

  // 2. La pestaña Equipo sigue visible al mirar una sesión normal; la oficina va solo en la terminal del equipo.
  await a.ev(`showTerm('${otherKey}'), true`); await sleep(2000);
  r.check('en una sesión normal la pestaña Equipo sigue visible (el equipo sigue abierto)', await a.ev(tabTeam)
    && await a.ev(`!document.querySelector('#officeSlot') && document.querySelector('#convo')?.dataset.id === '${OID}'`));
  await a.ev(`setLeftTab('team'), true`);
  r.check('desde la sesión normal se puede abrir la pestaña Equipo y ver al equipo', await a.ev(`!$('#team').hidden && !!document.querySelector('#team [data-member="programador"]')`));
  await a.ev(`showTerm('${teamKey}'), true`);
  r.check('al volver a la terminal del equipo está la oficina', !!(await waitFor(a, `!!document.querySelector('#officeSlot canvas')`, 4000)));

  // 3. Barra de tareas: desde Inicio, click en una terminal abierta la muestra (no se queda en Inicio).
  await a.ev(`document.querySelector('#startBtn').click(), true`);
  const home = await a.ev(`!$('#home').hidden && state.active === null`);
  await a.ev(`document.querySelector('#tasks [data-key="${otherKey}"] span').click(), true`); await sleep(300);
  r.check('barra de tareas: click en una terminal abierta la muestra, no vuelve a Inicio', home
    && await a.ev(`state.active === '${otherKey}' && $('#home').hidden && !state.terms.get('${otherKey}').el.hidden && document.querySelector('#convo')?.dataset.id === '${OID}'`));
  await a.ev(`document.querySelector('#tasks [data-key="${teamKey}"] span').click(), true`); await sleep(300);
  r.check('barra de tareas: y vuelve a la del equipo con su oficina', await a.ev(`state.active === '${teamKey}' && $('#home').hidden`)
    && !!(await waitFor(a, `!!document.querySelector('#officeSlot canvas')`, 4000)));

  // 4. Elegir la sesión del jefe en el árbol: va a su terminal (sin aviso de "otra terminal").
  await a.ev(`showTerm('${otherKey}'), true`);
  await a.ev(`selectSession('${SID}'), true`);
  r.check('click en la sesión del jefe en el árbol: abre su terminal (sin aviso de "otra terminal")',
    !!(await waitFor(a, `state.active === '${teamKey}' && $('#home').hidden`, 4000)) && !(await a.ev(`!!document.querySelector('#home .warn')`)));
  r.check('el árbol marca la sesión del jefe como abierta en Agent Map', await a.ev(`!!document.querySelector('#tree [data-id="${SID}"] .dot.here')`));

  // 5. Agente trabajando (sin "finished") y su historial desde la oficina.
  const working = await waitFor(a, `document.querySelector('#team [data-member="programador"]')?.classList.contains('working')`);
  r.check('el agente que trabaja aparece trabajando (ficha y oficina), no dormido', !!working
    && await a.ev(`/💻/.test(document.querySelector('#officeLegend').textContent.split('Programador')[1] || '')`));
  // Un píxel de pantalla (entero, como un click real) sobre el Programador que nadie tape: la jefa puede pasar
  // caminando delante y el click elige al de adelante. Se busca y se despacha en la misma evaluación.
  const at = type => `(() => { const cv = _office.canvas, rc = cv.getBoundingClientRect(), c = _office.chars[1];
    const cx = c.x * rc.width / cv.width + rc.left, cy = c.y * rc.height / cv.height + rc.top;
    for (let dy = -30; dy <= 2; dy++) for (let dx = -20; dx <= 20; dx++) {
      const x = Math.round(cx + dx), y = Math.round(cy + dy);
      if (_office.hit((x - rc.left) * cv.width / rc.width, (y - rc.top) * cv.height / rc.height) === 1)
        return cv.dispatchEvent(new MouseEvent('${type}', { clientX: x, clientY: y, bubbles: true }));
    }
    return false; })()`;
  const history = () => a.ev(`JSON.stringify({ tab: state.leftTab, sel: state.teamSel, head: document.querySelector('.feed-head')?.textContent || '',
    tasks: [...document.querySelectorAll('#feed .ev.task .ev-t')].map(e => e.textContent), items: [...document.querySelectorAll('#feed .ev .ev-t')].map(e => e.textContent) })`).then(JSON.parse);
  const isHistory = h => h.tab === 'team' && h.sel === 'programador' && /Historial de Programador/.test(h.head) && /en vivo/.test(h.head)
    && JSON.stringify(h.tasks) === JSON.stringify(['Tarea: menú principal', 'Tarea: enemigos'])
    && h.items.indexOf('Escribe menu.gd') < h.items.indexOf('Tarea: enemigos') && h.items.at(-1) === 'Escribe enemigo.gd';
  await a.ev(at('mousemove')); await sleep(300);
  const bubble = `[...document.querySelectorAll('.thought')].find(t => !t.hidden && t.classList.contains('pickable'))`;
  const hover = JSON.parse(await a.ev(`JSON.stringify({ cursor: _office.canvas.style.cursor, text: ${bubble}?.textContent || '', btn: !!${bubble}?.querySelector('.thought-btn:not([hidden])') })`));
  r.check('al pasar el mouse: mano, pista de que está en vivo y botón "Ver historial"', hover.cursor === 'pointer' && /en vivo · click para verlo/.test(hover.text) && hover.btn, JSON.stringify(hover));
  // El globo no se cierra al salir del personaje hacia el globo: da tiempo a apretar "Ver historial".
  await a.ev(`setLeftTab('tree'), true`);
  await a.ev(`_office.canvas.dispatchEvent(new MouseEvent('mouseleave')), true`); await sleep(300);
  const still = await a.ev(`!!${bubble}`);
  await a.ev(`(() => { const b = ${bubble}; b.dispatchEvent(new MouseEvent('mouseenter')); return true; })()`); await sleep(1200);
  const kept = await a.ev(`!!${bubble}`);
  await a.ev(`${bubble}.querySelector('.thought-btn').click(), true`); await sleep(300);
  const viaBtn = await history();
  r.check('el globo sigue abierto al ir hacia él y "Ver historial" abre su historial', still && kept && isHistory(viaBtn), JSON.stringify({ still, kept, ...viaBtn }));
  await a.ev(`setLeftTab('tree'), true`); await sleep(200);
  await a.ev(at('click')); await sleep(400); // posición actual: el panel se reacomoda al cambiar de pestaña
  const viaClick = await history();
  r.check('click en su personaje: abre su historial (tareas en orden, cada una con lo que hizo) y marca en vivo', isHistory(viaClick), JSON.stringify(viaClick));

  // 6. Pantalla completa de la oficina: no se cierra sola con las recargas (antes se cerraba cada 15 s).
  await a.ev(`officeWrap().requestFullscreen().then(() => true)`); await sleep(500);
  const full = await a.ev(`document.fullscreenElement === _officeWrap`);
  await a.ev('load()'); await a.ev('renderAll(), renderStats(), true'); await sleep(2500); // recarga + varias consultas del equipo
  const stays = await a.ev(`document.fullscreenElement === _officeWrap`);
  await a.ev(`document.exitFullscreen().then(() => true)`); await sleep(500);
  r.check('la oficina en pantalla completa no se cierra sola con las recargas', full && stays && await a.ev(`!!document.querySelector('#officeSlot canvas') && !document.fullscreenElement`), JSON.stringify({ full, stays }));
  r.check('CSP: ningún recurso bloqueado', a.csp.length === 0, a.csp.join(' | '));
} catch (err) { r.fail(err); }
if (a?.close) await a.close();
await sleep(500);
cleanup();
process.exit(r.finish());
