// Agent Map — interfaz. Sin frameworks: estado simple + render por innerHTML con delegación de eventos.
const $ = sel => document.querySelector(sel);
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
};

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
const title = s => s.title || s.aiTitle || s.firstPrompt || s.id.slice(0, 8);
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
  let html = `<div class="node ${state.selected === s.id && !state.selectedSub ? 'sel' : ''}" role="treeitem"
      data-act="session" data-id="${s.id}" title="${esc(p.cwd)}">
    <span class="twisty" data-act="toggle-session" data-id="${s.id}">${subs.length ? (open ? '▾' : '▸') : ''}</span>
    <span class="dot ${dotClass(s)}" title="${dotTitle(s)}"></span>
    <span class="label">${esc(title(s))}</span>
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
  let html = '';
  if (live.length) {
    html += `<div class="section">● Activas ahora (${live.length})</div>` + live.map(s => sessionNode(s, s.project)).join('');
  }
  let shown = 0;
  html += `<div class="section">Proyectos</div>`;
  for (const p of state.projects) {
    const sessions = p.sessions.filter(s => matches(s, p));
    if (!sessions.length) continue;
    shown++;
    const open = searching || state.expandedProjects.has(p.cwd);
    html += `<div class="node project" data-act="toggle-project" data-cwd="${esc(p.cwd)}" title="${esc(p.cwd)}">
      <span class="twisty">${open ? '▾' : '▸'}</span>${projectDot(p)}<span>${open ? '📂' : '📁'}</span>
      <span class="label">${esc(p.name)}</span><span class="badge">${sessions.length}</span></div>`;
    if (open) html += `<div class="children">${sessions.map(s => sessionNode(s, p)).join('')}</div>`;
  }
  if (!shown) html += `<div class="empty">No hay sesiones que coincidan.</div>`;
  tree.innerHTML = html;
}

$('#tree').addEventListener('click', e => {
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

function openTerm(params, label, sessionId) {
  const el = document.createElement('div');
  el.className = 'term';
  $('#stage').appendChild(el);
  const term = new Terminal({
    fontFamily: '"Cascadia Mono", Consolas, monospace', fontSize: 13, cursorBlink: true, scrollback: 5000,
    theme: { background: '#0c0c0c', foreground: '#e6e6e6', selectionBackground: '#316ac5' },
  });
  const fit = new FitAddon.FitAddon();
  term.loadAddon(fit);
  term.open(el);
  let key = params.key || 'tmp-' + Date.now();
  const t = { term, fit, el, label, sessionId, ws: null };
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
  term.onData(d => ws.readyState === 1 && ws.send(JSON.stringify({ t: 'in', d })));
  term.onResize(({ cols, rows }) => ws.readyState === 1 && ws.send(JSON.stringify({ t: 'resize', cols, rows })));
}

function showTerm(key) {
  state.active = key;
  $('#home').hidden = true;
  for (const [k, t] of state.terms) t.el.hidden = k !== key;
  const t = state.terms.get(key);
  $('#termTitle').textContent = '💻 ' + t.label;
  $('#closeTerm').hidden = false;
  requestAnimationFrame(() => { t.fit.fit(); t.term.focus(); });
  renderTasks();
}

async function closeTerm(key) {
  const t = state.terms.get(key);
  if (!t) return;
  const ok = await confirmModal('Cerrar terminal',
    `¿Cerrar la terminal <b>${esc(t.label)}</b>?<br>Claude se detendrá, pero la conversación queda guardada y puedes retomarla después.`,
    '✕ Cerrar terminal');
  if (!ok || !state.terms.has(key)) return;
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
});

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
const group = (h, body) => `<section class="group"><h3>${h}</h3><div>${body}</div></section>`;
const kv = rows => `<dl class="kv">${rows.map(([k, v]) => `<dt>${k}</dt><dd title="${esc(v)}">${esc(v)}</dd>`).join('')}</dl>`;
function sum(objs) {
  const out = {};
  for (const o of objs) for (const [k, v] of Object.entries(o)) out[k] = (out[k] || 0) + v;
  return out;
}

function renderStats() {
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
    ])) +
    group('💬 Qué pasó', `<small>Primer prompt</small>${promptBtn(s.firstPrompt, 'first')}
      <small>Último prompt</small>${promptBtn(s.lastPrompt, 'last')}
      ${kv([['Prompts tuyos', s.prompts], ['Respuestas de Claude', s.assistantMsgs]])}`) +
    group('🗨 Conversación' + (c?.list ? ` (${c.list.length})` : ''),
      `<div id="convo" class="convo" data-id="${esc(s.id)}" data-n="${c?.list?.length ?? ''}">${c?.list ? convoHtml(c.list) : '<small>Cargando…</small>'}</div>`) +
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
const who = m => m.role === 'user' ? '🧑 Tú' : '🤖 Claude';
const convoHtml = list => list.length
  ? list.map((m, i) => `<button class="msg ${m.role}" data-msg="${i}" title="Ver el mensaje completo">
      <b>${who(m)}</b> <small>${esc(ago(m.ts))}</small><span>${esc(m.text.slice(0, 600))}</span></button>`).join('')
  : '<small>Sin mensajes de texto.</small>';

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
function openModal(heading, html) {
  modalSeq++;
  const m = $('#modal');
  if (m.open) m.close(); // resuelve lo que esperaba el modal anterior
  m.returnValue = '';
  $('#modalTitle').textContent = heading;
  const body = $('#modalBody');
  body.onclick = body.onkeydown = null; // quita los handlers del modal anterior (p. ej. el explorador)
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
$('#modal').addEventListener('click', e => {
  // click en el fondo oscuro o en la ×
  if (e.target === $('#modal') || e.target.closest('[data-close-modal]')) $('#modal').close();
});

$('#stats').addEventListener('click', async e => {
  const m = e.target.closest('[data-msg]');
  if (m) {
    const msg = state.convo?.list?.[+m.dataset.msg];
    if (msg) openModal(`${who(msg)} · ${dateTime(msg.ts)}`, `<div class="prompt-full">${esc(msg.text)}</div>`);
    return;
  }
  const b = e.target.closest('[data-prompt]');
  if (!b) return;
  const s = findSession(state.selected);
  const which = b.dataset.prompt;
  openModal((which === 'first' ? 'Primer prompt' : 'Último prompt') + ' · ' + title(s), '<p class="prompt-full">Cargando…</p>');
  try {
    const mine = (await messages(s)).filter(x => x.role === 'user');
    const full = which === 'first' ? mine[0] : mine[mine.length - 1];
    $('#modalBody').innerHTML = `<div class="prompt-full">${esc(full?.text || '—')}</div>`;
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

// ---------- carga de datos ----------
let firstLoad = true;
async function load() {
  try {
    const r = await fetch('/api/tree');
    const data = await r.json();
    state.projects = data.projects;
    state.repos = data.repos || {};
    // Tras recargar la página, reengancha las terminales que siguen vivas en el servidor.
    if (firstLoad) {
      firstLoad = false;
      for (const o of data.open) if (o.alive && !state.terms.has(o.key)) openTerm({ key: o.key }, o.label, o.sessionId);
      if (!state.active) showHome();
    }
    renderAll();
    if (!state.active && $('#home').hidden === false && !$('#home .warn')) showHome();
  } catch (err) {
    $('#tree').innerHTML = `<div class="empty">No se pudo leer las sesiones: ${esc(err.message)}</div>`;
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
$('#fullscreen').onclick = () => document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen();
document.addEventListener('fullscreenchange', () => {
  $('#fullscreen').textContent = document.fullscreenElement ? '⛶ Salir de pantalla completa' : '⛶ Pantalla completa';
});
window.addEventListener('resize', () => { const t = state.terms.get(state.active); t && t.fit.fit(); });
setInterval(() => { $('#clock').textContent = new Date().toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' }); }, 1000);
setInterval(load, 15000);
load();

// ---------- app de escritorio (Electron): botones de ventana y confirmación al cerrar ----------
if (window.desktop) {
  const d = window.desktop;
  document.documentElement.classList.add('desktop');
  $('.winbtns').hidden = false;
  $('#fullscreen').hidden = true; // en escritorio se usa maximizar
  $('#winMin').onclick = d.minimize;
  $('#winMax').onclick = d.maximize;
  $('#winClose').onclick = d.close;
  const setMax = max => { $('#winMax').textContent = max ? '❐' : '□'; $('#winMax').title = $('#winMax').ariaLabel = max ? 'Restaurar' : 'Maximizar'; };
  d.isMaximized().then(setMax);
  d.onMaximizedChange(setMax);
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
