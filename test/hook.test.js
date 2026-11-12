// Hook oficial de Claude Code (E1): agentmap-hook, registro en ~/.agent-map/events, estado derivado, combinación con
// sessions/*.json, instalación explícita por proyecto y su integración con /api/events y /api/tree.
// Carpetas temporales propias: las variables se fijan ANTES de importar (cada archivo de test corre en su proceso).
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentmap-hook-'));
after(() => fs.rmSync(dir, { recursive: true, force: true }));
process.env.AGENT_MAP_USAGE_FILE = path.join(dir, 'am', 'usage.json');
process.env.CLAUDE_CONFIG_DIR = path.join(dir, 'claude');
fs.mkdirSync(path.join(dir, 'claude', 'sessions'), { recursive: true });
const { toRecord, HOOK_EVENTS } = await import('../lib/agentmap-hook.js');
const hooks = await import('../lib/hooks.js');
const { HOOK_FILE, EVENTS_DIR, ensureHookFile, applyEvent, hookStates, projectHook, setProjectHook, withHook, withoutHook, hookCommand } = hooks;
const { mergeHooks } = await import('../lib/scan.js');

const S = '11111111-2222-4333-8444-555555555555', S2 = '66666666-7777-4888-9999-aaaaaaaaaaaa';
const base = (event, extra = {}) => ({ session_id: S, transcript_path: 'C:\\x\\t.jsonl', cwd: 'D:\\Proyectos\\demo', hook_event_name: event, permission_mode: 'default', ...extra });

/** Ejecuta el hook copiado como lo hace Claude Code: JSON por stdin. Devuelve { code, stdout, stderr }. */
function runHook(input, env = {}) {
  return new Promise((resolve, reject) => {
    const p = spawn(process.execPath, [HOOK_FILE], { env: { ...process.env, ...env }, windowsHide: true });
    let stdout = '', stderr = '';
    p.stdout.on('data', d => { stdout += d; });
    p.stderr.on('data', d => { stderr += d; });
    p.on('error', reject);
    p.on('close', code => resolve({ code, stdout, stderr }));
    p.stdin.end(typeof input === 'string' ? input : JSON.stringify(input));
  });
}
const lines = id => { try { return fs.readFileSync(path.join(EVENTS_DIR, id + '.jsonl'), 'utf8').split('\n').filter(Boolean); } catch { return []; } };

test('toRecord: solo metadatos; nunca prompt, comando, contenido, salida ni texto del aviso', () => {
  const raw = (p) => JSON.stringify(p);
  const pre = base('PreToolUse', { tool_name: 'Bash', tool_use_id: 'toolu_1', tool_input: { command: 'echo SECRETO-123' } });
  const r = toRecord(pre, raw(pre), 1000);
  assert.deepEqual(Object.keys(r).sort(), ['cwd', 'event', 'id', 'mode', 'session', 'tool', 'toolUse', 'ts', 'type', 'v']);
  assert.equal(r.tool, 'Bash'); assert.equal(r.toolUse, 'toolu_1'); assert.equal(r.ts, 1000); assert.equal(r.type, 'hook');
  const edit = base('PostToolUse', { tool_name: 'Edit', tool_use_id: 't2', tool_input: { file_path: 'D:\\Proyectos\\demo\\a.js', old_string: 'SECRETO', new_string: 'SECRETO2' }, tool_response: { ok: 'SECRETO' }, duration_ms: 12.4 });
  const e = toRecord(edit, raw(edit));
  assert.equal(e.file, 'D:\\Proyectos\\demo\\a.js'); assert.equal(e.ms, 12);
  const prompt = base('UserPromptSubmit', { prompt: 'SECRETO mi clave es 1234' });
  const stop = base('Stop', { last_assistant_message: 'SECRETO respuesta', stop_hook_active: false });
  const note = base('Notification', { message: 'SECRETO necesita permiso para Bash', title: 'SECRETO', notification_type: 'permission_prompt' });
  for (const p of [pre, edit, prompt, stop, note]) assert.ok(!JSON.stringify(toRecord(p, raw(p))).includes('SECRETO'), p.hook_event_name);
  assert.equal(toRecord(note, raw(note)).kind, 'permission_prompt');
  assert.equal(toRecord(base('SessionStart', { source: 'resume' }), '{}').source, 'resume');
  assert.equal(toRecord(base('SessionEnd', { reason: 'prompt_input_exit' }), '{}').reason, 'prompt_input_exit');
  const sub = toRecord(base('SubagentStart', { agent_id: 'ag1', agent_type: 'Explore' }), '{}');
  assert.equal(sub.agent, 'ag1'); assert.equal(sub.agentType, 'Explore');
  assert.ok(!('file' in toRecord(base('PostToolUse', { tool_name: 'Read', tool_input: { file_path: 'x' } }), '{}')), 'leer no es modificar');
});

