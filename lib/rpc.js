import { createHash } from 'node:crypto';
import { getDb, newId, nowIso } from './db-client.js';

// Replacements for the stored procedures the hosted database used to provide.
// Scoring lives in lib/scoring.js; this file only reads rows and writes the
// results back. (scripts/*.sql are the retired hosted-era model.)

import { readNetwork, scoreNetwork, explainScore, SCORING_VERSION, KNOWN_COMPANIES, RULE_TABLES } from './scoring.js';
import { industryKeyOf, INDUSTRIES } from './companies.js';
import { readSettings } from './settings.js';
import { SECTOR_FOCUS_SETTING, focusFingerprint, previewSectorFocus } from './sector-focus.js';
import { LEGACY_OFFER_KEY } from './legacy-scores.js';
import { sectorMatcher, sectorGroup, sectorLabel } from './sector-directory.js';

// The word lists and rules the stored scores were computed with: a fingerprint
// of every entry on the curated company list (name, score, alias, industry),
// of the broad industries' words and labels (lib/companies.js INDUSTRIES), and
// of every rule table scoring reads headlines and names with (lib/scoring.js
// RULE_TABLES: titles, students and clubs, what isn't a company, the reach
// bonuses), stamped beside them in app_meta 'scoring_list'. The industries'
// words decide a company's one industry, which decides whether it is a school
// (no estimate) and whether a broad pick in Settings leans it; their labels
// are in the stored working ("4 + 1 your sector: Healthcare & Biotech").
// Editing any of them makes stored scores stale, as a new SCORING_VERSION
// does, with no number to remember to bump. Copies from before the list was
// made neutral stamped none, which is also how rescoreAll() knows to offer
// keeping their old scores (lib/legacy-offer.js).
export function scoringStamp({ known = KNOWN_COMPANIES, industries = INDUSTRIES, rules = RULE_TABLES } = {}) {
  // JSON has no patterns or sets: a pattern counts by its source and flags, a set by its members.
  const plain = (key, value) => (value instanceof RegExp ? String(value) : value instanceof Set ? [...value] : value);
  return createHash('sha256')
    .update(JSON.stringify([
      known.map(([name, score, alias, industry]) => [name, score, String(alias), industry]),
      industries.map(({ key, label, words }) => [key, label, String(words)]),
      rules,
    ], plain))
    .digest('hex').slice(0, 16);
}

export const KNOWN_LIST_STAMP = scoringStamp();

export function companyOverrides(db = getDb()) {
  return new Map(db.prepare('SELECT name, score FROM company_scores').all().map((r) => [r.name, r.score]));
}

/**
 * Set company scores as your own ([[name, score], …]), the way Paths → Scores
 * does: one row per name, replacing any you had. Rescoring is the caller's
 * job, so a batch rescores once.
 */
export function setCompanyScores(db, entries) {
  const upsert = db.prepare(`INSERT INTO company_scores (id, name, score, updated_at) VALUES (?, ?, ?, ?)
    ON CONFLICT(name) DO UPDATE SET score = excluded.score, updated_at = excluded.updated_at`);
  const now = nowIso();
  for (const [name, score] of entries) upsert.run(newId(), name, score, now);
}

/** The sector focus saved in Settings (lib/sector-focus.js), or none. */
export function sectorFocusOf(db = getDb()) {
  return readSettings(db, { sectorFocus: SECTOR_FOCUS_SETTING }).sectorFocus;
}

/**
 * What rescoring reads: every row, as scoring needs it. `withPeople` adds each
 * row's name, for naming who a change would move.
 */
export function scoringRows(db = getDb(), { withPeople = false } = {}) {
  return db.prepare(`SELECT id, degree, headline, role, company, scanned_company, profile_url, source_connection_id${withPeople ? ', name' : ''}
    FROM linkedin_connections`).all();
}

/**
 * Every headline read once, the way scoring reads it: each company's
 * headcount, its one industry, the sector directory's sectors it matches and
 * the industries those sit under. Rescoring, Settings' preview and
 * suggestions, and Paths → Scores all read the rows through this, so they
 * agree on which company is in which sector.
 */
