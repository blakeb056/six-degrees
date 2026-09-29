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

/**
 * Which of your connections open the same doors: for each, the one whose
 * circle overlaps theirs most, as the share of people either reaches that both
 * do (Jaccard). "Maya and Tom open the same doors (62%)". Pairs are counted
 * from the people reached two or more ways, so it stays quick.
 *
 * @returns Map of bridge id → { with, share, shared }
 */
export function bridgeOverlap(degree2 = [], connections = []) {
  const reach = exclusiveReach(degree2, connections);
  const yours = new Set((connections || []).map(keyFor));
  const bridgesOf = new Map();
  for (const row of degree2 || []) {
    const bridge = row?.source_connection_id;
    if (bridge == null) continue;
    const key = keyFor(row);
    if (yours.has(key)) continue;
    let set = bridgesOf.get(key);
    if (!set) bridgesOf.set(key, (set = new Set()));
    set.add(bridge);
  }
  const shared = new Map();                // "a|b" → people both reach
  for (const set of bridgesOf.values()) {
    if (set.size < 2) continue;
    const list = [...set];
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const k = list[i] < list[j] ? `${list[i]}|${list[j]}` : `${list[j]}|${list[i]}`;
        shared.set(k, (shared.get(k) || 0) + 1);
      }
    }
  }
  const best = new Map();
  for (const [k, both] of shared) {
    const [a, b] = k.split('|');
    const union = reach.get(a).total + reach.get(b).total - both;
    const share = union ? both / union : 0;
    for (const [me, other] of [[a, b], [b, a]]) {
      const cur = best.get(me);
      if (!cur || share > cur.share) best.set(me, { with: other, share, shared: both });
    }
  }
  return best;
}

/** Of everyone you reach through a circle, the share you reach two or more ways. */
export function redundancy(degree2 = [], connections = []) {
  const reach = exclusiveReach(degree2, connections);
  let people = 0;
  let only = 0;
  for (const r of reach.values()) { people += r.reach; only += r.only; }
  return people ? 1 - only / people : 0;
}
