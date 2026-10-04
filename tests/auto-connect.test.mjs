// Auto: one connection request, sent from the scanner's Chrome (scrape.py
// connect_person, lib/auto-connect.js). Blake, 2026-10-03: "auto add and
// basically adds the person for them ... if [LinkedIn asks for] a email from
// their work or to send a personal note if they have premium ... have it close
// out of that in the scanner for adding but it should be seamless."
//
// These run the scanner's own code against a stand-in page that answers the
// questions it asks (a button by role and accessible name, the text on screen,
// a dialog's contents), with a stand-in browser and clock, in a scratch
// SIX_DEGREES_HOME. Nothing opens a browser or reaches LinkedIn or the app.
// LinkedIn's real page has never been seen by this code: the labels the stand-in
// uses are the ones LinkedIn is known to use, and a real run must be watched.
// Every person is invented.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PYTHON, noPython } from './python.mjs';
import {
  INVITE_CAPS, OUTCOMES, RESULT_NAMES, CONNECT_RESULT, connectResultIn, connectMarks, connectOutcome,
  inviteRefusal, personRefusal, AUTO_ACCEPTED_SETTING, AUTO_CONFIRM, AUTO_EXPLAIN,
} from '../lib/auto-connect.js';
import { INVITE_CAPS as USAGE_INVITE_CAPS } from '../lib/usage.js';
import { SETTINGS } from '../lib/settings.js';

const SCRAPER = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'scripts', 'scrape.py');

