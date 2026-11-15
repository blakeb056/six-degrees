-- D1 database "sixgree-stats", bound as DB to the sixgree-stats Worker.
-- Counts only: no IP addresses, cookies or fingerprints (see index.js).
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
-- Today's (and yesterday's) unique-visitor hashes, only to tell a new visitor
-- from one already counted. Deleted when the day ends (the Worker's cron).
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
-- A day that has hashes but no count yet (a table added after the day began).
INSERT OR IGNORE INTO daily_visitors (day, n) SELECT day, COUNT(*) FROM visitors GROUP BY day;
