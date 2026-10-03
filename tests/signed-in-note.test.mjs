// The scanner's note that you're signed in (scripts/scrape.py SIGNED_IN_FILE),
// which the Scan page's step 2 goes by (lib/scanner-setup.js signedInFrom).
// Before it, the page went by Chrome's cookie file, which Chrome makes the
// moment the scanner's window first opens: opening LinkedIn and closing the
// window without signing in ticked "Signed in".
//
// These run the scanner's own ensure_logged_in against a stand-in browser and
// clock, in a scratch SIX_DEGREES_HOME: nothing opens a browser or reaches
// LinkedIn, and a wait takes no time. The note is all that changed there:
// the same waits, the same answers, the same pushback.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PYTHON, noPython } from './python.mjs';
import { SIGNED_IN_FILE } from '../lib/scanner-setup.js';

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

class Clock:
    """time.time and time.sleep for the scanner: a wait moves the clock, instantly."""
    def __init__(self, t):
        self.t = t
        self.sleeps = 0
        self.on_sleep = None
    def time(self):
        return self.t
    def sleep(self, s):
        self.t += s
        self.sleeps += 1
        if self.on_sleep:
            self.on_sleep(self.sleeps)

clock = Clock(1790000000.0)
ns['time'] = clock

FEED = 'https://www.linkedin.com/feed/'
WALL = 'https://www.linkedin.com/authwall'
CHECK = 'https://www.linkedin.com/checkpoint/challenge/'

class Context:
    def __init__(self, signed_in):
        self.jar = [{'name': 'li_at', 'value': 'a-stand-in'}] if signed_in else []
        self.pages = []
    def cookies(self, url):
        return self.jar

class Page:
    """LinkedIn as the scanner sees it: the feed when signed in, a wall when not."""
    def __init__(self, context, landing=None):
        self.context = context
        self.url = 'about:blank'
        self.closed = False
        self.landing = landing
        context.pages.append(self)
    def goto(self, url, **_):
        self.url = self.landing or (FEED if self.context.jar else WALL)
    def is_closed(self):
        return self.closed
    def query_selector(self, _):
        return None

home = Path(ns['_home']())
NOTE = home / ns['SIGNED_IN_FILE']
def note():
    return json.loads(NOTE.read_text()) if NOTE.exists() else None

out = {}
exec(sys.argv[2])
print('RESULT ' + json.dumps(out))
`;

/** { out, log } from the case, or null when there is no Python here. */
function run(t, script) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'six-degrees-signed-in-'));
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

test('the scanner and the app name the same file', (t) => {
  const r = run(t, `out['file'] = ns['SIGNED_IN_FILE']`);
  if (!r) return;
  assert.equal(r.out.file, SIGNED_IN_FILE);
});

test('already signed in: the note says so, and the run goes straight on', (t) => {
  const r = run(t, `
ctx = Context(signed_in=True)
out['ok'] = ns['ensure_logged_in'](Page(ctx))
out['note'] = note()
out['sleeps'] = clock.sleeps
`);
  if (!r) return;
  assert.equal(r.out.ok, true);
  assert.deepEqual(r.out.note, { signedIn: true, at: 1790000002 });
  assert.equal(r.out.sleeps, 1, 'the one look it always had, no new wait');
});

test('the window closed before signing in: not signed in, though Chrome made its cookie file', (t) => {
  const r = run(t, `
ctx = Context(signed_in=False)
page = Page(ctx)
def close(n):
    if n >= 3:
        page.closed = True
clock.on_sleep = close
out['ok'] = ns['ensure_logged_in'](page)
out['note'] = note()
`);
  if (!r) return;
  assert.equal(r.out.ok, false);
  assert.equal(r.out.note.signedIn, false);
  assert.match(r.log, /Browser closed/);
});

test('signed in while it waits: not signed in during the wait, signed in once the session is confirmed', (t) => {
  const r = run(t, `
ctx = Context(signed_in=False)
page = Page(ctx)
during = []
def sign_in(n):
    during.append(note()['signedIn'] if note() else None)
    if n == 4:
        ctx.jar.append({'name': 'li_at', 'value': 'a-stand-in'})
        page.url = FEED
clock.on_sleep = sign_in
out['ok'] = ns['ensure_logged_in'](page)
out['note'] = note()
out['during'] = during
`);
  if (!r) return;
  assert.equal(r.out.ok, true);
  assert.equal(r.out.note.signedIn, true);
  // The first look comes before any note; every poll of the wait sees "not yet".
  assert.deepEqual(r.out.during, [null, false, false, false]);
  assert.match(r.log, /Signed in/);
});

test('LinkedIn pushing back mid-scan is what it was: a cooldown and a stop, with the note left alone', (t) => {
  const r = run(t, `
ns['_note_signed_in'](True)
before = note()
ctx = Context(signed_in=True)
try:
    ns['ensure_logged_in'](Page(ctx, landing=CHECK), stop_on_checkpoint=True)
    out['raised'] = None
except Exception as e:
    out['raised'] = type(e).__name__
out['same'] = note() == before
out['cooldown'] = (home / 'linkedin-cooldown.json').exists()
`);
  if (!r) return;
  assert.equal(r.out.raised, 'LinkedInPushedBack');
  assert.equal(r.out.same, true);
  assert.equal(r.out.cooldown, true);
});
