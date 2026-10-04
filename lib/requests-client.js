// A request you've sent, everywhere at once.
//
// Blake, 2026-09-28: "once a person is sent our a connection request hitting
// that button then it should commuiniacte in the app all around". It didn't.
// Each place that sent one kept its own note of it: the card's link told
// nothing else on the page (and kept offering itself), the Outlink queue kept
// a list of row ids, and Separation, the circle and Orbit read nothing at all,
// even after a reload. Now there is one list, per person (their profile URL,
// so every bridge's copy of them agrees), loaded once and changed only through
// markRequested / undoRequest here, and every view reads it (useRequests).

import { keyFor } from './separation.js';

export const REQUESTS_UNKNOWN = Object.freeze({ known: false, sent: new Set(), mine: new Map(), version: 0 });

const listeners = new Set();
let now = REQUESTS_UNKNOWN;
let loading = null;
// What this page did itself, person → true (sent) / false (undone). It wins
// over the list as loaded, so a send made while the list was on its way stays.
const mine = new Map();

function publish(sent = now.sent, known = now.known) {
  now = Object.freeze({ known, sent, mine: new Map(mine), version: now.version + 1 });
  for (const listener of [...listeners]) listener();
}

function load() {
  if (loading || now.known) return loading;
  loading = fetch('/api/outreach')
    .then((r) => (r.ok ? r.json() : null))
    .then((d) => { if (d) publish(new Set((d.pending || []).map(keyFor)), true); })
    .catch(() => { /* the sample network, or the app restarting: the rows' own columns stand in */ })
    .finally(() => { loading = null; });
  return loading;
}

/** Call `listener` whenever the list changes. Returns the way to stop. */
export function watchRequests(listener) {
  listeners.add(listener);
  load();
  return () => listeners.delete(listener);
}

export function requestsNow() {
  return now;
}

/**
 * Is a request out to this person? What this page did wins; then the list
 * as loaded; until that arrives, the row's own columns.
 */
export function hasRequest(row, state = now) {
  if (!row) return false;
  const key = keyFor(row);
  if (state.mine.has(key)) return state.mine.get(key);
  if (state.known) return state.sent.has(key);
  return row.unlock_status === 'pending' || row.outreach_status === 'sent';
}

/** How many people have a request out. */
export function requestCount(state = now) {
  const keys = new Set(state.known ? state.sent : []);
  for (const [key, on] of state.mine) (on ? keys.add(key) : keys.delete(key));
  return keys.size;
}

async function post(body) {
  const r = await fetch('/api/outreach', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.error || 'Could not save that.');
  return d;
}

/**
 * You sent this person a request. Every view shows it at once; the save
 * follows, and is taken back on screen if it fails. `bridgeId` is the
 * connection you asked through, kept for when they accept.
 */
export async function markRequested(row, { bridgeId } = {}) {
  const key = keyFor(row);
  const before = mine.has(key) ? mine.get(key) : undefined;
  mine.set(key, true);
  publish();
  try {
    return await post({ action: 'mark-sent', connectionId: row.id, profileUrl: row.profile_url, bridgeId });
  } catch (err) {
    if (before === undefined) mine.delete(key);
    else mine.set(key, before);
    publish();
    throw err;
  }
}

/**
 * A request the app has already saved, shown everywhere at once with nothing
 * posted: Auto's, which the server marks itself once LinkedIn shows it pending
 * (app/api/scraper/route.js, lib/requests.js).
 */
export function sawRequested(row) {
  mine.set(keyFor(row), true);
  publish();
}

/** Take a request back, everywhere. */
export async function undoRequest(row) {
  const key = keyFor(row);
  const before = mine.has(key) ? mine.get(key) : undefined;
  mine.set(key, false);
  publish();
  try {
    return await post({ action: 'undo', connectionId: row.id, profileUrl: row.profile_url });
  } catch (err) {
    if (before === undefined) mine.delete(key);
    else mine.set(key, before);
    publish();
    throw err;
  }
}
