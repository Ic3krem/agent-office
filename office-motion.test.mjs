import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { ROSTER, MANAGER } from './company.mjs';

// The module is a classic browser script: load it the way the page does.
const ctx = {}; ctx.globalThis = ctx;
vm.runInNewContext(fs.readFileSync(new URL('./public/office-motion.js', import.meta.url), 'utf8'), ctx);
const M = ctx.OfficeMotion, S = M.S;

const prof = key => ({ key, ...Object.fromEntries(['name', 'role', 'color', 'accent', 'desk'].map(k => [k, ROSTER[key][k]])) });
const ag = (key, status = 'idle', extra = {}) => ({ id: 'a-' + key, name: ROSTER[key].name, role: 'Helper', profile: prof(key), model: 'sonnet', status, task: status === 'idle' ? '' : 't', logs: [{ t: '10:00:00', k: 'out', text: 'x' }], perm: null, ...extra });
const tiro = (status = 'idle', extra = {}) => ({ id: 'a-tiro', isManager: true, name: 'Tiro', role: 'Manager', profile: MANAGER, model: 'sonnet', status, task: '', logs: [{ t: '10:00:00', k: 'sys', text: 'hi' }], perm: null, ...extra });
const goal = (id, status, extra = {}) => ({ id, text: id, status, at: Date.now(), ...extra });
const snap = (agents, goals = [], running = 0) => ({ agents, goals, boss: { active: true, running, max: 8 } });
const find = (f, id) => f.agents.find(a => a.id === id);

test('display roster matches ROSTER in company.mjs', () => {
  assert.equal(M.TEAM.length, 8);
  for (const t of M.TEAM) {
    const r = ROSTER[t.key];
    assert.ok(r, t.key);
    assert.deepEqual([t.name, t.role, t.model, t.color, t.accent, t.desk], [r.name, r.role, r.model, r.color, r.accent, r.desk]);
  }
  assert.deepEqual([M.TIRO.name, M.TIRO.color, M.TIRO.accent, M.TIRO.desk], [MANAGER.name, MANAGER.color, MANAGER.accent, MANAGER.desk]);
});

test('every spot is reachable and a path never cuts across a desk', () => {
  const ids = Object.keys(M.SPOTS);
  assert.ok(ids.length > 40);
  const inside = (p, r) => p.x > r.x0 + 2 && p.x < r.x1 - 2 && p.y > r.y0 + 2 && p.y < r.y1 - 2;
  for (const a of ['desk-1', 'desk-8', 'tiro:seat', 'garden:b2', 'play:pit', 'cool:1', 'hot:4', 'queue:1']) {
    for (const b of ids) {
      const p = M.pathTo(a, b);
      assert.ok(p.length >= 1, a + ' -> ' + b);
      assert.ok(Math.hypot(p[p.length - 1].x - M.SPOTS[b].x, p[p.length - 1].y - M.SPOTS[b].y) < 1, 'ends on the spot ' + b);
      for (let i = 1; i < p.length; i++) for (let k = 0; k <= 20; k++) {
        const q = { x: p[i - 1].x + (p[i].x - p[i - 1].x) * k / 20, y: p[i - 1].y + (p[i].y - p[i - 1].y) * k / 20 };
        assert.ok(!M.OBSTACLES.some(r => inside(q, r)), `${a} -> ${b} crosses a desk at ${Math.round(q.x)},${Math.round(q.y)}`);
      }
    }
  }
});

test('pathTo from a free point joins the nearest corridor', () => {
  const p = M.pathTo({ x: 300, y: 396 }, 'desk-1');
  assert.ok(p.length >= 2 && p.length < 6);
  assert.equal(Math.round(p[p.length - 1].x), 155);
});

test('walker reaches the target facing the spot, within the 6 s budget, without teleporting', () => {
  const w = M.createWalker('x', 30, 568, 's');
  M.setTarget(w, 'garden:b1');
  let t = 0, maxJump = 0, px = w.x, py = w.y, sawFade = false;
  while ((w.moving || w.fadeDir) && t < 8) { M.stepWalker(w, 1 / 60, []); t += 1 / 60; maxJump = Math.max(maxJump, Math.hypot(w.x - px, w.y - py)); px = w.x; py = w.y; if (w.fadeDir) sawFade = true; }
  assert.ok(!sawFade, 'no fade fallback on a free route');
  assert.ok(t <= 6, 'took ' + t);
  assert.ok(maxJump < 5, 'smooth steps ' + maxJump);
  assert.ok(M.arrivedAt(w, 'garden:b1'));
  assert.equal(w.face, M.SPOTS['garden:b1'].face);
});

test('walker faces its direction of travel', () => {
  assert.equal(M.faceOf(5, 0), 'e'); assert.equal(M.faceOf(-5, 1), 'w'); assert.equal(M.faceOf(0, 5), 's'); assert.equal(M.faceOf(1, -9), 'n');
});

test('a blocked walker waits, then slips past; it never freezes forever', () => {
  const a = M.createWalker('a', 30, 396, 'e'), b = M.createWalker('b', 60, 396, 'e');
  M.setTarget(a, 'a270');
  let waited = false, t = 0;
  while (a.moving && t < 6) { const x0 = a.x; M.stepWalker(a, 1 / 60, [b]); if (a.x === x0 && a.moving) waited = true; t += 1 / 60; }
  assert.ok(waited, 'waited behind b');
  assert.ok(!a.moving || a.fadeDir || t >= 6);
});

