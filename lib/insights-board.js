// Insights (Profile → ✦ Insights): your network ranked by power, and the boards that read it
// (Blake, 2026-10-03: "stats and insights … data and insights based off their
// circles … almost no moral tie to the person … base it off value like richest
// person or highest power people … an intro perspective look at the data of
// what we have … insights and analytics that speak our language and actual
// system at hand").
//
// Everything here is counted from what the app already keeps: the rows a scan
// or an import saved, the score each was given (lib/scoring.js, never scored
// again here), the circles you've scanned and what the scanner noted about
// them. Nothing is estimated that the app doesn't already estimate, and
// nothing about money: Sixgree never sees pay, net worth or revenue, so
// "richest" is answered with what it can see (companyPower's `big`). Each board
// says where its numbers come from in `source`, for the page to print under
// them.
//
// The pieces are the app's own, reused rather than copied:
//   separationPeople    2nd-degree rows merged into people, with every way in (lib/separation.js)
//   exclusiveReach      who only one connection reaches (lib/brokerage.js)
//   rarityOf            how rare the way in is, and whether LinkedIn or your scans counted it (lib/rarity.js)
//   buildCompanyIndex   companies and their one industry (lib/companies.js)
//   reachIndex          scanned, hidden and not yet, and how far lists were read (lib/reach.js)
//   scoreGuess          whether a score rests on a guess (lib/score-guess.js)
//   readTitle           someone's current title (lib/scoring.js; lib/title-ranking.js ranks the same levels)
//
// Plain functions, no React and no Node imports: the page runs them, and
// tests/insights-board.test.mjs runs them on invented rows.

import { separationPeople, keyFor, score1, compareBridges } from './separation.js';
import { exclusiveReach } from './brokerage.js';
import { RARITY, rarityOf } from './rarity.js';
import { buildCompanyIndex, industryByKey } from './companies.js';
import { reachIndex, circleState, circleScanCost } from './reach.js';
import { scoreGuess } from './score-guess.js';
import { readTitle, companyScore, currentCompany, TOP_COMPANY } from './scoring.js';
import { SAFE_LIMITS } from './search-risk.js';

export const TIERS = ['S', 'A', 'B', 'C', 'D'];
const RARITY_KEYS = RARITY.map((r) => r.key);
const isSA = (tier) => tier === 'S' || tier === 'A';
const byName = (a, b) => String(a?.name || '').localeCompare(String(b?.name || ''));
const zeroTiers = () => ({ S: 0, A: 0, B: 0, C: 0, D: 0 });
const pct = (part, whole) => (whole ? (100 * part) / whole : 0);

/** A tie this big gets a line of its own in the table, saying why so many share one score. */
export const BAND_MIN = 10;

// The stored working (lib/scoring.js explainScore): "C-Suite / Founder (10) ·
// Meridian Media (6/10)", with "Former " or "Student · " before the title, a
// company score set by hand as "(7/10, your score)", a sector lean as
// "(6/10: 5 + 1 your sector: Dental)", and "+2 strong circle" at the end when
// a circle lifted it. The same reading as lib/score-guess.js.
const WORKING = /^(?:Former )?(?:Student · )?(.+?) \([\d.]+(?:, your ranking)?\) · (no company found|.+?) \((\d+(?:\.\d+)?)\/10([:,][^)]*)?\)/;
const BOOST = /\+(\d+(?:\.\d+)?) strong circle/;

/**
 * What a row's stored working says: the title and company its score is built
 * on, the company's score and whether you set it, and the circle bonus.
 * Null fields when the row has no working (a CSV import, an old row).
 */
export function readWorking(row) {
  const why = String(row?.score_why || '');
  const m = why.match(WORKING);
  const boost = Number(why.match(BOOST)?.[1]) || 0;
  if (!m) return { title: null, company: null, companyScore: null, yours: false, sector: false, boost };
  return {
    title: m[1],
    company: m[2] === 'no company found' ? null : m[2],
    companyScore: Number(m[3]),
    yours: /, (your|sample) score/.test(m[4] || ''),
    sector: /your sector/.test(m[4] || ''),
    boost,
  };
}

