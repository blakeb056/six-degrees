# App-Based LinkedIn Guides Implementation Plan

> For agentic workers: use executing-plans inline. Blake approved immediate publication; no further topic gate.

**Goal:** Publish three useful guides tied to current Sixgree capabilities and LinkedIn search intent.

**Architecture:** Three Markdown posts through the existing static builder; no app changes. Existing canonical/article/feed/sitemap generation is reused. Update llms links and the focused regression test.

**Tech Stack:** Markdown, Node built-in tests and static HTML builder, GitHub Pages.

- [ ] Create `site/_posts/linkedin-connections-at-company.md`, `linkedin-warm-introduction.md`, `linkedin-network-job-search.md`. Topics: company search and observed routes; introduction preparation and original message templates; an actionable network-audit worksheet. Check against current Paths/Separation and official LinkedIn help. Dates October 5, 2026.
- [ ] Extend `tests/blog-guides.test.mjs` to assert all five October 5 posts' metadata, heading hierarchy, image/link targets and blog/feed/sitemap/llms discovery. Assert homepage links to the first three returned by `loadSite(root).posts`, not every post forever.
- [ ] Run `node --test tests/blog-guides.test.mjs tests/site-news.test.mjs tests/site-version.test.mjs`, `node scripts/check-site-version.mjs`, `git diff --check` and an image-enabled build into a fresh temp directory; read rendered excerpts and confirm the three topics are distinct.
- [ ] Commit as Blake Burford, push and create/attach a PR. Wait for full CI before merging. Verify Website success, live HTTP 200 and article/discovery metadata, then send IndexNow.
- [ ] Update the existing October 5 brain log, project heartbeat and TODAY; relay completion to neo. No new publishing schedule, paid SEO API or app mutation.
