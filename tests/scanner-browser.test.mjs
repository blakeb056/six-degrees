// The scanner's in-page readers in a real Chrome, on invented pages
// (tests/fixtures/linkedin/): the random scroll and the wait for a lazily loaded
// list (settle_list), the reader as always (BRIDGE_RESULTS_JS), and Read
// profiles' Experience reader (EXPERIENCE_JS). A local file, never LinkedIn.
//
// It needs a Python with Playwright and Google Chrome, so it runs only when
// SIX_DEGREES_PLAYWRIGHT_PYTHON names one, and is skipped otherwise (CI has
// neither): `SIX_DEGREES_PLAYWRIGHT_PYTHON=/path/to/python npm test`. What CI
// runs instead is the same code against stand-in pages (tests/pacing.test.mjs,
// tests/experience.test.mjs).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const SCRAPER = path.join(here, '..', 'scripts', 'scrape.py');
const FIXTURES = path.join(here, 'fixtures', 'linkedin');
const PY = process.env.SIX_DEGREES_PLAYWRIGHT_PYTHON;

const SCRIPT = `
import ast, json, sys, types, random
tree = ast.parse(open(sys.argv[1]).read())
skip = lambda n: (isinstance(n, ast.If)
                  or (isinstance(n, ast.Import) and any(a.name == 'requests' for a in n.names))
                  or (isinstance(n, ast.ImportFrom) and n.module == 'image_store'))
ns = {'__name__': 'scrape', '__file__': sys.argv[1]}
exec(compile(ast.Module(body=[n for n in tree.body if not skip(n)], type_ignores=[]), 'scrape.py', 'exec'), ns)
ns['BACKOFF'] = (0.2, 0.2, 0.2, 0.2)       # the curve's shape is tested elsewhere; here, quickly
from playwright.sync_api import sync_playwright
url = lambda name, q='': ${JSON.stringify(pathToFileURL(FIXTURES).href)} + '/' + name + q
out = {}
with sync_playwright() as p:
    browser = p.chromium.launch(channel='chrome', headless=True)
    page = browser.new_page(viewport={'width': 1300, 'height': 860})
    rng = random.Random(11)

    page.goto(url('results-lazy.html'))
    page.wait_for_selector('a[href*="/in/"]')
    out['before'] = len(page.evaluate(ns['BRIDGE_RESULTS_JS']))
    out['settle'] = ns['settle_list'](page, rng)
    out['after'] = [c['name'] for c in page.evaluate(ns['BRIDGE_RESULTS_JS'])]
    page.goto(url('results-lazy.html'))
    page.wait_for_selector('a[href*="/in/"]')
    out['gently'] = len(ns['_read_page_gently'](page))

    page.goto(url('results-lazy.html', '?never'))
    out['never_settle'] = ns['settle_list'](page, rng)
    got = ns['read_with_backoff'](page, lambda pg: (pg.evaluate(ns['BRIDGE_RESULTS_JS']) or None), 'The page', rng=rng)
    out['never'] = [got[0], got[2]]

    page.goto(url('profile-experience.html'))
    out['before_scroll'] = page.evaluate(ns['EXPERIENCE_JS'])['found']
    ns['_scroll_profile'](page, rng)
    page.wait_for_timeout(400)
    dom = page.evaluate(ns['EXPERIENCE_JS'])
    out['dom'] = dom
    out['roles'] = ns['roles_from_items'](dom['items'])

    page.goto(url('profile-changed.html'))
    ns['_scroll_profile'](page, rng)
    dom = page.evaluate(ns['EXPERIENCE_JS'])
    out['changed'] = [dom['found'], ns['roles_from_items'](dom['items'])]
    browser.close()
print('RESULT ' + json.dumps(out))
`;

test('in a real Chrome: a lazy list is read in full, a list that never comes is said, and the Experience section is read', (t) => {
  if (!PY) return t.skip('SIX_DEGREES_PLAYWRIGHT_PYTHON is not set (a Python with Playwright, and Chrome)');
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'six-degrees-browser-'));
  const r = spawnSync(PY, ['-c', SCRIPT, SCRAPER], { encoding: 'utf8', env: { ...process.env, SIX_DEGREES_HOME: home }, timeout: 120000 });
  fs.rmSync(home, { recursive: true, force: true });
  assert.equal(r.status, 0, r.stderr);
  const out = JSON.parse(r.stdout.trimEnd().split('\n').pop().replace(/^RESULT /, ''));

  assert.equal(out.before, 7, 'seven at first');
  assert.equal(out.settle.seen, true);
  assert.equal(out.settle.settled, true, `the list stopped growing (${JSON.stringify(out.settle)})`);
  assert.deepEqual(out.after, Array.from({ length: 10 }, (_, i) => `Invented Person ${i + 1}`), 'all ten, after the scroll');
  assert.equal(out.gently, 10, 'the gentle read: everyone the old read sees, and the late three');

  assert.equal(out.never_settle.seen, false, 'no list ever appeared');
  assert.deepEqual(out.never, ['unread', 4], 'tried four more times, then said it couldn\'t be read');

  assert.equal(out.before_scroll, false, 'the Experience section loads only once the page scrolls');
  assert.equal(out.dom.found, true);
  assert.equal(out.dom.how, 'heading');
  assert.equal(out.dom.showAll, 6);
  assert.deepEqual(out.roles, [
    { title: 'Vice President, Engineering', company: 'Quillon Labs', start: '2022-03', end: null, current: true },
    { title: 'Director of Platform', company: 'Brightwater Analytics', start: '2020-01', end: '2022-02', current: false },
    { title: 'Senior Engineering Manager', company: 'Brightwater Analytics', start: '2017-06', end: '2019-12', current: false },
    { title: 'Software Engineer', company: 'Hollowfield Systems', start: '2012', end: '2017', current: false },
  ]);
  assert.deepEqual(out.changed, [false, []], 'a page it can\'t make sense of: nothing found, nothing made up');
});
