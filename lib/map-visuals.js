// Heat, flows, hubs and the path to someone, for the Map tab (Blake,
// 2026-10-16: "more cool UI function and visuals for the locations like heat
// maps, line visuals, and anything you can connect the lines and data with,
// and make it more clean"). Each answers one question, and each leads to
// something you can do (app/components/WorldMapLayers.js draws them):
//
//   Heat    where are my S-tier people? where's my 2nd degree? A smooth
//           density surface of one group, its densest place a click away.
//   Flows   where do my connections' circles live, place to place? The busiest
//           routes, as thick as how many people; a route lists the connections
//           who carry it, each with Outlink's "ask for an intro".
//   Hubs    which places reach furthest? Places ranked by the people there plus
//           everyone your connections there can introduce you to.
//   Path    how do I get to this person, geographically? You, then each person
//           along their chain (lib/galaxy.js galaxyChain), place by place.
//
// Plain functions, no React, so tests/map-visuals.test.mjs runs them.

import { blur2 } from 'd3';
import { placeFor } from './places.js';
import { keyFor } from './separation.js';

const degreeOf = (p) => Math.min(3, Math.max(1, Number(p?.degree) || 1));
const strong = (p) => p?.tier === 'S' || p?.tier === 'A';

/** Where some location text is on the map, as a lean place, or null. */
function placed(gaz, location) {
  const at = placeFor(gaz, location);
  if (at?.status !== 'placed') return null;
  const { key, kind, approx, name, label, cc, lat, lon } = at;
  return { key, kind, approx, name, label, cc, lat, lon };
}

// ---------------------------------------------------------------- heat

/** Who a heat map can be of: everyone, the top tier or two, or one degree. */
export const HEAT_OF = Object.freeze([
  Object.freeze({ key: 'all', label: 'Everyone', short: 'All' }),
  Object.freeze({ key: 'S', label: 'S tier', short: 'S' }),
  Object.freeze({ key: 'SA', label: 'S and A', short: 'S+A' }),
  Object.freeze({ key: 'd1', label: '1st degree', short: '1st' }),
  Object.freeze({ key: 'd2', label: '2nd degree', short: '2nd' }),
  Object.freeze({ key: 'd3', label: '3rd degree', short: '3rd' }),
]);

const HEAT_TEST = {
  all: () => true,
  S: (p) => p?.tier === 'S',
  SA: strong,
  d1: (p) => degreeOf(p) === 1,
  d2: (p) => degreeOf(p) === 2,
  d3: (p) => degreeOf(p) === 3,
};

/** Whether a person counts in a heat map of `of` (an unknown one is everyone). */
export const inHeat = (person, of = 'all') => (HEAT_TEST[of] || HEAT_TEST.all)(person);

/**
 * The heat's points: each place with how many of its people count in it, the
 * places with none left out, most first. `of` is a HEAT_OF key.
 */
export function heatWeights(places = [], of = 'all') {
  const test = HEAT_TEST[of] || HEAT_TEST.all;
  const out = [];
  for (const place of places) {
    let weight = 0;
    for (const p of place?.people || []) if (test(p)) weight++;
    if (weight > 0) out.push({ place, weight });
  }
  return out.sort((a, b) => b.weight - a.weight || String(a.place.label || '').localeCompare(String(b.place.label || '')));
}

/**
 * A smooth density surface over points on screen: each point's weight dropped
 * into a grid of `cell`-pixel squares, then spread about `radius` pixels with
 * three box blurs (close to a Gaussian, d3's blur2). The grid runs `pad` pixels
 * past every edge, so a place just off screen still warms the edge it's near,
 * and the blur's own edges stay out of sight. `points` are [x, y, weight].
 *
 * Returns { cols, rows, cell, pad, values, max, total }: `values` row by row
 * (cell i, j covers x from i * cell - pad), `max` the hottest cell, `total` the
 * weight that landed in the grid.
 */
export function densityBins(points = [], { width = 0, height = 0, cell = 4, radius = 18, pad = Math.ceil(radius * 2.5) } = {}) {
  const size = Math.max(1, Number(cell) || 4);
  const cols = Math.max(1, Math.ceil((Math.max(0, width) + 2 * pad) / size));
  const rows = Math.max(1, Math.ceil((Math.max(0, height) + 2 * pad) / size));
  const values = new Float64Array(cols * rows);
  let total = 0;
  for (const pt of points) {
    const weight = Number(pt?.[2]);
    if (!(weight > 0)) continue;
    const i = Math.floor((pt[0] + pad) / size);
    const j = Math.floor((pt[1] + pad) / size);
    if (!(i >= 0 && j >= 0 && i < cols && j < rows)) continue;
    values[j * cols + i] += weight;
    total += weight;
  }
  const r = Math.max(0, Number(radius) || 0) / size;
  if (r > 0 && total > 0) blur2({ data: values, width: cols, height: rows }, r);
  let max = 0;
  for (let k = 0; k < values.length; k++) if (values[k] > max) max = values[k];
  return { cols, rows, cell: size, pad, values, max, total };
}

