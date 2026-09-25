// Your sector (Settings): up to three industries you work in, and how hard to
// lean toward them. Companies in them get +1 ("lean") or +2 ("strong") on
// their score, so the people there rank higher. The model itself is in
// lib/scoring.js (companyScore); this file is the setting around it: what a
// valid choice is, the fingerprint the stored scores are stamped with, and
// the dry run the page shows before you save.
//
// Pure functions; tests/sector.test.mjs pins them down.

import { INDUSTRIES } from './companies.js';
import { scoreNetwork, companyScore, SECTOR_BONUS } from './scoring.js';
import { TIER_ORDER } from './tiers.js';

export const MAX_SECTORS = 3;
export const STRENGTHS = Object.keys(SECTOR_BONUS);

const ORDER = INDUSTRIES.map((i) => i.key);

/** Nothing chosen: the model as it is for everyone else. */
export const NO_FOCUS = Object.freeze({ sectors: Object.freeze([]), strength: 'lean' });

/**
 * A sector focus as sent by the page → a clean one, or an Error whose message
 * can be shown as is. Sectors are the industry keys the rest of the app infers
 * (lib/companies.js INDUSTRIES), deduplicated and kept in that list's order,
 * so the same choice always stores the same way.
 */
export function parseSectorFocus(value) {
  if (value === null || value === undefined) return { sectors: [], strength: 'lean' };
  if (typeof value !== 'object' || Array.isArray(value)) throw new Error('Your sector must be a choice of sectors and a strength.');
  const raw = value.sectors ?? [];
  if (!Array.isArray(raw)) throw new Error('Sectors must be a list.');
  for (const s of raw) {
    if (!ORDER.includes(s)) throw new Error(`There is no sector called '${String(s).slice(0, 40)}'.`);
  }
  const sectors = ORDER.filter((k) => raw.includes(k));
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
 * restored or imported database, a save whose rescore never finished), the
 * scores are stale and are recomputed on the next load.
 */
export function focusFingerprint(focus) {
  let f;
  try { f = parseSectorFocus(focus); } catch { return 'none'; }
  return f.sectors.length ? `${f.strength}:${f.sectors.join(',')}` : 'none';
}

export const sameFocus = (a, b) => focusFingerprint(a) === focusFingerprint(b);

const RANK = Object.fromEntries(TIER_ORDER.map((t, i) => [t, TIER_ORDER.length - i]));

/**
 * Who changes tier between two scorings of the same rows. People are counted
 * once (by profile URL) at their closest degree, the row the map shows.
 * `tierBefore(row)` / `tierAfter(row)` return a tier letter or nothing.
 * @returns { up, down, examples: [{ name, degree, company, from, to }] }
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
 * What saving `to` would change, compared with `from` (what is saved now),
 * worked out in memory from the rows rescoreAll() reads. Nothing is written.
 * `overrides` are your company scores and `industryOf` the injected inference,
 * exactly as rescoreAll passes them, so the preview and the save agree.
 * @returns { scored, companies, companiesUp, companiesDown, companyExamples, up, down, examples }
 *   companies are those whose score moves; up/down are people whose tier does.
 */
export function previewSectorFocus(rows = [], { overrides = new Map(), industryOf, from = NO_FOCUS, to = NO_FOCUS, examples = 5 } = {}) {
  const before = scoreNetwork(rows, { overrides, industryOf, focus: from });
  const after = scoreNetwork(rows, { overrides, industryOf, focus: to });

  // Companies whose score moves, biggest first (by your people there now).
  const changed = [];
  for (const [name, n] of after.headcount) {
    const industry = after.industries.get(name);
    const a = companyScore(name, { overrides, headcount: n, industry, focus: from }).score;
    const b = companyScore(name, { overrides, headcount: n, industry, focus: to }).score;
    if (a !== b) changed.push({ name, from: a, to: b, sector: industry, people: n });
  }
  changed.sort((x, y) => y.people - x.people || x.name.localeCompare(y.name));

  const moved = tierMoves(rows,
    (r) => before.scores.get(r.id)?.tier,
    (r) => after.scores.get(r.id)?.tier,
    { examples, companyOf: (r) => after.scores.get(r.id)?.company });

  return {
    scored: rows.length,
    companies: changed.length,
    companiesUp: changed.filter((c) => c.to > c.from).length,
    companiesDown: changed.filter((c) => c.to < c.from).length,
    companyExamples: changed.slice(0, examples).map(({ name, from: a, to: b, sector }) => ({ name, from: a, to: b, sector })),
    ...moved,
  };
}
