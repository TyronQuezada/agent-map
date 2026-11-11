// Agent Map — interfaz. Sin frameworks: estado simple + render por innerHTML con delegación de eventos.
const $ = sel => document.querySelector(sel);
// Preferencias de esta ventana (tamaño de paneles, secciones plegadas). Si el almacenamiento falla, se usan los valores por defecto.
const store = {
  get(k, def) { try { const v = localStorage.getItem('agentmap.' + k); return v == null ? def : JSON.parse(v); } catch { return def; } },
  set(k, v) { try { localStorage.setItem('agentmap.' + k, JSON.stringify(v)); } catch {} },
};
// ---------- preferencias (se guardan en ~/.agent-map/prefs.json vía /api/prefs) ----------
const THEMES = {
  xp: { name: 'Windows XP', desc: 'Azul Luna, el clásico', term: { background: '#0c0c0c', foreground: '#e6e6e6', selectionBackground: '#316ac5' } },
  matrix: { name: 'Matrix', desc: 'Letras verdes sobre negro', term: { background: '#000000', foreground: '#33ff66', cursor: '#00ff41', selectionBackground: '#0f5c25' } },
  noche: { name: 'Noche', desc: 'Oscuro azulado, suave para la vista', term: { background: '#0b1220', foreground: '#dfe7f7', cursor: '#4d8dff', selectionBackground: '#2f5fd0' } },
};
const COLORS = { red: ['Rojo', '#e5484d'], orange: ['Naranja', '#f5a524'], yellow: ['Amarillo', '#d4b106'], green: ['Verde', '#30a46c'],
  teal: ['Turquesa', '#12a594'], blue: ['Azul', '#3e7bfa'], purple: ['Morado', '#8e4ec6'], pink: ['Rosa', '#e93d82'] };
const lbl = id => state.prefs.labels[id] || {};

async function savePrefs(patch) {
  const r = await fetch('/api/prefs', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(patch) });
  if (!r.ok) throw new Error(await r.text() || 'No se pudo guardar');
  state.prefs = await r.json();
  applyPrefs();
  renderAll();
}
function applyPrefs() {
  const { theme, fontSize } = state.prefs;
  document.documentElement.dataset.theme = theme;
  store.set('theme', theme); // para pintar el tema correcto al abrir, antes de que responda el servidor
  for (const t of state.terms.values()) {
    t.term.options.theme = THEMES[theme].term;
    t.term.options.fontSize = fontSize;
  }
  fitActive();
}

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const state = {
  projects: [], repos: {}, filter: 'all', query: '',
  newDir: '',                // carpeta elegida para "Iniciar Claude"
  selected: null,            // id de sesión seleccionada
  selectedSub: null,         // id de subagente seleccionado
  expandedProjects: null,    // Set; se inicializa con los 3 proyectos más recientes
  expandedSessions: new Set(),
  terms: new Map(),          // key -> { term, fit, ws, el, label, sessionId }
  active: null,              // key de la terminal visible (null = inicio)
  prefs: { theme: store.get('theme', 'xp'), fontSize: 13, startFullscreen: true, labels: {} },
};
if (!THEMES[state.prefs.theme]) state.prefs.theme = 'xp';

// ---------- utilidades ----------
function ago(iso) {
  if (!iso) return '';
  const s = (Date.now() - new Date(iso)) / 1000;
  if (s < 60) return 'ahora';
  if (s < 3600) return Math.floor(s / 60) + ' min';
  if (s < 86400) return Math.floor(s / 3600) + ' h';
  if (s < 86400 * 7) return Math.floor(s / 86400) + ' d';
  return new Date(iso).toLocaleDateString('es', { day: 'numeric', month: 'short' });
}
const fmt = n => n >= 1e6 ? (n / 1e6).toFixed(1) + 'M' : n >= 1e3 ? (n / 1e3).toFixed(1) + 'k' : String(n);
const dateTime = iso => iso ? new Date(iso).toLocaleString('es', { dateStyle: 'medium', timeStyle: 'short' }) : '—';
function duration(a, b) {
  const m = Math.round((new Date(b) - new Date(a)) / 60000);
  return m < 60 ? m + ' min' : Math.floor(m / 60) + ' h ' + (m % 60) + ' min';
}
const originalTitle = s => s.title || s.aiTitle || s.firstPrompt || s.id.slice(0, 8);
const title = s => lbl(s.id).name || originalTitle(s); // nombre puesto en Agent Map > título de Claude
const allSessions = () => state.projects.flatMap(p => p.sessions.map(s => ({ ...s, project: p })));
const findSession = id => allSessions().find(s => s.id === id);
const openHere = id => state.terms.has(id);

function dotClass(s) {
  if (openHere(s.id)) return 'here';
  return s.live ? (s.live.status === 'busy' ? 'busy' : 'idle') : '';
}
function dotTitle(s) {
  if (openHere(s.id)) return 'Abierta en Agent Map';
  if (s.live) return s.live.status === 'busy' ? 'Trabajando en otra terminal' : 'Abierta en otra terminal (en espera)';
  return 'Cerrada';
}

// Punto del proyecto: el estado más "vivo" de sus sesiones (abierta aquí > trabajando > en espera).
function projectDot(p) {
  const classes = p.sessions.map(dotClass);
  const top = ['here', 'busy', 'idle'].find(c => classes.includes(c));
  const n = classes.filter(Boolean).length;
  return top ? `<span class="dot ${top}" title="${n} sesión${n > 1 ? 'es' : ''} activa${n > 1 ? 's' : ''}"></span>`
    : '<span class="dot none"></span>';
}

// ---------- filtros ----------
function matches(s, p) {
  const now = Date.now();
  if (state.filter === 'live' && !s.live && !openHere(s.id)) return false;
  if (state.filter === 'today' && now - new Date(s.end) > 86400e3) return false;
  if (state.filter === 'week' && now - new Date(s.end) > 7 * 86400e3) return false;
  if (!state.query) return true;
  const hay = [s.title, s.aiTitle, s.firstPrompt, s.lastPrompt, p.name, p.cwd, s.branch,
    ...s.subagents.map(a => a.type + ' ' + a.description)].join(' ').toLowerCase();
  return state.query.split(/\s+/).every(w => hay.includes(w));
}

// ---------- árbol izquierdo ----------
function sessionNode(s, p) {
  const subs = s.subagents;
  const open = state.expandedSessions.has(s.id);
  const l = lbl(s.id), color = COLORS[l.color];
  let html = `<div class="node ${state.selected === s.id && !state.selectedSub ? 'sel' : ''}${color ? ' tagged' : ''}" role="treeitem"
      data-act="session" data-id="${s.id}" title="${esc(p.cwd)} · click derecho: nombre, color, fijar"${color ? ` style="--tag:${color[1]}"` : ''}>
    <span class="twisty" data-act="toggle-session" data-id="${s.id}">${subs.length ? (open ? '▾' : '▸') : ''}</span>
    <span class="dot ${dotClass(s)}" title="${dotTitle(s)}"></span>
    <span class="label">${l.pinned ? '📌 ' : ''}${esc(title(s))}</span>
    ${unreadBadge(unreadOf(s), unreadOf(s) + " respuesta(s) nueva(s) de Claude")}
    ${subs.length ? `<span class="badge" title="Subagentes">${subs.length}</span>` : ''}
    <span class="meta">${ago(s.end)}</span>
  </div>`;
  if (subs.length && open) {
    html += `<div class="children" role="group">` + subs.map(a => `
      <div class="node sub ${state.selectedSub === a.id ? 'sel' : ''}" data-act="sub" data-id="${s.id}" data-sub="${a.id}" title="${esc(a.description)}">
        <span class="twisty"></span><span>🤖</span>
        <span class="label">${esc(a.description || a.type)}</span>
        <span class="meta">${esc(a.type)}</span>
      </div>`).join('') + `</div>`;
  }
  return html;
}

function renderTree() {
  const tree = $('#tree');
  if (!state.expandedProjects) state.expandedProjects = new Set(state.projects.slice(0, 3).map(p => p.cwd));
  const searching = !!state.query || state.filter !== 'all';

  const live = allSessions().filter(s => (s.live || openHere(s.id)) && matches(s, s.project));
  const pinned = allSessions().filter(s => lbl(s.id).pinned && matches(s, s.project));
  let html = pinned.length ? `<div class="section">📌 Fijadas (${pinned.length})</div>` + pinned.map(s => sessionNode(s, s.project)).join('') : '';
  if (live.length) html += treeSection('tree:activas', '● Activas ahora', live.length, live.map(s => sessionNode(s, s.project)).join(''));
  let shown = 0, projects = '';
  for (const p of state.projects) {
    const sessions = p.sessions.filter(s => matches(s, p));
    if (!sessions.length) continue;
    shown++;
    const open = searching || state.expandedProjects.has(p.cwd);
    projects += `<div class="node project" data-act="toggle-project" data-cwd="${esc(p.cwd)}" title="${esc(p.cwd)}">
      <span class="twisty">${open ? '▾' : '▸'}</span>${projectDot(p)}<span>${open ? '📂' : '📁'}</span>
      <span class="label">${esc(p.name)}</span>${(n => unreadBadge(n, n + " respuesta(s) nueva(s) en este proyecto"))(p.sessions.reduce((t, s) => t + unreadOf(s), 0))}<span class="badge">${sessions.length}</span></div>`;
    if (open) projects += `<div class="children">${sessions.map(s => sessionNode(s, p)).join('')}</div>`;
  }
  html += treeSection('tree:proyectos', 'Proyectos', shown, projects || `<div class="empty">No hay sesiones que coincidan.</div>`);
  tree.innerHTML = html;
}

// Secciones plegables del árbol: se recuerdan en el mismo `collapsed` que las del panel derecho.
// Con una búsqueda escrita se ven abiertas para mostrar los resultados, sin cambiar la preferencia guardada.
function treeSection(key, label, count, body) {
  const forced = !!state.query && collapsed.has(key);
  const open = !collapsed.has(key) || forced;
  const id = 'sec-' + key.replace(':', '-');
  return `<button type="button" class="section section-toggle" data-tree-section="${key}" aria-expanded="${open}" aria-controls="${id}"
      title="${forced ? 'Abierta por la búsqueda; al terminar vuelve a quedar plegada' : open ? 'Plegar' : 'Desplegar'}">${label} (${count})</button>
    <div id="${id}" role="group" aria-label="${esc(label.replace(/^\W+/, ''))}"${open ? '' : ' hidden'}>${body}</div>`;
}

$('#tree').addEventListener('click', e => {
  const sec = e.target.closest('[data-tree-section]');
  if (sec) { // durante una búsqueda cambia la preferencia, que se aplica al terminar la búsqueda
    const key = sec.dataset.treeSection;
    collapsed.has(key) ? collapsed.delete(key) : collapsed.add(key);
    store.set('collapsed', [...collapsed]);
    renderTree();
    $(`[data-tree-section="${key}"]`)?.focus(); // el re-render reemplaza el botón: no perder el foco del teclado
    return;
  }
  const el = e.target.closest('[data-act]');
  if (!el) return;
  const { act, id } = el.dataset;
  if (act === 'toggle-session') {
    e.stopPropagation();
    state.expandedSessions.has(id) ? state.expandedSessions.delete(id) : state.expandedSessions.add(id);
    return renderTree();
  }
  if (act === 'toggle-project') {
    const cwd = el.dataset.cwd;
    state.expandedProjects.has(cwd) ? state.expandedProjects.delete(cwd) : state.expandedProjects.add(cwd);
    return renderTree();
  }
  if (act === 'sub') { state.selected = id; state.selectedSub = el.dataset.sub; renderAll(); return; }
  if (act === 'session') selectSession(id);
});

