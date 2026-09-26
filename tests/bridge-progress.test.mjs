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
import { fileURLToPath } from 'node:url';
import { PYTHON, noPython } from './python.mjs';

const SCRAPER = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'scripts', 'scrape.py');

const LIFT = `
import ast, json, os, sys
from datetime import datetime
from pathlib import Path
from urllib.parse import parse_qs, urlparse
tree = ast.parse(open(sys.argv[1]).read())
names = {'_progress_path', '_progress_owner', '_read_progress_file', 'load_bridge_progress',
         '_change_progress', 'record_bridge_progress', 'mark_bridge_hidden',
         'forget_bridge_progress', 'next_page_to_read', '_url_page'}
consts = {'LINKEDIN_MAX_PAGES', 'LEGACY_PAGES_READ'}
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
