// A circle scan keeps LinkedIn's own count of the mutual connections you share
// with each person: the line under their result card, "Maya Chen and 23 other
// mutual connections". These run the real page reader (scrape.py
// BRIDGE_RESULTS_JS, exactly as Python sends it) against a small fake results
// page, and pin the line's every English form. Nothing here opens LinkedIn;
// the wording is LinkedIn's, the people invented.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PYTHON, noPython } from './python.mjs';
import { mutualCountOf } from '../lib/ingest.js';

const SCRAPER = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'scripts', 'scrape.py');

// The snippet as Python delivers it (a raw string, read through the AST).
function reader(t) {
  const run = spawnSync(PYTHON, ['-c', `
import ast, json, sys
tree = ast.parse(open(sys.argv[1]).read())
for node in ast.walk(tree):
    if isinstance(node, ast.Assign) and any(isinstance(t, ast.Name) and t.id == 'BRIDGE_RESULTS_JS' for t in node.targets):
        print(json.dumps(node.value.value))
`, SCRAPER], { encoding: 'utf8' });
  if (noPython(t, run)) return null;
  assert.equal(run.status, 0, run.stderr);
  return JSON.parse(run.stdout);
}

// Just the line parser, cut out between its markers.
function parser(js) {
  const start = js.indexOf('// mutualCount: begin');
  const end = js.indexOf('// mutualCount: end');
  assert.ok(start > 0 && end > start, 'the markers are there');
  return vm.runInNewContext(`(() => { ${js.slice(start, end)}; return mutualCount; })()`);
}

// A results page, as far as the reader looks at one: profile links inside
// cards, and the page's text in reading order.
function page(results, { extraLines = [] } = {}) {
  const lines = [];
  const anchors = [];
  for (const r of results) {
    // `mutual` is the line, or its parts when LinkedIn draws the names on lines of their own.
    const card = { innerText: [r.name, `View ${r.name}’s profile`, '• 2nd', r.headline, r.place || 'Orlando, FL', ...[r.mutual].flat(), 'Connect'].filter(Boolean).join('\n') };
    card.parentElement = { innerText: card.innerText, parentElement: null };
    anchors.push({
      getAttribute: () => `/in/${r.slug}?miniProfileUrn=x`,
      closest: () => null,
      querySelector: () => null,
      innerText: r.name,
      parentElement: card,
    });
    // Your own connections' links inside the mutual line, as LinkedIn draws them.
    for (const v of [r.via].flat().filter(Boolean)) {
      anchors.push({ getAttribute: () => `/in/${v.slug}`, closest: () => null, querySelector: () => null, innerText: v.name, parentElement: card });
    }
    lines.push(...card.innerText.split('\n'));
  }
  lines.push(...extraLines);
  const root = { innerText: lines.join('\n'), querySelectorAll: () => anchors };
  return { querySelector: () => root, body: root };
}

const run = (js, doc) => vm.runInNewContext(`(${js})()`, { document: doc });

test('the mutual line, in every form LinkedIn writes it', (t) => {
  const js = reader(t);
  if (!js) return;
  const count = parser(js);
  for (const [line, n] of [
    ['Maya Chen is a mutual connection', 1],
    ['Maya Chen and Leo Park are mutual connections', 2],
    ['Maya Chen and 23 other mutual connections', 24],
    ['Maya Chen, Leo Park and 23 other mutual connections', 25],
    ['Maya Chen and 1 other mutual connection', 2],
    ['Maya Chen and 1,204 other mutual connections', 1205],
    ['and 23 other mutual connections', 24],   // the names drawn on a line of their own
    ['12 mutual connections', 12],
    ['1 mutual connection', 1],
  ]) assert.equal(count(line), n, line);
  // Anything else is no count, never a guess: other lines on the card, other languages.
  for (const line of ['Marketing Director at Northwind Labs', 'Connect', '500+ connections', '12 conexiones en común',
    'Mutual connections are shown here', 'mutual connections', '']) {
    assert.equal(count(line), null, line);
  }
});

