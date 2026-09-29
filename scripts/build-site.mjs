#!/usr/bin/env node
// Builds the website, https://sixdegreesapp.com/, from site/ into a folder.
//
//   node scripts/build-site.mjs              # the whole site, into _site/
//   node scripts/build-site.mjs <folder>     # into another folder
//   node scripts/build-site.mjs --home       # refresh the generated parts of site/index.html
//   node scripts/build-site.mjs --check      # exit 1 if site/index.html's generated parts are stale
//   --no-images                              # skip the 1200px image copies (tests)
//
// What it makes (site/README.md has the whole picture):
//   /                  site/index.html, its <!-- gen:NAME --> slots filled
//   /download/ /docs/ /roadmap/ /about/   site/_pages/<name>.html inside the shared layout
//   /blog/ and /blog/<slug>/               site/_posts/<slug>.md
//   /releases/                             every version in CHANGELOG.md
//   /blog/feed.xml /releases/feed.xml      Atom feeds
//   /sitemap.xml                           site/sitemap.xml plus every generated page
// Everything else in site/ is copied as it is, except names starting with "_"
// and site/README.md. The README's screenshots (docs/img) come in too, and the
// app's icon as img/icon.svg unless site/img/icon.svg exists. pages.yml runs
// this and publishes the folder. No dependencies.

import { readFileSync, writeFileSync, readdirSync, mkdirSync, rmSync, cpSync, existsSync, copyFileSync, statSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  generate, fill, fullReleases, parseChangelog, changeCounts, highlights, longDate, countTests,
} from './site-news.mjs';
import { markdown, frontMatter, htmlFrontMatter, escapeHtml, plainText } from './site-markdown.mjs';

export const SITE = 'https://sixdegreesapp.com';
export const REPO = 'https://github.com/blakeb056/six-degrees';
const AUTHOR = { '@type': 'Person', '@id': 'https://blakeburford.com/#person', name: 'Blake Burford', url: 'https://blakeburford.com/' };
const KINDS = ['added', 'changed', 'fixed', 'removed', 'security', 'deprecated'];
const TEASERS = 3;

const read = (root, f) => readFileSync(path.join(root, f), 'utf8');
const shortDate = (iso) => longDate(iso).replace(/ (\w{3})\w* /, ' $1 ');
const anchor = (version) => `v${version}`;

// ---------------------------------------------------------------- loading

/** Everything the build reads, from a checkout at `root`. */
export function loadSite(root) {
  const siteDir = path.join(root, 'site');
  const partial = (name) => read(root, `site/_partials/${name}.html`).trim();
  const pages = readdirSync(path.join(siteDir, '_pages')).filter((f) => f.endsWith('.html')).sort().map((f) => {
    const { data, body } = htmlFrontMatter(read(root, `site/_pages/${f}`));
    const name = f.replace(/\.html$/, '');
    return { name, path: data.path || `/${name}/`, ...data, body };
  });
  const posts = readdirSync(path.join(siteDir, '_posts')).filter((f) => f.endsWith('.md')).map((f) => {
    const { data, body } = frontMatter(read(root, `site/_posts/${f}`));
    const slug = f.replace(/\.md$/, '');
    for (const need of ['title', 'description', 'date']) {
      if (!data[need]) throw new Error(`site/_posts/${f} has no "${need}:" in its front matter.`);
    }
    const words = plainText(body).split(/\s+/).length;
    return {
      slug, path: `/blog/${slug}/`, ...data, updated: data.updated || data.date, body,
      html: markdown(body, { headingOffset: 1 }), minutes: Math.max(1, Math.round(words / 220)),
      tags: [].concat(data.tags || []),
    };
  }).sort((a, b) => (a.date === b.date ? a.title.localeCompare(b.title) : b.date.localeCompare(a.date)));
  const indexHtml = read(root, 'site/index.html');
  return {
    root,
    changelog: scanWording(read(root, 'CHANGELOG.md')),
    testCount: countTests(path.join(root, 'tests')),
    sample: JSON.parse(read(root, 'public/demo-data.json')),
    partials: { header: partial('header'), footer: partial('footer'), downloads: partial('downloads') },
    pages,
    posts,
    indexHtml,
    sitemapXml: read(root, 'site/sitemap.xml'),
    // One version for the stylesheet and script on every page: whatever the home page asks for.
    assetVersion: (indexHtml.match(/style\.css\?v=([\w.-]+)/) || [])[1] || '1',
  };
}