/** The title and company to print under someone's name: the role their score is built on, else what the headline says. */
export function roleLine(row) {
  const w = readWorking(row);
  const title = w.title || readTitle(row?.headline || '', row?.role || '').label;
  const company = w.company || row?.company || currentCompany(row || {}) || null;
  return { title, company };
}

// ── The base: read once per network ─────────────────────────────────────────

/**
 * Everything the boards share, built once per load.
 *
 * @param {{ degree1?: object[], degree2?: object[], degree3?: object[], notes?: object }} input
 *   the rows /api/network (or a CSV import, or the sample) gives the page, and
 *   what the scanner noted (lib/scraper-client.js loadScanNotes)
 * @returns {{ d1, second, sep, yours, circles, reach, d3, degree2, hasCircles }}
 *   `d1` your connections, each once; `second` the people in your scanned
 *   circles who aren't your connections, each once, with their routes
 *   (separationPeople); `circles` connection id → the rows in their circle.
 */
export function boardBase({ degree1 = [], degree2 = [], degree3 = [], notes } = {}) {
  const yours = new Set();
  const d1 = [];
  for (const row of degree1 || []) {
    const key = keyFor(row);
    if (yours.has(key)) continue;
    yours.add(key);
    d1.push(row);
  }
  const sep = separationPeople(degree2 || [], degree1 || []);
  // Someone in a circle who is also your connection is counted once, as yours.
  const second = sep.people.filter((p) => !yours.has(p.key));
  const circles = new Map();
  for (const row of degree2 || []) {
    const id = row?.source_connection_id;
    if (id == null || yours.has(keyFor(row))) continue;
    let list = circles.get(id);
    if (!list) circles.set(id, (list = []));
    list.push(row);
  }
  const seen = new Set([...yours, ...second.map((p) => p.key)]);
  const d3 = [];
  for (const row of degree3 || []) {
    const key = keyFor(row);
    if (seen.has(key)) continue;
    seen.add(key);
    d3.push(row);
  }
  const reach = reachIndex(d1, degree2 || [], notes || {});
  return { d1, second, sep, yours, circles, reach, d3, degree2: degree2 || [], hasCircles: second.length > 0 };
}

/** One of your connections' circle: whether it's scanned, and who's in it by tier. */
export function circleOf(base, row) {
  const list = base.circles.get(row?.id) || [];
  const tiers = zeroTiers();
  for (const r of list) if (tiers[r.tier] !== undefined) tiers[r.tier]++;
  return { state: circleState(row, base.reach), size: list.length, S: tiers.S, A: tiers.A, tiers };
}

// ── 1. The Power Index ───────────────────────────────────────────────────────

/** Power order: shown score, then yours before 2nd degree, then most ways in, then the best way in, then name. */
function compareEntries(a, b) {
  return b.score - a.score
    || a.degree - b.degree
    || b.waysIn - a.waysIn
    || (a.routes[0]?.bridge && b.routes[0]?.bridge ? compareBridges(a.routes[0].bridge, b.routes[0].bridge) : 0)
    || byName(a.row, b.row)
    || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0);
}

/**
 * Everyone within two steps of you, each once, by power: your connections and
 * the people in the circles you've scanned. A 2nd-degree person counts once
 * however many of your connections know them (lib/separation.js).
 *
 * Ranks are competition ranks on the shown score alone ("#10=" for everyone at
 * 7.8), worked out once for the whole list so a filter never renumbers anyone.
 * A tie of BAND_MIN or more is a `band`: how many share the score, and the
 * working most of them share, so the table can say why ("648 people share
 * 7.8 …"). Inside a tie your connections come first, then most ways in.
 *
 * @returns {{ people, bands, counts, total, source }}
 *   each person: { key, row, degree, score, tier, rank, tied, waysIn, routes,
 *   rarity, circle, boost, haystack }
 */
