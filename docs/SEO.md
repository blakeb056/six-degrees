# Search presence: how sixdegreesapp.com is found

Last checked: 2026-09-29. The site is `site/`, built by `scripts/build-site.mjs` ([site/README.md](../site/README.md)) and published by `.github/workflows/pages.yml` to GitHub Pages under the custom domain **sixdegreesapp.com** (DNS at Cloudflare; HTTPS enforced; the old `blakeb056.github.io/six-degrees/` address redirects). The cross-site map and checklist lives in Blake Brain: "Search Presence — blakeburford.com and sixdegreesapp.com".

## What is in place

| Piece | Where | Notes |
|---|---|---|
| Title, description, canonical, robots meta | `site/index.html` head | Canonical is the apex URL with a trailing slash. |
| Open Graph + Twitter card | `site/index.html` head, `site/img/og-image.jpg` (1200×810 JPEG from the home page's `site/img/app/hero.jpg`) | Regenerate when the hero changes: `sips -c 1601 2371 site/img/app/hero.jpg --out /tmp/og.jpg && sips -Z 1200 -s format jpeg -s formatOptions 82 /tmp/og.jpg --out site/img/og-image.jpg`. |
| Apple touch icon | `site/apple-touch-icon.png` (180 px from `desktop/icon/icon.svg`) | Regenerate with `qlmanage -t -s 180 -o . desktop/icon/icon.svg`. |
| Structured data (JSON-LD, one `@graph`) | `site/index.html` head | `SoftwareApplication` (free, macOS/Linux, version, download URL, screenshots, features), `SoftwareSourceCode`, `WebSite`, the author `Person` (same `@id` as blakeburford.com). The `FAQPage` is on `/docs/`, beside the questions it mirrors. **Bump `softwareVersion` and `dateModified` with each release.** The page's CSP does not affect JSON-LD (it is data, not executed script). |
| Pages | `/` (`site/index.html`), `/download/`, `/docs/`, `/roadmap/`, `/about/` (`site/_pages/`), `/releases/` (from `CHANGELOG.md`), `/blog/` and `/blog/<slug>/` (`site/_posts/`) | Each has its own `<title>`, description, canonical URL, Open Graph and Twitter tags, and JSON-LD: `SoftwareApplication` and friends on the home page, `BlogPosting` on each post, `Blog`, `CollectionPage`, `AboutPage` or `WebPage` elsewhere, with a `BreadcrumbList`. |
| Generated parts of the home page: the header and footer, the version badge, the numbers, the sample charts, the latest releases and posts | `site/index.html`, between `<!-- gen:NAME -->` and `<!-- /gen:NAME -->` | Filled by `scripts/build-site.mjs` from `CHANGELOG.md`, `tests/*.test.mjs`, `public/demo-data.json` and `site/_posts/`. `pages.yml` runs the build, so the live site never lags the changelog; `node scripts/build-site.mjs --home` refreshes the committed copy. Never edit between the markers by hand. |
| Feeds | `/blog/feed.xml`, `/releases/feed.xml` (Atom) | Linked from every page's head and footer. |
| Coming-soon downloads (Linux app, Windows) | `site/app.js`, `DOWNLOADS` at the top | Dimmed buttons, not links, until a file's address goes in there: one line per platform. When one goes live, also update the Windows question on `/docs/`, `operatingSystem` in the JSON-LD, `llms.txt` and the download cards' notes. |
| FAQ section | `site/_pages/docs.html`, section `#faq` | Eight direct answers (free? uploads? Windows? the macOS warning, LinkedIn's rules, what you need, what "six degrees" means, how a score is worked out). The build turns the page's `<dt>`/`<dd>` pairs into its `FAQPage` data (`faq: true`), so the two can't drift. AI answer engines extract these; keep answers 40–60 words and true. |
| robots.txt | `site/robots.txt` | Allows everyone; names the AI bots explicitly; points at the sitemap. |
| sitemap.xml | `site/sitemap.xml` | The home page and its screenshots, as image entries. **Bump `lastmod` with each release.** The build adds every other page, dated from its `updated:` or the release it describes. |
| llms.txt | `site/llms.txt` | Plain-text facts for AI assistants. Update the version line with each release. |
| IndexNow key | `site/04c6ce58b0a82a84e22ac315ff56dc03.txt` | Lets Bing/Yandex/Naver (and ChatGPT search, which uses Bing) be pinged the moment the page changes: `curl "https://api.indexnow.org/indexnow?url=https://sixdegreesapp.com/&key=04c6ce58b0a82a84e22ac315ff56dc03"`. |
| Repo + npm | `README.md`, `package.json` `homepage`, repo About link | All point at https://sixdegreesapp.com/. |

## Release checklist (search side)

1. `site/index.html`: `softwareVersion`, `dateModified` in the JSON-LD; the "New in" copy.
   News, the version badge and the numbers are not on this list: `pages.yml` generates them
   from `CHANGELOG.md` when it publishes.
2. `site/sitemap.xml`: `lastmod`. `site/llms.txt`: the version line.

   `node scripts/check-site-version.mjs` checks 1 and 2 (all but the "New in" copy) against
   `package.json` and the release's date in `CHANGELOG.md`. `release.yml` runs it before
   building, and a full release whose site doesn't match stops there.
3. After the Pages deploy: ping IndexNow (command above) and, in Google Search Console, URL inspection → Request indexing for https://sixdegreesapp.com/.

## How to verify

- `curl -s https://sixdegreesapp.com/robots.txt`, `.../sitemap.xml`, `.../llms.txt`, `.../04c6ce58b0a82a84e22ac315ff56dc03.txt`.
- https://validator.schema.org/ and https://search.google.com/test/rich-results with the page URL: zero errors.
- Google Search Console (domain property sixdegreesapp.com): sitemap "Success"; the URL is on Google. Bing Webmaster Tools: sitemap submitted.
- Share the URL in iMessage or LinkedIn: the preview shows `og-image.jpg`.
