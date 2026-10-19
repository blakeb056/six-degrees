// The database schema, kept as a module rather than a .sql file on disk.
//
// It used to be read with fs from process.cwd() + 'db/schema.sql', which
// works when the app is started from its own directory and fails everywhere
// else — including from an installed package, which is the whole point of
// shipping this. Bundlers follow an import; they do not follow a runtime
// file read.
//
// Every statement is CREATE ... IF NOT EXISTS, so applying it is both
// first-run setup and a no-op on every later boot.

export const SCHEMA_SQL = `-- Sixgree — local SQLite schema.
--
-- Ported from the Postgres schema this project ran on before it went
-- local-first. Type mapping: uuid -> TEXT (generated in JS), jsonb and
-- text[] -> TEXT holding JSON, boolean -> INTEGER 0/1, timestamptz and date
-- -> TEXT holding ISO-8601. lib/db.js encodes and decodes these so route
-- code sees the same shapes it always did.

PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
  id                      TEXT PRIMARY KEY,
  name                    TEXT NOT NULL,
  headline                TEXT,
  role                    TEXT,
  company                 TEXT,
  industry                TEXT,
  sectors                 TEXT,            -- JSON array
  goals                   TEXT,            -- JSON array
  linkedin_url            TEXT,
  company_prestige_config TEXT,            -- JSON object
  created_at              TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS linkedin_connections (
  id                      TEXT PRIMARY KEY,
  degree                  INTEGER NOT NULL DEFAULT 1,
  source_connection_id    TEXT,
  name                    TEXT NOT NULL,
  headline                TEXT,
  company                 TEXT,
  role                    TEXT,
  profile_url             TEXT NOT NULL,
  profile_image_url       TEXT,
  connected_date          TEXT,
  power_score             REAL DEFAULT 0,
  seniority_score         REAL DEFAULT 0,
  company_prestige_score  REAL DEFAULT 0,
  influence_signals       TEXT DEFAULT '{}',   -- JSON
  tier                    TEXT,
  is_catalyst             INTEGER DEFAULT 0,   -- boolean
  catalyst_score          REAL DEFAULT 0,
  circle_power            REAL DEFAULT 0,
  circle_s_count          INTEGER DEFAULT 0,
  circle_a_count          INTEGER DEFAULT 0,
  circle_elite_pct        REAL DEFAULT 0,
  unlock_status           TEXT DEFAULT 'locked',
  unlocked_from_bridge_id TEXT,
  unlocked_from_name      TEXT,
  outreach_status         TEXT,
  mutual_count            INTEGER,            -- LinkedIn's count of mutual connections (2nd degree; 1st from the search of your connections), when a scan read one
  scanned_company         TEXT,
  score_why               TEXT,
  experience              TEXT,               -- JSON: roles read from their profile by Read profiles (lib/experience.js)
  location                TEXT,               -- where they are, as a scan read it off their card or profile ("Seattle, Washington, United States")
  followers               INTEGER,            -- their follower count as a list's card showed it; a profile's top card (experience) wins
  seen_via                TEXT,               -- 'ties': known only from the mutual web (a name and a link), never scanned (lib/ties-store.js)
  class_u                 REAL,               -- class worth as a utility, under the class you picked (lib/class-fit.js); NULL with no class
  class_v                 REAL,               -- class worth on a ratio scale: 1.0 just makes class S
  class_tier              TEXT,               -- the class tier, S to D: a second lens, never the network tier
  class_why               TEXT,               -- the three largest terms of class_u, in words
  user_id                 TEXT,
  image_refreshed_at      TEXT,
  created_at              TEXT DEFAULT (datetime('now')),
  updated_at              TEXT DEFAULT (datetime('now'))
);

-- Mirrors the Postgres uniqueness rule: one row per person, per bridge, per
-- user. COALESCE keeps NULLs from defeating the constraint the way they would
-- in a plain UNIQUE index.
CREATE UNIQUE INDEX IF NOT EXISTS idx_connections_unique_per_user_bridge
  ON linkedin_connections (
    profile_url,
    COALESCE(source_connection_id, ''),
    COALESCE(user_id, '')
  );

CREATE INDEX IF NOT EXISTS idx_connections_degree      ON linkedin_connections(degree);
CREATE INDEX IF NOT EXISTS idx_connections_user        ON linkedin_connections(user_id);
CREATE INDEX IF NOT EXISTS idx_connections_power       ON linkedin_connections(power_score DESC);
CREATE INDEX IF NOT EXISTS idx_connections_source      ON linkedin_connections(source_connection_id);
CREATE INDEX IF NOT EXISTS idx_connections_tier        ON linkedin_connections(tier);

CREATE TABLE IF NOT EXISTS user_stats (
  id             TEXT PRIMARY KEY,
  xp             INTEGER DEFAULT 0,
  level          INTEGER DEFAULT 1,
  streak_weeks   INTEGER DEFAULT 0,
  last_scrape_at TEXT,
  last_active_at TEXT DEFAULT (datetime('now')),
  created_at     TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS notifications (
  id         TEXT PRIMARY KEY,
  user_id    TEXT,
  type       TEXT NOT NULL,
  title      TEXT NOT NULL,
  message    TEXT,
  icon       TEXT,
  seen       INTEGER DEFAULT 0,   -- boolean
  data       TEXT DEFAULT '{}',   -- JSON
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS queue_items (
  id            TEXT PRIMARY KEY,
  connection_id TEXT,
  profile_url   TEXT NOT NULL UNIQUE,
  name          TEXT NOT NULL,
  status        TEXT DEFAULT 'suggested',
  xp_reward     INTEGER DEFAULT 10,
  bridge_name   TEXT,
  created_at    TEXT DEFAULT (datetime('now')),
  sent_at       TEXT,
  accepted_at   TEXT,
  scanned_at    TEXT,
  -- The send log (lib/send-log.js): one row per person asked, the clock every
  -- learned model (acceptance, warmth, best time) will train on.
  user_id         TEXT,
  route           TEXT,      -- how it was sent: 'manual' (a Connect on a page), 'auto', 'panel'
  result          TEXT,      -- 'pending', 'accepted', 'undone'
  snapshot        TEXT,      -- JSON: the person as known when it was sent, and what was shown beside them
  attempts        INTEGER DEFAULT 0,
  attempt_history TEXT,      -- JSON: earlier attempts, newest last
  sender_tz       TEXT,
  recipient_tz    TEXT,
  accepted_day    TEXT,      -- the connection's own date (a day), when it carried one
  warmth          TEXT,      -- the warmth band of an accept (lib/class-presets.js WARMTH_BANDS)
  withdrawn_at    TEXT,
  last_checked_at TEXT
);

-- Company scores you set yourself (lib/scoring.js): they win over the curated
-- list and over the network estimate. One row per canonical company name.
CREATE TABLE IF NOT EXISTS company_scores (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL UNIQUE,
  score       REAL NOT NULL,
  updated_at  TEXT DEFAULT (datetime('now'))
);

-- Small key/value facts about this install, e.g. which scoring model the
-- stored scores were computed with.
-- The mutual web: two people seen together, by profile URL, the smaller
-- first, so a pair is one row whichever page showed it (lib/ties.js). Seen
-- where a page was open anyway, never by going to one for it: a circle scan
-- finding one of your connections in another's list ('circle'), a card's
-- mutual line naming your connections ('card'), a profile's mutual line in
-- the LinkedIn panel ('profile'), or the "N other mutual connections" list
-- read when you ask for it ('mutual-list'). source holds every way it was
-- seen, comma-separated; seeing it again adds one to seen_count and moves
-- last_seen (lib/ties-store.js). A tie means seen together, not close.
CREATE TABLE IF NOT EXISTS connection_ties (
  id         TEXT,                 -- lib/db.js gives every row one
  user_id    TEXT NOT NULL,
  a_url      TEXT NOT NULL,
  b_url      TEXT NOT NULL,
  seen_at    TEXT DEFAULT (datetime('now')),   -- first seen
  source     TEXT DEFAULT 'circle',
  seen_count INTEGER DEFAULT 1,
  last_seen  TEXT,
  PRIMARY KEY (user_id, a_url, b_url)
);

CREATE INDEX IF NOT EXISTS idx_ties_b ON connection_ties(user_id, b_url);

-- The learning log (lib/learning-log.js): one append-only, versioned store of
-- what happened, so every later model has labels from the first day: who was
-- shown where and at what rank, what was opened, sent, accepted or skipped,
-- each scan's yield, each This or That answer, and the account's load. Rows
-- are never changed, only added, and all of them deleted at once from
-- Settings → Your data. A person's facts at the moment ride along as a
-- compact snapshot ('snapshot' rows, kept once per change, referenced by
-- hash). Local only: nothing here is ever sent anywhere.
CREATE TABLE IF NOT EXISTS learning_events (
  seq            INTEGER PRIMARY KEY,
  schema_version INTEGER NOT NULL,
  at             TEXT NOT NULL,       -- when, ISO-8601 UTC
  kind           TEXT NOT NULL,       -- exposure, interaction, outcome, scan, onboarding, load, snapshot
  type           TEXT NOT NULL,       -- what, within the kind ('request-sent', 'accepted', 'duel', ...)
  person         TEXT,                -- whose, by profile key (lib/ties.js urlKey), when it's about one person
  user_id        TEXT,
  lens           TEXT,                -- the class active then, or 'network'
  snap           TEXT,                -- the person's snapshot hash at the moment
  dedupe         TEXT UNIQUE,         -- a repeat of the same event is a no-op
  data           TEXT                 -- JSON: the event's own fields
);

CREATE INDEX IF NOT EXISTS idx_learning_person ON learning_events(person, at);
CREATE INDEX IF NOT EXISTS idx_learning_at     ON learning_events(at);
CREATE INDEX IF NOT EXISTS idx_learning_kind   ON learning_events(kind, type, at);

CREATE TABLE IF NOT EXISTS app_meta (
  key    TEXT PRIMARY KEY,
  value  TEXT
);

-- Referenced by app/api/setup-profile but absent from the old cloud schema,
-- so it is created here rather than inherited.
CREATE TABLE IF NOT EXISTS user_profile (
  id                      TEXT PRIMARY KEY,
  user_id                 TEXT,
  name                    TEXT,
  headline                TEXT,
  role                    TEXT,
  company                 TEXT,
  industry                TEXT,
  sectors                 TEXT,   -- JSON array
  goals                   TEXT,   -- JSON array
  linkedin_url            TEXT,
  company_prestige_config TEXT,   -- JSON object
  created_at              TEXT DEFAULT (datetime('now')),
  updated_at              TEXT DEFAULT (datetime('now'))
);
`;

export default SCHEMA_SQL;
