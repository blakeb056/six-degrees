// The ring round a scanned connection's dot (lib/reach.js scanFill, drawn by
// lib/dot-rings.js fillArcs): how far through their list the scans have got.
// Blake, 2026-10-12: their connection count shows "how scanned through this
// person is", and when its length isn't known "the last 30 percent of the
// circle bar will be the unknown and will gradually fill until we fully scan
// them". Before it, every part-read ring with no count drew 2 of 5 bars, a
// guess. Invented people.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { reachIndex, scanFill, scanFillWords, scanBars } from '../lib/reach.js';
import { arcPath, fillArcs, ringSegments } from '../lib/dot-rings.js';

const u = (s) => `https://www.linkedin.com/in/${s}`;
const person = (s) => ({ id: s, name: s, degree: 1, profile_url: u(s) });
const near = (a, b) => Math.abs(a - b) < 1e-9;

/** scanFill for one person with this note of their list. */
function fillFor(list, { degree2 = [], skips = [], card = null } = {}) {
  const p = person('ada-quill');
  if (card) p.experience = JSON.stringify({ v: 1, status: 'card', at: '2026-10-12T16:00:00Z', card });
  const reach = reachIndex([p], degree2, { skips, read: list ? [p.profile_url] : [], lists: list ? { [p.profile_url]: list } : {} });
  return scanFill(p, reach);
}

test('a list read to the end is the whole ring', () => {
  const f = fillFor({ pages: 12, more: false, total: 118 });
  assert.deepEqual([f.read, f.unknown, f.done], [1, 0, true]);
  // No count, or "500+", makes no difference once it's finished.
  assert.equal(fillFor({ pages: 3, more: false }).read, 1);
  assert.equal(fillFor({ pages: 60, more: false, connections: 500, connectionsPlus: true }).done, true);
});

test('page 100 is the end: LinkedIn search goes no further', () => {
  const f = fillFor({ pages: 100, more: true, connections: 500, connectionsPlus: true });
  assert.deepEqual([f.read, f.unknown, f.done], [1, 0, true]);
});

test('a known small list: pages read against its length', () => {
  const byTotal = fillFor({ pages: 6, more: true, total: 120 });
  assert.deepEqual([byTotal.read, byTotal.unknown, byTotal.done, byTotal.size], [0.5, 0, false, 120]);
  // An exact count from their profile serves when the search gave none.
  const byCount = fillFor({ pages: 10, more: true, total: null, connections: 400, connectionsPlus: false });
  assert.ok(near(byCount.read, 0.25));
  assert.equal(byCount.unknown, 0);
  // The search's own count wins over the profile's.
  assert.equal(fillFor({ pages: 6, more: true, total: 120, connections: 400 }).read, 0.5);
  // More pages read than the count said: full, still not done.
  const over = fillFor({ pages: 15, more: true, total: 120 });
  assert.deepEqual([over.read, over.done], [1, false]);
});

test('a known big list is read against the 1,000 LinkedIn shows', () => {
  const f = fillFor({ pages: 25, more: true, total: 5000 });
  assert.ok(near(f.read, 0.25));
  assert.equal(f.unknown, 0);
  assert.equal(f.size, 1000);
  assert.ok(near(fillFor({ pages: 50, more: true, total: 1200 }).read, 0.5));
});

test('"500+": the first 70% fills to 500, then the unknown band fills on to 1,000', () => {
  const at = (pages) => fillFor({ pages, more: true, total: null, connections: 500, connectionsPlus: true });
  const start = at(10);
  assert.ok(near(start.read, 0.14), 'page 10 is 100 of the 500 known: 0.7 × 0.2');
  assert.ok(near(start.unknown, 0.3));
  assert.equal(start.atLeast, 500);
  assert.equal(start.size, null);
  const half = at(50);
  assert.ok(near(half.read, 0.7));
  assert.ok(near(half.unknown, 0.3));
  const on = at(75);
  assert.ok(near(on.read, 0.85), 'half way from 500 to 1,000 fills half the band');
  assert.ok(near(on.unknown, 0.15));
  assert.ok(near(on.read + on.unknown, 1));
  assert.equal(on.done, false);
});

