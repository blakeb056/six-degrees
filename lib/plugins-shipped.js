// The official plugin list as this version of Sixgree was shipped with it:
// what each plugin is, said without going online (Blake, 2026-10-14: "i dont
// want to make it that hard to see the plugins"). The guided setup's "Other
// ways to bring in your network" and Settings → Plugins → Browse draw their
// cards from it at once, plugins on or off, and nothing asks the internet
// for them.
//
// Pressing a card's Install is the click that goes online: it fetches the
// real list (POST /api/plugins/catalog), checks this entry in it, then
// downloads and checks the package (settings/PluginBrowse.js). So does
// Settings → Plugins with plugins on, when Browse comes into view and on Check
// for plugin updates, so a newer version shows as Update. When the two
// disagree, the newer version of each wins and neither list drops a plugin
// (cardsFrom): a stale copy of the live list (a CDN cache, minutes after a
// release) never takes a card back to an older version.
//
// It is also what scripts/build-plugin.mjs builds the packages and the list
// from, so the list a build writes (dist/plugins/catalog.json) says exactly
// this; tests/plugins-shipped.test.mjs checks the two agree. No Node imports:
// the pages read it.

import { compareVersions } from './release.js';

// The honest risk each one carries, shown before it installs: the Scan page's
// own points (lib/scan-risk.js RISK_POINTS), said for what each plugin does.
const RISK_TERMS = 'LinkedIn’s User Agreement doesn’t allow automated tools, and LinkedIn may restrict accounts that use them.';

/** The version the official packages are built at (scripts/build-plugin.mjs --version). */
export const SHIPPED_PLUGIN_VERSION = '1.0.10';

/** The LinkedIn browser plugin's version: its own, apart from the scanners'. */
export const LINKEDIN_BROWSER_VERSION = '1.0.1';

/** { id, name, version, about, risk, kind, unlocks }, as the plugin list has each one. */
export const SHIPPED_PLUGINS = Object.freeze([
  {
    id: 'auto-scan',
    name: 'Auto scan',
    version: SHIPPED_PLUGIN_VERSION,
    kind: 'scanner',
    unlocks: ['auto'],
    about: 'The scanner, reading by itself: circle scans that turn the pages on their own, Auto scan, Auto connect and Dev mode.',
    risk: `It runs your own LinkedIn account automatically, in Chrome on this computer. ${RISK_TERMS}`,
  },
  {
    id: 'manual-scan',
    name: 'Manual scan',
    version: SHIPPED_PLUGIN_VERSION,
    kind: 'scanner',
    unlocks: ['manual'],
    about: 'The scanner, by hand: you scroll and click Next in its Chrome window, and it reads each page as you go, with chimes.',
    risk: `It reads LinkedIn pages with your own account, in Chrome on this computer, as you page through them. ${RISK_TERMS}`,
  },
  // A feature plugin (lib/plugins.js): no code of its own, its own version.
  // Blake, 2026-10-15: "an option to open LinkedIn within the actual
  // application … would be a plugin". 1.0.1: the tab only, the header button
  // and people list taken out ("I want to remove the LinkedIn button at the
  // top right and don't like the side panel idea").
  {
    id: 'linkedin-browser',
    name: 'LinkedIn browser',
    version: LINKEDIN_BROWSER_VERSION,
    kind: 'feature',
    unlocks: ['linkedin-browser'],
    about: 'A LinkedIn tab inside Sixgree’s window: its Feed, Messaging, Notifications and Jobs buttons open that part of LinkedIn, live, for your own browsing, with Back and Forward. In the desktop app.',
    risk: 'It is your own LinkedIn account, browsed by you as you would anywhere: Sixgree reads nothing on its own and clicks nothing, and browsing the tab is not counted. A profile you open from Sixgree counts as one of the day’s profile views, as it does without this plugin.',
  },
].map((p) => Object.freeze({ ...p, unlocks: Object.freeze([...p.unlocks]), shipped: true })));

/**
 * The cards to draw: the shipped copy until the live list has been fetched,
 * then both merged, entry by entry, never showing an older version than
 * either has. Per plugin id, the newer version wins: the live one at the same
 * version or newer (its words and risk, and whether it's for this Sixgree,
 * with what it leaves out from the shipped copy), the shipped one when the
 * live list is older. A plugin either list has is a card: one gone from a
 * stale live list stays as shipped. The shipped order first, then the live
 * list's own additions, so nothing jumps about when the live list comes in.
 * (Settings → Plugins → Browse showed the shipped list, then swapped it for a
 * CDN's stale copy of the live one, older versions and all.)
 * `catalog` is usePluginInstall's ({ status, plugins }); a check that is
 * running again, or failed after one that worked, keeps the last list it had.
 */
export function cardsFrom(catalog) {
  if (!Array.isArray(catalog?.plugins)) return SHIPPED_PLUGINS;
  const live = new Map(catalog.plugins.filter((p) => p && p.id).map((p) => [p.id, p]));
  const pick = (shipped) => {
    const l = live.get(shipped.id);
    if (!l) return shipped;
    return compareVersions(l.version, shipped.version) >= 0 ? { ...shipped, ...l, shipped: false } : shipped;
  };
  const known = new Set(SHIPPED_PLUGINS.map((p) => p.id));
  return [...SHIPPED_PLUGINS.map(pick), ...[...live.values()].filter((l) => !known.has(l.id))];
}

/** What the feature plugins unlock: the app's features that show only with one (lib/plugins-view.js appFeatures). */
export const FEATURE_UNLOCKS = Object.freeze(SHIPPED_PLUGINS.filter((p) => p.kind === 'feature').flatMap((p) => [...p.unlocks]));
