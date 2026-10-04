#!/usr/bin/env node
// Signing and notarizing the Mac app (docs/brain/DESKTOP.md D4). Used by
// scripts/build-app.mjs, and by scripts/ci-mac-signing.sh through the
// `release-plan` command at the bottom.
//
// Two ways, chosen by the environment (signingSetup):
//
//   ad hoc         no identity. Exactly what every build did before D4, and what
//                  forks, pull requests and local builds without a certificate
//                  still do: build-app.mjs runs its own `codesign --sign -` lines,
//                  untouched. Nothing in this file runs for it.
//   Developer ID   SIX_DEGREES_SIGN_IDENTITY names a "Developer ID Application"
//                  identity (its name or its SHA-1), SIX_DEGREES_SIGN_KEYCHAIN
//                  optionally the keychain holding it. Every program and library
//                  is signed on its own, inside out, never with --deep: codesign's
//                  --deep signs nested bundles but not the loose programs and
//                  libraries in Resources (the server's Node, the scanner's
//                  Python, native modules), and it gives everything the same
//                  entitlements. Each signature has the hardened runtime and a
//                  secure timestamp, both of which Apple's notary requires.
//
// Notarization, on top of Developer ID, when SIX_DEGREES_NOTARY_KEY (the path to
// an App Store Connect API key, AuthKey_….p8), SIX_DEGREES_NOTARY_KEY_ID and
// SIX_DEGREES_NOTARY_ISSUER are all set: notarytool submits, waits for Apple's
// answer, and on a refusal fetches Apple's log and prints its issues.
//
// The decisions are pure functions at the top (tests/mac-sign.test.mjs); the
// work below them runs codesign, notarytool, stapler and spctl. Nothing here
// ever prints a credential: notarytool's command line holds the key's id and
// issuer, so its errors are never shown as Node builds them ("Command failed:
// xcrun notarytool … --key-id …"), only its own output, with those values
// replaced by *** (scrub).

import { spawnSync, execFileSync } from 'node:child_process';
import {
  readdirSync, existsSync, openSync, readSync, closeSync, statSync,
} from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));

/** The GitHub Actions secrets the release workflow signs with (scripts/set-signing-secrets.sh sets them). */
export const SECRET_NAMES = Object.freeze([
  'MACOS_SIGN_P12_BASE64',
  'MACOS_SIGN_P12_PASSWORD',
  'APPLE_API_KEY_P8_BASE64',
  'APPLE_API_KEY_ID',
  'APPLE_API_ISSUER_ID',
]);

const NOTARY_VARS = Object.freeze(['SIX_DEGREES_NOTARY_KEY', 'SIX_DEGREES_NOTARY_KEY_ID', 'SIX_DEGREES_NOTARY_ISSUER']);

/**
 * The entitlements, by who needs them. Only main executables carry
 * entitlements; libraries get the hardened runtime and nothing else.
 *
 *   electron  the app and its helper apps: Electron's V8 compiles JavaScript as
 *             it runs, which the hardened runtime refuses without allow-jit
 *             (and allow-unsigned-executable-memory, which V8 still uses on
 *             Intel Macs).
 *   node      the server's Node, and Playwright's driver when it has a Node of
 *             its own: the same V8. Checked here: Node 24 signed with the
 *             hardened runtime and no entitlements stops at once with "Failed
 *             to reserve virtual memory for CodeRange".
 *
 * Nobody gets com.apple.security.cs.disable-library-validation. Library
 * validation lets a program load only libraries signed by Apple or by the same
 * team, and every library in the app is signed here by the same identity: the
 * Electron framework, the Python's extension modules, sharp's .node and its
 * libvips. The app never loads a library from outside itself: the scanner's
 * own environment (Install, Set up the scanner) is built from this computer's
 * Python or a downloaded one, never from the app's (lib/scanner-python.js
 * installSteps), so no pip-installed module is ever loaded by a program here.
 *
 * The scanner's Python gets none: CPython doesn't compile code at run time, and
 * the scanner and its packages don't make executable memory (no ctypes
 * callbacks). build-app.mjs runs it under the hardened runtime after signing
 * (checkSignedRuntime), so a missing entitlement fails the build, not a scan.
 */
