// Your sector (Settings): up to three sectors you work in, and how hard to
// lean toward them. Companies in them get +1 ("lean") or +2 ("strong") on
// their score, so the people there rank higher. A pick is one of the twelve
// broad industries (lib/companies.js INDUSTRIES), which a company matches by
// its one industry, or a narrower sector from the directory
// (lib/sector-directory.js), which it matches by the directory's words. The
// model itself is in lib/scoring.js (companyScore); this file is the setting
// around it: what a valid choice is, the fingerprint the stored scores are
// stamped with, and the dry run the page shows before you save (which a save
// also reports).
//
// Pure functions; tests/sector.test.mjs pins them down.

import { readNetwork, scoreNetwork, SECTOR_BONUS } from './scoring.js';
import { SECTOR_KEYS, DIRECTORY_VERSION, isDirectoryKey, sectorMatcher } from './sector-directory.js';
import { TIER_ORDER } from './tiers.js';

export const MAX_SECTORS = 3;
export const STRENGTHS = Object.keys(SECTOR_BONUS);

/** Nothing chosen: the model as it is for everyone else. */
export const NO_FOCUS = Object.freeze({ sectors: Object.freeze([]), strength: 'lean' });

/**
 * A sector focus as sent by the page → a clean one, or an Error whose message
 * can be shown as is. Sectors are broad industry keys (the ones the rest of
 * the app infers) and the directory's keys, deduplicated and kept in one
 * order (each industry, then its sectors), so the same choice always stores
 * the same way. A choice saved before the directory, of industries only,
 * reads exactly as it did.
 */
export function parseSectorFocus(value) {
  if (value === null || value === undefined) return { sectors: [], strength: 'lean' };
  if (typeof value !== 'object' || Array.isArray(value)) throw new Error('Your sector must be a choice of sectors and a strength.');
  const raw = value.sectors ?? [];
  if (!Array.isArray(raw)) throw new Error('Sectors must be a list.');
  for (const s of raw) {
    if (!SECTOR_KEYS.includes(s)) throw new Error(`There is no sector called '${String(s).slice(0, 40)}'.`);
  }
  const sectors = SECTOR_KEYS.filter((k) => raw.includes(k));
  if (sectors.length > MAX_SECTORS) throw new Error(`Pick up to ${MAX_SECTORS} sectors.`);
  const strength = value.strength ?? 'lean';
  if (!STRENGTHS.includes(strength)) throw new Error('Strength is lean or strong.');
  return { sectors, strength };
}

/** How Settings declares it (lib/settings.js). */
export const SECTOR_FOCUS_SETTING = { default: NO_FOCUS, parse: parseSectorFocus };

/**
 * A short, stable string for a focus, stamped beside the stored scores
 * (app_meta 'scoring_focus'). If the saved focus stops matching it (a
 * restored or imported database, a save whose rescore never finished, an
 * update that changed the directory's words), the scores are stale and are
 * recomputed on the next load. A pick from the directory matches by its word
 * lists, so the fingerprint carries the directory's version
 * ("lean:dental@<version>"); broad industries alone don't use the directory,
 * so theirs stays as it was ("lean:media,tech"). `version` is for tests.
 */
export function focusFingerprint(focus, { version = DIRECTORY_VERSION } = {}) {
  let f;
  try { f = parseSectorFocus(focus); } catch { return 'none'; }
  if (!f.sectors.length) return 'none';
  const picks = `${f.strength}:${f.sectors.join(',')}`;
  return f.sectors.some(isDirectoryKey) ? `${picks}@${version}` : picks;
}

export const sameFocus = (a, b) => focusFingerprint(a) === focusFingerprint(b);

const RANK = Object.fromEntries(TIER_ORDER.map((t, i) => [t, TIER_ORDER.length - i]));

/**
 * Who changes tier between two scorings of the same rows. People are counted
 * once (by profile URL) at their closest degree, the row the map shows.
 * `tierBefore(row)` / `tierAfter(row)` return a tier letter or nothing.
 * @returns { people, up, down, examples: [{ name, degree, company, from, to }] }
 *   people is how many people the rows are (a person can be several rows).
 */
