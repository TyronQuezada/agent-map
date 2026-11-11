// Motor de eventos: compara dos respuestas de /api/tree y dice qué pasó entre ellas.
// Puro: sin DOM, sin red, sin localStorage; no modifica lo que recibe. Script clásico (window.AgentMapEvents);
// los tests lo cargan con node:vm.
(function (root) {
  'use strict';

  // Estados que escribe Claude Code en ~/.claude/sessions/<pid>.json. Cualquier otro se ignora.
  const KNOWN = new Set(['busy', 'idle', 'waiting', 'shell']);
  // waitingFor solo si es un rótulo corto y simple (ej. "input needed"); nunca texto libre.
  const SAFE_WAITING = /^[A-Za-z][A-Za-z0-9 _:.-]{0,39}$/;

  const num = v => (typeof v === 'number' && Number.isFinite(v) ? v : null);

  /** id de sesión -> { s, p } (la primera aparición gana si un id se repitiera). */
  function index(snapshot) {
    const map = new Map();
    const projects = snapshot && Array.isArray(snapshot.projects) ? snapshot.projects : [];
    for (const p of projects) {
      for (const s of (p && Array.isArray(p.sessions) ? p.sessions : [])) {
        if (s && typeof s.id === 'string' && !map.has(s.id)) map.set(s.id, { s, p });
      }
    }
    return map;
  }

  function liveOf(s) {
    const l = s.live;
    if (!l || typeof l !== 'object') return null;
    return { pid: l.pid, status: KNOWN.has(l.status) ? l.status : null, at: num(l.statusUpdatedAt), waitingFor: l.waitingFor };
  }

  /**
   * Eventos entre dos snapshots ({ projects: [...] } de /api/tree).
   * Sin snapshot anterior (null, undefined o sin lista projects) es la carga inicial: no hay eventos.
   * options.now: hora del evento (ms; por defecto Date.now()).
   * options.nameOf(session): nombre a mostrar (por defecto título de Claude; nunca el texto de un prompt).
   */
  function diff(previous, current, options) {
    const opts = options || {};
    const now = num(opts.now) ?? Date.now();
    const nameOf = typeof opts.nameOf === 'function' ? opts.nameOf : s => s.title || s.aiTitle || null;
    // Sin snapshot anterior válido = carga inicial: nada de lo que ya existe es "nuevo".
    // Un snapshot válido con cero sesiones sí sirve de base: lo que aparezca después es sesión nueva.
    if (!previous || !Array.isArray(previous.projects)) return [];
    const before = index(previous);
    const events = [];
    const seen = new Set();
    const emit = (type, key, s, p, extra) => {
      if (seen.has(key)) return;
      seen.add(key);
      events.push(Object.assign({ type, key, sessionId: s.id, projectId: (p && p.key) || null, sessionName: nameOf(s) || null, timestamp: now }, extra));
    };

    for (const [id, { s, p }] of index(current)) {
      const old = before.get(id);
      if (!old) { emit('session-new', 'session-new:' + id, s, p); continue; }

      const prevMsgs = num(old.s.claudeMsgs), curMsgs = num(s.claudeMsgs);
      const moreMsgs = prevMsgs !== null && curMsgs !== null && curMsgs > prevMsgs;
      if (moreMsgs) emit('message', `message:${id}:${curMsgs}`, s, p, { count: curMsgs - prevMsgs });

      const a = liveOf(old.s), b = liveOf(s);
      // La key lleva el último cambio de estado visto: un pid reutilizado más tarde no queda tapado por un cierre anterior.
      if (a && !b) { emit('session-closed', `session-closed:${id}:${a.pid}:${a.at ?? ''}`, s, p); continue; }
      // Solo se comparan estados del mismo proceso: con otro pid es otra instancia y su reloj no es comparable.
      if (!a || !b || a.pid !== b.pid || !a.status || !b.status) continue;

      const mark = b.at ?? 'm' + curMsgs; // distingue un cambio de otro para deduplicar
      const shortRun = a.status === 'idle' && b.status === 'idle' && a.at !== null && b.at !== null && b.at > a.at && moreMsgs;
      // waiting -> idle con respuestas nuevas: pidió permiso, siguió y terminó entre dos lecturas.
      const afterWait = a.status === 'waiting' && b.status === 'idle' && moreMsgs;
      if ((a.status === 'busy' && b.status === 'idle') || shortRun || afterWait) {
        emit('finished', `finished:${id}:${b.pid}:${mark}`, s, p);
      } else if (a.status === 'busy' && b.status === 'waiting') {
        const extra = typeof b.waitingFor === 'string' && SAFE_WAITING.test(b.waitingFor) ? { waitingFor: b.waitingFor } : {};
        emit('waiting', `waiting:${id}:${b.pid}:${mark}`, s, p, extra);
      }
    }
    return events;
  }

  /** Copia mínima del snapshot: solo lo que diff necesita, para que cambios posteriores en la página no la alteren. */
  function slim(snapshot) {
    return { projects: snapshot.projects.map(p => ({ key: p && p.key,
      sessions: (p && Array.isArray(p.sessions) ? p.sessions : []).map(s => ({ id: s && s.id, title: s && s.title, aiTitle: s && s.aiTitle,
        claudeMsgs: s && s.claudeMsgs, live: s && s.live && typeof s.live === 'object' ? Object.assign({}, s.live) : null })) })) };
  }

  /**
   * Seguimiento entre cargas: guarda el último snapshot válido y no repite un evento ya entregado.
   * update(snapshot) devuelve los eventos nuevos; un snapshot inválido (error de red) no cambia nada.
   * La primera llamada válida solo fija la referencia.
   */
  function createTracker(options) {
    const opts = options || {};
    const MAX_KEYS = 1000;
    let previous = null;
    const delivered = new Set(); // keys ya entregadas (las más viejas se olvidan)
    return {
      update(snapshot) {
        if (!snapshot || !Array.isArray(snapshot.projects)) return [];
        const current = slim(snapshot);
        const events = diff(previous, current, Object.assign({}, opts, { now: typeof opts.now === 'function' ? opts.now() : undefined }))
          .filter(e => !delivered.has(e.key));
        for (const e of events) {
          delivered.add(e.key);
          if (delivered.size > MAX_KEYS) delivered.delete(delivered.values().next().value);
        }
        previous = current;
        return events;
      },
    };
  }

  root.AgentMapEvents = Object.freeze({ diff, createTracker });
})(typeof window !== 'undefined' ? window : globalThis);
