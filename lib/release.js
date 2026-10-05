// Facts about the installed copy, for the Updates panel.
//
// A git checkout updates with `git pull` (app/api/update/route.js). Everything
// else was installed — the Mac app (install.sh or the .dmg) or the npm package
// (`npx sixgree@latest`) — and updates by installing the newer release over
// the top. This works out which one this is, and how to tell the two versions
// apart.

/** "git+https://github.com/owner/repo.git" → "owner/repo". */
export function repoSlug(repository) {
  const url = typeof repository === 'string' ? repository : repository?.url || '';
  const m = url.match(/github\.com[/:]([^/]+)\/([^/.#?]+)/);
  return m ? `${m[1]}/${m[2]}` : null;
}

/** Numeric compare of dotted versions. "v0.10.0" > "0.9.3". Pre-release tags are ignored. */
export function compareVersions(a, b) {
  const parts = (v) => String(v || '').replace(/^v/i, '').split(/[-+]/)[0]
    .split('.').map((n) => Number.parseInt(n, 10) || 0);
  const pa = parts(a);
  const pb = parts(b);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d !== 0) return d > 0 ? 1 : -1;
  }
  return 0;
}

/** The desktop apps that update by running the new installer, not by replacing themselves (DESKTOP.md D3). */
export const INSTALLER_KINDS = Object.freeze(['windows-app', 'linux-app']);

/**
 * 'mac-app', 'windows-app', 'linux-app', 'source' (a git checkout run with
 * `npm run start:packaged`) or 'npm'. The launchers say which
 * (SIX_DEGREES_INSTALL); an older Mac app that predates that is recognised by
 * where it is running from, on a Mac only.
 */
export function installKind(env = process.env, root = '', platform = process.platform) {
  if (['mac-app', 'source', 'npm', ...INSTALLER_KINDS].includes(env.SIX_DEGREES_INSTALL)) {
    return env.SIX_DEGREES_INSTALL;
  }
  return platform === 'darwin' && /\.app\/Contents\/Resources/.test(root || '') ? 'mac-app' : 'npm';
}

/** What to run to update, for each way of installing (null: download the installer instead). */
export function updateCommand(kind, slug, { dataDir } = {}) {
  // Windows and Linux: no Terminal line; the release page's installer replaces the app.
  if (INSTALLER_KINDS.includes(kind)) return null;
  if (kind === 'mac-app') {
    return `curl -fsSL https://raw.githubusercontent.com/${slug}/main/install.sh | bash`;
  }
  if (kind === 'source') {
    return 'git pull && npm ci && npm run build && npm run start:packaged';
  }
  // A copy started with --data-dir must be restarted with it, or the new
  // version opens an empty network in the default folder.
  const quoted = dataDir && `'${String(dataDir).replace(/'/g, `'\\''`)}'`;
  return quoted ? `npx sixgree@latest --data-dir ${quoted}` : 'npx sixgree@latest';
}
