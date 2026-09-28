import { db as supabase } from '../../../lib/db';
import { getDb, decodeRow } from '../../../lib/db-client';
import { resolveProfile } from '../../../lib/profile';

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

// XP rewards by tier
const XP_SEND = { S: 25, A: 15, B: 10, C: 5, D: 2 };
const XP_ACCEPT = { S: 100, A: 60, B: 35, C: 15, D: 5 };
const TIER_ORDER = ['S', 'A', 'B', 'C', 'D'];

async function awardXP(userId, amount) {
  if (!userId || !amount) return;
  // Upsert: create if not exists, change if exists. Never below zero: an Undo
  // takes back what a send gave, including sends from before sends gave any.
  const { data: existing } = await supabase.from('user_stats').select('xp').eq('id', userId).single();
  if (existing) {
    await supabase.from('user_stats').update({ xp: Math.max(0, (existing.xp || 0) + amount) }).eq('id', userId);
  } else if (amount > 0) {
    await supabase.from('user_stats').insert([{ id: userId, xp: amount, level: 1 }]).catch(() => {});
  }
}

/** The profile a request belongs to: the one sent, else this machine's. */
function whose(userId) {
  if (userId) return String(userId);
  try { return resolveProfile({ create: false })?.id || null; } catch { return null; }
}

/** Every copy of one person: by the clicked row's profile URL, or the URL given. */
function copiesOf(db, { connectionId, profileUrl, userId }) {
  let url = profileUrl ? String(profileUrl) : null;
  let user = userId ? String(userId) : null;
  let clicked = null;
  if (connectionId != null) {
    clicked = db.prepare('SELECT id, profile_url, user_id FROM linkedin_connections WHERE id = ?').get(String(connectionId)) || null;
    if (clicked) {
      url = clicked.profile_url || url;
      user = user || clicked.user_id || null;
    }
  }
  const cols = 'id, degree, tier, outreach_status, unlock_status, unlocked_from_bridge_id';
  let rows = [];
  if (url) {
    rows = user
      ? db.prepare(`SELECT ${cols} FROM linkedin_connections WHERE profile_url = ? AND user_id = ?`).all(url, user)
      : db.prepare(`SELECT ${cols} FROM linkedin_connections WHERE profile_url = ?`).all(url);
  } else if (clicked) {
    rows = db.prepare(`SELECT ${cols} FROM linkedin_connections WHERE id = ?`).all(clicked.id);
  }
  return { url, user, rows };
}

const inList = (ids) => ids.map(() => '?').join(', ');
const bestTier = (rows) => TIER_ORDER.find((t) => rows.some((r) => r.tier === t)) || 'D';

export async function POST(request) {
  try {
    const body = await request.json();
    const { action, connectionId, profileUrl, userId, bridgeId } = body;
    if (!['mark-sent', 'mark-accepted', 'undo'].includes(action)) {
      return Response.json({ error: 'Unknown action' }, { status: 400 });
    }
    const db = getDb();
    const { user, rows } = copiesOf(db, { connectionId, profileUrl, userId });
    // Nobody on file (the sample network lives in the browser): nothing to keep.
    if (!rows.length) return Response.json({ success: true, saved: 0, xp: 0 });
    const ids = rows.map((r) => r.id);
    const now = new Date().toISOString();

    if (action === 'mark-sent') {
      const already = rows.some((r) => r.outreach_status === 'sent' || r.outreach_status === 'accepted');
      db.prepare(`UPDATE linkedin_connections SET outreach_status = 'sent', updated_at = ?
        WHERE id IN (${inList(ids)}) AND (outreach_status IS NULL OR outreach_status NOT IN ('sent', 'accepted'))`).run(now, ...ids);
      db.prepare(`UPDATE linkedin_connections SET unlock_status = 'pending', updated_at = ?
        WHERE id IN (${inList(ids)}) AND (unlock_status IS NULL OR unlock_status = 'locked')`).run(now, ...ids);
      // Who you asked through: one of your own connections, or nothing.
      if (bridgeId != null) {
        const bridge = db.prepare(
          `SELECT id, name FROM linkedin_connections WHERE id = ? AND degree = 1${user ? ' AND user_id = ?' : ''}`,
        ).get(...[String(bridgeId), ...(user ? [user] : [])]);
        if (bridge) {
          db.prepare(`UPDATE linkedin_connections SET unlocked_from_bridge_id = ?, unlocked_from_name = ?, updated_at = ?
            WHERE id IN (${inList(ids)}) AND degree = 2 AND unlocked_from_bridge_id IS NULL`).run(bridge.id, bridge.name, now, ...ids);
        }
      }
      const xp = already ? 0 : XP_SEND[bestTier(rows)] || 2;
      await awardXP(whose(user), xp);
      return Response.json({ success: true, saved: ids.length, xp, already });
    }

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
