# Start here

The router for anyone — human or agent — changing this codebase.

**The product is called Sixgree (sixgree.com); it was Six Degrees until 1.0.0.** Only what
people see was renamed. These stay "Six Degrees"/"six-degrees" for good, because installs
depend on them: the bundle id `com.blakeburford.sixdegrees` and Windows AppUserModelID, the
Inno Setup AppId, the file names `Six Degrees.app` / `Six Degrees.exe` and their install
folders, Electron's settings folder (pinned in `desktop/main.mjs`), `~/.six-degrees` and every
`SIX_DEGREES_*` variable, `.sixdegrees` backups, `six-degrees-*` storage keys, the GitHub
repo `blakeb056/six-degrees`, `release.yml`'s file name, and every Mac DMG being published
under its old `Six-Degrees-<v>-<chip>.dmg` name too (1.0.0's updater asks for that).
`tests/sixgree-rename.test.mjs` holds those bridges. Brain notes below still say
"Six Degrees" in places: same product.

## The non-negotiables

Six rules, each learned expensively. If a change violates one, the change is wrong.

1. **Locality is proven by the bind address, never by a header.** `Host`,
   `X-Forwarded-For`, `Origin` — a client sets all of them. This was found by attack,
   not review: from another machine on the LAN with a spoofed `Host`, a destructive
   route reached its handler. TRAPS §2.
2. **`lib/db.js` mutates and returns `this`.** Call sites depend on it. An "obvious"
   refactor to an immutable builder silently drops filters with no error and no failing
   test. TRAPS §1.
3. **Never key on a LinkedIn CSS class.** They are hashed per deploy (`_8e33b2ac`,
   `c313cecd`). Anchor on the profile link. TRAPS §5.
4. **A scraper that cannot read its page must say so, never report zero.** A swallowed
   error that becomes "0 connections" is indistinguishable from an empty network and
   hides real bugs for months. TRAPS §7.
5. **The scoring model exists once**: `lib/scoring.js`. Everything scores through it
   (import, CSV, Paths). Never transcribe it anywhere else; three copies that disagreed
   is what 0.1.10 cleaned up. [`SCORING.md`](SCORING.md).
6. **Never commit real network data.** CI enforces it; do not route around the guard.

## Where to go next

- Changing the UI or a route → [`MAP.md`](MAP.md), then [`ENDPOINTS.md`](ENDPOINTS.md)
- Changing how data is stored → [`SCHEMA.md`](SCHEMA.md) and [`ARCHITECTURE.md`](ARCHITECTURE.md)
- Changing scoring or tiers → [`SCORING.md`](SCORING.md)
- Touching the scanner → [`SCRAPER.md`](SCRAPER.md), and **read [`TRAPS.md`](TRAPS.md) first**
- Packaging, the desktop app, Windows → [`DESKTOP.md`](DESKTOP.md): the plan, its phases,
  and the rules that protect the working version
- Deciding whether something is allowed at all → [`../SIX-DEGREES-SPEC.md`](../SIX-DEGREES-SPEC.md)
- Picking this up cold → [`HANDOFF.md`](HANDOFF.md)
- What stands between this and a public launch → [`PHASES.md`](PHASES.md), the Phase 6 checklist

## Running it

```bash
npm run dev      # never returns a prompt; it is the server
```

Then open **Scan** (`/setup`) and use the buttons — the app spawns the scraper
itself through `/api/scraper`. The command line still works and is what you want
when scripting, but it needs the app running in another window, because the
scraper writes **through the app's HTTP API**, never into SQLite directly:

```bash
python3 scripts/scrape.py --full   # second window, app still up
```
