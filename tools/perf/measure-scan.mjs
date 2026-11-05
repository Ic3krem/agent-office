// Compares the old per-second scan (every transcript stat'ed and read each tick) with the gated scanner on a real tree.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createScanner } from '../../perf.mjs';
const root = process.argv[2] || path.join(os.homedir(), '.claude', 'projects');
const mk = () => { const c = { n: 0 }; return { c, fs: { readdirSync: (...a) => { c.n++; return fs.readdirSync(...a); }, statSync: (...a) => { c.n++; return fs.statSync(...a); }, readFileSync: (...a) => { c.n++; return fs.readFileSync(...a); }, existsSync: (...a) => { c.n++; return fs.existsSync(...a); } } }; };
// the previous implementation, call for call
function oldScan(w, now) {
  let dirs = []; try { dirs = w.readdirSync(root); } catch { return; }
  for (const d of dirs) {
    const dir = path.join(root, d); let names; try { names = w.readdirSync(dir); } catch { continue; }
    for (const n of names) {
      if (!n.endsWith('.jsonl')) continue;
      const id = n.slice(0, -6), file = path.join(dir, n);
      try { w.statSync(file); w.statSync(file); } catch {} // track(): statSync, then readNew(): statSync
      const sub = path.join(dir, id, 'subagents'); if (!w.existsSync(sub)) continue;
      for (const s of w.readdirSync(sub)) { if (!s.endsWith('.jsonl')) continue; const sf = path.join(sub, s); try { w.readFileSync(sf.replace(/\.jsonl$/, '.meta.json'), 'utf8'); } catch {} try { w.statSync(sf); w.statSync(sf); w.statSync(sf); } catch {} }
    }
  }
}
const a = mk(); oldScan(a.fs); const oldPerTick = a.c.n;
const b = mk(); let t = Date.now(); const sc = createScanner({ projects: root, fs: b.fs, now: () => t, onFile: () => {} });
sc.tick(); const first = b.c.n; b.c.n = 0;
for (let i = 0; i < 600; i++) { t += 1000; sc.tick(); }
console.log(JSON.stringify({ oldCallsPerTick: oldPerTick, oldCallsPer10min: oldPerTick * 600, newFirstTick: first, newCallsPer10min: b.c.n, newAvgPerTick: +(b.c.n / 600).toFixed(1), hot: sc.hotCount(), reduction: +(oldPerTick * 600 / Math.max(1, b.c.n)).toFixed(1) + 'x' }));
