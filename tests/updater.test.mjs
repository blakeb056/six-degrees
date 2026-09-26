// The Mac app's one-click update: every decision it makes before it touches
// anything (lib/updater.js). The download, the disk image and the swap are
// tested against a local fixture and pretend apps in updater-job.test.mjs and
// apply-update.test.mjs; this file needs no network, no disk image and no Mac.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import {
  chipOf, dmgName, planFromRelease, parseSha256Sums, digestsMatch, runningBundle, bundleRefusal,
  dataRefusal, stagingPath, relaunchArgs, helperArgs, versionAtLeast, machoArchs, lastUpdateReport,
  releaseSource, installerTarget, terminalFallback, foreignAppProcesses, leftoversBeside,
  UPDATE_HANDOFF_EXIT_CODE, MAX_DMG_BYTES, BUNDLE_ID, SUMS_NAME, GITHUB,
} from '../lib/updater.js';
import { UPDATE_HANDOFF_EXIT_CODE as SHELL_EXIT_CODE, RESTART_EXIT_CODE, serverExitAction } from '../desktop/lib.mjs';
import { isDestructive } from '../lib/gate.js';

const repoFile = (rel) => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8');

const SLUG = 'owner/six-degrees';
const HEX = (c) => c.repeat(64);

// A release as GitHub's releases/latest describes one (only the fields used).
function release(version, { assets, ...over } = {}) {
  const tag = `v${version}`;
  const url = (name) => `https://github.com/${SLUG}/releases/download/${tag}/${name}`;
  const names = assets ?? [
    `Six-Degrees-${version}-arm64.dmg`, `Six-Degrees-${version}-x64.dmg`,
    'Six-Degrees-Mac-Apple-Silicon.dmg', 'Six-Degrees-Mac-Intel.dmg', 'SHA256SUMS',
  ];
  return {
    tag_name: tag,
    html_url: `https://github.com/${SLUG}/releases/tag/${tag}`,
    draft: false,
    prerelease: false,
    assets: names.map((name) => ({ name, browser_download_url: url(name), size: name.endsWith('.dmg') ? 190e6 : 400 })),
    ...over,
  };
}
const plan = (r, over = {}) => planFromRelease(r, { currentVersion: '0.2.1', chip: 'arm64', slug: SLUG, ...over });

test('the shell and the server agree on the exit code that means "quit quietly, an update follows"', () => {
  assert.equal(UPDATE_HANDOFF_EXIT_CODE, SHELL_EXIT_CODE);
  assert.equal(serverExitAction({ code: UPDATE_HANDOFF_EXIT_CODE, signal: null, quitting: false }), 'quit');
  // Next's own codes for a caught SIGTERM/SIGINT, Node's own exit codes (1-14),
  // and 75, the data import's "start the server again", must never collide with it.
  assert.ok(![0, RESTART_EXIT_CODE, 128, 130, 143].includes(UPDATE_HANDOFF_EXIT_CODE) && UPDATE_HANDOFF_EXIT_CODE > 14);
});

test('releases come from GitHub, or in a test only from 127.0.0.1 on this computer', () => {
  assert.deepEqual(releaseSource({}), { ...GITHUB, test: false });
  assert.deepEqual(releaseSource({ SIX_DEGREES_TEST_RELEASES: 'http://127.0.0.1:3303' }),
    { apiBase: 'http://127.0.0.1:3303', downloadBase: 'http://127.0.0.1:3303', test: true });
  // Anything that could reach another machine, or smuggle a path, is ignored: GitHub it is.
  // [::1] too: the docs and the pretend release server say 127.0.0.1, and only that is honoured.
  for (const bad of ['https://evil.example', 'http://192.168.1.5:3303', 'http://localhost:3303', 'http://127.0.0.1',
    'http://[::1]:3303/',
    'http://127.0.0.1:3303/repos', 'http://user:pw@127.0.0.1:3303', 'file:///tmp/x', 'http://127.0.0.1.evil.example:80', 'nonsense']) {
    assert.deepEqual(releaseSource({ SIX_DEGREES_TEST_RELEASES: bad }), { ...GITHUB, test: false }, bad);
  }
});

test('installing is gated like every other /api/update action (loopback bind or ADMIN_TOKEN)', () => {
  assert.equal(isDestructive('/api/update'), true);
});

