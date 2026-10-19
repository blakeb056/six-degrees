import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { makeGazetteer, placePeople } from '../lib/places.js';
import { circlesByBridge } from '../lib/map-lines.js';
import { galaxyChain } from '../lib/galaxy.js';
import {
  HEAT_OF, inHeat, heatWeights, densityBins, heatLevels, flowsBetween, topFlows, legendSteps, rankHubs, chainAcross,
} from '../lib/map-visuals.js';

// The Map tab's heat, flows, hubs and path (lib/map-visuals.js). Invented people only.

const read = (rel) => readFileSync(new URL(rel, import.meta.url), 'utf8');

const gaz = () => makeGazetteer({
  countries: [['US', 'United States', 39.8, -98.6], ['GB', 'United Kingdom', 54, -2], ['JP', 'Japan', 36, 138]],
  regions: [['US', 'Florida', 28, -82], ['US', 'Texas', 31, -99], ['GB', 'England', 52.3, -1.5], ['JP', 'Tokyo', 35.7, 139.7]],
  cities: [
    ['Orlando', 0, 28.54, -81.38, 300000], ['Austin', 1, 30.27, -97.74, 960000],
    ['London', 2, 51.51, -0.13, 8900000], ['Tokyo', 3, 35.69, 139.69, 9000000],
  ],
});

const ORL = 'Orlando, Florida, United States';
const AUS = 'Austin, Texas, United States';
const LON = 'London, England, United Kingdom';
const TOK = 'Tokyo, Tokyo, Japan';

const first = (id, location, tier = 'B', extra = {}) => ({ id, degree: 1, name: `Conn ${id}`, tier, location, profile_url: `https://www.linkedin.com/in/${id}`, ...extra });
const second = (id, via, location, tier = 'B') => ({
  id, degree: 2, source_connection_id: via, name: `Person ${id}`, tier, location, profile_url: `https://www.linkedin.com/in/${id}`,
});

// Jane in Orlando and Omar in Austin have scanned circles; Nadia has no location.
const jane = first('j', ORL, 'S');
const omar = first('o', AUS, 'A');
const nadia = first('n', '', 'C');
const circleRows = [
  second('a1', 'j', AUS, 'S'), second('a2', 'j', AUS), second('l1', 'j', LON, 'A'), second('h1', 'j', ORL), second('x1', 'j', ''),
  second('l2', 'o', LON), second('a3', 'o', AUS, 'S'),
  second('a1', 'o', AUS, 'S'), // a1 is in Omar's circle too
  second('t1', 'n', TOK),
];
const bridges = new Map([jane, omar, nadia].map((b) => [b.id, b]));

test('heat is of everyone, a tier or two, or a degree, and each place weighs what it has of them', () => {
  assert.deepEqual(HEAT_OF.map((h) => h.key), ['all', 'S', 'SA', 'd1', 'd2', 'd3']);
  assert.equal(inHeat({ tier: 'S' }, 'S'), true);
  assert.equal(inHeat({ tier: 'A' }, 'S'), false);
  assert.equal(inHeat({ tier: 'A' }, 'SA'), true);
  assert.equal(inHeat({ degree: 2 }, 'd2'), true);
  assert.equal(inHeat({}, 'd1'), true, 'no degree is your own connection, as the dots draw it');
  assert.equal(inHeat({ degree: 5 }, 'd3'), true, 'past the 3rd counts as the 3rd');
  assert.equal(inHeat({ tier: 'D' }, 'nonsense'), true, 'an unknown group is everyone');

  const p = (key, people) => ({ key, label: key, people });
  const places = [p('a', [{ tier: 'S' }, { tier: 'B' }]), p('b', [{ tier: 'S' }, { tier: 'S' }, { tier: 'A' }]), p('c', [{ tier: 'D' }])];
  assert.deepEqual(heatWeights(places, 'S').map((x) => [x.place.key, x.weight]), [['b', 2], ['a', 1]], 'most first; none left out');
  assert.deepEqual(heatWeights(places, 'all').map((x) => x.weight), [3, 2, 1]);
  assert.deepEqual(heatWeights([], 'S'), []);
});

