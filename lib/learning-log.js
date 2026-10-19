// The learning log (Blake, 2026-10-17: "the tracking models for predictability
// of all data points, and start collecting everything"; 2026-10-19: "a complete
// logger to collect data, behaviour etc, to have true specific data sets to use
// and point at in the future for calibration, analysis, behaviour"). One
// append-only, versioned store of what happened and what was done, kept on this
// computer only, so every model the class spec plans (acceptance, warmth bands,
// best time to send, circle yield and likeness, look-alikes, class taste) and
// any analysis later has labels and behaviour from day one.
//
// What it keeps is the taxonomy in lib/behavior-taxonomy.js, documented kind by
// kind in docs/brain/LEARNING-LOG.md: sessions, navigation and dwell, controls,
// focus and dives, person interest, sections, classes and duels, scans, the
// LinkedIn panel, settings, health, exposures, outcomes, the account's load,
// and the snapshots the person events point at.
//
// Each event carries its time, the class lens active, and the person's facts
// as known at that moment: a compact snapshot (SNAPSHOT_FIELDS), stored once
// per change as a 'snapshot' row and referenced by its hash, never whole rows.
// A repeat of the same event (its `dedupe` key) is a no-op. The pages' events
// come in batches (recordBatch), held to the taxonomy and rate-limited so
// nothing floods. Rows are only ever added and kept until you delete them;
// Settings → Your data shows the counts, exports JSON or a CSV per kind, and
// deletes it all. "Record my behaviour" off keeps only the outcomes and the send
// log (isEssential). Nothing in this file talks to the network: it reads and
// writes the local database and the data folder, and that's all.
//
// Readers for the model phases and for analysis: since(), byPerson(),
// outcomes(), snapshots(), sessionSummaries(), funnel(), dwellByTab(),
// duelCalibration().

import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { urlKey } from './ties.js';
import { readTitle, currentCompany, followersOf, cleanCompany } from './scoring.js';
import { industryKeyOf } from './companies.js';
import { warmthBand } from './class-presets.js';
import { writeZip } from './zip-write.js';
import {
  LEARNING_SCHEMA_VERSION, KINDS, TAXONOMY, typeOf, isEssential, cleanPageEvent, BEHAVIOUR_KEY,
} from './behavior-taxonomy.js';

export { LEARNING_SCHEMA_VERSION, KINDS };

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
 * Whether "Record my behaviour (local only)" is on (Settings → Your data): on
 * until it's turned off. Read straight from the settings row, so a change is
 * seen by the very next event, and lib/settings.js needn't be imported here.
 */
export function behaviourOn(db) {
  try {
    const row = db.prepare("SELECT value FROM app_meta WHERE key = 'settings'").get();
    const v = row?.value ? JSON.parse(row.value)?.[BEHAVIOUR_KEY] : undefined;
    return v !== false;
  } catch {
    return true;
  }
}

/** With the switch off, only what isEssential keeps goes in. `on` saves the lookup when the caller has it. */
const keeps = (db, kind, type, data, on) => isEssential(kind, type, data) || (on ?? behaviourOn(db));

/**
 * Add one event. `row` (a linkedin_connections row) snapshots the person;
 * `person` names them without one. `dedupe` makes a repeat a no-op. With
 * "Record my behaviour" off, anything but an outcome, the send log or the
 * switch's own change is left out (`off`).
 * @returns { recorded, off? } recorded true when a new row went in.
 */
export function recordEvent(db, { kind, type, row = null, person = null, user = null, at = null, lens = undefined, data = {}, dedupe = null, on = undefined }) {
  if (!KINDS.includes(kind) || !type) throw new Error(`Not a learning event: ${kind}/${type}`);
  if (!keeps(db, kind, type, data, on)) return { recorded: false, off: true };
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
export function recordExposure(db, { list, rows = [], sort = null, lens = undefined, user = null, at = null, context = null, on = undefined, extra = null }) {
  if (!EXPOSURE_LISTS.includes(list)) throw new Error(`Not a list: ${list}`);
  if (!keeps(db, 'exposure', list, null, on)) return { recorded: false, off: true };
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
    kind: 'exposure', type: list, person: shown.length === 1 ? shown[0][0] : null, user, at: when, lens, on: true,
    data: { list, sort, context, shown, ...(extra || {}) }, dedupe: `exp:${sig}:${bucket(when, EXPOSURE_BUCKET_MS)}`,
  });
}

