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
# This computer's own displays never decide a result: none, unless a case says.
ns['screen_layout'] = lambda platform=None: []
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
  // A Mac's background window opens on the main display (hidden before it's
  // drawn; TRAPS §48): 40,40 when the displays can't be told.
  assert.deepEqual(mac, {
    user_data_dir: '/x/chrome-profile', headless: false, channel: 'chrome', timeout: 120000, chromium_sandbox: true,
    args: ['--disable-blink-features=AutomationControlled', '--test-type', '--window-position=40,40'],
  });
  assert.ok(win.args.includes('--window-position=-32000,-32000'), win.args.join(' '));
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
  assert.deepEqual(launches, ['context = p.chromium.launch_persistent_context(**chrome_launch_options(profile, mode, displays=displays))']);
  // Sign-in, the full and quick walks, messages, a circle, a company, Auto, Read profiles.
  assert.equal((src.match(/= launch_chrome\(p, /g) || []).length, 8);
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

// Display layouts no one here has: a second display to the left (negative x),
// to the right, above (negative y), below, a Retina beside an ordinary one,
// and the main display not first in the list. In the coordinates Chrome's
// window bounds use: the main display's top-left is 0,0, in points on a Mac.
const LAYOUTS = {
  one: [{ x: 0, y: 0, width: 1440, height: 900, main: true }],
  left: [{ x: 0, y: 0, width: 2560, height: 1440, main: true }, { x: -1920, y: 200, width: 1920, height: 1080, main: false }],
  right: [{ x: 0, y: 0, width: 1512, height: 982, main: true }, { x: 1512, y: -300, width: 2560, height: 1440, main: false }],
  above: [{ x: 0, y: 0, width: 1728, height: 1117, main: true }, { x: -400, y: -1440, width: 2560, height: 1440, main: false }],
  below: [{ x: 0, y: 0, width: 1920, height: 1080, main: true }, { x: 0, y: 1080, width: 1920, height: 1080, main: false }],
  // A 4K display at 1x beside a Retina laptop at 2x: both in points already.
  retinaAndOrdinary: [{ x: -3840, y: -500, width: 3840, height: 2160, main: false }, { x: 0, y: 0, width: 1512, height: 982, main: true }],
  // Unmarked (as on a platform that doesn't say): the one at 0,0 is the main one.
  unmarked: [{ x: 2560, y: 0, width: 1920, height: 1080 }, { x: 0, y: 0, width: 2560, height: 1440 }],
  // Wider than -32000 reaches.
  wall: [{ x: 0, y: 0, width: 1920, height: 1080, main: true }, { x: -40000, y: -34000, width: 40000, height: 34000, main: false }],
  tiny: [{ x: 0, y: 0, width: 1024, height: 640, main: true }],
};

const overlaps = (a, d) => a.left < d.x + d.width && a.left + a.width > d.x && a.top < d.y + d.height && a.top + a.height > d.y;
const inside = (a, d) => a.left >= d.x && a.top >= d.y && a.left + a.width <= d.x + d.width && a.top + a.height <= d.y + d.height;
const py = (value) => `json.loads(${JSON.stringify(JSON.stringify(value))})`;

test('placement: off every display wherever the displays are; in front, centred on the main one', (t) => {
  const r = run(t, `
layouts = ${py(LAYOUTS)}
out['cases'] = {name: {
    'off': ns['off_screen_bounds'](ds),
    'main': ns['on_main_display'](ds),
    'saved': ns['chrome_window_placement'](ds),
    'mac': ns['chrome_launch_options']('/x/p', 'background', platform='darwin', displays=ds)['args'][-1],
    'win': ns['chrome_launch_options']('/x/p', 'background', platform='win32', displays=ds)['args'][-1],
} for name, ds in layouts.items()}
out['none'] = [ns['off_screen_bounds']([]), ns['on_main_display']([]), ns['chrome_window_placement']([]), ns['main_display'](None)]
out['size'] = list(ns['WINDOW_SIZE'])
`);
  if (!r) return;
  const [w, h] = r.out.size;
  for (const [name, c] of Object.entries(r.out.cases)) {
    const displays = LAYOUTS[name];
    const main = displays.find((d) => d.main) || displays.find((d) => d.x === 0 && d.y === 0);
    // Out of sight: the window's whole rectangle is on no display at all.
    const off = { ...c.off, width: w, height: h };
    for (const d of displays) assert.ok(!overlaps(off, d), `${name}: the off-screen window overlaps ${JSON.stringify(d)}`);
    assert.ok(c.off.left <= -32000 && c.off.top <= -32000, name);
    // In front: wholly on the main display, centred, never on another.
    assert.ok(inside(c.main, main), `${name}: ${JSON.stringify(c.main)} isn't inside the main display`);
    const leftGap = c.main.left - main.x;
    const rightGap = main.x + main.width - (c.main.left + c.main.width);
    assert.ok(Math.abs(leftGap - rightGap) <= 1, `${name}: not centred`);
    for (const d of displays.filter((x) => x !== main)) assert.ok(!overlaps(c.main, d), `${name}: on the second display`);
    // What Chrome remembers is the same place.
    assert.deepEqual(c.saved, {
      left: c.main.left, top: c.main.top, right: c.main.left + c.main.width, bottom: c.main.top + c.main.height, maximized: false,
    });
    // The launch asks for the main display on a Mac (hidden there), off every display elsewhere.
    assert.equal(c.mac, `--window-position=${c.main.left},${c.main.top}`);
    assert.equal(c.win, `--window-position=${c.off.left},${c.off.top}`);
  }
  // A second display to the left or above: -32000 is still clear of it.
  assert.deepEqual(r.out.cases.left.off, { left: -32000, top: -32000 });
  assert.deepEqual(r.out.cases.above.off, { left: -32000, top: -32000 });
  // A display reaching past -32000: further still.
  assert.ok(r.out.cases.wall.off.left < -40000 - w && r.out.cases.wall.off.top < -34000 - h);
  // Full size where it fits; smaller on a small display.
  assert.deepEqual([r.out.cases.left.main.width, r.out.cases.left.main.height], [w, h]);
  assert.ok(r.out.cases.tiny.main.width < w && r.out.cases.tiny.main.height < h);
  // The main display not first in the list, or not marked: still found.
  assert.equal(r.out.cases.retinaAndOrdinary.main.left, Math.floor((1512 - w) / 2));
  assert.equal(r.out.cases.unmarked.main.left, Math.floor((2560 - w) / 2));
  // Displays that can't be told: -32000, 40,40 (the main display's corner), and nothing saved.
  assert.deepEqual(r.out.none, [{ left: -32000, top: -32000 }, { left: 40, top: 40, width: w, height: h }, null, null]);
});

test('the saved window placement is replaced with the main display, the rest of the profile kept', (t) => {
  const r = run(t, `
saved = {'left': -1700, 'top': 260, 'right': -400, 'bottom': 1120, 'maximized': True,
         'work_area_left': -1920, 'work_area_top': 225, 'work_area_right': 0, 'work_area_bottom': 1280}
before = {'browser': {'window_placement': saved, 'show_home_button': True}, 'profile': {'name': 'Person 1'}}
placement = ns['chrome_window_placement'](${py(LAYOUTS.left)})
out['placement'] = placement
out['after'] = ns['chrome_quiet_prefs'](before, placement)
prof = home / 'chrome-profile'
(prof / 'Default').mkdir(parents=True)
(prof / 'Default' / 'Preferences').write_text(json.dumps(before))
out['ok'] = ns['quiet_chrome_profile'](prof, placement)
out['file'] = json.loads((prof / 'Default' / 'Preferences').read_text())
out['unknown'] = ns['chrome_quiet_prefs'](before, None)['browser']
`);
  if (!r) return;
  const { placement, after, file, unknown } = r.out;
  assert.deepEqual(after.browser, { window_placement: placement, show_home_button: true });
  assert.equal(after.browser.window_placement.maximized, false);
  assert.ok(after.browser.window_placement.left >= 0, 'on the main display, not the one to its left');
  assert.equal(after.profile.name, 'Person 1');
  assert.equal(r.out.ok, true);
  assert.deepEqual(file.browser.window_placement, placement);
  // Displays that can't be told: what Chrome saved is left as it was.
  assert.equal(unknown.window_placement.left, -1700);
});

test('forward is centred on the main display, back is off every display, wherever the second one is', (t) => {
  const r = run(t, `
sent = []
page = Page(Context(signed_in=True, sent=sent))
W = ns['CHROME_WINDOW']
W['mac'] = None
ns['sys'] = types.SimpleNamespace(platform='win32')
ns['screen_layout'] = lambda platform=None: ${py(LAYOUTS.left)}
W['mode'] = 'background'
ns['bring_forward'](page)
ns['back_out_of_the_way'](page)
out['sent'] = [s[1]['bounds'] for s in sent if s[0] == 'Browser.setWindowBounds']
`);
  if (!r) return;
  const [normal, forward, normal2, back] = r.out.sent;
  assert.deepEqual(normal, { windowState: 'normal' });
  assert.deepEqual(normal2, { windowState: 'normal' });
  assert.ok(inside(forward, LAYOUTS.left[0]), JSON.stringify(forward));
  assert.equal(forward.left, (2560 - 1300) / 2);
  for (const d of LAYOUTS.left) assert.ok(!overlaps({ ...back, width: 1300, height: 860 }, d));
});

test("a Mac's hidden Chrome is kept hidden for as long as it's out of sight, not just its first seconds", (t) => {
  const r = run(t, `
import time as clock
alive = [True]
ns['_process_alive'] = lambda pid: alive[0]
m = ns['MacChrome']('/x/chrome-profile')
m.FAST = m.SLOW = 0.002
m.pid = 4242
# What macOS says, one look at a time: Chrome showing itself again long after
# the launch (a new window or tab, the Dock, Cmd-Tab), and now and then a
# lookup that finds nothing for a Chrome that's still running.
state = {'now': (False, True)}
hides = []
m._find = lambda: None
m._state = lambda: state['now']
def hide():
    hides.append(state['now'])
    state['now'] = (False, True)
    return True
m.hide = hide
def until(cond, limit=3.0):
    end = clock.monotonic() + limit
    while clock.monotonic() < end and not cond():
        clock.sleep(0.002)
    return cond()

m.watch()
clock.sleep(0.1)
state['now'] = (True, False)            # shows itself, and has the focus
out['hid_shown'] = until(lambda: len(hides) == 1)
state['now'] = None                     # the lookup found nothing, but it's running
clock.sleep(0.1)
out['alive_after_nil'] = m.thread.is_alive()
state['now'] = (True, True)             # hidden, but has the focus
out['hid_active'] = until(lambda: len(hides) == 2)
out['hides'] = [list(h) for h in hides]

m.forward()                             # LinkedIn needs you: left alone
out['stopped'] = not m.thread.is_alive()
state['now'] = (True, False)
clock.sleep(0.1)
out['hides_while_forward'] = len(hides)

m.watch()                               # you're through: hidden again, and kept hidden
out['hid_again'] = until(lambda: len(hides) == 3)
first = m.thread
m.watch()                               # watching already: not twice
out['one_watcher'] = m.thread is first

alive[0] = False                        # Chrome has gone: the watcher ends
state['now'] = None
out['ended'] = until(lambda: not m.thread.is_alive())
`);
  if (!r) return;
  const o = r.out;
  assert.equal(o.hid_shown, true, 'hidden again when it shows itself after the launch');
  assert.equal(o.alive_after_nil, true, 'a lookup that finds nothing is not Chrome gone');
  assert.equal(o.hid_active, true, 'hidden (the focus given back) when it takes the focus while hidden');
  assert.deepEqual(o.hides, [[true, false], [true, true]]);
  assert.equal(o.stopped, true);
  assert.equal(o.hides_while_forward, 2, 'never hidden while LinkedIn needs you');
  assert.equal(o.hid_again, true);
  assert.equal(o.one_watcher, true);
  assert.equal(o.ended, true);
});
