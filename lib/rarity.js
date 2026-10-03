// How rare the way in to someone is: a distinction, never a score.
//
// Blake, 2026-09-28: "if i have like 20 or 30 mututals with someone … they are
// most likely to add me but that means they are not that hard to reach … no
// mutuals at all besides the person im adding from then they must be a rarer
// connection". Mutual connections say how much your world and theirs overlap.
// Many means they'll probably accept; few means the path to them is rare and
// the bridge who knows them is worth more. Neither says anything about who they
// are, so rarity never enters the power score or the tier. It is shown and
// filtered beside them: "S and only one way in" is a rare find, "S and warm"
// an easy win.
//
// The count is LinkedIn's own mutual count where a scan saved one
// (mutual_count), else the ways in the app has seen: how many of your scanned
// connections know them. That second one is only a floor. With 14 of 150
// circles scanned, a "1" may really be 20, and it can only go up as you scan
// more, so everything that shows it says where it came from.

export const RARITY = [
  { key: 'only', label: 'Only way in', range: '1', max: 1, color: '#00E5FF' },
  { key: 'rare', label: 'Rare', range: '2–3', max: 3, color: '#4FC3F7' },
  { key: 'uncommon', label: 'Uncommon', range: '4–10', max: 10, color: '#B0BEC5' },
  { key: 'common', label: 'Common', range: '11–30', max: 30, color: '#FFB74D' },
  { key: 'warm', label: 'Warm', range: '31+', max: Infinity, color: '#FF7043' },
];

const BY_KEY = new Map(RARITY.map((r) => [r.key, r]));

/** The band for a number of mutual connections (the bridge counts: at least 1). */
export function rarityFor(count) {
  const n = Math.max(1, Math.floor(Number(count) || 1));
  return RARITY.find((r) => n <= r.max).key;
}

export function rarityInfo(key) {
  return BY_KEY.get(key) ?? null;
}

/**
 * How many mutual connections you share with someone, and where that number
 * came from: { count, from: 'linkedin' | 'scans' }. `waysIn` is how many of
 * your scanned connections know them (lib/separation.js): never fewer than that.
 */
export function mutualsOf(row, waysIn = 1) {
  const saved = Number(row?.mutual_count);
  const seen = Math.max(1, Math.floor(Number(waysIn) || 1));
  // Everyone the app found them through is a mutual connection, so a saved
  // count lower than that is out of date: "only way in" with two ways drawn.
  if (Number.isFinite(saved) && saved >= seen) return { count: Math.floor(saved), from: 'linkedin' };
  return { count: seen, from: 'scans' };
}

/** Someone's rarity: { key, count, from }. */
export function rarityOf(row, waysIn = 1) {
  const m = mutualsOf(row, waysIn);
  return { key: rarityFor(m.count), ...m };
}

/**
 * Does a person pass both filters? Each filter is a Set of what's switched on;
 * an empty set lets everyone through. Tier and rarity must BOTH match, so
 * "S" + "Only way in" is exactly the rare finds.
 */
export function passes({ tier, rarity }, { tiers = new Set(), rarities = new Set() } = {}) {
  if (tiers.size && !tiers.has(tier)) return false;
  if (rarities.size && !(rarity && rarities.has(rarity))) return false;
  return true;
}

/** People per band, for the chips' counts. `items` carry `rarity` (a key). */
export function countByRarity(items = []) {
  const out = Object.fromEntries(RARITY.map((r) => [r.key, 0]));
  for (const it of items) if (it?.rarity && out[it.rarity] !== undefined) out[it.rarity]++;
  return out;
}

/** Turn one key on or off in a filter set, as a new Set (React state). */
export function toggle(set, key) {
  const next = new Set(set);
  if (next.has(key)) next.delete(key);
  else next.add(key);
  return next;
}

// ── The Separation slider ──────────────────────────────────────────────────
// Blake, 2026-10-01: the rare person reachable through one door at one end,
// the easier, well-connected ones at the other, "so it's seamless"; 2026-10-02:
// "i want it to be slider ajusted and can be dynmaic". One number, 0 to 100:
// 0 puts the rarest ways in first, 100 the easiest, and 50 is each person's own
// score alone, as the list has always been. It reorders; it never changes a
// score, a tier or a rank. No odds are claimed: the app hasn't measured how
// often anyone accepts.

export const SLIDER_MIDDLE = 50;

/** How easy the way in is: 0 with one mutual connection, 1 with 31 or more, on a log scale (1→3 counts like 10→30). */
export function easeOf(count) {
  const n = Math.max(1, Math.floor(Number(count) || 1));
  return Math.min(1, Math.log(n) / Math.log(31));
}

/**
 * Where someone sorts with the slider at `at`: their score, weighted by how
 * well their way in fits the end the slider leans to. At 50 it is the score.
 */
export function slideValue(score, count, at = SLIDER_MIDDLE) {
  const lean = (Math.max(0, Math.min(100, Number(at) || 0)) - SLIDER_MIDDLE) / SLIDER_MIDDLE;   // -1 rare … +1 easy
  if (!lean) return score;
  const ease = easeOf(count);
  const pull = Math.abs(lean);
  return score * (1 - pull + pull * (lean < 0 ? 1 - ease : ease));
}

/** What the slider is doing at `at`, in words: { name, detail }. */
export function slideLabel(at = SLIDER_MIDDLE) {
  const v = Math.max(0, Math.min(100, Math.round(Number(at) || 0)));
  if (v <= 10) return { name: 'Rarest first', detail: 'Strong people with one way in: the connection who knows them is the only door you have.' };
  if (v < 45) return { name: 'Leaning rare', detail: 'Strong people with few mutual connections move up; the ones everybody knows move down.' };
  if (v <= 55) return { name: 'By power', detail: 'Each person’s own score alone. How many of your connections know them doesn’t change the order.' };
  if (v < 90) return { name: 'Leaning easy', detail: 'Strong people you share more mutual connections with move up: more people who could introduce you.' };
  return { name: 'Easiest first', detail: 'Strong people you share the most mutual connections with: the warmest introductions. All the way right, the map aims at whoever the most of your connections lead to, every one drawn.' };
}
