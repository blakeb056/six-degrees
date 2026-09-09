# Scoring

The model that turns a headline into a tier. **It exists twice** — change both in the
same commit or the tiers drift silently.

| Copy | Role |
|---|---|
| `scripts/score_new_connections.sql` | **Canonical reference.** Written for Postgres; the header says so. |
| `lib/rpc.js` | The runtime transcription used by the local build. |

There are two further partial scorers — `lib/csv.js` for CSV imports and an inline one
in `app/api/ingest/route.js`. Both should be diffed against the reference when it moves.
The reference was recovered from a hosted database where it had only ever existed; it
was never in version control until it was rescued. Do not let that happen again.

## The formula

```
power = (seniority × 0.5) + (company_prestige × 0.3) + headline_signals + recency

tiers   S ≥ 7.0    A ≥ 5.5    B ≥ 4.0    C ≥ 2.5    D < 2.5
```

**Seniority (0–10)** — regex on the role title. CEO/Chief/Founder/President/Owner = 10,
down through VP tiers, Director, Manager, Lead/Principal/Staff, IC roles at 4, and
Intern/Student at 2. Unmatched defaults to 3. A headline mentioning Student/University
with no leadership term floors at 1.

**Company prestige (0–10)** — a hardcoded brand ladder. Big tech at 10; Snap at 9;
elite finance and consulting at 9; a long tail at 8/7/6. Empty company scores 2,
unmatched scores 4.

**Headline signals** — `+2` for `billion|million|Forbes|YC|a16z|venture|investor|Wharton|MIT|Stanford`,
`+1.5` for `award|patent|speaker|author|TEDx|Board Member`.

**Recency** — `+0.5` for a 1st-degree connection made in the last 30 days.

Both of the last two terms were **missing from the JS scorers** while present in the
reference. That is precisely the drift this document exists to prevent.

## Bridges

Being high-scoring makes someone worth *knowing*. Being a **bridge** is different: it
is about the circle behind them — `circle_power`, `circle_s_count`, `circle_a_count`,
`circle_elite_pct`. A mid-tier person with twelve S-tier people behind them is more
valuable to the graph than an S-tier person who opens nothing.

## The honest caveat

The prestige ladder is a hand-written opinion, tuned against one real network. It is not
objective and it does not pretend to be. Two consequences worth keeping in mind when
changing it: the model is **domain-shaped** — a network of academics or tradespeople
would score badly against a list built from tech and finance brands — and the tier is a
statement about **network position, not human worth**. SPEC invariant 6. Say it plainly
in any UI that surfaces a tier.
