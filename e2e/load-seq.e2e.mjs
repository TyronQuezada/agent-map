// E2E: load() descarta respuestas viejas de /api/tree. Se controla el orden de las respuestas con un fetch falso.
import path from 'node:path';
import { launch, makeFixture, reporter, sleep, tempRoot } from './lib.mjs';

const { root, cleanup } = tempRoot('load');
const fx = makeFixture(root);
const env = { CLAUDE_CONFIG_DIR: fx.claude, AGENT_MAP_USAGE_FILE: path.join(root, 'agent-map', 'usage.json') };
const r = reporter('load() ignora respuestas obsoletas');

// Todo corre dentro de la página en milisegundos; seqDelta detecta si el intervalo de 15 s se coló entre medio.
const SCENARIO = `(async () => {
  const realFetch = window.fetch, origRender = window.renderAll, pend = [];
  let renders = 0;
  window.renderAll = function () { renders++; return origRender.apply(this, arguments); };
  window.fetch = (u, o) => String(u).startsWith('/api/tree') ? new Promise((res, rej) => pend.push({ res, rej })) : realFetch(u, o);
  const base = await (await realFetch('/api/tree')).json();
  const mk = tag => new Response(JSON.stringify({ ...base, projects: base.projects.map((p, i) => i === 0 ? { ...p, name: tag } : p) }));
  const name = () => state.projects[0]?.name, tree = () => document.querySelector('#tree').textContent;
  const out = {}, seq0 = loadSeq;
  try {
    let r0 = renders; let p = load(); pend.shift().res(mk('UNICA')); await p;
    out['una sola solicitud se procesa'] = name() === 'UNICA' && renders === r0 + 1;
    r0 = renders; const a = load(), b = load(); const [pa, pb] = pend.splice(0);
    pa.res(mk('A-VIEJA')); await a; const tras = { n: name(), r: renders - r0 };
    pb.res(mk('B-NUEVA')); await b;
    out['dos simultáneas: gana la última'] = tras.n === 'UNICA' && tras.r === 0 && name() === 'B-NUEVA' && renders === r0 + 1;
    r0 = renders; const c = load(), d = load(); const [pc, pd] = pend.splice(0);
    pd.res(mk('D-NUEVA')); await d; pc.res(mk('C-VIEJA')); await c;
    out['la vieja llega después y se descarta sin renderizar'] = name() === 'D-NUEVA' && renders === r0 + 1 && !tree().includes('C-VIEJA');
    const antes = state.projects; r0 = renders;
    const e = load(); pend.shift().rej(new TypeError('Failed to fetch')); await e;
    out['un error conserva la última carga correcta'] = state.projects === antes && renders === r0 && tree().includes('Sin conexión');
    r0 = renders; const f = load(); pend.shift().res(mk('F-OK')); await f;
    out['tras el error, la siguiente funciona'] = name() === 'F-OK' && renders === r0 + 1 && !tree().includes('Sin conexión');
    const g = load(), h = load(); const [pg, ph] = pend.splice(0);
    ph.res(mk('H-OK')); await h; pg.rej(new TypeError('Failed to fetch')); await g;
    out['el error de una llamada vieja no tapa la nueva'] = name() === 'H-OK' && !tree().includes('Sin conexión');
    out.seqDelta = loadSeq - seq0; // esperado 1+2+2+1+1+2 = 9
  } finally { window.fetch = realFetch; window.renderAll = origRender; }
  await load();
  out['datos reales restaurados'] = state.projects[0]?.name === base.projects[0]?.name;
  return out;
})()`;

let a;
try {
  a = await launch({ profile: path.join(root, 'perfil'), env });
  let out;
  for (let i = 0; i < 3; i++) { out = await a.ev(SCENARIO); if (out.seqDelta === 9) break; await sleep(500); }
  for (const [k, v] of Object.entries(out)) if (k !== 'seqDelta') r.check(k, v === true);
  r.check('sin interferencia del intervalo de 15 s', out.seqDelta === 9, 'seqDelta=' + out.seqDelta);
} catch (err) { r.fail(err); }
if (a?.close) await a.close();
await sleep(300);
cleanup();
process.exit(r.finish());
