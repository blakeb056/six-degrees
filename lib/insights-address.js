// Where Insights lives: in your Profile, behind the ✦ Insights button that was
// already there, not a tab of its own (Blake, 2026-10-04: "insights that should
// be in the profile where the button already is as that makes more sense and
// not to add a tab"). Its boards sit in Profile's notch after Profile · ✦ Insights:
//
//   /profile?view=insights&board=<board>
//
// The old addresses still land: /insights and /insights?view=<board> (the
// Insights tab, 0.8.0 to 1.0.0), and /profile?view=insights with no board.
// No imports, so the pages and tests/insights-address.test.mjs share it.

/** The boards, in the notch's order. Health is the network health Profile → Insights showed before. */
export const BOARDS = Object.freeze(['people', 'kingmakers', 'gatekeepers', 'companies', 'industries', 'report', 'health']);
export const BOARD_LABELS = Object.freeze({
  people: 'People', kingmakers: 'Kingmakers', gatekeepers: 'Gatekeepers', companies: 'Companies',
  industries: 'Industries', report: 'Report', health: 'Health',
});
export const DEFAULT_BOARD = 'people';

/** A board's key, or the default for anything else (an old link, a typo, nothing). */
export const boardOf = (asked) => (BOARDS.includes(asked) ? asked : DEFAULT_BOARD);

/** The address of a board. */
export const insightsHref = (board) => `/profile?view=insights&board=${boardOf(board)}`;

/** Where an old /insights address goes, from its query string: ?view= named the board. */
export function movedInsights(search = '') {
  const params = new URLSearchParams(search);
  return insightsHref(params.get('view'));
}
