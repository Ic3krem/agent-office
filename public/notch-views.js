// Notch page: HTML for the closed notch, every tab, the Home cards and the settings panel. Reads the page state kept in notch-page.js.
// To add a tab body: give TAB_BODY[id] a function returning HTML. To add a Home card: give CARD_BODY[id] one (it fills <section data-card=id>).

// One stroke weight for every icon (24-unit grid, drawn with .ic in island.html).
const ICONS = {
  home: 'M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z',
  approvals: 'M12 3l7 3v5c0 5-3.5 8.5-7 10-3.5-1.5-7-5-7-10V6z M9 12l2 2 4-4',
  agents: 'M16 20v-1a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v1 M9.5 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7 M21 20v-1a4 4 0 0 0-3-3.9 M15.5 4.2a3.5 3.5 0 0 1 0 6.6',
  calendar: 'M4 6h16v14H4z M4 10h16 M8 3v4 M16 3v4',
  timer: 'M12 21a8 8 0 1 0 0-16 8 8 0 0 0 0 16 M12 9v4l2.5 2 M10 2h4',
  notes: 'M6 3h9l4 4v14H6z M14 3v5h5 M9 13h7 M9 17h5',
  music: 'M9 18V5l11-2v13 M9 18a3 3 0 1 1-6 0 3 3 0 0 1 6 0 M20 16a3 3 0 1 1-6 0 3 3 0 0 1 6 0',
  trackers: 'M4 20V11 M10 20V5 M16 20v-6 M21 20H3',
  performance: 'M3 12h4l3 7 4-14 3 7h4',
  pin: 'M12 16v6 M9 3h6l-1 6 3 3v2H7v-2l3-3z',
  settings: 'M4 6h9 M17 6h3 M15 4v4 M4 12h3 M11 12h9 M9 10v4 M4 18h11 M19 18h1 M17 16v4',
  today: 'M9 6h11 M9 12h11 M9 18h11 M4.5 6h.01 M4.5 12h.01 M4.5 18h.01',
  reports: 'M6 3h9l4 4v14H6z M14 3v5h5 M9 13h7 M9 17h5',
  usage: 'M12 3a9 9 0 1 0 9 9h-9z M15 2.6A9 9 0 0 1 21.4 9H15z',
  office: 'M4 21V6l8-3 8 3v15 M9 21v-5h6v5 M8 9h.01 M12 9h.01 M16 9h.01',
  chat: 'M4 5h16v11H9l-5 4z',
  mute: 'M6 16v-5a6 6 0 0 1 12 0v5l2 2H4z M10 21h4',
  prev: 'M6 5v14 M18 5l-9 7 9 7z', play: 'M7 4l13 8-13 8z', pause: 'M8 5v14 M16 5v14', next: 'M18 5v14 M6 5l9 7-9 7z',
  alert: 'M12 3l10 18H2z M12 10v5 M12 18h.01',
  left: 'M15 5l-7 7 7 7', right: 'M9 5l7 7-7 7', up: 'M6 15l6-6 6 6', trash: 'M4 7h16 M9 7V4h6v3 M6 7l1 13h10l1-13 M10 11v5 M14 11v5', down: 'M6 9l6 6 6-6',
};
const ic = (k, s = 18) => `<svg class="ic" viewBox="0 0 24 24" width="${s}" height="${s}" aria-hidden="true" focusable="false"><path d="${ICONS[k] || ''}"/></svg>`;
const TAB_LABEL = { home: 'Home', approvals: 'Approvals', agents: 'Agents', calendar: 'Calendar', timer: 'Timer', notes: 'Notes', music: 'Music', trackers: 'Trackers', performance: 'Performance' };
const ACT = { today: 'Today', reports: 'Reports', usage: 'Usage', office: 'Office', chat: 'Chat', calendar: 'Calendar', mute: 'Chime', settings: 'Settings' };

const asksOf = s => (s?.agents || []).filter(a => a.perm);
const hiresOf = s => s?.hires || [];
const mgrName = () => snap?.names?.tiro || 'Tiro';
const working = s => (s?.agents || []).filter(a => a.status === 'working' || a.isManager && s.boss?.running);
const openGoals = () => (snap?.goals || []).filter(g => ['todo', 'doing', 'blocked'].includes(g.status));
const guardText = g => [g.title, 'Rules: ' + (g.rules || []).join(', '), (g.files && g.files.length) ? 'Files: ' + g.files.map(f => f.path + ' (' + f.why + ((f.preview && f.preview.length) ? '; ' + f.preview.slice(0, 3).join(', ') : '') + ')').join('; ') : '', g.host ? 'Destination: ' + g.host : '', g.exact === false ? 'Payload: estimated' : 'Payload: exact', g.source ? 'Source: ' + g.source : '', g.rememberable ? '' : 'This kind of request cannot be remembered.'].filter(Boolean).join('\n');
const clockStr = (zone, d = new Date()) => { try { return new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hour12: !!S.hour12, ...(zone ? { timeZone: zone } : {}) }).format(d).replace(/\s?([ap])m$/i, (_m, x) => ' ' + x.toUpperCase() + 'M'); } catch { return ''; } };
const dateStr = (d = new Date()) => d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });

