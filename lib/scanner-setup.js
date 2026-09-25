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

/**
 * Step 1, "Set up the scanner": { done, text, button }, where button is
 * { action: 'install'|'setup', label } or null (nothing to press).
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

  // The app's own Python should always work. When it doesn't, say so, and
  // offer what an app without one would.
  const own = c.ownPython
    ? `${c.ownPython.source === 'bundled' ? 'The Python inside the app' : 'The Python named in SIX_DEGREES_PYTHON'} didn't work (${c.ownPython.problem}), so the scanner needs setting up another way. `
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
    text: `${own}Python 3.10 or newer was not found on this machine. Install it from python.org, then reload.`,
    button: null,
  };
}
