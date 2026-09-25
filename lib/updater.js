// One-click updates for the Mac app: the decisions, with no side effects.
//
// The work happens in two places. lib/updater-job.js downloads the new version,
// checks it and puts a copy beside the running app, all while the old version
// keeps working. scripts/apply-update.sh then waits for the app to quit, swaps
// the two, and opens the new one. Everything that decides something lives here,
// so tests/updater.test.mjs can check each decision without a network, a disk
// image or a Mac.
//
// Nothing here runs on its own. Checking is a click, and installing is a second
// click (spec invariant 2).

import path from 'node:path';
import { compareVersions } from './release.js';

/** The Mac app's bundle identifier (scripts/build-app.mjs). A download that says otherwise isn't used. */
export const BUNDLE_ID = 'com.blakeburford.sixdegrees';

/** What the disk image holds, and what the running copy is normally called. */
export const APP_BUNDLE_NAME = 'Six Degrees.app';

/** The checksum file every release carries (.github/workflows/release.yml). */
export const SUMS_NAME = 'SHA256SUMS';

/**
 * The exit code the server ends with once the update helper has started. The
 * Mac app reads it as "quit quietly": a crash's exit code shows the "Six
 * Degrees stopped" error, and a SIGTERM to itself isn't used because Next
 * catches it and exits with 143 (TRAPS §39), which says "stopped from outside",
 * not "an update follows". desktop/lib.mjs has the same number, since the shell
 * can't import from lib/; tests/updater.test.mjs checks that the two agree.
 * Node and Next never exit with 76 themselves. (Not 75: that is
 * RESTART_EXIT_CODE in desktop/lib.mjs, "start the server again", which the
 * data import uses.)
 */
export const UPDATE_HANDOFF_EXIT_CODE = 76;

/** Where releases come from: GitHub's API, and GitHub's release downloads. */
export const GITHUB = Object.freeze({ apiBase: 'https://api.github.com', downloadBase: 'https://github.com' });

/**
 * Where to read releases and download them from. Always GitHub, except in a
 * test: SIX_DEGREES_TEST_RELEASES=http://127.0.0.1:<port> points both at a
 * fixture server on this computer (the browser check, and a CI step that
 * updates one build to the next). Nothing in the app sets it, and only
 * 127.0.0.1 is honoured (the fixture server listens there and nowhere else),
 * so it can never send an update to another machine; anything else is ignored
 * and GitHub is used.
 */
export function releaseSource(env = {}) {
  const raw = env?.SIX_DEGREES_TEST_RELEASES;
  if (!raw) return { ...GITHUB, test: false };
  let url = null;
  try { url = new URL(String(raw)); } catch { /* ignored below */ }
  const loopback = url && url.protocol === 'http:' && url.hostname === '127.0.0.1'
    && url.port !== '' && url.pathname === '/' && !url.search && !url.hash && !url.username && !url.password;
  if (!loopback) return { ...GITHUB, test: false };
  return { apiBase: url.origin, downloadBase: url.origin, test: true };
}

/** How long the last update's outcome stays on the Settings page. */
export const REPORT_DAYS = 7;

/** No release of this app is anywhere near this size (about 220 MB since the scanner's Python went inside, 0.3.1). */
export const MAX_DMG_BYTES = 1024 * 1024 * 1024;

const refuse = (code, message) => ({ refusal: { code, message } });

/**
 * Which build this Mac needs: 'arm64' (Apple Silicon) or 'x64' (Intel).
 *
 * Asked the way install.sh asks. `hw.optional.arm64` is the hardware: it says 1
 * on Apple Silicon even when this process runs under Rosetta and calls itself
 * x64 (TRAPS §30), which is why neither process.arch nor `uname -m` decides.
 * The one thing process.arch can add: a process that *is* arm64 can only be
 * on Apple Silicon, so it covers a sysctl that failed to answer. It can never
 * turn an Apple Silicon Mac into an Intel one.
 */
export function chipOf({ sysctlArm64, processArch } = {}) {
  if (String(sysctlArm64 ?? '').trim() === '1') return 'arm64';
  if (processArch === 'arm64') return 'arm64';
  return 'x64';
}

export const CHIP_LABEL = { arm64: 'Apple Silicon', x64: 'Intel' };

/** The disk image's exact file name, as scripts/build-app.mjs names it. */
export function dmgName(version, chip) {
  return `Six-Degrees-${version}-${chip}.dmg`;
}

