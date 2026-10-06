// The cap on profile views, and the minute between any two (scrape.py, TRAPS
// §16). Profile views are what LinkedIn restricted an account for, so a circle
// scan takes one of the day's before it opens someone's profile, waits out the
// gap from the last one written down, and with none left opens nothing.
//
// These run the scanner's own code against a stand-in page, browser and clock,
// in a scratch SIX_DEGREES_HOME: nothing opens a browser or reaches LinkedIn or
// the app, and a minute's wait takes no time. Invented people only.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PYTHON, noPython } from './python.mjs';

const SCRAPER = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'scripts', 'scrape.py');

const HARNESS = `
import ast, json, sys, types
from pathlib import Path
tree = ast.parse(open(sys.argv[1]).read())
# The whole scanner but its command line, and the two imports that need
# packages (requests, image_store): nothing here may reach the app anyway.
skip = lambda n: (isinstance(n, ast.If)
                  or (isinstance(n, ast.Import) and any(a.name == 'requests' for a in n.names))
                  or (isinstance(n, ast.ImportFrom) and n.module == 'image_store'))
ns = {'__name__': 'scrape', '__file__': sys.argv[1]}
exec(compile(ast.Module(body=[n for n in tree.body if not skip(n)], type_ignores=[]), 'scrape.py', 'exec'), ns)

def refuse(*a, **k):
    raise AssertionError('nothing here may reach the network')
ns['requests'] = types.SimpleNamespace(get=refuse, post=refuse)
ns['localize_images'] = refuse

class Clock:
    """time.time and time.sleep for the scanner: a wait moves the clock, instantly."""
    def __init__(self, t):
        self.t = t
        self.on_sleep = None
    def time(self):
        return self.t
    def sleep(self, s):
        self.t += s
        if self.on_sleep:
            self.on_sleep()

NOW = 1790000000.0
clock = Clock(NOW)
ns['time'] = clock

class Page:
    """Every profile says it's unavailable, so a read ends right after the open."""
    def __init__(self):
        self.opened = []                     # [url, when]
    def goto(self, url, **_):
        self.opened.append([url, clock.t])
    def evaluate(self, js, *args):
        return True if 'this profile is not available' in js else None
    def is_closed(self):
        return False
    def set_default_timeout(self, _):
        pass
    def set_default_navigation_timeout(self, _):
        pass

page = Page()
launched = []

class Browser:
    pages = [page]
    def new_page(self):
        return page
    def close(self):
        pass

class Playwright:
    def __enter__(self):
        def launch(**_):
            launched.append(1)
            return Browser()
        return types.SimpleNamespace(chromium=types.SimpleNamespace(launch_persistent_context=launch))
    def __exit__(self, *a):
        return False

api = types.ModuleType('playwright.sync_api')
api.sync_playwright = Playwright
sys.modules['playwright'] = types.ModuleType('playwright')
sys.modules['playwright.sync_api'] = api

A = 'https://www.linkedin.com/in/ada-quill-0000/'
B = 'https://www.linkedin.com/in/ben-ostrander-0000/'
PEOPLE = [
    {'id': 'c1', 'name': 'Ada Quill', 'tier': 'A', 'power_score': 6.1, 'profile_url': A,
     'created_at': '2026-09-02', 'connected_date': '2026-09-20'},
    {'id': 'c2', 'name': 'Ben Ostrander', 'tier': 'B', 'power_score': 4.4, 'profile_url': B,
     'created_at': '2026-09-01', 'connected_date': '2026-09-10'},
]
def read_connections(endpoint='', params=None):
    want = (params or {}).get('profile_url', '')[3:]
    return [p for p in PEOPLE if not want or p['profile_url'] == want]
ns['read_connections'] = read_connections
ns['read_bridged_ids'] = lambda: set()
ns['ensure_logged_in'] = lambda page, **_: True

home = Path(ns['_home']())
def record(profiles=(), searches=()):
    (home / 'linkedin-activity.json').write_text(json.dumps({'searches': list(searches), 'profiles': list(profiles)}))
def views():
    return json.loads((home / 'linkedin-activity.json').read_text())['profiles']
def limits(**kw):
    (home / 'scan-limits.json').write_text(json.dumps(kw))
def written():
    return sorted(p.name for p in home.iterdir() if p.name.startswith('bridge-'))

out = {}
exec(sys.argv[2])
print('RESULT ' + json.dumps(out))
`;