test('toRecord: entradas inválidas se descartan', () => {
  for (const bad of [null, 42, 'x', [], {}, base('Inventado'), base('Stop', { session_id: '../../etc' }), base('Stop', { session_id: 7 }), { hook_event_name: 'Stop' }]) {
    assert.equal(toRecord(bad, '{}'), null, JSON.stringify(bad));
  }
  assert.equal(toRecord(base('Stop'), 'a').id, toRecord(base('Stop'), 'a').id, 'misma entrega, mismo id');
  assert.notEqual(toRecord(base('Stop'), 'a').id, toRecord(base('Stop'), 'b').id);
});

test('agentmap-hook como proceso: escribe una línea, nada en stdout, siempre código 0', async () => {
  ensureHookFile();
  assert.ok(fs.existsSync(HOOK_FILE));
  const r = await runHook(base('UserPromptSubmit', { prompt: 'hola' }));
  assert.deepEqual([r.code, r.stdout, r.stderr], [0, '', '']);
  assert.equal(lines(S).length, 1);
  assert.equal(JSON.parse(lines(S)[0]).event, 'UserPromptSubmit');
  for (const junk of ['', 'no es json', '{"hook_event_name":"Stop"}', JSON.stringify(base('Stop', { session_id: 'malo' })), '[1,2]']) {
    const j = await runHook(junk);
    assert.deepEqual([j.code, j.stdout], [0, ''], junk);
  }
  assert.equal(lines(S).length, 1, 'lo inválido no se registra');
  const big = await runHook(base('PreToolUse', { tool_name: 'Write', tool_input: { file_path: 'f.txt', content: 'x'.repeat(5 << 20) } }));
  assert.equal(big.code, 0);
  assert.ok(lines(S)[1].length < 600, 'el contenido grande no entra al registro');
});

test('escrituras concurrentes: 30 hooks a la vez dejan 30 líneas válidas', async () => {
  const before = lines(S2).length;
  await Promise.all(Array.from({ length: 30 }, (_, i) => runHook({ ...base('PreToolUse', { tool_name: 'Bash', tool_use_id: 'c' + i }), session_id: S2 })));
  const ls = lines(S2).slice(before);
  assert.equal(ls.length, 30);
  const recs = ls.map(l => JSON.parse(l));
  assert.equal(new Set(recs.map(r => r.toolUse)).size, 30);
});

