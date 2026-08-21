# Contributing

Thanks for taking a look. This is a small research project, so the bar is
"does it work and is it honest," not ceremony.

## Ground rule that matters most

**Never commit real network data.** No exported CSVs, no `public/avatars/`, no
`demo-data.json` built from a real account, no screenshots of real people, no
credentials. These describe identifiable individuals who did not opt in. CI
enforces this, but please don't rely on CI to catch it.

When filing an issue, redact names before attaching anything.

## Setup

```bash
nvm use          # Node 22, from .nvmrc
npm install
npm run dev      # http://localhost:3000
```

Copy `.env.example` to `.env.local` and fill in what you need. The app runs
without any credentials if you use the CSV import path.

## Before opening a PR

```bash
npm run lint
npm run build
```

Keep changes focused. Match the surrounding style rather than reformatting:
this codebase is plain JavaScript with inline style objects, and consistency
beats personal preference.

## Commit messages

Explain **why**, not just what. A one-line subject, then a body if the change
isn't self-evident.

## Scope

Bug fixes, accessibility, performance, and documentation are always welcome.
Before building a large feature, open an issue first — the project has a
deliberate shape and not every idea fits it.

## A note on scraping

Anything that automates LinkedIn carries Terms-of-Service risk for the person
running it. Contributions that make scraping more aggressive, add credential
handling, or work around LinkedIn's protections will be declined. The official
CSV export is the supported path.
