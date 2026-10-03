// The Scan page's speed: Fast, Medium or Slow (Blake, 2026-09-30: "a bar that
// will adjust the scanner from slow, medium and fast… the current is
// considered fast, and then we lower to medium and slow, bogging it down,
// making it less likely to get caught, and estimated time for each").
//
// Fast is today's pacing and nothing is faster; Medium and Slow only add
// waiting. Speed changes searches an hour, never searches a day: the daily
// budget is still the volume cap. scripts/scrape.py SCAN_PACES holds the same
// numbers (tests/scan-pace.test.mjs checks they agree). Fixed waits, never
// random "human" timing: the point is fewer searches an hour, not disguise.

export const PACES = {
  fast: { label: 'Fast', pagePause: 20, chunkCooldown: 60, profileGap: 60 },
  medium: { label: 'Medium', pagePause: 45, chunkCooldown: 180, profileGap: 90 },
  slow: { label: 'Slow', pagePause: 90, chunkCooldown: 300, profileGap: 120 },
};
export const PACE_NAMES = ['slow', 'medium', 'fast'];
export const DEFAULT_PACE = 'fast';
// About how long reading one page of results takes, measured in 0.1.6.
export const WORK_SECONDS = 6;
const EVERY = 10;   // the longer rest comes after every 10 pages (scrape.py SAVE_EVERY_PAGES)

export const paceOf = (name) => PACES[name] || PACES[DEFAULT_PACE];

/** Seconds to run `searches` searches at a speed: the work, the rest before each, the longer rest every 10. */
export function paceSeconds(name, searches) {
  const p = paceOf(name);
  const n = Math.max(0, Math.floor(Number(searches) || 0));
  return n * (WORK_SECONDS + p.pagePause) + Math.floor(n / EVERY) * p.chunkCooldown;
}

/** About how many searches an hour a speed makes. */
export function searchesPerHour(name) {
  const p = paceOf(name);
  return Math.round(3600 / (WORK_SECONDS + p.pagePause + p.chunkCooldown / EVERY));
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
