import { layout, esc, picture, release } from './layout.mjs';

export const fmtSize = n => (typeof n === 'number' && n > 0 ? (n / 1048576).toFixed(1) + ' MB' : '-');
export const shortSha = s => (/^[0-9a-f]{64}$/.test(s) ? s.slice(0, 8) + '…' + s.slice(-8) : 'not published');

const team = [
  ['Pixel', 'Frontend engineer', 'sonnet', 'read, web, Bash, Edit, Write'],
  ['Forge', 'Backend engineer', 'sonnet', 'read, web, Bash, Edit, Write'],
  ['Warden', 'Security reviewer', 'opus', 'read-only (+ web, Bash)'],
  ['Probe', 'QA and test engineer', 'sonnet', 'read-only (+ web, Bash)'],
  ['Atlas', 'Deep researcher', 'opus', 'read-only (+ web, Bash)'],
  ['Cabalan', 'Researcher', 'haiku', 'read-only (+ web, Bash)'],
  ['Tally', 'Task checker and organizer', 'haiku', 'Read, Grep, Glob, Edit, Write'],
  ['Scribe', 'SOP and document writer', 'sonnet', 'read, web, Edit, Write'],
];

const trust = ['No tokens for the office itself', 'You approve every hire', 'Local only: 127.0.0.1', 'Signed updates', 'No cookies, no trackers'];

const panels = [
  ['08-hire-approval-card', 'You approve every hire', 'Tiro cannot hire on its own. A card shows the goal and the reason. One approval buys exactly one hire, tied to the first prompt, and expires after 10 minutes.', 'docs/approvals.html', 'How approvals work', 'Tiro asking to hire Warden, with the goal, the reason and Approve hire and Deny buttons'],
  ['13-island-chat', 'The dynamic island', 'A notch-style overlay with live agent status, approvals, quick actions, now playing with synced lyrics and themes. Answer a prompt with Y or N without leaving your work.', 'docs/island.html', 'The island and tray', 'The island chat box and quick actions'],
  ['16-reports-panel', 'Reports and a Markdown vault', 'Findings are filed as color-coded reports with PDF and Excel export. Notes, memory and SOPs are plain Markdown in your own vault.', 'docs/goals-and-reports.html', 'Goals, reports and the vault', 'The Reports bookshelf with a daily summary and demo reports'],
  ['09-agent-history-overlay', 'Memory and history per agent', 'Every task starts in a fresh context. Each agent keeps its own notes, and the Agent history overlay lets you browse past tasks and summaries.', 'docs/agents-and-memory.html', 'Agents and memory', 'Agent history: every agent with task counts and past tasks'],
];

const security = [
  ['Local only', 'The server binds 127.0.0.1 and rejects any other Host header. The UI key stays in the app process and an HttpOnly cookie, so an agent cannot approve its own requests.'],
  ['Strict CSP', 'Pages load scripts, styles and fonts only from the app itself. React, Babel and the fonts are vendored, so nothing loads from a CDN.'],
  ['Hardened windows', 'Context isolation and sandbox on, no Node integration, navigation locked to the local server, webviews blocked.'],
  ['Verified updates', 'The updater accepts only a release manifest with a valid Ed25519 signature from the key pinned in the app, and checks the installer SHA-256 twice before it runs.'],
  ['Approvals stay yours', 'Tool permissions are Claude Code\'s own. What would ask you still asks you. Nothing is auto-approved or timed out into an answer.'],
  ['Security Guard', 'An ask-only layer that watches for secrets leaving the machine, unwanted scripts and persistence, credential stores and untrusted instructions. A safety net, not a boundary. <a href="docs/security-guard.html">How it works</a>.'],
];

const v2 = [
  ['Build mode', 'A Gather.town-style editor: drag, add, duplicate and delete furniture, paint and resize zones, undo and redo, and workspace templates (Startup Loft, Agency Floor, Hotel Back-Office). Mouse and touch.'],
  ['Department desks', 'Place desks to choose Tiro\'s team: IT (Byte), Accounting (Ledger), Marketing (Spark), Auditor (Vera) and Notetaker (Memo), plus the original eight. Removing a desk retires the role and keeps its memory.'],
  ['Walk the office as the CEO', 'Keyboard, click-to-walk or an on-screen joystick. Walk up to Tiro for Chat, Prioritize, Boost (strongest model, with a cost confirmation and plan-limit checks) or Speed (fastest model). Walk up to a desk to see what a specialist is doing.'],
  ['Security hardening for release', 'Every write needs the session token, malformed transcripts, notes and layouts cannot break the office, secret redaction is better, and hire approvals show the full request.'],
];


