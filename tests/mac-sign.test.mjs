// Signing and notarizing the Mac app (scripts/mac-sign.mjs, DESKTOP.md D4).
//
// The decisions run anywhere. notarize() and staple() run against a stand-in
// `xcrun` put first on PATH, which answers the way notarytool and stapler do,
// so Apple is never asked and no credential exists. The one test that signs
// for real needs a code-signing identity on this Mac, and runs only when
// SIX_DEGREES_TEST_SIGN_IDENTITY names one (a throwaway self-signed identity in
// a temporary keychain is enough: DESKTOP.md D4 says how); CI has none.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  SECRET_NAMES, ENTITLEMENTS, signingSetup, signingRequired, releaseSigningPlan, codesignArgs, signingPlan,
  bundleOfExecutable, parseSpctl, parseNotaryJson, notaryIssueLines, scrub, parseCodesignInfo, signerName,
  notarize, staple, SigningError, machoFileType, findCode, signDeveloperId,
} from '../scripts/mac-sign.mjs';

const SCRIPT = fileURLToPath(new URL('../scripts/mac-sign.mjs', import.meta.url));
// Invented values, shaped like the real ones.
const KEY_ID = 'ZZ9TEST0KY';
const ISSUER = '00000000-1111-2222-3333-444455556666';

const tmp = (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'six-degrees-sign-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
};

// ── which way a build signs ──

test('no identity: ad hoc, exactly as before (an empty value and "-" too)', () => {
  assert.deepEqual(signingSetup({}), { mode: 'ad-hoc' });
  assert.deepEqual(signingSetup({ SIX_DEGREES_SIGN_IDENTITY: '  ' }), { mode: 'ad-hoc' });
  assert.deepEqual(signingSetup({ SIX_DEGREES_SIGN_IDENTITY: '-' }), { mode: 'ad-hoc' });
});

