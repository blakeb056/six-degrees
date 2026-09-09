# Six Degrees — context for Claude

**The brain for this project lives in [`docs/brain/`](docs/brain/00-START-HERE.md).**
Start there. This file is a pointer, not a second copy — per the house rule that a note
kept in two places is a note that is silently wrong in one of them within a week.

| You want | Read |
|---|---|
| The six non-negotiables, then a router | [`docs/brain/00-START-HERE.md`](docs/brain/00-START-HERE.md) |
| What must stay true, and what was rejected on purpose | [`docs/SIX-DEGREES-SPEC.md`](docs/SIX-DEGREES-SPEC.md) |
| Every bug that cost real time | [`docs/brain/TRAPS.md`](docs/brain/TRAPS.md) |
| To pick this up cold | [`docs/brain/HANDOFF.md`](docs/brain/HANDOFF.md) |
| What is shipped and what is not | [`docs/brain/PHASES.md`](docs/brain/PHASES.md) |

## The one-line state

Phases 0–5 done. **The scraper is fixed and verified live** — a full walk completes end
to end from a cold, logged-out start. The remaining unverified surface is **bridge and
company scans**, which still carry the two bugs that broke the main scrape
(TRAPS §5, §6) and have not been run since. `npm publish` has not been run.

## Before you change anything

1. `lib/db.js` mutates and returns `this`. TRAPS §1.
2. Locality is proven by the bind address, never a header. TRAPS §2.
3. Never key on a LinkedIn CSS class. TRAPS §5.
4. A scraper that cannot read its page must say so, never report zero. TRAPS §7.
5. The scoring model exists twice — change both copies together. SCORING.md.
6. Never commit real network data. CI enforces it.
