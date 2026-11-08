// Town step 4: the office page and the interiors honour the graphics settings (shadows, lighting, fps cap).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ROSTER, MANAGER } from './company.mjs';
import { loadWorld } from './world-vm.mjs';

// A 2D context that swallows everything and logs ellipse fills (with their colour) and drawImage sources.
function logCtx(log) {
  const st = {};
  const p = new Proxy(function () { }, {
    get: (_, k) => {
      if (k in st) return st[k];
      if (k === 'ellipse') return () => log.push(['ellipse', st.fillStyle]);
      if (k === 'drawImage') return img => log.push(['img', img]);
      if (k === 'measureText') return () => ({ width: 10 });
      if (k === 'getImageData') return (x, y, w, h) => ({ data: new Uint8ClampedArray(w * h * 4) });
      return p;
    },
    set: (_, k, v) => { st[k] = v; return true; }, apply: () => p,
  });
  return p;
}

// The office page mounted in a vm with a fake clock and fake timers: step() runs the next scheduled frame.
function mounted(dpr = 1, log = []) {
  let now = 0, timers = [], rafs = [];
  const on = () => { };
  const doc = { createElement: () => ({ width: 0, height: 0, getContext: () => logCtx([]) }), addEventListener: on, documentElement: { dataset: {} }, hidden: false, hasFocus: () => true };
  const w = loadWorld({
    extra: ['office-world.js'],
    globals: {
      OfficeSprites: { lookOf: () => ({}), W: 18, H: 26, get: () => ({ cv: {}, w: 18, h: 26 }) },
      performance: { now: () => now }, addEventListener: on, devicePixelRatio: dpr,
      setTimeout: (fn, ms) => { timers.push({ fn, at: now + ms }); return timers.length; }, clearTimeout: () => { timers = []; },
      requestAnimationFrame: fn => { rafs.push(fn); return rafs.length; }, cancelAnimationFrame: () => { rafs = []; },
    },
  });
  w.document = doc;
  const cv = { width: 0, height: 0, style: {}, getContext: () => logCtx(log), addEventListener: on, getBoundingClientRect: () => ({ left: 0, top: 0, width: 1, height: 1 }) };
  const OW = w.OfficeWorld;
  OW.mount(cv, {});
  const prof = key => ({ key, ...Object.fromEntries(['name', 'role', 'color', 'accent', 'desk'].map(k => [k, ROSTER[key][k]])) });
  const agents = Object.keys(ROSTER).filter(k => ROSTER[k].desk).map(k => ({ id: 'a-' + k, name: ROSTER[k].name, role: 'Helper', profile: prof(k), model: 'sonnet', status: 'working', task: 't', logs: [], perm: null }));
  agents.push({ id: 'a-tiro', isManager: true, name: 'Tiro', role: 'Manager', profile: MANAGER, model: 'sonnet', status: 'working', task: '', logs: [], perm: null });
  const snap = list => OW.setSnapshot({ agents: list, goals: [{ id: 'g', text: 'g', status: 'doing', at: Date.now() }], boss: { active: true, running: 8, max: 8 } });
  snap(agents.slice(-1)); // Tiro first; the team then arrives at the door and walks to the desks
  let joined = false;
  // frames drawn in ms of simulated time, following the page's own scheduler
  const run = ms => {
    if (!joined) { joined = true; for (let i = 0; i < 20 && rafs.length + timers.length; i++) { const f = rafs.shift(); if (f) f(now); else { const t = timers.shift(); now = Math.max(now, t.at); t.fn(); } } snap(agents); }
    const end = now + ms, d0 = OW.framesDrawn(); let walked = false;
    while (now < end) {
      if (rafs.length) { const f = rafs.shift(); f(now); if ((OW.debug() || { agents: [] }).agents.some(a => a.moving)) walked = true; continue; }
      if (!timers.length) break;
      const t = timers.shift(); now = Math.max(now, t.at); t.fn();
    }
    return { n: OW.framesDrawn() - d0, walked };
  };
  return { w, OW, run, cv };
}

const G = (o = {}) => ({ renderScale: 1, fps: 30, ambientFps: 30, shadows: 'blob', ambient: 'all', lighting: 'glow', renderer: 'canvas', ...o });

const FRAMES = { 'guest-chair': { x: 0, y: 0, w: 10, h: 10, ax: 5, ay: 9 }, tires: { x: 10, y: 0, w: 10, h: 10, ax: 5, ay: 9 } };
const sheet = (log, s) => log.filter(e => e[0] === 'img' && e[1] === s).length;