// ---------- the closed notch ----------
function closedHTML(cv, st) {
  const tm = S.clockInPill && cv.kind === 'closed' ? `<span class="tm">${esc(clockStr(''))}</span>` : '';
  const music = S.nowPlaying && np?.playing ? np : null;
  const songLeft = music && cv.left && cv.left === [music.title, music.artist].filter(Boolean).join(' · ');
  const left = !cv.left ? '' : songLeft && lyricsOn() ? `<span class="lyr" data-fb="${esc(cv.left)}" title="${esc(cv.left)}"></span>` : `<span class="lt" title="${esc(cv.left)}">${esc(cv.left)}</span>`;
  return `<div class="pill ${cv.kind}" id="pill" role="button" tabindex="0" aria-label="Open the notch"><span class="faceSlot"></span><span class="dot"></span>${left}${cv.kind === 'line' && !cv.left ? '<span class="lt"></span>' : ''}${tm}${cv.right ? `<span class="rt">${esc(cv.right)}</span>` : ''}<span class="sr">${esc(st.text)}</span></div>`;
}

// ---------- approvals: the full cards (Approvals tab) and the top one (Home card) ----------
function askHTML(a) {
  const id = esc(a.perm.askId);
  if (a.perm.questions) {
    const st = (qsel[a.perm.askId] = qsel[a.perm.askId] || {});
    return `<div class="ask" tabindex="0" data-fk="ask:${id}"><span class="who">${esc(a.name)} asks you</span>${a.perm.questions.map((q, qi) => `<div class="q"><span class="who">${esc(q.header ? q.header + ': ' : '')}${esc(q.question)}</span><div class="row">${q.options.map(o => `<button class="btn${(st[qi] || []).includes(o.label) ? ' yes' : ''}" data-qopt="${id}|${qi}|${esc(o.label)}|${q.multiSelect ? 1 : 0}" title="${esc(o.description)}">${esc(o.label)}</button>`).join('')}</div></div>`).join('')}<div class="row"><button class="btn yes" data-qsend="${id}">Send answers</button><button class="btn no" data-ask="${id}" data-d="deny">Skip</button></div></div>`;
  }
  return `<div class="ask" tabindex="0" data-fk="ask:${id}"><span class="who">${esc(a.name)} wants to run ${esc(a.perm.short)}</span><code>${esc(a.perm.cmd)}</code>${a.perm.preview ? `<pre class="empty" style="max-height:120px;overflow:auto;white-space:pre-wrap;margin:4px 0">${esc(a.perm.preview.slice(0, 1500))}</pre>` : ''}
    ${a.perm.guard ? `<pre class="empty" style="white-space:pre-wrap;margin:4px 0;color:#ffd28a">${esc(guardText(a.perm.guard))}</pre>` : ''}
    ${a.perm.why && !a.perm.guard ? `<span class="empty">${esc(a.perm.why.slice(0, 140))}</span>` : ''}
    <div class="row"><button class="btn yes" data-ask="${id}" data-d="allow">Yes${a.perm.defaultToNo ? '' : '<kbd>Y</kbd>'}</button>${a.perm.guard?.rememberable ? `<button class="btn" data-ask="${id}" data-d="allow" data-remember="${esc(a.perm.guard.rememberKey)}" title="Allow this exact action again for 24 hours">Yes, remember this exact action</button>` : ''}${a.perm.canAlways && !a.perm.guard ? `<button class="btn" data-ask="${id}" data-d="allow" data-always="1" title="Writes the permission rule Claude Code suggests">Yes, and don't ask again</button>` : ''}<button class="btn no" data-ask="${id}" data-d="deny">No<kbd>N</kbd></button><input class="why" data-deny-msg="${id}" data-fk="why:${id}" placeholder="No, and tell Claude what to do instead" aria-label="No, and tell Claude what to do instead" style="flex:1;min-width:120px"><button class="btn" data-ask="${id}" data-d="terminal" title="Let the terminal ask instead">Terminal</button></div></div>`;
}
const hireHTML = h => `<div class="ask" tabindex="0" data-fk="hire:${esc(h.id)}"><span class="who">${esc(mgrName())} wants to hire ${esc(h.name)} (${esc(h.role)})</span><code>${esc((h.goalText || '').slice(0, 100))}</code><span class="empty">${esc(h.why)}</span>${h.prompt ? `<span class="empty">Full request: ${h.prompt.length} characters</span><pre class="empty" tabindex="0" style="max-height:120px;overflow:auto;white-space:pre-wrap;margin:4px 0">Prompt: ${esc(h.prompt)}</pre>` : ''}
    <div class="row"><button class="btn yes" data-hire="${esc(h.id)}" data-ok="1">Approve hire</button><button class="btn no" data-hire="${esc(h.id)}" data-ok="0">Deny</button></div></div>`;
// Home: the first waiting item, short. Questions and the extra choices (remember, don't ask again, Terminal, a reason) are on the Approvals tab.
function topAskHTML() {
  const asks = asksOf(snap), hires = hiresOf(snap), more = asks.length + hires.length - 1;
  const rest = more > 0 ? `<button class="link" data-tab="approvals">+${more} more</button>` : '';
  const a = asks[0];
  if (a && a.perm.questions) return `<div class="ask" tabindex="0" data-fk="ask:${esc(a.perm.askId)}"><span class="who">${esc(a.name)} asks you</span><span>${esc(a.perm.questions[0]?.question || '')}</span><div class="row"><button class="btn yes" data-tab="approvals">Answer</button>${rest}</div></div>`;
  if (a) return `<div class="ask" tabindex="0" data-fk="ask:${esc(a.perm.askId)}"><span class="who">${esc(a.name)} wants to run ${esc(a.perm.short)}</span><code>${esc(a.perm.cmd)}</code><div class="row"><button class="btn yes" data-ask="${esc(a.perm.askId)}" data-d="allow">Allow${a.perm.defaultToNo ? '' : '<kbd>Y</kbd>'}</button><button class="btn no" data-ask="${esc(a.perm.askId)}" data-d="deny">Deny<kbd>N</kbd></button><button class="link" data-tab="approvals">More choices</button>${rest}</div></div>`;
  const h = hires[0];
  if (h) return `<div class="ask" tabindex="0" data-fk="hire:${esc(h.id)}"><span class="who">${esc(mgrName())} wants to hire ${esc(h.name)} (${esc(h.role)})</span><code>${esc((h.goalText || '').slice(0, 100))}</code><div class="row"><button class="btn yes" data-hire="${esc(h.id)}" data-ok="1">Approve</button><button class="btn no" data-hire="${esc(h.id)}" data-ok="0">Deny</button>${rest}</div></div>`;
  return '<span class="empty">Nothing is waiting for you.</span>';
}