test('density bins: the weight lands in its cell, spreads evenly round it, and an edge stays out of sight', () => {
  const bins = densityBins([[100, 60, 10], [-500, 0, 99], [0, 0, 0]], { width: 200, height: 120, cell: 4, radius: 12 });
  assert.equal(bins.cell, 4);
  assert.equal(bins.pad, 30);
  assert.equal(bins.cols, Math.ceil((200 + 60) / 4));
  assert.equal(bins.rows, Math.ceil((120 + 60) / 4));
  assert.equal(bins.values.length, bins.cols * bins.rows);
  assert.equal(bins.total, 10, 'a point far off the grid, and one weighing nothing, are left out');
  // The blur keeps the weight (the padding keeps the edges clear of it).
  const sum = bins.values.reduce((s, v) => s + v, 0);
  assert.ok(Math.abs(sum - 10) < 1e-6, `kept: ${sum}`);
  // Hottest at the point's own cell, falling off evenly either side.
  const at = (x, y) => bins.values[Math.floor((y + bins.pad) / 4) * bins.cols + Math.floor((x + bins.pad) / 4)];
  assert.equal(at(100, 60), bins.max);
  assert.ok(at(100, 60) > at(112, 60) && at(112, 60) > at(124, 60), 'falls off with distance');
  assert.ok(Math.abs(at(88, 60) - at(112, 60)) < 1e-9, 'the same either side');
  assert.ok(Math.abs(at(100, 48) - at(100, 72)) < 1e-9, 'and up and down');
  // Two places close together make one warm patch; the cell between them is warmer than either alone would make it.
  const pair = densityBins([[90, 60, 5], [110, 60, 5]], { width: 200, height: 120, radius: 12 });
  const lone = densityBins([[90, 60, 5]], { width: 200, height: 120, radius: 12 });
  const mid = (b) => b.values[Math.floor((60 + b.pad) / 4) * b.cols + Math.floor((100 + b.pad) / 4)];
  assert.ok(mid(pair) > 1.5 * mid(lone));
  // Nothing to draw.
  const none = densityBins([], { width: 50, height: 50 });
  assert.equal(none.max, 0);
  assert.equal(none.total, 0);
});

test('heat levels run from a faint edge to near the peak, more of them low down', () => {
  const levels = heatLevels(100, 5, { low: 0.04, high: 0.64 });
  assert.equal(levels.length, 5);
  assert.ok(Math.abs(levels[0] - 4) < 1e-9);
  assert.ok(Math.abs(levels[4] - 64) < 1e-9);
  for (let i = 1; i < levels.length; i++) assert.ok(levels[i] > levels[i - 1], 'rising');
  assert.ok(levels[1] - levels[0] < levels[4] - levels[3], 'closer together at the faint end');
  assert.deepEqual(heatLevels(0, 5), []);
  assert.deepEqual(heatLevels(NaN), []);
  assert.equal(heatLevels(10, 1).length, 1);
});

test('flows: each route from a connection’s place to where their circle lives, people counted once', () => {
  const g = gaz();
  const { flows, local, people } = flowsBetween(g, circlesByBridge(circleRows), bridges);
  const route = (f) => `${f.from.name}>${f.to.name}`;
  // Orlando to Austin carries a1 and a2; Austin to London carries l2; Orlando to London l1; Nadia has no place, so no route.
  assert.deepEqual(flows.map((f) => [route(f), f.count]), [['Orlando>Austin', 2], ['Austin>London', 1], ['Orlando>London', 1]]);
  const toAustin = flows[0];
  assert.equal(toAustin.strong, 1, 'a1 is S');
  assert.deepEqual(toAustin.bridges.map((b) => [b.bridge.id, b.count]), [['j', 2]]);
  assert.equal(local.get(flows[0].from.key), 1, 'h1 lives where Jane does: no line, counted as local');
  assert.equal(local.get(flows[1].from.key), 2, 'a3 and a1 live where Omar does');
  assert.equal(people, 4, 'a1, a2, l1, l2');
  // Two connections in one place carry one route between them.
  const twin = first('k', ORL, 'B');
  const both = flowsBetween(g, circlesByBridge([...circleRows, second('a1', 'k', AUS, 'S'), second('a9', 'k', AUS)]), new Map([...bridges, ['k', twin]]));
  const shared = both.flows.find((f) => route(f) === 'Orlando>Austin');
  assert.equal(shared.count, 3, 'a1 once, a2, a9');
  assert.deepEqual(shared.bridges.map((b) => [b.bridge.id, b.count]), [['j', 2], ['k', 2]]);
  // The filters decide who's at the end.
  const onlyS = flowsBetween(g, circlesByBridge(circleRows), bridges, (r) => (r.tier === 'S' ? r : null));
  assert.deepEqual(onlyS.flows.map((f) => [route(f), f.count]), [['Orlando>Austin', 1]]);
  // Not one of your connections: skipped, never guessed.
  assert.deepEqual(flowsBetween(g, circlesByBridge(circleRows), new Map()).flows, []);
});

