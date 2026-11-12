// Ocultos y borrar datos propios de Agent Map (UX-04 niveles 1 y 2): prefs.hidden y prefs.forget.
// Carpeta temporal propia: AGENT_MAP_USAGE_FILE se fija ANTES de importar (cada archivo de test corre en su proceso).
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentmap-hidden-'));
after(() => fs.rmSync(dir, { recursive: true, force: true }));
process.env.AGENT_MAP_USAGE_FILE = path.join(dir, 'am', 'usage.json');
process.env.CLAUDE_CONFIG_DIR = path.join(dir, 'claude');
const { readPrefs, updatePrefs, PREFS_FILE } = await import('../lib/prefs.js');

const A = '853513a1-f357-4bc7-a053-c4faceed451b', B = 'a15af667-5585-4ab5-a787-be363e598375';
const CWD = 'D:\\Proyectos\\juego-plataformas';
const disk = () => JSON.parse(fs.readFileSync(PREFS_FILE, 'utf8'));
const reset = data => { fs.mkdirSync(path.dirname(PREFS_FILE), { recursive: true }); fs.writeFileSync(PREFS_FILE, JSON.stringify(data)); };

test('compatibilidad: prefs de una versión anterior (sin hidden) se leen igual y con hidden vacío', () => {
  const old = { theme: 'noche', fontSize: 15, startFullscreen: false, labels: { [A]: { name: 'Blog', color: 'blue', pinned: true } } };
  reset(old);
  const p = readPrefs();
  assert.deepEqual(p.hidden, { sessions: [], projects: [] });
  assert.equal(p.theme, 'noche'); assert.equal(p.fontSize, 15); assert.equal(p.startFullscreen, false);
  assert.deepEqual(p.labels, old.labels);
  // Un cambio cualquiera conserva todo lo anterior y agrega hidden.
  updatePrefs({ fontSize: 16 });
  assert.deepEqual(disk().labels, old.labels);
  assert.deepEqual(disk().hidden, { sessions: [], projects: [] });
});

test('compatibilidad: un hidden dañado o editado a mano se limpia sin perder lo válido', () => {
  reset({ hidden: { sessions: [A, A, 'no-es-uuid', 42, B], projects: [CWD, '', 7, CWD, 'x\u0000y'] } });
  assert.deepEqual(readPrefs().hidden, { sessions: [A, B], projects: [CWD] });
  for (const bad of [null, 'texto', [], { sessions: 'x' }]) {
    reset({ hidden: bad });
    assert.deepEqual(readPrefs().hidden, { sessions: [], projects: [] }, JSON.stringify(bad));
  }
});

test('ocultar y recuperar una sesión: persiste en disco, sin duplicados, y no toca sus etiquetas', () => {
  reset({ labels: { [A]: { name: 'Blog', pinned: true } } });
  updatePrefs({ hide: { session: A, hidden: true } });
  updatePrefs({ hide: { session: A, hidden: true } }); // dos veces: una sola entrada
  assert.deepEqual(disk().hidden.sessions, [A]);
  assert.deepEqual(readPrefs().hidden.sessions, [A], 'tras reiniciar (lectura nueva del archivo)');
  updatePrefs({ hide: { session: A, hidden: false } });
  assert.deepEqual(disk().hidden.sessions, []);
  assert.deepEqual(disk().labels[A], { name: 'Blog', pinned: true }, 'recuperar no cambia su estado original');
});

test('ocultar y recuperar un proyecto por su carpeta; sesiones y proyectos son listas independientes', () => {
  reset({});
  updatePrefs({ hide: { project: CWD, hidden: true } });
  updatePrefs({ hide: { session: B, hidden: true } });
  assert.deepEqual(disk().hidden, { sessions: [B], projects: [CWD] });
  updatePrefs({ hide: { project: CWD, hidden: false } });
  assert.deepEqual(disk().hidden, { sessions: [B], projects: [] });
});

test('ocultar: datos inválidos se rechazan sin guardar nada', () => {
  reset({});
  const before = fs.readFileSync(PREFS_FILE, 'utf8');
  for (const bad of [{}, { session: A }, { session: A, hidden: 'sí' }, { session: '../x', hidden: true }, { project: '', hidden: true },
    { project: 'a'.repeat(1025), hidden: true }, { project: 'D:\\x\ny', hidden: true }, { project: 42, hidden: true }]) {
    assert.throws(() => updatePrefs({ hide: bad }), /inválid/, JSON.stringify(bad));
  }
  assert.equal(fs.readFileSync(PREFS_FILE, 'utf8'), before);
});

test('borrar datos de Agent Map: quita nombre, color y fijado solo de esas sesiones; ocultos y demás preferencias quedan', () => {
  reset({ theme: 'matrix', labels: { [A]: { name: 'Blog', color: 'red', pinned: true }, [B]: { name: 'Juego' } },
    hidden: { sessions: [A], projects: [CWD] }, sounds: { volume: 0.3 } });
  updatePrefs({ forget: { ids: [A] } });
  const d = disk();
  assert.equal(d.labels[A], undefined);
  assert.deepEqual(d.labels[B], { name: 'Juego' });
  assert.deepEqual(d.hidden, { sessions: [A], projects: [CWD] });
  assert.equal(d.theme, 'matrix'); assert.equal(d.sounds.volume, 0.3);
  updatePrefs({ forget: { ids: [A, B] } }); // varias a la vez (un proyecto); una ya sin datos no falla
  assert.deepEqual(disk().labels, {});
  for (const bad of [{}, { ids: 'x' }, { ids: [A, 'no'] }, { ids: [A, 3] }]) assert.throws(() => updatePrefs({ forget: bad }), /inválid/);
});

test('protección: ocultar y borrar datos escriben solo prefs.json, nunca en la carpeta de Claude', () => {
  const claude = process.env.CLAUDE_CONFIG_DIR;
  const file = path.join(claude, 'projects', 'D--Proyectos-blog', A + '.jsonl');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, '{"type":"user"}\n');
  fs.writeFileSync(path.join(claude, 'history.jsonl'), '{}\n');
  const snap = () => fs.readdirSync(claude, { recursive: true }).sort().map(f => {
    const full = path.join(claude, f);
    return f + ':' + (fs.statSync(full).isFile() ? fs.readFileSync(full, 'utf8') + fs.statSync(full).mtimeMs : 'dir');
  }).join('|');
  const before = snap();
  updatePrefs({ hide: { session: A, hidden: true } });
  updatePrefs({ hide: { project: CWD, hidden: true } });
  updatePrefs({ forget: { ids: [A, B] } });
  updatePrefs({ hide: { session: A, hidden: false } });
  assert.equal(snap(), before);
  assert.ok(!PREFS_FILE.startsWith(claude));
});
