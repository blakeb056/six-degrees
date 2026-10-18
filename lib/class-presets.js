// Sixgree Classes (2026-10-17): the six classes, the features a class scores
// people on, each class's preset weights, its question set, and the warmth
// bands. Plain data, no imports beyond the industries' list, so the server's
// scoring (lib/class-fit.js), the This or That deck (lib/duel-deck.js), the
// pages and tests/classes.test.mjs all read the same tables.
//
// Two axes, never one overwritten (Blake, 10/17): network worth is the power
// score and the network tier, the same for everyone, and it stays exactly as
// it is. Class worth is new and personal: what someone is worth to this
// user's goal, set by the class picked, the target named and the answers
// given. The UI always says which tier it means.
//
// Every weight below is a hand-set prior in logits of preference: +1.0 means
// a profile with that feature is preferred about 2.7 times as often as an
// otherwise identical one. They are starting points; the This or That answers
// move them. Nothing here was fitted to anyone's network.

import { INDUSTRIES } from './companies.js';

/** Bumped whenever a preset or the feature list changes: part of the scoring_class stamp. */
export const PRESET_VERSION = 1;
export const FEATURE_SET_VERSION = 1;

// ── The classes ──────────────────────────────────────────────────────────────

export const CLASSES = Object.freeze([
  Object.freeze({
    key: 'poacher', name: 'Poacher', color: '#f97316', glyph: 'P',
    who: 'Sales: a CRM for the people you sell to.',
    hunts: 'One industry, role and city',
    ability: 'Pipeline board',
    win: 'A deal closed',
    gamma: 0.2, rho: 0.8,
  }),
  Object.freeze({
    key: 'founder', name: 'Founder', color: '#22c55e', glyph: 'F',
    who: 'Founders looking for founders, co-founders and builders.',
    hunts: 'Founders, early employees, technical builders',
    ability: 'Builder map',
    win: 'A builder met',
    gamma: 0.5, rho: 1.0,
  }),
  Object.freeze({
    key: 'seeker', name: 'Seeker', color: '#eab308', glyph: 'S',
    who: 'People after investors, accelerators or seed networks.',
    hunts: 'Partners, angels, accelerator alumni and staff',
    ability: 'Capital path',
    win: 'An intro to an investor',
    gamma: 0.5, rho: 1.2,
  }),
  Object.freeze({
    key: 'grower', name: 'Grower', color: '#06b6d4', glyph: 'G',
    who: 'A small business or person growing a small network into thousands.',
    hunts: 'Local, high-reach people in your city and sector',
    ability: 'Growth curve',
    win: 'My local network doubled',
    gamma: 1.0, rho: 0.8,
  }),
  Object.freeze({
    key: 'cartographer', name: 'Cartographer', color: '#8b5cf6', glyph: 'C',
    who: 'Well-connected people analysing what they already have.',
    hunts: 'Hidden super-connectors, gaps, communities',
    ability: 'Atlas',
    win: 'Understanding my network',
    gamma: 1.0, rho: 1.0,
  }),
  Object.freeze({
    key: 'infiltrator', name: 'Infiltrator', color: '#ef4444', glyph: 'I',
    who: 'Job seekers getting into the companies they want.',
    hunts: 'Recruiters, hiring managers and teams at your target companies',
    ability: 'Breach up front, and a recruiter radar',
    win: 'A job offer',
    gamma: 0.3, rho: 1.0,
  }),
]);

export const CLASS_KEYS = Object.freeze(CLASSES.map((c) => c.key));
export const classByKey = (key) => CLASSES.find((c) => c.key === key) || null;

/** "Not sure?": what would make this month a win, one answer per class. */
export const WIN_QUESTION = 'What would make this month a win?';

// ── The features ─────────────────────────────────────────────────────────────
// One row per feature: its block (the five build bars: Role, Company, Sector,
// Place, Reach), and the words for it in a why line ("Founders +"). Flags are
// 0 or 1; `seat`, `prestige`, `followers`, `waysIn` and `brokerage` are
// continuous and roughly unit-scaled (lib/class-fit.js says how). A missing
// value is 0, never a guess: missing data says how far the scanner has read,
// not what the user wants.

export const BLOCKS = Object.freeze([
  Object.freeze({ key: 'sector', label: 'Sector' }),
  Object.freeze({ key: 'role', label: 'Role' }),
  Object.freeze({ key: 'place', label: 'Place' }),
  Object.freeze({ key: 'company', label: 'Company' }),
  Object.freeze({ key: 'reach', label: 'Reach' }),
]);