// ---------- agents, music, calendar pieces ----------
const sesHTML = n => (snap?.agents || []).slice(0, n).map(a => `<div class="ses"><span class="nm">${esc(a.name)}</span><span class="tk">${esc(a.task || a.role || '')}</span><span class="st ${esc(a.status)}">${esc(a.status)}</span></div>`).join('');
const goalsHTML = n => openGoals().slice(0, n).map(g => `<div class="goal">${g.status === 'blocked' ? '<span class="sr">Blocked: </span>' + ic('alert', 14) : ''}<span>${esc(g.text.slice(0, 90))}</span></div>`).join('');
function dockHTML() {
  return S.pinned.filter(k => ACT[k]).map(k => { const l = k === 'reports' && snap?.reportsN ? 'Reports ' + snap.reportsN : k === 'mute' && mute ? 'Muted' : ACT[k];
    return `<button class="btn" data-dock="${k}" title="${esc(l)}" aria-label="${esc(l)}">${ic(k)}<span class="lb">${esc(l)}</span></button>`; }).join('');
}
const costToday = () => { const d = snap?.usage?.days; const c = d && d.length ? d[d.length - 1].cost : null; return Number.isFinite(c) ? '$' + c.toFixed(2) : ''; };
function mediaHTML(large) {
  if (!S.nowPlaying) return '<span class="empty">Now playing is off. Turn it on in Settings.</span>';
  if (!np) return '<span class="empty">Nothing is playing.</span>';
  const s = large ? 22 : 16;
  return `<div class="media${large ? ' large' : ''}"><span class="eq${np.playing ? '' : ' still'}"><i></i><i></i><i></i></span><span class="meta"><span class="t">${esc(np.title || np.artist)}</span><span class="a">${esc([np.artist, np.app].filter(Boolean).join(' · '))}</span>${lyricsOn() ? '<span class="lyr"></span>' : ''}</span></div>
    <div class="row"><button class="btn" data-media="prev" aria-label="Previous" title="Previous" ${np.canPrev ? '' : 'disabled'}>${ic('prev', s)}</button><button class="btn" data-media="playpause" aria-label="${np.playing ? 'Pause' : 'Play'}" title="${np.playing ? 'Pause' : 'Play'}" ${np.canPlayPause ? '' : 'disabled'}>${ic(np.playing ? 'pause' : 'play', s)}</button><button class="btn" data-media="next" aria-label="Next" title="Next" ${np.canNext ? '' : 'disabled'}>${ic('next', s)}</button></div>`;
}
function monthHTML() {
  const now = new Date(), d = new Date(now.getFullYear(), now.getMonth() + calOff, 1), y = d.getFullYear(), m = d.getMonth();
  const lead = (new Date(y, m, 1).getDay() - S.weekStart + 7) % 7, n = new Date(y, m + 1, 0).getDate();
  const cells = [...Array(lead).fill(0), ...Array.from({ length: n }, (_, i) => i + 1)];
  const names = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'].map((_, i, a) => a[(i + S.weekStart) % 7]);
  const isNow = x => x && calOff === 0 && x === now.getDate();
  return `<div class="calhead"><button class="btn" data-cal="-1" aria-label="Previous month">${ic('left')}</button><b>${esc(d.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' }))}</b><button class="btn" data-cal="1" aria-label="Next month">${ic('right')}</button></div>
    <div class="cal">${names.map(x => `<span class="h">${x}</span>`).join('')}${cells.map(x => `<span class="d ${isNow(x) ? 'today' : ''}">${x || ''}</span>`).join('')}</div>`;
}
function clocksHTML() {
  const now = new Date(), two = S.zone2 ? `<span><b>${esc(clockStr(S.zone2))}</b><small>${esc(S.zone2Label || S.zone2)}</small></span>` : '';
  return `<div class="clock"><span><b>${esc(clockStr(''))}</b><small>${esc(now.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'short' }))}</small></span>${two}</div>`;
}


