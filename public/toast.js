// Avisos (toasts) abajo a la derecha. Viven en #toasts, fuera de los paneles que se vuelven a pintar,
// así que un re-render nunca los borra ni los duplica. Solo texto (textContent): nunca HTML ni contenido de mensajes.
// Script clásico (window.AgentMapToasts).
(function (root) {
  'use strict';

  const ICON = { message: '💬', finished: '✅', waiting: '✋', 'session-new': '🆕', 'session-closed': '⏹', info: 'ℹ', error: '⚠' };

  /** Título y detalle de un evento del motor (sin prompts ni respuestas). info: { session, project }. */
  function view(e, info) {
    const where = [info && info.session, info && info.project].filter(Boolean).join(' · ');
    switch (e.type) {
      case 'message': return { title: e.count > 1 ? `${e.count} respuestas nuevas de Claude` : 'Respuesta nueva de Claude', text: where };
      case 'finished': return { title: 'Claude terminó', text: where };
      case 'waiting': return { title: 'Claude espera tu intervención', text: where };
      case 'session-new': return { title: 'Sesión nueva', text: where };
      case 'session-closed': return { title: 'Sesión cerrada', text: where };
      default: return { title: e.title || '', text: e.text || '' };
    }
  }

  /**
   * container: el elemento #toasts. onOpen(sessionId): abrir la sesión al hacer click.
   * isBlocked(): true mientras haya un modal abierto (la página queda inerte): los avisos esperan en la cola.
   */
  function create(container, options) {
    const opts = options || {};
    const MAX_VISIBLE = opts.max || 3;
    const MAX_QUEUE = 20;
    const state = { duration: opts.duration || 8000 };
    const visible = new Map(); // id del aviso -> { el, timer, left, started }
    const queue = [];
    let seq = 0;

    const blocked = () => (typeof opts.isBlocked === 'function' ? opts.isBlocked() : false);

    function startTimer(t) {
      clearTimeout(t.timer);
      t.started = Date.now();
      t.timer = setTimeout(() => dismiss(t.id), t.left);
    }
    function pauseTimer(t) {
      if (!t.timer) return;
      clearTimeout(t.timer); t.timer = null;
      t.left = Math.max(1000, t.left - (Date.now() - t.started));
    }

    function render(item) {
      const el = document.createElement('div');
      el.className = 'toast toast-' + item.kind;
      el.setAttribute('role', item.kind === 'error' ? 'alert' : 'status');
      const body = document.createElement(item.sessionId ? 'button' : 'div');
      body.className = 'toast-body';
      if (item.sessionId) { body.type = 'button'; body.title = 'Abrir la sesión'; }
      const icon = document.createElement('span');
      icon.className = 'toast-icon'; icon.setAttribute('aria-hidden', 'true'); icon.textContent = ICON[item.kind] || ICON.info;
      const txt = document.createElement('span');
      txt.className = 'toast-text';
      const b = document.createElement('b'); b.textContent = item.title;
      txt.appendChild(b);
      if (item.text) { const s = document.createElement('small'); s.textContent = item.text; txt.appendChild(s); }
      body.append(icon, txt);
      const close = document.createElement('button');
      close.type = 'button'; close.className = 'toast-close'; close.setAttribute('aria-label', 'Cerrar aviso'); close.textContent = '×';
      el.append(body, close);
      return { el, body, close };
    }

    function showNow(item) {
      const id = ++seq;
      const { el, body, close } = render(item);
      const t = { id, el, item, timer: null, left: state.duration, started: 0 };
      visible.set(id, t);
      el.dataset.toastKey = item.key;
      if (item.sessionId) body.addEventListener('click', () => { dismiss(id); opts.onOpen && opts.onOpen(item.sessionId); });
      close.addEventListener('click', () => dismiss(id));
      el.addEventListener('keydown', ev => { if (ev.key === 'Escape') { ev.stopPropagation(); dismiss(id); } });
      // Pausa mientras el mouse o el foco están encima (tiempo suficiente para leer).
      el.addEventListener('mouseenter', () => pauseTimer(t));
      el.addEventListener('mouseleave', () => startTimer(t));
      el.addEventListener('focusin', () => pauseTimer(t));
      el.addEventListener('focusout', ev => { if (!el.contains(ev.relatedTarget)) startTimer(t); });
      container.appendChild(el);
      requestAnimationFrame(() => el.classList.add('in'));
      startTimer(t);
    }

    function pump() {
      if (blocked()) return;
      while (visible.size < MAX_VISIBLE && queue.length) showNow(queue.shift());
    }

    function dismiss(id) {
      const t = visible.get(id);
      if (!t) return;
      visible.delete(id);
      clearTimeout(t.timer);
      t.el.classList.remove('in');
      t.el.classList.add('out');
      let gone = false;
      const remove = () => { if (gone) return; gone = true; t.el.remove(); };
      t.el.addEventListener('transitionend', remove, { once: true });
      setTimeout(remove, 400); // por si no hay transición (movimiento reducido)
      pump();
    }

    /** item: { key, kind, title, text?, sessionId? }. Mismo key visible o en cola: se actualiza en vez de duplicar. */
    function show(item) {
      for (const t of visible.values()) {
        if (t.item.key !== item.key) continue;
        t.item = item;
        const { el } = render(item);
        t.el.querySelector('.toast-text').replaceWith(el.querySelector('.toast-text'));
        t.left = state.duration;
        if (t.timer) startTimer(t);
        return;
      }
      const i = queue.findIndex(q => q.key === item.key);
      if (i >= 0) { queue[i] = item; return; }
      queue.push(item);
      if (queue.length > MAX_QUEUE) queue.shift(); // demasiados: se descartan los más viejos
      pump();
    }

    /** Aviso de un evento del motor. info: { session, project }. */
    function showEvent(e, info) {
      // Un aviso por sesión y tipo: varias respuestas seguidas suman en el mismo aviso.
      const key = e.type + ':' + e.sessionId;
      const prev = [...visible.values()].map(t => t.item).concat(queue).find(q => q.key === key);
      const count = e.type === 'message' ? (prev ? prev.count : 0) + (e.count || 1) : undefined;
      const v = view(Object.assign({}, e, { count }), info);
      show({ key, kind: e.type, title: v.title, text: v.text, sessionId: e.sessionId, count });
    }

    return {
      show, showEvent, pump,
      setDuration(ms) { if (ms > 0) state.duration = ms; },
      count: () => ({ visible: visible.size, queued: queue.length }),
    };
  }

  root.AgentMapToasts = Object.freeze({ create, view });
})(typeof window !== 'undefined' ? window : globalThis);