test('a walker that cannot finish in 6 s fades to its target instead of walking on', () => {
  const a = M.createWalker('a', 30, 396, 'e'), b = M.createWalker('b', 60, 396, 'e'), c = M.createWalker('c', 61, 396, 'e');
  M.setTarget(a, 'play:pit');
  let t = 0; a.speed = 20; // crawling
  while ((a.moving || a.fadeDir) && t < 10) { M.stepWalker(a, 1 / 60, [b, c]); t += 1 / 60; }
  assert.ok(M.arrivedAt(a, 'play:pit'));
  assert.ok(t < 7.5);
});

test('nextState: rules 1 to 9', () => {
  const board = (o = {}) => ({ open: 1, running: 0, workingN: 0, empty: false, emptyFor: 0, ...o });
  const A = (o = {}) => ({ isManager: false, status: 'working', perm: null, quietMs: 0, toolInFlight: false, prev: null, prevSince: 0, first: false, ...o });
  assert.equal(M.nextState(A(), board(), 0), S.DESK);                                                  // 1 working at desk
  assert.equal(M.nextState(A({ quietMs: 7000 }), board(), 0), S.THINK);                                // 2 thinking in the garden
  assert.equal(M.nextState(A({ quietMs: 7000, toolInFlight: true }), board(), 0), S.DESK);             // a tool call in flight is not thinking
  assert.equal(M.nextState(A({ quietMs: 7000 }), board({ open: 0 }), 0), S.DESK);                      // only while the board is non-empty
  assert.equal(M.nextState(A({ quietMs: 100, prev: S.THINK, prevSince: 0 }), board(), 5000), S.DESK);  // tool call resumes -> back
  assert.equal(M.nextState(A({ quietMs: 100, prev: S.THINK, prevSince: 4000 }), board(), 5000), S.THINK); // 3 s dwell holds it
  assert.equal(M.nextState(A({ quietMs: 4000, prev: S.THINK, prevSince: 0 }), board(), 9000), S.THINK); // inside the hysteresis band
  assert.equal(M.nextState(A({ status: 'idle' }), board(), 0), S.IDLE_DESK);                           // 3 idle with open goals stays
  const empty = board({ open: 0, empty: true });
  assert.equal(M.nextState(A({ status: 'idle' }), { ...empty, emptyFor: 5000 }, 0), S.IDLE_DESK);      // 4 waits 20 s
  assert.equal(M.nextState(A({ status: 'idle' }), { ...empty, emptyFor: 21000 }, 0), S.PLAY);
  assert.equal(M.nextState(A({ status: 'idle', first: true }), empty, 0), S.PLAY);                     // a reload does not wait
  assert.equal(M.nextState(A({ status: 'blocked' }), board(), 0), S.BLOCKED);                          // 6
  assert.equal(M.nextState(A({ status: 'working', perm: { askId: 'q' } }), board(), 0), S.BLOCKED);
  assert.equal(M.nextState(A({ status: 'limited' }), board(), 0), S.COOLER);                           // 7
  assert.equal(M.nextState(A({ status: 'error' }), board(), 0), S.ERROR);
  assert.equal(M.nextState(A({ isManager: true, status: 'idle' }), { ...empty, emptyFor: 99999 }, 0), S.WINDOW); // 9 Tiro never plays
  assert.equal(M.nextState(A({ isManager: true, status: 'working', quietMs: 8000 }), empty, 0), S.THINK);        // Tiro plans: window
  assert.equal(M.nextState(A({ isManager: true, status: 'idle' }), board(), 0), S.IDLE_DESK);
});

test('brain: empty board puts everyone in the playroom, a new goal sends them back, Tiro stays out', () => {
  const b = M.createBrain({ wall: () => 1e12 });
  const team = ['pixel', 'forge', 'warden', 'probe', 'atlas', 'cabalan', 'tally', 'scribe'].map(k => ag(k, 'idle'));
  let f = b.update(snap([tiro('idle'), ...team], []), 1000);
  for (const a of f.agents.filter(a => !a.isManager)) assert.equal(a.state, S.PLAY, a.name);
  assert.equal(find(f, 'a-tiro').state, S.WINDOW);
  assert.equal(new Set(f.agents.filter(a => !a.isManager).map(a => a.spot)).size, 8, 'distinct play spots');
  f = b.update(snap([tiro('working'), ...team], [goal('g1', 'todo')]), 2000);
  for (const a of f.agents.filter(a => !a.isManager)) { assert.equal(a.state, S.IDLE_DESK); assert.equal(a.spot, ROSTER[a.key].desk); }
  assert.equal(find(f, 'a-tiro').spot, 'tiro:seat');
});

test('brain: agents placed in the playroom at load stay there while the board stays empty', () => {
  const b = M.createBrain({ wall: () => 1e12 });
  const s = () => snap([tiro('idle'), ag('pixel', 'idle'), ag('forge', 'idle')], []);
  let f = b.update(s(), 0);
  assert.equal(find(f, 'a-pixel').state, S.PLAY);
  for (const t of [500, 1000, 2000, 5000, 30000]) { f = b.update(s(), t); assert.equal(find(f, 'a-pixel').state, S.PLAY, 'still playing at ' + t); }
});