test('each result keeps the count under its own card, and a shared name takes none', (t) => {
  const js = reader(t);
  if (!js) return;
  const results = run(js, page([
    { slug: 'ada-stone', name: 'Ada Stone', headline: 'VP Sales at Northwind Labs', mutual: 'Maya Chen and 23 other mutual connections', via: { slug: 'maya-chen', name: 'Maya Chen' } },
    { slug: 'ben-ortiz', name: 'Ben Ortiz', headline: 'Designer at Halcyon', mutual: 'Maya Chen is a mutual connection' },
    { slug: 'cy-moreno', name: 'Cy Moreno', headline: 'Founder at Ironwood' },   // no line: no count
    { slug: 'member-1', name: 'LinkedIn Member', headline: 'Engineer', mutual: 'Maya Chen and 3 other mutual connections' },
    { slug: 'member-2', name: 'LinkedIn Member', headline: 'Analyst', mutual: 'Maya Chen and 8 other mutual connections' },
  ]));
  const by = Object.fromEntries(results.map((r) => [r.profileUrl.replace('https://www.linkedin.com/in/', '').replace(/\/$/, ''), r]));
  assert.equal(by['ada-stone'].mutualCount, 24);
  assert.equal(by['ben-ortiz'].mutualCount, 1);
  assert.equal(by['cy-moreno'].mutualCount, undefined);
  assert.equal(by['member-1'].mutualCount, undefined, 'two results share the name: neither takes a count');
  assert.equal(by['member-2'].mutualCount, undefined);
  // The headline is still the headline, not the mutual line.
  assert.equal(by['ada-stone'].headline, 'VP Sales at Northwind Labs');
});

test('a name drawn with its degree on the same line still owns the count below it', (t) => {
  const js = reader(t);
  if (!js) return;
  const doc = page([{ slug: 'ada-stone', name: 'Ada Stone', headline: 'VP Sales at Northwind Labs' }]);
  // Rewrite the page's text as LinkedIn sometimes flattens it.
  const root = doc.querySelector();
  root.innerText = ['Ada Stone • 2nd', 'VP Sales at Northwind Labs', 'Orlando, FL', 'Maya Chen and 5 other mutual connections', 'Connect'].join('\n');
  const [ada] = run(js, doc);
  assert.equal(ada.mutualCount, 6);
});

test('what reaches the app is a whole number from 1 to 30,000, or nothing', () => {
  assert.deepEqual([24, '1,205', ' 12 ', 1, 30000].map(mutualCountOf), [24, 1205, 12, 1, 30000]);
  assert.deepEqual([0, -3, 2.5, 30001, '12 people', null, undefined, NaN, {}].map(mutualCountOf), [null, null, null, null, null, null, null, null, null]);
});

test('names drawn on lines of their own above the rest stay part of the line, and the count stays on its card', (t) => {
  // Codex's review of #47: the mutuals' links are on the page as people too, so
  // their name lines used to take the count away from the result it belongs to.
  const js = reader(t);
  if (!js) return;
  const maya = { slug: 'maya-chen', name: 'Maya Chen' };
  const leo = { slug: 'leo-park', name: 'Leo Park' };
  const results = run(js, page([
    { slug: 'ada-stone', name: 'Ada Stone', headline: 'VP Sales at Northwind Labs', mutual: ['Maya Chen', 'and 23 other mutual connections'], via: maya },
    { slug: 'ben-ortiz', name: 'Ben Ortiz', headline: 'Designer at Halcyon', mutual: ['Maya Chen', 'Leo Park', 'and 4 other mutual connections'], via: [maya, leo] },
    { slug: 'cy-moreno', name: 'Cy Moreno', headline: 'Founder at Ironwood', mutual: ['Leo Park', 'is a mutual connection'], via: leo },
    { slug: 'di-lang', name: 'Di Lang', headline: 'Engineer at Initech', mutual: ['Maya Chen', 'Leo Park', 'are mutual connections'], via: [maya, leo] },
  ]));
  const by = Object.fromEntries(results.map((r) => [r.profileUrl.replace('https://www.linkedin.com/in/', '').replace(/\/$/, ''), r]));
  assert.deepEqual(['ada-stone', 'ben-ortiz', 'cy-moreno', 'di-lang'].map((s) => by[s].mutualCount), [24, 6, 1, 2]);
  // …and the mutuals themselves, your own connections, take none.
  assert.deepEqual([by['maya-chen'].mutualCount, by['leo-park'].mutualCount], [undefined, undefined]);
});
