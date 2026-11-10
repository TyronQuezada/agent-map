// Preferencias de Agent Map (tema, letra, pantalla completa, nombres/colores de sesiones) en ~/.agent-map/prefs.json.
// Nunca se escribe en ~/.claude: renombrar una sesión aquí no cambia la conversación original.
import fs from 'node:fs';
import path from 'node:path';
import { USAGE_FILE } from '../statusline-tap.js';

export const PREFS_FILE = path.join(path.dirname(USAGE_FILE), 'prefs.json');
export const THEMES = ['xp', 'matrix', 'noche'];
export const COLORS = ['red', 'orange', 'yellow', 'green', 'teal', 'blue', 'purple', 'pink'];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const defaults = () => ({ theme: 'xp', fontSize: 13, startFullscreen: true, labels: {} });

export function readPrefs() {
  try {
    const p = { ...defaults(), ...JSON.parse(fs.readFileSync(PREFS_FILE, 'utf8')) };
    if (!p.labels || typeof p.labels !== 'object') p.labels = {};
    return p;
  } catch { return defaults(); } // sin archivo o ilegible: valores por defecto
}

/**
 * Aplica un cambio validado y lo guarda. Lanza Error con un mensaje para el usuario si algo no es válido.
 * patch: { theme?, fontSize?, startFullscreen?, label?: { id, name?, color?, pinned?, reset? } }
 */
export function updatePrefs(patch) {
  if (!patch || typeof patch !== 'object') throw new Error('Cambio inválido');
  const p = readPrefs();
  if ('theme' in patch) {
    if (!THEMES.includes(patch.theme)) throw new Error('Tema desconocido');
    p.theme = patch.theme;
  }
  if ('fontSize' in patch) {
    if (!Number.isInteger(patch.fontSize) || patch.fontSize < 10 || patch.fontSize > 22) throw new Error('Tamaño de letra fuera de rango (10–22)');
    p.fontSize = patch.fontSize;
  }
  if ('startFullscreen' in patch) {
    if (typeof patch.startFullscreen !== 'boolean') throw new Error('Valor inválido para pantalla completa');
    p.startFullscreen = patch.startFullscreen;
  }
  if ('label' in patch) {
    const l = patch.label || {};
    if (!UUID.test(String(l.id))) throw new Error('Sesión inválida');
    const cur = { ...p.labels[l.id] };
    if (l.reset) { delete p.labels[l.id]; return save(p); }
    if ('name' in l) {
      if (typeof l.name !== 'string' || l.name.length > 120) throw new Error('El nombre debe tener hasta 120 caracteres');
      const name = l.name.replace(/\s+/g, ' ').trim();
      if (name) cur.name = name; else delete cur.name;
    }
    if ('color' in l) {
      if (l.color !== null && !COLORS.includes(l.color)) throw new Error('Color desconocido');
      if (l.color) cur.color = l.color; else delete cur.color;
    }
    if ('pinned' in l) {
      if (typeof l.pinned !== 'boolean') throw new Error('Valor inválido para fijar');
      if (l.pinned) cur.pinned = true; else delete cur.pinned;
    }
    if (Object.keys(cur).length) p.labels[l.id] = cur; else delete p.labels[l.id];
  }
  return save(p);
}

function save(p) {
  fs.mkdirSync(path.dirname(PREFS_FILE), { recursive: true });
  const tmp = PREFS_FILE + '.' + process.pid + '.tmp';
  try {
    fs.writeFileSync(tmp, JSON.stringify(p, null, 2));
    fs.renameSync(tmp, PREFS_FILE); // atómico: nunca queda un archivo a medias
  } catch (err) {
    try { fs.unlinkSync(tmp); } catch {}
    throw err;
  }
  return p;
}
