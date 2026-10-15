// How far each person's connections have been read (scrape.py, TRAPS §34).
//
// A whole list can be a hundred pages, so reads stop part-way — the Stop button,
// LinkedIn's monthly search limit, a crash — and the next run carries on from
// the page after the last one saved. Get this wrong and a list is either read
// again from page 1 forever, or marked finished with pages never read.
//
// These run the real functions from scrape.py without its imports (requests,
// Playwright), by lifting just them out of the file, against a scratch
// SIX_DEGREES_HOME.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PYTHON, noPython } from './python.mjs';
import { SCRAPER, noScanner } from './helpers/scanner.mjs';

const LIFT = `
import ast, json, os, sys
from datetime import datetime
from pathlib import Path
from urllib.parse import parse_qs, urlparse
tree = ast.parse(open(sys.argv[1]).read())
names = {'_progress_path', '_progress_owner', '_read_progress_file', 'load_bridge_progress',
         '_change_progress', 'record_bridge_progress', 'mark_bridge_hidden',
         'forget_bridge_progress', 'next_page_to_read', '_url_page',
         '_page_runs', 'pages_known_read', '_read_through'}
consts = {'LINKEDIN_MAX_PAGES', 'LEGACY_PAGES_READ', '_LIST_TOTALS', '_LIST_CARDS', '_PAGES_READ'}
body = [n for n in tree.body
        if (isinstance(n, ast.FunctionDef) and n.name in names)
        or (isinstance(n, ast.Assign) and any(isinstance(t, ast.Name) and t.id in consts for t in n.targets))]
found = {n.name for n in body if isinstance(n, ast.FunctionDef)}
assert found == names, sorted(names - found)
ns = {'json': json, 'os': os, 'Path': Path, 'datetime': datetime,
      'parse_qs': parse_qs, 'urlparse': urlparse, '_active_user_id': 'me'}
exec(compile(ast.Module(body=body, type_ignores=[]), 'scrape.py', 'exec'), ns)
exec(sys.argv[2], ns)
`;

function run(script) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'six-degrees-progress-'));
  const r = spawnSync(PYTHON, ['-c', LIFT, SCRAPER, script], {
    encoding: 'utf8',
    env: { ...process.env, SIX_DEGREES_HOME: home },
  });
  fs.rmSync(home, { recursive: true, force: true });
  return r;
}

/** { value } from the script's printed JSON, or null when python3 is missing. */
function results(t, script) {
  if (noScanner(t)) return null;
  const r = run(script);
  if (noPython(t, r)) return null;
  assert.equal(r.status, 0, r.stderr);
  return { value: JSON.parse(r.stdout) };
}

const A = 'https://www.linkedin.com/in/someone/';

test('someone mapped before any record was kept carries on from page 11', (t) => {
  const out = results(t, 'print(json.dumps(next_page_to_read(None)))');
  if (out) assert.equal(out.value, 11);
});

test('a read that stopped with more to go carries on from the next page', (t) => {
  const out = results(t, `
record_bridge_progress('${A}', 'Someone', 25, True, 'URN1')
e = load_bridge_progress()['${A}']
print(json.dumps([next_page_to_read(e), e['urn'], e['more']]))`);
  if (out) assert.deepEqual(out.value, [26, 'URN1', true]);
});

test('a finished list is never read again', (t) => {
  const out = results(t, `
record_bridge_progress('${A}', 'Someone', 37, False)
print(json.dumps(next_page_to_read(load_bridge_progress()['${A}'])))`);
  if (out) assert.equal(out.value, null);
});

test('a shorter read from page 1 does not wind back a deeper one', (t) => {
  // The pages past it are still saved, so reading them again would be waste.
  const out = results(t, `
record_bridge_progress('${A}', 'Someone', 40, True, 'URN1')
record_bridge_progress('${A}', 'Someone', 10, True)
e = load_bridge_progress()['${A}']
print(json.dumps([e['pages'], e['more'], e['urn']]))`);
  if (out) assert.deepEqual(out.value, [40, true, 'URN1']);
});

test('carrying on to the end marks the list finished', (t) => {
  const out = results(t, `
record_bridge_progress('${A}', 'Someone', 10, True)
record_bridge_progress('${A}', 'Someone', 10, False)
print(json.dumps(next_page_to_read(load_bridge_progress()['${A}'])))`);
  if (out) assert.equal(out.value, null);
});

test('a list gone hidden is left alone unless hidden ones are retried', (t) => {
  const out = results(t, `
mark_bridge_hidden('${A}', 'Someone')
e = load_bridge_progress()['${A}']
print(json.dumps([next_page_to_read(e), next_page_to_read(e, retry_hidden=True)]))`);
  if (out) assert.deepEqual(out.value, [null, 11]);
});

test('reading them again clears hidden', (t) => {
  const out = results(t, `
mark_bridge_hidden('${A}', 'Someone')
record_bridge_progress('${A}', 'Someone', 12, True)
e = load_bridge_progress()['${A}']
print(json.dumps(['hidden' in e, next_page_to_read(e)]))`);
  if (out) assert.deepEqual(out.value, [false, 13]);
});

test('re-mapping from scratch forgets how far the old read went', (t) => {
  const out = results(t, `
record_bridge_progress('${A}', 'Someone', 60, True)
forget_bridge_progress('${A}')
record_bridge_progress('${A}', 'Someone', 5, False)
print(json.dumps(load_bridge_progress()['${A}']['pages']))`);
  if (out) assert.equal(out.value, 5);
});

