# Schema

SQLite, WAL mode, foreign keys on. Defined in **`db/schema.js`** — a JS module
exporting a string, not a `.sql` file, because `readFileSync(process.cwd() + ...)`
resolves against the *caller's* directory and breaks the moment the package is
installed rather than run from a checkout. TRAPS §4.

## Tables

| Table | Holds |
|---|---|
| `users` | One row per local profile. `sectors`, `goals`, `company_prestige_config` are JSON-in-TEXT. |
| `linkedin_connections` | Everyone in the network, all degrees. The main table. |
| `user_stats` | XP, level, streak, last scrape. |
| `notifications` | In-app notifications. |
| `queue_items` | The outreach queue. |
| `user_profile` | Referenced by `app/api/setup-profile`; absent from the old cloud schema, so created here rather than inherited. |
| `company_scores` | A company score **you** set (Paths → Scores): `name` (canonical, unique), `score` 1–10. Wins over the curated list and the estimate. See [`SCORING.md`](SCORING.md). |
| `app_meta` | Key/value facts about this install. `scoring_version` says which model the stored scores came from; a mismatch rescores everyone once. `settings` is what the user chose on the Settings page, one JSON object (`lib/settings.js`), so it travels with the data. `last_import` is the import this copy last finished (Settings → Your data); an export leaves it out. |

## `linkedin_connections` — the fields that carry meaning

- `degree` — 1 direct, 2 via a bridge, 3 from a company scan.
- `source_connection_id` — which bridge this person was found behind. NULL for 1st-degree.
- `power_score`, `seniority_score` (now the title's points), `company_prestige_score`,
  `tier`, and `score_why`, the working in words: see [`SCORING.md`](SCORING.md). All are
  rewritten by every rescore; never hand-edit them. `influence_signals` (JSON) is legacy
  and no longer written.
- `circle_power`, `circle_s_count`, `circle_a_count`, `circle_elite_pct` — how valuable
  the circle *behind* this person is. This is what makes someone a bridge.
- `unlock_status`, `unlocked_from_bridge_id`, `unlocked_from_name` — **provenance, and it
  is permanent.** Who introduced this person. Set when a path opens, and kept when they
  later become a direct connection, so the route you actually walked never disappears.

**Two fields are easy to conflate and must not be:**

| | means | changes |
|---|---|---|
| `source_connection_id` | whose circle they sit in *right now* | cleared on promotion — a direct connection sits in nobody's circle |
| `unlocked_from_bridge_id` | who **introduced** them | never; survives promotion, re-scrapes, and their own later rise to being a bridge |

`lib/promote.js` is the only thing that should move someone between degrees; it keeps
those two straight and folds away duplicate rows. See TRAPS §19.
- `profile_image_url` — a **local** `/avatars/*.webp` path after capture, not a CDN URL.
  See TRAPS §3. Until the scanner saves the photo it is LinkedIn's own signed link, which
  expires in a few weeks. An export made without photos sets the local paths to NULL, so
  the other computer shows initials rather than a missing file.
- `user_id` — **every view filters by this.** A row written with NULL lands in the
  database and is invisible forever. TRAPS §9.

## The one index that matters

```sql
CREATE UNIQUE INDEX idx_connections_unique_per_user_bridge
  ON linkedin_connections (
    profile_url,
    COALESCE(source_connection_id, ''),
    COALESCE(user_id, '')
  );
```

One row per person, per bridge, per user. The `COALESCE` calls are not decoration: in a
plain `UNIQUE` index NULLs compare as distinct, so every re-scrape of a 1st-degree
person (whose `source_connection_id` is NULL) would insert a duplicate. This mirrors the
rule the original Postgres schema enforced.

## Adding a column

`CREATE TABLE IF NOT EXISTS` never adds a column to a table that already exists, so a
new column on an existing table also goes in `ADDED_COLUMNS` in `lib/db-client.js`,
which runs `ALTER TABLE … ADD COLUMN` once on older databases (first used for `score_why`).
New tables need nothing extra.

## Conventions

- **Booleans are `INTEGER`** (`is_catalyst`, `seen`) — SQLite has no boolean type.
- **JSON lives in `TEXT`** (`influence_signals`, `sectors`, `goals`,
  `company_prestige_config`). Parse at the edges; do not assume it is an object.
- **Timestamps are `TEXT`**, `datetime('now')` — UTC, sortable as strings.
- **IDs are `TEXT` UUIDs**, carried over from the Postgres original.

## The export file (`.sixdegrees`)

Settings → Your data saves the network as one file that is itself a SQLite database:
`VACUUM INTO` of the live one (journal mode DELETE, so no `-wal` travels beside it), plus
two tables of its own (`lib/data-export.js`):

| Table | Holds |
|---|---|
| `sd_export_manifest(key, value)` | `format` (1), `app_version`, `scoring_version`, `exported_at`, `include_photos`, `people`, `photos`, `files`, and `counts`: rows per app table, as JSON. |
| `sd_export_files(path, bytes, sha256)` | `avatars/<name>` (names the `/avatars` route would serve) and the six scanner files in `TRAVELLING_FILES` (`lib/data-folder.js`). Nothing else, ever. |

An import (`lib/data-import.js`) refuses a file that is newer than the running version,
fails `PRAGMA integrity_check`, holds any object an export never has (a view, a trigger, a
virtual table, a generated column, an unknown table or index), or doesn't match its own
manifest and checksums. It then **rebuilds** the network into this version's own schema,
copying rows table by table, so only rows travel, never table definitions. A column or
table the file lacks (it was made before they were added) gets its default or stays
empty; only `users`, `linkedin_connections` and a table's keys and NOT NULL columns
without a default are required. So adding a column or a table never turns away the
exports people already have. Change the layout of the file itself only with a new
`format`, and keep reading format 1.

`import-pending/` is the other half of that contract: `READY` (JSON), `data.sqlite` (the
rebuilt network), `files/` and, once the swap has begun, `APPLYING` (the last step done).
A newer version may finish an import an older one staged, so keep reading this layout too.
