// Paths → People: the Paths map with people instead of companies (Blake,
// 2026-10-02: "basically going to look like map but people based and the
// bigger circle is their cluster with value"). One bubble per connection of
// yours, sized by the cluster behind them; a line joins two connections whose
// clusters share people.
//
// Plain functions over the rows the app already has, no React, so
// tests/people-map.test.mjs runs them as they are.

import { keyFor } from './separation.js';

/** What a cluster is worth: S tier counts 3, A tier 2, everyone else 1. */
export const clusterValue = ({ size = 0, S = 0, A = 0 } = {}) => size + 2 * S + A;

/**
 * One entry per connection: { person, id, key, size, S, A, value, only, share }.
 * `size` is the people in their cluster (each once), `only` how many of those
 * none of your other connections' clusters hold, `share` = only / size.
 * Also `links`: [{ a, b, shared }] for every two connections whose clusters
 * share people, most shared first, and `rank(id)`: the share of your scanned
 * connections whose cluster is worth less.
 */
export function peopleMap(d1 = [], d2 = [], { maxLinks = 400 } = {}) {
  const ids = new Set((d1 || []).map((c) => c.id));
  // Each person once per connection whose scan found them.
  const byConnection = new Map();   // id -> Map(key -> row)
  const holders = new Map();        // key -> Set(connection id)
  for (const row of d2 || []) {
    const from = row?.source_connection_id;
    if (from == null || !ids.has(from)) continue;
    const key = keyFor(row);
    let circle = byConnection.get(from);
    if (!circle) byConnection.set(from, (circle = new Map()));
    if (!circle.has(key)) circle.set(key, row);
    let who = holders.get(key);
    if (!who) holders.set(key, (who = new Set()));
    who.add(from);
  }

  const people = (d1 || []).map((c) => {
    const circle = byConnection.get(c.id);
    let S = 0, A = 0, only = 0;
    if (circle) {
      for (const [key, row] of circle) {
        if (row.tier === 'S') S++;
        else if (row.tier === 'A') A++;
        if (holders.get(key)?.size === 1) only++;
      }
    }
    const size = circle ? circle.size : 0;
    return { person: c, id: c.id, key: keyFor(c), size, S, A, value: clusterValue({ size, S, A }), only, share: size ? only / size : 0 };
  });

  // Two connections whose clusters share people. A person known to many of
  // your connections would make a line between every two of them, so past
  // eight holders they are left out of the lines (they still count in `only`).
  const pairs = new Map();
  for (const who of holders.values()) {
    if (who.size < 2 || who.size > 8) continue;
    const list = [...who].sort();
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const k = `${list[i]}\u0000${list[j]}`;
        pairs.set(k, (pairs.get(k) || 0) + 1);
      }
    }
  }
  const links = [...pairs].map(([k, shared]) => {
    const [a, b] = k.split('\u0000');
    return { a, b, shared };
  }).sort((x, y) => y.shared - x.shared || (x.a < y.a ? -1 : 1)).slice(0, maxLinks);

  const values = people.filter((p) => p.size > 0).map((p) => p.value).sort((x, y) => x - y);
  const rank = (id) => {
    const p = people.find((x) => x.id === id);
    if (!p || !p.size || values.length < 2) return null;
    let below = 0;
    while (below < values.length && values[below] < p.value) below++;
    return below / (values.length - 1);
  };
  return { people, links, rank };
}
