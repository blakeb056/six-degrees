// Breaks by hand (Blake, 2026-10-15: "let's make them wait every 10 pages so that's
// like 1-10 and then 20 seconds with a ticking sound"). That day he read 70 pages of
// his own connections by hand in 9.5 minutes, a median of 3.3 s between pages, and
// LinkedIn warned him about going through a lot of data; on 10/12, 305 pages a median
// of 4 s apart, and the account was restricted; on 10/3, 288 pages about 50 s apart,
// and nothing happened.
//
// So manual mode takes a break after every `breakEvery` pages read: the next page
// waits, with the window held (scripts/scrape.py _manual_break), a tick a second
// (lib/chimes.js "tick") and a countdown on the scan light (lib/scan-light.js). How
// long follows the Scan page's speed ("pace", lib/scan-pace.js): 30 seconds Slow, 10
// Medium, 5 Fast, and Medium's when none is saved (BREAK_PACE_SECONDS), unless
// Scanner settings' break-length slider sets it (2026-10-16): `breakSeconds`, 5 to
// 120 seconds, over the speed's until "Use pace default" takes it away (null, and
// nothing written). Both are saved in scan-limits.json beside the daily number
// (lib/linkedin-limits.js). The scanner reads the same keys with the same ranges
// (scrape.py manual_break, BREAK_EVERY, BREAK_EVERY_RANGE, BREAK_SECONDS_RANGE,
// BREAK_PACE_SECONDS: keep them in step, tests/manual-breaks.test.mjs). Auto mode
// keeps its own pace and never reads these.
//
// No Node imports: the Scan page reads it.

// breakSeconds null: the speed's length (breakSecondsFor).
export const BREAK_DEFAULTS = Object.freeze({ breakEvery: 10, breakSeconds: null });
export const BREAK_EVERY_RANGE = Object.freeze({ min: 1, max: 25 });
export const BREAK_SECONDS_RANGE = Object.freeze({ min: 5, max: 120 });

/** A break's length at each speed, in seconds, and the speed when none is saved. */
export const BREAK_PACE_SECONDS = Object.freeze({ slow: 30, medium: 10, fast: 5 });
export const BREAK_PACE_DEFAULT = 'medium';

/** How long a break by hand is at a speed ("slow", "medium", "fast"); Medium's for anything else. */
export const paceBreakSeconds = (pace) => BREAK_PACE_SECONDS[Object.hasOwn(BREAK_PACE_SECONDS, pace) ? pace : BREAK_PACE_DEFAULT];

const within = (n, { min, max }) => Number.isInteger(n) && n >= min && n <= max;

/** A number of pages between breaks the app keeps: a whole number from 1 to 25. */
export const validBreakEvery = (n) => within(n, BREAK_EVERY_RANGE);

/** A break's length the app keeps: a whole number of seconds from 5 to 120. */
export const validBreakSeconds = (n) => within(n, BREAK_SECONDS_RANGE);

/**
 * How long a break by hand is: `override` (the slider, Scanner settings) when it's
 * a length the app keeps, else the speed's (paceBreakSeconds).
 */
export const breakSecondsFor = (pace, override = null) => (validBreakSeconds(override) ? override : paceBreakSeconds(pace));

/** The line under the setting: why there are breaks at all. */
export const BREAK_WHY = 'Pages read seconds apart are what LinkedIn notices.';

/** "A 10-second break after every 10 pages", as the setting says it. */
export function breakText(every = BREAK_DEFAULTS.breakEvery, seconds = breakSecondsFor()) {
  const s = Number.isInteger(seconds) && seconds > 0 ? seconds : breakSecondsFor();
  const e = validBreakEvery(every) ? every : BREAK_DEFAULTS.breakEvery;
  const length = s < 60 || s % 60 ? `${s}-second` : `${s / 60}-minute`;
  return `A ${length} break after every ${e === 1 ? 'page' : `${e} pages`}`;
}

/** The line about how long: it follows the speed. */
export const BREAK_PACE_TEXT = 'How long follows the scan speed: 30 seconds at Slow, 10 at Medium, 5 at Fast.';

/** The same, once the slider has set its own length. */
export const BREAK_OVERRIDE_TEXT = 'Set here, over the scan speed’s length. Use pace default to follow the speed again.';
