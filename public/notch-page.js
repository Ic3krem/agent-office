// Notch page: state, rendering into the shell of island.html, input, and the live data. Main decides open/closed and sizes the window;
// this page reports its closed view and whether it must stay open (hold), and renders the view main sends.
const nonce = () => (document.cookie.match(/(?:^|; )ao_nonce=([^;]*)/) || [])[1] || '';
const desk = window.islandDesk || { guard: { get: async () => null, set: async () => null, remember: async () => null, forget: async () => null }, closedView() {}, hold() {}, dismiss() {}, office() {}, focus() {}, settings() {}, mute() {}, media() {}, perfOpen() {}, fpsSetup: async () => null, onPerf() {}, onNowPlaying() {}, onLyrics() {}, update: { get: async () => null, check: async () => null, install: async () => null, set: async () => null, on() {} }, onToggle() {}, onState() {}, store: { get: async () => null, set: async x => x }, calendar: { set: async () => null, refresh: async () => null, join() {} }, onCalendar() {} };
const $ = id => document.getElementById(id);
const esc = t => String(t ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const api = (p, body) => fetch(p, { method: 'POST', headers: { 'content-type': 'application/json', 'x-nonce': nonce() }, body: JSON.stringify(body || {}) })
  .then(async r => { const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.error || 'HTTP ' + r.status); return j; });

// ---------- state ----------
let snap = null, prev = null, online = false;
let view = 'closed', form = 'transparent'; // from main: 'closed' | 'line' | 'game' | 'open'; window form 'material' | 'transparent'
let pinned = false, chatOn = false, toast = null, toastTimer = 0, mode = 'always', mute = false;
let tab = 'home', panel = null, calOff = 0; // panel 'settings' replaces the tab body; calOff = months away from the current one
let cal = null, calMsg = ''; // calendar view from main ({ available, linked, host, error, fetchedAt, events }; never the link); a refused paste
// The closed line: the next timed event (closedView shows it from 15 minutes before).
const nextEvent = now => { const e = cal && cal.linked && (cal.events || []).find(x => !x.allDay && x.start >= now); return e ? { title: e.title || 'Event', start: e.start } : null; };
const DEF = { theme: 'ember', accent: '#ffcf6b', physics: 'default', pinned: ['today', 'reports', 'usage', 'chat'], hour12: false, clockInPill: true, zone2: '', zone2Label: '', weekStart: 1, edgeDelay: 0, leaveDelay: 900, nowPlaying: true, kiroFace: true, animate: true, powerSaver: true, lyrics: false, notchEnabled: true, notchShortcut: '', look: 'glass', homeCards: ['approvals', 'agents', 'calendar', 'timer', 'notes'], gameMode: 'auto', games: [] };
let S = { ...DEF };
let lyr = null, lyrIdx = -2, lyrTimer = 0; // synced lyrics {key, lines:[{t,text}]} pushed from the desktop, last shown line index, fade timer
let np = null; // now-playing session (from SMTC)
let fpsMsg = ''; // the outcome of Turn on FPS
let perf = null; // load and temperature from main { game, proc, cpu, mem, gpu, gpuTemp, fps, fpsLow, fpsAvg, frames, fpsState, fpsSeen, fpsSetup }; a missing value is null
let upd = null, GV = null, shortcutOk = true; // update status, Security Guard settings, whether the notch shortcut registered
const qsel = {}; // chosen options per question ask
// Display copy of desktop/island-logic.mjs (the tested, authoritative one); main.mjs validates every patch before it is saved.
const THEMES = {
  ember: { bg: '#0b0807', card: '#17110e', line: '#261d17', ink: '#f0e4d4', dim: '#a8998a', accent: '#ffcf6b', tile: '#2a211b' },
  midnight: { bg: '#080b12', card: '#10151f', line: '#1c2433', ink: '#e4ebf7', dim: '#8d9ab0', accent: '#6bb2ff', tile: '#2a211b' },
  forest: { bg: '#08100b', card: '#101a14', line: '#1b2a21', ink: '#e1f0e6', dim: '#8aa394', accent: '#6bdb94', tile: '#2a211b' },
  light: { bg: '#f6f1ea', card: '#ebe3d8', line: '#d9cfc0', ink: '#2a211b', dim: '#6f6256', accent: '#b8620a', tile: '#e0d6c8' },
};
const PHYS = { soft: [140, 22], default: [230, 21], snappy: [380, 34], bouncy: [260, 13] };
const reduceMQ = matchMedia('(prefers-reduced-motion: reduce)');
const still = () => reduceMQ.matches || S.animate === false; // OS reduced-motion or the Animations pref (eyes, lyrics)
const saver = () => S.powerSaver !== false;
const shapeStill = () => still() || saver(); // the notch shape and the open entrance do not animate under Power saver either
let curMood = 'idle';
// Power saver: the eyes animate only while open or something is happening (working, asking, music, a toast); an idle closed notch holds still.
function animOn() { return S.animate && !(saver() && view !== 'open' && (curMood === 'idle' || curMood === 'off' || curMood === 'done')); }
function syncAnim() { const h = document.documentElement.dataset, v = animOn() ? 'on' : 'off'; if (h.anim !== v) h.anim = v; if (shapeStill() !== ('still' in h)) shapeStill() ? h.still = '' : delete h.still; }
function applySettings(s) {
  S = { ...DEF, ...s }; S.homeCards = NotchCore.knownCards(S.homeCards); try { localStorage.setItem('ao.powerSaver', saver() ? '1' : '0'); } catch (e) { } // shared with the office page and Tiro
  const t = S.theme === 'custom' ? { ...THEMES.ember, accent: S.accent } : THEMES[S.theme] || THEMES.ember, h = document.documentElement;
  h.dataset.face = S.kiroFace ? 'on' : 'off'; h.dataset.look = S.look === 'solid' ? 'solid' : 'glass'; syncAnim();
  if (S.theme === 'light') h.dataset.light = ''; else delete h.dataset.light;
  for (const k of ['bg', 'card', 'line', 'ink', 'dim', 'accent', 'tile']) h.style.setProperty('--' + k, t[k]);
  const [k, c] = PHYS[S.physics] || PHYS.default; for (const p of [W, H, R]) { p.k = k; p.c = c; }
}
const setPref = patch => desk.settings(patch);
const dismissed = new Set(); // approvals the user waved away with Esc
// Keep per-ask state only for asks that still exist, so it cannot grow for the app's lifetime.
const prune = () => { const ids = new Set(asksOf(snap).map(a => a.perm.askId)); for (const id of dismissed) if (!ids.has(id)) dismissed.delete(id); for (const id of Object.keys(qsel)) if (!ids.has(id)) delete qsel[id]; };
const liveAsks = () => asksOf(snap).filter(a => !dismissed.has(a.perm.askId));

