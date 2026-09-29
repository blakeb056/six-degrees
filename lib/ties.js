// Ties between your own connections: two people you know who know each other.
//
// A circle scan reads everyone in someone's list, your own connections among
// them, and the app sets those aside rather than saving them as 2nd degree
// (lib/ingest.js splitAlreadyConnected). Each one is a tie between that
// person and the one whose circle it is. Kept in connection_ties (db/schema.js),
// for clustering and communities later; nothing reads them yet.

/** The pairs to keep: the circle's person with each of your connections in it, each pair once, smaller URL first. */
export function tiePairs(ownerUrl, urls = []) {
  const seen = new Set();
  const out = [];
  if (!ownerUrl) return out;
  for (const url of urls) {
    if (!url || url === ownerUrl) continue;
    const [a, b] = url < ownerUrl ? [url, ownerUrl] : [ownerUrl, url];
    const key = `${a} ${b}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ a_url: a, b_url: b });
  }
  return out;
}
