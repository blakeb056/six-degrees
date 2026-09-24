# Scoring

How a headline becomes a power score and a tier. **One implementation:
`lib/scoring.js`**, whose header explains the model, with `tests/scoring.test.mjs`
pinning it down. Everything scores through it:

| Caller | When |
|---|---|
| `lib/rpc.js` `rescoreAll()` | After every import (`score_new_connections`), when a company score changes, and once on the first load after the model changes (`SCORING_VERSION`, stored in `app_meta`) |
| `lib/csv.js` `scoreRecord()` | CSV imports, in the browser, from the export's bare position and company |
| `lib/companies.js` | Paths reads titles and companies through the same functions, so Paths and the score never disagree |

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
`company_scores`), then the curated `KNOWN_COMPANIES` list (about 130). Otherwise it's
an estimate from how many of your people work there: 5 at 5+, 6 at 15+, but never for
schools. Unknown is 4, and no company found is 3. Names are cleaned first, so "Snap Inc.",
"Snapchat 👻" and "Snap" are one company. Phrases like "at scale" are not companies.

**Reach bonus (≤1.5)** needs whole-word signals: investor, YC, 30 under 30, an audience or
revenue in the millions, keynote/TEDx/patents/awards. It's halved for someone at a company
scored 4 or less, because headlines are self-written.

**Bridge boost (≤1)** goes to a 1st-degree person whose mapped circle (20+ people) is
unusually strong: `(share at A or S − 0.12) × 5`, capped. It's recomputed each time and
never ratchets.

The person panel shows the working as `score_why`, e.g.
"VP / Partner / GM (9) · Snap (9/10) · +0.7 strong circle".

## How it was checked

For the mapped circles, a person's title should predict how senior *their own*
connections are. With the old model that correlation was 0.10; with this one it's 0.30.
Re-run that check whenever the model changes (the method is in the 0.1.10 PR, #14), and
bump `SCORING_VERSION` so stored scores refresh.

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