/**
 * From GitHub's answer to releases/latest, exactly what to download, or why
 * not. Returns { plan } or { refusal: { code, message } }.
 *
 * Every name and address is worked out here from the release and this Mac;
 * nothing comes from the page. The download must be this repository's own
 * release asset, by its exact name: install.sh's "first file ending in
 * -arm64.dmg" would also have taken a fixed-name copy or anything else added
 * to a release later.
 */
export function planFromRelease(release, { currentVersion, chip, slug, downloadBase = GITHUB.downloadBase }) {
  if (!release || typeof release !== 'object' || !release.tag_name) {
    return refuse('no-release', 'GitHub did not describe a release.');
  }
  const tag = String(release.tag_name);
  const version = tag.replace(/^v/i, '');
  // releases/latest never returns a pre-release, and a tag with a hyphen is one
  // (release.yml). Checked here as well, so a beta can't be installed by accident
  // whatever GitHub answers (DESKTOP.md rule 4).
  if (release.draft || release.prerelease || version.includes('-')) {
    return refuse('prerelease', `Version ${version} is a test version, so it isn't installed from here.`);
  }
  if (!/^\d+(\.\d+){1,3}$/.test(version)) {
    return refuse('bad-version', `GitHub's newest release has a version this app doesn't understand (${tag}).`);
  }
  if (compareVersions(version, currentVersion) <= 0) {
    return refuse('not-newer', `You already have ${currentVersion}, and the newest version is ${version}.`);
  }

  const assets = Array.isArray(release.assets) ? release.assets : [];
  const find = (name) => assets.find((a) => a && a.name === name) || null;
  const dmg = find(dmgName(version, chip));
  if (!dmg) {
    return refuse('no-download', `Version ${version} has no download for this Mac (${CHIP_LABEL[chip] || chip}).`);
  }
  const sums = find(SUMS_NAME);
  if (!sums) {
    return refuse('no-checksums', `Version ${version} was published without its checksum file (${SUMS_NAME}), so its download can't be checked.`);
  }
  const base = `${downloadBase}/${slug}/releases/download/${encodeURIComponent(tag)}/`;
  for (const asset of [dmg, sums]) {
    if (asset.browser_download_url !== base + encodeURIComponent(asset.name)) {
      return refuse('unexpected-address', `GitHub listed ${asset.name} at an unexpected address, so it wasn't downloaded.`);
    }
  }
  const size = Number(dmg.size) > 0 ? Number(dmg.size) : null;
  if (size && size > MAX_DMG_BYTES) {
    return refuse('too-large', `The download for version ${version} is unexpectedly large, so it wasn't downloaded.`);
  }
  return {
    plan: {
      version,
      tag,
      notes: typeof release.html_url === 'string' ? release.html_url : null,
      dmg: { name: dmg.name, url: dmg.browser_download_url, size },
      sums: { name: sums.name, url: sums.browser_download_url },
    },
  };
}

/**
 * SHA256SUMS as release.yml writes it (`sha256sum *.dmg`): "<64 hex>  <name>",
 * or " *<name>" in binary mode. Returns Map name → lowercase hex. A name listed
 * twice with different sums is ambiguous and maps to null, which is treated as
 * missing: better to refuse than to guess which line is right.
 */
export function parseSha256Sums(text) {
  const sums = new Map();
  for (const raw of String(text || '').split('\n')) {
    const line = raw.replace(/\r$/, '');
    const m = line.match(/^([0-9a-fA-F]{64}) [ *](.+)$/);
    if (!m) continue;
    const [, hex, name] = m;
    const sum = hex.toLowerCase();
    if (sums.has(name) && sums.get(name) !== sum) sums.set(name, null);
    else sums.set(name, sum);
  }
  return sums;
}

/** Do two SHA-256 digests (hex) name the same bytes? */
export function digestsMatch(expected, actual) {
  const a = String(expected || '').toLowerCase();
  const b = String(actual || '').toLowerCase();
  return /^[0-9a-f]{64}$/.test(a) && a === b;
}

/**
 * The running app bundle. The Mac app says where it is (SIX_DEGREES_APP, from
 * Electron's own executable path, desktop/main.mjs). A copy that doesn't say is
 * worked out from its server folder: <bundle>/Contents/Resources/server for the
 * Electron app, …/Resources/app for the classic launcher.
 */
export function runningBundle({ app, root } = {}) {
  const absolute = (p) => (typeof p === 'string' && path.isAbsolute(p) ? path.resolve(p) : null);
  const declared = absolute(app);
  if (declared) return declared;
  const r = absolute(root);
  const m = r && r.match(/^(.+\.app)\/Contents\/Resources\/(?:server|app)$/);
  return m ? m[1] : null;
}

