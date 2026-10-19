// Wasted load and a crash, fixed (Blake, 2026-10-17, from his scan load research:
// "Sixgree - Scan Load Research", sections 3 and 5). Efficiency, not guardrails:
//   - lists that started again at page 1 by themselves (your connections, Breach,
//     Read all mutuals) open nothing once finished unless asked (--again);
//   - pages read and lost at Stop: each page is saved as it's read;
//   - pages read again on resume: the automatic loop ends a round at pages an
//     earlier run read, instead of clicking Next through them;
//   - page loads by hand that went uncounted (Previous, revisits, reloads) count;
//   - the crash in _wire_merge (an undefined name) that lost a charged page.
//
// These run the scanner's own code against stand-in pages and a stand-in clock
// (tests/helpers/scanner_harness.py). Nothing opens a browser or reaches LinkedIn.
// Invented people only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { PYTHON, noPython } from './python.mjs';
import { SCRAPER, HARNESS, noScanner } from './helpers/scanner.mjs';
import { PLUGIN_FLAGS_SINCE, pluginHas } from '../lib/scanner-capabilities.js';
import { SHIPPED_PLUGIN_VERSION } from '../lib/plugins-shipped.js';

const src = (rel) => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8');

function scanner(t, script) {
  if (noScanner(t)) return null;
  const home = mkdtempSync(path.join(tmpdir(), 'sixgree-load-'));
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

const QUIET = `
ns['GENTLE']['on'] = False
ns['interruptible_sleep'] = lambda s, on_tick=None, step=5: True
`;

// ── the crash ────────────────────────────────────────────────────────────────

test('the crash: LinkedIn\'s own data with a list total no longer fails the page it was charged for', (t) => {
  const r = scanner(t, `${QUIET}
ns['EXPERIMENT'].update(on=True, pages=0, sitting=0)
ns['_drip_before_search'] = lambda: True
ns['_wire_tap'] = lambda page: None
class R:
    url = 'https://www.linkedin.com/voyager/api/graphql?queryId=voyagerSearchDashClusters.invented'
    def json(self):
        return {'data': {'metadata': {'totalResultCount': 312}, 'elements': []}}
ns['_WIRE']['responses'] = [R()]
saved = []
page = ResultsPage(pages=2)
people, status, reach = ns['_scrape_one_bridge'](page, 'Invented Bridge', 'b1', 'https://www.linkedin.com/in/invented-bridge/',
                                                 urn='urn:li:fsd_profile:INVENTED', max_pages=2, list_key='mutuals:invented',
                                                 on_save=lambda c, last, more, urn: saved.append(len(c)))
out.update(status=status, saved=saved, totals=dict(ns['_LIST_TOTALS']))`);
  if (!r) return;
  assert.equal(r.out.status, 'success');
  assert.deepEqual(r.out.saved, [10, 10], 'both pages\' people saved');
  // Kept under the list's own key (a list_key, here), not a name the function never had.
  assert.deepEqual(r.out.totals, { 'mutuals:invented': 312 });
  assert.match(r.log, /LinkedIn's own data: 0 people, 0 not in the page text, list of about 312/);
});

test('the crash: scrape.py names nothing it doesn\'t have in _wire_merge', () => {
  const body = src('scripts/scrape.py').match(/def _wire_merge\(page, profile_url, page_results, key=None\):[\s\S]*?\n\n\n/)[0];
  assert.match(body, /_LIST_TOTALS\[key or profile_url\] = int\(total\)/);
  assert.match(src('scripts/scrape.py'), /_wire_merge\(page, profile_url, page_results, key=key\)/);
});

// ── pages lost on Stop ───────────────────────────────────────────────────────

test('Stop loses nothing read: an automatic read saves each page as it is read, before the pause', (t) => {
  const r = scanner(t, `${QUIET}
saved = []
def save(c, last, more, urn):
    saved.append([len(c), last])
def sleeper(s, on_tick=None, step=5):
    # Stop pressed in the pause after page 2.
    if len(saved) >= 2:
        ns['_stop_requested'] = True
        return False
    return True
ns['interruptible_sleep'] = sleeper
page = ResultsPage(pages=5)
people, status, reach = ns['_scrape_one_bridge'](page, 'Invented Bridge', 'b1', 'https://www.linkedin.com/in/invented-bridge/',
                                                 urn='urn:li:fsd_profile:INVENTED', on_save=save)
out.update(status=status, saved=saved, left=len(people), last=reach['last'], more=reach['more'])`);
  if (!r) return;
  assert.deepEqual(r.out.saved, [[10, 1], [10, 2]], 'page 1 and page 2, each the moment it was read');
  assert.equal(r.out.left, 0, 'nothing left to save at the end');
  assert.deepEqual([r.out.last, r.out.more], [2, true]);
  assert.match(r.log, /saving each page as it's read/);
});

test('Stop loses nothing read: by hand, each page is saved the moment it is read', (t) => {
  const r = scanner(t, `
URN = 'ACoAAInventedUrn'
class ManualPage:
    def __init__(self, plan, pages=5):
        self.plan, self.pages, self.pg, self.foot, self.closed = sorted(plan), pages, 1, False, False
    def _act(self):
        while self.plan and NOW + self.plan[0][0] <= clock.t:
            _, what = self.plan.pop(0)
            if what == 'foot': self.foot = True
            elif what == 'next': self.pg, self.foot = self.pg + 1, False
            elif what == 'stop': ns['_stop_requested'] = True
    @property
    def url(self):
        self._act()
        return 'https://www.linkedin.com/search/results/people/?connectionOf=%5B%22' + URN + '%22%5D&page=' + str(self.pg)
    def is_closed(self):
        self._act()
        return False
    def evaluate(self, js, *a):
        self._act()
        if js == ns['AT_FOOT_JS']: return self.foot
        if js == ns['NEXT_STATE_JS']: return 'on'
        if js == ns['CURRENT_PAGE_JS']: return self.pg
        if js == ns['RESULT_LINKS_JS']: return [str(self.pg)]
        if js == ns['BRIDGE_RESULTS_JS']: return [person((self.pg - 1) * 10 + i) for i in range(10)]
        return None
ns['_chime'] = lambda name: None
saved = []
reach = {'last': 0, 'more': False, 'urn': URN, 'found': 0, 'limited': False, 'pushed_back': False}
page = ManualPage([[1, 'foot'], [3, 'next'], [5, 'foot'], [6, 'stop']])
people, status, reach = ns['_read_by_hand'](page, 'Invented Bridge', 'https://www.linkedin.com/in/invented-bridge/',
                                            'invented-bridge', 1, 100, reach, lambda c, last, more, urn: saved.append([len(c), last]), 50)
out.update(status=status, saved=saved, left=len(people))`);
  if (!r) return;
  assert.equal(r.out.status, 'stopped');
  assert.deepEqual(r.out.saved, [[10, 1], [10, 2]], 'two pages, two saves, before Stop');
  assert.equal(r.out.left, 0);
});

// ── pages read again on resume ───────────────────────────────────────────────

test('an automatic round ends at pages an earlier run read, instead of clicking through them again', (t) => {
  const r = scanner(t, `${QUIET}
URL = 'https://www.linkedin.com/in/invented-bridge/'
# Page 1 read, and pages 4 to 6 read past a gap (record_bridge_progress's readPages).
ns['_change_progress'](lambda mine: mine.update({URL: {'name': 'Invented Bridge', 'pages': 1, 'more': True, 'readPages': [[1, 1], [4, 6]]}}))
saved = []
page = ResultsPage(pages=9)
page.pg = 2
people, status, reach = ns['_scrape_one_bridge'](page, 'Invented Bridge', 'b1', URL, urn='urn:li:fsd_profile:INVENTED',
                                                 start_page=2, max_pages=26, on_save=lambda c, last, more, urn: saved.append(last))
out.update(status=status, saved=saved, last=reach['last'], more=reach['more'], read=sorted(reach['read']),
           clicks=page.clicks, searches=len(charged))`);
  if (!r) return;
  assert.equal(r.out.status, 'success');
  assert.deepEqual(r.out.read, [2, 3], 'pages 2 and 3, the ones not read');
  assert.equal(r.out.clicks, 1, 'one Next, 2 to 3; none through 4, 5 and 6');
  assert.equal(r.out.searches, 2, 'the opening load and that Next');
  assert.deepEqual([r.out.last, r.out.more], [6, true], 'the bookmark moves past the pages read before');
  assert.deepEqual(r.out.saved, [2, 6]);
  assert.match(r.log, /Pages 4–6 were read before, so this round ends here rather than clicking through them again\. The next round opens page 7 directly\./);
});

test('Scan or Rescan from the start still reads every page: it is asked for', (t) => {
  const r = scanner(t, `${QUIET}
URL = 'https://www.linkedin.com/in/invented-bridge/'
ns['_change_progress'](lambda mine: mine.update({URL: {'name': 'Invented Bridge', 'pages': 1, 'more': True, 'readPages': [[1, 1], [3, 4]]}}))
page = ResultsPage(pages=4)
people, status, reach = ns['_scrape_one_bridge'](page, 'Invented Bridge', 'b1', URL, urn='urn:li:fsd_profile:INVENTED',
                                                 from_start=True, on_save=lambda *a: None)
out.update(read=sorted(reach['read']))`);
  if (!r) return;
  assert.deepEqual(r.out.read, [1, 2, 3, 4]);
});

// ── finished lists start again only when asked ───────────────────────────────

test('a finished list opens nothing by itself; Read again from page 1 sends --again, only to a scanner that knows it', () => {
  const scrape = src('scripts/scrape.py');
  assert.match(scrape, /parser\.add_argument\("--again", action="store_true"/);
  for (const fn of ['scan_your_connections', 'scan_company_search', 'scan_mutual_list']) {
    assert.match(scrape, new RegExp(`def ${fn}\\([^)]*again=False\\)`), fn);
  }
  const route = src('app/api/scraper/route.js');
  assert.match(route, /const LIST_AGAIN = \['your-connections', 'breach', 'mutuals'\];/);
  assert.match(route, /body\.again === true && LIST_AGAIN\.includes\(action\) && pluginHas\(scanner, 'list-again'\) \? \['--again'\] : \[\]/);
  assert.match(route, /\.\.\.\(body\.again === true \? \{ again: true \} : \{\}\)/, 'kept when it waits in the queue');
  assert.equal(PLUGIN_FLAGS_SINCE['list-again'], '1.0.12');
  assert.equal(SHIPPED_PLUGIN_VERSION, '1.0.12');
  const plugin = (version) => ({ from: 'plugin', plugin: { name: 'Manual scan', version } });
  assert.equal(pluginHas(plugin('1.0.11'), 'list-again'), false, 'an older plugin would stop at an unknown flag');
  assert.equal(pluginHas(plugin('1.0.12'), 'list-again'), true);
  assert.equal(pluginHas({ from: 'built-in' }, 'list-again'), true);
});

// ── page loads by hand: every one counts ─────────────────────────────────────

test('by hand, every page the window loads is a search: Next, Previous, a revisit, a reload, the address bar', (t) => {
  const r = scanner(t, `
URN = 'ACoAAInventedUrn'
VOYAGER = 'https://www.linkedin.com/voyager/api/graphql?queryId=voyagerSearchDashClusters.invented'
class Req:
    def __init__(self, url, kind):
        self.url, self.resource_type = url, kind
    def is_navigation_request(self):
        return self.resource_type == 'document'
class LoadPage:
    def __init__(self, plan, pages=6):
        self.plan, self.pages, self.pg, self.foot, self.closed = sorted(plan), pages, 1, False, False
        self.listeners, self.loads = [], 0
    def on(self, event, fn): self.listeners.append(fn)
    def remove_listener(self, event, fn): self.listeners.remove(fn)
    def address(self, pg):
        return 'https://www.linkedin.com/search/results/people/?connectionOf=%5B%22' + URN + '%22%5D&page=' + str(pg)
    def _ask(self, url, kind):
        self.loads += 1
        for fn in list(self.listeners):
            fn(Req(url, kind))
    def _act(self):
        while self.plan and NOW + self.plan[0][0] <= clock.t:
            _, what = self.plan.pop(0)
            if what == 'foot': self.foot = True
            elif what == 'close': self.closed = True
            elif what == 'next': self._ask(VOYAGER, 'fetch'); self.pg, self.foot = self.pg + 1, False
            elif what == 'prev': self._ask(VOYAGER, 'fetch'); self.pg, self.foot = self.pg - 1, False
            elif what == 'reload': self._ask(self.address(self.pg), 'document'); self.foot = False
            elif what == 'address': self._ask(self.address(self.pg + 1), 'document'); self.pg, self.foot = self.pg + 1, False
    @property
    def url(self):
        self._act()
        return self.address(self.pg)
    def is_closed(self):
        self._act()
        return self.closed
    def evaluate(self, js, *a):
        self._act()
        if js == ns['AT_FOOT_JS']: return self.foot
        if js == ns['NEXT_STATE_JS']: return 'on' if self.pg < self.pages else 'off'
        if js == ns['CURRENT_PAGE_JS']: return self.pg
        if js == ns['RESULT_LINKS_JS']: return [str(self.pg)]
        if js == ns['BRIDGE_RESULTS_JS']: return [person((self.pg - 1) * 10 + i) for i in range(10)]
        return None
ns['_chime'] = lambda name: None
reach = {'last': 0, 'more': False, 'urn': URN, 'found': 0, 'limited': False, 'pushed_back': False}
page = LoadPage([[1, 'foot'], [3, 'next'], [5, 'foot'], [7, 'prev'], [9, 'next'], [11, 'reload'],
                 [13, 'next'], [15, 'foot'], [17, 'address'], [19, 'foot'], [21, 'close']])
people, status, reach = ns['_read_by_hand'](page, 'Invented Bridge', 'https://www.linkedin.com/in/invented-bridge/',
                                            'invented-bridge', 1, 100, reach, lambda c, last, more, urn: None, 60)
out.update(status=status, searches=len(charged), loads=page.loads, last=reach['last'])`);
  if (!r) return;
  assert.equal(r.out.status, 'success');
  assert.equal(r.out.last, 4);
  // 2, back to 1, 2 again, a reload of 2, 3, and 4 by the address bar: six loads, six searches.
  // Counted once a page number a run, it was two (pages 2 and 3), then three with page 4.
  assert.equal(r.out.loads, 6);
  assert.equal(r.out.searches, 6, 'each load once: the address bar\'s whole page and its page change are one');
});

test('the scanner\'s own counted reloads stay counted, and the docs say what is counted', () => {
  const scrape = src('scripts/scrape.py');
  assert.match(scrape, /def _counted_reload\(kind\):[\s\S]*?charge_linkedin\("searches"\)/);
  assert.match(scrape, /MANUAL_LOAD_PAIR = 15/);
  const docs = src('docs/SCRAPING.md');
  assert.match(docs, /[Ss]can windows?/);
  assert.match(docs, /60 search pages/);
  assert.match(docs, /--again/);
});
