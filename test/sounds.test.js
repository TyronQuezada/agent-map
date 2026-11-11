// Sonidos: preferencias persistentes (lib/prefs.js), ruta local /sounds/ (server.js) y reproductor (public/sounds.js).
// Carpeta temporal propia: AGENT_MAP_USAGE_FILE se fija ANTES de importar (cada archivo de test corre en su proceso).
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentmap-sounds-'));
after(() => fs.rmSync(dir, { recursive: true, force: true }));
process.env.AGENT_MAP_USAGE_FILE = path.join(dir, 'usage.json');
process.env.CLAUDE_CONFIG_DIR = path.join(dir, 'claude');
const { readPrefs, updatePrefs, PREFS_FILE, SOUND_FILES } = await import('../lib/prefs.js');
const { startServer } = await import('../server.js');

const ctx = {};
vm.runInNewContext(fs.readFileSync(new URL('../public/sounds.js', import.meta.url), 'utf8'), ctx);
const { pickSound, createPlayer, FILES, KINDS } = ctx.AgentMapSounds;

test('prefs: sonidos por defecto según la tabla propuesta', () => {
  const s = readPrefs().sounds;
  assert.deepEqual(JSON.parse(JSON.stringify(s)), { volume: 0.7, message: { on: true, file: 'messenger-tono-mensaje.mp3' },
    finished: { on: true, file: 'msn-online.mp3' }, toast: { on: true, file: 'nudge-nudge-msn.mp3' } });
  assert.deepEqual([...FILES], SOUND_FILES); // la página y el servidor ofrecen los mismos archivos
  assert.deepEqual([...KINDS], ['message', 'finished', 'toast']);
});

test('prefs: cambios parciales se guardan en disco y persisten; lo inválido se rechaza sin guardar', () => {
  updatePrefs({ sounds: { volume: 0.35, message: { file: 'msn-alert.mp3' } } });
  updatePrefs({ sounds: { finished: { on: false } } });
  const disk = JSON.parse(fs.readFileSync(PREFS_FILE, 'utf8')).sounds; // lo que sobrevive a un reinicio
  assert.equal(disk.volume, 0.35);
  assert.deepEqual(disk.message, { on: true, file: 'msn-alert.mp3' });
  assert.deepEqual(disk.finished, { on: false, file: 'msn-online.mp3' });
  assert.throws(() => updatePrefs({ sounds: { volume: 2 } }), /Volumen/);
  assert.throws(() => updatePrefs({ sounds: { volume: NaN } }), /Volumen/);
  for (const bad of ['../../secreto.mp3', 'C:\\x.mp3', 'sub/x.mp3', 'CON.mp3', '.oculto.mp3', 'x.exe', 'a'.repeat(90) + '.mp3', 42]) {
    assert.throws(() => updatePrefs({ sounds: { toast: { file: bad } } }), /inválido/, String(bad));
  }
  updatePrefs({ sounds: { toast: { file: 'Mi Sonido (1).wav' } } }); // sonidos propios: cualquier nombre simple de audio
  assert.equal(readPrefs().sounds.toast.file, 'Mi Sonido (1).wav');
  updatePrefs({ sounds: { toast: { file: 'nudge-nudge-msn.mp3' } } });
  assert.throws(() => updatePrefs({ sounds: { toast: { on: 'si' } } }), /activar/);
  assert.throws(() => updatePrefs({ sounds: null }), /sonidos/);
  assert.equal(readPrefs().sounds.volume, 0.35);
  assert.equal(readPrefs().sounds.toast.file, 'nudge-nudge-msn.mp3');
});

test('prefs: un archivo editado a mano o de una versión vieja vuelve a valores válidos', () => {
  fs.writeFileSync(PREFS_FILE, JSON.stringify({ theme: 'noche', sounds: { volume: 7, message: { on: 'x', file: '../otro.mp3' }, toast: { on: false } } }));
  const s = readPrefs().sounds;
  assert.equal(s.volume, 0.7);
  assert.deepEqual(s.message, { on: true, file: 'messenger-tono-mensaje.mp3' });
  assert.deepEqual(s.toast, { on: false, file: 'nudge-nudge-msn.mp3' });
  fs.writeFileSync(PREFS_FILE, JSON.stringify({ theme: 'xp' })); // sin sounds (versión anterior)
  assert.equal(readPrefs().sounds.finished.file, 'msn-online.mp3');
});

test('servidor: /sounds/ sirve solo audios de las carpetas autorizadas; /api/sounds los lista', async () => {
  const mine = path.join(dir, 'sounds');
  fs.mkdirSync(path.join(mine, 'sub'), { recursive: true });
  fs.writeFileSync(path.join(mine, 'prueba-test.mp3'), Buffer.from([0xff, 0xfb, 1, 2, 3]));
  fs.writeFileSync(path.join(mine, 'Mi Sonido (1).wav'), Buffer.from('RIFF'));
  fs.writeFileSync(path.join(mine, 'sub', 'escondido.mp3'), 'x');
  fs.writeFileSync(path.join(mine, 'notas.txt'), 'x');
  fs.writeFileSync(path.join(dir, 'fuera.mp3'), 'x'); // fuera de la carpeta de sonidos
  const port = await startServer(0);
  const base = `http://127.0.0.1:${port}`;
  const ok = await fetch(base + '/sounds/prueba-test.mp3');
  assert.equal(ok.status, 200);
  assert.equal(ok.headers.get('content-type'), 'audio/mpeg');
  assert.deepEqual([...new Uint8Array(await ok.arrayBuffer())], [0xff, 0xfb, 1, 2, 3]);
  const wav = await fetch(base + '/sounds/' + encodeURIComponent('Mi Sonido (1).wav'));
  assert.equal(wav.status, 200);
  assert.equal(wav.headers.get('content-type'), 'audio/wav');
  for (const p of ['/sounds/no-existe.mp3', '/sounds/..%2Ffuera.mp3', '/sounds/%2e%2e%5cfuera.mp3', '/sounds/..%5C..%5Cfuera.mp3',
    '/sounds/sub%2Fescondido.mp3', '/sounds/sub/escondido.mp3', '/sounds/notas.txt', '/sounds/CON.mp3', '/sounds/%E0%A4%A.mp3',
    '/sounds/PRUEBA.MP3', '/sounds/x.wav', '/sounds/']) {
    assert.equal((await fetch(base + p)).status, 404, p);
  }
  const list = await (await fetch(base + '/api/sounds')).json();
  assert.equal(list.dir, mine);
  const own = list.files.filter(f => f.mine).map(f => f.name);
  assert.deepEqual(own, ['Mi Sonido (1).wav', 'prueba-test.mp3']); // sin subcarpetas, .txt ni archivos de afuera
  const http = await import('node:http');
  const status = await new Promise(r => http.get({ host: '127.0.0.1', port, path: '/sounds/prueba-test.mp3', headers: { host: 'evil.com' } }, res => r(res.statusCode)));
  assert.equal(status, 403); // misma protección de Host que el resto
});