/** An interaction with one person; a double click within a minute is one. */
export function recordInteraction(db, { type, row = null, person = null, user = null, at = null, data = {}, lens = undefined, on = undefined }) {
  const when = nowIso(at);
  const who = person || personKey(row);
  return recordEvent(db, {
    kind: 'interaction', type, row, person: who, user, at: when, data, lens, on,
    dedupe: `int:${type}:${who}:${hash(data)}:${bucket(when, CLICK_BUCKET_MS)}`,
  });
}

// ── The pages' events, in batches ────────────────────────────────────────────

/** At most this many events in one batch; the pages send far fewer. */
export const MAX_BATCH = 200;
const RATE_WINDOW_MS = 60 * 1000;
/** Events a minute from the pages, all types together, before the rest are dropped. */
export const PAGE_EVENTS_PER_MINUTE = 1200;
const counters = new Map();

/** A fixed-window counter: true while `key` has had fewer than `max` this minute. */
function allow(key, max, now) {
  let c = counters.get(key);
  if (!c || now - c.start >= RATE_WINDOW_MS) {
    c = { start: now, n: 0 };
    counters.set(key, c);
  }
  if (c.n >= max) return false;
  c.n += 1;
  return true;
}

/** Forget the rate limits' counts (the tests, and a server that's been asleep). */
export function resetRateLimits() { counters.clear(); }

/** The rows on file for some people, by id, else by profile link; someone not on file stays a key. */
export function rowsForPeople(db, people = []) {
  const byId = db.prepare('SELECT * FROM linkedin_connections WHERE id = ?');
  const byUrl = db.prepare('SELECT * FROM linkedin_connections WHERE profile_url = ? ORDER BY degree LIMIT 1');
  return (Array.isArray(people) ? people : []).slice(0, EXPOSURE_TOP).map((p) => {
    const id = typeof p?.id === 'string' || typeof p?.id === 'number' ? String(p.id).slice(0, 80) : null;
    const url = typeof p?.profile_url === 'string' ? p.profile_url.slice(0, 300) : null;
    return (id && byId.get(id)) || (url && byUrl.get(url)) || (url ? { profile_url: url } : id ? { id } : null);
  }).filter(Boolean);
}

const SID = /^[\w-]{4,40}$/;
const DAY_MS = 86400000;

/** A page's own time for an event, kept when it's believable (within a week back, five minutes ahead), else now. */
function pageTime(at, now) {
  const n = Number(at);
  return Number.isFinite(n) && n > now - 7 * DAY_MS && n < now + 5 * 60 * 1000 ? new Date(n).toISOString() : new Date(now).toISOString();
}

/**
 * A batch of the pages' events (POST /api/learning, lib/learning-client.js):
 * each held to the taxonomy (cleanPageEvent), its person looked up and
 * snapshotted, rate-limited per type (TAXONOMY `limit` a minute) and in all
 * (PAGE_EVENTS_PER_MINUTE), and written in one transaction. A page event with
 * a `key` is kept once per session and key. With "Record my behaviour" off,
 * none is kept.
 * @returns { recorded, refused, dropped, on }
 */
