// Exclusive reach: who among your bridges is irreplaceable (lib/brokerage.js).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { exclusiveReach } from '../lib/brokerage.js';

const url = (s) => `https://www.linkedin.com/in/${s}`;
const d2 = (bridge, who) => ({ id: `${bridge}-${who}`, degree: 2, source_connection_id: bridge, profile_url: url(who) });

test('someone only one bridge reaches counts 1 to them; shared people split between bridges', () => {
  const rows = [d2('maya', 'ann'), d2('maya', 'bo'), d2('maya', 'cy'), d2('tom', 'cy'), d2('tom', 'di'), d2('lee', 'cy')];
  const r = exclusiveReach(rows, []);
  assert.deepEqual(r.get('maya'), { reach: 2 + 1 / 3, only: 2, total: 3 });
  assert.deepEqual(r.get('tom'), { reach: 1 + 1 / 3, only: 1, total: 2 });
  assert.deepEqual(r.get('lee'), { reach: 1 / 3, only: 0, total: 1 });
  const sum = [...r.values()].reduce((s, x) => s + x.reach, 0);
  assert.ok(Math.abs(sum - 4) < 1e-9, 'every person reached counts once in all');
});

test('your own connections need no bridge; the same person twice in one circle counts once', () => {
  const rows = [d2('maya', 'ann'), d2('maya', 'ann/'), d2('maya', 'zed'), d2('tom', 'zed')];
  const r = exclusiveReach(rows, [{ id: 'z', profile_url: url('zed') }]);
  assert.deepEqual(r.get('maya'), { reach: 1, only: 1, total: 1 });
  assert.equal(r.get('tom'), undefined);
  assert.equal(exclusiveReach().size, 0);
});

test('bridge overlap: each connection\'s closest twin, by the share of doors both open', async () => {
  const { bridgeOverlap, redundancy } = await import('../lib/brokerage.js');
  const rows = [
    d2('maya', 'ann'), d2('maya', 'bo'), d2('maya', 'cy'), d2('maya', 'di'),
    d2('tom', 'bo'), d2('tom', 'cy'), d2('tom', 'di'), d2('tom', 'ed'),
    d2('lee', 'di'), d2('lee', 'fay'),
  ];
  const o = bridgeOverlap(rows, []);
  assert.equal(o.get('maya').with, 'tom');
  assert.equal(o.get('maya').shared, 3);
  assert.ok(Math.abs(o.get('maya').share - 3 / 5) < 1e-9, 'maya ∩ tom = 3 of 5 people either reaches');
  assert.equal(o.get('lee').with, 'maya');
  assert.equal(o.get('lee').shared, 1);
  // People: ann, bo, cy, di, ed, fay = 6; reached 2+ ways: bo, cy, di = 3.
  assert.ok(Math.abs(redundancy(rows, []) - 0.5) < 1e-9);
  assert.equal(bridgeOverlap([], []).size, 0);
  assert.equal(redundancy(), 0);
});
