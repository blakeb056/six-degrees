// The mutual web: two people seen together, kept as a tie (connection_ties,
// db/schema.js). Blake, 2026-10-16: "scanning always for mutuals no matter
// what ... then it should be tracked to map a web of who knows who, to have the
// artificial extended network built up past the 1k mark."
//
// Every tie comes from a page that was open anyway; nothing goes to a page to
// collect one:
//   circle       a circle scan finds one of your connections in someone's list:
//                those two know each other (app/api/ingest)
//   card         a card in any list (a circle, your connections, a company's
//                search) names your connections in its mutual line: "Maya Chen,
//                Leo Park & 103 other mutual connections" is that person tied to
//                Maya and to Leo (scripts/scrape.py mutualNames, app/api/ingest)
//   profile      a profile open in Sixgree's LinkedIn panel shows its own mutual
//                line (desktop/lib.mjs MUTUAL_WATCH_JS, POST /api/ties)
//   mutual-list  "N other mutual connections" read in full, only when you ask
//                for it, inside the day's limit (scrape.py scan_mutual_list)
//
// A tie means the two were seen together, not that they are close. By profile
// URL, the smaller first, so a pair is one row whichever page showed it; seeing
// it again adds one to its count (lib/ties-store.js). Plain functions, no
// imports: the routes, the pages and the tests read them.

/** Where a tie can be seen, in the order they're said. */
export const TIE_SOURCES = Object.freeze(['circle', 'card', 'profile', 'mutual-list']);

/** At most this many names a mutual line, a card or a profile is taken to name (LinkedIn shows two or three). */
export const MAX_NAMED = 3;

