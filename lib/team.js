// "Equipo de agentes": 1 jefe (la sesión principal de Claude) + 2 agentes (subagentes de Claude Code).
// Crear un equipo escribe archivos en la carpeta del proyecto; leer su estado solo lee archivos de Claude.
import fs from 'node:fs';
import path from 'node:path';
import { CLAUDE_DIR, liveSessions, readable } from './scan.js';

export const TEAM_FILE = path.join('.claude', 'agent-map-team.json');
const RESERVED = new Set(['general-purpose', 'explore', 'plan', 'statusline-setup', 'claude-code-guide', 'claude']);
const START = '<!-- agent-map:equipo -->';
const END = '<!-- /agent-map:equipo -->';

/** "Diseñadora Gráfica" -> "disenadora-grafica" (nombre de archivo y de subagente). */
export function slugify(name) {
  return String(name).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 30);
}

function text(v, field, max, required = true) {
  if (typeof v !== 'string') throw new Error(`Falta ${field}`);
  const s = v.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').trim();
  if (required && !s) throw new Error(`Falta ${field}`);
  if (s.length > max) throw new Error(`${field}: máximo ${max} caracteres`);
  return s;
}
const oneLine = s => s.replace(/\s+/g, ' ');

/** Valida el formulario. Devuelve { boss, agents } limpio o lanza Error con un mensaje para el usuario. */
export function validateTeam(body) {
  const boss = { name: oneLine(text(body?.boss?.name, 'el nombre del jefe', 40)), instructions: text(body?.boss?.instructions ?? '', 'las instrucciones del jefe', 4000, false) };
  if (!Array.isArray(body?.agents) || body.agents.length !== 2) throw new Error('El equipo lleva exactamente 2 agentes');
  const agents = body.agents.map((a, i) => {
    const n = i + 1;
    const name = oneLine(text(a?.name, `el nombre del agente ${n}`, 40));
    const slug = slugify(name);
    if (!slug) throw new Error(`El nombre del agente ${n} necesita letras o números`);
    if (RESERVED.has(slug)) throw new Error(`"${name}" choca con un agente de Claude Code; usa otro nombre`);
    return { name, slug, role: oneLine(text(a?.role, `el cargo del agente ${n}`, 60)), instructions: text(a?.instructions ?? '', `las instrucciones del agente ${n}`, 4000, false) };
  });
  if (agents[0].slug === agents[1].slug) throw new Error('Los dos agentes necesitan nombres distintos');
  return { boss, agents };
}

/** Lee el equipo de una carpeta de proyecto. null si no tiene. */
export function readTeam(dir) {
  try {
    const t = JSON.parse(fs.readFileSync(path.join(dir, TEAM_FILE), 'utf8'));
    if (!t?.boss?.name || !Array.isArray(t.agents) || t.agents.length !== 2) return null;
    return t;
  } catch { return null; }
}

/** Crea los archivos del equipo en `dir` (que ya existe). No pisa agentes ajenos con el mismo nombre. */
export function createTeam(dir, body) {
  const { boss, agents } = validateTeam(body);
  const agentsDir = path.join(dir, '.claude', 'agents');
  const previous = new Set((readTeam(dir)?.agents || []).map(a => a.slug));
  for (const a of agents) {
    const file = path.join(agentsDir, a.slug + '.md');
    if (fs.existsSync(file) && !previous.has(a.slug)) throw new Error(`Ya existe un agente llamado "${a.slug}" en esta carpeta; usa otro nombre`);
  }
  fs.mkdirSync(agentsDir, { recursive: true });
  for (const a of agents) fs.writeFileSync(path.join(agentsDir, a.slug + '.md'), agentFile(a, boss));

  const claudeMd = path.join(dir, 'CLAUDE.md');
  const section = bossSection(boss, agents);
  let cur = '';
  try { cur = fs.readFileSync(claudeMd, 'utf8'); } catch {}
  const at = cur.indexOf(START), end = cur.indexOf(END);
  const next = at >= 0 && end > at
    ? cur.slice(0, at) + section + cur.slice(end + END.length) // reemplaza el equipo anterior, conserva lo demás
    : (cur ? cur.replace(/\s*$/, '\n\n') : '') + section + '\n';
  fs.writeFileSync(claudeMd, next);

  const tasks = path.join(dir, 'TAREAS.md');
  if (!fs.existsSync(tasks)) fs.writeFileSync(tasks, tasksFile(boss, agents));

  const team = { version: 1, boss: { name: boss.name }, agents: agents.map(({ name, slug, role }) => ({ name, slug, role })) };
  fs.writeFileSync(path.join(dir, TEAM_FILE), JSON.stringify(team, null, 2));
  return team;
}

