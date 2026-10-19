// Outlink is gone. Blake, 2026-10-17: "Remove Outlink entirely. It has no actual
// beneficiary to the application. We have LinkedIn embedded into the app.
// Separation is what you want to do anyway." Its page, its game, its tab and the
// old queue route went; the links that led there now go to Separation (who a
// connection can introduce you to) or open the profile (OpenProfile.js).
// Messages & follow-ups, which had been folded into it and was /social again for
// a while after, went too on 2026-10-19 (Blake: "I don't want Messages and
// follow-ups"). Read from the source files; nothing runs.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { TOUR_STEPS, HINTS, HOW_TOS, tourSteps } from '../lib/help.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const exists = (rel) => fs.existsSync(path.join(ROOT, rel));

function sources(dir) {
  const out = [];
  for (const e of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
    const rel = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...sources(rel));
    else if (/\.(m?js|cjs|jsx|css)$/.test(e.name)) out.push(rel);
  }
  return out;
}

// The one place the old name stays: the record of profiles opened keeps its file
// name, because existing installs already have it (lib/profile-opened.js).
const KEPT_FILE = 'outlink-opened.json';
const withoutKeptFile = (src) => src.split(KEPT_FILE).join('');

test('the page, its game, the tab and the old queue route are gone', () => {
  for (const rel of ['app/queue', 'app/api/queue', 'app/components/OutlinkQuest.js', 'lib/quest.js', 'tests/quest.test.mjs', 'lib/outlink-opened.js']) {
    assert.equal(exists(rel), false, `${rel} is still there`);
  }
  const tabs = read('app/components/AppTabs.js');
  assert.doesNotMatch(tabs, /key: 'outlink'|href: '\/queue'/);
  const pages = [...tabs.matchAll(/\{ key: '([a-z]+)', href: '([^']+)'/g)].map((m) => [m[1], m[2]]);
  // Class came later as its own tab (Blake, 2026-10-19), not in Outlink's place.
  assert.deepEqual(pages.map(([k]) => k).filter((k) => k !== 'class'), ['paths', 'breach', 'scan', 'linkedin'], 'no tab added in its place');
});

// The pages the release checks open on the installed app, read out of the two
// places that list them: release.yml's `for p in ...` and smoke-desktop.mjs's
// array. "" is the map (app/page.js).
const releasePages = () => {
  const yml = /for p in ([^;\n]+); do/.exec(read('.github/workflows/release.yml'));
  const smoke = /for \(const p of \[([^\]]*)\]\)/.exec(read('scripts/smoke-desktop.mjs'));
  assert.ok(yml && smoke, 'both page lists are found');
  return {
    'release.yml': yml[1].trim().split(/\s+/).map((p) => p.replace(/^"(.*)"$/, '$1')),
    'smoke-desktop.mjs': smoke[1].split(',').map((p) => p.trim().replace(/^'(.*)'$/, '$1')),
  };
};
const pageFile = (p) => (p === '' ? 'app/page.js' : p.startsWith('api/') ? `app/${p}/route.js` : `app/${p}/page.js`);

test('the release checks open no removed page (/queue, /social), and still open /class', () => {
  // 2.9.0's first release run failed: the installed-app check still opened /queue.
  for (const [where, pages] of Object.entries(releasePages())) {
    for (const gone of ['queue', 'social']) assert.ok(!pages.includes(gone), `${where} still opens /${gone}`);
    assert.ok(pages.includes('class'), `${where} opens /class`);
    assert.ok(pages.includes(''), `${where} opens the map`);
  }
});

test('every page the release checks open exists, so a removed page can\'t be left in either list', () => {
  for (const [where, pages] of Object.entries(releasePages())) {
    assert.ok(pages.length >= 5, `${where}: the list was read`);
    for (const p of pages) assert.ok(exists(pageFile(p)), `${where} opens /${p}, but there is no ${pageFile(p)}`);
  }
});