test('brain: idle waits 20 s after the board empties, working sends the agent to its own desk', () => {
  const b = M.createBrain({ wall: () => 1e12 });
  const team = [ag('pixel', 'working'), ag('forge', 'idle')];
  let f = b.update(snap([tiro('idle'), ...team], [goal('g1', 'doing')], 1), 0);
  f = b.update(snap([tiro('idle'), ag('pixel', 'idle'), ag('forge', 'idle')], [goal('g1', 'dismissed')]), 1000);
  assert.equal(find(f, 'a-pixel').state, S.IDLE_DESK);
  f = b.update(snap([tiro('idle'), ag('pixel', 'idle'), ag('forge', 'idle')], [goal('g1', 'dismissed')]), 22000);
  assert.equal(find(f, 'a-pixel').state, S.PLAY);
  f = b.update(snap([tiro('idle'), ag('pixel', 'working'), ag('forge', 'idle')], [goal('g1', 'dismissed')]), 23000);
  assert.equal(find(f, 'a-pixel').state, S.DESK);
  assert.equal(find(f, 'a-pixel').spot, 'desk-1');
  assert.equal(find(f, 'a-pixel').pose, 'type');
});

test('brain: working with no events for 6 s thinks in the garden, an event brings it back', () => {
  const b = M.createBrain({ wall: () => 1e12 });
  const mk = (txt, extra) => snap([tiro('working'), ag('atlas', 'working', { logs: [{ t: '10:00:00', k: 'out', text: txt }], ...(extra || {}) })], [goal('g1', 'doing')], 1);
  let f = b.update(mk('a'), 0);
  assert.equal(find(f, 'a-atlas').state, S.DESK);
  f = b.update(mk('a'), 5000); assert.equal(find(f, 'a-atlas').state, S.DESK);
  f = b.update(mk('a'), 7000);
  const g = find(f, 'a-atlas'); assert.equal(g.state, S.THINK); assert.ok(g.spot.startsWith('garden:')); assert.ok(['think', 'sit-think'].includes(g.pose));
  f = b.update(mk('b'), 11000); // new event, past the 3 s dwell
  assert.equal(find(f, 'a-atlas').state, S.DESK);
  f = b.update(mk('b', { logs: [{ t: '10:00:01', k: 'tool', text: 'Read: x' }] }), 30000);
  assert.equal(find(f, 'a-atlas').state, S.DESK, 'a tool call in flight is not thinking');
});

test('brain: blocked and error stay seated with a badge, limited goes to the cooler', () => {
  const b = M.createBrain({ wall: () => 1e12 });
  const f = b.update(snap([tiro('working'), ag('forge', 'blocked', { perm: { askId: 'q', short: 'Bash', cmd: 'x' } }), ag('probe', 'error', { errText: 'boom' }), ag('tally', 'limited')], [goal('g1', 'doing')], 3), 0);
  const fo = find(f, 'a-forge'), pr = find(f, 'a-probe'), ta = find(f, 'a-tally');
  assert.deepEqual([fo.state, fo.spot, fo.badge, fo.pose], [S.BLOCKED, 'desk-2', 'perm', 'hand']);
  assert.deepEqual([pr.state, pr.spot, pr.badge], [S.ERROR, 'desk-4', 'error']);
  assert.deepEqual([ta.state, ta.badge], [S.COOLER, 'limited']); assert.ok(ta.spot.startsWith('cool:'));
});

test('brain: a finished goal produces exactly one walk to the office and back', () => {
  const b = M.createBrain({ wall: () => 1e12 });
  const team = (forge) => [tiro('working'), ag('pixel', 'working'), forge];
  const forgeBusy = ag('forge', 'working');
  let t = 0, arrived = false;
  const run = (goals, forge, ms) => { t += ms; return b.update(snap(team(forge), goals, 2), t, { arrived: (id, s) => arrived && s === 'office:report' }); };
  run([goal('g1', 'doing')], forgeBusy, 0);
  const done = [goal('g1', 'done', { report: 'r.md', at: 1e12 })];
  const forgeDone = ag('forge', 'idle', { logs: [{ t: '10:00:02', k: 'out', text: 'Finished g1 and filed the report' }] });
  let f = run(done, forgeDone, 1000);
  assert.equal(find(f, 'a-forge').state, S.GO); assert.equal(find(f, 'a-forge').spot, 'office:report');
  const seen = [];
  for (let i = 0; i < 60; i++) { arrived = i > 3; f = run(done, forgeDone, 500); seen.push(find(f, 'a-forge').state); }
  assert.equal(seen.filter((s, i) => s === S.REPORT && seen[i - 1] !== S.REPORT).length, 1, 'one report');
  assert.ok(seen.includes(S.BACK));
  assert.equal(find(f, 'a-forge').state, S.IDLE_DESK); assert.equal(find(f, 'a-forge').spot, 'desk-2');
  // Tiro looks up while it happens
  const f2 = (() => { const b2 = M.createBrain({ wall: () => 1e12 }); b2.update(snap(team(forgeBusy), [goal('g1', 'doing')], 2), 0); b2.update(snap(team(forgeDone), done, 2), 100); return b2.update(snap(team(forgeDone), done, 2), 200, { arrived: () => true }); })();
  assert.equal(f2.reporter, 'a-forge'); assert.ok(find(f2, 'a-tiro').lookUp); assert.ok(f2.reportIcon);
});

