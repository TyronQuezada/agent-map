// Hook oficial de Claude Code (E1): estado de las sesiones a partir de ~/.agent-map/events/<session>.jsonl, que escribe
// agentmap-hook, más la instalación EXPLÍCITA del hook en la carpeta de un proyecto (.claude/settings.local.json).
// Agent Map nunca instala el hook por su cuenta: solo cuando el usuario lo pide para una carpeta.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { USAGE_FILE } from '../statusline-tap.js';
import { JsonlTail } from './jsonl.js';
import { HOOK_EVENTS, HOOK_VERSION } from './agentmap-hook.js';

export { HOOK_EVENTS };
const AM_DIR = path.dirname(USAGE_FILE);
export const HOOK_FILE = path.join(AM_DIR, 'agentmap-hook.mjs');
export const EVENTS_DIR = path.join(AM_DIR, 'events');
const SOURCE = path.join(path.dirname(fileURLToPath(import.meta.url)), 'agentmap-hook.js');
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DUP_MS = 60_000;         // la misma entrega (mismo id) dentro de 1 min es un duplicado
const KEEP_DAYS = 30;          // registros de sesiones sin actividad en 30 días se borran (son de Agent Map)

/** Copia el hook a ~/.agent-map (solo si cambió). Es la carpeta propia de Agent Map: no toca nada de Claude Code. */
export function ensureHookFile() {
  const src = fs.readFileSync(SOURCE); // en la app empaquetada, fs de Electron lee dentro del asar
  let cur = null;
  try { cur = fs.readFileSync(HOOK_FILE); } catch {}
  if (cur?.equals(src)) return false;
  fs.mkdirSync(AM_DIR, { recursive: true });
  const tmp = HOOK_FILE + '.' + process.pid + '.tmp';
  fs.writeFileSync(tmp, src);
  fs.renameSync(tmp, HOOK_FILE);
  return true;
}

/** Comando que va en settings: shell (Git Bash o PowerShell en Windows), con barras / y entre comillas. */
export const hookCommand = () => `node "${HOOK_FILE.replace(/\\/g, '/')}"`;
const isOurs = h => typeof h?.command === 'string' && h.command.includes('agentmap-hook.mjs');

// ---------- estado a partir de los eventos ----------
const tracked = new Map(); // session -> { tail, st, seen: Map(id -> ts) }
const fresh = () => ({ status: null, statusAt: 0, lastEventAt: 0, ended: false, cwd: '', mode: '', tool: null,
  tools: {}, files: new Set(), failures: 0, agents: new Set(), events: 0, duplicates: 0, invalid: 0 });

// Notificaciones que significan "necesita que intervengas" (nombres oficiales de notification_type).
const NEEDS_YOU = new Set(['permission_prompt', 'elicitation_dialog', 'elicitation_url_dialog', 'agent_needs_input']);

/** Aplica un registro al estado de su sesión. Exportada para pruebas. */
export function applyEvent(st, rec, id, seen) {
  if (rec?.type !== 'hook' || rec.session !== id || !HOOK_EVENTS.includes(rec.event) || !Number.isFinite(rec.ts) || typeof rec.id !== 'string') {
    st.invalid++; return;
  }
  for (const [k, t] of seen) if (rec.ts - t > DUP_MS) seen.delete(k); // ventana corta: no crece sin límite
  const prev = seen.get(rec.id);
  if (prev !== undefined && Math.abs(rec.ts - prev) <= DUP_MS) { st.duplicates++; return; }
  seen.set(rec.id, rec.ts);
  st.events++;
  st.lastEventAt = Math.max(st.lastEventAt, rec.ts);
  if (rec.cwd) st.cwd = rec.cwd;
  if (rec.mode) st.mode = rec.mode;
  const set = s => { if (st.status !== s) { st.status = s; st.statusAt = rec.ts; } };
  const sub = !!rec.agent; // evento de un subagente: no cambia el estado de la sesión principal
  switch (rec.event) {
    case 'SessionStart': st.ended = false; if (!sub) set('idle'); break;
    case 'SessionEnd': st.ended = true; set('ended'); st.tool = null; st.agents.clear(); break;
    case 'UserPromptSubmit': st.ended = false; set('busy'); break;
    case 'PreToolUse':
      set('busy');
      if (rec.tool) { st.tool = rec.tool; st.tools[rec.tool] = (st.tools[rec.tool] || 0) + 1; }
      break;
    case 'PostToolUse':
    case 'PostToolUseFailure':
      set('busy'); st.tool = null;
      if (rec.event === 'PostToolUseFailure') st.failures++;
      if (rec.file && rec.event === 'PostToolUse' && st.files.size < 5000) st.files.add(rec.file);
      break;
    case 'PermissionRequest': set('waiting'); break;
    case 'Notification':
      if (NEEDS_YOU.has(rec.kind)) set('waiting');
      else if (rec.kind === 'idle_prompt') set('idle');
      break;
    case 'Stop': case 'StopFailure': if (!sub) { set('idle'); st.tool = null; } break;
    case 'SubagentStart': if (rec.agent) st.agents.add(rec.agent); break;
    case 'SubagentStop': if (rec.agent) st.agents.delete(rec.agent); break;
  }
}