// ---------- menú contextual de una sesión (click derecho) ----------
$('#tree').addEventListener('contextmenu', e => {
  const el = e.target.closest('[data-act="session"]');
  if (!el) return;
  e.preventDefault();
  openCtxMenu(e.clientX, e.clientY, el.dataset.id);
});
const closeCtxMenu = () => document.querySelector('.ctxmenu')?.remove();
document.addEventListener('mousedown', e => { if (!e.target.closest('.ctxmenu')) closeCtxMenu(); });
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeCtxMenu(); });
window.addEventListener('blur', closeCtxMenu);
window.addEventListener('resize', closeCtxMenu);

function openCtxMenu(x, y, id) {
  closeCtxMenu();
  const s = findSession(id);
  if (!s) return;
  const l = lbl(id);
  const m = document.createElement('div');
  m.className = 'ctxmenu';
  m.setAttribute('role', 'menu');
  m.setAttribute('aria-label', 'Opciones de la sesión');
  m.innerHTML = `
    <button role="menuitem" data-ctx="open">▶ Abrir</button>
    <button role="menuitem" data-ctx="rename">✏️ Cambiar nombre…</button>
    <div class="ctx-label">🎨 Color</div>
    <div class="ctx-colors">${Object.entries(COLORS).map(([c, [name, hex]]) =>
      `<button role="menuitemradio" aria-checked="${l.color === c}" data-ctx="color" data-color="${c}" title="${name}" aria-label="${name}" style="--c:${hex}"></button>`).join('')}
      <button role="menuitemradio" aria-checked="${!l.color}" data-ctx="color" data-color="" class="none" title="Sin color" aria-label="Sin color">✕</button></div>
    <button role="menuitem" data-ctx="pin">📌 ${l.pinned ? 'Quitar de fijadas' : 'Fijar arriba'}</button>
    <button role="menuitem" data-ctx="copy">📋 Copiar ID de la sesión</button>
    <hr>
    <button role="menuitem" data-ctx="reset" ${Object.keys(l).length ? '' : 'disabled'}>↺ Restablecer nombre, color y fijado</button>`;
  document.body.appendChild(m);
  // Dentro de la pantalla aunque el click sea cerca de un borde.
  m.style.left = Math.min(x, innerWidth - m.offsetWidth - 4) + 'px';
  m.style.top = Math.min(y, innerHeight - m.offsetHeight - 4) + 'px';
  m.querySelector('button').focus();
  m.addEventListener('keydown', e => { // flechas para moverse por el menú
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    e.preventDefault();
    const items = [...m.querySelectorAll('button:not(:disabled)')];
    const i = items.indexOf(document.activeElement);
    items[(i + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length].focus();
  });
  m.addEventListener('click', async e => {
    const b = e.target.closest('[data-ctx]');
    if (!b) return;
    closeCtxMenu();
    const act = b.dataset.ctx;
    try {
      if (act === 'open') selectSession(id);
      else if (act === 'rename') renameSession(s);
      else if (act === 'color') await savePrefs({ label: { id, color: b.dataset.color || null } });
      else if (act === 'pin') await savePrefs({ label: { id, pinned: !l.pinned } });
      else if (act === 'copy') writeClipboard(id);
      else if (act === 'reset') await savePrefs({ label: { id, reset: true } });
    } catch (err) { openModal('No se pudo guardar', `<p class="confirm-msg">${esc(err.message)}</p>`); }
  });
}

function renameSession(s) {
  openModal('✏️ Cambiar nombre', `<form class="rename">
      <label for="renameInput">Nombre de la sesión</label>
      <input id="renameInput" maxlength="120" value="${esc(title(s))}" autocomplete="off">
      <p class="muted">Solo cambia cómo se ve en Agent Map: la conversación de Claude no se toca. Déjalo vacío para volver al original: <i>${esc(originalTitle(s))}</i></p>
      <p class="picker-msg" id="renameMsg" role="alert"></p>
      <div class="modal-actions">
        <button type="button" class="xpbtn" data-close-modal>Cancelar</button>
        <button class="xpbtn primary">Guardar</button>
      </div>
    </form>`, { sticky: true });
  const input = $('#renameInput');
  input.select();
  $('#modalBody form').onsubmit = async e => {
    e.preventDefault();
    const name = input.value.trim() === originalTitle(s) ? '' : input.value;
    try { await savePrefs({ label: { id: s.id, name } }); $('#modal').close(); }
    catch (err) { $('#renameMsg').textContent = err.message; }
  };
}

// ---------- 📖 Acerca de: guía en diapositivas, como la intro de un juego ----------
const ABOUT = [
  { img: 'session', title: '¡Bienvenido a Agent Map!', text: 'Tu centro de mando para Claude Code. A la izquierda están todas tus sesiones, al centro las terminales y a la derecha lo que pasó en cada conversación.', tip: 'Avanza con ▶ o con las flechas del teclado.' },
  { img: 'terminal', title: 'Terminales de verdad', text: 'Click en una sesión y se retoma en una terminal real. Las terminales siguen vivas en la barra de tareas de abajo aunque cambies de sesión.', tip: 'Ctrl+V pega, Ctrl+C copia lo seleccionado y el click derecho copia o pega.' },
  { img: 'context-menu', title: 'Ordena tus sesiones', text: 'Click derecho en una sesión: cámbiale el nombre, márcala con un color o fíjala arriba. Tus archivos de Claude no se tocan.', tip: 'Arrastra las líneas entre paneles para darle más espacio a lo que necesites.' },
  { img: 'team-form', title: 'Nivel 1 · Arma tu equipo', text: 'Al iniciar un proyecto, "👥 Iniciar con equipo" crea un jefe y 2 agentes con el nombre, cargo e instrucciones que tú quieras. Hay plantillas: videojuego, web, ingeniería inversa, datos y más.', tip: 'Elige la carpeta de UN proyecto: el equipo vale para esa carpeta y todo lo que tenga adentro.' },
  { img: 'team', title: 'Nivel 2 · El jefe reparte el trabajo', text: 'Tú solo le hablas al jefe, en la terminal del centro. Él divide el pedido, lo anota en TAREAS.md y se lo encarga a los agentes, que pueden trabajar al mismo tiempo.', tip: 'Click en una ficha de la izquierda para ver qué hace ese agente, paso a paso. Es solo para mirar: no se le interrumpe.' },
  { img: 'office-window', title: 'Nivel 3 · La oficina', text: 'Sin trabajo, los tres duermen (zzz). Cuando el jefe encarga algo, el agente despierta y teclea con su monitor encendido. A ratos van por café o a la impresora.', tip: 'El café y la impresora son de adorno; dormir y trabajar es lo que pasa de verdad.' },
  { img: 'office-full', title: 'Nivel 4 · Lee sus pensamientos', text: 'Pasa el mouse sobre alguien y verás qué está haciendo en pocas palabras y cuánto tiempo lleva: "Codeando player.gd ⏱ 2:15".', tip: '⛶ pone la oficina en pantalla completa y ⧉ la saca a su propia ventana, para llevarla a otro monitor. 📌 la vuelve a anclar.' },
  { img: 'office-night', title: 'Nivel 5 · Cuando se acaban los tokens', text: 'Si tu plan llega al límite, se apaga la luz de la oficina y el equipo duerme hasta que se renueven los tokens, con una cuenta regresiva.', tip: 'Abajo, en la barra de tareas, siempre ves cuánto llevas de la sesión de 5 horas, cuánto te queda y cuándo se reinicia.' },
  { img: 'matrix', title: 'Elige tu estilo', text: 'En ⚙ Opciones cambias el tema (Windows XP, Matrix o Noche), el tamaño de letra de la terminal y si la app abre en pantalla completa.', tip: 'F11 activa o desactiva la pantalla completa cuando quieras.' },
  { img: 'options', title: '¡Listo para jugar!', text: 'Consejo de jefe: pide tareas que no toquen los mismos archivos, así tus dos agentes trabajan en paralelo sin pisarse. Y vigila el % de uso: dos agentes gastan el doble.', tip: 'Puedes volver a ver esta guía desde ⚙ Opciones → Acerca de.' },
];

function showAbout(start = 0) {
  openModal('📖 Cómo funciona Agent Map', `<div class="about">
      <div class="about-screen"><img id="abImg" alt=""><span class="about-level" id="abCount"></span></div>
      <div class="about-box" id="abBox" title="Click para mostrar todo el texto">
        <h3 id="abTitle"></h3>
        <p id="abText"></p>
        <p class="about-tip" id="abTip"></p>
        <span class="about-blink" aria-hidden="true">▼</span>
      </div>
      <div class="about-nav">
        <button class="xpbtn" id="abPrev">◀ Anterior</button>
        <span class="about-dots" id="abDots" role="tablist" aria-label="Diapositivas"></span>
        <button class="xpbtn primary" id="abNext">Siguiente ▶</button>
      </div>
    </div>`);
  let i = start, typer = 0;
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const show = n => {
    i = Math.max(0, Math.min(ABOUT.length - 1, n));
    const s = ABOUT[i];
    $('#abImg').src = '/about/' + s.img + '.png';
    $('#abImg').alt = s.title;
    $('#abCount').textContent = `${i + 1} / ${ABOUT.length}`;
    $('#abTitle').textContent = s.title;
    $('#abTip').textContent = '💡 ' + s.tip;
    $('#abPrev').disabled = i === 0;
    $('#abNext').textContent = i === ABOUT.length - 1 ? '✓ Terminar' : 'Siguiente ▶';
    $('#abDots').innerHTML = ABOUT.map((x, k) => `<button role="tab" aria-selected="${k === i}" aria-label="${k + 1}. ${esc(x.title)}" data-slide="${k}"></button>`).join('');
    // El texto aparece letra por letra, como un diálogo de RPG (click para verlo completo).
    clearInterval(typer);
    const el = $('#abText');
    if (reduce) { el.textContent = s.text; return; }
    let k = 0;
    el.textContent = '';
    typer = setInterval(() => { k += 2; el.textContent = s.text.slice(0, k); if (k >= s.text.length || !el.isConnected) clearInterval(typer); }, 18);
  };
  const body = $('#modalBody');
  body.onclick = e => {
    if (e.target.id === 'abPrev') show(i - 1);
    else if (e.target.id === 'abNext') i === ABOUT.length - 1 ? $('#modal').close() : show(i + 1);
    else if (e.target.dataset.slide) show(+e.target.dataset.slide);
    else if (e.target.closest('#abBox')) { clearInterval(typer); $('#abText').textContent = ABOUT[i].text; }
  };
  body.onkeydown = e => {
    if (e.key === 'ArrowRight') { e.preventDefault(); i === ABOUT.length - 1 ? $('#modal').close() : show(i + 1); }
    if (e.key === 'ArrowLeft') { e.preventDefault(); show(i - 1); }
  };
  show(i);
  $('#abNext').focus();
}

// ---------- ⚙ Opciones ----------
function showOptions() {
  const p = state.prefs;
  const sizes = [11, 12, 13, 14, 15, 16, 18, 20];
  openModal('⚙ Opciones', `
    <h4 class="opt-head">Tema</h4>
    <div class="themes">${Object.entries(THEMES).map(([k, t]) => `
      <button class="theme-card${p.theme === k ? ' on' : ''}" data-theme-pick="${k}" aria-pressed="${p.theme === k}">
        <span class="theme-prev" data-prev="${k}"><i></i><i></i><i></i><u></u></span>
        <b>${t.name}</b><small>${t.desc}</small>
      </button>`).join('')}</div>
    <h4 class="opt-head">Terminal</h4>
    <label class="opt-row">Tamaño de letra
      <select id="optFont">${sizes.map(n => `<option value="${n}"${n === p.fontSize ? ' selected' : ''}>${n} px</option>`).join('')}</select>
    </label>
    ${window.desktop ? `<h4 class="opt-head">Ventana</h4>
    <label class="opt-row"><input type="checkbox" id="optFull"${p.startFullscreen ? ' checked' : ''}> Abrir en pantalla completa</label>
    <p class="muted">F11 activa o desactiva la pantalla completa en cualquier momento.</p>` : ''}
    <h4 class="opt-head">Sonidos</h4>
    <label class="opt-row">Volumen
      <input type="range" id="optVol" min="0" max="100" step="5" value="${Math.round((p.sounds?.volume ?? 0.7) * 100)}">
      <span id="optVolTxt">${Math.round((p.sounds?.volume ?? 0.7) * 100)} %</span>
    </label>
    <div id="optSoundRows">${soundRows(p.sounds, null)}</div>
    <div class="opt-row sound-dir">${window.desktop ? '<button type="button" class="xpbtn small" id="optSndFolder">📂 Abrir carpeta de sonidos</button>' : ''}
      <small class="muted" id="optSndDir">Los sonidos no vienen con Agent Map: agrega tus propios archivos mp3, wav u ogg.</small></div>
    <p class="muted" id="optSndMsg" role="status"></p>
    <h4 class="opt-head">Acerca de</h4>
    <button class="xpbtn primary" id="optAbout">📖 Cómo funciona Agent Map (guía paso a paso)</button>
    <p class="picker-msg" id="optMsg" role="alert"></p>`);
  const body = $('#modalBody');
  let soundList = null; // { dir, files: [{ name, mine }] } de /api/sounds
  const drawSounds = () => {
    if (!$('#optSoundRows')) return; // el modal ya se cerró
    $('#optSoundRows').innerHTML = soundRows(state.prefs.sounds, soundList);
    if (soundList) $('#optSndDir').textContent = 'Tus sonidos (mp3, wav u ogg) van en: ' + soundList.dir;
  };
  const refreshSounds = async () => {
    try { const r = await fetch('/api/sounds'); if (r.ok) soundList = await r.json(); } catch { /* sin servidor: queda la lista sugerida */ }
    drawSounds();
  };
  refreshSounds();
  const save = async patch => {
    try { await savePrefs(patch); $('#optMsg').textContent = ''; }
    catch (err) { $('#optMsg').textContent = err.message; }
  };
  body.onclick = async e => {
    if (e.target.id === 'optAbout') return showAbout();
    if (e.target.id === 'optSndFolder') {
      const ok = await window.desktop.openSoundsFolder();
      $('#optSndMsg').textContent = ok ? 'Copia ahí tus archivos de audio; la lista se actualiza al volver a esta ventana.' : 'No se pudo abrir la carpeta.';
      window.addEventListener('focus', refreshSounds, { once: true });
      return;
    }
    const test = e.target.closest('[data-snd-test]');
    if (test) {
      const k = test.dataset.sndTest, file = state.prefs.sounds?.[k]?.file || '';
      const r = await player.play(k, state.prefs.sounds, true); // probar suena aunque esté desactivado
      $('#optSndMsg').textContent = {
        played: `▶ ${SOUND_NAMES[k]}: ${file}`,
        muted: 'El volumen está en 0 %.',
        blocked: 'El navegador bloqueó el sonido: haz click en la página y vuelve a probar.',
        error: `No se encontró o no se pudo reproducir ${file}. Agrega ese archivo a tu carpeta de sonidos o elige otro.`,
      }[r] || '';
      return;
    }
    const b = e.target.closest('[data-theme-pick]');
    if (!b) return;
    await save({ theme: b.dataset.themePick });
    body.querySelectorAll('[data-theme-pick]').forEach(x => {
      const on = x.dataset.themePick === state.prefs.theme;
      x.classList.toggle('on', on);
      x.setAttribute('aria-pressed', on);
    });
  };
  body.onchange = e => {
    if (e.target.id === 'optFont') save({ fontSize: Number(e.target.value) });
    if (e.target.id === 'optFull') save({ startFullscreen: e.target.checked });
    if (e.target.id === 'optVol') save({ sounds: { volume: Number(e.target.value) / 100 } });
    if (e.target.dataset.sndOn) save({ sounds: { [e.target.dataset.sndOn]: { on: e.target.checked } } });
    if (e.target.dataset.sndFile) save({ sounds: { [e.target.dataset.sndFile]: { file: e.target.value } } }).then(drawSounds);
  };
  body.oninput = e => { if (e.target.id === 'optVol') $('#optVolTxt').textContent = e.target.value + ' %'; };
}
const SOUND_NAMES = { message: 'Respuesta nueva de Claude', finished: 'Claude terminó', toast: 'Otros avisos (espera, sesión nueva o cerrada)' };
// Filas de sonido de ⚙ Opciones. list: lo que hay de verdad en disco (null = todavía no se sabe). Nombres escapados: son del usuario.
function soundRows(sounds, list) {
  const names = list ? list.files.map(f => f.name) : AgentMapSounds.FILES;
  return AgentMapSounds.KINDS.map(k => {
    const cur = sounds?.[k]?.file || '';
    const missing = !!list && !!cur && !names.includes(cur);
    const options = [...new Set([...names, cur].filter(Boolean))];
    return `<div class="opt-row sound-row">
      <label><input type="checkbox" data-snd-on="${k}"${sounds?.[k]?.on ? ' checked' : ''}> ${SOUND_NAMES[k]}</label>
      <select data-snd-file="${k}" aria-label="Sonido para: ${SOUND_NAMES[k]}">${options.map(f =>
        `<option value="${esc(f)}"${f === cur ? ' selected' : ''}>${esc(f)}${missing && f === cur ? ' (falta)' : ''}</option>`).join('')}</select>
      <button type="button" class="xpbtn small" data-snd-test="${k}">▶ Probar</button>
      ${missing ? '<small class="snd-missing">⚠ Falta este archivo: no sonará hasta que lo agregues o elijas otro.</small>' : ''}
    </div>`;
  }).join('');
}

// ---------- selección y apertura ----------
function selectSession(id, force = false) {
  state.selected = id; state.selectedSub = null;
  const s = findSession(id);
  if (!s) return;
  if (openHere(id)) showTerm(id);
  else if (s.live && !force) showHome(s);           // ya corre en otra terminal: avisar antes
  else openTerm({ session: id, key: id }, title(s), id);
  renderAll();
}

function openTerm(params, label, sessionId, cwd = "") {
  const el = document.createElement('div');
  el.className = 'term';
  $('#stage').appendChild(el);
  const term = new Terminal({
    fontFamily: '"Cascadia Mono", Consolas, monospace', fontSize: state.prefs.fontSize, cursorBlink: true, scrollback: 5000,
    theme: THEMES[state.prefs.theme].term,
  });
  const fit = new FitAddon.FitAddon();
  term.loadAddon(fit);
  term.open(el);
  let key = params.key || 'tmp-' + Date.now();
  // cwd: para saber si la terminal es de un proyecto con equipo de agentes
  const t = { term, fit, el, label, sessionId, ws: null, cwd: cwd || params.newIn || (sessionId && findSession(sessionId)?.cwd) || '', born: Date.now() };
  state.terms.set(key, t);
  showTerm(key);
  fit.fit();

  const q = new URLSearchParams({ ...params, cols: term.cols, rows: term.rows });
  const ws = new WebSocket(`ws://${location.host}/pty?${q}`);
  t.ws = ws;
  let first = true;
  ws.onmessage = ev => {
    if (first) { // el primer mensaje siempre es {t:'hello'} con la clave real
      first = false;
      const hello = JSON.parse(ev.data);
      if (hello.key !== key) { state.terms.delete(key); state.terms.set(hello.key, t); if (state.active === key) state.active = hello.key; key = hello.key; }
      t.label = hello.label;
      renderAll();
      return;
    }
    term.write(ev.data);
  };
  ws.onclose = ev => { if (ev.code >= 4000) term.write(`\r\n\x1b[31m${ev.reason}\x1b[0m\r\n`); };
  const send = d => ws.readyState === 1 && ws.send(JSON.stringify({ t: 'in', d }));
  term.onData(send);
  // Copiar/pegar como en Windows Terminal: Ctrl+C copia si hay selección (si no, interrumpe), Ctrl+V pega.
  // Sin texto en el portapapeles se manda ^V tal cual: así Claude Code puede pegar una imagen.
  const paste = async () => { const text = await readClipboard(); text ? term.paste(text) : send('\x16'); };
  const copy = () => { writeClipboard(term.getSelection()); term.clearSelection(); };
  term.attachCustomKeyEventHandler(e => {
    if (e.type !== 'keydown' || !e.ctrlKey || e.altKey || e.metaKey) return true;
    const k = e.key.toLowerCase();
    if (k === 'v') { e.preventDefault(); paste(); return false; }
    if (k === 'c' && (term.hasSelection() || e.shiftKey)) { e.preventDefault(); if (term.hasSelection()) copy(); return false; }
    return true;
  });
  // Click derecho: copia la selección o, sin selección, pega.
  el.addEventListener('contextmenu', e => { e.preventDefault(); term.hasSelection() ? copy() : paste(); term.focus(); });
  term.onResize(({ cols, rows }) => ws.readyState === 1 && ws.send(JSON.stringify({ t: 'resize', cols, rows })));
}

// En la app de escritorio el portapapeles va por el proceso principal; en el navegador, por la API web.
const readClipboard = () => (window.desktop ? window.desktop.readClipboard() : navigator.clipboard.readText()).catch(() => '');
const writeClipboard = text => window.desktop ? window.desktop.writeClipboard(text) : navigator.clipboard.writeText(text).catch(() => {});

function showTerm(key) {
  state.active = key;
  $('#home').hidden = true;
  for (const [k, t] of state.terms) t.el.hidden = k !== key;
  const t = state.terms.get(key);
  $('#termTitle').textContent = '💻 ' + t.label;
  $('#closeTerm').hidden = false;
  requestAnimationFrame(() => { t.fit.fit(); t.term.focus(); });
  renderTasks();
  pollTeam();
}

async function closeTerm(key) {
  const t = state.terms.get(key);
  if (!t) return;
  const ok = await confirmModal('Cerrar terminal',
    `¿Cerrar la terminal <b>${esc(t.label)}</b>?<br>Claude se detendrá, pero la conversación queda guardada y puedes retomarla después.`,
    '✕ Cerrar terminal');
  if (!ok || !state.terms.has(key)) return;
  for (const id of [key, t.sessionId]) if (id) closedHere.set(id, Date.now()); // la cerraste tú: sin aviso de "sesión cerrada"
  if (t.ws?.readyState === 1) t.ws.send(JSON.stringify({ t: 'kill' }));
  t.ws?.close(); t.term.dispose(); t.el.remove();
  state.terms.delete(key);
  if (state.active === key) showHome();
  renderAll();
}
$('#closeTerm').onclick = () => state.active && closeTerm(state.active);

// ---------- inicio (centro sin terminal) ----------
function showHome(warnFor) {
  state.active = null;
  for (const t of state.terms.values()) t.el.hidden = true;
  $('#home').hidden = false;
  $('#closeTerm').hidden = true;
  $('#termTitle').textContent = warnFor ? '⚠ ' + title(warnFor) : '🏠 Inicio';
  const recent = allSessions().sort((a, b) => b.end.localeCompare(a.end)).slice(0, 9);
  $('#home').innerHTML = `
    ${warnFor ? `<div class="card warn" style="margin-bottom:14px">
      <h2>Esta sesión ya está abierta en otra terminal</h2>
      <p>Si la abres aquí también, las dos ventanas escribirán en la misma conversación y pueden pisarse.
      Lo más seguro es ir a la otra ventana (${esc(warnFor.live.entrypoint || 'terminal')}, PID ${warnFor.live.pid}).</p>
      <button class="xpbtn primary" data-open-force="${warnFor.id}">Abrir aquí de todos modos</button>
    </div>` : ''}
    <div class="card">
      <h2>Bienvenido a Agent Map</h2>
      <p>Haz click en una sesión de la izquierda para abrirla aquí. Las terminales abiertas siguen corriendo abajo, en la barra de tareas.</p>
      <div class="newrow">
        <label for="newDir">Carpeta:</label>
        <input id="newDir" readonly value="${esc(state.newDir)}" placeholder="Elige dónde trabajará Claude…" title="${esc(state.newDir)}">
        <button class="xpbtn" id="pickBtn">📁 Elegir carpeta…</button>
        <button class="xpbtn primary" id="newBtn" ${state.newDir ? '' : 'disabled'}>＋ Iniciar Claude</button>
        <button class="xpbtn" id="teamBtn" ${state.newDir ? '' : 'disabled'} title="1 jefe + 2 agentes con nombre, cargo e instrucciones">👥 Iniciar con equipo…</button>
      </div>
      <h3 style="margin:16px 0 0;color:var(--group-text)">Recientes</h3>
      <div class="tiles">${recent.map(s => `
        <button class="tile" data-open="${s.id}">
          <b><span class="dot ${dotClass(s)}" style="display:inline-block"></span> ${esc(title(s))}</b>
          <small>${esc(s.project.name)} · ${ago(s.end)} · ${s.prompts} prompts</small>
        </button>`).join('')}</div>
    </div>`;
  renderTasks();
}

$('#home').addEventListener('click', e => {
  const open = e.target.closest('[data-open]');
  if (open) return selectSession(open.dataset.open);
  const force = e.target.closest('[data-open-force]');
  if (force) return selectSession(force.dataset.openForce, true);
  if (e.target.id === 'pickBtn') {
    pickFolder(state.newDir).then(dir => { if (dir) { state.newDir = dir; showHome(); } });
  }
  if (e.target.id === 'newBtn' && state.newDir) {
    openTerm({ newIn: state.newDir }, 'Nueva · ' + baseName(state.newDir), null);
  }
  if (e.target.id === 'teamBtn' && state.newDir) showTeamForm(state.newDir);
});

// ---------- equipo de agentes: crear ----------
const TEAM_TEMPLATES = {
  juego: { label: '🎮 Videojuego',
    boss: { name: 'Jefe', instructions: 'Diriges el desarrollo de un videojuego. Mantén el juego siempre jugable: primero lo mínimo que funcione, después se mejora.' },
    agents: [
      { name: 'Programador', role: 'Programación del juego', instructions: 'Programas la lógica del juego: movimiento, colisiones, niveles, menús y guardado. Código simple y probado.' },
      { name: 'Artista', role: 'Gráficos y sprites', instructions: 'Creas los gráficos: sprites, fondos, animaciones e íconos, con un estilo visual coherente. Entregas los archivos listos para usar en el juego.' },
    ] },
  web: { label: '🌐 Página o app web',
    boss: { name: 'Jefe', instructions: 'Diriges el desarrollo de una página o app web. Prioriza que se vea bien en celular y que cargue rápido.' },
    agents: [
      { name: 'Frontend', role: 'Interfaz y diseño', instructions: 'Construyes lo que ve el usuario: páginas, estilos, formularios y que todo sea accesible y responsive.' },
      { name: 'Backend', role: 'Servidor y datos', instructions: 'Construyes el servidor, la base de datos y las APIs. Validas todo lo que llega del usuario.' },
    ] },
  inversa: { label: '🔍 Ingeniería inversa (entender un programa)',
    boss: { name: 'Jefe', instructions: 'Dirigen el análisis de un programa propio o con permiso para estudiarlo, del que no hay documentación. El objetivo es entender cómo funciona y dejarlo explicado y comprobado. Reparte por módulos: mientras uno analiza el módulo siguiente, el otro documenta y comprueba el anterior.' },
    agents: [
      { name: 'Analista', role: 'Lee y desarma el código', instructions: 'Lees el código (o el binario descompilado) módulo por módulo: qué hace cada parte, cómo fluyen los datos, formatos de archivos y protocolos. Anotas lo que descubres en docs/analisis/<módulo>.md con referencias a archivos y líneas.' },
      { name: 'Documentador', role: 'Documenta y comprueba', instructions: 'Tomas el análisis de un módulo y lo conviertes en documentación clara (docs/<módulo>.md) y en pruebas que confirman el comportamiento descrito. Si una prueba contradice el análisis, lo reportas al jefe.' },
    ] },
  migracion: { label: '🔄 Migración o modernización de código',
    boss: { name: 'Jefe', instructions: 'Dirigen la migración de un proyecto (versión nueva de un lenguaje, framework o librería). Avancen módulo por módulo y nunca dejen el proyecto sin compilar.' },
    agents: [
      { name: 'Migrador', role: 'Actualiza el código', instructions: 'Migras un módulo a la vez a la nueva versión, con cambios mínimos y sin cambiar el comportamiento.' },
      { name: 'Verificador', role: 'Pruebas antes y después', instructions: 'Antes de que se migre un módulo, escribes pruebas que fijan su comportamiento actual. Después, compruebas que siguen pasando y reportas cualquier diferencia.' },
    ] },
  investigacion: { label: '📚 Investigación y redacción',
    boss: { name: 'Jefe', instructions: 'Dirigen un informe o documento bien fundamentado. Divide el tema en secciones: mientras se investiga la siguiente, se redacta la anterior.' },
    agents: [
      { name: 'Investigador', role: 'Busca y verifica fuentes', instructions: 'Buscas información confiable sobre cada sección, la verificas y guardas notas con las fuentes en notas/<sección>.md.' },
      { name: 'Redactor', role: 'Escribe el documento', instructions: 'Con las notas de cada sección, escribes un texto claro y ordenado en el documento final, citando las fuentes.' },
    ] },
  datos: { label: '📊 Análisis de datos',
    boss: { name: 'Jefe', instructions: 'Dirigen el análisis de un conjunto de datos para responder preguntas concretas. Primero datos limpios, después conclusiones.' },
    agents: [
      { name: 'Ingeniero de datos', role: 'Limpia y prepara los datos', instructions: 'Cargas, limpias y validas los datos (duplicados, faltantes, formatos) y dejas tablas listas para analizar, con un script reproducible.' },
      { name: 'Analista', role: 'Gráficos y conclusiones', instructions: 'Con las tablas limpias, haces los cálculos y gráficos que responden cada pregunta y escribes las conclusiones en lenguaje simple.' },
    ] },
  seguridad: { label: '🛡 Revisión de seguridad del propio código',
    boss: { name: 'Jefe', instructions: 'Dirigen una revisión de seguridad de este proyecto. Mientras se revisa una parte, se corrige la anterior. Prioriza por gravedad.' },
    agents: [
      { name: 'Auditor', role: 'Busca vulnerabilidades', instructions: 'Revisas el código parte por parte buscando fallas: entradas sin validar, secretos expuestos, permisos de más, dependencias vulnerables. Anotas cada hallazgo con su gravedad y cómo reproducirlo, sin explotarlo.' },
      { name: 'Reparador', role: 'Corrige con pruebas', instructions: 'Tomas cada hallazgo, escribes una prueba que lo demuestra, lo corriges con el cambio mínimo y confirmas que la prueba pasa.' },
    ] },
  vacio: { label: '✏️ En blanco', boss: { name: 'Jefe', instructions: '' },
    agents: [{ name: '', role: '', instructions: '' }, { name: '', role: '', instructions: '' }] },
};

function showTeamForm(dir) {
  const field = (id, label, value, opts = '') => `<label class="tf"><span>${label}</span><input id="${id}" value="${esc(value)}" ${opts}></label>`;
  const area = (id, label, value, ph) => `<label class="tf"><span>${label}</span><textarea id="${id}" rows="3" maxlength="4000" placeholder="${esc(ph)}">${esc(value)}</textarea></label>`;
  const fill = tpl => {
    const t = TEAM_TEMPLATES[tpl];
    $('#tmBossName').value = t.boss.name; $('#tmBossIns').value = t.boss.instructions;
    t.agents.forEach((a, i) => { $(`#tmA${i}Name`).value = a.name; $(`#tmA${i}Role`).value = a.role; $(`#tmA${i}Ins`).value = a.instructions; });
  };
  // Proyectos conocidos que están DENTRO de esta carpeta (heredarían el CLAUDE.md del equipo).
  const norm = p => p.replace(/\//g, '\\').replace(/\\+$/, '').toLowerCase();
  const inside = state.projects.filter(p => norm(p.cwd).startsWith(norm(dir) + '\\')).map(p => p.name);
  openModal('👥 Iniciar con equipo · ' + baseName(dir), `<form class="teamform">
      <p class="muted">Un <b>jefe</b> (la terminal donde tú escribes) reparte el trabajo entre <b>2 agentes</b> que pueden trabajar al mismo tiempo.
      Se crean <code>CLAUDE.md</code>, <code>TAREAS.md</code> y <code>.claude/agents/</code> en <code>${esc(dir)}</code>.</p>
      ${inside.length ? `<div class="hint warn-box" role="alert">⚠ <b>Esta carpeta contiene otros proyectos</b> (${inside.slice(0, 4).map(esc).join(', ')}${inside.length > 4 ? '…' : ''}).
        Claude lee el <code>CLAUDE.md</code> de las carpetas de arriba, así que este equipo aparecería también en todos ellos.
        Lo normal es elegir la carpeta de <b>un</b> proyecto.
        <label class="opt-row"><input type="checkbox" id="tmInsideOk"> Entiendo, crear el equipo aquí de todos modos</label></div>` : ''}
      <label class="tf"><span>Plantilla</span><select id="tmTpl">${Object.entries(TEAM_TEMPLATES).map(([k, t]) => `<option value="${k}">${t.label}</option>`).join('')}</select></label>
      <fieldset class="tm"><legend><img src="${portraits()[0]}" alt=""> Jefe</legend>
        ${field('tmBossName', 'Nombre', '', 'maxlength="40" required')}
        ${area('tmBossIns', 'Instrucciones', '', 'De qué trata el proyecto y cómo quieres que dirija (opcional)')}
      </fieldset>
      ${[0, 1].map(i => `<fieldset class="tm"><legend><img src="${portraits()[i + 1]}" alt=""> Agente ${i + 1}</legend>
        <div class="tf-row">${field(`tmA${i}Name`, 'Nombre', '', 'maxlength="40" required')}${field(`tmA${i}Role`, 'Cargo', '', 'maxlength="60" required')}</div>
        ${area(`tmA${i}Ins`, 'Instrucciones', '', 'Ej.: Eres el encargado de testear el juego…')}
      </fieldset>`).join('')}
      <p class="picker-msg" id="tmMsg" role="alert"></p>
      <div class="modal-actions">
        <button type="button" class="xpbtn" data-close-modal>Cancelar</button>
        <button class="xpbtn primary">👥 Crear equipo e iniciar</button>
      </div>
    </form>`, { sticky: true });
  fill('juego');
  $('#tmTpl').onchange = e => fill(e.target.value);
  $('#modalBody form').onsubmit = async e => {
    e.preventDefault();
    if (inside.length && !$('#tmInsideOk').checked) { $('#tmMsg').textContent = 'Marca "Entiendo…" o elige la carpeta de un solo proyecto.'; return; }
    const body = {
      dir,
      boss: { name: $('#tmBossName').value, instructions: $('#tmBossIns').value },
      agents: [0, 1].map(i => ({ name: $(`#tmA${i}Name`).value, role: $(`#tmA${i}Role`).value, instructions: $(`#tmA${i}Ins`).value })),
    };
    try {
      const r = await fetch('/api/team', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
      if (!r.ok) throw new Error(await r.text() || 'No se pudo crear el equipo');
      $('#modal').close();
      teamMiss.delete(dir);
      openTerm({ newIn: dir }, 'Equipo · ' + baseName(dir), null);
    } catch (err) { $('#tmMsg').textContent = err.message; }
  };
}

// ---------- equipo de agentes: estado en vivo (fichas a la izquierda, oficina a la derecha) ----------
let _portraits, _office, _officeWrap;
const portraits = () => _portraits ||= [0, 1, 2].map(i => Office.portrait(i));
function officeWrap() { // un solo canvas (con sus globos) que sobrevive a los re-render del panel derecho
  if (!_officeWrap) {
    _officeWrap = document.createElement('div');
    _officeWrap.className = 'office-wrap';
    const cv = document.createElement('canvas');
    cv.className = 'office';
    cv.setAttribute('role', 'img');
    cv.setAttribute('aria-label', 'Oficina del equipo: muestra quién está trabajando y quién duerme. Pasa el mouse sobre alguien para ver qué hace.');
    _officeWrap.appendChild(cv);
    _office = new Office(cv);
    // En pantalla completa se ven los globos de todos; anclada, solo al pasar el mouse.
    _office.bubbles(_officeWrap, i => Office.info(state.team?.data, i, _office.night()), () => document.fullscreenElement === _officeWrap);
    _office.nightLabel(_officeWrap);
    _office.setNight(Office.waitUntil(usage));
    const exit = document.createElement('button');
    exit.className = 'xpbtn small office-exit';
    exit.textContent = '✕ Salir de pantalla completa (Esc)';
    exit.onclick = () => document.exitFullscreen();
    _officeWrap.appendChild(exit);
  }
  return _officeWrap;
}

// Oficina en otra ventana (para moverla a otro monitor). Las dos páginas se avisan por este canal.
const officeChannel = 'BroadcastChannel' in window ? new BroadcastChannel('agentmap-office') : null;
let officeWin = null;
function setDetached(on) {
  if (state.officeDetached === on) return;
  state.officeDetached = on;
  if (!on && officeWin && !officeWin.closed) officeWin.close();
  if (!on) officeWin = null;
  renderStats();
}
document.addEventListener('keydown', e => { // Esc saca a la oficina de pantalla completa
  if (e.key === 'Escape' && _officeWrap && document.fullscreenElement === _officeWrap) { e.preventDefault(); document.exitFullscreen(); }
}, true);
officeChannel?.addEventListener('message', e => { if (e.data?.type === 'closed' || e.data?.type === 'dock') setDetached(false); });
setInterval(() => { if (state.officeDetached && officeWin?.closed) setDetached(false); }, 1000);

$('#stats').addEventListener('click', e => {
  const b = e.target.closest('[data-office]');
  if (!b || !state.team) return;
  const act = b.dataset.office;
  if (act === 'full') officeWrap().requestFullscreen?.();
  else if (act === 'detach') {
    officeWin = window.open('/office.html?dir=' + encodeURIComponent(state.team.dir), 'agentmap-office', 'width=960,height=760');
    if (officeWin) setDetached(true);
  } else if (act === 'dock') { officeChannel?.postMessage({ type: 'dock' }); setDetached(false); }
});
const teamMiss = new Map(); // carpeta -> cuándo se vio que no tiene equipo (para no preguntar cada 1,5 s)
let teamWrites = {};

async function pollTeam() {
  const dir = state.terms.get(state.active)?.cwd;
  if (!dir || (state.team?.dir !== dir && Date.now() - (teamMiss.get(dir) || 0) < 20000)) return setTeam(null);
  try {
    const data = await (await fetch('/api/team?dir=' + encodeURIComponent(dir))).json();
    if (state.terms.get(state.active)?.cwd !== dir) return; // cambió de terminal mientras tanto
    if (!data) { teamMiss.set(dir, Date.now()); return setTeam(null); }
    setTeam({ dir, data });
  } catch { /* servidor ocupado: se reintenta en el próximo ciclo */ }
}
setInterval(pollTeam, 1500);

function setTeam(team) {
  const before = state.team?.dir;
  state.team = team;
  $('#tabTeam').hidden = !team;
  if (!team) {
    if (state.leftTab === 'team') setLeftTab('tree');
    if (before) renderStats();
    return;
  }
  const m = team.data.members;
  if (team.dir !== before) { teamWrites = {}; state.teamSel = 'boss'; setLeftTab('team'); renderStats(); }
  officeWrap();
  _office.setWorking(m.map(x => x.state === 'working'));
  m.slice(1).forEach((x, i) => { // escribió un archivo nuevo: a veces va a "imprimirlo"
    if (teamWrites[x.key] !== undefined && x.writes > teamWrites[x.key]) _office.ping(i + 1);
    teamWrites[x.key] = x.writes;
  });
  renderTeam();
  renderOfficeLegend();
}

function setLeftTab(tab) {
  state.leftTab = tab;
  for (const [id, name] of [['#tabTree', 'tree'], ['#tabTeam', 'team']]) {
    $(id).classList.toggle('on', tab === name);
    $(id).setAttribute('aria-selected', tab === name);
  }
  $('#tree').hidden = tab !== 'tree';
  $('#team').hidden = tab !== 'team';
  if (tab === 'team') renderTeam();
}
$('#tabTree').onclick = () => setLeftTab('tree');
$('#tabTeam').onclick = () => setLeftTab('team');

const clock = ts => ts ? new Date(ts).toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '';
function memberState(x, data) {
  if (_office?.night()) return '🌙 Durmiendo: esperando tokens nuevos';
  if (x.state === 'working') return '💻 ' + Office.thought(x, data.members, data.live) + (x.since ? ' · ⏱ ' + Office.elapsed(x.since) : '');
  if (x.key === 'boss') return data.live ? '😴 Esperando tu instrucción' : '😴 Claude no está abierto aquí';
  return x.finishedAt ? '😴 Terminó ' + ago(x.finishedAt) : '😴 Esperando tareas';
}

function renderTeam() {
  const el = $('#team');
  if (!state.team || el.hidden) return;
  const { data } = state.team;
  const sel = data.members.find(x => x.key === state.teamSel) || data.members[0];
  const prev = $('#feed');
  const stick = !prev || prev.scrollHeight - prev.scrollTop - prev.clientHeight < 24; // seguir abajo si ya estaba abajo
  const top = prev?.scrollTop;
  el.innerHTML = `
    <div class="members">${data.members.map((x, i) => `
      <button class="member${x === sel ? ' sel' : ''} ${x.state}" data-member="${esc(x.key)}" aria-pressed="${x === sel}">
        <img class="portrait" src="${portraits()[i]}" alt="">
        <span class="member-info"><b>${esc(x.name)}</b><small>${esc(x.role)}</small>
          <span class="member-state" title="${esc(memberState(x, data))}">${esc(memberState(x, data))}</span></span>
      </button>`).join('')}</div>
    <div class="feed-head">${sel.key === 'boss' ? '🧑‍💼 Actividad del jefe · le escribes en la terminal del centro' : `👀 Lo que hace ${esc(sel.name)} · solo lectura`}</div>
    <div id="feed" class="feed" aria-live="polite">${sel.feed.length
      ? sel.feed.map(f => `<div class="ev"><span class="ev-i">${f.icon}</span><span class="ev-t">${esc(f.text)}</span><small>${clock(f.ts)}</small></div>`).join('')
      : `<p class="muted">${sel.key === 'boss' ? 'Escríbele al jefe en la terminal del centro: qué quieres hacer.' : 'Todavía no le han encargado nada en esta sesión.'}</p>`}</div>`;
  const feed = $('#feed');
  feed.scrollTop = stick ? feed.scrollHeight : top;
}
$('#team').addEventListener('click', e => {
  const b = e.target.closest('[data-member]');
  if (!b) return;
  state.teamSel = b.dataset.member;
  renderTeam();
});

function renderOfficeLegend() {
  const el = $('#officeLegend');
  if (!el || !state.team) return;
  el.innerHTML = state.team.data.members.map((x, i) =>
    `<span><img src="${portraits()[i]}" alt=""> ${esc(x.name)} ${x.state === 'working' && !_office?.night() ? '💻 ' + esc(Office.elapsed(x.since)) : '😴'}</span>`).join('') +
    '<span class="muted">Pasa el mouse sobre alguien para ver qué hace.</span>';
}
function mountOffice() {
  if (!state.team) return;
  const tools = state.officeDetached
    ? '<button class="xpbtn small" data-office="dock" title="Cerrar la ventana aparte y volver a mostrarla aquí">📌 Anclar aquí</button>'
    : `<button class="xpbtn small" data-office="full" title="Ver la oficina en pantalla completa (Esc para volver)">⛶ Pantalla completa</button>
       <button class="xpbtn small" data-office="detach" title="Abrir la oficina en su propia ventana (puedes moverla a otro monitor)">⧉ Separar</button>`;
  $('#stats').insertAdjacentHTML('afterbegin', group('🏢 Oficina', `<div class="office-tools">${tools}</div>` + (state.officeDetached
    ? '<p class="muted office-away">La oficina está abierta en otra ventana.</p>'
    : '<div id="officeSlot" class="office-slot"></div>') + '<div id="officeLegend" class="office-legend"></div>', 'Oficina'));
  if (!state.officeDetached) $('#officeSlot').appendChild(officeWrap());
  renderOfficeLegend();
}

const baseName = p => p.replace(/[\\/]+$/, '').split(/[\\/]/).pop() || p;

// Explorador de carpetas en el modal. Devuelve la ruta elegida o null si se cancela.
function pickFolder(start) {
  let cur = start || '';
  openModal('📁 Elegir carpeta', '<div class="picker">Cargando…</div>');
  const body = $('#modalBody');

  async function go(dir) {
    let data;
    try {
      const r = await fetch('/api/dirs?path=' + encodeURIComponent(dir));
      if (!r.ok) throw new Error(await r.text());
      data = await r.json();
    } catch (err) {
      const msg = body.querySelector('.picker-msg');
      if (msg) msg.textContent = '⚠ ' + err.message;
      else if (dir) go(''); // la carpeta inicial ya no existe: empezar desde el inicio
      return;
    }
    cur = data.path;
    const row = (p, label, icon = '📁') => `<button class="node" data-go="${esc(p)}" title="${esc(p)}"><span>${icon}</span><span class="label">${esc(label)}</span></button>`;
    const list = cur ? data.dirs.map(p => row(p, baseName(p))).join('') || '<div class="empty">Sin subcarpetas.</div>'
      : '<div class="section">Inicio</div>' + data.dirs.map((p, i) => row(p, i === 0 ? 'Carpeta personal — ' + p : p, i === 0 ? '🏠' : '💽')).join('') +
        (state.projects.length ? '<div class="section">Proyectos donde ya usaste Claude</div>' + state.projects.map(p => row(p.cwd, p.name + ' — ' + p.cwd, '📂')).join('') : '');
    body.innerHTML = `<div class="picker">
      <div class="picker-bar">
        <button class="xpbtn small" data-go="${esc(data.parent ?? '')}" ${data.parent === null ? 'disabled' : ''}>⬆ Subir</button>
        <input id="pickPath" value="${esc(cur)}" placeholder="Pega una ruta, ej. D:\\Proyectos" aria-label="Ruta">
        <button class="xpbtn small" data-act="path">Ir</button>
      </div>
      <div class="picker-list">${list}</div>
      <div class="picker-msg" role="status"></div>
      <div class="picker-foot">
        <input id="newName" placeholder="Nombre de carpeta nueva" aria-label="Nombre de carpeta nueva" ${cur ? '' : 'disabled'}>
        <button class="xpbtn small" data-act="mkdir" ${cur ? '' : 'disabled'}>＋ Crear aquí</button>
        <span class="spacer"></span>
        <button class="xpbtn" data-act="cancel">Cancelar</button>
        <button class="xpbtn primary" data-act="use" ${cur ? '' : 'disabled'}>Usar esta carpeta</button>
      </div></div>`;
  }

  async function mkdir() {
    const name = $('#newName').value.trim();
    if (!name) return $('#newName').focus();
    try {
      const r = await fetch('/api/mkdir', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ parent: cur, name }) });
      if (!r.ok) throw new Error(await r.text());
      go((await r.json()).path);
    } catch (err) { body.querySelector('.picker-msg').textContent = '⚠ ' + err.message; }
  }

  return new Promise(resolve => {
    let chosen = null;
    body.onclick = e => {
      const b = e.target.closest('[data-go], [data-act]');
      if (!b || b.disabled) return;
      if (b.dataset.go !== undefined) return go(b.dataset.go);
      const act = b.dataset.act;
      if (act === 'path') go($('#pickPath').value.trim());
      else if (act === 'mkdir') mkdir();
      else if (act === 'cancel') $('#modal').close();
      else if (act === 'use') { chosen = cur; $('#modal').close(); }
    };
    body.onkeydown = e => {
      if (e.key !== 'Enter') return;
      if (e.target.id === 'pickPath') { e.preventDefault(); go(e.target.value.trim()); }
      if (e.target.id === 'newName') { e.preventDefault(); mkdir(); }
    };
    $('#modal').addEventListener('close', () => resolve(chosen), { once: true });
    go(cur);
  });
}

