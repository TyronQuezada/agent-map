// E0.2.b: las lecturas que se repiten (árbol, equipo, plan, explorador) ya no bloquean y devuelven lo mismo.
// Usa un ~/.claude falso: CLAUDE_CONFIG_DIR se fija ANTES de importar los módulos (cada archivo de test
// corre en su propio proceso).
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agentmap-async-'));
after(() => fs.rmSync(root, { recursive: true, force: true }));
const claude = path.join(root, 'claude');
process.env.CLAUDE_CONFIG_DIR = claude;
const { scanAll, liveSessions, planInfo } = await import('../lib/scan.js');
const { teamStatus, createTeam } = await import('../lib/team.js');
const { roots, listDirs } = await import('../lib/folders.js');

const L = r => JSON.stringify(r) + '\n';
const user = (t, ts = '2026-01-01T10:00:00Z') => ({ type: 'user', timestamp: ts, cwd: proj, message: { role: 'user', content: t } });
const tool = (name, input = {}) => ({ type: 'assistant', timestamp: '2026-01-01T10:00:05Z', message: { id: 'x' + Math.random(), content: [{ type: 'tool_use', name, input }] } });
const proj = path.join(root, 'mi-juego');
const key = path.resolve(proj).replace(/[^a-zA-Z0-9]/g, '-');
const pdir = path.join(claude, 'projects', key);
const SID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
const sub = path.join(pdir, SID, 'subagents');

// Un proyecto con equipo, una sesión viva (pid = este proceso), un subagente trabajando y otro terminado.
fs.mkdirSync(proj, { recursive: true });
fs.mkdirSync(sub, { recursive: true });
fs.mkdirSync(path.join(claude, 'sessions'), { recursive: true });
createTeam(proj, { boss: { name: 'Jefa' }, agents: [{ name: 'Programador', role: 'Código' }, { name: 'Artista', role: 'Sprites' }] });
fs.writeFileSync(path.join(pdir, SID + '.jsonl'), L(user('haz el nivel 1')) + L(tool('Agent', { subagent_type: 'programador', description: 'movimiento' })));
fs.writeFileSync(path.join(claude, 'sessions', process.pid + '.json'), JSON.stringify({ pid: process.pid, sessionId: SID, cwd: proj, status: 'busy', updatedAt: 1 }));
fs.writeFileSync(path.join(claude, 'sessions', '999999.json'), JSON.stringify({ pid: 999999, sessionId: 'muerta', cwd: proj, status: 'busy' }));
fs.writeFileSync(path.join(claude, 'sessions', '123.json'), '{roto');
fs.writeFileSync(path.join(sub, 'agent-p.meta.json'), JSON.stringify({ agentType: 'programador', description: 'movimiento', finished: false }));
fs.writeFileSync(path.join(sub, 'agent-p.jsonl'), L(tool('Write', { file_path: path.join(proj, 'player.gd') })));
fs.writeFileSync(path.join(sub, 'agent-a.meta.json'), JSON.stringify({ agentType: 'artista', description: 'sprites', finished: true }));
fs.writeFileSync(path.join(sub, 'roto.meta.json'), '{a medio escribir');

test('teamStatus es asíncrona y devuelve el mismo estado que antes', async () => {
  const p = teamStatus(proj);
  assert.ok(p instanceof Promise);
  const st = await p;
  assert.equal(st.live, true);
  assert.deepEqual(st.members.map(m => [m.key, m.state]), [['boss', 'working'], ['programador', 'working'], ['artista', 'idle']]);
  assert.equal(st.members[0].since, '2026-01-01T10:00:00Z');
  assert.match(st.members[1].since, /^\d{4}-\d\d-\d\dT/);         // birthtime del meta
  assert.equal(st.members[1].feed.at(-1).th, 'Codeando player.gd');
  assert.equal(st.members[1].writes, 1);
  assert.ok(st.members[2].finishedAt);
  assert.equal(st.members[0].feed.at(-1).th, 'Encargando a Programador');
});

test('teamStatus: carpeta sin equipo, inexistente o que es un archivo → null', async () => {
  assert.equal(await teamStatus(root), null);
  assert.equal(await teamStatus(path.join(root, 'no-existe')), null);
  fs.writeFileSync(path.join(root, 'archivo.txt'), 'x');
  assert.equal(await teamStatus(path.join(root, 'archivo.txt')), null);
});

test('liveSessions es asíncrona: ignora procesos muertos y archivos rotos', async () => {
  const live = await liveSessions();
  assert.deepEqual([...live.keys()], [SID]);
  assert.equal(live.get(SID).status, 'busy');
});

test('scanAll: árbol con subagentes; un .jsonl ilegible o un meta roto no tumban el escaneo', async () => {
  fs.mkdirSync(path.join(pdir, '11111111-2222-3333-4444-555555555555.jsonl')); // "sesión" que es carpeta: falla al abrir
  const tree = await scanAll();
  assert.equal(tree.length, 1);
  const s = tree[0].sessions[0];
  assert.equal(s.id, SID);
  assert.deepEqual(s.subagents.map(a => [a.type, a.finished]).sort(), [['artista', true], ['programador', false]]);
  assert.equal(s.live.pid, process.pid);
});

