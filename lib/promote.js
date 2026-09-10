// Turning a 2nd-degree contact into a 1st-degree one, without losing the path.
//
// The whole point of this tool is that someone was reachable *through* a
// particular person. When you finally connect with them, that fact should not
// evaporate — you should still be able to see that Jane is why you know them.
//
// Two things get conflated easily and must not be:
//
//   source_connection_id     whose circle they currently sit in. A direct
//                            connection sits in nobody's circle, so this is
//                            cleared on promotion.
//   unlocked_from_bridge_id  who introduced them. Permanent. Survives
//                            promotion, re-scrapes, and their own later
//                            promotion to a bridge with a circle of their own.
//
// Before this existed, a 2nd-degree person who became a connection was dropped
// on the floor: the ingest route counted "any row with this profile_url" as
// already handled, then updated rows matching `degree = 1` — of which there
// were none. They stayed 2nd-degree forever and the path was never marked.

/**
 * Promote one person to 1st degree, keeping their origin.
 * Safe to call repeatedly; a person already at 1st degree keeps their origin.
 */
export async function promoteToFirstDegree(db, { profileUrl, userId, fields = {} }) {
  if (!profileUrl) return { promoted: false, reason: 'no profile url' };

  let q = db.from('linkedin_connections').select('*').eq('profile_url', profileUrl);
  if (userId) q = q.eq('user_id', userId);
  const { data } = await q;
  const rows = data || [];
  if (rows.length === 0) return { promoted: false, reason: 'not on file' };

  // Prefer a row that already carries an origin, then the deepest one — that is
  // where the provenance lives.
  const source = rows.find((r) => r.unlocked_from_bridge_id)
    || rows.slice().sort((a, b) => (b.degree || 0) - (a.degree || 0))[0];

  const originId = source.unlocked_from_bridge_id || source.source_connection_id || null;
  let originName = source.unlocked_from_name || null;

  if (originId && !originName) {
    const { data: bridge } = await db
      .from('linkedin_connections').select('name').eq('id', originId).limit(1);
    originName = bridge?.[0]?.name || null;
  }

  const updates = {
    degree: 1,
    source_connection_id: null,        // a direct connection is in nobody's circle
    unlock_status: originId ? 'unlocked' : source.unlock_status,
    unlocked_from_bridge_id: originId,
    unlocked_from_name: originName,
    updated_at: new Date().toISOString(),
    ...fields,
  };

  // If the same person somehow exists more than once, keep the one carrying the
  // origin and fold the rest away rather than leaving duplicates behind.
  for (const row of rows) {
    if (row.id === source.id) continue;
    await db.from('linkedin_connections').delete().eq('id', row.id);
  }

  await db.from('linkedin_connections').update(updates).eq('id', source.id);
  return { promoted: true, id: source.id, originId, originName };
}
