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
 * Node and Next never exit with 76 themselves. (Not 75: that is the number the
 * data-import work proposed for "restart the server".)
 */
export const UPDATE_HANDOFF_EXIT_CODE = 76;

/** Where releases come from: GitHub's API, and GitHub's release downloads. */
export const GITHUB = Object.freeze({ apiBase: 'https://api.github.com', downloadBase: 'https://github.com' });

/**
 * Where to read releases and download them from. Always GitHub, except in a
 * test: SIX_DEGREES_TEST_RELEASES=http://127.0.0.1:<port> points both at a
 * fixture server on this computer (the browser check, and a CI step that
 * updates one build to the next). Nothing in the app sets it, and only a
 * loopback address is honoured, so it can never send an update to another
 * machine; anything else is ignored and GitHub is used.
 */
export function releaseSource(env = {}) {
  const raw = env?.SIX_DEGREES_TEST_RELEASES;
  if (!raw) return { ...GITHUB, test: false };
  let url = null;
  try { url = new URL(String(raw)); } catch { /* ignored below */ }
  const loopback = url && url.protocol === 'http:' && ['127.0.0.1', '[::1]'].includes(url.hostname)
    && url.port !== '' && url.pathname === '/' && !url.search && !url.hash && !url.username && !url.password;
  if (!loopback) return { ...GITHUB, test: false };
  return { apiBase: url.origin, downloadBase: url.origin, test: true };
}

/** How long the last update's outcome stays on the Settings page. */
export const REPORT_DAYS = 7;

/** No release of this app is anywhere near this size (about 190 MB in 2026). */
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
 * can't, in words for the Settings page. Then the Terminal line is offered
 * instead, which works in every one of these cases.
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
      message: 'Six Degrees was installed by another user of this Mac, so it can\'t replace itself for you.',
    };
  }
  return null;
}

/**
 * The data folder must not be inside the app. It can be: a relative --data-dir
 * resolves against the server's working folder, which is inside the bundle.
 * Replacing the app would then carry the network away with the old version.
 */
export function dataRefusal({ dataDir, bundle }) {
  if (!dataDir || !bundle) return null;
  const dir = path.resolve(dataDir);
  if (dir === bundle || dir.startsWith(`${bundle}/`)) {
    return {
      code: 'data-inside-app',
      message: 'Your network is stored inside the app itself, so replacing the app would take it away. Move the data folder out of the app first.',
    };
  }
  return null;
}

/** Where the new version waits beside the running one: same folder, so moving it in is a rename. */
export function stagingPath(bundle) {
  return path.join(path.dirname(bundle), `.${path.basename(bundle)}.incoming`);
}

/**
 * What the new version is opened with. `open` starts an app with neither this
 * process's environment nor its arguments, so a copy started with its own data
 * folder (--data-dir) is told it again, or it would open an empty network in
 * the default one. --after-update opens Settings, where the outcome is shown.
 */
export function relaunchArgs({ dataDir, defaultDataDir } = {}) {
  const args = ['--after-update'];
  const dir = dataDir ? path.resolve(dataDir) : null;
  if (dir && (!defaultDataDir || dir !== path.resolve(defaultDataDir))) args.push('--data-dir', dir);
  return args;
}

/**
 * The helper's command line (scripts/apply-update.sh documents each one).
 * Everything after "--" is handed to the new app when it is opened.
 */
export function helperArgs({
  target, staged, keepDir, statusFile, from, to, pids = [], waitSeconds = 30, logFile, work, relaunch = [],
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
  if (logFile) args.push('--log', logFile);
  if (work) args.push('--work', work);
  return [...args, '--', ...relaunch];
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
 * previous, log). null when there is nothing to say: no update, or one more
 * than REPORT_DAYS ago. `previous` is where the old version went: a zip of it
 * after an update that worked, the old app itself when it couldn't be put back.
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
  const running = (v) => runningVersion && compareVersions(runningVersion, v) === 0;

  switch (status.outcome) {
    case 'installed':
      if (running(to)) return { ...base, tone: 'ok', text: `Updated to ${to}.` };
      return {
        ...base,
        tone: 'bad',
        text: `Version ${to} was installed, but this copy is ${runningVersion}. If you have two copies of Six Degrees, open the one in Applications.`,
      };
    case 'started':
      // The server hands over and the helper takes it from there. If the helper
      // never wrote its answer, the version that is running says how it went.
      if (running(to)) return { ...base, tone: 'ok', text: `Updated to ${to}.` };
      return {
        ...base,
        tone: 'bad',
        text: `The update to ${to} didn't finish, and it didn't say why.${status.log ? ` Its log is ${status.log}.` : ''}`,
      };
    case 'not-applied':
      return { ...base, tone: 'bad', text: `The update to ${to} didn't finish${reason ? `: ${reason}` : ''}. Nothing was changed.` };
    case 'rolled-back':
      return {
        ...base,
        tone: 'bad',
        text: `The update to ${to} didn't finish${reason ? `: ${reason}` : ''}. Your previous version was put back.`,
      };
    case 'failed':
      // The one outcome that needs a hand: the old version was moved aside and
      // couldn't be moved back. It is whole, just renamed.
      return {
        ...base,
        tone: 'bad',
        text: `The update to ${to} didn't finish${reason ? `: ${reason}` : ''}.${status.previous
          ? ` Your previous version is at ${status.previous}. Rename it to ${APP_BUNDLE_NAME} to use it again, or install the newest version with the line below.`
          : ''}`,
      };
    default:
      return null;
  }
}
