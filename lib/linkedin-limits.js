// What the Scan page shows about LinkedIn: how much has been searched, the
// daily limit, and whether a cooldown is on. The scanner writes these files
// (scripts/scrape.py, "How much this machine has asked of LinkedIn"); this
// reads them with the same rules, and writes only the one thing a person
// changes here: searches a day (and the speed, which is pacing, not a limit).
//
// Scan → LinkedIn usage reads the same record more closely (linkedinUsage):
// the last hour, when the next search frees up, and the last time LinkedIn
// pushed back. lib/usage.js says what the numbers mean.
//
// ONE limit (Blake, 2026-10-05: "we need to simplify this and allow more usage
// as it's constrained too much. Just a simple default limit for the day and a
// button to lift restrictions for this session"): searches a day, over a
// rolling 24 hours. Profile views count against the same number, on their own
// count, and any two stay a minute apart however it's set (that's pacing). The
// monthly budget, the separate profile-view choice and Auto scan's own day and
// week caps are gone; a saved file keeps its daily number and the rest is
// ignored. "Lift limits for this session" (lib/limits-lift.js) turns the daily
// limit and the cooldown off until the app restarts.
//
// Auto's connection requests (lib/auto-connect.js) are a third list in the same
// record, "invites", with caps of their own: 15 in any 24 hours, 80 in any 7
// days. Lifting doesn't touch them.
//
// They belong to the LinkedIn account, not to a profile in the app. TRAPS §35.

import {
  readFileSync, writeFileSync, renameSync, existsSync, lstatSync, readdirSync, openSync, readSync, closeSync,
} from 'node:fs';
import path from 'node:path';
import { durable } from './durable.js';
import { PACES, DEFAULT_PACE } from './scan-pace.js';
import { countAfter } from './usage.js';
import { INVITE_CAPS } from './auto-connect.js';
import { liftedAt, putLimitsBack } from './limits-lift.js';

// The default is what it has always been (50 a day); the number control takes
// any whole number in DAILY_RANGE. scripts/scrape.py DEFAULT_DAILY_SEARCHES and
// DAILY_MAX say the same (tests/linkedin-limits.test.mjs).
export const DEFAULT_LIMITS = { daily: 50, pace: DEFAULT_PACE, gentle: true, profileReads: false };
export const DAILY_RANGE = { min: 1, max: 1000 };
const DAY = 24 * 3600;
const WEEK = 7 * DAY;

/** A daily limit the app accepts: a whole number from 1 to 1000. */
export const validDaily = (n) => Number.isInteger(n) && n >= DAILY_RANGE.min && n <= DAILY_RANGE.max;

function readJson(file) {
  try { return JSON.parse(readFileSync(file, 'utf8')); } catch { return null; }
}

function writeJsonAtomic(file, data) {
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(tmp, JSON.stringify(data, null, 2));
  renameSync(tmp, file);
}

export function readLimits(dir) {
  const raw = readJson(path.join(dir, 'scan-limits.json')) || {};
  // Only the daily number and the speed are read. A file from before
  // 2026-10-05 also has "monthly" and "profiles": ignored, and dropped at the
  // next save. Its old "0, no daily limit" (and anything else out of range)
  // reads as the default, as the scanner reads it (scrape.py search_limits).
  return {
    daily: validDaily(raw.daily) ? raw.daily : DEFAULT_LIMITS.daily,
    // The Scan page's speed (lib/scan-pace.js): how fast a scan goes, never how much it may do.
    pace: PACES[raw.pace] ? raw.pace : DEFAULT_PACE,
    // Scanner settings → "Gentle pacing and scrolling (new)": on unless turned off
    // (scrape.py gentle_pacing reads the same key). It only ever adds waiting.
    gentle: raw.gentle !== false,
    // Scanner settings → "Read full profiles (experience)": off unless turned on.
    // It only offers Read profiles; nothing reads a profile by itself.
    profileReads: raw.profileReads === true,
  };
}

