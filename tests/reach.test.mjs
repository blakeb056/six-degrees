// Who is ready for a circle scan (lib/reach.js): one rule, read by Bridge
// Chains' halo, the Degrees panel's Ready to scan, Outlink's new doors and the
// profile page's mapping bar. Backlog 2.4: someone is ready when they're your
// connection now, came through a circle, their own circle isn't scanned and
// their list isn't known to be hidden. The old glow never showed because it
// looked for them in the circle they came from, and accepting takes them out
// of it (lib/promote.js). Invented people.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { reachIndex, circleState, reachState, readyToScan, readyByCircle, circleScanCost } from '../lib/reach.js';
import { buildQuest } from '../lib/quest.js';

const url = (id) => `https://www.linkedin.com/in/${id}`;
const d1 = (id, extra = {}) => ({ id, name: id, degree: 1, tier: 'A', power_score: 6, profile_url: url(id), ...extra });
const d2 = (id, via, extra = {}) => ({ id: `${id}@${via}`, name: id, degree: 2, tier: 'B', power_score: 4, profile_url: url(id), source_connection_id: via, ...extra });

// Jane's circle was scanned. From it you connected with Marcus (not scanned
// yet), Nia (her list is hidden), Otto (scanned: Pia is in his circle) and Quin
// (his list was read, and everyone on it was already yours). Ray was always
// your connection. Sam is still in Jane's circle, with a request out that
// names Jane.
function network() {
  const jane = d1('jane', { tier: 'S', power_score: 8 });
  const marcus = d1('marcus', { unlocked_from_bridge_id: 'jane', unlocked_from_name: 'jane', tier: 'B', power_score: 4 });
  const nia = d1('nia', { unlocked_from_bridge_id: 'jane' });
  const otto = d1('otto', { unlocked_from_bridge_id: 'jane' });
  const quin = d1('quin', { unlocked_from_bridge_id: 'jane' });
  const ray = d1('ray');
  const connections = [jane, marcus, nia, otto, quin, ray];
  const degree2 = [
    d2('sam', 'jane', { unlocked_from_bridge_id: 'jane', unlock_status: 'pending' }), d2('tia', 'jane'),
    d2('pia', 'otto'),
  ];
  const notes = { skips: [{ profileUrl: url('nia') }], read: [`${url('quin')}/`] };
  return { jane, marcus, nia, otto, quin, ray, connections, degree2, notes };
}

test('ready: your connection now, through a circle, their own circle not scanned, their list not hidden', () => {
  const n = network();
  const reach = reachIndex(n.connections, n.degree2, n.notes);
  assert.equal(reachState(n.marcus, reach), 'ready');
  assert.equal(reachState(n.nia, reach), 'hidden');
  assert.equal(reachState(n.otto, reach), 'scanned');
  assert.equal(reachState(n.quin, reach), 'scanned', 'a list read to no one new is not offered again');
});

test('nobody else is "reached": your own connections, and 2nd-degree rows even with a request out', () => {
  const n = network();
  const reach = reachIndex(n.connections, n.degree2, n.notes);
  assert.equal(reachState(n.ray, reach), null);
  assert.equal(reachState(n.jane, reach), null);
  assert.equal(reachState(n.degree2[0], reach), null, 'a request names the circle, but they are not yours yet');
});

test('the circle they came from is the one credited: unlocked_from_bridge_id, not source_connection_id', () => {
  // Promotion clears source_connection_id. Reading it, as the old glow did, finds nobody.
  const n = network();
  const reach = reachIndex(n.connections, n.degree2, n.notes);
  assert.deepEqual(reach.reachedFrom.get('jane').map((p) => p.id), ['marcus', 'nia', 'otto', 'quin']);
  assert.deepEqual([...readyByCircle(reach)], [['jane', 1]]);
});

test('Ready to scan lists only the ready, strongest first', () => {
  const n = network();
  const extra = d1('uma', { unlocked_from_bridge_id: 'otto', tier: 'S', power_score: 9 });
  const connections = [...n.connections, extra];
  const reach = reachIndex(connections, n.degree2, n.notes);
  assert.deepEqual(readyToScan(connections, reach).map((p) => p.id), ['uma', 'marcus']);
});

