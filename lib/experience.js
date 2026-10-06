// A person's experience, from Read profiles (Blake, 2026-10-05: "optional full
// profile reads", off by default). The scanner opens a 1st-degree connection's
// profile, reads their current and past roles (scripts/scrape.py
// read_profiles), and sends them to /api/ingest as { type: 'experience' }. They
// are kept on that person's row as one JSON text column, `experience`:
//
//   { v: 1, status: 'read', at, source: 'data' | 'page', shown, roles: [
//       { title, company, start: 'YYYY-MM' | 'YYYY' | null, end: … | null, current } ] }
//   { v: 1, status: 'unreadable', at, why }
//
// "unreadable" is the scanner saying it couldn't read their experience (the
// page changed, nothing there it understood). It is never stored as an empty
// list, which would read as "no experience" (TRAPS §7): a read that names no
// role becomes "unreadable" here, whatever it claimed.
//
// Scoring reads `roles` beside the headline (lib/scoring.js rolesWithCompanies):
// a current role counts like one in the headline, a past one as a former role.
// Plain functions, shared with the browser; tests/experience.test.mjs.

export const EXPERIENCE_VERSION = 1;
export const MAX_ROLES = 30;
const TEXT_MAX = 120;
/** How long a profile that couldn't be read waits before Read profiles tries it again. */
export const RETRY_UNREADABLE_DAYS = 14;

const text = (v) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, TEXT_MAX) : '');
const DATE = /^\d{4}(-(0[1-9]|1[0-2]))?$/;
const date = (v) => (typeof v === 'string' && DATE.test(v.trim()) ? v.trim() : null);

/** One role as stored, or null when it has no title. */
export function cleanRole(r) {
  if (!r || typeof r !== 'object') return null;
  const title = text(r.title);
  if (!title) return null;
  const end = date(r.end);
  return {
    title,
    company: text(r.company) || null,
    start: date(r.start),
    end,
    current: r.current === true || (r.current == null && !end && Boolean(date(r.start))),
  };
}

/**
 * What the scanner sent for one person, as it is stored: a read with at least
 * one role, or "unreadable" with why. `now` is an ISO time.
 */
export function cleanExperience(input, now = new Date().toISOString()) {
  const at = typeof input?.at === 'string' && !Number.isNaN(Date.parse(input.at)) ? input.at : now;
  const roles = Array.isArray(input?.roles) ? input.roles.map(cleanRole).filter(Boolean).slice(0, MAX_ROLES) : [];
  if (input?.status === 'read' && roles.length) {
    const shown = Number.isInteger(input.shown) && input.shown >= 0 ? input.shown : null;
    return { v: EXPERIENCE_VERSION, status: 'read', at, source: input.source === 'data' ? 'data' : 'page', ...(shown != null ? { shown } : {}), roles };
  }
  const why = text(input?.why) || (input?.status === 'read' ? 'no role in it could be read' : 'it couldn’t be read');
  return { v: EXPERIENCE_VERSION, status: 'unreadable', at, why };
}

/** A row's stored experience, parsed, or null (none, or not ours). */
export function readExperience(row) {
  const raw = row?.experience;
  if (!raw) return null;
  try {
    const e = typeof raw === 'string' ? JSON.parse(raw) : raw;
    return e && (e.status === 'read' || e.status === 'unreadable') ? e : null;
  } catch {
    return null;
  }
}

/** The roles read from their profile, [] when none were read. */
export function experienceRoles(row) {
  const e = readExperience(row);
  return e?.status === 'read' && Array.isArray(e.roles) ? e.roles : [];
}

/** 'read', 'unreadable' or null: what Read profiles knows about this person. */
export function experienceState(row) {
  return readExperience(row)?.status ?? null;
}

/**
 * Who Read profiles would open next, in order: 1st-degree connections with a
 * profile and no experience on file, highest power first; then people whose
 * profile couldn't be read more than RETRY_UNREADABLE_DAYS ago, at the back
 * (TRAPS §15: an attempt is recorded, so a failure isn't retried at the front
 * forever). People read already are never in it. scrape.py
 * profile_read_targets keeps the same order (tests/experience.test.mjs).
 */
export function readProfileQueue(rows, now = Date.now()) {
  const fresh = [];
  const retry = [];
  for (const r of rows || []) {
    if (Number(r?.degree) !== 1 || !r?.profile_url) continue;
    const e = readExperience(r);
    if (!e) fresh.push(r);
    else if (e.status === 'unreadable' && now - Date.parse(e.at) > RETRY_UNREADABLE_DAYS * 86400000) retry.push(r);
  }
  const byPower = (a, b) => (Number(b.power_score) || 0) - (Number(a.power_score) || 0);
  return [...fresh.sort(byPower), ...retry.sort(byPower)];
}

/** Counts for the Scan page: { read, unreadable, waiting } among your connections. */
export function experienceCounts(rows, now = Date.now()) {
  let read = 0;
  let unreadable = 0;
  for (const r of rows || []) {
    if (Number(r?.degree) !== 1 || !r?.profile_url) continue;
    const s = experienceState(r);
    if (s === 'read') read += 1;
    else if (s === 'unreadable') unreadable += 1;
  }
  return { read, unreadable, waiting: readProfileQueue(rows, now).length };
}
