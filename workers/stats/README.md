# sixgree.com stats (Worker + D1)

`stats.sixgree.com`: sixgree.com's own visit and download-click counter. No cookies, no IP addresses stored,
robots and Do Not Track / Global Privacy Control excluded. The app itself still has no telemetry.

- **Code:** `index.js` (the Worker), `schema.sql` (the D1 tables), tests in `tests/site-stats-worker.test.mjs`.
- **Cloudflare:** account `Burfordblake056@gmail.com's Account`, Worker `sixgree-stats`, D1 `sixgree-stats`
  (`6e73ec8a-f723-4e31-a291-c821aaad2740`), custom domain `stats.sixgree.com` on the sixgree.com zone.
  Bindings: `DB` (D1) and `SALT` (secret text, random, never in the repo).
- **Sent by:** `site/app.js` §9, one CORS `fetch` (keepalive) per page view and per download click. Not
  `sendBeacon`: under the site's `no-referrer` policy a beacon's Origin is `null` and the counter drops it. The site's CSP
  allows it in `connect-src` (`scripts/build-site.mjs`, `site/index.html`).
- **Read it:** `node scripts/site-stats.mjs [days]`, or open https://stats.sixgree.com/stats?days=28 (public JSON,
  totals only).
- **Deploy a change:** upload `index.js` as a module through the Cloudflare API
  (`PUT /accounts/{account}/workers/scripts/sixgree-stats`, multipart, metadata with the `DB` binding and
  `keep_bindings: ["secret_text"]` so the salt survives). Read the body before answering a request: once the
  response has gone, Cloudflare has closed it (the first deploy counted nothing).
