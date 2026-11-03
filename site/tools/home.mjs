import { layout, esc } from './layout.mjs';

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

const features = [
  ['Zero office tokens', 'Every piece of furniture reads files, switches and system data directly. Models run only while an agent works, through your own Claude Code install and plan.'],
  ['Strict hiring approvals', 'Tiro cannot hire on its own. Every hire needs your one-shot approval, tied to the goal and the first prompt, and it expires after 10 minutes.'],
  ['Your Claude Code, unchanged', 'Same settings, permissions, hooks, MCP servers, CLAUDE.md, skills and plugins as a plain claude run. Agent Office adds no approval rules of its own.'],
  ['Renamable team', 'Give Tiro and each specialist a display name. Ids, folders and history stay with the agent.'],
  ['Per-agent memory and history', 'Each agent type has its own memory and history folder. Every task starts in a fresh context, and the Agent history overlay lets you browse past work.'],
  ['Reports and a Markdown vault', 'Color-coded reports with PDF and Excel export, a memory corkboard and editable SOPs, all plain Markdown in your own vault.'],
  ['Dynamic island', 'A notch-style overlay with live agent status, approvals, quick actions, now playing with synced lyrics, themes and settings.'],
  ['Breaker box switches', 'Hard switches for Tiro, autopilot, hiring and terminal approvals, plus a subscription guard that stops at your plan limit instead of spending extra-usage credits.'],
  ['Silhouette click areas', 'Furniture and characters are picked by their drawn shape, with a hover outline and depth sorting.'],
];

const gallery = [
  ['01-dashboard-overview.png', 'The office', 'The whole office with eight specialists at work, the goal board and the status bar.'],
  ['08-hire-approval-card.png', 'Approve each hire', 'Tiro asks to hire Warden. You see the goal and the reason and choose Approve hire or Deny.'],
  ['07-team-panel-rename.png', 'Rename your team', 'A role card and a rename box for every agent.'],
  ['09-agent-history-overlay.png', 'Per-agent history', 'Every agent with task counts, and the past tasks of one of them.'],
  ['16-reports-panel.png', 'Reports', 'The bookshelf with a daily summary and reports, exportable to PDF and Excel.'],
  ['11-scheduler-panel.png', 'Scheduler station', 'Read-only status of the scheduler job: items found, next check, subject-only list.'],
  ['12-island-pill.png', 'The island', 'The notch-style overlay with Home, Calendar and Settings tabs.'],
  ['15-click-outline-hover.png', 'Click outlines', 'A desk outlined on hover, following its silhouette.'],
  ['06-manager-office-tiro.png', 'Tiro at work', 'The office manager at the desk in the glass office.'],
];

const security = [
  ['Local only', 'The server binds 127.0.0.1 and rejects any other Host header. The UI key never leaves the app process and an HttpOnly cookie, so an agent cannot approve its own requests.'],
  ['Strict CSP', 'Pages load scripts, styles and fonts only from the app itself. React, Babel and the fonts are vendored, so nothing loads from a CDN.'],
  ['Hardened windows', 'Context isolation and sandbox on, no Node integration, navigation locked to the local server, webviews blocked.'],
  ['Verified installs', 'The install script and the updater check a SHA-256 before running anything, and use https only.'],
  ['Approvals stay yours', 'Tool permissions are Claude Code\'s own. What would ask you still asks you. Nothing is auto-approved or timed out into an answer.'],
  ['No mail access', 'The scheduler reads a local feed file that you produce. Agent Office has no mail credentials or network mail code.'],
];

const faq = [
  ['Does the office cost tokens?', 'No. Only agents that are working cost tokens, and only on your Claude Code plan.'],
  ['Which systems does it run on?', 'Windows 10 or later today. macOS and Linux builds are not published yet.'],
  ['Do I need Claude Code?', 'Yes. Install Claude Code and log in once by running claude. Agent Office uses your own install and plan.'],
  ['Can an agent hire without asking me?', 'No. Every hire needs your one-shot approval, which expires after 10 minutes and is cleared when Tiro\'s session ends or resets.'],
  ['Why does Windows show a SmartScreen warning?', 'The builds are not code-signed. Choose More info, then Run anyway, and compare the installer\'s SHA-256 with the one on the download page first.'],
  ['Where is my data?', 'On your machine: ~/.claude/agent-office, your vault and Claude Code\'s own ~/.claude/projects. Model calls go to Anthropic through Claude Code, as in the terminal.'],
  ['Does it read my email?', 'No. The scheduler reads a local feed file that you must produce yourself.'],
  ['Can I rename agents and keep their history?', 'Yes. History follows the agent type, not the display name.'],
  ['Is it open source?', 'No. It is proprietary software, all rights reserved. Dependency licenses are listed in the third-party notices that ship with the installer.'],
];

