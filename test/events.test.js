// Motor de eventos (public/events.js): script clásico del navegador, cargado aquí con node:vm sin DOM.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const ctx = {};
vm.runInNewContext(fs.readFileSync(new URL('../public/events.js', import.meta.url), 'utf8'), ctx);
const { diff } = ctx.AgentMapEvents;
const NOW = 1794370000000;
const run = (a, b, o) => JSON.parse(JSON.stringify(diff(a, b, { now: NOW, ...o }))); // objetos del otro contexto -> planos

const live = (status, statusUpdatedAt = null, pid = 100, extra = {}) => ({ pid, status, statusUpdatedAt, ...extra });
const sess = (id, claudeMsgs, l = null, extra = {}) => ({ id, title: '', aiTitle: 'Título ' + id, firstPrompt: 'SECRETO prompt', claudeMsgs, live: l, subagents: [], ...extra });
const tree = (...sessions) => ({ projects: [{ key: 'D--p', cwd: 'D:\\p', name: 'p', sessions }], open: [] });
const types = evs => evs.map(e => e.type);

test('1 carga inicial (anterior null, undefined o sin projects): sin eventos históricos', () => {
  const t = tree(sess('a', 5, live('busy')), sess('b', 2));
  assert.deepEqual(run(null, t), []);
  assert.deepEqual(run(undefined, t), []);
  assert.deepEqual(run({}, t), []); // sin lista projects: no es un snapshot válido
  assert.deepEqual(run(null, null), []);
});

test('16 snapshots vacíos: un anterior válido con cero sesiones sirve de base', () => {
  const empty = { projects: [] };
  assert.deepEqual(run(empty, { projects: [] }), []);
  assert.deepEqual(run(empty, tree(sess('a', 5, live('busy')))).map(e => [e.type, e.key]), [['session-new', 'session-new:a']]);
  assert.deepEqual(run(empty, tree(sess('a', 5), sess('b', 2))).map(e => [e.type, e.key]), [['session-new', 'session-new:a'], ['session-new', 'session-new:b']]);
  // el actual vacío o ausente no genera eventos (las sesiones que desaparecen no son "cerradas")
  const t = tree(sess('a', 5, live('busy')));
  assert.deepEqual(run(t, null), []);
  assert.deepEqual(run(t, empty), []);
});

test('2 mensaje nuevo: evento completo y sin contenido privado', () => {
  const evs = run(tree(sess('a', 1)), tree(sess('a', 2)));
  assert.deepEqual(evs, [{ type: 'message', key: 'message:a:2', sessionId: 'a', projectId: 'D--p', sessionName: 'Título a', timestamp: NOW, count: 1 }]);
  assert.ok(!JSON.stringify(evs).includes('SECRETO'));
});

test('3 varios mensajes nuevos: un solo evento con count', () => {
  assert.deepEqual(run(tree(sess('a', 1)), tree(sess('a', 4))).map(e => [e.type, e.count, e.key]), [['message', 3, 'message:a:4']]);
});

test('4 contador igual y 5 contador decreciente: sin eventos', () => {
  assert.deepEqual(run(tree(sess('a', 3)), tree(sess('a', 3))), []);
  assert.deepEqual(run(tree(sess('a', 3)), tree(sess('a', 1))), []);
  assert.deepEqual(run(tree(sess('a', null)), tree(sess('a', 2))), []); // contador ausente: no se adivina
});

test('6 busy -> idle (mismo pid): finished', () => {
  const evs = run(tree(sess('a', 2, live('busy', 10))), tree(sess('a', 2, live('idle', 20))));
  assert.deepEqual(evs.map(e => [e.type, e.key]), [['finished', 'finished:a:100:20']]);
});

test('7 busy -> waiting: waiting y nunca finished; waitingFor solo si es un rótulo seguro', () => {
  let evs = run(tree(sess('a', 2, live('busy', 10))), tree(sess('a', 2, live('waiting', 20, 100, { waitingFor: 'input needed' }))));
  assert.deepEqual(evs.map(e => [e.type, e.key, e.waitingFor]), [['waiting', 'waiting:a:100:20', 'input needed']]);
  for (const bad of ['<img src=x onerror=alert(1)>', 'x'.repeat(80), 'C:\\Users\\alguien\\secreto.txt', 42]) {
    evs = run(tree(sess('a', 2, live('busy', 10))), tree(sess('a', 2, live('waiting', 20, 100, { waitingFor: bad }))));
    assert.deepEqual(types(evs), ['waiting']);
    assert.equal('waitingFor' in evs[0], false, String(bad));
  }
});

test('8 waiting -> busy: sin eventos', () => {
  assert.deepEqual(run(tree(sess('a', 2, live('waiting', 10))), tree(sess('a', 2, live('busy', 20)))), []);
});

test('9 ejecución corta idle -> idle con timestamp y mensajes mayores: message + finished', () => {
  const evs = run(tree(sess('a', 2, live('idle', 10))), tree(sess('a', 3, live('idle', 20))));
  assert.deepEqual(evs.map(e => e.key), ['message:a:3', 'finished:a:100:20']);
});

