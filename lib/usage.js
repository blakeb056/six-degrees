// Settings → LinkedIn usage: how close this account is to the line, in one
// look, the way Claude's own usage page shows a plan's limits. No Node
// imports, so the page and the tests share it; the counting itself is in
// lib/linkedin-limits.js (linkedinUsage), from the files the scanner writes.
//
// Why it exists: on 2026-09-28 a real account was restricted after 373
// searches in 24 hours (TRAPS §16), and the only budget view was a box folded
// away on the Scan page. Every number here is either counted from the
// scanner's own record or is a rule with a stated source; nothing is a guess
// presented as a fact.

import { RESTRICTED_AT, RISKY_DAILY, SAFE_LIMITS } from './search-risk.js';

const HOUR_MS = 3600 * 1000;
const DAY_MS = 24 * HOUR_MS;

// Auto scan's own ceilings (scripts/scrape.py AUTO_DAY_CAP, AUTO_WEEK_CAP,
// DRIP_HOURS, SESSION_PAGES, SESSION_REST, AUTO_PUSHBACK_REST). They hold
// however high the budget is set. tests/usage.test.mjs reads the scanner's
// numbers and checks these match, so the page can't describe rules the
// scanner doesn't keep.
export const AUTO = {
  day: 40,                       // searches in any 24 hours
  week: 200,                     // searches in any 7 days
  hours: [9, 18],                // searches only from 09:00 to 18:00, this computer's clock
  sitting: 8,                    // searches in one sitting
  sittingRest: 60 * 60,          // seconds of rest after each sitting
  pushbackRest: 2 * 24 * 3600,   // seconds off after a security check or being signed out
};

// About how many people one search finds. A page of LinkedIn's people search
// shows up to 10 (scripts/scrape.py, "10 results per page"); 9 allows for the
// last page of each list, which is usually short. An estimate, and the page
// says so (neo's handoff, 2026-10-03).
export const PEOPLE_PER_SEARCH = 9;

// Searches in 24 hours that count as too close: 60% of the 373 that got an
// account restricted. A margin on a number seen once, not a known safe line.
export const DANGER_AT = Math.ceil(0.6 * RESTRICTED_AT);

// LinkedIn doesn't publish a free account's monthly limit. People report
// somewhere around 250 to 350 searches (TRAPS §35); shown as a range people
// report, never as LinkedIn's number.
export const REPORTED_MONTH = [250, 350];

// A search within this long after a pushback is the same search that met it,
// not a new one: the evidence file's name is only to the second.
const PUSHBACK_GRACE_MS = 60 * 1000;

export const LEVELS = {
  ok: { label: 'Well within', color: '#00ff88' },
  'above-default': { label: 'Above the default', color: '#FFD700' },
  risky: { label: 'Risky', color: '#FF8C42' },
  danger: { label: 'Too close', color: '#ff6b6b' },
  paused: { label: 'Paused', color: '#ff6b6b' },
  unknown: { label: 'Can’t tell', color: '#8b9a9a' },
};

/**
 * Where this account stands, worst first:
 *   paused         a cooldown is on: nothing searches until it ends
 *   danger         60% of 373 or more in 24 hours, or searching again within
 *                  a day of LinkedIn pushing back
 *   risky          over 100 in 24 hours (what the budget picker asks about)
 *   above-default  over the default 50 in 24 hours
 *   ok             within the default
 *   unknown        the record can't be read (the scanner then counts the day as used)
 */
export function usageLevel({ cooldown, searchesDay, lastPushback, searchesSincePushback, now = Date.now() } = {}) {
  if (cooldown) return 'paused';
  if (!Number.isFinite(searchesDay)) return 'unknown';
  if (searchesDay >= DANGER_AT) return 'danger';
  if (searchedAfterPushback({ lastPushback, searchesSincePushback, now })) return 'danger';
  if (searchesDay > RISKY_DAILY) return 'risky';
  if (searchesDay > SAFE_LIMITS.daily) return 'above-default';
  return 'ok';
}

/** LinkedIn pushed back less than a day ago and searching has carried on since. */
export function searchedAfterPushback({ lastPushback, searchesSincePushback, now = Date.now() } = {}) {
  const at = lastPushback?.at;
  return Number.isFinite(at) && now - at < DAY_MS && now >= at && searchesSincePushback > 0;
}

/** Searches made after a pushback, from the record's times (epoch seconds). */
export function countAfter(times, atMs) {
  if (!Number.isFinite(atMs) || !Array.isArray(times)) return 0;
  const from = (atMs + PUSHBACK_GRACE_MS) / 1000;
  return times.filter((t) => t > from).length;
}