const HARNESS = String.raw`
import ast, json, re, sys, types
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
    def time(self):
        return self.t
    def sleep(self, s):
        self.t += s

NOW = 1790000000.0
clock = Clock(NOW)
ns['time'] = clock

NAME = 'Ada Quill'
URL = 'https://www.linkedin.com/in/ada-quill-0000/'

class El:
    """One thing on the stand-in page: a role, an aria-label and/or text, where it is."""
    def __init__(self, page, role, label=None, text=None, visible=True, main=True, enabled=True,
                 parent=None, on_click=None, kind=None):
        self.page, self.role, self.label, self.text = page, role, label, text
        self.visible, self.main, self.enabled, self.parent = visible, main, enabled, parent
        self.on_click, self.kind = on_click, kind
    @property
    def key(self):
        return self.label or self.text or self.role
    def name(self):
        return self.label or self.text or ''

class Loc:
    """What Playwright's Locator answers, for the elements it holds."""
    def __init__(self, page, items, scope=None):
        self.page, self.items, self.scope = page, items, scope
    def count(self):
        return len(self.items)
    def nth(self, i):
        return Loc(self.page, self.items[i:i + 1])
    @property
    def first(self):
        return Loc(self.page, self.items[:1], self.scope)
    def _one(self):
        assert self.items, 'an empty locator was used'
        return self.items[0]
    def is_visible(self):
        return bool(self.items) and self._one().visible
    def is_enabled(self):
        return self._one().enabled
    def get_attribute(self, name):
        return self._one().label if name == 'aria-label' else None
    def inner_text(self):
        el = self._one()
        if el.role in ('dialog', 'alertdialog'):
            inside = ' '.join(c.name() for c in self.page.els if c.parent is el and c.visible)
            return (el.text or '') + ' ' + inside
        return el.text or el.label or ''
    def click(self, timeout=None):
        el = self._one()
        assert el.visible, f'clicked something not on screen: {el.key}'
        self.page.clicked.append(el.key)
        if el.on_click:
            el.on_click()
    def get_by_role(self, role, name=None):
        return self.page.get_by_role(role, name=name, within=self.items)
    def locator(self, selector):
        return self.page.locator(selector, within=self.items)

class Keyboard:
    def __init__(self, page):
        self.page = page
    def press(self, key):
        self.page.keys.append(key)
        if key == 'Escape':
            self.page.escape()

class Page:
    def __init__(self):
        self.els, self.opened, self.clicked, self.keys = [], [], [], []
        self.state = {'shown': True, 'pushback': None, 'unavailable': False}
        self.keyboard = Keyboard(self)
        self.menu = []
    def add(self, role, label=None, text=None, **kw):
        el = El(self, role, label, text, **kw)
        self.els.append(el)
        return el
    def _matches(self, el, role, name):
        if role is not None and el.role != role:
            return False
        if name is None:
            return True
        if hasattr(name, 'search'):
            return bool(name.search(el.name()))
        return str(name).lower() in el.name().lower()
    def _inside(self, el, within):
        if within is None:
            return True
        for scope in within:
            if scope == 'main':
                if el.main:
                    return True
            elif el.parent is scope:
                return True
        return False
    def get_by_role(self, role, name=None, within=None):
        # Hidden elements aren't in Playwright's accessibility tree.
        return Loc(self, [e for e in self.els if e.visible and self._inside(e, within) and self._matches(e, role, name)])
    def get_by_text(self, pattern):
        return Loc(self, [e for e in self.els if e.visible and e.text and pattern.search(e.text)])
    def locator(self, selector, within=None):
        if selector == 'main':
            return Loc(self, ['main'])
        if selector == 'input[type=email]':
            return Loc(self, [e for e in self.els if e.visible and e.kind == 'email' and self._inside(e, within)])
        raise AssertionError('a selector this page does not answer: ' + selector)
    def goto(self, url, **_):
        self.opened.append(url)
    def evaluate(self, js, *args):
        if js is ns['PUSHBACK_JS']:
            return self.state['pushback']
        if js is ns['PROFILE_SHOWN_JS']:
            return self.state['shown']
        if 'this profile is not available' in js:
            return self.state['unavailable']
        return ''
    def is_closed(self):
        return False
    def set_default_timeout(self, _):
        pass
    def set_default_navigation_timeout(self, _):
        pass
    # The stand-in's own behaviour: Escape closes the newest dialog, or an open menu.
    def escape(self):
        open_dialogs = [e for e in self.els if e.role in ('dialog', 'alertdialog') and e.visible]
        if open_dialogs:
            self.close(open_dialogs[-1])
        else:
            for e in self.menu:
                e.visible = False
    def close(self, dialog):
        dialog.visible = False
        for e in self.els:
            if e.parent is dialog:
                e.visible = False
    def dialog(self, text, buttons=(), email=False):
        d = self.add('dialog', text=text)
        if email:
            self.add('textbox', label='Email', parent=d, kind='email')
        for b in buttons:
            if isinstance(b, str):
                self.add('button', label=b, parent=d)
            else:
                self.add('button', parent=d, **b)
        self.add('button', label='Dismiss', parent=d, on_click=lambda: self.close(d))
        return d
    def show_pending(self):
        for e in self.els:
            if e.label == 'Invite Ada Quill to connect':
                e.visible = False
        self.add('button', label='Pending, click to withdraw invitation sent to Ada Quill', text='Pending')

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

ns['read_connections'] = lambda endpoint='', params=None: [{'id': 'd2-ada', 'name': NAME, 'profile_url': URL}]
ns['ensure_logged_in'] = lambda page, **_: True

home = Path(ns['_home']())
def record(**lists):
    (home / 'linkedin-activity.json').write_text(json.dumps({'searches': [], 'profiles': [], **lists}))
def activity():
    try:
        return json.loads((home / 'linkedin-activity.json').read_text())
    except FileNotFoundError:
        return {}

# What the page holds whatever the case: someone else's Connect, in the page's
# own main column, which must never be pressed.
page.add('button', label='Invite Ben Ostrander to connect', text='Connect')

def run(name=NAME):
    result = ns['connect_person'](URL, name=name)
    act = activity()
    return {
        'result': result, 'clicked': page.clicked, 'keys': page.keys, 'opened': page.opened,
        'launched': len(launched), 'invites': len(act.get('invites', [])), 'profiles': len(act.get('profiles', [])),
        'cooldown': (home / 'linkedin-cooldown.json').exists(),
        'dialogs_open': sum(1 for e in page.els if e.role in ('dialog', 'alertdialog') and e.visible),
    }

out = {}
exec(sys.argv[2])
print('RESULT ' + json.dumps(out))
`;

