// What the Scan page's first step says and offers, from the checks GET
// /api/scraper reports (app/api/scraper/route.js, lib/scanner-python.js),
// its optional item on a Mac about macOS's App Management question
// (appManagementStep), whether it asks for your field once your connections
// are in (askForField), and two answers the server gives that step: is Google
// Chrome here (chromeInstalled), and are you signed in to LinkedIn (signedInFrom).
// Plain data in, plain data out: the page draws it, and
// tests/scanner-setup.test.mjs checks every state without a browser. No Node
// imports here; the page runs in the browser.

const MB = 1024 * 1024;

// The scanner drives Google Chrome (scripts/scrape.py, channel "chrome"), so a
// computer without it can set up the scanner's Python and still never scan.
// It used to be a red box above the steps while step 1 said Ready; now step 1
// isn't done without it, and the server refuses anything that opens LinkedIn
// with the same words (app/api/scraper/route.js).
export const CHROME_DOWNLOAD = 'https://www.google.com/chrome/';
export const CHROME_MISSING = 'The scanner works in Google Chrome, and Chrome isn’t on this computer.';
export const CHROME_BUTTON = 'Install Google Chrome, then come back';
export const CHROME_REFUSAL = `${CHROME_MISSING} ${CHROME_BUTTON}.`;

/**
 * Is Google Chrome where Playwright's "chrome" channel looks for it (Chromium
 * doesn't count)? `exists` is the file check (existsSync on the server), so
 * this runs in a test with no Chrome at all.
 *
 * SIX_DEGREES_TEST_CHROME=found or =missing answers for the computer, for
 * tests and for checking the Scan page's states by eye: the route's tests then
 * don't depend on whether the machine running them has Chrome. Nothing in the
 * app sets it; any other value is ignored.
 */
export function chromeInstalled({ platform, env = {}, exists }) {
  const forced = env.SIX_DEGREES_TEST_CHROME;
  if (forced === 'found') return true;
  if (forced === 'missing') return false;
  if (platform === 'darwin') return exists('/Applications/Google Chrome.app');
  if (platform === 'linux') return exists('/opt/google/chrome/chrome');
  // On Windows, for this user, then for everyone.
  if (platform === 'win32') {
    return [env.LOCALAPPDATA, env.PROGRAMFILES, env['PROGRAMFILES(X86)']]
      .filter(Boolean)
      .some((root) => exists(`${String(root).replace(/[\\/]+$/, '')}\\Google\\Chrome\\Application\\chrome.exe`));
  }
  return true; // elsewhere Playwright resolves the channel itself
}

// The scanner's note that LinkedIn's session was confirmed (scripts/scrape.py
// SIGNED_IN_FILE): { signedIn, at }, written when the li_at cookie is seen past
// any sign-in wall, and set to false while it waits for you to sign in.
export const SIGNED_IN_FILE = 'signed-in.json';

/**
 * Step 2's "Signed in". It used to be "Chrome's cookie file exists", which is
 * true the moment the scanner's window first opens, so opening LinkedIn and
 * closing the window without signing in ticked the step. Now the scanner's own
 * note says it (`note`, the parsed SIGNED_IN_FILE, or null when there is none
 * or it can't be read), and only while its Chrome profile is still there
 * (`profile`): deleting that signs you out.
 *
 * A data folder from before the note existed has none, and there the old
 * check stands (`cookies`), so nobody already signed in is told they're signed
 * out; the next scan writes the note.
 */
export function signedInFrom({ note, profile, cookies }) {
  if (note && typeof note === 'object' && typeof note.signedIn === 'boolean') return note.signedIn && Boolean(profile);
  return Boolean(cookies);
}

/** "Python 3.9.6 is too old…": why a Python this computer has won't do, or ''. */
function whyNotThisPython(found) {
  if (!found?.version) return 'This computer has no Python the scanner can use.';
  const [major, minor] = String(found.version).split('.').map(Number);
  if (major === 3 && minor >= 10 && minor <= 14 && found.venv === false) {
    return `This computer's Python ${found.version} can't make the scanner's own environment (on Ubuntu or Debian, python3-venv isn't installed).`;
  }
  return `This computer has Python ${found.version}, and the scanner needs 3.10 to 3.14.`;
}

// The buttons' names when idle, for the line that says which one to use.
const BUTTON_NAMES = { install: 'Install', setup: 'Set up the scanner' };

/**
 * When the Python inside the Mac app didn't work: one plain line of its own
 * above the step, saying what happened and what to do. The server doesn't
 * start it again until it restarts (lib/scanner-python.js pythonLooker), so
 * a Python macOS refused to run can't bring macOS's alert back; this line is
 * what says so instead. null when the app's Python is fine, or there is none.
 */
