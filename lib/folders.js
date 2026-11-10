// Explorador de carpetas para elegir dónde iniciar Claude. Solo lista y crea carpetas, nunca lee archivos.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

/** Puntos de partida: carpeta personal y discos (Windows) o raíz (resto). */
export function roots() {
  if (process.platform !== 'win32') return [os.homedir(), '/'];
  const drives = [];
  for (let c = 67; c <= 90; c++) { // C: a Z: (A:/B: son disqueteras y pueden bloquear)
    const d = String.fromCharCode(c) + ':\\';
    if (fs.existsSync(d)) drives.push(d);
  }
  return [os.homedir(), ...drives];
}

/** Subcarpetas de `dir` (rutas completas). Sin `dir` devuelve los puntos de partida. */
export async function listDirs(dir) {
  if (!dir) return { path: '', parent: null, dirs: roots() };
  if (!path.isAbsolute(dir)) throw new Error('La ruta debe ser absoluta');
  const full = path.resolve(dir);
  const entries = await fs.promises.readdir(full, { withFileTypes: true });
  const dirs = entries
    .filter(e => e.isDirectory() && !/^[.$]/.test(e.name)) // ocultas y de sistema ($Recycle.Bin…)
    .map(e => path.join(full, e.name))
    .sort((a, b) => a.localeCompare(b, 'es', { sensitivity: 'base' }));
  const parent = path.dirname(full);
  return { path: full, parent: parent === full ? '' : parent, dirs };
}

/** true si `dir` es una ruta absoluta a una carpeta que existe. */
export function isDir(dir) {
  try { return typeof dir === 'string' && path.isAbsolute(dir) && fs.statSync(dir).isDirectory(); } catch { return false; }
}

/** Crea `name` dentro de `parent`. El nombre no puede traer rutas ni caracteres inválidos en Windows. */
export async function makeDir(parent, name) {
  name = String(name ?? '').trim();
  if (!isDir(parent)) throw new Error('La carpeta de destino no existe');
  if (!name || name === '.' || name === '..' || /[<>:"/\\|?*\x00-\x1f]/.test(name) || /[. ]$/.test(name)) {
    throw new Error('Nombre de carpeta no válido');
  }
  const full = path.join(path.resolve(parent), name);
  await fs.promises.mkdir(full); // sin recursive: falla si ya existe
  return full;
}