const BASE_FEATURES = [
  ['seat', 'role', 'Senior seat'],
  ['founder', 'role', 'Founders'],
  ['owner', 'role', 'Business owners'],
  ['investor', 'role', 'Investors'],
  ['accelerator', 'role', 'YC and accelerators'],
  ['recruiter', 'role', 'Recruiters'],
  ['manager', 'role', 'Hiring managers'],
  ['targetRole', 'role', 'Your target roles'],
  ['hiring', 'role', 'Hiring now'],
  ['openToWork', 'role', 'Open to work'],
  ['sells', 'role', 'Sells a service'],
  ['student', 'role', 'Students and interns'],
  ['prestige', 'company', 'Big-name companies'],
  ['recognised', 'company', 'Companies Sixgree knows'],
  ['startup', 'company', 'Founders at startups'],
  ['targetCurrent', 'company', 'At your target companies'],
  ['targetAlumni', 'company', 'Alumni of your targets'],
  ['targetSector', 'sector', 'Your target sectors'],
  ...INDUSTRIES.map((g) => [`ind:${g.key}`, 'sector', g.label]),
  ['sameMetro', 'place', 'Your city'],
  ['sameRegion', 'place', 'Your region'],
  ['followers', 'reach', 'Big followings'],
  ['recognition', 'reach', 'Recognition'],
  ['waysIn', 'reach', 'Many ways in'],
  ['brokerage', 'reach', 'Super-connectors'],
];

export const FEATURES = Object.freeze(BASE_FEATURES.map(([key, block, label], i) => Object.freeze({ key, block, label, i })));
export const FEATURE_KEYS = Object.freeze(FEATURES.map((f) => f.key));
export const FEATURE_INDEX = Object.freeze(Object.fromEntries(FEATURES.map((f) => [f.key, f.i])));
/** How many weights a build has (the features), before the outside option and the side bias. */
export const D = FEATURES.length;

// ── The presets ──────────────────────────────────────────────────────────────
// The spec's table (section 3.8), one column per class. A feature a class
// lists has a prior sd of 0.5; every other weight has mean 0 and sd 1.0, so a
// handful of answers can move what the preset left open. Founder / owner are
// split for the Poacher (+0.5 / +1.0) and the Founder (+2.0 / +1.0: a small
// business owner isn't a startup founder); every other class gives both the
// same.

export const PRESETS = Object.freeze({
  poacher: Object.freeze({
    seat: 0.3, founder: 0.5, owner: 1.0, recruiter: -0.5, targetRole: 2.0, openToWork: -0.5, sells: -1.0, student: -1.5,
    prestige: 0.1, targetSector: 1.5, sameMetro: 1.5, sameRegion: 0.8,
  }),
  founder: Object.freeze({
    seat: 0.3, founder: 2.0, owner: 1.0, investor: 0.5, accelerator: 1.0, recruiter: -0.3, targetRole: 1.0, hiring: 0.5,
    openToWork: 0.5, student: -0.5, startup: 0.8, targetSector: 1.0, sameMetro: 0.3, followers: 0.2, recognition: 0.2,
  }),
  seeker: Object.freeze({
    seat: 0.5, founder: 0.6, owner: 0.6, investor: 2.5, accelerator: 1.5, recruiter: -0.3, openToWork: -0.5, sells: -0.5,
    student: -1.0, prestige: 0.3, startup: 0.5, targetSector: 1.0, followers: 0.2, recognition: 0.3,
  }),
  grower: Object.freeze({
    seat: 0.3, founder: 0.8, owner: 0.8, targetRole: 1.0, sells: 0.3, student: -0.5, targetSector: 1.0, sameMetro: 1.5,
    sameRegion: 0.8, followers: 1.0, recognition: 0.5, brokerage: 0.3, waysIn: 0.3,
  }),
  cartographer: Object.freeze({
    seat: 0.4, founder: 0.3, owner: 0.3, investor: 0.5, accelerator: 0.3, student: -0.5, prestige: 0.3, followers: 0.5,
    recognition: 0.3, brokerage: 2.0, waysIn: 1.0,
  }),
  infiltrator: Object.freeze({
    seat: 0, manager: 0.8, founder: -0.3, owner: -0.3, recruiter: 2.0, targetRole: 1.0, hiring: 1.5, openToWork: -1.0,
    sells: -0.5, student: -1.0, prestige: 0.3, targetCurrent: 2.5, targetAlumni: 0.8, targetSector: 0.5, sameMetro: 0.3,
  }),
});

