// Búfer de terminal (E0.2.c A2): mismo resultado exacto que `(buffer + d).slice(-max)`, sin su costo por trozo.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TermBuffer } from '../lib/termbuf.js';

const MAX = 400_000;
// El algoritmo anterior, tal cual estaba en server.js.
const oldPush = (b, d, max = MAX) => (b + d).slice(-max);

function feed(chunks, max = MAX) {
  const tb = new TermBuffer(max);
  let old = '';
  for (const d of chunks) { tb.push(d); old = oldPush(old, d, max); }
  return { tb, old };
}

let seed = 12345;
const rnd = n => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed % n; };
const ALPHA = 'abcxyz \r\n\x1b[0m→ñ😀🎉中';
const randStr = n => { let s = ''; while (s.length < n) s += ALPHA[rnd(ALPHA.length)]; return s; };

test('fragmentos pequeños: contenido y orden idénticos', () => {
  const { tb, old } = feed(['hola ', 'mundo', '\r\n', 'línea 2']);
  assert.equal(tb.toString(), 'hola mundo\r\nlínea 2');
  assert.equal(tb.toString(), old);
  assert.equal(tb.length, old.length);
});

test('vacío y trozos vacíos', () => {
  const tb = new TermBuffer(MAX);
  assert.equal(tb.toString(), '');
  tb.push(''); tb.append('');
  assert.equal(tb.toString(), '');
  assert.equal(tb.chunks.length, 0);
});

test('un fragmento solo, mayor que el límite: quedan sus últimos 400 000', () => {
  const big = randStr(MAX + 12_345);
  const { tb, old } = feed(['previo', big]);
  assert.equal(tb.toString(), old);
  assert.equal(tb.length, MAX);
  assert.equal(tb.chunks.length, 1);
  assert.equal(tb.chunks[0].length, MAX); // no retiene la parte que ya no sirve
});

test('fragmento exactamente del límite y uno de límite - 1', () => {
  for (const n of [MAX, MAX - 1, MAX + 1]) {
    const { tb, old } = feed(['abc', randStr(n), 'z']);
    assert.equal(tb.toString(), old, 'n=' + n);
  }
});

test('muchos fragmentos consecutivos: el arreglo de trozos queda acotado', () => {
  const chunks = Array.from({ length: 20_000 }, (_, i) => 'x' + i + ' ');
  const { tb, old } = feed(chunks);
  assert.equal(tb.toString(), old);
  assert.ok(tb.chunks.length <= 513, 'trozos=' + tb.chunks.length);
  // con trozos de 1 carácter (el peor caso para la cantidad) también
  const ones = feed(Array.from({ length: 60_000 }, (_, i) => String.fromCharCode(97 + i % 26)), 4096);
  assert.equal(ones.tb.toString(), ones.old);
  assert.ok(ones.tb.chunks.length <= 513);
});

test('recorte de fragmentos antiguos: los que quedan enteros fuera se descartan', () => {
  const tb = new TermBuffer(10);
  tb.push('aaaa'); tb.push('bbbb'); tb.push('cccc'); // 12 > 10: 'aaaa' cae a medias
  assert.equal(tb.toString(), 'aabbbbcccc');
  assert.equal(tb.chunks.length, 3);
  tb.push('dddd'); // ahora 'aaaa' queda entera fuera y se descarta
  assert.equal(tb.toString(), 'bbccccdddd');
  assert.deepEqual(tb.chunks, ['bbbb', 'cccc', 'dddd']);
  assert.equal(tb.len, 12);
});

test('comparación exacta contra el algoritmo anterior (aleatorio, varios límites)', () => {
  for (const max of [1, 7, 100, 4096, MAX]) {
    const tb = new TermBuffer(max);
    let old = '';
    for (let i = 0; i < 1500; i++) {
      const r = rnd(100);
      const d = r < 2 ? randStr(max + rnd(50)) : r < 4 ? '' : randStr(1 + rnd(Math.min(max * 2, 9000)));
      tb.push(d); old = oldPush(old, d, max);
      if (i % 97 === 0) assert.equal(tb.toString(), old, `max=${max} i=${i}`);
    }
    assert.equal(tb.toString(), old, 'max=' + max);
  }
});

test('Unicode y emojis: corta en la misma unidad UTF-16 que antes', () => {
  const chunks = ['ñandú ', '😀'.repeat(7), '中文', '🎉x'];
  for (const max of [3, 4, 5, 11, 12]) {
    const { tb, old } = feed(chunks, max);
    assert.equal(tb.toString(), old, 'max=' + max);
  }
  const { tb, old } = feed(Array.from({ length: 5000 }, () => '😀🎉ñ'.repeat(1 + rnd(40))));
  assert.equal(tb.toString(), old);
});

test('aviso de proceso terminado: se agrega sin recortar, igual que `buffer += msg`', () => {
  const msg = '\r\n\x1b[90m[Proceso terminado, código 0.]\x1b[0m\r\n';
  const tb = new TermBuffer(MAX);
  let old = '';
  for (let i = 0; i < 300; i++) { const d = randStr(3000); tb.push(d); old = oldPush(old, d); }
  tb.append(msg); old += msg;
  assert.equal(tb.toString(), old);
  assert.equal(tb.length, MAX + msg.length);
  tb.push('tarde'); old = oldPush(old, 'tarde'); // si llegara salida después, se recorta como antes
  assert.equal(tb.toString(), old);
});

test('reconexión: leer el búfer no lo altera y se puede leer las veces que haga falta', () => {
  const { tb, old } = feed(Array.from({ length: 1000 }, () => randStr(1 + rnd(2000))));
  const a = tb.toString(), b = tb.toString();
  assert.equal(a, old); assert.equal(b, old);
  tb.push('más'); // y sigue recibiendo después de una reconexión
  assert.equal(tb.toString(), oldPush(old, 'más'));
});

test('ráfaga de 2000 fragmentos de 4 KB sobre un búfer lleno: idéntico y más rápido', () => {
  const chunks = Array.from({ length: 2000 }, () => randStr(4096));
  const tb = new TermBuffer(MAX);
  let old = '';
  for (const d of chunks.slice(0, 200)) { tb.push(d); old = oldPush(old, d); } // llenar primero
  const burst = chunks.slice(200).concat(chunks.slice(0, 200));
  let t = performance.now();
  for (const d of burst) old = oldPush(old, d);
  const tOld = performance.now() - t;
  t = performance.now();
  for (const d of burst) tb.push(d);
  const tNew = performance.now() - t;
  assert.equal(tb.toString(), old);
  assert.ok(tNew < tOld, `nuevo ${tNew.toFixed(1)} ms, anterior ${tOld.toFixed(1)} ms`);
  assert.ok(tNew < 50, `nuevo ${tNew.toFixed(1)} ms`);
});
