// The send log (spec section 11, gaps 1 to 4; Phase 0 "Record"): one row per
// person asked, in queue_items, with when it was sent, how (a Connect on a
// page, Auto, or the LinkedIn panel), the person as known at that moment and
// what was shown beside them, every attempt, and when it was accepted. Until
// this, no request had a send time (updated_at is overwritten by every
// rescore), so acceptance, warmth and best-time models had nothing to learn
// from. Each step also lands in the learning log (lib/learning-log.js).
//
// queue_items.profile_url is UNIQUE, so a second request to the same person is
// a new attempt on the same row: the last one moves into attempt_history.
//
// Writers: lib/requests.js markSentRows (every Connect and Auto), the outreach
// route's Undo, app/api/ingest's check for accepted requests, lib/promote.js
// (a 2nd-degree person who became a connection), and a refresh of your own
// connections for "still pending".

import { newId } from './db-client.js';
import { SCORING_VERSION } from './scoring.js';
import { warmthBand } from './class-presets.js';
import { tryRecord, daysToAccept, recordAccepted as logAccepted, personKey, activeLens } from './learning-log.js';

export const SNAPSHOT_VERSION = 1;

const nowIso = () => new Date().toISOString();
const parse = (text, fallback) => { try { return text ? JSON.parse(text) : fallback; } catch { return fallback; } };

/** This computer's time zone, as the sender's. */
export function senderZone() {
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone || null; } catch { return null; }
}

/** The row a request is about: the copy behind the bridge asked through, else the deepest copy. */
function targetRow(db, { profileUrl, user, bridgeId }) {
  const rows = user
    ? db.prepare('SELECT * FROM linkedin_connections WHERE profile_url = ? AND user_id = ?').all(profileUrl, user)
    : db.prepare('SELECT * FROM linkedin_connections WHERE profile_url = ?').all(profileUrl);
  if (!rows.length) return { row: null, rows };
  const row = rows.find((r) => bridgeId != null && r.source_connection_id === String(bridgeId))
    || rows.slice().sort((a, b) => (b.degree || 0) - (a.degree || 0))[0];
  return { row, rows };
}

/** What was shown when it was sent (spec gap 3): the list, the rank, and the ids around it. Cleaned. */
export function cleanExposure(exposure) {
  if (!exposure || typeof exposure !== 'object') return null;
  const list = typeof exposure.list === 'string' ? exposure.list.slice(0, 40) : null;
  const rank = Number.isInteger(exposure.rank) && exposure.rank > 0 ? exposure.rank : null;
  const shown = Array.isArray(exposure.shown) ? exposure.shown.slice(0, 50).map((s) => String(s).slice(0, 80)) : [];
  const sort = typeof exposure.sort === 'string' ? exposure.sort.slice(0, 40) : null;
  return list || rank || shown.length ? { list, rank, sort, shown } : null;
}

/**
 * The person as known when the request went (spec gap 2): degree, both
 * tiers, power, class worth, mutual count, ways in, where their card said
 * they are, followers, the bridge, completeness, and which models scored them.
 */
export function sendSnapshot(db, { row, rows = [], bridgeId = null, route, exposure = null }) {
  const bridge = bridgeId != null ? db.prepare('SELECT id, tier, power_score FROM linkedin_connections WHERE id = ?').get(String(bridgeId)) : null;
  const classStamp = db.prepare("SELECT value FROM app_meta WHERE key = 'scoring_class'").get()?.value ?? null;
  return {
    v: SNAPSHOT_VERSION,
    route,
    degree: row?.degree ?? null,
    tier: row?.tier ?? null,
    power: row?.power_score ?? null,
    lens: activeLens(db),
    classTier: row?.class_tier ?? null,
    classU: row?.class_u ?? null,
    classV: row?.class_v ?? null,
    mutualCount: row?.mutual_count ?? null,
    waysIn: new Set(rows.filter((r) => r.degree === 2 && r.source_connection_id).map((r) => r.source_connection_id)).size,
    location: row?.location || null,
    followers: row?.followers ?? null,
    bridge: bridge ? { id: bridge.id, tier: bridge.tier, power: bridge.power_score } : null,
    completeness: { photo: Boolean(row?.profile_image_url), slug: /\/in\/[a-z0-9-]+-[0-9a-f]{6,}\/?$/i.test(row?.profile_url || '') ? 'generated' : 'custom' },
    models: { scoring: SCORING_VERSION, class: classStamp },
    exposure: cleanExposure(exposure),
  };
}

