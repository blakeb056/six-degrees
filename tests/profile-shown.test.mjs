// "Did their profile really render?" decides whether someone is marked hidden
// for good (TRAPS §35). It once matched a first name anywhere in the tab title
// — and every tab is titled LinkedIn, so "Li", "Lin" or "Ed" matched a blank
// page. This runs the exact snippet scrape.py sends, against fake pages.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRAPER = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'scripts', 'scrape.py');
const GET = `
import ast, json, sys
for node in ast.walk(ast.parse(open(sys.argv[1]).read())):
    if isinstance(node, ast.Assign) and any(getattr(t, 'id', '') == 'PROFILE_SHOWN_JS' for t in node.targets):
        print(json.dumps(node.value.value))
`;

function shown(t, name, title, heading) {
  const run = spawnSync('python3', ['-c', GET, SCRAPER], { encoding: 'utf8' });
  if (run.error) { t.skip('python3 is not available here'); return null; }
  const js = JSON.parse(run.stdout);
  const document = {
    title,
    querySelector: () => (heading == null ? null : { innerText: heading }),
  };
  return vm.runInNewContext(`(${js})(${JSON.stringify(name)})`, { document });
}

test('a blank LinkedIn page is not anyone\'s profile, however short their name', (t) => {
  for (const name of ['Li Wei', 'Lin Zhang', 'Ed Harris', 'Di Wang', 'Ke Chen']) {
    for (const title of ['LinkedIn', '(3) LinkedIn', 'Feed | LinkedIn']) {
      const r = shown(t, name, title, null);
      if (r === null) return;
      assert.equal(r, false, `${name} / ${title}`);
    }
  }
});

test('their name in the heading or the title means the profile rendered', (t) => {
  const cases = [
    ['Li Wei', 'LinkedIn', 'Li Wei'],
    ['Ed Harris', '(2) Ed Harris | LinkedIn', null],
    ['Ada Quill', 'Ada Quill | LinkedIn', ''],
    ['José Nuñez', 'José Nuñez | LinkedIn', null],
  ];
  for (const [name, title, heading] of cases) {
    const r = shown(t, name, title, heading);
    if (r === null) return;
    assert.equal(r, true, `${name} / ${title}`);
  }
});

test('a name inside a longer word does not count', (t) => {
  const r = shown(t, 'Ed Harris', 'Edwina Park | LinkedIn', 'Edwina Park');
  if (r === null) return;
  assert.equal(r, false);
});
