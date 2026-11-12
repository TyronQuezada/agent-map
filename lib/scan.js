// Lee las sesiones de Claude Code desde ~/.claude (solo lectura, nunca escribe ahí).
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { JsonlTail, readAll } from './jsonl.js';

export const CLAUDE_DIR = process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Resumen de cada sesión, actualizado de forma incremental: solo se procesan las líneas nuevas.
// archivo -> { tail, acc }. Se libera cuando el archivo deja de aparecer en el escaneo.
const summaries = new Map();
// Conversaciones abiertas hace poco (incrementales también). Pocas: pueden pesar varios MB de texto.
const conversations = new Map();
const MAX_CONVERSATIONS = 6;

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

// ---------- resumen de sesión: estado acumulado + un paso por registro ----------
function newSummary(file) {
  const s = {
    id: path.basename(file, '.jsonl'),
    title: '', aiTitle: '', cwd: '', branch: '', version: '',
    start: null, end: null,
    prompts: 0, firstPrompt: '', lastPrompt: '',
    assistantMsgs: 0,
    claudeMsgs: 0, // respuestas de Claude que muestra la conversación (mismo criterio que readMessages): para los avisos de "nuevo"
    tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    models: {}, tools: {}, agentCalls: {},
  };
  // seenMsg: ids de mensajes de Claude ya contados; lastChat: { role, id } del último mensaje contado.
  return { s, seenMsg: new Set(), lastChat: null };
}

