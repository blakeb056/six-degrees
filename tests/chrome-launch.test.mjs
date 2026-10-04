// The scanner's Chrome: no pop-ups, and out of your way (scripts/scrape.py
// launch_chrome and the pieces it's made of).
//
// Blake, 2026-10-04: "anything that utilizes chrome playwright within the
// actual app need to have no pop ups or security warning, double check", then
// "we want seamlessness … not to have any disruption through pop ups or
// windows". So every launch goes through one helper: --test-type (no yellow
// "unsupported command-line flag" bar), Chrome's own sandbox on a Mac, the
// profile's settings that would otherwise ask something (restore pages, save
// password, translate, notifications) written first, and a window that stays
// out of sight unless LinkedIn needs you.
//
// These run the scanner's own functions on stand-ins and a scratch folder:
// nothing starts Chrome or reaches LinkedIn. What only a real Chrome can show
// (the bar gone, the sandbox on, the focus given back, "Restore pages?" not
// offered after a kill) was checked by hand on a scratch profile; see
// docs/brain/SCRAPER.md "The window".

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PYTHON, noPython } from './python.mjs';
import { needsYou } from '../lib/scan-progress.js';

const SCRAPER = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'scripts', 'scrape.py');

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
home = Path(ns['_home']())

class Session:
    """A CDP session that writes down what it was sent."""
    def __init__(self, sent):
        self.sent = sent
    def send(self, method, params=None):
        self.sent.append([method, params])
        return {'windowId': 7} if method == 'Browser.getWindowForTarget' else {}
    def detach(self):
        pass

class Context:
    def __init__(self, signed_in, sent):
        self.jar = [{'name': 'li_at', 'value': 'a-stand-in'}] if signed_in else []
        self.pages = []
        self.sent = sent
    def cookies(self, url):
        return self.jar
    def new_cdp_session(self, page):
        return Session(self.sent)

class Page:
    def __init__(self, context):
        self.context = context
        self.url = 'about:blank'
        self.closed = False
        self.fronted = 0
        context.pages.append(self)
    def goto(self, url, **_):
        self.url = 'https://www.linkedin.com/feed/' if self.context.jar else 'https://www.linkedin.com/authwall'
    def is_closed(self):
        return self.closed
    def query_selector(self, _):
        return None
    def bring_to_front(self):
        self.fronted += 1

out = {}
exec(sys.argv[2])
print('RESULT ' + json.dumps(out))
`;

/** { out, log, home } from the case, or null when there is no Python here. */
function run(t, script, { keep = false } = {}) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'six-degrees-chrome-'));
  const r = spawnSync(PYTHON, ['-c', HARNESS, SCRAPER, script], {
    encoding: 'utf8',
    env: { ...process.env, SIX_DEGREES_HOME: home },
  });
  if (!keep) fs.rmSync(home, { recursive: true, force: true });
  if (noPython(t, r)) return null;
  assert.equal(r.status, 0, r.stderr);
  const lines = r.stdout.trimEnd().split('\n');
  return { out: JSON.parse(lines.pop().replace(/^RESULT /, '')), log: lines.join('\n'), home };
}

test('where the window goes: out of sight unless you sign in or asked to watch; headless only when asked', (t) => {
  const r = run(t, `
m = ns['chrome_window_mode']
out['modes'] = [m(), m(show=True), m(headless=True), m(sign_in=True), m(headless=True, sign_in=True), m(headless=True, show=True)]
out['known'] = list(ns['WINDOW_MODES'])
`);
  if (!r) return;
  assert.deepEqual(r.out.modes, ['background', 'front', 'headless', 'front', 'front', 'front']);
  assert.deepEqual(r.out.known, ['background', 'front', 'headless']);
});

test('every launch has the same flags: --test-type, the old AutomationControlled, never --enable-automation; the Mac runs the sandbox', (t) => {
  const r = run(t, `
