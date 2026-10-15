import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { makeGazetteer, placeFor } from '../lib/places.js';
import {
  bridgeIdOf, circlesByBridge, reachOf, gettersTo, homeOf, fromYou, firstDegreeAt, filterPeople, keepPlaces, strongAt,
  filterChips, clearChip, NO_FILTERS, locatedLine, findOnMap, companiesOf, arcPoints, arcPath, arcWidth, arcMotion,
  prefersReducedMotion, glowKeys,
} from '../lib/map-lines.js';

// The Map tab's lines, filters and finder (lib/map-lines.js). Invented people only.

const read = (rel) => readFileSync(new URL(rel, import.meta.url), 'utf8');

const gaz = () => makeGazetteer({
  countries: [['US', 'United States', 39.8, -98.6], ['GB', 'United Kingdom', 54, -2]],
  regions: [['US', 'Florida', 28, -82], ['US', 'Texas', 31, -99], ['US', 'New York', 42.9, -75.5], ['GB', 'England', 52.3, -1.5]],
  cities: [
    ['Orlando', 0, 28.54, -81.38, 300000], ['Austin', 1, 30.27, -97.74, 960000],
    ['New York City', 2, 40.71, -74.01, 8800000], ['London', 3, 51.51, -0.13, 8900000],
  ],
});

const ORL = 'Orlando, Florida, United States';
const AUS = 'Austin, Texas, United States';
const NYC = 'New York City Metropolitan Area';
const LON = 'London, England, United Kingdom';

// Two connections with scanned circles, and one without a location.
const jane = { id: 'j', degree: 1, name: 'Jane Bridge', tier: 'S', location: ORL, profile_url: 'https://www.linkedin.com/in/jane' };
const omar = { id: 'o', degree: 1, name: 'Omar Bridge', tier: 'A', location: NYC, profile_url: 'https://www.linkedin.com/in/omar' };
const nowhere = { id: 'n', degree: 1, name: 'Nadia Nowhere', tier: 'B', location: '', profile_url: 'https://www.linkedin.com/in/nadia' };
const second = (id, via, location, tier = 'B', extra = {}) => ({
  id, degree: 2, source_connection_id: via, name: `Person ${id}`, tier, location, profile_url: `https://www.linkedin.com/in/${id}`, ...extra,
});
const circleRows = [
  second('a1', 'j', AUS, 'S'), second('a2', 'j', AUS, 'B'), second('l1', 'j', LON, 'A'), second('x1', 'j', ''),
  second('a3', 'o', AUS, 'A'), second('n1', 'o', NYC, 'C'),
  // a1 is in Omar's circle too: either can introduce you.
  second('a1', 'o', AUS, 'S'),
  second('a4', 'n', AUS, 'D'),
];
const bridges = new Map([jane, omar, nowhere].map((b) => [b.id, b]));

test('a 2nd-degree row is in the circle of the connection it came through', () => {
  assert.equal(bridgeIdOf({ source_connection_id: 'j' }), 'j');
  assert.equal(bridgeIdOf({ bridge_id: 'k' }), 'k');
  assert.equal(bridgeIdOf({ degree: 1 }), null);
  const circles = circlesByBridge([...circleRows, { id: 'z', degree: 1 }]);
  assert.deepEqual([...circles.keys()].sort(), ['j', 'n', 'o']);
  assert.deepEqual(circles.get('j').map((r) => r.id), ['a1', 'a2', 'l1', 'x1']);
});

test('through whom: a connection\'s circle, place by place, most first, from where they are', () => {
  const g = gaz();
  const circles = circlesByBridge(circleRows);
  const reach = reachOf(g, jane, circles.get('j'));
  assert.equal(reach.from.name, 'Orlando');
  assert.deepEqual(reach.ends.map((e) => [e.name, e.count]), [['Austin', 2], ['London', 1]]);
  assert.equal(reach.unplaced, 1, 'one with no location: counted, no line');
  assert.equal(reach.total, 4);
  // The filters decide who's at the end: shown(row) gives the map's own row, or null.
  const onlyS = reachOf(g, jane, circles.get('j'), (r) => (r.tier === 'S' ? r : null));
  assert.deepEqual(onlyS.ends.map((e) => [e.name, e.count]), [['Austin', 1]]);
  assert.equal(onlyS.total, 1);
  // A connection with no location: no line to draw from, the places still listed.
  const lost = reachOf(g, nowhere, circles.get('n'));
  assert.equal(lost.from, null);
  assert.deepEqual(lost.ends.map((e) => e.name), ['Austin']);
  // The same person twice in one circle counts once.
  assert.equal(reachOf(g, jane, [...circles.get('j'), circles.get('j')[0]]).total, 4);
});

