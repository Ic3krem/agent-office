# TiroAgents download counter

Cloudflare Worker + D1. `GET /dl/<asset>` counts a download and redirects to the GitHub release file;
`GET /stats` returns public totals (platform and continent only). See the header of `worker.js` for privacy details.

## Deploy

Run from this folder:

1. `npx wrangler login`
2. `npx wrangler d1 create tiroagents-dl`, then paste the printed `database_id` into `wrangler.toml`.
3. `npx wrangler d1 execute tiroagents-dl --remote --file=schema.sql`
4. `npx wrangler secret put HASH_SALT` (a long random string, at least 16 characters; keep it private).
5. `npx wrangler deploy`
6. Set `edge.origin` in `site/config.json` to the printed `https://tiroagents-dl.<account>.workers.dev` URL.

## Each release

Bump `DL_VERSION` in `wrangler.toml` to the new version and run `npx wrangler deploy`.

## Per-country view (owner only)

Not served over HTTP. Query D1 directly:
`npx wrangler d1 execute tiroagents-dl --remote --command "SELECT country, COUNT(*) AS n FROM downloads GROUP BY country ORDER BY n DESC"`

## Tests

`node --test site/edge/edge.test.mjs` (from the repo root; no network, D1 faked with node:sqlite).