export function powerIndex(base) {
  const people = [];
  for (const row of base.d1) {
    const circle = circleOf(base, row);
    people.push({
      key: keyFor(row), row, degree: 1, score: score1(row), tier: row.tier, waysIn: 0, routes: [], rarity: null,
      circle, boost: readWorking(row).boost,
      haystack: [row.name, row.headline, row.company, row.role].filter(Boolean).join('\n').toLowerCase(),
    });
  }
  for (const p of base.second) {
    people.push({
      key: p.key, row: p.person, degree: 2, score: p.score, tier: p.tier, waysIn: p.waysIn, routes: p.routes,
      rarity: rarityOf(p.person, p.waysIn), circle: null, boost: 0, haystack: p.haystack,
    });
  }
  people.sort(compareEntries);

  const bands = [];
  for (let i = 0; i < people.length; i++) {
    const p = people[i], prev = people[i - 1];
    const same = prev && prev.score === p.score;
    p.rank = same ? prev.rank : i + 1;
    p.tied = false;
    if (same) { p.tied = true; prev.tied = true; }
  }
  // The ties big enough for a line of their own, with the working most of them share.
  for (let i = 0; i < people.length;) {
    let j = i;
    while (j < people.length && people[j].score === people[i].score) j++;
    if (j - i >= BAND_MIN) bands.push(bandFor(people.slice(i, j), i));
    i = j;
  }

  const counts = { degree: { 1: 0, 2: 0 }, tiers: zeroTiers(), rarity: Object.fromEntries(RARITY_KEYS.map((k) => [k, 0])) };
  for (const p of people) {
    counts.degree[p.degree]++;
    if (counts.tiers[p.tier] !== undefined) counts.tiers[p.tier]++;
    if (p.rarity) counts.rarity[p.rarity.key]++;
  }
  return {
    people, bands, counts, total: people.length,
    source: 'Power is title × company weight, plus up to +1.5 for named honours and up to +2 for a strong circle. '
      + 'Read from headlines people write themselves. Rarity is the platform’s mutual count where a scan read one, '
      + 'else the ways in your scans saw (marked +, which can only go up).',
  };
}

/** A tie of many: how many, where it starts, and the working most of them share. */
function bandFor(group, start) {
  const shared = new Map();
  let boosted = 0;
  for (const p of group) {
    const w = readWorking(p.row);
    if (w.boost) boosted++;
    if (!w.title || w.companyScore == null) continue;
    const k = `${w.title}|${w.companyScore}`;
    const s = shared.get(k) || { title: w.title, companyScore: w.companyScore, count: 0 };
    s.count++;
    shared.set(k, s);
  }
  const top = [...shared.values()].sort((a, b) => b.count - a.count || a.title.localeCompare(b.title))[0] || null;
  const yours = group.filter((p) => p.degree === 1).length;
  return { score: group[0].score, rank: group[0].rank, start, count: group.length, yours, boosted, common: top };
}

/**
 * The band's sentence, in two parts so the page can set the first in bold:
 * { head: "648 people share 7.8.", rest: "Every one is C-Suite / Founder at a company scored 6." }
 */
export function bandText(band) {
  const n = (x) => x.toLocaleString('en-US');
  const head = `${n(band.count)} people share ${band.score.toFixed(1)}.`;
  const c = band.common;
  if (!c) return { head, rest: '' };
  const what = `${c.title} at a company scored ${c.companyScore}`;
  const rest = c.count === band.count ? `Every one is ${what}.`
    : c.count * 2 > band.count ? `Most are ${what} (${n(c.count)} of them).`
    : `The most common is ${what} (${n(c.count)} of them).`;
  return { head, rest };
}