opts = ns['chrome_launch_options']
out['mac'] = opts('/x/chrome-profile', 'background', platform='darwin')
out['front'] = opts('/x/chrome-profile', 'front', platform='darwin')
out['headless'] = opts('/x/chrome-profile', 'headless', platform='darwin')
out['win'] = opts('/x/chrome-profile', 'background', platform='win32')
out['linux'] = opts('/x/chrome-profile', 'front', platform='linux')
`);
  if (!r) return;
  const { mac, front, headless, win, linux } = r.out;
  assert.deepEqual(mac, {
    user_data_dir: '/x/chrome-profile', headless: false, channel: 'chrome', timeout: 120000, chromium_sandbox: true,
    args: ['--disable-blink-features=AutomationControlled', '--test-type', '--window-position=-32000,-32000'],
  });
  // In front, and headless: nothing placed off-screen.
  assert.deepEqual(front.args, ['--disable-blink-features=AutomationControlled', '--test-type']);
  assert.equal(front.headless, false);
  assert.equal(headless.headless, true);
  assert.deepEqual(headless.args, ['--disable-blink-features=AutomationControlled', '--test-type']);
  assert.equal(headless.chromium_sandbox, true);
  // Only the Mac has been tried with Chrome's sandbox: elsewhere Playwright's default stands.
  assert.equal('chromium_sandbox' in win, false);
  assert.equal('chromium_sandbox' in linux, false);
  assert.ok(win.args.includes('--test-type'));
  for (const o of [mac, front, headless, win, linux]) {
    assert.ok(!o.args.some((a) => /enable-automation|no-sandbox|disable-features/.test(a)), o.args.join(' '));
  }
});

test('the settings that would ask something are written, and nothing else in the profile changes', (t) => {
  const r = run(t, `
before = {'profile': {'name': 'Person 1', 'exit_type': 'Crashed', 'default_content_setting_values': {'geolocation': 2}},
          'translate': 'not a dict', 'browser': {'window_placement': {'left': 10}}}
copy = json.loads(json.dumps(before))
out['after'] = ns['chrome_quiet_prefs'](before)
out['untouched'] = before == copy
out['from_nothing'] = ns['chrome_quiet_prefs'](None)
`);
  if (!r) return;
  const { after, untouched, from_nothing: fresh } = r.out;
  assert.equal(untouched, true, 'the dict passed in is not changed');
  assert.deepEqual(after, {
    profile: {
      name: 'Person 1', exit_type: 'Normal', exited_cleanly: true, password_manager_enabled: false,
      default_content_setting_values: { geolocation: 2, notifications: 2 },
    },
    translate: { enabled: false },
    browser: { window_placement: { left: 10 } },
    credentials_enable_service: false,
  });
  assert.deepEqual(fresh, {
    profile: { exit_type: 'Normal', exited_cleanly: true, password_manager_enabled: false, default_content_setting_values: { notifications: 2 } },
    credentials_enable_service: false,
    translate: { enabled: false },
  });
});

test('the profile file: made when missing, merged when there, and never touched when it cannot be read', (t) => {
  const r = run(t, `
prof = home / 'chrome-profile'
prefs = prof / 'Default' / 'Preferences'
out['made'] = ns['quiet_chrome_profile'](prof)
out['fresh'] = json.loads(prefs.read_text())

prefs.write_text(json.dumps({'profile': {'exit_type': 'Crashed', 'name': 'Person 1'}, 'session': {'restore_on_startup': 1}}))
out['merged_ok'] = ns['quiet_chrome_profile'](prof)
out['merged'] = json.loads(prefs.read_text())
out['again'] = ns['quiet_chrome_profile'](prof)

prefs.write_text('{"profile": {"exit_type": "Crashed"')
out['broken_ok'] = ns['quiet_chrome_profile'](prof)
out['broken'] = prefs.read_text()

prefs.write_text('[1, 2]')
out['list_ok'] = ns['quiet_chrome_profile'](prof)
out['list'] = prefs.read_text()
out['leftovers'] = sorted(p.name for p in prefs.parent.iterdir())
`);
  if (!r) return;
  const o = r.out;
  assert.equal(o.made, true);
  assert.equal(o.fresh.profile.exit_type, 'Normal');
  assert.equal(o.fresh.credentials_enable_service, false);
  assert.equal(o.merged_ok, true);
  assert.deepEqual(o.merged.session, { restore_on_startup: 1 }, 'the rest of the file stays');
  assert.equal(o.merged.profile.name, 'Person 1');
  assert.equal(o.merged.profile.exit_type, 'Normal');
  assert.equal(o.merged.profile.exited_cleanly, true);
  assert.equal(o.again, true);
  // A file Chrome was halfway through writing, or anything else that isn't an object: left exactly as it was.
  assert.equal(o.broken_ok, false);
  assert.equal(o.broken, '{"profile": {"exit_type": "Crashed"');
  assert.equal(o.list_ok, false);
  assert.equal(o.list, '[1, 2]');
  assert.deepEqual(o.leftovers, ['Preferences'], 'no temporary file left behind');
  assert.match(r.log, /left as they are/);
});

test('every Chrome the scanner starts goes through launch_chrome', () => {
  const src = fs.readFileSync(SCRAPER, 'utf8');
  const launches = src.split('\n').filter((l) => l.includes('launch_persistent_context(')).map((l) => l.trim());
  assert.deepEqual(launches, ['context = p.chromium.launch_persistent_context(**chrome_launch_options(profile, mode))']);
  // Sign-in, the full and quick walks, messages, a circle, a company, Auto.
  assert.equal((src.match(/= launch_chrome\(p, /g) || []).length, 7);
  assert.match(src, /browser = launch_chrome\(p, sign_in=True\)/);
});

test('signing in brings a background window forward, says so for the app, and puts it back once you are through', (t) => {
  const r = run(t, `