/** The Infiltrator's seat term: best at d* levels above your own, falling off as (dv - d*)^2 x w_q. */
export const SEAT_GAP = Object.freeze({ infiltrator: Object.freeze({ peak: 1.5, weight: 0.35 }) });

export const PRESET_SD = 0.5;
export const OPEN_SD = 1.0;
/** Industries are offsets: shrunk harder toward 0 until answers say otherwise. */
export const INDUSTRY_SD = 0.5;
/** Settings → Your sector as prior information: lean +0.5, strong +1.0 on that industry. */
export const FOCUS_PRIOR = Object.freeze({ lean: 0.5, strong: 1.0 });
/** "Less" in Never show me: a soft push down. "Never" forces class D. */
export const LESS_PRIOR = Object.freeze({ mean: -1.0, sd: 0.5 });
/** A company you scored yourself is evidence too: kappa per point from the neutral 5. */
export const COMPANY_KAPPA = 0.15;

/** The outside option ("neither") and the left-card bias, after the D weights. */
export const U0_PRIOR = Object.freeze({ mean: 0.5, sd: 1.0 });
export const SIDE_PRIOR = Object.freeze({ mean: 0, sd: 0.3 });
export const P = D + 2;
export const U0 = D;
export const SIDE = D + 1;

/** The prior for a class: { mean, sd } arrays of length P (lib/pairwise.js reads them). */
export function classPrior(classKey, { focus = null, avoid = [] } = {}) {
  const preset = PRESETS[classKey] || {};
  const mean = new Float64Array(P);
  const sd = new Float64Array(P);
  for (const f of FEATURES) {
    const isIndustry = f.key.startsWith('ind:');
    const has = Object.hasOwn(preset, f.key);
    mean[f.i] = has ? preset[f.key] : 0;
    sd[f.i] = has ? PRESET_SD : isIndustry ? INDUSTRY_SD : OPEN_SD;
  }
  // Settings → Your sector carries over: nothing the user already set is lost.
  const bonus = FOCUS_PRIOR[focus?.strength] ?? 0;
  for (const key of focus?.sectors || []) {
    const i = FEATURE_INDEX[`ind:${key}`];
    if (i != null && bonus) mean[i] += bonus;
  }
  // "Less" chips: a soft negative weight (a "Never" is a veto, lib/class-fit.js).
  for (const a of avoid || []) {
    if (a?.strength !== 'less') continue;
    const i = FEATURE_INDEX[a.key];
    if (i == null) continue;
    mean[i] = Math.min(mean[i], LESS_PRIOR.mean);
    sd[i] = LESS_PRIOR.sd;
  }
  mean[U0] = U0_PRIOR.mean; sd[U0] = U0_PRIOR.sd;
  mean[SIDE] = SIDE_PRIOR.mean; sd[SIDE] = SIDE_PRIOR.sd;
  return { mean, sd };
}

// ── Name your target (S2) ────────────────────────────────────────────────────
// One class-specific question. A chip matches by the words in someone's
// title, or by their function family (lib/class-fit.js functionOf).

