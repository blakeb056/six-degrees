// The LinkedIn browser plugin: a kind of its own, "feature", whose package is
// a manifest and a README, and whose feature (in the app, the LinkedIn tab)
// shows only with it installed, sound, and plugins on (lib/plugins.js,
// lib/plugins-view.js, scripts/build-plugin.mjs). 1.0.1 is the tab alone: the
// header's LinkedIn button and the people list are gone (Blake, 2026-10-15: "I
// want to remove the LinkedIn button at the top right and don't like the side
// panel idea"). Invented packages only.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { LINKEDIN_BROWSER } from '../lib/linkedin-browser.js';
import {
  readPackage, installPlugin, listPlugins, scannerPlugin, featureUnlocked, checkManifest, PLUGIN_KINDS, PLUGIN_KIND_UNLOCKS, PLUGIN_UNLOCKS,
} from '../lib/plugins.js';
import { checkCatalog } from '../lib/plugin-catalog.js';
import { SHIPPED_PLUGINS, FEATURE_UNLOCKS, LINKEDIN_BROWSER_VERSION } from '../lib/plugins-shipped.js';
import { PLUGINS, buildPackage, buildCatalog, featureReadme } from '../scripts/build-plugin.mjs';
import { makePackage, sha256 } from './helpers/plugins.mjs';

const read = (rel) => fs.readFileSync(new URL(rel, import.meta.url), 'utf8');

// ── A new kind of plugin ─────────────────────────────────────────────────────

const FEATURE = {
  files: { 'README.md': '# An invented feature plugin\n' },
  manifest: { id: 'linkedin-browser', name: 'LinkedIn browser', kind: 'feature', unlocks: ['linkedin-browser'] },
};

test('"feature" is a kind: its own unlocks, a README and no scanner', () => {
  assert.deepEqual([...PLUGIN_KINDS], ['scanner', 'feature']);
  assert.deepEqual([...PLUGIN_KIND_UNLOCKS.feature], [LINKEDIN_BROWSER]);
  assert.deepEqual([...PLUGIN_UNLOCKS], ['auto', 'manual', LINKEDIN_BROWSER]);
  const ok = makePackage(FEATURE);
  assert.equal(readPackage(ok.zip).manifest.kind, 'feature');
  // A scanner's unlock on a feature, or a feature's on a scanner: refused.
  assert.throws(() => readPackage(makePackage({ ...FEATURE, manifest: { ...FEATURE.manifest, unlocks: ['auto'] } }).zip),
    /unlocks must list "linkedin-browser"\./);
  assert.throws(() => readPackage(makePackage({ manifest: { unlocks: ['linkedin-browser'] } }).zip),
    /unlocks must list "auto" or "manual", or both\./, 'the scanner message as before');
  // No scanner code in a feature.
  assert.throws(() => readPackage(makePackage({ ...FEATURE, files: { 'README.md': 'x', 'scanner/scrape.py': 'raise SystemExit()' } }).zip),
    /feature plugin, but it holds scanner files/);
  // A kind nobody knows is still refused.
  assert.throws(() => checkManifest({ ...makePackage(FEATURE).manifest, kind: 'theme' }), /kind of plugin this Sixgree doesn’t know/);
});

