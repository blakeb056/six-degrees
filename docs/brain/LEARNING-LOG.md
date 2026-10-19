# The learning log

Sixgree's record, on this computer only, of how the app is used and what came of it: a
complete behaviour logger, so calibration, analysis and behaviour models have true data
sets to point at later. Blake, 2026-10-17: "the tracking models for predictability of all
data points, and start collecting everything"; 2026-10-19: "a complete logger to collect
data, behaviour etc, to have true specific data sets to use and point at in the future for
calibration, analysis, behaviour etc, so make sure we collect many things."

| File | What it does |
|---|---|
| `lib/behavior-taxonomy.js` | **The taxonomy**: every kind, every type, its fields, when it fires and who records it. The server holds the pages' events to it. Pure; the pages and the server both read it. |
| `lib/learning-log.js` | The store: `recordEvent`, `recordBatch` (the pages' batches), exposures, interactions, outcomes, the account's load, settings changes; the readers; Export (JSON, CSV per kind) and Delete. |
| `lib/behavior-buffer.js` | The pages' buffer: dedupe, rate limits and batching, with no window in it (tested by hand). |
| `lib/learning-client.js` | The pages' side: `track`, the window session, tabs and dwell, health, hover rests, frame meters, searches, grids. |
| `app/components/BehaviorLogger.js` | Starts the window session once per page load, from `app/layout.js`. |
| `app/components/useBehaviour.js` | `useSeen` (a section on screen for a second) and `usePersonDwell` (a card open, and for how long). |
| `app/api/learning/route.js` | `POST` the pages' batches; `GET` the size and the readers. |
| `app/api/data/learning/route.js` | Settings → Your data: Export (JSON), Export (CSV per kind), Delete. Gated (lib/gate.js). |
| `app/components/settings/LearningLog.js` | Settings → Your data → Learning log: the switch, counts per kind, Export, Delete. |
| `tests/behavior-log.test.mjs`, `tests/learning-log.test.mjs` | The taxonomy, its hooks, batching, dedupe, rate limits, the switch, export, the readers, no egress. |

## What must stay true

1. **Local only.** Nothing in the log is ever sent anywhere. The pages post only to
   `/api/learning` on this app's own server; the server writes only the local database.
   `tests/behavior-log.test.mjs` fails on a `fetch` of anything else, `sendBeacon`, a
   socket or an outside URL in any of the files above.
2. **No names where they aren't needed.** A search keeps its category and its length; its
   words only when it's a company's or a sector's (`queryCategory`, `keepsQueryText`), and
   the server drops the words again if a page sends them for anything else. An error keeps
   its message with links, email addresses, numbers and quoted words taken out
   (`scrubMessage`). A person is their profile key and a snapshot of facts, never a name or a
   photo.
3. **Nothing in the way.** The pages' events go into a buffer and leave in a batch every 4
   seconds, when the page is idle (`requestIdleCallback`), and at once as the window is hidden
   or closed (`keepalive`). Listeners are passive; the active-time tick is every 5 seconds;
   frame times, long tasks and hover rests are counted in memory and sent as one event each.
   A failed write never breaks what it records (`tryRecord`).
4. **Append-only and kept.** Rows are only ever added (no `UPDATE`), each with its
   `schema_version` (2 since the behaviour logger). Nothing prunes them: they stay until
   **Delete learning log**.
5. **Every type documented and fired.** A type in the taxonomy is in this file with its
   fields, and fired from a hook (a page call, or the server where it happens); the tests
   check both ways. A type with nothing sending it yet is marked `reserved`.

## The row

`learning_events` (db/schema.js): `seq`, `schema_version`, `at` (ISO-8601 UTC; a page
event keeps the page's own time when it's believable), `kind`, `type`, `person` (profile
key, for person events), `user_id`, `lens` (the class active then, or `network`), `snap`
(the person's snapshot hash), `dedupe` (unique: a repeat is a no-op) and `data` (JSON: the
type's own fields). Every page event's `data` also has `sid` (the window session) and `tab`
(the tab it happened on). Indexed by time (`idx_learning_at`), by kind, type and time
(`idx_learning_kind`) and by person and time (`idx_learning_person`).

## How events arrive

- **From the pages**: `track(kind, type, data, { person, key })` and the helpers
  (`logExposure`, `logInteraction`, `logHover`, `logSearch`, `logGridChange`,
  `trackSettled`, `frameMeter`, `useSeen`, `usePersonDwell`). The buffer
  (lib/behavior-buffer.js) keeps the same event twice within a second as one (a double
  click, an effect React runs twice), drops a type past its limit a minute and anything past
  600 a minute from one window, and sends `POST /api/learning { session, events, dropped }`
  in batches under 48 KB.
- **On the server**: `recordBatch` reads at most 200 events from a batch, holds each to the
  taxonomy (`cleanPageEvent`: a known page type, only its own fields, plain values), looks
  the person up and snapshots them, applies the same limits per type (and 1,200 a minute in
  all), keeps an event with a `key` once per session and key, and writes the batch in one
  transaction. Drops on either side are logged as `health/dropped`.
- **The server's own**: routes call `recordEvent` / `tryRecord` where the thing happens: a
  request marked sent, a scan's start and end, a duel shown, a setting saved.

## Record my behaviour (local only)

Settings → Your data → Learning log, **on until it's turned off** (`recordBehaviour`,
lib/settings.js). Off, the pages stop sending (the server's answer says so) and the server
keeps only what `isEssential` says the models need: the outcomes (`outcome/*`), the send
log (`interaction/request-sent`), the snapshots they point at, and the switch's own
`settings/change`, so a gap in the log explains itself.

## Readers

| Reader | `GET /api/learning?…` | What it gives |
|---|---|---|
| `since(db, at, { kind, type })` | `since=&kind=&type=` | Events in order. |
| `byPerson(db, key)` | `person=` | One person's events, and the lists they were shown in. |
| `outcomes(db)` | `outcomes=1` | Every request's story: sent, accepted (days, warmth) or pending. |
| `sessionSummaries(db)` | `sessions=1` | Each window session: loads, length, active time, version, plugins, class, theme, size, shell, views, time per tab, events. |
| `funnel(db)` | `funnel=1` | Card opened → profile → Connect → request sent → accepted: who reached each step in order (a minute's slack, since Connect opens the profile as it's pressed), who took it at all, and the rate. |
| `dwellByTab(db)` | `dwell=1` | Time on each tab and sub-tab: visits, total, active, median. |
| `duelCalibration(db)` | `duels=1` | Every duel answered (cards as attributes, choice, time, side, round), and per class: shown, answered, choices, median time, how often the left card won, mirrored repeats' agreement. |
| `logStats(db)` | `stats=1` | Size, counts per kind and type, the switch. |

## Export and Delete

Settings → Your data → Learning log. **Export (JSON)**: every event, the snapshot fields and
the taxonomy. **Export (CSV per kind)**: a zip with one CSV per kind (the row's columns,
then one per field the kind's events carry; a snapshot's are its fields) and
`taxonomy.json`; a cell that would start a formula is made plain text. **Delete learning
log**: every event, after a confirmation. The send log (`queue_items`) is not the learning
log and stays.

## Adding an event type

1. Add it to `TAXONOMY` in lib/behavior-taxonomy.js: who records it, when it fires, its
   fields, and a `limit` a minute for a page type.
2. Fire it: `track('kind', 'type', …)` from the page where it happens, or `tryRecord(db,
   { kind, type, data })` on the server.
3. Add its row to the tables below (kind/type, from, when, every field), and for a server
   type its hook in `SERVER_HOOKS` (tests/behavior-log.test.mjs). The tests fail until both
   are there.

# The taxonomy

Every kind, and every event in it. **From** says who records it: `page` (the pages,
batched), `server` (the app's own routes) or `scanner` (the server, reading the scanner's
lines as it runs).

## `session`

One window of the app, from its first page load to its close. The session id (`sid`) is kept in the window's sessionStorage, so a reload carries on the same session; a window left alone for 30 minutes starts a new one.

| Event | From | When it fires | Fields |
|---|---|---|---|
| `session/start` | page | a window opens the app (each page load; a reload stays in the same session) (at most 20 a minute) | `shell`: 'desktop' (the Mac or Windows app) or 'browser'; `size`: the window size bucket (sizeBucket); `reload`: true when the page was reloaded; `version`: the app version (added by the server); `plugins`: installed plugins, id to version (added by the server); `class`: the class picked, or network (added by the server); `theme`: the look in use (added by the server) |
| `session/pulse` | page | every 5 minutes while the window is open (at most 20 a minute) | `ms`: time since the session started; `activeMs`: of it, time with the window in front and used in the last minute; `views`: tabs shown so far |
| `session/end` | page | the window closes or the page unloads (at most 20 a minute) | `ms`: the session length; `activeMs`: active time; `views`: tabs shown; `hiddenMs`: time with the window hidden |
| `session/resize` | page | the window settles at a new size bucket (one second after resizing stops) (at most 20 a minute) | `size`: the new bucket; `from`: the bucket before |

## `nav`

The tab shown and how long. The tab is what the app's tab row has lit (app/components/AppTabs.js), the sub-tab what the notch has lit (lib/island.js). What led there comes from the last click: inside the notch, the header, a person's card (`data-card`), any other link or button, the browser's Back or Forward, or nothing (the app moved itself).

| Event | From | When it fires | Fields |
|---|---|---|---|
| `nav/enter` | page | a tab or a notch sub-tab is shown (at most 120 a minute) | `tab`: the tab (network, degrees, separation, map, class, paths, breach, scan, linkedin, profile, settings, ...); `sub`: the notch sub-tab lit, if any; `from`: the tab before; `fromSub`: its sub-tab; `entry`: what led there: 'header', 'notch', 'link', 'card', 'button', 'history', 'app' (the app moved itself) or 'open' |
| `nav/dwell` | page | a tab or sub-tab is left (or the window closes): how long it was shown (at most 120 a minute) | `tab`: the tab; `sub`: the sub-tab; `ms`: time shown; `activeMs`: of it, active time |

## `control`

What you set: filters, the Tiers switch, shapes (the Wi-Fi fan among them), views, sorts, lenses, searches, the Map's view and Show ties. Values that change many times a second (a slider, a zoom, typing) are kept once they hold still.

| Event | From | When it fires | Fields |
|---|---|---|---|
| `control/filter` | page | a filter is switched: a tier, a degree or a cell of the Filters grid (or the whole grid, a reset or Show all), Separation's tier and rarity chips and the sector or company it aims at, Paths' level and scanned (at most 120 a minute) | `what`: 'tier', 'degree', 'cell', 'grid', 'rarity', 'company', 'sector', 'path', 'seniority' or 'scanned'; `value`: what was switched (a company or sector by name); `on`: shown after the tap; `where`: the tab or page |
| `control/tiers` | page | the Tiers switch (Filters, or the chips under the map) is flipped (at most 60 a minute) | `on`: tiers on after the flip; `where`: the map tab |
| `control/shape` | page | a Galaxy shape is picked: Rings, Clusters, Orbit, Degrees or the Wi-Fi fan (at most 60 a minute) | `value`: the shape; `from`: the shape before |
| `control/view` | page | a view is picked: the notch's views on a map tab (Galaxy, Orbit, Grid, ...), or Paths' Companies and People (at most 60 a minute) | `value`: the view; `where`: the tab |
| `control/lines` | page | Filters → Lines: which tiers draw their lines (at most 60 a minute) | `value`: 'all', 'none' or the tiers |
| `control/lab` | page | a Galaxy physics or look control settles at a new value (a second after the last change) (at most 60 a minute) | `name`: the control; `value`: its value |
| `control/sort` | page | a list's order is changed (the Scan page's Start with) (at most 60 a minute) | `where`: the list; `value`: the order |
| `control/lens` | page | what a map sizes or colours by is changed (Paths' Size by, the people map's Colour). The class lens itself changes with a class pick (onboarding/class-switch) (at most 60 a minute) | `where`: the map; `value`: the lens |
| `control/search` | page | a search or finder query settles (a second after typing stops) (at most 60 a minute) | `where`: which search box; `category`: 'person', 'company', 'sector', 'title', 'place', 'other' or 'empty'; `length`: its length in characters; `text`: the words, kept only for company and sector queries, never for a name; `results`: how many matched |
| `control/map-view` | page | the Map tab changes what it shows: its view, the dots' colour, the heat's measure, a company picked in its finder, or the zoom where it stopped (at most 60 a minute) | `what`: 'view', 'colour', 'heat', 'company' or 'zoom'; `value`: its value |
| `control/show-ties` | page | Show ties is switched (at most 60 a minute) | `on`: on after the switch; `where`: where it was switched |

## `focus`

A circle's focus in Network Circle's Galaxy and Bridge Chains (app/components/CircleFocus.js useFocus): how it opened, for how long, and how deep it went.

| Event | From | When it fires | Fields |
|---|---|---|---|
| `focus/open` | page | a circle's focus opens (Network Circle's Galaxy, Bridge Chains) (at most 60 a minute) | `how`: 'click' or 'hold' (held 3.5 s); `where`: 'galaxy' or 'chains'; `depth`: how far along a chain: 1 for your own connection |
| `focus/close` | page | a circle's focus closes (at most 60 a minute) | `how`: how it opened: 'click' or 'hold'; `ms`: how long it was open; `where`: the view |
| `focus/dive` | page | a focus goes a level deeper or comes back up: a dive into the circle, or a step along Bridge Chains (at most 60 a minute) | `depth`: the depth now (chain position, plus one in a dive); `max`: the deepest this focus went |

