// Freezes today's furniture footprints into fixtures/office-footprints.json: one row per default instance and part (the
// 0-based add() index in its type's build), plus catalog types with no default instance built at their anchor, in world
// units relative to the instance's home anchor. Copies of a type can differ (plant scale, desk role, pane length), hence
// the instance id. fp is what footprints() blocks for the part, d its depth minus (home x + y), null for floor pieces.
// Sprite art is modelled to these rects; office-sprites-path.test.mjs fails if they drift.
// Usage: node scripts/freeze-footprints.mjs [--check]   (--check prints the JSON instead of writing it)
import fs from 'node:fs';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { loadWorld } from '../world-vm.mjs';

const FILE = new URL('../fixtures/office-footprints.json', import.meta.url);
const round = v => Math.round(v * 100) / 100;

// The default instances plus one copy, at its anchor, of each catalog type with no default copy (karinderya, broom corner).
export function withAnchored(F) {
  const inst = F.defaultInstances(), had = new Set(inst.map(p => p.type));
  for (const [type, T] of Object.entries(F.CATALOG)) if (!had.has(type)) inst.push({ id: type, type, x: T.anchor[0], y: T.anchor[1] });
  return inst;
}

export function freeze() {
  const F = loadWorld().OfficeFurniture, rows = [], inst = withAnchored(F);
  for (const p of inst) {
    const [hx, hy] = F.homeOf(F.CATALOG[p.type], p);
    F.parts(p).forEach(({ it, rec }, part) => {
      const fp = it.fp || (rec.length ? rec.reduce((a, q) => [Math.min(a[0], q[0]), Math.min(a[1], q[1]), Math.max(a[2], q[2]), Math.max(a[3], q[3])]) : null);
      rows.push({ id: p.id, type: p.type, part, fp: fp && [fp[0] - hx, fp[1] - hy, fp[2] - hx, fp[3] - hy].map(round), d: it.o.floor ? null : round(it.d - hx - hy), floor: !!it.o.floor, nofp: !!it.o.nofp });
    });
  }
  return rows;
}
export const serialize = rows => '[\n' + rows.map(r => '  ' + JSON.stringify(r)).join(',\n') + '\n]\n';

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const out = serialize(freeze());
  if (process.argv.includes('--check')) process.stdout.write(out); else { fs.writeFileSync(FILE, out); console.log('wrote', fileURLToPath(FILE), out.split('\n').length - 3, 'rows'); }
}
