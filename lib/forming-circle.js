// A circle forming while it's scanned, in Degrees' Unscanned view.
//
// Blake, 2026-10-04: "when they click on the dot instead of showing a empty
// cluster make it fun by have a button in the middle of the core of the empty
// cluster and its imediatalyl aniamting ones adding into the cluster just to
// keep their attentive attentiion on. come back and fourth seeing the progress,
// it can just be time based on every dot being added."
//
// So dots join on a clock, one after another, at the scanner's own pace (about
// a page of ten every page-wait, lib/scan-pace.js). Kept honest (TRAPS §7):
//   - a clock dot is a neutral "on its way" dot, never a person, and the clock
//     never runs more than one page ahead of what the scanner has read (`found`);
//   - the people it has saved are real dots in their tier colours, and take
//     the places of the first dots; the real count always wins;
//   - when the scan ends, only the saved people stay.
// Everything here is worked out from the scan's start time, the time now and
// the scanner's counts, never from a component's memory: leave the view, the
// tab or the page and come back, and the circle is where it would have been.
//
// Plain functions, no React; tests/unscanned.test.mjs.

import { paceOf, WORK_SECONDS, DEFAULT_PACE } from './scan-pace.js';

const TAU = Math.PI * 2;
/** People on one page of someone's connections. */
export const PER_PAGE = 10;
/** LinkedIn shows 100 pages of a list at most, so a circle read is never more than this. */
export const MOST_DOTS = 100 * PER_PAGE;

/** Milliseconds between two dots at a speed: one page of ten every page-wait. */
export function dotInterval(pace = DEFAULT_PACE) {
  return ((WORK_SECONDS + paceOf(pace).pagePause) * 1000) / PER_PAGE;
}

/**
 * How many dots the forming circle shows at `now`.
 *
 *   startedAt  when the scanner began the job (ms), null before it has
 *   found      people the scanner has read so far (its "N found" lines)
 *   saved      people from their circle already saved (on the map)
 *   running    whether the scan is still going; once it isn't, only `saved` stays
 *   cap        never more clock dots than this (a whole list, 1,000)
 *
 * The clock adds one dot every dotInterval from the start, the first at once,
 * but never past one page beyond `found`: while the scanner opens their
 * profile, or rests between pages, the clock waits for it. When the scanner is
 * quicker than the clock, the count jumps to what it has read.
 *
 * @returns {{ shown: number, real: number, ghosts: number, clock: number,
 *   nextIn: number|null, interval: number }}
 *   `nextIn`: ms until the clock adds the next dot, null while it waits for the scanner.
 */
export function formingCount({ startedAt = null, now = Date.now(), pace = DEFAULT_PACE, found = 0, saved = 0, running = true, cap = MOST_DOTS } = {}) {
  const interval = dotInterval(pace);
  const real = Math.max(0, Math.floor(saved) || 0);
  const read = Math.max(0, Math.floor(found) || 0);
  // Not started yet (the scanner hasn't taken it), or over: only who is saved.
  if (!running || startedAt == null) return { shown: real, real, ghosts: 0, clock: 0, nextIn: null, interval };
  const elapsed = Math.max(0, now - startedAt);
  const clock = Math.floor(elapsed / interval) + 1;
  const limit = Math.min(read + PER_PAGE, cap);
  const shown = Math.max(real, read, Math.min(clock, limit));
  // The next dot comes when the clock reaches one more than is shown, if that
  // is still within what it may show.
  const nextIn = shown + 1 <= limit ? Math.max(0, shown * interval - elapsed) : null;
  return { shown, real, ghosts: shown - real, clock, nextIn, interval };
}

/**
 * Fixed places for a forming circle's dots round (0, 0): ring after ring from
 * `inner` outwards, `step` apart, each filled clockwise from twelve with dots
 * `spacing` apart. Place j never moves as more are added, so a dot that has
 * joined stays put while the next ones land beside it. Every other ring is
 * turned by half a step, so neighbours don't line up in spokes.
 *
 * @returns {{ x: number, y: number, angle: number, ring: number }[]}
 */
export function formingSlots(count, { inner, spacing, step = spacing, start = -Math.PI / 2 } = {}) {
  const out = [];
  const n = Math.max(0, Math.floor(count) || 0);
  for (let k = 0; out.length < n; k++) {
    const r = inner + k * step;
    const cap = Math.max(1, Math.floor((TAU * r) / spacing));
    const turn = TAU / cap;
    for (let i = 0; i < cap && out.length < n; i++) {
      const angle = start + (i + (k % 2 ? 0.5 : 0)) * turn;
      out.push({ x: r * Math.cos(angle), y: r * Math.sin(angle), angle, ring: k });
    }
  }
  return out;
}

/** How many places fit between `inner` and `outer` at a spacing (rings `spacing` apart). */
function roomFor(inner, outer, spacing) {
  let n = 0;
  for (let r = inner; r <= outer + 1e-9; r += spacing) n += Math.max(1, Math.floor((TAU * r) / spacing));
  return n;
}

// The sizes a forming circle plans for. It keeps its spacing until its count
// passes the plan, so the dots stay put and only move, all together, a few
// times in a whole read.
export const PLANS = [40, 120, 300, 1000];

/** The smallest plan that holds `count` (past the last, the next thousand). */
export function formingPlan(count) {
  const n = Math.max(0, Math.floor(count) || 0);
  return PLANS.find((p) => p >= n) ?? Math.ceil(n / 1000) * 1000;
}

/**
 * The spacing at which a plan's places fit between `inner` and `outer`: as
 * roomy as `most`, never under `least` (past that the rings carry on outwards).
 */
export function formingSpacing(plan, { inner, outer, most = 26, least = 2 } = {}) {
  if (roomFor(inner, outer, most) >= plan) return most;
  let lo = least;
  let hi = most;
  if (roomFor(inner, outer, lo) < plan) return lo;
  for (let i = 0; i < 24; i++) {
    const mid = (lo + hi) / 2;
    if (roomFor(inner, outer, mid) >= plan) lo = mid; else hi = mid;
  }
  return lo;
}
