// The Paused list on the Scan page must name exactly the people "Resume all"
// will read — the same rules as the scanner's own queue. Invented names.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pausedList, nextPageToRead } from '../lib/paused.js';
import { PYTHON, noPython } from './python.mjs';

const SCRAPER = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'scripts', 'scrape.py');
const p = (id, url, extra = {}) => ({ id, name: `Person ${id}`, tier: 'A', profile_url: url, ...extra });

test('mapped before 0.1.6 (no note): paused at page 10, carries on at 11', () => {
  const list = pausedList([p('a', '/in/a')], new Set(['a']), {});
  assert.deepEqual(list.map((x) => [x.id, x.pagesRead, x.nextPage, x.legacy]), [['a', 10, 11, true]]);
});

test('a read cut short carries on from the next page; finished, hidden and page 100 are not paused', () => {
  const people = [p('a', '/in/a'), p('b', '/in/b'), p('c', '/in/c'), p('d', '/in/d')];
  const progress = {
    '/in/a': { pages: 27, more: true, at: '2026-09-24T03:19:57' },
    '/in/b': { pages: 34, more: false },
    '/in/c': { pages: 12, more: true, hidden: true },
    '/in/d': { pages: 100, more: true },
  };
  const list = pausedList(people, new Set(['a', 'b', 'c', 'd']), progress);
  assert.deepEqual(list.map((x) => [x.id, x.nextPage]), [['a', 28]]);
});

test('someone with a note but no saved circle still counts as mapped', () => {
  // Every result on their pages was already your own connection, so nothing
  // was saved — they must not be read again from page 1.
  const list = pausedList([p('a', '/in/a')], new Set(), { '/in/a': { pages: 10, more: true } });
  assert.deepEqual(list.map((x) => x.nextPage), [11]);
});

test('not mapped at all is not paused', () => {
  assert.deepEqual(pausedList([p('a', '/in/a')], new Set(), {}), []);
});

test('newest connection first, and repeatedly unclear people are flagged', () => {
  const people = [p('old', '/in/old', { connected_date: '2025-01-01' }), p('new', '/in/new', { connected_date: '2026-09-22' })];
  const list = pausedList(people, new Set(['old', 'new']), {}, { '/in/old': { n: 2 } });
  assert.deepEqual(list.map((x) => [x.id, x.unclear]), [['new', 0], ['old', 2]]);
});

test('nextPageToRead matches the scanner, case by case', (t) => {
  const cases = [null, { pages: 25, more: true }, { pages: 37, more: false }, { pages: 12, more: true, hidden: true },
    { pages: 99, more: true }, { pages: 100, more: true }, { pages: 0, more: true }];
  const lift = `
import ast, json, sys
tree = ast.parse(open(sys.argv[1]).read())
body = [n for n in tree.body if (isinstance(n, ast.FunctionDef) and n.name == 'next_page_to_read')
        or (isinstance(n, ast.Assign) and any(getattr(x, 'id', '') in ('LINKEDIN_MAX_PAGES', 'LEGACY_PAGES_READ') for x in n.targets))]
ns = {}
exec(compile(ast.Module(body=body, type_ignores=[]), 'scrape.py', 'exec'), ns)
print(json.dumps([ns['next_page_to_read'](c) for c in json.loads(sys.argv[2])]))
`;
  const r = spawnSync(PYTHON, ['-c', lift, SCRAPER, JSON.stringify(cases)], { encoding: 'utf8' });
  if (noPython(t, r)) return;
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(JSON.parse(r.stdout), cases.map(nextPageToRead));
});
