import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseSession } from '../lib/scan.js';

test('parseSession resume prompts, título, tokens sin duplicar, herramientas y agentes', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentmap-'));
  const file = path.join(dir, '11111111-2222-3333-4444-555555555555.jsonl');
  const usage = { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 100, cache_creation_input_tokens: 20 };
  const lines = [
    { type: 'custom-title', customTitle: 'Mi sesión' },
    { type: 'user', timestamp: '2026-01-01T10:00:00Z', cwd: 'D:\\x', message: { role: 'user', content: 'hola mundo' } },
    { type: 'user', isMeta: true, message: { content: 'meta oculto' } },
    { type: 'user', message: { content: '<command-name>/clear</command-name>' } },
    // mismo id partido en dos líneas: el usage debe contarse una sola vez
    { type: 'assistant', timestamp: '2026-01-01T10:01:00Z', message: { id: 'm1', model: 'claude-x', usage, content: [{ type: 'text', text: 'ok' }] } },
    { type: 'assistant', message: { id: 'm1', model: 'claude-x', usage, content: [
      { type: 'tool_use', name: 'Bash', input: {} },
      { type: 'tool_use', name: 'Agent', input: { subagent_type: 'Explore' } },
      { type: 'tool_use', name: 'mcp__rea__open_binary', input: {} },
    ] } },
    { type: 'user', message: { content: [{ type: 'tool_result', content: 'salida' }] } },
    { type: 'user', timestamp: '2026-01-01T11:00:00Z', message: { content: [{ type: 'text', text: 'segundo prompt' }] } },
  ];
  fs.writeFileSync(file, lines.map(l => JSON.stringify(l)).join('\n') + '\n{roto');

  const s = await parseSession(file);
  assert.equal(s.title, 'Mi sesión');
  assert.equal(s.cwd, 'D:\\x');
  assert.equal(s.prompts, 2);
  assert.equal(s.firstPrompt, 'hola mundo');
  assert.equal(s.lastPrompt, 'segundo prompt');
  assert.equal(s.assistantMsgs, 1);
  assert.deepEqual(s.tokens, { input: 10, output: 5, cacheRead: 100, cacheWrite: 20 });
  assert.deepEqual(s.tools, { Bash: 1, Agent: 1, 'MCP: rea': 1 });
  assert.deepEqual(s.agentCalls, { Explore: 1 });
  assert.equal(s.start, '2026-01-01T10:00:00Z');
  assert.equal(s.end, '2026-01-01T11:00:00Z');
  fs.rmSync(dir, { recursive: true });
});

test('readable quita recordatorios del sistema y marcas de pegado; readMessages da la conversación completa', async () => {
  const { readable, readMessages } = await import('../lib/scan.js');
  assert.equal(readable('hola<system-reminder>\nsecreto\n</system-reminder>\n\n\n\nchao'), 'hola\n\nchao');
  assert.equal(readable('<pasted_content id="x">texto</pasted_content> ok'), 'texto ok');

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentmap-'));
  const file = path.join(dir, '11111111-2222-3333-4444-555555555555.jsonl');
  const largo = 'línea uno\nlínea dos ' + 'x'.repeat(400);
  const lines = [
    { type: 'user', timestamp: 't1', message: { content: largo + '<system-reminder>r</system-reminder>' } },
    { type: 'assistant', timestamp: 't2', message: { id: 'a1', content: [{ type: 'thinking', thinking: 'oculto' }, { type: 'text', text: 'parte 1' }] } },
    { type: 'assistant', message: { id: 'a1', content: [{ type: 'tool_use', name: 'Bash', input: {} }] } },
    { type: 'assistant', message: { id: 'a1', content: [{ type: 'text', text: 'parte 2' }] } },
    { type: 'user', message: { content: [{ type: 'tool_result', content: 'salida' }] } },
    { type: 'user', isSidechain: true, message: { content: 'de un subagente' } },
    { type: 'assistant', message: { id: 'a2', content: [{ type: 'text', text: 'listo' }] } },
  ];
  fs.writeFileSync(file, lines.map(l => JSON.stringify(l)).join('\n') + '\n');
  const s = await parseSession(file);
  assert.ok(s.firstPrompt.length < largo.length && s.firstPrompt.endsWith('…'));
  assert.deepEqual(await readMessages(file), [
    { role: 'user', text: largo, ts: 't1' },
    { role: 'assistant', text: 'parte 1\n\nparte 2', ts: 't2' },
    { role: 'assistant', text: 'listo', ts: null },
  ]);
  fs.rmSync(dir, { recursive: true });
});

