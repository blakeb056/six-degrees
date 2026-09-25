# Scoring

How a headline becomes a power score and a tier. **One implementation:
`lib/scoring.js`**, whose header explains the model, with `tests/scoring.test.mjs`
pinning it down. Everything scores through it:

| Caller | When |
|---|---|
| `lib/rpc.js` `rescoreAll()` | After every import (`score_new_connections`), when a company score changes, when *Your sector* changes in Settings, and once on the first load after the stored scores go stale (`SCORING_VERSION` or the sector focus they were computed with no longer matches; both stamped in `app_meta`) |
| `lib/csv.js` `scoreRecord()` | CSV imports, in the browser, from the export's bare position and company |
| `lib/companies.js` | Paths reads titles, companies and each company's industry through the same functions, so Paths and the score never disagree |
| `lib/sector-focus.js` `previewSectorFocus()` | Settings → Your sector, before saving: scores the network twice in memory (saved focus, new focus) and counts what moves. Writes nothing |

Until 0.1.10 there were three scorers that disagreed. `scripts/*.sql` are the retired
hosted-era model, kept for history and marked as such. Do not transcribe the model
anywhere else again.

## The formula

```
power = title × (0.45 + 0.055 × company) + reach bonus + bridge boost

tiers   S ≥ 7.5    A ≥ 5.5    B ≥ 4.0    C ≥ 2.5    D < 2.5
```

It's a **product, not a sum**: a title is worth more at a bigger company, and a big
company is worth more the higher someone sits in it. A VP at a company scored 10 gets 9.0,
a founder at an unknown company 6.7, a director at an unknown company 5.0, and an intern
at a 10 gets 2.0. The old sum let an intern at a famous company tie with a director
somewhere unknown.

**Title (0–10)** comes from the person's roles, read part by part from the headline.
Former ("Ex-", "Former") roles count at 70%, and the person scores as their strongest
role. Current students are capped at 3. Rules that earlier words mask:

- "Vice President" is not "President".
- "Chief of Staff" is not a chief, and "to the CEO" is not a CEO.
- "Product Owner" is not an owner.
- A fraternity chair is not a chairman.
- "International" is not "intern".

**Company (1–10)** comes, in order, from the score you set (Paths → Scores, table
`company_scores`), then the curated `KNOWN_COMPANIES` list (164 companies). Otherwise it's
an estimate from how many of your people work there: 5 at 5+, 6 at 15+, but never for
schools (a company whose one industry, below, is education). Unknown is 4, and no company
found is 3, so the company weight runs from 0.615 (no company) to 1.0; 0.505 is the floor,
for a company you score 1. Names are cleaned first, so "Snap Inc.", "Snapchat 👻" and
"Snap" are one company. Phrases like "at scale" are not companies. If you picked sectors
in Settings, a company in one of them gets +1 or +2 on top (below).

**Reach bonus (≤1.5)** needs whole-word signals: investor, YC, 30 under 30, an audience or
revenue in the millions, keynote/TEDx/patents/awards. It's halved for someone at a company
scored 4 or less, because headlines are self-written.

**Bridge boost (≤1)** goes to a 1st-degree person whose mapped circle (20+ people) is
unusually strong: `(share at A or S − 0.12) × 5`, capped. It's recomputed each time and
never ratchets.

The person panel shows the working as `score_why`, e.g.
"VP / Partner / GM (9) · Snap (9/10) · +0.7 strong circle", or with a sector lean
"Director / Head (7.5) · Snap (10/10: 9 + 1 your sector)".

## One industry per company

Industry is inferred (`lib/companies.js` `INDUSTRIES`, regexes over names and headlines),
but each **company** gets exactly one, used everywhere: its colour in Paths, its row in
Scores, the school rule above, and the sector lean. `companyIndustry()` decides, in order:

1. **The curated list's own industry**, the last field of each `KNOWN_COMPANIES` entry.
   93 of the 164 names carry no industry word (Adobe, Pfizer, MIT, Uber…), so without it
   they took whatever their people's headlines said. Where a name does say something, the
   field agrees with it (a test in `tests/companies.test.mjs` checks both). Aliases count:
   "BNY Mellon" is BNY, finance.
2. **What the name says** ("Meridian Health" is health).
3. **What most of the people who work there now say** in their headlines, "unclear" answers
   aside. **A tie stays unclear**: that's the codebase's rule for guesses, and it keeps the
   answer the same whichever order rows are read in (the server and Paths read them in
   different orders).

`networkCompanies(rows, {industryOf})` computes it with the headcount, once per network.
`lib/scoring.js` imports nothing, so the inference is passed in (`industryKeyOf`), the way
`rescoreAll()` always did. Before `SCORING_VERSION` 3 each *person's* headline decided
their company's industry, so two people at one company could get different estimates.

