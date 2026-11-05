import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadWorld } from './world-vm.mjs';

// The office layout on disk. Validation is the page's own WorldModel, loaded once per store.
export function createWorldStore(dir) {
  const file = path.join(dir, 'layout.json');
  const builtinDir = fileURLToPath(new URL('./public/world-templates/', import.meta.url));
  const userDir = path.join(dir, 'templates');
  const BUILT_IN_NAMES = { 'startup-loft': 'Startup Loft', 'agency-floor': 'Agency Floor', 'hotel-back-office': 'Hotel Back-Office' };
  const SLUG = /^[a-z0-9-]{1,40}$/;
  let ver = 0;
  // Painters only run when measuring, so a no-op 2D context is enough here.
  const noop = new Proxy(function () {}, { get: () => noop, apply: () => noop, set: () => true });
  const WM = loadWorld({ ctxFactory: () => noop }).WorldModel;
  const J = (v) => JSON.parse(JSON.stringify(v)); // the vm has its own realm
  const readJson = (f) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; } };
  const ids = (d) => { try { return fs.readdirSync(d).filter((f) => f.endsWith('.json')).map((f) => f.slice(0, -5)).filter((i) => SLUG.test(i)); } catch { return []; } };
  // Atomic, fsynced write shared by the layout and templates.
  const writeAtomic = (f, data) => {
    fs.mkdirSync(path.dirname(f), { recursive: true, mode: 0o700 });
    const fd = fs.openSync(f + '.tmp', 'w', 0o600);
    try { fs.writeFileSync(fd, JSON.stringify(data)); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
    fs.renameSync(f + '.tmp', f);
  };
  const fallback = (warning) => ({ layout: J(WM.defaultLayout()), source: 'default', ...(warning ? { warning } : {}) });
  return {
    load() {
      let text;
      try { text = fs.readFileSync(file, 'utf8'); } catch (e) {
        if (e.code === 'ENOENT') return fallback();
        console.error('[world] layout.json unreadable:', e); // the full reason (with path) stays server-side
        return fallback('layout.json unreadable (' + e.code + '); using the default');
      }
      let layout;
      try { layout = JSON.parse(text); } catch { return fallback('layout.json is not valid JSON; using the default'); }
      const r = WM.validate(J(layout));
      return r.ok ? { layout, source: 'file' } : fallback('layout.json rejected: ' + r.errors.slice(0, 3).join('; '));
    },
    save(layout) {
      const r = WM.validate(J(layout ?? null));
      if (!r.ok) return { ok: false, errors: J(r.errors) };
      writeAtomic(file, layout);
      ver++;
      return { ok: true };
    },
    version: () => ver,
    listTemplates() {
      const built = ids(builtinDir).map((id) => ({ id, name: BUILT_IN_NAMES[id] || id, builtIn: true }));
      const mine = ids(userDir).filter((id) => !built.some((b) => b.id === id)).map((id) => ({ id, name: readJson(path.join(userDir, id + '.json'))?.name || id, builtIn: false }));
      return [...built, ...mine];
    },
    getTemplate(id) {
      if (!SLUG.test(String(id))) return null;
      const layout = ids(builtinDir).includes(id) ? readJson(path.join(builtinDir, id + '.json')) : readJson(path.join(userDir, id + '.json'))?.layout;
      return layout && WM.validate(J(layout)).ok ? { layout } : null;
    },
    saveTemplate(name, layout) {
      const r = WM.validate(J(layout ?? null));
      if (!r.ok) return { ok: false, errors: J(r.errors) };
      const nm = String(name ?? '').trim().slice(0, 60);
      let id = nm.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40).replace(/-+$/, '') || 'template';
      if (ids(builtinDir).includes(id)) id = id.slice(0, 35).replace(/-+$/, '') + '-mine';
      writeAtomic(path.join(userDir, id + '.json'), { name: nm || id, layout });
      return { ok: true, id };
    },
    deleteTemplate(id) {
      if (!SLUG.test(String(id))) return { ok: false };
      try { fs.rmSync(path.join(userDir, id + '.json')); return { ok: true }; } catch { return { ok: false }; }
    },
  };
}