test('shadows off: no contact ellipse under a chair; soft draws the shadow sheet in its own pass, not in the piece', () => {
  const w = loadWorld(), F = w.OfficeFurniture;
  F.useAtlas({ image: 'COLOUR', shadow: 'SHADOW', frames: { 'guest-chair': FRAMES['guest-chair'] } });
  const chair = F.items.filter(it => it.fn); // only the guest chair has a frame, so only it gets a contact shadow
  const paint = () => { const log = []; const g = logCtx(log); for (const it of chair) it.fn(g); return log; };
  const pass = () => { const log = []; F.shadowPass(logCtx(log)); return log; };
  const contact = log => log.filter(e => e[0] === 'ellipse' && e[1] === 'rgba(10,5,20,.25)').length;
  let log = paint();
  assert.ok(contact(log) >= 1, 'default (blob): the chair has its contact shadow');
  assert.equal(sheet(log, 'SHADOW') + sheet(pass(), 'SHADOW'), 0, 'default: no shadow sheet');
  F.state.shadows = 'off'; log = paint();
  assert.equal(contact(log), 0, 'off: no contact ellipse');
  assert.ok(sheet(log, 'COLOUR') >= 1, 'the chair itself still draws');
  assert.equal(pass().length, 0, 'off: the shadow pass draws nothing');
  F.state.shadows = 'soft'; log = paint();
  assert.ok(contact(log) >= 1, 'soft: the contact shadow stays with the piece');
  assert.equal(sheet(log, 'SHADOW'), 0, 'soft: the piece no longer draws its shadow frame in its depth slot');
  const p = pass();
  assert.ok(sheet(p, 'SHADOW') >= 1, 'soft: the shadow pass draws the guest chair shadow frames');
  assert.equal(sheet(p, 'SHADOW'), p.length, 'the shadow pass draws only shadow frames (no colour, contact or placeholder)');
});

test('soft shadows go down in one pass before every piece: a shadow never darkens an earlier piece', () => {
  const log = [], { w, OW } = mounted(1, log), F = w.OfficeFurniture;
  F.useAtlas({ image: 'COLOUR', shadow: 'SHADOW', frames: FRAMES });
  OW.setGraphics(G({ shadows: 'soft' })); OW.setHour(12); OW.render(); log.length = 0; OW.render();
  const idx = name => log.map((e, i) => e[0] === 'img' && e[1] === name ? i : -1).filter(i => i >= 0);
  const sh = idx('SHADOW'), col = idx('COLOUR');
  assert.ok(sh.length >= 2 && col.length >= 2, 'both pieces draw a shadow and a sprite: ' + sh.length + '/' + col.length);
  assert.ok(Math.max(...sh) < Math.min(...col), 'every shadow frame before the first sprite');
});

test("'tint' shadows take the time-of-day tint (as the town's); 'soft' and daytime 'tint' use the plain sheet", () => {
  const log = [], { w, OW } = mounted(1, log), F = w.OfficeFurniture;
  const SHEET = { width: 20, height: 10, sheet: true };
  F.useAtlas({ image: 'COLOUR', shadow: SHEET, frames: FRAMES });
  const shadowImgs = () => { OW.render(); const out = []; F.shadowPass(logCtx(out)); return out.filter(e => e[0] === 'img').map(e => e[1]); };
  OW.setGraphics(G({ shadows: 'soft' })); OW.setHour(22);
  const soft = shadowImgs();
  assert.ok(soft.length >= 2 && soft.every(s => s === SHEET), 'soft at night: the plain shadow sheet');
  OW.setGraphics(G({ shadows: 'tint' })); OW.setHour(12);
  assert.ok(shadowImgs().every(s => s === SHEET), 'tint at noon: the tint is white, the plain sheet');
  OW.setHour(22);
  const night = shadowImgs();
  assert.ok(night.length >= 2 && night.every(s => s !== SHEET && s.width === 20 && s.height === 10), 'tint at night: a tinted copy of the sheet');
  assert.equal(shadowImgs()[0], night[0], 'the tinted copy is cached while the tint holds');
});

