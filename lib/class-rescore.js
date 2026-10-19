// Writing class worth into the network (spec sections 7 and 12): class_u,
// class_v, class_tier and class_why on every row, under the class picked, and
// the scoring_class stamp beside them in app_meta. rescoreIfStale compares the
// stamp as it compares scoring_focus and scoring_titles, so a respec, an
// answer or a Never list that changed rescores once.
//
// The network columns (power_score, tier, score_why, the circle columns) are
// never touched here: class worth is the second axis, not a replacement. With
// no class picked the class columns are empty and the stamp is 'none'.

import { createHash } from 'node:crypto';
import { readGoals, activeBuild } from './class-goals.js';
import { personFacts, addStructure, classEnv, scoreClass, levelOfRole, homeGuess } from './class-fit.js';
import { PRESET_VERSION, FEATURE_SET_VERSION, FLOOR_ANSWERS } from './class-presets.js';
import { readSettings } from './settings.js';
import { BREACH_SETTING } from './breach.js';
import { readTitle } from './scoring.js';
import { urlKey } from './ties.js';

export const CLASS_STAMP_KEY = 'scoring_class';

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

/**
 * The stamp for what class scoring depends on: the class, its preset and
 * feature-set versions, the weights (to 2 places), the outside option once the
 * floors are on, the dials, the target, the Never list and your Breach targets
 * (the Infiltrator's companies). 'none' with no class.
 */
export function classStamp(goals, { breachTargets = [] } = {}) {
  const b = activeBuild(goals);
  if (!b) return 'none';
  const floors = (b.answers || []).filter((a) => a.choice === 'neither' || a.choice === 'both').length >= FLOOR_ANSWERS;
  const w = b.weights ? Object.entries(b.weights).map(([k, v]) => [k, round2(v)]) : null;
  return createHash('sha256').update(JSON.stringify([
    b.class, PRESET_VERSION, FEATURE_SET_VERSION, w, floors ? round2(b.u0) : null, b.dials, b.setup, b.avoid, b.nevers,
    b.class === 'infiltrator' ? breachTargets : null,
  ])).digest('hex').slice(0, 16);
}

/** Your Breach targets and city (Settings), which the Infiltrator and the place features read. */
export function breachOf(db) {
  try { return readSettings(db, { breach: BREACH_SETTING }).breach; } catch { return { targets: [], city: '', school: '' }; }
}

/** How many mutual-web ties each profile has, by profile key: the Cartographer's "ways in" for your connections. */
export function tieCounts(db) {
  const counts = new Map();
  try {
    for (const { a_url: a, b_url: b } of db.prepare('SELECT a_url, b_url FROM connection_ties').all()) {
      for (const u of [a, b]) {
        const k = urlKey(u);
        if (k) counts.set(k, (counts.get(k) || 0) + 1);
      }
    }
  } catch { /* an older database: none */ }
  return counts;
}

/**
 * Facts for every row, from what scoring read (`read`: readNetwork, `scores`:
 * scoreNetwork's per-row results), with structure counted over the network.
 */
export function factsFor(db, { rows, read, scores, titles = null }) {
  const facts = rows.map((r) => personFacts(r, { person: read.people.get(r), scored: scores.get(r.id), companies: read.companies, titles }));
  const ties = tieCounts(db);
  return addStructure(facts, { tieCount: (url) => ties.get(urlKey(url)) || 0 });
}

/** The env a build scores in, with this database's Breach targets, your seat and a guess at your city. */
export function envFor(db, facts, build) {
  const breach = breachOf(db);
  const about = build?.setup?.about || {};
  const guess = breach.city || homeGuess(facts);
  return classEnv(facts, build, { breachTargets: breach.targets || [], userLevel: levelOfRole(about.role, readTitle), homeGuess: guess });
}

/**
 * Score the facts under the active class and write the class columns, all in
 * one transaction, then stamp. Returns { scored, stamp, counts }.
 */
export function writeClassScores(db, facts) {
  const goals = readGoals(db);
  const build = activeBuild(goals);
  const breach = breachOf(db);
  const stamp = classStamp(goals, { breachTargets: breach.targets || [] });
  const meta = db.prepare('INSERT INTO app_meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value');
  if (!build) {
    db.prepare('UPDATE linkedin_connections SET class_u = NULL, class_v = NULL, class_tier = NULL, class_why = NULL WHERE class_tier IS NOT NULL OR class_u IS NOT NULL').run();
    meta.run(CLASS_STAMP_KEY, 'none');
    return { scored: 0, stamp: 'none', counts: null };
  }
  const env = envFor(db, facts, build);
  const { results, counts } = scoreClass(facts, build, env);
  const update = db.prepare('UPDATE linkedin_connections SET class_u = ?, class_v = ?, class_tier = ?, class_why = ? WHERE id = ?');
  // Inside rescoreAll's own transaction it joins that one; on its own it opens one.
  let own = false;
  if (db.isTransaction !== true) { try { db.exec('BEGIN'); own = true; } catch { own = false; } }
  try {
    for (const f of facts) {
      const r = results.get(f.id);
      if (!r) continue;
      update.run(Math.round(r.u * 1000) / 1000, Math.round(r.v * 1000) / 1000, r.tier, r.why || null, f.id);
    }
    meta.run(CLASS_STAMP_KEY, stamp);
    if (own) db.exec('COMMIT');
  } catch (err) {
    if (own) { try { db.exec('ROLLBACK'); } catch { /* nothing open */ } }
    throw err;
  }
  return { scored: facts.length, stamp, counts };
}

/** Is the stored class scoring stale against the goals and settings now? */
export function classStale(db) {
  const stored = db.prepare('SELECT value FROM app_meta WHERE key = ?').get(CLASS_STAMP_KEY)?.value ?? 'none';
  const goals = readGoals(db);
  return stored !== classStamp(goals, { breachTargets: breachOf(db).targets || [] });
}
