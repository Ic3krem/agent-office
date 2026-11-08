// Live check of the office art in Electron (not in npm test): temp-profile server on :4793, offscreen 1480x920 window.
// 1. the default office (frozen frame) as t7-normal.png, or with --before as t7-before.png; with both present, the
//    before/after compare t7-compare.png and its pixel diff; 2. a custom layout saved from Build mode (desk-1 moved 40 east,
//    an IT desk added) renders from the atlas after a reload; 3. a Build-mode drag of a sprite piece follows the cursor;
// 4. with atlas.png blocked the office still renders, as placeholder boxes, with one console note.
// usage: node_modules/.bin/electron perf/office-check.cjs [shot dir] [--before]   (prints ALL PASSED)
const { app, BrowserWindow, session } = require('electron');
const { spawn } = require('child_process');
const fs = require('fs'), os = require('os'), path = require('path'), crypto = require('crypto');
const root = path.join(__dirname, '..'), port = 4793, base = 'http://127.0.0.1:' + port, key = crypto.randomBytes(24).toString('hex');
const args = process.argv.slice(2), before = args.includes('--before');
const shots = args.find(a => !a.startsWith('-') && !a.endsWith('.cjs')) || path.join(root, 'art', '.raw');
require('./tmp-sweep.cjs').sweep();
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ao-officecheck-'));
app.setPath('userData', path.join(tmp, 'electron'));
const child = spawn(process.execPath, [path.join(root, 'server.mjs')], { env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', USERPROFILE: tmp, HOME: tmp, APPDATA: path.join(tmp, 'AppData'), LOCALAPPDATA: path.join(tmp, 'Local'), AGENT_OFFICE_PORT: String(port), AGENT_OFFICE_UI_KEY: key, CLAUDE_CODE_PATH: '' }, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
let log = ''; child.stdout.on('data', d => log += d); child.stderr.on('data', d => log += d);
const wait = ms => new Promise(r => setTimeout(r, ms));
let failed = 0;
const check = (name, ok, info) => { if (!ok) failed++; console.log((ok ? 'PASS ' : 'FAIL ') + name + (info !== undefined ? '  ' + JSON.stringify(info) : '')); };
const done = code => { try { child.kill(); } catch {} try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {} app.exit(code); };
setTimeout(() => { console.log('FAIL watchdog: harness exceeded 240 s'); done(1); }, 240000).unref();
process.on('uncaughtException', e => { console.log('FAIL ' + e.stack); done(1); });

app.whenReady().then(async () => {
  for (let t = 0; !/running on/.test(log); t += 150) { if (t > 20000) throw new Error('server did not start: ' + log.slice(0, 300)); await wait(150); }
  await session.defaultSession.cookies.set({ url: base, name: 'ao_ui', value: key });
  const w = new BrowserWindow({ width: 1480, height: 920, show: false, webPreferences: { offscreen: true, contextIsolation: false } });
  const msgs = [];
  w.webContents.on('console-message', e => msgs.push({ level: e.level, text: e.message }));
  w.webContents.on('will-prevent-unload', e => e.preventDefault()); // leaving Build mode with an unsaved drop
  const js = s => w.webContents.executeJavaScript(s);
  const until = async (fn, ms = 20000) => { for (let t = 0; t < ms; t += 100) { try { if (await fn()) return true; } catch {} await wait(100); } return false; };
  const save = async (name, img) => { fs.mkdirSync(shots, { recursive: true }); const f = path.join(shots, 't7-' + name + '.png'); fs.writeFileSync(f, (img || await w.webContents.capturePage()).toPNG()); console.log('screenshot', f); return f; };
  const btn = t => js(`(() => { const b = [...document.querySelectorAll('button')].find(b => b.textContent.trim() === ${JSON.stringify(t)}); if (b) b.click(); return !!b; })()`);
  const hasArt = `OfficeFurniture.sprite({ save() {}, restore() {}, drawImage() {} }, 'tires', 0, 0)`; // true once the atlas is in
  // the office booted, the atlas in (or not), the zone labels faded and the lights settled (about 16 s), daylight
  const ready = async art => {
    const ok = await until(() => js(`!!(window.OfficeWorld && OfficeWorld.framesDrawn() > 0) && ${hasArt} === ${art}`));
    await until(() => js('OfficeFurniture.state.labels <= 0.02 && Math.abs(OfficeFurniture.state.dim - (OfficeWorld.debug().board.empty ? 1 : 0)) <= 0.01'), 25000);
    await js('OfficeWorld.setHour(13)'); await wait(600);
    return ok;
  };
  // stop the loop and draw one frame at T = 0 so two runs compare pixel for pixel (only the wall clock's hands follow real time)
  const frozen = () => js(`(async () => { window.requestAnimationFrame = () => 0; await new Promise(r => setTimeout(r, 700)); OfficeFurniture.state.T = 0; OfficeWorld.render(); await new Promise(r => setTimeout(r, 600)); })()`); // let the compositor present that frame
  const P = (x, y) => js(`(() => { const c = document.querySelector('canvas').getBoundingClientRect(), p = OfficeFurniture.P(${x}, ${y}, 0); return [Math.round(c.left + p[0] / 1480 * c.width), Math.round(c.top + p[1] / 920 * c.height)]; })()`);

  // 1. the default office, frozen
  await w.loadURL(base + '/');
  check('office boots with the atlas', await ready(true));
  await frozen();
  const shot1 = await save(before ? 'before' : 'normal');
  if (before) { console.log(failed ? 'FAILED ' + failed : 'ALL PASSED'); return done(failed ? 1 : 0); }
  const bf = path.join(shots, 't7-before.png');
  if (fs.existsSync(bf)) { // side by side (before | after | differing pixels in red over a dimmed after)
    const url = f => 'data:image/png;base64,' + fs.readFileSync(f).toString('base64');
    const r = await js(`(async () => {
      const load = u => new Promise(ok => { const i = new Image(); i.onload = () => ok(i); i.src = u; });
      const [a, b] = await Promise.all([load(${JSON.stringify(url(bf))}), load(${JSON.stringify(url(shot1))})]);
      const W = a.width, H = a.height, c = document.createElement('canvas'); c.width = W * 3; c.height = H; const g = c.getContext('2d');
      const px = i => { const k = document.createElement('canvas'); k.width = W; k.height = H; const q = k.getContext('2d'); q.drawImage(i, 0, 0); return q.getImageData(0, 0, W, H); };
      const A = px(a), B = px(b), D = new ImageData(W, H); let n = 0, l = W, t = H, rr = -1, bb = -1;
      for (let i = 0; i < A.data.length; i += 4) { const k = i / 4, x = k % W, y = (k / W) | 0; const diff = A.data[i] !== B.data[i] || A.data[i + 1] !== B.data[i + 1] || A.data[i + 2] !== B.data[i + 2];
        if (diff) { n++; l = Math.min(l, x); rr = Math.max(rr, x); t = Math.min(t, y); bb = Math.max(bb, y); D.data[i] = 255; D.data[i + 3] = 255; } else { D.data[i] = B.data[i] * .35; D.data[i + 1] = B.data[i + 1] * .35; D.data[i + 2] = B.data[i + 2] * .35; D.data[i + 3] = 255; } }
      g.drawImage(a, 0, 0); g.drawImage(b, W, 0); g.putImageData(D, 2 * W, 0);
      return { n, box: n ? [l, t, rr, bb] : null, png: c.toDataURL('image/png') }; })()`);
    fs.writeFileSync(path.join(shots, 't7-compare.png'), Buffer.from(r.png.split(',')[1], 'base64')); console.log('screenshot', path.join(shots, 't7-compare.png'));
    // the wall clock's hands follow real time between the two runs; anything else differing is the render changing
    const clock = await js(`(() => { const c = document.querySelector('canvas').getBoundingClientRect(), P = OfficeFurniture.P, a = P(0, 545, 145), b = P(0, 495, 95); return [c.left + Math.min(a[0], b[0]) / 1480 * c.width, c.top + Math.min(a[1], b[1]) / 920 * c.height, c.left + Math.max(a[0], b[0]) / 1480 * c.width, c.top + Math.max(a[1], b[1]) / 920 * c.height]; })()`);
    const inClock = r.box && r.box[0] >= clock[0] - 4 && r.box[1] >= clock[1] - 4 && r.box[2] <= clock[2] + 4 && r.box[3] <= clock[3] + 4;
    check('sprite render unchanged by the painter retirement (pixel diff, clock hands aside)', r.n === 0 || inClock, { pixels: r.n, box: r.box, clock: clock.map(Math.round) });
  }

  // 2. a custom saved layout: desk-1 moved 40 east, an IT desk added, saved from Build mode, then a reload
  check('Build opens', await btn('Build')); await wait(400);
  const L = await js(`(() => { const L = JSON.parse(JSON.stringify(WorldModel.defaultLayout())); L.objects.find(o => o.id === 'desk-1').x += 40;
    for (const [x, y] of [[1120, 480], [1110, 300], [1130, 160], [700, 130]]) { const T = JSON.parse(JSON.stringify(L)); T.objects.push({ id: 'desk-9', type: 'dept-desk', desk: 'desk-9', role: 'it', x, y }); if (WorldModel.validate(T).ok) return T; }
    return null; })()`);
  check('a custom layout with a moved and an added desk validates', !!L, L && L.objects.find(o => o.id === 'desk-9'));
  const load = await js(`JSON.stringify(OfficeWorld.buildOp('load', ${JSON.stringify(L)}))`);
  check('Build loads it', JSON.parse(load).ok, load); await wait(300);
  check('Save pressed', await btn('Save')); await wait(1200);
  await btn('Done'); await wait(300);
  const files = fs.readdirSync(tmp, { recursive: true }).map(String), lf = files.find(f => /[\\/]world[\\/]layout\.json$/.test(f));
  const saved = lf && JSON.parse(fs.readFileSync(path.join(tmp, lf), 'utf8'));
  check('the custom layout is on disk', !!(saved && saved.objects.some(o => o.id === 'desk-9') && saved.objects.find(o => o.id === 'desk-1').x === 195));
  await w.loadURL(base + '/'); check('office reloads with the atlas', await ready(true));
  const cust = await js(`(() => {
    const F = OfficeFurniture; let atlas = null; F.sprite({ save() {}, restore() {}, drawImage(i) { atlas = i; } }, 'tires', 0, 0); // the atlas image (an ImageBitmap: no src)
    const rec = () => { const c = []; return { c, g: new Proxy({}, { get: (_, k) => k === 'drawImage' ? (...a) => c.push(a[0] && a[0] === atlas ? 'atlas.png' : '?') : k === 'measureText' ? () => ({ width: 0 }) : k === 'createRadialGradient' || k === 'createLinearGradient' ? () => ({ addColorStop() {} }) : () => {}, set: () => true }) }; };
    const desks = F.objects.filter(o => o.key === 'desk' && /desk-(1|9)$/.test(o.desk));
    return { spot1: OfficeMotion.SPOTS['desk-1'], spot9: OfficeMotion.SPOTS['desk-9'], labels: desks.map(o => o.label),
      art: desks.map(o => { const r = rec(); o.src.fn(r.g); return r.c.some(s => /atlas\\.png/.test(s)); }) }; })()`);
  check('desk-1 sits 40 east and the IT desk is placed', cust.spot1 && cust.spot1.x === 195 && !!cust.spot9, cust);
  check('both desks draw from the atlas', cust.art.length === 2 && cust.art.every(Boolean), cust);
  await save('custom');

  // 3. Build-mode drag of a sprite piece: the recycling bin follows the cursor, then drops where released
  check('Build opens again', await btn('Build')); await wait(400);
  const where = `(() => { const F = OfficeFurniture, it = F.items.find(i => { let hit = false; try { i.fn(new Proxy({}, { get: (_, k) => k === 'drawImage' ? (img, sx, sy) => { const f = window.__frame; if (sx === f.x && sy === f.y) hit = true; } : () => {}, set: () => true })); } catch (e) { /* a live painter that needs a real context */ } return hit; }); if (!it) return null;
    let tx = 0, ty = 0, dst = null; it.fn(new Proxy({}, { get: (_, k) => k === 'translate' ? (a, b) => { tx += a; ty += b; } : k === 'drawImage' ? (img, sx, sy, sw, sh, dx, dy) => { if (sx === window.__frame.x && sy === window.__frame.y) dst = [dx + tx, dy + ty]; } : () => {}, set: () => true })); return dst; })()`;
  await js(`fetch('/art/office/atlas.json').then(r => r.json()).then(a => { window.__frame = a.frames['recycling-bin']; })`); await wait(300);
  const d0 = await js(where), from = await P(475, 625), to = await P(535, 625);
  const m = (type, [x, y]) => w.webContents.sendInputEvent({ type, x, y, button: 'left', clickCount: 1 });
  m('mouseMove', from); m('mouseDown', from); await wait(60);
  let mid = null;
  for (let i = 1; i <= 8; i++) { m('mouseMove', [Math.round(from[0] + (to[0] - from[0]) * i / 8), Math.round(from[1] + (to[1] - from[1]) * i / 8)]); await wait(60); if (i === 4) { mid = await js(where); await save('drag'); } }
  const end = await js(where);
  m('mouseUp', to); await wait(400);
  const half = [(to[0] - from[0]) / 2, (to[1] - from[1]) / 2], full = [to[0] - from[0], to[1] - from[1]], near = (a, b, tol) => Math.abs(a[0] - b[0]) <= tol && Math.abs(a[1] - b[1]) <= tol;
  const k = await js(`document.querySelector('canvas').getBoundingClientRect().width / 1480`); // stage px -> client px
  const rel = q => q && [(q[0] - d0[0]) * k, (q[1] - d0[1]) * k];
  check('mid-drag the bin sprite moved with the cursor (10-unit snap)', !!(d0 && mid && near(rel(mid), half, 8)), { start: d0, mid: rel(mid).map(Math.round), cursor: half });
  check('at the release point the sprite sits under the cursor', !!(end && near(rel(end), full, 8)), { end: rel(end).map(Math.round), cursor: full });
  const after = await js(where);
  check('after the drop the bin stays where released', !!(after && near(rel(after), full, 8)), rel(after).map(Math.round));
  check('the dropped sprite lands on whole pixels', !!(after && after.every(v => Math.abs(v - Math.round(v)) < 0.01)), after);
  await btn('Done'); await wait(300); // the drop is not saved: the next load is the saved layout

  // 4. atlas.png blocked: placeholder boxes and one console note, never an empty office
  session.defaultSession.webRequest.onBeforeRequest((d, cb) => cb({ cancel: /\/art\/office\/atlas\.png/.test(d.url) }));
  msgs.length = 0;
  await w.loadURL(base + '/').catch(() => w.loadURL(base + '/')); // a page dialog about the unsaved drop can abort the first load
  check('office boots without the atlas', await ready(false));
  await wait(500);
  const notes = msgs.filter(x => /Office art not loaded, drawing placeholder boxes instead/.test(x.text));
  check('one console note about the placeholder boxes', notes.length === 1, notes.map(x => x.text));
  const fb = await js(`(() => { const c = document.querySelector('canvas'), g = c.getContext('2d'), d = g.getImageData(0, 0, c.width, c.height).data; let n = 0; for (let i = 3; i < d.length; i += 4 * 16) if (d[i] > 0) n++; return { opaque16: n, items: OfficeFurniture.items.length }; })()`);
  check('the office still renders (furniture and floor drawn)', fb.opaque16 > 10000 && fb.items > 100, fb);
  await save('fallback');
  const errs = msgs.filter(x => x.level === 'error' && !/atlas\.png|ERR_BLOCKED_BY_CLIENT/.test(x.text));
  check('no console errors besides the blocked request', errs.length === 0, errs);

  console.log(failed ? 'FAILED ' + failed : 'ALL PASSED');
  done(failed ? 1 : 0);
}).catch(e => { console.log('FAIL ' + e.stack); done(1); });
