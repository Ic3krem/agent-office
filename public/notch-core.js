// Notch page: pure logic (no DOM), loaded by island.html and by notch-core.test.mjs under Node. Classic script: root.NotchCore.
(function (root) {
  'use strict';
  const TABS = ['home', 'approvals', 'agents', 'calendar', 'timer', 'notes', 'music', 'trackers', 'performance'];
  const CARDS = TABS.slice(1); // every tab but Home has a Home card; desktop/island-logic.mjs HOME_CARDS is the validated copy
  const SIZES = { closed: { w: 180, h: 32 }, line: { w: 400, h: 36 }, game: { w: 360, h: 36 } }; // display copy of desktop/notch-window.mjs (closed kinds)
  const SOON = 15 * 60e3;

  const pad = n => String(n).padStart(2, '0');
  const clock = s => { const h = Math.floor(s / 3600); return (h ? h + ':' + pad(Math.floor(s / 60) % 60) : pad(Math.floor(s / 60))) + ':' + pad(s % 60); }; // mm:ss, h:mm:ss from one hour
  const mmss = ms => clock(Math.max(0, Math.ceil(ms / 1000)));

  // The closed game line: FPS first when present, then GPU load, GPU temperature, CPU load. A missing value is left out, never shown as 0.
  const gameLine = p => [[p && p.fps, ' FPS'], [p && p.gpu, '% GPU'], [p && p.gpuTemp, '°C'], [p && p.cpu, '% CPU']]
    .filter(([v]) => typeof v === 'number' && Number.isFinite(v)).map(([v, u]) => Math.round(v) + u).join(' · ');

  // What the closed notch shows. nextEvent { title, start (ms) }, timer { name, left (ms) } or { name, done: true }, np { title, artist, playing }, game: the perf values while in game mode (else null).
  function closedView({ asks = 0, hires = 0, game = null, nextEvent = null, timer = null, np = null, toast = '', now = Date.now() } = {}) {
    const waiting = (asks || 0) + (hires || 0);
    const right = waiting > 0 ? waiting + (waiting === 1 ? ' approval' : ' approvals') : '';
    if (game) return { kind: 'game', left: gameLine(game), right };
    const soon = nextEvent && nextEvent.start >= now && nextEvent.start - now <= SOON;
    const song = np && np.playing && (np.title || np.artist) ? [np.title, np.artist].filter(Boolean).join(' · ') : '';
    const left = soon ? `${nextEvent.title} in ${Math.ceil((nextEvent.start - now) / 60e3)} min`
      : timer ? (timer.done ? `${timer.name} done` : `${timer.name} ${mmss(timer.left)}`)
      : toast || song; // toast: a goal done/blocked or a new report, shown for a few seconds
    return { kind: left || right ? 'line' : 'closed', left, right };
  }


  // Timers: { kind: countdown|stopwatch|pomodoro, endsAt, startedAt, pausedLeft, round, phase } (ms epoch). Running countdown: endsAt set. Paused: pausedLeft set.
  // Stopwatch: running = startedAt set and pausedLeft null; pausedLeft holds the elapsed time while paused. A stopped pomodoro has endsAt null and pausedLeft 0.
  function timerView(t, now) {
    const sw = t.kind === 'stopwatch';
    const left = sw ? Math.max(0, t.pausedLeft != null ? t.pausedLeft : t.startedAt != null ? now - t.startedAt : 0)
      : t.endsAt != null ? Math.max(0, t.endsAt - now) : t.pausedLeft || 0;
    const s = Math[sw ? 'floor' : 'ceil'](left / 1000);
    return { left, done: !sw && left <= 0, label: clock(s) };
  }
  // Counts down (or up) right now: a stopwatch that was started and not paused, or a countdown whose end is still ahead.
  const timerRunning = (t, now) => t.kind === 'stopwatch' ? t.startedAt != null && t.pausedLeft == null : t.endsAt != null && t.endsAt > now;
  // The phase that follows a finished one, starting at `now`: focus, break, focus ... and stopped after cfg.rounds focus phases.
  function pomodoroNext(t, cfg, now) {
    if (t.phase === 'focus') {
      if (t.round >= cfg.rounds) return { ...t, endsAt: null, pausedLeft: 0 };
      return { ...t, phase: 'break', startedAt: now, endsAt: now + cfg.rest * 60e3, pausedLeft: null };
    }
    return { ...t, phase: 'focus', round: t.round + 1, startedAt: now, endsAt: now + cfg.focus * 60e3, pausedLeft: null };
  }
  // Ids whose end time passed since the last check; the caller sets lastChecked = now afterwards, so each id fires once whatever the gap.
  const dueTimers = (timers, lastChecked, now) => (timers || []).filter(t => t.endsAt != null && t.endsAt > lastChecked && t.endsAt <= now).map(t => t.id);

  // The page's store wrapper: nothing is written until the stored data has been read. A failed or empty read keeps writes off until a retry succeeds.
  function storeGate(get, set) {
    const g = { state: 'loading', data: null,
      load() { g.state = 'loading'; return new Promise(r => r(get())).then(s => { if (s && typeof s === 'object') { g.data = s; g.state = 'ready'; } else g.state = 'failed'; return g.state; }, () => (g.state = 'failed')); },
      write(s) { return g.state === 'ready' ? Promise.resolve(set(s)) : null; } };
    return g;
  }

  // Trackers. usage = snapshot usage ({ days:[{day,cost,tokens,out}] oldest first, 7 days }), limits = planLimits() result: null (not read yet), { error }, { available:false } or { session:{pct,resets}, weekly }.
  const dayOf = t => { const d = new Date(t); return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }; // local calendar day
  const usd = v => '$' + (v >= 100 ? v.toFixed(0) : v.toFixed(2));
  const tok = v => v >= 1e9 ? (v / 1e9).toFixed(1) + 'B' : v >= 1e6 ? (v / 1e6).toFixed(1) + 'M' : v >= 1e4 ? Math.round(v / 1e3) + 'K' : String(v);
  function resetNote(at, now) { // at: epoch ms or an ISO string (the SDK's resets_at); anything unparseable gives no note
    const t = at == null || at === '' ? NaN : +new Date(at); if (Number.isNaN(t)) return '';
    const h = (t - now) / 36e5; if (h <= 0) return 'Resets soon';
    if (h < 1) return 'Resets in ' + Math.max(1, Math.round(h * 60)) + ' min';
    if (h < 24) return 'Resets in ' + Math.round(h) + ' h';
    const d = new Date(t); // same format as the Usage window
    return 'Resets on ' + d.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' }) + ' ' + d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  }
  function gauges({ usage, limits, now = Date.now() } = {}) {
    const none = (id, label, note) => ({ id, label, value: 'Not available', pct: null, note });
    const plan = (id, label, w) => {
      if (!limits) return none(id, label, 'Plan limits have not been read yet.');
      if (limits.error) return none(id, label, 'Could not read plan limits: ' + limits.error);
      if (limits.available === false) return none(id, label, 'Plan limits do not apply to this login (API key or cloud provider).');
      if (!w || typeof w.pct !== 'number') return none(id, label, 'No figure for this window.');
      return { id, label, value: Math.round(w.pct) + '%', pct: Math.min(100, Math.max(0, w.pct)), note: resetNote(w.resets, now) };
    };
    const days = usage && Array.isArray(usage.days) ? usage.days.slice(-7) : null, today = days && days.find(d => d.day === dayOf(now));
    const API = 'API value (list prices), not a bill';
    const g = [plan('session', 'Plan, 5-hour session', limits && limits.session), plan('weekly', 'Plan, weekly', limits && limits.weekly)];
    if (!days) return g.concat([none('costToday', 'Cost today', 'No usage data yet.'), none('costWeek', 'Cost, last 7 days', 'No usage data yet.'), none('tokensToday', 'Output tokens today', 'No usage data yet.')]);
    return g.concat([
      { id: 'costToday', label: 'Cost today', value: usd(today ? today.cost || 0 : 0), pct: null, note: API },
      { id: 'costWeek', label: 'Cost, last 7 days', value: usd(days.reduce((a, d) => a + (d.cost || 0), 0)), pct: null, note: API },
      { id: 'tokensToday', label: 'Output tokens today', value: tok(today ? today.out || 0 : 0), pct: null, note: 'Output only; all tokens today: ' + tok(today ? today.tokens || 0 : 0) },
    ]);
  }
  // A counter { id, name, goal, count, day }: a new local day starts again at 0 (applied when drawn, written on the next change).
  const counterToday = (c, day) => c.day === day ? c : { ...c, count: 0, day };

  // Held open by the page: anything waiting, or the chat box. In game mode a waiting item only shows its count.
  const forcedOpen = ({ asks = 0, hires = 0, chatOn = false, game = null } = {}) => !!chatOn || (!game && (asks || 0) + (hires || 0) > 0);

  const knownCards = ids => (Array.isArray(ids) ? ids : []).filter(k => CARDS.includes(k)); // the page never draws a card id it does not know
  root.NotchCore = { TABS, CARDS, SIZES, closedView, gameLine, forcedOpen, mmss, knownCards, storeGate, gauges, counterToday, dayOf, timerView, timerRunning, pomodoroNext, dueTimers };
})(globalThis);
