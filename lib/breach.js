// Breach (Blake, 2026-10-15): get into a company where you have no mutuals, add
// the likeliest "doors" first, then climb as each acceptance gives everyone
// else there a mutual with you. Blake's own playbook, as a tab (app/breach).
//
// Everything here reads data the app already has: the people a company scan,
// a circle scan or "Check for new" saved, and the request-sent marks
// (lib/requests.js). Nothing polls LinkedIn, and nothing sends a request: the
// plan only suggests whom to open, and you press Connect yourself.
//
// What it works out:
//   - who works at the company now, versus alumni and people who only mention
//     it (a keyword search finds all three): employment()
//   - each person's seat, from the title seniority the power score reads
//     (lib/scoring.js readTitle, LEVELS): seatOf()
//   - the bands: Doors (likeliest to accept), Climb, Summit: bandOf()
//   - the graded breach score and its milestones: breachScore()
//   - this week's doors, inside the plan's 10 a week: weeklyPlan()
//   - every company side by side: compareCompanies()
//   - who accepted, and who is still pending: acceptances()
//   - the scanner's arguments for one round, and its progress note: breachRoundArgs(), breachNotes()
//   - warm doors: a door whose mutual line, or a circle scan, named one of your
//     connections, and who to ask (the mutual web, lib/mutual-web.js): warmDoor()
//
// Plain functions, no React and no Node imports: the page, the scanner's route
// and tests/breach.test.mjs all read it.

import { readTitle, rolesWithCompanies, cleanCompany, headlineParts } from './scoring.js';
import { buildCompanyIndex } from './companies.js';

/** The plan suggests this many connection requests a week. Each is sent by hand. */
export const BREACH_WEEKLY = 10;

// ── Seats and the score ──────────────────────────────────────────────────────

/**
 * What one person inside counts for, by the seniority level the power score
 * reads (lib/scoring.js LEVELS: 0 intern or student … 6 C-suite or founder).
 * An individual contributor counts a little, a manager or director more, a VP
 * is a big jump, and C-suite or a founder the biggest (Blake, 2026-10-15).
 */
export const SEAT_WEIGHTS = Object.freeze({ 0: 1, 1: 3, 2: 4, 3: 6, 4: 10, 5: 22, 6: 34 });

/** The rings of the picture, top seat first. Levels 0 and 1 share the last ring. */
export const SEATS = Object.freeze([
  Object.freeze({ level: 6, key: 'csuite', label: 'C-suite / founder' }),
  Object.freeze({ level: 5, key: 'vp', label: 'VP / partner' }),
  Object.freeze({ level: 4, key: 'director', label: 'Director / head' }),
  Object.freeze({ level: 3, key: 'manager', label: 'Manager / lead' }),
  Object.freeze({ level: 2, key: 'senior', label: 'Senior IC' }),
  Object.freeze({ level: 1, key: 'ic', label: 'IC / entry' }),
]);

/** Which ring a level sits on (SEATS' key). */
export const ringOf = (level) => SEATS.find((s) => s.level === Math.max(1, Math.min(6, Number(level) || 0)))?.key || 'ic';

/**
 * Mapping the company counts a little: points once anyone there is known, and
 * a point more for every `per` people known, up to `most`.
 */
export const MAP_POINTS = Object.freeze({ first: 4, per: 25, most: 10 });

/** The milestones, each reached by the first person inside at that level or above. */
export const MILESTONES = Object.freeze([
  Object.freeze({ key: 'door', label: 'First door', level: 0 }),
  Object.freeze({ key: 'director', label: 'First director', level: 4 }),
  Object.freeze({ key: 'vp', label: 'First VP', level: 5 }),
  Object.freeze({ key: 'csuite', label: 'First C-suite', level: 6 }),
]);

// ── Names ────────────────────────────────────────────────────────────────────

/** A company name as typed, tidied: one space between words, at most 80 letters, nothing unprintable. */
export function companyName(raw) {
  const s = String(raw ?? '').normalize('NFKC').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
  return s.length >= 2 && s.length <= 80 ? s : '';
}

