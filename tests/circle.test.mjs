// Their circle on every profile card (lib/circle.js), and rarity beside the
// tier (lib/rarity.js). Blake, 2026-09-28: the circle shows who a person's
// circle holds, who you added from it, and their circles in turn, out to six
// degrees; rarity grades how few mutual connections lead to someone, and it
// filters together with the tier but never changes a score. Invented people.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { circleIndex, circleRings, circleLayout, MAX_DEGREE } from '../lib/circle.js';
import { RARITY, rarityFor, rarityOf, mutualsOf, passes, countByRarity, toggle } from '../lib/rarity.js';

const url = (id) => `https://www.linkedin.com/in/${id}`;
const d1 = (id, extra = {}) => ({ id, name: id, degree: 1, tier: 'A', power_score: 6, profile_url: url(id), ...extra });
const d2 = (id, via, extra = {}) => ({ id: `${id}@${via}`, name: id, degree: 2, tier: 'B', power_score: 4, profile_url: url(id), source_connection_id: via, ...extra });

// Maya's circle: Ada, Ben (a request is out) and Cy. You connected with Dee from
// it; Dee's circle holds Eve and Fin; you connected with Gus from Dee's, and
// Gus's circle holds Hal.
function chain() {
  const maya = d1('maya');
  const dee = d1('dee', { unlocked_from_bridge_id: 'maya' });
  const gus = d1('gus', { unlocked_from_bridge_id: 'dee' });
  const connections = [maya, dee, gus, d1('zoe')];
  const degree2 = [
    d2('ada', 'maya', { tier: 'S', power_score: 8 }), d2('ben', 'maya', { unlock_status: 'pending' }), d2('cy', 'maya'),
    d2('eve', 'dee'), d2('fin', 'dee', { tier: 'S', power_score: 7.6 }),
    d2('hal', 'gus'),
    d2('ada', 'zoe', { tier: 'S', power_score: 8 }),   // Ada is in Zoe's circle too
  ];
  return { maya, dee, gus, connections, degree2 };
}

const names = (ring) => ring.people.map((p) => `${p.row.name}${p.state ? `:${p.state}` : ''}`);

test('the rings run out along who you added: circle, then their circles, a degree each', () => {
  const { maya, connections, degree2 } = chain();
  const { rings, totals } = circleRings(maya, circleIndex(connections, degree2));
  assert.deepEqual(rings.map((r) => r.degree), [2, 3, 4]);
  // Who you connected with first, then requests out, then by power.
  assert.deepEqual(names(rings[0]), ['dee:connected', 'ben:requested', 'ada', 'cy']);
  assert.deepEqual(names(rings[1]), ['gus:connected', 'fin', 'eve']);
  assert.deepEqual(names(rings[2]), ['hal']);
  assert.deepEqual(totals, { people: 8, connected: 2, requested: 1 });
});

test('everyone appears once, in the nearest ring; a loop in the data cannot run forever', () => {
  const { maya, dee, connections, degree2 } = chain();
  // Fin is also in Maya's own circle, so Fin shows in the first ring only.
  degree2.push(d2('fin', 'maya', { tier: 'S', power_score: 7.6 }));
  // And a record that says Maya was introduced by Dee: a loop.
  maya.unlocked_from_bridge_id = 'dee';
  const { rings } = circleRings(maya, circleIndex(connections, degree2));
  const all = rings.flatMap((r) => r.people.map((p) => p.row.name));
  assert.equal(new Set(all).size, all.length);
  assert.ok(names(rings[0]).includes('fin'));
  assert.ok(!names(rings[1]).includes('fin'));
  assert.ok(!all.includes('maya'), 'the person at the centre is not in their own rings');
  assert.equal(dee.name, 'dee');
});

test('six degrees at most, and nothing scanned is an empty map, not an error', () => {
  const connections = [d1('p0')];
  const degree2 = [];
  for (let i = 1; i <= 8; i++) {
    connections.push(d1(`p${i}`, { unlocked_from_bridge_id: `p${i - 1}` }));
  }
  const { rings } = circleRings(connections[0], circleIndex(connections, degree2));
  assert.deepEqual(rings.map((r) => r.degree), [2, 3, 4, 5, 6]);
  assert.equal(rings.at(-1).degree, MAX_DEGREE);
  assert.deepEqual(circleRings(d1('alone'), circleIndex([d1('alone')], [])).rings, []);
  assert.deepEqual(circleRings(null, circleIndex([], [])).rings, []);
});

