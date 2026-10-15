// Dev mode and manual mode (Blake, 2026-10-12).
//
// Dev mode: "a dev mode that basically removes the limits", "all settings
// within scan besides the actual slow medium fast that shouldn't be
// overridden", on "until I turn it off". Manual mode: "playwright loads up the
// window and the user has to manually scroll per page for the python to scan
// each page", read "when I scroll to the bottom".
//
// The app's side runs here directly; the scanner's runs its own code
// (scripts/scrape.py) against stand-in pages and a stand-in clock
// (tests/helpers/scanner_harness.py). Nothing opens a browser or reaches
// LinkedIn. Invented people only.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  readLimits, writeLimits, linkedinState, linkedinUsage, devMode, freesAt, DEFAULT_LIMITS, DEV_CEILING,
} from '../lib/linkedin-limits.js';
import { DEV_LINE } from '../lib/limits-lift.js';
import { inviteRefusal, INVITE_CAPS } from '../lib/auto-connect.js';
import { autoPlan, MANUAL_STOPS_AUTO } from '../lib/auto-scan.js';
import { enqueue, emptyQueue, queueView, QUEUE_CAP, DEV_QUEUE_CAP } from '../lib/scan-queue.js';
import { needsYou } from '../lib/scan-progress.js';
import { scanLight } from '../lib/scan-light.js';
import { PYTHON, noPython } from './python.mjs';
import { SCRAPER, HARNESS, noScanner } from './helpers/scanner.mjs';

const scratch = () => mkdtempSync(path.join(tmpdir(), 'sixgree-devmanual-'));
const write = (dir, name, value) => writeFileSync(path.join(dir, name), JSON.stringify(value));
const read = (dir, name) => JSON.parse(readFileSync(path.join(dir, name), 'utf8'));
const NOW = Date.UTC(2026, 9, 12, 15, 0, 0);

// The harness stands in for the scanner's count of searches; these cases want the real one.
const REAL_COUNT = `
import ast as _ast
_tree = _ast.parse(open(ns['__file__']).read())
def real(*names):
    fns = [n for n in _tree.body if isinstance(n, _ast.FunctionDef) and n.name in names]
    exec(compile(_ast.Module(body=fns, type_ignores=[]), 'scrape.py', 'exec'), ns)
real('searches_left', 'charge_linkedin')
`;

/** The scanner's own code on a data folder: `script` runs with ns, clock and out (scanner_harness.py). */
function scanner(t, home, script) {
  if (noScanner(t)) return null;
  const r = spawnSync(PYTHON, [HARNESS, SCRAPER, REAL_COUNT + script], { encoding: 'utf8', env: { ...process.env, SIX_DEGREES_HOME: home } });
  if (noPython(t, r)) return null;
  assert.equal(r.status, 0, r.stderr);
  const lines = r.stdout.trimEnd().split('\n');
  return { out: JSON.parse(lines.pop().replace(/^RESULT /, '')), log: lines.join('\n') };
}

// ── Dev mode, the app's side ──────────────────────────────────────────────────

