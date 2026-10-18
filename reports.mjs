// Reports the user actually reads: one structured report per goal plus a daily summary, all plain files in the vault.
// Rendering, PDF (print page) and Excel exports are code only; no model calls.
import fs from 'node:fs';
import path from 'node:path';
import ExcelJS from 'exceljs';

export const OUTCOMES = { done: ['Done', '#2e7d4f', '✅'], partial: ['Partly done', '#b7791f', '🟡'], blocked: ['Needs you', '#c0392b', '⛔'], info: ['For your information', '#2b6cb0', 'ℹ️'] };
const FIND = { ok: ['OK', '✅'], issue: ['Issue', '⚠️'], info: ['Note', 'ℹ️'] };
const NAME = /^\d{4}-\d\d-\d\d\/[a-z0-9-]+\.md$/;
const slug = t => String(t).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 50) || 'report';
const cell = t => String(t ?? '').replace(/\|/g, '\\|').replace(/\n+/g, ' ');
const today = () => new Date().toLocaleDateString('en-CA');

export function reportMarkdown(r) {
  const [label, , icon] = OUTCOMES[r.outcome] || OUTCOMES.info;
  return [
    '---', 'type: report', `goal: ${r.goalId || ''}`, `outcome: ${r.outcome}`, `date: ${r.date}`, `tags: [agent-office/report, outcome/${r.outcome}]`, '---',
    `# ${r.title}`, '', `**Outcome:** ${icon} ${label} · ${r.date} ${r.time}${r.goalId ? ' · goal ' + r.goalId : ''}`, '',
    '## Summary', '', r.summary.trim(), '',
    ...(r.findings?.length ? ['## Findings', '', '| Status | Item | Detail |', '|---|---|---|', ...r.findings.map(f => `| ${(FIND[f.status] || FIND.info)[1]} ${(FIND[f.status] || FIND.info)[0]} | ${cell(f.item)} | ${cell(f.detail)} |`), ''] : []),
    ...(r.nextSteps?.length ? ['## Next steps', '', ...r.nextSteps.map((s, i) => `${i + 1}. ${s}`), ''] : []),
    ...(r.details?.trim() ? ['## Details', '', r.details.trim(), ''] : []),
  ].join('\n');
}

