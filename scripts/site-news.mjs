// The website's numbers and news, from files in this repository: used by
// scripts/build-site.mjs, which builds the site (see site/README.md).
//
// Where each number comes from, so every one of them can be checked:
//   - releases, their dates, what each changed: CHANGELOG.md's "## [x.y.z] - date"
//     headings and the top-level bullets under their "### Added/Changed/…" headings.
//     A pre-release (x.y.z-beta.n) is folded into the full release it became;
//     one that hasn't become a full release yet isn't counted.
//   - tests: every line starting "test(" in tests/*.test.mjs, which is what
//     `npm test` counts.
//   - the sample network: public/demo-data.json, the invented network that ships
//     with the app (read only; scripts/gen-synthetic.mjs makes it).
//
// In site/index.html each generated part sits between <!-- gen:NAME --> and
// <!-- /gen:NAME -->; everything else on the page is written by hand.

import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

const REPO_URL = 'https://github.com/blakeb056/six-degrees';
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July',
  'August', 'September', 'October', 'November', 'December'];
const KINDS = ['added', 'changed', 'fixed', 'removed', 'security', 'deprecated'];
// Which bullets make the headline: new things first, then changes, then fixes.
const LEAD_ORDER = ['added', 'changed', 'fixed', 'security', 'removed', 'deprecated'];
export const NEWS_POSTS = 4;

const escapeHtml = (s) => String(s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** "2026-09-29" → "29 September 2026". */
export function longDate(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return `${d} ${MONTHS[m - 1]} ${y}`;
}

/** Markdown inline marks and links dropped: plain words. */
export function plainText(md) {
  return md
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/(^|[^\w*])\*(?!\s)(.+?)\*(?!\w)/g, '$1$2')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * A bullet's bold lead-in ("**Names on or off** for the Galaxy" → "Names on or
 * off"), tidied for a headline: no trailing full stop or colon, and a bracket
 * kept only when it says the thing is experimental. Null when it has none.
 */
export function leadOf(bullet) {
  const m = bullet.match(/^\*\*(.+?)\*\*/);
  if (!m) return null;
  let lead = plainText(m[1]);
  lead = lead.replace(/\s*\(([^)]*)\)/g, (_, inner) => (/experimental/i.test(inner) ? ' (experimental)' : ''));
  return lead.replace(/[\s.:,;]+$/, '').trim() || null;
}

/**
 * CHANGELOG.md as releases, newest first:
 *   { version, date, prerelease, intro, bullets: [{ kind, text }] }
 * Only "## [x.y.z] - YYYY-MM-DD" headings count ("Unreleased" has no date).
 */
