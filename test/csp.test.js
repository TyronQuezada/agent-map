// Content Security Policy de public/index.html y public/office.html: la política exacta, que no haya código en línea
// que la obligue a aflojarse, y que cada recurso que piden las páginas lo sirva el propio servidor.
//
// Por qué cada directiva:
// - default-src 'none': todo lo no nombrado queda bloqueado (fuentes, frames, workers, objetos, manifest).
// - script-src 'self': solo archivos de /public y /vendor; sin scripts en línea ni eval (el tema inicial va en theme-init.js).
// - style-src: 'self' en la oficina. En la principal además 'unsafe-inline', imprescindible: xterm 6 (renderer DOM)
//   crea elementos <style> y escribe atributos style con los colores y medidas de la terminal, y no acepta nonce.
//   Solo afecta CSS: los scripts siguen sin poder correr en línea.
// - img-src 'self' (icono y guía), media-src 'self' (sonidos de /sounds/, solo en la principal),
//   connect-src 'self' (fetch, /api/events y el WebSocket /pty del mismo host y puerto).
// - base-uri 'none' y form-action 'none': nadie puede cambiar la base de las URLs ni enviar formularios a otro lado
//   (los formularios de la app son method="dialog" o se manejan con JavaScript).
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentmap-csp-'));
after(() => fs.rmSync(dir, { recursive: true, force: true }));
process.env.CLAUDE_CONFIG_DIR = path.join(dir, 'claude');
process.env.AGENT_MAP_USAGE_FILE = path.join(dir, 'am', 'usage.json');
const { startServer } = await import('../server.js');

const PUBLIC = new URL('../public/', import.meta.url);
const read = f => fs.readFileSync(new URL(f, PUBLIC), 'utf8');
const EXPECTED = {
  'index.html': { 'default-src': ["'none'"], 'script-src': ["'self'"], 'style-src': ["'self'", "'unsafe-inline'"], 'img-src': ["'self'"],
    'media-src': ["'self'"], 'connect-src': ["'self'"], 'base-uri': ["'none'"], 'form-action': ["'none'"] },
  'office.html': { 'default-src': ["'none'"], 'script-src': ["'self'"], 'style-src': ["'self'"], 'img-src': ["'self'"],
    'connect-src': ["'self'"], 'base-uri': ["'none'"], 'form-action': ["'none'"] },
};
const policyOf = html => {
  const m = html.match(/<meta http-equiv="Content-Security-Policy" content="([^"]+)">/);
  return m && Object.fromEntries(m[1].split(';').map(d => d.trim().split(/\s+/)).filter(d => d[0]).map(([k, ...v]) => [k, v]));
};

for (const page of Object.keys(EXPECTED)) {
  const html = read(page);

  test(`${page}: política exacta, antes de cualquier recurso`, () => {
    assert.deepEqual(policyOf(html), EXPECTED[page]);
    const head = html.slice(0, html.indexOf('</head>'));
    const metaAt = head.indexOf('http-equiv="Content-Security-Policy"');
    for (const tag of ['<script', '<link', '<style']) if (head.includes(tag)) assert.ok(metaAt < head.indexOf(tag), `la meta va antes de ${tag}`);
    assert.ok(!/unsafe-eval|unsafe-hashes|\*|https?:|data:|blob:/.test(JSON.stringify(policyOf(html))), 'sin comodines, otros orígenes ni eval');
  });

  test(`${page}: sin código en línea (scripts, estilos ni manejadores)`, () => {
    for (const tag of html.match(/<script\b[^>]*>/g)) assert.match(tag, /^<script src="\/[^"]+"><\/script>$|^<script src="\/[^"]+">$/, tag);
    assert.equal((html.match(/<script\b[^>]*>([\s\S]*?)<\/script>/g) || []).filter(s => !/^<script src="[^"]+"><\/script>$/.test(s)).length, 0);
    assert.ok(!/<style\b/i.test(html), '<style>');
    assert.ok(!/\sstyle="/i.test(html), 'atributo style');
    assert.ok(!/\son[a-z]+\s*=/i.test(html), 'manejador en línea (onclick=…)');
    assert.ok(!/javascript:/i.test(html), 'javascript:');
  });
}

test('scripts propios: sin eval ni código desde texto (script-src no tiene unsafe-eval)', () => {
  for (const f of fs.readdirSync(PUBLIC).filter(f => f.endsWith('.js'))) {
    const src = read(f);
    assert.ok(!/\beval\s*\(|new Function\s*\(|set(Timeout|Interval)\s*\(\s*['"`]/.test(src), f);
    assert.ok(!/\son[a-z]+=\\?["']/.test(src), `${f}: manejador en línea dentro de HTML generado`);
  }
});

test('oficina: sus scripts no usan estilos en línea (su style-src es solo \'self\')', () => {
  for (const f of ['office.js', 'office-page.js', 'theme-init.js']) {
    const src = read(f);
    assert.ok(!/style="|setAttribute\(\s*['"]style|createElement\(\s*['"]style|insertRule|<style/.test(src), f); // el.style.x = … (CSSOM) sí está permitido
  }
});

test('cada script, hoja de estilo e icono que piden las páginas lo sirve el propio servidor', async () => {
  const port = await startServer(0);
  for (const page of Object.keys(EXPECTED)) {
    const urls = [...read(page).matchAll(/<(?:script|link)\b[^>]*?(?:src|href)="([^"]+)"/g)].map(m => m[1]);
    assert.ok(urls.length >= 3, page);
    for (const u of urls) {
      assert.match(u, /^\/[^/]/, `${page}: ${u} es del mismo origen`);
      const r = await fetch(`http://127.0.0.1:${port}${u}`);
      assert.equal(r.status, 200, `${page}: ${u}`);
      await r.arrayBuffer();
    }
  }
  const r = await fetch(`http://127.0.0.1:${port}/theme-init.js`);
  assert.match(r.headers.get('content-type'), /javascript/);
  assert.match(await r.text(), /dataset\.theme/);
});
