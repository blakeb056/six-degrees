# sixgree.com stats (Worker + D1)

`stats.sixgree.com`: sixgree.com's own visit and download-click counter. No cookies, no IP addresses stored,
robots and Do Not Track / Global Privacy Control excluded. The app itself still has no telemetry, and nothing
in the app may ever call this counter (SIX-DEGREES-SPEC invariant 2).

- **Code:** `index.js` (the Worker), `schema.sql` (the D1 tables), tests in `tests/site-stats-worker.test.mjs`.
- **Cloudflare:** account `fe1d2a61e7f2b551625ab998c978201f`, Worker `sixgree-stats`, D1 `sixgree-stats`
  (`6e73ec8a-f723-4e31-a291-c821aaad2740`), custom domain `stats.sixgree.com` on the sixgree.com zone.
  Bindings: `DB` (D1) and `SALT` (secret text, random, never in the repo). Cron trigger `5 0 * * *`
  (00:05 UTC daily) deletes every visitor hash from before today. Workers Logs on for the Worker's own
  error lines only (`console.error`, kept 3 days free / 7 paid): **invocation logs are off**, because they
  would keep every request's headers, the visitor's IP address included, for days.
- **What is kept:** per day, views per page, the referring site's host name, the country, and download
  clicks per platform; and each day's count of unique visitors. Unique visitors are told apart by a
  one-way hash of salt, day, IP and browser, kept only for the day: the first view after midnight UTC
  deletes every earlier hash, and the cron does it on a day nobody visits. `/stats` shows
  `oldestVisitorHash`, so anyone can check. D1's Time Travel can still restore the database as it was in
  recent days (7 on the free plan, 30 on paid), hashes included; they are salted with the secret, which D1
  never holds, and the public wording says backups keep them up to 30 days.
- **Sent by:** `site/app.js` §9, one CORS `fetch` (keepalive) per page view and per download click. Not
  `sendBeacon`: a beacon is a no-cors POST, and under the site's `no-referrer` policy Firefox and Safari send
  it with `Origin: null`, which the counter drops (Chrome keeps the origin). In cors mode every browser
  sends the origin (TRAPS §50). The site's CSP allows it in `connect-src` (`scripts/build-site.mjs`,
  `site/index.html`).
- **Read it:** `node scripts/site-stats.mjs [days]`, or open https://stats.sixgree.com/stats?days=28. Public
  JSON: the totals and the top 25 pages, referring sites and countries.
- **Deploy a change**, in this order, and **before** merging any site change whose wording depends on it
  (the site deploys itself on merge; the Worker doesn't):
  1. Run `schema.sql` against the D1 database (it only adds what's missing). The new code must never
     reach a table that isn't there: a D1 batch is one transaction, so the whole view is lost.
  2. Upload `index.js` as a module through the Cloudflare API
     (`PUT /accounts/{account}/workers/scripts/sixgree-stats`, multipart, metadata with the `DB` binding,
     `keep_bindings: ["secret_text"]` so the salt survives, and
     `observability: {enabled: true, logs: {enabled: true, invocation_logs: false}}`).
  3. Set the schedule, `PUT /accounts/{account}/workers/scripts/sixgree-stats/schedules` with
     `[{"cron": "5 0 * * *"}]`, then read it back (`GET` the same path) and check it lists `5 0 * * *`.
     After every deploy.
  4. Run `schema.sql` again: it raises any day's count to its hashes, in case the old code stored some
     between steps 1 and 2.
  5. Prove the pipe: one POST to `/e` with `origin: https://sixgree.com` and a browser's User-Agent, check
     `/stats`, then delete that row (TRAPS §50).

  Read the body before answering a request: once the response has gone, Cloudflare has closed it (the
  first deploy counted nothing).