// ---------- spring (transparent form only): a damped oscillator per property, so the shape overshoots slightly and settles ----------
const spring = (v, k = 230, c = 21) => ({ v, t: v, s: 0, k, c });
const W = spring(180), H = spring(32), R = spring(16);
let raf = 0, last = 0;
function step(now) {
  const dt = Math.min(0.032, (now - last) / 1000 || 0.016); last = now;
  let moving = false;
  for (const p of [W, H, R]) {
    if (shapeStill()) { p.v = p.t; p.s = 0; continue; }
    p.s += (-p.k * (p.v - p.t) - p.c * p.s) * dt; p.v += p.s * dt;
    if (Math.abs(p.v - p.t) > .2 || Math.abs(p.s) > .5) moving = true; else { p.v = p.t; p.s = 0; }
  }
  const el = $('notch');
  el.style.width = Math.max(60, W.v) + 'px'; el.style.height = Math.max(24, H.v) + 'px'; el.style.borderRadius = `0 0 ${Math.max(8, R.v)}px ${Math.max(8, R.v)}px`;
  raf = moving ? requestAnimationFrame(step) : 0;
}
// Grow: main has already resized the window, so the shape springs out to it. Shrink: it springs in, then main shrinks the window.
function aim() {
  const sz = view === 'open' ? { w: innerWidth, h: innerHeight } : NotchCore.SIZES[view] || NotchCore.SIZES.closed;
  W.t = Math.min(innerWidth, sz.w); H.t = Math.min(innerHeight, sz.h); R.t = view === 'open' ? 22 : 16;
  if (!raf) { last = performance.now(); raf = requestAnimationFrame(step); }
}
addEventListener('resize', aim);

// ---------- chime: two short synthesized notes (WebAudio, no asset files); ask = rising pair, done = falling pair ----------
let actx = null;
function chime(kind) {
  if (mute || mode === 'off') return;
  try {
    actx = actx || new (window.AudioContext || window.webkitAudioContext)();
    if (actx.state === 'suspended') actx.resume();
    const notes = kind === 'ask' ? [660, 880] : [880, 659], t0 = actx.currentTime + 0.02;
    notes.forEach((f, i) => {
      const o = actx.createOscillator(), g = actx.createGain(), t = t0 + i * 0.13;
      o.type = 'sine'; o.frequency.value = f;
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.16, t + 0.015); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.28);
      o.connect(g).connect(actx.destination); o.start(t); o.stop(t + 0.3);
    });
  } catch {}
}
const idsOf = s => new Set([...asksOf(s).map(a => a.perm.askId), ...hiresOf(s).map(h => 'h:' + h.id)]);

function showToast(text, ms = 5500) { toast = text; clearTimeout(toastTimer); toastTimer = setTimeout(() => { toast = null; render(); }, ms); render(); }
function notice(next) {
  if (!prev) return;
  const seen = idsOf(prev), fresh = [...idsOf(next)].filter(id => !seen.has(id));
  if (fresh.some(id => !id.startsWith('h:'))) chime('ask');
  if (fresh.length && view !== 'open') { tab = S.homeCards.includes('approvals') ? 'home' : 'approvals'; panel = null; } // it opens by itself: land where it can be answered
  const before = Object.fromEntries((prev.goals || []).map(g => [g.id, g.status]));
  for (const g of next.goals || []) {
    if (!before[g.id]) continue;
    if (g.status === 'done' && before[g.id] !== 'done') { showToast('Done. ' + g.text.slice(0, 80)); chime('done'); }
    if (g.status === 'blocked' && before[g.id] !== 'blocked') showToast('Blocked. ' + (g.note || g.text).slice(0, 80), 8000);
  }
  if ((next.reportsN || 0) > (prev.reportsN || 0)) showToast('New report ready on the shelf.');
  if (next.boss?.paused && next.boss.paused !== prev.boss?.paused) showToast('Paused: ' + next.boss.paused, 9000);
}

