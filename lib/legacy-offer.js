// Paths → Scores: the one-time offer to keep the curated list's old scores as
// your own, after the list was made neutral (lib/legacy-scores.js has the old
// scores and why each changed).
//
// Who is offered what. The offer opens when rescoreAll() first replaces scores
// that were computed with the old list (lib/rpc.js), so a database that never
// had them, a fresh one, never sees it. It then lists each old entry that
// someone in this network works at now, whose built-in score is different now,
// and that you haven't scored yourself. A CSV import and the sample aren't
// scored on the server, so the page doesn't ask while one is open.
//
// Keeping writes the old score under every name scoring uses for the entry's
// companies, as Paths → Scores sets a score (setCompanyScores), then rescores
// everyone once for the whole batch. Keep or No thanks, it is never offered
// again, and an offer whose first look finds nothing to offer closes itself.

import { getDb } from './db-client.js';
import { readNetwork, companyScore, KNOWN_COMPANIES } from './scoring.js';
import { industryKeyOf } from './companies.js';
import { scoringRows, companyOverrides, setCompanyScores, rescoreAll } from './rpc.js';
import { LEGACY_SCORES, LEGACY_OFFER_KEY } from './legacy-scores.js';

const LISTED = new Set(KNOWN_COMPANIES.map(([name]) => name));
const OLD = LEGACY_SCORES.map(([name, score, names, industry]) => ({ name, score, names, industry }));
const OLD_BY_NAME = new Map(OLD.map((e) => [e.name, e]));
// As lib/scoring.js cleanCompany reads it: a name that says it is a school
// only matched a school on the list. Copied rather than imported, because this
// is how the old list matched and must stay so whatever the live rule becomes.
const SCHOOL_NAME = /\b(school|college|university)\b/;

// Most names an answer may carry: the old list had 34 changed entries.
const MAX_ANSWER = 100;

/**
 * The old list's entry that scored a company, found by the name scoring gives
 * the company now (cleanCompany's), or null. A company still on the list keeps
 * its name, so its old entry counts only if it was rescored. A removed entry's
 * names are found by its own names (lib/legacy-scores.js), the way
 * cleanCompany found them: "University of Central Florida" is its own name
 * now, and was UCF's. Another company the old alias also caught ("Hard Rock
 * Hotel" for Hard Rock Digital) isn't that entry's.
 */
export function legacyEntryFor(name) {
  if (!name) return null;
  if (LISTED.has(name)) return OLD_BY_NAME.get(name) || null;
  const lower = name.toLowerCase();
  const bare = lower.replace(/^the /, '');
  const school = SCHOOL_NAME.test(lower);
  for (const entry of OLD) {
    if (LISTED.has(entry.name) || (school && entry.industry !== 'education')) continue;
    if (entry.names.test(lower) || entry.names.test(bare) || lower === entry.name.toLowerCase()) return entry;
  }
  return null;
}

/**
 * 'open', 'kept', 'declined', 'none' (it opened, and there was nothing in
 * this network to offer), or null when this database was never offered.
 */
export function legacyOfferState(db = getDb()) {
  return db.prepare('SELECT value FROM app_meta WHERE key = ?').get(LEGACY_OFFER_KEY)?.value ?? null;
}

/**
 * What Paths → Scores offers, or null: nothing when the offer isn't open
 * (never was, or was answered) or no company in the network lost an old score
 * that you haven't replaced with one of your own. That last closes it for
 * good ('none'): the network the old list scored is the one read here, so
 * nothing could turn up later, and every visit to Paths → Scores would
 * otherwise read the whole network again to find nothing.
 *
 * The companies are the ones Paths → Scores lists, those someone works at now,
 * so a kept score shows there as yours and Auto can hand it back. (A name only
 * in former roles would be a score nothing lists; its people's former role
 * counts at 70% and moves them little.) Each is compared by its built-in score
 * now (the list or the estimate, before any sector lean) with the old entry's.
 *
 * @returns null | { companies: [{ name, was, now, estimated, people, names }] },
 *   one per old entry, most people first: the score it had (`was`), the
 *   built-in score its main name has now (`now`, `estimated` when that comes
 *   from the network rather than the list), how many people work there now,
 *   and every name it covers, as scoring writes them.
 */