/**
 * What's left, as searches and about how many people they'd find: the daily
 * or monthly budget, whichever runs out first (null for one with no cap).
 * Nothing while scanning is paused. null when neither has a cap.
 */
export function estimate({ leftDay, leftMonth, paused = false } = {}) {
  const lefts = [leftDay, leftMonth].filter((n) => Number.isFinite(n));
  if (!lefts.length) return null;
  const searches = paused ? 0 : Math.max(0, Math.min(...lefts));
  const by = leftDay != null && leftMonth != null ? (leftDay <= leftMonth ? 'day' : 'month') : leftDay != null ? 'day' : 'month';
  return { searches, people: searches * PEOPLE_PER_SEARCH, by };
}

/** The plain-word warning for a level, or null when there's nothing to warn about. */
export function levelWarning(level, { searchesDay, cooldown, lastPushback, now = Date.now() } = {}) {
  if (level === 'paused') {
    // As the Scan page's banner says it (app/components/LinkedInLimits.js CooldownBanner).
    const why = String(cooldown?.reason || 'LinkedIn pushed back');
    return `Scanning is paused${cooldown?.until ? ` until ${whenText(cooldown.until)}` : ''}. `
      + `${why.charAt(0).toUpperCase()}${why.slice(1)}. Nothing that searches LinkedIn runs until then, so the account can recover.`;
  }
  if (level === 'danger') {
    if (searchesDay >= DANGER_AT) {
      return `${searchesDay} searches in the last 24 hours. A real account was restricted after ${RESTRICTED_AT}. `
        + 'Stop scanning until this comes down: each search stops counting 24 hours after it was made.';
    }
    return `LinkedIn pushed back ${agoText(lastPushback?.at, now)}, and searching has carried on since. `
      + 'Carrying on after a warning is what LinkedIn says turns it into a restriction. Leave it at least a day.';
  }
  if (level === 'risky') {
    return `More than ${RISKY_DAILY} searches in the last 24 hours. That is past what Six Degrees asks you to confirm, `
      + `and a free account's whole month may be ${REPORTED_MONTH[0]} to ${REPORTED_MONTH[1]}.`;
  }
  if (level === 'above-default') {
    return `More than the default ${SAFE_LIMITS.daily} searches in the last 24 hours. `
      + 'The default leaves room under limits LinkedIn doesn’t publish.';
  }
  if (level === 'unknown') {
    return 'The record of searches on this computer couldn’t be read, so the scanner counts today’s budget as used until it can.';
  }
  return null;
}

/** A bar's scale: past its last tick, and past what's been used. */
export function barMax(used, ticks = []) {
  const top = Math.max(0, ...ticks.filter(Number.isFinite));
  return Math.max(Math.ceil(top * 1.08), Math.ceil((Number(used) || 0) * 1.05), 1);
}

/** Midnight Pacific as LinkedIn's month turns over: "Nov 1, 12:00 AM Pacific". */
export function pacificText(ms) {
  const s = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Los_Angeles', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
  }).format(new Date(ms));
  return `${s.replace(/ /g, ' ')} Pacific`;
}

/** A time on this computer's clock: "Sat, Oct 3, 3:12 PM". */
export function whenText(ms) {
  return new Date(ms).toLocaleString(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
    .replace(/ /g, ' ');
}

/** "in 3 h 12 min", "in 40 min", "in under a minute", or "now". */
export function untilText(ms, now = Date.now()) {
  const left = ms - now;
  if (!(left > 0)) return 'now';
  if (left < 60 * 1000) return 'in under a minute';
  const m = Math.round(left / 60000);
  if (m < 60) return `in ${m} min`;
  const h = Math.floor(m / 60);
  if (h >= 48) return `in ${Math.round(h / 24)} days`;
  return `in ${h} h${m % 60 ? ` ${m % 60} min` : ''}`;
}

/** "3 h ago", "40 min ago", "just now". */
export function agoText(ms, now = Date.now()) {
  if (!Number.isFinite(ms)) return 'recently';
  const m = Math.round((now - ms) / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h} h ago`;
  return `${Math.round(h / 24)} days ago`;
}

/** "9 AM to 6 PM" from AUTO.hours. */
export function hoursText([from, to] = AUTO.hours) {
  const h = (n) => `${n % 12 || 12} ${n < 12 ? 'AM' : 'PM'}`;
  return `${h(from)} to ${h(to)}`;
}
