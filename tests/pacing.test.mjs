// Gentle pacing (Blake, 2026-10-05: "polish the pacing, with extra intervals",
// "add scroll intervals as well", "random scrolls do", exponential backoff, and
// "build on top of the old system, never replace it"). These run the scanner's
// own functions (scripts/scrape.py) with seeded generators, a stand-in clock and
// stand-in results pages (tests/helpers/scanner_harness.py): nothing opens a
// browser or reaches LinkedIn. Invented people only.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PYTHON, noPython } from './python.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const SCRAPER = path.join(here, '..', 'scripts', 'scrape.py');
const HARNESS = path.join(here, 'helpers', 'scanner_harness.py');

function run(t, script) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'six-degrees-pacing-'));
  const r = spawnSync(PYTHON, [HARNESS, SCRAPER, script], { encoding: 'utf8', env: { ...process.env, SIX_DEGREES_HOME: home } });
  fs.rmSync(home, { recursive: true, force: true });
  if (noPython(t, r)) return null;
  assert.equal(r.status, 0, r.stderr);
  const lines = r.stdout.trimEnd().split('\n');
  return { out: JSON.parse(lines.pop().replace(/^RESULT /, '')), log: lines.join('\n') };
}

// ── the interval ────────────────────────────────────────────────────────────

test('a paced wait is never under its floor, never over three times it, and averages about 1.1 times it', (t) => {
  const r = run(t, `
rng = random.Random(42)
for floor in (3, 20, 45, 60, 90, 300):
    xs = [ns['paced_interval'](floor, rng) for _ in range(20000)]
    out[str(floor)] = [min(xs), max(xs), sum(xs) / len(xs), ns['expected_interval'](floor)]
out['zero'] = ns['paced_interval'](0, rng)
out['capped'] = ns['paced_interval'](10, rng, spread=50)
out['same'] = [ns['paced_interval'](20, random.Random(1)) for _ in range(2)]
out['differ'] = [ns['paced_interval'](20, random.Random(s)) for s in (1, 2)]`);
  if (!r) return;
  for (const floor of [3, 20, 45, 60, 90, 300]) {
    const [min, max, mean, expected] = r.out[String(floor)];
    assert.ok(min >= floor, `${floor}: never below the floor (${min})`);
    assert.ok(max <= floor * 3, `${floor}: never above the cap (${max})`);
    assert.ok(Math.abs(mean - expected) / expected < 0.01, `${floor}: mean ${mean} near ${expected}`);
    assert.ok(Math.abs(expected / floor - 1.0997) < 0.001, 'the mean is about 1.1 x');
  }
  assert.equal(r.out.zero, 0);
  assert.equal(r.out.capped, 30, 'a huge extra still stops at 3 x');
  assert.equal(r.out.same[0], r.out.same[1], 'the same seed, the same wait');
  assert.notEqual(r.out.differ[0], r.out.differ[1], 'two seeds, two waits');
});

test('reading time is a share of a second for each person a page showed, never less', (t) => {
  const r = run(t, `
rng = random.Random(3)
out['ten'] = [ns['reading_seconds'](10, rng) for _ in range(2000)]
out['none'] = ns['reading_seconds'](0, rng)`);
  if (!r) return;
  assert.ok(Math.min(...r.out.ten) >= 4 && Math.max(...r.out.ten) <= 12);
  assert.equal(r.out.none, 0);
});

// ── the scroll ──────────────────────────────────────────────────────────────