/** How a company is compared: lower case, one space. */
export const companyKey = (name) => companyName(name).toLowerCase();

/** The forms a company goes by here: as typed, and as scoring names it (cleanCompany). */
function formsOf(company) {
  const typed = companyKey(company);
  const forms = new Set();
  if (!typed) return forms;
  forms.add(typed);
  const clean = cleanCompany(companyName(company));
  if (clean) forms.add(clean.toLowerCase());
  return forms;
}

const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const FORMER_PART = /^\s*(ex[-\s]|former(ly)?\b|previously\b|prev\b|past\b|retired\b)/i;

// Where a company's name ends in a headline: the part's end, or punctuation, or
// a few plain words ("at Stripe in Dublin"). Not another word of a name: "at
// Stripe Partners" is another company.
const NAME_ENDS = String.raw`(?=\s*(?:$|[|,;:·•()/!.]|\s[-–]\s|\s(?:and|&|in|for|where|on|since)\b))`;

/**
 * Says they work there now, in one part of a headline: "at Stripe", "@ Stripe",
 * "@Stripe", or the company named after the title ("CEO, Stripe", "Founder -
 * Stripe", or a part that is only the name), for any of the forms.
 */
function saysAt(part, forms) {
  for (const f of forms) {
    const name = escape(f);
    if (new RegExp(`(?:^|[\\s,(])(?:at|@)\\s*${name}${NAME_ENDS}`, 'iu').test(part)) return true;
    if (new RegExp(`(?:^|\\S\\s*(?:,|\\s[-–])\\s*)${name}\\s*$`, 'iu').test(part.trim())) return true;
  }
  return false;
}

/** The company named anywhere in a part, as a whole word. */
function names(part, forms) {
  for (const f of forms) {
    if (new RegExp(`(?<![\\p{L}\\p{N}])${escape(f)}(?![\\p{L}\\p{N}])`, 'iu').test(part)) return true;
  }
  return false;
}

// ── Who works there ──────────────────────────────────────────────────────────

/**
 * Does this person work at `company` now, did they once, or does the keyword
 * only turn up somewhere in their profile? 'current' | 'alumni' | 'mention'.
 *
 * A keyword search for the company name (scrape.py scan_company_search) finds
 * all three, so this reads the headline itself and any roles Read profiles
 * read, never the company the scan was for (`scanned_company`) nor the company
 * ingest guessed from it: those say only that the search found them.
 *   - current: a current role at the company ("VP Sales at Stripe",
 *     "Engineer @ Stripe"), or a current part of the headline saying "at <Company>"
 *   - alumni: a former role there ("Ex-Stripe", "Former PM at Stripe", "Stripe alum")
 *   - mention: anything else (a customer, a partner, a word in their About)
 */
export function employment(row, company) {
  const forms = formsOf(company);
  if (!forms.size || !row) return 'mention';
  const roles = rolesWithCompanies({ headline: row.headline || '', experience: row.experience ?? null });
  const at = (r) => Boolean(r.company) && forms.has(String(r.company).toLowerCase());
  if (roles.some((r) => !r.former && !r.audience && at(r))) return 'current';
  const parts = headlineParts(row.headline || '');
  if (parts.some((p) => !FORMER_PART.test(p) && saysAt(p, forms))) return 'current';
  if (roles.some((r) => r.former && at(r))) return 'alumni';
  if (parts.some((p) => names(p, forms) && (FORMER_PART.test(p) || /\balum(ni|nus|na)?\b/i.test(p)))) return 'alumni';
  return 'mention';
}

/** The title words of a role: "VP Sales" from "VP Sales at Stripe". */
export function seatTitle(part) {
  return String(part || '').replace(FORMER_PART, '').split(/\s+(?:at|@)\s+|\s*@\s*|\s*,\s*/i)[0].trim().slice(0, 60);
}

/**
 * The seat someone holds at the company: their role there when the headline
 * names it, else their first current title. { level, key, label, title }.
 */