/**
 * The Power Index as filtered on screen. Ranks stay the whole list's.
 * @param {{ degree?: 'all'|1|2, tiers?: Set, rarities?: Set, query?: string }} f
 *   tiers and rarities are AND, as lib/rarity.js passes() has them; a rarity
 *   filter keeps 2nd-degree people only, since your connections have none.
 */
export function filterIndex(index, { degree = 'all', tiers = new Set(), rarities = new Set(), query = '' } = {}) {
  const q = String(query || '').trim().toLowerCase();
  return index.people.filter((p) => (degree === 'all' || p.degree === Number(degree))
    && (!tiers.size || tiers.has(p.tier))
    && (!rarities.size || (p.rarity && rarities.has(p.rarity.key)))
    && (!q || p.haystack.includes(q)));
}

// ── 2. Kingmakers ───────────────────────────────────────────────────────────

/**
 * Your connections by the S and A people in their circle: the doors with the
 * most power behind them. A title says what someone holds; a circle says what
 * they can open, so a B-tier connection can top this.
 * @returns {{ list: [{ row, size, S, A, SA, share }], scanned, source }}
 */
export function kingmakers(base) {
  const byId = new Map(base.d1.map((r) => [r.id, r]));
  const list = [];
  for (const [id, rows] of base.circles) {
    const row = byId.get(id);
    if (!row) continue;
    const c = circleOf(base, row);
    list.push({ row, size: c.size, S: c.S, A: c.A, SA: c.S + c.A, share: c.size ? (c.S + c.A) / c.size : 0, tiers: c.tiers, rows });
  }
  list.sort((a, b) => b.SA - a.SA || b.S - a.S || score1(b.row) - score1(a.row) || byName(a.row, b.row));
  return {
    list, scanned: list.length,
    source: `From the ${list.length.toLocaleString('en-US')} circle${list.length === 1 ? '' : 's'} you’ve scanned: the S and A people in each, graded on your curve. Your own connections in a circle aren’t counted.`,
  };
}

// ── 3. Gatekeepers ──────────────────────────────────────────────────────────

/**
 * Who your S and A reach hangs on. An S or A person in your 2nd degree with one
 * way in is credited to the connection who is that way (lib/brokerage.js
 * exclusiveReach, run on the S and A only): lose them and those people drop
 * off your map. The top three's share credits each S and A person evenly to
 * everyone who reaches them, so the three never count anyone twice.
 * @returns {{ list: [{ row, onlySA, onlyS, credit, size }], totalSA, onlySA, onlyShare, top3, top3Share, source }}
 */
export function gatekeepers(base) {
  const saKeys = new Set(base.second.filter((p) => isSA(p.tier)).map((p) => p.key));
  const sKeys = new Set(base.second.filter((p) => p.tier === 'S').map((p) => p.key));
  const saRows = base.degree2.filter((r) => saKeys.has(keyFor(r)));
  const sa = exclusiveReach(saRows, base.d1);
  const s = exclusiveReach(saRows.filter((r) => sKeys.has(keyFor(r))), base.d1);
  const byId = new Map(base.d1.map((r) => [r.id, r]));
  const list = [];
  for (const [id, r] of sa) {
    const row = byId.get(id);
    if (!row) continue;   // a way in the app can't name stays uncredited, never dropped from the totals
    list.push({ row, onlySA: r.only, onlyS: s.get(id)?.only || 0, credit: r.reach, size: (base.circles.get(id) || []).length });
  }
  list.sort((a, b) => b.onlySA - a.onlySA || b.onlyS - a.onlyS || score1(b.row) - score1(a.row) || byName(a.row, b.row));
  const totalSA = saKeys.size;
  const onlySA = base.second.filter((p) => isSA(p.tier) && p.waysIn === 1).length;
  const top3 = [...list].sort((a, b) => b.credit - a.credit || byName(a.row, b.row)).slice(0, 3)
    .map((g) => ({ row: g.row, credit: g.credit, share: pct(g.credit, totalSA) }));
  return {
    list, totalSA, onlySA, onlyShare: pct(onlySA, totalSA), top3, top3Share: top3.reduce((t, g) => t + g.share, 0),
    source: `Ways in seen across your ${base.circles.size.toLocaleString('en-US')} scanned circle${base.circles.size === 1 ? '' : 's'}. `
      + 'For the share, each S and A person is split evenly between the connections who reach them. Every new circle can only add ways in, so these numbers fall as you scan.',
  };
}

