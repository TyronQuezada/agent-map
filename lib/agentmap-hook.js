#!/usr/bin/env node
// agentmap-hook: recibe los hooks oficiales de Claude Code (un objeto JSON por stdin, ver
// https://code.claude.com/docs/en/hooks) y agrega UNA línea por evento en <carpeta de este archivo>/events/<session_id>.jsonl.
// Agent Map lo copia a ~/.agent-map/agentmap-hook.mjs, así que los eventos quedan en ~/.agent-map/events/.
//
// Reglas:
// - Solo metadatos: evento, sesión, carpeta, herramienta, ids, tipo de aviso y la ruta del archivo editado.
//   Nunca el prompt, la respuesta, el comando, el contenido de archivos, la salida de herramientas ni el texto del aviso.
// - Nunca escribe en stdout: en SessionStart y UserPromptSubmit Claude Code agregaría esa salida a la conversación.
// - Siempre sale con código 0 y en silencio, aunque la entrada sea inválida: nunca bloquea ni molesta a Claude.
// - Autónomo: solo módulos de Node (se copia solo, fuera del programa).
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const HOOK_VERSION = 1;
// Eventos que Agent Map pide al instalarse (nombres oficiales de Claude Code 2.1.x).
export const HOOK_EVENTS = ['SessionStart', 'SessionEnd', 'UserPromptSubmit', 'PreToolUse', 'PostToolUse', 'PostToolUseFailure',
  'PermissionRequest', 'Notification', 'Stop', 'StopFailure', 'SubagentStart', 'SubagentStop'];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_INPUT = 32 << 20; // una herramienta Write puede traer un archivo grande en tool_input: se lee, pero con tope
const FILE_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit']); // herramientas que modifican un archivo

const text = (v, max) => typeof v === 'string' && v ? v.slice(0, max) : undefined;
const num = v => Number.isFinite(v) && v >= 0 ? Math.round(v) : undefined;

/** Registro mínimo de un evento, o null si no es un hook válido. raw: el JSON tal como llegó (para el id). */
export function toRecord(p, raw, now = Date.now()) {
  if (!p || typeof p !== 'object' || Array.isArray(p)) return null;
  const event = p.hook_event_name;
  if (!HOOK_EVENTS.includes(event) || typeof p.session_id !== 'string' || !UUID.test(p.session_id)) return null;
  const r = {
    type: 'hook', v: HOOK_VERSION,
    id: crypto.createHash('sha1').update(raw).digest('hex').slice(0, 16), // misma entrega repetida = mismo id
    ts: now, event, session: p.session_id.toLowerCase(),
    cwd: text(p.cwd, 1024), agent: text(p.agent_id, 100), agentType: text(p.agent_type, 100), mode: text(p.permission_mode, 40),
  };
  if (['PreToolUse', 'PostToolUse', 'PostToolUseFailure', 'PermissionRequest'].includes(event)) {
    r.tool = text(p.tool_name, 120);
    r.toolUse = text(p.tool_use_id, 120);
    if (FILE_TOOLS.has(p.tool_name)) r.file = text(p.tool_input?.file_path ?? p.tool_input?.notebook_path, 1024);
    r.ms = num(p.duration_ms);
    if (event === 'PostToolUseFailure' && typeof p.is_interrupt === 'boolean') r.interrupted = p.is_interrupt;
  }
  if (event === 'Notification') r.kind = text(p.notification_type, 60);
  if (event === 'SessionStart') r.source = text(p.source, 40);
  if (event === 'SessionEnd') r.reason = text(p.reason, 60);
  for (const k of Object.keys(r)) if (r[k] === undefined) delete r[k];
  return r;
}

/** Carpeta de los registros: junto a este archivo (o AGENT_MAP_EVENTS_DIR, para pruebas). */
export const eventsDir = () => process.env.AGENT_MAP_EVENTS_DIR || path.join(path.dirname(fileURLToPath(import.meta.url)), 'events');

/** Agrega el registro como una sola línea. appendFile abre en modo "agregar al final": dos hooks a la vez no se pisan. */
export function writeRecord(rec, dir = eventsDir()) {
  fs.mkdirSync(dir, { recursive: true });
  fs.appendFileSync(path.join(dir, rec.session + '.jsonl'), JSON.stringify(rec) + '\n');
}

async function main() {
  let raw = '';
  process.stdin.setEncoding('utf8');
  for await (const chunk of process.stdin) { raw += chunk; if (raw.length > MAX_INPUT) return; }
  let payload;
  try { payload = JSON.parse(raw); } catch { return; }
  const rec = toRecord(payload, raw);
  if (rec) writeRecord(rec);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(() => {}).finally(() => process.exit(0));
}