function ownPythonNote(own, { done, button }) {
  if (own?.source !== 'bundled') return null;
  const blocked = /SIGKILL|code signature|not valid for use in process|quarantine|not permitted/i.test(own.problem || '');
  const parts = [`The Python that comes with the app didn't work (${own.problem}).`];
  if (blocked) parts.push('macOS may have blocked it.');
  if (own.retry === false) parts.push('Six Degrees won\'t try it again until you restart it.');
  if (done) parts.push('The scanner uses another Python on this computer instead.');
  else if (button) parts.push(`To scan now, use ${BUTTON_NAMES[button.action]} below: it gives the scanner a Python of its own in your data folder.`);
  else parts.push('To scan now, install Python 3.10 to 3.14 from python.org, then reload.');
  return parts.join(' ');
}

/**
 * Step 1, "Set up the scanner": { done, text, button, note, chrome }, where
 * button is { action: 'install'|'setup', label } or null (nothing to press),
 * note is a line to show above the step when the Python inside the app didn't
 * work (ownPythonNote), or null, and chrome is { label, href } when Google
 * Chrome isn't on this computer (the way to get it), or null.
 *
 *   ready        the app's own Python (nothing to install), one named by
 *                SIX_DEGREES_PYTHON, or the scanner's environment / a Python
 *                that already has the packages
 *   install      a Python to build the scanner's environment from: this
 *                computer's (3.10 to 3.14), or the one Set up downloaded
 *   setup        none, but a standalone Python for this computer is pinned:
 *                "Set up the scanner" downloads it, then installs
 *   neither      no Python and nothing to download for this computer
 *
 * Any of them without Chrome isn't done: the Python's part is said first if
 * there is one, then Chrome's. Only a definite "no Chrome" counts; a status
 * that couldn't say (none yet, or an older server's) leaves it out.
 */
export function setupStep(status) {
  const step = stepOnly(status);
  const note = ownPythonNote(status?.checks?.ownPython, step);
  if (status?.checks?.chrome !== false) return { ...step, note, chrome: null };
  return {
    ...step,
    done: false,
    // "Ready" or "Installed." would read as finished: with the Python done,
    // Chrome is all the step says.
    text: step.done ? CHROME_MISSING : `${step.text} ${CHROME_MISSING}`,
    note,
    chrome: { label: CHROME_BUTTON, href: CHROME_DOWNLOAD },
  };
}

function stepOnly(status) {
  const c = status?.checks || {};
  const label = (action, idle, busy) => (status?.running && status.action === action ? busy : idle);

  if (c.dependencies) {
    if (c.pythonSource === 'bundled') {
      return { done: true, text: 'Ready. The scanner and its Python come with the app, so there is nothing to install.', button: null };
    }
    if (c.pythonSource === 'custom') {
      return { done: true, text: `Ready, on the Python named in SIX_DEGREES_PYTHON (${c.pythonPath}).`, button: null };
    }
    return { done: true, text: 'Installed.', button: null };
  }

  // A Python named in SIX_DEGREES_PYTHON that didn't work is said in the step
  // itself. The one inside the app gets a line of its own (ownPythonNote).
  const own = c.ownPython && c.ownPython.source !== 'bundled'
    ? `The Python named in SIX_DEGREES_PYTHON didn't work (${c.ownPython.problem}), so the scanner needs setting up another way. `
    : '';

  if (c.installFrom) {
    const text = c.installFrom.source === 'downloaded'
      ? 'Its own Python is already here. One more step, about a minute: it installs the browser-automation packages into it.'
      : 'One-time, about a minute. Downloads the browser-automation packages.';
    return { done: false, text: own + text, button: { action: 'install', label: label('install', 'Install', 'Installing…') } };
  }

  if (c.download) {
    const mb = Math.round(c.download.size / MB);
    return {
      done: false,
      text: `${own}${whyNotThisPython(c.systemPython)} Set up the scanner downloads its own Python ${c.download.version} `
        + `(${mb} MB, from GitHub) and the scanner's packages (from PyPI) into your data folder. `
        + 'Nothing else on this computer changes. About two minutes.',
      button: { action: 'setup', label: label('setup', 'Set up the scanner', 'Setting up…') },
    };
  }

  return {
    done: false,
    text: `${own}No Python 3.10 to 3.14 was found on this machine. Install one from python.org, then reload.`,
    button: null,
  };
}

// ── macOS's App Management question ─────────────────────────────────────────
// The scanner starts Google Chrome, and Chrome's own updater may then try to
// update /Applications/Google Chrome.app. macOS puts that down to the app that
// started Chrome and asks whether Six Degrees may manage apps (System Settings
// → Privacy & Security → App Management). Saying no is harmless: Chrome updates
// itself the next time you open it, and scanning works either way. Now that
// the Mac app is signed, a yes lasts across updates (unsigned copies lost it
// every update). "shouldnt we have in the onboarding for scan … a button where
// the user is basically brought to the app management and enables it like
// Flow does" (Blake, 2026-10-04). So step 1 offers the pane, once, and never
// waits for it: the app can't read whether it was allowed, and it's optional.