test('the layout gives whoever opened the most reach the most room, and their circle fans out behind them', () => {
  const { maya, connections, degree2 } = chain();
  const { rings } = circleRings(maya, circleIndex(connections, degree2));
  const lay = circleLayout(rings, 240);
  assert.equal(lay.rings.length, 3);
  for (const ring of lay.rings) {
    for (const it of ring.items) {
      assert.ok(it.x >= 0 && it.x <= 240 && it.y >= 0 && it.y <= 240, `${it.row.name} is inside the box`);
      assert.ok(Math.abs(Math.hypot(it.x - 120, it.y - 120) - ring.radius) < 1e-6, `${it.row.name} sits on its ring`);
    }
  }
  assert.ok(lay.rings[0].radius < lay.rings[1].radius && lay.rings[1].radius < lay.rings[2].radius);
  // Dee carries Gus (and Hal behind him), Fin and Eve: 3 of the first ring's 6
  // shares, so half the circle, starting at the top. Her circle splits her half
  // in three, Gus first.
  const angle = (ring, name) => lay.rings[ring].items.find((i) => i.row.name === name).angle;
  const close = (a, b) => Math.abs(a - b) < 1e-9;
  const PI = Math.PI;
  assert.ok(close(angle(0, 'dee'), 0), 'Dee sits in the middle of the top half');
  assert.ok(close(angle(0, 'ben'), 2 * PI / 3), 'Ben gets one share');
  assert.ok(close(angle(1, 'gus'), -PI / 3) && close(angle(1, 'fin'), 0) && close(angle(1, 'eve'), PI / 3),
    'Dee\'s circle fans out inside Dee\'s half');
  assert.ok(close(angle(2, 'hal'), -PI / 3), 'Hal sits behind Gus');
  assert.equal(lay.spokes.length, 2, 'a line from Dee and from Gus to their circles');
});

test('rarity bands: 1, 2–3, 4–10, 11–30, 31+ mutual connections', () => {
  assert.deepEqual([1, 2, 3, 4, 10, 11, 30, 31, 400].map(rarityFor),
    ['only', 'rare', 'rare', 'uncommon', 'uncommon', 'common', 'common', 'warm', 'warm']);
  assert.equal(rarityFor(0), 'only', 'the bridge is always a mutual');
  assert.deepEqual(RARITY.map((r) => r.key), ['only', 'rare', 'uncommon', 'common', 'warm']);
});

test('LinkedIn\'s own mutual count wins; else the ways in from your scans, and it says which', () => {
  assert.deepEqual(mutualsOf({ mutual_count: 24 }, 1), { count: 24, from: 'linkedin' });
  assert.deepEqual(mutualsOf({}, 3), { count: 3, from: 'scans' });
  assert.deepEqual(mutualsOf({ mutual_count: null }, 0), { count: 1, from: 'scans' });
  assert.deepEqual(rarityOf({ mutual_count: 40 }, 1), { key: 'warm', count: 40, from: 'linkedin' });
});

test('tier and rarity filter together: both must match, and an empty filter lets everyone through', () => {
  const s1 = { tier: 'S', rarity: 'only' }, s40 = { tier: 'S', rarity: 'warm' }, b1 = { tier: 'B', rarity: 'only' };
  const f = (tiers, rarities) => ({ tiers: new Set(tiers), rarities: new Set(rarities) });
  assert.deepEqual([s1, s40, b1].map((p) => passes(p, f(['S'], ['only', 'rare']))), [true, false, false]);
  assert.deepEqual([s1, s40, b1].map((p) => passes(p, f([], ['only']))), [true, false, true]);
  assert.deepEqual([s1, s40, b1].map((p) => passes(p, f([], []))), [true, true, true]);
  // Your own connections have no rarity: a rarity filter leaves them out.
  assert.equal(passes({ tier: 'S', rarity: null }, f([], ['only'])), false);
  assert.deepEqual(countByRarity([s1, s40, b1, { tier: 'A' }]), { only: 2, rare: 0, uncommon: 0, common: 0, warm: 1 });
  assert.deepEqual([...toggle(new Set(['only']), 'rare')], ['only', 'rare']);
  assert.deepEqual([...toggle(new Set(['only']), 'only')], []);
});

test('a big circle spreads into rows instead of a solid line, each person still behind who they hang off', () => {
  const people = Array.from({ length: 700 }, (_, i) => ({ row: { id: `p${i}`, name: `p${i}` }, parentId: 'root', state: 'seen' }));
  const lay = circleLayout([{ degree: 2, people }], 240);
  const ring = lay.rings[0];
  assert.ok(ring.rows > 1, `${ring.rows} rows`);
  const radii = new Set(ring.items.map((it) => Math.round(Math.hypot(it.x - 120, it.y - 120) * 10)));
  assert.equal(radii.size, ring.rows, 'one radius per row');
  // Neighbours by angle sit on different rows.
  const [a, b] = ring.items;
  assert.notEqual(Math.round(Math.hypot(a.x - 120, a.y - 120)), Math.round(Math.hypot(b.x - 120, b.y - 120)));
  for (const it of ring.items) assert.ok(it.x >= 0 && it.x <= 240 && it.y >= 0 && it.y <= 240, 'inside the box');
});