## `interaction`

What was done with one person. Each carries the person (`person`, their profile key) and a snapshot of their facts at that moment (`snap`). The funnel reader is built from these and the outcomes.

| Event | From | When it fires | Fields |
|---|---|---|---|
| `interaction/card-open` | page | a person's card opens (at most 120 a minute) | `where`: the view |
| `interaction/card-dwell` | page | a person's card closes or another opens: how long it was open (at most 120 a minute) | `ms`: time open; `where`: the view |
| `interaction/hover` | page | the pointer rests on a person dot for 1.5 s or more: summed per person between flushes (at most 200 a minute) | `n`: how many rests; `ms`: their total time; `where`: the view |
| `interaction/profile-open` | server, page | a profile opens: in Sixgree's own browser (POST /api/profile-view), or in your browser (sent by the page) (at most 60 a minute) | `counted`: whether it counted as a profile view; `via`: 'panel' or 'browser' |
| `interaction/connect-click` | page, server | Connect is pressed on a card (Auto presses it on the server, route auto) (at most 60 a minute) | `route`: 'panel', 'linkedin' or 'auto'; `where`: the view |
| `interaction/read-all-mutuals` | server | Read all mutuals is started for someone | none |
| `interaction/request-sent` | server | a request is marked as sent (by hand, the panel, or Auto): the send log (kept with the switch off) | `route`: how; `attempt`: which attempt; `bridge`: through whom; `exposure`: the list it was picked from |
| `interaction/invite-detected` | server, page | LinkedIn showed "Invitation sent": after Auto pressed Connect (the server), or in the LinkedIn panel (the page) (at most 60 a minute) | `outcome`: the scanner's words; `route`: 'panel' when the panel saw it |
| `interaction/more-like-this` | server | More like this, on a class reveal card (POST /api/class react) | `against`: the other card; `list`: the list |
| `interaction/not-this-one` | server | Not this one, on a class reveal card | `against`: the other card; `list`: the list |
| `interaction/skip` | page (reserved: nothing sends it yet) | a person is skipped | none |
| `interaction/dismiss` | page (reserved: nothing sends it yet) | a person is dismissed | none |
| `interaction/never` | page (reserved: nothing sends it yet) | Never show me, for one person | none |

