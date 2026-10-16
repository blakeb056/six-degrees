// Breaks by hand (Blake, 2026-10-15: "let's make them wait every 10 pages so that's
// like 1-10 and then 20 seconds with a ticking sound"). After every breakEvery pages
// read in manual mode, the next page waits as long as the speed says (30 s Slow, 10
// Medium, 5 Fast; lib/manual-breaks.js breakSecondsFor): the window is held (a layer
// that takes the clicks, and Playwright holding the search requests), a tick plays
// each second, and the scan light counts down. Also here: the "found" count of a page
// counts its people, not the names in their mutual lines, and the panel's wording.
//
// The scanner's side runs its own code (tests/helpers/scanner_harness.py) against a
// stand-in window with a stand-in person who clicks Next as fast as they can, and a
// stand-in clock. Nothing opens a browser, plays a sound or reaches LinkedIn. Invented
// people only.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { PYTHON, noPython } from './python.mjs';
import { SCRAPER, HARNESS, noScanner } from './helpers/scanner.mjs';
import {
  BREAK_DEFAULTS, BREAK_EVERY_RANGE, BREAK_SECONDS_RANGE, BREAK_WHY, breakText, validBreakEvery, validBreakSeconds,
  BREAK_PACE_SECONDS, BREAK_PACE_DEFAULT, BREAK_PACE_TEXT, breakSecondsFor,
} from '../lib/manual-breaks.js';
import { PACES } from '../lib/scan-pace.js';
import { DEFAULT_LIMITS, readLimits, writeLimits } from '../lib/linkedin-limits.js';
import { CHIME_NAMES, chimeSamples, SAMPLE_RATE } from '../lib/chimes.js';
import { ensureChimes } from '../lib/chime-files.js';
import { scanLight, isManualRun, lightLabel } from '../lib/scan-light.js';
import { SHIPPED_PLUGIN_VERSION } from '../lib/plugins-shipped.js';

const scratch = () => mkdtempSync(path.join(tmpdir(), 'sixgree-breaks-'));
const src = (rel) => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8');

/** The scanner's own code on a scratch data folder: `script` runs with ns, clock and out. */
function scanner(t, script, { home: given, limits } = {}) {
  if (noScanner(t)) return null;
  const home = given || scratch();
  try {
    if (limits) writeFileSync(path.join(home, 'scan-limits.json'), JSON.stringify(limits));
    const r = spawnSync(PYTHON, [HARNESS, SCRAPER, script], { encoding: 'utf8', env: { ...process.env, SIX_DEGREES_HOME: home } });
    if (noPython(t, r)) return null;
    assert.equal(r.status, 0, r.stderr);
    const lines = r.stdout.trimEnd().split('\n');
    return { out: JSON.parse(lines.pop().replace(/^RESULT /, '')), log: lines.join('\n') };
  } finally {
    if (!given) rmSync(home, { recursive: true, force: true });
  }
}

// Their list in a window, and a person working it as fast as they can: each page's
// foot a second after it shows, then Next a second and a half later, and again every
// second while it doesn't go. A click on Next is LinkedIn's search API asked for the
// next page; the address bar (`address_at`) asks for the next page's address. Either
// goes through Playwright's routes first, as the browser's requests do: one that is
// held waits until it's let go. While the break's layer is up, a click lands on the
// layer and does nothing.
const HAND = `
import types
URN = 'ACoAAInventedUrn'
VOYAGER = 'https://www.linkedin.com/voyager/api/graphql?queryId=voyagerSearchDashClusters.invented'
class Request:
    def __init__(self, url):
        self.url, self.resource_type = url, 'fetch' if 'voyager' in url else 'document'
    def is_navigation_request(self):
        return self.resource_type == 'document'
class Route:
    def __init__(self, page, url, go):
        self.page, self.url, self.go, self.done, self.request = page, url, go, None, Request(url)
        page.pending.append(self)
    def continue_(self):
        self.done = 'continued'
        self.go()
class HandPage:
    def __init__(self, pages, mutuals=0, address_at=None, start=1, quick=1.5, slow_read=0.0, address_after=None):
        self.pages, self.mutuals, self.address_at = pages, mutuals, address_at
        self.quick, self.slow_read, self.address_after = quick, slow_read, address_after
        self.pg, self.foot, self.closed = start, False, False
        self.shown_at, self.foot_at, self.tried = clock.t, None, None
        self.layer, self.layers, self.routes, self.held = None, [], [], []
        self.blocked, self.loads, self.listeners, self.routed = [], [], [], 0
        self.pending, self.hangs = [], 0
        # BREAK_ARM_JS: the armed click (gone with its page) and the flag (kept by the tab);
        # BREAK_INIT_JS, once added, covers a whole new page while the flag is set.
        self.armed, self.flag, self.inits, self.raised = None, None, [], []
    def add_init_script(self, script): self.inits.append(script)
    def on(self, event, fn): self.listeners.append(fn)
    def remove_listener(self, event, fn): self.listeners.remove(fn)
    def route(self, matcher, handler):
        self.routes.append((matcher, handler))
        self.routed += 1
    def unroute(self, matcher, handler): self.routes.remove((matcher, handler))
    def address(self, pg):
        return 'https://www.linkedin.com/search/results/people/?connectionOf=%5B%22' + URN + '%22%5D&page=' + str(pg)
    def _go(self, pg, document=False):
        def go():
            self.loads.append([pg, round(clock.t - NOW, 1)])
            self.pg, self.foot, self.shown_at, self.foot_at, self.tried = pg, False, clock.t, None, None
            if document:
                # A whole new page: the old one's layer and armed click go with it, and the
                # init script puts the layer up from the first paint while the flag is set.
                self.layer, self.armed = None, None
                if self.inits and self.flag is not None:
                    self.layer = self.flag
                    self.raised.append(round(clock.t - NOW, 1))
        return go
    def _ask(self, url, go):
        for fn in list(self.listeners):
            fn(Request(url))
        for matcher, handler in list(self.routes):
            if matcher(url):
                r = Route(self, url, go)
                handler(r, r.request)
                if r.done is None:
                    self.held.append(round(clock.t - NOW, 1))
                return
        go()
    def _act(self):
        now = clock.t
        if self.address_at is not None and now >= NOW + self.address_at:
            self.address_at = None
            self._ask(self.address(self.pg + 1), self._go(self.pg + 1, document=True))
            return
        if not self.foot and now - self.shown_at >= 1.0:
            self.foot, self.foot_at = True, now
        elif self.foot and self.pg < self.pages and now - self.foot_at >= self.quick \\
                and (self.tried is None or now - self.tried >= 1.0):
            self.tried = now
            if self.layer is not None:
                self.blocked.append(round(now - NOW, 1))
            elif self.address_after == self.pg and self.armed is not None:
                # The address bar instead of Next: a whole new page.
                self.address_after = None
                self._ask(self.address(self.pg + 1), self._go(self.pg + 1, document=True))
            else:
                if self.armed is not None:
                    # The armed click puts the layer up in the same click, before the page it asks for draws.
                    self.layer = self.armed
                    self.raised.append(round(now - NOW, 1))
                self._ask(VOYAGER, self._go(self.pg + 1))
    @property
    def url(self):
        self._act()
        return self.address(self.pg)
    def is_closed(self):
        self._act()
        return self.closed
    def people(self):
        out = [person((self.pg - 1) * 10 + i) for i in range(10)]
        # The names in their mutual lines: your own connections, on the page as links too.
        out += [dict(person(9000 + i), mutualOnly=True) for i in range(self.mutuals)]
        return out
    def evaluate(self, js, *a):
        # Playwright's evaluate waits for a navigation to commit: with one held, it would wait for ever.
        if any(r.done is None and r.request.is_navigation_request() for r in self.pending):
            self.hangs += 1
            return None
        self._act()
        if js == ns['BREAK_SHOW_JS']:
            self.layer = a[0]
            self.layers.append(a[0])
            return True
        if js == ns['BREAK_ARM_JS']:
            self.armed, self.flag, self.layer = a[0][0], a[0][0], None
            return True
        if js == ns['BREAK_HIDE_JS']:
            self.layer, self.armed, self.flag = None, None, None
            return True
        if js == ns['AT_FOOT_JS']: return self.foot
        if js == ns['NEXT_STATE_JS']: return 'on' if self.pg < self.pages else 'off'
        if js == ns['CURRENT_PAGE_JS']: return self.pg
        if js == ns['RESULT_LINKS_JS']: return [str(self.pg)]
        if js == ns['BRIDGE_RESULTS_JS']:
            # Reading a page takes a moment (slow_read): the person may click meanwhile.
            clock.t += self.slow_read
            return self.people()
        return None
chimes = []
ns['_chime'] = lambda name: chimes.append([name, round(clock.t - NOW, 1)])
saved = []
def by_hand(page, max_pages=100, total=None):
    reach = {'last': 0, 'more': False, 'urn': URN, 'found': 0, 'limited': False, 'pushed_back': False}
    people, status, reach = ns['_read_by_hand'](page, 'Invented Bridge', 'https://www.linkedin.com/in/invented-bridge/',
                                                'invented-bridge', 1, max_pages, reach,
                                                lambda c, last, more, urn: saved.append(len(c)), total)
    return people, status, reach
def report(page, people, status):
    out.update({'status': status, 'loads': page.loads, 'blocked': page.blocked, 'held': page.held,
                'layers': page.layers, 'layer_left': page.layer, 'routes_left': len(page.routes), 'routed': page.routed,
                'chimes': chimes, 'people': len(people), 'marked': sum(1 for p in people if 'mutualOnly' in p),
                'hangs': page.hangs, 'raised': page.raised, 'inits': len(page.inits),
                'armed_left': page.armed, 'flag_left': page.flag})
`;

