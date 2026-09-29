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
  assert.equal(effectiveLab({ ...LAB_DEFAULTS, push: 40, labels: false }).labels, false);
  assert.equal(effectiveLab({ ...LAB_DEFAULTS, push: 40, labels: false }).push, 15);
  assert.equal(effectiveLab({ ...LAB_DEFAULTS, on: true, push: 40 }).push, 40);
});

import { colourScheme, findMatches, milestones, chapterAt, mergeSocial } from '../lib/galaxy-lab.js';

const tiers = { S: '#FFD700', A: '#9B59B6', B: '#3498DB', C: '#95A5A6', D: '#BDC3C7' };
const url = (s) => `https://www.linkedin.com/in/${s}`;

test('colour by: tier as always, degree, the most common companies, warmth', () => {
  const people = [
    { id: 1, degree: 1, tier: 'S', company: 'Hooli', profile_url: url('ana') },
    { id: 2, degree: 1, tier: 'A', company: 'hooli ', profile_url: url('ben') },
    { id: 3, degree: 2, tier: 'B', company: 'Pied Piper' },
    { id: 4, degree: 2, tier: 'B', company: 'Pied Piper' },
    { id: 5, degree: 1, tier: 'C', company: 'Initech', profile_url: url('cy') },
  ];
  assert.equal(colourScheme('tier', people, tiers).of(people[0]), '#FFD700');
  const deg = colourScheme('degree', people, tiers);
  assert.notEqual(deg.of(people[0]), deg.of(people[2]));
  const co = colourScheme('company', people, tiers);
  assert.equal(co.of(people[0]), co.of(people[1]));          // Hooli, however it's typed
  assert.notEqual(co.of(people[0]), co.of(people[2]));
  assert.equal(co.of(people[4]), co.legend.at(-1)[1]);       // Initech: only one, so Other
  const day = 86400000;
  const social = mergeSocial({ asOf: 400 * day, people: { [url('ana')]: { last: 395 * day, total: 4, recent: 2 }, [url('ben')]: { last: 10 * day, total: 1, recent: 0 } } });
  const warm = colourScheme('warmth', people, tiers, social);
  assert.equal(warm.of(people[0]), warm.legend[0][1]);       // warm
  assert.equal(warm.of(people[1]), warm.legend[2][1]);       // dormant
  assert.equal(warm.of(people[4]), warm.legend[3][1]);       // never messaged
  assert.equal(colourScheme('warmth', people, tiers, null).of(people[0]), '#FFD700');   // no Social data: tier
});

test('find matches name, company or role, from two letters', () => {
  const nodes = [{ id: 'a', name: 'Ana Ruiz', company: 'Hooli' }, { id: 'b', name: 'Ben Ode', role: 'Head of Growth' }];
  assert.equal(findMatches(nodes, 'h'), null);
  assert.deepEqual([...findMatches(nodes, 'hoo')], ['a']);
  assert.deepEqual([...findMatches(nodes, 'GROWTH')], ['b']);
});

test('milestones and the job you were at', () => {
  const social = { chapters: [{ company: 'Hooli', from: 100, to: 200 }, { company: 'Initech', from: 300, to: null }], posts: [{ t: 150 }] };
  assert.deepEqual(milestones(social).map((m) => m.kind), ['job', 'post', 'job']);
  assert.equal(chapterAt(social, 150).company, 'Hooli');
  assert.equal(chapterAt(social, 250), null);
  assert.equal(chapterAt(social, 900).company, 'Initech');
});

test('who wrote last comes from the live sync where the export is missing or older', async () => {
  const { repliesWaiting } = await import('../lib/linkedin-export.js');
  const day = 86400000;
  const { merged, asOf } = mergeSocial({
    asOf: 100 * day,
    people: {
      [url('ana')]: { last: 90 * day, lastFromThem: false, total: 3, recent: 1 },
      [url('ben')]: { last: 95 * day, lastFromThem: true, total: 2, recent: 1 },
    },
    live: {
      [url('ana')]: { last: 110 * day, unread: 1, lastFromThem: true },        // newer: Ana wrote since
      [url('ben')]: { last: 80 * day, unread: 0, lastFromThem: false },        // older: the export's word stands
      [url('cy')]: { last: 105 * day, unread: 0, lastFromThem: true },         // not in the export at all
      [url('dee')]: { last: 104 * day, unread: 0, lastFromThem: null },        // unknown stays unknown
    },
  });
  assert.equal(merged.get(url('ana')).lastFromThem, true);
  assert.equal(merged.get(url('ben')).lastFromThem, true);
  assert.equal(merged.get(url('cy')).lastFromThem, true);
  assert.equal(merged.get(url('dee')).lastFromThem, undefined);
  const waiting = repliesWaiting({ asOf, people: new Map([...merged].filter(([, v]) => v.lastFromThem != null)) });
  // As of Ana's newest message: Cy wrote 5 days before, Ben 15; Ana's is too fresh to owe.
  assert.deepEqual(waiting.map((w) => [w.url, w.days]), [[url('cy'), 5], [url('ben'), 15]]);
});
