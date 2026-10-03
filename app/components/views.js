// The view registry.
//
// Adding a visual used to mean three edits in three files that had to agree:
// a branch in page.js's switch, an entry in FilterPanel's menu, and a bespoke
// set of props chosen per view. Each view took a slightly different shape —
// some wanted `mode`, some `userName`, one wanted `tierColors` and a ref — so
// the wiring was the part you got wrong.
//
// Now a view is one entry here. Every view receives the SAME props object and
// destructures what it needs; React ignores the rest. Adding one means writing
// the component and adding a row.

import ForceGraph from './ForceGraph';
import ChainView from './ChainView';
import GridView from './GridView';
import ListView from './ListView';
import RingsView from './RingsView';
import SeparationView from './SeparationView';

/**
 * `modes` — which top-level tab the view belongs in ('network', 'degrees', 'separation').
 * `allDegree2` — give it every 2nd-degree row rather than the mode-filtered
 *   set. No view wants it now (Orbit did, before it became a Galaxy layout);
 *   declared here rather than hidden in a branch, because an exception you
 *   cannot see is one you break later.
 */
export const VIEWS = {
  galaxy:   { component: ForceGraph, modes: ['network'],            label: 'Galaxy',        icon: '🌌', desc: 'Force-directed layout' },
  // Orbit is a layout of the Galaxy now, in its Physics (Blake, 2026-10-03: "add that
  // as a visual option instead so the person can interact with it"): lib/galaxy-lab.js ORBIT.
  // Separation is a tab of its own (Blake, 2026-10-03), not a view inside Degrees.
  separation: { component: SeparationView, modes: ['separation'], label: 'Separation',    icon: '🏆', desc: 'Every 2nd degree, ranked · every way in' },
  chain:    { component: ChainView,  modes: ['degrees'],            label: 'Bridge Chains', icon: '🔗', desc: 'Your bridges, and the chains that lead on from them' },
  // Pyramid and List left Network Circle (Blake, 2026-10-02: "the list and pyramid gone"): the
  // Galaxy and its physics are what that tab is for. They stay in Degrees.
  rings:    { component: RingsView,  modes: ['degrees'],            label: 'Pyramid',       icon: '🔺', desc: 'Tier hierarchy' },
  list:     { component: ListView,   modes: ['degrees'],            label: 'List',          icon: '☰', desc: 'Ranked power list' },
  grid:     { component: GridView,   modes: ['network', 'degrees'], label: 'Grid',          icon: '▦', desc: 'Cards' },
};

/**
 * The order they appear in the menu. Bridge Chains is the first Degrees view, so
 * it is also where resolveView lands when the chosen view isn't a Degrees one
 * (Galaxy, say, carried over from Network Circle); then Separation.
 */
const ORDER = ['galaxy', 'chain', 'separation', 'rings', 'list'];

export function viewsForMode(mode) {
  return ORDER
    .filter((key) => VIEWS[key]?.modes.includes(mode))
    .map((key) => ({ key, ...VIEWS[key] }));
}

/** The view to render, falling back to the first one this mode allows. */
export function resolveView(visualMode, mode) {
  const chosen = VIEWS[visualMode];
  if (chosen && chosen.modes.includes(mode)) return { key: visualMode, ...chosen };
  const first = viewsForMode(mode)[0];
  return first ?? { key: 'list', ...VIEWS.list };
}