const ticks = (chimes) => chimes.filter(([n]) => n === 'tick').map(([, at]) => at);

// ── the break ─────────────────────────────────────────────────────────────────

test('after page 10, a break as long as the speed says (Slow, 30 seconds): the next page is held, a tick each second, then Next works again', (t) => {
  const r = scanner(t, `${HAND}
page = HandPage(12)
people, status, reach = by_hand(page, total=120)
report(page, people, status)`, { limits: { pace: 'slow' } });
  if (!r) return;
  const { out, log } = r;
  assert.equal(out.status, 'success');
  // Page 10 is read 2.4 s after it shows (1 s to its foot, the next look); page 11 not before the break is over.
  const at = Object.fromEntries(out.loads.map(([pg, s]) => [pg, s]));
  const read10 = at[10] + 1.2;
  const tickTimes = ticks(out.chimes);
  assert.equal(tickTimes.length, 30, 'one tick a second, thirty of them');
  tickTimes.forEach((s, i) => assert.ok(Math.abs(s - (tickTimes[0] + i)) < 0.05, `tick ${i + 1} a second after the last (${s})`));
  assert.ok(tickTimes[0] >= at[10] && tickTimes[0] <= read10 + 0.5, 'the break starts as page 10 is read');
  assert.ok(at[11] - tickTimes[0] >= 30, `page 11 waits the whole break (${at[11] - tickTimes[0]} s)`);
  // Every other page went as fast as the person clicked: no break before page 10 or after it.
  for (let pg = 3; pg <= 10; pg++) assert.ok(at[pg] - at[pg - 1] < 4, `page ${pg} came at once`);
  assert.ok(at[12] - at[11] < 4, 'page 12 came at once');
  // The clicks during the break landed on the layer, every one of them.
  assert.ok(out.blocked.length >= 15, `the clicks during the break did nothing (${out.blocked.length})`);
  for (const s of out.blocked) assert.ok(s >= tickTimes[0] && s <= tickTimes[0] + 30, `${s} is in the break, the layer still up`);
  // Page 10 was read under the layer, up from the click that opened it; then the layer
  // counted down, and everything was put back.
  assert.deepEqual(out.raised, [at[10]], 'the click on Next to page 10 put the layer up, before page 10 drew');
  const before = out.layers.filter((l) => !l.startsWith('Break:'));
  assert.ok(before.length >= 1 && before.every((l) => l === 'Page 10: scroll to its bottom. Then a 30-second break.'), before.join(' | '));
  assert.deepEqual(out.layers.slice(before.length), Array.from({ length: 30 }, (_, i) => `Break: ${30 - i} s, then page 11`));
  assert.equal(out.layer_left, null, 'the layer is gone');
  assert.equal(out.armed_left, null, 'the armed click is gone');
  assert.equal(out.flag_left, null, 'and the flag');
  assert.equal(out.inits, 1, 'the init script is added once');
  assert.equal(out.routed, 1, 'routed once, for the one break');
  assert.equal(out.routes_left, 0, 'and unrouted');
  assert.deepEqual(out.held, [], 'nothing reached the network during the break');
  assert.equal(out.hangs, 0);
  // The chimes otherwise as ever: a read chime each page, the flourish at the end, no tap during the break.
  assert.deepEqual(out.chimes.filter(([n]) => n !== 'tick').map(([n]) => n).slice(-3), ['read-8', 'next', 'done']);
  assert.equal(out.chimes.filter(([n, s]) => n === 'next' && s >= tickTimes[0] && s < tickTimes[0] + 30).length, 0);

  // What it says: the status line, the instruction to wait, a countdown line a second, then on.
  assert.match(log, /^ {2}10 pages read: a 30-second break before page 11\. Pages read seconds apart are what LinkedIn notices\.$/m);
  assert.match(log, /^LinkedIn needs you: page 10 is read \(10 people\)\. Break: wait 30 seconds, then go on to page 11\. The page is held until the countdown ends\. Close the window when you're done with Invented Bridge\.$/m);
  const countdown = log.split('\n').filter((l) => /^ {2}\(break after page/.test(l));
  assert.deepEqual(countdown, Array.from({ length: 30 }, (_, i) => `  (break after page 10: ${30 - i} s, then page 11)`));
  const lines = log.split('\n');
  const last = lines.findIndex((l) => l === '  (break after page 10: 1 s, then page 11)');
  assert.match(lines[last + 1], /^LinkedIn needs you: page 10 is read \(10 people\)\. Click Next, then scroll to the bottom of page 11\./);
  assert.equal((log.match(/Break: wait/g) || []).length, 1, 'one break in 12 pages');
});

test('a page asked for another way during the break (the address bar) waits, and loads when the break ends', (t) => {
  const r = scanner(t, `${HAND}
page = HandPage(12, address_at=30)
people, status, reach = by_hand(page, total=120)
report(page, people, status)`, { limits: { pace: 'slow' } });
  if (!r) return;
  const { out, log } = r;
  const tickTimes = ticks(out.chimes);
  assert.equal(tickTimes.length, 30);
  assert.ok(30 > tickTimes[0] && 30 < tickTimes[0] + 30, 'the address is typed during the break');
  assert.equal(out.held.length, 1, 'held by the route, not loaded');
  assert.ok(out.held[0] >= 30 && out.held[0] < 31, `as it was typed (${out.held[0]})`);
  const at11 = out.loads.find(([pg]) => pg === 11)[1];
  assert.ok(at11 >= tickTimes[0] + 29.9, `it loads as the break ends (${at11})`);
  assert.match(log, /^ {2}The page asked for during the break loads now\.$/m);
  assert.equal(out.routes_left, 0);
  // Nothing is evaluated on a page while its navigation is held (it would never answer):
  // the layer stops being written, and the new page replaces it.
  assert.equal(out.hangs, 0);
  assert.ok(out.layers.length < 30, `the layer was written until the page was held (${out.layers.length})`);
  assert.equal(ticks(out.chimes).length, 30, 'the countdown and the ticks go on all the same');
});

test('Scanner settings set the breaks: every 3 pages, for 10 seconds at Medium here, read at each break', (t) => {
  const r = scanner(t, `${HAND}
page = HandPage(10)
people, status, reach = by_hand(page, total=100)
report(page, people, status)`, { limits: { daily: 50, manual: true, breakEvery: 3, pace: 'medium' } });
  if (!r) return;
  const { out, log } = r;
  assert.equal(ticks(out.chimes).length, 30, 'three breaks of ten ticks');
  assert.deepEqual(log.match(/Break: wait \d+ seconds, then go on to page \d+/g),
    ['Break: wait 10 seconds, then go on to page 4', 'Break: wait 10 seconds, then go on to page 7', 'Break: wait 10 seconds, then go on to page 10']);
  assert.match(log, /^ {2}3 pages read: a 10-second break before page 4\./m);
  assert.equal(out.routed, 3);
  assert.equal(out.routes_left, 0);
});

test('a break of 1 page says "1 page", and no break comes after the last page of a list', (t) => {
  const r = scanner(t, `${HAND}
page = HandPage(3)
people, status, reach = by_hand(page, total=30)
report(page, people, status)`, { limits: { breakEvery: 1 } });
  if (!r) return;
  assert.match(r.log, /^ {2}1 page read: a 10-second break before page 2\./m);
  assert.equal((r.log.match(/Break: wait/g) || []).length, 2, 'after pages 1 and 2, not after 3, the end');
});

test('Stop during a break ends it at once and puts everything back', (t) => {
  const r = scanner(t, `${HAND}
page = HandPage(12)
def chime(name):
    chimes.append([name, round(clock.t - NOW, 1)])
    if sum(1 for c in chimes if c[0] == 'tick') == 5:
        ns['_stop_requested'] = True
ns['_chime'] = chime
people, status, reach = by_hand(page, total=120)
report(page, people, status)`);
  if (!r) return;
  assert.equal(r.out.status, 'stopped');
  assert.equal(ticks(r.out.chimes).length, 5);
  assert.equal(r.out.layer_left, null);
  assert.equal(r.out.routes_left, 0);
  assert.ok(!r.out.loads.some(([pg]) => pg === 11), 'page 11 never opened');
});

test('a window closed during a break ends it, with nothing left to take off the page', (t) => {
  const r = scanner(t, `${HAND}
page = HandPage(12)
def chime(name):
    chimes.append([name, round(clock.t - NOW, 1)])
    if sum(1 for c in chimes if c[0] == 'tick') == 3:
        page.closed = True
ns['_chime'] = chime
people, status, reach = by_hand(page, total=120)
report(page, people, status)`);
  if (!r) return;
  assert.equal(r.out.status, 'success');
  assert.equal(ticks(r.out.chimes).length, 3);
  assert.equal(r.out.routes_left, 0);
  assert.match(r.log, /The window was closed: done with Invented Bridge, and what was read is kept\./);
});

test('a page that can\'t route (an older stand-in, say) still gets the layer and the countdown', (t) => {
  const r = scanner(t, `${HAND}
page = HandPage(11)
def no_route(*a, **k):
    raise RuntimeError('no routing here')
page.route = no_route
people, status, reach = by_hand(page, total=110)
report(page, people, status)`, { limits: { pace: 'slow' } });
  if (!r) return;
  assert.equal(ticks(r.out.chimes).length, 30);
  assert.equal(r.out.layers.filter((l) => l.startsWith('Break:')).length, 30);
  assert.ok(r.out.blocked.length >= 15);
});

// ── no lag: armed ahead of the page that starts the break ─────────────────────
// Blake, 2026-10-16: "the screen needs to actually lock the user and not let them proceed
// to clicking next when it's supposed to be cooldown. There is some lag when it hits the
// page and processing to lock the screen."

test('a person who clicks Next the moment they reach the foot, while the page is still being read, never gets page 11 before the break ends', (t) => {
  // Reading a page takes 0.3 s here, and they click Next 0.1 s after its foot shows.
  const r = scanner(t, `${HAND}
page = HandPage(12, quick=0.1, slow_read=0.3)
people, status, reach = by_hand(page, total=120)
report(page, people, status)`, { limits: { pace: 'slow' } });
  if (!r) return;
  const { out, log } = r;
  assert.equal(out.status, 'success');
  const at = Object.fromEntries(out.loads.map(([pg, s]) => [pg, s]));
  const tickTimes = ticks(out.chimes);
  assert.equal(tickTimes.length, 30);
  // Page 10 was read, every page in turn, and page 11 waited the whole break.
  assert.match(log, /^ {2}Page 10\.\.\. 10 found \(total: 100\)$/m);
  assert.ok(at[11] - tickTimes[0] >= 30, `page 11 waits the whole break (${at[11] - tickTimes[0]} s)`);
  // Their click while page 10 was read landed on the layer, which was up from the click that opened it.
  assert.deepEqual(out.raised, [at[10]]);
  assert.ok(out.blocked.some((s) => s >= at[10] && s <= tickTimes[0]), `the click made as page 10 was read was taken (${out.blocked}, countdown at ${tickTimes[0]})`);
  assert.deepEqual(out.held, [], 'nothing even reached the network');
  assert.equal(out.routed, 1);
  assert.equal(out.routes_left, 0);
  assert.equal(out.layer_left, null);
});

test('a whole new page while the break is armed (the address bar instead of Next) has the layer from its first paint', (t) => {
  const r = scanner(t, `${HAND}
page = HandPage(12, address_after=9)
people, status, reach = by_hand(page, total=120)
report(page, people, status)`, { limits: { pace: 'slow' } });
  if (!r) return;
  const { out } = r;
  const at = Object.fromEntries(out.loads.map(([pg, s]) => [pg, s]));
  const tickTimes = ticks(out.chimes);
  assert.equal(out.inits, 1);
  assert.deepEqual(out.raised, [at[10]], 'up as page 10 loaded, from the init script');
  assert.ok(at[11] - tickTimes[0] >= 30);
  assert.equal(out.flag_left, null, 'the flag is taken away with the break');
  assert.equal(out.hangs, 0);
});

test('a break after every page is armed from the start: the first page is read under the layer', (t) => {
  const r = scanner(t, `${HAND}
page = HandPage(3)
people, status, reach = by_hand(page, total=30)
report(page, people, status)`, { limits: { breakEvery: 1 } });
  if (!r) return;
  const { out } = r;
  assert.equal(out.layers[0], 'Page 1: scroll to its bottom. Then a 10-second break.');
  assert.equal(out.routed, 3, 'armed for page 1, then again after each break');
  assert.equal(out.routes_left, 0, 'the last one, armed for a page that ended the list, taken away');
  assert.equal(out.layer_left, null);
  assert.equal(out.flag_left, null);
});

test('armed, a page already read (Previous) gets no layer, and a stop takes the armed hold away', (t) => {
  const r = scanner(t, `${HAND}
page = HandPage(12)
read = {'n': 0}
def chime(name):
    chimes.append([name, round(clock.t - NOW, 1)])
    if name.startswith('read-'):
        read['n'] += 1
        if read['n'] == 9:
            ns['_stop_requested'] = True   # Stop with page 9 read: the break for page 10 is armed
ns['_chime'] = chime
people, status, reach = by_hand(page, total=120)
report(page, people, status)`);
  if (!r) return;
  assert.equal(r.out.status, 'stopped');
  assert.equal(r.out.routed, 1, 'armed after page 9');
  assert.equal(r.out.routes_left, 0, 'and taken away on Stop');
  assert.equal(r.out.flag_left, null);
  assert.equal(r.out.armed_left, null);
});

test('Auto mode is unchanged: no breaks, no layer, no routes', (t) => {
  const r = scanner(t, `
ns['GENTLE']['on'] = False
ns['interruptible_sleep'] = lambda s, on_tick=None, step=5: True
calls = []
page = ResultsPage(pages=12)
real = page.evaluate
def evaluate(js, *a):
    if js in (ns['BREAK_SHOW_JS'], ns['BREAK_HIDE_JS']): calls.append('layer')
    return real(js, *a)
page.evaluate = evaluate
page.route = lambda *a, **k: calls.append('route')
urls, status, reach = read(page)
out.update({'status': status, 'read': sorted(reach['read']), 'calls': calls})`);
  if (!r) return;
  assert.equal(r.out.status, 'success');
  assert.equal(r.out.read.length, 12);
  assert.deepEqual(r.out.calls, []);
  assert.doesNotMatch(r.log, /break after page|Break: wait/);
});

// ── the settings ──────────────────────────────────────────────────────────────

test('the settings: 10 pages and 20 seconds unless changed, from 1 to 25 pages and 10 to 300 seconds, only a change written', () => {
  assert.deepEqual(BREAK_DEFAULTS, { breakEvery: 10, breakSeconds: 20 });
  assert.deepEqual(BREAK_EVERY_RANGE, { min: 1, max: 25 });
  assert.deepEqual(BREAK_SECONDS_RANGE, { min: 10, max: 300 });
  assert.equal(DEFAULT_LIMITS.breakEvery, 10);
  assert.equal(DEFAULT_LIMITS.breakSeconds, 20);
  for (const n of [1, 10, 25]) assert.equal(validBreakEvery(n), true, String(n));
  for (const n of [0, 26, 2.5, '10', true, null]) assert.equal(validBreakEvery(n), false, String(n));
  for (const n of [10, 20, 300]) assert.equal(validBreakSeconds(n), true, String(n));
  for (const n of [9, 301, 20.5, '20', null]) assert.equal(validBreakSeconds(n), false, String(n));

  const dir = scratch();
  try {
    const file = () => JSON.parse(readFileSync(path.join(dir, 'scan-limits.json'), 'utf8'));
    assert.equal(readLimits(dir).breakEvery, 10);
    assert.equal(readLimits(dir).breakSeconds, 20);
    writeLimits(dir, { daily: 30 });
    assert.equal('breakEvery' in file(), false);
    assert.equal('breakSeconds' in file(), false);
    writeLimits(dir, { breakEvery: 5, breakSeconds: 45 });
    assert.deepEqual([file().breakEvery, file().breakSeconds], [5, 45]);
    writeLimits(dir, { breakEvery: 0, breakSeconds: 9 });
    assert.deepEqual([readLimits(dir).breakEvery, readLimits(dir).breakSeconds], [5, 45], 'out of range keeps the saved ones');
    writeLimits(dir, { breakEvery: 26, breakSeconds: 301 });
    assert.deepEqual([readLimits(dir).breakEvery, readLimits(dir).breakSeconds], [5, 45]);
    writeLimits(dir, { daily: 40 });
    assert.deepEqual([file().breakEvery, file().breakSeconds], [5, 45], 'another setting saved keeps them');
    writeLimits(dir, { breakEvery: 10, breakSeconds: 20 });
    assert.equal('breakEvery' in file(), false, 'back to the defaults, nothing of them is written');
    writeFileSync(path.join(dir, 'scan-limits.json'), JSON.stringify({ breakEvery: '7', breakSeconds: 1000 }));
    assert.deepEqual([readLimits(dir).breakEvery, readLimits(dir).breakSeconds], [10, 20], 'a hand-edited file out of range reads as the defaults');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('the scanner reads the same keys with the same defaults and ranges, and the break by the speed', (t) => {
  const r = scanner(t, `
f = ns['_home']() / 'scan-limits.json'
out['consts'] = [ns['BREAK_EVERY'], ns['BREAK_SECONDS'], list(ns['BREAK_EVERY_RANGE']), list(ns['BREAK_SECONDS_RANGE']),
                 ns['BREAK_PACE_SECONDS'], ns['BREAK_PACE_DEFAULT']]
out['none'] = ns['manual_break']()
cases = {}
for name, data in [('set', {'breakEvery': 4, 'pace': 'slow'}), ('edges', {'breakEvery': 25, 'pace': 'fast'}),
                   ('medium', {'breakEvery': 1, 'pace': 'medium'}), ('low', {'breakEvery': 0, 'pace': 'turbo'}),
                   ('high', {'breakEvery': 26, 'pace': 'SLOW'}), ('kinds', {'breakEvery': True, 'pace': 5}),
                   ('text', {'breakEvery': '4', 'pace': None}), ('stored', {'breakSeconds': 90, 'pace': 'fast'})]:
    f.write_text(json.dumps(data))
    cases[name] = ns['manual_break']()
f.write_text('not json')
cases['broken'] = ns['manual_break']()
out['cases'] = cases`);
  if (!r) return;
  assert.deepEqual(r.out.consts, [BREAK_DEFAULTS.breakEvery, BREAK_DEFAULTS.breakSeconds,
    [BREAK_EVERY_RANGE.min, BREAK_EVERY_RANGE.max], [BREAK_SECONDS_RANGE.min, BREAK_SECONDS_RANGE.max],
    { ...BREAK_PACE_SECONDS }, BREAK_PACE_DEFAULT]);
  assert.deepEqual(r.out.none, [10, 10], 'no speed saved: Medium, 10 seconds');
  assert.deepEqual(r.out.cases, {
    set: [4, 30], edges: [25, 5], medium: [1, 10], low: [10, 10], high: [10, 10], kinds: [10, 10], text: [10, 10],
    // The stored length is kept for an adjuster to come; for now the speed decides.
    stored: [10, 5], broken: [10, 10],
  });
});

test('the break by the speed: 30 seconds Slow, 10 Medium (the default), 5 Fast', () => {
  assert.deepEqual(BREAK_PACE_SECONDS, { slow: 30, medium: 10, fast: 5 });
  assert.equal(BREAK_PACE_DEFAULT, 'medium');
  assert.deepEqual(['slow', 'medium', 'fast'].map(breakSecondsFor), [30, 10, 5]);
  for (const p of [undefined, null, '', 'turbo', 'constructor', 5]) assert.equal(breakSecondsFor(p), 10, String(p));
  assert.deepEqual(Object.keys(BREAK_PACE_SECONDS).sort(), Object.keys(PACES).sort(), 'one length for each speed the Scan page has');
});

test('Scanner settings show the breaks under How circle scans run: how often saved through set-limits, how long by the speed', () => {
  const page = src('app/setup/page.js');
  assert.match(page, /\{shows\.manual && \(\s*<div style=\{\{ \.\.\.rowStyle, marginTop: 12 \}\}>\s*<ManualBreaksSetting limits=\{li\?\.limits\} disabled=\{busy\} onSave=\{\(change\) => run\('set-limits', change\)\} \/>/);
  const box = src('app/components/ManualBreaksSetting.js');
  assert.match(box, /type="range" min=\{BREAK_EVERY_RANGE\.min\} max=\{BREAK_EVERY_RANGE\.max\}/);
  // The length's slider is hidden until an adjuster comes; the length follows the speed.
  assert.doesNotMatch(box, /BREAK_SECONDS_RANGE\.min|handlers\('breakSeconds'\)/);
  assert.match(box, /breakSecondsFor\(limits\?\.pace\)/);
  assert.match(box, /\{BREAK_PACE_TEXT\}/);
  assert.equal(BREAK_PACE_TEXT, 'How long follows the scan speed: 30 seconds at Slow, 10 at Medium, 5 at Fast.');
  assert.match(box, /\{BREAK_WHY\}/);
  assert.equal(BREAK_WHY, 'Pages read seconds apart are what LinkedIn notices.');
  assert.equal(breakText(), 'A 10-second break after every 10 pages');
  assert.equal(breakText(10, breakSecondsFor('fast')), 'A 5-second break after every 10 pages');
  assert.equal(breakText(10, breakSecondsFor('slow')), 'A 30-second break after every 10 pages');
  assert.equal(breakText(1, 120), 'A 2-minute break after every page');
  assert.equal(breakText(5, 90), 'A 90-second break after every 5 pages');
  const route = src('app/api/scraper/route.js');
  assert.match(route, /breakEvery: body\.breakEvery, breakSeconds: body\.breakSeconds,/);
  assert.doesNotMatch(box, /scraping|\u2014/i);
});

// ── the tick ──────────────────────────────────────────────────────────────────

test('the tick is a chime like the others: short, quieter, written with them, and played at their volume', (t) => {
  assert.ok(CHIME_NAMES.includes('tick'));
  const tick = chimeSamples('tick');
  assert.ok(tick.length / SAMPLE_RATE < 0.1, 'shorter than the Next tap');
  const peak = (n) => Math.max(...chimeSamples(n).map(Math.abs));
  assert.ok(peak('tick') < peak('next'), 'quieter than the tap');
  const home = scratch();
  try {
    ensureChimes(home);
    assert.ok(existsSync(path.join(home, 'sounds', 'tick.wav')));
    const r = scanner(t, `
import subprocess
played = []
subprocess.Popen = lambda args, **kw: played.append(args)
real = ns['sys']
ns['sys'] = types.SimpleNamespace(platform='darwin')
(ns['_home']() / 'scan-limits.json').write_text(json.dumps({'chimeVolume': 0.4}))
out['on'] = ns['_chime']('tick')
(ns['_home']() / 'scan-limits.json').write_text(json.dumps({'chimes': False}))
out['off'] = ns['_chime']('tick')
(ns['_home']() / 'scan-limits.json').write_text(json.dumps({'chimeVolume': 0}))
out['silent'] = ns['_chime']('tick')
ns['sys'] = real
out['played'] = [[a[0], a[2], a[3].endswith('sounds/tick.wav')] for a in played]`, { home });
    if (!r) return;
    assert.deepEqual(r.out, { on: true, off: false, silent: false, played: [['afplay', '0.40', true]] });
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

// ── the scan light ────────────────────────────────────────────────────────────

test('the scan light shows the break as yellow, counting down, then green for Next', (t) => {
  const r = scanner(t, `${HAND}
page = HandPage(12)
by_hand(page, total=120)`, { limits: { pace: 'slow' } });
  if (!r) return;
  const lines = r.log.split('\n');
  const job = (upTo) => ({ running: true, action: 'bridge', target: { name: 'Invented Bridge' }, mode: 'manual', log: lines.slice(0, upTo), pages: 10, found: [] });
  const at = (re) => lines.findIndex((l) => re.test(l)) + 1;

  const start = scanLight(job(at(/Break: wait 30 seconds/)));
  assert.equal(start.color, 'yellow');
  assert.equal(start.headline, 'Break: 30 s, then page 11');
  assert.equal(start.stats.page, 10);
  assert.equal(lightLabel(start), 'Yellow, scanning: Break: 30 s, then page 11');

  const mid = scanLight(job(at(/^ {2}\(break after page 10: 14 s, then page 11\)$/)));
  assert.equal(mid.mode, 'manual');
  assert.equal(mid.color, 'yellow');
  assert.equal(mid.headline, 'Break: 14 s, then page 11');
  assert.equal(mid.stats.page, 10);
  assert.equal(mid.detail, 'Break after page 10: 14 s, then page 11');

  const last = scanLight(job(at(/^ {2}\(break after page 10: 1 s, then page 11\)$/)));
  assert.equal(last.headline, 'Break: 1 s, then page 11');

  const over = scanLight(job(at(/^ {2}\(break after page 10: 1 s, then page 11\)$/) + 1));
  assert.equal(over.color, 'green');
  assert.equal(over.headline, 'Click Next to page 11');

  // A log holding only the break's instruction is a run by hand.
  assert.equal(isManualRun({ log: [lines[at(/Break: wait 30 seconds/) - 1]] }), true);
});

test('the app keeps only the newest countdown line, so a long break never pushes the log out', (t) => {
  const route = src('app/api/scraper/route.js');
  const re = new Function(`return ${route.match(/const BREAK_TICK = (\/.+\/);/)[1]}`)();
  assert.match(route, /if \(BREAK_TICK\.test\(t\) && BREAK_TICK\.test\(state\.log\[state\.log\.length - 1\] \|\| ''\)\) \{\s*state\.log\[state\.log\.length - 1\] = t;\s*continue;/);
  const r = scanner(t, `${HAND}
page = HandPage(11)
by_hand(page, total=110)`, { limits: { pace: 'slow' } });
  if (!r) return;
  // The route's push(), as it treats the lines: a countdown line after a countdown line replaces it.
  const log = [];
  for (const line of r.log.split('\n')) {
    if (re.test(line) && re.test(log[log.length - 1] || '')) log[log.length - 1] = line;
    else log.push(line);
  }
  assert.equal(r.log.split('\n').filter((l) => re.test(l)).length, 30, 'the scanner says every second');
  assert.equal(log.filter((l) => re.test(l)).length, 1, 'the app keeps one');
  assert.equal(log.filter((l) => re.test(l))[0], '  (break after page 10: 1 s, then page 11)');
  assert.equal(r.log.split('\n').filter((l) => re.test(l) === false && /break after page/.test(l)).length, 0, 'every countdown line is one the app knows');
});

// ── the found count ───────────────────────────────────────────────────────────

test('a page of 10 people with 14 names in their mutual lines: 10 found, and all 24 still saved', (t) => {
  const r = scanner(t, `${HAND}
page = HandPage(2, mutuals=14)
people, status, reach = by_hand(page, total=20)
report(page, people, status)
out['found'] = reach['found']`);
  if (!r) return;
  assert.match(r.log, /^ {2}Page 1\.\.\. 10 found \(total: 10\)$/m);
  assert.match(r.log, /^ {2}Page 2\.\.\. 10 found \(total: 20\)$/m);
  assert.match(r.log, /^LinkedIn needs you: page 1 is read \(10 people\)\. Click Next/m);
  assert.equal(r.out.found, 20);
  assert.equal(r.out.people, 34, '20 people and the 14 mutuals, each once');
  assert.equal(r.out.marked, 0, 'the mark never reaches the app');
});

test('an automatic read counts the same way', (t) => {
  const r = scanner(t, `
ns['GENTLE']['on'] = False
ns['interruptible_sleep'] = lambda s, on_tick=None, step=5: True
page = ResultsPage(pages=2)
real = page.people
page.people = lambda: real() + [dict(person(9000 + i), mutualOnly=True) for i in range(5)]
urls, status, reach = read(page)
out.update({'found': reach['found'], 'saved': len(urls)})`);
  if (!r) return;
  assert.match(r.log, /^ {2}Page 1\.\.\. 10 found \(total: 10\)$/m);
  assert.equal(r.out.found, 20);
  assert.equal(r.out.saved, 25);
});

// The page reader itself, as Python sends it, on a stand-in results page (as
// tests/scraper-mutuals.test.mjs builds one): cards, and the links in their mutual lines.
function reader(t) {
  if (noScanner(t)) return null;
  const run = spawnSync(PYTHON, ['-c', `
import ast, json, sys
tree = ast.parse(open(sys.argv[1]).read())
for node in ast.walk(tree):
    if isinstance(node, ast.Assign) and any(isinstance(t, ast.Name) and t.id == 'BRIDGE_RESULTS_JS' for t in node.targets):
        print(json.dumps(node.value.value))
`, SCRAPER], { encoding: 'utf8' });
  if (noPython(t, run)) return null;
  assert.equal(run.status, 0, run.stderr);
  return JSON.parse(run.stdout);
}

function resultsPage(results, { flat = false } = {}) {
  const lines = [];
  const anchors = [];
  const link = (slug, name, parent) => ({ getAttribute: () => `/in/${slug}`, closest: () => null, querySelector: () => null, innerText: name, parentElement: parent });
  for (const r of results) {
    const card = { innerText: [r.name, '• 1st', r.headline, 'Lisbon, Portugal', ...[r.mutual].flat(), 'Message'].filter(Boolean).join('\n') };
    card.parentElement = { innerText: card.innerText, parentElement: null };
    anchors.push(link(r.slug, r.name, card));
    for (const v of [r.via].flat().filter(Boolean)) anchors.push(link(v.slug, v.name, card));
    lines.push(...(flat ? [r.headline] : card.innerText.split('\n')));
  }
  const root = { innerText: lines.join('\n'), querySelectorAll: () => anchors };
  return { querySelector: () => root, body: root };
}

test('the page reader marks the names in mutual lines, and only them', (t) => {
  const js = reader(t);
  if (!js) return;
  const run = (doc) => vm.runInNewContext(`(${js})()`, { document: doc });
  const maya = { slug: 'maya-chen', name: 'Maya Chen' };
  const leo = { slug: 'leo-park', name: 'Leo Park' };
  const got = run(resultsPage([
    { slug: 'ada-stone', name: 'Ada Stone', headline: 'VP Sales at Northwind Labs', mutual: 'Maya Chen and 23 other mutual connections', via: maya },
    { slug: 'ben-ortiz', name: 'Ben Ortiz', headline: 'Designer at Halcyon', mutual: ['Maya Chen', 'Leo Park', '& 8 other mutual connections'], via: [maya, leo] },
    { slug: 'member-1', name: 'LinkedIn Member', headline: 'Engineer' },
    { slug: 'member-2', name: 'LinkedIn Member', headline: 'Analyst' },
  ]));
  const marked = Object.fromEntries(got.map((p) => [p.profileUrl.split('/in/')[1].replace(/\/$/, ''), p.mutualOnly === true]));
  assert.deepEqual(marked, { 'ada-stone': false, 'maya-chen': true, 'ben-ortiz': false, 'leo-park': true, 'member-1': false, 'member-2': false });
  assert.equal(got.find((p) => p.profileUrl.includes('ada-stone')).mutualCount, 24, 'the counts are read as before');
  assert.equal(got.find((p) => p.profileUrl.includes('ben-ortiz')).mutualCount, 10);
  assert.ok(got.every((p) => !('listed' in p)), 'the reader\'s own note stays inside it');

  // A page whose cards can't be made out marks no one: the count falls back to everyone, as before.
  const blind = run(resultsPage([
    { slug: 'ada-stone', name: 'Ada Stone', headline: 'VP Sales at Northwind Labs', via: maya },
  ], { flat: true }));
  assert.equal(blind.length, 2);
  assert.ok(blind.every((p) => !('mutualOnly' in p)));
});

// ── the panel's wording ───────────────────────────────────────────────────────

test('driving Sixgree\'s own panel, the opening line says the LinkedIn panel, not the Chrome window', (t) => {
  const r = scanner(t, `${HAND}
ns['PANEL']['on'] = True
page = HandPage(1)
by_hand(page, total=10)
ns['PANEL']['on'] = False
chimes.clear()
by_hand(HandPage(1), total=10)`);
  if (!r) return;
  assert.match(r.log, /^LinkedIn needs you: scroll to the bottom of each page of Invented Bridge's connections in the LinkedIn panel, then click Next\./m);
  assert.match(r.log, /^LinkedIn needs you: scroll to the bottom of each page of Invented Bridge's connections in the Chrome window, then click Next\./m);
});

// ── it ships ──────────────────────────────────────────────────────────────────

test('the scanner change ships in the plugins at 1.0.8 (the break armed ahead of its page)', () => {
  assert.equal(SHIPPED_PLUGIN_VERSION, '1.0.8');
});

test('the layer and the hold, as the scanner sends them', (t) => {
  const r = scanner(t, `
s = ns['_search_load']
out['urls'] = {
  'next': s('https://www.linkedin.com/voyager/api/graphql?queryId=voyagerSearchDashClusters.abc&variables=(start:10)'),
  'page': s('https://www.linkedin.com/search/results/people/?network=%5B%22F%22%5D&page=21'),
  'feed': s('https://www.linkedin.com/voyager/api/feed/updates'),
  'image': s('https://media.licdn.com/dms/image/search.jpg'),
  'other': s('https://example.com/search/results/people/'),
  'lookalike': s('https://linkedin.com.example.com/search/results/people/'),
}
out['show'] = ns['BREAK_SHOW_JS']
out['hide'] = ns['BREAK_HIDE_JS']`);
  if (!r) return;
  assert.deepEqual(r.out.urls, { next: true, page: true, feed: false, image: false, other: false, lookalike: false });
  // The layer, run against a stand-in page: it takes clicks and Enter, shows the text, and takes itself away.
  const listeners = [];
  const made = [];
  const timers = [];
  const el = () => {
    const e = { style: {}, children: [], attrs: {}, listeners: {}, removed: false };
    e.setAttribute = (k, v) => { e.attrs[k] = v; };
    e.appendChild = (c) => { e.children.push(c); if (!e.firstChild) e.firstChild = c; };
    e.addEventListener = (t2, fn) => { e.listeners[t2] = fn; };
    e.remove = () => { e.removed = true; byId = null; };
    return e;
  };
  let byId = null;
  const document = {
    getElementById: () => byId,
    createElement: () => { const e = el(); made.push(e); return e; },
    documentElement: { appendChild: (e) => { byId = e; } },
    activeElement: null,
    body: {},
  };
  const window = { addEventListener: (t2, fn) => listeners.push([t2, fn]), removeEventListener: (t2, fn) => { const i = listeners.findIndex(([a, b]) => a === t2 && b === fn); if (i >= 0) listeners.splice(i, 1); } };
  const ctx = { document, window, setTimeout: (fn, ms) => { timers.push([fn, ms]); return timers.length; }, clearTimeout: () => {} };
  vm.runInNewContext(`(${r.out.show})('Break: 14 s, then page 21')`, ctx);
  const layer = made[0];
  assert.equal(layer.firstChild.textContent, 'Break: 14 s, then page 21');
  assert.match(layer.style.cssText, /position:fixed;inset:0;z-index:2147483647/);
  for (const ev of ['click', 'mousedown', 'pointerdown', 'touchstart']) assert.equal(typeof layer.listeners[ev], 'function', ev);
  let stopped = 0;
  const event = (key) => ({ key, preventDefault: () => { stopped += 1; }, stopImmediatePropagation: () => {} });
  layer.listeners.click(event());
  listeners[0][1](event('Enter'));
  listeners[0][1](event('ArrowDown'));
  assert.equal(stopped, 2, 'a click and Enter are taken; the arrow keys still scroll');
  vm.runInNewContext(`(${r.out.show})('Break: 13 s, then page 21')`, ctx);
  assert.equal(made.length, 2, 'the same layer, its text written again');
  assert.equal(layer.firstChild.textContent, 'Break: 13 s, then page 21');
  assert.equal(timers.at(-1)[1], 5000, 'it takes itself away 5 s after its last update');
  timers.at(-1)[0]();
  assert.equal(layer.removed, true);
  assert.equal(listeners.length, 0, 'and its key listener with it');
  vm.runInNewContext(`(${r.out.show})('Break: 2 s, then page 21')`, ctx);
  vm.runInNewContext(`(${r.out.hide})()`, ctx);
  assert.equal(made[2].removed, true);
  assert.equal(listeners.length, 0);
});

test('armed: a click on Next, Previous or a page number puts the layer up in the same click; a whole new page gets it from its first paint, only with this scanner\'s flag', (t) => {
  const r = scanner(t, `
out['arm'] = ns['BREAK_ARM_JS']
out['init'] = ns['BREAK_INIT_JS']
out['hide'] = ns['BREAK_HIDE_JS']
out['token'] = ns['BREAK_TOKEN']
out['texts'] = [ns['_break_arm_text'](30), ns['_break_page_text'](10, 30)]`);
  if (!r) return;
  assert.deepEqual(r.out.texts, ['Scroll to the bottom of this page. Then a 30-second break.', 'Page 10: scroll to its bottom. Then a 30-second break.']);
  assert.match(r.out.token, /^[0-9a-f]{12}$/);
  assert.ok(r.out.init.includes(`'${r.out.token}'`), 'the init script knows this run\'s token');
  // A stand-in page: a search page with Next, a page number, and a person's link.
  const page = () => {
    const listeners = [];
    const store = new Map();
    let layer = null;
    const node = (tag, words, extra = {}) => ({
      tagName: tag, innerText: words, textContent: words, getAttribute: (k) => extra[k] ?? null,
      closest(sel) { return sel.includes(tag.toLowerCase()) || (sel.includes('main') && extra.inMain) ? this : null; },
    });
    const el = () => {
      const e = { style: {}, children: [], attrs: {}, listeners: {} };
      e.setAttribute = (k, v) => { e.attrs[k] = v; };
      e.appendChild = (c) => { e.children.push(c); if (!e.firstChild) e.firstChild = c; };
      e.addEventListener = (k, fn) => { e.listeners[k] = fn; };
      e.contains = (x) => x === e;
      e.remove = () => { layer = null; };
      return e;
    };
    const root = { appendChild: (e) => { layer = e; } };
    const ctx = {
      document: { getElementById: () => layer, createElement: el, documentElement: root, activeElement: null, body: {} },
      window: {
        addEventListener: (k, fn) => listeners.push([k, fn]),
        removeEventListener: (k, fn) => { const i = listeners.findIndex(([a, b]) => a === k && b === fn); if (i >= 0) listeners.splice(i, 1); },
      },
      sessionStorage: { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) },
      location: { pathname: '/search/results/people/' },
      setTimeout: () => 1, clearTimeout: () => {}, getComputedStyle: () => ({ overflowY: 'visible' }),
      MutationObserver: class { observe() {} disconnect() {} },
    };
    const click = (target) => { for (const [k, fn] of [...listeners]) if (k === 'click') fn({ target }); };
    return { ctx, click, node, store, layer: () => layer, listeners };
  };
  const p = page();
  vm.runInNewContext(`(${r.out.arm})(['Scroll to the bottom of this page. Then a 30-second break.', '${r.out.token}'])`, p.ctx);
  assert.equal(p.layer(), null, 'armed: no layer yet, Next still works');
  assert.ok(p.store.get('sixgree-break'), 'the flag is set');
  p.click(p.node('A', 'Invented Person'));
  assert.equal(p.layer(), null, 'a click on someone\'s name is not a page of the list');
  p.click(p.node('BUTTON', 'Next'));
  assert.equal(p.layer()?.firstChild.textContent, 'Scroll to the bottom of this page. Then a 30-second break.', 'Next: the layer, in the same click');
  // Armed again on a page that doesn't start the break: the layer a click put up comes off, the click stays armed.
  vm.runInNewContext(`(${r.out.arm})(['Scroll to the bottom of this page. Then a 30-second break.', '${r.out.token}'])`, p.ctx);
  assert.equal(p.layer(), null);
  p.click(p.node('BUTTON', '11', { inMain: true }));
  assert.ok(p.layer(), 'a page number in the list');
  vm.runInNewContext(`(${r.out.hide})()`, p.ctx);
  assert.equal(p.layer(), null);
  assert.equal(p.store.has('sixgree-break'), false, 'the flag is taken away');
  assert.equal(p.listeners.filter(([k]) => k === 'click').length, 0, 'and the armed click');
  p.click(p.node('BUTTON', 'Next'));
  assert.equal(p.layer(), null, 'disarmed, Next is Next');

  // A whole new page: the init script covers it with the flag set by this run, and only then.
  const fresh = (flag, pathname = '/search/results/people/') => {
    const q = page();
    q.ctx.location.pathname = pathname;
    if (flag) q.store.set('sixgree-break', JSON.stringify(flag));
    vm.runInNewContext(r.out.init, q.ctx);
    return q.layer();
  };
  assert.equal(fresh({ text: 'Scroll to the bottom of this page. Then a 30-second break.', token: r.out.token })?.firstChild.textContent,
    'Scroll to the bottom of this page. Then a 30-second break.');
  assert.equal(fresh(null), null, 'no flag, no layer');
  assert.equal(fresh({ text: 'x', token: '000000000000' }), null, 'a flag left by another run is not this one\'s');
  assert.equal(fresh({ text: 'x', token: r.out.token }, '/in/invented-person/'), null, 'only on a search page');
});
