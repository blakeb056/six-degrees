// This or That's cards (spec section 6.5, and Blake's answers in 17): two
// cards side by side, each a position name and a company, or for the Grower a
// kind of person, drawn from the user's own network and mixed with made-up
// composites wherever the network has no good real example or a generic title
// is clearer. "Should mix and use made-up where it would make more sense to
// find titles like that to match" (Blake, 10/17).
//
// What a card never shows: a name or a photo (a silhouette stands in), a tier
// or a power score (they'd anchor answers on today's formula), and anything
// about reachability (mutuals, degree, ways in): that is the acceptance
// model's, and on a card it would make "want" and "can reach" one answer.
//
// A card is attributes (`attrs`), and its features come from exactly the
// attributes it shows (`show`), through lib/class-fit.js featuresOf, the same
// function people are scored with. A card whose title, company and place
// match fewer than 3 real people is coarsened ("a large public company"), so
// a screenshot of onboarding can never identify anyone.
//
// Pairs are chosen by active learning (lib/pairwise.js infoGain) inside each
// round's focus, with the spec's constraints: no repeats, no attribute value
// more than 3 times, no pair the model already finds lopsided, both cards
// above the class prior's 40th percentile except one deliberately low duel
// in Rank and role and in Big name or right fit, a mirrored repeat at duel
// 10, and one pick in 10 at random so the model isn't only tested on what it
// already believes.

import { FEATURES, D, ROUNDS, MODES, DUEL_PROMPT, BLOCKS } from './class-presets.js';
import { featuresOf, inPool, placeBand, targetEmployment } from './class-fit.js';
import { LEVELS } from './scoring.js';
import { INDUSTRIES } from './companies.js';
import { cityOf } from './breach.js';
import { infoGain, seededRandom } from './pairwise.js';

const lower = (s) => String(s ?? '').toLowerCase();
const norm = (s) => lower(s).replace(/[^a-z0-9]+/g, ' ').trim();
const titleCase = (s) => String(s || '').replace(/\b[a-z]/g, (c) => c.toUpperCase());
const sentence = (s) => String(s || '').replace(/^[a-z]/, (c) => c.toUpperCase());
const industryLabel = (key) => INDUSTRIES.find((g) => g.key === key)?.label || null;

// ── The made-up vocabulary ───────────────────────────────────────────────────

/** Generic companies by band: what a coarsened or made-up card's company line says. */
export const GENERIC_COMPANIES = Object.freeze({
  big: Object.freeze({ name: 'a Big Tech company', score: 10, source: 'known', band: 'big', label: 'household name' }),
  major: Object.freeze({ name: 'a large public company', score: 8, source: 'known', band: 'major', label: 'large public company' }),
  known: Object.freeze({ name: 'a well-known company', score: 7, source: 'known', band: 'known', label: 'well-known company' }),
  mid: Object.freeze({ name: 'a growing mid-size company', score: 6, source: 'network', band: 'mid', label: 'mid-size company' }),
  unknown: Object.freeze({ name: 'a startup Sixgree doesn’t know', score: 5, source: 'default', band: 'unknown', label: 'small, unknown to Sixgree' }),
  local: Object.freeze({ name: 'a local business', score: 5, source: 'default', band: 'unknown', label: 'small, local' }),
  fund: Object.freeze({ name: 'a seed fund', score: 5, source: 'default', band: 'unknown', label: 'small fund' }),
  accelerator: Object.freeze({ name: 'an accelerator', score: 7, source: 'known', band: 'known', label: 'accelerator' }),
});

