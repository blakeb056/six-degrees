# Scoring

How a headline becomes a power score and a tier. **One implementation:
`lib/scoring.js`**, whose header explains the model, with `tests/scoring.test.mjs`
pinning it down. Everything scores through it:

| Caller | When |
|---|---|
| `lib/rpc.js` `rescoreAll()` | After every import (`score_new_connections`), when a company score changes, when *Your sector* changes in Settings, and once on the first load after the stored scores go stale (`SCORING_VERSION`, the curated list or the sector focus they were computed with no longer matches; all three stamped in `app_meta`) |
| `lib/csv.js` `scoreRecord()` | CSV imports, in the browser, from the export's bare position and company |
| `lib/companies.js` | Paths reads titles, companies and each company's industry through the same functions, so Paths and the score never disagree |
| `lib/sector-focus.js` `previewSectorFocus()` | Settings → Your sector, before saving: reads the network once and scores it twice in memory (saved focus, new focus), then counts what moves. Writes nothing. A save counts with the same function (`rescoreAll({compareWith})`), so the two say the same |
| `lib/legacy-offer.js` `legacyOffer()` | Paths → Scores' one-time offer to keep the curated list's old scores: compares each company's built-in score now (`companyScore()`) with the one the old list gave it. Writes nothing until it's answered |

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
`company_scores`), then the curated `KNOWN_COMPANIES` list (133 companies, on it by the
rule [below](#the-curated-list)). Otherwise it's an estimate from how many of your people
work there: 5 at 5+, 6 at 15+, but never for schools (a company whose one industry, below,
is education). Unknown is 4, and no company found is 3, so the company weight runs from
0.615 (no company) to 1.0; 0.505 is the floor, for a company you score 1. Names are cleaned
first, so "Snap Inc.", "Snapchat 👻" and
"Snap" are one company. Phrases like "at scale" are not companies. The list's aliases match
from the start of a name, so a name that says school, college or university only matches a
school on the list: "Kellogg School of Management" is not Kellanova, "Warner University" not
Warner Bros., "Chase College of Law" not JPMorgan Chase. Bain Capital (private equity) has
its own entry, apart from Bain & Company. If you picked sectors in Settings, a company in one
of them gets +1 or +2 on top (below).

**Reach bonus (≤1.5)** needs whole-word signals: investor, YC, 30 under 30, an audience or
revenue in the millions, keynote/TEDx/patents/awards. It's halved for someone at a company
scored 4 or less, because headlines are self-written. That's judged by the company's score
before any sector lean (a score you set counts as the company's own).

**Bridge boost (≤1)** goes to a 1st-degree person whose mapped circle (20+ people) is
unusually strong: `(share at A or S − 0.12) × 5`, capped. It's recomputed each time and
never ratchets.

The person panel shows the working as `score_why`, e.g.
"VP / Partner / GM (9) · Snap (8/10) · +0.7 strong circle", or with a sector lean
"Director / Head (7.5) · Snap (9/10: 8 + 1 your sector)".

## The curated list

`KNOWN_COMPANIES` is everyone's default, so a written rule decides who is on it, not anyone's
own ties to a company. **A company is on the list only if most US professionals would
recognise it:**

- a household-name brand;
- a Fortune 500 company, or a public company as large;
- a top global VC, private equity, consulting, law or accounting firm;
- a frontier AI lab;
- a top national university.

**Scores follow one scale:** 10 the largest tech platforms and the frontier AI labs, 9 elite
(the most sought-after employers in tech, finance, consulting, investing and consumer
brands), 8 major, 7 well-known. Nothing on the list is below 7. Regional picks, picks from
one person's career or network, and small startups are not on it: they're estimated from
the network like any other company, and anyone can score them on Paths → Scores. **When in
doubt, a company stays off**: the estimate is the neutral default. No comment in the list
speaks for one person (it used to say "home turf" and "local institutions"); a test checks.

Applying the rule (September 2026, after 0.2.1) changed 34 of the 165 entries:

- **Snap 9 → 8**, like its peers Pinterest, Reddit and X, and **MrBeast 8 → 7**: a household
  name, but a company of a few hundred people.
- **Removed, 32:** the "notable" 6s and the one "local institution", drawn from one network
  and one region (Grindr, Genius Sports, Later, Hard Rock Digital, Vanta, Kaseya, Havas,
  VaynerMedia, AdventHealth, University of Florida, The Athletic, UCF); private companies
  that are neither household names nor that size, and startups (Anduril, Polymarket,
  Kalshi, Databricks, Figma, Scale AI, Whatnot, Whop, Hims & Hers, Riot Games, Notion,
  Vercel, Plaid, Brex, Ramp, Mercury, Chime); two executive search firms (Egon Zehnder,
  Heidrick & Struggles); and the U.S. Space Force, the only military branch on the list.

The other 131 kept their score, alias and industry. `lib/legacy-scores.js` holds the old rows
(name, score, alias, industry) for the offer below and nothing else; `lib/scoring.js` imports
nothing, so the model can't read them.

The list is still narrower than its rule: it leans to tech, finance, consulting and media,
and many names the rule admits aren't on it (McDonald's, Ford, Costco, Eli Lilly, Yale,
Kirkland & Ellis…). Adding them is a separate change, made the same way.

**Staleness:** `rescoreAll()` stamps `app_meta` 'scoring_list' with a fingerprint of the
whole list (every name, score, alias and industry; `KNOWN_LIST_STAMP` in `lib/rpc.js`), and
`rescoreIfStale()` rescores when it no longer matches. Editing the list refreshes stored
scores with no `SCORING_VERSION` bump to remember.

### Keeping the old scores: a one-time offer

A list change shouldn't take anyone's view away silently. Scores computed with the old list
carry no 'scoring_list' stamp; the first time `rescoreAll()` replaces them (and some row was
already scored, so the database isn't new), it opens an offer: `app_meta`
'legacy_scores_offer' = `open`. Paths → Scores then shows one card at the top: "Built-in
scores changed in this version: Snap 9 → 8, UCF 5 → estimated. Keep any of the old ones as
your own?", with *Keep all*, *Choose…* and *No thanks* (`app/components/LegacyScoresCard.js`,
`/api/company-scores/legacy`).

- **What it lists** (`lib/legacy-offer.js` `legacyOffer()`): each old entry that someone in
  this network works at now, whose built-in score is different now (the list or the
  estimate, before any sector lean), and that you haven't scored yourself. Current
  employers only, because those are what Paths → Scores lists: a kept score shows there as
  yours and *Auto* can hand it back. (A company only in former roles would get a score
  nothing lists; a former role counts at 70%, so it moves people little.) A removed entry
  no longer canonicalises ("University of Central Florida" isn't "UCF" any more), so its
  names are found with its old alias, read the way `cleanCompany()` read it then.
- **Keep** writes the old score to `company_scores` under every name scoring uses for those
  rows (UCF's covers "UCF" and "University of Central Florida"), with the same
  `setCompanyScores()` that Paths → Scores uses, then rescores everyone once for the whole
  batch. A kept score is yours like any other: *Auto* hands it back.
- **Once:** *Keep* or *No thanks* sets the offer to `kept` or `declined`, and nothing
  reopens it.
- **Never** for a fresh database (nothing was scored with the old list), and never while a
  CSV import or the sample is on screen: those are scored in the browser, not the server.
- If the rescore after a keep fails, the scores and the answer are saved, the answer says
  so, and the next map load rescores (the model stamp is cleared).

The offer covers this one change, from lists that stamped nothing. A later edit to the list
changes the stamp and rescores, but offers nothing unless it brings its own old rows and
its own trigger.

## One industry per company

Industry is inferred (`lib/companies.js` `INDUSTRIES`, regexes over names and headlines),
but each **company** gets exactly one, used everywhere: its colour in Paths, its row in
Scores, the school rule above, and the sector lean. `companyIndustry()` decides, in order:

1. **The curated list's own industry**, the last field of each `KNOWN_COMPANIES` entry.
   69 of the 133 names carry no industry word (Adobe, Pfizer, MIT, Uber…), so without it
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

`readNetwork(rows, {industryOf})` reads every headline once (roles, student, reach signals)
and finds every company anyone names, a former employer included, with its headcount and
industry. `scoreNetwork(rows, {read})` then scores that read with no parsing, so the
preview and a save score one read twice for about the price of once.

Where Paths' colour can still differ from the industry scoring uses:

- **Two profiles in one database.** The server votes over every row it holds; Paths only
  sees the profile on screen. A company whose people mostly belong to the other profile can
  vote differently.
- **Names Paths merges and scoring doesn't** (`normalizeCompany`: "BNY Mellon" and "BNY",
  or a loose rule that folds two companies into one). Paths looks the merged name up as
  scoring would write it, which usually lands on the same answer, but a wrong merge shows
  the other company's industry.

## Your sector (Settings)

Up to three `INDUSTRIES` keys and a strength, saved in `app_meta` 'settings' as
`sectorFocus: {sectors, strength}` (`lib/sector-focus.js` validates it). In
`companyScore()`, a company whose one industry is chosen gets **+1 (lean) or +2 (strong),
capped at 10**. Never on a score you set: `yours` is returned before the lean. The result
keeps its source (`known`, `network`, `default`) and adds `{base, sector, sectorBonus}` only
when the score actually moved, so everything reading `{score, source}` is unchanged.

- A point of company score is worth `0.055 × title points`: +0.55 for a founder, +0.50 for
  a VP, +0.41 for a director, +0.22 for an IC. So +1 moves a VP at a 6 (7.0, A) to S (7.5),
  a director at YouTube (9) from 7.1 (A) to 7.5 (S), and a founder at an unknown company
  from 6.7 to 7.3 (7.8, S, at +2).
- **The lean lifts the company, not the headline's claims.** The reach bonus is halved by
  the company's score *before* the lean, so a founder at an unknown company who says "Angel
  investor" goes 7.2 → 7.8 on lean, not 7.2 → 8.3: liking a sector says nothing about whether
  a self-written claim is true. (A score you set is your judgement of the company, so it
  decides.)
- **Recomputed from scratch on every rescore, never written into `company_scores`**, so
  turning it off gives back exactly the scores from before. `rescoreAll()` reads the focus
  itself, so imports, company-score changes and a stale model all apply it.
- **Staleness:** `rescoreAll()` stamps `app_meta` 'scoring_focus' with the focus's
  fingerprint (`lean:media,tech`, or `none`). `rescoreIfStale()` rescores when it no longer
  matches the saved focus: a database restored or brought from another computer, or a save
  whose rescore failed.
- **Saving** goes through `POST /api/settings`; `lib/settings-effects.js` sees the focus's
  fingerprint changed and runs `rescoreAll({compareWith: the focus it replaced})`. That
  scores the same read of the rows with the old focus too, in memory, and counts who changed
  tier with `previewSectorFocus()` itself (people once, at their closest degree), so the save
  says what the preview said, even when the stored tiers were stale. A strength change with
  no sectors picked scores like nothing picked, so it saves without a rescore. If the
  rescore fails, the choice is still saved, the answer says so, and the old stamp makes the
  next map load retry. No promotion notifications fire: those belong to scans
  (`/api/ingest`).
- **The ripple:** more people at A/S raises circles' elite share, so bridge boosts and
  catalyst flags can change. Outlink's priority multiplies by tier, and the profile's Network
  Power and milestones count tiers. All of that follows the new tiers. The scanner's default
  order, newest connections first, doesn't look at tiers; only when you pick *Highest tier
  first* on the Scan page does it read bridges' circles by stored tier and apply its tier
  filter (`scrape.py`, the bridge order; `app/setup/page.js`). The Settings page says so.
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

**The neutral list (still `SCORING_VERSION` 3):** it changes company scores, never title
points, so the title-to-circle correlation is unchanged by construction, and the sample
network doesn't move (0 of 873 scores: its companies are invented, each scored for it).
`SCORING_VERSION` stays 3 because 3 is unreleased: a 0.2.x database rescores once anyway,
and the list stamp catches a database the unreleased build scored with the old list.

## Bridges

Being high-scoring makes someone worth *knowing*. Being a **bridge** is about the circle
behind them: `circle_power`, `circle_s_count`, `circle_a_count`, `circle_elite_pct`. A
mid-tier person with twelve S-tier people behind them can be worth more to you than an
S-tier person who opens nothing. The boost above deliberately stays small. A proposal to
blend a bridge's score toward their circle's strength was considered on 2026-09-24 and
not adopted.

## The honest caveat

The title ladder is a hand-written opinion, tuned against one real network, and the company
list, though it now follows a written rule, is a judgement about which names most
professionals know. Company scores are editable for exactly that reason. The model is
**domain-shaped**: a network of academics or tradespeople would score oddly against a
list that leans to tech and finance brands. And the tier is a statement about **network
position, not human worth**, SPEC invariant 6. Say so plainly in any UI that shows a tier.
