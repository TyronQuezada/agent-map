// Lee las sesiones de Claude Code desde ~/.claude (solo lectura, nunca escribe ahí).
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import readline from 'node:readline';

export const CLAUDE_DIR = process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Caché por archivo: solo se vuelve a parsear si cambió tamaño o fecha.
const cache = new Map();

/** Extrae el texto de un mensaje de usuario escrito por una persona (no tool_result). */
function humanText(msg) {
  const c = msg?.content;
  if (typeof c === 'string') return c;
  if (Array.isArray(c) && !c.some(p => p.type === 'tool_result')) {
    return c.filter(p => p.type === 'text').map(p => p.text).join('\n');
  }
  return '';
}

/** Quita lo que Claude Code mete en el prompt y no escribió la persona (recordatorios del sistema, marcas de pegado). */
export function readable(t) {
  return t.replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, '')
    .replace(/<\/?pasted_content[^>]*>/g, '')
    .replace(/\n{3,}/g, '\n\n').trim();
}

function clip(s, n = 220) {
  s = s.replace(/\s+/g, ' ').trim();
  return s.length > n ? s.slice(0, n) + '…' : s;
}

/** Parsea un .jsonl de sesión y devuelve resumen + estadísticas. */
export async function parseSession(file) {
  const s = {
    id: path.basename(file, '.jsonl'),
    title: '', aiTitle: '', cwd: '', branch: '', version: '',
    start: null, end: null,
    prompts: 0, firstPrompt: '', lastPrompt: '',
    assistantMsgs: 0,
    tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    models: {}, tools: {}, agentCalls: {},
  };
  const seenMsg = new Set();
  const rl = readline.createInterface({ input: fs.createReadStream(file, 'utf8'), crlfDelay: Infinity });
  for await (const line of rl) {
    if (!line) continue;
    let r;
    try { r = JSON.parse(line); } catch { continue; } // línea a medio escribir
    if (r.timestamp) {
      if (!s.start || r.timestamp < s.start) s.start = r.timestamp;
      if (!s.end || r.timestamp > s.end) s.end = r.timestamp;
    }
    if (r.cwd && !s.cwd) s.cwd = r.cwd;
    if (r.gitBranch) s.branch = r.gitBranch;
    if (r.version) s.version = r.version;
    switch (r.type) {
      case 'custom-title': s.title = r.customTitle || s.title; break;
      case 'ai-title': s.aiTitle = r.aiTitle || s.aiTitle; break;
      case 'user': {
        if (r.isMeta || r.isSidechain) break;
        const raw = humanText(r.message);
        if (!raw || raw.startsWith('<') || raw.startsWith('Caveat:')) break; // comandos/sistema
        const t = readable(raw);
        if (!t) break;
        s.prompts++;
        if (!s.firstPrompt) s.firstPrompt = clip(t);
        s.lastPrompt = clip(t);
        break;
      }
      case 'assistant': {
        const m = r.message;
        if (!m || r.isSidechain) break;
        // Un mismo mensaje llega partido en varias líneas con el mismo id y el mismo usage.
        if (m.id && !seenMsg.has(m.id)) {
          seenMsg.add(m.id);
          s.assistantMsgs++;
          if (m.model && !m.model.startsWith('<')) s.models[m.model] = (s.models[m.model] || 0) + 1;
          const u = m.usage || {};
          s.tokens.input += u.input_tokens || 0;
          s.tokens.output += u.output_tokens || 0;
          s.tokens.cacheRead += u.cache_read_input_tokens || 0;
          s.tokens.cacheWrite += u.cache_creation_input_tokens || 0;
        }
        for (const p of Array.isArray(m.content) ? m.content : []) {
          if (p.type !== 'tool_use') continue;
          const name = p.name?.startsWith('mcp__') ? 'MCP: ' + p.name.split('__')[1] : p.name;
          s.tools[name] = (s.tools[name] || 0) + 1;
          if ((p.name === 'Agent' || p.name === 'Task') && p.input) {
            const type = p.input.subagent_type || 'general-purpose';
            s.agentCalls[type] = (s.agentCalls[type] || 0) + 1;
          }
        }
        break;
      }
    }
  }
  return s;
}

/**
 * Conversación legible: prompts de la persona y respuestas de texto de Claude, en orden.
 * Sin herramientas, razonamiento interno ni subagentes. No se cachea: se lee al pedirla.
 */
export async function readMessages(file) {
  const out = [];
  const rl = readline.createInterface({ input: fs.createReadStream(file, 'utf8'), crlfDelay: Infinity });
  for await (const line of rl) {
    let r;
    try { r = JSON.parse(line); } catch { continue; } // línea vacía o a medio escribir
    if (r.isSidechain || r.isMeta) continue;
    if (r.type === 'user') {
      const raw = humanText(r.message);
      if (!raw || raw.startsWith('<') || raw.startsWith('Caveat:')) continue; // comandos/sistema
      const text = readable(raw);
      if (text) out.push({ role: 'user', text, ts: r.timestamp || null });
    } else if (r.type === 'assistant' && Array.isArray(r.message?.content)) {
      const text = r.message.content.filter(p => p.type === 'text').map(p => p.text).join('\n').trim();
      if (!text) continue;
      // Un mismo mensaje llega partido en varias líneas con el mismo id: se une en uno.
      const prev = out[out.length - 1];
      if (prev?.role === 'assistant' && prev.id && prev.id === r.message.id) prev.text += '\n\n' + text;
      else out.push({ role: 'assistant', text, ts: r.timestamp || null, id: r.message.id });
    }
  }
  return out.map(({ id, ...m }) => m);
}

