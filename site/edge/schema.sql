-- D1 schema. Apply once: npx wrangler d1 execute tiroagents-dl --remote --file=schema.sql
-- Same statements as SCHEMA in worker.js (a test keeps them identical).
CREATE TABLE IF NOT EXISTS downloads (
  hash TEXT NOT NULL,
  asset TEXT NOT NULL,
  day TEXT NOT NULL,
  country TEXT NOT NULL,
  continent TEXT NOT NULL,
  hits INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY (hash, asset, day)
);
