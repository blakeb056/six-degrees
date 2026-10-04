// Auto scan rests two days after any check from LinkedIn (scrape.py scrape_bridge).
//
// The Scan page's Experimental box promises "two days' rest after any check
// from LinkedIn", and AUTO_PUSHBACK_REST says the same. A check at the start of
// a run (ensure_logged_in) kept it; a pushback partway through reading a list
// set one day, as for a scan you start yourself. Found 2026-10-03 while
// building Settings → LinkedIn usage, which shows this rule.
//
// These run the real scrape_bridge, lifted out of scrape.py without its imports,
// with the browser and LinkedIn's answer stubbed: nothing opens, and every
// person is invented. Against a scratch SIX_DEGREES_HOME.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PYTHON, noPython } from './python.mjs';

const SCRAPER = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'scripts', 'scrape.py');

const LIFT = `
import ast, json, os, sys, types
from datetime import datetime
from pathlib import Path
tree = ast.parse(open(sys.argv[1]).read())
names = {'scrape_bridge', '_read', '_skips_path', 'load_bridge_skips', 'record_bridge_skip', 'next_page_to_read'}
classes = {'BridgeRead'}
consts = {'LINKEDIN_MAX_PAGES', 'LEGACY_PAGES_READ', 'DAY_SECONDS', 'AUTO_PUSHBACK_REST'}
body = [n for n in tree.body
        if (isinstance(n, ast.FunctionDef) and n.name in names)
        or (isinstance(n, ast.ClassDef) and n.name in classes)
        or (isinstance(n, ast.Assign) and any(isinstance(t, ast.Name) and t.id in consts for t in n.targets))]
found = {n.name for n in body if isinstance(n, (ast.FunctionDef, ast.ClassDef))}
assert found == names | classes, sorted((names | classes) - found)

case = json.loads(sys.argv[2])
cooldowns = []

class Page:
    def set_default_timeout(self, ms): pass
    def set_default_navigation_timeout(self, ms): pass
class Browser:
    pages = [Page()]
    def close(self): pass
class Playwright:
    def __init__(self): self.chromium = self
    def launch_persistent_context(self, **kw): return Browser()
    def __enter__(self): return self
    def __exit__(self, *a): return False
api = types.ModuleType('playwright.sync_api')
api.sync_playwright = Playwright
sys.modules['playwright'] = types.ModuleType('playwright')
sys.modules['playwright.sync_api'] = api

class Quit(Exception):
    def __init__(self, *a, **kw): super().__init__(*a)
ns = {'json': json, 'os': os, 'Path': Path, 'datetime': datetime, '_active_user_id': 'me',
      'EXPERIMENT': {'on': case['experimental'], 'pages': 0, 'wire': 0}}
for exc in ('SaveFailed', 'NotSignedIn', 'LinkedInPushedBack', 'CoolingDown', 'BudgetReached', 'SearchLimitReached'):
    ns[exc] = type(exc, (Quit,), {})
URL = 'https://www.linkedin.com/in/ada-quill'
ns.update({
    'read_cooldown': lambda: None,
    'searches_left': lambda: (50, 'daily'),
    'profiles_left': lambda: 5,
    'budget_message': lambda kind: kind,
    'read_connections': lambda params=None: [{'id': 'c1', 'name': 'Ada Quill', 'profile_url': URL}],
    'forget_bridge_progress': lambda url: None,
    'load_bridge_progress': lambda: {},
    'record_bridge_progress': lambda *a: None,
    'mark_bridge_hidden': lambda url, name: None,
    'push_connections': lambda *a, **kw: None,
    'get_scraper_profile_path': lambda: '/nonexistent',
    # Every launch goes through launch_chrome (tests/chrome-launch.test.mjs): here, the stand-in browser.
    'launch_chrome': lambda p, headless=False, sign_in=False: p.chromium.launch_persistent_context(),
    'ensure_logged_in': lambda page, **kw: True,
    'stop_requested': lambda: False,
    # LinkedIn pushed back partway through the list: nothing read, nothing concluded.
    '_scrape_one_bridge': lambda *a, **kw: ([], 'unclear', {
        'last': 3, 'more': True, 'urn': None, 'found': 0, 'limited': False,
        'pushed_back': True, 'pushback_reason': 'a security check'}),
    'set_cooldown': lambda **kw: cooldowns.append(kw),
})
exec(compile(ast.Module(body=body, type_ignores=[]), 'scrape.py', 'exec'), ns)
raised = None
try:
    ns['scrape_bridge']('Ada Quill', profile_url=URL)
except Quit as e:
    raised = type(e).__name__
print(json.dumps({'raised': raised, 'cooldowns': cooldowns,
                  'day': ns['DAY_SECONDS'], 'auto': ns['AUTO_PUSHBACK_REST']}))
`;

/** { raised, cooldowns, day, auto } after one pushed-back read, or null when python3 is missing. */
function pushedBack(t, experimental) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'six-degrees-auto-rest-'));
  const r = spawnSync(PYTHON, ['-c', LIFT, SCRAPER, JSON.stringify({ experimental })], {
    encoding: 'utf8',
    env: { ...process.env, SIX_DEGREES_HOME: home },
  });
  fs.rmSync(home, { recursive: true, force: true });
  if (noPython(t, r)) return null;
  assert.equal(r.status, 0, r.stderr);
  return JSON.parse(r.stdout.trim().split('\n').pop());
}

test('Auto scan: a pushback partway through a list rests two days, as the Scan page says', (t) => {
  const out = pushedBack(t, true);
  if (!out) return;
  assert.equal(out.raised, 'LinkedInPushedBack');
  assert.equal(out.auto, 2 * 24 * 3600);
  assert.equal(out.cooldowns.length, 1);
  assert.equal(out.cooldowns[0].seconds, out.auto);
  assert.match(out.cooldowns[0].reason, /LinkedIn pushed back: a security check/);
});

test('a scan you start yourself still rests one day after a pushback partway through', (t) => {
  const out = pushedBack(t, false);
  if (!out) return;
  assert.equal(out.raised, 'LinkedInPushedBack');
  assert.equal(out.cooldowns.length, 1);
  assert.equal(out.cooldowns[0].seconds, out.day);
});
