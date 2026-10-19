// The learning log (Blake, 2026-10-17: "the tracking models for predictability
// of all data points, and start collecting everything"). One append-only,
// versioned store of what happened, kept on this computer only, so every model
// the class spec plans (acceptance, warmth bands, best time to send, circle
// yield and likeness, look-alikes, class taste) has labels from day one:
//
//   exposure     who was shown, where (Separation, Breach, the class list, a
//                circle's focus, the Map), at what rank, under which sort or lens:
//                one event per list as drawn, never one per hover
//   interaction  a person card opened, a profile opened in the panel, Connect
//                pressed, a request sent, LinkedIn's "Invitation sent" seen,
//                skipped or dismissed, Never show me, Read all mutuals
//   outcome      accepted (with the connection's date and the days it took),
//                still pending, withdrawn
//   scan         per page batch and per job: whose circle, pages, people found,
//                the tier mix (S and A, both lenses), push-back
//   onboarding   each This or That duel (both cards, the choice, the decision
//                time), class picks and switches, Never picks, retunes
//   load         searches, profile views and requests per hour, mirrored from
//                the scanner's linkedin-activity.json
//
// Each event carries its time, the class lens active, and the person's facts
// as known at that moment: a compact snapshot (SNAPSHOT_FIELDS), stored once
// per change as a 'snapshot' row and referenced by its hash, never whole rows.
// A repeat of the same event (its `dedupe` key) is a no-op. Rows are only ever
// added; Settings → Your data shows the size, exports it as JSON, and deletes
// it all. Nothing in this file talks to the network: it reads and writes the
// local database and the data folder, and that's all.
//
// Readers for the model phases: since(), byPerson(), outcomes(), snapshots().

import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { urlKey } from './ties.js';
import { readTitle, currentCompany, followersOf, cleanCompany } from './scoring.js';
import { industryKeyOf } from './companies.js';
import { warmthBand } from './class-presets.js';

export const LEARNING_SCHEMA_VERSION = 1;
export const KINDS = Object.freeze(['exposure', 'interaction', 'outcome', 'scan', 'onboarding', 'load', 'snapshot']);

/** What a snapshot holds, in this order (a version change appends, never reorders). */
export const SNAPSHOT_FIELDS = Object.freeze([
  'title', 'level', 'company', 'industry', 'location', 'tz', 'degree', 'tier', 'classTier', 'power', 'mutual',
  'followers', 'bridge', 'cluster', 'classU',
]);

/** The interaction types the pages may send (POST /api/learning); the rest are the server's own. */
export const CLIENT_INTERACTIONS = Object.freeze(['card-open', 'skip', 'dismiss', 'never', 'more-like-this', 'not-this-one']);
/** The lists a page may report as shown. */
export const EXPOSURE_LISTS = Object.freeze(['separation', 'breach', 'class', 'focus', 'map', 'card', 'insights', 'reveal']);
/** At most this many people per exposure: the top of the list, as drawn. */
export const EXPOSURE_TOP = 50;
const EXPOSURE_BUCKET_MS = 30 * 60 * 1000;   // the same list, in the same order, within 30 minutes: once
const CLICK_BUCKET_MS = 60 * 1000;           // a double click is one

const json = (v) => JSON.stringify(v ?? null);
const hash = (v) => createHash('sha256').update(json(v)).digest('hex').slice(0, 16);
const nowIso = (at) => (at ? new Date(at).toISOString() : new Date().toISOString());
const bucket = (at, ms) => Math.floor(new Date(at).getTime() / ms);

/** Whose: the profile key every copy of a person shares (lib/ties.js urlKey), or a row id. */
export function personKey(rowOrUrl) {
  if (!rowOrUrl) return null;
  if (typeof rowOrUrl === 'string') return urlKey(rowOrUrl) || rowOrUrl.slice(0, 200);
  return urlKey(rowOrUrl.profile_url || rowOrUrl.profileUrl) || (rowOrUrl.id != null ? `id:${rowOrUrl.id}` : null);
}

const round = (n, d = 2) => (Number.isFinite(Number(n)) ? Math.round(Number(n) * 10 ** d) / 10 ** d : null);

/**
 * A person's facts as known now, as a compact vector (SNAPSHOT_FIELDS): their
 * title and seat, company, sector, where their card said they are (and its
 * time zone, once the gazetteer carries zones), degree, both tiers, power,
 * mutual count, followers, the bridge that introduced them and the circle
 * they sit in. Never a name or a photo.
 */