test('its feature is on only with it installed, sound, and plugins on; it is never a scanner', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'six-degrees-feature-'));
  try {
    assert.equal(featureUnlocked(dir, LINKEDIN_BROWSER, { pluginsEnabled: true }), false, 'not installed');
    const pkg = makePackage(FEATURE);
    installPlugin(dir, pkg.zip, { sha256: pkg.sha256 });
    assert.equal(featureUnlocked(dir, LINKEDIN_BROWSER, { pluginsEnabled: true }), true);
    assert.equal(featureUnlocked(dir, LINKEDIN_BROWSER, { pluginsEnabled: false }), false, 'plugins off: off');
    assert.equal(featureUnlocked(dir, 'auto', { pluginsEnabled: true }), false);
    assert.deepEqual(listPlugins(dir).map((p) => [p.id, p.kind, p.state]), [['linkedin-browser', 'feature', 'ready']]);
    assert.equal(scannerPlugin(dir).plugin, null, 'scans never run a feature plugin');
    assert.deepEqual(scannerPlugin(dir).skipped, []);
    // Changed since it was installed: broken, and off.
    fs.writeFileSync(path.join(dir, 'plugins', 'linkedin-browser', 'README.md'), 'changed');
    assert.equal(featureUnlocked(dir, LINKEDIN_BROWSER, { pluginsEnabled: true }), false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('the plugin list takes a feature entry, and a scanner’s unlock on one is shown as not for this version', () => {
  const entry = (over) => ({
    id: 'linkedin-browser', name: 'LinkedIn browser', version: '1.0.0', about: 'An invented feature.', kind: 'feature',
    unlocks: ['linkedin-browser'], sixgree: '>=1.0.0', url: 'https://plugins.example/linkedin-browser-1.0.0.sgplugin',
    sha256: 'c'.repeat(64), size: 1000, ...over,
  });
  const checked = checkCatalog({ format: 'sixgree.plugin-catalog', format_version: 1, plugins: [entry({}), entry({ id: 'other-feature', unlocks: ['auto'] })] }, { appVersion: '2.4.0' });
  assert.equal(checked.problem, null);
  assert.deepEqual(checked.plugins.map((p) => [p.id, p.kind, p.unlocks, p.problem]), [
    ['linkedin-browser', 'feature', ['linkedin-browser'], null],
    ['other-feature', 'feature', [], 'It turns on something this Sixgree doesn’t have ("auto").'],
  ]);
});

test('the shipped list names it at its own version, with an honest about and risk, and the build makes its package', () => {
  const p = SHIPPED_PLUGINS.find((x) => x.id === 'linkedin-browser');
  assert.ok(p);
  assert.equal(p.version, LINKEDIN_BROWSER_VERSION);
  assert.equal(LINKEDIN_BROWSER_VERSION, '1.0.1', 'the tab only: the header button and people list taken out');
  assert.equal(p.kind, 'feature');
  assert.deepEqual([...p.unlocks], [LINKEDIN_BROWSER]);
  assert.deepEqual([...FEATURE_UNLOCKS], [LINKEDIN_BROWSER]);
  assert.match(p.about, /desktop app/);
  assert.match(p.about, /LinkedIn tab/);
  assert.match(p.about, /Feed, Messaging, Notifications and Jobs/);
  assert.match(p.about, /Back and Forward/);
  assert.doesNotMatch(p.about, /people list|beside it|on screen|button at the top/i, 'the tab only');
  assert.match(p.risk, /your own LinkedIn account/);
  assert.match(p.risk, /reads nothing on its own/);
  assert.match(p.risk, /one of the day’s profile views/);
  assert.doesNotMatch(p.risk, /people list/);
  for (const text of [p.about, p.risk]) assert.doesNotMatch(text, /—|scrap/i, 'no em dashes, and "scanning", never the other word');
  // Built: a manifest and its README, at its own version whatever the scanners' is, read back whole.
  const plugin = PLUGINS.find((x) => x.id === 'linkedin-browser');
  const zip = buildPackage(plugin, { version: '9.9.9', appVersion: '2.4.0' });
  const back = readPackage(zip, { appVersion: '2.4.0' });
  assert.equal(back.manifest.version, '1.0.1');
  assert.equal(back.manifest.kind, 'feature');
  assert.deepEqual([...back.files.keys()], ['README.md']);
  assert.equal(back.files.get('README.md').toString(), fs.readFileSync(featureReadme('linkedin-browser'), 'utf8'));
  assert.doesNotMatch(back.files.get('README.md').toString(), /—|scrap/i);
  // The README describes the tab only.
  const readme = back.files.get('README.md').toString();
  assert.match(readme, /\*\*LinkedIn\*\* tab/);
  assert.match(readme, /\*\*Back\*\* and \*\*Forward\*\*/);
  assert.doesNotMatch(readme, /people list|top right|beside the bell/i);
  const list = buildCatalog([{ plugin, file: 'linkedin-browser-1.0.1.sgplugin', zip, sha256: sha256(zip) }],
    { base: 'http://127.0.0.1:4848', version: '9.9.9', appVersion: '2.4.0' });
  assert.equal(list.plugins[0].version, '1.0.1');
  assert.equal(list.plugins[0].kind, 'feature');
});

test('the app: no LinkedIn button in the header and no people list; the feature is the tab', () => {
  const header = read('../app/components/AppHeader.js');
  assert.doesNotMatch(header, /LinkedInButton|LinkedInBrowser|data-linkedin-button/);
  // The right side keeps the scan light, Settings and the bell, as before the plugin.
  const right = header.slice(header.indexOf('<ScanLight isMobile'), header.indexOf('<ProfileButton'));
  assert.match(right, /<SettingsGear[\s\S]*<NotificationBell/);
  assert.equal(fs.existsSync(new URL('../app/components/LinkedInBrowser.js', import.meta.url)), false, 'the button and the list, gone');
  const panel = read('../app/components/LinkedInPanel.js');
  assert.doesNotMatch(panel, /PeopleSidebar|browsing|'browse'/);
  assert.doesNotMatch(read('../app/components/linkedInPanelState.js'), /browseLinkedIn|\.browse\(/);
  // The feature's answer: plugins on, and that plugin sound.
  assert.match(read('../app/api/plugins/features/route.js'), /appFeatures\(\)/);
  assert.match(read('../lib/plugins-view.js'), /featureUnlocked\(dir, unlock, \{ pluginsEnabled: enabled \}\)/);
  // The guided setup's cards stay the scanners.
  assert.match(read('../app/components/onboarding/steps.js'), /kinds=\{SCANNER_KINDS\}/);
});

test('the LinkedIn tab: shown with the plugin in the desktop app, its notch buttons each a LinkedIn section', async () => {
  const { LINKEDIN_SECTIONS, sectionUrl, sectionOf } = await import('../desktop/lib.mjs');
  assert.deepEqual(Object.keys(LINKEDIN_SECTIONS), ['feed', 'messaging', 'notifications', 'jobs']);
  assert.equal(sectionUrl('feed'), 'https://www.linkedin.com/feed/');
  assert.equal(sectionUrl('messaging'), 'https://www.linkedin.com/messaging/');
  assert.equal(sectionUrl('notifications'), 'https://www.linkedin.com/notifications/');
  assert.equal(sectionUrl('jobs'), 'https://www.linkedin.com/jobs/');
  assert.equal(sectionUrl('jobs', { testOrigin: 'http://127.0.0.1:47811' }), 'http://127.0.0.1:47811/jobs/');
  assert.equal(sectionUrl('settings'), null, 'only those four');
  assert.equal(sectionUrl('__proto__'), null);
  // Where the panel's page is: any page under a section is in it; anywhere else is no section.
  for (const [url, key] of [
    ['https://www.linkedin.com/feed/', 'feed'], ['https://www.linkedin.com/feed', 'feed'], ['https://www.linkedin.com/feed/update/urn:li:x/', 'feed'],
    ['https://www.linkedin.com/messaging/thread/2-abc/', 'messaging'], ['https://www.linkedin.com/notifications/?filter=all', 'notifications'],
    ['https://www.linkedin.com/jobs/view/123/', 'jobs'], ['https://www.linkedin.com/in/ada-invented/', null], ['https://www.linkedin.com/feedback/', null],
    ['https://example.com/feed/', null], ['about:blank', null],
  ]) assert.equal(sectionOf(url), key, url);
  assert.equal(sectionOf('http://127.0.0.1:47811/messaging/', { testOrigin: 'http://127.0.0.1:47811' }), 'messaging');
  // The tab: a page of its own, shown only with the plugin and the panel; its notch, the four sections.
  const tabs = read('../app/components/AppTabs.js');
  assert.match(tabs, /\{ key: 'linkedin', href: '\/linkedin', label: 'LinkedIn', own: true, browser: true \}/);
  assert.match(tabs, /const browser = browserOn && Boolean\(panel\?\.available\);/);
  assert.match(tabs, /\(browser \|\| !p\.browser\)/);
  const page = read('../app/linkedin/page.js');
  assert.match(page, /useNotchTabs\(/);
  assert.match(page, /openLinkedInSection\(section\)/);
  const state = read('../app/components/linkedInPanelState.js');
  assert.match(state, /\{ key: 'feed', label: 'Feed' \},\s*\{ key: 'messaging', label: 'Messaging' \},\s*\{ key: 'notifications', label: 'Notifications' \},\s*\{ key: 'jobs', label: 'Jobs' \}/);
  // Left the section: a way back to it, in the bar. Its notch buttons don't put the panel away.
  const panel = read('../app/components/LinkedInPanel.js');
  assert.match(panel, /const strayed = Boolean\(section && panel\.at !== section\.key\);/);
  assert.match(panel, /Back to \{section\.label\}/);
  assert.match(panel, /if \(lastPath\.current === LINKEDIN_TAB && hit\.closest\('\[data-notch\]'\)\) return;/);
  // Browsing, not a scan: the shell only loads the section; nothing reads it or counts it.
  const main = read('../desktop/main.mjs');
  const show = main.slice(main.indexOf('function showSection'), main.indexOf('function panelState'));
  assert.doesNotMatch(show, /beginScrape|executeJavaScript|charge|outlink/i);
});
