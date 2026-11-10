// Genera build/icon.png y build/icon.ico (mapa de nodos sobre azul XP) sin dependencias: PNG con zlib + ICO con PNGs dentro.
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const out = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'build');
const cover = d => Math.min(1, Math.max(0, 0.5 - d)); // distancia con signo -> cobertura (antialias)
const dRoundRect = (x, y, x0, y0, size, r) =>
  Math.hypot(x - Math.min(Math.max(x, x0 + r), x0 + size - r), y - Math.min(Math.max(y, y0 + r), y0 + size - r)) - r;
const dCircle = (x, y, cx, cy, r) => Math.hypot(x - cx, y - cy) - r;
function dSegment(x, y, ax, ay, bx, by, w) {
  const t = Math.max(0, Math.min(1, ((x - ax) * (bx - ax) + (y - ay) * (by - ay)) / ((bx - ax) ** 2 + (by - ay) ** 2)));
  return Math.hypot(x - ax - t * (bx - ax), y - ay - t * (by - ay)) - w / 2;
}
const mix = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);
function over(px, i, rgb, a) { // pinta rgb con opacidad a sobre el píxel
  const da = px[i + 3] / 255, oa = a + da * (1 - a);
  if (!oa) return;
  for (let k = 0; k < 3; k++) px[i + k] = Math.round((rgb[k] * a + px[i + k] * da * (1 - a)) / oa);
  px[i + 3] = Math.round(oa * 255);
}

function draw(n) {
  const px = Buffer.alloc(n * n * 4);
  const u = n / 100; // trabajar en una grilla de 100x100
  const nodes = [[50, 28], [28, 70], [72, 70]];
  const W = [255, 255, 255];
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const i = (y * n + x) * 4, X = (x + 0.5) / u, Y = (y + 0.5) / u;
    // fondo: azul Luna con degradé vertical y borde más oscuro
    const d = dRoundRect(X, Y, 4, 4, 92, 20);
    const bg = cover(d * u);
    if (!bg) continue;
    over(px, i, mix([0x4a, 0x9d, 0xff], [0x0a, 0x4f, 0xc8], Y / 100), bg);
    over(px, i, [0x06, 0x35, 0x9a], bg * cover(-(d + 2.2) * u) * 0.9); // borde fino oscuro
    // líneas que conectan la sesión con sus subagentes
    const line = Math.max(cover(dSegment(X, Y, 50, 28, 28, 70, 5) * u), cover(dSegment(X, Y, 50, 28, 72, 70, 5) * u));
    if (line) over(px, i, W, line * 0.9);
    // nodos blancos; el de arriba lleva el punto verde de "activa"
    for (const [cx, cy] of nodes) { const a = cover(dCircle(X, Y, cx, cy, 11) * u); if (a) over(px, i, W, a); }
    const dot = cover(dCircle(X, Y, 50, 28, 5.5) * u);
    if (dot) over(px, i, [0x3c, 0xb0, 0x3a], dot);
  }
  return px;
}

const CRC = new Int32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c; });
const crc32 = buf => { let c = -1; for (const b of buf) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ -1) >>> 0; };
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function png(n) {
  const px = draw(n);
  const raw = Buffer.alloc(n * (n * 4 + 1));
  for (let y = 0; y < n; y++) px.copy(raw, y * (n * 4 + 1) + 1, y * n * 4, (y + 1) * n * 4); // filtro 0 por fila
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(n, 0); ihdr.writeUInt32BE(n, 4); ihdr[8] = 8; ihdr[9] = 6; // 8 bits RGBA
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}
function ico(sizes) {
  const imgs = sizes.map(png);
  const head = Buffer.alloc(6 + 16 * imgs.length);
  head.writeUInt16LE(1, 2); head.writeUInt16LE(imgs.length, 4);
  let offset = head.length;
  imgs.forEach((img, i) => {
    const e = 6 + 16 * i, n = sizes[i];
    head[e] = n >= 256 ? 0 : n; head[e + 1] = n >= 256 ? 0 : n; // 0 = 256
    head.writeUInt16LE(1, e + 4); head.writeUInt16LE(32, e + 6);
    head.writeUInt32LE(img.length, e + 8); head.writeUInt32LE(offset, e + 12);
    offset += img.length;
  });
  return Buffer.concat([head, ...imgs]);
}

fs.mkdirSync(out, { recursive: true });
fs.writeFileSync(path.join(out, 'icon.png'), png(512));
fs.writeFileSync(path.join(out, '..', 'public', 'icon.png'), png(64)); // logo de la barra de título y favicon
fs.writeFileSync(path.join(out, 'icon.ico'), ico([16, 24, 32, 48, 64, 128, 256]));
console.log('Icono generado en', out);