// ── 4. Hidden giants ────────────────────────────────────────────────────────

/**
 * S-tier people with one way in: the connection who knows them is the only
 * door you have. Rarity says whether that "one" is LinkedIn's own mutual count
 * or the ways in your scans saw, which can only be a floor.
 * @returns {{ list: [{ row, score, via, from, count }], count, ofS, fromLinkedIn, fromScans, source }}
 */
export function hiddenGiants(base) {
  const S = base.second.filter((p) => p.tier === 'S');
  const list = [];
  for (const p of S) {
    const r = rarityOf(p.person, p.waysIn);
    if (r.key !== 'only') continue;
    list.push({ key: p.key, row: p.person, score: p.score, via: p.routes[0]?.bridge || null, viaId: p.routes[0]?.id ?? null, from: r.from, count: r.count });
  }
  list.sort((a, b) => b.score - a.score || byName(a.row, b.row));
  const fromLinkedIn = list.filter((h) => h.from === 'linkedin').length;
  return {
    list, count: list.length, ofS: S.length, fromLinkedIn, fromScans: list.length - fromLinkedIn,
    source: `Of your ${S.length.toLocaleString('en-US')} S-tier people one step out. ${fromLinkedIn.toLocaleString('en-US')} from the platform’s own mutual count, `
      + `${(list.length - fromLinkedIn).toLocaleString('en-US')} from the ways in your scans saw, which can only go up.`,
  };
}

// ── 5. Tier × rarity ────────────────────────────────────────────────────────

/** Your 2nd degree by tier and rarity, and how many counts came from LinkedIn and how many from your scans. */
export function tierByRarity(base) {
  const grid = Object.fromEntries(TIERS.map((t) => [t, Object.fromEntries(RARITY_KEYS.map((k) => [k, 0]))]));
  const from = { linkedin: 0, scans: 0 };
  for (const p of base.second) {
    const r = rarityOf(p.person, p.waysIn);
    if (grid[p.tier]) grid[p.tier][r.key]++;
    from[r.from]++;
  }
  return {
    grid, from,
    source: 'Rarity bands: Only way in 1, Rare 2 to 3, Uncommon 4 to 10, Common 11 to 30, Warm 31 or more mutual connections. '
      + `${from.linkedin.toLocaleString('en-US')} counts are the platform’s own, ${from.scans.toLocaleString('en-US')} the ways in your scans saw.`,
  };
}

// ── 6. Untapped ─────────────────────────────────────────────────────────────

/**
 * S and A people in your 2nd degree with no request out, from the one list of
 * requests every view reads (lib/requests-client.js hasRequest, passed in as
 * `asked`).
 * @param asked (row) => boolean
 * @returns {{ S, A, total, asked, askedSA, source }}
 */
export function untapped(base, asked = () => false) {
  let S = 0, A = 0, n = 0, nSA = 0;
  for (const p of base.second) {
    const out = asked(p.person);
    if (out) { n++; if (isSA(p.tier)) nSA++; continue; }
    if (p.tier === 'S') S++;
    else if (p.tier === 'A') A++;
  }
  return {
    S, A, total: S + A, asked: n, askedSA: nSA,
    source: `Requests marked sent in Sixgree: ${n.toLocaleString('en-US')} to people in your 2nd degree. A request sent outside Sixgree isn’t known here.`,
  };
}

// ── 7. The title ladder ─────────────────────────────────────────────────────

