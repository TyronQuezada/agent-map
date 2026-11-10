// Lector incremental: debe dar exactamente lo mismo que leer el archivo completo, sin perder ni duplicar nada.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { monitorEventLoopDelay, performance } from 'node:perf_hooks';
import { JsonlTail } from '../lib/jsonl.js';
import { parseSession, sessionSummary, readMessages, readMessagesFull } from '../lib/scan.js';

/** Carpeta temporal que se borra al terminar la prueba, aunque falle. */
function tmp(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentmap-jsonl-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  let k = 0;
  const name = () => path.join(dir, `11111111-2222-3333-4444-${String(++k).padStart(12, '0')}.jsonl`);
  return { dir, file: name(), name };
}
const line = r => JSON.stringify(r) + '\n';
const lines = rs => rs.map(line).join('');
let n = 0;
const user = text => ({ type: 'user', timestamp: `2026-01-01T10:00:${String(n++ % 60).padStart(2, '0')}Z`, cwd: 'D:\\x', message: { role: 'user', content: text } });
const claude = (id, text, extra = []) => ({ type: 'assistant', timestamp: '2026-01-01T10:01:00Z',
  message: { id, model: 'claude-x', usage: { input_tokens: 3, output_tokens: 2 }, content: [{ type: 'text', text }, ...extra] } });
const tool = id => ({ type: 'assistant', message: { id, model: 'claude-x', usage: { input_tokens: 1 }, content: [{ type: 'tool_use', name: 'Bash', input: {} }] } });
const texts = async file => (await readMessages(file)).map(m => m.text);
const quiet = t => { const w = console.warn; console.warn = () => {}; t.after(() => { console.warn = w; }); };

/** El incremental (con caché) y el completo (sin caché) deben coincidir en resumen y conversación. */
async function sameAsFull(file) {
  assert.deepEqual(await sessionSummary(file), await parseSession(file));
  assert.deepEqual(await readMessages(file), await readMessagesFull(file));
}

test('lectura inicial: igual al parseo completo', async t => {
  const { file } = tmp(t);
  fs.writeFileSync(file, lines([user('hola'), claude('m1', 'respuesta'), tool('m2'), user('chao')]));
  await sameAsFull(file);
});

test('líneas nuevas: solo se leen los bytes agregados y el resultado sigue igual al completo', async t => {
  const { file } = tmp(t);
  fs.writeFileSync(file, line(user('uno')));
  const tail = new JsonlTail(file);
  const seen = [];
  assert.equal((await tail.read(r => seen.push(r))).records, 1);
  for (let i = 0; i < 5; i++) {
    const add = line(claude('c' + i, 'resp ' + i)) + line(user('p' + i));
    fs.appendFileSync(file, add);
    const r = await tail.read(x => seen.push(x));
    assert.equal(r.records, 2);
    assert.equal(r.reset, false);
    assert.equal(r.bytes, Buffer.byteLength(add)); // nada más que lo nuevo
    await sameAsFull(file);
  }
  assert.equal(seen.length, 11);
  assert.equal((await tail.read(() => assert.fail('no hay nada nuevo'))).records, 0);
});

test('línea incompleta: se espera al resto y se entrega una sola vez', async t => {
  const { file } = tmp(t);
  const full = line(claude('m1', 'texto largo con ñ y emoji 🎮'));
  const cut = Buffer.byteLength(full) - 15; // el corte puede caer a mitad de un carácter UTF-8
  fs.writeFileSync(file, Buffer.concat([Buffer.from(line(user('hola'))), Buffer.from(full).subarray(0, cut)]));
  const tail = new JsonlTail(file);
  const got = [];
  assert.equal((await tail.read(r => got.push(r))).records, 1); // la incompleta no se entrega
  assert.equal((await tail.read(r => got.push(r))).records, 0); // ni en la siguiente lectura
  fs.appendFileSync(file, Buffer.from(full).subarray(cut));
  assert.equal((await tail.read(r => got.push(r))).records, 1); // completa: una vez
  assert.equal(got[1].message.content[0].text, 'texto largo con ñ y emoji 🎮');
  await sameAsFull(file);
});

