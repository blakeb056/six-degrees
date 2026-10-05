// The scanner's queue: what runs next, once the running job ends.
//
// Blake, 2026-10-05: "if someone auto connects but theres one already being
// added i want a queue thing to basically let the next person they want to add
// or bridge be queued in the scanner and have it shown in the notch."
//
// The scanner still runs one job at a time. A press of Auto, or a scan of one
// person's circle (Scan, Build their circle, Resume), while something runs is
// kept here instead of refused, and app/api/scraper/route.js starts the next
// one when the running job ends, through every check a press would meet then
// (budget, caps, cooldown, Auto's own caps and its one-time yes). A check that
// refuses marks that one skipped, with its reason, and the queue moves on.
//
// Pure: no files, no clock of its own, so the browser can share the words and
// a test can drive it. The file it lives in is lib/scan-queue-store.js.

/** At most this many waiting at once. */
export const QUEUE_CAP = 10;

/** What a queued job does, in the notch's words: Auto's request, or one person's circle. */
export function queueKind(action) {
  if (action === 'connect') return 'add';
  if (['bridge', 'rescrape', 'resume'].includes(action)) return 'circle';
  return null;
}

export const KIND_LABEL = Object.freeze({ add: 'Add', circle: 'Build circle' });

/** 1st, 2nd, 3rd, 4th … 11th, 12th, 13th, 21st. */
export function ordinal(n) {
  const v = n % 100;
  const s = v >= 11 && v <= 13 ? 'th' : ({ 1: 'st', 2: 'nd', 3: 'rd' })[n % 10] || 'th';
  return `${n}${s}`;
}

/** An empty queue. `paused` holds why it waits for you ('stopped', 'restarted'), or null. */
export function emptyQueue() {
  return { paused: null, items: [] };
}

/** A queue read back from anywhere, kept to the shape this file writes. */
export function cleanQueue(raw) {
  const q = emptyQueue();
  if (!raw || typeof raw !== 'object') return q;
  q.paused = typeof raw.paused === 'string' && raw.paused ? raw.paused : null;
  for (const it of Array.isArray(raw.items) ? raw.items : []) {
    const kind = queueKind(it?.action);
    const id = typeof it?.target?.id === 'string' ? it.target.id : null;
    if (!kind || !id || typeof it.id !== 'string') continue;
    q.items.push({
      id: it.id,
      action: it.action,
      kind,
      target: { id, name: typeof it.target.name === 'string' ? it.target.name : null },
      request: it.request && typeof it.request === 'object' ? it.request : { action: it.action, id },
      at: Number(it.at) || 0,
      status: it.status === 'skipped' ? 'skipped' : 'waiting',
      reason: it.status === 'skipped' && typeof it.reason === 'string' ? it.reason : null,
    });
  }
  return q;
}

export const waitingIn = (q) => q.items.filter((i) => i.status === 'waiting');

/** Is this the same request: the same person, for the same thing? */
const same = (kind, personId) => (i) => i.kind === kind && i.target?.id === personId;

/**
 * Add one request to the queue. `item` is { id, action, target, request, at };
 * `running` is the running job ({ action, target }), so a press for what is
 * already running is ignored too. Changes `q`, and says what happened:
 *   { queued: true, place }              added; place 1 runs next
 *   { duplicate: true, place | running } already waiting (its place) or running
 *   { full: true }                       QUEUE_CAP already waiting
 */
export function enqueue(q, item, running = null) {
  const kind = queueKind(item.action);
  const personId = item.target?.id;
  if (!kind || !personId) return { refused: true };
  if (running && queueKind(running.action) === kind && running.target?.id === personId) return { duplicate: true, running: true };
  const waiting = waitingIn(q);
  const at = waiting.findIndex(same(kind, personId));
  if (at >= 0) return { duplicate: true, place: at + 1 };
  if (waiting.length >= QUEUE_CAP) return { full: true };
  // A skipped one for the same request gives way to the new press.
  q.items = q.items.filter((i) => !(i.status === 'skipped' && same(kind, personId)(i)));
  q.items.push({ ...item, kind, status: 'waiting', reason: null });
  return { queued: true, place: waiting.length + 1 };
}

/** The next to start, or null while paused or empty. */
export function nextUp(q) {
  if (q.paused) return null;
  return waitingIn(q)[0] || null;
}

/** Take one out (it started, or you removed it). */
export function removeItem(q, id) {
  const before = q.items.length;
  q.items = q.items.filter((i) => i.id !== id);
  return q.items.length !== before;
}

/** A check refused it at its start: kept, with why, until removed or cleared. */
export function skipItem(q, id, reason) {
  const it = q.items.find((i) => i.id === id);
  if (!it) return false;
  it.status = 'skipped';
  it.reason = String(reason || 'It couldn’t start.');
  return true;
}

/** Everything out, and nothing waits for you. */
export function clearQueue(q) {
  q.items = [];
  q.paused = null;
}

/** What the page sees: no request bodies, waiting first in order, then the skipped. */
export function queueView(q) {
  const waiting = waitingIn(q);
  return {
    paused: q.paused,
    cap: QUEUE_CAP,
    waiting: waiting.length,
    items: [...waiting, ...q.items.filter((i) => i.status === 'skipped')].map((i) => ({
      id: i.id, action: i.action, kind: i.kind, target: i.target, at: i.at, status: i.status, reason: i.reason,
    })),
  };
}

/** A person's place in the queue for `action` (1 runs next), or null. */
export function placeOf(view, action, personId) {
  const kind = queueKind(action);
  if (!kind || !personId) return null;
  const waiting = (view?.items || []).filter((i) => i.status === 'waiting');
  const at = waiting.findIndex(same(kind, personId));
  return at >= 0 ? at + 1 : null;
}