// lib/scoring.js LEVELS, grouped into the rungs people say: C-suite and
// founders (and their equals in government and the services), owners, VPs and
// partners, directors, managers, senior individual contributors, entry level.
export const LADDER = [
  { key: 'csuite', label: 'C-suite / Founder', levels: ['csuite', 'govLeader', 'seniorGeneral'] },
  { key: 'owner', label: 'Owner', levels: ['owner'] },
  { key: 'vp', label: 'VP / Partner / GM', levels: ['vp', 'dean', 'govSenior', 'judge', 'general', 'audience10m'] },
  { key: 'director', label: 'Director / Head', levels: ['director', 'professor', 'govOfficial', 'colonel', 'audience1m'] },
  { key: 'manager', label: 'Manager / Lead', levels: ['manager', 'associateProfessor', 'ltColonel', 'seniorEnlisted', 'audience100k'] },
  { key: 'senior', label: 'Senior IC', levels: ['senior', 'assistantProfessor', 'nco', 'major'] },
  { key: 'ic', label: 'IC / Entry', levels: ['ic'] },
  { key: 'unknown', label: 'Title unclear', levels: ['unknown'] },
  { key: 'early', label: 'Intern / Student', levels: ['intern', 'student'] },
];
const RUNG = new Map(LADDER.flatMap((r) => r.levels.map((l) => [l, r.key])));
/** Who decides: the top three rungs. */
export const DECIDES = ['csuite', 'owner', 'vp'];

/**
 * Everyone within two steps by their current title (readTitle: the first
 * current role their headline names), yours and 2nd degree apart.
 * @returns {{ rungs: [{ key, label, d1, d2, total }], decide, decideYours, source }}
 */
export function titleLadder(base) {
  const rungs = new Map(LADDER.map((r) => [r.key, { key: r.key, label: r.label, d1: 0, d2: 0, total: 0 }]));
  const add = (row, d) => {
    const k = RUNG.get(readTitle(row?.headline || '', row?.role || '').key) || 'unknown';
    const r = rungs.get(k);
    r[d]++;
    r.total++;
  };
  for (const row of base.d1) add(row, 'd1');
  for (const p of base.second) add(p.person, 'd2');
  const list = [...rungs.values()];
  const decide = DECIDES.reduce((t, k) => t + rungs.get(k).total, 0);
  const decideYours = DECIDES.reduce((t, k) => t + rungs.get(k).d1, 0);
  return {
    rungs: list, decide, decideYours,
    source: 'Each person’s current title, read from their headline. Headlines are written by the people themselves.',
  };
}

// ── 8. Company power ────────────────────────────────────────────────────────

/**
 * Every company someone within two steps works at now, with the power of
 * everyone there added up, its S and A, and its ways in: your connections
 * there, and each connection whose circle holds someone there (as
 * lib/companies.js waysInto counts them, from the routes already merged).
 *
 * A company's score is the one the people there were scored with (their
 * stored working), else the model's for a company nobody's score is built on.
 * `big` answers "richest?" as far as the app honestly can: the people whose
 * score is built on a company scored TOP_COMPANY (8, Fortune 500 scale) or more.
 * @returns {{ list, count, big: { people, companies }, estimated, source, bigSource }}
 */