export function snapshotOf(row = {}) {
  const t = row.headline || row.role ? readTitle(row.headline || '', row.role || '') : null;
  let company = null;
  try { company = currentCompany(row) || (row.company ? cleanCompany(row.company) : null); } catch { company = row.company || null; }
  const industry = industryKeyOf(company, row.headline || '');
  const title = t ? String(t.part || t.label || '').split(/\s+(?:at|@)\s+|\s*@\s*/i)[0].trim().slice(0, 80) : null;
  return [
    title || null,
    t ? Number(t.level) : null,
    company ? String(company).slice(0, 80) : null,
    industry && industry !== 'unknown' ? industry : null,
    typeof row.location === 'string' && row.location.trim() ? row.location.trim().slice(0, 80) : null,
    row.tz || null,
    Number(row.degree) || null,
    row.tier || null,
    row.class_tier || null,
    round(row.power_score, 1),
    row.mutual_count == null ? null : Number(row.mutual_count),
    followersOf(row),
    row.unlocked_from_bridge_id || row.source_connection_id || null,
    row.source_connection_id || null,
    round(row.class_u, 3),
  ];
}

/** A snapshot vector back into named fields. */
export function readSnapshot(vector = []) {
  return Object.fromEntries(SNAPSHOT_FIELDS.map((k, i) => [k, vector[i] ?? null]));
}

/** The class lens active now: the class picked, else 'network'. */
export function activeLens(db) {
  try {
    const row = db.prepare('SELECT goals FROM user_profile ORDER BY created_at LIMIT 1').get();
    const goals = row?.goals ? JSON.parse(row.goals) : null;
    return goals && typeof goals === 'object' && !Array.isArray(goals) && goals.class ? goals.class : 'network';
  } catch {
    return 'network';
  }
}