test('última línea sin salto de línea pero completa: se toma, como el lector completo', async t => {
  const { file } = tmp(t);
  fs.writeFileSync(file, line(user('a')) + JSON.stringify(claude('m1', 'fin')));
  const tail = new JsonlTail(file);
  assert.equal((await tail.read(() => {})).records, 2);
  fs.appendFileSync(file, '\n' + line(user('b')));
  assert.equal((await tail.read(() => {})).records, 1); // el \n suelto no genera nada ni duplica
  await sameAsFull(file);
});

test('archivo truncado (más corto): se reinicia y no mezcla datos viejos', async t => {
  const { file } = tmp(t);
  fs.writeFileSync(file, lines([user('viejo 1'), claude('v1', 'vieja'), user('viejo 2')]));
  await sameAsFull(file);
  fs.writeFileSync(file, line(user('nuevo')));
  await sameAsFull(file);
  assert.deepEqual(await texts(file), ['nuevo']);
});

test('truncado y vuelto a crecer antes de leer, con los mismos primeros 64 bytes: se detecta', async t => {
  const { file } = tmp(t);
  const comun = { type: 'permission-mode', permissionMode: 'default', sessionId: 'misma-sesion-para-que-el-inicio-sea-igual' };
  fs.writeFileSync(file, lines([comun, user('viejo 1'), claude('v1', 'vieja 1'), claude('v2', 'vieja 2')]));
  const tail = new JsonlTail(file);
  await tail.read(() => {});
  await sameAsFull(file);
  const before = fs.statSync(file).size;
  fs.writeFileSync(file, lines([comun, user('NUEVO 1 ' + 'x'.repeat(300)), claude('n1', 'NUEVA')]));
  assert.ok(fs.statSync(file).size > before, 'creció por encima del offset viejo');
  assert.equal(fs.readFileSync(file).subarray(0, 64).toString(), JSON.stringify(comun).slice(0, 64)); // mismo inicio
  let resets = 0;
  assert.ok((await tail.read(() => {}, () => resets++)).reset);
  assert.equal(resets, 1);
  await sameAsFull(file);
  assert.deepEqual((await texts(file)).map(x => x.slice(0, 7)), ['NUEVO 1', 'NUEVA']);
});

test('reescrito con el mismo tamaño: se detecta por la huella de antes del offset', async t => {
  const { file } = tmp(t);
  fs.writeFileSync(file, lines([user('igual'), claude('a1', 'respuesta AAAA')]));
  const tail = new JsonlTail(file);
  await tail.read(() => {});
  await sameAsFull(file);
  const size = fs.statSync(file).size;
  fs.writeFileSync(file, lines([user('igual'), claude('a1', 'respuesta BBBB')]));
  assert.equal(fs.statSync(file).size, size);
  assert.ok((await tail.read(() => {})).reset);
  await sameAsFull(file);
  assert.deepEqual(await texts(file), ['igual', 'respuesta BBBB']);
});

test('reemplazado con rename (mismo tamaño, mismo inicio y mismo final): se detecta por la identidad', async t => {
  const { file } = tmp(t);
  const a = lines([user('inicio'), claude('x1', 'medio AAAA'), user('final')]);
  const b = lines([user('inicio'), claude('x1', 'medio BBBB'), user('final')]);
  assert.equal(a.length, b.length);
  fs.writeFileSync(file, a);
  const tail = new JsonlTail(file);
  await tail.read(() => {});
  await sameAsFull(file);
  fs.writeFileSync(file + '.tmp', b);
  fs.renameSync(file + '.tmp', file);
  assert.ok((await tail.read(() => {})).reset, 'el rename cambia el ino');
  await sameAsFull(file);
  assert.deepEqual(await texts(file), ['inicio', 'medio BBBB', 'final']);
});

test('borrado y recreado con el mismo nombre (Windows hereda el birthtime): se detecta por la identidad', async t => {
  const { file } = tmp(t);
  const a = lines([user('inicio'), claude('x1', 'medio AAAA'), user('final')]);
  const b = lines([user('inicio'), claude('x1', 'medio BBBB'), user('final')]);
  fs.writeFileSync(file, a);
  const tail = new JsonlTail(file);
  await tail.read(() => {});
  await sameAsFull(file);
  fs.unlinkSync(file);
  await assert.rejects(tail.read(() => {}), { code: 'ENOENT' });
  await assert.rejects(sessionSummary(file), { code: 'ENOENT' });
  await assert.rejects(readMessages(file), { code: 'ENOENT' });
  fs.writeFileSync(file, b);
  assert.ok((await tail.read(() => {})).reset);
  await sameAsFull(file);
  assert.deepEqual(await texts(file), ['inicio', 'medio BBBB', 'final']);
});

