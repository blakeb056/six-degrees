// Breaks by hand (Blake, 2026-10-15: "let's make them wait every 10 pages so that's
// like 1-10 and then 20 seconds with a ticking sound"). That day he read 70 pages of
// his own connections by hand in 9.5 minutes, a median of 3.3 s between pages, and
// LinkedIn warned him about going through a lot of data; on 10/12, 305 pages a median
// of 4 s apart, and the account was restricted; on 10/3, 288 pages about 50 s apart,
// and nothing happened.
//
// So manual mode takes a break after every `breakEvery` pages read: the next page
// waits `breakSeconds`, with the window held (scripts/scrape.py _manual_break), a
// tick a second (lib/chimes.js "tick") and a countdown on the scan light
// (lib/scan-light.js). Saved in scan-limits.json beside the daily number
// (lib/linkedin-limits.js); the scanner reads the same keys with the same ranges
// (scrape.py manual_break, BREAK_EVERY, BREAK_SECONDS, BREAK_EVERY_RANGE,
// BREAK_SECONDS_RANGE: keep them in step, tests/manual-breaks.test.mjs). Auto mode
// keeps its own pace and never reads these.
//
// No Node imports: the Scan page reads it.

export const BREAK_DEFAULTS = Object.freeze({ breakEvery: 10, breakSeconds: 20 });
export const BREAK_EVERY_RANGE = Object.freeze({ min: 1, max: 25 });
export const BREAK_SECONDS_RANGE = Object.freeze({ min: 10, max: 300 });

const within = (n, { min, max }) => Number.isInteger(n) && n >= min && n <= max;

/** A number of pages between breaks the app keeps: a whole number from 1 to 25. */
export const validBreakEvery = (n) => within(n, BREAK_EVERY_RANGE);

/** A break's length the app keeps: a whole number of seconds from 10 to 300. */
export const validBreakSeconds = (n) => within(n, BREAK_SECONDS_RANGE);

/** The line under the setting: why there are breaks at all. */
export const BREAK_WHY = 'Pages read seconds apart are what LinkedIn notices.';

/** "A 20-second break after every 10 pages", as the setting says it. */
export function breakText(every = BREAK_DEFAULTS.breakEvery, seconds = BREAK_DEFAULTS.breakSeconds) {
  const s = validBreakSeconds(seconds) ? seconds : BREAK_DEFAULTS.breakSeconds;
  const e = validBreakEvery(every) ? every : BREAK_DEFAULTS.breakEvery;
  const length = s < 60 || s % 60 ? `${s}-second` : `${s / 60}-minute`;
  return `A ${length} break after every ${e === 1 ? 'page' : `${e} pages`}`;
}