test('LinkedIn stops at page 100, so there is no page 101 to carry on from', (t) => {
  const out = results(t, `
record_bridge_progress('${A}', 'Someone', 100, True)
print(json.dumps(next_page_to_read(load_bridge_progress()['${A}'])))`);
  if (out) assert.equal(out.value, null);
});

test('each profile in the app keeps its own record', (t) => {
  const out = results(t, `
record_bridge_progress('${A}', 'Someone', 30, True)
_active_user_id = 'someone-else'
print(json.dumps(load_bridge_progress()))`);
  if (out) assert.deepEqual(out.value, {});
});

test('the page number is read from a search URL', (t) => {
  const out = results(t, `print(json.dumps([
  _url_page('https://www.linkedin.com/search/results/people/?connectionOf=%5B%22X%22%5D&page=12'),
  _url_page('https://www.linkedin.com/search/results/people/?connectionOf=%5B%22X%22%5D'),
  _url_page('https://www.linkedin.com/search/results/people/?page=abc')]))`);
  if (out) assert.deepEqual(out.value, [12, 1, 1]);
});

// ── Every page read, not only the bookmark (readPages, 2026-10-14) ───────────
// Blake read pages 2 to 14 of someone's list and never page 1 (the list had opened on
// page 2). The bookmark only moves through pages read in order from page 1, so it said
// "through page 0", and the 13 pages were forgotten. readPages keeps them; reading page
// 1 later moves the bookmark straight to 14. A page never read is never in it.

test('pages read past a gap are kept, as runs, and the bookmark stays before the gap', (t) => {
  const out = results(t, `
_PAGES_READ['${A}'] = set(range(2, 15))
record_bridge_progress('${A}', 'Someone', 0, True, 'URN1')
e = load_bridge_progress()['${A}']
print(json.dumps([e['pages'], e['more'], e.get('readPages'), next_page_to_read(e)]))`);
  if (out) assert.deepEqual(out.value, [0, true, [[2, 14]], 1]);
});

test('reading page 1 after pages 2 to 14 moves the bookmark to 14, and the note is plain again', (t) => {
  const out = results(t, `
_PAGES_READ['${A}'] = set(range(2, 15))
record_bridge_progress('${A}', 'Someone', 0, True, 'URN1')
_PAGES_READ['${A}'] = {1}
record_bridge_progress('${A}', 'Someone', 1, True)
e = load_bridge_progress()['${A}']
print(json.dumps([e['pages'], e['more'], 'readPages' in e, next_page_to_read(e)]))`);
  if (out) assert.deepEqual(out.value, [14, true, false, 15]);
});

test('more than one gap: each run is kept, and filling one moves the bookmark to the next gap', (t) => {
  const out = results(t, `
_PAGES_READ['${A}'] = {1, 2, 4, 5, 8}
record_bridge_progress('${A}', 'Someone', 2, True)
first = load_bridge_progress()['${A}']
_PAGES_READ['${A}'] = {3}
record_bridge_progress('${A}', 'Someone', 0, True)
second = load_bridge_progress()['${A}']
print(json.dumps([first['pages'], first['readPages'], second['pages'], second['readPages']]))`);
  if (out) assert.deepEqual(out.value, [2, [[1, 2], [4, 5], [8, 8]], 5, [[1, 5], [8, 8]]]);
});

test('a note from before readPages reads as pages 1 through its bookmark, as before', (t) => {
  const out = results(t, `
p = _progress_path()
p.write_text(json.dumps({'me': {'${A}': {'name': 'Someone', 'pages': 6, 'more': True, 'urn': 'URN1'}}}))
e = load_bridge_progress()['${A}']
known = sorted(pages_known_read(e))
_PAGES_READ['${A}'] = {7, 8}
record_bridge_progress('${A}', 'Someone', 8, True)
after = load_bridge_progress()['${A}']
print(json.dumps([known, next_page_to_read(e), after['pages'], 'readPages' in after, sorted(pages_known_read(None))]))`);
  if (out) assert.deepEqual(out.value, [[1, 2, 3, 4, 5, 6], 7, 8, false, []]);
});

test('deleting their circle forgets the pages read too', (t) => {
  const out = results(t, `
_PAGES_READ['${A}'] = set(range(2, 15))
record_bridge_progress('${A}', 'Someone', 0, True)
forget_bridge_progress('${A}')
_PAGES_READ.clear()
record_bridge_progress('${A}', 'Someone', 1, True)
e = load_bridge_progress()['${A}']
print(json.dumps([e['pages'], 'readPages' in e]))`);
  if (out) assert.deepEqual(out.value, [1, false]);
});

test('readPages stays within the 100 pages LinkedIn shows, and a damaged one is read as far as it makes sense', (t) => {
  const out = results(t, `
_PAGES_READ['${A}'] = {0, 3, 99, 100, 101, 250}
record_bridge_progress('${A}', 'Someone', 0, True)
e = load_bridge_progress()['${A}']
odd = {'pages': 2, 'readPages': [[5, 6], 9, 'x', [None, 3], [98, 400]]}
print(json.dumps([e.get('readPages'), sorted(pages_known_read(odd))]))`);
  if (out) assert.deepEqual(out.value, [[[3, 3], [99, 100]], [1, 2, 5, 6, 9, 98, 99, 100]]);
});
