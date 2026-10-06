import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cleanTierLines, pickedTiers, toggleLineTier, isPicked, lineMask, describeTierLines } from '../lib/tier-lines.js';
import { LAB_DEFAULTS } from '../lib/galaxy-lab.js';
import { LAYOUT_KEYS, cleanLayouts } from '../lib/galaxy-layouts.js';

// Invented people only. You, two S-tier connections with circles, an A and a D.
const you = { id: '__center__', tier: 'center' };
const sam = { id: 'sam', tier: 'S' };
const sia = { id: 'sia', tier: 'S' };
const ada = { id: 'ada', tier: 'A' };
const dov = { id: 'dov', tier: 'D' };
const bea = { id: 'bea', tier: 'B' };   // in Sam's circle
const cal = { id: 'cal', tier: 'C' };   // in Ada's circle
const sol = { id: 'sol', tier: 'S' };   // an S-tier person in Ada's circle
const nob = { id: 'nob' };              // no tier: drawn as D
const links = [
  { source: you, target: sam },   // 0
  { source: you, target: sia },   // 1
  { source: you, target: ada },   // 2
  { source: you, target: dov },   // 3
  { source: sam, target: bea },   // 4  S's circle
  { source: ada, target: cal },   // 5
  { source: ada, target: sol },   // 6  into an S-tier person
  { source: sia, target: bea },   // 7  Bea is in Sia's circle too
  { source: dov, target: nob },   // 8
];
const on = (mask) => [...mask].flatMap((v, i) => (v ? [i] : []));

test('All draws every line, None draws none', () => {
  assert.deepEqual(on(lineMask(links, 'all')), [0, 1, 2, 3, 4, 5, 6, 7, 8]);
  assert.deepEqual(on(lineMask(links, 'none')), []);
});

test('only S: you to each S, each S out to their circle, and lines into an S further out', () => {
  assert.deepEqual(on(lineMask(links, 'S')), [0, 1, 4, 6, 7]);
});

test('S and A together, and a missing tier counts as D', () => {
  assert.deepEqual(on(lineMask(links, 'SA')), [0, 1, 2, 4, 5, 6, 7]);
  assert.deepEqual(on(lineMask(links, 'D')), [3, 8]);
});

test("the selected person's own lines stay, whatever the choice", () => {
  assert.deepEqual(on(lineMask(links, 'S', { keep: 'cal' })), [0, 1, 4, 5, 6, 7]);
  assert.deepEqual(on(lineMask(links, 'none', { keep: 'ada' })), [2, 5, 6]);
  assert.deepEqual(on(lineMask(links, 'none', { keep: null })), []);
});

test('ends given as ids still work for the selected person, and a mask can be reused', () => {
  const into = new Uint8Array(links.length).fill(1);
  const out = lineMask(links, 'none', { keep: 'dov', into });
  assert.equal(out, into);
  assert.deepEqual(on(out), [3, 8]);
  assert.deepEqual(on(lineMask([{ source: 'x', target: 'y' }], 'none', { keep: 'y' })), [0]);
});

test('a choice is cleaned: unknown is All, five tiers is All, tiers in order', () => {
  assert.equal(cleanTierLines(undefined), 'all');
  assert.equal(cleanTierLines('everything'), 'all');
  assert.equal(cleanTierLines('<b>'), 'all');
  assert.equal(cleanTierLines('none'), 'none');
  assert.equal(cleanTierLines('AS'), 'SA');
  assert.equal(cleanTierLines('DCBAS'), 'all');
  assert.deepEqual([...pickedTiers('none')], []);
  assert.deepEqual([...pickedTiers('all')], ['S', 'A', 'B', 'C', 'D']);
});

test('tapping chips: from All or None one tap is that tier alone, the last one off is None', () => {
  assert.equal(toggleLineTier('all', 'S'), 'S');
  assert.equal(toggleLineTier('none', 'B'), 'B');
  assert.equal(toggleLineTier('S', 'A'), 'SA');
  assert.equal(toggleLineTier('SA', 'S'), 'A');
  assert.equal(toggleLineTier('S', 'S'), 'none');
  assert.equal(toggleLineTier('SABC', 'D'), 'all');
  assert.equal(toggleLineTier('S', 'Z'), 'S');
  assert.equal(isPicked('all', 'S'), false);
  assert.equal(isPicked('SA', 'A'), true);
  assert.equal(isPicked('none', 'A'), false);
});

test('the words say what is drawn', () => {
  assert.match(describeTierLines('S'), /S-Tier/);
  assert.match(describeTierLines('SAB'), /S-Tier, A-Tier and B-Tier/);
  assert.match(describeTierLines('none'), /No lines/);
});

test('kept with the Galaxy settings: All to begin with, so Reset puts it back, and saved with a layout', () => {
  assert.equal(LAB_DEFAULTS.tierLines, 'all');
  assert.ok(LAYOUT_KEYS.includes('tierLines'));
  const [kept] = cleanLayouts([{ name: 'S only', settings: { tierLines: 'S', lines: 2 } }]);
  assert.deepEqual(kept.settings, { tierLines: 'S', lines: 2 });
});

test('9,000 invented people: a pass over their lines is quick', () => {
  const tiers = ['S', 'A', 'B', 'C', 'D'];
  const people = Array.from({ length: 9000 }, (_, i) => ({ id: `p${i}`, tier: tiers[i % 5] }));
  const big = people.map((p, i) => ({ source: i < 1500 ? you : people[i % 1500], target: p }));
  const into = new Uint8Array(big.length);
  const t0 = performance.now();
  for (let k = 0; k < 20; k++) lineMask(big, k % 2 ? 'S' : 'SA', { keep: 'p42', into });
  const each = (performance.now() - t0) / 20;
  assert.ok(each < 20, `${each.toFixed(2)} ms a pass`);
  assert.equal(on(lineMask(big, 'S')).length, 1800);
});
