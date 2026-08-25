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

export const SCHEMA_SQL = `-- 6 Degrees — local SQLite schema.
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
  scanned_company         TEXT,
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
  scanned_at    TEXT
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
