// Office furniture windows: bookshelf (reports), corkboard (memory), filing cabinet (SOPs), inbox tray (approvals),
// breaker box (switches), server rack (telemetry), arcade, jukebox, plant and coffee machine.
// Everything here reads files and switches through the local server; nothing calls a model.
(function () {
  const KEY = new URLSearchParams(location.search).get('key') || '';
  const api = (p, body) => fetch(p, { method: 'POST', headers: { 'content-type': 'application/json', 'x-key': KEY }, body: JSON.stringify(body || {}) })
    .then(async r => { const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.error || 'HTTP ' + r.status); return j; });
  const dl = (p, q) => p + '?' + new URLSearchParams({ ...q, key: KEY });
  const esc = t => String(t ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const OUT = { done: ['Done', '#3f9f68'], partial: ['Partly done', '#d39b2a'], blocked: ['Needs you', '#d0503f'], info: ['Info', '#4a86c9'] };
  let snap = {}, kind = null, st = {}, listeners = [], timer = null;

  // ---------- shell ----------
  const css = document.createElement('style');
  css.textContent = `
  .oo-back{position:fixed;inset:0;z-index:5000;background:rgba(8,5,4,.6)}
  .oo-win{position:fixed;left:50%;top:50%;transform:translate(-50%,-50%);z-index:5001;width:min(1080px,96vw);height:min(86vh,860px);display:flex;flex-direction:column;background:#1a1512;color:#f0e4d4;border:1px solid #4a3a2c;border-radius:12px;box-shadow:0 30px 80px rgba(0,0,0,.6);font:14px/1.5 'Instrument Sans',sans-serif;overflow:hidden}
  .oo-win.small{width:min(560px,96vw);height:auto;max-height:86vh}
  .oo-head{display:flex;align-items:center;gap:10px;padding:12px 14px;border-bottom:1px solid #33281f}
  .oo-title{font-family:'Pixelify Sans',sans-serif;font-size:19px;color:#ffdca0}.oo-sub{flex:1;font-size:12.5px;color:#a8998a}
  .oo-x{width:32px;height:32px;border-radius:8px;border:1px solid #3a2e25;background:transparent;color:#a8998a;font-size:18px;cursor:pointer}
  .oo-body{flex:1;min-height:0;display:flex;overflow:hidden}.oo-pad{padding:14px 16px;overflow-y:auto;flex:1}
  .oo-btn{padding:6px 11px;border-radius:7px;border:1px solid #3a2e25;background:transparent;color:#f0e4d4;font:inherit;font-size:12.5px;cursor:pointer;text-decoration:none;display:inline-flex;align-items:center;gap:5px}
  .oo-btn:hover{background:#2a211b}.oo-btn.pri{background:#ffcf6b;border-color:#ffcf6b;color:#2a1a0c;font-weight:600}.oo-btn.yes{background:#5fd38d;border-color:#5fd38d;color:#0c2416;font-weight:600}.oo-btn.no{border-color:#ff7a6b;color:#ff9a8d}
  .oo-in{padding:7px 10px;border-radius:7px;border:1px solid #3a2e25;background:#120e0c;color:#f0e4d4;font:inherit;font-size:13px;outline:none}
  .oo-list{width:330px;flex-shrink:0;border-right:1px solid #33281f;display:flex;flex-direction:column;min-height:0}
  .oo-items{overflow-y:auto;flex:1}.oo-item{display:flex;gap:10px;padding:9px 12px;border-bottom:1px solid #2a211b;cursor:pointer}.oo-item:hover,.oo-item.on{background:#231c17}
  .oo-spine{width:6px;border-radius:3px;flex-shrink:0}.oo-meta{font:11px 'IBM Plex Mono',monospace;color:#7d7064}
  .oo-shelf{display:flex;align-items:flex-end;gap:3px;height:58px;padding:8px 12px 0;border-bottom:8px solid #6b4220;background:linear-gradient(#2a1d14,#1d150f)}
  .oo-book{width:14px;border-radius:2px 2px 0 0;cursor:pointer;box-shadow:inset -3px 0 0 rgba(0,0,0,.25)}.oo-book:hover{transform:translateY(-4px)}
  .oo-doc{color:#e9dccb;max-width:820px}.oo-doc h1{font-family:'Pixelify Sans',sans-serif;color:#ffdca0;font-size:23px;margin:4px 0 8px}.oo-doc h2{color:#ffdca0;font-size:16px;margin:18px 0 6px}
  .oo-doc table{border-collapse:collapse;width:100%;font-size:13px;margin:6px 0}.oo-doc th,.oo-doc td{border:1px solid #3a2e25;padding:5px 8px;text-align:left;vertical-align:top}.oo-doc th{background:#231c17;color:#ffdca0}
  .oo-doc code{background:#120e0c;padding:1px 5px;border-radius:4px;color:#ffd28a;font-size:12.5px}.oo-doc pre{background:#0e0c0b;border:1px solid #2a211b;border-radius:6px;padding:10px;overflow-x:auto;white-space:pre-wrap}.oo-doc .wl{color:#9ec5ff}
  .oo-tools{display:flex;gap:6px;flex-wrap:wrap;margin-bottom:12px}
  .oo-sw{display:flex;align-items:center;gap:14px;padding:12px;border-radius:10px;background:#120e0c;border:1px solid #2a211b;margin-bottom:8px;cursor:pointer}
  .oo-lever{width:34px;height:56px;border-radius:6px;background:#2b2b33;border:2px solid #555;position:relative;flex-shrink:0}.oo-lever i{position:absolute;left:4px;right:4px;height:22px;border-radius:4px;transition:top .2s}
  .oo-bar{height:10px;border-radius:5px;background:#120e0c;border:1px solid #2a211b;overflow:hidden}.oo-bar i{display:block;height:100%}
  .oo-log{font:12px/1.5 'IBM Plex Mono',monospace;background:#0e0c0b;border:1px solid #2a211b;border-radius:8px;padding:8px 10px;height:260px;overflow-y:auto;white-space:pre-wrap;word-break:break-word}
  .oo-ta{width:100%;box-sizing:border-box;min-height:360px;font:12.5px/1.5 'IBM Plex Mono',monospace;resize:vertical}
  @media (max-width:760px){.oo-list{width:100%;border-right:none}.oo-body.read .oo-list{display:none}.oo-body:not(.read) .oo-reader{display:none}}`;
  document.head.appendChild(css);
  const back = Object.assign(document.createElement('div'), { className: 'oo-back' });
  const win = Object.assign(document.createElement('div'), { className: 'oo-win' });
  win.setAttribute('role', 'dialog');
  back.onclick = () => close();
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && kind) close(); });
  function shell(title, sub, small) {
    win.className = 'oo-win' + (small ? ' small' : '');
    win.setAttribute('aria-label', title);
    win.innerHTML = `<div class="oo-head"><span class="oo-title">${esc(title)}</span><span class="oo-sub">${esc(sub || '')}</span><button class="oo-x" data-act="close" aria-label="Close">×</button></div><div class="oo-body" id="oo-body"></div>`;
    return win.querySelector('#oo-body');
  }
  function close() { kind = null; clearInterval(timer); game.stop(); back.remove(); win.remove(); }
  const toast = t => (window.officeToast || alert)(t);

  // ---------- 1. bookshelf: reports ----------
  async function reports(file) {
    const body = shell('Bookshelf · Reports', 'Every result Kiro filed, plus today\'s summary. Export any of them to PDF or Excel.');
    body.innerHTML = `<div class="oo-list"><div class="oo-shelf" id="oo-shelf"></div><div style="padding:8px 10px"><input class="oo-in" id="oo-q" placeholder="Search reports…" style="width:100%;box-sizing:border-box"></div><div class="oo-items" id="oo-items"></div></div><div class="oo-pad oo-reader" id="oo-reader"></div>`;
    const { reports } = await api('/api/reports'); st.reports = reports;
    body.querySelector('#oo-shelf').innerHTML = reports.slice(0, 60).map(r => `<div class="oo-book" data-act="report" data-file="${esc(r.file)}" title="${esc(r.title)}" style="height:${30 + (r.title.length % 20)}px;background:${(OUT[r.outcome] || OUT.info)[1]}"></div>`).join('');
    const list = q => {
      const t = (q || '').toLowerCase();
      body.querySelector('#oo-items').innerHTML = `<div class="oo-item ${st.cur === 'daily' ? 'on' : ''}" data-act="daily"><div class="oo-spine" style="background:#ffcf6b"></div><div><div><b>Today's report</b></div><div class="oo-meta">summary of the board · updates itself</div></div></div>`
        + reports.filter(r => !t || (r.title + ' ' + (r.summary || '')).toLowerCase().includes(t)).map(r => `<div class="oo-item ${st.cur === r.file ? 'on' : ''}" data-act="report" data-file="${esc(r.file)}"><div class="oo-spine" style="background:${(OUT[r.outcome] || OUT.info)[1]}"></div><div><div>${esc(r.title)}</div><div class="oo-meta">${esc(r.day)} · ${esc((OUT[r.outcome] || OUT.info)[0])}</div></div></div>`).join('')
        || '<div class="oo-meta" style="padding:12px">No reports match.</div>';
    };
    st.list = list; list('');
    body.querySelector('#oo-q').oninput = e => list(e.target.value);
    file && file !== 'daily' ? openReport(file) : openDaily();
  }
  async function openDaily() {
    st.cur = 'daily'; st.list?.(document.getElementById('oo-q')?.value);
    const { html, day } = await api('/api/daily');
    paintDoc(html, `<a class="oo-btn pri" target="_blank" href="${esc(dl('/print/daily', { day, print: 1 }))}">⤓ PDF</a><a class="oo-btn" href="${esc(dl('/export/daily.xlsx', { day }))}">⤓ Excel</a>`);
  }
  async function openReport(file) {
    st.cur = file; st.list?.(document.getElementById('oo-q')?.value);
    const { html } = await api('/api/report', { file });
    paintDoc(html, `<a class="oo-btn pri" target="_blank" href="${esc(dl('/print/report', { file, print: 1 }))}">⤓ PDF</a><a class="oo-btn" href="${esc(dl('/export/report.xlsx', { file }))}">⤓ Excel</a>`);
  }
  function paintDoc(html, tools) {
    const r = document.getElementById('oo-reader'); if (!r) return;
    document.getElementById('oo-body').classList.add('read');
    r.innerHTML = `<div class="oo-tools"><button class="oo-btn" data-act="back" style="display:${innerWidth < 760 ? '' : 'none'}">‹ All</button>${tools}</div><div class="oo-doc">${html}</div>`; // html is escaped server-side
    r.scrollTop = 0;
  }

  // ---------- 2. corkboard: memory graph ----------
  const TYPE = { user: '#e07a5f', feedback: '#f2cc8f', project: '#81b29a', reference: '#9ec5ff', note: '#d4b3ff' };
  async function memory() {
    const body = shell('Corkboard · Memory', 'Notes in your Obsidian vault that Kiro and the specialists read before they work.');
    const g = await api('/api/memory/graph'); st.g = g;
    body.innerHTML = `<div class="oo-pad" style="flex:1.4;padding:0;position:relative;overflow:hidden;background:#a4744a url('data:image/svg+xml;utf8,<svg xmlns=%22http://www.w3.org/2000/svg%22 width=%224%22 height=%224%22><rect width=%224%22 height=%224%22 fill=%22%23a4744a%22/><rect width=%221%22 height=%221%22 fill=%22%23946640%22/></svg>')"><input class="oo-in" id="oo-mq" placeholder="Find a note…" style="position:absolute;left:10px;top:10px;z-index:2;width:220px"><svg id="oo-graph" style="position:absolute;inset:0;width:100%;height:100%"></svg></div><div class="oo-pad" id="oo-note" style="flex:1;border-left:1px solid #33281f"><div class="oo-meta">${g.nodes.length} notes · ${g.edges.length} links. Click a pin to read it.</div></div>`;
    layout(g); drawGraph('');
    body.querySelector('#oo-mq').oninput = e => drawGraph(e.target.value);
  }
  function layout(g) {
    const W = 640, H = 600, P = Object.fromEntries(g.nodes.map((n, i) => [n.id, { x: W / 2 + 220 * Math.cos(i * 2.4), y: H / 2 + 220 * Math.sin(i * 2.4) * .9, vx: 0, vy: 0 }]));
    for (let it = 0; it < 220; it++) {
      const ns = Object.values(P);
      for (const a of ns) for (const b of ns) if (a !== b) { const dx = a.x - b.x, dy = a.y - b.y, d2 = dx * dx + dy * dy + 30; a.vx += dx * 9000 / d2 / Math.sqrt(d2); a.vy += dy * 9000 / d2 / Math.sqrt(d2); }
      for (const e of g.edges) { const a = P[e.from], b = P[e.to], dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy) || 1, f = (d - 150) * .015; a.vx += dx / d * f * 10; a.vy += dy / d * f * 10; b.vx -= dx / d * f * 10; b.vy -= dy / d * f * 10; }
      for (const p of ns) { p.vx += (W / 2 - p.x) * .002; p.vy += (H / 2 - p.y) * .002; p.x = Math.max(40, Math.min(W - 40, p.x + p.vx * .5)); p.y = Math.max(50, Math.min(H - 30, p.y + p.vy * .5)); p.vx *= .5; p.vy *= .5; }
    }
    st.pos = P; st.W = W; st.H = H;
  }
  function drawGraph(q) {
    const g = st.g, P = st.pos, t = q.toLowerCase(), svg = document.getElementById('oo-graph'); if (!svg) return;
    svg.setAttribute('viewBox', `0 0 ${st.W} ${st.H}`);
    const hit = n => !t || (n.id + ' ' + n.description).toLowerCase().includes(t);
    svg.innerHTML = g.edges.map(e => `<line x1="${P[e.from].x}" y1="${P[e.from].y}" x2="${P[e.to].x}" y2="${P[e.to].y}" stroke="#b3261e" stroke-width="1.6" opacity=".75"/>`).join('')
      + g.nodes.map(n => { const p = P[n.id], on = st.note === n.id; return `<g data-act="note" data-name="${esc(n.id)}" style="cursor:pointer;opacity:${hit(n) ? 1 : .25}">
        <rect x="${p.x - 46}" y="${p.y - 12}" width="92" height="26" rx="2" fill="${on ? '#fff7d6' : '#fdf3dc'}" stroke="${on ? '#b3261e' : 'rgba(0,0,0,.25)'}" transform="rotate(${(n.id.length % 7) - 3} ${p.x} ${p.y})"/>
        <circle cx="${p.x}" cy="${p.y - 12}" r="4.5" fill="${TYPE[n.type] || TYPE.note}" stroke="#3a2a1a"/>
        <text x="${p.x}" y="${p.y + 5}" text-anchor="middle" font-size="9.5" font-family="IBM Plex Mono" fill="#2a1d14">${esc(n.id.length > 16 ? n.id.slice(0, 15) + '…' : n.id)}</text><title>${esc(n.id + ': ' + n.description)}</title></g>`; }).join('');
  }
  async function openNote(name) {
    st.note = name; drawGraph(document.getElementById('oo-mq')?.value || '');
    const { html } = await api('/api/memory/note', { name });
    const others = st.g.nodes.filter(n => n.id !== name).map(n => `<option>${esc(n.id)}</option>`).join('');
    const ob = `obsidian://open?vault=${encodeURIComponent(st.g.vault || '')}&file=${encodeURIComponent((st.g.base || 'Agent Office') + '/Memory/' + name)}`;
    document.getElementById('oo-note').innerHTML = `<div class="oo-tools"><a class="oo-btn" href="${esc(ob)}">Open in Obsidian</a><button class="oo-btn no" data-act="del-note" data-name="${esc(name)}">Unpin (delete)</button></div>
      <div class="oo-tools"><select class="oo-in" id="oo-link">${others}</select><button class="oo-btn" data-act="link-note" data-name="${esc(name)}">Tie a string</button></div><div class="oo-doc">${html}</div>`;
  }

  // ---------- 3. filing cabinet: SOPs ----------
  async function sops(name) {
    const body = shell('Filing cabinet · SOPs', 'Kiro\'s brief and each specialist\'s instructions. Edits apply from Kiro\'s next turn. Add specialist-<name>.md for a new specialist.');
    const { sops } = await api('/api/sops'); st.sops = sops;
    const cur = sops.find(s => s.name === name) || sops[0];
    body.innerHTML = `<div class="oo-list"><div class="oo-items">${sops.map(s => `<div class="oo-item ${s.name === cur?.name ? 'on' : ''}" data-act="sop" data-name="${esc(s.name)}"><div class="oo-spine" style="background:${s.name === 'kiro-brief' ? '#ff6a13' : '#8fa3ff'}"></div><div>📁 ${esc(s.name.replace(/-/g, ' '))}</div></div>`).join('')}</div></div>
      <div class="oo-pad oo-reader">${cur ? `<div class="oo-tools"><button class="oo-btn pri" data-act="save-sop" data-name="${esc(cur.name)}">Save</button></div><textarea class="oo-in oo-ta" id="oo-sop" spellcheck="false">${esc(cur.text)}</textarea>` : 'No SOPs yet.'}</div>`;
    if (cur) body.classList.add('read');
  }

  // ---------- 4. inbox tray: approvals ----------
  function inbox() {
    const body = shell('Inbox tray', 'Requests waiting for you. Approve to let the agent go ahead.', true);
    const asks = (snap.agents || []).filter(a => a.perm);
    body.innerHTML = `<div class="oo-pad">${asks.length ? asks.map(a => `<div style="padding:10px;border-radius:9px;background:#2a1d0c;border:1px solid #8a5a1c;margin-bottom:10px">
      <div style="color:#ffb547;font-size:12.5px">${esc(a.name)} wants to run ${esc(a.perm.short)}</div>
      <pre style="margin:6px 0;padding:7px 9px;background:#120c05;border-radius:6px;color:#ffd28a;font:12px 'IBM Plex Mono',monospace;white-space:pre-wrap;word-break:break-all;max-height:140px;overflow:auto">${esc(a.perm.cmd)}</pre>
      ${a.perm.why ? `<div class="oo-meta" style="margin-bottom:6px">${esc(a.perm.why)}</div>` : ''}
      <div style="display:flex;gap:6px"><button class="oo-btn yes" data-act="decide" data-ask="${esc(a.perm.askId)}" data-d="allow">Approve</button><button class="oo-btn no" data-act="decide" data-ask="${esc(a.perm.askId)}" data-d="deny">Reject</button></div></div>`).join('')
      : '<div class="oo-meta" style="padding:20px 4px;text-align:center">The tray is empty. Nothing is waiting for you. 📭</div>'}</div>`;
  }

  // ---------- 5. breaker box ----------
  const BREAKERS = [
    ['kiro', 'Kiro (manager)', 'Off stops Kiro and its specialists right away; new tasks wait on the board.'],
    ['autopilot', 'Autopilot', 'Kiro keeps itself going between turns. Off: it only works when you send it something.'],
    ['hiring', 'Hiring', 'Kiro may hire specialists. Off: Kiro works alone (cheapest).'],
    ['autoApprove', 'Kiro auto-approve', 'Routine actions are approved by Kiro\'s safety rules; risky ones still come to you.'],
    ['bridge', 'Terminal approvals', 'Your own Claude terminals send their permission prompts to the office.'],
    ['guard', 'Subscription guard', 'Stop at the 5-hour or weekly plan limit instead of spending extra-usage credits.'],
  ];
  function breaker() {
    const body = shell('Breaker box', 'Hard switches. Flipping one takes effect immediately.', true);
    const s = { ...(snap.switches || {}), autoApprove: !!(snap.manager || {}).on };
    body.innerHTML = `<div class="oo-pad">${snap.boss?.paused ? `<div style="padding:9px 11px;border-radius:8px;background:#3a2405;border:1px solid #8a5a1c;color:#ffd28a;margin-bottom:10px">⏸ ${esc(snap.boss.paused)}</div>` : ''}
      ${BREAKERS.map(([k, label, desc]) => `<div class="oo-sw" data-act="switch" data-k="${k}" role="switch" aria-checked="${!!s[k]}" tabindex="0">
        <div class="oo-lever"><i style="top:${s[k] ? 4 : 26}px;background:${s[k] ? '#5fd38d' : '#7a3b30'}"></i></div>
        <div><div style="font-weight:600">${esc(label)} <span style="font:11px 'IBM Plex Mono';color:${s[k] ? '#5fd38d' : '#ff9a8d'}">${s[k] ? 'ON' : 'OFF'}</span></div><div class="oo-meta" style="font-family:inherit;font-size:12.5px">${esc(desc)}</div></div></div>`).join('')}</div>`;
  }

  // ---------- 6. server rack ----------
  async function rackWin() {
    if (!document.getElementById('oo-rack')) shell('Server rack', 'This machine, Docker and the office server\'s own log. Refreshes every 3 seconds.').innerHTML = '<div class="oo-pad" id="oo-rack"></div>';
    const d = await api('/api/rack'), el = document.getElementById('oo-rack'); if (!el) return;
    const bar = (v, c) => `<div class="oo-bar"><i style="width:${v}%;background:${c}"></i></div>`;
    const col = v => v > 90 ? '#e0573f' : v > 75 ? '#d9893a' : '#3f9f68';
    const atEnd = !el.querySelector('.oo-log') || el.querySelector('.oo-log').scrollHeight - el.querySelector('.oo-log').scrollTop - 270 < 30;
    el.innerHTML = `<div style="display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-bottom:14px">
      <div><div style="display:flex;justify-content:space-between"><span>CPU</span><b>${d.cpu}%</b></div>${bar(d.cpu, col(d.cpu))}</div>
      <div><div style="display:flex;justify-content:space-between"><span>Memory (${d.memTotalGb} GB)</span><b>${d.mem}%</b></div>${bar(d.mem, col(d.mem))}</div></div>
      <div class="oo-meta" style="margin-bottom:12px">${esc(d.host)} · up ${d.uptimeH} h</div>
      <div style="font-size:12px;letter-spacing:.06em;color:#7d7064;margin-bottom:6px">DOCKER</div>
      <div style="margin-bottom:14px">${d.docker === null ? '<span class="oo-meta">Docker isn\'t running or isn\'t installed.</span>' : d.docker.length ? d.docker.map(c => `<div style="display:flex;gap:8px;align-items:center;padding:3px 0"><span style="width:9px;height:9px;border-radius:50%;background:${c.state === 'running' ? '#5fd38d' : /^Exited \(0\)/.test(c.status) ? '#8c8278' : '#e0573f'}"></span><b style="font-weight:600">${esc(c.name)}</b><span class="oo-meta">${esc(c.status)} · ${esc(c.image)}</span></div>`).join('') : '<span class="oo-meta">No containers.</span>'}</div>
      <div style="font-size:12px;letter-spacing:.06em;color:#7d7064;margin-bottom:6px">OFFICE SERVER LOG</div>
      <div class="oo-log">${d.log.map(l => `<span style="color:#5d544c">${esc(l.t)}</span> <span style="color:${l.k === 'error' ? '#ff9a8d' : '#d9d1c5'}">${esc(l.text)}</span>`).join('\n') || '<span class="oo-meta">Quiet so far.</span>'}</div>`;
    const lg = el.querySelector('.oo-log'); if (atEnd) lg.scrollTop = lg.scrollHeight;
  }

  // ---------- 7. arcade: Bug Squasher ----------
  const game = {
    raf: 0, stop() { cancelAnimationFrame(this.raf); this.on = false; },
    start(cv) {
      const c = cv.getContext('2d'), W = cv.width, H = cv.height, holes = [];
      for (let r = 0; r < 3; r++) for (let q = 0; q < 4; q++) holes.push({ x: 70 + q * 115, y: 80 + r * 95, bug: 0, kind: '' });
      let score = 0, end = performance.now() + 30000, next = 0; this.on = true;
      let best = 0; try { best = +localStorage.getItem('ao-bugs') || 0; } catch {}
      const KINDS = ['{', '}', ';', '[', ']', 'undefined', 'NaN', '}}'];
      cv.onpointerdown = e => {
        const r = cv.getBoundingClientRect(), x = (e.clientX - r.left) * W / r.width, y = (e.clientY - r.top) * H / r.height;
        if (!this.on) return this.start(cv);
        for (const h of holes) if (h.bug && Math.hypot(x - h.x, y - h.y) < 34) { h.bug = 0; h.splat = performance.now(); score++; }
      };
      const loop = t => {
        c.fillStyle = '#0d1a10'; c.fillRect(0, 0, W, H);
        if (t > next) { const h = holes[Math.random() * holes.length | 0]; if (!h.bug) { h.bug = t + 900 + Math.random() * 500; h.kind = KINDS[Math.random() * KINDS.length | 0]; } next = t + 380 + Math.random() * 300; }
        for (const h of holes) {
          c.fillStyle = '#05100a'; c.beginPath(); c.ellipse(h.x, h.y + 20, 40, 12, 0, 0, 7); c.fill();
          if (h.bug && t > h.bug) h.bug = 0;
          if (h.bug) { c.fillStyle = '#ff6a6a'; c.beginPath(); c.ellipse(h.x, h.y, 24, 18, 0, 0, 7); c.fill(); c.fillStyle = '#2a0b0b'; c.font = 'bold 13px monospace'; c.textAlign = 'center'; c.fillText(h.kind, h.x, h.y + 4); c.strokeStyle = '#2a0b0b'; c.lineWidth = 2; for (const s of [-1, 1]) { c.beginPath(); c.moveTo(h.x + s * 8, h.y - 16); c.lineTo(h.x + s * 14, h.y - 26); c.stroke(); } }
          if (h.splat && t - h.splat < 300) { c.fillStyle = '#3dff8f'; c.font = 'bold 14px monospace'; c.fillText('+1', h.x, h.y - 30 - (t - h.splat) / 15); }
        }
        const left = Math.max(0, Math.ceil((end - t) / 1000));
        c.fillStyle = '#3dff8f'; c.font = '16px monospace'; c.textAlign = 'left'; c.fillText(`Bugs squashed: ${score}   Time: ${left}s   Best: ${best}`, 14, 26);
        if (left <= 0) {
          this.on = false; if (score > best) { best = score; try { localStorage.setItem('ao-bugs', score); } catch {} }
          c.fillStyle = 'rgba(0,0,0,.65)'; c.fillRect(0, 0, W, H); c.fillStyle = '#ffcf6b'; c.textAlign = 'center'; c.font = 'bold 26px monospace'; c.fillText(`Build passing! ${score} bugs`, W / 2, H / 2 - 6); c.font = '14px monospace'; c.fillText('Click to play again', W / 2, H / 2 + 22);
          return;
        }
        this.raf = requestAnimationFrame(loop);
      };
      this.raf = requestAnimationFrame(loop);
    },
  };
  function arcade() {
    const body = shell('Arcade · Bug Squasher', 'Swat the stray brackets before the build fails. 30 seconds a round.', true);
    body.innerHTML = '<div class="oo-pad" style="text-align:center"><canvas id="oo-cv" width="500" height="360" style="width:100%;max-width:500px;border-radius:8px;border:3px solid #3dff8f;cursor:crosshair;touch-action:manipulation"></canvas></div>';
    game.stop(); game.start(body.querySelector('#oo-cv'));
  }

  // ---------- 8. jukebox: generated ambience (Web Audio, nothing downloaded) ----------
  const audio = {
    ctx: null, nodes: [], playing: '',
    play(ch) {
      this.stop(); const ctx = this.ctx ||= new (window.AudioContext || window.webkitAudioContext)(); ctx.resume();
      const out = ctx.createGain(); out.gain.value = this.vol ?? .5; out.connect(ctx.destination); this.out = out;
      const noise = (type, freq, gain) => {
        const b = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate), d = b.getChannelData(0); let last = 0;
        for (let i = 0; i < d.length; i++) { const w = Math.random() * 2 - 1; d[i] = type === 'brown' ? (last = (last + .02 * w) / 1.02) * 3.5 : w; }
        const s = ctx.createBufferSource(); s.buffer = b; s.loop = true; const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = freq; const g = ctx.createGain(); g.gain.value = gain;
        s.connect(f).connect(g).connect(out); s.start(); this.nodes.push(s);
      };
      if (ch === 'rain' || ch === 'both') { noise('white', 1800, .12); noise('brown', 500, .35); }
      if (ch === 'lofi' || ch === 'both') {
        const chords = [[57, 60, 64, 67], [53, 57, 60, 64], [55, 59, 62, 65], [52, 55, 59, 62]], hz = m => 440 * 2 ** ((m - 69) / 12);
        let step = 0; noise('white', 3500, .015);
        const tick = () => {
          const t = ctx.currentTime, ch2 = chords[step++ % 4];
          for (const m of ch2) { const o = ctx.createOscillator(), g = ctx.createGain(), f = ctx.createBiquadFilter(); o.type = 'triangle'; o.frequency.value = hz(m); f.type = 'lowpass'; f.frequency.value = 900; g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(.05, t + .3); g.gain.exponentialRampToValueAtTime(.001, t + 3.6); o.connect(f).connect(g).connect(out); o.start(t); o.stop(t + 3.7); }
          for (let i = 0; i < 4; i++) { const k = ctx.createOscillator(), g = ctx.createGain(), at = t + i * .9; k.frequency.setValueAtTime(110, at); k.frequency.exponentialRampToValueAtTime(40, at + .15); g.gain.setValueAtTime(.25, at); g.gain.exponentialRampToValueAtTime(.001, at + .2); k.connect(g).connect(out); k.start(at); k.stop(at + .25); }
        };
        tick(); this.iv = setInterval(tick, 3600);
      }
      this.playing = ch; emit();
    },
    stop() { clearInterval(this.iv); this.nodes.forEach(n => { try { n.stop(); } catch {} }); this.nodes = []; this.out?.disconnect(); this.playing = ''; emit(); },
  };
  function jukebox() {
    const body = shell('Jukebox', 'Generated on your PC with Web Audio: no streams, no downloads.', true);
    const ch = [['rain', '🌧 Rain'], ['lofi', '🎹 Lo-fi'], ['both', '☕ Lo-fi in the rain']];
    body.innerHTML = `<div class="oo-pad"><div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:14px">${ch.map(([k, l]) => `<button class="oo-btn ${audio.playing === k ? 'pri' : ''}" data-act="play" data-ch="${k}">${l}</button>`).join('')}<button class="oo-btn" data-act="play" data-ch="">⏹ Stop</button></div>
      <label class="oo-meta" style="display:flex;gap:10px;align-items:center">Volume <input type="range" min="0" max="1" step=".05" value="${audio.vol ?? .5}" id="oo-vol"></label></div>`;
    body.querySelector('#oo-vol').oninput = e => { audio.vol = +e.target.value; if (audio.out) audio.out.gain.value = audio.vol; };
  }

  // ---------- 9. plant and 10. coffee ----------
  const plantLevel = () => Math.min(6, Math.floor((snap.doneReports || 0) / 3));
  function plant() {
    const n = snap.doneReports || 0, lv = plantLevel();
    shell('Server plant', 'It grows with every goal Kiro finishes successfully.', true).innerHTML = `<div class="oo-pad" style="text-align:center">
      <div style="font-size:${40 + lv * 12}px;line-height:1.1">${['🌱', '🌿', '🪴', '🌳', '🌳🌼', '🌳🌸', '🌳🌸🍎'][lv]}</div>
      <p><b>${n}</b> successful report${n === 1 ? '' : 's'} · growth stage ${lv} of 6 · 💧 ${Math.floor(n / 10)} watering can${Math.floor(n / 10) === 1 ? '' : 's'} earned</p>
      <p class="oo-meta">${lv < 6 ? `Next growth after ${3 * (lv + 1) - n} more done report${3 * (lv + 1) - n === 1 ? '' : 's'}.` : 'Fully grown. A thriving office!'}</p></div>`;
  }
  function coffee() {
    const on = !!(snap.switches || {}).espresso;
    shell('Coffee machine', 'An espresso makes Kiro\'s next hire run on the fast, cheap model (Haiku).', true).innerHTML = `<div class="oo-pad" style="text-align:center">
      <div style="font-size:54px">${on ? '☕💨' : '☕'}</div><p>${on ? 'An espresso is ready. The next specialist Kiro hires will run on Haiku.' : 'Good for quick lookups and mechanical jobs. One cup covers one hire.'}</p>
      <button class="oo-btn ${on ? '' : 'pri'}" data-act="espresso" data-on="${on ? '' : '1'}">${on ? 'Pour it out' : 'Brew an espresso'}</button></div>`;
  }

  // ---------- events ----------
  win.addEventListener('click', async e => {
    const t = e.target.closest('[data-act]'); if (!t) return;
    const d = t.dataset;
    try {
      switch (d.act) {
        case 'close': return close();
        case 'daily': return openDaily();
        case 'report': return openReport(d.file);
        case 'back': return document.getElementById('oo-body').classList.remove('read');
        case 'note': return openNote(d.name);
        case 'del-note': if (!confirm(`Delete the memory note "${d.name}" from the vault?`)) return; await api('/api/memory/delete', { name: d.name }); return memory();
        case 'link-note': await api('/api/memory/link', { from: d.name, to: document.getElementById('oo-link').value }); { const g = await api('/api/memory/graph'); st.g = g; layout(g); return openNote(d.name); }
        case 'sop': return sops(d.name);
        case 'save-sop': { const r = await api('/api/sops/save', { name: d.name, text: document.getElementById('oo-sop').value }); return toast(r.note); }
        case 'decide': t.disabled = true; await api('/api/decide', { askId: d.ask, decision: d.d }); return;
        case 'switch': {
          const s = { ...(snap.switches || {}), autoApprove: !!(snap.manager || {}).on }, on = !s[d.k];
          if (d.k === 'autoApprove') await api('/api/manager', { on }); else await api('/api/switch', { name: d.k, on });
          return;
        }
        case 'play': d.ch ? audio.play(d.ch) : audio.stop(); return jukebox();
        case 'espresso': await api('/api/switch', { name: 'espresso', on: !!d.on }); return;
      }
    } catch (err) { toast(err.message); }
  });
  win.addEventListener('keydown', e => { if ((e.key === 'Enter' || e.key === ' ') && e.target.matches('.oo-sw')) { e.preventDefault(); e.target.click(); } });

  const OPEN = { reports, memory, sops, inbox, breaker, rack: rackWin, arcade, jukebox, plant, coffee };
  function emit() { listeners.forEach(f => f({ playing: audio.playing })); }
  window.OfficeObjects = {
    open(k, arg) {
      if (!OPEN[k]) return;
      clearInterval(timer); game.stop(); kind = k; st = {};
      document.body.append(back, win);
      OPEN[k](arg);
      if (k === 'rack') timer = setInterval(rackWin, 3000);
    },
    // Live snapshot from the office stream; windows showing live state repaint.
    update(s) {
      snap = s;
      if (kind === 'inbox') inbox(); else if (kind === 'breaker') breaker(); else if (kind === 'coffee') coffee();
    },
    onState(f) { listeners.push(f); },
    plantLevel,
  };
})();