test('brain: two reporters queue at the door, only one in the office at a time', () => {
  const b = M.createBrain({ wall: () => 1e12 });
  const mk = (st, gs) => snap([tiro('working'), ag('forge', st, { logs: [{ t: '1', k: 'out', text: 'g1 done' }] }), ag('scribe', st, { logs: [{ t: '1', k: 'out', text: 'g2 done' }] })], gs, 2);
  b.update(mk('working', [goal('g1', 'doing'), goal('g2', 'doing')]), 0);
  const gs = [goal('g1', 'done', { report: 'a' }), goal('g2', 'done', { report: 'b' })];
  let f = b.update(mk('idle', gs), 1000, { arrived: () => false });
  const states = f.agents.filter(a => !a.isManager).map(a => a.state).sort();
  assert.deepEqual([...states], [S.QUEUE, S.GO].sort());
  assert.equal(f.agents.filter(a => a.state === S.QUEUE)[0].spot, 'queue:1');
  let t = 1000, peak = 0;
  for (let i = 0; i < 80; i++) { t += 500; f = b.update(mk('idle', gs), t, { arrived: () => true }); peak = Math.max(peak, f.agents.filter(a => a.state === S.REPORT || a.state === S.GO).length); }
  assert.equal(peak, 1);
  assert.ok(f.agents.filter(a => !a.isManager).every(a => a.state === S.IDLE_DESK || a.state === S.PLAY), 'both finished and went home');
});

test('brain: an old finished goal at load does not replay a report', () => {
  const b = M.createBrain({ wall: () => Date.now() });
  const f = b.update(snap([tiro('idle'), ag('forge', 'idle')], [goal('g1', 'done', { report: 'r', at: Date.now() - 3600e3 })]), 0);
  assert.ok(f.agents.every(a => !a.reporting));
  assert.equal(f.reporter, null);
});

test('brain: a goal finished moments before a reload still resumes the walk; reporting never beats working', () => {
  const b = M.createBrain({ wall: () => Date.now() });
  const f = b.update(snap([tiro('working'), ag('forge', 'idle', { logs: [{ t: '1', k: 'out', text: 'g1 filed' }] })], [goal('g1', 'done', { report: 'r', at: Date.now() - 2000 })], 1), 0);
  assert.equal(find(f, 'a-forge').state, S.GO);
  const b2 = M.createBrain({ wall: () => Date.now() });
  const f2 = b2.update(snap([tiro('working'), ag('forge', 'working', { logs: [{ t: '1', k: 'out', text: 'g1 filed' }] })], [goal('g1', 'done', { report: 'r', at: Date.now() })], 1), 0);
  assert.equal(find(f2, 'a-forge').state, S.DESK);
});

test('brain: visitors and duplicate profiles use hot desks, the roster desk stays with its first owner', () => {
  const b = M.createBrain({ wall: () => 1e12 });
  const visitor = { id: 'zz', name: 'General helper', role: 'Helper', model: 'x', status: 'working', task: 't', logs: [], perm: null };
  const dup = { ...ag('forge', 'working'), id: 'b-forge' };
  const f = b.update(snap([tiro('working'), ag('forge', 'working'), dup, visitor], [goal('g1', 'doing')], 3), 0);
  assert.equal(find(f, 'a-forge').spot, 'desk-2'); assert.ok(!find(f, 'a-forge').visitor);
  assert.ok(find(f, 'zz').visitor && M.HOT.includes(find(f, 'zz').spot));
  assert.ok(find(f, 'b-forge').visitor && M.HOT.includes(find(f, 'b-forge').spot));
  assert.notEqual(find(f, 'zz').spot, find(f, 'b-forge').spot);
});

test('brain: newcomers spawn at the door, the first snapshot places everyone directly', () => {
  const b = M.createBrain({ wall: () => 1e12 });
  let f = b.update(snap([tiro('working')], [goal('g1', 'doing')]), 0);
  assert.ok(find(f, 'a-tiro').first && !find(f, 'a-tiro').spawn);
  f = b.update(snap([tiro('working'), ag('pixel', 'working')], [goal('g1', 'doing')]), 1000);
  assert.ok(find(f, 'a-pixel').spawn);
  f = b.update(snap([tiro('working'), ag('pixel', 'working')], [goal('g1', 'doing')]), 2000);
  assert.ok(!find(f, 'a-pixel').spawn);
});