export function companyPower(base) {
  const routesOf = new Map(base.second.map((p) => [p.key, p.routes]));
  const rows = [...base.d1, ...base.second.map((p) => p.person)];
  const index = buildCompanyIndex(rows);
  const list = [];
  for (const co of index.values()) {
    let total = 0;
    const via = new Map();
    const scores = new Map();
    let yours = false;
    for (const r of co.people) {
      total += score1(r);
      if (r.degree !== 1) {
        for (const route of routesOf.get(keyFor(r)) || []) {
          if (!route.bridge) continue;
          const v = via.get(route.id) || { bridge: route.bridge, people: 0 };
          v.people++;
          via.set(route.id, v);
        }
      }
      const w = readWorking(r);
      if (w.company === co.name && w.companyScore != null) {
        scores.set(w.companyScore, (scores.get(w.companyScore) || 0) + 1);
        if (w.yours) yours = true;
      }
    }
    const stored = [...scores.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0])[0]?.[0];
    const model = companyScore(co.name, { headcount: co.people.length, industry: co.industry.key });
    const source = yours ? 'yours' : ['known', 'data'].includes(model.source) ? model.source : 'estimate';
    const bridges = [...via.values()].sort((a, b) => b.people - a.people || compareBridges(a.bridge, b.bridge));
    list.push({
      name: co.name, people: co.people.length, d1: co.d1, d2: co.d2, S: co.S, A: co.A, total: Math.round(total * 10) / 10,
      waysIn: co.d1 + via.size, bridges, industry: co.industry, score: stored ?? model.score, scoreSource: source,
    });
  }
  list.sort((a, b) => b.total - a.total || b.S - a.S || a.name.localeCompare(b.name));
  // "Richest?": the people whose score rests on a big company, and those companies.
  const bigNames = new Set();
  let bigPeople = 0;
  for (const r of rows) {
    if (!(Number(r.company_prestige_score) >= TOP_COMPANY)) continue;
    bigPeople++;
    const name = readWorking(r).company || currentCompany(r);
    if (name) bigNames.add(name);
  }
  const estimated = list.filter((c) => c.scoreSource === 'estimate').length;
  return {
    list, count: list.length, big: { people: bigPeople, companies: bigNames.size }, estimated,
    source: 'Total power adds up everyone within two steps who works there now, each once. '
      + `${estimated.toLocaleString('en-US')} of ${list.length.toLocaleString('en-US')} company scores are estimated from how many of your people work there: no list knows them and you haven’t scored them.`,
    bigSource: 'Company scale comes from the curated list and the public company dataset: 8 is Fortune 500 scale, about $20B or 20,000 staff. Scores you set count too.',
  };
}

// ── 9. Industries ───────────────────────────────────────────────────────────

/**
 * The companies by industry (each company's one industry, as scoring has it):
 * people, S and A, power added up, and each industry's share of your S and A.
 * @param companies companyPower(base), so the index is built once
 */
export function industries(companies) {
  const by = new Map();
  for (const c of companies.list) {
    const k = c.industry.key;
    const e = by.get(k) || { key: k, label: c.industry.label, color: industryByKey(k).color, people: 0, S: 0, A: 0, total: 0, companies: 0 };
    e.people += c.people; e.S += c.S; e.A += c.A; e.total += c.total; e.companies++;
    by.set(k, e);
  }
  const list = [...by.values()].map((e) => ({ ...e, total: Math.round(e.total) }))
    .sort((a, b) => (b.S + b.A) - (a.S + a.A) || b.total - a.total || a.label.localeCompare(b.label));
  const SA = list.reduce((t, e) => t + e.S + e.A, 0);
  for (const e of list) e.share = pct(e.S + e.A, SA);
  return {
    list, SA,
    source: 'Industry is inferred from company names, then from what most people there say in their headlines. Unclear stays unclear.',
  };
}

// ── 10. Coverage ────────────────────────────────────────────────────────────

/**
 * What's scanned and what's left: your connections' circles as scanned,
 * hidden (they keep their list private) or not yet, by tier; how far each
 * scanned list was read (the scanner's notes, lib/reach.js); and the strongest
 * circles not scanned yet, with what scanning them asks of LinkedIn
 * (circleScanCost: one profile view and at most 100 searches each).
 * @param {{ daily?: number, pace?: string, next?: number }} opts your daily search budget and speed, when known
 */