const faq = [
  ['Does the office cost tokens?', 'No. Only agents that are working cost tokens, and only on your Claude Code plan.'],
  ['Which systems does it run on?', 'Windows 10 or later today. macOS and Linux builds are not published yet.'],
  ['Do I need Claude Code?', 'Yes. Install Claude Code and log in once by running claude. Agent Office uses your own install and plan.'],
  ['Can an agent hire without asking me?', 'No. Every hire needs your one-shot approval, which expires after 10 minutes and is cleared when Tiro\'s session ends or resets.'],
  ['Why does Windows warn me when I install it?', 'The builds are not code-signed. SmartScreen may show a warning, and Windows 11 Smart App Control can block unsigned installers. Compare the installer\'s SHA-256 first. See the <a href="download.html#smartscreen">download page</a>.'],
  ['Where is my data?', 'On your machine: ~/.claude/agent-office, your vault and Claude Code\'s own ~/.claude/projects. Model calls go to Anthropic through Claude Code, as in the terminal.'],
  ['Does it read my email?', 'No. The scheduler reads a local feed file that you must produce yourself.'],
  ['Does this site track me?', 'No cookies and no consent banner. See the <a href="privacy.html">privacy page</a>.'],
];

export function dlButton({ big = true, id = 'dl-button', label = 'Download for Windows' } = {}) {
  return `<a ${id ? `id="${id}" ` : ''}class="btn${big ? ' big' : ''}" href="${esc(release.url)}" data-dl-link download="${esc(release.asset)}"><span${id ? ' id="dl-label"' : ''}>${label}</span></a>`;
}