test('estado derivado: turno, herramientas, permiso, subagentes, fin', () => {
  const st = { status: null, statusAt: 0, lastEventAt: 0, ended: false, cwd: '', mode: '', tool: null, tools: {}, files: new Set(), failures: 0, agents: new Set(), events: 0, duplicates: 0, invalid: 0 };
  const seen = new Map();
  let t = 1000, n = 0;
  const ev = (event, extra = {}) => applyEvent(st, { type: 'hook', v: 1, id: 'i' + n++, ts: t += 10, event, session: S, ...extra }, S, seen);
  ev('SessionStart', { source: 'startup' }); assert.equal(st.status, 'idle');
  ev('UserPromptSubmit'); assert.equal(st.status, 'busy');
  const busyAt = st.statusAt;
  ev('PreToolUse', { tool: 'Edit' }); assert.equal(st.tool, 'Edit'); assert.equal(st.statusAt, busyAt, 'sigue trabajando: no es un cambio de estado');
  ev('PostToolUse', { tool: 'Edit', file: 'a.js' }); assert.equal(st.tool, null); assert.equal(st.files.size, 1);
  ev('PreToolUse', { tool: 'Bash' }); ev('PermissionRequest', { tool: 'Bash' }); assert.equal(st.status, 'waiting');
  ev('PostToolUseFailure', { tool: 'Bash' }); assert.equal(st.status, 'busy'); assert.equal(st.failures, 1);
  ev('SubagentStart', { agent: 'a1' }); assert.equal(st.agents.size, 1);
  ev('Stop', { agent: 'a1' }); assert.equal(st.status, 'busy', 'el Stop de un subagente no termina la sesión');
  ev('SubagentStop', { agent: 'a1' }); assert.equal(st.agents.size, 0);
  ev('Notification', { kind: 'permission_prompt' }); assert.equal(st.status, 'waiting');
  ev('Stop'); assert.equal(st.status, 'idle');
  ev('Notification', { kind: 'idle_prompt' }); assert.equal(st.status, 'idle');
  ev('SessionEnd', { reason: 'other' }); assert.equal(st.status, 'ended'); assert.ok(st.ended);
  assert.deepEqual(st.tools, { Edit: 1, Bash: 1 });
  applyEvent(st, { type: 'hook', id: 'z', ts: 1, event: 'Stop', session: S2 }, S, seen); // de otra sesión
  applyEvent(st, { type: 'hook', id: 'z', ts: 1, event: 'Inventado', session: S }, S, seen);
  assert.equal(st.invalid, 2);
});

test('duplicados: la misma entrega dentro de 1 min se ignora; una repetición legítima más tarde cuenta', () => {
  const st = { status: null, statusAt: 0, lastEventAt: 0, ended: false, cwd: '', mode: '', tool: null, tools: {}, files: new Set(), failures: 0, agents: new Set(), events: 0, duplicates: 0, invalid: 0 };
  const seen = new Map();
  const rec = (ts) => ({ type: 'hook', v: 1, id: 'same', ts, event: 'PreToolUse', session: S, tool: 'Bash' });
  applyEvent(st, rec(1000), S, seen);
  applyEvent(st, rec(1500), S, seen);
  applyEvent(st, rec(30_000), S, seen);
  assert.deepEqual([st.events, st.duplicates, st.tools.Bash], [1, 2, 1]);
  applyEvent(st, rec(200_000), S, seen);
  assert.deepEqual([st.events, st.tools.Bash], [2, 2]);
});

test('registro: lectura incremental, línea a medio escribir, líneas inválidas, reinicio y archivo borrado', async () => {
  const id = '99999999-8888-4777-8666-555555555555';
  const f = path.join(EVENTS_DIR, id + '.jsonl');
  const L = (event, ts, extra = {}) => JSON.stringify({ type: 'hook', v: 1, id: event + ts, ts, event, session: id, ...extra }) + '\n';
  fs.writeFileSync(f, L('UserPromptSubmit', 1) + 'basura no json\n' + '{"type":"hook","event":"Stop"}\n');
  let st = (await hookStates()).get(id);
  assert.equal(st.status, 'busy'); assert.equal(st.invalid, 2);
  fs.appendFileSync(f, L('Stop', 2).slice(0, 20)); // Claude escribiendo: línea incompleta
  st = (await hookStates()).get(id);
  assert.equal(st.status, 'busy', 'la línea incompleta todavía no cuenta');
  fs.appendFileSync(f, L('Stop', 2).slice(20));
  st = (await hookStates()).get(id);
  assert.equal(st.status, 'idle');
  // Reinicio del servidor: un módulo nuevo (estado vacío) reconstruye lo mismo desde el archivo.
  const fresh = await import('../lib/hooks.js?reinicio');
  const st2 = (await fresh.hookStates()).get(id);
  assert.deepEqual([st2.status, st2.events, st2.invalid], [st.status, st.events, st.invalid]);
  fs.rmSync(f);
  assert.ok(!(await hookStates()).has(id), 'registro borrado: se olvida');
});