// ---------- calendar events (cal: the view main pushes; the page never holds the link, only linked and host; calMsg: a refused paste) ----------
const CAL_ERR = { 'bad-link': 'That link, or a redirect it leads to, is not an https address on the internet.', network: 'The calendar host could not be reached.', http: 'The calendar host refused the link.', 'too-big': 'The calendar is larger than 2 MB.', 'not-calendar': 'The link did not return a calendar.', timeout: 'The calendar host did not answer within 10 seconds.', 'no-storage': 'This system has no OS key storage, so a calendar link cannot be kept safely.', partial: 'The calendar is too large, so only part of it is shown.' };
const calErr = k => CAL_ERR[k] || 'The calendar could not be read.';
const dayEnd = () => { const n = new Date(); return new Date(n.getFullYear(), n.getMonth(), n.getDate() + 1).getTime(); };
function evHTML(e, card) {
  const when = (card && e.start >= dayEnd() ? 'Tomorrow ' : '') + (e.allDay ? 'All day' : clockStr('', new Date(e.start))), t = e.title || '(no title)';
  return `<div class="ses ev"><span class="nm">${esc(when)}</span><span class="tk" title="${esc(t + (e.where ? ' · ' + e.where : ''))}">${esc(t)}${e.where && !card ? ` <small>${esc(e.where)}</small>` : ''}</span>${e.join ? `<button class="btn yes" data-caljoin="${esc(e.id)}" aria-label="Join ${esc(t)}">Join</button>` : ''}</div>`;
}
const calFormHTML = () => cal && cal.available === false ? `<div class="note bad">${calErr('no-storage')}</div>` : `<form class="row" data-calform><input type="password" autocomplete="off" spellcheck="false" placeholder="Paste a private calendar link (ICS)" data-fk="cal-link" aria-label="Private calendar link" style="flex:1;min-width:160px"><button class="btn yes" type="submit">Save</button></form>
  <div class="hint">Outlook: Settings, Calendar, Shared calendars, Publish a calendar; choose "Can view all details", then copy the ICS link. Google Calendar: Settings, your calendar, Integrate calendar, then copy "Secret address in iCal format". Anyone with this link can read your calendar: it is stored encrypted on this PC and sent only to its own host.</div>`;
function calendarHTML() {
  const month = `<div class="col">${monthHTML()}</div>`;
  if (!cal || !cal.linked) return `<div class="cols"><div class="col">${clocksHTML()}<span class="label">Calendar link</span>${calMsg ? `<div class="note bad" role="alert">${esc(calMsg)}</div>` : ''}${calFormHTML()}</div>${month}</div>`;
  const t1 = dayEnd(), ev = cal.events || [], day = (l, list) => `<span class="label">${l}</span>${list.map(e => evHTML(e)).join('') || '<span class="empty">No events.</span>'}`;
  return `<div class="cols"><div class="col">${clocksHTML()}
    <div class="row"><span class="hint" style="flex:1;min-width:0">${cal.fetchedAt ? 'Updated ' + esc(clockStr('', new Date(cal.fetchedAt))) : 'Not loaded yet'} · ${esc(cal.host)}</span><button class="btn" data-calrefresh>Refresh</button><button class="btn no" data-calremove>Remove link</button></div>
    ${cal.error ? `<div class="note bad" role="alert">${esc(calErr(cal.error))}${ev.length ? ' These are the events from the last update.' : ''}</div>` : ''}${cal.partial ? `<div class="note" role="status">${esc(calErr('partial'))}</div>` : ''}
    ${day('Today', ev.filter(e => e.start < t1))}${day('Tomorrow', ev.filter(e => e.start >= t1))}</div>${month}</div>`;
}

// ---------- timers and notes (store: notes[{id,text}], timers[...], pomodoro; times are painted by paintTimers() so typing is never disturbed) ----------
const storeWaitHTML = () => gate.state === 'failed' ? '<div class="col"><span class="empty">Could not load your notes and timers.</span><div class="row"><button class="btn" data-storeretry>Retry</button></div></div>' : '<span class="empty">Loading...</span>';
const timerName = t => t.name || { countdown: 'Timer', stopwatch: 'Stopwatch', pomodoro: 'Pomodoro' }[t.kind];
const timerTitle = t => t.kind === 'pomodoro' ? `${timerName(t)} · ${t.phase === 'break' ? 'break' : 'focus'} ${t.round}/${store.pomodoro.rounds}` : timerName(t);
function timerRowHTML(t, ctl) {
  const v = NotchCore.timerView(t, Date.now()), sw = t.kind === 'stopwatch', run = NotchCore.timerRunning(t, Date.now()), paused = !sw && !v.done && t.endsAt == null || sw && t.pausedLeft != null;
  const nm = esc(timerTitle(t));
  const b = ctl ? `${v.done ? '' : `<button class="btn" data-tmtoggle="${t.id}" aria-label="${run ? 'Pause' : 'Resume'} ${nm}">${ic(run ? 'pause' : 'play', 16)}</button>`}<button class="btn" data-tmdel="${t.id}" aria-label="Delete ${nm}">${ic('trash', 16)}</button>` : '';
  return `<div class="trow${v.done ? ' done' : ''}"><span class="tn" title="${nm}">${nm}${paused ? ' <small>paused</small>' : ''}</span><span class="tl" data-tl="${t.id}"></span>${b}</div>`;
}
const timerFormHTML = () => { const p = store.pomodoro, num = (k, lo, hi, l) => `<label class="num"><span>${l}</span><input type="number" min="${lo}" max="${hi}" value="${p[k]}" data-pom="${k}" data-fk="pom-${k}" aria-label="Pomodoro ${l} (${lo}-${hi})"></label>`;
  return `<form class="row" data-tmform="countdown"><input type="number" min="1" max="1440" value="5" data-fk="tm-min" name="min" aria-label="Minutes"><input type="text" maxlength="40" placeholder="Name (optional)" data-fk="tm-name" name="name" aria-label="Timer name" style="flex:1;min-width:90px"><button class="btn yes" type="submit">Start timer</button></form>
    <div class="row"><button class="btn" data-tmnew="stopwatch">${ic('timer', 16)} Stopwatch</button><button class="btn" data-tmnew="pomodoro">${ic('timer', 16)} Pomodoro ${p.focus}/${p.rest} x${p.rounds}</button></div>
    <div class="row">${num('focus', 1, 180, 'Focus min')}${num('rest', 1, 60, 'Rest min')}${num('rounds', 1, 12, 'Rounds')}</div>`; };
