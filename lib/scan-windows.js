// Scan windows (Blake, 2026-10-17), in place of the daily search limit: at most
// 60 search pages in a window, at most two windows a day, and a new window only
// once 6 hours have passed since the last one began. That's 120 a day at most.
// Every search page counts, however it was opened: by hand, automatic, your
// connections, Breach and Read all mutuals. Profile pages don't.
//
// A window isn't saved anywhere: it's worked out from the record of search pages
// (linkedin-activity.json "searches"), the same way here and in the scanner
// (scripts/scrape.py scan_window; tests/scan-windows.test.mjs runs both on the
// same record). The first search page opens a window; every search page in the
// next 6 hours (the gap) counts in it; the first one after that opens the next
// window, if fewer than two windows began in the last 24 hours. A window that's
// used up waits out its 6 hours; a window that isn't used up still closes when
// they're over.
//
// The three numbers are settings (Scanner settings, scan-limits.json windowPages,
// windowsPerDay, windowGapHours) whose defaults are also their ceilings: a setting
// can only make them stricter. "Lift limits for this session" and Dev mode put the
// ceilings back and never pass them: 60 a window, two windows a day, 6 hours apart.

import { clockText } from './auto-scan.js';

export const WINDOW_DEFAULTS = Object.freeze({ windowPages: 60, windowsPerDay: 2, windowGapHours: 6 });
export const WINDOW_RANGES = Object.freeze({
  windowPages: Object.freeze({ min: 1, max: 60 }),
  windowsPerDay: Object.freeze({ min: 1, max: 2 }),
  // The gap is a floor: it can be longer, never shorter.
  windowGapHours: Object.freeze({ min: 6, max: 24 }),
});
const HOUR = 3600;
const DAY = 24 * HOUR;

const inRange = (n, { min, max }) => Number.isInteger(n) && n >= min && n <= max;
export const validWindowPages = (n) => inRange(n, WINDOW_RANGES.windowPages);
export const validWindowsPerDay = (n) => inRange(n, WINDOW_RANGES.windowsPerDay);
export const validWindowGapHours = (n) => inRange(n, WINDOW_RANGES.windowGapHours);

/**
 * The rules a scan keeps now: { pages, perDay, gapSeconds }. The saved settings
 * (anything out of range reads as the default), or the ceilings while the limits
 * are lifted for this session or Dev mode is on (`lifted`).
 */
export function windowRules(limits = {}, lifted = false) {
  if (lifted) {
    return { pages: WINDOW_DEFAULTS.windowPages, perDay: WINDOW_DEFAULTS.windowsPerDay, gapSeconds: WINDOW_DEFAULTS.windowGapHours * HOUR };
  }
  const pick = (key, ok) => (ok(limits?.[key]) ? limits[key] : WINDOW_DEFAULTS[key]);
  return {
    pages: pick('windowPages', validWindowPages),
    perDay: pick('windowsPerDay', validWindowsPerDay),
    gapSeconds: pick('windowGapHours', validWindowGapHours) * HOUR,
  };
}

/**
 * The windows in a record of search pages (epoch seconds), oldest first: { at, used }.
 * A window begins at a search page with no window open (none yet, or the last one
 * began `gapSeconds` or more before it) and holds every page until its gap is over.
 * Times after `nowS` (another computer's clock, imported) are left out.
 */
export function windowsIn(searches, gapSeconds, nowS = Infinity) {
  const times = (Array.isArray(searches) ? searches : []).map(Number)
    .filter((t) => Number.isFinite(t) && t <= nowS).sort((a, b) => a - b);
  const out = [];
  for (const t of times) {
    const last = out[out.length - 1];
    if (!last || t >= last.at + gapSeconds) out.push({ at: t, used: 1 });
    else last.used += 1;
  }
  return out;
}

/**
 * Where the windows stand at `now` (ms), from the record's search pages (epoch s):
 *   index        which window of the day: the open one, or the one the next page opens
 *                (the last one, when none can open now). Never more than `of`.
 *   of           windows a day
 *   used, cap    search pages in that window, and the most it takes
 *   left         search pages that may be read now (0: wait for nextOpensAt)
 *   open         a window is open now
 *   startedAt    when it began (ms), or null
 *   endsAt       when its time is over (ms), or null
 *   nextOpensAt  when the window after this one may open (ms); null when a page can
 *                open a new window now
 *   full         a window is open and has no pages left
 *   waiting      no page may be read until nextOpensAt
 *   today        windows begun in the last 24 hours
 * A run of pages that began when no window could open (a record from before the
 * windows, one brought in from another computer, or a page loaded by hand after
 * the window was used) isn't a window: it opens nothing, and the next window
 * waits until it's over as well.
 */
