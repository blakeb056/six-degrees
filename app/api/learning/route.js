import { getDb } from '../../../lib/db-client';
import { dataDir } from '../../../lib/paths';
import {
  recordExposure, recordInteraction, logStats, since, byPerson, outcomes, mirrorAccountLoad, EXPOSURE_LISTS, CLIENT_INTERACTIONS, EXPOSURE_TOP, personKey,
} from '../../../lib/learning-log';

// The learning log's read API and the pages' events (lib/learning-log.js).
// Local only: this route reads and writes this computer's database, nothing
// else, and nothing in the log is ever sent anywhere.
//
// GET  ?stats=1                 the log's size (and the account's load mirrored first)
//      ?since=<ISO>&kind=&type=  events since a time, oldest first
//      ?person=<profile url or key>  one person's events
//      ?outcomes=1               every request's story: sent, accepted or pending
// POST { event: 'exposure', list, sort?, context?, people: [{ id?, profile_url? }] }
//      { event: 'interaction', type, id?, profile_url?, data? }

const MAX_PEOPLE = EXPOSURE_TOP;

/** The rows on file for some people, by id, else by profile link; someone not on file stays a key. */
function rowsFor(db, people = []) {
  const byId = db.prepare('SELECT * FROM linkedin_connections WHERE id = ?');
  const byUrl = db.prepare('SELECT * FROM linkedin_connections WHERE profile_url = ? ORDER BY degree LIMIT 1');
  return people.slice(0, MAX_PEOPLE).map((p) => {
    const id = typeof p?.id === 'string' || typeof p?.id === 'number' ? String(p.id).slice(0, 80) : null;
    const url = typeof p?.profile_url === 'string' ? p.profile_url.slice(0, 300) : null;
    return (id && byId.get(id)) || (url && byUrl.get(url)) || (url ? { profile_url: url } : id ? { id } : null);
  }).filter(Boolean);
}

const cleanData = (d) => {
  if (!d || typeof d !== 'object' || Array.isArray(d)) return {};
  const out = {};
  for (const [k, v] of Object.entries(d).slice(0, 12)) {
    if (['string', 'number', 'boolean'].includes(typeof v) || v === null) out[String(k).slice(0, 40)] = typeof v === 'string' ? v.slice(0, 200) : v;
  }
  return out;
};

export async function GET(request) {
  try {
    const db = getDb();
    const q = new URL(request.url).searchParams;
    if (q.get('stats') === '1') {
      try { mirrorAccountLoad(db, dataDir()); } catch { /* the size is shown either way */ }
      return Response.json(logStats(db));
    }
    if (q.get('outcomes') === '1') return Response.json({ outcomes: outcomes(db) });
    if (q.get('person')) return Response.json({ events: byPerson(db, q.get('person')) });
    const limit = Math.max(1, Math.min(10000, Number(q.get('limit')) || 1000));
    return Response.json({ events: since(db, q.get('since') || undefined, { kind: q.get('kind') || null, type: q.get('type') || null, limit }) });
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 });
  }
}

export async function POST(request) {
  let body;
  try { body = await request.json(); } catch { return Response.json({ error: 'Send the event as JSON.' }, { status: 400 }); }
  try {
    const db = getDb();
    if (body?.event === 'exposure') {
      if (!EXPOSURE_LISTS.includes(body.list)) return Response.json({ error: 'Not a list Sixgree records.' }, { status: 400 });
      const rows = rowsFor(db, Array.isArray(body.people) ? body.people : []);
      const r = recordExposure(db, {
        list: body.list, rows, sort: typeof body.sort === 'string' ? body.sort.slice(0, 40) : null,
        context: typeof body.context === 'string' ? body.context.slice(0, 80) : null,
      });
      return Response.json({ ok: true, ...r });
    }
    if (body?.event === 'interaction') {
      if (!CLIENT_INTERACTIONS.includes(body.type)) return Response.json({ error: 'Not an interaction Sixgree records.' }, { status: 400 });
      const [row] = rowsFor(db, [{ id: body.id, profile_url: body.profile_url }]);
      if (!row) return Response.json({ error: 'Whose?' }, { status: 400 });
      const full = row.headline !== undefined ? row : null;
      const r = recordInteraction(db, { type: body.type, row: full, person: full ? null : personKey(row.profile_url || row), data: cleanData(body.data) });
      return Response.json({ ok: true, ...r });
    }
    return Response.json({ error: 'Unknown event.' }, { status: 400 });
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 });
  }
}