// ---------------------------------------------------------------- layout

/** The shared header, with the current section marked for screen readers and the eye. */
export function header(html, current) {
  return html.replace(/<a href="([^"]+)"(?![^>]*aria-current)/g, (m, href) => {
    const here = current && href !== '/' && !href.includes('#') && (current === href || current.startsWith(href));
    return here ? `<a href="${href}" aria-current="page"` : m;
  });
}

const FEEDS = `<link rel="alternate" type="application/atom+xml" title="Six Degrees blog" href="/blog/feed.xml">
  <link rel="alternate" type="application/atom+xml" title="Six Degrees releases" href="/releases/feed.xml">`;

const breadcrumbs = (trail) => ({
  '@type': 'BreadcrumbList',
  itemListElement: trail.map(([name, url], i) => ({ '@type': 'ListItem', position: i + 1, name, item: `${SITE}${url}` })),
});

/** A whole page: head, header, main, footer. `graph` is its JSON-LD. */
export function layout(site, { path: pagePath, title, description, graph, main, image = '/img/og-image.jpg', type = 'website' }) {
  const url = `${SITE}${pagePath}`;
  const img = image.startsWith('http') ? image : `${SITE}${image}`;
  const ld = JSON.stringify({ '@context': 'https://schema.org', '@graph': graph }, null, 2).replace(/</g, '\\u003c');
  const t = escapeHtml(title);
  const d = escapeHtml(description);
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${t}</title>
  <meta name="description" content="${d}">
  <meta http-equiv="Content-Security-Policy" content="default-src 'self'; img-src 'self'; style-src 'self'; script-src 'self'; connect-src https://api.github.com; base-uri 'none'; form-action 'none'">
  <meta name="referrer" content="no-referrer">
  <meta name="author" content="Blake Burford">
  <meta name="robots" content="index, follow, max-image-preview:large, max-snippet:-1">
  <meta name="color-scheme" content="dark">
  <link rel="canonical" href="${url}">
  ${FEEDS}
  <meta property="og:type" content="${type}">
  <meta property="og:site_name" content="Six Degrees">
  <meta property="og:url" content="${url}">
  <meta property="og:title" content="${t}">
  <meta property="og:description" content="${d}">
  <meta property="og:image" content="${img}">
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="${t}">
  <meta name="twitter:description" content="${d}">
  <meta name="twitter:image" content="${img}">
  <meta name="theme-color" content="#0b0a1c">
  <link rel="icon" href="/img/icon.svg" type="image/svg+xml">
  <link rel="apple-touch-icon" href="/apple-touch-icon.png">
  <script type="application/ld+json">
${ld}
  </script>
  <link rel="stylesheet" href="/style.css?v=${site.assetVersion}">
  <script src="/app.js?v=${site.assetVersion}" defer></script>
</head>
<body>
${header(site.partials.header, pagePath)}

  <main id="main" class="page">
${main}
  </main>

${site.partials.footer}
</body>
</html>
`;
}

function webPage(pagePath, name, description, type = 'WebPage', extra = {}) {
  return {
    '@type': type, '@id': `${SITE}${pagePath}#page`, url: `${SITE}${pagePath}`, name, description,
    isPartOf: { '@id': `${SITE}/#website` }, about: { '@id': `${SITE}/#app` }, inLanguage: 'en', ...extra,
  };
}

// ---------------------------------------------------------------- the parts pages share

const chips = (counts) => `<ul class="chips" aria-label="What changed">${
  KINDS.filter((k) => counts[k]).map((k) => `<li class="k-${k}">${counts[k]} ${k}</li>`).join('')}</ul>`;

/** Cards for the newest releases, each linking to its entry on /releases/. */
export function releaseTeaser(full, count = TEASERS) {
  return `\n${full.slice(0, count).map((r, i) => {
    const { title, more } = highlights(r);
    return `        <article class="post${i === 0 ? ' latest-post' : ''}">
          <p class="post-meta"><time datetime="${r.date}">${longDate(r.date)}</time><span class="tag">v${escapeHtml(r.version)}</span>${i === 0 ? '<span class="tag latest">Latest</span>' : ''}</p>
          <h3><a href="/releases/#${anchor(r.version)}">${escapeHtml(title)}</a></h3>${more.length ? `\n          <p class="post-more">Also: ${more.map(escapeHtml).join(' · ')}</p>` : ''}
          ${chips(changeCounts(r))}
        </article>`;
  }).join('\n')}\n        `;
}