/**
 * Can this copy replace itself where it is? null when it can, or the reason it
 * can't, in words for the Settings page. The page then offers the Terminal
 * line, saying what it would do here (terminalFallback), or says what to do
 * where the line wouldn't help.
 */
export function bundleRefusal(bundle, { exists = true, parentWritable = true, ownerUid, uid } = {}) {
  if (!bundle || !exists) {
    return { code: 'unknown-location', message: "This copy can't tell where it is installed, so it can't replace itself." };
  }
  if (!/\.app$/.test(bundle)) {
    return { code: 'not-app', message: "This copy isn't running from an app in a folder, so it can't replace itself." };
  }
  if (bundle.startsWith('/Volumes/')) {
    return {
      code: 'disk-image',
      message: 'Six Degrees is running from its disk image (or another drive). Drag it to your Applications folder, open it from there, then update.',
    };
  }
  if (bundle.includes('/AppTranslocation/')) {
    return {
      code: 'translocated',
      message: "macOS is running this copy from a temporary, read-only place, because it was opened where it was downloaded. Move Six Degrees to your Applications folder, open it from there, then update.",
    };
  }
  if (!parentWritable) {
    return {
      code: 'not-writable',
      message: `Your user can't change ${path.dirname(bundle)}, so Six Degrees can't replace itself there.`,
    };
  }
  if (Number.isInteger(ownerUid) && Number.isInteger(uid) && ownerUid !== uid) {
    return {
      code: 'not-owner',
      message: 'Six Degrees was installed by another user of this Mac, so only they can replace it. Ask them to update it (Settings → Updates, in their account).',
    };
  }
  return null;
}

/**
 * The data this copy uses must be data a reopened copy will use too.
 *
 * The data folder must not be inside the app. It can be: a relative --data-dir
 * resolved against the server's working folder, which is inside the bundle.
 * Replacing the app would then carry the network away with the old version,
 * and the Terminal line (install.sh deletes the old app) would delete it, so
 * neither is offered: the network has to be moved out first.
 *
 * And SIX_DEGREES_DB, which puts the database somewhere of its own, can't be
 * passed on: `open` starts the new version with no environment, and it has no
 * option for it. It would open another database.
 */
export function dataRefusal({ dataDir, bundle, dbFile = null }) {
  if (dataDir && bundle) {
    const dir = path.resolve(dataDir);
    if (dir === bundle || dir.startsWith(`${bundle}/`)) {
      return {
        code: 'data-inside-app',
        message: `Your network is stored inside the app itself (${dir}), so replacing the app would delete it, whether from here or with the Terminal line. Quit Six Degrees, move that folder out of the app (to your home folder, say), open Six Degrees again with --data-dir and the folder's new place, then update.`,
      };
    }
  }
  if (dbFile && dataDir && path.resolve(dbFile) !== path.join(path.resolve(dataDir), 'six-degrees.sqlite')) {
    return {
      code: 'database-elsewhere',
      message: `This copy was started with its database outside its data folder (SIX_DEGREES_DB), which a reopened app can't be told, so it won't replace itself. Replace it by hand and start it again the same way.`,
    };
  }
  return null;
}

/** Where install.sh (the Terminal line) puts the app: /Applications, or ~/Applications when this user can't change /Applications. */
export function installerTarget({ applicationsWritable = true, home = '' } = {}) {
  return applicationsWritable
    ? path.join('/Applications', APP_BUNDLE_NAME)
    : path.join(home, 'Applications', APP_BUNDLE_NAME);
}

/**
 * What the Terminal line (install.sh) would do for this copy, so the page can
 * say it accurately, or null when it mustn't be offered at all:
 *   { mode: 'replace' }                it stops this copy, puts the new version
 *                                      in its place and opens it
 *   { mode: 'elsewhere', installsTo }  it installs at installsTo and leaves this
 *                                      copy alone. So quit this one first:
 *                                      otherwise the new one finds it running,
 *                                      hands over to it and closes (one copy at a
 *                                      time, desktop/main.mjs)
 *   null                               the line would delete a network kept inside
 *                                      the app, can't delete another user's app,
 *                                      or can't carry a database kept elsewhere
 * `dataDir`, when this copy uses a data folder of its own: install.sh opens the
 * new version without it, on the usual one.
 */
