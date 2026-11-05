// Writes site/stats.json from GitHub's own per-asset download counts. Run by the Pages workflow on a schedule; nothing about
// visitors is collected. Only installers count (not .blockmap, .zip update payloads or latest*.yml metadata). The in-app updater
// downloads the same installer, so updates are included in the totals.
//   node site/tools/fetch-stats.mjs [owner/repo]     (GITHUB_TOKEN optional; raises the API rate limit)
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

export const PLATFORM = [[/\.exe$/i, 'windows'], [/\.dmg$/i, 'macos'], [/\.(AppImage|deb)$/i, 'linux']];
export const platformOf = name => (PLATFORM.find(([re]) => re.test(name)) || [])[1] || null;

export function summarise(releases, asOf) {
  const byPlatform = { windows: 0, macos: 0, linux: 0 }, byRelease = [];
  for (const r of releases) {
    if (r.draft) continue;
    let n = 0;
    for (const a of r.assets || []) { const p = platformOf(a.name); if (!p) continue; const c = Number(a.download_count) || 0; byPlatform[p] += c; n += c; }
    byRelease.push({ version: String(r.tag_name).replace(/^v/, ''), date: String(r.published_at || '').slice(0, 10), downloads: n });
  }
  byRelease.sort((a, b) => (a.date < b.date) - (a.date > b.date));
  return { schema: 2, placeholder: false, asOf, source: 'GitHub release asset download counts (installers only; in-app updates included)', total: Object.values(byPlatform).reduce((a, b) => a + b, 0), byPlatform, byRelease };
}

async function fetchReleases(repo, token) {
  const out = [];
  for (let page = 1; page < 20; page++) {
    const r = await fetch(`https://api.github.com/repos/${repo}/releases?per_page=100&page=${page}`, { headers: { accept: 'application/vnd.github+json', 'user-agent': 'agent-office-site', ...(token ? { authorization: `Bearer ${token}` } : {}) } });
    if (!r.ok) throw new Error(`GitHub API ${r.status} for ${repo}`);
    const batch = await r.json();
    out.push(...batch);
    if (batch.length < 100) return out;
  }
  return out;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const repo = process.argv[2] || 'Ic3krem/agent-office';
  const stats = summarise(await fetchReleases(repo, process.env.GITHUB_TOKEN), new Date().toISOString().slice(0, 10));
  fs.writeFileSync(new URL('../stats.json', import.meta.url), JSON.stringify(stats, null, 2) + '\n');
  console.log(`stats.json: ${stats.total} installer downloads across ${stats.byRelease.length} releases`);
}
