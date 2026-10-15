// Your connections through LinkedIn's people search (Blake, 2026-10-15: "our
// actual connection list doesn't supply locations in the regular view … if I
// click in the top right that says search with filters it will show all my
// connections like if I was scanning someone's profile and gives more data like
// location"). scripts/scrape.py scan_your_connections reads it the way a circle
// is read, by itself or by hand; the app offers it on the Scan page and fills in
// each row's location and mutual count (app/api/ingest/route.js).
//
// The scanner's side runs its own code against stand-in pages and a stand-in
// clock (tests/helpers/scanner_harness.py), on a scratch data folder. Nothing
// opens a browser or reaches LinkedIn. Invented people only.

import { test, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { register } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { PYTHON, noPython } from './python.mjs';
import { SCRAPER, HARNESS, noScanner } from './helpers/scanner.mjs';
import { capabilityRefusal, capabilities, lockedModes, pluginTooOld, PLUGIN_SINCE, AUTO_ACTIONS } from '../lib/scanner-capabilities.js';
import { yourListNote, pausedList, YOUR_LIST } from '../lib/paused.js';
import { scanLight, whoseConnections } from '../lib/scan-light.js';
import { compareVersions } from '../lib/release.js';
import { SHIPPED_PLUGIN_VERSION } from '../lib/plugins-shipped.js';

register('./helpers/extensionless.mjs', import.meta.url);

const dir = mkdtempSync(path.join(tmpdir(), 'sixgree-your-connections-'));
process.env.SIX_DEGREES_HOME = dir;
process.env.SIX_DEGREES_DB = path.join(dir, 'test.sqlite');

let POST, getDb;
before(async () => {
  ({ POST } = await import('../app/api/ingest/route.js'));
  ({ getDb } = await import('../lib/db-client.js'));
  process.on('exit', () => { try { rmSync(dir, { recursive: true, force: true }); } catch { /* the temp cleanup gets it */ } });
});
beforeEach(() => {
  for (const t of ['linkedin_connections', 'notifications', 'app_meta', 'connection_ties']) getDb().exec(`DELETE FROM ${t}`);
});

const src = (rel) => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8');

/** The scanner's own code on a scratch data folder: `script` runs with ns, clock and out (scanner_harness.py). */
function scanner(t, script) {
  if (noScanner(t)) return null;
  const home = mkdtempSync(path.join(tmpdir(), 'sixgree-your-list-'));
  try {
    const r = spawnSync(PYTHON, [HARNESS, SCRAPER, script], { encoding: 'utf8', env: { ...process.env, SIX_DEGREES_HOME: home } });
    if (noPython(t, r)) return null;
    assert.equal(r.status, 0, r.stderr);
    const lines = r.stdout.trimEnd().split('\n');
    return { out: JSON.parse(lines.pop().replace(/^RESULT /, '')), log: lines.join('\n') };
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
}

// ── the command line and the app's action ────────────────────────────────────

test('the scanner takes --your-connections, and the app runs it as its own action with either plugin', () => {
  const scrape = src('scripts/scrape.py');
  assert.match(scrape, /parser\.add_argument\("--your-connections", action="store_true"/);
  assert.match(scrape, /elif args\.your_connections:\n\s+scan_your_connections\(headless=args\.headless\)/);
  const route = src('app/api/scraper/route.js');
  assert.match(route, /'your-connections': \{ flag: '--your-connections', label: '[^']+', searches: true \}/);
  // Counted against the daily limit before it starts, as a circle's read is.
  assert.match(route, /const readsLists = [^\n]*'your-connections'/);
  // A circle scan's kind of action: not only the auto plugin's, so the manual plugin runs it, By hand.
  assert.ok(!AUTO_ACTIONS.includes('your-connections'));
  for (const caps of [capabilities({ auto: true, from: 'plugin' }), capabilities({ manual: true, from: 'plugin' }), null]) {
    assert.equal(capabilityRefusal(caps, 'your-connections'), null);
  }
  assert.deepEqual(lockedModes(capabilities({ manual: true, from: 'plugin' })), { manual: true, dev: false }, 'manual plugin alone: By hand');
});

test('a scanner plugin from before 1.0.4 is asked to update, never run with a flag it doesn\'t know', () => {
  assert.equal(PLUGIN_SINCE['your-connections'], '1.0.4');
  assert.ok(compareVersions(SHIPPED_PLUGIN_VERSION, '1.0.4') >= 0, 'the plugins it ships in are 1.0.4 or newer');
  const plugin = (version) => ({ from: 'plugin', plugin: { id: 'auto-scan', name: 'Auto scan', version } });
  assert.match(pluginTooOld(plugin('1.0.3'), 'your-connections'), /version 1\.0\.4 or newer of the Auto scan plugin, and 1\.0\.3 is installed\. You can update it in Settings → Plugins\./);
  assert.equal(pluginTooOld(plugin('1.0.4'), 'your-connections'), null);
  assert.equal(pluginTooOld(plugin('1.1.0'), 'your-connections'), null);
  assert.equal(pluginTooOld({ from: 'built-in', plugin: null }, 'your-connections'), null, 'the built-in scanner is this version\'s own');
  assert.equal(pluginTooOld(plugin('1.0.0'), 'bridge'), null, 'older actions run on any plugin');
  assert.match(src('app/api/scraper/route.js'), /const tooOld = pluginTooOld\(scanner, action\);/);
});

test('the Scan page offers it under Your connections, with either plugin, in the mode circle scans run in', () => {
  const page = src('app/setup/page.js');
  assert.match(page, /\{shows\.scan && <Part title="Your connections"/);
  assert.match(page, /onScan=\{\(\) => run\('your-connections'\)\}/);
  assert.match(page, /tooOld=\{pluginTooOld\(c\.scanner, 'your-connections'\)\}/);
  const box = page.slice(page.indexOf('function YourConnectionsSearch'), page.indexOf('/** Why a button can\'t be pressed yet'));
  assert.match(box, /About 100 pages for 1,000 connections, each page a search counted in your daily\s+limit, so it spreads over days/);
  assert.match(box, /mode === 'manual' \? 'By hand' : mode === 'auto' \? 'Automatic'/);
  assert.doesNotMatch(box, /scraping/i);
});

// ── where it starts, and the note it keeps ────────────────────────────────────

test('where a scan of your connections starts: page 1, where it stopped, or page 1 again once every page is read', (t) => {
  const r = scanner(t, `
start = ns['your_list_start']
out['none'] = start(None)
out['more'] = start({'pages': 37, 'more': True})
out['gap'] = start({'pages': 4, 'more': True, 'readPages': [[1, 4], [9, 12]]})
out['done'] = start({'pages': 100, 'more': False})
out['capped'] = start({'pages': 100, 'more': True})
out['ended'] = start({'pages': 60, 'more': False})`);
  if (!r) return;
  assert.deepEqual(r.out.none, [1, false]);
  assert.deepEqual(r.out.more, [38, false]);
  assert.deepEqual(r.out.gap, [5, false], 'the first page still unread, as Resume does');
  assert.deepEqual(r.out.done, [1, true], 'read again from page 1, the note forgotten so it can carry on too');
  assert.deepEqual(r.out.capped, [1, true], 'page 100 is as far as the search goes');
  assert.deepEqual(r.out.ended, [1, true]);
});

test('its note is no one\'s circle: the Paused list never shows it, and the Scan page reads how far it got', () => {
  const progress = { [YOUR_LIST]: { name: 'Your connections', pages: 37, more: true, at: '2026-10-15T10:00:00' } };
  assert.deepEqual(pausedList([{ id: 'a', name: 'Invented Ada', profile_url: 'https://www.linkedin.com/in/ada/' }], new Set(), progress), []);
  assert.deepEqual(yourListNote(progress), { pages: 37, more: true, at: '2026-10-15T10:00:00' });
  assert.deepEqual(yourListNote({ [YOUR_LIST]: { pages: 100, more: true } }), { pages: 100, more: false, at: null });
  assert.equal(yourListNote({}), null);
  assert.equal(yourListNote(null), null);
  assert.match(src('scripts/scrape.py'), /YOUR_LIST = "your-connections"/, 'the scanner\'s key and the app\'s are the same');
});

test('the window is on your connections only on the 1st-degree search, never someone\'s circle or a wider one', (t) => {
  const r = scanner(t, `
yours = ns['_your_search']
out['search'] = yours(ns['YOUR_SEARCH_URL'])
out['paged'] = yours('https://www.linkedin.com/search/results/people/?network=%5B%22F%22%5D&origin=FACETED_SEARCH&page=7')
out['first'] = yours('https://www.linkedin.com/search/results/people/?page=3&network=["F"]')
out['circle'] = yours('https://www.linkedin.com/search/results/people/?network=%5B%22F%22%5D&connectionOf=%5B%22ACoAAInvented%22%5D')
out['wider'] = yours('https://www.linkedin.com/search/results/people/?network=%5B%22F%22%2C%22S%22%5D')
out['feed'] = yours('https://www.linkedin.com/feed/')
out['list'] = yours('https://www.linkedin.com/mynetwork/invite-connect/connections/')`);
  if (!r) return;
  assert.deepEqual(r.out, { search: true, paged: true, first: true, circle: false, wider: false, feed: false, list: false });
});

// ── reading it, by itself and by hand ─────────────────────────────────────────

// Your connections' search as a window: `plan` is [seconds from now, what], what being
// "foot", "next", "away" (the window goes to someone's circle), "back" or "close".
const OWN_PAGE = `
def card(i):
    return {'name': f'Invented Person {i}', 'headline': f'Analyst at Example Co {i}',
            'profileUrl': f'https://www.linkedin.com/in/invented-{i:04d}/', 'imageUrl': '',
            'location': 'Lisbon, Portugal', 'mutualCount': 100 + i}
class OwnPage:
    def __init__(self, pages, plan=(), start=1):
        self.pages, self.plan = pages, sorted(plan, key=lambda x: x[0])
        self.pg, self.foot, self.closed, self.away, self.read_at, self.opened = start, False, False, False, [], []
    def _act(self):
        while self.plan and NOW + self.plan[0][0] <= clock.t:
            _, what = self.plan.pop(0)
            if what == 'foot': self.foot = True
            elif what == 'close': self.closed = True
            elif what == 'away': self.away = True
            elif what == 'back': self.away = False
            elif what == 'next': self.pg, self.foot = self.pg + 1, False
    def people(self):
        return [card((self.pg - 1) * 10 + i) for i in range(10)]
    @property
    def url(self):
        self._act()
        if self.away:
            return 'https://www.linkedin.com/search/results/people/?connectionOf=%5B%22ACoAAInvented%22%5D&page=2'
        return ns['YOUR_SEARCH_URL'] + '&page=' + str(self.pg)
    def goto(self, url, **_):
        self.opened.append(url)
        self.pg = ns['_url_page'](url)
        return types.SimpleNamespace(status=200)
    def wait_for_selector(self, *a, **k):
        pass
    def is_closed(self):
        self._act()
        return self.closed
    def locator(self, selector):
        return Button(self)
    def evaluate(self, js, *a):
        self._act()
        if js == ns['AT_FOOT_JS']: return self.foot
        if js == ns['NEXT_STATE_JS']: return 'on' if self.pg < self.pages else 'off'
        if js == ns['CURRENT_PAGE_JS']: return self.pg
        if js == ns['RESULT_COUNT_JS']: return self.pages * 10
        if js == ns['RESULT_LINKS_JS']: return sorted(p['profileUrl'] for p in self.people())
        if js == ns['BRIDGE_RESULTS_JS']:
            self.read_at.append(self.pg)
            return self.people()
        return None
`;

test('by itself: straight to the search, every page read and sent as your connections with where they are and the mutuals', (t) => {
  const r = scanner(t, `${OWN_PAGE}
import types
ns['GENTLE']['on'] = False
ns['interruptible_sleep'] = lambda s, on_tick=None, step=5: True
ns['_find_next'] = lambda page, label='Next': object() if page.pg < page.pages else None
def advance(page, pg, back=False):
    if page.pg >= page.pages: return 'end'
    page.pg += 1
    return 'moved'
ns['_advance'] = advance
ns['_read_results_page'] = lambda page: page.evaluate(ns['BRIDGE_RESULTS_JS'])
page = OwnPage(3)
saved = []
people, status, reach = ns['_scrape_one_bridge'](page, 'your connections', None, ns['YOUR_LIST'], own=True,
                                                on_save=lambda c, last, more, urn: saved.append(len(c)))
out.update({'people': len(people), 'status': status, 'last': reach['last'], 'more': reach['more'],
            'opened': page.opened, 'read': page.read_at, 'searches': len(charged),
            'first': people[0] if people else None})`);
  if (!r) return;
  assert.equal(r.out.status, 'success');
  assert.equal(r.out.people, 30, 'no one filtered out: there is no bridge on your own list');
  assert.deepEqual(r.out.read, [1, 2, 3]);
  assert.equal(r.out.last, 3);
  assert.equal(r.out.more, false);
  assert.deepEqual(r.out.opened, ['https://www.linkedin.com/search/results/people/?network=%5B%22F%22%5D&origin=FACETED_SEARCH'],
    'no profile opened: the search, and nothing else');
  assert.equal(r.out.searches, 1, 'the opening search is charged (each Next is charged in _advance)');
  assert.deepEqual(r.out.first, { name: 'Invented Person 0', headline: 'Analyst at Example Co 0', profileUrl: 'https://www.linkedin.com/in/invented-0000/', imageUrl: '', location: 'Lisbon, Portugal', mutualCount: 100 });
  assert.match(r.log, /Going straight to your connections, through LinkedIn's people search\./);
  assert.match(r.log, /^ {2}Opening your connections\.\.\.$/m);
  assert.match(r.log, /^ {2}About 30 results in your list: 3 pages\.$/m);
  assert.match(r.log, /^ {2}Page 2\.\.\. 10 found \(total: 20\)$/m, 'the line the app counts pages by');
  assert.doesNotMatch(r.log, /profile view|Opening .*'s profile/);
});

test('a network past what the search shows says so: the rest can come from Dig deeper later', (t) => {
  const r = scanner(t, `${OWN_PAGE}
import types
page = OwnPage(130, [[100, 'close']])
ns['_scrape_one_bridge'](page, 'your connections', None, ns['YOUR_LIST'], own=True, manual=True)`);
  if (!r) return;
  assert.match(r.log, /About 1,300 results in your list: 130 pages, and LinkedIn shows the first 100\./);
  assert.match(r.log, /LinkedIn's search goes no further than page 100 \(1,000 people\), so about 300 of your connections are past its end\. Where they are can come from Dig deeper later\./);
});

test('by hand: each page read at its foot, said as "your list", waiting when the window wanders off, and resumable', (t) => {
  const r = scanner(t, `${OWN_PAGE}
import types
page = OwnPage(5, [[100, 'foot'], [110, 'next'], [120, 'away'], [150, 'back'], [160, 'foot'], [180, 'close']], start=3)
people, status, reach = ns['_scrape_one_bridge'](page, 'your connections', None, ns['YOUR_LIST'], start_page=3,
                                                own=True, manual=True)
out.update({'people': len(people), 'status': status, 'last': reach['last'], 'more': reach['more'], 'read': page.read_at})`);
  if (!r) return;
  assert.equal(r.out.status, 'success');
  assert.deepEqual(r.out.read, [3, 4]);
  assert.equal(r.out.people, 20);
  assert.equal(r.out.last, 4);
  assert.equal(r.out.more, true, 'closed before the end: the next scan carries on');
  assert.match(r.log, /^ {2}Opening your connections at page 3\.\.\.$/m);
  assert.match(r.log, /Manual mode: you page through your list, and each page is read when you reach its foot\./);
  assert.match(r.log, /LinkedIn needs you: scroll to the bottom of each page of your connections in the Chrome window, then click Next\. Close the window when you're done\.$/m);
  assert.match(r.log, /\(waiting: the window isn't on your list\. Go back to it to carry on\.\)/);
  assert.match(r.log, /page 3 is read \(10 people\)\. Click Next, then scroll to the bottom of page 4\. Close the window when you're done\.$/m);
  assert.match(r.log, /The window was closed: done with your list, and what was read is kept\./);
  assert.match(r.log, /^Manual read done: 2 pages of your list\.$/m);
  assert.doesNotMatch(r.log, /your connections's|done with your connections/);

  // The scan light reads those lines as it reads a circle's.
  const lines = r.log.split('\n');
  const job = (upTo) => ({ running: true, action: 'your-connections', target: null, mode: 'manual', log: lines.slice(0, upTo), pages: 1, found: [10] });
  const away = lines.findIndex((l) => /the window isn't on your list/.test(l)) + 1;
  const light = scanLight(job(away));
  assert.equal(light.mode, 'manual');
  assert.equal(light.color, 'red');
  assert.equal(light.headline, 'Go back to your list');
  assert.equal(light.stats.who, 'your');
  assert.equal(whoseConnections(light.stats.who), 'Your connections');
  assert.equal(whoseConnections('Invented Bridge'), 'Invented Bridge\'s connections');
  const done = lines.findIndex((l) => /^Manual read done/.test(l)) + 1;
  assert.equal(scanLight(job(done)).headline, 'Done with your list');
});

test('scan_your_connections carries on from its note, reads again from page 1 once done, and saves as 1st degree', (t) => {
  const r = scanner(t, `
import json
install_browser(types.SimpleNamespace(set_default_timeout=lambda ms: None, set_default_navigation_timeout=lambda ms: None))
calls = []
def one(page, name, bridge_id, url, **kw):
    calls.append({'name': name, 'url': url, 'start': kw.get('start_page'), 'own': kw.get('own'), 'manual': kw.get('manual')})
    return ([{'name': 'Invented Ada', 'profileUrl': 'https://www.linkedin.com/in/invented-ada/', 'location': 'Lisbon, Portugal', 'mutualCount': 12}],
            'success', {'last': kw.get('start_page'), 'more': True, 'urn': None, 'found': 1, 'limited': False})
ns['_scrape_one_bridge'] = one
pushed = []
ns['push_connections'] = lambda c, degree=1, bridge_id=None, user_id=None, on_saved=None: (pushed.append([len(c), degree]), on_saved and on_saved())
ns['read_cooldown'] = lambda now=None: None
ns['manual_reads'] = lambda: False
note = lambda: ns['load_bridge_progress']().get(ns['YOUR_LIST'])
ns['scan_your_connections']()
out['first'] = note()
ns['record_bridge_progress'](ns['YOUR_LIST'], 'Your connections', 37, True)
ns['scan_your_connections']()
ns['record_bridge_progress'](ns['YOUR_LIST'], 'Your connections', 100, False)
ns['scan_your_connections']()
out['calls'], out['pushed'], out['after'] = calls, pushed, note()`);
  if (!r) return;
  assert.deepEqual(r.out.calls.map((c) => c.start), [1, 38, 1]);
  for (const c of r.out.calls) {
    assert.equal(c.url, 'your-connections');
    assert.equal(c.own, true);
    assert.equal(c.manual, false);
  }
  assert.deepEqual(r.out.pushed, [[1, 1], [1, 1], [1, 1]], 'sent as degree 1');
  assert.deepEqual([r.out.first.pages, r.out.first.more], [1, true]);
  assert.deepEqual([r.out.after.pages, r.out.after.more], [1, true], 'the finished note was forgotten, so this pass resumes too');
  assert.match(r.log, /Every page of your connections was read before: reading them again from page 1/);
  assert.match(r.log, /There's more; the next scan carries on from page 2\./);
});

test('the mutual line on a 1st-degree card counts the names and the others', (t) => {
  const r = scanner(t, `
out['amp'] = ns['mutual_count_text']('Invented Ada, Invented Ben & 103 other mutual connections')
out['and'] = ns['mutual_count_text']('Invented Ada and 103 other mutual connections')
out['one'] = ns['mutual_count_text']('Invented Ada is a mutual connection')`);
  if (!r) return;
  assert.deepEqual(r.out, { amp: 105, and: 104, one: 1 });
});

// ── what the app keeps ────────────────────────────────────────────────────────

const link = (slug) => `https://www.linkedin.com/in/${slug}/`;
const own = async (connections) => (await POST(new Request('http://127.0.0.1/api/ingest', {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ connections, type: 'degree1', userId: 'me' }),
}))).json();
const row = (slug) => ({ ...getDb().prepare(
  'SELECT degree, headline, location, followers, mutual_count AS mutuals FROM linkedin_connections WHERE profile_url = ?',
).get(link(slug)) });
const card = (slug, extra = {}) => ({ name: `Invented ${slug}`, headline: 'Engineer at Initech', profileUrl: link(slug), ...extra });

test('the rows you have gain where they are and the mutuals, by profile URL; anyone new is added; nothing read is cleared', async () => {
  // As the connections walk saved them: no place, no mutuals.
  await own([card('ada'), card('ben', { location: 'Austin, Texas, United States' })]);
  assert.deepEqual(row('ada'), { degree: 1, headline: 'Engineer at Initech', location: null, followers: null, mutuals: null });

  // The search of your connections: the place and the mutuals, and Cy, not saved yet.
  const got = await own([
    card('ada', { location: 'Lisbon, Portugal', mutualCount: 105 }),
    card('ben', { mutualCount: 3 }),
    card('cy', { location: 'Greater London', followers: 3766, mutualCount: 12 }),
  ]);
  assert.equal(got.saved, 1, 'Cy is new');
  assert.deepEqual(row('ada'), { degree: 1, headline: 'Engineer at Initech', location: 'Lisbon, Portugal', followers: null, mutuals: 105 });
  assert.deepEqual(row('ben'), { degree: 1, headline: 'Engineer at Initech', location: 'Austin, Texas, United States', followers: null, mutuals: 3 },
    'a card without a place keeps the one already read');
  assert.deepEqual(row('cy'), { degree: 1, headline: 'Engineer at Initech', location: 'Greater London', followers: 3766, mutuals: 12 });

  // A later walk of your connections, which reads neither: both stay.
  await own([card('ada'), card('cy')]);
  assert.equal(row('ada').location, 'Lisbon, Portugal');
  assert.equal(row('ada').mutuals, 105);
  assert.equal(row('cy').mutuals, 12);
  assert.equal(getDb().prepare('SELECT COUNT(*) AS n FROM linkedin_connections').get().n, 3, 'one row each');
});

test('someone in a circle who turns up in your connections\' search is promoted, with the mutuals the search read', async () => {
  await POST(new Request('http://127.0.0.1/api/ingest', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ connections: [card('dee', { mutualCount: 4 })], type: 'degree2', bridgeId: 'bridge-maya', userId: 'me' }),
  }));
  const got = await own([card('dee', { location: 'Toronto, Ontario, Canada', mutualCount: 9 })]);
  assert.equal(got.promoted, 1);
  assert.deepEqual(row('dee'), { degree: 1, headline: 'Engineer at Initech', location: 'Toronto, Ontario, Canada', followers: null, mutuals: 9 });
});
