// Sonidos de aviso: un solo reproductor reutilizable, un elemento de audio por archivo (se crean una vez).
// Script clásico (window.AgentMapSounds); los tests lo cargan con node:vm y un Audio falso.
(function (root) {
  'use strict';

  // Sonidos incluidos con la app (los mismos que SOUND_FILES de lib/prefs.js); los propios van en ~/.agent-map/sounds.
  const FILES = ['agentmap-mensaje.wav', 'agentmap-fin.wav', 'agentmap-aviso.wav'];
  const KINDS = ['message', 'finished', 'toast'];
  // Mismo criterio que isSoundName en lib/prefs.js: un nombre de archivo simple con extensión de audio.
  const isSoundName = n => typeof n === 'string' && /^[^\\/:*?"<>|\x00-\x1f]{1,80}\.(mp3|wav|ogg)$/i.test(n)
    && !n.startsWith('.') && !/^(con|prn|aux|nul|com\d|lpt\d)(\.|$)/i.test(n);

  /**
   * Qué sonido corresponde a un grupo de eventos que llegó junto (una carga de /api/tree): uno solo,
   * para no superponer sonidos. Terminar gana a mensaje; el resto de avisos usa el sonido general.
   */
  function pickSound(events) {
    const types = new Set((events || []).map(e => e && e.type));
    if (types.has('finished')) return 'finished';
    if (types.has('message')) return 'message';
    if (types.has('waiting') || types.has('session-new') || types.has('session-closed')) return 'toast';
    return null;
  }

  /**
   * makeAudio(src): crea el elemento (en la página, new Audio). base: ruta del servidor local.
   * play(kind, sounds) -> Promise de 'played' | 'off' | 'muted' | 'blocked' | 'error'. Nunca lanza.
   */
  function createPlayer(options) {
    const opts = options || {};
    const makeAudio = opts.makeAudio || (src => new root.Audio(src));
    const base = opts.base || '/sounds/';
    const cache = new Map();
    const audioFor = file => {
      if (!cache.has(file)) {
        const a = makeAudio(base + encodeURIComponent(file));
        a.preload = 'auto';
        cache.set(file, a);
      }
      return cache.get(file);
    };
    return {
      play(kind, sounds, force) {
        const cfg = sounds && sounds[kind];
        if (!KINDS.includes(kind) || !cfg || !isSoundName(cfg.file)) return Promise.resolve('error');
        if (!cfg.on && !force) return Promise.resolve('off');
        const volume = Number(sounds.volume);
        if (!(volume > 0)) return Promise.resolve('muted');
        try {
          const a = audioFor(cfg.file);
          a.volume = Math.min(1, volume);
          a.currentTime = 0;
          return Promise.resolve(a.play()).then(() => 'played',
            // NotAllowedError: el navegador exige un click antes de reproducir (modo web). Lo demás: archivo ausente o ilegible.
            err => (err && err.name === 'NotAllowedError' ? 'blocked' : 'error'));
        } catch { return Promise.resolve('error'); }
      },
      size: () => cache.size,
    };
  }

  root.AgentMapSounds = Object.freeze({ FILES, KINDS, isSoundName, pickSound, createPlayer });
})(typeof window !== 'undefined' ? window : globalThis);
