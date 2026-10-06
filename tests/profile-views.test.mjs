// The cap on profile views, and the minute between any two (scrape.py, TRAPS
// §16). Profile views are what LinkedIn restricted an account for, so a circle
// scan takes one of the day's before it opens someone's profile, waits out the
// gap from the last one written down, and with none left opens nothing. Since
// 2026-10-05 the cap is the one daily number (searches a day), and lifting the
// limits for a session takes it off; the minute between views never goes.
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
    context = None
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
real_ensure_logged_in = ns['ensure_logged_in']
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
function run(t, script, { lifted = false } = {}) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'six-degrees-views-'));
  const r = spawnSync(PYTHON, ['-c', HARNESS, SCRAPER, script], {
    encoding: 'utf8',
    // As the app starts it while the limits are lifted for this session (route.js childEnv).
    env: { ...process.env, SIX_DEGREES_HOME: home, SIX_DEGREES_LIMITS_LIFTED: lifted ? '1' : '0' },
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
  assert.match(r.out.message, /^Today's limit of 50 profile views is used — it counts the last 24 hours\. The next one frees up at .+\. No profile was opened/);
});

test('the cap is the Scan page\'s searches a day, and a view more than a day old counts no more', (t) => {
  const r = run(t, `
limits(daily=10)
record(profiles=[NOW - 25 * 3600] * 5 + [NOW - 600 * i for i in range(1, 11)])
people, status, reach = ns['_scrape_one_bridge'](page, 'Ada Quill', 'c1', A)
first = [status, len(page.opened)]
limits(daily=25)
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
limits(daily=10)
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
  assert.match(r.log, /Searches: 0 of 10 a day used, counting the last 24 hours/);
  assert.match(r.log, /Profile views: 9 of 10 in the last 24 hours, at least 60s apart/);
  assert.match(r.log, /Today's limit of 10 profile views is used/);
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

test('a daily number of 0 or nonsense reads as the default; profile views are never unlimited unless lifted', (t) => {
  const r = run(t, `
got = []
for value in (0, -3, 'lots', None, 2.5, True, 1001, 25, 1000):
    limits(daily=value)
    got.append(ns['search_limits']())
# A file from before 2026-10-05: its own profile-view cap is ignored.
limits(daily=200, monthly=250, profiles=10)
out.update(got=got, old=ns['search_limits']())`);
  if (!r) return;
  assert.deepEqual(r.out.got.map((l) => l.daily), [50, 50, 50, 50, 50, 50, 50, 25, 1000]);
  assert.ok(r.out.got.every((l) => l.profiles === l.daily), 'one number for both');
  assert.deepEqual(r.out.old, { daily: 200, profiles: 200 });
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
limits(daily=50)
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

test('experimental pacing: Auto scan uses the same daily limit, with no 40 a day of its own', (t) => {
  const r = run(t, `
from datetime import datetime
clock.t = datetime(2026, 9, 21, 12, 0).timestamp()
limits(daily=100)
record(searches=[clock.t - 60 * i for i in range(1, 61)])   # 60 today: past the old 40, under 100
ns['EXPERIMENT'].update(on=True, pages=0)
start = clock.t
ok = ns['_drip_before_search']()
out.update(ok=ok, waited=round(clock.t - start), caps=[k for k in ('AUTO_DAY_CAP', 'AUTO_WEEK_CAP', '_auto_ceiling_wait') if k in ns])`);
  if (!r) return;
  assert.deepEqual(r.out, { ok: true, waited: 0, caps: [] });
});

// ── Lifted for this session (Blake, 2026-10-05) ─────────────────────────────
// The daily limit and the cooldown are off; the pace and the stops are not.

test('lifted: the day\'s limit doesn\'t stop a circle scan, and profiles still open at least a minute apart', (t) => {
  const r = run(t, `
limits(daily=10)
record(profiles=[NOW - 20] + [NOW - 600 * i for i in range(1, 30)], searches=[NOW - 30 * i for i in range(1, 40)])
people, status, reach = ns['_scrape_one_bridge'](page, 'Ada Quill', 'c1', A)
out.update(status=status, opened=page.opened, left=[ns['searches_left']()[0] >= 10 ** 9, ns['profiles_left']() >= 10 ** 9],
           lifted=ns['limits_lifted']())`, { lifted: true });
  if (!r) return;
  assert.equal(r.out.lifted, true);
  assert.deepEqual(r.out.left, [true, true], 'no daily limit on searches or profile views');
  assert.equal(r.out.status, 'private', 'it opened, 30 views over a limit of 10');
  assert.equal(r.out.opened.length, 1);
  assert.ok(r.out.opened[0][1] - (1790000000 - 20) >= 60, 'the minute between profile views holds');
  assert.match(r.log, /Waiting 41s before opening a profile: at least 60s pass between any two\./);
});

test('lifted: the speed is exactly the one chosen, and Auto scan keeps its hours and rests', (t) => {
  const r = run(t, `
from datetime import datetime
limits(daily=5, pace='slow')
name = ns['apply_pace']()
paced = [name, ns['PAGE_PAUSE'], ns['CHUNK_COOLDOWN'], ns['PROFILE_GAP']]
clock.t = datetime(2026, 9, 21, 12, 0).timestamp()
record(searches=[clock.t - 60 * i for i in range(1, 30)])   # far past 5 a day
ns['EXPERIMENT'].update(on=True, pages=8)
start = clock.t
ok = ns['_drip_before_search']()
rest = round(clock.t - start)
clock.t = datetime(2026, 9, 21, 21, 0).timestamp()
start = clock.t
ns['_drip_before_search']()
out.update(paced=paced, ok=ok, rest=rest, night=round(clock.t - start))`, { lifted: true });
  if (!r) return;
  assert.deepEqual(r.out.paced, ['slow', 90, 300, 120], 'the same waits as with the limits on');
  assert.equal(r.out.ok, true);
  assert.equal(r.out.rest, 3600, 'the rest after a sitting, and no wait for the daily limit');
  assert.equal(r.out.night, 12 * 3600, 'searches only from 09:00');
});

test('lifted: the cooldown is off, but a security check still ends the read and writes a pause', (t) => {
  const r = run(t, `
(home / 'linkedin-cooldown.json').write_text(json.dumps({'until': NOW + 3600, 'reason': 'LinkedIn pushed back', 'set_at': NOW - 60}))
before = ns['read_cooldown']()
ns['_has_session_cookie'] = lambda target: True
ns['_looks_logged_out'] = lambda page: False
ns['_page_wall'] = lambda pg: 'checkpoint'
kept = []
ns['_keep_pushback_evidence'] = lambda page, reason: kept.append(reason)
try:
    real_ensure_logged_in(page, stop_on_checkpoint=True)
    out['raised'] = None
except ns['LinkedInPushedBack'] as exc:
    out['raised'] = exc.reason
on_file = ns['_cooldown_on_file']()
out.update(before=before, kept=kept, paused_until=on_file and on_file['until'] - NOW, reason=on_file and on_file['reason'],
           still_off=ns['read_cooldown']())`, { lifted: true });
  if (!r) return;
  assert.equal(r.out.before, null, 'lifted: no cooldown holds a scan back');
  assert.equal(r.out.raised, 'a security check', 'the check still stops it');
  assert.deepEqual(r.out.kept, ['a security check']);
  assert.ok(r.out.paused_until >= 24 * 3600 - 5, 'and the pause is written down, for when the limits come back');
  assert.match(r.out.reason, /security check/);
  assert.equal(r.out.still_off, null, 'this run stays lifted; the app puts the limits back on a new pushback');
});

test('a scan under way follows "limits: lifted" and "limits: on" from the app', (t) => {
  const r = run(t, `
import io, time as real
limits(daily=3)
record(searches=[NOW - 60 * i for i in range(1, 4)])
first = ns['searches_left'](NOW)[0]
ns['sys'].stdin = io.StringIO('limits: lifted\\n')
ns['_listen_for_limits']()
real.sleep(0.3)
lifted = [ns['limits_lifted'](), ns['searches_left'](NOW)[0] >= 10 ** 9]
ns['sys'].stdin = io.StringIO('something else\\nlimits: on\\n')
ns['_listen_for_limits']()
real.sleep(0.3)
out.update(first=first, lifted=lifted, back=[ns['limits_lifted'](), ns['searches_left'](NOW)[0]])`);
  if (!r) return;
  assert.equal(r.out.first, 0);
  assert.deepEqual(r.out.lifted, [true, true]);
  assert.deepEqual(r.out.back, [false, 0]);
  assert.match(r.log, /Limits lifted for this session: no daily limit or cooldown\. The pace stays\./);
  assert.match(r.log, /Limits are back on\./);
});
