import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';

// The app runs the scraper itself.
//
// It used to be a second Python HTTP server on port 5555 that the user had to
// start by hand in a second terminal before the Setup buttons did anything.
// That is the step everyone fell off — the app looked broken while it was
// simply waiting for a server nobody had been told to start clearly enough.
//
// This route is behind the same gate as the destructive ones (lib/gate.js): it
// spawns processes, which is more power than deleting a row, so it must never
// be reachable from another machine. Actions are a fixed enum — no part of a
// command line ever comes from the request.

const MAX_LOG = 500;

const state = {
  running: false,
  action: null,
  log: [],
  startedAt: null,
  exitCode: null,
  child: null,
};

function push(line) {
  for (const part of String(line).split('\n')) {
    const t = part.replace(/\s+$/, '');
    if (!t) continue;
    state.log.push(t);
  }
  if (state.log.length > MAX_LOG) state.log.splice(0, state.log.length - MAX_LOG);
}

/** Where scripts/scrape.py lives — differs between a checkout and an install. */
function projectRoot() {
  const candidates = [
    process.env.SIX_DEGREES_ROOT,
    process.cwd(),
    path.join(process.cwd(), '..'),
    path.join(process.cwd(), '..', '..'),
  ].filter(Boolean);
  for (const c of candidates) {
    if (existsSync(path.join(c, 'scripts', 'scrape.py'))) return c;
  }
  return null;
}

function dataDir() {
  return process.env.SIX_DEGREES_HOME || path.join(os.homedir(), '.six-degrees');
}

/** Run something short and tell me only whether it worked. */
function probe(cmd, args, timeoutMs = 6000) {
  return new Promise((resolve) => {
    let done = false;
    const finish = (ok) => { if (!done) { done = true; resolve(ok); } };
    try {
      const c = spawn(cmd, args, { stdio: 'ignore' });
      const t = setTimeout(() => { try { c.kill(); } catch {} finish(false); }, timeoutMs);
      c.on('error', () => { clearTimeout(t); finish(false); });
      c.on('close', (code) => { clearTimeout(t); finish(code === 0); });
    } catch {
      finish(false);
    }
  });
}

const IMPORTS = 'import playwright, requests, PIL';

/** The interpreter we install into and run from: our own, inside the data dir.
 *
 *  Two traps make "just use python3" wrong, and between them they are why a
 *  hand-run install could appear to succeed and still leave nothing working:
 *
 *  1. `python3` on PATH is often Homebrew's, while the interpreter that already
 *     has Playwright is /usr/bin/python3. Installing into one and running the
 *     other looks identical to a broken install.
 *  2. Homebrew and system Pythons are "externally managed" (PEP 668) and refuse
 *     `pip install` outright, with an error most people read as a dead end.
 *
 *  A virtualenv in the data directory has neither problem, is thrown away with
 *  the rest of the folder, and never touches the machine's Python.
 */
function venvPython() {
  const base = path.join(dataDir(), 'venv');
  return process.platform === 'win32'
    ? path.join(base, 'Scripts', 'python.exe')
    : path.join(base, 'bin', 'python');
}

/** A Python that can actually run the scraper right now, or null. */
async function findUsablePython() {
  const venv = venvPython();
  if (existsSync(venv) && await probe(venv, ['-c', IMPORTS], 8000)) return venv;
  // Respect an existing working install rather than forcing a venv on someone
  // who already did this by hand.
  for (const c of ['/usr/bin/python3', 'python3', 'python']) {
    if (await probe(c, ['-c', IMPORTS], 8000)) return c;
  }
  return null;
}

/** Any Python at all — used to build the venv. */
async function findAnyPython() {
  for (const c of ['python3', '/usr/bin/python3', 'python']) {
    if (await probe(c, ['--version'], 4000)) return c;
  }
  return null;
}

let cached = { at: 0, value: null };

async function status() {
  if (Date.now() - cached.at < 4000 && cached.value) return cached.value;

  const root = projectRoot();
  const usable = await findUsablePython();
  const anyPython = usable || await findAnyPython();

  const chrome =
    process.platform === 'darwin'
      ? existsSync('/Applications/Google Chrome.app')
      : true; // elsewhere Playwright resolves the channel itself

  const signedIn = existsSync(path.join(dataDir(), 'chrome-profile', 'Default', 'Cookies'));

  const value = {
    ready: Boolean(root && usable && chrome),
    checks: {
      scriptsFound: Boolean(root),
      python: Boolean(anyPython),
      pythonPath: usable || anyPython,
      dependencies: Boolean(usable),
      chrome,
      signedIn,
    },
    running: state.running,
    action: state.action,
    startedAt: state.startedAt,
    exitCode: state.exitCode,
    log: state.log.slice(-120),
  };
  cached = { at: Date.now(), value };
  return value;
}

export async function GET() {
  return Response.json(await status());
}