test('a page\'s scroll is random within its bounds, and always ends at the foot', (t) => {
  const r = run(t, `
cfg = ns['PACING']['scroll']
plans = [ns['scroll_plan'](random.Random(s)) for s in range(3000)]
out['plans'] = plans[:3]
out['downs'] = sorted({sum(1 for x in p if x['kind'] == 'down') for p in plans})
out['backs'] = sorted({sum(1 for x in p if x['kind'] == 'back') for p in plans})
out['idles'] = sum(1 for p in plans if any(x['kind'] == 'idle' for x in p)) / len(plans)
out['with_back'] = sum(1 for p in plans if any(x['kind'] == 'back' for x in p)) / len(plans)
out['last'] = sorted({p[-1]['kind'] for p in plans})
out['first'] = sorted({p[0]['kind'] for p in plans})
out['deltas'] = [min(x['delta'] for p in plans for x in p if x['kind'] == 'down'), max(x['delta'] for p in plans for x in p if x['kind'] == 'down')]
out['backd'] = [min(-x['delta'] for p in plans for x in p if x['kind'] == 'back'), max(-x['delta'] for p in plans for x in p if x['kind'] == 'back')]
out['pauses'] = [min(x['pause'] for p in plans for x in p if x['kind'] != 'idle'), max(x['pause'] for p in plans for x in p if x['kind'] != 'idle')]
out['idlep'] = [min(x['pause'] for p in plans for x in p if x['kind'] == 'idle'), max(x['pause'] for p in plans for x in p if x['kind'] == 'idle')]
out['longest'] = max(ns['plan_seconds'](p) for p in plans)
out['distinct'] = len({json.dumps(p) for p in plans})
out['seeded'] = ns['scroll_plan'](random.Random(9)) == ns['scroll_plan'](random.Random(9))
out['two'] = ns['scroll_plan'](random.Random(1)) != ns['scroll_plan'](random.Random(2))`);
  if (!r) return;
  assert.deepEqual(r.out.downs, [3, 4, 5, 6, 7, 8], 'three to eight steps down, every count seen');
  assert.deepEqual(r.out.backs, [0, 1, 2], 'sometimes one scroll back up, now and then two');
  assert.ok(r.out.with_back > 0.2 && r.out.with_back < 0.3, `a scroll back on about a quarter of pages (${r.out.with_back})`);
  assert.ok(r.out.idles > 0.08 && r.out.idles < 0.16, `an idle moment on about one page in eight (${r.out.idles})`);
  assert.deepEqual(r.out.last, ['foot'], 'always to the foot of the list last');
  assert.deepEqual(r.out.first, ['down'], 'never a scroll up first');
  assert.ok(r.out.deltas[0] >= 180 && r.out.deltas[1] <= 720, 'uneven steps, within bounds');
  assert.ok(r.out.backd[0] >= 60 && r.out.backd[1] <= 260, 'a scroll back is small');
  assert.ok(r.out.pauses[0] >= 0.15 && r.out.pauses[1] <= 0.6, 'short pauses between steps');
  assert.ok(r.out.idlep[0] >= 0.8 && r.out.idlep[1] <= 2.0, 'a brief idle moment');
  assert.ok(r.out.longest < 10, `a page's scroll is short (${r.out.longest}s at most)`);
  assert.ok(r.out.distinct > 2990, 'not one fixed pattern');
  assert.equal(r.out.seeded, true);
  assert.equal(r.out.two, true, 'two seeds, two different plans');
});

test('sometimes a small scroll while waiting between pages, never in the first or last second', (t) => {
  const r = run(t, `
moves = [ns['wait_scrolls'](20, random.Random(s)) for s in range(2000)]
out['share'] = sum(1 for m in moves if m) / len(moves)
out['counts'] = sorted({len(m) for m in moves})
out['times'] = [min(a for m in moves for a, _ in m), max(a for m in moves for a, _ in m)]
out['deltas'] = sorted({abs(d) // 1 for m in moves for _, d in m})[:1] + sorted({abs(d) for m in moves for _, d in m})[-1:]
out['short'] = ns['wait_scrolls'](2, random.Random(1))`);
  if (!r) return;
  assert.ok(r.out.share > 0.3 && r.out.share < 0.4);
  assert.deepEqual(r.out.counts, [0, 1, 2]);
  assert.ok(r.out.times[0] >= 1 && r.out.times[1] <= 19);
  assert.ok(r.out.deltas[0] >= 40 && r.out.deltas[1] <= 220);
  assert.deepEqual(r.out.short, []);
});

