// The scanner in Sixgree's own browser (scripts/scrape.py launch_chrome,
// attach_panel, PanelContext; lib/linkedin-panel.js). Blake,
// 2026-10-15: LinkedIn in a panel inside Sixgree's window, the scanner driving
// that panel instead of a Chrome of its own.
//
// These run the scanner's own functions against a stand-in browser of the
// shape Playwright gives for Electron: one context holding every page, the
// app's own among them, and that context's cookies being the app's, not the
// panel's. Nothing starts a browser or reaches LinkedIn or the app. The real
// Electron check is in docs/brain/SCRAPER.md "Sixgree's own browser".

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PYTHON, noPython } from './python.mjs';
import { SCRAPER, noScanner } from './helpers/scanner.mjs';
import { PANEL_FRONT, PANEL_AWAY, panelAsked } from '../lib/linkedin-panel.js';
import { needsYou } from '../lib/scan-progress.js';

const PANEL_ID = 'A1B2C3D4E5F60718293A4B5C6D7E8F90';
const APP_ID = '0F0E0D0C0B0A09080706050403020100';

const HARNESS = `
import ast, json, sys, types
from pathlib import Path
tree = ast.parse(open(sys.argv[1]).read())
skip = lambda n: (isinstance(n, ast.If)
                  or (isinstance(n, ast.Import) and any(a.name == 'requests' for a in n.names))
                  or (isinstance(n, ast.ImportFrom) and n.module == 'image_store'))
ns = {'__name__': 'scrape', '__file__': sys.argv[1]}
exec(compile(ast.Module(body=[n for n in tree.body if not skip(n)], type_ignores=[]), 'scrape.py', 'exec'), ns)
ns['time'] = types.SimpleNamespace(sleep=lambda s: None, time=lambda: 1790000000.0)
ns['screen_layout'] = lambda platform=None: []
def refuse(*a, **k):
    raise AssertionError('nothing here may reach the network')
ns['requests'] = types.SimpleNamespace(get=refuse, post=refuse)
env = ns['os'].environ
PANEL_ID, APP_ID = sys.argv[3], sys.argv[4]
sent = []      # every CDP command, as [method, page]
closed = []    # what was closed, as words

class Session:
    def __init__(self, page):
        self.page = page
    def send(self, method, params=None):
        sent.append([method, self.page.name])
        if method == 'Target.getTargetInfo':
            return {'targetInfo': {'targetId': self.page.tid, 'type': 'page'}}
        if method == 'Network.getCookies':
            return {'cookies': [dict(c, urls=params) for c in self.page.jar]}
        if method == 'Browser.getWindowForTarget':
            return {'windowId': 3}
        return {}
    def detach(self):
        pass

class Context:
    """Playwright's one context for every Electron page: its cookies are the app's session."""
    def __init__(self):
        self.pages = []
    def new_cdp_session(self, page):
        return Session(page)
    def cookies(self, *a, **k):
        return [{'name': 'app-session', 'value': 'the app page'}]
    def new_page(self):
        raise AssertionError('no new page is made in Electron')
    def close(self):
        closed.append('context')

class Page:
    def __init__(self, ctx, name, tid, url, jar=()):
        self.context, self.name, self.tid, self.url, self.jar = ctx, name, tid, url, list(jar)
        self.closed = False
        self.visits = []
        ctx.pages.append(self)
    def is_closed(self):
        return self.closed
    def close(self, *a, **k):
        closed.append('page ' + self.name)
    def goto(self, url, **_):
        self.visits.append(url)
        self.url = url
    def query_selector(self, _):
        return None
    def set_default_timeout(self, _):
        pass
    def set_default_navigation_timeout(self, _):
        pass

class Browser:
    def __init__(self, ctx):
        self.contexts = [ctx]
    def close(self):
        closed.append('disconnected')

class Chromium:
    def __init__(self, browser=None, error=None):
        self.browser, self.error, self.asked, self.launched = browser, error, [], []
    def connect_over_cdp(self, endpoint, timeout=None):
        self.asked.append(endpoint)
        if self.error:
            raise self.error
        return self.browser
    def launch_persistent_context(self, **opts):
        self.launched.append(opts.get('user_data_dir'))
        ctx = Context()
        Page(ctx, 'chrome', 'C' * 32, 'about:blank')
        return ctx

def electron(panel_url='about:blank', jar=()):
    """Electron as Playwright sees it: the app's page first, then the panel."""
    ctx = Context()
    app = Page(ctx, 'app', APP_ID, 'http://127.0.0.1:6400/queue')
    panel = Page(ctx, 'panel', PANEL_ID, panel_url, jar)
    return types.SimpleNamespace(browser=Browser(ctx), ctx=ctx, app=app, panel=panel)

def name_panel(port=1):
    env['SIX_DEGREES_PANEL_CDP'] = 'http://127.0.0.1:%d' % port
    env['SIX_DEGREES_PANEL_TARGET'] = PANEL_ID

out = {}
exec(sys.argv[2])
print('RESULT ' + json.dumps(out))
`;