test('combinación con sessions/*.json: gana el cambio más reciente; sin hook queda igual (respaldo)', () => {
  const h = (o) => ({ status: 'idle', statusAt: 2000, lastEventAt: 2000, ended: false, cwd: 'D:\\p', tool: null, tools: { Bash: 2 }, files: new Set(), failures: 0, agents: new Set(), events: 3, ...o });
  let live = new Map([[S, { pid: 1, status: 'busy', statusUpdatedAt: 1000 }]]);
  mergeHooks(live, new Map([[S, h()]]), 3000);
  assert.deepEqual([live.get(S).status, live.get(S).source, live.get(S).activity.tools.Bash], ['idle', 'hook', 2]);
  live = new Map([[S, { pid: 1, status: 'waiting', statusUpdatedAt: 5000 }]]);
  mergeHooks(live, new Map([[S, h()]]), 6000);
  assert.equal(live.get(S).status, 'waiting', 'sessions/*.json más nuevo: manda');
  live = new Map([[S, { pid: 1, status: 'busy', statusUpdatedAt: 1000 }]]);
  mergeHooks(live, new Map(), 3000);
  assert.deepEqual(live.get(S), { pid: 1, status: 'busy', statusUpdatedAt: 1000 }, 'sin hook: sin cambios');
  live = new Map();
  mergeHooks(live, new Map([[S, h({ status: 'busy' })], [S2, h({ ended: true, status: 'ended' })]]), 3000);
  assert.deepEqual([live.get(S)?.status, live.get(S)?.pid, live.has(S2)], ['busy', null, false], 'solo hook: abierta si es reciente y no terminó');
  live = new Map();
  mergeHooks(live, new Map([[S, h({ lastEventAt: 0 })]]), 10 * 60_000);
  assert.equal(live.size, 0, 'sin eventos recientes no se supone que está abierta');
});

test('instalar y quitar: solo .claude/settings.local.json, idempotente, conserva lo ajeno, copia y vuelve atrás', () => {
  const proj = path.join(dir, 'proyecto');
  fs.mkdirSync(proj);
  const file = path.join(proj, '.claude', 'settings.local.json');
  const pre = projectHook(proj, process.env.CLAUDE_CONFIG_DIR);
  assert.equal(pre.installed, false); assert.equal(pre.exists, false);
  assert.ok(!fs.existsSync(path.join(proj, '.claude')), 'la vista previa no escribe nada');
  assert.deepEqual(Object.keys(pre.afterInstall.hooks), HOOK_EVENTS);
  let r = setProjectHook(proj, process.env.CLAUDE_CONFIG_DIR, true);
  assert.ok(r.changed && r.installed);
  const data = JSON.parse(fs.readFileSync(file, 'utf8'));
  for (const ev of HOOK_EVENTS) assert.deepEqual(data.hooks[ev], [{ hooks: [{ type: 'command', command: hookCommand(), async: true, timeout: 10 }] }]);
  assert.ok(!fs.existsSync(file + '.agentmap-backup'), 'no había archivo: no hay copia');
  assert.equal(setProjectHook(proj, process.env.CLAUDE_CONFIG_DIR, true).changed, false, 'idempotente');
  r = setProjectHook(proj, process.env.CLAUDE_CONFIG_DIR, false);
  assert.ok(r.changed && !r.installed);
  assert.ok(!fs.existsSync(file), 'lo había creado Agent Map: se borra al quitar');

  // Archivo existente con configuración y hooks del usuario
  const mine = { permissions: { allow: ['Bash(npm test)'] }, hooks: { Stop: [{ hooks: [{ type: 'command', command: 'echo listo' }] }], PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'mi-guardia' }] }] } };
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(mine, null, 2));
  setProjectHook(proj, process.env.CLAUDE_CONFIG_DIR, true);
  const inst = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.deepEqual(inst.permissions, mine.permissions);
  assert.equal(inst.hooks.Stop.length, 2); assert.equal(inst.hooks.Stop[0].hooks[0].command, 'echo listo');
  assert.equal(inst.hooks.PreToolUse[0].matcher, 'Bash');
  assert.deepEqual(JSON.parse(fs.readFileSync(file + '.agentmap-backup', 'utf8')), mine, 'copia del original');
  setProjectHook(proj, process.env.CLAUDE_CONFIG_DIR, false);
  assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), mine, 'al quitar queda exactamente lo del usuario');
  assert.deepEqual(withoutHook(withHook(mine)), mine);

  fs.writeFileSync(file, '{ roto');
  assert.throws(() => setProjectHook(proj, process.env.CLAUDE_CONFIG_DIR, true), /no es JSON válido/);
  assert.equal(fs.readFileSync(file, 'utf8'), '{ roto', 'un archivo ilegible no se toca');
  fs.writeFileSync(file, JSON.stringify({ hooks: [] }));
  assert.throws(() => setProjectHook(proj, process.env.CLAUDE_CONFIG_DIR, true), /formato desconocido/);
});