/** Cards for the newest blog posts. */
export function postTeaser(posts, count = TEASERS) {
  return `\n${posts.slice(0, count).map((p) => `        <article class="post">
          <p class="post-meta"><time datetime="${p.date}">${longDate(p.date)}</time><span>${p.minutes} min read</span></p>
          <h3><a href="${p.path}">${escapeHtml(p.title)}</a></h3>
          <p class="post-more">${escapeHtml(p.description)}</p>
        </article>`).join('\n')}\n        `;
}

/** Every value a <!-- gen:NAME --> slot can take, on any page. */
export function slotValues(site) {
  const values = generate({ changelog: site.changelog, testCount: site.testCount, sample: site.sample });
  const full = fullReleases(parseChangelog(site.changelog));
  return {
    ...values,
    news: releaseTeaser(full),
    'blog-teaser': postTeaser(site.posts),
    header: `\n${header(site.partials.header, '/')}\n`,
    footer: `\n${site.partials.footer}\n`,
    downloads: `\n${site.partials.downloads}\n`,
  };
}

// ---------------------------------------------------------------- pages

function pageHead({ kicker, title, lede }) {
  return `    <header class="page-hero">
      ${kicker ? `<p class="kicker">${kicker}</p>` : ''}
      <h1>${title}</h1>
      ${lede ? `<p class="lede">${lede}</p>` : ''}
    </header>`;
}

/** The FAQ on a page, as FAQPage data: each <dt> and the <dd> after it. */
export function faqFrom(html) {
  const text = (s) => s.replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/\s+/g, ' ').trim();
  return [...html.matchAll(/<dt>([\s\S]*?)<\/dt>\s*<dd>([\s\S]*?)<\/dd>/g)].map(([, q, a]) => ({
    '@type': 'Question', name: text(q), acceptedAnswer: { '@type': 'Answer', text: text(a) },
  }));
}

export function renderPage(site, page, values) {
  const body = fill(page.body, values);
  const graph = [
    webPage(page.path, page.title, page.description, page.type || 'WebPage', page.updated ? { dateModified: page.updated } : {}),
    breadcrumbs([['Six Degrees', '/'], [page.crumb || page.title, page.path]]),
  ];
  if (page.faq === 'true') graph.push({ '@type': 'FAQPage', '@id': `${SITE}${page.path}#faq`, mainEntity: faqFrom(body) });
  return layout(site, { path: page.path, title: page.title, description: page.description, graph, main: body });
}

export function renderBlogIndex(site) {
  const list = site.posts.map((p) => `      <article class="post-row">
        <p class="post-meta"><time datetime="${p.date}">${longDate(p.date)}</time><span>${p.minutes} min read</span>${p.tags.map((t) => `<span class="tag">${escapeHtml(t)}</span>`).join('')}</p>
        <h2><a href="${p.path}">${escapeHtml(p.title)}</a></h2>
        <p>${escapeHtml(p.description)}</p>
        <a class="more" href="${p.path}">Read it<span class="sr-only">: ${escapeHtml(p.title)}</span> →</a>
      </article>`).join('\n');
  const title = 'Blog: how Six Degrees works, and why';
  const description = 'Notes on how Six Degrees ranks who can introduce you, why it runs on your own computer, the Galaxy physics lab, and scanning slowly and safely.';
  const main = `${pageHead({ kicker: 'Blog', title: 'How it works, and why', lede: 'Notes on the ideas behind Six Degrees, written from the code. Every example uses the invented sample network that ships with the app.' })}
    <div class="post-list">
${list}
    </div>
    <p class="feed-line"><a href="/blog/feed.xml">Follow the blog (Atom feed)</a> · <a href="/releases/">Release notes</a></p>`;
  const graph = [
    { '@type': 'Blog', '@id': `${SITE}/blog/#blog`, url: `${SITE}/blog/`, name: 'Six Degrees blog', description, publisher: { '@id': AUTHOR['@id'] },
      blogPost: site.posts.map((p) => ({ '@id': `${SITE}${p.path}#post` })) },
    breadcrumbs([['Six Degrees', '/'], ['Blog', '/blog/']]),
  ];
  return layout(site, { path: '/blog/', title, description, graph, main });
}