## `section`

Separation's tier sections and Breach's bands: folded or shown, and which were on screen.

| Event | From | When it fires | Fields |
|---|---|---|---|
| `section/toggle` | page | a section of Separation or Breach is expanded or collapsed (at most 60 a minute) | `page`: 'separation' or 'breach'; `section`: which; `open`: open after the click |
| `section/seen` | page | a tier section of Separation or Breach is on screen for a second (once per visit) (at most 60 a minute) | `page`: 'separation' or 'breach'; `section`: which |

## `onboarding`

Classes and This or That (lib/class-store.js): picks, targets, every duel shown and answered, undos, retunes and retakes, and how the class tab's list is browsed. The cards are attributes, never people.

| Event | From | When it fires | Fields |
|---|---|---|---|
| `onboarding/class-pick` | server | a class is picked for the first time | `from`: the class before; `to`: the class; `restored`: its answers came back |
| `onboarding/class-switch` | server | another class is picked | `from`: the class before; `to`: the class; `restored`: its answers came back |
| `onboarding/target` | server | a class's target is named | `class`: the class; `sectors`: sectors; `roles`: roles; `targets`: how many companies; `city`: a city was given |
| `onboarding/offer-skipped` | server | the offer to pick a class is skipped | none |
| `onboarding/retune` | server | Tune or Retune starts | `class`: the class; `mode`: tune or retune |
| `onboarding/duel-shown` | server | a This or That duel is put on screen | `class`: the class; `a`: card A, as attributes; `b`: card B; `left`: which is on the left; `round`: the round; `index`: its number; `mirrorOf`: the answer it repeats, sides swapped; `mode`: standard, tune or retune |
| `onboarding/duel` | server | a duel is answered | `class`: the class; `a`: card A; `b`: card B; `choice`: 'a', 'b', 'both', 'neither' or 'skip'; `left`: which was on the left; `ms`: decision time; `round`: the round; `focus`: what it asked about; `mirrorOf`: the answer it repeats |
| `onboarding/duel-undo` | server | an answer is undone | `class`: the class |
| `onboarding/duels-done` | server | the duels end | `class`: the class; `answers`: how many; `field`: the field they set |
| `onboarding/questions-skipped` | server | the duels are skipped | `class`: the class |
| `onboarding/never-pick` | server | Never show me is saved | `class`: the class; `avoid`: what is pushed down (Less) or off (Never) |
| `onboarding/retake` | server | a class is retaken from the start | `class`: the class |
| `onboarding/tier-browse` | page | the class tab's ranked list is browsed: Show more, or the list switched (at most 60 a minute) | `class`: the class; `what`: 'more' or 'list'; `value`: the list; `shown`: how many rows are shown after |

