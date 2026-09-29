// Who is irreplaceable among your bridges.
//
// A bridge's exclusive reach: for each person in their circle, 1 ÷ how many of
// your bridges reach that person, added up. Someone only Maya reaches counts 1
// to her; someone three bridges reach counts a third to each. It's ego
// betweenness (Everett & Borgatti 2005), which on this network's shape (you →
// your connections → their circles) gives Brandes' betweenness, in one pass.
// `only` is how many nobody else reaches: "212 of your people only through
// Maya". People who are your connections already need no bridge, so they
// don't count.
//
// Plain functions, no React; tests/brokerage.test.mjs.

import { keyFor } from './separation.js';

/** Map of bridge id → { reach, only, total }, from the rows the views already have. */
export function exclusiveReach(degree2 = [], connections = []) {
  const yours = new Set((connections || []).map(keyFor));
  const bridgesOf = new Map();          // person → the bridges who reach them
  for (const row of degree2 || []) {
    const bridge = row?.source_connection_id;
    if (bridge == null) continue;
    const key = keyFor(row);
    if (yours.has(key)) continue;
    let set = bridgesOf.get(key);
    if (!set) bridgesOf.set(key, (set = new Set()));
    set.add(bridge);
  }
  const out = new Map();
  for (const set of bridgesOf.values()) {
    for (const bridge of set) {
      const r = out.get(bridge) || { reach: 0, only: 0, total: 0 };
      r.reach += 1 / set.size;
      r.total += 1;
      if (set.size === 1) r.only += 1;
      out.set(bridge, r);
    }
  }
  return out;
}