// ---------- panel derecho: estadísticas ----------
function bars(obj, max = 8) {
  const rows = Object.entries(obj).sort((a, b) => b[1] - a[1]).slice(0, max);
  if (!rows.length) return '<small>Sin datos.</small>';
  const top = rows[0][1];
  return rows.map(([k, v]) => `<div class="bar"><span class="name">${esc(k)}</span>
    <div class="track"><div class="fill" style="width:${(v / top) * 100}%"></div></div><span class="n">${fmt(v)}</span></div>`).join('');
}
// Secciones plegables: click en el título. Se recuerda por nombre (sin el contador entre paréntesis).
const collapsed = new Set(store.get('collapsed', []));
const groupKey = h => h.replace(/<[^>]*>/g, '').replace(/\s*\(\d+\)\s*$/, '').trim();
const group = (h, body, key = groupKey(h)) => {
  const closed = collapsed.has(key);
  return `<section class="group${closed ? ' closed' : ''}"><h3><button type="button" class="group-toggle" data-group="${esc(key)}" aria-expanded="${!closed}">${h}</button></h3><div>${body}</div></section>`;
};
document.addEventListener('click', e => {
  const b = e.target.closest('.group-toggle');
  if (!b) return;
  if (e.target.closest('[data-jump-unread]')) { // el globito rojo lleva al primer mensaje nuevo (sin plegar la sección)
    if (b.closest('.group').classList.contains('closed')) b.click();
    const first = $('#convo .msg.unread');
    first?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    first?.focus({ preventScroll: true });
    return;
  }
  const closed = b.closest('.group').classList.toggle('closed');
  b.setAttribute('aria-expanded', !closed);
  closed ? collapsed.add(b.dataset.group) : collapsed.delete(b.dataset.group);
  store.set('collapsed', [...collapsed]);
});
const kv = rows => `<dl class="kv">${rows.map(([k, v]) => `<dt>${k}</dt><dd title="${esc(v)}">${esc(v)}</dd>`).join('')}</dl>`;
function sum(objs) {
  const out = {};
  for (const o of objs) for (const [k, v] of Object.entries(o)) out[k] = (out[k] || 0) + v;
  return out;
}