// Display copy of desktop/lyrics.mjs (lineAt, positionNow); the tested, authoritative one lives there.
const lineAt = (lines, pos) => { let lo = 0, hi = lines.length - 1, ans = -1; while (lo <= hi) { const m = (lo + hi) >> 1; if (lines[m].t <= pos) { ans = m; lo = m + 1; } else hi = m - 1; } return ans; };
const positionNow = n => { if (!n || !Number.isFinite(n.pos) || !Number.isFinite(n.ts)) return null; const p = n.pos + (n.playing ? Math.max(0, Date.now() - n.ts) : 0); return Number.isFinite(n.dur) && n.dur > 0 ? Math.min(p, n.dur) : p; };
const lyricsOn = () => !!(S.lyrics === true && S.nowPlaying && np?.playing && lyr && np.key && lyr.key === np.key && lyr.lines.length && positionNow(np) != null);
// Lyric line: follows the SMTC position, fades between lines (jumps when motion is reduced). Text is set outside render() so a re-render never restarts the fade.
function tickLyric(instant) {
  const els = document.querySelectorAll('.lyr'); if (!els.length || !lyricsOn()) { lyrIdx = -2; return; }
  const i = lineAt(lyr.lines, positionNow(np)), setAll = () => { const t = lyrIdx >= 0 ? lyr.lines[lyrIdx]?.text || '' : ''; document.querySelectorAll('.lyr').forEach(e => { e.textContent = t || e.dataset.fb || ''; e.title = t || e.dataset.fb || ''; e.classList.remove('out'); }); };
  if (i === lyrIdx && !instant) return;
  const first = lyrIdx === -2; lyrIdx = i; clearTimeout(lyrTimer);
  if (instant || first || still()) return setAll();
  els.forEach(e => e.classList.add('out')); lyrTimer = setTimeout(setAll, 180);
}
(function lyricLoop() { if (lyr && !document.hidden) tickLyric(false); setTimeout(lyricLoop, lyr ? 200 : 1000); })();

// Tone and the eyes' mood, plus the status sentence for screen readers.
function status() {
  const asks = asksOf(snap), hires = hiresOf(snap), w = working(snap), music = S.nowPlaying && np?.playing;
  if (!online) return { tone: 'off', mood: 'off', text: 'Offline' };
  if (asks.length) return { tone: 'ask', mood: 'ask', text: `${asks[0].name} needs approval` };
  if (hires.length) return { tone: 'ask', mood: 'ask', text: `${mgrName()} wants to hire ${hires[0].name}` };
  if (toast) return { tone: 'done', mood: 'done', text: toast };
  if (w.length) { const a = w.find(x => !x.isManager) || w[0]; return { tone: 'work', mood: 'work', text: `${a.name} ${(a.task || 'working').slice(0, 60)}` }; }
  return { tone: 'off', mood: music ? 'music' : 'idle', text: mgrName() + ' is idle' };
}