export const ENTITLEMENTS = Object.freeze({
  electron: path.join(HERE, 'entitlements', 'electron.plist'),
  node: path.join(HERE, 'entitlements', 'node.plist'),
});

export class SigningError extends Error {}

const blank = (v) => v === undefined || v === null || String(v).trim() === '';

/**
 * How this build signs, from the environment: { mode: 'ad-hoc' }, or
 * { mode: 'developer-id', identity, keychain, notary } with notary null or
 * { key, keyId, issuer }, or { error } for a setting that can't be right.
 * `exists` checks a path (the key file, the keychain).
 */
export function signingSetup(env = {}, { exists = () => true } = {}) {
  const identity = String(env.SIX_DEGREES_SIGN_IDENTITY ?? '').trim();
  const keychain = String(env.SIX_DEGREES_SIGN_KEYCHAIN ?? '').trim();
  const notarySet = NOTARY_VARS.filter((name) => !blank(env[name]));
  if (notarySet.length && notarySet.length < NOTARY_VARS.length) {
    const missing = NOTARY_VARS.filter((name) => blank(env[name]));
    return { error: `Notarization needs ${NOTARY_VARS.join(', ')}; ${missing.join(' and ')} ${missing.length > 1 ? 'are' : 'is'} not set.` };
  }
  if (!identity || identity === '-') {
    if (notarySet.length) {
      return { error: 'Notarization needs a Developer ID signature, and SIX_DEGREES_SIGN_IDENTITY is not set (an ad hoc signature is never notarized).' };
    }
    return { mode: 'ad-hoc' };
  }
  if (keychain && !exists(keychain)) {
    return { error: `SIX_DEGREES_SIGN_KEYCHAIN names a keychain that isn't there (${keychain}).` };
  }
  let notary = null;
  if (notarySet.length) {
    const key = String(env.SIX_DEGREES_NOTARY_KEY).trim();
    // The key's path is said, never its contents: the path is no secret.
    if (!exists(key)) return { error: `SIX_DEGREES_NOTARY_KEY names a file that isn't there (${key}).` };
    notary = { key, keyId: String(env.SIX_DEGREES_NOTARY_KEY_ID).trim(), issuer: String(env.SIX_DEGREES_NOTARY_ISSUER).trim() };
  }
  return { mode: 'developer-id', identity, keychain: keychain || null, notary };
}

/** The major version, from "1.2.3" or "v1.2.3-beta.1"; NaN when there isn't one. */
function majorOf(version) {
  const m = String(version ?? '').trim().replace(/^v/i, '').match(/^(\d+)\./);
  return m ? Number(m[1]) : Number.NaN;
}

/**
 * Must this release be signed and notarized? A real release (a tag, not a dry
 * run) of 1.0.0 or later, its betas included: from 1.0 the download pages say
 * it's signed, so a release must never quietly go out without it. Before 1.0,
 * and on any dry run, a build without the secrets is signed ad hoc as before.
 */
export function signingRequired({ version, dryRun }) {
  if (dryRun) return false;
  const major = majorOf(version);
  return !Number.isFinite(major) || major >= 1;
}

/**
 * What the release workflow does about signing (scripts/ci-mac-signing.sh):
 * { sign: true } with all five secrets, { sign: false, note } with none when it
 * may build ad hoc, or { error } (names only, never a value): some secrets but
 * not all is always a mistake, and none at all when signing is required.
 * `present` lists the secrets that are set and not empty.
 */
