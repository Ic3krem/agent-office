// Live harnesses leave their temp profiles behind when Electron still holds files at exit. Each harness calls sweep() at
// start: once the leftovers pass 1.5 GB, every leftover older than 30 min (so never a run in progress) is deleted.
const fs = require('fs'), os = require('os'), path = require('path');
const PREFIXES = ['ao-officeperf-', 'ao-townperf-', 'ao-scenecheck-', 'ao-towncheck-', 'ao-travelcheck-', 'ao-officecheck-', 'ao-notchcheck-'];
const LIMIT = 1.5 * 1024 ** 3, MIN_AGE = 30 * 60e3;

const sizeOf = p => {
  let st; try { st = fs.lstatSync(p); } catch { return 0; }
  if (!st.isDirectory()) return st.size;
  let n = 0; try { for (const e of fs.readdirSync(p)) n += sizeOf(path.join(p, e)); } catch {}
  return n;
};

function sweep(dir = os.tmpdir(), now = Date.now(), limit = LIMIT) {
  let names; try { names = fs.readdirSync(dir); } catch { return { total: 0, removed: [] }; }
  const left = names.filter(n => PREFIXES.some(p => n.startsWith(p))).map(n => path.join(dir, n));
  const total = left.reduce((a, p) => a + sizeOf(p), 0), removed = [];
  if (total <= limit) return { total, removed };
  for (const p of left) {
    try { if (now - fs.statSync(p).mtimeMs < MIN_AGE) continue; fs.rmSync(p, { recursive: true, force: true }); removed.push(p); } catch {}
  }
  return { total, removed };
}

module.exports = { sweep, PREFIXES };
