import { layout, esc, picture, release, readJson, edgeOrigin, dlHref, OS_MAIN, OS_NAME, pageUrl, OG_IMAGE } from './layout.mjs';

export const fmtSize = n => (typeof n === 'number' && n > 0 ? (n / 1048576).toFixed(1) + ' MB' : '-');
const OTHERS = { windows: 'macOS and Linux', macos: 'Windows and Linux', linux: 'Windows and macOS' };

// The OS-aware download button. Baked for Windows; release.js switches href and label to the visitor's OS (no JS: Windows).
export function dlButton({ id = '', cls = 'btn primary' } = {}) {
  const hrefs = Object.entries(OS_MAIN).map(([os, key]) => ` data-href-${os}="${esc(dlHref(key))}"`).join('');
  return `<a ${id ? `id="${id}" ` : ''}class="${cls}" href="${esc(dlHref('windows'))}" data-dl-main${hrefs}><span data-dl-label>Download for Windows</span></a>`;
}
// "macOS and Linux" next to the main button, renamed for the visitor's OS.
const otherPlatforms = root => `<a class="btn quiet" href="${root}download.html#platforms" data-dl-other${Object.entries(OTHERS).map(([os, l]) => ` data-label-${os}="${l}"`).join('')}>${OTHERS.windows}</a>`;
// One button per OS; release.js makes the visitor's the primary one and puts it first.
export const osButtons = () => `<div class="cta-row" data-os-row>${Object.entries(OS_MAIN).map(([os, key]) => `<a class="btn ${os === 'windows' ? 'primary' : 'quiet'}" href="${esc(dlHref(key))}" data-os-btn="${os}">${os === 'windows' ? 'Download for Windows' : OS_NAME[os]}</a>`).join('')}</div>`;

const roster = [['Pixel', 'Frontend, Sonnet'], ['Forge', 'Backend, Sonnet'], ['Warden', 'Security review, Opus'], ['Probe', 'QA and tests, Sonnet'], ['Atlas', 'Deep research, Opus'], ['Cabalan', 'Research, Haiku'], ['Tally', 'Task checks, Haiku'], ['Scribe', 'SOPs and docs, Sonnet']];
const desks = [['Byte', 'IT desk'], ['Ledger', 'Accounting desk'], ['Spark', 'Marketing desk'], ['Vera', 'Audit desk'], ['Memo', 'Notetaker desk'], ['Codex', 'External CLI desk'], ['Gemini CLI', 'External CLI desk'], ['OpenCode', 'External CLI desk']];

const steps = [
  ['planning', 'Give Tiro a task', 'Type it in the dispatch box. It lands on today\'s board as a goal.'],
  ['approval', 'Approve the hire', 'Tiro names the specialist and why. One approval buys one hire.'],
  ['working', 'Watch them work', 'Every prompt Claude Code would show you appears in the office and the notch.'],
  ['done', 'Read the report', 'Findings are filed as reports. Each agent keeps notes for next time.'],
];

const security = [
  ['Local only', 'The server listens on 127.0.0.1 and rejects any other host. The UI key stays in the app.'],
  ['Approvals stay yours', 'Nothing is approved automatically or timed out into an answer.'],
  ['Signed updates', 'The app installs only a release whose manifest carries a valid Ed25519 signature, then checks the installer\'s SHA-256.'],
  ['No CDN, no trackers', 'Scripts, styles and fonts ship inside the app. This site sets no cookies.'],
];