test('breaks: a short one now and then, a longer rest every 60 pages, scaled by speed', (t) => {
  const r = run(t, `
rng = random.Random(5)
got = [ns['break_after_page'](n, rng) for n in range(1, 6001)]
out['long'] = [n for n, (s, k) in zip(range(1, 6001), got) if k == 'long'][:3]
out['shorts'] = sum(1 for s, k in got if k == 'short') / len(got)
out['short_range'] = [min(s for s, k in got if k == 'short'), max(s for s, k in got if k == 'short')]
ns['apply_pace']('slow')
out['slow'] = [ns['SHORT_BREAK'], ns['LONG_REST']]
ns['apply_pace']('fast')
out['fast'] = [ns['SHORT_BREAK'], ns['LONG_REST']]`);
  if (!r) return;
  assert.deepEqual(r.out.long, [60, 120, 180]);
  assert.ok(r.out.shorts > 0.005 && r.out.shorts < 0.02, `about one page in a hundred (${r.out.shorts})`);
  assert.ok(r.out.short_range[0] >= 60 && r.out.short_range[1] <= 150, 'a few minutes at Fast');
  assert.deepEqual(r.out.slow, [[120, 360], 480]);
  assert.deepEqual(r.out.fast, [[60, 150], 180]);
});

test('a long break says when it ends, and Stop ends any wait within a second', (t) => {
  const r = run(t, `
ok = ns['rest'](150, line='Short break')
out['ok'] = ok
out['steps'] = sorted(set(clock.sleeps))
clock.sleeps.clear()
calls = {'n': 0}
def stop_after_three():
    calls['n'] += 1
    return calls['n'] > 3
ns['stop_requested'] = stop_after_three
out['stopped'] = ns['rest'](600)
out['waited'] = sum(clock.sleeps)`);
  if (!r) return;
  assert.equal(r.out.ok, true);
  assert.ok(r.out.steps.every((s) => s <= 1), 'a second at a time');
  assert.match(r.log, /^ {2}Short break, back at \d\d:\d\d\.$/m);
  assert.match(r.log, /min to go/);
  assert.equal(r.out.stopped, false);
  assert.ok(r.out.waited <= 3, `stopped after ${r.out.waited}s, not 600`);
});

// ── the retries ─────────────────────────────────────────────────────────────

