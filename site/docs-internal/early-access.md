# Early access: download counting by region, cap of 500

Internal design note. Not part of the published site: do not copy `docs-internal/` into the public site repo.
Status: built and tested locally, nothing deployed. Steps to deploy are in `deploy-runbook.md`.

## Decision and constraints

- The site is hosted on GitHub Pages. Pages is static: it cannot count, see a country or refuse a request.
- Goal: record who downloads Agent Office, especially by region; first 500 unique downloaders get early access; after that (or on demand) the site is locked down again.
- The product repo stays private and proprietary. Pages from a private repo needs a paid plan and would not be public, so the site is published from a separate small public repo (suggested `Ic3krem/agent-office-site`) holding only the contents of `site/` (minus `docs-internal/`).

## Architecture

```
browser --GET download.html--> GitHub Pages (static, strict CSP)
        --fetch /status------> Worker  --> D1   (public: numbers only)
        --click Download: GET /dl--> Worker --> D1 (count, country) --302--> installer URL
admin   --Bearer token /admin/stats, /admin/lock--> Worker --> D1
```

Choice: Cloudflare Worker + D1 (free tier is far above 500 downloaders). The Worker sees the visitor country in `request.cf.country` (and continent), so no geo-IP database or IP storage is needed. Why D1 and not KV: KV has no atomic increment and is eventually consistent, so a burst of requests could overshoot the cap. D1 is SQLite: the cap check and the insert are one SQL statement, and a test fires 20 concurrent requests at a cap of 5 and gets exactly 5.
Alternative: Deno Deploy with Deno KV (atomic operations exist there). Same design, rewrite the 60-line store; no other change. Not built.

Code: `site/edge/worker.js` (plain JS, no dependencies), `schema.sql`, `wrangler.toml` (placeholders only), tests in `edge.test.mjs`.

## Routes

| Route | Who | What |
|---|---|---|
| `GET /dl` | everyone | Refuses bots and non-GET (HEAD and link previews are never counted). If locked: closed page. Else registers the client: existing downloader, hit count +1, redirect; new downloader and under cap, insert, redirect; at cap: "Early access is full" page (HTTP 403). Redirect is `302` to `DL_TARGET`, `no-store`. Fails closed (503, nothing counted) if `DL_TARGET`/`HASH_SALT` are missing or `DL_TARGET` is not https. |
| `GET /status` | everyone | `{"claimed":N,"cap":500,"open":true}`. Numbers and an open flag only. Cached 30 s. CORS restricted to `SITE_ORIGIN`. |
| `GET /admin/stats` | bearer `ADMIN_TOKEN` | Totals (unique, total downloads), per country, continent, optional region, version, browser, new downloaders per UTC day, lock state. |
| `POST /admin/lock` | bearer `ADMIN_TOKEN` | Body `{"locked":true}` or `{"locked":false}`. Stored in D1. |

Lock model: closed if the `LOCKED` variable is `"true"` OR the D1 switch is on. The admin unlock only clears the D1 switch, so the `LOCKED` variable is the hard override (it needs a redeploy to change). Admin stays disabled if `ADMIN_TOKEN` is unset or shorter than 24 characters; comparison is constant time.

Policy choices to confirm with the user: a person already counted can re-download after the cap is reached (the cap is on unique downloaders, not downloads); a locked state blocks everyone, including existing downloaders.

## What is stored

One row per unique downloader in `downloaders`:

| Column | Value |
|---|---|
| `hash` | first 128 bits of HMAC-SHA-256(`HASH_SALT`, client IP). Secret-keyed, one-way, used only for de-dup |
| `country`, `continent` | ISO 3166-1 alpha-2 and continent code from the edge (`XX` if unknown) |
| `region` | empty by default. State/province code only if `RECORD_SUBDIVISION="true"` (off, more personal) |
| `day` | UTC date of the first download |
| `version` | `DL_VERSION` set by the operator, not taken from the client |
| `ua` | browser family bucket (chrome, edge, firefox, safari, opera, other, unknown) |
| `hits` | number of downloads by this client |

Not stored or logged: the IP address, the full user-agent string, referrer, any header, cookies (none are set). Worker observability is switched off in `wrangler.toml`, errors return a bare "Service error." with no detail, and the code has no `console` calls. Tests assert the database contains no IP/UA text and that the source reads the IP in exactly one place.

## GDPR and consent: flag

- Country-level data alone is generally not personal data. But the keyed hash is derived from the IP address, and a pseudonymous identifier derived from an IP is still personal data under GDPR (recital 26: pseudonymised data stays in scope while the key exists). Treat the table as personal data for EU/UK visitors.
- Minimisation already applied: no raw IP, no full UA, no cookies, no region below country by default, no email. Purpose is limited to counting early-access downloads and enforcing the cap.
- Lawful basis: legitimate interests (counting and enforcing a limit) is the likely basis, and no consent banner is needed because nothing is stored on the device (no cookies or local storage; ePrivacy is not triggered). This is the builder's reading, not legal advice: have someone qualified confirm before launch, especially since the operator is a company and not an individual.
- Needed before launch: the privacy notice on `download.html` (built) should be accompanied by a named controller and contact address; there is none on the site now. A retention rule: delete the hash column (or the whole table) when early access ends, keeping only aggregates. The runbook includes the SQL.
- Cloudflare itself processes the request (it sees the IP as the network provider). Mention it in the notice if counsel wants it.
- A "waitlist" that collects emails was deliberately not built: it would add clearly personal data and a mailing-list obligation. The locked state just says to check again later.

## Limits and risks (be honest about them)

1. The cap is only as strong as the installer URL is secret. If the installer sits in a normal public release, anyone who knows or guesses that URL skips `/dl`. Phase 1 accepts this (do not publish the asset URL anywhere, keep `release.json` pointing at the page, not the file). Real enforcement: put the installer in a private R2 bucket bound to the Worker and stream it from `/dl` (free 10 GB, the 111 MB installer fits). Not built; a small change in `/dl`.
2. One person with many IPs can burn spots. Add a Cloudflare rate-limit rule on `/dl` (dashboard, free) and, if abused, Turnstile. Users behind one shared IP (a household, an office) count as one.
3. `request.cf.country` reflects where the IP geolocates; VPN users appear in the VPN country.
4. Front-end counter is cosmetic. Enforcement happens only in the Worker.
5. Whether the installer can be public at all is a licensing decision for the user (code is proprietary; the installer is distributed under the licence it shows).
6. Unverified: how the in-app updater and install scripts obtain releases (they were written for the private repo). Not checked here; a public release channel may need updater changes.

## Front end (site/)

- `config.json` is the one place for the Worker origin (`edgeOrigin`), the `closed` switch and the displayed `cap`. `node site/tools/gen-docs.mjs` writes that origin into the download page's CSP `connect-src` (and nowhere else). Empty `edgeOrigin` = not configured: the page behaves as before using `release.json` and no remote host is allowed.
- `download.js`: with an edge configured, the button points to `<edge>/dl`, `<edge>/status` fills "N of 500 early-access spots taken", and when `open` is false the button is disabled and the "Early access is full" notice shows. If `/status` is unreachable the page says so and the button still works (the Worker enforces). `closed: true` in `config.json` shows the closed state without contacting the Worker at all.
- `download.html` carries the privacy notice (`#privacy`): country, continent, date, app version, browser family; no IP, no cookies.
- Tests (`site.test.mjs`): CSP of every page equals what `config.json` implies, no other remote origin anywhere, privacy and closed elements present, no cookies or storage in JS, direct installer URL not in `release.json` once an edge is set.
