// Explorador de carpetas para elegir dónde iniciar Claude. Solo lista y crea carpetas, nunca lee archivos.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

/** Puntos de partida: carpeta personal y discos (Windows) o raíz (resto). */
export async function roots() {
  if (process.platform !== 'win32') return [os.homedir(), '/'];
  // C: a Z: (A:/B: son disqueteras). Asíncrono y en paralelo: una unidad de red desconectada puede tardar
  // segundos en responder y no debe trabar la app.
  const letters = Array.from({ length: 24 }, (_, i) => String.fromCharCode(67 + i) + ':\\');
  const ok = await Promise.all(letters.map(d => fs.promises.access(d).then(() => true, () => false)));
  return [os.homedir(), ...letters.filter((_, i) => ok[i])];
}

/** Subcarpetas de `dir` (rutas completas). Sin `dir` devuelve los puntos de partida. */
export async function listDirs(dir) {
  if (!dir) return { path: '', parent: null, dirs: await roots() };
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