/**
 * The heat's contour levels: `n` steps from a faint edge (`low` of the peak, so
 * a place of a few people still shows) up to `high` of it, spaced evenly in the
 * square root, so the quiet places get more steps than the one hot core.
 */
export function heatLevels(max, n = 7, { low = 0.02, high = 0.8 } = {}) {
  if (!(max > 0) || !(n > 0)) return [];
  const a = Math.sqrt(low);
  const b = Math.sqrt(high);
  return Array.from({ length: n }, (_, i) => {
    const t = n === 1 ? 0 : i / (n - 1);
    const s = a + (b - a) * t;
    return max * s * s;
  });
}

// ---------------------------------------------------------------- flows

/**
 * Flows: where your connections' circles live, place to place. For each of
 * your connections with a scanned circle and a known place, everyone in their
 * circle the map shows with a place: one flow per pair of places, from where
 * the connection is to where those people are. A person counts once in a flow,
 * however many of the connections there know them; one in the connection's own
 * place stays `local` (no line). `circles` is lib/map-lines.js circlesByBridge,
 * `bridges` your connections by id, `shown(row)` the row the map draws for that
 * person or null when the filters hide them (as in reachOf).
 *
 * Returns { flows, local, people }: `flows` most people first, each { id, from,
 * to, count, strong (of tier S or A), people, bridges: [{ bridge, count }] most
 * first }; `local` Map(place key -> people who stay put); `people` how many
 * distinct people the flows carry.
 */
export function flowsBetween(gaz, circles, bridges, shown = (r) => r) {
  const byPair = new Map();
  const local = new Map();
  const everyone = new Set();
  for (const [id, circle] of circles || []) {
    const bridge = bridges?.get?.(id);
    if (!bridge) continue;
    const from = placed(gaz, bridge.location);
    if (!from) continue;
    const seen = new Set();
    for (const row of circle || []) {
      const person = shown(row);
      if (!person) continue;
      const k = keyFor(person);
      if (seen.has(k)) continue;
      seen.add(k);
      const to = placed(gaz, person.location);
      if (!to) continue;
      if (to.key === from.key) {
        let stay = local.get(from.key);
        if (!stay) { stay = new Set(); local.set(from.key, stay); }
        stay.add(k);
        continue;
      }
      const pair = `${from.key}>${to.key}`;
      let f = byPair.get(pair);
      if (!f) { f = { id: pair, from, to, people: new Map(), bridges: new Map() }; byPair.set(pair, f); }
      if (!f.people.has(k)) f.people.set(k, person);
      const carried = f.bridges.get(id);
      if (carried) carried.count++;
      else f.bridges.set(id, { bridge, count: 1 });
      everyone.add(k);
    }
  }
  const flows = [...byPair.values()].map((f) => {
    const people = [...f.people.values()];
    return {
      id: f.id, from: f.from, to: f.to, people, count: people.length, strong: people.filter(strong).length,
      bridges: [...f.bridges.values()].sort((a, b) => b.count - a.count || String(a.bridge.name || '').localeCompare(String(b.bridge.name || ''))),
    };
  }).sort((a, b) => b.count - a.count || a.from.label.localeCompare(b.from.label) || a.to.label.localeCompare(b.to.label));
  return { flows, local: new Map([...local].map(([key, s]) => [key, s.size])), people: everyone.size };
}

/**
 * The flows to draw: the busiest `max`, or with `from` (a place key) the
 * busiest leaving that place. Never all of them: a map of every route is a
 * hairball, and slow.
 */
export function topFlows(flows = [], { max = 40, from = null } = {}) {
  const list = from ? flows.filter((f) => f.from.key === from) : flows;
  return list.slice(0, Math.max(0, Number(max) || 0));
}

/**
 * Up to three counts for a width legend: the smallest drawn, a round one between,
 * and the biggest rounded down to a round number, never past what's drawn.
 */
