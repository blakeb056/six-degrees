// The Scan page's speed: Fast, Medium or Slow (Blake, 2026-09-30: "a bar that
// will adjust the scanner from slow, medium and fast… the current is
// considered fast, and then we lower to medium and slow, bogging it down,
// making it less likely to get caught, and estimated time for each").
//
// Fast is the pacing as it always was and nothing is faster; Medium and Slow
// only add waiting. Speed changes searches an hour, never searches a day: the
// daily limit is still the volume cap. scripts/scrape.py SCAN_PACES and PACING
// hold the same numbers (tests/scan-pace.test.mjs checks they agree).
//
// Gentle pacing (Blake, 2026-10-05: "polish the pacing, with extra intervals",
// "add scroll intervals as well"; Scanner settings → "Gentle pacing and
// scrolling (new)", on by default) only ever adds to those waits: a random,
// skewed extra after each (never under the floor), reading time for the people
// a page showed, a random scroll through each page, now and then a short break
// and a longer rest every LONG_REST_EVERY pages. Every number below is worked
// out from the same constants the scanner waits by, so what the page says an
// hour or a list takes stays honest. Off, it's the old fixed waits.

export const PACES = {
  fast: { label: 'Fast', pagePause: 20, chunkCooldown: 60, profileGap: 60, shortBreak: [60, 150], longRest: 180 },
  medium: { label: 'Medium', pagePause: 45, chunkCooldown: 180, profileGap: 90, shortBreak: [90, 240], longRest: 300 },
  slow: { label: 'Slow', pagePause: 90, chunkCooldown: 300, profileGap: 120, shortBreak: [120, 360], longRest: 480 },
};
export const PACE_NAMES = ['slow', 'medium', 'fast'];
export const DEFAULT_PACE = 'fast';
// About how long reading one page of results takes, measured in 0.1.6 (the
// 3 s before each page is read is part of it).
export const WORK_SECONDS = 6;
const EVERY = 10;   // the longer rest comes after every 10 pages (scrape.py SAVE_EVERY_PAGES)
/** People on a page of results, for reading time. */
const PER_PAGE = 10;

// scrape.py PACING, the same numbers (tests/scan-pace.test.mjs).
export const PACING = {
  spread: 0.125,
  cap: 3,
  settle: 3,
  readPerResult: 0.4,
  profileRead: 8,
  breakChance: 0.01,
  longRestEvery: 60,
  scroll: {
    steps: [3, 8],
    delta: [180, 720],
    pause: [0.15, 0.6],
    backChance: 0.25,
    twoBackChance: 0.2,
    backDelta: [60, 260],
    idleChance: 0.12,
    idlePause: [0.8, 2.0],
    waitScrollChance: 0.35,
    waitDelta: [40, 220],
  },
  settleList: { rounds: 6, budget: 8, poll: [0.4, 0.7] },
};

export const paceOf = (name) => PACES[name] || PACES[DEFAULT_PACE];
const mid = ([a, b]) => (a + b) / 2;

/** A paced wait's mean: the floor plus a half-normal extra (scrape.py paced_interval). */
export function expectedInterval(floor, gentle = true) {
  return gentle ? floor * (1 + PACING.spread * Math.sqrt(2 / Math.PI)) : floor;
}

/** A page's scroll on average (scrape.py scroll_plan, and the first settle poll). */
export function scrollSeconds() {
  const s = PACING.scroll;
  const steps = mid(s.steps) + s.backChance * (1 + s.twoBackChance) + 1;   // + the foot
  return steps * mid(s.pause) + s.idleChance * mid(s.idlePause) + mid(PACING.settleList.poll);
}

/** One page on average, before the rests every 10 and every LONG_REST_EVERY. */
export function pageSeconds(name, gentle = true) {
  const p = paceOf(name);
  if (!gentle) return WORK_SECONDS + p.pagePause;
  return WORK_SECONDS
    + (expectedInterval(PACING.settle) - PACING.settle)
    + expectedInterval(p.pagePause)
    + expectedInterval(PACING.readPerResult * PER_PAGE)
    + scrollSeconds()
    + PACING.breakChance * mid(p.shortBreak);
}

/** Seconds to run `searches` searches at a speed: each page, the longer rest every 10, and gentle's every LONG_REST_EVERY. */
export function paceSeconds(name, searches, gentle = true) {
  const p = paceOf(name);
  const n = Math.max(0, Math.floor(Number(searches) || 0));
  const total = n * pageSeconds(name, gentle)
    + Math.floor(n / EVERY) * expectedInterval(p.chunkCooldown, gentle)
    + (gentle ? Math.floor(n / PACING.longRestEvery) * expectedInterval(p.longRest) : 0);
  return Math.round(total);
}

/**
 * About how long a circle scan takes to show its first people on the map. The
 * scanner saves after its first ten pages (scrape.py SAVE_EVERY_PAGES), so it's
 * those ten at this speed; the longer rest counted after them stands in for
 * opening Chrome and the person's profile first.
 */
export function firstCircleSeconds(name, gentle = true) {
  return paceSeconds(name, EVERY, gentle);
}

/** About how many searches an hour a speed makes. */
export function searchesPerHour(name, gentle = true) {
  const p = paceOf(name);
  const each = pageSeconds(name, gentle) + expectedInterval(p.chunkCooldown, gentle) / EVERY
    + (gentle ? expectedInterval(p.longRest) / PACING.longRestEvery : 0);
  return Math.round(3600 / each);
}

/** About how many profiles an hour Read profiles opens: the gap between views, paced, and the read itself. */
export function profilesPerHour(name, gentle = true) {
  const p = paceOf(name);
  const each = Math.max(expectedInterval(p.profileGap, gentle), WORK_SECONDS + 10 + expectedInterval(PACING.profileRead, gentle));
  return Math.max(1, Math.floor(3600 / each));
}

/** The one line the Scan page and LinkedIn usage say about a speed's waits. */
export function paceLine(name, gentle = true) {
  const p = paceOf(name);
  const chunk = p.chunkCooldown / 60 === 1 ? 'a minute' : `${p.chunkCooldown / 60} minutes`;
  const base = `At ${p.label} it rests at least ${p.pagePause} seconds before each page and ${chunk} more after every 10`;
  if (!gentle) return `${base}.`;
  return `${base}, a little longer at random, with reading time and a scroll through each page, now and then a short break, and a ${Math.round(p.longRest / 60)}-minute rest every ${PACING.longRestEvery} pages.`;
}

/** "about 1 h 7 min", "about 27 min", "under a minute" */
export function durationText(seconds) {
  if (!(seconds >= 60)) return 'under a minute';
  const m = Math.round(seconds / 60);
  if (m < 60) return `about ${m} min`;
  const h = Math.floor(m / 60);
  const rest = m % 60;
  return `about ${h} h${rest ? ` ${rest} min` : ''}`;
}