/** A generic title for a seat and a function, for a made-up card. */
const GENERIC_TITLES = {
  csuite: { _: 'Founder & CEO', engineering: 'CTO', marketing: 'Chief Marketing Officer', sales: 'Chief Revenue Officer', finance: 'CFO', operations: 'COO', product: 'Chief Product Officer' },
  owner: { _: 'Owner', realestate: 'Broker-owner', health: 'Practice owner' },
  vp: { _: 'VP of Operations', sales: 'VP of Sales', marketing: 'VP of Marketing', engineering: 'VP of Engineering', product: 'VP of Product', investing: 'Partner, venture capital', finance: 'VP of Finance' },
  director: { _: 'Director of Operations', sales: 'Director of Sales', marketing: 'Head of Growth', engineering: 'Director of Engineering', product: 'Head of Product', recruiting: 'Head of Talent', design: 'Design Director' },
  manager: { _: 'Operations Manager', sales: 'Sales Manager', marketing: 'Marketing Manager', engineering: 'Engineering Manager', product: 'Product Manager', recruiting: 'Recruiting Manager', realestate: 'Property Manager' },
  senior: { _: 'Senior Analyst', engineering: 'Senior Software Engineer', sales: 'Senior Account Executive', design: 'Senior Designer', marketing: 'Senior Marketing Specialist' },
  ic: { _: 'Analyst', engineering: 'Software Engineer', sales: 'Account Executive', recruiting: 'Technical Recruiter', marketing: 'Content Strategist', realestate: 'Realtor', creator: 'Content Creator', health: 'Fitness Coach', education: 'Teacher' },
  intern: { _: 'Marketing Intern', engineering: 'Software Engineering Intern' },
  student: { _: 'Student' },
};
export function genericTitle(key, func) {
  const row = GENERIC_TITLES[key] || GENERIC_TITLES.ic;
  return row[func] || row._;
}

/**
 * Each class's own made-up cards: the kinds of person it hunts, so a network
 * that has none of them still gets a fair question. [title, seat key, function, company band, industry].
 */
export const CLASS_VOCAB = Object.freeze({
  seeker: [
    ['Partner at a seed fund', 'vp', 'investing', 'fund', 'finance'], ['Angel investor', 'vp', 'investing', 'unknown', 'finance'],
    ['Principal, venture capital', 'director', 'investing', 'fund', 'finance'], ['Program director, accelerator', 'director', 'operations', 'accelerator', 'finance'],
    ['Founder & CEO', 'csuite', null, 'unknown', 'tech'], ['VP of Product', 'vp', 'product', 'big', 'tech'],
  ],
  founder: [
    ['Technical co-founder', 'csuite', 'engineering', 'unknown', 'tech'], ['Founding engineer', 'senior', 'engineering', 'unknown', 'tech'],
    ['Founder & CEO', 'csuite', null, 'unknown', 'tech'], ['Head of Product', 'director', 'product', 'mid', 'tech'],
    ['Early employee, operations', 'ic', 'operations', 'unknown', 'tech'], ['VP of Engineering', 'vp', 'engineering', 'big', 'tech'],
  ],
  infiltrator: [
    ['Technical Recruiter', 'ic', 'recruiting', 'major', 'tech'], ['Talent Acquisition Partner', 'senior', 'recruiting', 'major', null],
    ['Engineering Manager', 'manager', 'engineering', 'major', 'tech'], ['Director of Product', 'director', 'product', 'major', 'tech'],
    ['VP of Engineering', 'vp', 'engineering', 'big', 'tech'], ['Software Engineer', 'ic', 'engineering', 'major', 'tech'],
  ],
  poacher: [
    ['Owner', 'owner', null, 'local', 'consumer'], ['Office Manager', 'manager', 'operations', 'local', 'consulting'],
    ['Director of Operations', 'director', 'operations', 'mid', 'industry'], ['Procurement Manager', 'manager', 'operations', 'major', 'industry'],
    ['Broker-owner', 'owner', 'realestate', 'local', 'realestate'], ['Property Manager', 'manager', 'realestate', 'local', 'realestate'],
  ],
  grower: [
    ['Restaurant owner', 'owner', null, 'local', 'consumer'], ['Fitness coach', 'ic', 'health', 'local', 'health'],
    ['Realtor', 'ic', 'realestate', 'local', 'realestate'], ['Content creator', 'ic', 'creator', 'unknown', 'media'],
    ['Local business owner', 'owner', null, 'local', 'consumer'], ['Marketing consultant', 'senior', 'marketing', 'unknown', 'media'],
    ['Nonprofit director', 'director', 'operations', 'unknown', 'nonprofit'], ['Software Engineer', 'ic', 'engineering', 'major', 'tech'],
  ],
  cartographer: [
    ['Community builder', 'director', null, 'unknown', 'nonprofit'], ['Partner at a consulting firm', 'vp', null, 'major', 'consulting'],
    ['Founder & CEO', 'csuite', null, 'unknown', 'tech'], ['Head of Partnerships', 'director', 'sales', 'mid', 'tech'],
  ],
});