test('nothing in the app, lib or the desktop shell links to /queue or says Outlink', () => {
  const found = [];
  for (const file of [...sources('app'), ...sources('lib'), ...sources('desktop')]) {
    const src = withoutKeptFile(read(file));
    if (/\/queue\b/.test(src)) found.push(`${file}: /queue`);
    if (/outlink/i.test(src)) found.push(`${file}: Outlink`);
    if (/view=messages/.test(src)) found.push(`${file}: view=messages`);
  }
  assert.deepEqual(found, []);
  // The scanner has no job for opening a profile, and the app never asks for one.
  assert.doesNotMatch(read('lib/linkedin-panel.js'), /outlinkResultIn|OUTLINK_RESULT/);
});

test('Messages & follow-ups is gone: no page, no route, no daily sync, and nothing links to it', () => {
  for (const rel of ['app/social', 'app/api/social', 'app/components/SocialAutoSync.js', 'lib/social-crm.js', 'lib/social-store.js', 'lib/linkedin-export.js']) {
    assert.equal(exists(rel), false, `${rel} is still there`);
  }
  const found = [];
  for (const file of [...sources('app'), ...sources('lib'), ...sources('desktop')]) {
    const src = read(file);
    if (/href="\/social\b|['"`]\/social(?:['"`?#/])|\/api\/social\b/.test(src)) found.push(`${file}: /social`);
    if (/SocialAutoSync/.test(src)) found.push(`${file}: SocialAutoSync`);
  }
  assert.deepEqual(found, []);
});

test('the tour, the hints and the how-tos have no Outlink step', () => {
  for (const list of [TOUR_STEPS, HINTS, HOW_TOS]) {
    for (const item of list) {
      assert.notEqual(item.key, 'outlink');
      assert.notEqual(item.target, 'outlink');
      assert.notEqual(item.place, 'outlink');
      assert.doesNotMatch(JSON.stringify(item), /outlink|\/queue|five at a time/i, item.key);
    }
  }
  assert.ok(!tourSteps({ own: true, scanner: true, linkedin: true }).some((s) => s.key === 'outlink'));
  assert.doesNotMatch(read('lib/help.js'), /outlink/i);
});

test('the Map\'s intro buttons go to Separation, filtered to the connection\'s circle, and the chain card opens the profile', () => {
  const map = read('app/components/WorldMap.js');
  const parts = read('app/components/WorldMapParts.js');
  const layers = read('app/components/WorldMapLayers.js');
  for (const src of [map, parts, layers]) assert.doesNotMatch(src, /outlinkFor|canOutlink|\/queue/);
  // In place, as a card's Insights → Show them: the map page's showInSeparation with the connection's name.
  assert.match(read('app/page.js'), /onShowInSeparation: showInSeparation,/);
  assert.match(map, /const introsVia = onShowInSeparation \? \(b\) => onShowInSeparation\(\{ query: b\.name \}\) : null;/);
  for (const panel of ['<ReachPanel ', '<PlacePanel ', '<FlowPanel ']) {
    const at = map.indexOf(panel);
    assert.ok(at > 0, panel);
    assert.match(map.slice(at, at + 300), /onIntros=\{introsVia\}/, panel);
  }
  assert.match(parts, /onClick=\{\(\) => onIntros\(g\.bridge\)\}/);
  assert.match(parts, /onClick=\{\(\) => onIntros\(bridge\)\}/);
  assert.match(layers, /onClick=\{\(\) => onIntros\(bridge\)\}/);
  // "Ask X for an intro" on the chain card: X's profile, through the one shared link; not in the public demo.
  assert.match(layers, /<OpenProfile person=\{ask\}[^>]*>\s*Ask \{firstName\(ask\.name\)\} for an intro/);
  assert.match(map, /canAsk=\{!IS_DEMO\}/);
  // The person card's old "Add N People" button: Separation, filtered to their circle, too.
  const card = read('app/components/Sidebar.js');
  assert.match(card, /onClick=\{\(\) => onShowInSeparation\(\{ query: selected\.name \}\)\}/);
});

test('the website and the docs page no longer offer it', () => {
  for (const rel of ['site/index.html', 'site/llms.txt', 'site/_pages/docs.html', 'README.md']) {
    assert.doesNotMatch(read(rel), /outlink/i, rel);
  }
});
