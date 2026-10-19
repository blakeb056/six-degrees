// "Lift limits for this session" (Blake, 2026-10-05: "Just a simple default
// limit for the day and a button to lift restrictions for this session").
//
// Held in this server's memory and nowhere else: never a file, never a
// setting, so quitting Sixgree (or anything that restarts the server) puts the
// limits back. On globalThis, like the scan state, however the bundler splits
// the routes that read it.
//
// While lifted, profile views a day and the cooldown after LinkedIn pushed back
// are off, and the scan windows go to their ceilings (lib/scan-windows.js: 60
// search pages a window, two windows a day, 6 hours apart), which nothing passes
// (Blake, 2026-10-17). What stays on whatever this says: the windows, the
// scanner's pace between page actions and searches, the minute between
// profile views, stopping when LinkedIn shows a sign-in, a security check or a
// restriction, Auto's own caps on connection requests, and one scan at a time. lib/linkedin-limits.js
// sessionLift reads this with the one rule that needs a file: LinkedIn pushing
// back after the lift puts the limits back.
//
// No Node imports, so the page can share the words.

const KEY = Symbol.for('six-degrees.limits-lift');
const box = () => (globalThis[KEY] ??= { at: null, ended: null });

/** What lifting does, in the words the page shows beside the button. */
export const LIFT_LINE = 'Until you quit Sixgree, profile views a day and the cooldown are off, and the scan windows go '
  + 'to their most: 60 search pages a window, two windows a day, 6 hours apart, which nothing passes. Scans still keep '
  + 'their human pace and stop if LinkedIn asks you to check in.';

/**
 * What Dev mode does, in the words the page shows beside it (lib/linkedin-limits.js
 * devMode: a saved switch in Scanner settings, not this session's lift). The numbers
 * are lib/scan-windows.js WINDOW_DEFAULTS, written out so the page reads the same
 * words (tests/scan-windows.test.mjs checks they match).
 */
export const DEV_LINE = 'Dev mode is on: the scan windows at their most (60 search pages a window, two windows a day, '
  + '6 hours apart), no limit on profile views a day, no cooldown, no caps on Auto’s requests and no hours for Auto '
  + 'scan, until you turn it off. The speed you pick still sets every wait, and LinkedIn pushing back turns it off.';

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
