// npm run test:e2e — corre las pruebas E2E de a una (abren ventanas de Agent Map; necesitan sesión gráfica).
// Fuera de `npm test` a propósito. AGENT_MAP_EXE=ruta\Agent Map.exe las corre contra la app empaquetada.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = path.dirname(fileURLToPath(import.meta.url));
const only = process.argv.slice(2);
const files = fs.readdirSync(dir).filter(f => f.endsWith('.e2e.mjs') && (!only.length || only.some(o => f.includes(o)))).sort();
let failed = 0;
for (const f of files) {
  const res = spawnSync(process.execPath, [path.join(dir, f)], { stdio: 'inherit' });
  if (res.status !== 0) { failed++; console.log(`>> ${f} FALLÓ (código ${res.status})`); }
}
console.log(`\nE2E: ${files.length - failed}/${files.length} archivos OK`);
process.exit(failed ? 1 : 0);