function timersHTML() { if (gate.state !== 'ready') return storeWaitHTML(); const ts = store.timers;
  return `<div class="cols"><div class="col"><span class="label">New</span>${timerFormHTML()}${ts.length >= 10 ? '<span class="empty">10 timers is the limit. Delete one to add more.</span>' : ''}</div>
    <div class="col"><span class="label">Timers · ${ts.length}</span>${ts.map(t => timerRowHTML(t, true)).join('') || '<span class="empty">No timers yet.</span>'}</div></div>`; }
const timerCardHTML = () => gate.state !== 'ready' ? storeWaitHTML() : store.timers.slice(0, 3).map(t => timerRowHTML(t, false)).join('') || '<span class="empty">No timers. Start one on the Timer tab.</span>';
const noteFormHTML = k => `<form class="row" data-noteform><input type="text" maxlength="500" placeholder="New note" data-fk="note-new-${k}" aria-label="New note" style="flex:1;min-width:90px"><button class="btn yes" type="submit">Add</button></form>`;
function notesHTML() { if (gate.state !== 'ready') return storeWaitHTML(); const n = store.notes;
  return `<div class="col">${noteFormHTML('tab')}${n.map((x, i) => `<div class="nrow"><input type="text" maxlength="500" value="${esc(x.text)}" data-note="${x.id}" data-fk="note:${x.id}" aria-label="Note ${i + 1}" title="${esc(x.text)}"><button class="btn" data-nmove="${x.id}|-1" aria-label="Move note ${i + 1} up" ${i ? '' : 'disabled'}>${ic('up', 16)}</button><button class="btn" data-nmove="${x.id}|1" aria-label="Move note ${i + 1} down" ${i < n.length - 1 ? '' : 'disabled'}>${ic('down', 16)}</button><button class="btn" data-ndel="${x.id}" aria-label="Delete note ${i + 1}">${ic('trash', 16)}</button></div>`).join('') || '<span class="empty">No notes yet.</span>'}${n.length >= 100 ? '<span class="empty">100 notes is the limit.</span>' : ''}</div>`; }
const notesCardHTML = () => gate.state !== 'ready' ? storeWaitHTML() : store.notes.slice(0, 2).map(x => `<div class="ntxt" title="${esc(x.text)}">${esc(x.text)}</div>`).join('') + (store.notes.length ? '' : '<span class="empty">No notes yet.</span>') + noteFormHTML('card');

// ---------- trackers: gauges from the snapshot's usage and limits; counters from the store (a new local day reads 0 until the next change) ----------
function gaugeHTML(g) {
  const bar = g.pct == null ? '' : `<span class="gbar" aria-hidden="true"><i style="width:${Math.round(g.pct)}%"></i></span>`; // static: no animation; the number is the text beside it
  return `<div class="gauge"><span class="gl">${esc(g.label)}</span>${bar}<b class="gv">${esc(g.value)}</b>${g.note ? `<small class="gn">${esc(g.note)}</small>` : ''}</div>`;
}
const gaugesOf = ids => NotchCore.gauges({ usage: snap?.usage, limits: snap?.usage?.limits, now: Date.now() }).filter(g => !ids || ids.includes(g.id));
function counterRowHTML(c0) {
  const c = NotchCore.counterToday(c0, NotchCore.dayOf(Date.now())), nm = esc(c.name), pct = Math.min(100, Math.round(c.count / c.goal * 100));
  return `<div class="crow"><span class="tn" title="${nm}">${nm}</span><span class="gbar" aria-hidden="true"><i style="width:${pct}%"></i></span><b class="gv">${c.count} / ${c.goal}${c.count >= c.goal ? ' <small>goal reached</small>' : ''}</b>
    <button class="btn" data-ctstep="${c.id}|-1" aria-label="Take one from ${nm}" ${c.count ? '' : 'disabled'}>&minus;</button><button class="btn" data-ctstep="${c.id}|1" aria-label="Add one to ${nm}" ${c.count >= 9999 ? 'disabled' : ''}>+</button><button class="btn" data-ctdel="${c.id}" aria-label="Delete ${nm}">${ic('trash', 16)}</button></div>`;
}
const counterFormHTML = () => `<form class="row" data-ctform><input type="text" maxlength="40" placeholder="Counter name, e.g. Water" data-fk="ct-name" name="name" aria-label="Counter name" style="flex:1;min-width:90px"><input type="number" min="1" max="999" value="8" data-fk="ct-goal" name="goal" aria-label="Daily goal (1-999)"><button class="btn yes" type="submit">Add</button></form>`;
function trackersHTML() {
  if (gate.state !== 'ready') return storeWaitHTML();
  const cs = store.counters;
  return `<div class="cols"><div class="col"><span class="label">Gauges</span>${gaugesOf().map(gaugeHTML).join('')}</div>
    <div class="col"><span class="label">Counters · ${cs.length} of 12</span>${cs.map(counterRowHTML).join('') || '<span class="empty">No counters yet. Add one, like Water with a goal of 8; it starts again each day.</span>'}${cs.length >= 12 ? '<span class="empty">12 counters is the limit. Delete one to add more.</span>' : ''}${counterFormHTML()}</div></div>`;
}
const trackersCardHTML = () => gaugesOf(['session', 'weekly']).map(gaugeHTML).join('') + (gate.state !== 'ready' ? storeWaitHTML() : store.counters.slice(0, 2).map(counterRowHTML).join('') || '<span class="empty">No counters yet. Add one on the Trackers tab.</span>');