## `scan`

Each scan job: its start, each page read (with its pace), each break, a limit or a stop, an error, and its summary. Pages and breaks are read from the scanner's own lines as it runs.

| Event | From | When it fires | Fields |
|---|---|---|---|
| `scan/start` | server | a scan job starts | `action`: what it does; `target`: whose circle (a connection id); `round`: pages planned this round; `manual`: manual mode; `window`: pages left in the scan window; `sitting`: an Auto scan sitting; `lifted`: limits lifted |
| `scan/page` | scanner | a page of a scan is read | `action`: the job; `target`: whose circle; `page`: the page number in this job; `found`: people it found; `gapMs`: time since the page before (the pace) |
| `scan/batch` | server | a page of people arrives (POST /api/ingest), with its tier mix | `degree`: their degree; `bridge`: whose circle; `company`: the company searched; `received`: people sent; `people`: kept; `added`: new; `alreadyConnected`: already yours; `S`: network S; `A`: network A; `classS`: class S; `classA`: class A |
| `scan/break` | scanner | a break between pages ends (manual mode's breaks), or Auto scan plans its rest between sittings | `action`: the job; `seconds`: its length; `after`: the page before it; `how`: 'taken' (sat out), 'skipped' (cut short by a stop) or 'planned' (an Auto rest); `mode`: 'manual' or 'auto-rest' |
| `scan/limit` | server | a limit holds a scan back: a press refused at the scan window, at profile views a day or Auto's request caps, or a scan that stopped at a limit | `what`: 'window', 'profiles', 'invites' or 'limit'; `action`: the job |
| `scan/stop` | server | a scan stops before it finished | `by`: 'user', 'limit' or 'push-back'; `action`: the job; `target`: whose circle; `pages`: pages read |
| `scan/error` | server | a scan fails | `action`: the job; `code`: the exit code; `message`: the reason, without names or links |
| `scan/job` | server | a scan job ends: its summary | `action`: the job; `target`: whose circle; `pages`: pages; `perPage`: people per page; `people`: people; `exit`: how it ended; `limitHit`: a limit held it; `pushback`: LinkedIn pushed back; `sitting`: Auto scan sitting |

## `panel`

Sixgree's own browser (the LinkedIn panel, desktop app): which section it shows, for how long, and Back and Forward.

| Event | From | When it fires | Fields |
|---|---|---|---|
| `panel/open` | page | Sixgree's own browser comes forward, or shows another section (at most 60 a minute) | `section`: 'feed', 'messaging', 'notifications', 'jobs' (the LinkedIn tab), 'profile' or 'scan'; `from`: the section before |
| `panel/time` | page | the LinkedIn panel leaves a section or closes: how long it was shown (at most 60 a minute) | `section`: the section; `ms`: time shown |
| `panel/nav` | page | the panel's Back or Forward is pressed (at most 60 a minute) | `dir`: 'back' or 'forward'; `section`: the section |

## `settings`

Every setting saved with a new value, whoever saved it (lib/settings.js writeSettings).

| Event | From | When it fires | Fields |
|---|---|---|---|
| `settings/change` | server, page | a setting is saved with a new value: any of lib/settings.js (whoever saves it), the scanner's settings as `scanner.<name>`, and the switches this browser keeps (Help's hints, the strategy engine), sent by the page (at most 60 a minute) | `key`: the setting; `old`: the value before; `new`: the value now (a long value as its size and hash) |

