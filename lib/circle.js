// Someone's circle as rings, for the top of their profile card.
//
// Blake, 2026-09-28: "for every profile card we can see their network circle
// … all of their current connections scraped and graded but then outside of
// that sits the connections all from d2 that we added and scanned coming from
// that person as the provider of the cluster … and then for d3,d4,d5,d6".
//
// Two facts the app already keeps make the whole chain, with nothing new stored:
//   source_connection_id     whose circle a row sits in: a scan of that person found it
//   unlocked_from_bridge_id  who introduced someone you connected with, kept
//                            after they became your connection (lib/promote.js)
// So from a person P: P's circle (D2, through P) → the people in it you
// connected with or asked → their circles (D3) → who you added from those →
// their circles (D4) … to six degrees. Everyone appears once, in the nearest
// ring they reach.

import { keyFor, score1 } from './separation.js';

export const MAX_DEGREE = 6;

/** A request is out to them and they haven't accepted (Sidebar's "Connect to Unlock Path"). */
export const requestedByDefault = (row) => row?.unlock_status === 'pending';

/**
 * Rows grouped two ways: `circles`, id → the rows a scan of that person found;
 * `introduced`, id → your connections you met through them.
 */
export function circleIndex(connections = [], degree2 = []) {
  const circles = new Map();
  for (const row of degree2 || []) {
    const id = row?.source_connection_id;
    if (id == null) continue;
    let list = circles.get(id);
    if (!list) circles.set(id, (list = []));
    list.push(row);
  }
  const introduced = new Map();
  for (const row of connections || []) {
    const id = row?.unlocked_from_bridge_id;
    if (id == null || row.degree !== 1) continue;
    let list = introduced.get(id);
    if (!list) introduced.set(id, (list = []));
    list.push(row);
  }
  return { circles, introduced };
}

const STATE_ORDER = { connected: 0, requested: 1 };
const byStateThenPower = (a, b) => (STATE_ORDER[a.state] ?? 2) - (STATE_ORDER[b.state] ?? 2)
  || score1(b.row) - score1(a.row)
  || String(a.row.name || '').localeCompare(String(b.row.name || ''));

/**
 * The rings around `person`: [{ degree, people: [{ row, key, parentId, state }] }],
 * degree 2 first. `state` is 'connected' (you added them, so their own circle
 * is the next ring out), 'requested' (a request is out: drawn dotted) or null.
 * Also the totals: { people, connected, requested }.
 */
export function circleRings(person, index, { maxDegree = MAX_DEGREE, isRequested = requestedByDefault } = {}) {
  const rings = [];
  const totals = { people: 0, connected: 0, requested: 0 };
  if (!person || !index) return { rings, totals };
  const seen = new Set([keyFor(person)]);
  let frontier = [person];
  for (let degree = 2; degree <= maxDegree && frontier.length; degree++) {
    const ring = [];
    const next = [];
    for (const parent of frontier) {
      const kids = [];
      // The people you connected with first: they have circles of their own.
      for (const row of index.introduced.get(parent.id) || []) {
        const key = keyFor(row);
        if (seen.has(key)) continue;
        seen.add(key);
        kids.push({ row, key, parentId: parent.id, state: 'connected' });
        next.push(row);
      }
      for (const row of index.circles.get(parent.id) || []) {
        const key = keyFor(row);
        if (seen.has(key)) continue;
        seen.add(key);
        kids.push({ row, key, parentId: parent.id, state: isRequested(row) ? 'requested' : null });
      }
      kids.sort(byStateThenPower);
      ring.push(...kids);
    }
    if (!ring.length) break;
    for (const p of ring) {
      totals.people++;
      if (p.state === 'connected') totals.connected++;
      else if (p.state === 'requested') totals.requested++;
    }
    rings.push({ degree, people: ring });
    frontier = next;
  }
  return { rings, totals };
}

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

/**
 * Where every dot goes, in a square `size` wide: a radial tree. Each person
 * gets a slice of the circle in proportion to how much of the next rings
 * hangs off them, so whoever opened the most reach shows it at a glance, and
 * their circle fans out behind them.
 * Returns { size, center, rings: [{ degree, radius, dotR, items }], spokes }.
 */