test('a page slow to load is tried again after 2, 4, 8 and 16 s, the last two reloading it, then said to be unread', (t) => {
  const r = run(t, `
page = ResultsPage()
reloads = []
def reload(p):
    reloads.append(clock.t)
    charged.append('searches')
    return True
got = ns['read_with_backoff'](page, lambda p: None, 'The page', reload=reload, rng=random.Random(1))
out['got'] = list(got)
out['bases'] = [ns['BACKOFF'][min(i, 4) - 1] for i in range(1, 7)]
out['waits'] = [ns['backoff_wait'](i, random.Random(i)) for i in range(1, 5)]
out['capped'] = ns['backoff_wait'](9, random.Random(0))
out['reloads'] = len(reloads)
out['charged'] = charged`);
  if (!r) return;
  assert.deepEqual(r.out.got, ['unread', null, 4], 'four retries, then unread');
  assert.deepEqual(r.out.bases, [2, 4, 8, 16, 16, 16], 'the curve, capped at 16');
  r.out.waits.forEach((w, i) => assert.ok(w >= [2, 4, 8, 16][i] && w <= [2, 4, 8, 16][i] + 0.5, `retry ${i + 1}: ${w}`));
  assert.ok(r.out.capped >= 16 && r.out.capped <= 16.5);
  assert.equal(r.out.reloads, 2, 'the first two look again in place; the later two reload');
  assert.deepEqual(r.out.charged, ['searches', 'searches'], 'each reload counts against the day');
  assert.match(r.log, /The page slow to load, trying again in 2 s \(attempt 1 of 4\)\./);
  assert.match(r.log, /The page slow to load, reloading it in 8 s \(attempt 3 of 4\)\./);
  assert.match(r.log, /couldn't be read\. Nothing is taken from it\./);
});

test('a page that shows up on a retry is read; LinkedIn pushing back is never retried', (t) => {
  const r = run(t, `
page = ResultsPage(blank_until=(1, NOW + 5))
got = ns['read_with_backoff'](page, lambda p: p.people() or None, 'The page', rng=random.Random(1))
out['late'] = [got[0], len(got[1]), got[2]]
for wall in ('a security check', 'being signed out', 'the account being restricted'):
    ns['_pushback'] = lambda p, w=wall: w
    looks = []
    got = ns['read_with_backoff'](page, lambda p: looks.append(1), 'The page', reload=lambda p: looks.append('reload'))
    out[wall] = [got[0], got[1], got[2], len(looks)]
ns['_pushback'] = lambda p: None
ns['_NAV']['status'] = 429
got = ns['read_with_backoff'](page, lambda p: None, 'The page', reload=lambda p: True)
out['429'] = [got[0], got[1], got[2]]`);
  if (!r) return;
  assert.deepEqual(r.out.late, ['read', 10, 2], 'found on the second retry');
  for (const wall of ['a security check', 'being signed out', 'the account being restricted']) {
    assert.deepEqual(r.out[wall], ['pushback', wall, 0, 0], `${wall}: no look, no retry, no reload`);
  }
  assert.deepEqual(r.out['429'], ['pushback', 'too many requests (HTTP 429)', 0]);
});

test('a profile\'s reload is a profile view: it waits out the minute between views, and counts', (t) => {
  const r = run(t, `
views = []
def take(page):
    views.append(clock.t)
    return None
ns['_wait_for_profile_view'] = take
page = ResultsPage()
ok = ns['_counted_reload']('profiles')(page)
out['views'] = len(views)
out['reloads'] = page.reloads
ns['_wait_for_profile_view'] = lambda page: 'budget'
out['none_left'] = [ns['_counted_reload']('profiles')(page), page.reloads]`);
  if (!r) return;
  assert.equal(r.out.views, 1);
  assert.equal(r.out.reloads, 1);
  assert.deepEqual(r.out.none_left, [null, 1], 'with no view left it doesn\'t reload');
});

// ── on top of the old read, never instead of it ─────────────────────────────

const OLD = `
ns['GENTLE']['on'] = False
old_page = ResultsPage(**SPEC)
old = read(old_page)
old_sleeps = list(clock.sleeps)
clock.sleeps.clear()
ns['GENTLE']['on'] = True
new_page = ResultsPage(**SPEC)
new = read(new_page)
new_sleeps = list(clock.sleeps)
`;

const subsequence = (small, big) => {
  let i = 0;
  for (const x of big) if (i < small.length && Math.abs(x - small[i]) < 1e-6) i += 1;
  return i === small.length;
};

test('off, a read is exactly the old one: the same waits, in the same order, and the same people', (t) => {
  const r = run(t, `
ns['GENTLE']['on'] = False
page = ResultsPage(pages=3)
urls, status, reach = read(page)
out.update(sleeps=clock.sleeps, n=len(urls), status=status, wheels=len(page.wheels), last=reach['last'])`);
  if (!r) return;
  // Before 2026-10-05: 10 s for the search, then each page 3 s, 20 s in fives, 1 s for Next to
  // land, and at the end the old three looks for a Next that isn't there (2 s, then 4 s).
  assert.deepEqual(r.out.sleeps, [10, 3, 5, 5, 5, 5, 1, 3, 5, 5, 5, 5, 1, 3, 5, 5, 5, 5, 2, 4]);
  assert.equal(r.out.n, 30);
  assert.equal(r.out.status, 'success');
  assert.equal(r.out.wheels, 0, 'no scrolling');
  assert.doesNotMatch(r.log, /Gentle|New list check|slow to load/);
});

test('on, every old wait still runs, in order and in full, and the read takes longer, never less', (t) => {
  const r = run(t, `SPEC = dict(pages=12)\n${OLD}
out.update(old=old_sleeps, new=new_sleeps, old_n=len(old[0]), new_n=len(new[0]), wheels=len(new_page.wheels))`);
  if (!r) return;
  assert.ok(subsequence(r.out.old, r.out.new), 'the old waits are all there, unchanged, in order');
  const sum = (xs) => xs.reduce((a, b) => a + b, 0);
  assert.ok(sum(r.out.new) > sum(r.out.old) * 1.1, `${sum(r.out.new)} s against ${sum(r.out.old)} s`);
  assert.equal(r.out.new_n, r.out.old_n);
  assert.ok(r.out.wheels >= 12 * 4, 'scrolled through every page');
});

test('on, a page that loads more as it scrolls is read in full: at least everyone the old read found, and the rest', (t) => {
  const r = run(t, `SPEC = dict(pages=3, lazy=3)\n${OLD}
out.update(old=old[0], new=new[0])`);
  if (!r) return;
  assert.equal(r.out.old.length, 30, 'the old read never scrolled, so it missed the late ones');
  assert.equal(r.out.new.length, 39, 'the scroll brought in the three more on each page');
  assert.ok(r.out.old.every((u) => r.out.new.includes(u)), 'everyone the old read found');
});

test('a failing new layer never changes the old result', (t) => {
  const r = run(t, `SPEC = dict(pages=4, break_layers=True)\n${OLD}
out.update(old=old[0], new=new[0], old_status=old[1], new_status=new[1], old_last=old[2]['last'], new_last=new[2]['last'])`);
  if (!r) return;
  assert.deepEqual(r.out.new, r.out.old);
  assert.equal(r.out.new_status, r.out.old_status);
  assert.equal(r.out.new_last, r.out.old_last);
});

test('when the new list check finds no list, the standard read is used and says so once', (t) => {
  const r = run(t, `SPEC = dict(pages=3, no_list=True)\n${OLD}
out.update(old=old[0], new=new[0])`);
  if (!r) return;
  assert.deepEqual(r.out.new, r.out.old);
  assert.equal((r.log.match(/New list check didn't find the list, used the standard read\./g) || []).length, 1);
});

test('a list that shows late is tried again on the curve, where the old read gave up on it', (t) => {
  const r = run(t, `
# Their list shows nobody for its first 50 seconds: past the old read's 40.
ns['GENTLE']['on'] = False
old = read(ResultsPage(pages=3, blank_until=(1, NOW + 50)))
ns['GENTLE']['on'] = True
clock.t = NOW = NOW + 10 ** 6
new = read(ResultsPage(pages=3, blank_until=(1, clock.t + 50)))
out.update(old=len(old[0]), old_status=old[1], new=len(new[0]), new_status=new[1], charged=charged)`);
  if (!r) return;
  assert.equal(r.out.old, 0);
  assert.equal(r.out.old_status, 'pushback', 'the old read took it for LinkedIn pushing back');
  assert.equal(r.out.new, 30, 'the retries waited for it, and read all of it');
  assert.equal(r.out.new_status, 'success');
  assert.match(r.log, /Their list slow to load, trying again in 2 s \(attempt 1 of 4\)\./);
});

// ── the speeds the page shows come from the same numbers ────────────────────

test('the scanner\'s pacing numbers are the page\'s (lib/scan-pace.js PACING)', async (t) => {
  const r = run(t, `out['pacing'] = ns['PACING']; out['backoff'] = list(ns['BACKOFF'])`);
  if (!r) return;
  const { PACING } = await import('../lib/scan-pace.js');
  const py = r.out.pacing;
  const camel = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k.replace(/_(\w)/g, (_, c) => c.toUpperCase()), v && typeof v === 'object' && !Array.isArray(v) ? camel(v) : v]));
  assert.deepEqual(camel(py), PACING);
  assert.deepEqual(r.out.backoff, [2, 4, 8, 16]);
});