test('10 idle -> idle con timestamp mayor pero sin mensajes: no finaliza', () => {
  assert.deepEqual(run(tree(sess('a', 2, live('idle', 10))), tree(sess('a', 2, live('idle', 20)))), []);
  // y mensajes nuevos con el mismo timestamp: solo message
  assert.deepEqual(types(run(tree(sess('a', 2, live('idle', 10))), tree(sess('a', 3, live('idle', 10))))), ['message']);
});

test('11 pid distinto: otra instancia, no se comparan estados ni timestamps', () => {
  assert.deepEqual(run(tree(sess('a', 2, live('busy', 10, 100))), tree(sess('a', 2, live('idle', 20, 200)))), []);
  assert.deepEqual(run(tree(sess('a', 2, live('busy', 10, 100))), tree(sess('a', 2, live('waiting', 20, 200)))), []);
  assert.deepEqual(types(run(tree(sess('a', 2, live('idle', 10, 100))), tree(sess('a', 5, live('idle', 20, 200))))), ['message']);
});

test('12 statusUpdatedAt ausente: valen las transiciones vistas, no la ejecución corta', () => {
  assert.deepEqual(run(tree(sess('a', 2, live('busy'))), tree(sess('a', 2, live('idle')))).map(e => e.key), ['finished:a:100:m2']);
  assert.deepEqual(types(run(tree(sess('a', 2, live('idle'))), tree(sess('a', 3, live('idle'))))), ['message']);
  assert.deepEqual(types(run(tree(sess('a', 2, live('idle', 10))), tree(sess('a', 3, live('idle'))))), ['message']);
});

test('13 sesión nueva: solo session-new (sin message por su historial)', () => {
  const evs = run(tree(sess('a', 1)), tree(sess('a', 1), sess('b', 7, live('busy'))));
  assert.deepEqual(evs.map(e => [e.type, e.key, e.sessionId]), [['session-new', 'session-new:b', 'b']]);
});

test('14 sesión cerrada: viva -> sin proceso', () => {
  const evs = run(tree(sess('a', 2, live('idle', 10))), tree(sess('a', 2, null)));
  assert.deepEqual(evs.map(e => [e.type, e.key]), [['session-closed', 'session-closed:a:100:10']]);
  // cerró con respuestas nuevas: message + session-closed, sin finished
  assert.deepEqual(types(run(tree(sess('a', 2, live('busy', 10))), tree(sess('a', 3, null)))), ['message', 'session-closed']);
});

test('15 sesión histórica que sigue en el árbol, o que desaparece: sin eventos', () => {
  assert.deepEqual(run(tree(sess('a', 2), sess('b', 1)), tree(sess('a', 2), sess('b', 1))), []);
  assert.deepEqual(run(tree(sess('a', 2), sess('b', 1, live('idle'))), tree(sess('a', 2))), []); // archivo borrado: no es "cerrada"
});

test('17 subagentes: cambios en subagents no generan eventos de sesión', () => {
  const sub = finished => [{ id: 'agent-1', type: 'programador', description: 'tarea privada', finished }];
  assert.deepEqual(run(tree(sess('a', 2, null, { subagents: sub(false) })), tree(sess('a', 2, null, { subagents: sub(true) }))), []);
});

test('18 los snapshots originales no se modifican', () => {
  const deepFreeze = o => { if (o && typeof o === 'object') { Object.values(o).forEach(deepFreeze); Object.freeze(o); } return o; };
  const a = tree(sess('a', 1, live('busy', 10)), sess('b', 1, live('idle', 5)));
  const b = tree(sess('a', 3, live('idle', 20)), sess('c', 1));
  const copyA = structuredClone(a), copyB = structuredClone(b);
  deepFreeze(a); deepFreeze(b);
  assert.doesNotThrow(() => diff(a, b, { now: NOW })); // en modo estricto, escribir en un objeto congelado lanzaría
  assert.deepEqual(a, copyA);
  assert.deepEqual(b, copyB);
});

test('estados desconocidos o shell no producen finished ni waiting', () => {
  assert.deepEqual(run(tree(sess('a', 2, live('rarisimo', 10))), tree(sess('a', 2, live('idle', 20)))), []);
  assert.deepEqual(run(tree(sess('a', 2, live('busy', 10))), tree(sess('a', 2, live('rarisimo', 20)))), []);
  assert.deepEqual(run(tree(sess('a', 2, live('shell', 10))), tree(sess('a', 2, live('idle', 20)))), []);
});

test('waiting -> idle: finished solo con respuestas nuevas', () => {
  assert.deepEqual(run(tree(sess('a', 2, live('waiting', 10))), tree(sess('a', 2, live('idle', 20)))), []);
  assert.deepEqual(types(run(tree(sess('a', 2, live('waiting', 10))), tree(sess('a', 3, live('idle', 20))))), ['message', 'finished']);
});