export function homePage() {
  const main = `<main id="main">
<section class="hero">
<div class="wrap hero-grid">
<div>
<p class="eyebrow">Windows app, for Claude Code users</p>
<h1>A pixel office for your own Claude Code agents.</h1>
<p class="lead">Tiro, a little orange cube-crab, is the office manager. Give Tiro a task. It plans the work, asks you before it hires a specialist, files reports and remembers what it learned in plain Markdown notes. The office itself spends no tokens.</p>
<div class="btn-row"><a class="btn big" href="download.html">Download for Windows</a><a class="btn secondary big" href="docs/index.html">Read the docs</a></div>
<ul class="pill-row" aria-label="Facts"><li>No tokens for the office</li><li>8 specialists</li><li>You approve every hire</li><li>Unsigned build</li></ul>
</div>
<div class="hero-shot"><img src="assets/img/hero.png" width="1480" height="920" alt="The Agent Office dashboard: eight specialists at their desks in an isometric office, a hire approval card on the goal board and the status bar on top"></div>
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
<div class="section-head"><h2>Features</h2><p>Everything runs locally on top of the Claude Code you already have.</p></div>
<div class="grid">${features.map(([t, d]) => `<div class="card"><h3>${esc(t)}</h3><p>${esc(d)}</p></div>`).join('')}</div>
<div class="moods"><img src="assets/img/kiro-moods.png" width="1000" height="500" alt="Tiro in eight moods: idle, all goals done, agents working, building, planning, needs your approval, goal done and paused at plan limit" loading="lazy"></div>
</div>
</section>

<section class="block" id="team">
<div class="wrap">
<div class="section-head"><h2>Meet the team</h2><p>Tiro leads a fixed team of eight specialists, at most eight working at once. Tiro runs on Sonnet at medium effort and picks Haiku, Sonnet or Opus for each hire.</p></div>
<div class="grid">${team.map(([n, r, m, t]) => `<div class="card team-card"><h3>${n}</h3><p>${esc(r)}</p><p class="model">${m}</p><p class="tools">${esc(t)}</p></div>`).join('')}</div>
</div>
</section>

<section class="block" id="gallery">
<div class="wrap">
<div class="section-head"><h2>Gallery</h2><p>All screenshots use demo data. Select one to see it in full size.</p></div>
<ul class="gallery">${gallery.map(([f, t, c]) => `<li><figure><a href="assets/img/${f}"><img src="assets/img/${f}" alt="${esc(t + ': ' + c)}" loading="lazy" width="1480" height="920"></a><figcaption><strong>${esc(t)}</strong>${esc(c)}</figcaption></figure></li>`).join('')}</ul>
</div>
</section>

<section class="block" id="security">
<div class="wrap">
<div class="section-head"><h2>Security model</h2><p>Built so that an agent working for you cannot approve its own requests. <a href="docs/security.html">Read the full model</a> or the <a href="docs/permissions.html">permissions page</a>.</p></div>
<div class="grid">${security.map(([t, d]) => `<div class="card"><h3>${esc(t)}</h3><p>${esc(d)}</p></div>`).join('')}</div>
<div class="notice"><p><strong>Unsigned builds.</strong> Windows SmartScreen may ask you to confirm with More info, then Run anyway. Compare the installer's SHA-256 with the one on the <a href="download.html">download page</a>.</p></div>
</div>
</section>

<section class="block" id="faq">
<div class="wrap">
<div class="section-head"><h2>FAQ</h2></div>
<div class="faq">${faq.map(([q, a]) => `<details><summary>${esc(q)}</summary><div><p>${esc(a)}</p></div></details>`).join('')}</div>
<p>More answers are on the <a href="docs/troubleshooting.html">troubleshooting and FAQ page</a>.</p>
<div class="btn-row"><a class="btn big" href="download.html">Download for Windows</a></div>
</div>
</section>
</main>`;
  return layout({ root: '', title: 'Agent Office - a pixel office for your Claude Code agents', desc: 'Tiro, an orange cube-crab office manager, hires specialist Claude Code agents with your approval. The office spends no tokens. Windows installer.', nav: 'home', main });
}
