#!/usr/bin/env node
// Does the download website say the version being released?
//
//   node scripts/check-site-version.mjs            # this checkout
//   node scripts/check-site-version.mjs <folder>   # another one
//
// docs/SEO.md's release checklist, as a check: the site's version lines are
// bumped by hand with each release, and a release that forgets one tells search
// engines and AI assistants about the version before. Against package.json's
// version and its release date (its heading in CHANGELOG.md, "## [0.4.0] -
// 2026-09-28"):
//   - site/index.html: the JSON-LD's softwareVersion is the version, and its
//     dateModified isn't older than the release;
//   - site/llms.txt: "Current version:" is the version, and the month beside it
//     is the release's;
//   - site/sitemap.xml: lastmod isn't older than the release.
// A pre-release (0.4.0-beta.1) is left alone: the site describes the last full
// release, and a beta changes none of it.
//
// .github/workflows/release.yml runs it before building anything, so a stale
// site stops a release in seconds. Exits 1 and says what to change. A release
// tool: nothing the app runs uses it.

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July',
  'August', 'September', 'October', 'November', 'December'];

const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** The date CHANGELOG.md gives a version ("## [0.4.0] - 2026-09-28"), or null. */
export function releaseDate(changelog, version) {
  const m = changelog.match(new RegExp(`^## \\[${escape(version)}\\] - (\\d{4}-\\d{2}-\\d{2})`, 'm'));
  return m ? m[1] : null;
}

/**
 * What the site says, or null for each line it doesn't have: the JSON-LD's
 * softwareVersion and dateModified (its SoftwareApplication), llms.txt's
 * "Current version:" and the "(Month YYYY)" after it, and every sitemap lastmod.
 */
export function readSite({ indexHtml, llmsTxt, sitemapXml }) {
  let app = null;
  const block = indexHtml.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/);
  if (block) {
    try {
      const data = JSON.parse(block[1]);
      app = (data['@graph'] || [data]).find((node) => [].concat(node['@type']).includes('SoftwareApplication')) || null;
    } catch { /* unreadable: reported as missing below */ }
  }
  const current = llmsTxt.match(/Current version:\s*v?(\S+?)(?:\s+\(([A-Z][a-z]+ \d{4})\))?[.,;]?(?:\s|$)/);
  return {
    softwareVersion: app?.softwareVersion ?? null,
    dateModified: app?.dateModified ?? null,
    llmsVersion: current ? current[1] : null,
    llmsMonth: current?.[2] ?? null,
    lastmods: [...sitemapXml.matchAll(/<lastmod>\s*(\d{4}-\d{2}-\d{2})/g)].map((m) => m[1]),
  };
}

/** Everything the site gets wrong about this release, in words; [] when it's right. */
export function siteVersionProblems({ version, changelog, indexHtml, llmsTxt, sitemapXml }) {
  const problems = [];
  const released = releaseDate(changelog, version);
  if (!released) {
    problems.push(`CHANGELOG.md has no "## [${version}] - YYYY-MM-DD" heading, which is where the release date comes from.`);
  }
  const site = readSite({ indexHtml, llmsTxt, sitemapXml });

  if (!site.softwareVersion) problems.push('site/index.html: no softwareVersion in the JSON-LD (its SoftwareApplication).');
  else if (site.softwareVersion !== version) problems.push(`site/index.html: softwareVersion is ${site.softwareVersion}, not ${version}.`);
  if (released) {
    if (!site.dateModified) problems.push('site/index.html: no dateModified in the JSON-LD.');
    else if (site.dateModified < released) problems.push(`site/index.html: dateModified ${site.dateModified} is older than the release (${released}).`);
  }

  if (!site.llmsVersion) problems.push('site/llms.txt: no "Current version:" line.');
  else if (site.llmsVersion !== version) problems.push(`site/llms.txt: "Current version: ${site.llmsVersion}", not ${version}.`);
  if (released && site.llmsMonth) {
    const month = `${MONTHS[Number(released.slice(5, 7)) - 1]} ${released.slice(0, 4)}`;
    if (site.llmsMonth !== month) problems.push(`site/llms.txt: the version line says ${site.llmsMonth}, not ${month}.`);
  }

  if (!site.lastmods.length) problems.push('site/sitemap.xml: no <lastmod>.');
  else if (released) {
    for (const d of site.lastmods) {
      if (d < released) problems.push(`site/sitemap.xml: lastmod ${d} is older than the release (${released}).`);
    }
  }
  return problems;
}

function main() {
  const root = path.resolve(process.argv[2] || path.join(path.dirname(fileURLToPath(import.meta.url)), '..'));
  const read = (file) => readFileSync(path.join(root, file), 'utf8');
  const { version } = JSON.parse(read('package.json'));
  if (version.includes('-')) {
    console.log(`  ${version} is a pre-release: the site keeps describing the last full release, so there is nothing to check.`);
    return;
  }
  const problems = siteVersionProblems({
    version, changelog: read('CHANGELOG.md'),
    indexHtml: read('site/index.html'), llmsTxt: read('site/llms.txt'), sitemapXml: read('site/sitemap.xml'),
  });
  if (!problems.length) {
    console.log(`  ✓ The site says ${version}.`);
    return;
  }
  // On GitHub Actions each line is also an error annotation on the run.
  const mark = process.env.GITHUB_ACTIONS === 'true' ? '::error::' : '  ✗ ';
  console.error(`\n  The site doesn't match ${version} yet:\n`);
  for (const p of problems) console.error(`${mark}${p}`);
  console.error('\n  Update those lines (docs/SEO.md, "Release checklist"), commit, and tag again.\n');
  process.exit(1);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (err) {
    console.error(`\n  ✗ ${err.message}\n`);
    process.exit(1);
  }
}
