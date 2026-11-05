// Retention: delete old history, reports and finished goals. Off unless "retentionDays" (7 or more) is set in kiro.json.
// Only files that Agent Office itself wrote are touched: agent history summaries, report files and goals marked done or dismissed.
import fs from 'node:fs';
import path from 'node:path';
import { ROSTER } from './company.mjs';

export const days = v => (Number.isFinite(Number(v)) && Number(v) >= 7 ? Math.floor(Number(v)) : 0);

// Plain files only (a symlink or junction is never followed or removed).
function pruneDir(dir, cutoff, match, out) {
  let names = []; try { names = fs.readdirSync(dir); } catch { return; }
  for (const n of names) {
    if (!match.test(n)) continue;
    const f = path.join(dir, n);
    try { const st = fs.lstatSync(f); if (st.isFile() && !st.isSymbolicLink() && st.mtimeMs < cutoff) { fs.rmSync(f, { force: true }); out.removed++; } } catch {}
  }
}

// Reports live in Reports/<YYYY-MM-DD>/*.md|json. Only real folders named like a day are entered; old files go, and a day folder
// that ends up empty is removed. The Reports folder itself and anything else in it stay.
const DAY = /^\d{4}-\d\d-\d\d$/;
function pruneReports(dir, cutoff, out) {
  pruneDir(dir, cutoff, /\.(md|json)$/, out); // older flat layout
  let names = []; try { names = fs.readdirSync(dir); } catch { return; }
  for (const n of names) {
    if (!DAY.test(n)) continue;
    const d = path.join(dir, n);
    try {
      const st = fs.lstatSync(d); if (!st.isDirectory() || st.isSymbolicLink()) continue;
      pruneDir(d, cutoff, /\.(md|json)$/, out);
      if (fs.readdirSync(d).length === 0) fs.rmdirSync(d);
    } catch {}
  }
}

// agentsRoot: ~/.claude/agent-office/agents/tiro, reportsDir: vault Reports folder, goalsFile: goals.json
export function prune({ retentionDays, agentsRoot, reportsDir, goalsFile, now = Date.now() }) {
  const d = days(retentionDays), out = { removed: 0, goals: 0, days: d };
  if (!d) return out;
  const cutoff = now - d * 86400e3;
  if (agentsRoot) for (const key of ['', ...Object.keys(ROSTER)]) pruneDir(path.join(agentsRoot, key, 'history'), cutoff, /^[\w.-]+\.md$/, out);
  if (reportsDir) pruneReports(reportsDir, cutoff, out);
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
