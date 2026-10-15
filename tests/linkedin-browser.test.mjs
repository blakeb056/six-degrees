// The LinkedIn browser plugin's people list (lib/linkedin-browser.js) and the
// plugin itself: a new kind, "feature", whose package is a manifest and a
// README, and whose feature (in the app) shows only with it installed, sound,
// and plugins on (lib/plugins.js, lib/plugins-view.js, scripts/build-plugin.mjs).
// Invented people and packages only.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { profileSlug, peopleIndex, searchPeople, personOnScreen, degreeLabel, LINKEDIN_BROWSER } from '../lib/linkedin-browser.js';
import { panelProfileSlug } from '../desktop/lib.mjs';
import {
  readPackage, installPlugin, listPlugins, scannerPlugin, featureUnlocked, checkManifest, PLUGIN_KINDS, PLUGIN_KIND_UNLOCKS, PLUGIN_UNLOCKS,
} from '../lib/plugins.js';
import { checkCatalog } from '../lib/plugin-catalog.js';
import { SHIPPED_PLUGINS, FEATURE_UNLOCKS, LINKEDIN_BROWSER_VERSION } from '../lib/plugins-shipped.js';
import { PLUGINS, buildPackage, buildCatalog, featureReadme } from '../scripts/build-plugin.mjs';
import { makePackage, sha256 } from './helpers/plugins.mjs';

const read = (rel) => fs.readFileSync(new URL(rel, import.meta.url), 'utf8');

// ── Who is on screen ─────────────────────────────────────────────────────────

test('a stored profile_url and the panel’s page meet on the slug: trailing slashes, queries, case, encoding', () => {
  const same = [
    'https://www.linkedin.com/in/ada-invented',
    'https://www.linkedin.com/in/ada-invented/',
    'https://www.linkedin.com/in/ADA-Invented/?trk=people',
    'https://linkedin.com/in/ada-invented#about',
    'http://www.linkedin.com/in/ada-invented/',     // stored by an old import over http
    'www.linkedin.com/in/ada-invented',             // stored without a scheme
    'https://de.linkedin.com/in/ada-invented/details/skills/',
  ];
  for (const url of same) assert.equal(profileSlug(url), 'ada-invented', url);
  assert.equal(profileSlug('https://www.linkedin.com/in/j%C3%B6rg-invented/'), 'jörg-invented');
  assert.equal(profileSlug('https://www.linkedin.com/in/jörg-invented/'), 'jörg-invented');
  for (const url of [null, '', 'https://www.linkedin.com/company/invented', 'https://example.com/in/ada-invented', 'https://www.linkedin.com/in/', 'not a url']) {
    assert.equal(profileSlug(url), null, String(url));
  }
  // The shell reads the panel's page the same way (desktop/lib.mjs, which can't import this file).
  for (const url of ['https://www.linkedin.com/in/ADA-Invented/?trk=x', 'https://www.linkedin.com/in/j%C3%B6rg-invented/', 'https://uk.linkedin.com/in/x-y/details/']) {
    assert.equal(panelProfileSlug(url), profileSlug(url), url);
  }
});

// An invented network: you know Bea and Cal; Dee is known through both; Eve through Cal only.
const NETWORK = {
  degree1: [
    { id: 'b1', degree: 1, name: 'Bea Invented', company: 'Acme Robotics', headline: 'Head of Ops at Acme Robotics', location: 'Lisbon, Portugal', tier: 'A', power_score: 70, mutual_count: 12, profile_url: 'https://www.linkedin.com/in/bea-invented/' },
    { id: 'c1', degree: 1, name: 'Cal Invented', company: 'Globex', headline: 'Engineer', location: 'Austin, Texas, United States', tier: 'B', power_score: 50, profile_url: 'https://www.linkedin.com/in/cal-invented' },
  ],
  degree2: [
    { id: 'd2a', degree: 2, name: 'Dee Invented', source_connection_id: 'b1', company: 'Initech', headline: 'Founder', location: 'São Paulo, Brazil', tier: 'S', power_score: 90, mutual_count: 3, profile_url: 'https://www.linkedin.com/in/dee-invented?trk=x' },
    { id: 'd2b', degree: 2, name: 'Dee Invented', source_connection_id: 'c1', company: 'Initech', tier: 'S', power_score: 88, mutual_count: 5, profile_url: 'https://www.linkedin.com/in/Dee-Invented/' },
    { id: 'e2', degree: 2, name: 'Eve Invented', source_connection_id: 'c1', company: 'Acme Robotics', tier: 'C', power_score: 20, profile_url: 'https://www.linkedin.com/in/eve-invented/' },
  ],
  degree3: [],
};