test('both switches are off unless turned on, and a file nobody switched reads and writes as before', () => {
  const dir = scratch();
  try {
    assert.equal(DEFAULT_LIMITS.dev, false);
    assert.equal(DEFAULT_LIMITS.manual, false);
    const r = readLimits(dir);
    assert.equal(r.dev, false);
    assert.equal(r.devSince, null);
    assert.equal(r.manual, false);
    writeLimits(dir, { daily: 40 });
    assert.deepEqual(read(dir, 'scan-limits.json'), { daily: 40, pace: 'fast', gentle: true, profileReads: false });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('Dev mode notes when it was turned on, keeps that through other saves, and forgets it when off', () => {
  const dir = scratch();
  try {
    writeLimits(dir, { dev: true }, NOW);
    assert.equal(read(dir, 'scan-limits.json').devSince, Math.floor(NOW / 1000));
    writeLimits(dir, { daily: 80 }, NOW + 60_000);
    assert.equal(read(dir, 'scan-limits.json').devSince, Math.floor(NOW / 1000), 'a later save keeps when it started');
    assert.equal(readLimits(dir).dev, true);
    writeLimits(dir, { dev: false }, NOW + 120_000);
    const file = read(dir, 'scan-limits.json');
    assert.equal(file.dev, undefined);
    assert.equal(file.devSince, undefined);
    assert.equal(file.daily, 80, 'the rest is kept');
    writeLimits(dir, { manual: true });
    assert.equal(read(dir, 'scan-limits.json').manual, true);
    writeLimits(dir, { manual: 'yes' });
    assert.equal(readLimits(dir).manual, true, 'a switch that isn’t true or false keeps what is saved');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('in Dev mode nothing is left "of" a limit, the cooldown is off, and Auto has no caps', () => {
  const dir = scratch();
  try {
    const s = NOW / 1000;
    write(dir, 'linkedin-activity.json', { searches: Array(60).fill(s - 60), profiles: Array(60).fill(s - 60), invites: Array(15).fill(s - 60) });
    // A pause from before Dev mode was turned on.
    write(dir, 'linkedin-cooldown.json', { until: s + 3600, reason: 'LinkedIn pushed back: test', set_at: s - 7200 });
    writeLimits(dir, { daily: 50, dev: true }, NOW - 3600_000);
    const li = linkedinState(dir, NOW);
    assert.equal(li.dev, true);
    assert.equal(li.lifted, true, 'everything that shows "no limit" shows it');
    assert.equal(li.sessionLifted, false, 'and it is not the session’s lift');
    assert.equal(li.leftToday, null);
    assert.equal(li.profilesLeftToday, null);
    assert.equal(li.limitReached, false);
    assert.equal(li.cooldown, null);
    assert.equal(li.heldCooldown?.reason, 'LinkedIn pushed back: test');
    assert.equal(li.invitesCapped, false);
    assert.equal(inviteRefusal(li), null, 'Auto may send past 15 a day');
    const off = { ...li, dev: false, invitesCapped: true, invitesToday: INVITE_CAPS.day, invitesWeek: 20 };
    assert.match(inviteRefusal(off), /15 requests in the last 24 hours/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('LinkedIn pushing back after Dev mode was turned on turns it off, and it stays off', () => {
  const dir = scratch();
  try {
    const s = NOW / 1000;
    writeLimits(dir, { dev: true }, NOW - 3600_000);
    write(dir, 'linkedin-cooldown.json', { until: s + 86400, reason: 'LinkedIn pushed back: a security check', set_at: s - 60 });
    assert.equal(devMode(dir, NOW), null);
    assert.equal(readLimits(dir).dev, false, 'written down');
    const li = linkedinState(dir, NOW);
    assert.equal(li.dev, false);
    assert.equal(li.lifted, false);
    assert.ok(li.cooldown, 'the pause holds again');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('Auto scan in Dev mode keeps no hours but keeps its rests, which are its pace; manual mode stops it', () => {
  const night = new Date(2026, 9, 12, 3, 0, 0).getTime();
  assert.equal(autoPlan({ now: night, pace: 'medium' }).kind, 'hours');
  const any = autoPlan({ now: night, pace: 'medium', anyHour: true });
  assert.equal(any.kind, 'go');
  const resting = autoPlan({ now: night, pace: 'medium', anyHour: true, restUntil: night + 60_000 });
  assert.equal(resting.kind, 'rest', 'the rest after a sitting is the pace, and stays');
  const manual = autoPlan({ now: night, pace: 'medium', anyHour: true, manual: true });
  assert.deepEqual(manual, { kind: 'stop', as: 'stopped', reason: MANUAL_STOPS_AUTO });
});

test('the queue holds QUEUE_CAP, and DEV_QUEUE_CAP in Dev mode', () => {
  const q = emptyQueue();
  const item = (i) => ({ id: `q${i}`, action: 'bridge', target: { id: `p${i}`, name: `Invented ${i}` }, request: {}, at: i });
  for (let i = 0; i < QUEUE_CAP; i++) assert.equal(enqueue(q, item(i)).queued, true);
  assert.equal(enqueue(q, item(QUEUE_CAP)).full, true);
  assert.equal(enqueue(q, item(QUEUE_CAP), null, { cap: DEV_QUEUE_CAP }).queued, true);
  assert.equal(queueView(q).cap, QUEUE_CAP);
  assert.equal(queueView(q, { cap: DEV_QUEUE_CAP }).cap, DEV_QUEUE_CAP);
});

test('the notch says what manual mode needs from you, and lets go once that person is done', () => {
  assert.equal(needsYou(['  Opening their connections...', 'LinkedIn needs you: scroll to the bottom of each page.']), 'scroll to the bottom of each page.');
  assert.equal(needsYou(['LinkedIn needs you: scroll to the bottom of each page.', '  Page 1... 10 found (total: 10)',
    'Manual read done: 1 page of Invented Bridge\'s list.']), null);
});

// ── Dev mode, the scanner's side ─────────────────────────────────────────────

test('the scanner reads Dev mode from the file the app writes, and lifts what the app lifts', (t) => {
  const home = scratch();
  try {
    writeLimits(home, { daily: 1, dev: true }, Date.now() - 60_000);
    const r = scanner(t, home, `
import time as _t
ns['time'] = _t
out['dev'] = ns['dev_mode']()
out['lifted'] = ns['limits_lifted']()
ns['charge_linkedin']('searches')
out['left'] = ns['searches_left']()
data = ns['_read_activity']()
data['invites'] = [_t.time() - 60] * 20
ns['_write_json_atomic'](ns['_home']() / 'linkedin-activity.json', data)
out['invite'] = ns['take_invite']()
out['invites'] = len(ns['_read_activity']()['invites'])
out['gap'] = ns['PROFILE_GAP']`);
    if (!r) return;
    assert.equal(r.out.dev, true);
    assert.equal(r.out.lifted, true);
    // Past the daily limit of 1; Dev mode's ceiling is the one that counts (2026-10-14).
    assert.deepEqual(r.out.left, [249, 'daily'], 'no daily limit, only the ceiling');
    assert.equal(r.out.invite, null, 'past Auto’s 15 a day');
    assert.equal(r.out.invites, 21, 'and still written down');
    assert.equal(r.out.gap, 60, 'the gap between profile views is the speed’s, untouched');
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test('the scanner turns Dev mode off when LinkedIn pushes back, and the app sees it off', (t) => {
  const home = scratch();
  try {
    writeLimits(home, { dev: true, manual: true }, Date.now() - 60_000);
    const r = scanner(t, home, `
import time as _t
ns['time'] = _t
ns['set_cooldown'](seconds=86400, reason='LinkedIn pushed back: test')
out['dev'] = ns['dev_mode']()
out['lifted'] = ns['limits_lifted']()
out['cooldown'] = bool(ns['read_cooldown']())`);
    if (!r) return;
    assert.equal(r.out.dev, false);
    assert.equal(r.out.lifted, false);
    assert.equal(r.out.cooldown, true);
    assert.match(r.log, /Dev mode is off/);
    assert.equal(readLimits(home).dev, false);
    assert.equal(readLimits(home).manual, true, 'manual mode is left as it was');
    assert.equal(linkedinState(home).dev, false);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test('Auto scan\'s sittings keep no hours in Dev mode, in the scanner too', (t) => {
  const home = scratch();
  try {
    const r = scanner(t, home, `
from datetime import datetime
night = datetime(2026, 10, 12, 3, 0).timestamp()
ns['EXPERIMENT'].update(on=True, sitting=4, pages=0)
out['off'] = ns['_sitting_over'](night)
(ns['_home']() / 'scan-limits.json').write_text(json.dumps({'daily': 50, 'dev': True, 'devSince': night - 60}))
out['on'] = ns['_sitting_over'](night)`);
    if (!r) return;
    assert.match(r.out.off, /outside Auto scan's hours/);
    assert.equal(r.out.on, null);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

// ── Dev mode's ceiling (Fix 1, 2026-10-14) ───────────────────────────────────
// Blake chose 250 search pages a day after two restrictions: 373 search pages in 24
// hours (9/28), and 305 with Dev mode on (10/12), which took off every limit Sixgree
// sets. Dev mode keeps this one, over the daily limit's own rolling 24 hours.

// A stand-in record of searches, and the settings file, for the scanner's cases.
const RECORD = `
NOW_S = clock.t
def record(searches):
    ns['_write_json_atomic'](ns['_home']() / 'linkedin-activity.json', {'searches': searches, 'profiles': [], 'invites': []})
def settings(**kw):
    (ns['_home']() / 'scan-limits.json').write_text(json.dumps(kw))
DEV = {'dev': True, 'devSince': NOW_S - 3600}
def in_day():
    return len([s for s in ns['_read_activity']()['searches'] if s > clock.t - 86400])
`;

test('Dev mode keeps one limit, its ceiling: 250 search pages over the same rolling 24 hours the daily limit counts', (t) => {
  const home = scratch();
  try {
    const r = scanner(t, home, `${RECORD}
# 249 in the last 24 hours; 5 exactly a day old and 100 older, which neither limit counts.
record([NOW_S - 60 * (i + 1) for i in range(249)] + [NOW_S - 86400] * 5 + [NOW_S - 86401 - i for i in range(100)])
out['ceiling'] = ns['DEV_CEILING']
settings(daily=1, **DEV)
out['dev'] = ns['searches_left']()
settings(daily=250)
out['daily'] = ns['searches_left']()
settings(daily=1, **DEV)
ns['charge_linkedin']('searches')
out['at'] = ns['searches_left']()
out['line'] = ns['budget_message']('daily')
out['now'] = clock.t`);
    if (!r) return;
    assert.equal(r.out.ceiling, 250);
    assert.deepEqual(r.out.dev, [1, 'daily'], 'past the daily limit of 1, one short of the ceiling');
    assert.deepEqual(r.out.daily, [1, 'daily'], 'a daily limit of 250 counts the very same window');
    assert.deepEqual(r.out.at, [0, 'daily'], 'reached: it stops wherever the daily limit stops a scan');
    assert.match(r.out.line, /^Dev mode's ceiling: 250 search pages a day, reached\. Scanning resumes when the oldest of them is a day old, at .+\. The next run carries on from the same page\.$/);
    assert.doesNotMatch(r.out.line, /Today's limit of|lift limits/i, 'not the daily limit\'s words: the app would offer a lift that doesn\'t lift it');

    // The app counts the same window, from the same files.
    const now = r.out.now * 1000;
    const li = linkedinState(home, now);
    assert.equal(li.dev, true);
    assert.equal(li.devCeiling, DEV_CEILING);
    assert.equal(li.devLeftToday, 0);
    assert.equal(li.leftToday, null, 'the daily limit is still off in Dev mode');
    const searches = JSON.parse(readFileSync(path.join(home, 'linkedin-activity.json'), 'utf8')).searches;
    assert.equal(linkedinUsage(home, now).devFreesAt, freesAt(searches, now, DEV_CEILING));
    writeLimits(home, { dev: false }, now);
    const off = linkedinState(home, now);
    assert.deepEqual([off.devCeiling, off.devLeftToday, off.leftToday], [null, null, 0], 'Dev mode off: the daily limit, as before');
    assert.equal(linkedinUsage(home, now).devFreesAt, null);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test('a scan in Dev mode runs past the daily limit below the ceiling, and stops at it with a plain line', (t) => {
  const home = scratch();
  try {
    const r = scanner(t, home, `${RECORD}
ns['GENTLE']['on'] = False
settings(daily=1, **DEV)
def run(pages):
    urls, status, reach = read(ResultsPage(pages=pages))
    return {'people': len(urls), 'status': status, 'last': reach['last'], 'more': reach['more'],
            'budget': reach.get('budget'), 'searches': in_day()}
record([NOW_S - 60 * (i + 1) for i in range(200)])
out['below'] = run(3)
record([NOW_S - 60 * (i + 1) for i in range(248)])
out['at'] = run(5)
out['again'] = run(5)`);
    if (!r) return;
    assert.deepEqual(r.out.below, { people: 30, status: 'success', last: 3, more: false, budget: null, searches: 203 },
      'all of a three-page list, past the daily limit of 1');
    assert.deepEqual(r.out.at, { people: 20, status: 'success', last: 2, more: true, budget: 'daily', searches: 250 },
      'the list and one Next take it to 250; page 3 is left for later, never noted as read');
    assert.deepEqual(r.out.again, { people: 0, status: 'budget', last: 0, more: true, budget: 'daily', searches: 250 },
      'at the ceiling nothing more opens');
    assert.equal((r.log.match(/^ {2}Dev mode's ceiling: 250 search pages a day, reached\./gm) || []).length, 2);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test('with Dev mode off the ceiling changes nothing: the daily limit as before, and a lift for the session has no end', (t) => {
  const home = scratch();
  try {
    const r = scanner(t, home, `${RECORD}
record([NOW_S - 60 * (i + 1) for i in range(300)])
settings(daily=50)
out['off'] = ns['searches_left']()
out['line'] = ns['budget_message']('daily')
settings(daily=400)
out['high'] = ns['searches_left']()
ns['LIMITS']['lifted'] = True
out['lifted'] = ns['searches_left']()[0] >= 10 ** 9
settings(daily=50, **DEV)
out['lifted_dev'] = ns['searches_left']()
ns['LIMITS']['lifted'] = False
(ns['_home']() / 'linkedin-activity.json').write_text('{"searches": [1, 2')
out['damaged'] = ns['searches_left']()`);
    if (!r) return;
    assert.deepEqual(r.out.damaged, [0, 'daily'], 'a record that can\'t be read counts as the ceiling used, never as room');
    assert.deepEqual(r.out.off, [0, 'daily']);
    assert.match(r.out.line, /^Today's limit of 50 searches is used/);
    assert.deepEqual(r.out.high, [100, 'daily'], 'a daily limit set above 250 is the person\'s choice, as before');
    assert.equal(r.out.lifted, true, '300 in the last 24 hours, and the session\'s lift still has no end');
    assert.deepEqual(r.out.lifted_dev, [0, 'daily'], 'Dev mode on as well: its ceiling holds');
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test('the notch, LinkedIn usage and the Scan page show Dev mode\'s ceiling, not "no limit"', () => {
  const src = (f) => readFileSync(new URL(`../${f}`, import.meta.url), 'utf8');
  assert.ok(DEV_LINE.includes(`ceiling of ${DEV_CEILING} search pages`), 'Dev mode\'s own words name the number');
  // The notch while a scan runs: the route hands it the ceiling, and it shows "N of 250".
  assert.match(src('app/api/scraper/route.js'), /devCeiling: li\.devCeiling/);
  assert.match(src('app/components/ScanStatusBar.js'), /b\.dev && b\.devCeiling \? ` of \$\{b\.devCeiling\}`/);
  // LinkedIn usage: the meter is "of 250" with a mark there, never "no limit in Dev mode".
  const usage = src('app/components/settings/UsageSection.js');
  assert.match(usage, /of \$\{u\.devCeiling\}, Dev mode’s ceiling/);
  assert.match(usage, /label: `\$\{u\.devCeiling\} ceiling`/);
  assert.doesNotMatch(usage, /no limit in Dev mode/);
  // The Scan page's Dev mode switch.
  const page = src('app/setup/page.js');
  const sw = page.slice(page.indexOf('data-dev-mode-switch'), page.indexOf('more={', page.indexOf('data-dev-mode-switch')));
  assert.match(sw, /a ceiling of \$\{li\.devCeiling\} search pages in any 24 hours/);
  assert.doesNotMatch(page, /no daily limit in Dev mode/);
});

// ── Manual mode, the scanner's side ──────────────────────────────────────────

// Their list as a window in front of you, and you working it: `plan` is a list of
// [seconds from now, what], what being "foot" (scroll to the bottom), "next"
// (click Next), ["go", n] (open page n), or "close" (close the window).
const MANUAL_PAGE = `
URN = 'ACoAAInventedUrn'
class ManualPage:
    """url_follows: Next changes the address too (False: only the page bar moves, as
    LinkedIn did on 2026-10-12). lag: seconds the list still shows the last page's
    people after Next. bar: the page bar is there (CURRENT_PAGE_JS answers)."""
    def __init__(self, pages, plan, hidden=(), url_follows=True, lag=0, bar=True, start=1):
        self.pages, self.plan, self.hidden = pages, sorted(plan, key=lambda x: x[0]), set(hidden)
        self.url_follows, self.lag, self.bar = url_follows, lag, bar
        self.pg = self.url_pg = start
        self.foot, self.closed, self.read_at, self.prev, self.moved_at = False, False, [], None, None
    def _act(self):
        while self.plan and NOW + self.plan[0][0] <= clock.t:
            _, what = self.plan.pop(0)
            if what == 'foot': self.foot = True
            elif what == 'close': self.closed = True
            elif what == 'next' or (isinstance(what, list) and what[0] == 'go'):
                self.prev, self.moved_at = self.pg, clock.t
                self.pg = self.pg + 1 if what == 'next' else what[1]
                if self.url_follows: self.url_pg = self.pg
                self.foot = False
    def _showing(self):
        if self.lag and self.prev is not None and clock.t - self.moved_at < self.lag:
            return self.prev
        return self.pg
    def _people(self):
        shows = self._showing()
        return [] if shows in self.hidden else [person((shows - 1) * 10 + i) for i in range(10)]
    @property
    def url(self):
        self._act()
        return ('https://www.linkedin.com/search/results/people/?network=%5B%22F%22%5D'
                '&connectionOf=%5B%22' + URN + '%22%5D&page=' + str(self.url_pg))
    def goto(self, url, **_):
        self.pg = self.url_pg = ns['_url_page'](url)
        return types.SimpleNamespace(status=200)
    def wait_for_selector(self, *a, **k):
        if not self._people(): raise TimeoutError('no results')
    def is_closed(self):
        self._act()
        return self.closed
    def evaluate(self, js, *a):
        self._act()
        if js == ns['AT_FOOT_JS']: return self.foot
        if js == ns['NEXT_STATE_JS']: return 'on' if self.pg < self.pages else 'off'
        if js == ns['CURRENT_PAGE_JS']: return self.pg if self.bar else None
        if js == ns['RESULT_COUNT_JS']: return self.pages * 10
        if js == ns['RESULT_LINKS_JS']: return sorted(p['profileUrl'] for p in self._people())
        if js == ns['BRIDGE_RESULTS_JS']:
            people = self._people()
            if people: self.read_at.append([self.pg, clock.t - NOW, self._showing()])
            return people
        return None

def read_by_hand(page, total=None, max_pages=100, start=1):
    reach = {'last': start - 1, 'more': False, 'urn': URN, 'found': 0, 'limited': False, 'pushed_back': False}
    saved = []
    people, status, reach = ns['_read_by_hand'](page, 'Invented Bridge', 'https://www.linkedin.com/in/invented-bridge/',
                                                'invented-bridge', start, max_pages, reach,
                                                lambda c, last, more, urn: saved.append([len(c), last]), total)
    try:
        searches = len(ns['_read_activity']()['searches'])
    except Exception:
        searches = None
    return {'people': len(people), 'status': status, 'last': reach['last'], 'more': reach['more'],
            'budget': reach.get('budget'), 'saved': saved, 'read_at': page.read_at, 'searches': searches,
            'stopped': ns['stop_requested']()}
`;

test('manual mode reads a page only once you reach its foot, once each, and counts each page you open as a search', (t) => {
  const home = scratch();
  try {
    const r = scanner(t, home, `${MANUAL_PAGE}
page = ManualPage(3, [[5, 'foot'], [9, 'next'], [20, 'foot'], [25, 'next'], [26, 'foot']])
out.update(read_by_hand(page, total=30))`);
    if (!r) return;
    assert.equal(r.out.people, 30);
    assert.equal(r.out.status, 'success');
    assert.equal(r.out.last, 3);
    assert.equal(r.out.more, false, 'their list ended: Next was off on page 3');
    assert.deepEqual(r.out.read_at.map(([pg]) => pg), [1, 2, 3], 'each page read once');
    assert.ok(r.out.read_at[0][1] >= 5, 'page 1 waited for the foot');
    assert.ok(r.out.read_at[1][1] >= 20, 'page 2 waited for the foot, not the click');
    assert.equal(r.out.searches, 2, 'pages 2 and 3 are searches you made (page 1 was the scanner’s)');
    assert.match(r.log, /LinkedIn needs you: scroll to the bottom of each page of Invented Bridge's connections/);
    assert.match(r.log, /^ {2}Page 2\.\.\. 10 found \(total: 20\)$/m, 'the line the app counts pages by');
    assert.match(r.log, /That's the end of their list/);
    assert.match(r.log, /^Manual read done: 3 pages of Invented Bridge's list\.$/m);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test('manual mode: closing the window is done with that person, never a stop, and keeps what was read', (t) => {
  const home = scratch();
  try {
    const r = scanner(t, home, `${MANUAL_PAGE}
page = ManualPage(8, [[3, 'foot'], [6, 'next'], [9, 'foot'], [12, 'close']])
out.update(read_by_hand(page, total=80))`);
    if (!r) return;
    assert.equal(r.out.people, 20);
    assert.equal(r.out.status, 'success');
    assert.equal(r.out.last, 2);
    assert.equal(r.out.more, true, 'the rest of their list is left for later');
    assert.equal(r.out.stopped, false, 'a round moves on to the next person');
    assert.match(r.log, /The window was closed: done with Invented Bridge/);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test('manual mode: a page you skip to is kept, but never notes the pages between as read', (t) => {
  const home = scratch();
  try {
    const r = scanner(t, home, `${MANUAL_PAGE}
page = ManualPage(6, [[3, 'foot'], [6, ['go', 4]], [9, 'foot'], [12, 'close']])
out.update(read_by_hand(page, total=60))`);
    if (!r) return;
    assert.equal(r.out.people, 20, 'pages 1 and 4');
    assert.equal(r.out.last, 1, 'pages 2 and 3 were never read');
    assert.equal(r.out.more, true);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test('manual mode: with nothing read for ten minutes the scan stops, so no window waits for nobody', (t) => {
  const home = scratch();
  try {
    const r = scanner(t, home, `${MANUAL_PAGE}
page = ManualPage(3, [])
out.update(read_by_hand(page, total=30))`);
    if (!r) return;
    assert.equal(r.out.people, 0);
    assert.equal(r.out.status, 'stopped');
    assert.equal(r.out.stopped, true);
    assert.match(r.log, /No new page for 10 minutes/);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test('manual mode keeps the daily limit, and Dev mode takes it off', (t) => {
  const home = scratch();
  try {
    const plan = "[[3, 'foot'], [6, 'next'], [9, 'foot'], [12, 'close']]";
    const r = scanner(t, home, `${MANUAL_PAGE}
(ns['_home']() / 'scan-limits.json').write_text(json.dumps({'daily': 1}))
ns['charge_linkedin']('searches')
out['limited'] = read_by_hand(ManualPage(3, ${plan}), total=30)
(ns['_home']() / 'scan-limits.json').write_text(json.dumps({'daily': 1, 'dev': True, 'devSince': clock.t - 60}))
out['dev'] = read_by_hand(ManualPage(3, [[x + 20, w] for x, w in ${plan}]), total=30)`);
    if (!r) return;
    assert.equal(r.out.limited.status, 'budget');
    assert.equal(r.out.limited.budget, 'daily');
    assert.equal(r.out.limited.people, 10, 'page 1 was read before the limit held page 2 back');
    assert.equal(r.out.dev.people, 20, 'in Dev mode page 2 is read too');
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test('manual mode: LinkedIn\'s Next can leave the address on the old page; the page bar says which page it is', (t) => {
  const home = scratch();
  try {
    const r = scanner(t, home, `${MANUAL_PAGE}
page = ManualPage(3, [[3, 'foot'], [6, 'next'], [9, 'foot'], [12, 'next'], [15, 'foot']], url_follows=False)
out.update(read_by_hand(page, total=30))`);
    if (!r) return;
    assert.equal(r.out.people, 30, 'pages 2 and 3 are read although the address still says page 1');
    assert.equal(r.out.last, 3);
    assert.equal(r.out.more, false);
    assert.equal(r.out.searches, 2);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test('manual mode never reads a page while it still shows the last page\'s people, and says why it waits', (t) => {
  const home = scratch();
  try {
    const r = scanner(t, home, `${MANUAL_PAGE}
page = ManualPage(3, [[3, 'foot'], [6, 'next'], [7, 'foot'], [40, 'close']], lag=15)
out.update(read_by_hand(page, total=30))`);
    if (!r) return;
    assert.equal(r.out.people, 20, 'twenty different people: page 1 is never saved again as page 2');
    const two = r.out.read_at.find(([pg]) => pg === 2);
    assert.ok(two && two[2] === 2, 'page 2 was read showing page 2’s people');
    assert.ok(two[1] >= 21, 'once the list had changed');
    assert.match(r.log, /\(waiting: page 2 still shows the last page's people/);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test('manual mode says what it waits for when you are at the foot of a page with no one on it yet', (t) => {
  const home = scratch();
  try {
    const r = scanner(t, home, `${MANUAL_PAGE}
page = ManualPage(3, [[3, 'foot'], [30, 'close']], hidden=(1,))
out.update(read_by_hand(page, total=30))`);
    if (!r) return;
    assert.equal(r.out.people, 0);
    assert.match(r.log, /\(waiting: page 1 shows no one yet/);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test('manual mode: a window a page ahead says to go back for the page it opened for, and never stops the read', (t) => {
  const home = scratch();
  try {
    const r = scanner(t, home, `${MANUAL_PAGE}
page = ManualPage(12, [[1, 'next'], [30, 'foot'], [40, 'close']], start=9)
people, status, reach = ns['_scrape_one_bridge'](page, 'Invented Bridge', 'b1', 'https://www.linkedin.com/in/invented-bridge/',
                                                start_page=9, urn=URN, manual=True)
out.update({'people': len(people), 'status': status, 'last': reach['last'], 'more': reach['more']})`);
    if (!r) return;
    assert.doesNotMatch(r.log, /Stopping so no page is noted/);
    // The page bar ahead of the page it opened for: it says to go back for that page first
    // (Blake, 2026-10-12: page 51 was never read, so every scan started there again).
    assert.match(r.log, /LinkedIn's page bar shows page 10, not page 9\./);
    assert.match(r.log, /LinkedIn needs you: LinkedIn's page bar shows page 10, and page 9 isn't read yet\. Click Previous to page 9/);
    assert.match(r.log, /page 10 is read \(10 people\)\. Page 9 isn't read yet, so the next scan starts there again/);
    assert.equal(r.out.status, 'success');
    assert.equal(r.out.people, 10, 'page 10 is read');
    assert.equal(r.out.last, 8, 'page 9 was never read, so it is never noted as read');
    assert.equal(r.out.more, true);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test('manual mode: going back to the page it opened for fills the gap, and the bookmark moves on', (t) => {
  // Blake, 2026-10-12: the list opened at page 51, the page bar said 52 and the address
  // still 51; read on from 52, page 51 stayed the bookmark. Back to 51 first, then on.
  const home = scratch();
  try {
    const r = scanner(t, home, `${MANUAL_PAGE}
class Ahead(ManualPage):
    def goto(self, url, **k):
        out = super().goto(url, **k)
        self.pg = self.url_pg + 1     # the page bar a page ahead of the address, as on 2026-10-12
        return out
page = Ahead(60, [[14, ['go', 51]], [18, 'foot'], [22, 'next'], [28, 'foot'], [34, 'close']], url_follows=False, start=51)
people, status, reach = ns['_scrape_one_bridge'](page, 'Invented Bridge', 'b1', 'https://www.linkedin.com/in/invented-bridge/',
                                                start_page=51, urn=URN, manual=True)
out.update({'people': len(people), 'status': status, 'last': reach['last'], 'read': [x[0] for x in page.read_at]})`);
    if (!r) return;
    assert.match(r.log, /Click Previous to page 51 and scroll to its bottom, then carry on with Next/);
    assert.deepEqual(r.out.read, [51, 52]);
    assert.equal(r.out.last, 52, 'both read in order: the next scan starts at 53');
    assert.equal(r.out.people, 20);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

// The app's own two patterns for a page read and what it found (app/api/scraper/route.js
// PAGE_READ, PAGE_FOUND), taken from its source so a change there is checked here too.
function routePattern(name) {
  const route = readFileSync(new URL('../app/api/scraper/route.js', import.meta.url), 'utf8');
  const m = route.match(new RegExp(`const ${name} = /(.+)/;`));
  return new RegExp(m[1]);
}

test('manual mode says each change the moment it happens, once: on a new page, a page loading, back on their list', (t) => {
  // For the scan light (lib/scan-light.js): the wait notes come only after MANUAL_SAY
  // seconds and never say a wait is over, so after Next the light would still say
  // "Click Next", and "go back" would stay red after you had.
  const home = scratch();
  try {
    const r = scanner(t, home, `${MANUAL_PAGE}
class Wander(ManualPage):
    """Off their list (your feed) from 30 to 45 seconds."""
    @property
    def url(self):
        u = ManualPage.url.fget(self)
        return 'https://www.linkedin.com/feed/' if 30 <= clock.t - NOW < 45 else u
page = Wander(4, [[3, 'foot'], [6, 'next'], [9, 'foot'], [50, 'next'], [53, 'foot'], [75, 'close']], lag=12)
out.update(read_by_hand(page, total=40))`);
    if (!r) return;
    assert.equal(r.out.people, 30);
    const count = (re) => (r.log.match(re) || []).length;
    assert.equal(count(/^ {2}\(on page 2: scroll to its bottom and it's read\)$/gm), 1, 'after Next, at once and once');
    assert.equal(count(/^ {2}\(on page 3: scroll to its bottom and it's read\)$/gm), 1);
    assert.equal(count(/\(on page 1\b/g), 0, 'the page it opened at: the opening line said what to do');
    assert.equal(count(/^ {2}\(page 2 is loading\)$/gm), 1, 'the old people still showing, said once');
    assert.equal(count(/^ {2}\(back on their list, page 2\)$/gm), 1);
    const at = (re) => r.log.search(re);
    assert.ok(at(/\(on page 2: scroll/) < at(/\(page 2 is loading\)/), 'on the page, then loading');
    assert.ok(at(/\(page 2 is loading\)/) < at(/Page 2\.\.\. 10 found/), 'loading, then read');
    assert.ok(at(/\(waiting: the window isn't on Invented Bridge's list/) < at(/\(back on their list, page 2\)/), 'away, then back');
    // The 8-second notes are still there, for people reading the log.
    assert.match(r.log, /\(waiting: page 2 still shows the last page's people/);
    // The app still counts the pages the same way: three read, ten people each.
    const lines = r.log.split('\n').map((l) => l.replace(/\s+$/, '')).filter(Boolean);
    const PAGE_READ = routePattern('PAGE_READ');
    const PAGE_FOUND = routePattern('PAGE_FOUND');
    assert.equal(lines.filter((l) => PAGE_READ.test(l)).length, 3, 'none of the new lines is taken for a page');
    assert.deepEqual(lines.map((l) => l.match(PAGE_FOUND)?.[1]).filter(Boolean), ['10', '10', '10']);
    assert.equal(needsYou(lines), null, 'and the read is over once it says so');
    assert.match(needsYou(lines.slice(0, lines.findIndex((l) => l.includes('(page 2 is loading)')) + 1)), /^page 1 is read/,
      'the new lines leave "LinkedIn needs you" as it was');
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test('manual mode: while the page bar is drawn again between pages, no page is guessed from the address', (t) => {
  // Blake's log, 2026-10-12: "scroll to the bottom of page 1" on the way from page 55 to 56,
  // with a search counted for a page 1 nobody opened.
  const home = scratch();
  try {
    const r = scanner(t, home, `${MANUAL_PAGE}
class Redraw(ManualPage):
    def _between(self):
        return self.moved_at is not None and clock.t - self.moved_at < 3
    def evaluate(self, js, *a):
        self._act()
        if js == ns['CURRENT_PAGE_JS'] and self._between(): return None
        return super().evaluate(js, *a)
    @property
    def url(self):
        u = ManualPage.url.fget(self)
        return u.split('&page=')[0] if self._between() else u
page = Redraw(60, [[2, 'foot'], [10, 'next'], [16, 'foot'], [22, 'close']], url_follows=False, start=55)
out.update(read_by_hand(page, start=55))`);
    if (!r) return;
    assert.deepEqual(r.out.read_at.map((x) => x[0]), [55, 56]);
    assert.equal(r.out.last, 56);
    assert.doesNotMatch(r.log, /page 1\b/, 'no page 1 guessed from an address naming no page');
    assert.equal(r.out.searches, 1, 'one search: page 56; none for a page nobody opened');
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test('each run keeps its own log in the data folder, the newest 40', (t) => {
  // Blake, 2026-10-12: a run that went wrong, stopped and started again, left nothing to say why.
  const home = scratch();
  try {
    const r = scanner(t, home, `
import pathlib
folder = pathlib.Path(ns['_home']()) / 'logs'
folder.mkdir(parents=True, exist_ok=True)
for i in range(45):
    (folder / f'scan-2026-01-01_0000{i:02d}.log').write_text('old')
path = ns['keep_run_log'](['--bridge', 'Invented Bridge'])
print('  Page 3... 10 found (total: 30)', flush=True)
import sys
sys.stdout.flush()
out['kept'] = len(list(folder.glob('scan-*.log')))
out['text'] = path.read_text()
out['oldest_gone'] = not (folder / 'scan-2026-01-01_000000.log').exists()`);
    if (!r) return;
    assert.match(r.log, /Page 3\.\.\. 10 found/, 'the app still sees every line');
    assert.match(r.out.text, /scrape\.py --bridge Invented Bridge/);
    assert.match(r.out.text, /Page 3\.\.\. 10 found \(total: 30\)/);
    assert.equal(r.out.kept, 40);
    assert.equal(r.out.oldest_gone, true);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test('manual mode: sent to the restriction page mid-list is push-back, not "go back to it"', (t) => {
  // Blake, 2026-10-12: page 69, then LinkedIn's "Your account has been temporarily restricted";
  // the read said the window wasn't on the list, so no pause was written and Dev mode stayed on.
  const home = scratch();
  try {
    const r = scanner(t, home, `${MANUAL_PAGE}
RESTRICTED = 'https://www.linkedin.com/checkpoint/restricted/'
class Restricted(ManualPage):
    @property
    def url(self):
        u = ManualPage.url.fget(self)
        return RESTRICTED if clock.t - NOW >= 12 else u
    def evaluate(self, js, *a):
        if js == ns['PUSHBACK_JS']:
            return 'the account being restricted' if clock.t - NOW >= 12 else None
        return super().evaluate(js, *a)
page = Restricted(60, [[2, 'foot'], [8, 'next']], start=1)
out.update(read_by_hand(page))
class Away(ManualPage):
    @property
    def url(self):
        return 'https://www.linkedin.com/feed/' if clock.t - NOW >= 5 else ManualPage.url.fget(self)
    def is_closed(self):
        return clock.t - NOW >= 30
away = Away(60, [[2, 'foot']], start=1)
out['away'] = read_by_hand(away)['status']`);
    if (!r) return;
    assert.equal(r.out.status, 'pushback');
    assert.equal(r.out.last, 1, 'the page read before it is kept');
    assert.match(r.log, /LinkedIn is pushing back \(the account being restricted\)\. Stopping here\./);
    assert.equal(r.out.away, 'success', 'any other page: it waits for you, as before');
    assert.match(r.log, /the window isn't on Invented Bridge's list/);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

// ── An automatic read carrying a list on (Fix 2, 2026-10-14) ──────────────────
// Asked for page N, LinkedIn opened page N + 1, four times (9 to 10, 30 to 31, 51 to 52,
// 64 to 65), the address and the page bar both. It used to stop every time, so no
// automatic read could carry a list on. Exactly one page ahead, it now clicks Previous
// once and reads on from N; anything else stops as before.

// A list that opens `off_by` pages past the one asked for. `prev`: a Previous button is
// there; `back`: how many pages it goes back. Records the pages read, in order, and when
// the list opened and Previous was clicked.
const AHEAD_PAGE = `
ns['GENTLE']['on'] = False
class Previous:
    def __init__(self, page):
        self.page = page
    @property
    def first(self):
        return self
    def is_visible(self):
        return self.page.prev and self.page.pg > 1
    def is_enabled(self):
        return True
    def click(self, timeout=None):
        self.page.prev_at.append(clock.t)
        self.page.pg -= self.page.back
        self.page.scrolled = 0

class Ahead(ResultsPage):
    def __init__(self, *a, off_by=1, prev=True, back=1, **k):
        super().__init__(*a, **k)
        self.off_by, self.prev, self.back = off_by, prev, back
        self.reads, self.prev_at, self.opened_at = [], [], None
    def goto(self, url, **k):
        if 'connectionOf' in url:
            self.pg = ns['_url_page'](url) + self.off_by
            self.opened_at = clock.t
        return super().goto(url, **k)
    def locator(self, selector):
        return Previous(self) if 'Previous' in selector else super().locator(selector)
    def evaluate(self, js, *a):
        if js == ns['BRIDGE_RESULTS_JS'] and (not self.reads or self.reads[-1] != self.pg):
            self.reads.append(self.pg)
        return super().evaluate(js, *a)

def carry_on(page, start_page=9):
    urls, status, reach = read(page, start_page=start_page)
    return {'people': len(urls), 'status': status, 'last': reach['last'], 'more': reach['more'],
            'reads': page.reads, 'prev_clicks': len(page.prev_at),
            'prev_after': page.prev_at[0] - page.opened_at if page.prev_at else None,
            'searches': len(ns['_read_activity']()['searches'])}
`;

test('an automatic read that LinkedIn opens one page ahead goes back with Previous, then reads on from the page asked for', (t) => {
  const home = scratch();
  try {
    const r = scanner(t, home, `${AHEAD_PAGE}
out.update(carry_on(Ahead(pages=12, off_by=1)))
out['pause'] = ns['PAGE_PAUSE']`);
    if (!r) return;
    assert.match(r.log, /LinkedIn opened page 10, not page 9: going back a page with Previous\./);
    assert.match(r.log, /Back on page 9\./);
    assert.doesNotMatch(r.log, /Stopping so no page is noted/);
    assert.equal(r.out.prev_clicks, 1, 'Previous, once');
    assert.ok(r.out.prev_after >= r.out.pause, `the pause before a page holds before Previous too (${r.out.prev_after}s)`);
    assert.deepEqual(r.out.reads, [9, 10, 11, 12], 'page 9 first, then on in order');
    assert.equal(r.out.status, 'success');
    assert.equal(r.out.people, 40);
    assert.equal(r.out.last, 12, 'the bookmark ends at the last page read');
    assert.equal(r.out.more, false);
    assert.equal(r.out.searches, 5, 'the list, Previous, then Next three times: Previous is a search');
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test('an automatic read that LinkedIn opens on any other page still stops, as before', (t) => {
  const home = scratch();
  try {
    const r = scanner(t, home, `${AHEAD_PAGE}
out['two'] = carry_on(Ahead(pages=12, off_by=2))
out['behind'] = carry_on(Ahead(pages=12, off_by=-1))`);
    if (!r) return;
    assert.match(r.log, /LinkedIn opened page 11, not page 9\. Stopping so no page is noted as read that wasn't\./);
    assert.match(r.log, /LinkedIn opened page 8, not page 9\. Stopping so no page is noted as read that wasn't\./);
    assert.doesNotMatch(r.log, /going back a page with Previous/);
    for (const k of ['two', 'behind']) {
      assert.equal(r.out[k].status, 'error', k);
      assert.equal(r.out[k].prev_clicks, 0, `${k}: no Previous`);
      assert.deepEqual(r.out[k].reads, [], `${k}: nothing read`);
      assert.equal(r.out[k].last, 8, `${k}: nothing noted as read`);
      assert.equal(r.out[k].more, true);
    }
    assert.equal(r.out.behind.searches, 2, 'one search each: the list');
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test('one page ahead, but no Previous, or a Previous that lands anywhere but the page asked for, stops as before', (t) => {
  const home = scratch();
  try {
    const r = scanner(t, home, `${AHEAD_PAGE}
out['none'] = carry_on(Ahead(pages=12, off_by=1, prev=False))
out['two_back'] = carry_on(Ahead(pages=12, off_by=1, back=2))`);
    if (!r) return;
    assert.match(r.log, /Previous didn't take it back a page\./);
    assert.match(r.log, /After Previous it's on page 8, not page 9\./);
    assert.equal((r.log.match(/LinkedIn opened page 10, not page 9\. Stopping so no page is noted as read that wasn't\./g) || []).length, 2);
    assert.equal(r.out.none.prev_clicks, 0);
    assert.equal(r.out.two_back.prev_clicks, 1);
    for (const k of ['none', 'two_back']) {
      assert.equal(r.out[k].status, 'error', k);
      assert.deepEqual(r.out[k].reads, [], `${k}: nothing read`);
      assert.equal(r.out[k].last, 8, `${k}: nothing noted as read`);
    }
    assert.equal(r.out.none.searches, 1, 'the list only');
    assert.equal(r.out.two_back.searches, 3, 'then the list again, and its Previous');
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test('an automatic read that LinkedIn opens on the page asked for is unchanged', (t) => {
  const home = scratch();
  try {
    const r = scanner(t, home, `${AHEAD_PAGE}
out.update(carry_on(Ahead(pages=12, off_by=0)))`);
    if (!r) return;
    assert.doesNotMatch(r.log, /LinkedIn opened page|Previous/);
    assert.equal(r.out.prev_clicks, 0);
    assert.deepEqual(r.out.reads, [9, 10, 11, 12]);
    assert.equal(r.out.last, 12);
    assert.equal(r.out.status, 'success');
    assert.equal(r.out.searches, 4, 'the list, then Next three times');
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

// ── A fresh start that opens a page ahead, and pages read past a gap (2026-10-14) ──
// Blake: "when I manually scan someone the resume page on the profile card … says page
// one". A fresh read of a list (page 1, no page in the address) opened on page 2, the page
// bar said 2, and he read pages 2 to 14. Page 1 never was, so the note said "through page
// 0" and the card page 1, with 14 pages read. Now the page-1 start gets the go-back
// instruction, and every page read is kept (readPages), so reading page 1 later moves the
// bookmark straight to 14.

const BRIDGE_URL = 'https://www.linkedin.com/in/invented-bridge/';

// A window that opens a page past the one asked for: the page bar says it, the address
// doesn't (a fresh start has no page in it). As on 2026-10-12 and 2026-10-14.
const OPENS_AHEAD = `
class OpensAhead(ManualPage):
    def goto(self, url, **k):
        out = super().goto(url, **k)
        self.pg = self.url_pg + 1
        return out
def note_of():
    return ns['load_bridge_progress']().get('${BRIDGE_URL}')
def save_note(reach):
    # What scrape_bridge's save does once the people are saved.
    ns['record_bridge_progress']('${BRIDGE_URL}', 'Invented Bridge', reach['last'], reach['more'], URN)
def by_hand(page, **kw):
    people, status, reach = ns['_scrape_one_bridge'](page, 'Invented Bridge', 'b1', '${BRIDGE_URL}',
                                                    urn=URN, manual=True, **kw)
    save_note(reach)
    return {'people': len(people), 'status': status, 'last': reach['last'], 'more': reach['more'],
            'read': [x[0] for x in page.read_at], 'note': note_of()}
`;

/** The lines a run printed, as the app's job log holds them, up to and including the first matching `upTo`. */
function linesTo(log, upTo) {
  const lines = log.split('\n');
  const i = lines.findIndex((l) => upTo.test(l));
  return i < 0 ? lines : lines.slice(0, i + 1);
}

/** The scan light for a manual circle scan with these lines. */
function lightFor(log) {
  return scanLight({ known: true, running: true, pending: false, action: 'bridge', target: { id: 'b1', name: 'Invented Bridge' },
    startedAt: NOW, mode: 'manual', pages: 0, found: [], log }, { now: NOW });
}

test('a manual fresh start whose window opens on page 2 says to go back to page 1, and keeps the page bar for later', (t) => {
  const home = scratch();
  try {
    const r = scanner(t, home, `${MANUAL_PAGE}${OPENS_AHEAD}
page = OpensAhead(12, [[14, ['go', 1]], [18, 'foot'], [22, 'next'], [28, 'foot'], [34, 'close']], url_follows=False)
out.update(by_hand(page))
out['evidence'] = [json.loads(f.read_text()) for f in sorted((ns['_home']() / 'debug').glob('page-bar-*.json'))]`);
    if (!r) return;
    assert.match(r.log, /^ {2}Opening their connections\.\.\.$/m, 'a fresh start: no page asked for');
    assert.match(r.log, /LinkedIn's page bar shows page 2, not page 1\./);
    assert.match(r.log, /LinkedIn needs you: LinkedIn's page bar shows page 2, and page 1 isn't read yet\. Click Previous to page 1 and scroll to its bottom, then carry on with Next\./);
    assert.deepEqual(r.out.read, [1, 2], 'page 1 first, then on');
    assert.equal(r.out.last, 2);
    assert.equal(r.out.note.pages, 2);
    assert.equal(r.out.note.readPages, undefined, 'no gap, so nothing past the bookmark to keep');
    assert.equal(r.out.evidence.length, 1, 'the page bar is kept for a page-1 start too');
    assert.deepEqual([r.out.evidence[0].opened, r.out.evidence[0].bar, r.out.evidence[0].address], [1, 2, 1]);
    // The scan light turns red: go back to page 1 (lib/scan-light.js).
    const light = lightFor(linesTo(r.log, /Click Previous to page 1/));
    assert.equal(light.color, 'red');
    assert.equal(light.headline, 'Go back to page 1');
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test('Blake\'s two runs: pages 2 to 14 read past page 1 are kept, and reading page 1 moves the bookmark to 14', (t) => {
  const home = scratch();
  try {
    const plan1 = [];
    // Run 1: a fresh start opened on page 2; he reads it and on to 14, never page 1, then closes.
    // (The list takes some seconds to open: nothing is done in the window before then.)
    let at = 20;
    for (let pg = 2; pg <= 14; pg++) {
      plan1.push(`[${at}, 'foot']`);
      if (pg < 14) plan1.push(`[${at + 3}, 'next']`);
      at += 6;
    }
    plan1.push(`[${at + 2}, 'close']`);
    const r = scanner(t, home, `${MANUAL_PAGE}${OPENS_AHEAD}
out['first'] = by_hand(OpensAhead(40, [${plan1.join(', ')}], url_follows=False))
# Run 2: Resume (it carries on, from page 1). The window opens on page 2 again. He tries
# page 3, goes back to page 1 and reads it, clicks Next, then tries page 4.
b = clock.t - NOW + 600     # later: its plan is timed from now
clock.t += 600
page = OpensAhead(40, [[b + 20, ['go', 3]], [b + 26, ['go', 1]], [b + 30, 'foot'], [b + 36, 'next'], [b + 42, ['go', 4]],
                        [b + 50, 'close']],
                  url_follows=False)
out['second'] = by_hand(page, start_page=ns['next_page_to_read'](note_of()))`);
    if (!r) return;
    const { first, second } = r.out;
    assert.deepEqual(first.read, [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14]);
    assert.equal(first.last, 0, 'page 1 was never read, so the bookmark stays before it (TRAPS §34)');
    assert.deepEqual([first.note.pages, first.note.more, first.note.readPages], [0, true, [[2, 14]]],
      'every page read is kept, past the gap');
    assert.match(r.log, /page 2 is read \(10 people\)\. Page 1 isn't read yet, so the next scan starts there again/);

    // The second run knows pages 2 to 14: none is read again, and each says where to go.
    const second_ = r.log.split('Manual read done: 13 pages')[1];
    assert.match(second_, /LinkedIn needs you: LinkedIn's page bar shows page 2, and page 1 isn't read yet\. Click Previous to page 1/);
    assert.doesNotMatch(second_, /page 2 is already read, and page 1/, 'the opening line says it, once');
    assert.match(second_, /LinkedIn needs you: page 3 is already read, and page 1 isn't read yet\. Go back to page 1 and scroll to its bottom\./);
    assert.deepEqual(second.read, [1], 'only page 1 is read: 2 to 14 were read before');
    assert.match(second_, /LinkedIn needs you: page 1 is read \(10 people\), and pages 2–14 were read before\. Go on to page 15\./);
    assert.match(second_, /^ {2}\(on page 2, which is read: go on to page 15\)$/m);
    assert.match(second_, /LinkedIn needs you: page 4 is already read, and so is every page to 14\. Go on to page 15\./);
    assert.equal(second.last, 14, 'page 1 filled the gap: the bookmark jumps to 14');
    assert.deepEqual([second.note.pages, second.note.more, second.note.readPages], [14, true, undefined]);
    assert.match(r.log, /^Manual read done: 1 page of Invented Bridge's list\.$/m, 'this run read one page');
    // The light for each: red to go back, then green on to page 15.
    const back = lightFor(linesTo(r.log, /page 3 is already read, and page 1 isn't read yet/));
    assert.deepEqual([back.color, back.headline], ['red', 'Go back to page 1']);
    const on = lightFor(linesTo(r.log, /were read before\. Go on to page 15/));
    assert.deepEqual([on.color, on.headline], ['green', 'Go on to page 15']);
    const note = lightFor(linesTo(r.log, /on page 2, which is read: go on to page 15/));
    assert.deepEqual([note.color, note.headline], ['green', 'Go on to page 15']);
    const past = lightFor(linesTo(r.log, /so is every page to 14/));
    assert.deepEqual([past.color, past.headline], ['green', 'Go on to page 15']);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test('with the pages after it read before, reading the missing page can finish the list', (t) => {
  const home = scratch();
  try {
    const r = scanner(t, home, `${MANUAL_PAGE}${OPENS_AHEAD}
ns['_PAGES_READ']['${BRIDGE_URL}'] = set(range(2, 6))
ns['record_bridge_progress']('${BRIDGE_URL}', 'Invented Bridge', 0, True, URN)
page = ManualPage(5, [[20, 'foot'], [60, 'close']])
out.update(by_hand(page))`);
    if (!r) return;
    assert.deepEqual(r.out.read, [1]);
    assert.equal(r.out.last, 5);
    assert.equal(r.out.more, false, 'pages 1 to 5 of a 5-page list: the whole list');
    assert.match(r.log, /That's the end of their list\./);
    assert.deepEqual([r.out.note.pages, r.out.note.more], [5, false]);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test('Scan or Rescan from the start reads every page again, and the note still keeps the pages read before', (t) => {
  const home = scratch();
  try {
    const r = scanner(t, home, `${MANUAL_PAGE}${OPENS_AHEAD}
ns['_PAGES_READ']['${BRIDGE_URL}'] = set(range(2, 15))
ns['record_bridge_progress']('${BRIDGE_URL}', 'Invented Bridge', 0, True, URN)
out['before'] = note_of()
page = ManualPage(40, [[20, 'foot'], [23, 'next'], [26, 'foot'], [40, 'close']])
out.update(by_hand(page, from_start=True))
# Deleting their circle (Rescan's delete, scrape_bridge fresh=True) forgets the note, pages read and all.
ns['forget_bridge_progress']('${BRIDGE_URL}')
ns['_PAGES_READ'].clear()
ns['record_bridge_progress']('${BRIDGE_URL}', 'Invented Bridge', 1, True, URN)
out['forgotten'] = note_of()`);
    if (!r) return;
    assert.deepEqual(r.out.before.readPages, [[2, 14]]);
    assert.deepEqual(r.out.read, [1, 2], 'page 2 is read again: from the start reads every page, to find anyone new');
    assert.doesNotMatch(r.log, /already read/);
    assert.equal(r.out.last, 2, 'this run read 1 and 2');
    assert.deepEqual([r.out.note.pages, r.out.note.readPages], [14, undefined],
      'the note never winds back: pages 3 to 14 were read before, and their people are saved');
    assert.deepEqual([r.out.forgotten.pages, r.out.forgotten.readPages], [1, undefined], 'a deleted circle starts again');
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test('an automatic fresh start that LinkedIn opens on page 2 goes back with Previous, then reads from page 1', (t) => {
  // 2026-10-14: a fresh start (no page in the address) opened on page 2 too. It used to be
  // read as page 1, so page 1 was noted as read and never was.
  const home = scratch();
  try {
    const r = scanner(t, home, `${AHEAD_PAGE}
out.update(carry_on(Ahead(pages=5, off_by=1), start_page=1))
out['evidence'] = [json.loads(f.read_text()) for f in sorted((ns['_home']() / 'debug').glob('page-bar-*.json'))]`);
    if (!r) return;
    assert.match(r.log, /^ {2}Opening their connections\.\.\.$/m);
    assert.match(r.log, /LinkedIn opened page 2, not page 1: going back a page with Previous\./);
    assert.match(r.log, /Back on page 1\./);
    assert.equal(r.out.prev_clicks, 1);
    assert.deepEqual(r.out.reads, [1, 2, 3, 4, 5], 'page 1 first, then on in order');
    assert.equal(r.out.last, 5);
    assert.equal(r.out.status, 'success');
    assert.equal(r.out.evidence.length, 1, 'the page bar is kept for a page-1 start too');
    assert.deepEqual([r.out.evidence[0].opened, r.out.evidence[0].bar, r.out.evidence[0].address], [1, 2, 2]);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test('an automatic fresh start opened two pages ahead stops, so page 1 is never noted as read', (t) => {
  const home = scratch();
  try {
    const r = scanner(t, home, `${AHEAD_PAGE}
out.update(carry_on(Ahead(pages=5, off_by=2), start_page=1))`);
    if (!r) return;
    assert.match(r.log, /LinkedIn opened page 3, not page 1\. Stopping so no page is noted as read that wasn't\./);
    assert.deepEqual(r.out.reads, []);
    assert.equal(r.out.last, 0);
    assert.equal(r.out.status, 'error');
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test('an automatic read seeded with pages read before moves the bookmark past them; from the start it does not', (t) => {
  const home = scratch();
  try {
    const r = scanner(t, home, `
ns['GENTLE']['on'] = False
URL = 'https://www.linkedin.com/in/invented-bridge/'
ns['_PAGES_READ'][URL] = set(range(2, 9))
ns['record_bridge_progress'](URL, 'Invented Bridge', 0, True)
out['note'] = ns['load_bridge_progress']()[URL]
urls, status, reach = read(ResultsPage(pages=12), max_pages=1)
out['carry'] = {'last': reach['last'], 'more': reach['more'], 'read': sorted(reach['read'])}
urls, status, reach = read(ResultsPage(pages=12), max_pages=1, from_start=True)
out['fresh'] = {'last': reach['last'], 'read': sorted(reach['read'])}`);
    if (!r) return;
    assert.deepEqual(r.out.note.readPages, [[2, 8]]);
    assert.deepEqual(r.out.carry, { last: 8, more: true, read: [1] }, 'page 1 read, and 2 to 8 were read before');
    assert.match(r.log, /Pages 2–8 were read before, so the list is read through page 8\./);
    assert.deepEqual(r.out.fresh, { last: 1, read: [1] });
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test('manual mode is on only when its switch is, and never in Auto scan\'s sittings or headless', (t) => {
  const home = scratch();
  try {
    const r = scanner(t, home, `
out['off'] = ns['manual_reads']()
(ns['_home']() / 'scan-limits.json').write_text(json.dumps({'daily': 50, 'manual': True}))
out['on'] = ns['manual_reads']()`);
    if (!r) return;
    assert.equal(r.out.off, false);
    assert.equal(r.out.on, true);
    const src = readFileSync(SCRAPER, 'utf8');
    assert.match(src, /manual = manual_reads\(\) and not EXPERIMENT\.get\("sitting"\) and not headless/);
    assert.match(src, /if manual:\n\s+CHROME_WINDOW\["show"\] = True/, 'the window comes to the front');
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});