// Panel derecho: la oficina (si la terminal activa tiene equipo) arriba de los datos de la sesión.
function renderStats() { renderStatsInner(); mountOffice(); }
function renderStatsInner() {
  const box = $('#stats');
  const s = state.selected && findSession(state.selected);
  if (!s) {
    const all = allSessions();
    const tokens = all.reduce((t, x) => t + x.tokens.input + x.tokens.output + x.tokens.cacheWrite, 0);
    box.innerHTML =
      group('📊 Resumen general', kv([
        ['Proyectos', state.projects.length], ['Sesiones', all.length],
        ['Activas ahora', all.filter(x => x.live || openHere(x.id)).length],
        ['Hoy', all.filter(x => Date.now() - new Date(x.end) < 86400e3).length],
        ['Subagentes', all.reduce((n, x) => n + x.subagents.length, 0)],
        ['Tokens (sin caché leída)', fmt(tokens)],
      ])) +
      group('📁 Proyectos con más sesiones', bars(Object.fromEntries(state.projects.map(p => [p.name, p.sessions.length]))));
    return;
  }
  const sub = state.selectedSub && s.subagents.find(a => a.id === state.selectedSub);
  const c = state.convo?.id === s.id && state.convo.end === s.end ? state.convo : null;
  // Se re-renderiza cada 15 s: conservar el scroll de la conversación si no cambió.
  const prev = $('#convo');
  const keepTop = prev && prev.dataset.id === s.id && +prev.dataset.n === c?.list?.length ? prev.scrollTop : null;
  box.innerHTML =
    (sub ? group('🤖 Subagente', kv([['Tipo', sub.type], ['Estado', sub.finished ? 'Terminado' : 'En curso'], ['Fecha', dateTime(sub.time)]]) +
      `<div class="quote">${esc(sub.description)}</div>`) : '') +
    group('📄 ' + esc(title(s)), kv([
      ['Proyecto', s.project.name], ['Rama', s.branch || '—'], ['Estado', dotTitle(s)],
      ['Inicio', dateTime(s.start)], ['Última actividad', dateTime(s.end)], ['Duración', duration(s.start, s.end)],
    ]), 'Datos de la sesión') +
    group('💬 Qué pasó', `<small>Primer prompt</small>${promptBtn(s.firstPrompt, 'first')}
      <small>Último prompt</small>${promptBtn(s.lastPrompt, 'last')}
      ${kv([['Prompts tuyos', s.prompts], ['Respuestas de Claude', s.assistantMsgs]])}`) +
    group('🗨 Conversación' + (c?.list ? ` (${c.list.length})` : '') +
      ((u => u ? ` <span class="unread-badge jump" data-jump-unread title="${u} respuesta${u > 1 ? 's' : ''} nueva${u > 1 ? 's' : ''} de Claude: click para ir">+${u > 99 ? '99' : u}</span>` : '')(c?.list ? unreadInList(c.list, s) : unreadOf(s))),
      `<div id="convo" class="convo" data-id="${esc(s.id)}" data-n="${c?.list?.length ?? ''}">${c?.list ? convoHtml(c.list, s) : '<small>Cargando…</small>'}</div>`, 'Conversación') +
    group('🤖 Agentes usados (' + s.subagents.length + ')', s.subagents.length
      ? s.subagents.slice(-6).reverse().map(a => `<div class="agent"><b>${agentLink(a.type)}</b> · ${ago(a.time)}<br>${esc(a.description)}</div>`).join('')
      : '<small>Esta sesión no usó subagentes.</small>');
  const el = $('#convo');
  if (c?.list) el.scrollTop = keepTop ?? el.scrollHeight; // al abrir: lo más reciente abajo
  else messages(s).then(() => { if (state.selected === s.id) renderStats(); })
    .catch(err => { if ($('#convo')) $('#convo').innerHTML = `<p class="empty">No se pudo cargar la conversación: ${esc(err.message)}</p>`; });
}

