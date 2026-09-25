# Scoring

How a headline becomes a power score and a tier. **One implementation:
`lib/scoring.js`**, whose header explains the model, with `tests/scoring.test.mjs`
pinning it down. Everything scores through it:

| Caller | When |
|---|---|
| `lib/rpc.js` `rescoreAll()` | After every import (`score_new_connections`), when a company score changes, and once on the first load after the model changes (`SCORING_VERSION`, stored in `app_meta`) |
| `lib/csv.js` `scoreRecord()` | CSV imports, in the browser, from the export's bare position and company |
| `lib/companies.js` | Paths reads titles, companies and each company's industry through the same functions, so Paths and the score never disagree |

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
"Snap" are one company. Phrases like "at scale" are not companies.

**Reach bonus (≤1.5)** needs whole-word signals: investor, YC, 30 under 30, an audience or
revenue in the millions, keynote/TEDx/patents/awards. It's halved for someone at a company
scored 4 or less, because headlines are self-written.

**Bridge boost (≤1)** goes to a 1st-degree person whose mapped circle (20+ people) is
unusually strong: `(share at A or S − 0.12) × 5`, capped. It's recomputed each time and
never ratchets.

The person panel shows the working as `score_why`, e.g.
"VP / Partner / GM (9) · Snap (9/10) · +0.7 strong circle".

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

## How it was checked

For the mapped circles, a person's title should predict how senior *their own*
connections are. With the old model that correlation was 0.10; with this one it's 0.30.
Re-run that check whenever the model changes (the method is in the 0.1.10 PR, #14; there
is no script for it in the repo), and bump `SCORING_VERSION` so stored scores refresh.

**`SCORING_VERSION` 3 (one industry per company):** it changed nothing on the sample
network (0 of 873 scores), which can't stand in for the real check anyway: its 14
bridges' circles are random titles, and there r(bridge title, circle's mean title) = −0.18.
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
