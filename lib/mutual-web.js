// The mutual web, read: who your connections know beyond what a scan of their
// circle read, and how you know someone. Ties are kept by lib/ties-store.js
// (what a tie is: lib/ties.js); this works out what they mean for the views.
//
//   extendedNetwork  everyone a tie links to one of your connections, attached
//                    to that connection as "seen outside the scan": a 2nd-degree
//                    candidate even when their circle stopped at LinkedIn's
//                    1,000 or was never scanned (/api/network `seen`)
//   tieIndex, knownThrough, knownThroughText
//                    "Known through: Maya Chen, Leo Park (seen together 3 times,
//                    last on Oct 16, 2026)" on a person's card and in the focus
//   tieLines         Show ties: thin lines between people who know each other,
//                    for the selection only, never the whole web at once
//   unpackTies       GET /api/ties' packed answer, as ties
//
// A tie says two people were seen together, never that they are close: the
// words say "seen together", with how often and when. Plain functions, no
// imports beyond lib/ties.js: the pages, the routes and the tests read them.

import { urlKey } from './ties.js';

/** The ties' one colour, in every look: a line that reads as no tier and no degree. */
export const TIE_COLOUR = 'var(--sd-tie, #ff7ab6)';

/** At most this many lines Show ties draws at once: a selection, not a hairball. */
export const MAX_TIE_LINES = 240;

/** GET /api/ties' { urls, ties: [[a, b, n, last, sources]] } as [{ a, b, n, last, sources }]. */
export function unpackTies(payload) {
  const urls = Array.isArray(payload?.urls) ? payload.urls : [];
  const out = [];
  for (const t of Array.isArray(payload?.ties) ? payload.ties : []) {
    if (!Array.isArray(t)) continue;
    const a = urls[t[0]];
    const b = urls[t[1]];
    if (typeof a !== 'string' || typeof b !== 'string') continue;
    out.push({
      a, b,
      n: Math.max(1, Number(t[2]) || 1),
      last: typeof t[3] === 'string' ? t[3] : null,
      sources: String(t[4] || 'circle').split(',').filter(Boolean),
    });
  }
  return out;
}

/** Each person's ties, by urlKey: Map(key → [{ key, url, n, last, sources }]). */
export function tieIndex(ties = []) {
  const by = new Map();
  const add = (from, to, t) => {
    const k = urlKey(from);
    const other = urlKey(to);
    if (!k || !other || k === other) return;
    if (!by.has(k)) by.set(k, []);
    by.get(k).push({ key: other, url: to, n: t.n || 1, last: t.last || null, sources: t.sources || [] });
  };
  for (const t of ties) {
    add(t.a, t.b, t);
    add(t.b, t.a, t);
  }
  return by;
}

/** Your connections by urlKey (the first row of each). */
export function firstDegreeByKey(degree1 = []) {
  const m = new Map();
  for (const r of degree1) {
    const k = urlKey(r?.profile_url);
    if (k && !m.has(k)) m.set(k, r);
  }
  return m;
}

/** The row that best says who someone is: a circle's (highest scored), then a company scan's, then one known only through ties. */
function better(a, b) {
  if (!a) return b;
  const rank = (r) => (r.seen_via === 'ties' ? 0 : Number(r.degree) === 2 ? 2 : 1);
  if (rank(b) !== rank(a)) return rank(b) > rank(a) ? b : a;
  return (Number(b.power_score) || 0) > (Number(a.power_score) || 0) ? b : a;
}

/**
 * Everyone a tie links to one of your connections who isn't already in that
 * connection's scanned circle, as rows for the views: a copy of their best row
 * (a circle's, a company scan's, or the one kept for someone known only through
 * ties), attached to the connection like a circle's row, and marked:
 *   id                    `seen:<connection id>:<their row id>` (one per connection)
 *   person_id             their own row's id (requests, opening their card)
 *   degree                2, source_connection_id the connection
 *   seen_outside          true: seen outside the scan, never counted as scanned
 *   seen_with             { n, last, sources }: the tie that put them here
 * Ties between two of your connections, or between two people neither of whom
 * is yours, attach nobody. `tiePeople` are the rows kept for people known only
 * through ties (seen_via 'ties'), which the scanned lists leave out.
 */