function agentFile(a, boss) {
  const description = `${a.role}. ${boss.name} (el jefe del equipo) le encarga las tareas de ${a.role.toLowerCase()}.`;
  return `---
name: ${a.slug}
description: ${JSON.stringify(description)}
---
Eres **${a.name}**. Tu cargo en el equipo: **${a.role}**. Tu jefe es **${boss.name}**.

${a.instructions || `Encárgate de todo lo relacionado con: ${a.role}.`}

## Cómo trabajas en el equipo
- Antes de empezar, lee \`CLAUDE.md\` y \`TAREAS.md\`.
- Haz solo la tarea que te encargó ${boss.name}. Si ves algo más que hacer, menciónalo en tu resumen en vez de hacerlo.
- No edites archivos que en \`TAREAS.md\` estén asignados al otro agente: otro compañero puede estar trabajando en ellos al mismo tiempo.
- Al terminar, entrega un resumen corto: qué hiciste, qué archivos tocaste y qué quedó pendiente.
`;
}

function bossSection(boss, agents) {
  return `${START}
## Equipo de agentes (creado con Agent Map)

Tú eres **${boss.name}**, el jefe (orquestador) de este proyecto.
${boss.instructions ? '\n' + boss.instructions + '\n' : ''}
### Tu equipo
${agents.map(a => `- **${a.name}** (subagente \`${a.slug}\`): ${a.role}`).join('\n')}

### Cómo trabajar
1. Divide cada pedido del usuario en tareas pequeñas y anótalas en \`TAREAS.md\` (Pendiente / En curso / Listo), con quién hace cada una y qué archivos toca.
2. Encarga cada tarea al agente que corresponde usando su subagente (${agents.map(a => '`' + a.slug + '`').join(' o ')}).
3. Si dos tareas no tocan los mismos archivos, lanza a los dos agentes **al mismo tiempo**. Nunca más de 2 a la vez.
4. Revisa lo que entrega cada agente, actualiza \`TAREAS.md\` y cuéntale al usuario el resultado.
5. No hagas tú el trabajo de un agente, salvo ajustes muy pequeños.
${END}`;
}

function tasksFile(boss, agents) {
  return `# Tareas del equipo

Pizarra compartida. ${boss.name} (jefe) la mantiene al día.
Equipo: ${agents.map(a => `${a.name} (${a.role})`).join(', ')}.

## Pendiente

## En curso

## Listo
`;
}

// ---------- estado en vivo ----------

/** Últimas líneas de un .jsonl sin leer el archivo entero. */
function tail(file, bytes = 256 * 1024) {
  let fd;
  try {
    fd = fs.openSync(file, 'r');
    const size = fs.fstatSync(fd).size;
    const start = Math.max(0, size - bytes);
    const buf = Buffer.alloc(size - start);
    fs.readSync(fd, buf, 0, buf.length, start);
    const lines = buf.toString('utf8').split('\n');
    if (start > 0) lines.shift(); // primera línea cortada
    return lines.map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
  } catch { return []; } finally { if (fd !== undefined) fs.closeSync(fd); }
}

const base = p => path.basename(String(p || ''));
const clip = (s, n = 90) => { s = oneLine(String(s || '')).trim(); return s.length > n ? s.slice(0, n) + '…' : s; };