export function legendSteps(counts = []) {
  const list = counts.map(Number).filter((n) => n > 0).sort((a, b) => a - b);
  if (!list.length) return [];
  const step = (n) => (n < 10 ? 1 : 10 ** Math.floor(Math.log10(n)) / 2);
  const lo = list[0];
  const hi = list[list.length - 1];
  const mid = Math.round(Math.sqrt(lo * hi) / step(Math.sqrt(lo * hi))) * step(Math.sqrt(lo * hi));
  const top = Math.floor(hi / step(hi)) * step(hi);
  return [...new Set([lo, mid, top])].filter((n) => n >= lo && n <= hi).sort((a, b) => a - b);
}

// ---------------------------------------------------------------- hubs

/**
 * Hubs: places ranked by reach. A place's reach is the people the map shows
 * there, plus everyone in the circles of your connections who live there, each
 * person once (someone there and in a circle counts once): "where is my network
 * strongest, counting who my people there can introduce me to?". `places` are
 * lib/places.js placePeople's, `circles` circlesByBridge, `shown(row)` as in
 * flowsBetween.
 *
 * Returns at most `max` of { place, here, through, reach, bridges, strong },
 * most reach first: `here` the people there, `through` the more their circles
 * add, `bridges` how many connections there have a circle, `strong` how many
 * of the reach are tier S or A.
 */
export function rankHubs(places = [], circles = new Map(), shown = (r) => r, { max = 10 } = {}) {
  const out = [];
  for (const place of places) {
    const seen = new Set();
    let best = 0;
    const count = (p) => {
      const k = keyFor(p);
      if (seen.has(k)) return;
      seen.add(k);
      if (strong(p)) best++;
    };
    for (const p of place?.people || []) count(p);
    const here = seen.size;
    let bridges = 0;
    for (const p of place?.people || []) {
      if (degreeOf(p) !== 1) continue;
      const circle = circles?.get?.(p.id);
      if (!circle?.length) continue;
      bridges++;
      for (const row of circle) {
        const person = shown(row);
        if (person) count(person);
      }
    }
    out.push({ place, here, through: seen.size - here, reach: seen.size, bridges, strong: best });
  }
  out.sort((a, b) => b.reach - a.reach || b.here - a.here || String(a.place.label || '').localeCompare(String(b.place.label || '')));
  return out.slice(0, Math.max(0, Number(max) || 0));
}

// ---------------------------------------------------------------- the path to someone

/**
 * How you get to someone, place by place: you at home, then each person along
 * their chain (lib/galaxy.js galaxyChain's `parentOf`: who they came through,
 * and who that one did), to them. `byId` is every row by id, `home` the place
 * From you starts at (lib/map-lines.js homeOf), or null.
 *
 * Returns null when the person isn't on file, else { steps, legs, known }.
 * `steps` run from you to them, each { person (null for you), place (null when
 * not on the map), step (0 for you, 1 for your connection, and on) }. `legs`
 * are the moves between two different places, each { from, to, step, skipped }:
 * `step` the one it arrives at, `skipped` when a step between had no place, so
 * the leg jumps it. Two steps in one place draw no leg. `known` is false when
 * the chain doesn't reach one of your connections (someone a company scan
 * found, say): then there's no step from you, since a line would say you know them.
 */
export function chainAcross(gaz, id, { parentOf = new Map(), byId = new Map(), home = null } = {}) {
  const person = byId.get(id);
  if (!person) return null;
  const trail = [person];
  const walked = new Set([person.id]);
  for (let up = parentOf.get(person.id); up != null && !walked.has(up) && trail.length < 7; up = parentOf.get(up)) {
    const row = byId.get(up);
    if (!row) break;
    walked.add(up);
    trail.push(row);
  }
  trail.reverse();
  const known = degreeOf(trail[0]) === 1;
  const steps = known ? [{ person: null, place: home ? lean(home) : null, step: 0 }] : [];
  trail.forEach((row, i) => steps.push({ person: row, place: placed(gaz, row.location), step: known ? i + 1 : null }));
  const legs = [];
  let last = null;
  let skipped = false;
  for (const s of steps) {
    if (!s.place) { if (last) skipped = true; continue; }
    if (last && last.place.key !== s.place.key) legs.push({ from: last.place, to: s.place, step: s.step, skipped });
    last = s;
    skipped = false;
  }
  return { steps, legs, known };
}

const lean = ({ key, kind, approx, name, label, cc, lat, lon }) => ({ key, kind, approx, name, label, cc, lat, lon });
