// Diagnóstico: bloqueos del event loop y avisos repetidos agrupados. Nunca registra contenido de sesiones.
import os from 'node:os';
import { performance } from 'node:perf_hooks';

/**
 * Vigila el event loop y llama a log() cuando un tramo ocupado supera thresholdMs.
 * Usa un temporizador cada intervalMs y mide cuánto se atrasó. En Windows el temporizador tiene una
 * resolución de ~15,6 ms: con un umbral de 50 ms ese error no produce falsos positivos.
 * Un atraso con el hilo libre (equipo suspendido, proceso pausado) no es un bloqueo. Donde existe la
 * utilización del event loop (ELU, en Node), solo se avisa si confirma que estuvo ocupado al menos la
 * mitad de ese atraso. En el proceso principal de Electron la ELU siempre da 0 (el loop lo maneja
 * Chromium): ahí se usa solo el atraso, y quien llama debe pausar con pause()/resume() al suspender.
 * Devuelve una función para detenerlo, con los métodos pause() y resume().
 */
export function startLagMonitor({ log, thresholdMs = 50, intervalMs = 250, context = () => '', quietMs = 10_000 }) {
  let expected = performance.now() + intervalMs;
  let elu = performance.eventLoopUtilization();
  let lastLog = -Infinity, suppressed = 0, worst = 0, paused = false;
  const timer = setInterval(() => {
    const now = performance.now();
    const lag = now - expected;
    const d = performance.eventLoopUtilization(elu); // ms ocupados y libres desde la medición anterior
    elu = performance.eventLoopUtilization();
    expected = now + intervalMs;
    if (paused || lag <= thresholdMs) return;
    const eluWorks = d.active + d.idle > intervalMs * 0.1;
    if (eluWorks && d.active < lag * 0.5) return; // el hilo estaba libre: no fue un bloqueo
    if (now - lastLog < quietMs) { suppressed++; worst = Math.max(worst, lag); return; } // sin ruido constante
    const ctx = context();
    const extra = suppressed ? `; ${suppressed} más en los últimos ${Math.round((now - lastLog) / 1000)} s (peor ${Math.round(worst)} ms)` : '';
    log(`event loop bloqueado ${Math.round(lag)} ms (proceso ${process.type || 'node'}, pid ${process.pid}${ctx ? ', en curso: ' + ctx : ''}${extra})`);
    lastLog = now; suppressed = 0; worst = 0;
  }, intervalMs);
  timer.unref(); // no impide que el proceso termine
  const stop = () => clearInterval(timer);
  stop.pause = () => { paused = true; };
  stop.resume = () => { paused = false; expected = performance.now() + intervalMs; elu = performance.eventLoopUtilization(); };
  return stop;
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
