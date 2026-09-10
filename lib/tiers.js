// Tier constants, shared.
//
// These were duplicated inline in three components. The orbital radii come from
// the v2 build's galaxy — higher leverage orbits closer to you, which is the
// whole visual argument that view is making.

export const TIER_ORDER = ['S', 'A', 'B', 'C', 'D'];

/** S=gold, A=purple, B=blue, C=slate, D=grey. */
export const TIER_COLORS = {
  S: '#f6c344',
  A: '#a78bfa',
  B: '#60a5fa',
  C: '#94a3b8',
  D: '#6b7280',
};

/** The palette the older views use. Kept separate so nothing shifts under them. */
export const TIER_COLORS_CLASSIC = {
  S: '#FFD700',
  A: '#9B59B6',
  B: '#3498DB',
  C: '#95A5A6',
  D: '#BDC3C7',
};

export const TIER_LABELS = {
  S: 'S · Highest leverage',
  A: 'A · High leverage',
  B: 'B · Solid reach',
  C: 'C · Emerging',
  D: 'D · Peripheral',
};

/** Orbital ring radius per tier — higher leverage orbits closer to you. */
export const TIER_RING_RADIUS = {
  S: 150,
  A: 230,
  B: 310,
  C: 390,
  D: 470,
};

export function initialsFor(name) {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  const first = parts[0].charAt(0);
  const last = parts.length > 1 ? parts[parts.length - 1].charAt(0) : '';
  return (first + last).toUpperCase();
}