/**
 * A daily number outside DAILY_RANGE, or a speed that isn't one, keeps what
 * is saved, like everything else that reaches the scanner, and so does a switch
 * that isn't true or false. Only these four keys are written: an old file's
 * monthly and profile-view caps go with the first save.
 */
export function writeLimits(dir, { daily, pace, gentle, profileReads } = {}) {
  const cur = readLimits(dir);
  const next = {
    daily: validDaily(daily) ? daily : cur.daily,
    pace: PACES[pace] ? pace : cur.pace,
    gentle: typeof gentle === 'boolean' ? gentle : cur.gentle,
    profileReads: typeof profileReads === 'boolean' ? profileReads : cur.profileReads,
  };
  writeJsonAtomic(path.join(dir, 'scan-limits.json'), next);
  return next;
}

/**
 * The scanner's record as three lists of times (epoch seconds): searches,
 * profile views and Auto's connection requests. null when it can't be read. No
 * record at all is nothing done yet.
 */
function readActivity(dir) {
  const file = path.join(dir, 'linkedin-activity.json');
  const data = existsSync(file) ? readJson(file) : { searches: [], profiles: [] };
  if (!data || typeof data !== 'object') return null;
  const times = (v) => (Array.isArray(v) ? v : []).map(Number);
  return { searches: times(data.searches), profiles: times(data.profiles), invites: times(data.invites) };
}

/**
 * Searches and profile views in the last 24 hours. An unreadable record reads
 * as the day used up, searches and profile views both, as the scanner treats
 * it — failing open would say nothing had been searched.
 */
export function usage(dir, now = Date.now()) {
  const rec = readActivity(dir);
  if (!rec) {
    return { searchesToday: Infinity, profilesToday: Infinity, invitesToday: Infinity, invitesWeek: Infinity, unreadable: true };
  }
  const { searches: s, profiles: p, invites: i } = rec;
  const dayAgo = now / 1000 - DAY;
  return {
    searchesToday: s.filter((t) => t > dayAgo).length,
    profilesToday: p.filter((t) => t > dayAgo).length,
    // Auto's connection requests (lib/auto-connect.js), against their own caps.
    invitesToday: i.filter((t) => t > dayAgo).length,
    invitesWeek: i.filter((t) => t > now / 1000 - WEEK).length,
  };
}

/** The cooldown on file { until (ms), reason, setAt }, or null. A pause lifted by hand before 2026-10-05 is none. */
export function readCooldown(dir, now = Date.now()) {
  const raw = readJson(path.join(dir, 'linkedin-cooldown.json'));
  const until = Number(raw?.until) * 1000;
  if (!raw || raw.lifted_at !== undefined || !Number.isFinite(until) || until <= now) return null;
  return { until, reason: String(raw.reason || 'LinkedIn pushed back'), setAt: Number(raw.set_at) * 1000 || null };
}

/**
 * The session's lift (lib/limits-lift.js) as it stands: { at } while the
 * limits are lifted, or null. LinkedIn pushing back after the lift (a pause
 * the scanner set since, TRAPS §35) puts them back: the lift was asked for
 * before that check, and carrying on after a warning is what turns it into a
 * restriction. Lifting again is one click.
 */
export function sessionLift(dir, now = Date.now()) {
  const at = liftedAt();
  if (at == null) return null;
  const raw = readJson(path.join(dir, COOLDOWN));
  if (isObject(raw) && isTime(raw.set_at) && raw.set_at * 1000 > at && Number(raw.until) * 1000 > now) {
    putLimitsBack('pushback', now);
    return null;
  }
  return { at };
}

/**
 * Everything the Scan page shows, in one object. While the limits are lifted
 * for this session, nothing is left "of" a limit (leftToday and
 * profilesLeftToday are null) and the cooldown is off: `cooldown` is null and
 * `heldCooldown` is the pause on file, which comes back with the limits.
 * `limitReached`: the daily limit holds a search back now.
 */