export function terminalFallback({ bundle, refusalCode = null, installsTo, dataDir = null }) {
  if (refusalCode === 'data-inside-app' || refusalCode === 'database-elsewhere') return null;
  if (refusalCode === 'not-owner' && bundle === installsTo) return null;
  const own = dataDir ? { dataDir } : {};
  if (bundle && bundle === installsTo) return { mode: 'replace', ...own };
  return { mode: 'elsewhere', installsTo, ...own };
}

/** Where the new version waits beside the running one: same folder, so moving it in is a rename. */
export function stagingPath(bundle) {
  return path.join(path.dirname(bundle), `.${path.basename(bundle)}.incoming`);
}

/**
 * What the new version is opened with. `open` starts an app with neither this
 * process's environment nor its arguments, so the data folder this copy uses
 * is always passed on as --data-dir, the default one too. A copy started with
 * --data-dir, or with SIX_DEGREES_HOME (a shell, or launchctl setenv), comes
 * back on the same data, never on whatever a plain launch would choose.
 * --after-update opens Settings, where the outcome is shown.
 */
export function relaunchArgs({ dataDir } = {}) {
  const args = ['--after-update'];
  if (dataDir) args.push('--data-dir', path.resolve(dataDir));
  return args;
}

/**
 * The helper's command line (scripts/apply-update.sh documents each one).
 * Everything after "--" is handed to the new app when it is opened.
 */
export function helperArgs({
  target, staged, keepDir, statusFile, from, to, pids = [], waitSeconds = 30, logFile, work, relaunch = [],
  confirmFile, confirmWaitSeconds = 600,
}) {
  const args = [
    '--target', target,
    '--staged', staged,
    '--keep', keepDir,
    '--status', statusFile,
    '--from', from,
    '--to', to,
    '--wait', String(waitSeconds),
  ];
  for (const pid of pids) {
    // 1 is launchd: a server whose app has already gone is re-parented to it.
    if (Number.isInteger(pid) && pid > 1) args.push('--pid', String(pid));
  }
  if (confirmFile) args.push('--confirm', confirmFile, '--confirm-wait', String(confirmWaitSeconds));
  if (logFile) args.push('--log', logFile);
  if (work) args.push('--work', work);
  return [...args, '--', ...relaunch];
}

/**
 * Other users' processes running this app, from `ps -axo uid=,pid=,comm=`
 * (comm is the program as it was started: the full path, for an app). This
 * user can't stop them, and the helper can't even see them (lsof shows only
 * this user's processes), so an app another user has open must not be swapped
 * from under them. Their pids; `bundles` is the app's path, and its real path
 * when a link leads to it.
 */
export function foreignAppProcesses(psText, { bundles = [], uid }) {
  const insides = bundles.filter(Boolean).map((b) => `${b}/Contents/`);
  if (!insides.length || !Number.isInteger(uid)) return [];
  const found = [];
  for (const line of String(psText || '').split('\n')) {
    const m = line.match(/^\s*(\d+)\s+(\d+)\s+(.+)$/);
    if (!m || Number(m[1]) === uid) continue;
    if (insides.some((inside) => m[3].startsWith(inside))) found.push(Number(m[2]));
  }
  return found;
}

/**
 * What an update that was cut off (the server or the helper stopped half-way)
 * can leave beside the app, by name: the old version moved aside
 * (.<app>.previous-<pid>[-n]), a new version taken out again
 * (.<app>.failed-<pid>[-n]) and the staged copy (.<app>.incoming). Only this
 * app's own names, never anything else in the folder. `pid` is the helper's,
 * to tell whether it still runs.
 */
export function leftoversBeside(names, bundleBase) {
  const prefix = `.${bundleBase}.`;
  const found = [];
  for (const name of names) {
    if (typeof name !== 'string' || !name.startsWith(prefix)) continue;
    const rest = name.slice(prefix.length);
    if (rest === 'incoming') {
      found.push({ name, kind: 'incoming', pid: null });
      continue;
    }
    const m = rest.match(/^(previous|failed)-(\d+)(?:-\d+)?$/);
    if (m) found.push({ name, kind: m[1], pid: Number(m[2]) });
  }
  return found;
}

/** Is this macOS version at least `need`? */
export function versionAtLeast(have, need) {
  return compareVersions(have, need) >= 0;
}

const CPU = { 0x01000007: 'x64', 0x0100000c: 'arm64' };