test('folders: lista solo carpetas, valida nombres y crea carpetas nuevas', async () => {
  const { listDirs, makeDir, isDir } = await import('../lib/folders.js');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentmap-'));
  fs.mkdirSync(path.join(dir, 'b'));
  fs.mkdirSync(path.join(dir, '.oculta'));
  fs.writeFileSync(path.join(dir, 'archivo.txt'), 'x');

  const l = await listDirs(dir);
  assert.deepEqual(l.dirs, [path.join(dir, 'b')]);
  assert.equal(l.parent, path.dirname(dir));
  await assert.rejects(listDirs('relativa'), /absoluta/);
  assert.ok((await listDirs('')).dirs.length > 0);

  assert.equal(await makeDir(dir, 'nuevo'), path.join(dir, 'nuevo'));
  assert.ok(isDir(path.join(dir, 'nuevo')));
  for (const bad of ['', '..', 'a/b', 'a\b', 'x:y', 'fin.']) await assert.rejects(makeDir(dir, bad), /no válido/);
  await assert.rejects(makeDir(dir, 'nuevo'), { code: 'EEXIST' });
  assert.equal(isDir('relativa'), false);
  fs.rmSync(dir, { recursive: true });
});

test('plan y límites: nombre del plan y solo las ventanas de uso válidas', async () => {
  const { planName } = await import('../lib/scan.js');
  const { pickLimits } = await import('../statusline-tap.js');
  assert.deepEqual(planName({ organizationType: 'claude_pro', hasExtraUsageEnabled: false }), { name: 'Pro', extraUsage: false });
  assert.equal(planName({ organizationType: 'claude_max', organizationRateLimitTier: 'default_claude_max_20x' }).name, 'Max 20x');
  assert.equal(planName({}), null);

  const rl = { five_hour: { used_percentage: 23.5, resets_at: 1738425600 }, seven_day: { used_percentage: 41.2, resets_at: 1738857600 } };
  assert.deepEqual(pickLimits({ session_id: 'x', cwd: 'D:\secreto', rate_limits: rl }), rl);
  assert.deepEqual(pickLimits({ rate_limits: { seven_day: rl.seven_day } }), { five_hour: undefined, seven_day: rl.seven_day });
  assert.equal(pickLimits({ rate_limits: { five_hour: { used_percentage: 'x' } } }), null);
  assert.equal(pickLimits({}), null);
});

test('servidor: puerto al azar, rechaza Host ajeno y sirve plan/uso', async () => {
  const { startServer } = await import('../server.js');
  const port = await startServer(0);
  assert.ok(port > 0);
  const base = `http://127.0.0.1:${port}`;
  const ok = await fetch(base + '/api/usage');
  assert.equal(ok.status, 200);
  assert.ok('plan' in await ok.json());
  const http = await import('node:http');
  const status = await new Promise(resolve => http.get({ host: '127.0.0.1', port, path: '/api/tree', headers: { host: 'evil.com' } }, r => resolve(r.statusCode)));
  assert.equal(status, 403);
  const mk = await fetch(base + '/api/mkdir', { method: 'POST', headers: { origin: 'http://evil.com' }, body: '{}' });
  assert.equal(mk.status, 403);
});
