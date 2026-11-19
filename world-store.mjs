import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadWorld } from './world-vm.mjs';

// Scenes (town step 2): the office is layout.json; each interior has its own file beside it. The scene name comes from
// the request, so it is checked against this list before any path is built: null = not a scene (the server answers 400).
export const SCENES = ['office', 'kain', 'games', 'meet'];
const FILES = { office: 'layout.json', kain: 'kain.json', games: 'games.json', meet: 'meet.json' };
export const parseScene = (v) => v == null ? 'office' : SCENES.includes(v) ? v : null;

// The office layout on disk. Validation is the page's own WorldModel, loaded once per store.
export function createWorldStore(dir, opts = {}) {
  const fileOf = (scene) => { if (!SCENES.includes(scene)) throw new Error('unknown scene'); return path.join(dir, FILES[scene]); };
  const builtinDir = opts.builtinDir || fileURLToPath(new URL('./public/world-templates/', import.meta.url)); // opts.builtinDir: tests
  const userDir = path.join(dir, 'templates');
  const BUILT_IN_NAMES = { 'startup-loft': 'Startup Loft', 'agency-floor': 'Agency Floor', 'hotel-back-office': 'Hotel Back-Office' };
  const SLUG = /^[a-z0-9-]{1,40}$/;
  const ver = Object.fromEntries(SCENES.map((s) => [s, 0])); // per scene: saving one room never looks like a change to another
  // Painters only run when measuring, so a no-op 2D context is enough here.
  const noop = new Proxy(function () {}, { get: () => noop, apply: () => noop, set: () => true });
  const WM = loadWorld({ ctxFactory: () => noop }).WorldModel;
  const J = (v) => JSON.parse(JSON.stringify(v)); // the vm has its own realm
  const migrateV2 = (l) => J((opts.migrateV2 || WM.migrateV2)(J(l))); // opts.migrateV2: tests
  const readJson = (f) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; } };
  const ids = (d) => { try { return fs.readdirSync(d).filter((f) => f.endsWith('.json')).map((f) => f.slice(0, -5)).filter((i) => SLUG.test(i)); } catch { return []; } };
  const builtIds = () => ids(builtinDir).filter((i) => !i.startsWith('interior-')); // interior-* are scene defaults: fetchable (Build's reset), never listed
  // Atomic, fsynced write shared by the layout and templates. A Buffer is written as is (the v1 backup keeps the bytes).
  const writeAtomic = (f, data) => {
    fs.mkdirSync(path.dirname(f), { recursive: true, mode: 0o700 });
    const fd = fs.openSync(f + '.tmp', 'w', 0o600);
    try { fs.writeFileSync(fd, Buffer.isBuffer(data) ? data : JSON.stringify(data)); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
    fs.renameSync(f + '.tmp', f);
  };
  // A missing or bad file means the scene's default: the office's built-in layout, an interior's template.
  // A missing interior template is a broken install: say so once, then show an empty room with its door, never the office.
  const missingLogged = {};
  const emptyRoom = (scene) => ({ version: 1, scene, size: { w: 600, h: 400 }, spawn: { x: 300, y: 330 }, zones: [{ id: 'floor', type: 'office', rect: [0, 0, 600, 400] }], objects: [], spots: [{ id: 'door', x: 300, y: 390, face: 's', zone: 'door' }] });
  const defaultOf = (scene) => {
    if (scene === 'office') return migrateV2(WM.defaultLayout()); // a fresh install starts without the playroom and garden
    const f = path.join(builtinDir, 'interior-' + scene + '.json'), l = readJson(f);
    if (l && sceneOk(l, scene) && WM.validate(J(l)).ok) return l;
    if (!missingLogged[scene]) { missingLogged[scene] = true; console.error('[world] the built-in interior template ' + f + ' is missing or invalid; showing an empty ' + scene + ' room'); }
    return emptyRoom(scene);
  };
  const sceneOk = (layout, scene) => (layout?.scene ?? 'office') === scene;
  // Town step 3: an office layout saved before the playroom and garden moved out. The exact old bytes go to layout.v1.json
  // first (never overwriting a different v1); on any doubt the layout stays as it is (valid, unmigrated) and the log says why.
  const migrate = (file, raw, layout) => {
    const keep = (why) => { console.error('[world] layout.json not migrated: ' + why); return layout; };
    const next = migrateV2(layout), v = WM.validate(J(next));
    if (!v.ok) return keep('the migrated layout is invalid: ' + v.errors.slice(0, 3).join('; '));
    const v1 = path.join(dir, 'layout.v1.json');
    try {
      if (!fs.existsSync(v1)) writeAtomic(v1, raw);
      else if (!fs.readFileSync(v1).equals(raw)) return keep('layout.v1.json already holds a different layout');
    } catch (e) { return keep('the backup to layout.v1.json failed (' + (e.code || e.message) + ')'); }
    try { writeAtomic(file, next); } catch (e) { return keep('the rewrite failed (' + (e.code || e.message) + ')'); }
    return next;
  };
  return {
    load(scene = 'office') {
      const file = fileOf(scene), name = FILES[scene];
      const fallback = (warning) => ({ layout: defaultOf(scene), source: 'default', ...(warning ? { warning } : {}) });
      let raw, text; // raw: the exact bytes, for a byte-identical v1 backup
      try { raw = fs.readFileSync(file); text = raw.toString('utf8'); } catch (e) {
        if (e.code === 'ENOENT') return fallback();
        console.error('[world] ' + name + ' unreadable:', e); // the full reason (with path) stays server-side
        return fallback(name + ' unreadable (' + e.code + '); using the default');
      }
      let layout;
      try { layout = JSON.parse(text); } catch { return fallback(name + ' is not valid JSON; using the default'); }
      const r = WM.validate(J(layout));
      if (r.ok && !sceneOk(layout, scene)) return fallback(name + ' holds another scene; using the default');
      if (!r.ok) return fallback(name + ' rejected: ' + r.errors.slice(0, 3).join('; '));
      return { layout: scene === 'office' && layout.migrated !== 2 ? migrate(file, raw, layout) : layout, source: 'file' };
    },
    save(layout, scene = 'office') {
      const file = fileOf(scene);
      const r = WM.validate(J(layout ?? null));
      if (!r.ok) return { ok: false, errors: J(r.errors) };
      if (!sceneOk(layout, scene)) return { ok: false, errors: ['this layout is for ' + (layout.scene ?? 'office') + ', not ' + scene] };
      writeAtomic(file, scene === 'office' ? { ...layout, migrated: 2 } : layout); // saved after the move: any playroom is the user's own
      ver[scene]++;
      return { ok: true };
    },
    version: (scene = 'office') => ver[scene],
    listTemplates() {
      const built = builtIds().map((id) => ({ id, name: BUILT_IN_NAMES[id] || id, builtIn: true, scene: readJson(path.join(builtinDir, id + '.json'))?.scene || 'office' }));
      const mine = ids(userDir).filter((id) => !built.some((b) => b.id === id)).map((id) => { const t = readJson(path.join(userDir, id + '.json')); return { id, name: t?.name || id, builtIn: false, scene: t?.layout?.scene || 'office' }; });
      return [...built, ...mine];
    },
    getTemplate(id) {
      if (!SLUG.test(String(id))) return null;
      const builtIn = ids(builtinDir).includes(id), raw = readJson(path.join(builtIn ? builtinDir : userDir, id + '.json'));
      // built-in office templates predate the move of the playroom and garden: serve them migrated (user templates are theirs)
      const layout = !builtIn ? raw?.layout : raw && sceneOk(raw, 'office') ? migrateV2(raw) : raw;
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
