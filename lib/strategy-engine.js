// The strategy engine (experimental): where each person stands in your
// network, by position rather than by title and company.
//
// Blake, 2026-10-05: "we are ranking where people stand which relates to their
// worth; this is experimental". A separate lens: it never touches power,
// tiers, rings, dot sizes or any score (lib/scoring.js). Off by default, behind
// Settings → Experimental (lib/strategy-client.js); when it's off nothing reads
// this file.
//
// The graph, from data the app already has (no LinkedIn traffic):
//   You ── each 1st-degree connection
//   a circle's owner ── each person found in their circle (source_connection_id;
//                        a chain past the 2nd degree follows the same rule)
//   1st ── 1st         two of your connections who know each other
//                        (connection_ties, lib/ties.js)
// Undirected, unweighted. Everyone is a node once, by keyFor (one person with
// rows in three circles is one node with three edges).
//
// Per person:
//   only         exclusive reach: how many people you can reach ONLY through
//                them. Remove them and those people are cut off from you. An
//                articulation-point count on a DFS from You, so it is exact on
//                any shape, chains included.
//   betweenness  Brandes, normalised to 0–1. You are never an endpoint (every
//                path from you would make each bridge look like a hub for the
//                trivial reason that you are connected to them), but paths may
//                run through you. Sped up two exact ways: a leaf (someone with
//                one edge) is folded into its neighbour, and people with the
//                same neighbours (twins) share one BFS.
//   span         distinct industries and companies across the people in their
//                circle, and across the ones only they reach.
//   leverage     0–100 blend of the three, from position alone: tier never
//                enters it, so a low-tier gatekeeper ranks as high as their
//                position puts them.
//
// Not enough data is said, never scored (TRAPS §7): a connection whose circle
// isn't scanned has no measured position, so `leverage` is null with a reason,
// not a low number. The same for people past your connections, whose own
// circles the app never sees.
//
// Plain functions, no React; tests/strategy-engine.test.mjs.

import { keyFor } from './separation.js';
import { companyOf, industryOf } from './companies.js';

const YOU = 0;

/** A profile URL as a node key, the same way keyFor reads a row. */
const urlKey = (url) => keyFor({ profile_url: url });

/**
 * The graph as CSR arrays.
 *
 * @param rows  linkedin_connections rows, any degree
 * @param ties  connection_ties rows: { a_url, b_url }
 * @returns {{ keys: string[], index: Map<string, number>, start: Int32Array, adj: Int32Array,
 *   rowOf: object[], degree: Int32Array, circleOf: Map<number, Set<number>>, edges: number }}
 */
