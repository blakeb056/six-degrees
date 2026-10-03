// What "hot" means on Paths' two maps (Blake, 2026-10-02: "change color heat
// mapping" on Paths, as on Network Circle). A bubble's size already says how
// many; heat says how strong, so the two never repeat each other.

import { score } from './separation.js';

/** A company's strength: the average power score of its five strongest people shown. */
export function companyStrength(people = []) {
  const top = people.map(score).sort((a, b) => b - a).slice(0, 5);
  return top.length ? top.reduce((s, v) => s + v, 0) / top.length : 0;
}

/**
 * How strong a connection's cluster is, person for person: S counts 3, A 2,
 * everyone else 1, over the cluster's size (1 to 3). Not scanned: -1, the coldest.
 */
export function clusterStrength({ size = 0, S = 0, A = 0 } = {}) {
  if (!size) return -1;
  return (3 * S + 2 * A + Math.max(0, size - S - A)) / size;
}
