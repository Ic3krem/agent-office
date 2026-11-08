// Live check of town step 3 travellers in Electron (not in npm test): temp-profile server on :4796, offscreen windows.
// The agent stream is the real one with fake agents (and a fake party) merged into every message by a preload; the fake
// state lives in localStorage 'tc.fake', so every window of this origin sees the same agents. Covers: one limited agent
// leaves the office, walks the town road (a reload mid-walk keeps it in place), sits at the karinderya with a chismis line
// while the cook talks, opens its desk card on click, and walks back to its desk once the limit clears; a party friend's
// limited agent walks from its lot to the karinderya. Then the town walk with 8 travellers (draw p95 < 8 ms, visible
// unfocused window) and the idle budgets (office page while its agent is away, town after the travellers left on Low; on
// High the ambient layer runs at its fps cap while visible and stops while hidden).
// usage: node_modules/.bin/electron perf/travel-check.cjs [shot dir]   (prints ALL PASSED)
const { app, BrowserWindow, session } = require('electron');
const { spawn } = require('child_process');
const fs = require('fs'), os = require('os'), path = require('path'), crypto = require('crypto');
const root = path.join(__dirname, '..'), port = 4796, base = 'http://127.0.0.1:' + port, key = crypto.randomBytes(24).toString('hex');
const shots = process.argv.slice(2).find(a => !a.startsWith('-') && !a.endsWith('.cjs')) || path.join(root, 'art', '.raw');
require('./tmp-sweep.cjs').sweep();
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ao-travelcheck-'));
app.setPath('userData', path.join(tmp, 'electron'));
// the perf window must count as visible even when other desktop windows cover it (else the town, hidden, draws nothing)
app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion');
const preload = path.join(tmp, 'preload.js');
fs.writeFileSync(preload, `
// Fake agents: tc.fake = { agents: [{ profile (an office OfficeMotion.TEAM entry), status, statusAt }], friend: null | { status } }.
const fake = () => { try { return JSON.parse(localStorage.getItem('tc.fake') || '{}'); } catch (e) { return {}; } };
const merge = d => {
  const f = fake();
  d.agents = (d.agents || []).concat((f.agents || []).map(a => ({ id: 'tc-' + a.profile.key, name: a.profile.name, role: a.profile.role,
    profile: a.profile, model: 'sonnet', status: a.status, statusAt: a.statusAt, task: a.status === 'working' ? 'Checking the travel code' : '',
    errText: a.status === 'limited' ? 'Plan limit reached' : '', logs: [], perm: null, turnTok: 0 })));
  if (f.friend) d.party = { connected: true, you: { id: 'me', name: 'Me', seq: 0 }, members: [{ id: 'm1', name: 'Ana', seq: 1, presence: 'available', room: 'home', agents: 1, working: 0,
    crew: [{ id: 'x1', name: 'Pixel', key: 'pixel', state: f.friend.status, bubble: 'On break' }] }] };
  return d;
};
const Real = window.EventSource;
window.EventSource = class extends Real {
  set onmessage(fn) { super.onmessage = ev => { window.__real = ev.data; window.__push = () => fn({ data: JSON.stringify(merge(JSON.parse(window.__real))) }); window.__push(); }; }
};`);
const child = spawn(process.execPath, [path.join(root, 'server.mjs')], { env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', USERPROFILE: tmp, HOME: tmp, APPDATA: path.join(tmp, 'AppData'), LOCALAPPDATA: path.join(tmp, 'Local'), AGENT_OFFICE_PORT: String(port), AGENT_OFFICE_UI_KEY: key, CLAUDE_CODE_PATH: '' }, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
let log = ''; child.stdout.on('data', d => log += d); child.stderr.on('data', d => log += d);
const wait = ms => new Promise(r => setTimeout(r, ms));
let failed = 0;
const check = (name, ok, info) => { if (!ok) failed++; console.log((ok ? 'PASS ' : 'FAIL ') + name + (info !== undefined ? '  ' + JSON.stringify(info) : '')); };
const done = code => { try { child.kill(); } catch {} setTimeout(() => { try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {} app.exit(code); }, 500); };
setTimeout(() => { console.log('FAIL watchdog: harness exceeded 420 s'); done(1); }, 420000).unref();
app.on('window-all-closed', () => {}); // the perf window opens after the others close: do not quit then
process.on('uncaughtException', e => { console.log('FAIL ' + e.stack); done(1); });
const pct = (a, p) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.min(s.length - 1, Math.floor(p * s.length))] : NaN; };

