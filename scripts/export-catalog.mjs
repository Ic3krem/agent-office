// Lists the office sprite frames the art build must render: for every frame a converted painter asks for (default copies,
// catalog types with no default copy built at their anchor,
// every desk partition variant on both rows, each server-plant growth level), the type, part, variant, the instance's home
// anchor and the part's footprint relative to it (the same rects fixtures/office-footprints.json freezes), plus each
// catalog type's anchor, and the default copies (placed) for the office preview. art/blender/office_assets.py models each frame around that home.
// Usage: node scripts/export-catalog.mjs <out.json>   (npm run art writes art/.raw/catalog.json)
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { loadWorld } from '../world-vm.mjs';

export function exportCatalog() {
  const F = loadWorld().OfficeFurniture, frames = {}, NUL = new Proxy(function () {}, { get: () => NUL, apply: () => NUL, set: () => true });
  let asked = []; const placed = []; // placed: the default copies at plant level 0, for the office preview
  F.useAtlas({ image: {}, frames: new Proxy({}, { get: (_, n) => { if (typeof n === 'string') asked.push(n); return { x: 0, y: 0, w: 1, h: 1, ax: 0, ay: 0 }; } }) });
  const inst = F.defaultInstances(), had = new Set(inst.map(p => p.type));
  for (const [type, T] of Object.entries(F.CATALOG)) if (!had.has(type)) inst.push({ id: type, type, x: T.anchor[0], y: T.anchor[1] }); // types with no default copy (karinderya, broom corner) at their anchor, as freeze-footprints does
  for (const role of ['tally', 'atlas', 'pixel']) for (const y of [352, 516]) inst.push({ id: role + y, type: 'dept-desk', desk: 'desk-1', role, x: 155, y });
  for (let lv = 0; lv <= 6; lv++) {
    F.state.ex.plantLevel = lv;
    for (const p of inst) {
      const home = F.homeOf(F.CATALOG[p.type], p);
      F.parts(p).forEach(({ it, rec }, part) => {
        asked = []; it.fn(NUL);
        if (lv === 0 && !/\d{3}$/.test(p.id)) placed.push({ id: p.id, part, frame: asked[0] || null, home, d: it.o.floor ? -1e9 : it.d });
        for (const name of new Set(asked)) {
          if (frames[name]) continue;
          const fp = it.fp || (rec.length ? rec.reduce((a, q) => [Math.min(a[0], q[0]), Math.min(a[1], q[1]), Math.max(a[2], q[2]), Math.max(a[3], q[3])]) : null);
          const [base, variant = null] = name.split('@');
          frames[name] = { type: p.type, part, base, variant, id: p.id, home, fp: fp && [fp[0] - home[0], fp[1] - home[1], fp[2] - home[0], fp[3] - home[1]].map(v => Math.round(v * 100) / 100) };
        }
      });
    }
  }
  const anchors = Object.fromEntries(Object.entries(F.CATALOG).map(([t, T]) => [t, T.anchor]));
  return { frames, anchors, placed };
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const out = process.argv[2]; if (!out) { console.error('usage: node scripts/export-catalog.mjs <out.json>'); process.exit(2); }
  fs.mkdirSync(path.dirname(out), { recursive: true });
  const c = exportCatalog(); fs.writeFileSync(out, JSON.stringify(c, null, 1) + '\n');
  console.log('catalog:', Object.keys(c.frames).length, 'frames ->', out);
}