export const FUNCTIONS = Object.freeze([
  Object.freeze({ key: 'sales', label: 'Sales', words: /\b(sales|account (executive|manager)|business development|bdr|sdr|revenue|partnerships?)\b/ }),
  Object.freeze({ key: 'marketing', label: 'Marketing', words: /\b(marketing|growth|brand|content|communications|seo|demand gen|social media)\b/ }),
  Object.freeze({ key: 'engineering', label: 'Engineering', words: /\b(engineer(ing)?|developer|software|cto|devops|data scien(ce|tist)|machine learning|ml|ai researcher|architect)\b/ }),
  Object.freeze({ key: 'product', label: 'Product', words: /\b(product (manager|management|lead|owner)|head of product|vp,? product|cpo|product)\b/ }),
  Object.freeze({ key: 'design', label: 'Design', words: /\b(design(er)?|ux|ui|creative director|art director)\b/ }),
  Object.freeze({ key: 'recruiting', label: 'Recruiting', words: /\b(recruit(er|ing|ment)?|talent|sourcer|headhunter|people partner)\b/ }),
  Object.freeze({ key: 'finance', label: 'Finance', words: /\b(finance|cfo|accountant|accounting|controller|analyst|banker|banking)\b/ }),
  Object.freeze({ key: 'operations', label: 'Operations', words: /\b(operations|coo|chief of staff|ops|supply chain|logistics|program manager)\b/ }),
  Object.freeze({ key: 'investing', label: 'Investing', words: /\b(investor|venture|vc|angel|general partner|principal|private equity)\b/ }),
  Object.freeze({ key: 'creator', label: 'Creators', words: /\b(creator|influencer|youtuber|podcast(er)?|host|streamer|author|writer)\b/ }),
  Object.freeze({ key: 'realestate', label: 'Real estate', words: /\b(realtor|real estate|broker|property|mortgage|realty)\b/ }),
  Object.freeze({ key: 'education', label: 'Education', words: /\b(teacher|professor|educator|lecturer|instructor|dean|principal of)\b/ }),
  Object.freeze({ key: 'health', label: 'Health', words: /\b(physician|doctor|nurse|dentist|therapist|clinical|md|pharmacist|coach|trainer|wellness)\b/ }),
  Object.freeze({ key: 'legal', label: 'Legal', words: /\b(attorney|lawyer|counsel|paralegal|legal)\b/ }),
  Object.freeze({ key: 'government', label: 'Government', words: /\b(government|public servant|policy|senator|mayor|council(member)?)\b/ }),
]);

/** The S2 chips per class: `words` match the title; `func` a function family. */
export const ROLE_CHIPS = Object.freeze({
  poacher: Object.freeze([
    { key: 'owner', label: 'Owners', words: ['owner', 'proprietor', 'founder', 'president'] },
    { key: 'broker', label: 'Brokers and realtors', words: ['broker', 'realtor', 'real estate agent'] },
    { key: 'property', label: 'Property managers', words: ['property manager', 'property management'] },
    { key: 'office', label: 'Office and practice managers', words: ['office manager', 'practice manager', 'operations manager'] },
    { key: 'buyer', label: 'Buyers and procurement', words: ['buyer', 'procurement', 'purchasing'] },
    { key: 'director', label: 'Directors and heads', words: ['director', 'head of'] },
    { key: 'marketing', label: 'Marketing leads', func: 'marketing' },
  ]),
  founder: Object.freeze([
    { key: 'cofounder', label: 'Co-founders', words: ['co-founder', 'cofounder', 'founder'] },
    { key: 'technical', label: 'Technical founders and engineers', words: ['cto', 'founding engineer'], func: 'engineering' },
    { key: 'early', label: 'Early employees', words: ['founding', 'first hire', 'early employee'] },
    { key: 'operator', label: 'Operators', words: ['coo', 'chief of staff'], func: 'operations' },
    { key: 'product', label: 'Product builders', func: 'product' },
    { key: 'design', label: 'Designers', func: 'design' },
  ]),
  seeker: Object.freeze([
    { key: 'angel', label: 'Angels', words: ['angel'] },
    { key: 'seed', label: 'Pre-seed and seed VCs', words: ['pre-seed', 'seed', 'venture capital', 'vc', 'general partner', 'principal'] },
    { key: 'accelerator', label: 'Accelerators (YC)', words: ['y combinator', 'yc', 'techstars', 'accelerator'] },
    { key: 'cvc', label: 'Corporate VC', words: ['corporate venture', 'cvc'] },
  ]),
  grower: Object.freeze([
    { key: 'owners', label: 'Local business owners', words: ['owner', 'proprietor'] },
    { key: 'creators', label: 'Creators', func: 'creator' },
    { key: 'marketers', label: 'Marketers', func: 'marketing' },
    { key: 'realestate', label: 'Real estate', func: 'realestate' },
    { key: 'health', label: 'Health and wellness', func: 'health' },
    { key: 'educators', label: 'Educators', func: 'education' },
    { key: 'sales', label: 'Sales people', func: 'sales' },
    { key: 'tech', label: 'Tech people', func: 'engineering' },
  ]),
  cartographer: Object.freeze([]),
  infiltrator: Object.freeze(FUNCTIONS.filter((f) => !['investing', 'creator', 'government'].includes(f.key))
    .map((f) => ({ key: f.key, label: f.label, func: f.key }))),
});