export function homePage() {
  const main = `<main id="main">
<section class="hero">
<div class="wrap hero-grid">
<div>
<p class="eyebrow">Windows app for Claude Code users</p>
<h1>A pixel office for your own Claude Code agents.</h1>
<p class="lead">Tiro, a little orange cube-crab, is the office manager. Give Tiro a task. It plans the work, asks you before it hires a specialist and files reports into plain Markdown notes. The office itself spends no tokens.</p>
<div class="cta-row">${dlButton()}<div class="mascot mascot-work" role="img" aria-label="Tiro with a headset, working"></div></div>
<p class="meta dl-line">v<span data-fill="version">${release.version}</span> &middot; <span data-fill="size">${fmtSize(release.size)}</span> &middot; Windows 10/11</p>
<p class="meta">SHA-256 <code data-fill="sha-short">${shortSha(release.sha256)}</code> &middot; <a href="download.html#verify">Verify</a> &middot; <a href="download.html#smartscreen">Windows warning?</a></p>
<p id="os-note" class="notice compact" hidden></p>
<div class="btn-row"><a class="btn secondary" href="docs/index.html">Read the docs</a><a class="btn secondary" href="quickstart.html">Quickstart</a></div>
<p class="meta">macOS and Linux: coming, not published yet.</p>
</div>
<div class="hero-shot">${picture('', 'hero', 'The Agent Office dashboard: eight specialists at their desks in an isometric office, a hire approval card on the goal board and the status bar on top', { priority: true, sizes: '(min-width: 900px) 54vw, 100vw' })}</div>
</div>
</section>

<section class="trust" aria-label="Trust">
<div class="wrap">
<ul class="trust-list">${trust.map(t => `<li>${esc(t)}</li>`).join('')}</ul>
<p class="meta"><span data-stats>Public download statistics start after the first real snapshot.</span> <a href="stats.html">Statistics</a></p>
</div>
</section>

<section class="block" id="how">
<div class="wrap">
<div class="section-head"><h2>How it works</h2><p>You stay in charge of every step that matters.</p></div>
<ol class="steps">
<li><strong>Give Tiro a task</strong>Type it in the dispatch box. It lands on today's board as a goal.</li>
<li><strong>Approve the hire</strong>Tiro asks for the specialist it needs. One approval buys exactly one hire.</li>
<li><strong>Agents work, you watch</strong>Prompts that Claude Code would show you appear in the dashboard and the island.</li>
<li><strong>Read the report</strong>Findings are filed as reports, and each agent keeps notes for the next task.</li>
</ol>
</div>
</section>

<section class="block" id="features">
<div class="wrap">
<div class="section-head"><h2>A tour of the office</h2><p>Everything runs locally on top of the Claude Code you already have. Your settings, permissions, hooks and MCP servers apply unchanged.</p></div>
${panels.map(([img, t, d, href, linkText, alt], i) => `<div class="panel${i % 2 ? ' flip' : ''}"><div class="panel-text"><h3>${esc(t)}</h3><p>${esc(d)}</p><p><a href="${href}">${esc(linkText)}</a></p></div><div class="panel-shot">${picture('', img, esc(alt), { sizes: '(min-width: 900px) 50vw, 100vw' })}</div></div>`).join('\n')}
<div class="panel"><div class="panel-text"><h3>Breaker box and Security Guard</h3><p>Hard switches for Tiro, autopilot, hiring and terminal approvals, plus a subscription guard that stops at your plan limit instead of spending extra-usage credits. The ask-only Security Guard asks before secrets leave your computer or a downloaded script runs.</p><p><a href="docs/breaker-box.html">Breaker box</a> &middot; <a href="docs/security-guard.html">Security Guard</a></p></div><div class="panel-shot"><div class="card"><h3>What the Guard asks about</h3><ul><li>Secrets leaving this computer</li><li>Downloaded scripts and persistence</li><li>Credential stores</li><li>Untrusted instructions in web or mail text</li></ul></div></div></div>
</div>
</section>

<section class="block" id="next">
<div class="wrap">
<div class="section-head"><p><span class="badge">New in 2.0</span></p><h2>Agent Office is now TiroAgents</h2><p>Version 2.0 renames Agent Office to TiroAgents, after Tiro, the manager agent, and turns the office into a town. Installing it replaces Agent Office 1.x and keeps your settings. <a href="changelog.html#200-tiroagents-2026-11-17">Read the changelog</a>.</p></div>
<div class="panel"><div class="panel-text"><h3>${esc(v2[0][0])}</h3><p>${esc(v2[0][1])}</p></div><div class="panel-shot">${picture('', '18-build-mode', 'Build mode: the furniture palette on the left, the office floor with zones painted on it and the Undo, Redo, Delete, Duplicate, Templates and Save toolbar on top', { sizes: '(min-width: 900px) 50vw, 100vw' })}</div></div>
<div class="panel flip"><div class="panel-text"><h3>${esc(v2[2][0])}</h3><p>${esc(v2[2][1])}</p></div><div class="panel-shot">${picture('', '19-ceo-radial-menu', 'The CEO standing next to Tiro, with the Chat, Prioritize, Boost and Speed menu around Tiro', { sizes: '(min-width: 900px) 50vw, 100vw' })}</div></div>
<div class="grid">${[v2[1], v2[3]].map(([t, d]) => `<div class="card"><h3>${esc(t)}</h3><p>${esc(d)}</p></div>`).join('')}</div>
<div class="btn-row">${dlButton({ id: '', label: `Get v${release.version}` })}<a class="btn secondary" href="changelog.html#200-tiroagents-2026-11-17">What's new</a></div>
</div>
</section>

<section class="block" id="team">
<div class="wrap">
<div class="section-head"><h2>Meet Tiro and the team</h2><p>Tiro leads a fixed team of eight specialists, at most eight working at once. Tiro runs on Sonnet at medium effort and picks Haiku, Sonnet or Opus for each hire. Its mood follows the work.</p></div>
<div class="moods">${picture('', 'tiro-moods', 'Tiro in eight moods: idle, all goals done, agents working, building, planning, needs your approval, goal done and paused at plan limit', { sizes: '(min-width: 1120px) 1080px, 100vw' })}</div>
<div class="grid team-grid">${team.map(([n, r, m, t]) => `<div class="card team-card"><h3>${n}</h3><p>${esc(r)}</p><p class="model">${m}</p><p class="tools">${esc(t)}</p></div>`).join('')}</div>
</div>
</section>

<section class="block" id="security">
<div class="wrap">
<div class="section-head"><h2>Security model</h2><p>Built so that an agent working for you cannot approve its own requests. <a href="docs/security.html">Read the full model</a> or the <a href="docs/permissions.html">permissions page</a>.</p></div>
<div class="grid">${security.map(([t, d]) => `<div class="card"><h3>${esc(t)}</h3><p>${d.includes('<a ') ? d : esc(d)}</p></div>`).join('')}</div>
</div>
</section>

<section class="block" id="faq">
<div class="wrap">
<div class="section-head"><h2>FAQ</h2></div>
<div class="faq">${faq.map(([q, a]) => `<details><summary>${esc(q)}</summary><div><p>${a.includes('<a ') ? a : esc(a)}</p></div></details>`).join('')}</div>
<p>More answers are on the <a href="docs/troubleshooting.html">troubleshooting page</a> and the <a href="docs/faq.html">FAQ</a>.</p>
</div>
</section>

<section class="block closing" id="get">
<div class="wrap">
<h2>Put Tiro to work</h2>
<p class="lead">Windows 10 or later and Claude Code, logged in. Takes a few minutes.</p>
<div class="btn-row">${dlButton({ id: '', label: 'Download for Windows' })}<a class="btn secondary" href="quickstart.html">Quickstart</a></div>
</div>
</section>

<section class="block" id="licence">
<div class="wrap">
<div class="section-head"><h2>Licence</h2></div>
<p>Agent Office is open source under the <a href="https://github.com/Ic3krem/agent-office/blob/main/LICENSE">Apache License 2.0</a>. Use it, change it and share it; pull requests are welcome (see the <a href="https://github.com/Ic3krem/agent-office/blob/main/CONTRIBUTING.md">contributing guide</a>). Versions 1.1.0 to 1.1.4 and 1.2.5 were released under MIT. Third-party components keep their own licences, listed in the notices that ship with the installer; the Claude Agent SDK is Anthropic's own software under Anthropic's terms.</p>
<p>Not affiliated with Anthropic: Claude and Claude Code are Anthropic products, and Agent Office runs on your own Claude Code install and plan.</p>
</div>
</section>
</main>`;
  return layout({ root: '', title: 'Agent Office - a pixel office for your Claude Code agents', desc: 'Tiro, an orange cube-crab office manager, hires specialist Claude Code agents with your approval. The office spends no tokens. Windows installer.', nav: 'home', main, scripts: ['release.js'] });
}