/**
 * Lee lo nuevo de cada registro (incremental: solo los bytes agregados) y devuelve session -> estado.
 * Archivos a medio escribir, líneas inválidas o borradas no rompen nada: se omiten.
 */
export async function hookStates() {
  let names = [];
  try { names = (await fs.promises.readdir(EVENTS_DIR)).filter(n => n.endsWith('.jsonl') && UUID.test(n.slice(0, -6))); } catch {}
  const present = new Set(names.map(n => n.slice(0, -6).toLowerCase()));
  for (const id of tracked.keys()) if (!present.has(id)) tracked.delete(id); // registro borrado
  await Promise.all([...present].map(async id => {
    let t = tracked.get(id);
    if (!t) tracked.set(id, t = { tail: new JsonlTail(path.join(EVENTS_DIR, id + '.jsonl')), st: fresh(), seen: new Map() });
    try {
      const r = await t.tail.read(rec => applyEvent(t.st, rec, id, t.seen), () => { t.st = fresh(); t.seen.clear(); });
      t.st.invalid += Object.values(r.skipped).reduce((a, b) => a + b, 0);
    } catch (err) { if (err.code === 'ENOENT') tracked.delete(id); }
  }));
  return new Map([...tracked].map(([id, t]) => [id, t.st]));
}


/** Borra registros sin actividad en KEEP_DAYS días (son archivos propios de Agent Map). */
export async function pruneEvents(now = Date.now()) {
  let names = [];
  try { names = await fs.promises.readdir(EVENTS_DIR); } catch { return 0; }
  let n = 0;
  for (const name of names) {
    if (!name.endsWith('.jsonl')) continue;
    const f = path.join(EVENTS_DIR, name);
    try { if (now - (await fs.promises.stat(f)).mtimeMs > KEEP_DAYS * 86400e3) { await fs.promises.unlink(f); n++; } } catch {}
  }
  return n;
}

// ---------- diagnóstico ----------
/** ¿Está node en el PATH? El hook corre con `node`; sin él, Claude Code lo ignora (no bloquea). */
function nodeInPath() {
  const exts = process.platform === 'win32' ? ['.exe', '.cmd'] : [''];
  return (process.env.PATH || process.env.Path || '').split(path.delimiter).filter(Boolean)
    .some(d => exts.some(e => { try { return fs.statSync(path.join(d, 'node' + e)).isFile(); } catch { return false; } }));
}

export async function hookDiagnostics() {
  const states = await hookStates();
  let copied = false;
  try { copied = fs.readFileSync(HOOK_FILE).equals(fs.readFileSync(SOURCE)); } catch {}
  const last = Math.max(0, ...[...states.values()].map(s => s.lastEventAt));
  return { version: HOOK_VERSION, hookFile: HOOK_FILE, copied, command: hookCommand(), eventsDir: EVENTS_DIR, node: nodeInPath(),
    sessions: states.size, lastEventAt: last || null, events: HOOK_EVENTS };
}

// ---------- instalación explícita en un proyecto ----------
const settingsFile = dir => path.join(dir, '.claude', 'settings.local.json');

/** Carpeta válida para instalar: absoluta, existente, y no la carpeta del usuario, una raíz ni la de Claude o Agent Map. */
export function checkProjectDir(dir, claudeDir) {
  if (typeof dir !== 'string' || !path.isAbsolute(dir)) throw new Error('Carpeta inválida');
  const d = path.resolve(dir);
  let st;
  try { st = fs.statSync(d); } catch { throw new Error('La carpeta no existe'); }
  if (!st.isDirectory()) throw new Error('No es una carpeta');
  const same = (a, b) => path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase();
  const inside = (a, b) => same(a, b) || path.resolve(a).toLowerCase().startsWith(path.resolve(b).toLowerCase() + path.sep);
  if (same(d, path.parse(d).root)) throw new Error('No se instala en la raíz de una unidad');
  // En la carpeta del usuario, su .claude/settings es la configuración GLOBAL de Claude Code: nunca se toca.
  if (same(d, os.homedir())) throw new Error('No se instala en tu carpeta de usuario: afectaría a todos tus proyectos');
  if (inside(d, claudeDir) || inside(d, AM_DIR)) throw new Error('No se instala en la carpeta de Claude Code ni en la de Agent Map');
  return d;
}

