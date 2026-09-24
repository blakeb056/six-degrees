import { getDb, nowIso } from './db-client.js';

// Replacements for the stored procedures the hosted database used to provide.
// Scoring lives in lib/scoring.js; this file only reads rows and writes the
// results back. (scripts/*.sql are the retired hosted-era model.)

import { scoreNetwork, explainScore, SCORING_VERSION } from './scoring.js';
import { industryOf } from './companies.js';

export function companyOverrides(db = getDb()) {
  return new Map(db.prepare('SELECT name, score FROM company_scores').all().map((r) => [r.name, r.score]));
}

/**
 * Rescore everyone. The score depends on the whole network (how many of your
 * people work at a company, how strong a bridge's circle is), so after any
 * ingest or company-score change every row is recomputed — ~0.1s for 4,000.
 */
export function rescoreAll() {
  const db = getDb();
  const rows = db.prepare('SELECT id, degree, headline, role, company, scanned_company, profile_url, source_connection_id FROM linkedin_connections').all();
  const { scores } = scoreNetwork(rows, { overrides: companyOverrides(db), industryOf: (c, h) => industryOf(c, h).key });
  const update = db.prepare(`UPDATE linkedin_connections SET seniority_score = ?, company_prestige_score = ?, power_score = ?, tier = ?,
    score_why = ?, circle_power = ?, circle_s_count = ?, circle_a_count = ?, circle_elite_pct = ?, is_catalyst = ?, catalyst_score = ?, updated_at = ?
    WHERE id = ?`);
  const now = nowIso();
  db.exec('BEGIN');
  try {
    for (const r of rows) {
      const s = scores.get(r.id);
      const c = s.circle;
      update.run(s.title.points, s.companyScore, s.power, s.tier, explainScore(s, s.boost),
        c ? Math.round(c.circlePower * 100) / 100 : 0, c?.sCount || 0, c?.aCount || 0, c ? Math.round(c.elitePct * 100) / 100 : 0,
        c?.isCatalyst ? 1 : 0, c?.isCatalyst ? c.sCount + c.aCount : 0, now, r.id);
    }
    db.prepare('INSERT INTO app_meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run('scoring_version', String(SCORING_VERSION));
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
  return { scored: rows.length };
}

/** Rescore once if the stored scores came from an older scoring model. */
export function rescoreIfStale() {
  const db = getDb();
  const v = db.prepare("SELECT value FROM app_meta WHERE key = 'scoring_version'").get()?.value;
  return v === String(SCORING_VERSION) ? { scored: 0 } : rescoreAll();
}

function incrementXp({ amount = 0 } = {}) {
  const db = getDb();
  const stats = db.prepare('SELECT id, xp FROM user_stats LIMIT 1').get();
  if (!stats) {
    const id = crypto.randomUUID();
    db.prepare('INSERT INTO user_stats (id, xp) VALUES (?, ?)').run(id, amount);
    return { xp: amount };
  }
  const xp = (stats.xp || 0) + amount;
  db.prepare('UPDATE user_stats SET xp = ?, last_active_at = ? WHERE id = ?').run(xp, nowIso(), stats.id);
  return { xp };
}

export async function runRpc(name, args = {}) {
  try {
    // The name is the hosted-era one; it now rescores everyone (see rescoreAll).
    if (name === 'score_new_connections' || name === 'rescore_all') return { data: rescoreAll(), error: null };
    if (name === 'rescore_if_stale') return { data: rescoreIfStale(), error: null };
    if (name === 'increment_xp') return { data: incrementXp(args), error: null };
    if (name === 'exec_sql') {
      // Intentionally unsupported. The hosted build exposed arbitrary DDL over
      // an unauthenticated HTTP route; there is no local equivalent worth having.
      return { data: null, error: { message: 'exec_sql is not supported in the local build' } };
    }
    return { data: null, error: { message: `Unknown function: ${name}` } };
  } catch (err) {
    return { data: null, error: { message: err.message } };
  }
}