test('onRecord falla con dos lecturas en cola: nada se reentrega, el orden se respeta y la cola sigue', async t => {
  const { file } = tmp(t);
  fs.writeFileSync(file, lines([user('1'), user('2'), user('3'), user('4')]));
  const tail = new JsonlTail(file);
  const got = [];
  let boom = true;
  const cb = r => { if (boom && r.message.content === '2') { boom = false; throw new Error('falla'); } got.push(r.message.content); };
  const p1 = tail.read(cb);
  const p2 = tail.read(cb);
  await assert.rejects(p1, /falla/);
  const r2 = await p2;
  assert.deepEqual(got, ['1', '3', '4']); // "2" se dio por consumido; "1" no se repite
  assert.equal(r2.records, 2);
  fs.appendFileSync(file, line(user('5')));
  assert.equal((await tail.read(r => got.push(r.message.content))).records, 1); // la cola no quedó bloqueada
  assert.deepEqual(got, ['1', '3', '4', '5']);
  assert.equal((await tail.read(() => assert.fail('nada nuevo'))).records, 0);
});

test('registros que no son objetos de Claude Code: se ignoran, se cuentan y la sesión no desaparece', async t => {
  quiet(t);
  const { file } = tmp(t);
  const raros = ['null', '123', '"texto"', '[1,2]', '{}', '{"type":5}', 'true', '{roto'];
  fs.writeFileSync(file, line(user('antes')) + raros.join('\n') + '\n' + line(claude('m', 'después')) + line(tool('t')));
  const r = await new JsonlTail(file).read(() => {});
  assert.equal(r.records, 3);
  assert.deepEqual(r.skipped, { null: 1, number: 1, string: 1, array: 1, 'sin type': 2, boolean: 1, json: 1 });
  const s = await sessionSummary(file);
  assert.equal(s.prompts, 1);
  assert.equal(s.claudeMsgs, 1);
  assert.deepEqual(s.tools, { Bash: 1 });
  assert.deepEqual(await texts(file), ['antes', 'después']);
  await sameAsFull(file);
});

test('un registro con forma inesperada que hace fallar el procesamiento no tumba la sesión', async t => {
  quiet(t);
  const { file } = tmp(t);
  const raro = { type: 'assistant', message: { id: 'r', content: [{ type: 'tool_use', name: 42, input: {} }] } }; // name no es texto
  fs.writeFileSync(file, lines([user('hola'), raro, claude('m', 'sigue')]));
  const s = await sessionSummary(file);
  assert.equal(s.prompts, 1);
  assert.equal(s.claudeMsgs, 1);
  assert.deepEqual(await texts(file), ['hola', 'sigue']);
  await sameAsFull(file);
  fs.appendFileSync(file, line(user('después del error')));
  assert.equal((await sessionSummary(file)).prompts, 2); // lecturas posteriores siguen funcionando
  await sameAsFull(file);
});

test('el aviso de registros inesperados no incluye contenido de la conversación', async t => {
  const { file } = tmp(t);
  const avisos = [];
  const w = console.warn;
  console.warn = m => avisos.push(m);
  t.after(() => { console.warn = w; });
  fs.writeFileSync(file, line(user('secreto del usuario')) + '["dato privado"]\n' + JSON.stringify({ type: 'assistant', message: { content: [{ type: 'tool_use', name: { privado: 1 } }] } }) + '\n');
  await sessionSummary(file);
  assert.ok(avisos.length >= 1);
  for (const a of avisos) assert.ok(!/secreto|privado/.test(a), a);
  assert.match(avisos.join(' '), /array/);
});

