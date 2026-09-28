// A one-person scan that finds a hidden list notes it (scrape.py scrape_bridge).
//
// Only the batch (auto_bridge_all) used to write bridge-skips.json. A card's
// Scan or Rescan, which read from page 1, found the list hidden, printed it and
// recorded nothing: the person stayed "not scanned yet" and was offered again
// on every look, the queue-by-absence of TRAPS §15. The note is now made where
// the read ends, so every way in makes it.
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
consts = {'LINKEDIN_MAX_PAGES', 'LEGACY_PAGES_READ'}
body = [n for n in tree.body
        if (isinstance(n, ast.FunctionDef) and n.name in names)
        or (isinstance(n, ast.ClassDef) and n.name in classes)
        or (isinstance(n, ast.Assign) and any(isinstance(t, ast.Name) and t.id in consts for t in n.targets))]
found = {n.name for n in body if isinstance(n, (ast.FunctionDef, ast.ClassDef))}
assert found == names | classes, sorted((names | classes) - found)

case = json.loads(sys.argv[2])
calls = {'hidden': [], 'progress': []}

# The browser: opened, handed to the (stubbed) reader, closed. Nothing loads.
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
ns = {'json': json, 'os': os, 'Path': Path, 'datetime': datetime, '_active_user_id': 'me'}
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
    'load_bridge_progress': lambda: case.get('progress', {}),
    'record_bridge_progress': lambda *a: calls['progress'].append(a[0]),
    'mark_bridge_hidden': lambda url, name: calls['hidden'].append(url),
    'push_connections': lambda *a, **kw: None,
    'get_scraper_profile_path': lambda: '/nonexistent',
    'ensure_logged_in': lambda page, **kw: True,
    'stop_requested': lambda: case.get('stop', False),
    '_scrape_one_bridge': lambda *a, **kw: ([], case['status'], {'last': 0, 'more': False, 'urn': None,
                                                                  'found': 0, 'limited': False}),
    'set_cooldown': lambda **kw: None,
})
exec(compile(ast.Module(body=body, type_ignores=[]), 'scrape.py', 'exec'), ns)
result = ns['scrape_bridge']('Ada Quill', deeper=case.get('deeper', False))
print(json.dumps({'status': getattr(result, 'status', None), 'skips': ns['load_bridge_skips'](),
                  'hidden': calls['hidden']}))
`;

/** { status, skips, hidden } after one scrape_bridge, or null when python3 is missing. */
function scan(t, c) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'six-degrees-one-scan-'));
  const r = spawnSync(PYTHON, ['-c', LIFT, SCRAPER, JSON.stringify(c)], {
    encoding: 'utf8',
    env: { ...process.env, SIX_DEGREES_HOME: home },
  });
  fs.rmSync(home, { recursive: true, force: true });
  if (noPython(t, r)) return null;
  assert.equal(r.status, 0, r.stderr);
  return JSON.parse(r.stdout.trim().split('\n').pop());
}

const URL = 'https://www.linkedin.com/in/ada-quill';

test('a scan from page 1 that finds their list hidden notes it, as a batch would', (t) => {
  const out = scan(t, { status: 'private' });
  if (!out) return;
  assert.equal(out.status, 'private');
  assert.deepEqual(Object.keys(out.skips), [URL]);
  assert.equal(out.skips[URL].name, 'Ada Quill');
  assert.equal(out.skips[URL].reason, 'no visible connections');
});

test('LinkedIn showing no one in their list is noted too', (t) => {
  const out = scan(t, { status: 'empty' });
  if (!out) return;
  assert.equal(out.skips[URL].reason, 'LinkedIn showed no one in their list');
});

test('a profile that never rendered notes nothing: that says nothing about them', (t) => {
  const out = scan(t, { status: 'unclear' });
  if (!out) return;
  assert.deepEqual(out.skips, {});
});

test('a stop that lands as the answer comes concludes nothing', (t) => {
  const out = scan(t, { status: 'private', stop: true });
  if (!out) return;
  assert.equal(out.status, 'stopped');
  assert.deepEqual(out.skips, {});
});

test('carrying on with a list that has gone hidden keeps what is mapped, and skips no one', (t) => {
  const out = scan(t, { status: 'private', deeper: true, progress: { [URL]: { pages: 20, more: true } } });
  if (!out) return;
  assert.deepEqual(out.hidden, [URL]);
  assert.deepEqual(out.skips, {});
});