export function extendedNetwork({ degree1 = [], degree2 = [], degree3 = [], tiePeople = [], ties = [] } = {}) {
  const mine = firstDegreeByKey(degree1);
  const inCircle = new Set();
  const people = new Map();
  for (const r of degree2) {
    const k = urlKey(r?.profile_url);
    if (!k) continue;
    if (r.source_connection_id != null) inCircle.add(`${r.source_connection_id}|${k}`);
    people.set(k, better(people.get(k), r));
  }
  for (const r of [...degree3, ...tiePeople]) {
    const k = urlKey(r?.profile_url);
    if (k) people.set(k, better(people.get(k), r));
  }
  const out = [];
  const made = new Set();
  for (const t of ties) {
    const ka = urlKey(t.a);
    const kb = urlKey(t.b);
    if (!ka || !kb || ka === kb) continue;
    const ma = mine.get(ka);
    const mb = mine.get(kb);
    if (Boolean(ma) === Boolean(mb)) continue;   // both yours, or neither
    const via = ma || mb;
    const key = ma ? kb : ka;
    const row = people.get(key);
    if (!row || inCircle.has(`${via.id}|${key}`)) continue;
    const id = `seen:${via.id}:${row.id}`;
    if (made.has(id)) continue;
    made.add(id);
    out.push({
      ...row,
      id,
      person_id: row.id,
      degree: 2,
      source_connection_id: via.id,
      seen_outside: true,
      seen_with: { n: t.n || 1, last: t.last || null, sources: t.sources || [] },
    });
  }
  return out;
}

/**
 * How you know someone, through the web: [{ id, name, tier, n, last, sources }],
 * each of your connections once, most seen first. A tie to them counts with
 * its sightings; a scanned circle they sit in counts as one sighting of its
 * own (`circles`: their rows in someone's circle), unless a tie says more.
 * Your connections only: a tie between two people you don't know says
 * nothing about how you'd reach them.
 */
export function knownThrough(url, { index, mine, circles = [], d1ById = null } = {}) {
  const key = urlKey(url);
  if (!key) return [];
  const by = new Map();
  for (const t of index?.get(key) || []) {
    const r = mine?.get(t.key);
    if (!r) continue;
    const had = by.get(r.id);
    if (had) {
      had.n += t.n;
      if (String(t.last || '') > String(had.last || '')) had.last = t.last;
      for (const s of t.sources) if (!had.sources.includes(s)) had.sources.push(s);
    } else {
      by.set(r.id, { id: r.id, name: r.name, tier: r.tier || null, n: t.n, last: t.last, sources: [...t.sources] });
    }
  }
  for (const row of circles) {
    const bridge = d1ById?.get(row?.source_connection_id);
    if (!bridge || row.seen_outside) continue;
    const had = by.get(bridge.id);
    const when = row.updated_at || row.created_at || null;
    if (had) {
      if (!had.sources.includes('circle')) had.sources.push('circle');
      continue;
    }
    by.set(bridge.id, { id: bridge.id, name: bridge.name, tier: bridge.tier || null, n: 1, last: when, sources: ['circle'] });
  }
  return [...by.values()].sort((a, b) => b.n - a.n || String(b.last || '').localeCompare(String(a.last || '')) || String(a.name).localeCompare(String(b.name)));
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** A tie's date as the card says it, on this computer's calendar: "Oct 16, 2026"; '' when unknown. */
export function seenOn(iso) {
  const d = iso ? new Date(iso) : null;
  if (!d || Number.isNaN(d.getTime())) return '';
  return `${MONTHS[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
}

/** "once", "twice", "3 times". */
export const timesSeen = (n) => (n === 1 ? 'once' : n === 2 ? 'twice' : `${n} times`);

/**
 * The line: "Known through: Maya Chen, Leo Park (seen together 3 times, last on
 * Oct 16, 2026)". The first `names` of them, then "and N more"; the count is
 * every sighting of them with this person, the date the latest. '' for nobody.
 */
export function knownThroughText(entries = [], { names = 3, lead = 'Known through' } = {}) {
  if (!entries.length) return '';
  const shown = entries.slice(0, names).map((e) => e.name || 'someone');
  const more = entries.length - shown.length;
  const who = more > 0 ? `${shown.join(', ')} and ${more} more` : shown.join(', ');
  const n = entries.reduce((s, e) => s + (Number(e.n) || 1), 0);
  const last = entries.reduce((m, e) => (String(e.last || '') > String(m || '') ? e.last : m), null);
  const on = seenOn(last);
  return `${lead}: ${who} (seen together ${timesSeen(n)}${on ? `, last on ${on}` : ''})`;
}

/**
 * Show ties' lines for what's selected, never the whole web: [{ a, b, n }] as
 * the view's own ids. `onScreen` maps a urlKey to the id its dot has (one dot
 * per person). With `selected` (a urlKey), the lines from them to everyone they
 * were seen with who is on screen; with `among` (urlKeys, a focus's people),
 * the lines between any two of them. Most seen first, at most `max`.
 */
export function tieLines({ index, onScreen, selected = null, among = null, max = MAX_TIE_LINES } = {}) {
  if (!index || !onScreen) return [];
  const out = [];
  const seen = new Set();
  const push = (ka, kb, n) => {
    const a = onScreen.get(ka);
    const b = onScreen.get(kb);
    if (a == null || b == null || a === b) return;
    const key = ka < kb ? `${ka} ${kb}` : `${kb} ${ka}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ a, b, n });
  };
  if (selected) {
    for (const t of index.get(selected) || []) push(selected, t.key, t.n);
  } else if (among) {
    const set = among instanceof Set ? among : new Set(among);
    for (const k of set) for (const t of index.get(k) || []) if (set.has(t.key)) push(k, t.key, t.n);
  }
  return out.sort((x, y) => y.n - x.n).slice(0, max);
}