test('one entry a person, however many bridges: closest degree, best row for Outlink, every bridge, the largest mutual count', () => {
  const index = peopleIndex(NETWORK);
  assert.equal(index.people.length, 4);
  const dee = personOnScreen(index, 'dee-invented');
  assert.equal(dee.id, 'd2a', 'the stronger of their rows');
  assert.equal(dee.degree, 2);
  assert.deepEqual(dee.via, ['Bea Invented', 'Cal Invented'], 'who connects you');
  assert.equal(dee.mutual, 5);
  assert.equal(dee.location, 'São Paulo, Brazil');
  assert.equal(dee.tier, 'S');
  assert.equal(personOnScreen(index, 'bea-invented').degree, 1);
  assert.equal(personOnScreen(index, 'eve-invented').mutual, null, 'never read: no count, not 0');
  assert.deepEqual(personOnScreen(index, 'bea-invented').via, []);
  assert.equal(personOnScreen(index, 'BEA-INVENTED')?.name, 'Bea Invented');
  // On screen but not in your data: nobody, and the list says so.
  assert.equal(personOnScreen(index, 'stranger-invented'), null);
  assert.equal(personOnScreen(index, null), null);
  assert.equal(personOnScreen(null, 'bea-invented'), null);
  assert.equal(degreeLabel(1), '1st');
  assert.equal(degreeLabel(2), '2nd');
  assert.equal(degreeLabel(3), '3rd');
});

test('search by name, company or place: every word somewhere, accents and case ignored, names first, then closest', () => {
  const index = peopleIndex(NETWORK);
  const names = (q) => searchPeople(index, q).map((p) => p.name);
  assert.deepEqual(names('bea'), ['Bea Invented']);
  assert.deepEqual(names('acme'), ['Bea Invented', 'Eve Invented'], 'a company: closest first');
  assert.deepEqual(names('sao paulo'), ['Dee Invented'], 'a place, without its accent');
  assert.deepEqual(names('Austin texas'), ['Cal Invented']);
  assert.deepEqual(names('invented acme'), ['Bea Invented', 'Eve Invented'], 'every word must match');
  assert.deepEqual(names('eve'), ['Eve Invented']);
  assert.deepEqual(names('d'), [], 'one letter finds nobody');
  assert.deepEqual(names('   '), []);
  assert.equal(searchPeople(index, 'invented', 2).length, 2, 'at most the limit');
  assert.deepEqual(searchPeople(null, 'bea'), []);
});

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
  assert.equal(LINKEDIN_BROWSER_VERSION, '1.0.0');
  assert.equal(p.kind, 'feature');
  assert.deepEqual([...p.unlocks], [LINKEDIN_BROWSER]);
  assert.deepEqual([...FEATURE_UNLOCKS], [LINKEDIN_BROWSER]);
  assert.match(p.about, /desktop app/);
  assert.match(p.risk, /your own LinkedIn account/);
  assert.match(p.risk, /reads nothing on its own/);
  assert.match(p.risk, /one of the day’s profile views/);
  for (const text of [p.about, p.risk]) assert.doesNotMatch(text, /—|scrap/i, 'no em dashes, and "scanning", never the other word');
  // Built: a manifest and its README, at its own version whatever the scanners' is, read back whole.
  const plugin = PLUGINS.find((x) => x.id === 'linkedin-browser');
  const zip = buildPackage(plugin, { version: '9.9.9', appVersion: '2.4.0' });
  const back = readPackage(zip, { appVersion: '2.4.0' });
  assert.equal(back.manifest.version, '1.0.0');
  assert.equal(back.manifest.kind, 'feature');
  assert.deepEqual([...back.files.keys()], ['README.md']);
  assert.equal(back.files.get('README.md').toString(), fs.readFileSync(featureReadme('linkedin-browser'), 'utf8'));
  assert.doesNotMatch(back.files.get('README.md').toString(), /—|scrap/i);
  const list = buildCatalog([{ plugin, file: 'linkedin-browser-1.0.0.sgplugin', zip, sha256: sha256(zip) }],
    { base: 'http://127.0.0.1:4848', version: '9.9.9', appVersion: '2.4.0' });
  assert.equal(list.plugins[0].version, '1.0.0');
  assert.equal(list.plugins[0].kind, 'feature');
});

test('the app: the button only in the desktop app with the plugin on, beside the bell and Settings, never on a phone', () => {
  const header = read('../app/components/AppHeader.js');
  const right = header.slice(header.indexOf('<ScanLight isMobile'), header.indexOf('<ProfileButton'));
  assert.match(right, /<LinkedInButton isMobile=\{isMobile\} \/>[\s\S]*<SettingsGear[\s\S]*<NotificationBell/);
  const browser = read('../app/components/LinkedInBrowser.js');
  assert.match(browser, /if \(!panel\?\.available \|\| !on \|\| isMobile\) return null;/);
  assert.match(browser, /const on = useFeature\(LINKEDIN_BROWSER\);/);
  // The feature's answer: plugins on, and that plugin sound.
  assert.match(read('../app/api/plugins/features/route.js'), /appFeatures\(\)/);
  assert.match(read('../lib/plugins-view.js'), /featureUnlocked\(dir, unlock, \{ pluginsEnabled: enabled \}\)/);
  // A profile from the list goes through Outlink: one view, recorded, never quietly in the panel.
  assert.match(browser, /openProfile\(\{ id: person\.id, name: person\.name, profile_url: person\.profileUrl \}, \{ browser: false \}\)/);
  assert.doesNotMatch(browser, /loadURL|\.navigate\(/);
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