/** Una acción de Claude en palabras: "✏️ Edita player.gd". */
export function describeTool(name, input = {}) {
  if (name === 'Read') return ['📖', 'Lee ' + base(input.file_path)];
  if (name === 'Edit' || name === 'MultiEdit') return ['✏️', 'Edita ' + base(input.file_path)];
  if (name === 'Write') return ['📝', 'Escribe ' + base(input.file_path)];
  if (name === 'NotebookEdit') return ['✏️', 'Edita ' + base(input.notebook_path)];
  if (name === 'Bash' || name === 'PowerShell') return ['⌨️', clip(input.description || input.command, 80)];
  if (name === 'Grep' || name === 'Glob') return ['🔎', 'Busca ' + clip(input.pattern, 50)];
  if (name === 'Agent' || name === 'Task') return ['📨', `Encarga a ${input.subagent_type || 'un agente'}: ${clip(input.description, 60)}`];
  if (name === 'WebFetch' || name === 'WebSearch') return ['🌐', clip(input.url || input.query, 70)];
  if (name === 'TodoWrite') return ['📋', 'Actualiza su lista de tareas'];
  if (name?.startsWith('mcp__')) { const [, srv, tool] = name.split('__'); return ['🔌', `${srv}: ${tool}`]; }
  return ['🛠', name];
}

const WRITES = new Set(['Edit', 'MultiEdit', 'Write', 'NotebookEdit']);
const CODE = /\.(gd|gdshader|js|mjs|cjs|ts|tsx|jsx|py|cs|cpp|cc|c|h|hpp|java|kt|go|rs|rb|php|lua|html|css|scss|json|sh|ps1|sql)$/i;
const ART = /\.(png|jpe?g|gif|webp|svg|bmp|aseprite|ase|psd|kra)$/i;

/** Pensamiento corto para el globo de la oficina: "Codeando player.gd", "Dibujando un sprite". */
export function thoughtOf(name, input = {}) {
  const f = clip(base(input.file_path || input.notebook_path), 28);
  if (WRITES.has(name)) return CODE.test(f) ? 'Codeando ' + f : ART.test(f) ? 'Dibujando ' + f
    : /\.(tscn|scn|tres)$/i.test(f) ? 'Armando la escena ' + f : /\.(md|txt)$/i.test(f) ? 'Escribiendo ' + f : 'Editando ' + f;
  if (name === 'Read') return 'Leyendo ' + f;
  if (name === 'Bash' || name === 'PowerShell') return 'Probando: ' + clip(input.description || input.command, 30);
  if (name === 'Grep' || name === 'Glob') return 'Buscando en el código';
  if (name === 'Agent' || name === 'Task') return 'Encargando a ' + (input.subagent_type || 'un agente');
  if (name === 'WebFetch' || name === 'WebSearch') return 'Investigando en internet';
  if (name === 'TodoWrite') return 'Ordenando sus tareas';
  if (name?.startsWith('mcp__')) {
    const [, srv, tool = ''] = name.split('__');
    return /sprite|art|image|draw|anim|tileset|character|ui_kit/i.test(tool) ? 'Dibujando un sprite' : 'Usando ' + srv;
  }
  return 'Trabajando';
}

/** Actividad legible de un transcript: [{ts, icon, text}] (las últimas `max`) y cuántos archivos escribió. */
export function feedOf(records, { includeUser = false, max = 40 } = {}) {
  const out = [];
  let writes = 0;
  for (const r of records) {
    if (r.type === 'assistant' && Array.isArray(r.message?.content)) {
      for (const p of r.message.content) {
        if (p.type === 'tool_use') {
          if (WRITES.has(p.name)) writes++;
          const [icon, t] = describeTool(p.name, p.input);
          out.push({ ts: r.timestamp, icon, text: t, th: thoughtOf(p.name, p.input) });
        } else if (p.type === 'text' && p.text?.trim()) out.push({ ts: r.timestamp, icon: '💬', text: clip(p.text, 140), th: 'Escribiendo el resumen' });
      }
    } else if (includeUser && r.type === 'user' && !r.isMeta && typeof r.message?.content === 'string' && !r.message.content.startsWith('<')) {
      const t = readable(r.message.content);
      if (t) out.push({ ts: r.timestamp, icon: '🧑', text: 'Tú: ' + clip(t, 140), th: 'Leyendo tu pedido', user: true });
    }
  }
  return { feed: out.slice(-max), writes };
}

