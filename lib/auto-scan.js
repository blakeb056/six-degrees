// Auto scan (experimental): the header button's sittings, rests and hours, as
// rules. No Node imports, so the page, the server (app/api/scraper/route.js)
// and the tests share them.
//
// Blake, 1.2.0: "it doesn't even work … it needs a slow / med / fast and the
// colour dots to pick which tiers." Until then Auto scan was one long scanner
// run that did its own waiting: it opened Chrome and a profile, then slept
// through the night or an hour's rest in place, and it ended for good after
// ten people. Now the app runs it as short sittings (scrape.py --sitting): one
// sitting is one run, the rest between sittings is kept here with no browser
// open, and the next sitting starts by itself, only from 9:00 to 18:00 and only
// while the app is open. It stops at your daily limit, and after LinkedIn
// pushes back. A pace only changes a sitting's size and the rest after it,
// never the limit: Fast reaches today's limit sooner, never past it. (The
// scanner still keeps every check of its own inside each sitting.)
//
// One job at a time with the queue (lib/scan-queue.js): what you queue goes
// first. A sitting starts only when nothing runs and nothing waits; a press
// during a sitting waits for it to end (a sitting is at most 12 searches); and
// during a rest the scanner is free for anything you start.

import { AUTO, PEOPLE_PER_SEARCH } from './usage.js';

const MIN = 60;
const DAY = 24 * 3600;

// Sitting: searches before a rest. Rest: seconds between sittings. Medium is the
// pacing Auto scan always had (scrape.py SESSION_PAGES, SESSION_REST).
export const AUTO_PACES = Object.freeze({
  slow: Object.freeze({ label: 'Slow', sitting: 4, rest: 90 * MIN }),
  medium: Object.freeze({ label: 'Medium', sitting: AUTO.sitting, rest: AUTO.sittingRest }),
  fast: Object.freeze({ label: 'Fast', sitting: 12, rest: 30 * MIN }),
});
export const PACE_KEYS = Object.freeze(['slow', 'medium', 'fast']);
export const TIER_KEYS = Object.freeze(['S', 'A', 'B', 'C', 'D']);
export const AUTO_DEFAULTS = Object.freeze({ pace: 'medium', tiers: Object.freeze(['S', 'A']) });
export const AUTO_HOURS = AUTO.hours;

// About how long one search takes inside a sitting: the scanner's 20 s before
// each page at its fastest, and the page loading. Only for the "people an hour"
// estimate; the scanner's own waits are what actually happen.
export const SECONDS_A_SEARCH = 30;

/** A pace's key, or Medium for anything else. */
export function cleanPace(p) {
  return PACE_KEYS.includes(p) ? p : AUTO_DEFAULTS.pace;
}

/** Tiers in S-to-D order, each once; anything not a tier is dropped. [] when none. */
export function cleanTiers(list) {
  const want = new Set((Array.isArray(list) ? list : []).map((t) => String(t).trim().toUpperCase()));
  return TIER_KEYS.filter((t) => want.has(t));
}

/** "S", "S and A", "S, A and B". */
export function tierList(tiers) {
  const t = cleanTiers(tiers);
  if (t.length <= 1) return t.join('');
  return `${t.slice(0, -1).join(', ')} and ${t[t.length - 1]}`;
}

/** Searches an hour while sittings run back to back with their rests. */
export function searchesAnHour(pace) {
  const p = AUTO_PACES[cleanPace(pace)];
  return (p.sitting * 3600) / (p.rest + p.sitting * SECONDS_A_SEARCH);
}

/** About how many people an hour that finds, to the nearest ten. An estimate, and said as one. */
export function peopleAnHour(pace) {
  return Math.max(10, Math.round((searchesAnHour(pace) * PEOPLE_PER_SEARCH) / 10) * 10);
}

const restWords = (s) => (s === 3600 ? 'an hour’s rest' : s % 3600 === 0 ? `${s / 3600} hours’ rest` : `${Math.round(s / 60)} minutes’ rest`);

/** One plain line of what a pace means; with your daily limit, when it gets there. */
export function paceLine(pace, daily = null) {
  const key = cleanPace(pace);
  const p = AUTO_PACES[key];
  const base = `${p.label}: about ${peopleAnHour(key)} people an hour, ${restWords(p.rest)} after every ${p.sitting} searches.`;
  // Does it reach the daily limit inside the hours? Then say it stops there.
  const hours = AUTO_HOURS[1] - AUTO_HOURS[0];
  const rate = searchesAnHour(key);
  if (!daily || rate * hours <= daily) return base;
  const by = Math.max(1, Math.round(daily / rate));
  return `${base} It stops at your ${daily} a day, about ${by} hour${by === 1 ? '' : 's'} in.`;
}

