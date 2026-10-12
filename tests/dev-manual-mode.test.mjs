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
import { fileURLToPath } from 'node:url';
import { readLimits, writeLimits, linkedinState, devMode, DEFAULT_LIMITS } from '../lib/linkedin-limits.js';
import { inviteRefusal, INVITE_CAPS } from '../lib/auto-connect.js';
import { autoPlan, MANUAL_STOPS_AUTO } from '../lib/auto-scan.js';
import { enqueue, emptyQueue, queueView, QUEUE_CAP, DEV_QUEUE_CAP } from '../lib/scan-queue.js';
import { needsYou } from '../lib/scan-progress.js';
import { PYTHON, noPython } from './python.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const SCRAPER = path.join(here, '..', 'scripts', 'scrape.py');
const HARNESS = path.join(here, 'helpers', 'scanner_harness.py');
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
out['left'] = ns['searches_left']()[0] > 1000
data = ns['_read_activity']()
data['invites'] = [_t.time() - 60] * 20
ns['_write_json_atomic'](ns['_home']() / 'linkedin-activity.json', data)
out['invite'] = ns['take_invite']()
out['invites'] = len(ns['_read_activity']()['invites'])
out['gap'] = ns['PROFILE_GAP']`);
    if (!r) return;
    assert.equal(r.out.dev, true);
    assert.equal(r.out.lifted, true);
    assert.equal(r.out.left, true, 'no daily limit');
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

// ── Manual mode, the scanner's side ──────────────────────────────────────────

// Their list as a window in front of you, and you working it: `plan` is a list of
// [seconds from now, what], what being "foot" (scroll to the bottom), "next"
// (click Next), ["go", n] (open page n), or "close" (close the window).
const MANUAL_PAGE = `
URN = 'ACoAAInventedUrn'
class ManualPage:
    def __init__(self, pages, plan, hidden=()):
        self.pages, self.plan, self.hidden = pages, sorted(plan, key=lambda x: x[0]), set(hidden)
        self.pg, self.foot, self.closed, self.read_at = 1, False, False, []
    def _act(self):
        while self.plan and NOW + self.plan[0][0] <= clock.t:
            _, what = self.plan.pop(0)
            if what == 'foot': self.foot = True
            elif what == 'next': self.pg, self.foot = self.pg + 1, False
            elif what == 'close': self.closed = True
            elif isinstance(what, list) and what[0] == 'go': self.pg, self.foot = what[1], False
    @property
    def url(self):
        self._act()
        return ('https://www.linkedin.com/search/results/people/?network=%5B%22F%22%5D'
                '&connectionOf=%5B%22' + URN + '%22%5D&page=' + str(self.pg))
    def is_closed(self):
        self._act()
        return self.closed
    def evaluate(self, js, *a):
        self._act()
        if js == ns['AT_FOOT_JS']: return self.foot
        if js == ns['NEXT_STATE_JS']: return 'on' if self.pg < self.pages else 'off'
        if js == ns['BRIDGE_RESULTS_JS']:
            if self.pg in self.hidden: return []
            self.read_at.append([self.pg, clock.t - NOW])
            return [person((self.pg - 1) * 10 + i) for i in range(10)]
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