export function readForScoring(rows) {
  return readNetwork(rows, { industryOf: industryKeyOf, sectorsOf: sectorMatcher(), groupOf: sectorGroup });
}

/**
 * Rescore everyone. The score depends on the whole network (how many of your
 * people work at a company, how strong a bridge's circle is), so after any
 * ingest or company-score change every row is recomputed — ~0.1s for 4,000.
 * Your company scores and your sector focus are read here, not passed in, so
 * every path that rescores (an import, a company score, Settings, a stale
 * model) applies both.
 *
 * `compareWith` is another sector focus: Settings' save passes the one it
 * replaced. The same rows are then also scored with it, in memory, and the
 * answer says who changed tier between the two, counted by the preview's own
 * function (lib/sector-focus.js), so a save reports what its preview said.
 * That compares two fresh scorings rather than the stored tiers, which can be
 * stale (a save whose rescore failed, a database from another computer).
 * @returns { scored } rows written, plus { people, up, down } when comparing.
 */
export function rescoreAll({ compareWith } = {}) {
  const db = getDb();
  const rows = scoringRows(db);
  const overrides = companyOverrides(db);
  const focus = sectorFocusOf(db);
  // Every headline is read once, however many ways the rows are then scored.
  const read = readForScoring(rows);
  const { scores } = scoreNetwork(rows, { overrides, focus, read });
  // Worked out before anything is written, so a failure leaves nothing half done.
  const change = compareWith === undefined ? null
    : previewSectorFocus(rows, { overrides, read, from: compareWith, to: focus, examples: 0 });
  const update = db.prepare(`UPDATE linkedin_connections SET seniority_score = ?, company_prestige_score = ?, power_score = ?, tier = ?,
    score_why = ?, circle_power = ?, circle_s_count = ?, circle_a_count = ?, circle_elite_pct = ?, is_catalyst = ?, catalyst_score = ?, updated_at = ?
    WHERE id = ?`);
  const now = nowIso();
  db.exec('BEGIN');
  try {
    // Stored scores with no list stamp came from a copy whose curated list
    // held one person's picks. The first time they are replaced, Paths →
    // Scores offers once to keep the old ones as your own (lib/legacy-offer.js).
    // A database nothing has scored yet never had them, so it is never offered.
    const listed = db.prepare("SELECT 1 FROM app_meta WHERE key = 'scoring_list'").get();
    if (!listed && db.prepare('SELECT 1 FROM linkedin_connections WHERE tier IS NOT NULL LIMIT 1').get()) {
      db.prepare("INSERT OR IGNORE INTO app_meta (key, value) VALUES (?, 'open')").run(LEGACY_OFFER_KEY);
    }
    for (const r of rows) {
      const s = scores.get(r.id);
      const c = s.circle;
      update.run(s.title.points, s.companyScore, s.power, s.tier, explainScore(s, s.boost, { sectorLabel }),
        c ? Math.round(c.circlePower * 100) / 100 : 0, c?.sCount || 0, c?.aCount || 0, c ? Math.round(c.elitePct * 100) / 100 : 0,
        c?.isCatalyst ? 1 : 0, c?.isCatalyst ? c.sCount + c.aCount : 0, now, r.id);
    }
    const meta = db.prepare('INSERT INTO app_meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value');
    meta.run('scoring_version', String(SCORING_VERSION));
    // Which curated list and sector focus these scores were computed with (see rescoreIfStale).
    meta.run('scoring_list', KNOWN_LIST_STAMP);
    meta.run('scoring_focus', focusFingerprint(focus));
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
  return change ? { scored: rows.length, people: change.people, up: change.up, down: change.down } : { scored: rows.length };
}

/**
 * Rescore once if the stored scores came from an older scoring model or
 * curated list, or from a sector focus other than the one saved now: an
 * update, a database restored or brought from another computer, or a Settings
 * save whose rescore never finished.
 */
export function rescoreIfStale() {
  const db = getDb();
  const meta = (key) => db.prepare('SELECT value FROM app_meta WHERE key = ?').get(key)?.value;
  const fresh = meta('scoring_version') === String(SCORING_VERSION)
    && meta('scoring_list') === KNOWN_LIST_STAMP
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
