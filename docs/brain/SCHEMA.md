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

## `linkedin_connections` — the fields that carry meaning

- `degree` — 1 direct, 2 via a bridge, 3 from a company scan.
- `source_connection_id` — which bridge this person was found behind. NULL for 1st-degree.
- `power_score`, `seniority_score`, `company_prestige_score`, `influence_signals` (JSON),
  `tier` — see [`SCORING.md`](SCORING.md).
- `circle_power`, `circle_s_count`, `circle_a_count`, `circle_elite_pct` — how valuable
  the circle *behind* this person is. This is what makes someone a bridge.
- `unlock_status`, `unlocked_from_bridge_id`, `unlocked_from_name` — the "path opened"
  mechanic: a 2nd-degree person becomes reachable when a bridge to them is mapped.
- `profile_image_url` — a **local** `/avatars/*.webp` path after capture, not a CDN URL.
  See TRAPS §3.
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

## Conventions

- **Booleans are `INTEGER`** (`is_catalyst`, `seen`) — SQLite has no boolean type.
- **JSON lives in `TEXT`** (`influence_signals`, `sectors`, `goals`,
  `company_prestige_config`). Parse at the edges; do not assume it is an object.
- **Timestamps are `TEXT`**, `datetime('now')` — UTC, sortable as strings.
- **IDs are `TEXT` UUIDs**, carried over from the Postgres original.
