// Diagnóstico: bloqueos del event loop y avisos repetidos agrupados. Nunca registra contenido de sesiones.
import os from 'node:os';
import { performance, PerformanceObserver } from 'node:perf_hooks';

/**
 * Vigila el event loop y llama a log() cuando un tramo ocupado supera thresholdMs.
 * Usa un temporizador cada intervalMs y mide cuánto se atrasó. En Windows el temporizador tiene una
 * resolución de ~15,6 ms: con un umbral de 50 ms ese error no produce falsos positivos.
 * Solo se ve la parte del bloqueo que pasa de la hora del tick siguiente: la duración registrada es un mínimo
 * (el bloqueo real puede ser hasta intervalMs mayor). Con 250 ms se perdían bloqueos de 100–250 ms; con 50 ms
 * todo bloqueo de más de ~115 ms se detecta siempre. Cada tick cuesta menos de 1 µs.
 * Un atraso con el hilo libre (equipo suspendido, proceso pausado) no es un bloqueo. Donde existe la
 * utilización del event loop (ELU, en Node), solo se avisa si confirma que estuvo ocupado al menos la
 * mitad de ese atraso. En el proceso principal de Electron la ELU siempre da 0 (el loop lo maneja
 * Chromium): ahí se usa solo el atraso, y quien llama debe pausar con pause()/resume() al suspender.
 * Con `activity` (ver createActivity) cada aviso agrega qué pasó en el tramo del bloqueo: salida de terminales,
 * eventos de ventana, recolección de basura (GC) y memoria del proceso. Ese aviso se escribe un tick después
 * (intervalMs) para que lleguen las mediciones de GC del tramo. Sin `activity` el formato es el de siempre.
 * Devuelve una función para detenerlo, con los métodos pause() y resume().
 */
export function startLagMonitor({ log, thresholdMs = 50, intervalMs = 50, context = () => '', quietMs = 10_000, activity = null, memory = () => process.memoryUsage() }) {
  let expected = performance.now() + intervalMs;
  let lastTick = performance.now();
  let elu = performance.eventLoopUtilization();
  let lastLog = -Infinity, suppressed = 0, worst = 0, paused = false;
  let pending = null; // aviso con actividad: se completa y escribe en el tick siguiente
  let gcs = [];       // [inicio, duración] de las GC recientes
  let obs = null;
  if (activity) {
    try {
      obs = new PerformanceObserver(list => {
        for (const e of list.getEntries()) gcs.push([e.startTime, e.duration]);
        if (gcs.length > 400) gcs = gcs.slice(-200);
      });
      obs.observe({ entryTypes: ['gc'] });
    } catch { obs = null; }
  }
  const flush = () => {
    if (!pending) return;
    const p = pending; pending = null;
    const inWindow = gcs.filter(([s]) => s >= p.from && s <= p.to);
    const gc = { n: inWindow.length, ms: inWindow.reduce((a, [, d]) => a + d, 0), max: Math.max(0, ...inWindow.map(([, d]) => d)) };
    let mem = null;
    try { mem = memory(); } catch {}
    log(`${p.msg} — ${formatActivity({ act: p.act, lastWindow: p.lastWindow, gc: obs ? gc : null, mem })}`);
  };
  const timer = setInterval(() => {
    const now = performance.now();
    const lag = now - expected;
    const from = lastTick;
    lastTick = now;
    const d = performance.eventLoopUtilization(elu); // ms ocupados y libres desde la medición anterior
    elu = performance.eventLoopUtilization();
    expected = now + intervalMs;
    const act = activity?.take(); // lo de este tramo; se descarta si no hubo bloqueo
    flush();
    if (paused || lag <= thresholdMs) return;
    const eluWorks = d.active + d.idle > intervalMs * 0.1;
    if (eluWorks && d.active < lag * 0.5) return; // el hilo estaba libre: no fue un bloqueo
    if (now - lastLog < quietMs) { suppressed++; worst = Math.max(worst, lag); return; } // sin ruido constante
    const ctx = context();
    const extra = suppressed ? `; ${suppressed} más en los últimos ${Math.round((now - lastLog) / 1000)} s (peor ${Math.round(worst)} ms)` : '';
    const msg = `event loop bloqueado ${Math.round(lag)} ms (proceso ${process.type || 'node'}, pid ${process.pid}${ctx ? ', en curso: ' + ctx : ''}${extra})`;
    if (activity) pending = { msg, act, from, to: now, lastWindow: activity.lastOf('ventana:', now, 5000) };
    else log(msg);
    lastLog = now; suppressed = 0; worst = 0;
  }, intervalMs);
  timer.unref(); // no impide que el proceso termine
  const stop = () => { clearInterval(timer); flush(); obs?.disconnect(); };
  stop.pause = () => { paused = true; };
  stop.resume = () => { paused = false; expected = performance.now() + intervalMs; lastTick = performance.now(); elu = performance.eventLoopUtilization(); activity?.take(); };
  return stop;
}

