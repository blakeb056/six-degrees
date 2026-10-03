// Your network's level: the number in the round button at the top right, and
// the Profile page's Network Power. One formula for both: the header used to
// leave out C and D tiers and catalysts, so it showed a lower level than the
// Profile page it opens.

/** Network Power, as the Profile page explains it. */
export function networkPower(degree1 = [], degree2 = []) {
  const tiers = { S: 0, A: 0, B: 0, C: 0, D: 0 };
  for (const c of degree1) tiers[c.tier] = (tiers[c.tier] || 0) + 1;
  let d2S = 0;
  for (const c of degree2) if (c.tier === 'S') d2S += 1;
  const clusters = new Set(degree2.map((c) => c.source_connection_id).filter(Boolean)).size;
  const catalysts = degree1.filter((c) => c.is_catalyst).length;
  return tiers.S * 100 + tiers.A * 40 + tiers.B * 15 + tiers.C * 5 + tiers.D * 1
    + clusters * 200 + catalysts * 150 + d2S * 50 + degree1.length;
}

/** The level a Network Power reaches: level n takes 10·n² power. */
export const levelOf = (power) => Math.floor(Math.sqrt(Math.max(0, power) / 10));

export const networkLevel = (degree1, degree2) => levelOf(networkPower(degree1, degree2));

// Remembered for this tab, so a page that doesn't load the network (Scan, say)
// can show the same number without loading it. One per network: your own, the
// sample, or a CSV. A small store, for useSyncExternalStore.
const KEY = 'six-degrees-level';
const known = {};
const listeners = new Set();

export function watchLevel(f) {
  listeners.add(f);
  return () => listeners.delete(f);
}

export function levelNow(source = 'own') {
  if (!(source in known)) {
    try {
      const raw = sessionStorage.getItem(`${KEY}:${source}`);
      const n = raw == null ? NaN : Number(raw);
      known[source] = Number.isFinite(n) ? n : null;
    } catch { known[source] = null; }
  }
  return known[source];
}

export function rememberLevel(level, source = 'own') {
  if (levelNow(source) === level) return;
  known[source] = level;
  try { sessionStorage.setItem(`${KEY}:${source}`, String(level)); } catch { /* private window: it's loaded again instead */ }
  listeners.forEach((f) => f());
}
