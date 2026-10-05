// Degrees' Unscanned view: who is in it (lib/reach.js notScannedYet), and the
// circle that forms while one of theirs is scanned (lib/forming-circle.js).
//
// Blake, 2026-10-04: "its imediatalyl aniamting ones adding into the cluster
// … come back and fourth seeing the progress, it can just be time based on
// every dot being added". These pin the clock (a dot at once, then one every
// page-wait / 10 at the scanner's pace), that it never runs more than a page
// past what the scanner has read, that the real counts always win, that the
// same moment gives the same circle however often it's left and opened again,
// and that a dot never moves once it has joined. Invented people.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { reachIndex, notScannedYet } from '../lib/reach.js';
import { formingCount, formingSlots, formingPlan, formingSpacing, dotInterval, PER_PAGE, MOST_DOTS } from '../lib/forming-circle.js';

const url = (id) => `https://www.linkedin.com/in/${id}`;
const d1 = (id, extra = {}) => ({ id, name: id, degree: 1, tier: 'A', power_score: 6, profile_url: url(id), ...extra });

test('who is unscanned: your connections with no circle, minus what the scanner already read; S first, strongest first', () => {
  const jane = d1('jane', { tier: 'S', power_score: 9 });                         // scanned: a bridge, not here
  const marcus = d1('marcus', { unlocked_from_bridge_id: 'jane', power_score: 3 }); // met through Jane, ready
  const nia = d1('nia');                                                            // list hidden: left out
  const quin = d1('quin');                                                          // read, nobody new: left out
  const ray = d1('ray', { power_score: 8 });
  const sol = d1('sol', { tier: 'S', power_score: 5 });
  const tom = d1('tom', { tier: 'S', power_score: 7 });
  const people = [jane, marcus, nia, quin, ray, sol, tom];
  const degree2 = [{ id: 'tia@jane', degree: 2, source_connection_id: 'jane', profile_url: url('tia') }];
  const reach = reachIndex(people, degree2, { skips: [{ profileUrl: url('nia') }], read: [url('quin')] });
  const { todo, hidden, read } = notScannedYet(people, reach);
  assert.deepEqual(todo.map((r) => r.id), ['tom', 'sol', 'ray', 'marcus']);
  assert.equal(hidden, 1);
  assert.equal(read, 1);
  // A 2nd-degree row is never one of yours to build.
  assert.deepEqual(notScannedYet([{ ...d1('x'), degree: 2 }], reach).todo, []);
  assert.deepEqual(notScannedYet([], reach), { todo: [], hidden: 0, read: 0 });
});

const T0 = 1_791_000_000_000;
const FAST = dotInterval('fast');

test('the clock: a dot at once, then one every page-wait / 10 at the scanner’s pace', () => {
  assert.equal(FAST, 2600, 'Fast: 6 s a page and 20 s before it, ten people a page');
  assert.ok(dotInterval('medium') > FAST && dotInterval('slow') > dotInterval('medium'));
  assert.equal(dotInterval('nonsense'), FAST, 'an unknown pace is Fast, as the scanner reads it');
  const at = (ms, extra = {}) => formingCount({ startedAt: T0, now: T0 + ms, found: 0, ...extra });
  assert.equal(at(0).shown, 1, 'the first at once');
  assert.equal(at(FAST - 1).shown, 1);
  assert.equal(at(FAST).shown, 2);
  assert.equal(at(FAST * 5 + 10).shown, 6);
  assert.equal(at(FAST * 5 + 10).ghosts, 6, 'nobody saved yet: every dot is on its way');
  assert.equal(at(FAST * 5 + 10).nextIn, FAST - 10);
  const slow = formingCount({ startedAt: T0, now: T0 + FAST * 5 + 10, found: 0, pace: 'slow' });
  assert.ok(slow.shown < 6, 'slower at Slow');
});

test('the clock never runs more than a page past what the scanner has read', () => {
  // Five minutes in and nothing read yet (opening their profile, say): one page of dots, then it waits.
  const waiting = formingCount({ startedAt: T0, now: T0 + 300_000, found: 0 });
  assert.equal(waiting.shown, PER_PAGE);
  assert.equal(waiting.nextIn, null, 'waiting for the scanner');
  const after2 = formingCount({ startedAt: T0, now: T0 + 300_000, found: 20 });
  assert.equal(after2.shown, 30);
  // Never past the cap, whatever the clock says.
  assert.equal(formingCount({ startedAt: T0, now: T0 + 1e9, found: 5000 }).shown, 5000, 'what it read wins over the cap');
  assert.equal(formingCount({ startedAt: T0, now: T0 + 1e9, found: MOST_DOTS }).shown, MOST_DOTS);
  assert.equal(formingCount({ startedAt: T0, now: T0 + 1e9, found: 0, cap: 4 }).shown, 4);
});

test('the real counts win: what it has read and saved, when they are ahead of the clock', () => {
  // Ten seconds in, the scanner has read three pages: the clock catches up.
  const quick = formingCount({ startedAt: T0, now: T0 + 10_000, found: 30, saved: 0 });
  assert.equal(quick.shown, 30);
  assert.equal(quick.nextIn, 30 * FAST - 10_000, 'and carries on from there at its pace');
  // Saved people are dots too, the first ones, in their colours.
  const saved = formingCount({ startedAt: T0, now: T0 + 10_000, found: 30, saved: 27 });
  assert.equal(saved.real, 27);
  assert.equal(saved.ghosts, 3);
  // More saved than read (a save that landed before its "found" line was seen): never fewer dots than people.
  assert.equal(formingCount({ startedAt: T0, now: T0, found: 0, saved: 50 }).shown, 50);
});