export function coverage(base, { daily = SAFE_LIMITS.daily, pace = 'fast', next = 5 } = {}) {
  const counts = { scanned: 0, hidden: 0, todo: 0 };
  const byTier = Object.fromEntries(TIERS.map((t) => [t, { scanned: 0, hidden: 0, todo: 0, total: 0 }]));
  const lists = { full: 0, partial: 0, unknown: 0 };
  const todo = [];
  for (const row of base.d1) {
    const state = circleState(row, base.reach);
    counts[state]++;
    const t = byTier[row.tier];
    if (t) { t[state]++; t.total++; }
    if (state === 'todo') todo.push(row);
    if (state !== 'scanned') continue;
    const list = row.profile_url ? base.reach.lists?.get(keyFor(row)) : null;
    if (!list) lists.unknown++;
    else if (list.more) lists.partial++;
    else lists.full++;
  }
  todo.sort((a, b) => score1(b) - score1(a) || byName(a, b));
  const each = circleScanCost(100, pace);
  const strongest = todo.slice(0, next);
  const searches = each.searches * strongest.length;
  const sizes = [...base.circles.values()].map((rows) => rows.length).sort((a, b) => a - b);
  const budget = Math.max(1, Number(daily) || SAFE_LIMITS.daily);
  return {
    ...counts, total: base.d1.length, byTier, lists, strongest, each,
    nextSearches: searches, nextDays: Math.ceil(searches / budget), daily: budget,
    todoS: byTier.S.todo, todoSA: byTier.S.todo + byTier.A.todo,
    perCircle: counts.scanned ? Math.round(base.second.length / counts.scanned) : 0,
    medianCircle: sizes.length ? sizes[Math.floor(sizes.length / 2)] : 0,
    source: `Each circle is one profile view and at most ${each.searches} searches, about ${each.minutes} minutes; most lists end sooner. `
      + 'How far each list was read is the scanner’s own note; circles scanned before it kept one say “not recorded”.',
  };
}

// ── 11. How sure ────────────────────────────────────────────────────────────

/**
 * How much of the ranking rests on a guess (lib/score-guess.js): a headline
 * with no title the rules read, or a company no list knows and you haven't
 * scored. And the biggest tie, since a guessed company score is why so many
 * people share one number.
 * @param index powerIndex(base)
 */
export function howSure(index) {
  const g = { title: 0, company: 0, both: 0, never: 0, guessed: 0 };
  for (const p of index.people) {
    const why = scoreGuess(p.row);
    if (!why) continue;
    g.guessed++;
    if (why.never) g.never++;
    else if (why.title && why.company) g.both++;
    else if (why.title) g.title++;
    else g.company++;
  }
  // The highest score many people share (what decides the top of the table), and the biggest tie anywhere.
  const top = index.bands[0] || null;
  const biggest = [...index.bands].sort((a, b) => b.count - a.count || b.score - a.score)[0] || null;
  return {
    ...g, total: index.total, share: pct(g.guessed, index.total),
    tie: top ? { score: top.score, count: top.count, rank: top.rank } : null,
    biggest: biggest ? { score: biggest.score, count: biggest.count } : null,
    source: 'A score is a guess when the headline names no title the app can read, or a company no list knows and you haven’t scored. Scoring the companies you know on the Scores tab firms them up.',
  };
}

// ── 12. Reach and tiers, for the report's opening ───────────────────────────

/** How many people within two steps, by degree and tier, each once. */
export function reachSummary(base) {
  const d1 = zeroTiers(), d2 = zeroTiers();
  for (const r of base.d1) if (d1[r.tier] !== undefined) d1[r.tier]++;
  for (const p of base.second) if (d2[p.tier] !== undefined) d2[p.tier]++;
  const rowsSeen = base.degree2.filter((r) => !base.yours.has(keyFor(r))).length;
  return {
    d1: base.d1.length, d2: base.second.length, d3: base.d3.length, total: base.d1.length + base.second.length,
    circles: base.circles.size, tiers: { d1, d2 }, sharedRows: Math.max(0, rowsSeen - base.second.length),
    source: 'Each person counted once, at their nearest degree. Someone two of your connections know counts once.',
  };
}

/** The share of a list, as a whole percent, for the page's words. */
export const percent = (part, whole) => Math.round(pct(part, whole));
