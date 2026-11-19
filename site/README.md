# TiroAgents product site

Static site: plain HTML, CSS and JavaScript. No build step to host it, no CDN, no remote fonts, no trackers, no cookies. Fonts are local (`assets/fonts`, OFL texts included). three.js 0.185.0 is vendored unmodified in `assets/vendor/three` (MIT, `LICENSE.txt` beside it) and loaded only by the home page, as an ES module through `assets/home.js`. Every page carries a strict Content-Security-Policy meta tag. Intended host: GitHub Pages, deployed by .github/workflows/pages.yml, which also refreshes the download counts every six hours.

Preview over http (the pages `fetch` JSON files and load a module, which browsers block on `file://`): `python -m http.server -d site`, then open http://localhost:8000/.

## Pages and files

| Path | What |
|---|---|
| `index.html` | Home: the 3D office island behind the headline, OS-aware download button, the product shot with a demo notch, facts, how a task goes, the feature bento, team, security, FAQ, the download counts on a voxel world map, closing band |
| `download.html` | Every file for Windows, macOS and Linux, SHA-256 and PowerShell check, install warnings (SmartScreen, Smart App Control, Gatekeeper), install steps |
| `quickstart.html`, `stats.html`, `privacy.html`, `changelog.html` | Quickstart, download statistics, privacy, changelog |
| `docs/*.html`, `docs/*.md` | Docs in four groups (Get started, Using the office, Safety, Reference), with sidebar, on-this-page, prev/next and search. A Markdown copy of each page sits next to it |
| `search-index.json`, `llms.txt`, `releases.xml` | Local docs search index, LLM index, Atom feed built from CHANGELOG |
| `release.json`, `stats.json`, `config.json` | Data the pages read: release (source of truth for version, files, sha256, size, date), download statistics, site settings |
| `assets/` | CSS, JS (`common.js`, `release.js`, `search.js`, `home.js`), fonts, vendored three.js, favicon, optimised images |
| `tools/` | Generators, not needed to host |
| `edge/` | The download counter (a Cloudflare Worker), maintained and tested on its own |
| `site.test.mjs` | Tests |

## Regenerate and test

```
python site/tools/optimise-images.py   # only when screenshots change (needs Pillow with AVIF and WebP); also cuts Tiro's mood sprites
node site/tools/gen-docs.mjs           # rebuilds every HTML page, the search index, llms.txt, .md copies and releases.xml
node --test site/site.test.mjs
```

Docs are cut from `README.md`, `docs/*.md` and `CHANGELOG.md`; edit those and regenerate. GitHub links in docs render as plain text. "Kiro" in prose becomes "Tiro", and "Agent Office" in prose becomes "TiroAgents" (code spans, "Agent Office 1.x" and the changelog keep the old name).

Screenshots come from `docs/images/*.png`. The notch and town shots (20 to 22) were captured from the real app on a temp profile (port 4790, `AGENT_OFFICE_NO_GLOBALS`, muted), the way `perf/notch-check.cjs` and `perf/meet-check.cjs` drive it.

## Release checklist

1. Edit `release.json`: `version`, `asset`, `url` (the public `releases/download/v<version>/...` Windows asset), `assets` (the file name for each counter key: `windows`, `mac-arm64`, `mac-x64`, `linux-appimage`, `linux-deb`; they sit next to `url`), `sha256` (computed from the Windows file), `size`, `date`, `releaseUrl`. Optional: `checksumsUrl`, `previous` (list of `{version, date, url}`). Tests require `url` to be the public GitHub asset for `version`.
2. `node site/tools/gen-docs.mjs` (bakes the values into the pages so they work without JavaScript, and rewrites the docs stamp), then run the tests.

## Download counter (`edge.origin`)

`config.json` `edge.origin` is the worker's origin (`https://...`, no path). Empty: every download button links straight to the GitHub file, the home map shows land only, and the counts come from `stats.json`. Set: the buttons use `<origin>/dl/<asset>`, the home page reads `<origin>/stats` for the counts and an orange tower per region (falling back to `stats.json` for the counts), `connect-src` gains exactly that origin, and the privacy page describes the counter. Run `node site/tools/gen-docs.mjs` after changing it.

## Analytics (off by default)

`config.json` `analytics.provider` is `none`, `cloudflare` or `goatcounter`. Set the provider and its `token` (Cloudflare Web Analytics) or `code` (GoatCounter site code), then run `node site/tools/gen-docs.mjs`. That one step updates the CSP in every page (`tools/layout.mjs`, function `buildCsp`) and the privacy text. Both are cookieless, so no consent banner is needed. `assets/common.js` skips loading when the browser sends Do Not Track or Global Privacy Control. With provider `none` nothing remote is allowed or loaded.

## Statistics

`tools/fetch-stats.mjs` writes `stats.json` from GitHub's own per-asset download counts (installers only) plus `LEGACY`, the frozen counts from the earlier repository (Windows 14, macOS 18, Linux 10), so every total includes them. The scheduled Pages job runs it.

## Hosting on GitHub Pages

Publish `site/` (a Pages workflow that uploads the folder, or copy it to a `gh-pages` branch or `/docs`). Pages cannot set HTTP headers, so the CSP is a meta tag; `frame-ancestors` cannot be set that way. `config.json` `baseUrl` (used by `llms.txt` and the Atom feed) assumes `https://ic3krem.github.io/agent-office/`; change it if the Pages address differs and regenerate. Before going public: decide who the named data controller and contact are (`config.json` `privacy`), and keep the unsigned-build notes until the installers are signed.
