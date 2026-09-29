// Everyone the app knows, by degree, for Network Circle's degree filter.
//
// 1st: your connections. 2nd: anyone in a scanned circle, including the people
// behind someone you added, since you're connected to them now. 3rd: anyone a
// company scan found who is neither. Each person counts once, at the nearest
// degree they're found (by profile, lib/separation.js keyFor), whichever
// circle or scan found them first.

import { keyFor } from './separation.js';

export function peopleByDegree(degree1 = [], degree2 = [], degree3 = []) {
  const seen = new Set();
  const take = (rows, degree) => {
    const out = [];
    for (const row of rows || []) {
      const key = keyFor(row);
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(row.degree === degree ? row : { ...row, degree });
    }
    return out;
  };
  return { 1: take(degree1, 1), 2: take(degree2, 2), 3: take(degree3, 3) };
}

export function tierCountsOf(rows = []) {
  const counts = {};
  for (const row of rows) counts[row.tier] = (counts[row.tier] || 0) + 1;
  return counts;
}
