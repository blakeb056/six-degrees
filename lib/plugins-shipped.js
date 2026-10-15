// The official plugin list as this version of Sixgree was shipped with it:
// what each plugin is, said without going online (Blake, 2026-10-14: "i dont
// want to make it that hard to see the plugins"). The guided setup's "Other
// ways to bring in your network" and Settings → Plugins → Browse draw their
// cards from it at once, plugins on or off, and nothing asks the internet
// for them.
//
// Pressing a card's Install is the click that goes online: it fetches the
// real list (POST /api/plugins/catalog), checks this entry in it, then
// downloads and checks the package (settings/PluginBrowse.js). When the two
// disagree (a newer version, other words, an entry gone), the live list wins.
//
// It is also what scripts/build-plugin.mjs builds the packages and the list
// from, so the list a build writes (dist/plugins/catalog.json) says exactly
// this; tests/plugins-shipped.test.mjs checks the two agree. No Node imports:
// the pages read it.

// The honest risk each one carries, shown before it installs: the Scan page's
// own points (lib/scan-risk.js RISK_POINTS), said for what each plugin does.
const RISK_TERMS = 'LinkedIn’s User Agreement doesn’t allow automated tools, and LinkedIn may restrict accounts that use them.';

/** The version the official packages are built at (scripts/build-plugin.mjs --version). */
export const SHIPPED_PLUGIN_VERSION = '1.0.2';

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
].map((p) => Object.freeze({ ...p, unlocks: Object.freeze([...p.unlocks]), shipped: true })));

/**
 * The cards to draw: the live list once it has been fetched (it wins), else
 * the shipped copy. `catalog` is usePluginInstall's ({ status, plugins }).
 */
export function cardsFrom(catalog) {
  return catalog?.status === 'ready' && Array.isArray(catalog.plugins) ? catalog.plugins : SHIPPED_PLUGINS;
}
