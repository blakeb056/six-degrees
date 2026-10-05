// The website is built from the repository by scripts/build-site.mjs (run by
// pages.yml): News, the numbers, the sample charts, the release notes, the blog
// and the feeds all come from CHANGELOG.md, tests/, public/demo-data.json and site/.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  parseChangelog, fullReleases, changeCounts, highlights, leadOf, longDate, plainText,
  sampleStats, fill, newsHtml, releaseChartHtml,
} from '../scripts/site-news.mjs';
import { markdown, frontMatter, htmlFrontMatter, slugify } from '../scripts/site-markdown.mjs';
import { build, loadSite, slotValues, faqFrom, header, scanWording, BEFORE } from '../scripts/build-site.mjs';

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
- **\`npx sixgree\` on Linux.** It runs.
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
  assert.equal(highlights(older).title, 'npx sixgree on Linux');
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

test('the real site builds: every page, both feeds and the sitemap, each page with its own title and canonical', () => {
  const out = mkdtempSync(path.join(tmpdir(), 'sd-site-'));
  try {
    const { pages, values } = build(REPO, out, { images: false });
    const { version } = JSON.parse(read('package.json'));
    if (!version.includes('-')) assert.equal(values['latest-version'], version, 'the newest release in the changelog is package.json\'s');
    for (const p of ['/', '/download/', '/docs/', '/roadmap/', '/about/', '/releases/', '/blog/']) assert.ok(pages.includes(p), p);
    const titles = new Set();
    for (const p of pages) {
      const html = readFileSync(path.join(out, p, 'index.html'), 'utf8');
      const title = html.match(/<title>([^<]+)<\/title>/)[1];
      assert.ok(!titles.has(title), `${p} has a title of its own`);
      titles.add(title);
      assert.match(html, new RegExp(`<link rel="canonical" href="https://sixgree.com${p.replace(/[/]/g, '\\/')}">`), `${p} canonical`);
      assert.doesNotMatch(html, /<!-- gen:[a-z0-9-]+ --><!-- \/gen:/, `${p} has no empty slot`);
      for (const block of html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)) JSON.parse(block[1]);
    }
    for (const f of ['blog/feed.xml', 'releases/feed.xml', 'sitemap.xml']) assert.ok(existsSync(path.join(out, f)), f);
    const sitemap = readFileSync(path.join(out, 'sitemap.xml'), 'utf8');
    for (const p of pages) assert.ok(sitemap.includes(`<loc>https://sixgree.com${p}</loc>`), `${p} is in the sitemap`);
    assert.ok(!existsSync(path.join(out, '_posts')) && !existsSync(path.join(out, 'README.md')), 'sources are not published');
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
});

test('the committed home page has every slot filled from the repository', () => {
  const site = loadSite(REPO);
  assert.doesNotThrow(() => fill(site.indexHtml, slotValues(site)));
});

test('Markdown: headings with ids, lists that nest in order, and no raw HTML', () => {
  const html = markdown('## What it does\n\n- **A.** one\n  two\n  - sub\n\n  After.\n- B\n\n<script>x</script> and `<b>`');
  assert.match(html, /<h2 id="what-it-does">What it does<\/h2>/);
  assert.match(html, /<li><strong>A\.<\/strong> one two<ul>\n<li>sub<\/li>\n<\/ul><p>After\.<\/p><\/li>/);
  assert.match(html, /&lt;script&gt;x&lt;\/script&gt; and <code>&lt;b&gt;<\/code>/);
  assert.match(markdown('[x](javascript:alert(1))'), /href="#"/, 'no script links');
  assert.equal(slugify('Who can introduce you?'), 'who-can-introduce-you');
  assert.deepEqual(frontMatter('---\ntitle: Hi\ntags: [a, b]\n---\nBody').data, { title: 'Hi', tags: ['a', 'b'] });
  assert.equal(htmlFrontMatter('<!--\ntitle: Page\n-->\n<p>x</p>').data.title, 'Page');
});

test('the FAQ data mirrors the questions on the page, and the nav marks where you are', () => {
  assert.deepEqual(faqFrom('<dl><div><dt>Is it free?</dt>\n<dd>Yes. <code>MIT</code> &amp; more.</dd></div></dl>'),
    [{ '@type': 'Question', name: 'Is it free?', acceptedAnswer: { '@type': 'Answer', text: 'Yes. MIT & more.' } }]);
  const nav = header('<a href="/">Home</a><a href="/blog/">Blog</a><a href="/#features">Features</a>', '/blog/some-post/');
  assert.match(nav, /<a href="\/blog\/" aria-current="page">/);
  assert.doesNotMatch(nav, /href="\/" aria-current/);
});

test('published notes say scanning, and keep file and route names as they are', () => {
  assert.equal(scanWording('The scraper scrapes; a Scrape was scraped by `scripts/scrape.py` and `/api/scraper`.'),
    'The scanner scans; a Scan was scanned by `scripts/scrape.py` and `/api/scraper`.');
});

test('the generations before 0.1 are on /releases/, below 0.1.0, with their stage', () => {
  const out = mkdtempSync(path.join(tmpdir(), 'sd-site-'));
  try {
    build(REPO, out, { images: false });
    const html = readFileSync(path.join(out, 'releases/index.html'), 'utf8');
    for (const b of BEFORE) {
      assert.ok(html.indexOf(`id="${b.id}"`) > html.indexOf('id="v0.1.0"'), `${b.id} comes after 0.1.0`);
      assert.match(html, new RegExp(`id="${b.id}"[\\s\\S]*?class="tag stage s-${b.stage.toLowerCase()}">${b.stage}<`));
    }
    assert.doesNotMatch(readFileSync(path.join(out, 'releases/feed.xml'), 'utf8'), /Before 0\.1|The first build/, 'not in the feed');
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
});

test('the releases chart starts at the first build: the milestones by commits, a gap, then each release, each a link to its notes', () => {
  const full = fullReleases(parseChangelog(read('CHANGELOG.md')));
  const html = releaseChartHtml(full, BEFORE);
  const links = [...html.matchAll(/<a href="#([^"]+)">/g)].map((m) => m[1]);
  // Oldest first: the first build, then every milestone, then 0.1.0 … the newest release.
  assert.deepEqual(links.slice(0, BEFORE.length), [...BEFORE].reverse().map((b) => b.id));
  assert.equal(links[BEFORE.length], 'v0.1.0');
  assert.equal(links.at(-1), `v${full[0].version}`);
  assert.equal(links.length, BEFORE.length + full.length);
  for (const b of BEFORE) {
    assert.ok(Number.isInteger(b.commits) && b.commits > 0, `${b.id} has its commits`);
    assert.match(html, new RegExp(`${b.title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} · [^:]+: ${b.commits} commits`));
  }
  // The band: a cell under every column, the gap's empty, each stretch named once.
  const cells = html.match(/<ol class="stage-band"[^>]*>([\s\S]*?)<\/ol>/)[1].match(/<li/g).length;
  assert.equal(cells, BEFORE.length + 1 + full.length);
  for (const name of ['Alpha', 'Beta', 'Preview', 'Releases']) assert.equal(html.split(`<span class="long">${name}</span>`).length, 2);
  assert.match(html, /<li>Alpha 1 · 11 Jun<\/li>/);
  assert.doesNotMatch(html, / style=/, 'the site allows no inline styles');
});
