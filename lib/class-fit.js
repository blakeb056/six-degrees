// Class worth (spec sections 3 and 7): what someone is worth to this user's
// goal, as a utility u over the features in lib/class-presets.js, then
//
//   V = min(V_MAX, exp(rho x (u - u_S)))       1.0 means "just makes class S"
//
// and class tiers by share of the pool (top 3% S, the next 12% A, ...), with
// Never vetoes and, once the user has said "neither" or "both great" often
// enough, floors from the outside option. The network tier and the power
// score are never read here and never changed: they are the other axis.
//
// The work runs on "facts": what scoring already read about a person (their
// roles, the company their score rests on and where its score came from, the
// industry, the place their card showed, followers), plus a few counts of
// structure (ways in, ties, exclusive reach). A card in This or That is facts
// too, made up or real (lib/duel-deck.js), so a card and a person score
// through exactly one function, featuresOf.
//
// Never read: a name, a photo, the stored power score or circle bonuses (they
// would count the network axis twice), mutual counts (they say who will say
// yes, not who you want), and any place not actually read off a card.
//
// Plain functions; the server's rescoring (lib/class-rescore.js), the This or
// That deck and tests/classes.test.mjs all call them.

import {
  FEATURES, FEATURE_INDEX as I, D, PRESETS, SEAT_GAP, COMPANY_KAPPA, ROLE_CHIPS, FUNCTIONS, CLASS_SHARES, V_MAX,
  FLOORS, FLOOR_ANSWERS, BLOCKS, classByKey, U0,
} from './class-presets.js';
import { rankedPoints, FORMER_WEIGHT, STUDENT_CAP, followersOf, LEVELS } from './scoring.js';
import { industryKeyOf } from './companies.js';
import { isRecruiter, cityOf } from './breach.js';

const clip = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
const lower = (s) => String(s ?? '').toLowerCase();

// ── Reading a headline for a class ───────────────────────────────────────────

