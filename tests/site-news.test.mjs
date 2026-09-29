// The website's News, numbers and sample charts are generated from the repository
// (scripts/build-site-news.mjs, run by pages.yml on the copy it publishes).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  parseChangelog, fullReleases, changeCounts, highlights, leadOf, longDate, plainText,
  sampleStats, countTests, generate, fill, newsHtml,
} from '../scripts/build-site-news.mjs';

const REPO = fileURLToPath(new URL('..', import.meta.url));
const read = (f) => readFileSync(new URL(`../${f}`, import.meta.url), 'utf8');

const CHANGELOG = `# Changelog

## [Unreleased]

### Added
- **Not out yet.** Never shown.

## [1.2.0] - 2026-10-02

### Added
- **A new view (experimental, in Filters).** It does a thing,
  over two lines.
  - a sub-point, not counted
- **Names on or off** for the Galaxy.

### Fixed
- A plain fix with no bold lead.

## [1.2.0-beta.1] - 2026-10-01 (beta: a pre-release, never installed automatically)

### Added
- **Something from the beta.** Shipped in 1.2.0.

## [1.3.0-beta.1] - 2026-10-03 (beta)

### Added
- **Only in a beta.** Not a full release yet.

## [1.1.0] - 2026-09-20

The first one worth a note.

### Changed
- **\`npx six-degrees\` on Linux.** It runs.
`;

test('releases come from dated headings only, newest first, with their bullets', () => {
  const releases = parseChangelog(CHANGELOG);
  assert.deepEqual(releases.map((r) => r.version), ['1.2.0', '1.2.0-beta.1', '1.3.0-beta.1', '1.1.0']);
  const [r] = releases;
  assert.equal(r.date, '2026-10-02');
  assert.equal(r.bullets.length, 3, 'a sub-point is part of its bullet, not one of its own');
  assert.match(r.bullets[0].text, /over two lines\.$/);
  assert.equal(releases[3].intro, 'The first one worth a note.');
});

test('a beta folds into the full release it became; one still in beta is left out', () => {
  const full = fullReleases(parseChangelog(CHANGELOG));
  assert.deepEqual(full.map((r) => r.version), ['1.2.0', '1.1.0']);
  assert.deepEqual(changeCounts(full[0]), { added: 3, fixed: 1 });
});

test('a post is headed by the first new thing, and names up to three more', () => {
  const [latest, older] = fullReleases(parseChangelog(CHANGELOG));
  assert.deepEqual(highlights(latest), { title: 'A new view (experimental)', more: ['Names on or off', 'Something from the beta'] });
  assert.equal(highlights(older).title, 'npx six-degrees on Linux');
});

test('lead-ins lose their full stop and any bracket that isn\'t "experimental"', () => {
  assert.equal(leadOf('**Orbit goes past 2nd degree.** Someone…'), 'Orbit goes past 2nd degree');
  assert.equal(leadOf('**Experimental Auto-Bridge (a switch on the Scan page).** All-day…'), 'Experimental Auto-Bridge');
  assert.equal(leadOf('**Social (experimental): a tab for your relationships.** It…'), 'Social (experimental): a tab for your relationships');
  assert.equal(leadOf('A plain fix.'), null);
  assert.equal(plainText('The *Scan* page, `npx`, [docs](x.md) and **more**'), 'The Scan page, npx, docs and more');
  assert.equal(longDate('2026-09-04'), '4 September 2026');
});

test('news links each post to its GitHub release and escapes what it quotes', () => {
  const html = newsHtml(fullReleases(parseChangelog(CHANGELOG.replace('Names on or off', 'Names <b>on</b> & off'))));
  assert.match(html, /href="https:\/\/github\.com\/blakeb056\/six-degrees\/releases\/tag\/v1\.2\.0"/);
  assert.match(html, /Names &lt;b&gt;on&lt;\/b&gt; &amp; off/);
  assert.equal((html.match(/<article/g) || []).length, 2);
  assert.equal((html.match(/class="tag latest"/g) || []).length, 1, 'only the newest is marked latest');
});

test('the sample\'s shape: people two steps away, and how many ways in each has', () => {
  const s = sampleStats({
    degree1: [{ id: 'a' }, { id: 'b' }, { id: 'c' }],
    degree2: [
      { profile_url: 'x', source_connection_id: 'a' },
      { profile_url: 'x', source_connection_id: 'b' },
      { profile_url: 'y', source_connection_id: 'a' },
      { profile_url: 'z', source_connection_id: 'b' },
      { profile_url: 'z2', source_connection_id: 'b' },
    ],
  });
  assert.deepEqual(s, { connections: 3, degree2: 4, bridges: 2, ways: { one: 3, two: 1, more: 0 }, exclusive: [2, 1] });
});

test('slots are filled between their markers, and an unknown slot is an error', () => {
  assert.equal(fill('a <!-- gen:x -->old<!-- /gen:x --> b', { x: 'new' }), 'a <!-- gen:x -->new<!-- /gen:x --> b');
  assert.throws(() => fill('<!-- gen:nope --><!-- /gen:nope -->', {}), /gen:nope/);
});

test('the real changelog, tests and sample fill every slot on the real page', () => {
  const values = generate({
    changelog: read('CHANGELOG.md'),
    testCount: countTests(`${REPO}/tests`),
    sample: JSON.parse(read('public/demo-data.json')),
  });
  const { version } = JSON.parse(read('package.json'));
  if (!version.includes('-')) assert.equal(values['latest-version'], version, 'the newest release in the changelog is package.json\'s');
  assert.ok(Number(values['release-count']) > 0);
  assert.ok(Number(values['test-count'].replace(/,/g, '')) > 0);
  const page = read('site/index.html');
  assert.doesNotThrow(() => fill(page, values));
  const missing = Object.keys(values).filter((name) => !page.includes(`<!-- gen:${name} -->`));
  assert.deepEqual(missing, [], 'every generated value has a slot on the page');
});
