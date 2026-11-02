// Agent history browser: a floating "History" button and a modal. Per agent type: task list, search, summary and transcript path.
(() => {
  const KEY = new URLSearchParams(location.search).get('key') || '';
  const api = (p, b) => fetch(p, { method: 'POST', headers: { 'content-type': 'application/json', 'x-key': KEY }, body: JSON.stringify(b || {}) }).then(async r => { const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.error || 'HTTP ' + r.status); return j; });
  const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const css = 'font:13px system-ui,sans-serif;color:#eee;';
  const btn = document.createElement('button');
  btn.textContent = 'Agent history'; btn.title = 'Browse every agent\'s past tasks and memory folder';
  btn.style.cssText = 'position:fixed;left:12px;bottom:12px;z-index:9000;padding:6px 10px;border-radius:8px;border:1px solid #666;background:#222;' + css + 'cursor:pointer;';
  const box = document.createElement('div');
  box.style.cssText = 'position:fixed;inset:5% 8%;z-index:9001;display:none;background:#1b1b1f;border:1px solid #666;border-radius:10px;padding:12px;overflow:hidden;' + css;
  box.innerHTML = '<div style="display:flex;gap:8px;align-items:center;margin-bottom:8px"><b style="flex:1">Agent history</b><input id="ah-q" placeholder="search tasks" style="padding:4px 6px;background:#111;color:#eee;border:1px solid #555;border-radius:6px"><button id="ah-x" style="padding:4px 8px">Close</button></div>' +
    '<div style="display:flex;gap:10px;height:calc(100% - 40px)"><div id="ah-agents" style="width:190px;overflow:auto"></div><div id="ah-tasks" style="width:300px;overflow:auto"></div><div id="ah-detail" style="flex:1;overflow:auto;white-space:normal"></div></div>';
  const $ = id => box.querySelector('#' + id);
  let cur = 'tiro';
  async function agents() {
    const o = await api('/api/agents/overview');
    $('ah-agents').innerHTML = o.agents.map(a => `<div data-k="${a.key}" style="padding:6px;cursor:pointer;border-radius:6px;${a.key === cur ? 'background:#333' : ''}">${esc(a.name)}<br><small>${esc(a.key)} - ${a.tasks} task(s), ${a.notes} note(s)</small></div>`).join('');
    $('ah-agents').querySelectorAll('[data-k]').forEach(e => e.onclick = () => { cur = e.dataset.k; agents(); tasks(); });
  }
  async function tasks() {
    const r = await api('/api/agents/tasks', { key: cur, q: $('ah-q').value });
    $('ah-detail').innerHTML = `<small>Folder: ${esc(r.dir)}<br>Memory: ${esc(r.memory)}</small>`;
    $('ah-tasks').innerHTML = r.tasks.length ? r.tasks.map(t => `<div data-id="${esc(t.id)}" style="padding:6px;cursor:pointer;border-bottom:1px solid #333"><b>${esc(t.title || t.id)}</b><br><small>${esc(t.goalId)} ${t.startedAt ? new Date(t.startedAt).toLocaleString() : ''} ${t.endedAt ? 'done' : t.hired ? 'hired ' + esc(t.hired) : 'running'}</small><br>${esc((t.summary || '').slice(0, 120))}</div>`).join('') : '<small>No tasks yet.</small>';
    $('ah-tasks').querySelectorAll('[data-id]').forEach(e => e.onclick = async () => {
      const t = r.tasks.find(x => x.id === e.dataset.id);
      try { const d = await api('/api/agents/task', { key: cur, id: t.id }); $('ah-detail').innerHTML = d.html; } catch (er) { $('ah-detail').textContent = er.message; }
    });
  }
  btn.onclick = () => { box.style.display = 'block'; agents().catch(() => {}); tasks().catch(() => {}); };
  box.querySelector('#ah-x').onclick = () => { box.style.display = 'none'; };
  box.querySelector('#ah-q').oninput = () => tasks().catch(() => {});
  addEventListener('DOMContentLoaded', () => document.body.append(btn, box));
  if (document.readyState !== 'loading') document.body.append(btn, box);
})();