export function parseChangelog(md) {
  const releases = [];
  let release = null;
  let kind = null;
  let bullet = null;
  const end = () => { bullet = null; };
  for (const line of md.split('\n')) {
    const head = line.match(/^## \[(\d+\.\d+\.\d+(?:-[0-9A-Za-z.]+)?)\] - (\d{4}-\d{2}-\d{2})/);
    if (head) {
      release = { version: head[1], date: head[2], prerelease: head[1].includes('-'), intro: '', bullets: [], body: '' };
      releases.push(release);
      kind = null;
      end();
      continue;
    }
    if (/^## /.test(line)) { release = null; kind = null; end(); continue; }
    if (!release) continue;
    release.body += `${line}\n`;
    const sub = line.match(/^### (\w+)/);
    if (sub) { kind = sub[1].toLowerCase(); end(); continue; }
    if (!kind) {
      if (line.trim()) release.intro = `${release.intro} ${line.trim()}`.trim();
      continue;
    }
    if (/^- /.test(line)) {
      bullet = { kind, text: line.slice(2).trim() };
      release.bullets.push(bullet);
    } else if (bullet && /^\s+\S/.test(line) && !/^\s+- /.test(line)) {
      bullet.text += ` ${line.trim()}`;
    } else if (/^\S/.test(line)) {
      end();
    }
  }
  return releases;
}

/**
 * Full releases, newest first, each with its pre-releases folded in (what
 * 0.4.0-beta.1 added shipped to everyone in 0.4.0). A pre-release that hasn't
 * become a full release yet is left out: the site describes full releases.
 */
export function fullReleases(releases) {
  const full = releases.filter((r) => !r.prerelease).map((r) => ({ ...r, betas: [] }));
  const byVersion = new Map(full.map((r) => [r.version, r]));
  for (const r of releases) {
    if (!r.prerelease) continue;
    const parent = byVersion.get(r.version.split('-')[0]);
    if (parent) parent.betas.push(r);
  }
  return full;
}

/** How many top-level bullets a release (and its betas) has of each kind. */
export function changeCounts(release) {
  const counts = {};
  for (const b of [release, ...(release.betas || [])].flatMap((r) => r.bullets)) {
    const k = KINDS.includes(b.kind) ? b.kind : 'changed';
    counts[k] = (counts[k] || 0) + 1;
  }
  return counts;
}

/** A post's headline and up to three more highlights, from bold lead-ins. */
export function highlights(release, more = 3) {
  const all = [release, ...(release.betas || [])].flatMap((r) => r.bullets);
  const ordered = LEAD_ORDER.flatMap((k) => all.filter((b) => b.kind === k));
  const leads = [...new Set(ordered.map((b) => leadOf(b.text)).filter(Boolean))];
  let title = leads.shift();
  if (!title) {
    const first = ordered[0] ? plainText(ordered[0].text) : `Sixgree ${release.version}`;
    title = first.length > 90 ? `${first.slice(0, 90).replace(/\s+\S*$/, '')}…` : first.replace(/[.:]$/, '');
  }
  return { title, more: leads.slice(0, more) };
}

const releaseUrl = (version) => `${REPO_URL}/releases/tag/v${version}`;

function chips(counts) {
  const items = KINDS.filter((k) => counts[k]).map((k) => `<li class="k-${k}">${counts[k]} ${k}</li>`);
  return `<ul class="chips" aria-label="What changed">${items.join('')}</ul>`;
}

export function newsHtml(full, count = NEWS_POSTS) {
  const posts = full.slice(0, count).map((r, i) => {
    const { title, more } = highlights(r);
    const also = more.length ? `\n          <p class="post-more">Also: ${more.map(escapeHtml).join(' · ')}</p>` : '';
    const latest = i === 0 ? '<span class="tag latest">Latest</span>' : '';
    return `        <article class="post${i === 0 ? ' featured' : ''}">
          <p class="post-meta"><time datetime="${r.date}">${longDate(r.date)}</time><span class="tag">v${escapeHtml(r.version)}</span>${latest}</p>
          <h3><a href="${releaseUrl(r.version)}">${escapeHtml(title)}</a></h3>${also}
          ${chips(changeCounts(r))}
          <a class="more" href="${releaseUrl(r.version)}">Release notes<span class="sr-only"> for ${escapeHtml(r.version)}</span> →</a>
        </article>`;
  });
  return `\n${posts.join('\n')}\n        `;
}

const round = (n) => Math.round(n * 100) / 100;

/**
 * Columns of stacked bars as an SVG that stretches to its box (no text inside,
 * so nothing distorts), each column with a tooltip. The labels are HTML beside it.
 */
export function columnSvg(columns, { label, max = Math.max(1, ...columns.map((c) => c.parts.reduce((s, p) => s + p.value, 0))) } = {}) {
  const H = 100;
  const step = 10;
  const barW = 7;
  const bars = columns.map((c, i) => {
    if (!c.parts.length) return '';   // a gap
    let below = 0;
    const x = round(i * step + (step - barW) / 2);
    const rects = c.parts.filter((p) => p.value > 0).map((p) => {
      const top = Math.max(0, H - ((below + p.value) / max) * H);
      const bottom = H - (below / max) * H;
      below += p.value;
      return `<rect class="${p.cls}" x="${x}" y="${round(top)}" width="${barW}" height="${round(bottom - top)}"/>`;
    }).join('');
    // The whole column's height answers a click, not just its bar, so a short one is easy to hit.
    const bar = `<g><title>${escapeHtml(c.title)}</title><rect class="hit" x="${round(i * step)}" y="0" width="${step}" height="${H}"/>${rects}</g>`;
    return c.href ? `<a href="${escapeHtml(c.href)}">${bar}</a>` : bar;
  }).join('');
  return `<svg class="bars" viewBox="0 0 ${columns.length * step} ${H}" preserveAspectRatio="none" role="img" aria-label="${escapeHtml(label)}">${bars}</svg>`;
}

function labelRow(labels) {
  return `<ol class="bar-labels" aria-hidden="true">${labels.map((l) => `<li>${l ? escapeHtml(l) : ''}</li>`).join('')}</ol>`;
}

/** A version's id on /releases/ (and in its links). */
export const anchor = (version) => `v${version}`;
const STAGES = ['Alpha', 'Beta', 'Preview'];
const shortDate = (d) => longDate(d).replace(/ (\w{3})\w* \d{4}$/, ' $1');

/**
 * Every full release, oldest to newest, by how many changes of each kind; and
 * before them the milestones before 0.1 (`before`, newest first, as on the
 * page), by stage and by the commits that landed for each, since there was no
 * changelog yet (Blake, 2026-10-03: the chart began at "a really stacked 0.1.0",
 * as if the work had started there). A gap marks where the releases begin, and
 * a band under the bars names each stretch. Each bar opens its notes.
 */
export function releaseChartHtml(full, before = []) {
  const oldestFirst = [...full].reverse();
  const earlier = [...before].reverse();
  const releases = oldestFirst.map((r) => {
    const c = changeCounts(r);
    const total = KINDS.reduce((s, k) => s + (c[k] || 0), 0);
    const parts = KINDS.map((k) => ({ value: c[k] || 0, cls: `k-${k}` }));
    const said = KINDS.filter((k) => c[k]).map((k) => `${c[k]} ${k}`).join(', ');
    return { parts, title: `${r.version} · ${longDate(r.date)}: ${total} changes (${said})`, href: `#${anchor(r.version)}` };
  });
  const milestones = earlier.map((b) => ({
    parts: [{ value: b.commits, cls: `k-${b.stage.toLowerCase()}` }],
    title: `${b.title} · ${longDate(b.date)}: ${b.commits} commits (before the changelog began)`,
    href: `#${b.id}`,
  }));
  const gap = milestones.length ? [{ parts: [], title: '' }] : [];
  const columns = [...milestones, ...gap, ...releases];
  const total = full.reduce((s, r) => s + Object.values(changeCounts(r)).reduce((a, b) => a + b, 0), 0);
  const commits = earlier.reduce((s, b) => s + b.commits, 0);
  // The first and the newest only: at phone width the columns are too narrow to name more.
  const firstLabel = earlier.length ? `${earlier[0].title.split(':')[0]} · ${shortDate(earlier[0].date)}` : `${oldestFirst[0].version} · ${shortDate(oldestFirst[0].date)}`;
  const labels = columns.map((c, i) => (i === 0 ? firstLabel : i === columns.length - 1 ? `${full[0].version} · ${shortDate(full[0].date)}` : ''));
  const svg = columnSvg(columns, {
    label: (earlier.length
      ? `${earlier.length} milestones before 0.1, from ${longDate(earlier[0].date)}, by commits (${commits} in all); then changes per release, `
      : 'Changes per release, ')
      + `${oldestFirst.length} releases from ${oldestFirst[0].version} to ${full[0].version}, ${total} in all`,
  });
  // The band: each stage, then the releases, as wide as their columns.
  const band = earlier.length ? stageBand([
    ...STAGES.map((stage) => {
      const of = earlier.filter((b) => b.stage === stage);
      return of.length && { n: of.length, cls: `s-${stage.toLowerCase()}`, text: stage, short: stage[0], title: `${stage}: ${of.length} milestones, ${shortDate(of[0].date)} to ${shortDate(of.at(-1).date)}` };
    }).filter(Boolean),
    { n: 1 },
    { n: releases.length, cls: 's-release', text: 'Releases', short: 'Releases', title: `${releases.length} releases, from ${shortDate(oldestFirst[0].date)}` },
  ]) : '';
  return `\n          ${svg}\n          ${band}${labelRow(labels)}\n          `;
}

// One cell per column, as the labels row has, since the site's content policy
// allows no inline styles to size a cell per stretch: the stretch's name sits
// in its first cell and runs on into the rest.
function stageBand(groups) {
  const cells = groups.flatMap((g) => Array.from({ length: g.n }, (_, i) => (!g.cls ? '<li></li>'
    : `<li class="${g.cls}${i === 0 ? ' first' : ''}"${i === 0 ? ` title="${escapeHtml(g.title)}"` : ''}>${i === 0 ? `<span class="long">${escapeHtml(g.text)}</span><span class="short">${escapeHtml(g.short)}</span>` : ''}</li>`)));
  return `<ol class="stage-band" aria-hidden="true">${cells.join('')}</ol>\n          `;
}

/** The sample network's shape: who's two steps away, and through how many of your connections. */
export function sampleStats(data) {
  const byPerson = new Map();
  for (const p of data.degree2 || []) {
    const key = p.profile_url || p.id || p.name;
    if (!byPerson.has(key)) byPerson.set(key, new Set());
    byPerson.get(key).add(p.source_connection_id);
  }
  const ways = { one: 0, two: 0, more: 0 };
  const only = new Map(); // connection → people only they reach
  for (const sources of byPerson.values()) {
    if (sources.size === 1) {
      ways.one += 1;
      const [via] = sources;
      only.set(via, (only.get(via) || 0) + 1);
    } else if (sources.size === 2) ways.two += 1;
    else ways.more += 1;
  }
  const bridges = new Set((data.degree2 || []).map((p) => p.source_connection_id)).size;
  return {
    connections: (data.degree1 || []).length,
    degree2: byPerson.size,
    bridges,
    ways,
    exclusive: [...only.values()].sort((a, b) => b - a),
  };
}

export function exclusiveChartHtml(s) {
  const columns = s.exclusive.map((n, i) => ({
    parts: [{ value: n, cls: i === 0 ? 'k-top' : 'k-bridge' }],
    title: `Connection ${i + 1}: ${n} people only they reach`,
  }));
  const svg = columnSvg(columns, {
    label: `The ${s.exclusive.length} connections with a scanned circle in the sample network, by how many people only they reach: from ${s.exclusive[0]} down to ${s.exclusive.at(-1)}`,
  });
  return `\n            ${svg}\n            ${labelRow(s.exclusive.map(String))}\n            `;
}

export function waysBarHtml(s) {
  const total = s.degree2 || 1;
  const parts = [['one', 'k-one'], ['two', 'k-two'], ['more', 'k-more']];
  let x = 0;
  const rects = parts.map(([k, cls]) => {
    const w = round((s.ways[k] / total) * 100);
    const r = `<rect class="${cls}" x="${round(x)}" y="0" width="${w}" height="10"/>`;
    x += w;
    return r;
  }).join('');
  const label = `Of ${s.degree2} people two steps away: ${s.ways.one} through one connection only, ${s.ways.two} through two, ${s.ways.more} through three or more`;
  return `<svg class="stack" viewBox="0 0 100 10" preserveAspectRatio="none" role="img" aria-label="${label}">${rects}</svg>`;
}

/** Every test the suite runs: node:test's test( calls, one per line, in tests/*.test.mjs. */
export function countTests(testsDir) {
  let n = 0;
  for (const f of readdirSync(testsDir)) {
    if (!f.endsWith('.test.mjs')) continue;
    n += (readFileSync(path.join(testsDir, f), 'utf8').match(/^test\(/gm) || []).length;
  }
  return n;
}

const thousands = (n) => n.toLocaleString('en-US');
const percent = (a, b) => `${Math.round((a / b) * 100)}%`;

/** Everything the page's <!-- gen:NAME --> slots get, by name. */
export function generate({ changelog, testCount, sample }) {
  const full = fullReleases(parseChangelog(changelog));
  if (!full.length) throw new Error('CHANGELOG.md has no "## [x.y.z] - YYYY-MM-DD" release heading.');
  const latest = full[0];
  const first = full.at(-1);
  const s = sampleStats(sample);
  return {
    'latest-version': escapeHtml(latest.version),
    'latest-date': `<time datetime="${latest.date}">${longDate(latest.date)}</time>`,
    'release-count': String(full.length),
    'first-release': `<time datetime="${first.date}">${longDate(first.date)}</time>`,
    'change-count': thousands(full.reduce((sum, r) => sum + Object.values(changeCounts(r)).reduce((a, b) => a + b, 0), 0)),
    'test-count': thousands(testCount),
    news: newsHtml(full),
    'sample-connections': thousands(s.connections),
    'sample-degree2': thousands(s.degree2),
    'sample-bridges': String(s.bridges),
    'sample-one-way': thousands(s.ways.one),
    'sample-one-way-share': percent(s.ways.one, s.degree2),
    'sample-two-way': thousands(s.ways.two),
    'sample-more-way': thousands(s.ways.more),
    'sample-top-exclusive': String(s.exclusive[0] ?? 0),
    'sample-ways-bar': waysBarHtml(s),
    'sample-exclusive-chart': exclusiveChartHtml(s),
  };
}

/** The page with every gen slot filled; throws on a slot nothing fills. */
export function fill(html, values) {
  return html.replace(/<!-- gen:([a-z0-9-]+) -->([\s\S]*?)<!-- \/gen:\1 -->/g, (_, name) => {
    if (!(name in values)) throw new Error(`a page has a slot nothing fills: gen:${name}`);
    return `<!-- gen:${name} -->${values[name]}<!-- /gen:${name} -->`;
  });
}
