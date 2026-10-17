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
//
// Tiers off (Blake, 2026-10-12: "the user can click above where it says tiers,
// it can be toggled off or on and turns off all the tiering and leaves the user
// to pick which degree they want or not like usual"): { tiersOff: true, flat:
// [degrees] } on the same grid. Every tier is in, at the degrees in `flat`; the
// tier rows' own picks wait underneath, untouched, for when tiers come back on.

export const TIERS = ['S', 'A', 'B', 'C', 'D'];
export const GRID_DEGREES = [1, 2, 3, 4, 5, 6];

const tierOf = (tier) => (TIERS.includes(tier) ? tier : 'D');   // no tier: with D, as the views draw it

export const makeGrid = (degrees = GRID_DEGREES, { tiersOff = false } = {}) => ({
  hidden: [],
  degrees: Object.fromEntries(TIERS.map((t) => [t, degrees.slice()])),
  ...(tiersOff ? { tiersOff: true, flat: degrees.slice() } : {}),
});

/** The same picks, so a view needn't redraw for a grid that only looks new. */
export const sameGrid = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/** Network Circle starts with your own connections; you pick the rest. */
export const NETWORK_GRID = Object.freeze(makeGrid([1]));
/** Degrees starts with everything it has. */
export const DEGREES_GRID = Object.freeze(makeGrid());
/** Map starts with everyone it can draw, at the three degrees it has. */
export const MAP_GRID = Object.freeze(makeGrid([1, 2, 3]));

/** Is someone of this tier, at this degree, on screen? */
export function shows(grid, tier, degree) {
  if (grid.tiersOff) return grid.flat.includes(degree);
  const t = tierOf(tier);
  return !grid.hidden.includes(t) && grid.degrees[t].includes(degree);
}

const countAt = (counts, tier, degree) => counts?.[tier]?.[degree] || 0;

/** How many people one tier is showing. */
export function showingIn(grid, counts, tier) {
  if (grid.tiersOff) return grid.flat.reduce((n, d) => n + countAt(counts, tier, d), 0);
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
    ...grid,
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
    ...grid,
    hidden: grid.hidden.filter((t) => t !== tier),
    degrees: own.length ? grid.degrees : { ...grid.degrees, [tier]: others.length ? others : [1] },
  };
}

/**
 * A whole degree: off if every tier with people there is showing it, otherwise
 * on for all of them. With tiers off, simply that degree, off or on.
 */
export function toggleDegree(grid, degree, counts) {
  if (grid.tiersOff) {
    if (counts && !TIERS.some((t) => countAt(counts, t, degree) > 0)) return grid;
    const flat = grid.flat.includes(degree) ? grid.flat.filter((d) => d !== degree) : [...grid.flat, degree].sort((a, b) => a - b);
    return keep(grid, { ...grid, flat }, counts);
  }
  const tiers = TIERS.filter((t) => !grid.hidden.includes(t) && (!counts || countAt(counts, t, degree) > 0));
  if (!tiers.length) return grid;
  const allOn = tiers.every((t) => grid.degrees[t].includes(degree));
  const degrees = { ...grid.degrees };
  for (const t of tiers) {
    degrees[t] = allOn ? degrees[t].filter((d) => d !== degree) : [...new Set([...degrees[t], degree])].sort((a, b) => a - b);
  }
  return keep(grid, { ...grid, degrees }, counts);
}

/**
 * The Tiers switch. Off: every tier in, at every degree a tier on screen was
 * showing, so nobody who was there goes. On again: the tier rows exactly as
 * they were before.
 */
export function toggleTiers(grid) {
  if (grid.tiersOff) {
    const { tiersOff: _off, flat: _flat, ...tiered } = grid;
    return tiered;
  }
  const flat = [...new Set(TIERS.flatMap((t) => (grid.hidden.includes(t) ? [] : grid.degrees[t])))].sort((a, b) => a - b);
  return { ...grid, tiersOff: true, flat: flat.length ? flat : [1] };
}

