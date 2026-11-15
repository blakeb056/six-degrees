-- D1 database "sixgree-stats", bound as DB to the sixgree-stats Worker.
-- Counts only: no IP addresses, cookies or fingerprints (see index.js).
CREATE TABLE IF NOT EXISTS events (
  day     TEXT NOT NULL,              -- UTC date, YYYY-MM-DD
  kind    TEXT NOT NULL,              -- 'view' or 'download'
  key     TEXT NOT NULL,              -- page path, or download platform
  ref     TEXT NOT NULL DEFAULT '',   -- referrer host name, '' when none or the site itself
  country TEXT NOT NULL DEFAULT '',   -- Cloudflare's country code
  n       INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (day, kind, key, ref, country)
);
-- Daily unique visitors: a hash that changes every day; rows past 35 days are deleted.
CREATE TABLE IF NOT EXISTS visitors (
  day TEXT NOT NULL,
  h   TEXT NOT NULL,
  PRIMARY KEY (day, h)
);