// Conversación de la sesión (prompts + respuestas). Se pide aparte y se recuerda hasta que la sesión cambie.
function messages(s) {
  const c = state.convo;
  if (c && c.id === s.id && c.end === s.end) return c.promise;
  const promise = fetch('/api/messages?id=' + encodeURIComponent(s.id))
    .then(async r => { if (!r.ok) throw new Error(await r.text()); return r.json(); });
  state.convo = { id: s.id, end: s.end, promise, list: null };
  promise.then(list => { if (state.convo?.promise === promise) state.convo.list = list; }, () => {});
  return promise;
}
// ---------- mensajes nuevos, como en Messenger: respuestas de Claude que todavía no abriste ----------
const seen = store.get('seen', {});  // id de sesión -> cuántas respuestas de Claude ya leíste
const flashed = new Set();           // "id:n" que ya parpadearon: parpadean una sola vez
function syncSeen() {
  // La primera vez se da por leído todo lo que ya existía; después, una sesión nueva empieza sin leer.
  const firstTime = !Object.keys(seen).length;
  let changed = false;
  for (const s of allSessions()) if (seen[s.id] == null) { seen[s.id] = firstTime ? s.claudeMsgs || 0 : 0; changed = true; }
  if (changed) store.set('seen', seen);
}
const unreadOf = s => Math.max(0, (s.claudeMsgs || 0) - (seen[s.id] ?? s.claudeMsgs ?? 0));
const unreadBadge = (n, title) => n ? `<span class="unread-badge" title="${esc(title)}">${n > 99 ? '99+' : n}</span>` : '';
function markRead(id, n) {
  if (n <= (seen[id] || 0)) return;
  seen[id] = n;
  store.set('seen', seen);
  renderTree(); renderStats();
}