/** Carpeta de ~/.claude/projects donde Claude Code guarda las sesiones de `dir` ("D:\\Juego" -> "D--Juego"). */
const projectKey = dir => path.resolve(dir).replace(/[^a-zA-Z0-9]/g, '-');
const sameDir = (a, b) => path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase();

/** Estado del equipo: quién trabaja, quién duerme y qué hizo cada uno. */
export function teamStatus(dir) {
  const team = readTeam(dir);
  if (!team) return null;
  const pdir = path.join(CLAUDE_DIR, 'projects', projectKey(dir));

  // Sesión del jefe: la viva más reciente en esta carpeta; si no hay, la última guardada.
  let live = null;
  for (const [sessionId, s] of liveSessions()) {
    if (s.cwd && sameDir(s.cwd, dir) && (!live || (s.updatedAt || 0) > (live.updatedAt || 0))) live = { sessionId, ...s };
  }
  let sessionId = live?.sessionId;
  if (!sessionId) {
    try {
      sessionId = fs.readdirSync(pdir).filter(f => f.endsWith('.jsonl'))
        .map(f => ({ f, t: fs.statSync(path.join(pdir, f)).mtimeMs })).sort((a, b) => b.t - a.t)[0]?.f.slice(0, -6);
    } catch {}
  }

  const boss = { key: 'boss', name: team.boss.name, role: 'Jefe', state: live?.status === 'busy' ? 'working' : 'idle', feed: [], writes: 0, since: null };
  const agents = team.agents.map(a => ({ key: a.slug, name: a.name, role: a.role, state: 'idle', feed: [], writes: 0, finishedAt: null, since: null }));
  if (sessionId) {
    Object.assign(boss, feedOf(tail(path.join(pdir, sessionId + '.jsonl')), { includeUser: true }));
    // El jefe trabaja desde tu último pedido. En sus pensamientos, el nombre del agente en vez de su archivo.
    if (boss.state === 'working') boss.since = boss.feed.findLast(f => f.user)?.ts || null;
    for (const f of boss.feed) for (const a of agents) if (f.th === 'Encargando a ' + a.key) f.th = 'Encargando a ' + a.name;
    // Subagentes de esa sesión: el más reciente de cada tipo dice si ese agente sigue trabajando.
    const sub = path.join(pdir, sessionId, 'subagents');
    let metas = [];
    try {
      metas = fs.readdirSync(sub).filter(n => n.endsWith('.meta.json')).map(n => {
        const file = path.join(sub, n);
        try { return { id: n.slice(0, -10), mtime: fs.statSync(file).mtimeMs, ...JSON.parse(fs.readFileSync(file, 'utf8')) }; } catch { return null; }
      }).filter(Boolean);
    } catch {}
    for (const a of agents) {
      const mine = metas.filter(m => m.agentType === a.key).sort((x, y) => y.mtime - x.mtime);
      if (!mine.length) continue;
      const last = mine[0];
      // Sin la sesión viva, un "finished: false" es de una sesión que se cortó: no está trabajando.
      a.state = live && last.finished === false ? 'working' : 'idle';
      if (last.finished !== false) a.finishedAt = new Date(last.mtime).toISOString();
      else { // empezó cuando se creó el archivo de su tarea
        try { a.since = new Date(fs.statSync(path.join(sub, last.id + '.meta.json')).birthtimeMs).toISOString(); } catch {}
      }
      const records = tail(path.join(sub, last.id + '.jsonl'));
      Object.assign(a, feedOf(records));
    }
  }
  return { team, live: !!live, members: [boss, ...agents] };
}
