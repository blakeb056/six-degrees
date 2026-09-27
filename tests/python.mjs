// The Python these tests run scrape.py's pure functions on: python3, or the one
// named in SIX_DEGREES_TEST_PYTHON. CI names the Python inside the built Mac
// app (release.yml), so the scanner's own checks run on what ships
// (DESKTOP.md D2). Not a test file itself: `npm test` runs tests/*.test.mjs.

export const PYTHON = process.env.SIX_DEGREES_TEST_PYTHON || 'python3';

/**
 * True when there is no Python to run, and the test was skipped. A Python that
 * was named must run: skipping then would hide a broken build.
 */
export function noPython(t, result) {
  if (!result.error) return false;
  if (process.env.SIX_DEGREES_TEST_PYTHON) throw result.error;
  t.skip('python3 is not available here');
  return true;
}