test('demo snapshots cover every state', () => {
  const need = new Set();
  for (const sc of ['work', 'think', 'blocked', 'empty', 'report']) {
    const b = M.createBrain({ wall: () => 1e12 });
    const mkPass = t => b.update(M.demoSnapshot(sc, t), t * 1000, { arrived: () => true });
    let f = mkPass(0);
    for (let t = 1; t <= 40; t += 1) { f = mkPass(t); f.agents.forEach(a => need.add(a.state)); }
  }
  for (const s of [S.DESK, S.THINK, S.BLOCKED, S.ERROR, S.COOLER, S.PLAY, S.IDLE_DESK, S.GO, S.REPORT, S.BACK, S.WINDOW]) assert.ok(need.has(s), 'demo reaches ' + s);
  assert.equal(M.demoSnapshot('tour', 0).demo, true);
});

test('camera: zoom keeps the point under the cursor, clamps, and resets at 1x', () => {
  let v = { z: 1, x: 0, y: 0 };
  v = M.zoomAt(v, 1.5, 100, -40);
  assert.equal(v.z, 1.5);
  // the stage point under the cursor (relative to centre) maps to the same screen point before and after
  assert.ok(Math.abs((100 - 0) / 1 - (100 - v.x) / 1.5) < 1e-9 && Math.abs((-40 - v.y) / 1.5 - (-40)) < 1e-9);
  assert.equal(M.zoomAt({ z: 3, x: 0, y: 0 }, 2, 0, 0).z, 3, 'max zoom');
  assert.equal(M.zoomAt({ z: 1, x: 0, y: 0 }, .5, 0, 0).z, 1, 'min zoom');
  const c = M.clampView({ z: 2, x: 99999, y: -99999 }, 1280, 800, 0.9, 1310, 830);
  assert.ok(c.x > 0 && c.x < 1400 && c.y < 0 && c.y > -900);
  assert.equal(JSON.stringify(M.clampView({ z: 1, x: 50, y: 50 }, 1280, 800, 0.9, 1310, 830)), JSON.stringify({ z: 1, x: 0, y: 0 }));
});

test('playroom: eight idle agents spread out and spots are distinct', () => {
  const b = M.createBrain();
  const a8 = Object.keys(ROSTER).map(k => ag(k, 'idle', { first: true }));
  const f = b.update(snap([tiro('idle'), ...a8], [goal('g1', 'done', { at: Date.now() - 99e6 })]), 1000, { arrived: () => true });
  const spots = f.agents.filter(a => !a.isManager).map(a => M.SPOTS[a.spot]);
  assert.equal(spots.length, 8);
  assert.equal(new Set(f.agents.filter(a => !a.isManager).map(a => a.spot)).size, 8, 'distinct spots');
  let min = 1e9; for (let i = 0; i < 8; i++) for (let j = i + 1; j < 8; j++) min = Math.min(min, M.dist(spots[i], spots[j]));
  assert.ok(min >= 40, 'closest pair ' + Math.round(min));
  assert.ok(M.PLAY.length >= 12);
});

// ---------- depth layering with tight footprints (OfficeFurniture.layer) ----------
test('furniture footprints and walker layering', () => {
  const fctx = { OfficeMotion: M }; fctx.globalThis = fctx;
  vm.runInNewContext(fs.readFileSync(new URL('./public/office-furniture.js', import.meta.url), 'utf8'), fctx);
  const F = fctx.OfficeFurniture;
  // a canvas stand-in that swallows every draw call and returns an empty bitmap, so only the footprints get collected
  const sink = new Proxy(function () { }, { get: (_, k) => k === 'getImageData' ? (x, y, w, h) => ({ data: new Uint8ClampedArray(w * h * 4) }) : sink, set: () => true, apply: () => sink });
  F.measure({ createElement: () => ({ width: 0, height: 0, getContext: () => sink }) });
  const fpOf = fn => F.items.find(i => i.fp && fn(i.fp));
  const sofa = fpOf(f => f[0] < 600 && f[2] > 770 && f[1] >= 590 && f[3] < 650);
  assert.ok(sofa, 'sofa footprint measured'); assert.ok(sofa.fp[3] - sofa.fp[1] < 60, 'footprint is tight, not the whole room');
  const desk1 = F.objects.find(o => o.desk === 'desk-1'), d1 = M.DESKS[0];
  assert.ok(desk1.src.fp, 'desk footprint measured');
  const idx = it => F.items.indexOf(it);
  const person = (x, y) => ({ x, y, d: x + y + 3.5, p: true });
  const order = (p, it) => { const out = F.layer([p]); return out.indexOf(p) < out.indexOf(it) ? 'behind' : 'front'; };
  // walking the aisle in front of a top-row desk, at either end of its width, is always in front of it and behind the bottom row
  for (const dx of [-85, 0, 85]) {
    assert.equal(order(person(d1.cx + dx, 396), desk1.src), 'front', 'aisle x ' + dx);
    assert.equal(order(person(d1.cx + dx, 250), desk1.src), 'behind', 'north corridor x ' + dx);
  }
  const d5 = F.objects.find(o => o.desk === 'desk-5').src;
  for (const dx of [-85, 0, 85]) assert.equal(order(person(M.DESKS[4].cx + dx, 396), d5), 'behind', 'aisle vs bottom row x ' + dx);
  // in front of the sofa along its whole length, behind it on its far side
  for (const x of [600, 680, 770]) { assert.equal(order(person(x, 662), sofa), 'front'); assert.equal(order(person(x, 585), sofa), 'behind'); }
  // a seated person (inside the footprint) keeps the old x+y rule, so the sitter is not buried
  assert.equal(order(person(686, 616), sofa), 'front');
  // flat floor pieces (the pond) are under everyone
  const pond = F.items.find(i => i.o.floor); assert.ok(pond); assert.equal(idx(pond), 0);
  // every walker appears exactly once and furniture order is preserved
  const ps = [person(100, 100), person(400, 396), person(800, 650)], out = F.layer(ps);
  assert.equal(out.length, F.items.length + 3); for (const p of ps) assert.equal(out.filter(x => x === p).length, 1);
  assert.deepEqual(out.filter(x => !x.p), F.items);
  // objects carry a measured source painter for the click area
  for (const k of ['sops', 'rack', 'reports', 'arcade', 'jukebox', 'coffee', 'plant', 'inbox', 'today', 'usage']) assert.ok(F.objects.find(o => o.key === k).src, k);
});