test('"500+" with their followers known: followers is the length, no unknown band', () => {
  // Blake, 2026-10-12: "if we gather their total follower count … we go off of that metric".
  const big = { followers: 6100, connections: 500, connectionsPlus: true };
  const f = fillFor({ pages: 22, more: true, total: null }, { card: big });
  assert.equal(f.size, 1000, 'over 1,000 followers: the 1,000 LinkedIn shows');
  assert.ok(near(f.read, 0.22));
  assert.equal(f.unknown, 0);
  assert.equal(f.followers, 6100);
  assert.equal(scanFillWords(f), 'about 220 of the 1,000 LinkedIn shows scanned, about 780 to go (they have 6,100 followers)');
  // Fewer than 1,000 followers: their followers are the length.
  const mid = fillFor({ pages: 20, more: true }, { card: { followers: 800, connections: 500, connectionsPlus: true } });
  assert.equal(mid.size, 800);
  assert.ok(near(mid.read, 0.25));
  assert.equal(scanFillWords(mid), 'about 200 of about 800 scanned, about 600 to go (going by their 800 followers)');
  // Never under the "500+" they show, and while pages remain never quite full.
  assert.equal(fillFor({ pages: 5, more: true }, { card: { followers: 320, connections: 500, connectionsPlus: true } }).size, 500);
  const past = fillFor({ pages: 40, more: true }, { card: { followers: 300, connections: null, connectionsPlus: false } });
  assert.equal(past.size, 410, 'read past their followers: one more page still to go');
  assert.ok(past.read < 1);
  // An exact count still wins, and the end of the list is the end.
  assert.equal(fillFor({ pages: 10, more: true, total: 240 }, { card: big }).size, 240);
  assert.equal(fillFor({ pages: 10, more: true }, { card: { followers: 900, connections: 312, connectionsPlus: false } }).size, 312);
  assert.equal(fillFor({ pages: 30, more: false }, { card: big }).done, true);
});

test('no count at all: progress against the 1,000 at most, the band stays whole until the end', () => {
  const f = fillFor({ pages: 10, more: true, total: null });
  assert.ok(near(f.read, 0.07));
  assert.ok(near(f.unknown, 0.3));
  assert.equal(f.atLeast, null);
  const late = fillFor({ pages: 99, more: true });
  assert.ok(near(late.read, 0.693));
  assert.ok(near(late.unknown, 0.3));
  // A count of 0 isn't a count.
  assert.ok(near(fillFor({ pages: 10, more: true, connections: 0, connectionsPlus: false }).read, 0.07));
});

test('scanned before notes were kept: read to page 10, more to come', () => {
  const f = fillFor(null, { degree2: [{ id: 'x', degree: 2, source_connection_id: 'ada-quill', profile_url: u('x') }] });
  assert.ok(near(f.read, 0.07));
  assert.ok(near(f.unknown, 0.3));
  assert.equal(f.pages, 10);
});

test('no ring when not scanned, or when their list is hidden', () => {
  assert.equal(fillFor(null), null);
  assert.equal(fillFor(null, { skips: [{ profileUrl: u('ada-quill') }] }), null);
  assert.equal(scanFill(null, reachIndex([], [], {})), null);
  assert.equal(scanFill({ id: 'n', degree: 1 }, reachIndex([], [], {})), null, 'no profile link, nothing scanned');
});

test('read + unknown is never above 1, and nothing goes down as pages are read', () => {
  const kinds = [
    { total: 120 }, { total: 5000 }, { connections: 342, connectionsPlus: false }, { connections: 1500, connectionsPlus: false },
    { connections: 500, connectionsPlus: true }, { connections: 800, connectionsPlus: true }, { connections: 1200, connectionsPlus: true }, {},
  ];
  for (const kind of kinds) {
    let last = -1;
    for (let pages = 0; pages <= 101; pages++) {
      const f = fillFor({ pages, more: pages < 101, ...kind });
      const label = `${JSON.stringify(kind)} at page ${pages}`;
      assert.ok(f.read >= 0 && f.read <= 1, label);
      assert.ok(f.unknown >= 0 && f.unknown <= 1, label);
      assert.ok(f.read + f.unknown <= 1 + 1e-12, label);
      assert.ok(f.read >= last - 1e-12, `${label}: went down`);
      last = f.read;
    }
    assert.equal(last, 1, `${JSON.stringify(kind)} ends whole`);
  }
});