/** { out, log } from the case, or null when there is no Python here. */
function run(t, script) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'six-degrees-views-'));
  const r = spawnSync(PYTHON, ['-c', HARNESS, SCRAPER, script], {
    encoding: 'utf8',
    env: { ...process.env, SIX_DEGREES_HOME: home },
  });
  fs.rmSync(home, { recursive: true, force: true });
  if (noPython(t, r)) return null;
  assert.equal(r.status, 0, r.stderr);
  const lines = r.stdout.trimEnd().split('\n');
  return { out: JSON.parse(lines.pop().replace(/^RESULT /, '')), log: lines.join('\n') };
}

test('with the day\'s profile views used, a circle scan opens nothing and records nothing', (t) => {
  const r = run(t, `
record(profiles=[NOW - 1200 * i for i in range(1, 51)])   # 50 in the last 24 hours, the default cap
people, status, reach = ns['_scrape_one_bridge'](page, 'Ada Quill', 'c1', A)
out.update(status=status, budget=reach.get('budget'), opened=page.opened, views=len(views()),
           files=written(), message=ns['budget_message']('profiles'), left=ns['profiles_left']())`);
  if (!r) return;
  assert.equal(r.out.status, 'budget');
  assert.equal(r.out.budget, 'profiles');
  assert.deepEqual(r.out.opened, [], 'no page.goto');
  assert.equal(r.out.views, 50, 'nothing charged');
  assert.deepEqual(r.out.files, [], 'no progress, skip or unclear note about them');
  assert.equal(r.out.left, 0);
  assert.match(r.out.message, /^Today's profile views \(50\) are used — they count the last 24 hours\. The next one frees up at .+\. No profile was opened/);
});

test('the cap is the one chosen on the Scan page, and a view more than a day old counts no more', (t) => {
  const r = run(t, `
limits(daily=50, monthly=250, profiles=10)
record(profiles=[NOW - 25 * 3600] * 5 + [NOW - 600 * i for i in range(1, 11)])
people, status, reach = ns['_scrape_one_bridge'](page, 'Ada Quill', 'c1', A)
first = [status, len(page.opened)]
limits(daily=50, monthly=250, profiles=25)
people, status, reach = ns['_scrape_one_bridge'](page, 'Ada Quill', 'c1', A)
out.update(first=first, second=[status, len(page.opened)], left=ns['profiles_left']())`);
  if (!r) return;
  assert.deepEqual(r.out.first, ['budget', 0], '10 of 10 used');
  assert.deepEqual(r.out.second, ['private', 1], 'with 25 a day, it opens');
  assert.equal(r.out.left, 14);
});

test('a profile opens at least a minute after the last one, with a countdown while it waits', (t) => {
  const r = run(t, `
record(profiles=[NOW - 20])
people, status, reach = ns['_scrape_one_bridge'](page, 'Ada Quill', 'c1', A)
out.update(status=status, opened=page.opened, views=views())`);
  if (!r) return;
  assert.equal(r.out.opened.length, 1);
  const [url, at] = r.out.opened[0];
  assert.equal(url, 'https://www.linkedin.com/in/ada-quill-0000/');
  assert.ok(at - (1790000000 - 20) >= 60, `opened ${at - (1790000000 - 20)}s after the last view`);
  assert.deepEqual(r.out.views, [1790000000 - 20, at], 'the view is written down at the moment it opens');
  assert.match(r.log, /Waiting 41s before opening a profile: at least 60s pass between any two\./);
  assert.match(r.log, /^ {4}31s to go$/m);
  assert.match(r.log, /^ {4}1s to go$/m);
  assert.equal(r.out.status, 'private');
});

test('scans started back to back can\'t open two profiles within a minute', (t) => {
  const r = run(t, `
for name, url in (('Ada Quill', A), ('Ben Ostrander', B), ('Ada Quill', A)):
    ns['_scrape_one_bridge'](page, name, 'c1', url)
out.update(opened=[at for _, at in page.opened], views=views())`);
  if (!r) return;
  const [a, b, c] = r.out.opened;
  assert.equal(a, 1790000000, 'nothing recorded before it: the first opens at once');
  assert.ok(b - a >= 60 && c - b >= 60, `${b - a}s, then ${c - b}s apart`);
  assert.deepEqual(r.out.views, r.out.opened, 'one view per profile opened, each at its open');
});

test('Stop during the wait ends it before the profile opens, and takes no view', (t) => {
  const r = run(t, `
record(profiles=[NOW - 5])
clock.on_sleep = lambda: ns.__setitem__('_stop_requested', True)
people, status, reach = ns['_scrape_one_bridge'](page, 'Ada Quill', 'c1', A)
out.update(status=status, opened=page.opened, views=len(views()), waited=clock.t - NOW)`);
  if (!r) return;
  assert.equal(r.out.status, 'stopped');
  assert.deepEqual(r.out.opened, []);
  assert.equal(r.out.views, 1);
  assert.equal(r.out.waited, 10, 'one step of the countdown, not the whole minute');
  assert.match(r.log, /Stopped before opening their profile\./);
});

test('a single circle scan with no views left stops before a browser opens', (t) => {
  const r = run(t, `
record(profiles=[NOW - 60 * i for i in range(1, 51)])
try:
    ns['scrape_bridge']('Ada Quill')
    out['raised'] = None
except ns['BudgetReached'] as exc:
    out.update(raised=exc.kind, found=exc.found, text=str(exc))
out.update(launched=len(launched), opened=page.opened, files=written())`);
  if (!r) return;
  assert.deepEqual([r.out.raised, r.out.found, r.out.text], ['profiles', 0, 'today\'s profile views']);
  assert.equal(r.out.launched, 0, 'no browser');
  assert.deepEqual(r.out.opened, []);
  assert.deepEqual(r.out.files, []);
});

test('the last view, taken by another run after the browser opened, still stops the read cleanly', (t) => {
  const r = run(t, `
record(profiles=[NOW - 60 * i for i in range(1, 50)])     # 49 of 50
def signed_in(page, **_):
    ns['charge_linkedin']('profiles')                      # another run takes the 50th meanwhile
    return True
ns['ensure_logged_in'] = signed_in
try:
    ns['scrape_bridge']('Ada Quill')
    out['raised'] = None
except ns['BudgetReached'] as exc:
    out.update(raised=exc.kind, found=exc.found)
out.update(launched=len(launched), opened=page.opened, views=len(views()), files=written())`);
  if (!r) return;
  assert.deepEqual([r.out.raised, r.out.found], ['profiles', 0]);
  assert.equal(r.out.launched, 1);
  assert.deepEqual(r.out.opened, [], 'checked inside the read, before the open');
  assert.equal(r.out.views, 50);
  assert.deepEqual(r.out.files, []);
});

test('Auto-Bridge stops at the cap before the next person, and records nothing about them', (t) => {
  const r = run(t, `
limits(daily=50, monthly=250, profiles=10)
record(profiles=[NOW - 3600 * h for h in range(1, 10)])   # 9 of 10: room for one
results = ns['auto_bridge_all']()
out.update(results=results, opened=[u for u, _ in page.opened], files=written(),
           skips=sorted(json.loads((home / 'bridge-skips.json').read_text())), views=len(views()))`);
  if (!r) return;
  assert.deepEqual(r.out.opened, ['https://www.linkedin.com/in/ada-quill-0000/'], 'newest first, and only one');
  assert.deepEqual(r.out.results.map((x) => [x.name, x.status]), [['Ada Quill', 'private']], 'Ben isn\'t counted: nothing was tried');
  assert.deepEqual(r.out.files, ['bridge-skips.json']);
  assert.deepEqual(r.out.skips, ['https://www.linkedin.com/in/ada-quill-0000/'], 'only Ada, whose profile opened');
  assert.equal(r.out.views, 10);
  assert.match(r.log, /Profile views: 9 of 10 in the last 24 hours, at least 60s apart/);
  assert.match(r.log, /Today's profile views \(10\) are used/);
  assert.match(r.log, /Stopped early \(today's profile views\): 0 bridged \/ 1 hidden \/ 0 failed or unclear/);
});

test('re-mapping someone with no views left deletes nothing', (t) => {
  const r = run(t, `
record(profiles=[NOW - 60 * i for i in range(1, 51)])
deleted = []
ns['delete_bridge_cluster'] = lambda name: deleted.append(name) or 'c1'
try:
    ns['rescrape_bridge']('Ada Quill')
    out['raised'] = None
except ns['BudgetReached'] as exc:
    out['raised'] = exc.kind
out.update(deleted=deleted, launched=len(launched))`);
  if (!r) return;
  assert.deepEqual(r.out, { raised: 'profiles', deleted: [], launched: 0 });
});

test('a damaged record counts the day\'s profile views as used too', (t) => {
  const r = run(t, `
(home / 'linkedin-activity.json').write_text('{"profiles": [1, 2')
out.update(left=ns['profiles_left'](), take=ns['take_profile_view']())`);
  if (!r) return;
  assert.deepEqual(r.out, { left: 0, take: null });
});

test('a view timed ahead of this clock (another computer\'s) doesn\'t hold every open back forever', (t) => {
  const r = run(t, `
record(profiles=[NOW + 3600])
out.update(take=ns['take_profile_view'](), views=len(views()))`);
  if (!r) return;
  assert.deepEqual(r.out, { take: 0, views: 2 });
});

test('a limit of 0 or nonsense reads as the default: profile views are never unlimited', (t) => {
  const r = run(t, `
got = []
for value in (0, -3, 'lots', None, 25):
    limits(daily=50, monthly=250, profiles=value)
    got.append(ns['search_limits']()['profiles'])
out['got'] = got`);
  if (!r) return;
  assert.deepEqual(r.out.got, [50, 50, 50, 50, 25]);
});

test('a limit typed in by hand counts as the largest choice under it, never past 100', (t) => {
  const r = run(t, `
got = []
for value in (1000, 70, 5, 100):
    limits(daily=50, monthly=250, profiles=value)
    got.append(ns['search_limits']()['profiles'])
out['got'] = got`);
  if (!r) return;
  assert.deepEqual(r.out.got, [100, 50, 10, 100]);
});

test('re-mapping waits out the minute before deleting, and Stop during it deletes nothing', (t) => {
  const r = run(t, `
record(profiles=[NOW - 5])
deleted = []
ns['delete_bridge_cluster'] = lambda name: deleted.append(name) or None
clock.on_sleep = lambda: ns.__setitem__('_stop_requested', True)
ns['rescrape_bridge']('Ada Quill')
out.update(deleted=deleted, launched=len(launched), views=len(views()))`);
  if (!r) return;
  assert.deepEqual(r.out, { deleted: [], launched: 0, views: 1 });
  assert.match(r.log, /Stopped before anything was deleted\./);
});

test('re-mapping with the minute already passed deletes and reads without waiting', (t) => {
  const r = run(t, `
record(profiles=[NOW - 120])
deleted = []
ns['delete_bridge_cluster'] = lambda name: deleted.append(name) or None
ns['rescrape_bridge']('Ada Quill')
out.update(deleted=deleted, waited=clock.t - NOW)`);
  if (!r) return;
  assert.deepEqual(r.out, { deleted: ['Ada Quill'], waited: 0 });
});

test('a list\'s length from LinkedIn\'s count is kept with its progress, and survives later saves', (t) => {
  const r = run(t, `
ns['_LIST_TOTALS'][A] = 310
ns['record_bridge_progress'](A, 'Ada Quill', 5, True)
ns['_LIST_TOTALS'].clear()
ns['record_bridge_progress'](A, 'Ada Quill', 10, True)
mine = ns['load_bridge_progress']()
out['entry'] = {k: mine[A][k] for k in ('pages', 'more', 'total')}`);
  if (!r) return;
  assert.deepEqual(r.out.entry, { pages: 10, more: true, total: 310 });
});

// ── Experimental Auto-Bridge (--experimental) ───────────────────────────────

test('experimental pacing: after a sitting of 8 pages, an hour\'s rest', (t) => {
  const r = run(t, `
from datetime import datetime
clock.t = datetime(2026, 9, 21, 12, 0).timestamp()
ns['EXPERIMENT'].update(on=True, pages=8)
start = clock.t
ok = ns['_drip_before_search']()
out.update(ok=ok, waited=round(clock.t - start), pages=ns['EXPERIMENT']['pages'])`);
  if (!r) return;
  assert.deepEqual(r.out, { ok: true, waited: 3600, pages: 0 });
});

test('experimental pacing: no searches at night; it waits for 09:00', (t) => {
  const r = run(t, `
from datetime import datetime
clock.t = datetime(2026, 9, 21, 21, 0).timestamp()
ns['EXPERIMENT'].update(on=True, pages=0)
start = clock.t
ok = ns['_drip_before_search']()
out.update(ok=ok, waited=round(clock.t - start), hour=datetime.fromtimestamp(clock.t).hour)`);
  if (!r) return;
  assert.deepEqual(r.out, { ok: true, waited: 12 * 3600, hour: 9 });
});

test('experimental pacing: at the daily budget it waits for the oldest search to age out, then goes on', (t) => {
  const r = run(t, `
from datetime import datetime
clock.t = datetime(2026, 9, 21, 12, 0).timestamp()
limits(daily=50, monthly=0, profiles=50)
record(searches=[clock.t - 23 * 3600 + i for i in range(50)])
ns['EXPERIMENT'].update(on=True, pages=0)
start = clock.t
ok = ns['_drip_before_search']()
out.update(ok=ok, waited=round(clock.t - start), left=ns['searches_left']()[0])`);
  if (!r) return;
  assert.equal(r.out.ok, true);
  assert.ok(r.out.waited >= 3600 && r.out.waited < 3700, `waited ${r.out.waited}s`);
  assert.ok(r.out.left >= 1);
  assert.match(r.log, /Today's searches are used\. Carrying on at \d\d:\d\d\./);
});

test('LinkedIn\'s own data: people and the list total from a response, wherever they sit', (t) => {
  const r = run(t, `
payload = {"data": {"data": {"searchDashClustersByAll": {"metadata": {"totalResultCount": 312}, "elements": [{"items": [
  {"item": {"entityResult": {"title": {"text": "Ada Quill"}, "primarySubtitle": {"text": "Founder at Hooli"},
    "navigationUrl": "https://www.linkedin.com/in/ada-quill-0000?miniProfileUrn=x",
    "insightsResolutionResults": [{"simpleInsight": {"title": {"text": "Ben Ostrander and 23 other mutual connections"}}}],
    "image": {"attributes": [{"detailData": {"nonEntityProfilePicture": {"vectorImage": {"rootUrl": "https://media.example/",
      "artifacts": [{"width": 100, "fileIdentifyingUrlPathSegment": "a100"}, {"width": 400, "fileIdentifyingUrlPathSegment": "a400"}]}}}}]}}}},
  {"item": {"entityResult": {"title": {"text": "LinkedIn Member"}, "navigationUrl": "https://www.linkedin.com/in/hidden"}}}
]}]}}}}
out['people'] = ns['voyager_people'](payload)
out['total'] = ns['voyager_total'](payload)
out['counts'] = [ns['mutual_count_text'](s) for s in ('23 mutual connections', 'Ada is a mutual connection', 'Ada and Ben are mutual connections', 'nothing')]`);
  if (!r) return;
  assert.deepEqual(r.out.people, [{ name: 'Ada Quill', headline: 'Founder at Hooli', profileUrl: 'https://www.linkedin.com/in/ada-quill-0000/', imageUrl: 'https://media.example/a400', mutualCount: 24 }]);
  assert.equal(r.out.total, 312);
  assert.deepEqual(r.out.counts, [23, 1, 2, null]);
});

test('experimental pacing: Auto scan stops at its own 40 a day, however high the budget', (t) => {
  const r = run(t, `
from datetime import datetime
clock.t = datetime(2026, 9, 21, 12, 0).timestamp()
ns['EXPERIMENT'].update(on=True, pages=0)
ns['_read_activity'] = lambda: {"searches": [clock.t - 60 * i for i in range(1, 41)]}
out.update(wait=ns['_auto_ceiling_wait'](clock.t) is not None, day=ns['AUTO_DAY_CAP'], week=ns['AUTO_WEEK_CAP'])`);
  if (!r) return;
  assert.deepEqual(r.out, { wait: true, day: 40, week: 200 });
});

// Auto scan's sittings (scrape.py --sitting; lib/auto-scan.js, the app's side).
// Blake, 1.2.0: Auto scan "doesn't even work". Pressed in the evening it opened
// Chrome and a profile, then slept in place until 9:00 the next morning with the
// browser open; pressed at the budget it ended at once. A sitting now ends
// instead of waiting, before any browser opens, and the app rests between them.

test('REGRESSION: a scan you start yourself at 20:00 opens at once, with no overnight rest', (t) => {
  const r = run(t, `
from datetime import datetime
clock.t = datetime(2026, 10, 5, 20, 0).timestamp()
start = clock.t
ns['auto_bridge_all'](max_bridges=1, order='score')
out.update(opened=len(page.opened), waited=clock.t - start)`);
  if (!r) return;
  assert.equal(r.out.opened, 1, 'their profile opened');
  assert.ok(r.out.waited < 600, `waited ${r.out.waited}s`);
  assert.doesNotMatch(r.log, /Resting overnight|Carrying on at/);
});

test('Auto scan\'s sitting at 20:00 opens nothing and ends at once; the app waits for 9:00', (t) => {
  const r = run(t, `
from datetime import datetime
clock.t = datetime(2026, 10, 5, 20, 0).timestamp()
start = clock.t
ns['EXPERIMENT'].update(on=True, pages=0, sitting=8, ended=None)
ns['auto_bridge_all'](order='score', tiers=['S', 'A'], deeper=True)
out.update(opened=len(page.opened), launched=len(launched), waited=clock.t - start)`);
  if (!r) return;
  assert.deepEqual([r.out.opened, r.out.launched], [0, 0], 'no browser, no profile');
  assert.ok(r.out.waited < 1, `waited ${r.out.waited}s`);
  assert.match(r.log, /Sitting over: It's outside Auto scan's hours \(9:00 to 18:00\)\./);
  assert.doesNotMatch(r.log, /Resting overnight/);
});

test('a sitting ends after its searches, or at the budget, instead of resting in place', (t) => {
  const r = run(t, `
from datetime import datetime
clock.t = datetime(2026, 10, 5, 12, 0).timestamp()
ns['EXPERIMENT'].update(on=True, pages=0, sitting=4, ended=None)
out['fresh'] = ns['_sitting_over']()
ns['EXPERIMENT']['pages'] = 4
out['done'] = ns['_sitting_over']()
start = clock.t
out['go'] = ns['_drip_before_search']()
out['waited'] = clock.t - start
ns['EXPERIMENT'].update(pages=0, ended=None)
limits(daily=3)
record(searches=[clock.t - 60 * i for i in range(1, 4)])
out['budget'] = ns['_sitting_over']()`);
  if (!r) return;
  assert.equal(r.out.fresh, null);
  assert.equal(r.out.done, "This sitting's 4 searches are done");
  assert.deepEqual([r.out.go, r.out.waited], [false, 0]);
  assert.match(r.out.budget, /budget|searches/i);
});
