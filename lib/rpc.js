import { getDb, nowIso } from './db-client.js';

// Replacements for the stored procedures the hosted database used to provide.
// Scoring lives in lib/scoring.js; this file only reads rows and writes the
// results back. (scripts/*.sql are the retired hosted-era model.)

import { scoreNetwork, explainScore, SCORING_VERSION } from './scoring.js';
import { industryKeyOf } from './companies.js';
import { readSettings } from './settings.js';
import { SECTOR_FOCUS_SETTING, focusFingerprint } from './sector-focus.js';

export function companyOverrides(db = getDb()) {
  return new Map(db.prepare('SELECT name, score FROM company_scores').all().map((r) => [r.name, r.score]));
}

/** The sector focus saved in Settings (lib/sector-focus.js), or none. */
export function sectorFocusOf(db = getDb()) {
  return readSettings(db, { sectorFocus: SECTOR_FOCUS_SETTING }).sectorFocus;
}

/**
 * What rescoring reads: every row, as scoring needs it. `withPeople` adds each
 * row's name and stored tier, for saying who a change would move.
 */
export function scoringRows(db = getDb(), { withPeople = false } = {}) {
  return db.prepare(`SELECT id, degree, headline, role, company, scanned_company, profile_url, source_connection_id${withPeople ? ', name, tier' : ''}
    FROM linkedin_connections`).all();
}

/**
 * Rescore everyone. The score depends on the whole network (how many of your
 * people work at a company, how strong a bridge's circle is), so after any
 * ingest or company-score change every row is recomputed — ~0.1s for 4,000.
 * Your company scores and your sector focus are read here, not passed in, so
 * every path that rescores (an import, a company score, Settings, a stale
 * model) applies both.
 */
export function rescoreAll() {
  const db = getDb();
  const rows = scoringRows(db);
  const focus = sectorFocusOf(db);
  const { scores } = scoreNetwork(rows, { overrides: companyOverrides(db), industryOf: industryKeyOf, focus });
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
    const meta = db.prepare('INSERT INTO app_meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value');
    meta.run('scoring_version', String(SCORING_VERSION));
    // Which sector focus these scores were computed with (see rescoreIfStale).
    meta.run('scoring_focus', focusFingerprint(focus));
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
  return { scored: rows.length };
}

/**
 * Rescore once if the stored scores came from an older scoring model, or from
 * a sector focus other than the one saved now: a database restored or brought
 * from another computer, or a Settings save whose rescore never finished.
 */
export function rescoreIfStale() {
  const db = getDb();
  const meta = (key) => db.prepare('SELECT value FROM app_meta WHERE key = ?').get(key)?.value;
  const fresh = meta('scoring_version') === String(SCORING_VERSION)
    && meta('scoring_focus') === focusFingerprint(sectorFocusOf(db));
  return fresh ? { scored: 0 } : rescoreAll();
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