test('ambient off: an idle office stops its loops (fan, fire, screens); on, idle keeps the saver cadence or the ambient fps', () => {
  const M = loadWorld().OfficeMotion;
  const st = o => M.nextFrameDelay({ hidden: false, reduced: false, dirty: false, interactMs: 1e9, moving: false, active: false, blurred: false, ...o });
  assert.equal(st({ saver: true, fps: 15, ambient: 'off', ambientFps: 8 }), M.FRAME.STILL, 'saver on, ambient off: still');
  assert.equal(st({ saver: false, fps: 15, ambient: 'off', ambientFps: 15 }), M.FRAME.STILL, 'saver off, ambient off: still');
  assert.ok(M.FRAME.STILL >= 60000, 'still = the wall clock minute only');
  assert.equal(st({ saver: true, fps: 30, ambient: 'all', ambientFps: 8 }), M.FRAME.IDLE, 'saver on: the idle cadence');
  assert.equal(st({ saver: false, fps: 30, ambient: 'all', ambientFps: 15 }), 67, 'saver off: the ambient fps');
  assert.equal(st({ saver: false, fps: 30, ambient: 'water', ambientFps: 30 }), 33, 'saver off: the flat rate');
  // characters and input are not ambient: they keep their cadence with ambient off
  assert.equal(st({ saver: true, fps: 15, ambient: 'off', active: true }), M.FRAME.WORK);
  assert.equal(st({ saver: true, fps: 15, ambient: 'off', moving: true }), 67);
  assert.equal(st({ saver: true, fps: 30, ambient: 'off', interactMs: 0 }), 33);
  assert.equal(st({ saver: false, fps: 15, ambient: 'off', moving: true }), 67);
  assert.equal(st({ saver: false, fps: 15, ambient: 'off', interactMs: 0 }), 67);
  assert.equal(st({ reduced: true, ambient: 'off' }), 500, 'reduced motion unchanged');
  assert.equal(st({ saver: true }), M.FRAME.IDLE, 'no graphics settings: unchanged');
  assert.equal(st({ saver: false }), M.FRAME.SMOOTH, 'no graphics settings, saver off: unchanged');
});

test('the page passes ambient and its fps to the scheduler', () => {
  const { OW } = mounted();
  OW.setGraphics(G({ ambient: 'off' }));
  assert.equal(OW.frameState().ambient, 'off');
  OW.setGraphics(G({ ambient: 'all', ambientFps: 8 }));
  assert.equal(OW.frameState().ambient, 'all');
  assert.equal(OW.frameState().ambientFps, 8);
});

test('lighting off at hour 22: night is 0; default lighting keeps the night', () => {
  const { w, OW } = mounted(), F = w.OfficeFurniture;
  OW.setHour(22); OW.render();
  assert.equal(F.state.night, 1, 'default: full night at 22:00');
  OW.setGraphics(G({ lighting: 'off' })); OW.render();
  assert.equal(F.state.night, 0);
  assert.equal(OW.graphics().lighting, 'off');
  OW.setGraphics(G({ lighting: 'tint' })); OW.render();
  assert.equal(F.state.night, 1, 'tint keeps the night tint');
});

test('fps cap: 15 caps the walking cadence with power saver off; 60 raises it; saver keeps 30', () => {
  const { OW, run } = mounted();
  OW.setPowerSaver(false);
  OW.setGraphics(G({ fps: 15 }));
  run(100);
  let r = run(1000); assert.ok(r.walked, 'agents are walking');
  assert.ok(r.n <= 15 && r.n >= 12, 'fps 15: frames per simulated second ' + r.n);
  OW.setGraphics(G({ fps: 60 })); run(100);
  r = run(1000); assert.ok(r.walked && r.n >= 50 && r.n <= 61, 'fps 60 with saver off: ' + r.n);
  OW.setGraphics(G({ fps: 30 })); run(100);
  r = run(1000); assert.ok(r.n >= 25 && r.n <= 31, 'fps 30: ' + r.n);
  OW.setPowerSaver(true); OW.setGraphics(G({ fps: 60 })); run(100);
  r = run(1000); assert.ok(r.walked && r.n >= 25 && r.n <= 31, 'saver on keeps its 30 fps moving cadence at fps 60: ' + r.n);
});

test('render scale at dpr 2: Low halves the backing store, High and Ultra stay native (no supersampling); pixelated only below 1x', () => {
  const { OW, cv } = mounted(2);
  OW.setScale(1);
  const at = g => { OW.setGraphics(G(g)); return [cv.width / 1480, cv.style.imageRendering]; };
  assert.deepEqual(at({ renderScale: .5 }), [1, 'pixelated'], 'Low: 0.5 x 2');
  assert.deepEqual(at({ renderScale: .75 }), [2, ''], 'Medium: 0.75 snaps to 1 (whole device pixels per canvas pixel)');
  assert.deepEqual(at({ renderScale: 1 }), [2, ''], 'High: native');
  assert.deepEqual(at({ renderScale: 2 }), [2, ''], 'Ultra: native too, not 3');
});

