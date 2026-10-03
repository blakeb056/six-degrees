// Settings → Scores → Titles: how much each kind of title counts, your way
// (Blake, 2026-10-02: "let the user change the rankings of titles as well …
// incase they value certain people or is using this for outreaching new
// founders", and people who "find more in that role" for outbound or hiring).
//
// Two parts, both in title points (the 0–10 a title is worth before the
// company weighs it, lib/scoring.js LEVELS):
//   points  a level's points, yours: Owner / Entrepreneur at 10, say, to put
//           founders of small companies level with CEOs
//   roles   words in a title, and what anyone whose title has them counts:
//           "account executive" at 10 puts every AE you can reach in S
// Nothing set scores exactly as before. The model applies it (scorePerson);
// this file is the setting and its presets.

import { LEVELS } from './scoring.js';

/** The ladder shown in Settings, top to bottom (the main kinds of title). */
export const RANKED_LEVELS = ['csuite', 'owner', 'vp', 'director', 'manager', 'senior', 'ic', 'unknown', 'intern', 'student'];
export const NO_RANKING = Object.freeze({ points: Object.freeze({}), roles: Object.freeze([]) });
export const MAX_ROLES = 20;
const MAX_ROLE_TEXT = 60;

const clampPoints = (v) => {
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0 || n > 10) throw new Error('Title points go from 0 to 10.');
  return Math.round(n * 2) / 2;
};

export const TITLE_RANKING_SETTING = {
  default: NO_RANKING,
  parse(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('A title ranking is { points, roles }.');
    const points = {};
    for (const [key, v] of Object.entries(value.points || {})) {
      if (!Object.hasOwn(LEVELS, key)) throw new Error(`There is no kind of title called '${key}'.`);
      const p = clampPoints(v);
      if (p !== LEVELS[key].points) points[key] = p;   // the default needn't be stored
    }
    const roles = [];
    const seen = new Set();
    for (const r of Array.isArray(value.roles) ? value.roles : []) {
      const text = String(r?.text ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
      if (text.length < 2) throw new Error('A role needs at least two letters.');
      if (text.length > MAX_ROLE_TEXT) throw new Error(`Keep a role under ${MAX_ROLE_TEXT} letters.`);
      if (seen.has(text)) continue;
      seen.add(text);
      roles.push({ text, points: clampPoints(r.points) });
    }
    if (roles.length > MAX_ROLES) throw new Error(`Up to ${MAX_ROLES} roles.`);
    return { points, roles };
  },
};

/** The same ranking always gives the same text, so the stored scores can say which they were made with. */
export function rankingFingerprint(r = NO_RANKING) {
  const points = Object.keys(r.points || {}).sort().map((k) => `${k}=${r.points[k]}`).join(',');
  const roles = (r.roles || []).map((x) => `${x.text}=${x.points}`).sort().join(',');
  return points || roles ? `${points}|${roles}` : 'none';
}

export const isDefaultRanking = (r) => rankingFingerprint(r) === 'none';

/** Starting points for the common reasons to change it. Each replaces the whole ranking; you can adjust from there. */
export const RANKING_PRESETS = [
  { key: 'default', label: 'As the app ranks them', ranking: NO_RANKING, note: 'C-suite and founders first, then VPs, directors, managers.' },
  {
    key: 'founders', label: 'Founders first',
    note: 'Owners and entrepreneurs count like CEOs, and anyone who says founder counts as much: for meeting founders, or selling to them.',
    ranking: { points: { owner: 10 }, roles: [{ text: 'founder', points: 10 }, { text: 'co-founder', points: 10 }] },
  },
  {
    key: 'investors', label: 'Investors',
    note: 'Anyone who invests for a living rises to the top: for raising money.',
    ranking: { points: {}, roles: ['investor', 'venture', 'angel', 'general partner', 'managing partner', 'principal at', 'vc'].map((text) => ({ text, points: 10 })) },
  },
  {
    key: 'role', label: 'A role I’m looking for',
    note: 'For outbound or hiring: add the role below, and everyone in it rises, whatever their level.',
    ranking: null,   // keeps what you have and opens the role box
  },
];

export { titleHas } from './scoring.js';