/**
 * A request went to this person: write the send log's row (a new attempt if
 * they were asked before) and the learning log's event. Never throws: the
 * request is marked either way.
 * @returns { attempt } or null when nothing could be written.
 */
export function recordSend(db, { profileUrl, user = null, bridgeId = null, route = 'manual', exposure = null, at = null } = {}) {
  try {
    if (!profileUrl) return null;
    const { row, rows } = targetRow(db, { profileUrl, user, bridgeId });
    if (!row) return null;
    const when = at || nowIso();
    const snapshot = sendSnapshot(db, { row, rows, bridgeId, route, exposure });
    const existing = db.prepare('SELECT * FROM queue_items WHERE profile_url = ?').get(profileUrl);
    let attempt = 1;
    if (!existing) {
      db.prepare(`INSERT INTO queue_items (id, connection_id, profile_url, name, status, xp_reward, bridge_name, sent_at, user_id, route, result,
        snapshot, attempts, attempt_history, sender_tz) VALUES (?, ?, ?, ?, 'sent', 0, ?, ?, ?, ?, 'pending', ?, 1, '[]', ?)`)
        .run(newId(), row.id, profileUrl, row.name || '', bridgeName(db, bridgeId), when, user ?? row.user_id ?? null, route, JSON.stringify(snapshot), senderZone());
    } else if (existing.result === 'pending' && existing.sent_at) {
      // Already out: the same request marked again (a second click, Auto after a manual mark).
      return { attempt: existing.attempts || 1, already: true };
    } else {
      const history = parse(existing.attempt_history, []);
      if (existing.sent_at || existing.accepted_at) {
        history.push({
          sent_at: existing.sent_at, accepted_at: existing.accepted_at, accepted_day: existing.accepted_day,
          result: existing.result, route: existing.route, warmth: existing.warmth, withdrawn_at: existing.withdrawn_at,
        });
      }
      attempt = (Number(existing.attempts) || history.length) + 1;
      db.prepare(`UPDATE queue_items SET connection_id = ?, name = ?, status = 'sent', bridge_name = ?, sent_at = ?, accepted_at = NULL,
        accepted_day = NULL, warmth = NULL, withdrawn_at = NULL, user_id = ?, route = ?, result = 'pending', snapshot = ?, attempts = ?,
        attempt_history = ?, sender_tz = ? WHERE id = ?`)
        .run(row.id, row.name || existing.name, bridgeName(db, bridgeId), when, user ?? row.user_id ?? null, route, JSON.stringify(snapshot),
          attempt, JSON.stringify(history), senderZone(), existing.id);
    }
    tryRecord(db, {
      kind: 'interaction', type: 'request-sent', row, user: user ?? row.user_id ?? null, at: when,
      data: { route, attempt, bridge: bridgeId ?? null, exposure: snapshot.exposure }, dedupe: `sent:${personKey(row)}:${attempt}`,
    });
    return { attempt };
  } catch {
    return null;
  }
}

function bridgeName(db, bridgeId) {
  if (bridgeId == null) return null;
  return db.prepare('SELECT name FROM linkedin_connections WHERE id = ?').get(String(bridgeId))?.name ?? null;
}

/** Undo: the request taken back in Sixgree. The attempt stays in the log as undone. */
export function recordUndo(db, { profileUrl } = {}) {
  try {
    const q = db.prepare('SELECT * FROM queue_items WHERE profile_url = ?').get(profileUrl);
    if (!q || q.result !== 'pending') return false;
    db.prepare("UPDATE queue_items SET status = 'undone', result = 'undone' WHERE id = ?").run(q.id);
    tryRecord(db, { kind: 'outcome', type: 'withdrawn', person: personKey(profileUrl), user: q.user_id, data: { via: 'undo', attempt: q.attempts || 1, sentAt: q.sent_at }, dedupe: `wd:${personKey(profileUrl)}:${q.attempts || 1}` });
    return true;
  } catch {
    return false;
  }
}

/**
 * They accepted: `acceptedDay` is the connection's own date (a day, the source
 * of truth for how long it took), `via` how it was seen ('check' for Check for
 * new, 'promote' for a scan or file that found them at 1st degree). Writes
 * accepted_at (when it was seen), the day, the warmth band, and the learning
 * log's outcome. A request from before the log existed gets a row without a
 * send time: an accept whose wait is unknown.
 */