function run(t, script) {
  if (noScanner(t)) return null;
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'six-degrees-panel-'));
  const env = { ...process.env, SIX_DEGREES_HOME: home };
  delete env.SIX_DEGREES_PANEL_CDP;
  delete env.SIX_DEGREES_PANEL_TARGET;
  const r = spawnSync(PYTHON, ['-c', HARNESS, SCRAPER, script, PANEL_ID, APP_ID], { encoding: 'utf8', env });
  fs.rmSync(home, { recursive: true, force: true });
  if (noPython(t, r)) return null;
  assert.equal(r.status, 0, r.stderr);
  const lines = r.stdout.trimEnd().split('\n');
  return { out: JSON.parse(lines.pop().replace(/^RESULT /, '')), log: lines.join('\n') };
}

test('the panel is named only by a 127.0.0.1 port and a target id; anything else is no panel', (t) => {
  const r = run(t, `
s = ns['panel_settings']
good = {'SIX_DEGREES_PANEL_CDP': 'http://127.0.0.1:51234', 'SIX_DEGREES_PANEL_TARGET': PANEL_ID}
out['good'] = s(good)
out['none'] = s({})
out['bad'] = [s(dict(good, SIX_DEGREES_PANEL_CDP=v)) for v in
              ['http://localhost:51234', 'http://192.168.1.4:51234', 'ws://127.0.0.1:51234', 'http://127.0.0.1:0', 'http://127.0.0.1:70000', 'http://127.0.0.1:5/x']]
out['bad_target'] = [s(dict(good, SIX_DEGREES_PANEL_TARGET=v)) for v in ['', 'page-1', '../json', 'A' * 80]]
`);
  if (!r) return;
  assert.deepEqual(r.out.good, { endpoint: 'http://127.0.0.1:51234', target: PANEL_ID });
  assert.equal(r.out.none, null);
  assert.deepEqual(r.out.bad, [null, null, null, null, null, null]);
  assert.deepEqual(r.out.bad_target, [null, null, null, null]);
});

