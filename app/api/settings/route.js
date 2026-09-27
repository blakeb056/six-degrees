import path from 'node:path';
import { homedir } from 'node:os';
import { getDb } from '../../../lib/db-client';
import { readSettings, writeSettings, SettingsError } from '../../../lib/settings';
import { afterSettingsChange } from '../../../lib/settings-effects';
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
  let before, settings;
  try {
    before = readSettings(getDb());
    settings = writeSettings(getDb(), body?.settings);
  } catch (err) {
    return Response.json({ error: err.message }, { status: err instanceof SettingsError ? 400 : 500 });
  }
  // What the change sets in motion (lib/settings-effects.js): a new sector
  // focus rescores everyone. The save has landed either way, so a failure
  // here is reported with the saved settings (and whatever work did finish)
  // rather than hidden.
  try {
    const effects = afterSettingsChange(getDb(), before, settings);
    return Response.json(effects ? { settings, effects } : { settings });
  } catch (err) {
    return Response.json({ settings, ...(err.effects ? { effects: err.effects } : {}), error: err.message }, { status: 500 });
  }
}
