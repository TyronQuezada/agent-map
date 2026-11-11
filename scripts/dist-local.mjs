// npm run dist:local — instalador SOLO para este equipo, con los sonidos de la carpeta local Sounds/ dentro
// (quedan en resources/sounds de la app instalada). Usa la misma configuración que `npm run dist` más esos
// recursos, y sale en dist/local/ para no mezclarse con el instalador público.
// No subir este instalador a GitHub ni a releases: esos audios no son redistribuibles.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'electron-builder';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SOUNDS = ['messenger-tono-mensaje.mp3', 'msn-alert.mp3', 'msn-online.mp3', 'nudge-nudge-msn.mp3'];
const missing = SOUNDS.filter(f => !fs.existsSync(path.join(root, 'Sounds', f)));
if (missing.length) {
  console.error(`Faltan en Sounds/: ${missing.join(', ')}. No se genera el instalador local.`);
  process.exit(1);
}
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const config = {
  ...pkg.build,
  directories: { ...pkg.build.directories, output: 'dist/local' },
  extraResources: [...(pkg.build.extraResources || []), { from: 'Sounds', to: 'sounds', filter: SOUNDS }],
};
const out = await build({ projectDir: root, config, win: ['nsis'], publish: 'never' });
console.log('Instalador local:\n' + out.filter(f => f.endsWith('.exe')).join('\n'));