export function releaseSigningPlan({ version, dryRun, present = [] }) {
  const have = new Set(present);
  const missing = SECRET_NAMES.filter((name) => !have.has(name));
  const required = signingRequired({ version, dryRun });
  if (!missing.length) return { sign: true, required };
  if (missing.length < SECRET_NAMES.length) {
    return {
      error: `Some of the Mac signing secrets are set and some aren't. Missing: ${missing.join(', ')}. `
        + 'Set all five (scripts/set-signing-secrets.sh), or none.',
      required,
    };
  }
  if (required) {
    return {
      error: `Version ${version} must be signed and notarized (every real release from 1.0.0 on is), and the signing secrets `
        + `aren't set: ${SECRET_NAMES.join(', ')}. Set them with scripts/set-signing-secrets.sh, or do a dry run.`,
      required,
    };
  }
  return {
    sign: false,
    required,
    note: `No signing secrets, so the Mac app is signed ad hoc, as before (fine for ${dryRun ? 'a dry run' : `${version}, before 1.0`}).`,
  };
}

/** codesign's arguments for a Developer ID signature: hardened runtime, secure timestamp, never --deep. */
export function codesignArgs(setup, { entitlements = null, runtime = true } = {}) {
  return [
    '--force',
    '--sign', setup.identity,
    '--timestamp',
    ...(runtime ? ['--options', 'runtime'] : []),
    ...(setup.keychain ? ['--keychain', setup.keychain] : []),
    ...(entitlements ? ['--entitlements', entitlements] : []),
  ];
}

const BUNDLE_EXTENSIONS = ['.app', '.framework', '.xpc', '.appex'];
const MH_EXECUTE = 2;
const MH_DYLIB = 6;
const MH_BUNDLE = 8;

/**
 * The bundle a file is the executable of, relative to the app ('' for the app
 * itself), or null when it isn't one: `X.app/Contents/MacOS/<name>`, or
 * `F.framework/Versions/<v>/F`. codesign treats such a file as its bundle, so it
 * is signed when its bundle is, with the bundle's entitlements.
 */
export function bundleOfExecutable(rel) {
  const app = rel.match(/^(?:(.*\.app)\/)?Contents\/MacOS\/[^/]+$/);
  if (app) return app[1] || '';
  const fw = rel.match(/^(.*\/)?(([^/]+)\.framework)\/Versions\/[^/]+\/([^/]+)$/);
  if (fw && fw[3] === fw[4]) return `${fw[1] || ''}${fw[2]}`;
  return null;
}

/**
 * The order and entitlements for signing an app, from what is in it. `entries`
 * are paths relative to the app: { rel, kind: 'file', fileType } for each
 * Mach-O file (fileType from its header: 2 a program, 6 a library, 8 a
 * loadable module such as a Python extension or a .node), and
 * { rel, kind: 'bundle' } for each code bundle inside (helper apps,
 * frameworks). `mainIsMachO`: the app's own executable is a program (Electron)
 * rather than a script (the classic launcher).
 *
 * Inside out: every loose program and library first (they depend on nothing
 * around them), then the bundles, deepest first, so everything inside a bundle
 * is signed before the bundle seals it, then the app last. A bundle's own
 * executable is signed with its bundle, with the bundle's entitlements.
 * Returns { files: [{ rel, entitlements }], bundles: [{ rel, entitlements }],
 * app: { entitlements } }, entitlements being a key of ENTITLEMENTS or null.
 */
export function signingPlan(entries, { mainIsMachO = true } = {}) {
  const depth = (rel) => rel.split('/').length;
  const files = [];
  const bundles = [];
  const bundleSet = new Set(entries.filter((e) => e.kind === 'bundle').map((e) => e.rel));
  const signedWithBundle = (rel) => {
    const root = bundleOfExecutable(rel);
    return root === '' || (root !== null && bundleSet.has(root));
  };
  for (const e of entries) {
    if (e.kind === 'bundle') {
      bundles.push({ rel: e.rel, entitlements: e.rel.endsWith('.app') ? 'electron' : null });
    } else if (e.kind === 'file' && [MH_EXECUTE, MH_DYLIB, MH_BUNDLE].includes(e.fileType) && !signedWithBundle(e.rel)) {
      const program = e.fileType === MH_EXECUTE;
      files.push({ rel: e.rel, entitlements: program && path.posix.basename(e.rel) === 'node' ? 'node' : null });
    }
  }
  bundles.sort((a, b) => depth(b.rel) - depth(a.rel) || a.rel.localeCompare(b.rel));
  files.sort((a, b) => depth(b.rel) - depth(a.rel) || a.rel.localeCompare(b.rel));
  return { files, bundles, app: { entitlements: mainIsMachO ? 'electron' : null } };
}

