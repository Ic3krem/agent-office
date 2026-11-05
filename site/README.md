# Agent Office product site

Static site: plain HTML, CSS and JavaScript. No build step to host it, no CDN, no remote fonts, no trackers, no cookies. Fonts are local (`assets/fonts`, OFL texts included). Every page carries a strict Content-Security-Policy meta tag. Intended host: GitHub Pages, once the repository and its release downloads are public (the proprietary licence stays).

Preview over http (the pages `fetch` JSON files, which browsers block on `file://`): `python -m http.server -d site`, then open http://localhost:8000/.

## Pages and files

| Path | What |
|---|---|
| `index.html` | Download-first landing: OS-aware download button, version and short SHA-256, trust strip, tour, team, security, FAQ, licence |
| `download.html` | Download, full SHA-256 and PowerShell check, SmartScreen and Smart App Control notes, install steps, other platforms |
| `quickstart.html`, `stats.html`, `privacy.html`, `changelog.html` | Quickstart, download statistics, privacy, changelog |
| `docs/*.html`, `docs/*.md` | Docs in four groups (Get started, Using the office, Safety, Reference), with sidebar, on-this-page, prev/next and search. A Markdown copy of each page sits next to it |
| `search-index.json`, `llms.txt`, `releases.xml` | Local docs search index, LLM index, Atom feed built from CHANGELOG |
| `release.json`, `stats.json`, `config.json` | Data the pages read: release (source of truth for version, url, sha256, size, date), download statistics, site settings |
| `assets/` | CSS, JS (`common.js`, `release.js`, `search.js`), fonts, favicon, optimised images |
| `tools/` | Generators, not needed to host |
| `site.test.mjs` | Tests |

## Regenerate and test

```
python site/tools/optimise-images.py   # only when screenshots change (needs Pillow with AVIF and WebP)
node site/tools/gen-docs.mjs           # rebuilds every HTML page, the search index, llms.txt, .md copies and releases.xml
node --test site/site.test.mjs
```

Docs are cut from `README.md`, `docs/*.md` and `CHANGELOG.md`; edit those and regenerate. GitHub links in docs render as plain text. "Kiro" in prose becomes "Tiro" (real file names such as `kiro.json` stay in code).

## Release checklist

1. Edit `release.json`: `version`, `asset`, `url` (the public `releases/download/v<version>/...` asset), `sha256` (computed from that exact file), `size`, `date`, `releaseUrl`. Optional: `checksumsUrl`, `previous` (list of `{version, date, url}`). Tests require `url` to be the public GitHub asset for `version`.
2. `node site/tools/gen-docs.mjs` (bakes the values into the pages so they work without JavaScript, and rewrites the docs stamp), then run the tests.

## Analytics (off by default)

`config.json` `analytics.provider` is `none`, `cloudflare` or `goatcounter`. Set the provider and its `token` (Cloudflare Web Analytics) or `code` (GoatCounter site code), then run `node site/tools/gen-docs.mjs`. That one step updates the CSP in every page (`tools/layout.mjs`, function `buildCsp`) and the privacy text. Both are cookieless, so no consent banner is needed. `assets/common.js` skips loading when the browser sends Do Not Track or Global Privacy Control. With provider `none` nothing remote is allowed or loaded.

## Statistics

`stats.json` is currently SAMPLE DATA (`placeholder: true`); the pages say so and the landing page shows no numbers. A scheduled job should write the real snapshot (`asOf`, `total`, `unique`, `countries`, `byContinent`, `byCountry` with only countries of at least 10 downloads, `other`) with `placeholder: false`, then regenerate. The counter that would produce it is not built into this site.

## Hosting on GitHub Pages

Publish `site/` (a Pages workflow that uploads the folder, or copy it to a `gh-pages` branch or `/docs`). Pages cannot set HTTP headers, so the CSP is a meta tag; `frame-ancestors` cannot be set that way. `config.json` `baseUrl` (used by `llms.txt` and the Atom feed) assumes `https://ic3krem.github.io/agent-office/`; change it if the Pages address differs and regenerate. Nothing has been published. Before going public: decide who the named data controller and contact are (`config.json` `privacy`), check the proprietary licence allows public screenshots and text, and keep the unsigned-build notes until the installer is signed.
