// Preferencias de Agent Map (tema, letra, pantalla completa, nombres/colores de sesiones, sonidos) en ~/.agent-map/prefs.json.
// Nunca se escribe en ~/.claude: renombrar una sesión aquí no cambia la conversación original.
import fs from 'node:fs';
import path from 'node:path';
import { USAGE_FILE } from '../statusline-tap.js';

export const PREFS_FILE = path.join(path.dirname(USAGE_FILE), 'prefs.json');
export const THEMES = ['xp', 'matrix', 'noche'];
export const COLORS = ['red', 'orange', 'yellow', 'green', 'teal', 'blue', 'purple', 'pink'];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// Sonidos: archivos de audio del disco local (~/.agent-map/sounds o, en desarrollo, Sounds/ junto al código).
// No vienen con la app: estos son solo los nombres sugeridos por defecto; se puede elegir cualquier archivo propio.
export const SOUND_FILES = ['messenger-tono-mensaje.mp3', 'msn-alert.mp3', 'msn-online.mp3', 'nudge-nudge-msn.mp3'];
// Nombre de archivo simple (sin carpetas ni caracteres prohibidos en Windows) con extensión de audio.
export const isSoundName = n => typeof n === 'string' && /^[^\\/:*?"<>|\x00-\x1f]{1,80}\.(mp3|wav|ogg)$/i.test(n)
  && !n.startsWith('.') && !/^(con|prn|aux|nul|com\d|lpt\d)(\.|$)/i.test(n);
export const SOUND_KINDS = ['message', 'finished', 'toast'];
const soundDefaults = () => ({ volume: 0.7, message: { on: true, file: 'messenger-tono-mensaje.mp3' },
  finished: { on: true, file: 'msn-online.mp3' }, toast: { on: true, file: 'nudge-nudge-msn.mp3' } });
const defaults = () => ({ theme: 'xp', fontSize: 13, startFullscreen: true, labels: {}, sounds: soundDefaults() });

// Lo guardado a mano o por una versión vieja: cada valor inválido o ausente vuelve a su valor por defecto.
function normSounds(x) {
  const d = soundDefaults();
  if (!x || typeof x !== 'object') return d;
  if (Number.isFinite(x.volume) && x.volume >= 0 && x.volume <= 1) d.volume = x.volume;
  for (const k of SOUND_KINDS) {
    const v = x[k];
    if (!v || typeof v !== 'object') continue;
    if (typeof v.on === 'boolean') d[k].on = v.on;
    if (isSoundName(v.file)) d[k].file = v.file;
  }
  return d;
}

export function readPrefs() {
  try {
    const p = { ...defaults(), ...JSON.parse(fs.readFileSync(PREFS_FILE, 'utf8')) };
    if (!p.labels || typeof p.labels !== 'object') p.labels = {};
    p.sounds = normSounds(p.sounds);
    return p;
  } catch { return defaults(); } // sin archivo o ilegible: valores por defecto
}

/**
 * Aplica un cambio validado y lo guarda. Lanza Error con un mensaje para el usuario si algo no es válido.
 * patch: { theme?, fontSize?, startFullscreen?, label?: { id, name?, color?, pinned?, reset? },
 *          sounds?: { volume? (0–1), message?|finished?|toast?: { on?, file? } } }
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
  if ('sounds' in patch) {
    const s = patch.sounds;
    if (!s || typeof s !== 'object') throw new Error('Configuración de sonidos inválida');
    if ('volume' in s) {
      if (!Number.isFinite(s.volume) || s.volume < 0 || s.volume > 1) throw new Error('Volumen fuera de rango (0–100 %)');
      p.sounds.volume = s.volume;
    }
    for (const k of SOUND_KINDS) {
      if (!(k in s)) continue;
      const v = s[k];
      if (!v || typeof v !== 'object') throw new Error('Sonido inválido');
      if ('on' in v) {
        if (typeof v.on !== 'boolean') throw new Error('Valor inválido para activar el sonido');
        p.sounds[k].on = v.on;
      }
      if ('file' in v) {
        if (!isSoundName(v.file)) throw new Error('Nombre de archivo de sonido inválido');
        p.sounds[k].file = v.file;
      }
    }
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