export function homePage() {
  const s = readJson('stats.json'), edge = edgeOrigin();
  const n = v => Number(v || 0).toLocaleString('en-US'), plat = s.byPlatform || {};
  const faq = [
    ['Does the office cost tokens?', 'No. Drawing the office, the notch and the town costs nothing. Only the agents\' own work uses your Claude plan.'],
    ['Do I need Claude Code?', 'Yes. Install it and sign in once. TiroAgents finds it and uses your own plan. The Claude panel shows the steps.'],
    ['Can an agent hire without asking me?', 'No. Every hire needs your approval, and one approval buys exactly one hire.'],
    ['Why does my computer warn me when I install it?', 'The installers aren\'t code-signed yet. Updates are still verified by the signed release manifest. The <a href="download.html#smartscreen">download page</a> has the steps.'],
    ['Where is my data?', 'On your computer, in your user folder and your own Markdown vault.'],
    ['Does this site track me?', edge ? 'No cookies and no trackers. A download is counted by region only; see the <a href="privacy.html">privacy page</a>.' : 'No cookies and no trackers. Download counts come from GitHub.'],
  ];
  const main = `<main id="main">
<section class="hero">
<canvas class="world" id="world" aria-hidden="true" hidden></canvas>
<div class="wrap"><div class="copy">
<h1>Watch your Claude Code agents work.</h1>
<p class="lede">TiroAgents turns your Claude Code into a small pixel office. Tiro, an orange cube-crab, plans each task, asks before it hires a specialist and files what they find. You approve every hire. The office itself spends no tokens.</p>
<div class="cta-row">${dlButton({ id: 'dl-button' })}${otherPlatforms('')}</div>
<p class="meta">Version <span data-fill="version">${esc(release.version)}</span>, free and open source. Needs Claude Code, signed in. <a href="download.html#verify">Check the download</a></p>
</div></div>
</section>

<section class="showcase" aria-label="The office"><div class="wrap"><div class="stage">
<div class="screen">${picture('', 'hero', 'The TiroAgents office: specialists at their desks in an isometric office with a park, and today\'s goals on the left', { priority: true, sizes: '(min-width: 1000px) 960px, 100vw' })}</div>
<div class="notch" aria-hidden="true"><span class="eyes"><i></i><i></i></span><span class="line" id="notch-line">Forge is running npm test</span><span class="count">1 approval</span></div>
</div></div></section>

<section class="facts" aria-label="Facts"><div class="wrap"><ul>
<li><b>0 tokens</b><span>for the office itself</span></li>
<li><b>1 hire</b><span>per approval you give</span></li>
<li><b>127.0.0.1</b><span>the only address it listens on</span></li>
<li><b>3 systems</b><span>Windows, macOS and Linux</span></li>
</ul></div></section>

<section class="block" id="how"><div class="wrap">
<div class="head"><h2>How a task goes</h2><p class="lede">You stay in charge of the steps that cost money or touch your files.</p></div>
<ol class="steps">${steps.map(([mood, t, d]) => `<li><div class="pic">${picture('', 'tiro-' + mood, '', { plain: true })}</div><h3>${esc(t)}</h3><p>${esc(d)}</p></li>`).join('')}</ol>
</div></section>

<section class="block" id="features"><div class="wrap">
<div class="head"><h2>Everything in the office</h2><p class="lede">It runs on the Claude Code you already have. Your settings, permissions, hooks and MCP servers apply unchanged.</p></div>
<div class="bento">
<article class="tile wide"><span class="new">New in 2.1</span><h3>The notch</h3><p>A notch at the top of your screen with approvals, agents, your calendar, timers, notes and plan trackers. Answer a prompt with Y or N without leaving your work. While you game it shows FPS, GPU and CPU load. <a href="docs/island.html">The notch</a></p>
<div class="shot">${picture('', '20-notch-home', 'The open notch on its Home tab: a waiting approval with Allow and Deny, agents, the calendar, a running timer and notes', { sizes: '(min-width: 1000px) 700px, 100vw' })}</div>
<div class="shot slim">${picture('', '21-notch-game', 'The closed notch while gaming: frames per second, GPU load and temperature, and CPU load', { sizes: '360px' })}</div></article>
<article class="tile narrow"><h3>You approve every hire</h3><p>A card shows the goal and the reason. It expires after 10 minutes. <a href="docs/approvals.html">Approvals</a></p><div class="shot">${picture('', '08b-hire-card', 'Tiro asking to hire Warden, the security reviewer, with the goal, the reason and Approve hire and Deny buttons', { sizes: '(min-width: 1000px) 340px, 100vw' })}</div></article>
<article class="tile half"><span class="new">New in 2.1</span><h3>A town with a meeting room</h3><p>Invite up to three friends. Walk between your offices, play in the game hall and talk by voice in the meeting room. Voice goes app to app; the party server only connects you. <a href="docs/party.html">Party and meeting room</a></p>
<div class="shot">${picture('', '22-town-meeting-room', 'The town: the meeting room house by the lawn, the karinderya, the plaza and the river, with Enter the meeting room shown', { sizes: '(min-width: 1000px) 520px, 100vw' })}</div></article>
<article class="tile half"><h3>Reports you can keep</h3><p>Colour-coded reports with PDF and Excel export. Notes, memory and SOPs are plain Markdown in your own vault. <a href="docs/goals-and-reports.html">Reports</a></p><div class="shot">${picture('', '16-reports-panel', 'The Reports bookshelf with a daily summary', { sizes: '(min-width: 1000px) 520px, 100vw' })}</div></article>
<article class="tile narrow"><h3>Build your office</h3><p>Drag furniture, paint zones, save templates.</p><div class="shot">${picture('', '18-build-mode', 'Build mode with the furniture palette', { sizes: '(min-width: 1000px) 340px, 100vw' })}</div></article>
<article class="tile wide"><h3>Security Guard and the breaker box</h3><p>Hard switches for Tiro, hiring and autopilot, and a plan-limit guard that stops before extra-usage credits. The Guard asks before:</p>
<ul class="checks"><li>secrets leave this computer</li><li>a downloaded script runs or installs itself</li><li>an agent opens a credential store</li><li>an agent follows instructions found in web pages or email</li></ul><p><a href="docs/security-guard.html">Security Guard</a> · <a href="docs/breaker-box.html">Breaker box</a></p></article>
</div>
</div></section>

<section class="block" id="team"><div class="wrap team">
<div class="head"><h2>Tiro and the team</h2><p class="lede">Tiro runs on Sonnet and picks Haiku, Sonnet or Opus for each hire. At most eight specialists work at once. Tiro's mood follows the work.</p><div class="moods">${picture('', 'tiro-moods', 'Tiro\'s eight moods: idle, all goals done, agents working, building, planning, needs your approval, goal done and paused at plan limit', { sizes: '(min-width: 1000px) 440px, 100vw' })}</div></div>
<div>
<h3 class="roster-head">The specialists</h3>
<dl class="roster">${roster.map(([a, b]) => `<div><dt>${a}</dt><dd>${esc(b)}</dd></div>`).join('')}</dl>
<h3 class="roster-head">Desks you can add</h3>
<dl class="roster">${desks.map(([a, b]) => `<div><dt>${a}</dt><dd>${esc(b)}</dd></div>`).join('')}</dl>
<p class="extras">Place department desks in Build mode to grow the team, or a desk that hands work to Codex, Gemini CLI or OpenCode after the same hire approval. <a href="docs/team.html">The team</a></p>
</div>
</div></section>

<section class="block" id="security"><div class="wrap sec">
<div class="head"><h2>Built so an agent can't approve its own requests</h2><p class="lede">The full model is in the <a href="docs/security.html">docs</a>, with the <a href="docs/permissions.html">permissions page</a>.</p></div>
<dl>${security.map(([t, d]) => `<div><dt>${esc(t)}</dt><dd>${esc(d)}</dd></div>`).join('')}</dl>
</div></section>

<section class="block" id="faq"><div class="wrap">
<div class="head"><h2>Questions</h2></div>
<div class="faq">${faq.map(([q, a]) => `<details><summary>${esc(q)}</summary><p>${a.includes('<a ') ? a : esc(a)}</p></details>`).join('')}</div>
</div></section>

<section class="block" id="downloads" aria-labelledby="downloads-h"><div class="wrap">
<h2 id="downloads-h" class="visually-hidden">Downloads</h2>
<div class="dl-counts">
<div class="total"><b data-count="total">${n(s.total)}</b><span>downloads</span></div>
<div><b data-count="windows">${n(plat.windows)}</b><span>Windows</span></div>
<div><b data-count="macos">${n(plat.macos)}</b><span>macOS</span></div>
<div><b data-count="linux">${n(plat.linux)}</b><span>Linux</span></div>
</div>
<div class="dl-map" id="dl-map" data-edge="${esc(edge)}" hidden><canvas id="mapc" aria-hidden="true"></canvas></div>
</div></section>
</main>

<section class="closing" id="download" aria-labelledby="closing-h"><div class="wrap">
${picture('', 'tiro-done', '', { plain: true })}
<div>
<h2 id="closing-h">Put Tiro to work</h2>
<p>Free for Windows 10 or later, macOS and Linux. You need Claude Code, signed in.</p>
${osButtons()}
<p class="small">Also: <a href="${esc(dlHref('mac-x64'))}">macOS for Intel</a> · <a href="${esc(dlHref('linux-deb'))}">Linux .deb</a> · <a href="download.html#verify">Check the download</a></p>
</div>
</div></section>`;
  const title = 'TiroAgents: a pixel office desktop app for Claude Code agents';
  const desc = 'Free, open-source app for Windows, macOS and Linux. See your Claude Code agents work in a pixel office, approve every hire and read their reports. No extra tokens.';
  const strip = h => String(h).replace(/<[^>]+>/g, '');
  // Structured data: the app itself (name, platforms, price, version, downloads) and the FAQ shown on the page.
  const jsonLd = { '@context': 'https://schema.org', '@graph': [
    { '@type': 'SoftwareApplication', '@id': pageUrl('index.html') + '#app', name: 'TiroAgents', applicationCategory: 'DeveloperApplication', operatingSystem: 'Windows 10, Windows 11, macOS, Linux',
      description: desc, url: pageUrl('index.html'), image: pageUrl(OG_IMAGE.path), screenshot: pageUrl('assets/img/hero.png'),
      softwareVersion: release.version, datePublished: release.date, license: 'https://www.apache.org/licenses/LICENSE-2.0', isAccessibleForFree: true,
      downloadUrl: pageUrl('download.html'), softwareRequirements: 'Claude Code, signed in',
      offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
      author: { '@type': 'Person', name: 'Ic3krem', url: 'https://github.com/Ic3krem' } },
    { '@type': 'WebSite', '@id': pageUrl('index.html') + '#site', name: 'TiroAgents', url: pageUrl('index.html') },
    { '@type': 'FAQPage', mainEntity: faq.map(([q, a]) => ({ '@type': 'Question', name: q, acceptedAnswer: { '@type': 'Answer', text: strip(a) } })) },
  ] };
  return layout({ root: '', title, desc, nav: 'home', page: 'index.html', jsonLd, main, scripts: ['release.js'], modules: ['home.js'], bodyClass: 'home' });
}
