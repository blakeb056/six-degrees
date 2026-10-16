// Separation's tier filter picks the people to connect with, and nothing else (Blake,
// 2026-10-16: "if I filter only S tiers for the output to connect with, why is it that it
// filters out the connections that are the ones mutually tied, so it removes connections
// that could show from a purple and a gold. I want that only to be for the outputs, for
// the actual tier to be controlled in the filter, and that is all, not the whole
// function."). The connections who lead to them, gold or purple, and everyone in between
// always show, on the map, in the list and in Gatekeepers. Every name here is invented.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { separationPeople, summitLayout, convergeLayout } from '../lib/separation.js';

const src = (rel) => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8');
const bridge = (id, tier) => ({ id, name: `Bridge ${id}`, tier, power_score: 5, degree: 1, profile_url: `/in/bridge-${id}` });
const row = (id, url, via, tier, power_score = 5, degree = 2) =>
  ({ id, degree, name: `Person ${url}`, profile_url: url, source_connection_id: via, tier, power_score });

// Gold (S) and purple (A) connections; an S person both lead to; an A person only the
// purple one leads to; and an S person further out, through that A person.
const connections = [bridge('gold', 'S'), bridge('purple', 'A'), bridge('blue', 'B')];
const rows = [
  row('s1', '/in/star', 'gold', 'S', 9.5),
  row('s2', '/in/star', 'purple', 'S', 9.5),
  row('a1', '/in/middle', 'purple', 'A', 7),
  row('x1', '/in/further', 'a1', 'S', 9.2, 3),
  row('b1', '/in/plain', 'blue', 'B', 5),
];
const onlyS = (tier) => tier === 'S';

test('S only: the S people are ranked, and every connection who leads to them stays, gold and purple', () => {
  const { people } = separationPeople(rows, connections, { include: onlyS });
  assert.deepEqual(people.map((p) => p.key).sort(), ['/in/further', '/in/star']);
  const star = people.find((p) => p.key === '/in/star');
  assert.deepEqual(star.routes.map((r) => r.bridge.tier).sort(), ['A', 'S'], 'both ways in, whatever their tier');
  assert.equal(star.waysIn, 2);
  // Further out, through the purple connection and the A person between: the chain whole.
  const further = people.find((p) => p.key === '/in/further');
  assert.equal(further.degree, 3);
  assert.equal(further.routes[0].bridge.tier, 'A');
  assert.deepEqual(further.routes[0].via.map((v) => v.tier), ['A'], 'the A person between stays on the route');
});

test('S only: the map draws the gold and the purple connections, and the A person between as a stop', () => {
  const all = separationPeople(rows, connections).people;
  const sOnly = separationPeople(rows, connections, { include: onlyS }).people;
  const layout = summitLayout(sOnly, 900, false);
  assert.deepEqual(layout.bridges.map((b) => b.bridge.tier).sort(), ['A', 'S']);
  const toFurther = layout.links.find((l) => l.key === '/in/further');
  assert.deepEqual(toFurther.steps, ['Person /in/middle']);
  // The same people drawn with the filter as without it: the filter removes people, never a way in to one.
  for (const p of sOnly) {
    const same = all.find((q) => q.key === p.key);
    assert.deepEqual(p.routes.map((r) => r.id), same.routes.map((r) => r.id), p.key);
  }
  // Aimed at the S person: both connections, gold and purple.
  const aim = convergeLayout(sOnly.find((p) => p.key === '/in/star'), 900);
  assert.deepEqual(aim.bridges.map((b) => b.bridge.tier).sort(), ['A', 'S']);
});

test('the tier chips filter the people ranked and nothing else: not the ways in, not Gatekeepers', () => {
  const view = src('app/components/SeparationView.js');
  // The chips' tier reaches the ranked people (matches) and the unranked finds, and nowhere else.
  assert.match(view, /const matches = useCallback\(\(p, text\) => \(tier === 'all' \|\| p\.tier === tier\)/);
  assert.match(view, /model\.unranked\.filter\(\(p\) => \(tier === 'all' \|\| p\.tier === tier\)/);
  assert.equal((view.match(/\.tier === tier\b/g) || []).length, 2, 'only those two compare against the chip');
  // Routing reads every row, whatever the Filters grid or the chips say.
  assert.match(view, /const sepRows = useMemo\(\(\) => \[\.\.\.\(showsAt \? fullDegree2 : degree2\), \.\.\.degree3\]/);
  assert.match(view, /separationPeople\(sepRows, connections, \{ include: showsAt \}\)/);
  // Gatekeepers: every connection of yours, whatever the chip.
  const gate = view.match(/<GatekeeperList [^>]*\/>/s)?.[0] || '';
  assert.ok(gate, 'Gatekeepers is drawn');
  assert.doesNotMatch(gate, /\btier=/);
  const list = src('app/components/GatekeeperList.js');
  assert.doesNotMatch(list, /c\.tier !== tier|\{ tier/);
  assert.match(view, /title=\{TIER_NOTE\}/);
  assert.doesNotMatch(view, /TIER_NOTE = '[^']*—/);
});
