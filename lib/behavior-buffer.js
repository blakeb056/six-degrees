// The pages' side of the learning log, without the page (lib/learning-client.js
// wires it to the window): a buffer that takes events, keeps a repeat within a
// second as one (a double click, React running an effect twice), drops a flood
// (a type past its TAXONOMY `limit` a minute, or every type past
// PAGE_LIMIT_PER_MINUTE), and hands them on in batches every few seconds, each
// small enough for a request sent as the page goes away (keepalive's 64 KB).
// What it dropped is counted and sent with the next batch, so a gap in the log
// says it's one. Pure: the time, the timer, the idle callback and `send` are
// given, so the tests drive it by hand.

import { typeOf } from './behavior-taxonomy.js';

/** How long events wait to go together. */
export const FLUSH_MS = 4000;
/** Events kept waiting at most; past it, dropped and counted. */
export const MAX_QUEUE = 400;
/** One batch's size at most, well under keepalive's 64 KB. */
export const MAX_BATCH_BYTES = 48000;
/** The same event twice within this is one. */
export const SAME_MS = 1000;
/** Events a minute from one window, every type together. */
export const PAGE_LIMIT_PER_MINUTE = 600;
const MINUTE = 60 * 1000;

export function createBuffer({
  send, now = () => Date.now(), later = (fn, ms) => setTimeout(fn, ms), idle = (fn) => fn(), flushMs = FLUSH_MS,
} = {}) {
  let queue = [];
  let dropped = 0;
  let timer = null;
  let on = true;
  const recent = new Map();
  const counts = new Map();
  const collectors = [];

  const allow = (key, max, t) => {
    let c = counts.get(key);
    if (!c || t - c.start >= MINUTE) { c = { start: t, n: 0 }; counts.set(key, c); }
    if (c.n >= max) return false;
    c.n += 1;
    return true;
  };

  function schedule() {
    if (timer != null) return;
    timer = later(() => { timer = null; idle(() => flush()); }, flushMs);
  }

  /**
   * One event: { kind, type, data, person?: { id?, profile_url? }, key?, at? }.
   * @returns true when it was queued.
   */
  function add({ kind, type, data = {}, person = null, key = null, at = null }) {
    if (!on || !kind || !type) return false;
    const t = now();
    const sig = JSON.stringify([kind, type, person?.id ?? person?.profile_url ?? null, data, key]);
    const prev = recent.get(sig);
    if (prev != null && t - prev < SAME_MS) return false;
    if (recent.size > 1000) recent.clear();
    recent.set(sig, t);
    if (queue.length >= MAX_QUEUE || !allow('all', PAGE_LIMIT_PER_MINUTE, t) || !allow(`${kind}/${type}`, typeOf(kind, type)?.limit ?? 60, t)) {
      dropped += 1;
      return false;
    }
    queue.push({ kind, type, at: at ?? t, ...(key ? { key } : {}), ...(person ? { person } : {}), data });
    schedule();
    return true;
  }

  /**
   * Send what's waiting: one batch, or with `urgent` (the page is going away)
   * every batch now. Collectors (the hover sums) add theirs first.
   * @returns how many events went.
   */
  function flush({ urgent = false } = {}) {
    for (const c of collectors) { try { c(); } catch { /* a collector never stops the rest */ } }
    let sent = 0;
    while (queue.length || dropped) {
      const chunk = [];
      let bytes = 0;
      while (queue.length) {
        const size = JSON.stringify(queue[0]).length + 1;
        if (chunk.length && bytes + size > MAX_BATCH_BYTES) break;
        chunk.push(queue.shift());
        bytes += size;
      }
      const lost = dropped;
      dropped = 0;
      try { send({ events: chunk, dropped: lost }, { urgent }); } catch { /* the log is never in the way */ }
      sent += chunk.length;
      if (!urgent) break;
    }
    if (queue.length) schedule();
    return sent;
  }

  return {
    add,
    flush,
    /** "Record my behaviour": off, nothing is queued and what's waiting goes. */
    setOn(v) {
      on = v !== false;
      if (!on) { queue = []; dropped = 0; }
    },
    isOn: () => on,
    /** A function run before each flush, which may add events (the hover sums). */
    onFlush(fn) { collectors.push(fn); },
    waiting: () => queue.length,
    droppedSoFar: () => dropped,
  };
}