export function tierMoves(rows, tierBefore, tierAfter, { examples = 5, companyOf } = {}) {
  const people = new Map();
  for (const r of rows) {
    const key = r.profile_url || `id:${r.id}`;
    const prev = people.get(key);
    if (!prev || (r.degree || 9) < (prev.degree || 9)) people.set(key, r);
  }
  const moves = [];
  for (const r of people.values()) {
    const from = tierBefore(r);
    const to = tierAfter(r);
    if (!to || from === to) continue;
    moves.push({ r, from: from || null, to, up: (RANK[to] || 0) > (RANK[from] || 0) });
  }
  // The most telling first: into the highest tier, then out of the highest.
  // When people move both ways, both show.
  const ups = moves.filter((m) => m.up).sort((a, b) => RANK[b.to] - RANK[a.to] || (a.r.degree || 9) - (b.r.degree || 9));
  const downs = moves.filter((m) => !m.up).sort((a, b) => (RANK[b.from] || 0) - (RANK[a.from] || 0) || (a.r.degree || 9) - (b.r.degree || 9));
  const nUp = Math.min(ups.length, examples - Math.min(downs.length, Math.floor(examples / 2)));
  const nDown = Math.min(downs.length, examples - nUp);
  const pick = [...ups.slice(0, nUp), ...downs.slice(0, nDown)];
  return {
    people: people.size,
    up: ups.length,
    down: downs.length,
    examples: pick.map((m) => ({
      name: m.r.name || 'Someone',
      degree: m.r.degree || null,
      company: companyOf?.(m.r) || null,
      from: m.from,
      to: m.to,
    })),
  };
}

/**
 * What changing the sector focus from `from` to `to` does to these rows,
 * worked out in memory: every headline read once (the slow part), then the
 * network scored once per focus. Nothing is written. Settings shows it before
 * you save, with `from` the focus saved now; the save reports it afterwards
 * (lib/rpc.js rescoreAll's compareWith), so what the preview says and what
 * the save says are the same count. `overrides` are your company scores, and
 * `industryOf` and `sectorsOf` the injected inference and sector directory, as
 * rescoreAll passes them (lib/rpc.js readForScoring); `read` is readNetwork()
 * of these rows, when they have been read already.
 * @returns { scored, people, companies, companiesUp, companiesDown, companyExamples, up, down, examples }
 *   scored counts rows and people counts people; companies are those whose
 *   score moves, up/down the people whose tier does.
 */
export function previewSectorFocus(rows = [], {
  overrides = new Map(), industryOf, sectorsOf = sectorMatcher(), from = NO_FOCUS, to = NO_FOCUS, examples = 5,
  read = readNetwork(rows, { industryOf, sectorsOf }),
} = {}) {
  const before = scoreNetwork(rows, { overrides, focus: from, read });
  const after = scoreNetwork(rows, { overrides, focus: to, read });

  // Companies whose score moves, biggest first (by your people there now).
  // Every company anyone names counts, a former employer too: its score moves
  // like any other, and it can be the role that moves the person who named it.
  // `sector` is the pick that leans the company (in either focus), else its industry.
  const changed = [];
  for (const [name, a] of before.companyScores) {
    const b = after.companyScores.get(name);
    if (!name || !b || a.score === b.score) continue;
    const sector = b.sector || a.sector || read.companies.get(name)?.industry;
    changed.push({ name, from: a.score, to: b.score, sector, people: read.headcount.get(name) || 0 });
  }
  changed.sort((x, y) => y.people - x.people || x.name.localeCompare(y.name));

  const moved = tierMoves(rows,
    (r) => before.scores.get(r.id)?.tier,
    (r) => after.scores.get(r.id)?.tier,
    { examples, companyOf: (r) => after.scores.get(r.id)?.company });

  // `people` comes with the tier moves: people once each, as they are counted.
  return {
    scored: rows.length,
    companies: changed.length,
    companiesUp: changed.filter((c) => c.to > c.from).length,
    companiesDown: changed.filter((c) => c.to < c.from).length,
    companyExamples: changed.slice(0, examples).map(({ name, from: a, to: b, sector }) => ({ name, from: a, to: b, sector })),
    ...moved,
  };
}