// The pane's address, as macOS 26 has it (checked on 26.5.1; macOS 15 knows it
// too), and as macOS 13 and 14 have it. desktop/lib.mjs SETTINGS_URLS lets
// exactly these two out of the Mac app; tests/desktop.test.mjs keeps them equal.
export const APP_MANAGEMENT_URL = 'x-apple.systempreferences:com.apple.settings.PrivacySecurity.extension?Privacy_AppBundles';
export const APP_MANAGEMENT_URL_OLDER = 'x-apple.systempreferences:com.apple.preference.security?Privacy_AppBundles';
export const APP_MANAGEMENT_URLS = Object.freeze([APP_MANAGEMENT_URL, APP_MANAGEMENT_URL_OLDER]);
export const APP_MANAGEMENT_TITLE = 'Let Six Degrees open Chrome without macOS asking';
export const APP_MANAGEMENT_WHERE = 'System Settings → Privacy & Security → App Management';

/** The Scan page's App Management item, once answered: 'done' or 'skipped' (null: not yet). */
export const APP_MANAGEMENT_SETTING = {
  default: null,
  parse(value) {
    if (value === null || value === 'done' || value === 'skipped') return value;
    throw new Error('The App Management answer is done, skipped or null.');
  },
};

/**
 * macOS's major version from the Darwin kernel's (os.release() on the
 * server): Darwin 25 is macOS 26, when the numbers jumped to the year, and 20
 * to 24 are macOS 11 to 15. null off a Mac, or when it can't be read.
 */
export function macosVersion(platform, release) {
  if (platform !== 'darwin') return null;
  const darwin = Number.parseInt(String(release ?? ''), 10);
  if (!Number.isInteger(darwin) || darwin < 1) return null;
  if (darwin >= 25) return darwin + 1;
  if (darwin >= 20) return darwin - 9;
  return 10; // Catalina and before were all 10.x
}

/**
 * Step 1's optional item about App Management: { title, text, href, where }
 * to show it, false not to, null while that isn't known yet (the page leaves
 * it out until it is, as with askForField).
 *
 * Only on a Mac (`status.checks.mac`: { version, app }, null elsewhere and
 * from an older server), and from macOS 13, which brought App Management.
 * Never once answered, Done or Skip (`settings.appManagement`), and not when
 * settings couldn't be read, since the answer couldn't be kept either. The
 * button opens the pane for that macOS (an unknown version gets the newest
 * address), and `where` says where it is by hand.
 *
 * In the Mac app macOS asks about Six Degrees. Started with npx, Chrome's
 * starter is the app Six Degrees was started from (Terminal, for example), and
 * that is the one macOS names.
 */
export function appManagementStep(status, settings) {
  if (!status) return null;
  const mac = status.checks?.mac;
  if (!mac || (mac.version != null && mac.version < 13)) return false;
  if (settings === undefined) return null;
  if (!settings || settings.appManagement) return false;
  const asked = mac.app ? 'Six Degrees' : 'the app you started Six Degrees from (Terminal, for example)';
  const allow = mac.app ? 'Allow Six Degrees' : 'Allow that app';
  return {
    title: APP_MANAGEMENT_TITLE,
    text: `When the scanner starts Google Chrome, macOS may ask whether ${asked} can manage apps. `
      + 'That’s Chrome updating itself while the scanner uses it. '
      + `${allow} once in App Management and macOS won’t ask again. Scanning works either way.`,
    href: mac.version != null && mac.version < 15 ? APP_MANAGEMENT_URL_OLDER : APP_MANAGEMENT_URL,
    where: APP_MANAGEMENT_WHERE,
  };
}

/**
 * Whether the Scan page asks for your field (app/components/FieldStep.js):
 * once, when your own connections are in (step 3) and before who they know is
 * mapped, under "Your galaxy is ready". It used to stand in front of step 1,
 * one more thing between someone new and their first scan; asked here, it
 * rescores people they can already see.
 *
 * Never before step 3, never once a 2nd-degree or company scan is in (that
 * network's owner is past onboarding), never while a scan runs, and never to
 * someone who has picked a sector (Scores → Your sector) or answered or
 * skipped it before (`fieldAsked`, saved either way). So whoever has only
 * their 1st degree mapped, someone from before this moved included, is asked
 * once. `status` is GET /api/scraper's answer (null while it loads), `settings`
 * GET /api/settings' `settings` (undefined while it loads, null when it
 * couldn't be read). null means not known yet: the page leaves the question
 * out until it is, rather than show it and take it away.
 */
export function askForField(status, settings) {
  if (!status) return null;
  const n = status.network;
  // No counts means the app couldn't be asked; a scan running is past asking.
  if (!n || !n.first || n.second || n.third || status.running) return false;
  if (settings === undefined) return null;
  return Boolean(settings && !settings.fieldAsked && !settings.sectorFocus?.sectors?.length);
}
