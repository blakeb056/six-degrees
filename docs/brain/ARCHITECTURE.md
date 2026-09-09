# Architecture

## The shape

```
LinkedIn ──┐
           ├─► scripts/scrape.py ──► HTTP ──┐
CSV export ┘   (Playwright, real Chrome)     │
                                             ▼
                                    Next.js app (127.0.0.1)
                                     app/api/*  →  lib/db.js
                                                       │
                                                       ▼
                                          ~/.six-degrees/six-degrees.sqlite
                                                       │
                                                       ▼
                                   lib/network.js → ForceGraph / ChainView (D3)
```

Next.js 16 App Router, React 19, **plain JavaScript** — no TypeScript, no build step
beyond Next's own. D3 for rendering. Runtime dependencies: `next`, `react`,
`react-dom`, `d3`. That is the whole list, and keeping it that short is deliberate.

## Why local-first

The product is a map of who someone knows. A hosted version means a server holding
many people's professional networks — a breach surface that cannot be justified for a
tool whose entire job could be done on the user's laptop. Local-first is not a
limitation here, it is the feature. See SPEC invariant 1.

## The database adapter — the keystone decision

The app began life on Supabase. Rather than rewrite twelve API routes, `lib/db.js`
implements **the shape of the Supabase client** over `node:sqlite`:

```js
const { data, error } = await db.from('linkedin_connections')
  .select('*').eq('degree', 1).order('power_score', { ascending: false }).limit(50);
```

Every route changed exactly one line: the import. Five behaviors are load-bearing —
they are documented in the file itself, and the most dangerous is that **the builder
mutates and returns `this`**, because at least one call site applies a filter without
reassigning the result. An immutable builder would silently drop it. TRAPS §1.

`{ data, error }` rather than throwing is the same story: the routes are written to
check `error`, not to catch.

## Why `node:sqlite`

Built into Node ≥22.13. The obvious alternative, `better-sqlite3`, is a native module
whose prebuild fails on some machines and turns a first run into a compiler error — the
worst possible first impression for a tool whose pitch is "run one command." A hard
Node-version floor is a better failure than a silent native one, and `bin/six-degrees.mjs`
checks it up front with a readable message.

## Trust boundary

The app trusts the machine it runs on and nothing else.

- **Bind:** `127.0.0.1`. Not a firewall rule — the socket is never exposed.
- **The gate** (`lib/gate.js`) keys off `SIX_DEGREES_BIND`, the server's own bind
  address, because **no request header can prove where a request came from.**
- **Cross-site writes** are refused across all of `/api` using `Sec-Fetch-Site`, an
  unforgeable browser-set header, falling back to `Origin`. A request with no browser
  headers at all is not a browser (curl, the scraper) and is allowed through — the
  loopback bind is what protects it.

Why this matters: a cross-origin `POST` with a simple content type reaches the handler
**with no preflight**. Refusing the *response* is too late; the work has already run.

## Packaging

`output: 'standalone'` plus an npm `bin` and a `files` allowlist, so `npx six-degrees`
works with no global install. `scripts/prepare-standalone.mjs` copies `.next/static`
and `public/` into the standalone output as the last step of `build` — not as
`prepack`, which re-runs the build and wipes it. TRAPS §8.