## `health`

Errors, slow moments and failed requests, with nothing personal in them: an error's message loses links, numbers and quoted words (scrubMessage); frame times and long tasks are summed per pulse.

| Event | From | When it fires | Fields |
|---|---|---|---|
| `health/error` | page | an error or an unhandled rejection reaches the page (at most 30 a minute) | `message`: the message, with links, numbers and quoted words taken out; `code`: its name or code; `source`: the file and line |
| `health/long-tasks` | page | a session's main-thread tasks over 50 ms, summed (with each pulse and at the end) (at most 20 a minute) | `count`: how many; `totalMs`: their total; `maxMs`: the longest |
| `health/frames` | page | a view's frame times, summed (Network Circle's Galaxy; with each pulse and at the end) (at most 20 a minute) | `view`: the view; `frames`: frames drawn; `p50`: median frame ms; `p95`: 95th percentile; `max`: the slowest; `slow`: frames over 50 ms |
| `health/api-failure` | page | a request to the app's own server fails or answers with an error (at most 30 a minute) | `route`: the route, without its query; `status`: the status, 0 for no answer; `method`: GET, POST, ... |
| `health/dropped` | server | events were dropped because they came too fast: counted by the pages (sent with their next batch) or by the server (at most 10 a minute) | `n`: how many; `where`: 'page' or 'server' |

