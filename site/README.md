# The website

The source of https://sixgree.com/. `scripts/build-site.mjs` builds it into a
folder, and `.github/workflows/pages.yml` runs that build and publishes the folder
on every push to `main` that touches the site, the changelog, the tests or the
sample network. There are no dependencies: plain HTML, one stylesheet, one script,
and a Node script that puts them together.

## Preview it

```bash
node scripts/build-site.mjs /tmp/sd-site
python3 -m http.server 8765 --bind 127.0.0.1 --directory /tmp/sd-site
```

Then open http://127.0.0.1:8765/. The build copies in the README's screenshots
and the app icon, and makes 1200px copies of the screenshots with `sips` (Mac) or
ImageMagick's `convert` (Linux); without either it uses the full-size files.

## What's where

| Path | What it is |
|---|---|
| `index.html` | The home page, written by hand. Its `<!-- gen:NAME -->…<!-- /gen:NAME -->` slots are filled by the build: the header and footer, the version badge, the numbers, the sample-network charts, the latest releases and posts. Never edit between the markers. |
| `_partials/header.html`, `footer.html` | The top bar and footer on every page. |
| `_partials/downloads.html` | The three download cards on `/download/`. |
| `_pages/<name>.html` | `/download/`, `/docs/`, `/roadmap/`, `/about/`: the inside of `<main>`, with a front-matter comment on top (`title`, `description`, `path`, `type`, `updated`, and `faq: true` to publish the page's `<dt>`/`<dd>` questions as FAQPage data). Pages can use the same `gen:` slots. |
| `_posts/<slug>.md` | Blog posts, one Markdown file each, published at `/blog/<slug>/`. |
| `img/app/` | Screenshots of the app running the invented sample network, for the home page and posts. |
| `style.css`, `app.js` | Every page's styles and script. `index.html` asks for them by version (`?v=…`) and the build uses the same version on every page: bump it when either changes. |
| `sitemap.xml` | The home page's entry, dated by hand at each release (`scripts/check-site-version.mjs` checks it). The build adds every other page. |
| `llms.txt`, `robots.txt`, the IndexNow key | Served as they are. |

Anything whose name starts with `_`, and this file, is never published.

The build also writes `/releases/` (every version in `CHANGELOG.md`, with an anchor
per version, `#v0.4.7`), `/blog/`, and Atom feeds at `/blog/feed.xml` and
`/releases/feed.xml`.

## Add a blog post

Make `site/_posts/<slug>.md`. The file name is the address, so keep it short and
lower-case with hyphens:

```markdown
---
title: A clear title, in sentence case
description: One or two sentences for search results and the blog's list.
date: 2026-10-01
tags: [scanning, privacy]
image: /img/app/separation.jpg
---

The post, in Markdown. ## and ### headings, lists, **bold**, *italic*, `code`,
[links](/download/), > quotes, tables, and images on a line of their own:

![What the picture shows](/img/app/lab-clusters.jpg "An optional caption.")
```

`title`, `description` and `date` are required; `updated` (a later date), `tags` and
`image` (the picture shared on social media) are optional. Raw HTML is escaped, so
write Markdown. The build adds the post to `/blog/`, the home page's "From the blog",
the feed and the sitemap. Before you commit, build and read it in the preview.

The rules for anything on the site: say "scanning", never "scraping"; name only
people from the invented sample network, never real ones; and keep numbers to what
anyone can check.

## Add a page

Make `site/_pages/<name>.html` with a front-matter comment, then link it from
`_partials/header.html` or `footer.html`:

```html
<!--
title: The page's title, for search results
description: One or two sentences.
path: /name/
type: WebPage
updated: 2026-10-01
-->
    <header class="page-hero">
      <p class="kicker">Name</p>
      <h1>The headline</h1>
      <p class="lede">A sentence or two.</p>
    </header>
```

## Downloads that are coming soon

The Linux and Windows download buttons are dimmed "Coming soon" buttons, not
links. `DOWNLOADS` at the top of `app.js` turns one on: put the file's address
there, and every Coming soon button for that platform becomes a real download. At
the same time, update the Windows question in `_pages/docs.html`, the JSON-LD's
`operatingSystem` in `index.html`, `llms.txt`, and the download cards' notes.

## At a release

The release checklist is in `docs/SEO.md`: bump the version lines, and
`node scripts/check-site-version.mjs` checks them. The news, the version badge and
the numbers need nothing: the build takes them from `CHANGELOG.md` when it
publishes. `node scripts/build-site.mjs --home` refreshes the committed copy of
`index.html` if you want the repository to match (`--check` says whether it does).