/** The pairs to keep: the circle's person with each of your connections in it, each pair once, smaller URL first. */
export function tiePairs(ownerUrl, urls = []) {
  const seen = new Set();
  const out = [];
  if (!ownerUrl) return out;
  for (const url of urls) {
    const pair = orderPair(ownerUrl, url);
    if (!pair) continue;
    const key = `${pair.a_url} ${pair.b_url}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(pair);
  }
  return out;
}

/** Two profile URLs as a tie's row has them, the smaller first; null for one missing or both the same. */
export function orderPair(x, y) {
  if (!x || !y || x === y) return null;
  return x < y ? { a_url: x, b_url: y } : { a_url: y, b_url: x };
}

/**
 * A LinkedIn profile link as ties keep it, the way the scanner stores a
 * profile_url: https://www.linkedin.com/in/<slug>/, the query and anything
 * after the slug taken off, the slug as it was written. null for anything
 * that isn't a profile link.
 */
export function tieUrl(raw) {
  const s = String(raw ?? '').trim();
  if (!s || s.length > 400 || /[\u0000-\u001f\s]/.test(s)) return null;
  const m = s.match(/^(?:https?:\/\/(?:[a-z0-9-]+\.)*linkedin\.com)?\/in\/([^/?#]+)/i);
  if (!m || !m[1] || m[1].length > 200) return null;
  return `https://www.linkedin.com/in/${m[1]}/`;
}

/**
 * A profile link as a scan sent it, its query and fragment taken off, or null
 * for anything that isn't one: ties keep the link the network keeps
 * (app/api/ingest stores a card's profileUrl as it came), so the two match.
 */
export function asSent(raw) {
  if (!tieUrl(raw)) return null;
  return String(raw).trim().split(/[?#]/)[0];
}

/** The same person whatever case or escaping a link used: the slug, decoded, lower case. Matches a tie's end to a row. */
export function urlKey(url) {
  const m = String(url ?? '').match(/\/in\/([^/?#]+)/i);
  if (!m) return null;
  let slug = m[1];
  try { slug = decodeURIComponent(slug); } catch { /* kept as written */ }
  slug = slug.trim().toLowerCase();
  return slug || null;
}

/** A tie's sources with one more, each once, in the order first seen: "circle,card". */
export function mergeSources(have, add) {
  const list = String(have || '').split(',').map((s) => s.trim()).filter(Boolean);
  if (add && TIE_SOURCES.includes(add) && !list.includes(add)) list.push(add);
  return list.join(',');
}

/** A name as a card or a line gave it: one line, at most 120 letters, or ''. */
export function cleanName(raw) {
  const s = String(raw ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
  return s.length >= 2 && s.length <= 120 && s !== 'LinkedIn Member' ? s : '';
}

/**
 * The named mutuals a card (or a profile, or a list) carries, cleaned:
 * [{ profileUrl, name }], each link once, at most `max`, never the card's own
 * person. Anything not a profile link is left out.
 */
export function namedMutuals(list, { self = null, max = MAX_NAMED } = {}) {
  const out = [];
  const seen = new Set();
  const own = self ? urlKey(self) : null;
  for (const m of Array.isArray(list) ? list : []) {
    const url = asSent(m?.profileUrl ?? m?.url);
    const key = url && urlKey(url);
    if (!key || key === own || seen.has(key)) continue;
    seen.add(key);
    out.push({ profileUrl: url, name: cleanName(m?.name) });
    if (out.length >= max) break;
  }
  return out;
}

/**
 * The ties a scan's cards carry (scrape.py mutualNames, sent with each card to
 * /api/ingest): { pairs: [{ a_url, b_url }], cards, named: [{ profileUrl, name }] }.
 * Each pair once, however many cards showed it in one batch (a sighting is a
 * card read, and a batch is one read); `cards` is how many cards named
 * someone, for the web's size (Settings → Your data). `named` is everyone a
 * mutual line named, each once: your own connections, by LinkedIn's word.
 */
export function cardTies(cards = []) {
  const seen = new Set();
  const pairs = [];
  const named = new Map();
  let count = 0;
  for (const c of Array.isArray(cards) ? cards : []) {
    const self = asSent(c?.profileUrl);
    if (!self) continue;
    const mutuals = namedMutuals(c?.mutualNames, { self });
    if (!mutuals.length) continue;
    count += 1;
    for (const m of mutuals) {
      if (!named.has(m.profileUrl)) named.set(m.profileUrl, m);
      const pair = orderPair(self, m.profileUrl);
      const key = pair && `${pair.a_url} ${pair.b_url}`;
      if (!pair || seen.has(key)) continue;
      seen.add(key);
      pairs.push(pair);
    }
  }
  return { pairs, cards: count, named: [...named.values()] };
}

/**
 * LinkedIn's mutual line read for its names and its count, English only:
 *   "Maya Chen is a mutual connection"                 → { names: ['Maya Chen'], count: 1 }
 *   "Maya Chen and Leo Park are mutual connections"    → { names: [both], count: 2 }
 *   "Maya Chen, Leo Park & 103 other mutual connections" → { names: [both], count: 105 }
 *   "12 mutual connections"                            → { names: [], count: 12 }
 * null for any other line. The count is read as the page readers read it
 * (scrape.py BRIDGE_RESULTS_JS mutualCount), so the two never disagree.
 */
export function mutualLine(text) {
  const l = String(text ?? '').replace(/\s+/g, ' ').trim();
  if (!/\bmutual connections?$/i.test(l) || l.length > 300) return null;
  const num = (s) => Number(String(s).replace(/,/g, ''));
  const split = (s) => s.split(/\s*,\s*|\s+(?:and|&)\s+/).map(cleanName).filter(Boolean);
  let m = l.match(/^([\d,]+) mutual connections?$/i);
  if (m) return { names: [], count: num(m[1]) };
  m = l.match(/^(.*?)\s*(?:\band|&) ([\d,]+) others? mutual connections?$/i);
  if (m) {
    const names = split(m[1]);
    return { names: names.slice(0, MAX_NAMED), count: Math.max(1, names.length) + num(m[2]) };
  }
  m = l.match(/^(.+?) is a mutual connection$/i);
  if (m) {
    const names = split(m[1]);
    return { names: names.slice(0, 1), count: 1 };
  }
  m = l.match(/^(.+?)\s+are mutual connections$/i);
  if (m) {
    const names = split(m[1]);
    return { names: names.slice(0, MAX_NAMED), count: names.length };
  }
  return null;
}

/**
 * Which of your connections in a circle's batch the page listed as people of
 * that circle, for its ties. A card's mutual line names your connections who
 * know that card's person (scrape.py mutualNames), and the scanner sends those
 * names as people too: someone the batch has only as such a name, with no card
 * of their own (no mutual line under them), may not know the circle's person
 * at all. A scanner from before mutualNames sends none: every one, as before.
 */
export function circleTieUrls(connections = [], connected = []) {
  const named = new Set();
  const carded = new Set();
  for (const c of Array.isArray(connections) ? connections : []) {
    const url = c?.profileUrl?.trim();
    if (!url) continue;
    const mutuals = namedMutuals(c?.mutualNames, { self: url });
    for (const m of mutuals) named.add(m.profileUrl);
    if (mutuals.length || c?.mutualCount != null) carded.add(url);
  }
  if (!named.size) return connected;
  return connected.filter((url) => carded.has(url) || !named.has(asSent(url) || url));
}
