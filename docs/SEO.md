# Search presence: how sixdegreesapp.com is found

Last checked: 2026-09-29. The download site is `site/`, published by `.github/workflows/pages.yml` to GitHub Pages under the custom domain **sixdegreesapp.com** (DNS at Cloudflare; HTTPS enforced; the old `blakeb056.github.io/six-degrees/` address redirects). The cross-site map and checklist lives in Blake Brain: "Search Presence — blakeburford.com and sixdegreesapp.com".

## What is in place

| Piece | Where | Notes |
|---|---|---|
| Title, description, canonical, robots meta | `site/index.html` head | Canonical is the apex URL with a trailing slash. |
| Open Graph + Twitter card | `site/index.html` head, `site/img/og-image.jpg` (1200×810 JPEG from `docs/img/app-window.png`) | Regenerate with `sips -Z 1200 -s format jpeg -s formatOptions 82 docs/img/app-window.png --out site/img/og-image.jpg` when the screenshot changes. |
| Apple touch icon | `site/apple-touch-icon.png` (180 px from `desktop/icon/icon.svg`) | Regenerate with `qlmanage -t -s 180 -o . desktop/icon/icon.svg`. |
| Structured data (JSON-LD, one `@graph`) | `site/index.html` head | `SoftwareApplication` (free, macOS/Linux, version, download URL, screenshots, features), `SoftwareSourceCode`, `WebSite`, the author `Person` (same `@id` as blakeburford.com), `FAQPage` mirroring the visible "Questions people ask" section. **Bump `softwareVersion` and `dateModified` with each release.** The page's CSP does not affect JSON-LD (it is data, not executed script). |
| Generated parts: News, the numbers strip, the version badge, the sample-network charts | `site/index.html`, between `<!-- gen:NAME -->` and `<!-- /gen:NAME -->` | Filled by `scripts/build-site-news.mjs` from `CHANGELOG.md` (releases, dates, what each changed), `tests/*.test.mjs` (the test count) and `public/demo-data.json` (the sample). `pages.yml` runs it on the copy it publishes, so the live site never lags the changelog; run it locally (`node scripts/build-site-news.mjs`) to refresh the committed copy, or `--check` to see whether it's current. Never edit between the markers by hand. |
| Coming-soon downloads (Linux app, Windows) | `site/app.js`, `DOWNLOADS` at the top | Dimmed buttons, not links, until a file's address goes in there: one line per platform. When one goes live, also update the FAQ (page and JSON-LD), `operatingSystem` in the JSON-LD, `llms.txt` and the Download section's intro. |
| FAQ section | `site/index.html`, section `#faq`; styles in `site/style.css` (`.faq`) | Seven direct answers (free? uploads? Windows? the macOS warning, LinkedIn's rules, what you need, what "six degrees" means). AI answer engines extract these; keep answers 40–60 words and true. |
| robots.txt | `site/robots.txt` | Allows everyone; names the AI bots explicitly; points at the sitemap. |
| sitemap.xml | `site/sitemap.xml` | One URL plus the three screenshots as image entries. **Bump `lastmod` with each release.** |
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