// The updater's constants describe files other parts of the project make. If
// one side changes, the updater would refuse every real release; catch it here.
test('the bundle id is the one the app is built with', () => {
  const build = repoFile('scripts/build-app.mjs');
  assert.ok(build.includes(`appBundleId: '${BUNDLE_ID}'`), 'the Electron app');
  assert.ok(build.includes(`<key>CFBundleIdentifier</key><string>${BUNDLE_ID}</string>`), 'the classic app');
});

test('the disk image name and SHA256SUMS are what the build and the release publish', () => {
  const build = repoFile('scripts/build-app.mjs');
  assert.ok(build.includes("`${APP_NAME.replace(/ /g, '-')}-${pkg.version}-${ARCH}.dmg`"), 'build-app.mjs names it');
  assert.equal(dmgName('0.2.2', 'arm64'), 'Six Degrees'.replace(/ /g, '-') + '-0.2.2-arm64.dmg');
  const releaseYml = repoFile('.github/workflows/release.yml');
  assert.match(releaseYml, new RegExp(`sha256sum \\*\\.dmg > ${SUMS_NAME}`), 'release.yml writes it');
});

test('the helper ships inside the app, and the app tells the server where it is', () => {
  const build = repoFile('scripts/build-app.mjs');
  assert.match(build, /'scripts\/apply-update\.sh'\]\) \{/, 'copied into the server folder with the scanner files');
  assert.match(build, /export SIX_DEGREES_APP=/, 'the classic launcher says where the app is');
  assert.match(repoFile('desktop/main.mjs'), /SIX_DEGREES_APP: APP_BUNDLE/, 'the Electron app says where it is');
});

test('the chip comes from the hardware: Rosetta can not make an Apple Silicon Mac look like Intel', () => {
  assert.equal(chipOf({ sysctlArm64: '1', processArch: 'x64' }), 'arm64');   // an Intel build under Rosetta
  assert.equal(chipOf({ sysctlArm64: '1\n', processArch: 'arm64' }), 'arm64');
  assert.equal(chipOf({ sysctlArm64: '', processArch: 'arm64' }), 'arm64');  // arm64 code only runs on arm64
  assert.equal(chipOf({ sysctlArm64: '0', processArch: 'x64' }), 'x64');
  assert.equal(chipOf({ sysctlArm64: '', processArch: 'x64' }), 'x64');      // Intel Macs may not know the key
});

test('the download is picked by its exact name for this chip, from this repository', () => {
  const { plan: p, refusal } = plan(release('0.2.2'));
  assert.equal(refusal, undefined);
  assert.equal(p.version, '0.2.2');
  assert.equal(p.dmg.name, 'Six-Degrees-0.2.2-arm64.dmg');
  assert.equal(p.dmg.url, `https://github.com/${SLUG}/releases/download/v0.2.2/Six-Degrees-0.2.2-arm64.dmg`);
  assert.equal(p.dmg.size, 190e6);
  assert.equal(p.sums.name, 'SHA256SUMS');
  assert.equal(plan(release('0.2.2'), { chip: 'x64' }).plan.dmg.name, 'Six-Degrees-0.2.2-x64.dmg');
  assert.equal(dmgName('1.0.0', 'x64'), 'Six-Degrees-1.0.0-x64.dmg');
});

test('the fixed-name copy is never mistaken for the chip build', () => {
  // install.sh takes the first file ending in "-arm64.dmg"; the in-app updater
  // takes only the versioned name, so a release carrying just the fixed-name
  // copies has nothing for it.
  const r = release('0.2.2', { assets: ['Six-Degrees-Mac-Apple-Silicon.dmg', 'SHA256SUMS'] });
  assert.equal(plan(r).refusal.code, 'no-download');
});

test('a release with only the other chip\'s build is refused, not taken', () => {
  const r = release('0.2.2', { assets: ['Six-Degrees-0.2.2-x64.dmg', 'SHA256SUMS'] });
  const { refusal } = plan(r, { chip: 'arm64' });
  assert.equal(refusal.code, 'no-download');
  assert.match(refusal.message, /Apple Silicon/);
});