test('lecturas concurrentes: el mismo resultado, sin duplicados', async () => {
  const [a, ...rest] = await Promise.all([...Array(8)].map(() => scanAll()));
  for (const r of rest) assert.deepEqual(r, a);
  const teams = await Promise.all([...Array(8)].map(() => teamStatus(proj)));
  for (const t of teams) assert.deepEqual(t, teams[0]);
  assert.equal(a[0].sessions.length, 1);
});

test('archivo borrado entre consultas: desaparece del árbol y del equipo sin errores', async () => {
  fs.writeFileSync(path.join(sub, 'agent-x.meta.json'), JSON.stringify({ agentType: 'artista', finished: false }));
  await scanAll();
  fs.unlinkSync(path.join(sub, 'agent-x.meta.json'));
  const tree = await scanAll();
  assert.equal(tree[0].sessions[0].subagents.length, 2);
  assert.equal((await teamStatus(proj)).members[2].state, 'idle');
});

test('error de permisos en una sesión: se salta y el resto sigue', { skip: process.platform !== 'win32' && 'solo Windows (icacls)' }, async () => {
  const sid2 = 'bbbbbbbb-bbbb-cccc-dddd-eeeeeeeeeeee';
  const f = path.join(pdir, sid2 + '.jsonl');
  fs.writeFileSync(f, L(user('otra sesión')));
  assert.equal((await scanAll())[0].sessions.length, 2);
  execFileSync('icacls', [f, '/deny', `${os.userInfo().username}:(R)`], { stdio: 'ignore' });
  try {
    const sessions = (await import('../lib/scan.js?permisos')).scanAll; // módulo nuevo: sin caché de esa sesión
    const tree = await sessions();
    assert.deepEqual(tree[0].sessions.map(s => s.id), [SID]);
  } finally {
    execFileSync('icacls', [f, '/remove:d', os.userInfo().username], { stdio: 'ignore' });
  }
});

test('planInfo: asíncrona, solo vuelve a leer ~/.claude.json si cambió, y devuelve copias', async () => {
  const f = path.join(claude, '.claude.json');
  assert.equal(await planInfo(), null); // todavía no existe
  fs.writeFileSync(f, JSON.stringify({ oauthAccount: { organizationType: 'claude_pro' } }));
  const a = await planInfo();
  assert.deepEqual(a, { name: 'Pro', extraUsage: false });
  a.name = 'tocado';
  assert.equal((await planInfo()).name, 'Pro');
  fs.writeFileSync(f, JSON.stringify({ oauthAccount: { organizationType: 'claude_max', userRateLimitTier: 'x_max_20x', hasExtraUsageEnabled: true } }) + ' ');
  assert.deepEqual(await planInfo(), { name: 'Max 20x', extraUsage: true });
});

test('explorador: los puntos de partida se calculan sin bloquear', async () => {
  const r = await roots();
  assert.equal(r[0], os.homedir());
  if (process.platform === 'win32') assert.ok(r.includes('C:\\'));
  assert.deepEqual((await listDirs('')).dirs, r);
});

test('teamStatus: born, mtime e id escritos en un .meta.json no pisan los valores internos', async t => {
  // Programador: tarea nueva con born inválido e id falso; Artista: tarea terminada con mtime inválido.
  const q = path.join(sub, 'agent-q.meta.json'), r = path.join(sub, 'agent-r.meta.json');
  const qLog = path.join(sub, 'agent-q.jsonl');
  t.after(() => { for (const f of [q, r, qLog]) fs.rmSync(f, { force: true }); });
  fs.writeFileSync(q, JSON.stringify({ agentType: 'programador', finished: false, born: 'no-es-fecha', id: 'agent-inexistente', mtime: 0 }));
  fs.writeFileSync(qLog, L(tool('Write', { file_path: path.join(proj, 'enemigo.gd') })));
  fs.writeFileSync(r, JSON.stringify({ agentType: 'artista', finished: true, mtime: 'no-es-fecha' }));
  const later = new Date(Date.now() + 60_000); // los más nuevos de verdad, por su fecha real
  fs.utimesSync(q, later, later); fs.utimesSync(r, later, later);

  const st = await teamStatus(proj); // antes: RangeError: Invalid time value
  const [, prog, art] = st.members;
  assert.equal(prog.state, 'working');
  assert.equal(prog.since, new Date(fs.statSync(q).birthtimeMs).toISOString()); // de birthtimeMs, no del archivo
  assert.equal(prog.feed.at(-1).th, 'Codeando enemigo.gd'); // usó el id real (agent-q), no "agent-inexistente"
  assert.equal(art.state, 'idle');
  assert.equal(art.finishedAt, new Date(fs.statSync(r).mtimeMs).toISOString()); // mtime real, no "no-es-fecha"
});