/** Is anyone at this degree on screen, at any tier? (The degree legend under the map.) */
export function showsDegree(grid, degree) {
  if (grid.tiersOff) return grid.flat.includes(degree);
  return TIERS.some((t) => !grid.hidden.includes(t) && grid.degrees[t].includes(degree));
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

/**
 * Is this degree lit, as the numbers over the grid and the chips under the map
 * show it? The same rule toggleDegree uses, so a tap on a lit one hides it: with
 * tiers off, it's in `flat`; with them on, every tier on screen with people
 * there shows it. The chips under the map once lit a degree when any tier
 * showed it, while a tap turned it on for every tier: a lit 2nd with one tier
 * off at the 2nd put more people on the map instead of taking them off (Blake,
 * 2026-10-15: "the tier and degree filter doesn't respond").
 */
export function degreeOn(grid, degree, counts) {
  if (grid.tiersOff) return grid.flat.includes(degree);
  const tiers = TIERS.filter((t) => !grid.hidden.includes(t) && (!counts || countAt(counts, t, degree) > 0));
  return tiers.length > 0 && tiers.every((t) => grid.degrees[t].includes(degree));
}

/** How many people are at a degree, every tier together. */
const atDegree = (counts, degree) => TIERS.reduce((n, t) => n + countAt(counts, t, degree), 0);
const DEGREE_WORDS = ['', '1st', '2nd', '3rd', '4th', '5th', '6th'];

/**
 * The chips under Network Circle's map: one control for tiers and degrees
 * (Blake, 2026-10-15: "use the wifi fan for both tiers and also degrees instead
 * of it being one way"). With tiers on, a chip for each tier, S to D, showing
 * how many of them are on screen of how many the picked degrees hold; with
 * tiers off, a chip for each degree that has anyone (and always the 1st to the
 * 3rd), each with how many are at it. `on` is lit, `count` the people behind
 * it, and a chip with nobody behind it can't be tapped.
 * Returns { by: 'tier' | 'degree', chips: [{ kind, key, label, count, on }] }.
 */
export function bandChips(grid, counts = {}) {
  if (grid.tiersOff) {
    const chips = GRID_DEGREES.filter((d) => d <= 3 || atDegree(counts, d) > 0)
      .map((d) => {
        const count = atDegree(counts, d);
        return { kind: 'degree', key: d, label: DEGREE_WORDS[d], count, on: count > 0 && degreeOn(grid, d, counts) };
      });
    return { by: 'degree', chips };
  }
  const chips = TIERS.map((t) => {
    const count = grid.degrees[t].reduce((n, d) => n + countAt(counts, t, d), 0);
    return { kind: 'tier', key: t, label: t, count, on: !grid.hidden.includes(t) && count > 0 };
  });
  return { by: 'tier', chips };
}

/** A chip under the map tapped: its tier or its degree, off or on, as the grid's own buttons do. */
export function toggleBand(grid, chip, counts) {
  return chip.kind === 'tier' ? toggleTier(grid, chip.key, counts) : toggleDegree(grid, chip.key, counts);
}

/** Everyone the counts hold, at every tier and degree: the "of" in "N of M showing". */
export const everyone = (counts = {}) => TIERS.reduce((n, t) => n + GRID_DEGREES.reduce((m, d) => m + countAt(counts, t, d), 0), 0);

/**
 * Filters → Reset filters: every tier back on, at the degrees the tab starts
 * with (`base`: Network Circle's NETWORK_GRID, every degree in Degrees and the
 * fan, DEGREES_GRID, MAP_GRID), and the Tiers switch left where it is. One
 * model either way (Blake, 2026-10-15): with Tiers on the tiers pick, with
 * them off the degrees do, so off it is reset to the degrees `base` shows.
 */
export function resetGrid(grid, base) {
  const degrees = Object.fromEntries(TIERS.map((t) => [t, (base.degrees?.[t] || [1]).slice()]));
  if (!grid?.tiersOff) return { hidden: [], degrees };
  const flat = base.tiersOff && base.flat?.length
    ? base.flat.slice()
    : [...new Set(TIERS.flatMap((t) => degrees[t]))].sort((a, b) => a - b);
  return { hidden: [], degrees, tiersOff: true, flat: flat.length ? flat : [1] };
}

/**
 * The grid a tab opens with, where Reset filters goes: Network Circle opens on
 * your connections, or on every degree in Degrees and the fan (`everyDegree`,
 * app/page.js pickGalaxyLayout); Degrees and Separation on everything; Map on
 * the 1st to the 3rd.
 */
export function startGrid(tab, { everyDegree = false } = {}) {
  if (tab === 'network') return everyDegree ? makeGrid(GRID_DEGREES) : NETWORK_GRID;
  if (tab === 'map') return MAP_GRID;
  return DEGREES_GRID;
}

/** Is there nothing to reset? */
export const atReset = (grid, base) => sameGrid(grid, resetGrid(grid, base));
