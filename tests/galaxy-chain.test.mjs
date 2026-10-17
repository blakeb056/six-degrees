// Every degree chains on the Galaxy (Blake, 2026-10-15: "the 3rd degree dots are
// not successfully connecting to who they are connected to from the d1 ... it
// all needs to chain"). A 3-level fixture: you → Ava (1st) → Ben (2nd, in Ava's
// circle, then connected and scanned) → Cy (3rd, in Ben's circle).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { galaxyChain, ownLines, linkPull, bandSteps } from '../lib/galaxy.js';
import { lineMask } from '../lib/tier-lines.js';
import { colourScheme, DEGREE_COLOURS } from '../lib/galaxy-lab.js';

const ava = { id: 'a1', degree: 1, tier: 'S', profile_url: 'https://www.linkedin.com/in/ava' };
// A chained scan: Ben was 2nd degree through Ava; connected, he is a 1st-degree
// row that keeps who introduced him (lib/promote.js), and his circle is scanned.
const ben = { id: 'b1', degree: 1, tier: 'A', profile_url: 'https://www.linkedin.com/in/ben', unlocked_from_bridge_id: 'a1' };
const cy = { id: 'c2', degree: 2, tier: 'B', profile_url: 'https://www.linkedin.com/in/cy', source_connection_id: 'b1' };
const dee = { id: 'd2', degree: 2, tier: 'C', profile_url: 'https://www.linkedin.com/in/dee', source_connection_id: 'a1' };
const rows = [ava, ben, dee, cy];

test('each degree hangs off the one it came through: you → 1st → 2nd → 3rd', () => {
  const { parentOf, stepOf, none } = galaxyChain(rows);
  assert.equal(parentOf.has('a1'), false, 'your connection hangs off you');
  assert.equal(parentOf.get('b1'), 'a1');
  assert.equal(parentOf.get('d2'), 'a1');
  assert.equal(parentOf.get('c2'), 'b1', 'the 3rd degree hangs off the 2nd they came through');
  assert.deepEqual([stepOf.get('a1'), stepOf.get('b1'), stepOf.get('d2'), stepOf.get('c2')], [1, 2, 2, 3]);
  assert.equal(none.size, 0, 'nobody in the chain is cut loose');
});

test('a 4th degree chains on in the same way', () => {
  const cyConnected = { ...cy, degree: 1, source_connection_id: null, unlocked_from_bridge_id: 'b1' };
  const eve = { id: 'e2', degree: 2, profile_url: 'https://www.linkedin.com/in/eve', source_connection_id: 'c2' };
  const { parentOf, stepOf } = galaxyChain([ava, ben, cyConnected, eve]);
  assert.equal(parentOf.get('c2'), 'b1');
  assert.equal(parentOf.get('e2'), 'c2');
  assert.equal(stepOf.get('e2'), 4);
});

test('the 3rd degree gets the same line and pull as the 2nd', () => {
  const { parentOf, none } = galaxyChain(rows);
  const links = rows.map((r) => {
    const via = parentOf.get(r.id) ?? 'you';
    return { source: via, target: r.id, near: via !== 'you', ...(none.has(r.id) ? { none: true } : {}) };
  });
  const second = links.find((l) => l.target === 'd2');
  const third = links.find((l) => l.target === 'c2');
  assert.equal(third.source, 'b1');
  assert.equal(third.near, second.near);
  assert.equal(linkPull(third, { base: 0.06 }), linkPull(second, { base: 0.06 }));
  assert.ok(linkPull(third, { base: 0.06 }) > 0);
  // Degrees and the fan pull nobody, at any degree.
  assert.equal(linkPull(third, { byDegree: true }), linkPull(second, { byDegree: true }));
});

test('a parent filed under another row is found by profile URL', () => {
  // Cy's row points at an older copy of Ben (folded or re-imported); Ben is drawn under b1.
  const oldBen = { id: 'b-old', degree: 2, profile_url: 'https://www.linkedin.com/in/ben/', source_connection_id: 'a1' };
  const cyOld = { ...cy, source_connection_id: 'b-old' };
  const { parentOf, stepOf } = galaxyChain([ava, ben, cyOld], { all: [ava, ben, oldBen, cyOld] });
  assert.equal(parentOf.get('c2'), 'b1');
  assert.equal(stepOf.get('c2'), 3);
});

test('a hidden bridge hangs their circle off the nearest one drawn, and nobody far out off you', () => {
  // Ben filtered out: Cy hangs off Ava, still 3rd degree.
  const viaAva = galaxyChain([ava, cy], { all: rows });
  assert.equal(viaAva.parentOf.get('c2'), 'a1');
  assert.equal(viaAva.stepOf.get('c2'), 3);
  // Ava and Ben both hidden: no line to you for a 3rd degree.
  const alone = galaxyChain([cy, { id: 'x', degree: 1 }], { all: rows });
  assert.equal(alone.parentOf.has('c2'), false);
  assert.ok(alone.none.has('c2'));
});

test('your connections alone stay on you', () => {
  const { parentOf, stepOf } = galaxyChain([ava, ben]);
  assert.equal(parentOf.size, 0);
  assert.equal(stepOf.get('b1'), 1);
});

test('a company scan find with no one to hang off has no line', () => {
  const found = { id: 'f3', degree: 3, profile_url: 'https://www.linkedin.com/in/fay' };
  const { parentOf, none, stepOf } = galaxyChain([ava, found]);
  assert.equal(parentOf.has('f3'), false);
  assert.ok(none.has('f3'));
  assert.equal(stepOf.get('f3'), 3);
});

