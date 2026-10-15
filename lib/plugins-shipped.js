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
// disagree (a newer version, other words, an entry gone), the live list wins
// (cardsFrom).
//
// It is also what scripts/build-plugin.mjs builds the packages and the list
// from, so the list a build writes (dist/plugins/catalog.json) says exactly
// this; tests/plugins-shipped.test.mjs checks the two agree. No Node imports:
// the pages read it.

// The honest risk each one carries, shown before it installs: the Scan page's
// own points (lib/scan-risk.js RISK_POINTS), said for what each plugin does.
const RISK_TERMS = 'LinkedIn’s User Agreement doesn’t allow automated tools, and LinkedIn may restrict accounts that use them.';

/** The version the official packages are built at (scripts/build-plugin.mjs --version). */
export const SHIPPED_PLUGIN_VERSION = '1.0.3';

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
 * The cards to draw: the shipped copy until the live list has been fetched,
 * then the live list merged over it, entry by entry, where the live one wins
 * (its version, words and risk, and whether it's for this Sixgree). An entry
 * gone from the live list is gone from the cards: there is nothing to install.
 * `catalog` is usePluginInstall's ({ status, plugins }); a check that is
 * running again, or failed after one that worked, keeps the last list it had.
 */
export function cardsFrom(catalog) {
  if (!Array.isArray(catalog?.plugins)) return SHIPPED_PLUGINS;
  const shipped = new Map(SHIPPED_PLUGINS.map((p) => [p.id, p]));
  return catalog.plugins.map((live) => (shipped.has(live.id) ? { ...shipped.get(live.id), ...live, shipped: false } : live));
}