export function renderPost(site, post) {
  const i = site.posts.indexOf(post);
  const newer = site.posts[i - 1];
  const older = site.posts[i + 1];
  const others = site.posts.filter((p) => p !== post).slice(0, 3);
  const main = `    <article class="article">
      <header class="page-hero article-head">
        <p class="kicker"><a href="/blog/">Blog</a></p>
        <h1>${escapeHtml(post.title)}</h1>
        <p class="lede">${escapeHtml(post.description)}</p>
        <p class="post-meta center"><time datetime="${post.date}">${longDate(post.date)}</time><span>${post.minutes} min read</span><span>By Blake Burford</span></p>
      </header>
      <div class="prose">
${post.html}
      </div>
      <footer class="article-foot">
        <p class="fine">Every person named in this post is invented: they're from the sample network that ships with Six Degrees.
          Something wrong? <a href="${REPO}/issues">Open an issue</a>.</p>
        <nav class="post-nav" aria-label="More posts">
          ${older ? `<a href="${older.path}"><span>Older</span>${escapeHtml(older.title)}</a>` : '<span></span>'}
          ${newer ? `<a class="newer" href="${newer.path}"><span>Newer</span>${escapeHtml(newer.title)}</a>` : '<span></span>'}
        </nav>
      </footer>
    </article>
    <section class="more-posts">
      <h2>More from the blog</h2>
      <div class="posts">${postTeaser(others)}</div>
      <p class="more-links"><a class="button" href="/download/">Download Six Degrees</a> <a href="/blog/">All posts</a></p>
    </section>`;
  const graph = [
    {
      '@type': 'BlogPosting', '@id': `${SITE}${post.path}#post`, url: `${SITE}${post.path}`, mainEntityOfPage: `${SITE}${post.path}`,
      headline: post.title, description: post.description, datePublished: post.date, dateModified: post.updated,
      author: AUTHOR, publisher: { '@id': AUTHOR['@id'] }, image: `${SITE}${post.image || '/img/og-image.jpg'}`,
      isPartOf: { '@id': `${SITE}/blog/#blog` }, about: { '@id': `${SITE}/#app` }, keywords: post.tags.join(', '),
      wordCount: plainText(post.body).split(/\s+/).length, inLanguage: 'en',
    },
    breadcrumbs([['Six Degrees', '/'], ['Blog', '/blog/'], [post.title, post.path]]),
  ];
  return layout(site, { path: post.path, title: `${post.title} · Six Degrees`, description: post.description, graph, main, image: post.image, type: 'article' });
}

/**
 * The generations before this codebase, shown on /releases/ under "Before 0.1".
 * Dates and one line each: their repositories are private, so they're never
 * linked. Not in the releases feed: they aren't releases of this app.
 */
export const BEFORE = [
  {
    id: 'beta-static', stage: 'Beta', date: '2026-07-12', title: 'The static version',
    text: 'Your LinkedIn network as a galaxy, with leverage tiers, bridges and introduction paths. Local-first and entirely static: the first version where your data never left your device.',
  },
  {
    id: 'alpha-first-build', stage: 'Alpha', date: '2026-06-11', title: 'The first build',
    text: '"6 Degrees of Separation": a LinkedIn network research tool with a force-directed D3 graph, hosted online. Where Six Degrees started.',
    archive: 'https://six-degrees-linkedin.vercel.app/',
    image: { src: '/img/first-build-june-2026.jpg', alt: 'The first build\'s welcome screen: 6 Degrees of Separation, Map your LinkedIn power network', width: 800, height: 500, caption: 'The first build, June 2026' },
  },
];