export function circleLayout(rings = [], size = 240) {
  const half = size / 2;
  const R = rings.length;
  const radiusOf = (k) => half * (R === 1 ? 0.78 : 0.4 + 0.52 * (k / (R - 1)));

  // Each ring's people by who they hang off, in the ring's order.
  const byParent = rings.map((ring) => {
    const m = new Map();
    for (const p of ring.people) {
      if (!m.has(p.parentId)) m.set(p.parentId, []);
      m.get(p.parentId).push(p);
    }
    return m;
  });
  const kidsOf = (k, id) => byParent[k + 1]?.get(id) || [];

  // Weights, outermost ring first: at least 1, else what hangs off them.
  const weight = new Map();
  for (let k = R - 1; k >= 0; k--) {
    for (const p of rings[k].people) {
      const w = p.state === 'connected' ? kidsOf(k, p.row.id).reduce((s, c) => s + weight.get(c), 0) : 0;
      weight.set(p, Math.max(1, w));
    }
  }

  const out = [];
  const spokes = [];
  const span = new Map();   // row id → [start, end] angle for its children
  const START = -Math.PI / 2;
  for (let k = 0; k < R; k++) {
    const radius = radiusOf(k);
    const people = rings[k].people;
    // More than their slice holds without the dots touching: rows, neighbours
    // alternating between them, so a big circle never draws as a solid line.
    // Each keeps its angle behind who they hang off. Rows go out towards the
    // next ring, or for the outermost, in towards the one before (less than
    // half way either side, so two rings' rows never meet).
    const gap = Math.max(2.4, size / 100);
    const inward = k === R - 1 && R > 1;
    const band = (inward ? radius - radiusOf(k - 1) : (k + 1 < R ? radiusOf(k + 1) : half * 0.97) - radius) * 0.45;
    const maxRows = Math.max(1, Math.floor(band / gap) + 1);
    const rowGap = maxRows > 1 ? (inward ? -1 : 1) * Math.min(gap * 1.2, band / (maxRows - 1)) : 0;
    const rowsFor = (count, arc) => clamp(Math.ceil((count * gap) / Math.max(1e-9, radius * arc)), 1, maxRows);
    let rows = 1;
    let room = Infinity;      // the least room any one dot gets along its row
    const items = [];
    for (const [parentId, group] of byParent[k]) {
      const [a0, a1] = k === 0 ? [START, START + 2 * Math.PI] : span.get(parentId) || [START, START + 2 * Math.PI];
      const total = group.reduce((s, p) => s + weight.get(p), 0);
      const groupRows = rowsFor(group.length, a1 - a0);
      rows = Math.max(rows, groupRows);
      room = Math.min(room, (radius * (a1 - a0) * groupRows) / Math.max(1, group.length));
      let n = 0;
      let a = a0;
      for (const p of group) {
        const w = ((a1 - a0) * weight.get(p)) / total;
        const angle = a + w / 2;
        const r = radius + (n++ % groupRows) * rowGap;
        const x = half + r * Math.cos(angle);
        const y = half + r * Math.sin(angle);
        items.push({ ...p, angle, x, y });
        if (p.state === 'connected') span.set(p.row.id, [a, a + w]);
        a += w;
      }
    }
    // A line from each person you added out to the middle of their own circle.
    if (k + 1 < R) {
      const nextR = radiusOf(k + 1);
      for (const it of items) {
        if (it.state !== 'connected' || !kidsOf(k, it.row.id).length) continue;
        const [s, e] = span.get(it.row.id);
        const mid = (s + e) / 2;
        spokes.push({ x1: it.x, y1: it.y, x2: half + nextR * Math.cos(mid), y2: half + nextR * Math.sin(mid) });
      }
    }
    // Sized by the most crowded slice, and never wider than the gap between rows.
    const dotR = clamp(Math.min(room * 0.32, rows > 1 ? Math.abs(rowGap) * 0.42 : Infinity), 0.8, size / 60);
    out.push({ degree: rings[k].degree, radius, dotR, rows, items });
  }
  return { size, center: { x: half, y: half }, rings: out, spokes };
}
