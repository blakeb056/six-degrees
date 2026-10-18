// The pages' events for the learning log (lib/learning-log.js, POST
// /api/learning): which people a list showed, and what was done with one.
// Same-origin only, to this app's own server; the log never leaves the
// computer. Never in the sample or the public demo, which have no server.
//
// A list is reported once it has settled (a short wait after it's drawn) and
// only when what it shows has changed, so scrolling, hovering and re-renders
// never spam the log. The server dedupes too.

import { IS_DEMO } from './demo.js';

const SETTLE_MS = 900;
const lastShown = new Map();
const timers = new Map();

function post(body) {
  if (IS_DEMO || typeof window === 'undefined') return;
  try {
    fetch('/api/learning', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), keepalive: true }).catch(() => {});
  } catch { /* the log is never in the way */ }
}

const who = (r) => ({ id: r?.id ?? null, profile_url: r?.profile_url ?? r?.profileUrl ?? null });

/**
 * A list as drawn: `list` is where (separation, breach, class, focus, map,
 * card...), `rows` in the order shown (the top 50 go), `sort` the order or lens.
 */
export function logExposure(list, rows = [], { sort = null, context = null } = {}) {
  const people = rows.slice(0, 50).map(who).filter((p) => p.id != null || p.profile_url);
  if (!people.length) return;
  const sig = `${sort}|${context}|${people.map((p) => p.id ?? p.profile_url).join(',')}`;
  const key = `${list}|${context || ''}`;
  if (lastShown.get(key) === sig) return;
  clearTimeout(timers.get(key));
  timers.set(key, setTimeout(() => {
    lastShown.set(key, sig);
    post({ event: 'exposure', list, sort, context, people });
  }, SETTLE_MS));
}

/** Something done with one person: card-open, skip, dismiss, never, more-like-this, not-this-one. */
export function logInteraction(type, row, data = {}) {
  if (!row) return;
  post({ event: 'interaction', type, ...who(row), data });
}