export function recordAccept(db, { profileUrl, user = null, acceptedDay = null, via = 'check', at = null } = {}) {
  try {
    if (!profileUrl) return false;
    const when = at || nowIso();
    const day = acceptedDay ? String(acceptedDay).slice(0, 10) : null;
    const q = db.prepare('SELECT * FROM queue_items WHERE profile_url = ?').get(profileUrl);
    const row = db.prepare(`SELECT * FROM linkedin_connections WHERE profile_url = ?${user ? ' AND user_id = ?' : ''} ORDER BY degree LIMIT 1`)
      .get(...[profileUrl, ...(user ? [user] : [])]);
    if (q && q.result === 'accepted') return false;
    const days = q?.sent_at && day ? daysToAccept(q.sent_at, day) : null;
    const warmth = days == null ? null : warmthBand(days);
    if (q) {
      db.prepare(`UPDATE queue_items SET status = 'accepted', result = 'accepted', accepted_at = ?, accepted_day = ?, warmth = ?, last_checked_at = ? WHERE id = ?`)
        .run(when, day, warmth, when, q.id);
    } else {
      db.prepare(`INSERT INTO queue_items (id, connection_id, profile_url, name, status, xp_reward, accepted_at, accepted_day, user_id, route, result, attempts, attempt_history, last_checked_at)
        VALUES (?, ?, ?, ?, 'accepted', 0, ?, ?, ?, 'unknown', 'accepted', 1, '[]', ?)`)
        .run(newId(), row?.id ?? null, profileUrl, row?.name || '', when, day, user ?? row?.user_id ?? null, when);
    }
    try {
      logAccepted(db, { row, person: personKey(profileUrl), user: user ?? row?.user_id ?? null, sentAt: q?.sent_at ?? null, acceptedAt: when, acceptedDay: day, attempt: q?.attempts || 1, via });
    } catch { /* the log never stops the accept */ }
    return true;
  } catch {
    return false;
  }
}

const WEEK_MS = 7 * 86400000;

/**
 * A refresh of your own connections: every request still out is checked
 * (last_checked_at), and one "still pending" outcome per person per week goes
 * in the learning log, with the request's age in days.
 */
export function recordStillPending(db, { user = null, at = null } = {}) {
  try {
    const when = at || nowIso();
    const open = db.prepare(`SELECT * FROM queue_items WHERE result = 'pending'${user ? ' AND (user_id = ? OR user_id IS NULL)' : ''}`).all(...(user ? [user] : []));
    const touch = db.prepare('UPDATE queue_items SET last_checked_at = ? WHERE id = ?');
    for (const q of open) {
      touch.run(when, q.id);
      const age = q.sent_at ? Math.floor((new Date(when) - new Date(q.sent_at)) / 86400000) : null;
      tryRecord(db, {
        kind: 'outcome', type: 'still-pending', person: personKey(q.profile_url), user: q.user_id, at: when,
        data: { attempt: q.attempts || 1, ageDays: age }, dedupe: `pend:${personKey(q.profile_url)}:${q.attempts || 1}:${Math.floor(new Date(when).getTime() / WEEK_MS)}`,
      });
    }
    return open.length;
  } catch {
    return 0;
  }
}

/** The send log as the class tab's learning meters read it. */
export function sendLogCounts(db) {
  const all = db.prepare(`SELECT count(*) AS sent,
    sum(CASE WHEN result = 'accepted' THEN 1 ELSE 0 END) AS accepted,
    sum(CASE WHEN result = 'accepted' AND sent_at IS NOT NULL AND accepted_day IS NOT NULL THEN 1 ELSE 0 END) AS timed,
    sum(CASE WHEN result = 'pending' THEN 1 ELSE 0 END) AS pending
    FROM queue_items WHERE sent_at IS NOT NULL OR result = 'accepted'`).get();
  const bands = Object.fromEntries(db.prepare("SELECT warmth, count(*) AS n FROM queue_items WHERE warmth IS NOT NULL GROUP BY warmth").all().map((r) => [r.warmth, r.n]));
  return { sent: all.sent || 0, accepted: all.accepted || 0, timed: all.timed || 0, pending: all.pending || 0, warmth: bands };
}
