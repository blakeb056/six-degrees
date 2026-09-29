// Network health for the Scores tab (item 41, Graph Study §8.5/§10.2), from
// what the app already keeps. No percentiles against other people: there is no
// data to compare with, so every number is about your own network.
//
//   circles     how many of your connections have a scanned circle
//   early       fewer than 5: say the numbers are an early estimate
//   twoWays     of everyone you reach through a circle, the share reached two or
//               more ways (lib/brokerage.js redundancy)
//   effective   Burt's effective size of your own network, N − 2t/N, with t the ties
//               between your connections that scans have kept (lib/ties.js), and
//               efficiency ES/N. Honest only as far as those ties go.
//   top         your five connections by who only they reach
//
// Plain functions, no React; tests/network-health.test.mjs.

import { exclusiveReach, redundancy } from './brokerage.js';

export function networkHealth({ degree1 = [], degree2 = [], ties = 0 } = {}) {
  const circleOf = new Map();
  for (const row of degree2) {
    if (row?.source_connection_id != null) circleOf.set(row.source_connection_id, (circleOf.get(row.source_connection_id) || 0) + 1);
  }
  const only = exclusiveReach(degree2, degree1);
  const n = degree1.length;
  const t = Math.max(0, Number(ties) || 0);
  const es = n ? n - (2 * t) / n : 0;
  const byId = new Map(degree1.map((c) => [c.id, c]));
  const top = [...only.entries()]
    .sort((a, b) => b[1].reach - a[1].reach || String(a[0]).localeCompare(String(b[0])))
    .slice(0, 5)
    .map(([id, r]) => {
      const c = byId.get(id) || {};
      return { id, name: c.name || '', company: c.company || '', tier: c.tier || '', circle: circleOf.get(id) || 0, only: r.only, share: r.total ? r.only / r.total : 0 };
    });
  return {
    circles: circleOf.size,
    early: circleOf.size < 5,
    twoWays: redundancy(degree2, degree1),
    effective: { n, ties: t, size: es, efficiency: n ? es / n : 0 },
    top,
  };
}
