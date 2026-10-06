// Whether macOS lets Sixgree manage apps (System Settings → Privacy & Security
// → App Management), read for real. Blake, 2026-10-06: the guided setup's App
// Management row is mandatory from macOS 13, and Continue waits until it is
// actually on, not until someone says so.
//
// macOS has no public call for this one. TCC's own preflight does it, the
// question tccd answers without asking the user: TCCAccessPreflight(service)
// from /System/Library/PrivateFrameworks/TCC.framework, through JavaScript for
// Automation, which every Mac has (osascript). It is asked by a child of the
// server, which macOS puts down to the app the server was started from: the
// Mac app, or Terminal for npx, the same app it names when Chrome updates
// (lib/scanner-setup.js appManagementStep). Nothing is changed and nothing is
// prompted; it only reads.
//
// When it can't be read (no osascript, the framework gone, an answer this
// doesn't know), the answer is { granted: null, why }, never false: a check
// that can't run must say so, not pass for "off" (TRAPS §7), and the setup
// then takes the user's word for it (lib/onboarding.js appManagementGate).

import { execFile } from 'node:child_process';

export const APP_MANAGEMENT_SERVICE = 'kTCCServiceSystemPolicyAppBundles';

// TCCAccessPreflight answers 0 for allowed, 1 for denied, 2 for never asked.
export const PREFLIGHT_SCRIPT = `function run() {
  ObjC.import('Foundation');
  var tcc = $.NSBundle.bundleWithPath('/System/Library/PrivateFrameworks/TCC.framework');
  if (!tcc || !tcc.load) return 'no-tcc';
  ObjC.bindFunction('TCCAccessPreflight', ['int', ['id', 'id']]);
  return String($.TCCAccessPreflight($('${APP_MANAGEMENT_SERVICE}'), $()));
}`;

/** osascript's answer, read: { granted: true | false | null, why }. */
export function readPreflight(out) {
  const text = String(out ?? '').trim();
  if (text === '0') return { granted: true, why: null };
  if (text === '1' || text === '2') return { granted: false, why: null };
  if (text === 'no-tcc') return { granted: null, why: 'macOS’s privacy framework could not be loaded on this Mac.' };
  return { granted: null, why: `macOS gave an answer Sixgree doesn’t know (${text.slice(0, 40) || 'nothing'}).` };
}

function osascript(script) {
  return new Promise((resolve, reject) => {
    execFile('/usr/bin/osascript', ['-l', 'JavaScript', '-e', script], { timeout: 5000 }, (err, stdout) => {
      if (err) reject(err);
      else resolve(stdout);
    });
  });
}

const CACHE_MS = 1000;
let last = null; // { at, promise }
const logged = new Set();

/**
 * Is App Management on for Sixgree? { needed, granted, why }.
 *   needed   false off a Mac and before macOS 13 (no App Management there): nothing to ask
 *   granted  true or false, read from macOS; null when it couldn't be read, with `why`
 * Asked at most once a second however many windows poll (the setup asks every 2 s).
 * `run` and `now` are for tests.
 */
export async function checkAppManagement({ platform = process.platform, version = null, run = osascript, now = Date.now(), log = console.warn } = {}) {
  if (platform !== 'darwin' || (version != null && version < 13)) return { needed: false, granted: null, why: null };
  if (run === osascript && last && now - last.at < CACHE_MS) return last.promise;
  const promise = (async () => {
    let answer;
    try {
      answer = readPreflight(await run(PREFLIGHT_SCRIPT));
    } catch (err) {
      answer = { granted: null, why: `The check could not run (${String(err?.message || err).split('\n')[0].slice(0, 120)}).` };
    }
    if (answer.granted === null && !logged.has(answer.why)) {
      logged.add(answer.why);
      log(`App Management: can't tell whether it's on, so the setup takes the user's word for it. ${answer.why}`);
    }
    return { needed: true, ...answer };
  })();
  if (run === osascript) last = { at: now, promise };
  return promise;
}