export function reportStore(dir) {
  fs.mkdirSync(dir, { recursive: true });
  let cache = null, cachedAt = 0; // listing reads every report; snapshots ask often
  const meta = file => {
    try { return JSON.parse(fs.readFileSync(path.join(dir, file.replace(/\.md$/, '.json')), 'utf8')); } catch {}
    const text = fs.readFileSync(path.join(dir, file), 'utf8'); // older free-form reports
    return { title: (text.match(/^# (.+)/m) || [, file])[1], outcome: (text.match(/^outcome: (\w+)/m) || [, 'info'])[1], summary: '', legacy: true, body: text };
  };
  return {
    dir,
    save(r) {
      const now = new Date(), day = today();
      const rec = { goalId: r.goalId || '', title: String(r.title).slice(0, 140), outcome: OUTCOMES[r.outcome] ? r.outcome : 'info', summary: String(r.summary || ''),
        findings: (r.findings || []).slice(0, 60), nextSteps: (r.nextSteps || []).slice(0, 20), details: String(r.details || ''), date: day, time: now.toTimeString().slice(0, 5) };
      fs.mkdirSync(path.join(dir, day), { recursive: true });
      const file = `${day}/${rec.goalId ? rec.goalId + '-' : ''}${slug(rec.title)}.md`;
      fs.writeFileSync(path.join(dir, file), reportMarkdown(rec));
      fs.writeFileSync(path.join(dir, file.replace(/\.md$/, '.json')), JSON.stringify(rec, null, 1));
      cache = null;
      return file;
    },
    list() {
      if (cache && Date.now() - cachedAt < 15e3) return cache;
      let days = []; try { days = fs.readdirSync(dir).filter(d => /^\d{4}-\d\d-\d\d$/.test(d)).sort().reverse(); } catch {}
      cachedAt = Date.now();
      return (cache = days.flatMap(day => fs.readdirSync(path.join(dir, day)).filter(n => n.endsWith('.md')).map(n => {
        const file = `${day}/${n}`, m = meta(file);
        return { file, day, title: m.title, outcome: m.outcome, summary: m.summary, at: fs.statSync(path.join(dir, file)).mtimeMs, goalId: (n.match(/^(g[0-9a-f]{6})-/) || [])[1] || '' };
      }).sort((a, b) => b.at - a.at)));
    },
    // Only names this store produced: no path traversal from the browser.
    read(file) { if (!NAME.test(file)) throw new Error('bad report name'); return fs.readFileSync(path.join(dir, file), 'utf8'); },
    meta(file) { if (!NAME.test(file)) throw new Error('bad report name'); return meta(file); },
  };
}

// ---------- the general daily report (from the goal board, reports and usage) ----------
export function dailyMarkdown({ day, goals, reports, usage, approvals }) {
  const live = goals.filter(g => g.status !== 'dismissed'), by = s => live.filter(g => g.status === s);
  const rep = g => { const r = reports.find(x => x.goalId === g.id); return r ? `[[Agent Office/Reports/${r.file.replace(/\.md$/, '')}\\|${cell(r.title)}]]` : ''; };
  const u = usage || {};
  return [
    '---', 'type: daily', `date: ${day}`, 'tags: [agent-office/daily]', '---',
    `# Daily report · ${day}`, '',
    `**${by('done').length} done · ${by('blocked').length} need you · ${by('doing').length + by('todo').length} open** · ${reports.length} report${reports.length === 1 ? '' : 's'} filed${approvals ? ` · ${approvals.approved} approved automatically, ${approvals.escalated} sent to you` : ''}`, '',
    ...(by('blocked').length ? ['## Needs you', '', '| Goal | What is needed | Report |', '|---|---|---|', ...by('blocked').map(g => `| ${cell(g.text)} | ${cell(g.note)} | ${rep(g)} |`), ''] : []),
    ...(by('done').length ? ['## Done', '', '| Goal | Result | Report |', '|---|---|---|', ...by('done').map(g => `| ${cell(g.text)} | ${cell(g.note)} | ${rep(g)} |`), ''] : []),
    ...(by('doing').length + by('todo').length ? ['## In progress', '', '| Goal | Status | Note |', '|---|---|---|', ...[...by('doing'), ...by('todo')].map(g => `| ${cell(g.text)} | ${g.status === 'doing' ? 'Working' : 'To do'} | ${cell(g.note)} |`), ''] : []),
    ...(by('proposed').length ? ['## Ideas waiting for your OK', '', ...by('proposed').map(g => `- ${g.text}`), ''] : []),
    '## Usage', '', `Tokens today: ${(u.tokens / 1e6 || 0).toFixed(1)}M · 5-hour limit: ${u.session ?? '–'}% · weekly limit: ${u.weekly ?? '–'}%${u.credits ? ` · extra credits today: $${u.credits.toFixed(2)}` : ''}`, '',
  ].join('\n');
}

// ---------- Markdown to HTML (escaped first: report text can't inject markup) ----------
export function mdToHtml(src) {
  const esc = t => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const inl = t => esc(t).replace(/\[\[([^\]|]+?)(?:\\?\|([^\]]+))?\]\]/g, (_, a, b) => `<span class="wl">${b || a.split('/').pop()}</span>`)
    .replace(/`([^`]+)`/g, '<code>$1</code>').replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>').replace(/(^|\s)_([^_]+)_(?=\s|$|[.,;:])/g, '$1<i>$2</i>');
  const out = []; let list = null, code = null, table = null;
  const flush = () => {
    if (list) { out.push(`<${list.t}>` + list.items.map(i => `<li>${inl(i)}</li>`).join('') + `</${list.t}>`); list = null; }
    if (table) { out.push('<div class="tw"><table>' + table.map((r, i) => '<tr>' + r.map(c => `<${i ? 'td' : 'th'}>${inl(c)}</${i ? 'td' : 'th'}>`).join('') + '</tr>').join('') + '</table></div>'); table = null; }
  };
  const body = String(src).replace(/^---\n[\s\S]*?\n---\n?/, '');
  for (const line of body.split('\n')) {
    if (code !== null) { if (/^```/.test(line)) { out.push(`<pre>${esc(code)}</pre>`); code = null; } else code += (code ? '\n' : '') + line; continue; }
    if (/^```/.test(line)) { flush(); code = ''; continue; }
    let m;
    if (/^\|.*\|\s*$/.test(line)) { if (list) flush(); if (/^\|[\s:|-]+\|\s*$/.test(line)) continue; (table ||= []).push(line.trim().slice(1, -1).split(/(?<!\\)\|/).map(c => c.trim().replace(/\\\|/g, '|'))); continue; }
    if ((m = line.match(/^(#{1,4})\s+(.*)/))) { flush(); out.push(`<h${m[1].length}>${inl(m[2])}</h${m[1].length}>`); continue; }
    if ((m = line.match(/^\s*([-*]|\d+\.)\s+(.*)/))) { const t = /\d/.test(m[1]) ? 'ol' : 'ul'; if (table) flush(); if (!list || list.t !== t) { flush(); list = { t, items: [] }; } list.items.push(m[2]); continue; }
    flush();
    if (line.trim()) out.push(`<p>${inl(line)}</p>`);
  }
  if (code !== null) out.push(`<pre>${esc(code)}</pre>`);
  flush();
  return out.join('');
}

// A clean, printable page; ?print=1 opens the browser's Save as PDF dialog.
export function printPage(title, markdown) {
  return `<!doctype html><html><head><meta charset="utf-8"><title>${title.replace(/</g, '&lt;')}</title><style>
  @page { size: A4; margin: 16mm; }
  body { font: 14px/1.55 'Segoe UI', system-ui, -apple-system, sans-serif; color: #1f2328; max-width: 820px; margin: 24px auto; padding: 0 20px; }
  h1 { font-size: 24px; margin: 0 0 6px; } h2 { font-size: 17px; margin: 22px 0 8px; padding-bottom: 4px; border-bottom: 1px solid #e3e6ea; } h3 { font-size: 15px; }
  table { border-collapse: collapse; width: 100%; font-size: 13px; } th, td { border: 1px solid #d8dde3; padding: 6px 9px; text-align: left; vertical-align: top; } th { background: #f4f6f8; }
  code { background: #f4f6f8; padding: 1px 5px; border-radius: 4px; font-size: 12.5px; } pre { background: #f6f8fa; padding: 10px 12px; border-radius: 6px; overflow-x: auto; font-size: 12.5px; white-space: pre-wrap; }
  .wl { color: #2b6cb0; } .bar { display: flex; gap: 8px; margin-bottom: 18px; } .bar a { padding: 7px 12px; border-radius: 6px; background: #1f2328; color: #fff; text-decoration: none; font-size: 13px; }
  @media print { .bar { display: none; } body { margin: 0; } }
  </style></head><body><div class="bar"><a href="javascript:print()">Save as PDF / Print</a></div>${mdToHtml(markdown)}
  <script>if (new URLSearchParams(location.search).get('print')) addEventListener('load', () => setTimeout(print, 300));</script></body></html>`;
}

// ---------- Excel ----------
const style = ws => { ws.getRow(1).font = { bold: true }; ws.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF4F6F8' } }; ws.views = [{ state: 'frozen', ySplit: 1 }]; ws.eachRow(r => { r.alignment = { wrapText: true, vertical: 'top' }; }); };
export async function reportXlsx(m) {
  const wb = new ExcelJS.Workbook();
  const s = wb.addWorksheet('Summary');
  s.columns = [{ header: 'Field', width: 16 }, { header: 'Value', width: 100 }];
  s.addRows([['Title', m.title], ['Outcome', (OUTCOMES[m.outcome] || OUTCOMES.info)[0]], ['Date', `${m.date || ''} ${m.time || ''}`], ['Goal', m.goalId || ''], ['Summary', m.summary || (m.legacy ? m.body : '')], ['Next steps', (m.nextSteps || []).map((x, i) => `${i + 1}. ${x}`).join('\n')]]);
  style(s);
  if (m.findings?.length) {
    const f = wb.addWorksheet('Findings');
    f.columns = [{ header: 'Status', width: 10 }, { header: 'Item', width: 40 }, { header: 'Detail', width: 90 }];
    m.findings.forEach(x => f.addRow([(FIND[x.status] || FIND.info)[0], x.item, x.detail]));
    style(f);
  }
  return wb.xlsx.writeBuffer();
}
export async function dailyXlsx({ day, goals, reports, usageDays }) {
  const wb = new ExcelJS.Workbook();
  const g = wb.addWorksheet('Goals');
  g.columns = [{ header: 'Goal', width: 60 }, { header: 'Status', width: 12 }, { header: 'Result / note', width: 80 }, { header: 'Report', width: 50 }];
  goals.filter(x => x.status !== 'dismissed').forEach(x => g.addRow([x.text, x.status, x.note || '', reports.find(r => r.goalId === x.id)?.title || '']));
  style(g);
  const r = wb.addWorksheet('Reports');
  r.columns = [{ header: 'Date', width: 12 }, { header: 'Title', width: 60 }, { header: 'Outcome', width: 14 }, { header: 'Summary', width: 90 }];
  reports.forEach(x => r.addRow([x.day, x.title, (OUTCOMES[x.outcome] || OUTCOMES.info)[0], x.summary || '']));
  style(r);
  const u = wb.addWorksheet('Usage');
  u.columns = [{ header: 'Day', width: 12 }, { header: 'Tokens', width: 14 }, { header: 'API value (USD, not billed)', width: 26 }, { header: 'Extra credits (USD)', width: 18 }];
  (usageDays || []).forEach(x => u.addRow([x.day, x.tokens, +x.cost.toFixed(2), +(x.credits || 0).toFixed(2)]));
  style(u);
  wb.creator = 'Agent Office'; wb.title = 'Daily report ' + day;
  return wb.xlsx.writeBuffer();
}
