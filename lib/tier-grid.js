// The Filters panel's grid: five tiers down, six degrees across, the same in
// Network Circle and in Degrees.
//
// Blake, 2026-10-02: "keeping the tiers as is but enlarging them and having 6
// dots to let the user tap on to toggle or not if they want specific degrees
// showing for whatever tier … it will be universal for both".
//
// A grid is { hidden: [tiers switched off], degrees: { S: [1, 2], … } }: a tier
// row switches on and off as it always did, and remembers which degrees it
// shows while it's off. Counts are { S: { 1: n, 2: n, … }, … }: how many people
// there are at each tier and degree, so a dot with nobody behind it can't be
// tapped, and the last people on screen can't be switched off.

export const TIERS = ['S', 'A', 'B', 'C', 'D'];
export const GRID_DEGREES = [1, 2, 3, 4, 5, 6];

const tierOf = (tier) => (TIERS.includes(tier) ? tier : 'D');   // no tier: with D, as the views draw it

export const makeGrid = (degrees = GRID_DEGREES) => ({
  hidden: [],
  degrees: Object.fromEntries(TIERS.map((t) => [t, degrees.slice()])),
});

/** Network Circle starts with your own connections; you pick the rest. */
export const NETWORK_GRID = Object.freeze(makeGrid([1]));
/** Degrees starts with everything it has. */
export const DEGREES_GRID = Object.freeze(makeGrid());

/** Is someone of this tier, at this degree, on screen? */
export function shows(grid, tier, degree) {
  const t = tierOf(tier);
  return !grid.hidden.includes(t) && grid.degrees[t].includes(degree);
}

const countAt = (counts, tier, degree) => counts?.[tier]?.[degree] || 0;

/** How many people one tier is showing. */
export function showingIn(grid, counts, tier) {
  if (grid.hidden.includes(tier)) return 0;
  return grid.degrees[tier].reduce((n, d) => n + countAt(counts, tier, d), 0);
}

/** How many people the whole grid is showing. */
export const showing = (grid, counts) => TIERS.reduce((n, t) => n + showingIn(grid, counts, t), 0);

// A change that would leave nobody on screen isn't made.
const keep = (grid, next, counts) => (counts && showing(next, counts) === 0 ? grid : next);

/** One dot: that degree, for that tier. Tapping a dot in a tier that's off switches the tier on with it. */
export function toggleCell(grid, tier, degree, counts) {
  const has = grid.degrees[tier].includes(degree);
  const off = grid.hidden.includes(tier);
  const degrees = off || !has
    ? [...new Set([...grid.degrees[tier], degree])].sort((a, b) => a - b)
    : grid.degrees[tier].filter((d) => d !== degree);
  return keep(grid, {
    hidden: off ? grid.hidden.filter((t) => t !== tier) : grid.hidden,
    degrees: { ...grid.degrees, [tier]: degrees },
  }, counts);
}

/** A whole tier, off or back on with the degrees it had. */
export function toggleTier(grid, tier, counts) {
  if (!grid.hidden.includes(tier)) return keep(grid, { ...grid, hidden: [...grid.hidden, tier] }, counts);
  // Back on with nothing to show would look broken: give it what the others show.
  const own = grid.degrees[tier];
  const others = [...new Set(TIERS.flatMap((t) => (t === tier ? [] : grid.degrees[t])))].sort((a, b) => a - b);
  return {
    hidden: grid.hidden.filter((t) => t !== tier),
    degrees: own.length ? grid.degrees : { ...grid.degrees, [tier]: others.length ? others : [1] },
  };
}

/** A whole degree: off if every tier with people there is showing it, otherwise on for all of them. */
export function toggleDegree(grid, degree, counts) {
  const tiers = TIERS.filter((t) => !grid.hidden.includes(t) && (!counts || countAt(counts, t, degree) > 0));
  if (!tiers.length) return grid;
  const allOn = tiers.every((t) => grid.degrees[t].includes(degree));
  const degrees = { ...grid.degrees };
  for (const t of tiers) {
    degrees[t] = allOn ? degrees[t].filter((d) => d !== degree) : [...new Set([...degrees[t], degree])].sort((a, b) => a - b);
  }
  return keep(grid, { ...grid, degrees }, counts);
}

/** Every tier back on, each with the degrees it had. */
export const showAllTiers = (grid) => (grid.hidden.length ? { ...grid, hidden: [] } : grid);

/** People by tier and degree, for the dots: `byDegree` is { 1: rows, 2: rows, … }. */
export function gridCounts(byDegree = {}) {
  const counts = Object.fromEntries(TIERS.map((t) => [t, {}]));
  for (const [degree, rows] of Object.entries(byDegree)) {
    for (const row of rows || []) {
      const t = tierOf(row?.tier);
      counts[t][degree] = (counts[t][degree] || 0) + 1;
    }
  }
  return counts;
}