test('brain: a flagged helper never takes the specialist desk, even if its id sorts first', () => {
  const b = M.createBrain({ wall: () => 1e12 });
  const main = { ...ag('forge', 'working'), id: 'z-forge' };
  const helper = { ...ag('forge', 'working'), id: 'a-helper', name: 'Forge helper' }; helper.profile = { ...helper.profile, helper: true, helperOf: 'z-forge', name: 'Forge helper' };
  const f = b.update(snap([tiro('working'), helper, main], [goal('g1', 'doing')], 3), 0);
  assert.equal(find(f, 'z-forge').spot, 'desk-2'); assert.ok(!find(f, 'z-forge').visitor);
  assert.ok(find(f, 'a-helper').visitor && M.HOT.includes(find(f, 'a-helper').spot));
});

test('click areas follow the measured silhouette, with a rect fallback', () => {
  const load = getImageData => {
    const fctx = { OfficeMotion: M }; fctx.globalThis = fctx;
    vm.runInNewContext(fs.readFileSync(new URL('./public/office-furniture.js', import.meta.url), 'utf8'), fctx);
    const sink = new Proxy(function () { }, { get: (_, k) => k === 'getImageData' ? getImageData : sink, set: () => true, apply: () => sink });
    fctx.OfficeFurniture.measure({ createElement: () => ({ width: 0, height: 0, getContext: () => sink }) });
    return fctx.OfficeFurniture;
  };
  // fake bitmap: an L shape (left third, and the bottom third) is opaque, the rest transparent
  const F = load((x, y, w, h) => { const d = new Uint8ClampedArray(w * h * 4); for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) if (i < w / 3 || j >= 2 * h / 3) d[(j * w + i) * 4 + 3] = 255; return { data: d }; });
  const o = F.objects.find(q => q.key === 'sops'); assert.ok(o.mask, 'mask built');
  const m = o.mask, at = (fx, fy) => [m.l + fx * m.w, m.t + fy * m.h];
  assert.ok(F.maskHit(m, ...at(.1, .5)), 'inside the upright of the L');
  assert.ok(F.maskHit(m, ...at(.5, .9)), 'inside the foot of the L');
  assert.ok(!F.maskHit(m, ...at(.8, .2)), 'the concave corner is not a hit');
  assert.ok(!F.maskHit(m, m.l - 10, m.t + 2) && !F.maskHit(m, m.l + m.w + 10, m.t + 2), 'outside the box misses');
  assert.ok(F.maskHit(m, m.l + 0.5, m.t + m.h * .9), 'dilated edge still hits');
  // a blank bitmap means nothing measurable: no mask, so the world keeps the rectangle
  const E = load((x, y, w, h) => ({ data: new Uint8ClampedArray(w * h * 4) }));
  assert.ok(E.objects.every(q => !q.mask));
});

test('east park and garage: reachable, registered, and the scheduler stays out of the roster', () => {
  assert.equal(M.WX, 1240);
  for (const id of ['pk:b1', 'pk:b2', 'pk:pond']) {
    assert.ok(M.GARDEN.includes(id), id + ' is a thinking spot');
    const p = M.pathTo('desk-1', id); assert.ok(p && p.length >= 2, 'path to ' + id);
    for (const q of p) assert.ok(q.x >= 0 && q.x <= M.WX && q.y >= 0 && q.y <= M.WY, 'path stays in the world');
  }
  assert.ok(M.SPOTS['sched:npc'] && M.SPOTS['sched:npc'].zone === 'garage');
  assert.ok(!M.TEAM.some(t => /sched/i.test(t.key)), 'the scheduler is not a specialist');
  const fctx = { OfficeMotion: M }; fctx.globalThis = fctx;
  vm.runInNewContext(fs.readFileSync(new URL('./public/office-furniture.js', import.meta.url), 'utf8'), fctx);
  const F = fctx.OfficeFurniture;
  assert.ok(F.STW >= Math.ceil(F.P(M.WX, 0, 0)[0]) && F.STH >= Math.ceil(F.P(M.WX, M.WY, -16)[1]), 'stage holds the whole slab');
  const sink = new Proxy(function () { }, { get: (_, k) => k === 'getImageData' ? (x, y, w, h) => { const d = new Uint8ClampedArray(w * h * 4); for (let j = 0; j < Math.min(h, 40); j++) for (let i = 0; i < Math.min(w, 40); i++) d[(j * w + i) * 4 + 3] = 255; return { data: d }; } : sink, set: () => true, apply: () => sink });
  F.measure({ createElement: () => ({ width: 0, height: 0, getContext: () => sink }) });
  for (const k of ['scheduler', 'garage']) { const o = F.objects.find(q => q.key === k); assert.ok(o && o.src && o.mask, k + ' has a click silhouette'); assert.ok(o.src.fp, k + ' has a ground footprint'); }
  // walkers on the forecourt are in front of the garage and behind nothing they should not be
  const garage = F.objects.find(q => q.key === 'garage').src, p = { x: 1112, y: 742, d: 1112 + 742 + 3.5 }, out = F.layer([p]);
  assert.ok(out.indexOf(p) > out.indexOf(garage), 'forecourt walker is drawn over the garage');
  const back = { x: 1112, y: 560, d: 1112 + 560 + 3.5 }, out2 = F.layer([back]);
  assert.ok(out2.indexOf(back) < out2.indexOf(garage), 'walker behind the garage is hidden by it');
});