export function linkedinState(dir, now = Date.now()) {
  const limits = readLimits(dir);
  const use = usage(dir, now);
  const lift = sessionLift(dir, now);
  const cooldown = readCooldown(dir, now);
  const left = (limit, used) => (lift ? null : Math.max(0, limit - used));
  // When Auto may send again once a cap is reached: the request that stops
  // counting soonest frees the next (freesAt below).
  const invites = use.unreadable ? null : readActivity(dir)?.invites || [];
  const leftToday = left(limits.daily, use.searchesToday);
  return {
    ...use,
    limits,
    lifted: Boolean(lift),
    liftedAt: lift?.at ?? null,
    leftToday,
    limitReached: leftToday === 0,
    // Profile views count against the same daily number, on their own count.
    profilesLeftToday: left(limits.daily, use.profilesToday),
    inviteCaps: INVITE_CAPS,
    invitesFreeAt: invites ? freesAt(invites, now, INVITE_CAPS.day) : null,
    invitesWeekFreeAt: invites ? freesAt(invites, now, INVITE_CAPS.week, WEEK) : null,
    cooldown: lift ? null : cooldown,
    heldCooldown: lift ? cooldown : null,
  };
}

// ── Scan → LinkedIn usage ────────────────────────────────────────────────
// The same record, read more closely. Windows count a time strictly inside
// them (t > now - window), as usage() and the scanner's linkedin_usage do, so a
// search exactly 24 hours old has stopped counting.

/** How many of `times` (epoch s) fall in the last `seconds` before `now` (ms). */
export function countWithin(times, now, seconds) {
  const from = now / 1000 - seconds;
  return times.filter((t) => t > from).length;
}

/**
 * When the count in the window next drops under `cap`, in ms: the moment a
 * search (or profile view) is free again. null when one is free now, or with
 * no cap. The scanner says the same for profile views (scrape.py
 * budget_message: the one that stops counting soonest frees the next).
 */
export function freesAt(times, now, cap, seconds = DAY) {
  if (!cap) return null;
  const live = times.filter((t) => t > now / 1000 - seconds).sort((a, b) => a - b);
  if (live.length < cap) return null;
  return (live[live.length - cap] + seconds) * 1000;
}

/** When the window holds nothing at all again (the newest time turns `seconds` old), in ms; null if it's empty. */
export function clearAt(times, now, seconds = DAY) {
  const live = times.filter((t) => t > now / 1000 - seconds);
  return live.length ? (Math.max(...live) + seconds) * 1000 : null;
}

// The scanner keeps what the page showed when LinkedIn pushed back as
// pushback/<local date>_<time>.txt: "reason: …", then "url: …", then the page's
// text (scrape.py _keep_pushback_evidence). Only the name's time and the first
// line are read here: the page's address and its text are LinkedIn's page about
// this account and stay in the file.
const PUSHBACK_FILE = /^(\d{4})-(\d{2})-(\d{2})_(\d{2})(\d{2})(\d{2})\.txt$/;
const FIRST_LINE_BYTES = 256;

/** The reason on a pushback file's first line, or null. Never more of the file. */
function pushbackReason(file) {
  let fd;
  try {
    fd = openSync(file, 'r');
    const buf = Buffer.alloc(FIRST_LINE_BYTES);
    const n = readSync(fd, buf, 0, FIRST_LINE_BYTES, 0);
    const line = buf.subarray(0, n).toString('utf8').split(/\r?\n/)[0];
    const m = line.match(/^reason: (.+)$/);
    const reason = m && m[1].replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 120);
    // The scanner's reasons are its own short phrases; anything shaped like an address isn't one.
    return reason && !/:\/\/|www\.|linkedin\.com|\/in\//i.test(reason) ? reason : null;
  } catch {
    return null;
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}