## Your sector (Settings)

Up to three `INDUSTRIES` keys and a strength, saved in `app_meta` 'settings' as
`sectorFocus: {sectors, strength}` (`lib/sector-focus.js` validates it). In
`companyScore()`, a company whose one industry is chosen gets **+1 (lean) or +2 (strong),
capped at 10**. Never on a score you set: `yours` is returned before the lean. The result
keeps its source (`known`, `network`, `default`) and adds `{base, sector, sectorBonus}` only
when the score actually moved, so everything reading `{score, source}` is unchanged.

- A point of company score is worth `0.055 × title points`: +0.55 for a founder, +0.50 for
  a VP, +0.41 for a director, +0.22 for an IC. So +1 moves a VP at a 6 (7.0, A) to S (7.5),
  a director at Snap from 7.1 (A) to 7.5 (S), and a founder at an unknown company from 6.7
  to 7.3 (7.8, S, at +2). +1 on an unknown company (4 → 5) also stops its reach bonus
  being halved.
- **Recomputed from scratch on every rescore, never written into `company_scores`**, so
  turning it off gives back exactly the scores from before. `rescoreAll()` reads the focus
  itself, so imports, company-score changes and a stale model all apply it.
- **Staleness:** `rescoreAll()` stamps `app_meta` 'scoring_focus' with the focus's
  fingerprint (`lean:media,tech`, or `none`). `rescoreIfStale()` rescores when it no longer
  matches the saved focus: a database restored or brought from another computer, or a save
  whose rescore failed.
- **Saving** goes through `POST /api/settings`; `lib/settings-effects.js` sees the focus
  changed and runs `rescoreAll()`, then counts who changed tier (people once, at their
  closest degree, the way the preview counts). No promotion notifications fire: those
  belong to scans (`/api/ingest`).
- **The ripple:** more people at A/S raises circles' elite share, so bridge boosts and
  catalyst flags can change. The scanner reads bridges' circles highest stored tier first
  (unless you scan newest first) and its tier filter uses stored tiers (`scrape.py`, the
  bridge order), Outlink's priority multiplies by tier, and the profile's Network Power and
  milestones count tiers. All of that follows the new tiers. The Settings page says the
  scanner part plainly.
- **A CSV import and the sample network are not re-weighted.** They're scored in the
  browser without the database's company scores or settings (`lib/csv.js`), and the
  sample's scores are baked into `public/demo-data.json`. Settings says so when one is open.
  The sample's companies all carry set scores ("sample score"), so a lean wouldn't move it
  anyway.
- **Calibration:** the lean inflates S. On the sample, scored as if scanned (no set
  scores), 13 of its 19 invented companies are tech by their people's headlines; lean tech
  moves 120 of its 748 people up a tier and S grows from 118 to 199 of 873 rows; strong
  tech moves 220 people. Networks are often concentrated in their owner's own sector, so
  expect a broad lift more than a reshuffle. "S is the top ~3–4%" no longer holds with a
  lean on.
- `users.sectors` (free text, never written by the app) is a different thing: the
  Sidebar's "Shared sector" insight and Outlink's priority still read it. The profile's
  *Your Sectors* shows the Settings choice.

## How it was checked

For the mapped circles, a person's title should predict how senior *their own*
connections are. With the old model that correlation was 0.10; with this one it's 0.30.
Re-run that check whenever the model changes (the method is in the 0.1.10 PR, #14; there
is no script for it in the repo), and bump `SCORING_VERSION` so stored scores refresh.

**`SCORING_VERSION` 3 (one industry per company, the sector lean):** the lean changes
company scores, never title points, so the title-to-circle correlation is unchanged by
construction. One industry per company changed nothing on the sample network (0 of 873
scores). The sample can't stand in for the real check (14 bridges whose circles are random
titles): there, r(bridge title, circle's mean title) = −0.18 with or without a lean, and
r(bridge power, circle's mean title) = 0.15 with none, 0.20 lean tech, 0.01 strong tech.
Re-run the real check on a real network.

## Bridges

Being high-scoring makes someone worth *knowing*. Being a **bridge** is about the circle
behind them: `circle_power`, `circle_s_count`, `circle_a_count`, `circle_elite_pct`. A
mid-tier person with twelve S-tier people behind them can be worth more to you than an
S-tier person who opens nothing. The boost above deliberately stays small. A proposal to
blend a bridge's score toward their circle's strength was considered on 2026-09-24 and
not adopted.

## The honest caveat

The company list and the title ladder are a hand-written opinion, tuned against one real
network. Company scores are editable for exactly that reason. The model is
**domain-shaped**: a network of academics or tradespeople would score oddly against a
list built from tech and finance brands. And the tier is a statement about **network
position, not human worth**, SPEC invariant 6. Say so plainly in any UI that shows a tier.
