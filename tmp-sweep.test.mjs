import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
const { sweep } = createRequire(import.meta.url)('./perf/tmp-sweep.cjs');

test('sweep deletes old harness leftovers only once they pass the limit', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sweep-'));
  const mk = (name, bytes, ageMin) => {
    const p = path.join(dir, name); fs.mkdirSync(p); fs.writeFileSync(path.join(p, 'f'), Buffer.alloc(bytes));
    const t = new Date(Date.now() - ageMin * 60e3); fs.utimesSync(p, t, t); return p;
  };
  const old = mk('ao-townperf-a', 600, 60), fresh = mk('ao-officeperf-b', 600, 1), other = mk('ao-gfx-c', 5000, 60);
  assert.deepEqual(sweep(dir, Date.now(), 2000).removed, []); // 1200 bytes, under the limit
  const r = sweep(dir, Date.now(), 1000);
  assert.equal(r.total, 1200);
  assert.deepEqual(r.removed, [old]); // the fresh run in progress and unrelated folders stay
  assert.ok(fs.existsSync(fresh) && fs.existsSync(other) && !fs.existsSync(old));
  fs.rmSync(dir, { recursive: true, force: true });
});