export function buildGraph(rows = [], ties = []) {
  const keys = ['you'];
  const index = new Map();
  const rowOf = [null];
  const minDegree = [0];
  const idToKey = new Map();
  const nodeOf = (key, row) => {
    let i = index.get(key);
    if (i == null) {
      i = keys.length;
      index.set(key, i);
      keys.push(key);
      rowOf.push(row);
      minDegree.push(Number(row?.degree) || 2);
    } else {
      const d = Number(row?.degree) || 2;
      if (d < minDegree[i]) { minDegree[i] = d; rowOf[i] = row; }
    }
    return i;
  };
  for (const row of rows || []) {
    if (!row) continue;
    idToKey.set(row.id, keyFor(row));
  }

  const pairs = new Set();
  const edgeList = [];
  const addEdge = (a, b) => {
    if (a === b) return;
    const [x, y] = a < b ? [a, b] : [b, a];
    const sig = x * 4194304 + y;   // 2^22 nodes is far past any network here
    if (pairs.has(sig)) return;
    pairs.add(sig);
    edgeList.push(x, y);
  };

  const circleOf = new Map();       // owner node → the nodes found in their circle
  // Your connections first, so they are nodes before anyone's circle names them.
  for (const row of rows || []) {
    if (!row || Number(row.degree) !== 1) continue;
    addEdge(YOU, nodeOf(keyFor(row), row));
  }
  // A circle's people, once its owner is a node. A chain (someone found in the
  // circle of someone past your connections) can list a person before their
  // circle's owner, so this goes round until a pass adds no one.
  let pending = (rows || []).filter((row) => row && row.source_connection_id != null);
  for (let more = true; more && pending.length;) {
    more = false;
    const later = [];
    for (const row of pending) {
      const ownerKey = idToKey.get(row.source_connection_id);
      const key = keyFor(row);
      if (ownerKey == null || ownerKey === key) continue;   // whose circle is unknown: no edge to draw
      const owner = index.get(ownerKey);
      if (owner == null) { later.push(row); continue; }      // nothing links them to you yet
      const i = nodeOf(key, row);
      addEdge(owner, i);
      let set = circleOf.get(owner);
      if (!set) circleOf.set(owner, (set = new Set()));
      set.add(i);
      more = true;
    }
    pending = later;
  }
  for (const t of ties || []) {
    const a = index.get(urlKey(t?.a_url));
    const b = index.get(urlKey(t?.b_url));
    if (a == null || b == null) continue;
    if (minDegree[a] !== 1 || minDegree[b] !== 1) continue;
    addEdge(a, b);
  }

  const n = keys.length;
  const degree = new Int32Array(n);
  for (let e = 0; e < edgeList.length; e++) degree[edgeList[e]]++;
  const start = new Int32Array(n + 1);
  for (let i = 0; i < n; i++) start[i + 1] = start[i] + degree[i];
  const fill = start.slice(0, n);
  const adj = new Int32Array(edgeList.length);
  for (let e = 0; e < edgeList.length; e += 2) {
    const a = edgeList[e];
    const b = edgeList[e + 1];
    adj[fill[a]++] = b;
    adj[fill[b]++] = a;
  }
  return { keys, index, start, adj, rowOf, degree, circleOf, minDegree, edges: edgeList.length / 2 };
}

/**
 * Exclusive reach: for each node, the nodes cut off from You if it went, as
 * DFS preorder ranges [from, to). Iterative (a chain of 15k would overflow a
 * recursive one). Nodes outside your component get nothing.
 */
export function exclusiveRanges(g) {
  const n = g.keys.length;
  const { start, adj } = g;
  const disc = new Int32Array(n).fill(-1);
  const low = new Int32Array(n);
  const size = new Int32Array(n);
  const parent = new Int32Array(n).fill(-1);
  const next = new Int32Array(n);         // the next arc to look at, per node
  const order = new Int32Array(n);        // preorder: order[disc] = node
  const ranges = new Map();
  if (n === 0) return { ranges, order, disc };
  let time = 0;
  const stack = [YOU];
  disc[YOU] = low[YOU] = time; order[time++] = YOU; next[YOU] = start[YOU];
  while (stack.length) {
    const v = stack[stack.length - 1];
    if (next[v] < start[v + 1]) {
      const w = adj[next[v]++];
      if (disc[w] === -1) {
        parent[w] = v;
        disc[w] = low[w] = time; order[time++] = w; next[w] = start[w];
        stack.push(w);
      } else if (w !== parent[v] && disc[w] < low[v]) {
        low[v] = disc[w];
      }
      continue;
    }
    stack.pop();
    size[v] += 1;
    const p = parent[v];
    if (p >= 0) {
      size[p] += size[v];
      if (low[v] < low[p]) low[p] = low[v];
      // Everything under v hangs on p: take p away and it can't reach You.
      if (p !== YOU && low[v] >= disc[p]) {
        let list = ranges.get(p);
        if (!list) ranges.set(p, (list = []));
        list.push([disc[v], disc[v] + size[v]]);
      }
    }
  }
  return { ranges, order, disc };
}


/**
 * Brandes' betweenness, You never an endpoint, normalised by the pairs that
 * could pass through each node: (n − 1)(n − 2) / 2 for the n people who are
 * not You.
 *
 * Two exact shortcuts, since most of a network is leaves (a connection whose
 * circle isn't scanned, someone in one circle only):
 *   - a leaf is taken out of the graph that is walked and carried by its
 *     neighbour p as a weight: as a target it is p's distance plus one, by
 *     p's paths, and p is on every one of them; as a source its paths are
 *     p's, plus p on all of them.
 *   - people with exactly the same neighbours (twins: two people in the same
 *     two circles) have the same dependencies everywhere but on each other,
 *     where both are 0, so one BFS stands for all of them.
 * tests/strategy-engine.test.mjs checks both against every pair counted by hand.
 */