// ---------- performance: perf from main; a missing value says so, never 0 ----------
const fin = v => typeof v === 'number' && Number.isFinite(v);
function perfRows() {
  const p = perf || {}, pct = v => (fin(v) ? { pct: Math.min(100, Math.max(0, v)), value: Math.round(v) + '%' } : { pct: null, value: 'Not available' });
  return [{ label: 'GPU load', ...pct(p.gpu) }, { label: 'GPU temperature', pct: null, value: fin(p.gpuTemp) ? Math.round(p.gpuTemp) + '°C' : 'Not available' },
    { label: 'CPU load', ...pct(p.cpu) }, { label: 'Memory in use', pct: null, value: fin(p.mem) ? p.mem.toFixed(1) + ' GB' : 'Not available' }];
}
// Frame rate (game mode, Windows, PresentMon): FPS now, 1% low, average, and the last 120 frame times as a static strip (values only, never animated).
const fpsVal = v => (fin(v) ? Math.round(v) + ' FPS' : 'Not available');
const fpsRows = () => [{ label: 'Frame rate', pct: null, value: fpsVal(perf && perf.fps) }, { label: '1% low', pct: null, value: fpsVal(perf && perf.fpsLow) }, { label: 'Average', pct: null, value: fpsVal(perf && perf.fpsAvg) }];
function frameStrip(ms) {
  const l = (Array.isArray(ms) ? ms : []).filter(fin).slice(-120); if (!l.length) return '';
  const top = Math.max(34, ...l); // 34 ms (about 30 FPS) is the strip's minimum height, so a smooth game reads as short bars
  return `<svg class="ftstrip" viewBox="0 0 120 30" preserveAspectRatio="none" role="img" aria-label="Last ${l.length} frame times, longest ${Math.round(Math.max(...l))} ms">${l.map((v, i) => { const h = Math.max(0.5, v / top * 30); return `<rect x="${i + 120 - l.length}" y="${(30 - h).toFixed(2)}" width="0.8" height="${h.toFixed(2)}"/>`; }).join('')}</svg>`;
}
const fpsNote = () => {
  const p = perf || {};
  if (p.fpsState === 'on') return '';
  if (p.fpsState === 'unavailable') return 'FPS unavailable: the bundled PresentMon did not match its recorded checksum, so it was not run.';
  return p.fpsState === 'waiting' ? 'Waiting for frames from the game.' : 'Frame rate shows here while game mode is on.';
};
const fpsBlock = () => (perf && perf.game ? `${fpsRows().map(gaugeHTML).join('')}${frameStrip(perf.frames)}${fpsNote() ? `<span class="empty">${esc(fpsNote())}</span>` : ''}` : '');
const perfHTML = () => `<div class="cols"><div class="col"><span class="label">${perf && perf.game ? 'Game mode' + (perf.proc ? ' · ' + esc(perf.proc) : '') : 'This PC'}</span>${fpsBlock()}${perfRows().map(gaugeHTML).join('')}</div>
  <div class="col"><span class="label">About</span><span class="empty">Load is updated every 1.5 seconds while this tab is open or game mode is on. GPU temperature needs an NVIDIA GPU (nvidia-smi). Frame rate is measured in game mode on Windows with PresentMon (Intel), twice a second.</span><span class="empty">Game mode: ${esc({ auto: 'Auto', always: 'Always', never: 'Never' }[S.gameMode] || 'Auto')}. Change it in Settings.</span></div></div>`;
const perfCardHTML = () => (perf && perf.game && fin(perf.fps) ? gaugeHTML(fpsRows()[0]) : '') + perfRows().map(gaugeHTML).join('');

// ---------- tab bodies ----------
const chatHTML = () => `<form class="chat ${chatOn ? 'on' : ''}" id="chat"><input id="chatIn" data-fk="chat" placeholder="Tell ${esc(mgrName())} what to do…" autocomplete="off" aria-label="Message ${esc(mgrName())}"><button class="btn yes" type="submit">Send</button></form>`;
const TAB_BODY = {
  approvals: () => { const h = asksOf(snap).map(askHTML).join('') + hiresOf(snap).map(hireHTML).join('');
    return `<div class="col">${h || '<span class="empty">Nothing is waiting for you.</span>'}<div class="hint">Ctrl+Alt+K toggles · Esc closes · Y / N answer the focused approval</div></div>`; },
  agents: () => `<div class="cols"><div class="col"><span class="label">Sessions · ${(snap?.agents || []).length}</span>${sesHTML(6) || '<span class="empty">No live sessions.</span>'}</div>
    <div class="col"><span class="label">Today · ${openGoals().length} open</span>${goalsHTML(4) || '<span class="empty">Nothing open.</span>'}${chatHTML()}<div class="dock">${dockHTML()}</div></div></div>`,
  calendar: calendarHTML,
  music: () => `<div class="col">${mediaHTML(true)}</div>`,
  timer: timersHTML, notes: notesHTML, trackers: trackersHTML, performance: perfHTML,
};

