// Every piece of JavaScript scrape.py injects into LinkedIn must at least parse.
//
// The snippets live inside Python strings, and a plain Python string rewrites
// backslash escapes before the browser ever sees them: the "\n" in split('\n')
// becomes a real line break and the function is a syntax error. One did exactly
// that and broke every 2nd-degree scan on page 1 for two weeks (TRAPS §31).
//
// This asks Python for each snippet exactly as it would send it — every string
// passed to page.evaluate / wait_for_function, and every *_JS constant used that
// way — and parses each with V8. It needs no browser and no LinkedIn.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PYTHON, noPython } from './python.mjs';

const SCRAPER = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'scripts', 'scrape.py');

const DUMP = `
import ast, json, sys
tree = ast.parse(open(sys.argv[1]).read())
consts = {}
for node in ast.walk(tree):
    if isinstance(node, ast.Assign) and isinstance(node.value, ast.Constant) and isinstance(node.value.value, str):
        for t in node.targets:
            if isinstance(t, ast.Name) and t.id.endswith('_JS'):
                consts[t.id] = (node.value.value, node.lineno)
out, seen = [], set()
for node in ast.walk(tree):
    if isinstance(node, ast.Call) and isinstance(node.func, ast.Attribute) \\
            and node.func.attr in ('evaluate', 'wait_for_function') and node.args:
        a = node.args[0]
        if isinstance(a, ast.Constant) and isinstance(a.value, str):
            item = {'line': node.lineno, 'js': a.value}
        elif isinstance(a, ast.Name) and a.id in consts:
            item = {'line': consts[a.id][1], 'js': consts[a.id][0], 'name': a.id}
        else:
            continue
        if item['line'] not in seen:
            seen.add(item['line'])
            out.append(item)
print(json.dumps(out))
`;

// A snippet is either a function ("() => {...}") or a bare expression.
function parses(js) {
  let last = null;
  for (const wrap of [(s) => `(${s})`, (s) => s]) {
    try { new vm.Script(wrap(js)); return null; } catch (err) { last = err.message; }
  }
  return last;
}

test('every JavaScript snippet scrape.py injects is valid JavaScript', (t) => {
  const run = spawnSync(PYTHON, ['-c', DUMP, SCRAPER], { encoding: 'utf8' });
  if (noPython(t, run)) return;
  assert.equal(run.status, 0, run.stderr);

  const snippets = JSON.parse(run.stdout);
  assert.ok(snippets.length >= 10, `expected to find the scraper's snippets, found ${snippets.length}`);

  const broken = snippets
    .map((s) => ({ where: `scrape.py:${s.line}${s.name ? ` (${s.name})` : ''}`, error: parses(s.js) }))
    .filter((s) => s.error);
  assert.deepEqual(broken, [], 'a snippet does not parse — is it missing the r in r"""?');
});

test('the check itself catches the bug it exists for', () => {
  // What Python delivers for split('\n') inside a plain string.
  assert.ok(parses("() => 'a b'.split('\n')"));
  assert.equal(parses("() => 'a b'.split('\\n')"), null);
});