app.whenReady().then(async () => {
  for (let t = 0; !/running on/.test(log); t += 150) { if (t > 20000) throw new Error('server did not start: ' + log.slice(0, 300)); await wait(150); }
  await session.defaultSession.cookies.set({ url: base, name: 'ao_ui', value: key });
  const errors = [];
  const until = async (fn, ms = 15000) => { for (let t = 0; t < ms; t += 100) { try { if (await fn()) return true; } catch {} await wait(100); } return false; };
  const open = async (name, url, visible) => {
    const w = new BrowserWindow({ width: 1280, height: 800, show: false, focusable: !visible, webPreferences: visible ? { preload, contextIsolation: false, backgroundThrottling: true } : { offscreen: true, preload, contextIsolation: false } });
    if (visible) w.showInactive(); // never takes keyboard focus: real keys cannot move anything during a measurement
    w.webContents.on('console-message', e => { if (e.level === 'error') errors.push(name + ': ' + e.message); });
    await w.loadURL(base + url);
    const js = s => w.webContents.executeJavaScript(s);
    return { w, js, shot: async f => { await wait(300); fs.mkdirSync(shots, { recursive: true }); const p = path.join(shots, 'travel-' + f + '.png'); fs.writeFileSync(p, (await w.webContents.capturePage()).toPNG()); console.log('screenshot', p); } };
  };
  const officeReady = (o, sc) => until(() => o.js(`!!(window.OfficeWorld && OfficeWorld.scene() === ${JSON.stringify(sc)} && OfficeWorld.framesDrawn() > 0 && window.__push)`), 20000);
  const townReady = t => until(() => t.js('!!(window.__town && window.__push)'), 20000);
  let wins = [];
  let TEAM = []; // the office layout's desks (an interior's OfficeMotion.TEAM is empty)
  const fa = (i, status, statusAt) => ({ profile: TEAM[i], status, statusAt });
  const setFake = async f => { await wins[0].js(`localStorage.setItem('tc.fake', ${JSON.stringify(JSON.stringify(f))})`); for (const x of wins) await x.js('window.__push && __push(); 0'); };
  const agentIn = (o, id) => o.js(`(OfficeWorld.debug() || { agents: [] }).agents.find(a => a.id === ${JSON.stringify(id)}) || null`);

  // ---- 1. one agent at its desk, then limited: the office shows it leaving ----
  const office = await open('office', '/'); wins = [office];
  check('office boots', await officeReady(office, 'office'));
  TEAM = await office.js('OfficeMotion.TEAM');
  const team0 = await office.js('({ key: OfficeMotion.TEAM[0].key, name: OfficeMotion.TEAM[0].name, flags: OfficeMotion.travelFlags(), desks: OfficeMotion.TEAM.length })');
  const id = 'tc-' + team0.key;
  check('the office has no karinderya of its own (its agents travel), 8+ desks', !team0.flags.kain && team0.desks >= 8, team0);
  await setFake({ agents: [fa(0, 'working', Date.now() - 60000)] });
  check('working: the agent sits at its desk', await until(async () => { const a = await agentIn(office, id); return a && a.spot && !a.moving && /type|sit/.test(a.pose); }, 20000), await agentIn(office, id));
  const desk = (await agentIn(office, id)).spot;
  const t1 = Date.now();
  await setFake({ agents: [fa(0, 'limited', t1)] });
  check('limited: the agent walks out of the office', await until(async () => { const a = await agentIn(office, id); return a && a.moving; }, 4000), await agentIn(office, id));
  await office.shot('office-leaving');
  check('it is gone from the office after the exit leg', await until(async () => !(await agentIn(office, id)), 9000));

  // ---- 2. the town shows it on the road; a reload mid-walk keeps it within one grid cell ----
  const town = await open('town', '/town'); wins.push(town);
  check('town boots', await townReady(town));
  const trav = () => town.js(`(__town.travellers().find(t => t.id === ${JSON.stringify(id)}) || null)`);
  const leg = await town.js(`(() => { const r = AgentTravel.route(__town.map, 'home', 'kain'); return { len: Math.round(r.len), ms: Math.round(r.len / AgentTravel.TOWN_SPEED * 1000), cell: __town.grid.cell }; })()`);
  console.log('route home -> kain', JSON.stringify(leg));
  check('town: the agent is on the road', await until(() => trav(), 8000), await trav());
  check('town: it wears its role look (shirt and costume), as in the office', await town.js(`(t => t.look.key === ${JSON.stringify(team0.key)} && t.look.shirt === ${JSON.stringify(TEAM[0].color)})(__town.travellers()[0])`), (await trav()).look);
  await town.js(`(() => { const t = __town.travellers()[0]; if (t) __town.api.setCamera(t.x, t.y); })()`);
  await town.shot('town-road');
  const rec = await town.js(`JSON.stringify(__town.trips()[${JSON.stringify(id)}])`), before = await trav();
  await town.w.webContents.reload();
  check('town reload boots', await townReady(town) && await until(() => trav(), 5000));
  const again = await town.js(`(() => { const now = Date.now(), r = (a, b) => AgentTravel.route(__town.map, a, b), was = AgentTravel.where(${rec}, now, r), t = __town.travellers().find(t => t.id === ${JSON.stringify(id)});
    return t && was.pos ? { now: [Math.round(t.x), Math.round(t.y)], beforeReload: was.pos && [Math.round(was.pos.x), Math.round(was.pos.y)], off: Math.hypot(t.x - was.pos.x, t.y - was.pos.y) } : { t, was }; })()`);
  check('town reload: the agent is within one grid cell of where its trip had it', again.off <= leg.cell, { ...again, firstSeen: before && [Math.round(before.x), Math.round(before.y)] });

  // ---- 3. the karinderya: seated, a chismis line, the cook talks, a click opens its card ----
  const kain = await open('kain', '/#scene=kain'); wins.push(kain);
  check('kain boots', await officeReady(kain, 'kain'));
  check('kain: the agent arrives and sits on a stool', await until(async () => { const a = await agentIn(kain, id); return a && /^kain:/.test(a.spot) && !a.moving && /^sit/.test(a.pose); }, leg.ms + 15000), await agentIn(kain, id));
  check('kain: it says a chismis line', await until(async () => { const c = await kain.js('OfficeWorld.chatterInfo()'); return c && c.id === id; }, 25000), await kain.js('OfficeWorld.chatterInfo()'));
  await kain.shot('kain-chismis');
  check('kain: the cook talks', await until(() => kain.js(`OfficeWorld.npcInfo().some(n => n.kind === 'cook' && n.line)`), 30000), await kain.js('OfficeWorld.npcInfo()'));
  await kain.shot('kain-cook');
  const pt = await kain.js(`OfficeWorld.pointOf(${JSON.stringify(id)})`);
  const at = { x: Math.round(pt.x), y: Math.round(pt.y) }, m = type => kain.w.webContents.sendInputEvent({ type, x: at.x, y: at.y, button: 'left', clickCount: 1 });
  m('mouseMove'); await wait(100); m('mouseDown'); await wait(40); m('mouseUp');
  check('kain: clicking it opens its desk card', await until(() => kain.js(`!!document.querySelector('button[aria-label="Close the detail panel"]') && document.body.innerText.includes(${JSON.stringify(team0.name)})`), 3000), at);
  await kain.shot('kain-card');

  // office idle while its agent is away (the office page's power-saver cadence, as perf/office-perf.cjs)
  await until(() => office.js('OfficeFurniture.state.labels <= 0.02 && Math.abs(OfficeFurniture.state.dim - (OfficeWorld.debug().board.empty ? 1 : 0)) <= 0.01'), 25000);
  const of0 = await office.js('OfficeWorld.framesDrawn()'); await wait(10000); const officeIdle = (await office.js('OfficeWorld.framesDrawn()')) - of0;
  check('office idle with its agent away: <= 21 frames in 10 s', officeIdle <= 21, officeIdle);

  // ---- 4. the limit clears: back to its desk ----
  const t2 = Date.now();
  await setFake({ agents: [fa(0, 'working', t2)] });
  check('cleared: it leaves the karinderya', await until(async () => { const a = await agentIn(kain, id); return !a || a.moving; }, 4000));
  check('cleared: it walks the road home', await until(() => trav(), 10000), await trav());
  check('cleared: back at its desk', await until(async () => { const a = await agentIn(office, id); return a && a.spot === desk && !a.moving; }, leg.ms + 20000), { want: desk, got: await agentIn(office, id) });
  await office.shot('office-back');

  // ---- 5. a party friend's limited agent walks from friend-1 to the karinderya ----
  await setFake({ agents: [fa(0, 'working', t2)], friend: { status: 'limited' } });
  const fid = 'friend:m1:x1', fleg = await town.js(`Math.round(AgentTravel.route(__town.map, 'friend-1', 'kain').len / AgentTravel.TOWN_SPEED * 1000)`);
  const ftrav = () => town.js(`(__town.travellers().find(t => t.id === ${JSON.stringify(fid)}) || null)`);
  check('friend: on the road from its lot', await until(() => ftrav(), 10000), await town.js(`({ t: __town.travellers().map(t => t.id), door: __town.map.lots.find(l => l.id === 'friend-1').door })`));
  const fp = await ftrav(), fdoor = await town.js(`__town.map.lots.find(l => l.id === 'friend-1').door`);
  check('friend: it starts near the friend-1 door', Math.hypot(fp.x - fdoor.x, fp.y - fdoor.y) < 200, { at: [Math.round(fp.x), Math.round(fp.y)], door: fdoor });
  await town.js(`__town.api.setCamera(${fp.x}, ${fp.y})`); await town.shot('friend-road');
  check('friend: it reaches the karinderya and sits or stands there', await until(async () => { const a = await agentIn(kain, fid); return a && /^kain/.test(a.spot) && !a.moving; }, fleg + 15000), await agentIn(kain, fid));
  await kain.shot('kain-friend');

  // ---- 6. the town walk with 8 travellers (visible, unfocused window) and town idle after they left ----
  for (const x of wins.slice(1)) x.w.destroy();
  wins = [office];
  const now = Date.now(), EXIT = 6000;
  await setFake({ agents: [0, 1, 2, 3, 4, 5, 6, 7].map(i => fa(i, 'limited', now - EXIT - 300 - i * 500)) });
  office.w.destroy();
  const perf = await open('perf', '/town', true); wins = [perf];
  check('perf town boots', await townReady(perf));
  check('perf: 8 travellers on the road', await until(() => perf.js('__town.travellers().length === 8'), 5000), await perf.js('__town.travellers().length'));
  await perf.js(`window.__s = []; (function s() { const f = __town.api.frameCount(); if (f !== window.__lf) { window.__lf = f; window.__s.push(__town.api.stats().lastRenderMs); } window.__walk = requestAnimationFrame(s); })()`);
  const span = Math.max(3000, Math.min(10000, leg.ms - 4500)), f0 = await perf.js('__town.api.frameCount()');
  await wait(span);
  await perf.js('cancelAnimationFrame(window.__walk)');
  const walkFrames = (await perf.js('__town.api.frameCount()')) - f0, n8 = await perf.js('__town.travellers().length'), samples = (await perf.js('window.__s')).filter(x => x > 0);
  const p50 = pct(samples, 0.5), p95 = pct(samples, 0.95);
  console.log('town walk, 8 travellers: ' + samples.length + ' frames in ' + span + ' ms, draw p50 ' + p50.toFixed(2) + ' ms, p95 ' + p95.toFixed(2) + ' ms, max ' + Math.max(...samples).toFixed(2) + ' ms (' + n8 + ' still on the road, document ' + (await perf.js('document.visibilityState')) + ')');
  check('town walk with 8 travellers: draw p95 < 8 ms', p95 < 8 && walkFrames > 60 && n8 >= 6, { p50, p95, frames: walkFrames, onRoad: n8 });
  await perf.shot('town-8');
  check('perf: every traveller leaves the town', await until(() => perf.js('__town.travellers().length === 0'), leg.ms + 8000));
  // idle is pinned to Low (ambient off), as perf/town-check.cjs does: the default preset animates water and trees at its cap
  await perf.js(`__town.api.setGraphics(Graphics.resolve({ preset: 'low' }, Graphics.env()))`);
  await wait(500); const ti0 = await perf.js('__town.api.frameCount()'); await wait(3000);
  check('town idle after the travellers left renders nothing (Low)', (await perf.js('__town.api.frameCount()')) === ti0);
  // ambient (High): throttled to the preset's ambientFps while visible, stopped while hidden
  const fps = await perf.js(`(() => { const g = Graphics.resolve({ preset: 'high' }, Graphics.env()); __town.api.setGraphics(g); return g.ambientFps; })()`);
  await wait(500); const ta0 = await perf.js('__town.api.frameCount()'); await wait(3000); const amb = (await perf.js('__town.api.frameCount()')) - ta0;
  check('High: ambient runs at its fps cap while visible (3 s)', amb > 0 && amb <= fps * 3 + 2, { frames: amb, ambientFps: fps });
  perf.w.hide(); await until(() => perf.js('document.hidden'), 3000);
  const th0 = await perf.js('__town.api.frameCount()'); await wait(3000); const ah = (await perf.js('__town.api.frameCount()')) - th0;
  check('High: ambient stops while hidden (3 s)', (await perf.js('document.hidden')) && ah === 0, ah);
  perf.w.destroy();

  check('no console errors', errors.length === 0, errors);
  console.log(failed ? 'FAILED ' + failed : 'ALL PASSED');
  done(failed ? 1 : 0);
}).catch(e => { console.log('FAIL ' + e.stack); done(1); });