/** What S2 asks, per class. */
export const TARGET_QUESTIONS = Object.freeze({
  poacher: { title: 'Who do you sell to, and where?', roles: 'Who buys', sectors: 'Their sector', city: 'Where' },
  founder: { title: 'What are you building, and who do you want to meet?', roles: 'Who you want to meet', sectors: 'Your sector' },
  seeker: { title: 'What kind of capital?', roles: 'Capital', sectors: 'Your sector' },
  grower: { title: 'Where do you grow?', roles: 'Kinds of people', sectors: 'Your sector', city: 'Your city' },
  cartographer: { title: 'We’ll map what you have', none: 'No question for the Cartographer: your network is the target.' },
  infiltrator: { title: 'Where do you want to work?', targets: 'Companies (up to 25)', roles: 'The role you want', city: 'City (or leave it empty for remote)' },
});

/** The answers S2 starts with, before the user changes anything. */
export const DEFAULT_ROLES = Object.freeze({
  poacher: ['owner'], founder: ['cofounder', 'technical'], seeker: ['angel', 'seed', 'accelerator'], grower: ['owners'],
  cartographer: [], infiltrator: [],
});

// ── This or That: each class's own question set (Blake, 10/17) ──────────────
// "If it's someone trying to grow their circle, like the small guy, then they
// probably just want to fill their circle up with a certain sector, whereas the
// others will have a different gauge." So the Grower's rounds are about
// sectors and kinds of people; the Poacher, Seeker, Infiltrator and Founder
// compare positions and seniority, and companies where it matters.
//
// `focus` is what differs between the two cards (lib/duel-deck.js):
//   industry  the sector             func   the kind of person (function)
//   role      seniority and role     company the company: big name or right fit
//   place     your city or not       reach  a following or none
//   hard      whole-person trade-offs, where the answers so far leave it unclear

const R = (key, label, focus, n, why) => Object.freeze({ key, label, focus, n, why });

export const ROUNDS = Object.freeze({
  grower: Object.freeze([
    R('arena', 'Your arena', 'industry', 4, 'Which sectors you want your circle full of.'),
    R('kinds', 'Kinds of people', 'func', 4, 'Which kinds of people you want more of.'),
    R('turf', 'Home turf', 'place', 3, 'How much being local matters to you.'),
    R('reach', 'Reach', 'reach', 2, 'Whether a big following counts.'),
    R('hard', 'Hard calls', 'hard', 3, 'Trade-offs your answers so far leave open.'),
  ]),
  poacher: Object.freeze([
    R('arena', 'Your arena', 'industry', 2, 'Which sectors your buyers are in.'),
    R('role', 'Rank and role', 'role', 4, 'Which seats sign the deal.'),
    R('turf', 'Home turf', 'place', 2, 'How local your buyers need to be.'),
    R('name', 'Big name or right fit', 'company', 3, 'Whether a famous company beats the right one.'),
    R('hard', 'Hard calls', 'hard', 5, 'Trade-offs your answers so far leave open.'),
  ]),
  founder: Object.freeze([
    R('arena', 'Your arena', 'industry', 2, 'Which sectors you build in.'),
    R('role', 'Rank and role', 'role', 5, 'Founders, builders or operators, and how senior.'),
    R('turf', 'Home turf', 'place', 1, 'Whether nearby matters.'),
    R('name', 'Big name or right fit', 'company', 3, 'A startup nobody knows, or a famous name.'),
    R('reach', 'Reach', 'reach', 1, 'Whether a following counts.'),
    R('hard', 'Hard calls', 'hard', 4, 'Trade-offs your answers so far leave open.'),
  ]),
  seeker: Object.freeze([
    R('arena', 'Your arena', 'industry', 2, 'Which sectors your investors back.'),
    R('role', 'Rank and role', 'role', 5, 'Partners, angels, accelerators or operators.'),
    R('turf', 'Home turf', 'place', 1, 'Whether nearby matters.'),
    R('name', 'Big name or right fit', 'company', 2, 'A famous fund or the right one.'),
    R('reach', 'Reach', 'reach', 2, 'Whether a following counts.'),
    R('hard', 'Hard calls', 'hard', 4, 'Trade-offs your answers so far leave open.'),
  ]),
  infiltrator: Object.freeze([
    R('role', 'Rank and role', 'role', 5, 'Recruiters, hiring managers, the team or the top.'),
    R('name', 'Big name or right fit', 'company', 4, 'Your target companies against the rest.'),
    R('turf', 'Home turf', 'place', 2, 'Whether the job is near you.'),
    R('arena', 'Your arena', 'industry', 1, 'Which sectors you want to work in.'),
    R('hard', 'Hard calls', 'hard', 4, 'Trade-offs your answers so far leave open.'),
  ]),
  cartographer: Object.freeze([
    R('arena', 'Your arena', 'industry', 3, 'Which sectors matter to your map.'),
    R('role', 'Rank and role', 'role', 4, 'Which seats you count most.'),
    R('name', 'Big name or right fit', 'company', 3, 'Famous companies or hidden ones.'),
    R('reach', 'Reach', 'reach', 2, 'Whether a following counts.'),
    R('hard', 'Hard calls', 'hard', 4, 'Trade-offs your answers so far leave open.'),
  ]),
});