calls = []
ns['bring_forward'] = lambda page: calls.append('forward')
ns['back_out_of_the_way'] = lambda page: calls.append('back')
sent = []
ctx = Context(signed_in=False, sent=sent)
page = Page(ctx)
sleeps = []
def sign_in(seconds):
    # The first look finds no session; you've signed in by the wait's first poll.
    sleeps.append(seconds)
    if len(sleeps) == 2:
        ctx.jar.append({'name': 'li_at', 'value': 'a-stand-in'})
        page.url = 'https://www.linkedin.com/feed/'
ns['time'] = types.SimpleNamespace(sleep=sign_in, time=lambda: 1790000000.0)
out['ok'] = ns['ensure_logged_in'](page)
out['calls'] = list(calls)

calls.clear()
signed = Context(signed_in=True, sent=sent)
out['already'] = ns['ensure_logged_in'](Page(signed))
out['already_calls'] = list(calls)
out['needs'] = ns['NEEDS_YOU']
`);
  if (!r) return;
  assert.equal(r.out.ok, true);
  assert.deepEqual(r.out.calls, ['forward', 'back']);
  // Already signed in: the window never comes out.
  assert.equal(r.out.already, true);
  assert.deepEqual(r.out.already_calls, []);
  // The line the app shows (lib/scan-progress.js needsYou), from the scanner's own output.
  const line = r.log.split('\n').find((l) => l.startsWith(r.out.needs));
  assert.ok(line, r.log);
  assert.equal(needsYou(r.log.split('\n').slice(0, r.log.split('\n').indexOf(line) + 1)), 'sign in to LinkedIn in the Chrome window in front.');
  // And once signed in, it says nothing more.
  assert.equal(needsYou(r.log.split('\n')), null);
});

test('forward and back: only a background window moves, onto the screen and in front, then off it again', (t) => {
  const r = run(t, `
sent = []
page = Page(Context(signed_in=True, sent=sent))
W = ns['CHROME_WINDOW']
W['mac'] = None
results = {}
for mode in ['front', 'headless', None]:
    W['mode'] = mode
    results[str(mode)] = [ns['bring_forward'](page), ns['back_out_of_the_way'](page)]
out['others'] = results
out['sent_by_others'] = len(sent)

W['mode'] = 'background'
out['forward'] = ns['bring_forward'](page)
out['mode_forward'] = W['mode']
out['fronted'] = page.fronted
out['sent_forward'] = [s for s in sent if s[0] == 'Browser.setWindowBounds']
sent.clear()
ns['sys'] = types.SimpleNamespace(platform='win32')   # not a Mac: off the edge of the screen
out['back'] = ns['back_out_of_the_way'](page)
out['mode_back'] = W['mode']
out['sent_back'] = [s for s in sent if s[0] == 'Browser.setWindowBounds']
out['back_again'] = ns['back_out_of_the_way'](page)
`);
  if (!r) return;
  const o = r.out;
  // A window already in front, a headless one, or none: left alone.
  assert.deepEqual(o.others, { front: [false, false], headless: [false, false], None: [false, false] });
  assert.equal(o.sent_by_others, 0);
  assert.equal(o.forward, true);
  assert.equal(o.mode_forward, 'forward');
  assert.equal(o.fronted, 1);
  assert.deepEqual(o.sent_forward, [
    ['Browser.setWindowBounds', { windowId: 7, bounds: { windowState: 'normal' } }],
    ['Browser.setWindowBounds', { windowId: 7, bounds: { left: 40, top: 40, width: 1300, height: 860 } }],
  ]);
  assert.equal(o.back, true);
  assert.equal(o.mode_back, 'background');
  assert.deepEqual(o.sent_back, [
    ['Browser.setWindowBounds', { windowId: 7, bounds: { windowState: 'normal' } }],
    ['Browser.setWindowBounds', { windowId: 7, bounds: { left: -32000, top: -32000 } }],
  ]);
  assert.equal(o.back_again, false, 'only once it came forward');
});
