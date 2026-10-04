// Requests you've sent, kept per PERSON: the server side of
// lib/requests-client.js.
//
// A person has one row per bridge whose circle holds them (the table's key is
// profile + bridge + user), and a request used to mark only the copy that was
// clicked. The other copies still offered "Add", the Pending count counted
// copies, and every click awarded XP again. Now a request marks every copy of
// the person, in both columns, the bridge you asked through is kept (so once
// they accept, their card and circle say who introduced you: lib/promote.js
// keeps it), XP comes once per person, and Undo takes back all of it.
//
// Two callers: POST /api/outreach (a Connect pressed on a page), and the
// scanner's route once Auto has sent a request and LinkedIn showed it pending
// (app/api/scraper/route.js; Blake, 2026-10-03). Both go through markSent here,
// so a request sent by Auto is the same request everywhere as one sent by hand.

import { db as supabase } from './db.js';
import { resolveProfile } from './profile.js';

// XP rewards by tier
export const XP_SEND = { S: 25, A: 15, B: 10, C: 5, D: 2 };
export const XP_ACCEPT = { S: 100, A: 60, B: 35, C: 15, D: 5 };
const TIER_ORDER = ['S', 'A', 'B', 'C', 'D'];

export async function awardXP(userId, amount) {
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
export function whose(userId) {
  if (userId) return String(userId);
  try { return resolveProfile({ create: false })?.id || null; } catch { return null; }
}

/** Every copy of one person: by the clicked row's profile URL, or the URL given. */
export function copiesOf(db, { connectionId, profileUrl, userId }) {
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

export const inList = (ids) => ids.map(() => '?').join(', ');
export const bestTier = (rows) => TIER_ORDER.find((t) => rows.some((r) => r.tier === t)) || 'D';

/**
 * Mark a request to this person as sent, on every copy of them, through
 * `bridgeId` (one of your own connections) when given: the rows only, at once.
 * Returns { saved, xp, already, user }: `saved` is how many rows (0 when nobody
 * is on file, as for the sample network, which lives in the browser), `xp` what
 * the send is worth (once per person), for markSent or the caller to award.
 */
export function markSentRows(db, { connectionId, profileUrl, userId, bridgeId } = {}) {
  const { user, rows } = copiesOf(db, { connectionId, profileUrl, userId });
  if (!rows.length) return { saved: 0, xp: 0, already: false, user };
  const ids = rows.map((r) => r.id);
  const now = new Date().toISOString();
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
  return { saved: ids.length, xp, already, user };
}

/** markSentRows, and its XP awarded: { saved, xp, already }. */
export async function markSent(db, request = {}) {
  const { saved, xp, already, user } = markSentRows(db, request);
  if (saved) await awardXP(whose(user), xp);
  return { saved, xp, already };
}

/**
 * Where this person stands for a new request, over every copy of them:
 * { connected, requested, accepted }. `connected`: a copy of them is one of
 * your own connections; `requested`: a request is out (sent or pending);
 * `accepted`: one was accepted (or their path is unlocked).
 */
export function requestStanding(db, { profileUrl, userId }) {
  if (!profileUrl) return { connected: false, requested: false, accepted: false };
  const rows = userId
    ? db.prepare('SELECT degree, outreach_status, unlock_status FROM linkedin_connections WHERE profile_url = ? AND user_id = ?').all(String(profileUrl), String(userId))
    : db.prepare('SELECT degree, outreach_status, unlock_status FROM linkedin_connections WHERE profile_url = ?').all(String(profileUrl));
  return {
    connected: rows.some((r) => r.degree === 1),
    requested: rows.some((r) => r.outreach_status === 'sent' || r.unlock_status === 'pending'),
    accepted: rows.some((r) => r.outreach_status === 'accepted' || r.unlock_status === 'unlocked'),
  };
}
