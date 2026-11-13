// ¿Está Claude Code disponible? El comando `claude` en el PATH (lo que ejecutan las terminales) y su carpeta de datos.
// Solo se mira el disco: nunca se ejecuta `claude` para comprobarlo.
import fs from 'node:fs';
import path from 'node:path';
import { CLAUDE_DIR } from './scan.js';

/**
 * Ruta del ejecutable `name` como lo encontraría la consola, o null. En Windows prueba cada extensión de PATHEXT
 * (claude.cmd, claude.exe…) en cada carpeta del PATH, en orden. Ojo: el PATH es el del proceso al arrancar; si
 * Claude Code se instala con la app abierta, hay que reiniciarla para que lo vea.
 */
export function findOnPath(name, env = process.env, platform = process.platform) {
  const key = Object.keys(env).find(k => k.toUpperCase() === 'PATH');
  const sep = platform === 'win32' ? ';' : ':';
  const dirs = String((key && env[key]) || '').split(sep).map(d => d.trim().replace(/^"(.*)"$/, '$1')).filter(Boolean);
  const pathext = Object.keys(env).find(k => k.toUpperCase() === 'PATHEXT');
  const exts = platform === 'win32' ? String((pathext && env[pathext]) || '.COM;.EXE;.BAT;.CMD').split(';').filter(Boolean) : [''];
  for (const dir of dirs) {
    for (const ext of exts) {
      const file = path.join(dir, name + ext.toLowerCase());
      try { if (fs.statSync(file).isFile()) return file; } catch { /* no está en esta carpeta */ }
    }
  }
  return null;
}

export const findClaude = () => findOnPath('claude');

/**
 * { cli: { found, path }, data: { state, dir, code } }. state de la carpeta de datos (~/.claude o CLAUDE_CONFIG_DIR):
 * 'ok' (existe; puede no tener sesiones todavía), 'missing' (no existe: Claude Code nunca se usó en este equipo con
 * este usuario) o 'error' (existe pero no se puede leer; code = EACCES, EPERM…).
 */
export async function claudeStatus() {
  const cli = findClaude();
  let state = 'ok', code = null;
  for (const dir of [CLAUDE_DIR, path.join(CLAUDE_DIR, 'projects')]) {
    try { await fs.promises.readdir(dir); } catch (err) {
      if (err.code === 'ENOENT') { if (dir === CLAUDE_DIR) state = 'missing'; } // sin projects: instalado, aún sin sesiones
      else { state = 'error'; code = err.code || 'error'; }
      break;
    }
  }
  return { cli: { found: !!cli, path: cli }, data: { state, dir: CLAUDE_DIR, code } };
}
