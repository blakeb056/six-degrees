// What the Scan page's first step says and offers, from the checks GET
// /api/scraper reports (app/api/scraper/route.js, lib/scanner-python.js).
// Plain data in, plain data out: the page draws it, and
// tests/scanner-setup.test.mjs checks every state without a browser. No Node
// imports here; the page runs in the browser.

const MB = 1024 * 1024;

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
 * Step 1, "Set up the scanner": { done, text, button, note }, where button is
 * { action: 'install'|'setup', label } or null (nothing to press), and note is
 * a line to show above the step when the Python inside the app didn't work
 * (ownPythonNote), or null.
 *
 *   ready        the app's own Python (nothing to install), one named by
 *                SIX_DEGREES_PYTHON, or the scanner's environment / a Python
 *                that already has the packages
 *   install      a Python to build the scanner's environment from: this
 *                computer's (3.10 to 3.14), or the one Set up downloaded
 *   setup        none, but a standalone Python for this computer is pinned:
 *                "Set up the scanner" downloads it, then installs
 *   neither      no Python and nothing to download for this computer
 */
export function setupStep(status) {
  const step = stepOnly(status);
  return { ...step, note: ownPythonNote(status?.checks?.ownPython, step) };
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