/** Is `ms` inside Auto scan's hours, on this computer's clock? */
export function inHours(ms, hours = AUTO_HOURS) {
  const h = new Date(ms).getHours();
  return h >= hours[0] && h < hours[1];
}

/** When the hours next begin (ms): today at 9:00 if it's earlier, else tomorrow. */
export function nextHoursStart(ms, hours = AUTO_HOURS) {
  const d = new Date(ms);
  const start = new Date(d.getFullYear(), d.getMonth(), d.getDate(), hours[0], 0, 0, 0);
  if (d.getHours() >= hours[0]) start.setDate(start.getDate() + 1);
  return start.getTime();
}

/**
 * What Auto scan does now, from the facts:
 *   now          ms
 *   pace         'slow' | 'medium' | 'fast'
 *   restUntil    ms the rest after the last sitting ends, or null
 *   leftToday    searches left in your daily limit (null: no limit)
 *   leftMonth    searches left this month (null: no limit)
 *   daily        your daily limit, to say it
 *   cooldown     { until, reason } or null
 * Returns one of:
 *   { kind: 'go', sitting }      start a sitting of that many searches
 *   { kind: 'hours', until }     outside 9:00 to 18:00
 *   { kind: 'rest', until }      resting after a sitting
 *   { kind: 'stop', reason, as } the daily limit is reached ('limit'), or LinkedIn pushed back ('stopped')
 * A pace never adds a limit of its own: a sitting is never more than what's left
 * today, so Fast only gets to the limit sooner.
 */
export function autoPlan({ now, pace, restUntil = null, leftToday = null, leftMonth = null, daily = null, cooldown = null }) {
  if (cooldown && cooldown.until > now) {
    return { kind: 'stop', as: 'stopped', reason: `Scanning is paused after LinkedIn pushed back (${cooldown.reason}), so Auto scan has stopped.` };
  }
  if (leftToday != null && leftToday <= 0) {
    return { kind: 'stop', as: 'limit', reason: `Today’s limit${daily ? ` of ${daily} searches` : ''} is reached, so Auto scan has stopped for today.` };
  }
  if (leftMonth != null && leftMonth <= 0) {
    return { kind: 'stop', as: 'limit', reason: 'This month’s searches are used, so Auto scan has stopped.' };
  }
  if (!inHours(now)) return { kind: 'hours', until: nextHoursStart(now) };
  if (restUntil && restUntil > now) return { kind: 'rest', until: restUntil };
  const left = Math.min(leftToday ?? Infinity, leftMonth ?? Infinity);
  return { kind: 'go', sitting: Math.max(1, Math.min(AUTO_PACES[cleanPace(pace)].sitting, left)) };
}

/** "14:05", "tomorrow 9:00", "Wed 9:00": a time Auto scan carries on at, on this computer's clock. */
export function clockText(ms, now = Date.now()) {
  if (!Number.isFinite(ms)) return '';
  const d = new Date(ms);
  const time = `${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`;
  const day = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const days = Math.round((day(d) - day(new Date(now))) / (DAY * 1000));
  if (days <= 0) return time;
  if (days === 1) return `tomorrow ${time}`;
  return `${d.toLocaleDateString('en-GB', { weekday: 'short' })} ${time}`;
}

/**
 * The state in words, for the button and its panel: { phase, text, detail }.
 * `view` is the server's (route.js autoView): { on, phase, until, reason, sitting,
 * ended: { phase: 'done' | 'limit' | 'stopped', reason } }.
 */
export function autoStatus(view, now = Date.now()) {
  if (!view) return { phase: 'off', text: 'Off', detail: null };
  const until = view.until ? clockText(view.until, now) : '';
  switch (view.on ? view.phase : 'off') {
    case 'running':
      return { phase: 'running', text: 'Running', detail: view.sitting ? `A sitting of up to ${view.sitting} searches.` : null };
    case 'starting':
      return { phase: 'running', text: 'Starting', detail: null };
    case 'rest':
      return { phase: 'rest', text: `Resting until ${until}`, detail: 'The scanner is free meanwhile.' };
    case 'hours':
      return { phase: 'hours', text: `Outside hours · from ${until}`, detail: `It searches only from ${AUTO_HOURS[0]}:00 to ${AUTO_HOURS[1]}:00, so nothing runs until then. Leave Sixgree open.` };
    case 'waiting':
      return { phase: 'waiting', text: 'Waiting its turn', detail: view.reason || null };
    default: {
      const ended = view.ended;
      if (ended?.phase === 'done') return { phase: 'done', text: 'Nothing left to scan', detail: ended.reason || null };
      if (ended?.phase === 'limit') return { phase: 'limit', text: 'Limit reached', detail: ended.reason || null };
      if (ended?.phase === 'stopped') return { phase: 'stopped', text: 'Stopped', detail: ended.reason || null };
      return { phase: 'off', text: 'Off', detail: null };
    }
  }
}
