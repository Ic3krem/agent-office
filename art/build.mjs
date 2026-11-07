// npm run art: Blender terrain + town asset + office piece renders -> art/.raw, then art/post.py -> public/art/town and
// public/art/office (town palette art/palette.json, kept once cut; office palette art/palette-office.json), then art/MANIFEST.json. The office frame list comes from scripts/export-catalog.mjs.
// Developer-only (needs Blender, Python 3 and Pillow); npm test and packaging use the committed PNG/JSON.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const RAW = path.join(ROOT, 'art/.raw'), OUT = path.join(ROOT, 'public/art/town'), OFFICE = path.join(ROOT, 'public/art/office'), TOWN = path.join(ROOT, 'public/town/town.json');
const CATALOG = path.join(RAW, 'catalog.json'), FOOT = path.join(ROOT, 'fixtures/office-footprints.json');
const works = cmd => { try { return spawnSync(cmd, ['--version'], { stdio: 'ignore' }).status === 0; } catch { return false; } };
const blender = [process.env.BLENDER, 'C:/Program Files/Blender Foundation/Blender 5.2/blender.exe'].find(p => p && fs.existsSync(p)) || (works('blender') ? 'blender' : null);
if (!blender) { console.error('Blender not found: set BLENDER to blender.exe, or put blender on PATH.'); process.exit(2); }
const python = process.env.PYTHON || 'python';

const run = (cmd, args) => {
  console.log('>', path.basename(cmd), args.map(a => path.relative(ROOT, a) || a).join(' '));
  const r = spawnSync(cmd, args, { stdio: 'inherit', cwd: ROOT });
  if (r.status !== 0) { console.error(`${path.basename(cmd)} failed (${r.status ?? r.error})`); process.exit(1); }
};
fs.rmSync(RAW, { recursive: true, force: true }); // full build: stale raw renders must not ship
fs.mkdirSync(RAW, { recursive: true });
run(blender, ['-b', '-P', path.join(ROOT, 'art/blender/town_terrain.py'), '--', TOWN, RAW]);
run(blender, ['-b', '-P', path.join(ROOT, 'art/blender/town_assets.py'), '--', TOWN, RAW]);
run(process.execPath, [path.join(ROOT, 'scripts/export-catalog.mjs'), CATALOG]);
run(blender, ['-b', '-P', path.join(ROOT, 'art/blender/office_assets.py'), '--', CATALOG, FOOT, path.join(RAW, 'office')]);
run(python, [path.join(ROOT, 'art/post.py'), RAW, OUT, OFFICE]);

const walk = d => fs.readdirSync(d, { withFileTypes: true }).flatMap(e => e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]);
const date = new Date().toISOString().slice(0, 10), license = 'Apache-2.0 (original)';
const scriptOf = rel => rel.startsWith('art/palette') ? 'art/post.py'
  : rel.includes('/terrain') ? 'art/blender/town_terrain.py + art/post.py' : rel.startsWith('public/art/office/') ? 'art/blender/office_assets.py + art/post.py'
  : 'art/blender/town_assets.py + art/post.py';
const files = [...walk(OUT), ...walk(OFFICE), path.join(ROOT, 'art/palette.json'), path.join(ROOT, 'art/palette-office.json')].map(f => {
  const rel = path.relative(ROOT, f).split(path.sep).join('/');
  return { file: rel, sha256: crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex'), script: scriptOf(rel), date, license };
}).sort((a, b) => a.file.localeCompare(b.file));
fs.writeFileSync(path.join(ROOT, 'art/MANIFEST.json'), JSON.stringify({ license, files }, null, 1) + '\n');
console.log(`art: ${files.length} files in art/MANIFEST.json`);
