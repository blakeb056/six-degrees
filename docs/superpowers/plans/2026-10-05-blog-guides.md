# Sixgree Blog Guides Implementation Plan

> For agentic workers: execute inline using executing-plans; Blake already approved publication and inline execution.

**Goal:** Publish two accurate, useful search-focused guides dated October 5, 2026.

**Architecture:** Add two Markdown files to the existing static website. Its builder supplies article markup, author, canonicals, feed, sitemap and home-page links. No application code or stylesheet changes.

**Tech Stack:** Markdown, Node's built-in test runner, existing HTML builder, GitHub Pages.

## Tasks

- [ ] Create `site/_posts/linkedin-network-csv.md` and `site/_posts/linkedin-connection-degrees.md` following the approved design. Cross-check current `app/import/page.js`, `lib/csv.js`, site docs and official LinkedIn help. Review clarity, voice and proof with copy-editing.
- [ ] Add `tests/blog-guides.test.mjs`: build into a fresh OS temp folder without image resizing, assert both posts' canonical/title/description/date/BlogPosting, one H1, internal link targets, images, and membership in blog index, Atom feed, sitemap and homepage; ensure sources are excluded from deployment.
- [ ] Run `node --test tests/blog-guides.test.mjs tests/site-news.test.mjs tests/site-version.test.mjs`. Run a full image-enabled build into a fresh temp folder and inspect rendered posts. Do not hand-edit generated homepage slots.
- [ ] Commit source as Blake Burford, push the branch, create/attach a PR, merge only after checks pass, and verify Website deployment success and both live article bodies plus metadata/discovery files.
- [ ] Record result and next action in the project brain and relay to neo. No manual vault commit or push.
