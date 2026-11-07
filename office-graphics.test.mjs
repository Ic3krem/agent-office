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
function mounted() {
  let now = 0, timers = [], rafs = [];
  const on = () => { };
  const doc = { createElement: () => ({ width: 0, height: 0, getContext: () => logCtx([]) }), addEventListener: on, documentElement: { dataset: {} }, hidden: false, hasFocus: () => true };
  const w = loadWorld({
    extra: ['office-world.js'],
    globals: {
      OfficeSprites: { lookOf: () => ({}), W: 18, H: 26, get: () => ({ cv: {}, w: 18, h: 26 }) },
      performance: { now: () => now }, addEventListener: on, devicePixelRatio: 1,
      setTimeout: (fn, ms) => { timers.push({ fn, at: now + ms }); return timers.length; }, clearTimeout: () => { timers = []; },
      requestAnimationFrame: fn => { rafs.push(fn); return rafs.length; }, cancelAnimationFrame: () => { rafs = []; },
    },
  });
  w.document = doc;
  const cv = { width: 0, height: 0, getContext: () => logCtx([]), addEventListener: on, getBoundingClientRect: () => ({ left: 0, top: 0, width: 1, height: 1 }) };
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
  return { w, OW, run };
}

const G = (o = {}) => ({ renderScale: 1, fps: 30, ambientFps: 30, shadows: 'blob', ambient: 'all', lighting: 'glow', renderer: 'canvas', ...o });

test('shadows off: no contact ellipse under a chair; soft draws the shadow sheet under the sprite', () => {
  const w = loadWorld(), F = w.OfficeFurniture;
  F.useAtlas({ image: 'COLOUR', shadow: 'SHADOW', frames: { 'guest-chair': { x: 0, y: 0, w: 10, h: 10, ax: 5, ay: 9 } } });
  const chair = F.items.filter(it => it.fn); // only the guest chair has a frame, so only it gets a contact shadow
  const paint = () => { const log = []; const g = logCtx(log); for (const it of chair) it.fn(g); return log; };
  const contact = log => log.filter(e => e[0] === 'ellipse' && e[1] === 'rgba(10,5,20,.25)').length;
  const sheet = (log, s) => log.filter(e => e[0] === 'img' && e[1] === s).length;
  let log = paint();
  assert.ok(contact(log) >= 1, 'default (blob): the chair has its contact shadow');
  assert.equal(sheet(log, 'SHADOW'), 0, 'default: no shadow sheet');
  F.state.shadows = 'off'; log = paint();
  assert.equal(contact(log), 0, 'off: no contact ellipse');
  assert.ok(sheet(log, 'COLOUR') >= 1, 'the chair itself still draws');
  F.state.shadows = 'soft'; log = paint();
  assert.ok(contact(log) >= 1 && sheet(log, 'SHADOW') >= 1, 'soft: contact shadow and the shadow sheet');
  const i = log.findIndex(e => e[0] === 'img' && e[1] === 'SHADOW'); assert.equal(log[i + 1][1], 'COLOUR', 'the shadow frame goes right under its sprite');
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
