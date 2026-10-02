// Everyone you can reach in two steps, one entry per person, with every way in.
//
// A 2nd-degree row is saved once per bridge (unique per user + bridge + profile),
// so someone three of your connections know is three rows. Ranked as rows, the
// same face filled the top of the list three times and each copy showed one
// route. Here they are one person with three routes — and more routes is itself
// worth knowing: more people who could introduce you.
//
// Plain functions, no React, so tests/separation.test.mjs runs them as they are.
// This is the ONE merge: the Separation view and the Sidebar's path box both
// read it, so the list and the panel can never disagree about who reaches whom.

import { localPhoto } from './photos.js';

const TIER_RANK = { S: 0, A: 1, B: 2, C: 3, D: 4 };
export const TIERS = ['S', 'A', 'B', 'C', 'D'];

/** The stored score as a number. Scores saved as text still rank as numbers. */
export function score(row) {
  const n = parseFloat(row?.power_score);
  return Number.isFinite(n) ? n : 0;
}

/**
 * The score at the precision people see. Ranking on raw floats let 7.7 outrank
 * 7.699999999999999 — six people showing "7.7" silently ahead of twenty-one
 * others also showing "7.7", whatever their ways in. The live data has both.
 */
export function score1(row) {
  return Math.round(score(row) * 10) / 10;
}

/**
 * Who a row is. The profile URL, with any query, hash or trailing slash taken
 * off (every URL on file is already clean — this is insurance), else the row id.
 * "LinkedIn Member" rows each carry their own URL, so they stay separate people.
 */
