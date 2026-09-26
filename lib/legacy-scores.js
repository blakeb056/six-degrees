// The curated company list's scores from before it was made neutral, kept for
// one thing only: the one-time offer on Paths → Scores to keep them as your
// own (lib/legacy-offer.js). Nothing scores with these. lib/scoring.js never
// imports this file, and the model must never read it.
//
// The list used to mix well-known companies with picks from one person's
// career and region (Snap at 9, UCF at 5, a group of 6s from one network),
// and those picks were everyone's defaults. It now follows a written rule
// (lib/scoring.js, docs/brain/SCORING.md). Each row here is an entry that the
// rule removed or rescored, with the score exactly as it was:
//
//   [name, the score it had, the names it is offered for, its industry]
//
// The names and industry are kept because a removed entry no longer
// canonicalises: "University of Central Florida" used to be read as "UCF" and
// is now a name of its own. The names are the entry's own company's, as they
// read once cleaned, and end there ($) unless every company starting so is
// that company's (UCF's colleges, AdventHealth's hospitals, Havas's
// agencies). The old aliases were wider and caught other companies too
// ("Snap-on" and "Specs Optical" read as Snap, "Hard Rock Hotel" as Hard Rock
// Digital): the old list scored those by mistake, and keeping must not give
// them its score. Rows are in the old list's order, since the first to match
// won.

export const LEGACY_SCORES = [
  // Rescored: scored like its peers Pinterest, Reddit and X.
  ['Snap', 9, /^(snap|snapchat)( inc)?$/, 'media'],
  // Removed: private companies that are neither household names nor Fortune
  // 500-sized, and small startups.
  ['Anduril', 9, /^anduril( industries)?$/, 'defense'],
  ['Polymarket', 9, /^polymarket$/, 'finance'],
  ['Kalshi', 9, /^kalshi$/, 'finance'],
  ['Databricks', 8, /^databricks$/, 'tech'],
  ['Figma', 8, /^figma$/, 'tech'],
  ['Scale AI', 8, /^(scale ai|scale\.ai|scale\.com)$/, 'tech'],
  ['Whatnot', 8, /^whatnot$/, 'consumer'],
  // Removed: executive search firms, known to executives rather than to most
  // professionals, and two of the field's five big firms (not its largest).
  ['Egon Zehnder', 8, /^egon zehnder( international)?$/, 'consulting'],
  ['Heidrick & Struggles', 8, /^heidrick( (&|and) struggles)?$/, 'consulting'],
  // Rescored: a household name, but a company of a few hundred people, so the
  // list's floor (7) rather than "major" (8).
  ['MrBeast', 8, /^(mrbeast|beast industries)$/, 'media'],
  // Removed: startups and mid-size companies known inside one field.
  ['Whop', 7, /^whop$/, 'tech'],
  ['Hims & Hers', 7, /^hims( (&|and) hers( health)?)?$/, 'health'],
  ['Riot Games', 7, /^riot games$/, 'entertainment'],
  ['Notion', 7, /^notion( labs)?$/, 'tech'],
  ['Vercel', 7, /^vercel$/, 'tech'],
  ['Plaid', 7, /^plaid$/, 'finance'],
  ['Brex', 7, /^brex$/, 'finance'],
  ['Ramp', 7, /^ramp$/, 'finance'],
  ['Mercury', 7, /^mercury$/, 'finance'],
  ['Chime', 7, /^chime$/, 'finance'],
  // Removed: the only military branch on the list (no Army, Navy, Air Force or
  // Marines), so a regional pick rather than a rule.
  ['U.S. Space Force', 7, /^((u\.?s\.?|united states) )?space force$/, 'defense'],
  // Removed: the "notable" 6s, drawn from one network and one region, and the
  // one "local institution".
  ['Grindr', 6, /^grindr$/, 'tech'],
  ['Genius Sports', 6, /^genius sports( group)?$/, 'entertainment'],
  ['Later', 6, /^later$/, 'media'],
  ['Hard Rock Digital', 6, /^hard rock digital$/, 'entertainment'],
  ['Vanta', 6, /^vanta$/, 'tech'],
  ['Kaseya', 6, /^kaseya$/, 'tech'],
  ['Havas', 6, /^havas\b/, 'media'],
  ['VaynerMedia', 6, /^vayner ?media$/, 'media'],
  ['AdventHealth', 6, /^adventhealth\b/, 'health'],
  ['University of Florida', 6, /^(uf|university of florida)$/, 'education'],
  ['The Athletic', 6, /^the athletic( media( company)?)?$/, 'media'],
  ['UCF', 5, /^(ucf|university of central florida)\b/, 'education'],
];

// Where the offer's state lives in app_meta. lib/rpc.js rescoreAll() sets it
// to 'open' the first time it replaces scores that came from the old list;
// answering sets it to 'kept' or 'declined', and nothing sets it back.
export const LEGACY_OFFER_KEY = 'legacy_scores_offer';