const who = m => m.role === 'user' ? 'Tú' : 'Claude';
function convoHtml(list, s) {
  if (!list.length) return '<small>Sin mensajes de texto.</small>';
  const read = seen[s.id] ?? 0;
  let ord = 0; // número de respuesta de Claude
  return list.map((m, i) => {
    const n = m.role === 'assistant' ? ord++ : -1;
    let cls = '';
    if (n >= read) {
      cls = ' unread';
      if (!flashed.has(s.id + ':' + n)) { flashed.add(s.id + ':' + n); cls += ' flash'; } // parpadea 3 veces y queda marcado
    }
    return `<div class="msg-row ${m.role}"><button class="msg ${m.role}${cls}" data-msg="${i}" data-ord="${n}" title="Ver el mensaje completo">
      <b>${who(m)} dice:</b> <small>${esc(ago(m.ts))}</small>${n >= read ? ' <em class="new-tag">NUEVO</em>' : ''}<span>${esc(m.text.slice(0, 600))}</span></button>
      <button type="button" class="copy-icon" data-copy-msg="${i}" title="Copiar este mensaje completo" aria-label="Copiar mensaje de ${who(m)}">📋</button></div>`;
  }).join('');
}
const unreadInList = (list, s) => Math.max(0, list.filter(m => m.role === 'assistant').length - (seen[s.id] ?? 0));

// Prompt resumido; al hacer click abre el texto completo en el modal.
const promptBtn = (text, which) => text
  ? `<button class="quote prompt" data-prompt="${which}" title="Ver el texto completo"><span>${esc(text)}</span></button>`
  : '<div class="quote">—</div>';

// Agentes de Claude Code (sin plugin) -> documentación oficial; "plugin:agente" -> repo del plugin.
const BUILTIN_AGENTS = new Set(['general-purpose', 'Explore', 'Plan', 'statusline-setup', 'claude-code-guide', 'claude', 'web-fetch']);
function agentLink(type) {
  const url = type.includes(':') ? state.repos[type.split(':')[0]]
    : BUILTIN_AGENTS.has(type) ? 'https://code.claude.com/docs/en/sub-agents' : null;
  return url ? `<a href="${esc(url)}" target="_blank" rel="noopener noreferrer" title="Ver qué hace este agente">${esc(type)} ↗</a>` : esc(type);
}

