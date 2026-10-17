// The mutual web's writes and reads (lib/ties.js says what a tie is). Server
// only: it holds the database (lib/db-client.js), straight through SQL, since a
// tie seen again is one statement that adds to its count.
//
//   recordTies     ties seen now: new ones kept, known ones counted again
//   keepTiePeople  someone seen only through ties, kept with what's known (a
//                  name and a link), marked seen_via 'ties': never a scan's
//   resolveNamed   a profile's mutual line names people, without links: the
//                  names matched to your own connections, one each
//   tiesOf, allTies, webSize   the read side (GET /api/ties, /api/network)

import { getDb, newId, nowIso } from './db-client.js';
import { TIE_SOURCES, orderPair, urlKey, cleanName, tieUrl, asSent } from './ties.js';

/** app_meta's key for how many cards, profiles and full lists named someone (webSize). */
export const WEB_COUNTS_KEY = 'mutual_web_counts';

/**
 * Keep ties seen now: [{ a_url, b_url }] (lib/ties.js orderPair), each from
 * `source`. A new pair is kept; a pair already kept is seen once more (its
 * `seen_count` up one, `last_seen` now) and gains the source if it's new to it.
 * One transaction. → { added, again }.
 */
export function recordTies(db, { userId, pairs = [], source, at = nowIso() } = {}) {
  if (!userId || !TIE_SOURCES.includes(source) || !pairs.length) return { added: 0, again: 0 };
  const has = db.prepare('SELECT 1 FROM connection_ties WHERE user_id = ? AND a_url = ? AND b_url = ?');
  const put = db.prepare(`
    INSERT INTO connection_ties (id, user_id, a_url, b_url, seen_at, source, seen_count, last_seen)
    VALUES (?, ?, ?, ?, ?, ?, 1, ?)
    ON CONFLICT (user_id, a_url, b_url) DO UPDATE SET
      seen_count = COALESCE(connection_ties.seen_count, 1) + 1,
      last_seen  = excluded.last_seen,
      source     = CASE
        WHEN connection_ties.source IS NULL OR connection_ties.source = '' THEN excluded.source
        WHEN instr(',' || connection_ties.source || ',', ',' || excluded.source || ',') > 0 THEN connection_ties.source
        ELSE connection_ties.source || ',' || excluded.source
      END`);
  let added = 0;
  let again = 0;
  const seen = new Set();
  db.exec('BEGIN');
  try {
    for (const p of pairs) {
      const pair = orderPair(p?.a_url, p?.b_url);
      if (!pair) continue;
      const key = `${pair.a_url} ${pair.b_url}`;
      if (seen.has(key)) continue;
      seen.add(key);
      if (has.get(userId, pair.a_url, pair.b_url)) again += 1;
      else added += 1;
      put.run(newId(), userId, pair.a_url, pair.b_url, at, source, at);
    }
    db.exec('COMMIT');
  } catch (err) {
    try { db.exec('ROLLBACK'); } catch { /* nothing open */ }
    throw err;
  }
  return { added, again };
}

/** Add to the web's counts (cards, profiles, lists read that named someone). Best effort. */
export function countWeb(db, add = {}) {
  try {
    const now = readCounts(db);
    for (const k of ['cards', 'profiles', 'lists']) now[k] += Math.max(0, Math.floor(Number(add[k]) || 0));
    db.prepare('INSERT INTO app_meta (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value')
      .run(WEB_COUNTS_KEY, JSON.stringify(now));
  } catch { /* the size is a nicety; the ties are kept */ }
}

function readCounts(db) {
  const out = { cards: 0, profiles: 0, lists: 0 };
  try {
    const row = db.prepare('SELECT value FROM app_meta WHERE key = ?').get(WEB_COUNTS_KEY);
    const v = row ? JSON.parse(row.value) : {};
    for (const k of Object.keys(out)) out[k] = Math.max(0, Math.floor(Number(v?.[k]) || 0));
  } catch { /* none yet */ }
  return out;
}

/**
 * The web's size, as Settings → Your data says it: { ties, cards, profiles,
 * lists, people, bySource }. `people` is everyone known only through ties.
 */
export function webSize(db = getDb(), userId = null) {
  const out = { ties: 0, cards: 0, profiles: 0, lists: 0, people: 0, bySource: {} };
  try {
    const where = userId ? ' WHERE user_id = ?' : '';
    const args = userId ? [userId] : [];
    out.ties = db.prepare(`SELECT count(*) AS n FROM connection_ties${where}`).get(...args).n;
    for (const s of TIE_SOURCES) {
      out.bySource[s] = db.prepare(
        `SELECT count(*) AS n FROM connection_ties${where ? `${where} AND` : ' WHERE'} instr(',' || COALESCE(source, 'circle') || ',', ?) > 0`,
      ).get(...args, `,${s},`).n;
    }
    out.people = db.prepare(
      `SELECT count(DISTINCT profile_url) AS n FROM linkedin_connections WHERE seen_via = 'ties'${userId ? ' AND user_id = ?' : ''}`,
    ).get(...args).n;
  } catch { /* an older database: none yet */ }
  Object.assign(out, readCounts(db));
  return out;
}