test('scheduler character is never drawn behind its own bench or mailbox, and small pieces win clicks', () => {
  const fctx = { OfficeMotion: M }; fctx.globalThis = fctx;
  vm.runInNewContext(fs.readFileSync(new URL('./public/office-furniture.js', import.meta.url), 'utf8'), fctx);
  const F = fctx.OfficeFurniture;
  const sink = new Proxy(function () { }, { get: (_, k) => k === 'getImageData' ? (x, y, w, h) => { const d = new Uint8ClampedArray(w * h * 4); for (let j = 0; j < Math.min(h, 40); j++) for (let i = 0; i < Math.min(w, 40); i++) d[(j * w + i) * 4 + 3] = 255; return { data: d }; } : sink, set: () => true, apply: () => sink });
  F.measure({ createElement: () => ({ width: 0, height: 0, getContext: () => sink }) });
  const sp = M.SPOTS['sched:npc'], npc = { x: sp.x, y: sp.y, d: sp.x + sp.y + 3.5, p: true };
  const out = F.layer([npc]), at = o => out.indexOf(F.objects.find(q => q.key === o).src);
  for (const k of ['scheduler', 'garage']) assert.ok(out.indexOf(npc) > at(k), 'character is in front of the ' + k);
  // the mailbox stands well to the east of the character: no overlap, so no order is imposed, but they must be clear of each other
  const mf = F.objects.find(q => q.key === 'mailbox').src.fp; assert.ok(npc.x + 7 + 40 <= mf[0] || npc.y - 7 >= mf[3], 'character stands clear of the mailbox');
  // the bench footprint must not stretch to the mailbox post (that was the bug: one merged footprint swallowed the character)
  const bench = F.objects.find(q => q.key === 'scheduler').src.fp, mail = F.objects.find(q => q.key === 'mailbox').src.fp;
  assert.ok(bench[2] <= mail[0] && bench[3] < sp.y - 7, 'bench footprint ends before the character and the mailbox');
  assert.ok(mail[2] - mail[0] < 40 && mail[3] - mail[1] < 40);
  // walking round the mailbox either side keeps the right order
  const behind = { x: 1178, y: 715, d: 1178 + 715 + 3.5 }, o2 = F.layer([behind]); assert.ok(o2.indexOf(behind) < o2.indexOf(F.objects.find(q => q.key === 'mailbox').src), 'behind the post');
  const front = { x: 1178, y: 758, d: 1178 + 758 + 3.5 }, o3 = F.layer([front]); assert.ok(o3.indexOf(front) > o3.indexOf(F.objects.find(q => q.key === 'mailbox').src), 'in front of the post');
  // mailbox and station are registered and have silhouettes
  for (const k of ['mailbox', 'scheduler']) assert.ok(F.objects.find(q => q.key === k).mask, k);
});