// ---------- modal ----------
let modalSeq = 0; // cuenta modales abiertos: distingue el modal actual de uno ya reemplazado
// sticky: formularios que no se cierran con click afuera ni con Esc (solo con Cancelar o ×).
function openModal(heading, html, { sticky = false } = {}) {
  modalSeq++;
  const m = $('#modal');
  if (m.open) m.close(); // resuelve lo que esperaba el modal anterior
  m.returnValue = '';
  m.dataset.sticky = sticky ? '1' : '';
  $('#modalTitle').textContent = heading;
  const body = $('#modalBody');
  body.onclick = body.onkeydown = body.onchange = null; // quita los handlers del modal anterior (p. ej. el explorador)
  body.innerHTML = html;
  m.showModal();
}

// Reemplaza a confirm(): resuelve true solo con el botón de aceptar (Esc, × o click afuera = false).
function confirmModal(heading, messageHtml, okLabel) {
  openModal(heading, `<p class="confirm-msg">${messageHtml}</p>
    <form method="dialog" class="modal-actions">
      <button class="xpbtn" value="cancel" autofocus>Cancelar</button>
      <button class="xpbtn primary" value="ok">${esc(okLabel)}</button>
    </form>`);
  const m = $('#modal'), seq = modalSeq;
  return new Promise(resolve => m.addEventListener('close', function onClose() {
    // El evento 'close' es asíncrono: si había otro modal abierto, su cierre llega cuando este ya se muestra.
    if (m.open && seq === modalSeq) return;
    m.removeEventListener('close', onClose);
    resolve(seq === modalSeq && m.returnValue === 'ok');
  }));
}
// Cierra con la × o con click en el fondo oscuro. El click tiene que EMPEZAR en el fondo: si apretaste dentro
// (p. ej. seleccionando texto de un campo) y soltaste afuera, no se cierra.
let modalDownOnBackdrop = false;
$('#modal').addEventListener('pointerdown', e => { modalDownOnBackdrop = e.target === $('#modal'); });
$('#modal').addEventListener('click', e => {
  if (e.target.closest('[data-close-modal]')) return $('#modal').close();
  if (e.target === $('#modal') && modalDownOnBackdrop && !$('#modal').dataset.sticky) $('#modal').close();
});
$('#modal').addEventListener('cancel', e => { if ($('#modal').dataset.sticky) e.preventDefault(); }); // Esc

$('#stats').addEventListener('click', async e => {
  const m = e.target.closest('[data-msg]');
  if (m) {
    const msg = state.convo?.list?.[+m.dataset.msg];
    if (msg) openModal(`${who(msg)} · ${dateTime(msg.ts)}`, fullTextHtml(msg.text));
    if (+m.dataset.ord >= 0) markRead(state.convo.id, +m.dataset.ord + 1); // abrir una respuesta nueva la da por leída (y las anteriores)
    return;
  }
  const b = e.target.closest('[data-prompt]');
  if (!b) return;
  const s = findSession(state.selected);
  const which = b.dataset.prompt;
  modalCopyText = null;
  openModal((which === 'first' ? 'Primer prompt' : 'Último prompt') + ' · ' + title(s), '<p class="prompt-full">Cargando…</p>');
  try {
    const mine = (await messages(s)).filter(x => x.role === 'user');
    const full = which === 'first' ? mine[0] : mine[mine.length - 1];
    $('#modalBody').innerHTML = fullTextHtml(full?.text);
  } catch (err) {
    $('#modalBody').innerHTML = `<p class="empty">No se pudo cargar el prompt: ${esc(err.message)}</p>`;
  }
});

// Botón Uso: agentes, herramientas, tokens y modelos de la sesión elegida o de todas.
function showUsage() {
  const s = state.selected && findSession(state.selected);
  const list = s ? [s] : allSessions();
  const t = sum(list.map(x => x.tokens));
  const agents = Object.entries(sum(list.map(x => x.agentCalls))).sort((a, b) => b[1] - a[1]);
  openModal('📊 Uso · ' + (s ? title(s) : 'todas las sesiones'),
    '<div id="planBox">' + group('💳 Tu plan de Claude', '<small>Cargando…</small>') + '</div>' +
    group('🤖 Agentes (llamadas)', agents.length
      ? `<div class="chips">${agents.map(([k, v]) => `<span class="chip">${agentLink(k)} ×${v}</span>`).join('')}</div>`
      : '<small>Sin subagentes.</small>') +
    group('🛠 Herramientas', bars(sum(list.map(x => x.tools)), 12)) +
    group('🔢 Tokens', kv([['Entrada', fmt(t.input || 0)], ['Salida', fmt(t.output || 0)], ['Caché escrita', fmt(t.cacheWrite || 0)], ['Caché leída', fmt(t.cacheRead || 0)]]) +
      `<div class="chips" style="margin-top:6px">${Object.keys(sum(list.map(x => x.models))).map(m => `<span class="chip">${esc(m)}</span>`).join('')}</div>`));
}
$('#usageBtn').onclick = () => { showUsage(); loadPlan(); };
$('#optionsBtn').onclick = showOptions;