/**
 * Which chips a Mach-O executable runs on, from its first bytes: 'arm64',
 * 'x64', both (a universal binary) or neither (not a Mach-O, e.g. the classic
 * app's bash launcher). Read here rather than with `lipo`, which on a Mac
 * without the developer tools is a stub that asks to install them.
 */
export function machoArchs(buf) {
  const found = new Set();
  if (!buf || buf.length < 8) return found;
  const add = (cputype) => { if (CPU[cputype >>> 0]) found.add(CPU[cputype >>> 0]); };
  const le = buf.readUInt32LE(0);
  if (le === 0xfeedfacf || le === 0xfeedface) {   // a thin binary, stored little-endian
    add(buf.readUInt32LE(4));
    return found;
  }
  const be = buf.readUInt32BE(0);
  if (be === 0xcafebabe || be === 0xcafebabf) {   // universal: a big-endian table of slices
    const count = buf.readUInt32BE(4);
    const size = be === 0xcafebabf ? 32 : 20;
    // A Java class file starts with the same four bytes; its "count" is a
    // version number in the dozens. No universal binary has that many slices.
    if (count < 1 || count > 16) return found;
    for (let i = 0; i < count; i++) {
      const at = 8 + i * size;
      if (at + 4 > buf.length) break;
      add(buf.readUInt32BE(at));
    }
  }
  return found;
}

/**
 * What to say about the last update, on the next launch. `status` is the file
 * the server and scripts/apply-update.sh write (outcome, from, to, at, reason,
 * previous, log). null when there is nothing to say: no update, one more than
 * REPORT_DAYS ago, or one this copy has moved past. `previous` is where the old
 * version went: a zip of it after an update that worked, the old app itself
 * when it couldn't be put back.
 *
 * The running version decides as much as the outcome does. A copy already at
 * the version a failed update was for got there another way (the Terminal line,
 * most likely), and a copy past the version an update installed was updated
 * again since: either report would be old news, and wrong.
 */
export function lastUpdateReport(status, { runningVersion, now = Date.now(), maxAgeDays = REPORT_DAYS } = {}) {
  if (!status || typeof status !== 'object' || typeof status.to !== 'string') return null;
  const at = Date.parse(status.at);
  if (!Number.isFinite(at) || now - at > maxAgeDays * 86400000) return null;
  const to = status.to;
  const reason = typeof status.reason === 'string' && status.reason.trim() ? status.reason.trim().replace(/\.$/, '') : null;
  const base = {
    at: new Date(at).toISOString(),
    from: status.from || null,
    to,
    previous: typeof status.previous === 'string' ? status.previous : null,
  };
  // This copy against the version the update was for: <0 older, 0 the same, >0 newer.
  const cmp = runningVersion ? compareVersions(runningVersion, to) : null;
  const didnt = `The update to ${to} didn't finish${reason ? `: ${reason}` : ''}.`;

  switch (status.outcome) {
    case 'installed':
    case 'started':
      // "started": the server handed over and the helper never wrote its answer.
      // The version that is running says how it went.
      if (cmp === 0) return { ...base, tone: 'ok', text: `Updated to ${to}.` };
      if (cmp > 0) return null;
      if (status.outcome === 'installed') {
        return {
          ...base,
          tone: 'bad',
          text: `Version ${to} was installed, but this copy is ${runningVersion}. If you have two copies of Six Degrees, open the one in Applications.`,
        };
      }
      return {
        ...base,
        tone: 'bad',
        text: `The update to ${to} didn't finish, and it didn't say why.${status.log ? ` Its log is ${status.log}.` : ''}`,
      };
    case 'not-applied':
      if (cmp !== null && cmp >= 0) return null;
      return { ...base, tone: 'bad', text: `${didnt} Nothing was changed.` };
    case 'rolled-back':
      if (cmp !== null && cmp >= 0) return null;
      return { ...base, tone: 'bad', text: `${didnt} Your previous version was put back.` };
    case 'failed':
      // The one outcome that needs a hand: the old version was moved aside and
      // couldn't be moved back. It is whole, just renamed, and the name starts
      // with a dot, which Finder hides.
      if (cmp !== null && cmp >= 0) return null;
      return {
        ...base,
        tone: 'bad',
        text: `${didnt}${status.previous
          ? ` Your previous version is safe, in a hidden folder: ${status.previous}. To use it again, rename it to ${APP_BUNDLE_NAME} (in Finder, Shift-Command-. shows hidden files). Or install the newest version: Check for updates, below.`
          : ''}`,
      };
    default:
      return null;
  }
}