test('Tiro sits behind his desk: desk front over the lower body, chair behind him, upper body visible, no popping', () => {
  const fctx = { OfficeMotion: M }; fctx.globalThis = fctx;
  vm.runInNewContext(fs.readFileSync(new URL('./public/office-furniture.js', import.meta.url), 'utf8'), fctx);
  const F = fctx.OfficeFurniture;
  const sink = new Proxy(function () { }, { get: (_, k) => k === 'getImageData' ? (x, y, w, h) => ({ data: new Uint8ClampedArray(w * h * 4) }) : sink, set: () => true, apply: () => sink });
  F.measure({ createElement: () => ({ width: 0, height: 0, getContext: () => sink }) });
  const desk = F.objects.find(o => o.desk === 'office').src;
  assert.ok(desk.fp, 'Tiro desk has a footprint (it used to be nofp, which put him on top of it)');
  const seat = M.SPOTS['tiro:seat'], tiro = { x: seat.x, y: seat.y, d: seat.x + seat.y + 3.5 };
  const out = F.layer([tiro]);
  assert.ok(out.indexOf(tiro) < out.indexOf(desk), 'the desk is drawn after Tiro, so its top and front panel cover his lower body');
  const chair = F.items.find(i => i.o.nofp && i.d === 26); assert.ok(chair && out.indexOf(chair) < out.indexOf(tiro), 'chair back is behind him');
  // upper body above the desk's rear top edge, lower body below it (sprite is 3x, hip row 19, 26 rows)
  const hip = Number(/s === 'tiro:seat' \? (\d+)/.exec(fs.readFileSync(new URL('./public/office-world.js', import.meta.url), 'utf8'))[1]);
  const hipY = F.P(seat.x, seat.y, hip)[1], top = hipY - 19 * 3, rear = F.P(seat.x + (M.TIRO_DESK.y0 + 2 - seat.y), M.TIRO_DESK.y0 + 2, 34)[1];
  const rowsAbove = Math.floor((rear - top) / 3);
  assert.ok(rowsAbove >= 18 && rowsAbove <= 24, 'head, shoulders and torso show above the desk (' + rowsAbove + ' of 26 rows), legs hidden by the desk');
  // walking in or out along the desk's east side (o_tside) flips the order at most once
  let last = null, flips = 0;
  for (let x = 330; x >= 225; x -= 1) { const p = { x, y: 36 - (330 - x) * 6 / 105, d: 0 }; p.d = p.x + p.y + 3.5; const o = F.layer([p]), b = o.indexOf(p) < o.indexOf(desk); if (last !== null && b !== last) flips++; last = b; }
  assert.ok(flips <= 1, 'order flips ' + flips + ' times along the approach');
  assert.equal(last, true, 'seated at the end of the approach he is behind the desk');
  // a visitor standing at the guest spot in front of the desk is in front of it
  const g = M.SPOTS['office:report'], p2 = { x: g.x, y: g.y, d: g.x + g.y + 3.5 }, o2 = F.layer([p2]); assert.ok(o2.indexOf(p2) > o2.indexOf(desk));
});

// ---------- frame scheduler (power saver) ----------
const FS = (o = {}) => ({ hidden: false, reduced: false, saver: true, dirty: false, interactMs: 1e9, moving: false, active: false, blurred: false, ...o });
test('nextFrameDelay: state table', () => {
  const D = M.nextFrameDelay, F = M.FRAME;
  assert.equal(D(FS({ hidden: true, moving: true, dirty: true })), -1, 'hidden or minimised = paused, whatever else is going on');
  assert.equal(D(FS({ dirty: true })), 0, 'a change shows at once');
  assert.equal(D(FS({ moving: true })), F.SMOOTH);
  assert.equal(D(FS({ interactMs: 100 })), F.SMOOTH, 'recent pointer input stays smooth');
  assert.equal(D(FS({ interactMs: F.INTERACT_MS + 1 })), F.IDLE);
  assert.equal(D(FS({ active: true })), F.WORK);
  assert.equal(D(FS()), F.IDLE);
  assert.equal(D(FS({ saver: false })), F.SMOOTH, 'saver off = the old flat 30 fps');
  assert.equal(D(FS({ saver: false, hidden: true })), -1, 'hidden is paused even with saver off');
  assert.equal(D(FS({ reduced: true })), 500); assert.equal(D(FS({ reduced: true, dirty: true })), 0);
  assert.equal(D(FS({ reduced: true, moving: true })), 500, 'reduced motion never animates');
  assert.ok(D(FS({ blurred: true, moving: true })) > F.SMOOTH && D(FS({ blurred: true })) > F.IDLE, 'an unfocused window runs slower');
  assert.ok(F.SMOOTH >= 33 && F.WORK >= 100 && F.IDLE >= 500, 'caps: 30 fps moving, 8 fps seated animations, 2 fps idle');
});
test('frame budget on a fake clock: idle, working, moving, hidden', () => {
  // replays the world's scheduling rule: draw, then wait frameWait(state, since) before the next one
  const run = (stateAt, ms) => { let t = 0, last = -1e9, n = 0; while (t < ms) { const w = M.frameWait(stateAt(t), t - last); if (w < 0) break; t += Math.max(w, 1); if (t >= ms) break; n++; last = t; } return n; };
  const perMin = (st, extra) => run(t => ({ ...FS(), ...st(t) }), 60000) + (extra || 0);
  assert.ok(perMin(() => ({})) <= 125, 'idle: at most ~2 frames a second, got ' + perMin(() => ({})));
  assert.ok(perMin(() => ({ active: true })) <= 500, 'seated animations: 8 fps');
  const mv = perMin(() => ({ moving: true })); assert.ok(mv <= 1830 && mv >= 1500, 'moving: about 30 fps, got ' + mv);
  assert.equal(perMin(() => ({ hidden: true })), 0, 'hidden: no frames at all');
  assert.ok(perMin(t => ({ hidden: t > 1000 })) <= run(() => FS(), 1000) + 1, 'a window hidden mid-run stops drawing');
  // a hover storm (dirty every ~8 ms for 10 s) is still capped at 60 fps
  let t = 0, last = -1e9, n = 0; while (t < 10000) { const w = M.frameWait(FS({ dirty: true }), t - last); t += Math.max(w, 1); n++; last = t; }
  assert.ok(n <= 10 * 63, 'dirty redraws capped near 60 fps, got ' + n);
  // idle redraws per minute are at least 12x below the old 30 fps loop
  assert.ok(perMin(() => ({})) * 12 <= 1800);
});