test('sin duplicados: id repetido en dos proyectos cuenta una vez; mismo cambio = misma key', () => {
  const dup = s => ({ projects: [{ key: 'P1', sessions: [s] }, { key: 'P2', sessions: [structuredClone(s)] }] });
  const evs = run(dup(sess('a', 1, live('busy', 1))), dup(sess('a', 2, live('idle', 2))));
  assert.deepEqual(evs.map(e => [e.key, e.projectId]), [['message:a:2', 'P1'], ['finished:a:100:2', 'P1']]);
  const again = run(dup(sess('a', 1, live('busy', 1))), dup(sess('a', 2, live('idle', 2))));
  assert.deepEqual(again.map(e => e.key), evs.map(e => e.key)); // keys estables para deduplicar entre llamadas
});

test('nameOf permite el nombre de Agent Map; sin título no cae al prompt', () => {
  assert.equal(run(tree(sess('a', 1)), tree(sess('a', 2)), { nameOf: s => 'Mi nombre ' + s.id })[0].sessionName, 'Mi nombre a');
  assert.equal(run(tree(sess('a', 1, null, { aiTitle: '' })), tree(sess('a', 2, null, { aiTitle: '' })))[0].sessionName, null);
});

// ---------- createTracker: lo que usa load() entre cargas de /api/tree ----------
const { createTracker } = ctx.AgentMapEvents;
const upd = (tr, snap) => JSON.parse(JSON.stringify(tr.update(snap)));

test('tracker: la primera carga solo fija la referencia; después avisa cada tipo de evento', () => {
  const tr = createTracker({ now: () => NOW });
  assert.deepEqual(upd(tr, tree(sess('a', 5, live('busy', 1)), sess('b', 1, live('busy', 1)), sess('c', 1, live('idle', 1)))), []);
  const evs = upd(tr, tree(sess('a', 6, live('idle', 2)), sess('b', 1, live('waiting', 2)), sess('c', 1, null), sess('d', 1)));
  assert.deepEqual(evs.map(e => e.key).sort(), ['finished:a:100:2', 'message:a:6', 'session-closed:c:100:1', 'session-new:d', 'waiting:b:100:2']);
  assert.ok(evs.every(e => e.timestamp === NOW));
});

test('tracker: snapshot vacío válido como referencia, luego sesiones nuevas', () => {
  const tr = createTracker();
  assert.deepEqual(upd(tr, { projects: [] }), []);
  assert.deepEqual(upd(tr, tree(sess('a', 1), sess('b', 1))).map(e => e.key), ['session-new:a', 'session-new:b']);
});

test('tracker: una respuesta inválida (error de red) no reemplaza la última referencia correcta', () => {
  const tr = createTracker();
  upd(tr, tree(sess('a', 1)));
  for (const bad of [null, undefined, {}, { projects: 'x' }]) assert.deepEqual(upd(tr, bad), []);
  assert.deepEqual(upd(tr, tree(sess('a', 3))).map(e => [e.key, e.count]), [['message:a:3', 2]]); // compara contra la última válida
});

test('tracker: el mismo evento no se entrega dos veces', () => {
  const tr = createTracker();
  upd(tr, tree(sess('a', 1)));
  assert.deepEqual(upd(tr, tree(sess('a', 2))).map(e => e.key), ['message:a:2']);
  assert.deepEqual(upd(tr, tree(sess('a', 2))), []);          // misma respuesta otra vez (⟳)
  assert.deepEqual(upd(tr, tree(sess('a', 1))), []);          // el contador bajó (archivo releído)
  assert.deepEqual(upd(tr, tree(sess('a', 2))), []);          // vuelve a 2: message:a:2 ya se entregó
  assert.deepEqual(upd(tr, tree(sess('a', 3))).map(e => e.key), ['message:a:3']);
});

test('tracker: guarda su propia copia; cambiar el snapshot después no altera la comparación', () => {
  const tr = createTracker();
  const first = tree(sess('a', 1, live('busy', 1)));
  upd(tr, first);
  first.projects[0].sessions[0].claudeMsgs = 9;               // la página modifica sus datos
  first.projects[0].sessions[0].live.status = 'idle';
  assert.deepEqual(upd(tr, tree(sess('a', 2, live('idle', 2)))).map(e => e.key), ['message:a:2', 'finished:a:100:2']);
});

test('tracker: la misma sesión puede cerrarse otra vez con un pid reutilizado (no la tapa el cierre anterior)', () => {
  const tr = createTracker();
  upd(tr, tree(sess('a', 1, live('idle', 10))));
  assert.deepEqual(upd(tr, tree(sess('a', 1, null))).map(e => e.key), ['session-closed:a:100:10']);
  upd(tr, tree(sess('a', 1, live('busy', 20))));
  assert.deepEqual(upd(tr, tree(sess('a', 1, null))).map(e => e.key), ['session-closed:a:100:20']);
});