// ---------- notes and timers: one in-memory copy of the store, changed and sent whole (the store keeps the last write) ----------
let store = { notes: [], timers: [], counters: [], pomodoro: { focus: 25, rest: 5, rounds: 4 } }, storeSeq = 0, tickId = 0;
let lastChecked = Date.now(); // timers that ended while the app was closed show as finished but do not chime late
const gate = NotchCore.storeGate(() => desk.store.get(), s => desk.store.set(s)); // commit() writes only once the stored data has loaded
const acked = new Set(); // finished timers the user has seen (opened the notch)
const POM = { focus: [1, 180], rest: [1, 60], rounds: [1, 12] };
const newId = () => (Math.random().toString(36).slice(2) + '00000000').slice(0, 8);
function commit(fn, quiet) {
  if (gate.state !== 'ready') return; // quiet: save without redrawing (a field being left must not swallow the click that left it)
  const next = structuredClone(store); fn(next); store = next; const my = ++storeSeq; if (!quiet) render();
  gate.write(next).then(r => { if (r && my === storeSeq) { store = r; if (!quiet) render(); } }).catch(() => {});
}
const loadStore = () => gate.load().then(() => { if (gate.state === 'ready') store = gate.data; render(); });
loadStore();
function addTimer(kind, name, m) { // false when refused
  if (gate.state !== 'ready') return false;
  if (store.timers.length >= 10) { showToast('10 timers is the limit.', 3000); return false; }
  const now = Date.now(), t = { id: newId(), name: name.slice(0, 40), kind, endsAt: null, startedAt: now, pausedLeft: null, round: kind === 'pomodoro' ? 1 : 0, phase: 'focus' };
  if (kind === 'countdown') t.endsAt = now + Math.min(1440, Math.max(1, Math.round(+m) || 1)) * 60e3;
  if (kind === 'pomodoro') t.endsAt = now + store.pomodoro.focus * 60e3;
  commit(s => s.timers.push(t)); return true;
}
function toggleTimer(id) {
  const now = Date.now();
  commit(s => { const t = s.timers.find(x => x.id === id); if (!t) return; const v = NotchCore.timerView(t, now);
    if (NotchCore.timerRunning(t, now)) { t.pausedLeft = v.left; if (t.kind !== 'stopwatch') t.endsAt = null; }
    else if (t.kind === 'stopwatch') { t.startedAt = now - (t.pausedLeft || 0); t.pausedLeft = null; }
    else if (t.pausedLeft > 0) { t.endsAt = now + t.pausedLeft; t.pausedLeft = null; } });
}
const timerLabel = t => { const v = NotchCore.timerView(t, Date.now()); return v.done && t.kind !== 'stopwatch' ? 'Done' : v.label; };
function paintTimers() { for (const e of document.querySelectorAll('[data-tl]')) { const t = store.timers.find(x => x.id === e.dataset.tl), txt = t ? timerLabel(t) : ''; if (e.textContent !== txt) e.textContent = txt; } }
// The closed line: the running countdown that ends soonest; else a finished one until the notch is opened (or it is deleted).
function closedTimer(now) {
  const ts = store.timers.filter(t => t.kind !== 'stopwatch'), nm = t => timerName(t) + (t.kind === 'pomodoro' ? ' ' + t.phase : '');
  const run = ts.filter(t => t.endsAt != null && t.endsAt > now).sort((a, b) => a.endsAt - b.endsAt)[0];
  if (run) return { name: nm(run), left: run.endsAt - now };
  const d = ts.find(t => NotchCore.timerView(t, now).done && !acked.has(t.id));
  return d ? { name: nm(d), done: true } : null;
}
// The 1 s tick exists only while something needs it: a running stopwatch or a countdown that has not been checked as finished yet.
function syncTick() {
  const need = store.timers.some(t => t.kind === 'stopwatch' ? NotchCore.timerRunning(t, 0) : t.endsAt != null && t.endsAt > lastChecked);
  if (need && !tickId) tickId = setInterval(tick, 1000); else if (!need && tickId) { clearInterval(tickId); tickId = 0; }
}
function tick() {
  const now = Date.now(), due = NotchCore.dueTimers(store.timers, lastChecked, now); lastChecked = now;
  if (!due.length) { paintTimers(); if (view !== 'open') render(); return; }
  const names = due.map(id => timerTitle(store.timers.find(t => t.id === id)));
  commit(s => { s.timers = s.timers.map(t => due.includes(t.id) && t.kind === 'pomodoro' ? NotchCore.pomodoroNext(t, s.pomodoro, now) : t); });
  chime('done'); showToast('Timer done: ' + names.join(', '));
}