/** Run one case: `body` sets up the stand-in page and fills `out` (usually out = run()). */
function connect(t, body) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'six-degrees-auto-'));
  const r = spawnSync(PYTHON, ['-c', HARNESS, SCRAPER, body], {
    encoding: 'utf8',
    env: { ...process.env, SIX_DEGREES_HOME: home },
  });
  fs.rmSync(home, { recursive: true, force: true });
  if (noPython(t, r)) return null;
  assert.equal(r.status, 0, r.stderr);
  const line = r.stdout.trim().split('\n').find((l) => l.startsWith('RESULT '));
  assert.ok(line, r.stdout);
  return { ...JSON.parse(line.slice(7)), log: r.stdout };
}

// The front of Ada's profile: her own Connect, which opens LinkedIn's invitation window.
const CONNECT_OPENS = (dialog) => `
connect = page.add('button', label='Invite Ada Quill to connect', text='Connect',
                   on_click=lambda: ${dialog})
page.add('button', label='More actions', text='More')
`;

const URL = 'https://www.linkedin.com/in/ada-quill-0000/';

test('sends without a note, and only to the person asked: their profile then shows it pending', (t) => {
  const out = connect(t, `
${CONNECT_OPENS('note()')}
def note():
    d = page.dialog('Add a note to your invitation?', ['Add a note',
        {'label': 'Send without a note', 'on_click': lambda: (page.close(d), page.show_pending())}])
out = run()
`);
  if (!out) return;
  assert.equal(out.result, 'sent');
  assert.deepEqual(out.clicked, ['Invite Ada Quill to connect', 'Send without a note']);
  assert.deepEqual(out.opened, [URL], 'her profile, once');
  assert.equal(out.profiles, 1, 'one profile view, written down like any other');
  assert.equal(out.invites, 1, 'one request toward Auto’s caps');
  assert.equal(out.cooldown, false);
  assert.match(out.log, /Sent\. Ada Quill's profile shows the request pending\./);
});

test('LinkedIn wants their email: the window is closed, nothing is sent, nothing is counted as sent', (t) => {
  const out = connect(t, `
${CONNECT_OPENS('email()')}
def email():
    page.dialog('To verify this member knows you, please enter their email to connect. You can also include a personal note.',
                ['Add a note', 'Send'], email=True)
out = run()
`);
  if (!out) return;
  assert.equal(out.result, 'email-needed');
  assert.deepEqual(out.clicked, ['Invite Ada Quill to connect', 'Dismiss'], 'closed, never Send');
  assert.equal(out.dialogs_open, 0);
  assert.equal(out.invites, 0);
  assert.equal(connectMarks(out.result), false);
});

test('an email asked for in words alone is still an email: closed, nothing sent', (t) => {
  const out = connect(t, `
${CONNECT_OPENS('email()')}
def email():
    page.dialog('How do you know Ada? To verify this member knows you, please enter their email to connect.', ['Send'])
out = run()
`);
  if (!out) return;
  assert.equal(out.result, 'email-needed');
  assert.ok(!out.clicked.includes('Send'));
});

test('a Premium personal-note offer: sent without a note, Premium never pressed', (t) => {
  const out = connect(t, `
${CONNECT_OPENS('upsell()')}
def upsell():
    d = page.dialog('Personalize your invitation with Premium. You’ve used all your free personalized invitations this month.',
        ['Try Premium for free', 'Add a note',
         {'label': 'Send without a note', 'on_click': lambda: (page.close(d), page.show_pending())}])
out = run()
`);
  if (!out) return;
  assert.equal(out.result, 'sent');
  assert.deepEqual(out.clicked, ['Invite Ada Quill to connect', 'Send without a note']);
  assert.match(out.log, /personal note \(Premium\)\. Sending without one/);
});

test('the only Send in the window is pressed when there is no "Send without a note"', (t) => {
  const out = connect(t, `
${CONNECT_OPENS('plain()')}
def plain():
    d = page.dialog('You can customize this invitation', ['Add a note',
        {'label': 'Send', 'on_click': lambda: (page.close(d), page.show_pending())}])
out = run()
`);
  if (!out) return;
  assert.equal(out.result, 'sent');
  assert.deepEqual(out.clicked, ['Invite Ada Quill to connect', 'Send']);
});

test('already pending on LinkedIn: nothing pressed, reported so it is marked as sent here', (t) => {
  const out = connect(t, `
page.add('button', label='Pending, click to withdraw invitation sent to Ada Quill', text='Pending')
page.add('button', label='More actions', text='More')
out = run()
`);
  if (!out) return;
  assert.equal(out.result, 'already-pending');
  assert.deepEqual(out.clicked, []);
  assert.equal(out.invites, 0);
  assert.equal(out.profiles, 1, 'her profile was opened to see it');
  assert.equal(connectMarks(out.result), true);
});

test('Connect only under More: the menu is opened and her Connect pressed there', (t) => {
  const out = connect(t, `
page.add('button', label='Follow Ada Quill', text='Follow')
def open_menu():
    for e in page.menu:
        e.visible = True
page.add('button', label='More actions', text='More', on_click=open_menu)
def note():
    d = page.dialog('Add a note to your invitation?', ['Add a note',
        {'label': 'Send without a note', 'on_click': lambda: (page.close(d), page.show_pending())}])
page.menu = [page.add('button', label='Save to PDF', visible=False),
             page.add('button', label='Invite Ada Quill to connect', text='Connect', visible=False, on_click=note)]
out = run()
`);
  if (!out) return;
  assert.equal(out.result, 'sent');
  assert.deepEqual(out.clicked, ['More actions', 'Invite Ada Quill to connect', 'Send without a note']);
});

test('a nameless Connect counts only when opening More is what brought it on screen', (t) => {
  const out = connect(t, `
page.add('button', label='Follow Ada Quill', text='Follow')
def open_menu():
    for e in page.menu:
        e.visible = True
page.add('button', label='More actions', text='More', on_click=open_menu)
def note():
    d = page.dialog('Add a note to your invitation?', ['Add a note',
        {'label': 'Send without a note', 'on_click': lambda: (page.close(d), page.show_pending())}])
page.menu = [page.add('menuitem', text='Connect', visible=False, on_click=note)]
out = run()
`);
  if (!out) return;
  assert.equal(out.result, 'sent');
  assert.deepEqual(out.clicked, ['More actions', 'Connect', 'Send without a note']);

  // A nameless Connect already on the page (anyone's) is never taken for hers.
  const other = connect(t, `
page.add('button', text='Connect')
page.add('button', label='Follow Ada Quill', text='Follow')
def open_menu():
    for e in page.menu:
        e.visible = True
page.add('button', label='More actions', text='More', on_click=open_menu)
page.menu = [page.add('menuitem', text='Connect', visible=False)]
out = run()
`);
  assert.equal(other.result, 'no-connect');
  assert.deepEqual(other.clicked, ['More actions']);
  assert.deepEqual(other.keys, ['Escape'], 'the menu is closed again');
});

test('no Connect anywhere (Follow and Message only): nothing sent, and someone else’s Connect never pressed', (t) => {
  const out = connect(t, `
page.add('button', label='Follow Ada Quill', text='Follow')
page.add('link', label='Message Ada Quill', text='Message')
def open_menu():
    for e in page.menu:
        e.visible = True
page.add('button', label='More actions', text='More', on_click=open_menu)
page.menu = [page.add('button', label='Save to PDF', visible=False), page.add('button', label='Report or block', visible=False)]
out = run()
`);
  if (!out) return;
  assert.equal(out.result, 'no-connect');
  assert.ok(!out.clicked.includes('Invite Ben Ostrander to connect'));
  assert.equal(out.invites, 0);
  assert.equal(connectMarks(out.result), false);
});

test('Send pressed but the profile never shows it pending: unclear, not sent, though it counts toward the caps', (t) => {
  const out = connect(t, `
${CONNECT_OPENS('note()')}
def note():
    d = page.dialog('Add a note to your invitation?', ['Add a note', {'label': 'Send without a note', 'on_click': lambda: page.close(d)}])
out = run()
`);
  if (!out) return;
  assert.equal(out.result, 'unclear');
  assert.equal(out.invites, 1, 'it may have gone, so it counts');
  assert.equal(connectMarks(out.result), false, 'and it is not marked as sent');
  assert.match(out.log, /Not calling it sent/);
});

test('LinkedIn saying the invitation to her was sent confirms it too', (t) => {
  const out = connect(t, `
${CONNECT_OPENS('note()')}
def note():
    d = page.dialog('Add a note to your invitation?', ['Add a note', {'label': 'Send without a note',
        'on_click': lambda: (page.close(d), page.add('alert', text='Your invitation to Ada Quill was sent.'))}])
out = run()
`);
  if (!out) return;
  assert.equal(out.result, 'sent');

  // ... but not a notice about somebody else.
  const other = connect(t, `
${CONNECT_OPENS('note()')}
def note():
    d = page.dialog('Add a note to your invitation?', ['Add a note', {'label': 'Send without a note',
        'on_click': lambda: (page.close(d), page.add('alert', text='Your invitation to Ben Ostrander was sent.'))}])
out = run()
`);
  assert.equal(other.result, 'unclear');
});

test('sent straight from Connect with nothing to answer: sent, and counted', (t) => {
  const out = connect(t, `
page.add('button', label='Invite Ada Quill to connect', text='Connect', on_click=page.show_pending)
out = run()
`);
  if (!out) return;
  assert.equal(out.result, 'sent');
  assert.deepEqual(out.clicked, ['Invite Ada Quill to connect']);
  assert.equal(out.invites, 1);
});

test('LinkedIn’s own invitation limit: closed, nothing sent, nothing counted', (t) => {
  const out = connect(t, `
${CONNECT_OPENS('limit()')}
def limit():
    d = page.dialog('You’ve reached the weekly invitation limit', [{'label': 'Got it', 'on_click': lambda: page.close(d)}])
out = run()
`);
  if (!out) return;
  assert.equal(out.result, 'linkedin-limit');
  assert.equal(out.invites, 0);
  assert.equal(out.dialogs_open, 0);
});

test('a window Auto can’t answer without a note is closed, and nothing is sent', (t) => {
  const out = connect(t, `
${CONNECT_OPENS('ask()')}
def ask():
    page.dialog('How do you know Ada?', ['Colleague', 'Classmate', 'Other'])
out = run()
`);
  if (!out) return;
  assert.equal(out.result, 'not-sent');
  assert.equal(out.invites, 0);
  assert.equal(out.dialogs_open, 0);
  assert.ok(!out.clicked.some((c) => ['Colleague', 'Classmate', 'Other'].includes(c)));
});

test('a scanning pause stops it before anything opens', (t) => {
  const out = connect(t, `
(home / 'linkedin-cooldown.json').write_text(json.dumps({'until': NOW + 3600, 'reason': 'LinkedIn pushed back: a security check', 'set_at': NOW - 60}))
page.add('button', label='Invite Ada Quill to connect', text='Connect')
out = run()
`);
  if (!out) return;
  assert.equal(out.result, 'cooldown');
  assert.equal(out.launched, 0, 'no browser started');
  assert.deepEqual(out.opened, []);
  assert.deepEqual(out.clicked, []);
  assert.equal(out.profiles, 0);
});

test('Auto’s caps reached, a day’s or a week’s: refused before anything opens', (t) => {
  const day = connect(t, `
record(invites=[NOW - 60 * i for i in range(${INVITE_CAPS.day})])
out = run()
`);
  if (!day) return;
  assert.equal(day.result, 'invites-day');
  assert.equal(day.launched, 0);
  assert.deepEqual(day.opened, []);
  assert.match(day.log, new RegExp(`Auto has sent ${INVITE_CAPS.day} connection requests in the last 24 hours, its limit\\. The next one frees up`));

  const week = connect(t, `
record(invites=[NOW - 2 * 86400 - 60 * i for i in range(${INVITE_CAPS.week})])
out = run()
`);
  assert.equal(week.result, 'invites-week');
  assert.equal(week.launched, 0);

  // One under the day's cap is still a yes.
  const under = connect(t, `
record(invites=[NOW - 60 * i for i in range(${INVITE_CAPS.day - 1})])
page.add('button', label='Invite Ada Quill to connect', text='Connect', on_click=page.show_pending)
out = run()
`);
  assert.equal(under.result, 'sent');
  assert.equal(under.invites, INVITE_CAPS.day);
});

test('no profile views left: refused before anything opens', (t) => {
  const out = connect(t, `
record(profiles=[NOW - 60 * i for i in range(50)])
out = run()
`);
  if (!out) return;
  assert.equal(out.result, 'profiles');
  assert.equal(out.launched, 0);
});

test('LinkedIn pushing back on her profile: the page is kept, everything pauses, nothing is pressed', (t) => {
  const out = connect(t, `
page.state['pushback'] = 'a security check'
page.add('button', label='Invite Ada Quill to connect', text='Connect')
out = run()
`);
  if (!out) return;
  assert.equal(out.result, 'pushback');
  assert.deepEqual(out.clicked, []);
  assert.equal(out.cooldown, true);

  // A security check before her profile even opens (ensure_logged_in) is the same.
  const early = connect(t, `
def wall(page, **_):
    raise ns['LinkedInPushedBack'](0, 'a security check')
ns['ensure_logged_in'] = wall
out = run()
`);
  assert.equal(early.result, 'pushback');
  assert.deepEqual(early.opened, []);
});

test('her profile never rendering, or not available: nothing pressed', (t) => {
  const blank = connect(t, `
page.state['shown'] = False
page.add('button', label='Invite Ada Quill to connect', text='Connect')
out = run()
`);
  if (!blank) return;
  assert.equal(blank.result, 'not-loaded');
  assert.deepEqual(blank.clicked, []);

  const gone = connect(t, `
page.state['unavailable'] = True
out = run()
`);
  assert.equal(gone.result, 'unavailable');
});

test('a name from the app is matched word for word, credentials and all', (t) => {
  const out = connect(t, `
page.add('button', label='Invite Ada Quill, MBA to connect', text='Connect', on_click=page.show_pending)
out = run('Ada Quill, MBA')
`);
  if (!out) return;
  assert.equal(out.result, 'sent');

  // "Ada Quillon" is not Ada Quill.
  const near = connect(t, `
page.add('button', label='Invite Ada Quillon to connect', text='Connect')
out = run()
`);
  assert.equal(near.result, 'no-connect');
  assert.deepEqual(near.clicked, []);
});

// ── the scanner and the app agree ────────────────────────────────────────────

test('Auto’s caps and result names in the app are the scanner’s', (t) => {
  const lift = `
import ast, json, sys
tree = ast.parse(open(sys.argv[1]).read())
want = {'INVITE_DAY_CAP', 'INVITE_WEEK_CAP', 'CONNECT_RESULTS'}
body = [n for n in tree.body if isinstance(n, ast.Assign) and any(getattr(x, 'id', '') in want for x in n.targets)]
ns = {}
exec(compile(ast.Module(body=body, type_ignores=[]), 'scrape.py', 'exec'), ns)
print(json.dumps({k: ns[k] for k in want}))
`;
  const r = spawnSync(PYTHON, ['-c', lift, SCRAPER], { encoding: 'utf8' });
  if (noPython(t, r)) return;
  assert.equal(r.status, 0, r.stderr);
  const py = JSON.parse(r.stdout);
  assert.deepEqual(INVITE_CAPS, { day: py.INVITE_DAY_CAP, week: py.INVITE_WEEK_CAP });
  assert.deepEqual([...RESULT_NAMES].sort(), [...py.CONNECT_RESULTS].sort());
  // What Blake was told (2026-10-03): 15 a day, 80 a week, under the ~100 a week people report.
  assert.deepEqual(INVITE_CAPS, { day: 15, week: 80 });
  assert.equal(USAGE_INVITE_CAPS, INVITE_CAPS, 'the usage page shows the same caps');
});

test('the result line is read exactly, and only a confirmed or already-pending request marks as sent', () => {
  assert.equal(connectResultIn('Connect result: sent'), 'sent');
  assert.equal(connectResultIn('  Connect result: email-needed  '), 'email-needed');
  assert.equal(connectResultIn('Connect result: everything'), null, 'not a result the scanner prints');
  assert.equal(connectResultIn('Sent. Connect result: sent'), null);
  assert.ok(CONNECT_RESULT.test('Connect result: no-connect'));
  assert.deepEqual(RESULT_NAMES.filter(connectMarks).sort(), ['already-pending', 'sent']);
  for (const [name, o] of Object.entries(OUTCOMES)) {
    assert.ok(o.text && !/—/.test(o.text), `${name} has words, without an em dash`);
  }
  assert.equal(OUTCOMES['email-needed'].text,
    'LinkedIn wants their email address before it sends this one. Use Connect to add them yourself.');
  assert.equal(OUTCOMES.sent.text, 'Request sent');
});

test('how an Auto job ended, in the page’s words: never "sent" without the scanner saying so', () => {
  assert.deepEqual(connectOutcome({ outcome: 'sent', exitCode: 0 }), { result: 'sent', ok: true, marks: true, text: 'Request sent' });
  assert.equal(connectOutcome({ outcome: 'unclear', exitCode: 0 }).marks, false);
  const crashed = connectOutcome({ exitCode: 1, failure: ['Traceback (most recent call last):', 'TimeoutError: page.goto'] });
  assert.equal(crashed.ok, false);
  assert.equal(crashed.marks, false);
  assert.match(crashed.text, /couldn’t finish, and nothing is marked as sent: .*TimeoutError/);
  assert.equal(connectOutcome({ exitCode: 0, outcome: 'made-up' }).result, null);
});

test('the route’s refusals: caps, profile views, an unreadable record, and who can’t be sent one', () => {
  const when = (ms) => `at ${ms}`;
  assert.equal(inviteRefusal({ invitesToday: 3, invitesWeek: 20, profilesLeftToday: 10 }), null);
  assert.equal(inviteRefusal({ invitesToday: 15, invitesWeek: 20, invitesFreeAt: 5 }, when),
    'Auto has sent 15 requests in the last 24 hours, its limit. The next one frees up at 5.');
  assert.match(inviteRefusal({ invitesToday: 2, invitesWeek: 80, invitesWeekFreeAt: 9 }, when), /80 requests in the last 7 days, its limit\. The next one frees up at 9\./);
  assert.match(inviteRefusal({ invitesToday: 0, invitesWeek: 0, profilesLeftToday: 0 }), /profile views are used/);
  assert.match(inviteRefusal({ unreadable: true }), /couldn’t be read/);

  const ada = { id: 'd2-ada', name: 'Ada Quill', degree: 2, profile_url: URL };
  assert.equal(personRefusal(ada), null);
  assert.deepEqual(personRefusal(null), { status: 400, error: 'That person could not be found.' });
  assert.deepEqual(personRefusal(ada, { connected: true }), { status: 409, error: 'Ada Quill is already one of your connections.' });
  assert.deepEqual(personRefusal({ ...ada, degree: 1 }), { status: 409, error: 'Ada Quill is already one of your connections.' });
  assert.deepEqual(personRefusal(ada, { requested: true }), { status: 409, error: 'A request to Ada Quill is already out.' });
  assert.equal(personRefusal({ ...ada, profile_url: null }).status, 400);
});

test('the one-time yes is a setting that travels with the data, and the words are Blake’s', () => {
  assert.equal(SETTINGS.autoConnectAccepted, AUTO_ACCEPTED_SETTING);
  assert.equal(AUTO_ACCEPTED_SETTING.default, null);
  assert.equal(AUTO_ACCEPTED_SETTING.parse('2026-10-03T21:00:00.000Z'), '2026-10-03T21:00:00.000Z');
  assert.equal(AUTO_ACCEPTED_SETTING.parse(null), null);
  assert.throws(() => AUTO_ACCEPTED_SETTING.parse('soon'), /date and time/);
  assert.equal(AUTO_CONFIRM, 'Auto sends connection requests from your LinkedIn account, one each time you press it. '
    + 'LinkedIn limits how many invitations an account can send, and may restrict accounts that send many.');
  assert.equal(AUTO_EXPLAIN, 'Sends the request for you from the scanner’s Chrome, without a note. Counts toward your LinkedIn usage.');
});

test('while Auto runs, every other Scan button says what it’s waiting for', async () => {
  const { busyReason } = await import('../lib/scraper-client.js');
  const { runningNow, busyRefusal } = await import('../lib/scan-state.js');
  assert.equal(busyReason({ running: true, action: 'connect', target: { id: 'd2-ada', name: 'Ada Quill' } }), 'A request to Ada Quill is being sent');
  assert.equal(busyReason({ running: true, action: 'connect', target: null }), 'A connection request is being sent');
  assert.equal(runningNow('connect'), 'A connection request is being sent');
  assert.equal(busyRefusal('Try again once it has finished.', 'connect'), 'A connection request is being sent. Try again once it has finished.');
});

// ── the record: Auto's requests are a third list, kept like the other two ────

test('charging a search or a profile view keeps Auto’s requests, and a damaged record counts the day as used', (t) => {
  const out = connect(t, `
record(invites=[NOW - 60, NOW - 3 * 86400])
ns['charge_linkedin']('searches')
ns['take_profile_view']()
out = {'act': activity(), 'left': ns['invites_left']()}
(home / 'linkedin-activity.json').write_text('{"searches": [1, 2')
out['damaged'] = ns['invites_left']()
`);
  if (!out) return;
  assert.equal(out.act.invites.length, 2, 'both requests are still on record');
  assert.equal(out.act.searches.length, 1);
  assert.equal(out.act.profiles.length, 1);
  assert.deepEqual(out.left, [14, 'day']);
  assert.deepEqual(out.damaged, [0, 'day'], 'a record that can’t be read leaves Auto nothing to send');
});

test('the app counts the same record: the last 24 hours, the last 7 days, an import merged in, and its checks', async () => {
  const { usage, linkedinState, budgetFileProblem, mergeBudgetFiles } = await import('../lib/linkedin-limits.js');
  const scratch = (name) => fs.mkdtempSync(path.join(os.tmpdir(), `six-degrees-auto-${name}-`));
  const dir = scratch('usage');
  const here = scratch('here');
  const from = scratch('from');
  const write = (where, data) => fs.writeFileSync(path.join(where, 'linkedin-activity.json'), typeof data === 'string' ? data : JSON.stringify(data));
  const read = (where) => JSON.parse(fs.readFileSync(path.join(where, 'linkedin-activity.json'), 'utf8'));
  try {
    const now = 1790000000000;
    const s = now / 1000;
    write(dir, { searches: [s - 60], profiles: [], invites: [s - 60, s - 7200, s - 3 * 86400, s - 9 * 86400] });
    const u = usage(dir, now);
    assert.equal(u.invitesToday, 2);
    assert.equal(u.invitesWeek, 3);

    const full = Array.from({ length: 15 }, (_, i) => s - 600 - i);
    write(dir, { searches: [], profiles: [], invites: full });
    const li = linkedinState(dir, now);
    assert.equal(li.invitesToday, 15);
    assert.equal(li.invitesFreeAt, (Math.min(...full) + 86400) * 1000, 'the oldest of the 15 frees the next');
    assert.match(inviteRefusal(li), /^Auto has sent 15 requests in the last 24 hours/);

    write(dir, '{"searches": [1');
    assert.equal(usage(dir, now).invitesToday, Infinity, 'unreadable: the day counts as used');
    assert.match(inviteRefusal(linkedinState(dir, now)), /couldn’t be read/);

    assert.equal(budgetFileProblem('linkedin-activity.json', { searches: [], profiles: [], invites: [s] }), null);
    assert.match(budgetFileProblem('linkedin-activity.json', { searches: [], profiles: [], invites: ['soon'] }), /not a list of times/);

    // Another computer's requests are merged in, not dropped, and a record from
    // before Auto keeps its old layout.
    write(here, { searches: [100], profiles: [], invites: [300] });
    write(from, { searches: [200], profiles: [], invites: [300, 400] });
    mergeBudgetFiles({ dir: here, from });
    assert.deepEqual(read(here), { searches: [100, 200], profiles: [], invites: [300, 400] });
    write(here, { searches: [100], profiles: [] });
    write(from, { searches: [200], profiles: [] });
    mergeBudgetFiles({ dir: here, from });
    assert.deepEqual(read(here), { searches: [100, 200], profiles: [] });
  } finally {
    for (const d of [dir, here, from]) fs.rmSync(d, { recursive: true, force: true });
  }
});