test('an identity alone: Developer ID, not notarized; its keychain is optional', () => {
  const id = 'Developer ID Application: Test Person (TEAM000001)';
  assert.deepEqual(signingSetup({ SIX_DEGREES_SIGN_IDENTITY: id }),
    { mode: 'developer-id', identity: id, keychain: null, notary: null });
  assert.equal(signingSetup({ SIX_DEGREES_SIGN_IDENTITY: id, SIX_DEGREES_SIGN_KEYCHAIN: '/k/signing.keychain-db' }).keychain, '/k/signing.keychain-db');
  assert.match(signingSetup({ SIX_DEGREES_SIGN_IDENTITY: id, SIX_DEGREES_SIGN_KEYCHAIN: '/nope' }, { exists: () => false }).error, /isn't there/);
});

test('the identity and all three notary settings: Developer ID and notarized', () => {
  const s = signingSetup({
    SIX_DEGREES_SIGN_IDENTITY: 'ABCDEF0123456789ABCDEF0123456789ABCDEF01',
    SIX_DEGREES_NOTARY_KEY: '/tmp/AuthKey.p8', SIX_DEGREES_NOTARY_KEY_ID: KEY_ID, SIX_DEGREES_NOTARY_ISSUER: ISSUER,
  });
  assert.equal(s.mode, 'developer-id');
  assert.deepEqual(s.notary, { key: '/tmp/AuthKey.p8', keyId: KEY_ID, issuer: ISSUER });
});

test('half the notary settings, notary settings without an identity, or a missing key: refused, naming the setting, never a value', () => {
  const id = { SIX_DEGREES_SIGN_IDENTITY: 'X' };
  const half = signingSetup({ ...id, SIX_DEGREES_NOTARY_KEY: '/k.p8', SIX_DEGREES_NOTARY_KEY_ID: KEY_ID });
  assert.match(half.error, /SIX_DEGREES_NOTARY_ISSUER is not set/);
  assert.ok(!half.error.includes(KEY_ID));
  assert.match(signingSetup({ SIX_DEGREES_NOTARY_KEY: '/k.p8', SIX_DEGREES_NOTARY_KEY_ID: KEY_ID, SIX_DEGREES_NOTARY_ISSUER: ISSUER }).error,
    /needs a Developer ID signature/);
  const gone = signingSetup({ ...id, SIX_DEGREES_NOTARY_KEY: '/gone.p8', SIX_DEGREES_NOTARY_KEY_ID: KEY_ID, SIX_DEGREES_NOTARY_ISSUER: ISSUER },
    { exists: (p) => p !== '/gone.p8' });
  assert.match(gone.error, /isn't there \(\/gone\.p8\)/);
  assert.ok(!gone.error.includes(ISSUER));
});

// ── when a release must be signed ──

test('signing is required for a real release from 1.0.0 on, its betas included; never for a dry run', () => {
  const cases = [
    ['0.8.0', false, false], ['0.9.9', false, false], ['0.99.0', false, false],
    ['1.0.0', false, true], ['v1.0.0', false, true], ['1.0.0-beta.1', false, true], ['1.2.3', false, true], ['2.0.0', false, true],
    ['1.0.0', true, false], ['3.1.0', true, false], ['0.9.0', true, false],
    ['nonsense', false, true],   // can't tell: better to require it than to ship unsigned
  ];
  for (const [version, dryRun, want] of cases) {
    assert.equal(signingRequired({ version, dryRun }), want, `${version}, dry run ${dryRun}`);
  }
});

test('the release plan: all five secrets sign; none builds ad hoc before 1.0 or on a dry run; none at 1.0 or a partial set fails', () => {
  assert.deepEqual(releaseSigningPlan({ version: '1.0.0', dryRun: false, present: SECRET_NAMES }), { sign: true, required: true });
  assert.deepEqual(releaseSigningPlan({ version: '0.9.0', dryRun: true, present: SECRET_NAMES }), { sign: true, required: false });
  const before = releaseSigningPlan({ version: '0.9.0', dryRun: false, present: [] });
  assert.equal(before.sign, false);
  assert.match(before.note, /ad hoc/);
  assert.equal(releaseSigningPlan({ version: '1.4.0', dryRun: true, present: [] }).sign, false);
  const required = releaseSigningPlan({ version: '1.0.0', dryRun: false, present: [] });
  assert.match(required.error, /must be signed and notarized/);
  for (const name of SECRET_NAMES) assert.ok(required.error.includes(name));
  const partial = releaseSigningPlan({ version: '0.9.0', dryRun: true, present: ['MACOS_SIGN_P12_BASE64', 'APPLE_API_KEY_ID'] });
  assert.match(partial.error, /Missing: MACOS_SIGN_P12_PASSWORD, APPLE_API_KEY_P8_BASE64, APPLE_API_ISSUER_ID/);
});

test('release-plan, as the workflow runs it: reads only whether each secret is set, and never prints one', () => {
  const run = (args, extra) => {
    const env = { PATH: process.env.PATH, HOME: process.env.HOME };
    return spawnSync(process.execPath, [SCRIPT, 'release-plan', ...args], { env: { ...env, ...extra }, encoding: 'utf8' });
  };
  const all = Object.fromEntries(SECRET_NAMES.map((n, i) => [n, `secret-value-${i}-do-not-print`]));
  const signed = run(['1.0.0', 'false'], all);
  assert.equal(signed.status, 0);
  assert.equal(signed.stdout.trim(), 'developer-id');
  const adhoc = run(['0.9.0', 'false'], {});
  assert.equal(adhoc.status, 0);
  assert.equal(adhoc.stdout.trim(), 'ad-hoc');
  const refused = run(['1.0.0', 'false'], {});
  assert.equal(refused.status, 1);
  assert.equal(refused.stdout, '');
  assert.match(refused.stderr, /MACOS_SIGN_P12_BASE64/);
  const dry = run(['1.0.0', 'true'], { MACOS_SIGN_P12_PASSWORD: 'secret-value-do-not-print' });
  assert.equal(dry.status, 1, 'a partial set fails even on a dry run');
  for (const r of [signed, adhoc, refused, dry]) assert.ok(!`${r.stdout}${r.stderr}`.includes('do-not-print'));
  assert.equal(run([], {}).status, 2);
});

// ── how codesign is called ──

test('codesign: hardened runtime, a secure timestamp, --force, never --deep; the keychain and entitlements only when given', () => {
  const plain = codesignArgs({ identity: 'ID' });
  assert.deepEqual(plain, ['--force', '--sign', 'ID', '--timestamp', '--options', 'runtime']);
  const full = codesignArgs({ identity: 'ID', keychain: '/k.keychain-db' }, { entitlements: '/e.plist' });
  assert.deepEqual(full.slice(-4), ['--keychain', '/k.keychain-db', '--entitlements', '/e.plist']);
  assert.ok(!codesignArgs({ identity: 'ID' }, { runtime: false }).includes('runtime'), 'a disk image has no runtime');
  for (const args of [plain, full]) assert.ok(!args.includes('--deep'));
});

// An app laid out like the real one (Electron 44, Node, the scanner's Python).
const ELECTRON_LIKE = [
  { rel: 'Contents/MacOS/Six Degrees', kind: 'file', fileType: 2 },
  { rel: 'Contents/Frameworks/Electron Framework.framework', kind: 'bundle' },
  { rel: 'Contents/Frameworks/Electron Framework.framework/Versions/A/Electron Framework', kind: 'file', fileType: 6 },
  { rel: 'Contents/Frameworks/Electron Framework.framework/Versions/A/Libraries/libEGL.dylib', kind: 'file', fileType: 6 },
  { rel: 'Contents/Frameworks/Electron Framework.framework/Versions/A/Helpers/chrome_crashpad_handler', kind: 'file', fileType: 2 },
  { rel: 'Contents/Frameworks/Squirrel.framework', kind: 'bundle' },
  { rel: 'Contents/Frameworks/Squirrel.framework/Versions/A/Squirrel', kind: 'file', fileType: 6 },
  { rel: 'Contents/Frameworks/Squirrel.framework/Versions/A/Resources/ShipIt', kind: 'file', fileType: 2 },
  { rel: 'Contents/Frameworks/Six Degrees Helper.app', kind: 'bundle' },
  { rel: 'Contents/Frameworks/Six Degrees Helper.app/Contents/MacOS/Six Degrees Helper', kind: 'file', fileType: 2 },
  { rel: 'Contents/Frameworks/Six Degrees Helper (Renderer).app', kind: 'bundle' },
  { rel: 'Contents/Frameworks/Six Degrees Helper (Renderer).app/Contents/MacOS/Six Degrees Helper (Renderer)', kind: 'file', fileType: 2 },
  { rel: 'Contents/Resources/node', kind: 'file', fileType: 2 },
  { rel: 'Contents/Resources/server/node_modules/@img/sharp-darwin-arm64/lib/sharp-darwin-arm64.node', kind: 'file', fileType: 8 },
  { rel: 'Contents/Resources/server/node_modules/@img/sharp-libvips-darwin-arm64/lib/libvips-cpp.8.17.dylib', kind: 'file', fileType: 6 },
  { rel: 'Contents/Resources/python/bin/python3.12', kind: 'file', fileType: 2 },
  { rel: 'Contents/Resources/python/lib/python3.12/lib-dynload/_ssl.cpython-312-darwin.so', kind: 'file', fileType: 8 },
  { rel: 'Contents/Resources/python/lib/python3.12/site-packages/playwright/driver/node', kind: 'file', fileType: 2 },
  { rel: 'Contents/Resources/python/lib/python3.12/site-packages/foo.o', kind: 'file', fileType: 1 },
];

test('inside out: loose programs and libraries, then bundles deepest first, then the app; bundle executables go with their bundle', () => {
  const plan = signingPlan(ELECTRON_LIKE);
  const files = plan.files.map((f) => f.rel);
  for (const rel of ['Contents/MacOS/Six Degrees',
    'Contents/Frameworks/Electron Framework.framework/Versions/A/Electron Framework',
    'Contents/Frameworks/Squirrel.framework/Versions/A/Squirrel',
    'Contents/Frameworks/Six Degrees Helper.app/Contents/MacOS/Six Degrees Helper']) {
    assert.ok(!files.includes(rel), `${rel} is signed with its bundle`);
  }
  for (const rel of ['Contents/Frameworks/Electron Framework.framework/Versions/A/Libraries/libEGL.dylib',
    'Contents/Frameworks/Electron Framework.framework/Versions/A/Helpers/chrome_crashpad_handler',
    'Contents/Frameworks/Squirrel.framework/Versions/A/Resources/ShipIt',
    'Contents/Resources/node', 'Contents/Resources/python/bin/python3.12',
    'Contents/Resources/python/lib/python3.12/lib-dynload/_ssl.cpython-312-darwin.so']) {
    assert.ok(files.includes(rel), `${rel} is signed on its own`);
  }
  assert.ok(!files.some((f) => f.endsWith('.o')), 'an object file is no program or library');
  const depth = (rel) => rel.split('/').length;
  for (let i = 1; i < plan.bundles.length; i++) assert.ok(depth(plan.bundles[i - 1].rel) >= depth(plan.bundles[i].rel));
  assert.equal(plan.bundles.length, 4);
});

test('entitlements: V8 programs only (the app, its helpers, Node, the driver\'s Node); nothing for Python, libraries or frameworks', () => {
  const plan = signingPlan(ELECTRON_LIKE);
  const ent = Object.fromEntries([...plan.files, ...plan.bundles].map((p) => [p.rel, p.entitlements]));
  assert.equal(plan.app.entitlements, 'electron');
  assert.equal(ent['Contents/Frameworks/Six Degrees Helper.app'], 'electron');
  assert.equal(ent['Contents/Frameworks/Six Degrees Helper (Renderer).app'], 'electron');
  assert.equal(ent['Contents/Resources/node'], 'node');
  assert.equal(ent['Contents/Resources/python/lib/python3.12/site-packages/playwright/driver/node'], 'node');
  assert.equal(ent['Contents/Resources/python/bin/python3.12'], null);
  assert.equal(ent['Contents/Frameworks/Electron Framework.framework'], null);
  assert.equal(ent['Contents/Frameworks/Electron Framework.framework/Versions/A/Helpers/chrome_crashpad_handler'], null);
  assert.equal(ent['Contents/Resources/server/node_modules/@img/sharp-darwin-arm64/lib/sharp-darwin-arm64.node'], null);
  // The classic launcher's executable is a bash script: no entitlements for it.
  assert.equal(signingPlan([], { mainIsMachO: false }).app.entitlements, null);
});

test('a bundle executable is recognised only as its own bundle\'s', () => {
  assert.equal(bundleOfExecutable('Contents/MacOS/Six Degrees'), '');
  assert.equal(bundleOfExecutable('Contents/Frameworks/A Helper.app/Contents/MacOS/A Helper'), 'Contents/Frameworks/A Helper.app');
  assert.equal(bundleOfExecutable('Contents/Frameworks/X.framework/Versions/A/X'), 'Contents/Frameworks/X.framework');
  assert.equal(bundleOfExecutable('Contents/Frameworks/X.framework/Versions/A/Libraries/libX.dylib'), null);
  assert.equal(bundleOfExecutable('Contents/Resources/node'), null);
  // A Contents/MacOS file in a folder that isn't a code bundle is signed on its own.
  const plan = signingPlan([{ rel: 'Contents/Resources/odd.app/Contents/MacOS/odd', kind: 'file', fileType: 2 }]);
  assert.deepEqual(plan.files.map((f) => f.rel), ['Contents/Resources/odd.app/Contents/MacOS/odd']);
});

test('the entitlement files: allow-jit and allow-unsigned-executable-memory, never disable-library-validation', () => {
  for (const file of Object.values(ENTITLEMENTS)) {
    const xml = fs.readFileSync(file, 'utf8');
    const keys = [...xml.replace(/<!--[\s\S]*?-->/g, '').matchAll(/<key>([^<]+)<\/key>/g)].map((m) => m[1]);
    assert.deepEqual(keys, ['com.apple.security.cs.allow-jit', 'com.apple.security.cs.allow-unsigned-executable-memory'], file);
    if (process.platform === 'darwin') execFileSync('/usr/bin/plutil', ['-lint', file]);
  }
});

// ── reading the tools' answers ──

test('spctl: notarized, merely signed, rejected, and Gatekeeper turned off', () => {
  const ok = parseSpctl('/x/Six Degrees.app: accepted\nsource=Notarized Developer ID\norigin=Developer ID Application: Test Person (TEAM000001)\n');
  assert.deepEqual(ok, { accepted: true, source: 'Notarized Developer ID', origin: 'Developer ID Application: Test Person (TEAM000001)', disabled: false });
  assert.equal(parseSpctl('/x.app: accepted\nsource=Developer ID\n').source, 'Developer ID');
  assert.equal(parseSpctl('/x.app: rejected\nsource=no usable signature\n').accepted, false);
  // Gatekeeper turned off on the machine: "accepted" says nothing, and the build says so.
  const off = parseSpctl('/x.app: accepted\noverride=security disabled\n');
  assert.equal(off.disabled, true);
  assert.equal(off.source, null);
});

test('notarytool\'s JSON, its log\'s issues, and codesign -dv', () => {
  assert.deepEqual(parseNotaryJson('{"id":"abc-123","status":"Accepted","message":"Processing complete"}'),
    { id: 'abc-123', status: 'Accepted', message: 'Processing complete' });
  assert.equal(parseNotaryJson('Error: no network'), null);
  const lines = notaryIssueLines({
    statusSummary: 'Archive contains critical validation errors',
    issues: [{ severity: 'error', path: 'app.zip/Six Degrees.app/Contents/Resources/node', message: 'The executable does not have the hardened runtime enabled.', architecture: 'arm64' }],
  });
  assert.deepEqual(lines, ['Archive contains critical validation errors',
    'error: app.zip/Six Degrees.app/Contents/Resources/node (arm64): The executable does not have the hardened runtime enabled.']);
  assert.equal(notaryIssueLines({ issues: new Array(45).fill({ severity: 'error', message: 'm' }) }).at(-1), '… and 5 more');
  const info = parseCodesignInfo('Executable=/x\nCodeDirectory v=20500 size=1 flags=0x10000(runtime) hashes=1+7 location=embedded\n'
    + 'Authority=Developer ID Application: Test Person (TEAM000001)\nAuthority=Developer ID Certification Authority\nTimestamp=Oct 4, 2026\nTeamIdentifier=TEAM000001\n');
  assert.deepEqual(info, { authority: 'Developer ID Application: Test Person (TEAM000001)', team: 'TEAM000001', runtime: true, timestamp: true });
  assert.equal(parseCodesignInfo('Signature=adhoc\nTeamIdentifier=not set\nflags=0x2(adhoc)').team, null);
  assert.equal(signerName('Developer ID Application: Test Person (TEAM000001)'), 'Test Person');
});

test('scrub: every credential becomes ***, and short or empty values change nothing', () => {
  assert.equal(scrub(`401 for key ${KEY_ID} of ${ISSUER}`, [KEY_ID, ISSUER]), '401 for key *** of ***');
  assert.equal(scrub('abc', ['', null, 'ab']), 'abc');
});

// ── notarytool and stapler, against a stand-in ──

// A stand-in `xcrun` on PATH: notarytool answers with $NOTARY_ANSWER (a file of
// JSON, or "fail" for a submission that never got an id), `log` with
// $NOTARY_LOG; stapler fails $STAPLE_FAILS times first. It writes every
// command line it got to $XCRUN_CALLS, so a test can see what was asked.
function stubXcrun(dir) {
  const bin = path.join(dir, 'bin');
  fs.mkdirSync(bin);
  fs.writeFileSync(path.join(bin, 'xcrun'), `#!/bin/bash
printf '%s\\n' "$*" >> "$XCRUN_CALLS"
case "$1 $2" in
  "notarytool submit")
    if [ "$(cat "$NOTARY_ANSWER")" = fail ]; then echo "Error: HTTP status code: 401. Unable to authenticate key $7 issuer $9" >&2; exit 1; fi
    cat "$NOTARY_ANSWER" ;;
  "notarytool log") cat "$NOTARY_LOG" ;;
  "stapler staple")
    n=$(cat "$STAPLE_COUNT" 2>/dev/null || echo 0); echo $((n + 1)) > "$STAPLE_COUNT"
    if [ "$n" -lt "\${STAPLE_FAILS:-0}" ]; then echo "CloudKit query for x failed due to \\"Record not found\\"." >&2; exit 65; fi
    echo "The staple and validate action worked!" ;;
  "stapler validate") echo "The validate action worked!" ;;
  *) exit 64 ;;
esac
`, { mode: 0o755 });
  const files = {
    answer: path.join(dir, 'answer.json'), log: path.join(dir, 'log.json'), calls: path.join(dir, 'calls.txt'), count: path.join(dir, 'count'),
  };
  const env = (extra = {}) => ({
    ...process.env, PATH: `${bin}:${process.env.PATH}`, NOTARY_ANSWER: files.answer, NOTARY_LOG: files.log,
    XCRUN_CALLS: files.calls, STAPLE_COUNT: files.count, ...extra,
  });
  return { files, env };
}

const NOTARY = { key: '/secret/place/AuthKey_ZZ9TEST0KY.p8', keyId: KEY_ID, issuer: ISSUER };
const printed = () => {
  const lines = [];
  return { log: (s) => lines.push(String(s)), text: () => lines.join('\n') };
};

test('notarize: Accepted returns its id, and nothing it prints holds the key, its id or the issuer', (t) => {
  const { files, env } = stubXcrun(tmp(t));
  fs.writeFileSync(files.answer, '{"id":"4f1a-0001","status":"Accepted","message":"Processing complete"}');
  const out = printed();
  const r = notarize('/x/app.zip', NOTARY, { env: env(), log: out.log, what: 'the app' });
  assert.equal(r.id, '4f1a-0001');
  assert.match(out.text(), /the app: submission 4f1a-0001, Accepted/);
  for (const secret of [KEY_ID, ISSUER, NOTARY.key]) assert.ok(!out.text().includes(secret));
  const calls = fs.readFileSync(files.calls, 'utf8');
  assert.match(calls, /^notarytool submit \/x\/app\.zip --key \S+ --key-id \S+ --issuer \S+ --wait --timeout 1h --output-format json$/m);
});

test('notarize: Invalid fetches Apple\'s log, prints its issues, and fails the build, still without a credential', (t) => {
  const { files, env } = stubXcrun(tmp(t));
  fs.writeFileSync(files.answer, '{"id":"4f1a-0002","status":"Invalid","message":"Processing complete"}');
  fs.writeFileSync(files.log, JSON.stringify({
    status: 'Invalid', statusSummary: 'Archive contains critical validation errors',
    issues: [{ severity: 'error', path: `app.zip/Six Degrees.app/Contents/Resources/node (key ${KEY_ID})`, message: 'The signature does not include a secure timestamp.', architecture: 'x86_64' }],
  }));
  const out = printed();
  assert.throws(() => notarize('/x/app.zip', NOTARY, { env: env(), log: out.log, what: 'the app' }),
    (err) => err instanceof SigningError && /didn't notarize the app \(Invalid/.test(err.message) && !err.message.includes(KEY_ID));
  assert.match(out.text(), /error: app\.zip\/Six Degrees\.app\/Contents\/Resources\/node \(key \*\*\*\) \(x86_64\): The signature does not include a secure timestamp\./);
  assert.match(fs.readFileSync(files.calls, 'utf8'), /^notarytool log 4f1a-0002 /m);
  for (const secret of [KEY_ID, ISSUER, NOTARY.key]) assert.ok(!out.text().includes(secret));
});

test('notarize: a submission that never got an id is tried again, then fails with notarytool\'s words, scrubbed', (t) => {
  const { files, env } = stubXcrun(tmp(t));
  fs.writeFileSync(files.answer, 'fail');
  const out = printed();
  assert.throws(() => notarize('/x/app.zip', NOTARY, { env: env(), log: out.log, attempts: 2, retrySeconds: 0 }),
    (err) => err instanceof SigningError && /didn't take/.test(err.message) && !err.message.includes(KEY_ID) && !err.message.includes(ISSUER));
  assert.equal(fs.readFileSync(files.calls, 'utf8').trim().split('\n').length, 2);
  assert.match(out.text(), /try 2 of 2/);
  assert.match(out.text(), /Unable to authenticate key \*\*\* issuer \*\*\*/);
});

test('staple: tried again while Apple\'s ticket isn\'t served yet, then validated; it gives up after its tries', (t) => {
  const dir = tmp(t);
  const { files, env } = stubXcrun(dir);
  const out = printed();
  staple('/x/Six Degrees.app', { env: env({ STAPLE_FAILS: '2' }), log: out.log, retrySeconds: 0 });
  assert.match(out.text(), /try 2 of 5/);
  assert.match(fs.readFileSync(files.calls, 'utf8'), /^stapler validate \/x\/Six Degrees\.app$/m);
  fs.rmSync(files.count);
  assert.throws(() => staple('/x/app', { env: env({ STAPLE_FAILS: '9' }), log: () => {}, attempts: 3, retrySeconds: 0 }), /Record not found/);
});

// ── for real, with an identity on this Mac (optional) ──

test('the Mach-O reader: programs, libraries, and files that aren\'t Mach-O', { skip: process.platform !== 'darwin' && 'macOS files' }, () => {
  assert.equal(machoFileType(process.execPath), 2);
  if (fs.existsSync('/usr/lib/libgmalloc.dylib')) assert.equal(machoFileType('/usr/lib/libgmalloc.dylib'), 6);
  assert.equal(machoFileType(SCRIPT), null);
});

const identity = process.env.SIX_DEGREES_TEST_SIGN_IDENTITY;
test('Developer ID, for real: an Electron-shaped app signed inside out verifies strictly, with each file\'s entitlements',
  { skip: (process.platform !== 'darwin' || !identity) && 'needs macOS and SIX_DEGREES_TEST_SIGN_IDENTITY (a test identity)' }, (t) => {
    const app = path.join(tmp(t), 'Six Degrees.app');
    const put = (rel, from) => {
      fs.mkdirSync(path.dirname(path.join(app, rel)), { recursive: true });
      fs.copyFileSync(from, path.join(app, rel));
      fs.chmodSync(path.join(app, rel), 0o755);
    };
    const plist = (rel, exe, id) => {
      fs.mkdirSync(path.dirname(path.join(app, rel)), { recursive: true });
      fs.writeFileSync(path.join(app, rel), `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict><key>CFBundleExecutable</key><string>${exe}</string><key>CFBundleIdentifier</key><string>${id}</string>
<key>CFBundlePackageType</key><string>APPL</string></dict></plist>
`);
    };
    const dylib = fs.existsSync('/usr/lib/libgmalloc.dylib') ? '/usr/lib/libgmalloc.dylib' : '/usr/bin/true';
    plist('Contents/Info.plist', 'Six Degrees', 'com.example.six-degrees-sign-test');
    put('Contents/MacOS/Six Degrees', '/usr/bin/true');
    plist('Contents/Frameworks/Test Helper.app/Contents/Info.plist', 'Test Helper', 'com.example.six-degrees-sign-test.helper');
    put('Contents/Frameworks/Test Helper.app/Contents/MacOS/Test Helper', '/usr/bin/true');
    const fw = 'Contents/Frameworks/Test Framework.framework';
    plist(`${fw}/Versions/A/Resources/Info.plist`, 'Test Framework', 'com.example.six-degrees-sign-test.framework');
    put(`${fw}/Versions/A/Test Framework`, dylib);
    put(`${fw}/Versions/A/Helpers/crash_handler`, '/usr/bin/true');
    put(`${fw}/Versions/A/Libraries/libextra.dylib`, dylib);
    fs.symlinkSync('A', path.join(app, fw, 'Versions', 'Current'));
    fs.symlinkSync('Versions/Current/Test Framework', path.join(app, fw, 'Test Framework'));
    fs.symlinkSync('Versions/Current/Resources', path.join(app, fw, 'Resources'));
    put('Contents/Resources/node', process.execPath);
    put('Contents/Resources/python/bin/python3.12', '/usr/bin/true');
    put('Contents/Resources/python/lib/python3.12/lib-dynload/_ext.so', dylib);
    fs.mkdirSync(path.join(app, 'Contents/Resources/python/lib/python3.12/site-packages/playwright/driver'), { recursive: true });
    fs.symlinkSync('../../../../../../node', path.join(app, 'Contents/Resources/python/lib/python3.12/site-packages/playwright/driver/node'));

    const setup = { identity, keychain: process.env.SIX_DEGREES_TEST_SIGN_KEYCHAIN || null };
    const { plan } = signDeveloperId(app, setup, { log: () => {} });
    assert.ok(findCode(app).length >= 8);
    assert.ok(!plan.files.some((f) => f.rel.endsWith('playwright/driver/node')), 'a link is signed through its target');
    execFileSync('codesign', ['--verify', '--deep', '--strict', app]);
    const entitlementsOf = (rel) => spawnSync('codesign', ['-d', '--entitlements', '-', '--xml', path.join(app, rel)], { encoding: 'utf8' }).stdout;
    const detail = (rel) => parseCodesignInfo(spawnSync('codesign', ['-dv', '--verbose=2', path.join(app, rel)], { encoding: 'utf8' }).stderr);
    for (const rel of ['', 'Contents/Frameworks/Test Helper.app', 'Contents/Resources/node']) {
      assert.match(entitlementsOf(rel), /com\.apple\.security\.cs\.allow-jit/, `${rel || 'the app'} can JIT`);
      assert.doesNotMatch(entitlementsOf(rel), /disable-library-validation/);
    }
    for (const rel of ['Contents/Resources/python/bin/python3.12', `${fw}/Versions/A/Helpers/crash_handler`, `${fw}/Versions/A/Libraries/libextra.dylib`]) {
      assert.doesNotMatch(entitlementsOf(rel), /allow-jit/, `${rel} has no entitlements`);
    }
    for (const rel of ['', 'Contents/Resources/node', 'Contents/Resources/python/lib/python3.12/lib-dynload/_ext.so', `${fw}/Versions/A/Libraries/libextra.dylib`]) {
      const d = detail(rel);
      assert.ok(d.runtime, `${rel || 'the app'} has the hardened runtime`);
      assert.ok(d.timestamp, `${rel || 'the app'} is timestamped`);
      assert.ok(d.authority && d.authority !== 'adhoc', `${rel || 'the app'} is signed by the identity`);
    }
  });