test('launch_chrome takes the panel by its target id, never the app page, and starts no Chrome', (t) => {
  const r = run(t, `
e = electron()
name_panel()
chromium = Chromium(e.browser)
ctx = ns['launch_chrome'](types.SimpleNamespace(chromium=chromium))
out['asked'] = chromium.asked
out['launched'] = chromium.launched
out['embedded'] = getattr(ctx, 'embedded', False)
out['pages'] = [pg.name for pg in ctx.pages]
out['new_page_is_panel'] = ctx.new_page() is ctx.pages[0]
out['page_context_is_panel'] = ctx.pages[0].context is ctx
out['mode'] = ns['CHROME_WINDOW']['mode']
out['panel_on'] = ns['PANEL']['on']
out['where'] = ns['_where_linkedin']()
out['profile_made'] = (Path(env['SIX_DEGREES_HOME']) / 'chrome-profile').exists()
`);
  if (!r) return;
  assert.deepEqual(r.out.asked, ['http://127.0.0.1:1']);
  assert.deepEqual(r.out.launched, [], 'no Chrome started');
  assert.equal(r.out.embedded, true);
  assert.deepEqual(r.out.pages, ['panel'], 'only the panel, never the app page');
  assert.equal(r.out.new_page_is_panel, true, 'new_page() is the panel again: Electron pages are not made');
  assert.equal(r.out.page_context_is_panel, true, 'page.context is the panel’s, so its cookies are');
  assert.equal(r.out.mode, 'panel');
  assert.equal(r.out.panel_on, true);
  assert.equal(r.out.where, "in Sixgree's own browser");
  assert.equal(r.out.profile_made, false, 'Chrome’s profile is not touched');
  assert.match(r.log, /Using Sixgree's own browser/);
});

test('picking the panel: by the address the browser lists for it first, every page only when that finds none', (t) => {
  const r = run(t, `
e = electron(panel_url='https://www.linkedin.com/feed/')
settings = {'endpoint': 'http://127.0.0.1:1', 'target': PANEL_ID}
listed = lambda url: [{'id': APP_ID, 'url': e.app.url}, {'id': PANEL_ID, 'url': 'https://www.linkedin.com/feed/'}]
p = types.SimpleNamespace(chromium=Chromium(e.browser))
got = ns['attach_panel'](p, settings, fetch=listed)
out['picked'] = got.pages[0].name
out['asked_ids_of'] = [pg for m, pg in sent if m == 'Target.getTargetInfo']
del sent[:]
# The listed address differs from the page's (a redirect between): every page is asked.
moved = lambda url: [{'id': PANEL_ID, 'url': 'https://www.linkedin.com/login'}]
got = ns['attach_panel'](p, settings, fetch=moved)
out['picked_after_move'] = got.pages[0].name
del sent[:]
# Unreadable list: every page is asked, and still only the panel taken.
def broken(url):
    raise OSError('refused')
got = ns['attach_panel'](p, settings, fetch=broken)
out['picked_unlisted'] = got.pages[0].name
out['asked_unlisted'] = [pg for m, pg in sent if m == 'Target.getTargetInfo']
# No page with that id: no panel, and the connection is let go.
del closed[:]
try:
    ns['attach_panel'](p, {'endpoint': 'http://127.0.0.1:1', 'target': 'F' * 32}, fetch=broken)
    out['missing'] = 'attached'
except LookupError as exc:
    out['missing'] = str(exc)
out['closed_after_missing'] = list(closed)
`);
  if (!r) return;
  assert.equal(r.out.picked, 'panel');
  assert.deepEqual(r.out.asked_ids_of, ['panel'], 'the app page is not even asked its id when the list says where the panel is');
  assert.equal(r.out.picked_after_move, 'panel');
  assert.equal(r.out.picked_unlisted, 'panel');
  assert.deepEqual(r.out.asked_unlisted, ['app', 'panel']);
  assert.match(r.out.missing, /panel wasn't among its pages/);
  assert.deepEqual(r.out.closed_after_missing, ['disconnected']);
});

test('closing only disconnects: no page or context of Electron’s is closed, and the panel page refuses close()', (t) => {
  const r = run(t, `
e = electron()
name_panel()
ctx = ns['launch_chrome'](types.SimpleNamespace(chromium=Chromium(e.browser)))
page = ctx.pages[0]
page.close()
ctx.close()
ctx.close()
out['closed'] = list(closed)
out['pages_after'] = [pg.name for pg in ctx.pages]
try:
    ctx.new_page()
    out['new_after'] = 'made'
except RuntimeError as exc:
    out['new_after'] = str(exc)
`);
  if (!r) return;
  assert.deepEqual(r.out.closed, ['disconnected'], 'one disconnect; never a page, never the context');
  assert.deepEqual(r.out.pages_after, []);
  assert.match(r.out.new_after, /panel has gone/);
});

test('signed-in is read from the panel’s own cookies, not the app’s session', (t) => {
  const r = run(t, `
e = electron(panel_url='https://www.linkedin.com/feed/', jar=[{'name': 'li_at', 'value': 'a-stand-in', 'domain': '.linkedin.com', 'path': '/'}])
name_panel()
ctx = ns['launch_chrome'](types.SimpleNamespace(chromium=Chromium(e.browser)))
page = ctx.pages[0]
out['cookie'] = ns['_has_session_cookie'](page)
out['cookies'] = ctx.cookies('https://www.linkedin.com')
out['asked'] = [m for m, pg in sent if m == 'Network.getCookies']
out['ok'] = ns['ensure_logged_in'](page)
out['note'] = json.loads((Path(env['SIX_DEGREES_HOME']) / 'signed-in.json').read_text())['signedIn']
e2 = electron(panel_url='https://www.linkedin.com/feed/')
ctx2 = ns['launch_chrome'](types.SimpleNamespace(chromium=Chromium(e2.browser)))
out['empty_panel'] = ns['_has_session_cookie'](ctx2.pages[0])
`);
  if (!r) return;
  assert.equal(r.out.cookie, true);
  assert.deepEqual(r.out.cookies, [{ name: 'li_at', value: 'a-stand-in', domain: '.linkedin.com', path: '/' }]);
  assert.ok(r.out.asked.length >= 1);
  assert.equal(r.out.ok, true);
  assert.equal(r.out.note, true, 'the Scan page’s Signed in follows the panel');
  assert.equal(r.out.empty_panel, false, 'the app session’s cookies never count');
});

test('LinkedIn needing you brings the panel forward by saying so; through, it goes back; no window is moved', (t) => {
  const r = run(t, `
e = electron()
name_panel()
ctx = ns['launch_chrome'](types.SimpleNamespace(chromium=Chromium(e.browser)))
page = ctx.pages[0]
out['forward'] = ns['bring_forward'](page)
out['again'] = ns['bring_forward'](page)
out['back'] = ns['back_out_of_the_way'](page)
out['window_moves'] = [m for m, pg in sent if m.startswith('Browser.')]
`);
  if (!r) return;
  assert.equal(r.out.forward, true);
  assert.equal(r.out.again, false, 'already forward');
  assert.equal(r.out.back, true);
  assert.deepEqual(r.out.window_moves, []);
  const lines = r.log.split('\n').map((l) => l.trim());
  assert.equal(panelAsked(lines), 'away');
  assert.equal(panelAsked(lines.slice(0, lines.indexOf(PANEL_AWAY))), 'front');
});

test('a sign-in in the panel: the app is told where, in the words it shows', (t) => {
  const r = run(t, `
e = electron(panel_url='https://www.linkedin.com/login')
name_panel()
ctx = ns['launch_chrome'](types.SimpleNamespace(chromium=Chromium(e.browser)), sign_in=True)
out['ok'] = ns['ensure_logged_in'](ctx.pages[0], timeout_s=0)
`);
  if (!r) return;
  const lines = r.log.split('\n').map((l) => l.trim());
  assert.equal(r.out.ok, false);
  assert.ok(lines.includes(PANEL_FRONT), 'signing in puts the panel in front from the start');
  // While it waits (before it gave up), the notch says what LinkedIn needs, and where.
  const waiting = lines.slice(0, lines.findIndex((l) => l.startsWith('Gave up')));
  assert.equal(needsYou(waiting), "sign in to LinkedIn in Sixgree's own browser.");
  assert.doesNotMatch(r.log, /Chrome window in front/);
});

test('a panel that can’t be reached: one line says so, and Chrome starts as before', (t) => {
  const r = run(t, `
name_panel()
ns['CHROME_WINDOW']['show'] = True
chromium = Chromium(error=RuntimeError('connect ECONNREFUSED 127.0.0.1:1'))
ctx = ns['launch_chrome'](types.SimpleNamespace(chromium=chromium))
out['launched'] = len(chromium.launched)
out['pages'] = [pg.name for pg in ctx.pages]
out['panel_on'] = ns['PANEL']['on']
out['mode'] = ns['CHROME_WINDOW']['mode']
e = electron()
env['SIX_DEGREES_PANEL_TARGET'] = 'F' * 32
chromium = Chromium(e.browser)
ctx = ns['launch_chrome'](types.SimpleNamespace(chromium=chromium))
out['no_such_page_launched'] = len(chromium.launched)
out['closed'] = list(closed)
del env['SIX_DEGREES_PANEL_CDP']
chromium = Chromium(e.browser)
ns['launch_chrome'](types.SimpleNamespace(chromium=chromium))
out['unnamed_asked'] = chromium.asked
`);
  if (!r) return;
  assert.equal(r.out.launched, 1);
  assert.deepEqual(r.out.pages, ['chrome']);
  assert.equal(r.out.panel_on, false);
  assert.equal(r.out.mode, 'front');
  assert.equal(r.out.no_such_page_launched, 1);
  assert.deepEqual(r.out.closed, ['disconnected'], 'the connection to Electron is let go before Chrome starts');
  assert.deepEqual(r.out.unnamed_asked, [], 'no panel named: nothing is attached to');
  const said = r.log.split('\n').filter((l) => /Sixgree's own browser couldn't be reached/.test(l));
  assert.equal(said.length, 2, r.log);
  assert.match(said[0], /ECONNREFUSED.*so this uses a Chrome window instead/);
});

// Outlink and the scanner's --outlink went on 2026-10-17 (Blake: "it has no actual beneficiary to the
// application"): a profile opens in the panel without a scanner job (OpenProfile, app/api/profile-view).
test('the scanner has no --outlink any more', () => {
  const src = fs.readFileSync(SCRAPER, 'utf8');
  assert.doesNotMatch(src, /--outlink|open_outlink|OUTLINK_RESULTS|Outlink result/);
});