function addToSummary(acc, r) {
  const s = acc.s;
  const seenMsg = acc.seenMsg;
  {
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
        acc.lastChat = { role: 'user' };
        if (!s.firstPrompt) s.firstPrompt = clip(t);
        s.lastPrompt = clip(t);
        break;
      }
      case 'assistant': {
        const m = r.message;
        if (!m || r.isSidechain) break;
        // Igual que readMessages: los trozos de texto seguidos de un mismo mensaje cuentan como uno.
        const hasText = !r.isMeta && Array.isArray(m.content) && m.content.some(p => p.type === 'text' && p.text?.trim());
        const last = acc.lastChat;
        if (hasText && !(last?.role === 'assistant' && last.id && last.id === m.id)) s.claudeMsgs++;
        if (hasText) acc.lastChat = { role: 'assistant', id: m.id };
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
}

/** Copia del resumen para entregar (el acumulado sigue creciendo y no debe tocarse desde afuera). */
const summaryView = ({ s }) => ({ ...s, tokens: { ...s.tokens }, models: { ...s.models }, tools: { ...s.tools }, agentCalls: { ...s.agentCalls } });

// ---------- registros inesperados: se cuentan y se avisan, nunca tumban la sesión ----------
// Lo mismo en la lectura completa y en la incremental, para que sigan dando idéntico resultado.
// El aviso solo lleva el nombre del archivo y los motivos: nunca contenido de la conversación.
const warn = msg => console.warn('[agent-map] ' + msg);
function guarded(file, fn) {
  const failed = {}; // tipo de registro -> veces que procesarlo lanzó
  const cb = r => {
    try { fn(r); } catch (err) { const k = `${r.type} (${err.name})`; failed[k] = (failed[k] || 0) + 1; }
  };
  cb.report = res => {
    const bad = Object.keys(res.skipped).length ? ` ${JSON.stringify(res.skipped)} ignorados` : '';
    const err = Object.keys(failed).length ? ` ${JSON.stringify(failed)} con error al procesar` : '';
    if (bad || err) warn(`${path.basename(file)}: registros inesperados:${bad}${err}`);
    return res;
  };
  return cb;
}

/** Parsea un .jsonl de sesión completo y devuelve resumen + estadísticas (sin caché). */
export async function parseSession(file) {
  const acc = newSummary(file);
  const cb = guarded(file, r => addToSummary(acc, r));
  cb.report(await readAll(file, cb));
  return summaryView(acc);
}

/** Igual que parseSession, pero recuerda dónde quedó: la próxima vez procesa solo lo nuevo. */
export async function sessionSummary(file) {
  let e = summaries.get(file);
  if (!e) summaries.set(file, e = { tail: new JsonlTail(file), acc: newSummary(file) });
  const cb = guarded(file, r => addToSummary(e.acc, r));
  try {
    cb.report(await e.tail.read(cb, () => { e.acc = newSummary(file); }));
  } catch (err) {
    if (summaries.get(file) === e) summaries.delete(file); // desapareció o no se puede leer: se olvida
    throw err;
  }
  return summaryView(e.acc);
}

// ---------- conversación legible ----------
function addToMessages(out, r) {
  if (r.isSidechain || r.isMeta) return;
  if (r.type === 'user') {
    const raw = humanText(r.message);
    if (!raw || raw.startsWith('<') || raw.startsWith('Caveat:')) return; // comandos/sistema
    const text = readable(raw);
    if (text) out.push({ role: 'user', text, ts: r.timestamp || null });
  } else if (r.type === 'assistant' && Array.isArray(r.message?.content)) {
    const text = r.message.content.filter(p => p.type === 'text').map(p => p.text).join('\n').trim();
    if (!text) return;
    // Un mismo mensaje llega partido en varias líneas con el mismo id: se une en uno.
    const prev = out[out.length - 1];
    if (prev?.role === 'assistant' && prev.id && prev.id === r.message.id) prev.text += '\n\n' + text;
    else out.push({ role: 'assistant', text, ts: r.timestamp || null, id: r.message.id });
  }
}
const messagesView = out => out.map(({ id, ...m }) => m);

/**
 * Conversación legible: prompts de la persona y respuestas de texto de Claude, en orden.
 * Sin herramientas, razonamiento interno ni subagentes. Se recuerdan las últimas conversaciones
 * abiertas: al volver a pedirla solo se leen las líneas nuevas.
 */
export async function readMessages(file) {
  let e = conversations.get(file);
  if (e) conversations.delete(file); // se reinserta al final: la más usada queda última
  else e = { tail: new JsonlTail(file), out: [] };
  conversations.set(file, e);
  while (conversations.size > MAX_CONVERSATIONS) conversations.delete(conversations.keys().next().value);
  const cb = guarded(file, r => addToMessages(e.out, r));
  try {
    cb.report(await e.tail.read(cb, () => { e.out = []; }));
  } catch (err) {
    if (conversations.get(file) === e) conversations.delete(file); // no borrar una entrada más nueva
    throw err;
  }
  return messagesView(e.out);
}

/** Conversación completa leída de una vez (sin caché); para comparar en las pruebas. */
export async function readMessagesFull(file) {
  const out = [];
  const cb = guarded(file, r => addToMessages(out, r));
  cb.report(await readAll(file, cb));
  return messagesView(out);
}

/** Lista los subagentes (sesiones hijas) guardados junto a la sesión. */
async function readSubagents(sessionDir) {
  const dir = path.join(sessionDir, 'subagents');
  let names;
  try { names = await fs.promises.readdir(dir); } catch { return []; } // casi siempre: no hay carpeta
  const list = await Promise.all(names.filter(n => n.endsWith('.meta.json')).map(async n => {
    try {
      const meta = JSON.parse(await fs.promises.readFile(path.join(dir, n), 'utf8'));
      const stat = await fs.promises.stat(path.join(dir, n));
      return {
        id: n.replace('.meta.json', ''),
        type: meta.agentType || 'agente',
        description: meta.description || '',
        finished: meta.finished !== false,
        time: stat.mtime.toISOString(),
      };
    } catch { return null; } // borrado o a medio escribir
  }));
  return list.filter(Boolean).sort((a, b) => a.time.localeCompare(b.time));
}

/** Sesiones con un proceso de Claude vivo ahora mismo (~/.claude/sessions/<pid>.json). */
export async function liveSessions() {
  const dir = path.join(CLAUDE_DIR, 'sessions');
  const live = new Map();
  let names = [];
  try { names = (await fs.promises.readdir(dir)).filter(n => /^\d+\.json$/.test(n)); } catch { return live; }
  const files = await Promise.all(names.map(n => fs.promises.readFile(path.join(dir, n), 'utf8').catch(() => null)));
  for (const text of files) { // en el orden de readdir, como antes
    try {
      const j = JSON.parse(text);
      process.kill(j.pid, 0); // lanza si el proceso ya no existe (llamada al sistema instantánea)
      live.set(j.sessionId, { pid: j.pid, status: j.status || 'idle', name: j.name || '', entrypoint: j.entrypoint || '', cwd: j.cwd || '', updatedAt: j.updatedAt || 0,
        // ms Unix del último cambio de estado (busy/idle/waiting), no solo del fin de una ejecución. Opcional en Claude Code.
        statusUpdatedAt: Number.isFinite(j.statusUpdatedAt) ? j.statusUpdatedAt : null });
    } catch { /* proceso muerto o archivo ilegible */ }
  }
  return mergeHooks(live, await hookSource().catch(() => new Map()));
}

// Estado del hook oficial (lib/hooks.js). Lo conecta el servidor con useHookStates: scan.js no depende de ~/.agent-map.
let hookSource = async () => new Map();
export function useHookStates(fn) { hookSource = fn; }
/** Resumen apto para la página (sin rutas de archivos: solo cuántos). */
const activityOf = st => ({ tool: st.tool, tools: st.tools, files: st.files.size, failures: st.failures,
  agents: st.agents.size, lastEventAt: st.lastEventAt, events: st.events });

// Sesión que solo conoce el hook (sin sessions/<pid>.json): se considera abierta si su último evento es reciente.
const HOOK_ONLY_MS = 5 * 60_000;
/**
 * Combina el estado de sessions/*.json con el del hook oficial (~/.agent-map/events). Gana el cambio de estado más
 * reciente; sin hook, todo queda como antes (respaldo). "Abierta o cerrada" sigue saliendo del proceso vivo (pid)
 * cuando existe sessions/<pid>.json. Exportada para pruebas.
 */
export function mergeHooks(live, hooks, now = Date.now()) {
  for (const [id, h] of hooks) {
    if (!h.events) continue;
    const cur = live.get(id);
    if (cur) {
      cur.activity = activityOf(h);
      // ended con el proceso vivo: manda el proceso (puede ser un /clear que abrió otra sesión en el mismo pid)
      if (h.status && h.status !== 'ended' && h.statusAt >= (cur.statusUpdatedAt || 0)) {
        cur.status = h.status; cur.statusUpdatedAt = h.statusAt; cur.source = 'hook';
      }
    } else if (!h.ended && h.status && now - h.lastEventAt < HOOK_ONLY_MS) {
      live.set(id, { pid: null, status: h.status, name: '', entrypoint: '', cwd: h.cwd, updatedAt: h.lastEventAt,
        statusUpdatedAt: h.statusAt, source: 'hook', activity: activityOf(h) });
    }
  }
  return live;
}

/** Recorre todos los proyectos y devuelve el árbol proyecto → sesiones → subagentes. */
export async function scanAll() {
  const root = path.join(CLAUDE_DIR, 'projects');
  let dirs = [];
  try { dirs = (await fs.promises.readdir(root, { withFileTypes: true })).filter(d => d.isDirectory()); } catch { return []; }
  const live = await liveSessions();
  const projects = new Map();
  const present = new Set();
  for (const d of dirs) {
    const pdir = path.join(root, d.name);
    let names = [];
    try { names = await fs.promises.readdir(pdir); } catch { continue; } // carpeta borrada mientras se escaneaba
    // Archivo por archivo, en orden: cada sesión tiene su propio lector incremental con su cola.
    for (const f of names) {
      if (!f.endsWith('.jsonl') || !UUID.test(f.slice(0, -6))) continue;
      const file = path.join(pdir, f);
      let st, s;
      try { st = await fs.promises.stat(file); s = await sessionSummary(file); } catch { continue; } // desapareció: se salta
      present.add(file);
      if (!s.prompts && !s.assistantMsgs) continue; // sesión vacía
      s.end = s.end || st.mtime.toISOString();
      s.subagents = await readSubagents(path.join(pdir, s.id));
      s.live = live.get(s.id) || null;
      s.dirKey = d.name; // carpeta real del .jsonl (un mismo cwd puede venir de varias)
      const cwd = s.cwd || d.name;
      if (!projects.has(cwd)) projects.set(cwd, { key: d.name, cwd, name: path.basename(cwd) || cwd, sessions: [] });
      projects.get(cwd).sessions.push(s);
    }
  }
  for (const file of summaries.keys()) if (!present.has(file)) summaries.delete(file); // libera sesiones borradas
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

// ~/.claude.json guarda también el historial de cada proyecto y crece con el uso: se vuelve a leer y
// parsear solo cuando cambia (mismo tamaño y fecha = mismo resultado).
let planCache = { key: null, value: null };
/** Nombre del plan desde ~/.claude.json (solo campos de cuenta, nunca credenciales). null si no hay login de claude.ai. */
export async function planInfo() {
  const file = process.env.CLAUDE_CONFIG_DIR ? path.join(process.env.CLAUDE_CONFIG_DIR, '.claude.json') : path.join(os.homedir(), '.claude.json');
  let key;
  try { const st = await fs.promises.stat(file); key = `${file}|${st.size}|${st.mtimeMs}`; } catch { return null; }
  if (planCache.key !== key) {
    let acc;
    try { acc = JSON.parse(await fs.promises.readFile(file, 'utf8')).oauthAccount; } catch { return null; }
    planCache = { key, value: acc ? planName(acc) : null };
  }
  return planCache.value && { ...planCache.value }; // copia: quien la reciba no puede tocar la caché
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
