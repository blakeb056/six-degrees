// Filters → Lines on Network Circle's Galaxy (Blake, 2026-10-05: "we can enable
// tier lines that basically show the S tier's lines of who it's connected to"):
// which lines are drawn, by the tiers of the people at their two ends. Only
// lines: every dot stays where it is, and the layout is never rebuilt
// (app/components/ForceGraph.js skips drawing the rest). No imports, so the
// rule can be tested on its own (tests/tier-lines.test.mjs).

export const LINE_TIERS = ['S', 'A', 'B', 'C', 'D'];

/**
 * A choice, as it is kept with the Galaxy's other settings (lib/galaxy-lab.js
 * `tierLines`): 'all' (every line, as always), 'none' (no lines at all), or the
 * tiers picked, in tier order, as one word: 'S', 'SA', 'BD'. Anything else
 * (an old or hand-edited setting) is 'all'.
 */
export function cleanTierLines(value) {
  if (value === 'all' || value === 'none') return value;
  if (typeof value !== 'string' || !/^[SABCD]{1,5}$/.test(value)) return 'all';
  const picked = LINE_TIERS.filter((t) => value.includes(t));
  return picked.length === LINE_TIERS.length ? 'all' : picked.join('');
}

/** The tiers a choice draws lines through: every one for 'all', none for 'none'. */
export function pickedTiers(choice) {
  const c = cleanTierLines(choice);
  if (c === 'all') return new Set(LINE_TIERS);
  if (c === 'none') return new Set();
  return new Set(c.split(''));
}

/**
 * A tier chip tapped. From All or None it picks that tier alone (so one tap on
 * S is "only S"); otherwise it adds or takes that tier away. Taking the last
 * one away is None, and picking all five is All.
 */
export function toggleLineTier(choice, tier) {
  if (!LINE_TIERS.includes(tier)) return cleanTierLines(choice);
  const c = cleanTierLines(choice);
  if (c === 'all' || c === 'none') return tier;
  const picked = pickedTiers(c);
  if (picked.has(tier)) picked.delete(tier); else picked.add(tier);
  if (!picked.size) return 'none';
  return cleanTierLines(LINE_TIERS.filter((t) => picked.has(t)).join(''));
}

/** A tier chip shows as picked only when that tier was picked: under All, it is the All chip that is. */
export const isPicked = (choice, tier) => {
  const c = cleanTierLines(choice);
  return c !== 'all' && c !== 'none' && c.includes(tier);
};

const idOf = (end) => (end && typeof end === 'object' ? end.id : end);
// No tier is the lowest, as the Galaxy rings them.
const tierOf = (end) => (end && typeof end === 'object' ? end.tier || 'D' : null);

/**
 * Which lines to draw, one byte a line (1 drawn, 0 not), in the order of
 * `links`, each `{ source, target }` with the people at its ends ({ id, tier }).
 * A line is drawn when either end is a person whose tier is picked: with only S,
 * the lines from you to your S-tier connections and from each of them out to
 * their circle, and any line into an S-tier person further out. You are no tier.
 *
 * `keep` is the person selected: their own lines are drawn whatever the choice,
 * even None, so clicking someone always shows who they connect to. Into `into`,
 * when given, to save a fresh array on every replay frame.
 */
export function lineMask(links, choice, { keep = null, into = null } = {}) {
  const out = into && into.length === links.length ? into : new Uint8Array(links.length);
  const c = cleanTierLines(choice);
  const picked = pickedTiers(c);
  for (let i = 0; i < links.length; i++) {
    const { source, target } = links[i];
    let on = c === 'all' || picked.has(tierOf(source)) || picked.has(tierOf(target));
    if (!on && keep != null) on = idOf(source) === keep || idOf(target) === keep;
    out[i] = on ? 1 : 0;
  }
  return out;
}

/** The words under the chips: what the choice draws, plainly. */
export function describeTierLines(choice) {
  const c = cleanTierLines(choice);
  if (c === 'all') return 'Every line is drawn.';
  if (c === 'none') return 'No lines: just the dots. A person you click still shows theirs.';
  const names = c.split('').map((t) => `${t}-Tier`);
  const list = names.length === 1 ? names[0] : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
  return `Only lines that touch ${list}: to you, and out to who they connect you to.`;
}
