// Genera los sonidos de aviso incluidos con la app (assets/sounds/*.wav): tonos sintetizados aquí mismo, originales y
// libres de derechos de terceros, para que los avisos suenen desde una instalación limpia. Salida determinista.
// Uso: node scripts/make-sounds.js
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const RATE = 22050;
const out = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'assets', 'sounds');

/** Nota de campana: fundamental + armónicos suaves, ataque corto y caída exponencial. */
function bell(freq, secs, gain = 1) {
  const n = Math.round(RATE * secs);
  const s = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / RATE;
    const env = Math.min(1, t / 0.006) * Math.exp(-t * 7);
    s[i] = gain * env * (Math.sin(2 * Math.PI * freq * t) + 0.35 * Math.sin(4 * Math.PI * freq * t) + 0.12 * Math.sin(6 * Math.PI * freq * t));
  }
  return s;
}

/** Mezcla notas [freq, inicio s, duración s] en una pista y la normaliza a 0,8 del máximo. */
function mix(notes) {
  const len = Math.max(...notes.map(([, at, d]) => Math.round(RATE * (at + d))));
  const s = new Float64Array(len);
  for (const [f, at, d, g] of notes) bell(f, d, g).forEach((v, i) => { s[Math.round(RATE * at) + i] += v; });
  const peak = Math.max(...s.map(Math.abs));
  return s.map(v => v / peak * 0.8);
}

function wav(samples) {
  const data = Buffer.alloc(samples.length * 2);
  samples.forEach((v, i) => data.writeInt16LE(Math.round(Math.max(-1, Math.min(1, v)) * 32767), i * 2));
  const h = Buffer.alloc(44);
  h.write('RIFF', 0); h.writeUInt32LE(36 + data.length, 4); h.write('WAVE', 8);
  h.write('fmt ', 12); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22);
  h.writeUInt32LE(RATE, 24); h.writeUInt32LE(RATE * 2, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34);
  h.write('data', 36); h.writeUInt32LE(data.length, 40);
  return Buffer.concat([h, data]);
}

export const SOUNDS = {
  'agentmap-mensaje.wav': mix([[659.25, 0, 0.35], [880, 0.11, 0.45]]),                      // respuesta nueva: dos notas que suben
  'agentmap-fin.wav': mix([[523.25, 0, 0.3], [659.25, 0.1, 0.3], [783.99, 0.2, 0.6, 1.1]]),  // terminó: arpegio do-mi-sol
  'agentmap-aviso.wav': mix([[392, 0, 0.25, 0.9], [392, 0.16, 0.35, 0.9]]),                  // otros avisos: dos toques suaves
};

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  fs.mkdirSync(out, { recursive: true });
  for (const [name, s] of Object.entries(SOUNDS)) {
    fs.writeFileSync(path.join(out, name), wav(s));
    console.log(`${name}: ${(s.length / RATE).toFixed(2)} s`);
  }
}