/** The newest pushback file: { at (ms, from its name), reason }, or null. */
export function newestPushback(dir) {
  let names;
  try {
    // Plain files only: a link or a folder by that name is not the scanner's.
    names = readdirSync(path.join(dir, 'pushback'), { withFileTypes: true })
      .filter((e) => e.isFile() && PUSHBACK_FILE.test(e.name)).map((e) => e.name);
  } catch {
    return null;
  }
  // Newest first by name, which is by time; a name that isn't a real time is passed over.
  for (const name of names.sort().reverse()) {
    const [, y, mo, d, h, mi, s] = name.match(PUSHBACK_FILE).map(Number);
    // The scanner names it by this computer's clock (datetime.now()), as this reads it.
    const when = new Date(y, mo - 1, d, h, mi, s);
    if (when.getMonth() !== mo - 1 || when.getDate() !== d || h > 23 || mi > 59 || s > 59) continue;
    return { at: when.getTime(), reason: pushbackReason(path.join(dir, 'pushback', name)) };
  }
  return null;
}

// One pushback usually leaves both: the page kept, then the pause set, moments
// (at most the rest of that person's read) apart.
const SAME_EVENT_MS = 10 * 60 * 1000;

/**
 * The last time LinkedIn pushed back, from the cooldown file (active, ended or
 * lifted) and the newest pushback file: { at (ms or null), reason, pausedUntil,
 * liftedAt, active }, or null when there's no sign of one. Times and the
 * reason only.
 */
export function lastPushback(dir, now = Date.now()) {
  const file = newestPushback(dir);
  const raw = readJson(path.join(dir, COOLDOWN));
  const until = Number(raw?.until);
  const pause = isObject(raw) && Number.isFinite(until) ? {
    at: isTime(raw.set_at) ? raw.set_at * 1000 : null,
    reason: typeof raw.reason === 'string' && raw.reason.trim() ? raw.reason.trim().slice(0, 160) : 'LinkedIn pushed back',
    pausedUntil: (isTime(raw.was_until) ? raw.was_until : until) * 1000,
    liftedAt: isTime(raw.lifted_at) ? raw.lifted_at * 1000 : null,
  } : null;
  const fromFile = file && {
    at: file.at,
    reason: file.reason ? `LinkedIn pushed back: ${file.reason}` : 'LinkedIn pushed back',
    pausedUntil: null,
    liftedAt: null,
  };
  let last;
  if (pause && fromFile && pause.at != null && Math.abs(pause.at - fromFile.at) <= SAME_EVENT_MS) {
    last = { ...pause, at: Math.min(pause.at, fromFile.at) };
  } else if (pause && fromFile) {
    last = (pause.at ?? -Infinity) >= fromFile.at ? pause : fromFile;
  } else {
    last = pause || fromFile;
  }
  if (!last) return null;
  return { ...last, active: !last.liftedAt && last.pausedUntil != null && last.pausedUntil > now };
}

/**
 * Everything Scan → LinkedIn usage shows (GET /api/scraper?usage): the
 * Scan page's state, plus
 *   searchesLastHour                 counted like searchesToday
 *   dayFreesAt                       when the daily limit has a search free again (null: one is free now, or lifted)
 *   dayClearAt                       when the last 24 hours hold no searches at all
 *   profilesFreeAt                   when a profile view is free again (null: one is, or lifted)
 *   lastPushback                     lastPushback() above
 *   searchesSincePushback            searches made after it (lib/usage.js countAfter)
 * An unreadable record gives nulls, never zeros: it isn't "nothing searched".
 */