export function betweenness(g) {
  const steps = betweennessSteps(g);
  for (;;) {
    const r = steps.next();
    if (r.done) return r.value;
  }
}

const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

/**
 * betweenness, as a generator that yields every ~15 ms of work, so a server
 * can let other requests through while it runs (strategyEngineAsync).
 */
export function* betweennessSteps(g) {
  const n = g.keys.length;
  const { start, adj, degree } = g;
  const bc = new Float64Array(n);
  if (n < 4) return bc;

  // Which nodes fold, and into whom.
  const folded = new Uint8Array(n);
  const leavesOf = new Int32Array(n);
  for (let v = 1; v < n; v++) {
    if (degree[v] !== 1) continue;
    const p = adj[start[v]];
    if (degree[p] > 1 || p === YOU) { folded[v] = 1; leavesOf[p]++; }
  }

  // The graph that is walked: everyone who doesn't fold, renumbered.
  const toNew = new Int32Array(n).fill(-1);
  const toOld = [];
  for (let v = 0; v < n; v++) if (!folded[v]) { toNew[v] = toOld.length; toOld.push(v); }
  const m = toOld.length;
  const cStart = new Int32Array(m + 1);
  for (let i = 0; i < m; i++) {
    const v = toOld[i];
    let d = 0;
    for (let a = start[v]; a < start[v + 1]; a++) if (!folded[adj[a]]) d++;
    cStart[i + 1] = cStart[i] + d;
  }
  const cAdj = new Int32Array(cStart[m]);
  for (let i = 0, f = 0; i < m; i++) {
    const v = toOld[i];
    for (let a = start[v]; a < start[v + 1]; a++) if (!folded[adj[a]]) cAdj[f++] = toNew[adj[a]];
  }
  const you = toNew[YOU];
  const leaves = new Float64Array(m);
  const target = new Float64Array(m);     // how many targets each node stands for: itself (not You) and its leaves
  for (let i = 0; i < m; i++) {
    leaves[i] = leavesOf[toOld[i]];
    target[i] = (i === you ? 0 : 1) + leaves[i];
  }

  // How many sources each BFS stands for: itself, its folded leaves, its twins.
  const weight = new Float64Array(m);
  const classOf = new Map();
  for (let i = 0; i < m; i++) {
    weight[i] += leaves[i];
    if (i === you) continue;
    if (leaves[i] > 0) { weight[i] += 1; continue; }   // a leaf's neighbour has a neighbourhood all its own
    const v = toOld[i];
    const nb = Array.from(adj.subarray(start[v], start[v + 1])).sort((a, b) => a - b).join(',');
    const rep = classOf.get(nb);
    if (rep == null) { classOf.set(nb, i); weight[i] += 1; } else weight[rep] += 1;
  }

  const total = new Float64Array(m);
  const dist = new Int32Array(m).fill(-1);
  const sigma = new Float64Array(m);
  const delta = new Float64Array(m);
  const queue = new Int32Array(m);
  const preds = new Int32Array(cAdj.length);
  const predEnd = new Int32Array(m);
  let last = now();
  for (let s = 0; s < m; s++) {
    const w = weight[s];
    if (w === 0) continue;
    if ((s & 31) === 0 && now() - last > 15) { yield; last = now(); }
    let head = 0; let tail = 0;
    queue[tail++] = s; dist[s] = 0; sigma[s] = 1; predEnd[s] = cStart[s];
    while (head < tail) {
      const v = queue[head++];
      const dv = dist[v] + 1;
      for (let a = cStart[v], end = cStart[v + 1]; a < end; a++) {
        const x = cAdj[a];
        if (dist[x] === -1) { dist[x] = dv; queue[tail++] = x; predEnd[x] = cStart[x]; }
        if (dist[x] === dv) { sigma[x] += sigma[v]; preds[predEnd[x]++] = v; }
      }
    }
    // Dependencies, farthest first. Reached counts everyone s reaches, leaves included.
    let reached = leaves[s];
    for (let i = tail - 1; i > 0; i--) {
      const x = queue[i];
      reached += 1 + leaves[x];
      const coeff = (target[x] + delta[x]) / sigma[x];
      for (let a = cStart[x], end = predEnd[x]; a < end; a++) {
        const v = preds[a];
        delta[v] += sigma[v] * coeff;
      }
      // Through x: everyone past it, and its own leaves.
      total[x] += w * (delta[x] + leaves[x]);
    }
    // A folded leaf of s goes through s to everyone s reaches but the leaf itself and You.
    if (leaves[s] > 0 && s !== you) total[s] += leaves[s] * (reached - 1 - (you >= 0 && dist[you] >= 0 ? 1 : 0));
    for (let i = 0; i < tail; i++) { const x = queue[i]; dist[x] = -1; sigma[x] = 0; delta[x] = 0; }
  }
  const people = n - 1;                   // everyone but You
  const pairs = ((people - 1) * (people - 2)) / 2;
  for (let i = 0; i < m; i++) bc[toOld[i]] = pairs > 0 ? total[i] / 2 / pairs : 0;
  bc[YOU] = 0;
  return bc;
}


