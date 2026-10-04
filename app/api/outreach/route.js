import { getDb, decodeRow } from '../../../lib/db-client';
import {
  XP_SEND, XP_ACCEPT, awardXP, whose, copiesOf, inList, bestTier, markSent,
} from '../../../lib/requests';

// Requests you've sent, kept per PERSON.
//
// A person has one row per bridge whose circle holds them (the table's key is
// profile + bridge + user), and a request used to mark only the copy that was
// clicked. The other copies still offered "Add", the Pending count counted
// copies, and every click awarded XP again. And the card's link wrote a second
// column (unlock_status) through another route, which Undo never took back.
// Now a request marks every copy of the person, in both columns, the bridge you
// asked through is kept (so once they accept, their card and circle say who
// introduced you: lib/promote.js keeps it), XP comes once per person, and Undo
// takes back all of it. lib/requests-client.js is the one way the pages call this.
// The marking itself is lib/requests.js markSent, which Auto's sends use too
// (app/api/scraper/route.js).

export async function POST(request) {
  try {
    const body = await request.json();
    const { action, connectionId, profileUrl, userId, bridgeId } = body;
    if (!['mark-sent', 'mark-accepted', 'undo'].includes(action)) {
      return Response.json({ error: 'Unknown action' }, { status: 400 });
    }
    const db = getDb();

    if (action === 'mark-sent') {
      const { saved, xp, already } = await markSent(db, { connectionId, profileUrl, userId, bridgeId });
      // Nobody on file (the sample network lives in the browser): nothing to keep.
      if (!saved) return Response.json({ success: true, saved: 0, xp: 0 });
      return Response.json({ success: true, saved, xp, already });
    }

    const { user, rows } = copiesOf(db, { connectionId, profileUrl, userId });
    // Nobody on file (the sample network lives in the browser): nothing to keep.
    if (!rows.length) return Response.json({ success: true, saved: 0, xp: 0 });
    const ids = rows.map((r) => r.id);
    const now = new Date().toISOString();

    if (action === 'mark-accepted') {
      db.prepare(`UPDATE linkedin_connections SET outreach_status = 'accepted', updated_at = ? WHERE id IN (${inList(ids)})`).run(now, ...ids);
      return Response.json({ success: true, saved: ids.length, xp: 0, accepts: XP_ACCEPT[bestTier(rows)] || 5 });
    }

    // undo
    const wasSent = rows.some((r) => r.outreach_status === 'sent');
    db.prepare(`UPDATE linkedin_connections SET outreach_status = NULL, updated_at = ?
      WHERE id IN (${inList(ids)}) AND outreach_status = 'sent'`).run(now, ...ids);
    db.prepare(`UPDATE linkedin_connections SET unlock_status = 'locked', updated_at = ?
      WHERE id IN (${inList(ids)}) AND unlock_status = 'pending'`).run(now, ...ids);
    const xp = wasSent ? -(XP_SEND[bestTier(rows)] || 2) : 0;
    await awardXP(whose(user), xp);
    return Response.json({ success: true, saved: ids.length, xp });
  } catch (err) {
    console.error('Outreach error:', err);
    return Response.json({ error: err.message }, { status: 500 });
  }
}

/** Everyone with a request out, once each (the newest copy), newest first. */
export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const user = whose(searchParams.get('userId'));
    const rows = getDb().prepare(
      `SELECT * FROM linkedin_connections
        WHERE (outreach_status = 'sent' OR unlock_status = 'pending')${user ? ' AND user_id = ?' : ''}
        ORDER BY created_at DESC`,
    ).all(...(user ? [user] : []));
    const seen = new Set();
    const pending = [];
    for (const row of rows) {
      const key = row.profile_url || `id:${row.id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      pending.push(decodeRow('linkedin_connections', row));
    }
    return Response.json({ pending });
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 });
  }
}
