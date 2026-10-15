// The map page's own tabs, the first ones in the app's tab row
// (app/components/AppTabs.js): views of one page that switch in place there,
// and links back to it (/?mode=…) from every other page. Plain data, so
// tests/places.test.mjs reads it as it is.
//
// Map is its own tab (Blake, 2026-10-14): your network on a world map, by
// location (app/components/WorldMap.js). Like the other three it shows for
// every network, your own, a CSV and the sample.

export const MODES = Object.freeze([
  { key: 'network', label: 'Network Circle', short: 'Circle' },
  { key: 'degrees', label: 'Degrees' },
  { key: 'separation', label: 'Separation' },
  { key: 'map', label: 'Map' },
]);

export const MODE_KEYS = Object.freeze(MODES.map((m) => m.key));

/** The view each tab opens on (app/components/views.js). */
export const FIRST_VIEW = Object.freeze({ network: 'galaxy', degrees: 'chain', separation: 'separation', map: 'worldmap' });
