// node scripts/bench-termbuf.mjs — compara el búfer de terminal anterior ((b + d).slice(-400000) por trozo)
// con TermBuffer. Mide el total de cada ráfaga y el peor trozo (lo que el hilo principal queda ocupado de una vez).
// Incluye leer el búfer al final (lo que cuesta una reconexión) y verifica que ambos den el mismo texto.
import { TermBuffer } from '../lib/termbuf.js';

const MAX = 400_000;
const str = n => { let s = ''; while (s.length < n) s += 'línea de salida \x1b[32mok\x1b[0m 😀\r\n'; return s.slice(0, n); };
const CASES = [
  ['2000 trozos de 4 KB (búfer lleno)', 2000, 4096],
  ['20 000 trozos de 100 B', 20_000, 100],
  ['200 trozos de 64 KB', 200, 65_536],
  ['100 000 trozos de 1 carácter', 100_000, 1],
];

function run(push, read, chunks) {
  let worst = 0;
  const t0 = performance.now();
  for (const d of chunks) { const t = performance.now(); push(d); worst = Math.max(worst, performance.now() - t); }
  const total = performance.now() - t0;
  const t = performance.now(); const out = read(); const readMs = performance.now() - t;
  return { total, worst, readMs, out };
}

const fmt = n => n.toFixed(n < 10 ? 2 : 0).padStart(7);
console.log('caso'.padEnd(36), '| anterior: total  peor | nuevo: total  peor  leer | mismo texto');
for (const [name, n, size] of CASES) {
  const base = str(size);
  const chunks = Array.from({ length: n }, (_, i) => base.slice(0, size - 1) + String.fromCharCode(97 + i % 26));
  const prefill = Array.from({ length: Math.ceil(MAX / 4096) }, () => str(4096));
  let b = ''; const tb = new TermBuffer(MAX);
  for (const d of prefill) { b = (b + d).slice(-MAX); tb.push(d); }
  const o = run(d => { b = (b + d).slice(-MAX); }, () => b, chunks);
  const nw = run(d => tb.push(d), () => tb.toString(), chunks);
  console.log(name.padEnd(36), '|', fmt(o.total), 'ms', fmt(o.worst), '|', fmt(nw.total), 'ms', fmt(nw.worst), fmt(nw.readMs), '|', o.out === nw.out ? 'sí' : 'NO');
  if (o.out !== nw.out) process.exitCode = 1;
}
