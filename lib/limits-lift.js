// "Lift limits for this session" (Blake, 2026-10-05: "Just a simple default
// limit for the day and a button to lift restrictions for this session").
//
// Held in this server's memory and nowhere else: never a file, never a
// setting, so quitting Sixgree (or anything that restarts the server) puts the
// limits back. On globalThis, like the scan state, however the bundler splits
// the routes that read it.
//
// While lifted, the daily limit and the cooldown after LinkedIn pushed back are
// off, up to Dev mode's ceiling of search pages in 24 hours (2026-10-16: lifted,
// there was no ceiling at all). What stays on whatever this says: that ceiling,
// the scanner's pace between page actions and searches, the minute between
// profile views, stopping when LinkedIn shows a sign-in, a security check or a
// restriction, Auto's own caps on connection requests, and one scan at a time. lib/linkedin-limits.js
// sessionLift reads this with the one rule that needs a file: LinkedIn pushing
// back after the lift puts the limits back.
//
// No Node imports, so the page can share the words.

const KEY = Symbol.for('six-degrees.limits-lift');
const box = () => (globalThis[KEY] ??= { at: null, ended: null });

/** What lifting does, in the words the page shows beside the button. */
export const LIFT_LINE = 'Until you quit Sixgree, the daily limit and the cooldown are off, up to a ceiling of 250 search '
  + 'pages in 24 hours, as in Dev mode. Scans still keep their human pace and stop if LinkedIn asks you to check in.';

/**
 * What Dev mode does, in the words the page shows beside it (lib/linkedin-limits.js
 * devMode: a saved switch in Scanner settings, not this session's lift). The 250 is
 * lib/linkedin-limits.js DEV_CEILING, written out so the page needs no Node import
 * (tests/dev-manual-mode.test.mjs checks they match).
 */
export const DEV_LINE = 'Dev mode is on: no daily limit but a ceiling of 250 search pages in 24 hours, no cooldown, '
  + 'no caps on Auto’s requests and no hours for Auto scan, until you turn it off. '
  + 'The speed you pick still sets every wait, and LinkedIn pushing back turns it off.';

/** Lift them, from now (ms). Lifting again keeps the first time. */
export function liftLimits(now = Date.now()) {
  const b = box();
  b.at ??= now;
  b.ended = null;
  return b.at;
}

/** Put them back: by hand ('by-hand') or because LinkedIn pushed back ('pushback'). */
export function putLimitsBack(why = 'by-hand', now = Date.now()) {
  const b = box();
  if (b.at != null) b.ended = { why, at: now };
  b.at = null;
}

/** When they were lifted (ms), or null while they're on. */
export function liftedAt() {
  return box().at;
}

/** How the last lift ended ({ why, at }), or null: for the notch to say why they came back. */
export function liftEnded() {
  return box().ended;
}
