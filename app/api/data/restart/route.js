import { after } from 'next/server';
import { dataDir } from '../../../../lib/db-client';
import { pendingImport, restartCodeFrom } from '../../../../lib/data-import';
import { scanIsRunning } from '../../../../lib/scan-state';

// Restart the server so a staged import finishes. Only the Mac app can do this:
// its shell (desktop/main.mjs) tells the server which exit code means "start
// me again", and does. Anywhere else the server is the Terminal's own process,
// and ending it would just stop the app, so the page says how instead.
//
// Gated (lib/gate.js): it stops the server.

export async function POST() {
  const code = restartCodeFrom(process.env);
  if (!code) {
    return Response.json(
      { error: "This copy can't restart itself. Stop it and start it again to finish the import." },
      { status: 409 },
    );
  }
  if (!pendingImport(dataDir())) {
    return Response.json({ error: 'No import is waiting, so there is nothing to restart for.' }, { status: 409 });
  }
  // The scanner runs in its own process group and would outlive the server.
  if (scanIsRunning()) {
    return Response.json({ error: 'A scan is running. Stop it on the Scan page first, then restart.' }, { status: 409 });
  }
  // After the answer has gone, so the page learns it worked. process.exit and
  // not a signal: Next turns SIGTERM into exit code 143, which the shell would
  // report as a crash.
  after(() => {
    setTimeout(() => process.exit(code), 150);
  });
  return Response.json({ ok: true, restarting: true });
}
