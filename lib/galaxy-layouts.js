// The Galaxy's saved layouts (Physics → Save layout): your own named slider
// settings. Kept with the network's settings (lib/settings.js), so they travel
// with a backup, an export and a restore; the browser keeps a copy to read
// before the page has asked the server (lib/galaxy-lab.js). No imports: the
// server checks a saved list with the same rules the browser keeps it by.

/** The slider settings a saved layout keeps (not whether the lab is on, nor the names switch). */
export const LAYOUT_KEYS = ['gravity', 'rings', 'push', 'pull', 'distance', 'orbit', 'dotSize', 'lines', 'sizeBy', 'names', 'branch', 'colourBy', 'speed', 'loop', 'tierLines'];

/** More than anyone names by hand, and a bound on what a stray request can store. */
export const MAX_LAYOUTS = 50;

const fine = (v) => (typeof v === 'boolean')
  || (typeof v === 'number' && Number.isFinite(v) && Math.abs(v) <= 1000)
  || (typeof v === 'string' && /^[a-z]{1,20}$/i.test(v));

/**
 * A saved list made safe: each layout a name (1 to 40 characters) and only the
 * slider settings a layout keeps, each a plain number, word or switch. A name
 * saved twice keeps its last settings, where the first one stood.
 */
export function cleanLayouts(raw) {
  if (!Array.isArray(raw)) return [];
  const byName = new Map();
  for (const item of raw) {
    const name = typeof item?.name === 'string' ? item.name.trim().slice(0, 40) : '';
    if (!name || !item.settings || typeof item.settings !== 'object' || Array.isArray(item.settings)) continue;
    const settings = {};
    for (const k of LAYOUT_KEYS) if (Object.hasOwn(item.settings, k) && fine(item.settings[k])) settings[k] = item.settings[k];
    byName.set(name, { name, settings });
  }
  return [...byName.values()].slice(0, MAX_LAYOUTS);
}

/** In lib/settings.js: null until a list is saved on this network, so a browser's own list is saved once. */
export const GALAXY_LAYOUTS_SETTING = {
  default: null,
  parse(value) {
    if (value === null) return null;
    if (!Array.isArray(value)) throw new Error('Saved layouts must be a list.');
    return cleanLayouts(value);
  },
};