export function scanWindow(searches, now, rules = windowRules()) {
  const nowS = now / 1000;
  const { pages: cap, perDay, gapSeconds } = rules;
  // Which runs are windows: each began with fewer than `perDay` windows in the day before it.
  const runs = windowsIn(searches, gapSeconds, nowS);
  const starts = [];
  for (const w of runs) {
    w.window = starts.filter((at) => at > w.at - DAY).length < perDay;
    if (w.window) starts.push(w.at);
  }
  const last = runs[runs.length - 1] || null;
  const recent = starts.filter((at) => at > nowS - DAY);
  // The earliest a window may open from `from` on: while `perDay` windows began in
  // the 24 hours before it, the next waits until the oldest of them is a day old.
  const opensFrom = (from) => {
    const counted = recent.filter((at) => at > from - DAY);
    return counted.length < perDay ? from : Math.max(from, counted[counted.length - perDay] + DAY);
  };
  const ms = (s) => (s == null ? null : Math.round(s * 1000));
  const running = Boolean(last) && nowS < last.at + gapSeconds;
  if (running && last.window) {
    const left = Math.max(0, cap - last.used);
    return {
      index: Math.min(recent.length, perDay), of: perDay, used: last.used, cap, left, open: true,
      startedAt: ms(last.at), endsAt: ms(last.at + gapSeconds), nextOpensAt: ms(opensFrom(last.at + gapSeconds)),
      full: left === 0, waiting: left === 0, today: recent.length,
    };
  }
  // Nothing may open before a run that isn't a window is over.
  const at = opensFrom(running ? last.at + gapSeconds : nowS);
  if (at <= nowS) {
    return {
      index: Math.min(recent.length + 1, perDay), of: perDay, used: 0, cap, left: cap, open: false,
      startedAt: null, endsAt: null, nextOpensAt: null, full: false, waiting: false, today: recent.length,
    };
  }
  // Today's windows are used: the last one's numbers, until the next opens.
  const lastWindow = [...runs].reverse().find((w) => w.window) || null;
  return {
    index: Math.min(Math.max(recent.length, 1), perDay), of: perDay, used: lastWindow?.used ?? 0, cap, left: 0, open: false,
    startedAt: ms(lastWindow?.at ?? null), endsAt: lastWindow ? ms(lastWindow.at + gapSeconds) : null, nextOpensAt: ms(at),
    full: false, waiting: true, today: recent.length,
  };
}

/** "Window 1 of 2: 34 of 60", the words the Scan page and the scan light show. */
export function windowWords(w) {
  if (!w) return '';
  return `Window ${w.index} of ${w.of}: ${w.used} of ${w.cap}`;
}

/** When the next window opens, in words: "next window opens 15:09" (lib/auto-scan.js clockText), or "opens with the next page". */
export function nextWindowWords(w, now = Date.now()) {
  if (!w) return '';
  return w.nextOpensAt ? `next window opens ${clockText(w.nextOpensAt, now)}` : 'a window opens with the next page';
}

/** "Window 1 of 2: 34 of 60 · next window opens 15:09": both, as the Scan page and the scan light show them. */
export function windowLine(w, now = Date.now()) {
  if (!w) return '';
  return `${windowWords(w)} · ${nextWindowWords(w, now)}`;
}

/**
 * What a scan says when the window holds it back, and when the next opens:
 * "Scan window 2 of 2 is used: 60 of 60 search pages. The next window opens 18/10/2026, 09:12:00."
 * Lifting the limits doesn't pass a window, so it isn't offered here.
 */
export function windowRefusal(w) {
  if (!w) return 'The scan window is used.';
  const opens = w.nextOpensAt ? ` The next window opens ${new Date(w.nextOpensAt).toLocaleString()}.` : '';
  const said = w.open
    ? `Scan window ${w.index} of ${w.of} is used: ${w.used} of ${w.cap} search pages.`
    : `Scan window ${w.index} of ${w.of} is used: today’s ${w.of === 1 ? 'window is' : `${w.of} windows are`} done.`;
  return said + opens;
}
