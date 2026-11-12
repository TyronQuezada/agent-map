// E2E: hook oficial de Claude Code. La app copia agentmap-hook a ~/.agent-map; se instala en UN proyecto solo desde su
// ventana (con vista previa); los eventos que Claude Code le pasaría por stdin se simulan ejecutando ese mismo hook.
// Comprueba avisos en vivo, actividad por herramienta, reinicio, desinstalación y que nada de Claude cambie sin pedirlo.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { launch, makeFixture, reporter, sleep, tempRoot, userLine, assistantLine } from './lib.mjs';

const { root, cleanup } = tempRoot('hook');
const fx = makeFixture(root);
const am = path.join(root, 'agent-map');
const proj = path.join(root, 'mi-proyecto');           // carpeta real del proyecto (el hook solo se instala en carpetas que existen)
fs.mkdirSync(proj);
const S = '7e57ab1e-0000-4000-8000-00000000c0de';
const sdir = path.join(fx.claude, 'projects', 'mi-proyecto');
fs.mkdirSync(sdir, { recursive: true });
fs.writeFileSync(path.join(sdir, S + '.jsonl'), userLine('Primer pedido', proj) + JSON.stringify({ type: 'ai-title', aiTitle: 'Sesión con hook' }) + '\n' + assistantLine('Hola', 'msg_hook_1'));
const env = { CLAUDE_CONFIG_DIR: fx.claude, AGENT_MAP_USAGE_FILE: path.join(am, 'usage.json') };
const HOOK = path.join(am, 'agentmap-hook.mjs');
const SETTINGS = path.join(proj, '.claude', 'settings.local.json');
const r = reporter('Hook oficial de Claude Code');

const snap = d => fs.readdirSync(d, { recursive: true }).sort().map(f => { const p = path.join(d, f); const st = fs.statSync(p); return st.isFile() ? `${f}:${st.size}:${st.mtimeMs}` : f; }).join('|');
/** Lo que haría Claude Code: ejecutar el comando del hook con el evento en JSON por stdin. */
const claudeEvent = (event, extra = {}) => {
  const out = spawnSync(process.execPath, [HOOK], { input: JSON.stringify({ session_id: S, transcript_path: path.join(sdir, S + '.jsonl'), cwd: proj, permission_mode: 'default', hook_event_name: event, ...extra }), windowsHide: true });
  return out.status === 0 && out.stdout.length === 0;
};

