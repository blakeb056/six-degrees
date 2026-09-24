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
  // Without the profile, rows of every profile in the app would be folded
  // together — and deleted. Nothing is safe to do.
  if (!userId) return { promoted: false, reason: 'no profile' };

  let q = db.from('linkedin_connections').select('*').eq('profile_url', profileUrl);
  if (userId) q = q.eq('user_id', userId);
  const { data } = await q;
  const rows = data || [];
  if (rows.length === 0) return { promoted: false, reason: 'not on file' };

  // Already a direct connection: keep the row they have, and add no origin.
  //
  // This used to prefer the 2nd-degree copy (the "deepest" row) and delete the
  // rest — including the person's own 1st-degree row. Other rows point at that
  // row's id: above all, everyone in their own mapped circle. On 2026-09-24 a
  // full scan did this to 13 people whose circles had been mapped, and 1,072
  // people in those circles were left pointing at rows that no longer existed.
  // It also gave 150 long-standing connections a "you met them through" origin
  // they never had: they were connections before they turned up in anyone's
  // circle. TRAPS §36.
  const direct = rows.filter((r) => r.degree === 1);
  if (direct.length > 0) {
    const keep = await mostReferenced(db, direct);
    // Only this person's copies in the same profile; never another profile's rows.
    const fold = rows.filter((r) => r.id !== keep.id && r.user_id === keep.user_id);
    for (const row of fold) {
      // Only delete a row once nothing points at it any more.
      if (await repoint(db, row.id, keep.id)) {
        await db.from('linkedin_connections').delete().eq('id', row.id);
      }
    }
    if (Object.keys(fields).length) {
      await db.from('linkedin_connections').update({ ...fields, updated_at: new Date().toISOString() }).eq('id', keep.id);
    }
    return { promoted: false, reason: 'already a direct connection', id: keep.id, folded: fold.length };
  }

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
  // origin and fold the rest away rather than leaving duplicates behind —
  // pointing anything that referred to a folded row at the one kept.
  const fold = rows.filter((r) => r.id !== source.id);
  for (const row of fold) {
    if (await repoint(db, row.id, source.id)) {
      await db.from('linkedin_connections').delete().eq('id', row.id);
    }
  }

  await db.from('linkedin_connections').update(updates).eq('id', source.id);
  return { promoted: true, id: source.id, originId, originName };
}

/** Of several rows for one person, the one other rows point at most. */
async function mostReferenced(db, rows) {
  if (rows.length === 1) return rows[0];
  let best = rows[0];
  let bestCount = -1;
  for (const row of rows) {
    const { data } = await db.from('linkedin_connections').select('id').eq('source_connection_id', row.id);
    const n = (data || []).length;
    if (n > bestCount) { best = row; bestCount = n; }
  }
  return best;
}

/**
 * Point everything that referred to row `fromId` at `toId`. True only if all
 * of it moved — the caller deletes `fromId` only then, so a failure can never
 * leave rows pointing at nothing (TRAPS §36).
 *
 * Someone can sit in both circles; the index allows them once per bridge, so
 * a copy already under `toId` is the one kept and the other is dropped.
 */
async function repoint(db, fromId, toId) {
  const { data: members, error: readErr } = await db
    .from('linkedin_connections').select('id, profile_url, user_id').eq('source_connection_id', fromId);
  if (readErr) return false;
  for (const m of members || []) {
    const { data: twin } = await db.from('linkedin_connections').select('id')
      .eq('source_connection_id', toId).eq('profile_url', m.profile_url).eq('user_id', m.user_id);
    const { error } = (twin || []).length
      ? await db.from('linkedin_connections').delete().eq('id', m.id)
      : await db.from('linkedin_connections').update({ source_connection_id: toId }).eq('id', m.id);
    if (error) return false;
  }
  const { error } = await db.from('linkedin_connections')
    .update({ unlocked_from_bridge_id: toId }).eq('unlocked_from_bridge_id', fromId);
  return !error;
}

