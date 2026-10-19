import { getDb } from '../../../lib/db-client';
import { dataDir } from '../../../lib/paths';
import { APP_VERSION } from '../../../lib/app-version';
import { listPlugins } from '../../../lib/plugins';
import { readSettings } from '../../../lib/settings';
import {
  recordExposure, recordInteraction, recordBatch, logStats, since, byPerson, outcomes, mirrorAccountLoad, activeLens, behaviourOn,
  sessionSummaries, funnel, dwellByTab, duelCalibration, rowsForPeople, EXPOSURE_LISTS, CLIENT_INTERACTIONS, personKey,
} from '../../../lib/learning-log';

// The learning log's read API and the pages' events (lib/learning-log.js, the
// taxonomy in lib/behavior-taxonomy.js). Local only: this route reads and
// writes this computer's database, nothing else, and nothing in the log is
// ever sent anywhere.
//
// GET  ?stats=1                 the log's size and counts per kind (the account's load mirrored first)
//      ?since=<ISO>&kind=&type=  events since a time, oldest first
//      ?person=<profile url or key>  one person's events
//      ?outcomes=1               every request's story: sent, accepted or pending
//      ?sessions=1  ?funnel=1  ?dwell=1  ?duels=1   the readers for analysis (each takes since=)
// POST { session, events: [{ kind, type, at, key?, person?: { id?, profile_url? }, data }], dropped? }
//        the pages' batch (lib/learning-client.js): answers { recorded, refused, dropped, on }
//      { event: 'exposure', list, sort?, context?, people: [{ id?, profile_url? }] }   one list (older pages)
//      { event: 'interaction', type, id?, profile_url?, data? }                      one interaction (older pages)

const cleanData = (d) => {
  if (!d || typeof d !== 'object' || Array.isArray(d)) return {};
  const out = {};
  for (const [k, v] of Object.entries(d).slice(0, 12)) {
    if (['string', 'number', 'boolean'].includes(typeof v) || v === null) out[String(k).slice(0, 40)] = typeof v === 'string' ? v.slice(0, 200) : v;
  }
  return out;
};

/**
 * What a session's start is told by the server, not the page: the version, the
 * plugins installed (id and version), the class and the look. Read once per
 * window opened.
 */
function sessionFacts(db) {
  const out = { version: APP_VERSION, class: activeLens(db) };
  try {
    out.plugins = Object.fromEntries(listPlugins(dataDir()).filter((p) => p?.id).slice(0, 20).map((p) => [p.id, p.version || null]));
  } catch { out.plugins = {}; }
  try {
    const theme = readSettings(db).theme;
    // The preset's id, and "+custom" when your own changes sit on top of it (lib/themes.js cleanTheme).
    out.theme = theme ? `${theme.base || 'standard'}${theme.custom && Object.keys(theme.custom).length ? '+custom' : ''}` : 'standard';
  } catch { out.theme = null; }
  return out;
}

export async function GET(request) {
  try {
    const db = getDb();
    const q = new URL(request.url).searchParams;
    const from = q.get('since') || undefined;
    if (q.get('stats') === '1') {
      try { mirrorAccountLoad(db, dataDir()); } catch { /* the size is shown either way */ }
      return Response.json(logStats(db));
    }
    if (q.get('outcomes') === '1') return Response.json({ outcomes: outcomes(db) });
    if (q.get('sessions') === '1') return Response.json({ sessions: sessionSummaries(db, { since: from }) });
    if (q.get('funnel') === '1') return Response.json(funnel(db, { since: from }));
    if (q.get('dwell') === '1') return Response.json({ tabs: dwellByTab(db, { since: from }) });
    if (q.get('duels') === '1') return Response.json(duelCalibration(db, { since: from, cls: q.get('class') || null }));
    if (q.get('person')) return Response.json({ events: byPerson(db, q.get('person')) });
    const limit = Math.max(1, Math.min(10000, Number(q.get('limit')) || 1000));
    return Response.json({ events: since(db, from, { kind: q.get('kind') || null, type: q.get('type') || null, limit }) });
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 });
  }
}

export async function POST(request) {
  let body;
  try { body = await request.json(); } catch { return Response.json({ error: 'Send the event as JSON.' }, { status: 400 }); }
  try {
    const db = getDb();
    if (Array.isArray(body?.events)) {
      // A session's start gets the server's own facts beside the page's.
      const events = body.events.map((e) => (e?.kind === 'session' && e?.type === 'start' && e.data && typeof e.data === 'object'
        ? { ...e, data: { ...e.data, ...(behaviourOn(db) ? sessionFacts(db) : {}) } } : e));
      return Response.json({ ok: true, ...recordBatch(db, events, { session: body.session, dropped: Number(body.dropped) || 0 }) });
    }
    if (body?.event === 'exposure') {
      if (!EXPOSURE_LISTS.includes(body.list)) return Response.json({ error: 'Not a list Sixgree records.' }, { status: 400 });
      const rows = rowsForPeople(db, Array.isArray(body.people) ? body.people : []);
      const r = recordExposure(db, {
        list: body.list, rows, sort: typeof body.sort === 'string' ? body.sort.slice(0, 40) : null,
        context: typeof body.context === 'string' ? body.context.slice(0, 80) : null,
      });
      return Response.json({ ok: true, ...r });
    }
    if (body?.event === 'interaction') {
      if (!CLIENT_INTERACTIONS.includes(body.type)) return Response.json({ error: 'Not an interaction Sixgree records.' }, { status: 400 });
      const [row] = rowsForPeople(db, [{ id: body.id, profile_url: body.profile_url }]);
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