test('only the busiest routes are drawn, or the busiest leaving a place', () => {
  const f = (id, from, n) => ({ id, from: { key: from }, to: { key: `${id}-to` }, count: n });
  const flows = [f('a', 'x', 9), f('b', 'y', 7), f('c', 'x', 5), f('d', 'z', 2)];
  assert.deepEqual(topFlows(flows, { max: 2 }).map((x) => x.id), ['a', 'b']);
  assert.deepEqual(topFlows(flows, { max: 10, from: 'x' }).map((x) => x.id), ['a', 'c']);
  assert.deepEqual(topFlows(flows, { max: 0 }), []);
  assert.equal(topFlows(flows).length, 4);
  // A width legend: the smallest drawn, a round one between, the biggest rounded down.
  assert.deepEqual(legendSteps([3, 40, 120]), [3, 20, 100]);
  assert.deepEqual(legendSteps([1, 4]), [1, 2, 4]);
  assert.deepEqual(legendSteps([7]), [7]);
  assert.deepEqual(legendSteps([]), []);
  for (const n of legendSteps([22, 75, 507])) assert.ok(n >= 22 && n <= 507, `${n} is within what's drawn`);
});

test('hubs: a place’s reach is its people plus everyone its connections can introduce, each once', () => {
  const g = gaz();
  const rows = [jane, omar, nadia, first('o2', AUS, 'D'), ...circleRows.filter((r) => r.location)];
  const { places } = placePeople(g, rows);
  const hubs = rankHubs(places, circlesByBridge(circleRows), (r) => r);
  const byName = new Map(hubs.map((h) => [h.place.name, h]));
  // Orlando: Jane and h1 here; through Jane a1, a2, l1 more (h1 already counted; x1 has no place but is still reached).
  const orl = byName.get('Orlando');
  assert.deepEqual([orl.here, orl.through, orl.reach, orl.bridges], [2, 4, 6, 1]);
  // Austin: Omar, o2, a1, a2, a3 here; through Omar l2 more (a1 and a3 are there already).
  const aus = byName.get('Austin');
  assert.deepEqual([aus.here, aus.through, aus.reach, aus.bridges], [5, 1, 6, 1]);
  assert.equal(aus.strong, 3, 'Omar is A, a1 and a3 are S');
  assert.deepEqual(hubs.map((h) => h.place.name), ['Austin', 'Orlando', 'London', 'Tokyo'], 'most reach first, then most here');
  assert.equal(rankHubs(places, circlesByBridge(circleRows), (r) => r, { max: 2 }).length, 2);
  // The filters apply to who's reached.
  const none = rankHubs(places, circlesByBridge(circleRows), () => null);
  assert.equal(none.find((h) => h.place.name === 'Orlando').through, 0);
});

