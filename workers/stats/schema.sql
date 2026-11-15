-- D1 database "sixgree-stats", bound as DB to the sixgree-stats Worker.
-- Daily counts, plus the day's salted visitor hashes (deleted the next day; see
-- index.js). No IP addresses or cookies.
-- Safe to run again at any time: run it BEFORE uploading an index.js that needs
-- a table it adds (a D1 batch is one transaction, so one missing table loses
-- the whole view, not just its visitor count).
CREATE TABLE IF NOT EXISTS events (
  day     TEXT NOT NULL,              -- UTC date, YYYY-MM-DD
  kind    TEXT NOT NULL,              -- 'view' or 'download'
  key     TEXT NOT NULL,              -- page path, or download platform
  ref     TEXT NOT NULL DEFAULT '',   -- referrer host name, '' when none or the site itself
  country TEXT NOT NULL DEFAULT '',   -- Cloudflare's country code
  n       INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (day, kind, key, ref, country)
);
-- Today's unique-visitor hashes, only to tell a new visitor from one already
-- counted. Every hash from before today is deleted by the first view after
-- midnight UTC, or by the Worker's cron at 00:05 UTC.
CREATE TABLE IF NOT EXISTS visitors (
  day TEXT NOT NULL,
  h   TEXT NOT NULL,
  PRIMARY KEY (day, h)
);
-- Each day's unique-visitor count, kept after that day's hashes are deleted.
CREATE TABLE IF NOT EXISTS daily_visitors (
  day TEXT PRIMARY KEY,
  n   INTEGER NOT NULL DEFAULT 0
);
-- A day whose hashes were stored by code that didn't keep the count (an older
-- Worker, still live between running this file and uploading the new one):
-- raise its count to the number of its hashes. Never lowers a count, so it is
-- safe to run at any time ("WHERE true" is SQLite's fix for the parsing
-- ambiguity of INSERT ... SELECT ... ON CONFLICT).
INSERT INTO daily_visitors (day, n) SELECT day, COUNT(*) FROM visitors WHERE true GROUP BY day
  ON CONFLICT (day) DO UPDATE SET n = max(n, excluded.n);