/**
 * spctl's verdict, from its -vvv output: { accepted, source, origin, disabled }.
 * `disabled`: Gatekeeper's assessments are turned off on this machine
 * ("override=security disabled"), so its "accepted" says nothing about the app.
 */
export function parseSpctl(text) {
  const s = String(text || '');
  return {
    accepted: /: accepted\s*$/m.test(s),
    source: (s.match(/^source=(.+)$/m) || [null, null])[1]?.trim() || null,
    origin: (s.match(/^origin=(.+)$/m) || [null, null])[1]?.trim() || null,
    disabled: /^override=security disabled\s*$/m.test(s),
  };
}

/** notarytool's --output-format json answer: { id, status, message }, or null. */
export function parseNotaryJson(text) {
  const s = String(text || '');
  const start = s.indexOf('{');
  const end = s.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    const j = JSON.parse(s.slice(start, end + 1));
    if (!j || typeof j !== 'object') return null;
    return { id: typeof j.id === 'string' ? j.id : null, status: typeof j.status === 'string' ? j.status : null, message: typeof j.message === 'string' ? j.message : null };
  } catch {
    return null;
  }
}

/** The lines worth printing from a notarization log (`notarytool log`, JSON): one per issue, at most `max`. */
export function notaryIssueLines(log, { max = 40 } = {}) {
  if (!log || typeof log !== 'object') return ['(Apple sent no readable log)'];
  const issues = Array.isArray(log.issues) ? log.issues : [];
  const lines = [];
  if (log.statusSummary) lines.push(String(log.statusSummary));
  for (const issue of issues.slice(0, max)) {
    if (!issue || typeof issue !== 'object') continue;
    const where = [issue.path, issue.architecture ? `(${issue.architecture})` : ''].filter(Boolean).join(' ');
    lines.push(`${issue.severity || 'issue'}: ${where ? `${where}: ` : ''}${issue.message || 'no message'}`);
  }
  if (issues.length > max) lines.push(`… and ${issues.length - max} more`);
  if (!issues.length && !lines.length) lines.push('(no issues listed)');
  return lines;
}

/** `text` with every one of `secrets` (four characters or longer) replaced by ***. */
export function scrub(text, secrets = []) {
  let s = String(text ?? '');
  for (const secret of secrets) {
    const v = String(secret ?? '');
    if (v.length >= 4) s = s.split(v).join('***');
  }
  return s;
}

/** From `codesign -dv --verbose=2`: { authority, team, runtime, timestamp }. */
export function parseCodesignInfo(text) {
  const s = String(text || '');
  const team = (s.match(/^TeamIdentifier=(.+)$/m) || [null, null])[1]?.trim() || null;
  return {
    authority: (s.match(/^Authority=(.+)$/m) || [null, null])[1]?.trim() || null,
    team: team && team !== 'not set' ? team : null,
    runtime: /flags=0x[0-9a-f]+\([^)]*runtime[^)]*\)/.test(s),
    timestamp: /^Timestamp=/m.test(s),
  };
}

/** "Developer ID Application: Blake Burford (TEAMID)" → "Blake Burford". */
export function signerName(authority) {
  return String(authority || '').replace(/^Developer ID Application:\s*/, '').replace(/\s*\([A-Z0-9]+\)\s*$/, '').trim() || null;
}

// ── the work ────────────────────────────────────────────────────────────────

