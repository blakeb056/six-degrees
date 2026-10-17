import { getDb } from '../../../lib/db-client';
import { db as supabase } from '../../../lib/db';
import { resolveProfile } from '../../../lib/profile';
import { mutualCountOf } from '../../../lib/ingest';
import { tieUrl, urlKey, cleanName, namedMutuals, mutualLine, orderPair } from '../../../lib/ties';
import {
  recordTies, countWeb, webSize, tiesOf, allTies, packTies, resolveNamed, keepTiePeople,
} from '../../../lib/ties-store';

// The mutual web (lib/ties.js): who was seen with whom.
//
// GET                 every tie, packed ({ urls, ties: [[a, b, n, last, sources]] },
//                     lib/ties-store.js packTies; lib/mutual-web.js unpackTies reads it)
// GET ?url=<profile>  one person's ties, the other end named where they're on file:
//                     { ties: [{ url, name, id, degree, n, first, last, sources }] }
// GET ?summary=1      the web's size (Settings → Your data): { ties, cards, profiles,
//                     lists, people, bySource }
//
// POST { source, person: { profileUrl, name, degree? }, mutuals: [{ profileUrl?, name }],
//        line?, list?, userId? } → { ok, added, again, people }
//   source 'profile'      a profile open in Sixgree's LinkedIn panel, its mutual line
//                         read where it already was (desktop/main.mjs, MUTUAL_WATCH_JS).
//                         The line's names have no links: each is matched to one of your
//                         connections by name, or left out (resolveNamed)
//   source 'mutual-list'  "N other mutual connections" read in full, a job you started
//                         (scrape.py scan_mutual_list); `list: true` on its first save
// Someone a tie names who isn't on file is kept with their name and link, marked
// seen_via 'ties' (keepTiePeople): never a scan's, never counted as one. Nothing
// here opens LinkedIn.

/** The profile the ties are kept under: the one asked for when it exists, else this machine's (lib/profile.js). */
function owner(asked) {
  const me = resolveProfile({ create: false });
  if (typeof asked === 'string' && /^[\w-]{1,64}$/.test(asked)) {
    try {
      if (getDb().prepare('SELECT 1 FROM users WHERE id = ?').get(asked)) return asked;
    } catch { /* below */ }
  }
  return me?.id || null;
}

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const userId = owner(searchParams.get('userId'));
    const db = getDb();
    if (searchParams.get('summary')) return Response.json(webSize(db, userId));
    const url = searchParams.get('url');
    if (url !== null) {
      const u = tieUrl(url);
      if (!u) return Response.json({ error: 'That isn’t a LinkedIn profile link.' }, { status: 400 });
      const rows = tiesOf(db, userId, url.trim());
      const who = db.prepare('SELECT id, name, degree FROM linkedin_connections WHERE user_id = ? AND lower(profile_url) = lower(?) ORDER BY degree LIMIT 1');
      const ties = rows.map((t) => {
        const other = urlKey(t.a) === urlKey(u) ? t.b : t.a;
        const row = who.get(userId, other);
        return { url: other, name: row?.name || null, id: row?.id || null, degree: row?.degree ?? null,
          n: t.n, first: t.first, last: t.last, sources: t.sources };
      });
      return Response.json({ ties });
    }
    return Response.json(packTies(allTies(db, userId)));
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 });
  }
}

/** The most named mutuals one POST carries: ten pages of a full list. */
const MOST = 200;

export async function POST(request) {
  let body = {};
  try { body = await request.json(); } catch { /* said below */ }
  const source = body?.source;
  if (source !== 'profile' && source !== 'mutual-list') {
    return Response.json({ error: 'A tie comes from a profile or a mutual list.' }, { status: 400 });
  }
  const asked = tieUrl(body?.person?.profileUrl);
  if (!asked) return Response.json({ error: 'That isn’t a LinkedIn profile link.' }, { status: 400 });
  const list = Array.isArray(body?.mutuals) ? body.mutuals : [];
  if (list.length > MOST) return Response.json({ error: `Send at most ${MOST} at a time.` }, { status: 400 });
  try {
    const db = getDb();
    const userId = owner(body?.userId);
    if (!userId) return Response.json({ error: 'There is no network to keep ties in yet.' }, { status: 409 });

    // Each link as the network has it, so a pair is one tie whatever case a page wrote.
    const stored = db.prepare('SELECT profile_url FROM linkedin_connections WHERE user_id = ? AND lower(profile_url) = lower(?) LIMIT 1');
    const asKept = (u) => tieUrl(stored.get(userId, u)?.profile_url) || u;
    const url = asKept(asked);
    // The names with links, then the line's names matched to your connections.
    const mutuals = namedMutuals(list, { self: url, max: MOST }).map((m) => ({ ...m, profileUrl: asKept(m.profileUrl) }));
    const read = typeof body?.line === 'string' ? mutualLine(body.line) : null;
    const unlinked = [...(read?.names || []), ...list.filter((m) => !tieUrl(m?.profileUrl)).map((m) => m?.name)]
      .map(cleanName).filter(Boolean);
    const have = new Set(mutuals.map((m) => urlKey(m.profileUrl)));
    for (const m of resolveNamed(db, userId, unlinked)) {
      if (urlKey(m.profileUrl) === urlKey(url) || have.has(urlKey(m.profileUrl))) continue;
      have.add(urlKey(m.profileUrl));
      mutuals.push(m);
    }

    // Someone not on file: kept with what's known, unless the page said they're
    // your own connection (a 1st-degree profile; the next Check for new brings them).
    let people = 0;
    const name = cleanName(body?.person?.name);
    const yours = /^1/.test(String(body?.person?.degree ?? ''));
    if (mutuals.length && name && !yours) people = keepTiePeople(db, userId, [{ profileUrl: url, name }]);

    const pairs = mutuals.map((m) => orderPair(url, m.profileUrl)).filter(Boolean);
    const kept = recordTies(db, { userId, pairs, source });

    // The line's own count is LinkedIn's count of the mutuals you share: every copy of
    // them past the 1st degree gets it, as a scan's card does (app/api/ingest).
    const count = read ? mutualCountOf(read.count) : null;
    if (source === 'profile' && count) {
      db.prepare('UPDATE linkedin_connections SET mutual_count = ? WHERE user_id = ? AND lower(profile_url) = lower(?) AND degree IN (2, 3)')
        .run(count, userId, url);
    }
    if (pairs.length) countWeb(db, source === 'profile' ? { profiles: 1 } : { lists: body?.list === true ? 1 : 0 });
    // A person kept here has no score yet: everyone is scored as after a scan.
    if (people) {
      try { await supabase.rpc('score_new_connections'); } catch { /* scoring is best-effort */ }
    }
    return Response.json({ ok: true, added: kept.added, again: kept.again, people });
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 });
  }
}