const LOW_TIERS = new Set(['C', 'D']);
const TOP_TIERS = new Set(['S', 'A']);
const plural = (n, one, many = `${one}s`) => `${n.toLocaleString('en-US')} ${n === 1 ? one : many}`;

/** Each node's company and industry, read once: { co, ind } (either may be null). */
function workOf(g, cache, i) {
  let w = cache[i];
  if (w === undefined) {
    const row = g.rowOf[i];
    const co = row ? companyOf(row) : null;
    const ind = row ? industryOf(co || row.company, row.headline).key : 'unknown';
    w = cache[i] = { co: co ? String(co).toLowerCase() : null, ind: ind === 'unknown' ? null : ind };
  }
  return w;
}

/** Industries and companies across a set of nodes. */
function spanOf(g, cache, nodes) {
  const companies = new Set();
  const industries = new Set();
  for (const i of nodes) {
    const { co, ind } = workOf(g, cache, i);
    if (co) companies.add(co);
    if (ind) industries.add(ind);
  }
  return { companies: companies.size, industries: industries.size };
}

/**
 * Everyone's position. Returns a Map of person key → their entry, plus the
 * graph's size and how long it took.
 *
 * An entry: { status: 'measured' | 'unscanned' | 'beyond', leverage (0–100 or
 * null), only, betweenness, circle, span: { companies, industries },
 * onlySpan: { companies, industries }, gatekeeper, rank (1 is the highest
 * leverage, among the measured) }. Text for it is whyLine / gatekeeperLine.
 */
export function strategyEngine(rows = [], ties = []) {
  const t0 = now();
  const g = buildGraph(rows, ties);
  return positions(g, betweenness(g), t0);
}

/** strategyEngine, letting other work run between slices of the betweenness pass. The same answer. */
export async function strategyEngineAsync(rows = [], ties = []) {
  const t0 = now();
  const g = buildGraph(rows, ties);
  const steps = betweennessSteps(g);
  let r = steps.next();
  while (!r.done) {
    await new Promise((resolve) => setTimeout(resolve, 0));
    r = steps.next();
  }
  return positions(g, r.value, t0);
}

