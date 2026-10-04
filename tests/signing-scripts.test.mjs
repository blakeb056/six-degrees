// The two shell scripts around Mac signing (DESKTOP.md D4):
//   scripts/set-signing-secrets.sh   Blake runs it to put the five secrets into GitHub
//   scripts/ci-mac-signing.sh        release.yml runs it around the Mac build
//
// `gh` is a stand-in here that keeps what it would have sent in a test folder,
// so nothing reaches GitHub. Every value is invented. ci-mac-signing.sh is run
// only as far as it goes before `security` (the decisions and the checks of
// the decoded files): its keychain steps change the Mac's keychain search list,
// so they were checked by hand with a throwaway identity (DESKTOP.md D4), and
// in CI they run on GitHub's machines.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SET = fileURLToPath(new URL('../scripts/set-signing-secrets.sh', import.meta.url));
const CI = fileURLToPath(new URL('../scripts/ci-mac-signing.sh', import.meta.url));
const OPENSSL = '/usr/bin/openssl';
const KEY_ID = 'ZZ9TEST0KY';
const ISSUER = '00000000-1111-2222-3333-444455556666';
const PASSWORD = 'invented pass word 42';
const NAMES = ['MACOS_SIGN_P12_BASE64', 'MACOS_SIGN_P12_PASSWORD', 'APPLE_API_KEY_P8_BASE64', 'APPLE_API_KEY_ID', 'APPLE_API_ISSUER_ID'];

test('both scripts parse (bash -n)', () => {
  for (const file of [SET, CI]) execFileSync('bash', ['-n', file]);
});

