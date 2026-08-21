<h1 align="center">6 Degrees</h1>

<p align="center">
  <em>Map your professional network as a galaxy — see who bridges you to everyone else,<br />
  and find the shortest path to someone you haven't met.</em>
</p>

<p align="center">
  <a href="https://github.com/blakeb056/six-degrees-app/actions/workflows/ci.yml"><img src="https://github.com/blakeb056/six-degrees-app/actions/workflows/ci.yml/badge.svg" alt="CI"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-yellow.svg" alt="MIT License"></a>
  <img src="https://img.shields.io/badge/node-%3E%3D22.13-brightgreen.svg" alt="Node >= 22.13">
  <img src="https://img.shields.io/badge/data-stays%20local-blue.svg" alt="Data stays local">
</p>

---

Your network has a shape, and you can't see it. 6 Degrees draws it: every
connection placed on a tier ring by estimated career leverage, the handful of
people whose own circles open the most doors, and the shortest chain from you
to a stranger worth meeting.

It runs on your machine, against your own data, with no account and no server.

## Quickstart

```bash
git clone https://github.com/blakeb056/six-degrees-app
cd six-degrees-app
npm install
npm run dev
```

Open <http://localhost:3000>. Choose **Map your own network**, drop in
LinkedIn's official `Connections.csv`, and your galaxy renders.

No account, no API keys, no database to provision. Your data is written to a
single SQLite file at `~/.six-degrees/six-degrees.sqlite`, and the four
runtime dependencies are `next`, `react`, `react-dom` and `d3` — the database
driver is Node's own built-in `node:sqlite`. Requires **Node 22.13+**.

## Use your own network

### The safe path: LinkedIn's official export

1. LinkedIn → **Settings & Privacy → Data privacy → Get a copy of your data**
2. Select **Connections** and request the archive
3. LinkedIn emails a download link, usually within ~10 minutes
4. Unzip it and drop `Connections.csv` into the app's **Import** page

The file is parsed **in your browser**. Nothing is uploaded, nothing is stored,
and the `Email Address` column is never read. Close the tab and it's gone.

Two honest limits of the official export: it contains **no profile photos**, so
people render as initials on a tier-colored circle; and it covers only people
you are *already* connected to, so the Bridges and Outlink views stay empty —
those map the people you haven't met yet.

### The deeper path: the local scraper

`scripts/scrape.py` drives **your own installed Chrome** with a persistent
profile — you log in by hand, once. It captures 2nd-degree circles and
permanent local avatars. See [`docs/SCRAPING.md`](docs/SCRAPING.md).

> [!WARNING]
> Automating LinkedIn may violate its [User Agreement](https://www.linkedin.com/legal/user-agreement),
> and accounts have been restricted for it. This is provided for local use
> against your own account, at your own risk. It never asks for or stores your
> credentials. **The CSV export above is the supported path.**

## What it does

- **Galaxy** — a force-directed map of your network, sized and colored by power score
- **Bridges** — your highest-leverage connections on a rotary dial; select one to fan out their circle
- **Paths** — company intelligence: who you know at each company, and who's still out of reach
- **Outlink** — a ranked outreach queue built from 2nd-degree recommendations
- **Tiers** — every person scored S/A/B/C/D from role seniority and company prestige

## How scoring works

```
power score = (seniority × 0.5) + (company prestige × 0.3) + signals + recency
tiers:  S ≥ 7.0   A ≥ 5.5   B ≥ 4.0   C ≥ 2.5   D < 2.5
```

Seniority is inferred from job title, prestige from a configurable company list,
signals from headline keywords, and recency gives a small bonus to connections
made in the last 30 days. The reference implementation is
[`scripts/score_new_connections.sql`](scripts/score_new_connections.sql) — every
other scorer in the codebase is diffed against it.

It estimates **network reach**, not human worth. Keep that framing.

## Privacy

- A CSV import never leaves your browser and is never persisted
- Scraped data and avatars are written locally and are gitignored
- No telemetry, no analytics, no crash reporting, no update check
- The only outbound requests are to LinkedIn, and only while you are scraping

See [SECURITY.md](SECURITY.md) for the threat model.

## Configuration

There is nothing to configure. Two optional environment variables exist:

| Variable | Purpose |
|---|---|
| `SIX_DEGREES_HOME` | Where the database and avatars live. Defaults to `~/.six-degrees`. |
| `ADMIN_TOKEN` | Only needed if you expose the app beyond localhost. The four destructive routes are open on your own machine and require this bearer token from any other host. |

## How your data is stored

```
~/.six-degrees/
├── six-degrees.sqlite      your network — connections, scores, tiers, queue
└── avatars/                profile photos, if you run the scraper
```

To remove everything this app created, delete that folder. Nothing is written
anywhere else, and nothing is sent anywhere.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). The one rule that matters: **never
commit real network data** — no exported CSVs, no avatars, no screenshots of
real people. CI fails the build if they appear.

## License

MIT © Blake Burford — see [LICENSE](LICENSE).