/** The Grower's kinds of people, by function family (or seat for owners and founders). */
export const KIND_LABELS = Object.freeze({
  owner: 'Business owners', founder: 'Founders', sales: 'Sales people', marketing: 'Marketers', engineering: 'Engineers and developers',
  product: 'Product people', design: 'Designers', recruiting: 'Recruiters', finance: 'Finance people', operations: 'Operators',
  investing: 'Investors', creator: 'Creators', realestate: 'Real estate people', education: 'Educators', health: 'Health and wellness pros',
  legal: 'Lawyers', government: 'Public servants',
});
const kindOf = (attrs) => (attrs.key === 'owner' ? 'owner' : attrs.key === 'csuite' && /founder/i.test(attrs.title) ? 'founder' : attrs.func || null);

// ── Bands ────────────────────────────────────────────────────────────────────

export function companyBand(co) {
  if (!co || !co.name) return 'none';
  if (co.band) return co.band;
  const s = Number(co.score) || 5;
  if (co.source === 'default' || co.source === 'none') return 'unknown';
  if (s >= 9.5) return 'big';
  if (s >= 8) return 'major';
  if (s >= 6.5) return 'known';
  if (s >= 5.5) return 'mid';
  return s < 5 ? 'low' : 'unknown';
}

const LEVEL_BAND = { csuite: 'top', owner: 'top', vp: 'vp', director: 'director', manager: 'manager', senior: 'ic', ic: 'ic', intern: 'junior', student: 'junior' };
export const levelBand = (key) => LEVEL_BAND[key] || (LEVELS[key] ? (LEVELS[key].level >= 6 ? 'top' : LEVELS[key].level >= 5 ? 'vp' : LEVELS[key].level >= 4 ? 'director' : LEVELS[key].level >= 3 ? 'manager' : 'ic') : 'ic');

/** What a company line says about where its score came from (spec 6.5). */
export function companyLabel(co) {
  if (!co?.name) return null;
  if (co.label) return co.label;
  const s = Number(co.score) || 5;
  if (co.source === 'yours') return `you scored it ${s}`;
  if (co.source === 'known' || co.source === 'data') return s >= 9 ? 'top company' : s >= 8 ? 'large public company' : s >= 7 ? 'well-known company' : 'known company';
  if (co.source === 'network') return 'many of your people work there';
  return 'small, unknown to Sixgree';
}

const PLACE_LABELS = { local: 'your city', region: 'your region', country: 'elsewhere in your country', abroad: 'abroad' };

/** A followers band's words, for the Reach round. */
const REACH = [[null, 'No public following'], [12000, '12K followers'], [250000, '250K followers'], [2000000, '2M followers']];

// ── Cards ────────────────────────────────────────────────────────────────────