test('a release without SHA256SUMS is refused: its download could not be checked', () => {
  const r = release('0.2.2', { assets: ['Six-Degrees-0.2.2-arm64.dmg'] });
  const { refusal } = plan(r);
  assert.equal(refusal.code, 'no-checksums');
  assert.match(refusal.message, /can't be checked/);
});

test('the same or an older version is not installed', () => {
  assert.equal(plan(release('0.2.1')).refusal.code, 'not-newer');
  assert.equal(plan(release('0.2.0')).refusal.code, 'not-newer');
  assert.equal(plan(release('0.10.0'), { currentVersion: '0.9.9' }).refusal, undefined, 'numbers, not strings');
});

test('a pre-release is never installed, whatever GitHub answers', () => {
  assert.equal(plan(release('0.3.0', { prerelease: true })).refusal.code, 'prerelease');
  assert.equal(plan(release('0.3.0', { draft: true })).refusal.code, 'prerelease');
  assert.equal(plan({ ...release('0.3.0'), tag_name: 'v0.3.0-beta.1' }).refusal.code, 'prerelease');
});

test('an asset at an address outside this repository\'s releases is refused', () => {
  const r = release('0.2.2');
  r.assets[0].browser_download_url = 'https://example.com/Six-Degrees-0.2.2-arm64.dmg';
  assert.equal(plan(r).refusal.code, 'unexpected-address');
  const other = release('0.2.2');
  other.assets[4].browser_download_url = `https://github.com/someone-else/six-degrees/releases/download/v0.2.2/SHA256SUMS`;
  assert.equal(plan(other).refusal.code, 'unexpected-address');
});

test('nonsense from GitHub is refused plainly', () => {
  assert.equal(plan(null).refusal.code, 'no-release');
  assert.equal(plan({}).refusal.code, 'no-release');
  assert.equal(plan({ ...release('0.2.2'), tag_name: 'latest' }).refusal.code, 'bad-version');
  const huge = release('0.2.2');
  huge.assets[0].size = MAX_DMG_BYTES + 1;
  assert.equal(plan(huge).refusal.code, 'too-large');
});

test('SHA256SUMS is read as sha256sum writes it', () => {
  const sums = parseSha256Sums([
    `${HEX('a')}  Six-Degrees-0.2.2-arm64.dmg`,
    `${HEX('B')} *Six-Degrees-0.2.2-x64.dmg\r`,          // binary-mode marker, Windows line end
    '',
    'not a checksum line',
    `${HEX('c').slice(1)}  short.dmg`,                    // 63 characters: not a SHA-256
  ].join('\n'));
  assert.equal(sums.get('Six-Degrees-0.2.2-arm64.dmg'), HEX('a'));
  assert.equal(sums.get('Six-Degrees-0.2.2-x64.dmg'), HEX('b'), 'lowercased');
  assert.equal(sums.has('short.dmg'), false);
  assert.equal(sums.size, 2);
});

test('a name listed twice with different sums counts as not listed', () => {
  const sums = parseSha256Sums(`${HEX('a')}  x.dmg\n${HEX('b')}  x.dmg\n${HEX('c')}  y.dmg\n${HEX('c')}  y.dmg\n`);
  assert.equal(sums.get('x.dmg'), null);
  assert.equal(sums.get('y.dmg'), HEX('c'), 'the same line twice is fine');
});

test('digests match only as full SHA-256 hex, in any case', () => {
  assert.equal(digestsMatch(HEX('a'), HEX('A')), true);
  assert.equal(digestsMatch(HEX('a'), HEX('b')), false);
  assert.equal(digestsMatch('', ''), false);
  assert.equal(digestsMatch(null, undefined), false);
});

test('the running app: as the shell says, or worked out from its server folder', () => {
  assert.equal(runningBundle({ app: '/Applications/Six Degrees.app' }), '/Applications/Six Degrees.app');
  assert.equal(runningBundle({ root: '/Applications/Six Degrees.app/Contents/Resources/server' }), '/Applications/Six Degrees.app');
  assert.equal(runningBundle({ root: '/Users/x/Apps/Six Degrees.app/Contents/Resources/app' }), '/Users/x/Apps/Six Degrees.app', 'the classic layout');
  assert.equal(runningBundle({ app: 'relative/Six Degrees.app', root: '/A/Six Degrees.app/Contents/Resources/server' }), '/A/Six Degrees.app');
  assert.equal(runningBundle({ root: '/home/me/.npm/_npx/abc/node_modules/six-degrees/.next/standalone' }), null);
  assert.equal(runningBundle({}), null);
});

test('refusals: a disk image, a translocated copy, an unwritable folder, another user\'s app', () => {
  const ok = { exists: true, parentWritable: true, ownerUid: 501, uid: 501 };
  assert.equal(bundleRefusal('/Applications/Six Degrees.app', ok), null);
  assert.equal(bundleRefusal('/Users/me/Applications/Six Degrees.app', ok), null);
  assert.equal(bundleRefusal('/Volumes/Six Degrees/Six Degrees.app', ok).code, 'disk-image');
  assert.equal(
    bundleRefusal('/private/var/folders/x/T/AppTranslocation/1234/d/Six Degrees.app', ok).code, 'translocated');
  assert.equal(bundleRefusal('/Applications/Six Degrees.app', { ...ok, parentWritable: false }).code, 'not-writable');
  assert.equal(bundleRefusal('/Applications/Six Degrees.app', { ...ok, ownerUid: 0 }).code, 'not-owner');
  assert.equal(bundleRefusal('/opt/six-degrees', ok).code, 'not-app');
  assert.equal(bundleRefusal(null, ok).code, 'unknown-location');
  assert.equal(bundleRefusal('/Applications/Six Degrees.app', { ...ok, exists: false }).code, 'unknown-location');
  // Every refusal says what to do in words, for the Settings page.
  assert.match(bundleRefusal('/Volumes/Six Degrees/Six Degrees.app', ok).message, /Applications folder/);
});

test('a data folder inside the app is refused: replacing the app would carry it away', () => {
  const app = '/Applications/Six Degrees.app';
  const inside = dataRefusal({ dataDir: `${app}/Contents/Resources/server/data`, bundle: app });
  assert.equal(inside.code, 'data-inside-app');
  // It names the folder and says what to do, since no Terminal line is offered for it.
  assert.match(inside.message, /Contents\/Resources\/server\/data/);
  assert.match(inside.message, /move that folder out of the app/);
  assert.match(inside.message, /--data-dir/);
  assert.equal(dataRefusal({ dataDir: '/Users/me/.six-degrees', bundle: app }), null);
  assert.equal(dataRefusal({ dataDir: '/Applications/Six Degrees.app-data', bundle: app }), null, 'a sibling is not inside');
});

test('a database kept outside the data folder (SIX_DEGREES_DB) is refused: the reopened app couldn\'t find it', () => {
  const app = '/Applications/Six Degrees.app';
  const dataDir = '/Users/me/.six-degrees';
  assert.equal(dataRefusal({ dataDir, bundle: app, dbFile: '/tmp/other.sqlite' }).code, 'database-elsewhere');
  assert.equal(dataRefusal({ dataDir, bundle: app, dbFile: `${dataDir}/six-degrees.sqlite` }), null, 'the usual place is fine');
  assert.equal(dataRefusal({ dataDir, bundle: app, dbFile: null }), null);
});

test('the Terminal line is described as what install.sh would do for this copy, or not offered', () => {
  const apps = installerTarget({ applicationsWritable: true, home: '/Users/me' });
  const mine = installerTarget({ applicationsWritable: false, home: '/Users/me' });
  assert.equal(apps, '/Applications/Six Degrees.app');
  assert.equal(mine, '/Users/me/Applications/Six Degrees.app', 'no write access to /Applications: install.sh uses ~/Applications');
  // The copy in Applications: install.sh stops it and replaces it.
  assert.deepEqual(terminalFallback({ bundle: apps, installsTo: apps }), { mode: 'replace' });
  // Anywhere else (the disk image, a translocated copy, a folder of its own, a
  // copy in /Applications this user can't change): it installs a second copy
  // and leaves this one running, so quit this one first.
  for (const [bundle, code, to] of [
    ['/Volumes/Six Degrees/Six Degrees.app', 'disk-image', apps],
    ['/private/var/folders/x/T/AppTranslocation/1/d/Six Degrees.app', 'translocated', apps],
    [apps, 'not-writable', mine],
    ['/Users/me/Six-Degrees-Update-Test/Six Degrees.app', null, apps],
  ]) {
    assert.deepEqual(terminalFallback({ bundle, refusalCode: code, installsTo: to }), { mode: 'elsewhere', installsTo: to }, bundle);
  }
  // Never where it would delete a network kept inside the app, or can't carry the database.
  assert.equal(terminalFallback({ bundle: apps, refusalCode: 'data-inside-app', installsTo: apps }), null);
  assert.equal(terminalFallback({ bundle: '/elsewhere/Six Degrees.app', refusalCode: 'data-inside-app', installsTo: apps }), null);
  assert.equal(terminalFallback({ bundle: apps, refusalCode: 'database-elsewhere', installsTo: apps }), null);
  // Another user's app where install.sh would put it: it can't delete that. In ~/Applications it can install one of your own.
  assert.equal(terminalFallback({ bundle: apps, refusalCode: 'not-owner', installsTo: apps }), null);
  assert.deepEqual(terminalFallback({ bundle: apps, refusalCode: 'not-owner', installsTo: mine }), { mode: 'elsewhere', installsTo: mine });
  // A data folder of its own: install.sh reopens the new version without it, so the page says so.
  assert.deepEqual(terminalFallback({ bundle: apps, installsTo: apps, dataDir: '/Volumes/Work/data' }), { mode: 'replace', dataDir: '/Volumes/Work/data' });
});

test('other users\' copies of the app are found from ps, and nobody else\'s processes are', () => {
  const ps = [
    '  501   100 /Applications/Six Degrees.app/Contents/MacOS/Six Degrees',
    '  502   200 /Applications/Six Degrees.app/Contents/MacOS/Six Degrees',
    '  502   201 /Applications/Six Degrees.app/Contents/Frameworks/Six Degrees Helper (Renderer).app/Contents/MacOS/Six Degrees Helper (Renderer)',
    '  502   202 next-server (v16.3.6)',
    '  502   203 /bin/zsh',
    '  502   204 /Users/other/Applications/Six Degrees.app/Contents/MacOS/Six Degrees',
    '    0   205 /Applications/Six Degrees.app-old/Contents/MacOS/Six Degrees',
    'garbage',
  ].join('\n');
  assert.deepEqual(foreignAppProcesses(ps, { bundles: ['/Applications/Six Degrees.app'], uid: 501 }), [200, 201]);
  assert.deepEqual(foreignAppProcesses(ps, { bundles: ['/Applications/Six Degrees.app'], uid: 502 }), [100]);
  assert.deepEqual(foreignAppProcesses(ps, { bundles: [], uid: 501 }), []);
  assert.deepEqual(foreignAppProcesses(ps, { bundles: ['/Applications/Six Degrees.app'], uid: undefined }), []);
});

test('leftovers beside the app are recognised by this app\'s own names only', () => {
  const names = [
    'Six Degrees.app', '.Six Degrees.app.previous-4321', '.Six Degrees.app.previous-4321-2', '.Six Degrees.app.failed-77',
    '.Six Degrees.app.incoming', '.Six Degrees.app.previous-', '.Six Degrees.app.previous-12x', '.Other.app.previous-1',
    'Six Degrees.app.previous-5', '.Six Degrees (1).app.previous-9', 'Notes', '.DS_Store',
  ];
  assert.deepEqual(leftoversBeside(names, 'Six Degrees.app'), [
    { name: '.Six Degrees.app.previous-4321', kind: 'previous', pid: 4321 },
    { name: '.Six Degrees.app.previous-4321-2', kind: 'previous', pid: 4321 },
    { name: '.Six Degrees.app.failed-77', kind: 'failed', pid: 77 },
    { name: '.Six Degrees.app.incoming', kind: 'incoming', pid: null },
  ]);
  assert.deepEqual(leftoversBeside(names, 'Six Degrees (1).app').map((l) => l.name), ['.Six Degrees (1).app.previous-9']);
});

test('the new version waits beside the old one, hidden, in the same folder', () => {
  assert.equal(stagingPath('/Applications/Six Degrees.app'), '/Applications/.Six Degrees.app.incoming');
});

test('the new version reopens on the data this copy used, always named: the default folder too', () => {
  // open passes no environment, so a copy started with SIX_DEGREES_HOME (or
  // launchctl setenv) must be told its folder again, and so must the default:
  // whatever launchd hands the next app is not necessarily it.
  assert.deepEqual(relaunchArgs({ dataDir: '/Users/me/.six-degrees' }), ['--after-update', '--data-dir', '/Users/me/.six-degrees']);
  assert.deepEqual(relaunchArgs({ dataDir: '/Users/me/.six-degrees/' }), ['--after-update', '--data-dir', '/Users/me/.six-degrees']);
  assert.deepEqual(
    relaunchArgs({ dataDir: '/Volumes/Work/six degrees copy' }),
    ['--after-update', '--data-dir', '/Volumes/Work/six degrees copy'],
    'one argument, spaces and all',
  );
  assert.deepEqual(relaunchArgs({}), ['--after-update']);
});

test('the helper\'s command line carries every value, and the new app\'s arguments after "--"', () => {
  const args = helperArgs({
    target: '/Applications/Six Degrees.app', staged: '/Applications/.Six Degrees.app.incoming',
    keepDir: '/Users/me/Library/Caches/Six Degrees', statusFile: '/Users/me/Library/Caches/Six Degrees/last-update.json',
    from: '0.2.1', to: '0.2.2', pids: [4321, 4322, 1, undefined], waitSeconds: 30,
    logFile: '/tmp/six-degrees-update.log', work: '/tmp/six-degrees-update-abc',
    confirmFile: '/Users/me/Library/Caches/Six Degrees/update-confirmed.json', confirmWaitSeconds: 600,
    relaunch: ['--after-update', '--data-dir', '/x y'],
  });
  const at = (flag) => args[args.indexOf(flag) + 1];
  assert.equal(at('--target'), '/Applications/Six Degrees.app');
  assert.equal(at('--confirm'), '/Users/me/Library/Caches/Six Degrees/update-confirmed.json');
  assert.equal(at('--confirm-wait'), '600');
  assert.equal(at('--from'), '0.2.1');
  assert.equal(at('--to'), '0.2.2');
  assert.deepEqual(args.filter((_, i) => args[i - 1] === '--pid'), ['4321', '4322'], 'never launchd (1), never nothing');
  assert.deepEqual(args.slice(args.indexOf('--') + 1), ['--after-update', '--data-dir', '/x y']);
  assert.ok(args.indexOf('--log') < args.indexOf('--'), 'its own options come before the new app\'s');
});

test('macOS versions compare as numbers', () => {
  assert.equal(versionAtLeast('26.3.1', '13.5'), true);
  assert.equal(versionAtLeast('13.5', '13.5'), true);
  assert.equal(versionAtLeast('13.4.1', '13.5'), false);
  assert.equal(versionAtLeast('13.10', '13.5'), true);
});

test('Mach-O headers: which chips an executable runs on, without lipo', () => {
  const thin = (cpu) => { const b = Buffer.alloc(32); b.writeUInt32LE(0xfeedfacf, 0); b.writeUInt32LE(cpu, 4); return b; };
  assert.deepEqual([...machoArchs(thin(0x0100000c))], ['arm64']);
  assert.deepEqual([...machoArchs(thin(0x01000007))], ['x64']);
  const fat = Buffer.alloc(8 + 2 * 20);
  fat.writeUInt32BE(0xcafebabe, 0);
  fat.writeUInt32BE(2, 4);
  fat.writeUInt32BE(0x01000007, 8);
  fat.writeUInt32BE(0x0100000c, 28);
  assert.deepEqual([...machoArchs(fat)].sort(), ['arm64', 'x64']);
  // A bash launcher (the classic app) and a Java class file (same magic, not a binary).
  assert.equal(machoArchs(Buffer.from('#!/bin/bash\necho hi\n')).size, 0);
  const javaClass = Buffer.from([0xca, 0xfe, 0xba, 0xbe, 0x00, 0x00, 0x00, 0x41]);
  assert.equal(machoArchs(javaClass).size, 0);
  assert.equal(machoArchs(null).size, 0);
});

test('Mach-O headers: a real universal binary on this Mac', { skip: process.platform !== 'darwin' || !existsSync('/usr/bin/true') }, () => {
  const archs = machoArchs(readFileSync('/usr/bin/true').subarray(0, 4096));
  assert.ok(archs.has('arm64') || archs.has('x64'), [...archs].join(','));
});

// ── what the next start says about the last update ──────────────────────────
const NOW = Date.parse('2026-09-25T12:00:00Z');
const status = (over) => ({ from: '0.2.1', to: '0.2.2', at: '2026-09-25T11:58:00Z', ...over });
const report = (s, runningVersion = '0.2.2') => lastUpdateReport(s, { runningVersion, now: NOW });

test('after an update that worked: "Updated to 0.2.2", and where the old version is kept', () => {
  const r = report(status({ outcome: 'installed', previous: '/Users/me/Library/Caches/Six Degrees/Six Degrees 0.2.1.app' }));
  assert.equal(r.tone, 'ok');
  assert.equal(r.text, 'Updated to 0.2.2.');
  assert.match(r.previous, /Six Degrees 0\.2\.1\.app$/);
});

test('after an update that was rolled back: why, and that the previous version is back', () => {
  const r = report(status({ outcome: 'rolled-back', reason: "the new version wouldn't open (error -10810)." }), '0.2.1');
  assert.equal(r.tone, 'bad');
  assert.equal(r.text, "The update to 0.2.2 didn't finish: the new version wouldn't open (error -10810). Your previous version was put back.");
});

test('after an update that changed nothing, or could not even put the old version back', () => {
  assert.match(report(status({ outcome: 'not-applied', reason: "the old version didn't close" }), '0.2.1').text,
    /didn't finish: the old version didn't close\. Nothing was changed\.$/);
  const failed = report(status({ outcome: 'failed', reason: 'x', previous: '/Applications/.Six Degrees.app.previous-99' }), '0.2.1');
  assert.equal(failed.tone, 'bad');
  // Says the folder is hidden and how to see it, and points at a button that is there
  // (not at a Terminal line, which only a check shows).
  assert.match(failed.text, /in a hidden folder: \/Applications\/\.Six Degrees\.app\.previous-99\./);
  assert.match(failed.text, /Shift-Command-\. shows hidden files/);
  assert.match(failed.text, /Check for updates, below/);
  assert.doesNotMatch(failed.text, /line below/);
});

test('REGRESSION: a failed update is not reported once this copy is that version or newer (the Terminal line worked)', () => {
  // The update to 0.2.2 fails here, then the Terminal line installs 0.2.2: the
  // failure is old news, and "your previous version was put back" is false.
  for (const outcome of ['not-applied', 'rolled-back', 'failed']) {
    const s = status({ outcome, reason: 'x', previous: '/Applications/.Six Degrees.app.previous-9' });
    assert.equal(report(s, '0.2.2'), null, `${outcome}, now at 0.2.2`);
    assert.equal(report(s, '0.2.3'), null, `${outcome}, now past it`);
    assert.equal(report(s, '0.2.1').tone, 'bad', `${outcome}, still before it`);
  }
  // A hand-over whose helper never answered, when this copy is past it.
  assert.equal(report(status({ outcome: 'started' }), '0.2.3'), null);
});

test('REGRESSION: an update that worked is not re-reported as a problem once a later one is installed', () => {
  // 0.2.2 is installed here, then 0.2.3 with the Terminal line: "0.2.2 was
  // installed, but this copy is 0.2.3, two copies?" would be wrong.
  assert.equal(report(status({ outcome: 'installed' }), '0.2.3'), null);
  assert.equal(report(status({ outcome: 'installed' }), '0.2.2').text, 'Updated to 0.2.2.');
});

test('a hand-over whose helper never answered: the running version says how it went', () => {
  assert.equal(report(status({ outcome: 'started' }), '0.2.2').tone, 'ok');
  const r = report(status({ outcome: 'started', log: '/tmp/six-degrees-update.log' }), '0.2.1');
  assert.equal(r.tone, 'bad');
  assert.match(r.text, /didn't say why\. Its log is \/tmp\/six-degrees-update\.log\./);
});

test('installed, but this is not that version: two copies, most likely', () => {
  const r = report(status({ outcome: 'installed' }), '0.2.1');
  assert.equal(r.tone, 'bad');
  assert.match(r.text, /this copy is 0\.2\.1/);
});

test('an old report, or a file that is not one, says nothing', () => {
  assert.equal(report(status({ outcome: 'installed', at: '2026-09-01T00:00:00Z' })), null, 'over a week ago');
  assert.equal(report(null), null);
  assert.equal(report({ outcome: 'installed' }), null);
  assert.equal(report(status({ outcome: 'something new' })), null);
  assert.equal(report(status({ outcome: 'installed', at: 'yesterday' })), null);
});