export function recordBatch(db, events, { session = null, dropped: pageDropped = 0, now = Date.now() } = {}) {
  const on = behaviourOn(db);
  const out = { recorded: 0, refused: 0, dropped: 0, on };
  const list = Array.isArray(events) ? events.slice(0, MAX_BATCH) : [];
  if (!on) {
    out.refused = list.length;
    return out;
  }
  const sid = typeof session === 'string' && SID.test(session) ? session : null;
  const lens = activeLens(db);
  let own = false;
  if (db.isTransaction !== true) { try { db.exec('BEGIN'); own = true; } catch { own = false; } }
  try {
    for (const raw of list) {
      const kind = raw?.kind;
      const type = raw?.type;
      const at = pageTime(raw?.at, now);
      if (!allow('page', PAGE_EVENTS_PER_MINUTE, now) || !allow(`${kind}/${type}`, typeOf(kind, type)?.limit ?? 60, now)) {
        out.dropped += 1;
        continue;
      }
      if (kind === 'exposure') {
        if (!EXPOSURE_LISTS.includes(type)) { out.refused += 1; continue; }
        const d = raw.data && typeof raw.data === 'object' ? raw.data : {};
        const r = recordExposure(db, {
          list: type, rows: rowsForPeople(db, d.people), sort: typeof d.sort === 'string' ? d.sort.slice(0, 40) : null,
          context: typeof d.context === 'string' ? d.context.slice(0, 80) : null, at, lens, on: true, extra: sid ? { sid } : null,
        });
        if (r.recorded) out.recorded += 1;
        continue;
      }
      const clean = cleanPageEvent(raw);
      if (!clean) { out.refused += 1; continue; }
      const def = typeOf(kind, type);
      // A rest on a dot counts from 1.5 s: shorter ones are passing over, never logged.
      if (kind === 'interaction' && type === 'hover' && !(Number(clean.data.ms) >= 1500 && Number(clean.data.n) >= 1)) { out.refused += 1; continue; }
      let row = null;
      let person = null;
      if (def.person) {
        const p = raw.person && typeof raw.person === 'object' ? raw.person : null;
        const [found] = p ? rowsForPeople(db, [p]) : [];
        if (!found) { out.refused += 1; continue; }
        if (found.headline !== undefined) row = found;
        else person = personKey(found.profile_url || found);
      }
      const key = typeof raw.key === 'string' && raw.key ? raw.key.slice(0, 120) : null;
      const r = recordEvent(db, {
        kind, type, row, person, at, lens, on: true, data: sid ? { ...clean.data, sid } : clean.data,
        dedupe: key ? `pg:${kind}/${type}:${sid || '-'}:${key}` : null,
      });
      if (r.recorded) out.recorded += 1;
    }
    const lost = out.dropped + (Number.isInteger(pageDropped) && pageDropped > 0 ? Math.min(pageDropped, 100000) : 0);
    if (lost > 0 && allow('health/dropped', TAXONOMY.health.dropped.limit, now)) {
      recordEvent(db, {
        kind: 'health', type: 'dropped', lens, on: true, at: new Date(now).toISOString(),
        data: { n: lost, where: out.dropped ? 'server' : 'page', ...(sid ? { sid } : {}) },
      });
    }
    if (own) db.exec('COMMIT');
  } catch (err) {
    if (own) { try { db.exec('ROLLBACK'); } catch { /* nothing to undo */ } }
    throw err;
  }
  return out;
}

/**
 * A setting saved with a new value (POST /api/settings): one 'settings/change'
 * per key that changed, old and new. A long value (a theme, saved layouts, the
 * title ranking) is kept as its size and a hash, so the log says it changed
 * without holding a second copy of it.
 */