/**
 * Contadores de actividad entre dos ticks del monitor de bloqueos. add() es O(1) (un Map), apto para
 * llamarse por cada trozo de salida de una terminal. Solo guarda nombres fijos, cantidades y bytes.
 */
export function createActivity() {
  let cur = new Map();    // nombre -> { n, bytes } desde el último take()
  const last = new Map(); // nombre -> performance.now() del último evento
  return {
    add(name, bytes = 0) {
      const e = cur.get(name);
      if (e) { e.n++; e.bytes += bytes; } else cur.set(name, { n: 1, bytes });
      last.set(name, performance.now());
    },
    take() { const c = cur; cur = new Map(); return c; },
    /** El evento más reciente cuyo nombre empieza con `prefix`, si ocurrió hace menos de withinMs. */
    lastOf(prefix, now, withinMs) {
      let best = null;
      for (const [name, t] of last) if (name.startsWith(prefix) && now - t < withinMs && (!best || t > best.t)) best = { name, t };
      return best && { name: best.name, ago: now - best.t };
    },
  };
}
/** Actividad compartida: el servidor cuenta la salida de las terminales y la app de escritorio los eventos de ventana. */
export const activity = createActivity();

const MB = n => Math.round(n / 1048576);
/**
 * Texto de la actividad de un tramo para el log. Ejemplo:
 * "terminal 37 trozos/151 KB; ventana resize×3, maximize×1; gc 2× 41 ms (máx 30); memoria rss 210 MB, heap 80/120 MB, externa 6 MB"
 */
export function formatActivity({ act = new Map(), lastWindow = null, gc = null, mem = null }) {
  const parts = [];
  const term = act.get('terminal');
  parts.push(term ? `terminal ${term.n} trozos/${Math.round(term.bytes / 1024)} KB` : 'terminal 0');
  const win = [...act].filter(([k]) => k.startsWith('ventana:')).map(([k, v]) => `${k.slice(8)}×${v.n}`);
  if (win.length) parts.push('ventana ' + win.join(', '));
  else if (lastWindow) parts.push(`ventana: última ${lastWindow.name.slice(8)} hace ${Math.round(lastWindow.ago)} ms`);
  const other = [...act].filter(([k]) => k !== 'terminal' && !k.startsWith('ventana:')).map(([k, v]) => `${k}×${v.n}`);
  if (other.length) parts.push(other.join(', '));
  if (gc) parts.push(gc.n ? `gc ${gc.n}× ${Math.round(gc.ms)} ms (máx ${Math.round(gc.max)})` : 'gc 0');
  if (mem) parts.push(`memoria rss ${MB(mem.rss)} MB, heap ${MB(mem.heapUsed)}/${MB(mem.heapTotal)} MB, externa ${MB(mem.external)} MB`);
  return parts.join('; ');
}

/**
 * Agrupa avisos repetidos: el mismo `key` se registra como máximo una vez por windowMs; las repeticiones
 * se cuentan y se informan en el siguiente aviso de esa clave. Útil para errores en consultas periódicas.
 */
export function createThrottle(log, windowMs = 60_000) {
  const seen = new Map(); // key -> { last, count }
  return (key, msg) => {
    const now = Date.now(), e = seen.get(key);
    if (e && now - e.last < windowMs) { e.count++; return; }
    log(msg + (e?.count ? ` (+${e.count} iguales en el último minuto)` : ''));
    seen.set(key, { last: now, count: 0 });
  };
}

const HOME = os.homedir();
/** Mensaje técnico apto para el log: sin la carpeta del usuario, en una línea y corto. */
export function sanitize(msg, max = 200) {
  const s = String(msg ?? '').split(HOME).join('~').replace(/\s+/g, ' ').trim();
  return s.length > max ? s.slice(0, max) + '…' : s;
}