/** A command's output, captured, never thrown: { status, stdout, stderr }. */
function capture(cmd, args, { env = process.env } = {}) {
  const r = spawnSync(cmd, args, { env, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  return { status: r.error ? null : r.status, stdout: r.stdout || '', stderr: r.error ? String(r.error.message) : (r.stderr || '') };
}

function pause(seconds) {
  if (seconds > 0) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, seconds * 1000);
}

const lastLines = (text, n = 6) => String(text || '').trim().split('\n').slice(-n).join(' | ');

function readHead(file, offset, length) {
  const fd = openSync(file, 'r');
  try {
    const buf = Buffer.alloc(length);
    const n = readSync(fd, buf, 0, length, offset);
    return buf.subarray(0, n);
  } finally {
    closeSync(fd);
  }
}

/** A Mach-O file's type (2 program, 6 library, 8 loadable module, …), or null when it isn't one. Universal files by their first slice. */
export function machoFileType(file) {
  let head;
  try {
    if (statSync(file).size < 32) return null;
    head = readHead(file, 0, 32);
  } catch {
    return null;
  }
  const le = head.readUInt32LE(0);
  if (le === 0xfeedfacf || le === 0xfeedface) return head.readUInt32LE(12);
  const be = head.readUInt32BE(0);
  if (be !== 0xcafebabe && be !== 0xcafebabf) return null;
  const count = head.readUInt32BE(4);
  if (count < 1 || count > 16) return null;  // a Java class file starts with the same bytes
  const offset = be === 0xcafebabf ? Number(head.readBigUInt64BE(16)) : head.readUInt32BE(16);
  try {
    const slice = readHead(file, offset, 16);
    const m = slice.readUInt32LE(0);
    return m === 0xfeedfacf || m === 0xfeedface ? slice.readUInt32LE(12) : null;
  } catch {
    return null;
  }
}

/** Is `dir` a code bundle codesign signs as one (a helper app, a framework)? */
function isCodeBundle(dir) {
  if (!BUNDLE_EXTENSIONS.some((ext) => dir.endsWith(ext))) return false;
  return [['Contents', 'Info.plist'], ['Resources', 'Info.plist'], ['Versions', 'Current']]
    .some((p) => existsSync(path.join(dir, ...p)));
}

/**
 * What is in the app, for signingPlan: every Mach-O regular file and every code
 * bundle below it. Links aren't followed, so each file is seen once, at its
 * real place (a framework's Versions/Current, Playwright's driver's link to
 * the app's Node).
 */
export function findCode(app) {
  const entries = [];
  const visit = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const at = path.join(dir, entry.name);
      const rel = path.relative(app, at).split(path.sep).join('/');
      if (entry.isDirectory()) {
        if (isCodeBundle(at)) entries.push({ rel, kind: 'bundle' });
        visit(at);
      } else if (entry.isFile()) {
        const fileType = machoFileType(at);
        if (fileType !== null) entries.push({ rel, kind: 'file', fileType });
      }
    }
  };
  visit(app);
  return entries;
}

/**
 * Sign `app` with the Developer ID in `setup`, inside out (signingPlan), then
 * check it the way release.yml and the in-app updater do. `entitlementsFiles`
 * maps signingPlan's keys to plist files (ENTITLEMENTS; a test can pass its
 * own). Prints one line per stage; codesign's own errors stop the build.
 */