export function recordSettingsChange(db, before = {}, after = {}, keys = null) {
  const short = (v) => {
    const text = json(v);
    return text.length <= 300 ? (v ?? null) : { size: text.length, hash: hash(v) };
  };
  let n = 0;
  for (const key of keys || Object.keys(after || {})) {
    if (json(before?.[key]) === json(after?.[key])) continue;
    const r = tryRecord(db, { kind: 'settings', type: 'change', lens: null, data: { key, old: short(before?.[key]), new: short(after?.[key]) } });
    if (r.recorded) n += 1;
  }
  return n;
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

/**
 * The log's size, for Settings → Your data: { events, bytes, first, last,
 * byKind, byType, on }. (Events with no dedupe key once counted as no bytes:
 * a NULL in the sum. They count now.)
 */
export function logStats(db) {
  const all = db.prepare(`SELECT count(*) AS n, min(at) AS first, max(at) AS last,
    total(length(coalesce(data, '')) + length(coalesce(dedupe, '')) + 64) AS bytes FROM learning_events`).get();
  const byKind = Object.fromEntries(db.prepare('SELECT kind, count(*) AS n FROM learning_events GROUP BY kind').all().map((r) => [r.kind, r.n]));
  const byType = Object.fromEntries(db.prepare('SELECT kind, type, count(*) AS n FROM learning_events GROUP BY kind, type').all().map((r) => [`${r.kind}/${r.type}`, r.n]));
  return {
    events: all.n || 0, bytes: Math.round(all.bytes || 0), first: all.first || null, last: all.last || null,
    byKind, byType, schemaVersion: LEARNING_SCHEMA_VERSION, on: behaviourOn(db),
  };
}

const median = (xs) => {
  const v = xs.filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  if (!v.length) return null;
  const m = Math.floor(v.length / 2);
  return v.length % 2 ? v[m] : Math.round((v[m - 1] + v[m]) / 2);
};

/**
 * Each window session, newest first: { session, start, last, loads, ms,
 * activeMs, ended, version, plugins, class, theme, size, shell, views, tabs:
 * { tab: ms }, events }. Built from the session and nav events (a reload adds
 * a load to the same session; the longest pulse or end gives its length).
 */
export function sessionSummaries(db, { since: from = '1970-01-01T00:00:00.000Z', limit = 200 } = {}) {
  const rows = db.prepare(`SELECT at, kind, type, data FROM learning_events WHERE kind IN ('session', 'nav') AND at >= ? ORDER BY at, seq`)
    .all(nowIso(from)).map(decode);
  const out = new Map();
  for (const e of rows) {
    const sid = e.data?.sid;
    if (!sid) continue;
    let s = out.get(sid);
    if (!s) {
      s = { session: sid, start: e.at, last: e.at, loads: 0, ms: 0, activeMs: 0, ended: false, version: null, plugins: null, class: null, theme: null, size: null, shell: null, views: 0, tabs: {}, events: 0 };
      out.set(sid, s);
    }
    s.last = e.at;
    const d = e.data || {};
    if (e.kind === 'session') {
      if (e.type === 'start') {
        s.loads += 1;
        for (const f of ['version', 'plugins', 'class', 'theme', 'size', 'shell']) if (s[f] == null && d[f] != null) s[f] = d[f];
      }
      if (e.type === 'resize' && d.size) s.size = d.size;
      if (e.type === 'pulse' || e.type === 'end') {
        s.ms = Math.max(s.ms, Number(d.ms) || 0);
        s.activeMs = Math.max(s.activeMs, Number(d.activeMs) || 0);
        if (e.type === 'end') s.ended = true;
      }
    } else if (e.type === 'enter') {
      s.views += 1;
    } else if (e.type === 'dwell' && d.tab) {
      s.tabs[d.tab] = (s.tabs[d.tab] || 0) + (Number(d.ms) || 0);
    }
  }
  // Every event each session holds, whatever its kind.
  const counts = db.prepare(`SELECT json_extract(data, '$.sid') AS sid, count(*) AS n FROM learning_events
    WHERE at >= ? AND json_valid(data) AND json_type(data) = 'object' AND json_extract(data, '$.sid') IS NOT NULL GROUP BY sid`).all(nowIso(from));
  for (const c of counts) if (out.has(c.sid)) out.get(c.sid).events = c.n;
  return [...out.values()].sort((a, b) => (a.start < b.start ? 1 : -1)).slice(0, limit);
}

/** The steps from a card to a connection, in order. */
export const FUNNEL = Object.freeze(['card-open', 'profile-open', 'connect-click', 'request-sent', 'accepted']);

/** Steps this close together count in either order: Connect opens the profile as it's pressed. */
export const FUNNEL_SLACK_MS = 60 * 1000;

/**
 * The funnel: opened a card, then the profile, then Connect, then the request
 * went, then it was accepted. `reached` counts the people who took each step
 * and every step before it, the earlier ones first (within FUNNEL_SLACK_MS);
 * `any` everyone who took the step at all (Auto's requests, say, start at
 * Connect). `rate` is `reached` over the step before's. Per person with
 * { people: true }.
 */
export function funnel(db, { since: from = '1970-01-01T00:00:00.000Z', people = false } = {}) {
  const rows = db.prepare(`SELECT person, kind, type, at FROM learning_events WHERE person IS NOT NULL AND at >= ?
    AND ((kind = 'interaction' AND type IN ('card-open', 'profile-open', 'connect-click', 'request-sent')) OR (kind = 'outcome' AND type = 'accepted'))
    ORDER BY at, seq`).all(nowIso(from));
  const per = new Map();
  for (const r of rows) {
    const step = FUNNEL.indexOf(r.type);
    if (!per.has(r.person)) per.set(r.person, { person: r.person, first: new Array(FUNNEL.length).fill(null) });
    const p = per.get(r.person);
    if (p.first[step] == null) p.first[step] = r.at;
  }
  for (const p of per.values()) {
    const ms = p.first.map((at) => (at == null ? null : Date.parse(at)));
    p.reached = -1;
    for (let k = 0; k < FUNNEL.length; k += 1) {
      if (ms[k] == null || p.reached !== k - 1 || ms.slice(0, k).some((t) => t > ms[k] + FUNNEL_SLACK_MS)) break;
      p.reached = k;
    }
  }
  const all = [...per.values()];
  const stages = FUNNEL.map((stage, i) => ({ stage, reached: all.filter((p) => p.reached >= i).length, any: all.filter((p) => p.first[i] != null).length }));
  stages.forEach((s, i) => { s.rate = i === 0 ? null : stages[i - 1].reached ? Math.round((s.reached / stages[i - 1].reached) * 1000) / 1000 : null; });
  return {
    stages,
    ...(people ? { people: all.map((p) => ({ person: p.person, step: p.reached >= 0 ? FUNNEL[p.reached] : null, at: Object.fromEntries(FUNNEL.map((f, i) => [f, p.first[i]])) })) } : {}),
  };
}

/** Time on each tab, most first: { tab, visits, ms, activeMs, medianMs, subs: [{ sub, visits, ms, activeMs, medianMs }] }. */
export function dwellByTab(db, { since: from = '1970-01-01T00:00:00.000Z' } = {}) {
  const rows = db.prepare(`SELECT data FROM learning_events WHERE kind = 'nav' AND type = 'dwell' AND at >= ?`).all(nowIso(from)).map(decode);
  const tabs = new Map();
  const add = (map, key) => {
    if (!map.has(key)) map.set(key, { visits: 0, ms: 0, activeMs: 0, all: [] });
    return map.get(key);
  };
  for (const { data: d } of rows) {
    if (!d?.tab) continue;
    const t = add(tabs, d.tab);
    t.subs ??= new Map();
    for (const x of [t, add(t.subs, d.sub ?? null)]) {
      x.visits += 1;
      x.ms += Number(d.ms) || 0;
      x.activeMs += Number(d.activeMs) || 0;
      x.all.push(Number(d.ms) || 0);
    }
  }
  const done = ({ all, subs: _subs, ...x }) => ({ ...x, medianMs: median(all) });
  return [...tabs].map(([tab, t]) => ({
    tab, ...done(t), subs: [...t.subs].map(([sub, x]) => ({ sub, ...done(x) })).sort((a, b) => b.ms - a.ms),
  })).sort((a, b) => b.ms - a.ms);
}

/**
 * This or That, for calibrating the class models: each answered duel (both
 * cards as attributes, the choice, the decision time, the side, the round,
 * what it asked about) and, per class, how many were shown and answered, the
 * choices, the median decision time, how often the left card won, and how
 * often a mirrored repeat (the same pair, sides swapped) got the same answer.
 * Answers are replayed with their undos and retakes, as the build keeps them.
 */
export function duelCalibration(db, { since: from = '1970-01-01T00:00:00.000Z', cls = null } = {}) {
  const rows = db.prepare(`SELECT at, type, lens, data FROM learning_events WHERE kind = 'onboarding'
    AND type IN ('duel-shown', 'duel', 'duel-undo', 'retake') AND at >= ? ORDER BY at, seq`).all(nowIso(from)).map(decode);
  const per = new Map();
  const duels = [];
  const of = (key) => {
    if (!per.has(key)) per.set(key, { class: key, shown: 0, answered: 0, choices: {}, ms: [], left: 0, sided: 0, mirrors: 0, agree: 0, answers: [] });
    return per.get(key);
  };
  for (const e of rows) {
    const key = e.data?.class || e.lens;
    if (!key || (cls && key !== cls)) continue;
    const c = of(key);
    if (e.type === 'duel-shown') { c.shown += 1; continue; }
    if (e.type === 'duel-undo') { c.answers.pop(); continue; }
    if (e.type === 'retake') { c.answers = []; continue; }
    const d = e.data || {};
    c.answered += 1;
    c.choices[d.choice] = (c.choices[d.choice] || 0) + 1;
    if (Number.isFinite(d.ms)) c.ms.push(d.ms);
    if (d.choice === 'a' || d.choice === 'b') { c.sided += 1; if (d.choice === d.left) c.left += 1; }
    if (Number.isInteger(d.mirrorOf) && c.answers[d.mirrorOf]) {
      c.mirrors += 1;
      if (c.answers[d.mirrorOf].choice === d.choice) c.agree += 1;
    }
    c.answers.push({ choice: d.choice });
    duels.push({ at: e.at, class: key, choice: d.choice, ms: d.ms ?? null, left: d.left ?? null, round: d.round ?? null, focus: d.focus ?? null, mirrorOf: d.mirrorOf ?? null, a: d.a ?? null, b: d.b ?? null });
  }
  const classes = [...per.values()].map(({ ms, answers: _a, sided, left, mirrors, agree, ...c }) => ({
    ...c, medianMs: median(ms), leftRate: sided ? Math.round((left / sided) * 1000) / 1000 : null,
    mirrors, mirrorAgreement: mirrors ? Math.round((agree / mirrors) * 1000) / 1000 : null,
  }));
  return { classes, duels };
}

/** The whole log as one JSON-ready object, for Export. */
export function exportLog(db) {
  return {
    format: 'sixgree-learning-log',
    schema_version: LEARNING_SCHEMA_VERSION,
    snapshot_fields: SNAPSHOT_FIELDS,
    taxonomy: TAXONOMY,
    exported_at: new Date().toISOString(),
    events: db.prepare('SELECT * FROM learning_events ORDER BY seq').all().map(decode),
  };
}

// A cell as a spreadsheet reads it safely: quoted when it must be, and text that
// would start a formula (someone's headline can begin with "=") made plain text.
function cell(v) {
  if (v === null || v === undefined) return '';
  let text = typeof v === 'object' ? JSON.stringify(v) : String(v);
  if (typeof v === 'string' && /^[=+\-@\t\r]/.test(text) && !/^-?\d+(\.\d+)?$/.test(text)) text = `'${text}`;
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

const CSV_COLUMNS = ['seq', 'at', 'kind', 'type', 'person', 'user_id', 'lens', 'snap', 'schema_version'];

/**
 * The log as CSV, one table per kind: its own columns, then one per field the
 * kind's events carry (a snapshot's are SNAPSHOT_FIELDS). @returns Map kind → CSV text.
 */
export function csvByKind(db) {
  const out = new Map();
  for (const kind of KINDS) {
    const rows = db.prepare('SELECT * FROM learning_events WHERE kind = ? ORDER BY seq').all(kind).map(decode);
    if (!rows.length) continue;
    const fields = kind === 'snapshot' ? [...SNAPSHOT_FIELDS]
      : [...new Set(rows.flatMap((r) => (r.data && typeof r.data === 'object' && !Array.isArray(r.data) ? Object.keys(r.data) : [])))].sort();
    const head = [...CSV_COLUMNS, ...fields.map((f) => (CSV_COLUMNS.includes(f) ? `data_${f}` : f))];
    const lines = [head.map(cell).join(',')];
    for (const r of rows) {
      const values = kind === 'snapshot'
        ? fields.map((_, i) => (Array.isArray(r.data) ? r.data[i] : null))
        : fields.map((f) => r.data?.[f]);
      lines.push([...CSV_COLUMNS.map((c) => r[c]), ...values].map(cell).join(','));
    }
    out.set(kind, `${lines.join('\r\n')}\r\n`);
  }
  return out;
}

/** Export (CSV): one zip with a CSV per kind and the taxonomy beside them. */
export function exportCsvZip(db) {
  const entries = [...csvByKind(db)].map(([kind, text]) => ({ name: `${kind}.csv`, data: text }));
  entries.push({ name: 'taxonomy.json', data: JSON.stringify({ schema_version: LEARNING_SCHEMA_VERSION, snapshot_fields: SNAPSHOT_FIELDS, taxonomy: TAXONOMY }, null, 2) });
  return writeZip(entries);
}

/** Delete learning log: every event, at once. @returns how many went. */
export function deleteLog(db) {
  const n = db.prepare('SELECT count(*) AS n FROM learning_events').get().n;
  db.exec('DELETE FROM learning_events');
  return n;
}
