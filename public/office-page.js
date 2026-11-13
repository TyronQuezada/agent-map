// Oficina en su propia ventana: se puede mover a otro monitor y poner en pantalla completa.
// Lee el mismo estado que el panel (/api/team) y avisa a la ventana principal al cerrarse.
const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const dir = new URLSearchParams(location.search).get('dir') || '';
const channel = 'BroadcastChannel' in window ? new BroadcastChannel('agentmap-office') : null;
const office = new Office($('#offCanvas'));
const portraits = [0, 1, 2].map(i => Office.portrait(i));
let data = null, writes = {};

// Aquí hay espacio: se ven los globos de todos los que trabajan, no solo al pasar el mouse.
office.bubbles($('#offWrap'), i => Office.info(data, i, office.night()), () => true,
  i => data?.members[i] && channel?.postMessage({ type: 'pick', key: data.members[i].key })); // su historial, en la ventana principal
office.nightLabel($('#offWrap'));

// Sin tokens (plan al 100 %): luz apagada y cuenta regresiva hasta que se renueven.
async function pollUsage() {
  try { office.setNight(Office.waitUntil((await (await fetch('/api/usage')).json()).usage)); } catch { /* reintenta */ }
}
pollUsage();
setInterval(pollUsage, 30000);

async function poll() {
  try {
    const r = await fetch('/api/team?dir=' + encodeURIComponent(dir));
    data = await r.json();
  } catch { data = null; }
  $('#offMsg').hidden = !!data;
  if (!data) { $('#offMsg').textContent = 'No se pudo leer el equipo de esta carpeta.'; return; }
  document.title = '🏢 ' + data.team.boss.name + ' y equipo · Agent Map';
  $('#offTitle').textContent = '🏢 Oficina de ' + data.team.boss.name;
  office.setWorking(data.members.map(m => m.state === 'working'));
  data.members.slice(1).forEach((m, i) => {
    if (writes[m.key] !== undefined && m.writes > writes[m.key]) office.ping(i + 1);
    writes[m.key] = m.writes;
  });
  $('#offLegend').innerHTML = data.members.map((m, i) =>
    `<span><img src="${portraits[i]}" alt=""> ${esc(m.name)} ${m.state === 'working' ? '💻 ' + esc(Office.elapsed(m.since)) : '😴'}</span>`).join('');
}
poll();
setInterval(poll, 1500);

const toggleFull = () => document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen();
$('#offFull').onclick = toggleFull;
document.addEventListener('keydown', e => {
  if (e.key === 'F11') { e.preventDefault(); toggleFull(); }
  if (e.key === 'Escape' && document.fullscreenElement) document.exitFullscreen();
});
document.addEventListener('fullscreenchange', () => {
  $('#offFull').textContent = document.fullscreenElement ? '⛶ Salir de pantalla completa' : '⛶ Pantalla completa';
});
$('#offDock').onclick = () => { channel?.postMessage({ type: 'dock' }); window.close(); };
channel?.addEventListener('message', e => { if (e.data?.type === 'dock') window.close(); });
window.addEventListener('pagehide', () => channel?.postMessage({ type: 'closed' }));
