# Backlog

Planned work, checkbox-tracked. A row leaves here when it ships and the change is
described in `PHASES.md` or the changelog.

---

## 1. Revolver: a bridge you click should open, not just rotate

**Status:** ⬜ not started · **Size:** small · **Files:** `app/components/BridgeRing.js`

### What happens now

`rotateToSlot()` calls `setSelectedId(id)` — component-local state. It **never** calls
`onSelect`. So clicking a bridge spins it to the top and tells the rest of the app
nothing: the sidebar keeps showing whatever was there before, or nothing at all. Only
*cluster* nodes call `onSelect`. From the outside this reads as "clicking a bridge does
nothing", which is what it effectively does.

Two limits compound it, both silent:

- `MAX_BRIDGES = 12` — only twelve bridges are ever on the dial. A thirteenth is
  unreachable and unmentioned.
- `MAX_CLUSTER_NODES = 24` — a circle of 200 shows 24 of them, with no "+176 more".

### What it should do

- [ ] Clicking a bridge (or arrowing to it) calls `onSelect(bridge)` **after** the snap
      completes, so the sidebar shows that person: headline, company, circle power,
      S/A counts, and their outreach state.
- [ ] The readout chip states the truth when the circle is truncated:
      `circle unlocked · showing 24 of 212 · 8S 31A`.
- [ ] When more than `MAX_BRIDGES` bridges exist, say so on the dial —
      `12 of 27 bridges · sorted by circle power` — rather than silently dropping them.
- [ ] Paging or a "show more" affordance for bridges beyond the first twelve. Simplest
      version: the ring holds twelve, and a control rotates the *window* through the
      full sorted list.

### Deliberately not doing

Raising `MAX_CLUSTER_NODES` much past 24. The fan has a fixed arc and readable dots are
the point; past ~30 it becomes the mess described in item 2. Truncate honestly instead.

---

## 2. Orbit: draw the structure, not every person

**Status:** ⬜ not started · **Size:** medium · **Files:** `app/components/OrbitGraph.js`

### What happens now

Orbit draws **everyone at full weight**. Each 1st-degree node is a `<g>` carrying up to
eight SVG elements — glow, catalyst ring, catalyst glyph, base circle, initials, clip
path, avatar image, selection ring, label. At 754 connections that is roughly **6,000
elements**, plus 598 second-degree groups, 598 link lines and 150 spokes: on the order
of **7,500 SVG nodes inside a live force simulation**.

That is the lag, and it is also the mess — a wall of same-sized avatars with no visual
hierarchy. Blake, comparing it to the reference: *"very messy with all the particles
being everything and causing lots of lag."*

### What the reference actually does differently

It is not a prettier version of the same picture — it is a **different composition**:

- Roughly **eight to ten prominent, named hubs**. Everyone else is small.
- Each hub carries a **tight fan of tiny dots** — its circle — immediately beside it.
- The remaining people are **initials-only discs** on sparse outer rings, unlabelled.
- Density near the centre is low. The eye lands on hubs first, then their circles.

The insight: **the hubs are the subject; the rest is context.** Our version treats all
754 as equally important, which is why nothing stands out.

### What it should do

- [ ] Three visual weights instead of one:
      **hub** (has a mapped circle, or top N by circle power) — full treatment, name label;
      **standard** (everyone else at 1st degree) — small disc, initials only, no label,
      no glow, no avatar image;
      **dot** (2nd degree) — as now.
- [ ] Cap full-weight rendering. Avatars, glows and labels only for hubs and the current
      selection. This alone removes most of the element count.
- [ ] Reveal on demand: hovering or selecting a standard node promotes it to full
      weight for as long as it is active.
- [ ] Measure it. Record element count and time-to-settle for 750 D1 / 600 D2 before and
      after, in this file. A performance claim without a number is not a claim.

### Open question for Blake

Whether "hub" means *has a mapped circle* (honest, but on an unscraped network almost
nobody qualifies) or *top N by circle power* (always populated, but shows people whose
circle you have not actually opened). Recommendation: **has a mapped circle, falling
back to top N by power score when none exist**, matching what Revolver already does.

---

## 3. Profile: how much of the network is actually mapped

**Status:** ✅ shipped · **Size:** small · **Files:** `app/profile/page.js`, possibly `app/api/network`

### Why

Second-degree mapping is the slow, rate-limited part of this tool, and it is currently
invisible. There is no way to answer "how far through am I?" — which matters more now
that runs must be **batched** (TRAPS §16). The profile page already has a *Queue
Progress* block; this sits beside it.

### What it should show

- [x] A progress bar: **connections whose circle has been mapped, out of all 1st-degree**.
      Mapped = at least one `linkedin_connections` row at `degree = 2` whose
      `source_connection_id` is that person.
- [x] The three real states, because two of them are not failure:
      `mapped` · `hidden` (in `bridge-skips.json` — their connections are private, this
      will never change) · `not yet tried`.
      **Hidden must not read as incomplete.** A network where every reachable circle is
      open should show as done even if half of it was hidden.
- [x] The counts under the bar: `184 mapped · 96 hidden · 474 to go — of 754`.
- [x] A per-tier breakdown, since S and A are what you would map first.
- [x] An honest estimate of remaining time at the current cooldown, framed as batches
      rather than one run: *"474 left ≈ 19 batches of 25."* Never imply it can be done
      in a sitting; that is how the account got restricted.

### Data

Everything needed is already stored — no schema change. Counting distinct
`source_connection_id` at `degree = 2` gives mapped; `bridge-skips.json` in the data
directory gives hidden. The skip file is **local to the scraper**, so either the profile
page reads it through a small endpoint or the scraper writes the skip state into the
database. **Prefer the endpoint** — the skip list is scraper bookkeeping and does not
belong in the network schema.

---

### How it shipped

`app/components/MappingProgress.js`, rendered on the profile page above Queue
Progress. Skips are read from the scraper's `bridge-skips.json` through
`GET /api/scraper` — the endpoint route, as recommended, so scraper bookkeeping
stays out of the network schema.

Six tests cover the state logic, including the one that matters: **hidden people
do not stop the bar reaching the end.** The `computeMapping` logic is duplicated
in `tests/mapping.test.mjs` because the component is JSX and the test runner has
no transform — if you change one, change both; the test says so.

Verified against the real 754-connection network: `0 mapped · 1 hidden · 753 to
go`, 31 batches, per-tier rows all present.

## Ordering

3 → 1 → 2. The progress bar is small, self-contained and immediately useful while
scraping is paused. The Revolver fix is small and removes a "this is broken" impression.
Orbit's rework is the largest and the only one that needs a measurement pass.
