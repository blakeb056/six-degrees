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
import OrbitGraph from './OrbitGraph';
import ChainView from './ChainView';
import BridgeRing from './BridgeRing';
import GridView from './GridView';
import ListView from './ListView';
import RingsView from './RingsView';

/**
 * `modes` — which top-level mode the view belongs in ('network', 'degrees').
 * `allDegree2` — give it every 2nd-degree row rather than the mode-filtered
 *   set. Only Orbit wants this: it draws each bridge's circle in both modes and
 *   narrows to the bridges on screen itself. Declared here rather than hidden
 *   in a branch, because an exception you cannot see is one you break later.
 */
export const VIEWS = {
  galaxy:   { component: ForceGraph, modes: ['network'],            label: 'Galaxy',        icon: '🌌', desc: 'Force-directed layout' },
  orbit:    { component: OrbitGraph, modes: ['network'],            label: 'Orbit',         icon: '🪐', desc: 'Tier orbits + circle dots', allDegree2: true },
  chain:    { component: ChainView,  modes: ['degrees'],            label: 'Bridge Chains', icon: '🔗', desc: 'Degree paths' },
  revolver: { component: BridgeRing, modes: ['degrees'],            label: 'Revolver',      icon: '🎯', desc: 'Rotary dial · spin to switch' },
  rings:    { component: RingsView,  modes: ['network', 'degrees'], label: 'Pyramid',       icon: '🔺', desc: 'Tier hierarchy' },
  list:     { component: ListView,   modes: ['network', 'degrees'], label: 'List',          icon: '☰', desc: 'Ranked power list' },
  grid:     { component: GridView,   modes: ['network', 'degrees'], label: 'Grid',          icon: '▦', desc: 'Cards' },
};

/** The order they appear in the menu. */
const ORDER = ['galaxy', 'orbit', 'chain', 'revolver', 'rings', 'list'];

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
