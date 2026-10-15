// Lines, filters and the finder for the Map tab (Blake, 2026-10-15: "for maps
// I'm sure there's some cool graphics and filters we can have on here like for
// lines and etc"). Each piece answers a question about your network:
//
//   Through whom?     pick one of your connections and lines run from where
//                     they are to every place their circle lives: "how far
//                     does Jane's network reach?", "who can introduce me in Austin?"
//   Who gets me there?  pick a place and lines run back to the connections who
//                     reach the 2nd-degree people there, as thick as how many
//                     each reaches: the people to ask for an intro (Outlink).
//   From you          faint lines from your home to where your connections are.
//
// The filters narrow who is on the map (a company, a word in a name or a
// headline) and which places are drawn (at least N people, at least N of tier
// S or A). Plain functions, no React, so tests/map-lines.test.mjs runs them.

import { geoInterpolate, geoDistance } from 'd3';
import { placeFor } from './places.js';
import { keyFor } from './separation.js';

/** Whose circle a 2nd-degree row came from: the connection who bridges you to them. */
export const bridgeIdOf = (row) => row?.source_connection_id ?? row?.bridge_id ?? null;

/** Every 2nd-degree row, by the connection whose circle it's in. */
export function circlesByBridge(rows = []) {
  const out = new Map();
  for (const row of rows || []) {
    const id = bridgeIdOf(row);
    if (id == null) continue;
    const list = out.get(id);
    if (list) list.push(row);
    else out.set(id, [row]);
  }
  return out;
}

/** The point a place is drawn at, or null when it's not a place. */
const pointOf = (found) => (found?.status === 'placed' ? found : null);
const lean = ({ key, kind, approx, name, label, cc, lat, lon }) => ({ key, kind, approx, name, label, cc, lat, lon });

/**
 * Through whom: the places one bridge's circle lives in. `circle` is that
 * bridge's 2nd-degree rows; `shown(row)` gives the row the map is drawing for
 * that person (the filters' own, deduplicated row) or null when the filters
 * hide them. Returns { from, ends, unplaced, total }: `from` the bridge's own
 * place (null when it isn't known), `ends` one per place, most people first,
 * each { ...place, people, count }, and `unplaced` how many have no place.
 */