test('who gets me there: the connections who reach a place, weighted, one line per place they live', () => {
  const g = gaz();
  const austin = placeFor(g, AUS);
  const got = gettersTo(g, austin.key, circlesByBridge(circleRows), bridges);
  // Jane reaches a1 and a2, Omar a3 and a1, Nadia a4; a1 counts under both, once in all.
  assert.deepEqual(got.bridges.map((b) => [b.bridge.id, b.count]), [['j', 2], ['o', 2], ['n', 1]]);
  assert.equal(got.people, 4);
  assert.deepEqual(got.starts.map((s) => [s.name, s.count, s.bridges.length]), [['New York City', 2, 1], ['Orlando', 2, 1]]);
  assert.deepEqual(got.unplacedBridges.map((b) => b.bridge.id), ['n'], 'no location: listed, no line');
  // A connection who lives in the place itself has no line to draw.
  const london = placeFor(g, LON);
  const local = gettersTo(g, london.key, circlesByBridge([second('q', 'k', LON)]), new Map([['k', { id: 'k', name: 'Kim', location: LON }]]));
  assert.equal(local.bridges.length, 1);
  assert.deepEqual(local.starts, []);
  // Filters apply to who's there; a bridge no one passes for disappears.
  const filtered = gettersTo(g, austin.key, circlesByBridge(circleRows), bridges, (r) => (r.tier === 'D' ? r : null));
  assert.deepEqual(filtered.bridges.map((b) => b.bridge.id), ['n']);
  // Not one of your connections (their row isn't loaded): skipped, never guessed.
  assert.deepEqual(gettersTo(g, austin.key, circlesByBridge(circleRows), new Map()).bridges, []);
});

test('from you: home is the place you picked, or where most of your connections are, marked guessed', () => {
  const p = (key, name, people) => ({ key, name, label: name, lat: 0, lon: 0, people, count: people.length });
  const places = [
    p('c:1', 'Austin', [{ degree: 2 }, { degree: 2 }, { degree: 2 }, { degree: 1 }]),
    p('c:2', 'Orlando', [{ degree: 1 }, { degree: 1 }, { degree: 2 }]),
    p('c:3', 'London', [{ degree: 1 }]),
    p('c:4', 'Tokyo', [{ degree: 2 }]),
  ];
  assert.equal(firstDegreeAt(places[1]), 2);
  assert.deepEqual(homeOf(places, null), { place: places[1], guessed: true }, 'most 1st-degree, not most people');
  assert.deepEqual(homeOf(places, 'c:3'), { place: places[2], guessed: false });
  assert.equal(homeOf(places, 'c:gone').guessed, true, 'a home the filters hide falls back to the guess');
  assert.equal(homeOf([], null), null);
  const lines = fromYou(places, places[1]);
  assert.deepEqual(lines.map((l) => [l.place.name, l.count]), [['Austin', 1], ['London', 1]], 'only places with connections, never home itself');
  assert.equal(fromYou(places, places[1], 1).length, 1, 'capped');
  assert.deepEqual(fromYou(places, null), []);
});

test('filters: a company, and words in a name, company or headline', () => {
  const rows = [
    { name: 'Ana Ruiz', company: 'Google Cloud', headline: 'Founder in residence' },
    { name: 'Ben Ito', company: 'Google', headline: 'Engineer' },
    { name: 'Cleo Park', company: 'Halcyon', headline: 'Co-founder and CEO' },
    { name: 'Dev Rao', company: '', headline: '' },
  ];
  assert.equal(filterPeople(rows, NO_FILTERS), rows, 'nothing set: the same list, so nothing redraws');
  assert.deepEqual(filterPeople(rows, { ...NO_FILTERS, company: 'google' }).map((r) => r.name), ['Ana Ruiz', 'Ben Ito']);
  assert.deepEqual(filterPeople(rows, { ...NO_FILTERS, text: 'founder' }).map((r) => r.name), ['Ana Ruiz', 'Cleo Park']);
  assert.deepEqual(filterPeople(rows, { ...NO_FILTERS, text: 'ceo  halcyon' }).map((r) => r.name), ['Cleo Park'], 'every word, anywhere');
  assert.deepEqual(filterPeople(rows, { ...NO_FILTERS, company: 'Google', text: 'founder' }).map((r) => r.name), ['Ana Ruiz']);
  assert.deepEqual(filterPeople([{ name: 'Zoë' }], { ...NO_FILTERS, text: 'zoe' }).length, 1, 'accents ignored');
  assert.deepEqual(companiesOf(rows).map((c) => [c.name, c.count]), [['Google', 1], ['Google Cloud', 1], ['Halcyon', 1]]);
});

