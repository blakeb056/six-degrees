// A cluster as the map draws one: a hub with a ring of dots round it, the
// first at twelve o'clock and the rest clockwise, in the look's gold, purple
// and blue (the S, A and B tiers). Two things draw it, and they draw it the
// same way from here: Check for new's ↻ (app/components/ClusterSpinner.js) and
// the round buttons at the map's edges (app/components/EdgeToggle.js). The
// keyframes that build it, csBuild and csLoop, are in app/globals.css.
//
// No imports, so the page and tests share it.

/** How many dots a cluster has. */
export const CLUSTER_N = 10;

/** The tiers the dots take their colours from, in turn. */
export const CLUSTER_TIERS = ['S', 'A', 'B'];

// Written into SVG attributes the server renders, so rounded where they are
// made (TRAPS §10: the browser rounds a long float differently).
const round = (v) => Math.round(v * 1000) / 1000;

/**
 * The ring: `n` dots on a circle of radius `r` round (cx, cy), clockwise from
 * twelve o'clock. Each is { i, x, y, tier }.
 */
export function clusterDots(cx, cy, r, n = CLUSTER_N) {
  return Array.from({ length: n }, (_, i) => {
    const a = -Math.PI / 2 + (i * 2 * Math.PI) / n;
    return { i, x: round(cx + r * Math.cos(a)), y: round(cy + r * Math.sin(a)), tier: CLUSTER_TIERS[i % CLUSTER_TIERS.length] };
  });
}

/**
 * Where each dot goes when a panel opens from an edge button: onto the line of
 * the panel's edge (x = cx), alternately up and down, further each pair. Given
 * as the move from the dot's own place, { dx, dy }.
 */
export function streamOffsets(dots, cx, cy, { first = 40, step = 26 } = {}) {
  return dots.map(({ i, x, y }) => {
    const pair = Math.floor(i / 2);
    const ty = cy + (i % 2 === 0 ? -1 : 1) * (first + pair * step);
    return { dx: round(cx - x), dy: round(ty - y) };
  });
}