function readSettings(file) {
  let txt;
  try { txt = fs.readFileSync(file, 'utf8'); } catch (err) { if (err.code === 'ENOENT') return { exists: false, data: {} }; throw err; }
  let data;
  try { data = JSON.parse(txt.replace(/^﻿/, '')); } catch { throw new Error(`${file} no es JSON válido: no se modifica`); }
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error(`${file} no es un objeto JSON: no se modifica`);
  if (data.hooks !== undefined && (typeof data.hooks !== 'object' || Array.isArray(data.hooks) || data.hooks === null)) throw new Error('"hooks" tiene un formato desconocido: no se modifica');
  return { exists: true, data, txt };
}

/** Lo que quedaría al instalar: agrega, para cada evento, un handler async de agentmap-hook (si no estaba). */
export function withHook(data) {
  const out = structuredClone(data);
  out.hooks ??= {};
  for (const ev of HOOK_EVENTS) {
    const groups = out.hooks[ev] ??= [];
    if (!Array.isArray(groups)) throw new Error(`"hooks.${ev}" tiene un formato desconocido: no se modifica`);
    if (groups.some(g => Array.isArray(g?.hooks) && g.hooks.some(isOurs))) continue; // ya instalado: idempotente
    // Sin matcher: todos. async: corre en segundo plano, nunca demora ni bloquea a Claude.
    groups.push({ hooks: [{ type: 'command', command: hookCommand(), async: true, timeout: 10 }] });
  }
  return out;
}

/** Lo que quedaría al desinstalar: quita solo los handlers de agentmap-hook; grupos y eventos vacíos se eliminan. */
export function withoutHook(data) {
  const out = structuredClone(data);
  if (!out.hooks) return out;
  for (const [ev, groups] of Object.entries(out.hooks)) {
    if (!Array.isArray(groups)) continue;
    const kept = groups.map(g => Array.isArray(g?.hooks) ? { ...g, hooks: g.hooks.filter(h => !isOurs(h)) } : g)
      .filter(g => !Array.isArray(g?.hooks) || g.hooks.length);
    if (kept.length) out.hooks[ev] = kept; else delete out.hooks[ev];
  }
  if (!Object.keys(out.hooks).length) delete out.hooks;
  return out;
}

const installedIn = data => HOOK_EVENTS.every(ev => Array.isArray(data.hooks?.[ev]) && data.hooks[ev].some(g => Array.isArray(g?.hooks) && g.hooks.some(isOurs)));
const partlyIn = data => Object.values(data.hooks || {}).some(gs => Array.isArray(gs) && gs.some(g => Array.isArray(g?.hooks) && g.hooks.some(isOurs)));

/** Estado y vista previa (sin escribir nada): el archivo, si está instalado y el JSON exacto que quedaría. */
export function projectHook(dir, claudeDir) {
  const d = checkProjectDir(dir, claudeDir);
  const file = settingsFile(d);
  const cur = readSettings(file);
  return { dir: d, file, events: HOOK_EVENTS, command: hookCommand(), exists: cur.exists, installed: installedIn(cur.data), partial: !installedIn(cur.data) && partlyIn(cur.data),
    current: cur.exists ? cur.data : null, afterInstall: withHook(cur.data), afterUninstall: withoutHook(cur.data) };
}

function writeAtomic(file, text) {
  const tmp = file + '.' + process.pid + '.tmp';
  try { fs.writeFileSync(tmp, text); fs.renameSync(tmp, file); }
  catch (err) { try { fs.unlinkSync(tmp); } catch {} throw err; }
}

/**
 * Instala o desinstala en .claude/settings.local.json de esa carpeta (el archivo personal de Claude Code, que no se
 * comparte en git). Antes de cambiar un archivo que ya existía guarda una copia en settings.local.json.agentmap-backup.
 * Al desinstalar, si el archivo queda vacío y no había copia (lo creó Agent Map al instalar), se borra.
 */
export function setProjectHook(dir, claudeDir, install) {
  const d = checkProjectDir(dir, claudeDir);
  const file = settingsFile(d), backup = file + '.agentmap-backup';
  const cur = readSettings(file);
  const next = install ? withHook(cur.data) : withoutHook(cur.data);
  if (JSON.stringify(next) === JSON.stringify(cur.data) && (cur.exists || !install)) return { ...projectHook(d, claudeDir), changed: false };
  if (!install && !Object.keys(next).length && !fs.existsSync(backup)) {
    fs.unlinkSync(file); // lo había creado Agent Map y no queda nada: se vuelve a como estaba
  } else {
    if (cur.exists) fs.writeFileSync(backup, cur.txt);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    writeAtomic(file, JSON.stringify(next, null, 2) + '\n');
  }
  return { ...projectHook(d, claudeDir), changed: true };
}

/** Último evento recibido de sesiones de esa carpeta (diagnóstico "¿funciona en este proyecto?"), o null. */
export async function lastEventIn(dir) {
  const d = path.resolve(dir).toLowerCase();
  let last = 0;
  for (const st of (await hookStates()).values()) if (st.cwd && path.resolve(st.cwd).toLowerCase() === d) last = Math.max(last, st.lastEventAt);
  return last || null;
}
