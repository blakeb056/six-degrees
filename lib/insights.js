// Insights on a connection's card (Graph Study §10, items 16 and 19): six plain
// numbers from what the app already keeps, no new scanning. For one of your
// connections; null for a 2nd-degree person.
//
//   circle    how many people are in their scanned circle
//   only      how many of them none of your other connections reach (lib/brokerage.js)
//   twin      whose circle overlaps theirs most, when it's real (15%+, 3+ people)
//   mix       their circle by tier
//   bars      how much of their circle is scanned, 0–5 (lib/reach.js scanBars)
//   rank      where they stand among your connections by who only they reach
//   companies where the most people in their circle work, the top two
//
// Plain functions, no React; tests/insights.test.mjs.

import { keyFor } from './separation.js';
import { scanBars } from './reach.js';

const TIERS = ['S', 'A', 'B', 'C', 'D'];

export function profileInsights(person, { degree2 = [], exclusive, overlap, reach } = {}) {
  if (!person || person.degree === 2) return null;
  const seen = new Set();
  const mix = { S: 0, A: 0, B: 0, C: 0, D: 0 };
  const at = new Map();
  for (const row of degree2) {
    if (row?.source_connection_id !== person.id) continue;
    const key = keyFor(row);
    if (seen.has(key)) continue;
    seen.add(key);
    mix[TIERS.includes(row.tier) ? row.tier : 'D'] += 1;
    const company = String(row.company || '').trim();
    if (company) at.set(company, (at.get(company) || 0) + 1);
  }
  const companies = [...at.entries()].filter(([, n]) => n >= 2)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 2).map(([name, count]) => ({ name, count }));
  const circle = seen.size;
  const ex = exclusive?.get(person.id) || { reach: 0, only: 0, total: 0 };
  const ov = overlap?.get(person.id);
  const twin = ov && ov.share >= 0.15 && ov.shared >= 3 ? { id: ov.with, share: ov.share, shared: ov.shared } : null;
  const ranked = [...(exclusive?.entries() || [])]
    .sort((a, b) => b[1].reach - a[1].reach || String(a[0]).localeCompare(String(b[0])));
  const place = ranked.findIndex(([id]) => id === person.id);
  return {
    circle,
    only: ex.only,
    onlyShare: circle ? ex.only / circle : 0,
    twin,
    mix,
    bars: reach ? scanBars(person, reach) : null,
    rank: place >= 0 ? place + 1 : null,
    of: ranked.length,
    companies,
  };
}
