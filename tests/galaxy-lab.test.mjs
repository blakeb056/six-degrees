import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bornTimes, reachCounts, labNow, LAB_DEFAULTS, effectiveLab } from '../lib/galaxy-lab.js';

// Invented people only.
const nodes = [
  { id: '__center__', degree: 0 },
  { id: 'ana', degree: 1, connected_date: '2020-03-01' },
  { id: 'ben', degree: 1, connected_date: '2023-07-15' },
  { id: 'cy', degree: 1 },                                  // no date
  { id: 'dee', degree: 2 },                                 // in Ana's circle
  { id: 'eli', degree: 2 },                                 // in Ben's circle
  { id: 'fay', degree: 1, connected_date: '2024-01-02' },   // added through Dee's... via Ana
  { id: 'gus', degree: 2 },                                 // circle not drawn
];
const parentOf = new Map([['dee', 'ana'], ['eli', 'ben'], ['fay', 'ana']]);

test('replay: connections on their date, circles with them, undated from the start', () => {
  const born = Object.fromEntries(nodes.map((n, i) => [n.id, bornTimes(nodes, parentOf)[i]]));
  assert.equal(born.ana, Date.parse('2020-03-01'));
  assert.equal(born.dee, born.ana);
  assert.equal(born.eli, Date.parse('2023-07-15'));
  assert.equal(born.cy, -Infinity);
  assert.equal(born.gus, -Infinity);
  assert.equal(born.fay, Date.parse('2024-01-02'));   // later than Ana, so its own date
});

test('reach counts everyone hanging off a dot, all the way down', () => {
  const pm = new Map([...parentOf, ['hal', 'dee']]);
  const r = reachCounts([...nodes, { id: 'hal', degree: 3 }], pm);
  assert.equal(r.get('ana'), 3);   // dee, fay, hal
  assert.equal(r.get('dee'), 1);
  assert.equal(r.get('ben'), 1);
  assert.equal(r.get('cy'), 0);
});

test('without a browser the lab is off and the layout is today\'s', () => {
  assert.equal(labNow().on, false);
  assert.equal(effectiveLab({ ...LAB_DEFAULTS, push: 40 }), LAB_DEFAULTS);
  assert.equal(effectiveLab({ ...LAB_DEFAULTS, on: true, push: 40 }).push, 40);
});