export function reachOf(gaz, bridge, circle = [], shown = (r) => r) {
  const from = pointOf(placeFor(gaz, bridge?.location));
  const byKey = new Map();
  const seen = new Set();
  let unplaced = 0;
  let total = 0;
  for (const row of circle) {
    const person = shown(row);
    if (!person) continue;
    const k = keyFor(person);
    if (seen.has(k)) continue;
    seen.add(k);
    total++;
    const at = pointOf(placeFor(gaz, person.location));
    if (!at) { unplaced++; continue; }
    let end = byKey.get(at.key);
    if (!end) { end = { ...lean(at), people: [] }; byKey.set(at.key, end); }
    end.people.push(person);
  }
  const ends = [...byKey.values()].map((e) => ({ ...e, count: e.people.length }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
  return { from: from ? lean(from) : null, ends, unplaced, total };
}

/**
 * Who gets me there: the connections who reach the 2nd-degree people at one
 * place. `circles` is circlesByBridge over every 2nd-degree row (a person in two
 * circles counts once under each bridge: either can introduce you), `bridges`
 * your connections by id, `shown(row)` as in reachOf. Returns { bridges, starts,
 * unplacedBridges, people }: `bridges` each { bridge, place, people, count },
 * most first; `starts` the same grouped by the bridges' own places, one line
 * each ({ ...place, bridges, count }); `unplacedBridges` the ones whose own
 * place isn't known (no line, still listed); `people` how many distinct people.
 */
export function gettersTo(gaz, placeKey, circles, bridges, shown = (r) => r) {
  const found = [];
  const everyone = new Set();
  for (const [id, circle] of circles || []) {
    const bridge = bridges?.get?.(id);
    if (!bridge) continue;
    const people = [];
    const seen = new Set();
    for (const row of circle) {
      const person = shown(row);
      if (!person) continue;
      const at = pointOf(placeFor(gaz, person.location));
      if (!at || at.key !== placeKey) continue;
      const k = keyFor(person);
      if (seen.has(k)) continue;
      seen.add(k);
      everyone.add(k);
      people.push(person);
    }
    if (!people.length) continue;
    const own = pointOf(placeFor(gaz, bridge.location));
    found.push({ bridge, place: own ? lean(own) : null, people, count: people.length });
  }
  found.sort((a, b) => b.count - a.count || String(a.bridge.name || '').localeCompare(String(b.bridge.name || '')));
  const byKey = new Map();
  for (const f of found) {
    if (!f.place || f.place.key === placeKey) continue;
    let start = byKey.get(f.place.key);
    if (!start) { start = { ...f.place, bridges: [], count: 0 }; byKey.set(f.place.key, start); }
    start.bridges.push(f);
    start.count += f.count;
  }
  const starts = [...byKey.values()].sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
  return { bridges: found, starts, unplacedBridges: found.filter((f) => !f.place), people: everyone.size };
}

/** How many 1st-degree people a place has. */
export const firstDegreeAt = (place) => (place?.people || []).reduce((n, p) => n + ((Number(p?.degree) || 1) === 1 ? 1 : 0), 0);

/**
 * Your home for From you: the place you picked, while it's still on the map,
 * else the place with the most of your connections, marked as a guess.
 */
export function homeOf(places = [], pickedKey = null) {
  const picked = pickedKey && places.find((p) => p.key === pickedKey);
  if (picked) return { place: picked, guessed: false };
  let best = null;
  let most = 0;
  for (const p of places) {
    const n = firstDegreeAt(p);
    if (n > most) { most = n; best = p; }
  }
  return best ? { place: best, guessed: true } : null;
}

/** From you: your connections' places other than home, most first, at most `max` lines. */
export function fromYou(places = [], home, max = 40) {
  if (!home) return [];
  return places
    .filter((p) => p.key !== home.key)
    .map((p) => ({ place: p, count: firstDegreeAt(p) }))
    .filter((e) => e.count > 0)
    .sort((a, b) => b.count - a.count || a.place.label.localeCompare(b.place.label))
    .slice(0, max);
}

// ---------------------------------------------------------------- filters

/** The filters with nothing set. */
export const NO_FILTERS = Object.freeze({ company: '', text: '', minPeople: 1, minStrong: 0 });

const norm = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();

/**
 * Who the people filters keep: a company (its name contains what was picked,
 * so "Google" keeps "Google Cloud"), and a word or two found in a name, a
 * company or a headline ("founder": where are the founders I know?).
 */
export function filterPeople(rows = [], filters = NO_FILTERS) {
  const company = norm(filters.company);
  const words = norm(filters.text).split(' ').filter(Boolean);
  if (!company && !words.length) return rows;
  return rows.filter((r) => {
    if (company && !norm(r?.company).includes(company)) return false;
    if (words.length) {
      const hay = norm(`${r?.name || ''} ${r?.company || ''} ${r?.headline || ''} ${r?.role || ''}`);
      if (!words.every((w) => hay.includes(w))) return false;
    }
    return true;
  });
}

const STRONG = new Set(['S', 'A']);
/** How many of tier S or A a place has. */
export const strongAt = (place) => (place?.people || []).reduce((n, p) => n + (STRONG.has(p?.tier) ? 1 : 0), 0);

/**
 * The places drawn, decluttered: at least `minPeople` people, and at least
 * `minStrong` of tier S or A (0 for any). Places in `keep` are drawn whatever
 * the thresholds, so a line never ends at nothing.
 */
export function keepPlaces(places = [], { minPeople = 1, minStrong = 0 } = {}, keep = null) {
  const least = Math.max(1, Number(minPeople) || 1);
  const strong = Math.max(0, Number(minStrong) || 0);
  if (least <= 1 && !strong) return places;
  return places.filter((p) => keep?.has(p.key) || (p.count >= least && (!strong || strongAt(p) >= strong)));
}

/** The steps the two thresholds offer. */
export const MIN_PEOPLE_STEPS = [1, 2, 3, 5, 10, 25];
export const MIN_STRONG_STEPS = [0, 1, 2, 3, 5, 10];

/**
 * The chips for what's set, each { key, label }, in a fixed order; `through`
 * is the name of the connection whose lines are drawn, if any.
 */
export function filterChips(filters = NO_FILTERS, { through = null } = {}) {
  const chips = [];
  if (through) chips.push({ key: 'through', label: `Through ${through}` });
  if (filters.company) chips.push({ key: 'company', label: `At ${filters.company}` });
  if (filters.text) chips.push({ key: 'text', label: `“${filters.text}”` });
  if (filters.minPeople > 1) chips.push({ key: 'minPeople', label: `${filters.minPeople}+ per place` });
  if (filters.minStrong > 0) chips.push({ key: 'minStrong', label: `${filters.minStrong}+ S or A` });
  return chips;
}

/** The filters with one chip cleared ('through' is the caller's own, so they stay as they are). */
export function clearChip(filters = NO_FILTERS, key) {
  if (!(key in NO_FILTERS)) return filters;
  return { ...filters, [key]: NO_FILTERS[key] };
}

/** How many of everyone have a place on the map, as words: "676 of 748 located (90%)". */
export function locatedLine(placed, total) {
  const f = (n) => Number(n || 0).toLocaleString('en-US');
  if (!total) return 'No one yet';
  const pct = Math.round((placed / total) * 100);
  return `${f(placed)} of ${f(total)} located (${pct}%)`;
}

// ---------------------------------------------------------------- the finder

// Each item's name in compared form, worked out once (the finder runs at every key).
const NORMED = new WeakMap();
function normed(item, nameOf) {
  if (item === null || typeof item !== 'object') return norm(nameOf(item));
  let n = NORMED.get(item);
  if (n === undefined) { n = norm(nameOf(item)); NORMED.set(item, n); }
  return n;
}

/**
 * What the map's search box finds, a few of each kind: `people` (a click opens
 * their card and their place), `bridges` (your connections whose circles are
 * scanned: a click draws their lines), `companies` (a click filters to it) and
 * `places`. `index` is { people, bridgeIds, companies, places }, built once.
 */
export function findOnMap(index, query, per = 5) {
  const q = norm(query);
  const out = { people: [], bridges: [], companies: [], places: [] };
  if (q.length < 2 || !index) return out;
  const starts = (s) => s.startsWith(q) || s.includes(` ${q}`);
  const rank = (list, nameOf) => {
    const first = [];
    const rest = [];
    for (const item of list) {
      const n = normed(item, nameOf);
      if (!n.includes(q)) continue;
      (starts(n) ? first : rest).push(item);
      if (first.length >= per) break;
    }
    return [...first, ...rest].slice(0, per);
  };
  const bridgeIds = index.bridgeIds || new Set();
  out.bridges = rank((index.people || []).filter((p) => bridgeIds.has(p.id)), (p) => p.name);
  const shownBridges = new Set(out.bridges.map((p) => p.id));
  out.people = rank((index.people || []).filter((p) => !shownBridges.has(p.id)), (p) => p.name);
  out.companies = rank(index.companies || [], (c) => c.name);
  out.places = rank(index.places || [], (p) => p.label);
  return out;
}

/** Companies in some rows, most people first: [{ name, count }]. */
export function companiesOf(rows = []) {
  const byName = new Map();
  for (const r of rows) {
    const name = String(r?.company || '').trim();
    if (!name) continue;
    const k = norm(name);
    const entry = byName.get(k) || { name, count: 0 };
    entry.count++;
    byName.set(k, entry);
  }
  return [...byName.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}

// ---------------------------------------------------------------- drawing

/**
 * A line between two places along the great circle (the shortest way round
 * the globe), as `steps + 1` [lon, lat] points. The same place twice is no line.
 */
export function arcPoints(from, to, steps = 32) {
  if (!from || !to) return [];
  const a = [from.lon, from.lat];
  const b = [to.lon, to.lat];
  if (geoDistance(a, b) < 1e-6) return [];
  const at = geoInterpolate(a, b);
  return Array.from({ length: steps + 1 }, (_, i) => at(i / steps));
}

/**
 * Projected points to an SVG path, lifted into a gentle bow so lines that
 * share an end fan out rather than lie on each other. A line the projection
 * cuts (it crosses the map's edge) is drawn in its pieces, unbowed. `jump` is
 * the gap, in pixels, that counts as a cut.
 */
export function arcPath(points, { lift = 0.16, maxLift = 60, jump = 200 } = {}) {
  const pts = points.filter((p) => p && Number.isFinite(p[0]) && Number.isFinite(p[1]));
  if (pts.length < 2) return '';
  const pieces = [[pts[0]]];
  for (let i = 1; i < pts.length; i++) {
    const [px, py] = pts[i - 1];
    if (Math.abs(pts[i][0] - px) > jump || Math.abs(pts[i][1] - py) > jump) pieces.push([]);
    pieces[pieces.length - 1].push(pts[i]);
  }
  const fmt = (n) => Math.round(n * 10) / 10;
  if (pieces.length > 1) {
    return pieces.filter((p) => p.length > 1).map((p) => `M${p.map(([x, y]) => `${fmt(x)},${fmt(y)}`).join('L')}`).join('');
  }
  const [x0, y0] = pts[0];
  const [x1, y1] = pts[pts.length - 1];
  const dx = x1 - x0;
  const dy = y1 - y0;
  const len = Math.hypot(dx, dy) || 1;
  // The normal that points up the screen, so every line bows the same way.
  let nx = -dy / len;
  let ny = dx / len;
  if (ny > 0) { nx = -nx; ny = -ny; }
  const h = Math.min(maxLift, len * lift);
  const n = pts.length - 1;
  return `M${pts.map(([x, y], i) => {
    const bow = Math.sin((Math.PI * i) / n) * h;
    return `${fmt(x + nx * bow)},${fmt(y + ny * bow)}`;
  }).join('L')}`;
}

/** A line's width on screen, by how many people it stands for: 1.2 to 7 pixels. */
export const arcWidth = (count) => Math.min(7, 1.2 + Math.sqrt(Math.max(0, Number(count) || 0)) * 0.9);

/**
 * How lines draw in: each over `draw` ms, the next starting `stagger` ms after,
 * the whole lot within `cap` ms. With reduced motion asked for, they're simply
 * there (0 and 0).
 */
export function arcMotion(reduced, count = 1, { draw = 650, stagger = 45, cap = 900 } = {}) {
  if (reduced) return { draw: 0, stagger: 0 };
  const n = Math.max(1, count);
  return { draw, stagger: n > 1 ? Math.min(stagger, cap / (n - 1)) : 0 };
}

/** Whether the system asks for less motion. False where it can't be asked (the server, a test). */
export function prefersReducedMotion(win = typeof window === 'undefined' ? null : window) {
  try { return Boolean(win?.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches); } catch { return false; }
}

/**
 * The places that glow: the densest few, by people, never more than `max`, and
 * only those with at least `least` people, so a quiet map has no glow at all.
 */
export function glowKeys(places = [], { max = 12, least = 8 } = {}) {
  return new Set([...places].filter((p) => p.count >= least).sort((a, b) => b.count - a.count).slice(0, max).map((p) => p.key));
}