test('a loop is cut so the chain always reaches you', () => {
  const p = { id: 'p', degree: 2, source_connection_id: 'q' };
  const q = { id: 'q', degree: 2, source_connection_id: 'p' };
  const { parentOf } = galaxyChain([ava, p, q]);
  for (const id of ['p', 'q']) {
    const seen = new Set();
    for (let x = id; x != null; x = parentOf.get(x)) { assert.ok(!seen.has(x)); seen.add(x); }
  }
});

test('Degrees and the fan band and colour by the chain', () => {
  const { stepOf } = galaxyChain(rows);
  const node = { ...cy, step: stepOf.get('c2') };
  assert.equal(bandSteps('degree').keyOf(node), 3);
  assert.equal(colourScheme('degree', rows, {}).of(node), DEGREE_COLOURS[3]);
  assert.equal(bandSteps('degree').keyOf({ ...ben, step: stepOf.get('b1') }), 2);
});

test('hover and selection light the chain back to you', () => {
  const { parentOf } = galaxyChain(rows);
  const links = rows.map((r) => ({ source: parentOf.get(r.id) ?? 'you', target: r.id }));
  const on = (mask) => links.filter((_, i) => mask[i]).map((l) => `${l.source}>${l.target}`).sort();
  assert.deepEqual(on(ownLines(links, ['c2'], null, parentOf)), ['a1>b1', 'b1>c2', 'you>a1']);
  assert.deepEqual(on(ownLines(links, ['c2'])), ['b1>c2'], 'without parentOf, only their own line');
  const tiers = links.map((l) => ({ source: { id: l.source }, target: { id: l.target, tier: 'D' } }));
  const mask = lineMask(tiers, 'none', { keep: 'c2', parentOf });
  assert.deepEqual(links.filter((_, i) => mask[i]).map((l) => l.target).sort(), ['a1', 'b1', 'c2']);
});

// The chips under Network Circle's map counted the degree each row was saved
// at, so they could read "3rd 0" beside dots in the 3rd's colour: Cy is saved
// at 2nd (in Ben's circle) and drawn at 3rd. They count, and the filter picks,
// by the step the Galaxy draws (lib/galaxy.js chainedDegrees).
test('Network Circle counts and picks by the degree drawn, not the degree saved', async () => {
  const { chainedDegrees } = await import('../lib/galaxy.js');
  const { peopleByDegree } = await import('../lib/degrees.js');
  const { gridCounts, bandChips, makeGrid, toggleBand } = await import('../lib/tier-grid.js');
  const byDegree = peopleByDegree([ava, ben], [dee, cy], []);
  const ids = (by) => Object.fromEntries(Object.entries(by).map(([d, rows]) => [d, rows.map((r) => r.id)]));
  // More than your connections on screen: chained, as the Galaxy draws it.
  const chained = chainedDegrees(byDegree, { all: [ava, ben, dee, cy], chained: true });
  assert.deepEqual(ids(chained), { 1: ['a1'], 2: ['b1', 'd2'], 3: ['c2'], 4: [], 5: [], 6: [] });
  const chips = bandChips(makeGrid([1, 2, 3], { tiersOff: true }), gridCounts(chained)).chips;
  assert.deepEqual(chips.map((c) => [c.label, c.count, c.on]), [['1st', 1, true], ['2nd', 2, true], ['3rd', 1, true]]);
  // The saved degrees said "3rd 0" beside Cy's 3rd-colour dot.
  assert.deepEqual(bandChips(makeGrid([1, 2, 3], { tiersOff: true }), gridCounts(byDegree)).chips.map((c) => c.count), [2, 2, 0]);
  // Tapping 3rd takes Cy off, and the chip goes dark: what it counts is what it picks.
  const grid = toggleBand(makeGrid([1, 2, 3], { tiersOff: true }), { kind: 'degree', key: 3 }, gridCounts(chained));
  assert.deepEqual(grid.flat, [1, 2]);
  // Your connections alone: nobody chains, so Ben is at the 1st with Ava, as the Galaxy draws them alone.
  const alone = chainedDegrees(byDegree, { all: [ava, ben, dee, cy], chained: false });
  assert.deepEqual(alone[1].map((r) => r.id), ['a1', 'b1']);
  // Without being told, galaxyChain's own rule: chained when anyone past your connections is there.
  assert.deepEqual(ids(chainedDegrees(byDegree, { all: [ava, ben, dee, cy] })), ids(chained));
  // The page counts and picks so, and tells the Galaxy the same.
  const page = (await import('node:fs')).readFileSync(new URL('../app/page.js', import.meta.url), 'utf8');
  assert.match(page, /chainedDegrees\(byDegree, \{ all: \[\.\.\.degree1, \.\.\.degree2\], chained: chainedOn \}\)/);
  assert.match(page, /if \(byChain\) return GRID_DEGREES\.flatMap\(\(d\) => \(byChain\[d\] \|\| \[\]\)\.filter\(\(c\) => shows\(grid, c\.tier, d\)\)\);/);
  assert.match(page, /: byChain \|\| byDegree\)\)/);
  assert.match(page, /chained: chainedOn,/);
  const graph = (await import('node:fs')).readFileSync(new URL('../app/components/ForceGraph.js', import.meta.url), 'utf8');
  assert.match(graph, /\.\.\.\(typeof chained === 'boolean' \? \{ chained \} : \{\}\)/);
});
