// What the Scan page shows about LinkedIn: how much has been searched, the
// budget, and whether a cooldown is on. The scanner writes these files
// (scripts/scrape.py, "How much this machine has asked of LinkedIn"); this
// reads them with the same rules, and writes only the two things a person
// changes here — the budget, and lifting a cooldown.
//
// They belong to the LinkedIn account, not to a profile in the app. TRAPS §35.

import { readFileSync, writeFileSync, renameSync, unlinkSync, existsSync, lstatSync } from 'node:fs';
import path from 'node:path';
import { durable } from './durable.js';

export const DEFAULT_LIMITS = { daily: 50, monthly: 250 };
export const DAILY_CHOICES = [25, 50, 100, 200, 500];
export const MONTHLY_CHOICES = [100, 250, 500, 1000, 0];   // 0 = no monthly cap (Premium)
const DAY = 24 * 3600;
const PACIFIC = 'America/Los_Angeles';

function readJson(file) {
  try { return JSON.parse(readFileSync(file, 'utf8')); } catch { return null; }
}

function writeJsonAtomic(file, data) {
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(tmp, JSON.stringify(data, null, 2));
  renameSync(tmp, file);
}

/** Pacific offset from UTC in hours on a given instant, e.g. -7 or -8. */
function pacificOffsetHours(ms) {
  const part = new Intl.DateTimeFormat('en-US', { timeZone: PACIFIC, timeZoneName: 'shortOffset' })
    .formatToParts(new Date(ms)).find((p) => p.type === 'timeZoneName')?.value || 'GMT-8';
  const m = part.match(/GMT([+-]\d+)(?::(\d+))?/);
  return m ? Number(m[1]) : -8;
}

/** Midnight Pacific on the 1st of the month containing `ms` (LinkedIn's reset), in ms. */
export function monthStartPacific(ms = Date.now()) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone: PACIFIC, year: 'numeric', month: 'numeric',
  }).formatToParts(new Date(ms)).map((p) => [p.type, p.value]));
  const y = Number(parts.year), mo = Number(parts.month);
  // The offset that applies AT midnight, not later that day: daylight saving
  // can end on the 1st (Nov 1, 2026), and noon's offset put midnight an hour late.
  let at = Date.UTC(y, mo - 1, 1, 8);
  for (let i = 0; i < 2; i++) at = Date.UTC(y, mo - 1, 1, -pacificOffsetHours(at));
  return at;
}

/** Midnight Pacific on the 1st of next month, in ms. */
export function nextMonthStartPacific(ms = Date.now()) {
  const start = monthStartPacific(ms);
  return monthStartPacific(start + 40 * DAY * 1000);
}

export function readLimits(dir) {
  const raw = readJson(path.join(dir, 'scan-limits.json')) || {};
  const num = (v, d) => (Number.isInteger(v) && v >= 0 ? v : d);
  return { daily: num(raw.daily, DEFAULT_LIMITS.daily), monthly: num(raw.monthly, DEFAULT_LIMITS.monthly) };
}

/** Only the offered choices are accepted, like everything else that reaches the scanner. */
export function writeLimits(dir, { daily, monthly }) {
  const cur = readLimits(dir);
  const next = {
    daily: DAILY_CHOICES.includes(daily) ? daily : cur.daily,
    monthly: MONTHLY_CHOICES.includes(monthly) ? monthly : cur.monthly,
  };
  writeJsonAtomic(path.join(dir, 'scan-limits.json'), next);
  return next;
}

/**
 * Searches in the last 24 hours and since LinkedIn's month began, and profile
 * views today. An unreadable record reads as the day used up, as the scanner
 * treats it — failing open would say nothing had been searched.
 */
export function usage(dir, now = Date.now()) {
  const file = path.join(dir, 'linkedin-activity.json');
  const data = existsSync(file) ? readJson(file) : { searches: [], profiles: [] };
  if (!data || typeof data !== 'object') return { searchesToday: Infinity, searchesMonth: 0, profilesToday: 0, unreadable: true };
  const s = (Array.isArray(data.searches) ? data.searches : []).map(Number);
  const p = (Array.isArray(data.profiles) ? data.profiles : []).map(Number);
  const dayAgo = now / 1000 - DAY;
  const month0 = monthStartPacific(now) / 1000;
  return {
    searchesToday: s.filter((t) => t > dayAgo).length,
    searchesMonth: s.filter((t) => t >= month0).length,
    profilesToday: p.filter((t) => t > dayAgo).length,
  };
}

/** The active cooldown { until (ms), reason, setAt }, or null. */
export function readCooldown(dir, now = Date.now()) {
  const raw = readJson(path.join(dir, 'linkedin-cooldown.json'));
  const until = Number(raw?.until) * 1000;
  if (!raw || !Number.isFinite(until) || until <= now) return null;
  return { until, reason: String(raw.reason || 'LinkedIn pushed back'), setAt: Number(raw.set_at) * 1000 || null };
}

/** Lift it: the person says LinkedIn works for them again. */
export function liftCooldown(dir) {
  try { unlinkSync(path.join(dir, 'linkedin-cooldown.json')); } catch { /* none to lift */ }
}

/** Everything the Scan page shows, in one object. */
export function linkedinState(dir, now = Date.now()) {
  const limits = readLimits(dir);
  const use = usage(dir, now);
  const left = (limit, used) => (limit ? Math.max(0, limit - used) : null);
  return {
    ...use,
    limits,
    leftToday: left(limits.daily, use.searchesToday),
    leftMonth: left(limits.monthly, use.searchesMonth),
    monthResets: nextMonthStartPacific(now),
    cooldown: readCooldown(dir, now),
  };
}