// ---------- Home cards (each fills <section class="card" data-card=id>) ----------
const CARD_BODY = {
  approvals: topAskHTML,
  agents: () => { const w = working(snap), done = (snap?.goals || []).filter(g => g.status === 'done').length, cost = costToday();
    return `${w.slice(0, 3).map(a => `<div class="ses"><span class="nm">${esc(a.name)}</span><span class="tk">${esc((a.task || 'working').slice(0, 60))}</span></div>`).join('') || `<span class="empty">${esc(mgrName())} is idle.</span>`}
      <span class="empty">${openGoals().length} open · ${done} done${cost ? ' · ' + cost + ' today' : ''}</span>`; },
  calendar: () => { const now = new Date(), up = cal && cal.linked ? (cal.events || []).filter(e => e.end > +now).slice(0, 3) : []; // the next three, else the date
    if (up.length) return up.map(e => evHTML(e, true)).join('') + (cal.error ? `<span class="empty">${esc(calErr(cal.error))}</span>` : '');
    return `<span class="big">${esc(clockStr(''))}</span><span>${esc(now.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' }))}</span>${S.zone2 ? `<span class="empty">${esc(S.zone2Label || S.zone2)} ${esc(clockStr(S.zone2))}</span>` : ''}`; },
  music: () => mediaHTML(false),
  timer: timerCardHTML, notes: notesCardHTML, trackers: trackersCardHTML, performance: perfCardHTML,
};
const cardHTML = k => `<header>${ic(k, 16)}<span>${TAB_LABEL[k]}</span><button class="link" data-tab="${k}" aria-label="Open ${TAB_LABEL[k]}">Open</button></header>${CARD_BODY[k]()}`;