test('declutter: places with too few people, or too few of tier S or A, are left out; a line\'s ends never are', () => {
  const p = (key, tiers) => ({ key, people: tiers.map((tier) => ({ tier })), count: tiers.length });
  const places = [p('big', ['S', 'A', 'B', 'C', 'D']), p('mid', ['B', 'B', 'C']), p('one', ['S']), p('pair', ['A', 'S'])];
  assert.equal(keepPlaces(places, NO_FILTERS), places);
  assert.deepEqual(keepPlaces(places, { minPeople: 3 }).map((x) => x.key), ['big', 'mid']);
  assert.deepEqual(keepPlaces(places, { minStrong: 2 }).map((x) => x.key), ['big', 'pair']);
  assert.deepEqual(keepPlaces(places, { minPeople: 2, minStrong: 1 }).map((x) => x.key), ['big', 'pair']);
  assert.deepEqual(keepPlaces(places, { minPeople: 25 }, new Set(['one'])).map((x) => x.key), ['one']);
  assert.equal(strongAt(places[0]), 2);
  assert.deepEqual(keepPlaces(places, { minPeople: 0, minStrong: -3 }), places, 'nonsense is no threshold');
});

test('filters show as chips, each cleared on its own', () => {
  const set = { company: 'Halcyon', text: 'founder', minPeople: 5, minStrong: 2 };
  assert.deepEqual(filterChips(set, { through: 'Jane Bridge' }).map((c) => c.key), ['through', 'company', 'text', 'minPeople', 'minStrong']);
  assert.deepEqual(filterChips(set).map((c) => c.label), ['At Halcyon', '“founder”', '5+ per place', '2+ S or A']);
  assert.deepEqual(filterChips(NO_FILTERS), []);
  assert.deepEqual(clearChip(set, 'company'), { ...set, company: '' });
  assert.deepEqual(clearChip(set, 'minPeople'), { ...set, minPeople: 1 });
  assert.equal(clearChip(set, 'through'), set, 'the lines are the map\'s to clear');
  assert.equal(locatedLine(676, 748), '676 of 748 located (90%)');
  assert.equal(locatedLine(0, 0), 'No one yet');
});

test('the finder: your connections with a circle, people, companies and places, the best matches first', () => {
  const index = {
    people: [
      { id: 'j', name: 'Jane Bridge' }, { id: 'p1', name: 'Bridget Lane' }, { id: 'p2', name: 'Abe Jansen' }, { id: 'p3', name: 'Ola Jan' },
    ],
    bridgeIds: new Set(['j']),
    companies: [{ name: 'Janus Labs', count: 3 }, { name: 'Other', count: 9 }],
    places: [{ key: 'c:1', label: 'Jandira, Brazil', count: 1 }],
  };
  assert.deepEqual(findOnMap(index, 'j'), { people: [], bridges: [], companies: [], places: [] }, 'two letters at least');
  const found = findOnMap(index, 'jan');
  assert.deepEqual(found.bridges.map((p) => p.id), ['j']);
  assert.deepEqual(found.people.map((p) => p.id), ['p2', 'p3'], 'a bridge is listed once, as a bridge; word starts first');
  assert.deepEqual(found.companies.map((c) => c.name), ['Janus Labs']);
  assert.deepEqual(found.places.map((p) => p.key), ['c:1']);
  assert.deepEqual(findOnMap(index, 'brid').people.map((p) => p.id), ['p1']);
  assert.equal(findOnMap(index, 'a', 1).people.length, 0);
  assert.equal(findOnMap({ ...index, people: Array.from({ length: 50 }, (_, i) => ({ id: `x${i}`, name: `Jan ${i}` })) }, 'jan', 4).people.length, 4);
});