// A folder with a stand-in gh, an invented certificate (.p12, with PASSWORD)
// when openssl is here, and an invented API key.
function fixture(t, { auth = true } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'six-degrees-secrets-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const bin = path.join(dir, 'bin');
  const sent = path.join(dir, 'sent');
  fs.mkdirSync(bin);
  fs.mkdirSync(sent);
  fs.writeFileSync(path.join(bin, 'gh'), `#!/bin/bash
echo "$*" >> "${dir}/gh-calls"
case "$1 $2" in
  "auth status") ${auth ? 'exit 0' : 'echo "You are not logged into any GitHub hosts." >&2; exit 1'} ;;
  "secret set") cat > "${sent}/$3" ;;
  *) exit 64 ;;
esac
`, { mode: 0o755 });
  const p8 = path.join(dir, `AuthKey_${KEY_ID}.p8`);
  // Shaped like a .p8 (the script checks only its first line), built from pieces
  // so no scanner takes this file for a key, and plainly not one.
  const pem = (word) => `-----${word} ${'PRIVATE'} KEY-----`;
  fs.writeFileSync(p8, `${pem('BEGIN')}\ninvented-test-content-not-a-key\n${pem('END')}\n`);
  let p12 = null;
  if (fs.existsSync(OPENSSL)) {
    const key = path.join(dir, 'key.pem');
    const cert = path.join(dir, 'cert.pem');
    p12 = path.join(dir, 'cert.p12');
    execFileSync(OPENSSL, ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', key, '-out', cert, '-days', '1', '-subj', '/CN=Invented Test Signer'], { stdio: 'ignore' });
    execFileSync(OPENSSL, ['pkcs12', '-export', '-inkey', key, '-in', cert, '-out', p12, '-passout', `pass:${PASSWORD}`], { stdio: 'ignore' });
  }
  const run = (args, input = '') => spawnSync('bash', [SET, ...args], {
    input, encoding: 'utf8', env: { PATH: `${bin}:/usr/bin:/bin`, HOME: dir },
  });
  const calls = () => (fs.existsSync(path.join(dir, 'gh-calls')) ? fs.readFileSync(path.join(dir, 'gh-calls'), 'utf8') : '');
  const set = () => fs.readdirSync(sent).sort();
  return { dir, p8, p12, sent, run, calls, set };
}

const noOpenssl = !fs.existsSync(OPENSSL) && 'needs /usr/bin/openssl to make an invented certificate';

test('set-signing-secrets: the wrong number of arguments shows how to use it, and asks GitHub nothing', (t) => {
  const f = fixture(t);
  for (const args of [[], ['a.p12'], ['a.p12', 'b.p8', KEY_ID], ['a', 'b', 'c', 'd', 'e']]) {
    const r = f.run(args);
    assert.equal(r.status, 2, args.join(' '));
    assert.match(r.stderr, /usage: set-signing-secrets\.sh <cert\.p12> <AuthKey_XXXXXXXXXX\.p8> <KEY_ID> <ISSUER_ID>/);
  }
  assert.equal(f.calls(), '');
});

test('set-signing-secrets: a missing or wrong file, or IDs of the wrong shape, are refused before anything is asked or sent', (t) => {
  const f = fixture(t);
  const p12 = f.p12 || f.p8.replace(/\.p8$/, '.p12');
  if (!f.p12) fs.writeFileSync(p12, 'x');
  const notAKey = path.join(f.dir, 'AuthKey_ZZ9TEST0KY-copy.p8');
  fs.writeFileSync(notAKey, 'hello');
  const cases = [
    [[path.join(f.dir, 'nope.p12'), f.p8, KEY_ID, ISSUER], /No file at .*nope\.p12/],
    [[p12, path.join(f.dir, 'nope.p8'), KEY_ID, ISSUER], /No file at .*nope\.p8/],
    [[f.p8, f.p8, KEY_ID, ISSUER], /should be the certificate's \.p12/],
    [[p12, notAKey, KEY_ID, ISSUER], /isn't an App Store Connect API key/],
    [[p12, f.p8, 'zz9test0ky', ISSUER], /KEY_ID should be 10 capital letters and digits/],
    [[p12, f.p8, 'ABCDEFGHIJ', ISSUER], /KEY_ID doesn't match the \.p8's name/],
    [[p12, f.p8, KEY_ID, 'not-a-uuid'], /ISSUER_ID should be a UUID/],
  ];
  for (const [args, want] of cases) {
    const r = f.run(args, `${PASSWORD}\n`);
    assert.equal(r.status, 1, args.join(' '));
    assert.match(r.stderr, want);
    assert.match(r.stderr, /Nothing was set/);
    assert.ok(!r.stderr.includes('zz9test0ky') && !r.stderr.includes('ABCDEFGHIJ') && !r.stderr.includes('not-a-uuid'), 'an ID is never echoed');
  }
  assert.equal(f.calls(), '', 'GitHub is never asked');
});

test('set-signing-secrets: a GitHub CLI that isn\'t signed in is refused before the password is asked', { skip: noOpenssl }, (t) => {
  const f = fixture(t, { auth: false });
  const r = f.run([f.p12, f.p8, KEY_ID, ISSUER], `${PASSWORD}\n`);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /gh auth login/);
  assert.equal(f.calls().trim(), 'auth status');
  assert.deepEqual(f.set(), []);
});

test('set-signing-secrets: sets all five, each value exactly, through gh\'s standard input; prints only their names', { skip: noOpenssl }, (t) => {
  const f = fixture(t);
  const r = f.run([f.p12, f.p8, KEY_ID, ISSUER], `${PASSWORD}\n`);
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(f.set(), [...NAMES].sort());
  const sent = (name) => fs.readFileSync(path.join(f.sent, name), 'utf8');
  assert.deepEqual(Buffer.from(sent('MACOS_SIGN_P12_BASE64'), 'base64'), fs.readFileSync(f.p12));
  assert.ok(!sent('MACOS_SIGN_P12_BASE64').includes('\n'), 'base64 without line breaks');
  assert.equal(Buffer.from(sent('APPLE_API_KEY_P8_BASE64'), 'base64').toString(), fs.readFileSync(f.p8, 'utf8'));
  assert.equal(sent('MACOS_SIGN_P12_PASSWORD'), PASSWORD);
  assert.equal(sent('APPLE_API_KEY_ID'), KEY_ID);
  assert.equal(sent('APPLE_API_ISSUER_ID'), ISSUER);
  // Never as an argument: gh's command lines hold only names and the repository.
  const calls = f.calls();
  for (const name of NAMES) assert.ok(calls.includes(`secret set ${name} --repo blakeb056/six-degrees`));
  for (const value of [PASSWORD, KEY_ID, ISSUER]) assert.ok(!calls.includes(value), 'no value on a command line');
  // And never printed.
  const said = `${r.stdout}${r.stderr}`;
  for (const value of [PASSWORD, KEY_ID, ISSUER, sent('MACOS_SIGN_P12_BASE64').slice(0, 24), 'PRIVATE KEY']) {
    assert.ok(!said.includes(value), 'no value printed');
  }
  for (const name of NAMES) assert.match(r.stdout, new RegExp(`set ${name}`));
  assert.deepEqual(fs.readdirSync(f.dir).sort(), ['AuthKey_ZZ9TEST0KY.p8', 'bin', 'cert.p12', 'cert.pem', 'gh-calls', 'key.pem', 'sent'],
    'no file of its own left behind');
});

test('set-signing-secrets: a password that doesn\'t open the certificate is asked about, and "no" sets nothing; an empty one is refused', { skip: noOpenssl }, (t) => {
  const f = fixture(t);
  const wrong = f.run([f.p12, f.p8, KEY_ID, ISSUER], 'not the password\nn\n');
  assert.equal(wrong.status, 1);
  assert.match(wrong.stderr, /Nothing was set/);
  assert.ok(!`${wrong.stdout}${wrong.stderr}`.includes('not the password'));
  assert.deepEqual(f.set(), []);
  const empty = f.run([f.p12, f.p8, KEY_ID, ISSUER], '\n');
  assert.equal(empty.status, 1);
  assert.match(empty.stderr, /No password given/);
  assert.deepEqual(f.set(), []);
});

// ── ci-mac-signing.sh ──

function ciRun(t, args, secrets = {}) {
  const runnerTemp = fs.mkdtempSync(path.join(os.tmpdir(), 'six-degrees-ci-'));
  t.after(() => fs.rmSync(runnerTemp, { recursive: true, force: true }));
  const genv = path.join(runnerTemp, 'github-env');
  fs.writeFileSync(genv, '');
  const r = spawnSync('bash', [CI, ...args], {
    encoding: 'utf8',
    env: { PATH: `${path.dirname(process.execPath)}:/usr/bin:/bin`, HOME: runnerTemp, RUNNER_TEMP: runnerTemp, GITHUB_ENV: genv, ...secrets },
  });
  return { ...r, env: fs.readFileSync(genv, 'utf8'), work: path.join(runnerTemp, 'six-degrees-signing'), runnerTemp };
}

const SECRETS = {
  MACOS_SIGN_P12_BASE64: Buffer.from('invented certificate bytes').toString('base64'),
  MACOS_SIGN_P12_PASSWORD: 'invented-p12-password',
  APPLE_API_KEY_P8_BASE64: Buffer.from('not a key at all').toString('base64'),
  APPLE_API_KEY_ID: KEY_ID,
  APPLE_API_ISSUER_ID: ISSUER,
};

test('ci-mac-signing: no secrets before 1.0, or on a dry run: ad hoc, and no keychain', (t) => {
  for (const args of [['setup', '0.9.0', 'false'], ['setup', '1.0.0', 'true']]) {
    const r = ciRun(t, args);
    assert.equal(r.status, 0, r.stderr);
    assert.equal(r.env.trim(), 'MAC_SIGNING=ad-hoc');
    assert.equal(fs.existsSync(r.work), false);
  }
});

test('ci-mac-signing: a real 1.0.0 release without the secrets fails before the build, naming them', (t) => {
  const r = ciRun(t, ['setup', '1.0.0', 'false']);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /must be signed and notarized/);
  assert.match(r.stdout, /::error::/);
  assert.equal(r.env, '');
});

test('ci-mac-signing: some secrets but not all fail, naming only what is missing, printing no value', (t) => {
  const r = ciRun(t, ['setup', '0.9.0', 'true'], { MACOS_SIGN_P12_PASSWORD: SECRETS.MACOS_SIGN_P12_PASSWORD, APPLE_API_KEY_ID: KEY_ID });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /Missing: MACOS_SIGN_P12_BASE64, APPLE_API_KEY_P8_BASE64, APPLE_API_ISSUER_ID/);
  for (const value of [SECRETS.MACOS_SIGN_P12_PASSWORD, KEY_ID]) assert.ok(!`${r.stdout}${r.stderr}`.includes(value));
});

