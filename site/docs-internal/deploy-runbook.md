# Deploy runbook: public site + early-access counter

Internal. Do these in order. Nothing here has been run. Items marked (user) need your accounts. Replace OWNER with the GitHub account (Ic3krem) and REPO with the site repo name (agent-office-site).

## 0. Before you start

- Decide the licence question: the installer will be downloadable by the public (see "Limits" in `early-access.md`).
- Have a controller name and contact address ready for the privacy notice (not yet on the site).
- Tools: Node 22+, `git`, `gh` (logged in), a free Cloudflare account.
- Run the tests from the product worktree: `node --test site/site.test.mjs site/edge/edge.test.mjs` (all pass at handoff).

## 1. Cloudflare: D1 and Worker (user)

```
cd <worktree>\site\edge
npx wrangler login
npx wrangler d1 create agent-office-dl
```
Copy the printed `database_id` into `wrangler.toml` (`database_id`). Then:
```
npx wrangler d1 execute agent-office-dl --remote --file=schema.sql
```
Generate two random secrets and store them in your password manager (never in git):
```
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"   # run twice
npx wrangler secret put ADMIN_TOKEN     # paste the first value
npx wrangler secret put HASH_SALT       # paste the second value. Do not change it later: changing it resets de-dup
```
Edit the `[vars]` in `wrangler.toml` (placeholders start with `REPLACE_WITH_`): `SITE_ORIGIN=https://OWNER.github.io`, `SITE_URL=https://OWNER.github.io/REPO`, `DL_VERSION=1.2.8`; leave `DL_TARGET` until step 3. Do not commit the edited file with real ids if you would rather keep them out of the public repo (ids are not secrets, but `edge/` is not needed in the public site repo at all).
```
npx wrangler deploy
```
Note the URL it prints, for example `https://agent-office-dl.<subdomain>.workers.dev`. Optional: add a rate-limiting rule for path `/dl` in the Cloudflare dashboard (Security, WAF, Rate limiting rules).

## 2. Public site repo (user)

```
gh repo create OWNER/REPO --public --description "Agent Office website"
```
Build the publishable folder: copy `site\` to a new empty folder, then delete `docs-internal\`, `edge\`, `tools\`, `site.test.mjs` from the copy (they are not needed to host; `README.md` may stay). Before copying, set the origin in `site\config.json`:
```
"edgeOrigin": "https://agent-office-dl.<subdomain>.workers.dev"
```
and run `node site\tools\gen-docs.mjs` (writes it into the download page CSP), then `node --test site\site.test.mjs`. In `release.json` set `url` to `download.html` (the page, never the installer file) and keep `sha256` and `size` equal to the real file.
```
cd <publish-folder>
git init -b main
git add . && git commit -m "Site"
git remote add origin https://github.com/OWNER/REPO.git
git push -u origin main
```
Enable Pages: repo Settings, Pages, Source "Deploy from a branch", branch `main`, folder `/ (root)`. Or `gh api -X POST repos/OWNER/REPO/pages -f "source[branch]=main" -f "source[path]=/"`. The site appears at `https://OWNER.github.io/REPO/`.

## 3. Installer and DL_TARGET (user)

Upload the installer to a release of the public repo (it must be the exact file whose SHA-256 is in `release.json`):
```
gh release create v1.2.8 .\Agent-Office-Setup-1.2.8.exe --repo OWNER/REPO --title "Agent Office 1.2.8" --notes "Windows installer, not code-signed."
```
Put the asset URL in `wrangler.toml` as `DL_TARGET` (`https://github.com/OWNER/REPO/releases/download/v1.2.8/Agent-Office-Setup-1.2.8.exe`) and redeploy:
```
cd <worktree>\site\edge ; npx wrangler deploy
```
Do not link that URL anywhere. (For real enforcement use a private R2 bucket instead; see "Limits".) On every new version: new release asset, new `DL_TARGET` and `DL_VERSION`, redeploy, update `release.json`.

## 4. Verify

```
curl https://<worker>/status                       # {"claimed":0,"cap":500,"open":true}
curl -H "Authorization: Bearer <ADMIN_TOKEN>" https://<worker>/admin/stats
curl -i https://<worker>/admin/stats               # 401
```
Open the Pages download page in a browser: counter "0 of 500 early-access spots taken", button enabled, privacy notice shown. Click Download once (this uses one spot), confirm the installer starts, then `/admin/stats` shows 1 downloader and your country. Clear the test data before launch:
```
npx wrangler d1 execute agent-office-dl --remote --command "DELETE FROM downloaders"
```
Check the browser console shows no CSP violation.

## 5. Reading the numbers

`curl -H "Authorization: Bearer <ADMIN_TOKEN>" https://<worker>/admin/stats` gives totals plus `by_country`, `by_continent`, `by_version`, `by_browser`, `by_day`. Never paste the token into the site, a repo or a chat.

## 6. Lock-down (after 500, or any time)

At 500 unique downloaders the Worker locks itself: `/dl` returns the "Early access is full" page and the site button disables. To close earlier or reopen:
```
curl -X POST -H "Authorization: Bearer <ADMIN_TOKEN>" -H "Content-Type: application/json" -d "{\"locked\":true}"  https://<worker>/admin/lock
curl -X POST -H "Authorization: Bearer <ADMIN_TOKEN>" -H "Content-Type: application/json" -d "{\"locked\":false}" https://<worker>/admin/lock
```
Hard lock that the admin switch cannot undo: set `LOCKED = "true"` in `wrangler.toml` and `npx wrangler deploy`.

Fully close the download (belt and braces), in order:
1. Lock as above.
2. Site-level closed page: set `"closed": true` in the published `config.json`, commit and push (the page then shows "Early access is full" and never contacts the Worker).
3. Remove the installer: delete the release asset (`gh release delete v1.2.8 --repo OWNER/REPO --yes`, add `--cleanup-tag` if wanted). Anyone who had the URL stops getting the file.
4. To take the whole site down: repo Settings, Pages, Unpublish site (or make the repo private; Pages then stops on a free plan).

## 7. After early access (privacy housekeeping)

Keep aggregates, drop the pseudonymous hashes:
```
npx wrangler d1 execute agent-office-dl --remote --command "SELECT country, continent, version, ua, day, SUM(hits) AS hits, COUNT(*) AS downloaders FROM downloaders GROUP BY country, continent, version, ua, day"
```
Save that output, then delete the rows (`DELETE FROM downloaders`) or the database once nobody needs the cap check. Decide this retention rule before launch and state it in the privacy notice.

## Rollback

Worker misbehaving: `LOCKED = "true"` and redeploy. Bad site push: `git revert` and push. The Worker holds no secrets other than `ADMIN_TOKEN` and `HASH_SALT`; rotate the token with `wrangler secret put ADMIN_TOKEN`.