export function legacyOffer(db = getDb()) {
  if (legacyOfferState(db) !== 'open') return null;
  const rows = scoringRows(db);
  if (!rows.length) return closeEmpty(db);
  const overrides = companyOverrides(db);
  const read = readNetwork(rows, { industryOf: industryKeyOf });

  const offered = new Map();                       // old entry name → what it offers
  const entryOf = new Map();                       // company name → that offer
  for (const [name, { headcount, industry }] of read.companies) {
    if (!headcount || overrides.has(name)) continue;   // nobody there now, or yours already
    const entry = legacyEntryFor(name);
    if (!entry) continue;
    const now = companyScore(name, { headcount, industry });
    if (now.score === entry.score) continue;       // the estimate landed where the list was
    const o = offered.get(entry.name) || { name: entry.name, was: entry.score, names: [], people: new Set() };
    o.names.push({ name, now, headcount });
    offered.set(entry.name, o);
    entryOf.set(name, o);
  }
  if (!offered.size) return closeEmpty(db);

  // People, each once, across all of an entry's names.
  for (const r of rows) {
    for (const role of read.people.get(r).roles) {
      if (!role.former && entryOf.has(role.company)) entryOf.get(role.company).people.add(r.profile_url || r.id);
    }
  }
  const companies = [...offered.values()].map((o) => {
    // Its main name: where most of its people are (then the first by name).
    const main = o.names.reduce((a, b) => (b.headcount > a.headcount || (b.headcount === a.headcount && b.name < a.name) ? b : a));
    return {
      name: o.name,
      was: o.was,
      now: main.now.score,
      estimated: main.now.source !== 'known',
      people: o.people.size,
      names: o.names.map((n) => n.name).sort(),
    };
  });
  companies.sort((a, b) => b.people - a.people || a.name.localeCompare(b.name));
  return { companies };
}

/** Close an open offer that has nothing to offer; null, as legacyOffer() says it. */
function closeEmpty(db) {
  db.prepare("UPDATE app_meta SET value = 'none' WHERE key = ? AND value = 'open'").run(LEGACY_OFFER_KEY);
  return null;
}

/**
 * The names an answer keeps, from the body the page sends: {keep: [names]},
 * where an empty list is No thanks. Throws an Error fit to show on anything
 * else.
 */
export function parseLegacyAnswer(body) {
  const keep = body?.keep;
  if (!Array.isArray(keep) || keep.length > MAX_ANSWER || !keep.every((n) => typeof n === 'string' && n.length <= 200)) {
    throw new Error('Send the companies to keep as a list of names (an empty list for No thanks).');
  }
  return keep;
}

/**
 * Answer the offer: keep, as your own, the old scores of the entries named in
 * `keep` (names from the offer; any other name is ignored), or keep none (No
 * thanks). Either way it is never offered again. The scores and the answer
 * are written together, all or nothing; then everyone is rescored once for
 * the whole batch, and only if something was kept. Answering an offer that
 * isn't open (another window already did) changes nothing.
 *
 * `rescore` is lib/rpc.js rescoreAll; tests pass a counting stand-in.
 * @returns { kept: [{ name, score, names }], scored }
 * @throws when the rescore fails, after the answer is saved: the message says
 *   so, `.kept` says what was kept, and the next load of the map rescores.
 */
export function answerLegacyOffer(keep = [], { db = getDb(), rescore = rescoreAll } = {}) {
  if (legacyOfferState(db) !== 'open') return { kept: [], scored: 0 };
  const wanted = new Set(keep);
  const kept = (legacyOffer(db)?.companies || [])
    .filter((c) => wanted.has(c.name))
    .map((c) => ({ name: c.name, score: c.was, names: c.names }));
  db.exec('BEGIN');
  try {
    setCompanyScores(db, kept.flatMap((c) => c.names.map((n) => [n, c.score])));
    db.prepare('UPDATE app_meta SET value = ? WHERE key = ?').run(kept.length ? 'kept' : 'declined', LEGACY_OFFER_KEY);
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
  if (!kept.length) return { kept, scored: 0 };
  try {
    return { kept, scored: rescore().scored };
  } catch (err) {
    // The kept scores are saved and the stored ones are not yet computed with
    // them. Without a model stamp they count as stale, so the next load of the
    // map redoes it (rpc.js rescoreIfStale), as a Settings save's retry does.
    try { db.prepare("DELETE FROM app_meta WHERE key = 'scoring_version'").run(); } catch { /* then the next change to any score rescores */ }
    throw Object.assign(new Error(`Kept, but rescoring your network failed (${err.message}). It will try again the next time the map loads.`), { kept });
  }
}