export function beforeHtml() {
  const entries = BEFORE.map((b) => `      <article class="release archive" id="${b.id}">
        <header>
          <h2><a href="#${b.id}">${escapeHtml(b.title)}</a> <span class="tag stage">${b.stage}</span></h2>
          <p class="post-meta"><time datetime="${b.date}">${longDate(b.date)}</time></p>${b.archive ? `
          <p class="release-links"><a href="${b.archive}">Archive: the original prototype (June 2026), kept as it was</a></p>` : ''}
        </header>
        <div class="prose release-notes"><p>${escapeHtml(b.text)}</p></div>${b.image ? `
        <figure class="archive-shot"><a href="${b.archive}"><img src="${b.image.src}" alt="${escapeHtml(b.image.alt)}" width="${b.image.width}" height="${b.image.height}" loading="lazy"></a><figcaption>${escapeHtml(b.image.caption)}</figcaption></figure>` : ''}
      </article>`).join('\n');
  return `      <section class="before" id="before-0-1" aria-labelledby="before-h">
        <h2 id="before-h">Before 0.1</h2>
        <p class="fine">The generations before this codebase. The open-source rebuild began on
          <time datetime="2026-08-21">21 August 2026</time> and led to 0.1.0. <a href="/roadmap/#how-it-started">How it started</a>.</p>
${entries}
      </section>`;
}

/**
 * The site says "scanning", never "scraping": older changelog entries used the
 * other word. Outside `code` (file and route names stay as they are), each form
 * is swapped for its "scan" form when the notes are published.
 */