/** A tie row as the read side gives it: { a, b, n, last, first, sources }. */
function shape(r) {
  return {
    a: r.a_url,
    b: r.b_url,
    n: Math.max(1, Number(r.seen_count) || 1),
    first: r.seen_at || null,
    last: r.last_seen || r.seen_at || null,
    sources: String(r.source || 'circle').split(',').filter(Boolean),
  };
}

/** Every tie of one person (by their profile URL), newest seen first. */
export function tiesOf(db, userId, url) {
  // As the network keeps it, and in the form a panel's link takes (lib/ties.js tieUrl).
  const forms = [...new Set([asSent(url), tieUrl(url)].filter(Boolean))];
  if (!userId || !forms.length) return [];
  const marks = forms.map(() => '?').join(', ');
  return db.prepare(`
    SELECT a_url, b_url, seen_at, source, seen_count, last_seen FROM connection_ties
    WHERE user_id = ? AND (a_url IN (${marks}) OR b_url IN (${marks}))
    ORDER BY COALESCE(last_seen, seen_at) DESC`).all(userId, ...forms, ...forms).map(shape);
}

/** Every tie (of one profile, when given), for the views (GET /api/ties) and the extended network (/api/network). */
export function allTies(db, userId) {
  try {
    const cols = 'SELECT a_url, b_url, seen_at, source, seen_count, last_seen FROM connection_ties';
    return (userId ? db.prepare(`${cols} WHERE user_id = ?`).all(userId) : db.prepare(cols).all()).map(shape);
  } catch {
    return [];
  }
}

/**
 * Ties packed for the page: one list of profile URLs and each tie as
 * [a, b, n, last, sources] with a and b indexes into it. A web of thousands of
 * ties is a few hundred kilobytes, not megabytes.
 */
export function packTies(ties = []) {
  const urls = [];
  const at = new Map();
  const index = (u) => {
    if (!at.has(u)) { at.set(u, urls.length); urls.push(u); }
    return at.get(u);
  };
  return { urls, ties: ties.map((t) => [index(t.a), index(t.b), t.n, t.last, t.sources.join(',')]) };
}

/**
 * A profile's mutual line names people without links ("Maya Chen, Leo Park and
 * 103 other mutual connections"): LinkedIn says they're your connections, so
 * each name is looked for among them. A name two of your connections share, or
 * none has, is left out: no tie is better than a wrong one. → [{ profileUrl, name }].
 */
export function resolveNamed(db, userId, names = []) {
  const want = names.map(cleanName).filter(Boolean);
  if (!userId || !want.length) return [];
  const out = [];
  const find = db.prepare('SELECT DISTINCT profile_url FROM linkedin_connections WHERE user_id = ? AND degree = 1 AND name = ? COLLATE NOCASE');
  for (const name of want) {
    const rows = find.all(userId, name);
    if (rows.length !== 1) continue;
    const url = tieUrl(rows[0].profile_url);
    if (url) out.push({ profileUrl: url, name });
  }
  return out;
}

/**
 * Someone a tie names who isn't in the network at all (a profile opened in the
 * panel, say): kept as a person with what's known, a name and a link, at the
 * 2nd degree (they know one of your connections), in nobody's circle, marked
 * seen_via 'ties'. Never counted as scanned: /api/network keeps them out of the
 * scanned rows and shows them only through their ties (lib/mutual-web.js).
 * Anyone with a row already is left as they are. → how many were kept.
 */
export function keepTiePeople(db, userId, people = []) {
  if (!userId) return 0;
  const known = db.prepare('SELECT 1 FROM linkedin_connections WHERE user_id = ? AND lower(profile_url) = lower(?) LIMIT 1');
  const put = db.prepare(`
    INSERT OR IGNORE INTO linkedin_connections (id, degree, name, headline, profile_url, user_id, seen_via, created_at, updated_at)
    VALUES (?, 2, ?, '', ?, ?, 'ties', ?, ?)`);
  let kept = 0;
  const now = nowIso();
  const seen = new Set();
  for (const p of people) {
    const url = tieUrl(p?.profileUrl);
    const name = cleanName(p?.name);
    const key = url && urlKey(url);
    if (!url || !name || seen.has(key)) continue;
    seen.add(key);
    if (known.get(userId, url)) continue;
    kept += put.run(newId(), name, url, userId, now, now).changes;
  }
  return kept;
}