/** The question over the two cards, per class. */
export const DUEL_PROMPT = Object.freeze({
  grower: 'Which would you rather fill your circle with?',
  poacher: 'Which would you rather have as a prospect?',
  founder: 'Which would you rather meet?',
  seeker: 'Which would you rather get an intro to?',
  infiltrator: 'Who would help you more toward an offer?',
  cartographer: 'Which would you rather have in your network?',
});

/** How many duels: never stop before `min`, always stop at `max` (spec 6.9). */
export const MODES = Object.freeze({
  quick: Object.freeze({ min: 8, max: 8 }),
  standard: Object.freeze({ min: 12, max: 16 }),
  deep: Object.freeze({ min: 20, max: 30 }),
  tune: Object.freeze({ min: 5, max: 5 }),
  retune: Object.freeze({ min: 8, max: 8 }),
});
/** Early stop: every block's sd under this, or the top 50 this stable across posterior draws. */
export const STOP_SD = 0.25;
export const STOP_TAU = 0.9;
/** Floors from the outside option switch on once this many "neither" or "both great" answers exist. */
export const FLOOR_ANSWERS = 3;
/** S needs u - u0 >= ln 9 (preferred over nobody 90% of the time), A u - u0 >= 0.85 (70%). */
export const FLOORS = Object.freeze({ S: Math.log(9), A: 0.85 });

/** The class tiers' shares, the same as the network curve's so the UI reads the same. */
export const CLASS_SHARES = Object.freeze([['S', 0.03], ['A', 0.15], ['B', 0.4], ['C', 0.7]]);
/** V = min(V_MAX, exp(rho x (u - u_S))): 1.0 means just makes class S. */
export const V_MAX = 4;

// ── Never show me (S4) ───────────────────────────────────────────────────────
// Chips prefilled by class. Each is off, Less (a soft push down) or Never
// (forced class D, and off every class list; they stay on the network views).

export const AVOID_CHIPS = Object.freeze([
  Object.freeze({ key: 'student', label: 'Students and interns' }),
  Object.freeze({ key: 'recruiter', label: 'Recruiters' }),
  Object.freeze({ key: 'sells', label: 'People selling a service' }),
  Object.freeze({ key: 'openToWork', label: 'Open to work' }),
]);

/** Which chips start on, and how strong, per class. */
export function defaultAvoid(classKey) {
  const out = [];
  if (classKey !== 'cartographer') out.push({ key: 'student', strength: 'less' });
  if (classKey !== 'infiltrator' && classKey !== 'grower') out.push({ key: 'recruiter', strength: 'less' });
  return out;
}

// ── Warmth bands (Blake's, 10/17) ────────────────────────────────────────────
// Accepted within 1 day very warm, 3 days warm, 14 days cool, later or never
// cold. Days, never hours: the accept day is a day. Stored on each accepted
// request (lib/send-log.js) and shown only once there are timed accepts.

export const WARMTH_BANDS = Object.freeze([
  Object.freeze({ key: 'very-warm', label: 'Very warm', within: 1 }),
  Object.freeze({ key: 'warm', label: 'Warm', within: 3 }),
  Object.freeze({ key: 'cool', label: 'Cool', within: 14 }),
  Object.freeze({ key: 'cold', label: 'Cold', within: null }),
]);

/** The band for an accept `days` after the request (null days: never accepted): a key. */
export function warmthBand(days) {
  if (days == null || !Number.isFinite(days) || days < 0) return 'cold';
  for (const b of WARMTH_BANDS) if (b.within != null && days <= b.within) return b.key;
  return 'cold';
}