test('below 1x the canvas pixel is a whole number of device pixels, at any stage scale and dpr', () => {
  for (const dpr of [1, 1.25, 1.5, 2]) {
    const { OW, cv } = mounted(dpr);
    for (const s of [.6, .8, 1, 1.3]) {
      OW.setScale(s);
      for (const [rs, k] of [[.5, 2], [.75, 1], [.6, 2], [.3, 3]]) {
        OW.setGraphics(G({ renderScale: rs }));
        const dev = s * dpr; if (dev < 1 || dev > 3) continue; // outside the clamp the canvas is 1x or 3x the stage
        const ratio = dev / (cv.width / 1480);
        if (k > 1) assert.ok(Math.abs(ratio - k) < .01, `dpr ${dpr} scale ${s} renderScale ${rs}: ${ratio.toFixed(3)} device px per canvas px, want ${k}`);
        assert.equal(cv.style.imageRendering, k > 1 ? 'pixelated' : ''); // k 1: native and smooth, as High
      }
    }
  }
});

test('atlas sheets load as fetch -> blob -> createImageBitmap, with the <img> fallback', async () => {
  const run = async bitmapOk => {
    const imgs = [];
    let atlas = null;
    const later = fn => Promise.resolve().then(fn);
    const w = loadWorld({
      extra: ['office-world.js'],
      globals: {
        OfficeSprites: { lookOf: () => ({}), W: 18, H: 26, get: () => ({ cv: {}, w: 18, h: 26 }) },
        performance: { now: () => 0 }, addEventListener: () => { }, devicePixelRatio: 1, setTimeout: () => 0, clearTimeout: () => { }, requestAnimationFrame: () => 0, cancelAnimationFrame: () => { },
        fetch: async url => url.endsWith('.json') ? { ok: true, json: async () => ({ frames: {} }) } : { ok: true, blob: async () => ({ blob: url }) },
        createImageBitmap: async src => { if (!bitmapOk && src.blob) throw new Error('no decode'); return { bitmap: src.blob || src.src }; },
        Image: class { set src(v) { this._src = v; imgs.push(v); later(() => this.onload()); } get src() { return this._src; } },
      },
    });
    w.document = { createElement: () => ({ width: 0, height: 0, getContext: () => logCtx([]) }), addEventListener: () => { }, documentElement: { dataset: {} }, hidden: false, hasFocus: () => true };
    w.OfficeFurniture.useAtlas = a => { atlas = a; };
    w.OfficeWorld.mount({ width: 0, height: 0, style: {}, getContext: () => logCtx([]), addEventListener: () => { }, getBoundingClientRect: () => ({ left: 0, top: 0, width: 1, height: 1 }) }, {});
    for (let i = 0; i < 100 && !atlas; i++) await new Promise(r => setImmediate(r));
    return { atlas, imgs };
  };
  const sheets = ['/art/office/atlas.png', '/art/office/atlas-glow.png', '/art/office/atlas-shadow.png'];
  const ok = await run(true);
  assert.ok(ok.atlas, 'the atlas registered');
  assert.deepEqual(ok.imgs, [], 'no <img> decode when createImageBitmap takes the blob');
  assert.deepEqual(['image', 'glow', 'shadow'].map(k => ok.atlas[k] && ok.atlas[k].bitmap), sheets);
  const fb = await run(false);
  assert.ok(fb.atlas, 'the atlas registered through the fallback');
  assert.deepEqual(fb.imgs, sheets, 'blob decode failed: each sheet loads through an <img>');
  assert.deepEqual(['image', 'glow', 'shadow'].map(k => fb.atlas[k] && fb.atlas[k].bitmap), sheets, 'and is still made an ImageBitmap from the <img>');
});

test('ambient off, empty office: no frames while still, but the simulation clock keeps going', () => {
  const { OW, run } = mounted();
  OW.setPowerSaver(true); run(100);
  OW.setSnapshot({ agents: [], goals: [], boss: { active: false, running: 0, max: 8 } });
  OW.setGraphics(G({ ambient: 'off' })); run(30000); // the lights dim and settle
  const c0 = OW.debug().clock, r = run(120000), c1 = OW.debug().clock;
  assert.ok(r.n <= 3, 'frames in 2 still minutes (the wall clock minute only): ' + r.n);
  assert.ok(c1 - c0 >= 110000, 'simulated ms over those 2 minutes: ' + (c1 - c0));
  OW.setGraphics(G({ ambient: 'all' })); run(1000);
  assert.ok(run(10000).n >= 15, 'ambient on: the idle cadence again');
});