const INSERT = `INSERT OR IGNORE INTO learning_events (schema_version, at, kind, type, person, user_id, lens, snap, dedupe, data)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;

/** Keep a person's snapshot once per change; returns its hash. */
export function rememberSnapshot(db, row, { at, user } = {}) {
  const person = personKey(row);
  if (!person) return null;
  const vector = snapshotOf(row);
  const h = hash(vector);
  db.prepare(INSERT).run(LEARNING_SCHEMA_VERSION, nowIso(at), 'snapshot', 'person', person, user ?? row.user_id ?? null, null, h,
    `snap:${person}:${h}`, json(vector));
  return h;
}

/**
 * Add one event. `row` (a linkedin_connections row) snapshots the person;
 * `person` names them without one. `dedupe` makes a repeat a no-op.
 * @returns { recorded } true when a new row went in.
 */
export function recordEvent(db, { kind, type, row = null, person = null, user = null, at = null, lens = undefined, data = {}, dedupe = null }) {
  if (!KINDS.includes(kind) || !type) throw new Error(`Not a learning event: ${kind}/${type}`);
  const when = nowIso(at);
  const who = person || personKey(row);
  const snap = row ? rememberSnapshot(db, row, { at: when, user }) : null;
  const r = db.prepare(INSERT).run(LEARNING_SCHEMA_VERSION, when, kind, String(type).slice(0, 40), who, user ?? row?.user_id ?? null,
    lens === undefined ? activeLens(db) : lens, snap, dedupe, json(data));
  return { recorded: Number(r.changes) > 0 };
}

/** Best-effort recording: the learning log never breaks the action it records. */
export function tryRecord(db, event) {
  try { return recordEvent(db, event); } catch { return { recorded: false }; }
}

/**
 * One list as drawn: who was shown, where, at what rank, under which sort or
 * lens. The top EXPOSURE_TOP only. The same list in the same order within half
 * an hour is recorded once.
 */
export function recordExposure(db, { list, rows = [], sort = null, lens = undefined, user = null, at = null, context = null }) {
  if (!EXPOSURE_LISTS.includes(list)) throw new Error(`Not a list: ${list}`);
  const when = nowIso(at);
  const shown = [];
  for (const [rank, row] of rows.slice(0, EXPOSURE_TOP).entries()) {
    const person = personKey(row);
    if (!person) continue;
    const snap = row.profile_url || row.headline ? rememberSnapshot(db, row, { at: when, user }) : null;
    shown.push([person, rank + 1, snap]);
  }
  if (!shown.length) return { recorded: false };
  const sig = hash([list, sort, context, shown.map((s) => s[0])]);
  return recordEvent(db, {
    kind: 'exposure', type: list, person: shown.length === 1 ? shown[0][0] : null, user, at: when, lens,
    data: { list, sort, context, shown }, dedupe: `exp:${sig}:${bucket(when, EXPOSURE_BUCKET_MS)}`,
  });
}

/** An interaction with one person; a double click within a minute is one. */
export function recordInteraction(db, { type, row = null, person = null, user = null, at = null, data = {}, lens = undefined }) {
  const when = nowIso(at);
  const who = person || personKey(row);
  return recordEvent(db, {
    kind: 'interaction', type, row, person: who, user, at: when, data, lens,
    dedupe: `int:${type}:${who}:${hash(data)}:${bucket(when, CLICK_BUCKET_MS)}`,
  });
}

// ── Outcomes ─────────────────────────────────────────────────────────────────

/** Whole days from the local date a request was sent to the day it was accepted. */
export function daysToAccept(sentAt, acceptedDay) {
  if (!sentAt || !acceptedDay) return null;
  const s = new Date(sentAt);
  if (Number.isNaN(s.getTime())) return null;
  const sentDay = Date.UTC(s.getFullYear(), s.getMonth(), s.getDate());
  const [y, m, d] = String(acceptedDay).slice(0, 10).split('-').map(Number);
  if (!y || !m || !d) return null;
  return Math.round((Date.UTC(y, m - 1, d) - sentDay) / 86400000);
}

/** Accepted: when it was seen, the connection's own date, the days it took and the warmth band. Once per attempt. */
export function recordAccepted(db, { row = null, person = null, user = null, sentAt = null, acceptedAt = null, acceptedDay = null, attempt = 1, via = 'check' }) {
  const days = daysToAccept(sentAt, acceptedDay || acceptedAt);
  const who = person || personKey(row);
  return recordEvent(db, {
    kind: 'outcome', type: 'accepted', row, person: who, user, at: acceptedAt,
    data: { sentAt, acceptedAt: nowIso(acceptedAt), acceptedDay, days, warmth: days == null ? null : warmthBand(days), via },
    dedupe: `acc:${who}:${attempt}`,
  });
}

// ── Account load ─────────────────────────────────────────────────────────────

const HOUR = 3600;

/**
 * Mirror the scanner's activity file (linkedin-activity.json: epoch seconds of
 * each search, profile view and Auto request) as one 'load' event per finished
 * hour, so the health and warning history is trainable. Each hour once.
 * @returns how many hours were added.
 */
export function mirrorAccountLoad(db, dir, { now = Date.now() } = {}) {
  const file = path.join(dir, 'linkedin-activity.json');
  if (!existsSync(file)) return 0;
  let data;
  try { data = JSON.parse(readFileSync(file, 'utf8')); } catch { return 0; }
  const hours = new Map();
  const add = (list, field) => {
    for (const t of Array.isArray(list) ? list : []) {
      const s = Number(t);
      if (!Number.isFinite(s) || s <= 0) continue;
      const h = Math.floor(s / HOUR);
      const c = hours.get(h) || { searches: 0, profiles: 0, invites: 0 };
      c[field] += 1;
      hours.set(h, c);
    }
  };
  add(data?.searches, 'searches');
  add(data?.profiles, 'profiles');
  add(data?.invites, 'invites');
  const current = Math.floor(now / 1000 / HOUR);
  let added = 0;
  for (const [h, c] of [...hours].sort((a, b) => a[0] - b[0])) {
    if (h >= current) continue;   // an hour still filling waits until it's over
    const { recorded } = recordEvent(db, {
      kind: 'load', type: 'hour', lens: null, at: new Date(h * HOUR * 1000).toISOString(),
      data: { hour: new Date(h * HOUR * 1000).toISOString(), ...c }, dedupe: `load:${h}`,
    });
    if (recorded) added += 1;
  }
  return added;
}

// ── Readers ──────────────────────────────────────────────────────────────────

const decode = (r) => ({ ...r, data: (() => { try { return JSON.parse(r.data); } catch { return null; } })() });

/** Events at or after `at`, oldest first: optionally one kind or type, at most `limit`. */
export function since(db, at = '1970-01-01T00:00:00.000Z', { kind = null, type = null, limit = 10000 } = {}) {
  const where = ['at >= ?'];
  const params = [nowIso(at)];
  if (kind) { where.push('kind = ?'); params.push(kind); }
  if (type) { where.push('type = ?'); params.push(type); }
  return db.prepare(`SELECT * FROM learning_events WHERE ${where.join(' AND ')} ORDER BY at, seq LIMIT ?`).all(...params, limit).map(decode);
}

/** Everything about one person, oldest first: their own events and the lists they were shown in. */
export function byPerson(db, rowOrKey, { limit = 5000 } = {}) {
  const key = typeof rowOrKey === 'string' && !rowOrKey.includes('/') ? rowOrKey : personKey(rowOrKey);
  if (!key) return [];
  const own = db.prepare('SELECT * FROM learning_events WHERE person = ? ORDER BY at, seq LIMIT ?').all(key, limit);
  // Exposures of many people hold them in their list: found by the key as it's stored there.
  const shown = db.prepare("SELECT * FROM learning_events WHERE kind = 'exposure' AND person IS NULL AND instr(data, ?) > 0 ORDER BY at, seq LIMIT ?")
    .all(`[${json(key)},`, limit);
  return [...own, ...shown].sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : a.seq - b.seq)).map(decode);
}

/**
 * Every request's story, per person and attempt: { person, sentAt, route,
 * acceptedAt, acceptedDay, days, warmth, status: 'accepted' | 'withdrawn' |
 * 'pending', snap }. The labels the acceptance and warmth models train on.
 */
export function outcomes(db) {
  const rows = db.prepare(`SELECT * FROM learning_events WHERE (kind = 'interaction' AND type = 'request-sent')
    OR (kind = 'outcome' AND type IN ('accepted', 'withdrawn')) ORDER BY at, seq`).all().map(decode);
  const out = new Map();
  for (const e of rows) {
    if (e.type === 'request-sent') {
      out.set(`${e.person}:${e.data?.attempt || 1}`, { person: e.person, attempt: e.data?.attempt || 1, sentAt: e.at, route: e.data?.route || null, snap: e.snap, status: 'pending', acceptedAt: null, acceptedDay: null, days: null, warmth: null });
      continue;
    }
    const open = [...out.values()].reverse().find((o) => o.person === e.person && o.status === 'pending');
    if (!open) continue;
    if (e.type === 'accepted') Object.assign(open, { status: 'accepted', acceptedAt: e.data?.acceptedAt || e.at, acceptedDay: e.data?.acceptedDay || null, days: e.data?.days ?? null, warmth: e.data?.warmth ?? null });
    else open.status = 'withdrawn';
  }
  return [...out.values()];
}

/** The snapshot vectors for some hashes, as named fields: Map hash → fields. */
export function snapshots(db, hashes = []) {
  const out = new Map();
  const one = db.prepare("SELECT data FROM learning_events WHERE kind = 'snapshot' AND snap = ? LIMIT 1");
  for (const h of new Set(hashes.filter(Boolean))) {
    const r = one.get(h);
    if (r) { try { out.set(h, readSnapshot(JSON.parse(r.data))); } catch { /* a damaged row reads as missing */ } }
  }
  return out;
}

/** The log's size, for Settings → Your data: { events, bytes, first, last, byKind }. */
export function logStats(db) {
  const all = db.prepare('SELECT count(*) AS n, min(at) AS first, max(at) AS last, total(length(data) + length(dedupe) + 64) AS bytes FROM learning_events').get();
  const byKind = Object.fromEntries(db.prepare('SELECT kind, count(*) AS n FROM learning_events GROUP BY kind').all().map((r) => [r.kind, r.n]));
  return { events: all.n || 0, bytes: Math.round(all.bytes || 0), first: all.first || null, last: all.last || null, byKind, schemaVersion: LEARNING_SCHEMA_VERSION };
}

/** The whole log as one JSON-ready object, for Export. */
export function exportLog(db) {
  return {
    format: 'sixgree-learning-log',
    schema_version: LEARNING_SCHEMA_VERSION,
    snapshot_fields: SNAPSHOT_FIELDS,
    exported_at: new Date().toISOString(),
    events: db.prepare('SELECT * FROM learning_events ORDER BY seq').all().map(decode),
  };
}

/** Delete learning log: every event, at once. @returns how many went. */
export function deleteLog(db) {
  const n = db.prepare('SELECT count(*) AS n FROM learning_events').get().n;
  db.exec('DELETE FROM learning_events');
  return n;
}