test("once a scan saves someone into their circle, they aren't ready any more", () => {
  const n = network();
  const before = reachIndex(n.connections, n.degree2, n.notes);
  const after = reachIndex(n.connections, [...n.degree2, d2('vic', 'marcus')], n.notes);
  assert.equal(reachState(n.marcus, before), 'ready');
  assert.equal(reachState(n.marcus, after), 'scanned');
});

test('the circle of anyone: scanned, hidden or still to do', () => {
  const n = network();
  const reach = reachIndex(n.connections, n.degree2, n.notes);
  assert.equal(circleState(n.jane, reach), 'scanned');
  assert.equal(circleState(n.ray, reach), 'todo');
  assert.equal(circleState(n.nia, reach), 'hidden');
  assert.equal(circleState(null, reach), 'todo');
});

test('profile URLs match however the scanner wrote them', () => {
  const n = network();
  const reach = reachIndex(n.connections, n.degree2, { skips: [{ profileUrl: `${url('marcus')}/?trk=x` }] });
  assert.equal(reachState(n.marcus, reach), 'hidden');
});

test('nothing noted (the sample, a CSV, no answer yet) leaves everyone unscanned as ready', () => {
  const n = network();
  const reach = reachIndex(n.connections, n.degree2);
  assert.equal(reachState(n.nia, reach), 'ready');
});

test("Outlink's new doors follow the same rule, hidden lists left out", () => {
  const n = network();
  const added = n.connections.filter((c) => c.unlocked_from_bridge_id);
  const reach = reachIndex(n.connections, n.degree2, n.notes);
  assert.deepEqual(buildQuest({ added, reach }).newDoors.map((p) => p.id), ['marcus']);
});

test('what one circle scan costs: a profile view, a search a page, about 0.55 min a page', () => {
  assert.deepEqual(circleScanCost(), { profileViews: 1, searches: 100, minutes: 55 });
  assert.deepEqual(circleScanCost(10), { profileViews: 1, searches: 10, minutes: 6 });
  assert.equal(circleScanCost(25).minutes, 14);
  assert.equal(circleScanCost(5).minutes, 5, 'never less than five minutes');
  assert.equal(circleScanCost(500).searches, 100, 'LinkedIn shows 100 pages at most');
});

test('scan bars: 5 for a list read to the end, pages against LinkedIn\'s count part-way, 2 with no count, none unscanned or hidden', async () => {
  const { reachIndex, scanBars } = await import('../lib/reach.js');
  const { ringSegments } = await import('../lib/dot-rings.js');
  const u = (s) => `https://www.linkedin.com/in/${s}`;
  const people = ['done', 'half', 'nocount', 'legacy', 'none', 'hid'].map((s, i) => ({ id: `c${i}`, degree: 1, profile_url: u(s) }));
  const degree2 = [{ id: 'x', degree: 2, source_connection_id: 'c3', profile_url: u('x') }];
  const reach = reachIndex(people, degree2, {
    skips: [{ profileUrl: u('hid') }],
    read: [u('done'), u('half'), u('nocount')],
    lists: {
      [u('done')]: { pages: 30, more: false, total: 290 },
      [u('half')]: { pages: 15, more: true, total: 300 },
      [u('nocount')]: { pages: 10, more: true, total: null },
    },
  });
  assert.deepEqual(people.map((p) => scanBars(p, reach)), [5, 3, 2, 2, null, null]);
  const tiny = reachIndex(people, [], { read: [u('half')], lists: { [u('half')]: { pages: 1, more: true, total: 5000 } } });
  assert.equal(scanBars(people[1], tiny), 1, 'a list barely started still shows one bar');
  const segs = ringSegments(10);
  assert.equal(segs.length, 5);
  assert.match(segs[0].d, /^M[-\d.]+ [-\d.]+ A10 10 0 0 1 [-\d.]+ [-\d.]+$/);
});