export function keyFor(row) {
  const url = String(row?.profile_url || '').split(/[?#]/)[0].replace(/\/+$/, '');
  return url || `id:${row?.id}`;
}

const byId = (a, b) => String(a ?? '').localeCompare(String(b ?? ''), undefined, { numeric: true });

/** Highest-scored bridge first: the bridge's tier, then their own score. */
export function compareBridges(a, b) {
  const t = (TIER_RANK[a.tier] ?? 9) - (TIER_RANK[b.tier] ?? 9);
  return t || score(b) - score(a)
    || String(a.name || '').localeCompare(String(b.name || ''))
    || byId(a.id, b.id);
}

/**
 * Routes are { id, bridge }. A bridge that can't be found is `null` and goes
 * last — never dropped. Dropping it is what once hid hundreds of people: their
 * connection had been re-saved under a new id, the view had nobody to name, and
 * it left them out without a word. A person you can't credit to anyone is still
 * someone you can reach.
 */
function compareRoutes(a, b) {
  if (a.bridge && b.bridge) return compareBridges(a.bridge, b.bridge);
  if (a.bridge) return -1;
  if (b.bridge) return 1;
  return byId(a.id, b.id);
}

/** The better copy of a person: higher shown score, then one with a saved photo, then the lower id. */
function betterRow(a, b) {
  const d = score1(a) - score1(b);
  if (d) return d > 0;
  const pa = !!localPhoto(a.profile_image_url), pb = !!localPhoto(b.profile_image_url);
  if (pa !== pb) return pa;
  return byId(a.id, b.id) < 0;
}

/**
 * Power order: shown score, then ways in, then the best route, then name, then
 * key. Tier is not a key — it follows the rounded score exactly.
 */
export function comparePower(a, b) {
  return b.score - a.score
    || b.waysIn - a.waysIn
    || compareRoutes(a.routes[0] || NO_ROUTE, b.routes[0] || NO_ROUTE)
    || String(a.person.name || '').localeCompare(String(b.person.name || ''))
    || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0);
}
const NO_ROUTE = { id: null, bridge: null };

/**
 * @param {object[]} degree2      2nd-degree rows (one per bridge per person)
 * @param {object[]} connections  1st-degree rows, the bridges
 * @returns {{ people: object[], rowToKey: Map<string, string>, summary: object }}
 *   `people` in power order. Each: { key, person, score, tier, routes, waysIn,
 *   rowIds, haystack, rank, tied }. `person` is the exact row to hand to onSelect
 *   — never a copy — so its id matches selectedId and the Sidebar shows the same
 *   score. `rowToKey` maps every row id to its person, so a person picked in
 *   any view, by any of their rows, can be found here.
 */
export function separationPeople(degree2 = [], connections = []) {
  const bridgeById = new Map();
  for (const c of connections || []) bridgeById.set(c.id, c);

  const byKey = new Map();
  const rowToKey = new Map();
  for (const row of degree2 || []) {
    const key = keyFor(row);
    rowToKey.set(row.id, key);
    let p = byKey.get(key);
    if (!p) {
      p = { key, person: row, rowIds: [], routeIds: new Set() };
      byKey.set(key, p);
    } else if (betterRow(row, p.person)) {
      // Rows for the same person can be scored at different times; show the
      // best-informed one.
      p.person = row;
    }
    p.rowIds.push(row.id);
    p.routeIds.add(row.source_connection_id ?? null);
  }

  const summary = {
    people: byKey.size,
    byTier: { S: 0, A: 0, B: 0, C: 0, D: 0 },
    multi: 0,
    bridges: 0,
    unresolvedIds: 0,
    peopleOnlyUnresolved: 0,
    onlyUnresolvedVia: 0,
  };
  const resolvedSeen = new Set();
  const unresolvedSeen = new Set();
  const onlyUnresolvedSeen = new Set();

  const people = [];
  for (const p of byKey.values()) {
    const routes = [...p.routeIds].map((id) => ({ id, bridge: bridgeById.get(id) ?? null }));
    routes.sort(compareRoutes);
    const named = routes.filter((r) => r.bridge);
    for (const r of routes) (r.bridge ? resolvedSeen : unresolvedSeen).add(r.id);
    if (!named.length) {
      summary.peopleOnlyUnresolved++;
      for (const r of routes) onlyUnresolvedSeen.add(r.id);
    }

    const { person } = p;
    const tier = person.tier;
    if (summary.byTier[tier] !== undefined) summary.byTier[tier]++;
    if (routes.length > 1) summary.multi++;

    people.push({
      key: p.key,
      person,
      score: score1(person),
      tier,
      routes,
      waysIn: routes.length,
      rowIds: p.rowIds,
      // What search looks through: the person, and who knows them — so typing
      // a connection's name shows the circle they open.
      haystack: [person.name, person.headline, person.company, person.role, ...named.map((r) => r.bridge.name)]
        .filter(Boolean).join('\n').toLowerCase(),
      rank: 0,
      tied: false,
    });
  }
  summary.bridges = resolvedSeen.size;
  summary.unresolvedIds = unresolvedSeen.size;
  summary.onlyUnresolvedVia = onlyUnresolvedSeen.size;

  people.sort(comparePower);
  assignRanks(people);
  return { people, rowToKey, summary };
}

/**
 * Competition rank on (shown score, ways in): 1 + the number of people strictly
 * ahead on that pair, so people who share it share a rank ("#8="). Best route
 * and name only order them for display — they never change the number. Computed
 * once per population, so search, chips and the sort never renumber anyone.
 */
function assignRanks(sorted) {
  for (let i = 0; i < sorted.length; i++) {
    const p = sorted[i], prev = sorted[i - 1];
    const same = prev && prev.score === p.score && prev.waysIn === p.waysIn;
    p.rank = same ? prev.rank : i + 1;
    if (same) { p.tied = true; prev.tied = true; }
  }
}

/** Every person key → the set of 1st-degree ids they were found through. */
export function routeIndex(degree2 = []) {
  const idx = new Map();
  for (const row of degree2 || []) {
    const key = keyFor(row);
    let ids = idx.get(key);
    if (!ids) { ids = new Set(); idx.set(key, ids); }
    ids.add(row.source_connection_id ?? null);
  }
  return idx;
}

/**
 * Every way in to the person this row belongs to, as [{ id, bridge|null }],
 * highest-scored bridge first and unnamed ones last — the same order the list
 * uses. Built from the full lists, so a view's filter never hides a route.
 */
export function routesFor(row, index, bridgeById) {
  if (!row) return [];
  const ids = index?.get(keyFor(row))
    ?? (row.source_connection_id != null ? new Set([row.source_connection_id]) : new Set());
  return [...ids].map((id) => ({ id, bridge: bridgeById?.get(id) ?? null })).sort(compareRoutes);
}

/** "Alice Chen" → "Alice C." — for labels that must be short. */
export function shortName(name) {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
  if (parts.length < 2) return parts[0] || '';
  return `${parts[0]} ${parts[parts.length - 1].charAt(0)}.`;
}

function fit(text, budget) {
  const s = String(text || '');
  if (budget <= 1) return s ? '…' : '';
  return s.length > budget ? `${s.slice(0, budget - 1)}…` : s;
}

/** Dot size says how many ways in: 1, 2, 3, 4+. */
export function dotRadius(waysIn) {
  return waysIn >= 4 ? 8.5 : waysIn === 3 ? 7 : waysIn === 2 ? 5.5 : 4;
}

export const MIN_BRIDGE_GAP = 18;
const TOP_PAD = 16;

/**
 * The summit map: You → the bridges → the top of the list, every route drawn.
 * Pure, so its promises are tested without a browser.
 *
 * People sit in one column in list order. Bridges sit in the middle column,
 * ordered by the mean height of the people they reach (so lines cross as little
 * as they can), spread over the people's span — never closer than 18px; when
 * they would be, the map grows taller instead of overlapping them. Every route
 * the map can't name goes to ONE grey node, so an unnamed route is still drawn.
 *
 * @param {object[]} top    the first K people of whatever the list shows
 * @param {number}   width  map width in px
 * @param {{ cards?: boolean }} opts  cards: people drawn as cards and
 *   connections as pills (Blake, 2026-10-03), which need more room per row
 * @returns {{ width, height, you, people, bridges, links, spokes }}
 */
export function summitLayout(top = [], width = 800, isMobile = false, { cards = false } = {}) {
  const gap = cards ? 50 : isMobile ? 36 : 26;
  const bridgeGap = cards ? 36 : MIN_BRIDGE_GAP;
  const youX = 20;
  const bx = Math.round(width * 0.42);
  const px = Math.round(width * 0.58);

  const people = top.map((p, i) => ({
    key: p.key,
    p,
    x: px,
    y: TOP_PAD + i * gap,
    r: cards ? 0 : dotRadius(p.waysIn),
    label: fit(`#${p.rank}${p.tied ? '=' : ''} ${p.person.name || ''}`, Math.floor((width - px - 60) / 6.2)),
  }));

  // One node per resolved bridge, plus at most one for everything unnamed.
  const nodes = new Map();
  const UNRESOLVED = '\u0000unresolved';
  for (const pp of people) {
    for (const r of pp.p.routes) {
      const id = r.bridge ? r.id : UNRESOLVED;
      let n = nodes.get(id);
      if (!n) {
        n = { id: r.bridge ? r.id : null, bridge: r.bridge, unresolved: !r.bridge, ys: [], count: 0 };
        nodes.set(id, n);
      }
      n.count++;
      n.ys.push(pp.y);
    }
  }
  const bridges = [...nodes.values()].map((n) => ({ ...n, bary: n.ys.reduce((s, y) => s + y, 0) / n.ys.length }));
  bridges.sort((a, b) => a.bary - b.bary
    || (a.unresolved - b.unresolved)
    || (a.bridge && b.bridge ? compareBridges(a.bridge, b.bridge) : 0));

  const y0 = TOP_PAD;
  const y1 = people.length ? people[people.length - 1].y : TOP_PAD;
  const step = bridges.length > 1 ? Math.max(bridgeGap, (y1 - y0) / (bridges.length - 1)) : 0;
  const nameBudget = Math.max(4, Math.floor((bx - 10 - (youX + 22)) / 6));
  bridges.forEach((b, j) => {
    b.x = bx;
    b.y = bridges.length === 1 ? (y0 + y1) / 2 : y0 + j * step;
    b.r = 5;
    if (b.unresolved) b.label = fit(`can't be named (${b.count})`, nameBudget);
    else {
      const full = b.bridge.name || '';
      b.label = full.length <= nameBudget ? full : fit(shortName(full), nameBudget);
    }
    delete b.ys;
  });
  const nodeFor = new Map(bridges.map((b) => [b.unresolved ? UNRESOLVED : b.id, b]));
  // What each connection is to the people on the map: the only door to some,
  // the best way in to others, or only another way in.
  for (const b of bridges) { b.onlyFor = 0; b.bestFor = 0; }
  for (const pp of people) {
    const first = pp.p.routes[0];
    const bestNode = first ? nodeFor.get(first.bridge ? first.id : UNRESOLVED) : null;
    if (bestNode) bestNode.bestFor++;
    if (pp.p.waysIn === 1 && bestNode) bestNode.onlyFor++;
  }

  // Routes, per person: routes[0] is the top-scored bridge. Two unnamed routes
  // for one person are one line to the one grey node.
  const links = [];
  for (const pp of people) {
    const seen = new Set();
    pp.p.routes.forEach((r, i) => {
      const id = r.bridge ? r.id : UNRESOLVED;
      if (seen.has(id)) return;
      seen.add(id);
      const b = nodeFor.get(id);
      links.push({
        key: pp.key, bridgeId: b.id, primary: i === 0 && !b.unresolved, unresolved: b.unresolved,
        tier: b.bridge?.tier ?? null, x1: b.x, y1: b.y, x2: pp.x, y2: pp.y,
      });
    });
  }

  const bottom = Math.max(y1, bridges.length ? bridges[bridges.length - 1].y : 0);
  const height = people.length ? Math.ceil(bottom + TOP_PAD) : 0;
  const you = { x: youX, y: people.length ? (y0 + Math.max(y1, bottom)) / 2 : TOP_PAD, r: 14 };
  const spokes = bridges.map((b) => ({ id: b.id, x1: you.x, y1: you.y, x2: b.x, y2: b.y }));
  return { width, height, you, people, bridges, links, spokes };
}

/**
 * How many people the map draws with the slider at `at` (lib/rarity.js): all
 * `k` from the rare end to the middle, then fewer and fewer, down to the one
 * person you're aiming at with the slider all the way to easy. Blake,
 * 2026-10-03: at the rare end "it will show that one door"; at the other "all
 * the connections going into that one person".
 */
export function mapCount(at, k = 10) {
  const v = Math.max(0, Math.min(100, Number(at) || 0));
  if (v <= 50) return k;
  return Math.max(1, Math.round((k * (100 - v)) / 50));
}

/**
 * The map for one person: You → every connection of yours who leads to them →
 * them, with rings round them. Routes the map can't name share one grey node,
 * as in summitLayout, and it comes back in summitLayout's shape (`people` holds
 * the one person, marked `big`), so one map draws both and can glide from one
 * to the other. Pure, so it is tested without a browser.
 *
 * @returns {{ width, height, you, target, people, bridges, links, spokes }}
 */
export function convergeLayout(p, width = 800, isMobile = false, { cards = false } = {}) {
  const gap = cards ? 46 : isMobile ? 40 : 34;
  const youX = 20;
  const bx = Math.round(width * (isMobile ? 0.44 : 0.36));
  const tx = Math.round(width * (isMobile ? 0.8 : cards ? 0.6 : 0.62));
  const nodes = [];
  let unnamed = null;
  for (const r of p?.routes || []) {
    if (r.bridge) nodes.push({ id: r.id, bridge: r.bridge, unresolved: false, count: 1 });
    else if (unnamed) unnamed.count++;
    else nodes.push((unnamed = { id: null, bridge: null, unresolved: true, count: 1 }));
  }
  const height = Math.max(isMobile ? 190 : cards ? 250 : 220, TOP_PAD * 2 + Math.max(0, nodes.length - 1) * gap + 48);
  const mid = height / 2;
  const nameBudget = Math.max(4, Math.floor((bx - 10 - (youX + 22)) / 6));
  const bridges = nodes.map((n, j) => {
    const full = n.unresolved ? `can't be named (${n.count})` : n.bridge.name || '';
    return {
      ...n, x: bx, y: mid - ((nodes.length - 1) * gap) / 2 + j * gap, r: 6,
      primary: j === 0 && !n.unresolved,
      label: full.length <= nameBudget ? full : fit(n.unresolved ? full : shortName(full), nameBudget),
    };
  });
  const target = { x: tx, y: mid, r: cards ? 0 : 17, rings: cards ? [] : [32, 50, 70].filter((r) => r <= mid - 4) };
  const links = bridges.map((b) => ({
    key: p?.key, bridgeId: b.id, primary: b.primary, unresolved: b.unresolved, tier: b.bridge?.tier ?? null,
    x1: b.x, y1: b.y, x2: target.x, y2: target.y,
  }));
  const you = { x: youX, y: mid, r: 14 };
  const spokes = bridges.map((b) => ({ id: b.id, x1: you.x, y1: you.y, x2: b.x, y2: b.y }));
  const people = p ? [{ key: p.key, p, x: target.x, y: target.y, r: target.r, rings: target.rings, big: true, label: '' }] : [];
  return { width, height, you, target, people, bridges, links, spokes };
}