export function signDeveloperId(app, setup, { entitlementsFiles = ENTITLEMENTS, log = console.log, env = process.env } = {}) {
  const exe = (() => {
    try {
      const name = execFileSync('/usr/bin/plutil', ['-extract', 'CFBundleExecutable', 'raw', '-o', '-', path.join(app, 'Contents', 'Info.plist')]).toString().trim();
      return path.join(app, 'Contents', 'MacOS', name);
    } catch {
      return null;
    }
  })();
  const mainIsMachO = Boolean(exe && machoFileType(exe) === MH_EXECUTE);
  const plan = signingPlan(findCode(app), { mainIsMachO });
  const ent = (key) => (key ? entitlementsFiles[key] : null);
  for (const key of new Set([...plan.files, ...plan.bundles, plan.app].map((p) => p.entitlements).filter(Boolean))) {
    if (!existsSync(ent(key))) throw new SigningError(`The ${key} entitlements file is missing (${ent(key)}).`);
  }
  const sign = (paths, entitlements) => {
    // Up to 32 at a time; each still gets its own timestamp from Apple. Its
    // only chatter is "replacing existing signature", once a file: shown only
    // with a failure, without those lines.
    for (let i = 0; i < paths.length; i += 32) {
      const r = capture('codesign', [...codesignArgs(setup, { entitlements: ent(entitlements) }), ...paths.slice(i, i + 32)], { env });
      if (r.status !== 0) {
        const why = r.stderr.split('\n').filter((l) => l.trim() && !/replacing existing signature$/.test(l)).slice(-6).join('\n    ');
        throw new SigningError(`codesign failed:\n    ${why || `exit ${r.status}`}`);
      }
    }
  };
  // Loose programs and libraries, grouped by their entitlements (their order
  // among themselves doesn't matter: none contains another).
  for (const key of [null, 'node', 'electron']) {
    const group = plan.files.filter((f) => f.entitlements === key).map((f) => path.join(app, f.rel));
    if (group.length) sign(group, key);
  }
  log(`  signed ${plan.files.length} programs and libraries one by one (${plan.files.filter((f) => f.entitlements).length} with entitlements)`);
  for (const b of plan.bundles) sign([path.join(app, b.rel)], b.entitlements);
  if (plan.bundles.length) log(`  then ${plan.bundles.length} nested bundles, deepest first: ${plan.bundles.map((b) => path.basename(b.rel)).join(', ')}`);
  sign([app], plan.app.entitlements);
  const verify = capture('codesign', ['--verify', '--deep', '--strict', app], { env });
  if (verify.status !== 0) throw new SigningError(`The signed app doesn't verify: ${lastLines(verify.stderr)}`);
  const info = parseCodesignInfo(capture('codesign', ['-dv', '--verbose=2', app], { env }).stderr);
  if (!info.runtime) throw new SigningError('The app was signed without the hardened runtime.');
  log(`  then the app: ${info.authority || setup.identity}${info.team ? `, team ${info.team}` : ''}, hardened runtime${info.timestamp ? ', timestamped' : ''}; verified`);
  return { plan, info };
}

/** The signer of a signed file or app, from codesign: { authority, team, runtime, timestamp }. */
export function signatureInfo(file, { env = process.env } = {}) {
  return parseCodesignInfo(capture('codesign', ['-dv', '--verbose=2', file], { env }).stderr);
}

/** Sign a disk image with the Developer ID (no runtime: that is for programs). */
export function signImage(image, setup, { env = process.env } = {}) {
  const r = capture('codesign', [...codesignArgs(setup, { runtime: false }), image], { env });
  if (r.status !== 0) throw new SigningError(`codesign couldn't sign ${path.basename(image)}: ${lastLines(r.stderr)}`);
  const v = capture('codesign', ['--verify', '--strict', image], { env });
  if (v.status !== 0) throw new SigningError(`${path.basename(image)}'s signature doesn't verify: ${lastLines(v.stderr)}`);
}

/**
 * Notarize `file` (a zip of the app, or the signed disk image): submit, wait
 * for Apple's answer, and return { id, status } once it is Accepted. On any
 * other answer, Apple's log for the submission is fetched and its issues
 * printed, and a SigningError is thrown. A submission that never got an id
 * (the network, Apple's service) is tried again, `attempts` times in all.
 */