test('ci-mac-signing: an API key that isn\'t one stops it before the keychain; cleanup leaves nothing', (t) => {
  const r = ciRun(t, ['setup', '1.0.0', 'false'], SECRETS);
  assert.equal(r.status, 1);
  assert.match(r.stdout, /APPLE_API_KEY_P8_BASE64 doesn't decode to an App Store Connect API key/);
  for (const value of Object.values(SECRETS)) assert.ok(!`${r.stdout}${r.stderr}`.includes(value), 'no value printed');
  assert.equal(fs.statSync(r.work).mode & 0o777, 0o700, 'its folder is the runner user\'s alone');
  assert.equal(fs.statSync(path.join(r.work, 'cert.p12')).mode & 0o777, 0o600);
  const done = spawnSync('bash', [CI, 'cleanup'], { encoding: 'utf8', env: { PATH: '/usr/bin:/bin', RUNNER_TEMP: r.runnerTemp } });
  assert.equal(done.status, 0, done.stderr);
  assert.equal(fs.existsSync(r.work), false);
});

test('ci-mac-signing: cleanup with nothing set up is fine; anything else is a usage error', (t) => {
  const runnerTemp = fs.mkdtempSync(path.join(os.tmpdir(), 'six-degrees-ci-'));
  t.after(() => fs.rmSync(runnerTemp, { recursive: true, force: true }));
  assert.equal(spawnSync('bash', [CI, 'cleanup'], { env: { PATH: '/usr/bin:/bin', RUNNER_TEMP: runnerTemp } }).status, 0);
  assert.equal(spawnSync('bash', [CI, 'sign'], { env: { PATH: '/usr/bin:/bin', RUNNER_TEMP: runnerTemp } }).status, 2);
});
