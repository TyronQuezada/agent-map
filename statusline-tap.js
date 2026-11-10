#!/usr/bin/env node
// Intermediario de statusline: guarda los límites del plan (rate_limits) que Claude Code entrega
// por stdin y luego ejecuta tu statusline de siempre con la misma entrada, sin cambiar lo que ves.
// Uso en settings.json: "command": "node <ruta>/statusline-tap.js <tu comando de statusline...>"
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// Fuera de la carpeta del programa: la app instalada no puede escribir dentro de sí misma.
export const USAGE_FILE = process.env.AGENT_MAP_USAGE_FILE || path.join(os.homedir(), '.agent-map', 'usage.json');

/** Extrae solo las ventanas de uso (nada de la sesión ni rutas). null si no vienen. */
export function pickLimits(payload) {
  const rl = payload?.rate_limits;
  const win = w => w && Number.isFinite(w.used_percentage) && Number.isFinite(w.resets_at)
    ? { used_percentage: w.used_percentage, resets_at: w.resets_at } : undefined;
  const out = { five_hour: win(rl?.five_hour), seven_day: win(rl?.seven_day) };
  return out.five_hour || out.seven_day ? out : null;
}

function save(limits) {
  fs.mkdirSync(path.dirname(USAGE_FILE), { recursive: true });
  const tmp = USAGE_FILE + '.' + process.pid + '.tmp';
  try {
    fs.writeFileSync(tmp, JSON.stringify({ ...limits, updatedAt: Date.now() }));
    fs.renameSync(tmp, USAGE_FILE); // atómico: Agent Map nunca lee un archivo a medias
  } catch (err) {
    try { fs.unlinkSync(tmp); } catch {}
    throw err;
  }
}

async function main() {
  let input = '';
  if (!process.stdin.isTTY) for await (const c of process.stdin) input += c;
  try { const limits = pickLimits(JSON.parse(input)); if (limits) save(limits); } catch { /* entrada vacía o rara: no guardar */ }

  const [cmd, ...args] = process.argv.slice(2);
  if (!cmd) return;
  const child = spawn(cmd, args, { stdio: ['pipe', 'inherit', 'inherit'], windowsHide: true });
  child.on('error', () => process.exit(0)); // si falla tu statusline, no romper la barra
  child.on('exit', code => process.exit(code ?? 0));
  child.stdin.end(input);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