export function scanWording(md) {
  const forms = [[/\bscraping\b/g, 'scanning'], [/\bScraping\b/g, 'Scanning'], [/\bscraper(s?)\b/g, 'scanner$1'], [/\bScraper(s?)\b/g, 'Scanner$1'],
    [/\bscraped\b/g, 'scanned'], [/\bScraped\b/g, 'Scanned'], [/\bscrapes\b/g, 'scans'], [/\bScrapes\b/g, 'Scans'],
    [/\bscrape\b/g, 'scan'], [/\bScrape\b/g, 'Scan']];
  return md.split(/(`[^`]*`)/).map((part, i) => (i % 2 ? part : forms.reduce((t, [re, to]) => t.replace(re, to), part))).join('');
}

/** Every version in the changelog, newest first, with its notes in full. */
export function renderReleases(site, values) {
  const all = parseChangelog(site.changelog);
  const full = fullReleases(all);
  const entries = all.map((r) => {
    const counts = r.prerelease ? changeCounts({ ...r, betas: [] }) : changeCounts(full.find((f) => f.version === r.version));
    const notes = markdown(scanWording(r.body.replace(/^\s+|\s+$/g, '')), { headingOffset: 0, ids: false });
    return `      <article class="release${r.prerelease ? ' beta' : ''}" id="${anchor(r.version)}">
        <header>
          <h2><a href="#${anchor(r.version)}">${escapeHtml(r.version)}</a>${r.prerelease ? ' <span class="tag">beta</span>' : ''}${r === full[0] ? ' <span class="tag latest">Latest</span>' : ''}</h2>
          <p class="post-meta"><time datetime="${r.date}">${longDate(r.date)}</time>${r.prerelease ? '<span>A pre-release, never installed automatically</span>' : ''}</p>
          ${chips(counts)}
          <p class="release-links"><a href="${REPO}/releases/tag/v${escapeHtml(r.version)}">On GitHub${r.prerelease ? '' : ', with the downloads'}</a></p>
        </header>
        <div class="prose release-notes">
${notes}
        </div>
      </article>`;
  }).join('\n');
  const toc = `${full.map((r) => `<a href="#${anchor(r.version)}">${escapeHtml(r.version)}</a>`).join(' ')} <a href="#before-0-1">Before 0.1</a>`;
  const title = 'Release notes: every version of Six Degrees';
  const description = `Everything added, changed and fixed in each of Six Degrees' ${full.length} releases, from ${full.at(-1).version} to ${full[0].version}, newest first.`;
  const main = `${pageHead({ kicker: 'Releases', title: 'Release notes', lede: `Every version, newest first, from the <a href="${REPO}/blob/main/CHANGELOG.md">changelog</a>. Downloads for each are on <a href="${REPO}/releases">GitHub Releases</a>.` })}
    <div class="panel chart-group releases-chart">
      <div class="panel-head">
        <h2>Every release, by what it changed</h2>
        <p class="fine">${values['change-count']} changes in ${values['release-count']} releases since ${values['first-release']}. Betas are counted in the release they became.</p>
      </div>
      <div class="chart">
        <div class="bars-box tall">${values['release-chart']}</div>
        <ul class="legend inline" role="list">${KINDS.slice(0, 5).map((k) => `<li class="k-${k}">${k[0].toUpperCase()}${k.slice(1)}</li>`).join('')}</ul>
      </div>
    </div>
    <nav class="release-toc" aria-label="Versions"><span>Jump to</span> ${toc}</nav>
    <div class="releases">
${entries}
${beforeHtml()}

    </div>
    <p class="feed-line"><a href="/releases/feed.xml">Follow releases (Atom feed)</a> · <a href="${REPO}/releases">All releases on GitHub</a></p>`;
  const graph = [
    webPage('/releases/', title, description, 'CollectionPage', { dateModified: full[0].date }),
    breadcrumbs([['Six Degrees', '/'], ['Releases', '/releases/']]),
  ];
  return layout(site, { path: '/releases/', title, description, graph, main });
}

// ---------------------------------------------------------------- feeds and sitemap

const xml = (s) => escapeHtml(s).replace(/'/g, '&apos;');

function atom({ id, title, subtitle, self, alternate, updated, entries }) {
  return `<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <id>${id}</id>
  <title>${xml(title)}</title>
  <subtitle>${xml(subtitle)}</subtitle>
  <link rel="self" href="${self}"/>
  <link rel="alternate" type="text/html" href="${alternate}"/>
  <updated>${updated}T00:00:00Z</updated>
  <author><name>Blake Burford</name><uri>https://blakeburford.com/</uri></author>
  <icon>${SITE}/img/icon.svg</icon>
${entries.map((e) => `  <entry>
    <id>${e.id}</id>
    <title>${xml(e.title)}</title>
    <link rel="alternate" type="text/html" href="${e.url}"/>
    <published>${e.published}T00:00:00Z</published>
    <updated>${e.updated}T00:00:00Z</updated>
    <summary>${xml(e.summary)}</summary>
    <content type="html">${xml(e.html)}</content>
  </entry>`).join('\n')}
</feed>
`;
}

export function blogFeed(site) {
  return atom({
    id: `${SITE}/blog/`, title: 'Six Degrees blog', subtitle: 'How Six Degrees works, and why.',
    self: `${SITE}/blog/feed.xml`, alternate: `${SITE}/blog/`, updated: site.posts.reduce((m, p) => (p.updated > m ? p.updated : m), '0000'),
    entries: site.posts.map((p) => ({ id: `${SITE}${p.path}`, title: p.title, url: `${SITE}${p.path}`, published: p.date, updated: p.updated, summary: p.description, html: p.html })),
  });
}

export function releaseFeed(site) {
  const full = fullReleases(parseChangelog(site.changelog)).slice(0, 20);
  return atom({
    id: `${SITE}/releases/`, title: 'Six Degrees releases', subtitle: 'What each version added, changed and fixed.',
    self: `${SITE}/releases/feed.xml`, alternate: `${SITE}/releases/`, updated: full[0].date,
    entries: full.map((r) => ({
      id: `${SITE}/releases/#${anchor(r.version)}`, title: `Six Degrees ${r.version}: ${highlights(r).title}`,
      url: `${SITE}/releases/#${anchor(r.version)}`, published: r.date, updated: r.date,
      summary: KINDS.filter((k) => changeCounts(r)[k]).map((k) => `${changeCounts(r)[k]} ${k}`).join(', '),
      html: markdown(scanWording(r.body.trim()), { ids: false }),
    })),
  });
}

/** site/sitemap.xml (the home page, dated by hand at each release) plus every generated page. */
export function sitemap(site, extra) {
  const urls = extra.map(({ path: p, lastmod }) => `  <url>
    <loc>${SITE}${p}</loc>
    <lastmod>${lastmod}</lastmod>
  </url>`).join('\n');
  return site.sitemapXml.replace(/\s*<\/urlset>\s*$/, `\n${urls}\n</urlset>\n`);
}

// ---------------------------------------------------------------- the build

// The screenshots the pages use at 1200px wide as well (srcset "…-1200").
function resize(src, dest) {
  const tries = [['sips', ['-Z', '1200', src, '--out', dest]], ['convert', [src, '-resize', '1200x', dest]]];
  for (const [cmd, args] of tries) {
    try { execFileSync(cmd, args, { stdio: 'ignore' }); return; } catch { /* next */ }
  }
  copyFileSync(src, dest); // no resizer here: the full-size file stands in
}

export function build(root, out, { images = true } = {}) {
  const site = loadSite(root);
  const values = slotValues(site);
  rmSync(out, { recursive: true, force: true });
  mkdirSync(out, { recursive: true });
  cpSync(path.join(root, 'site'), out, {
    recursive: true,
    filter: (src) => { const b = path.basename(src); return !(b.startsWith('_') || (b === 'README.md' && path.dirname(src) === path.join(root, 'site'))); },
  });
  const img = path.join(out, 'img');
  mkdirSync(img, { recursive: true });
  for (const f of ['app-window', 'degrees', 'paths']) copyFileSync(path.join(root, 'docs/img', `${f}.png`), path.join(img, `${f}.png`));
  // The site's own mark (site/img/icon.svg) when it has one; else the app's icon.
  if (!existsSync(path.join(root, 'site/img/icon.svg'))) copyFileSync(path.join(root, 'desktop/icon/icon.svg'), path.join(img, 'icon.svg'));
  if (images) {
    for (const f of ['app-window', 'degrees', 'paths']) resize(path.join(img, `${f}.png`), path.join(img, `${f}-1200.png`));
    const appDir = path.join(img, 'app');
    if (existsSync(appDir)) {
      for (const f of readdirSync(appDir).filter((x) => /\.(jpg|png)$/.test(x) && !/-1200\./.test(x))) {
        resize(path.join(appDir, f), path.join(appDir, f.replace(/\.(\w+)$/, '-1200.$1')));
      }
    }
  }

  const write = (p, html) => {
    const dir = path.join(out, p);
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, p.endsWith('.xml') ? '' : 'index.html'), html);
  };
  const writeFile = (p, text) => { mkdirSync(path.dirname(path.join(out, p)), { recursive: true }); writeFileSync(path.join(out, p), text); };

  writeFileSync(path.join(out, 'index.html'), fill(site.indexHtml, values));
  const full = fullReleases(parseChangelog(site.changelog));
  const lastPost = site.posts.reduce((m, p) => (p.updated > m ? p.updated : m), full[0].date);
  const listed = [];
  for (const page of site.pages) {
    write(page.path, renderPage(site, page, values));
    listed.push({ path: page.path, lastmod: page.updated || full[0].date });
  }
  write('/releases/', renderReleases(site, values));
  listed.push({ path: '/releases/', lastmod: full[0].date });
  write('/blog/', renderBlogIndex(site));
  listed.push({ path: '/blog/', lastmod: lastPost });
  for (const post of site.posts) {
    write(post.path, renderPost(site, post));
    listed.push({ path: post.path, lastmod: post.updated });
  }
  writeFile('blog/feed.xml', blogFeed(site));
  writeFile('releases/feed.xml', releaseFeed(site));
  writeFile('sitemap.xml', sitemap(site, listed));
  return { site, values, pages: ['/', ...listed.map((l) => l.path)] };
}

