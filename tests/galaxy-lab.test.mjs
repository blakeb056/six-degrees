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

test('the sliders are always on: with none moved, the layout is today\'s', () => {
  assert.equal(labNow().on, true);
  assert.equal(effectiveLab(labNow()), LAB_DEFAULTS);
  assert.equal(effectiveLab({ ...LAB_DEFAULTS, push: 40 }).push, 40);
  assert.equal(effectiveLab({ ...LAB_DEFAULTS, push: 40, labels: false }).labels, false);
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

import { heatColour, heatOf } from '../lib/galaxy-lab.js';

test('heat: power as a thermal map, spread across whoever is shown', () => {
  assert.equal(heatColour(0), '#2b1b6b');
  assert.equal(heatColour(1), '#fff3b0');
  assert.equal(heatColour(-3), heatColour(0));
  assert.match(heatColour(0.5), /^#[0-9a-f]{6}$/);
  const people = [{ power_score: 2 }, { power_score: '9.1' }, { power_score: 5 }, { power_score: 5 }];
  const heat = heatOf(people);
  assert.deepEqual(people.map(heat), [0, 1, 0.5, 0.5]);   // equal scores share a heat
  assert.equal(heatOf([{ power_score: 4 }])({ power_score: 4 }), 1);
  const scheme = colourScheme('heat', people, tiers);
  assert.equal(scheme.of(people[1]), '#fff3b0');
  assert.equal(scheme.heat(people[0]), 0);
  assert.equal(scheme.legend.length, 4);
});

import { ORBIT, CLUSTERS, LAYOUT_LOOKS, FORCE_KEYS, layoutOf } from '../lib/galaxy-lab.js';

test('layouts: Rings as always, Orbit and Clusters by their sliders, your own otherwise', () => {
  assert.equal(layoutOf(LAB_DEFAULTS), 'rings');
  assert.equal(layoutOf({ ...LAB_DEFAULTS, ...ORBIT }), 'orbit');
  assert.equal(layoutOf({ ...LAB_DEFAULTS, ...CLUSTERS }), 'clusters');
  assert.equal(layoutOf({ ...LAB_DEFAULTS, ...ORBIT, push: 7 }), null);
  assert.ok(ORBIT.rings > LAB_DEFAULTS.rings);   // every tier held on its orbit
});

test('Clusters is Obsidian\'s graph: no rings, a center force, everyone sized by their lines; Orbit and the look are not part of it', () => {
  assert.equal(CLUSTERS.rings, 0);
  assert.ok(CLUSTERS.gravity > 0);
  assert.equal(CLUSTERS.sizeBy, 'links');
  assert.equal(LAB_DEFAULTS.orbit, 0);           // still, until you turn it
  // Turning the map, or a picked layout's thicker lines, doesn't make it someone else's layout.
  assert.equal(layoutOf({ ...LAB_DEFAULTS, ...CLUSTERS, orbit: 2, ...LAYOUT_LOOKS.clusters }), 'clusters');
  assert.deepEqual(FORCE_KEYS, ['gravity', 'rings', 'push', 'pull', 'distance']);
});

test('the branch light-up starts off, even in a setting saved when it was on', async () => {
  assert.equal(LAB_DEFAULTS.branch, false);
  const store = new Map([['six-degrees-galaxy-lab', JSON.stringify({ branch: true, push: 40 })]]);
  globalThis.localStorage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, v) };
  try {
    const fresh = await import('../lib/galaxy-lab.js?saved-before-v2');
    assert.equal(fresh.labNow().branch, false);
    assert.equal(fresh.labNow().push, 40);              // the rest of the setting kept
    fresh.setLab({ branch: true });                      // turned back on: it stays on
    const again = await import('../lib/galaxy-lab.js?saved-at-v2');
    assert.equal(again.labNow().branch, true);
  } finally { delete globalThis.localStorage; }
});

test('Network Circle\'s notch and the Physics panel pick a layout the same way, Rings · Clusters · Orbit', async () => {
  // A copy of the module of its own, so the sliders it moves are its own.
  const lab = await import('../lib/galaxy-lab.js?notch-layouts');
  assert.deepEqual(lab.LAYOUTS.map((l) => l.key), ['rings', 'clusters', 'orbit']);
  const fit = lab.clockNow().fit;
  lab.pickLayout('clusters');
  assert.equal(lab.layoutNow(), 'clusters');
  assert.equal(lab.labNow().lines, LAYOUT_LOOKS.clusters.lines);
  assert.equal(lab.clockNow().fit, fit + 1);          // then everyone on screen once it settles
  lab.pickLayout('orbit');
  assert.equal(lab.layoutNow(), 'orbit');
  lab.setLab({ push: 7 });                            // a slider of your own: no layout is lit
  assert.equal(lab.layoutNow(), null);
  lab.pickLayout('rings');
  assert.equal(lab.layoutNow(), 'rings');
  assert.equal(lab.labNow().sizeBy, 'power');
  lab.pickLayout('nonsense');                         // not a layout: nothing moves
  assert.equal(lab.layoutNow(), 'rings');
});

test('Physics starts on, and is a switch of its own: not part of a saved layout', async () => {
  const { LAYOUT_KEYS } = await import('../lib/galaxy-layouts.js');
  assert.equal(LAB_DEFAULTS.physics, true);
  assert.equal(LAYOUT_KEYS.includes('physics'), false);
});

test('Reset to today\'s layout keeps Physics as you left it, as it keeps Names', async () => {
  const { setLab } = await import('../lib/galaxy-lab.js');
  setLab({ physics: false, push: 80 });
  setLab(null);
  assert.equal(labNow().physics, false);
  assert.equal(labNow().push, LAB_DEFAULTS.push);
  setLab({ physics: true });
});
