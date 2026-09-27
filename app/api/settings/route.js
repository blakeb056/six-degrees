import path from 'node:path';
import { homedir } from 'node:os';
import { getDb } from '../../../lib/db-client';
import { readSettings, writeSettings, SettingsError } from '../../../lib/settings';
import { dataDir, projectRoot, isGitCheckout } from '../../../lib/paths';
import { installKind } from '../../../lib/release';
import { APP_VERSION } from '../../../lib/app-version';

// The Settings page's data: what the user has chosen, plus plain facts about
// this copy (version, how it was installed, where its data lives). Reading is
// local only; saving is a POST, so the cross-site guard in middleware.js
// applies to it like every other write.

function about() {
  const dir = path.resolve(dataDir());
  return {
    version: APP_VERSION,
    // A git checkout is its own kind here: it updates with git, not a release.
    kind: isGitCheckout() ? 'git' : installKind(process.env, projectRoot()),
    dataDir: dir,
    customDataDir: dir !== path.join(homedir(), '.six-degrees'),
  };
}

export async function GET() {
  try {
    return Response.json({ settings: readSettings(getDb()), about: about() });
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 });
  }
}

export async function POST(request) {
  let body;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: 'Send the settings as JSON.' }, { status: 400 });
  }
  try {
    const settings = writeSettings(getDb(), body?.settings);
    return Response.json({ settings });
  } catch (err) {
    return Response.json({ error: err.message }, { status: err instanceof SettingsError ? 400 : 500 });
  }
}
