// Next.js calls register() once, when the server starts.
//
// The one thing started here is the daily update check (lib/update-check.js):
// once a day it asks GitHub for the newest release's version number and, when
// there's a newer one, leaves a notification. Settings → Updates turns it off.
// It decides for itself when not to run: a git checkout, a test, or
// SIX_DEGREES_NO_UPDATE_CHECK=1.
//
// Only in the Node.js runtime: the check reads the database, which the edge
// runtime (the middleware's) has no way to open. Loaded only there, so the
// edge build never sees it.

export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;
  const { startUpdateChecks } = await import('./lib/update-check.js');
  startUpdateChecks();
}
