// Who Separation's "you haven't asked" moves on past, and who takes their place.
//
// Blake, 2026-10-06 (1.2.6): once he added someone from the top ten, Auto or
// Connect, "nothing refreshes ... they are all the same". The top ten read
// only the shared request list (lib/requests-client.js), which is loaded once
// per page and changed by the one Auto button that started the send, a moment
// after its job ended, and only while that button was still on screen. A
// request that waited in the scan queue while he opened the next person's card
// was never seen to end here, so its person kept their place until a reload.
//
// Now the scanner's own answer counts too (lib/scraper-client.js): a request
// being sent takes the person out of the top at once and the next-best fills
// in; one waiting in the queue keeps its place, marked Queued; one that ended
// with LinkedIn showing it pending stays out; one that failed comes back.
//
// Plain functions, so tests/ask-next.test.mjs runs them as they are.

import { connectMarks } from './auto-connect.js';
import { queueKind } from './scan-queue.js';

/** What takes someone out of the top: you know them, asked them, or Auto is asking now. */
export const LEAVES_TOP = Object.freeze(['connected', 'asked', 'sending']);
export const leavesTop = (status) => LEAVES_TOP.includes(status);

/**
 * Auto's requests as the scanner tells them, person key → 'sending' (its job
 * runs now), 'queued' (waiting in the scan queue) or 'sent' (it ended with
 * LinkedIn showing it pending). A request that ended any other way leaves
 * nothing, so its person is back where they were. `keyOf(rowId)` is the
 * person a row id belongs to (separationPeople's rowToKey), or null.
 */
export function autoAsks(scan, keyOf) {
  const out = new Map();
  if (!scan || typeof keyOf !== 'function') return out;
  // Oldest first, so the newest ending for a person is the one that stands.
  const recent = Array.isArray(scan.recent) ? [...scan.recent].reverse() : [];
  for (const j of recent) {
    if (j?.action !== 'connect' || j.target?.id == null) continue;
    const key = keyOf(j.target.id);
    if (!key) continue;
    if (connectMarks(j.outcome)) out.set(key, 'sent');
    else out.delete(key);
  }
  for (const i of scan.queue?.items || []) {
    if (i?.status !== 'waiting' || (i.kind ?? queueKind(i.action)) !== 'add' || i.target?.id == null) continue;
    const key = keyOf(i.target.id);
    if (key && out.get(key) !== 'sent') out.set(key, 'queued');
  }
  if (scan.running && scan.action === 'connect' && scan.target?.id != null) {
    const key = keyOf(scan.target.id);
    if (key) out.set(key, 'sending');
  }
  return out;
}

/**
 * One person's status in Separation: 'connected', 'asked', 'sending',
 * 'queued' or null. `requested` is the shared list's answer (hasRequest);
 * `undone` is a request this page took back, which a finished Auto job from
 * before never undoes; `auto` is autoAsks' answer for them.
 */
export function askStatus({ connected = false, requested = false, undone = false, auto = null } = {}) {
  if (connected) return 'connected';
  if (requested || (auto === 'sent' && !undone)) return 'asked';
  if (auto === 'sending') return 'sending';
  if (auto === 'queued') return 'queued';
  return null;
}

/** The first `n` of `people` (in order) that `statusOf` leaves in the top. */
export function topToAsk(people, statusOf, n) {
  const out = [];
  for (const p of people || []) {
    if (out.length >= n) break;
    if (!leavesTop(statusOf(p))) out.push(p);
  }
  return out;
}

/**
 * A short signature of what autoAsks reads from the scanner, so a view
 * recomputes when a request starts, waits, or ends, and not on every page of
 * a scan's progress.
 */
export function autoAsksSignature(scan) {
  if (!scan) return '';
  const run = scan.running && scan.action === 'connect' ? `r:${scan.target?.id ?? ''}` : '';
  const queued = (scan.queue?.items || [])
    .filter((i) => i?.status === 'waiting' && (i.kind ?? queueKind(i.action)) === 'add')
    .map((i) => i.target?.id).join(',');
  const ended = (scan.recent || []).filter((j) => j?.action === 'connect')
    .map((j) => `${j.startedAt}:${j.target?.id ?? ''}:${j.outcome ?? ''}`).join(',');
  return `${run}|${queued}|${ended}`;
}