const FOUNDER = /\b(co-?founder|founder)\b/;
const OWNER = /\b(owner|proprietor)\b/;
const PRODUCT_OWNER = /\bproduct owner\b/;
const INVESTOR = /\b(angel investor|investor|venture capital(ist)?|vc|general partner|venture partner|limited partner)\b(?! relations)|\bpartner\b.*\b(ventures|capital|fund)\b/;
const ACCELERATOR = /\b(y ?combinator|yc ?[wsfx]?\d{0,2}|techstars|500 (startups|global)|accelerator)\b|\(yc\)/;
const HIRING = /(#hiring|\bwe('| a)re hiring\b|\bnow hiring\b|\bhiring\b(?!\s+manager))/;
const OPEN_TO_WORK = /(#opentowork|\bopen to work\b|\bseeking (new )?(opportunities|roles?|a role|my next)\b|\blooking for (new )?(opportunities|roles?|my next)\b|\bactively looking\b|\bbetween roles\b)/;
const SELLS = /\b(i help|we help|helping (businesses|companies|brands|founders|you|teams))\b/;

/** The function family a title or headline names (lib/class-presets.js FUNCTIONS), or null. */
export function functionOf(text) {
  const t = lower(text);
  for (const f of FUNCTIONS) if (f.words.test(t)) return f.key;
  return null;
}

/** The text of one role's title, without the company: "VP of Marketing" from "VP of Marketing at Acme". */
export function titleText(part = '', company = '') {
  let t = String(part || '').replace(/^\s*(ex[-\s]|former(ly)?\s+|previously\s+)/i, '');
  t = t.split(/\s+(?:at|@)\s+|\s*@\s*/i)[0];
  if (company) {
    const c = String(company).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    t = t.replace(new RegExp(`[,|-]?\\s*${c}\\s*$`, 'i'), '');
  }
  return t.replace(/\s+/g, ' ').replace(/[,|·-]\s*$/, '').trim();
}

const STUDENT_KEYS = new Set(['student', 'intern']);
const MANAGER_KEYS = new Set(['manager', 'director']);

/** A role's points as the soft seat reads them: your title ranking, 70% for a former role, capped for a student. */
function seatPoints(role, student, titles) {
  const p = rankedPoints(role, titles) * (role.former ? FORMER_WEIGHT : 1);
  return student ? Math.min(p, STUDENT_CAP) : p;
}

/**
 * The multi-hat seat (spec 3.3): a soft maximum over current roles,
 * s = tau ln sum exp(s_r / tau), tau 0.5, each role's s_r = (points - 5) / 2.5
 * (an IC -0.4, a director 1.0, a VP 1.6, a founder 2.0). One role is that
 * role; two equal roles add tau ln 2 (about 0.35); five weak hats can't beat
 * one strong one. A former role counts at 70%, as in the power score.
 */
export function softSeat(roles = [], { student = false, titles = null, tau = 0.5 } = {}) {
  const seats = roles.filter((r) => !r.audience).map((r) => (seatPoints(r, student, titles) - 5) / 2.5);
  if (!seats.length) return (LEVELS.unknown.points - 5) / 2.5;
  const top = Math.max(...seats);
  return top + tau * Math.log(seats.reduce((s, v) => s + Math.exp((v - top) / tau), 0));
}

// ── Facts ────────────────────────────────────────────────────────────────────

/**
 * What class scoring needs to know about one row, from what scoring already
 * read: `person` is lib/scoring.js readPerson(row), `scored` its scorePerson(),
 * `companies` readNetwork()'s companies. Structure (`waysIn`, `ties`,
 * `exclusive`) is filled in by the caller, who sees the whole network.
 */
export function personFacts(row, { person, scored, companies = new Map(), titles = null } = {}) {
  const roles = person?.roles || [];
  const student = Boolean(person?.student) || STUDENT_KEYS.has(scored?.title?.key);
  const company = scored?.company || null;
  const c = company ? companies.get(company) : null;
  const best = roles.find((r) => r.company === company && !r.audience) || roles.find((r) => !r.former && !r.audience) || roles[0] || null;
  const text = lower(row?.headline || row?.role || '');
  return {
    id: row?.id ?? null,
    url: row?.profile_url ?? null,
    degree: Number(row?.degree) || 1,
    bridge: row?.source_connection_id ?? null,
    ties: row?.seen_via === 'ties',
    // For the class tab's lists and the reveal only (names are fine there);
    // never on a This or That card.
    name: row?.name ?? null,
    headline: row?.headline ?? null,
    photo: row?.profile_image_url ?? null,
    requested: row?.outreach_status === 'sent' || row?.unlock_status === 'pending',
    tier: row?.tier ?? null,
    power: Number(row?.power_score) || 0,
    seat: softSeat(roles, { student, titles }),
    key: scored?.title?.key || best?.title?.key || 'unknown',
    level: Number(scored?.title?.level ?? best?.title?.level ?? 1),
    former: Boolean(scored?.title?.former),
    title: best ? titleText(best.part, best.company) : '',
    text,
    func: functionOf(best ? `${best.part}` : text) || functionOf(text),
    company: company ? {
      name: company,
      score: Number(scored?.companySector?.base ?? scored?.companyScore ?? 5),
      source: scored?.companySource || 'default',
    } : { name: null, score: 5, source: 'none' },
    industry: c?.industry && c.industry !== 'unknown' ? c.industry : (industryKeyOf(company, row?.headline || '') !== 'unknown' ? industryKeyOf(company, row?.headline || '') : null),
    sectors: [...(c?.sectors || []), ...(c?.sectorIndustries || [])],
    current: roles.filter((r) => !r.former && r.company).map((r) => lower(r.company)),
    past: roles.filter((r) => r.former && r.company).map((r) => lower(r.company)),
    location: typeof row?.location === 'string' && row.location.trim() ? row.location.trim() : null,
    followers: followersOf(row),
    reach: person?.reach?.reasons || [],
    student,
    waysIn: 0,
    exclusive: 0,
  };
}

/**
 * Structure for every row at once: ways in (how many bridges show a 2nd-degree
 * person), ties (a 1st-degree person's mutual-web ties, `tieCount(url)`), and
 * a bridge's exclusive reach (people in their circle no other bridge shows).
 * Used only by the Cartographer's preset; it never reaches a card.
 */
export function addStructure(facts = [], { tieCount = () => 0 } = {}) {
  const bridgesOf = new Map();
  for (const f of facts) {
    if (f.degree !== 2 || !f.bridge || !f.url || f.ties) continue;
    const s = bridgesOf.get(f.url) || new Set();
    s.add(f.bridge);
    bridgesOf.set(f.url, s);
  }
  const exclusive = new Map();
  for (const set of bridgesOf.values()) {
    if (set.size !== 1) continue;
    const [b] = set;
    exclusive.set(b, (exclusive.get(b) || 0) + 1);
  }
  for (const f of facts) {
    if (f.degree === 2) f.waysIn = bridgesOf.get(f.url)?.size || 0;
    else if (f.degree === 1) {
      f.waysIn = Number(tieCount(f.url)) || 0;
      f.exclusive = exclusive.get(f.id) || 0;
    }
  }
  return facts;
}

// ── Where you are, from the places that were read ────────────────────────────

const norm = (s) => lower(s).normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();

/** A location text's parts: { city, region, country }, each normalised, or nulls. Only what the text says. */
export function placeParts(text) {
  if (!text) return { city: null, region: null, country: null };
  const parts = String(text).split(',').map((p) => p.trim()).filter(Boolean);
  const city = norm(cityOf(text)) || null;
  if (parts.length >= 3) return { city, region: norm(parts[1]) || null, country: norm(parts[parts.length - 1]) || null };
  if (parts.length === 2) return { city, region: norm(parts[1]) || null, country: null };
  return { city, region: null, country: null };
}

/**
 * Your place for the class: the city you typed (or the guess it was
 * prefilled with), with its region and country taken from your own
 * connections whose cards read that city, when the text didn't say.
 */
export function homePlace(text, locations = []) {
  const own = placeParts(text);
  if (!own.city) return null;
  if (own.region && own.country) return own;
  const counts = new Map();
  for (const loc of locations) {
    const p = placeParts(loc);
    if (p.city !== own.city || !p.region) continue;
    const k = `${p.region}|${p.country || ''}`;
    counts.set(k, (counts.get(k) || 0) + 1);
  }
  let best = null;
  for (const [k, n] of counts) if (!best || n > best.n) best = { k, n };
  if (!best) return own;
  const [region, country] = best.k.split('|');
  return { city: own.city, region: own.region || region || null, country: own.country || country || null };
}

/**
 * A guess at your city, until you name it: the place most of your own
 * connections' cards read (as one of them wrote it, so its region comes too),
 * when at least 3 do. A guess about you, never about them, and the page says so.
 */
export function homeGuess(facts = []) {
  const counts = new Map();
  for (const f of facts) {
    if (f.degree !== 1 || !f.location) continue;
    const city = norm(cityOf(f.location));
    if (!city) continue;
    const c = counts.get(city) || { n: 0, texts: new Map() };
    c.n += 1;
    c.texts.set(f.location, (c.texts.get(f.location) || 0) + 1);
    counts.set(city, c);
  }
  let best = null;
  for (const c of counts.values()) if (!best || c.n > best.n) best = c;
  if (!best || best.n < 3) return '';
  return [...best.texts].sort((a, b) => b[1] - a[1] || b[0].split(',').length - a[0].split(',').length)[0][0];
}

/** How near a read place is to yours: 'local', 'region', 'country', 'abroad', or null (nothing read, or no home). */
export function placeBand(location, home) {
  if (!location || !home?.city) return null;
  const p = placeParts(location);
  if (p.city && p.city === home.city) return 'local';
  if (p.region && home.region && p.region === home.region) return 'region';
  if (p.country && home.country) return p.country === home.country ? 'country' : 'abroad';
  return null;
}

// ── Features ─────────────────────────────────────────────────────────────────

/** A robust centre and scale for heavy-tailed counts, on ln(1 + x) (spec 3.2). */
export function robustScale(values = []) {
  const v = values.filter(Number.isFinite).map((x) => Math.log1p(Math.max(0, x))).sort((a, b) => a - b);
  if (!v.length) return { median: 0, scale: 1 };
  const median = v[Math.floor(v.length / 2)];
  const dev = v.map((x) => Math.abs(x - median)).sort((a, b) => a - b);
  let scale = 1.4826 * dev[Math.floor(dev.length / 2)];
  if (!(scale > 1e-9)) {
    const mean = v.reduce((s, x) => s + x, 0) / v.length;
    scale = Math.sqrt(v.reduce((s, x) => s + (x - mean) ** 2, 0) / v.length);
  }
  return { median, scale: scale > 1e-9 ? scale : 1 };
}

const z = (x, { median, scale }) => clip((Math.log1p(Math.max(0, x)) - median) / scale, -3, 3);

/**
 * What every feature is for one person or card, given the class's setup:
 * `env` is classEnv()'s. Missing values are 0: a missing place, follower
 * count or company says how far the scanner has read, not what anyone wants.
 */
export function featuresOf(f, env) {
  const x = new Float64Array(D);
  const t = f.text || lower(f.title);
  x[I.seat] = clip(Number(f.seat) || 0, -2, 2.5);
  const founder = FOUNDER.test(t);
  x[I.founder] = founder ? 1 : 0;
  x[I.owner] = f.key === 'owner' || (OWNER.test(t) && !PRODUCT_OWNER.test(t)) ? 1 : 0;
  x[I.investor] = INVESTOR.test(t) ? 1 : 0;
  x[I.accelerator] = ACCELERATOR.test(t) ? 1 : 0;
  x[I.recruiter] = isRecruiter(t) ? 1 : 0;
  x[I.manager] = MANAGER_KEYS.has(f.key) ? 1 : 0;
  x[I.targetRole] = matchesRole(f, env) ? 1 : 0;
  x[I.hiring] = HIRING.test(t) ? 1 : 0;
  x[I.openToWork] = OPEN_TO_WORK.test(t) ? 1 : 0;
  x[I.sells] = SELLS.test(t) ? 1 : 0;
  x[I.student] = f.student || STUDENT_KEYS.has(f.key) ? 1 : 0;

  const co = f.company || { score: 5, source: 'none' };
  x[I.prestige] = clip(((Number(co.score) || 5) - 5) / 5, -1, 1);
  x[I.recognised] = co.source === 'known' || co.source === 'data' || (co.source === 'yours' && co.score >= 7) ? 1 : 0;
  x[I.startup] = (founder || f.key === 'csuite' || f.key === 'owner') && (co.source === 'default' || co.source === 'none') ? 1 : 0;
  const target = f.target ?? targetEmployment(f, env);
  x[I.targetCurrent] = target === 'current' ? 1 : 0;
  x[I.targetAlumni] = target === 'alumni' ? 1 : 0;

  const sectors = env.sectors || [];
  x[I.targetSector] = sectors.length && (sectors.includes(f.industry) || (f.sectors || []).some((s) => sectors.includes(s))) ? 1 : 0;
  if (f.industry && I[`ind:${f.industry}`] != null) x[I[`ind:${f.industry}`]] = 1;

  const band = f.placeBand !== undefined ? f.placeBand : placeBand(f.location, env.home);
  x[I.sameMetro] = band === 'local' ? 1 : 0;
  x[I.sameRegion] = band === 'region' ? 1 : 0;

  x[I.followers] = f.followers == null ? 0 : z(f.followers, env.followerScale || { median: 0, scale: 1 });
  x[I.recognition] = (f.reach || []).some((r) => r === 'recognition' || r === '30 under 30' || r === 'reach in the millions') ? 1 : 0;
  x[I.waysIn] = f.waysIn ? z(f.waysIn, env.waysScale || { median: 0, scale: 1 }) : 0;
  x[I.brokerage] = f.exclusive ? z(f.exclusive, env.brokerScale || { median: 0, scale: 1 }) : 0;
  return x;
}

/** Does this person match one of the S2 role chips the user picked (words in the title, or the function)? */
function matchesRole(f, env) {
  const chips = env.roleChips || [];
  if (!chips.length) return false;
  const t = ` ${lower(f.title || f.text)} `;
  return chips.some((c) => (c.func && f.func === c.func) || (c.words || []).some((w) => new RegExp(`(^|[^a-z0-9])${w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}($|[^a-z0-9])`).test(t)));
}

/** At one of the target companies now ('current'), before ('alumni'), or neither (null). */
export function targetEmployment(f, env) {
  const targets = env.targets || [];
  if (!targets.length) return null;
  if ((f.current || []).some((c) => targets.includes(c))) return 'current';
  if ((f.past || []).some((c) => targets.includes(c))) return 'alumni';
  return null;
}

/**
 * The per-person constant beside the learned weights (spec 3.3): your own
 * company scores as evidence (kappa per point from 5), a "Less" company chip,
 * and the Infiltrator's seat gap, best d* levels above you.
 */
export function offsetOf(f, env) {
  let o = 0;
  const co = f.company || {};
  if (co.source === 'yours') o += COMPANY_KAPPA * ((Number(co.score) || 5) - 5);
  if (co.name && env.lessCompanies?.has(lower(co.name))) o -= 1;
  const gap = SEAT_GAP[env.classKey];
  if (gap && env.userLevel != null) o -= gap.weight * ((Number(f.level) || 1) - env.userLevel - gap.peak) ** 2;
  return o;
}

// ── The class's setting ──────────────────────────────────────────────────────

/**
 * Everything featuresOf needs beyond a person: the class, the S2 answers
 * (target sectors, role chips, companies, your city), your own seat when you
 * gave your role, and the network's scales for heavy-tailed counts.
 * `build` is one class's saved build (lib/class-goals.js).
 */
export function classEnv(facts = [], build = {}, { breachTargets = [], userLevel = null, homeGuess = '' } = {}) {
  const classKey = build.class || null;
  const setup = build.setup || {};
  const chips = (ROLE_CHIPS[classKey] || []).filter((c) => (setup.roles || []).includes(c.key));
  const targets = [...new Set([...(setup.targets || []), ...(classKey === 'infiltrator' ? breachTargets : [])]
    .map((t) => lower(String(t).trim())).filter(Boolean))];
  const firstLocations = facts.filter((f) => f.degree === 1 && f.location).map((f) => f.location);
  const home = homePlace(setup.city || homeGuess || '', firstLocations);
  const pool = facts.filter(inPool);
  const avoid = build.avoid || [];
  return {
    classKey,
    sectors: setup.sectors || [],
    roleChips: chips,
    targets,
    home,
    userLevel,
    lessCompanies: new Set(avoid.filter((a) => a.strength === 'less' && String(a.key).startsWith('co:')).map((a) => lower(a.key.slice(3)))),
    followerScale: robustScale(pool.map((f) => f.followers).filter((v) => v != null)),
    waysScale: robustScale(pool.map((f) => f.waysIn).filter((v) => v > 0)),
    brokerScale: robustScale(pool.map((f) => f.exclusive).filter((v) => v > 0)),
  };
}

/** The pool tiers are cut on: your 1st and 2nd degree, each person once. Company scans (degree 3) never move a cut-off. */
export const inPool = (f) => (f.degree === 1 || f.degree === 2) && !f.ties;

/** Your seat when you said your role (S2's "about you"), for the Infiltrator's seat gap: a level 0..6, or null. */
export function levelOfRole(role, readTitle) {
  if (!role || !readTitle) return null;
  const t = readTitle(String(role));
  return t?.key && t.key !== 'unknown' ? Number(t.level) : null;
}

// ── Scoring a network for a class ────────────────────────────────────────────

/** The weights a build scores with: its posterior mean, else the class preset. Length D. */
export function weightsOf(build) {
  const w = new Float64Array(D);
  const saved = build?.weights;
  if (saved && typeof saved === 'object') {
    for (const f of FEATURES) w[f.i] = Number(saved[f.key]) || 0;
    return w;
  }
  const preset = PRESETS[build?.class] || {};
  for (const f of FEATURES) w[f.i] = Number(preset[f.key]) || 0;
  return w;
}

/** u for every row of features. */
export function utilities(xs, w, offsets) {
  return xs.map((x, k) => {
    let s = offsets ? offsets[k] : 0;
    for (let i = 0; i < D; i++) s += w[i] * x[i];
    return s;
  });
}

/**
 * Where each class tier starts on the pool's utilities: the last person
 * inside each share, people tied at a cut-off all in or all out, whichever
 * lands nearer the share (the network curve's rule, lib/scoring.js curveCutoffs).
 */
export function shareCutoffs(values = []) {
  const best = values.filter(Number.isFinite).sort((a, b) => b - a);
  if (!best.length) return null;
  const cut = {};
  for (const [tier, share] of CLASS_SHARES) {
    const k = Math.max(1, Math.round(best.length * share));
    const at = best[k - 1];
    let through = 0;
    let above = 0;
    for (const p of best) { if (p >= at) through += 1; if (p > at) above += 1; }
    cut[tier] = above === 0 || through - k <= k - above ? at : best[above - 1];
  }
  return cut;
}

/** A person's Never: a chip they match (a feature, an industry, a company), or a person you vetoed. */
export function isNever(f, x, build) {
  if ((build?.nevers || []).includes(f.url)) return true;
  for (const a of build?.avoid || []) {
    if (a?.strength !== 'never') continue;
    const key = String(a.key);
    if (key.startsWith('co:')) {
      if (f.company?.name && lower(f.company.name) === lower(key.slice(3))) return true;
      continue;
    }
    const i = I[key];
    if (i != null && x[i] > 0) return true;
  }
  return false;
}

/** How many "neither" and "both great" answers a build has: the floors switch on at FLOOR_ANSWERS. */
export const outsideAnswers = (build) => (build?.answers || []).filter((a) => a.choice === 'neither' || a.choice === 'both').length;

/**
 * Score every row for a build: { results: Map id → { u, v, tier, why, never },
 * cutoffs, uS, counts, pool }. Tiers are cut on the pool's shares; a Never is
 * class D; once the floors are on, S needs u - u0 >= ln 9 and A u - u0 >= 0.85.
 */
export function scoreClass(facts = [], build = {}, env = classEnv(facts, build)) {
  const w = weightsOf(build);
  const rho = Number(build?.dials?.rho ?? classByKey(build?.class)?.rho ?? 1);
  const xs = facts.map((f) => featuresOf(f, env));
  const offsets = facts.map((f) => offsetOf(f, env));
  const u = utilities(xs, w, offsets);
  const never = facts.map((f, k) => isNever(f, xs[k], build));
  // Each person once (their first row), and Nevers out of the cut-offs.
  const seen = new Set();
  const poolIdx = [];
  facts.forEach((f, k) => {
    if (!inPool(f) || never[k]) return;
    const key = f.url || `id:${f.id}`;
    if (seen.has(key)) return;
    seen.add(key);
    poolIdx.push(k);
  });
  const cutoffs = shareCutoffs(poolIdx.map((k) => u[k]));
  const uS = cutoffs ? cutoffs.S : 0;
  const floors = outsideAnswers(build) >= FLOOR_ANSWERS && Number.isFinite(build?.u0) ? build.u0 : null;
  const results = new Map();
  const counts = { S: 0, A: 0, B: 0, C: 0, D: 0 };
  const counted = new Set();
  facts.forEach((f, k) => {
    let tier = 'D';
    if (!never[k] && cutoffs) {
      if (u[k] >= cutoffs.S) tier = 'S';
      else if (u[k] >= cutoffs.A) tier = 'A';
      else if (u[k] >= cutoffs.B) tier = 'B';
      else if (u[k] >= cutoffs.C) tier = 'C';
      if (floors != null) {
        if (tier === 'S' && u[k] - floors < FLOORS.S) tier = 'A';
        if (tier === 'A' && u[k] - floors < FLOORS.A) tier = 'B';
      }
    }
    const v = Math.min(V_MAX, Math.exp(rho * (u[k] - uS)));
    results.set(f.id, { u: u[k], v, tier, never: never[k], why: whyLine(xs[k], w, offsets[k]) });
    const key = f.url || `id:${f.id}`;
    if (inPool(f) && !counted.has(key)) { counted.add(key); counts[tier] += 1; }
  });
  return { results, cutoffs, uS, counts, xs, offsets, u, poolIdx, floors: floors != null };
}

/** The three largest terms in someone's class worth, in words: "Founders +, Tech, Software & AI +, Students −". */
export function whyLine(x, w, offset = 0) {
  const terms = [];
  for (const f of FEATURES) {
    const t = w[f.i] * x[f.i];
    if (Math.abs(t) >= 0.15) terms.push({ label: f.label, t });
  }
  if (Math.abs(offset) >= 0.15) terms.push({ label: offset > 0 ? 'Your company score' : 'Pushed down', t: offset });
  return terms.sort((a, b) => Math.abs(b.t) - Math.abs(a.t)).slice(0, 3).map((a) => `${a.label} ${a.t > 0 ? '+' : '−'}`).join(', ');
}

// ── The build, in words and bars ─────────────────────────────────────────────

const percentile = (sorted, q) => (sorted.length ? sorted[Math.min(sorted.length - 1, Math.max(0, Math.round(q * (sorted.length - 1))))] : 0);

/**
 * The five build bars (spec 6.11): each block's conjoint importance, the
 * spread of its score across your network (99th minus 1st percentile) over
 * the sum of all five. Honest about your data: if almost nobody has a place
 * read, Place can't matter much, and its bar says so.
 */
export function buildBars(xs = [], w, { offsets = null, sample = 6000 } = {}) {
  const step = Math.max(1, Math.floor(xs.length / sample));
  const spread = {};
  for (const b of BLOCKS) {
    const vals = [];
    for (let k = 0; k < xs.length; k += step) {
      let s = 0;
      for (const f of FEATURES) if (f.block === b.key) s += w[f.i] * xs[k][f.i];
      if (b.key === 'company' && offsets) s += offsets[k];
      vals.push(s);
    }
    vals.sort((a, c) => a - c);
    spread[b.key] = Math.max(0, percentile(vals, 0.99) - percentile(vals, 0.01));
  }
  const total = Object.values(spread).reduce((s, v) => s + v, 0);
  return BLOCKS.map((b) => ({ key: b.key, label: b.label, share: total > 0 ? spread[b.key] / total : 0.2 }));
}

/**
 * The strongest weights in words: the largest first, likes and push-downs,
 * only for features someone in your network actually has (a weight on
 * nobody moves nobody). [{ key, label, sign, weight }].
 */
export function topWeights(xs = [], w, { count = 5 } = {}) {
  const out = [];
  for (const f of FEATURES) {
    let any = 0;
    for (let k = 0; k < xs.length; k++) if (xs[k][f.i]) { any += 1; if (any > 2) break; }
    if (!any && xs.length) continue;
    if (Math.abs(w[f.i]) < 0.2) continue;
    out.push({ key: f.key, label: f.label, sign: w[f.i] > 0 ? 1 : -1, weight: Math.round(w[f.i] * 100) / 100 });
  }
  return out.sort((a, b) => Math.abs(b.weight) - Math.abs(a.weight)).slice(0, count);
}

// ── The card backs: live counts from your own network ───────────────────────

/**
 * What each class's card says on its back (S1): a count from your own
 * network, how it was counted, and the gap the class would fix. Pool people,
 * each once. `xs` are featuresOf for the same facts under a neutral env.
 */
export function classCounts(facts = [], { home = null, breachTargets = [], ties = 0 } = {}) {
  const seen = new Set();
  const people = facts.filter((f) => {
    if (!inPool(f)) return false;
    const k = f.url || `id:${f.id}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  const has = (re) => (f) => re.test(f.text || '');
  const count = (pred) => {
    let n = 0;
    let first = 0;
    for (const f of people) if (pred(f)) { n += 1; if (f.degree === 1) first += 1; }
    return { n, first };
  };
  const founders = count(has(FOUNDER));
  const investors = count((f) => INVESTOR.test(f.text || '') || ACCELERATOR.test(f.text || ''));
  const recruiters = count((f) => isRecruiter(f.text || ''));
  const owners = count((f) => f.key === 'owner' || (f.startup ?? ((FOUNDER.test(f.text || '') || f.key === 'csuite') && ['default', 'none'].includes(f.company?.source))));
  const local = home?.city ? count((f) => placeBand(f.location, home) === 'local') : null;
  const targets = breachTargets.map((t) => lower(t));
  const atTargets = targets.length ? count((f) => (f.current || []).some((c) => targets.includes(c))) : null;
  const circles = new Set(facts.filter((f) => f.degree === 2 && f.bridge && !f.ties).map((f) => f.bridge)).size;
  const multi = people.filter((f) => f.degree === 2 && f.waysIn >= 2).length;
  const fmt = (n) => n.toLocaleString('en-US');
  return {
    founder: { n: founders.n, line: `${fmt(founders.n)} founders in your network, ${fmt(founders.first)} you know`, how: 'People whose headline says founder or co-founder.', gap: 'Today a founder at a company Sixgree doesn’t know rarely reaches network S. The Founder lens frees them.' },
    seeker: { n: investors.n, line: `${fmt(investors.n)} investors, VCs, angels and accelerator people`, how: 'Headlines that say investor, VC, partner at a fund, angel, YC or accelerator.', gap: 'Investors rank by their fund’s fame on the network axis; here they rank by fit.' },
    infiltrator: atTargets
      ? { n: atTargets.n, line: `${fmt(atTargets.n)} people at your target companies, ${fmt(atTargets.first)} you know`, how: 'Current roles at the companies you’re breaching.', gap: `And ${fmt(recruiters.n)} recruiters who sit low on the network axis.` }
      : { n: recruiters.n, line: `${fmt(recruiters.n)} recruiters and talent people`, how: 'Headlines that say recruiter, talent or sourcer.', gap: 'Most recruiters sit in network B or C. For a job search they come first.' },
    grower: local
      ? { n: local.n, line: `${fmt(local.first)} people you know in ${home.city.replace(/\b\w/g, (c) => c.toUpperCase())}, ${fmt(local.n - local.first)} found beyond them`, how: 'Locations read off their cards: your city.', gap: 'Growing locally means the people near you, whatever their network tier.' }
      : { n: 0, line: 'Your city, and the people in it', how: 'Name your city next: only places read off cards count.', gap: 'Growing locally means the people near you, whatever their network tier.' },
    poacher: { n: owners.n, line: `${fmt(owners.n)} owners and founders of companies Sixgree doesn’t know`, how: 'Owners, and founders at companies the curated list doesn’t know: most small businesses.', gap: 'The people who buy are rarely network S. Name who you sell to next.' },
    cartographer: { n: multi, line: `${fmt(circles)} circles scanned, ${fmt(multi)} people seen in two or more${ties ? `, ${fmt(ties)} ties` : ''}`, how: 'Circles mapped so far, and people more than one of your connections can reach.', gap: 'Structure first: hidden super-connectors and the people many circles share.' },
  };
}

export { U0 };
