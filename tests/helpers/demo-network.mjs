// The synthetic sample network (public/demo-data.json, every person invented)
// as database rows, for tests that need a whole network. Never real data.

import { readFileSync } from 'node:fs';

const DEMO = JSON.parse(readFileSync(new URL('../../public/demo-data.json', import.meta.url), 'utf8'));
const COLS = ['id', 'degree', 'source_connection_id', 'name', 'headline', 'company', 'role', 'location', 'profile_url', 'connected_date', 'tier', 'power_score'];

/** The sample's rows: its 1st and 2nd degree, as the database holds them. */
export function demoRows() {
  return [...DEMO.degree1, ...DEMO.degree2].map((r) => Object.fromEntries(COLS.map((c) => [c, r[c] ?? null])));
}

/** Put the sample network in a test database, for profile `user`. */
export function seedDemo(db, { user = 'me', extra = [] } = {}) {
  for (const t of ['linkedin_connections', 'users', 'user_profile', 'queue_items', 'learning_events', 'app_meta', 'company_scores']) db.exec(`DELETE FROM ${t}`);
  db.prepare('INSERT INTO users (id, name) VALUES (?, ?)').run(user, 'You');
  const ins = db.prepare(`INSERT INTO linkedin_connections (${COLS.join(', ')}, user_id) VALUES (${COLS.map(() => '?').join(', ')}, ?)`);
  for (const r of [...demoRows(), ...extra]) ins.run(...COLS.map((c) => r[c] ?? null), user);
}