## `exposure`

A list as drawn, once it has settled: who was shown, at what rank, under which order. The same list in the same order within half an hour is one event.

| Event | From | When it fires | Fields |
|---|---|---|---|
| `exposure/separation` | page | the separation list as drawn, once it settles: who was shown, in order (the top 50) (at most 60 a minute) | `list`: the list; `sort`: its order or lens; `context`: the place, company or circle; `shown`: [person, rank, snapshot] for each |
| `exposure/breach` | page | the breach list as drawn, once it settles: who was shown, in order (the top 50) (at most 60 a minute) | `list`: the list; `sort`: its order or lens; `context`: the place, company or circle; `shown`: [person, rank, snapshot] for each |
| `exposure/class` | page | the class list as drawn, once it settles: who was shown, in order (the top 50) (at most 60 a minute) | `list`: the list; `sort`: its order or lens; `context`: the place, company or circle; `shown`: [person, rank, snapshot] for each |
| `exposure/focus` | page | the focus list as drawn, once it settles: who was shown, in order (the top 50) (at most 60 a minute) | `list`: the list; `sort`: its order or lens; `context`: the place, company or circle; `shown`: [person, rank, snapshot] for each |
| `exposure/map` | page | the map list as drawn, once it settles: who was shown, in order (the top 50) (at most 60 a minute) | `list`: the list; `sort`: its order or lens; `context`: the place, company or circle; `shown`: [person, rank, snapshot] for each |
| `exposure/card` | page (reserved: nothing sends it yet) | the card list as drawn, once it settles: who was shown, in order (the top 50) (at most 60 a minute) | `list`: the list; `sort`: its order or lens; `context`: the place, company or circle; `shown`: [person, rank, snapshot] for each |
| `exposure/insights` | page (reserved: nothing sends it yet) | the insights list as drawn, once it settles: who was shown, in order (the top 50) (at most 60 a minute) | `list`: the list; `sort`: its order or lens; `context`: the place, company or circle; `shown`: [person, rank, snapshot] for each |
| `exposure/reveal` | page | the reveal list as drawn, once it settles: who was shown, in order (the top 50) (at most 60 a minute) | `list`: the list; `sort`: its order or lens; `context`: the place, company or circle; `shown`: [person, rank, snapshot] for each |