test('lines follow the great circle, bow gently up the screen, and come apart where the map cuts them', () => {
  const nyc = { lat: 40.71, lon: -74.01 };
  const london = { lat: 51.51, lon: -0.13 };
  const pts = arcPoints(nyc, london, 10);
  assert.equal(pts.length, 11);
  assert.deepEqual(pts[0].map((n) => Math.round(n * 100) / 100), [-74.01, 40.71]);
  assert.deepEqual(pts[10].map((n) => Math.round(n * 100) / 100), [-0.13, 51.51]);
  assert.ok(pts[5][1] > 52, 'the shortest way round runs north of both ends');
  assert.deepEqual(arcPoints(nyc, nyc), [], 'one place is no line');
  assert.deepEqual(arcPoints(nyc, null), []);

  // On screen, a flat line from (0,100) to (100,100) bows up (smaller y) in the middle.
  const flat = Array.from({ length: 5 }, (_, i) => [i * 25, 100]);
  const d = arcPath(flat);
  const ys = [...d.matchAll(/[ML]([\d.-]+),([\d.-]+)/g)].map((m) => Number(m[2]));
  assert.equal(ys[0], 100);
  assert.equal(ys[4], 100);
  assert.ok(ys[2] < 100 - 10, `bowed up: ${ys[2]}`);
  // Either way round it bows up.
  const back = arcPath([...flat].reverse());
  assert.ok(Number(back.match(/L([\d.-]+),([\d.-]+)L([\d.-]+),([\d.-]+)/)[4]) < 100);
  // A cut (the map's edge) draws the pieces, unbowed.
  const cut = arcPath([[700, 50], [780, 52], [20, 55], [60, 58]], { jump: 200 });
  assert.equal(cut.split('M').length - 1, 2);
  assert.match(cut, /^M700,50L780,52M20,55L60,58$/);
  assert.equal(arcPath([[1, 1]]), '');
  assert.equal(arcPath([[0, 0], [NaN, 3]]), '');

  assert.equal(arcWidth(0), 1.2);
  assert.ok(arcWidth(4) > arcWidth(1));
  assert.equal(arcWidth(10000), 7);
});

test('lines draw in, staggered within a second, and not at all when less motion is asked for', () => {
  assert.deepEqual(arcMotion(true, 30), { draw: 0, stagger: 0 });
  assert.deepEqual(arcMotion(false, 1), { draw: 650, stagger: 0 });
  assert.equal(arcMotion(false, 5).stagger, 45);
  const many = arcMotion(false, 200);
  assert.ok(many.stagger * 199 <= 900 + 1e-9, 'the last starts within the cap');
  // The system's setting, read safely anywhere.
  const win = (matches) => ({ matchMedia: (q) => ({ matches: q === '(prefers-reduced-motion: reduce)' && matches }) });
  assert.equal(prefersReducedMotion(win(true)), true);
  assert.equal(prefersReducedMotion(win(false)), false);
  assert.equal(prefersReducedMotion(null), false);
  assert.equal(prefersReducedMotion({}), false);
  assert.equal(prefersReducedMotion({ matchMedia: () => { throw new Error('no'); } }), false);
  assert.equal(prefersReducedMotion(), false, 'no window in a test');
});

test('only the densest few places glow, and a quiet map not at all', () => {
  const places = Array.from({ length: 20 }, (_, i) => ({ key: `p${i}`, count: i + 1 }));
  assert.deepEqual([...glowKeys(places, { max: 3, least: 8 })], ['p19', 'p18', 'p17']);
  assert.equal(glowKeys(places.slice(0, 5), { least: 8 }).size, 0);
});

test('the map stays offline, draws lines only for what is picked, and asks Outlink for intros', () => {
  const map = read('../app/components/WorldMap.js');
  const parts = read('../app/components/WorldMapParts.js');
  for (const src of [map, parts]) assert.doesNotMatch(src, /https?:\/\//);
  assert.doesNotMatch(parts, /fetch\(/);
  // Lines come from the selection (a connection's reach, a place's getters, From you), never every place.
  assert.match(map, /if \(reach\?\.from\)/);
  assert.match(map, /if \(picked && getters\)/);
  assert.match(map, /for \(const line of homeLines\)/);
  // From you is off until asked for.
  assert.match(map, /const \[showHome, setShowHome\] = useState\(false\)/);
  // Ask for an intro is Outlink, filtered to that connection's circle (app/queue/page.js reads view and bridge).
  assert.match(parts, /`\/queue\?view=recs&bridge=\$\{encodeURIComponent\(id\)\}&groupBy=bridge`/);
  const queue = read('../app/queue/page.js');
  assert.match(queue, /params\.get\('bridge'\)/);
  assert.match(queue, /const VIEWS = \['quest', 'recs'/);
  // The map gets every row it needs from the one props object (app/page.js).
  const page = read('../app/page.js');
  assert.match(page, /fullDegree1: degree1,/);
  assert.match(page, /fullDegree2: degree2,/);
});