// ---------- rendering: each region is replaced only when its HTML changed, and focus (plus a field being typed in) survives ----------
function patch(el, html) {
  if (el._h === html) return; el._h = html;
  const a = document.activeElement, fk = a && el.contains(a) ? a.closest('[data-fk]')?.dataset.fk : null, val = fk && a.dataset.fk === fk && 'value' in a ? a.value : null; // a button inside a card returns focus to the card
  el.innerHTML = html;
  const b = fk && el.querySelector(`[data-fk="${CSS.escape(fk)}"]`);
  if (b) { if (val != null) b.value = val; b.focus({ preventScroll: true }); }
}
const tabsEl = $('tabs');
tabsEl.innerHTML = NotchCore.TABS.map(k => `<button role="tab" id="tab-${k}" data-tab="${k}" aria-controls="page" aria-label="${TAB_LABEL[k]}">${ic(k)}<span>${TAB_LABEL[k]}</span></button>`).join('');
$('pinBtn').innerHTML = ic('pin'); $('setBtn').innerHTML = ic('settings');
let lastHold = '', lastCv = '', wasOpen = false, lastPerfOpen = false;
function render() {
  const asks = asksOf(snap), hires = hiresOf(snap), st = status(), open = view === 'open', game = perf && perf.game ? perf : null;
  const cv = NotchCore.closedView({ asks: asks.length, hires: hires.length, game, nextEvent: nextEvent(Date.now()), timer: closedTimer(Date.now()), np: S.nowPlaying ? np : null, toast: toast || '', now: Date.now() });
  const h = document.documentElement; h.dataset.view = view; h.dataset.form = form;
  const el = $('notch'); el.dataset.tone = st.tone; curMood = st.mood;
  if (open) {
    for (const b of tabsEl.children) { const on = !panel && b.dataset.tab === tab; b.setAttribute('aria-selected', on); b.tabIndex = on || (panel && b.dataset.tab === tab) ? 0 : -1; }
    const n = asks.length + hires.length, tb = $('tab-approvals'), badge = tb.querySelector('.badge');
    if (n && !badge) tb.insertAdjacentHTML('beforeend', `<span class="badge">${n}</span>`); else if (n) badge.textContent = n; else badge?.remove();
    tb.setAttribute('aria-label', n ? `Approvals, ${n} waiting` : 'Approvals');
    patch($('notice'), esc(toast || (!online ? 'Offline' : '')));
    patch($('now'), `<b>${esc(clockStr(''))}</b>${esc(dateStr())}`);
    $('pinBtn').setAttribute('aria-pressed', pinned); $('setBtn').setAttribute('aria-pressed', panel === 'settings');
    const page = $('page'); page.setAttribute('aria-labelledby', panel ? 'setBtn' : 'tab-' + tab);
    if (panel === 'settings') { page.dataset.layout = 'settings'; patch(page, settingsHTML()); }
    else if (tab === 'home') {
      const lay = 'home:' + S.homeCards.join(',');
      if (page.dataset.layout !== lay) { page.dataset.layout = lay; page._h = null; page.innerHTML = S.homeCards.length ? `<div class="cards">${S.homeCards.map(k => `<section class="card" data-card="${k}" aria-label="${TAB_LABEL[k]}"></section>`).join('')}</div>` : '<p class="empty">No cards on Home. Choose them in Settings.</p>'; }
      for (const c of page.querySelectorAll('[data-card]')) patch(c, cardHTML(c.dataset.card));
    } else { page.dataset.layout = tab; patch(page, TAB_BODY[tab]()); }
    for (const t of store.timers) if (t.kind !== 'stopwatch' && NotchCore.timerView(t, Date.now()).done) acked.add(t.id);
    const slot = $('faceOpen'); if (faceEl.parentNode !== slot) slot.appendChild(faceEl);
    faceEl.classList.remove('big');
  } else {
    patch($('closed'), closedHTML(cv, st));
    const slot = $('closed').querySelector('.faceSlot'); if (slot && faceEl.parentNode !== slot) slot.appendChild(faceEl);
    faceEl.classList.add('big');
  }
  if (open && !wasOpen && !shapeStill()) { const o = $('open'); o.classList.remove('enter'); void o.offsetWidth; o.classList.add('enter'); }
  wasOpen = open;
  for (const id of acked) if (!store.timers.some(t => t.id === id)) acked.delete(id);
  paintTimers(); syncTick();
  faceEl.dataset.mood = st.mood; syncAnim(); tickLyric(true);
  if ($('status').textContent !== st.text) $('status').textContent = st.text;
  if (form === 'transparent') aim();
  // Main decides open/closed and sizes the window; the page reports pin, held-open, busy (Smart mode keeps a busy notch shown) and its closed view.
  const busy = !!toast || hires.length > 0 || liveAsks().length > 0 || working(snap).length > 0 || !online; // the old page's busy()
  const hk = JSON.stringify([pinned, NotchCore.forcedOpen({ asks: liveAsks().length, hires: hires.length, chatOn, game }), busy]);
  if (hk !== lastHold) { lastHold = hk; const [pn, fo, bz] = JSON.parse(hk); desk.hold({ pinned: pn, forced: fo, busy: bz }); }
  if (cv.kind !== lastCv) { lastCv = cv.kind; desk.closedView(cv.kind); }
  const po = open && !panel && (tab === 'performance' || (tab === 'home' && S.homeCards.includes('performance'))); // load is sampled while it is on screen
  if (po !== lastPerfOpen) { lastPerfOpen = po; desk.perfOpen(po); }
}

