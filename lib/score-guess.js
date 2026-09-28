// Whether someone's power score is a guess, and why (Blake, 2026-09-28: "suggest
// scanning their cluster if their profile card is opened"). A score rests on
// a title and a company; when the headline gives the app neither to read, the
// score is the middle of the scale, not a judgment. The card says so and
// offers what would firm it up: their circle, which the bridge boost reads
// (lib/scoring.js bridgeBoost, up to +2).

import { scorePerson, companyScore } from './scoring.js';

// A company score someone set: yours (Paths → Scores) or the sample network's.
// score_why says so ("Northwind (7/10, your score)"); a sector lean on a
// company the app doesn't know ("6/10: 5 + 1 your sector") is still a guess.
const SET_BY_HAND = /\/10, (your|sample) score\)/;
// A stored working: "Director / Head (7.5) · Northwind Labs (6/10)", with
// "Former " or "Student · " before the title, and the company's score as
// "(7/10, your score)" or "(6/10: 5 + 1 your sector: Dental)".
const WHY = /^(?:Former )?(?:Student · )?(.+?) \([\d.]+\) · (no company found|.+?) \(\d+(?:\.\d+)?\/10(?:[:,][^)]*)?\)/;

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
  // The role the stored score was built on, from its working (score_why, which
  // lib/scoring.js explainScore writes): scoring again here would use none of
  // the network's headcounts, your company scores or your sector, and could
  // pick a different role of someone with several.
  const m = String(row.score_why || '').match(WHY);
  let label, name, company;
  if (m) {
    label = m[1];
    name = m[2] === 'no company found' ? null : m[2];
    company = !name || (!SET_BY_HAND.test(row.score_why) && !['known', 'data'].includes(companyScore(name).source));
  } else {
    const s = scorePerson(row);
    label = s.title.label;
    name = s.company || null;
    company = ['none', 'default', 'network'].includes(s.companySource);
  }
  const audience = label.startsWith('Audience of');
  const title = label === 'Title unclear' || label.includes('Works there');
  if (audience) company = false;
  if (!title && !company) return null;
  let reason;
  if (title && company) reason = name ? `Their headline doesn’t say their title, and the app doesn’t know ${name}.` : 'Their headline names no title or company the app can read.';
  else if (title) reason = 'Their headline doesn’t say their title.';
  else reason = name ? `The app doesn’t know ${name}, so it counts as the middle of the scale.` : 'The app couldn’t find where they work.';
  return { title, company, never: false, companyName: name, reason };
}
