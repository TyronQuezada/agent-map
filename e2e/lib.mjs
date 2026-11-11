// Utilidades de las pruebas E2E: abren Agent Map de verdad (Electron) con datos de prueba aislados y lo controlan
// por el protocolo de DevTools (CDP) con el WebSocket de Node. Sin dependencias.
// AGENT_MAP_EXE=ruta\al\Agent Map.exe prueba la app empaquetada en vez del código fuente.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const APP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const EXE = process.env.AGENT_MAP_EXE || path.join(APP, 'node_modules', 'electron', 'dist', process.platform === 'win32' ? 'electron.exe' : 'electron');
const EXE_ARGS = process.env.AGENT_MAP_EXE ? [] : [APP];
export const packaged = !!process.env.AGENT_MAP_EXE;
export const sleep = ms => new Promise(r => setTimeout(r, ms));

/** Carpeta temporal propia de una prueba; se borra al final. */
export function tempRoot(name) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `agentmap-e2e-${name}-`));
  return { root, cleanup: () => fs.rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }) };
}

const L = r => JSON.stringify(r) + '\n';
export const userLine = (text, cwd) => L({ type: 'user', timestamp: new Date().toISOString(), cwd, message: { role: 'user', content: text } });
export const assistantLine = (text, id) => L({ type: 'assistant', timestamp: new Date().toISOString(), message: { id, role: 'assistant', content: [{ type: 'text', text }] } });

/** ~/.claude falso con tres proyectos y una sesión en cada uno. */
export function makeFixture(root) {
  const claude = path.join(root, 'claude');
  const mk = (project, id, title) => {
    const cwd = 'D:\\Proyectos\\' + project;
    const dir = path.join(claude, 'projects', 'D--Proyectos-' + project);
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, id + '.jsonl');
    fs.writeFileSync(file, userLine('Primer pedido de prueba', cwd) + L({ type: 'ai-title', aiTitle: title }) + assistantLine('Listo, primera respuesta.', 'msg_' + id.slice(0, 8)));
    return { id, file, cwd, dir };
  };
  fs.mkdirSync(path.join(claude, 'sessions'), { recursive: true });
  fs.writeFileSync(path.join(claude, '.claude.json'), '{}');
  return {
    claude,
    blog: mk('blog-personal', '853513a1-f357-4bc7-a053-c4faceed451b', 'Migrar el blog a Markdown'),
    juego: mk('juego-plataformas', 'a15af667-5585-4ab5-a787-be363e598375', 'Salto con coyote time'),
    tienda: mk('tienda-web', 'c0e53ad7-17d8-4b45-975b-976848169009', 'Carrito de compras'),
  };
}

/** WAV corto y válido (tono), generado aquí: no depende de archivos de audio de terceros. */
export function makeWav(file, freq = 660) {
  const rate = 8000, n = Math.round(rate * 0.12), data = Buffer.alloc(n * 2);
  for (let i = 0; i < n; i++) data.writeInt16LE(Math.round(Math.sin(2 * Math.PI * freq * i / rate) * 6000), i * 2);
  const h = Buffer.alloc(44);
  h.write('RIFF', 0); h.writeUInt32LE(36 + data.length, 4); h.write('WAVE', 8); h.write('fmt ', 12);
  h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22); h.writeUInt32LE(rate, 24);
  h.writeUInt32LE(rate * 2, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34); h.write('data', 36); h.writeUInt32LE(data.length, 40);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, Buffer.concat([h, data]));
}

let nextDbg = 9500 + Math.floor(Math.random() * 300);
/**
 * Abre Agent Map. Devuelve { ev(expr), port, url, dbg, targets(), close(), exited } o { exited } si salió solo
 * (por ejemplo, una segunda instancia con el mismo perfil).
 */
export async function launch({ profile, env, waitReady = true }) {
  const dbg = nextDbg++;
  const proc = spawn(EXE, [...EXE_ARGS, `--user-data-dir=${profile}`, `--remote-debugging-port=${dbg}`], { env: { ...process.env, ...env }, stdio: 'ignore' });
  let exited = null;
  proc.on('exit', c => { exited = c; });
  const targets = async () => { try { return await (await fetch(`http://127.0.0.1:${dbg}/json`)).json(); } catch { return null; } };
  let page;
  for (let i = 0; i < 200 && !page; i++) {
    if (exited !== null) return { exited, get proc() { return proc; } };
    page = (await targets())?.find(x => x.type === 'page' && /^http:\/\/127\.0\.0\.1:\d+\/$/.test(x.url));
    if (!page) await sleep(150);
  }
  if (!page) { proc.kill(); throw new Error('Agent Map no abrió su ventana'); }
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  let id = 0; const pend = new Map();
  ws.onmessage = m => { const d = JSON.parse(m.data); pend.get(d.id)?.(d); pend.delete(d.id); };
  // Si la app se cierra antes de responder (p. ej. al confirmar el cierre), nada queda esperando para siempre.
  ws.onclose = () => { for (const done of pend.values()) done({ closed: true }); pend.clear(); };
  const send = async (method, params) => {
    const i = ++id;
    if (ws.readyState !== 1) throw new Error('la ventana ya no está conectada');
    ws.send(JSON.stringify({ id: i, method, params }));
    const d = await new Promise(r => {
      const timer = setTimeout(() => { pend.delete(i); r({ timeout: true }); }, 30000);
      pend.set(i, x => { clearTimeout(timer); r(x); });
    });
    if (d.closed || d.timeout) throw new Error(d.closed ? 'la ventana se cerró' : 'sin respuesta de la página en 30 s');
    return d;
  };
  // La página se comporta como visible y enfocada aunque la ventana esté minimizada o tapada. Si no, Chromium la
  // marca "hidden", deja de pintar y demora eventos como el 'close' del <dialog>: el resultado dependería de la pantalla.
  await send('Emulation.setFocusEmulationEnabled', { enabled: true });
  const ev = async expr => {
    const d = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true, userGesture: true });
    if (d.result?.exceptionDetails) throw new Error(JSON.stringify(d.result.exceptionDetails).slice(0, 500));
    return d.result?.result?.value;
  };
  if (waitReady) {
    for (let i = 0; i < 150; i++) {
      if (await ev(`typeof state !== 'undefined' && typeof loadSeq === 'number' && loadSeq > 0 && document.readyState === 'complete' && !!document.querySelector('#tree [data-tree-section]')`).catch(() => false)) break;
      await sleep(100);
    }
    await sleep(300);
  }
  const close = async () => {
    await ev('window.desktop.confirmClose(), true').catch(() => {});
    for (let i = 0; i < 100 && exited === null; i++) await sleep(100);
    if (exited === null) proc.kill();
    ws.close();
    return exited;
  };
  return { ev, dbg, targets, close, pid: proc.pid, url: page.url, port: Number(new URL(page.url).port), get exited() { return exited; } };
}

/** Registro de resultados: check(nombre, ok, detalle); finish() imprime el total y devuelve el código de salida. */
export function reporter(title) {
  const results = [];
  console.log(`\n== ${title}${packaged ? ' (app empaquetada)' : ''} ==`);
  return {
    check(name, ok, info = '') { results.push(!!ok); console.log(`${ok ? 'OK  ' : 'FAIL'} ${name}${info ? ' — ' + info : ''}`); },
    fail(err) { results.push(false); console.log('ERROR', err?.stack || err); },
    finish() { const ok = results.filter(Boolean).length; console.log(`${ok}/${results.length} OK`); return results.length && results.every(Boolean) ? 0 : 1; },
  };
}