export function seatOf(row, company) {
  const forms = formsOf(company);
  const roles = rolesWithCompanies({ headline: row?.headline || '', experience: row?.experience ?? null });
  const there = roles.find((r) => !r.former && !r.audience && r.company && forms.has(String(r.company).toLowerCase()));
  const t = there ? { ...there.title, part: there.part } : readTitle(row?.headline || '');
  const level = Math.max(0, Math.min(6, Number(t.level) || 0));
  return { level, key: t.key, label: t.label, title: seatTitle(t.part) || t.label };
}

// ── You, and the signals a door rests on ─────────────────────────────────────

/** A place's city: "Orlando" from "Orlando, Florida, United States" or "Greater Orlando Area". */
export function cityOf(text) {
  return String(text || '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .split(',')[0].replace(/^greater\s+/, '').replace(/\s+(metropolitan\s+|metro\s+|bay\s+)?area$/, '').trim();
}

export const sameCity = (a, b) => {
  const x = cityOf(a);
  return Boolean(x) && x === cityOf(b);
};

/** Their headline names your school, as whole words ("UCF", "University of Central Florida"). */
export function sameSchool(headline, school) {
  const s = String(school || '').trim();
  if (s.length < 2) return false;
  return names(String(headline || ''), new Set([s.toLowerCase()]));
}

const RECRUITER = /\b(recruit(er|ers|ing|ment)?|talent acquisition|sourcer|sourcing partner|talent partner|headhunter)\b/i;
export const isRecruiter = (headline) => RECRUITER.test(String(headline || ''));

/**
 * Where you are, as a guess: the city most of your connections are in. The
 * Breach tab says it's a guess and lets you change it.
 */
export function homeCity(degree1 = []) {
  const counts = new Map();
  for (const r of degree1) {
    const city = cityOf(r?.location);
    if (!city) continue;
    const c = counts.get(city) || { n: 0, text: String(r.location).split(',')[0].replace(/^Greater\s+/i, '').replace(/\s+Area$/i, '').trim() };
    c.n += 1;
    counts.set(city, c);
  }
  let best = null;
  for (const c of counts.values()) if (!best || c.n > best.n) best = c;
  return best && best.n >= 3 ? best.text : '';
}

// ── Bands ────────────────────────────────────────────────────────────────────

export const BANDS = Object.freeze([
  Object.freeze({ key: 'doors', label: 'Doors', about: 'Likeliest to accept: a mutual, a lower seat, recruiters, your city or school.' }),
  Object.freeze({ key: 'climb', label: 'Climb', about: 'Middle managers, with some pull.' }),
  Object.freeze({ key: 'summit', label: 'Summit', about: 'The top seats.' }),
]);

/**
 * Mutuals lift someone toward the doors: one mutual (or your city, or your
 * school) lifts them a band, `two` mutuals two. So people move up a band as
 * their mutual counts rise on rescans.
 */
export const LIFT = Object.freeze({ one: 1, two: 10 });

/**
 * Which band someone is in, and the visible signals that put them there:
 * { band: 'doors' | 'climb' | 'summit', why: [..], lifted }.
 * By seat first (VP and up the summit, manager and director the climb, the
 * rest doors; a recruiter is always a door), then lifted by mutuals, your city
 * and your school. Nothing is guessed about anyone: only their title, mutual
 * count, place and headline.
 */
export function bandOf(person, you = {}) {
  const level = person?.seat?.level ?? 1;
  const why = [];
  let base = level >= 5 ? 2 : level >= 3 ? 1 : 0;
  const recruiter = isRecruiter(person?.headline);
  if (recruiter) {
    base = 0;
    why.push('Recruiter');
  } else if (level <= 2) {
    why.push(person?.seat?.label || 'IC');
  }
  const mutuals = Math.max(0, Number(person?.mutuals) || 0);
  // A warm door says who to ask first: the mutual web named them (warmDoor).
  const warm = warmDoor(person);
  if (warm) why.push(warm);
  if (mutuals) why.push(`${mutuals} mutual${mutuals === 1 ? '' : 's'}`);
  const city = sameCity(person?.location, you.city);
  if (city) why.push('Your city');
  const school = sameSchool(person?.headline, you.school);
  if (school) why.push('Your school');
  if (person?.employment === 'alumni') why.push('Alumni');
  const lift = mutuals >= LIFT.two ? 2 : (mutuals >= LIFT.one || city || school) ? 1 : 0;
  const band = Math.max(0, base - lift);
  return { band: BANDS[band].key, why, lifted: band < base };
}

/**
 * How likely a request is to be accepted, as a number for ordering doors only
 * (never shown as a chance): mutuals most, then a recruiter's job, your city or
 * school, a lower seat, being there now, and a 2nd-degree link.
 */
export function doorOdds(person, you = {}) {
  const level = person?.seat?.level ?? 1;
  return Math.min(20, Math.max(0, Number(person?.mutuals) || 0)) * 3
    + (isRecruiter(person?.headline) ? 6 : 0)
    + (sameCity(person?.location, you.city) ? 4 : 0)
    + (sameSchool(person?.headline, you.school) ? 4 : 0)
    + (6 - level)
    + (person?.employment === 'current' ? 2 : 0)
    + (person?.degree === 2 ? 2 : 0);
}

/**
 * A warm door: someone the mutual web saw with one of your connections, by name
 * (lib/mutual-web.js), so you know who to ask. "Ask Maya Chen", "Ask Maya Chen
 * or Leo Park", "Ask Maya Chen +2"; null for a cold one. A tie is "seen together",
 * not "close": it says who to ask, never that they'll vouch.
 */
export function warmDoor(person) {
  const via = (person?.askVia || []).filter((v) => v?.name);
  if (!via.length) return null;
  if (via.length === 1) return `Ask ${via[0].name}`;
  if (via.length === 2) return `Ask ${via[0].name} or ${via[1].name}`;
  return `Ask ${via[0].name} +${via.length - 1}`;
}

// ── The company's people ─────────────────────────────────────────────────────

const RANK = { current: 2, alumni: 1, mention: 0 };
const sentMark = (r) => r?.outreach_status === 'sent' || r?.unlock_status === 'pending';
const acceptedMark = (r) => r?.outreach_status === 'sent' || r?.outreach_status === 'accepted' || r?.unlock_status === 'unlocked';

/** Might this row be about the company at all: a quick look before reading the headline. */
function mayBe(row, forms) {
  const hay = `${row?.headline || ''} ${row?.company || ''} ${row?.scanned_company || ''} ${typeof row?.experience === 'string' ? row.experience : ''}`.toLowerCase();
  for (const f of forms) if (hay.includes(f)) return true;
  const stored = cleanCompany(row?.company);
  return Boolean(stored) && forms.has(stored.toLowerCase());
}

/**
 * Everyone known at `company`, once each (by profile), from every degree:
 * [{ id, key, name, headline, location, profile_url, profile_image_url, degree,
 *    row, employment, seat, mutuals, inside, requested, accepted, scanned,
 *    power, band, why, lifted, odds }], top seats first.
 * `inside`: one of your connections who works there now. `requested`: a
 * request is out to them (`hasRequest(row)` when given, as the page's shared
 * list says; else the rows' own marks). `accepted`: inside, after a request
 * you sent (the marks stay on the row once they accept). People who only
 * mention the company count only when its search found them (`scanned`).
 */
export function breachPeople(network = {}, company, { you = {}, hasRequest = null, knownVia = null } = {}) {
  const forms = formsOf(company);
  if (!forms.size) return [];
  const scannedHere = (r) => Boolean(r?.scanned_company) && forms.has(companyKey(r.scanned_company));
  const byKey = new Map();
  for (const row of [...(network.degree1 || []), ...(network.degree2 || []), ...(network.degree3 || [])]) {
    if (!row || !mayBe(row, forms)) continue;
    const key = row.profile_url || `id:${row.id}`;
    const emp = employment(row, company);
    const scanned = scannedHere(row);
    if (emp === 'mention' && !scanned) continue;
    let p = byKey.get(key);
    if (!p) {
      p = { key, rows: [], employment: emp, scanned: false };
      byKey.set(key, p);
    }
    p.rows.push(row);
    if (RANK[emp] > RANK[p.employment]) p.employment = emp;
    p.scanned = p.scanned || scanned;
  }
  const out = [];
  for (const p of byKey.values()) {
    const row = p.rows.slice().sort((a, b) => (a.degree || 9) - (b.degree || 9))[0];
    const degree = Number(row.degree) || 3;
    const counts = p.rows.filter((r) => (r.degree || 9) > 1 && r.mutual_count != null).map((r) => Number(r.mutual_count) || 0);
    // Who of your connections they were seen with (the mutual web, lib/mutual-web.js
    // knownThrough), most seen first: each is a mutual LinkedIn showed by name, so a
    // door with one is warm, and the count is at least that many.
    const askVia = degree === 1 || !knownVia ? [] : (knownVia(row, p.rows) || []).slice(0, 3);
    if (askVia.length) counts.push(askVia.length);
    const inside = degree === 1 && p.employment === 'current';
    const requested = !inside && degree !== 1 && (hasRequest ? p.rows.some((r) => hasRequest(r)) : p.rows.some(sentMark));
    const person = {
      id: row.id,
      key: p.key,
      name: row.name,
      headline: row.headline || '',
      location: row.location || '',
      profile_url: row.profile_url || null,
      profile_image_url: row.profile_image_url || null,
      source_connection_id: row.source_connection_id || null,
      degree,
      row,
      employment: p.employment,
      seat: seatOf(row, company),
      mutuals: degree === 1 ? null : (counts.length ? Math.max(...counts) : null),
      askVia,
      inside,
      requested,
      accepted: inside && p.rows.some(acceptedMark),
      scanned: p.scanned,
      power: Number(row.power_score) || 0,
      when: row.connected_date || row.updated_at || row.created_at || null,
    };
    Object.assign(person, bandOf(person, you));
    person.odds = doorOdds(person, you);
    out.push(person);
  }
  out.sort((a, b) => b.seat.level - a.seat.level || Number(b.inside) - Number(a.inside) || b.power - a.power);
  return out;
}

// ── The score ────────────────────────────────────────────────────────────────

const byWhen = (a, b) => String(a.when || '').localeCompare(String(b.when || '')) || b.power - a.power;

/**
 * The breach: a graded score out of 100, not a yes or no.
 *   - mapped: people known there now (MAP_POINTS), a little
 *   - each person inside adds their seat's weight (SEAT_WEIGHTS); a second at
 *     the same level adds half, a third a third, so the top seats weigh most
 * → { score, mapped, opened, known, inside, accepted, highest, highestSeat,
 *     milestones: [{ key, label, level, reached, who }] }
 */
export function breachScore(people = []) {
  const now = people.filter((p) => p.employment === 'current');
  const known = now.filter((p) => !p.inside).length;
  const mapped = known > 0 ? Math.min(MAP_POINTS.most, MAP_POINTS.first + Math.floor(known / MAP_POINTS.per)) : 0;
  const inside = now.filter((p) => p.inside).sort((a, b) => b.seat.level - a.seat.level || b.power - a.power);
  const nth = new Map();
  let opened = 0;
  for (const p of inside) {
    const n = (nth.get(p.seat.level) || 0) + 1;
    nth.set(p.seat.level, n);
    opened += (SEAT_WEIGHTS[p.seat.level] ?? SEAT_WEIGHTS[1]) / n;
  }
  const highest = inside[0] || null;
  const milestones = MILESTONES.map((m) => {
    const who = inside.filter((p) => p.seat.level >= m.level).sort(byWhen)[0] || null;
    return { ...m, reached: Boolean(who), who: who ? { id: who.id, name: who.name, title: who.seat.title } : null };
  });
  return {
    score: Math.min(100, Math.round(mapped + opened)),
    mapped,
    opened: Math.round(opened * 10) / 10,
    known,
    inside: inside.length,
    accepted: inside.filter((p) => p.accepted).length,
    highest: highest ? { id: highest.id, name: highest.name, title: highest.seat.title, level: highest.seat.level } : null,
    highestSeat: highest ? highest.seat.title : null,
    milestones,
  };
}

/** "Breach 62 · highest seat VP Sales", the meter's line. */
export function meterLine(s) {
  return `Breach ${s?.score ?? 0} · ${s?.highestSeat ? `highest seat ${s.highestSeat}` : 'no one inside yet'}`;
}

// ── The plan, and acceptances ────────────────────────────────────────────────

/**
 * This week's doors: up to `weekly` people to open and connect with by hand,
 * Doors first, then the Climb, likeliest first; never anyone inside, anyone
 * with a request out, or someone who only mentions the company. The summit
 * waits until mutuals lift a seat there into the climb or the doors.
 */
export function weeklyPlan(people = [], { weekly = BREACH_WEEKLY } = {}) {
  const order = { doors: 0, climb: 1 };
  return people
    .filter((p) => !p.inside && !p.requested && p.degree !== 1 && p.employment !== 'mention' && p.band in order && p.profile_url)
    .sort((a, b) => order[a.band] - order[b.band] || b.odds - a.odds || b.power - a.power)
    .slice(0, Math.max(0, weekly));
}

/**
 * From the data already saved: who accepted (inside, after a request you sent;
 * "Check for new" brings them in as your connections) and who is still pending.
 * { accepted: [...], pending: [...] }.
 */
export function acceptances(people = []) {
  return {
    accepted: people.filter((p) => p.accepted),
    pending: people.filter((p) => p.requested && !p.inside),
  };
}

// ── Every company side by side ───────────────────────────────────────────────

/**
 * The companies in your network with their breach, built from what's saved:
 * which are open (you have 1st-degree people there now), which are cold, and
 * where a door is waiting unused (someone in the Doors band with no request
 * out). Your targets come first, then the most breached.
 * → [{ name, target, status: 'open' | 'cold', score, inside, known, doors, highestSeat }]
 */
export function compareCompanies(network = {}, { targets = [], you = {}, limit = 40, hasRequest = null } = {}) {
  const rows = [...(network.degree1 || []), ...(network.degree2 || []), ...(network.degree3 || [])];
  const index = buildCompanyIndex(rows);
  const wanted = new Map();
  for (const t of targets) {
    const name = companyName(t);
    if (name) wanted.set(companyKey(name), name);
  }
  const sized = [...index.values()]
    .filter((c) => c.people.length >= 2 && !wanted.has(companyKey(c.name)))
    .sort((a, b) => (b.d1 * 3 + b.d2 + b.d3 + b.S * 2 + b.A) - (a.d1 * 3 + a.d2 + a.d3 + a.S * 2 + a.A))
    .slice(0, Math.max(0, limit - wanted.size))
    .map((c) => c.name);
  const out = [];
  for (const name of [...wanted.values(), ...sized]) {
    const people = breachPeople(network, name, { you, hasRequest });
    const s = breachScore(people);
    out.push({
      name,
      target: wanted.has(companyKey(name)),
      status: s.inside > 0 ? 'open' : 'cold',
      score: s.score,
      inside: s.inside,
      known: s.known,
      doors: people.filter((p) => p.band === 'doors' && !p.inside && !p.requested && p.degree !== 1 && p.employment !== 'mention').length,
      highestSeat: s.highestSeat,
    });
  }
  return out.sort((a, b) => Number(b.target) - Number(a.target) || b.score - a.score || b.inside - a.inside || b.known - a.known);
}

// ── Scanning a company ───────────────────────────────────────────────────────
// LinkedIn's keyword search for the company name with the People filter
// (Blake, 2026-10-15: "search the term of the company and then click People
// yields better results, and you can still click 1st, 2nd and 3rd"), read like
// a circle: by itself or by hand, from where the last round stopped. Mapping a
// company is search pages, and the account was restricted on 10/16 for data
// volume, so a round is small and a company is mapped over days.

/** Pages in one round: a fixed set, like everything that reaches the command line. */
export const BREACH_ROUNDS = Object.freeze([3, 5, 10]);
export const BREACH_ROUND = 5;
/** LinkedIn's degree filters: 1st, 2nd, 3rd+. Your 1st are already saved, so 2nd and 3rd+ by default. */
export const BREACH_DEGREES = Object.freeze(['1', '2', '3']);
export const BREACH_DEGREES_DEFAULT = Object.freeze(['2', '3']);
/** LinkedIn's search shows 100 pages (1,000 people) at most. */
export const SEARCH_PAGES = 100;

/** The degrees asked for, as the scanner takes them: known ones, in order, else the default. */
export function breachDegrees(degrees) {
  const list = Array.isArray(degrees) ? degrees : String(degrees ?? '').split(',');
  const picked = BREACH_DEGREES.filter((d) => list.map((x) => String(x).trim()).includes(d));
  return picked.length ? picked : [...BREACH_DEGREES_DEFAULT];
}

/** The round's flags after --breach=<name> (app/api/scraper/route.js): its pages and degrees. */
export function breachRoundArgs({ pages, degrees } = {}) {
  const round = BREACH_ROUNDS.includes(pages) ? pages : BREACH_ROUND;
  return [`--round=${round}`, `--degrees=${breachDegrees(degrees).join(',')}`];
}

/** Where the scanner notes how far a company's search got (scrape.py breach_key): no profile URL can be it. */
export function breachKey(company, degrees) {
  return `breach:${companyKey(company)}:${breachDegrees(degrees).join('')}`;
}

/** The search's address, as the scanner opens it (scrape.py company_search_url). */
export function companySearchUrl(company, degrees) {
  const codes = breachDegrees(degrees).map((d) => ({ 1: 'F', 2: 'S', 3: 'O' })[d]);
  return `https://www.linkedin.com/search/results/people/?keywords=${encodeURIComponent(companyName(company))}`
    + `&network=${encodeURIComponent(JSON.stringify(codes))}&origin=FACETED_SEARCH`;
}

/**
 * The scanner's notes on company searches (bridge-progress.json, keys from
 * breachKey), for the Breach tab: { [key]: { company, pages, more, total, at } }.
 */
export function breachNotes(progress) {
  const out = {};
  for (const [key, e] of Object.entries(progress || {})) {
    if (!key.startsWith('breach:') || !e || typeof e !== 'object') continue;
    const pages = Math.max(0, Math.min(SEARCH_PAGES, Math.floor(Number(e.pages) || 0)));
    const total = Number.isFinite(Number(e.total)) && Number(e.total) > 0 ? Math.floor(Number(e.total)) : null;
    out[key] = {
      company: typeof e.name === 'string' ? e.name : null,
      pages,
      more: e.more === true && pages < SEARCH_PAGES,
      total,
      at: typeof e.at === 'string' ? e.at : null,
    };
  }
  return out;
}

/**
 * How the rest of a company's map spreads over days, one round a day:
 * { pages, left, days } (null when LinkedIn's count isn't known yet). `pages`
 * is what the search shows (100 at most), `left` what isn't read yet.
 */
export function mapSpread(note, round = BREACH_ROUND) {
  if (!note?.total) return null;
  const pages = Math.min(SEARCH_PAGES, Math.ceil(note.total / 10));
  const left = note.more ? Math.max(0, pages - note.pages) : 0;
  return { pages, left, days: Math.ceil(left / Math.max(1, round)) };
}

// ── What's kept with the network ─────────────────────────────────────────────

const text = (v, max) => (typeof v === 'string' ? v.normalize('NFKC').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max) : '');

/**
 * The Breach tab's choices (lib/settings.js): the companies you're breaching,
 * and your city and school, which make someone a door. Kept with the network.
 */
export const BREACH_SETTING = {
  default: Object.freeze({ targets: Object.freeze([]), city: '', school: '' }),
  parse(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Breach settings are a set of choices.');
    const seen = new Set();
    const targets = [];
    for (const t of Array.isArray(value.targets) ? value.targets : []) {
      const name = companyName(t);
      if (!name || seen.has(name.toLowerCase())) continue;
      seen.add(name.toLowerCase());
      targets.push(name);
      if (targets.length >= 25) break;
    }
    return { targets, city: text(value.city, 80), school: text(value.school, 80) };
  },
};
