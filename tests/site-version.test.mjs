// At release, the download website must say the version being released
// (scripts/check-site-version.mjs, run by release.yml before any build).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { releaseDate, readSite, siteVersionProblems } from '../scripts/check-site-version.mjs';

const SCRIPT = fileURLToPath(new URL('../scripts/check-site-version.mjs', import.meta.url));
const REPO = fileURLToPath(new URL('..', import.meta.url));

// A site as it should look on the day 1.2.0 is released, in the real files' shapes.
function site({ softwareVersion = '1.2.0', dateModified = '2026-10-02', llms = '1.2.0 (October 2026)', lastmod = '2026-10-02' } = {}) {
  return {
    changelog: '# Changelog\n\n## [Unreleased]\n\n## [1.2.0] - 2026-10-02\n\n### Added\n- **Something.**\n\n## [1.1.0] - 2026-09-20\n',
    indexHtml: `<head>
  <script type="application/ld+json">
  {
    "@context": "https://schema.org",
    "@graph": [
      { "@type": "WebSite", "name": "Six Degrees" },
      { "@type": "SoftwareApplication", "name": "Six Degrees", "softwareVersion": "${softwareVersion}", "datePublished": "2026-09-24", "dateModified": "${dateModified}" }
    ]
  }
  </script>
</head>`,
    llmsTxt: `# Six Degrees\n\n- Free and open source.\n- Current version: ${llms}. Updates are one click from inside the app.\n`,
    sitemapXml: `<urlset>\n  <url>\n    <loc>https://example.invalid/</loc>\n    <lastmod>${lastmod}</lastmod>\n  </url>\n</urlset>\n`,
  };
}

test('the release date is the version\'s heading in the changelog', () => {
  const { changelog } = site();
  assert.equal(releaseDate(changelog, '1.2.0'), '2026-10-02');
  assert.equal(releaseDate(changelog, '1.1.0'), '2026-09-20');
  assert.equal(releaseDate(changelog, '1.2'), null, 'a version is matched whole');
  assert.equal(releaseDate('## [0.4.0-beta.1] - 2026-09-28 (beta)\n', '0.4.0-beta.1'), '2026-09-28');
});

test('a site that says the release passes, and a later date is fine', () => {
  assert.deepEqual(siteVersionProblems({ version: '1.2.0', ...site() }), []);
  assert.deepEqual(siteVersionProblems({ version: '1.2.0', ...site({ dateModified: '2026-10-05', lastmod: '2026-10-05' }) }), []);
  assert.deepEqual(siteVersionProblems({ version: '1.2.0', ...site({ llms: '1.2.0' }) }), [], 'the month is optional');
});

test('each stale line is named, with what it says and what it should', () => {
  const stale = siteVersionProblems({
    version: '1.2.0',
    ...site({ softwareVersion: '1.1.0', dateModified: '2026-09-20', llms: '1.1.0 (September 2026)', lastmod: '2026-09-20' }),
  });
  assert.deepEqual(stale, [
    'site/index.html: softwareVersion is 1.1.0, not 1.2.0.',
    'site/index.html: dateModified 2026-09-20 is older than the release (2026-10-02).',
    'site/llms.txt: "Current version: 1.1.0", not 1.2.0.',
    'site/llms.txt: the version line says September 2026, not October 2026.',
    'site/sitemap.xml: lastmod 2026-09-20 is older than the release (2026-10-02).',
  ]);
  // One forgotten line is enough to fail.
  assert.deepEqual(siteVersionProblems({ version: '1.2.0', ...site({ lastmod: '2026-10-01' }) }),
    ['site/sitemap.xml: lastmod 2026-10-01 is older than the release (2026-10-02).']);
});

test('no release date, or a line the site doesn\'t have, fails rather than passing quietly', () => {
  const base = site();
  assert.match(siteVersionProblems({ version: '1.3.0', ...site({ softwareVersion: '1.3.0', llms: '1.3.0' }) })[0],
    /CHANGELOG\.md has no "## \[1\.3\.0\] - YYYY-MM-DD" heading/);
  const bare = siteVersionProblems({ version: '1.2.0', changelog: base.changelog, indexHtml: '<head></head>', llmsTxt: '# Six Degrees\n', sitemapXml: '<urlset/>' });
  assert.deepEqual(bare, [
    'site/index.html: no softwareVersion in the JSON-LD (its SoftwareApplication).',
    'site/index.html: no dateModified in the JSON-LD.',
    'site/llms.txt: no "Current version:" line.',
    'site/sitemap.xml: no <lastmod>.',
  ]);
  const broken = siteVersionProblems({ version: '1.2.0', ...base, indexHtml: base.indexHtml.replace('"@graph"', '@graph') });
  assert.equal(broken[0], 'site/index.html: no softwareVersion in the JSON-LD (its SoftwareApplication).');
});

test('the real site\'s version lines are all found, so a reformat fails here and not at release', () => {
  const real = readSite({
    indexHtml: readFileSync(path.join(REPO, 'site/index.html'), 'utf8'),
    llmsTxt: readFileSync(path.join(REPO, 'site/llms.txt'), 'utf8'),
    sitemapXml: readFileSync(path.join(REPO, 'site/sitemap.xml'), 'utf8'),
  });
  assert.match(real.softwareVersion, /^\d+\.\d+\.\d+$/);
  assert.match(real.dateModified, /^\d{4}-\d{2}-\d{2}$/);
  assert.equal(real.llmsVersion, real.softwareVersion);
  assert.match(real.llmsMonth, /^[A-Z][a-z]+ \d{4}$/);
  assert.ok(real.lastmods.length > 0);
});

test('run as a command: a pre-release is left alone, a stale site exits 1 and says what to change', (t) => {
  const dir = mkdtempSync(path.join(tmpdir(), 'six-degrees-site-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  mkdirSync(path.join(dir, 'site'));
  const write = (version, files) => {
    writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ version }));
    writeFileSync(path.join(dir, 'CHANGELOG.md'), files.changelog);
    writeFileSync(path.join(dir, 'site/index.html'), files.indexHtml);
    writeFileSync(path.join(dir, 'site/llms.txt'), files.llmsTxt);
    writeFileSync(path.join(dir, 'site/sitemap.xml'), files.sitemapXml);
  };
  const run = (env = {}) => spawnSync(process.execPath, [SCRIPT, dir], {
    encoding: 'utf8', env: { ...process.env, GITHUB_ACTIONS: '', ...env },
  });

  write('1.2.0', site());
  let r = run();
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /The site says 1\.2\.0/);

  write('1.3.0-beta.1', site());
  r = run();
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /pre-release/);

  write('1.2.0', site({ lastmod: '2026-09-20' }));
  r = run();
  assert.equal(r.status, 1);
  assert.match(r.stderr, /✗ site\/sitemap\.xml: lastmod 2026-09-20 is older than the release \(2026-10-02\)\./);
  assert.match(r.stderr, /Release checklist/);

  // On GitHub Actions each problem is an error annotation too.
  r = run({ GITHUB_ACTIONS: 'true' });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /^::error::site\/sitemap\.xml: lastmod/m);
});