test('the path to someone: you at home, then each person along their chain, a leg wherever the place changes', () => {
  const g = gaz();
  // Lev (London) introduced Yuki (Tokyo), whose circle has Halle (Austin); Ana is in Lev's circle, also in London.
  const lev = first('lev', LON, 'A');
  const yuki = first('yuki', TOK, 'B', { unlocked_from_bridge_id: 'lev' });
  const halle = second('halle', 'yuki', AUS, 'C');
  const ana = second('ana', 'lev', LON);
  const nowhere = second('nowhere', 'lev', '');
  const found = { id: 'found', degree: 3, name: 'Company find', location: TOK, profile_url: 'https://www.linkedin.com/in/found' };
  const rows = [lev, yuki, halle, ana, nowhere, found];
  const { parentOf } = galaxyChain(rows, { all: rows });
  const byId = new Map(rows.map((r) => [r.id, r]));
  const home = { key: 'home', name: 'Orlando', label: ORL, lat: 28.54, lon: -81.38, people: [] };

  const path = chainAcross(g, 'halle', { parentOf, byId, home });
  assert.equal(path.known, true);
  assert.deepEqual(path.steps.map((s) => [s.person?.id ?? 'you', s.place?.name ?? null, s.step]),
    [['you', 'Orlando', 0], ['lev', 'London', 1], ['yuki', 'Tokyo', 2], ['halle', 'Austin', 3]]);
  assert.deepEqual(path.legs.map((l) => [l.from.name, l.to.name, l.step, l.skipped]),
    [['Orlando', 'London', 1, false], ['London', 'Tokyo', 2, false], ['Tokyo', 'Austin', 3, false]]);
  assert.equal('people' in path.steps[0].place, false, 'home is the place alone, not who lives there');

  // Two steps in one place: no leg between them.
  assert.deepEqual(chainAcross(g, 'ana', { parentOf, byId, home }).legs.map((l) => [l.from.name, l.to.name]), [['Orlando', 'London']]);
  // A step with no place is listed; the leg after it jumps it.
  const lost = chainAcross(g, 'nowhere', { parentOf, byId, home });
  assert.deepEqual(lost.steps.map((s) => s.place?.name ?? null), ['Orlando', 'London', null]);
  const via = galaxyChain([lev, { ...yuki, location: '' }, halle], { all: rows });
  const jumped = chainAcross(g, 'halle', { parentOf: via.parentOf, byId: new Map([lev, { ...yuki, location: '' }, halle].map((r) => [r.id, r])), home });
  assert.deepEqual(jumped.legs.map((l) => [l.from.name, l.to.name, l.skipped]), [['Orlando', 'London', false], ['London', 'Austin', true]]);
  // No home known: the path starts at your connection.
  assert.deepEqual(chainAcross(g, 'halle', { parentOf, byId, home: null }).legs.map((l) => l.from.name), ['London', 'Tokyo']);
  // Someone a company scan found, with no chain on file: no step from you, since a line would say you know them.
  const unknown = chainAcross(g, 'found', { parentOf, byId, home });
  assert.equal(unknown.known, false);
  assert.deepEqual(unknown.steps.map((s) => [s.person.id, s.step]), [['found', null]]);
  assert.deepEqual(unknown.legs, []);
  // Not on file at all.
  assert.equal(chainAcross(g, 'ghost', { parentOf, byId, home }), null);
  // A loop in the data never hangs.
  const loop = chainAcross(g, 'halle', { parentOf: new Map([['halle', 'yuki'], ['yuki', 'halle']]), byId, home });
  assert.ok(loop.steps.length <= 3);
});

test('the views stay offline, draw only the busiest routes, and the path opens the profile to ask for the intro', () => {
  const map = read('../app/components/WorldMap.js');
  const layers = read('../app/components/WorldMapLayers.js');
  for (const src of [map, layers]) assert.doesNotMatch(src, /https?:\/\//);
  assert.doesNotMatch(layers, /fetch\(/);
  // Routes: the busiest few, never every one.
  assert.match(map, /topFlows\(flowData\.flows, \{ max:/);
  assert.match(layers, /const FLOW_STEPS = \[20, 40, 80\];/);
  // The path is galaxyChain's chain, and the intro is asked by hand: the connection's profile opens
  // (OpenProfile), never in the public demo. A route's carriers show who they can introduce, in Separation.
  assert.match(map, /galaxyChain\(rows, \{ all: rows \}\)/);
  assert.match(layers, /<OpenProfile person=\{ask\}/);
  assert.match(map, /canAsk=\{!IS_DEMO\}/);
  assert.match(layers, /onIntros && bridge\.name && <button type="button" onClick=\{\(\) => onIntros\(bridge\)\}/);
  // A route's moving dash and the views' fade go when less motion is asked for.
  assert.match(map, /a\.kind === 'flow' && motion\.draw > 0/);
  assert.match(map, /@media \(prefers-reduced-motion: reduce\)[\s\S]*\.sd-map-layer \{ animation: none; \}/);
  // Colours come from the look: the accent and the tiers, never a fixed blue for the pressed button.
  assert.match(layers, /color-mix\(in srgb, var\(--sd-accent, #3498db\) 24%, transparent\)/);
});