test('before the scanner has it, and once it is over: only the people saved, no dots on their way', () => {
  assert.deepEqual(
    formingCount({ startedAt: null, now: T0, found: 0, saved: 0 }),
    { shown: 0, real: 0, ghosts: 0, clock: 0, nextIn: null, interval: FAST },
  );
  const over = formingCount({ startedAt: T0, now: T0 + 600_000, found: 120, saved: 96, running: false });
  assert.equal(over.shown, 96);
  assert.equal(over.ghosts, 0);
});

test('come back and forth: the circle at a moment is the same however often it was left and opened again', () => {
  const facts = (now) => ({ startedAt: T0, now, found: Math.floor((now - T0) / 26_000) * PER_PAGE, saved: 0 });
  // Watched all along, a look every second…
  let watched = null;
  for (let t = T0; t <= T0 + 95_000; t += 1000) watched = formingCount(facts(t));
  // …or left at 30 s and opened again at 95 s.
  formingCount(facts(T0 + 30_000));
  const back = formingCount(facts(T0 + 95_000));
  assert.deepEqual(back, watched);
  assert.ok(back.shown > PER_PAGE, `it carried on while away: ${back.shown}`);
});

test('a dot never moves once it has joined: its place is the same however many come after it', () => {
  const room = { inner: 80, spacing: 14 };
  const early = formingSlots(20, room);
  const later = formingSlots(400, room);
  for (let j = 0; j < early.length; j++) assert.deepEqual(later[j], early[j]);
  // Clockwise from twelve, ring by ring from the middle out.
  assert.ok(Math.abs(early[0].x) < 1e-9 && early[0].y < 0, 'the first at twelve');
  assert.ok(early[1].x > 0, 'the next clockwise');
  const r = (p) => Math.hypot(p.x, p.y);
  for (let j = 1; j < later.length; j++) assert.ok(r(later[j]) >= r(later[j - 1]) - 1e-9);
  // Neighbours on a ring keep the spacing.
  const ring0 = later.filter((p) => p.ring === 0);
  assert.ok(Math.hypot(ring0[1].x - ring0[0].x, ring0[1].y - ring0[0].y) >= 14 - 1e-9);
  assert.deepEqual(formingSlots(0, room), []);
});

test('the room it plans for: the spacing changes only when the count passes a plan, and the plan fits', () => {
  assert.equal(formingPlan(0), 40);
  assert.equal(formingPlan(40), 40);
  assert.equal(formingPlan(41), 120);
  assert.equal(formingPlan(999), 1000);
  assert.equal(formingPlan(1001), 2000);
  const room = { inner: 106, outer: 333 };   // a 1440×900 window (maxR 355)
  for (const plan of [40, 120, 300, 1000]) {
    const spacing = formingSpacing(plan, room);
    const slots = formingSlots(plan, { inner: room.inner, spacing });
    const edge = Math.max(...slots.map((p) => Math.hypot(p.x, p.y)));
    assert.ok(edge <= room.outer + 1e-6, `${plan} fit: ${edge.toFixed(0)}`);
  }
  assert.ok(formingSpacing(40, room) > formingSpacing(1000, room), 'roomier for fewer');
  assert.equal(formingSpacing(40, room), 26, 'as roomy as it gets');
});

test('Bridge Chains’ place: the unscanned until there is a bridge, and the circle being built there keeps it until it ends', async () => {
  const { bridgeChainsSlot } = await import('../lib/reach.js');
  const none = new Set();
  const one = new Set(['nils']);
  // No bridge: the unscanned, to build the first. A CSV or the sample can't scan: the page says why.
  assert.deepEqual(bridgeChainsSlot({ bridgeIds: none }), { show: 'unscanned', held: null, open: null });
  assert.equal(bridgeChainsSlot({ bridgeIds: none, canScan: false }).show, 'empty');
  assert.equal(bridgeChainsSlot({ bridgeIds: one, canScan: false }).show, 'chain');
  // One or more bridges and nothing built from here: back to normal.
  assert.deepEqual(bridgeChainsSlot({ bridgeIds: one }), { show: 'chain', held: null, open: null });
  // Nils's circle is built from it; its first save makes him a bridge mid-scan, and it stays put.
  let s = bridgeChainsSlot({ bridgeIds: none, scanning: 'nils' });
  assert.deepEqual(s, { show: 'unscanned', held: 'nils', open: null });
  s = bridgeChainsSlot({ bridgeIds: one, scanning: 'nils', held: s.held });
  assert.deepEqual(s, { show: 'unscanned', held: 'nils', open: null });
  // It ends: Bridge Chains, with his circle open, once.
  s = bridgeChainsSlot({ bridgeIds: one, scanning: null, held: s.held });
  assert.deepEqual(s, { show: 'chain', held: null, open: 'nils' });
  assert.deepEqual(bridgeChainsSlot({ bridgeIds: one, scanning: null, held: s.held }), { show: 'chain', held: null, open: null });
  // Ended with nobody saved: still no bridge, still the unscanned; if a bridge comes later from
  // someone else, it's normal Bridge Chains and nobody's circle is forced open.
  s = bridgeChainsSlot({ bridgeIds: none, scanning: null, held: 'otto' });
  assert.equal(s.show, 'unscanned');
  assert.deepEqual(bridgeChainsSlot({ bridgeIds: one, scanning: null, held: s.held }), { show: 'chain', held: null, open: null });
  // A scan of someone else, started elsewhere once there are bridges, never swaps the view.
  assert.equal(bridgeChainsSlot({ bridgeIds: one, scanning: 'ray' }).show, 'chain');
});