const cfg = (over = {}) => ({ volume: 0.5, message: { on: true, file: 'msn-alert.mp3' }, finished: { on: true, file: 'msn-online.mp3' },
  toast: { on: true, file: 'nudge-nudge-msn.mp3' }, ...over });
function fakeAudio(behavior = () => Promise.resolve()) {
  const made = [];
  const makeAudio = src => {
    const a = { src, plays: 0, volume: 1, currentTime: 9, play() { this.plays++; return behavior(this); } };
    made.push(a);
    return a;
  };
  return { made, makeAudio };
}
const rejectWith = name => () => Promise.reject(Object.assign(new Error(name), { name }));

test('reproductor: suena el archivo elegido con el volumen elegido, desde el principio', async () => {
  const f = fakeAudio();
  const p = createPlayer({ makeAudio: f.makeAudio });
  assert.equal(await p.play('message', cfg()), 'played');
  assert.equal(f.made[0].src, '/sounds/msn-alert.mp3');
  assert.equal(f.made[0].volume, 0.5);
  assert.equal(f.made[0].currentTime, 0);
});

test('reproductor: un elemento por archivo, reutilizado (no uno nuevo por cada carga)', async () => {
  const f = fakeAudio();
  const p = createPlayer({ makeAudio: f.makeAudio });
  for (let i = 0; i < 20; i++) await p.play('finished', cfg());
  await p.play('toast', cfg());
  assert.equal(f.made.length, 2);
  assert.equal(f.made[0].plays, 20);
  assert.equal(p.size(), 2);
});

test('reproductor: desactivado o volumen 0 no reproduce; probar suena aunque esté desactivado', async () => {
  const f = fakeAudio();
  const p = createPlayer({ makeAudio: f.makeAudio });
  const off = cfg({ finished: { on: false, file: 'msn-online.mp3' } });
  assert.equal(await p.play('finished', off), 'off');
  assert.equal(await p.play('message', cfg({ volume: 0 })), 'muted');
  assert.equal(f.made.length, 0);
  assert.equal(await p.play('finished', off, true), 'played');
});

test('reproductor: fallos de reproducción no lanzan; autoplay bloqueado se distingue', async () => {
  assert.equal(await createPlayer({ makeAudio: fakeAudio(rejectWith('NotAllowedError')).makeAudio }).play('message', cfg()), 'blocked');
  assert.equal(await createPlayer({ makeAudio: fakeAudio(rejectWith('NotSupportedError')).makeAudio }).play('message', cfg()), 'error');
  assert.equal(await createPlayer({ makeAudio: () => { throw new Error('sin Audio'); } }).play('message', cfg()), 'error');
  const p = createPlayer({ makeAudio: fakeAudio().makeAudio });
  assert.equal(await p.play('message', undefined), 'error'); // preferencias aún sin cargar
  assert.equal(await p.play('otro', cfg()), 'error');
  assert.equal(await p.play('message', cfg({ message: { on: true, file: '../x.mp3' } })), 'error'); // fuera de la lista
});

test('reproductor: sonidos propios con espacios se piden codificados; mismo criterio de nombres que el servidor', async () => {
  const f = fakeAudio();
  assert.equal(await createPlayer({ makeAudio: f.makeAudio }).play('toast', cfg({ toast: { on: true, file: 'Mi Sonido (1).wav' } })), 'played');
  assert.equal(f.made[0].src, '/sounds/Mi%20Sonido%20(1).wav');
  const { isSoundName: serverName } = await import('../lib/prefs.js');
  for (const n of ['a.mp3', 'Mi Sonido (1).wav', 'x.OGG', '../a.mp3', 'a/b.mp3', 'CON.mp3', 'lpt1.wav', '.a.mp3', 'a.exe', '', null]) {
    assert.equal(ctx.AgentMapSounds.isSoundName(n), serverName(n), String(n));
  }
});

test('pickSound: un solo sonido por grupo; terminar gana a mensaje; el resto usa el general', () => {
  const t = (...types) => types.map(type => ({ type }));
  assert.equal(pickSound(t('message', 'finished')), 'finished');
  assert.equal(pickSound(t('message', 'message')), 'message');
  assert.equal(pickSound(t('waiting')), 'toast');
  assert.equal(pickSound(t('session-new', 'session-closed')), 'toast');
  assert.equal(pickSound(t('message', 'session-new')), 'message');
  assert.equal(pickSound([]), null);
  assert.equal(pickSound(undefined), null);
});
