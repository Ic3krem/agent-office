import fs from 'node:fs';
import path from 'node:path';
import { loadWorld } from './world-vm.mjs';

// The office layout on disk. Validation is the page's own WorldModel, loaded once per store.
export function createWorldStore(dir) {
  const file = path.join(dir, 'layout.json');
  // Painters only run when measuring, so a no-op 2D context is enough here.
  const noop = new Proxy(function () {}, { get: () => noop, apply: () => noop, set: () => true });
  const WM = loadWorld({ ctxFactory: () => noop }).WorldModel;
  const J = (v) => JSON.parse(JSON.stringify(v)); // the vm has its own realm
  const fallback = (warning) => ({ layout: J(WM.defaultLayout()), source: 'default', ...(warning ? { warning } : {}) });
  return {
    load() {
      let text;
      try { text = fs.readFileSync(file, 'utf8'); } catch (e) { return e.code === 'ENOENT' ? fallback() : fallback('layout.json unreadable: ' + e.message); }
      let layout;
      try { layout = JSON.parse(text); } catch { return fallback('layout.json is not valid JSON; using the default'); }
      const r = WM.validate(J(layout));
      return r.ok ? { layout, source: 'file' } : fallback('layout.json rejected: ' + r.errors.slice(0, 3).join('; '));
    },
    save(layout) {
      const r = WM.validate(J(layout ?? null));
      if (!r.ok) return { ok: false, errors: J(r.errors) };
      fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
      fs.writeFileSync(file + '.tmp', JSON.stringify(layout), { mode: 0o600 });
      fs.renameSync(file + '.tmp', file);
      return { ok: true };
    },
  };
}