function main() {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const args = process.argv.slice(2);
  if (args.includes('--home') || args.includes('--check')) {
    const site = loadSite(root);
    const after = fill(site.indexHtml, slotValues(site));
    if (args.includes('--check')) {
      if (after === site.indexHtml) { console.log('  ✓ site/index.html\'s generated parts are current.'); return; }
      console.error('\n  ✗ site/index.html\'s generated parts are out of date. Run: node scripts/build-site.mjs --home\n');
      process.exit(1);
    }
    if (after !== site.indexHtml) writeFileSync(path.join(root, 'site/index.html'), after);
    console.log(`  ✓ site/index.html${after === site.indexHtml ? ' (no change)' : ' refreshed'}.`);
    return;
  }
  const out = path.resolve(args.find((a) => !a.startsWith('--')) || path.join(root, '_site'));
  const { values, pages } = build(root, out, { images: !args.includes('--no-images') });
  const size = (dir) => readdirSync(dir).reduce((n, f) => { const p = path.join(dir, f); const s = statSync(p); return n + (s.isDirectory() ? size(p) : s.size); }, 0);
  console.log(`  ✓ Built ${pages.length} pages into ${path.relative(process.cwd(), out) || out} (${Math.round(size(out) / 1e6)} MB): v${values['latest-version']}, ${values['release-count']} releases, ${values['test-count']} tests.`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (err) {
    console.error(`\n  ✗ ${err.message}\n`);
    process.exit(1);
  }
}