function positions(g, bc, t0) {
  const n = g.keys.length;
  const { ranges, order } = exclusiveRanges(g);
  const people = new Map();
  let maxOnly = 0; let maxBc = 0; let maxSpan = 0;
  const measured = [];
  const work = new Array(n);
  for (let v = 1; v < n; v++) {
    const circle = g.circleOf.get(v);
    const deg = g.minDegree[v];
    const status = circle?.size ? 'measured' : deg === 1 ? 'unscanned' : 'beyond';
    const entry = { status, leverage: null, only: 0, betweenness: bc[v], circle: circle?.size || 0,
      span: { companies: 0, industries: 0 }, onlySpan: { companies: 0, industries: 0 }, gatekeeper: false, rank: null,
      tier: g.rowOf[v]?.tier ?? null, degree: deg };
    if (status === 'measured') {
      const cut = [];
      for (const [from, to] of ranges.get(v) || []) for (let i = from; i < to; i++) cut.push(order[i]);
      entry.only = cut.length;
      entry.span = spanOf(g, work, circle);
      entry.onlySpan = spanOf(g, work, cut);
      maxOnly = Math.max(maxOnly, entry.only);
      maxBc = Math.max(maxBc, bc[v]);
      maxSpan = Math.max(maxSpan, entry.span.industries + entry.span.companies / 10);
      measured.push(entry);
    }
    people.set(g.keys[v], entry);
  }
  // The blend, each part scaled to the network's own highest so it reads 0–1:
  // exclusive reach on a log scale (the difference between 0 and 20 matters
  // more than between 400 and 420), betweenness on a square root (it is
  // heavily skewed), span as it is.
  for (const e of measured) {
    const ex = maxOnly > 0 ? Math.log1p(e.only) / Math.log1p(maxOnly) : 0;
    const be = maxBc > 0 ? Math.sqrt(e.betweenness / maxBc) : 0;
    const sp = maxSpan > 0 ? (e.span.industries + e.span.companies / 10) / maxSpan : 0;
    e.leverage = Math.round(100 * (0.5 * ex + 0.35 * be + 0.15 * sp));
    e.gatekeeper = e.only > 0 && e.leverage >= 50;
  }
  measured.sort((a, b) => b.leverage - a.leverage || b.only - a.only || b.betweenness - a.betweenness);
  measured.forEach((e, i) => { e.rank = i + 1; });

  return { people, nodes: n, edges: g.edges, measured: measured.length, ms: Math.round(now() - t0) };
}

/** "Gatekeeper · reaches 38 only through them · spans 4 industries", or null when they aren't one. */
export function gatekeeperLine(e) {
  if (!e || e.status !== 'measured' || !e.gatekeeper) return null;
  const parts = ['Gatekeeper', `reaches ${e.only.toLocaleString('en-US')} only through them`];
  if (e.span.industries > 0) parts.push(`spans ${plural(e.span.industries, 'industry', 'industries')}`);
  return parts.join(' · ');
}

/**
 * The blunt one-liner: why they stand where they do. Never advice about how
 * to treat the person, only what their position is.
 */
export function whyLine(e) {
  if (!e) return 'Not enough data: they aren’t in the mapped network.';
  if (e.status === 'unscanned') return 'Not enough data: their circle isn’t scanned yet, so their position is unknown.';
  if (e.status === 'beyond') return 'Not enough data: their own circle is past what you can scan.';
  const at = e.onlySpan.companies > 0 ? ` at ${plural(e.onlySpan.companies, 'company', 'companies')}` : '';
  const only = `the only bridge to ${plural(e.only, 'person', 'people')}${at}`;
  if (e.only > 0) {
    if (LOW_TIERS.has(e.tier)) return `Low tier, but ${only}.`;
    if (TOP_TIERS.has(e.tier)) return `High tier and ${only}.`;
    return `${only.charAt(0).toUpperCase()}${only.slice(1)}.`;
  }
  return 'Everyone in their circle has another way in: a connector, not a gatekeeper.';
}

/**
 * A fingerprint of everything the engine reads: who is where, whose circle,
 * the ties, and the tier and work the words use. The server keeps one answer
 * per network and works it out again only when this changes (after a scan or
 * a rescore), not on every request.
 */
export function networkStamp(rows = [], ties = []) {
  let h = 0x811c9dc5;
  const mix = (s) => {
    const str = String(s ?? '');
    for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193); }
    h ^= 0x7c; h = Math.imul(h, 0x01000193);
  };
  for (const r of rows || []) {
    mix(r?.id); mix(r?.degree); mix(r?.source_connection_id); mix(r?.profile_url);
    mix(r?.tier); mix(r?.company); mix(r?.headline);
  }
  for (const t of ties || []) { mix(t?.a_url); mix(t?.b_url); }
  return `${(rows || []).length}.${(ties || []).length}.${(h >>> 0).toString(36)}`;
}

/** Plain-object form of strategyEngine's result, for JSON. */
export function strategyJson(result) {
  const people = {};
  for (const [key, e] of result.people) people[key] = e;
  return { people, nodes: result.nodes, edges: result.edges, measured: result.measured, ms: result.ms };
}