/** Lista los subagentes (sesiones hijas) guardados junto a la sesión. */
function readSubagents(sessionDir) {
  const dir = path.join(sessionDir, 'subagents');
  let names;
  try { names = fs.readdirSync(dir); } catch { return []; }
  return names.filter(n => n.endsWith('.meta.json')).map(n => {
    try {
      const meta = JSON.parse(fs.readFileSync(path.join(dir, n), 'utf8'));
      const stat = fs.statSync(path.join(dir, n));
      return {
        id: n.replace('.meta.json', ''),
        type: meta.agentType || 'agente',
        description: meta.description || '',
        finished: meta.finished !== false,
        time: stat.mtime.toISOString(),
      };
    } catch { return null; }
  }).filter(Boolean).sort((a, b) => a.time.localeCompare(b.time));
}

/** Sesiones con un proceso de Claude vivo ahora mismo (~/.claude/sessions/<pid>.json). */
export function liveSessions() {
  const dir = path.join(CLAUDE_DIR, 'sessions');
  const live = new Map();
  let names = [];
  try { names = fs.readdirSync(dir).filter(n => /^\d+\.json$/.test(n)); } catch { return live; }
  for (const n of names) {
    try {
      const j = JSON.parse(fs.readFileSync(path.join(dir, n), 'utf8'));
      process.kill(j.pid, 0); // lanza si el proceso ya no existe
      live.set(j.sessionId, { pid: j.pid, status: j.status || 'idle', name: j.name || '', entrypoint: j.entrypoint || '' });
    } catch { /* proceso muerto o archivo ilegible */ }
  }
  return live;
}

/** Recorre todos los proyectos y devuelve el árbol proyecto → sesiones → subagentes. */
export async function scanAll() {
  const root = path.join(CLAUDE_DIR, 'projects');
  let dirs = [];
  try { dirs = fs.readdirSync(root, { withFileTypes: true }).filter(d => d.isDirectory()); } catch { return []; }
  const live = liveSessions();
  const projects = new Map();
  for (const d of dirs) {
    const pdir = path.join(root, d.name);
    for (const f of fs.readdirSync(pdir)) {
      if (!f.endsWith('.jsonl') || !UUID.test(f.slice(0, -6))) continue;
      const file = path.join(pdir, f);
      const st = fs.statSync(file);
      const key = st.size + ':' + st.mtimeMs;
      let entry = cache.get(file);
      if (!entry || entry.key !== key) {
        entry = { key, data: await parseSession(file) };
        cache.set(file, entry);
      }
      const s = { ...entry.data };
      if (!s.prompts && !s.assistantMsgs) continue; // sesión vacía
      s.end = s.end || st.mtime.toISOString();
      s.subagents = readSubagents(path.join(pdir, s.id));
      s.live = live.get(s.id) || null;
      s.dirKey = d.name; // carpeta real del .jsonl (un mismo cwd puede venir de varias)
      const cwd = s.cwd || d.name;
      if (!projects.has(cwd)) projects.set(cwd, { key: d.name, cwd, name: path.basename(cwd) || cwd, sessions: [] });
      projects.get(cwd).sessions.push(s);
    }
  }
  const list = [...projects.values()];
  for (const p of list) {
    p.sessions.sort((a, b) => b.end.localeCompare(a.end));
    p.last = p.sessions[0]?.end || '';
  }
  return list.sort((a, b) => b.last.localeCompare(a.last));
}

/** Plugin instalado -> URL de su repo (desde el marketplace del que viene). */
export function pluginRepos() {
  const read = f => { try { return JSON.parse(fs.readFileSync(path.join(CLAUDE_DIR, 'plugins', f), 'utf8')); } catch { return {}; } };
  const markets = read('known_marketplaces.json');
  const out = {};
  for (const id of Object.keys(read('installed_plugins.json').plugins || {})) {
    const [name, market] = id.split('@');
    const src = markets[market]?.source || {};
    const url = src.source === 'github' && src.repo ? `https://github.com/${src.repo}` : src.url;
    if (url && /^https:\/\//.test(url)) out[name] = url.replace(/\.git$/, '');
  }
  return out;
}

/** Nombre del plan desde ~/.claude.json (solo campos de cuenta, nunca credenciales). null si no hay login de claude.ai. */
export function planInfo() {
  const file = process.env.CLAUDE_CONFIG_DIR ? path.join(process.env.CLAUDE_CONFIG_DIR, '.claude.json') : path.join(os.homedir(), '.claude.json');
  let acc;
  try { acc = JSON.parse(fs.readFileSync(file, 'utf8')).oauthAccount; } catch { return null; }
  return acc ? planName(acc) : null;
}

/** "claude_pro" -> "Pro"; "claude_max" + tier "..._max_20x" -> "Max 20x". */
export function planName(acc) {
  const type = String(acc.organizationType || '').replace(/^claude_/, '');
  if (!type) return null;
  const mult = String(acc.userRateLimitTier || acc.organizationRateLimitTier || '').match(/_(\d+x)$/);
  return {
    name: type.charAt(0).toUpperCase() + type.slice(1) + (mult ? ' ' + mult[1] : ''),
    extraUsage: !!acc.hasExtraUsageEnabled,
  };
}

export function isUuid(s) { return UUID.test(s); }