const READABLE = /^[a-z0-9&,.'’()/+ -]{2,60}$/i;

/** A title fit for a card: a readable job title, never a whole headline. */
export function readableTitle(t) {
  const s = String(t || '').replace(/\s+/g, ' ').trim();
  if (!s || !READABLE.test(s) || s.split(' ').length > 8 || !/[a-z]/i.test(s)) return null;
  return s;
}

/** A real person's card attributes: what their card would show, never who they are. */
export function realAttrs(f, env) {
  const title = readableTitle(f.title);
  if (!title || f.key === 'unknown') return null;
  const band = placeBand(f.location, env.home);
  return {
    title,
    key: f.key,
    func: f.func,
    company: f.company?.name ? { name: f.company.name, score: f.company.score, source: f.company.source } : null,
    industry: f.industry || null,
    sectors: (f.sectors || []).slice(0, 6),
    placeBand: band,
    placeCity: band === 'local' || band === 'region' ? titleCase(cityOf(f.location)) : null,
    followers: f.followers,
    recognition: (f.reach || []).includes('recognition'),
    target: targetEmployment(f, env),
    real: true,
  };
}

/** A made-up card from the class vocabulary. */
export function vocabAttrs([title, key, func, band, industry]) {
  const co = GENERIC_COMPANIES[band] || GENERIC_COMPANIES.unknown;
  return {
    title, key, func: func || null, company: { ...co }, industry: industry || null, sectors: [], placeBand: null, placeCity: null,
    followers: null, recognition: false, target: null, real: false,
  };
}

/** What each round's cards show (the rest is hidden, so it can't count). */
export const SHOWS = Object.freeze({
  industry: Object.freeze({ company: true, industry: true, place: false, reach: false }),
  func: Object.freeze({ company: false, industry: true, place: true, reach: false }),
  role: Object.freeze({ company: true, industry: true, place: false, reach: false }),
  place: Object.freeze({ company: false, industry: true, place: true, reach: false }),
  company: Object.freeze({ company: true, industry: false, place: false, reach: false }),
  reach: Object.freeze({ company: false, industry: true, place: false, reach: true }),
  hard: Object.freeze({ company: true, industry: true, place: true, reach: false }),
});

/** The facts a card stands for, from only what it shows. */
export function cardFacts(attrs, show = SHOWS.hard) {
  const key = attrs.key || 'ic';
  return {
    seat: ((LEVELS[key]?.points ?? LEVELS.ic.points) - 5) / 2.5,
    key,
    level: LEVELS[key]?.level ?? 1,
    title: attrs.title,
    text: lower(attrs.title),
    func: attrs.func || null,
    company: show.company && attrs.company?.name ? { name: attrs.company.name, score: attrs.company.score, source: attrs.company.source } : { name: null, score: 5, source: 'hidden' },
    industry: show.industry ? attrs.industry || null : null,
    sectors: show.industry ? attrs.sectors || [] : [],
    placeBand: show.place ? attrs.placeBand ?? null : null,
    followers: show.reach ? attrs.followers ?? null : null,
    reach: show.reach && attrs.recognition ? ['recognition'] : [],
    student: key === 'student' || key === 'intern',
    target: show.company ? attrs.target ?? null : null,
    current: [],
    past: [],
    waysIn: 0,
    exclusive: 0,
  };
}

/** A card's features: featuresOf on its facts. */
export const cardFeatures = (attrs, show, env) => featuresOf(cardFacts(attrs, show), env);

/** The card as the page draws it: words only, no person. */
export function cardView(attrs, show, { kind = false } = {}) {
  const co = show.company && attrs.company?.name ? { name: attrs.company.name, label: companyLabel(attrs.company) } : null;
  const place = show.place && attrs.placeBand ? {
    band: attrs.placeBand,
    label: attrs.placeCity ? `${attrs.placeCity} (${PLACE_LABELS[attrs.placeBand]})` : sentence(PLACE_LABELS[attrs.placeBand]),
  } : null;
  const reach = show.reach ? (REACH.slice().reverse().find(([n]) => n != null && (attrs.followers || 0) >= n)?.[1] || REACH[0][1]) + (attrs.recognition ? ' · Keynote speaker' : '') : null;
  const k = kind ? kindOf(attrs) : null;
  return {
    title: k ? KIND_LABELS[k] || attrs.title : attrs.title,
    example: k ? `e.g. ${attrs.title}` : null,
    company: kind ? null : co,
    industry: show.industry && attrs.industry ? { key: attrs.industry, label: industryLabel(attrs.industry) } : null,
    place,
    reach,
    madeUp: !attrs.real,
  };
}

// ── k-anonymity ──────────────────────────────────────────────────────────────

const anonKey = (a) => `${norm(a.title)}|${lower(a.company?.name)}|${a.placeBand || ''}`;
const bandKey = (a) => `${norm(a.title)}|${companyBand(a.company)}`;

/** Count the real cards by their full combination, and by title and company band. */
function anonCounts(attrsList) {
  const full = new Map();
  const banded = new Map();
  const titles = new Map();
  for (const a of attrsList) {
    full.set(anonKey(a), (full.get(anonKey(a)) || 0) + 1);
    banded.set(bandKey(a), (banded.get(bandKey(a)) || 0) + 1);
    titles.set(norm(a.title), (titles.get(norm(a.title)) || 0) + 1);
  }
  return { full, banded, titles };
}

/**
 * A real card that fewer than 3 real people match is coarsened: its company
 * becomes its band's generic name, and if the title and band still match
 * fewer than 3, the title becomes a generic one for its seat (a made-up card).
 */
export function coarsen(a, counts, k = 3) {
  if (!a.real) return a;
  if ((counts.full.get(anonKey(a)) || 0) >= k) return a;
  const band = companyBand(a.company);
  const generic = band === 'none' ? null : GENERIC_COMPANIES[band === 'low' ? 'unknown' : band] || GENERIC_COMPANIES.unknown;
  const out = { ...a, company: generic ? { ...generic } : null, placeCity: (counts.full.get(anonKey(a)) || 0) >= k ? a.placeCity : null, coarse: true };
  if ((counts.banded.get(bandKey(a)) || 0) >= k || (counts.titles.get(norm(a.title)) || 0) >= k) return out;
  return { ...out, title: genericTitle(a.key, a.func), real: false };
}

// ── Rounds ───────────────────────────────────────────────────────────────────

/** Each round's count for a mode: the class's standard counts scaled to the mode's maximum. Tunes ask hard calls only. */
export function roundPlan(classKey, modeKey = 'standard') {
  const mode = MODES[modeKey] || MODES.standard;
  if (modeKey === 'tune' || modeKey === 'retune') {
    return [{ ...ROUNDS[classKey].find((r) => r.focus === 'hard'), n: mode.max }];
  }
  let rounds = (ROUNDS[classKey] || ROUNDS.cartographer).slice();
  // Fewer duels than rounds: the smallest rounds go (hard calls always stay).
  while (rounds.length > mode.max) {
    const drop = rounds.slice(0, -1).reduce((m, r, i, a) => (r.n < a[m].n ? i : m), 0);
    rounds = rounds.filter((_, i) => i !== drop);
  }
  // The standard counts scaled to the mode (largest remainder), each round at least one.
  const total = rounds.reduce((s, r) => s + r.n, 0);
  const exact = rounds.map((r) => (r.n * mode.max) / total);
  const plan = rounds.map((r, i) => ({ ...r, n: Math.max(1, Math.floor(exact[i])) }));
  const rem = (i) => exact[i] - Math.floor(exact[i]);
  let diff = mode.max - plan.reduce((s, r) => s + r.n, 0);
  const up = plan.map((_, i) => i).sort((a, b) => rem(b) - rem(a) || b - a);
  for (let k = 0; diff > 0; k = (k + 1) % up.length, diff -= 1) plan[up[k]].n += 1;
  const down = plan.map((_, i) => i).sort((a, b) => rem(a) - rem(b) || a - b);
  for (let k = 0, guard = 0; diff < 0 && guard < 1000; k = (k + 1) % down.length, guard += 1) {
    if (plan[down[k]].n > 1) { plan[down[k]].n -= 1; diff += 1; }
  }
  return plan;
}

/** Which round duel `index` (0-based, within this session) is in: { round, at, of, index }. */
export function roundAt(plan, index) {
  let start = 0;
  for (const [i, r] of plan.entries()) {
    if (index < start + r.n) return { round: r, at: i + 1, of: plan.length, inRound: index - start + 1 };
    start += r.n;
  }
  const last = plan[plan.length - 1];
  return { round: last, at: plan.length, of: plan.length, inRound: last.n };
}

// ── The deck ─────────────────────────────────────────────────────────────────

/**
 * Everything a class's deck draws on, built once per network and target: the
 * real cards (coarsened where too few match), the class's made-up cards, and
 * the 40th percentile of the prior's class worth. `facts` are the network's
 * (lib/class-fit.js personFacts), `env` classEnv's.
 */
export function deckContext(facts, build, env, { weights = null, maxReal = 4000 } = {}) {
  const seen = new Set();
  const real = [];
  for (const f of facts) {
    if (!inPool(f)) continue;
    const a = realAttrs(f, env);
    if (!a) continue;
    const key = anonKey(a);
    if (seen.has(`${key}|${f.url}`)) continue;
    seen.add(`${key}|${f.url}`);
    real.push(a);
  }
  const counts = anonCounts(real);
  // One card per distinct combination, coarsened as needed.
  const distinct = new Map();
  for (const a of real) {
    const c = coarsen(a, counts);
    const k = `${anonKey(c)}|${c.industry}|${c.key}`;
    if (!distinct.has(k)) distinct.set(k, c);
    if (distinct.size >= maxReal) break;
  }
  const classKey = build.class;
  const vocab = (CLASS_VOCAB[classKey] || []).map((v) => vocabAttrs(v));
  // Small networks (under about 200 readable people) lean on the built-in deck.
  const small = distinct.size < 200;
  // The class prior's weights, for the 40th percentile rule (cardFloor).
  return { real: [...distinct.values()], vocab, small, weights: weights || new Float64Array(D), floors: new Map(), classKey, kind: classKey === 'grower' };
}

/**
 * The class prior's 40th percentile over cards that show what these show:
 * both cards of a duel sit above it (spec 6.5), apart from the deliberately
 * low ones. Worked out once per set of attributes shown.
 */
export function cardFloor(ctx, show, env) {
  const key = JSON.stringify(show);
  if (ctx.floors?.has(key)) return ctx.floors.get(key);
  const cards = [...ctx.real.slice(0, 600), ...ctx.vocab];
  let floor = -Infinity;
  if (cards.length >= 20) {
    const us = cards.map((a) => {
      const x = cardFeatures(a, show, env);
      let s = 0;
      for (let i = 0; i < D; i++) s += ctx.weights[i] * x[i];
      return s;
    }).sort((a, b) => a - b);
    floor = us[Math.floor(us.length * 0.4)];
  }
  ctx.floors?.set(key, floor);
  return floor;
}

const pick = (list, rand) => list[Math.floor(rand() * list.length)];

/** Up to `n` items from a list, at random, without repeats. */
function sample(list, n, rand) {
  if (list.length <= n) return list.slice();
  const out = new Set();
  while (out.size < n) out.add(list[Math.floor(rand() * list.length)]);
  return [...out];
}

/** The partner for anchor A in a round's focus: real ones first (alike on everything else), then a composite. */
function partnersFor(a, focus, ctx, env, rand) {
  const out = [];
  const real = ctx.real;
  const same = (b, fields) => fields.every((f) => f(a) === f(b));
  const lb = (x) => levelBand(x.key);
  const cb = (x) => companyBand(x.company);
  const ind = (x) => x.industry || '';
  const pb = (x) => x.placeBand || '';
  const pool = sample(real, 400, rand);
  const add = (b, composite = false) => { if (b && b !== a) out.push({ b, composite }); };
  if (focus === 'industry') {
    // The sector is the question: an anchor needs one.
    if (!a.industry) return out;
    pool.filter((b) => same(b, [lb, cb]) && ind(b) && ind(b) !== ind(a)).slice(0, 2).forEach((b) => add(b));
    const other = pick(INDUSTRIES.filter((g) => g.key !== a.industry), rand);
    const band = cb(a);
    add({ ...a, industry: other.key, sectors: [], company: band === 'none' ? null : { ...(GENERIC_COMPANIES[band === 'low' ? 'unknown' : band] || GENERIC_COMPANIES.unknown) }, real: false }, true);
  } else if (focus === 'func') {
    pool.filter((b) => same(b, [pb]) && kindOf(b) && kindOf(b) !== kindOf(a)).slice(0, 2).forEach((b) => add(b));
    add(pick(ctx.vocab.filter((v) => kindOf(v) !== kindOf(a)), rand), true);
  } else if (focus === 'role') {
    pool.filter((b) => same(b, [ind, cb]) && (lb(b) !== lb(a) || norm(b.title) !== norm(a.title))).slice(0, 2).forEach((b) => add(b));
    const keys = ['csuite', 'vp', 'director', 'manager', 'senior', 'ic'].filter((k) => levelBand(k) !== lb(a));
    const k = pick(keys, rand);
    add({ ...a, key: k, title: genericTitle(k, a.func), real: false }, true);
    const v = pick(ctx.vocab, rand);
    if (v) add({ ...v, industry: a.industry, company: a.company ? { ...a.company } : v.company }, true);
  } else if (focus === 'place') {
    if (!env.home) return out;
    pool.filter((b) => same(b, [lb, ind]) && b.placeBand && b.placeBand !== a.placeBand).slice(0, 2).forEach((b) => add(b));
    const bands = ['local', 'region', 'country', 'abroad'].filter((x) => x !== a.placeBand);
    const band = pick(bands, rand);
    add({ ...a, placeBand: band, placeCity: band === 'local' ? titleCase(env.home.city) : null, real: false }, true);
  } else if (focus === 'company') {
    pool.filter((b) => same(b, [lb, pb]) && cb(b) !== cb(a) && cb(b) !== 'none').slice(0, 2).forEach((b) => add(b));
    const bands = ['big', 'major', 'known', 'unknown'].filter((x) => x !== cb(a));
    add({ ...a, company: { ...GENERIC_COMPANIES[pick(bands, rand)] }, target: null, real: false }, true);
    // The Infiltrator's own targets: the same seat at one of them.
    if (env.targets?.length) {
      const t = pick(env.targets, rand);
      add({ ...a, company: { name: titleCase(t), score: 7, source: 'known', label: 'one of your targets' }, target: 'current', real: false }, true);
    }
  } else if (focus === 'reach') {
    const levels = REACH.filter(([n]) => (n || 0) !== (a.followers || 0)).map(([n]) => n);
    add({ ...a, followers: pick(levels, rand), recognition: rand() < 0.3, real: false }, true);
  } else {
    sample(real.length ? real : ctx.vocab, 3, rand).forEach((b) => add(b));
    add(pick(ctx.vocab, rand), true);
  }
  return out;
}

/** The deliberately low card of a round: an intern for Rank and role, a company nobody knows for Big name. */
function lowPartner(a, focus) {
  if (focus === 'role') return { ...a, key: 'intern', title: genericTitle('intern', a.func), real: false };
  if (focus === 'company') return { ...a, company: { ...GENERIC_COMPANIES.unknown }, target: null, real: false };
  return null;
}

const cardId = (a) => `${norm(a.title)}|${lower(a.company?.name)}|${a.industry || ''}|${a.placeBand || ''}|${a.followers ?? ''}|${a.key}`;

/** What the two cards share: the page dims it, so the difference stands out. */
function sameFields(va, vb) {
  const out = [];
  if (JSON.stringify(va.company) === JSON.stringify(vb.company)) out.push('company');
  if (JSON.stringify(va.industry) === JSON.stringify(vb.industry)) out.push('industry');
  if (JSON.stringify(va.place) === JSON.stringify(vb.place)) out.push('place');
  if (va.reach === vb.reach) out.push('reach');
  return out;
}

/** How many times each title, company and industry has been shown in the answers so far. */
function usage(answers) {
  const n = new Map();
  const bump = (k) => n.set(k, (n.get(k) || 0) + 1);
  for (const ans of answers) {
    for (const side of [ans.a, ans.b]) {
      const at = side?.attrs || {};
      bump(`t:${norm(at.title)}`);
      if (at.company?.name) bump(`c:${lower(at.company.name)}`);
    }
  }
  return n;
}

/**
 * The next duel: { a, b, left, focus, round, index, total, prompt, mirrorOf? }
 * where a and b are { attrs, show, view, x }. `answers` are this session's so
 * far (to place the round and avoid repeats), `allAnswers` every answer the
 * build has. `posterior` is lib/pairwise.js fitPosterior's. Null when no fair
 * pair can be made.
 */
export function nextPair({ ctx, env, posterior, plan, sessionAnswers = [], allAnswers = [], rand = seededRandom(1), mirrorAt = 9 }) {
  const index = sessionAnswers.length;
  const total = plan.reduce((s, r) => s + r.n, 0);
  const { round, at, of } = roundAt(plan, index);
  // The Grower's cards are kinds of people: no company on them, so none counts.
  const show = ctx.kind ? { ...(SHOWS[round.focus] || SHOWS.hard), company: false } : SHOWS[round.focus] || SHOWS.hard;
  const base = { index, total, roundNo: at, rounds: of, round: { key: round.key, label: round.label, why: round.why }, focus: round.focus, prompt: DUEL_PROMPT[ctx.classKey] };

  // The mirrored repeat: one earlier duel again, the sides swapped.
  if (index === mirrorAt && allAnswers.length > 0) {
    const firstOfSession = allAnswers.length - sessionAnswers.length;
    const origIdx = sessionAnswers.findIndex((ans, i) => i >= 2 && ans.choice !== 'skip' && ans.mirrorOf == null && ans.kind !== 'pair');
    if (origIdx >= 0) {
      const o = sessionAnswers[origIdx];
      const a = { attrs: o.b.attrs, show: o.b.show, view: cardView(o.b.attrs, o.b.show, { kind: ctx.kind }) };
      const b = { attrs: o.a.attrs, show: o.a.show, view: cardView(o.a.attrs, o.a.show, { kind: ctx.kind }) };
      return { ...base, a, b, left: o.left === 'a' ? 'b' : 'a', same: sameFields(a.view, b.view), mirrorOf: firstOfSession + origIdx, focus: o.focus || base.focus, round: o.round || base.round };
    }
  }

  const asked = new Set(allAnswers.map((ans) => [cardId(ans.a.attrs), cardId(ans.b.attrs)].sort().join('~')));
  const used = usage(allAnswers);
  const overused = (attrs) => (used.get(`t:${norm(attrs.title)}`) || 0) >= 3 || (attrs.company?.name && (used.get(`c:${lower(attrs.company.name)}`) || 0) >= 3);
  const lowDue = (round.focus === 'role' || round.focus === 'company') && !sessionAnswers.some((s) => s.low && s.focus === round.focus);

  // A card that shows a company has one: a blank company line reads as a mistake.
  // A Grower card is a kind of person, so it needs one it can name.
  const fits = (attrs) => (!show.company || Boolean(attrs?.company?.name)) && (!ctx.kind || Boolean(kindOf(attrs || {})));
  const xOf = new Map();
  const feat = (attrs) => {
    const k = cardId(attrs);
    if (!xOf.has(k)) xOf.set(k, cardFeatures(attrs, show, env));
    return xOf.get(k);
  };
  // The 40th percentile rule, on cards like these (the same attributes shown), under the class prior.
  const floor = cardFloor(ctx, show, env);
  const above = (attrs) => {
    if (!Number.isFinite(floor)) return true;
    const x = feat(attrs);
    let s = 0;
    for (let i = 0; i < D; i++) s += ctx.weights[i] * x[i];
    return s >= floor;
  };
  const sampled = sample(ctx.real, ctx.small ? 40 : 120, rand);

  // Strict first; a small network that runs out of fair pairs relaxes the
  // 40th percentile rule, then the three-times rule, rather than end early.
  const collect = ({ useFloor, useLimit }) => {
    const candidates = [];
    const anchors = [...sampled, ...ctx.vocab].filter((a) => (!useLimit || !overused(a)) && fits(a));
    for (const a of anchors) {
      if (round.focus === 'place' && !env.home) break;
      const partners = lowDue && candidates.length === 0 ? [{ b: lowPartner(a, round.focus), composite: true, low: true }] : partnersFor(a, round.focus, ctx, env, rand);
      for (const { b, composite, low } of partners) {
        if (!b || (useLimit && overused(b)) || !fits(b)) continue;
        const ka = cardId(a);
        const kb = cardId(b);
        if (ka === kb || asked.has([ka, kb].sort().join('~'))) continue;
        if (useFloor && !low && !(above(a) && above(b))) continue;
        const xa = feat(a);
        const xb = feat(b);
        const d = new Float64Array(D);
        let diff = 0;
        for (let i = 0; i < D; i++) { d[i] = xa[i] - xb[i]; if (d[i]) diff += 1; }
        if (!diff) continue;
        const { gain, margin } = infoGain(posterior, d, D);
        // A pair the model already finds lopsided wastes a question.
        if (!low && Math.abs(margin) > 2.5) continue;
        candidates.push({ a, b, gain: low ? Infinity : gain, low: Boolean(low), composite });
      }
      if (candidates.length >= 1500) break;
    }
    return candidates;
  };
  let candidates = collect({ useFloor: true, useLimit: true });
  if (!candidates.length) candidates = collect({ useFloor: false, useLimit: true });
  if (!candidates.length) candidates = collect({ useFloor: false, useLimit: false });
  // Home turf with no home, or nothing left in this round's focus: asked as a hard call.
  if (!candidates.length && round.focus !== 'hard') {
    return nextPair({ ctx, env, posterior, plan: plan.map((r, i) => (i === at - 1 ? { ...r, focus: 'hard' } : r)), sessionAnswers, allAnswers, rand, mirrorAt: -1 });
  }
  if (!candidates.length) return null;
  candidates.sort((x, y) => y.gain - x.gain);
  // One pick in ten at random among the better half.
  const chosen = !candidates[0].low && rand() < 0.1 ? pick(candidates.slice(0, Math.max(1, Math.ceil(candidates.length / 2))), rand) : candidates[0];
  const left = rand() < 0.5 ? 'a' : 'b';
  const a = { attrs: chosen.a, show, view: cardView(chosen.a, show, { kind: ctx.kind }) };
  const b = { attrs: chosen.b, show, view: cardView(chosen.b, show, { kind: ctx.kind }) };
  return { ...base, a, b, left, same: sameFields(a.view, b.view), low: chosen.low };
}

/** The feature indexes each block has varied over in the cards asked: what the stop rule watches. */
export function variedBlocks(answers = []) {
  const out = Object.fromEntries(BLOCKS.map((b) => [b.key, new Set()]));
  for (const ans of answers) {
    const xa = ans.a?.x || [];
    const xb = ans.b?.x || [];
    for (const f of FEATURES) if ((xa[f.i] || 0) !== (xb[f.i] || 0)) out[f.block].add(f.i);
  }
  return Object.fromEntries(Object.entries(out).map(([k, v]) => [k, [...v]]));
}

