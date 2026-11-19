// HUD panels (beta.6), shared by the town and the office: Tasks, Graphics, Build, Party, Music, Manor and (office) Claude.
// Plain DOM, one floating panel at a time, Esc closes. The pure parts (tasksOf, bubbleText) are tested in node.
// Classic script after graphics.js, manor.js, bg-music.js and party-music.js: root.Hud.
(function (root) {
  'use strict';
  const cut = (t, n) => (t.length > n ? t.slice(0, n - 1) + '…' : t);
  const bubbleText = t => cut(String(t || '').replace(/\s+/g, ' ').trim(), 140);
  function tasksOf(s) {
    const onIt = [], waiting = [];
    if (!s) return { onIt, waiting };
    for (const g of s.goals || []) {
      if (g.status === 'doing') onIt.push({ text: g.text, who: 'goal' });
      else if (g.status === 'todo') waiting.push({ text: g.text, who: 'to do' });
      else if (g.status === 'blocked') waiting.push({ text: g.text, who: g.note || 'blocked' });
    }
    for (const a of s.agents || []) {
      if (a.status === 'working' && a.task) onIt.push({ text: a.task, who: a.name });
      else if (a.status === 'blocked') waiting.push({ text: a.task || 'a permission', who: a.name + ' · waiting for approval' });
    }
    return { onIt, waiting };
  }

  // ---- browser only ----
  const D = () => root.agentOfficeDesktop || null; // the desktop app's preload (absent in a plain browser)
  const nonce = () => (String(root.document.cookie).match(/(?:^|; )ao_nonce=([^;]*)/) || [])[1] || '';
  const api = (p, b) => root.fetch(p, { method: 'POST', headers: { 'content-type': 'application/json', 'x-nonce': nonce() }, body: JSON.stringify(b || {}) }).then(async r => { const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.error || 'failed'); return j; });
  function h(tag, attrs, ...kids) {
    const e = root.document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) { if (v == null || v === false) continue; if (k.startsWith('on')) e.addEventListener(k.slice(2), v); else if (k === 'style') e.style.cssText = v; else e.setAttribute(k, v === true ? '' : v); }
    for (const c of kids.flat()) if (c != null && c !== false) e.append(c.nodeType ? c : String(c));
    return e;
  }
  const btn = (label, on, extra) => h('button', Object.assign({ type: 'button', class: 'hud-btn', onclick: on }, extra || {}), label);
  const sect = t => h('div', { class: 'hud-sect' }, t);
  const sections = new Set(); // mounted party-music sections (HUD panels, the office Party panel), refreshed on every snapshot
  let snap = null, open = '', panel = null, bar = null, toast = null, opts = {};
  const say = t => { if (!toast) { toast = h('div', { class: 'hud-toast', role: 'status' }); root.document.body.append(toast); } toast.textContent = t; toast.hidden = false; clearTimeout(say.t); say.t = setTimeout(() => { toast.hidden = true; }, 4000); };
  const fail = e => say(e && e.message ? e.message : String(e));

  const CSS = '.hud-bar{position:fixed;top:12px;right:12px;z-index:5200;display:flex;gap:6px;flex-wrap:wrap;justify-content:flex-end}'
    + '.hud-bar .hud-btn{min-height:44px;min-width:44px}'
    + '.hud-btn{padding:6px 12px;border-radius:9px;border:1.5px solid #4a3a2c;background:#1a1512;color:#f0e4d4;font:600 13px system-ui,sans-serif;cursor:pointer}'
    + '.hud-btn[aria-pressed=true],.hud-btn[aria-expanded=true]{border-color:#ffcf6b;color:#ffdca0}.hud-btn:focus-visible{outline:2px solid #ffcf6b;outline-offset:2px}.hud-btn:disabled{opacity:.5;cursor:default}'
    + '.hud-panel{position:fixed;top:68px;right:12px;z-index:5200;width:min(360px,calc(100vw - 24px));max-height:calc(100vh - 90px);overflow-y:auto;box-sizing:border-box;padding:12px 14px;border-radius:12px;background:#1a1512;border:1px solid #4a3a2c;box-shadow:0 14px 40px rgba(0,0,0,.5);color:#f0e4d4;font:13px/1.4 system-ui,sans-serif;display:flex;flex-direction:column;gap:8px}'
    + '.hud-panel[hidden],.hud-row[hidden]{display:none}' // their display:flex would beat the hidden attribute (the meeting-room card)
    + '.hud-panel h2{margin:0;font:600 16px system-ui,sans-serif;color:#ffdca0}.hud-sect{color:#a8998a;font-size:11.5px;text-transform:uppercase;letter-spacing:.06em;margin-top:4px}'
    + '.hud-row{display:flex;gap:6px;flex-wrap:wrap;align-items:center}.hud-item{padding:6px 8px;border-radius:7px;background:#120e0c;border:1px solid #2a211b}.hud-dim{color:#a8998a;font-size:12px}'
    + '.hud-panel input[type=text],.hud-panel input:not([type]){flex:1;min-width:0;padding:7px 8px;border-radius:7px;border:1px solid #3a2e25;background:#0e0b09;color:#f0e4d4;font:inherit}'
    + '.hud-chat{max-height:160px;overflow-y:auto;display:flex;flex-direction:column;gap:2px}.hud-toast{position:fixed;left:50%;top:14px;transform:translateX(-50%);z-index:5300;padding:8px 14px;border-radius:9px;background:#fffaf0;color:#1b1220;font:13px system-ui,sans-serif;box-shadow:0 6px 18px rgba(0,0,0,.4)}';

  // Menu icons: 24px stroke paths drawn as CSS masks, so <span class="ico ico-x"> takes the text colour (office and town).
  const ICONS = {
    menu: 'M4 7h16M4 12h16M4 17h16',
    tasks: 'M10 6h10M10 12h10M10 18h10M3 6l1.5 1.5L7 5M3 12l1.5 1.5L7 11M3 18l1.5 1.5L7 17',
    graphics: 'M3 5h18v11H3zM8 20h8M12 16v4',
    build: 'M13 3l8 8-3 3-8-8zM12 10l-9 9 2 2 9-9',
    party: 'M12 3a6 6 0 0 1 6 6c0 4-3 7-6 7s-6-3-6-7a6 6 0 0 1 6-6zM11 16l1 2 1-2M12 18c0 2-2 2-2 4',
    music: 'M9 18V5l11-2v13M9 18a3 3 0 1 1-6 0 3 3 0 0 1 6 0zM20 16a3 3 0 1 1-6 0 3 3 0 0 1 6 0z',
    manor: 'M3 11l9-8 9 8M5 9v12h14V9M10 21v-6h4v6',
    claude: 'M12 3v18M3 12h18M5.6 5.6l12.8 12.8M18.4 5.6L5.6 18.4',
    follow: 'M12 2v4M12 18v4M2 12h4M18 12h4M12 7a5 5 0 1 1 0 10 5 5 0 0 1 0-10z',
    team: 'M9 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM3 20c0-3 3-5 6-5s6 2 6 5M16 5a3 3 0 0 1 0 6M18 15c2 .5 3 2.5 3 5',
    agents: 'M3 4h18v16H3zM7 9l3 3-3 3M12 15h5',
    labels: 'M3 12V3h9l9 9-9 9zM7.5 7.5h.01',
    saver: 'M5 19c0-9 6-14 15-14 0 9-5 14-15 14zM5 19l8-8',
    town: 'M12 3l6 9h-4l4 6H6l4-6H6zM12 18v3',
    demo: 'M7 4l13 8-13 8z',
  };
  const icoCss = '.ico{display:inline-block;flex:none;width:18px;height:18px;background:currentColor;-webkit-mask:var(--i) center/contain no-repeat;mask:var(--i) center/contain no-repeat}'
    + Object.entries(ICONS).map(([k, d]) => '.ico-' + k + '{--i:url("data:image/svg+xml,' + encodeURIComponent("<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='black' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'><path d='" + d + "'/></svg>") + '")}').join('')
    + '.hud-menu{display:flex;flex-direction:column;gap:2px;min-width:190px;padding:6px;border-radius:12px;background:#1a1512;border:1px solid #4a3a2c;box-shadow:0 10px 30px rgba(0,0,0,.45)}'
    + '.hud-menu button,.hud-menu a{display:flex;align-items:center;gap:10px;min-height:40px;padding:0 12px;border:0;border-radius:8px;background:transparent;color:#f0e4d4;font:500 13px system-ui,sans-serif;text-align:left;text-decoration:none;cursor:pointer}'
    + '.hud-menu button:hover,.hud-menu a:hover,.hud-menu [aria-pressed=true],.hud-menu [aria-expanded=true]{background:#2a211b;color:#ffdca0}.hud-menu :focus-visible{outline:2px solid #ffcf6b;outline-offset:-2px}';
  const ico = n => h('span', { class: 'ico ico-' + n, 'aria-hidden': 'true' });

  // ---------- panels: build(el) once; update(el) on each snapshot (inputs are never rebuilt while typing) ----------
  const P = {};
  P.tasks = { title: 'Tasks', build(el) { el.append(sect('On it'), h('div', { 'data-on': 1 }), sect('Waiting'), h('div', { 'data-wait': 1 }), h('a', { href: '/', class: 'hud-btn', style: 'text-decoration:none;align-self:flex-start' }, 'Open in office')); },
    update(el) {
      const t = tasksOf(snap), row = x => h('div', { class: 'hud-item' }, x.text, ' ', h('span', { class: 'hud-dim' }, '· ' + x.who));
      el.querySelector('[data-on]').replaceChildren(...(t.onIt.length ? t.onIt.map(row) : [h('div', { class: 'hud-dim' }, 'Nobody is working right now.')]));
      el.querySelector('[data-wait]').replaceChildren(...(t.waiting.length ? t.waiting.map(row) : [h('div', { class: 'hud-dim' }, 'Nothing waiting.')]));
    } };
  P.graphics = { title: 'Graphics', build(el) {
    const G = root.Graphics; if (!G) return;
    const draw = s => {
      const cur = s.preset === 'custom' ? s.custom : G.PRESETS[s.preset], set = v => G.save(v).catch(fail);
      el.replaceChildren(h('h2', null, 'Graphics'), h('div', { class: 'hud-row' }, [...Object.keys(G.PRESETS), 'custom'].map(p => btn(p[0].toUpperCase() + p.slice(1), () => set(p === 'custom' ? { preset: 'custom', custom: Object.assign({}, cur) } : { preset: p }), { 'aria-pressed': String(s.preset === p) }))),
        ...G.UI.map(r => [sect(r.label), h('div', { class: 'hud-row' }, r.options.map(([v, l]) => btn(l, () => set({ preset: 'custom', custom: Object.assign({}, cur, { [r.key]: v }) }), { 'aria-pressed': String(cur[r.key] === v) })))]).flat());
    };
    G.load().then(draw).catch(fail); const off = G.onChange(s => { if (el.isConnected) draw(s); else off(); });
  } };
  // The party's shared player: now playing, a link box, play/pause/stop for whoever may DJ, the host's "anyone can DJ".
  function musicSection() {
    const box = h('div', { 'data-party-music': 1, style: 'display:flex;flex-direction:column;gap:6px' }); sections.add(box);
    const link = h('input', { 'aria-label': 'Music link', placeholder: 'YouTube or Spotify link, or https:// radio stream', maxlength: '300' });
    const play = () => { const v = link.value.trim(); if (!v) return; api('/api/party/music', { link: v }).then(() => { link.value = ''; }).catch(fail); };
    link.addEventListener('keydown', e => { if (e.key === 'Enter') play(); });
    const status = h('div', { 'data-now': 1, class: 'hud-item' }), ctl = h('div', { class: 'hud-row', 'data-ctl': 1 });
    box.append(sect('Party music'), status, h('div', { class: 'hud-row', 'data-link': 1 }, link, btn('Play', play)), ctl,
      h('div', { class: 'hud-dim' }, 'Spotify plays 30-second previews unless each listener is signed in to Spotify in TiroAgents. Nothing is recorded or re-streamed.'),
      D() && D().spotify ? btn('Sign in to Spotify', () => D().spotify.signIn()) : null);
    box.update = () => {
      const P = snap && snap.party, m = P && P.music, can = !!(P && P.canDj);
      if (!P || !P.connected) { box.hidden = true; return; } box.hidden = false;
      status.textContent = m ? (m.paused ? 'Paused: ' : 'Now playing: ') + (m.title || { youtube: 'YouTube video', spotify: 'Spotify ' + m.ref.split(':')[0], stream: 'radio stream' }[m.src]) : 'Nothing playing.';
      box.querySelector('[data-link]').hidden = !can;
      const pos = () => root.PartyMusic ? root.PartyMusic.posOf(m, Date.now()) : 0;
      ctl.replaceChildren(...[m && can && btn(m.paused ? 'Play' : 'Pause', () => api('/api/party/music', { music: Object.assign({}, m, { paused: !m.paused, pos: pos() }) }).catch(fail)),
        m && can && btn('Stop', () => api('/api/party/music', { stop: true }).catch(fail)),
        P.you && P.you.host && btn('Anyone can DJ: ' + (P.djAll ? 'on' : 'off'), () => api('/api/party/music', { djAll: !P.djAll }).catch(fail), { 'aria-pressed': String(!!P.djAll) }),
        !can && h('span', { class: 'hud-dim' }, 'The host picks the music.')].filter(Boolean));
    };
    return box;
  }
  // Meeting-room relay (optional TURN server), kept on this PC only; people behind strict networks can reach each other through it.
  function relaySection() {
    const f = (label, ph, type) => h('input', { 'aria-label': label, placeholder: ph, type: type || 'text', maxlength: '200', autocomplete: 'off' });
    const url = f('Relay server address', 'turn:relay.example.com:3478'), user = f('Relay user name', 'User name'), pass = f('Relay password', 'Password', 'password');
    const status = h('div', { class: 'hud-dim' });
    const load = () => root.fetch('/api/party/voice-config', { headers: { 'x-nonce': nonce() } }).then(r => r.json()).then(j => {
      const t = (j.iceServers || []).find(x => x.username); status.textContent = t ? 'Relay in use: ' + t.urls : 'No relay set. Voice goes directly between apps.';
    }).catch(() => { status.textContent = ''; });
    const save = turn => api('/api/party/voice-config', { turn }).then(() => { pass.value = ''; if (!turn) { url.value = ''; user.value = ''; } say(turn ? 'Relay saved' : 'Relay removed'); return load(); }).catch(fail);
    load();
    return h('details', { 'data-relay': 1 }, h('summary', { class: 'hud-sect' }, 'Relay server (optional)'),
      h('div', { style: 'display:flex;flex-direction:column;gap:6px;margin-top:6px' }, h('div', { class: 'hud-dim' }, 'For the meeting room. Only needed if a network blocks direct calls. Kept on this PC, never sent to the party.'),
        status, url, h('div', { class: 'hud-row' }, user, pass), h('div', { class: 'hud-row' }, btn('Save relay', () => save({ url: url.value.trim(), user: user.value, pass: pass.value })), btn('Remove', () => save(null)))));
  }
  P.party = { title: 'Party', build(el) {
    const off = h('div', { 'data-off': 1, style: 'display:flex;flex-direction:column;gap:6px' }), on = h('div', { 'data-on': 1, style: 'display:flex;flex-direction:column;gap:6px' });
    const url = h('input', { 'aria-label': 'Party link', placeholder: 'Party link (https://…)' }), code = h('input', { 'aria-label': 'Invite code', placeholder: 'Code' }), name = h('input', { 'aria-label': 'Your name', placeholder: 'Your name', maxlength: '20' });
    off.append(h('div', { class: 'hud-row' }, url), h('div', { class: 'hud-row' }, code, name),
      h('div', { class: 'hud-row' }, btn('Join', () => api('/api/party/join', { url: url.value, code: code.value, name: name.value }).catch(fail)), btn('Host a party', () => api('/api/party/host', { action: 'start', name: name.value }).catch(fail))));
    const chatIn = h('input', { 'aria-label': 'Chat message', placeholder: 'Say something', maxlength: '200' });
    const send = () => { const t = chatIn.value.trim(); if (!t) return; api('/api/party/chat', { text: t }).then(() => { chatIn.value = ''; }).catch(() => say('Not sent')); };
    chatIn.addEventListener('keydown', e => { if (e.key === 'Enter') send(); });
    on.append(h('div', { 'data-title': 1, class: 'hud-dim' }), h('div', { 'data-members': 1, style: 'display:flex;flex-direction:column;gap:4px' }), sect('Chat'), h('div', { class: 'hud-chat', 'data-chat': 1 }), h('div', { class: 'hud-row' }, chatIn, btn('Send', send)), musicSection(), relaySection(), btn('Leave the party', () => api('/api/party/leave').catch(fail)));
    el.append(off, on);
  }, update(el) {
    const P = (snap && snap.party) || {}, c = !!P.connected;
    el.querySelector('[data-off]').hidden = c; el.querySelector('[data-on]').hidden = !c;
    if (!c) return;
    el.querySelector('[data-title]').textContent = (P.party || 'Party') + ' · ' + ((P.members || []).length + 1) + ' here' + (P.live ? '' : ' · reconnecting…') + (P.hosting && P.hosting.code ? ' · code ' + P.hosting.code : '');
    el.querySelector('[data-members]').replaceChildren(...(P.members || []).map(m => h('div', { class: 'hud-item' }, m.name, ' ', h('span', { class: 'hud-dim' }, '· ' + m.presence + (m.room === 'town' ? ' · in town' : '')))));
    const log = el.querySelector('[data-chat]'), stick = log.scrollHeight - log.scrollTop - log.clientHeight < 30;
    log.replaceChildren(...(P.chat || []).map(l => h('div', null, h('b', { style: 'color:' + (l.mine ? '#ffcf6b' : '#8fd3ff') }, (l.mine ? 'You' : l.name) + ': '), l.text)));
    if (stick) log.scrollTop = log.scrollHeight;
    el.querySelector('[data-party-music]').update();
  } };
  P.music = { title: 'Music', build(el) {
    const bg = h('div', { style: 'display:flex;flex-direction:column;gap:6px' }), pm = musicSection();
    const draw = st => {
      const B = root.BgMusic, mode = st ? st.mode : 'builtin';
      const set = b => api('/api/music/set', b).then(() => B && B.start(opts.place)).then(draw).catch(fail);
      const vol = h('input', { type: 'range', min: '0', max: '1', step: '0.05', value: String(st ? st.volume : 0.4), 'aria-label': 'Background music volume', style: 'flex:1' });
      vol.addEventListener('input', () => B && B.setVolume(+vol.value)); vol.addEventListener('change', () => api('/api/music/set', { volume: +vol.value }).catch(fail));
      bg.replaceChildren(sect('Background music'),
        h('div', { class: 'hud-row' }, [['builtin', 'Built-in'], ['folder', 'My music folder'], ['off', 'Off']].map(([v, l]) => btn(l, () => set({ bg: v }), { 'aria-pressed': String(mode === v), disabled: v === 'folder' && !(st && st.folderName) }))),
        h('div', { class: 'hud-row' }, h('span', { class: 'hud-dim' }, 'Volume'), vol),
        h('div', { class: 'hud-row' }, D() && D().music ? btn(st && st.folderName ? 'Folder: ' + st.folderName : 'Choose a music folder…', () => D().music.pickFolder().then(r => r && r.folder && set({ bg: 'folder' })).catch(fail)) : h('span', { class: 'hud-dim' }, 'Choose a music folder in the TiroAgents app.'),
          mode === 'folder' && btn('Prev', () => B.prev()), mode === 'folder' && btn('Next', () => B.next())),
        mode === 'builtin' ? h('div', { class: 'hud-dim' }, 'Original lo-fi made on your PC, a tune for each place.') : st && st.track ? h('div', { class: 'hud-dim' }, 'Playing: ' + st.track) : null);
    };
    el.append(bg, pm);
    const B = root.BgMusic; (B && B.state().mode !== 'off' && B.state().on ? Promise.resolve(B.state()) : api('/api/music').then(m => Object.assign({ mode: m.bg }, m))).then(draw).catch(() => draw(null));
  }, update(el) { const m = el.querySelector('[data-party-music]'); if (m) m.update(); } };
  P.manor = { title: 'Manor', build(el) {
    const M = root.Manor; if (!M) return;
    const draw = () => {
      const cur = (snap && snap.manor) || { theme: 'modern', colors: {} }, r = M.resolve(cur), set = m => api('/api/manor/set', m).then(j => { if (snap) snap.manor = j.manor; draw(); opts.onManor && opts.onManor(j.manor); }).catch(fail);
      el.replaceChildren(h('h2', null, 'Manor'), h('div', { class: 'hud-dim' }, 'Your office theme. Party guests see it on your lot and when they visit.'),
        h('div', { class: 'hud-row' }, Object.entries(M.THEMES).map(([k, t]) => btn(t.label, () => set({ theme: k, colors: {} }), { 'aria-pressed': String(r.theme === k) }))),
        sect('Colours'), h('div', { class: 'hud-row' }, ['wall', 'floor', 'roof', 'accent'].map(k => { const i = h('input', { type: 'color', value: r.colors[k], 'aria-label': k[0].toUpperCase() + k.slice(1) + ' colour', style: 'width:44px;height:44px;border:0;background:none' }); i.addEventListener('change', () => set({ theme: r.theme, colors: Object.assign({}, cur.colors, { [k]: i.value }) })); return h('label', { class: 'hud-dim', style: 'display:flex;flex-direction:column;align-items:center' }, i, k); })),
        btn('Reset colours', () => set({ theme: r.theme, colors: {} })));
    };
    draw();
  } };
  // Settings -> Claude (office): sign-in state, sign in/out in a terminal, or an API key kept by the desktop app.
  // Not installed or not signed in: plain steps that stay on screen, each command with a Copy button.
  P.claude = { title: 'Claude', build(el) {
    let timer = null, polls = 0, last = '', busy = false;
    const copy = t => h('div', { class: 'hud-row' }, h('code', null, t), btn('Copy', () => root.navigator.clipboard.writeText(t).then(() => say('Copied')).catch(fail), { 'aria-label': 'Copy ' + t }));
    const step = t => h('div', { class: 'hud-dim' }, t);
    // After Sign in: ask again every 3 s for up to 2 min; stops when signed in or the panel closes.
    const poll = () => { clearInterval(timer); polls = 0; timer = setInterval(() => { if (!el.isConnected || ++polls > 40) clearInterval(timer); else if (!busy) refresh(); }, 3000); }; // auth status may take 5 s: skip a tick
    const draw = (c, k) => {
      const A = D() && D().auth, s = c && c.status, M = { subscription: 'Claude account (subscription)', console: 'Console (API billing)', other: 'signed in' };
      const run = (p, wait) => p.then(r => { if (r && r.copy) say('Run this in a terminal: ' + r.copy); if (wait && r && (r.ok || r.copy !== undefined)) poll(); return refresh(); }).catch(fail);
      const steps = !c ? null : !c.found ? h('div', { 'data-claude-steps': 'install', style: 'display:flex;flex-direction:column;gap:6px' }, sect('Install Claude Code'),
        step('Windows (PowerShell):'), copy(c.installers.windows), step('macOS or Linux (Terminal):'), copy(c.installers.unix),
        step('Or with npm:'), copy('npm install -g @anthropic-ai/claude-code'), step('Then click Refresh.'))
        : !s.loggedIn ? h('div', { 'data-claude-steps': 'signin', style: 'display:flex;flex-direction:column;gap:6px' }, sect('How to sign in'),
          s.unknown && step('Could not read the sign-in state. Update Claude Code, then click Refresh:'), s.unknown && copy('claude update'),
          A && step('1. Click Sign in. A terminal window opens and your browser shows the Claude sign-in page.'), A && step('2. Finish signing in in the browser.'),
          A && step('3. Come back here; this panel updates by itself (or click Refresh).'),
          step((A ? 'If no window opened, open' : 'Open') + ' a terminal (PowerShell on Windows, Terminal on macOS) and run:'), copy('claude auth login')) : null;
      el.replaceChildren(h('h2', null, 'Claude'),
        !c ? h('div', { class: 'hud-dim' }, 'Checking…') : !c.found ? h('div', { class: 'hud-item', 'data-claude-status': 'missing' }, 'Claude Code not found on this computer.') :
          h('div', { class: 'hud-item', 'data-claude-status': s.loggedIn ? 'in' : 'out' }, s.loggedIn ? 'Signed in · ' + M[s.method] + (s.email ? ' · ' + s.email : '') + (s.expires ? ' · until ' + new Date(s.expires).toLocaleDateString() : '') : 'Not signed in'),
        steps,
        c && h('div', { class: 'hud-dim' }, 'TiroAgents uses: ' + (c.using === 'key' ? 'API key (' + c.keyHint + ')' : 'your Claude account')),
        A ? h('div', { class: 'hud-row' }, c && c.found && btn('Sign in', () => run(A.login('claude'), true)), c && c.found && btn('Sign in with Console', () => run(A.login('claude-console'), true)), c && c.found && btn('Sign out', () => run(A.logout())), btn('Refresh', () => refresh())) : h('div', { class: 'hud-row' }, btn('Refresh', () => refresh()), h('span', { class: 'hud-dim' }, 'Sign in and out from the TiroAgents app.')),
        A && sect('Use'), A && k && h('div', { class: 'hud-row' }, btn('Claude account', () => run(A.setMode('account')), { 'aria-pressed': String(k.mode === 'account') }), btn('API key', () => run(A.setMode('key')), { 'aria-pressed': String(k.mode === 'key'), disabled: !k.set })),
        A && k && (k.available ? h('div', { class: 'hud-row' }, k.set ? h('span', { class: 'hud-dim' }, 'key set · ends ' + k.hint) : null, btn(k.set ? 'Replace key' : 'Set API key…', () => run(A.setKey())), k.set && btn('Remove key', () => run(A.removeKey()))) : h('div', { class: 'hud-dim' }, k.reason)));
    };
    // Redraw only when something changed, so polling does not move keyboard focus.
    const refresh = () => (busy = true, Promise.all([root.fetch('/api/claude?refresh=1').then(r => r.json()).catch(() => null), D() && D().auth ? D().auth.keyState().catch(() => null) : null]).then(([c, k]) => {
      if (c && c.status && c.status.loggedIn) clearInterval(timer);
      const key = JSON.stringify([c, k]); if (el.isConnected && key !== last) { last = key; draw(c, k); }
    }).finally(() => { busy = false; }));
    draw(null, null); refresh();
  } };

  function close() { if (!open) return; const was = open; open = ''; panel && panel.remove(); panel = null; syncBar(); const b = bar && bar.querySelector('[data-hud="' + was + '"]'); if (b) b.focus(); }
  function toggle(name) {
    if (open === name) return close();
    if (open) close();
    if (name === 'build') { root.location.href = '/#build'; return; }
    const p = P[name]; if (!p) return;
    open = name; panel = h('div', { class: 'hud-panel', role: 'dialog', 'aria-label': p.title, 'data-hud-panel': name });
    panel.append(h('div', { class: 'hud-row', style: 'justify-content:space-between' }, h('h2', null, p.title), btn('×', close, { 'aria-label': 'Close ' + p.title })));
    const body = h('div', { style: 'display:flex;flex-direction:column;gap:8px' }); panel.append(body);
    root.document.body.append(panel); p.build(body); if (p.update) p.update(body);
    syncBar(); const f = panel.querySelector('button,input'); if (f) f.focus();
  }
  const syncBar = () => { if (bar) for (const b of bar.querySelectorAll('[data-hud]')) b.setAttribute('aria-expanded', String(b.dataset.hud === open)); };
  let styled = false;
  function init(o) {
    opts = o || {};
    if (!styled) { styled = true; root.document.head.append(h('style', null, CSS + icoCss));root.document.addEventListener('keydown', e => { if (e.key === 'Escape' && open) { e.preventDefault(); e.stopPropagation(); close(); } }, true); }
    if (opts.toolbar) {
      const L = { tasks: 'Tasks', graphics: 'Graphics', build: 'Build', party: 'Party', music: 'Music', manor: 'Manor', claude: 'Claude' };
      // One ☰ button; its list holds every setting (icon + name). Picking one closes the list.
      const list = h('div', { class: 'hud-menu', hidden: true, id: 'hud-menu' }, opts.toolbar.map(n => btn([ico(n), L[n]], () => { list.hidden = true; menu.setAttribute('aria-expanded', 'false'); toggle(n); }, { 'data-hud': n, 'aria-expanded': n === 'build' ? null : 'false' })));
      const menu = btn(ico('menu'), () => { list.hidden = !list.hidden; menu.setAttribute('aria-expanded', String(!list.hidden)); if (!list.hidden) list.querySelector('button').focus(); },
        { 'aria-label': 'Settings menu', 'aria-expanded': 'false', 'aria-controls': 'hud-menu', 'data-hud-menu': 1 });
      bar = h('nav', { class: 'hud-bar', 'aria-label': 'Town settings', style: 'flex-direction:column;align-items:flex-end' }, menu, list);
      list.addEventListener('keydown', e => { if (e.key === 'Escape') { e.stopPropagation(); list.hidden = true; menu.setAttribute('aria-expanded', 'false'); menu.focus(); } });
      root.document.addEventListener('pointerdown', e => { if (!list.hidden && !bar.contains(e.target)) { list.hidden = true; menu.setAttribute('aria-expanded', 'false'); } });
      root.document.body.append(bar);
    }
  }
  function setSnapshot(d) {
    snap = d;
    if (root.PartyMusic) root.PartyMusic.sync(d && d.party && d.party.connected ? d.party.music : null);
    if (open && panel && P[open].update) P[open].update(panel.lastChild);
    for (const b of sections) if (!b.isConnected) sections.delete(b); else if (!panel || !panel.contains(b)) b.update();
  }
  const musicSectionNow = () => { const b = musicSection(); if (snap) b.update(); return b; };
  root.Hud = { tasksOf, bubbleText, init, toggle, close, setSnapshot, toast: say, isOpen: () => open, musicSection: musicSectionNow, relaySection };
})(globalThis);
