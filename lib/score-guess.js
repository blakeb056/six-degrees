// Whether someone's power score is a guess, and why (Blake, 2026-09-28: "suggest
// scanning their cluster if their profile card is opened"). A score rests on
// a title and a company; when the headline gives the app neither to read, the
// score is the middle of the scale, not a judgment. The card says so and
// offers what would firm it up: their circle, which the bridge boost reads
// (lib/scoring.js bridgeBoost, up to +2).

import { scorePerson } from './scoring.js';

// A company score someone set: yours (Paths → Scores) or the sample network's.
// score_why says so ("Northwind (7/10, your score)"); a sector lean on a
// company the app doesn't know ("6/10: 5 + 1 your sector") is still a guess.
const SET_BY_HAND = /\/10, (your|sample) score\)/;

/**
 * Why a row's score is a guess, or null when it rests on a title and a
 * company the app can read.
 *   title    the headline names no title the rules read: "Title unclear", or
 *            only a company ("Works there")
 *   company  no company found, or one the built-in lists don't know and
 *            nobody scored
 *   never    never scored
 * An audience of their own ("2.5M followers") is a title, and needs no company.
 * @returns {{ title: boolean, company: boolean, never: boolean, companyName: string|null, reason: string } | null}
 */
export function scoreGuess(row) {
  if (!row) return null;
  if (row.power_score == null || row.power_score === '' || !row.tier) {
    return { title: false, company: false, never: true, companyName: null, reason: 'They haven’t been scored yet.' };
  }
  const s = scorePerson(row);
  const audience = s.title.key.startsWith('audience');
  const title = s.title.key === 'unknown' || s.title.label.includes('Works there');
  const company = !audience && ['none', 'default', 'network'].includes(s.companySource) && !SET_BY_HAND.test(row.score_why || '');
  if (!title && !company) return null;
  const name = s.company || null;
  let reason;
  if (title && company) reason = name ? `Their headline doesn’t say their title, and the app doesn’t know ${name}.` : 'Their headline names no title or company the app can read.';
  else if (title) reason = 'Their headline doesn’t say their title.';
  else reason = name ? `The app doesn’t know ${name}, so it counts as the middle of the scale.` : 'The app couldn’t find where they work.';
  return { title, company, never: false, companyName: name, reason };
}