// ── Read all mutuals: the paid step ──────────────────────────────────────────
// "N other mutual connections" read in full, one round at a time, only when you
// press it (scrape.py scan_mutual_list, POST /api/scraper action 'mutuals').
// Each page is a search counted in the day's limit, so it is offered only where
// it matters: Breach's Summit and your top-tier bridges.

/** Pages a round may be: a fixed set, like everything that reaches the command line. */
export const MUTUAL_ROUNDS = Object.freeze([3, 5, 10]);
export const MUTUAL_ROUND = 5;

/** The round's pages as the scanner takes them (--round=N). */
export function mutualRound(pages) {
  return MUTUAL_ROUNDS.includes(pages) ? pages : MUTUAL_ROUND;
}

/** Where the scanner notes how far one person's full list got (scrape.py mutuals_key). */
export const mutualsKey = (profileUrl) => `mutuals:${profileUrl}`;

/**
 * The scanner's notes on full mutual lists (bridge-progress.json), by profile
 * URL: { [url]: { pages, more, total, at } }, for the buttons' "carries on from
 * page N" and "every page read".
 */
export function mutualNotes(progress) {
  const out = {};
  for (const [key, e] of Object.entries(progress || {})) {
    if (!key.startsWith('mutuals:') || !e || typeof e !== 'object') continue;
    const pages = Math.max(0, Math.min(100, Math.floor(Number(e.pages) || 0)));
    const total = Number.isFinite(Number(e.total)) && Number(e.total) > 0 ? Math.floor(Number(e.total)) : null;
    out[key.slice('mutuals:'.length)] = { pages, more: e.more === true && pages < 100, total, at: typeof e.at === 'string' ? e.at : null };
  }
  return out;
}

/**
 * Who Read all mutuals is offered for: one of your connections in the top
 * tiers (S or A), whose list is worth a few searches, or a Breach Summit
 * target (`summit`, from the Breach tab). Never someone known only through
 * ties, whose profile was never opened by a scan.
 */
export function offersMutualList(person, { summit = false } = {}) {
  if (!person?.profile_url || person.seen_via === 'ties') return false;
  if (summit) return true;
  return Number(person.degree) === 1 && (person.tier === 'S' || person.tier === 'A');
}

/** What the button says about a list read before: '' when never, else how far. */
export function mutualListNote(note) {
  if (!note || !note.pages) return '';
  if (!note.more) return 'every page read';
  return `carries on from page ${note.pages + 1}`;
}

// ── The web's size (Settings → Your data) ────────────────────────────────────

const num = (n) => Number(n || 0).toLocaleString('en-US');
const many = (n, one, more = `${one}s`) => `${num(n)} ${Number(n) === 1 ? one : more}`;

/**
 * "1,240 ties from 3,100 cards, 12 profiles and circle scans", from
 * lib/ties-store.js webSize. Said as what was seen, never as the whole web: a
 * card names two or three of the mutuals, so it grows with use.
 */
export function webLine(size) {
  const ties = Number(size?.ties) || 0;
  if (!ties) return 'No ties yet: they gather as scans read cards with mutual lines, and as profiles open in Sixgree’s browser.';
  const from = [
    size.cards ? many(size.cards, 'card') : null,
    size.profiles ? many(size.profiles, 'profile') : null,
    size.lists ? many(size.lists, 'full list') : null,
    Number(size.bySource?.circle) ? 'circle scans' : null,
  ].filter(Boolean);
  const tail = from.length ? ` from ${from.length > 1 ? `${from.slice(0, -1).join(', ')} and ${from[from.length - 1]}` : from[0]}` : '';
  const people = size.people ? `; ${many(size.people, 'person', 'people')} known only through them` : '';
  return `${many(ties, 'tie')}${tail}${people}. Seen together, not close.`;
}