// Plan y límites (5 h / 7 días) que guarda statusline-tap.js desde la statusline de Claude Code.
function until(ms) {
  const m = Math.max(1, Math.round(ms / 60000));
  if (m < 60) return m + ' min';
  if (m < 1440) return Math.floor(m / 60) + ' h ' + (m % 60) + ' min';
  return Math.floor(m / 1440) + ' d ' + Math.floor((m % 1440) / 60) + ' h';
}
function limitRow(label, w) {
  if (!w) return '';
  const reset = w.resets_at * 1000;
  if (reset <= Date.now()) return `<div class="limit"><div class="limit-head"><b>${label}</b><span>Ya se reinició ✓</span></div>
    <small>Desde el reinicio no hay datos nuevos; se actualizan al usar Claude.</small></div>`;
  const used = Math.min(100, Math.max(0, w.used_percentage));
  const level = used >= 90 ? 'crit' : used >= 70 ? 'warn' : '';
  const when = new Date(reset).toLocaleString('es', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  return `<div class="limit">
    <div class="limit-head"><b>${label}</b><span><b>${Math.round(used)} %</b> usado · queda ${Math.round(100 - used)} %</span></div>
    <div class="meter ${level}" role="meter" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(used)}" aria-label="${label}"><div style="width:${used}%"></div></div>
    <small>Se reinicia el ${when} (en ${until(reset - Date.now())})</small></div>`;
}
async function loadPlan() {
  let html;
  try {
    const r = await fetch('/api/usage');
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const { plan, usage } = await r.json();
    html = kv([['Plan', plan ? plan.name : 'Sin cuenta de claude.ai'], ...(plan ? [['Uso extra', plan.extraUsage ? 'Activado' : 'Desactivado']] : [])]);
    const age = usage && ago(new Date(usage.updatedAt).toISOString());
    html += usage
      ? limitRow('Sesión (5 horas)', usage.five_hour) + limitRow('Semana (7 días)', usage.seven_day) +
        `<small class="muted">Datos de ${age === 'ahora' ? 'hace menos de 1 min' : 'hace ' + age}. Se actualizan mientras usas Claude.</small>`
      : `<p class="hint">Todavía no hay datos de uso. Claude Code solo los entrega a la statusline:
         activa <code>statusline-tap.js</code> (ver README) y usa Claude una vez.</p>`;
  } catch (err) {
    html = `<small>No se pudo leer el plan: ${esc(err.message)}</small>`;
  }
  const box = $('#planBox');
  if (box) box.innerHTML = group('💳 Tu plan de Claude', html);
}

// ---------- barra de tareas ----------
function renderTasks() {
  $('#tasks').innerHTML = [...state.terms].map(([k, t]) =>
    `<div class="task ${state.active === k ? 'on' : ''}" data-key="${esc(k)}" title="${esc(t.label)}">
      <span>💻 ${esc(t.label)}</span><button class="x" data-close="${esc(k)}" aria-label="Cerrar">✕</button></div>`).join('');
}
$('#tasks').addEventListener('click', e => {
  const close = e.target.closest('[data-close]');
  if (close) return closeTerm(close.dataset.close);
  const task = e.target.closest('[data-key]');
  if (!task) return;
  const t = state.terms.get(task.dataset.key);
  state.selected = t.sessionId; state.selectedSub = null;
  showTerm(task.dataset.key);
  renderAll();
});
$('#startBtn').onclick = () => { state.selected = null; state.selectedSub = null; showHome(); renderAll(); };

// ---------- avisos y sonidos: eventos entre dos cargas de /api/tree (sin polling propio) ----------
const bus = new EventTarget(); // avisos y sonidos se suscriben por separado, sin conocerse entre sí
const tracker = AgentMapEvents.createTracker({ nameOf: s => lbl(s.id).name || s.title || s.aiTitle || null }); // nunca el prompt
const closedHere = new Map(); // id -> cuándo la cerraste tú desde Agent Map (no avisar de ese cierre)
const toasts = AgentMapToasts.create($('#toasts'), {
  onOpen: id => { if (findSession(id)) { setLeftTab('tree'); selectSession(id); } },
  isBlocked: () => $('#modal').open, // con un modal abierto la página queda inerte: los avisos esperan
});
$('#modal').addEventListener('close', () => toasts.pump());
const sameDir = (a, b) => !!a && !!b && a.replace(/[\\/]+$/, '').toLowerCase() === b.replace(/[\\/]+$/, '').toLowerCase();
function relevant(e) {
  for (const [id, at] of closedHere) if (Date.now() - at > 120000) closedHere.delete(id); // marcas viejas: no suprimir de más
  if (e.type === 'session-closed' && closedHere.delete(e.sessionId)) return false;
  const terms = [...state.terms.entries()];
  if (e.type === 'session-new') {
    if (terms.some(([k, t]) => k === e.sessionId || t.sessionId === e.sessionId)) return false;
    // Recién iniciada desde "Iniciar Claude" (la terminal todavía no sabe su id): misma carpeta, empezó después de abrir
    // esa terminal y hace menos de 10 min. Una sesión externa en otra carpeta, o anterior, sí avisa.
    const s = findSession(e.sessionId);
    const start = Date.parse(s?.start || '') || 0;
    const mine = terms.find(([, t]) => !t.sessionId && !t.claimed && Date.now() - t.born < 600000 && start >= t.born - 5000 && sameDir(t.cwd, s?.cwd));
    if (mine) { mine[1].claimed = e.sessionId; return false; }
  }
  // La sesión de la terminal que estás mirando, con la ventana enfocada: ya lo estás viendo.
  const act = state.terms.get(state.active);
  const watching = act && (state.active === e.sessionId || act.sessionId === e.sessionId || act.claimed === e.sessionId);
  if (watching && document.hasFocus() && ['message', 'finished', 'waiting', 'session-closed'].includes(e.type)) return false;
  return true;
}
bus.addEventListener('events', ev => {
  for (const e of ev.detail) toasts.showEvent(e, { session: e.sessionName, project: findSession(e.sessionId)?.project.name });
});
const player = AgentMapSounds.createPlayer(); // un solo reproductor: un elemento de audio por archivo, creado una vez
const lastSoundAt = {};          // tipo -> cuándo sonó (⟳ seguidos no repiten el mismo sonido)
const warnedSounds = new Set();  // archivos que ya avisamos que faltan (una vez por arranque)
bus.addEventListener('events', ev => {
  const kind = AgentMapSounds.pickSound(ev.detail); // un sonido por carga, aunque lleguen varios eventos juntos
  if (!kind || Date.now() - (lastSoundAt[kind] || 0) < 3000) return;
  lastSoundAt[kind] = Date.now();
  const file = state.prefs.sounds?.[kind]?.file;
  player.play(kind, state.prefs.sounds).then(r => { // nunca lanza; si no sonó, se avisa (una vez por archivo y arranque)
    if ((r !== 'error' && r !== 'blocked') || !file || warnedSounds.has(file)) return;
    warnedSounds.add(file);
    toasts.show(r === 'blocked'
      ? { key: 'sound-blocked', kind: 'info', title: 'Sonido bloqueado', text: 'El navegador exige un click en la página antes de reproducir sonidos.' }
      : { key: 'sound-missing:' + file, kind: 'info', title: 'Falta un sonido', text: `${file} no está en tu carpeta de sonidos (⚙ Opciones → Sonidos)` });
  });
});

// Copiar un mensaje: el texto original completo de ese único elemento, nunca el recortado que se ve en pantalla.
async function copyText(text) {
  try {
    if (window.desktop) { // escritorio: se escribe por el proceso principal y se lee de vuelta para confirmar
      window.desktop.writeClipboard(text);
      return (await window.desktop.readClipboard()) === text;
    }
    await navigator.clipboard.writeText(text);
    return true;
  } catch { return false; }
}
let modalCopyText = null; // texto completo del mensaje que muestra el modal abierto
// Confirmación junto al botón (✓ / ⚠); si falla, además un aviso con el motivo.
async function copyFrom(btn, text) {
  const has = typeof text === 'string' && text.length > 0;
  const ok = has && await copyText(text);
  const icon = btn.classList.contains('copy-icon');
  btn.dataset.label ??= btn.textContent;
  btn.dataset.aria ??= btn.getAttribute('aria-label') || '';
  btn.textContent = ok ? (icon ? '✓' : '✓ Copiado') : (icon ? '⚠' : '⚠ No se pudo copiar');
  btn.setAttribute('aria-label', ok ? 'Copiado' : 'No se pudo copiar');
  btn.classList.toggle('copied', ok);
  btn.classList.toggle('copy-failed', !ok);
  clearTimeout(btn._copyTimer);
  btn._copyTimer = setTimeout(() => {
    btn.textContent = btn.dataset.label;
    if (btn.dataset.aria) btn.setAttribute('aria-label', btn.dataset.aria); else btn.removeAttribute('aria-label');
    btn.classList.remove('copied', 'copy-failed');
  }, 1800);
  if (!ok) toasts.show({ key: 'copy', kind: 'error', title: 'No se pudo copiar',
    text: has ? 'El portapapeles no respondió. Intenta de nuevo.' : 'Este mensaje no tiene texto para copiar.' });
  return ok;
}
document.addEventListener('click', e => {
  const one = e.target.closest('[data-copy-msg]');
  if (one) return copyFrom(one, state.convo?.list?.[+one.dataset.copyMsg]?.text);
  const modal = e.target.closest('[data-copy-modal]');
  if (modal) return copyFrom(modal, modalCopyText);
});
// Contenido de un modal de mensaje: botón de copiar (ese mensaje y nada más) + el texto completo.
const fullTextHtml = text => {
  modalCopyText = text || null;
  return (text ? '<div class="copy-bar"><button type="button" class="xpbtn small" data-copy-modal title="Copiar este mensaje completo">📋 Copiar</button></div>' : '')
    + `<div class="prompt-full">${esc(text || '—')}</div>`;
};

// ---------- carga de datos ----------
let firstLoad = true;
// Cada llamada a load() (intervalo, ⟳, arranque) recibe un número; solo la más reciente aplica su respuesta.
// Así una respuesta vieja que llega tarde no pisa datos más nuevos ni vuelve a pintar.
let loadSeq = 0;
async function load() {
  const seq = ++loadSeq;
  try {
    const r = await fetch('/api/tree');
    const data = await r.json();
    if (seq !== loadSeq) return; // llegó una llamada más nueva mientras tanto
    state.projects = data.projects;
    syncSeen();
    state.repos = data.repos || {};
    // Tras recargar la página, reengancha las terminales que siguen vivas en el servidor.
    if (firstLoad) {
      firstLoad = false;
      for (const o of data.open) if (o.alive && !state.terms.has(o.key)) openTerm({ key: o.key }, o.label, o.sessionId, o.cwd);
      if (!state.active) showHome();
    }
    renderAll();
    if (!state.active && $('#home').hidden === false && !$('#home .warn')) showHome();
    // Qué cambió desde la carga anterior (la primera solo fija la referencia: nada histórico).
    const events = tracker.update(data).filter(relevant);
    if (events.length) bus.dispatchEvent(new CustomEvent('events', { detail: events }));
  } catch (err) {
    if (seq !== loadSeq) return; // el error de una llamada vieja no tapa el resultado de una más nueva
    // Los datos de la última carga correcta (state.projects, seen) no se tocan: solo se muestra el aviso.
    // "Failed to fetch" = el servidor no respondió (en modo navegador: `npm run web` no está corriendo).
    $('#tree').innerHTML = `<div class="empty">${err instanceof TypeError
      ? 'Sin conexión con el servidor de Agent Map.' + (window.desktop ? '' : ' ¿Está corriendo <code>npm run web</code>?') + '<br>Reintentando cada 15 s…'
      : 'No se pudo leer las sesiones: ' + esc(err.message)}</div>`;
  }
}

function renderAll() { renderTree(); renderStats(); renderTasks(); }

// ---------- controles ----------
$('#search').addEventListener('input', e => { state.query = e.target.value.trim().toLowerCase(); renderTree(); });
document.querySelectorAll('[data-filter]').forEach(b => b.onclick = () => {
  document.querySelectorAll('[data-filter]').forEach(x => x.classList.toggle('on', x === b));
  state.filter = b.dataset.filter; renderTree();
});
$('#refresh').onclick = load;
// Pantalla completa (F11 o el botón). En escritorio es la de la ventana; en el navegador, la de la página.
const toggleFullScreen = () => window.desktop ? window.desktop.toggleFullScreen()
  : document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen();
$('#fullscreen').onclick = toggleFullScreen;
document.addEventListener('keydown', e => { if (e.key === 'F11') { e.preventDefault(); e.stopPropagation(); toggleFullScreen(); } }, true); // captura: antes que la terminal
document.addEventListener('fullscreenchange', () => { // solo modo navegador
  if (window.desktop) return;
  $('#fullscreen').textContent = document.fullscreenElement ? '⛶ Salir de pantalla completa' : '⛶ Pantalla completa';
});
const fitActive = () => { const t = state.terms.get(state.active); t && t.fit.fit(); };
window.addEventListener('resize', fitActive);

// ---------- divisores entre paneles ----------
const PANE = { left: [300, 180], right: [300, 220] }; // [ancho por defecto, mínimo]
const paneWidth = side => parseFloat($('.panes').style.getPropertyValue('--' + side)) || PANE[side][0];
function setPane(side, px) {
  const other = side === 'left' ? 'right' : 'left';
  const max = $('.panes').clientWidth - paneWidth(other) - 12 - 300; // el centro nunca baja de 300 px
  $('.panes').style.setProperty('--' + side, Math.round(Math.max(PANE[side][1], Math.min(px, max))) + 'px');
}
document.querySelectorAll('.splitter').forEach(sp => {
  const side = sp.dataset.side;
  const save = () => { store.set('pane.' + side, paneWidth(side)); fitActive(); };
  const saved = store.get('pane.' + side, null);
  if (saved) setPane(side, saved);
  sp.tabIndex = 0;
  sp.addEventListener('pointerdown', e => {
    if (e.button !== 0) return;
    e.preventDefault();
    sp.setPointerCapture(e.pointerId);
    sp.classList.add('dragging');
    document.body.classList.add('resizing');
    const rect = $('.panes').getBoundingClientRect();
    // La terminal se reajusta en vivo, como mucho una vez por cuadro.
    let queued = false;
    const move = ev => {
      setPane(side, side === 'left' ? ev.clientX - rect.left - 3 : rect.right - ev.clientX - 3);
      if (!queued) { queued = true; requestAnimationFrame(() => { queued = false; fitActive(); }); }
    };
    sp.addEventListener('pointermove', move);
    sp.addEventListener('lostpointercapture', () => { // al soltar (o si se cancela el arrastre)
      sp.removeEventListener('pointermove', move);
      sp.classList.remove('dragging');
      document.body.classList.remove('resizing');
      save();
    }, { once: true });
  });
  sp.addEventListener('dblclick', () => { $('.panes').style.removeProperty('--' + side); save(); });
  // Teclado: flechas mueven el divisor 20 px.
  sp.addEventListener('keydown', e => {
    const d = e.key === 'ArrowLeft' ? -20 : e.key === 'ArrowRight' ? 20 : 0;
    if (!d) return;
    e.preventDefault();
    setPane(side, paneWidth(side) + (side === 'left' ? d : -d));
    save();
  });
});
setInterval(() => { $('#clock').textContent = new Date().toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' }); }, 1000);
setInterval(load, 15000);

// ---------- uso del plan en la barra de tareas (y noche en la oficina si se acabaron los tokens) ----------
let usage = null;
async function loadUsage() {
  try { usage = (await (await fetch('/api/usage')).json()).usage || null; } catch { /* se reintenta en el próximo ciclo */ }
  renderQuota();
}
function renderQuota() {
  const el = $('#quota'), w = usage?.five_hour;
  const wait = Office.waitUntil(usage);
  if (_office) _office.setNight(wait);
  if (!w) { el.hidden = true; return; }
  el.hidden = false;
  const now = Date.now(), resetIn = w.resets_at * 1000 - now;
  if (wait) {
    el.className = 'quota wait';
    el.textContent = '🌙 Sin tokens · se renuevan en ' + Office.countdown(wait - now);
  } else if (resetIn <= 0) { // la ventana ya se reinició y aún no llegan datos nuevos
    el.className = 'quota';
    el.textContent = '⏳ Sesión de 5 h renovada';
  } else {
    const used = Math.round(w.used_percentage);
    el.className = 'quota' + (used >= 90 ? ' crit' : used >= 70 ? ' warn' : '');
    el.textContent = `⏳ Sesión: ${used} % usado · quedan ${100 - used} % · se reinicia en ${until(resetIn)}`;
  }
}
$('#quota').onclick = () => { showUsage(); loadPlan(); };
loadUsage();
setInterval(loadUsage, 30000);
setInterval(renderQuota, 1000); // cuenta regresiva
// Preferencias primero (tema, nombres): si fallan, se sigue con los valores por defecto.
fetch("/api/prefs").then(r => r.ok ? r.json() : Promise.reject()).then(p => { state.prefs = p; applyPrefs(); renderAll(); }).catch(() => applyPrefs());
load();

// ---------- app de escritorio (Electron): botones de ventana y confirmación al cerrar ----------
if (window.desktop) {
  const d = window.desktop;
  document.documentElement.classList.add('desktop');
  $('.winbtns').hidden = false;
  $('#winMin').onclick = d.minimize;
  $('#winMax').onclick = d.maximize;
  $('#winClose').onclick = d.close;
  const setState = st => {
    if (!st) return;
    const restore = st.max || st.full;
    $('#winMax').textContent = restore ? '❐' : '□';
    $('#winMax').title = $('#winMax').ariaLabel = st.full ? 'Salir de pantalla completa' : st.max ? 'Restaurar' : 'Maximizar';
    $('#fullscreen').textContent = st.full ? '⛶ Salir de pantalla completa' : '⛶ Pantalla completa';
  };
  d.getState().then(setState);
  d.onStateChange(setState);
  let asking = false;
  d.onConfirmClose(async openTerms => {
    if (asking) return;
    asking = true;
    const ok = await confirmModal('Cerrar Agent Map', '¿Seguro que quieres cerrar Agent Map?' + (openTerms
      ? `<br>Hay <b>${openTerms}</b> terminal${openTerms > 1 ? 'es' : ''} abierta${openTerms > 1 ? 's' : ''}: Claude se detendrá, pero las conversaciones quedan guardadas.`
      : ''), '✕ Cerrar Agent Map');
    asking = false;
    if (ok) d.confirmClose();
  });
}