export function notarize(file, notary, {
  env = process.env, log = console.log, what = path.basename(file), attempts = 3, retrySeconds = 30, timeout = '1h',
} = {}) {
  const creds = ['--key', notary.key, '--key-id', notary.keyId, '--issuer', notary.issuer];
  const secrets = [notary.keyId, notary.issuer, notary.key];
  let result = null;
  let problem = '';
  for (let i = 1; i <= attempts; i++) {
    const r = capture('xcrun', ['notarytool', 'submit', file, ...creds, '--wait', '--timeout', timeout, '--output-format', 'json'], { env });
    const parsed = parseNotaryJson(r.stdout);
    if (parsed?.id && parsed.status) {
      result = parsed;
      break;
    }
    problem = scrub(lastLines(r.stderr) || lastLines(r.stdout) || `exit ${r.status}`, secrets);
    log(`  notarytool couldn't submit ${what} (try ${i} of ${attempts}): ${problem}`);
    if (i < attempts) pause(retrySeconds);
  }
  if (!result) throw new SigningError(`Apple's notary service didn't take ${what}: ${problem}`);
  log(`  ${what}: submission ${result.id}, ${result.status}`);
  if (result.status === 'Accepted') return result;
  const l = capture('xcrun', ['notarytool', 'log', result.id, ...creds], { env });
  let logJson = null;
  try { logJson = JSON.parse(l.stdout); } catch { /* said below */ }
  log(`  Apple's log for ${result.id}:`);
  for (const line of notaryIssueLines(logJson)) log(`    ${scrub(line, secrets)}`);
  if (!logJson && (l.stderr || l.stdout)) log(`    ${scrub(lastLines(l.stderr || l.stdout), secrets)}`);
  throw new SigningError(`Apple didn't notarize ${what} (${result.status}${result.message ? `: ${scrub(result.message, secrets)}` : ''}). Its issues are listed above.`);
}

/**
 * Staple the notarization ticket to `file` (the app, or the disk image) and
 * validate it. Right after a submission is accepted, Apple's ticket can take a
 * moment to be served ("Record not found"), so it is tried a few times.
 */
export function staple(file, { env = process.env, log = console.log, attempts = 5, retrySeconds = 20 } = {}) {
  let last = '';
  for (let i = 1; i <= attempts; i++) {
    const r = capture('xcrun', ['stapler', 'staple', file], { env });
    if (r.status === 0) {
      const v = capture('xcrun', ['stapler', 'validate', file], { env });
      if (v.status === 0) return;
      last = lastLines(v.stderr || v.stdout);
    } else {
      last = lastLines(r.stderr || r.stdout);
    }
    log(`  stapling ${path.basename(file)} didn't work yet (try ${i} of ${attempts}): ${last}`);
    if (i < attempts) pause(retrySeconds);
  }
  throw new SigningError(`Couldn't staple the notarization ticket to ${path.basename(file)}: ${last}`);
}

/** Does `file` carry a valid stapled ticket? */
export function stapleValid(file, { env = process.env } = {}) {
  return capture('xcrun', ['stapler', 'validate', file], { env }).status === 0;
}

/**
 * What Gatekeeper says about `file`: an app ('exec') or a disk image ('open',
 * judged by its own signature). { ok, accepted, source, origin, disabled, text },
 * ok when it is accepted as "Notarized Developer ID". `disabled` when this
 * machine has Gatekeeper's assessments turned off and so can't say: the caller
 * then has only the stapled ticket to go on, and says so.
 */
export function assess(file, type, { env = process.env } = {}) {
  const args = type === 'exec'
    ? ['-a', '-vvv', '-t', 'exec', file]
    : ['-a', '-vvv', '-t', 'open', '--context', 'context:primary-signature', file];
  const r = capture('spctl', args, { env });
  const text = `${r.stdout}\n${r.stderr}`.trim();
  const v = parseSpctl(text);
  return { ...v, ok: r.status === 0 && v.accepted && v.source === 'Notarized Developer ID', text };
}

// ── release.yml's question: sign this release, or not? ─────────────────────
//
//   node scripts/mac-sign.mjs release-plan <version> <dry-run: true|false>
//
// Reads only whether each of SECRET_NAMES is set (never a value). Prints
// "developer-id" or "ad-hoc" and exits 0, or says why not and exits 1.
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [command, version, dry] = process.argv.slice(2);
  if (command !== 'release-plan' || !version) {
    console.error('usage: node scripts/mac-sign.mjs release-plan <version> <dry-run: true|false>');
    process.exit(2);
  }
  const present = SECRET_NAMES.filter((name) => !blank(process.env[name]));
  const plan = releaseSigningPlan({ version, dryRun: dry === 'true', present });
  if (plan.error) {
    console.error(plan.error);
    process.exit(1);
  }
  if (plan.note) console.error(plan.note);
  console.log(plan.sign ? 'developer-id' : 'ad-hoc');
}