// ── another computer's budget (Settings → Your data → Import) ───────────────
// An import carries these three files from the other computer. They describe
// the same LinkedIn account, so they are merged with the ones here, never put
// in their place: replacing them would forget the searches made here (and lift
// a cooldown nobody chose to lift), and the account would be asked for more
// than its budget (TRAPS §35).

const ACTIVITY = 'linkedin-activity.json';
const COOLDOWN = 'linkedin-cooldown.json';
const LIMITS = 'scan-limits.json';

const isObject = (v) => Boolean(v) && typeof v === 'object' && !Array.isArray(v);
const isTimeList = (v) => v === undefined
  || (Array.isArray(v) && v.every((t) => typeof t === 'number' && Number.isFinite(t) && t >= 0));
const isTime = (v) => typeof v === 'number' && Number.isFinite(v) && v >= 0;

/**
 * Why one of these files from another computer can't be used here, in words
 * for the page, or null when it can. The limits follow writeLimits: only the
 * menu's own choices. A value the app never offers is refused rather than
 * passed to the scanner, which reads a daily limit of 0 as "no limit at all".
 */
export function budgetFileProblem(name, data) {
  if (!isObject(data)) return 'it is not a JSON object';
  if (name === ACTIVITY) {
    if (!isTimeList(data.searches) || !isTimeList(data.profiles)) return 'its record of searches is not a list of times';
  } else if (name === COOLDOWN) {
    if (!isTime(data.until)) return 'its pause has no end time';
    if (data.reason !== undefined && typeof data.reason !== 'string') return 'its pause has a reason that is not text';
    if (data.set_at !== undefined && !isTime(data.set_at)) return 'its pause has a start time that is not a time';
  } else if (name === LIMITS) {
    if (data.daily !== undefined && !DAILY_CHOICES.includes(data.daily)) {
      return `its daily limit (${String(data.daily).slice(0, 20)}) is not one Six Degrees offers`;
    }
    if (data.monthly !== undefined && !MONTHLY_CHOICES.includes(data.monthly)) {
      return `its monthly limit (${String(data.monthly).slice(0, 20)}) is not one Six Degrees offers`;
    }
  }
  return null;
}

/**
 * Both lists of times, each time kept as many times as the list that has it
 * most often. Not a plain union, and not a de-duplication: the scanner writes
 * one time n times when a single click cost n searches (charge_linkedin), and
 * those are n searches; and a history both computers already share (one was
 * imported from the other before) must still count once, not twice.
 */
export function mergeTimes(mine = [], theirs = []) {
  const counts = (list) => list.reduce((m, t) => m.set(t, (m.get(t) || 0) + 1), new Map());
  const merged = counts(mine);
  for (const [t, n] of counts(theirs)) if (n > (merged.get(t) || 0)) merged.set(t, n);
  return [...merged].sort((a, b) => a[0] - b[0]).flatMap(([t, n]) => Array(n).fill(t));
}

/** The scanner's own reading of a record: every entry a number (float() in scrape.py). */
function readableTimes(v) {
  if (v === undefined) return [];
  if (!Array.isArray(v)) return null;
  const out = v.map(Number);
  return out.every(Number.isFinite) ? out : null;
}

const hasFile = (p) => {
  try { lstatSync(p); return true; } catch { return false; }
};

/**
 * Merge the budget files in `from` (an import's, already checked with
 * budgetFileProblem) into the data folder `dir`:
 *   linkedin-activity.json  both computers' searches and profile views (mergeTimes)
 *   linkedin-cooldown.json  whichever pause ends later
 *   scan-limits.json        this computer's, if it has one; the copy's otherwise.
 *                           The limits are a choice someone made here, and an
 *                           import never quietly changes it.
 * A record here that can't be read is left as it is: the scanner reads it as
 * "today's searches are used up" (scrape.py _read_activity), which is the safe
 * way round. Running it twice gives the same files as running it once, so a
 * start that stops part-way can simply do it again.
 */
export function mergeBudgetFiles({ dir, from }) {
  const here = (name) => path.join(dir, name);
  const theirs = (name) => {
    const data = readJson(path.join(from, name));
    return isObject(data) && !budgetFileProblem(name, data) ? data : null;
  };

  const activity = theirs(ACTIVITY);
  if (activity) {
    const mine = hasFile(here(ACTIVITY)) ? readJson(here(ACTIVITY)) : {};
    const searches = isObject(mine) ? readableTimes(mine.searches) : null;
    const profiles = isObject(mine) ? readableTimes(mine.profiles) : null;
    if (searches && profiles) {
      durable.writeJsonDurably(here(ACTIVITY), {
        searches: mergeTimes(searches, activity.searches),
        profiles: mergeTimes(profiles, activity.profiles),
      });
    }
  }

  const cooldown = theirs(COOLDOWN);
  if (cooldown) {
    const mine = readJson(here(COOLDOWN));
    const mineEnds = Number.isFinite(Number(mine?.until)) ? Number(mine.until) : -Infinity;
    if (cooldown.until > mineEnds) {
      durable.writeJsonDurably(here(COOLDOWN), {
        until: cooldown.until,
        reason: cooldown.reason ?? 'LinkedIn pushed back',
        set_at: cooldown.set_at ?? null,
      });
    }
  }

  const limits = theirs(LIMITS);
  if (limits && !hasFile(here(LIMITS))) {
    durable.writeJsonDurably(here(LIMITS), {
      daily: limits.daily ?? DEFAULT_LIMITS.daily,
      monthly: limits.monthly ?? DEFAULT_LIMITS.monthly,
    });
  }
}
