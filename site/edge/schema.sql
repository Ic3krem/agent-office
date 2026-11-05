-- D1 schema. Apply once: npx wrangler d1 execute agent-office-dl --remote --file=schema.sql
-- Same statements as SCHEMA in worker.js (a test keeps them identical).
CREATE TABLE IF NOT EXISTS downloaders (
  hash TEXT PRIMARY KEY,
  country TEXT NOT NULL,
  region TEXT NOT NULL DEFAULT '',
  continent TEXT NOT NULL,
  day TEXT NOT NULL,
  version TEXT NOT NULL,
  ua TEXT NOT NULL,
  hits INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