// ---------- interaction ----------
const togglePin = () => { pinned = !pinned; if (!pinned) chatOn = false; else desk.focus(); render(); };
const selectTab = (k, focus) => { tab = k; panel = null; render(); if (focus) $('tab-' + k)?.focus(); };
$('notch').addEventListener('click', e => {
  const hb = e.target.closest('[data-hire]');
  if (hb) { api('/api/hire/decide', { id: hb.dataset.hire, approve: hb.dataset.ok === '1' }).catch(err => showToast(err.message, 4000)); return; }
  const qo = e.target.closest('[data-qopt]');
  if (qo) { const [id, qi, label, multi] = qo.dataset.qopt.split('|'); const st = (qsel[id] = qsel[id] || {}); st[qi] = multi === '1' ? ((st[qi] || []).includes(label) ? st[qi].filter(x => x !== label) : [...(st[qi] || []), label]) : [label]; render(); return; }
  const qs = e.target.closest('[data-qsend]');
  if (qs) { const id = qs.dataset.qsend, a = asksOf(snap).find(x => x.perm.askId === id), st = qsel[id] || {}; if (!a) return; const answers = {}; a.perm.questions.forEach((q, qi) => { if ((st[qi] || []).length) answers[q.question] = st[qi].join(', '); }); if (!Object.keys(answers).length) { showToast('Pick an answer first.', 2500); return; } api('/api/decide', { askId: id, decision: 'allow', answers }).catch(err => showToast(err.message, 4000)); return; }
  const ask = e.target.closest('[data-ask]');
  if (ask) {
    ask.disabled = true;
    if (ask.dataset.remember) desk.guard.remember(ask.dataset.remember, 'from the island').catch(() => {});
    const msg = ask.dataset.d === 'deny' ? (document.querySelector('[data-deny-msg="' + ask.dataset.ask + '"]') || {}).value : undefined;
    api('/api/decide', { askId: ask.dataset.ask, decision: ask.dataset.d, always: ask.dataset.always === '1', message: msg ? msg.trim() : undefined }).catch(err => showToast(err.message, 4000));
    return;
  }
  if (e.target.closest('[data-storeretry]')) { loadStore(); render(); return; }
  const tt = e.target.closest('[data-tmtoggle]');
  if (tt) { toggleTimer(tt.dataset.tmtoggle); return; }
  const td = e.target.closest('[data-tmdel]');
  if (td) { commit(s => { s.timers = s.timers.filter(t => t.id !== td.dataset.tmdel); }); return; }
  const tn = e.target.closest('[data-tmnew]');
  if (tn) { addTimer(tn.dataset.tmnew, '', 0); return; }
  const cs = e.target.closest('[data-ctstep]');
  if (cs) { const [id, d] = cs.dataset.ctstep.split('|'), day = NotchCore.dayOf(Date.now());
    commit(s => { const i = s.counters.findIndex(x => x.id === id); if (i < 0) return; const c = NotchCore.counterToday(s.counters[i], day); s.counters[i] = { ...c, count: Math.min(9999, Math.max(0, c.count + +d)) }; }); return; }
  const cd = e.target.closest('[data-ctdel]');
  if (cd) { commit(s => { s.counters = s.counters.filter(c => c.id !== cd.dataset.ctdel); }); return; }
  const nd = e.target.closest('[data-ndel]');
  if (nd) { commit(s => { s.notes = s.notes.filter(n => n.id !== nd.dataset.ndel); }); return; }
  const nm = e.target.closest('[data-nmove]');
  if (nm) { const [id, d] = nm.dataset.nmove.split('|'); commit(s => { const i = s.notes.findIndex(n => n.id === id), j = i + +d; if (i < 0 || j < 0 || j >= s.notes.length) return; [s.notes[i], s.notes[j]] = [s.notes[j], s.notes[i]]; }); return; }
  const tb = e.target.closest('[data-tab]');
  if (tb) { selectTab(tb.dataset.tab); return; }
  if (e.target.closest('#pinBtn') || e.target.closest('#pill')) { togglePin(); return; }
  if (e.target.closest('#setBtn')) { panel = panel === 'settings' ? null : 'settings'; render(); return; }
  const md = e.target.closest('[data-media]');
  if (md) { desk.media(md.dataset.media); return; }
  const ub = e.target.closest('[data-upd]');
  if (ub) { desk.update[ub.dataset.upd === 'install' ? 'install' : 'check']().then(u => { if (u) { upd = u; render(); } }); return; }
  const ua = e.target.closest('[data-upd-auto]');
  if (ua) { desk.update.set({ auto: ua.dataset.updAuto === 'true' }).then(u => { if (u) { upd = u; render(); } }); return; }
  const cm = e.target.closest('[data-cal]');
  if (cm) { calOff += +cm.dataset.cal; render(); return; }
  const cj = e.target.closest('[data-caljoin]');
  if (cj) { desk.calendar.join(cj.dataset.caljoin); return; } // main opens the link it found for this event, never one from the page
  if (e.target.closest('[data-calrefresh]')) { desk.calendar.refresh().then(c => { if (c) { cal = c; render(); } }).catch(() => {}); return; }
  if (e.target.closest('[data-calremove]')) { desk.calendar.set('').then(c => { if (c && c.ok) { cal = c; calMsg = ''; render(); } }).catch(() => {}); return; }
  const gb = e.target.closest('[data-guard]');
  if (gb) { const patch = { [gb.dataset.guard]: gb.dataset.v }; desk.guard.set(patch).then(v => { if (v) GV = v; render(); }).catch(() => {}); return; }
  const st = e.target.closest('[data-set]');
  if (st) { const v = st.dataset.v; setPref({ [st.dataset.set]: v === 'true' ? true : v === 'false' ? false : /^-?\d+$/.test(v) ? +v : v }); return; }
  const hc = e.target.closest('[data-hc]');
  if (hc) { const k = hc.dataset.hc; setPref({ homeCards: S.homeCards.includes(k) ? S.homeCards.filter(x => x !== k) : [...S.homeCards, k] }); return; }
  const hm = e.target.closest('[data-hcmove]');
  if (hm) { const [k, d] = hm.dataset.hcmove.split('|'), a = [...S.homeCards], i = a.indexOf(k), j = i + +d; if (i < 0 || j < 0 || j >= a.length) return; [a[i], a[j]] = [a[j], a[i]]; setPref({ homeCards: a }); return; }
  if (e.target.closest('[data-fpssetup]')) { // the one-time elevated group step; Windows asks for permission
    fpsMsg = 'Waiting for Windows to ask for permission…'; render();
    desk.fpsSetup().then(r => { if (r && r.busy) return; fpsMsg = r && r.ok ? 'Done. Sign out of Windows and back in, then FPS works.' : r && r.declined ? 'Not changed: Windows permission was declined.' : 'Not changed. FPS stays off.'; render(); }).catch(() => { fpsMsg = 'Not changed. FPS stays off.'; render(); });
    return;
  }
  const gd = e.target.closest('[data-gamedel]');
  if (gd) { setPref({ games: S.games.filter(g => g !== gd.dataset.gamedel) }); return; }
  const pin = e.target.closest('[data-pin]');
  if (pin) { const k = pin.dataset.pin; setPref({ pinned: S.pinned.includes(k) ? S.pinned.filter(x => x !== k) : [...S.pinned, k] }); return; }
  if (e.target.closest('[data-reset]')) { setPref({ ...DEF, pinned: ['today', 'reports', 'usage', 'chat', 'calendar', 'settings'] }); return; }
  const dk = e.target.closest('[data-dock]');
  if (dk) {
    const k = dk.dataset.dock;
    if (k === 'chat') { chatOn = !chatOn; tab = 'agents'; panel = null; render(); desk.focus(); setTimeout(() => $('chatIn')?.focus(), 40); }
    else if (k === 'calendar') selectTab('calendar');
    else if (k === 'settings') { panel = panel === 'settings' ? null : 'settings'; render(); }
    else if (k === 'mute') desk.mute(!mute);
    else desk.office(k);
  }
});
$('notch').addEventListener('change', e => {
  const t = e.target;
  if (t.matches('[data-color]')) setPref({ theme: 'custom', accent: t.value });
  else if (t.matches('[data-nshort]')) setPref({ notchShortcut: t.value.trim() });
  else if (t.matches('[data-zone]')) setPref({ zone2: t.value.trim() });
  else if (t.matches('[data-zlabel]')) setPref({ zone2Label: t.value.trim() });
  else if (t.matches('[data-note]')) {
    const n = store.notes.find(x => x.id === t.dataset.note), text = t.value.trim().slice(0, 500);
    if (!n) return; if (!text) { t.value = n.text; return; } // an emptied note is restored; delete removes it
    if (text !== n.text) commit(s => { s.notes.find(x => x.id === n.id).text = text; }, true);
  } else if (t.matches('[data-pom]')) { const k = t.dataset.pom, [lo, hi] = POM[k], v = Math.min(hi, Math.max(lo, Math.round(+t.value) || lo)); t.value = v; commit(s => { s.pomodoro[k] = v; }, true); }
});
$('notch').addEventListener('submit', e => {
  e.preventDefault();
  const f = e.target;
  if (f.matches('[data-noteform]')) {
    const i = f.querySelector('input'), text = i.value.trim().slice(0, 500); if (!text) return;
    if (store.notes.length >= 100) { showToast('100 notes is the limit.', 3000); return; }
    i.value = ''; commit(s => { s.notes.unshift({ id: newId(), text }); }); return;
  }
  if (f.matches('[data-calform]')) { // the link goes to main once and the field is emptied at once
    const i = f.querySelector('input'), link = i.value.trim(); i.value = ''; if (!link) return;
    calMsg = ''; desk.calendar.set(link).then(r => { if (r && r.ok) cal = r; else calMsg = calErr(r && r.error); render(); }).catch(() => {}); return;
  }
  if (f.matches('[data-ctform]')) { // refused (cap, empty name, bad goal): the fields keep what was typed
    const nm = f.querySelector('[name=name]'), gl = f.querySelector('[name=goal]'), name = nm.value.trim().slice(0, 40), goal = Math.round(+gl.value);
    if (gate.state !== 'ready') return;
    if (store.counters.length >= 12) { showToast('12 counters is the limit. Delete one to add more.', 4000); return; }
    if (!name) { showToast('Give the counter a name.', 3000); return; }
    if (!(goal >= 1 && goal <= 999)) { showToast('The daily goal is 1 to 999.', 3000); return; }
    nm.value = ''; commit(s => { s.counters.push({ id: newId(), name, goal, count: 0, day: NotchCore.dayOf(Date.now()) }); }); return;
  }
  if (f.matches('[data-gameform]')) { // same rule as desktop/island-logic.mjs gameName; main validates again
    const i = f.querySelector('input'), n = i.value.trim().toLowerCase().replace(/\.exe$/, '').replace(/\s+/g, '_');
    if (!/^[a-z0-9._-]{1,40}$/.test(n)) { showToast('A game is its program name, like MyGame.exe.', 3000); return; }
    if (S.games.length >= 50) { showToast('50 games is the limit.', 3000); return; }
    i.value = ''; if (!S.games.includes(n)) setPref({ games: [...S.games, n] }); return;
  }
  if (f.matches('[data-tmform]')) { const nm = f.querySelector('[name=name]'); if (addTimer('countdown', nm.value.trim(), f.querySelector('[name=min]').value)) nm.value = ''; return; }
  const input = $('chatIn'), text = input.value.trim(); if (!text) return;
  input.value = '';
  const boss = (snap?.agents || []).find(x => x.isManager);
  (boss && snap.boss?.active ? api('/api/send', { id: boss.id, text }) : api('/api/task', { text }))
    .then(() => showToast('Sent to ' + mgrName() + '.', 2500)).catch(err => showToast(err.message, 4000));
});
tabsEl.addEventListener('keydown', e => { // arrow keys move along the tabs (and select), Home/End jump to the ends
  const T = NotchCore.TABS, i = T.indexOf(e.target.dataset.tab); if (i < 0) return;
  const j = { ArrowRight: i + 1, ArrowLeft: i - 1, Home: 0, End: T.length - 1 }[e.key]; if (j == null) return;
  e.preventDefault(); selectTab(T[(j + T.length) % T.length], true);
});
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') { pinned = chatOn = false; asksOf(snap).forEach(a => dismissed.add(a.perm.askId)); render(); desk.dismiss(); return; }
  if ((e.key === 'Enter' || e.key === ' ') && e.target.id === 'pill') { e.preventDefault(); togglePin(); return; }
  if (e.target.isContentEditable || e.target.closest('input, textarea')) return; // typing never answers an approval
  // Y and N answer only the approval card you have focused (click it or Tab to it), never a card you have not looked at.
  const card = document.activeElement && document.activeElement.closest ? document.activeElement.closest('.ask') : null;
  const btn = card && card.querySelector('[data-ask]'); if (!btn) return;
  const a = asksOf(snap).find(x => x.perm.askId === btn.dataset.ask && !dismissed.has(x.perm.askId)); if (!a) return;
  if (a.perm.questions) return; // a question is answered with its option buttons, never with a key
  const k = e.key.toLowerCase();
  if ((k === 'y' && !a.perm.defaultToNo) || k === 'n') api('/api/decide', { askId: a.perm.askId, decision: k === 'y' ? 'allow' : 'deny' }).catch(err => showToast(err.message, 4000));
});
desk.update.on(u => { upd = u; render(); });
desk.update.get().then(u => { if (u) { upd = u; render(); } });
desk.guard.get().then(v => { if (v) { GV = v; render(); } }).catch(() => {});
desk.onState(st => { shortcutOk = st.notchShortcutOk !== false; if (st.settings) applySettings(st.settings); mode = st.mode; mute = !!st.mute; if (st.form === 'material' || st.form === 'transparent') form = st.form; if (['closed', 'line', 'game', 'open'].includes(st.view)) view = st.view; render(); });
// Game mode just started: opening the notch lands on Performance.
desk.onPerf(p => { const was = !!(perf && perf.game); perf = p && typeof p === 'object' ? p : null; if (perf && perf.game && !was && view !== 'open') { tab = 'performance'; panel = null; } render(); });
desk.onNowPlaying(n => { np = n && typeof n === 'object' ? n : null; render(); });
desk.onCalendar(c => { cal = c && typeof c === 'object' ? c : null; render(); });
desk.onLyrics(l => { lyr = l && Array.isArray(l.lines) ? { key: String(l.key || ''), lines: l.lines.filter(x => Array.isArray(x)).map(([t, text]) => ({ t: +t || 0, text: String(text ?? '') })) } : null; lyrIdx = -2; render(); });
desk.onToggle(togglePin);