## `outcome`

How each request went. Kept with the switch off: the acceptance and warmth models need it.

| Event | From | When it fires | Fields |
|---|---|---|---|
| `outcome/accepted` | server | a request is seen accepted (kept with the switch off) | `sentAt`: when it was sent; `acceptedAt`: when it was seen; `acceptedDay`: the connection's own date; `days`: days it took; `warmth`: the warmth band; `via`: 'promote' or 'check' |
| `outcome/withdrawn` | server | a request is undone (kept with the switch off) | `via`: how; `attempt`: which attempt; `sentAt`: when it was sent |
| `outcome/still-pending` | server | a check finds a request still out (once a week each) (kept with the switch off) | `attempt`: which attempt; `ageDays`: its age |

## `load`

LinkedIn's load by the hour, mirrored from the scanner's linkedin-activity.json.

| Event | From | When it fires | Fields |
|---|---|---|---|
| `load/hour` | server | a finished hour of the scanner's searches, profile views and requests | `hour`: the hour; `searches`: searches; `profiles`: profile views; `invites`: requests |

## `snapshot`

A person's facts as known, once per change (SNAPSHOT_FIELDS: title, level, company, industry, location, tz, degree, tier, classTier, power, mutual, followers, bridge, cluster, classU). Never a name or a photo. Events point at one by its hash (`snap`).

| Event | From | When it fires | Fields |
|---|---|---|---|
| `snapshot/person` | server | a person's facts as known, once per change, referenced by the events' snap hash (kept with the switch off) | `[vector]`: SNAPSHOT_FIELDS in order |

