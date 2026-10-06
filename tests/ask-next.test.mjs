// Separation's "Top 10 you haven't asked" moves on as you ask (lib/ask-next.js).
// Blake, 2026-10-06: once he added someone, "nothing refreshes ... they are all
// the same". Auto's request takes its person out the moment it's sent, the
// next-best fills the place, a queued one stays (marked), a failed one comes
// back. Invented people.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { autoAsks, autoAsksSignature, askStatus, leavesTop, topToAsk } from '../lib/ask-next.js';

// Twelve people, best first; each has two rows (two bridges' copies).
const people = Array.from({ length: 12 }, (_, i) => ({ key: `https://www.linkedin.com/in/p${i}`, name: `Person ${i}` }));
const rowToKey = new Map(people.flatMap((p, i) => [[`d2-${i}@a`, p.key], [`d2-${i}@b`, p.key]]));
const keyOf = (id) => rowToKey.get(id) ?? null;
const idle = { running: false, action: null, target: null, queue: { items: [] }, recent: [] };

/** The top ten for this scanner answer, and these already asked. */
function topFor(scan, { asked = new Set(), undone = new Set() } = {}) {
  const auto = autoAsks(scan, keyOf);
  const statusOf = (p) => askStatus({ requested: asked.has(p.key), undone: undone.has(p.key), auto: auto.get(p.key) ?? null });
  return topToAsk(people, statusOf, 10).map((p) => p.name);
}

const names = (...n) => n.map((i) => `Person ${i}`);
const sending = (id) => ({ ...idle, running: true, action: 'connect', target: { id, name: 'x' } });
const ended = (id, outcome, startedAt = 1) => ({ ...idle, recent: [{ action: 'connect', target: { id }, startedAt, outcome }] });
const queued = (...ids) => ({ ...idle, queue: { items: ids.map((id, i) => ({ id: `q${i}`, kind: 'add', action: 'connect', status: 'waiting', target: { id } })) } });

test('nothing asked: the first ten, each once', () => {
  const top = topFor(idle);
  assert.deepEqual(top, names(0, 1, 2, 3, 4, 5, 6, 7, 8, 9));
  assert.equal(new Set(top).size, 10);
});

test('asked people are left out and the next-best fills in', () => {
  assert.deepEqual(topFor(idle, { asked: new Set([people[0].key, people[3].key]) }), names(1, 2, 4, 5, 6, 7, 8, 9, 10, 11));
});

test('Auto sending a request takes them out at once, by any of their rows', () => {
  assert.deepEqual(topFor(sending('d2-2@b')), names(0, 1, 3, 4, 5, 6, 7, 8, 9, 10));
});

test('a request LinkedIn showed pending keeps them out after the job ends', () => {
  assert.deepEqual(topFor(ended('d2-2@a', 'sent')), names(0, 1, 3, 4, 5, 6, 7, 8, 9, 10));
  assert.deepEqual(topFor(ended('d2-2@a', 'already-pending')), names(0, 1, 3, 4, 5, 6, 7, 8, 9, 10));
});

test('a failed send puts them back where they were', () => {
  for (const outcome of ['unclear', 'no-connect', 'stopped', undefined]) {
    assert.deepEqual(topFor(ended('d2-2@a', outcome)), names(0, 1, 2, 3, 4, 5, 6, 7, 8, 9), String(outcome));
  }
  // Sent before, failed since: the newest ending stands (recent is newest first).
  const both = { ...idle, recent: [
    { action: 'connect', target: { id: 'd2-2@a' }, startedAt: 2, outcome: 'unclear' },
    { action: 'connect', target: { id: 'd2-2@b' }, startedAt: 1, outcome: 'sent' },
  ] };
  assert.equal(autoAsks(both, keyOf).has(people[2].key), false);
});

test('queued stays in the top, marked, until its turn sends it', () => {
  const q = queued('d2-1@a', 'd2-4@b');
  assert.deepEqual(topFor(q), names(0, 1, 2, 3, 4, 5, 6, 7, 8, 9));
  assert.equal(autoAsks(q, keyOf).get(people[1].key), 'queued');
  // Its turn: sending, so out; Person 4 still waits.
  const turn = { ...sending('d2-1@a'), queue: { items: [{ id: 'q1', kind: 'add', action: 'connect', status: 'waiting', target: { id: 'd2-4@b' } }] } };
  assert.deepEqual(topFor(turn), names(0, 2, 3, 4, 5, 6, 7, 8, 9, 10));
  assert.equal(autoAsks(turn, keyOf).get(people[4].key), 'queued');
  // A circle scan waiting in the queue is not a request.
  const circle = { ...idle, queue: { items: [{ id: 'q', kind: 'circle', action: 'bridge', status: 'waiting', target: { id: 'd2-0@a' } }] } };
  assert.equal(autoAsks(circle, keyOf).size, 0);
});

test('a request you took back is not brought back by an old Auto job', () => {
  assert.deepEqual(topFor(ended('d2-2@a', 'sent'), { undone: new Set([people[2].key]) }), names(0, 1, 2, 3, 4, 5, 6, 7, 8, 9));
});

test('statuses: who leaves the top', () => {
  assert.equal(askStatus({ connected: true, auto: 'queued' }), 'connected');
  assert.equal(askStatus({ requested: true, auto: 'sending' }), 'asked');
  assert.equal(askStatus({ auto: 'queued' }), 'queued');
  assert.equal(askStatus({}), null);
  assert.deepEqual(['connected', 'asked', 'sending', 'queued', null].map(leavesTop), [true, true, true, false, false]);
});

test('the signature moves when a request starts, waits or ends, not with a scan’s pages', () => {
  const a = autoAsksSignature({ ...idle, running: true, action: 'bridge', target: { id: 'p-1' }, progress: 3 });
  const b = autoAsksSignature({ ...idle, running: true, action: 'bridge', target: { id: 'p-1' }, progress: 9 });
  assert.equal(a, b);
  assert.notEqual(autoAsksSignature(sending('d2-1@a')), autoAsksSignature(idle));
  assert.notEqual(autoAsksSignature(queued('d2-1@a')), autoAsksSignature(idle));
  assert.notEqual(autoAsksSignature(ended('d2-1@a', 'sent')), autoAsksSignature(ended('d2-1@a', 'unclear')));
});
