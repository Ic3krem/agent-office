// Retention: delete old history, reports and finished goals. Off unless "retentionDays" (7 or more) is set in kiro.json.
// Only files that Agent Office itself wrote are touched: agent history summaries, report files and goals marked done or dismissed.
import fs from 'node:fs';
import path from 'node:path';

export const days = v => (Number.isFinite(Number(v)) && Number(v) >= 7 ? Math.floor(Number(v)) : 0);

function pruneDir(dir, cutoff, match, out) {
  let names = []; try { names = fs.readdirSync(dir); } catch { return; }
  for (const n of names) {
    if (!match.test(n)) continue;
    const f = path.join(dir, n);
    try { const st = fs.statSync(f); if (st.isFile() && st.mtimeMs < cutoff) { fs.rmSync(f, { force: true }); out.removed++; } } catch {}
  }
}

// agentsRoot: ~/.claude/agent-office/agents/tiro, reportsDir: vault Reports folder, goalsFile: goals.json
export function prune({ retentionDays, agentsRoot, reportsDir, goalsFile, now = Date.now() }) {
  const d = days(retentionDays), out = { removed: 0, goals: 0, days: d };
  if (!d) return out;
  const cutoff = now - d * 86400e3;
  for (const key of ['', 'pixel', 'forge', 'warden', 'probe', 'atlas', 'cabalan', 'tally', 'scribe']) pruneDir(path.join(agentsRoot, key, 'history'), cutoff, /^[\w.-]+\.md$/, out);
  if (reportsDir) pruneDir(reportsDir, cutoff, /\.(md|json)$/, out);
  if (goalsFile) {
    try {
      const j = JSON.parse(fs.readFileSync(goalsFile, 'utf8'));
      const keep = (j.goals || []).filter(g => !(['done', 'dismissed'].includes(g.status) && Number(g.at) < cutoff));
      out.goals = (j.goals || []).length - keep.length;
      if (out.goals) fs.writeFileSync(goalsFile, JSON.stringify({ ...j, goals: keep }, null, 1));
    } catch {}
  }
  return out;
}