test('scanBars is as it was', () => {
  const p = person('bo-larsen');
  const reach = reachIndex([p], [], { read: [p.profile_url], lists: { [p.profile_url]: { pages: 15, more: true, total: 300 } } });
  assert.equal(scanBars(p, reach), 3);
  assert.equal(ringSegments(10).length, 5);
});

// Where a path is at a fraction of a turn: clockwise from the top.
const at = (r, f) => {
  const t = -Math.PI / 2 + 2 * Math.PI * f;
  return `${(r * Math.cos(t)).toFixed(2)} ${(r * Math.sin(t)).toFixed(2)}`;
};

test('arcPath: from the top, clockwise, the long way round past half a turn', () => {
  assert.equal(arcPath(10, 0, 0.25), `M${at(10, 0)} A10 10 0 0 1 ${at(10, 0.25)}`);
  assert.equal(arcPath(10, 0, 0.25), 'M0.00 -10.00 A10 10 0 0 1 10.00 0.00');
  assert.equal(arcPath(10, 0.1, 0.8), `M${at(10, 0.1)} A10 10 0 1 1 ${at(10, 0.8)}`);
  assert.equal(arcPath(10, 0.3, 0.3), null, 'no length, no path');
  assert.equal(arcPath(10, 0.6, 0.2), null, 'never backwards');
  // A whole turn is two halves: an arc ending where it starts draws nothing.
  assert.equal(arcPath(10, 0, 1), `M${at(10, 0)} A10 10 0 1 1 ${at(10, 0.5)} A10 10 0 1 1 ${at(10, 0)}`);
  assert.equal(arcPath(10, -1, 2), arcPath(10, 0, 1), 'held to one turn');
});

test('fillArcs: read, then the rest, then the unknown band at the end', () => {
  assert.deepEqual(fillArcs(12, null), { read: null, rest: null, unknown: null });
  const whole = fillArcs(12, { read: 1, unknown: 0 });
  assert.equal(whole.read, arcPath(12, 0, 1));
  assert.equal(whole.rest, null);
  assert.equal(whole.unknown, null);
  const part = fillArcs(12, { read: 0.14, unknown: 0.3 });
  assert.equal(part.read, arcPath(12, 0, 0.14));
  assert.equal(part.rest, arcPath(12, 0.14, 0.7));
  assert.equal(part.unknown, arcPath(12, 0.7, 1));
  // Past what's known the read part runs into the band, and the band shrinks from its start.
  const filling = fillArcs(12, { read: 0.85, unknown: 0.15 });
  assert.equal(filling.read, arcPath(12, 0, 0.85));
  assert.equal(filling.rest, null);
  assert.equal(filling.unknown, arcPath(12, 0.85, 1));
  // Nothing read yet: no read part, the ring is still there.
  const none = fillArcs(12, { read: 0, unknown: 0.3 });
  assert.equal(none.read, null);
  assert.equal(none.rest, arcPath(12, 0, 0.7));
  // Too much is held to one ring.
  const over = fillArcs(12, { read: 0.9, unknown: 0.5 });
  assert.equal(over.unknown, arcPath(12, 0.9, 1));
});

test('fillArcs draws the same shape for every scanFill', () => {
  for (const list of [{ pages: 6, more: true, total: 120 }, { pages: 75, more: true, connections: 500, connectionsPlus: true }, { pages: 10, more: true }]) {
    const f = fillFor(list);
    const arcs = fillArcs(9, f);
    for (const d of Object.values(arcs)) {
      if (d) assert.match(d, /^M-?[\d.]+ -?[\d.]+( A9 9 0 [01] 1 -?[\d.]+ -?[\d.]+)+$/);
    }
  }
});