// A fixed set. Anything taking a name uses `--flag=value`, a single argv token,
// so a name that begins with "-" can never be read as a flag of its own — and
// spawn takes an array, so there is no shell for it to escape into either.
const ACTIONS = {
  install:       { label: 'Installing the scraper’s Python packages' },
  login:         { flag: '--login',       label: 'Opening LinkedIn so you can sign in' },
  full:          { flag: '--full',        label: 'Scanning your whole network' },
  refresh:       { flag: '--refresh',     label: 'Checking for new connections' },
  'auto-bridge': { flag: '--auto-bridge', label: 'Mapping every bridge in turn' },
  bridge:        { flag: '--bridge',   needsName: true, label: 'Mapping the circle behind' },
  rescrape:      { flag: '--rescrape', needsName: true, label: 'Re-mapping the circle behind' },
  company:       { flag: '--company',  needsName: true, label: 'Scanning' },
};

/** Names come from the page, so they are checked before becoming an argument. */
function cleanName(raw) {
  const name = String(raw ?? '').trim();
  if (!name || name.length > 120) return null;
  if (/[\u0000-\u001f]/.test(name)) return null;
  return name;
}

export async function POST(request) {
  let body = {};
  try { body = await request.json(); } catch {}
  const action = String(body.action || '');

  if (action === 'cancel') {
    if (state.child) { try { state.child.kill('SIGTERM'); } catch {} }
    return Response.json({ ok: true, cancelled: true });
  }

  if (!Object.hasOwn(ACTIONS, action)) {
    return Response.json({ error: `Unknown action '${action}'` }, { status: 400 });
  }

  const spec = ACTIONS[action];
  let name = null;
  if (spec.needsName) {
    name = cleanName(body.name);
    if (!name) return Response.json({ error: 'A name is required for this action.' }, { status: 400 });
  }
  if (state.running) {
    return Response.json({ error: 'Something is already running.', action: state.action }, { status: 409 });
  }

  const root = projectRoot();
  if (!root) {
    return Response.json({ error: 'Could not find scripts/scrape.py next to the app.' }, { status: 500 });
  }
  let python;
  if (action === 'install') {
    python = await findAnyPython();
    if (!python) {
      return Response.json({ error: 'Python 3 is not installed, or not on this app’s PATH.' }, { status: 500 });
    }
  } else {
    python = await findUsablePython();
    if (!python) {
      return Response.json({ error: 'The scraper’s packages are not installed yet. Do step 1 first.' }, { status: 409 });
    }
  }

  const venvDir = path.join(dataDir(), 'venv');
  const reqs = path.join(root, 'scripts', 'requirements.txt');

  // Installing is several commands, so it runs as a small sequential plan
  // rather than a shell string — nothing here is ever concatenated from input.
  const plan = action === 'install'
    ? [
        { cmd: python, args: ['-m', 'venv', venvDir], note: 'Creating a private Python environment' },
        { cmd: venvPython(), args: ['-m', 'pip', 'install', '--upgrade', 'pip'], note: 'Updating pip', tolerant: true },
        { cmd: venvPython(), args: ['-m', 'pip', 'install', '-r', reqs], note: 'Installing Playwright, requests and Pillow' },
      ]
    : [
        {
          cmd: python,
          args: [
            path.join(root, 'scripts', 'scrape.py'),
            name ? `${spec.flag}=${name}` : spec.flag,
          ],
        },
      ];

  // The scraper writes back through this very app, so point it at the port we
  // are actually being served on rather than guessing 3000.
  const host = request.headers.get('host') || '127.0.0.1:3000';
  const port = host.includes(':') ? host.split(':').pop() : '80';

  state.running = true;
  state.action = action;
  state.exitCode = null;
  state.startedAt = Date.now();
  state.log = [spec.label + (name ? ` ${name}…` : '…')];
  cached = { at: 0, value: null };

  const childEnv = {
    ...process.env,
    APP_URL: `http://127.0.0.1:${port}`,
    PYTHONUNBUFFERED: '1',
    SIX_DEGREES_ROOT: root,
  };

  function finish(code) {
    push(code === 0 ? 'Finished.' : `Stopped (exit ${code}).`);
    state.running = false;
    state.child = null;
    state.exitCode = code;
    cached = { at: 0, value: null };
  }

  function runStep(i) {
    if (i >= plan.length) return finish(0);
    const step = plan[i];
    if (step.note) push(step.note + '…');

    let child;
    try {
      child = spawn(step.cmd, step.args, { cwd: root, env: childEnv });
    } catch (err) {
      push(`Could not start: ${err.message}`);
      return finish(-1);
    }
    state.child = child;

    child.stdout.on('data', (d) => push(d.toString()));
    child.stderr.on('data', (d) => {
      // pip and playwright both chatter on stderr; only surface real trouble.
      const t = d.toString();
      if (/error|Error|Traceback|No module|failed|externally-managed/.test(t)) push(t);
    });
    child.on('error', (err) => { push(`Could not start: ${err.message}`); finish(-1); });
    child.on('close', (code) => {
      if (code !== 0 && !step.tolerant) return finish(code);
      runStep(i + 1);
    });
  }

  runStep(0);

  return Response.json({ ok: true, action });
}
