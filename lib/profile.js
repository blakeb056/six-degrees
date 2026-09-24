import { getDb, newId, decodeRow } from './db-client.js';

// Which profile is "you" on this machine.
//
// This is a one-person app with one database file. It used to ask for a name on
// any browser it had not seen before, and every answer that did not exactly
// match an existing name made a new, empty profile. The next browser then found
// several profiles, could not tell which was real, and asked again — while the
// whole network sat under the first one. The scraper hit the same ambiguity and
// refused to run, with a reason nobody saw.
//
// So the answer is decided here, once, from the data: the profile that owns the
// most connections, the oldest on a tie. Empty duplicates can never win against
// a real network. On a machine with no profile at all, one is made, because a
// first run should open on a welcome screen, not a form.

export const DEFAULT_NAME = 'You';

/** Every profile, busiest first, with its connection count attached. */
export function listProfiles() {
  const rows = getDb().prepare(`
    SELECT u.*,
           (SELECT COUNT(*) FROM linkedin_connections c WHERE c.user_id = u.id) AS connections
    FROM users u
    ORDER BY connections DESC, u.created_at ASC, u.rowid ASC
  `).all();
  return rows.map((r) => decodeRow('users', r));
}

/**
 * A profile's network by degree: the people you know (first), the people found
 * through them (second), and people found by scanning a company (third). Kept
 * apart because one total reads as "connections" and is not.
 */
export function networkCounts(userId) {
  const rows = getDb().prepare(
    'SELECT degree, COUNT(*) AS n FROM linkedin_connections WHERE user_id = ? GROUP BY degree',
  ).all(userId);
  const by = Object.fromEntries(rows.map((r) => [r.degree, r.n]));
  return { first: by[1] || 0, second: by[2] || 0, third: by[3] || 0 };
}

/**
 * The profile this machine uses. Creates one when there is none, unless
 * `create` is false, in which case it returns null.
 */
export function resolveProfile({ create = true } = {}) {
  const [top] = listProfiles();
  if (top) return top;
  if (!create) return null;

  const id = newId();
  getDb().prepare('INSERT INTO users (id, name) VALUES (?, ?)').run(id, DEFAULT_NAME);
  return { ...decodeRow('users', getDb().prepare('SELECT * FROM users WHERE id = ?').get(id)), connections: 0 };
}