test('instalar: carpetas prohibidas (usuario = configuración global, raíz, ~/.claude, ~/.agent-map, inexistente)', () => {
  const claude = process.env.CLAUDE_CONFIG_DIR;
  for (const [d, msg] of [[os.homedir(), /carpeta de usuario/], [path.parse(dir).root, /raíz/], [claude, /Claude Code/], [path.join(dir, 'am'), /Agent Map/],
    [path.join(dir, 'no-existe'), /no existe/], ['relativa', /inválida/], [42, /inválida/]]) {
    if (d === path.join(dir, 'am')) fs.mkdirSync(d, { recursive: true });
    assert.throws(() => setProjectHook(d, claude, true), msg, String(d));
    assert.throws(() => projectHook(d, claude), msg, String(d));
  }
});

test('servidor: diagnóstico, estado y avisos en vivo con eventos del hook; nada se instala sin pedirlo', async () => {
  const snap = d => fs.readdirSync(d, { recursive: true }).sort().join('|');
  const proj = path.join(dir, 'proyecto2');
  fs.mkdirSync(proj);
  const claudeBefore = snap(process.env.CLAUDE_CONFIG_DIR), projBefore = snap(proj);
  const { startServer } = await import('../server.js');
  const port = await startServer(0);
  const base_ = `http://127.0.0.1:${port}`;
  const diag = await (await fetch(base_ + '/api/hook')).json();
  assert.equal(diag.copied, true); assert.equal(diag.hookFile, HOOK_FILE); assert.deepEqual(diag.events, HOOK_EVENTS);
  const info = await (await fetch(base_ + '/api/hook/project?dir=' + encodeURIComponent(proj))).json();
  assert.equal(info.installed, false);
  assert.equal((await fetch(base_ + '/api/hook/project', { method: 'POST', body: JSON.stringify({ dir: proj, install: true }) })).status, 403, 'sin el Origin de la página no instala');
  assert.equal(snap(process.env.CLAUDE_CONFIG_DIR), claudeBefore, 'nada en la carpeta de Claude');
  assert.equal(snap(proj), projBefore, 'nada en el proyecto sin pedirlo');

  // Canal en vivo: una sesión que solo conoce el hook pasa a trabajando y luego a terminada
  const ID = 'abcdefab-1234-4abc-8def-123456789abc';
  const ctrl = new AbortController();
  const res = await fetch(base_ + '/api/events', { signal: ctrl.signal });
  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  const sigs = [];
  (async () => { try { for (;;) { const { value, done } = await reader.read(); if (done) return; for (const m of value.matchAll(/data: (.*)/g)) sigs.push(JSON.parse(m[1])); } } catch {} })();
  const waitSig = async (re, ms = 5000) => { const end = Date.now() + ms; while (Date.now() < end) { if (sigs.some(s => re.test(s))) return true; await new Promise(r => setTimeout(r, 50)); } return false; };
  await runHook({ ...base('UserPromptSubmit', { prompt: 'x', cwd: proj }), session_id: ID });
  await runHook({ ...base('PreToolUse', { tool_name: 'Grep', tool_use_id: 'g1', cwd: proj }), session_id: ID });
  assert.ok(await waitSig(new RegExp(`${ID}:null:busy`)), 'aviso en vivo: trabajando');
  await runHook({ ...base('Stop', { cwd: proj }), session_id: ID });
  assert.ok(await waitSig(new RegExp(`${ID}:null:idle`)), 'aviso en vivo: terminó');
  ctrl.abort();
  const live = (await (await fetch(base_ + '/api/hook/project?dir=' + encodeURIComponent(proj))).json()).lastEventAt;
  assert.ok(live > 0, 'diagnóstico por proyecto: llegaron eventos');
});