test('reinicio del proceso: un lector nuevo sobre el mismo archivo da el mismo resultado', async t => {
  const { file } = tmp(t);
  fs.writeFileSync(file, lines([user('a'), claude('m', 'b'), tool('t')]));
  const before = await sessionSummary(file);
  const fresh = await import('../lib/scan.js?reinicio'); // módulo nuevo = cachés vacías, como al reabrir la app
  assert.deepEqual(await fresh.sessionSummary(file), before);
  assert.deepEqual(await fresh.readMessages(file), await readMessagesFull(file));
});

test('sin duplicados: lecturas simultáneas y un mensaje partido entre dos lecturas', async t => {
  const { file } = tmp(t);
  fs.writeFileSync(file, lines([user('hola'), claude('m1', 'parte 1')]));
  const tail = new JsonlTail(file);
  const got = [];
  await Promise.all([tail.read(r => got.push(r)), tail.read(r => got.push(r)), tail.read(r => got.push(r))]);
  assert.equal(got.length, 2);
  await readMessages(file);
  fs.appendFileSync(file, line(claude('m1', 'parte 2')) + line(tool('m1'))); // mismo id: se une al anterior
  const [a, b] = await Promise.all([readMessages(file), readMessages(file)]);
  assert.deepEqual(a, b);
  assert.deepEqual(a.map(m => m.text), ['hola', 'parte 1\n\nparte 2']);
  const s = await sessionSummary(file);
  assert.equal(s.assistantMsgs, 1); // el usage del mismo mensaje no se cuenta dos veces
  assert.deepEqual(s.tokens, { input: 3, output: 2, cacheRead: 0, cacheWrite: 0 });
  assert.equal(s.claudeMsgs, 1);
  await sameAsFull(file);
});

test('línea de varios MB repartida en bloques y fin de línea CRLF', async t => {
  const { file } = tmp(t);
  fs.writeFileSync(file, line(user('antes')) + line(claude('g', 'Ñ🎮'.repeat(600000))) + JSON.stringify(user('crlf')) + '\r\n' + line(user('después')));
  assert.ok(fs.statSync(file).size > 3 * 1048576);
  await sameAsFull(file);
  assert.deepEqual((await texts(file)).map(x => [...x].slice(0, 5).join('')), ['antes', 'Ñ🎮Ñ🎮Ñ', 'crlf', 'despu']); // por caracteres, no por unidades UTF-16
});

test('conversaciones desalojadas de la caché se releen bien', async t => {
  const { name } = tmp(t);
  const files = Array.from({ length: 8 }, () => { const f = name(); fs.writeFileSync(f, line(user('c'))); return f; });
  for (const f of files) await readMessages(f);
  fs.appendFileSync(files[0], line(claude('z', 'nueva')));
  assert.deepEqual(await readMessages(files[0]), await readMessagesFull(files[0]));
});

test('sesión grande: lectura por partes sin bloqueos largos y agregar 1 línea lee solo esa línea', async t => {
  const { file } = tmp(t);
  const big = 'é🎮'.repeat(2000); // multibyte: muchos cortes de 1 MB caen dentro de un carácter
  const fd = fs.openSync(file, 'w');
  for (let i = 0; i < 1800; i++) fs.writeSync(fd, line(user('p' + i)) + line(claude('m' + i, 'r' + i + big)) + line(tool('t' + i)));
  fs.closeSync(fd);
  assert.ok(fs.statSync(file).size > 20 * 1048576);

  const h = monitorEventLoopDelay({ resolution: 10 }); h.enable();
  await sameAsFull(file);
  h.disable();
  assert.ok(h.max / 1e6 < 1000, `bloqueo máximo ${(h.max / 1e6).toFixed(0)} ms`); // holgado: cede entre bloques de 1 MB

  const tail = new JsonlTail(file);
  await tail.read(() => {});
  const add = line(claude('nuevo', 'respuesta nueva'));
  fs.appendFileSync(file, add);
  assert.equal((await tail.read(() => {})).bytes, Buffer.byteLength(add)); // exacto: no relee el archivo
  const t0 = performance.now();
  const msgs = await readMessages(file);
  const s = await sessionSummary(file);
  assert.equal(msgs.at(-1).text, 'respuesta nueva');
  assert.equal(s.claudeMsgs, 1801);
  assert.ok(performance.now() - t0 < 2000); // holgado: lo que importa es lo de arriba
  await sameAsFull(file);
});