let a;
try {
  const names = d => fs.readdirSync(d, { recursive: true }).sort().join('|');
  const claude0 = snap(fx.claude), proj0 = snap(proj), claude0names = names(fx.claude);
  a = await launch({ profile: path.join(root, 'perfil'), env });
  const TOASTS = `JSON.stringify([...document.querySelectorAll('#toasts .toast:not(.out)')].map(t => t.dataset.toastKey))`;
  const waitToast = async (key, ms = 5000) => { for (const end = Date.now() + ms; Date.now() < end; await sleep(100)) if (JSON.parse(await a.ev(TOASTS)).includes(key)) return true; return false; };
  const clear = () => a.ev(`(async () => { for (let i = 0; i < 3; i++) { for (const b of document.querySelectorAll('#toasts .toast-close')) b.click(); await new Promise(r => setTimeout(r, 450)); } return true; })()`);
  const closeModal = () => a.ev(`new Promise(r => { const m = document.querySelector('#modal'); if (!m.open) return r(true);
    m.addEventListener('close', () => setTimeout(() => r(true), 0), { once: true }); m.close(); setTimeout(() => r(false), 5000); })`);
  const openHookModal = async () => {
    const res = await a.ev(`(() => { const el = [...document.querySelectorAll('#tree [data-act="toggle-project"]')].find(n => n.dataset.cwd === ${JSON.stringify(proj)});
      if (!el) return 'sin proyecto'; el.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 60, clientY: 60 }));
      const b = document.querySelector('.ctxmenu [data-ctx="hook"]'); if (!b) return 'sin opción'; b.click(); return 'ok'; })()`);
    for (let i = 0; i < 30 && !(await a.ev(`!!document.querySelector('#modalBody [data-close-modal]')`)); i++) await sleep(100);
    return res;
  };
  await a.ev('toasts.setDuration(60000), true');
  await a.ev('load()');

  r.check('al abrir, la app copia agentmap-hook a ~/.agent-map (su carpeta propia)', fs.existsSync(HOOK));
  await a.ev('showOptions(), true');
  let diag = '';
  for (let i = 0; i < 30 && !/evento/.test(diag); i++) { await sleep(100); diag = await a.ev(`document.querySelector('#optHook')?.textContent || ''`); }
  await closeModal();
  r.check('⚙ Opciones: diagnóstico del hook (script listo, node, sin eventos todavía)', /Script listo/.test(diag) && /Todavía no llegó ningún evento/.test(diag), diag.replace(/\s+/g, ' ').slice(0, 160));

  // Ventana del proyecto: estado y vista previa, sin escribir nada
  const m1 = await openHookModal();
  const view = await a.ev(`JSON.stringify({ text: document.querySelector('#modalBody').textContent, pre: document.querySelector('.hook-preview')?.textContent || '' })`).then(JSON.parse);
  await closeModal();
  r.check('ventana del hook: explica qué cambia y muestra el archivo como quedaría', m1 === 'ok' && /No instalado/.test(view.text) && view.text.includes(SETTINGS)
    && /agentmap-hook\.mjs/.test(view.pre) && /"async": true/.test(view.pre) && /Nunca tus prompts/.test(view.text), m1);
  r.check('sin pedirlo no se escribe nada (proyecto ni carpeta de Claude)', snap(proj) === proj0 && snap(fx.claude) === claude0);

  // Instalar explícitamente
  await openHookModal();
  await a.ev(`document.querySelector('#modalBody [data-hook="install"]').click(), true`);
  let installed = '';
  for (let i = 0; i < 30 && !/Instalado en este proyecto/.test(installed); i++) { await sleep(100); installed = await a.ev(`document.querySelector('#modalBody').textContent`); }
  await closeModal();
  const cfg = fs.existsSync(SETTINGS) ? JSON.parse(fs.readFileSync(SETTINGS, 'utf8')) : {};
  r.check('instalar: .claude/settings.local.json con los 12 eventos, en segundo plano', /Instalado en este proyecto/.test(installed)
    && Object.keys(cfg.hooks || {}).length === 12 && Object.values(cfg.hooks).every(g => g[0].hooks[0].async === true && g[0].hooks[0].command.includes('agentmap-hook.mjs')));

  // Eventos de Claude: en vivo, sin llamar a load()
  r.check('el hook responde como espera Claude Code (código 0, sin salida)', claudeEvent('SessionStart', { source: 'startup' }) && claudeEvent('UserPromptSubmit', { prompt: 'PRIVADO no guardar' }));
  claudeEvent('PreToolUse', { tool_name: 'Bash', tool_use_id: 'b1', tool_input: { command: 'echo PRIVADO' } });
  let busy = false;
  for (let i = 0; i < 40 && !busy; i++) { await sleep(100); busy = await a.ev(`document.querySelector('#tree [data-act="session"][data-id="${S}"] .dot')?.classList.contains('busy') || false`); }
  r.check('en vivo: la sesión pasa a "trabajando" con el evento del hook', busy);
  await a.ev(`selectSession = (orig => id => { state.selected = id; renderAll(); })(selectSession), true`); // sin abrir una terminal real
  await a.ev(`selectSession(${JSON.stringify(S)}), true`);
  let act = ''; // la recarga en vivo por la herramienta en uso llega en ~1 s
  for (let i = 0; i < 40 && !/usando Bash/.test(act); i++) { await sleep(100); act = await a.ev(`[...document.querySelectorAll('#stats .group')].find(g => /Actividad/.test(g.textContent))?.textContent.replace(/\\s+/g, ' ') || ''`); }
  r.check('panel: actividad por herramienta (usando Bash)', /usando Bash/.test(act), act.slice(0, 160));
  claudeEvent('PermissionRequest', { tool_name: 'Bash', tool_input: { command: 'rm PRIVADO' } });
  r.check('en vivo: pide permiso → aviso "espera tu intervención"', await waitToast('waiting:' + S));
  claudeEvent('PostToolUse', { tool_name: 'Bash', tool_use_id: 'b1', tool_response: { stdout: 'PRIVADO' } });
  fs.appendFileSync(path.join(sdir, S + '.jsonl'), assistantLine('Listo, ya lo hice.', 'msg_hook_2')); // Claude escribe su respuesta
  claudeEvent('Stop', { last_assistant_message: 'PRIVADO' });
  r.check('en vivo: terminó → aviso "Claude terminó"', await waitToast('finished:' + S));
  const log = fs.readFileSync(path.join(am, 'events', S + '.jsonl'), 'utf8');
  r.check('registro en ~/.agent-map/events sin contenido privado', log.split('\n').filter(Boolean).length === 6 && !log.includes('PRIVADO'));
  await clear();

  // Reinicio del servidor (la app entera): el estado se reconstruye del registro y los eventos nuevos siguen llegando
  r.check('CSP: ningún recurso bloqueado', a.csp.length === 0, a.csp.join(' | ').slice(0, 200));
  await a.close();
  a = await launch({ profile: path.join(root, 'perfil'), env });
  await a.ev('toasts.setDuration(60000), true');
  await a.ev('load()');
  const noHistory = JSON.parse(await a.ev(TOASTS)).length === 0;
  claudeEvent('UserPromptSubmit', { prompt: 'otra' });
  await sleep(1800);
  fs.appendFileSync(path.join(sdir, S + '.jsonl'), assistantLine('Otra respuesta.', 'msg_hook_3'));
  claudeEvent('Stop');
  r.check('tras reiniciar: sin avisos históricos, y un turno nuevo avisa en vivo', noHistory && await waitToast('finished:' + S));

  // Quitar el hook: vuelve a como estaba
  await openHookModal();
  await a.ev(`document.querySelector('#modalBody [data-hook="uninstall"]').click(), true`);
  let removed = '';
  for (let i = 0; i < 30 && !/No instalado/.test(removed); i++) { await sleep(100); removed = await a.ev(`document.querySelector('#modalBody').textContent`); }
  await closeModal();
  r.check('quitar: el archivo que había creado Agent Map se borra; el proyecto queda como al principio', /No instalado/.test(removed) && !fs.existsSync(SETTINGS)
    && snap(proj).replace(/\|?\.claude$/, '') === proj0, snap(proj));
  // La prueba agregó respuestas al JSONL de la sesión (como haría Claude): se comparan los archivos que existen.
  r.check('en la carpeta de Claude no apareció ningún archivo (settings, hooks)', names(fx.claude) === claude0names, names(fx.claude));
} catch (err) { r.fail(err); }
if (a?.close) await a.close();
await sleep(300);
cleanup();
process.exit(r.finish());