// ---------- Tiro face: random blink + look-around (idle), and eyes that follow the cursor while it is near ----------
const faceEl = document.createElement('span'); faceEl.id = 'face'; faceEl.className = 'face'; faceEl.setAttribute('aria-hidden', 'true'); faceEl.innerHTML = '<i class="eye"></i><i class="eye"></i>';
let lastPointer = 0;
const look = (x, y) => { faceEl.style.setProperty('--lx', x + 'px'); faceEl.style.setProperty('--ly', y + 'px'); };
const rnd = (a, b) => a + Math.random() * (b - a);
const blinkOnce = ms => { faceEl.classList.add('blink'); setTimeout(() => faceEl.classList.remove('blink'), ms); };
function blinkLoop() { if (!still() && S.kiroFace && faceEl.dataset.mood !== 'done') { blinkOnce(130); if (Math.random() < .2) setTimeout(() => blinkOnce(110), 260); } setTimeout(blinkLoop, rnd(2200, 6000)); }
function lookLoop() {
  if (still() || faceEl.dataset.mood !== 'idle') look(0, 0);
  else if (Date.now() - lastPointer > 1800) { if (Math.random() < .35) look(0, 0); else look(Math.round(rnd(-2, 2)), Math.round(rnd(-1, 1))); }
  setTimeout(lookLoop, rnd(1600, 4200));
}
blinkLoop(); lookLoop();
document.addEventListener('mousemove', e => {
  if (still() || !S.kiroFace || faceEl.dataset.mood !== 'idle' || !faceEl.isConnected) return;
  const b = faceEl.getBoundingClientRect(), dx = e.clientX - (b.left + b.width / 2), dy = e.clientY - (b.top + b.height / 2), d = Math.hypot(dx, dy) || 1;
  if (d > 260) return; lastPointer = Date.now(); look(+(dx / d * 2).toFixed(1), +(dy / d * 1.2).toFixed(1));
});

// ---------- live data: the same stream the office uses ----------
function connect() {
  const es = new EventSource('/api/stream');
  es.onopen = () => { online = true; render(); };
  es.onmessage = ev => { const next = JSON.parse(ev.data); notice(next); prev = snap = next; online = true; prune(); render(); };
  es.onerror = () => { online = false; render(); };
}
setInterval(render, 15000); // keep the clocks fresh; render() replaces nothing when nothing changed
render(); connect();