export function linkedinUsage(dir, now = Date.now()) {
  const state = linkedinState(dir, now);
  const rec = readActivity(dir);
  const pushback = lastPushback(dir, now);
  const known = (fn) => (rec ? fn(rec) : null);
  return {
    ...state,
    now,
    searchesToday: rec ? state.searchesToday : null,
    profilesToday: rec ? state.profilesToday : null,
    // Auto's connection requests: the last 24 hours and the last 7 days, against INVITE_CAPS.
    invitesToday: rec ? state.invitesToday : null,
    invitesWeek: rec ? state.invitesWeek : null,
    searchesLastHour: known((r) => countWithin(r.searches, now, 3600)),
    dayFreesAt: known((r) => (state.lifted ? null : freesAt(r.searches, now, state.limits.daily))),
    dayClearAt: known((r) => clearAt(r.searches, now)),
    profilesFreeAt: known((r) => (state.lifted ? null : freesAt(r.profiles, now, state.limits.daily))),
    lastPushback: pushback,
    searchesSincePushback: known((r) => countAfter(r.searches, pushback?.at)),
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
 * for the page, or null when it can. The limits follow writeLimits: a daily
 * number the app would never save is refused rather than passed on. A copy
 * from before 2026-10-05 may still carry "monthly" and "profiles": they are
 * ignored, as readLimits ignores them.
 */
export function budgetFileProblem(name, data) {
  if (!isObject(data)) return 'it is not a JSON object';
  if (name === ACTIVITY) {
    if (!isTimeList(data.searches) || !isTimeList(data.profiles) || !isTimeList(data.invites)) return 'its record of searches is not a list of times';
  } else if (name === COOLDOWN) {
    if (!isTime(data.until)) return 'its pause has no end time';
    if (data.reason !== undefined && typeof data.reason !== 'string') return 'its pause has a reason that is not text';
    if (data.set_at !== undefined && !isTime(data.set_at)) return 'its pause has a start time that is not a time';
    // A pause lifted by hand before 2026-10-05 says when, and when it would have ended.
    for (const key of ['lifted_at', 'was_until']) {
      if (data[key] !== undefined && !isTime(data[key])) return 'its lifted pause has a time that is not a time';
    }
  } else if (name === LIMITS) {
    if (data.daily !== undefined && !validDaily(data.daily)) {
      return `its daily limit (${String(data.daily).slice(0, 20)}) is not one Sixgree offers`;
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
 *   linkedin-activity.json  both computers' searches, profile views and Auto's
 *                           connection requests (mergeTimes)
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
    const invites = isObject(mine) ? readableTimes(mine.invites) : null;
    if (searches && profiles && invites) {
      // Auto's requests too, or a copy brought in would forget the ones sent here
      // (and Auto's caps would start again from nothing). Written only when
      // either side has any, so a record from before Auto keeps its old layout.
      const sent = mergeTimes(invites, activity.invites);
      durable.writeJsonDurably(here(ACTIVITY), {
        searches: mergeTimes(searches, activity.searches),
        profiles: mergeTimes(profiles, activity.profiles),
        ...(sent.length ? { invites: sent } : {}),
      });
    }
  }

  const cooldown = theirs(COOLDOWN);
  if (cooldown) {
    const mine = readJson(here(COOLDOWN));
    const mineEnds = Number.isFinite(Number(mine?.until)) ? Number(mine.until) : -Infinity;
    // A pause lifted here (by hand, before 2026-10-05) ends when it was lifted,
    // so one still on in the copy comes back.
    if (cooldown.until > mineEnds) {
      durable.writeJsonDurably(here(COOLDOWN), {
        until: cooldown.until,
        reason: cooldown.reason ?? 'LinkedIn pushed back',
        set_at: cooldown.set_at ?? null,
        // Lifted in the copy: still lifted here, and still the last pushback on record.
        ...(cooldown.lifted_at !== undefined && { lifted_at: cooldown.lifted_at, was_until: cooldown.was_until ?? cooldown.until }),
      });
    }
  }

  const limits = theirs(LIMITS);
  if (limits && !hasFile(here(LIMITS))) {
    durable.writeJsonDurably(here(LIMITS), {
      daily: limits.daily ?? DEFAULT_LIMITS.daily,
      ...(PACES[limits.pace] ? { pace: limits.pace } : {}),
    });
  }
}