// ---------- settings (from the settings button) ----------
function updatesHTML() {
  if (!upd) return '';
  const msg = { idle: 'Not checked yet.', current: 'You are up to date.', available: `Version ${esc(upd.available)} is available.`, error: esc(upd.error || 'Check failed.') }[upd.state] || '';
  const busy = { check: 'Checking...', confirm: 'Waiting for your confirmation...', download: 'Downloading...', install: 'Installing, restarting...' }[upd.busy] || '';
  const act = upd.state === 'available' && !upd.busy ? `<button class="btn yes" data-upd="install">Update now</button>` : '';
  const err = upd.error && upd.state !== 'error' ? `<div class="note bad" role="alert">${esc(upd.error)}</div>` : '';
  return `<div class="sect"><span class="label">Updates</span>
    <div class="set"><span>Version</span><span>${esc(upd.current)}${upd.available ? ' &rarr; ' + esc(upd.available) : ''}</span></div>
    <div class="set"><span>Status</span><span>${busy || msg}</span></div>
    ${err}
    <div class="set"><span>Check on start</span><div class="chips"><button class="btn ${upd.auto ? 'on' : ''}" data-upd-auto="true">On</button><button class="btn ${upd.auto ? '' : 'on'}" data-upd-auto="false">Off</button></div></div>
    <div class="set"><span>Source</span><span>GitHub releases of Ic3krem/agent-office (signed)</span></div>
    <div class="row"><button class="btn" data-upd="check" ${upd.busy ? 'disabled' : ''}>Check now</button>${act}</div></div>`;
}
function homeCardsHTML() {
  const on = S.homeCards, all = [...on, ...NotchCore.CARDS.filter(k => !on.includes(k))];
  return all.map(k => { const i = on.indexOf(k);
    return `<div class="hc${i < 0 ? ' off' : ''}"><button class="btn ${i < 0 ? '' : 'on'}" data-hc="${k}" aria-pressed="${i >= 0}" aria-label="Show ${TAB_LABEL[k]} on Home">${i < 0 ? 'Off' : 'On'}</button><span>${TAB_LABEL[k]}</span><button class="btn" data-hcmove="${k}|-1" aria-label="Move ${TAB_LABEL[k]} earlier" ${i > 0 ? '' : 'disabled'}>${ic('up', 16)}</button><button class="btn" data-hcmove="${k}|1" aria-label="Move ${TAB_LABEL[k]} later" ${i >= 0 && i < on.length - 1 ? '' : 'disabled'}>${ic('down', 16)}</button></div>`; }).join('');
}
function settingsHTML() {
  const chips = (key, opts) => `<div class="chips">${opts.map(([v, l]) => `<button class="btn ${S[key] === v ? 'on' : ''}" data-set="${key}" data-v="${esc(v)}">${esc(l)}</button>`).join('')}</div>`;
  const sw = Object.keys(THEMES).map(k => `<button class="btn sw" data-set="theme" data-v="${k}" title="${k}" aria-label="Theme ${k}" aria-pressed="${S.theme === k}" style="--c:${THEMES[k].accent}"></button>`).join('');
  const pins = Object.keys(ACT).map(k => `<button class="btn ${S.pinned.includes(k) ? 'on' : ''}" data-pin="${k}">${ic(k, 16)} ${ACT[k]}</button>`).join('');
  const gcat = (c, name) => `<div class="set"><span>${esc(c + ' ' + name)}</span><div class="chips">${['ask', 'log', 'off'].map(m => `<button class="btn ${GV && GV.config[c] === m ? 'on' : ''}" data-guard="${c}" data-v="${m}">${m}</button>`).join('')}</div></div>`;
  const guardSect = GV ? `<div class="sect"><span class="label">Security Guard</span>${['S', 'Y', 'I', 'U', 'C', 'H', 'X', 'P'].map(c => gcat(c, GV.names[c] || c)).join('')}<div class="hint">It only ever asks first (never allows or blocks). Turning a category down shows a confirmation window that only the app can open. ${GV.notices && GV.notices.length ? '<b>A setting was changed outside the app and was kept as ' + esc(GV.notices.map(n => n.what + ':' + n.kept).join(', ')) + '.</b>' : ''}${GV.weakStorage ? '<br><b>Weaker protection on this system (no OS keyring): turn protection down from the Breaker box in Agent Office, where a typed confirmation is required.</b>' : ''}${GV.nodeOnPath === false ? '<br><b>Guard inactive in terminals: Node.js was not found on PATH.</b>' : ''}</div></div>` : '';
  return `<div class="settings"><div class="sect"><span class="label">Notch</span>
    <div class="set"><span>Notch</span>${chips('notchEnabled', [[true, 'On'], [false, 'Off']])}</div>
    <div class="set"><span>Toggle shortcut</span><span class="row"><input type="text" data-nshort data-fk="nshort" value="${esc(S.notchShortcut || '')}" placeholder="Ctrl+Alt+N (optional)" aria-label="Global shortcut that turns the notch on or off"></span></div>
    <div class="hint">${shortcutOk ? '' : '<b>That shortcut could not be registered (another program uses it).</b> '}Off closes this window. Turn it back on from the tray menu (Show notch), the dashboard's Breaker box, or the shortcut. The shortcut needs 2 or 3 of Ctrl, Alt, Shift and a letter, digit or F-key; it is empty by default. Ctrl+Alt+K only expands or pins the notch.</div>
    <div class="set"><span>Look</span>${chips('look', [['glass', 'Glass'], ['solid', 'Solid']])}</div>
    <div class="hint">Glass blurs what is behind the notch where the system allows it; Solid is opaque. Changing it rebuilds the notch window.</div>
    </div><div class="sect"><span class="label">Home cards<small>shown in this order</small></span>${homeCardsHTML()}</div>
    <div class="sect"><span class="label">Appearance</span>
    <div class="set"><span>Theme</span><div class="chips">${sw}<button class="btn ${S.theme === 'custom' ? 'on' : ''}" data-set="theme" data-v="custom">Custom</button><input type="color" data-color value="${esc(S.accent)}" title="Accent colour" aria-label="Accent colour"></div></div>
    <div class="set"><span>Motion</span>${chips('physics', [['soft', 'Soft'], ['default', 'Default'], ['snappy', 'Snappy'], ['bouncy', 'Bouncy']])}</div>
    <div class="set"><span>Tiro character</span>${chips('kiroFace', [[true, 'On'], [false, 'Off']])}</div>
    <div class="set"><span>Animations</span>${chips('animate', [[true, 'On'], [false, 'Off']])}</div>
    <div class="set"><span>Power saver</span>${chips('powerSaver', [[true, 'On'], [false, 'Off']])}</div>
    <div class="set"><span>Now playing</span>${chips('nowPlaying', [[true, 'On'], [false, 'Off']])}</div>
    <div class="set"><span>Lyrics</span>${chips('lyrics', [[true, 'On'], [false, 'Off']])}</div>
    <div class="hint">Lyrics are off until you turn them on. When on, the song title, artist, album and length of the playing track are sent to lrclib.net to look up synced lyrics (results are cached on this PC). Nothing else is sent.</div>
    </div><div class="sect"><span class="label">Game mode</span>
    <div class="set"><span>Game mode</span>${chips('gameMode', [['auto', 'Auto'], ['always', 'Always'], ['never', 'Never']])}</div>
    <div class="hint">Auto: when a game is in front (Windows), the closed notch shows the frame rate, GPU load, GPU temperature and CPU load, and stays shown where Smart would hide it. Never turns the load monitor off.</div>
    ${perf && perf.fpsSetup ? `<div class="set"><span>Frame rate</span>${perf.fpsSeen ? '<b>On</b>' : '<button class="btn" data-fpssetup>Turn on FPS</button>'}</div>
    <div class="hint">${perf.fpsSeen ? 'Frames are arriving from PresentMon.' : esc(fpsMsg || 'FPS shows once a game is running. If it stays empty, Windows needs a one-time step: Turn on FPS adds you to the Performance Log Users group (Windows asks for permission). Sign out and back in afterwards.')}</div>` : ''}
    <div class="set"><span>My games</span><form class="row" data-gameform><input type="text" maxlength="44" placeholder="MyGame.exe" data-fk="game-new" aria-label="Add a game by its program name"><button class="btn yes" type="submit">Add</button></form></div>
    ${S.games.length ? `<div class="chips" style="justify-content:flex-start">${S.games.map(g => `<button class="btn" data-gamedel="${esc(g)}" aria-label="Remove ${esc(g)}">${esc(g)} ${ic('trash', 14)}</button>`).join('')}</div>` : '<div class="hint">Games are found by themselves when they cover the whole screen. Add a game here to have it count in a window too.</div>'}
    </div><div class="sect"><span class="label">Clock</span>
    <div class="set"><span>Format</span>${chips('hour12', [[false, '24h'], [true, '12h']])}</div>
    <div class="set"><span>Clock in pill</span>${chips('clockInPill', [[true, 'On'], [false, 'Off']])}</div>
    <div class="set"><span>Second clock</span><span class="row"><input type="text" data-zone data-fk="zone" value="${esc(S.zone2)}" placeholder="Asia/Tokyo" aria-label="Time zone"><input type="text" data-zlabel data-fk="zlabel" value="${esc(S.zone2Label)}" placeholder="Label" style="width:80px" aria-label="Label"></span></div>
    <div class="set"><span>Week starts</span>${chips('weekStart', [[1, 'Mon'], [0, 'Sun']])}</div>
    </div><div class="sect"><span class="label">Behaviour</span>
    <div class="set"><span>Edge delay</span>${chips('edgeDelay', [[0, 'None'], [200, '200ms'], [500, '500ms']])}</div>
    <div class="set"><span>Close after leave</span>${chips('leaveDelay', [[400, '0.4s'], [900, '0.9s'], [2000, '2s']])}</div>
    </div><div class="sect"><span class="label">Quick actions<small>click to pin, shown in pinned order on the Agents tab</small></span><div class="chips" style="justify-content:flex-start">${pins}</div></div>
    ${guardSect}${updatesHTML()}
    <div class="sect"><div class="row"><button class="btn" data-reset>Reset to defaults</button></div></div></div>`;
}
