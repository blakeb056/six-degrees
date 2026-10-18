import { dataDir } from '../../../lib/paths';
import { getDb } from '../../../lib/db-client';
import { resolveProfile } from '../../../lib/profile';
import { cleanProfileUrl } from '../../../lib/reach';
import { linkedinState } from '../../../lib/linkedin-limits';
import { chargeProfileView, recordOutlinkOpened } from '../../../lib/outlink-opened';
import { recordInteraction, personKey } from '../../../lib/learning-log';

// One profile opened in Sixgree's own browser (app/components/OpenProfile.js):
// counted as one of the day's profile views and written down
// (lib/outlink-opened.js). The panel is already on the profile when this is
// asked (desktop/main.mjs showProfile), so nothing here waits on a scan, the
// gap between views or LinkedIn: it only writes two small files. Blake,
// 2026-10-15: "it took like 2-3 min to load and it's not snappy like the view
// profile button which is essentially the same".
//
// POST { id?, name?, url } → { ok, counted, profilesLeftToday }. The person is
// looked up by id where they are on file, so the URL and name written down are
// the database's; otherwise the page's link, checked like any other.

const cleanId = (v) => (typeof v === 'string' && /^[\w-]{1,64}$/.test(v) ? v : null);

function cleanName(raw) {
  const name = String(raw ?? '').trim();
  return name && name.length <= 120 && !/[\u0000-\u001f]/.test(name) ? name : null;
}

/** Their row on file, by id: { id, name, profile_url }, or null. */
function onFile(id) {
  if (!id) return null;
  try {
    const me = resolveProfile({ create: false });
    return (me && getDb().prepare(
      'SELECT id, name, profile_url FROM linkedin_connections WHERE id = ? AND user_id = ?',
    ).get(id, me.id)) || null;
  } catch {
    return null;
  }
}

export async function POST(request) {
  let body = {};
  try { body = await request.json(); } catch { /* said below */ }
  const row = onFile(cleanId(body?.id));
  const url = cleanProfileUrl(row?.profile_url) || cleanProfileUrl(body?.url);
  if (!url) return Response.json({ error: 'That isn’t a LinkedIn profile link.' }, { status: 400 });
  const dir = dataDir();
  const counted = chargeProfileView(dir);
  recordOutlinkOpened(dir, { id: row?.id ?? null, name: cleanName(row?.name ?? body?.name), url });
  // The learning log: a profile opened in the panel, with the person as known now.
  try {
    const db = getDb();
    const full = row ? db.prepare('SELECT * FROM linkedin_connections WHERE id = ?').get(row.id) : null;
    recordInteraction(db, { type: 'profile-open', row: full, person: full ? null : personKey(url), data: { counted: Boolean(counted) } });
  } catch { /* the view is counted either way */ }
  let profilesLeftToday = null;
  try { profilesLeftToday = linkedinState(dir).profilesLeftToday; } catch { /* the count is written either way */ }
  return Response.json({ ok: true, counted, profilesLeftToday });
}
